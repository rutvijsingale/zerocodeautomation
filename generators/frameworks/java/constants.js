/**
 * generators/frameworks/java/constants.js
 * Shared constants for Java code generation (Playwright + Selenium).
 */

export const VERSIONS = {
  PLAYWRIGHT: '1.47.0',
  CUCUMBER: '7.14.0',
  JUNIT: '5.10.0',
  ALLURE: '2.24.0',
  SUREFIRE: '3.2.2',
  SELENIUM: '4.15.0',
  WEBDRIVER_MANAGER: '5.6.2'
};

export const DEFAULT_PAGE_URLS = [
  { name: 'Landing Page', path: '' },
  { name: 'PreEligibility Page', path: '/prescreener/' },
  { name: 'Financial Flow Page', path: '/financial' },
  { name: 'Application Page', path: '/application' }
];
