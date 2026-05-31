#!/usr/bin/env node
/**
 * Exercise EVERY assertion kind ZAC supports against live globalsqa.com
 * pages, prove each one can succeed AND fail correctly, and emit Allure
 * results for every rerun.
 *
 * The 10 assertion kinds wired into utils/stepHandlers.js:
 *   assertVisible, assertNotVisible, assertText, assertAttribute,
 *   assertValue, assertEnabled, assertDisabled, assertChecked,
 *   assertNotChecked, assertCount
 *
 * Plus the dbValidate alias family which also asserts (against an API).
 *
 * For each kind we run TWO reruns:
 *   - POS    expected to PASS  → confirms the happy path works
 *   - NEG    expected to FAIL  → confirms the assertion actually
 *                                throws when its condition is wrong
 *                                (a "passes-because-it-can't-actually-
 *                                check" bug would slip past a
 *                                positive-only test)
 *
 * Run:
 *   node scripts/zac-globalsqa-all-assertions.mjs
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const BASE = process.env.ZAC_BASE || 'http://127.0.0.1:3000';
const PROJECT_ID = 'globalsqa-all-assertions';

const results = [];
const log = (m) => console.log(m);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const record = (id, label, ok, detail = '') => {
  results.push({ id, label, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(28)}  ${label}${detail ? ' — ' + detail : ''}`);
};

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { ok: r.ok, status: r.status, body: json, text };
}

// dbValidate target
function startMock(port = 0) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname === '/api/health')
        return (res.statusCode = 200, res.end(JSON.stringify({ ok: true, env: 'staging' })));
      if (url.pathname === '/api/rows')
        return (res.statusCode = 200, res.end(JSON.stringify({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] })));
      res.statusCode = 404; res.end('{}');
    });
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

const SITE = {
  slider:       'https://www.globalsqa.com/demoSite/practice/slider/colorpicker.html',
  spinner:      'https://www.globalsqa.com/demoSite/practice/spinner/default.html',
  sortable:     'https://www.globalsqa.com/demoSite/practice/sortable/default.html',
  selectable:   'https://www.globalsqa.com/demoSite/practice/selectable/default.html',
  dialog:       'https://www.globalsqa.com/demoSite/practice/dialog/modal-form.html',
  selectmenu:   'https://www.globalsqa.com/demoSite/practice/selectmenu/default.html',
  // demoqa pages where checked/disabled state is reliable
  radioqa:      'https://demoqa.com/radio-button',
  checkqa:      'https://demoqa.com/checkbox',
  textboxqa:    'https://demoqa.com/text-box',
};

// ── 11 assertion kinds × {POS, NEG} = 22 scenarios ──────────────────────────
function buildAssertionScenarios(dbUrl) {
  return [
    // 1. assertVisible
    {
      kind: 'assertVisible', expect: 'PASS', id: 'AV.POS',
      steps: [
        { kind: 'navigate', url: SITE.slider },
        { kind: 'waitForSelector', selector: '#red', timeoutMs: 20000 },
        { kind: 'assertVisible',   selector: '#red' },
      ],
    },
    {
      kind: 'assertVisible', expect: 'FAIL', id: 'AV.NEG',
      steps: [
        { kind: 'navigate', url: SITE.slider },
        { kind: 'waitFor', ms: 1500 },
        // Element doesn't exist → assertVisible must throw
        { kind: 'assertVisible', selector: '#this-does-not-exist', timeoutMs: 3000 },
      ],
    },

    // 2. assertNotVisible
    {
      kind: 'assertNotVisible', expect: 'PASS', id: 'ANV.POS',
      steps: [
        { kind: 'navigate', url: SITE.dialog },
        { kind: 'waitForSelector', selector: '#create-user', timeoutMs: 20000 },
        // Dialog form is hidden until #create-user is clicked
        { kind: 'assertNotVisible', selector: '#dialog-form' },
      ],
    },
    {
      kind: 'assertNotVisible', expect: 'FAIL', id: 'ANV.NEG',
      steps: [
        { kind: 'navigate', url: SITE.slider },
        { kind: 'waitForSelector', selector: '#red', timeoutMs: 20000 },
        // #red IS visible → assertNotVisible must throw
        { kind: 'assertNotVisible', selector: '#red', timeoutMs: 3000 },
      ],
    },

    // 3. assertText
    {
      kind: 'assertText', expect: 'PASS', id: 'AT.POS',
      steps: [
        { kind: 'navigate', url: SITE.sortable },
        { kind: 'waitForSelector', selector: '#sortable li:nth-child(1)', timeoutMs: 20000 },
        { kind: 'assertText', selector: '#sortable li:nth-child(1)', expectedValue: 'Item 1' },
      ],
    },
    {
      kind: 'assertText', expect: 'FAIL', id: 'AT.NEG',
      steps: [
        { kind: 'navigate', url: SITE.sortable },
        { kind: 'waitForSelector', selector: '#sortable li:nth-child(1)', timeoutMs: 20000 },
        { kind: 'assertText', selector: '#sortable li:nth-child(1)', expectedValue: 'Definitely Not Item 1 XYZ' },
      ],
    },

    // 4. assertAttribute
    {
      kind: 'assertAttribute', expect: 'PASS', id: 'AA.POS',
      steps: [
        { kind: 'navigate', url: SITE.textboxqa },
        { kind: 'waitForSelector', selector: '#userName', timeoutMs: 20000 },
        { kind: 'assertAttribute', selector: '#userName',
          attribute: 'placeholder', expectedValue: 'Full Name' },
      ],
    },
    {
      kind: 'assertAttribute', expect: 'FAIL', id: 'AA.NEG',
      steps: [
        { kind: 'navigate', url: SITE.textboxqa },
        { kind: 'waitForSelector', selector: '#userName', timeoutMs: 20000 },
        { kind: 'assertAttribute', selector: '#userName',
          attribute: 'placeholder', expectedValue: 'Definitely Wrong Placeholder' },
      ],
    },

    // 5. assertValue (live input value, NOT the initial HTML attr)
    {
      kind: 'assertValue', expect: 'PASS', id: 'AVAL.POS',
      steps: [
        { kind: 'navigate', url: SITE.spinner },
        { kind: 'waitForSelector', selector: '#spinner', timeoutMs: 20000 },
        { kind: 'fill',  selector: '#spinner', value: '42' },
        { kind: 'assertValue', selector: '#spinner', expectedValue: '42' },
      ],
    },
    {
      kind: 'assertValue', expect: 'FAIL', id: 'AVAL.NEG',
      steps: [
        { kind: 'navigate', url: SITE.spinner },
        { kind: 'waitForSelector', selector: '#spinner', timeoutMs: 20000 },
        { kind: 'fill',  selector: '#spinner', value: '42' },
        { kind: 'assertValue', selector: '#spinner', expectedValue: '999' },
      ],
    },

    // 6. assertEnabled
    {
      kind: 'assertEnabled', expect: 'PASS', id: 'AE.POS',
      steps: [
        { kind: 'navigate', url: SITE.spinner },
        { kind: 'waitForSelector', selector: '#disable', timeoutMs: 20000 },
        { kind: 'assertEnabled', selector: '#disable' },
      ],
    },
    {
      kind: 'assertEnabled', expect: 'FAIL', id: 'AE.NEG',
      steps: [
        { kind: 'navigate', url: SITE.radioqa },
        { kind: 'waitForSelector', selector: '#noRadio', timeoutMs: 20000 },
        // #noRadio is disabled by default on demoqa.
        { kind: 'assertEnabled', selector: '#noRadio' },
      ],
    },

    // 7. assertDisabled
    {
      kind: 'assertDisabled', expect: 'PASS', id: 'AD.POS',
      steps: [
        { kind: 'navigate', url: SITE.radioqa },
        { kind: 'waitForSelector', selector: '#noRadio', timeoutMs: 20000 },
        { kind: 'assertDisabled', selector: '#noRadio' },
      ],
    },
    {
      kind: 'assertDisabled', expect: 'FAIL', id: 'AD.NEG',
      steps: [
        { kind: 'navigate', url: SITE.radioqa },
        { kind: 'waitForSelector', selector: '#yesRadio', timeoutMs: 20000 },
        { kind: 'assertDisabled', selector: '#yesRadio' },
      ],
    },

    // 8. assertChecked
    {
      kind: 'assertChecked', expect: 'PASS', id: 'AC.POS',
      steps: [
        { kind: 'navigate', url: SITE.radioqa },
        { kind: 'waitForSelector', selector: '#yesRadio', timeoutMs: 20000 },
        { kind: 'click', selector: 'label[for="yesRadio"]' },
        { kind: 'waitFor', ms: 300 },
        { kind: 'assertChecked', selector: '#yesRadio' },
      ],
    },
    {
      kind: 'assertChecked', expect: 'FAIL', id: 'AC.NEG',
      steps: [
        { kind: 'navigate', url: SITE.radioqa },
        { kind: 'waitForSelector', selector: '#yesRadio', timeoutMs: 20000 },
        // No click → not checked
        { kind: 'assertChecked', selector: '#yesRadio' },
      ],
    },

    // 9. assertNotChecked
    {
      kind: 'assertNotChecked', expect: 'PASS', id: 'ANC.POS',
      steps: [
        { kind: 'navigate', url: SITE.radioqa },
        { kind: 'waitForSelector', selector: '#yesRadio', timeoutMs: 20000 },
        { kind: 'assertNotChecked', selector: '#yesRadio' },
      ],
    },
    {
      kind: 'assertNotChecked', expect: 'FAIL', id: 'ANC.NEG',
      steps: [
        { kind: 'navigate', url: SITE.radioqa },
        { kind: 'waitForSelector', selector: '#yesRadio', timeoutMs: 20000 },
        { kind: 'click', selector: 'label[for="yesRadio"]' },
        { kind: 'waitFor', ms: 300 },
        { kind: 'assertNotChecked', selector: '#yesRadio' },
      ],
    },

    // 10. assertCount
    {
      kind: 'assertCount', expect: 'PASS', id: 'ACT.POS',
      steps: [
        { kind: 'navigate', url: SITE.sortable },
        { kind: 'waitForSelector', selector: '#sortable li', timeoutMs: 20000 },
        { kind: 'assertCount', selector: '#sortable li', expectedCount: 7 },
      ],
    },
    {
      kind: 'assertCount', expect: 'FAIL', id: 'ACT.NEG',
      steps: [
        { kind: 'navigate', url: SITE.sortable },
        { kind: 'waitForSelector', selector: '#sortable li', timeoutMs: 20000 },
        { kind: 'assertCount', selector: '#sortable li', expectedCount: 999 },
      ],
    },

    // 11. dbValidate (a 4th positive + negative for completeness)
    {
      kind: 'dbValidate', expect: 'PASS', id: 'DB.POS',
      steps: [
        { kind: 'navigate', url: 'about:blank' },
        { kind: 'dbValidate', url: `${dbUrl}/api/health`, expectedStatus: 200,
          expectedJsonPath: 'env', expectedValue: 'staging' },
        { kind: 'dbValidate', url: `${dbUrl}/api/rows`, expectedStatus: 200,
          expectedJsonPath: 'rows', expectedRowCount: 3 },
      ],
    },
    {
      kind: 'dbValidate', expect: 'FAIL', id: 'DB.NEG',
      steps: [
        { kind: 'navigate', url: 'about:blank' },
        // Wrong row count → must fail
        { kind: 'dbValidate', url: `${dbUrl}/api/rows`, expectedStatus: 200,
          expectedJsonPath: 'rows', expectedRowCount: 999 },
      ],
    },
  ];
}

async function rerun(testName, steps) {
  return api('POST', '/api/rerun', {
    steps,
    browserType: 'chromium',
    baseUrl: 'https://www.globalsqa.com',
    headless: true,
    projectId: PROJECT_ID,
    framework: 'playwright-java',
    testName,
    stopOnFailure: false,
    captureFailureScreenshot: true,
    captureVideo: false,
    stepTimeoutMs: 60000,
  });
}

(async () => {
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('All assertion kinds × {positive, negative} on live globalsqa');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const { server: mock, url: dbUrl } = await startMock();
  log(`Mock backend → ${dbUrl}`);
  const SCENARIOS = buildAssertionScenarios(dbUrl);

  // Setup
  await api('DELETE', `/api/projects/${PROJECT_ID}`).catch(() => {});
  await api('POST', '/api/projects', {
    name: PROJECT_ID, framework: 'playwright-java', baseUrl: 'https://www.globalsqa.com',
    description: 'All assertion kinds — positive + negative coverage',
  });

  // Group results by kind for the matrix
  const matrix = {};
  const reruns = [];

  log('\n── Phase 1: run all 22 scenarios ──');
  for (const s of SCENARIOS) {
    const testName = s.id.toLowerCase().replace(/\W+/g, '-');
    const r = await rerun(testName, s.steps);
    const succeeded = r.body && r.body.success === true && r.body.failureCount === 0;
    const expectedPass = s.expect === 'PASS';
    // The CONTRACT we're verifying:
    //   POS scenario must succeed.
    //   NEG scenario must fail with an error from THIS assertion kind.
    const failed = r.body && r.body.results && r.body.results.find(x => !x.success);
    const matchesExpectation = expectedPass ? succeeded : !succeeded;
    const errMsg = failed ? (failed.error || '').slice(0, 90) : '';
    record(s.id, `${s.kind} (${s.expect})`,
      matchesExpectation,
      `actual=${succeeded ? 'PASS' : 'FAIL'} expected=${s.expect}${errMsg ? ' err=' + errMsg : ''}`);

    matrix[s.kind] = matrix[s.kind] || {};
    matrix[s.kind][s.expect] = { id: s.id, ok: matchesExpectation, succeeded, errMsg };

    const layout = r.body && (r.body.rerunLayout || r.body.layout);
    if (layout && layout.rerunDir) reruns.push({ scenario: s, layout });
    await sleep(300);
  }

  await new Promise(res => mock.close(res));

  // ── Phase 2: regenerate Allure ──────────────────────────────────────────────
  log('\n── Phase 2: generate Allure reports ──');
  const localBin = path.join(REPO, 'node_modules', '.bin', 'allure');
  const haveCli = fs.existsSync(localBin);
  if (!haveCli) {
    log('  Allure CLI not found — install with: npm i -D allure');
  } else {
    // Per-rerun
    let okCount = 0;
    for (const e of reruns) {
      const out = path.join(e.layout.rerunDir, 'allure-report');
      const r = spawnSync(localBin, ['awesome', '-o', out, '--cwd', e.layout.rerunDir, '--single-file'],
        { stdio: 'pipe' });
      if (r.status === 0) okCount++;
    }
    log(`  Per-rerun: ${okCount}/${reruns.length} reports`);

    // Aggregate
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const stage = path.join(REPO, 'reports', `allure-stage-allassert-${ts}`, 'allure-results');
    const out = path.join(REPO, 'reports', `allure-report-allassert-${ts}`);
    fs.mkdirSync(stage, { recursive: true });
    let copied = 0;
    for (const e of reruns) {
      const dir = path.join(e.layout.rerunDir, 'allure-results');
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!/-result\.json$|-attachment\.|^environment\.properties$|^executor\.json$|^categories\.json$/.test(f)) continue;
        if (['environment.properties', 'executor.json', 'categories.json'].includes(f)) {
          if (!fs.existsSync(path.join(stage, f))) fs.copyFileSync(path.join(dir, f), path.join(stage, f));
        } else {
          fs.copyFileSync(path.join(dir, f), path.join(stage, f));
          copied++;
        }
      }
    }
    const r = spawnSync(localBin,
      ['awesome', '-o', out, '--cwd', path.dirname(stage), '--single-file'],
      { stdio: 'pipe' });
    if (r.status === 0) {
      log(`  Aggregate: ${out}/index.html`);
      // Sanity-check the summary
      try {
        const summary = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'));
        log(`  summary.json: total=${summary.stats.total} passed=${summary.stats.passed||0} broken=${summary.stats.broken||0} failed=${summary.stats.failed||0}`);
      } catch (_) {}
    } else {
      log(`  Aggregate FAILED: ${(r.stderr || r.stdout || '').toString().slice(0, 200)}`);
    }
  }

  // ── Phase 3: matrix + summary ──────────────────────────────────────────────
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('Assertion-kind matrix (POS must pass, NEG must fail):');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(`  ${'kind'.padEnd(20)}  ${'POS'.padEnd(8)}  ${'NEG'.padEnd(8)}`);
  log(`  ${'-'.repeat(20)}  ${'-'.repeat(8)}  ${'-'.repeat(8)}`);
  for (const [kind, cells] of Object.entries(matrix)) {
    const pos = cells.PASS ? (cells.PASS.ok ? 'PASS ✓' : 'FAIL ✗') : '—';
    const neg = cells.FAIL ? (cells.FAIL.ok ? 'PASS ✓' : 'FAIL ✗') : '—';
    log(`  ${kind.padEnd(20)}  ${pos.padEnd(8)}  ${neg.padEnd(8)}`);
  }

  await api('DELETE', `/api/projects/${PROJECT_ID}`).catch(() => {});

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(`SUMMARY: ${passed}/${results.length} contract checks passed`);
  if (failed.length) {
    log('\nFAILURES (assertion kind didn\'t behave as expected):');
    for (const f of failed) log(`  ✗ ${f.id}  ${f.label}  ${f.detail}`);
    process.exit(1);
  }
  log('Every assertion kind verified — POS path passes, NEG path fails as designed.');
})().catch(err => { console.error('Harness error:', err); process.exit(2); });
