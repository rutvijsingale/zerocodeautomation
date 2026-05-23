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
