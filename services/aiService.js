/**
 * services/aiService.js
 *
 * Local-first AI abstraction.
 *
 * Goal:
 *   "Embed local LLM (Ollama / GGUF / Mistral / LLaMA) — no internet
 *    dependency."
 *
 * Implementation:
 *   - Two providers behind a single interface:
 *       OllamaProvider — talks to a locally-running Ollama daemon
 *                        (http://127.0.0.1:11434, the standard port).
 *                        No network egress; the daemon serves a model
 *                        the user has already pulled (e.g. `mistral`,
 *                        `llama3`, `qwen2.5-coder`).
 *       NullProvider   — graceful no-op when no local AI is available.
 *                        Returns { ok:false, reason:'AI provider not
 *                        configured' } so callers can fall back to the
 *                        deterministic healer chain.
 *
 *   - Provider is selected at startup via env:
 *       ZAC_AI_PROVIDER     'ollama' | 'null'   (default: auto-detect)
 *       ZAC_AI_MODEL        model name           (default: 'mistral')
 *       ZAC_AI_BASE_URL     http://127.0.0.1:11434
 *
 *   - Auto-detect: probes /api/tags on the default Ollama port. If it
 *     responds within 500ms, OllamaProvider is used. Otherwise
 *     NullProvider — so the system NEVER fails on startup just because
 *     the user hasn't installed a local model.
 *
 * Capabilities exposed on the interface:
 *   .available()                 → boolean
 *   .info()                      → { provider, model, baseUrl }
 *   .suggestLocator({ failedSelector, htmlSnippet, elementHint })
 *                                → { ok, suggestion, confidence, raw }
 *
 * Safety:
 *   - Never sends data outside localhost.
 *   - Truncates DOM snippets to 8 KB before prompting (Ollama's context
 *     budget; also keeps prompts deterministic).
 *   - Never logs raw HTML snippets at INFO; logs are structured
 *     (selector + suggestion only) so we don't leak user content.
 */

import http from 'http';

const TAG = '[AI]';

const DEFAULT_OLLAMA_URL = process.env.ZAC_AI_BASE_URL || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.ZAC_AI_MODEL || 'mistral';
const PROBE_TIMEOUT_MS = 500;
// [ZAC-FIX] Mistral often takes 30-90s on cold model load. The original
// 30s budget surfaced as "Ollama request timed out after 30000ms" in the
// AI Assistant chat. Bump to a generous default and let ops override.
// suggestLocator (small num_predict) typically returns in <5s; the chat
// surface uses larger num_predict and benefits from the bigger budget.
const REQUEST_TIMEOUT_MS = Number(process.env.ZAC_AI_REQUEST_TIMEOUT_MS || 180_000);
const MAX_HTML_BYTES = 8 * 1024;

/* -------------------------------------------------------------------------- *
 *  Null provider                                                             *
 * -------------------------------------------------------------------------- */

class NullProvider {
  constructor(reason = 'AI provider not configured') {
    this.reason = reason;
  }
  available() { return false; }
  info() { return { provider: 'null', model: null, baseUrl: null, reason: this.reason }; }
  async suggestLocator() {
    return { ok: false, reason: this.reason, suggestion: null, confidence: 0 };
  }
  // [ZAC-FIX] FIX 8 — generic chat surface for the AI Assistant panel.
  async chat() {
    return { ok: false, reason: this.reason, response: '' };
  }
}

/* -------------------------------------------------------------------------- *
 *  Ollama provider                                                           *
 * -------------------------------------------------------------------------- */

class OllamaProvider {
  /**
   * @param {Object} opts
   * @param {string} opts.baseUrl
   * @param {string} opts.model
   */
  constructor(opts = {}) {
    this.baseUrl = opts.baseUrl || DEFAULT_OLLAMA_URL;
    this.model = opts.model || DEFAULT_MODEL;
    this._url = new URL(this.baseUrl);
  }
  available() { return true; }
  info() { return { provider: 'ollama', model: this.model, baseUrl: this.baseUrl }; }

  /**
   * Ask the local model to suggest a CSS / Playwright selector for an
   * element when the recorded one fails. Strict prompt: the model is
   * instructed to reply with a single selector string and nothing else;
   * we still defensively parse the response.
   *
   * @param {Object} ctx
   * @param {string} ctx.failedSelector  the selector that failed at runtime
   * @param {string} ctx.htmlSnippet     surrounding HTML (truncated)
   * @param {string} [ctx.elementHint]   short human description
   *                                     ("Login button", "Email input")
   * @returns {Promise<{ ok:boolean, suggestion:string|null, confidence:number, raw:string }>}
   */
  async suggestLocator(ctx) {
    const failed = String(ctx?.failedSelector || '').slice(0, 500);
    const hint = String(ctx?.elementHint || '').slice(0, 200);
    const html = truncateHtml(ctx?.htmlSnippet || '');

    const prompt = buildLocatorPrompt({ failed, hint, html });
    let body;
    try {
      body = await this._chat(prompt);
    } catch (err) {
      console.warn(`${TAG} ollama call failed: ${err.message}`);
      return { ok: false, reason: err.message, suggestion: null, confidence: 0, raw: '' };
    }

    const raw = (body || '').trim();
    const suggestion = extractSelectorFromResponse(raw);
    if (!suggestion) {
      return { ok: false, reason: 'no parsable selector in model response', suggestion: null, confidence: 0, raw };
    }
    // Confidence is a heuristic: the model has no way to self-rate
    // accurately. We score by selector strategy, same as locatorQuality.
    return { ok: true, suggestion, confidence: 70, raw };
  }

  /**
   * [ZAC-FIX] FIX 8 — public chat surface used by the AI Assistant panel.
   * Goes through the ZAC server (this method) instead of the browser
   * calling Ollama directly, which would otherwise be blocked by CORS.
   *
   * @param {Object} ctx
   * @param {string} ctx.prompt    user-visible message
   * @param {string} [ctx.system]  system instructions to prepend
   * @param {string} [ctx.model]   override default model
   * @param {Object} [ctx.options] passed through to Ollama options block
   * @returns {Promise<{ok:boolean, response:string, model:string, baseUrl:string, reason?:string}>}
   */
  async chat(ctx = {}) {
    const userPrompt = String(ctx.prompt || '').slice(0, 8 * 1024);
    if (!userPrompt) {
      return { ok: false, reason: 'empty prompt', response: '', model: this.model, baseUrl: this.baseUrl };
    }
    const system = String(ctx.system || '').slice(0, 8 * 1024);
    const model = String(ctx.model || this.model);
    const fullPrompt = system ? `${system}\n\nUser: ${userPrompt}` : userPrompt;
    try {
      const response = await this._raw({
        model,
        prompt: fullPrompt,
        stream: false,
        options: ctx.options || { temperature: 0.2, num_predict: 512 },
      });
      return { ok: true, response, model, baseUrl: this.baseUrl };
    } catch (err) {
      return { ok: false, reason: err.message, response: '', model, baseUrl: this.baseUrl };
    }
  }

  _chat(prompt) {
    return this._raw({
      model: this.model,
      prompt,
      stream: false,
      options: { temperature: 0.1, num_predict: 128 },
    });
  }

  /** Low-level POST to /api/generate. Returns the model's `response` text. */
  _raw(bodyObj) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(bodyObj);
      const req = http.request({
        host: this._url.hostname,
        port: this._url.port || 80,
        path: '/api/generate',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: REQUEST_TIMEOUT_MS,
      }, (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => {
          try {
            const j = JSON.parse(buf);
            resolve(j.response || '');
          } catch (e) {
            reject(new Error(`malformed Ollama response: ${e.message}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error(`Ollama request timed out after ${REQUEST_TIMEOUT_MS}ms`));
      });
      req.write(payload);
      req.end();
    });
  }
}

/* -------------------------------------------------------------------------- *
 *  Selection / auto-detect                                                   *
 * -------------------------------------------------------------------------- */

/**
 * Probe the local Ollama daemon. Returns a Promise that resolves to true
 * when /api/tags responds within PROBE_TIMEOUT_MS.
 */
function probeOllama(baseUrl) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(baseUrl); }
    catch { resolve(false); return; }
    const req = http.request({
      host: url.hostname,
      port: url.port || 80,
      path: '/api/tags',
      method: 'GET',
      timeout: PROBE_TIMEOUT_MS,
    }, (res) => {
      // Drain so we don't leak sockets.
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

let _provider = null;

/**
 * Returns the configured AI provider (singleton). Lazy-initialised on
 * first use so importing the module is free.
 *
 * @returns {Promise<OllamaProvider|NullProvider>}
 */
export async function getAiProvider() {
  if (_provider) return _provider;
  const explicit = (process.env.ZAC_AI_PROVIDER || '').toLowerCase();

  if (explicit === 'null') {
    _provider = new NullProvider('explicitly disabled via ZAC_AI_PROVIDER=null');
    return _provider;
  }
  if (explicit === 'ollama') {
    _provider = new OllamaProvider({ baseUrl: DEFAULT_OLLAMA_URL, model: DEFAULT_MODEL });
    return _provider;
  }

  // Auto-detect.
  const reachable = await probeOllama(DEFAULT_OLLAMA_URL);
  if (reachable) {
    console.log(`${TAG} Ollama detected at ${DEFAULT_OLLAMA_URL}, using model "${DEFAULT_MODEL}"`);
    _provider = new OllamaProvider({ baseUrl: DEFAULT_OLLAMA_URL, model: DEFAULT_MODEL });
  } else {
    console.log(`${TAG} no local Ollama at ${DEFAULT_OLLAMA_URL} — running with NullProvider (deterministic healer only)`);
    _provider = new NullProvider('no local Ollama detected on default port');
  }
  return _provider;
}

/**
 * For tests: install a mock provider so unit tests can verify the
 * router → service → provider plumbing without spinning up Ollama.
 *
 * @param {{ available:Function, suggestLocator:Function, info?:Function }} mock
 */
export function _setProviderForTests(mock) {
  _provider = mock;
}

/**
 * For tests: drop the cached provider so the next getAiProvider() call
 * re-runs auto-detect.
 */
export function _resetProviderForTests() {
  _provider = null;
}

/**
 * Runtime AI toggle. Powers the dashboard's AI on/off switch.
 *
 * Behaviour:
 *   - 'on'   → install OllamaProvider, then probe. If reachable, return
 *              { ok:true, info }. If not reachable, fall back to
 *              NullProvider with a clear reason — caller can surface it
 *              ("install Ollama and pull a model").
 *   - 'off'  → install NullProvider permanently for this process.
 *   - 'auto' → re-run auto-detect (default startup behaviour).
 *
 * Lasts for the life of the server process (no env-var change required;
 * the next getAiProvider() returns the toggled provider).
 *
 * @param {'on'|'off'|'auto'} mode
 * @returns {Promise<{ ok:boolean, mode:string, info:object, reason?:string }>}
 */
export async function setAiProvider(mode) {
  const m = String(mode || '').toLowerCase();
  if (m === 'off') {
    _provider = new NullProvider('disabled via dashboard toggle');
    return { ok: true, mode: 'off', info: _provider.info() };
  }
  if (m === 'on') {
    const candidate = new OllamaProvider({ baseUrl: DEFAULT_OLLAMA_URL, model: DEFAULT_MODEL });
    const reachable = await probeOllama(DEFAULT_OLLAMA_URL);
    if (reachable) {
      _provider = candidate;
      console.log(`${TAG} toggled ON via dashboard — using ${candidate.info().model} at ${candidate.info().baseUrl}`);
      return { ok: true, mode: 'on', info: _provider.info() };
    }
    // Fail-soft: stay on a NullProvider with a useful reason.
    _provider = new NullProvider(
      `cannot enable AI: no Ollama at ${DEFAULT_OLLAMA_URL}. ` +
      `Install with "brew install ollama && ollama pull mistral && ollama serve".`
    );
    return { ok: false, mode: 'on', reason: _provider.info().reason, info: _provider.info() };
  }
  if (m === 'auto') {
    _provider = null; // next getAiProvider() re-runs probe
    const fresh = await getAiProvider();
    return { ok: true, mode: 'auto', info: fresh.info() };
  }
  return { ok: false, mode: m, reason: 'unknown mode (use on|off|auto)', info: { provider: 'unknown' } };
}

/* -------------------------------------------------------------------------- *
 *  Prompt + response handling                                                *
 * -------------------------------------------------------------------------- */

/**
 * Build the locator-suggestion prompt. Deliberately strict: instructs
 * the model to reply with one line, one selector, no preamble. Keeps
 * temperature low at the call site so output is stable across runs.
 */
function buildLocatorPrompt({ failed, hint, html }) {
  return `You are a senior test-automation engineer. The following CSS / Playwright selector failed at runtime:

  ${failed}

The element is described as: ${hint || '(no description provided)'}

Here is the relevant HTML snippet from the page:

${html || '(no HTML provided)'}

Your task: reply with ONE single CSS or Playwright selector that uniquely identifies the same element.

Strong rules:
  - Prefer [data-testid="..."] over any other attribute.
  - Then prefer #id, [name="..."], [aria-label="..."], role=, text=
  - NEVER use absolute XPath like /html/body/...
  - NEVER use :nth-child unless absolutely unavoidable.
  - Reply with ONLY the selector. No code block, no explanation, no quotes.`;
}

/**
 * Pull a single selector out of the model's response. Defensively handles
 * the common ways small models pad their answers (markdown fences, "the
 * selector is:" preamble, surrounding quotes).
 *
 * T3.3 — bare `attr="value"` fragments (the common way mistral / llama
 * answer "what selector should I use?") are now wrapped in [ ] so they
 * become valid CSS attribute selectors. Without this, mistral's
 * legitimately-correct answers like `data-testid="submit-login"` were
 * being rejected as unparsable, even though they identified the right
 * attribute.
 */
export function extractSelectorFromResponse(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let s = raw.trim();

  // Drop markdown fences if present.
  s = s.replace(/^```(?:[a-zA-Z]+)?\s*/m, '').replace(/```\s*$/m, '').trim();

  // If multi-line, take the first non-empty line that looks like a selector.
  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    let cleaned = line;
    // Strip MATCHED surrounding quote pair only — never just the trailing
    // one. Pattern attr="value" must NOT lose its closing quote here.
    const m = cleaned.match(/^(["'`])(.*)\1$/);
    if (m) cleaned = m[2];
    cleaned = cleaned
      .replace(/^(?:selector\s*[:=]\s*)/i, '')          // "selector: ..."
      .replace(/^(?:the\s+selector\s+is\s*[:=]?\s*)/i, '') // "the selector is ..."
      .trim();
    // T3.3 — wrap bare attribute fragments in [].
    // Matches patterns like:
    //   data-testid="submit-login"
    //   role=button
    //   aria-label='Search'
    //   data-cy="login-btn"
    // but NOT things that are already valid CSS (start with [, #, .,
    // tag-anchor, role=, text=, xpath=, //).
    if (looksLikeBareAttribute(cleaned)) {
      cleaned = '[' + cleaned + ']';
    }
    if (looksLikeSelector(cleaned)) return cleaned;
  }
  return null;
}

/**
 * T3.3 — does the string look like `attr="value"` / `attr=value` /
 * `attr='value'` (with no surrounding [ ])?  We only wrap if the
 * attribute name looks like a real HTML/data attribute (contains a
 * letter, may contain dashes / digits, no spaces).
 */
function looksLikeBareAttribute(s) {
  if (!s || typeof s !== 'string') return false;
  if (s.length > 200) return false;
  if (s.startsWith('[') || s.startsWith('#') || s.startsWith('.') ||
      s.startsWith('//') || s.startsWith('xpath=') || s.startsWith('text=') ||
      s.startsWith('role=')) {
    return false;
  }
  // attr="value" or attr='value' or attr=plainValue
  return /^[a-zA-Z][\w-]*=(?:"[^"]*"|'[^']*'|[^\s\]"']+)$/.test(s);
}

// Known HTML tag set used to validate bare-tag responses. Without this
// guard, single English words like "I" or "Sorry" would be mis-parsed
// as selectors. We keep the list tight on purpose — selectors that
// matter for test automation almost always include an attribute,
// id, class, or pseudo-selector beyond the bare tag.
const BARE_TAG_WHITELIST = new Set([
  'a', 'button', 'input', 'select', 'textarea', 'form', 'label', 'option',
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'nav',
  'header', 'footer', 'main', 'section', 'article', 'aside',
  'img', 'iframe', 'svg', 'video', 'audio',
]);

function looksLikeSelector(s) {
  if (!s || typeof s !== 'string') return false;
  if (s.length > 500) return false;
  // Reject anything containing characters HTML selectors never use
  // (apostrophes outside attribute strings, sentence punctuation).
  // English negative-contractions like "don't" trip this guard.
  if (/^[A-Z]/.test(s) && /\s/.test(s)) return false; // "Sorry no idea"
  if (/['].*\b/.test(s) && !/^["']/.test(s)) return false; // "I don't know"
  // Must START with one of the known selector entry points.
  if (s.startsWith('#')) return true;
  if (s.startsWith('.')) return true;
  if (s.startsWith('[')) return true;
  if (s.startsWith('//')) return true;
  if (s.startsWith('xpath=')) return true;
  if (s.startsWith('text=')) return true;
  if (s.startsWith('role=')) return true;
  // Tag-anchored selectors:  button.primary, div#x, input[type="submit"]
  if (/^[a-z][a-z0-9-]*[#.\s\[]/.test(s)) return true;
  // Bare tag: only accept lowercase, in the whitelist.
  if (/^[a-z][a-z0-9-]*$/.test(s) && BARE_TAG_WHITELIST.has(s)) return true;
  return false;
}

/**
 * Truncate HTML to MAX_HTML_BYTES while keeping it valid utf-8.
 */
function truncateHtml(html) {
  const s = String(html || '');
  if (Buffer.byteLength(s) <= MAX_HTML_BYTES) return s;
  // Coarse-truncate by character count; small over/under is fine for
  // an LLM prompt budget.
  return s.slice(0, MAX_HTML_BYTES) + '\n<!-- truncated by aiService -->';
}

/* -------------------------------------------------------------------------- *
 *  T4.1 — General error / environment diagnostic helper                       *
 *                                                                            *
 *  Used by the Maven / NPM / test-runner failure paths AND exposed at        *
 *  POST /api/ai/diagnose. Single source of truth for diagnostic prompts +    *
 *  response parsing, so in-process callers don't need HTTP round-trips and   *
 *  external clients get the same answer the IDE shows.                       *
 * -------------------------------------------------------------------------- */

/**
 * Diagnose a tool / environment / runtime error and return a structured
 * plain-English explanation + concrete fix steps. Always returns a
 * structured response, even when AI is unavailable — a deterministic
 * stub fills the gap so callers never see a hard error.
 *
 * @param {Object} args
 * @param {string} [args.context]   short description of what was attempted
 * @param {string} args.error       the raw error text
 * @param {string} [args.hint]      caller-supplied extra hint
 * @returns {Promise<{
 *   ok: true,
 *   aiAvailable: boolean,
 *   explanation: string,
 *   fixSteps: string[],
 *   severity: 'tooling'|'flake'|'network'|'assertion'|'unknown',
 *   elapsedMs: number,
 *   raw?: string,
 *   provider: object,
 * }>}
 */
export async function diagnoseError({ context, error, hint } = {}) {
  const start = Date.now();
  if (!error || typeof error !== 'string') {
    error = String(error || '(no error provided)');
  }
  const provider = await getAiProvider();

  if (!provider.available()) {
    return {
      ok: true,
      aiAvailable: false,
      explanation: deterministicDiagnostic(context, error, hint),
      fixSteps: deterministicFixSteps(context, error),
      severity: classifySeverity(error),
      elapsedMs: Date.now() - start,
      provider: provider.info(),
    };
  }

  const prompt = buildDiagnosticPrompt({ context, error, hint });
  let raw = '';
  try {
    if (typeof provider._chat === 'function') {
      raw = await provider._chat(prompt);
    } else {
      const r = await provider.suggestLocator({ failedSelector: '(diagnostic)', elementHint: prompt, htmlSnippet: '' });
      raw = (r && r.raw) || '';
    }
  } catch (e) {
    return {
      ok: true,
      aiAvailable: true,
      explanation: 'AI provider responded with an error: ' + e.message + '\n\nFalling back to deterministic guidance:\n' + deterministicDiagnostic(context, error, hint),
      fixSteps: deterministicFixSteps(context, error),
      severity: classifySeverity(error),
      elapsedMs: Date.now() - start,
      provider: provider.info(),
    };
  }
  const parsed = parseDiagnosticResponse(raw);
  return {
    ok: true,
    aiAvailable: true,
    explanation: parsed.explanation,
    fixSteps: parsed.fixSteps.length > 0 ? parsed.fixSteps : deterministicFixSteps(context, error),
    severity: classifySeverity(error),
    elapsedMs: Date.now() - start,
    raw,
    provider: provider.info(),
  };
}

function buildDiagnosticPrompt({ context, error, hint }) {
  return `You are a senior test-automation engineer helping a developer who hit an error while running automated tests.

Context: ${context || '(no context provided)'}
Error message:
${(error || '').slice(0, 4000)}
${hint ? '\nExtra hint from the tool: ' + hint : ''}

Reply with TWO sections, in this exact format:

EXPLANATION:
<one paragraph in plain English explaining what went wrong and why>

FIX STEPS:
1. <first action to take, imperative>
2. <second action>
3. <third action, optional>

Rules:
- Keep the explanation to 1-3 sentences.
- Each fix step must start with an imperative verb (Install, Run, Set, Add, Check, Verify, Restart, Open).
- Do NOT include code fences or markdown. Plain text only.
- If the error is about a missing tool (e.g. mvn, npm, java), give the exact install command for macOS, Windows, and Linux.`;
}

function parseDiagnosticResponse(raw) {
  if (!raw || typeof raw !== 'string') {
    return { explanation: '(empty AI response)', fixSteps: [] };
  }
  const fixSplitRe = /^\s*FIX STEPS\s*:?/im;
  const expRe      = /^\s*EXPLANATION\s*:?/im;
  let explanation = raw;
  let fixBlock = '';
  const fixMatch = raw.match(fixSplitRe);
  if (fixMatch && fixMatch.index !== undefined) {
    explanation = raw.slice(0, fixMatch.index).trim();
    fixBlock = raw.slice(fixMatch.index + fixMatch[0].length).trim();
  }
  explanation = explanation.replace(expRe, '').trim();
  const stepLines = fixBlock
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^(?:\d+[.)]\s*|[-*]\s*)/, ''))
    .filter((l) => l.length > 3 && l.length < 400);
  return { explanation: explanation.slice(0, 2000), fixSteps: stepLines.slice(0, 8) };
}

function deterministicDiagnostic(context, error, hint) {
  const err = String(error || '');
  if (/spawn mvn ENOENT|Maven is not installed|mvn.*not found/i.test(err)) {
    return 'Maven (the Java build tool) is not installed or not on your PATH, so the test runner cannot compile and execute the Java/Cucumber test suite for this project.';
  }
  if (/spawn npm ENOENT|npm.*not found/i.test(err)) {
    return 'Node.js / npm is not installed or not on your PATH — required to run TypeScript/JavaScript test suites.';
  }
  if (/Unable to locate a Java Runtime|JAVA_HOME/i.test(err)) {
    return 'Java (JDK) is not installed. Maven and Selenium-Java tests cannot run without it.';
  }
  if (/Timeout \d+ms exceeded.*waiting for/i.test(err)) {
    return 'A test step timed out waiting for an element to appear or become actionable. This is usually a stale locator, a slow-rendering page, or an unexpected modal/redirect blocking the target.';
  }
  if (/Connection refused|ECONNREFUSED/i.test(err)) {
    return 'The test could not reach the target server. Either the URL is wrong, the service is not running, or a firewall/proxy is blocking the request.';
  }
  return `Test execution failed${context ? ' while ' + context : ''}. ${(hint || '').slice(0, 200)}`.trim();
}

function deterministicFixSteps(context, error) {
  const err = String(error || '');
  if (/spawn mvn ENOENT|Maven is not installed|mvn.*not found/i.test(err)) {
    return [
      'Install Java JDK (Maven requires it): "brew install openjdk@21" on macOS, or Adoptium installer / SDKMAN on other OSes.',
      'Install Maven: "brew install maven" (macOS), "choco install maven" (Windows), or "apt-get install maven" (Linux).',
      'Restart the ZAC server so the new mvn binary is visible on PATH.',
      'Re-run the test from the IDE.',
    ];
  }
  if (/spawn npm ENOENT|npm.*not found/i.test(err)) {
    return [
      'Install Node.js 18+ from https://nodejs.org — npm comes bundled.',
      'Restart the ZAC server so npm is on PATH.',
      'Re-run the test.',
    ];
  }
  if (/Unable to locate a Java Runtime|JAVA_HOME/i.test(err)) {
    return [
      'Install OpenJDK 21: brew install openjdk@21 (macOS).',
      'Symlink for system java: sudo ln -sfn $(brew --prefix)/opt/openjdk@21/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk-21.jdk',
      'Re-run the test.',
    ];
  }
  if (/Timeout \d+ms exceeded.*waiting for/i.test(err)) {
    return [
      'Open the rerun report and check the per-step screenshot to see what the page looked like at failure.',
      'Inspect the page for an unexpected modal, cookie banner, or redirect.',
      'If the locator was correct, extend the step timeout or enable AI healing.',
    ];
  }
  return [
    'Open the full rerun report (logs/steps.log and logs/console.log) to see what happened immediately before the failure.',
    'If the error is reproducible, re-run with the AI toggle on so the locator-healer chain can suggest fallbacks.',
  ];
}

function classifySeverity(error) {
  const err = String(error || '');
  if (/ENOENT|not installed|missing/i.test(err))            return 'tooling';
  if (/Timeout|waitForSelector/i.test(err))                  return 'flake';
  if (/ECONNREFUSED|Connection refused|net::ERR/i.test(err)) return 'network';
  if (/Expected.*Found/i.test(err))                          return 'assertion';
  return 'unknown';
}
