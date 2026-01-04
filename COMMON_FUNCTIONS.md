# Common Functions Documentation

## Overview

This project now uses **common reusable functions** to eliminate code duplication across recording, code generation, and script execution features. This makes the codebase more maintainable and ensures consistent behavior across all features.

## File Structure

### Backend Common Functions
- **Location**: `utils/stepHandlers.js`
- **Purpose**: Server-side step execution and code generation
- **Used by**: 
  - `routes/api.js` (Rerun endpoint)
  - Any backend code that needs to execute or generate code for steps

### Frontend Common Functions
- **Location**: `public/stepHandlers.js`
- **Purpose**: Client-side code generation and step display
- **Used by**: 
  - `public/app.js` (UI code generation)
  - Browser-based recording interface

## Available Functions

### Backend Functions (`utils/stepHandlers.js`)

#### `executePlaywrightStep(page, step)`
Executes a single step using Playwright.

**Parameters:**
- `page`: Playwright page object
- `step`: Step action object

**Returns:** `Promise<void>` (or `null` if page was closed)

**Example:**
```javascript
import { executePlaywrightStep } from '../utils/stepHandlers.js';
await executePlaywrightStep(page, { kind: 'click', selector: '#button' });
```

#### `generatePlaywrightStepCode(step)`
Generates Playwright TypeScript code for a step.

**Parameters:**
- `step`: Step action object

**Returns:** `string` - Generated code lines

#### `generateSeleniumStepCode(step)`
Generates Selenium Java code for a step.

**Parameters:**
- `step`: Step action object

**Returns:** `string` - Generated code lines

#### `generateGherkinStepLine(step, usePlaceholders)`
Generates Gherkin feature file step line.

**Parameters:**
- `step`: Step action object
- `usePlaceholders`: Boolean - Use placeholders for Scenario Outline

**Returns:** `string` - Generated Gherkin step line

#### `getStepLabel(step)`
Gets human-readable label for a step.

**Parameters:**
- `step`: Step action object

**Returns:** `string` - Human-readable label

#### `getStepIcon(kind)`
Gets icon/emoji for a step kind.

**Parameters:**
- `kind`: Step kind string

**Returns:** `string` - Icon/emoji

#### `validateStep(step)`
Validates a step object.

**Parameters:**
- `step`: Step action object

**Returns:** `{ valid: boolean, error?: string }`

### Frontend Functions (`public/stepHandlers.js`)

All frontend functions are accessible via `window.StepHandlers`:

```javascript
// Generate Playwright code
const code = window.StepHandlers.generatePlaywrightStepCode(step);

// Generate Selenium code
const code = window.StepHandlers.generateSeleniumStepCode(step);

// Generate Gherkin step
const line = window.StepHandlers.generateGherkinStepLine(step, false);

// Get step label
const label = window.StepHandlers.getStepLabel(step);

// Get step icon
const icon = window.StepHandlers.getStepIcon(step.kind);

// Get assertion method
const method = window.StepHandlers.getAssertionMethod('equals');
```

## Supported Step Types

The common functions support the following step types:

- `navigate` - Navigate to URL
- `click` - Click element
- `doubleClick` - Double click element
- `type` - Type text into field
- `select` - Select option from dropdown
- `check` - Check checkbox
- `uncheck` - Uncheck checkbox
- `hover` - Hover over element
- `keyPress` - Press keyboard key
- `assertText` - Assert text content
- `assertVisible` - Assert element visibility
- `assertAttribute` - Assert attribute value
- `assertCount` - Assert element count
- `assertValue` - Assert input value
- `waitFor` - Wait for milliseconds
- `waitForSelector` - Wait for selector
- `screenshot` - Take screenshot
- `close` - Close browser/page

## Benefits

1. **Code Reusability**: Same logic used across recording, generation, and execution
2. **Consistency**: Ensures all features behave the same way
3. **Maintainability**: Update once, affects all features
4. **Testability**: Easier to test common functions in isolation
5. **Extensibility**: Easy to add new step types in one place

## Usage Examples

### Backend: Using in Rerun Endpoint

```javascript
import { executePlaywrightStep } from '../utils/stepHandlers.js';

// Execute all steps
for (const step of steps) {
  await executePlaywrightStep(page, step);
}
```

### Frontend: Using in Code Generation

```javascript
// Generate Playwright code
function generatePlaywright() {
  const lines = [];
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push(`test('My Test', async ({ page }) => {`);
  
  for (const step of state.steps) {
    const stepCode = window.StepHandlers.generatePlaywrightStepCode(step);
    if (stepCode) {
      lines.push(stepCode);
    }
  }
  
  lines.push('});');
  return lines.join('\n');
}
```

## Adding New Step Types

To add a new step type:

1. **Update `utils/stepHandlers.js`**:
   - Add case to `executePlaywrightStep()`
   - Add case to `generatePlaywrightStepCode()`
   - Add case to `generateSeleniumStepCode()`
   - Add case to `generateGherkinStepLine()`
   - Add case to `getStepLabel()`
   - Add icon to `getStepIcon()`

2. **Update `public/stepHandlers.js`**:
   - Add the same cases to the browser-compatible version

3. **Test**:
   - Test recording the new step type
   - Test code generation (Playwright, Selenium, Gherkin)
   - Test rerun execution

## Notes

- The frontend version is browser-compatible and doesn't include execution functions (only code generation)
- The backend version includes execution functions for Playwright
- Both versions share the same code generation logic for consistency
- Fallback logic exists in `app.js` for step types not yet in common handlers

