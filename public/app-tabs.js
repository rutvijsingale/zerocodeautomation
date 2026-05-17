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
  fetch('/api/ai/info').then((r) => r.json()).then((info) => {
    const b = document.getElementById('aiBadge');
    if (!b) return;
    if (info.available) {
      b.classList.add('on'); b.classList.remove('off');
      b.textContent = `AI: ${info.provider} (${info.model})`;
    } else {
      b.textContent = 'AI: off';
    }
  }).catch(() => { /* silent */ });
})();
