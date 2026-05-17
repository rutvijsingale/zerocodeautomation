/**
 * utils/locatorQuality.js
 *
 * Two pure-JS utilities used by:
 *   - the recorder   (server-side post-processing of locator candidates)
 *   - the healer     (when scoring fallback chains)
 *   - the AI service (deciding whether to ask the LLM at all)
 *   - the dashboard  (locator-stability report)
 *
 * 1. isDynamicAttributeValue(value)
 *    Heuristic detector for attribute values that are clearly generated
 *    at build/runtime (CSS-in-JS hashes, framework auto-ids, GUIDs).
 *    Such values change every release and any selector built from them is
 *    inherently brittle — we filter them out of the candidate pool.
 *
 * 2. scoreLocator(candidate)
 *    Returns a 0-100 confidence score combining:
 *      - strategy priority (id, data-testid, aria, role, text, xpath…)
 *      - uniqueness on the page
 *      - dynamic-attribute penalty
 *      - structural penalty (nth-child, deep-descendant)
 *
 * Both functions are intentionally pure so they can run inside the
 * page-context recorder, the Node healer, and the dashboard aggregator
 * without coupling to Playwright internals.
 */

/* -------------------------------------------------------------------------- *
 *  Dynamic-attribute detection                                               *
 * -------------------------------------------------------------------------- */

// Patterns that indicate a value was produced by a build pipeline rather
// than written by a human. Hits → the value will almost certainly change.
//
// Tuning rationale:
//   - Patterns must catch real-world hashes (jss123, css-1a2b3c, GUIDs)
//     while NOT touching legitimate human values like "login-btn",
//     "submit-form", "username", "q".
//   - For mixed-case alphanumeric strings, "looks like a hash" means
//     "contains BOTH letters and digits and has no dashes/underscores"
//     — that pattern almost never appears in human-written ids.
const DYNAMIC_PATTERNS = [
  // GUID / UUID v1-v5  (case-insensitive)
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  // CSS-in-JS hash prefix + trailing alphanumerics ≥3:  jss123, css-1a2b,
  // MuiButton-abc123, emotion_xyz123. Trailing chunk must contain at
  // least one digit so we don't catch "css-primary" or "mui-button".
  /^(?:jss|css|sc|emotion|mui|chakra)[-_]?(?=[a-z0-9]*\d)[a-z0-9]{3,}$/i,
  // Long hex hash (8+ chars all hex) — webpack module ids, radix ids
  /^[a-f0-9]{8,}$/i,
  // Underscore-prefixed alphanumeric soup:  _abc123, _R_5, __next_xyz
  /^_+[a-zA-Z0-9_]{3,}$/,
  // React 18 useId pattern :r0:, :r1:, :Rabc:
  /^:[rR][a-z0-9]+:$/,
  // Numeric-only id of length ≥4 (auto-incremented form ids)
  /^[0-9]{4,}$/,
  // Random-looking mixed-case alphanumerics ≥10 chars with NO separators
  // AND containing both letters and digits — strong "this is a hash" signal.
  /^(?=[a-zA-Z0-9]*[a-zA-Z])(?=[a-zA-Z0-9]*\d)[a-zA-Z0-9]{10,}$/,
];

// Class-name fragments that frequently mean "auto-generated".
// Same rationale as above: a fragment is dynamic only if it looks like a
// hash (mixed letters + digits) or all-digits — pure-letter words like
// "primary", "secondary", "active", "disabled" stay safe.
const DYNAMIC_CLASS_FRAGMENTS = [
  // Trailing hash after a dash:  Button-primary-1a2b3c, btn-_AbCd12
  // Requires a digit somewhere in the trailing chunk so "btn-primary" passes.
  /-(?=[a-z0-9]*\d)[a-z0-9]{4,}$/i,
  // Double-underscore module hash:  styles__abc123
  /__(?=[a-z0-9]*\d)[a-z0-9]{4,}$/,
  // Leading hash module:  _abc123_btn
  /^_(?=[a-z0-9]*\d)[a-z0-9]{4,}_/,
];

/**
 * Heuristic: is this attribute value almost certainly auto-generated
 * (and therefore brittle for selector use)?
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isDynamicAttributeValue(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  for (const re of DYNAMIC_PATTERNS) {
    if (re.test(value)) return true;
  }
  return false;
}

/**
 * Heuristic: does this className contain at least one fragment that looks
 * auto-generated? Class names often mix stable + dynamic fragments
 * ("btn primary jss123") so we check fragment-by-fragment.
 *
 * @param {string} className
 * @returns {boolean}
 */
export function hasDynamicClassFragment(className) {
  if (typeof className !== 'string' || className.length === 0) return false;
  const fragments = className.split(/\s+/).filter(Boolean);
  for (const frag of fragments) {
    for (const re of DYNAMIC_CLASS_FRAGMENTS) {
      if (re.test(frag)) return true;
    }
  }
  return false;
}

/* -------------------------------------------------------------------------- *
 *  Confidence scoring                                                        *
 * -------------------------------------------------------------------------- */

/**
 * Strategy → base score. Higher = more stable. Combines with uniqueness +
 * penalties below to produce the final 0-100 confidence.
 *
 * Numbers are intentionally spaced so structural/uniqueness adjustments
 * can never re-order the strategies relative to one another.
 *
 *   100  data-testid (purpose-built test hook)
 *    95  id  (when not dynamic — see penalties)
 *    85  name attribute on form controls
 *    80  aria-label
 *    78  role= (Playwright role selector)
 *    75  data-* attributes other than data-testid
 *    65  text= / link text
 *    55  CSS attribute selector (e.g. [type="submit"])
 *    45  CSS structural selector  (.btn .primary)
 *    25  relative XPath  //button[@type="submit"]
 *    10  XPath with index  //div[3]/button
 *     5  absolute XPath  /html/body/...   (recorder rejects these, but the
 *                                          score exists in case one slips
 *                                          through from a manual import)
 */
const STRATEGY_BASE_SCORE = {
  'data-testid': 100,
  id:            95,
  name:          85,
  'aria-label':  80,
  role:          78,
  'data-attr':   75,
  text:          65,
  'css-attr':    55,
  css:           45,
  'xpath-rel':   25,
  'xpath-idx':   10,
  'xpath-abs':    5,
};

// Penalty constants (subtracted from base after we know the candidate's
// structural details). All comments name the rationale.
const PENALTIES = {
  // Selector value matches a dynamic-attribute pattern → score gets gutted.
  // We don't drop it entirely (the user might still want to see it as a
  // last-resort hint), but it ranks below every non-dynamic candidate.
  DYNAMIC_VALUE: 60,
  // Selector matches >1 element on the page → ambiguity is dangerous;
  // for unique-required interactions (click, type) the healer rejects
  // ambiguous matches anyway, but we score them down here too so the
  // recorder doesn't make them primary.
  NOT_UNIQUE_PER_EXTRA: 8,   // -8 per extra match
  NOT_UNIQUE_CAP: 40,        // never penalise more than this for ambiguity
  // Uses :nth-child(...) → fragile to layout changes.
  NTH_CHILD: 25,
  // Deep descendant selector with > 4 combinators (".a .b .c .d .e") →
  // brittle to parent-DOM reshuffles.
  DEEP_DESCENDANT: 15,
  // Class-only selector when class name contains a dynamic fragment.
  DYNAMIC_CLASS: 20,
};

/**
 * Infer the strategy key for a raw selector string. This mirrors the
 * shape produced by services/browserService.js#getElementSelector.
 *
 * @param {string} selector
 * @returns {keyof typeof STRATEGY_BASE_SCORE}
 */
export function classifySelector(selector) {
  if (typeof selector !== 'string' || selector.length === 0) return 'css';
  const s = selector.trim();

  if (s.startsWith('[data-testid='))  return 'data-testid';
  if (s.startsWith('[data-'))         return 'data-attr';
  if (s.startsWith('#'))              return 'id';
  if (s.startsWith('[name='))         return 'name';
  if (s.startsWith('[aria-label='))   return 'aria-label';
  if (s.startsWith('role='))          return 'role';
  if (s.startsWith('text='))          return 'text';

  if (s.startsWith('xpath=/html') || s.startsWith('/html')) return 'xpath-abs';
  if (s.startsWith('xpath=//') || s.startsWith('//')) {
    return /\[\s*\d+\s*\]/.test(s) ? 'xpath-idx' : 'xpath-rel';
  }
  if (s.startsWith('[')) return 'css-attr';
  return 'css';
}

/**
 * Compute a 0-100 confidence score for a single locator candidate.
 *
 * @param {Object} candidate
 * @param {string} candidate.selector       raw selector (required)
 * @param {boolean} [candidate.unique]      true if it matches exactly one element
 * @param {number} [candidate.count]        match count on the page (default 1)
 * @param {string} [candidate.value]        the attribute value, if applicable
 *                                          (used for dynamic detection)
 * @param {string} [candidate.className]    full className string when the
 *                                          selector is class-based
 * @returns {{ score:number, strategy:string, reasons:string[] }}
 */
export function scoreLocator(candidate) {
  const selector = String(candidate?.selector || '');
  const strategy = classifySelector(selector);
  let score = STRATEGY_BASE_SCORE[strategy] ?? 0;
  const reasons = [`base ${strategy}=${score}`];

  // Dynamic value penalty. The selector text itself often contains the
  // attribute value between =" and "] — extract it cheaply.
  const valueFromSelector =
    /\["[^=]+="([^"]+)"\]/.exec(selector)?.[1] ||
    /^#([^\s.>+~:]+)/.exec(selector)?.[1] ||
    candidate?.value ||
    '';
  if (valueFromSelector && isDynamicAttributeValue(valueFromSelector)) {
    score -= PENALTIES.DYNAMIC_VALUE;
    reasons.push(`-${PENALTIES.DYNAMIC_VALUE} dynamic value "${valueFromSelector}"`);
  }

  // Class-name dynamism penalty (separate from above because the class
  // selector won't have an attribute value.)
  if (candidate?.className && hasDynamicClassFragment(candidate.className)) {
    score -= PENALTIES.DYNAMIC_CLASS;
    reasons.push(`-${PENALTIES.DYNAMIC_CLASS} class has dynamic fragment`);
  }

  // Uniqueness penalty.
  const count = Number.isFinite(candidate?.count) ? candidate.count : (candidate?.unique === false ? 2 : 1);
  if (count > 1) {
    const raw = (count - 1) * PENALTIES.NOT_UNIQUE_PER_EXTRA;
    const capped = Math.min(raw, PENALTIES.NOT_UNIQUE_CAP);
    score -= capped;
    reasons.push(`-${capped} matches ${count} elements`);
  }

  // nth-child penalty.
  if (/:nth-child\(/.test(selector)) {
    score -= PENALTIES.NTH_CHILD;
    reasons.push(`-${PENALTIES.NTH_CHILD} uses :nth-child(...)`);
  }

  // Deep-descendant penalty (>4 whitespace combinators in CSS).
  const combinators = (selector.match(/(?<![,>+~])\s+(?![,>+~])/g) || []).length;
  if (combinators > 4 && !selector.startsWith('xpath=') && !selector.startsWith('//')) {
    score -= PENALTIES.DEEP_DESCENDANT;
    reasons.push(`-${PENALTIES.DEEP_DESCENDANT} deep descendant (${combinators} combinators)`);
  }

  // Clamp.
  score = Math.max(0, Math.min(100, score));
  return { score, strategy, reasons };
}

/**
 * Convenience: score every candidate in `step.locatorCandidates` and
 * return them re-sorted highest-confidence-first. Original metadata is
 * preserved; we only annotate `confidence` and `confidenceReasons`.
 *
 * @param {Array<Object>} candidates
 * @returns {Array<Object>}
 */
export function rankCandidates(candidates) {
  if (!Array.isArray(candidates)) return [];
  const annotated = candidates.map((c) => {
    const { score, strategy, reasons } = scoreLocator(c);
    return { ...c, confidence: score, strategy, confidenceReasons: reasons };
  });
  annotated.sort((a, b) => b.confidence - a.confidence);
  return annotated;
}
