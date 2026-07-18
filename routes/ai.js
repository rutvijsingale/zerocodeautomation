// [ZAC-FIX] split from routes/api.js
import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { pollingRateLimiter, strictRateLimiter } from '../middleware/security.js';

const router = express.Router();

// ----------------------------------------------------------------------------
// AI endpoints — local-only LLM (Ollama) for locator suggestion
// ----------------------------------------------------------------------------
// a stuck Ollama probe.

router.get('/ai/info', asyncHandler(async (req, res) => {
  const { getAiProvider } = await import('../services/aiService.js');
  const provider = await getAiProvider();
  res.json({
    available: provider.available(),
    ...provider.info(),
  });
}));

router.post('/ai/suggest-locator', asyncHandler(async (req, res) => {
  const { failedSelector, htmlSnippet, elementHint } = req.body || {};
  if (!failedSelector || typeof failedSelector !== 'string') {
    return res.status(400).json({
      ok: false,
      error: 'failedSelector (string) is required',
    });
  }
  const { getAiProvider } = await import('../services/aiService.js');
  const provider = await getAiProvider();
  if (!provider.available()) {
    return res.json({
      ok: false,
      reason: provider.info().reason || 'No AI provider configured',
      provider: provider.info(),
      suggestion: null,
    });
  }
  const start = Date.now();
  const result = await provider.suggestLocator({
    failedSelector,
    htmlSnippet: htmlSnippet || '',
    elementHint: elementHint || '',
  });
  res.json({
    ...result,
    provider: provider.info(),
    elapsedMs: Date.now() - start,
  });
}));

// T3.2 — AI ranking of recorded selectors. Used by the recorder UI on
// demand: pass an array of candidate selectors + a small page snippet,
// the model returns them re-ordered with confidence scores. We wrap
// the existing utils/locatorQuality scorer for the deterministic
// baseline AND ask the AI to express a preference; final score is a
// weighted blend (60% deterministic, 40% AI). When AI is unavailable
// we just return the deterministic ranking — never a hard error.
router.post('/ai/rank-locators', asyncHandler(async (req, res) => {
  const { candidates, htmlSnippet, elementHint } = req.body || {};
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return res.status(400).json({ ok: false, error: 'candidates (non-empty array) required' });
  }
  // 1. Deterministic baseline.
  const { rankCandidates } = await import('../utils/locatorQuality.js');
  const detRanked = rankCandidates(candidates);

  // 2. AI overlay (best-effort). We ask the model to pick the BEST
  // selector for the snippet from the supplied list; the chosen
  // selector gets a +20 boost on the blended score, others stay at
  // their deterministic score.
  const { getAiProvider } = await import('../services/aiService.js');
  const provider = await getAiProvider();
  let aiPick = null;
  let aiInfo = provider.info();
  if (provider.available()) {
    try {
      // Reuse suggestLocator to get the AI's preferred selector. The
      // prompt steers it toward the best of OUR options by including
      // them in the elementHint.
      const optList = detRanked.slice(0, 8).map((c, i) => `${i + 1}. ${c.selector}`).join('\n');
      const resp = await provider.suggestLocator({
        failedSelector: '(rank these candidates)',
        elementHint: (elementHint || '') + '\n\nChoose the most reliable from:\n' + optList,
        htmlSnippet: htmlSnippet || '',
      }).catch(() => null);
      const sug = resp && resp.ok && resp.suggestion;
      if (sug) {
        // Match exact OR substring against the offered list.
        aiPick = detRanked.find((c) => c.selector === sug) ||
                 detRanked.find((c) => c.selector.includes(sug)) ||
                 detRanked.find((c) => sug.includes(c.selector));
      }
    } catch (e) {
      console.warn('[AI rank] suggest call failed:', e.message);
    }
  }
  // 3. Blend.
  const ranked = detRanked.map((c) => {
    const aiBoost = (aiPick && aiPick.selector === c.selector) ? 20 : 0;
    const blended = Math.min(100, Math.max(0, Math.round((c.confidence || 0) * 0.6 + aiBoost + (c.confidence || 0) * 0.4)));
    return Object.assign({}, c, {
      blendedConfidence: blended,
      aiPreferred: !!(aiPick && aiPick.selector === c.selector),
    });
  });
  ranked.sort((a, b) => b.blendedConfidence - a.blendedConfidence);
  res.json({
    ok: true,
    ranked,
    aiAvailable: provider.available(),
    aiProvider: aiInfo,
  });
}));

// T4.1 — General AI diagnostic helper. Thin route over
// services/aiService.js#diagnoseError. The helper handles deterministic
// fallback when Ollama isn't available, so this route ALWAYS returns
// 200 with a structured payload (no fail-open hard errors here).
router.post('/ai/diagnose', asyncHandler(async (req, res) => {
  const { context, error, hint } = req.body || {};
  if (!error || typeof error !== 'string') {
    return res.status(400).json({ ok: false, error: 'error (string) is required' });
  }
  const { diagnoseError } = await import('../services/aiService.js');
  const result = await diagnoseError({ context, error, hint });
  res.json(result);
}));

// [ZAC-FIX] FIX 8 — generic chat passthrough for the AI Assistant panel.
// The browser would otherwise hit http://localhost:11434 directly and get
// blocked by Ollama's CORS allow-list. Routing through the ZAC server is
// same-origin from the dashboard's perspective, so no CORS preflight.
//
// Body: { message: string, system?: string, model?: string }
// Always returns 200 with { ok, response, model, baseUrl, reason? }.
router.post('/ai/chat', asyncHandler(async (req, res) => {
  const { message, system, model } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ ok: false, error: 'message (string) is required' });
  }
  const { getAiProvider } = await import('../services/aiService.js');
  const provider = await getAiProvider();
  if (!provider.available()) {
    const info = provider.info();
    return res.json({
      ok: false,
      reason: info.reason || 'AI provider not configured',
      response: '',
      provider: info,
    });
  }
  const start = Date.now();
  const result = await provider.chat({ prompt: message, system, model });
  res.json({
    ...result,
    provider: provider.info(),
    elapsedMs: Date.now() - start,
  });
}));

// Runtime AI on/off toggle. Body: { mode: 'on' | 'off' | 'auto' }
// Powers the dashboard's AI switch — lets users flip the local LLM on
// without restarting the server. Always returns 200 with a structured
// payload (including ok:false) so the UI can render a clear message
// when Ollama isn't installed.
router.post('/ai/toggle', asyncHandler(async (req, res) => {
  const mode = String(req.body?.mode || '').toLowerCase();
  if (!['on', 'off', 'auto'].includes(mode)) {
    return res.status(400).json({ ok: false, error: 'mode must be "on", "off", or "auto"' });
  }
  const { setAiProvider } = await import('../services/aiService.js');
  const result = await setAiProvider(mode);
  res.json(result);
}));

// [ZAC-FIX] Full AI provider configuration (Settings tab). Lets a tester wire
// an external OpenAI-compatible API (Qwen / OpenAI / DeepSeek / vLLM / …) or the
// local Ollama daemon, and have it persist across restarts.
//   GET  → current config with the API key masked (never returned).
//   POST → { provider, baseUrl?, model?, apiKey? }; installs + probes the
//          provider and returns { ok, info, reason? }. Blank apiKey keeps the
//          stored key so the UI never has to echo the secret.
router.get('/ai/config', pollingRateLimiter, asyncHandler(async (req, res) => {
  const { getAiConfigMasked } = await import('../services/aiService.js');
  res.json({ ok: true, config: getAiConfigMasked() });
}));

router.post('/ai/config', strictRateLimiter, asyncHandler(async (req, res) => {
  const { provider, baseUrl, model, apiKey } = req.body || {};
  const { setAiConfig } = await import('../services/aiService.js');
  const result = await setAiConfig({ provider, baseUrl, model, apiKey });
  res.json(result);
}));

console.log('[API Routes] AI routes registered:');
console.log('  GET    /api/ai/info');
console.log('  POST   /api/ai/suggest-locator');
console.log('  POST   /api/ai/chat');
console.log('  POST   /api/ai/toggle');
console.log('[API Routes] [ZAC-FIX] new routes registered:');
console.log('  POST   /api/projects/:id/manual-edits   (FIX A: editor writeback)');
console.log('  POST   /api/runs/append                 (FIX C: rerun history)');
console.log('  GET    /api/runs/history                (FIX C: dashboard feed)');

// ----------------------------------------------------------------------------
// Dashboard stats — aggregates across generated-projects/ and rerun reports
// ----------------------------------------------------------------------------


export default router;
