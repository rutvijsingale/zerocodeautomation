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

// Health check endpoint
router.get('/health', (req, res) => {
  createHealthResponse(req, res);
});

// Get configuration
router.get('/config', generalRateLimiter, (req, res) => {
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

// Rerun/Execute recorded script
router.post('/rerun', generalRateLimiter, asyncHandler(async (req, res) => {
  const { steps, browserType = 'chromium', baseUrl = 'about:blank', headless = false, useScenarioOutline = false, examples = [], stopOnFailure = false } = req.body;

  if (!steps || !Array.isArray(steps) || steps.length === 0) {
    throw new Error('No steps provided to execute');
  }
  
  // If Scenario Outline is enabled and examples provided, execute for each example
  if (useScenarioOutline && examples && Array.isArray(examples) && examples.length > 0) {
    console.log(`[Rerun] Scenario Outline enabled with ${examples.length} examples`);
    return await executeScenarioOutline(req, res, steps, browserType, baseUrl, headless, examples, stopOnFailure);
  }

  // Generate unique execution ID
  const executionId = `rerun_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  console.log(`[Rerun] Starting execution ${executionId} of ${steps.length} steps`);
  console.log(`[Rerun] Browser: ${browserType}, Base URL: ${baseUrl}, Headless: ${headless}, Stop on Failure: ${stopOnFailure}`);

  const startTime = Date.now();
  const results = [];
  let browser, context, page;

  // Store execution state for cancellation
  const executionState = { cancelled: false, browser: null, context: null, page: null };
  runningReruns.set(executionId, executionState);
  mostRecentExecutionId = executionId; // Track most recent execution

  try {
    // Get browser launcher
    const { chromium, firefox, webkit } = await import('playwright');
    const browserLauncher = browserType === 'firefox' ? firefox : 
                           browserType === 'webkit' ? webkit : chromium;

    // Launch browser
    browser = await browserLauncher.launch({
      headless: headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    executionState.browser = browser;

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

    context = await browser.newContext({
      viewport: { width: screenSize.width, height: screenSize.height }
    });
    executionState.context = context;

    page = await context.newPage();
    executionState.page = page;

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

    // Import common step handlers
    const { executePlaywrightStep } = await import('../utils/stepHandlers.js');

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
        
        // Use common step handler - pass context for close step to check for new tabs
        const result = await executePlaywrightStep(page, step, context);
        
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
        results.push({
          step: step.kind,
          success: true,
          duration: stepDuration
        });

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
        
        console.error(`[Rerun] ❌ Step ${i + 1}/${steps.length} failed:`, stepError.message);
        
        results.push({
          step: step.kind || 'unknown',
          success: false,
          error: stepError.message,
          duration: stepDuration
        });

        // If stopOnFailure is enabled, break immediately on failure (unless cancelled)
        if (stopOnFailure && !executionState.cancelled) {
          console.log(`[Rerun] Stop on failure enabled - stopping execution at step ${i + 1}`);
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
    const wasCancelled = executionState.cancelled; // Only check explicit cancellation flag

    if (wasCancelled) {
      console.log(`[Rerun] Execution ${executionId} was cancelled: ${successCount} successful, ${failureCount} failed, ${totalDuration}ms total`);
    } else {
      console.log(`[Rerun] Execution ${executionId} completed: ${successCount} successful, ${failureCount} failed, ${totalDuration}ms total`);
    }

    res.json({
      success: failureCount === 0 && !wasCancelled,
      cancelled: wasCancelled,
      executedSteps: results.length,
      successCount: successCount,
      failureCount: failureCount,
      duration: `${(totalDuration / 1000).toFixed(2)}s`,
      results: results
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
async function executeScenarioOutline(req, res, steps, browserType, baseUrl, headless, examples, stopOnFailure = false) {
  const executionId = `rerun_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  console.log(`[Rerun] Starting Scenario Outline execution ${executionId} with ${examples.length} examples`);
  
  const startTime = Date.now();
  const allResults = [];
  let browser, context, page;
  
  // Store execution state for cancellation
  const executionState = { cancelled: false, browser: null, context: null, page: null };
  runningReruns.set(executionId, executionState);
  mostRecentExecutionId = executionId;
  
  try {
    // Get browser launcher
    const { chromium, firefox, webkit } = await import('playwright');
    const browserLauncher = browserType === 'firefox' ? firefox : 
                           browserType === 'webkit' ? webkit : chromium;

    // Launch browser once for all examples
    browser = await browserLauncher.launch({
      headless: headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    executionState.browser = browser;
    
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

    // Import step handler
    const { executePlaywrightStep } = await import('../utils/stepHandlers.js');
    
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
          
          exampleResults.steps.push({
            step: step.kind,
            success: true,
            duration: Date.now() - stepStartTime
          });
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
      results: allResults
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
  const { baseUrl = 'about:blank', browserType = 'chromium', projectId } = req.body;

  console.log(`[API] ========================================`);
  console.log(`[API] Starting recording session...`);
  console.log(`[API] Base URL: ${baseUrl}`);
  console.log(`[API] Browser Type: ${browserType}`);
  console.log(`[API] Project ID: ${projectId || 'none'}`);
  console.log(`[API] Current active sessions: ${browserService.getActiveSessionCount()}`);

  // Set current project if provided
  if (projectId) {
    await projectService.setCurrentProject(projectId);
  }

  const session = await browserService.createSession(baseUrl, browserType);

  console.log(`[API] ✅ Session created: ${session.sessionId}`);
  console.log(`[API] Total active sessions: ${browserService.getActiveSessionCount()}`);
  console.log(`[API] ========================================`);

  res.json({
    sessionId: session.sessionId,
    wsUrl: `ws://localhost:${process.env.PORT || 3000}/api/recording/${session.sessionId}`
  });
}));

// Stop recording and get captured actions (no rate limit - critical operation)
router.post('/recording/stop', asyncHandler(async (req, res) => {
  const { sessionId, projectId, projectName, featureTitle, featureName, framework = 'playwright-java', browserType, baseUrl, tags: uiTags = [], skipProjectCreation = false } = req.body;
  validateSessionId(sessionId);
  
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
    'dragDrop', 'fileUpload', 'keyPress', 'scroll', 'close'
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
      // Use project name if available, otherwise generate one
      let projName;
      if (currentProjectId) {
        const projectData = await projectService.loadProjectData(currentProjectId);
        projName = projectData.name || `project-${currentProjectId}`;
      } else {
        projName = projectName || `recorded-test-${Date.now()}`;
      }
      
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
        await fileService.writeFile(path.join(supportDir, 'PlaywrightWorld.java'), worldClass);

        // Generate Java step definitions
        const stepDefMap = {};
        const groupedActions = [];
        // Use proper naming: generate class name from feature title
        const stepsFileName = featTitle.replace(/[^a-zA-Z0-9]/g, '') || 'RecordedTest';
        const className = `${stepsFileName}Steps`;
        const stepDefs = javaGenerators.generateJavaStepDefinitions(framework, stepDefMap, groupedActions, detectedBaseUrl, [], className);
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
router.post('/projects/:projectId/save', strictRateLimiter, asyncHandler(async (req, res) => {
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

// Optimized endpoint to append steps to a project without loading all existing steps
router.post('/projects/:projectId/append-steps', strictRateLimiter, asyncHandler(async (req, res) => {
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
    
    if (steps.length === 0) {
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
        const frameworkType = finalFramework === 'selenium-java' ? 'selenium-java' : 'playwright-ts';
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
      console.log(`[Generate Files] Generating feature file...`);
      const featureContent = gherkinGenerator.generateFeatureFile({
        featureName: finalFeatureName,
        featureTitle: finalFeatureTitle,
        tags: finalTags,
        steps: steps
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
      // Generate TypeScript/JavaScript project (parallel file writes)
      const pkgJson = stepsGenerator.generatePackageJson({ projectName: projectName });
      const pkgPath = path.join(projectDir, 'package.json');
      fileWritePromises.push(
        fileService.writeFile(pkgPath, pkgJson).then(() => {
          generatedFiles.push({ name: 'package.json', path: pkgPath });
        })
      );
      
      const pwConfig = playwrightGenerator.generatePlaywrightConfig({ baseUrl: finalBaseUrl });
      const configPath = path.join(projectDir, 'playwright.config.ts');
      fileWritePromises.push(
        fileService.writeFile(configPath, pwConfig).then(() => {
          generatedFiles.push({ name: 'playwright.config.ts', path: configPath });
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
      const specPath = path.join(testsDir, 'recorded.spec.ts');
      fileWritePromises.push(
        fileService.writeFile(specPath, spec).then(() => {
          generatedFiles.push({ name: 'recorded.spec.ts', path: specPath });
        })
      );
      
      // Generate feature file and step definitions
      const featureDir = path.join(projectDir, 'features');
      const stepsDir = path.join(projectDir, 'steps');
      await fileService.ensureDirectory(featureDir);
      await fileService.ensureDirectory(stepsDir);
      
      const featureContent = gherkinGenerator.generateFeatureFile({
        featureName: finalFeatureName,
        featureTitle: finalFeatureTitle,
        tags: finalTags,
        steps: steps,
        backgroundSteps: [],
        useScenarioOutline: false,
        examples: [],
        scenarios: null
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
      const stepDefsPath = path.join(stepsDir, `${stepsFileName}Steps.ts`);
      fileWritePromises.push(
        fileService.writeFile(stepDefsPath, stepDefs).then(() => {
          generatedFiles.push({ name: `${stepsFileName}Steps.ts`, path: stepDefsPath });
        })
      );
      
      // Generate world file
      const worldFile = stepsGenerator.generateWorldFile();
      const worldDir = path.join(projectDir, 'support');
      await fileService.ensureDirectory(worldDir);
      const worldPath = path.join(worldDir, 'world.ts');
      fileWritePromises.push(
        fileService.writeFile(worldPath, worldFile).then(() => {
          generatedFiles.push({ name: 'world.ts', path: worldPath });
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
      return res.status(400).json({
        success: false,
        error: errorMsg,
        installationRequired: true,
        installationInstructions: {
          windows: 'Download from https://maven.apache.org/download.cgi or use chocolatey: choco install maven',
          macos: 'brew install maven',
          linux: 'sudo apt-get install maven (Ubuntu/Debian) or sudo yum install maven (RHEL/CentOS)'
        }
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

export default router;
