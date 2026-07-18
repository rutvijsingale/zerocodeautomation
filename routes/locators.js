// [ZAC-FIX] split from routes/api.js
import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateProjectName, generalRateLimiter, strictRateLimiter } from '../middleware/security.js';
import { locatorService } from '../services/locatorService.js';
import { projectService } from '../services/projectService.js';
import { LocatorDefinition } from '../models/LocatorDefinition.js';
import { validateAndDecodeProjectId } from './shared.js';

const router = express.Router();

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

export default router;
