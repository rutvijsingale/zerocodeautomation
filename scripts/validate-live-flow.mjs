#!/usr/bin/env node
/**
 * scripts/validate-live-flow.mjs
 *
 * End-to-end live validation of the record → save → update → replay flow.
 * Exercises every backend endpoint a real UI session would touch, in order:
 *
 *   1. Health check                 → GET  /api/health
 *   2. Start recording              → POST /api/recording/start
 *   3. Stream synthetic actions     → POST /api/recording/:sessionId/action
 *      (navigate / scroll / click after scroll / type / scroll / click)
 *   4. Stop recording + save        → POST /api/recording/stop
 *      (writes generated-projects/<framework>/<project>/recordings/<rec>/*,
 *       auto-generates test-plan/<rec>-test-plan.md)
 *   5. Update project               → POST /api/test-plan/generate (regenerate)
 *      → POST /api/project-layout/recording (second recording — coexistence)
 *   6. Replay (rerun)               → POST /api/rerun
 *      (writes reruns/<test>/<timestamp>/{report/status.json, replay-result.json})
 *   7. Recording-level data check   → invokes scripts/validate-recording.mjs
 *   8. Anti-scatter check           → diff repo root files (before vs after)
 *
 * Usage:
 *     PORT=3000 npm start          # in another shell
 *     npm run validate:live-flow
 *
 * Exit codes:
 *     0  every assertion passed
 *     1  one or more hard assertions failed
 *     2  server unreachable / setup blocker
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const PORT = process.env.ZAC_PORT || process.env.PORT || '3000';
const BASE = `http://localhost:${PORT}`;
const ROOT = path.resolve('.');
const GEN = path.join(ROOT, 'generated-projects');
const FRAMEWORK = process.env.ZAC_FRAMEWORK || 'playwright-java';
const PROJECT = process.env.ZAC_PROJECT || `live-flow-${Date.now().toString(36)}`;
const RECORDING_NAME = 'live-flow-demo';

let assertions = 0;
let failures = 0;
const fails = [];
const okMsgs = [];

function ok(cond, msg) {
  assertions++;
  if (cond) {
    okMsgs.push(msg);
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    fails.push(msg);
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

async function fileExists(p) {
  try { await fs.stat(p); return true; } catch { return false; }
}
async function readJson(p) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; }
}
async function listRoot() {
  const items = await fs.readdir(ROOT, { withFileTypes: true });
  return items.filter((d) => d.isFile()).map((d) => d.name).sort();
}

async function main() {
  console.log(`\n[live-flow] target: ${BASE}`);
  console.log(`[live-flow] framework=${FRAMEWORK} project=${PROJECT}`);

  // ─ 1. Health check ─────────────────────────────────────────────────────
  console.log('\n[1] Health check');
  let health;
  try {
    health = await http('GET', '/api/health');
  } catch (err) {
    console.error(`✖ Server not reachable on ${BASE}: ${err.message}`);
    console.error(`  Start the app with:  PORT=${PORT} npm start`);
    process.exit(2);
  }
  ok(health.status === 200, `GET /api/health → 200 (uptime ${health.json && health.json.uptime ? Math.round(health.json.uptime) + 's' : '?'})`);

  const filesBefore = await listRoot();

  // ─ 2. Start recording ──────────────────────────────────────────────────
  console.log('\n[2] Start recording session');
  const startRes = await http('POST', '/api/recording/start', {
    baseUrl: 'about:blank',
    browserType: 'chromium',
    projectId: PROJECT,
  });
  ok(startRes.status === 200 && startRes.json && startRes.json.sessionId,
    `POST /api/recording/start → 200 (sessionId set)`);
  if (failures > 0) {
    console.error('  → cannot continue without a session. Aborting.');
    console.error('  Server response:', startRes.text);
    process.exit(2);
  }
  const sessionId = startRes.json.sessionId;
  console.log(`  sessionId = ${sessionId}`);

  // ─ 3. Stream synthetic actions ─────────────────────────────────────────
  console.log('\n[3] Stream actions: navigate / scroll / click after scroll / type / scroll / click');
  const baseUrl = 'https://example.com';
  const actions = [
    {
      sessionId, kind: 'navigate', url: baseUrl,
      pageTitle: 'Example Domain', timestamp: Date.now(),
    },
    {
      sessionId, kind: 'scroll',
      scrollX: 0, scrollY: 600,
      direction: 'down', reason: 'page_explore',
      pageUrl: baseUrl,
      viewportHeight: 720, viewportWidth: 1280,
      scroll: { mode: 'y', y: 600, direction: 'down', reason: 'page_explore' },
      timestamp: Date.now() + 100,
    },
    {
      sessionId, kind: 'click',
      selector: '#cta-after-scroll',
      tagName: 'button',
      textContent: 'Continue',
      ariaLabel: 'Continue',
      pageUrl: baseUrl,
      scrollY: 600,
      locatorCandidates: [
        { type: 'id', selector: '#cta-after-scroll', unique: true },
        { type: 'role', selector: 'role=button[name="Continue"]', unique: true },
        { type: 'text', selector: 'text=Continue', unique: false },
      ],
      primaryLocatorIndex: 0,
      elementMetadata: { tag: 'button', text: 'Continue', role: 'button' },
      timestamp: Date.now() + 200,
    },
    {
      sessionId, kind: 'type',
      selector: '#name',
      tagName: 'input',
      value: 'Live Flow QA',
      placeholder: 'Your name',
      pageUrl: baseUrl,
      locatorCandidates: [
        { type: 'id', selector: '#name', unique: true },
        { type: 'placeholder', selector: 'placeholder=Your name', unique: true },
      ],
      primaryLocatorIndex: 0,
      elementMetadata: { tag: 'input', placeholder: 'Your name' },
      timestamp: Date.now() + 300,
    },
    {
      sessionId, kind: 'scroll',
      scrollX: 0, scrollY: 1400,
      direction: 'down', reason: 'element_search',
      pageUrl: baseUrl,
      viewportHeight: 720, viewportWidth: 1280,
      scroll: {
        mode: 'element', y: 1400, direction: 'down', reason: 'element_search',
        locatorCandidates: [{ type: 'id', selector: '#submit', unique: true }],
        primaryLocatorIndex: 0,
        targetElementVisibleAfter: true,
      },
      targetElementMetadata: { tag: 'button', text: 'Submit' },
      timestamp: Date.now() + 400,
    },
    {
      sessionId, kind: 'click',
      selector: '#submit',
      tagName: 'button',
      textContent: 'Submit',
      pageUrl: baseUrl,
      scrollY: 1400,
      locatorCandidates: [
        { type: 'id', selector: '#submit', unique: true },
        { type: 'role', selector: 'role=button[name="Submit"]', unique: true },
      ],
      primaryLocatorIndex: 0,
      elementMetadata: { tag: 'button', text: 'Submit', role: 'button' },
      timestamp: Date.now() + 500,
    },
  ];

  let postedActions = 0;
  for (const a of actions) {
    const r = await http('POST', `/api/recording/${sessionId}/action`, a);
    if (r.status === 200) postedActions++;
    else console.error(`    ✖ action[${a.kind}] failed: ${r.status} ${r.text}`);
  }
  ok(postedActions === actions.length,
    `posted ${postedActions}/${actions.length} actions to /api/recording/${sessionId}/action`);

  // Sanity: ask the server how many actions it is currently holding for this session.
  const sActions = await http('GET', `/api/recording/${sessionId}/actions`);
  const actionsHeld = sActions.json && Array.isArray(sActions.json.actions) ? sActions.json.actions.length : 0;
  ok(sActions.status === 200, 'GET /api/recording/:sessionId/actions → 200');
  ok(actionsHeld === actions.length, `server is holding ${actionsHeld}/${actions.length} actions`);

  // ─ 4. Stop recording & save ────────────────────────────────────────────
  console.log('\n[4] Stop recording + save project');
  const stopRes = await http('POST', '/api/recording/stop', {
    sessionId,
    projectId: PROJECT,
    projectName: PROJECT,
    framework: FRAMEWORK,
    featureName: RECORDING_NAME,
    featureTitle: 'Live Flow Demo',
    baseUrl,
    browserType: 'chromium',
    skipProjectCreation: true,
  });
  ok(stopRes.status === 200, `POST /api/recording/stop → 200`);
  if (stopRes.status !== 200) {
    console.error('  Server response:', stopRes.text.slice(0, 800));
  }

  ok(stopRes.json && stopRes.json.layout && stopRes.json.layout.recordingDir,
    'response.layout.recordingDir is set (framework-organized save)');
  const layout = (stopRes.json && stopRes.json.layout) || {};
  const recordingDir = layout.recordingDir;
  if (recordingDir) {
    console.log(`  saved to: ${path.relative(ROOT, recordingDir)}`);
  }

  // Verify the saved project tree looks correct.
  const projectRoot = layout.root || path.join(GEN, FRAMEWORK, PROJECT);
  const expectedDirs = [
    'tests', 'pages', 'locators', 'data', 'config', 'utils',
    'recordings', 'reruns', 'reports', 'screenshots', 'videos', 'logs',
    'test-plan',
  ];
  for (const d of expectedDirs) {
    ok(await fileExists(path.join(projectRoot, d)), `dir exists: ${d}/`);
  }
  ok(await fileExists(path.join(projectRoot, 'README.md')), 'README.md exists');

  if (recordingDir) {
    ok(await fileExists(path.join(recordingDir, 'recorded-steps.json')), 'recordings/<rec>/recorded-steps.json');
    ok(await fileExists(path.join(recordingDir, 'scroll-events.json')), 'recordings/<rec>/scroll-events.json');
    ok(await fileExists(path.join(recordingDir, 'element-locators.json')), 'recordings/<rec>/element-locators.json');
    ok(await fileExists(path.join(recordingDir, 'metadata.json')), 'recordings/<rec>/metadata.json');
    ok(await fileExists(path.join(recordingDir, 'screenshots')), 'recordings/<rec>/screenshots/');
    ok(await fileExists(path.join(recordingDir, 'dom-snapshots')), 'recordings/<rec>/dom-snapshots/');

    const recordedSteps = await readJson(path.join(recordingDir, 'recorded-steps.json'));
    ok(Array.isArray(recordedSteps) && recordedSteps.length === actions.length,
      `recorded-steps.json contains ${recordedSteps && recordedSteps.length} steps (expected ${actions.length})`);

    const scrollEvents = await readJson(path.join(recordingDir, 'scroll-events.json'));
    const expectedScrolls = actions.filter((a) => a.kind === 'scroll').length;
    ok(Array.isArray(scrollEvents) && scrollEvents.length === expectedScrolls,
      `scroll-events.json contains ${scrollEvents && scrollEvents.length} events (expected ${expectedScrolls})`);

    const locatorRecords = await readJson(path.join(recordingDir, 'element-locators.json'));
    ok(Array.isArray(locatorRecords) && locatorRecords.length >= 3,
      `element-locators.json contains ${locatorRecords && locatorRecords.length} interactive steps (expected ≥3)`);
    if (Array.isArray(locatorRecords)) {
      const allHaveAlternates = locatorRecords.every((r) => r.locatorCandidates && r.locatorCandidates.length >= 2);
      ok(allHaveAlternates, 'every interactive step has ≥2 locator candidates (primary + alternate)');
    }
  }

  // Test plan auto-generated?
  const planFile = path.join(projectRoot, 'test-plan', `${RECORDING_NAME}-test-plan.md`);
  ok(await fileExists(planFile), `test-plan/${RECORDING_NAME}-test-plan.md auto-generated`);
  if (await fileExists(planFile)) {
    const md = await fs.readFile(planFile, 'utf8');
    ok(md.includes('Scroll **down**'), 'test plan describes scroll narrative');
    ok(!/password\s*[:=]\s*[^$<\s][^\s`]+/i.test(md), 'test plan does not inline a literal password');
  }

  // ─ 5. Update project ───────────────────────────────────────────────────
  console.log('\n[5] Update project (regenerate test plan + add a second recording)');
  const updRes = await http('POST', '/api/test-plan/generate', {
    framework: FRAMEWORK,
    projectName: PROJECT,
    recordingName: RECORDING_NAME,
    plan: {
      scenarioId: RECORDING_NAME,
      title: 'Live Flow Demo (UPDATED)',
      framework: FRAMEWORK,
      projectName: PROJECT,
      applicationName: 'Example.com',
      objective: 'Updated objective after manual edits',
      steps: ['1. Navigate to https://example.com', '2. Scroll down', '3. Click Submit'],
    },
  });
  ok(updRes.status === 200, 'POST /api/test-plan/generate (regenerate) → 200');
  if (await fileExists(planFile)) {
    const md = await fs.readFile(planFile, 'utf8');
    ok(md.includes('UPDATED'), 'test plan was actually overwritten with the new content');
  }

  // Add a SECOND recording → first must remain intact.
  const secondRec = 'live-flow-demo-2';
  const recRes = await http('POST', '/api/project-layout/recording', {
    framework: FRAMEWORK,
    projectName: PROJECT,
    recordingName: secondRec,
  });
  ok(recRes.status === 200, 'POST /api/project-layout/recording (second recording) → 200');
  ok(await fileExists(path.join(projectRoot, 'recordings', secondRec)),
    `second recording dir exists: recordings/${secondRec}/`);
  ok(await fileExists(recordingDir),
    'first recording is still intact (not overwritten)');

  // ─ 6. Replay (rerun) ──────────────────────────────────────────────────
  console.log('\n[6] Replay via POST /api/rerun');
  // We use only the click steps for the rerun — example.com doesn't actually
  // have #cta-after-scroll / #submit, so the runner WILL hit healing failures.
  // That's the point: we want to verify rerun artifacts are written even on
  // failure, including the healing summary in replay-result.json.
  const rerunRes = await http('POST', '/api/rerun', {
    // /api/rerun expects `steps` (not `actions`). The recorded action
    // objects already carry the `kind` field that step handlers consume.
    steps: actions,
    projectId: PROJECT,
    framework: FRAMEWORK,
    testName: RECORDING_NAME,
    baseUrl,
    browserType: 'chromium',
    headless: true,
  });
  ok(rerunRes.status === 200, `POST /api/rerun → 200 (status: ${rerunRes.status})`);
  if (rerunRes.json && rerunRes.json.layout) {
    const rl = rerunRes.json.layout;
    console.log(`  rerun report: ${path.relative(ROOT, rl.report || rl.rerunDir)}`);
    ok(await fileExists(rl.rerunDir), `reruns/<test>/<timestamp>/ exists`);
    ok(await fileExists(path.join(rl.report, 'status.json')), 'reruns/.../report/status.json');
    ok(await fileExists(rl.replayResult), 'reruns/.../replay-result.json');
    const replay = await readJson(rl.replayResult);
    ok(replay && Array.isArray(replay.results), 'replay-result.json parses with .results array');
    if (replay) {
      ok(typeof replay.executedSteps === 'number', '.executedSteps is numeric');
      ok(typeof replay.healingSummary === 'object' && replay.healingSummary !== null,
        '.healingSummary present (records heal events)');
      ok(typeof replay.scrollSummary === 'object' && replay.scrollSummary !== null,
        '.scrollSummary present (records scroll-step count)');
      const expectedScrolls = actions.filter((a) => a.kind === 'scroll').length;
      ok(replay.scrollSummary && replay.scrollSummary.scrollSteps === expectedScrolls,
        `.scrollSummary.scrollSteps === ${expectedScrolls} (got ${replay.scrollSummary && replay.scrollSummary.scrollSteps})`);
    }
  } else {
    ok(false, 'rerun response missing layout — rerun did not persist to generated-projects/');
  }

  // ─ 7. Recording-level validation script ───────────────────────────────
  console.log('\n[7] Run scripts/validate-recording.mjs against the saved recording');
  if (recordingDir) {
    const r = spawnSync('node', ['scripts/validate-recording.mjs', recordingDir],
      { cwd: ROOT, encoding: 'utf8' });
    if (r.stdout) console.log(r.stdout.split('\n').map((l) => '    ' + l).join('\n'));
    if (r.stderr) console.error(r.stderr.split('\n').map((l) => '    ' + l).join('\n'));
    ok(r.status === 0, `validate-recording.mjs exit=${r.status}`);
  }

  // ─ 8. Anti-scatter check ──────────────────────────────────────────────
  console.log('\n[8] Anti-scatter check — no new files in repo root');
  const filesAfter = await listRoot();
  const stray = filesAfter.filter((f) => !filesBefore.includes(f));
  ok(stray.length === 0, `no stray files at repo root (added: ${stray.join(', ') || 'none'})`);

  // ─ Summary ─────────────────────────────────────────────────────────────
  console.log(`\n[live-flow] ${assertions - failures}/${assertions} assertions passed`);
  if (failures > 0) {
    console.error('FAILURES:');
    for (const f of fails) console.error(`  ✖ ${f}`);
    process.exit(1);
  }
  console.log('\nPASS — record / save / update / replay flow works end-to-end.');
}

main().catch((err) => {
  console.error('[live-flow] crashed:', err);
  process.exit(1);
});
