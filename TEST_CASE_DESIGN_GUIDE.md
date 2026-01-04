# Test Case Design from SRS/BRD - User Guide

## Overview

The Zero-Code Automation IDE now supports **automatic test case generation from SRS/BRD documents**. This feature allows automation engineers to design test cases without writing any code - just upload your requirements document and the tool will:

1. **Extract requirements** from your document
2. **Generate test scenarios** automatically
3. **Create Gherkin feature files** ready for execution
4. **Provide requirement traceability** to track test coverage

## How It Works

### Step 1: Prepare Your Document

Your SRS/BRD document can be in any of these formats:
- **Plain Text** (.txt)
- **Markdown** (.md)
- **Word Document** (.doc, .docx)
- **CSV** (.csv)

### Step 2: Document Format Guidelines

For best results, structure your requirements document with:

#### Option A: Numbered Requirements
```
1.1 User Login
The system shall allow users to log in with username and password.

1.2 Password Reset
Users must be able to reset their password via email.

REQ-001 Search Functionality
The application shall provide a search feature that returns results within 2 seconds.
```

#### Option B: User Story Format
```
As a customer, I want to add items to my shopping cart, so that I can purchase multiple items at once.

As an admin, I need to view user reports, so that I can monitor system usage.
```

#### Option C: Gherkin-like Format
```
Given a user is on the login page
When they enter valid credentials
Then they should be logged in successfully
```

#### Option D: Structured Requirements
```
REQUIREMENT REQ-001: User Authentication
Description: Users must be able to log in to the system
Acceptance Criteria:
- Given I am on the login page
- When I enter valid username and password
- Then I should be logged in
- And I should see the dashboard
```

### Step 3: Upload and Parse

1. Click **"📄 Test Case Design from SRS/BRD"** section
2. Click **"Choose File"** and select your document
3. Click **"🔍 Parse Requirements & Generate Test Cases"**
4. Wait for processing (usually takes a few seconds)

### Step 4: Review Generated Test Cases

After parsing, you'll see:

#### 📋 Extracted Requirements
- **Requirement ID**: Auto-generated or extracted from document
- **Type**: Functional, Performance, Security, Usability, etc.
- **Priority**: High, Medium, or Low (auto-detected)
- **Description**: Full requirement text

#### 🧪 Generated Test Scenarios
- **Test Case ID**: Linked to requirement ID
- **Title**: Descriptive test case name
- **Tags**: Auto-generated tags for filtering (@Functional, @High, @REQ-001)
- **Steps**: Gherkin steps ready for execution

#### 🔗 Requirement Traceability
- **Coverage Percentage**: How many requirements have test cases
- **Requirement-to-Test Mapping**: See which test cases cover which requirements
- **Gap Analysis**: Identify requirements without test coverage

### Step 5: Generate Feature File

1. Review the generated test scenarios
2. Click **"📝 Generate Feature File"**
3. Enter a feature name (optional)
4. The tool generates a complete Gherkin feature file
5. Click **"📋 Copy Feature File"** to copy to clipboard

### Step 6: Use Generated Test Cases

You can now:
- **Copy the feature file** and use it in your Cucumber project
- **Record actual steps** using the browser recording feature
- **Export as a complete project** with the "Generate & Download Project" button

## Supported Requirement Patterns

The parser recognizes these patterns:

### Requirement Identifiers
- `REQ-001`, `REQ-1`, `REQUIREMENT 1`
- `FR-001` (Functional Requirement)
- `NFR-001` (Non-Functional Requirement)
- `1.1`, `1.2.3` (Numbered requirements)
- `[REQ-001]` (Bracketed format)

### User Stories
- `As a [role], I want [action], so that [benefit]`
- `As an [role], I need [action], so that [benefit]`

### Acceptance Criteria
- Lines starting with `Given`, `When`, `Then`, `And`, `But`
- Lines starting with `AC:`, `Acceptance Criteria:`
- Numbered or bulleted lists under requirements

## Automatic Test Case Generation

The tool automatically:

1. **Detects requirement type**:
   - Functional (default)
   - Performance (if mentions speed, load, response time)
   - Security (if mentions authentication, encryption, password)
   - Usability (if mentions UI, interface, design)
   - Compatibility (if mentions browser, platform)
   - Reliability (if mentions availability, uptime)

2. **Assigns priority**:
   - High: Contains "must", "critical", "mandatory", "required"
   - Medium: Contains "should", "important" (default)
   - Low: Contains "nice to have", "optional"

3. **Generates test scenarios**:
   - From acceptance criteria (if provided)
   - From requirement description (if no acceptance criteria)
   - With appropriate Gherkin keywords (Given/When/Then)

4. **Creates tags**:
   - Requirement ID tag: `@REQ-001`
   - Type tag: `@Functional`, `@Performance`, etc.
   - Priority tag: `@High`, `@Medium`, `@Low`

## Example Workflow

### Input Document (SRS.txt):
```
REQ-001: User Login
Users must be able to log in with their username and password.
Acceptance Criteria:
Given I am on the login page
When I enter valid credentials
Then I should be logged in successfully
And I should see the dashboard

REQ-002: Search Functionality
The system shall provide a search feature.
When I enter a search term
And I click the search button
Then I should see relevant results
```

### Generated Output:

**Requirements Extracted:**
- REQ-001: User Login (Functional, High)
- REQ-002: Search Functionality (Functional, Medium)

**Test Scenarios Generated:**
- REQ-001-TC-1: Verify REQ-001: User Login
- REQ-002-TC-1: Verify REQ-002: Search Functionality

**Gherkin Feature File:**
```gherkin
Feature: Generated Test Cases from Requirements

  # Test cases generated from SRS/BRD requirements
  @Functional @High @REQ-001
  Scenario: Verify REQ-001: User Login
    # Requirement: REQ-001
    # Users must be able to log in with their username and password.
    Given I am on the login page
    When I enter valid credentials
    Then I should be logged in successfully
    And I should see the dashboard

  @Functional @Medium @REQ-002
  Scenario: Verify REQ-002: Search Functionality
    # Requirement: REQ-002
    # The system shall provide a search feature.
    Given I navigate to the application
    When I enter a search term
    And I click the search button
    Then I should see relevant results
```

## Integration with Recording

You can combine both features:

1. **Upload SRS/BRD** → Generate test scenarios
2. **Review scenarios** → Identify which ones need recording
3. **Start recording** → Record actual browser interactions
4. **Merge scenarios** → Combine generated scenarios with recorded steps
5. **Export project** → Get complete test automation project

## Tips for Best Results

1. **Use clear requirement IDs**: Makes traceability easier
2. **Include acceptance criteria**: Generates more accurate test cases
3. **Use structured format**: Numbered or labeled requirements parse better
4. **Add user stories**: Natural language requirements work great
5. **Review generated scenarios**: Always review and refine auto-generated test cases
6. **Use tags**: Tags help organize and filter test cases

## Requirement Traceability

The tool automatically creates a traceability matrix showing:
- Which requirements have test cases
- Which requirements are missing test coverage
- Coverage percentage
- Test case IDs linked to each requirement

This helps you:
- **Ensure complete coverage**: See which requirements need test cases
- **Track changes**: When requirements change, see which tests are affected
- **Report to stakeholders**: Show requirement coverage metrics

## Next Steps

After generating test cases from requirements:

1. **Review and refine** the generated scenarios
2. **Record actual steps** using browser recording for complex flows
3. **Combine scenarios** from requirements with recorded steps
4. **Export project** to get ready-to-run test automation code
5. **Execute tests** using the generated code

## Support

For questions or issues:
- Check the **User Manual** for detailed feature documentation
- Review **Quick Start Guide** for step-by-step instructions
- Use **Common Functions** documentation for understanding reusable components

