/* eslint-disable no-undef */
/**
 * aiAssistant.js — Ollama Mistral AI Assistant panel.
 * [ZAC-FIX] FIX 8 (Ollama AI Assistant) + part of FIX 2 (settings sync).
 *
 * Adds a collapsible right-side panel on every ZAC tab. Toggle: Ctrl+Shift+A.
 * Talks to Ollama via fetch (no extra deps). Connection target lives in
 * window.ZacSettings (zac_settings.ollamaEndpoint, ollamaModel, ollamaEnabled).
 */
(function () {
  if (window.__ZAC_AI_PANEL_LOADED__) return;
  window.__ZAC_AI_PANEL_LOADED__ = true;

  const ZAC = window.ZacSettings;
  if (!ZAC) {
    console.warn('[ZAC-FIX] aiAssistant: ZacSettings not loaded; panel disabled.');
    return;
  }

  const PANEL_HTML = `
  <div id="zac-ai-panel" class="zac-ai-panel collapsed" role="complementary" aria-label="ZAC AI Assistant">
    <div class="zac-ai-header">
      <span class="zac-ai-title">AI Assistant · <span id="zac-ai-model-label">Mistral</span> (local)</span>
      <span id="zac-ai-status-badge" class="zac-ai-badge offline">Offline</span>
      <button id="zac-ai-collapse" type="button" class="zac-ai-iconbtn" title="Collapse (Ctrl+Shift+A)">×</button>
    </div>
    <div id="zac-ai-history" class="zac-ai-history" aria-live="polite"></div>
    <div class="zac-ai-quickbar">
      <button type="button" class="zac-ai-quick" data-action="fix">Fix this error</button>
      <button type="button" class="zac-ai-quick" data-action="explain">Explain code</button>
      <button type="button" class="zac-ai-quick" data-action="locator">Better locator</button>
    </div>
    <div class="zac-ai-input">
      <textarea id="zac-ai-prompt" rows="2" placeholder="Type your question…"></textarea>
      <div class="zac-ai-actions">
        <button id="zac-ai-send" type="button">Send</button>
        <button id="zac-ai-clear" type="button">Clear</button>
        <button id="zac-ai-copy" type="button">Copy answer</button>
      </div>
    </div>
  </div>
  <button id="zac-ai-fab" type="button" title="Open AI Assistant (Ctrl+Shift+A)" aria-label="Open AI Assistant">AI</button>
  `;

  const STYLE = `
  .zac-ai-panel {
    position: fixed; top: 84px; right: 18px; bottom: 18px; width: 380px;
    background: rgba(15,23,42,0.96); color: #e2e8f0; border: 1px solid rgba(148,163,184,0.25);
    border-radius: 14px; display: flex; flex-direction: column; z-index: 9999;
    box-shadow: 0 18px 40px rgba(0,0,0,0.4); font-family: ui-sans-serif, system-ui, sans-serif;
    transition: transform 0.2s ease, opacity 0.2s ease;
  }
  .zac-ai-panel.collapsed { transform: translateX(440px); opacity: 0; pointer-events: none; }
  .zac-ai-header { display: flex; align-items: center; gap: 10px; padding: 10px 12px;
    border-bottom: 1px solid rgba(148,163,184,0.2); }
  .zac-ai-title { flex: 1; font-weight: 600; font-size: 13px; letter-spacing: 0.2px; }
  .zac-ai-badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; }
  .zac-ai-badge.online  { background: rgba(34,197,94,0.18); color: #4ade80; border: 1px solid rgba(34,197,94,0.4); }
  .zac-ai-badge.offline { background: rgba(248,113,113,0.18); color: #fca5a5; border: 1px solid rgba(248,113,113,0.4); }
  .zac-ai-iconbtn { background: transparent; color: #cbd5e1; border: none; cursor: pointer; font-size: 18px; }
  .zac-ai-history { flex: 1; padding: 12px; overflow: auto; font-size: 13px; line-height: 1.45; }
  .zac-ai-history .msg { margin-bottom: 12px; padding: 8px 10px; border-radius: 10px; white-space: pre-wrap; word-break: break-word; }
  .zac-ai-history .msg.user { background: rgba(59,130,246,0.18); border: 1px solid rgba(59,130,246,0.4); }
  .zac-ai-history .msg.bot  { background: rgba(45,212,191,0.12); border: 1px solid rgba(45,212,191,0.28); }
  .zac-ai-history .msg.error { background: rgba(248,113,113,0.18); border: 1px solid rgba(248,113,113,0.4); }
  .zac-ai-history .role { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; opacity: 0.65; margin-bottom: 3px; }
  .zac-ai-quickbar { display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid rgba(148,163,184,0.18); flex-wrap: wrap; }
  .zac-ai-quickbar .zac-ai-quick { flex: 1 0 30%; font-size: 11px; padding: 6px 8px; border: 1px solid rgba(148,163,184,0.3);
    background: rgba(148,163,184,0.1); color: #e2e8f0; border-radius: 8px; cursor: pointer; }
  .zac-ai-quickbar .zac-ai-quick:hover { background: rgba(148,163,184,0.18); }
  .zac-ai-input { padding: 10px; border-top: 1px solid rgba(148,163,184,0.18); }
  .zac-ai-input textarea { width: 100%; resize: vertical; min-height: 40px; max-height: 140px;
    background: rgba(2,6,23,0.7); color: #e2e8f0; border: 1px solid rgba(148,163,184,0.3);
    border-radius: 8px; padding: 8px; font-family: inherit; font-size: 13px; }
  .zac-ai-actions { display: flex; gap: 6px; margin-top: 8px; }
  .zac-ai-actions button { flex: 1; font-size: 12px; padding: 7px 8px; border-radius: 8px;
    border: 1px solid rgba(148,163,184,0.3); background: rgba(59,130,246,0.18); color: #e2e8f0;
    cursor: pointer; }
  .zac-ai-actions button:hover { background: rgba(59,130,246,0.32); }
  #zac-ai-fab { position: fixed; right: 24px; bottom: 24px; width: 48px; height: 48px; border-radius: 999px;
    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; border: none;
    font-weight: 700; font-size: 14px; cursor: pointer; box-shadow: 0 12px 30px rgba(99,102,241,0.45); z-index: 9998; }
  #zac-ai-fab.hidden { display: none; }
  `;

  function injectChrome() {
    if (document.getElementById('zac-ai-panel')) return;
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    const wrap = document.createElement('div');
    wrap.innerHTML = PANEL_HTML;
    document.body.appendChild(wrap);

    document.getElementById('zac-ai-collapse').addEventListener('click', () => togglePanel(false));
    document.getElementById('zac-ai-fab').addEventListener('click', () => togglePanel(true));
    document.getElementById('zac-ai-send').addEventListener('click', send);
    document.getElementById('zac-ai-clear').addEventListener('click', clearHistory);
    document.getElementById('zac-ai-copy').addEventListener('click', copyLastAnswer);
    document.querySelectorAll('.zac-ai-quick').forEach(b => b.addEventListener('click', onQuick));
    document.getElementById('zac-ai-prompt').addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        send();
      }
    });
  }

  function togglePanel(open) {
    const panel = document.getElementById('zac-ai-panel');
    const fab = document.getElementById('zac-ai-fab');
    if (!panel || !fab) return;
    const willOpen = open === undefined ? panel.classList.contains('collapsed') : open;
    panel.classList.toggle('collapsed', !willOpen);
    fab.classList.toggle('hidden', willOpen);
    if (willOpen) {
      pingOllama();
      document.getElementById('zac-ai-prompt').focus();
    }
  }

  let chatHistory = [];
  function clearHistory() {
    chatHistory = [];
    document.getElementById('zac-ai-history').innerHTML = '';
  }
  function copyLastAnswer() {
    const lastBot = [...chatHistory].reverse().find(m => m.role === 'assistant');
    if (!lastBot) return;
    navigator.clipboard?.writeText(lastBot.content);
  }
  function appendMsg(role, content) {
    chatHistory.push({ role, content });
    const host = document.getElementById('zac-ai-history');
    const el = document.createElement('div');
    el.className = 'msg ' + (role === 'user' ? 'user' : (role === 'error' ? 'error' : 'bot'));
    el.innerHTML = `<span class="role">${role}</span>` + escapeHtml(content);
    host.appendChild(el);
    host.scrollTop = host.scrollHeight;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  function buildSystemPrompt() {
    const framework = ZAC.get().defaultFramework || 'Selenium Java';
    const codeEl = document.querySelector('#javaCode, #generatedCode, [data-zac-code-panel="java"]');
    const code = codeEl ? (codeEl.value || codeEl.textContent || '').slice(-2000) : '';
    const lastError = sessionStorage.getItem('zac_last_healer_error') || '';
    return `You are a senior SDET assistant helping fix ${framework} test automation code. ` +
      `Current generated code (last 50 lines):\n` +
      code.split('\n').slice(-50).join('\n') + `\n\n` +
      `Last healer error: ${lastError || 'none'}.\n\n` +
      `Answer concisely. Provide corrected code snippets when appropriate.`;
  }

  // [ZAC-FIX] FIX 8 — go through the ZAC server (/api/ai/info) instead of
  // talking to Ollama from the browser directly. Direct browser→Ollama
  // requests get blocked by Ollama's CORS allow-list (you'd have to set
  // OLLAMA_ORIGINS=*). The server already does this probe over Node http
  // so it always succeeds when Ollama is reachable from the host.
  async function pingOllama() {
    const { ollamaModel } = ZAC.get();
    const lbl = document.getElementById('zac-ai-model-label');
    const badge = document.getElementById('zac-ai-status-badge');
    if (lbl) lbl.textContent = ollamaModel || 'mistral';
    try {
      const r = await fetch('/api/ai/info', { method: 'GET' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const info = await r.json();
      if (info.available) {
        const modelMatch = !info.model || !ollamaModel || info.model === ollamaModel;
        badge.textContent = modelMatch
          ? `Connected ✓ ${info.model || ''}`
          : `Connected · server uses "${info.model}" (panel set to "${ollamaModel}")`;
        badge.className = 'zac-ai-badge ' + (modelMatch ? 'online' : 'offline');
        if (lbl && info.model) lbl.textContent = info.model;
      } else {
        badge.textContent = 'Offline · ' + (info.reason || 'no provider');
        badge.className = 'zac-ai-badge offline';
      }
    } catch (e) {
      badge.textContent = 'Offline (server check failed)';
      badge.className = 'zac-ai-badge offline';
    }
  }

  async function send() {
    const promptEl = document.getElementById('zac-ai-prompt');
    const userMessage = promptEl.value.trim();
    if (!userMessage) return;
    promptEl.value = '';
    appendMsg('user', userMessage);
    await callOllama(userMessage);
  }

  // [ZAC-FIX] FIX 8 — call /api/ai/chat instead of Ollama directly so the
  // browser never has to deal with Ollama's CORS allow-list. The server
  // proxies the request over Node http, returns { ok, response, model, ... }.
  async function callOllama(userMessage) {
    const { ollamaModel } = ZAC.get();
    const system = buildSystemPrompt();
    const controller = new AbortController();
    // [ZAC-FIX] Match the server's REQUEST_TIMEOUT_MS budget. Mistral on a
    // cold model load can take 60-90s on a typical laptop; aborting at 35s
    // produces "AI rejected the request: timed out" before the model has
    // even finished loading.
    const CLIENT_TIMEOUT_MS = 200_000; // 200s — server is 180s, give headroom
    const timeout = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    appendMsg('assistant', '⏳ thinking… (Mistral can take 30-90s on first call while the model loads)');
    const placeholder = document.querySelector('#zac-ai-history .msg.bot:last-child');

    try {
      const r = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          system,
          model: ollamaModel || undefined,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        replacePlaceholder(placeholder,
          'ZAC server returned HTTP ' + r.status + (data.error ? ': ' + data.error : ''),
          'error');
        return;
      }
      if (!data.ok) {
        const reason = data.reason || 'AI not available';
        if (/not running|not configured|not detected/i.test(reason)) {
          replacePlaceholder(placeholder,
            'Ollama not reachable from the ZAC server. On the host running ZAC:\n' +
            '  ollama serve\n' +
            '  ollama pull ' + (ollamaModel || 'mistral') + '\n\n' +
            'Server reason: ' + reason, 'error');
        } else {
          replacePlaceholder(placeholder, 'AI rejected the request: ' + reason, 'error');
        }
        return;
      }
      replacePlaceholder(placeholder, data.response || '(empty response)', 'assistant');
    } catch (err) {
      clearTimeout(timeout);
      let hint;
      if (err.name === 'AbortError') {
        hint = 'Request timed out (>200s). Pre-warm the model first:\n' +
               '  ollama run ' + (ollamaModel || 'mistral') + '\n' +
               '(type a single character, hit enter, then close it). Subsequent calls will be much faster.';
      } else {
        hint = 'Chat call failed: ' + (err.message || err);
      }
      replacePlaceholder(placeholder, hint, 'error');
    }
  }

  function replacePlaceholder(el, text, role) {
    if (!el) {
      appendMsg(role, text);
      return;
    }
    el.classList.remove('bot', 'user', 'error');
    el.classList.add(role === 'user' ? 'user' : (role === 'error' ? 'error' : 'bot'));
    el.innerHTML = `<span class="role">${role}</span>` + escapeHtml(text);
    chatHistory[chatHistory.length - 1] = { role, content: text };
  }

  function onQuick(e) {
    const action = e.currentTarget.dataset.action;
    let q;
    switch (action) {
      case 'fix':
        q = `Please diagnose this test error: ${sessionStorage.getItem('zac_last_healer_error') || '(none captured yet)'}`;
        break;
      case 'explain':
        q = 'Explain what the current generated code does at a high level.';
        break;
      case 'locator':
        q = 'Suggest a more resilient locator for the most recently failing element.';
        break;
      default:
        return;
    }
    document.getElementById('zac-ai-prompt').value = q;
    send();
  }

  // Keyboard shortcut: Ctrl+Shift+A toggles the panel.
  function bindShortcut() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault();
        togglePanel();
      }
    });
  }

  function boot() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', boot);
      return;
    }
    injectChrome();
    bindShortcut();
    // Reflect settings changes into the panel header.
    ZAC.subscribe((s) => {
      const lbl = document.getElementById('zac-ai-model-label');
      if (lbl) lbl.textContent = s.ollamaModel || 'mistral';
    });
    // [ZAC-FIX 2026-05-24] Re-ping Ollama whenever AI state changes
    // (Settings toggle, dashboard toggle, cross-tab change) so the
    // panel's connection badge updates live without a page refresh.
    // Only re-pings if the panel is open — otherwise the next open
    // call already does it via togglePanel().
    window.addEventListener('zac:ai-state-changed', () => {
      const panel = document.getElementById('zac-ai-panel');
      if (panel && !panel.classList.contains('collapsed')) {
        pingOllama();
      }
    });
    console.log('[ZAC-FIX] AI Assistant panel ready (Ctrl+Shift+A to toggle).');
  }

  boot();
})();
