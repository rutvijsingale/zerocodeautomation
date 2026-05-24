/*
 * app-tabs.js — extracted from inline <script> in index.html.
 *
 * Wires the top tab strip (Recording | Dashboard | Settings) and the AI
 * status badge. Kept SEPARATE from app.js so it attaches BEFORE the heavy
 * recorder JS runs — that way clicking a tab is instantaneous and never
 * blocks on app.js initialization.
 *
 * Why external instead of inline: Helmet's default CSP sets
 * `script-src 'self'` (no `'unsafe-inline'`). Inline `<script>` blocks are
 * therefore silently rejected by the browser, and the tab strip never
 * binds — clicking "Dashboard" used to leave the user on the Recording
 * pane with no visible feedback. Same-origin external scripts are allowed
 * by the policy, so we host this here.
 */
(function () {
  const tabs = document.getElementById('appTabs');
  const PANE_PREFIX = 'tab-pane-';

  function switchTo(target) {
    console.log('[Tabs] switching to:', target);
    document.querySelectorAll('#appTabs button').forEach((b) => {
      const active = b.dataset.tab === target;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-pane').forEach((p) => {
      p.classList.toggle('active', p.id === PANE_PREFIX + target);
    });
    // Body class so the per-tab accent band on the nav strip updates.
    document.body.classList.remove('tab-recorder', 'tab-dashboard', 'tab-settings');
    document.body.classList.add('tab-' + target);
  }

  if (tabs) {
    tabs.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') return;
      switchTo(e.target.dataset.tab);
    });
  }
  // Initial body class — recorder is the default visible pane.
  document.body.classList.add('tab-recorder');

  // AI badge — non-blocking; failure stays silent.
  // [ZAC-FIX 2026-05-24] Re-render whenever zacFixes broadcasts that AI
  // state changed (same-tab toggle from Settings, cross-tab toggle from
  // another window). Avoids the "AI off everywhere until I refresh" UX.
  function paintAiBadge(info) {
    const b = document.getElementById('aiBadge');
    if (!b) return;
    if (info && info.available) {
      b.classList.add('on'); b.classList.remove('off');
      b.textContent = `AI: ${info.provider} (${info.model})`;
    } else {
      b.classList.remove('on'); b.classList.add('off');
      b.textContent = 'AI: off';
    }
  }
  async function refetchAndBroadcast(reason) {
    try {
      const info = await (await fetch('/api/ai/info')).json();
      paintAiBadge(info);
      // Same-tab event so the dashboard #aiToggleBtn, the floating AI
      // panel's connection badge, and any future listener can react.
      window.dispatchEvent(new CustomEvent('zac:ai-state-changed', {
        detail: { info, reason: reason || 'storage', at: Date.now() },
      }));
    } catch (_) { /* silent */ }
  }
  // Initial fetch
  fetch('/api/ai/info').then((r) => r.json()).then(paintAiBadge).catch(() => {/* silent */});
  // Same-tab live updates from Settings/Dashboard toggles
  window.addEventListener('zac:ai-state-changed', (e) => {
    paintAiBadge(e?.detail?.info);
  });
  // [ZAC-FIX 2026-05-24] Cross-tab bridge — listens for the storage
  // event that fires when ANOTHER tab writes zac_settings (which the
  // dashboard + settings toggles do via ZacSettings.set). Re-fetches
  // /api/ai/info from the server (which is the source of truth) and
  // broadcasts the same in-tab event. This is what makes "toggle in
  // Settings → see it in Recording without refreshing" actually work.
  window.addEventListener('storage', (e) => {
    if (!e || e.key !== 'zac_settings') return;
    let oldOn, newOn;
    try { oldOn = !!(JSON.parse(e.oldValue || '{}').ollamaEnabled); } catch { oldOn = null; }
    try { newOn = !!(JSON.parse(e.newValue || '{}').ollamaEnabled); } catch { newOn = null; }
    if (oldOn === newOn) return; // ai state unchanged in this storage write
    refetchAndBroadcast('cross-tab-storage');
  });
})();
