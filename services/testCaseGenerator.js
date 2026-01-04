/**
 * Test Case Generator Service
 * 
 * Analyzes recorded steps and generates meaningful test cases with:
 * - Logical grouping of steps into test scenarios
 * - Meaningful test case descriptions
 * - Test case categorization (positive, negative, boundary, etc.)
 * - Proper Gherkin scenario generation
 * - Test case metadata (priority, tags, etc.)
 */

/**
 * Generate meaningful test cases from recorded steps
 * @param {Array} steps - Array of recorded step actions
 * @param {Object} options - Generation options
 * @returns {Object} Generated test cases with scenarios and metadata
 */
export function generateTestCases(steps, options = {}) {
  if (!steps || steps.length === 0) {
    return {
      testCases: [],
      summary: {
        totalTestCases: 0,
        positiveCases: 0,
        negativeCases: 0,
        boundaryCases: 0,
        totalSteps: 0
      }
    };
  }

  const {
    featureName = 'Generated Test Cases',
    groupByFlow = true,
    includeNegativeCases = true,
    minStepsPerTestCase = 2
  } = options;

  // Analyze steps to identify flows and patterns
  const analysis = analyzeSteps(steps);
  
  // Group steps into logical test scenarios
  const scenarios = groupStepsIntoScenarios(steps, analysis, {
    groupByFlow,
    minStepsPerTestCase
  });

  // Generate test cases from scenarios
  const testCases = scenarios.map((scenario, index) => {
    return generateTestCaseFromScenario(scenario, index + 1, featureName);
  });

  // Generate negative test cases if requested
  let negativeCases = [];
  if (includeNegativeCases) {
    negativeCases = generateNegativeTestCases(steps, analysis, featureName);
  }

  const allTestCases = [...testCases, ...negativeCases];

  // Calculate summary
  const summary = {
    totalTestCases: allTestCases.length,
    positiveCases: testCases.length,
    negativeCases: negativeCases.length,
    boundaryCases: 0, // Can be enhanced later
    totalSteps: steps.length,
    flowsIdentified: analysis.flows.length,
    assertionsFound: analysis.assertions.length
  };

  return {
    testCases: allTestCases,
    summary,
    analysis
  };
}

/**
 * Analyze steps to identify patterns, flows, and characteristics
 * @param {Array} steps - Array of step actions
 * @returns {Object} Analysis results
 */
function analyzeSteps(steps) {
  const analysis = {
    flows: [],
    assertions: [],
    navigationPoints: [],
    formSubmissions: [],
    userInteractions: [],
    patterns: {
      loginFlow: false,
      searchFlow: false,
      formFlow: false,
      navigationFlow: false
    }
  };

  let currentFlow = [];
  let flowStartIndex = 0;

  steps.forEach((step, index) => {
    // Identify assertions
    if (step.kind && step.kind.startsWith('assert')) {
      analysis.assertions.push({
        step,
        index,
        type: step.kind
      });
    }

    // Identify navigation points
    if (step.kind === 'navigate') {
      analysis.navigationPoints.push({
        step,
        index,
        url: step.url || step.value
      });

      // Start a new flow at navigation
      if (currentFlow.length > 0) {
        analysis.flows.push({
          steps: [...currentFlow],
          startIndex: flowStartIndex,
          endIndex: index - 1,
          type: detectFlowType(currentFlow)
        });
      }
      currentFlow = [step];
      flowStartIndex = index;
    } else {
      currentFlow.push(step);
    }

    // Identify form submissions
    if (step.kind === 'click' && isSubmitButton(step)) {
      analysis.formSubmissions.push({
        step,
        index,
        formSteps: currentFlow.filter(s => 
          s.kind === 'type' || s.kind === 'select' || s.kind === 'check'
        )
      });
    }

    // Identify user interactions
    if (['click', 'type', 'select', 'check', 'uncheck', 'hover'].includes(step.kind)) {
      analysis.userInteractions.push({
        step,
        index,
        type: step.kind
      });
    }
  });

  // Add the last flow
  if (currentFlow.length > 0) {
    analysis.flows.push({
      steps: currentFlow,
      startIndex: flowStartIndex,
      endIndex: steps.length - 1,
      type: detectFlowType(currentFlow)
    });
  }

  // Detect common patterns
  detectPatterns(analysis, steps);

  return analysis;
}

/**
 * Detect the type of flow based on steps
 * @param {Array} flowSteps - Steps in the flow
 * @returns {string} Flow type
 */
function detectFlowType(flowSteps) {
  const stepKinds = flowSteps.map(s => s.kind).join(' ');
  const stepText = flowSteps.map(s => 
    (s.normalizedDescription || s.selector || s.value || '').toLowerCase()
  ).join(' ');

  // Login flow
  if (stepText.includes('login') || stepText.includes('sign in') || 
      stepText.includes('username') || stepText.includes('password')) {
    return 'login';
  }

  // Search flow
  if (stepText.includes('search') || stepText.includes('query') ||
      (stepKinds.includes('type') && stepKinds.includes('click'))) {
    return 'search';
  }

  // Form submission flow
  if (stepKinds.includes('type') && stepKinds.includes('select') && 
      stepKinds.includes('click')) {
    return 'form';
  }

  // Navigation flow
  if (stepKinds.includes('navigate') || stepKinds.includes('scroll')) {
    return 'navigation';
  }

  // CRUD operations
  if (stepText.includes('add') || stepText.includes('create') || 
      stepText.includes('new')) {
    return 'create';
  }
  if (stepText.includes('edit') || stepText.includes('update') || 
      stepText.includes('modify')) {
    return 'update';
  }
  if (stepText.includes('delete') || stepText.includes('remove')) {
    return 'delete';
  }

  return 'general';
}

/**
 * Detect common patterns in the analysis
 * @param {Object} analysis - Analysis object to update
 * @param {Array} steps - All steps
 */
function detectPatterns(analysis, steps) {
  const allText = steps.map(s => 
    (s.normalizedDescription || s.selector || s.value || '').toLowerCase()
  ).join(' ');

  analysis.patterns.loginFlow = allText.includes('login') || 
                                 allText.includes('sign in') ||
                                 allText.includes('username');
  analysis.patterns.searchFlow = allText.includes('search') || 
                                  allText.includes('query');
  analysis.patterns.formFlow = analysis.formSubmissions.length > 0;
  analysis.patterns.navigationFlow = analysis.navigationPoints.length > 1;
}

/**
 * Check if a click step is a submit button
 * @param {Object} step - Step to check
 * @returns {boolean}
 */
function isSubmitButton(step) {
  if (step.kind !== 'click') return false;
  const selector = (step.selector || '').toLowerCase();
  const description = (step.normalizedDescription || '').toLowerCase();
  
  return selector.includes('submit') || 
         selector.includes('button[type="submit"]') ||
         description.includes('submit') ||
         description.includes('save') ||
         description.includes('create') ||
         description.includes('add');
}

/**
 * Group steps into logical test scenarios
 * @param {Array} steps - All steps
 * @param {Object} analysis - Step analysis
 * @param {Object} options - Grouping options
 * @returns {Array} Array of scenario objects
 */
function groupStepsIntoScenarios(steps, analysis, options) {
  const { groupByFlow, minStepsPerTestCase } = options;
  const scenarios = [];

  if (groupByFlow && analysis.flows.length > 0) {
    // Group by identified flows
    analysis.flows.forEach((flow, index) => {
      if (flow.steps.length >= minStepsPerTestCase) {
        scenarios.push({
          title: generateScenarioTitle(flow, index),
          steps: flow.steps,
          type: flow.type,
          startIndex: flow.startIndex,
          endIndex: flow.endIndex,
          tags: generateTagsForFlow(flow)
        });
      }
    });
  } else {
    // Group by logical boundaries (assertions, navigation, form submissions)
    let currentScenario = {
      title: 'Test Scenario 1',
      steps: [],
      type: 'general',
      tags: []
    };

    steps.forEach((step, index) => {
      currentScenario.steps.push(step);

      // Break scenario at assertion points or form submissions
      const shouldBreak = 
        (step.kind && step.kind.startsWith('assert')) ||
        (step.kind === 'navigate' && currentScenario.steps.length > 1) ||
        (isSubmitButton(step) && currentScenario.steps.length >= minStepsPerTestCase);

      if (shouldBreak && currentScenario.steps.length >= minStepsPerTestCase) {
        scenarios.push({
          ...currentScenario,
          endIndex: index
        });
        currentScenario = {
          title: `Test Scenario ${scenarios.length + 1}`,
          steps: [],
          type: 'general',
          tags: []
        };
      }
    });

    // Add remaining steps as last scenario
    if (currentScenario.steps.length >= minStepsPerTestCase) {
      scenarios.push(currentScenario);
    }
  }

  return scenarios;
}

/**
 * Generate a meaningful scenario title
 * @param {Object} flow - Flow object
 * @param {number} index - Scenario index
 * @returns {string} Scenario title
 */
function generateScenarioTitle(flow, index) {
  const flowType = flow.type;
  const steps = flow.steps;

  // Try to extract meaningful title from steps
  const firstStep = steps[0];
  const lastStep = steps[steps.length - 1];
  
  let title = '';

  // Generate title based on flow type
  switch (flowType) {
    case 'login':
      title = 'User Login Flow';
      break;
    case 'search':
      title = 'Search Functionality';
      break;
    case 'form':
      title = 'Form Submission';
      break;
    case 'create':
      title = 'Create New Item';
      break;
    case 'update':
      title = 'Update Item';
      break;
    case 'delete':
      title = 'Delete Item';
      break;
    case 'navigation':
      title = 'Page Navigation';
      break;
    default:
      // Try to infer from step descriptions
      const descriptions = steps
        .map(s => s.normalizedDescription || s.selector || '')
        .filter(d => d.length > 0)
        .slice(0, 3);
      
      if (descriptions.length > 0) {
        title = descriptions[0].charAt(0).toUpperCase() + descriptions[0].slice(1);
        if (descriptions.length > 1) {
          title += ` and ${descriptions.length - 1} more action${descriptions.length > 2 ? 's' : ''}`;
        }
      } else {
        title = `Test Scenario ${index + 1}`;
      }
  }

  return title;
}

/**
 * Generate tags for a flow
 * @param {Object} flow - Flow object
 * @returns {Array} Array of tags
 */
function generateTagsForFlow(flow) {
  const tags = ['@positive', `@${flow.type}`];
  
  // Add priority tag based on flow type
  if (['login', 'create', 'delete'].includes(flow.type)) {
    tags.push('@high');
  } else if (['search', 'form'].includes(flow.type)) {
    tags.push('@medium');
  } else {
    tags.push('@low');
  }

  // Add functional tag
  tags.push('@functional');

  return tags;
}

/**
 * Generate a test case from a scenario
 * @param {Object} scenario - Scenario object
 * @param {number} testCaseNumber - Test case number
 * @param {string} featureName - Feature name
 * @returns {Object} Test case object
 */
function generateTestCaseFromScenario(scenario, testCaseNumber, featureName) {
  const testCaseId = `TC-${String(testCaseNumber).padStart(3, '0')}`;
  
  // Generate meaningful description
  const description = generateTestCaseDescription(scenario);

  return {
    id: testCaseId,
    title: scenario.title,
    description,
    priority: getPriorityFromTags(scenario.tags),
    type: 'positive',
    tags: scenario.tags,
    steps: scenario.steps,
    preconditions: extractPreconditions(scenario.steps),
    expectedResults: extractExpectedResults(scenario.steps),
    gherkin: generateGherkinFromScenario(scenario, testCaseId)
  };
}

/**
 * Generate test case description
 * @param {Object} scenario - Scenario object
 * @returns {string} Description
 */
function generateTestCaseDescription(scenario) {
  const stepCount = scenario.steps.length;
  const hasAssertions = scenario.steps.some(s => s.kind && s.kind.startsWith('assert'));
  
  let description = `This test case verifies the ${scenario.type} flow with ${stepCount} step${stepCount > 1 ? 's' : ''}. `;
  
  if (hasAssertions) {
    description += 'The test includes verification steps to ensure the expected behavior.';
  } else {
    description += 'The test validates the user interaction flow.';
  }

  return description;
}

/**
 * Get priority from tags
 * @param {Array} tags - Tags array
 * @returns {string} Priority
 */
function getPriorityFromTags(tags) {
  if (tags.includes('@high')) return 'High';
  if (tags.includes('@medium')) return 'Medium';
  if (tags.includes('@low')) return 'Low';
  return 'Medium';
}

/**
 * Extract preconditions from steps
 * @param {Array} steps - Steps array
 * @returns {Array} Preconditions
 */
function extractPreconditions(steps) {
  const preconditions = [];
  
  // Look for navigation steps as preconditions
  const navigateStep = steps.find(s => s.kind === 'navigate');
  if (navigateStep) {
    preconditions.push(`User should be able to navigate to ${navigateStep.url || navigateStep.value || 'the application'}`);
  }

  return preconditions;
}

/**
 * Extract expected results from steps
 * @param {Array} steps - Steps array
 * @returns {Array} Expected results
 */
function extractExpectedResults(steps) {
  const expectedResults = [];
  
  // Extract from assertions
  steps.forEach(step => {
    if (step.kind && step.kind.startsWith('assert')) {
      if (step.kind === 'assertVisible') {
        expectedResults.push(`Element "${step.selector || step.normalizedDescription}" should be visible`);
      } else if (step.kind === 'assertText') {
        expectedResults.push(`Text "${step.expectedValue || step.text}" should be present`);
      } else if (step.kind === 'assertAttribute') {
        expectedResults.push(`Attribute "${step.value}" should have value "${step.expectedValue}"`);
      }
    }
  });

  // If no assertions, infer from last action
  if (expectedResults.length === 0 && steps.length > 0) {
    const lastStep = steps[steps.length - 1];
    if (lastStep.kind === 'click') {
      expectedResults.push('Action should complete successfully');
    } else if (lastStep.kind === 'type') {
      expectedResults.push('Text should be entered correctly');
    }
  }

  return expectedResults;
}

/**
 * Generate Gherkin scenario from test case scenario
 * @param {Object} scenario - Scenario object
 * @param {string} testCaseId - Test case ID
 * @returns {string} Gherkin scenario
 */
function generateGherkinFromScenario(scenario, testCaseId) {
  const lines = [];
  
  // Add tags
  if (scenario.tags && scenario.tags.length > 0) {
    lines.push(scenario.tags.join(' '));
  }
  
  // Scenario line
  lines.push(`Scenario: ${scenario.title}`);
  lines.push(`  # Test Case ID: ${testCaseId}`);
  lines.push('');

  // Convert steps to Gherkin
  scenario.steps.forEach((step, index) => {
    const gherkinStep = convertStepToGherkin(step, index);
    if (gherkinStep) {
      lines.push(gherkinStep);
    }
  });

  return lines.join('\n');
}

/**
 * Convert a step to Gherkin format
 * @param {Object} step - Step object
 * @param {number} index - Step index
 * @returns {string} Gherkin step line
 */
function convertStepToGherkin(step, index) {
  const prefix = index === 0 ? 'Given' : 
                 step.kind && step.kind.startsWith('assert') ? 'Then' :
                 step.kind === 'navigate' ? 'Given' :
                 'When';

  switch (step.kind) {
    case 'navigate':
      return `  ${prefix} I navigate to "${step.url || step.value || 'the application'}"`;
    
    case 'click':
      return `  When I click on "${step.selector || step.normalizedDescription || 'the element'}"`;
    
    case 'type':
      return `  When I type "${step.value || ''}" into "${step.selector || step.normalizedDescription || 'the field'}"`;
    
    case 'select':
      return `  When I select "${step.value || ''}" from "${step.selector || step.normalizedDescription || 'the dropdown'}"`;
    
    case 'assertVisible':
      return `  Then "${step.selector || step.normalizedDescription || 'the element'}" should be visible`;
    
    case 'assertText':
      return `  Then I should see "${step.expectedValue || step.text || ''}" in "${step.selector || step.normalizedDescription || 'the element'}"`;
    
    case 'assertAttribute':
      return `  Then "${step.selector || step.normalizedDescription || 'the element'}" should have attribute "${step.value || 'value'}" equal to "${step.expectedValue || ''}"`;
    
    case 'scroll':
      if (step.selector) {
        return `  When I scroll to "${step.selector || step.normalizedDescription || 'the element'}"`;
      }
      return `  When I scroll the page`;
    
    case 'waitFor':
      return `  And I wait for ${step.ms || 500} milliseconds`;
    
    default:
      const description = step.normalizedDescription || step.selector || step.value || 'the action';
      return `  ${prefix} ${description}`;
  }
}

/**
 * Generate negative test cases
 * @param {Array} steps - All steps
 * @param {Object} analysis - Step analysis
 * @param {string} featureName - Feature name
 * @returns {Array} Negative test cases
 */
function generateNegativeTestCases(steps, analysis, featureName) {
  const negativeCases = [];

  // Generate negative cases for forms
  analysis.formSubmissions.forEach((form, index) => {
    // Test case: Submit form with empty required fields
    if (form.formSteps.length > 0) {
      negativeCases.push({
        id: `TC-NEG-${String(index + 1).padStart(3, '0')}`,
        title: 'Submit Form with Empty Required Fields',
        description: 'Verify that the form shows validation errors when submitted with empty required fields',
        priority: 'High',
        type: 'negative',
        tags: ['@negative', '@validation', '@high', '@functional'],
        steps: form.formSteps.slice(0, -1), // All form steps except submit
        preconditions: ['User is on the form page'],
        expectedResults: ['Form should display validation errors', 'Form should not be submitted'],
        gherkin: generateNegativeGherkin(form, 'empty_fields')
      });
    }
  });

  return negativeCases;
}

/**
 * Generate negative test case Gherkin
 * @param {Object} form - Form submission object
 * @param {string} type - Negative test type
 * @returns {string} Gherkin scenario
 */
function generateNegativeGherkin(form, type) {
  const lines = [];
  lines.push('@negative @validation @high');
  lines.push('Scenario: Submit Form with Empty Required Fields');
  lines.push('  Given I am on the form page');
  
  if (type === 'empty_fields') {
    lines.push('  When I click on the submit button');
    lines.push('  Then I should see validation error messages');
    lines.push('  And the form should not be submitted');
  }
  
  return lines.join('\n');
}

/**
 * Generate complete Gherkin feature file from test cases
 * @param {Array} testCases - Array of test case objects
 * @param {string} featureName - Feature name
 * @returns {string} Complete Gherkin feature file
 */
export function generateFeatureFileFromTestCases(testCases, featureName = 'Generated Test Cases') {
  const lines = [];
  
  lines.push(`Feature: ${featureName}`);
  lines.push('');
  lines.push('  # Test cases generated from recorded steps');
  lines.push('  # Total test cases: ' + testCases.length);
  lines.push('');

  testCases.forEach((testCase, index) => {
    if (index > 0) lines.push('');
    lines.push(testCase.gherkin);
  });

  return lines.join('\n');
}

