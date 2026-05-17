/**
 * utils/locatorHealer.js
 *
 * Central self-healing locator module.
 *
 * Responsibilities (mirrors the spec in the task brief):
 *   - validateLocator        : confirm a selector resolves to (state, count) on the page
 *   - healLocator            : walk a primary + fallback chain, prefer unique matches
 *   - findElementWithHealing : public entry — accepts a step, returns the working selector
 *   - getLocator             : extract the full prioritised candidate list from a step
 *   - logLocatorFailure      : structured logger with the canonical [Heal] tag
 *   - saveHealedLocator      : best-effort persistence (delegates to healedLocatorService)
 *
 * Design contract:
 *   - Zero-overhead happy path: when a step has no fallbacks AND no element
 *     metadata to synthesise from, the healer returns the primary unchanged
 *     and the underlying Playwright call (page.click / page.fill / ...)
 *     does its own actionability wait. We do NOT double-validate.
 *   - When fallbacks exist (or can be synthesised): primary is tested with
 *     a short timeout, then each fallback is checked. Fallbacks must be
 *     UNIQUE on the page — multi-match candidates are flagged and skipped
 *     so we never silently click the wrong element.
 *   - Whole-chain exhausted: the original primary is returned so the
 *     caller's existing call throws a Playwright error that names the
 *     selector the user originally recorded (best UX).
 */

import { saveHealRecord } from '../services/healedLocatorService.js';

const TAG = '[Heal]';

const DEFAULT_PRIMARY_TIMEOUT_MS = 4000;
const DEFAULT_FALLBACK_TIMEOUT_MS = 4000;
const NO_FALLBACK_PRIMARY_TIMEOUT_MS = 0; // skip pre-check; underlying call will validate

/* -------------------------------------------------------------------------- *
 *  Logging                                                                   *
 * -------------------------------------------------------------------------- */

/**
 * Structured logger so the messages match the spec exactly.
 *   - "Primary locator failed"
 *   - "Trying healed locator"
 *   - "Healed locator found"
 *   - "Multiple matches found"
 *   - "Locator healing failed"
 *   - "Saved healed locator"
 *
 * @param {'info'|'warn'|'error'} level
 * @param {string} message - canonical short message
 * @param {Object} [details]
 */
export function logLocatorFailure(level, message, details = {}) {
  const fn = level === 'error' ? console.error
    : level === 'warn' ? console.warn
    : console.log;
  if (details && Object.keys(details).length) {
    fn(`${TAG} ${message}`, details);
  } else {
    fn(`${TAG} ${message}`);
  }
}

/* -------------------------------------------------------------------------- *
 *  Candidate extraction                                                      *
 * -------------------------------------------------------------------------- */

function dedupePreservingOrder(arr) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    if (typeof item !== 'string' || !item) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * Synthesise locator candidates from element metadata captured by the recorder
 * (or supplied by hand-crafted steps). These are the *strategies* listed in the
 * spec: data-testid, id, name, aria-label, placeholder, role, visible text.
 * They run as a last-resort tier so we never give up before exhausting the
 * obvious heuristics.
 *
 * @param {Object} element - { id, name, ariaLabel, placeholder, role, text, testid, dataset }
 * @returns {Array<string>}
 */
function synthesiseFromElement(element) {
  if (!element || typeof element !== 'object') return [];
  const out = [];

  const dataset = element.dataset || {};
  const testid = element.testid || dataset.testid || dataset['data-testid'];
  if (testid) out.push(`[data-testid="${cssEscape(testid)}"]`);

  if (element.id) out.push(`#${cssEscape(element.id)}`);
  if (element.name) out.push(`[name="${cssEscape(element.name)}"]`);

  const ariaLabel = element.ariaLabel || element['aria-label'];
  if (ariaLabel) out.push(`[aria-label="${cssEscape(ariaLabel)}"]`);

  if (element.placeholder) out.push(`[placeholder="${cssEscape(element.placeholder)}"]`);

  // Playwright understands role= and text= engines via its locator API.
  if (element.role && element.text) {
    out.push(`role=${element.role}[name="${escapeQuote(element.text.trim())}"]`);
  }
  if (element.text) {
    const t = element.text.trim().slice(0, 80);
    if (t) out.push(`text="${escapeQuote(t)}"`);
  }

  return out;
}

function cssEscape(value) {
  // Escape characters that break CSS attribute selectors. Conservative —
  // safe for ids, data-testids, classes (all ASCII in our corpus).
  return String(value).replace(/(["\\])/g, '\\$1');
}

function escapeQuote(value) {
  return String(value).replace(/"/g, '\\"');
}

/**
 * Return the full prioritised list of locator candidates for a step:
 *   1. step.selector (primary, always first)
 *   2. step.fallbackSelectors[] (in recorded order)
 *   3. step.locatorCandidates[].selector (recorder-ranked alternatives)
 *   4. synthesised from step.element / step.metadata if any of (1-3) missing
 *
 * Duplicates are removed while preserving priority. Empty/non-string entries
 * are dropped.
 *
 * @param {Object} step
 * @returns {Array<string>}
 */
export function getLocator(step) {
  if (!step || typeof step !== 'object') return [];

  const candidates = [];
  if (typeof step.selector === 'string' && step.selector) {
    candidates.push(step.selector);
  }
  if (Array.isArray(step.fallbackSelectors)) {
    for (const s of step.fallbackSelectors) candidates.push(s);
  }
  if (Array.isArray(step.locatorCandidates)) {
    for (const c of step.locatorCandidates) {
      if (!c) continue;
      const s = c.selector || c.value;
      candidates.push(s);
    }
  }
  // Last-resort synthesis from raw element metadata (only added if we don't
  // already have it, since dedupe removes overlaps).
  const metaSource = step.element || step.metadata || step.elementMeta;
  if (metaSource) {
    for (const s of synthesiseFromElement(metaSource)) candidates.push(s);
  }

  return dedupePreservingOrder(candidates);
}

/* -------------------------------------------------------------------------- *
 *  Validation                                                                *
 * -------------------------------------------------------------------------- */

/**
 * Verify a selector resolves on the page.
 *
 * Result shape:
 *   {
 *     ok:      true if the selector passes (and is unique when strictUnique=true)
 *     reason:  'matched' | 'not-found' | 'ambiguous' | 'invalid'
 *     count:   number of matching nodes (best effort; 0 when not found)
 *     error:   only present on failures
 *   }
 *
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {Object} [opts]
 * @param {'visible'|'attached'|'hidden'|'detached'} [opts.state='visible']
 * @param {number} [opts.timeout=4000]
 * @param {boolean} [opts.strictUnique=false] - reject count > 1 with reason='ambiguous'
 * @returns {Promise<{ok: boolean, reason: string, count: number, error?: string}>}
 */
export async function validateLocator(page, selector, opts = {}) {
  const state = opts.state || 'visible';
  const timeout = opts.timeout ?? DEFAULT_PRIMARY_TIMEOUT_MS;
  const strictUnique = !!opts.strictUnique;
  // Lazy-loaded pages (Amazon search, infinite-scroll catalogs, etc.) often
  // have the target node attached but parked far below the fold. Before we
  // demand visibility, nudge the candidate into the viewport. Best-effort:
  // any failure (selector engine doesn't support .scrollIntoViewIfNeeded,
  // candidate doesn't exist yet, etc.) is silently swallowed because the
  // subsequent waitForSelector is the source of truth.
  const scrollFirst = opts.scrollIntoView !== false;

  if (!selector || typeof selector !== 'string') {
    return { ok: false, reason: 'invalid', count: 0, error: 'selector must be a non-empty string' };
  }

  if (scrollFirst && page && page.locator) {
    try {
      await page.locator(selector).first().scrollIntoViewIfNeeded({ timeout: 1000 });
    } catch (_scrollErr) {
      // Element may not be attached yet — waitForSelector below will handle it.
    }
  }

  try {
    await page.waitForSelector(selector, { state, timeout });
  } catch (err) {
    return { ok: false, reason: 'not-found', count: 0, error: err && err.message };
  }

  // Count matches to detect ambiguity. Playwright's .count() ignores state
  // (it counts attached nodes), which is what we want for ambiguity detection.
  let count = 1;
  try {
    count = await page.locator(selector).count();
  } catch (err) {
    // Some Playwright text= / role= engines may not support .count() in older
    // builds. If counting fails, assume unique to keep behaviour permissive.
    count = 1;
  }

  if (strictUnique && count > 1) {
    return { ok: false, reason: 'ambiguous', count };
  }
  return { ok: true, reason: 'matched', count };
}

/* -------------------------------------------------------------------------- *
 *  Healing chain                                                             *
 * -------------------------------------------------------------------------- */

/**
 * Walk primary + fallback list. Primary is permissive (any count > 0 in state),
 * fallbacks are strict (must be unique).
 *
 * @returns {Promise<{
 *   selector: string,
 *   healed: boolean,
 *   primarySelector: string,
 *   healedVia: string|null,
 *   exhausted: boolean,
 *   reason: string|null,
 *   attempts: Array<{selector: string, role: 'primary'|'fallback', ok: boolean, reason: string, count: number, error?: string}>
 * }>}
 */
export async function healLocator(page, primary, fallbacks, opts = {}) {
  const state = opts.state || 'visible';
  const primaryTimeout = opts.primaryTimeout ?? DEFAULT_PRIMARY_TIMEOUT_MS;
  const fallbackTimeout = opts.fallbackTimeout ?? DEFAULT_FALLBACK_TIMEOUT_MS;

  const attempts = [];

  // 1) Primary attempt — permissive (no uniqueness enforcement so we don't
  // change behaviour for steps whose primary intentionally targets a list).
  const primaryResult = await validateLocator(page, primary, { state, timeout: primaryTimeout });
  attempts.push({ selector: primary, role: 'primary', ...primaryResult });
  if (primaryResult.ok) {
    return {
      selector: primary,
      healed: false,
      primarySelector: primary,
      healedVia: null,
      exhausted: false,
      reason: 'primary-ok',
      attempts,
    };
  }

  logLocatorFailure('warn', 'Primary locator failed', {
    primary,
    reason: primaryResult.reason,
  });

  // 2) Fallback walk — strict uniqueness so we never click the wrong row.
  const fallbackList = dedupePreservingOrder(fallbacks).filter((s) => s !== primary);
  let ambiguousSeen = false;

  for (const candidate of fallbackList) {
    logLocatorFailure('info', 'Trying healed locator', { candidate });
    const result = await validateLocator(page, candidate, {
      state,
      timeout: fallbackTimeout,
      strictUnique: true,
    });
    attempts.push({ selector: candidate, role: 'fallback', ...result });

    if (result.ok) {
      logLocatorFailure('info', 'Healed locator found', {
        primary,
        healedVia: candidate,
        count: result.count,
      });
      return {
        selector: candidate,
        healed: true,
        primarySelector: primary,
        healedVia: candidate,
        exhausted: false,
        reason: 'healed',
        attempts,
      };
    }

    if (result.reason === 'ambiguous') {
      ambiguousSeen = true;
      logLocatorFailure('warn', 'Multiple matches found — skipping ambiguous candidate', {
        candidate,
        count: result.count,
      });
    }
  }

  // ─── T3.1 — AI fallback at replay time ──────────────────────────
  // If the deterministic chain is exhausted AND a local AI provider is
  // available, ask it for one more selector. Strictly opt-in via
  // opts.allowAi (default true at the wiring site, but unit tests pass
  // false to keep them deterministic). The AI call is bounded by
  // aiService's own timeout; here we ALSO bound the page snippet we
  // send so the model sees enough context without DOMs blowing past
  // the 8 KB prompt budget.
  if (opts.allowAi !== false) {
    try {
      const { getAiProvider } = await import('../services/aiService.js');
      const ai = await getAiProvider();
      if (ai && ai.available && ai.available()) {
        // Grab a small HTML snippet centred on what's currently in viewport.
        let htmlSnippet = '';
        try {
          htmlSnippet = await page.evaluate(() => {
            const root = document.body || document.documentElement;
            return (root && root.outerHTML ? root.outerHTML : '').slice(0, 8000);
          });
        } catch (_snipErr) { /* best-effort */ }
        logLocatorFailure('info', 'Trying AI-suggested locator', { primary });
        const aiResp = await ai.suggestLocator({
          failedSelector: primary,
          elementHint: opts.elementHint || '',
          htmlSnippet,
        }).catch((e) => ({ ok: false, reason: e.message }));
        const aiSel = aiResp && aiResp.ok && aiResp.suggestion;
        if (aiSel) {
          const aiCheck = await validateLocator(page, aiSel, {
            state, timeout: fallbackTimeout, strictUnique: true,
          });
          attempts.push({ selector: aiSel, role: 'ai', ...aiCheck, confidence: aiResp.confidence });
          if (aiCheck.ok) {
            logLocatorFailure('info', 'Healed locator found (via AI)', {
              primary, healedVia: aiSel, confidence: aiResp.confidence,
            });
            return {
              selector: aiSel,
              healed: true,
              primarySelector: primary,
              healedVia: aiSel,
              exhausted: false,
              reason: 'healed-ai',
              healingSource: 'ai',
              attempts,
            };
          }
        }
      }
    } catch (aiErr) {
      logLocatorFailure('warn', 'AI fallback failed', { error: aiErr.message });
    }
  }

  // 3) Whole chain exhausted. Report a clear, structured failure but return
  //    the primary so the caller's underlying Playwright call throws an error
  //    that names the original recorded selector (preserves error UX).
  const failReason = ambiguousSeen ? 'all-candidates-ambiguous-or-missing' : 'all-candidates-missing';
  logLocatorFailure('error', 'Locator healing failed', {
    primary,
    fallbacksTried: fallbackList.length,
    reason: failReason,
    attempts,
  });

  return {
    selector: primary,
    healed: false,
    primarySelector: primary,
    healedVia: null,
    exhausted: true,
    reason: failReason,
    attempts,
  };
}

/* -------------------------------------------------------------------------- *
 *  Public entry — what step handlers call                                    *
 * -------------------------------------------------------------------------- */

/**
 * Resolve the working selector for a step, healing through fallbacks when the
 * primary is broken. This is the function step handlers should call.
 *
 * Behaviour summary:
 *   - 0 fallbacks AND no element metadata → primary returned unchanged
 *     (zero overhead — underlying Playwright call does its own wait).
 *   - 1+ candidates → primary checked, then each candidate checked with
 *     uniqueness enforcement.
 *
 * @param {import('playwright').Page} page
 * @param {Object} step - the recorded step
 * @param {Object} [opts]
 * @param {'visible'|'attached'} [opts.state='visible']
 * @returns {Promise<ReturnType<typeof healLocator>>}
 */
export async function findElementWithHealing(page, step, opts = {}) {
  const candidates = getLocator(step);
  if (candidates.length === 0) {
    return {
      selector: step?.selector,
      healed: false,
      primarySelector: step?.selector,
      healedVia: null,
      exhausted: false,
      reason: 'no-selector',
      attempts: [],
    };
  }
  const primary = candidates[0];
  const fallbacks = candidates.slice(1);

  if (fallbacks.length === 0) {
    // Nothing to heal with. Hand primary back; Playwright's own actionability
    // wait will surface any failure with the recorded selector verbatim.
    return {
      selector: primary,
      healed: false,
      primarySelector: primary,
      healedVia: null,
      exhausted: false,
      reason: 'no-fallbacks',
      attempts: [],
    };
  }

  return healLocator(page, primary, fallbacks, opts);
}

/* -------------------------------------------------------------------------- *
 *  Persistence shim                                                          *
 * -------------------------------------------------------------------------- */

/**
 * Persist a heal event to the project's healed-locators.json. Best-effort —
 * any I/O error is logged but never thrown so a heal-and-save failure can't
 * abort an otherwise green test.
 *
 * @param {Object} record
 * @param {string} record.projectName
 * @param {string} [record.pageName]
 * @param {string} [record.elementName]
 * @param {string} record.primarySelector
 * @param {string} record.healedSelector
 * @param {string} [record.reason]
 * @param {Array}  [record.attempts]
 * @returns {Promise<{ok: boolean, file?: string, error?: string}>}
 */
export async function saveHealedLocator(record) {
  if (!record || !record.projectName || !record.primarySelector || !record.healedSelector) {
    return { ok: false, error: 'projectName, primarySelector and healedSelector are required' };
  }
  try {
    const result = await saveHealRecord(record.projectName, {
      pageName: record.pageName || null,
      elementName: record.elementName || null,
      primarySelector: record.primarySelector,
      healedSelector: record.healedSelector,
      reason: record.reason || 'healed',
      attempts: Array.isArray(record.attempts) ? record.attempts : [],
      timestamp: new Date().toISOString(),
    });
    logLocatorFailure('info', 'Saved healed locator', { file: result.file });
    return { ok: true, file: result.file };
  } catch (err) {
    logLocatorFailure('warn', 'Saved healed locator FAILED (non-fatal)', { error: err.message });
    return { ok: false, error: err.message };
  }
}
