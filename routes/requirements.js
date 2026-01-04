/**
 * Requirements API Routes
 * 
 * Handles SRS/BRD document upload, parsing, and test case generation
 */

import express from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import { asyncHandler } from '../middleware/errorHandler.js';
import { generalRateLimiter } from '../middleware/security.js';
import * as requirementParser from '../services/requirementParser.js';
import * as gherkinGenerator from '../generators/gherkin.js';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept text, markdown, and common document formats
    const allowedMimes = [
      'text/plain',
      'text/markdown',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/csv'
    ];
    
    if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(txt|md|doc|docx|csv)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Please upload .txt, .md, .doc, or .docx files.'), false);
    }
  }
});

/**
 * Upload and parse SRS/BRD document
 * POST /api/requirements/parse
 */
router.post('/parse', generalRateLimiter, upload.single('document'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new Error('No file uploaded');
  }
  
  const fileName = req.file.originalname;
  const format = req.body.format || 'text';
  let fileContent = '';
  
  console.log(`[Requirements] Parsing document: ${fileName}, format: ${format}`);
  
  // Extract text from .docx files
  if (fileName.toLowerCase().endsWith('.docx') || 
      req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    try {
      console.log(`[Requirements] Extracting text from .docx file...`);
      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      fileContent = result.value;
      console.log(`[Requirements] Extracted ${fileContent.length} characters from .docx file`);
    } catch (docxError) {
      console.error(`[Requirements] Error extracting text from .docx:`, docxError);
      throw new Error(`Failed to extract text from .docx file: ${docxError.message}`);
    }
  } else if (fileName.toLowerCase().endsWith('.doc') || 
             req.file.mimetype === 'application/msword') {
    // Old .doc format - not easily parseable without additional libraries
    throw new Error('Legacy .doc format is not supported. Please convert to .docx or .txt format.');
  } else {
    // Plain text, markdown, or CSV files
    fileContent = req.file.buffer.toString('utf-8');
  }
  
  if (!fileContent || fileContent.trim().length === 0) {
    throw new Error('Document appears to be empty or could not be read. Please ensure the file contains text content.');
  }
  
  // Parse requirements
  const requirements = requirementParser.parseRequirements(fileContent, format);
  
  console.log(`[Requirements] Extracted ${requirements.length} requirements`);
  if (requirements.length === 0) {
    console.log(`[Requirements] ⚠️  No requirements found. Document preview (first 1000 chars):`);
    console.log(fileContent.substring(0, 1000));
    console.log(`[Requirements] 💡 Tip: Ensure your document contains requirements in formats like:`);
    console.log(`   - REQ-1: The system shall...`);
    console.log(`   - 1.1 The application must...`);
    console.log(`   - As a user, I want to...`);
    console.log(`   - Lines containing: "shall", "must", "should", "system shall", etc.`);
  }
  
  // Generate test scenarios
  const scenarios = requirementParser.generateTestScenarios(requirements);
  
  console.log(`[Requirements] Generated ${scenarios.length} test scenarios`);
  
  // Create traceability matrix
  const traceability = requirementParser.createTraceabilityMatrix(requirements, scenarios);
  
  res.json({
    success: true,
    fileName: fileName,
    requirements: requirements,
    testScenarios: scenarios,
    traceability: traceability,
    summary: {
      totalRequirements: requirements.length,
      totalTestScenarios: scenarios.length,
      coverage: traceability.coverage.coveragePercentage
    }
  });
}));

/**
 * Generate Gherkin feature file from test scenarios
 * POST /api/requirements/generate-feature
 */
router.post('/generate-feature', generalRateLimiter, asyncHandler(async (req, res) => {
  const { scenarios, featureName = 'Generated Test Cases', tags = [] } = req.body;
  
  if (!scenarios || !Array.isArray(scenarios) || scenarios.length === 0) {
    throw new Error('No test scenarios provided');
  }
  
  console.log(`[Requirements] Generating feature file from ${scenarios.length} scenarios`);
  
  // Convert scenarios to Gherkin
  const gherkinContent = requirementParser.scenariosToGherkin(scenarios, featureName);
  
  res.json({
    success: true,
    featureName: featureName,
    gherkin: gherkinContent,
    scenarios: scenarios.length
  });
}));

/**
 * Get requirement traceability report
 * POST /api/requirements/traceability
 */
router.post('/traceability', generalRateLimiter, asyncHandler(async (req, res) => {
  const { requirements, scenarios } = req.body;
  
  if (!requirements || !Array.isArray(requirements)) {
    throw new Error('Requirements array is required');
  }
  
  if (!scenarios || !Array.isArray(scenarios)) {
    throw new Error('Test scenarios array is required');
  }
  
  const traceability = requirementParser.createTraceabilityMatrix(requirements, scenarios);
  
  res.json({
    success: true,
    traceability: traceability
  });
}));

export default router;

