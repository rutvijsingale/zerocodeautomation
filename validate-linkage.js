#!/usr/bin/env node
/**
 * Standalone validation script for verifying feature-to-step-definition linkage
 * 
 * Usage:
 *   node validate-linkage.js <projectName>
 *   node validate-linkage.js --all
 *   node validate-linkage.js --file <featureFile> <stepDefinitionsFile>
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as gherkinGenerator from './generators/gherkin.js';
import * as stepMatcher from './generators/step-pattern-matcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseFeatureFile(featureContent) {
  const steps = [];
  const lines = featureContent.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.match(/^(Given|When|Then|And)\s+/i)) {
      const match = trimmed.match(/^(Given|When|Then|And)\s+(.+)$/i);
      if (match) {
        const stepText = match[2];
        
        // Parse step to determine kind
        if (stepText.includes('navigate to')) {
          steps.push({ kind: 'navigate' });
        } else if (stepText.includes('click')) {
          steps.push({ kind: 'click' });
        } else if (stepText.includes('type') || stepText.includes('Enter')) {
          steps.push({ kind: 'type' });
        } else if (stepText.includes('should see') || stepText.includes('Should See')) {
          steps.push({ kind: 'assertText' });
        } else if (stepText.includes('should be visible') || stepText.includes('Should Be Visible')) {
          steps.push({ kind: 'assertVisible' });
        } else if (stepText.includes('attribute')) {
          steps.push({ kind: 'assertAttribute', assertionType: stepText.includes('contain') ? 'contains' : 'equal' });
        } else if (stepText.includes('count should be')) {
          steps.push({ kind: 'assertCount' });
        } else if (stepText.includes('value should')) {
          steps.push({ kind: 'assertValue', assertionType: stepText.includes('contain') ? 'contains' : 'equal' });
        } else if (stepText.includes('wait for')) {
          if (stepText.includes('selector')) {
            steps.push({ kind: 'waitForSelector' });
          } else {
            steps.push({ kind: 'waitFor' });
          }
        } else if (stepText.includes('screenshot')) {
          steps.push({ kind: 'screenshot' });
        } else if (stepText.includes('call API')) {
          steps.push({ kind: 'apiCall' });
        }
      }
    }
  }
  
  return steps;
}

function validateProject(projectName) {
  const projectPath = path.join(__dirname, 'sample-export', projectName);
  const featureFilePath = path.join(projectPath, 'features', 'recorded.feature');
  const stepsFilePath = path.join(projectPath, 'steps', 'recorded.steps.ts');
  
  if (!fs.existsSync(featureFilePath)) {
    console.error(`❌ Feature file not found: ${featureFilePath}`);
    return false;
  }
  
  if (!fs.existsSync(stepsFilePath)) {
    console.error(`❌ Step definitions file not found: ${stepsFilePath}`);
    return false;
  }
  
  const featureContent = fs.readFileSync(featureFilePath, 'utf-8');
  const stepsContent = fs.readFileSync(stepsFilePath, 'utf-8');
  
  const steps = parseFeatureFile(featureContent);
  const validation = gherkinGenerator.verifyFeatureStepLinkage(steps, stepsContent);
  
  console.log(`\n📋 Validating project: ${projectName}`);
  console.log('─'.repeat(60));
  
  if (validation.valid) {
    console.log('✅ All feature steps are properly linked to step definitions');
    console.log(`   Found ${validation.found.length} of ${validation.required.length} required step definitions`);
    return true;
  } else {
    console.log('❌ Validation failed: Some steps are missing matching step definitions');
    console.log(`   Found: ${validation.found.length} / Required: ${validation.required.length}`);
    console.log(`   Missing: ${validation.missing.length}`);
    
    if (validation.missing.length > 0) {
      console.log('\n   Missing step definitions:');
      validation.missing.forEach(pattern => {
        console.log(`   - ${pattern}`);
      });
    }
    return false;
  }
}

function validateFiles(featureFile, stepsFile) {
  if (!fs.existsSync(featureFile)) {
    console.error(`❌ Feature file not found: ${featureFile}`);
    return false;
  }
  
  if (!fs.existsSync(stepsFile)) {
    console.error(`❌ Step definitions file not found: ${stepsFile}`);
    return false;
  }
  
  const featureContent = fs.readFileSync(featureFile, 'utf-8');
  const stepsContent = fs.readFileSync(stepsFile, 'utf-8');
  
  const steps = parseFeatureFile(featureContent);
  const validation = gherkinGenerator.verifyFeatureStepLinkage(steps, stepsContent);
  
  console.log(`\n📋 Validating files:`);
  console.log(`   Feature: ${featureFile}`);
  console.log(`   Steps: ${stepsFile}`);
  console.log('─'.repeat(60));
  
  if (validation.valid) {
    console.log('✅ All feature steps are properly linked to step definitions');
    console.log(`   Found ${validation.found.length} of ${validation.required.length} required step definitions`);
    return true;
  } else {
    console.log('❌ Validation failed: Some steps are missing matching step definitions');
    console.log(`   Found: ${validation.found.length} / Required: ${validation.required.length}`);
    console.log(`   Missing: ${validation.missing.length}`);
    
    if (validation.missing.length > 0) {
      console.log('\n   Missing step definitions:');
      validation.missing.forEach(pattern => {
        console.log(`   - ${pattern}`);
      });
    }
    return false;
  }
}

function validateAll() {
  const exportDir = path.join(__dirname, 'sample-export');
  
  if (!fs.existsSync(exportDir)) {
    console.error(`❌ Export directory not found: ${exportDir}`);
    return;
  }
  
  const projects = fs.readdirSync(exportDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  if (projects.length === 0) {
    console.log('No projects found in sample-export directory');
    return;
  }
  
  console.log(`\n🔍 Validating ${projects.length} project(s)...\n`);
  
  let passed = 0;
  let failed = 0;
  
  projects.forEach(projectName => {
    if (validateProject(projectName)) {
      passed++;
    } else {
      failed++;
    }
    console.log('');
  });
  
  console.log('─'.repeat(60));
  console.log(`Summary: ${passed} passed, ${failed} failed`);
}

// Main execution
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
Usage:
  node validate-linkage.js <projectName>           Validate a specific project
  node validate-linkage.js --all                   Validate all projects
  node validate-linkage.js --file <feature> <steps> Validate specific files

Examples:
  node validate-linkage.js test-project
  node validate-linkage.js --all
  node validate-linkage.js --file features/test.feature steps/test.steps.ts
`);
  process.exit(0);
} else if (args[0] === '--all') {
  validateAll();
} else if (args[0] === '--file' && args.length >= 3) {
  const featureFile = args[1];
  const stepsFile = args[2];
  const result = validateFiles(featureFile, stepsFile);
  process.exit(result ? 0 : 1);
} else {
  const projectName = args[0];
  const result = validateProject(projectName);
  process.exit(result ? 0 : 1);
}


