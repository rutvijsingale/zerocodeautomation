/**
 * generators.selenium-java.test.mjs
 * Snapshot tests for generators/frameworks/java/ — selenium-java framework.
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

const FRAMEWORK = 'selenium-java';
const TEST_OPTS = { framework: FRAMEWORK, projectName: 'test-project', baseUrl: 'https://example.com' };

test('generateJavaWorld (selenium-java) produces SeleniumWorld class', () => {
  const result = generateJavaWorld(FRAMEWORK, {});

  assert.ok(typeof result === 'string', 'result should be a string');
  assert.ok(result.includes('SeleniumWorld'), 'result should contain SeleniumWorld');
  assert.ok(result.includes('package support;'), 'result should start with package');

  checkSnapshot('selenium-java.world', result);
});

test('generateMavenPom (selenium-java) produces valid pom.xml', () => {
  const result = generateMavenPom(FRAMEWORK, TEST_OPTS.projectName, TEST_OPTS.baseUrl);

  assert.ok(typeof result === 'string', 'result should be a string');
  assert.ok(result.includes('<?xml'), 'result should be XML');
  assert.ok(result.includes('selenium'), 'result should reference selenium');
  assert.ok(result.includes('test-project'), 'result should contain project name');

  checkSnapshot('selenium-java.pom', result);
});

test('generateCucumberProperties (selenium-java) produces expected properties', () => {
  const result = generateCucumberProperties();

  assert.ok(typeof result === 'string', 'result should be a string');
  assert.ok(result.includes('cucumber.publish.quiet=true'), 'result should have cucumber config');

  checkSnapshot('selenium-java.cucumber-props', result);
});

test('generateCucumberRunner (selenium-java) produces RunCucumberTest class', () => {
  const result = generateCucumberRunner('runner', 'features', 'steps');

  assert.ok(typeof result === 'string', 'result should be a string');
  assert.ok(result.includes('RunCucumberTest'), 'result should contain runner class name');
  assert.ok(result.includes('@Suite'), 'result should have @Suite annotation');

  checkSnapshot('selenium-java.runner', result);
});
