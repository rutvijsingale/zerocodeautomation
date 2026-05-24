#!/usr/bin/env node
/**
 * Reproduces the exact failure path the user reported:
 *   "After rerunning not even once report is generated in the dashboard"
 *
 * Steps:
 *   1. Open / (Recording UI) headless.
 *   2. Drive the page to:
 *        a. set baseUrl
 *        b. click "Save Project" (writes projects/<id>/project.json so
 *           state.currentProjectId is populated — the precondition the
 *           bug-fix needs).
 *        c. seed state.steps with a small valid recording.
 *        d. click #rerunScript.
 *        e. wait for completion.
 *   3. Hit /api/dashboard/stats and assert ≥1 rerun is attributed to
 *      the project we just saved + the framework + a non-empty
 *      timestamp.
 *   4. Bonus: confirm replay-result.json hit disk under
 *        generated-projects/<framework>/<projectId>/reruns/<test>/<ts>/.
 *   5. Cleanup the project.
 *
 * Run:  node scripts/zac-rerun-dashboard.mjs
 */
import http from 'http';
import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { resolve } from 'path';
import { chromium } from 'playwright';

const BASE = process.env.ZAC_BASE || 'http://127.0.0.1:3000';
const ROOT = resolve(process.cwd());
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
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, timeout: 30000,
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

(async () => {
  console.log(`══ Recording-UI rerun → Dashboard report harness — ${BASE} ══\n`);

  const PID = `ui-rerun-${Date.now()}`;
  const FW = 'playwright-java';

  // Pre-create the project via API (mimics user clicking "Save Project"
  // in the UI but doesn't depend on the recording UI's save button).
  console.log('── 1. Pre-create project (mimics user saving a project) ──');
  const c = await api('POST', '/api/projects',
    { name: PID, framework: FW, baseUrl: 'https://demoqa.com' });
  chk(`project created [${c.status}]`, c.status === 200 || c.status === 201);
  const s = await api('POST', `/api/projects/${PID}/save`, {
    framework: FW, baseUrl: 'https://demoqa.com',
    backgroundSteps: [{ kind: 'navigate', url: 'https://demoqa.com/text-box' }],
    scenarios: [{ name: 'smoke', steps: [
      { kind: 'navigate', url: 'https://demoqa.com/text-box' },
      { kind: 'waitForSelector', selector: '#userName' },
      { kind: 'type', selector: '#userName', value: 'X' },
      { kind: 'click', selector: '#submit' },
    ] }],
    locators: [], steps: [],
  });
  chk(`save [${s.status}]`, s.status === 200 || s.status === 201);

  // Drive the recording UI: select the project, then trigger #rerunScript
  console.log('\n── 2. Drive Recording UI: select project → click rerun ──');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  page.on('console', m => { const t = m.text(); if (/rerun|projectId|persist/i.test(t)) console.log('   [browser]', t.slice(0, 200)); });
  page.on('pageerror', e => console.error('   [pageerror]', e.message));

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Tell app.js which project is loaded (mirrors "Project loaded from dropdown")
  await page.evaluate(({ pid, fw }) => {
    if (!window.state) window.state = {};
    window.state.currentProjectId = pid;
    window.state.currentProjectFramework = fw;
    window.state.currentProjectName = pid;
    // Seed the steps the recorder would have captured
    window.state.steps = [
      { kind: 'navigate', url: 'https://demoqa.com/text-box', normalizedDescription: 'Open' },
      { kind: 'waitForSelector', selector: '#userName', normalizedDescription: 'Wait' },
      { kind: 'type', selector: '#userName', value: 'X', normalizedDescription: 'Type X' },
      { kind: 'click', selector: '#submit', normalizedDescription: 'Submit' },
    ];
    window.state.config = window.state.config || { baseUrl: 'https://demoqa.com' };
    localStorage.setItem('currentProjectId', pid);
  }, { pid: PID, fw: FW });

  // Set headless (recorder defaults to false — we want true here for CI sanity)
  await page.evaluate(() => {
    const h = document.getElementById('headless');
    if (h && !h.checked) h.checked = true;
  });

  // Click rerun. The fix means the payload now includes projectId+framework+testName.
  console.log('   clicking #rerunScript…');
  await page.locator('#rerunScript').click({ timeout: 5000 });

  // Wait until rerun finishes (button re-enables) — generous budget for demoqa
  await page.waitForFunction(() => {
    const b = document.getElementById('rerunScript');
    return b && !b.disabled;
  }, { timeout: 90000 });
  console.log('   rerun completed.');

  await browser.close();

  // ── 3. Dashboard sees it ─────────────────────────────────────────────
  console.log('\n── 3. /api/dashboard/stats sees the rerun ──');
  await new Promise(r => setTimeout(r, 800));  // dashboard fs walk warm-up
  const stats = await api('GET', '/api/dashboard/stats');
  const matchAll = (stats.body?.reruns || []).filter(r => r.projectId === PID);
  chk(`/api/dashboard/stats has ≥1 rerun for ${PID} (${matchAll.length})`, matchAll.length >= 1);
  if (matchAll.length > 0) {
    const r = matchAll[0];
    chk(`framework=${FW} (${r.framework})`,            r.framework === FW);
    chk(`status === 'passed' (${r.status})`,           r.status === 'passed');
    chk(`timestamp populated (${r.timestamp})`,        typeof r.timestamp === 'string' && r.timestamp.length > 0);
    chk(`testName populated (${r.testName})`,          typeof r.testName === 'string' && r.testName.length > 0);
    chk(`executedSteps ≥ 4 (${r.executedSteps})`,      r.executedSteps >= 4);
  }

  // existingOnly=true (the recommended dashboard default — guards against orphan dirs)
  const stats2 = await api('GET', '/api/dashboard/stats?existingOnly=true');
  const match2 = (stats2.body?.reruns || []).filter(r => r.projectId === PID);
  chk(`existingOnly=true also sees the rerun (${match2.length})`, match2.length >= 1);

  // ── 4. replay-result.json on disk ────────────────────────────────────
  console.log('\n── 4. replay-result.json on disk ──');
  const projDir = resolve(ROOT, 'generated-projects', FW, PID, 'reruns');
  const found = spawnSync('find', [projDir, '-name', 'replay-result.json']).stdout.toString().trim();
  chk(`replay-result.json found under ${FW}/${PID}/reruns/`,
    found.length > 0,
    found || 'no file found');

  // ── 5. HTML report renders for the rerun ─────────────────────────────
  console.log('\n── 5. /api/dashboard/report/html renders ──');
  if (matchAll.length > 0) {
    const r = matchAll[0];
    const rp = `${FW}/${PID}/reruns/${r.testName}/${r.timestamp}`;
    const html = await api('GET', `/api/dashboard/report/html?path=${encodeURIComponent(rp)}`);
    chk(`HTTP 200 (${html.status})`, html.status === 200);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────
  console.log('\n── Cleanup ──');
  await api('DELETE', `/api/projects/${PID}`);

  console.log('\n═══ Summary ═══');
  console.log(`   Total: ${T.pass + T.fail}    ✓ ${T.pass}    ✗ ${T.fail}`);
  if (T.fail) {
    console.log('\n   Failures:');
    for (const f of T.fails) console.log(`     - ${f.label}${f.detail ? '  — ' + f.detail : ''}`);
  }
  process.exit(T.fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
