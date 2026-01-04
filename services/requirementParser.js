/**
 * Requirement Parser Service
 * 
 * Parses SRS (Software Requirements Specification) and BRD (Business Requirements Document)
 * to extract requirements and automatically generate test cases.
 * 
 * Supports:
 * - Plain text documents
 * - Markdown documents
 * - Structured requirements (numbered lists, sections)
 * - Requirement traceability
 */

/**
 * Parse a requirement document and extract requirements
 * @param {string} content - Document content
 * @param {string} format - Document format ('text', 'markdown', 'structured')
 * @returns {Array} Array of extracted requirements
 */
export function parseRequirements(content, format = 'text') {
  const requirements = [];
  
  if (!content || typeof content !== 'string') {
    return requirements;
  }
  
  // Normalize line endings
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  
  let currentRequirement = null;
  let currentSection = null;
  let requirementCounter = 0;
  let strictModeMatches = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Detect requirement patterns (strict mode)
    const reqPatterns = [
      /^(REQ|REQ-|REQUIREMENT|REQ\.|R-|FR-|NFR-|F-\d+|N-\d+)[\s:]+(.+)$/i,
      /^(\d+\.\d+\.?\d*)[\s]+(.+)$/, // Numbered requirements like 1.1, 1.2.3
      /^\[REQ-?\d+\][\s]+(.+)$/i,
      /^Requirement\s+(\d+)[\s:]+(.+)$/i,
      /^As\s+(?:a|an)\s+(.+?),\s+I\s+(?:want|need|should|must)\s+(.+?)(?:so\s+that\s+(.+?))?$/i, // User story format
      /^Given\s+(.+?),\s+when\s+(.+?),\s+then\s+(.+?)$/i, // Gherkin-like format
    ];
    
    // Check if line matches a requirement pattern (strict mode)
    let matched = false;
    for (const pattern of reqPatterns) {
      const match = line.match(pattern);
      if (match) {
        matched = true;
        strictModeMatches++;
        requirementCounter++;
        
        // Save previous requirement if exists
        if (currentRequirement) {
          requirements.push(currentRequirement);
        }
        
        // Extract requirement details
        let reqId = match[1] || `REQ-${requirementCounter}`;
        let description = match[2] || match[1] || line;
        
        // Clean up requirement ID
        reqId = reqId.replace(/[^\w-]/g, '').toUpperCase();
        
        currentRequirement = {
          id: reqId,
          description: description,
          section: currentSection || 'General',
          type: detectRequirementType(description),
          priority: detectPriority(description),
          testScenarios: [],
          acceptanceCriteria: [],
          relatedRequirements: []
        };
        break;
      }
    }
    
    // Fallback: If no strict patterns matched and line looks like a requirement (lenient mode)
    if (!matched && line.length > 20) {
      const lowerLine = line.toLowerCase();
      // Check if line contains requirement-like keywords
      const requirementKeywords = [
        'shall', 'must', 'should', 'will', 'need to', 'required to',
        'system shall', 'application shall', 'user shall', 'system must',
        'the system', 'the application', 'the user', 'feature', 'functionality',
        'capability', 'ability', 'support', 'provide', 'enable', 'allow'
      ];
      
      const hasRequirementKeyword = requirementKeywords.some(keyword => lowerLine.includes(keyword));
      const looksLikeRequirement = hasRequirementKeyword && 
                                   !lowerLine.startsWith('table of') &&
                                   !lowerLine.startsWith('chapter') &&
                                   !lowerLine.startsWith('section') &&
                                   !lowerLine.match(/^\d+$/) && // Not just a number
                                   !lowerLine.match(/^page\s+\d+/i); // Not a page number
      
      if (looksLikeRequirement) {
        requirementCounter++;
        
        // Save previous requirement if exists
        if (currentRequirement) {
          requirements.push(currentRequirement);
        }
        
        // Create requirement from line
        const reqId = `REQ-${requirementCounter}`;
        currentRequirement = {
          id: reqId,
          description: line,
          section: currentSection || 'General',
          type: detectRequirementType(line),
          priority: detectPriority(line),
          testScenarios: [],
          acceptanceCriteria: [],
          relatedRequirements: []
        };
        matched = true;
      }
    }
    
    // If not a requirement header, check for continuation or details
    if (!matched && currentRequirement) {
      // Check for acceptance criteria
      if (line.match(/^(AC|Acceptance|Criteria|Given|When|Then|And|But)[\s:]/i)) {
        currentRequirement.acceptanceCriteria.push(line);
      }
      // Check for test scenarios
      else if (line.match(/^(Test|Scenario|TC|Test Case)[\s:]/i)) {
        const scenarioMatch = line.match(/^(?:Test|Scenario|TC|Test Case)[\s:]+(.+)$/i);
        if (scenarioMatch) {
          currentRequirement.testScenarios.push({
            name: scenarioMatch[1],
            steps: []
          });
        }
      }
      // Check for related requirements
      else if (line.match(/^(Related|Depends on|See also)[\s:]/i)) {
        const relatedMatch = line.match(/(REQ-?\d+|R-\d+|FR-\d+|NFR-\d+)/gi);
        if (relatedMatch) {
          currentRequirement.relatedRequirements.push(...relatedMatch);
        }
      }
      // Otherwise, append to description
      else if (line.length > 10) {
        currentRequirement.description += ' ' + line;
      }
    }
    
    // Detect sections
    if (line.match(/^#{1,3}\s+(.+)$/)) {
      const sectionMatch = line.match(/^#{1,3}\s+(.+)$/);
      currentSection = sectionMatch[1];
    } else if (line.match(/^[A-Z][A-Z\s]+$/)) {
      // All caps line might be a section header
      if (line.length < 50 && !line.includes('.')) {
        currentSection = line;
      }
    }
  }
  
  // Add last requirement
  if (currentRequirement) {
    requirements.push(currentRequirement);
  }
  
  // Log parsing results for debugging
  if (requirements.length === 0 && content.length > 100) {
    console.log(`[Requirements Parser] No requirements found. Document length: ${content.length} characters`);
    console.log(`[Requirements Parser] First 500 characters: ${content.substring(0, 500)}`);
  } else {
    console.log(`[Requirements Parser] Found ${requirements.length} requirements (${strictModeMatches} strict matches)`);
  }
  
  return requirements;
}

/**
 * Detect requirement type (Functional, Non-Functional, etc.)
 * @param {string} description - Requirement description
 * @returns {string} Requirement type
 */
function detectRequirementType(description) {
  const desc = description.toLowerCase();
  
  if (desc.includes('performance') || desc.includes('speed') || desc.includes('response time') || 
      desc.includes('load') || desc.includes('throughput')) {
    return 'Performance';
  }
  if (desc.includes('security') || desc.includes('authentication') || desc.includes('authorization') ||
      desc.includes('encryption') || desc.includes('password')) {
    return 'Security';
  }
  if (desc.includes('usability') || desc.includes('user experience') || desc.includes('ui') ||
      desc.includes('interface') || desc.includes('design')) {
    return 'Usability';
  }
  if (desc.includes('compatibility') || desc.includes('browser') || desc.includes('platform')) {
    return 'Compatibility';
  }
  if (desc.includes('reliability') || desc.includes('availability') || desc.includes('uptime')) {
    return 'Reliability';
  }
  
  return 'Functional';
}

/**
 * Detect requirement priority
 * @param {string} description - Requirement description
 * @returns {string} Priority level
 */
function detectPriority(description) {
  const desc = description.toLowerCase();
  
  if (desc.includes('must') || desc.includes('critical') || desc.includes('mandatory') ||
      desc.includes('required') || desc.includes('essential')) {
    return 'High';
  }
  if (desc.includes('should') || desc.includes('important') || desc.includes('recommended')) {
    return 'Medium';
  }
  if (desc.includes('nice to have') || desc.includes('optional') || desc.includes('low priority')) {
    return 'Low';
  }
  
  return 'Medium';
}

/**
 * Generate test scenarios from requirements
 * @param {Array} requirements - Array of requirements
 * @returns {Array} Array of test scenarios
 */
export function generateTestScenarios(requirements) {
  const scenarios = [];
  
  for (const req of requirements) {
    // Generate scenarios from acceptance criteria
    if (req.acceptanceCriteria && req.acceptanceCriteria.length > 0) {
      req.acceptanceCriteria.forEach((criteria, index) => {
        const scenario = {
          id: `${req.id}-TC-${index + 1}`,
          requirementId: req.id,
          requirementDescription: req.description,
          title: `Verify ${req.id}: ${criteria.substring(0, 50)}`,
          tags: [req.type, `@${req.priority}`, `@${req.id}`],
          steps: parseAcceptanceCriteriaToSteps(criteria),
          type: req.type,
          priority: req.priority
        };
        scenarios.push(scenario);
      });
    } else {
      // Generate default scenario from requirement description
      const scenario = {
        id: `${req.id}-TC-1`,
        requirementId: req.id,
        requirementDescription: req.description,
        title: `Verify ${req.id}`,
        tags: [req.type, `@${req.priority}`, `@${req.id}`],
        steps: parseRequirementToSteps(req.description),
        type: req.type,
        priority: req.priority
      };
      scenarios.push(scenario);
    }
  }
  
  return scenarios;
}

/**
 * Parse acceptance criteria to Gherkin steps
 * @param {string} criteria - Acceptance criteria text
 * @returns {Array} Array of step objects
 */
function parseAcceptanceCriteriaToSteps(criteria) {
  const steps = [];
  const lines = criteria.split(/[\n,;]/).map(l => l.trim()).filter(l => l.length > 0);
  
  for (const line of lines) {
    // Check for Gherkin keywords
    if (line.match(/^Given\s+(.+)$/i)) {
      const match = line.match(/^Given\s+(.+)$/i);
      steps.push({ kind: 'navigate', description: match[1], gherkin: line });
    } else if (line.match(/^When\s+(.+)$/i)) {
      const match = line.match(/^When\s+(.+)$/i);
      steps.push({ kind: 'action', description: match[1], gherkin: line });
    } else if (line.match(/^Then\s+(.+)$/i)) {
      const match = line.match(/^Then\s+(.+)$/i);
      steps.push({ kind: 'assertion', description: match[1], gherkin: line });
    } else if (line.match(/^And\s+(.+)$/i)) {
      const match = line.match(/^And\s+(.+)$/i);
      const lastStep = steps[steps.length - 1];
      if (lastStep) {
        lastStep.description += ' and ' + match[1];
        lastStep.gherkin += '\n    ' + line;
      }
    } else {
      // Try to infer step type from keywords
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes('navigate') || lowerLine.includes('go to') || lowerLine.includes('open')) {
        steps.push({ kind: 'navigate', description: line, gherkin: `    Given ${line}` });
      } else if (lowerLine.includes('click') || lowerLine.includes('select') || lowerLine.includes('enter') ||
                 lowerLine.includes('type') || lowerLine.includes('input')) {
        steps.push({ kind: 'action', description: line, gherkin: `    When ${line}` });
      } else if (lowerLine.includes('verify') || lowerLine.includes('check') || lowerLine.includes('assert') ||
                 lowerLine.includes('should') || lowerLine.includes('must') || lowerLine.includes('display')) {
        steps.push({ kind: 'assertion', description: line, gherkin: `    Then ${line}` });
      } else {
        steps.push({ kind: 'action', description: line, gherkin: `    And ${line}` });
      }
    }
  }
  
  return steps;
}

/**
 * Parse requirement description to steps
 * @param {string} description - Requirement description
 * @returns {Array} Array of step objects
 */
function parseRequirementToSteps(description) {
  const steps = [];
  
  // Try to extract user story format: "As a X, I want Y, so that Z"
  const userStoryMatch = description.match(/As\s+(?:a|an)\s+(.+?),\s+I\s+(?:want|need|should|must)\s+(.+?)(?:,\s+so\s+that\s+(.+?))?$/i);
  if (userStoryMatch) {
    const [, role, action, benefit] = userStoryMatch;
    steps.push({
      kind: 'navigate',
      description: `Navigate to the application as ${role}`,
      gherkin: `    Given I am a ${role}`
    });
    steps.push({
      kind: 'action',
      description: action,
      gherkin: `    When ${action}`
    });
    if (benefit) {
      steps.push({
        kind: 'assertion',
        description: `Verify that ${benefit}`,
        gherkin: `    Then ${benefit}`
      });
    }
  } else {
    // Generic steps based on keywords
    const lowerDesc = description.toLowerCase();
    
    if (lowerDesc.includes('login') || lowerDesc.includes('authenticate')) {
      steps.push({ kind: 'navigate', description: 'Navigate to login page', gherkin: '    Given I navigate to the login page' });
      steps.push({ kind: 'action', description: 'Enter credentials', gherkin: '    When I enter valid credentials' });
      steps.push({ kind: 'action', description: 'Click login button', gherkin: '    And I click the login button' });
      steps.push({ kind: 'assertion', description: 'Verify successful login', gherkin: '    Then I should be logged in successfully' });
    } else if (lowerDesc.includes('search') || lowerDesc.includes('find')) {
      steps.push({ kind: 'navigate', description: 'Navigate to search page', gherkin: '    Given I navigate to the search page' });
      steps.push({ kind: 'action', description: 'Enter search term', gherkin: '    When I enter a search term' });
      steps.push({ kind: 'action', description: 'Click search', gherkin: '    And I click the search button' });
      steps.push({ kind: 'assertion', description: 'Verify search results', gherkin: '    Then I should see search results' });
    } else {
      // Default generic steps
      steps.push({ kind: 'navigate', description: 'Navigate to the application', gherkin: '    Given I navigate to the application' });
      steps.push({ kind: 'action', description: description, gherkin: `    When ${description}` });
      steps.push({ kind: 'assertion', description: 'Verify requirement is met', gherkin: '    Then the requirement should be satisfied' });
    }
  }
  
  return steps;
}

/**
 * Convert test scenarios to Gherkin feature file
 * @param {Array} scenarios - Array of test scenarios
 * @param {string} featureName - Feature name
 * @returns {string} Gherkin feature file content
 */
export function scenariosToGherkin(scenarios, featureName = 'Generated Test Cases') {
  const lines = [];
  lines.push(`Feature: ${featureName}`);
  lines.push('');
  lines.push('  # Test cases generated from SRS/BRD requirements');
  lines.push('');
  
  // Group scenarios by requirement
  const scenariosByReq = {};
  scenarios.forEach(scenario => {
    if (!scenariosByReq[scenario.requirementId]) {
      scenariosByReq[scenario.requirementId] = [];
    }
    scenariosByReq[scenario.requirementId].push(scenario);
  });
  
  // Generate scenarios
  Object.keys(scenariosByReq).forEach(reqId => {
    const reqScenarios = scenariosByReq[reqId];
    reqScenarios.forEach((scenario, index) => {
      if (index > 0) lines.push('');
      
      // Add tags
      if (scenario.tags && scenario.tags.length > 0) {
        const tags = scenario.tags.filter(t => t.startsWith('@')).join(' ');
        if (tags) {
          lines.push(`  ${tags}`);
        }
      }
      
      lines.push(`  Scenario: ${scenario.title}`);
      
      // Add requirement reference as comment
      lines.push(`    # Requirement: ${scenario.requirementId}`);
      lines.push(`    # ${scenario.requirementDescription.substring(0, 100)}`);
      
      // Add steps
      scenario.steps.forEach(step => {
        if (step.gherkin) {
          lines.push(step.gherkin);
        } else {
          // Generate Gherkin from step description
          if (step.kind === 'navigate') {
            lines.push(`    Given ${step.description}`);
          } else if (step.kind === 'action') {
            lines.push(`    When ${step.description}`);
          } else if (step.kind === 'assertion') {
            lines.push(`    Then ${step.description}`);
          } else {
            lines.push(`    And ${step.description}`);
          }
        }
      });
    });
  });
  
  return lines.join('\n');
}

/**
 * Create requirement traceability matrix
 * @param {Array} requirements - Array of requirements
 * @param {Array} scenarios - Array of test scenarios
 * @returns {Object} Traceability matrix
 */
export function createTraceabilityMatrix(requirements, scenarios) {
  const matrix = {
    requirements: requirements.map(req => ({
      id: req.id,
      description: req.description,
      type: req.type,
      priority: req.priority,
      testCases: scenarios.filter(s => s.requirementId === req.id).map(s => ({
        id: s.id,
        title: s.title,
        status: 'Not Executed'
      }))
    })),
    coverage: {
      totalRequirements: requirements.length,
      requirementsWithTests: new Set(scenarios.map(s => s.requirementId)).size,
      totalTestCases: scenarios.length,
      coveragePercentage: 0
    }
  };
  
  if (matrix.coverage.totalRequirements > 0) {
    matrix.coverage.coveragePercentage = Math.round(
      (matrix.coverage.requirementsWithTests / matrix.coverage.totalRequirements) * 100
    );
  }
  
  return matrix;
}

