/**
 * Unit tests for utils/locatorQuality.js — the dynamic-attribute
 * detector, selector classifier, and 0-100 confidence scorer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isDynamicAttributeValue,
  hasDynamicClassFragment,
  classifySelector,
  scoreLocator,
  rankCandidates,
} from '../../utils/locatorQuality.js';

/* -------------------------------------------------------------------------- *
 *  Dynamic-attribute detection                                               *
 * -------------------------------------------------------------------------- */

test('isDynamicAttributeValue: catches GUID-shaped values', () => {
  assert.equal(isDynamicAttributeValue('550e8400-e29b-41d4-a716-446655440000'), true);
  assert.equal(isDynamicAttributeValue('550E8400-E29B-41D4-A716-446655440000'), true);
});

test('isDynamicAttributeValue: catches CSS-in-JS hashes', () => {
  assert.equal(isDynamicAttributeValue('jss123'), true);
  assert.equal(isDynamicAttributeValue('css-1a2b3c'), true);
  assert.equal(isDynamicAttributeValue('mui-abc123'), true);
});

test('isDynamicAttributeValue: catches React 18 useId pattern :r0:', () => {
  assert.equal(isDynamicAttributeValue(':r0:'), true);
  assert.equal(isDynamicAttributeValue(':Rabc:'), true);
});

test('isDynamicAttributeValue: catches underscore-prefixed soup _abc123', () => {
  assert.equal(isDynamicAttributeValue('_abc123'), true);
  assert.equal(isDynamicAttributeValue('__next_xyz'), true);
});

test('isDynamicAttributeValue: catches numeric-only ≥4 chars', () => {
  assert.equal(isDynamicAttributeValue('1234'), true);
  assert.equal(isDynamicAttributeValue('99999999'), true);
});

test('isDynamicAttributeValue: catches long random alphanumerics ≥10 chars', () => {
  assert.equal(isDynamicAttributeValue('abc1d2efGhij'), true);
  assert.equal(isDynamicAttributeValue('XyZ12345abcde'), true);
});

test('isDynamicAttributeValue: PASSES THROUGH human-written values', () => {
  for (const v of [
    'login-btn',
    'login_btn',
    'signin',
    'add-to-cart',
    'username',
    'email',
    'pw',
    'q',
    'submit-form',
    'nav-bar-home',
  ]) {
    assert.equal(isDynamicAttributeValue(v), false, `human value "${v}" must NOT be flagged dynamic`);
  }
});

test('isDynamicAttributeValue: tolerant of malformed input', () => {
  assert.equal(isDynamicAttributeValue(''), false);
  assert.equal(isDynamicAttributeValue(null), false);
  assert.equal(isDynamicAttributeValue(undefined), false);
  assert.equal(isDynamicAttributeValue(123), false);
});

test('hasDynamicClassFragment: catches trailing hash suffix', () => {
  assert.equal(hasDynamicClassFragment('Button-primary-1a2b3c'), true);
  assert.equal(hasDynamicClassFragment('btn primary jss-abc123'), true);
});

test('hasDynamicClassFragment: passes through stable utility classes', () => {
  assert.equal(hasDynamicClassFragment('btn btn-primary'), false);
  assert.equal(hasDynamicClassFragment('text-lg font-bold'), false);
});

/* -------------------------------------------------------------------------- *
 *  classifySelector                                                          *
 * -------------------------------------------------------------------------- */

test('classifySelector: identifies every supported strategy', () => {
  assert.equal(classifySelector('[data-testid="x"]'), 'data-testid');
  assert.equal(classifySelector('[data-id="x"]'),     'data-attr');
  assert.equal(classifySelector('#login-btn'),        'id');
  assert.equal(classifySelector('[name="email"]'),    'name');
  assert.equal(classifySelector('[aria-label="Close"]'), 'aria-label');
  assert.equal(classifySelector('role=button'),       'role');
  assert.equal(classifySelector('text=Sign in'),      'text');
  assert.equal(classifySelector('[type="submit"]'),   'css-attr');
  assert.equal(classifySelector('button.primary'),    'css');
  assert.equal(classifySelector('xpath=//button[@type="submit"]'), 'xpath-rel');
  assert.equal(classifySelector('xpath=//div[3]/button'), 'xpath-idx');
  assert.equal(classifySelector('xpath=/html/body/div'),  'xpath-abs');
  assert.equal(classifySelector('/html/body/div'),        'xpath-abs');
});

/* -------------------------------------------------------------------------- *
 *  scoreLocator                                                              *
 * -------------------------------------------------------------------------- */

test('scoreLocator: data-testid with stable value gets the top score', () => {
  const r = scoreLocator({ selector: '[data-testid="login-btn"]', unique: true });
  assert.equal(r.strategy, 'data-testid');
  assert.equal(r.score, 100);
});

test('scoreLocator: stable id beats relative xpath', () => {
  const id    = scoreLocator({ selector: '#login', unique: true }).score;
  const xpath = scoreLocator({ selector: 'xpath=//button[@type="submit"]', unique: true }).score;
  assert.ok(id > xpath, `id (${id}) should beat relative xpath (${xpath})`);
});

test('scoreLocator: dynamic value gets gutted (id loses to data-testid)', () => {
  const stableId  = scoreLocator({ selector: '#login-btn', unique: true }).score;
  const dynamicId = scoreLocator({ selector: '#jss123',    unique: true }).score;
  assert.ok(dynamicId < stableId,
    `dynamic id (${dynamicId}) must score below stable id (${stableId})`);
  assert.ok(dynamicId < 50,
    `dynamic id score (${dynamicId}) must drop below 50 so it can never be primary`);
});

test('scoreLocator: ambiguous (multiple matches) is penalised proportionally', () => {
  const unique = scoreLocator({ selector: '#x', unique: true,  count: 1 }).score;
  const dup3   = scoreLocator({ selector: '#x', unique: false, count: 3 }).score;
  const dup10  = scoreLocator({ selector: '#x', unique: false, count: 10 }).score;
  assert.ok(dup3  < unique);
  assert.ok(dup10 < dup3);
});

test('scoreLocator: nth-child gets a fat penalty', () => {
  const without = scoreLocator({ selector: 'div.row > button', unique: true }).score;
  const withNth = scoreLocator({ selector: 'div.row > button:nth-child(3)', unique: true }).score;
  assert.ok(withNth < without, `nth-child variant (${withNth}) must score lower than positional sibling (${without})`);
});

test('scoreLocator: absolute xpath is the lowest-scored strategy', () => {
  const abs = scoreLocator({ selector: 'xpath=/html/body/div/button', unique: true }).score;
  // Even unique, an absolute xpath should be near-bottom of the strategy stack.
  assert.ok(abs <= 10);
});

test('scoreLocator: returns a non-empty reasons trail for debugging', () => {
  const r = scoreLocator({ selector: '#jss123', unique: false, count: 5 });
  assert.ok(Array.isArray(r.reasons));
  assert.ok(r.reasons.length >= 2, 'should record base + at least one penalty');
});

test('scoreLocator: clamps score to [0, 100]', () => {
  const huge = scoreLocator({ selector: '/html/body/div/p/span/em', unique: false, count: 50 });
  assert.ok(huge.score >= 0 && huge.score <= 100);
});

/* -------------------------------------------------------------------------- *
 *  rankCandidates                                                            *
 * -------------------------------------------------------------------------- */

test('rankCandidates: sorts highest-confidence first', () => {
  const ranked = rankCandidates([
    { selector: 'xpath=//button[@type="submit"]', unique: true },
    { selector: '#login-btn',                     unique: true },
    { selector: '[data-testid="login"]',          unique: true },
    { selector: '#jss123',                        unique: true }, // dynamic
  ]);
  assert.equal(ranked[0].selector, '[data-testid="login"]', 'data-testid wins');
  assert.equal(ranked[1].selector, '#login-btn', 'stable id is second');
  // dynamic id and relative xpath fight for last; either order is acceptable
  // as long as both are below the stable candidates.
  assert.ok(ranked[ranked.length - 1].confidence < ranked[0].confidence);
});

test('rankCandidates: preserves original metadata + adds confidence fields', () => {
  const ranked = rankCandidates([
    { selector: '#x', unique: true, customField: 'preserved' },
  ]);
  assert.equal(ranked[0].customField, 'preserved');
  assert.equal(typeof ranked[0].confidence, 'number');
  assert.equal(typeof ranked[0].strategy, 'string');
  assert.ok(Array.isArray(ranked[0].confidenceReasons));
});

test('rankCandidates: tolerates malformed input', () => {
  assert.deepEqual(rankCandidates(null), []);
  assert.deepEqual(rankCandidates(undefined), []);
  assert.deepEqual(rankCandidates('not-an-array'), []);
});
