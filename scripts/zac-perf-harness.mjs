#!/usr/bin/env node
/**
 * Performance harness — measures every layer that contributes to the
 * "the tool feels slow" experience.
 *
 *   1. Server cold-start: boot → /api/health green.
 *   2. Static asset weight + gzip-friendliness for /, /dashboard.html,
 *      /settings.html and the JS bundles they pull in.
 *   3. Hot-path API p50/p95/p99 over N=100 sequential requests:
 *        /api/health, /api/frameworks, /api/projects,
 *        /api/dashboard/live, /api/dashboard/stats.
 *   4. Concurrent load: 10 parallel callers hammering /api/dashboard/live
 *      for 15s — measure throughput + p95 + error rate.
 *   5. Headless page load: time to DOMContentLoaded, time to first
 *      paint, time to "interactive" (network idle) for the 3 main
 *      pages.
 *
 * SLO budgets (your QA team won't tolerate worse than this):
 *   - cold start                  ≤   5,000 ms
 *   - any static page             ≤   1,500 ms to network-idle
 *   - /api/health                 p95 ≤  50 ms
 *   - /api/frameworks             p95 ≤  50 ms (registry is small)
 *   - /api/projects               p95 ≤ 250 ms
 *   - /api/dashboard/live         p95 ≤ 100 ms (in-memory)
 *   - /api/dashboard/stats        p95 ≤ 1500 ms (heavy disk walk)
 *   - concurrent /dashboard/live  p95 ≤ 200 ms with 0% errors
 *
 * Exits 0 if every budget is met, 1 otherwise.
 */
import http from 'http';
import { spawn, spawnSync } from 'child_process';
import { performance } from 'perf_hooks';
import { chromium } from 'playwright';

const PORT = 3000;
const BASE = `http://127.0.0.1:${PORT}`;
const T = { pass: 0, fail: 0, fails: [] };
const slo = (label, budgetMs, actualMs, extra = '') => {
  const ok = actualMs <= budgetMs;
  if (ok) { T.pass++; console.log(`      ✓ ${label.padEnd(40)} ${actualMs.toFixed(0).padStart(6)} ms  (≤ ${budgetMs} ms)${extra ? '  ' + extra : ''}`); }
  else    { T.fail++; T.fails.push({ label, budgetMs, actualMs }); console.log(`      ✗ ${label.padEnd(40)} ${actualMs.toFixed(0).padStart(6)} ms  (≤ ${budgetMs} ms)${extra ? '  ' + extra : ''}`); }
};
const chk = (label, ok, detail = '') => {
  if (ok) { T.pass++; console.log(`      ✓ ${label}`); }
  else    { T.fail++; T.fails.push({ label, detail }); console.log(`      ✗ ${label}${detail ? '  — ' + detail : ''}`); }
};

function timedGet(path) {
  return new Promise((resolveP) => {
    const t0 = performance.now();
    const req = http.get(BASE + path, (res) => {
      let bytes = 0;
      res.on('data', c => bytes += c.length);
      res.on('end', () => resolveP({ ok: res.statusCode < 400, status: res.statusCode, ms: performance.now() - t0, bytes, headers: res.headers }));
    });
    req.on('error', e => resolveP({ ok: false, error: e.message, ms: performance.now() - t0 }));
    req.setTimeout(15000, () => { req.destroy(); resolveP({ ok: false, error: 'timeout', ms: performance.now() - t0 }); });
  });
}
function pct(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * p / 100)] || 0;
}
// [ZAC-FIX] Use a reduce-based max to handle huge arrays from
// sustained-load runs without exploding the call stack on
// Math.max(...lotsOfElements).
function maxOf(arr) {
  let m = -Infinity;
  for (const v of arr) if (v > m) m = v;
  return m;
}
const summary = (label, ms) => {
  if (ms.length === 0) return { n: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const sum = ms.reduce((a, b) => a + b, 0);
  return {
    n: ms.length, mean: sum / ms.length,
    p50: pct(ms, 50), p95: pct(ms, 95), p99: pct(ms, 99), max: maxOf(ms),
  };
};

(async () => {
  console.log('══ ZAC performance harness ══\n');

  // ─── 1. Cold start ─────────────────────────────────────────────────────
  console.log('── 1. Cold start (server boot → /api/health) ──');
  spawnSync('pkill', ['-f', 'node server.js'], { stdio: 'ignore' });
  await new Promise(s => setTimeout(s, 1500));
  const t0 = performance.now();
  const child = spawn('node', ['server.js'], {
    env: { ...process.env, ZAC_EMAIL_PROVIDER: 'ethereal' },
    detached: true, stdio: 'ignore',
  });
  child.unref();
  // Poll until health green
  let bootMs = -1;
  for (let i = 0; i < 50; i++) {
    const r = await timedGet('/api/health');
    if (r.ok) { bootMs = performance.now() - t0; break; }
    await new Promise(s => setTimeout(s, 100));
  }
  if (bootMs < 0) {
    console.log('      ✗ server failed to come up within 5s'); process.exit(2);
  }
  slo('cold start (boot → /api/health)', 5000, bootMs);

  // ─── 2. Static asset weight ────────────────────────────────────────────
  console.log('\n── 2. Static asset weight + load time ──');
  const staticPaths = [
    { path: '/',                   budget: 1500, label: 'GET /  (Recording UI)' },
    { path: '/dashboard.html',     budget: 1500, label: 'GET /dashboard.html' },
    { path: '/settings.html',      budget: 1500, label: 'GET /settings.html' },
    { path: '/app.js',             budget: 1500, label: 'GET /app.js' },
    { path: '/dashboard.js',       budget: 1500, label: 'GET /dashboard.js' },
    { path: '/zacFixes.js',        budget: 1500, label: 'GET /zacFixes.js' },
    { path: '/styles.css',         budget: 1500, label: 'GET /styles.css' },
  ];
  const sizes = {};
  for (const { path, budget, label } of staticPaths) {
    const r = await timedGet(path);
    sizes[path] = r.bytes || 0;
    slo(label, budget, r.ms, `${(r.bytes/1024).toFixed(1)} KB`);
  }

  // Print payload table for visibility
  console.log('\n   Payload sizes (uncompressed):');
  for (const [p, b] of Object.entries(sizes)) {
    const kb = (b / 1024).toFixed(1);
    console.log(`     ${p.padEnd(24)} ${kb.padStart(8)} KB`);
  }

  // ─── 3. Hot-path API p95 over 100 requests ─────────────────────────────
  console.log('\n── 3. Hot-path API p95 (100 sequential requests) ──');
  const endpoints = [
    { path: '/api/health',          budget: 50,   label: '/api/health' },
    { path: '/api/frameworks',      budget: 50,   label: '/api/frameworks' },
    { path: '/api/projects',        budget: 250,  label: '/api/projects' },
    { path: '/api/dashboard/live',  budget: 100,  label: '/api/dashboard/live' },
    { path: '/api/dashboard/stats', budget: 1500, label: '/api/dashboard/stats' },
  ];
  const apiSummaries = {};
  for (const { path, budget, label } of endpoints) {
    const ms = [];
    for (let i = 0; i < 100; i++) {
      const r = await timedGet(path);
      if (!r.ok) { console.log(`      ⚠ ${label} returned ${r.status || r.error} on iteration ${i}`); }
      ms.push(r.ms);
    }
    const s = summary(label, ms);
    apiSummaries[label] = s;
    slo(`${label} (p95 over ${s.n})`, budget, s.p95,
      `mean=${s.mean.toFixed(0)} p50=${s.p50.toFixed(0)} p99=${s.p99.toFixed(0)} max=${s.max.toFixed(0)}`);
  }

  // ─── 4. Concurrent load on /dashboard/live (10 callers × 15s) ──────────
  console.log('\n── 4. Concurrent load: 10 callers × 15s on /api/dashboard/live ──');
  const callers = 10, durationMs = 15000;
  const allMs = [];
  let okCount = 0, errCount = 0;
  const stopAt = performance.now() + durationMs;
  await Promise.all(Array.from({ length: callers }, async () => {
    while (performance.now() < stopAt) {
      const r = await timedGet('/api/dashboard/live');
      if (r.ok) okCount++; else errCount++;
      allMs.push(r.ms);
    }
  }));
  const cs = summary('concurrent', allMs);
  const throughput = (okCount / (durationMs / 1000)).toFixed(0);
  slo(`concurrent p95 over ${cs.n} reqs`, 200, cs.p95,
    `throughput=${throughput} req/s mean=${cs.mean.toFixed(0)} ok=${okCount} err=${errCount}`);
  chk(`zero error rate under load (${errCount}/${cs.n})`,
    errCount === 0,
    `${errCount} requests errored under load`);

  // ─── 5. Real headless page load (DOMContentLoaded, networkidle) ────────
  console.log('\n── 5. Real Chromium page load (cold cache) ──');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ bypassCSP: false });   // honour the CSP
  const pages = [
    { url: '/',                budget: 1500, label: '/  (Recording UI)' },
    { url: '/dashboard.html',  budget: 1500, label: '/dashboard.html' },
    { url: '/settings.html',   budget: 1000, label: '/settings.html' },
  ];
  for (const { url, budget, label } of pages) {
    const page = await ctx.newPage();
    const consoleErrs = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text()); });
    page.on('pageerror', e => consoleErrs.push(e.message));
    const t0 = performance.now();
    await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 10000 });
    const dcl = performance.now() - t0;
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    const idle = performance.now() - t0;
    const realErrs = consoleErrs.filter(e => !/Failed to load resource|status of 404/.test(e));
    slo(`${label} DCL`,         800,  dcl);
    slo(`${label} network-idle`, budget, idle);
    chk(`${label} 0 console errors (${realErrs.length})`, realErrs.length === 0,
      realErrs.slice(0, 2).join(' | '));
    await page.close();
  }
  await browser.close();

  // ─── Summary ────────────────────────────────────────────────────────────
  console.log('\n═══ Summary ═══');
  console.log(`   Checks: ${T.pass + T.fail}    ✓ ${T.pass}    ✗ ${T.fail}`);
  if (T.fail) {
    console.log('\n   SLO violations:');
    for (const f of T.fails) {
      if (f.budgetMs !== undefined) {
        console.log(`     - ${f.label}: ${f.actualMs.toFixed(0)} ms (budget ≤ ${f.budgetMs} ms)`);
      } else {
        console.log(`     - ${f.label}${f.detail ? ' — ' + f.detail : ''}`);
      }
    }
  }
  console.log('\n   API p50/p95/p99 (ms):');
  for (const [name, s] of Object.entries(apiSummaries)) {
    console.log(`     ${name.padEnd(28)} p50=${s.p50.toFixed(0).padStart(5)}  p95=${s.p95.toFixed(0).padStart(5)}  p99=${s.p99.toFixed(0).padStart(5)}  max=${s.max.toFixed(0).padStart(5)}`);
  }
  process.exit(T.fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
