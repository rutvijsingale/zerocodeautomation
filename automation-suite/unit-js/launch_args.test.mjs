/**
 * Unit tests for the rerun browser-launch-arg builder.
 *
 * Hard contract under test:
 *   - In headed mode, Chromium / Edge MUST receive `--start-maximized`
 *     so reruns open the same window size the recorder used. Without it
 *     the rerun browser opens at 800x600 and modern responsive UIs
 *     (Amazon header, sticky nav) silently mis-render — see PROD-0002.
 *   - Firefox / WebKit ignore the flag, so we MUST NOT pass it (avoids
 *     a "unrecognized arg" warning in the Playwright launcher).
 *   - Headless mode never gets the flag (there's no window to maximize).
 *   - The base flags (`--no-sandbox`, `--disable-setuid-sandbox`) are
 *     always present for CI/sandboxed environments.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { __testables } from '../../routes/api.js';
const { buildRerunLaunchArgs } = __testables;

test('buildRerunLaunchArgs: headed chromium gets --start-maximized', () => {
  const args = buildRerunLaunchArgs('chromium', false);
  assert.ok(args.includes('--start-maximized'),
    `chromium headed must include --start-maximized, got: ${args.join(' ')}`);
  assert.ok(args.includes('--no-sandbox'));
  assert.ok(args.includes('--disable-setuid-sandbox'));
});

test('buildRerunLaunchArgs: headed edge gets --start-maximized', () => {
  const args = buildRerunLaunchArgs('edge', false);
  assert.ok(args.includes('--start-maximized'),
    `edge headed must include --start-maximized, got: ${args.join(' ')}`);
});

test('buildRerunLaunchArgs: headed firefox does NOT get --start-maximized', () => {
  const args = buildRerunLaunchArgs('firefox', false);
  assert.equal(args.includes('--start-maximized'), false,
    'firefox does not honor --start-maximized; passing it pollutes logs');
  assert.ok(args.includes('--no-sandbox'));
});

test('buildRerunLaunchArgs: headed webkit does NOT get --start-maximized', () => {
  const args = buildRerunLaunchArgs('webkit', false);
  assert.equal(args.includes('--start-maximized'), false);
});

test('buildRerunLaunchArgs: headless chromium does NOT get --start-maximized', () => {
  const args = buildRerunLaunchArgs('chromium', true);
  assert.equal(args.includes('--start-maximized'), false,
    'no window in headless mode; flag is meaningless and noisy');
});

test('buildRerunLaunchArgs: headless edge does NOT get --start-maximized', () => {
  const args = buildRerunLaunchArgs('edge', true);
  assert.equal(args.includes('--start-maximized'), false);
});

test('buildRerunLaunchArgs: base sandbox flags are always present', () => {
  for (const browser of ['chromium', 'firefox', 'webkit', 'edge']) {
    for (const headless of [true, false]) {
      const args = buildRerunLaunchArgs(browser, headless);
      assert.ok(args.includes('--no-sandbox'),
        `${browser} ${headless ? 'headless' : 'headed'} missing --no-sandbox`);
      assert.ok(args.includes('--disable-setuid-sandbox'),
        `${browser} ${headless ? 'headless' : 'headed'} missing --disable-setuid-sandbox`);
    }
  }
});
