/**
 * Unit tests for services/amazonScenarios.js.
 *
 * Hard contract under test:
 *   - All 13 scenarios (A–M) are present.
 *   - No scenario inlines a real-looking credential value.
 *   - Login-shaped scenarios reference ${AMAZON_USERNAME} / ${AMAZON_PASSWORD}.
 *   - Every checkout-shaped scenario carries `requiresCheckoutGuard: true`.
 *   - When rendered through the test plan generator, no plan trips the
 *     credential-leak detector.
 *   - The runnable Sony WH-CH520 steps export uses env-var placeholders only,
 *     covers every locator stage with ≥2 candidates, and is rerun-shaped.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  listAmazonScenarios,
  findCredentialLeaks,
  getAmazonSonyWhCh520Steps,
} from '../../services/amazonScenarios.js';
import { renderTestPlan } from '../../services/testPlanGenerator.js';

const FRAMEWORK = 'playwright-java';
const PROJECT = 'amazon-suite';

test('listAmazonScenarios: returns exactly 13 scenarios A–M', () => {
  const list = listAmazonScenarios({ framework: FRAMEWORK, projectName: PROJECT });
  assert.equal(list.length, 13, 'Expected scenarios A through M (13 total)');
  const letters = list.map((s) => s.letter).sort();
  assert.deepEqual(letters, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']);
});

test('listAmazonScenarios: requires framework + projectName', () => {
  assert.throws(() => listAmazonScenarios({}), /framework and projectName/);
  assert.throws(() => listAmazonScenarios({ framework: 'x' }), /framework and projectName/);
  assert.throws(() => listAmazonScenarios({ projectName: 'x' }), /framework and projectName/);
});

test('listAmazonScenarios: every scenario carries the requested framework / project', () => {
  const list = listAmazonScenarios({ framework: FRAMEWORK, projectName: PROJECT });
  for (const s of list) {
    assert.equal(s.framework, FRAMEWORK, `Scenario ${s.letter}: framework`);
    assert.equal(s.projectName, PROJECT, `Scenario ${s.letter}: projectName`);
    assert.equal(s.applicationName, 'Amazon');
  }
});

test('listAmazonScenarios: login scenarios use ${AMAZON_*} env-var placeholders, never literal values', () => {
  const list = listAmazonScenarios({ framework: FRAMEWORK, projectName: PROJECT });
  const login = list.find((s) => s.letter === 'B');
  assert.ok(login, 'Scenario B must exist');
  assert.equal(login.credentialsSource.username, '${AMAZON_USERNAME}');
  assert.equal(login.credentialsSource.password, '${AMAZON_PASSWORD}');
  // The step narrative also uses the env-var form
  const stepText = login.steps.join('\n');
  assert.ok(stepText.includes('${AMAZON_USERNAME}'));
  assert.ok(stepText.includes('${AMAZON_PASSWORD}'));
  // Negative login (K) MUST NOT carry the real env-var refs (uses synthetic data only)
  const neg = list.find((s) => s.letter === 'K');
  assert.ok(neg, 'Scenario K must exist');
  const negText = JSON.stringify(neg);
  assert.ok(!negText.includes('${AMAZON_PASSWORD}'),
    'Negative login must never reference the real password env var');
});

test('listAmazonScenarios: checkout-shaped scenarios all set requiresCheckoutGuard', () => {
  const list = listAmazonScenarios({ framework: FRAMEWORK, projectName: PROJECT });
  // H = Add to cart, I = Cart validation. Both touch ecommerce flow.
  const h = list.find((s) => s.letter === 'H');
  const i = list.find((s) => s.letter === 'I');
  assert.equal(h.requiresCheckoutGuard, true, 'H (Add to cart) must require checkout guard');
  assert.equal(i.requiresCheckoutGuard, true, 'I (Cart validation) must require checkout guard');
  // The H scenario explicitly forbids payment in its limitations.
  const hMd = renderTestPlan(h);
  assert.match(hMd, /BEFORE payment/i);
  assert.match(hMd, /forbidden/i);
});

test('listAmazonScenarios: rendered plans have NO real credential leaks', () => {
  const list = listAmazonScenarios({ framework: FRAMEWORK, projectName: PROJECT });
  for (const s of list) {
    const md = renderTestPlan(s);
    const leaks = findCredentialLeaks(md);
    assert.deepEqual(
      leaks,
      [],
      `Scenario ${s.letter} (${s.scenarioId}) leaked credentials: ${JSON.stringify(leaks)}`
    );
  }
});

test('findCredentialLeaks: catches inline emails (real-looking)', () => {
  const dirty = 'Login as john.smith@gmail.com with password hunter2';
  const leaks = findCredentialLeaks(dirty);
  assert.ok(leaks.length > 0, 'Real-looking email + password must be flagged');
});

test('findCredentialLeaks: tolerates env-var placeholders and synthetic test domains', () => {
  const safe = 'Login as ${AMAZON_USERNAME} (zac@example.invalid). Password from ${AMAZON_PASSWORD}.';
  const leaks = findCredentialLeaks(safe);
  assert.deepEqual(leaks, [], `False-positive on safe text: ${JSON.stringify(leaks)}`);
});

test('listAmazonScenarios: scroll scenario (D) describes scroll-dependent elements', () => {
  const list = listAmazonScenarios({ framework: FRAMEWORK, projectName: PROJECT });
  const d = list.find((s) => s.letter === 'D');
  assert.ok(d.scrollDependentElements && d.scrollDependentElements.length > 0,
    'Scenario D must enumerate scroll-dependent elements');
  const md = renderTestPlan(d);
  assert.match(md, /## Scroll-dependent elements/);
});

test('listAmazonScenarios: scenario M (Sony WH-CH520) is checkout-guarded and references the product', () => {
  const list = listAmazonScenarios({ framework: FRAMEWORK, projectName: PROJECT });
  const m = list.find((s) => s.letter === 'M');
  assert.ok(m, 'Scenario M must exist');
  assert.equal(m.scenarioId, 'amazon-sony-wh-ch520-end-to-end');
  assert.equal(m.requiresCheckoutGuard, true,
    'M touches the cart and must require the checkout guard');
  assert.equal(m.credentialsSource.username, '${AMAZON_USERNAME}');
  assert.equal(m.credentialsSource.password, '${AMAZON_PASSWORD}');
  assert.match(m.testData.searchTerm, /Sony WH-CH520/);
  // Renders cleanly with no leaks and explicit "before payment" guard.
  const md = renderTestPlan(m);
  assert.deepEqual(findCredentialLeaks(md), []);
  assert.match(md, /BEFORE payment/i);
  assert.match(md, /WH-CH520/);
  // Has both sign-in AND sign-out semantics (full journey).
  assert.match(md, /Sign[- ]?In/i);
  assert.match(md, /Sign[ ]?Out/i);
});

test('getAmazonSonyWhCh520Steps: produces a rerun-shaped, env-var-only action sequence', () => {
  const steps = getAmazonSonyWhCh520Steps();
  // Must include the canonical action types for a full journey.
  const kinds = steps.map((s) => s.kind);
  for (const required of ['navigate', 'click', 'type', 'scroll', 'assertVisible', 'hover']) {
    assert.ok(kinds.includes(required), `Steps must include at least one '${required}' action`);
  }
  // No real credentials anywhere in the serialized form.
  const blob = JSON.stringify(steps);
  assert.deepEqual(findCredentialLeaks(blob), [],
    'getAmazonSonyWhCh520Steps must contain zero credential leaks');
  assert.ok(blob.includes('${AMAZON_USERNAME}'), 'username placeholder present');
  assert.ok(blob.includes('${AMAZON_PASSWORD}'), 'password placeholder present');
  // Every interactive step (click/type/assert/hover) carries ≥2 locator candidates
  // so the healer always has a fallback chain to walk.
  const interactive = steps.filter((s) =>
    ['click', 'type', 'assertVisible', 'hover'].includes(s.kind));
  for (const s of interactive) {
    assert.ok(Array.isArray(s.locatorCandidates) && s.locatorCandidates.length >= 2,
      `Step kind=${s.kind} selector=${s.selector} must have ≥2 locator candidates`);
    assert.equal(typeof s.primaryLocatorIndex, 'number');
  }
  // At least one scroll step carries scroll metadata the recorder mirrors to scroll-events.json.
  const scroll = steps.find((s) => s.kind === 'scroll');
  assert.ok(scroll && scroll.scroll && typeof scroll.scroll.y === 'number',
    'scroll step must carry scroll.y so it persists to scroll-events.json');
  assert.equal(scroll.direction, 'down');
});
