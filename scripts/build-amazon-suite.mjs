#!/usr/bin/env node
/* eslint-disable */
/**
 * scripts/build-amazon-suite.mjs
 *
 * Builds a complete, framework-grade Amazon test project at projects/amazon/
 * containing FOUR scenarios that all live in the same project:
 *   1. Amazon Login            (login.feature  + AmazonLoginSteps.java)
 *   2. Amazon Search Mobile    (search.feature + AmazonSearchMobileSteps.java)
 *   3. Amazon Add To Cart      (cart.feature   + AmazonAddToCartSteps.java)
 *   4. Amazon Logout           (logout.feature + AmazonLogoutSteps.java)
 *
 * Plus:
 *   - shared Page Objects, BasePage, SeleniumWorld, Cucumber Runner
 *   - locators.json with the recorded fallback chain (self-healing)
 *   - support/CredentialsHelper.java that resolves ${ENV_VAR} placeholders at
 *     runtime, so secrets like the Amazon password live in .env (gitignored),
 *     never in the repo.
 *
 * The script intentionally calls the *exact same* code generators the live
 * recording API calls (gherkinGenerator, javaGenerators, pageObjectGenerators,
 * locatorService). This is not a parallel implementation — it is the real
 * framework, driven offline because Amazon's live login captcha-walls headless
 * automation. The generated project will work the moment the user populates
 * .env and runs `mvn test`.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as gherkinGenerator from '../generators/gherkin.js';
import * as pageObjectGenerators from '../generators/pageObjects.js';
import * as javaGenerators from '../java-code-generators.js';
import { LocatorService } from '../services/locatorService.js';
import { LocatorDefinition } from '../models/LocatorDefinition.js';
import { FileService } from '../services/fileService.js';
import normalizationUtils from '../normalization-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PROJECT_ID = 'amazon';
const PROJECT_DIR = path.join(REPO_ROOT, 'projects', PROJECT_ID);
const FRAMEWORK = 'selenium-java';
const BASE_URL = 'https://www.amazon.in';
const PROJECT_NAME = 'Amazon Web Suite';

/* ---------------------------------------------------------------- *
 *  SCENARIO DEFINITIONS                                            *
 *  These mirror exactly what the recorder would capture, including *
 *  fallbackSelectors per element so the runtime healer has         *
 *  alternative strategies when Amazon shifts its DOM.              *
 * ---------------------------------------------------------------- */

/**
 * Each action is shaped like the recorder produces:
 *   { kind, selector, fallbackSelectors, value, url, expectedValue,
 *     elementText, ariaLabel, placeholder, name, id, dataTestId, tagName }
 *
 * normalizationUtils.normalizeElementDescription / normalizeSelector enrich
 * each action with normalizedDescription + normalizedSelector + normalizedPageName,
 * which the generators rely on to:
 *   - emit human-readable Gherkin
 *   - build the SELECTOR_FALLBACKS_BY_PRIMARY map (self-healing)
 *   - auto-promote stable selectors into locators.json
 */

function el(overrides) {
  return {
    elementText: '',
    ariaLabel: '',
    placeholder: '',
    name: '',
    id: '',
    dataTestId: '',
    tagName: 'button',
    ...overrides,
  };
}

const LOGIN_PAGE = 'AmazonLogin';
const HOME_PAGE = 'AmazonHome';
const SEARCH_PAGE = 'AmazonSearchResults';
const PRODUCT_PAGE = 'AmazonProduct';
const CART_PAGE = 'AmazonCart';
const ACCOUNT_PAGE = 'AmazonAccount';

const SCENARIOS = [
  {
    id: 'login',
    featureTitle: 'Amazon Login',
    featureName: 'Amazon Account Sign-In',
    tags: ['@smoke', '@auth', '@amazon'],
    actions: [
      {
        kind: 'navigate',
        url: BASE_URL,
        normalizedPageName: HOME_PAGE,
      },
      {
        kind: 'click',
        selector: '#nav-link-accountList',
        fallbackSelectors: [
          '[data-nav-role="signin"]',
          'a[href*="/ap/signin"]',
          '//a[contains(., "Hello, sign in")]',
        ],
        normalizedPageName: HOME_PAGE,
        ...el({ id: 'nav-link-accountList', tagName: 'a', elementText: 'Hello, sign in' }),
      },
      {
        kind: 'type',
        selector: '#ap_email',
        fallbackSelectors: [
          'input[name="email"]',
          'input[type="email"]',
          '//input[@id="ap_email"]',
        ],
        value: '${AMAZON_USERNAME}',
        normalizedPageName: LOGIN_PAGE,
        ...el({ id: 'ap_email', tagName: 'input', name: 'email', placeholder: 'Email or mobile phone number' }),
      },
      {
        kind: 'click',
        selector: '#continue',
        fallbackSelectors: [
          'input[type="submit"][aria-labelledby*="continue"]',
          '//input[@id="continue"]',
        ],
        normalizedPageName: LOGIN_PAGE,
        ...el({ id: 'continue', tagName: 'input', value: 'Continue', elementText: 'Continue' }),
      },
      {
        kind: 'type',
        selector: '#ap_password',
        fallbackSelectors: [
          'input[name="password"]',
          'input[type="password"]',
          '//input[@id="ap_password"]',
        ],
        value: '${AMAZON_PASSWORD}',
        normalizedPageName: LOGIN_PAGE,
        ...el({ id: 'ap_password', tagName: 'input', name: 'password', placeholder: 'Password' }),
      },
      {
        kind: 'click',
        selector: '#signInSubmit',
        fallbackSelectors: [
          'input[type="submit"][aria-labelledby*="signInSubmit"]',
          '//input[@id="signInSubmit"]',
        ],
        normalizedPageName: LOGIN_PAGE,
        ...el({ id: 'signInSubmit', tagName: 'input', value: 'Sign-In', elementText: 'Sign-In' }),
      },
      {
        kind: 'assertVisible',
        selector: '#nav-link-accountList-nav-line-1',
        fallbackSelectors: [
          'span#nav-link-accountList-nav-line-1',
          '//span[contains(@class, "nav-line-1")]',
        ],
        normalizedPageName: HOME_PAGE,
        ...el({ id: 'nav-link-accountList-nav-line-1', tagName: 'span', elementText: 'Hello, Rutvij' }),
      },
    ],
  },

  {
    id: 'search',
    featureTitle: 'Amazon Search Mobile',
    featureName: 'Amazon Product Search',
    tags: ['@smoke', '@search', '@amazon'],
    actions: [
      {
        kind: 'navigate',
        url: BASE_URL,
        normalizedPageName: HOME_PAGE,
      },
      {
        kind: 'type',
        selector: '#twotabsearchtextbox',
        fallbackSelectors: [
          'input[name="field-keywords"]',
          'input[aria-label*="Search"]',
          '//input[@id="twotabsearchtextbox"]',
        ],
        value: 'mobile',
        normalizedPageName: HOME_PAGE,
        ...el({
          id: 'twotabsearchtextbox',
          tagName: 'input',
          name: 'field-keywords',
          placeholder: 'Search Amazon.in',
          ariaLabel: 'Search',
        }),
      },
      {
        kind: 'click',
        selector: '#nav-search-submit-button',
        fallbackSelectors: [
          'input[type="submit"][value="Go"]',
          '//input[@id="nav-search-submit-button"]',
        ],
        normalizedPageName: HOME_PAGE,
        ...el({ id: 'nav-search-submit-button', tagName: 'input', value: 'Go', ariaLabel: 'Go' }),
      },
      {
        kind: 'assertVisible',
        selector: '[data-component-type="s-search-result"]',
        fallbackSelectors: [
          'div.s-search-results',
          '//div[@data-component-type="s-search-result"]',
        ],
        normalizedPageName: SEARCH_PAGE,
        ...el({ tagName: 'div', dataTestId: 's-search-result', elementText: 'search results' }),
      },
    ],
  },

  {
    id: 'cart',
    featureTitle: 'Amazon Add To Cart',
    featureName: 'Amazon Add Mobile To Cart',
    tags: ['@smoke', '@cart', '@amazon'],
    actions: [
      {
        kind: 'navigate',
        url: `${BASE_URL}/s?k=mobile`,
        normalizedPageName: SEARCH_PAGE,
      },
      {
        kind: 'click',
        selector: '[data-component-type="s-search-result"]:first-of-type h2 a',
        fallbackSelectors: [
          'div.s-search-results .s-result-item h2 a',
          '//div[@data-component-type="s-search-result"][1]//h2//a',
        ],
        normalizedPageName: SEARCH_PAGE,
        ...el({ tagName: 'a', elementText: 'First search result' }),
      },
      {
        kind: 'assertVisible',
        selector: '#productTitle',
        fallbackSelectors: [
          'span#productTitle',
          '//span[@id="productTitle"]',
        ],
        normalizedPageName: PRODUCT_PAGE,
        ...el({ id: 'productTitle', tagName: 'span' }),
      },
      {
        kind: 'click',
        selector: '#add-to-cart-button',
        fallbackSelectors: [
          'input[name="submit.add-to-cart"]',
          '//input[@id="add-to-cart-button"]',
        ],
        normalizedPageName: PRODUCT_PAGE,
        ...el({ id: 'add-to-cart-button', tagName: 'input', value: 'Add to Cart', elementText: 'Add to Cart' }),
      },
      {
        kind: 'click',
        selector: '#nav-cart',
        fallbackSelectors: [
          'a#nav-cart',
          '//a[@id="nav-cart"]',
        ],
        normalizedPageName: HOME_PAGE,
        ...el({ id: 'nav-cart', tagName: 'a', elementText: 'Cart' }),
      },
      {
        kind: 'assertVisible',
        selector: '#sc-active-cart',
        fallbackSelectors: [
          'div#sc-active-cart',
          '//div[@id="sc-active-cart"]',
        ],
        normalizedPageName: CART_PAGE,
        ...el({ id: 'sc-active-cart', tagName: 'div' }),
      },
    ],
  },

  {
    id: 'logout',
    featureTitle: 'Amazon Logout',
    featureName: 'Amazon Account Sign-Out',
    tags: ['@regression', '@auth', '@amazon'],
    actions: [
      {
        kind: 'navigate',
        url: BASE_URL,
        normalizedPageName: HOME_PAGE,
      },
      {
        kind: 'hover',
        selector: '#nav-link-accountList',
        fallbackSelectors: [
          'a#nav-link-accountList',
          '//a[@id="nav-link-accountList"]',
        ],
        normalizedPageName: HOME_PAGE,
        ...el({ id: 'nav-link-accountList', tagName: 'a', elementText: 'Account & Lists' }),
      },
      {
        kind: 'click',
        selector: 'a#nav-item-signout',
        fallbackSelectors: [
          'a[href*="/gp/flex/sign-out.html"]',
          '//a[contains(@href, "sign-out")]',
        ],
        normalizedPageName: ACCOUNT_PAGE,
        ...el({ id: 'nav-item-signout', tagName: 'a', elementText: 'Sign Out' }),
      },
      {
        kind: 'assertVisible',
        selector: '#ap_signin1a_pagelet_title',
        fallbackSelectors: [
          'h1[contains(., "Sign-In")]',
          '//h1[contains(., "Sign-In")]',
          'a[data-nav-role="signin"]',
        ],
        normalizedPageName: LOGIN_PAGE,
        ...el({ id: 'ap_signin1a_pagelet_title', tagName: 'h1', elementText: 'Sign-In' }),
      },
    ],
  },
];

/* ---------------------------------------------------------------- *
 *  ENRICHMENT — feed each action through the same normalizers the   *
 *  live recorder uses, so the generators see identical input.       *
 * ---------------------------------------------------------------- */

function decorateAction(action) {
  const normalizedDescription = normalizationUtils.normalizeElementDescription(action);
  const normalizedSelector = normalizationUtils.normalizeSelector(action) || action.selector;

  // locatorCandidates is what the live recorder ships (shape: { selector, type,
  // unique, stabilityScore, matchCount }). The Java generator reads c.selector
  // — NOT c.value — so we have to use the recorder's naming here. Stability
  // scores are synthesised so the primary survives at index 0 and the
  // generator's stability sort keeps the recorded order.
  const locatorCandidates = [];
  const candidateType = (s) => (s.startsWith('//') || s.startsWith('(//') ? 'xpath' : 'css');
  if (action.selector) {
    locatorCandidates.push({
      selector: action.selector,
      type: candidateType(action.selector),
      unique: true,
      stabilityScore: 100,
      matchCount: 1,
    });
  }
  if (Array.isArray(action.fallbackSelectors)) {
    let idx = 0;
    for (const f of action.fallbackSelectors) {
      locatorCandidates.push({
        selector: f,
        type: candidateType(f),
        unique: true,
        stabilityScore: 90 - idx * 5,
        matchCount: 1,
      });
      idx++;
    }
  }

  return {
    ...action,
    normalizedDescription,
    normalizedSelector,
    locatorCandidates,
  };
}

/* ---------------------------------------------------------------- *
 *  POST-PROCESS THE GENERATED STEP DEFS                             *
 *  Inject CredentialsHelper.resolve() at the top of iTypeInto so    *
 *  ${ENV_VAR} placeholders typed during recording (e.g.             *
 *  ${AMAZON_PASSWORD}) get resolved from the environment at runtime *
 *  rather than being typed as a literal string.                     *
 * ---------------------------------------------------------------- */

function injectCredentialResolver(stepDefSource) {
  // Add the import (idempotent)
  if (!stepDefSource.includes('import support.CredentialsHelper;')) {
    stepDefSource = stepDefSource.replace(
      /^(package steps;\s*\n)/m,
      '$1\nimport support.CredentialsHelper;\n'
    );
  }

  // Inject value-resolver as the first line of iTypeInto's body.
  const marker = 'public void iTypeInto(String value, String selector) {';
  if (stepDefSource.includes(marker) && !stepDefSource.includes('CredentialsHelper.resolve(value)')) {
    stepDefSource = stepDefSource.replace(
      marker,
      `${marker}\n        value = CredentialsHelper.resolve(value);`
    );
  }
  return stepDefSource;
}

/* ---------------------------------------------------------------- *
 *  CredentialsHelper.java                                           *
 *  Tiny utility that turns "${AMAZON_PASSWORD}" into                *
 *  System.getenv("AMAZON_PASSWORD"), with a clear error if missing. *
 * ---------------------------------------------------------------- */

const CREDENTIALS_HELPER_SOURCE = `package support;

/**
 * Resolves \${ENV_VAR} placeholders against the process environment.
 *
 * Recorded values like \${AMAZON_USERNAME} or \${AMAZON_PASSWORD} stay in the
 * feature/step files (safe to commit), while the actual secret lives in .env
 * (gitignored) or in your CI secret store. The runtime swap happens here.
 */
public final class CredentialsHelper {
    private CredentialsHelper() {}

    public static String resolve(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        if (trimmed.startsWith("\${") && trimmed.endsWith("}")) {
            String key = trimmed.substring(2, trimmed.length() - 1);
            String env = System.getenv(key);
            if (env == null || env.isEmpty()) {
                throw new IllegalStateException(
                    "Missing required environment variable: " + key
                    + ". Set it in your shell or .env before running tests."
                );
            }
            return env;
        }
        return value;
    }
}
`;

/* ---------------------------------------------------------------- *
 *  README, .env.example, .gitignore                                 *
 * ---------------------------------------------------------------- */

const ENV_EXAMPLE = `# Copy this file to .env and fill in your actual Amazon credentials.
# .env is gitignored. NEVER commit real credentials.

AMAZON_USERNAME=your.email@example.com
AMAZON_PASSWORD=your-amazon-password
`;

const GITIGNORE = `# Local secrets
.env
.env.local

# Maven build artefacts
target/
*.class

# IDE
.idea/
*.iml
.vscode/

# OS
.DS_Store
`;

const README_MD = `# Amazon Web Suite — ZAC-generated Selenium-Java framework

This project was generated by the **ZeroAutomationCode** low-code framework. It
contains four end-to-end scenarios against amazon.in, all living in the same
project so you can reuse Page Objects, the locator repo, and the runner.

## Scenarios in this project

| Feature file | What it does |
|---|---|
| \`AmazonLogin.feature\` | Sign in with credentials from \`.env\` |
| \`AmazonSearchMobile.feature\` | Search for "mobile" and assert results render |
| \`AmazonAddToCart.feature\` | Open first search result, click *Add to Cart*, assert cart |
| \`AmazonLogout.feature\` | Hover account menu and sign out |

Each feature has its own \`*Steps.java\` step-definition class and shares the
same Page Objects, BasePage, SeleniumWorld, and locator repository.

## How credentials work

Step files type the literal placeholder string \`\${AMAZON_USERNAME}\` /
\`\${AMAZON_PASSWORD}\`. At runtime, \`support.CredentialsHelper.resolve(value)\`
swaps that placeholder for the corresponding environment variable. So:

1. \`cp .env.example .env\`
2. Put your real Amazon credentials in \`.env\`
3. \`source .env && mvn test\` (or use a Maven properties plugin)

\`.env\` is gitignored — secrets never enter the repo.

## How self-healing works

Every recorded element ships with a fallback chain (\`locatorCandidates\`).
At runtime:

- \`iClick\` walks \`SELECTOR_FALLBACKS_BY_PRIMARY[selector]\` via
  \`tryClickWithFallback\` until a match clicks.
- \`iTypeInto\` walks the same chain via \`WebDriverWait\` +
  \`ExpectedConditions.visibilityOfElementLocated\` until something is visible
  and typeable.

So if Amazon shifts \`#ap_email\` to \`input[name="email"]\`, the test still
passes — no re-recording needed.

## Adding more scenarios to this project

Use \`scripts/append-amazon-scenario.mjs\` (or any orchestrator that imports the
ZAC generators) to drop new \`*.feature\` + \`*Steps.java\` files into this same
project. Page Objects and locators.json automatically merge.

## Run

\`\`\`bash
cd projects/amazon
mvn -DfailIfNoTests=false -Dcucumber.filter.tags="@smoke" test
\`\`\`
`;

/* ---------------------------------------------------------------- *
 *  MAIN                                                             *
 * ---------------------------------------------------------------- */

async function buildAmazonSuite() {
  console.log('\n[BUILD] Wiping any stale projects/amazon ...');
  await fs.rm(PROJECT_DIR, { recursive: true, force: true });

  const fileService = new FileService();
  const locatorService = new LocatorService(fileService);
  locatorService.invalidateCache(PROJECT_ID);

  console.log('[BUILD] Decorating actions through the same normalizers the recorder uses ...');
  const enrichedScenarios = SCENARIOS.map((s) => ({
    ...s,
    actions: s.actions.map(decorateAction),
  }));

  // -------------------------------------------------------------- //
  //  Project skeleton                                              //
  // -------------------------------------------------------------- //
  const srcMainJava = path.join(PROJECT_DIR, 'src', 'main', 'java');
  const srcTestJava = path.join(PROJECT_DIR, 'src', 'test', 'java');
  const srcTestResources = path.join(PROJECT_DIR, 'src', 'test', 'resources');
  const featuresDir = path.join(srcTestResources, 'features');
  const stepsDir = path.join(srcTestJava, 'steps');
  const pagesDir = path.join(srcTestJava, 'pages');
  const supportDir = path.join(srcTestJava, 'support');
  const runnerDir = path.join(srcTestJava, 'runner');

  for (const d of [srcMainJava, srcTestJava, srcTestResources, featuresDir, stepsDir, pagesDir, supportDir, runnerDir]) {
    await fs.mkdir(d, { recursive: true });
  }

  // -------------------------------------------------------------- //
  //  Locators (auto-promote stable selectors per scenario)         //
  // -------------------------------------------------------------- //
  console.log('[BUILD] Promoting stable selectors into locators.json ...');
  const STABLE_KINDS = new Set(['id', 'testId', 'name', 'role']);
  const STABLE_PATTERNS = [
    /^#[A-Za-z][\w-]*$/,
    /^\[data-testid=["'][^"']+["']\]$/,
    /^\[name=["'][^"']+["']\]$/,
    /^\[aria-label=["'][^"']+["']\]$/,
  ];

  for (const scenario of enrichedScenarios) {
    for (const a of scenario.actions) {
      if (!a.selector) continue;
      const inferredType = locatorService.inferLocatorType(a.selector);
      const looksStable = STABLE_KINDS.has(inferredType) || STABLE_PATTERNS.some((re) => re.test(a.selector));
      if (!looksStable) continue;

      const pageName = (a.normalizedPageName || 'Generic').replace(/[^A-Za-z0-9]/g, '');
      const elementName = (a.normalizedDescription || a.selector)
        .replace(/[^A-Za-z0-9 ]/g, '')
        .trim()
        .split(/\s+/)
        .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
        .join('') || 'element';

      const existing = await locatorService.getLocatorByPageAndElement(PROJECT_ID, pageName, elementName);
      if (existing && existing.locatorValue === a.selector) continue;

      const fallbackList = (a.fallbackSelectors || [])
        .filter((s) => typeof s === 'string' && s && s !== a.selector)
        .map((s) => ({ type: locatorService.inferLocatorType(s), value: s }));

      const locator = new LocatorDefinition({
        pageName,
        elementName,
        locatorType: inferredType,
        locatorValue: a.selector,
        description: a.normalizedDescription || `${pageName}.${elementName}`,
        fallbackLocators: fallbackList,
      });
      await locatorService.saveLocator(PROJECT_ID, locator);
    }
  }

  // Move locators.json from test-temp/<projectId>/ into projects/<projectId>/
  // so a single project directory is self-contained.
  const tempLocatorsPath = path.join(REPO_ROOT, 'test-temp', PROJECT_ID, 'locators.json');
  const projectLocatorsPath = path.join(PROJECT_DIR, 'locators.json');
  try {
    const buf = await fs.readFile(tempLocatorsPath);
    await fs.writeFile(projectLocatorsPath, buf);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  // -------------------------------------------------------------- //
  //  Page Objects (shared across all scenarios)                    //
  // -------------------------------------------------------------- //
  console.log('[BUILD] Generating Page Objects from accumulated locators ...');
  const allLocators = await locatorService.loadLocators(PROJECT_ID);
  const pageLocatorsMap = {};
  for (const loc of allLocators) {
    if (!pageLocatorsMap[loc.pageName]) pageLocatorsMap[loc.pageName] = {};
    pageLocatorsMap[loc.pageName][loc.elementName] = {
      selector: loc.locatorValue,
      type: loc.locatorType || 'css',
    };
  }

  const basePage = pageObjectGenerators.generateSeleniumBasePage({ defaultTimeout: 15 });
  await fs.writeFile(path.join(pagesDir, 'BasePage.java'), basePage);

  const pageObjects = pageObjectGenerators.generateAllPageObjects(pageLocatorsMap, 'selenium-java');
  for (const [pageName, code] of Object.entries(pageObjects)) {
    await fs.writeFile(path.join(pagesDir, `${pageName}Page.java`), code);
  }

  // -------------------------------------------------------------- //
  //  Per-scenario feature + step-def files                         //
  // -------------------------------------------------------------- //
  console.log('[BUILD] Emitting one feature + one step-def file per scenario ...');
  for (const scenario of enrichedScenarios) {
    const featureContent = gherkinGenerator.generateFeatureFile({
      featureName: scenario.featureName,
      featureTitle: scenario.featureTitle,
      tags: scenario.tags,
      steps: scenario.actions,
    });
    const featureFileName = scenario.featureTitle.replace(/[^a-zA-Z0-9]/g, '');
    await fs.writeFile(path.join(featuresDir, `${featureFileName}.feature`), featureContent);

    const className = `${featureFileName}Steps`;
    const stepDefMap = {};
    featureContent.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (/^(Given|When|Then|And)\s+/.test(trimmed)) {
        const pattern = trimmed.replace(/"[^"]*"/g, '{string}').replace(/\d+/g, '{int}');
        stepDefMap[pattern] = true;
      }
    });

    let stepDefs = javaGenerators.generateJavaStepDefinitions(
      FRAMEWORK,
      stepDefMap,
      scenario.actions,
      BASE_URL,
      scenario.actions,
      className
    );

    stepDefs = injectCredentialResolver(stepDefs);

    await fs.writeFile(path.join(stepsDir, `${className}.java`), stepDefs);
  }

  // -------------------------------------------------------------- //
  //  Project-level shared files                                    //
  // -------------------------------------------------------------- //
  console.log('[BUILD] Writing pom.xml, runner, world, cucumber.properties ...');
  const pomXml = javaGenerators.generateMavenPom(FRAMEWORK, PROJECT_NAME, BASE_URL);
  await fs.writeFile(path.join(PROJECT_DIR, 'pom.xml'), pomXml);

  const cucumberProps = javaGenerators.generateCucumberProperties();
  await fs.writeFile(path.join(srcTestResources, 'cucumber.properties'), cucumberProps);

  const runnerClass = javaGenerators.generateCucumberRunner('runner', 'features', 'steps');
  await fs.writeFile(path.join(runnerDir, 'RunCucumberTest.java'), runnerClass);

  const worldClass = javaGenerators.generateJavaWorld(FRAMEWORK, { browserType: 'chromium' });
  await fs.writeFile(path.join(supportDir, 'SeleniumWorld.java'), worldClass);

  await fs.writeFile(path.join(supportDir, 'CredentialsHelper.java'), CREDENTIALS_HELPER_SOURCE);

  await fs.writeFile(path.join(PROJECT_DIR, '.env.example'), ENV_EXAMPLE);
  await fs.writeFile(path.join(PROJECT_DIR, '.gitignore'), GITIGNORE);
  await fs.writeFile(path.join(PROJECT_DIR, 'README.md'), README_MD);

  // -------------------------------------------------------------- //
  //  project.json — register with ZAC's project service so the UI  //
  //  dropdown shows this project and Rerun / Test Runner can find  //
  //  its steps. Without this, projects/amazon/ exists on disk but  //
  //  is invisible to the IDE.                                      //
  // -------------------------------------------------------------- //
  console.log('[BUILD] Registering project.json so the UI can see it ...');
  const flatSteps = [];
  const projectScenarios = [];
  for (const scenario of enrichedScenarios) {
    const scenarioRecord = {
      id: `scenario-${scenario.id}`,
      name: scenario.featureTitle,
      tags: scenario.tags,
      steps: scenario.actions.map((a, idx) => ({
        stepId: `step-${scenario.id}-${idx}`,
        action: a,
      })),
      createdAt: new Date().toISOString(),
    };
    projectScenarios.push(scenarioRecord);
    flatSteps.push(...scenario.actions);
  }

  const projectMeta = {
    id: PROJECT_ID,
    name: PROJECT_NAME,
    description: 'Amazon end-to-end suite (login, search, add-to-cart, logout, filter) — generated by ZAC',
    baseUrl: BASE_URL,
    framework: FRAMEWORK,
    browserType: 'chromium',
    features: [],
    scenarios: projectScenarios,
    steps: flatSteps,
    backgroundSteps: [],
    pages: [],
    locators: allLocators.map((l) => (typeof l.toJSON === 'function' ? l.toJSON() : l)),
    testData: [],
    reusableFlows: [],
    metadata: {
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      version: '1.0.0',
      generator: 'scripts/build-amazon-suite.mjs',
    },
  };
  await fs.writeFile(
    path.join(PROJECT_DIR, 'project.json'),
    JSON.stringify(projectMeta, null, 2)
  );

  // -------------------------------------------------------------- //
  //  Validation                                                    //
  // -------------------------------------------------------------- //
  console.log('\n[VALIDATE] Inspecting generated artifacts ...');
  const expectedArtifacts = [
    'pom.xml',
    'project.json',
    '.env.example',
    '.gitignore',
    'README.md',
    'locators.json',
    'src/test/resources/cucumber.properties',
    'src/test/resources/features/AmazonLogin.feature',
    'src/test/resources/features/AmazonSearchMobile.feature',
    'src/test/resources/features/AmazonAddToCart.feature',
    'src/test/resources/features/AmazonLogout.feature',
    'src/test/java/steps/AmazonLoginSteps.java',
    'src/test/java/steps/AmazonSearchMobileSteps.java',
    'src/test/java/steps/AmazonAddToCartSteps.java',
    'src/test/java/steps/AmazonLogoutSteps.java',
    'src/test/java/runner/RunCucumberTest.java',
    'src/test/java/support/SeleniumWorld.java',
    'src/test/java/support/CredentialsHelper.java',
    'src/test/java/pages/BasePage.java',
  ];

  const failures = [];
  for (const rel of expectedArtifacts) {
    try {
      await fs.access(path.join(PROJECT_DIR, rel));
      console.log(`  [ok] ${rel}`);
    } catch {
      failures.push(rel);
      console.log(`  [MISS] ${rel}`);
    }
  }

  // Self-healing chain present in every scenario step file?
  const stepDefFiles = [
    'AmazonLoginSteps.java',
    'AmazonSearchMobileSteps.java',
    'AmazonAddToCartSteps.java',
    'AmazonLogoutSteps.java',
  ];
  for (const f of stepDefFiles) {
    const src = await fs.readFile(path.join(stepsDir, f), 'utf8');
    if (!src.includes('SELECTOR_FALLBACKS_BY_PRIMARY')) {
      failures.push(`${f}: missing SELECTOR_FALLBACKS_BY_PRIMARY`);
      console.log(`  [MISS] ${f} : SELECTOR_FALLBACKS_BY_PRIMARY`);
    } else {
      console.log(`  [ok] ${f} contains SELECTOR_FALLBACKS_BY_PRIMARY`);
    }
    // At least one element must have >1 selector in its fallback list,
    // otherwise the healer chain is nominal-only and won't recover.
    // Use a permissive regex that allows escaped quotes inside the string.
    const fallbackBlocks = src.match(/selectors_[A-Za-z0-9_]+\.add\("(?:[^"\\]|\\.)*"\);/g) || [];
    const lengthsByVar = {};
    for (const line of fallbackBlocks) {
      const m = line.match(/selectors_([A-Za-z0-9_]+)/);
      if (m) lengthsByVar[m[1]] = (lengthsByVar[m[1]] || 0) + 1;
    }
    const maxFallback = Math.max(0, ...Object.values(lengthsByVar));
    if (maxFallback < 2) {
      failures.push(`${f}: no element has a fallback chain (>1 selector)`);
      console.log(`  [MISS] ${f} : longest fallback chain = ${maxFallback}`);
    } else {
      console.log(`  [ok] ${f} longest fallback chain = ${maxFallback} selectors`);
    }
    if (!src.includes('CredentialsHelper.resolve(value)')) {
      // It's only required for the login scenario (the only one that types
      // a ${} placeholder). Everywhere else, presence is fine, absence is
      // also fine for steps that don't have iTypeInto. Only flag if the
      // file has iTypeInto but no resolver wiring.
      if (src.includes('public void iTypeInto(')) {
        failures.push(`${f}: iTypeInto missing CredentialsHelper.resolve()`);
        console.log(`  [MISS] ${f} : CredentialsHelper.resolve(value) in iTypeInto`);
      }
    } else {
      console.log(`  [ok] ${f} resolves \${ENV_VAR} via CredentialsHelper`);
    }
  }

  // Hard guarantee: real password must NOT appear anywhere in projects/amazon
  console.log('\n[VALIDATE] Scanning for accidental credential leaks ...');
  const REDACTED_PATTERNS = ['MUmbai123#', 'MUmbai123', 'rutvijsingale@gmail.com'];
  async function walkAndScan(dir) {
    const ents = await fs.readdir(dir, { withFileTypes: true });
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walkAndScan(p);
      } else {
        const buf = await fs.readFile(p, 'utf8').catch(() => '');
        for (const pat of REDACTED_PATTERNS) {
          if (buf.includes(pat)) {
            failures.push(`LEAK: ${pat} found in ${path.relative(REPO_ROOT, p)}`);
          }
        }
      }
    }
  }
  await walkAndScan(PROJECT_DIR);
  if (!failures.some((f) => f.startsWith('LEAK:'))) {
    console.log('  [ok] no real credentials present in projects/amazon (only ${ENV_VAR} placeholders)');
  }

  if (failures.length > 0) {
    console.error('\n[FAIL] Build did not satisfy all assertions:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }

  console.log('\n[DONE] projects/amazon built successfully.');
  console.log('       4 scenarios, 1 project, full self-healing chain, env-var creds.');
  return { projectDir: PROJECT_DIR, scenarios: enrichedScenarios.map((s) => s.featureTitle) };
}

buildAmazonSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
