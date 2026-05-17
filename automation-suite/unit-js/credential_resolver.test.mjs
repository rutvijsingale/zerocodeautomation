/**
 * Unit tests for utils/credentialResolver.js.
 *
 * Hard contract under test:
 *   - "${VAR}" placeholders in step values are resolved from process.env
 *     at runtime so the rerun engine types the actual secret, not the
 *     literal placeholder string.
 *   - Missing env vars throw a clear MISSING_ENV_VAR error naming the
 *     variable. The error never echoes a partial substitution.
 *   - maskSecret() redacts resolved secrets but keeps unresolved
 *     placeholders visible (they aren't secrets — they're debug clues).
 *   - Non-string values pass through unchanged.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCredentialPlaceholders,
  isCredentialPlaceholder,
  maskSecret,
} from '../../utils/credentialResolver.js';

test('resolveCredentialPlaceholders: substitutes single env var', () => {
  const out = resolveCredentialPlaceholders('${TEST_USERNAME}', {
    env: { TEST_USERNAME: 'rutvij@example.com' },
  });
  assert.equal(out, 'rutvij@example.com');
});

test('resolveCredentialPlaceholders: substitutes multiple placeholders in one string', () => {
  const out = resolveCredentialPlaceholders('${A} and ${B}', {
    env: { A: 'first', B: 'second' },
  });
  assert.equal(out, 'first and second');
});

test('resolveCredentialPlaceholders: throws MISSING_ENV_VAR with a clear message', () => {
  let err;
  try {
    resolveCredentialPlaceholders('${MISSING_ONE}', { env: {} });
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'Expected an error to be thrown');
  assert.equal(err.code, 'MISSING_ENV_VAR');
  assert.deepEqual(err.missing, ['MISSING_ONE']);
  assert.match(err.message, /MISSING_ONE/);
  assert.match(err.message, /export MISSING_ONE/);
});

test('resolveCredentialPlaceholders: empty string env value is treated as missing', () => {
  let err;
  try {
    resolveCredentialPlaceholders('${EMPTY_VAR}', { env: { EMPTY_VAR: '' } });
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'Empty env var must be treated as missing');
  assert.equal(err.code, 'MISSING_ENV_VAR');
});

test('resolveCredentialPlaceholders: collects ALL missing vars in one pass', () => {
  let err;
  try {
    resolveCredentialPlaceholders('${A}_${B}_${C}', { env: { B: 'set' } });
  } catch (e) {
    err = e;
  }
  assert.ok(err);
  assert.deepEqual(err.missing.sort(), ['A', 'C']);
});

test('resolveCredentialPlaceholders: returns plain strings unchanged', () => {
  assert.equal(
    resolveCredentialPlaceholders('Sony WH-CH520', { env: {} }),
    'Sony WH-CH520'
  );
});

test('resolveCredentialPlaceholders: passes through non-strings', () => {
  assert.equal(resolveCredentialPlaceholders(undefined, { env: {} }), undefined);
  assert.equal(resolveCredentialPlaceholders(null, { env: {} }), null);
  assert.equal(resolveCredentialPlaceholders(42, { env: {} }), 42);
  assert.deepEqual(resolveCredentialPlaceholders({ a: 1 }, { env: {} }), { a: 1 });
});

test('resolveCredentialPlaceholders: ignores `$VAR` (no braces)', () => {
  // $AMAZON_USERNAME (without braces) commonly appears inside CSS / XPath
  // patterns. We deliberately do not interpolate it so it survives intact.
  const out = resolveCredentialPlaceholders('$AMAZON_USERNAME', {
    env: { AMAZON_USERNAME: 'leaked' },
  });
  assert.equal(out, '$AMAZON_USERNAME');
});

test('isCredentialPlaceholder: detects the ${VAR} pattern', () => {
  assert.equal(isCredentialPlaceholder('${AMAZON_USERNAME}'), true);
  assert.equal(isCredentialPlaceholder('hello ${X} world'), true);
  assert.equal(isCredentialPlaceholder('plain text'), false);
  assert.equal(isCredentialPlaceholder(''), false);
  assert.equal(isCredentialPlaceholder(null), false);
  assert.equal(isCredentialPlaceholder(undefined), false);
  assert.equal(isCredentialPlaceholder(123), false);
});

test('maskSecret: redacts resolved values but preserves unresolved placeholders', () => {
  assert.equal(maskSecret('superSecret123!'), '***');
  assert.equal(maskSecret('${AMAZON_PASSWORD}'), '${AMAZON_PASSWORD}',
    'unresolved placeholder is debug-helpful — keep it visible');
  assert.equal(maskSecret(''), '');
  assert.equal(maskSecret(null), '');
  assert.equal(maskSecret(undefined), '');
});

test('end-to-end: typing a placeholder in production env yields the real secret', () => {
  const env = {
    AMAZON_USERNAME: 'rutvij@example.com',
    AMAZON_PASSWORD: 'sup3r-s3cret',
  };
  // Stage 1: recorder stores placeholders, never the real values.
  const recordedTypeStep = { kind: 'type', value: '${AMAZON_PASSWORD}' };
  assert.ok(isCredentialPlaceholder(recordedTypeStep.value));
  assert.equal(JSON.stringify(recordedTypeStep).includes('sup3r-s3cret'), false,
    'recorded step must NEVER contain the real secret');
  // Stage 2: rerun resolves at execution time.
  const typed = resolveCredentialPlaceholders(recordedTypeStep.value, { env });
  assert.equal(typed, 'sup3r-s3cret');
  // Stage 3: log line uses the masked form.
  assert.equal(maskSecret(typed), '***');
});
