/**
 * Suite : selenium_grid_world
 * Layer : JS unit (node:test)
 * Owner : ZAC Platform QA
 *
 * Regression coverage for the [ZAC-FIX] Selenium Grid integration:
 * generated SeleniumWorld.java now reads SELENIUM_HUB_URL (env) or
 * zac.seleniumHubUrl (JVM property) and instantiates a
 * RemoteWebDriver against the grid when set; otherwise falls back
 * to local ChromeDriver / FirefoxDriver / SafariDriver.
 *
 * We unit-test the GENERATOR (a pure JS function) rather than
 * compiling Java — the harness runs in any node:test environment
 * with no JDK required.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateJavaWorld,
  generateCucumberProperties,
} from '../../java-code-generators.js';
import { generateProject as generateSeleniumTestng } from '../../generators/selenium-testng.js';
import { generateWorldFile } from '../../generators/steps_ts_template.js';

test('generateJavaWorld(selenium-java): imports RemoteWebDriver + URL', () => {
  const code = generateJavaWorld('selenium-java', { browserType: 'chrome', headless: false });
  assert.match(code, /import org\.openqa\.selenium\.remote\.RemoteWebDriver;/,
    'must import RemoteWebDriver to support Grid');
  assert.match(code, /import java\.net\.URL;/,
    'must import java.net.URL for hub URL parsing');
});

test('generateJavaWorld(selenium-java): reads SELENIUM_HUB_URL + zac.seleniumHubUrl', () => {
  const code = generateJavaWorld('selenium-java', { browserType: 'chrome' });
  assert.match(code, /System\.getenv\("SELENIUM_HUB_URL"\)/,
    'must read the canonical SELENIUM_HUB_URL env var');
  assert.match(code, /System\.getProperty\("zac\.seleniumHubUrl"\)/,
    'must accept mvn -Dzac.seleniumHubUrl=... overrides');
});

test('generateJavaWorld(selenium-java): instantiates RemoteWebDriver only when hub set', () => {
  const code = generateJavaWorld('selenium-java', { browserType: 'chrome' });
  // Grid path
  assert.match(code, /if \(hubUrl != null\)/,
    'Grid path is gated on hubUrl being non-null');
  assert.match(code, /new RemoteWebDriver\(new URL\(hubUrl\), chromeOptions\)/,
    'Chrome on Grid uses RemoteWebDriver(URL, ChromeOptions)');
  assert.match(code, /new RemoteWebDriver\(new URL\(hubUrl\), firefoxOptions\)/,
    'Firefox on Grid uses RemoteWebDriver(URL, FirefoxOptions)');
  // Local fallback path is preserved
  assert.match(code, /new ChromeDriver\(chromeOptions\)/,
    'local fallback still creates ChromeDriver');
  assert.match(code, /new FirefoxDriver\(firefoxOptions\)/,
    'local fallback still creates FirefoxDriver');
});

test('generateJavaWorld(selenium-java): browser type overridable via env / JVM', () => {
  const code = generateJavaWorld('selenium-java', { browserType: 'chrome' });
  assert.match(code, /System\.getenv\("ZAC_BROWSER"\)/,
    'ZAC_BROWSER env var lets CI lanes pick a browser without recompile');
  assert.match(code, /System\.getProperty\("zac\.browser"\)/,
    'zac.browser JVM prop is the mvn -D equivalent');
});

test('generateJavaWorld(selenium-java): gracefully tolerates Grid nodes without window-maximize', () => {
  // Some Grid nodes (especially headless Selenoid containers) throw on
  // driver.manage().window().maximize() — the generator must wrap that
  // call in a try/catch so the suite doesn't error out at @Before.
  const code = generateJavaWorld('selenium-java', { browserType: 'chrome' });
  assert.match(code, /try\s*\{\s*driver\.manage\(\)\.window\(\)\.maximize\(\);\s*\}\s*catch \(Exception ignored\)/,
    'window().maximize() must be wrapped in try/catch for Grid compatibility');
});

test('generateJavaWorld(selenium-java): braces stay balanced (no truncation)', () => {
  const code = generateJavaWorld('selenium-java', { browserType: 'chrome' });
  const open  = (code.match(/\{/g) || []).length;
  const close = (code.match(/\}/g) || []).length;
  assert.equal(open, close, `unbalanced braces — open=${open} close=${close}`);
});

test('generateJavaWorld(playwright-java): unaffected by Selenium Grid changes', () => {
  // Sanity: the playwright-java World should NOT have suddenly grown
  // RemoteWebDriver imports — Grid is a Selenium concept.
  const code = generateJavaWorld('playwright-java', { browserType: 'chromium' });
  assert.ok(!code.includes('RemoteWebDriver'),
    'playwright-java World leaked Selenium Grid code: ' + code.slice(0, 200));
  assert.match(code, /com\.microsoft\.playwright/);
});

// ──────────────────────────────────────────────────────────────────────────
// All-framework remote-execution parity. Every generated bootstrap MUST
// surface the same env / property hooks so QA can flip between local
// and remote (Grid / BrowserStack / Saucelabs / self-hosted Playwright
// Server) without regenerating the project.
// ──────────────────────────────────────────────────────────────────────────

test('playwright-java World: PLAYWRIGHT_WS_ENDPOINT remote-browser hooks', () => {
  const code = generateJavaWorld('playwright-java', { browserType: 'chromium' });
  assert.match(code, /System\.getenv\("PLAYWRIGHT_WS_ENDPOINT"\)/,
    'env var hook missing');
  assert.match(code, /System\.getProperty\("zac\.playwrightWsEndpoint"\)/,
    'JVM property hook missing');
  assert.match(code, /bt\.connect\(wsEndpoint\)/,
    'remote path must call BrowserType#connect');
  assert.match(code, /bt\.launch\(launchOptions\)/,
    'local path must call BrowserType#launch');
  assert.match(code, /System\.getenv\("ZAC_BROWSER"\)/,
    'browser-type override hook missing');
  assert.match(code, /playwright\.close\(\)/,
    'cleanup must close the Playwright instance (avoid driver leak)');
});

test('selenium-testng test class: SELENIUM_HUB_URL Grid hooks (parity with selenium-java)', () => {
  // The plugin returns { files: { 'src/test/java/...': '<java>' } }
  const out = generateSeleniumTestng({
    projectName: 'grid-st',
    featureTitle: 'Grid',
    featureName: 'Grid',
    baseUrl: 'https://demoqa.com',
    steps: [{ kind: 'navigate', url: 'https://demoqa.com/text-box' }],
    tags: [],
    browserType: 'chrome',
  });
  // Find the *Test.java file and assert the Grid hooks landed there.
  const testFile = Object.entries(out.files || {}).find(([k]) => /Test\.java$/.test(k));
  assert.ok(testFile, 'no *Test.java file emitted');
  const code = testFile[1];

  assert.match(code, /import org\.openqa\.selenium\.remote\.RemoteWebDriver;/);
  assert.match(code, /import java\.net\.URL;/);
  assert.match(code, /System\.getenv\("SELENIUM_HUB_URL"\)/);
  assert.match(code, /System\.getProperty\("zac\.seleniumHubUrl"\)/);
  assert.match(code, /System\.getenv\("ZAC_BROWSER"\)/);
  assert.match(code, /new RemoteWebDriver\(new URL\(hubUrl\)/);
  assert.match(code, /new ChromeDriver\(chromeOpts\)/, 'local Chrome fallback');
  assert.match(code, /new FirefoxDriver\(firefoxOpts\)/, 'local Firefox fallback');
  assert.match(code, /try \{ driver\.manage\(\)\.window\(\)\.maximize\(\); \}/,
    'window().maximize() must be wrapped for Grid robustness');
});

test('TS/JS World template: PLAYWRIGHT_WS_ENDPOINT remote-browser hooks', () => {
  const code = generateWorldFile();
  assert.match(code, /process\.env\.PLAYWRIGHT_WS_ENDPOINT/,
    'PLAYWRIGHT_WS_ENDPOINT env var hook missing');
  assert.match(code, /process\.env\.ZAC_BROWSER/,
    'ZAC_BROWSER env var hook missing');
  assert.match(code, /bt\.connect\(wsEndpoint\)/,
    'remote path must call browserType.connect');
  assert.match(code, /bt\.launch\(\{/,
    'local path must call browserType.launch');
  assert.match(code, /chromium, firefox, webkit/,
    'all 3 Playwright engines must be importable');
});

test('TS/JS World template: edge channel handled', () => {
  const code = generateWorldFile();
  assert.match(code, /channel:\s*['"]msedge['"]/,
    'Edge browser must use msedge channel');
});

test('generateCucumberProperties: exposes parallel-execution config keys', () => {
  // Default stays sequential, but the keys MUST be present so QA can
  // override them via mvn -D... without regenerating the project.
  const props = generateCucumberProperties();
  assert.match(props, /^cucumber\.execution\.parallel\.enabled=false$/m,
    'parallel.enabled key must exist (default false)');
  assert.match(props, /^cucumber\.execution\.parallel\.config\.strategy=dynamic$/m,
    'parallel.config.strategy key must exist (dynamic)');
  assert.match(props, /^cucumber\.execution\.parallel\.config\.dynamic\.factor=1$/m,
    'parallel.config.dynamic.factor key must exist');
});
