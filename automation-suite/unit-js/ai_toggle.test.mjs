/**
 * Unit tests for services/aiService.js#setAiProvider — the runtime
 * AI on/off switch surfaced by the dashboard.
 *
 * Hard contracts under test:
 *   1. mode='off'   → installs NullProvider, available() === false.
 *   2. mode='on'    → tries Ollama; if not reachable, returns
 *                     { ok:false, reason } and stays on NullProvider
 *                     (NEVER throws — UI must be able to render the
 *                     reason as a toast).
 *   3. mode='auto'  → drops cached provider, re-runs auto-detect.
 *   4. unknown mode → returns { ok:false, reason } with a usage hint.
 *   5. The toggled provider persists for subsequent getAiProvider() calls.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  setAiProvider,
  getAiProvider,
  _resetProviderForTests,
} from '../../services/aiService.js';

test('setAiProvider("off"): installs NullProvider deterministically', async () => {
  _resetProviderForTests();
  const r = await setAiProvider('off');
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'off');
  assert.equal(r.info.provider, 'null');
  // Subsequent getAiProvider() must return the same NullProvider.
  const p = await getAiProvider();
  assert.equal(p.available(), false);
  assert.equal(p.info().provider, 'null');
  _resetProviderForTests();
});

test('setAiProvider("on") with no Ollama: returns ok:false + clear reason', async () => {
  // We can't guarantee the test environment has Ollama. If the host has
  // no Ollama on 11434, this is the path under test. If it does, this
  // test is still valid — the contract is "always returns 200, with a
  // structured ok flag". We just relax the ok==false assertion.
  _resetProviderForTests();
  const r = await setAiProvider('on');
  if (r.ok) {
    // Ollama IS running on the host — verify the success-path shape.
    assert.equal(r.mode, 'on');
    assert.equal(r.info.provider, 'ollama');
  } else {
    // Ollama is NOT running — this is the failure path.
    assert.equal(r.mode, 'on');
    assert.equal(r.info.provider, 'null',
      'failed-on must fall back to NullProvider');
    assert.match(r.reason, /Ollama|brew install/);
  }
  _resetProviderForTests();
});

test('setAiProvider("auto"): re-runs detection, returns current state', async () => {
  _resetProviderForTests();
  const r = await setAiProvider('auto');
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'auto');
  // info.provider is either 'ollama' (if installed) or 'null'.
  assert.ok(['ollama', 'null'].includes(r.info.provider));
  _resetProviderForTests();
});

test('setAiProvider("garbage"): rejects with reason + usage hint', async () => {
  _resetProviderForTests();
  const r = await setAiProvider('garbage-mode');
  assert.equal(r.ok, false);
  assert.match(r.reason, /on\|off\|auto/);
  _resetProviderForTests();
});

test('setAiProvider: empty / null / undefined modes all rejected gracefully', async () => {
  _resetProviderForTests();
  for (const v of [null, undefined, '', 0, false]) {
    const r = await setAiProvider(v);
    assert.equal(r.ok, false, `mode=${JSON.stringify(v)} should be rejected`);
  }
  _resetProviderForTests();
});

test('setAiProvider: off → on → off survives the round trip', async () => {
  _resetProviderForTests();
  await setAiProvider('off');
  let p = await getAiProvider();
  assert.equal(p.info().provider, 'null');

  await setAiProvider('on'); // may or may not succeed depending on env

  await setAiProvider('off');
  p = await getAiProvider();
  assert.equal(p.info().provider, 'null',
    'final state must be null after the off toggle');
  _resetProviderForTests();
});
