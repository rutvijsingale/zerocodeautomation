#!/usr/bin/env node
/**
 * iframe regression — https://demoqa.com/frames
 *
 * The page has two iframes:
 *   #frame1   (1280×400)  → contains <h1 id="sampleHeading">This is a sample page</h1>
 *   #frame2   (100×100)   → same heading, smaller frame
 *
 * Before this fix the rerun engine ignored a step's frame metadata and ran
 * locators at the top level → "Element not found" against #sampleHeading.
 *
 * This harness validates THREE styles of iframe handling, all driven by the
 * live /api/rerun engine (no UI involvement):
 *   A. Per-step frameSelector (the recording engine writes this when the
 *      user clicks/types inside an iframe).
 *   B. Explicit `switchToFrame` step — Selenium-style flow.
 *   C. `switchToParentFrame` returns subsequent steps to top-level scope.
 *
 * Run:
 *   node scripts/zac-iframe-demoqa.mjs
 *
 * Exits 0 on success, 1 on any failure.
 */

const BASE = process.env.ZAC_BASE || 'http://127.0.0.1:3000';
const TARGET = 'https://demoqa.com/frames';

const results = [];
const log = (m) => console.log(m);
const record = (id, label, ok, detail = '') => {
  results.push({ id, label, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? ' — ' + detail : ''}`);
};

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { ok: r.ok, status: r.status, body: json, text };
}

async function rerun(testName, steps) {
  const r = await api('POST', '/api/rerun', {
    steps,
    browserType: 'chromium',
    baseUrl: TARGET,
    headless: true,
    projectId: 'iframe-demoqa-harness',
    framework: 'playwright-java',
    testName,
    stopOnFailure: false,
    captureFailureScreenshot: true,
    captureVideo: false,
  });
  return r;
}

(async () => {
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('IFRAME REGRESSION — demoqa.com/frames');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Make sure target project exists; otherwise the rerun won't persist
  // artifacts (which is fine, but cleaner this way).
  await api('DELETE', '/api/projects/iframe-demoqa-harness').catch(() => {});
  await api('POST', '/api/projects', {
    name: 'iframe-demoqa-harness', framework: 'playwright-java', baseUrl: TARGET,
  });

  // ── A. Per-step frameSelector (recording-engine output shape) ────────────
  log('\n── A. Per-step frameSelector ──');
  {
    const r = await rerun('per-step-frame-selector', [
      { kind: 'navigate', url: TARGET },
      { kind: 'waitFor', ms: 1500 },
      // Wait for the iframe element to be attached at top level
      { kind: 'waitForSelector', selector: '#frame1', timeoutMs: 15000 },
      // Now assert the inner heading using frameSelector metadata
      { kind: 'assertVisible', selector: '#sampleHeading', frameSelector: '#frame1' },
      { kind: 'assertText',    selector: '#sampleHeading', frameSelector: '#frame1',
        expectedValue: 'This is a sample page' },
    ]);
    const ok = r.body && r.body.success === true && r.body.failureCount === 0;
    record('A1', 'per-step frameSelector resolves into iframe',
      !!ok, `executed=${r.body && r.body.executedSteps} fail=${r.body && r.body.failureCount} ` +
            (r.body && r.body.results && r.body.results.find(x => !x.success)
              ? `firstErr=${(r.body.results.find(x => !x.success).error || '').slice(0, 90)}`
              : ''));
  }

  // ── B. Explicit switchToFrame ────────────────────────────────────────────
  log('\n── B. switchToFrame → assert → switchToParentFrame ──');
  {
    const r = await rerun('switch-to-frame', [
      { kind: 'navigate', url: TARGET },
      { kind: 'waitFor', ms: 1500 },
      { kind: 'waitForSelector', selector: '#frame1', timeoutMs: 15000 },
      // Switch into frame1 — subsequent steps use frame1 as root
      { kind: 'switchToFrame', frameSelector: '#frame1' },
      { kind: 'assertVisible', selector: '#sampleHeading' },
      { kind: 'assertText', selector: '#sampleHeading', expectedValue: 'This is a sample page' },
      // Back to top-level
      { kind: 'switchToParentFrame' },
      // Top-level page elements should still be reachable
      { kind: 'assertVisible', selector: '#frame1' },
    ]);
    const ok = r.body && r.body.success === true && r.body.failureCount === 0;
    record('B1', 'switchToFrame + assertions + switchToParentFrame',
      !!ok, `executed=${r.body && r.body.executedSteps} fail=${r.body && r.body.failureCount}`);
  }

  // ── C. Negative — bad frame selector should fail loudly ──────────────────
  log('\n── C. Negative: bad frame selector ──');
  {
    const r = await rerun('bad-frame-selector', [
      { kind: 'navigate', url: TARGET },
      { kind: 'waitFor', ms: 1500 },
      { kind: 'switchToFrame', frameSelector: '#no-such-frame', timeoutMs: 3000 },
      { kind: 'assertVisible', selector: '#sampleHeading' },
    ]);
    const failed = r.body && r.body.success === false && r.body.failureCount > 0;
    const errMsg = (r.body && r.body.results && r.body.results.find(x => !x.success)
      && r.body.results.find(x => !x.success).error) || '';
    record('C1', 'bad frame selector → run reported as failed',
      !!failed && /switchToFrame|iframe|frame/i.test(errMsg),
      `success=${r.body && r.body.success} err=${errMsg.slice(0, 90)}`);
  }

  // ── Teardown ─────────────────────────────────────────────────────────────
  await api('DELETE', '/api/projects/iframe-demoqa-harness').catch(() => {});

  // ── Summary ──────────────────────────────────────────────────────────────
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
