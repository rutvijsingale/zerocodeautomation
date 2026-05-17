#!/usr/bin/env node
/**
 * scripts/seed-amazon-sony-wh-ch520.mjs
 *
 * Seeds scenario M (Sony WH-CH520 end-to-end) into the running ZAC instance:
 *
 *   1. Health check                         GET  /api/health
 *   2. Generate the framework-aware test plan
 *                                           POST /api/amazon-scenarios/generate
 *   3. Open a real recording session        POST /api/recording/start
 *   4. Stream the canned action sequence    POST /api/recording/:sessionId/action  (×N)
 *   5. Stop & save the recording            POST /api/recording/stop
 *      (mirrors recorded-steps.json, scroll-events.json, element-locators.json,
 *       metadata.json, and auto-regenerates test-plan/<rec>-test-plan.md)
 *   6. (Optional) Trigger replay            POST /api/rerun
 *      (writes reruns/<test>/<timestamp>/{report/status.json, replay-result.json})
 *   7. Print artifact paths so you can rerun from the UI.
 *
 * Credentials are NEVER hardcoded. The recorded `value` fields are the literal
 * strings `${AMAZON_USERNAME}` / `${AMAZON_PASSWORD}` — the step handlers /
 * CredentialsHelper.java resolve them from env vars at execution time.
 *
 * Usage:
 *   PORT=3000 npm start                 # in another shell
 *   npm run seed:amazon-sony            # save + plan only (default — safe)
 *   ZAC_RERUN=1 npm run seed:amazon-sony  # also fire /api/rerun afterwards
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { getAmazonSonyWhCh520Steps } from '../services/amazonScenarios.js';

const PORT = process.env.ZAC_PORT || process.env.PORT || '3000';
const BASE = `http://localhost:${PORT}`;
const FRAMEWORK = process.env.ZAC_FRAMEWORK || 'playwright-java';
// PROJECT_NAME is the human-friendly name shown in the UI project picker.
// PROJECT_FOLDER is the kebab-case id used as the directory name under
// generated-projects/<framework>/. They can differ; if PROJECT_FOLDER is
// not provided, we slug the name.
const PROJECT_NAME = process.env.ZAC_PROJECT_NAME || 'Amazon — Sony WH-CH520 (E2E)';
const PROJECT_FOLDER = process.env.ZAC_PROJECT || 'amazon-sony-wh-ch520';
const RECORDING_NAME = process.env.ZAC_RECORDING || 'sony-wh-ch520-e2e';
const SHOULD_RERUN = process.env.ZAC_RERUN === '1';

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
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

async function fileExists(p) { try { await fs.stat(p); return true; } catch { return false; } }

async function main() {
  console.log(`\n[seed] target          = ${BASE}`);
  console.log(`[seed] framework       = ${FRAMEWORK}`);
  console.log(`[seed] project name    = ${PROJECT_NAME}`);
  console.log(`[seed] project folder  = ${PROJECT_FOLDER}`);
  console.log(`[seed] recordingName   = ${RECORDING_NAME}`);
  console.log(`[seed] AMAZON_USERNAME = ${process.env.AMAZON_USERNAME ? '(set, masked)' : '(not set)'}`);
  console.log(`[seed] AMAZON_PASSWORD = ${process.env.AMAZON_PASSWORD ? '(set, masked)' : '(not set)'}`);
  console.log(`[seed] rerun           = ${SHOULD_RERUN ? 'yes' : 'no  (set ZAC_RERUN=1 to enable)'}`);

  // ─ 1. Health ──────────────────────────────────────────────────────────
  console.log('\n[1] Health check');
  let h;
  try { h = await http('GET', '/api/health'); }
  catch (err) {
    console.error(`✖ Server not reachable on ${BASE}: ${err.message}`);
    console.error(`  Start the app with:  PORT=${PORT} npm start`);
    process.exit(2);
  }
  ok(h.status === 200, 'server healthy');

  // ─ 2. Register (or look up) the project so it appears in the UI picker ─
  // The UI lists projects from `projectService.listProjects()` (the legacy
  // `projects/` directory). We MUST register the project there or the UI
  // never sees it — even though our framework-aware tree under
  // `generated-projects/<framework>/<folder>/` is created either way.
  console.log('\n[2] Register project with projectService (so the UI picker shows it)');
  let projectId = null;
  const listRes = await http('GET', '/api/projects');
  const existing = (listRes.json && (listRes.json.projects || listRes.json) || []).find(
    (p) => p && (p.name === PROJECT_NAME || p.id === PROJECT_FOLDER)
  );
  if (existing) {
    projectId = existing.id;
    console.log(`  ↳ found existing project: id=${projectId}, name="${existing.name}"`);
  } else {
    const createRes = await http('POST', '/api/projects', {
      name: PROJECT_NAME,
      description: 'Amazon end-to-end: login → search Sony WH-CH520 → assert → add to cart → logout. Stops before payment.',
      baseUrl: 'https://www.amazon.com',
      framework: FRAMEWORK,
      browserType: 'chromium',
    });
    if (createRes.status === 200 && createRes.json && createRes.json.project && createRes.json.project.id) {
      projectId = createRes.json.project.id;
      console.log(`  ↳ created project: id=${projectId}, name="${PROJECT_NAME}"`);
    } else {
      console.error(`  ✖ POST /api/projects failed (${createRes.status}): ${createRes.text.slice(0, 300)}`);
      process.exit(2);
    }
  }
  ok(typeof projectId === 'string' && projectId.length > 0, `projectId resolved (${projectId})`);

  // The /recording/stop handler will use the project's *registered id* as
  // the folder name under generated-projects/<framework>/. Align the
  // catalog plan write to that same id so we don't end up with a parallel
  // empty folder. (The kebab `PROJECT_FOLDER` is only used as a default
  // when the project hasn't been registered yet.)
  const folderName = projectId;

  // ─ 3. Generate the framework-aware test plan from the curated catalog ─
  console.log('\n[3] Generate the framework-aware test plan (scenario M)');
  const planRes = await http('POST', '/api/amazon-scenarios/generate', {
    framework: FRAMEWORK,
    projectName: folderName,
    only: ['M'], // filter the catalog to scenario M only
  });
  ok(planRes.status === 200, `POST /api/amazon-scenarios/generate → ${planRes.status}`);
  let planFile = null;
  if (planRes.json && Array.isArray(planRes.json.written) && planRes.json.written.length) {
    planFile = planRes.json.written[0].file || null;
  }
  if (planFile) console.log(`  ↳ catalog test plan: ${path.relative(process.cwd(), planFile)}`);

  // ─ 4. Open a real recording session ───────────────────────────────────
  console.log('\n[4] Open a real recording session');
  const startRes = await http('POST', '/api/recording/start', {
    baseUrl: 'https://www.amazon.com',
    browserType: 'chromium',
    projectId,
  });
  ok(startRes.status === 200 && startRes.json && startRes.json.sessionId,
    `POST /api/recording/start → ${startRes.status}`);
  if (failures > 0) {
    console.error('  → cannot continue without a session.');
    console.error('  Server response:', startRes.text.slice(0, 400));
    process.exit(2);
  }
  const sessionId = startRes.json.sessionId;
  console.log(`  sessionId = ${sessionId}`);

  // ─ 5. Stream the canned action sequence ───────────────────────────────
  console.log('\n[5] Stream Sony WH-CH520 actions to the recorder');
  const steps = getAmazonSonyWhCh520Steps();
  let posted = 0;
  for (const step of steps) {
    const r = await http('POST', `/api/recording/${sessionId}/action`, { sessionId, ...step });
    if (r.status === 200) posted++;
    else console.error(`    ✖ action[${step.kind} ${step.selector || step.url || ''}] → ${r.status}`);
  }
  ok(posted === steps.length, `posted ${posted}/${steps.length} actions`);

  // ─ 6. Stop & save ─────────────────────────────────────────────────────
  // We DO want the legacy projects/<id>/ persistence here so the project
  // shows up everywhere the UI looks (project picker, locator repository,
  // etc). The framework-aware tree under generated-projects/ is created
  // in addition to that.
  console.log('\n[6] Stop recording + save framework project');
  const stopRes = await http('POST', '/api/recording/stop', {
    sessionId,
    projectId,
    projectName: folderName,
    framework: FRAMEWORK,
    featureName: RECORDING_NAME,
    featureTitle: 'Sony WH-CH520 — login, search, add to cart, logout',
    baseUrl: 'https://www.amazon.com',
    browserType: 'chromium',
  });
  ok(stopRes.status === 200, `POST /api/recording/stop → ${stopRes.status}`);
  const layout = (stopRes.json && stopRes.json.layout) || {};
  const projectRoot = layout.root || path.join(process.cwd(), 'generated-projects', FRAMEWORK, folderName);
  const recordingDir = layout.recordingDir;

  if (recordingDir) {
    console.log(`  recording: ${path.relative(process.cwd(), recordingDir)}`);
    ok(await fileExists(path.join(recordingDir, 'recorded-steps.json')), 'recorded-steps.json written');
    ok(await fileExists(path.join(recordingDir, 'scroll-events.json')), 'scroll-events.json written');
    ok(await fileExists(path.join(recordingDir, 'element-locators.json')), 'element-locators.json written');
    ok(await fileExists(path.join(recordingDir, 'metadata.json')), 'metadata.json written');
  }
  const planMd = path.join(projectRoot, 'test-plan', `${RECORDING_NAME}-test-plan.md`);
  if (await fileExists(planMd)) {
    console.log(`  test plan: ${path.relative(process.cwd(), planMd)}`);
    const md = await fs.readFile(planMd, 'utf8');
    ok(md.includes('WH-CH520') || md.includes('Sony'), 'test plan mentions Sony WH-CH520');
    ok(!/password\s*[:=]\s*[^$<\s][^\s`]+/i.test(md), 'no inlined password in test plan');
  }

  // ─ 7. Optional replay ─────────────────────────────────────────────────
  if (SHOULD_RERUN) {
    console.log('\n[7] POST /api/rerun (live replay against amazon.com)');
    if (!process.env.AMAZON_USERNAME || !process.env.AMAZON_PASSWORD) {
      console.warn('  ⚠️  AMAZON_USERNAME / AMAZON_PASSWORD not set in this shell.');
      console.warn('     Login steps will fail — proceeding anyway so you can see healing logs.');
    }
    const rerunRes = await http('POST', '/api/rerun', {
      steps,
      projectId,
      framework: FRAMEWORK,
      testName: RECORDING_NAME,
      baseUrl: 'https://www.amazon.com',
      browserType: 'chromium',
      headless: false,
    });
    ok(rerunRes.status === 200, `POST /api/rerun → ${rerunRes.status}`);
    if (rerunRes.json && rerunRes.json.layout) {
      const rl = rerunRes.json.layout;
      console.log(`  rerun report: ${path.relative(process.cwd(), rl.report || rl.rerunDir)}`);
      ok(await fileExists(rl.replayResult), 'replay-result.json written');
      const rep = JSON.parse(await fs.readFile(rl.replayResult, 'utf8'));
      console.log(`    executedSteps : ${rep.executedSteps}`);
      console.log(`    successCount  : ${rep.successCount}`);
      console.log(`    failureCount  : ${rep.failureCount}`);
      console.log(`    healingEvents : ${rep.healingSummary && rep.healingSummary.healingEvents}`);
      console.log(`    healedSteps   : ${rep.healingSummary && rep.healingSummary.healedSteps}`);
      console.log(`    scrollSteps   : ${rep.scrollSummary && rep.scrollSummary.scrollSteps}`);
    }
  } else {
    console.log('\n[7] Replay skipped (set ZAC_RERUN=1 to fire /api/rerun against amazon.com).');
  }

  // ─ Summary ────────────────────────────────────────────────────────────
  console.log(`\n[seed] ${assertions - failures}/${assertions} assertions passed`);
  console.log('\nNext steps:');
  console.log(`  • Open the UI at ${BASE} → project picker → select "${PROJECT_NAME}" (id: ${projectId})`);
  console.log(`  • Open recording "${RECORDING_NAME}" → click Replay / Rerun`);
  console.log(`  • Or from the CLI:  ZAC_RERUN=1 npm run seed:amazon-sony`);
  console.log(`  • Set credentials BEFORE rerunning:`);
  console.log(`        export AMAZON_USERNAME=...`);
  console.log(`        export AMAZON_PASSWORD=...`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error('[seed] crashed:', err);
  process.exit(1);
});
