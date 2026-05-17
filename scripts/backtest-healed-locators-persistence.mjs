#!/usr/bin/env node
/* eslint-disable */
/**
 * scripts/backtest-healed-locators-persistence.mjs
 *
 * Proves the live rerun engine writes a heal record to
 * `projects/<projectId>/healed-locators.json` whenever the healer rescues
 * a step.
 *
 * How it works:
 *   1. Wipes any pre-existing healed-locators.json for the test project.
 *   2. POST /api/rerun with `projectId: "demoshop-heal-persistence"` and a
 *      stale primary selector that forces the healer to walk to a fallback.
 *   3. Reads back the file and asserts:
 *        - file exists
 *        - has at least one entry
 *        - entry primarySelector / healedSelector match what the engine reports
 *        - timestamp is sane (within last minute)
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = 'http://localhost:3000';
const PROJECT_ID = 'demoshop-heal-persistence';
const HEAL_FILE = path.join('projects', PROJECT_ID, 'healed-locators.json');
const DEMO_URL = `${BASE}/demo/shop.html?shake=1&seed=99`;

const RERUN_STEPS = [
  { kind: 'navigate', url: DEMO_URL },
  { kind: 'waitForSelector', selector: '[data-testid="add-to-cart-p-101"]', timeout: 8000 },
  {
    kind: 'click',
    selector: '#add-p-101', // stale in shake mode
    fallbackSelectors: [
      'button.add-btn[data-product-id="p-101"]', // unique → should heal here
    ],
  },
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

function fail(msg) {
  console.error(`\n[FAIL] ${msg}`);
  process.exit(1);
}

async function main() {
  console.log('[SETUP] Wiping any prior healed-locators.json for test project ...');
  try { await fs.unlink(HEAL_FILE); } catch (_) {}
  // Ensure the project directory exists so the service can write to it.
  await fs.mkdir(path.dirname(HEAL_FILE), { recursive: true });
  console.log(`  [ok] ${HEAL_FILE} reset`);

  console.log('\n[CHECK] Server health ...');
  const h = await request('GET', '/api/health');
  if (h.status !== 200) fail('ZAC server is not reachable on port 3000.');
  console.log('  [ok] ZAC server is up');

  console.log('\n[RUN] POST /api/rerun with projectId for persistence ...');
  const res = await request('POST', '/api/rerun', {
    steps: RERUN_STEPS,
    browserType: 'chromium',
    baseUrl: DEMO_URL,
    headless: true,
    stopOnFailure: true,
    projectId: PROJECT_ID,
  });
  if (res.status !== 200 || !res.body || res.body.success !== true) {
    console.error('  body:', JSON.stringify(res.body, null, 2));
    fail('Rerun did not succeed');
  }

  // Find the heal step
  const click = res.body.results.find((r) => r.healed === true);
  if (!click) fail('No step reported healed=true; the healer did not engage.');
  if (!click.healSavedTo) {
    fail('Result is missing healSavedTo, so the engine did not call saveHealedLocator.');
  }
  console.log(`  [ok] engine reported persistence to ${click.healSavedTo}`);

  console.log('\n[ASSERT] Read back healed-locators.json ...');
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(HEAL_FILE, 'utf8'));
  } catch (err) {
    fail(`Could not read ${HEAL_FILE}: ${err.message}`);
  }

  if (!parsed || typeof parsed !== 'object') fail('healed-locators.json is not a JSON object');
  if (parsed.project !== PROJECT_ID) fail(`Expected project=${PROJECT_ID}, got ${parsed.project}`);
  if (parsed.version !== 1) fail(`Expected version=1, got ${parsed.version}`);
  if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) {
    fail('Expected at least one entry in entries[]');
  }

  const entry = parsed.entries[parsed.entries.length - 1];
  if (entry.primarySelector !== '#add-p-101') {
    fail(`Expected primarySelector="#add-p-101", got "${entry.primarySelector}"`);
  }
  if (entry.healedSelector !== 'button.add-btn[data-product-id="p-101"]') {
    fail(`Expected healedSelector to be the unique data-product-id fallback, got "${entry.healedSelector}"`);
  }
  const ageMs = Date.now() - Date.parse(entry.timestamp);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 60_000) {
    fail(`timestamp is suspicious: ${entry.timestamp} (age=${ageMs}ms)`);
  }
  if (!Array.isArray(entry.attempts) || entry.attempts.length < 2) {
    fail('Entry missing the attempts trail');
  }

  console.log(`  [ok] entry recorded:`);
  console.log(`         primarySelector: ${entry.primarySelector}`);
  console.log(`         healedSelector:  ${entry.healedSelector}`);
  console.log(`         pageName:        ${entry.pageName}`);
  console.log(`         elementName:     ${entry.elementName}`);
  console.log(`         attempts:        ${entry.attempts.length}`);
  console.log(`         age:             ${ageMs} ms`);

  console.log('\n[DEDUPE] Re-run within the 60 s window — should NOT add a new entry ...');
  const before = parsed.entries.length;
  await request('POST', '/api/rerun', {
    steps: RERUN_STEPS,
    browserType: 'chromium',
    baseUrl: DEMO_URL,
    headless: true,
    stopOnFailure: true,
    projectId: PROJECT_ID,
  });
  const reparsed = JSON.parse(await fs.readFile(HEAL_FILE, 'utf8'));
  if (reparsed.entries.length !== before) {
    fail(`Dedupe failed — entries grew from ${before} to ${reparsed.entries.length}`);
  }
  console.log(`  [ok] entries still ${before} (dedupe window honoured)`);

  console.log('\n[DONE] healed-locators.json is written, deduped, and shaped per spec.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
