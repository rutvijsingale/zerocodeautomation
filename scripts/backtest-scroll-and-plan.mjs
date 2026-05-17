#!/usr/bin/env node
/**
 * scripts/backtest-scroll-and-plan.mjs
 *
 * End-to-end integration backtest for the scroll-recording + test-plan +
 * Amazon-scenario stack. Drives the live ZAC API and asserts the on-disk
 * artifacts match the spec.
 *
 * Verifies:
 *   1. POST /api/test-plan/generate writes a Markdown plan under
 *      generated-projects/<framework>/<project>/test-plan/.
 *   2. The generated plan never inlines a real credential value.
 *   3. POST /api/amazon-scenarios/generate emits 12 scenario plans (A–L)
 *      and the credential-leak detector finds nothing in any of them.
 *   4. Each plan describes its credentials source via env-var placeholders.
 *   5. Layout is anti-scatter: no files leak outside generated-projects/.
 *
 * Default port: 3000 (override via ZAC_PORT env var).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { findCredentialLeaks } from '../services/amazonScenarios.js';

const PORT = process.env.ZAC_PORT || '3000';
const BASE = `http://localhost:${PORT}`;
const ROOT = path.resolve('.');
const GEN = path.join(ROOT, 'generated-projects');

let assertions = 0;
let failures = 0;
function ok(cond, msg) {
  assertions++;
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.error(`  ✖ ${msg}`);
  }
}

async function http(method, urlPath, body) {
  const res = await fetch(BASE + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}

async function fileExists(p) {
  try { await fs.stat(p); return true; } catch { return false; }
}

async function readText(p) {
  try { return await fs.readFile(p, 'utf8'); } catch { return null; }
}

(async () => {
  console.log(`\n[scroll+plan] backtesting against ${BASE}`);

  // ── 0) Health ────────────────────────────────────────────────────────────
  const health = await http('GET', '/api/health');
  ok(health.status === 200, 'GET /api/health → 200');
  if (health.status !== 200) {
    console.error(`✖ Server not reachable on ${BASE}. Start it with: npm start`);
    process.exit(1);
  }

  // Snapshot files outside generated-projects/ before we run, so we can do
  // an anti-scatter check at the end.
  async function listOutsideGenerated() {
    // Walk the repo top level only; deep scans would be too slow.
    const items = await fs.readdir(ROOT, { withFileTypes: true });
    return items
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .sort();
  }
  const filesBefore = await listOutsideGenerated();

  const FRAMEWORKS = ['playwright-java', 'selenium-java', 'playwright-typescript'];

  // ── 1) Test plan generation (per framework) ──────────────────────────────
  for (const framework of FRAMEWORKS) {
    console.log(`\n[scroll+plan] ${framework}`);
    const projectName = `backtest-scroll-${framework}`;

    // Generate one explicit plan from a synthetic recording.
    const recordingName = 'demo-scroll-flow';
    const r1 = await http('POST', '/api/test-plan/generate', {
      framework,
      projectName,
      recordingName,
      steps: [
        { kind: 'navigate', url: 'https://example.com' },
        {
          kind: 'scroll',
          scrollY: 1250,
          scroll: { direction: 'down', mode: 'y', reason: 'element_search' },
          targetElementMetadata: { tag: 'button', text: 'Add to Cart' },
        },
        {
          kind: 'click',
          selector: '#add-to-cart',
          normalizedDescription: 'Add to Cart button',
          locatorCandidates: [
            { type: 'id', selector: '#add-to-cart', unique: true },
            { type: 'text', selector: 'text=Add to Cart', unique: false },
          ],
          primaryLocatorIndex: 0,
        },
      ],
      metadata: { baseUrl: 'https://example.com', browserType: 'chromium' },
    });
    ok(r1.status === 200, `POST /api/test-plan/generate (${framework}) → 200`);
    if (r1.json && r1.json.testPlanFile) {
      const planFile = r1.json.testPlanFile;
      const exists = await fileExists(planFile);
      ok(exists, `plan file exists: ${path.relative(ROOT, planFile)}`);
      const md = await readText(planFile);
      ok(md && md.includes('Scroll **down**'), 'plan contains scroll narrative');
      ok(md && md.includes('reason=element_search'), 'plan annotates scroll reason');
      ok(findCredentialLeaks(md).length === 0, 'plan has no credential leaks');
      // The plan must be under generated-projects/ (anti-scatter).
      ok(planFile.includes(`generated-projects${path.sep}${framework}${path.sep}${projectName}${path.sep}test-plan`),
        `plan is rooted under generated-projects/${framework}/${projectName}/test-plan/`);
    }

    // Validation: bad framework should reject.
    const bad = await http('POST', '/api/test-plan/generate', {
      framework: 'cypress',
      projectName,
      recordingName: 'x',
    });
    ok(bad.status === 400, 'POST /api/test-plan/generate with unsupported framework → 400');
  }

  // ── 2) Amazon scenarios bulk emit ────────────────────────────────────────
  for (const framework of FRAMEWORKS) {
    console.log(`\n[amazon] ${framework}`);
    const projectName = `backtest-amazon-${framework}`;
    const r2 = await http('POST', '/api/amazon-scenarios/generate', { framework, projectName });
    ok(r2.status === 200, `POST /api/amazon-scenarios/generate (${framework}) → 200`);
    if (r2.json) {
      ok(Array.isArray(r2.json.written), 'response.written is an array');
      // Scenarios A-M (13 total). Source of truth: services/amazonScenarios.js
      // listAmazonScenarios(). Update both the count and the `expected` list
      // whenever a new scenario is added.
      ok(r2.json.written.length === 13, `13 scenarios written (got ${r2.json.written.length})`);
      ok(Array.isArray(r2.json.skipped) && r2.json.skipped.length === 0,
        'no scenarios skipped due to credential leaks');

      const letters = (r2.json.written || []).map((w) => w.scenarioId).sort();
      const expected = [
        'amazon-add-to-cart',
        'amazon-apply-filters',
        'amazon-cart-validation',
        'amazon-login',
        'amazon-login-negative',
        'amazon-open-home',
        'amazon-product-details',
        'amazon-replay-validation',
        'amazon-save-for-later',
        'amazon-scroll-results',
        'amazon-search-product',
        'amazon-sony-wh-ch520-end-to-end',
        'amazon-sort-results',
      ];
      ok(JSON.stringify(letters) === JSON.stringify(expected),
        'all 13 expected scenario IDs are present');

      let leakedAny = false;
      for (const w of r2.json.written) {
        const md = await readText(w.file);
        if (!md) { leakedAny = true; continue; }
        const leaks = findCredentialLeaks(md);
        if (leaks.length > 0) {
          console.error(`    ✖ leaks in ${w.scenarioId}:`, leaks);
          leakedAny = true;
        }
      }
      ok(!leakedAny, 'NO credential leaks in any of the 12 emitted Amazon plans');

      // Login plan must reference env vars by name.
      const login = (r2.json.written || []).find((w) => w.scenarioId === 'amazon-login');
      if (login) {
        const md = await readText(login.file);
        ok(md && md.includes('AMAZON_USERNAME') && md.includes('AMAZON_PASSWORD'),
          'login plan references AMAZON_USERNAME and AMAZON_PASSWORD env vars');
        ok(md && !/password\s*[:=]\s*[A-Za-z0-9!@#]/i.test(md),
          'login plan does NOT inline a literal password value');
      }
    }
  }

  // ── 3) Anti-scatter check ────────────────────────────────────────────────
  const filesAfter = await listOutsideGenerated();
  const newRootFiles = filesAfter.filter((f) => !filesBefore.includes(f));
  ok(newRootFiles.length === 0,
    `no new files leaked outside generated-projects/ (saw: ${newRootFiles.join(', ') || 'none'})`);

  // ── 4) Confirm artifacts live ONLY under generated-projects/ ─────────────
  const exists = await fileExists(GEN);
  ok(exists, 'generated-projects/ directory exists');

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n[scroll+plan] ${assertions - failures}/${assertions} assertions passed`);
  if (failures > 0) {
    console.error('FAIL');
    process.exit(1);
  }
  console.log('PASS');
})().catch((err) => {
  console.error('Backtest crashed:', err);
  process.exit(1);
});
