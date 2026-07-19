/**
 * generators.selenium-testng.test.mjs
 * Snapshot tests for generators/selenium-testng.js → generateProject
 * (exported as generateProject — the selenium-testng plugin's main entry point)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { generateProject } from '../../generators/selenium-testng.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = join(__dirname, 'snapshots');
if (!existsSync(SNAP_DIR)) mkdirSync(SNAP_DIR, { recursive: true });

function checkSnapshot(name, actual) {
  const snapFile = join(SNAP_DIR, name + '.snap');
  if (process.env.UPDATE_SNAPSHOTS) {
    writeFileSync(snapFile, actual, 'utf8');
    console.log('  snapshot written:', snapFile);
  } else if (existsSync(snapFile)) {
    const expected = readFileSync(snapFile, 'utf8');
    assert.strictEqual(actual, expected, `Snapshot mismatch: ${name}`);
  } else {
    // First run with no snapshot yet — write it and pass
    writeFileSync(snapFile, actual, 'utf8');
    console.log('  snapshot created (first run):', snapFile);
  }
}

const TEST_STEPS = [
  { kind: 'navigate', url: 'https://example.com', selector: '', value: '' },
  { kind: 'click', selector: '#submit-btn', normalizedSelector: '#submit-btn', normalizedDescription: 'Submit Button' },
  { kind: 'type', selector: '#email', value: 'test@example.com', normalizedSelector: '#email', normalizedDescription: 'Email Field' },
  { kind: 'assertText', selector: '#result', expectedValue: 'Success', normalizedSelector: '#result', normalizedDescription: 'Result' },
  { kind: 'waitForSelector', selector: '#loading', normalizedSelector: '#loading', normalizedDescription: 'Loading Spinner' },
];

const TEST_CTX = {
  projectName: 'test-project',
  featureName: 'Test Feature',
  featureTitle: 'RecordedTestFlow',
  baseUrl: 'https://example.com',
  steps: TEST_STEPS,
};

test('generateProject (selenium-testng) returns files map', () => {
  const result = generateProject(TEST_CTX);

  assert.ok(result && typeof result === 'object', 'result should be an object');
  assert.ok(result.files && typeof result.files === 'object', 'result should have files map');
  assert.ok('pom.xml' in result.files, 'files should include pom.xml');

  const pomXml = result.files['pom.xml'];
  assert.ok(typeof pomXml === 'string', 'pom.xml should be a string');
  assert.ok(pomXml.includes('<?xml'), 'pom.xml should be XML');

  checkSnapshot('selenium-testng.pom', pomXml);
});

test('generateProject (selenium-testng) produces a test class', () => {
  const result = generateProject(TEST_CTX);

  // Find the test Java file (key is dynamic based on className)
  const testFileKey = Object.keys(result.files).find(k => k.endsWith('Test.java'));
  assert.ok(testFileKey, 'result files should include a *Test.java file');

  const testClass = result.files[testFileKey];
  assert.ok(typeof testClass === 'string', 'test class should be a string');
  assert.ok(testClass.includes('@Test'), 'test class should have @Test annotation');

  checkSnapshot('selenium-testng.test-class', testClass);
});

test('generateProject (selenium-testng) produces testng.xml', () => {
  const result = generateProject(TEST_CTX);

  const testngXml = result.files['src/test/resources/testng.xml'];
  assert.ok(typeof testngXml === 'string', 'testng.xml should be a string');
  assert.ok(testngXml.includes('<!DOCTYPE suite'), 'testng.xml should have DOCTYPE');

  checkSnapshot('selenium-testng.testng-xml', testngXml);
});
