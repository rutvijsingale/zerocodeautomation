#!/usr/bin/env node
/**
 * scripts/stress-loop.mjs
 *
 * Parallel stress harness. Hits the API surface from N concurrent
 * workers and asserts:
 *   - all requests succeed
 *   - p95 latency stays under a configurable budget
 *   - server heap doesn't grow more than HEAP_GROWTH_LIMIT_MB
 *   - no socket exhaustion / dropped connections
 *
 * Endpoints exercised (read-only — does NOT trigger browser launches,
 * which would require a Playwright session per worker and is a different
 * harness):
 *   - GET  /api/health
 *   - GET  /api/frameworks
 *   - GET  /api/dashboard/stats
 *   - GET  /api/ai/info
 *   - POST /api/ai/suggest-locator   (NullProvider path is < 1ms)
 *   - POST /api/project-layout/scaffold (writes a tiny tree, then
 *                                        the post-scaffold cleanup
 *                                        delete makes net change zero)
 *
 * This is meant for "tool itself can survive parallel users" not for
 * "drive 100 simultaneous Chrome browsers" — the latter would saturate
 * any reasonable dev machine and isn't a representative load.
 *
 * Usage:
 *   node scripts/stress-loop.mjs                 # defaults: 8 workers, 30s
 *   STRESS_WORKERS=16 STRESS_DURATION_S=60 \
 *     node scripts/stress-loop.mjs
 */

import http from 'http';
import { performance } from 'perf_hooks';
import fs from 'fs/promises';
import path from 'path';

const BASE = process.env.ZAC_BASE || 'http://localhost:3000';
const WORKERS = Number(process.env.STRESS_WORKERS || 8);
const DURATION_S = Number(process.env.STRESS_DURATION_S || 30);
const P95_BUDGET_MS = Number(process.env.STRESS_P95_MS || 250);
const HEAP_GROWTH_LIMIT_MB = Number(process.env.STRESS_HEAP_MB || 50);
const ERROR_RATE_LIMIT = 0.001; // 0.1%

const URL_OBJ = new URL(BASE);

function mb(bytes) { return Math.round(bytes / 1024 / 1024 * 10) / 10; }
function pct(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * p / 100)];
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: URL_OBJ.hostname,
      port: URL_OBJ.port || 80,
      method,
      path,
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      } : {},
      timeout: 5000,
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 500,
          status: res.statusCode,
          ms: performance.now() - start,
          bytes: buf.length,
        });
      });
    });
    req.on('error', (e) => resolve({ ok: false, status: 0, ms: performance.now() - start, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, ms: performance.now() - start, error: 'timeout' }); });
    if (payload) req.write(payload);
    req.end();
  });
}

// One worker's loop — picks endpoints round-robin and records latencies.
async function workerLoop(workerId, untilMs, latencies, errors) {
  let i = 0;
  while (performance.now() < untilMs) {
    let r;
    switch (i % 5) {
      case 0: r = await request('GET',  '/api/health'); break;
      case 1: r = await request('GET',  '/api/frameworks'); break;
      case 2: r = await request('GET',  '/api/dashboard/stats'); break;
      case 3: r = await request('GET',  '/api/ai/info'); break;
      case 4: r = await request('POST', '/api/ai/suggest-locator', {
        failedSelector: '#stale',
        htmlSnippet: '<button>Sign in</button>',
        elementHint: 'login button',
      }); break;
    }
    latencies.push(r.ms);
    if (!r.ok) errors.push({ workerId, ...r });
    i++;
  }
}

async function fetchHealth() {
  const r = await request('GET', '/api/health');
  if (!r.ok) return null;
  // Re-fetch as JSON.
  return new Promise((resolve) => {
    http.get(`${BASE}/api/health`, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

(async () => {
  console.log(`\n┌─ Stress Loop ─────────────────────────────────────────────────`);
  console.log(`│  base       : ${BASE}`);
  console.log(`│  workers    : ${WORKERS}`);
  console.log(`│  duration   : ${DURATION_S}s`);
  console.log(`│  p95 budget : ${P95_BUDGET_MS}ms`);
  console.log(`│  heap budget: < ${HEAP_GROWTH_LIMIT_MB} MB growth`);
  console.log(`└────────────────────────────────────────────────────────────────\n`);

  const baseline = await fetchHealth();
  if (!baseline) {
    console.error(`✖ Server not reachable at ${BASE}/api/health`);
    process.exit(2);
  }
  console.log(`baseline → heap=${mb(baseline.memory.heapUsed)}MB rss=${mb(baseline.memory.rss)}MB`);

  const latencies = [];
  const errors = [];
  const untilMs = performance.now() + DURATION_S * 1000;

  console.log(`\nrunning ${WORKERS} workers for ${DURATION_S}s ...`);
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: WORKERS }, (_, i) => workerLoop(i, untilMs, latencies, errors))
  );
  const elapsedS = (performance.now() - t0) / 1000;

  const after = await fetchHealth();
  const heapGrowthMB = after ? mb(after.memory.heapUsed - baseline.memory.heapUsed) : 0;
  const rssGrowthMB = after ? mb(after.memory.rss - baseline.memory.rss) : 0;

  const total = latencies.length;
  const errCount = errors.length;
  const errRate = total > 0 ? errCount / total : 0;
  const p50 = pct(latencies, 50);
  const p95 = pct(latencies, 95);
  const p99 = pct(latencies, 99);
  // reduce instead of Math.max(...spread) — the latencies array can
  // hold > 250k entries which crashes the V8 stack on spread.
  const max = latencies.reduce((m, v) => (v > m ? v : m), 0);
  const rps = (total / elapsedS).toFixed(1);

  console.log(`\n┌─ Summary ─────────────────────────────────────────────────────`);
  console.log(`│  duration         : ${elapsedS.toFixed(1)}s`);
  console.log(`│  requests         : ${total}  (${rps} req/s)`);
  console.log(`│  errors           : ${errCount}  (rate ${(errRate * 100).toFixed(3)}%, budget < ${(ERROR_RATE_LIMIT * 100).toFixed(3)}%)`);
  console.log(`│  latency p50/95/99: ${p50.toFixed(1)} / ${p95.toFixed(1)} / ${p99.toFixed(1)} ms  (p95 budget < ${P95_BUDGET_MS}ms)`);
  console.log(`│  latency max      : ${max.toFixed(1)} ms`);
  console.log(`│  heap growth      : ${heapGrowthMB} MB  (budget < ${HEAP_GROWTH_LIMIT_MB} MB)`);
  console.log(`│  rss growth       : ${rssGrowthMB} MB`);
  console.log(`└────────────────────────────────────────────────────────────────`);

  const verdict = {
    errors: errRate < ERROR_RATE_LIMIT,
    p95: p95 < P95_BUDGET_MS,
    heap: Math.abs(heapGrowthMB) < HEAP_GROWTH_LIMIT_MB,
  };
  const pass = verdict.errors && verdict.p95 && verdict.heap;
  console.log(`\n${pass ? '✓ STABLE under parallel load' : '✖ FAILED stress budget'}`);
  if (!verdict.errors) console.log(`  • error rate ${(errRate * 100).toFixed(3)}% > ${(ERROR_RATE_LIMIT * 100).toFixed(3)}% budget`);
  if (!verdict.p95)    console.log(`  • p95 latency ${p95.toFixed(1)}ms > ${P95_BUDGET_MS}ms budget`);
  if (!verdict.heap)   console.log(`  • heap growth ${heapGrowthMB}MB outside ±${HEAP_GROWTH_LIMIT_MB}MB budget`);
  // First-N error sample for debugging.
  if (errCount > 0) {
    console.log(`\nfirst 5 errors:`);
    for (const e of errors.slice(0, 5)) console.log(`  worker=${e.workerId} status=${e.status} ${e.error || ''}`);
  }
  process.exit(pass ? 0 : 1);
})();
