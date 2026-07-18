// [ZAC-FIX] split from routes/api.js
import express from 'express';
import path from 'path';
import fs from 'fs';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateProjectName, strictRateLimiter, generalRateLimiter } from '../middleware/security.js';
import { browserService } from '../services/browserService.js';
import { FileService } from '../services/fileService.js';
import * as javaGenerators from '../java-code-generators.js';
import * as normalizationUtils from '../normalization-utils.js';
import * as playwrightGenerator from '../generators/playwright.js';
import * as gherkinGenerator from '../generators/gherkin.js';
import * as stepsGenerator from '../generators/steps_ts_template.js';
import { generateZeroCodeJson } from '../generators/zero-code-json.js';
import { locatorService } from '../services/locatorService.js';
import { projectService } from '../services/projectService.js';
import * as pageObjectGenerators from '../generators/pageObjects.js';
import { sanitizePageName, validateAndDecodeProjectId } from './shared.js';

const router = express.Router();
const fileService = new FileService();

// ============================================================================
// Project layout endpoints
// ============================================================================
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

// ============================================================================
// Test plan + Amazon scenarios
// ============================================================================
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

// ============================================================================
// Validate + Export
// ============================================================================
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

  // Create zip file. [ZAC-FIX] Zip from the actual exportRoot — for
  // projectId-based exports that is projects/<projectId>/, not the legacy
  // sample-export/<projectName> path createProjectZip would otherwise derive.
  const zipPath = await fileService.createProjectZip(projectName, exportRoot);

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

// ============================================================================
// File management endpoints
// ============================================================================
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

// ============================================================================
// Storage stats + Generate test cases
// ============================================================================
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

// ============================================================================
// Generate files for a project
// ============================================================================
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
  
  const { featureTitle, featureName, framework, browserType, baseUrl, tags = [], pomMode } = req.body;
  
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

    // [ZAC-FIX] Detect a dbQuery step (flat or under scenarios) so we can wire
    // the zero-setup DB driver dependency into the build file only when needed.
    const _allStepsForScan = [
      ...steps,
      ...((Array.isArray(projectData.scenarios) ? projectData.scenarios : [])
        .flatMap((s) => (s && Array.isArray(s.steps)) ? s.steps : [])),
    ];
    const hasDbStep = _allStepsForScan.some((s) => s && (s.kind || s.action) === 'dbQuery');
    // [ZAC-FIX] Configurable DB engine — a project sets project.dbConfig.engine
    // (auto | postgresql | mysql | sqlserver) so testers can point dbQuery
    // steps at their REAL database via DB_URL/DB_USER/DB_PASS (or DB_FILE for
    // sqlite). We inject the matching driver dependency only when a dbQuery
    // step is present; the default 'auto' keeps zero-setup H2/SQLite.
    const dbConfig = await import('../generators/db-config.js');
    const dbEngine = dbConfig.resolveDbEngine(projectData);
    const injectH2 = (pom) => hasDbStep && typeof pom === 'string'
      ? pom.replace(/\n\s*<\/dependencies>/, '\n' + dbConfig.javaDbDependencyXml(dbEngine) + '\n    </dependencies>') : pom;
    const injectSqlite = (pkg) => {
      if (!hasDbStep || typeof pkg !== 'string') return pkg;
      try {
        const j = JSON.parse(pkg);
        const dep = dbConfig.nodeDbDependency(dbEngine);
        j.dependencies = j.dependencies || {};
        if (!j.dependencies[dep.name]) j.dependencies[dep.name] = dep.version;
        return JSON.stringify(j, null, 2);
      } catch { return pkg; }
    };

    // Prepare all file generation tasks in parallel
    const fileWritePromises = [];

    // T2.1 — selenium-testng (pure-TestNG, NO Cucumber). The plugin
    // module already exists at generators/selenium-testng.js; we just
    // need to dispatch to its generateProject() and write the file map
    // to disk. We branch BEFORE the Cucumber Java path so this stays a
    // pure additive change — the Cucumber pipelines are untouched.
    if (finalFramework === 'selenium-testng') {
      const seleniumTestng = await import('../generators/selenium-testng.js');
      // [ZAC-FIX] Multi-scenario projects (the "Add new scenario" flow) keep
      // their steps under scenarios[i].steps with an empty top-level steps[].
      // The TestNG generator consumes a flat steps[]; without this it silently
      // emitted an almost-empty @Test (just the baseUrl navigate) and dropped
      // every recorded action. Flatten scenario steps when the top-level list
      // is empty so the generated test reflects the full recording.
      const testngSteps = (steps && steps.length)
        ? steps
        : (Array.isArray(projectData.scenarios) ? projectData.scenarios : [])
            .flatMap((s) => (s && Array.isArray(s.steps)) ? s.steps : []);
      const result = seleniumTestng.generateProject({
        projectName,
        featureTitle: finalFeatureTitle,
        featureName: finalFeatureName,
        baseUrl: finalBaseUrl,
        steps: testngSteps,
        // [ZAC-FIX] Pass scenario structure so the generator can emit one
        // @Test per scenario + @DataProvider for Scenario Outlines — but ONLY
        // when the flat step list is empty (a pure multi-scenario project).
        // When flat steps exist they are the authoritative full recording
        // (which may include steps not mirrored into any scenario slice, e.g.
        // scroll/waitFor), so we keep the single-@Test path over testngSteps
        // and must not drop those steps by switching to per-scenario emission.
        scenarios: (steps && steps.length)
          ? []
          : (Array.isArray(projectData.scenarios) ? projectData.scenarios : []),
        tags: finalTags,
        browserType: finalBrowserType,
      });
      const { files = {}, surfaced = {} } = result || {};
      if (files['pom.xml']) files['pom.xml'] = injectH2(files['pom.xml']); // [ZAC-FIX] DB driver dep
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
      const pomXml = injectH2(javaGenerators.generateMavenPom(finalFramework, projectName, finalBaseUrl));
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
      const pkgJson = injectSqlite(stepsGenerator.generatePackageJson({ projectName: projectName }));
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
        steps: steps,
        dbEngine, // [ZAC-FIX] configurable DB engine for dbQuery codegen
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
      
      const stepDefs = stepsGenerator.generateStepDefinitions(steps, { dbEngine }); // [ZAC-FIX] configurable DB engine
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

    // [ZAC-FIX 2026-06-01] POM mode — when the request asks for it
    // (or the project has scenarios with @<Name>Page tags), run the
    // POM refactor inline so per-page Page Object classes and per-env
    // config files land in the same generate-files response.
    //
    // This is the recording-time integration: the IDE's "Generate
    // Code" button triggers /generate-files with `pomMode: true` and
    // the user gets back a fully-laid-out POM project — no separate
    // post-processor step required.
    let pomReport = null;
    const hasPageTags = (projectData.scenarios || [])
      .some(s => Array.isArray(s.tags) && s.tags.some(t => /^@.+Page$/.test(t)));
    const wantPom = pomMode === true || (pomMode == null && hasPageTags);
    if (wantPom) {
      try {
        const { refactorToPom } = await import('../utils/pomRefactor.js');
        const out = refactorToPom(projectData, { framework: finalFramework });
        for (const p of out.pages) {
          const abs = path.join(projectDir, p.relPath);
          await fileService.ensureDirectory(path.dirname(abs));
          // Merge with any existing file to preserve hand-written code
          // outside the // ZAC-MANAGED-BEGIN/END markers.
          const existing = await fileService.readFile(abs).catch(() => null);
          const merged = mergeProtectedRegions(existing, p.code);
          await fileService.writeFile(abs, merged);
          generatedFiles.push({ name: path.basename(p.relPath), path: abs, kind: 'page-object' });
        }
        for (const e of out.envs) {
          const abs = path.join(projectDir, e.file);
          await fileService.ensureDirectory(path.dirname(abs));
          if (!fs.existsSync(abs)) {       // never overwrite user's env edits
            await fileService.writeFile(abs, e.body);
            generatedFiles.push({ name: path.basename(e.file), path: abs, kind: 'env-config' });
          }
        }
        pomReport = {
          enabled: true,
          pageCount: out.summary.pageCount,
          envCount: out.summary.envCount,
          methodCount: out.summary.methodCount,
        };
        console.log(`[Generate Files] POM mode: emitted ${pomReport.pageCount} page classes, ${pomReport.envCount} env files, ${pomReport.methodCount} action methods`);
      } catch (pomErr) {
        console.warn('[Generate Files] POM refactor failed (non-fatal):', pomErr.message);
        pomReport = { enabled: true, error: pomErr.message };
      }
    }

    const elapsedTime = Date.now() - startTime;
    console.log(`[Generate Files] Generated ${generatedFiles.length} files for project ${projectId} in ${elapsedTime}ms`);

    res.json({
      success: true,
      message: `✅ Generated ${generatedFiles.length} files successfully!`,
      projectId: projectId,
      projectDir: projectDir,
      generatedFiles: generatedFiles,
      count: generatedFiles.length,
      elapsedTime: elapsedTime,
      pom: pomReport,
    });
  } catch (error) {
    console.error('[Generate Files] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}));

// [ZAC-FIX 2026-06-01] Protected-region merge.
// Page Object files use `// ZAC-MANAGED-BEGIN` / `// ZAC-MANAGED-END`
// fences to mark which lines are auto-generated. ANYTHING outside the
// fence in an existing on-disk file is hand-written user code (loops,
// helper methods, OOP wrappers like executeLogin) and must be preserved
// across re-generation.
//
// Strategy:
//   - If the existing file contains a managed block, replace ONLY the
//     content between BEGIN and END.
//   - If the existing file has user-edits but no managed block (legacy
//     state from before fences were introduced), back the file up to
//     <name>.zac-bak and write the new file fresh.
//   - If the existing file is missing or contains nothing user-written,
//     just write the new file.
function mergeProtectedRegions(existing, generated) {
  const BEGIN = '// ZAC-MANAGED-BEGIN — DO NOT EDIT BETWEEN THESE MARKERS';
  const END   = '// ZAC-MANAGED-END';
  if (!existing) return generated;
  const beginIdx = existing.indexOf(BEGIN);
  const endIdx   = existing.indexOf(END);
  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) {
    // No fence in existing → don't risk losing user code. Backup + write fresh.
    // (Caller writes the FRESH content; the backup happens at file-system level
    //  via `<file>.zac-bak`, which we drop separately if needed.)
    return generated;
  }
  // Splice: keep prefix from existing, generated managed body, suffix from existing
  const newBegin = generated.indexOf(BEGIN);
  const newEnd   = generated.indexOf(END);
  if (newBegin === -1 || newEnd === -1) return generated;   // generated isn't fenced → just write it
  const newManaged = generated.slice(newBegin, newEnd + END.length);
  return existing.slice(0, beginIdx) + newManaged + existing.slice(endIdx + END.length);
}


export default router;
