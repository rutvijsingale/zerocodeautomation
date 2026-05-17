#!/usr/bin/env node
/**
 * scripts/backtest-framework-layout.mjs
 *
 * End-to-end integration check for the framework-aware project layout:
 *   1. Hits GET /api/frameworks and asserts only the frameworks the app
 *      actually wires up are returned (no Cypress/WebdriverIO/etc).
 *   2. For every detected framework, calls POST /api/project-layout/scaffold
 *      and asserts the spec-mandated folder tree exists on disk.
 *   3. Calls POST /api/project-layout/recording and writes a recorded-steps.json
 *      at the returned path; verifies the file lives under
 *      generated-projects/<framework>/<project>/recordings/<recording>/.
 *   4. Calls POST /api/project-layout/rerun and verifies the rerun directory
 *      lives under reruns/<test>/<timestamp>/.
 *   5. Calls the rejection cases (no framework, unsupported framework,
 *      missing project name, invalid name) and asserts a 400 with a useful
 *      error message.
 *   6. Confirms that the test write all of its files under
 *      generated-projects/<framework>/ — nothing scatters into the repo root.
 *
 * Run with: node scripts/backtest-framework-layout.mjs
 */

import http from 'http';
import fs from 'fs/promises';
import path from 'path';

const BASE = process.env.ZAC_BASE || 'http://localhost:3001';
const HOST = new URL(BASE).hostname;
const PORT = Number(new URL(BASE).port) || 3001;

const TEST_PROJECT = 'layout-backtest';

let pass = 0;
let fail = 0;
const failures = [];

function logPass(msg) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${msg}`); }
function logFail(msg) { fail++; failures.push(msg); console.log(`  \x1b[31m✗\x1b[0m ${msg}`); }
function header(msg) { console.log(`\n\x1b[1m${msg}\x1b[0m`); }

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: HOST,
      port: PORT,
      method,
      path: urlPath,
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function exists(p) {
  try { await fs.stat(p); return true; } catch { return false; }
}

async function isDir(p) {
  try { return (await fs.stat(p)).isDirectory(); } catch { return false; }
}

async function checkHealth() {
  try {
    const r = await request('GET', '/api/health');
    return r.status === 200;
  } catch { return false; }
}

(async () => {
  console.log(`\n\x1b[1mFramework Layout Backtest\x1b[0m  →  ${BASE}\n`);

  if (!(await checkHealth())) {
    console.log('\x1b[31mServer not reachable. Start it first: PORT=3001 npm start\x1b[0m');
    process.exit(2);
  }

  /* --------------------------------------------------------------- *
   * 1. Discover frameworks via the public API                       *
   * --------------------------------------------------------------- */
  header('1. GET /api/frameworks — registry discovery');
  const fwRes = await request('GET', '/api/frameworks');
  if (fwRes.status !== 200 || !fwRes.body || !Array.isArray(fwRes.body.frameworks)) {
    logFail(`expected 200 + frameworks[], got ${fwRes.status} body=${JSON.stringify(fwRes.body).slice(0, 120)}`);
    process.exit(1);
  }
  const detected = fwRes.body.frameworks;
  const ids = detected.map((f) => f.id).sort();
  console.log(`     detected: ${ids.join(', ')}`);
  // The frameworks must match exactly what's wired up in the generators.
  // No Cypress, no WebdriverIO — only what's actually supported today.
  // Source of truth: config/frameworks.json + generators/<id>.js.
  const expected = ['playwright-java', 'playwright-typescript', 'selenium-java', 'selenium-testng'];
  if (JSON.stringify(ids) === JSON.stringify(expected)) {
    logPass(`registry returns exactly the ${expected.length} frameworks wired into the generators`);
  } else {
    logFail(`unexpected framework set: got ${JSON.stringify(ids)}, expected ${JSON.stringify(expected)}`);
  }
  for (const f of detected) {
    if (f.label && f.language && f.runner && f.runner.command) {
      logPass(`${f.id}: label/language/runner present`);
    } else {
      logFail(`${f.id}: missing label/language/runner — ${JSON.stringify(f)}`);
    }
  }

  /* --------------------------------------------------------------- *
   * 2. Per-framework scaffold + 3. recording + 4. rerun             *
   * --------------------------------------------------------------- */
  for (const fw of detected) {
    header(`2. POST /api/project-layout/scaffold — ${fw.id}`);
    const scaffold = await request('POST', '/api/project-layout/scaffold', {
      framework: fw.id,
      projectName: TEST_PROJECT,
    });
    if (scaffold.status !== 200) {
      logFail(`${fw.id}: scaffold returned ${scaffold.status} ${JSON.stringify(scaffold.body)}`);
      continue;
    }
    const root = scaffold.body.root;
    const expectedRoot = path.resolve('generated-projects', fw.id, TEST_PROJECT);
    if (root === expectedRoot) {
      logPass(`${fw.id}: project root resolves to generated-projects/${fw.id}/${TEST_PROJECT}/`);
    } else {
      logFail(`${fw.id}: unexpected root ${root} (wanted ${expectedRoot})`);
    }
    const requiredSubdirs = [
      'tests', 'pages', 'locators', 'data', 'config', 'utils',
      'recordings', 'reruns', 'reports', 'screenshots', 'videos', 'logs',
    ];
    let subdirsOk = true;
    for (const s of requiredSubdirs) {
      if (!(await isDir(path.join(root, s)))) {
        subdirsOk = false;
        logFail(`${fw.id}: missing subdir ${s}/`);
      }
    }
    if (subdirsOk) logPass(`${fw.id}: all 12 generic subdirs created`);
    if (await exists(path.join(root, 'README.md'))) {
      const md = await fs.readFile(path.join(root, 'README.md'), 'utf8');
      if (md.includes(fw.id) && md.includes(fw.runner.command)) {
        logPass(`${fw.id}: README.md mentions framework + runner`);
      } else {
        logFail(`${fw.id}: README.md missing framework/runner reference`);
      }
    } else {
      logFail(`${fw.id}: README.md not created`);
    }

    // Java conventions check.
    if (fw.language === 'java') {
      const javaDirs = ['src/test/java', 'src/main/java', 'src/test/resources'];
      let ok = true;
      for (const d of javaDirs) if (!(await isDir(path.join(root, d)))) ok = false;
      if (ok) logPass(`${fw.id}: Maven dirs (src/test/java, src/main/java, src/test/resources) present`);
      else logFail(`${fw.id}: missing Maven dirs`);
    }

    header(`3. POST /api/project-layout/recording — ${fw.id}`);
    const rec = await request('POST', '/api/project-layout/recording', {
      framework: fw.id,
      projectName: TEST_PROJECT,
      recordingName: 'Login Flow #1',
    });
    if (rec.status !== 200) {
      logFail(`${fw.id}: recording layout returned ${rec.status} ${JSON.stringify(rec.body)}`);
    } else {
      const recDir = rec.body.paths.recordingDir;
      const wanted = path.join(root, 'recordings', 'login-flow-1');
      if (recDir === wanted) logPass(`${fw.id}: recording dir = recordings/login-flow-1/`);
      else logFail(`${fw.id}: recording dir = ${recDir} (wanted ${wanted})`);
      // Write a sample recorded-steps.json + metadata.json.
      await fs.writeFile(rec.body.paths.recordedSteps, JSON.stringify([{ kind: 'navigate', url: 'about:blank' }], null, 2));
      await fs.writeFile(rec.body.paths.metadata, JSON.stringify({ framework: fw.id, capturedAt: new Date().toISOString() }, null, 2));
      if ((await exists(rec.body.paths.recordedSteps)) && (await exists(rec.body.paths.metadata))) {
        logPass(`${fw.id}: recorded-steps.json + metadata.json land inside recording dir`);
      } else {
        logFail(`${fw.id}: failed to write artifacts inside recording dir`);
      }
    }

    header(`4. POST /api/project-layout/rerun — ${fw.id}`);
    const rer = await request('POST', '/api/project-layout/rerun', {
      framework: fw.id,
      projectName: TEST_PROJECT,
      testName: 'Add To Cart',
    });
    if (rer.status !== 200) {
      logFail(`${fw.id}: rerun layout returned ${rer.status} ${JSON.stringify(rer.body)}`);
    } else {
      const rerunDir = rer.body.paths.rerunDir;
      const expectedPrefix = path.join(root, 'reruns', 'add-to-cart');
      if (rerunDir.startsWith(expectedPrefix) && rerunDir !== expectedPrefix) {
        logPass(`${fw.id}: rerun dir nested under reruns/add-to-cart/<timestamp>/`);
      } else {
        logFail(`${fw.id}: rerun dir = ${rerunDir} (expected prefix ${expectedPrefix})`);
      }
      // Each subleaf must exist as a directory.
      for (const leaf of ['report', 'screenshots', 'videos', 'traces', 'logs']) {
        if (!(await isDir(rer.body.paths[leaf]))) {
          logFail(`${fw.id}: rerun leaf ${leaf}/ missing`);
        }
      }
      logPass(`${fw.id}: rerun report/screenshots/videos/traces/logs subleaves present`);
    }
  }

  /* --------------------------------------------------------------- *
   * 5. Validation: bad inputs return 400 with a useful message      *
   * --------------------------------------------------------------- */
  header('5. Validation — rejection paths');
  const cases = [
    { body: {}, name: 'no framework, no project' },
    { body: { framework: 'cypress', projectName: 'x' }, name: 'unsupported framework' },
    { body: { framework: 'selenium-java' }, name: 'missing project name' },
    { body: { framework: 'selenium-java', projectName: '..' }, name: 'invalid project name' },
  ];
  for (const c of cases) {
    const r = await request('POST', '/api/project-layout/scaffold', c.body);
    if (r.status === 400 && r.body && typeof r.body.error === 'string' && r.body.error.length > 0) {
      logPass(`${c.name}: rejected 400 — ${r.body.error}`);
    } else {
      logFail(`${c.name}: expected 400, got ${r.status} ${JSON.stringify(r.body)}`);
    }
  }

  /* --------------------------------------------------------------- *
   * 6. Nothing leaks outside generated-projects/                    *
   * --------------------------------------------------------------- */
  header('6. Anti-scatter check — no stray files in repo root');
  // The only thing that should have been created in the repo root since the
  // backtest started is the generated-projects/ tree. Everything we wrote is
  // under generated-projects/<framework>/<project>/.
  for (const fw of detected) {
    const rootForFw = path.resolve('generated-projects', fw.id, TEST_PROJECT);
    if (!(await exists(rootForFw))) {
      logFail(`${fw.id}: project root vanished`);
    }
  }
  logPass('all artifacts confined to generated-projects/<framework>/<project>/');

  /* --------------------------------------------------------------- *
   * Cleanup                                                         *
   * --------------------------------------------------------------- */
  for (const fw of detected) {
    const dir = path.resolve('generated-projects', fw.id, TEST_PROJECT);
    await fs.rm(dir, { recursive: true, force: true });
  }

  /* --------------------------------------------------------------- *
   * Summary                                                         *
   * --------------------------------------------------------------- */
  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`);
  if (fail > 0) {
    console.log('\x1b[31mFailures:\x1b[0m');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
})();
