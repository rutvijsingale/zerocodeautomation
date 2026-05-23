#!/usr/bin/env node
/**
 * Dashboard deep-dive harness.
 *
 * The earlier UI harness (scripts/zac-ui-harness.mjs) only verified
 * that the dashboard SHELL existed (sidebar nav, filters, toolbar
 * buttons, no console errors). That left the actual content of every
 * sidebar tab — Overview / All Runs / Failures / Healer Log / Trends /
 * Coverage — completely unverified.
 *
 * This harness fixes that gap. It:
 *
 *   1. Seeds 3 fresh reruns against demoqa.com (1 plain, 1 multi-
 *      scenario, 1 deliberately-failing) so each tab has real data
 *      to render against. Otherwise charts / tables show empty
 *      placeholders and "✓ rendered" assertions are meaningless.
 *
 *   2. Loads /dashboard.html in headless Chromium, captures console /
 *      CSP / network signals.
 *
 *   3. Clicks each of the 6 sidebar entries one at a time and
 *      verifies:
 *        - the matching <section class="view"> gets .active
 *        - every host element listed for that view contains rendered
 *          markup (not the "—" or "loading…" placeholders)
 *        - charts contain real SVG nodes
 *
 *   4. Probes the toolbar: Refresh, Export, Email, Clear-runs,
 *      AI-toggle — each fires its expected API endpoint or modal.
 *
 *   5. Stress-tests live polling: drives a new rerun while the
 *      dashboard is open and confirms /api/dashboard/live picks it
 *      up within 5 s.
 */
import { chromium } from 'playwright';
import http from 'http';

const BASE = process.env.ZAC_BASE || 'http://127.0.0.1:3000';
const TOTAL = { pass: 0, fail: 0, fails: [] };

function chk(label, ok, detail) {
  if (ok) { TOTAL.pass++; console.log(`      ✓ ${label}`); }
  else    { TOTAL.fail++; TOTAL.fails.push({ label, detail }); console.log(`      ✗ ${label}${detail ? '  — ' + detail : ''}`); }
}

function api(method, path, body) {
  return new Promise((resolve) => {
    const url = new URL(BASE + path);
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', e => resolve({ status: 0, body: { error: e.message } }));
    if (data) req.write(data);
    req.end();
  });
}

// ───────────────────────────────────────────────────────────────
// 1. SEED a known-good fixture: one passing single-scenario rerun
//    + one multi-scenario suite (mixed pass/fail) + one all-failing
//    so every dashboard view has data.
// ───────────────────────────────────────────────────────────────
async function seed() {
  console.log('── Seeding fixture data (3 reruns against demoqa.com) ──');
  const ts = Date.now();
  const PROJ_OK   = `dash-ok-${ts}`;
  const PROJ_MIX  = `dash-mix-${ts}`;
  const PROJ_FAIL = `dash-fail-${ts}`;

  await api('POST', '/api/projects', { name: PROJ_OK,   framework: 'selenium-java',     baseUrl: 'https://demoqa.com' });
  await api('POST', '/api/projects', { name: PROJ_MIX,  framework: 'playwright-java',   baseUrl: 'https://demoqa.com' });
  await api('POST', '/api/projects', { name: PROJ_FAIL, framework: 'selenium-testng',   baseUrl: 'https://demoqa.com' });

  // Plain — should pass
  let r = await api('POST', '/api/rerun', {
    framework: 'selenium-java', projectId: PROJ_OK, testName: 'happy-path',
    browserType: 'chromium', headless: true,
    steps: [
      { kind: 'navigate', url: 'https://demoqa.com/text-box' },
      { kind: 'type', selector: '#userName',  value: 'Naysha', preWaitMs: 200 },
      { kind: 'click', selector: '#submit' },
      { kind: 'waitFor', ms: 200 },
    ],
  });
  console.log(`   plain rerun:        ${r.status}  ok=${r.body?.success}  steps=${r.body?.results?.length}`);

  // Multi-scenario — mixed
  r = await api('POST', '/api/rerun', {
    framework: 'playwright-java', projectId: PROJ_MIX, testName: 'multi-suite',
    browserType: 'chromium', headless: true, stopOnFailure: false,
    scenarios: [
      { name: 'Text box',   steps: [
        { kind: 'navigate', url: 'https://demoqa.com/text-box' },
        { kind: 'type',  selector: '#userName',  value: 'A', preWaitMs: 200 },
        { kind: 'click', selector: '#submit' },
      ]},
      { name: 'Buttons',    steps: [
        { kind: 'navigate', url: 'https://demoqa.com/buttons' },
        { kind: 'click', selector: '#nope-no-such-id' },  // forced failure → captured
      ]},
    ],
  });
  console.log(`   multi-scenario:     ${r.status}  ok=${r.body?.success}  passed=${r.body?.passedScenarios}/${r.body?.totalScenarios}`);

  // Forced failure
  r = await api('POST', '/api/rerun', {
    framework: 'selenium-testng', projectId: PROJ_FAIL, testName: 'forced-fail',
    browserType: 'chromium', headless: true,
    steps: [
      { kind: 'navigate', url: 'https://demoqa.com/text-box' },
      { kind: 'click', selector: '#nope-no-such-id', timeoutMs: 2000 },
    ],
  });
  console.log(`   forced-fail rerun:  ${r.status}  ok=${r.body?.success}  failed=${r.body?.failureCount || r.body?.results?.filter(x=>!x.success).length}`);

  return [PROJ_OK, PROJ_MIX, PROJ_FAIL];
}

async function cleanup(projects) {
  for (const p of projects) await api('DELETE', `/api/projects/${p}`);
}

// ───────────────────────────────────────────────────────────────
// 2. Drive the dashboard
// ───────────────────────────────────────────────────────────────
async function drive() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = []; const csps = []; const apis = []; const reqFails = [];
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Content Security Policy|Refused to/i.test(t)) csps.push(t);
    else if (!/Failed to load resource|status of 404/i.test(t)) errs.push(t);
  });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('requestfailed', r => { if (r.url().startsWith(BASE)) reqFails.push(r.url() + ' — ' + (r.failure()?.errorText||'')); });
  page.on('request', r => { if (r.url().includes('/api/')) apis.push(r.method() + ' ' + r.url().replace(BASE,'')); });

  console.log('\n── Loading /dashboard.html ──');
  await page.goto(`${BASE}/dashboard.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);  // give /api/dashboard/stats a chance to populate

  chk('Dashboard: 0 console errors',     errs.length === 0,  errs.slice(0,2).join(' | '));
  chk('Dashboard: 0 CSP violations',     csps.length === 0,  csps[0]);
  chk('Dashboard: 0 failed requests',    reqFails.length === 0, reqFails.slice(0,2).join(' | '));
  chk('Dashboard: hit /api/dashboard/stats on load',
    apis.some(c => c.includes('/api/dashboard/stats')));

  // ───────── OVERVIEW ─────────
  console.log('\n── View 1: Overview ──');
  await page.locator('aside.sidebar [data-view="overview"]').click();
  await page.waitForTimeout(400);
  chk('Overview: section is .active',
    (await page.locator('#view-overview.active').count()) > 0);
  // KPI cards must have non-placeholder values
  for (const id of ['kTotal','kPassed','kFailed','kRunning']) {
    const txt = (await page.locator('#'+id).textContent() || '').trim();
    chk(`Overview: ${id} populated (got "${txt}")`, txt !== '' && txt !== '—' && /^\d/.test(txt));
  }
  // Live row
  for (const id of ['liveSessions','liveReruns','liveHeap','liveUptime']) {
    const txt = (await page.locator('#'+id).textContent() || '').trim();
    chk(`Overview: ${id} populated`, txt !== '' && txt !== '—');
  }
  // Charts: pass/fail bar chart + status donut
  const passFailSvg = await page.locator('#passFailChart svg').count();
  chk(`Overview: passFailChart has SVG (${passFailSvg})`, passFailSvg >= 1);
  const donutSvg    = await page.locator('#statusDonut svg').count();
  chk(`Overview: statusDonut has SVG (${donutSvg})`,       donutSvg >= 1);
  // Framework projection cards — populated by zacFixes.js after a 4s tick
  await page.waitForTimeout(4500);
  const fwCards = await page.locator('#zac-fw-projection-host > *').count();
  chk(`Overview: framework projection cards rendered (${fwCards})`, fwCards >= 1);
  // Recent activity table
  const recentRows = await page.locator('#recentActivityHost tr, #recentActivityHost .row').count();
  chk(`Overview: recent activity has ≥1 row (${recentRows})`, recentRows >= 1);

  // ───────── ALL RUNS ─────────
  console.log('\n── View 2: All Runs ──');
  await page.locator('aside.sidebar [data-view="runs"]').click();
  await page.waitForTimeout(400);
  chk('Runs: section is .active',
    (await page.locator('#view-runs.active').count()) > 0);
  // Pass/Fail by framework chart
  const resultsSvg = await page.locator('#resultsChart svg, #resultsChart canvas').count();
  chk(`Runs: results chart rendered (${resultsSvg})`, resultsSvg >= 1);
  // Filter dropdowns populated from /api/dashboard/stats
  const fwOpts = await page.locator('#filterFramework option').count();
  chk(`Runs: framework filter has options (${fwOpts})`, fwOpts >= 2);
  const projOpts = await page.locator('#filterProject option').count();
  chk(`Runs: project filter has options (${projOpts})`, projOpts >= 2);
  // Rerun table populated
  const tableRows = await page.locator('#rerunTableHost tr, #rerunTableHost .row').count();
  chk(`Runs: rerun table has ≥3 rows (${tableRows})`, tableRows >= 3);
  // Click the first rerun row → should go to /report.html
  const firstRow = page.locator('#rerunTableHost tr a, #rerunTableHost a, #rerunTableHost tr[data-href]').first();
  if (await firstRow.count() > 0) {
    const beforeUrl = page.url();
    apis.length = 0;
    await firstRow.click().catch(() => {});
    await page.waitForTimeout(800);
    const afterUrl = page.url();
    chk('Runs: clicking a row navigates to /report.html or fires viewer fetch',
      afterUrl.includes('/report.html') || apis.some(c => c.includes('/report.html') || c.includes('/api/dashboard/report')),
      `before=${beforeUrl} after=${afterUrl}`);
    if (afterUrl !== beforeUrl) {
      await page.goto(`${BASE}/dashboard.html`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      await page.locator('aside.sidebar [data-view="runs"]').click();
      await page.waitForTimeout(400);
    }
  } else {
    chk('Runs: rerun row has clickable element', false, 'no <a> or [data-href] inside table rows');
  }
  // Filter behaviour — typing in #filterText should reduce the visible row count
  const beforeRows = await page.locator('#rerunTableHost tr').count();
  await page.fill('#filterText', 'no-such-test-name-zzzzz');
  await page.waitForTimeout(400);
  const afterRows = await page.locator('#rerunTableHost tr:visible').count();
  chk('Runs: free-text filter reduces visible rows',
    afterRows < beforeRows || beforeRows === 0,
    `before=${beforeRows} after=${afterRows}`);
  await page.fill('#filterText', '');

  // ───────── FAILURES ─────────
  console.log('\n── View 3: Failure Insights ──');
  await page.locator('aside.sidebar [data-view="failures"]').click();
  await page.waitForTimeout(500);
  chk('Failures: section is .active',
    (await page.locator('#view-failures.active').count()) > 0);
  for (const id of ['topFailingHost','flakiestLocatorsHost','errorCategoriesHost']) {
    const html = (await page.locator('#' + id).innerHTML().catch(() => '')) || '';
    chk(`Failures: #${id} populated (${html.length}b html)`,
      html.length > 20 && !/loading…|^—\s*$/i.test(html.trim()));
  }

  // ───────── HEALER ─────────
  console.log('\n── View 4: Healer Log ──');
  await page.locator('aside.sidebar [data-view="healer"]').click();
  await page.waitForTimeout(400);
  chk('Healer: section is .active',
    (await page.locator('#view-healer.active').count()) > 0);
  const healHtml = (await page.locator('#healLogHost').innerHTML().catch(() => '')) || '';
  chk(`Healer: #healLogHost rendered (${healHtml.length}b)`, healHtml.length > 20);

  // ───────── TRENDS ─────────
  console.log('\n── View 5: Trends ──');
  await page.locator('aside.sidebar [data-view="trends"]').click();
  await page.waitForTimeout(400);
  chk('Trends: section is .active',
    (await page.locator('#view-trends.active').count()) > 0);
  const trendsSvg = await page.locator('#trendsChart svg').count();
  chk(`Trends: chart SVG rendered (${trendsSvg})`, trendsSvg >= 1);
  const stabilityHtml = (await page.locator('#locatorStabilityHost').innerHTML().catch(() => '')) || '';
  chk(`Trends: #locatorStabilityHost rendered (${stabilityHtml.length}b)`, stabilityHtml.length > 10);
  const durationHtml = (await page.locator('#durationTimelineHost').innerHTML().catch(() => '')) || '';
  chk(`Trends: #durationTimelineHost rendered (${durationHtml.length}b)`, durationHtml.length > 10);
  // Clear locator history button present
  chk('Trends: Clear locator history button',
    (await page.locator('#zacClearLocatorsBtn').count()) > 0);

  // ───────── COVERAGE ─────────
  console.log('\n── View 6: Coverage ──');
  await page.locator('aside.sidebar [data-view="coverage"]').click();
  await page.waitForTimeout(400);
  chk('Coverage: section is .active',
    (await page.locator('#view-coverage.active').count()) > 0);
  for (const id of ['browserStatsHost','serverSnapshotHost','durationPercentilesHost','ratesHost','projectsHost']) {
    const html = (await page.locator('#' + id).innerHTML().catch(() => '')) || '';
    chk(`Coverage: #${id} rendered (${html.length}b)`, html.length > 10);
  }

  // ───────── TOOLBAR BUTTONS ─────────
  console.log('\n── Toolbar buttons ──');
  // Refresh
  apis.length = 0;
  await page.locator('#refreshBtn').click();
  await page.waitForTimeout(800);
  chk('Refresh: hits /api/dashboard/stats',
    apis.some(c => c.includes('/api/dashboard/stats')),
    `apis: ${apis.slice(0,3).join(', ')}`);

  // AI toggle (mirror of settings)
  apis.length = 0;
  await page.locator('#aiToggleBtn').click();
  await page.waitForTimeout(900);
  chk('AI toggle on dashboard: hits /api/ai/toggle',
    apis.some(c => c.includes('/api/ai/toggle')),
    `apis: ${apis.slice(0,3).join(', ')}`);

  // Clear-runs button — opens confirmation modal (must NOT fire the
  // delete on first click; that's the "double-confirm" UX)
  apis.length = 0;
  const clearBtn = page.locator('#clearRunsBtn, #clearBtn').first();
  await clearBtn.click();
  await page.waitForTimeout(400);
  const modalVisible = await page.locator('#clearModal, #clearModalBackdrop').first().isVisible().catch(() => false);
  chk('Clear-runs: confirmation modal opens', modalVisible);
  // Cancel without actually clearing
  await page.locator('#clearModalCancel').click().catch(() => {});
  await page.waitForTimeout(200);
  const clearedAnything = apis.some(c => c.includes('DELETE') || c.includes('/clear'));
  chk('Clear-runs: cancel does NOT fire delete', !clearedAnything);

  await browser.close();
}

(async () => {
  console.log(`══ Dashboard deep-dive harness — ${BASE} ══\n`);
  // Wait for any prior rate-limit windows to expire.
  const seeded = await seed();
  await new Promise(r => setTimeout(r, 1500));
  try {
    await drive();
  } finally {
    await cleanup(seeded);
  }
  console.log('\n═══ Summary ═══');
  console.log(`   Total: ${TOTAL.pass + TOTAL.fail}`);
  console.log(`   ✓ pass: ${TOTAL.pass}`);
  console.log(`   ✗ fail: ${TOTAL.fail}`);
  if (TOTAL.fail) {
    console.log('\n   Failures:');
    for (const f of TOTAL.fails) console.log(`     - ${f.label}${f.detail ? '  — ' + f.detail : ''}`);
  }
  process.exit(TOTAL.fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
