/**
 * Playwright Test Spec Generator
 * Generates Playwright test specification files from recorded actions
 */
import { nodeDbQuerySnippet } from './db-config.js';

/**
 * Generate Playwright test spec from steps
 * @param {Object} options - Generation options
 * @param {string} options.featureTitle - Test title
 * @param {string} options.baseUrl - Base URL for navigation
 * @param {Array} options.steps - Array of step actions
 * @returns {string} Generated Playwright test spec code
 */
export function generatePlaywrightSpec({ featureTitle, baseUrl, steps = [], dbEngine = 'auto' }) {
  const toLine = (s) => s.trimEnd() + '\n';
  let spec = `import { test, expect } from '@playwright/test';\n\n`;
  spec += `test('${featureTitle || 'Recorded Flow'}', async ({ page }) => {\n`;
  spec += `  await page.goto('${baseUrl || 'http://example.com'}');\n`;
  
  for (const step of steps) {
    switch(step.kind) {
      case 'navigate':
        spec += toLine(`  await page.goto('${step.url}');`);
        break;
      case 'click':
        spec += toLine(`  await page.click(${JSON.stringify(step.selector)});`);
        break;
      case 'type':
        spec += toLine(`  await page.fill(${JSON.stringify(step.selector)}, ${JSON.stringify(step.value || '')});`);
        break;
      case 'assertText':
        spec += toLine(`  await expect(page.locator(${JSON.stringify(step.selector)})).toContainText(${JSON.stringify(step.expectedValue || step.text)});`);
        break;
      case 'assertVisible':
        spec += toLine(`  await expect(page.locator(${JSON.stringify(step.selector)})).toBeVisible();`);
        break;
      case 'assertAttribute':
        const attrValue = step.expectedValue || '';
        if (step.assertionType === 'equals') {
          spec += toLine(`  await expect(page.locator(${JSON.stringify(step.selector)})).toHaveAttribute(${JSON.stringify(step.value)}, ${JSON.stringify(attrValue)});`);
        } else {
          spec += toLine(`  const attr = await page.locator(${JSON.stringify(step.selector)}).getAttribute(${JSON.stringify(step.value)});`);
          spec += toLine(`  expect(attr).${getAssertionMethod(step.assertionType)}(${JSON.stringify(attrValue)});`);
        }
        break;
      case 'assertCount':
        const count = parseInt(step.expectedValue) || 0;
        spec += toLine(`  await expect(page.locator(${JSON.stringify(step.selector)})).toHaveCount(${count});`);
        break;
      case 'assertValue':
        const val = step.expectedValue || '';
        if (step.assertionType === 'equals') {
          spec += toLine(`  await expect(page.locator(${JSON.stringify(step.selector)})).toHaveValue(${JSON.stringify(val)});`);
        } else {
          spec += toLine(`  const value = await page.locator(${JSON.stringify(step.selector)}).inputValue();`);
          spec += toLine(`  expect(value).${getAssertionMethod(step.assertionType)}(${JSON.stringify(val)});`);
        }
        break;
      case 'waitFor':
        spec += toLine(`  await page.waitForTimeout(${Number(step.ms)||500});`);
        break;
      case 'waitForSelector':
        spec += toLine(`  await page.waitForSelector(${JSON.stringify(step.selector)});`);
        break;
      case 'screenshot':
        spec += toLine(`  await page.screenshot({ path: '${step.filename || 'screenshot.png'}' });`);
        break;
      case 'apiCall':
        spec += toLine(`  const resp_${Math.random().toString(36).slice(2,7)} = await page.request.${(step.method || 'get').toLowerCase()}('${step.url}');`);
        if (step.assertResponse) {
          spec += toLine(`  expect(resp.status()).toBe(${step.expectedStatus || 200});`);
        }
        break;
      case 'select':
        spec += toLine(`  await page.selectOption(${JSON.stringify(step.selector)}, ${JSON.stringify(step.value || step.selectedText)});`);
        break;
      case 'check':
        spec += toLine(`  await page.check(${JSON.stringify(step.selector)});`);
        break;
      case 'uncheck':
        spec += toLine(`  await page.uncheck(${JSON.stringify(step.selector)});`);
        break;
      case 'selectRadio':
        spec += toLine(`  await page.check(${JSON.stringify(step.selector)});`);
        break;
      case 'doubleClick':
        spec += toLine(`  await page.dblclick(${JSON.stringify(step.selector)});`);
        break;
      case 'jsClick':
        // [ZAC-FIX] JS-executor click — bypasses overlay/interceptor issues.
        spec += toLine(`  await page.locator(${JSON.stringify(step.selector)}).evaluate(el => el.click());`);
        break;
      case 'dbQuery': {
        // [ZAC-FIX] DB assertion — engine configurable (project.dbConfig.engine);
        // connection from DB_URL/DB_FILE env at run time. Row-count assertion.
        const dbSql = step.query || step.value || 'SELECT 1';
        const dbRows = Number.isFinite(Number(step.expectedRows)) ? Number(step.expectedRows) : 1;
        spec += toLine(`  {`);
        spec += nodeDbQuerySnippet(dbEngine, { sqlExpr: JSON.stringify(dbSql), expectedExpr: String(dbRows), indent: '    ' }) + '\n';
        spec += toLine(`  }`);
        break;
      }
      default:
        spec += toLine(`  // TODO Unsupported step: ${JSON.stringify(step)}`);
    }
  }
  
  spec += `});\n`;
  return spec;
}

/**
 * Get assertion method name for Playwright
 * @param {string} type - Assertion type (equals, contains, startsWith, etc.)
 * @returns {string} Playwright assertion method name
 */
function getAssertionMethod(type) {
  const methods = {
    equals: 'toBe',
    contains: 'toContain',
    startsWith: 'toMatch',
    endsWith: 'toMatch',
    regex: 'toMatch'
  };
  return methods[type] || 'toBe';
}

/**
 * Generate Playwright configuration file
 * @param {Object} options - Configuration options
 * @param {string} options.baseUrl - Base URL for tests
 * @returns {string} Generated Playwright config code
 */
export function generatePlaywrightConfig({ baseUrl = 'http://localhost:3000' }) {
  return `import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: '${baseUrl}',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  reporter: [['list'], ['html', { outputFolder: 'reports/html' }], ['allure-playwright']]
});`;
}

export default {
  generatePlaywrightSpec,
  generatePlaywrightConfig
};
