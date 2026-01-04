# Zero-Code Automation IDE - User Manual

## 📖 Table of Contents
1. [Getting Started](#getting-started)
2. [Basic Configuration](#basic-configuration)
3. [Test Case Design from SRS/BRD](#test-case-design-from-srsbrd)
4. [Browser Recording](#browser-recording)
5. [Manual Step Building](#manual-step-building)
6. [Advanced Cucumber BDD Features](#advanced-cucumber-bdd-features)
7. [Code Generation](#code-generation)
8. [Export & Download](#export--download)
9. [Copy Features](#copy-features)
10. [Troubleshooting](#troubleshooting)

---

## 🚀 Getting Started

### Starting the Application
1. Open terminal/command prompt
2. Navigate to the project directory: `cd zero-code-automation-ide/zero-code-automation-ide`
3. Start the server: `npm start`
4. Open your browser and navigate to: `http://localhost:3000`

### Application Overview
The Zero-Code Automation IDE has two main sections:
- **Left Panel**: Step Builder & Recording Controls
- **Right Panel**: Generated Code Preview

---

## ⚙️ Basic Configuration

### Framework Selection
**Location**: Left panel, top dropdown

**Options**:
- **Playwright + Java + Cucumber** (Default)
- **Selenium WebDriver + Java + Cucumber**

**How to Use**:
1. Select your preferred framework from the dropdown
2. This determines the code generation format

### Browser Selection
**Location**: Left panel, second dropdown

**Options**:
- 🌐 Chrome (Chromium)
- 🦊 Firefox
- 🧭 WebKit (Safari)
- 🔷 Microsoft Edge

**How to Use**:
1. Select the browser for code generation
2. This affects the generated test code

### Project Configuration

#### Project Name
- **Field**: "Project Name"
- **Purpose**: Name for your test project
- **Example**: `my-test-project`
- **Note**: Used as folder name in exports

#### Base URL
- **Field**: "Base URL"
- **Purpose**: Starting URL for your tests
- **Example**: `http://localhost:3000` or `https://example.com`
- **Note**: Leave blank to start with a blank browser

#### Feature Title
- **Field**: "Feature Title"
- **Purpose**: Title for your test scenario
- **Example**: `Login Test Flow`
- **Note**: Appears as scenario name in Gherkin

#### Feature Name
- **Field**: "Feature Name"
- **Purpose**: Name of the feature file
- **Example**: `User Authentication`
- **Note**: Appears as feature name in Gherkin

#### Tags
- **Field**: "Tags (space-separated)"
- **Purpose**: Cucumber tags for test categorization
- **Format**: `@smoke @regression @critical`
- **Example**: `@Regression @E2E`
- **Note**: Tags starting with `@` are automatically extracted

---

## 📄 Test Case Design from SRS/BRD

### Overview

The Zero-Code Automation IDE can automatically generate test cases from your **SRS (Software Requirements Specification)** or **BRD (Business Requirements Document)**. This feature allows automation engineers to design test cases without writing any code - just upload your requirements document and the tool will:

1. **Extract requirements** from your document
2. **Generate test scenarios** automatically
3. **Create Gherkin feature files** ready for execution
4. **Provide requirement traceability** to track test coverage

### Supported Document Formats

- **Plain Text** (.txt)
- **Markdown** (.md)
- **Word Document** (.doc, .docx)
- **CSV** (.csv)

### Document Format Guidelines

For best results, structure your requirements document using one of these formats:

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

### Supported Requirement Patterns

The parser recognizes these patterns:

#### Requirement Identifiers
- `REQ-001`, `REQ-1`, `REQUIREMENT 1`
- `FR-001` (Functional Requirement)
- `NFR-001` (Non-Functional Requirement)
- `1.1`, `1.2.3` (Numbered requirements)
- `[REQ-001]` (Bracketed format)

#### User Stories
- `As a [role], I want [action], so that [benefit]`
- `As an [role], I need [action], so that [benefit]`

#### Acceptance Criteria
- Lines starting with `Given`, `When`, `Then`, `And`, `But`
- Lines starting with `AC:`, `Acceptance Criteria:`
- Numbered or bulleted lists under requirements

### How to Use

#### Step 1: Upload Document

1. Navigate to the **"📄 Test Case Design from SRS/BRD"** section
2. Click **"Choose File"** and select your SRS/BRD document
3. Supported formats: `.txt`, `.md`, `.doc`, `.docx`, `.csv`
4. **Tip**: Download the sample SRS file to see the expected format

#### Step 2: Parse Requirements

1. Click **"🔍 Parse Requirements & Generate Test Cases"**
2. Wait for processing (usually takes a few seconds)
3. The tool will:
   - Extract all requirements from the document
   - Detect requirement types (Functional, Performance, Security, etc.)
   - Assign priorities (High, Medium, Low)
   - Generate test scenarios automatically

#### Step 3: Review Results

After parsing, you'll see three sections:

##### 📋 Extracted Requirements
- **Requirement ID**: Auto-generated or extracted from document
- **Type**: Functional, Performance, Security, Usability, Compatibility, Reliability
- **Priority**: High, Medium, or Low (auto-detected)
- **Description**: Full requirement text
- **Acceptance Criteria**: Number of acceptance criteria items

##### 🧪 Generated Test Scenarios
- **Test Case ID**: Linked to requirement ID (e.g., `REQ-001-TC-1`)
- **Title**: Descriptive test case name
- **Tags**: Auto-generated tags for filtering:
  - `@Functional`, `@Performance`, `@Security` (type tags)
  - `@High`, `@Medium`, `@Low` (priority tags)
  - `@REQ-001` (requirement ID tag)
- **Steps**: Number of Gherkin steps in the scenario
- **Requirement Link**: Shows which requirement this test case covers

##### 🔗 Requirement Traceability
- **Coverage Percentage**: How many requirements have test cases
- **Requirement-to-Test Mapping**: See which test cases cover which requirements
- **Gap Analysis**: Identify requirements without test coverage (shown in red)

#### Step 4: Generate Feature File

1. Review the generated test scenarios
2. Click **"📝 Generate Feature File"**
3. Enter a feature name (optional, defaults to "Generated Test Cases from Requirements")
4. The tool generates a complete Gherkin feature file
5. Click **"📋 Copy Feature File"** to copy to clipboard

### Automatic Test Case Generation

The tool automatically:

#### 1. Detects Requirement Type
- **Functional** (default): General functional requirements
- **Performance**: If mentions speed, load, response time, throughput
- **Security**: If mentions authentication, encryption, password, authorization
- **Usability**: If mentions UI, interface, design, user experience
- **Compatibility**: If mentions browser, platform
- **Reliability**: If mentions availability, uptime

#### 2. Assigns Priority
- **High**: Contains "must", "critical", "mandatory", "required", "essential"
- **Medium**: Contains "should", "important" (default)
- **Low**: Contains "nice to have", "optional", "low priority"

#### 3. Generates Test Scenarios
- **From Acceptance Criteria**: If acceptance criteria are provided, generates scenarios from them
- **From Requirement Description**: If no acceptance criteria, generates scenarios from requirement text
- **With Appropriate Gherkin Keywords**: Given/When/Then/And steps

#### 4. Creates Tags
- **Requirement ID tag**: `@REQ-001`
- **Type tag**: `@Functional`, `@Performance`, etc.
- **Priority tag**: `@High`, `@Medium`, `@Low`

### Example Workflow

#### Input Document (SRS.txt):
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

#### Generated Output:

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

### Requirement Traceability

The tool automatically creates a traceability matrix showing:

- **Which requirements have test cases**: Green indicator with test case count
- **Which requirements are missing test coverage**: Red indicator with warning
- **Coverage percentage**: Overall requirement coverage metric
- **Test case IDs linked to each requirement**: Easy navigation

This helps you:
- **Ensure complete coverage**: See which requirements need test cases
- **Track changes**: When requirements change, see which tests are affected
- **Report to stakeholders**: Show requirement coverage metrics

### Integration with Recording

You can combine both features:

1. **Upload SRS/BRD** → Generate test scenarios
2. **Review scenarios** → Identify which ones need recording
3. **Start recording** → Record actual browser interactions
4. **Merge scenarios** → Combine generated scenarios with recorded steps
5. **Export project** → Get complete test automation project

### Tips for Best Results

1. **Use clear requirement IDs**: Makes traceability easier
   - Good: `REQ-001`, `FR-001`, `1.1`
   - Avoid: `Requirement 1`, `First requirement`

2. **Include acceptance criteria**: Generates more accurate test cases
   - Use Gherkin keywords: `Given`, `When`, `Then`, `And`
   - Be specific about expected outcomes

3. **Use structured format**: Numbered or labeled requirements parse better
   - Numbered: `1.1`, `1.2`, `2.1`
   - Labeled: `REQ-001`, `FR-001`, `NFR-001`

4. **Add user stories**: Natural language requirements work great
   - Format: `As a [role], I want [action], so that [benefit]`

5. **Review generated scenarios**: Always review and refine auto-generated test cases
   - Check if steps make sense
   - Verify all requirements are covered
   - Add missing test cases manually if needed

6. **Use tags effectively**: Tags help organize and filter test cases
   - Run specific requirement tests: `mvn test -Dcucumber.filter.tags="@REQ-001"`
   - Run by priority: `mvn test -Dcucumber.filter.tags="@High"`
   - Run by type: `mvn test -Dcucumber.filter.tags="@Functional"`

### Common Use Cases

#### Use Case 1: New Project Setup
1. Upload complete SRS document
2. Generate all test scenarios
3. Review traceability matrix
4. Identify missing test cases
5. Record actual browser interactions
6. Export complete test project

#### Use Case 2: Requirement Updates
1. Upload updated SRS
2. Compare with existing test cases
3. Identify new requirements
4. Generate test cases for new requirements
5. Update existing test cases if needed

#### Use Case 3: Test Coverage Analysis
1. Upload SRS document
2. Generate test scenarios
3. Review traceability matrix
4. Identify gaps in coverage
5. Generate test cases for uncovered requirements

### Sample SRS Document

A sample SRS document is available for download:
- Click **"📥 Download Sample SRS"** link in the upload section
- Use it as a template for your own requirements documents
- See the expected format and structure

---

## 🎬 Browser Recording

### Starting Recording

1. **Configure Settings**:
   - Set Project Name
   - Set Base URL (optional)
   - Select Framework
   - Select Browser Type

2. **Click "🎬 Start Recording"**
   - A new browser window opens
   - The recording status shows "Recording..."

3. **Interact with the Browser**:
   - Navigate to pages
   - Click elements
   - Type in fields
   - Select dropdowns
   - All actions are captured automatically

### Recording Controls

#### Start Recording
- **Button**: 🎬 Start Recording
- **Action**: Opens browser and starts capturing actions
- **Status**: Shows "Recording... (X steps)"

#### Stop Recording
- **Button**: ⏹ Stop Recording
- **Action**: Stops recording and generates code
- **Result**: Code appears in Generated Code section

#### Pause Recording
- **Button**: ⏸ Pause
- **Action**: Temporarily pauses action capture
- **Use Case**: When you need to interact without recording

### What Gets Recorded

✅ **Automatically Recorded**:
- Page navigation
- Clicks on buttons, links, elements
- Text input (debounced - only final value)
- Dropdown selections
- Browser close events
- Assertions (if using assertion tools)

❌ **Not Recorded**:
- Mouse movements (without clicks)
- Keyboard shortcuts (unless they trigger actions)
- Browser developer tools interactions

### Recording Status Indicators

- **● Ready to record**: Not recording
- **● Recording... (X steps)**: Active recording with step count
- **● Paused**: Recording paused

---

## 📝 Manual Step Building

### Adding Steps Manually

If you prefer to build steps without recording:

1. **Select Step Type** from dropdown:
   - Navigate
   - Click
   - Type
   - Assert Text Contains
   - Assert Visible
   - Assert Attribute
   - Assert Count
   - Assert Value
   - Wait
   - Wait For Selector
   - Take Screenshot
   - API Call

2. **Fill in Details**:
   - **Selector**: CSS selector, XPath, or role (e.g., `#username`, `text=Login`)
   - **Value**: Text to type, URL to navigate, etc.
   - **Expected Value**: For assertions only

3. **Click "➕ Add Step"**

### Step List Management

- **View Steps**: All recorded/added steps appear in the list
- **Step Count**: Shows total number of steps
- **Clear All**: Click "🗑️ Clear All Steps" to remove all steps

---

## 🥒 Advanced Cucumber BDD Features

### Scenario Outline (Data-Driven Testing)

**Use Case**: Test the same flow with different data sets

#### How to Use:

1. **Enable Scenario Outline**:
   - Check "Use Scenario Outline (for data-driven testing)"
   - Examples table field appears

2. **Provide Examples**:
   - **Auto-Detection**: Framework detects when same selector has multiple values
   - **Manual Entry**: Enter JSON array in Examples table:
     ```json
     [
       {"username": "admin", "password": "admin123"},
       {"username": "user", "password": "user123"},
       {"username": "guest", "password": "guest123"}
     ]
     ```

3. **Record Steps Normally**:
   - Record your test flow
   - Values will be parameterized as `<username>`, `<password>`, etc.

4. **Generated Output**:
   ```gherkin
   Scenario Outline: Login with different users
     When I type "<username>" into "#username"
     And I type "<password>" into "#password"
     And I click "#loginButton"
     Then I should see "Welcome" in "#message"

     Examples:
       | username | password  |
       | admin    | admin123  |
       | user     | user123   |
       | guest    | guest123  |
   ```

### Background Steps (Shared Setup)

**Use Case**: Common setup steps shared across scenarios

#### How to Use:

1. **Enable Background**:
   - Check "Mark next steps as Background (shared setup)"

2. **Record Setup Steps**:
   - Navigate to login page
   - Enter credentials
   - Click login
   - (Any common setup steps)

3. **Uncheck Background**:
   - Uncheck the checkbox
   - Continue recording scenario-specific steps

4. **Generated Output**:
   ```gherkin
   Feature: User Management
     Background:
       Given I navigate to "http://localhost:3000"
       And I type "admin" into "#username"
       And I type "admin123" into "#password"
       And I click "#loginButton"

     Scenario: Create new user
       When I click "#createUserButton"
       ...
   ```

### Multiple Scenarios

**Use Case**: Multiple test scenarios in one feature file

#### How to Use:

1. **Record First Scenario**:
   - Record all steps for scenario 1

2. **Create New Scenario**:
   - Check "Create new scenario after current steps"
   - Continue recording - new scenario is created automatically

3. **Repeat for Additional Scenarios**:
   - Record steps for scenario 2
   - Check "Create new scenario" again for scenario 3
   - Continue as needed

4. **Generated Output**:
   ```gherkin
   Feature: E-commerce Flow
     @Smoke
     Scenario: Add item to cart
       Given I navigate to "http://localhost:3000"
       When I click "#product1"
       ...

     @Regression
     Scenario: Checkout process
       Given I navigate to "http://localhost:3000"
       When I click "#cart"
       ...
   ```

### Tags

**Use Case**: Categorize and filter tests

#### How to Use:

1. **Method 1 - Tags Field**:
   - Enter tags in "Tags" field: `@Regression @Smoke @Critical`
   - Space-separated, must start with `@`

2. **Method 2 - During Recording**:
   - Type `@Regression` in any input field during recording
   - Framework automatically extracts it as a tag

3. **Tag Levels**:
   - **Feature-level**: Tags at feature level (applies to all scenarios)
   - **Scenario-level**: Tags at scenario level (specific to scenario)

4. **Generated Output**:
   ```gherkin
   @E2E @Critical
   Feature: Complete User Journey
     @Smoke
     Scenario: User Registration
       ...

     @Regression
     Scenario: User Login
       ...
   ```

5. **Running Tagged Tests**:
   ```bash
   # Run only @Regression tests
   mvn test -Dcucumber.filter.tags="@Regression"
   
   # Run @Smoke but not @Slow
   mvn test -Dcucumber.filter.tags="@Smoke and not @Slow"
   ```

---

## 💻 Code Generation

### Real-Time Code Preview

As you record or add steps, code is generated in real-time in three formats:

1. **📜 Playwright TypeScript**
   - TypeScript code using Playwright API
   - Ready to run with Playwright

2. **🥒 Gherkin Feature**
   - Cucumber/Gherkin feature file
   - BDD format with Given/When/Then/And steps
   - Shows "● LIVE" badge during recording

3. **🔧 Step Definitions**
   - TypeScript step definitions
   - Maps Gherkin steps to Playwright code
   - Editable textarea

### Code Sections

#### Playwright TypeScript
- **Location**: Right panel, top section
- **Format**: TypeScript code
- **Use**: Direct Playwright test execution

#### Gherkin Feature
- **Location**: Right panel, middle section
- **Format**: Gherkin syntax
- **Features**:
  - Copy button (📋 Copy)
  - Live updates during recording
  - Shows tags, scenarios, background

#### Step Definitions
- **Location**: Right panel, bottom section
- **Format**: TypeScript step definitions
- **Features**:
  - Copy button (📋 Copy)
  - Editable (you can modify the code)
  - Save/Load buttons (when project is generated)

---

## 📥 Export & Download

### Generating Project

1. **Complete Your Test**:
   - Record or add all steps
   - Configure feature name, title, tags
   - Set up advanced BDD features if needed

2. **Click "🚀 Generate & Download Project"**

3. **What Gets Generated**:
   - Complete Maven/Node.js project structure
   - Feature files (.feature)
   - Step definitions (.java or .ts)
   - Configuration files (pom.xml, package.json, etc.)
   - All dependencies configured

4. **Download**:
   - ZIP file downloads automatically
   - Extract and use in your IDE

### Project Structure (Java)

```
your-project/
├── pom.xml
├── src/
│   ├── main/java/
│   └── test/
│       ├── java/
│       │   ├── steps/
│       │   │   └── RecordedSteps.java
│       │   └── support/
│       │       └── PlaywrightWorld.java (or SeleniumWorld.java)
│       └── resources/
│           ├── features/
│           │   └── RecordedTest.feature
│           └── cucumber.properties
└── test.zero.json
```

### Project Structure (TypeScript)

```
your-project/
├── package.json
├── playwright.config.ts
├── cucumber.config.js
├── features/
│   └── RecordedTest.feature
├── steps/
│   └── RecordedTestSteps.ts
└── tests/
    └── recorded.spec.ts
```

---

## 📋 Copy Features

### Copy Gherkin Feature

1. **Locate**: Right panel, "🥒 Gherkin Feature" section
2. **Click**: "📋 Copy" button (top right of section)
3. **Result**: 
   - Button changes to "✅ Copied!" (green)
   - Feature file content copied to clipboard
   - Auto-resets after 2 seconds

### Copy Step Definitions

1. **Locate**: Right panel, "🔧 Step Definitions" section
2. **Click**: "📋 Copy" button (top right of section)
3. **Result**:
   - Button changes to "✅ Copied!" (green)
   - Step definitions code copied to clipboard
   - Auto-resets after 2 seconds

### Using Copied Code

- **Paste** into your IDE or text editor
- **Save** as `.feature` file (for Gherkin)
- **Save** as `.ts` or `.java` file (for step definitions)

---

## 🔧 Step Definitions File Management

### Save Step Definitions

1. **Edit** the step definitions in the textarea
2. **Click** "💾 Save Changes"
3. **Status**: Shows "✅ Saved successfully!"
4. **Location**: Saved to project export directory

### Load Step Definitions

1. **Click** "📂 Load from File"
2. **Requirement**: Must have a project generated first
3. **Result**: Loads saved step definitions from file

---

## 🎯 Complete Workflow Example

### Example: Recording a Login Test

1. **Setup**:
   ```
   Project Name: login-test
   Base URL: http://localhost:3000
   Feature Title: User Login Flow
   Feature Name: Authentication
   Tags: @Smoke @Regression
   ```

2. **Start Recording**:
   - Click "🎬 Start Recording"
   - Browser opens

3. **Record Actions**:
   - Navigate to login page
   - Type username: `admin`
   - Type password: `admin123`
   - Click login button
   - Verify welcome message

4. **Stop Recording**:
   - Click "⏹ Stop Recording"
   - Code appears in Generated Code section

5. **Review Generated Code**:
   - Check Gherkin Feature
   - Check Step Definitions
   - Verify all steps are correct

6. **Copy or Export**:
   - Copy Gherkin Feature (if needed)
   - Copy Step Definitions (if needed)
   - Or click "🚀 Generate & Download Project"

7. **Use Generated Code**:
   - Extract downloaded ZIP
   - Open in IDE (IntelliJ, Eclipse, VS Code)
   - Run tests with Maven or npm

---

## 🎨 UI Features Reference

### Left Panel Controls

| Control | Purpose | Location |
|---------|---------|----------|
| Framework Selection | Choose automation framework | Top dropdown |
| Browser Selection | Choose browser for code gen | Second dropdown |
| Project Name | Name your test project | Text input |
| Base URL | Starting URL for tests | Text input |
| Feature Title | Scenario title | Text input |
| Feature Name | Feature file name | Text input |
| Tags | Cucumber tags | Text input |
| Use Scenario Outline | Enable data-driven testing | Checkbox |
| Examples Table | Test data for Scenario Outline | Textarea (when enabled) |
| Mark as Background | Mark steps as background | Checkbox |
| Create New Scenario | Create multiple scenarios | Checkbox |
| **SRS/BRD Upload** | Upload requirements document | File input |
| **Parse Requirements** | Parse document and generate test cases | Button |
| **Generate Feature File** | Generate Gherkin from scenarios | Button |
| **Copy Feature File** | Copy generated feature to clipboard | Button |
| Step Kind | Type of step to add | Dropdown |
| Selector | Element selector | Text input |
| Value | Input value/URL | Text input |
| Expected Value | Assertion expected value | Text input (for assertions) |
| Add Step | Add manual step | Button |
| Clear All Steps | Remove all steps | Button |
| Export Steps JSON | Export steps as JSON | Button |
| Start Recording | Begin browser recording | Button |
| Stop Recording | End recording | Button |
| Pause Recording | Pause action capture | Button |

### Right Panel Sections

| Section | Content | Features |
|---------|---------|----------|
| **Requirements Results** | Extracted requirements and test scenarios | Summary, Requirements list, Test scenarios, Traceability matrix |
| **Generated Feature** | Gherkin feature from requirements | Copy button, Full feature file |
| Playwright TypeScript | TypeScript test code | Read-only preview |
| Gherkin Feature | Cucumber feature file | Copy button, Live updates |
| Step Definitions | Step definition code | Copy button, Editable, Save/Load |
| Generate & Download | Export project | Downloads ZIP file |

---

## 🐛 Troubleshooting

### Recording Not Working

**Problem**: Actions not being recorded

**Solutions**:
1. Check browser console for errors
2. Verify WebSocket connection (check status)
3. Ensure server is running on port 3000
4. Try refreshing the page
5. Check if recording is paused

### Code Not Updating

**Problem**: Generated code doesn't update

**Solutions**:
1. Check browser console for JavaScript errors
2. Verify steps are being added (check step count)
3. Try clicking "Clear All Steps" and re-recording
4. Refresh the page

### Copy Not Working

**Problem**: Copy button doesn't copy

**Solutions**:
1. Check browser permissions for clipboard
2. Try manual selection and copy (Ctrl+C / Cmd+C)
3. Check browser console for errors
4. Ensure content exists in the code section

### Scenario Outline Not Working

**Problem**: Examples not generating

**Solutions**:
1. Ensure "Use Scenario Outline" is checked
2. Verify Examples table has valid JSON
3. Check that same selector has multiple values
4. Review console for JSON parsing errors

### Tags Not Appearing

**Problem**: Tags not extracted

**Solutions**:
1. Ensure tags start with `@`
2. Use space-separated format: `@tag1 @tag2`
3. Check if tag was typed in tags field or during recording
4. Verify feature file generation

### Export Fails

**Problem**: Download doesn't work

**Solutions**:
1. Check browser download settings
2. Verify project name is valid (no special characters)
3. Check server logs for errors
4. Ensure all required fields are filled

### SRS/BRD Parsing Issues

**Problem**: Requirements not being extracted

**Solutions**:
1. Check document format - use supported formats (.txt, .md, .doc, .docx)
2. Verify requirement patterns - use clear IDs like `REQ-001` or `1.1`
3. Check file size - must be under 10MB
4. Review document structure - use numbered or labeled requirements
5. Check server logs for parsing errors

**Problem**: Test scenarios not generated

**Solutions**:
1. Ensure requirements have descriptions
2. Add acceptance criteria for better scenario generation
3. Check if requirements match supported patterns
4. Review generated requirements list
5. Manually add test scenarios if needed

**Problem**: Traceability matrix shows low coverage

**Solutions**:
1. Review requirements without test cases (shown in red)
2. Generate test scenarios for missing requirements
3. Check if acceptance criteria are provided
4. Manually create test cases for complex requirements

---

## 💡 Tips & Best Practices

### Recording Tips

1. **Clear Steps First**: Start with a clean slate
2. **Use Descriptive Names**: Project name, feature name should be clear
3. **Record Complete Flows**: Don't stop mid-flow
4. **Verify Steps**: Check step list after recording
5. **Use Pause**: Pause when navigating to test data

### BDD Best Practices

1. **Use Meaningful Tags**: `@Smoke`, `@Regression`, `@Critical`
2. **Scenario Outline for Data**: Use when testing multiple data sets
3. **Background for Setup**: Common login/navigation steps
4. **Multiple Scenarios**: Group related tests in one feature

### Code Quality

1. **Review Generated Code**: Always check before using
2. **Edit Step Definitions**: Customize as needed
3. **Save Changes**: Save edited step definitions
4. **Test Locally**: Run tests in your environment

### Performance

1. **Debounced Typing**: Framework automatically debounces typing (800ms)
2. **Merged Actions**: Duplicate type actions are merged
3. **Efficient Recording**: Only records meaningful actions

---

## 📚 Additional Resources

- **Cucumber Documentation**: https://cucumber.io/docs
- **Playwright Documentation**: https://playwright.dev
- **Selenium Documentation**: https://www.selenium.dev/documentation
- **Gherkin Syntax**: https://cucumber.io/docs/gherkin/reference

---

## 🆘 Support

### Common Issues

- **Server not starting**: Check if port 3000 is available
- **Browser not opening**: Check Playwright installation
- **Code generation errors**: Check console logs
- **Export errors**: Verify file permissions

### Getting Help

1. Check server logs in terminal
2. Check browser console (F12)
3. Review error messages
4. Verify all dependencies are installed

---

## ✅ Quick Reference Checklist

### For SRS/BRD Test Case Design:
- [ ] Document prepared in supported format
- [ ] Requirements have clear IDs (REQ-001, 1.1, etc.)
- [ ] Acceptance criteria included (if available)
- [ ] Document uploaded successfully
- [ ] Requirements parsed and extracted
- [ ] Test scenarios generated
- [ ] Traceability matrix reviewed
- [ ] Feature file generated
- [ ] Feature file copied or integrated with recording

### Before recording:
- [ ] Framework selected
- [ ] Browser selected
- [ ] Project name set
- [ ] Base URL configured (if needed)
- [ ] Feature name and title set
- [ ] Tags added (if needed)

### During recording:
- [ ] Recording started
- [ ] Browser window opened
- [ ] Actions performed
- [ ] Steps appearing in list
- [ ] Code updating in real-time

### After recording:
- [ ] Review generated code
- [ ] Copy Gherkin Feature (if needed)
- [ ] Copy Step Definitions (if needed)
- [ ] Generate & Download Project
- [ ] Test in your IDE

---

**Version**: 1.0.0  
**Last Updated**: 2025-01-09  
**Framework Support**: Playwright (Java/TypeScript), Selenium WebDriver (Java)  
**Features**: Browser Recording, SRS/BRD Test Case Design, Common Functions, Real-time Code Generation, Requirement Traceability

