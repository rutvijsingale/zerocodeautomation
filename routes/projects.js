// [ZAC-FIX] split from routes/api.js
import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { generalRateLimiter, strictRateLimiter } from '../middleware/security.js';
import { projectService } from '../services/projectService.js';
import { locatorService } from '../services/locatorService.js';
import { validateAndDecodeProjectId } from './shared.js';

const router = express.Router();

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

// ============================================================================
// Append steps
// ============================================================================
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

// ============================================================================
// Delete projects
// ============================================================================

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

export default router;
