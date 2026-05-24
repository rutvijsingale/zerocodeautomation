#!/usr/bin/env node
/**
 * Failure-screenshot capture harness.
 *
 * USER REQUEST
 *   "Failure Screenshot shot be capture by default for all framework"
 *
 * Verifies for EACH of the 4 visible frameworks:
 *
 *   1. The generated Cucumber/TestNG hooks include the right screenshot
 *      capture call on the failure path:
 *         playwright-java       → page.screenshot() + scenario.attach
 *         selenium-java         → TakesScreenshot.getScreenshotAs() + scenario.attach
 *         selenium-testng       → ITestResult.FAILURE + getScreenshotAs(BYTES)
 *                                   + Files.write to target/screenshots/
 *         playwright-javascript → After hook + page.screenshot() + this.attach
 *                                   + fs.writeFileSync to test-results/screenshots/
 *
 *   2. The rerun engine ALREADY captures a screenshot on every failed
 *      step. Drive a real failure (a click on a selector that doesn't
 *      exist) and confirm:
 *         - replay-result.json has results[i].screenshot = "step-N-failed.png"
 *         - <rerunDir>/screenshots/step-N-failed.png exists on disk
 *         - HTTP 200, image/png, > 0 bytes
 *         - report.html renders the inline <img> next to the failed step
 *
 * Run: node scripts/zac-failure-screenshots.mjs
 */
import http from 'http';
import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { resolve } from 'path';
import { chromium } from 'playwright';

const BASE = process.env.ZAC_BASE || 'http://127.0.0.1:3000';
const ROOT = resolve(process.cwd());
const T = { pass: 0, fail: 0, fails: [] };
const chk = (label, ok, detail = '') => {
  if (ok) { T.pass++; console.log(`      ✓ ${label}`); }
  else    { T.fail++; T.fails.push({ label, detail }); console.log(`      ✗ ${label}${detail ? '  — ' + detail : ''}`); }
};

function api(method, path, body) {
  return new Promise((resolveP) => {
    const url = new URL(BASE + path);
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, timeout: 90000,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}
    }, (res) => {
      let buf = ''; res.on('data', c => buf += c);
      res.on('end', () => { try { resolveP({ status: res.statusCode, body: buf ? JSON.parse(buf) : null, raw: buf }); }
                            catch { resolveP({ status: res.statusCode, body: buf, raw: buf }); } });
    });
    req.on('error', e => resolveP({ status: 0, body: { error: e.message } }));
    if (data) req.write(data); req.end();
  });
}

(async () => {
  console.log(`══ Failure-screenshot capture — ${BASE} ══\n`);

  // ─── Part 1: codegen verification per framework ──────────────────────
  console.log('── 1. Generated hooks include failure-screenshot capture (4 frameworks) ──\n');
  const frameworks = [
    {
      id: 'playwright-java',
      filePattern: '*World.java',
      mustContain: [
        'scenario.isFailed()',
        'scenario.attach',
        'page.screenshot()',
      ],
    },
    {
      id: 'selenium-java',
      filePattern: '*World.java',
      mustContain: [
        'scenario.isFailed()',
        'scenario.attach',
        'TakesScreenshot',
        'getScreenshotAs(',
      ],
    },
    {
      id: 'selenium-testng',
      filePattern: '*Test.java',
      mustContain: [
        'ITestResult',
        'getStatus() == org.testng.ITestResult.FAILURE',
        'TakesScreenshot',
        'target', 'screenshots',
      ],
    },
    {
      id: 'playwright-javascript',
      filePattern: 'world.js',     // basename — `find -name` matches basename only
      mustContain: [
        'After(',
        'scenario.result',
        'page.screenshot()',
        'test-results',
        'screenshots',
      ],
    },
  ];

  for (const fw of frameworks) {
    console.log(`   ── ${fw.id}`);
    const PID = `failshot-${fw.id}-${Date.now()}`;
    const cr = await api('POST', '/api/projects',
      { name: PID, framework: fw.id, baseUrl: 'about:blank' });
    chk(`     create project [${cr.status}]`, cr.status === 200 || cr.status === 201);

    const sv = await api('POST', `/api/projects/${PID}/save`, {
      framework: fw.id, baseUrl: 'about:blank',
      backgroundSteps: [{ kind: 'navigate', url: 'about:blank' }],
      scenarios: [{ name: 'smoke', steps: [{ kind: 'click', selector: '#x' }] }],
      locators: [], steps: [],
    });
    chk(`     save [${sv.status}]`, sv.status === 200 || sv.status === 201);

    const gen = await api('POST', `/api/projects/${PID}/generate-files`,
      { framework: fw.id, baseUrl: 'about:blank', featureName: 'Smoke', featureTitle: 'smoke' });
    chk(`     generate-files [${gen.status}, ${gen.body?.count || 0} files]`,
      gen.status === 200 && gen.body?.success);

    // Find the generated hooks file
    const projDir = resolve(ROOT, 'projects', PID);
    const hits = spawnSync('find', [projDir, '-name', fw.filePattern]).stdout.toString()
      .split('\n').filter(Boolean);
    chk(`     ${fw.filePattern} emitted (${hits.length})`, hits.length >= 1);

    if (hits.length >= 1) {
      // Concatenate all matching files (Selenium-TestNG has one Test.java per scenario class)
      const fs = await import('fs/promises');
      let merged = '';
      for (const f of hits) merged += await fs.readFile(f, 'utf8') + '\n';
      for (const needle of fw.mustContain) {
        chk(`     hooks contain "${needle}"`, merged.includes(needle),
          `not found in ${hits.map(h => h.split('/').pop()).join(',')}`);
      }
    }
    // Cleanup
    await api('DELETE', `/api/projects/${PID}`);
  }

  // ─── Part 2: rerun engine captures + persists + serves the failure screenshot ──
  console.log('\n── 2. Rerun engine captures failure screenshot for any failing step ──');

  const PID2 = `failshot-engine-${Date.now()}`;
  await api('POST', '/api/projects',
    { name: PID2, framework: 'playwright-java', baseUrl: 'https://demoqa.com' });

  // Steps that WILL fail: a click on a selector that doesn't exist on demoqa
  const r = await api('POST', '/api/rerun', {
    projectId: PID2, framework: 'playwright-java', testName: 'force-fail',
    browserType: 'chromium', headless: true,
    stopOnFailure: false,
    steps: [
      { kind: 'navigate', url: 'https://demoqa.com/text-box' },
      { kind: 'waitForSelector', selector: '#userName' },
      { kind: 'click', selector: '#this-selector-definitely-does-not-exist-12345' },
    ],
  });
  chk(`/api/rerun completed (${r.status})`, r.status === 200);
  const failedSteps = (r.body?.results || []).filter(s => s.success === false);
  chk(`≥1 step failed (${failedSteps.length})`, failedSteps.length >= 1);
  const withShot = failedSteps.filter(s => s.screenshot);
  chk(`failed step has screenshot field (${withShot.length})`, withShot.length >= 1,
    JSON.stringify(failedSteps[0] || {}, null, 2).slice(0, 300));

  if (withShot.length > 0) {
    const TS = r.body?.rerunLayout?.timestamp;
    const shotName = withShot[0].screenshot;
    const onDiskPath = resolve(ROOT, 'generated-projects/playwright-java',
      PID2, 'reruns/force-fail', TS, 'screenshots', shotName);
    chk(`screenshot file on disk (${shotName})`, existsSync(onDiskPath),
      onDiskPath);

    // HTTP-fetch the screenshot
    const url = `/reports/playwright-java/${PID2}/reruns/force-fail/${TS}/screenshots/${encodeURIComponent(shotName)}`;
    await new Promise((resolveP) => {
      http.get(BASE + url, (res) => {
        let total = 0;
        res.on('data', (c) => total += c.length);
        res.on('end', () => {
          chk(`HTTP ${res.statusCode}, image/png, ${total} bytes`,
            res.statusCode === 200 && /^image\/png/.test(res.headers['content-type'] || '') && total > 1000);
          resolveP();
        });
      });
    });

    // ─── Part 3: report.html shows inline <img> next to the failed step ──
    console.log('\n── 3. report.html renders inline failure screenshot ──');
    const browser = await chromium.launch({ headless: true });
    const page = await (await browser.newContext()).newPage();
    const reportPath = `playwright-java/${PID2}/reruns/force-fail/${TS}`;
    await page.goto(`${BASE}/report.html?path=${encodeURIComponent(reportPath)}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    // Inline <img> on the failure detail block
    const inlineImg = await page.locator('.heal-detail img[alt="failure screenshot"]').count();
    chk(`inline failure-screenshot <img> rendered (${inlineImg})`, inlineImg >= 1);
    if (inlineImg >= 1) {
      const src = await page.locator('.heal-detail img[alt="failure screenshot"]').first().getAttribute('src');
      chk(`<img src> points at the screenshot file`,
        src && src.includes('/screenshots/') && src.includes(shotName),
        `src=${src}`);
    }
    await browser.close();
  }

  // ── Cleanup ─────────────────────────────────────────────────────────
  await api('DELETE', `/api/projects/${PID2}`);

  console.log('\n═══ Summary ═══');
  console.log(`   Total: ${T.pass + T.fail}    ✓ ${T.pass}    ✗ ${T.fail}`);
  if (T.fail) {
    console.log('\n   Failures:');
    for (const f of T.fails) console.log(`     - ${f.label}${f.detail ? '  — ' + f.detail : ''}`);
  }
  process.exit(T.fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
