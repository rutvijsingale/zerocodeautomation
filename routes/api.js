/**
 * API Routes
 * 
 * PROJECT STRUCTURE:
 * ==================
 * 
 * New Project-Based Structure (Primary):
 * - All projects are stored in: projects/<projectId>/
 * - Project data: projects/<projectId>/project.json
 * - Generated code files: projects/<projectId>/src/... (Java) or projects/<projectId>/features/... (TS)
 * - Locators: projects/<projectId>/locators.json (stored in project.json)
 * 
 * Legacy Export Structure (Backward Compatibility):
 * - Old exports without projectId: sample-export/<projectName>/
 * - Only used when projectId is not available
 * 
 * All new project operations should use projectId and projectService.getProjectDir()
 * Legacy endpoints check for projectId first, then fall back to sample-export
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { asyncHandler, createHealthResponse } from '../middleware/errorHandler.js';
import { validateProjectName, validateSessionId, strictRateLimiter, generalRateLimiter, pollingRateLimiter } from '../middleware/security.js';
import { browserService } from '../services/browserService.js';
import { FileService } from '../services/fileService.js';
import * as javaGenerators from '../java-code-generators.js';
import * as normalizationUtils from '../normalization-utils.js';
import * as playwrightGenerator from '../generators/playwright.js';
import * as gherkinGenerator from '../generators/gherkin.js';
import * as stepsGenerator from '../generators/steps_ts_template.js';
import { generateZeroCodeJson } from '../generators/zero-code-json.js';
import { locatorService } from '../services/locatorService.js';
import { environmentService } from '../services/environmentService.js';
import { projectService } from '../services/projectService.js';
import { LocatorDefinition } from '../models/LocatorDefinition.js';
import { Environment } from '../models/Environment.js';
import * as pageObjectGenerators from '../generators/pageObjects.js';
import { mavenService } from '../services/mavenService.js';
import { npmService } from '../services/npmService.js';

const router = express.Router();
const fileService = new FileService();

// ----------------------------------------------------------------------------
// Browser launch arg builder (shared by /api/rerun and /api/execute-test)
// ----------------------------------------------------------------------------
//
// PROD-0002: rerun used to launch with only `--no-sandbox` /
// `--disable-setuid-sandbox`, which left Chromium / Edge in their default
// 800x600 window. Modern web apps (Amazon, internal SaaS, anything with
// a sticky header) render unusably at that size and the rerun would
// silently miss elements that only exist in the maximized layout.
//
// We mirror the recorder's behaviour:
//   - chromium / edge headed → add `--start-maximized`
//   - firefox / webkit → omit (they ignore the flag)
//   - any browser headless → omit (no window to maximize)
//
// Tests covering this live in automation-suite/unit-js/launch_args.test.mjs.
// [ZAC-FIX 2026-05-24] Persist a self-contained HTML report alongside
// replay-result.json so users can open the report directly from disk
// (or attach to an email / Jira / Slack) WITHOUT having to navigate
// the dashboard. The dashboard's `/api/dashboard/report/html` endpoint
// already renders the same HTML on-demand from the JSON, but a stale
// JSON-only state on disk meant users had no portable artefact and
// reasonably reported "the rerun didn't generate a report".
//
// Best-effort: a render failure must never break the rerun success
// path (the JSON is the source of truth — HTML is a derived view).
async function persistRerunHtmlReport({ scaffold, replayPayload, framework, projectId, testName }) {
  try {
    const fsp = await import('fs/promises');
    const { renderHtmlReport } = await import('../services/reportRenderer.js');
    const html = renderHtmlReport({
      replayResult: replayPayload,
      reportPath: `${framework}/${projectId}/reruns/${testName}/${scaffold.timestamp}`,
      generatedAt: new Date().toISOString(),
    });
    await fsp.mkdir(scaffold.report, { recursive: true });
    const reportFile = path.join(scaffold.report, 'index.html');
    await fsp.writeFile(reportFile, html, 'utf8');
    return reportFile;
  } catch (err) {
    console.warn('[Rerun] HTML report render failed (replay-result.json is still on disk):', err.message);
    return null;
  }
}

function buildRerunLaunchArgs(browserType, headless) {
  const args = ['--no-sandbox', '--disable-setuid-sandbox'];
  if (!headless && (browserType === 'chromium' || browserType === 'edge')) {
    args.push('--start-maximized');
  }
  return args;
}

// Exposed for unit tests; not part of the public router contract.
export const __testables = { buildRerunLaunchArgs };

// ----------------------------------------------------------------------------
// Helpers for auto-promoting captured locators into the project repo
// ----------------------------------------------------------------------------

// Sanitises a free-form normalizedPageName (e.g. "Shop Html", "Landing Page")
// into a valid Java class prefix ("ShopHtml", "Landing"). Returns null if
// the input cannot be turned into a usable identifier.
function sanitizePageName(name) {
  if (!name || typeof name !== 'string') return null;
  const cleaned = name
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  return cleaned || null;
}

// Sanitises an element description ("add to cart - p-101") into a valid
// camelCase Java field name ("addToCartP101").
function sanitizeElementName(desc) {
  if (!desc || typeof desc !== 'string') return null;
  const parts = desc
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return null;
  return parts
    .map((p, i) => (i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('')
    .replace(/[^a-zA-Z0-9_]/g, '');
}

// Auto-promote stable selectors captured during recording into the project's
// locator repository so Page Objects can be generated. We deliberately only
// promote selectors anchored on stable attributes (id, data-testid, name,
// aria-label) to avoid polluting the repo with brittle nth-child paths.
async function autoPromoteLocatorsFromActions(projectId, actions) {
  if (!projectId || !Array.isArray(actions) || actions.length === 0) return 0;

  const STABLE_KINDS = new Set(['id', 'testId', 'name', 'role']);
  const STABLE_PATTERNS = [
    /^#[A-Za-z][\w-]*$/,                      // #elementId
    /^\[data-testid=["'][^"']+["']\]$/,       // [data-testid="..."]
    /^\[name=["'][^"']+["']\]$/,              // [name="..."]
    /^\[aria-label=["'][^"']+["']\]$/,        // [aria-label="..."]
  ];

  let promoted = 0;
  for (const action of actions) {
    if (!action || typeof action !== 'object') continue;
    const selector = action.selector || action.normalizedSelector;
    if (!selector || typeof selector !== 'string') continue;

    const inferredType = locatorService.inferLocatorType(selector);
    const looksStable = STABLE_KINDS.has(inferredType) || STABLE_PATTERNS.some((re) => re.test(selector));
    if (!looksStable) continue;

    const pageName = sanitizePageName(action.normalizedPageName) || 'Generic';
    const elementName = sanitizeElementName(action.normalizedDescription) || sanitizeElementName(selector) || 'element';

    // Skip if this exact (pageName, elementName) already exists with the same selector
    const existing = await locatorService.getLocatorByPageAndElement(projectId, pageName, elementName);
    if (existing && existing.locatorValue === selector) continue;

    // Convert any pre-recorded fallback selectors to the model's {type,value} shape
    const fallbackList = Array.isArray(action.fallbackSelectors)
      ? action.fallbackSelectors
          .filter((s) => typeof s === 'string' && s && s !== selector)
          .map((s) => ({ type: locatorService.inferLocatorType(s), value: s }))
      : [];

    const locator = new LocatorDefinition({
      pageName,
      elementName,
      locatorType: inferredType,
      locatorValue: selector,
      description: action.normalizedDescription || `${pageName}.${elementName}`,
      fallbackLocators: fallbackList,
    });
    await locatorService.saveLocator(projectId, locator);
    promoted++;
  }
  return promoted;
}

// Helper function to validate and decode projectId from URL params
function validateAndDecodeProjectId(projectIdParam) {
  // Decode projectId from URL (it's already encoded by frontend)
  let projectId = decodeURIComponent(projectIdParam);
  
  // Basic security validation - only allow alphanumeric, dashes, underscores, and dots
  if (!/^[a-zA-Z0-9._-]+$/.test(projectId)) {
    throw new Error('Invalid project ID format');
  }
  
  return projectId;
}

// Store running rerun executions for cancellation
const runningReruns = new Map(); // Map<executionId, { cancelled: boolean, browser, context, page }>
let mostRecentExecutionId = null; // Track most recent execution for cancellation without ID

// T2.6 — concurrency cap. Each rerun spins up a real Playwright browser
// (~150 MB RSS), so an unbounded fleet can OOM the host. Default 3
// concurrent reruns, override via env (ZAC_MAX_CONCURRENT_RERUNS=N).
//
// Behavior on overflow: return HTTP 429 with `retryAfter` so the caller
// can back off, instead of silently queueing (which would mask
// scheduling bugs). The limit is enforced INSIDE the route just before
// we call browser.launch(), so cancelled-but-not-yet-cleaned-up runs
// don't permanently consume a slot.
const MAX_CONCURRENT_RERUNS = (() => {
  const n = Number(process.env.ZAC_MAX_CONCURRENT_RERUNS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
})();
function rerunsCurrentlyRunning() {
  // Count entries that still have a live `browser` AND have not been
  // cancelled. This way a rerun that crashed (browser=null) frees its
  // slot immediately even before its handler unwinds.
  let n = 0;
  runningReruns.forEach((s) => { if (s.browser && !s.cancelled) n++; });
  return n;
}

// Health check endpoint
router.get('/health', (req, res) => {
  createHealthResponse(req, res);
});

/* -------------------------------------------------------------------------- *
 *  Framework registry + project layout endpoints                             *
 *                                                                            *
 *  Gives the UI a single source of truth for supported frameworks (so the    *
 *  dropdown can be populated dynamically) and lets any client materialize    *
 *  the canonical generated-projects/<framework>/<project>/ folder tree on    *
 *  demand. See services/projectLayout.js + config/frameworks.json.           *
 * -------------------------------------------------------------------------- */

// List supported frameworks. Sourced from config/frameworks.json which itself
// is sourced from the existing generators/UI dropdowns — no fabricated entries.
// [ZAC-FIX] Was generalRateLimiter (100/15min). Bumped to pollingRateLimiter
// because every iframe boot, recorder load, and framework-summary cycle
// hits this — easy to exhaust the strict budget under normal use.
router.get('/frameworks', pollingRateLimiter, asyncHandler(async (req, res) => {
  const { listFrameworks } = await import('../services/projectLayout.js');
  const frameworks = await listFrameworks();
  res.json({ frameworks });
}));

// Materialize / refresh the canonical layout for a project. Idempotent.
// Body: { framework: string, projectName: string }
router.post('/project-layout/scaffold', generalRateLimiter, asyncHandler(async (req, res) => {
  const layout = await import('../services/projectLayout.js');
  const validation = await layout.validateLayoutInputs(req.body || {});
  if (!validation.ok) {
    return res.status(validation.status).json({ error: validation.error });
  }
  const paths = await layout.ensureProjectScaffold({
    framework: validation.framework,
    projectName: validation.projectName,
  });
  res.json({
    framework: paths.framework,
    projectName: paths.projectName,
    root: paths.root,
    paths: {
      tests: paths.tests,
      pages: paths.pages,
      locators: paths.locators,
      data: paths.data,
      config: paths.config,
      utils: paths.utils,
      recordings: paths.recordings,
      reruns: paths.reruns,
      reports: paths.reports,
      screenshots: paths.screenshots,
      videos: paths.videos,
      logs: paths.logs,
      readme: paths.readme,
    },
  });
}));

// Build the recording artifact paths for a project (and ensure they exist).
// Body: { framework, projectName, recordingName? }
router.post('/project-layout/recording', generalRateLimiter, asyncHandler(async (req, res) => {
  const layout = await import('../services/projectLayout.js');
  const validation = await layout.validateLayoutInputs(req.body || {});
  if (!validation.ok) {
    return res.status(validation.status).json({ error: validation.error });
  }
  const result = await layout.ensureRecordingScaffold({
    framework: validation.framework,
    projectName: validation.projectName,
    recordingName: req.body && req.body.recordingName,
  });
  res.json({
    framework: result.project.framework,
    projectName: result.project.projectName,
    recordingName: result.recordingName,
    paths: {
      recordingDir: result.recordingDir,
      recordedSteps: result.recordedSteps,
      metadata: result.metadata,
      screenshots: result.screenshots,
      logs: result.logs,
    },
  });
}));

// Build the rerun artifact paths for a project (and ensure they exist).
// Body: { framework, projectName, testName, timestamp? }
router.post('/project-layout/rerun', generalRateLimiter, asyncHandler(async (req, res) => {
  const layout = await import('../services/projectLayout.js');
  const validation = await layout.validateLayoutInputs(req.body || {});
  if (!validation.ok) {
    return res.status(validation.status).json({ error: validation.error });
  }
  const { testName, timestamp } = req.body || {};
  if (!testName) {
    return res.status(400).json({ error: 'testName is required' });
  }
  try {
    const result = await layout.ensureRerunScaffold({
      framework: validation.framework,
      projectName: validation.projectName,
      testName,
      timestamp,
    });
    res.json({
      framework: result.project.framework,
      projectName: result.project.projectName,
      testName: result.testName,
      timestamp: result.timestamp,
      paths: {
        rerunDir: result.rerunDir,
        report: result.report,
        replayResult: result.replayResult,
        screenshots: result.screenshots,
        videos: result.videos,
        traces: result.traces,
        logs: result.logs,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

/* -------------------------------------------------------------------------- *
 *  Test plan endpoints                                                       *
 * -------------------------------------------------------------------------- */

// Generate a single Markdown test plan from a recording (or arbitrary plan).
// Body: { framework, projectName, recordingName, steps?, metadata?, plan? }
//   - If `plan` is provided, it is rendered verbatim.
//   - Else `steps` + `metadata` are turned into a default plan.
router.post('/test-plan/generate', generalRateLimiter, asyncHandler(async (req, res) => {
  const layout = await import('../services/projectLayout.js');
  const validation = await layout.validateLayoutInputs(req.body || {});
  if (!validation.ok) return res.status(validation.status).json({ error: validation.error });

  const { recordingName, steps, metadata, plan } = req.body || {};
  if (!recordingName) return res.status(400).json({ error: 'recordingName is required' });

  const tpg = await import('../services/testPlanGenerator.js');
  try {
    let file, markdown;
    if (plan && typeof plan === 'object') {
      // Caller supplied a fully-formed plan — render and persist.
      const filledPlan = { ...plan, framework: validation.framework, projectName: validation.projectName };
      markdown = tpg.renderTestPlan(filledPlan);
      file = await tpg.writeRenderedPlan({
        framework: validation.framework,
        projectName: validation.projectName,
        recordingName,
        markdown,
      });
    } else {
      const result = await tpg.writeTestPlanFromRecording({
        framework: validation.framework,
        projectName: validation.projectName,
        recordingName,
        steps: Array.isArray(steps) ? steps : [],
        metadata: metadata || {},
      });
      file = result.file;
      markdown = result.markdown;
    }
    console.log(`[Plan] Generated test plan for ${recordingName} → ${file}`);
    res.json({
      framework: validation.framework,
      projectName: validation.projectName,
      recordingName,
      testPlanFile: file,
      bytes: Buffer.byteLength(markdown, 'utf8'),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

// Bulk-emit Amazon scenario test plans (A–L) into the project's test-plan/.
// Body: { framework, projectName, only? = ['A','C',...] }
// Refuses to write any plan that contains literal credentials.
router.post('/amazon-scenarios/generate', generalRateLimiter, asyncHandler(async (req, res) => {
  const layout = await import('../services/projectLayout.js');
  const validation = await layout.validateLayoutInputs(req.body || {});
  if (!validation.ok) return res.status(validation.status).json({ error: validation.error });

  const az = await import('../services/amazonScenarios.js');
  const tpg = await import('../services/testPlanGenerator.js');

  const { only } = req.body || {};
  let scenarios = az.listAmazonScenarios({
    framework: validation.framework,
    projectName: validation.projectName,
  });
  if (Array.isArray(only) && only.length > 0) {
    const set = new Set(only.map((s) => String(s).toUpperCase()));
    scenarios = scenarios.filter((s) => set.has(s.letter));
  }

  const written = [];
  const skipped = [];
  for (const sc of scenarios) {
    const md = tpg.renderTestPlan(sc);
    const leaks = az.findCredentialLeaks(md);
    if (leaks.length > 0) {
      console.warn(`[Plan] ⚠️ Refusing to write ${sc.scenarioId} — credential leak suspected:`, leaks);
      skipped.push({ scenarioId: sc.scenarioId, reason: 'credential-leak', leaks });
      continue;
    }
    const file = await tpg.writeRenderedPlan({
      framework: validation.framework,
      projectName: validation.projectName,
      recordingName: sc.scenarioId,
      markdown: md,
    });
    written.push({ scenarioId: sc.scenarioId, letter: sc.letter, file });
  }
  console.log(`[Plan] Emitted ${written.length}/${scenarios.length} Amazon scenarios for ${validation.projectName}`);
  res.json({
    framework: validation.framework,
    projectName: validation.projectName,
    written,
    skipped,
  });
}));

// Get configuration
// [ZAC-FIX] Same reason as /frameworks — boot-time fetch on every tab load.
router.get('/config', pollingRateLimiter, (req, res) => {
  res.json({
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    appName: process.env.APP_NAME || 'Zero‑Code Automation IDE',
    defaultBrowser: process.env.DEFAULT_BROWSER || 'chromium',
    maxSessions: browserService.maxSessions,
    sessionTimeout: browserService.sessionTimeout,
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Validation endpoint
router.post('/validate', generalRateLimiter, asyncHandler(async (req, res) => {
  const payload = req.body || {};
  const steps = Array.isArray(payload.steps) ? payload.steps : [];

  const stepDefs = stepsGenerator.generateStepDefinitions(steps);
  const validation = gherkinGenerator.verifyFeatureStepLinkage(steps, stepDefs);

  res.json({
    valid: validation.valid,
    message: validation.valid
      ? 'All feature steps are properly linked to step definitions'
      : 'Some feature steps are missing matching step definitions',
    required: validation.required,
    found: validation.found,
    missing: validation.missing,
    summary: {
      total: validation.required.length,
      matched: validation.found.length,
      missing: validation.missing.length
    }
  });
}));

// Export endpoint
router.post('/export', strictRateLimiter, asyncHandler(async (req, res) => {
  const payload = req.body || {};
  
  // Use projectId if provided, otherwise fall back to projectName
  let projectId = payload.projectId;
  let projectName;
  
  if (projectId) {
    // Load project data to get name
    try {
      const projectData = await projectService.loadProjectData(projectId);
      projectName = validateProjectName(projectData.name || `project-${projectId}`);
      // Use steps from project if not provided in payload
      if (!payload.steps && projectData.steps) {
        payload.steps = projectData.steps;
      }
    } catch (error) {
      console.error('[Export] Error loading project:', error);
      projectName = validateProjectName(payload.projectName || 'sample-project');
    }
  } else {
    projectName = validateProjectName(payload.projectName || 'sample-project');
  }
  
  const framework = payload.framework || 'playwright-ts';
  const browserType = payload.browserType || 'chromium';
  
  // PRIMARY: Use project directory structure (projects/<projectId>/)
  // FALLBACK: Use sample-export for legacy exports without projectId
  let exportRoot;
  if (projectId) {
    exportRoot = projectService.getProjectDir(projectId);
  } else {
    // Legacy: export to sample-export when no projectId (backward compatibility)
    exportRoot = await fileService.getProjectPath(projectName);
  }

  await fileService.ensureDirectory(exportRoot);

  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  const baseUrl = payload.baseUrl || 'http://localhost:3000';

  // Check if framework is Java-based
  const isJavaFramework = framework === 'playwright-java' || framework === 'selenium-java';

  // T2.1 — selenium-testng (pure-TestNG plugin, no Cucumber). Branch
  // BEFORE the Cucumber Java path so this is purely additive.
  if (framework === 'selenium-testng') {
    const seleniumTestng = await import('../generators/selenium-testng.js');
    const result = seleniumTestng.generateProject({
      projectName,
      featureTitle: payload.featureTitle || 'Recorded Test Flow',
      featureName: payload.featureName || 'Recorded Feature',
      baseUrl,
      steps,
      tags: payload.tags || [],
      browserType,
    });
    const { files = {}, surfaced = {} } = result || {};
    for (const [relPath, content] of Object.entries(files)) {
      const absPath = path.join(exportRoot, relPath);
      await fileService.ensureDirectory(path.dirname(absPath));
      await fileService.writeFile(absPath, content);
    }
    return res.json({
      success: true,
      framework,
      projectName,
      exportRoot,
      fileCount: Object.keys(files).length,
      primaryTestFile: surfaced.primaryTestFile,
      runnerEntryPoint: surfaced.runnerEntryPoint || 'pom.xml',
    });
  }

  if (isJavaFramework) {
    // Generate Java project structure
    const srcMainJava = path.join(exportRoot, 'src', 'main', 'java');
    const srcTestJava = path.join(exportRoot, 'src', 'test', 'java');
    const srcTestResources = path.join(exportRoot, 'src', 'test', 'resources');

    await fileService.ensureDirectory(srcMainJava);
    await fileService.ensureDirectory(srcTestJava);
    await fileService.ensureDirectory(srcTestResources);

    // Generate Maven pom.xml
    const pomXml = javaGenerators.generateMavenPom(framework, projectName, baseUrl);
    await fileService.writeFile(path.join(exportRoot, 'pom.xml'), pomXml);

    // Generate Java World class with browser type
    const browserOptions = {
      ...(payload.browserOptions || {}),
      browserType: browserType
    };
    const worldClass = javaGenerators.generateJavaWorld(framework, browserOptions);
    const supportDir = path.join(srcTestJava, 'support');
    await fileService.ensureDirectory(supportDir);
    // Use correct World class name based on framework
    const worldClassName = framework === 'selenium-java' ? 'SeleniumWorld.java' : 'PlaywrightWorld.java';
    await fileService.writeFile(path.join(supportDir, worldClassName), worldClass);

    // Generate Page Objects if locators are available
    let pageLocatorsMap = {};
    if (projectId) {
      try {
        const locators = await locatorService.loadLocators(projectId);
        // Group locators by pageName
        locators.forEach(loc => {
          if (!pageLocatorsMap[loc.pageName]) {
            pageLocatorsMap[loc.pageName] = [];
          }
          pageLocatorsMap[loc.pageName].push(loc);
        });
      } catch (error) {
        console.log('[Export] No locators found for project, skipping page object generation');
      }
    }
    
    // Generate BasePage for Selenium if needed
    if (framework === 'selenium-java' && Object.keys(pageLocatorsMap).length > 0) {
      const pagesDir = path.join(srcTestJava, 'pages');
      await fileService.ensureDirectory(pagesDir);
      const basePageCode = pageObjectGenerators.generateSeleniumBasePage({ defaultTimeout: 10 });
      await fileService.writeFile(path.join(pagesDir, 'BasePage.java'), basePageCode);
    }
    
    // Generate Page Objects
    if (Object.keys(pageLocatorsMap).length > 0) {
      const pagesDir = path.join(srcTestJava, 'pages');
      await fileService.ensureDirectory(pagesDir);
      const frameworkType = framework === 'selenium-java' ? 'selenium-java' : 'playwright-ts';
      const pageObjects = pageObjectGenerators.generateAllPageObjects(pageLocatorsMap, frameworkType);
      
      for (const [pageName, pageCode] of Object.entries(pageObjects)) {
        const fileName = `${pageName}Page.java`;
        await fileService.writeFile(path.join(pagesDir, fileName), pageCode);
      }
      console.log(`[Export] Generated ${Object.keys(pageObjects).length} page objects`);
    }

    // Generate Java step definitions from recorded steps
    // Build stepDefMap from actual steps to ensure all step definitions are generated
    const stepDefMap = {};
    const featureContent = gherkinGenerator.generateFeatureFile({
      featureName: payload.featureName || 'Recorded Feature',
      featureTitle: payload.featureTitle || 'Recorded Flow',
      tags: payload.tags || [],
      steps: steps,
      backgroundSteps: payload.backgroundSteps || [],
      useScenarioOutline: payload.useScenarioOutline || false,
      examples: payload.examples || [],
      scenarios: payload.scenarios || null
    });
    
    // Extract step patterns from feature file and mark them as needed
    const featureLines = featureContent.split('\n');
    featureLines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed.match(/^(Given|When|Then|And)\s+/)) {
        // Extract the step pattern (replace quoted strings with {string}, numbers with {int})
        const pattern = trimmed.replace(/"[^"]*"/g, '{string}').replace(/\d+/g, '{int}');
        stepDefMap[pattern] = true;
      }
    });
    
    const groupedActions = []; // Would need to be populated from actions grouping
    // Generate class name from feature title
    const featureTitle = payload.featureTitle || 'Recorded Flow';
    const stepsFileName = featureTitle.replace(/[^a-zA-Z0-9]/g, '') || 'RecordedTest';
    const className = `${stepsFileName}Steps`;
    const stepDefs = javaGenerators.generateJavaStepDefinitions(framework, stepDefMap, groupedActions, baseUrl, steps, className);
    const stepsDir = path.join(srcTestJava, 'steps');
    await fileService.ensureDirectory(stepsDir);
    await fileService.writeFile(path.join(stepsDir, `${stepsFileName}Steps.java`), stepDefs);

    // Generate feature file
    const featureDir = path.join(srcTestResources, 'features');
    await fileService.ensureDirectory(featureDir);
    const featureFile = gherkinGenerator.generateFeatureFile({
      featureName: payload.featureName || 'Recorded Feature',
      featureTitle: payload.featureTitle || 'Recorded Flow',
      tags: payload.tags || [],
      steps: steps,
      backgroundSteps: payload.backgroundSteps || [],
      useScenarioOutline: payload.useScenarioOutline || false,
      examples: payload.examples || [],
      scenarios: payload.scenarios || null
    });
    await fileService.writeFile(path.join(featureDir, 'recorded.feature'), featureFile);

    // Generate cucumber.properties
    const cucumberProps = javaGenerators.generateCucumberProperties();
    await fileService.writeFile(path.join(srcTestResources, 'cucumber.properties'), cucumberProps);

  } else {
    // Generate TypeScript/JavaScript project (existing logic)
    const pkgJson = stepsGenerator.generatePackageJson({ projectName });
    await fileService.writeFile(path.join(exportRoot, 'package.json'), pkgJson);

    const pwConfig = playwrightGenerator.generatePlaywrightConfig({
      baseUrl: baseUrl
    });
    const testsDir = path.join(exportRoot, 'tests');
    await fileService.ensureDirectory(testsDir);
    await fileService.writeFile(path.join(exportRoot, 'playwright.config.ts'), pwConfig);

    const cucumberConfig = gherkinGenerator.generateCucumberConfig();
    await fileService.writeFile(path.join(exportRoot, 'cucumber.config.js'), cucumberConfig);

    const spec = playwrightGenerator.generatePlaywrightSpec({
      featureTitle: payload.featureTitle || 'Recorded Flow',
      baseUrl: baseUrl,
      steps: steps
    });
    await fileService.writeFile(path.join(testsDir, 'recorded.spec.ts'), spec);

    // Generate feature file and step definitions
    const featureDir = path.join(exportRoot, 'features');
    const stepsDir = path.join(exportRoot, 'steps');
    await fileService.ensureDirectory(featureDir);
    await fileService.ensureDirectory(stepsDir);

    const featureFile = gherkinGenerator.generateFeatureFile({
      featureName: payload.featureName || 'Recorded Feature',
      featureTitle: payload.featureTitle || 'Recorded Flow',
      tags: payload.tags || [],
      steps: steps
    });
    await fileService.writeFile(path.join(featureDir, 'recorded.feature'), featureFile);

    const stepDefs = stepsGenerator.generateStepDefinitions(steps);
    await fileService.writeFile(path.join(stepsDir, 'recorded.steps.ts'), stepDefs);

    // Generate additional files
    const worldFile = stepsGenerator.generateWorldFile();
    const worldDir = path.join(exportRoot, 'support');
    await fileService.ensureDirectory(worldDir);
    await fileService.writeFile(path.join(worldDir, 'world.ts'), worldFile);
  }

  // Create zip file
  const zipPath = await fileService.createProjectZip(projectName);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename=${projectName}.zip`);

  const { createReadStream } = await import('fs');
  const stream = createReadStream(zipPath);
  stream.pipe(res);

  // Cleanup zip file after response
  res.on('finish', async () => {
    try {
      await fileService.deleteDirectory(zipPath);
    } catch (error) {
      console.warn('Failed to cleanup zip file:', error);
    }
  });
}));

// [ZAC-FIX] runWithTimeout — race any Promise against a timer. Used by the
// rerun loop so a single hung step (e.g. Playwright's internal waits never
// resolving on a deleted element) can never freeze the entire run forever.
// On timeout the rejection is a TimeoutError tagged with `.zacTimeout=true`
// so callers can branch on it cleanly.
function runWithTimeout(promise, timeoutMs, label = 'operation') {
  const ms = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : 30000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      const err = new Error(`[Timeout] "${label}" exceeded ${ms}ms`);
      err.zacTimeout = true;
      err.zacTimeoutMs = ms;
      reject(err);
    }, ms);
    Promise.resolve(promise).then(
      (val) => { if (settled) return; settled = true; clearTimeout(t); resolve(val); },
      (err) => { if (settled) return; settled = true; clearTimeout(t); reject(err); },
    );
  });
}

// Rerun/Execute recorded script
router.post('/rerun', generalRateLimiter, asyncHandler(async (req, res) => {
  const {
    steps,
    browserType = 'chromium',
    baseUrl = 'about:blank',
    headless = false,
    useScenarioOutline = false,
    examples = [],
    stopOnFailure = false,
    // Optional — when supplied, healed locator events are persisted to
    // projects/<projectId>/healed-locators.json for later QA review.
    projectId = null,
    // Optional — when projectId, framework and testName are all provided,
    // rerun output (status.json + logs) lands under
    // generated-projects/<framework>/<project>/reruns/<testName>/<timestamp>/.
    framework: rerunFramework = null,
    testName: rerunTestName = null,
    // [ZAC-FIX] Per-run knobs:
    //   stepTimeoutMs       global per-step ceiling; overridable per-step via step.timeoutMs
    //   defaultAssertMode   'hard' (default — fail run on the first assertion miss
    //                        unless stopOnFailure is false) or 'soft' (collect
    //                        failures, never break the loop, surface as
    //                        softFailures in the response). Per-step
    //                        step.assertMode wins when set.
    stepTimeoutMs = 30000,
    defaultAssertMode = 'hard',
    // [ZAC-FIX 2026-05-24] Capture knobs — defaults match the
    // Settings → 📸 Capture defaults panel.
    //   captureFailureScreenshot: when true (default), the engine
    //     calls page.screenshot() after every failed step and
    //     persists the PNG under <rerunDir>/screenshots/. When false,
    //     the screenshot capture is skipped (faster reruns, no PNG).
    //   captureVideo: when true, the BrowserContext is created with
    //     recordVideo pointed at <rerunDir>/videos/. Off by default
    //     because video makes reruns ~2× slower.
    captureFailureScreenshot = true,
    captureVideo = false,
    // [ZAC-FIX 2026-05-24] Multi-scenario rerun. When provided, the
    // route iterates over each scenario.steps[] sequentially within
    // ONE browser session and reports per-scenario results. Lets QA
    // run the full Cucumber suite of a project (the "Add new scenario
    // after current steps" flow saves N scenarios; until now /api/rerun
    // could only execute one flat steps[] array per call). Each entry:
    //   { name?: string, tags?: string[], steps: Action[] }
    scenarios = null,
  } = req.body;

  if (Array.isArray(scenarios) && scenarios.length > 0) {
    return await executeMultiScenario(req, res, scenarios, browserType, baseUrl, headless, stopOnFailure, projectId, rerunFramework, rerunTestName, stepTimeoutMs, defaultAssertMode);
  }

  if (!steps || !Array.isArray(steps) || steps.length === 0) {
    throw new Error('No steps provided to execute');
  }

  // T2.6 — concurrency cap. Reject (429) when the active rerun count
  // already meets the limit. We compare to LIVE entries only, so a
  // stuck/cancelled run doesn't permanently steal a slot.
  const inFlight = rerunsCurrentlyRunning();
  if (inFlight >= MAX_CONCURRENT_RERUNS) {
    console.warn(`[Rerun] Rejected — ${inFlight}/${MAX_CONCURRENT_RERUNS} concurrent reruns already running`);
    return res.status(429).json({
      success: false,
      error: `Too many concurrent reruns (${inFlight}/${MAX_CONCURRENT_RERUNS}). Wait for one to finish or set ZAC_MAX_CONCURRENT_RERUNS to raise the cap.`,
      retryAfterSeconds: 10,
      inFlight,
      maxConcurrent: MAX_CONCURRENT_RERUNS,
    });
  }

  // If Scenario Outline is enabled and examples provided, execute for each example
  if (useScenarioOutline && examples && Array.isArray(examples) && examples.length > 0) {
    console.log(`[Rerun] Scenario Outline enabled with ${examples.length} examples`);
    // [ZAC-FIX] Pass framework + testName so the outline branch can also
    // persist replay-result.json + status.json under the canonical
    // generated-projects/<fw>/<projectId>/reruns/<test>/<ts>/ layout, so
    // the dashboard's Framework Projection panel sees data-driven runs.
    return await executeScenarioOutline(req, res, steps, browserType, baseUrl, headless, examples, stopOnFailure, projectId, rerunFramework, rerunTestName);
  }

  // Generate unique execution ID
  const executionId = `rerun_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  console.log(`[Rerun] Starting execution ${executionId} of ${steps.length} steps`);
  console.log(`[Rerun] Browser: ${browserType}, Base URL: ${baseUrl}, Headless: ${headless}, Stop on Failure: ${stopOnFailure}`);

  const startTime = Date.now();
  const results = [];
  let browser, context, page;

  // Store execution state for cancellation. [ZAC-FIX] include framework /
  // projectId / testName so /api/dashboard/live can light up the right
  // Framework Projection card while this rerun is in flight.
  const executionState = {
    cancelled: false, browser: null, context: null, page: null,
    framework: rerunFramework || null,
    projectId: projectId || null,
    testName:  rerunTestName || null,
    startedAt: new Date().toISOString(),
  };
  runningReruns.set(executionId, executionState);
  mostRecentExecutionId = executionId; // Track most recent execution

  // T2.9 — per-rerun in-memory log buffers. Persisted to
  // <rerunDir>/logs/{steps,console}.log inside the layout-persistence
  // block. Keep these as plain string arrays so writing is a single
  // .join('\n').
  const stepLogLines = [];
  const consoleLogLines = [];
  const stepLog = (msg) => stepLogLines.push(`[${new Date().toISOString()}] ${msg}`);
  stepLog(`Rerun ${executionId} starting — browser=${browserType} headless=${headless} steps=${steps.length}`);

  // T3.10 + T3.11 — Resolve the rerun scaffold UPFRONT (before browser
  // launch) when we have enough info, so we can hand Playwright the
  // exact `videos/` and `network/` paths it should write to. If the
  // call doesn't supply projectId+framework+testName we skip — the
  // existing post-execution persistence block then handles it.
  let preResolvedScaffold = null;
  if (projectId && rerunFramework && rerunTestName) {
    try {
      const layout = await import('../services/projectLayout.js');
      const validation = await layout.validateLayoutInputs({ framework: rerunFramework, projectName: projectId });
      if (validation.ok) {
        preResolvedScaffold = await layout.ensureRerunScaffold({
          framework: validation.framework,
          projectName: validation.projectName,
          testName: rerunTestName,
        });
      }
    } catch (e) {
      console.warn('[Rerun] could not pre-resolve scaffold for video/HAR (will fall back to post-resolve):', e.message);
    }
  }

  try {
    // Get browser launcher
    const { chromium, firefox, webkit } = await import('playwright');
    const browserLauncher = browserType === 'firefox' ? firefox : 
                           browserType === 'webkit' ? webkit : chromium;

    // Launch browser. Pass --start-maximized for Chromium/Edge in headed mode
    // so the rerun window matches the recorder's window size; otherwise
    // pages laid out for ≥1280-wide viewports break in the default 800x600.
    // Firefox/WebKit ignore the flag, so we omit it for them.
    browser = await browserLauncher.launch({
      headless: headless,
      args: buildRerunLaunchArgs(browserType, headless),
    });
    executionState.browser = browser;
    // [ZAC-FIX 2026-05-24] User-closed-browser detection — when the
    // user X's the rerun browser window, Playwright fires
    // 'disconnected'. Without this listener the rerun loop could
    // keep trying to drive a dead browser, throwing confusing errors
    // and leaking the executionState. Mark cancelled + drop from
    // runningReruns so /api/rerun/cancel returns "already completed"
    // gracefully and the next rerun gets a clean slate.
    browser.once('disconnected', () => {
      console.log(`[Rerun] 🔌 Browser disconnected externally — marking ${executionId} cancelled`);
      try { executionState.cancelled = true; } catch (_) {}
      try { runningReruns.delete(executionId); } catch (_) {}
      if (mostRecentExecutionId === executionId) mostRecentExecutionId = null;
    });

    // Detect screen size dynamically for proper fitting
    let screenSize = { width: 1920, height: 1080 }; // Default fallback
    
    if (!headless) {
      // Only detect screen size if not headless (headless doesn't need screen fitting)
      try {
        // Create a temporary context and page to get screen size
        const tempContext = await browser.newContext({ viewport: null });
        const tempPage = await tempContext.newPage();
        
        // Navigate to a blank page to ensure JavaScript can run
        await tempPage.goto('about:blank');
        
        // Get the actual available screen dimensions (accounts for taskbars, etc.)
        // Calculate viewport size that ensures the entire browser window fits on screen
        screenSize = await tempPage.evaluate(() => {
          // Get available screen space (excludes taskbar)
          const availWidth = window.screen.availWidth || window.screen.width || 1920;
          const availHeight = window.screen.availHeight || window.screen.height || 1080;
          
          // Browser chrome includes: title bar (~30px) + address bar (~40px) + tabs (~40px) + bookmarks bar (~30px if visible)
          // Total browser chrome: approximately 140-180px depending on browser and settings
          // Use a conservative estimate to ensure the full window fits on screen
          const browserChromeHeight = 180; // Conservative estimate for all browser UI elements
          const browserChromeWidth = 0; // Width is usually fine, but account for scrollbar if needed
          
          // Calculate viewport size that will make the total window fit on screen
          // Total window height = browser chrome + viewport height
          // So: viewport height = availHeight - browser chrome
          const viewportWidth = Math.max(800, availWidth - browserChromeWidth);
          const viewportHeight = Math.max(600, availHeight - browserChromeHeight);
          
          return {
            width: viewportWidth,
            height: viewportHeight
          };
        });
        
        // Close temporary page and context
        await tempPage.close();
        await tempContext.close();
        
        console.log(`[Rerun] Detected screen size: ${screenSize.width}x${screenSize.height}`);
      } catch (e) {
        console.log(`[Rerun] Could not detect screen size, using default: ${screenSize.width}x${screenSize.height}`);
      }
    }

    // T3.10 + T3.11 — When we know the scaffold, opt the context into
    //   videos      (recordVideo)        → reruns/<ts>/videos/*.webm
    //   HAR / net   (recordHar)          → reruns/<ts>/logs/network.har
    // Both are noop'd when scaffold is null (rerun without project layout).
    const ctxOptions = {
      viewport: { width: screenSize.width, height: screenSize.height },
    };
    let harPath = null;
    if (preResolvedScaffold) {
      // [ZAC-FIX 2026-05-24] recordVideo only when the user opts in
      // via Settings → 📸 Capture defaults (or per-rerun override).
      // Off by default — video makes reruns ~2× slower and consumes
      // significant disk space.
      if (captureVideo) {
        ctxOptions.recordVideo = {
          dir: preResolvedScaffold.videos,
          size: { width: Math.min(1280, screenSize.width), height: Math.min(720, screenSize.height) },
        };
      }
      harPath = path.join(preResolvedScaffold.logs, 'network.har');
      ctxOptions.recordHar = { path: harPath, mode: 'minimal' };
    }
    context = await browser.newContext(ctxOptions);
    executionState.context = context;
    // [ZAC-FIX 2026-05-24] Attach the rerun's screenshots directory to
    // the Playwright BrowserContext so the 'screenshot' step handler in
    // utils/stepHandlers.js routes captures into <rerunDir>/screenshots/
    // instead of the server CWD. Without this, screenshot files were
    // written to /Users/.../zerocodeautomation/<filename>.png and the
    // dashboard report's gallery showed an empty list.
    if (preResolvedScaffold) context.screenshotsDir = preResolvedScaffold.screenshots;

    page = await context.newPage();
    executionState.page = page;

    // T2.9 — capture browser console output to a per-rerun log file.
    // We hook ALL pages in the context (including new tabs / popups) by
    // attaching to context.on('page') and to the initial page directly.
    const wireConsoleCapture = (p) => {
      try {
        p.on('console', (msg) => {
          try {
            const t = msg.type ? msg.type() : 'log';
            const text = msg.text ? msg.text() : String(msg);
            consoleLogLines.push(`[${new Date().toISOString()}] [${t}] ${text}`);
          } catch (e) { /* swallow — diagnostic only */ }
        });
        p.on('pageerror', (err) => {
          consoleLogLines.push(`[${new Date().toISOString()}] [pageerror] ${err.message}`);
        });
      } catch (e) { /* attach failure — diagnostic only */ }
    };
    wireConsoleCapture(page);
    context.on('page', wireConsoleCapture);

    // Helper function to ensure page is available
    const ensurePage = async () => {
      // CRITICAL: Check cancellation BEFORE creating new page
      if (executionState.cancelled) {
        throw new Error('Execution cancelled - cannot create new page');
      }
      
      if (!page || page.isClosed()) {
        // Check cancellation again right before creating page
        if (executionState.cancelled) {
          throw new Error('Execution cancelled - cannot create new page');
        }
        
        console.log(`[Rerun] Page was closed, creating new page...`);
        page = await context.newPage();
        executionState.page = page;
      }
      return page;
    };

    // Import common step handlers + the persistence shim so we can write
    // healed locator events to projects/<id>/healed-locators.json.
    const { executePlaywrightStep } = await import('../utils/stepHandlers.js');
    const { saveHealedLocator } = await import('../utils/locatorHealer.js');

    // Track page count before each step to detect new tabs opened by previous steps
    let pageCountBeforeStep = context.pages().length;

    // Execute each step - ALWAYS continue through all steps (unless cancelled)
    for (let i = 0; i < steps.length; i++) {
      // Check for cancellation before each step (only check executionState, not req.aborted/destroyed)
      // req.aborted/destroyed can be unreliable in Express and cause false cancellations
      if (executionState.cancelled) {
        console.log(`[Rerun] Execution ${executionId} cancelled at step ${i + 1}/${steps.length}`);
        results.push({
          step: 'cancelled',
          success: false,
          error: 'Execution cancelled by user',
          duration: Date.now() - startTime
        });
        break;
      }

      const step = steps[i];
      const stepStartTime = Date.now();

      try {
        console.log(`[Rerun] [${i + 1}/${steps.length}] Executing: ${step.kind}${step.selector ? ` on ${step.selector}` : ''}`);

        // Check for cancellation again before executing step (only check executionState)
        if (executionState.cancelled) {
          console.log(`[Rerun] Execution ${executionId} cancelled during step ${i + 1}`);
          results.push({
            step: step.kind || 'unknown',
            success: false,
            error: 'Execution cancelled by user',
            duration: Date.now() - stepStartTime
          });
          break;
        }

        // Ensure page is available before each step (will throw if cancelled)
        await ensurePage();
        
        // Check cancellation after ensurePage (in case it was cancelled during page creation)
        if (executionState.cancelled) {
          console.log(`[Rerun] Execution ${executionId} cancelled after page creation`);
          results.push({
            step: step.kind || 'unknown',
            success: false,
            error: 'Execution cancelled by user',
            duration: Date.now() - stepStartTime
          });
          break;
        }

        // Track page count before this step to detect if a new tab was opened
        const pageCountBeforeThisStep = context.pages().length;
        
        // For close steps, check if a new tab was opened by previous step(s) BEFORE executing
        if (step.kind === 'close') {
          // Wait a bit to catch any asynchronous tab creation from previous steps
          await page.waitForTimeout(500);
          const currentPageCount = context.pages().length;
          
          if (currentPageCount > pageCountBeforeStep) {
            // A new tab was opened by a previous step - don't close
            console.log(`[Rerun] New tab detected (${pageCountBeforeStep} -> ${currentPageCount}), skipping close to preserve new tab`);
            pageCountBeforeStep = currentPageCount; // Update for potential next steps
            // Don't execute the close - skip it
            results.push({
              step: step.kind,
              success: true,
              skipped: true,
              reason: 'New tab detected, preserving page',
              duration: Date.now() - stepStartTime
            });
            console.log(`[Rerun] ✅ Step ${i + 1}/${steps.length} skipped (new tab detected)`);
            continue; // Skip to next step - don't execute the close
          }
          // No new tab detected - proceed with close execution below
        }
        
        // [ZAC-FIX] Per-step pre-wait knob — pause before executing this
        // step. Recorder can emit step.preWaitMs (e.g. for "click then wait
        // 2s before next click" sequences) without us having to add a
        // separate "wait" step type.
        if (Number.isFinite(Number(step.preWaitMs)) && Number(step.preWaitMs) > 0) {
          stepLog(`Step ${i + 1}: pre-wait ${step.preWaitMs}ms`);
          await page.waitForTimeout(Number(step.preWaitMs));
        }

        // [ZAC-FIX] Stuck-step guard — race the step against a timeout.
        // step.timeoutMs (per-step) wins over the run-level stepTimeoutMs.
        const effectiveTimeout = Number.isFinite(Number(step.timeoutMs)) && Number(step.timeoutMs) > 0
          ? Number(step.timeoutMs)
          : stepTimeoutMs;
        const stepLabel = `step ${i + 1} (${step.kind || 'unknown'})`;
        // Use common step handler - pass context for close step to check for new tabs
        const result = await runWithTimeout(
          executePlaywrightStep(page, step, context),
          effectiveTimeout,
          stepLabel
        );
        
        // Check cancellation after step execution (in case cancelled during long-running step)
        if (executionState.cancelled) {
          console.log(`[Rerun] Execution ${executionId} cancelled after step ${i + 1} execution`);
          results.push({
            step: step.kind || 'unknown',
            success: false,
            error: 'Execution cancelled by user',
            duration: Date.now() - stepStartTime
          });
          break;
        }
        
        // Check if a new tab was opened by this step (for non-close steps)
        // Wait a bit to catch asynchronous tab creation
        if (step.kind !== 'close') {
          await page.waitForTimeout(500);
          const pageCountAfterStep = context.pages().length;
          if (pageCountAfterStep > pageCountBeforeThisStep) {
            console.log(`[Rerun] Step ${i + 1} (${step.kind}) opened a new tab (${pageCountBeforeThisStep} -> ${pageCountAfterStep})`);
            pageCountBeforeStep = pageCountAfterStep; // Update for next step
          } else {
            pageCountBeforeStep = pageCountAfterStep; // Update for next step
          }
        }
        
        // Handle page close result
        if (step.kind === 'close' && result === null) {
          // Page was closed successfully
          page = null; // Mark as closed so next step will create new page
          executionState.page = null;
          pageCountBeforeStep = context.pages().length; // Update count after close
          console.log(`[Rerun] Page closed successfully`);
        }

        const stepDuration = Date.now() - stepStartTime;
        const stepResult = {
          step: step.kind,
          success: true,
          duration: stepDuration
        };
        // executePlaywrightStep returns { healed, primarySelector, healedVia, attempts }
        // when the live healer rescued the step from a stale primary locator.
        // Surface this so the UI can flag it (and so backtests can assert it).
        if (result && result.healed) {
          stepResult.healed = true;
          stepResult.primarySelector = result.primarySelector;
          stepResult.healedVia = result.healedVia;
          stepResult.healAttempts = result.attempts;
          // healer returns healingSource:'ai' when the local LLM provided
          // the rescue selector. Surface so the dashboard / report viewer
          // can render an "🤖 AI" pill instead of the regular 🩹 healing one.
          stepResult.rescuedBy = result.healingSource === 'ai' ? 'ai' : 'healer';
          const icon = stepResult.rescuedBy === 'ai' ? '🤖' : '🩹';
          console.log(`[Rerun] ${icon} Step ${i + 1} ${stepResult.rescuedBy}-rescued: "${result.primarySelector}" -> "${result.healedVia}"`);

          // Best-effort persistence — never block or fail the rerun if the
          // file write throws (disk full, permission, etc.). The healer
          // itself logs success/failure with the [Heal] tag.
          if (projectId) {
            try {
              const saved = await saveHealedLocator({
                projectName: projectId,
                pageName: step.normalizedPageName || null,
                elementName: step.normalizedDescription || step.kind,
                primarySelector: result.primarySelector,
                healedSelector: result.healedVia,
                reason: result.reason || 'primary not found',
                attempts: result.attempts,
              });
              if (saved.ok) stepResult.healSavedTo = saved.file;
            } catch (persistErr) {
              console.warn('[Rerun] saveHealedLocator threw (ignored):', persistErr.message);
            }
          }
        }
        // T2.7 — auto-screenshot on step failure. Buffered here so we can
        // write to disk later inside the layout-persistence block (the
        // rerun scaffold dir isn't resolved until then). Pass buffer +
        // suggested filename via the result object.
        // [ZAC-FIX 2026-05-24] Skip when captureFailureScreenshot=false.
        if (stepResult.success === false && page && captureFailureScreenshot) {
          try {
            const buf = await page.screenshot({ fullPage: false, timeout: 3000 });
            stepResult.screenshot = `step-${i + 1}-failed.png`;
            stepResult.screenshotBuffer = buf; // stripped from JSON later
          } catch (e) {
            console.warn(`[Rerun] auto-screenshot for failed step ${i + 1} failed: ${e.message}`);
          }
        }
        results.push(stepResult);

        // T2.9 — per-step text log entry.
        stepLog(`Step ${i + 1}/${steps.length} ${stepResult.success === false ? 'FAILED' : 'OK'} kind=${step.kind || '?'} duration=${stepDuration}ms${stepResult.healed ? ' (healed)' : ''}${stepResult.error ? ' err=' + String(stepResult.error).slice(0, 200) : ''}`);

        console.log(`[Rerun] ✅ Step ${i + 1}/${steps.length} completed in ${stepDuration}ms`);

      } catch (stepError) {
        const stepDuration = Date.now() - stepStartTime;

        // If error is due to cancellation, break immediately
        if (stepError.message.includes('cancelled') || executionState.cancelled) {
          console.log(`[Rerun] Execution ${executionId} cancelled during step ${i + 1} execution`);
          results.push({
            step: step.kind || 'unknown',
            success: false,
            error: 'Execution cancelled by user',
            duration: stepDuration
          });
          break; // Exit loop immediately
        }

        // [ZAC-FIX] Honour per-step assertion mode + identify timeout failures.
        const assertMode = String(step.assertMode || defaultAssertMode || 'hard').toLowerCase();
        const isSoft = assertMode === 'soft';
        const isTimeout = !!stepError.zacTimeout;
        const tag = isTimeout ? '⏰ TIMEOUT' : (isSoft ? '⚠️ SOFT-FAIL' : '❌ FAIL');
        console.error(`[Rerun] ${tag} Step ${i + 1}/${steps.length}:`, stepError.message);

        const failedRow = {
          step: step.kind || 'unknown',
          success: false,
          error: stepError.message,
          duration: stepDuration,
          // Surface so the dashboard / reports can render distinct icons.
          assertMode,
          softFailure: isSoft,
          timedOut: isTimeout,
          timeoutMs: isTimeout ? stepError.zacTimeoutMs : undefined,
        };
        // T2.7 — auto-screenshot on the throw path too. Honours the
        // per-rerun captureFailureScreenshot knob (Settings → 📸).
        if (page && captureFailureScreenshot) {
          try {
            const buf = await page.screenshot({ fullPage: false, timeout: 3000 });
            failedRow.screenshot = `step-${i + 1}-failed.png`;
            failedRow.screenshotBuffer = buf;
          } catch (e) { /* best-effort */ }
        }
        results.push(failedRow);
        // T2.9 — log the throw too, with the assert/timeout tag inline.
        stepLog(`Step ${i + 1}/${steps.length} ${tag} kind=${step.kind || '?'} duration=${stepDuration}ms mode=${assertMode}${isTimeout ? ' timeout=' + stepError.zacTimeoutMs + 'ms' : ''} err=${String(stepError.message).slice(0, 200)}`);

        // [ZAC-FIX] Soft assertions never break the loop — even when
        // stopOnFailure is on, the user explicitly tagged this step as
        // "best-effort". Hard assertions (or unset → defaults to hard)
        // honour stopOnFailure as before.
        if (!isSoft && stopOnFailure && !executionState.cancelled) {
          console.log(`[Rerun] Stop on failure enabled (hard assert) - stopping execution at step ${i + 1}`);
          break; // Exit loop immediately
        }

        // IMPORTANT: Continue to next step even if this one failed (unless cancelled or stopOnFailure)
        // This ensures ALL steps are attempted when stopOnFailure is false
        if (!executionState.cancelled) {
          console.log(`[Rerun] Continuing to next step despite failure...`);
        } else {
          // Cancelled during error handling, break immediately
          break;
        }
      }
    }

    const totalDuration = Date.now() - startTime;
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;
    // [ZAC-FIX] Counts soft-fail and timeout for the dashboard / report viewer.
    const softFailureCount = results.filter(r => r.softFailure).length;
    const timeoutCount     = results.filter(r => r.timedOut).length;
    const hardFailureCount = failureCount - softFailureCount;
    const wasCancelled = executionState.cancelled; // Only check explicit cancellation flag

    if (wasCancelled) {
      console.log(`[Rerun] Execution ${executionId} was cancelled: ${successCount} successful, ${failureCount} failed, ${totalDuration}ms total`);
    } else {
      console.log(`[Rerun] Execution ${executionId} completed: ${successCount} successful, ${failureCount} failed, ${totalDuration}ms total`);
    }

    // Persist the rerun status report under the framework-organized layout
    // when the caller supplied enough context (projectId + framework + testName).
    // Best-effort: write failures are logged but never abort the response.
    let rerunLayout = null;
    if (projectId && rerunFramework && rerunTestName) {
      try {
        const layout = await import('../services/projectLayout.js');
        const validation = await layout.validateLayoutInputs({
          framework: rerunFramework,
          projectName: projectId,
        });
        if (validation.ok) {
          // [ZAC-FIX 2026-05-24] When we pre-resolved a scaffold (so
          // Playwright could write video + HAR), reuse its timestamp.
          // Without this, a NEW timestamp dir was created here for
          // replay-result.json + report/, leaving the video stranded
          // in the OLD timestamp dir — splitting one rerun into two
          // sibling folders.
          const scaffold = await layout.ensureRerunScaffold({
            framework: validation.framework,
            projectName: validation.projectName,
            testName: rerunTestName,
            timestamp: preResolvedScaffold ? preResolvedScaffold.timestamp : undefined,
          });
          const fsp = await import('fs/promises');
          const statusPayload = {
            executionId,
            framework: scaffold.project.framework,
            projectName: scaffold.project.projectName,
            testName: scaffold.testName,
            timestamp: scaffold.timestamp,
            // T2.4 — record the browser actually used so the dashboard
            // can break stats down by browser. Was missing before, so
            // /api/dashboard/stats had no browser axis.
            browserType: browserType || 'chromium',
            headless: !!headless,
            cancelled: wasCancelled,
            success: failureCount === 0 && !wasCancelled,
            executedSteps: results.length,
            successCount,
            failureCount,
            durationMs: totalDuration,
            results,
            startedAt: new Date(startTime).toISOString(),
            completedAt: new Date().toISOString(),
          };
          await fsp.writeFile(
            path.join(scaffold.report, 'status.json'),
            JSON.stringify(statusPayload, null, 2),
            'utf8'
          );
          // Also drop replay-result.json at the rerun root so external tools
          // that scan `reruns/<test>/<ts>/replay-result.json` (the spec's
          // canonical location) find it without descending into report/.
          // Each row in `results` records the executed step under `r.step`
          // (the action kind, e.g. "scroll", "click"). Earlier this filter
          // accidentally read `r.kind`, which is never populated, so the
          // scroll counter always reported 0.
          const isScroll = (r) => r && (r.step === 'scroll' || r.kind === 'scroll');
          const replayPayload = {
            ...statusPayload,
            healingSummary: {
              healingEvents: results.filter((r) => r && r.healing).length,
              healedSteps: results.filter((r) => r && r.healing && r.healing.healed).length,
              exhausted: results.filter((r) => r && r.healing && r.healing.exhausted).length,
              // Split out AI-rescued vs deterministic-healer rescues so the
              // dashboard's Failure Insights tab can show the contribution
              // of the local LLM separately. Field is 0 when AI is off or
              // when no step needed an AI-suggested selector.
              aiRescues:     results.filter((r) => r && r.rescuedBy === 'ai').length,
              healerRescues: results.filter((r) => r && r.rescuedBy === 'healer').length,
            },
            scrollSummary: {
              scrollSteps: results.filter(isScroll).length,
              successfulScrolls: results.filter((r) => isScroll(r) && r.success).length,
            },
          };
          // T2.7 — write any auto-captured failure screenshots to
          // <rerunDir>/screenshots/<filename>, then strip the in-memory
          // Buffer from the JSON payload (Buffers don't serialize cleanly
          // and would bloat the JSON).
          for (const r of replayPayload.results || []) {
            if (r && r.screenshotBuffer && r.screenshot) {
              try {
                const shotPath = path.join(scaffold.screenshots, r.screenshot);
                await fsp.writeFile(shotPath, r.screenshotBuffer);
              } catch (e) {
                console.warn(`[Rerun] failed to persist screenshot ${r.screenshot}:`, e.message);
              }
              delete r.screenshotBuffer;
            }
          }
          // T2.9 — Write per-step text log + browser console log to
          // <rerunDir>/logs/. Both files are plain text so they're cheap
          // to grep through and don't need a viewer.
          stepLog(`Rerun ${executionId} finished — passed=${successCount} failed=${failureCount} duration=${totalDuration}ms`);
          try {
            await fsp.writeFile(path.join(scaffold.logs, 'steps.log'),    stepLogLines.join('\n')    + '\n', 'utf8');
            await fsp.writeFile(path.join(scaffold.logs, 'console.log'),  consoleLogLines.join('\n') + '\n', 'utf8');
          } catch (e) {
            console.warn('[Rerun] failed to write per-rerun logs:', e.message);
          }
          await fsp.writeFile(
            scaffold.replayResult,
            JSON.stringify(replayPayload, null, 2),
            'utf8'
          );
          // Persist the HTML report next to the JSON for portability.
          const htmlPath = await persistRerunHtmlReport({
            scaffold, replayPayload,
            framework: scaffold.project.framework,
            projectId: scaffold.project.projectName,
            testName: scaffold.testName,
          });
          rerunLayout = {
            framework: scaffold.project.framework,
            projectName: scaffold.project.projectName,
            testName: scaffold.testName,
            timestamp: scaffold.timestamp,
            rerunDir: scaffold.rerunDir,
            report: scaffold.report,
            replayResult: scaffold.replayResult,
            htmlReport: htmlPath,
          };
          console.log(`[Rerun] Persisted rerun report (status.json + replay-result.json + report/index.html) to ${scaffold.rerunDir}`);

          // Bump the live-counter exposed via /api/dashboard/live so any
          // open dashboard refreshes its stats within ~2s instead of
          // waiting for the 30s aggregate-poll interval. Uses the
          // pre-existing markRerunCompleted helper (don't re-roll).
          try {
            const { markRerunCompleted } = await import('../services/dashboardService.js');
            markRerunCompleted({
              executionId,
              framework: scaffold.project.framework,
              projectId: scaffold.project.projectName,
              testName: scaffold.testName,
              success: !(replayPayload.status === 'failed'),
            });
          } catch (_) { /* best-effort — never block on the marker */ }
        } else {
          console.log(`[Rerun] Skipping framework-organized rerun layout: ${validation.error}`);
        }
      } catch (layoutErr) {
        console.warn('[Rerun] Layout persistence failed (non-fatal):', layoutErr.message);
      }
    }

    // T4.1 — When the rerun ends with failures, attach an AI-or-
    // deterministic diagnosis for the FIRST failed step so the IDE can
    // surface it inline with the rerun result. Best-effort; never
    // changes the success/failure shape of the response.
    let firstFailureDiagnosis = null;
    if (failureCount > 0 && !wasCancelled) {
      const firstFail = results.find((r) => r && r.success === false && r.error);
      if (firstFail) {
        try {
          const { diagnoseError } = await import('../services/aiService.js');
          firstFailureDiagnosis = await diagnoseError({
            context: `executing step "${firstFail.step || 'unknown'}" in rerun ${executionId}`,
            error: firstFail.error,
            hint: firstFail.healed ? 'A healing attempt was made; the healer chain ran but ultimately failed.' : undefined,
          });
        } catch (_) { /* swallow — diagnosis is purely additive */ }
      }
    }

    // T4.2 — Mark when this rerun completed so the dashboard's live
    // poll can detect it and pull fresh stats immediately (without
    // waiting for the 30s aggregate tick). The marker lives in
    // dashboardService.markRerunCompleted, which is read by
    // collectLiveSnapshot and exposed at /api/dashboard/live.
    try {
      const { markRerunCompleted } = await import('../services/dashboardService.js');
      markRerunCompleted({
        executionId,
        framework: rerunFramework || null,
        projectId: projectId || null,
        testName: rerunTestName || null,
        success: failureCount === 0 && !wasCancelled,
      });
    } catch (_) { /* best-effort */ }

    // [ZAC-FIX] When every failure is soft, the run as a whole still
    // *passes* — soft assertions are explicit "best-effort" markers and
    // shouldn't flip the run red. Hard failures + timeouts + cancellation
    // still mark the run as failed.
    const overallPassed = (hardFailureCount === 0) && !wasCancelled;
    res.json({
      // [ZAC-FIX 2026-05-24] Normalised response shape — every rerun
      // branch (plain / Outline / multi-scenario) now returns the same
      // top-level fields: executionId + rerunLayout. The legacy
      // `layout` alias is kept for one cycle so existing clients don't
      // break, but new code should read `rerunLayout`.
      success: overallPassed,
      cancelled: wasCancelled,
      executionId,
      executedSteps: results.length,
      successCount: successCount,
      failureCount: failureCount,
      hardFailureCount,
      softFailureCount,
      timeoutCount,
      duration: `${(totalDuration / 1000).toFixed(2)}s`,
      results: results,
      rerunLayout: rerunLayout || null,
      ...(rerunLayout ? { layout: rerunLayout } : {}),  // legacy alias
      ...(firstFailureDiagnosis ? { aiDiagnosis: firstFailureDiagnosis } : {}),
    });

  } catch (error) {
    console.error(`[Rerun] Execution error:`, error);
    throw new Error(`Failed to execute script: ${error.message}`);
  } finally {
    // Cleanup
    try {
      if (page && !page.isClosed()) await page.close();
      if (context) await context.close();
      if (browser) await browser.close();
    } catch (cleanupError) {
      console.warn('[Rerun] Cleanup error:', cleanupError);
    }
    
    // Remove from running executions
    runningReruns.delete(executionId);
    
    // Clear most recent execution if it was this one
    if (mostRecentExecutionId === executionId) {
      mostRecentExecutionId = null;
    }
  }
}));

// Execute Scenario Outline - runs scenario multiple times with different data
// [ZAC-FIX 2026-05-24] Multi-scenario rerun. Iterates through every
// scenario inside the same browser session and aggregates results into
// one replay-result.json so the dashboard sees a single rerun event
// with N nested scenarios — exactly how Cucumber would report a
// suite-level run.
//
// Why one browser per call (not per scenario): scenarios in the same
// project usually share state (cookies, login). Keeping the same
// context mirrors what `mvn test` does when scenarios live in one
// Feature file. If a future use case wants isolation, a new
// `scenarioIsolation: true` flag can drop+recreate the context per
// scenario without touching this branch.
async function executeMultiScenario(req, res, scenarios, browserType, baseUrl, headless, stopOnFailure, projectId, framework, testName, stepTimeoutMs, defaultAssertMode) {
  const executionId = `rerun_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  console.log(`[Rerun] Multi-scenario execution ${executionId} — ${scenarios.length} scenario(s)`);

  const startTime = Date.now();
  let browser, context, page;
  const allScenarioResults = [];
  const flatStepResults = []; // stays compatible with replay-result.json shape

  const executionState = {
    cancelled: false, browser: null, context: null, page: null,
    framework: framework || null,
    projectId: projectId || null,
    testName: testName || 'multi-scenario',
    startedAt: new Date(startTime).toISOString(),
  };
  runningReruns.set(executionId, executionState);
  mostRecentExecutionId = executionId;

  try {
    const { chromium, firefox, webkit } = await import('playwright');
    const launcher = browserType === 'firefox' ? firefox : browserType === 'webkit' ? webkit : chromium;
    browser = await launcher.launch({ headless, args: buildRerunLaunchArgs(browserType, headless) });
    executionState.browser = browser;
    // [ZAC-FIX 2026-05-24] Same external-close detection as the plain
    // rerun branch — if the user X's the multi-scenario browser, drop
    // the executionState so cancel/status return cleanly.
    browser.once('disconnected', () => {
      console.log(`[Rerun] 🔌 Multi-scenario browser disconnected externally — marking ${executionId} cancelled`);
      try { executionState.cancelled = true; } catch (_) {}
      try { runningReruns.delete(executionId); } catch (_) {}
      if (mostRecentExecutionId === executionId) mostRecentExecutionId = null;
    });
    context = await browser.newContext();
    executionState.context = context;
    page = await context.newPage();
    executionState.page = page;

    const { executePlaywrightStep } = await import('../utils/stepHandlers.js');

    for (let scIdx = 0; scIdx < scenarios.length; scIdx++) {
      if (executionState.cancelled) break;
      const sc = scenarios[scIdx] || {};
      const scenarioName = sc.name || sc.title || `Scenario ${scIdx + 1}`;
      const scenarioSteps = Array.isArray(sc.steps) ? sc.steps : [];
      const scenarioTags  = Array.isArray(sc.tags)  ? sc.tags  : [];
      console.log(`[Rerun] ── Scenario ${scIdx + 1}/${scenarios.length}: "${scenarioName}" (${scenarioSteps.length} steps)`);

      const scenarioStart = Date.now();
      const scenarioStepResults = [];
      let scenarioFailed = false;

      for (let i = 0; i < scenarioSteps.length; i++) {
        if (executionState.cancelled) break;
        const step = scenarioSteps[i];
        const stepStart = Date.now();
        try {
          if (!page || page.isClosed()) {
            page = await context.newPage();
            executionState.page = page;
          }
          const result = await executePlaywrightStep(page, step, context);
          if (step.kind === 'close' && result === null) {
            page = null;
            executionState.page = null;
          }
          const row = {
            scenario: scenarioName,
            scenarioIndex: scIdx,
            step: step.kind,
            success: true,
            duration: Date.now() - stepStart,
          };
          if (result && typeof result === 'object' && result.healing) {
            row.healing = result.healing;
            if (result.rescuedBy) row.rescuedBy = result.rescuedBy;
          }
          scenarioStepResults.push(row);
          flatStepResults.push(row);
        } catch (err) {
          scenarioFailed = true;
          const row = {
            scenario: scenarioName,
            scenarioIndex: scIdx,
            step: step.kind,
            success: false,
            duration: Date.now() - stepStart,
            error: err && err.message ? err.message : String(err),
          };
          scenarioStepResults.push(row);
          flatStepResults.push(row);
          if (stopOnFailure) break;
        }
      }

      allScenarioResults.push({
        name: scenarioName,
        tags: scenarioTags,
        success: !scenarioFailed && !executionState.cancelled,
        durationMs: Date.now() - scenarioStart,
        executedSteps: scenarioStepResults.length,
        successCount: scenarioStepResults.filter(r => r.success).length,
        failureCount: scenarioStepResults.filter(r => !r.success).length,
        steps: scenarioStepResults,
      });

      if (scenarioFailed && stopOnFailure) {
        console.log(`[Rerun] stopOnFailure — aborting after scenario "${scenarioName}"`);
        break;
      }
    }

    const totalDuration = Date.now() - startTime;
    const successCount = flatStepResults.filter(r => r.success).length;
    const failureCount = flatStepResults.filter(r => !r.success).length;
    const passedScenarios = allScenarioResults.filter(s => s.success).length;
    const failedScenarios = allScenarioResults.filter(s => !s.success).length;

    // Persist to disk (same canonical layout as the single-scenario
    // and Outline branches so /api/dashboard/* sees it identically).
    let rerunLayout = null;
    if (projectId && framework && testName) {
      try {
        const fsp = await import('fs/promises');
        const layout = await import('../services/projectLayout.js');
        const validation = await layout.validateLayoutInputs({ framework, projectName: projectId });
        if (validation.ok) {
          const scaffold = await layout.ensureRerunScaffold({
            framework: validation.framework,
            projectName: validation.projectName,
            testName,
          });
          const replayPayload = {
            executionId, projectId, framework, testName,
            multiScenario: true,
            totalScenarios: allScenarioResults.length,
            passedScenarios,
            failedScenarios,
            success: failedScenarios === 0 && !executionState.cancelled,
            cancelled: executionState.cancelled,
            executedSteps: flatStepResults.length,
            successCount, failureCount,
            durationMs: totalDuration,
            startedAt: new Date(startTime).toISOString(),
            completedAt: new Date().toISOString(),
            results: flatStepResults,
            scenarioResults: allScenarioResults,
            healingSummary: {
              healingEvents:  flatStepResults.filter(s => s.healing).length,
              healedSteps:    flatStepResults.filter(s => s.healing && s.healing.healed).length,
              exhausted:      flatStepResults.filter(s => s.healing && s.healing.exhausted).length,
              aiRescues:      flatStepResults.filter(s => s.rescuedBy === 'ai').length,
              healerRescues:  flatStepResults.filter(s => s.rescuedBy === 'healer').length,
            },
            scrollSummary: { scrollSteps: 0, successfulScrolls: 0 },
          };
          await fsp.writeFile(scaffold.replayResult, JSON.stringify(replayPayload, null, 2), 'utf8');
          await fsp.writeFile(path.join(scaffold.report, 'status.json'),
            JSON.stringify(replayPayload, null, 2), 'utf8');
          const htmlPathMulti = await persistRerunHtmlReport({
            scaffold, replayPayload,
            framework: scaffold.project.framework,
            projectId: scaffold.project.projectName,
            testName: scaffold.testName,
          });
          rerunLayout = {
            framework: scaffold.project.framework,
            projectName: scaffold.project.projectName,
            testName: scaffold.testName,
            timestamp: scaffold.timestamp,
            rerunDir: scaffold.rerunDir,
            report: scaffold.report,
            replayResult: scaffold.replayResult,
            htmlReport: htmlPathMulti,
          };
          try {
            const { markRerunCompleted } = await import('../services/dashboardService.js');
            markRerunCompleted({
              executionId, framework, projectId, testName,
              success: failedScenarios === 0 && !executionState.cancelled,
            });
          } catch (_) { /* best effort */ }
        }
      } catch (e) {
        console.warn('[Rerun] Multi-scenario persistence failed (non-fatal):', e.message);
      }
    }

    res.json({
      success: failedScenarios === 0 && !executionState.cancelled,
      cancelled: executionState.cancelled,
      executionId,
      multiScenario: true,
      totalScenarios: allScenarioResults.length,
      passedScenarios, failedScenarios,
      executedSteps: flatStepResults.length,
      successCount, failureCount,
      duration: `${(totalDuration / 1000).toFixed(2)}s`,
      scenarioResults: allScenarioResults,
      results: flatStepResults,
      rerunLayout,
    });
  } catch (error) {
    console.error('[Rerun] Multi-scenario execution error:', error);
    throw new Error(`Failed to execute multi-scenario rerun: ${error.message}`);
  } finally {
    try {
      if (page && !page.isClosed()) await page.close();
      if (context) await context.close();
      if (browser) await browser.close();
    } catch (cleanupError) {
      console.warn('[Rerun] Cleanup error:', cleanupError.message);
    }
    runningReruns.delete(executionId);
    if (mostRecentExecutionId === executionId) mostRecentExecutionId = null;
  }
}

async function executeScenarioOutline(req, res, steps, browserType, baseUrl, headless, examples, stopOnFailure = false, projectId = null, framework = null, testName = null) {
  const executionId = `rerun_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  console.log(`[Rerun] Starting Scenario Outline execution ${executionId} with ${examples.length} examples`);
  
  const startTime = Date.now();
  const allResults = [];
  let browser, context, page;
  
  // Store execution state for cancellation. [ZAC-FIX] now also carries the
  // framework + testName so the persistence block below can drop a
  // replay-result.json that the dashboard / Framework Projection actually
  // sees (previously Outline runs were invisible on /api/dashboard/stats).
  const executionState = {
    cancelled: false, browser: null, context: null, page: null,
    framework: framework || null,
    projectId: projectId || null,
    testName: testName || 'scenario-outline',
    startedAt: new Date().toISOString(),
  };
  runningReruns.set(executionId, executionState);
  mostRecentExecutionId = executionId;
  
  try {
    // Get browser launcher
    const { chromium, firefox, webkit } = await import('playwright');
    const browserLauncher = browserType === 'firefox' ? firefox : 
                           browserType === 'webkit' ? webkit : chromium;

    // Launch browser once for all examples. Same maximization rules as
    // /api/rerun: Chromium/Edge headed → --start-maximized; others omit it.
    browser = await browserLauncher.launch({
      headless: headless,
      args: buildRerunLaunchArgs(browserType, headless),
    });
    executionState.browser = browser;
    // [ZAC-FIX 2026-05-24] External-close detection for Scenario Outline
    // execution — same shape as the plain rerun branch.
    browser.once('disconnected', () => {
      console.log(`[Rerun] 🔌 Outline browser disconnected externally — marking ${executionId} cancelled`);
      try { executionState.cancelled = true; } catch (_) {}
      try { runningReruns.delete(executionId); } catch (_) {}
      if (mostRecentExecutionId === executionId) mostRecentExecutionId = null;
    });

    if (executionState.cancelled) {
      throw new Error('Execution cancelled after browser launch');
    }

    // Detect screen size dynamically
    let screenSize = { width: 1920, height: 1080 };
    if (!headless) {
      try {
        const tempContext = await browser.newContext({ viewport: null });
        const tempPage = await tempContext.newPage();
        await tempPage.goto('about:blank');
        screenSize = await tempPage.evaluate(() => {
          const availWidth = window.screen.availWidth || window.screen.width || 1920;
          const availHeight = window.screen.availHeight || window.screen.height || 1080;
          const browserChromeHeight = 180;
          return {
            width: Math.max(800, availWidth),
            height: Math.max(600, availHeight - browserChromeHeight)
          };
        });
        await tempPage.close();
        await tempContext.close();
      } catch (e) {
        console.log(`[Rerun] Could not detect screen size, using default`);
      }
    }

    context = await browser.newContext({
      viewport: { width: screenSize.width, height: screenSize.height }
    });
    executionState.context = context;

    // Import step handler + healed-locator persistence shim
    const { executePlaywrightStep } = await import('../utils/stepHandlers.js');
    const { saveHealedLocator } = await import('../utils/locatorHealer.js');
    
    // Execute scenario for each example
    for (let exampleIndex = 0; exampleIndex < examples.length; exampleIndex++) {
      if (executionState.cancelled) {
        console.log(`[Rerun] Execution ${executionId} cancelled at example ${exampleIndex + 1}/${examples.length}`);
        break;
      }
      
      const example = examples[exampleIndex];
      console.log(`[Rerun] Executing example ${exampleIndex + 1}/${examples.length}:`, example);
      
      // Create new page for each example
      page = await context.newPage();
      executionState.page = page;
      
      const exampleResults = {
        exampleIndex: exampleIndex + 1,
        example: example,
        steps: [],
        success: true
      };
      
      // Replace placeholders in steps with example values
      const stepsWithValues = steps.map(step => {
        const stepCopy = JSON.parse(JSON.stringify(step)); // Deep copy
        
        // For each key in the example, replace matching values in the step
        for (const key in example) {
          const exampleValue = example[key];
          
          // Replace in value field (for type, select, etc.)
          if (stepCopy.value !== undefined && stepCopy.value !== null) {
            if (typeof stepCopy.value === 'string') {
              // Replace placeholder format <key>
              if (stepCopy.value.includes(`<${key}>`)) {
                stepCopy.value = stepCopy.value.replace(new RegExp(`<${key}>`, 'g'), exampleValue);
              }
              // If the step kind uses value and we have a matching key, replace it
              // This handles cases where the recorded value should be replaced with example data
              // For type steps, if the key matches the field name, replace the value
              if (stepCopy.kind === 'type' && key === 'value') {
                stepCopy.value = exampleValue;
              }
            }
          }
          
          // Replace in selector field if it contains placeholder
          if (stepCopy.selector && typeof stepCopy.selector === 'string') {
            if (stepCopy.selector.includes(`<${key}>`)) {
              stepCopy.selector = stepCopy.selector.replace(new RegExp(`<${key}>`, 'g'), exampleValue);
            }
          }
          
          // Replace in expectedValue field (for assertions)
          if (stepCopy.expectedValue !== undefined && stepCopy.expectedValue !== null) {
            if (typeof stepCopy.expectedValue === 'string') {
              if (stepCopy.expectedValue.includes(`<${key}>`)) {
                stepCopy.expectedValue = stepCopy.expectedValue.replace(new RegExp(`<${key}>`, 'g'), exampleValue);
              }
              // If expectedValue matches a key name, use the example value
              if (stepCopy.expectedValue === key) {
                stepCopy.expectedValue = exampleValue;
              }
            }
          }
          
          // Replace in text field (for assertions)
          if (stepCopy.text && typeof stepCopy.text === 'string') {
            if (stepCopy.text.includes(`<${key}>`)) {
              stepCopy.text = stepCopy.text.replace(new RegExp(`<${key}>`, 'g'), exampleValue);
            }
          }
          
          // Replace in url field (for navigate)
          if (stepCopy.url && typeof stepCopy.url === 'string') {
            if (stepCopy.url.includes(`<${key}>`)) {
              stepCopy.url = stepCopy.url.replace(new RegExp(`<${key}>`, 'g'), exampleValue);
            }
          }
        }
        
        // Special handling: If step has a 'value' field and examples have a 'value' key,
        // replace the step's value with the example's value (for type steps)
        if (stepCopy.kind === 'type' && example.value !== undefined && stepCopy.value !== undefined) {
          stepCopy.value = example.value;
        }
        
        // Special handling: If step has a 'selectedText' or 'value' for select steps
        if (stepCopy.kind === 'select' && example.value !== undefined) {
          if (stepCopy.selectedText !== undefined) {
            stepCopy.selectedText = example.value;
          }
          if (stepCopy.value !== undefined) {
            stepCopy.value = example.value;
          }
        }
        
        return stepCopy;
      });
      
      // Execute steps for this example
      for (let i = 0; i < stepsWithValues.length; i++) {
        if (executionState.cancelled) {
          break;
        }
        
        const step = stepsWithValues[i];
        const stepStartTime = Date.now();
        
        try {
          if (!page || page.isClosed()) {
            page = await context.newPage();
            executionState.page = page;
          }
          
          // Use common step handler - pass context for close step to check for new tabs
          const result = await executePlaywrightStep(page, step, context);
          
          // Handle page close - if handler returns null, page was closed
          if (step.kind === 'close') {
            if (result === null) {
              // Page was closed
              page = null;
              executionState.page = null;
              console.log(`[Rerun] Page closed successfully in Scenario Outline`);
            } else {
              // Page close was skipped (new tab detected or other pages exist)
              console.log(`[Rerun] Page close skipped in Scenario Outline - preserving page due to new tab or other pages`);
            }
          }
          
          const outlineStepResult = {
            step: step.kind,
            success: true,
            duration: Date.now() - stepStartTime
          };
          // Forward heal info from executePlaywrightStep so Scenario Outline
          // reruns also surface "🩹 healed via …" in the UI, and persist the
          // mapping when projectId is known.
          if (result && result.healed) {
            outlineStepResult.healed = true;
            outlineStepResult.primarySelector = result.primarySelector;
            outlineStepResult.healedVia = result.healedVia;
            outlineStepResult.healAttempts = result.attempts;
            console.log(`[Rerun][Outline] 🩹 Step ${i + 1} healed: "${result.primarySelector}" -> "${result.healedVia}"`);
            if (projectId) {
              try {
                const saved = await saveHealedLocator({
                  projectName: projectId,
                  pageName: step.normalizedPageName || null,
                  elementName: step.normalizedDescription || step.kind,
                  primarySelector: result.primarySelector,
                  healedSelector: result.healedVia,
                  reason: result.reason || 'primary not found',
                  attempts: result.attempts,
                });
                if (saved.ok) outlineStepResult.healSavedTo = saved.file;
              } catch (persistErr) {
                console.warn('[Rerun][Outline] saveHealedLocator threw (ignored):', persistErr.message);
              }
            }
          }
          exampleResults.steps.push(outlineStepResult);
        } catch (stepError) {
          exampleResults.success = false;
          exampleResults.steps.push({
            step: step.kind || 'unknown',
            success: false,
            error: stepError.message,
            duration: Date.now() - stepStartTime
          });
          
          // If stopOnFailure is enabled, break immediately on failure (unless cancelled)
          if (stopOnFailure && !executionState.cancelled) {
            console.log(`[Rerun] Stop on failure enabled - stopping execution at step ${i + 1} in example ${exampleIndex + 1}`);
            break; // Exit step loop immediately
          }
          
          if (!executionState.cancelled) {
            console.log(`[Rerun] Continuing to next step despite failure...`);
          }
        }
      }
      
      // Close page after each example
      if (page && !page.isClosed()) {
        await page.close();
      }
      page = null;
      
      allResults.push(exampleResults);
    }
    
    const totalDuration = Date.now() - startTime;
    const successCount = allResults.filter(r => r.success).length;
    const failureCount = allResults.filter(r => !r.success).length;

    // [ZAC-FIX] Persist Scenario Outline results to disk so dashboards
    // and report viewers see them. Mirrors the non-outline branch
    // (uses validateLayoutInputs + ensureRerunScaffold).
    let rerunLayout = null;
    if (projectId && framework && testName) {
      try {
        const fsp = await import('fs/promises');
        const layout = await import('../services/projectLayout.js');
        const validation = await layout.validateLayoutInputs({ framework, projectName: projectId });
        if (validation.ok) {
          const scaffold = await layout.ensureRerunScaffold({
            framework: validation.framework,
            projectName: validation.projectName,
            testName,
          });
          const stepRows = [];
          for (const er of allResults) {
            (er.steps || []).forEach((s) => stepRows.push({
              step: s.step, success: s.success !== false,
              duration: s.duration, error: s.error,
              healing: s.healing, rescuedBy: s.rescuedBy,
            }));
          }
          const replayPayload = {
            executionId, projectId, framework, testName,
            scenarioOutline: true,
            totalExamples: examples.length,
            executedExamples: allResults.length,
            success: failureCount === 0 && !executionState.cancelled,
            cancelled: executionState.cancelled,
            executedSteps: stepRows.length,
            successCount: stepRows.filter(s => s.success).length,
            failureCount: stepRows.filter(s => !s.success).length,
            durationMs: totalDuration,
            startedAt: new Date(startTime).toISOString(),
            completedAt: new Date().toISOString(),
            results: stepRows,
            exampleResults: allResults,
            healingSummary: {
              healingEvents:  stepRows.filter(s => s.healing).length,
              healedSteps:    stepRows.filter(s => s.healing && s.healing.healed).length,
              exhausted:      stepRows.filter(s => s.healing && s.healing.exhausted).length,
              aiRescues:      stepRows.filter(s => s.rescuedBy === 'ai').length,
              healerRescues:  stepRows.filter(s => s.rescuedBy === 'healer').length,
            },
            scrollSummary: { scrollSteps: 0, successfulScrolls: 0 },
          };
          await fsp.writeFile(scaffold.replayResult, JSON.stringify(replayPayload, null, 2), 'utf8');
          await fsp.writeFile(path.join(scaffold.report, 'status.json'),
            JSON.stringify({ ...replayPayload, scenarioOutline: true }, null, 2), 'utf8');
          const htmlPathOutline = await persistRerunHtmlReport({
            scaffold, replayPayload: { ...replayPayload, scenarioOutline: true },
            framework: scaffold.project.framework,
            projectId: scaffold.project.projectName,
            testName: scaffold.testName,
          });
          rerunLayout = {
            framework: scaffold.project.framework,
            projectName: scaffold.project.projectName,
            testName: scaffold.testName,
            timestamp: scaffold.timestamp,
            rerunDir: scaffold.rerunDir,
            report: scaffold.report,
            replayResult: scaffold.replayResult,
            htmlReport: htmlPathOutline,
          };
          console.log(`[Rerun] Persisted Scenario Outline rerun (status.json + replay-result.json + report/index.html) to ${scaffold.rerunDir}`);
          try {
            const { markRerunCompleted } = await import('../services/dashboardService.js');
            markRerunCompleted({
              executionId, framework, projectId, testName,
              success: failureCount === 0 && !executionState.cancelled,
            });
          } catch (_) { /* best effort */ }
        }
      } catch (e) {
        console.warn('[Rerun] Outline persistence failed (non-fatal):', e.message);
      }
    }
    
    res.json({
      success: failureCount === 0 && !executionState.cancelled,
      cancelled: executionState.cancelled,
      executionId: executionId,
      scenarioOutline: true,
      totalExamples: examples.length,
      executedExamples: allResults.length,
      successCount: successCount,
      failureCount: failureCount,
      duration: `${(totalDuration / 1000).toFixed(2)}s`,
      results: allResults,
      rerunLayout,
    });
    
  } catch (error) {
    console.error(`[Rerun] Scenario Outline execution error:`, error);
    throw new Error(`Failed to execute scenario outline: ${error.message}`);
  } finally {
    // Cleanup
    try {
      if (page && !page.isClosed()) await page.close();
      if (context) await context.close();
      if (browser) await browser.close();
    } catch (cleanupError) {
      console.warn('[Rerun] Cleanup error:', cleanupError);
    }
    
    runningReruns.delete(executionId);
    if (mostRecentExecutionId === executionId) {
      mostRecentExecutionId = null;
    }
  }
}

// Cancel running rerun execution
router.post('/rerun/cancel', generalRateLimiter, asyncHandler(async (req, res) => {
  const { executionId } = req.body;

  // If no executionId provided, cancel the most recent execution
  const targetExecutionId = executionId || mostRecentExecutionId;

  if (!targetExecutionId) {
    return res.json({
      success: false,
      message: 'No execution to cancel'
    });
  }

  const executionState = runningReruns.get(targetExecutionId);
  
  if (!executionState) {
    return res.json({
      success: false,
      message: 'Execution not found or already completed'
    });
  }

  console.log(`[Rerun] Cancelling execution ${targetExecutionId}`);
  
  // Mark as cancelled
  executionState.cancelled = true;

  // Cleanup browser resources
  try {
    if (executionState.page && !executionState.page.isClosed()) {
      await executionState.page.close();
    }
    if (executionState.context) {
      await executionState.context.close();
    }
    if (executionState.browser) {
      await executionState.browser.close();
    }
  } catch (cleanupError) {
    console.warn('[Rerun] Cleanup error during cancellation:', cleanupError);
  }

  // Remove from running executions
  runningReruns.delete(targetExecutionId);
  
  // Clear most recent execution if it was the one cancelled
  if (mostRecentExecutionId === targetExecutionId) {
    mostRecentExecutionId = null;
  }

  res.json({
    success: true,
    message: 'Execution cancelled successfully',
    executionId: targetExecutionId
  });
}));

// Test Runner - Execute Gherkin feature files through step definitions
router.post('/test-runner/run', generalRateLimiter, asyncHandler(async (req, res) => {
  const { projectName, projectId, framework = 'playwright-java', browserType = 'chromium' } = req.body;

  if (!projectName && !projectId) {
    throw new Error('Project name or project ID is required');
  }

  // Try to find project directory
  let projectDir = null;
  
  // First, try using projectId if provided
  if (projectId) {
    try {
      projectDir = projectService.getProjectDir(projectId);
      if (!fs.existsSync(projectDir)) {
        projectDir = null;
      }
    } catch (e) {
      console.warn(`[Test Runner] Could not get project dir for ID ${projectId}:`, e.message);
    }
  }
  
  // If not found, try using projectName
  if (!projectDir && projectName) {
    // Try to find project by name
    try {
      const projects = await projectService.listProjects();
      const project = projects.find(p => p.name === projectName || p.id === projectName);
      if (project) {
        projectDir = projectService.getProjectDir(project.id);
      } else {
        // Fallback: try direct path
        const projectsDir = path.join(__dirname, '..', 'projects');
        const directPath = path.join(projectsDir, projectName);
        if (fs.existsSync(directPath)) {
          projectDir = directPath;
        }
      }
    } catch (e) {
      console.warn(`[Test Runner] Could not find project by name ${projectName}:`, e.message);
    }
  }

  if (!projectDir || !fs.existsSync(projectDir)) {
    throw new Error(`Project directory not found: ${projectName || projectId}. Please generate/export the project first.`);
  }

  console.log(`[Test Runner] Running tests for project: ${projectName}, framework: ${framework}`);

  // Set up streaming response
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendChunk = (data) => {
    res.write(data + '\n');
  };

  try {
    if (framework === 'playwright-java' || framework === 'selenium-java') {
      // Check if Maven is installed before attempting to run tests
      sendChunk(`[Test Runner] Checking Maven installation...`);
      const mavenCheck = await mavenService.checkMavenInstalled();
      
      if (!mavenCheck.installed) {
        const errorMsg = `Maven is not installed or not found in PATH.\n\nPlease install Maven to run Java tests:\n- Windows: Download from https://maven.apache.org/download.cgi or use chocolatey: choco install maven\n- macOS: brew install maven\n- Linux: sudo apt-get install maven (Ubuntu/Debian) or sudo yum install maven (RHEL/CentOS)\n\nAfter installation, ensure Maven is added to your system PATH and restart the application.`;
        sendChunk(`\n[Test Runner] ❌ ${errorMsg}`);
        res.write(JSON.stringify({ success: false, error: errorMsg }) + '\n');
        res.end();
        return;
      }

      sendChunk(`[Test Runner] Maven ${mavenCheck.version || 'found'} detected ✓`);
      sendChunk(`[Test Runner] Running Maven tests for ${framework}...`);
      sendChunk(`[Test Runner] Project directory: ${projectDir}`);
      
      // Handle cancellation - find running command by projectDir
      req.on('close', () => {
        const runningCommands = mavenService.getRunningCommands();
        const runningCommand = runningCommands.find(cmd => cmd.projectDir === projectDir);
        if (runningCommand) {
          mavenService.cancelCommand(runningCommand.executionId).then(() => {
            sendChunk('\n[Test Runner] ⏹️ Test execution cancelled');
          }).catch(() => {
            // Ignore cancellation errors
          });
        }
      });
      
      // Use mavenService to execute the command for better error handling
      try {
        const result = await mavenService.executeMavenCommand(
          projectDir, 
          'test', 
          ['clean'], 
          { 
            timeout: 300000,
            onOutput: (line, type) => {
              sendChunk(line);
            }
          }
        );
        
        if (result.success) {
          sendChunk('\n[Test Runner] ✅ Tests completed successfully!');
          res.write(JSON.stringify({ success: true, exitCode: 0, duration: result.duration }) + '\n');
        } else {
          sendChunk(`\n[Test Runner] ❌ Tests failed with exit code: ${result.exitCode}`);
          res.write(JSON.stringify({ success: false, exitCode: result.exitCode, duration: result.duration }) + '\n');
        }
        res.end();
      } catch (mavenError) {
        sendChunk(`\n[Test Runner] ❌ Error running tests: ${mavenError.message}`);
        res.write(JSON.stringify({ success: false, error: mavenError.message }) + '\n');
        res.end();
      }
      return;

    } else if (framework === 'playwright-ts' || framework === 'playwright-typescript') {
      // Run npm test
      sendChunk(`[Test Runner] Running npm tests for ${framework}...`);
      sendChunk(`[Test Runner] Project directory: ${projectDir}`);
      
      const { spawn } = await import('child_process');
      const npmProcess = spawn('npm', ['test'], {
        cwd: projectDir,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      npmProcess.stdout.on('data', (data) => {
        sendChunk(data.toString());
      });

      npmProcess.stderr.on('data', (data) => {
        sendChunk(data.toString());
      });

      npmProcess.on('close', (code) => {
        if (code === 0) {
          sendChunk('\n[Test Runner] ✅ Tests completed successfully!');
          res.write(JSON.stringify({ success: true, exitCode: code }) + '\n');
        } else {
          sendChunk(`\n[Test Runner] ❌ Tests failed with exit code: ${code}`);
          res.write(JSON.stringify({ success: false, exitCode: code }) + '\n');
        }
        res.end();
      });

      npmProcess.on('error', (error) => {
        sendChunk(`\n[Test Runner] ❌ Error running tests: ${error.message}`);
        res.write(JSON.stringify({ success: false, error: error.message }) + '\n');
        res.end();
      });

      // Handle cancellation
      req.on('close', () => {
        if (npmProcess && !npmProcess.killed) {
          npmProcess.kill('SIGTERM');
          sendChunk('\n[Test Runner] ⏹️ Test execution cancelled');
        }
      });

    } else {
      throw new Error(`Unsupported framework: ${framework}`);
    }

  } catch (error) {
    sendChunk(`\n[Test Runner] ❌ Error: ${error.message}`);
    res.write(JSON.stringify({ success: false, error: error.message }) + '\n');
    res.end();
  }
}));

// Start recording session
router.post('/recording/start', strictRateLimiter, asyncHandler(async (req, res) => {
  // T2.5 — accept an optional `viewport: { width, height }` from the
  // recorder UI (viewport-preset dropdown). null/missing keeps the
  // existing default of "maximize".
  const { baseUrl = 'about:blank', browserType = 'chromium', projectId, viewport = null } = req.body;

  console.log(`[API] ========================================`);
  console.log(`[API] Starting recording session...`);
  console.log(`[API] Base URL: ${baseUrl}`);
  console.log(`[API] Browser Type: ${browserType}`);
  console.log(`[API] Project ID: ${projectId || 'none'}`);
  console.log(`[API] Viewport: ${viewport ? `${viewport.width}x${viewport.height}` : 'maximize (default)'}`);
  console.log(`[API] Current active sessions: ${browserService.getActiveSessionCount()}`);

  // Set current project if provided
  if (projectId) {
    await projectService.setCurrentProject(projectId);
  }

  const session = await browserService.createSession(baseUrl, browserType, { viewport });

  console.log(`[API] ✅ Session created: ${session.sessionId}`);
  console.log(`[API] Total active sessions: ${browserService.getActiveSessionCount()}`);
  console.log(`[API] ========================================`);

  res.json({
    sessionId: session.sessionId,
    wsUrl: `ws://localhost:${process.env.PORT || 3000}/api/recording/${session.sessionId}`
  });
}));

// Save a locator captured from the recording browser's right-click menu.
// Hook used by the in-page recorder script: it knows the sessionId but not
// the projectId, so we resolve the project from the session and persist via
// locatorService so it shows up in the IDE's Locator Repository immediately.
router.post('/recording/:sessionId/save-locator', asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  validateSessionId(sessionId);

  const session = browserService.getSession(sessionId);
  if (!session) {
    const err = new Error('Session not found');
    err.name = 'NotFoundError';
    throw err;
  }

  const {
    pageName,
    elementName,
    selector,
    locatorType,
    fallbackSelectors = [],
    description,
    projectId: bodyProjectId,
  } = req.body || {};

  if (!pageName || !elementName || !selector) {
    return res.status(400).json({
      success: false,
      error: 'pageName, elementName, and selector are required',
    });
  }

  // Resolve projectId: explicit body wins; otherwise use the active project
  let projectId = bodyProjectId;
  if (!projectId) {
    try {
      projectId = projectService.getCurrentProject() || null;
    } catch (_) { /* no current project */ }
  }
  if (!projectId) {
    return res.status(409).json({
      success: false,
      error: 'No active project. Select a project before saving locators.',
    });
  }

  const inferredType = locatorType || locatorService.inferLocatorType(selector);

  // Normalise the fallback list into the model's {type, value} shape and
  // drop any duplicates of the primary selector. Strings get inferred types.
  const normalisedFallbacks = (Array.isArray(fallbackSelectors) ? fallbackSelectors : [])
    .map((f) => {
      if (typeof f === 'string') return { type: locatorService.inferLocatorType(f), value: f };
      if (f && typeof f === 'object' && f.value) {
        return { type: f.type || locatorService.inferLocatorType(f.value), value: f.value };
      }
      return null;
    })
    .filter((f) => f && f.value && f.value !== selector);

  const locator = new LocatorDefinition({
    pageName: String(pageName).trim(),
    elementName: String(elementName).trim(),
    locatorType: inferredType,
    locatorValue: String(selector).trim(),
    description: description || `${pageName}.${elementName}`,
    fallbackLocators: normalisedFallbacks,
  });

  await locatorService.saveLocator(projectId, locator);

  console.log(`[Recording] 📌 Saved locator from right-click menu: ${pageName}.${elementName} (${inferredType}) -> ${selector}`);

  res.json({
    success: true,
    projectId,
    locator: locator.toJSON(),
  });
}));

// Stop recording and get captured actions (no rate limit - critical operation)
router.post('/recording/stop', asyncHandler(async (req, res) => {
  const { sessionId, projectId, projectName, featureTitle, featureName, framework: bodyFramework, browserType, baseUrl, tags: uiTags = [], skipProjectCreation = false } = req.body;
  validateSessionId(sessionId);
  // Hold onto the requested framework so we can later prefer the project's saved
  // framework (a project created as selenium-java should not silently flip to
  // playwright-java just because the stop call omitted the field).
  let framework = bodyFramework || 'playwright-java';
  
  // Only create/set project if skipProjectCreation is false and project details are provided
  let currentProjectId = projectId;
  
  if (!skipProjectCreation && !currentProjectId && projectName) {
    // Try to find existing project by name
    const projects = await projectService.listProjects();
    const foundProject = projects.find(p => p.name === projectName);
    if (foundProject) {
      currentProjectId = foundProject.id;
    } else {
      // Create new project from form details (only if not skipping)
      try {
        const projectData = await projectService.createProject(projectName, {
          description: `Created from recording: ${featureTitle || 'Recorded Test Flow'}`,
          baseUrl: baseUrl || 'http://localhost:3000',
          framework: framework,
          browserType: browserType || 'chromium'
        });
        currentProjectId = projectData.id;
        console.log(`[Recording Stop] Created project: ${projectName} (${currentProjectId})`);
      } catch (error) {
        console.error('[Recording Stop] Failed to create project:', error);
        // Continue without project - steps will still be returned
      }
    }
  }
  
  // Set current project if we have an ID and not skipping
  if (!skipProjectCreation && currentProjectId) {
    await projectService.setCurrentProject(currentProjectId);
  }

  // Prefer the project's saved framework over the body default. A project
  // created as `selenium-java` must always generate Selenium artifacts.
  if (currentProjectId) {
    try {
      const projectData = await projectService.loadProjectData(currentProjectId);
      if (projectData && projectData.framework && !bodyFramework) {
        framework = projectData.framework;
        console.log(`[Recording Stop] Using project's saved framework: ${framework}`);
      }
    } catch (e) {
      console.warn(`[Recording Stop] Could not read framework from project: ${e.message}`);
    }
  }

  const session = browserService.getSession(sessionId);
  if (!session) {
    const error = new Error('Session not found');
    error.name = 'NotFoundError';
    throw error;
  }

  // Include all action types that are supported
  const allowedActionKinds = [
    'click', 'doubleClick', 'type', 'select', 'check', 'uncheck', 'selectRadio',
    'navigate', 'assertText', 'assertVisible', 'assertNotVisible', 'assertAttribute', 'assertCount',
    'assertValue', 'assertEnabled', 'assertDisabled', 'assertChecked', 'assertNotChecked',
    'waitFor', 'waitForSelector', 'screenshot', 'hover',
    'dragDrop', 'fileUpload', 'keyPress', 'scroll', 'close',
    // TIER 1 — Playwright-side recorder hooks (T1.4 download, T1.9 popup).
    'download', 'popup',
  ];
  
  // Only use tags from UI input field (entered before recording)
  // Tags typed during recording are treated as normal text, not extracted as Cucumber tags
  const tags = Array.isArray(uiTags) ? [...uiTags] : [];
  if (tags.length > 0) {
    console.log(`[Recording Stop] Tags from UI input: ${tags.join(', ')}`);
  }
  
  // Filter actions - tags typed during recording are treated as normal text
  const filteredActions = [];
  
  for (const action of (session.actions || [])) {
    if (!action.kind || !allowedActionKinds.includes(action.kind)) {
      continue;
    }
    
    // All actions (including type actions with "@") are treated as normal steps
    // No tag extraction from recorded actions
    filteredActions.push(action);
  }
  
  const actions = filteredActions;
  console.log(`[Recording Stop] Total actions captured: ${actions.length}`);
  
  // Use only UI tags (no extraction from recorded steps)
  const uniqueTags = [...new Set(tags)];
  if (uniqueTags.length > 0) {
    console.log(`[Recording Stop] Final Cucumber tags (from UI only): ${uniqueTags.join(', ')}`);
  }
  
  // Auto-detect Scenario Outline opportunity
  const outlineDetection = gherkinGenerator.detectScenarioOutline(actions);
  if (outlineDetection.useScenarioOutline) {
    console.log(`[Recording Stop] 💡 Scenario Outline detected! Consider using Scenario Outline with Examples table`);
    console.log(`[Recording Stop] Parameterized selector: ${outlineDetection.parameterizedSelector}`);
    console.log(`[Recording Stop] Example values: ${outlineDetection.examples.map(e => e.value).join(', ')}`);
  }

  // Use baseUrl from request, or detect from session/page, or use default
  let detectedBaseUrl = baseUrl || 'https://example.com';
  try {
    if (session.page && !session.page.isClosed()) {
      detectedBaseUrl = await session.page.url();
      if (!detectedBaseUrl || detectedBaseUrl === 'about:blank' || detectedBaseUrl.startsWith('data:')) {
        detectedBaseUrl = baseUrl || 'https://example.com';
      }
    }
  } catch (e) {
    console.log('Browser/page closed or unavailable, using default baseUrl:', e.message);
    // Try to get baseUrl from actions if available
    const navigateAction = actions.find(a => a.kind === 'navigate' && a.url);
    if (navigateAction && navigateAction.url) {
      try {
        const urlObj = new URL(navigateAction.url);
        detectedBaseUrl = `${urlObj.protocol}//${urlObj.host}`;
      } catch (urlError) {
        // Keep default baseUrl
        detectedBaseUrl = baseUrl || 'https://example.com';
      }
    }
  }

  // Auto-generate feature files if actions exist
  let exportPath = null;
  let featureFile = null;
  let stepsFile = null;
  let zeroCodeFile = null;
  let generationError = null;
  let isJavaFramework = false;
  
  // Save steps to current project if available (only if not skipping project creation)
  if (!skipProjectCreation && actions.length > 0 && currentProjectId) {
    try {
      const projectData = await projectService.loadProjectData(currentProjectId);
      if (!projectData.steps) projectData.steps = [];
      if (!projectData.scenarios) projectData.scenarios = [];
      
      // Add new steps to project
      projectData.steps = [...projectData.steps, ...actions];
      
      // Create a new scenario from this recording
      const scenario = {
        id: `scenario-${Date.now()}`,
        name: featureTitle || 'Recorded Test Flow',
        steps: actions.map((a, idx) => ({ stepId: `step-${Date.now()}-${idx}`, action: a })),
        tags: uniqueTags,
        createdAt: new Date().toISOString()
      };
      projectData.scenarios.push(scenario);
      
      // Save updated project data
      await projectService.saveProjectData(currentProjectId, projectData);
      console.log(`[Recording Stop] Saved ${actions.length} steps to project ${currentProjectId}`);
    } catch (saveError) {
      console.error('[Recording Stop] Error saving to project:', saveError);
      // Continue with file generation even if project save fails
    }
  }
  
  if (actions.length > 0) {
    try {
      // Use project name if available, otherwise generate one.
      //
      // We must tolerate the case where `currentProjectId` was supplied but
      // the project record doesn't actually exist on disk (e.g. callers
      // using `skipProjectCreation: true` for the framework-aware mirror,
      // or stale projectIds left in the UI). Fall back to the explicit
      // `projectName` from the request body instead of crashing the whole
      // legacy export branch.
      let projName;
      let legacyProjectExists = false;
      if (currentProjectId) {
        try {
          const projectData = await projectService.loadProjectData(currentProjectId);
          projName = projectData.name || `project-${currentProjectId}`;
          legacyProjectExists = true;
        } catch (loadErr) {
          console.warn(`[Recording Stop] projectId "${currentProjectId}" has no on-disk project; using projectName/feature for legacy export (${loadErr.message})`);
          projName = projectName || featureName || featureTitle || `recorded-test-${Date.now()}`;
          // Disable the legacy projects/<id>/ export — we don't want to
          // scaffold an orphaned directory under a non-existent project id.
          currentProjectId = null;
        }
      } else {
        projName = projectName || `recorded-test-${Date.now()}`;
      }
      void legacyProjectExists;
      
      const featTitle = featureTitle || 'Recorded Test Flow';
      const featName = 'Recorded Feature';

      // Generate project files
      // PRIMARY: Use project directory structure (projects/<projectId>/)
      // FALLBACK: Use sample-export for legacy exports without projectId
      if (currentProjectId) {
        exportPath = projectService.getProjectDir(currentProjectId);
      } else {
        // Legacy: export to sample-export when no projectId (backward compatibility)
        exportPath = await fileService.getProjectPath(projName);
      }
      await fileService.ensureDirectory(exportPath);

      // Check if framework is Java-based
      isJavaFramework = framework === 'playwright-java' || framework === 'selenium-java';

      if (isJavaFramework) {
        // Generate Java project structure
        const srcMainJava = path.join(exportPath, 'src', 'main', 'java');
        const srcTestJava = path.join(exportPath, 'src', 'test', 'java');
        const srcTestResources = path.join(exportPath, 'src', 'test', 'resources');

        await fileService.ensureDirectory(srcMainJava);
        await fileService.ensureDirectory(srcTestJava);
        await fileService.ensureDirectory(srcTestResources);

        // Generate Maven pom.xml
        const pomXml = javaGenerators.generateMavenPom(framework, projName, detectedBaseUrl);
        await fileService.writeFile(path.join(exportPath, 'pom.xml'), pomXml);

        // Generate Java World class
        const browserOptions = { browserType: req.body.browserType || 'chromium' };
        const worldClass = javaGenerators.generateJavaWorld(framework, browserOptions);
        const supportDir = path.join(srcTestJava, 'support');
        await fileService.ensureDirectory(supportDir);
        // The class name embedded in the generated source must match the filename;
        // selenium-java emits SeleniumWorld, playwright-java emits PlaywrightWorld.
        const worldClassName = framework === 'selenium-java' ? 'SeleniumWorld.java' : 'PlaywrightWorld.java';
        await fileService.writeFile(path.join(supportDir, worldClassName), worldClass);

        // Generate Java step definitions. We must build the stepDefMap from
        // the feature file we are about to write AND pass the recorded
        // actions as `steps`, otherwise the generator can't see locator
        // candidates and the SELECTOR_FALLBACKS_BY_PRIMARY map (the runtime
        // self-healing arm) is never emitted.
        const stepDefMap = {};
        const previewFeature = gherkinGenerator.generateFeatureFile({
          featureName: featName,
          featureTitle: featTitle,
          tags: uniqueTags,
          steps: actions,
        });
        previewFeature.split('\n').forEach((line) => {
          const trimmed = line.trim();
          if (/^(Given|When|Then|And)\s+/.test(trimmed)) {
            const pattern = trimmed.replace(/"[^"]*"/g, '{string}').replace(/\d+/g, '{int}');
            stepDefMap[pattern] = true;
          }
        });

        const groupedActions = [];
        const stepsFileName = featTitle.replace(/[^a-zA-Z0-9]/g, '') || 'RecordedTest';
        const className = `${stepsFileName}Steps`;
        const stepDefs = javaGenerators.generateJavaStepDefinitions(framework, stepDefMap, groupedActions, detectedBaseUrl, actions, className);
        const stepsDir = path.join(srcTestJava, 'steps');
        await fileService.ensureDirectory(stepsDir);
        stepsFile = path.join(stepsDir, `${stepsFileName}Steps.java`);
        await fileService.writeFile(stepsFile, stepDefs);

        // Generate feature file
        const featureDir = path.join(srcTestResources, 'features');
        await fileService.ensureDirectory(featureDir);
        const featureContent = gherkinGenerator.generateFeatureFile({
          featureName: featName,
          featureTitle: featTitle,
          tags: uniqueTags, // Use combined tags (UI + extracted)
          steps: actions
        });
        // Use proper naming: RecordedTest.feature
        const featureFileName = featTitle.replace(/[^a-zA-Z0-9]/g, '') || 'RecordedTest';
        featureFile = path.join(featureDir, `${featureFileName}.feature`);
        await fileService.writeFile(featureFile, featureContent);

        // Generate cucumber.properties
        const cucumberProps = javaGenerators.generateCucumberProperties();
        await fileService.writeFile(path.join(srcTestResources, 'cucumber.properties'), cucumberProps);

        // Generate Cucumber Runner class (main entry point for running tests)
        const runnerClass = javaGenerators.generateCucumberRunner('runner', 'features', 'steps');
        const runnerDir = path.join(srcTestJava, 'runner');
        await fileService.ensureDirectory(runnerDir);
        await fileService.writeFile(path.join(runnerDir, 'RunCucumberTest.java'), runnerClass);
        console.log(`[Recording Stop] Generated RunCucumberTest.java`);

      } else {
        // Generate TypeScript/JavaScript project
        const pkgJson = stepsGenerator.generatePackageJson({ projectName: projName });
        await fileService.writeFile(path.join(exportPath, 'package.json'), pkgJson);

        const pwConfig = playwrightGenerator.generatePlaywrightConfig({ baseUrl: detectedBaseUrl });
        const testsDir = path.join(exportPath, 'tests');
        await fileService.ensureDirectory(testsDir);
        await fileService.writeFile(path.join(exportPath, 'playwright.config.ts'), pwConfig);

        const cucumberConfig = gherkinGenerator.generateCucumberConfig();
        await fileService.writeFile(path.join(exportPath, 'cucumber.config.js'), cucumberConfig);

        const spec = playwrightGenerator.generatePlaywrightSpec({
          featureTitle: featTitle,
          baseUrl: detectedBaseUrl,
          steps: actions
        });
        await fileService.writeFile(path.join(testsDir, 'recorded.spec.ts'), spec);

        // Generate feature file and step definitions
        const featureDir = path.join(exportPath, 'features');
        const stepsDir = path.join(exportPath, 'steps');
        await fileService.ensureDirectory(featureDir);
        await fileService.ensureDirectory(stepsDir);

        const featureContent = gherkinGenerator.generateFeatureFile({
          featureName: featName,
          featureTitle: featTitle,
          tags: uniqueTags, // Use combined tags (UI + extracted)
          steps: actions,
          backgroundSteps: [], // Could be extracted from session metadata
          useScenarioOutline: false, // Could be detected or provided
          examples: [],
          scenarios: null
        });
        // Use proper naming: RecordedTest.feature
        const featureFileName = featTitle.replace(/[^a-zA-Z0-9]/g, '') || 'RecordedTest';
        featureFile = path.join(featureDir, `${featureFileName}.feature`);
        await fileService.writeFile(featureFile, featureContent);

        const stepDefs = stepsGenerator.generateStepDefinitions(actions);
        // Use proper naming: RecordedTestSteps.ts
        const stepsFileName = featTitle.replace(/[^a-zA-Z0-9]/g, '') || 'RecordedTest';
        stepsFile = path.join(stepsDir, `${stepsFileName}Steps.ts`);
        await fileService.writeFile(stepsFile, stepDefs);

        // Generate world file
        const worldFile = stepsGenerator.generateWorldFile();
        const worldDir = path.join(exportPath, 'support');
        await fileService.ensureDirectory(worldDir);
        await fileService.writeFile(path.join(worldDir, 'world.ts'), worldFile);
      }

      // ============================================================
      // Auto-promote captured action locators to the project repo and
      // generate Page Object classes from the resulting repo. This means
      // a recording always emits real POMs alongside step defs, instead
      // of relying on the user to hand-fill the locator form.
      // ============================================================
      if (currentProjectId) {
        try {
          const promotedCount = await autoPromoteLocatorsFromActions(currentProjectId, actions);
          if (promotedCount > 0) {
            console.log(`[Recording Stop] 📌 Auto-promoted ${promotedCount} locators from recorded actions`);
          }

          // Group locators by pageName for POM generation
          const allLocators = await locatorService.loadLocators(currentProjectId);
          if (allLocators.length > 0) {
            const pageMap = {};
            for (const loc of allLocators) {
              const pageName = sanitizePageName(loc.pageName) || 'Generic';
              if (!pageMap[pageName]) pageMap[pageName] = [];
              pageMap[pageName].push(loc);
            }

            if (isJavaFramework) {
              const pagesDir = path.join(exportPath, 'src', 'test', 'java', 'pages');
              await fileService.ensureDirectory(pagesDir);

              // BasePage with explicit waits + PageFactory init
              const basePage = pageObjectGenerators.generateSeleniumBasePage({ defaultTimeout: 15 });
              await fileService.writeFile(path.join(pagesDir, 'BasePage.java'), basePage);

              const pageFiles = pageObjectGenerators.generateAllPageObjects(pageMap, 'selenium-java');
              for (const [pageName, src] of Object.entries(pageFiles)) {
                await fileService.writeFile(path.join(pagesDir, `${pageName}Page.java`), src);
              }
              console.log(`[Recording Stop] Generated ${Object.keys(pageFiles).length} Page Object class(es) under src/test/java/pages/`);
            } else if (
              framework === 'playwright-ts' ||
              framework === 'playwright' ||
              framework === 'playwright-typescript'
            ) {
              const pagesDir = path.join(exportPath, 'pages');
              await fileService.ensureDirectory(pagesDir);
              const pageFiles = pageObjectGenerators.generateAllPageObjects(pageMap, 'playwright-ts');
              for (const [pageName, src] of Object.entries(pageFiles)) {
                await fileService.writeFile(path.join(pagesDir, `${pageName}Page.ts`), src);
              }
              console.log(`[Recording Stop] Generated ${Object.keys(pageFiles).length} Playwright Page Object(s) under pages/`);
            }
          }
        } catch (pomError) {
          console.error('[Recording Stop] Page Object generation failed:', pomError);
          // Don't fail the whole stop call - artifacts can be regenerated later
        }
      }

      // Generate zero-code JSON file (for Playwright zero-code engine)
      const zeroCodeJson = generateZeroCodeJson(actions);
      zeroCodeFile = path.join(exportPath, 'test.zero.json');
      await fileService.writeFile(zeroCodeFile, zeroCodeJson);
      console.log(`[Recording Stop] Generated zero-code JSON: ${zeroCodeFile}`);
    } catch (error) {
      console.error('[Recording Stop] Error generating files:', error);
      generationError = error.message;
      // Continue to return actions even if file generation failed
    }
  }

  // Cleanup session (always cleanup, even if file generation failed)
  try {
    await browserService.destroySession(sessionId);
  } catch (cleanupError) {
    console.error('[Recording Stop] Error during session cleanup:', cleanupError);
  }

  const response = {
    success: true,
    actions: actions,
    actionCount: actions.length
  };

  if (generationError) {
    response.warning = `Files generation had errors: ${generationError}. Actions are still available.`;
  }

  if (exportPath) {
    response.exportPath = exportPath;
    response.featureFile = featureFile;
    response.stepsFile = stepsFile;
    response.zeroCodeFile = zeroCodeFile;
    
    // Add generated files list
    const generatedFiles = [];
    if (featureFile) generatedFiles.push({ name: 'Feature File', path: featureFile });
    if (stepsFile) generatedFiles.push({ name: 'Step Definitions', path: stepsFile });
    if (zeroCodeFile) generatedFiles.push({ name: 'Zero-Code JSON', path: zeroCodeFile });
    if (isJavaFramework) {
      generatedFiles.push({ name: 'PlaywrightTest.java', path: path.join(exportPath, 'src', 'test', 'java', 'tests', 'PlaywrightTest.java') });
      generatedFiles.push({ name: 'pom.xml', path: path.join(exportPath, 'pom.xml') });
    }
    
    response.generatedFiles = generatedFiles;
    response.message = `✅ Generated ${generatedFiles.length} files successfully for ${framework}!`;
  }

  // Mirror the canonical recording artifacts into the framework-organized
  // output bucket: generated-projects/<framework>/<project>/recordings/<rec>/.
  // This is non-destructive (existing projects/<id>/* paths are untouched)
  // and best-effort (failure here never breaks recording stop).
  try {
    const layout = await import('../services/projectLayout.js');
    const projectNameForLayout = (currentProjectId || projectName || '').toString();
    const validation = await layout.validateLayoutInputs({
      framework,
      projectName: projectNameForLayout,
    });
    if (validation.ok) {
      const recordingName = featureName
        || (featureTitle && featureTitle.trim())
        || `recording-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      const scaffold = await layout.ensureRecordingScaffold({
        framework: validation.framework,
        projectName: validation.projectName,
        recordingName,
      });
      // Persist a clean copy of the recorded actions and a metadata sidecar
      // so QA can navigate one consistent tree per framework.
      const fsp = await import('fs/promises');
      await fsp.writeFile(scaffold.recordedSteps, JSON.stringify(actions, null, 2), 'utf8');

      // Split out the scroll events into a dedicated file so the validation
      // script can assert "every recording captured at least one scroll" in
      // O(1) without scanning the full action stream.
      const scrollEvents = (Array.isArray(actions) ? actions : []).filter(
        (a) => (a && (a.kind === 'scroll' || a.action === 'scroll'))
      );
      await fsp.writeFile(scaffold.scrollEvents, JSON.stringify(scrollEvents, null, 2), 'utf8');

      // Element locators: one record per interactive step, carrying primary +
      // alternate candidates so the QA can audit locator quality at a glance.
      const elementLocators = (Array.isArray(actions) ? actions : [])
        .filter((a) => a && a.locatorCandidates && Array.isArray(a.locatorCandidates) && a.locatorCandidates.length > 0)
        .map((a, idx) => ({
          stepIndex: idx,
          kind: a.kind || a.action,
          description: a.normalizedDescription || a.description || null,
          pageUrl: a.pageUrl || null,
          scrollY: a.scrollY != null ? a.scrollY : null,
          primaryLocatorIndex: a.primaryLocatorIndex != null ? a.primaryLocatorIndex : 0,
          locatorCandidates: a.locatorCandidates,
          elementMetadata: a.elementMetadata || a.targetElementMetadata || null,
        }));
      await fsp.writeFile(scaffold.elementLocators, JSON.stringify(elementLocators, null, 2), 'utf8');

      await fsp.writeFile(scaffold.metadata, JSON.stringify({
        recordingName: scaffold.recordingName,
        projectName: validation.projectName,
        framework: validation.framework,
        featureTitle: featureTitle || null,
        baseUrl: baseUrl || null,
        browserType: browserType || null,
        capturedAt: new Date().toISOString(),
        actionCount: Array.isArray(actions) ? actions.length : 0,
        scrollEventCount: scrollEvents.length,
        elementLocatorCount: elementLocators.length,
        sessionId,
      }, null, 2), 'utf8');

      // Auto-generate the Markdown test plan so QA reviewers always have
      // human-readable coverage alongside the JSON.
      let testPlanFile = null;
      try {
        const tpg = await import('../services/testPlanGenerator.js');
        const planResult = await tpg.writeTestPlanFromRecording({
          framework: validation.framework,
          projectName: validation.projectName,
          recordingName: scaffold.recordingName,
          steps: Array.isArray(actions) ? actions : [],
          metadata: {
            featureTitle: featureTitle || null,
            baseUrl: baseUrl || null,
            browserType: browserType || null,
            capturedAt: new Date().toISOString(),
          },
        });
        testPlanFile = planResult.file;
      } catch (planErr) {
        console.warn('[Plan] Auto test-plan generation failed (non-fatal):', planErr.message);
      }

      response.layout = {
        framework: scaffold.project.framework,
        projectName: scaffold.project.projectName,
        root: scaffold.project.root,
        recordingDir: scaffold.recordingDir,
        recordedSteps: scaffold.recordedSteps,
        scrollEvents: scaffold.scrollEvents,
        elementLocators: scaffold.elementLocators,
        metadata: scaffold.metadata,
        domSnapshots: scaffold.domSnapshots,
        readme: scaffold.project.readme,
        testPlanFile,
      };
      console.log(`[Recording Stop] Mirrored ${Array.isArray(actions) ? actions.length : 0} actions, ${scrollEvents.length} scroll events, ${elementLocators.length} locators → ${scaffold.recordingDir}`);
    } else {
      console.log(`[Recording Stop] Skipping framework-organized layout: ${validation.error}`);
    }
  } catch (layoutErr) {
    console.warn('[Recording Stop] Layout mirror failed (non-fatal):', layoutErr.message);
  }

  res.json(response);
}));

// Get recording status (lenient rate limit for polling)
router.get('/recording/:sessionId/status', pollingRateLimiter, asyncHandler(async (req, res) => {
  const sessionId = validateSessionId(req.params.sessionId);
  const session = browserService.getSession(sessionId);

  if (!session) {
    const error = new Error('Session not found');
    error.name = 'NotFoundError';
    throw error;
  }

  res.json({
    active: true,
    actionCount: session.actions.length,
    lastActivity: session.lastActivity
  });
}));

// Get new actions (for polling fallback - lenient rate limit)
router.get('/recording/:sessionId/actions', pollingRateLimiter, asyncHandler(async (req, res) => {
  const sessionId = validateSessionId(req.params.sessionId);
  const session = browserService.getSession(sessionId);

  if (!session) {
    const error = new Error('Session not found');
    error.name = 'NotFoundError';
    throw error;
  }

  const since = parseInt(req.query.since) || 0;
  const newActions = session.actions.filter(a => a.timestamp > since);

  res.json({
    actions: newActions,
    total: session.actions.length
  });
}));

// T2.8 — auto-suggested assertions endpoint. The recorder injection
// proposes soft assertions after every click/blur; the IDE polls this
// list and lets the user promote any of them into a real step (or
// dismiss). Suggestions live ONLY in memory on the session — they are
// NOT persisted to disk, so a server restart clears them.
router.get('/recording/:sessionId/suggestions', pollingRateLimiter, asyncHandler(async (req, res) => {
  const sessionId = validateSessionId(req.params.sessionId);
  const session = browserService.getSession(sessionId);
  if (!session) {
    const err = new Error('Session not found');
    err.name = 'NotFoundError';
    throw err;
  }
  const list = Array.isArray(session.suggestions) ? session.suggestions : [];
  res.json({ suggestions: list, total: list.length });
}));

router.post('/recording/:sessionId/suggestions/clear', generalRateLimiter, asyncHandler(async (req, res) => {
  const sessionId = validateSessionId(req.params.sessionId);
  const session = browserService.getSession(sessionId);
  if (!session) {
    const err = new Error('Session not found');
    err.name = 'NotFoundError';
    throw err;
  }
  session.suggestions = [];
  res.json({ success: true, cleared: true });
}));

// Note: POST /api/recording/:sessionId/action is handled in server.js
// using handleActionCapture from routes/websocket.js for CORS support
// from external websites. This endpoint is not defined here to avoid conflicts.

// OLD PROJECT ENDPOINTS - DEPRECATED (replaced by new project service endpoints below)
// The new project management endpoints are defined in the "PROJECT MANAGEMENT ENDPOINTS" section below
// Legacy endpoints have been removed to avoid route conflicts

// File management endpoints for step definitions
// NOTE: These endpoints use projectName for backward compatibility
// For new projects, prefer using projectId-based endpoints
router.get('/files/steps/:projectName', generalRateLimiter, asyncHandler(async (req, res) => {
  const projectName = validateProjectName(req.params.projectName);
  
  try {
    // Try to find project by name first, otherwise use sample-export for legacy
    let projectPath;
    try {
      const projects = await projectService.listProjects();
      const project = projects.find(p => p.name === projectName);
      if (project) {
        projectPath = projectService.getProjectDir(project.id);
      } else {
        projectPath = await fileService.getProjectPath(projectName);
      }
    } catch {
      projectPath = await fileService.getProjectPath(projectName);
    }
    
    // Try to find step definitions file (could be in different locations)
    const possiblePaths = [
      path.join(projectPath, 'src', 'test', 'java', 'steps', 'RecordedTestFlowSteps.java'),
      path.join(projectPath, 'src', 'test', 'java', 'steps', 'RecordedSteps.java'),
      path.join(projectPath, 'steps', 'recorded.steps.ts'),
      path.join(projectPath, 'steps', 'RecordedTestFlowSteps.ts')
    ];
    
    let content = null;
    let filePath = null;
    
    for (const filePathToTry of possiblePaths) {
      try {
        if (await fileService.fileExists(filePathToTry)) {
          content = await fileService.readFile(filePathToTry);
          filePath = filePathToTry;
          break;
        }
      } catch (e) {
        // Continue to next path
      }
    }
    
    if (!content) {
      const error = new Error('Step definitions file not found');
      error.name = 'NotFoundError';
      throw error;
    }
    
    res.json({
      success: true,
      content: content,
      path: filePath
    });
  } catch (error) {
    if (error.name === 'NotFoundError') {
      throw error;
    }
    throw new Error(`Failed to load step definitions: ${error.message}`);
  }
}));

router.post('/files/steps/:projectName', strictRateLimiter, asyncHandler(async (req, res) => {
  const projectName = validateProjectName(req.params.projectName);
  const { content } = req.body;
  
  if (!content || typeof content !== 'string') {
    throw new Error('Content is required');
  }
  
  try {
    // Try to find project by name first, otherwise use sample-export for legacy
    let projectPath;
    try {
      const projects = await projectService.listProjects();
      const project = projects.find(p => p.name === projectName);
      if (project) {
        projectPath = projectService.getProjectDir(project.id);
      } else {
        projectPath = await fileService.getProjectPath(projectName);
      }
    } catch {
      projectPath = await fileService.getProjectPath(projectName);
    }
    
    // Determine file path based on project structure
    let filePath;
    if (await fileService.fileExists(path.join(projectPath, 'pom.xml'))) {
      // Java project
      const stepsDir = path.join(projectPath, 'src', 'test', 'java', 'steps');
      await fileService.ensureDirectory(stepsDir);
      filePath = path.join(stepsDir, 'RecordedTestFlowSteps.java');
    } else {
      // TypeScript project
      const stepsDir = path.join(projectPath, 'steps');
      await fileService.ensureDirectory(stepsDir);
      filePath = path.join(stepsDir, 'recorded.steps.ts');
    }
    
    await fileService.writeFile(filePath, content);
    
    res.json({
      success: true,
      message: 'Step definitions saved successfully',
      path: filePath
    });
  } catch (error) {
    throw new Error(`Failed to save step definitions: ${error.message}`);
  }
}));

// File management endpoints for feature files
router.get('/files/feature/:projectName', generalRateLimiter, asyncHandler(async (req, res) => {
  const projectName = validateProjectName(req.params.projectName);
  
  try {
    // Try to find project by name first, otherwise use sample-export for legacy
    let projectPath;
    try {
      const projects = await projectService.listProjects();
      const project = projects.find(p => p.name === projectName);
      if (project) {
        projectPath = projectService.getProjectDir(project.id);
      } else {
        projectPath = await fileService.getProjectPath(projectName);
      }
    } catch {
      projectPath = await fileService.getProjectPath(projectName);
    }
    
    // Try to find feature file (could be in different locations)
    const possiblePaths = [
      path.join(projectPath, 'src', 'test', 'resources', 'features', 'recorded.feature'),
      path.join(projectPath, 'features', 'recorded.feature'),
      path.join(projectPath, 'features', 'RecordedTestFlow.feature')
    ];
    
    let content = null;
    let filePath = null;
    
    for (const filePathToTry of possiblePaths) {
      try {
        if (await fileService.fileExists(filePathToTry)) {
          content = await fileService.readFile(filePathToTry);
          filePath = filePathToTry;
          break;
        }
      } catch (e) {
        // Continue to next path
      }
    }
    
    if (!content) {
      const error = new Error('Feature file not found');
      error.name = 'NotFoundError';
      throw error;
    }
    
    res.json({
      success: true,
      content: content,
      path: filePath
    });
  } catch (error) {
    if (error.name === 'NotFoundError') {
      throw error;
    }
    throw new Error(`Failed to load feature file: ${error.message}`);
  }
}));

router.post('/files/feature/:projectName', strictRateLimiter, asyncHandler(async (req, res) => {
  const projectName = validateProjectName(req.params.projectName);
  const { content } = req.body;
  
  if (!content || typeof content !== 'string') {
    throw new Error('Content is required');
  }
  
  try {
    // Try to find project by name first, otherwise use sample-export for legacy
    let projectPath;
    try {
      const projects = await projectService.listProjects();
      const project = projects.find(p => p.name === projectName);
      if (project) {
        projectPath = projectService.getProjectDir(project.id);
      } else {
        projectPath = await fileService.getProjectPath(projectName);
      }
    } catch {
      projectPath = await fileService.getProjectPath(projectName);
    }
    
    // Determine file path based on project structure
    let filePath;
    if (await fileService.fileExists(path.join(projectPath, 'pom.xml'))) {
      // Java project
      const featureDir = path.join(projectPath, 'src', 'test', 'resources', 'features');
      await fileService.ensureDirectory(featureDir);
      filePath = path.join(featureDir, 'recorded.feature');
    } else {
      // TypeScript project
      const featureDir = path.join(projectPath, 'features');
      await fileService.ensureDirectory(featureDir);
      filePath = path.join(featureDir, 'recorded.feature');
    }
    
    await fileService.writeFile(filePath, content);
    
    res.json({
      success: true,
      message: 'Feature file saved successfully',
      path: filePath
    });
  } catch (error) {
    throw new Error(`Failed to save feature file: ${error.message}`);
  }
}));

// File management endpoints for Playwright code
router.post('/files/playwright/:projectName', strictRateLimiter, asyncHandler(async (req, res) => {
  const projectName = validateProjectName(req.params.projectName);
  const { content } = req.body;
  
  if (!content || typeof content !== 'string') {
    throw new Error('Content is required');
  }
  
  try {
    // Try to find project by name first, otherwise use sample-export for legacy
    let projectPath;
    try {
      const projects = await projectService.listProjects();
      const project = projects.find(p => p.name === projectName);
      if (project) {
        projectPath = projectService.getProjectDir(project.id);
      } else {
        projectPath = await fileService.getProjectPath(projectName);
      }
    } catch {
      projectPath = await fileService.getProjectPath(projectName);
    }
    
    // Save Playwright TypeScript file
    const playwrightDir = path.join(projectPath, 'tests');
    await fileService.ensureDirectory(playwrightDir);
    const filePath = path.join(playwrightDir, 'recorded.spec.ts');
    
    await fileService.writeFile(filePath, content);
    
    res.json({
      success: true,
      message: 'Playwright file saved successfully',
      path: filePath
    });
  } catch (error) {
    throw new Error(`Failed to save Playwright file: ${error.message}`);
  }
}));

// File management endpoints for Selenium code
router.post('/files/selenium/:projectName', strictRateLimiter, asyncHandler(async (req, res) => {
  const projectName = validateProjectName(req.params.projectName);
  const { content } = req.body;
  
  if (!content || typeof content !== 'string') {
    throw new Error('Content is required');
  }
  
  try {
    // Try to find project by name first, otherwise use sample-export for legacy
    let projectPath;
    try {
      const projects = await projectService.listProjects();
      const project = projects.find(p => p.name === projectName);
      if (project) {
        projectPath = projectService.getProjectDir(project.id);
      } else {
        projectPath = await fileService.getProjectPath(projectName);
      }
    } catch {
      projectPath = await fileService.getProjectPath(projectName);
    }
    
    // Save Selenium Java file
    const seleniumDir = path.join(projectPath, 'src', 'test', 'java', 'tests');
    await fileService.ensureDirectory(seleniumDir);
    const filePath = path.join(seleniumDir, 'RecordedTest.java');
    
    await fileService.writeFile(filePath, content);
    
    res.json({
      success: true,
      message: 'Selenium file saved successfully',
      path: filePath
    });
  } catch (error) {
    throw new Error(`Failed to save Selenium file: ${error.message}`);
  }
}));

// Generate step definitions endpoint
router.post('/generate-step-definitions', strictRateLimiter, asyncHandler(async (req, res) => {
  try {
    const { framework, steps = [] } = req.body;
    
    if (!framework) {
      throw new Error('Framework is required');
    }
    
    if (framework !== 'playwright-java' && framework !== 'selenium-java') {
      throw new Error('Only Java frameworks are supported for this endpoint');
    }
    
    // Build stepDefMap from steps
    const stepDefMap = {};
    
    // Generate feature file to extract step patterns
    let featureContent;
    try {
      featureContent = gherkinGenerator.generateFeatureFile({
        featureName: 'Recorded Feature',
        featureTitle: 'Recorded Flow',
        tags: [],
        steps: steps || [],
        backgroundSteps: [],
        useScenarioOutline: false,
        examples: [],
        scenarios: null
      });
    } catch (featureError) {
      console.error('[Generate Step Definitions] Error generating feature file:', featureError);
      throw new Error(`Failed to generate feature file: ${featureError.message}`);
    }
    
    // Extract step patterns from feature file
    const featureLines = featureContent.split('\n');
    featureLines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed.match(/^(Given|When|Then|And)\s+/)) {
        // Extract the step pattern (replace quoted strings with {string}, numbers with {int})
        const pattern = trimmed.replace(/"[^"]*"/g, '{string}').replace(/\d+/g, '{int}');
        stepDefMap[pattern] = true;
      }
    });
    
    // Generate Java step definitions
    const baseUrl = 'http://localhost:3000'; // Default, can be passed from frontend if needed
    const groupedActions = [];
    // Generate class name from feature title (use from request body or default)
    const featureTitle = req.body.featureTitle || 'Recorded Flow';
    const stepsFileName = featureTitle.replace(/[^a-zA-Z0-9]/g, '') || 'RecordedTest';
    const className = `${stepsFileName}Steps`;
    let stepDefs;
    try {
      stepDefs = javaGenerators.generateJavaStepDefinitions(framework, stepDefMap, groupedActions, baseUrl, steps || [], className);
    } catch (genError) {
      console.error('[Generate Step Definitions] Error generating Java step definitions:', genError);
      throw new Error(`Failed to generate Java step definitions: ${genError.message}`);
    }
    
    if (!stepDefs || typeof stepDefs !== 'string') {
      throw new Error('Generated step definitions is invalid');
    }
    
    res.json({
      success: true,
      stepDefinitions: stepDefs,
      framework: framework,
      stepCount: (steps || []).length
    });
  } catch (error) {
    console.error('[Generate Step Definitions] Error:', error);
    // Ensure error is properly formatted
    const errorMessage = error.message || 'Unknown error occurred';
    res.status(500).json({
      success: false,
      error: errorMessage,
      message: errorMessage
    });
  }
}));

// Storage stats endpoint
router.get('/storage/stats', generalRateLimiter, asyncHandler(async (req, res) => {
  const stats = await fileService.getStorageStats();
  const sessionStats = browserService.getSessionStats();

  res.json({
    storage: stats,
    sessions: sessionStats
  });
}));

// Generate meaningful test cases from recorded steps
router.post('/generate-test-cases', strictRateLimiter, asyncHandler(async (req, res) => {
  const { steps = [], options = {} } = req.body;

  if (!steps || steps.length === 0) {
    throw new Error('No steps provided. Please record some steps first.');
  }

  try {
    const { generateTestCases, generateFeatureFileFromTestCases } = await import('../services/testCaseGenerator.js');
    
    // Generate test cases
    const result = generateTestCases(steps, {
      featureName: options.featureName || 'Generated Test Cases',
      groupByFlow: options.groupByFlow !== false,
      includeNegativeCases: options.includeNegativeCases !== false,
      minStepsPerTestCase: options.minStepsPerTestCase || 2
    });

    // Generate complete Gherkin feature file
    const featureFile = generateFeatureFileFromTestCases(
      result.testCases,
      options.featureName || 'Generated Test Cases'
    );

    res.json({
      success: true,
      testCases: result.testCases,
      summary: result.summary,
      analysis: result.analysis,
      featureFile,
      message: `Successfully generated ${result.testCases.length} test case(s) from ${steps.length} recorded step(s)`
    });
  } catch (error) {
    console.error('[Generate Test Cases] Error:', error);
    throw new Error(`Failed to generate test cases: ${error.message}`);
  }
}));

// ============================================================================
// PROJECT MANAGEMENT ENDPOINTS
// ============================================================================

// Get all projects
router.get('/projects', generalRateLimiter, asyncHandler(async (req, res) => {
  console.log('[API] GET /api/projects - Request received');
  try {
    const projects = await projectService.listProjects();
    console.log(`[API] GET /api/projects - Returning ${projects.length} projects`);
    res.json({
      success: true,
      projects: projects,
      count: projects.length
    });
  } catch (error) {
    console.error('[API] GET /api/projects - Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}));

// Get current project
router.get('/projects/current', generalRateLimiter, asyncHandler(async (req, res) => {
  const currentProjectId = projectService.getCurrentProject();
  if (!currentProjectId) {
    return res.json({
      success: true,
      project: null
    });
  }
  
  try {
    const projectData = await projectService.loadProjectData(currentProjectId);
    res.json({
      success: true,
      project: projectData
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
}));

// Get project by ID
router.get('/projects/:projectId', generalRateLimiter, asyncHandler(async (req, res) => {
  let projectId;
  try {
    projectId = validateAndDecodeProjectId(req.params.projectId);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
  
  try {
    const projectData = await projectService.loadProjectData(projectId);
    res.json({
      success: true,
      project: projectData
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
}));

// Create new project
router.post('/projects', strictRateLimiter, asyncHandler(async (req, res) => {
  console.log('[API] POST /api/projects - Request received', req.body);
  const { name, description, baseUrl, framework, browserType } = req.body;
  
  if (!name || typeof name !== 'string' || name.trim() === '') {
    console.log('[API] POST /api/projects - Validation failed: name required');
    return res.status(400).json({
      success: false,
      error: 'Project name is required'
    });
  }
  
  try {
    console.log('[API] POST /api/projects - Creating project:', name);
    const projectData = await projectService.createProject(name, {
      description,
      baseUrl,
      framework,
      browserType
    });
    
    console.log('[API] POST /api/projects - Project created successfully:', projectData.id);
    res.json({
      success: true,
      message: 'Project created successfully',
      project: projectData
    });
  } catch (error) {
    console.error('[API] POST /api/projects - Error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
}));

// Select/Set current project
router.post('/projects/select', generalRateLimiter, asyncHandler(async (req, res) => {
  const { projectId } = req.body;
  
  if (!projectId) {
    return res.status(400).json({
      success: false,
      error: 'Project ID is required'
    });
  }
  
  try {
    // Verify project exists
    await projectService.loadProjectData(projectId);
    
    // Set as current project
    await projectService.setCurrentProject(projectId);
    
    // Load project data
    const projectData = await projectService.loadProjectData(projectId);
    
    res.json({
      success: true,
      message: 'Project selected successfully',
      project: projectData
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error.message
    });
  }
}));

// Save project data
router.post('/projects/:projectId/save', generalRateLimiter, asyncHandler(async (req, res) => {
  let projectId;
  try {
    projectId = validateAndDecodeProjectId(req.params.projectId);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
  
  const projectData = req.body;
  
  if (!projectData) {
    return res.status(400).json({
      success: false,
      error: 'Project data is required'
    });
  }
  
  try {
    await projectService.saveProjectData(projectId, projectData);
    res.json({
      success: true,
      message: 'Project saved successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
}));

// ----------------------------------------------------------------------------
// [ZAC-FIX] FIX A — manual editor writeback
// ----------------------------------------------------------------------------
// QA on Windows often opens ZAC, hits Stop, then hand-edits the Java / Steps
// / Feature panels in the recorder UI. Before this endpoint those edits never
// reached project.json and were lost on the next save / regenerate.
//
// Body: { feature?: string, steps?: string, pages?: string, writeToDisk?: bool }
// Stores the strings under project.manualCode.{feature,steps,pages} and
// (when writeToDisk=true) also writes them to the Maven layout on disk so
// the QA can immediately open the project in Eclipse / IntelliJ.
//
// Always returns 200 with { ok, written:[paths], stored:bool } so the UI
// can show a "Saved ✓" pill without dealing with HTTP-level error states.
router.post('/projects/:projectId/manual-edits', generalRateLimiter, asyncHandler(async (req, res) => {
  let projectId;
  try { projectId = validateAndDecodeProjectId(req.params.projectId); }
  catch (e) { return res.status(400).json({ ok: false, error: e.message }); }

  const { feature, steps, pages, writeToDisk } = req.body || {};
  const hasAny = [feature, steps, pages].some(v => typeof v === 'string');
  if (!hasAny) {
    return res.status(400).json({ ok: false, error: 'no manual code provided (feature/steps/pages all empty)' });
  }

  let projectData;
  try {
    projectData = await projectService.loadProjectData(projectId);
  } catch (e) {
    return res.status(404).json({ ok: false, error: 'project not found: ' + projectId });
  }

  const now = new Date().toISOString();
  const prev = projectData.manualCode || {};
  projectData.manualCode = {
    feature: typeof feature === 'string' ? feature : prev.feature,
    steps:   typeof steps   === 'string' ? steps   : prev.steps,
    pages:   typeof pages   === 'string' ? pages   : prev.pages,
    updatedAt: now,
    editedKeys: [
      ...(typeof feature === 'string' ? ['feature'] : []),
      ...(typeof steps   === 'string' ? ['steps']   : []),
      ...(typeof pages   === 'string' ? ['pages']   : []),
    ],
  };
  // Mark project so /generate-files can warn / preserve.
  projectData.metadata = projectData.metadata || {};
  projectData.metadata.hasManualEdits = true;
  projectData.metadata.manualEditsUpdatedAt = now;

  await projectService.saveProjectData(projectId, projectData);

  const written = [];
  if (writeToDisk) {
    try {
      const { ensureProjectScaffold } = await import('../services/projectLayout.js');
      const paths = await ensureProjectScaffold({
        framework: projectData.framework || 'selenium-java',
        projectName: projectData.name || projectId,
        writeReadme: false,
      });
      const fs = await import('fs/promises');
      const path = (await import('path')).default;
      const conv = paths.conventions || {};
      // Language-aware fallback: most Java frameworks in config/frameworks.json
      // expose only testDir/mainDir/resourcesDir, so we synthesize the
      // standard Maven feature/steps/pages locations when the convention is
      // missing them. Same for TS/JS frameworks already cover their own.
      const lang = (conv.language || projectData.language || '').toLowerCase()
                || (String(projectData.framework || '').includes('java') ? 'java' : 'typescript');
      const isJava = lang === 'java' || projectData.framework?.endsWith('-java') || projectData.framework?.endsWith('-testng');
      const featuresDir = conv.featuresDir
        || (isJava ? path.join(conv.resourcesDir || 'src/test/resources', 'features') : 'features');
      const stepsDir = conv.stepsDir
        || (isJava ? path.join(conv.testDir || 'src/test/java', 'steps') : 'steps');
      const pagesDir = conv.pagesDir
        || (isJava ? path.join(conv.mainDir || 'src/main/java', 'pages') : 'pages');
      const codeExt = conv.stepsExtension
        || (isJava ? '.java' : (lang === 'typescript' ? '.ts' : '.js'));

      async function ensureWrite(dirRel, filename, content) {
        const dir = path.join(paths.root, dirRel);
        await fs.mkdir(dir, { recursive: true });
        const fp = path.join(dir, filename);
        await fs.writeFile(fp, content, 'utf8');
        written.push(fp);
      }

      const writes = [];
      if (typeof feature === 'string') {
        writes.push(ensureWrite(featuresDir, 'manual.feature', feature));
      }
      if (typeof steps === 'string') {
        writes.push(ensureWrite(stepsDir, 'ManualSteps' + codeExt, steps));
      }
      if (typeof pages === 'string') {
        writes.push(ensureWrite(pagesDir, 'ManualPage' + codeExt, pages));
      }
      await Promise.all(writes);
      console.log('[ZAC-FIX] manual edits written to disk:', written);
    } catch (e) {
      console.warn('[ZAC-FIX] manual edits writeToDisk failed:', e.message);
      return res.json({ ok: true, stored: true, written, diskError: e.message });
    }
  }

  res.json({ ok: true, stored: true, written, manualCode: projectData.manualCode });
}));

// ----------------------------------------------------------------------------
// [ZAC-FIX] FIX C — rerun → dashboard wiring
// ----------------------------------------------------------------------------
// Append a row to reports/rerun-history.jsonl whenever a rerun finishes.
// The dashboard's /api/dashboard/runs reader can consume this directly so
// every rerun shows up tagged with framework + test_runner + heal counts.
//
// Body: { projectId, framework, testRunner, status, durationMs, healCount?, totalScenarios? }
router.post('/runs/append', generalRateLimiter, asyncHandler(async (req, res) => {
  const fs = await import('fs/promises');
  const path = (await import('path')).default;
  const body = req.body || {};
  const required = ['projectId', 'framework', 'status'];
  for (const k of required) {
    if (!body[k]) return res.status(400).json({ ok: false, error: 'missing ' + k });
  }
  const row = {
    id: body.id || `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    timestamp: body.timestamp || new Date().toISOString(),
    project: body.projectId,
    framework: body.framework,
    test_runner: body.testRunner || inferTestRunner(body.framework),
    status: body.status,
    duration_ms: Number(body.durationMs) || 0,
    heal_count: Number(body.healCount) || 0,
    deliberate_heal_count: Number(body.deliberateHealCount) || 0,
    total_scenarios: Number(body.totalScenarios) || 0,
    passed: Number(body.passed) || 0,
    failed: Number(body.failed) || 0,
    healed: Number(body.healed) || 0,
  };
  const reportsDir = path.resolve(process.cwd(), 'reports');
  await fs.mkdir(reportsDir, { recursive: true });
  const file = path.join(reportsDir, 'rerun-history.jsonl');
  await fs.appendFile(file, JSON.stringify(row) + '\n', 'utf8');
  console.log('[ZAC-FIX] rerun history appended:', row.id, row.framework, row.status);
  res.json({ ok: true, row });
}));

router.get('/runs/history', pollingRateLimiter, asyncHandler(async (req, res) => {
  const fs = await import('fs/promises');
  const path = (await import('path')).default;
  const file = path.resolve(process.cwd(), 'reports', 'rerun-history.jsonl');
  try {
    const text = await fs.readFile(file, 'utf8');
    const rows = text.split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const filtered = rows.slice(-limit).reverse();
    res.json({ ok: true, total: rows.length, rows: filtered });
  } catch (e) {
    if (e.code === 'ENOENT') return res.json({ ok: true, total: 0, rows: [] });
    res.status(500).json({ ok: false, error: e.message });
  }
}));

function inferTestRunner(framework) {
  if (!framework) return 'unknown';
  if (framework.includes('testng')) return 'testng';
  if (framework.includes('java')) return 'junit';
  if (framework.includes('cypress')) return 'mocha';
  if (framework.includes('typescript') || framework.includes('javascript') || framework.includes('playwright')) return 'mocha';
  return 'unknown';
}

// Optimized endpoint to append steps to a project without loading all existing steps
router.post('/projects/:projectId/append-steps', generalRateLimiter, asyncHandler(async (req, res) => {
  let projectId;
  try {
    projectId = validateAndDecodeProjectId(req.params.projectId);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
  
  const { steps = [], scenario } = req.body;
  
  if (!steps || steps.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'No steps provided'
    });
  }
  
  try {
    console.log(`[Append Steps] Appending ${steps.length} steps to project ${projectId}`);
    const startTime = Date.now();
    
    // Load project data
    const projectData = await projectService.loadProjectData(projectId);
    
    // Initialize arrays if they don't exist
    if (!projectData.steps) projectData.steps = [];
    if (!projectData.scenarios) projectData.scenarios = [];
    
    // Append new steps (optimized: direct append instead of spread)
    projectData.steps.push(...steps);
    
    // Append scenario if provided
    if (scenario) {
      projectData.scenarios.push(scenario);
    }
    
    // Save updated project data
    await projectService.saveProjectData(projectId, projectData);
    
    const elapsedTime = Date.now() - startTime;
    console.log(`[Append Steps] Successfully appended ${steps.length} steps in ${elapsedTime}ms`);
    
    res.json({
      success: true,
      message: `✅ Successfully appended ${steps.length} step(s)`,
      totalSteps: projectData.steps.length,
      elapsedTime: elapsedTime
    });
  } catch (error) {
    console.error('[Append Steps] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}));

// Generate and save all code files for a project
router.post('/projects/:projectId/generate-files', strictRateLimiter, asyncHandler(async (req, res) => {
  let projectId;
  try {
    projectId = validateAndDecodeProjectId(req.params.projectId);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
  
  const { featureTitle, featureName, framework, browserType, baseUrl, tags = [] } = req.body;
  
  try {
    // Load project data (optimized: only load metadata if we have new steps)
    const projectData = await projectService.loadProjectData(projectId);
    const projectName = projectData.name || projectId;
    const steps = projectData.steps || [];
    
    // [ZAC-FIX] Multi-scenario projects (the "Add new scenario" flow)
    // store their steps under project.scenarios[i].steps and may have
    // an empty top-level steps[]. Treat that as valid — only reject when
    // BOTH are empty / missing.
    const totalScenarioSteps = (Array.isArray(projectData.scenarios) ? projectData.scenarios : [])
      .reduce((acc, s) => acc + ((s && Array.isArray(s.steps)) ? s.steps.length : 0), 0);
    if (steps.length === 0 && totalScenarioSteps === 0) {
      return res.status(400).json({
        success: false,
        error: 'No steps found in project. Please record some steps first.'
      });
    }
    
    console.log(`[Generate Files] Starting generation for ${steps.length} steps`);
    const startTime = Date.now();
    
    // Use project directory structure: projects/<projectId>/
    const projectDir = projectService.getProjectDir(projectId);
    await fileService.ensureDirectory(projectDir);
    
    const finalFramework = framework || projectData.framework || 'playwright-java';
    const finalBrowserType = browserType || projectData.browserType || 'chromium';
    const finalBaseUrl = baseUrl || projectData.baseUrl || 'http://localhost:3000';
    const finalFeatureTitle = featureTitle || projectData.scenarios?.[0]?.name || 'Recorded Test Flow';
    const finalFeatureName = featureName || 'Recorded Feature';
    const finalTags = tags.length > 0 ? tags : (projectData.scenarios?.[0]?.tags || []);
    
    const isJavaFramework = finalFramework === 'playwright-java' || finalFramework === 'selenium-java';
    const generatedFiles = [];

    // Prepare all file generation tasks in parallel
    const fileWritePromises = [];

    // T2.1 — selenium-testng (pure-TestNG, NO Cucumber). The plugin
    // module already exists at generators/selenium-testng.js; we just
    // need to dispatch to its generateProject() and write the file map
    // to disk. We branch BEFORE the Cucumber Java path so this stays a
    // pure additive change — the Cucumber pipelines are untouched.
    if (finalFramework === 'selenium-testng') {
      const seleniumTestng = await import('../generators/selenium-testng.js');
      const result = seleniumTestng.generateProject({
        projectName,
        featureTitle: finalFeatureTitle,
        featureName: finalFeatureName,
        baseUrl: finalBaseUrl,
        steps,
        tags: finalTags,
        browserType: finalBrowserType,
      });
      const { files = {}, surfaced = {} } = result || {};
      for (const [relPath, content] of Object.entries(files)) {
        const absPath = path.join(projectDir, relPath);
        await fileService.ensureDirectory(path.dirname(absPath));
        fileWritePromises.push(
          fileService.writeFile(absPath, content).then(() => {
            generatedFiles.push({ name: path.basename(relPath), path: absPath });
          })
        );
      }
      await Promise.all(fileWritePromises);
      console.log(`[Generate Files] selenium-testng plugin emitted ${generatedFiles.length} files`);
      return res.json({
        success: true,
        files: generatedFiles,
        framework: finalFramework,
        primaryTestFile: surfaced.primaryTestFile,
        runnerEntryPoint: surfaced.runnerEntryPoint || 'pom.xml',
      });
    }

    if (isJavaFramework) {
      // Generate Java project structure
      const srcMainJava = path.join(projectDir, 'src', 'main', 'java');
      const srcTestJava = path.join(projectDir, 'src', 'test', 'java');
      const srcTestResources = path.join(projectDir, 'src', 'test', 'resources');
      
      await fileService.ensureDirectory(srcMainJava);
      await fileService.ensureDirectory(srcTestJava);
      await fileService.ensureDirectory(srcTestResources);
      
      // Generate Maven pom.xml (parallel)
      const pomXml = javaGenerators.generateMavenPom(finalFramework, projectName, finalBaseUrl);
      const pomPath = path.join(projectDir, 'pom.xml');
      fileWritePromises.push(
        fileService.writeFile(pomPath, pomXml).then(() => {
          generatedFiles.push({ name: 'pom.xml', path: pomPath });
        })
      );
      
      // Generate Java World class (parallel)
      const browserOptions = { browserType: finalBrowserType };
      const worldClass = javaGenerators.generateJavaWorld(finalFramework, browserOptions);
      const supportDir = path.join(srcTestJava, 'support');
      await fileService.ensureDirectory(supportDir);
      const worldClassName = finalFramework === 'selenium-java' ? 'SeleniumWorld.java' : 'PlaywrightWorld.java';
      const worldPath = path.join(supportDir, worldClassName);
      fileWritePromises.push(
        fileService.writeFile(worldPath, worldClass).then(() => {
          generatedFiles.push({ name: worldClassName, path: worldPath });
        })
      );
      
      // Build page locators map from project locators
      const pageLocatorsMap = {};
      if (projectData.locators && Array.isArray(projectData.locators)) {
        for (const locator of projectData.locators) {
          if (locator.pageName && locator.elementName) {
            if (!pageLocatorsMap[locator.pageName]) {
              pageLocatorsMap[locator.pageName] = {};
            }
            pageLocatorsMap[locator.pageName][locator.elementName] = {
              selector: locator.locatorValue,
              type: locator.locatorType || 'css'
            };
          }
        }
      }
      
      // Generate BasePage for Selenium if needed (parallel)
      if (finalFramework === 'selenium-java' && Object.keys(pageLocatorsMap).length > 0) {
        const pagesDir = path.join(srcTestJava, 'pages');
        await fileService.ensureDirectory(pagesDir);
        const basePageCode = pageObjectGenerators.generateSeleniumBasePage({ defaultTimeout: 10 });
        const basePagePath = path.join(pagesDir, 'BasePage.java');
        fileWritePromises.push(
          fileService.writeFile(basePagePath, basePageCode).then(() => {
            generatedFiles.push({ name: 'BasePage.java', path: basePagePath });
          })
        );
      }
      
      // Generate Page Objects (parallel)
      if (Object.keys(pageLocatorsMap).length > 0) {
        const pagesDir = path.join(srcTestJava, 'pages');
        await fileService.ensureDirectory(pagesDir);
        // [ZAC-FIX] When the framework is playwright-java, pass it
        // through directly so generateAllPageObjects emits real Java
        // (Playwright Java API). Previously this branch forced
        // 'playwright-ts', producing TypeScript files written into
        // .java filenames — uncompilable.
        const frameworkType = finalFramework === 'selenium-java' ? 'selenium-java'
                            : finalFramework === 'playwright-java' ? 'playwright-java'
                            : 'playwright-ts';
        const pageObjects = pageObjectGenerators.generateAllPageObjects(pageLocatorsMap, frameworkType);
        
        for (const [pageName, pageCode] of Object.entries(pageObjects)) {
          const fileName = `${pageName}Page.java`;
          const filePath = path.join(pagesDir, fileName);
          fileWritePromises.push(
            fileService.writeFile(filePath, pageCode).then(() => {
              generatedFiles.push({ name: fileName, path: filePath });
            })
          );
        }
      }
      
      // Generate Java step definitions (optimized for large step counts)
      console.log(`[Generate Files] Generating step definitions for ${steps.length} steps...`);
      const stepDefMap = {};
      const groupedActions = steps;
      // Generate class name from feature title
      const stepsFileName = finalFeatureTitle.replace(/[^a-zA-Z0-9]/g, '') || 'RecordedTest';
      const className = `${stepsFileName}Steps`;
      const stepDefs = javaGenerators.generateJavaStepDefinitions(finalFramework, stepDefMap, groupedActions, finalBaseUrl, steps, className);
      const stepsDir = path.join(srcTestJava, 'steps');
      await fileService.ensureDirectory(stepsDir);
      const stepsPath = path.join(stepsDir, `${stepsFileName}Steps.java`);
      fileWritePromises.push(
        fileService.writeFile(stepsPath, stepDefs).then(() => {
          generatedFiles.push({ name: `${stepsFileName}Steps.java`, path: stepsPath });
          console.log(`[Generate Files] Step definitions file written (${Math.round(stepDefs.length / 1024)}KB)`);
        })
      );
      
      // Generate feature file (parallel)
      // [ZAC-FIX] Honour project.scenarios + project.backgroundSteps so
      // multi-scenario / Background recordings (the "Add new scenario
      // after current steps" flow + "Mark next steps as Background"
      // toggle) actually shape the generated .feature. Previously this
      // route only passed `steps`, so all scenarios were merged into a
      // single Scenario block and any Background was lost.
      console.log(`[Generate Files] Generating feature file...`);
      const projectScenarios = Array.isArray(projectData.scenarios) && projectData.scenarios.length > 0
        ? projectData.scenarios.map(s => ({
            title: s.name || s.title,
            tags: s.tags || [],
            steps: s.steps || [],
            useScenarioOutline: !!s.useScenarioOutline,
            examples: Array.isArray(s.examples) ? s.examples : [],
          }))
        : null;
      const featureContent = gherkinGenerator.generateFeatureFile({
        featureName: finalFeatureName,
        featureTitle: finalFeatureTitle,
        tags: finalTags,
        steps: steps,
        backgroundSteps: Array.isArray(projectData.backgroundSteps) ? projectData.backgroundSteps : [],
        useScenarioOutline: !!projectData.useScenarioOutline,
        examples: Array.isArray(projectData.examples) ? projectData.examples : [],
        scenarios: projectScenarios,
      });
      const featureDir = path.join(srcTestResources, 'features');
      await fileService.ensureDirectory(featureDir);
      const featureFileName = finalFeatureTitle.replace(/[^a-zA-Z0-9]/g, '') || 'RecordedTest';
      const featurePath = path.join(featureDir, `${featureFileName}.feature`);
      fileWritePromises.push(
        fileService.writeFile(featurePath, featureContent).then(() => {
          generatedFiles.push({ name: `${featureFileName}.feature`, path: featurePath });
        })
      );
      
      // Generate cucumber.properties (parallel)
      const cucumberProps = javaGenerators.generateCucumberProperties();
      const propsPath = path.join(srcTestResources, 'cucumber.properties');
      fileWritePromises.push(
        fileService.writeFile(propsPath, cucumberProps).then(() => {
          generatedFiles.push({ name: 'cucumber.properties', path: propsPath });
        })
      );
      
      // Generate Cucumber Runner class (parallel)
      const runnerClass = javaGenerators.generateCucumberRunner('runner', 'features', 'steps');
      const runnerDir = path.join(srcTestJava, 'runner');
      await fileService.ensureDirectory(runnerDir);
      const runnerPath = path.join(runnerDir, 'RunCucumberTest.java');
      fileWritePromises.push(
        fileService.writeFile(runnerPath, runnerClass).then(() => {
          generatedFiles.push({ name: 'RunCucumberTest.java', path: runnerPath });
        })
      );
      
    } else {
      // T2.2 — language switch:
      //   playwright-typescript → emit *.ts files (existing behaviour)
      //   playwright-javascript → emit *.js files with TS annotations stripped
      // The same generators feed both targets so we don't fork the templates.
      const isJsTarget = finalFramework === 'playwright-javascript' || finalFramework === 'playwright-js';
      const ext = isJsTarget ? 'js' : 'ts';
      const tsToJs = (src) => {
        if (!isJsTarget || typeof src !== 'string') return src;
        let out = src;
        // 1. Drop "import type { ... } from '...'" lines.
        out = out.replace(/^\s*import\s+type\s+\{[^}]*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, '');
        // 2. Drop "interface Foo { ... }" blocks (multi-line).
        out = out.replace(/^\s*interface\s+\w+\s*\{[\s\S]*?\n\}\s*$/gm, '');
        // 3. Drop single-line "type X = ...;" statements.
        out = out.replace(/^\s*type\s+[A-Za-z_$][\w$]*\s*=[^;\n]+;?\s*$/gm, '');
        // 4. Strip "this: TypeName" specifically (function-signature variant).
        out = out.replace(/\bthis\s*:\s*[A-Z][A-Za-z_$0-9]*(?:<[^<>]*>)?/g, 'this');
        // 5. Strip ": SomeType" annotations after parameter / const names:
        //    - Capitalised identifier types (e.g. PlaywrightWorld) +
        //      optional one-level generic (e.g. Record<string, string>).
        out = out.replace(
          /([,(]\s*\b[a-zA-Z_$][\w$]*|const\s+[a-zA-Z_$][\w$]*|let\s+[a-zA-Z_$][\w$]*|var\s+[a-zA-Z_$][\w$]*)\s*:\s*[A-Z][A-Za-z_$0-9]*(?:<[^<>]*>)?/g,
          '$1'
        );
        //    - Lowercase primitive types (string/number/boolean/any/void/unknown/never).
        out = out.replace(
          /([,(]\s*\b[a-zA-Z_$][\w$]*|const\s+[a-zA-Z_$][\w$]*|let\s+[a-zA-Z_$][\w$]*|var\s+[a-zA-Z_$][\w$]*)\s*:\s*(?:string|number|boolean|any|void|unknown|never|object|symbol|null|undefined|bigint)\b/g,
          '$1'
        );
        // 6. Drop "as TypeName" casts.
        out = out.replace(/\s+as\s+[A-Z][A-Za-z_$0-9]*(?:<[^<>]*>)?/g, '');
        // 7. Convert ".ts" import suffixes to ".js".
        out = out.replace(/(from\s+['"])([^'"]+)\.ts(['"])/g, '$1$2.js$3');
        // 8. [ZAC-FIX 2026-05-24] Drop TS-only class-field declarations
        //    of the form  `propName!: Type;`  or  `propName?: Type;`
        //    or  `propName: Type;` written directly inside a class body
        //    (i.e. with leading whitespace, no `=` initializer). These
        //    are TypeScript "definite assignment" / "optional" markers
        //    that have no JavaScript equivalent — they must be removed
        //    entirely, otherwise the .js file fails to parse.
        out = out.replace(
          /^\s+[a-zA-Z_$][\w$]*[!?]?\s*:\s*[A-Za-z_$][A-Za-z_$0-9.]*(?:<[^<>]*>)?(?:\[\])?\s*;\s*$/gm,
          ''
        );
        // 9. Strip array-type suffix on simple type annotations that
        //    survived #5/#6 (e.g. `: string[]`).
        out = out.replace(/:\s*[A-Za-z_$][A-Za-z_$0-9]*\[\]/g, '');
        return out;
      };

      // Generate TypeScript/JavaScript project (parallel file writes)
      const pkgJson = stepsGenerator.generatePackageJson({ projectName: projectName });
      const pkgPath = path.join(projectDir, 'package.json');
      fileWritePromises.push(
        fileService.writeFile(pkgPath, pkgJson).then(() => {
          generatedFiles.push({ name: 'package.json', path: pkgPath });
        })
      );

      const pwConfig = playwrightGenerator.generatePlaywrightConfig({ baseUrl: finalBaseUrl });
      const configFileName = `playwright.config.${ext}`;
      const configPath = path.join(projectDir, configFileName);
      fileWritePromises.push(
        fileService.writeFile(configPath, tsToJs(pwConfig)).then(() => {
          generatedFiles.push({ name: configFileName, path: configPath });
        })
      );
      
      const cucumberConfig = gherkinGenerator.generateCucumberConfig();
      const cucumberPath = path.join(projectDir, 'cucumber.config.js');
      fileWritePromises.push(
        fileService.writeFile(cucumberPath, cucumberConfig).then(() => {
          generatedFiles.push({ name: 'cucumber.config.js', path: cucumberPath });
        })
      );
      
      const spec = playwrightGenerator.generatePlaywrightSpec({
        featureTitle: finalFeatureTitle,
        baseUrl: finalBaseUrl,
        steps: steps
      });
      const testsDir = path.join(projectDir, 'tests');
      await fileService.ensureDirectory(testsDir);
      const specFileName = `recorded.spec.${ext}`;
      const specPath = path.join(testsDir, specFileName);
      fileWritePromises.push(
        fileService.writeFile(specPath, tsToJs(spec)).then(() => {
          generatedFiles.push({ name: specFileName, path: specPath });
        })
      );
      
      // Generate feature file and step definitions
      const featureDir = path.join(projectDir, 'features');
      const stepsDir = path.join(projectDir, 'steps');
      await fileService.ensureDirectory(featureDir);
      await fileService.ensureDirectory(stepsDir);
      
      // [ZAC-FIX] Same multi-scenario / Background plumbing as the Java
      // branch above — applies to the TS/JS Cucumber+Playwright bundle.
      const projectScenarios = Array.isArray(projectData.scenarios) && projectData.scenarios.length > 0
        ? projectData.scenarios.map(s => ({
            title: s.name || s.title,
            tags: s.tags || [],
            steps: s.steps || [],
            useScenarioOutline: !!s.useScenarioOutline,
            examples: Array.isArray(s.examples) ? s.examples : [],
          }))
        : null;
      const featureContent = gherkinGenerator.generateFeatureFile({
        featureName: finalFeatureName,
        featureTitle: finalFeatureTitle,
        tags: finalTags,
        steps: steps,
        backgroundSteps: Array.isArray(projectData.backgroundSteps) ? projectData.backgroundSteps : [],
        useScenarioOutline: !!projectData.useScenarioOutline,
        examples: Array.isArray(projectData.examples) ? projectData.examples : [],
        scenarios: projectScenarios,
      });
      const featureFileName = finalFeatureTitle.replace(/[^a-zA-Z0-9]/g, '') || 'RecordedTest';
      const featurePath = path.join(featureDir, `${featureFileName}.feature`);
      fileWritePromises.push(
        fileService.writeFile(featurePath, featureContent).then(() => {
          generatedFiles.push({ name: `${featureFileName}.feature`, path: featurePath });
        })
      );
      
      const stepDefs = stepsGenerator.generateStepDefinitions(steps);
      const stepsFileName = finalFeatureTitle.replace(/[^a-zA-Z0-9]/g, '') || 'RecordedTest';
      const stepDefsFileName = `${stepsFileName}Steps.${ext}`;
      const stepDefsPath = path.join(stepsDir, stepDefsFileName);
      fileWritePromises.push(
        fileService.writeFile(stepDefsPath, tsToJs(stepDefs)).then(() => {
          generatedFiles.push({ name: stepDefsFileName, path: stepDefsPath });
        })
      );

      // Generate world file
      const worldFile = stepsGenerator.generateWorldFile();
      const worldDir = path.join(projectDir, 'support');
      await fileService.ensureDirectory(worldDir);
      const worldFileName = `world.${ext}`;
      const worldPath = path.join(worldDir, worldFileName);
      fileWritePromises.push(
        fileService.writeFile(worldPath, tsToJs(worldFile)).then(() => {
          generatedFiles.push({ name: worldFileName, path: worldPath });
        })
      );
    }
    
    // Generate zero-code JSON file (can be done in parallel)
    const zeroCodeJson = generateZeroCodeJson(steps);
    const zeroCodePath = path.join(projectDir, 'test.zero.json');
    fileWritePromises.push(
      fileService.writeFile(zeroCodePath, zeroCodeJson).then(() => {
        generatedFiles.push({ name: 'test.zero.json', path: zeroCodePath });
      })
    );
    
    // Wait for all file writes to complete in parallel
    console.log(`[Generate Files] Writing ${fileWritePromises.length} files in parallel...`);
    await Promise.all(fileWritePromises);
    
    const elapsedTime = Date.now() - startTime;
    console.log(`[Generate Files] Generated ${generatedFiles.length} files for project ${projectId} in ${elapsedTime}ms`);
    
    res.json({
      success: true,
      message: `✅ Generated ${generatedFiles.length} files successfully!`,
      projectId: projectId,
      projectDir: projectDir,
      generatedFiles: generatedFiles,
      count: generatedFiles.length,
      elapsedTime: elapsedTime
    });
  } catch (error) {
    console.error('[Generate Files] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}));

// Delete project
// [ZAC-FIX 2026-05-24] Bulk delete every project at once.
//
// Wipes:
//   - projects/<id>/                                  (recordings, locator repo, project.json)
//   - generated-projects/<framework>/<id>/            (generated code, reruns, screenshots, videos)
// for every id ZAC currently owns.
//
// DOES NOT TOUCH:
//   - config/                (frameworks.json, email.json, credentials.json)
//   - public/                (frontend assets / settings UI)
//   - services/, routes/, middleware/, generators/   (server code)
//   - environments / settings / locator-strategy snapshots stored in
//     frontend localStorage
//
// Route MUST be declared BEFORE `/projects/:projectId` because Express
// matches in order and `:projectId` would otherwise eat the bare path.
//
// Body: { confirm: true } REQUIRED — guards against accidental fires
// from misconfigured clients. Returns the list of deleted ids so the
// UI can show "Deleted 7 project(s)".
router.delete('/projects', strictRateLimiter, asyncHandler(async (req, res) => {
  console.log('[API] DELETE /api/projects (bulk) - Request received');
  const confirm = req.body && (req.body.confirm === true || req.body.confirm === 'true');
  if (!confirm) {
    return res.status(400).json({
      success: false,
      error: 'Bulk project delete requires { "confirm": true } in the request body.',
    });
  }

  try {
    const result = await projectService.deleteAllProjects();
    // Drop locator caches for every deleted project.
    if (typeof locatorService.invalidateCache === 'function') {
      for (const id of result.ids) locatorService.invalidateCache(id);
    }
    console.log(`[API] DELETE /api/projects (bulk) - Deleted ${result.deleted}/${result.ids.length} (errors=${result.errors.length})`);
    res.json({
      success: true,
      deleted: result.deleted,
      ids: result.ids,
      errors: result.errors,
      message: `Deleted ${result.deleted} project(s).`,
    });
  } catch (error) {
    console.error('[API] DELETE /api/projects (bulk) - Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}));

router.delete('/projects/:projectId', strictRateLimiter, asyncHandler(async (req, res) => {
  console.log('[API] DELETE /api/projects/:projectId - Request received', req.params.projectId);
  
  let projectId;
  try {
    projectId = validateAndDecodeProjectId(req.params.projectId);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
  
  try {
    console.log('[API] DELETE /api/projects/:projectId - Deleting project:', projectId);
    const deleted = await projectService.deleteProject(projectId);
    // Drop the locator cache for this project; otherwise the next recording
    // for a recreated project sees ghost duplicates and auto-promote skips
    // every locator. (See: stale-cache regression in /recording/stop loop.)
    if (typeof locatorService.invalidateCache === 'function') {
      locatorService.invalidateCache(projectId);
    }

    if (deleted) {
      console.log('[API] DELETE /api/projects/:projectId - Project deleted successfully:', projectId);
      res.json({
        success: true,
        message: 'Project deleted successfully'
      });
    } else {
      console.log('[API] DELETE /api/projects/:projectId - Project not found:', projectId);
      res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }
  } catch (error) {
    console.error('[API] DELETE /api/projects/:projectId - Error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
}));

// ============================================================================
// LOCATOR REPOSITORY ENDPOINTS
// ============================================================================

// Get all locators for a project (new project-based endpoint)
router.get('/projects/:projectId/locators', generalRateLimiter, asyncHandler(async (req, res) => {
  let projectId;
  try {
    projectId = validateAndDecodeProjectId(req.params.projectId);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
  
  try {
    const locators = await locatorService.loadLocators(projectId);
    res.json({
      success: true,
      locators: locators.map(loc => loc instanceof LocatorDefinition ? loc.toJSON() : loc),
      count: locators.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}));

// Save/Update a locator for a project (new project-based endpoint)
router.post('/projects/:projectId/locators', strictRateLimiter, asyncHandler(async (req, res) => {
  let projectId;
  try {
    projectId = validateAndDecodeProjectId(req.params.projectId);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
  const { pageName, elementName, locatorValue, locatorType, description } = req.body;
  
  if (!pageName || !elementName || !locatorValue) {
    return res.status(400).json({
      success: false,
      error: 'pageName, elementName, and locatorValue are required'
    });
  }
  
  try {
    // Check if locator already exists
    const existingLocator = await locatorService.getLocatorByPageAndElement(projectId, pageName, elementName);
    
    let locator;
    if (existingLocator) {
      // Update existing locator
      existingLocator.locatorValue = locatorValue;
      existingLocator.locatorType = locatorType || existingLocator.locatorType;
      existingLocator.description = description || existingLocator.description;
      existingLocator.lastUsed = new Date().toISOString();
      locator = existingLocator;
    } else {
      // Create new locator
      locator = new LocatorDefinition({
        pageName,
        elementName,
        locatorValue,
        locatorType: locatorType || 'css',
        description: description || `${pageName}.${elementName}`
      });
    }
    
    await locatorService.saveLocator(projectId, locator);
    
    res.json({
      success: true,
      message: existingLocator ? 'Locator updated successfully' : 'Locator saved successfully',
      locator: locator.toJSON()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}));

// Delete a locator (new project-based endpoint)
router.delete('/projects/:projectId/locators/:locatorId', strictRateLimiter, asyncHandler(async (req, res) => {
  let projectId;
  try {
    projectId = validateAndDecodeProjectId(req.params.projectId);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
  const locatorId = req.params.locatorId;
  
  try {
    const deleted = await locatorService.deleteLocator(projectId, locatorId);
    
    if (deleted) {
      res.json({
        success: true,
        message: 'Locator deleted successfully'
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Locator not found'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}));

// Get all locators for a project (legacy endpoint - kept for backward compatibility)
router.get('/locators/:projectName', generalRateLimiter, asyncHandler(async (req, res) => {
  const projectName = validateProjectName(req.params.projectName);
  const locators = await locatorService.loadLocators(projectName);
  res.json({
    success: true,
    projectName,
    locators: locators.map(loc => loc.toJSON()),
    count: locators.length
  });
}));

// Get locator by ID
router.get('/locators/:projectName/:locatorId', generalRateLimiter, asyncHandler(async (req, res) => {
  const projectName = validateProjectName(req.params.projectName);
  const locatorId = req.params.locatorId;
  const locator = await locatorService.getLocatorById(projectName, locatorId);
  
  if (!locator) {
    return res.status(404).json({
      success: false,
      error: 'Locator not found'
    });
  }
  
  res.json({
    success: true,
    locator: locator.toJSON()
  });
}));

// Get locators by page name
router.get('/locators/:projectName/page/:pageName', generalRateLimiter, asyncHandler(async (req, res) => {
  const projectName = validateProjectName(req.params.projectName);
  const pageName = req.params.pageName;
  const locators = await locatorService.getLocatorsByPage(projectName, pageName);
  res.json({
    success: true,
    projectName,
    pageName,
    locators: locators.map(loc => loc.toJSON()),
    count: locators.length
  });
}));

// Save a locator
router.post('/locators/:projectName', strictRateLimiter, asyncHandler(async (req, res) => {
  const projectName = validateProjectName(req.params.projectName);
  const locatorData = req.body;
  
  if (!locatorData.pageName || !locatorData.elementName) {
    return res.status(400).json({
      success: false,
      error: 'pageName and elementName are required'
    });
  }
  
  const locator = new LocatorDefinition(locatorData);
  await locatorService.saveLocator(projectName, locator);
  
  res.json({
    success: true,
    message: 'Locator saved successfully',
    locator: locator.toJSON()
  });
}));

// Delete a locator
router.delete('/locators/:projectName/:locatorId', strictRateLimiter, asyncHandler(async (req, res) => {
  const projectName = validateProjectName(req.params.projectName);
  const locatorId = req.params.locatorId;
  const deleted = await locatorService.deleteLocator(projectName, locatorId);
  
  if (!deleted) {
    return res.status(404).json({
      success: false,
      error: 'Locator not found'
    });
  }
  
  res.json({
    success: true,
    message: 'Locator deleted successfully'
  });
}));

// ============================================================================
// FLOWS ENDPOINTS
// ============================================================================

// Get all flows for a project
router.get('/projects/:projectId/flows', generalRateLimiter, asyncHandler(async (req, res) => {
  let projectId;
  try {
    projectId = validateAndDecodeProjectId(req.params.projectId);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
  
  try {
    const projectData = await projectService.loadProjectData(projectId);
    const flows = projectData.flows || [];
    
    res.json({
      success: true,
      flows: flows,
      count: flows.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}));

// Save a flow for a project
router.post('/projects/:projectId/flows', strictRateLimiter, asyncHandler(async (req, res) => {
  let projectId;
  try {
    projectId = validateAndDecodeProjectId(req.params.projectId);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
  const { name, steps } = req.body;
  
  if (!name || !steps || !Array.isArray(steps)) {
    return res.status(400).json({
      success: false,
      error: 'name and steps (array) are required'
    });
  }
  
  try {
    const projectData = await projectService.loadProjectData(projectId);
    if (!projectData.flows) projectData.flows = [];
    
    const flow = {
      id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      steps,
      createdAt: new Date().toISOString()
    };
    
    projectData.flows.push(flow);
    await projectService.saveProjectData(projectId, projectData);
    
    res.json({
      success: true,
      message: 'Flow saved successfully',
      flow: flow
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}));

// Delete a flow
router.delete('/projects/:projectId/flows/:flowId', strictRateLimiter, asyncHandler(async (req, res) => {
  let projectId;
  try {
    projectId = validateAndDecodeProjectId(req.params.projectId);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
  const flowId = req.params.flowId;
  
  try {
    const projectData = await projectService.loadProjectData(projectId);
    if (!projectData.flows) projectData.flows = [];
    
    const initialLength = projectData.flows.length;
    projectData.flows = projectData.flows.filter(f => f.id !== flowId);
    
    if (projectData.flows.length < initialLength) {
      await projectService.saveProjectData(projectId, projectData);
      res.json({
        success: true,
        message: 'Flow deleted successfully'
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Flow not found'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}));

// ============================================================================
// TEST DATA SETS ENDPOINTS
// ============================================================================

// Get all test data sets for a project
router.get('/projects/:projectId/test-data', generalRateLimiter, asyncHandler(async (req, res) => {
  let projectId;
  try {
    projectId = validateAndDecodeProjectId(req.params.projectId);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
  
  try {
    const projectData = await projectService.loadProjectData(projectId);
    const testDataSets = projectData.testDataSets || [];
    
    res.json({
      success: true,
      testDataSets: testDataSets,
      count: testDataSets.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}));

// Save a test data set for a project
router.post('/projects/:projectId/test-data', strictRateLimiter, asyncHandler(async (req, res) => {
  let projectId;
  try {
    projectId = validateAndDecodeProjectId(req.params.projectId);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
  const { name, examples } = req.body;
  
  if (!name || !examples || !Array.isArray(examples)) {
    return res.status(400).json({
      success: false,
      error: 'name and examples (array) are required'
    });
  }
  
  try {
    const projectData = await projectService.loadProjectData(projectId);
    if (!projectData.testDataSets) projectData.testDataSets = [];
    
    const testDataSet = {
      id: `testdata-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      examples,
      createdAt: new Date().toISOString()
    };
    
    projectData.testDataSets.push(testDataSet);
    await projectService.saveProjectData(projectId, projectData);
    
    res.json({
      success: true,
      message: 'Test data set saved successfully',
      testDataSet: testDataSet
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}));

// ============================================================================
// ENVIRONMENT ENDPOINTS
// ============================================================================

// Get all environments
router.get('/environments', generalRateLimiter, asyncHandler(async (req, res) => {
  const environments = await environmentService.loadEnvironments();
  res.json({
    success: true,
    environments: environments.map(env => env.toJSON()),
    count: environments.length
  });
}));

// Get environment by name
router.get('/environments/:name', generalRateLimiter, asyncHandler(async (req, res) => {
  const name = req.params.name;
  const environment = await environmentService.getEnvironment(name);
  
  if (!environment) {
    return res.status(404).json({
      success: false,
      error: 'Environment not found'
    });
  }
  
  res.json({
    success: true,
    environment: environment.toJSON()
  });
}));

// Save an environment
router.post('/environments', strictRateLimiter, asyncHandler(async (req, res) => {
  const envData = req.body;
  
  if (!envData.name || !envData.baseUrl) {
    return res.status(400).json({
      success: false,
      error: 'name and baseUrl are required'
    });
  }
  
  const environment = new Environment(envData);
  await environmentService.saveEnvironment(environment);
  
  res.json({
    success: true,
    message: 'Environment saved successfully',
    environment: environment.toJSON()
  });
}));

// Delete an environment
router.delete('/environments/:name', strictRateLimiter, asyncHandler(async (req, res) => {
  const name = req.params.name;
  const deleted = await environmentService.deleteEnvironment(name);
  
  if (!deleted) {
    return res.status(404).json({
      success: false,
      error: 'Environment not found'
    });
  }
  
  res.json({
    success: true,
    message: 'Environment deleted successfully'
  });
}));

// ============================================================================
// MAVEN ENDPOINTS
// ============================================================================

// Check if Maven is installed
router.get('/maven/check', generalRateLimiter, asyncHandler(async (req, res) => {
  const mavenStatus = await mavenService.checkMavenInstalled();
  res.json({
    success: true,
    ...mavenStatus
  });
}));

// Check if a project is a Maven project
router.get('/projects/:projectId/maven/check', generalRateLimiter, asyncHandler(async (req, res) => {
  let projectId;
  try {
    projectId = validateAndDecodeProjectId(req.params.projectId);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }

  try {
    const projectDir = projectService.getProjectDir(projectId);
    const isMaven = await mavenService.isMavenProject(projectDir);
    
    res.json({
      success: true,
      isMavenProject: isMaven,
      projectId,
      projectDir
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}));

// Execute Maven command
router.post('/projects/:projectId/maven/execute', strictRateLimiter, asyncHandler(async (req, res) => {
  let projectId;
  try {
    projectId = validateAndDecodeProjectId(req.params.projectId);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }

  const { command, args = [], timeout = 300000 } = req.body;

  if (!command) {
    return res.status(400).json({
      success: false,
      error: 'Maven command is required (e.g., "test", "clean", "install")'
    });
  }

  try {
    const projectDir = projectService.getProjectDir(projectId);
    
    // Check if it's a Maven project
    const isMaven = await mavenService.isMavenProject(projectDir);
    if (!isMaven) {
      return res.status(400).json({
        success: false,
        error: 'Project is not a Maven project (no pom.xml found)'
      });
    }

    // Check if Maven is installed before executing
    const mavenCheck = await mavenService.checkMavenInstalled();
    if (!mavenCheck.installed) {
      const errorMsg = mavenCheck.error && mavenCheck.error.includes('spawn mvn')
        ? 'Maven is not installed or not found in PATH. Please install Maven to run Java projects. See installation instructions in the error details.'
        : `Maven is not available: ${mavenCheck.error || 'Unknown error'}`;
      // T4.1 — Attach an AI-or-deterministic diagnosis to the response
      // so the IDE can surface a smart help panel instead of the static
      // install-instructions block. The helper itself fails-open
      // (returns deterministic guidance when Ollama isn't running), so
      // we can call it unconditionally.
      let aiDiagnosis = null;
      try {
        const { diagnoseError } = await import('../services/aiService.js');
        aiDiagnosis = await diagnoseError({
          context: 'running mvn for a Selenium / Cucumber Java project',
          error: errorMsg + '\n\nraw: ' + (mavenCheck.error || ''),
          hint: 'The user is on macOS (Homebrew available) and needs Maven on PATH.',
        });
      } catch (_) { /* best-effort — fall through to static instructions */ }
      return res.status(400).json({
        success: false,
        error: errorMsg,
        installationRequired: true,
        installationInstructions: {
          windows: 'Download from https://maven.apache.org/download.cgi or use chocolatey: choco install maven',
          macos: 'brew install maven',
          linux: 'sudo apt-get install maven (Ubuntu/Debian) or sudo yum install maven (RHEL/CentOS)'
        },
        aiDiagnosis,
      });
    }

    // Execute Maven command
    const result = await mavenService.executeMavenCommand(projectDir, command, args, { timeout });
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    // Check if error is about Maven not being installed
    const isInstallationError = error.message && (
      error.message.includes('not installed') || 
      error.message.includes('not found in PATH') ||
      error.message.includes('spawn mvn')
    );
    
    res.status(isInstallationError ? 400 : 500).json({
      success: false,
      error: error.message,
      installationRequired: isInstallationError
    });
  }
}));

// Get running Maven commands
router.get('/maven/running', generalRateLimiter, asyncHandler(async (req, res) => {
  const runningCommands = mavenService.getRunningCommands();
  res.json({
    success: true,
    runningCommands,
    count: runningCommands.length
  });
}));

// Cancel a running Maven command
router.post('/maven/cancel', generalRateLimiter, asyncHandler(async (req, res) => {
  const { executionId } = req.body;

  if (!executionId) {
    return res.status(400).json({
      success: false,
      error: 'Execution ID is required'
    });
  }

  const cancelled = await mavenService.cancelCommand(executionId);
  
  if (cancelled) {
    res.json({
      success: true,
      message: 'Maven command cancelled successfully',
      executionId
    });
  } else {
    res.status(404).json({
      success: false,
      error: 'Execution not found or already completed'
    });
  }
}));

// Log registered routes for debugging
console.log('[API Routes] Project management routes registered:');
console.log('  GET    /api/projects');
console.log('  GET    /api/projects/current');
console.log('  GET    /api/projects/:projectId');
console.log('  POST   /api/projects');
console.log('  POST   /api/projects/select');
console.log('  POST   /api/projects/:projectId/save');
console.log('  DELETE /api/projects/:projectId');
console.log('[API Routes] Maven routes registered:');
console.log('  GET    /api/maven/check');
console.log('  GET    /api/projects/:projectId/maven/check');
console.log('  POST   /api/projects/:projectId/maven/execute');
console.log('  GET    /api/maven/running');
console.log('  POST   /api/maven/cancel');

// ============================================================================
// NPM ENDPOINTS
// ============================================================================

// Check if npm is installed
router.get('/npm/check', generalRateLimiter, asyncHandler(async (req, res) => {
  const npmStatus = await npmService.checkNpmInstalled();
  res.json({
    success: true,
    ...npmStatus
  });
}));

// Check if a project is an npm project
router.get('/projects/:projectId/npm/check', generalRateLimiter, asyncHandler(async (req, res) => {
  let projectId;
  try {
    projectId = validateAndDecodeProjectId(req.params.projectId);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }

  try {
    const projectDir = projectService.getProjectDir(projectId);
    const isNpm = await npmService.isNpmProject(projectDir);
    
    res.json({
      success: true,
      isNpmProject: isNpm,
      projectId,
      projectDir
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}));

// Execute npm command
router.post('/projects/:projectId/npm/execute', strictRateLimiter, asyncHandler(async (req, res) => {
  let projectId;
  try {
    projectId = validateAndDecodeProjectId(req.params.projectId);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }

  const { command, args = [], timeout = 300000 } = req.body;

  if (!command) {
    return res.status(400).json({
      success: false,
      error: 'npm command is required (e.g., "test", "install", "run build")'
    });
  }

  try {
    const projectDir = projectService.getProjectDir(projectId);
    
    // Check if it's an npm project
    const isNpm = await npmService.isNpmProject(projectDir);
    if (!isNpm) {
      return res.status(400).json({
        success: false,
        error: 'Project is not an npm project (no package.json found)'
      });
    }

    // Execute npm command
    const result = await npmService.executeNpmCommand(projectDir, command, args, { timeout });
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}));

// Get running npm commands
router.get('/npm/running', generalRateLimiter, asyncHandler(async (req, res) => {
  const runningCommands = npmService.getRunningCommands();
  res.json({
    success: true,
    runningCommands,
    count: runningCommands.length
  });
}));

// Cancel a running npm command
router.post('/npm/cancel', generalRateLimiter, asyncHandler(async (req, res) => {
  const { executionId } = req.body;

  if (!executionId) {
    return res.status(400).json({
      success: false,
      error: 'Execution ID is required'
    });
  }

  const cancelled = await npmService.cancelCommand(executionId);
  
  if (cancelled) {
    res.json({
      success: true,
      message: 'npm command cancelled successfully',
      executionId
    });
  } else {
    res.status(404).json({
      success: false,
      error: 'Execution not found or already completed'
    });
  }
}));

console.log('[API Routes] NPM routes registered:');
console.log('  GET    /api/npm/check');
console.log('  GET    /api/projects/:projectId/npm/check');
console.log('  POST   /api/projects/:projectId/npm/execute');
console.log('  GET    /api/npm/running');
console.log('  POST   /api/npm/cancel');

// ----------------------------------------------------------------------------
// AI endpoints — local-only LLM (Ollama) for locator suggestion
// ----------------------------------------------------------------------------
//
// Both endpoints are SAFE to call when no AI provider is configured:
//   GET  /api/ai/info             always returns 200 with provider info
//   POST /api/ai/suggest-locator  returns { ok:false, reason:... } gracefully
//                                 so the UI can show a helpful message
//                                 without falling over.
//
// We import lazily inside the handler so module-load can't ever block on
// a stuck Ollama probe.

router.get('/ai/info', asyncHandler(async (req, res) => {
  const { getAiProvider } = await import('../services/aiService.js');
  const provider = await getAiProvider();
  res.json({
    available: provider.available(),
    ...provider.info(),
  });
}));

router.post('/ai/suggest-locator', asyncHandler(async (req, res) => {
  const { failedSelector, htmlSnippet, elementHint } = req.body || {};
  if (!failedSelector || typeof failedSelector !== 'string') {
    return res.status(400).json({
      ok: false,
      error: 'failedSelector (string) is required',
    });
  }
  const { getAiProvider } = await import('../services/aiService.js');
  const provider = await getAiProvider();
  if (!provider.available()) {
    return res.json({
      ok: false,
      reason: provider.info().reason || 'No AI provider configured',
      provider: provider.info(),
      suggestion: null,
    });
  }
  const start = Date.now();
  const result = await provider.suggestLocator({
    failedSelector,
    htmlSnippet: htmlSnippet || '',
    elementHint: elementHint || '',
  });
  res.json({
    ...result,
    provider: provider.info(),
    elapsedMs: Date.now() - start,
  });
}));

// T3.2 — AI ranking of recorded selectors. Used by the recorder UI on
// demand: pass an array of candidate selectors + a small page snippet,
// the model returns them re-ordered with confidence scores. We wrap
// the existing utils/locatorQuality scorer for the deterministic
// baseline AND ask the AI to express a preference; final score is a
// weighted blend (60% deterministic, 40% AI). When AI is unavailable
// we just return the deterministic ranking — never a hard error.
router.post('/ai/rank-locators', asyncHandler(async (req, res) => {
  const { candidates, htmlSnippet, elementHint } = req.body || {};
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return res.status(400).json({ ok: false, error: 'candidates (non-empty array) required' });
  }
  // 1. Deterministic baseline.
  const { rankCandidates } = await import('../utils/locatorQuality.js');
  const detRanked = rankCandidates(candidates);

  // 2. AI overlay (best-effort). We ask the model to pick the BEST
  // selector for the snippet from the supplied list; the chosen
  // selector gets a +20 boost on the blended score, others stay at
  // their deterministic score.
  const { getAiProvider } = await import('../services/aiService.js');
  const provider = await getAiProvider();
  let aiPick = null;
  let aiInfo = provider.info();
  if (provider.available()) {
    try {
      // Reuse suggestLocator to get the AI's preferred selector. The
      // prompt steers it toward the best of OUR options by including
      // them in the elementHint.
      const optList = detRanked.slice(0, 8).map((c, i) => `${i + 1}. ${c.selector}`).join('\n');
      const resp = await provider.suggestLocator({
        failedSelector: '(rank these candidates)',
        elementHint: (elementHint || '') + '\n\nChoose the most reliable from:\n' + optList,
        htmlSnippet: htmlSnippet || '',
      }).catch(() => null);
      const sug = resp && resp.ok && resp.suggestion;
      if (sug) {
        // Match exact OR substring against the offered list.
        aiPick = detRanked.find((c) => c.selector === sug) ||
                 detRanked.find((c) => c.selector.includes(sug)) ||
                 detRanked.find((c) => sug.includes(c.selector));
      }
    } catch (e) {
      console.warn('[AI rank] suggest call failed:', e.message);
    }
  }
  // 3. Blend.
  const ranked = detRanked.map((c) => {
    const aiBoost = (aiPick && aiPick.selector === c.selector) ? 20 : 0;
    const blended = Math.min(100, Math.max(0, Math.round((c.confidence || 0) * 0.6 + aiBoost + (c.confidence || 0) * 0.4)));
    return Object.assign({}, c, {
      blendedConfidence: blended,
      aiPreferred: !!(aiPick && aiPick.selector === c.selector),
    });
  });
  ranked.sort((a, b) => b.blendedConfidence - a.blendedConfidence);
  res.json({
    ok: true,
    ranked,
    aiAvailable: provider.available(),
    aiProvider: aiInfo,
  });
}));

// T4.1 — General AI diagnostic helper. Thin route over
// services/aiService.js#diagnoseError. The helper handles deterministic
// fallback when Ollama isn't available, so this route ALWAYS returns
// 200 with a structured payload (no fail-open hard errors here).
router.post('/ai/diagnose', asyncHandler(async (req, res) => {
  const { context, error, hint } = req.body || {};
  if (!error || typeof error !== 'string') {
    return res.status(400).json({ ok: false, error: 'error (string) is required' });
  }
  const { diagnoseError } = await import('../services/aiService.js');
  const result = await diagnoseError({ context, error, hint });
  res.json(result);
}));

// [ZAC-FIX] FIX 8 — generic chat passthrough for the AI Assistant panel.
// The browser would otherwise hit http://localhost:11434 directly and get
// blocked by Ollama's CORS allow-list. Routing through the ZAC server is
// same-origin from the dashboard's perspective, so no CORS preflight.
//
// Body: { message: string, system?: string, model?: string }
// Always returns 200 with { ok, response, model, baseUrl, reason? }.
router.post('/ai/chat', asyncHandler(async (req, res) => {
  const { message, system, model } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ ok: false, error: 'message (string) is required' });
  }
  const { getAiProvider } = await import('../services/aiService.js');
  const provider = await getAiProvider();
  if (!provider.available()) {
    const info = provider.info();
    return res.json({
      ok: false,
      reason: info.reason || 'AI provider not configured',
      response: '',
      provider: info,
    });
  }
  const start = Date.now();
  const result = await provider.chat({ prompt: message, system, model });
  res.json({
    ...result,
    provider: provider.info(),
    elapsedMs: Date.now() - start,
  });
}));

// Runtime AI on/off toggle. Body: { mode: 'on' | 'off' | 'auto' }
// Powers the dashboard's AI switch — lets users flip the local LLM on
// without restarting the server. Always returns 200 with a structured
// payload (including ok:false) so the UI can render a clear message
// when Ollama isn't installed.
router.post('/ai/toggle', asyncHandler(async (req, res) => {
  const mode = String(req.body?.mode || '').toLowerCase();
  if (!['on', 'off', 'auto'].includes(mode)) {
    return res.status(400).json({ ok: false, error: 'mode must be "on", "off", or "auto"' });
  }
  const { setAiProvider } = await import('../services/aiService.js');
  const result = await setAiProvider(mode);
  res.json(result);
}));

console.log('[API Routes] AI routes registered:');
console.log('  GET    /api/ai/info');
console.log('  POST   /api/ai/suggest-locator');
console.log('  POST   /api/ai/chat');
console.log('  POST   /api/ai/toggle');
console.log('[API Routes] [ZAC-FIX] new routes registered:');
console.log('  POST   /api/projects/:id/manual-edits   (FIX A: editor writeback)');
console.log('  POST   /api/runs/append                 (FIX C: rerun history)');
console.log('  GET    /api/runs/history                (FIX C: dashboard feed)');

// ----------------------------------------------------------------------------
// Dashboard stats — aggregates across generated-projects/ and rerun reports
// ----------------------------------------------------------------------------

router.get('/dashboard/stats', asyncHandler(async (req, res) => {
  // [ZAC-FIX] Default existingOnly=true — the dashboard should reflect
  // projects the user can still load in the Recording tab, not every
  // leftover directory under generated-projects/. Pass ?existingOnly=false
  // to opt back into the old "show everything" view (orphan toggle in UI).
  const { collectDashboardStats } = await import('../services/dashboardService.js');
  const existingOnly = req.query.existingOnly === undefined
    ? true
    : (String(req.query.existingOnly) !== 'false');
  const stats = await collectDashboardStats({ existingOnly });
  res.json(stats);
}));

// Live activity snapshot — what's happening RIGHT NOW. Polled every 2s
// by the dashboard's live panel. Cheap (in-memory only) so we can sustain
// the polling without affecting recorder/rerun throughput.
//
// Includes `lastRerunCompleted` (set by markRerunCompleted from the rerun
// finalize block) so the dashboard can detect a freshly-completed rerun
// and refresh the heavier /api/dashboard/stats endpoint without polling
// it on a fixed schedule.
router.get('/dashboard/live', asyncHandler(async (req, res) => {
  const { collectLiveSnapshot } = await import('../services/dashboardService.js');
  const snap = collectLiveSnapshot({
    activeSessions: browserService.activeSessions,
    runningReruns,
  });
  res.json(snap);
}));

// Self-contained HTML report download for a single rerun.
// Query: ?path=<fw>/<project>/reruns/<test>/<timestamp>
// Headers force a download; the file embeds all CSS so it works offline
// and prints cleanly to PDF (File → Print → Save as PDF).
// [ZAC-FIX 2026-05-24] List the artefacts (files in each subdir)
// produced for one rerun so the report.html page can render real
// per-file links instead of broken directory-listing links.
//
// /reports/<path> serves files via express.static({index:false}),
// which intentionally returns 404 on a bare directory. Without
// this endpoint the user sees broken links for report/, screenshots/,
// videos/, traces/, logs/.
//
// Response shape:
//   {
//     ok: true,
//     replayResult: { url, bytes },              // top-level
//     htmlReport:   { url, bytes } | null,       // report/index.html
//     report:       Array<{ name, url, bytes }>, // report/* (excl. index.html)
//     screenshots:  Array<{ name, url, bytes }>,
//     videos:       Array<{ name, url, bytes }>,
//     traces:       Array<{ name, url, bytes }>,
//     logs:         Array<{ name, url, bytes }>,
//   }
router.get('/dashboard/list-files', asyncHandler(async (req, res) => {
  const reportPath = String(req.query.path || '');
  if (!reportPath) return res.status(400).json({ ok: false, error: 'Missing ?path=' });
  const fsp = await import('fs/promises');
  const pathLib = await import('path');
  const { decodeReportPath } = await import('../services/reportRenderer.js');
  let parts;
  try {
    parts = decodeReportPath(reportPath, pathLib.resolve('generated-projects'));
  } catch (e) {
    return res.status(400).json({ ok: false, error: `Bad path: ${e.message}` });
  }
  const rerunRoot = pathLib.dirname(parts.replayResultPath);
  async function listDir(name) {
    try {
      const dir = pathLib.join(rerunRoot, name);
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      const out = [];
      for (const e of entries) {
        if (!e.isFile()) continue;
        const stat = await fsp.stat(pathLib.join(dir, e.name)).catch(() => ({ size: 0 }));
        out.push({
          name: e.name,
          url: `/reports/${reportPath}/${name}/${encodeURIComponent(e.name)}`,
          bytes: stat.size,
        });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    } catch (_) { return []; }
  }
  const [reportFiles, screenshots, videos, traces, logs] = await Promise.all([
    listDir('report'), listDir('screenshots'), listDir('videos'), listDir('traces'), listDir('logs'),
  ]);
  // Promote the rendered HTML report (if present) to a top-level field.
  const htmlIdx = reportFiles.findIndex(f => f.name === 'index.html');
  let htmlReport = null;
  if (htmlIdx >= 0) {
    htmlReport = reportFiles[htmlIdx];
    reportFiles.splice(htmlIdx, 1);
  }
  let replayBytes = 0;
  try { replayBytes = (await fsp.stat(parts.replayResultPath)).size; } catch (_) {}
  res.json({
    ok: true,
    replayResult: { url: `/reports/${reportPath}/replay-result.json`, bytes: replayBytes },
    htmlReport,
    report: reportFiles,
    screenshots, videos, traces, logs,
  });
}));

router.get('/dashboard/report/html', asyncHandler(async (req, res) => {
  const reportPath = String(req.query.path || '');
  if (!reportPath) return res.status(400).send('Missing ?path=<framework>/<project>/reruns/<test>/<timestamp>');

  const { renderHtmlReport, decodeReportPath } = await import('../services/reportRenderer.js');
  const fsp = await import('fs/promises');
  const pathLib = await import('path');

  let parts;
  try {
    parts = decodeReportPath(reportPath, pathLib.resolve('generated-projects'));
  } catch (e) {
    return res.status(400).send(`Bad path: ${e.message}`);
  }

  let replay;
  try {
    replay = JSON.parse(await fsp.readFile(parts.replayResultPath, 'utf8'));
  } catch (e) {
    return res.status(404).send(`replay-result.json not found at ${parts.relPath}`);
  }

  // T2.7 — read any PNG/JPG/WEBP under reruns/<ts>/screenshots/ and pass
  // them as base64 data URLs so the resulting HTML is fully self-contained
  // (works offline, in email, in archive). Cap each image at ~2 MB so a
  // pathological 4K screenshot doesn't bloat the report past memory.
  const screenshots = {};
  try {
    const shotsDir = path.dirname(parts.replayResultPath) + '/screenshots';
    const entries = await fsp.readdir(shotsDir, { withFileTypes: true }).catch(() => []);
    const TWO_MB = 2 * 1024 * 1024;
    const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const ext = pathLib.extname(ent.name).toLowerCase();
      const mime = MIME_BY_EXT[ext];
      if (!mime) continue;
      const filePath = pathLib.join(shotsDir, ent.name);
      const stat = await fsp.stat(filePath).catch(() => null);
      if (!stat || stat.size > TWO_MB) continue;
      const buf = await fsp.readFile(filePath).catch(() => null);
      if (!buf) continue;
      screenshots[ent.name] = `data:${mime};base64,${buf.toString('base64')}`;
    }
  } catch (e) {
    console.warn('[Report] screenshot load failed (non-fatal):', e.message);
  }

  const html = renderHtmlReport({
    replayResult: replay,
    reportPath: parts.relPath,
    generatedAt: new Date().toISOString(),
    screenshots,
  });
  // Friendly file-name: <framework>-<project>-<test>-<timestamp>.html
  const filename = `${parts.framework}-${parts.project}-${parts.testName}-${parts.timestamp}.html`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(html);
}));

// T3.9 — Native PDF download. Renders the same HTML report we serve at
// /report/html and runs it through Playwright's headless `page.pdf()`,
// honouring the report's print stylesheet (banner hidden, full-bleed
// step table, screenshots embedded as data URLs). Output is a real
// PDF, not a "save-as-pdf-from-print-dialog" workaround.
//
// Note: this spawns a short-lived Chromium instance for each request.
// We cap concurrent PDF renders inline so a flood of requests can't
// exhaust file handles. The first PDF after server boot is slower
// (~1.5s) due to Chromium cold start; subsequent renders are <500ms.
const PDF_CONCURRENCY_LIMIT = 2;
let _pdfInFlight = 0;
router.get('/dashboard/report/pdf', generalRateLimiter, asyncHandler(async (req, res) => {
  if (_pdfInFlight >= PDF_CONCURRENCY_LIMIT) {
    return res.status(429).json({ error: 'PDF render queue full; retry shortly.' });
  }
  const reportPath = String(req.query.path || '');
  if (!reportPath) return res.status(400).send('Missing ?path=<framework>/<project>/reruns/<test>/<timestamp>');

  const { renderHtmlReport, decodeReportPath } = await import('../services/reportRenderer.js');
  const fsp = await import('fs/promises');
  const pathLib = await import('path');

  let parts;
  try {
    parts = decodeReportPath(reportPath, pathLib.resolve('generated-projects'));
  } catch (e) {
    return res.status(400).send(`Bad path: ${e.message}`);
  }

  let replay;
  try {
    replay = JSON.parse(await fsp.readFile(parts.replayResultPath, 'utf8'));
  } catch (e) {
    return res.status(404).send(`replay-result.json not found at ${parts.relPath}`);
  }

  // Reuse the exact same HTML the /report/html endpoint emits — single
  // source of truth, so PDF and HTML can never drift apart.
  const screenshots = {};
  try {
    const shotsDir = pathLib.dirname(parts.replayResultPath) + '/screenshots';
    const entries = await fsp.readdir(shotsDir, { withFileTypes: true }).catch(() => []);
    const TWO_MB = 2 * 1024 * 1024;
    const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const ext = pathLib.extname(ent.name).toLowerCase();
      const mime = MIME_BY_EXT[ext];
      if (!mime) continue;
      const filePath = pathLib.join(shotsDir, ent.name);
      const stat = await fsp.stat(filePath).catch(() => null);
      if (!stat || stat.size > TWO_MB) continue;
      const buf = await fsp.readFile(filePath).catch(() => null);
      if (!buf) continue;
      screenshots[ent.name] = `data:${mime};base64,${buf.toString('base64')}`;
    }
  } catch { /* ignore */ }

  const html = renderHtmlReport({
    replayResult: replay,
    reportPath: parts.relPath,
    generatedAt: new Date().toISOString(),
    screenshots,
  });

  _pdfInFlight++;
  let browser = null;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 15000 });
    // Force the print media so our @media print rules fire — the HTML
    // already has print styles that hide the download banner, etc.
    await page.emulateMedia({ media: 'print' });
    const pdfBuf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
    });
    await browser.close().catch(() => {});
    browser = null;

    const filename = `${parts.framework}-${parts.project}-${parts.testName}-${parts.timestamp}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuf);
  } catch (e) {
    if (browser) try { await browser.close(); } catch { /* ignore */ }
    res.status(500).json({ error: 'PDF render failed: ' + e.message });
  } finally {
    _pdfInFlight = Math.max(0, _pdfInFlight - 1);
  }
}));

// T4.4 — Dashboard "Clear" endpoint. Destructive: removes rerun data
// under generated-projects/<framework>/<project>/reruns/. Filter-aware:
// when `framework` or `projectId` is provided, ONLY entries matching
// the filter are removed — runs that the user filtered TO see are
// preserved by default. Pass `preserve: true` to invert (keep only
// the filtered subset, clear everything else).
//
// Behaviour matrix:
//   • body = {}                            → clear ALL rerun dirs (every project)
//   • body = { framework: 'playwright-java' } → clear only that framework's reruns
//   • body = { framework, projectId }       → clear only that project's reruns
//   • body = { projectId, preserve: true }  → clear EVERYTHING EXCEPT that project
//   • body = { confirm: true } MUST be present — guard against accidents
router.post('/dashboard/clear', strictRateLimiter, asyncHandler(async (req, res) => {
  const {
    framework = null,
    projectId = null,
    preserve = false,
    confirm = false,
    // [ZAC-FIX 2026-05-24] New scoping options requested by QA:
    //   testName        — limit to one test name within a project's reruns/
    //   timestamp       — limit to ONE specific rerun (the YYYY...Z dir)
    //   olderThanDays   — only remove rerun timestamps older than N days
    testName = null,
    timestamp = null,
    olderThanDays = null,
  } = req.body || {};
  if (!confirm) {
    return res.status(400).json({
      success: false,
      error: 'Destructive: pass { confirm: true } to proceed. See body schema.',
    });
  }
  const fsp = await import('fs/promises');
  const pathLib = await import('path');
  const GENERATED_ROOT = pathLib.resolve('generated-projects');
  // Compute the cutoff once. Reruns whose mtime is *older* than the
  // cutoff get deleted; everything newer is preserved.
  const cutoffMs = (typeof olderThanDays === 'number' && olderThanDays > 0)
    ? Date.now() - olderThanDays * 24 * 60 * 60 * 1000
    : null;

  const removed = [];
  const skipped = [];

  // Walk generated-projects/<framework>/<projectId>/reruns/* and delete
  // the entire reruns subtree (or matching subset). We never touch the
  // surrounding project (pom.xml, page-objects, features, etc.) — only
  // the reruns/ directory, so re-runs can start fresh.
  const frameworkDirs = await fsp.readdir(GENERATED_ROOT, { withFileTypes: true }).catch(() => []);
  for (const fwEnt of frameworkDirs) {
    if (!fwEnt.isDirectory()) continue;
    const fwName = fwEnt.name;

    // Framework-level filtering. When both `framework` and `projectId` are
    // supplied, defer the framework check to the project loop so the
    // "preserve a SPECIFIC project" path works correctly.
    if (framework && !projectId) {
      if (!preserve && fwName !== framework) { skipped.push({ framework: fwName, reason: 'framework-mismatch' }); continue; }
      if (preserve  && fwName === framework) { skipped.push({ framework: fwName, reason: 'preserved-framework' }); continue; }
    }
    if (framework && projectId && fwName !== framework) {
      // Both filters set + this framework doesn't match → skip silently
      // regardless of preserve mode (the user is targeting one specific
      // project; other frameworks aren't candidates).
      skipped.push({ framework: fwName, reason: 'framework-mismatch' });
      continue;
    }

    const fwRoot = pathLib.join(GENERATED_ROOT, fwName);
    const projectDirs = await fsp.readdir(fwRoot, { withFileTypes: true }).catch(() => []);
    for (const pjEnt of projectDirs) {
      if (!pjEnt.isDirectory()) continue;
      const pjName = pjEnt.name;
      if (projectId && !preserve && pjName !== projectId) { skipped.push({ framework: fwName, project: pjName, reason: 'project-mismatch' }); continue; }
      if (projectId && preserve && pjName === projectId) { skipped.push({ framework: fwName, project: pjName, reason: 'preserved-project' }); continue; }
      const rerunsDir = pathLib.join(fwRoot, pjName, 'reruns');
      try {
        const stat = await fsp.stat(rerunsDir).catch(() => null);
        if (!stat || !stat.isDirectory()) {
          skipped.push({ framework: fwName, project: pjName, reason: 'no-reruns-dir' });
          continue;
        }
        // [ZAC-FIX 2026-05-24] Granular delete: when testName / timestamp /
        // olderThanDays is set, walk the rerun tree and delete only the
        // matching timestamp directories instead of nuking the whole
        // reruns/ subtree.
        const isGranular = (testName || timestamp || cutoffMs !== null);
        let rerunCount = 0;
        if (isGranular) {
          const tests = await fsp.readdir(rerunsDir, { withFileTypes: true }).catch(() => []);
          for (const t of tests) {
            if (!t.isDirectory()) continue;
            if (testName && t.name !== testName) continue;
            const testDir = pathLib.join(rerunsDir, t.name);
            const tsDirs = await fsp.readdir(testDir, { withFileTypes: true }).catch(() => []);
            for (const tsEnt of tsDirs) {
              if (!tsEnt.isDirectory()) continue;
              if (timestamp && tsEnt.name !== timestamp) continue;
              const tsPath = pathLib.join(testDir, tsEnt.name);
              if (cutoffMs !== null) {
                const tsStat = await fsp.stat(tsPath).catch(() => null);
                if (!tsStat || tsStat.mtimeMs >= cutoffMs) continue; // newer → preserve
              }
              await fsp.rm(tsPath, { recursive: true, force: true });
              rerunCount++;
            }
          }
          if (rerunCount > 0) {
            removed.push({ framework: fwName, project: pjName, rerunsRemoved: rerunCount,
              filter: { testName, timestamp, olderThanDays } });
          } else {
            skipped.push({ framework: fwName, project: pjName, reason: 'no-matching-runs' });
          }
        } else {
          // Bulk path: count + nuke + recreate empty dir for project scaffold.
          const tests = await fsp.readdir(rerunsDir, { withFileTypes: true }).catch(() => []);
          for (const t of tests) {
            if (!t.isDirectory()) continue;
            const tsDirs = await fsp.readdir(pathLib.join(rerunsDir, t.name), { withFileTypes: true }).catch(() => []);
            rerunCount += tsDirs.filter((d) => d.isDirectory()).length;
          }
          await fsp.rm(rerunsDir, { recursive: true, force: true });
          await fsp.mkdir(rerunsDir, { recursive: true }).catch(() => {});
          removed.push({ framework: fwName, project: pjName, rerunsRemoved: rerunCount });
        }
      } catch (e) {
        skipped.push({ framework: fwName, project: pjName, reason: 'error: ' + e.message });
      }
    }
  }

  // T4.2 — bump the rerun-completed marker so connected dashboards
  // refresh their stats immediately after a clear (otherwise the stat
  // cards would lag for up to 30s showing stale totals).
  try {
    const { markRerunCompleted } = await import('../services/dashboardService.js');
    markRerunCompleted({ executionId: 'cleared-by-user', framework, projectId, success: true });
  } catch (_) { /* best-effort */ }

  const total = removed.reduce((s, r) => s + r.rerunsRemoved, 0);
  res.json({
    success: true,
    removed,
    skipped,
    rerunsRemoved: total,
    filter: { framework, projectId, preserve },
  });
}));

// (POST /api/dashboard/clear is registered earlier in this file with the
//  full preserve-flag contract. Don't add a second handler here — Express
//  would silently call only the first one and the second would be dead code.)
console.log('  GET    /api/dashboard/report/pdf?path=...');
console.log('  POST   /api/dashboard/clear  body={framework?, projectId?, preserve?, confirm:true}');

// ----------------------------------------------------------------------------
// [ZAC-FIX] /dashboard/framework-summary — per-framework projection cards
// ----------------------------------------------------------------------------
// Aggregates the existing /api/dashboard/stats output into one row per
// framework so the dashboard can render a card grid showing:
//   - project count
//   - total reruns
//   - passed / failed counts
//   - pass rate
//   - heal event count
//   - latest run timestamp
//   - link target for "show only this framework's runs"
// Pure read; no destructive ops. Cheap (delegates to collectDashboardStats).
router.get('/dashboard/framework-summary', pollingRateLimiter, asyncHandler(async (req, res) => {
  const { collectDashboardStats } = await import('../services/dashboardService.js');
  const existingOnly = req.query.existingOnly === undefined
    ? true
    : (String(req.query.existingOnly) !== 'false');
  const stats = await collectDashboardStats({ existingOnly });
  const byFw = new Map();
  // Seed with all frameworks ZAC knows about so a framework with 0 runs
  // still gets a card (and the QA can see "selenium-testng — 0 projects").
  for (const f of stats.frameworks || []) {
    byFw.set(f.id, {
      framework: f.id,
      projectCount: f.projectCount || 0,
      totalReruns: 0,
      passed: 0,
      failed: 0,
      healed: 0,
      lastRunAt: null,
      lastRun: null,
    });
  }
  for (const r of stats.reruns || []) {
    if (!byFw.has(r.framework)) {
      byFw.set(r.framework, {
        framework: r.framework, projectCount: 0,
        totalReruns: 0, passed: 0, failed: 0, healed: 0,
        lastRunAt: null, lastRun: null,
      });
    }
    const row = byFw.get(r.framework);
    row.totalReruns++;
    if (r.status === 'passed') row.passed++;
    else if (r.status === 'failed') row.failed++;
    row.healed += Number(r.healingHits || 0);
    if (!row.lastRunAt || (r.timestamp || '') > row.lastRunAt) {
      row.lastRunAt = r.timestamp || null;
      row.lastRun = {
        projectId: r.projectId,
        testName: r.testName,
        status: r.status,
        // Same shape as dashboard.js#reportHref so the card link goes to
        // the existing report viewer.
        reportPath: `${r.framework}/${r.projectId}/reruns/${r.testName}/${r.timestamp}`,
      };
    }
  }
  // Add per-framework projects from stats.projects (covers projects that
  // never had a rerun yet).
  for (const p of stats.projects || []) {
    if (!byFw.has(p.framework)) {
      byFw.set(p.framework, {
        framework: p.framework, projectCount: 0,
        totalReruns: 0, passed: 0, failed: 0, healed: 0,
        lastRunAt: null, lastRun: null,
      });
    }
  }
  const rows = Array.from(byFw.values()).map(r => ({
    ...r,
    passRatePct: r.totalReruns === 0 ? null
      : Math.round((r.passed / r.totalReruns) * 1000) / 10,
  }));
  // Sort: most active first, then by projectCount desc, then alphabetic.
  rows.sort((a, b) => {
    if (b.totalReruns !== a.totalReruns) return b.totalReruns - a.totalReruns;
    if (b.projectCount !== a.projectCount) return b.projectCount - a.projectCount;
    return String(a.framework).localeCompare(String(b.framework));
  });
  res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    frameworks: rows,
    totals: {
      frameworks: rows.length,
      projects: rows.reduce((s, r) => s + r.projectCount, 0),
      reruns: rows.reduce((s, r) => s + r.totalReruns, 0),
      heals: rows.reduce((s, r) => s + r.healed, 0),
    },
  });
}));
console.log('  GET    /api/dashboard/framework-summary');

// ----------------------------------------------------------------------------
// [ZAC-FIX] /dashboard/clear-locators — wipe healed-locators.json files
// ----------------------------------------------------------------------------
// The existing /dashboard/clear only removes reruns/ subtrees. The
// "Locator-stability snapshot" panel ALSO reads from healed-locators.json
// files which previously had no clear path, so the panel kept showing
// stale heal counts. This endpoint wipes them.
//
// Body: { projectId?, framework?, confirm:true }
//   • {} + confirm:true                       → wipe ALL projects' heal logs
//   • { projectId, confirm:true }             → wipe just that project
//   • { framework, confirm:true }             → wipe every project under a framework
//
// Targets two locations because the heal log can be written to either:
//   1. projects/<projectId>/healed-locators.json    (recording-time)
//   2. generated-projects/<framework>/<projectId>/locators/healed-locators.json (rerun-time)
router.post('/dashboard/clear-locators', strictRateLimiter, asyncHandler(async (req, res) => {
  const { framework = null, projectId = null, confirm = false, includeRerunHistory = true } = req.body || {};
  if (!confirm) {
    return res.status(400).json({ ok: false, error: 'Destructive: pass { confirm: true } to proceed.' });
  }
  const fsp = await import('fs/promises');
  const pathLib = (await import('path')).default;
  const PROJECTS_ROOT = pathLib.resolve('projects');
  const GENERATED_ROOT = pathLib.resolve('generated-projects');

  const cleared = [];
  const skipped = [];
  // [ZAC-FIX] expanded scope: ALSO zero healingHits in replay-result.json so
  // the Locator-stability snapshot's "Healing events" column actually goes
  // to 0 (its source is the rerun results file, not healed-locators.json).
  // Set includeRerunHistory:false in the body to keep the old behaviour.
  const rerunHealsZeroed = [];

  async function tryClear(filePath, meta) {
    try {
      const stat = await fsp.stat(filePath).catch(() => null);
      if (!stat || !stat.isFile()) {
        skipped.push({ ...meta, reason: 'no-heal-log' });
        return;
      }
      await fsp.writeFile(filePath, JSON.stringify({ entries: [], clearedAt: new Date().toISOString() }, null, 2));
      cleared.push({ ...meta, file: filePath });
    } catch (e) {
      skipped.push({ ...meta, reason: 'error: ' + e.message });
    }
  }

  async function zeroHealingHitsInRerunResults(projectRoot, meta) {
    try {
      const rerunsDir = pathLib.join(projectRoot, 'reruns');
      const stat = await fsp.stat(rerunsDir).catch(() => null);
      if (!stat || !stat.isDirectory()) return;
      // Walk reruns/<testName>/<timestamp>/replay-result.json and zero the
      // healingHits counters. Preserve everything else so the timing,
      // pass/fail, and step records survive the reset.
      const tests = await fsp.readdir(rerunsDir, { withFileTypes: true }).catch(() => []);
      for (const t of tests) {
        if (!t.isDirectory()) continue;
        const tsDirs = await fsp.readdir(pathLib.join(rerunsDir, t.name), { withFileTypes: true }).catch(() => []);
        for (const ts of tsDirs) {
          if (!ts.isDirectory()) continue;
          const replayPath = pathLib.join(rerunsDir, t.name, ts.name, 'replay-result.json');
          try {
            const raw = await fsp.readFile(replayPath, 'utf8');
            const data = JSON.parse(raw);
            const before = Number(data.healingHits || 0);
            if (before === 0) continue;
            data.healingHits = 0;
            data.healingHitsClearedAt = new Date().toISOString();
            // Also zero per-step healing flags if present.
            if (Array.isArray(data.results)) {
              for (const step of data.results) {
                if (step && step.healed) step.healed = false;
              }
            }
            await fsp.writeFile(replayPath, JSON.stringify(data, null, 2));
            rerunHealsZeroed.push({ ...meta, test: t.name, timestamp: ts.name, healingHitsWas: before });
          } catch (_) { /* skip unreadable / non-json */ }
        }
      }
    } catch (_) { /* skip */ }
  }

  // 1) Recording-time logs in projects/<id>/healed-locators.json
  const projectDirs = await fsp.readdir(PROJECTS_ROOT, { withFileTypes: true }).catch(() => []);
  for (const ent of projectDirs) {
    if (!ent.isDirectory()) continue;
    if (projectId && ent.name !== projectId) { skipped.push({ scope: 'projects', project: ent.name, reason: 'project-mismatch' }); continue; }
    await tryClear(
      pathLib.join(PROJECTS_ROOT, ent.name, 'healed-locators.json'),
      { scope: 'projects', project: ent.name }
    );
  }

  // 2) Rerun-time logs (and optionally their healingHits counters) under
  //    generated-projects/<fw>/<pj>/{locators,reruns}/.
  const fwDirs = await fsp.readdir(GENERATED_ROOT, { withFileTypes: true }).catch(() => []);
  for (const fwEnt of fwDirs) {
    if (!fwEnt.isDirectory()) continue;
    if (framework && fwEnt.name !== framework) { skipped.push({ scope: 'generated', framework: fwEnt.name, reason: 'framework-mismatch' }); continue; }
    const fwRoot = pathLib.join(GENERATED_ROOT, fwEnt.name);
    const pjDirs = await fsp.readdir(fwRoot, { withFileTypes: true }).catch(() => []);
    for (const pjEnt of pjDirs) {
      if (!pjEnt.isDirectory()) continue;
      if (projectId && pjEnt.name !== projectId) { skipped.push({ scope: 'generated', framework: fwEnt.name, project: pjEnt.name, reason: 'project-mismatch' }); continue; }
      const meta = { scope: 'generated', framework: fwEnt.name, project: pjEnt.name };
      const projectRoot = pathLib.join(fwRoot, pjEnt.name);
      await tryClear(pathLib.join(projectRoot, 'locators', 'healed-locators.json'), meta);
      if (includeRerunHistory) {
        await zeroHealingHitsInRerunResults(projectRoot, meta);
      }
    }
  }

  // Bump the live marker so the dashboard re-fetches stats.
  try {
    const { markRerunCompleted } = await import('../services/dashboardService.js');
    markRerunCompleted({ executionId: 'locators-cleared', framework, projectId, success: true });
  } catch (_) { /* best-effort */ }

  console.log(`[ZAC-FIX] cleared ${cleared.length} heal log(s) + zeroed healingHits in ${rerunHealsZeroed.length} replay-result(s) (framework=${framework}, project=${projectId})`);
  res.json({
    ok: true,
    cleared,
    skipped,
    rerunHealsZeroed,
    totalCleared: cleared.length,
    totalRerunHealsZeroed: rerunHealsZeroed.length,
  });
}));
console.log('  POST   /api/dashboard/clear-locators body={framework?, projectId?, confirm:true}');

export default router;
