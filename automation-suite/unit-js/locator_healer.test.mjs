/**
 * automation-suite/unit-js/locator_healer.test.mjs
 *
 * Pure unit tests for utils/locatorHealer.js. We mock Playwright's `page`
 * API so every healing edge case (primary works, primary fails + fallback
 * heals, ambiguous candidate skipped, all candidates exhausted, synthesis
 * from element metadata) runs in <100 ms with no browser dependency.
 *
 * Run:  node --test automation-suite/unit-js/locator_healer.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateLocator,
  healLocator,
  findElementWithHealing,
  getLocator,
} from '../../utils/locatorHealer.js';

/* -------------------------------------------------------------------------- *
 *  Test harness — mock Playwright Page.                                      *
 *                                                                            *
 *  rules: { selector: { state: 'visible'|'attached'|'any', count: number } } *
 *  Anything not in the rules table is treated as not-found (waitForSelector  *
 *  rejects immediately so the test runs fast).                               *
 * -------------------------------------------------------------------------- */

function makeFakePage(rules) {
  return {
    async waitForSelector(selector, { state = 'visible' } = {}) {
      const rule = rules[selector];
      if (!rule) {
        const err = new Error(`waitForSelector: ${selector} not found`);
        throw err;
      }
      // Treat 'any' as wildcard so a single rule can satisfy any state query.
      if (rule.state !== 'any' && rule.state !== state) {
        const err = new Error(`waitForSelector: ${selector} not in state=${state}`);
        throw err;
      }
      return Promise.resolve();
    },
    locator(selector) {
      const rule = rules[selector];
      return {
        count: async () => (rule ? (rule.count ?? 1) : 0),
      };
    },
  };
}

/* -------------------------------------------------------------------------- *
 *  validateLocator                                                           *
 * -------------------------------------------------------------------------- */

test('validateLocator: returns ok=true on unique visible element', async () => {
  const page = makeFakePage({ '#go': { state: 'visible', count: 1 } });
  const r = await validateLocator(page, '#go', { state: 'visible', timeout: 50 });
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'matched');
  assert.equal(r.count, 1);
});

test('validateLocator: returns ok=false reason=not-found when missing', async () => {
  const page = makeFakePage({});
  const r = await validateLocator(page, '#missing', { timeout: 50 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-found');
  assert.equal(r.count, 0);
});

test('validateLocator: strictUnique=true flags ambiguity (count > 1)', async () => {
  const page = makeFakePage({ '.btn': { state: 'visible', count: 5 } });
  const r = await validateLocator(page, '.btn', { strictUnique: true, timeout: 50 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'ambiguous');
  assert.equal(r.count, 5);
});

test('validateLocator: strictUnique=false permits ambiguity (legacy primary behaviour)', async () => {
  const page = makeFakePage({ '.btn': { state: 'visible', count: 5 } });
  const r = await validateLocator(page, '.btn', { strictUnique: false, timeout: 50 });
  assert.equal(r.ok, true);
  assert.equal(r.count, 5);
});

test('validateLocator: rejects empty selector with reason=invalid', async () => {
  const page = makeFakePage({});
  const r = await validateLocator(page, '', { timeout: 50 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid');
});

/* -------------------------------------------------------------------------- *
 *  healLocator                                                               *
 * -------------------------------------------------------------------------- */

test('healLocator: primary works → returns primary, healed=false', async () => {
  const page = makeFakePage({ '#login': { state: 'visible', count: 1 } });
  const r = await healLocator(page, '#login', ['[data-testid="login"]'], { primaryTimeout: 50, fallbackTimeout: 50 });
  assert.equal(r.healed, false);
  assert.equal(r.selector, '#login');
  assert.equal(r.healedVia, null);
  assert.equal(r.exhausted, false);
  assert.equal(r.attempts.length, 1);
  assert.equal(r.attempts[0].role, 'primary');
  assert.equal(r.attempts[0].ok, true);
});

test('healLocator: primary fails, unique fallback heals', async () => {
  const page = makeFakePage({
    '[data-testid="login"]': { state: 'visible', count: 1 },
  });
  const r = await healLocator(
    page,
    '#login-stale',
    ['[data-testid="login"]'],
    { primaryTimeout: 50, fallbackTimeout: 50 }
  );
  assert.equal(r.healed, true);
  assert.equal(r.selector, '[data-testid="login"]');
  assert.equal(r.healedVia, '[data-testid="login"]');
  assert.equal(r.primarySelector, '#login-stale');
  assert.equal(r.exhausted, false);
  // 2 attempts: primary (ok=false) + fallback (ok=true)
  assert.equal(r.attempts.length, 2);
  assert.equal(r.attempts[0].role, 'primary');
  assert.equal(r.attempts[0].ok, false);
  assert.equal(r.attempts[1].role, 'fallback');
  assert.equal(r.attempts[1].ok, true);
});

test('healLocator: ambiguous fallback is skipped, next unique fallback heals', async () => {
  const page = makeFakePage({
    '.btn':                 { state: 'visible', count: 7 }, // ambiguous → skipped
    '[data-testid="login"]': { state: 'visible', count: 1 }, // unique → wins
  });
  const r = await healLocator(
    page,
    '#login-stale',
    ['.btn', '[data-testid="login"]'],
    { primaryTimeout: 50, fallbackTimeout: 50 }
  );
  assert.equal(r.healed, true);
  assert.equal(r.healedVia, '[data-testid="login"]');
  // attempts: primary fail, .btn ambiguous, data-testid ok
  assert.equal(r.attempts.length, 3);
  assert.equal(r.attempts[1].role, 'fallback');
  assert.equal(r.attempts[1].reason, 'ambiguous');
  assert.equal(r.attempts[2].ok, true);
});

test('healLocator: every candidate fails → exhausted, primary returned for error UX', async () => {
  const page = makeFakePage({});
  const r = await healLocator(
    page,
    '#login-stale',
    ['.also-stale', '[data-testid="never-rendered"]'],
    { primaryTimeout: 50, fallbackTimeout: 50 }
  );
  assert.equal(r.healed, false);
  assert.equal(r.exhausted, true);
  assert.equal(r.selector, '#login-stale'); // returns primary so caller's error names recorded selector
  assert.equal(r.reason, 'all-candidates-missing');
});

test('healLocator: every candidate ambiguous → exhausted with reason=all-candidates-ambiguous-or-missing', async () => {
  const page = makeFakePage({
    '.btn':       { state: 'visible', count: 4 },
    '.alt-btn':   { state: 'visible', count: 2 },
  });
  const r = await healLocator(
    page,
    '#login-stale',
    ['.btn', '.alt-btn'],
    { primaryTimeout: 50, fallbackTimeout: 50 }
  );
  assert.equal(r.healed, false);
  assert.equal(r.exhausted, true);
  assert.equal(r.reason, 'all-candidates-ambiguous-or-missing');
});

test('healLocator: dedupes duplicate fallbacks and skips primary if listed again', async () => {
  const page = makeFakePage({
    '[data-testid="login"]': { state: 'visible', count: 1 },
  });
  const r = await healLocator(
    page,
    '#login-stale',
    ['#login-stale', '#login-stale', '[data-testid="login"]', '[data-testid="login"]'],
    { primaryTimeout: 50, fallbackTimeout: 50 }
  );
  assert.equal(r.healed, true);
  assert.equal(r.healedVia, '[data-testid="login"]');
  // attempts: primary fail + 1 unique fallback (the duplicates and the primary-as-fallback are dropped)
  const fallbackAttempts = r.attempts.filter((a) => a.role === 'fallback');
  assert.equal(fallbackAttempts.length, 1);
});

/* -------------------------------------------------------------------------- *
 *  getLocator                                                                *
 * -------------------------------------------------------------------------- */

test('getLocator: returns primary + fallbackSelectors + locatorCandidates in priority order', () => {
  const list = getLocator({
    selector: '#primary',
    fallbackSelectors: ['[data-testid="x"]', '[name="y"]'],
    locatorCandidates: [
      { selector: '#primary' },        // duplicate of primary → dropped
      { selector: '[role="button"]' }, // new → kept
    ],
  });
  assert.deepEqual(list, ['#primary', '[data-testid="x"]', '[name="y"]', '[role="button"]']);
});

test('getLocator: synthesises from element metadata when no other candidates', () => {
  const list = getLocator({
    selector: '#stale',
    element: {
      id: 'login-btn',
      name: 'login',
      ariaLabel: 'Sign in',
      placeholder: 'Email',
      role: 'button',
      text: 'Sign in',
      dataset: { testid: 'login-button' },
    },
  });
  assert.equal(list[0], '#stale');
  // Synthesised candidates appear in the list (order: testid, id, name, aria-label, placeholder, role, text)
  assert.ok(list.includes('[data-testid="login-button"]'), 'data-testid synthesised');
  assert.ok(list.includes('#login-btn'), 'id synthesised');
  assert.ok(list.includes('[name="login"]'), 'name synthesised');
  assert.ok(list.includes('[aria-label="Sign in"]'), 'aria-label synthesised');
  assert.ok(list.includes('[placeholder="Email"]'), 'placeholder synthesised');
  assert.ok(list.some((s) => s.startsWith('role=button')), 'role synthesised');
  assert.ok(list.some((s) => s.startsWith('text=')), 'text synthesised');
});

test('getLocator: empty/invalid step → empty list', () => {
  assert.deepEqual(getLocator(null), []);
  assert.deepEqual(getLocator({}), []);
  assert.deepEqual(getLocator({ selector: '' }), []);
});

/* -------------------------------------------------------------------------- *
 *  findElementWithHealing                                                    *
 * -------------------------------------------------------------------------- */

test('findElementWithHealing: zero-overhead path when no fallbacks AND no metadata', async () => {
  const page = makeFakePage({});  // page intentionally empty to prove no calls happened
  const r = await findElementWithHealing(page, { selector: '#solo' });
  assert.equal(r.selector, '#solo');
  assert.equal(r.healed, false);
  assert.equal(r.exhausted, false);
  assert.equal(r.reason, 'no-fallbacks');
  assert.equal(r.attempts.length, 0); // no validation calls were made
});

test('findElementWithHealing: walks chain and heals via synthesised candidate', async () => {
  const page = makeFakePage({
    '[data-testid="login-button"]': { state: 'visible', count: 1 },
  });
  const r = await findElementWithHealing(page, {
    selector: '#stale',
    element: { dataset: { testid: 'login-button' }, id: 'also-stale' },
  }, { primaryTimeout: 50, fallbackTimeout: 50 });
  assert.equal(r.healed, true);
  assert.equal(r.healedVia, '[data-testid="login-button"]');
});
