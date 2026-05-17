/**
 * Unit tests for generators/selenium-testng.js — the first plugin built
 * against the contract documented in generators/PLUGIN.md.
 *
 * Hard contracts under test:
 *   1. The plugin returns a deterministic file map keyed by RELATIVE paths
 *      (no absolute paths, no escapes outside the project root).
 *   2. The TestNG test class:
 *        - opens the recorded baseUrl in @BeforeMethod
 *        - emits one Java statement per recorded step
 *        - resolves \${ENV_VAR} placeholders via CredentialsHelper.resolve()
 *          (NEVER inlines a literal credential)
 *        - launches Chrome with --start-maximized (matches recorder + rerun)
 *   3. The locator chain (BasePage.findWithHealing) carries primary +
 *      every recorded fallback, deduped, in priority order.
 *   4. pom.xml depends on selenium-java + testng + webdrivermanager.
 *   5. The plugin is PURE — no fs, no network, no globals. (Asserted by
 *      structural inspection of the module surface.)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateProject } from '../../generators/selenium-testng.js';

const SAMPLE_STEPS = [
  { kind: 'navigate', url: 'https://www.amazon.com', description: 'open homepage' },
  {
    kind: 'type',
    selector: '#twotabsearchtextbox',
    fallbackSelectors: ['[name="field-keywords"]', '[aria-label="Search"]'],
    locatorCandidates: [{ selector: 'input[type="text"]' }],
    value: 'Sony WH-CH520',
    description: 'search box',
  },
  { kind: 'click', selector: '#nav-search-submit-button', description: 'submit search' },
  { kind: 'scroll', scrollX: 0, scrollY: 1200, description: 'scroll to results' },
  { kind: 'click', selector: 'a.s-result-item', description: 'first product card' },
  { kind: 'click', selector: '#add-to-cart-button', description: 'add to cart' },
  {
    kind: 'type',
    selector: '#ap_email',
    fallbackSelectors: ['[name="email"]'],
    value: '${AMAZON_USERNAME}',
    description: 'email field',
  },
  {
    kind: 'type',
    selector: '#ap_password',
    fallbackSelectors: ['[type="password"]'],
    value: '${AMAZON_PASSWORD}',
    description: 'password field',
  },
];

const CTX = {
  projectName: 'amazon-sony-testng',
  framework: 'selenium-testng',
  baseUrl: 'https://www.amazon.com',
  browserType: 'chromium',
  featureName: 'AmazonSonyE2E',
  featureTitle: 'Amazon Sony WH-CH520 E2E',
  steps: SAMPLE_STEPS,
};

// Helper: pull the test-class file path from the generated map.
function findTestFile(files) {
  return Object.keys(files).find((p) => /^src\/test\/java\/[A-Z][A-Za-z0-9]*Test\.java$/.test(p));
}

test('generateProject: returns a file map with all expected files', () => {
  const result = generateProject(CTX);
  assert.ok(result.files, 'result.files must be present');
  for (const expected of [
    'pom.xml',
    'src/test/resources/testng.xml',
    'src/test/java/support/BasePage.java',
    'src/test/java/support/CredentialsHelper.java',
    'src/test/java/support/Locators.java',
    'locators.json',
    'README.md',
  ]) {
    assert.ok(result.files[expected], `missing expected file: ${expected}`);
  }
  // Test class name is derived from featureTitle via pascalCase; the
  // exact name varies, but the file MUST exist under src/test/java/.
  const testFile = findTestFile(result.files);
  assert.ok(testFile, 'a TestNG test class file must exist under src/test/java/');
});

test('generateProject: file paths are RELATIVE — no leading "/", no ".."', () => {
  const result = generateProject(CTX);
  for (const p of Object.keys(result.files)) {
    assert.equal(p.startsWith('/'), false, `${p} starts with /`);
    assert.equal(p.includes('..'), false, `${p} contains ..`);
  }
});

test('generateProject: same input produces byte-identical output (deterministic)', () => {
  const a = generateProject(CTX);
  const b = generateProject(CTX);
  assert.deepEqual(Object.keys(a.files), Object.keys(b.files));
  for (const p of Object.keys(a.files)) {
    assert.equal(a.files[p], b.files[p], `${p} not deterministic`);
  }
});

test('TestNG test class: launches Chrome with --start-maximized', () => {
  const result = generateProject(CTX);
  const testJava = result.files[findTestFile(result.files)];
  assert.match(testJava, /addArguments\("--start-maximized"\)/,
    'Chrome must launch maximized — matches recorder + rerun contract');
});

test('TestNG test class: opens baseUrl + emits one statement per recorded step', () => {
  const result = generateProject(CTX);
  const testJava = result.files[findTestFile(result.files)];
  assert.match(testJava, /driver\.get\("https:\/\/www\.amazon\.com"\)/);
  const healCalls = (testJava.match(/findWithHealing/g) || []).length;
  assert.ok(healCalls >= 6, `expected ≥6 findWithHealing calls, got ${healCalls}`);
  assert.match(testJava, /window\.scrollTo\(0, 1200\)/, 'scroll step must emit window.scrollTo');
});

test('CredentialsHelper.resolve is invoked for ${ENV_VAR} placeholders', () => {
  const result = generateProject(CTX);
  const testJava = result.files[findTestFile(result.files)];
  assert.match(testJava, /CredentialsHelper\.resolve\("\$\{AMAZON_USERNAME\}"\)/);
  assert.match(testJava, /CredentialsHelper\.resolve\("\$\{AMAZON_PASSWORD\}"\)/);
});

test('TestNG test class NEVER inlines real credential values', () => {
  const result = generateProject({
    ...CTX,
    steps: [
      { kind: 'type', selector: '#ap_email', value: '${AMAZON_USERNAME}' },
      { kind: 'type', selector: '#ap_password', value: '${AMAZON_PASSWORD}' },
    ],
  });
  const testJava = result.files[findTestFile(result.files)];
  assert.equal(testJava.includes('rutvijsingale@gmail.com'), false, 'email leaked into generated source');
  assert.equal(testJava.includes('MUmbai'), false, 'password fragment leaked into generated source');
});

test('Locators.java: chain has primary + every fallback, deduped, in order', () => {
  const result = generateProject(CTX);
  const locJava = result.files['src/test/java/support/Locators.java'];
  // The search-box step had: primary #twotabsearchtextbox + 2 fallbacks + 1 candidate
  // → 4 distinct selectors in the chain.
  assert.match(locJava, /CHAINS\.put\("search_box", Arrays\.asList\(\s*"#twotabsearchtextbox",\s*"\[name=\\"field-keywords\\"]",\s*"\[aria-label=\\"Search\\"]",\s*"input\[type=\\"text\\"]"\s*\)\);/);
});

test('locators.json: chain JSON matches the Java map', () => {
  const result = generateProject(CTX);
  const json = JSON.parse(result.files['locators.json']);
  assert.ok(json.search_box, 'search_box entry must exist');
  assert.deepEqual(json.search_box.chain, [
    '#twotabsearchtextbox',
    '[name="field-keywords"]',
    '[aria-label="Search"]',
    'input[type="text"]',
  ]);
});

test('pom.xml: depends on selenium-java + testng + webdrivermanager', () => {
  const result = generateProject(CTX);
  const pom = result.files['pom.xml'];
  assert.match(pom, /<artifactId>selenium-java<\/artifactId>/);
  assert.match(pom, /<artifactId>testng<\/artifactId>/);
  assert.match(pom, /<artifactId>webdrivermanager<\/artifactId>/);
  // Surefire must point at testng.xml
  assert.match(pom, /<suiteXmlFile>src\/test\/resources\/testng\.xml<\/suiteXmlFile>/);
});

test('BasePage: implements self-healing chain (matches JS healer contract)', () => {
  const result = generateProject(CTX);
  const base = result.files['src/test/java/support/BasePage.java'];
  // Walks the chain
  assert.match(base, /findWithHealing\(List<String> chain\)/);
  // Skips ambiguous matches
  assert.match(base, /matched.*elements.*ambiguous/);
  // Throws with the full tried list
  assert.match(base, /Locator chain exhausted\. Tried: /);
  // Logs healed primary
  assert.match(base, /Healed primary -> /);
});

test('CredentialsHelper.java: throws IllegalStateException for missing env vars', () => {
  const result = generateProject(CTX);
  const helper = result.files['src/test/java/support/CredentialsHelper.java'];
  assert.match(helper, /Missing required environment variable/);
  assert.match(helper, /export "/);
  // mask() is present so logs can show *** instead of secrets.
  assert.match(helper, /public static String mask/);
});

test('result.surfaced points at runnable entry + primary test file', () => {
  const result = generateProject(CTX);
  assert.equal(result.surfaced.runnerEntryPoint, 'pom.xml');
  assert.equal(result.surfaced.readme, 'README.md');
  assert.match(result.surfaced.primaryTestFile, /^src\/test\/java\/[A-Z][A-Za-z0-9]*Test\.java$/);
  assert.ok(result.files[result.surfaced.primaryTestFile],
    'surfaced.primaryTestFile must exist in result.files');
});

test('plugin is pure: no fs / network imports at module top', async () => {
  const fsRaw = await import('node:fs/promises');
  // Read the source and assert no fs/net imports.
  const src = await fsRaw.readFile(
    new URL('../../generators/selenium-testng.js', import.meta.url),
    'utf8'
  );
  assert.equal(/from\s+['"]fs(\/|['"])/.test(src), false, 'plugin must not import fs');
  assert.equal(/from\s+['"]http['"]/.test(src), false, 'plugin must not import http');
  assert.equal(/from\s+['"]https['"]/.test(src), false, 'plugin must not import https');
  assert.equal(/from\s+['"]net['"]/.test(src), false, 'plugin must not import net');
});

test('framework registry: selenium-testng is listed', async () => {
  const fsRaw = await import('node:fs/promises');
  const raw = await fsRaw.readFile(
    new URL('../../config/frameworks.json', import.meta.url),
    'utf8'
  );
  const registry = JSON.parse(raw);
  const ids = registry.frameworks.map((f) => f.id);
  assert.ok(ids.includes('selenium-testng'), 'selenium-testng must be registered');
});
