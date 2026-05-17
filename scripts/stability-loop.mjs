#!/usr/bin/env node
/**
 * scripts/stability-loop.mjs
 *
 * Soak / stability harness for the QA sign-off:
 *   - Run validate-live-flow.mjs N times back-to-back (default 5).
 *   - Sample server heap/RSS via /api/health between runs.
 *   - PASS criteria:
 *       1. Every iteration exits 0.
 *       2. Heap growth across the full loop is < 30 MB
 *          (well under "memory leak" territory; allows GC variance).
 *       3. No iteration-to-iteration variance > 50% in wall-time
 *          (catches degrading throughput from leaked resources).
 *
 * Usage:
 *   node scripts/stability-loop.mjs [N]
 *   ZAC_BASE=http://localhost:3000 node scripts/stability-loop.mjs 10
 */

import { spawn } from 'child_process';
import http from 'http';

const BASE = process.env.ZAC_BASE || 'http://localhost:3000';
const N = Number(process.argv[2] || process.env.STABILITY_RUNS || 5);
const HEAP_GROWTH_LIMIT_MB = 30;
const WALLTIME_VARIANCE_LIMIT = 0.50; // 50%

function ms(n) { return `${n.toLocaleString()}ms`; }
function mb(bytes) { return Math.round(bytes / 1024 / 1024 * 10) / 10; }

function fetchHealth() {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}/api/health`, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function runOnce(iteration) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn('npm', ['run', 'validate:live-flow'], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let lastLine = '';
    child.stdout.on('data', (c) => {
      const lines = c.toString().split('\n').filter(Boolean);
      if (lines.length) lastLine = lines[lines.length - 1];
    });
    child.stderr.on('data', () => {});
    child.on('exit', (code) => {
      resolve({
        iteration,
        ok: code === 0,
        durationMs: Date.now() - start,
        lastLine,
      });
    });
  });
}

(async () => {
  console.log(`\n┌─ Stability Loop ──────────────────────────────────────────────`);
  console.log(`│  base       : ${BASE}`);
  console.log(`│  iterations : ${N}`);
  console.log(`│  heap budget: < ${HEAP_GROWTH_LIMIT_MB} MB growth across full loop`);
  console.log(`│  walltime   : variance < ${(WALLTIME_VARIANCE_LIMIT * 100).toFixed(0)}%`);
  console.log(`└────────────────────────────────────────────────────────────────\n`);

  // Confirm server is reachable before we burn 6 minutes on it.
  const h0 = await fetchHealth().catch((e) => null);
  if (!h0) {
    console.error(`✖ Server not reachable at ${BASE}/api/health — start it first.`);
    process.exit(2);
  }
  const baselineHeap = h0.memory.heapUsed;
  const baselineRss = h0.memory.rss;
  console.log(`baseline → heap=${mb(baselineHeap)}MB rss=${mb(baselineRss)}MB`);

  const results = [];
  let runningHeap = baselineHeap;
  for (let i = 1; i <= N; i++) {
    process.stdout.write(`\n[${i}/${N}] running validate:live-flow... `);
    const r = await runOnce(i);
    const h = await fetchHealth().catch(() => null);
    const heap = h ? h.memory.heapUsed : runningHeap;
    const rss  = h ? h.memory.rss      : 0;
    const heapDelta = heap - runningHeap;
    runningHeap = heap;
    results.push({ ...r, heap, rss, heapDeltaMB: mb(heapDelta) });
    console.log(`${r.ok ? '✓' : '✖'}  ${ms(r.durationMs)}  heap=${mb(heap)}MB (Δ ${heapDelta >= 0 ? '+' : ''}${mb(heapDelta)}MB)`);
    if (!r.ok) console.log(`     last line: ${r.lastLine}`);
  }

  console.log(`\n┌─ Summary ─────────────────────────────────────────────────────`);
  const oks = results.filter((r) => r.ok).length;
  const fails = N - oks;
  const totalHeapGrowthMB = mb(runningHeap - baselineHeap);
  const durations = results.map((r) => r.durationMs);
  const minD = Math.min(...durations);
  const maxD = Math.max(...durations);
  const variance = (maxD - minD) / minD;

  console.log(`│  iterations         : ${N}`);
  console.log(`│  pass               : ${oks}/${N}`);
  console.log(`│  fail               : ${fails}`);
  console.log(`│  total heap growth  : ${totalHeapGrowthMB} MB  (budget < ${HEAP_GROWTH_LIMIT_MB} MB)`);
  console.log(`│  walltime min/max   : ${ms(minD)} / ${ms(maxD)}  (variance ${(variance * 100).toFixed(1)}%, budget < ${(WALLTIME_VARIANCE_LIMIT * 100).toFixed(0)}%)`);
  console.log(`│  mean walltime      : ${ms(Math.round(durations.reduce((a, b) => a + b, 0) / N))}`);
  console.log(`└────────────────────────────────────────────────────────────────`);

  const verdict = {
    allPassed: fails === 0,
    heapOk: totalHeapGrowthMB < HEAP_GROWTH_LIMIT_MB,
    walltimeOk: variance < WALLTIME_VARIANCE_LIMIT,
  };
  const ok = verdict.allPassed && verdict.heapOk && verdict.walltimeOk;
  console.log(`\n${ok ? '✓ STABLE — production-grade reliability' : '✖ UNSTABLE — see above'}`);
  if (!verdict.allPassed) console.log(`  • some iterations failed`);
  if (!verdict.heapOk)    console.log(`  • heap grew ${totalHeapGrowthMB} MB (> ${HEAP_GROWTH_LIMIT_MB} MB budget)`);
  if (!verdict.walltimeOk) console.log(`  • walltime variance ${(variance * 100).toFixed(1)}% (> ${(WALLTIME_VARIANCE_LIMIT * 100).toFixed(0)}% budget)`);
  process.exit(ok ? 0 : 1);
})();
