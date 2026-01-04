# Cucumber BDD Features Support

This document explains how the Zero-Code Automation IDE framework understands and generates advanced Cucumber BDD features.

## Supported Cucumber Features

### 1. **Tags** ✅
Tags are automatically extracted from type actions that start with `@`.

#### How it works:
- When you type `@Regression` or `@Regression @Smoke` in a tags field, the framework:
  - Extracts all tags starting with `@`
  - Adds them as scenario-level tags
  - Removes the type action from steps (it's not a step, it's metadata)

#### Example:
```gherkin
Feature: Recorded Feature
  @Regression @Smoke
  Scenario: Recorded Flow
    Given I navigate to "http://localhost:3000"
    ...
```

#### Usage:
- Type tags in the "Tags" input field: `@Regression @Smoke @Critical`
- Or type `@Regression` in any input field during recording
- Tags work with Cucumber's tag filtering: `mvn test -Dcucumber.filter.tags="@Regression"`

---

### 2. **Scenario Outline** ✅
Scenario Outline allows you to run the same scenario with different data sets using an Examples table.

#### How it works:
- The framework **auto-detects** when the same selector has multiple different values
- You can manually enable Scenario Outline by providing an `examples` array
- Steps with variable values are automatically parameterized with `<value>`, `<url>`, etc.

#### Example Output:
```gherkin
Feature: Login Test
  Scenario Outline: Login with different users
    Given I navigate to "<url>"
    When I type "<username>" into "#username"
    And I type "<password>" into "#password"
    And I click "#loginButton"
    Then I should see "<expectedText>" in "#welcomeMessage"

    Examples:
      | url                    | username | password | expectedText    |
      | http://localhost:3000 | admin    | admin123 | Welcome Admin  |
      | http://localhost:3000 | user     | user123  | Welcome User   |
      | http://localhost:3000 | guest    | guest123 | Welcome Guest  |
```

#### Auto-Detection:
The framework detects Scenario Outline opportunities when:
- Same selector (e.g., `#username`) has multiple different values
- Same steps are repeated with different data

#### Manual Usage (via API):
```javascript
{
  featureName: "Login Test",
  featureTitle: "Login with different users",
  useScenarioOutline: true,
  examples: [
    { url: "http://localhost:3000", username: "admin", password: "admin123", expectedText: "Welcome Admin" },
    { url: "http://localhost:3000", username: "user", password: "user123", expectedText: "Welcome User" }
  ],
  steps: [...]
}
```

---

### 3. **Background** ✅
Background steps are executed before each scenario in a feature file.

#### How it works:
- Background steps are common setup steps shared across scenarios
- Pass `backgroundSteps` array to `generateFeatureFile()`

#### Example:
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

  Scenario: Delete user
    When I click "#deleteUserButton"
    ...
```

#### Usage (via API):
```javascript
{
  featureName: "User Management",
  backgroundSteps: [
    { kind: "navigate", url: "http://localhost:3000" },
    { kind: "type", selector: "#username", value: "admin" },
    { kind: "type", selector: "#password", value: "admin123" },
    { kind: "click", selector: "#loginButton" }
  ],
  scenarios: [...]
}
```

---

### 4. **Multiple Scenarios** ✅
A single feature file can contain multiple scenarios.

#### Example:
```gherkin
Feature: E-commerce Flow
  @Smoke
  Scenario: Add item to cart
    Given I navigate to "http://localhost:3000"
    When I click "#product1"
    And I click "#addToCart"
    Then "#cartCount" should be visible

  @Regression
  Scenario: Checkout process
    Given I navigate to "http://localhost:3000"
    When I click "#cart"
    And I click "#checkout"
    Then I should see "Order Confirmed" in "#message"
```

#### Usage (via API):
```javascript
{
  featureName: "E-commerce Flow",
  scenarios: [
    {
      title: "Add item to cart",
      tags: ["@Smoke"],
      steps: [...]
    },
    {
      title: "Checkout process",
      tags: ["@Regression"],
      steps: [...]
    }
  ]
}
```

---

### 5. **Feature-Level Tags** ✅
Tags can be applied at the feature level (affects all scenarios) or scenario level.

#### Example:
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

- `@E2E @Critical` - Feature-level tags (applied to all scenarios)
- `@Smoke`, `@Regression` - Scenario-level tags

---

## Framework Support

### For Selenium WebDriver + Java:
✅ All Cucumber features work with Java step definitions
✅ Scenario Outline parameters are handled in Java step definitions
✅ Tags work with Cucumber's tag filtering

### For Playwright + Java:
✅ All Cucumber features work with Playwright Java step definitions
✅ Scenario Outline parameters are handled in Java step definitions
✅ Tags work with Cucumber's tag filtering

### For Playwright + TypeScript:
✅ All Cucumber features work with TypeScript step definitions
✅ Scenario Outline parameters are handled in TypeScript step definitions
✅ Tags work with Cucumber's tag filtering

---

## Step Definitions for Scenario Outline

The framework automatically generates step definitions that support Scenario Outline placeholders:

### TypeScript Example:
```typescript
And('I type {string} into {string}', async function(this: PlaywrightWorld, val: string, selector: string) {
  await this.page.fill(selector, val);
});
```

### Java Example:
```java
@And("I type {string} into {string}")
public void iTypeIntoField(String value, String selector) {
    getPage().locator(selector).fill(value);
}
```

When Cucumber runs a Scenario Outline, it automatically:
1. Replaces `<value>`, `<url>`, etc. with values from Examples table
2. Matches step definitions using the same patterns
3. Executes the scenario once for each row in Examples

---

## Best Practices

1. **Use Tags Wisely**: 
   - `@Smoke` - Quick validation tests
   - `@Regression` - Full regression suite
   - `@Critical` - Business-critical paths
   - `@E2E` - End-to-end flows

2. **Scenario Outline When**:
   - Same steps with different data
   - Testing multiple users/roles
   - Testing multiple environments
   - Data-driven testing

3. **Background When**:
   - Common setup steps (login, navigation)
   - Shared prerequisites
   - Reduces duplication

4. **Multiple Scenarios When**:
   - Different test flows in same feature
   - Related but independent test cases
   - Better organization

---

## How the Framework Understands These Features

1. **Tags**: Extracted from type actions starting with `@`
2. **Scenario Outline**: Auto-detected or manually enabled via API
3. **Background**: Provided via `backgroundSteps` parameter
4. **Multiple Scenarios**: Provided via `scenarios` array parameter
5. **Feature Tags**: Tags at feature level vs scenario level

The framework generates proper Gherkin syntax that Cucumber understands natively, ensuring full compatibility with Cucumber's execution engine.

