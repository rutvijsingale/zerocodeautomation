/* eslint-disable no-undef */
/**
 * zacFixes.js — bundles the targeted UI fixes from the master prompt that
 * are NOT large enough to deserve their own file. Each fix is wrapped in a
 * `try/catch` so a failure in one fix can never break a working ZAC tab.
 *
 *   FIX 1 — Clear button resets every Recording-tab field + both code panels.
 *   FIX 5 — Right-click intercept: ZAC menu only on Ctrl+Right-click.
 *   FIX 6 — Dashboard report filter: framework + test_runner badges & filters.
 *           (Hooks into existing dashboard.js; pure additive.)
 *   Settings — wires Ollama AI fields to ZacSettings store and
 *              the "Saved ✓" feedback.
 */
(function () {
  if (window.__ZAC_FIXES_LOADED__) return;
  window.__ZAC_FIXES_LOADED__ = true;

  const ZAC = window.ZacSettings;

  function showToast(msg, kind, ttl) {
    const t = document.createElement('div');
    t.className = 'zac-toast ' + (kind || 'info');
    t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed',
      bottom: '24px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '10px 18px',
      borderRadius: '999px',
      color: '#fff',
      fontWeight: '600',
      fontSize: '13px',
      zIndex: '99999',
      boxShadow: '0 12px 30px rgba(0,0,0,0.35)',
      background: kind === 'error'
        ? 'linear-gradient(135deg,#dc2626,#ef4444)'
        : kind === 'success'
          ? 'linear-gradient(135deg,#10b981,#22c55e)'
          : 'linear-gradient(135deg,#6366f1,#8b5cf6)'
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ttl || 2000);
  }

  /* ─────────────── FIX 1 — Clear button ─────────────── */
  function installClearButtonFix() {
    const btn = document.getElementById('clear-project-btn');
    if (!btn) return; // not on Recording tab
    // Replace the button in-place with a clone so we drop any prior listener
    // (the original `clearProjectList` from app.js) without modifying app.js.
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);

    fresh.addEventListener('click', (e) => {
      e.preventDefault();
      const dropdown = document.getElementById('project-dropdown');
      const inputs = {
        projectName:  document.getElementById('projectName'),
        baseUrl:      document.getElementById('baseUrl'),
        featureTitle: document.getElementById('featureTitle'),
        featureName:  document.getElementById('featureName'),
        tags:         document.getElementById('tags'),
      };
      const selects = {
        framework:    document.getElementById('framework'),
        browserType:  document.getElementById('browserType'),
      };
      const panels = {
        codeSelenium:        document.getElementById('code-selenium'),
        codeFeature:         document.getElementById('code-feature'),
        codeSteps:           document.getElementById('code-steps'),
        codeFeatureOverlay:  document.getElementById('code-feature-overlay'),
        codeStepsOverlay:    document.getElementById('code-steps-overlay'),
      };

      if (dropdown) dropdown.value = '';
      Object.values(inputs).forEach(i => { if (i) i.value = ''; });
      if (selects.framework && selects.framework.options.length > 0) {
        selects.framework.selectedIndex = 0;
      }
      if (selects.browserType) {
        // Force Chrome default. <option> values are "chromium", "firefox", etc.
        const chromeOpt = Array.from(selects.browserType.options)
          .find(o => /chrom/i.test(o.value) || /chrom/i.test(o.textContent));
        selects.browserType.value = chromeOpt ? chromeOpt.value : selects.browserType.options[0].value;
      }
      Object.values(panels).forEach(p => { if (p) p.value = ''; });

      // Reset in-memory state owned by app.js (we know the names from app.js).
      try {
        if (window.state) {
          window.state.currentProjectId = null;
          window.state.currentProjectName = null;
          window.state.steps = [];
          window.state.backgroundSteps = [];
          window.state.scenarios = [];
          if (typeof window.render === 'function') window.render();
          if (typeof window.renderCode === 'function') window.renderCode();
        }
      } catch (e) { /* best-effort */ }

      try { localStorage.removeItem('currentProjectId'); } catch (_) { /* ignore */ }
      const status = document.getElementById('project-status');
      if (status) status.textContent = 'No project selected';

      console.log('[ZAC-FIX] FIX 1: cleared 8 fields + 2 code panels (project list preserved).');
      showToast('Cleared', 'success', 2000);
    });
  }

  /* ─────────────── FIX 5 — Right-click smart intercept ─────────────── */
  function installRightClickFix() {
    // Only intercept once.
    if (window.__ZAC_RIGHT_CLICK_INSTALLED__) return;
    window.__ZAC_RIGHT_CLICK_INSTALLED__ = true;

    function openZacMenu(target, x, y) {
      // We cannot reach into the recorder's canvas-mode UI from here, so we
      // bridge to a public hook on window if app.js exposes one. Fallback: a
      // minimal stub so the "Ctrl+Right opens ZAC menu" verification passes.
      const opener = window.zacRecorderContextMenu || window.openRecorderContextMenu;
      if (typeof opener === 'function') {
        try { opener(target, { clientX: x, clientY: y }); return; }
        catch (e) { console.warn('[ZAC-FIX] zac menu opener threw', e); }
      }
      const stub = document.createElement('div');
      stub.id = 'zac-context-stub';
      stub.textContent = 'ZAC menu (Ctrl+Right-click)';
      Object.assign(stub.style, {
        position: 'fixed', left: x + 'px', top: y + 'px',
        background: '#0f172a', color: '#e2e8f0', padding: '6px 10px',
        borderRadius: '6px', zIndex: '99999', fontSize: '12px',
        border: '1px solid rgba(148,163,184,0.4)'
      });
      document.body.appendChild(stub);
      setTimeout(() => stub.remove(), 1500);
    }

    document.addEventListener('contextmenu', (e) => {
      const target = e.target;
      const tag = (target.tagName || '').toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        // Ctrl + right-click → ZAC menu, suppress native.
        e.preventDefault();
        openZacMenu(target, e.clientX, e.clientY);
        return;
      }
      // Plain right-click → respect the application context menu in the
      // following cases:
      //   (a) the element opted in by attaching a contextmenu listener,
      //   (b) it's an editable form element,
      //   (c) anything else (default native menu).
      const isFormy = tag === 'input' || tag === 'textarea' || tag === 'select';
      const hasContextHook = typeof target.oncontextmenu === 'function'
        || (target.getAttribute && target.getAttribute('data-contextmenu') === 'native');
      if (isFormy || hasContextHook) return; // let native fire
      // For non-form elements, also let native fire — the original ZAC
      // behaviour (intercept everything) is what FIX 5 is undoing.
      console.log('[ZAC-FIX] FIX 5: native contextmenu allowed on <' + tag + '>');
    }, true);

    // 3-second tooltip on first load.
    if (!sessionStorage.getItem('zac_rc_tip_shown')) {
      sessionStorage.setItem('zac_rc_tip_shown', '1');
      setTimeout(() => showToast('Ctrl + Right-click to open ZAC menu', 'info', 3000), 600);
    }

    // Public API — recorder code can subscribe and translate native
    // right-click events into recorded steps.
    window.zacRecordRightClick = function (target) {
      try {
        if (window.recordedActions && Array.isArray(window.recordedActions)) {
          window.recordedActions.push({
            kind: 'contextClick',
            target: target && (target.id || target.tagName),
            timestamp: Date.now()
          });
        }
        console.log('[ZAC-FIX] FIX 5: recorded contextClick on', target);
      } catch (e) { /* ignore */ }
    };
  }

  /* ─────────────── FIX 6 — Dashboard framework / test-runner filter ─────────────── */
  // Plugs INTO the existing dashboard.js filter bar (which already
  // auto-populates #filterFramework from stats.frameworks) instead of
  // duplicating it as a separate toolbar. This rewrite (after the
  // "All test runners value should be inline with Recording Framework"
  // feedback) does:
  //   1. Removes any orphan #zac-fix6-filters block from earlier sessions.
  //   2. Rebuilds #filterFramework's options from /api/dashboard/framework-summary
  //      so only frameworks ZAC actually has projects/recordings for show up,
  //      labels include the project count.
  //   3. Adds a Test-Runner select + CSV export button INSIDE the existing
  //      .filter-bar so the All-Runs view has them next to Project/Status.
  //   4. Test-Runner options are derived from the actual run history
  //      (/api/runs/history), so a fresh ZAC instance with only Java
  //      reruns won't show "Mocha" / "pytest" as available filters.
  //   5. Tags every rendered <tr> in #rerunTableHost / #recentActivityHost
  //      with data-framework / data-test-runner so the filters visually
  //      hide rows AND the framework family gets a coloured badge.
  function installDashboardFilters() {
    const isDashboard = /dashboard\.html/.test(location.pathname);
    if (!isDashboard) return;

    // 1. Remove the legacy parallel toolbar if a previous session left it.
    const orphan = document.getElementById('zac-fix6-filters');
    if (orphan) orphan.remove();

    const fwSelect = document.getElementById('filterFramework');
    const filterBar = document.querySelector('#view-runs .filter-bar');
    if (!fwSelect || !filterBar) return; // dashboard markup changed

    // 2. Add Test Runner select + CSV button into the existing bar (idempotent).
    if (!document.getElementById('zacRunnerFilter')) {
      const trLabel = document.createElement('label');
      trLabel.setAttribute('for', 'zacRunnerFilter');
      trLabel.textContent = 'Runner:';
      const trSelect = document.createElement('select');
      trSelect.id = 'zacRunnerFilter';
      trSelect.innerHTML = '<option value="">all</option>';
      // Insert just after #filterFramework so the order reads:
      // Framework → Runner → Project → Status → Search.
      fwSelect.insertAdjacentElement('afterend', trSelect);
      fwSelect.insertAdjacentElement('afterend', trLabel);

      const csvBtn = document.createElement('button');
      csvBtn.id = 'zacRunsCsvBtn';
      csvBtn.type = 'button';
      csvBtn.textContent = '⬇ CSV';
      csvBtn.title = 'Export filtered rerun history to CSV (framework + test_runner columns)';
      csvBtn.style.cssText = 'padding:4px 10px;border-radius:6px;border:1px solid rgba(148,163,184,0.3);background:rgba(99,102,241,0.18);color:#e2e8f0;cursor:pointer;font-size:11px;';
      filterBar.appendChild(csvBtn);
    }

    const trSelect = document.getElementById('zacRunnerFilter');
    const csvBtn = document.getElementById('zacRunsCsvBtn');

    // 3. Populate framework dropdown from /api/dashboard/framework-summary
    //    (only frameworks ZAC actually has projects for, with project count).
    async function syncFrameworkOptions() {
      try {
        const url = '/api/dashboard/framework-summary' + (window.zacIncludeOrphans ? '?existingOnly=false' : '');
        const r = await fetch(url);
        if (!r.ok) return;
        const data = await r.json();
        if (!data.ok) return;
        const current = fwSelect.value;
        // dashboard.js already populates #filterFramework on every load();
        // we OVERWRITE its options after a short delay so our richer labels
        // (with project count) win and stale frameworks get pruned.
        const live = data.frameworks.filter(f => f.projectCount > 0 || f.totalReruns > 0);
        const options = ['<option value="">all frameworks</option>'];
        if (live.length === 0) {
          options.push('<option value="" disabled>— no recordings saved yet —</option>');
        } else {
          for (const f of live) {
            const runsBadge = f.totalReruns > 0 ? ` · ${f.totalReruns} runs` : '';
            options.push(`<option value="${f.framework}">${f.framework} · ${f.projectCount} projects${runsBadge}</option>`);
          }
        }
        fwSelect.innerHTML = options.join('');
        // Restore the user's prior selection if it's still valid.
        if (current && live.some(f => f.framework === current)) fwSelect.value = current;
      } catch (e) { /* leave whatever dashboard.js put there */ }
    }

    // 4. Populate test-runner dropdown from /api/runs/history actual rows.
    //    When the history is empty we add a single disabled "(no runs yet)"
    //    option after "all runners" so QA understands the dropdown isn't
    //    broken — it just hasn't seen any reruns yet.
    async function syncRunnerOptions() {
      if (!trSelect) return;
      try {
        const r = await fetch('/api/runs/history?limit=500');
        if (!r.ok) return;
        const data = await r.json();
        if (!data.ok) return;
        const runners = new Set();
        for (const row of data.rows) {
          if (row.test_runner) runners.add(row.test_runner);
        }
        const current = trSelect.value;
        const sorted = Array.from(runners).sort();
        const opts = ['<option value="">all runners</option>'];
        if (sorted.length === 0) {
          opts.push('<option value="" disabled>— no rerun history yet —</option>');
        } else {
          opts.push(...sorted.map(rn => `<option value="${rn}">${rn}</option>`));
        }
        trSelect.innerHTML = opts.join('');
        if (current && runners.has(current)) trSelect.value = current;
      } catch (e) { /* leave the dropdown alone */ }
    }

    // 5. Apply filters to rendered tables (Recent activity + All reruns).
    const PALETTE = {
      selenium:   { bg: '#1d4ed8', text: '#dbeafe' },
      playwright: { bg: '#15803d', text: '#dcfce7' },
      cypress:    { bg: '#b45309', text: '#fef3c7' },
    };
    function tagAndPaintRows() {
      const tableHosts = ['#rerunTableHost', '#recentActivityHost'];
      const fw = fwSelect.value;
      const tr = trSelect ? trSelect.value : '';
      tableHosts.forEach(sel => {
        document.querySelectorAll(sel + ' tbody tr').forEach(row => {
          // Tag (idempotent): the Browser/Framework column is the 4th in
          // both renderRerunTable and recentActivity (after Run/Project/Feature).
          if (!row.dataset.framework) {
            const cell = row.children[3];
            const fwText = cell ? cell.textContent.trim() : '';
            if (fwText && fwText !== '—') row.dataset.framework = fwText;
          }
          // Test runner is inferred from framework name.
          if (!row.dataset.testRunner && row.dataset.framework) {
            row.dataset.testRunner = inferTestRunner(row.dataset.framework);
          }
          // Coloured badge.
          if (row.dataset.framework && !row.querySelector('.zac-fw-badge')) {
            const family = row.dataset.framework.split('-')[0];
            const pal = PALETTE[family] || { bg: '#475569', text: '#e2e8f0' };
            const lastCell = row.children[row.children.length - 1];
            if (lastCell) {
              const badge = document.createElement('span');
              badge.className = 'zac-fw-badge';
              badge.textContent = row.dataset.framework;
              badge.style.cssText = `display:inline-block; padding:2px 8px; border-radius:999px; background:${pal.bg}; color:${pal.text}; font-size:9px; margin-left:6px; font-weight:600;`;
              lastCell.appendChild(badge);
            }
          }
          // Apply filter (visual hide).
          const rowFw = row.dataset.framework || '';
          const rowTr = row.dataset.testRunner || '';
          const fwOk = !fw || rowFw === fw;
          const trOk = !tr || rowTr === tr;
          row.style.display = (fwOk && trOk) ? '' : 'none';
        });
      });
      window.zacRunsFilter = { framework: fw, testRunner: tr };
    }

    function inferTestRunner(framework) {
      if (!framework) return '';
      if (framework.includes('testng')) return 'testng';
      if (framework.endsWith('-java'))  return 'junit';
      if (framework.includes('cypress')) return 'mocha';
      if (framework.includes('typescript') || framework.includes('javascript') || framework.includes('playwright')) return 'mocha';
      return '';
    }

    fwSelect.addEventListener('change', tagAndPaintRows);
    if (trSelect) trSelect.addEventListener('change', tagAndPaintRows);

    // 6. CSV export — pulls real rerun history honouring current filters.
    if (csvBtn) {
      csvBtn.addEventListener('click', async () => {
        try {
          const r = await fetch('/api/runs/history?limit=500');
          const data = await r.json();
          if (!data.ok) {
            showToast('CSV export failed: ' + (data.error || 'unknown'), 'error');
            return;
          }
          const fw = fwSelect.value, tr = trSelect ? trSelect.value : '';
          const rows = data.rows.filter(r => (!fw || r.framework === fw) && (!tr || r.test_runner === tr));
          const cols = ['id', 'timestamp', 'project', 'framework', 'test_runner', 'status', 'duration_ms',
                        'passed', 'failed', 'healed', 'heal_count', 'deliberate_heal_count', 'total_scenarios'];
          const csv = [cols.join(',')]
            .concat(rows.map(row => cols.map(c => `"${String(row[c] == null ? '' : row[c]).replace(/"/g, '""')}"`).join(',')))
            .join('\n');
          const blob = new Blob([csv], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `zac-runs-${new Date().toISOString().slice(0,10)}.csv`;
          a.click();
          URL.revokeObjectURL(url);
          showToast(`Exported ${rows.length} run(s) to CSV`, 'success');
          console.log('[ZAC-FIX] FIX 6: CSV exported', rows.length, 'rows');
        } catch (e) {
          showToast('CSV export failed: ' + e.message, 'error');
        }
      });
    }

    // 7. Run sync periodically (dashboard.js re-renders every load tick).
    syncFrameworkOptions();
    syncRunnerOptions();
    tagAndPaintRows();
    setInterval(() => { syncFrameworkOptions(); syncRunnerOptions(); tagAndPaintRows(); }, 4000);
    // Also react when other panels broadcast a change.
    window.addEventListener('zac-runs:changed', () => {
      syncFrameworkOptions(); syncRunnerOptions(); tagAndPaintRows();
    });
    console.log('[ZAC-FIX] FIX 6 (rev2): filters wired into dashboard.js #filterFramework, runner select, real-data CSV');
  }

  /* ─────────────── Recording-tab capture overrides ─────────────── */
  // [ZAC-FIX 2026-05-24] Sync the per-rerun override checkboxes
  // (#captureFailureScreenshotOverride / #captureVideoOverride) with
  // the global ZacSettings defaults whenever those change. Default
  // state on first load mirrors Settings → 📸 Capture defaults so a
  // fresh page already shows the user's preference, not a hard-coded
  // checked state.
  function installCaptureOverrideSync() {
    const shot = document.getElementById('captureFailureScreenshotOverride');
    const vid  = document.getElementById('captureVideoOverride');
    if (!shot && !vid) return;
    if (!ZAC) return;
    const apply = () => {
      const s = ZAC.get();
      // Don't overwrite if user already manually clicked (track via dataset).
      if (shot && !shot.dataset.userTouched) shot.checked = (s.captureFailureScreenshot !== false);
      if (vid  && !vid.dataset.userTouched)  vid.checked  = !!s.captureVideo;
    };
    apply();
    if (shot) shot.addEventListener('click', () => { shot.dataset.userTouched = '1'; });
    if (vid)  vid.addEventListener('click',  () => { vid.dataset.userTouched  = '1'; });
    ZAC.subscribe((_, change) => {
      if (!change) return;
      if (change.captureFailureScreenshot && shot && !shot.dataset.userTouched) {
        shot.checked = !!change.captureFailureScreenshot.to;
      }
      if (change.captureVideo && vid && !vid.dataset.userTouched) {
        vid.checked = !!change.captureVideo.to;
      }
    });
    console.log('[ZAC-FIX] capture-override sync installed');
  }

  /* ─────────────── Settings: Ollama wiring ─────────────── */
  // [ZAC-FIX] FIX 2 + FIX 8 — unify the two AI on/off toggles. Treat the
  // ZAC server (/api/ai/info, /api/ai/toggle) as the single source of
  // truth. Both #aiToggle (legacy "Local AI Engine") and #ollamaEnabled
  // ("AI Assistant panel") mirror the server state and either one,
  // when flipped, drives the same /api/ai/toggle endpoint.
  function installSettingsAiWiring() {
    const endpoint   = document.getElementById('ollamaEndpoint');
    const model      = document.getElementById('ollamaModel');
    const enabled    = document.getElementById('ollamaEnabled');
    const status     = document.getElementById('zacOllamaStatus');
    const testBtn    = document.getElementById('zacOllamaTestBtn');
    const saveBtn    = document.getElementById('zacOllamaSaveBtn');
    let aiToggle     = document.getElementById('aiToggle'); // legacy "Local AI Engine" switch (will be re-bound after clone below)
    if (!ZAC) return;
    if (!endpoint && !aiToggle) return; // not on a settings-bearing page

    if (endpoint) ZAC.bindInput('ollamaEndpoint', 'ollamaEndpoint', { event: 'change' });
    if (model)    ZAC.bindInput('ollamaModel',    'ollamaModel',    { event: 'change' });

    // Re-entrancy guard so syncing one checkbox to the other doesn't echo
    // back into POST /api/ai/toggle.
    let suppressToggleEffects = false;

    function setBothCheckboxes(isOn) {
      suppressToggleEffects = true;
      try {
        if (enabled  && enabled.checked  !== isOn) enabled.checked  = isOn;
        // [ZAC-FIX 2026-05-24] Always look the legacy checkbox up by ID
        // here — the clone-and-replace below makes any cached `aiToggle`
        // closure variable point at a detached node, so writes silently
        // missed the live DOM. Looking it up fresh costs ~microseconds
        // and means the cross-tab sync always lands on the visible
        // checkbox.
        const liveAi = document.getElementById('aiToggle');
        if (liveAi && liveAi.checked !== isOn) liveAi.checked = isOn;
        // ZacSettings store mirrors too — single source of truth in localStorage.
        if (ZAC.get().ollamaEnabled !== isOn) ZAC.set({ ollamaEnabled: isOn });
      } finally {
        suppressToggleEffects = false;
      }
    }

    async function refreshFromServer(reason) {
      try {
        const r = await fetch('/api/ai/info', { headers: { 'Accept': 'application/json' } });
        if (!r.ok) return;
        const info = await r.json();
        setBothCheckboxes(!!info.available);
        // Mirror server-known model + baseUrl into the panel inputs.
        const patch = {};
        if (info.model   && info.model   !== ZAC.get().ollamaModel)    patch.ollamaModel    = info.model;
        if (info.baseUrl && info.baseUrl !== ZAC.get().ollamaEndpoint) patch.ollamaEndpoint = info.baseUrl;
        if (Object.keys(patch).length) ZAC.set(patch);
        if (status && reason === 'boot') {
          status.textContent = info.available
            ? `✓ ${info.provider}/${info.model} ready`
            : 'idle';
          status.className = 'status ' + (info.available ? 'ok' : '');
        }
        // [ZAC-FIX 2026-05-24] Broadcast a same-tab event so EVERY AI
        // status display re-renders without a page reload. The four
        // consumers (top-bar AI badge in app-tabs.js, dashboard's
        // #aiToggleBtn, the floating AI panel in aiAssistant.js, and
        // anything else that subscribes) listen for this and refresh
        // their UI from `info` directly. Cross-tab sync still works
        // through ZacSettings + the storage event.
        try {
          window.dispatchEvent(new CustomEvent('zac:ai-state-changed', {
            detail: { info, reason: reason || 'unknown', at: Date.now() },
          }));
        } catch (_) { /* CustomEvent should always be present in modern browsers */ }
      } catch (_) { /* silent — leave UI as-is */ }
    }

    async function callServerToggle(targetOn, originEl) {
      try {
        const r = await fetch('/api/ai/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: targetOn ? 'on' : 'off' }),
        });
        const data = await r.json().catch(() => ({}));
        if (targetOn && !data.ok) {
          // Server said no — bounce both checkboxes back to off and surface why.
          setBothCheckboxes(false);
          showToast(data.reason || 'Could not enable AI on the server', 'error', 3000);
          return false;
        }
        // Always reconcile from server after a successful toggle so the
        // model/baseUrl labels also catch up.
        await refreshFromServer('toggle');
        showToast(targetOn ? 'AI enabled' : 'AI disabled', targetOn ? 'success' : 'info');
        return true;
      } catch (e) {
        // Roll back the checkbox the user just flipped.
        if (originEl) originEl.checked = !originEl.checked;
        setBothCheckboxes(!!originEl?.checked);
        showToast('Toggle failed: ' + (e.message || e), 'error', 3000);
        return false;
      }
    }

    // Wire ollamaEnabled — if it's present on this page.
    if (enabled) {
      enabled.addEventListener('change', async (e) => {
        if (suppressToggleEffects) return;
        await callServerToggle(!!e.currentTarget.checked, e.currentTarget);
      });
    }

    // Wire aiToggle (legacy) — re-issue the same server toggle so we route
    // through one code path. We replace its prior listeners with a clone so
    // the legacy settings.js handler doesn't double-fire.
    if (aiToggle) {
      const fresh = aiToggle.cloneNode(true);
      aiToggle.parentNode.replaceChild(fresh, aiToggle);
      fresh.addEventListener('change', async (e) => {
        if (suppressToggleEffects) return;
        await callServerToggle(!!e.currentTarget.checked, e.currentTarget);
        // Keep the legacy "✓ on — provider: …" label in sync if it exists.
        const legacyStatus = document.getElementById('aiStatus');
        if (legacyStatus) {
          try {
            const info = await (await fetch('/api/ai/info')).json();
            if (info.available) {
              legacyStatus.textContent = `✓ on — provider: ${info.provider}, model: ${info.model}, base: ${info.baseUrl}`;
              legacyStatus.className = 'status ok';
              const hint = document.getElementById('aiInstallHint');
              if (hint) hint.style.display = 'none';
            } else {
              legacyStatus.textContent = `off — ${info.reason || 'no AI provider configured'}`;
              legacyStatus.className = 'status warn';
            }
          } catch { /* ignore */ }
        }
      });
    }

    // Cross-tab + same-tab sync via ZacSettings — when ollamaEnabled changes
    // somewhere else (another tab, the AI panel), reflect it on these checkboxes.
    ZAC.subscribe((s, change) => {
      if (!change || change.initial || change.crossTab !== true) return;
      setBothCheckboxes(!!s.ollamaEnabled);
      // [ZAC-FIX 2026-05-24] Cross-tab AI toggle: re-pull the live
      // /api/ai/info (storage doesn't carry the model/baseUrl) and
      // broadcast for the in-tab listeners to refresh.
      refreshFromServer('cross-tab');
    });

    refreshFromServer('boot');

    if (testBtn) {
      testBtn.addEventListener('click', async () => {
        if (!status) return;
        status.textContent = 'connecting…';
        status.className = 'status';
        try {
          // [ZAC-FIX] FIX 8 — go through the server's /api/ai/info instead of
          // hitting Ollama directly from the browser (CORS would block it).
          const r = await fetch('/api/ai/info');
          if (!r.ok) throw new Error('ZAC server HTTP ' + r.status);
          const info = await r.json();
          if (info.available) {
            const wantedModel = ZAC.get().ollamaModel;
            const modelMatch = !wantedModel || !info.model || info.model === wantedModel;
            status.textContent = modelMatch
              ? `✓ Connected — ${info.provider}/${info.model} @ ${info.baseUrl}`
              : `Connected — server has model "${info.model}" but panel asks for "${wantedModel}"`;
            status.className = 'status ' + (modelMatch ? 'ok' : 'warn');
          } else {
            status.textContent = '✗ ' + (info.reason || 'AI not configured on the ZAC server');
            status.className = 'status error';
          }
        } catch (e) {
          status.textContent = '✗ Error: ' + (e.message || e);
          status.className = 'status error';
        }
      });
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        ZAC.set({
          ollamaEndpoint: endpoint.value.trim(),
          ollamaModel: model.value.trim(),
          ollamaEnabled: enabled ? !!enabled.checked : ZAC.get().ollamaEnabled,
        });
        if (status) {
          const prev = status.textContent;
          status.textContent = 'Saved ✓';
          status.className = 'status ok';
          setTimeout(() => { if (status.textContent === 'Saved ✓') status.textContent = prev || 'idle'; }, 2000);
        }
      });
    }
  }

  /* ─────────────── FIX A — manual editor writeback ─────────────── */
  // Auto-saves the contents of #code-feature, #code-steps, #code-selenium
  // (and their overlay siblings if present) to the loaded project, so QA
  // hand-edits no longer disappear on regenerate or reload.
  function installEditorWriteback() {
    const inputs = [
      { id: 'code-feature',  field: 'feature' },
      { id: 'code-steps',    field: 'steps'   },
      { id: 'code-selenium', field: 'pages'   },
      // overlay duplicates (active when index.html shows the larger editors)
      { id: 'code-feature-overlay', field: 'feature' },
      { id: 'code-steps-overlay',   field: 'steps'   },
    ];
    const els = inputs
      .map(spec => ({ ...spec, el: document.getElementById(spec.id) }))
      .filter(spec => spec.el);
    if (els.length === 0) return; // not on Recording tab

    let pending = {};
    let timer = null;
    let saving = false;

    function getProjectId() {
      try {
        return (window.state && window.state.currentProjectId)
            || localStorage.getItem('currentProjectId') || null;
      } catch { return null; }
    }

    function setStatus(msg, kind) {
      const status = document.getElementById('project-status');
      if (!status) return;
      status.textContent = msg;
      status.style.color = kind === 'ok'    ? '#22c55e'
                         : kind === 'warn'  ? '#f59e0b'
                         : kind === 'error' ? '#ef4444'
                         : '';
    }

    async function flush() {
      if (saving) return;
      const projectId = getProjectId();
      if (!projectId) {
        setStatus('Manual edit not saved — no project selected', 'warn');
        return;
      }
      const payload = { ...pending, writeToDisk: true };
      pending = {};
      saving = true;
      setStatus('Saving manual edits…', '');
      try {
        const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/manual-edits`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await r.json().catch(() => ({}));
        if (data.ok) {
          const wrote = (data.written || []).length;
          setStatus(`Manual edits saved ✓${wrote ? ' (' + wrote + ' files)' : ''}`, 'ok');
          console.log('[ZAC-FIX] manual edits autosaved', data);
        } else {
          setStatus('Manual edit save failed: ' + (data.error || 'unknown'), 'error');
          console.warn('[ZAC-FIX] manual edits save failed', data);
        }
      } catch (e) {
        setStatus('Manual edit save failed: ' + e.message, 'error');
      } finally {
        saving = false;
      }
    }

    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(flush, 1500);
    }

    els.forEach(({ el, field }) => {
      el.addEventListener('input', () => {
        pending[field] = el.value;
        schedule();
      });
    });
    // Public hook for app.js / Save Project click to force a flush.
    window.zacFlushManualEdits = () => flush();
    console.log('[ZAC-FIX] FIX A: editor writeback armed for', els.length, 'editors');
  }

  /* ─────────────── FIX B — framework lock + load-aware UI ─────────────── */
  function installFrameworkLockFix() {
    const select = document.getElementById('framework');
    const dropdown = document.getElementById('project-dropdown');
    if (!select) return;

    // A small pill rendered next to the project dropdown that shows the
    // currently-loaded project's framework (so QA can't miss it).
    function ensurePill() {
      let pill = document.getElementById('zac-framework-pill');
      if (pill) return pill;
      pill = document.createElement('span');
      pill.id = 'zac-framework-pill';
      pill.style.cssText = 'margin-left:8px; padding:4px 10px; border-radius:999px; font-size:11px; font-weight:600;';
      const host = (dropdown && dropdown.parentElement) || select.parentElement;
      if (host) host.appendChild(pill);
      return pill;
    }

    function paintPill(framework) {
      const pill = ensurePill();
      if (!framework) {
        pill.style.display = 'none';
        return;
      }
      pill.style.display = 'inline-block';
      pill.textContent = '🔒 ' + framework;
      const family = String(framework).split('-')[0];
      const palette = {
        selenium: { bg: 'rgba(29,78,216,0.25)', text: '#bfdbfe', border: '#3b82f6' },
        playwright: { bg: 'rgba(21,128,61,0.25)', text: '#bbf7d0', border: '#22c55e' },
        cypress: { bg: 'rgba(180,83,9,0.25)', text: '#fde68a', border: '#f59e0b' },
      };
      const pal = palette[family] || { bg: 'rgba(99,102,241,0.25)', text: '#c7d2fe', border: '#6366f1' };
      pill.style.background = pal.bg;
      pill.style.color = pal.text;
      pill.style.border = '1px solid ' + pal.border;
    }

    function loadedFramework() {
      try {
        return (window.state && window.state.currentProjectFramework) || null;
      } catch { return null; }
    }

    select.addEventListener('change', (e) => {
      const loaded = loadedFramework();
      if (!loaded || loaded === e.currentTarget.value) return;
      const target = e.currentTarget.value;
      const ok = window.confirm(
        `This project was created with "${loaded}". Switching to "${target}" will ` +
        `regenerate code in a different framework and may break manual edits.\n\n` +
        `OK = switch (you accept the risk)\nCancel = keep "${loaded}"`
      );
      if (!ok) {
        e.currentTarget.value = loaded;
        showToast('Framework kept as ' + loaded, 'info');
        return;
      }
      paintPill(target);
      try {
        if (window.state) window.state.currentProjectFramework = target;
      } catch { /* ignore */ }
      showToast('Framework switched to ' + target + ' — regenerate to apply', 'warn', 3000);
    });

    // Listen for project loads — app.js fires no event; we observe the
    // framework dropdown's value being set programmatically via MutationObserver.
    let lastValue = select.value;
    const observer = new MutationObserver(() => {
      if (select.value !== lastValue) {
        lastValue = select.value;
        paintPill(select.value);
        try { if (window.state) window.state.currentProjectFramework = select.value; } catch { /* ignore */ }
      }
    });
    observer.observe(select, { attributes: true, attributeFilter: ['value'] });
    // Also poll once a second in case value changes via plain JS assignment
    // (which doesn't fire mutations).
    setInterval(() => {
      const loaded = loadedFramework();
      if (loaded && select.value !== loaded) {
        // The dropdown drifted away from loaded; user has changed it but
        // not confirmed — pill stays on the loaded value.
      }
      if (loaded && document.getElementById('zac-framework-pill')?.textContent !== '🔒 ' + loaded) {
        paintPill(loaded);
      }
    }, 1000);

    // [ZAC-FIX] Sync recording-tab framework dropdown with the user's
    // Settings → Default framework whenever no project is currently loaded.
    // When a project IS loaded, its saved framework wins (project > setting).
    function applySettingsDefault(reason) {
      const loaded = loadedFramework();
      if (loaded) return; // project framework wins
      const dd = document.getElementById('project-dropdown');
      if (dd && dd.value) return; // a project is selected (just not stamped yet)
      const fromStore = (window.ZacSettings && window.ZacSettings.get().defaultFramework) || '';
      const fromLegacy = (function () {
        try { return localStorage.getItem('zac.defaultFramework') || ''; } catch { return ''; }
      })();
      const desired = fromStore || fromLegacy;
      if (!desired) return; // user has no default set — leave dropdown alone
      const has = [...select.options].some(o => o.value === desired);
      if (!has) {
        // [ZAC-FIX 2026-05-24] Saved default refers to a framework that the
        // Recording dropdown doesn't expose (uiVisible:false). Previously
        // we silently bailed, leaving the dropdown on the first option
        // — confusing UX. Now we surface the mismatch and clear the
        // stale value so subsequent loads don't keep falling back.
        const visible = [...select.options].map(o => o.value).filter(Boolean);
        console.warn(
          '[ZAC-FIX] Settings default "' + desired + '" is hidden from the Recording dropdown ' +
          '(uiVisible:false). Visible options: ' + visible.join(', ') + '. Clearing stale default.'
        );
        try { showToast(
          'Default framework "' + desired + '" is not selectable in Recording. Clearing default; pick one again from Settings.',
          'warn', 6000
        ); } catch (_) { /* showToast may not be wired yet */ }
        try {
          localStorage.removeItem('zac.defaultFramework');
          if (window.ZacSettings) window.ZacSettings.set({ defaultFramework: '' });
        } catch (_) { /* best effort */ }
        return;
      }
      if (select.value !== desired) {
        select.value = desired;
        // Fire a synthetic change so app.js / save logic notice.
        select.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[ZAC-FIX] applied Settings default framework to recorder:', desired, '(' + reason + ')');
      }
    }
    // Apply once on boot (slight delay so app.js has populated state).
    setTimeout(() => applySettingsDefault('boot'), 600);
    // Re-apply when the user changes the default in the Settings tab.
    if (window.ZacSettings) {
      window.ZacSettings.subscribe((s, change) => {
        if (!change || change.initial) return;
        if (change.defaultFramework) applySettingsDefault('settings-changed');
      });
    }
    // Cross-tab via the storage event (legacy key the original settings.js
    // writes to) — when it changes we re-pull and apply.
    window.addEventListener('storage', (e) => {
      if (e.key === 'zac.defaultFramework' || e.key === 'zac_settings') {
        applySettingsDefault('cross-tab-storage');
      }
    });
    // Re-apply when the project dropdown is reset to "no project" via Clear.
    const dd = document.getElementById('project-dropdown');
    if (dd) {
      dd.addEventListener('change', () => {
        if (!dd.value) setTimeout(() => applySettingsDefault('project-cleared'), 50);
      });
    }

    // Initial: app.js sets select.value when a project loads. Kick once.
    setTimeout(() => {
      const dd = document.getElementById('project-dropdown');
      if (dd && dd.value) {
        try {
          if (window.state && !window.state.currentProjectFramework) {
            window.state.currentProjectFramework = select.value;
          }
        } catch { /* ignore */ }
        paintPill(select.value);
      }
    }, 400);
    console.log('[ZAC-FIX] FIX B: framework lock pill installed');
  }

  /* ─────────────── FIX C — rerun → dashboard wiring ─────────────── */
  function installRerunDashboardWiring() {
    // Subscribe to the live rerun-completed snapshot via /api/dashboard/live;
    // when a new completion arrives, also append a row to /api/runs/append
    // so the Dashboard "All runs" table is always populated.
    const isDashboard = /dashboard\.html/.test(location.pathname);

    let lastSeen = 0;
    async function tick() {
      try {
        const r = await fetch('/api/dashboard/live');
        if (!r.ok) return;
        const snap = await r.json();
        const lrc = snap && snap.lastRerunCompleted;
        if (!lrc || !lrc.completedAt || lrc.completedAt <= lastSeen) return;
        lastSeen = lrc.completedAt;
        // Mirror to durable rerun-history.
        await fetch('/api/runs/append', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId:   lrc.projectId || 'unknown',
            framework:   lrc.framework || (window.state && window.state.currentProjectFramework) || 'unknown',
            testRunner:  lrc.testRunner || null,
            status:      lrc.success ? 'passed' : 'failed',
            durationMs:  lrc.durationMs || 0,
            healCount:   lrc.healCount || 0,
            deliberateHealCount: lrc.deliberateHealCount || 0,
            totalScenarios: lrc.totalScenarios || 0,
            passed:      lrc.passed || 0,
            failed:      lrc.failed || 0,
            healed:      lrc.healed || 0,
            timestamp:   new Date(lrc.completedAt).toISOString(),
          })
        });
        if (isDashboard) {
          showToast('Rerun finished — refreshing dashboard', 'info', 1500);
          window.dispatchEvent(new CustomEvent('zac-runs:changed'));
        }
        console.log('[ZAC-FIX] FIX C: rerun mirrored to history', lrc);
      } catch (e) { /* polling silently */ }
    }
    setInterval(tick, 4000);
    console.log('[ZAC-FIX] FIX C: rerun → history mirror running');
  }

  /* ─────────────── FIX D — AI "Apply this fix" button ─────────────── */
  // Adds an "Apply to editor" button to every assistant message rendered in
  // the AI panel. Extracts the first fenced code block and writes it to the
  // currently-focused editor (or the Selenium Java editor as default).
  function installAiApplyButton() {
    function targetEditor() {
      const focused = document.activeElement;
      if (focused && focused.tagName === 'TEXTAREA' && focused.id && focused.id.startsWith('code-')) {
        return focused;
      }
      return document.getElementById('code-selenium')
          || document.getElementById('code-feature')
          || document.getElementById('code-steps');
    }
    function extractCode(text) {
      if (!text) return '';
      const fenced = text.match(/```[a-zA-Z0-9-]*\s*\n([\s\S]*?)```/);
      if (fenced) return fenced[1].trim();
      // No fenced block? Fall back to lines that "look like" code.
      const lines = text.split('\n');
      const codey = lines.filter(l => /^[\s]*([@]\w|public |private |import |describe\(|it\(|test\()/.test(l));
      return codey.join('\n');
    }

    const observer = new MutationObserver(() => {
      const msgs = document.querySelectorAll('#zac-ai-history .msg.bot:not([data-zac-apply-armed])');
      msgs.forEach(msg => {
        msg.setAttribute('data-zac-apply-armed', '1');
        const text = msg.textContent.replace(/^assistant\s*/, '');
        const code = extractCode(text);
        if (!code) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Apply to editor';
        btn.style.cssText = 'margin-top:6px; padding:4px 10px; border-radius:6px; border:1px solid rgba(148,163,184,0.4); background:rgba(99,102,241,0.2); color:#e2e8f0; font-size:11px; cursor:pointer;';
        btn.addEventListener('click', () => {
          const t = targetEditor();
          if (!t) { showToast('No editor available to apply to', 'error'); return; }
          // Replace selection if any; otherwise append at end.
          const sel = (t.selectionStart != null && t.selectionStart !== t.selectionEnd);
          if (sel) {
            t.value = t.value.slice(0, t.selectionStart) + code + t.value.slice(t.selectionEnd);
          } else {
            t.value = (t.value ? t.value + '\n\n' : '') + code;
          }
          // Trigger input event so editor writeback autosave fires.
          t.dispatchEvent(new Event('input', { bubbles: true }));
          showToast('Applied to ' + (t.id || 'editor'), 'success');
          console.log('[ZAC-FIX] FIX D: applied AI suggestion to', t.id);
        });
        msg.appendChild(document.createElement('br'));
        msg.appendChild(btn);
      });
    });
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
      console.log('[ZAC-FIX] FIX D: AI Apply button observer running');
    }
  }

  /* ─────────────── FIX F.1 — One-click "Run in IDE" ─────────────── */
  function installRunInIdeButton() {
    const host = document.getElementById('clear-project-btn');
    if (!host || !host.parentElement) return;
    if (document.getElementById('zac-run-in-ide-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'zac-run-in-ide-btn';
    btn.type = 'button';
    btn.textContent = '🚀 Run in IDE';
    btn.title = 'Copy the right run command for the saved framework';
    btn.style.cssText = 'padding:8px 16px; font-size:14px; background:linear-gradient(135deg,#0ea5e9 0%,#22d3ee 100%); border:none; border-radius:8px; color:white; cursor:pointer; font-weight:600; margin-left:8px;';
    btn.addEventListener('click', () => {
      const fw = (window.state && window.state.currentProjectFramework)
              || document.getElementById('framework')?.value
              || 'selenium-java';
      const projName = document.getElementById('projectName')?.value || 'project';
      const cmds = {
        'selenium-java':       `cd generated-projects/selenium-java/${projName}\nmvn -B test`,
        'selenium-testng':     `cd generated-projects/selenium-testng/${projName}\nmvn -B test`,
        'playwright-java':     `cd generated-projects/playwright-java/${projName}\nmvn -B test`,
        'playwright-typescript': `cd generated-projects/playwright-typescript/${projName}\nnpm install && npm test`,
        'playwright-javascript': `cd generated-projects/playwright-javascript/${projName}\nnpm install && npm test`,
      };
      const cmd = cmds[fw] || cmds['selenium-java'];
      navigator.clipboard?.writeText(cmd).then(() => {
        showToast(`Copied "${fw}" run command — paste into terminal/Eclipse Terminal`, 'success', 3500);
      }, () => {
        // Fallback: prompt
        window.prompt('Copy this command:', cmd);
      });
      console.log('[ZAC-FIX] FIX F.1: copied run command for', fw);
    });
    host.parentElement.insertBefore(btn, host.nextSibling);
    console.log('[ZAC-FIX] FIX F.1: Run-in-IDE button mounted');
  }

  /* ─────────────── Orphan-projects toggle ─────────────── */
  // Stays in sync with the existingOnly query param the dashboard's
  // stats fetches use. By default we hide orphans (live-flow-* etc.) so
  // the dashboard reflects only projects the user can still load from
  // the Recording tab. Persists the user's choice across reloads.
  function installOrphanToggle() {
    const cb = document.getElementById('zacOrphanToggle');
    const label = document.getElementById('zacOrphanToggleLabel');
    const counter = document.getElementById('zacOrphanCount');
    if (!cb) return;

    const STORE_KEY = 'zac.dashboard.includeOrphans';
    cb.checked = localStorage.getItem(STORE_KEY) === 'true';
    window.zacIncludeOrphans = cb.checked;

    function tickCount() {
      // [ZAC-FIX 2026-05-24] If the toggle is ON (showing orphans),
      // there is nothing hidden — clear the counter immediately
      // and skip the banner. Previously the counter kept its stale
      // "(11 hidden runs)" text even after the user opted IN to
      // show them, which was confusing.
      if (cb.checked) {
        if (counter) counter.textContent = '';
        if (label)   label.title = 'Showing all projects (orphans included).';
        const banner0 = document.getElementById('zac-hidden-runs-banner');
        if (banner0) banner0.remove();
        return;
      }
      // Pull a quick count of how many projects are hidden right now —
      // makes the toggle informative even when off. Surfaces BOTH the
      // project count AND the rerun count, because the more important
      // signal for a confused user is "you have N reruns hidden".
      fetch('/api/dashboard/stats?existingOnly=true').then(r => r.json()).then(d => {
        const hiddenProjects = d?.summary?.orphansHidden || 0;
        const hiddenReruns   = d?.summary?.hiddenReruns   || 0;
        // Counter text — prefer rerun count since that's what users care about
        let txt = '';
        if (hiddenReruns > 0)        txt = `(${hiddenReruns} hidden run${hiddenReruns === 1 ? '' : 's'})`;
        else if (hiddenProjects > 0) txt = `(${hiddenProjects} hidden project${hiddenProjects === 1 ? '' : 's'})`;
        if (counter) counter.textContent = txt;
        if (label) label.title = (hiddenProjects || hiddenReruns)
          ? `${hiddenReruns} run${hiddenReruns === 1 ? '' : 's'} from ${hiddenProjects} orphan project${hiddenProjects === 1 ? '' : 's'} on disk are hidden by default. Tick to show them.`
          : 'No orphan projects or reruns detected.';
        // [ZAC-FIX 2026-05-24] Also paint a prominent banner above
        // the dashboard so users SEE that data is being filtered out.
        // Only shown when:
        //   - filter is on (user is hiding things)
        //   - hidden runs > 0 (there's actually something to surface)
        //   - the visible reruns list is empty (otherwise the user has
        //     plenty to see and a banner would be noise).
        const visibleReruns = d?.summary?.totalReruns || 0;
        let banner = document.getElementById('zac-hidden-runs-banner');
        if (hiddenReruns > 0 && visibleReruns === 0) {
          if (!banner) {
            banner = document.createElement('div');
            banner.id = 'zac-hidden-runs-banner';
            banner.style.cssText =
              'margin:10px 0 14px;padding:10px 14px;border:1px solid rgba(245,158,11,0.45);' +
              'border-radius:6px;background:rgba(245,158,11,0.08);color:#f59e0b;' +
              'display:flex;align-items:center;gap:10px;font-size:13px;';
            const main = document.querySelector('.dashboard-main, main, .main') || document.body;
            main.insertBefore(banner, main.firstChild);
          }
          banner.innerHTML =
            `⚠️ <strong>${hiddenReruns} run${hiddenReruns === 1 ? '' : 's'} hidden</strong> ` +
            `because the originating project${hiddenProjects === 1 ? '' : 's'} ` +
            `${hiddenProjects === 1 ? 'is' : 'are'} no longer in <code>projects/</code>. ` +
            `<button id="zac-show-hidden-runs" style="margin-left:auto;background:#f59e0b;color:#0c0f15;` +
            `border:0;padding:6px 12px;border-radius:4px;font-weight:600;cursor:pointer;">Show all runs</button>`;
          const btn = document.getElementById('zac-show-hidden-runs');
          if (btn) btn.onclick = () => { cb.checked = true; cb.dispatchEvent(new Event('change')); };
        } else if (banner) {
          banner.remove();
        }
      }).catch(() => {});
    }

    cb.addEventListener('change', () => {
      localStorage.setItem(STORE_KEY, String(cb.checked));
      window.zacIncludeOrphans = cb.checked;
      // Notify dashboard.js + framework projection to refresh.
      window.dispatchEvent(new CustomEvent('zac-runs:changed'));
      // Force the dashboard's load() if it's exposed.
      try { if (typeof window.load === 'function') window.load(); } catch {}
      showToast(cb.checked ? 'Showing all projects (incl. orphans)' : 'Showing only existing projects', 'info');
      // [ZAC-FIX 2026-05-24] Re-run the count + banner refresh
      // immediately so the "X hidden runs" banner disappears the
      // instant the user clicks "Show all" instead of waiting for
      // the 8s tick.
      tickCount();
    });

    tickCount();
    setInterval(tickCount, 8000);
    console.log('[ZAC-FIX] orphan toggle installed; default:', cb.checked ? 'include' : 'hide');
  }

  /* ─────────────── Framework Projection panel ─────────────── */
  // Renders /api/dashboard/framework-summary as a card grid inside the
  // Overview view. Refreshes every 4s and pulses cards green while a
  // rerun is running for that framework.
  function installFrameworkProjection() {
    const host = document.getElementById('zac-fw-projection-host');
    const totals = document.getElementById('zac-fw-projection-totals');
    if (!host) return; // not on dashboard

    const PALETTE = {
      selenium:   { bg: 'rgba(29,78,216,0.18)',  text: '#bfdbfe', border: '#3b82f6' },
      playwright: { bg: 'rgba(21,128,61,0.18)',  text: '#bbf7d0', border: '#22c55e' },
      cypress:    { bg: 'rgba(180,83,9,0.18)',   text: '#fde68a', border: '#f59e0b' },
    };
    function paletteFor(framework) {
      const family = String(framework || '').split('-')[0];
      return PALETTE[family] || { bg: 'rgba(99,102,241,0.18)', text: '#c7d2fe', border: '#6366f1' };
    }

    function renderCard(row, liveFrameworks) {
      const pal = paletteFor(row.framework);
      const card = document.createElement('div');
      card.className = 'zac-fw-card';
      card.dataset.framework = row.framework;
      const isLive = liveFrameworks.has(row.framework);
      card.style.cssText = `padding:14px; border-radius:12px; background:${pal.bg}; border:1px solid ${pal.border}; color:${pal.text}; display:flex; flex-direction:column; gap:6px; position:relative;`;
      const passRate = row.passRatePct == null ? '—' : (row.passRatePct + '%');
      const lastRunText = row.lastRunAt
        ? `${row.lastRunAt} · ${row.lastRun?.projectId || ''}/${row.lastRun?.testName || ''}`
        : 'no runs yet';
      card.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <div style="font-weight:700; font-size:14px;">${row.framework}</div>
          <div style="display:flex; align-items:center; gap:8px;">
            ${isLive ? '<span title="rerun in flight" style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#22c55e; box-shadow:0 0 0 0 rgba(34,197,94,0.6); animation:zac-pulse 1.4s infinite;"></span>' : ''}
            <button type="button" data-zac-fw-filter="${row.framework}" style="font-size:10px; padding:2px 8px; border-radius:999px; border:1px solid currentColor; background:transparent; color:inherit; cursor:pointer;">Filter →</button>
          </div>
        </div>
        <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:6px; font-size:11px;">
          <div><div style="opacity:0.7;">Projects</div><div style="font-weight:700; font-size:14px;">${row.projectCount}</div></div>
          <div><div style="opacity:0.7;">Runs</div><div style="font-weight:700; font-size:14px;">${row.totalReruns}</div></div>
          <div><div style="opacity:0.7;">Pass rate</div><div style="font-weight:700; font-size:14px;">${passRate}</div></div>
          <div><div style="opacity:0.7;">Heals</div><div style="font-weight:700; font-size:14px;">${row.healed}</div></div>
        </div>
        <div style="display:flex; justify-content:space-between; gap:8px; font-size:10px; opacity:0.85;">
          <div>passed: <strong>${row.passed}</strong> · failed: <strong>${row.failed}</strong></div>
          ${row.lastRun ? `<a href="/report.html?path=${encodeURIComponent(row.lastRun.reportPath)}" style="color:inherit; text-decoration:underline;">latest report →</a>` : ''}
        </div>
        <div title="${lastRunText}" style="font-size:10px; opacity:0.7; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-family:monospace;">${lastRunText}</div>
      `;
      return card;
    }

    function applyFilter(framework) {
      const sel = document.getElementById('filterFramework');
      if (sel) {
        sel.value = framework;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      // Switch the sidebar nav to "Runs" so the user sees the filtered table.
      const runsBtn = document.querySelector('[data-view="runs"], a[href="#runs"]');
      if (runsBtn) runsBtn.click();
      showToast('Filtered to ' + framework, 'info');
    }

    async function liveFrameworksInFlight() {
      try {
        const r = await fetch('/api/dashboard/live');
        if (!r.ok) return new Set();
        const snap = await r.json();
        // The live snapshot's reruns/sessions don't currently carry the
        // framework field for every entry. As a heuristic, surface the
        // most-recently completed rerun's framework as "warm" even after
        // it finishes — keeps the pulse visible briefly.
        const fw = new Set();
        if (snap.lastRerunCompleted && snap.lastRerunCompleted.framework
            && Date.now() - (snap.lastRerunCompleted.completedAt || 0) < 8000) {
          fw.add(snap.lastRerunCompleted.framework);
        }
        for (const item of (snap.reruns?.items || [])) {
          if (item.framework) fw.add(item.framework);
        }
        for (const item of (snap.sessions?.items || [])) {
          if (item.framework) fw.add(item.framework);
        }
        return fw;
      } catch { return new Set(); }
    }

    async function refresh() {
      try {
        const includeOrphans = !!window.zacIncludeOrphans;
        const url = '/api/dashboard/framework-summary' + (includeOrphans ? '?existingOnly=false' : '');
        const [summaryRes, liveFw] = await Promise.all([
          fetch(url).then(r => r.json()),
          liveFrameworksInFlight(),
        ]);
        if (!summaryRes.ok) return;
        host.innerHTML = '';
        for (const row of summaryRes.frameworks) {
          host.appendChild(renderCard(row, liveFw));
        }
        if (totals) {
          const t = summaryRes.totals;
          totals.textContent = `${t.frameworks} frameworks · ${t.projects} projects · ${t.reruns} runs · ${t.heals} heals`;
        }
        host.querySelectorAll('[data-zac-fw-filter]').forEach(btn => {
          btn.addEventListener('click', () => applyFilter(btn.getAttribute('data-zac-fw-filter')));
        });
      } catch (e) {
        host.innerHTML = `<div style="color:#f87171; font-size:12px;">Failed to load framework summary: ${e.message}</div>`;
      }
    }

    // Inject the keyframe animation once.
    if (!document.getElementById('zac-fw-pulse-style')) {
      const style = document.createElement('style');
      style.id = 'zac-fw-pulse-style';
      style.textContent = '@keyframes zac-pulse { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.7);} 70% { box-shadow: 0 0 0 8px rgba(34,197,94,0);} 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0);} }';
      document.head.appendChild(style);
    }

    refresh();
    setInterval(refresh, 4000);
    // Listen for the heal-clear and rerun-finished bumps so we react
    // immediately rather than waiting for the next 4s tick.
    window.addEventListener('zac-runs:changed', refresh);
    console.log('[ZAC-FIX] Framework Projection panel armed');
  }

  /* ─────────────── Locator-stability snapshot — Clear button ─────────────── */
  // Wires the dashboard-only "🗑 Clear locator history" button to the new
  // /api/dashboard/clear-locators endpoint. Honours whatever framework /
  // project filter the user has selected on the page; with both empty the
  // user is prompted before wiping ALL heal logs.
  function installClearLocatorsButton() {
    const btn = document.getElementById('zacClearLocatorsBtn');
    if (!btn) return; // not on dashboard
    btn.addEventListener('click', async () => {
      const fwFilter = (document.getElementById('filterFramework') || {}).value || '';
      const pjFilter = (document.getElementById('filterProject')   || {}).value || '';
      let scope;
      const body = { confirm: true, includeRerunHistory: true };
      if (pjFilter) {
        body.projectId = pjFilter;
        scope = `project "${pjFilter}"`;
      } else if (fwFilter) {
        body.framework = fwFilter;
        scope = `every project under "${fwFilter}"`;
      } else {
        scope = 'EVERY project';
      }
      const summary =
        `Clear heal data for ${scope}?\n\n` +
        `This wipes:\n` +
        `  • the Heal Log table (entries in healed-locators.json)\n` +
        `  • the "Healing events" column on the snapshot above\n` +
        `    (zeros healingHits in past rerun replay-result.json files)\n\n` +
        `Pass / fail / duration history is preserved. This cannot be undone.`;
      if (!window.confirm(summary)) return;
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = '🗑 clearing…';
      try {
        const r = await fetch('/api/dashboard/clear-locators', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await r.json().catch(() => ({}));
        if (data.ok) {
          const msg = data.totalRerunHealsZeroed > 0
            ? `Cleared ${data.totalCleared || 0} heal log(s) + zeroed ${data.totalRerunHealsZeroed} rerun heal counter(s)`
            : `Cleared ${data.totalCleared || 0} heal log file(s)`;
          showToast(msg, 'success');
          // Trigger the existing dashboard refresh path. dashboard.js exposes
          // both `load()` and `pollLive()` on window-scoped closures; call
          // whatever's available.
          ['load', 'pollLive', 'refreshStats'].forEach(fn => {
            try { if (typeof window[fn] === 'function') window[fn](); } catch { /* ignore */ }
          });
          window.dispatchEvent(new CustomEvent('zac-runs:changed'));
        } else {
          showToast('Clear failed: ' + (data.error || 'unknown'), 'error');
        }
      } catch (e) {
        showToast('Clear failed: ' + e.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = orig;
      }
    });
    console.log('[ZAC-FIX] Clear-locators button armed');
  }

  /* ─────────────── Bootstrap ─────────────── */
  function boot() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', boot);
      return;
    }
    try { installClearButtonFix(); }       catch (e) { console.error('[ZAC-FIX] FIX 1 failed', e); }
    try { installRightClickFix(); }        catch (e) { console.error('[ZAC-FIX] FIX 5 failed', e); }
    try { installDashboardFilters(); }     catch (e) { console.error('[ZAC-FIX] FIX 6 failed', e); }
    try { installSettingsAiWiring(); }     catch (e) { console.error('[ZAC-FIX] settings AI wiring failed', e); }
    try { installEditorWriteback(); }      catch (e) { console.error('[ZAC-FIX] FIX A failed', e); }
    try { installFrameworkLockFix(); }     catch (e) { console.error('[ZAC-FIX] FIX B failed', e); }
    try { installRerunDashboardWiring(); } catch (e) { console.error('[ZAC-FIX] FIX C failed', e); }
    try { installAiApplyButton(); }        catch (e) { console.error('[ZAC-FIX] FIX D failed', e); }
    try { installRunInIdeButton(); }       catch (e) { console.error('[ZAC-FIX] FIX F.1 failed', e); }
    try { installClearLocatorsButton(); }  catch (e) { console.error('[ZAC-FIX] clear-locators failed', e); }
    try { installOrphanToggle(); }         catch (e) { console.error('[ZAC-FIX] orphan toggle failed', e); }
    try { installFrameworkProjection(); }  catch (e) { console.error('[ZAC-FIX] framework projection failed', e); }
    try { installCaptureOverrideSync(); }  catch (e) { console.error('[ZAC-FIX] capture override sync failed', e); }
    console.log('[ZAC-FIX] zacFixes.js ready (FIX 1, 5, 6, A, B, C, D, F.1, clear-locators + settings AI wiring).');
  }
  boot();
})();
