/**
 * generators.gherkin.test.mjs
 * Snapshot tests for generators/gherkin.js → generateFeatureFile
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { generateFeatureFile } from '../../generators/gherkin.js';

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

test('generateFeatureFile produces a valid .feature file', () => {
  const result = generateFeatureFile({
    featureName: 'Test Feature',
    featureTitle: 'Test Scenario',
    tags: ['@recorded'],
    steps: TEST_STEPS,
  });

  assert.ok(typeof result === 'string', 'result should be a string');
  assert.ok(result.includes('Feature:'), 'result should contain Feature:');
  assert.ok(result.includes('Scenario'), 'result should contain Scenario');

  checkSnapshot('gherkin.feature', result);
});

test('generateFeatureFile with scenario outline', () => {
  const result = generateFeatureFile({
    featureName: 'Outline Feature',
    featureTitle: 'Parameterized Scenario',
    tags: ['@recorded'],
    steps: TEST_STEPS,
    useScenarioOutline: true,
    examples: [
      { email: 'user1@example.com' },
      { email: 'user2@example.com' },
    ],
  });

  assert.ok(typeof result === 'string', 'result should be a string');
  assert.ok(result.includes('Feature:'), 'result should contain Feature:');

  checkSnapshot('gherkin.outline.feature', result);
});
