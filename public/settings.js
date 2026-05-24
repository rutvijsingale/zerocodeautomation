  function showToast(msg, kind) {
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || 'info');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }

  // ── AI toggle ──────────────────────────────────────────────────
  async function syncAiState() {
    try {
      const info = await (await fetch('/api/ai/info')).json();
      const cb = document.getElementById('aiToggle');
      const status = document.getElementById('aiStatus');
      const hint = document.getElementById('aiInstallHint');
      cb.checked = !!info.available;
      if (info.available) {
        status.textContent = `✓ on — provider: ${info.provider}, model: ${info.model}, base: ${info.baseUrl}`;
        status.className = 'status ok';
        hint.style.display = 'none';
      } else {
        status.textContent = `off — ${info.reason || 'no AI provider configured'}`;
        status.className = 'status warn';
        hint.style.display = 'block';
      }
    } catch (e) {
      const s = document.getElementById('aiStatus');
      s.textContent = 'failed to read /api/ai/info: ' + e.message;
      s.className = 'status error';
    }
  }
  document.getElementById('aiToggle').addEventListener('change', async (e) => {
    const cb = e.currentTarget;
    cb.disabled = true;
    const target = cb.checked ? 'on' : 'off';
    try {
      const r = await (await fetch('/api/ai/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: target }),
      })).json();
      if (target === 'on' && !r.ok) {
        cb.checked = false;
        showToast(r.reason || 'Could not enable AI', 'error');
      } else {
        showToast(target === 'on'
          ? `AI enabled — ${r.info.provider}/${r.info.model}`
          : 'AI disabled', target === 'on' ? 'ok' : 'info');
      }
    } catch (e) {
      cb.checked = !cb.checked;
      showToast('Toggle failed: ' + e.message, 'error');
    } finally {
      cb.disabled = false;
      syncAiState();
    }
  });

  // ── Default framework ──────────────────────────────────────────
  // [ZAC-FIX] More defensive than the original: surfaces population count
  // in the status line ("loaded N frameworks") so a blank-looking dropdown
  // can never silently fail again. Mirrors the value into the new
  // ZacSettings store (zac_settings.defaultFramework) so other tabs see
  // the same default without a refresh.
  const STORAGE_KEY = 'zac.defaultFramework';

  function frameworkLabel(f) {
    return `${f.label || f.id} — ${f.id}`;
  }

  async function loadFrameworks() {
    const sel = document.getElementById('defaultFramework');
    const status = document.getElementById('frameworkStatus');
    if (!sel || !status) {
      console.warn('[ZAC-FIX] defaultFramework / frameworkStatus element missing');
      return;
    }
    try {
      const resp = await fetch('/api/frameworks');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const r = await resp.json();
      const all = Array.isArray(r.frameworks) ? r.frameworks : [];
      // [ZAC-FIX 2026-05-24] The Recording tab's #framework dropdown
      // hides any framework with uiVisible:false (currently
      // playwright-typescript). Previously this Settings dropdown
      // listed ALL of them, which created an inconsistency: a user
      // could pick "playwright-typescript" here and the Recording tab
      // would silently fall back to playwright-java because the option
      // didn't exist. Filter to the same uiVisible subset so what you
      // see in Settings is what you get in Recording.
      const list = all.filter((f) => f && f.uiVisible !== false);
      const hidden = all.length - list.length;
      // Build a fresh list — atomic replace so the dropdown can never end
      // up with the placeholder alone if the loop trips midway.
      const opts = [
        Object.assign(document.createElement('option'), { value: '', textContent: '(no default — pick per project)' }),
      ];
      for (const f of list) {
        const o = document.createElement('option');
        o.value = f.id;
        o.textContent = frameworkLabel(f);
        opts.push(o);
      }
      sel.innerHTML = '';
      for (const o of opts) sel.appendChild(o);
      if (hidden > 0) {
        console.log('[ZAC-FIX] hid', hidden, 'framework(s) flagged uiVisible:false from #defaultFramework');
      }

      // Restore saved default (legacy localStorage key wins; ZacSettings backstop).
      const saved = localStorage.getItem(STORAGE_KEY)
                 || (window.ZacSettings && window.ZacSettings.get().defaultFramework)
                 || '';
      if (saved && [...sel.options].some(o => o.value === saved)) sel.value = saved;
      else sel.value = '';

      status.className = 'status ok';
      status.textContent = list.length === 0
        ? 'no frameworks reported by /api/frameworks'
        : (saved
            ? `current default: ${saved} · ${list.length} framework${list.length === 1 ? '' : 's'} available`
            : `no default set · pick from ${list.length} framework${list.length === 1 ? '' : 's'}`);

      console.log('[ZAC-FIX] loaded', list.length, 'frameworks into #defaultFramework');
    } catch (e) {
      status.textContent = 'failed to load /api/frameworks: ' + e.message;
      status.className = 'status error';
      console.error('[ZAC-FIX] loadFrameworks failed', e);
    }
  }
  document.getElementById('defaultFramework').addEventListener('change', (e) => {
    const v = e.currentTarget.value;
    if (v) localStorage.setItem(STORAGE_KEY, v);
    else localStorage.removeItem(STORAGE_KEY);
    if (window.ZacSettings) window.ZacSettings.set({ defaultFramework: v || '' });
    document.getElementById('frameworkStatus').textContent =
      v ? `saved: ${v}` : 'cleared';
    document.getElementById('frameworkStatus').className = 'status ok';
    showToast(v ? `Default framework set to ${v}` : 'Default framework cleared', 'ok');
  });

  // ── Server info ────────────────────────────────────────────────
  async function loadServerInfo() {
    try {
      const live = await (await fetch('/api/dashboard/live')).json();
      const host = document.getElementById('serverInfoHost');
      const lines = [
        `node:        ${live.server.uptimeSeconds ? '✓ running' : '?'}`,
        `uptime:      ${live.server.uptimeSeconds}s`,
        `heap:        ${live.server.heapUsedMB} MB`,
        `rss:         ${live.server.rssMB} MB`,
        `load (1m):   ${live.server.loadAvg1m ?? 'n/a'}`,
        `now:         ${live.server.nowIso}`,
      ];
      host.textContent = lines.join('\n');
    } catch (e) {
      document.getElementById('serverInfoHost').textContent = 'failed: ' + e.message;
    }
  }

  // ── Email / SMTP config ────────────────────────────────────────
  // The form mirrors /api/email/config exactly. Password is never
  // round-tripped: an empty value means "keep the existing password".
  const EMAIL_FIELDS = [
    ['emailEnabled', 'enabled', 'checked'],
    ['smtpHost',     'host',    'value'],
    ['smtpPort',     'port',    'value'],
    ['smtpSecure',   'secure',  'checked'],
    ['smtpUser',     'user',    'value'],
    ['smtpFrom',     'from',    'value'],
    ['smtpTo',       'to',      'value'],
  ];
  function setEmailStatus(msg, kind = '') {
    const s = document.getElementById('emailStatus');
    s.textContent = msg;
    s.className = 'status ' + kind;
  }
  async function loadEmailConfig() {
    try {
      const cfg = await (await fetch('/api/email/config')).json();
      for (const [domId, key, prop] of EMAIL_FIELDS) {
        const el = document.getElementById(domId);
        if (el) el[prop] = cfg[key] ?? (prop === 'checked' ? false : '');
      }
      const pwd = document.getElementById('smtpPassword');
      if (pwd) {
        pwd.value = '';
        pwd.placeholder = cfg.hasPassword ? '(unchanged — leave empty to keep)' : '(none set yet)';
      }
      if (cfg.enabled && cfg.host) {
        setEmailStatus(`✓ enabled — ${cfg.user || cfg.from || '?'} @ ${cfg.host}:${cfg.port} (source: ${cfg.source})`, 'ok');
      } else if (cfg.host) {
        setEmailStatus(`paused — host ${cfg.host}:${cfg.port} configured but switch is off`, 'warn');
      } else {
        setEmailStatus('not configured — fill in the form below and click Save', 'warn');
      }
    } catch (e) {
      setEmailStatus('failed to read /api/email/config: ' + e.message, 'error');
    }
  }
  function readEmailForm() {
    const v = (id) => document.getElementById(id);
    return {
      enabled:  v('emailEnabled').checked,
      host:     v('smtpHost').value.trim(),
      port:     Number(v('smtpPort').value) || 587,
      secure:   v('smtpSecure').checked,
      user:     v('smtpUser').value.trim(),
      password: v('smtpPassword').value, // empty → server keeps existing
      from:     v('smtpFrom').value.trim(),
      to:       v('smtpTo').value.trim(),
    };
  }
  document.getElementById('emailSaveBtn').addEventListener('click', async () => {
    const btn = document.getElementById('emailSaveBtn');
    btn.disabled = true;
    setEmailStatus('saving…', '');
    try {
      const r = await fetch('/api/email/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(readEmailForm()),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      showToast('Email config saved', 'ok');
      await loadEmailConfig();
    } catch (e) {
      showToast('Save failed: ' + e.message, 'error');
      setEmailStatus('save failed: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
  document.getElementById('emailVerifyBtn').addEventListener('click', async () => {
    const btn = document.getElementById('emailVerifyBtn');
    btn.disabled = true;
    setEmailStatus('verifying SMTP…', '');
    try {
      const r = await (await fetch('/api/email/test', { method: 'POST' })).json();
      if (r.ok) {
        setEmailStatus('✓ ' + r.message, 'ok');
        showToast('SMTP reachable', 'ok');
      } else {
        setEmailStatus('✗ ' + r.message, 'error');
        showToast('Verification failed: ' + r.message, 'error');
      }
    } catch (e) {
      setEmailStatus('verify failed: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
  document.getElementById('emailTestSendBtn').addEventListener('click', async () => {
    const btn = document.getElementById('emailTestSendBtn');
    btn.disabled = true;
    try {
      const r = await (await fetch('/api/email/send-test', { method: 'POST' })).json();
      if (r.ok) showToast('Test email sent (id ' + (r.messageId || 'n/a') + ')', 'ok');
      else      showToast('Send failed: ' + (r.error || 'unknown'), 'error');
    } catch (e) {
      showToast('Send failed: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // ── Capture defaults (failure screenshot + video) ──────────────
  // [ZAC-FIX 2026-05-24] Persist per-browser via ZacSettings so the
  // Recording tab can read these as defaults when firing a rerun.
  // Defaults: failure screenshot ON (everyone wants it), video OFF
  // (expensive — opt-in).
  function syncCaptureUI() {
    const sf = document.getElementById('captureFailureScreenshot');
    const cv = document.getElementById('captureVideo');
    if (!sf || !cv) return;
    const s = (window.ZacSettings && window.ZacSettings.get()) || {};
    sf.checked = (s.captureFailureScreenshot !== false); // default true
    cv.checked = !!s.captureVideo;                       // default false
    const status = document.getElementById('captureStatus');
    if (status) {
      status.className = 'status ok';
      status.textContent = 'screenshots: ' + (sf.checked ? 'on' : 'off')
        + ' · video: ' + (cv.checked ? 'on' : 'off');
    }
  }
  function bindCaptureToggle(domId, settingKey) {
    const el = document.getElementById(domId);
    if (!el || !window.ZacSettings) return;
    el.addEventListener('change', () => {
      window.ZacSettings.set({ [settingKey]: !!el.checked });
      syncCaptureUI();
      showToast(settingKey + ' = ' + (el.checked ? 'on' : 'off'), 'info');
    });
  }
  bindCaptureToggle('captureFailureScreenshot', 'captureFailureScreenshot');
  bindCaptureToggle('captureVideo',             'captureVideo');
  syncCaptureUI();

  // ── Boot ───────────────────────────────────────────────────────
  syncAiState();
  loadFrameworks();
  loadServerInfo();
  loadEmailConfig();
  setInterval(loadServerInfo, 5_000); // light refresh
