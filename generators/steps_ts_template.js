/**
 * TypeScript Step Definitions Generator
 * Generates Cucumber step definitions in TypeScript from recorded actions
 */

/**
 * Generate TypeScript step definitions file
 * @param {Array} actions - Array of recorded actions to generate specific step definitions for
 * @returns {string} Generated step definitions code
 */
export function generateStepDefinitions(actions = []) {
  // Build dynamic step definitions based on recorded actions
  const stepDefinitions = new Set();
  const navigationSteps = new Set();
  const clickSteps = new Set();
  const typeSteps = new Set();
  const assertSteps = new Set();

  // Process actions to extract unique normalized descriptions and selectors
  actions.forEach(action => {
    if (action.kind === 'navigate' && action.normalizedPageName) {
      navigationSteps.add(action.normalizedPageName);
    } else if ((action.kind === 'click' || action.kind === 'doubleClick') && action.normalizedDescription) {
      clickSteps.add(action.normalizedDescription);
    } else if (action.kind === 'type' && action.normalizedDescription) {
      typeSteps.add(action.normalizedDescription);
    } else if (action.kind.startsWith('assert') && action.normalizedDescription) {
      assertSteps.add(action.normalizedDescription);
    }
  });

  let code = `import { Given, When, Then, And } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { PlaywrightWorld } from '../support/world';

// Navigation
Given('I navigate to {string}', async function(this: PlaywrightWorld, url: string) {
  await this.page.goto(url);
});

Given('I Am On {string}', async function(this: PlaywrightWorld, pageName: string) {
  const pageUrls: Record<string, string> = {
    'Landing Page': 'http://localhost:3000',
  };
  const url = pageUrls[pageName] || pageName;
  await this.page.goto(url);
});

// Handle both quoted and unquoted page names
And(/^I Navigate To (.+)$/, async function(this: PlaywrightWorld, pageName: string) {
  // Remove quotes if present
  pageName = pageName.replace(/^["']|["']$/g, '').trim();
  const pageUrls: Record<string, string> = {
    'Landing Page': 'http://localhost:3000',
  };
  const url = pageUrls[pageName] || pageName;
  await this.page.goto(url);
});

Given(/^I Am On (.+)$/, async function(this: PlaywrightWorld, pageName: string) {
  // Remove quotes if present
  pageName = pageName.replace(/^["']|["']$/g, '').trim();
  const pageUrls: Record<string, string> = {
    'Landing Page': 'http://localhost:3000',
  };
  const url = pageUrls[pageName] || pageName;
  await this.page.goto(url);
});

// Dynamic navigation steps based on recorded actions
`;

  // Add dynamic navigation steps
  navigationSteps.forEach(pageName => {
    const escapedPageName = pageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    code += `Given(/^I Am On ${escapedPageName}$/, async function(this: PlaywrightWorld) {
  const pageUrls: Record<string, string> = {
    '${pageName}': 'http://localhost:3000', // Update with actual URL mapping
  };
  const url = pageUrls['${pageName}'] || '${pageName}';
  await this.page.goto(url);
});

`;
  });

  code += `
// Clicks
When('I click {string}', async function(this: PlaywrightWorld, selector: string) {
  // Detect if click causes navigation (pagination, links, etc.)
  const urlBeforeClick = this.page.url();
  
  // Perform the click
  await this.page.click(selector);
  
  // Wait a bit for potential navigation to start
  await this.page.waitForTimeout(200);
  
  // Check if navigation occurred
  const urlAfterClick = this.page.url();
  if (urlBeforeClick !== urlAfterClick) {
    // Navigation occurred - wait for page to stabilize
    console.log('[Click] Navigation detected after clicking, waiting for page to load...');
    await this.page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    // Wait for dynamic content to load (pagination, AJAX, etc.)
    await this.page.waitForTimeout(1000);
    // Try to wait for network idle (but don't fail if it times out)
    try {
      await this.page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch (e) {
      // Network idle timeout is OK - some sites have continuous activity
      console.log('[Click] Network idle timeout (expected for some sites), continuing...');
    }
    console.log('[Click] Page loaded after navigation to: ' + this.page.url());
  } else {
    // No navigation - just wait a bit for any dynamic updates
    await this.page.waitForTimeout(500);
  }
});

And('I click {string}', async function(this: PlaywrightWorld, selector: string) {
  // Detect if click causes navigation (pagination, links, etc.)
  const urlBeforeClick = this.page.url();
  
  // Perform the click
  await this.page.click(selector);
  
  // Wait a bit for potential navigation to start
  await this.page.waitForTimeout(200);
  
  // Check if navigation occurred
  const urlAfterClick = this.page.url();
  if (urlBeforeClick !== urlAfterClick) {
    // Navigation occurred - wait for page to stabilize
    console.log('[Click] Navigation detected after clicking, waiting for page to load...');
    await this.page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    // Wait for dynamic content to load (pagination, AJAX, etc.)
    await this.page.waitForTimeout(1000);
    // Try to wait for network idle (but don't fail if it times out)
    try {
      await this.page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch (e) {
      // Network idle timeout is OK - some sites have continuous activity
      console.log('[Click] Network idle timeout (expected for some sites), continuing...');
    }
    console.log('[Click] Page loaded after navigation to: ' + this.page.url());
  } else {
    // No navigation - just wait a bit for any dynamic updates
    await this.page.waitForTimeout(500);
  }
});

// Dynamic click steps based on recorded actions
`;

  // Add dynamic click steps
  clickSteps.forEach(description => {
    const escapedDesc = description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    code += `When(/^I Click "${escapedDesc}"$/, async function(this: PlaywrightWorld) {
  // Detect if click causes navigation (pagination, links, etc.)
  const urlBeforeClick = this.page.url();
  
  try {
    await this.page.locator(\`text=\${"${description}"}\`).click();
  } catch (e) {
    await this.page.locator(\`[aria-label*="\${"${description}"}"], button:has-text("\${"${description}"}"), a:has-text("\${"${description}"}")\`).first().click();
  }
  
  // Wait a bit for potential navigation to start
  await this.page.waitForTimeout(200);
  
  // Check if navigation occurred
  const urlAfterClick = this.page.url();
  if (urlBeforeClick !== urlAfterClick) {
    // Navigation occurred - wait for page to stabilize
    console.log('[Click] Navigation detected after clicking, waiting for page to load...');
    await this.page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    // Wait for dynamic content to load (pagination, AJAX, etc.)
    await this.page.waitForTimeout(1000);
    // Try to wait for network idle (but don't fail if it times out)
    try {
      await this.page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch (e) {
      // Network idle timeout is OK - some sites have continuous activity
      console.log('[Click] Network idle timeout (expected for some sites), continuing...');
    }
    console.log('[Click] Page loaded after navigation to: ' + this.page.url());
  } else {
    // No navigation - just wait a bit for any dynamic updates
    await this.page.waitForTimeout(500);
  }
});

And(/^I Click "${escapedDesc}"$/, async function(this: PlaywrightWorld) {
  // Detect if click causes navigation (pagination, links, etc.)
  const urlBeforeClick = this.page.url();
  
  try {
    await this.page.locator(\`text=\${"${description}"}\`).click();
  } catch (e) {
    await this.page.locator(\`[aria-label*="\${"${description}"}"], button:has-text("\${"${description}"}"), a:has-text("\${"${description}"}")\`).first().click();
  }
  
  // Wait a bit for potential navigation to start
  await this.page.waitForTimeout(200);
  
  // Check if navigation occurred
  const urlAfterClick = this.page.url();
  if (urlBeforeClick !== urlAfterClick) {
    // Navigation occurred - wait for page to stabilize
    console.log('[Click] Navigation detected after clicking, waiting for page to load...');
    await this.page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    // Wait for dynamic content to load (pagination, AJAX, etc.)
    await this.page.waitForTimeout(1000);
    // Try to wait for network idle (but don't fail if it times out)
    try {
      await this.page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch (e) {
      // Network idle timeout is OK - some sites have continuous activity
      console.log('[Click] Network idle timeout (expected for some sites), continuing...');
    }
    console.log('[Click] Page loaded after navigation to: ' + this.page.url());
  } else {
    // No navigation - just wait a bit for any dynamic updates
    await this.page.waitForTimeout(500);
  }
});

// Double Click
And(/^I double click "${escapedDesc}"$/, async function(this: PlaywrightWorld) {
  try {
    await this.page.locator(\`text=\${"${description}"}\`).dblclick();
  } catch (e) {
    await this.page.locator(\`[aria-label*="\${"${description}"}"], button:has-text("\${"${description}"}"), a:has-text("\${"${description}"}")\`).first().dblclick();
  }
});

`;
  });

  code += `
// Typing
When('I type {string} into {string}', async function(this: PlaywrightWorld, value: string, selector: string) {
  await this.page.fill(selector, value);
});

And('I type {string} into {string}', async function(this: PlaywrightWorld, value: string, selector: string) {
  await this.page.fill(selector, value);
});

// Dynamic type steps based on recorded actions
`;

  // Add dynamic type steps
  typeSteps.forEach(description => {
    const escapedDesc = description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    code += `And(/^I Enter "(.+)" In "${escapedDesc}"$/, async function(this: PlaywrightWorld, value: string) {
  try {
    await this.page.locator(\`[placeholder*="\${"${description}"}"], [name*="\${"${description}"}"], [aria-label*="\${"${description}"}"], [id*="\${"${description}".toLowerCase().replace(/\\s/g, '')}"]\`).first().fill(value);
  } catch (e) {
    await this.page.locator("${description}").fill(value);
  }
});

`;
  });

  code += `
// Assertions - Text
Then('I should see {string} in {string}', async function(this: PlaywrightWorld, text: string, selector: string) {
  await expect(this.page.locator(selector)).toContainText(text);
});

// Assertions - Visible
Then('{string} should be visible', async function(this: PlaywrightWorld, selector: string) {
  await expect(this.page.locator(selector)).toBeVisible();
});

// Dynamic assertion steps based on recorded actions
`;

  // Add dynamic assertion steps
  assertSteps.forEach(description => {
    const escapedDesc = description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    code += `Then(/^I should see "(.+)" in "${escapedDesc}"$/, async function(this: PlaywrightWorld, text: string) {
  await expect(this.page.locator("${description}")).toContainText(text);
});

Then(/^"${escapedDesc}" should be visible$/, async function(this: PlaywrightWorld) {
  await expect(this.page.locator("${description}")).toBeVisible();
});

`;
  });

  code += `
// Assertions - Attribute
Then('{string} attribute {string} should equal {string}', async function(this: PlaywrightWorld, selector: string, attr: string, value: string) {
  await expect(this.page.locator(selector)).toHaveAttribute(attr, value);
});

Then('{string} attribute {string} should contain {string}', async function(this: PlaywrightWorld, selector: string, attr: string, value: string) {
  const attrValue = await this.page.locator(selector).getAttribute(attr);
  expect(attrValue).toContain(value);
});

// Assertions - Count
Then('{string} count should be {int}', async function(this: PlaywrightWorld, selector: string, count: number) {
  await expect(this.page.locator(selector)).toHaveCount(count);
});

// Assertions - Value
Then('{string} value should equal {string}', async function(this: PlaywrightWorld, selector: string, value: string) {
  await expect(this.page.locator(selector)).toHaveValue(value);
});

Then('{string} value should contain {string}', async function(this: PlaywrightWorld, selector: string, value: string) {
  const inputValue = await this.page.locator(selector).inputValue();
  expect(inputValue).toContain(value);
});

// Wait
And('I wait for {int} ms', async function(this: PlaywrightWorld, ms: number) {
  await this.page.waitForTimeout(ms);
});

When('I wait for {int} ms', async function(this: PlaywrightWorld, ms: number) {
  await this.page.waitForTimeout(ms);
});

And('I wait for selector {string}', async function(this: PlaywrightWorld, selector: string) {
  await this.page.waitForSelector(selector);
});

// Screenshot
And('I take screenshot {string}', async function(this: PlaywrightWorld, filename: string) {
  await this.page.screenshot({ path: filename });
});

// API Calls
When('I call API GET {string}', async function(this: PlaywrightWorld, url: string) {
  const resp = await this.page.request.get(url);
  this.lastResponse = resp;
});

When('I call API POST {string}', async function(this: PlaywrightWorld, url: string) {
  const resp = await this.page.request.post(url);
  this.lastResponse = resp;
});

And('I call API GET {string}', async function(this: PlaywrightWorld, url: string) {
  const resp = await this.page.request.get(url);
  this.lastResponse = resp;
});

And('I call API POST {string}', async function(this: PlaywrightWorld, url: string) {
  const resp = await this.page.request.post(url);
  this.lastResponse = resp;
});

// Select dropdown
When('I select {string} from {string}', async function(this: PlaywrightWorld, value: string, selector: string) {
  await this.page.selectOption(selector, value);
});

And('I select {string} from {string}', async function(this: PlaywrightWorld, value: string, selector: string) {
  await this.page.selectOption(selector, value);
});

And(/^I select "(.+)" from "(.+)"$/, async function(this: PlaywrightWorld, value: string, dropdownDescription: string) {
  try {
    const select = this.page.locator(\`[aria-label*="\${dropdownDescription}"], [name*="\${dropdownDescription}"], select:has-text("\${dropdownDescription}")\`).first();
    await select.selectOption(value);
  } catch (e) {
    await this.page.locator(dropdownDescription).selectOption(value);
  }
});

// Checkbox
And(/^I check "(.+)"$/, async function(this: PlaywrightWorld, checkboxDescription: string) {
  try {
    await this.page.locator(\`[aria-label*="\${checkboxDescription}"], [name*="\${checkboxDescription}"], label:has-text("\${checkboxDescription}") input[type="checkbox"]\`).first().check();
  } catch (e) {
    await this.page.locator(checkboxDescription).check();
  }
});

And(/^I uncheck "(.+)"$/, async function(this: PlaywrightWorld, checkboxDescription: string) {
  try {
    await this.page.locator(\`[aria-label*="\${checkboxDescription}"], [name*="\${checkboxDescription}"], label:has-text("\${checkboxDescription}") input[type="checkbox"]\`).first().uncheck();
  } catch (e) {
    await this.page.locator(checkboxDescription).uncheck();
  }
});

// Radio button
And(/^I select radio "(.+)" in "(.+)"$/, async function(this: PlaywrightWorld, value: string, radioGroupDescription: string) {
  try {
    await this.page.locator(\`input[type="radio"][value="\${value}"], input[type="radio"]:near(:text("\${value}"))\`).first().check();
  } catch (e) {
    await this.page.locator(\`input[type="radio"][value="\${value}"]\`).check();
  }
});

// Hover
And(/^I hover over "(.+)"$/, async function(this: PlaywrightWorld, elementDescription: string) {
  try {
    await this.page.locator(\`text=\${elementDescription}\`).hover();
  } catch (e) {
    await this.page.locator(\`[aria-label*="\${elementDescription}"], button:has-text("\${elementDescription}"), a:has-text("\${elementDescription}")\`).first().hover();
  }
});

// Drag and Drop
And(/^I drag "(.+)" to "(.+)"$/, async function(this: PlaywrightWorld, sourceDescription: string, targetDescription: string) {
  try {
    const source = this.page.locator(\`text=\${sourceDescription}, [aria-label*="\${sourceDescription}"]\`).first();
    const target = this.page.locator(\`text=\${targetDescription}, [aria-label*="\${targetDescription}"]\`).first();
    await source.dragTo(target);
  } catch (e) {
    const source = this.page.locator(sourceDescription);
    const target = this.page.locator(targetDescription);
    await source.dragTo(target);
  }
});

// File Upload
And(/^I upload "(.+)" to "(.+)"$/, async function(this: PlaywrightWorld, filename: string, fieldDescription: string) {
  try {
    const fileInput = this.page.locator(\`[aria-label*="\${fieldDescription}"], [name*="\${fieldDescription}"], input[type="file"]\`).first();
    await fileInput.setInputFiles(filename);
  } catch (e) {
    await this.page.locator(fieldDescription).setInputFiles(filename);
  }
});

// Key Press
And(/^I press key "(.+)"$/, async function(this: PlaywrightWorld, key: string) {
  await this.page.keyboard.press(key);
});

// Scroll
And(/^I scroll to position \\((\\d+), (\\d+)\\)$/, async function(this: PlaywrightWorld, x: number, y: number) {
  await this.page.evaluate((x, y) => window.scrollTo(x, y), x, y);
});

And(/^I scroll to "(.+)"$/, async function(this: PlaywrightWorld, elementDescription: string) {
  try {
    await this.page.locator(\`text=\${elementDescription}, [aria-label*="\${elementDescription}"]\`).first().scrollIntoViewIfNeeded();
  } catch (e) {
    await this.page.locator(elementDescription).scrollIntoViewIfNeeded();
  }
});

// Close Browser
And('I close the browser', async function(this: PlaywrightWorld) {
  // Check if a new tab/page is opening before closing
  // This prevents closing when the application opens in a new tab
  // But allows closing when navigation happens in the same tab (normal link click)
  if (this.page && this.context && !this.page.isClosed()) {
    // Get page count before waiting
    const pagesBefore = this.context.pages();
    const currentPageCount = pagesBefore.length;
    
    // Wait a short time to see if a new page is about to open
    // Some clicks trigger new tabs asynchronously
    await this.page.waitForTimeout(500);
    
    // Check page count after waiting
    const pagesAfter = this.context.pages();
    const newPageCount = pagesAfter.length;
    
    // ONLY skip closing if a new page/tab actually opened
    // If page count increased, it means a new tab was created
    // If page count stayed the same, it's normal navigation in the same tab - allow closing
    if (newPageCount > currentPageCount) {
      console.log('[Close] New tab detected (' + currentPageCount + ' -> ' + newPageCount + '), skipping close to preserve new tab');
      return; // Skip closing
    }
    
    // If we reach here, no new tab was created
    // This means either normal navigation happened in the same tab or no navigation
    // In both cases, it's safe to close the current page
    console.log('[Close] No new tab detected (page count: ' + currentPageCount + '), proceeding with close');
    await this.page.close();
  }
  
  // Close context and browser if no pages remain
  if (this.context && this.context.pages().length === 0) {
    await this.context.close();
  }
  if (this.browser) {
    await this.browser.close();
  }
});`;

  return code;
}

/**
 * Generate Playwright World file for Cucumber
 * @returns {string} Generated World class code
 */
export function generateWorldFile() {
  return `import { setWorldConstructor, World } from '@cucumber/cucumber';
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';

export class PlaywrightWorld extends World {
  browser!: Browser;
  context!: BrowserContext;
  page!: Page;

  async init() {
    this.browser = await chromium.launch({ headless: false });
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
  }

  async cleanup() {
    if (this.page) await this.page.close();
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
  }
}

setWorldConstructor(PlaywrightWorld);`;
}

/**
 * Generate package.json for generated project
 * @param {Object} options - Generation options
 * @param {string} options.projectName - Project name
 * @returns {string} Generated package.json content
 */
export function generatePackageJson({ projectName }) {
  return JSON.stringify({
    name: projectName,
    version: "1.0.0",
    private: true,
    type: "module",
    scripts: {
      test: "npx playwright test"
    },
    devDependencies: {
      "@playwright/test": "^1.47.2",
      "@cucumber/cucumber": "^10.0.0",
      "@cucumber/pretty-formatter": "^1.0.0",
      "ts-node": "^10.9.2",
      "typescript": "^5.3.3",
      "allure-playwright": "^3.0.0"
    }
  }, null, 2);
}

export default {
  generateStepDefinitions,
  generateWorldFile,
  generatePackageJson
};
