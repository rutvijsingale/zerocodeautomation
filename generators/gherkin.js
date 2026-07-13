/**
 * Gherkin Feature File Generator
 * Generates Gherkin feature files from recorded actions
 * 
 * The generated feature files are properly linked to step definitions:
 * - Feature file steps use patterns that match step definition patterns
 * - Cucumber automatically matches feature steps to step definitions at runtime
 * - All step patterns are validated to ensure proper linking
 */

import * as stepMatcher from './step-pattern-matcher.js';

/**
 * Generate Gherkin feature file from steps
 * @param {Object} options - Generation options
 * @param {string} options.featureName - Feature name
 * @param {string} options.featureTitle - Scenario title
 * @param {Array} options.tags - Array of tags (can be feature-level or scenario-level)
 * @param {Array} options.steps - Array of step actions
 * @param {Array} options.backgroundSteps - Optional background steps
 * @param {boolean} options.useScenarioOutline - Whether to use Scenario Outline
 * @param {Array} options.examples - Examples table data for Scenario Outline (array of objects)
 * @param {Array} options.scenarios - Multiple scenarios (array of {title, tags, steps})
 * @returns {string} Generated Gherkin feature file content
 */
// [ZAC-FIX] Scenario Outline placeholder logic moved into generateStepLine
// (matchPlaceholder helper). Without it, every step in an Outline used a
// hardcoded "<value>" which never matches any Examples column header,
// so Cucumber would substitute nothing and run every row with the
// literal "<value>" string. The new logic emits "<col>" only when an
// Examples column actually contains the step value, otherwise leaves
// the literal — both cases are valid Gherkin and behave correctly.

export function generateFeatureFile({ 
  featureName, 
  featureTitle, 
  tags = [], 
  steps = [],
  backgroundSteps = [],
  useScenarioOutline = false,
  examples = [],
  scenarios = null // If provided, generates multiple scenarios
}) {
  const lines = [];
  
  // Feature-level tags (if any tags don't start with @, they're feature-level)
  const featureTags = tags.filter(tag => typeof tag === 'string' && tag.trim().startsWith('@'));
  if (featureTags.length > 0) {
    lines.push(featureTags.join(' '));
  }
  
  // Feature line
  lines.push(`Feature: ${featureName || 'Recorded Feature'}`);
  lines.push('');
  
  // Background section (if provided)
  if (backgroundSteps && backgroundSteps.length > 0) {
    lines.push('  Background:');
    const backgroundStepLines = backgroundSteps.map(step => generateStepLine(step));
    lines.push(...backgroundStepLines);
    lines.push('');
  }
  
  // Multiple scenarios OR single scenario/outline
  if (scenarios && Array.isArray(scenarios) && scenarios.length > 0) {
    // Generate multiple scenarios
    scenarios.forEach((scenario, index) => {
      if (index > 0) lines.push(''); // Blank line between scenarios
      
      // Scenario-level tags
      const scenarioTags = scenario.tags || [];
      if (scenarioTags.length > 0) {
        lines.push(`  ${scenarioTags.join(' ')}`);
      }
      
      // Scenario or Scenario Outline
      if (scenario.useScenarioOutline && scenario.examples && scenario.examples.length > 0) {
        lines.push(`  Scenario Outline: ${scenario.title || `Scenario ${index + 1}`}`);
        // [ZAC-FIX] Pass the per-scenario examples so each step's
        // placeholder picks the right column header.
        const scenarioStepLines = (scenario.steps || []).map(step => generateStepLine(step, true, scenario.examples));
        lines.push(...scenarioStepLines);
        lines.push('');
        lines.push('    Examples:');
        // Generate Examples table
        if (scenario.examples.length > 0) {
          // Get column headers from first example
          const headers = Object.keys(scenario.examples[0]);
          lines.push(`      | ${headers.join(' | ')} |`);
          scenario.examples.forEach(example => {
            const values = headers.map(h => example[h] || '');
            lines.push(`      | ${values.join(' | ')} |`);
          });
        }
      } else {
        lines.push(`  Scenario: ${scenario.title || `Scenario ${index + 1}`}`);
        const scenarioStepLines = (scenario.steps || []).map(step => generateStepLine(step));
        lines.push(...scenarioStepLines);
      }
    });
  } else {
    // Single scenario or scenario outline
    // Scenario-level tags (if tags provided and not feature-level)
    const scenarioTags = tags.filter(tag => typeof tag === 'string' && tag.trim().startsWith('@'));
    if (scenarioTags.length > 0) {
      lines.push(`  ${scenarioTags.join(' ')}`);
    }
    
    // Scenario or Scenario Outline
    if (useScenarioOutline && examples && examples.length > 0) {
      lines.push(`  Scenario Outline: ${featureTitle || 'Recorded Flow'}`);
      // [ZAC-FIX] Pass the examples so each step picks its own column placeholder.
      const stepLines = steps.map(step => generateStepLine(step, true, examples));
      lines.push(...stepLines);
      lines.push('');
      lines.push('    Examples:');
      // Generate Examples table
      if (examples.length > 0) {
        // Get column headers from first example
        const headers = Object.keys(examples[0]);
        lines.push(`      | ${headers.join(' | ')} |`);
        examples.forEach(example => {
          const values = headers.map(h => example[h] || '');
          lines.push(`      | ${values.join(' | ')} |`);
        });
      }
    } else {
      lines.push(`  Scenario: ${featureTitle || 'Recorded Flow'}`);
      const stepLines = steps.map(step => generateStepLine(step));
      lines.push(...stepLines);
    }
  }
  
  return lines.join('\n') + '\n';
}

/**
 * Generate a single step line from a step action
 * @param {Object} step - Step action object
 * @param {boolean} usePlaceholders - Whether to use placeholders for Scenario Outline (<value>)
 * @returns {string} Generated step line
 */
function generateStepLine(step, usePlaceholders = false, examples = []) {
  // [ZAC-FIX] Pick a column-aware Outline placeholder for this step.
  //
  // Behaviour:
  //   - If step.exampleColumn is set, ALWAYS use it as the placeholder.
  //   - Otherwise, scan the Examples table; only emit a "<col>"
  //     placeholder when a column's value actually matches the step's
  //     value. This means non-parameterised steps keep their literal
  //     value (correct, since they don't vary across rows).
  //   - If no match and no explicit column, return null so the caller
  //     can fall back to the literal value.
  const matchPlaceholder = (val) => {
    if (step.exampleColumn) return '<' + step.exampleColumn + '>';
    if (!Array.isArray(examples) || examples.length === 0 || val == null) return null;
    for (const row of examples) {
      if (!row || typeof row !== 'object') continue;
      for (const [col, v] of Object.entries(row)) {
        if (v === val || (v != null && String(v) === String(val))) return '<' + col + '>';
      }
    }
    return null;
  };

  // Use liveFeatureStep if available (from websocket.js normalization)
  if (step.liveFeatureStep && step.liveFeatureStep.text) {
    let stepText = step.liveFeatureStep.text;
    // Replace values with placeholders if using Scenario Outline AND a
    // matching Examples column exists. If nothing matches, leave the
    // literal value (the step is constant across rows).
    if (usePlaceholders && step.value) {
      const placeholder = matchPlaceholder(step.value);
      if (placeholder) {
        stepText = stepText.replace(new RegExp(`"${step.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g'), `"${placeholder}"`);
      }
    }
    return `    ${stepText}`;
  }
  
  // Fallback to generating from step kind
  switch(step.kind) {
    case 'navigate': {
      const pageName = step.normalizedPageName || step.url || 'Page';
      const urlValue = step.url || pageName;
      const url = usePlaceholders ? (matchPlaceholder(urlValue) || urlValue) : urlValue;
      return `    Given I navigate to "${url}"`;
    }
    case 'click': {
      const desc = step.normalizedDescription || step.selector || 'Element';
      return `    When I click "${desc}"`;
    }
    case 'type': {
      const desc = step.normalizedDescription || step.selector || 'Field';
      const realVal = step.value || '';
      const value = usePlaceholders ? (matchPlaceholder(realVal) || realVal) : realVal;
      return `    And I type "${value}" into "${desc}"`;
    }
    case 'doubleClick': {
      const desc = step.normalizedDescription || step.selector || 'Element';
      return `    And I double click "${desc}"`;
    }
    case 'jsClick': {
      const desc = step.normalizedDescription || step.selector || 'Element';
      return `    And I click "${desc}" using JavaScript`;
    }
    case 'dbQuery': {
      // DB assertion step (manually added). Verifies a SQL query returns the
      // expected number of rows against an env-configured connection.
      const sql = (step.query || step.value || 'SELECT 1').replace(/"/g, "'");
      const rows = Number.isFinite(Number(step.expectedRows)) ? Number(step.expectedRows) : 1;
      return `    And I run DB query "${sql}" expecting ${rows} rows`;
    }
    case 'select': {
      const desc = step.normalizedDescription || step.selector || 'Dropdown';
      const realVal = step.value || step.selectedText || '';
      const value = usePlaceholders ? (matchPlaceholder(realVal) || realVal) : realVal;
      return `    And I select "${value}" from "${desc}"`;
    }
    case 'check': {
      const desc = step.normalizedDescription || step.selector || 'Checkbox';
      return `    And I check "${desc}"`;
    }
    case 'uncheck': {
      const desc = step.normalizedDescription || step.selector || 'Checkbox';
      return `    And I uncheck "${desc}"`;
    }
    case 'selectRadio': {
      const desc = step.normalizedDescription || step.selector || 'Radio Group';
      const realVal = step.value || '';
      const value = usePlaceholders ? (matchPlaceholder(realVal) || realVal) : realVal;
      return `    And I select radio "${value}" in "${desc}"`;
    }
    case 'hover': {
      const desc = step.normalizedDescription || step.selector || 'Element';
      return `    And I hover over "${desc}"`;
    }
    case 'dragDrop': {
      const source = step.normalizedDescription || step.selector || 'Element';
      const target = step.normalizedTargetDescription || step.targetSelector || step.target || 'Target';
      return `    And I drag "${source}" to "${target}"`;
    }
    case 'fileUpload': {
      const desc = step.normalizedDescription || step.selector || 'Field';
      const realFile = step.filename || step.filePath || 'file';
      const filename = usePlaceholders ? (matchPlaceholder(realFile) || realFile) : realFile;
      return `    And I upload "${filename}" to "${desc}"`;
    }
    case 'keyPress': {
      const key = step.key || step.value || 'Enter';
      return `    And I press key "${key}"`;
    }
    case 'scroll': {
      if (step.x !== undefined || step.y !== undefined) {
        return `    And I scroll to position (${step.x || 0}, ${step.y || 0})`;
      } else {
        const desc = step.normalizedDescription || step.selector || 'Element';
        return `    And I scroll to "${desc}"`;
      }
    }
    case 'assertText': {
      const selector = step.selector || step.normalizedDescription || 'element';
      const realText = step.expectedValue || step.text || '';
      const expectedText = usePlaceholders ? (matchPlaceholder(realText) || realText) : realText;
      return `    Then I should see "${expectedText}" in "${selector}"`;
    }
    case 'assertVisible': {
      const selector = step.selector || step.normalizedDescription || 'element';
      return `    Then "${selector}" should be visible`;
    }
    case 'assertAttribute': {
      const selector = step.selector || step.normalizedDescription || 'element';
      const attrName = step.value || 'attribute';
      const realExp = step.expectedValue || '';
      const expectedValue = usePlaceholders ? (matchPlaceholder(realExp) || realExp) : realExp;
      const assertionType = step.assertionType || 'equal';
      return `    Then "${selector}" attribute "${attrName}" should ${assertionType} "${expectedValue}"`;
    }
    case 'assertCount': {
      const selector = step.selector || step.normalizedDescription || 'element';
      const count = parseInt(step.expectedValue) || 0;
      return `    Then "${selector}" count should be ${count}`;
    }
    case 'assertValue': {
      const selector = step.selector || step.normalizedDescription || 'element';
      const realExp = step.expectedValue || '';
      const expectedValue = usePlaceholders ? (matchPlaceholder(realExp) || realExp) : realExp;
      const assertionType = step.assertionType || 'equal';
      return `    Then "${selector}" value should ${assertionType} "${expectedValue}"`;
    }
    case 'waitFor': {
      const waitMs = Number(step.ms) || 500;
      return `    And I wait for ${waitMs} ms`;
    }
    case 'waitForSelector': {
      const selector = step.selector || 'selector';
      return `    And I wait for selector "${selector}"`;
    }
    case 'screenshot': {
      const filename = step.filename || 'screenshot.png';
      return `    And I take screenshot "${filename}"`;
    }
    case 'close': {
      return `    And I close the browser`;
    }
    case 'apiCall':
      return `    And I call API ${step.method || 'GET'} "${step.url}"`;
    default:
      return `    # TODO ${step.kind || 'unknown'} ${JSON.stringify(step)}`;
  }
}

/**
 * Generate Cucumber configuration file
 * @returns {string} Generated Cucumber config code
 */
export function generateCucumberConfig() {
  return `module.exports = {
  default: {
    format: ['@cucumber/pretty-formatter'],
    require: ['./steps/**/*.ts'],
    requireModule: ['ts-node/register'],
    paths: ['features/**/*.feature']
  }
};`;
}

/**
 * Detect if steps should use Scenario Outline based on repeated patterns
 * @param {Array} steps - Array of step actions
 * @returns {Object} Detection result with useScenarioOutline flag and examples
 */
export function detectScenarioOutline(steps) {
  // Group steps by kind and selector to find repeated patterns
  const typeSteps = steps.filter(s => s.kind === 'type');
  const selectSteps = steps.filter(s => s.kind === 'select');
  const navigateSteps = steps.filter(s => s.kind === 'navigate');
  
  // Check if same selector has multiple different values (good candidate for Scenario Outline)
  const typeGroups = {};
  typeSteps.forEach(step => {
    const key = step.selector || step.normalizedDescription;
    if (key) {
      if (!typeGroups[key]) typeGroups[key] = [];
      if (step.value) typeGroups[key].push(step.value);
    }
  });
  
  // Find selectors with multiple values
  const candidates = Object.entries(typeGroups).filter(([_, values]) => {
    const uniqueValues = [...new Set(values)];
    return uniqueValues.length >= 2;
  });
  
  if (candidates.length > 0) {
    // Generate examples from the first candidate
    const [selector, values] = candidates[0];
    const uniqueValues = [...new Set(values)];
    const examples = uniqueValues.map(value => ({ value }));
    
    return {
      useScenarioOutline: true,
      examples: examples,
      parameterizedSelector: selector
    };
  }
  
  return { useScenarioOutline: false, examples: [] };
}

/**
 * Extract tags from steps (type actions with @ prefix)
 * @param {Array} steps - Array of step actions
 * @returns {Array} Extracted tags
 */
export function extractTagsFromSteps(steps) {
  const tags = [];
  steps.forEach(step => {
    if (step.kind === 'type' && step.value && typeof step.value === 'string' && step.value.trim().startsWith('@')) {
      const tagValue = step.value.trim();
      const extractedTags = tagValue.split(/\s+/).filter(t => t.startsWith('@'));
      tags.push(...extractedTags);
    }
  });
  return [...new Set(tags)]; // Remove duplicates
}

/**
 * Verify that generated feature file steps will match step definitions
 * @param {Array} steps - Array of step actions used to generate feature file
 * @param {string} stepDefinitionsCode - The step definitions TypeScript code
 * @returns {Object} Verification result
 */
export function verifyFeatureStepLinkage(steps, stepDefinitionsCode) {
  return stepMatcher.verifyStepDefinitions(stepDefinitionsCode, steps);
}

export default {
  generateFeatureFile,
  generateCucumberConfig,
  verifyFeatureStepLinkage,
  detectScenarioOutline,
  extractTagsFromSteps
};
