/**
 * Unit tests for services/aiService.js.
 *
 * We don't spin up a real Ollama instance; the heavy machinery (HTTP
 * to localhost:11434) is exercised in integration tests when the user
 * has Ollama installed. Here we cover:
 *   - the response parser (extractSelectorFromResponse) — deterministic
 *   - the explicit-disable path (ZAC_AI_PROVIDER=null) — deterministic
 *   - the test-mock injection (_setProviderForTests) — deterministic
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractSelectorFromResponse,
  getAiProvider,
  _setProviderForTests,
  _resetProviderForTests,
} from '../../services/aiService.js';

/* -------------------------------------------------------------------------- *
 *  Response parser                                                           *
 * -------------------------------------------------------------------------- */

test('extractSelectorFromResponse: pulls a bare selector unchanged', () => {
  assert.equal(extractSelectorFromResponse('[data-testid="login-btn"]'),
    '[data-testid="login-btn"]');
});

test('extractSelectorFromResponse: strips markdown fences', () => {
  const raw = '```css\n#login-btn\n```';
  assert.equal(extractSelectorFromResponse(raw), '#login-btn');
});

test('extractSelectorFromResponse: strips quotes', () => {
  assert.equal(extractSelectorFromResponse('"#login"'), '#login');
  assert.equal(extractSelectorFromResponse("'[name=\"q\"]'"),
    '[name="q"]');
});

test('extractSelectorFromResponse: strips "selector:" preamble', () => {
  assert.equal(extractSelectorFromResponse('selector: #login'), '#login');
  assert.equal(extractSelectorFromResponse('Selector = role=button'), 'role=button');
  assert.equal(extractSelectorFromResponse('The selector is: #x'), '#x');
});

test('extractSelectorFromResponse: takes the first selector-shaped line', () => {
  const raw = `Sure, here it is:

#login-btn

That should work.`;
  assert.equal(extractSelectorFromResponse(raw), '#login-btn');
});

test('extractSelectorFromResponse: returns null for non-selector responses', () => {
  assert.equal(extractSelectorFromResponse(''), null);
  assert.equal(extractSelectorFromResponse(null), null);
  assert.equal(extractSelectorFromResponse(undefined), null);
  assert.equal(extractSelectorFromResponse('I don\'t know'), null);
  assert.equal(extractSelectorFromResponse('Sorry, no idea'), null);
});

test('extractSelectorFromResponse: accepts XPath-shaped responses', () => {
  assert.equal(extractSelectorFromResponse('//button[@type="submit"]'),
    '//button[@type="submit"]');
  assert.equal(extractSelectorFromResponse('xpath=//div[@id="x"]'),
    'xpath=//div[@id="x"]');
});

test('extractSelectorFromResponse: accepts text= and role= Playwright shorthands', () => {
  assert.equal(extractSelectorFromResponse('text=Sign in'), 'text=Sign in');
  assert.equal(extractSelectorFromResponse('role=button'), 'role=button');
});

/* -------------------------------------------------------------------------- *
 *  Provider selection                                                        *
 * -------------------------------------------------------------------------- */

test('getAiProvider: ZAC_AI_PROVIDER=null returns NullProvider deterministically', async () => {
  _resetProviderForTests();
  const prev = process.env.ZAC_AI_PROVIDER;
  process.env.ZAC_AI_PROVIDER = 'null';
  try {
    const p = await getAiProvider();
    assert.equal(p.available(), false);
    assert.equal(p.info().provider, 'null');
    const r = await p.suggestLocator({ failedSelector: '#x' });
    assert.equal(r.ok, false);
    assert.equal(r.suggestion, null);
  } finally {
    if (prev === undefined) delete process.env.ZAC_AI_PROVIDER;
    else process.env.ZAC_AI_PROVIDER = prev;
    _resetProviderForTests();
  }
});

test('_setProviderForTests: lets tests inject a deterministic mock', async () => {
  _setProviderForTests({
    available: () => true,
    info: () => ({ provider: 'mock', model: 'fake', baseUrl: null }),
    suggestLocator: async () => ({
      ok: true,
      suggestion: '[data-testid="healed-by-mock"]',
      confidence: 99,
      raw: '[data-testid="healed-by-mock"]',
    }),
  });
  try {
    const p = await getAiProvider();
    assert.equal(p.available(), true);
    assert.equal(p.info().provider, 'mock');
    const r = await p.suggestLocator({ failedSelector: '#stale' });
    assert.equal(r.ok, true);
    assert.equal(r.suggestion, '[data-testid="healed-by-mock"]');
  } finally {
    _resetProviderForTests();
  }
});
