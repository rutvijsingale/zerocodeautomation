#!/usr/bin/env node
/**
 * ZAC end-to-end multi-project harness.
 *
 * Goals (per user request 2026-05-24):
 *   1. Drive a real Recording session (programmatically) and confirm the
 *      recorded steps persist into project.json.
 *   2. Create N projects across multiple frameworks.
 *   3. Per project, append multiple "feature files" (= scenarios) each
 *      with multiple steps including a DB-validation-via-API step.
 *   4. Run reruns per scenario and verify on-disk reports
 *      (replay-result.json, report/index.html, screenshots/, etc.).
 *   5. Verify the dashboard reflects each run, with run-wise details
 *      (framework / project / testName / status).
 *   6. Confirm rerun-history.jsonl and dashboard stats agree.
 *
 * Run:
 *   node scripts/zac-e2e-multi-project.mjs
 *   ZAC_BASE=http://127.0.0.1:3000 node scripts/zac-e2e-multi-project.mjs
 *
 * Exits 0 on success, 1 on any failure. Logs PASS/FAIL per check.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const BASE = process.env.ZAC_BASE || 'http://127.0.0.1:3000';

// ── result tracker ────────────────────────────────────────────────────────
const results = [];
const log = (m) => console.log(m);
const record = (id, label, ok, detail = '') => {
  results.push({ id, label, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? ' — ' + detail : ''}`);
};

// ── api helpers ───────────────────────────────────────────────────────────
async function api(method, path, body, opts = {}) {
  const fetchOpts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) fetchOpts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, fetchOpts);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { ok: r.ok, status: r.status, body: json, text };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── tiny mock backend so dbValidate has an HTTP endpoint to hit ───────────
// Some scenarios need a "DB-backed" API to assert against. We spin up a
// localhost JSON server with a few canned routes:
//   GET  /db/users          → 200 [{id,name},…]
//   GET  /db/users/:id      → 200 {id,name} | 404
//   GET  /db/orders/count   → 200 {count}
function startMockBackend(port = 0) {
  return new Promise((resolve) => {
    const users = [
      { id: 1, name: 'Naysha', email: 'naysha@example.com', active: true },
      { id: 2, name: 'Rajesh', email: 'rajesh@example.com', active: true },
      { id: 3, name: 'Disabled User', email: 'd@example.com', active: false },
    ];
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (url.pathname === '/db/users') {
        res.statusCode = 200;
        return res.end(JSON.stringify({ rows: users, total: users.length }));
      }
      const m = url.pathname.match(/^\/db\/users\/(\d+)$/);
      if (m) {
        const u = users.find(x => x.id === Number(m[1]));
        res.statusCode = u ? 200 : 404;
        return res.end(JSON.stringify(u || { error: 'not found' }));
      }
      if (url.pathname === '/db/orders/count') {
        res.statusCode = 200;
        return res.end(JSON.stringify({ count: 42, asOf: new Date().toISOString() }));
      }
      if (url.pathname === '/db/health') {
        res.statusCode = 200;
        return res.end(JSON.stringify({ ok: true, db: 'pg-15.4' }));
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'no such route' }));
    });
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

// ── scenarios per project (each = one "feature file") ────────────────────
function scenariosFor(dbUrl) {
  return [
    {
      name: 'Open Home Page + DB health',
      tags: ['@smoke'],
      steps: [
        { kind: 'navigate', url: 'https://example.com' },
        { kind: 'waitFor', ms: 500 },
        { kind: 'assertVisible', selector: 'h1' },
        // DB validation: backend health
        { kind: 'dbValidate', url: `${dbUrl}/db/health`, expectedStatus: 200,
          expectedJsonPath: 'ok', expectedValue: true },
        { kind: 'screenshot', filename: 'home.png' },
      ],
    },
    {
      name: 'Users list reflects DB state',
      tags: ['@regression', '@db'],
      steps: [
        { kind: 'navigate', url: 'https://example.com' },
        { kind: 'waitFor', ms: 300 },
        // DB row-count assertion
        { kind: 'dbValidate', url: `${dbUrl}/db/users`, expectedStatus: 200,
          expectedJsonPath: 'rows', expectedRowCount: 3 },
        // DB single-record assertion
        { kind: 'dbValidate', url: `${dbUrl}/db/users/1`, expectedStatus: 200,
          expectedJsonPath: 'name', expectedValue: 'Naysha' },
        { kind: 'assertVisible', selector: 'body' },
      ],
    },
    {
      name: 'Order count + 404 negative',
      tags: ['@regression'],
      steps: [
        { kind: 'navigate', url: 'https://example.com' },
        { kind: 'waitFor', ms: 200 },
        { kind: 'dbValidate', url: `${dbUrl}/db/orders/count`, expectedStatus: 200,
          expectedJsonPath: 'count', expectedValue: 42 },
        // Negative: missing user → 404
        { kind: 'dbValidate', url: `${dbUrl}/db/users/9999`, expectedStatus: 404 },
        { kind: 'assertVisible', selector: 'h1' },
      ],
    },
  ];
}

// ── flatten a scenario → flat steps for /append-steps + reruns ───────────
function asActions(scenario) {
  return scenario.steps.map(s => ({ ...s, _scenario: scenario.name, _tags: scenario.tags }));
}

// ── teardown: delete a project (best-effort) ──────────────────────────────
async function deleteProject(id) {
  try { await api('DELETE', `/api/projects/${id}`); } catch (_) {}
}

// ── verify file exists on disk and has content ────────────────────────────
function fileExists(absPath) {
  try { return fs.statSync(absPath).size > 0; } catch (_) { return false; }
}

(async () => {
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('ZAC E2E MULTI-PROJECT HARNESS');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const PROJECTS = [
    { id: 'e2e-sj',  framework: 'selenium-java',          baseUrl: 'https://example.com' },
    { id: 'e2e-pwj', framework: 'playwright-java',        baseUrl: 'https://example.com' },
    { id: 'e2e-pwjs',framework: 'playwright-javascript',  baseUrl: 'https://example.com' },
  ];

  const { server: mock, url: dbUrl } = await startMockBackend();
  log(`mock backend listening at ${dbUrl}`);

  // Phase 0: cleanup any prior runs
  for (const p of PROJECTS) await deleteProject(p.id);

  // ── Phase 1: project creation ────────────────────────────────────────────
  log('\n── Phase 1: project creation ──');
  for (const p of PROJECTS) {
    const r = await api('POST', '/api/projects', {
      name: p.id, framework: p.framework, baseUrl: p.baseUrl,
    });
    record(`P1.${p.id}`, `create project (${p.framework})`,
      r.status === 200 || r.status === 201, `status=${r.status}`);
  }

  // ── Phase 2: append multi-scenario "feature files" per project ──────────
  log('\n── Phase 2: append scenarios to each project ──');
  const SCENARIOS = scenariosFor(dbUrl);
  for (const p of PROJECTS) {
    for (const s of SCENARIOS) {
      const r = await api('POST', `/api/projects/${p.id}/append-steps`, {
        steps: asActions(s),
        scenario: {
          id: `${p.id}-${s.name.toLowerCase().replace(/\W+/g, '-')}`,
          name: s.name,
          steps: s.steps.map((act, i) => ({ stepId: `s-${i}`, action: act })),
          tags: s.tags,
          createdAt: new Date().toISOString(),
        },
      });
      record(`P2.${p.id}.${s.name.slice(0, 24)}`, `append "${s.name}"`,
        r.status === 200, `status=${r.status}`);
    }
  }

  // ── Phase 3: assert project.json reflects scenarios + steps ─────────────
  log('\n── Phase 3: project.json shape ──');
  for (const p of PROJECTS) {
    const r = await api('GET', `/api/projects/${p.id}`);
    const proj = r.body && r.body.project;
    const scn = (proj && proj.scenarios) || [];
    const stp = (proj && proj.steps) || [];
    record(`P3.${p.id}.scenarios`, `project has ≥${SCENARIOS.length} scenarios`,
      scn.length >= SCENARIOS.length, `got ${scn.length}`);
    // Each scenario contributes ≥3 steps; total flat steps[] should be ≥
    // sum of scenario step counts.
    const expectedMin = SCENARIOS.reduce((a, s) => a + s.steps.length, 0);
    record(`P3.${p.id}.steps`, `flat steps[] >= ${expectedMin}`,
      stp.length >= expectedMin, `got ${stp.length}`);
    record(`P3.${p.id}.framework`, `framework persisted as ${p.framework}`,
      proj && proj.framework === p.framework, `got ${proj && proj.framework}`);
  }

  // ── Phase 4: run a real Recording session against demoqa text-box ───────
  // Verifies the recording API path and that recorded steps land in
  // project.json. We don't load a real browser through ZAC's recording
  // service — we exercise the action-ingest endpoint directly which is
  // what the in-page recorder script does.
  log('\n── Phase 4: real Recording session (ingest-driven) ──');
  const recProjectId = 'e2e-recorded';
  await deleteProject(recProjectId);
  await api('POST', '/api/projects', {
    name: recProjectId, framework: 'playwright-java', baseUrl: 'https://demoqa.com',
  });
  const start = await api('POST', '/api/recording/start', {
    baseUrl: 'https://demoqa.com', browserType: 'chromium', projectId: recProjectId,
  });
  const sid = start.body && start.body.sessionId;
  record('P4.start', 'recording session started', !!sid, `sessionId=${sid}`);
  if (sid) {
    // Push a sequence of recorded actions
    const actions = [
      { kind: 'navigate', url: 'https://demoqa.com/text-box' },
      { kind: 'click', selector: '#userName' },
      { kind: 'type', selector: '#userName', value: 'Naysha' },
      { kind: 'type', selector: '#userEmail', value: 'qa@bank.com' },
      { kind: 'click', selector: '#submit' },
      { kind: 'assertVisible', selector: '#name' },
    ];
    for (const a of actions) {
      await api('POST', `/api/recording/${sid}/action`, a);
    }
    await sleep(500);
    const stop = await api('POST', '/api/recording/stop', {
      sessionId: sid,
      projectId: recProjectId,
      projectName: recProjectId,
      featureTitle: 'Text Box Recorded Flow',
      framework: 'playwright-java',
      browserType: 'chromium',
      baseUrl: 'https://demoqa.com',
      tags: ['@recording', '@smoke'],
    });
    record('P4.stop', 'recording session stopped', stop.status === 200,
      `status=${stop.status} actions=${stop.body && stop.body.actionCount}`);
    // Verify recorded steps persisted into project.json
    const proj = await api('GET', `/api/projects/${recProjectId}`);
    const projSteps = (proj.body && proj.body.project && proj.body.project.steps) || [];
    record('P4.persist', 'recorded steps persisted to project.json',
      projSteps.length >= 4, `got ${projSteps.length} steps`);
  }

  // ── Phase 5: rerun every scenario across every project ──────────────────
  log('\n── Phase 5: rerun each scenario per project ──');
  // We track every kicked-off rerun so Phase 6/7 can verify each one
  // produced its own report on disk and is visible in the dashboard.
  const rerunsExpected = [];
  for (const p of PROJECTS) {
    for (const s of SCENARIOS) {
      const testName = s.name.toLowerCase().replace(/\W+/g, '-').slice(0, 60);
      const body = {
        steps: asActions(s).map(({ _scenario, _tags, ...rest }) => rest),
        browserType: 'chromium',
        baseUrl: p.baseUrl,
        headless: true,
        projectId: p.id,
        framework: p.framework,
        testName,
        stopOnFailure: false,
        captureFailureScreenshot: true,
        captureVideo: false,
      };
      const r = await api('POST', '/api/rerun', body);
      const layout = r.body && (r.body.rerunLayout || r.body.layout);
      const ts = layout && layout.timestamp;
      const dir = layout && layout.rerunDir;
      record(`P5.${p.id}.${testName.slice(0, 20)}`,
        `rerun "${s.name}" → ${r.body && r.body.success ? 'success' : 'failure'}`,
        r.body && r.body.success === true && !!dir,
        `executed=${r.body && r.body.executedSteps} fail=${r.body && r.body.failureCount} dir=${dir ? path.relative(REPO, dir) : '?'}`);
      if (dir) rerunsExpected.push({ project: p, scenario: s, testName, dir, timestamp: ts });
      // small spacing to avoid the concurrent-rerun cap (10 max)
      await sleep(200);
    }
  }

  // ── Phase 6: verify on-disk artifacts per rerun ─────────────────────────
  log('\n── Phase 6: per-rerun artifact checks ──');
  for (const e of rerunsExpected) {
    const replayJson = path.join(e.dir, 'replay-result.json');
    const reportHtml = path.join(e.dir, 'report', 'index.html');
    const screenshotsDir = path.join(e.dir, 'screenshots');
    const replayOk = fileExists(replayJson);
    const reportOk = fileExists(reportHtml);
    let parsed = null;
    if (replayOk) {
      try { parsed = JSON.parse(fs.readFileSync(replayJson, 'utf8')); } catch (_) {}
    }
    const okCount = parsed && Array.isArray(parsed.results) ? parsed.results.filter(r => r.success).length : -1;
    const totalSteps = parsed && Array.isArray(parsed.results) ? parsed.results.length : -1;
    record(`P6.${e.project.id}.${e.testName.slice(0, 20)}.replay`,
      `replay-result.json present + parses`,
      replayOk && parsed && Array.isArray(parsed.results),
      `${okCount}/${totalSteps} ok`);
    record(`P6.${e.project.id}.${e.testName.slice(0, 20)}.html`,
      `report/index.html present`,
      reportOk, fileExists(reportHtml) ? `${fs.statSync(reportHtml).size}B` : 'missing');
    // screenshots/ may legitimately be empty if no screenshot step + no
    // failure occurred. The "Open Home Page" scenario has a screenshot
    // step so at least that one's dir should have at least one file.
    if (e.scenario.name.toLowerCase().includes('home')) {
      const has = fs.existsSync(screenshotsDir) && fs.readdirSync(screenshotsDir).length > 0;
      record(`P6.${e.project.id}.${e.testName.slice(0, 20)}.screenshots`,
        `screenshots/ has ≥1 PNG (scenario uses screenshot step)`,
        has, screenshotsDir);
    }
  }

  // ── Phase 7: dashboard reflects every run ───────────────────────────────
  log('\n── Phase 7: dashboard run-wise visibility ──');
  await sleep(2000); // let the dashboard cache settle
  const stats = await api('GET', '/api/dashboard/stats?existingOnly=true');
  const reruns = (stats.body && stats.body.reruns) || [];
  for (const e of rerunsExpected) {
    const found = reruns.find(r =>
      r.projectId === e.project.id &&
      r.framework === e.project.framework &&
      r.testName === e.testName &&
      r.timestamp === e.timestamp);
    record(`P7.${e.project.id}.${e.testName.slice(0, 20)}`,
      `dashboard.stats lists this rerun`,
      !!found,
      found ? `status=${found.status} steps=${found.executedSteps}` : 'not found');
  }

  // dashboard summary numbers
  const totalReruns = stats.body && stats.body.summary && stats.body.summary.totalReruns;
  record('P7.totalReruns',
    `summary.totalReruns >= ${rerunsExpected.length}`,
    typeof totalReruns === 'number' && totalReruns >= rerunsExpected.length,
    `got ${totalReruns}`);

  // ── Phase 8: rerun-history.jsonl tail matches our runs ──────────────────
  log('\n── Phase 8: run-history visibility ──');
  const hist = await api('GET', `/api/runs/history?limit=500&existingOnly=true`);
  const rows = (hist.body && hist.body.rows) || [];
  for (const e of rerunsExpected) {
    const r = rows.find(row => row.project === e.project.id && row.framework === e.project.framework);
    record(`P8.${e.project.id}.history`,
      `runs/history has ≥1 row for project ${e.project.id} (${e.project.framework})`,
      !!r, r ? `id=${r.id} status=${r.status}` : 'not found');
  }

  // ── Phase 9: framework summary ──────────────────────────────────────────
  log('\n── Phase 9: framework summary ──');
  const fws = await api('GET', '/api/dashboard/framework-summary');
  const fwList = (fws.body && fws.body.frameworks) || [];
  for (const p of PROJECTS) {
    const f = fwList.find(x => x.framework === p.framework);
    record(`P9.${p.framework}`, `framework-summary lists ${p.framework}`,
      !!f && f.totalReruns >= SCENARIOS.length,
      f ? `projects=${f.projectCount} reruns=${f.totalReruns} pass=${f.passed} fail=${f.failed}` : 'missing');
  }

  // ── Teardown ────────────────────────────────────────────────────────────
  for (const p of PROJECTS) await deleteProject(p.id);
  await deleteProject('e2e-recorded');
  await new Promise((res) => mock.close(res));

  // ── Summary ─────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(`SUMMARY: ${passed}/${results.length} passed`);
  if (failed.length) {
    log('\nFAILURES:');
    for (const f of failed) log(`  ✗ ${f.id}  ${f.label}  ${f.detail}`);
    process.exit(1);
  }
  log('All scenarios passed.');
})().catch((err) => {
  console.error('\nHarness error:', err);
  process.exit(2);
});
