/**
 * generators/frameworks/java/playwright-test.js
 * Generates a standalone JUnit5 Playwright Java test class (no Cucumber).
 */

import { escapeJavaString } from './helpers.js';

/**
 * Generate standalone Playwright Java test (runnable with mvn test)
 * @param {string} testName - Test class name
 * @param {string} baseUrl - Base URL for navigation
 * @param {Array} steps - Array of recorded actions
 * @param {string} browserType - Browser type (chromium, firefox, webkit)
 * @returns {string} Generated Playwright Java test code
 */
function generatePlaywrightTest(testName = 'PlaywrightTest', baseUrl = 'https://example.com', steps = [], browserType = 'chromium') {
  const className = testName.replace(/[^a-zA-Z0-9]/g, '') || 'PlaywrightTest';
  let varCounter = 0;
  
let code = `package tests;

import com.microsoft.playwright.*;
import org.junit.jupiter.api.*;

public class ${className} {
    private static Playwright playwright;
    private static Browser browser;
    private static BrowserContext context;
    private static Page page;

    @BeforeAll
    public static void setUp() {
        playwright = Playwright.create();
        BrowserType.LaunchOptions launchOptions = new BrowserType.LaunchOptions()
            .setHeadless(false);
        
        // Launch browser based on type
        switch ("${browserType}") {
            case "firefox":
                browser = playwright.firefox().launch(launchOptions);
                break;
            case "webkit":
                browser = playwright.webkit().launch(launchOptions);
                break;
            case "edge":
                launchOptions.setChannel("msedge");
                browser = playwright.chromium().launch(launchOptions);
                break;
            case "chromium":
            default:
                launchOptions.setChannel("chrome");
                browser = playwright.chromium().launch(launchOptions);
                break;
        }
        
        context = browser.newContext();
        page = context.newPage();
    }

    @AfterAll
    public static void tearDown() {
        if (context != null) context.close();
        if (browser != null) browser.close();
        if (playwright != null) playwright.close();
    }

    @Test
    public void recordedTest() {
`;

  // Generate test steps
  for (const step of steps) {
    switch (step.kind) {
      case 'navigate':
        const url = step.url || baseUrl;
        code += `        page.navigate("${escapeJavaString(url)}");\n`;
        break;
        
      case 'click':
      case 'doubleClick':
        const clickSelector = step.selector || step.normalizedSelector || '';
        if (clickSelector) {
          code += `        page.locator("${escapeJavaString(clickSelector)}").click();\n`;
        }
        break;
        
      case 'type':
        const typeSelector = step.selector || step.normalizedSelector || '';
        const value = escapeJavaString(step.value || '');
        if (typeSelector && value) {
          code += `        page.locator("${escapeJavaString(typeSelector)}").fill("${value}");\n`;
        }
        break;
        
      case 'assertText':
        const assertTextSelector = step.selector || step.normalizedSelector || '';
        const expectedText = step.expectedValue || step.text || '';
        if (assertTextSelector && expectedText) {
          // Handle multi-line strings by storing textContent in a variable first
          const varName = `textContent${varCounter++}`;
          const safeExpectedText = escapeJavaString(expectedText);
          code += `        String ${varName} = page.locator("${escapeJavaString(assertTextSelector)}").textContent();\n`;
          code += `        org.junit.jupiter.api.Assertions.assertTrue(${varName} != null && ${varName}.contains("${safeExpectedText}"));\n`;
        }
        break;
        
      case 'assertVisible':
        const assertVisibleSelector = step.selector || step.normalizedSelector || '';
        if (assertVisibleSelector) {
          code += `        org.junit.jupiter.api.Assertions.assertTrue(page.locator("${escapeJavaString(assertVisibleSelector)}").isVisible());\n`;
        }
        break;
        
      case 'assertAttribute':
        const assertAttrSelector = step.selector || step.normalizedSelector || '';
        const attrName = step.value || '';
        const attrValue = escapeJavaString(step.expectedValue || '');
        if (assertAttrSelector && attrName && attrValue) {
          code += `        org.junit.jupiter.api.Assertions.assertEquals("${attrValue}", page.locator("${escapeJavaString(assertAttrSelector)}").getAttribute("${attrName}"));\n`;
        }
        break;
        
      case 'assertCount':
        const assertCountSelector = step.selector || step.normalizedSelector || '';
        const count = parseInt(step.expectedValue) || 0;
        if (assertCountSelector) {
          code += `        org.junit.jupiter.api.Assertions.assertEquals(${count}, page.locator("${escapeJavaString(assertCountSelector)}").count());\n`;
        }
        break;
        
      case 'assertValue':
        const assertValueSelector = step.selector || step.normalizedSelector || '';
        const expectedValue = escapeJavaString(step.expectedValue || '');
        if (assertValueSelector && expectedValue) {
          code += `        org.junit.jupiter.api.Assertions.assertEquals("${expectedValue}", page.locator("${escapeJavaString(assertValueSelector)}").inputValue());\n`;
        }
        break;
        
      case 'waitFor':
        const waitMs = Number(step.ms) || 500;
        code += `        page.waitForTimeout(${waitMs});\n`;
        break;
        
      case 'waitForSelector':
        const waitSelector = step.selector || step.normalizedSelector || '';
        if (waitSelector) {
          code += `        page.waitForSelector("${escapeJavaString(waitSelector)}");\n`;
        }
        break;
        
      case 'screenshot':
        const filename = step.filename || 'screenshot.png';
        code += `        page.screenshot(new Page.ScreenshotOptions().setPath("${escapeJavaString(filename)}"));\n`;
        break;
    }
  }

  code += `    }
}
`;

  return code;
}

export { generatePlaywrightTest };
