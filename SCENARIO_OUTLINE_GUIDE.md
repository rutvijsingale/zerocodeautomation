# How to Use Scenario Outline for Data-Driven Testing

## What is Scenario Outline?

**Scenario Outline** is a Cucumber BDD feature that allows you to run the same test scenario with different data sets. Instead of writing multiple similar scenarios, you write one scenario with placeholders and provide test data in an Examples table.

## When to Use Scenario Outline?

Use Scenario Outline when:
- ✅ Testing the same flow with different input data
- ✅ Testing multiple users/roles with the same steps
- ✅ Testing form submissions with different values
- ✅ Testing search functionality with different queries
- ✅ Testing login with different credentials
- ✅ Any scenario where only the data changes, not the steps

## Step-by-Step Guide

### Method 1: Manual Setup (Recommended for Planning)

1. **Enable Scenario Outline**:
   - In the "Step Builder" section, check the checkbox: **"Use Scenario Outline (for data-driven testing)"**
   - The "Examples Table" textarea will appear below

2. **Enter Examples Data**:
   - In the Examples Table field, enter a JSON array
   - Each object in the array represents one test case
   - Keys in the objects become column headers in the Examples table
   - Values are the test data for each row

   **Example JSON:**
   ```json
   [
     {"username": "admin", "password": "admin123"},
     {"username": "user", "password": "user123"},
     {"username": "guest", "password": "guest123"}
   ]
   ```

3. **Record Your Steps**:
   - Record your test flow normally
   - When you type values, use placeholders like `admin`, `user`, etc.
   - The framework will automatically replace these with `<username>`, `<password>`, etc. in the generated Gherkin

4. **Generate Feature File**:
   - The generated Gherkin will have placeholders like `<username>`, `<password>`
   - An Examples table will be generated with your data

### Method 2: Auto-Detection (Recommended for Existing Recordings)

1. **Record Steps First**:
   - Record your test flow with multiple different values for the same field
   - For example: Type "admin" in username field, then type "user" in the same field

2. **Enable Scenario Outline**:
   - After recording, check **"Use Scenario Outline"**
   - The framework will **auto-detect** when the same selector has multiple values
   - It will automatically populate the Examples table with detected values

3. **Review and Adjust**:
   - Check the auto-populated Examples table
   - Add or modify examples as needed
   - The framework will generate the Scenario Outline with your data

## Examples

### Example 1: Login with Different Users

**Step 1**: Check "Use Scenario Outline"

**Step 2**: Enter Examples:
```json
[
  {"username": "admin", "password": "admin123", "expectedMessage": "Welcome Admin"},
  {"username": "user", "password": "user123", "expectedMessage": "Welcome User"},
  {"username": "guest", "password": "guest123", "expectedMessage": "Welcome Guest"}
]
```

**Step 3**: Record steps:
- Navigate to login page
- Type in username field (use any value, e.g., "admin")
- Type in password field (use any value, e.g., "admin123")
- Click login button
- Assert message contains expected text

**Generated Gherkin:**
```gherkin
Feature: Login Test
  Scenario Outline: Login with different users
    Given I navigate to "http://localhost:3000/login"
    When I type "<username>" into "#username"
    And I type "<password>" into "#password"
    And I click "#loginButton"
    Then I should see "<expectedMessage>" in "#welcomeMessage"

    Examples:
      | username | password  | expectedMessage  |
      | admin    | admin123  | Welcome Admin    |
      | user     | user123   | Welcome User     |
      | guest    | guest123  | Welcome Guest    |
```

### Example 2: Search with Different Queries

**Examples JSON:**
```json
[
  {"searchQuery": "laptop", "expectedResults": "10"},
  {"searchQuery": "phone", "expectedResults": "15"},
  {"searchQuery": "tablet", "expectedResults": "8"}
]
```

**Generated Gherkin:**
```gherkin
Scenario Outline: Search with different queries
  Given I navigate to "http://localhost:3000"
  When I type "<searchQuery>" into "#searchBox"
  And I click "#searchButton"
  Then I should see "<expectedResults>" results

  Examples:
    | searchQuery | expectedResults |
    | laptop      | 10              |
    | phone       | 15              |
    | tablet      | 8               |
```

### Example 3: Form Submission with Different Data

**Examples JSON:**
```json
[
  {"firstName": "John", "lastName": "Doe", "email": "john@example.com"},
  {"firstName": "Jane", "lastName": "Smith", "email": "jane@example.com"},
  {"firstName": "Bob", "lastName": "Johnson", "email": "bob@example.com"}
]
```

## How It Works

1. **Placeholder Replacement**:
   - When Scenario Outline is enabled, values in steps are replaced with placeholders
   - Example: `"admin"` becomes `"<username>"`
   - Example: `"admin123"` becomes `"<password>"`

2. **Examples Table**:
   - Each row in the Examples table represents one test execution
   - Column headers match the placeholder names
   - Cucumber runs the scenario once for each row

3. **Execution**:
   - Cucumber replaces placeholders with values from Examples table
   - First execution: `<username>` = "admin", `<password>` = "admin123"
   - Second execution: `<username>` = "user", `<password>` = "user123"
   - And so on...

## Tips and Best Practices

1. **Use Descriptive Column Names**:
   - Use clear names like `username`, `password`, `email`
   - Avoid generic names like `value1`, `value2`

2. **Keep Examples Relevant**:
   - Include positive, negative, and edge cases
   - Test boundary values
   - Test different data types

3. **Auto-Detection Tips**:
   - Record steps with different values for the same field
   - The framework detects when the same selector has multiple values
   - Review auto-detected examples and adjust as needed

4. **JSON Format**:
   - Must be valid JSON array
   - Each object must have the same keys
   - Values can be strings, numbers, or booleans

5. **Combining with Other Features**:
   - Can be used with Background steps
   - Can be used with Tags
   - Can be used in multiple scenarios

## Troubleshooting

### Examples Not Appearing
- ✅ Ensure "Use Scenario Outline" checkbox is checked
- ✅ Verify Examples table has valid JSON
- ✅ Check that JSON is an array of objects

### Placeholders Not Working
- ✅ Ensure you recorded steps with actual values first
- ✅ Check that Examples table keys match placeholder names
- ✅ Verify the generated Gherkin has `<placeholder>` syntax

### Auto-Detection Not Working
- ✅ Record multiple steps with different values for the same selector
- ✅ Ensure the selector is the same (same field)
- ✅ Check browser console for auto-detection messages

## Generated Code Support

The Scenario Outline feature works with:
- ✅ **Playwright + TypeScript**: Step definitions support placeholders
- ✅ **Playwright + Java + Cucumber**: Step definitions support placeholders
- ✅ **Selenium WebDriver + Java + Cucumber**: Step definitions support placeholders

All generated step definitions automatically handle Scenario Outline parameters!

