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

// [ZAC-FIX] Regression tests for column-aware Outline placeholders.
// Without these, every step rendered as "<value>" regardless of which
// Examples column the data came from — Cucumber would never substitute
// the table values and every row would run with the wrong inputs.
test('Outline placeholders match Examples column headers (column-aware)', () => {
  const out = generateFeatureFile({
    featureName: 'Form fill',
    featureTitle: 'Multi-field form',
    useScenarioOutline: true,
    examples: [
      { Name: 'Naysha', Email: 'naysha@zac.dev' },
      { Name: 'Mira',   Email: 'mira@example.com' },
    ],
    steps: [
      { kind: 'type', selector: '#userName',  value: 'Naysha',         normalizedDescription: 'Name field' },
      { kind: 'type', selector: '#userEmail', value: 'naysha@zac.dev', normalizedDescription: 'Email field' },
      { kind: 'click', selector: '#submit', normalizedDescription: 'Submit' },
    ],
  });
  assert.match(out, /"<Name>"/,  'first step should reference <Name> column');
  assert.match(out, /"<Email>"/, 'second step should reference <Email> column');
  assert.ok(!out.includes('"<value>"'),
    'no generic <value> placeholder should remain when columns match — got:\n' + out);
});

test('Outline preserves literal value when no Examples column matches', () => {
  // Step value not in Examples — stay literal, don't emit a phantom <col>.
  const out = generateFeatureFile({
    featureName: 'Mixed-static-and-data',
    featureTitle: 'Mixed',
    useScenarioOutline: true,
    examples: [{ Name: 'Naysha' }, { Name: 'Mira' }],
    steps: [
      { kind: 'navigate', url: 'https://demoqa.com/text-box' },
      { kind: 'type', selector: '#userName',  value: 'Naysha',           normalizedDescription: 'Name field' },
      { kind: 'type', selector: '#userEmail', value: 'fixed@example.com', normalizedDescription: 'Email field' },
    ],
  });
  // Variable: <Name> placeholder used.
  assert.match(out, /"<Name>"/);
  // Static URL preserved (no Examples column for it).
  assert.match(out, /"https:\/\/demoqa\.com\/text-box"/);
  // Static email preserved (no matching column).
  assert.match(out, /"fixed@example\.com"/);
});

test('Outline supports explicit step.exampleColumn override', () => {
  const out = generateFeatureFile({
    featureName: 'Explicit-column',
    featureTitle: 'Explicit',
    useScenarioOutline: true,
    examples: [{ user: 'naysha', pass: 'secret' }, { user: 'mira', pass: 'pass2' }],
    steps: [
      // Even though "naysha" matches the "user" column by value, we
      // explicitly say "treat this as <user>". Belt-and-braces for
      // ambiguous cases where multiple columns share the same value.
      { kind: 'type', selector: '#login', value: 'naysha', exampleColumn: 'user',
        normalizedDescription: 'Login field' },
      { kind: 'type', selector: '#pwd',   value: 'secret', exampleColumn: 'pass',
        normalizedDescription: 'Password field' },
    ],
  });
  assert.match(out, /"<user>"/);
  assert.match(out, /"<pass>"/);
});

test('Background steps render once before Scenarios in multi-scenario mode', () => {
  const out = generateFeatureFile({
    featureName: 'Auth flows',
    backgroundSteps: [
      { kind: 'navigate', url: 'https://demoqa.com/login' },
      { kind: 'type', selector: '#userName', value: 'qa', normalizedDescription: 'Username' },
      { kind: 'click', selector: '#login', normalizedDescription: 'Login' },
    ],
    scenarios: [
      { title: 'Search', tags: ['@positive'],
        steps: [{ kind: 'click', selector: '#search', normalizedDescription: 'Search' }] },
      { title: 'Logout', tags: ['@negative'],
        steps: [{ kind: 'click', selector: '#logout', normalizedDescription: 'Logout' }] },
    ],
  });
  // One Background, before both scenarios.
  const bgIdx = out.indexOf('Background:');
  const sc1Idx = out.indexOf('Scenario: Search');
  const sc2Idx = out.indexOf('Scenario: Logout');
  assert.ok(bgIdx > 0,             'Background block present');
  assert.ok(bgIdx < sc1Idx,        'Background appears before first Scenario');
  assert.ok(sc1Idx < sc2Idx,       'Scenarios appear in declared order');
  // Background includes its 3 steps.
  assert.match(out, /Given I navigate to "https:\/\/demoqa\.com\/login"/);
  assert.match(out, /And I type "qa" into "Username"/);
  assert.match(out, /When I click "Login"/);
});

test('Mixed feature: Background + plain Scenario + Scenario Outline + tags', () => {
  const out = generateFeatureFile({
    featureName: 'Big feature',
    backgroundSteps: [{ kind: 'navigate', url: 'https://demoqa.com/elements' }],
    scenarios: [
      { title: 'Plain', tags: ['@smoke'],
        steps: [{ kind: 'click', selector: '#go', normalizedDescription: 'Go' }] },
      { title: 'Driven', tags: ['@data-driven'],
        useScenarioOutline: true,
        examples: [{ name: 'Naysha', age: '30' }, { name: 'Mira', age: '28' }],
        steps: [
          { kind: 'type', selector: '#name', value: 'Naysha', normalizedDescription: 'Name' },
          { kind: 'type', selector: '#age',  value: '30',     normalizedDescription: 'Age' },
        ] },
    ],
  });
  // Counts must match Cucumber expectations.
  assert.equal((out.match(/^Feature:/gm) || []).length, 1);
  assert.equal((out.match(/^\s+Background:/gm) || []).length, 1);
  assert.equal((out.match(/^\s+Scenario:/gm) || []).length, 1);
  assert.equal((out.match(/^\s+Scenario Outline:/gm) || []).length, 1);
  assert.equal((out.match(/^\s+Examples:/gm) || []).length, 1);
  assert.match(out, /"<name>"/);
  assert.match(out, /"<age>"/);
  assert.match(out, /@smoke/);
  assert.match(out, /@data-driven/);
});
