#!/usr/bin/env node
/**
 * globalsqa.com — same 13 scenarios across THREE frameworks, side-by-side
 * comparison report.
 *
 * What this does:
 *   - Creates one project per framework (selenium-java, playwright-java,
 *     playwright-javascript) and KEEPS them on disk so the dashboard
 *     keeps showing them after this script exits.
 *   - Appends the SAME 13 scenarios to each project (so you can compare
 *     the exact same flows running on different generated stacks).
 *   - Re-runs every scenario in every framework via /api/rerun.
 *   - Generates code with /generate-files for each framework.
 *   - Builds an HTML comparison report at
 *       reports/zac-fw-comparison-<timestamp>.html
 *     showing one row per scenario × one column per framework, with
 *     status, duration, step count, and a link to the per-rerun
 *     report/index.html.
 *
 * Run:
 *   node scripts/zac-globalsqa-multi-fw-comparison.mjs
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const BASE = process.env.ZAC_BASE || 'http://127.0.0.1:3000';
const FRAMEWORKS = ['selenium-java', 'playwright-java', 'playwright-javascript'];
const PROJECT_ID_FOR = (fw) => `globalsqa-${fw}`;

const log = (m) => console.log(m);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { ok: r.ok, status: r.status, body: json, text };
}

// Mock backend — keeps dbValidate scenarios self-contained.
function startMock(port = 0) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname === '/api/health')
        return (res.statusCode = 200, res.end(JSON.stringify({ ok: true, env: 'staging' })));
      if (url.pathname === '/api/widgets')
        return (res.statusCode = 200, res.end(JSON.stringify({
          rows: [{ id: 1, kind: 'slider' }, { id: 2, kind: 'datepicker' },
                 { id: 3, kind: 'dialog' }, { id: 4, kind: 'accordion' }],
        })));
      res.statusCode = 404; res.end('{}');
    });
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

// ── 13 scenarios — same across all frameworks ───────────────────────────────
const SITE = {
  slider:       'https://www.globalsqa.com/demoSite/practice/slider/colorpicker.html',
  datepicker:   'https://www.globalsqa.com/demoSite/practice/datepicker/default.html',
  dialog:       'https://www.globalsqa.com/demoSite/practice/dialog/modal-form.html',
  accordion:    'https://www.globalsqa.com/demoSite/practice/accordion/collapsible.html',
  autocomplete: 'https://www.globalsqa.com/demoSite/practice/autocomplete/categories.html',
  progressbar:  'https://www.globalsqa.com/demoSite/practice/progressbar/download.html',
  spinner:      'https://www.globalsqa.com/demoSite/practice/spinner/default.html',
  sortable:     'https://www.globalsqa.com/demoSite/practice/sortable/default.html',
  selectable:   'https://www.globalsqa.com/demoSite/practice/selectable/default.html',
  toolbar:      'https://www.globalsqa.com/demoSite/practice/controlgroup/toolbar.html',
  droppable:    'https://www.globalsqa.com/demoSite/practice/droppable/photo-manager.html',
  tooltipWrap:  'https://www.globalsqa.com/demo-site/tooltip/',
};

function buildScenarios(dbUrl) {
  return [
    {
      id: 'S01.Slider', name: 'Slider › RGB color picker',
      tags: ['@smoke'],
      steps: [
        { kind: 'navigate',        url: SITE.slider },
        { kind: 'waitForSelector', selector: '#red',   timeoutMs: 20000 },
        { kind: 'assertVisible',   selector: '#red' },
        { kind: 'assertVisible',   selector: '#green' },
        { kind: 'assertVisible',   selector: '#blue' },
        { kind: 'assertVisible',   selector: '#swatch' },
      ],
    },
    {
      id: 'S02.DatePicker', name: 'DatePicker › opens calendar',
      tags: ['@smoke'],
      steps: [
        { kind: 'navigate',        url: SITE.datepicker },
        { kind: 'waitForSelector', selector: '#datepicker', timeoutMs: 20000 },
        { kind: 'click',           selector: '#datepicker' },
        { kind: 'waitForSelector', selector: '.ui-datepicker-calendar', timeoutMs: 8000 },
        { kind: 'assertVisible',   selector: '.ui-datepicker-month' },
        { kind: 'screenshot',      filename: 'datepicker.png' },
      ],
    },
    {
      id: 'S03.Dialog', name: 'Dialog › Create user form fill+cancel',
      tags: ['@regression'],
      steps: [
        { kind: 'navigate',        url: SITE.dialog },
        { kind: 'waitForSelector', selector: '#create-user', timeoutMs: 20000 },
        { kind: 'click',           selector: '#create-user' },
        { kind: 'waitForSelector', selector: '#dialog-form', timeoutMs: 8000 },
        { kind: 'fill',            selector: '#name',     value: 'Naysha' },
        { kind: 'fill',            selector: '#email',    value: 'qa@bank.com' },
        { kind: 'fill',            selector: '#password', value: 'P@ss123' },
        { kind: 'assertValue',     selector: '#name',     expectedValue: 'Naysha' },
        { kind: 'click',           selector: 'button:text-is("Cancel")' },
      ],
    },
    {
      id: 'S04.Accordion', name: 'Accordion › expand 3rd section',
      tags: ['@regression'],
      steps: [
        { kind: 'navigate',        url: SITE.accordion },
        { kind: 'waitForSelector', selector: '#accordion', timeoutMs: 20000 },
        { kind: 'waitForSelector', selector: '#ui-id-3',   timeoutMs: 15000 },
        { kind: 'assertCount',     selector: '#accordion h3', expectedCount: 4 },
        { kind: 'waitFor',         ms: 500 },
        { kind: 'click',           selector: '#ui-id-3', timeoutMs: 15000 },
        { kind: 'assertVisible',   selector: '#ui-id-4' },
      ],
    },
    {
      id: 'S05.AutoComplete', name: 'AutoComplete › suggestions appear',
      tags: ['@regression'],
      steps: [
        { kind: 'navigate',        url: SITE.autocomplete },
        { kind: 'waitForSelector', selector: '#search', timeoutMs: 20000 },
        { kind: 'click',           selector: '#search' },
        { kind: 'fill',            selector: '#search', value: 'j' },
        { kind: 'waitFor',         ms: 800 },
        { kind: 'assertVisible',   selector: '.ui-autocomplete' },
      ],
    },
    {
      id: 'S06.ProgressBar', name: 'Progress Bar › download dialog opens',
      tags: ['@regression'],
      steps: [
        { kind: 'navigate',        url: SITE.progressbar },
        { kind: 'waitFor',         ms: 1500 },
        { kind: 'waitForSelector', selector: '#downloadButton', timeoutMs: 20000 },
        { kind: 'assertEnabled',   selector: '#downloadButton' },
        { kind: 'waitFor',         ms: 800 },
        { kind: 'click',           selector: '#downloadButton', timeoutMs: 15000 },
        { kind: 'waitFor',         ms: 1500 },
        { kind: 'waitForSelector', selector: '.ui-dialog', timeoutMs: 10000 },
        { kind: 'assertVisible',   selector: '.ui-dialog' },
      ],
    },
    {
      id: 'S07.Spinner', name: 'Spinner › buttons disable / destroy',
      tags: ['@regression'],
      steps: [
        { kind: 'navigate',        url: SITE.spinner },
        { kind: 'waitForSelector', selector: '#spinner', timeoutMs: 20000 },
        { kind: 'fill',            selector: '#spinner', value: '42' },
        { kind: 'assertValue',     selector: '#spinner', expectedValue: '42' },
        { kind: 'assertEnabled',   selector: '#disable' },
        { kind: 'assertEnabled',   selector: '#destroy' },
        { kind: 'click',           selector: '#disable' },
      ],
    },
    {
      id: 'S08.Sortable', name: 'Sortable › 7 list items present',
      tags: ['@regression'],
      steps: [
        { kind: 'navigate',        url: SITE.sortable },
        { kind: 'waitForSelector', selector: '#sortable', timeoutMs: 20000 },
        { kind: 'assertCount',     selector: '#sortable li', expectedCount: 7 },
        { kind: 'assertVisible',   selector: '#sortable li:nth-child(1)' },
        { kind: 'assertText',      selector: '#sortable li:nth-child(1)', expectedValue: 'Item 1' },
      ],
    },
    {
      id: 'S09.Selectable', name: 'Selectable › 7 selectable items',
      tags: ['@regression'],
      steps: [
        { kind: 'navigate',        url: SITE.selectable },
        { kind: 'waitForSelector', selector: '#selectable', timeoutMs: 20000 },
        { kind: 'assertCount',     selector: '#selectable li', expectedCount: 7 },
        { kind: 'click',           selector: '#selectable li:nth-child(1)' },
        { kind: 'waitFor',         ms: 400 },
        { kind: 'assertVisible',   selector: '#selectable li.ui-selected' },
      ],
    },
    {
      id: 'S10.Toolbar', name: 'Toolbar › all buttons present',
      tags: ['@regression'],
      steps: [
        { kind: 'navigate',        url: SITE.toolbar },
        { kind: 'waitForSelector', selector: '#print', timeoutMs: 20000 },
        { kind: 'assertVisible',   selector: '#print' },
        { kind: 'assertVisible',   selector: '#undo' },
        { kind: 'assertVisible',   selector: '#redo' },
        { kind: 'assertEnabled',   selector: '#zoom-button' },
      ],
    },
    {
      id: 'S11.Droppable', name: 'Droppable › gallery + trash present',
      tags: ['@regression'],
      steps: [
        { kind: 'navigate',        url: SITE.droppable },
        { kind: 'waitForSelector', selector: '#gallery', timeoutMs: 20000 },
        { kind: 'assertVisible',   selector: '#gallery' },
        { kind: 'assertVisible',   selector: '#trash' },
        { kind: 'assertCount',     selector: '#gallery li', expectedCount: 4 },
      ],
    },
    {
      id: 'S12.IframeOnWrapper', name: 'Wrapper › iframe assertion',
      tags: ['@iframe'],
      steps: [
        { kind: 'navigate',        url: SITE.tooltipWrap },
        { kind: 'waitFor',         ms: 3000 },
        { kind: 'assertText',      selector: 'h1, h2.page-title', expectedValue: 'Tooltip' },
        { kind: 'waitForSelector', selector: 'iframe[src*="practice/tooltip"]', timeoutMs: 15000 },
      ],
    },
    {
      id: 'S13.DbValidate', name: 'DB › backend health + widgets',
      tags: ['@db'],
      steps: [
        { kind: 'navigate',        url: 'about:blank' },
        { kind: 'dbValidate',      url: `${dbUrl}/api/health`, expectedStatus: 200,
          expectedJsonPath: 'env',  expectedValue: 'staging' },
        { kind: 'dbValidate',      url: `${dbUrl}/api/widgets`, expectedStatus: 200,
          expectedJsonPath: 'rows', expectedRowCount: 4 },
      ],
    },
  ];
}

async function rerun(framework, projectId, testName, steps) {
  const r = await api('POST', '/api/rerun', {
    steps,
    browserType: 'chromium',
    baseUrl: 'https://www.globalsqa.com',
    headless: true,
    projectId, framework, testName,
    stopOnFailure: false,
    captureFailureScreenshot: true,
    captureVideo: false,
    stepTimeoutMs: 60000,
  });
  return r;
}

(async () => {
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('globalsqa.com — 13 scenarios × 3 frameworks side-by-side');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const { server: mock, url: dbUrl } = await startMock();
  log(`Mock backend → ${dbUrl}`);
  const SCENARIOS = buildScenarios(dbUrl);

  // ── Phase 1: clean any prior state, create projects ────────────────────────
  log('\n── Phase 1: project setup (one per framework) ──');
  for (const fw of FRAMEWORKS) {
    const id = PROJECT_ID_FOR(fw);
    await api('DELETE', `/api/projects/${id}`).catch(() => {});
    const r = await api('POST', '/api/projects', {
      name: id, framework: fw, baseUrl: 'https://www.globalsqa.com',
      description: 'globalsqa.com side-by-side comparison',
    });
    log(`  ✓ ${id}  status=${r.status}`);
  }

  // ── Phase 2: append the SAME 13 scenarios to each project ──────────────────
  log('\n── Phase 2: append 13 scenarios to every project ──');
  for (const fw of FRAMEWORKS) {
    const id = PROJECT_ID_FOR(fw);
    for (const s of SCENARIOS) {
      await api('POST', `/api/projects/${id}/append-steps`, {
        steps: s.steps,
        scenario: {
          id: s.id, name: s.name,
          steps: s.steps.map((a, i) => ({ stepId: `${s.id}-${i}`, action: a })),
          tags: s.tags, createdAt: new Date().toISOString(),
        },
      });
    }
    log(`  ✓ ${id}  appended ${SCENARIOS.length} scenarios`);
  }

  // ── Phase 3: generate code per framework ───────────────────────────────────
  log('\n── Phase 3: /generate-files per framework ──');
  for (const fw of FRAMEWORKS) {
    const r = await api('POST', `/api/projects/${PROJECT_ID_FOR(fw)}/generate-files`, {
      framework: fw, browserType: 'chromium', baseUrl: 'https://www.globalsqa.com',
      featureTitle: 'globalsqa multi-framework comparison', featureName: 'globalsqa-cmp',
      tags: ['@multi-framework'],
    });
    const count = r.body && (r.body.count || (r.body.files && r.body.files.length));
    log(`  ✓ ${fw}: ${count} files`);
  }

  // ── Phase 4: rerun every scenario in every framework, collect results ──────
  log(`\n── Phase 4: ${SCENARIOS.length} × ${FRAMEWORKS.length} = ${SCENARIOS.length * FRAMEWORKS.length} reruns ──`);
  // Matrix[scenarioId][framework] = { ok, durationMs, executedSteps,
  //   failureCount, error, reportRoot, layout }
  const matrix = {};
  for (const s of SCENARIOS) matrix[s.id] = {};

  for (const fw of FRAMEWORKS) {
    for (const s of SCENARIOS) {
      const t0 = Date.now();
      const testName = s.id.toLowerCase().replace(/\W+/g, '-');
      const r = await rerun(fw, PROJECT_ID_FOR(fw), testName, s.steps);
      const elapsed = Date.now() - t0;
      const layout = r.body && (r.body.rerunLayout || r.body.layout);
      const failed = r.body && r.body.results && r.body.results.find(x => !x.success);
      matrix[s.id][fw] = {
        ok: !!(r.body && r.body.success === true && r.body.failureCount === 0),
        durationMs: elapsed,
        executedSteps: r.body && r.body.executedSteps,
        totalSteps: s.steps.length,
        failureCount: r.body ? r.body.failureCount : -1,
        error: failed ? (failed.error || '').slice(0, 200) : null,
        layout,
      };
      const tag = matrix[s.id][fw].ok ? '✓' : '✗';
      log(`  ${tag} ${fw.padEnd(22)} ${s.id.padEnd(20)} ${elapsed}ms ${matrix[s.id][fw].executedSteps}/${s.steps.length}`);
      await sleep(200);
    }
  }
  await new Promise(res => mock.close(res));

  // ── Phase 5: dashboard pull ────────────────────────────────────────────────
  log('\n── Phase 5: dashboard / framework-summary pull ──');
  await sleep(2000);
  const stats = await api('GET', '/api/dashboard/stats?existingOnly=true');
  const fwSum = await api('GET', '/api/dashboard/framework-summary');
  const fwBreakdown = (fwSum.body && fwSum.body.frameworks) || [];

  // ── Phase 6: build the comparison HTML report ──────────────────────────────
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(REPO, 'reports', `zac-fw-comparison-${ts}.html`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });

  function statusCell(cell) {
    if (!cell) return '<td>—</td>';
    const cls = cell.ok ? 'ok' : 'fail';
    const link = cell.layout
      ? `<a href="${path.relative(path.dirname(reportPath), path.join(cell.layout.rerunDir, 'report', 'index.html'))}" target="_blank">open</a>`
      : '';
    const errBadge = cell.error
      ? `<div class="err">${cell.error.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</div>`
      : '';
    return `<td class="${cls}">
      <div><strong>${cell.ok ? 'PASS' : 'FAIL'}</strong></div>
      <div class="meta">${cell.executedSteps}/${cell.totalSteps} steps · ${cell.durationMs} ms</div>
      <div class="meta">${link}</div>
      ${errBadge}
    </td>`;
  }

  // Per-framework totals
  const totals = Object.fromEntries(FRAMEWORKS.map(fw => [fw, { pass: 0, fail: 0, ms: 0 }]));
  for (const s of SCENARIOS) {
    for (const fw of FRAMEWORKS) {
      const c = matrix[s.id][fw];
      if (c) { totals[fw].ms += c.durationMs; if (c.ok) totals[fw].pass++; else totals[fw].fail++; }
    }
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"/>
<title>ZAC framework comparison · ${ts}</title>
<style>
  body { font: 14px -apple-system, system-ui, sans-serif; margin: 24px; background: #f7f7f9; color: #1a1a2e; }
  h1 { margin: 0 0 8px; }
  .sub { color: #666; margin-bottom: 18px; }
  table { border-collapse: collapse; width: 100%; background: white; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  th, td { border: 1px solid #e5e7eb; padding: 8px 10px; vertical-align: top; }
  thead th { background: #1a1a2e; color: white; text-align: left; }
  tbody td.ok    { background: #e8f5e9; }
  tbody td.fail  { background: #ffebee; }
  td .meta { color: #555; font-size: 12px; margin-top: 4px; }
  td .err  { color: #b00020; font-size: 11px; margin-top: 6px; font-family: ui-monospace, Menlo, Monaco, monospace;
             white-space: pre-wrap; word-break: break-word; max-width: 320px; }
  .totals { display: flex; gap: 16px; margin: 18px 0; }
  .totals .card {
    flex: 1; padding: 14px 18px; background: white; border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0,0,0,.08);
  }
  .totals .card h3 { margin: 0 0 6px; font-size: 14px; }
  .totals .card .num { font-size: 24px; font-weight: 700; }
  .totals .card.ok   .num { color: #2e7d32; }
  .totals .card.fail .num { color: #b00020; }
  a { color: #1565c0; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style></head><body>

<h1>ZAC framework comparison · globalsqa.com</h1>
<div class="sub">Same 13 scenarios run on 3 frameworks · generated ${new Date().toISOString()}</div>

<div class="totals">
${FRAMEWORKS.map(fw => {
  const t = totals[fw];
  const cls = t.fail === 0 ? 'ok' : 'fail';
  return `<div class="card ${cls}">
    <h3>${fw}</h3>
    <div class="num">${t.pass} / ${SCENARIOS.length}</div>
    <div class="meta">passed · ${t.fail} failed · ${(t.ms/1000).toFixed(1)}s total</div>
  </div>`;
}).join('\n')}
</div>

<table>
<thead><tr>
  <th>Scenario</th>
  ${FRAMEWORKS.map(fw => `<th>${fw}</th>`).join('')}
</tr></thead>
<tbody>
${SCENARIOS.map(s => `<tr>
  <td>
    <div><strong>${s.id}</strong></div>
    <div class="meta">${s.name}</div>
    <div class="meta">${s.tags.join(' · ')}</div>
    <div class="meta">${s.steps.length} steps</div>
  </td>
  ${FRAMEWORKS.map(fw => statusCell(matrix[s.id][fw])).join('')}
</tr>`).join('\n')}
</tbody>
</table>

<h2 style="margin-top:24px">Server-side framework summary</h2>
<table>
<thead><tr><th>Framework</th><th>Projects</th><th>Total reruns</th><th>Passed</th><th>Failed</th><th>Last run</th></tr></thead>
<tbody>
${fwBreakdown.filter(f => FRAMEWORKS.includes(f.framework)).map(f => `<tr>
  <td>${f.framework}</td>
  <td>${f.projectCount}</td>
  <td>${f.totalReruns}</td>
  <td>${f.passed}</td>
  <td>${f.failed}</td>
  <td>${f.lastRunAt || ''}</td>
</tr>`).join('')}
</tbody>
</table>

<h2 style="margin-top:24px">Project locations</h2>
<ul>
${FRAMEWORKS.map(fw => `<li><strong>${fw}</strong> &mdash; <code>projects/${PROJECT_ID_FOR(fw)}/</code></li>`).join('')}
</ul>
<p class="sub">These projects are kept on disk after this run so they remain in the ZAC dashboard.
Open <a href="http://localhost:3000/dashboard.html" target="_blank">http://localhost:3000/dashboard.html</a>
to browse, or click any "open" link above to view a per-rerun report.</p>

</body></html>`;

  fs.writeFileSync(reportPath, html);

  // ── Phase 7: terminal summary ──────────────────────────────────────────────
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('TERMINAL SUMMARY — same 13 scenarios across 3 frameworks');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  // Header
  const colW = 14;
  const head = ['Scenario'.padEnd(20)].concat(FRAMEWORKS.map(fw => fw.slice(0, colW).padEnd(colW))).join('  ');
  log(head);
  log('─'.repeat(head.length));
  for (const s of SCENARIOS) {
    const cells = FRAMEWORKS.map(fw => {
      const c = matrix[s.id][fw];
      if (!c) return '—'.padEnd(colW);
      const tag = c.ok ? 'PASS' : 'FAIL';
      return `${tag} ${(c.durationMs/1000).toFixed(1)}s`.padEnd(colW);
    });
    log(`${s.id.padEnd(20)}  ${cells.join('  ')}`);
  }
  log('─'.repeat(head.length));
  const totalsLine = FRAMEWORKS.map(fw => {
    const t = totals[fw];
    return `${t.pass}/${SCENARIOS.length} ${(t.ms/1000).toFixed(0)}s`.padEnd(colW);
  });
  log(`${'TOTAL'.padEnd(20)}  ${totalsLine.join('  ')}`);

  log('\nFramework summary from server:');
  for (const f of fwBreakdown.filter(x => FRAMEWORKS.includes(x.framework))) {
    log(`  ${f.framework.padEnd(22)} reruns=${f.totalReruns} pass=${f.passed} fail=${f.failed}`);
  }

  log(`\nHTML comparison report: ${path.relative(REPO, reportPath)}`);
  log(`Open it: file://${reportPath}`);
  log(`Or: open the live dashboard at http://localhost:3000/dashboard.html`);
  log('\nProjects KEPT on disk for browsing:');
  for (const fw of FRAMEWORKS) log(`  ${PROJECT_ID_FOR(fw)}  (framework: ${fw})`);
  log(`\nAllure results were written to:`);
  log(`  generated-projects/<framework>/${PROJECT_ID_FOR('<fw>')}/reruns/<test>/<ts>/allure-results/`);
  log(`Build the Allure HTML reports with:`);
  log(`  node scripts/zac-allure.mjs                   # per-rerun HTML`);
  log(`  node scripts/zac-allure.mjs --aggregate       # one combined report`);
  log(`  node scripts/zac-allure.mjs --serve           # combined + auto-open`);
})().catch(err => { console.error('Harness error:', err); process.exit(2); });
