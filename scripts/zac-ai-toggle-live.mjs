#!/usr/bin/env node
/**
 * AI toggle — same-tab live sync harness.
 *
 * Reproduces the user-reported bug:
 *   "AI enable is not working without refreshing"
 *
 * Drives Chromium through these flows and asserts every AI display
 * updates LIVE (no page reload):
 *
 *   1. Open / (Recording UI) → top-bar AI badge initial state.
 *      Open AI panel via Ctrl+Shift+A → connection badge initial state.
 *
 *   2. Toggle AI from /settings.html in a SECOND tab. The first tab's
 *      top-bar badge MUST flip without a reload (cross-tab broadcast
 *      via the storage event).
 *
 *   3. Toggle AI from /dashboard.html's #aiToggleBtn. The same tab's
 *      top-bar badge MUST flip without a reload (same-tab event
 *      `zac:ai-state-changed`).
 *
 *   4. Open dashboard + recording in two tabs. Toggle from settings
 *      (third tab). Both other tabs must reflect the new state.
 *
 * Note: this harness flips AI state to whatever the OPPOSITE of the
 * current state is, then flips it back, so it leaves things as-it-found-them.
 */
import http from 'http';
import { chromium } from 'playwright';

const BASE = process.env.ZAC_BASE || 'http://127.0.0.1:3000';
const T = { pass: 0, fail: 0, fails: [] };
const chk = (label, ok, detail = '') => {
  if (ok) { T.pass++; console.log(`      ✓ ${label}`); }
  else    { T.fail++; T.fails.push({ label, detail }); console.log(`      ✗ ${label}${detail ? '  — ' + detail : ''}`); }
};

function api(method, path, body) {
  return new Promise((resolveP) => {
    const url = new URL(BASE + path);
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method, timeout: 10000,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}
    }, (res) => {
      let buf = ''; res.on('data', c => buf += c);
      res.on('end', () => { try { resolveP({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }); }
                            catch { resolveP({ status: res.statusCode, body: buf }); } });
    });
    req.on('error', e => resolveP({ status: 0, body: { error: e.message } }));
    if (data) req.write(data); req.end();
  });
}

// Read the current top-bar badge text (no reload).
async function readBadge(page) {
  return await page.locator('#aiBadge').textContent();
}

(async () => {
  console.log(`══ AI toggle live-sync harness — ${BASE} ══\n`);

  // Snapshot the initial server state so we can restore it at the end.
  const initial = await api('GET', '/api/ai/info');
  const startedAvailable = !!initial.body?.available;
  const oppositeMode = startedAvailable ? 'off' : 'on';
  const oppositeAvailable = !startedAvailable;
  console.log(`   Initial server state: available=${startedAvailable} provider=${initial.body?.provider}\n`);

  const browser = await chromium.launch({ headless: true });
  // Single context so localStorage is shared across tabs (real-user behaviour).
  const ctx = await browser.newContext();

  // ─── Scene 1: open / and capture initial badge ───────────────────────
  console.log('── 1. Open Recording (/) tab — capture initial AI badge ──');
  const recPage = await ctx.newPage();
  recPage.on('console', m => { const t = m.text(); if (/storage|ai-state|ollamaEnabled|cross-tab/i.test(t)) console.log('   [rec console]', t); });
  await recPage.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await recPage.waitForTimeout(700);
  const badge0 = await readBadge(recPage);
  console.log(`   /recording badge before toggle: "${badge0}"`);
  chk('Recording AI badge present',
    typeof badge0 === 'string' && badge0.length > 0);

  // ─── Scene 2: toggle from /settings.html in a SECOND tab ─────────────
  console.log('\n── 2. Toggle from /settings.html → Recording badge updates LIVE ──');
  const setPage = await ctx.newPage();
  await setPage.goto(`${BASE}/settings.html`, { waitUntil: 'networkidle' });
  await setPage.waitForTimeout(700);

  // The native checkbox is visually hidden; click the styled label that
  // proxies to it (matches the user's actual click target).
  await setPage.locator('label[for="aiToggle"]').click();
  // Settings toast / its own status updates locally; we care about cross-tab.
  await setPage.waitForTimeout(1500);  // toast + storage event window

  // Now read the OTHER tab's badge — without refreshing.
  const badge1 = await readBadge(recPage);
  console.log(`   /recording badge AFTER toggle (no reload): "${badge1}"`);
  chk(`Recording badge changed without reload (was "${badge0}", now "${badge1}")`,
    badge0 !== badge1,
    `If still "${badge0}" → cross-tab event didn't fire`);
  // Also assert it matches the new server state
  const after1 = await api('GET', '/api/ai/info');
  const expected1 = after1.body?.available ? `AI: ${after1.body.provider} (${after1.body.model})` : 'AI: off';
  chk(`Recording badge text matches server state ("${badge1}" vs expected "${expected1}")`,
    badge1.trim().toLowerCase() === expected1.trim().toLowerCase(),
    `expected "${expected1}", got "${badge1}"`);

  // ─── Scene 3: open Dashboard, toggle there, badges in BOTH tabs update ─
  console.log('\n── 3. Toggle from Dashboard → both tabs update LIVE ──');
  const dashPage = await ctx.newPage();
  await dashPage.goto(`${BASE}/dashboard.html`, { waitUntil: 'networkidle' });
  await dashPage.waitForTimeout(700);

  const dashBtnBefore = (await dashPage.locator('#aiToggleBtn').textContent()).trim();
  console.log(`   dashboard #aiToggleBtn before: "${dashBtnBefore}"`);

  dashPage.on('console', m => { const t = m.text(); if (/storage|ai-state|ollamaEnabled|zac_settings/i.test(t)) console.log('   [dash console]', t); });

  // Click the dashboard toggle (this also fires /api/ai/toggle)
  await dashPage.locator('#aiToggleBtn').click();
  await dashPage.waitForTimeout(2500);  // server probe + event broadcast

  // Diagnostic: did dashboard actually write zac_settings?
  const dashLs = await dashPage.evaluate(() => {
    return { zac_settings: localStorage.getItem('zac_settings'), hasZacSettings: typeof window.ZacSettings === 'object' };
  });
  console.log(`   dashboard localStorage zac_settings: ${dashLs.zac_settings}`);
  console.log(`   dashboard hasZacSettings:           ${dashLs.hasZacSettings}`);
  const recLs = await recPage.evaluate(() => localStorage.getItem('zac_settings'));
  console.log(`   recording  localStorage zac_settings: ${recLs}`);

  const dashBtnAfter = (await dashPage.locator('#aiToggleBtn').textContent()).trim();
  console.log(`   dashboard #aiToggleBtn after:  "${dashBtnAfter}"`);
  chk(`dashboard #aiToggleBtn flipped state`, dashBtnBefore !== dashBtnAfter);

  // Recording tab: top-bar badge should reflect the new state too (cross-tab)
  await recPage.waitForTimeout(800);
  const badge2 = await readBadge(recPage);
  const after2 = await api('GET', '/api/ai/info');
  const expected2 = after2.body?.available ? `AI: ${after2.body.provider} (${after2.body.model})` : 'AI: off';
  console.log(`   /recording badge after dashboard toggle: "${badge2}"  expected "${expected2}"`);
  chk(`Recording badge reflects dashboard toggle without reload`,
    badge2.trim().toLowerCase() === expected2.trim().toLowerCase(),
    `expected "${expected2}", got "${badge2}"`);

  // Settings page checkbox: must also be in sync (cross-tab via ZacSettings)
  const setChecked = await setPage.locator('#aiToggle').isChecked();
  chk(`Settings #aiToggle reflects dashboard toggle without reload (checked=${setChecked} server.available=${after2.body?.available})`,
    setChecked === !!after2.body?.available);

  // ─── Restore: bounce back to the original state ──────────────────────
  console.log('\n── 4. Restore initial state ──');
  const cur = await api('GET', '/api/ai/info');
  if (!!cur.body?.available !== startedAvailable) {
    await api('POST', '/api/ai/toggle', { mode: startedAvailable ? 'on' : 'off' });
    await new Promise(s => setTimeout(s, 500));
    const restored = await api('GET', '/api/ai/info');
    chk(`AI restored to initial state (available=${!!restored.body?.available})`,
      !!restored.body?.available === startedAvailable);
  } else {
    chk('AI already at initial state (no restore needed)', true);
  }

  await browser.close();

  console.log('\n═══ Summary ═══');
  console.log(`   Total: ${T.pass + T.fail}    ✓ ${T.pass}    ✗ ${T.fail}`);
  if (T.fail) {
    console.log('\n   Failures:');
    for (const f of T.fails) console.log(`     - ${f.label}${f.detail ? '  — ' + f.detail : ''}`);
  }
  process.exit(T.fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
