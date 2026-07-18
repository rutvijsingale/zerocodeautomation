// [ZAC-FIX] split from routes/api.js
import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { generalRateLimiter, strictRateLimiter } from '../middleware/security.js';
import { environmentService } from '../services/environmentService.js';
import { Environment } from '../models/Environment.js';

const router = express.Router();

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


export default router;
