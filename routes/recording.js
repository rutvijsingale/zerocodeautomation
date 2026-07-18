// [ZAC-FIX] split from routes/api.js
import express from 'express';
import path from 'path';
import fs from 'fs';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateSessionId, strictRateLimiter, generalRateLimiter, pollingRateLimiter } from '../middleware/security.js';
import { browserService } from '../services/browserService.js';
import { FileService } from '../services/fileService.js';
import * as javaGenerators from '../java-code-generators.js';
import * as playwrightGenerator from '../generators/playwright.js';
import * as gherkinGenerator from '../generators/gherkin.js';
import * as stepsGenerator from '../generators/steps_ts_template.js';
import { generateZeroCodeJson } from '../generators/zero-code-json.js';
import { locatorService } from '../services/locatorService.js';
import { projectService } from '../services/projectService.js';
import { LocatorDefinition } from '../models/LocatorDefinition.js';
import * as pageObjectGenerators from '../generators/pageObjects.js';
import { sanitizePageName, autoPromoteLocatorsFromActions } from './shared.js';

const router = express.Router();
const fileService = new FileService();

// Start recording session
router.post('/recording/start', strictRateLimiter, asyncHandler(async (req, res) => {
  // T2.5 — accept an optional `viewport: { width, height }` from the
  // recorder UI (viewport-preset dropdown). null/missing keeps the
  // existing default of "maximize".
  const { baseUrl = '', browserType = 'chromium', projectId, viewport = null } = req.body || {};
  const normalizedBaseUrl = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  let resolvedBaseUrl = normalizedBaseUrl;

  console.log(`[API] ========================================`);
  console.log(`[API] Starting recording session...`);
  console.log(`[API] Base URL (requested): ${normalizedBaseUrl || '(empty)'}`);
  console.log(`[API] Browser Type: ${browserType}`);
  console.log(`[API] Project ID: ${projectId || 'none'}`);
  console.log(`[API] Viewport: ${viewport ? `${viewport.width}x${viewport.height}` : 'maximize (default)'}`);
  console.log(`[API] Current active sessions: ${browserService.getActiveSessionCount()}`);

  // Set current project if provided
  if (projectId) {
    await projectService.setCurrentProject(projectId);
  }

  // If caller did not pass a URL, reuse the selected project's baseUrl.
  if (!resolvedBaseUrl) {
    const fallbackProjectId = projectId || projectService.getCurrentProject();
    if (fallbackProjectId) {
      try {
        const projectData = await projectService.loadProjectData(fallbackProjectId);
        resolvedBaseUrl = (projectData.baseUrl || '').trim();
        if (resolvedBaseUrl) {
          console.log(`[API] Base URL fallback from project "${fallbackProjectId}": ${resolvedBaseUrl}`);
        }
      } catch (e) {
        console.warn(`[API] Could not load baseUrl from project "${fallbackProjectId}": ${e.message}`);
      }
    }
  }

  if (!resolvedBaseUrl) {
    resolvedBaseUrl = 'about:blank';
  }

  console.log(`[API] Base URL (resolved): ${resolvedBaseUrl}`);

  const session = await browserService.createSession(resolvedBaseUrl, browserType, { viewport });

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
    // [ZAC-FIX 2026-06-01] Page-boundary markers — let the recording UI
    // mark where one Page Object ends and the next begins, so the POM
    // codegen can split scenarios cleanly.
    'pageBoundary', 'newPage',
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

export default router;
