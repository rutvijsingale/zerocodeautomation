/**
 * Suite : scenario_outline
 * Layer : JS unit  (node:test)
 * Owner : ZAC Platform QA
 *
 * Verifies:
 *   - generators/gherkin.js#detectScenarioOutline correctly fingerprints
 *     repeated `type` actions on the same selector.
 *   - generateFeatureFile emits a valid `Scenario Outline:` block when
 *     `useScenarioOutline=true` + examples are provided.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateFeatureFile,
  detectScenarioOutline
} from '../../generators/gherkin.js';

test('detectScenarioOutline finds repeated values on same selector', () => {
  const steps = [
    { kind: 'navigate', url: 'https://example.com' },
    { kind: 'type', selector: '#q', value: 'playwright' },
    { kind: 'type', selector: '#q', value: 'selenium' },
    { kind: 'type', selector: '#q', value: 'cypress' },
    { kind: 'click', selector: '#go' }
  ];
  const result = detectScenarioOutline(steps);
  assert.equal(result.useScenarioOutline, true);
  assert.equal(result.examples.length, 3);
  const values = result.examples.map(e => e.value).sort();
  assert.deepEqual(values, ['cypress', 'playwright', 'selenium']);
});

test('detectScenarioOutline returns false for single-value flow', () => {
  const steps = [
    { kind: 'navigate', url: 'https://example.com' },
    { kind: 'type', selector: '#q', value: 'playwright' },
    { kind: 'click', selector: '#go' }
  ];
  assert.equal(detectScenarioOutline(steps).useScenarioOutline, false);
});

test('generateFeatureFile produces a valid Scenario Outline block', () => {
  const out = generateFeatureFile({
    featureName: 'Search',
    featureTitle: 'Search by term',
    useScenarioOutline: true,
    examples: [{ value: 'playwright' }, { value: 'cypress' }],
    steps: [
      { kind: 'navigate', url: 'https://example.com' },
      { kind: 'type', selector: '#q', value: 'playwright' },
      { kind: 'click', selector: '#go' }
    ]
  });
  assert.match(out, /Feature: Search/);
  assert.match(out, /Scenario Outline:/);
  assert.match(out, /Examples:/);
  assert.match(out, /\| value \|/);
  assert.match(out, /\| playwright \|/);
  assert.match(out, /\| cypress \|/);
});

test('generateFeatureFile emits multi-scenario when scenarios array provided', () => {
  const out = generateFeatureFile({
    featureName: 'Multi',
    scenarios: [
      { title: 'Login',  tags: ['@smoke'],     steps: [{ kind: 'click', selector: '#a' }] },
      { title: 'Logout', tags: ['@regression'], steps: [{ kind: 'click', selector: '#b' }] }
    ]
  });
  assert.match(out, /Scenario: Login/);
  assert.match(out, /Scenario: Logout/);
  assert.match(out, /@regression/);
});
