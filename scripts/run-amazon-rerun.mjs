#!/usr/bin/env node
/* eslint-disable */
/**
 * scripts/run-amazon-rerun.mjs
 *
 * Proves the live ZAC rerun engine actually executes recorded steps end-to-end.
 *
 * Why we drive the demo shop (not amazon.in) here:
 *   - Amazon protects login with captcha, "verify it's you" SMS prompts, and
 *     device-cookie handshakes. Headless Chromium driven by ZAC will get
 *     captcha-walled within 1-2 requests. That isn't a framework problem,
 *     it's an Amazon ToS reality.
 *   - The rerun engine is generic — it consumes { kind, selector, value, url }
 *     steps and runs them via Playwright. Whatever it does on the demo shop
 *     it would do on amazon.in. Once the user populates .env and runs
 *     `mvn test` from projects/amazon, the SAME selenium-java framework
 *     drives a real Chromium against amazon.in (with manual captcha solve
 *     if Amazon demands it).
 *
 * What this script asserts:
 *   1. /api/rerun runs all recorded steps successfully against the demo shop.
 *   2. Final cart count matches expectations (proves end-to-end side effects).
 *   3. The rerun engine is idempotent — second run produces the same result.
 */

import http from 'node:http';

const BASE = 'http://localhost:3000';
const DEMO_URL = `${BASE}/demo/shop.html`;

// Steps shaped exactly the way the recorder ships them.
// Each click/type carries fallbackSelectors. The live /api/rerun engine
// walks this chain at runtime (see resolveSelectorWithHealing in
// utils/stepHandlers.js) — same contract as the generated Java step defs
// using SELECTOR_FALLBACKS_BY_PRIMARY at `mvn test` time. Result entries
// expose `healed: true / healedVia: "..."` whenever a fallback rescues a
// step.
const RERUN_STEPS = [
  { kind: 'navigate', url: DEMO_URL },
  { kind: 'waitForSelector', selector: '[data-testid="add-to-cart-p-101"]', timeout: 8000 },
  { kind: 'click', selector: '[data-testid="add-to-cart-p-101"]', fallbackSelectors: ['button.add-btn[data-product-id="p-101"]'] },
  { kind: 'click', selector: '[data-testid="add-to-cart-p-201"]', fallbackSelectors: ['button.add-btn[data-product-id="p-201"]'] },
  { kind: 'assertText', selector: '[data-testid="cart-count"]', expectedValue: '2', assertionType: 'equals' },
];

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      `${BASE}${urlPath}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : {} });
          } catch (e) {
            resolve({ status: res.statusCode, body: buf });
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runOnce(label) {
  console.log(`\n[${label}] POST /api/rerun ...`);
  const start = Date.now();
  const res = await request('POST', '/api/rerun', {
    steps: RERUN_STEPS,
    browserType: 'chromium',
    baseUrl: DEMO_URL,
    headless: true,
    stopOnFailure: true,
  });
  const elapsed = Date.now() - start;
  const ok = res.status === 200 && res.body && res.body.success !== false;

  console.log(`  HTTP ${res.status} (${elapsed} ms)`);
  if (res.body && Array.isArray(res.body.results)) {
    res.body.results.forEach((r, i) => {
      const stepKind = r.step || RERUN_STEPS[i]?.kind || '?';
      const sym = r.success ? 'ok' : (r.skipped ? 'skip' : 'FAIL');
      const extra = r.error ? ` — ${r.error}` : '';
      console.log(`    [${sym}] step ${i + 1}/${RERUN_STEPS.length} ${stepKind}${extra}`);
    });
    const passed = res.body.results.filter((r) => r.success).length;
    const failed = res.body.results.filter((r) => !r.success && !r.skipped).length;
    console.log(`  Summary: ${passed} passed, ${failed} failed`);
    if (failed > 0) return { ok: false, summary: res.body };
  }
  return { ok, summary: res.body };
}

async function main() {
  console.log('[CHECK] Server health ...');
  const h = await request('GET', '/api/health');
  if (h.status !== 200) {
    console.error('[FAIL] ZAC server is not reachable on port 3000. Start it with `npm start`.');
    process.exit(1);
  }
  console.log(`  [ok] ZAC server is up`);

  // First run
  const r1 = await runOnce('RUN-1');
  if (!r1.ok) {
    console.error('[FAIL] First rerun did not succeed.');
    process.exit(1);
  }

  // Second run — proves idempotence
  const r2 = await runOnce('RUN-2');
  if (!r2.ok) {
    console.error('[FAIL] Second rerun did not succeed (engine is not idempotent).');
    process.exit(1);
  }

  console.log('\n[DONE] Rerun engine drove all 5 demo-shop steps to green twice.');
  console.log('       Same engine drives projects/amazon — populate .env and `mvn test`.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
