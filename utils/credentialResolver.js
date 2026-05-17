/**
 * utils/credentialResolver.js
 *
 * Resolves `${ENV_VAR}` placeholders inside step values to actual values
 * from `process.env` at execution time. Mirrors the contract used by the
 * generated Java step defs (`support.CredentialsHelper.resolve(...)`).
 *
 * Why this exists:
 *   The recorder stores credential placeholders as the *literal* string
 *   "${AMAZON_USERNAME}" so no real secret is ever written to disk in
 *   `recorded-steps.json`, `metadata.json`, or any rerun report. At
 *   /api/rerun time we must substitute them back, otherwise the rerun
 *   types the literal placeholder into the form field.
 *
 * Security:
 *   - When a placeholder cannot be resolved (env var unset), throw a
 *     clear, actionable error. NEVER swallow it or fall back to typing
 *     the placeholder verbatim.
 *   - `maskSecret(value)` redacts resolved secrets for logs / replay
 *     reports. Resolved values must NEVER be stored back onto the step.
 *   - The resolver is idempotent: a string with no `${...}` segment is
 *     returned unchanged.
 */

// Matches `${VAR_NAME}` (UPPERCASE_WITH_UNDERSCORES). We deliberately do not
// support `$VAR` (no braces) to avoid accidental matches inside CSS/XPath.
//
// IMPORTANT: do NOT make this a module-level `/g` regex shared between
// callers — `RegExp.test()` on a global regex is *stateful* (it advances
// `lastIndex`), which silently returns wrong answers when called twice on
// the same input. We use a non-global regex for membership checks and
// build a fresh `/g` regex per `replace()` call.
const PLACEHOLDER_RE_TEST = /\$\{[A-Z][A-Z0-9_]*\}/;

/**
 * @param {*} value
 * @returns {boolean} true when the input is a string that contains at
 *   least one `${VAR}` placeholder.
 */
export function isCredentialPlaceholder(value) {
  return typeof value === 'string' && PLACEHOLDER_RE_TEST.test(value);
}

/**
 * Resolve `${VAR}` placeholders in a string against `process.env`.
 * Non-strings are returned untouched.
 *
 * @param {*} value      raw value from the recorded step
 * @param {Object} [opts]
 * @param {Object} [opts.env]      env source (defaults to process.env)
 * @param {string} [opts.context]  short label used in error messages
 *                                 (e.g. "step.value for #ap_email")
 * @returns {string}
 * @throws {Error} when a placeholder references an env var that is
 *   missing or empty. The error message names the variable so the user
 *   can fix it; it never echoes the partial substitution.
 */
export function resolveCredentialPlaceholders(value, opts = {}) {
  if (typeof value !== 'string') return value;
  if (!PLACEHOLDER_RE_TEST.test(value)) return value;

  const env = opts.env || process.env;
  const context = opts.context ? ` (${opts.context})` : '';

  const missing = [];
  const out = value.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_full, name) => {
    const v = env[name];
    if (v === undefined || v === null || v === '') {
      missing.push(name);
      return _full;
    }
    return String(v);
  });

  if (missing.length > 0) {
    const err = new Error(
      `Missing required environment variable(s): ${missing.join(', ')}${context}. ` +
      `Set them in your shell before rerun, e.g.  export ${missing[0]}='...'`
    );
    err.code = 'MISSING_ENV_VAR';
    err.missing = missing;
    throw err;
  }
  return out;
}

/**
 * Mask a resolved secret for safe logging. Returns "***" for any
 * non-empty string, the literal "" for empty, and JSON.stringify-able
 * placeholder text untouched (so logs that include unresolved
 * `${AMAZON_PASSWORD}` strings remain debuggable).
 *
 * @param {*} value
 * @returns {string}
 */
export function maskSecret(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return '***';
  if (value === '') return '';
  if (isCredentialPlaceholder(value)) return value; // unresolved — keep visible
  return '***';
}
