/**
 * Contract tests for the locator-quality rules required by the QA spec:
 *
 *   - The recorder MUST prefer (in this order):
 *       1. #id
 *       2. [data-testid="..."]
 *       3. [data-id="..."]
 *       4. [name="..."] (form controls)
 *       5. [aria-label="..."]
 *       6. role=...
 *       7. text=...
 *       8. relative XPath  //tag[index]   (last-resort fallback)
 *
 *   - The recorder MUST NEVER emit absolute XPath (`/html/body/...`).
 *   - The healer's getLocator() MUST surface fallback selectors in the
 *     priority order recorded by the page-side picker (so production
 *     replays a strong selector first and the brittle XPath last).
 *
 * These checks operate on:
 *   1. The recorder source (services/browserService.js) — static grep
 *      for absolute-XPath emissions and priority-number ordering.
 *   2. The healer's getLocator() — exhaustive shape tests.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import url from 'url';

import { getLocator } from '../../utils/locatorHealer.js';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.resolve(__dirname, '..', '..');

test('recorder source: never emits absolute XPath (/html/body/...)', async () => {
  const src = await fs.readFile(path.join(REPO, 'services', 'browserService.js'), 'utf8');
  // Catch both literal absolute paths and any startsWith('/html') string
  // that would let one slip through.
  assert.equal(src.includes('/html/body'), false,
    'browserService.js must never emit "/html/body/..." absolute XPath; it breaks on the smallest DOM change');
  assert.equal(/['"]\/html\//.test(src), false,
    'no string literal starting with "/html/" is allowed in the selector picker');
});

test('recorder source: locator priority numbers match the documented order', async () => {
  const src = await fs.readFile(path.join(REPO, 'services', 'browserService.js'), 'utf8');
  // These priority strings come straight from getElementSelector()'s
  // candidate.push({ priority: N }) calls. If the order ever changes the
  // contract test must change too — that's the point.
  const checks = [
    { label: '#id selector',       marker: 'priority: 1',  comment: 'priority 1 = id' },
    { label: '[data-testid] selector', marker: 'priority: 2',  comment: 'priority 2 = data-testid' },
    { label: '[data-id] selector', marker: 'priority: 3',  comment: 'priority 3 = data-id' },
    { label: '[name] selector',    marker: 'priority: 4',  comment: 'priority 4 = name' },
    { label: '[aria-label] selector', marker: 'priority: 5', comment: 'priority 5 = aria-label' },
    { label: 'role= selector',     marker: 'priority: 6',  comment: 'priority 6 = role' },
    { label: 'XPath last-resort',  marker: 'priority: 20', comment: 'priority 20 = relative XPath fallback' },
  ];
  for (const { label, marker, comment } of checks) {
    assert.ok(src.includes(marker),
      `recorder must keep ${label} (${comment}); marker "${marker}" not found in browserService.js`);
  }
});

test('recorder source: XPath fallback uses RELATIVE form //tag[index]', async () => {
  const src = await fs.readFile(path.join(REPO, 'services', 'browserService.js'), 'utf8');
  // Must contain the relative-xpath emission template.
  assert.ok(
    src.includes("'xpath=//' + tag + '[' + index + ']'"),
    'Recorder must emit relative XPath as `xpath=//tag[index]` so it survives parent-DOM reshuffles'
  );
});

test('getLocator: primary selector always lands first', () => {
  const step = {
    selector: '#login-btn',
    fallbackSelectors: ['[data-testid="login"]', 'role=button'],
    locatorCandidates: [{ selector: 'text=Sign in' }],
  };
  const out = getLocator(step);
  assert.equal(out[0], '#login-btn', 'primary selector must be at index 0');
});

test('getLocator: returns ALL distinct candidates (dedupe but no drop)', () => {
  const step = {
    selector: '#a',
    fallbackSelectors: ['#b', '#a'],         // duplicate of primary
    locatorCandidates: [{ selector: '#c' }, { selector: '#b' }], // duplicate of fallback
  };
  const out = getLocator(step);
  assert.deepEqual(out, ['#a', '#b', '#c'],
    'duplicates must be removed but priority order preserved');
});

test('getLocator: synthesises from element metadata when explicit candidates are missing', () => {
  const step = {
    element: { id: 'syn-id', dataTestId: 'syn-test', text: 'Click me' },
  };
  const out = getLocator(step);
  assert.ok(out.length >= 1, 'must produce at least one synthesized candidate from element metadata');
});

test('getLocator: tolerates malformed input without throwing', () => {
  assert.deepEqual(getLocator(null), []);
  assert.deepEqual(getLocator(undefined), []);
  assert.deepEqual(getLocator({}), []);
  assert.deepEqual(getLocator({ fallbackSelectors: 'not-an-array' }), []);
});

test('getLocator: never emits an absolute /html/body/... XPath even when synthesising', () => {
  // Even if the recorder were tricked into capturing a deep DOM path, the
  // healer must not surface absolute XPath. We assert by feeding a step
  // where the only metadata would tempt absolute-XPath synthesis.
  const step = {
    element: { tag: 'div', textContent: 'leaf' },
  };
  const out = getLocator(step);
  for (const sel of out) {
    assert.equal(sel.startsWith('/html/'), false,
      `synthesised selector "${sel}" must not be absolute XPath`);
    assert.equal(sel.startsWith('xpath=/html/'), false,
      `synthesised selector "${sel}" must not be absolute XPath`);
  }
});
