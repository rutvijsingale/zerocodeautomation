/**
 * generators/frameworks/java/helpers.js
 * Shared helper utilities for Java code generation (Playwright + Selenium).
 */

import { DEFAULT_PAGE_URLS } from './constants.js';

/**
 * Check if framework is Playwright Java
 */
export function isPlaywrightJava(framework) {
  return framework === 'playwright-java';
}

/**
 * Generate page URL mapping code (reduces duplication)
 */
export function generatePageUrlMappingCode(baseUrl, defaultUrl = null) {
  const urlLines = DEFAULT_PAGE_URLS.map(page =>
    `        pageUrls.put("${page.name}", "${baseUrl}${page.path}");`
  ).join('\n');
  const defaultUrlValue = defaultUrl || baseUrl;
  return `        java.util.Map<String, String> pageUrls = new java.util.HashMap<>();\n${urlLines}\n        String url = pageUrls.getOrDefault(pageName, "${defaultUrlValue}");`;
}

/**
 * Generate navigation action based on framework
 */
export function getNavigationAction(framework) {
  return isPlaywrightJava(framework) ? 'getPage().navigate(url);' : 'getDriver().get(url);';
}

/**
 * Escape Java string for use in generated code
 */
export function escapeJavaString(str) {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * Convert string to camelCase
 */
export function toCamelCase(str) {
  return str
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => {
      return index === 0 ? word.toLowerCase() : word.toUpperCase();
    })
    .replace(/\s+/g, '')
    .replace(/[^a-zA-Z0-9]/g, '');
}

/**
 * Capitalize first letter
 */
export function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
