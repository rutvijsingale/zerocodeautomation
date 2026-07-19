/**
 * generators.playwright-java.test.mjs
 * Snapshot tests for generators/frameworks/java/ — playwright-java framework.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { generateJavaWorld } from '../../generators/frameworks/java/world.js';
import { generateMavenPom } from '../../generators/frameworks/java/pom.js';
import { generateCucumberProperties, generateCucumberRunner } from '../../generators/frameworks/java/cucumber.js';

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

const FRAMEWORK = 'playwright-java';
const TEST_OPTS = { framework: FRAMEWORK, projectName: 'test-project', baseUrl: 'https://example.com' };

test('generateJavaWorld (playwright-java) produces PlaywrightWorld class', () => {
  const result = generateJavaWorld(FRAMEWORK, {});

  assert.ok(typeof result === 'string', 'result should be a string');
  assert.ok(result.includes('PlaywrightWorld'), 'result should contain PlaywrightWorld');
  assert.ok(result.includes('package support;'), 'result should start with package');

  checkSnapshot('playwright-java.world', result);
});

test('generateMavenPom (playwright-java) produces valid pom.xml', () => {
  const result = generateMavenPom(FRAMEWORK, TEST_OPTS.projectName, TEST_OPTS.baseUrl);

  assert.ok(typeof result === 'string', 'result should be a string');
  assert.ok(result.includes('<?xml'), 'result should be XML');
  assert.ok(result.includes('playwright'), 'result should reference playwright');
  assert.ok(result.includes('test-project'), 'result should contain project name');

  checkSnapshot('playwright-java.pom', result);
});

test('generateCucumberProperties produces expected properties', () => {
  const result = generateCucumberProperties();

  assert.ok(typeof result === 'string', 'result should be a string');
  assert.ok(result.includes('cucumber.publish.quiet=true'), 'result should have cucumber config');

  checkSnapshot('playwright-java.cucumber-props', result);
});

test('generateCucumberRunner produces RunCucumberTest class', () => {
  const result = generateCucumberRunner('runner', 'features', 'steps');

  assert.ok(typeof result === 'string', 'result should be a string');
  assert.ok(result.includes('RunCucumberTest'), 'result should contain runner class name');
  assert.ok(result.includes('@Suite'), 'result should have @Suite annotation');

  checkSnapshot('playwright-java.runner', result);
});
