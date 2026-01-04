/**
 * Step Pattern Matcher
 * Ensures feature file steps properly match step definitions for Cucumber execution
 */

/**
 * Step pattern mappings - defines how feature file steps map to step definitions
 * Format: { featurePattern, stepDefinitionPattern, parameters }
 */
export const STEP_PATTERNS = {
  navigate: {
    featurePattern: 'Given I navigate to "{url}"',
    stepDefPattern: 'Given(\'I navigate to {string}\', ...)',
    parameters: ['url']
  },
  click: {
    featurePattern: 'When I click "{selector}"',
    stepDefPattern: 'When(\'I click {string}\', ...)',
    parameters: ['selector']
  },
  type: {
    featurePattern: 'And I type "{value}" into "{selector}"',
    stepDefPattern: 'And(\'I type {string} into {string}\', ...)',
    parameters: ['value', 'selector']
  },
  assertText: {
    featurePattern: 'Then I should see "{text}" in "{selector}"',
    stepDefPattern: 'Then(\'I should see {string} in {string}\', ...)',
    parameters: ['text', 'selector']
  },
  assertVisible: {
    featurePattern: 'Then "{selector}" should be visible',
    stepDefPattern: 'Then(\'{string} should be visible\', ...)',
    parameters: ['selector']
  },
  assertAttributeEqual: {
    featurePattern: 'Then "{selector}" attribute "{attr}" should equal "{value}"',
    stepDefPattern: 'Then(\'{string} attribute {string} should equal {string}\', ...)',
    parameters: ['selector', 'attr', 'value']
  },
  assertAttributeContains: {
    featurePattern: 'Then "{selector}" attribute "{attr}" should contain "{value}"',
    stepDefPattern: 'Then(\'{string} attribute {string} should contain {string}\', ...)',
    parameters: ['selector', 'attr', 'value']
  },
  assertCount: {
    featurePattern: 'Then "{selector}" count should be {count}',
    stepDefPattern: 'Then(\'{string} count should be {int}\', ...)',
    parameters: ['selector', 'count']
  },
  assertValueEqual: {
    featurePattern: 'Then "{selector}" value should equal "{value}"',
    stepDefPattern: 'Then(\'{string} value should equal {string}\', ...)',
    parameters: ['selector', 'value']
  },
  assertValueContains: {
    featurePattern: 'Then "{selector}" value should contain "{value}"',
    stepDefPattern: 'Then(\'{string} value should contain {string}\', ...)',
    parameters: ['selector', 'value']
  },
  waitFor: {
    featurePattern: 'And I wait for {ms} ms',
    stepDefPattern: 'And(\'I wait for {int} ms\', ...)',
    parameters: ['ms']
  },
  waitForSelector: {
    featurePattern: 'And I wait for selector "{selector}"',
    stepDefPattern: 'And(\'I wait for selector {string}\', ...)',
    parameters: ['selector']
  },
  screenshot: {
    featurePattern: 'And I take screenshot "{filename}"',
    stepDefPattern: 'And(\'I take screenshot {string}\', ...)',
    parameters: ['filename']
  },
  apiCallGet: {
    featurePattern: 'And I call API GET "{url}"',
    stepDefPattern: 'And(\'I call API GET {string}\', ...)',
    parameters: ['url']
  },
  apiCallPost: {
    featurePattern: 'And I call API POST "{url}"',
    stepDefPattern: 'And(\'I call API POST {string}\', ...)',
    parameters: ['url']
  }
};

/**
 * Validate that a feature step pattern matches a step definition pattern
 * @param {string} featureStep - The step text from feature file
 * @param {string} stepDefPattern - The pattern from step definition
 * @returns {Object} Validation result with matched flag and extracted parameters
 */
export function validateStepMatch(featureStep, stepDefPattern) {
  // Remove keyword (Given/When/Then/And) from feature step
  const stepText = featureStep.replace(/^(Given|When|Then|And)\s+/i, '').trim();
  
  // Convert step definition pattern to regex
  // Replace {string} with regex that matches quoted strings
  // Replace {int} with regex that matches integers
  let regexPattern = stepDefPattern
    .replace(/\{string\}/g, '"([^"]*)"')
    .replace(/\{int\}/g, '(\\d+)')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\\\(\\\\d\+\)/g, '(\\d+)')
    .replace(/\\\\\\"\\\\\(\[\\"\^\*\]\\\\\*\)\\\\\\"/g, '"([^"]*)"');
  
  // Also handle unquoted integers
  regexPattern = regexPattern.replace(/\\\\(\\d\\+)/g, '(\\d+)');
  
  // Try to match
  const regex = new RegExp(`^${regexPattern}$`, 'i');
  const match = stepText.match(regex);
  
  if (match) {
    return {
      matched: true,
      parameters: match.slice(1)
    };
  }
  
  return {
    matched: false,
    parameters: []
  };
}

/**
 * Get all step definition patterns that should exist for given feature steps
 * @param {Array} featureSteps - Array of feature step objects
 * @returns {Set<string>} Set of required step definition patterns
 */
export function getRequiredStepDefinitions(featureSteps) {
  const required = new Set();
  
  featureSteps.forEach(step => {
    const patternKey = getPatternKey(step.kind, step.assertionType);
    const pattern = STEP_PATTERNS[patternKey];
    if (pattern) {
      required.add(pattern.stepDefPattern);
    }
  });
  
  return required;
}

/**
 * Get pattern key based on step kind and optional assertion type
 * @param {string} kind - Step kind (navigate, click, type, etc.)
 * @param {string} assertionType - Optional assertion type (equals, contains, etc.)
 * @returns {string} Pattern key
 */
function getPatternKey(kind, assertionType) {
  if (kind === 'assertAttribute') {
    return assertionType === 'contains' ? 'assertAttributeContains' : 'assertAttributeEqual';
  }
  if (kind === 'assertValue') {
    return assertionType === 'contains' ? 'assertValueContains' : 'assertValueEqual';
  }
  if (kind === 'apiCall') {
    // Would need to check method, but for now assume GET
    return 'apiCallGet';
  }
  return kind;
}

/**
 * Verify that all step definitions exist for feature steps
 * @param {string} stepDefinitionsCode - The step definitions TypeScript code
 * @param {Array} featureSteps - Array of feature step objects
 * @returns {Object} Verification result
 */
export function verifyStepDefinitions(stepDefinitionsCode, featureSteps) {
  const required = getRequiredStepDefinitions(featureSteps);
  const missing = [];
  const found = [];
  
  required.forEach(pattern => {
    // Extract the pattern text from stepDefPattern
    const patternText = pattern.replace(/^[^(]+\(['"]/, '').replace(/['"].*$/, '');
    const regex = new RegExp(`(Given|When|Then|And)\\s*\\(['"]${patternText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\{string\}/g, '\\{string\\}').replace(/\{int\}/g, '\\{int\\}')}['"]`, 'i');
    
    if (regex.test(stepDefinitionsCode)) {
      found.push(pattern);
    } else {
      missing.push(pattern);
    }
  });
  
  return {
    valid: missing.length === 0,
    missing,
    found,
    required: Array.from(required)
  };
}

export default {
  STEP_PATTERNS,
  validateStepMatch,
  getRequiredStepDefinitions,
  verifyStepDefinitions
};


