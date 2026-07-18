// [ZAC-FIX] split from routes/api.js
import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { generalRateLimiter, strictRateLimiter } from '../middleware/security.js';
import { projectService } from '../services/projectService.js';
import { mavenService } from '../services/mavenService.js';
import { npmService } from '../services/npmService.js';
import { validateAndDecodeProjectId } from './shared.js';

const router = express.Router();

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


export default router;
