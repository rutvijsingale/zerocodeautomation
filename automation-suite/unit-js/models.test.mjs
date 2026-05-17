/**
 * Suite : domain_models
 * Layer : JS unit  (node:test)
 * Owner : ZAC Platform QA
 *
 * Asserts the toJSON / fromJSON round-trip and the small invariants each
 * domain model carries (defaults, mutators, fallback locator chain).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Project,
  Feature,
  Scenario,
  Step,
  LocatorDefinition,
  TestDataSet,
  Environment,
  createFeatureFromLegacySteps
} from '../../models/index.js';

test('Project: constructor defaults', () => {
  const p = new Project({ name: 'Demo' });
  assert.equal(p.name, 'Demo');
  assert.equal(p.framework, 'playwright-ts');
  assert.equal(p.browserType, 'chromium');
  assert.match(p.metadata.created, /T/);
});

test('Project: toJSON round-trip', () => {
  // PROD-0001 fix verification: Project.js previously referenced
  // `Feature` and `Environment` in toJSON() without importing them,
  // throwing ReferenceError on every call. Imports now in place.
  const p = new Project({ name: 'Demo' });
  const json = p.toJSON();
  const p2 = Project.fromJSON(json);
  assert.equal(p2.name, p.name);
  assert.equal(p2.framework, p.framework);
});

test('Project: fromJSON accepts plain data without classes', () => {
  const data = {
    name: 'Plain',
    framework: 'playwright-ts',
    baseUrl: 'http://localhost:3000',
    browserType: 'chromium',
    features: [],
    environment: null,
    metadata: {}
  };
  const p = Project.fromJSON(data);
  assert.equal(p.name, 'Plain');
  assert.equal(p.framework, 'playwright-ts');
  assert.equal(p.environment, null);
});

test('Feature + Scenario round-trip', () => {
  const sc = new Scenario({ title: 'Login', tags: ['@smoke'], steps: [
    new Step({ kind: 'navigate', url: 'https://example.com' }),
    new Step({ kind: 'click', selector: '#login' })
  ]});
  const f = new Feature({ name: 'Auth', scenarios: [sc] });
  const f2 = Feature.fromJSON(f.toJSON());
  assert.equal(f2.scenarios.length, 1);
  assert.equal(f2.scenarios[0].steps.length, 2);
  assert.equal(f2.scenarios[0].tags[0], '@smoke');
});

test('Step legacy adapter preserves originals in metadata', () => {
  const legacy = { kind: 'click', selector: '#x', extra: 'preserved' };
  const s = Step.fromLegacyStep(legacy);
  assert.equal(s.kind, 'click');
  assert.equal(s.metadata.extra, 'preserved');
});

test('LocatorDefinition: Playwright string mapping for each type', () => {
  const cases = [
    ['css',    '.foo',                       '.foo'],
    ['xpath',  '//a[@id="x"]',               'xpath=//a[@id="x"]'],
    ['id',     'submit',                     '#submit'],
    ['name',   'q',                          '[name="q"]'],
    ['testId', 'login-btn',                  '[data-testid="login-btn"]'],
    ['role',   'button',                     'role=button'],
    ['text',   'Login',                      'text=Login']
  ];
  for (const [t, v, expected] of cases) {
    const l = new LocatorDefinition({
      pageName: 'P', elementName: 'E', locatorType: t, locatorValue: v
    });
    assert.equal(l.toPlaywrightLocator(), expected);
  }
});

test('LocatorDefinition: getAllLocators chains primary + fallbacks', () => {
  const l = new LocatorDefinition({
    pageName: 'P', elementName: 'E',
    locatorType: 'testId', locatorValue: 'login',
    fallbackLocators: [{ type: 'role', value: 'button' }, { type: 'text', value: 'Login' }]
  });
  const all = l.getAllLocators();
  assert.equal(all.length, 3);
  assert.equal(all[0].type, 'testId');
  assert.equal(all[2].value, 'Login');
});

test('TestDataSet: Examples table generation', () => {
  const ds = new TestDataSet({
    parameters: ['username', 'password'],
    rows: [
      { username: 'alice', password: 'Secret123!' },
      { username: 'bob', password: 'P4ssw0rd!' }
    ]
  });
  const lines = ds.toGherkinExamples();
  assert.equal(lines[0], '    Examples:');
  assert.equal(lines[1], '      | username | password |');
  assert.equal(lines[2], '      | alice | Secret123! |');
  assert.equal(lines.length, 4);
});

test('TestDataSet: empty data returns no Examples lines', () => {
  assert.deepEqual(new TestDataSet().toGherkinExamples(), []);
});

test('Environment: java + ts config emit deterministic output', () => {
  const env = new Environment({
    name: 'QA',
    baseUrl: 'https://qa.example.com',
    browserType: 'firefox',
    headless: true,
    timeouts: { default: 5000, navigation: 10000, element: 5000, pageLoad: 10000, script: 10000 }
  });
  const javaProps = env.toJavaProperties();
  assert.match(javaProps, /environment\.name=QA/);
  assert.match(javaProps, /environment\.baseUrl=https:\/\/qa.example.com/);
  const tsConfig = env.toTypeScriptConfig();
  assert.match(tsConfig, /name: 'QA'/);
  assert.match(tsConfig, /browserType: 'firefox'/);
});

test('createFeatureFromLegacySteps single-scenario fallback', () => {
  const steps = [
    { kind: 'navigate', url: 'https://example.com' },
    { kind: 'click', selector: '#login' }
  ];
  const feature = createFeatureFromLegacySteps(steps, {
    featureName: 'Auth', featureTitle: 'Login', tags: ['@smoke']
  });
  assert.equal(feature.scenarios.length, 1);
  assert.equal(feature.scenarios[0].steps.length, 2);
  assert.deepEqual(feature.scenarios[0].tags, ['@smoke']);
});

test('createFeatureFromLegacySteps with explicit scenarios', () => {
  const feature = createFeatureFromLegacySteps([], {
    featureName: 'F', featureTitle: 'T',
    scenarios: [
      { title: 'A', tags: ['@a'], steps: [{ kind: 'click', selector: '#a' }] },
      { title: 'B', tags: ['@b'], steps: [{ kind: 'click', selector: '#b' }] }
    ]
  });
  assert.equal(feature.scenarios.length, 2);
  assert.equal(feature.scenarios[1].title, 'B');
});
