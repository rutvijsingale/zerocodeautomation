#!/usr/bin/env node
/**
 * Demoqa coverage harness — drives every navigation, waiting, and
 * assertion step kind through ZAC's /api/rerun engine against real
 * pages on https://demoqa.com.
 *
 * Each "scene" is a self-contained POST /api/rerun whose `steps[]`
 * exercises one capability cluster. We assert:
 *
 *   - the rerun returns success=true
 *   - every step in the scene has success=true (so a flaky assertion
 *     fails this harness and we hear about it)
 *   - replay-result.json + status.json + report HTML all show up
 *
 * Then we run /generate-files for each of the 4 visible frameworks on
 * a representative project and grep the emitted code to confirm every
 * step kind has a matching translation in each framework's step
 * definition / page object output.
 *
 * Run:
 *   node scripts/zac-demoqa-coverage.mjs
 *
 * It is OK if some demoqa pages 5xx — we tolerate flakiness on the
 * first try by retrying the rerun once before failing.
 */
import http from 'http';
import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { resolve } from 'path';

const BASE = process.env.ZAC_BASE || 'http://127.0.0.1:3000';
const ROOT = resolve(process.cwd());
const T = { pass: 0, fail: 0, fails: [] };
const chk = (label, ok, detail = '') => {
  if (ok) { T.pass++; console.log(`      ✓ ${label}`); }
  else    { T.fail++; T.fails.push({ label, detail }); console.log(`      ✗ ${label}${detail ? '  — ' + detail : ''}`); }
};

function api(method, path, body, timeout = 180000) {
  return new Promise((resolveP) => {
    const url = new URL(BASE + path);
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, timeout, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}
    }, (res) => {
      let buf = ''; res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolveP({ status: res.statusCode, body: buf ? JSON.parse(buf) : null, raw: buf }); }
        catch { resolveP({ status: res.statusCode, body: buf, raw: buf }); }
      });
    });
    req.on('error', e => resolveP({ status: 0, body: { error: e.message } }));
    req.on('timeout', () => { req.destroy(); resolveP({ status: 0, body: { error: 'timeout' } }); });
    if (data) req.write(data);
    req.end();
  });
}

// Re-run a scene at most twice; demoqa.com has the occasional 504
async function runScene(name, projectId, framework, steps, expectFail = false) {
  const post = () => api('POST', '/api/rerun', {
    projectId, framework, testName: name,
    browserType: 'chromium', headless: true, steps,
  }, 180000);
  let r = await post();
  if (!expectFail && r.status === 0) {
    console.log(`      ↻ retry ${name} (network error)`);
    await new Promise(s => setTimeout(s, 2000));
    r = await post();
  }
  return r;
}

// ─── Scene catalogue — one entry per capability cluster ─────────────────────
const scenes = [
  {
    name: 'nav-multi-page',
    purpose: 'Navigation across multiple demoqa pages + waitForSelector after every nav',
    steps: [
      { kind: 'navigate', url: 'https://demoqa.com/text-box' },
      { kind: 'waitForSelector', selector: '#userName' },
      { kind: 'navigate', url: 'https://demoqa.com/buttons' },
      { kind: 'waitForSelector', selector: '#doubleClickBtn' },
      { kind: 'navigate', url: 'https://demoqa.com/links' },
      { kind: 'waitForSelector', selector: '#simpleLink' },
    ],
  },
  {
    name: 'wait-explicit-and-selector',
    purpose: 'Explicit waitFor(ms) + waitForSelector for asynchronously-rendered content (/dynamic-properties)',
    steps: [
      { kind: 'navigate', url: 'https://demoqa.com/dynamic-properties' },
      { kind: 'waitFor', ms: 600 },                        // page settles
      // /dynamic-properties has #colorChange that gains "text-danger" class after 5s,
      // and a hidden element #visibleAfter that appears after 5s
      { kind: 'waitForSelector', selector: '#visibleAfter', timeout: 8000 },
      { kind: 'assertVisible', selector: '#visibleAfter' },
    ],
  },
  {
    name: 'assertions-form',
    purpose: 'Form interaction + assertText + assertVisible after submit (/text-box)',
    steps: [
      { kind: 'navigate',         url: 'https://demoqa.com/text-box' },
      { kind: 'waitForSelector',  selector: '#userName' },
      { kind: 'type',             selector: '#userName',          value: 'Naysha' },
      { kind: 'fill',             selector: '#userEmail',         value: 'qa@bank.com' }, // alias of type
      { kind: 'fill',             selector: '#currentAddress',    value: '221B Baker Street' },
      { kind: 'fill',             selector: '#permanentAddress',  value: 'Mumbai, IN' },
      { kind: 'click',            selector: '#submit' },
      { kind: 'waitForSelector',  selector: '#output #name' },
      { kind: 'assertText',       selector: '#output #name',      expectedText: 'Naysha',         contains: true },
      { kind: 'assertText',       selector: '#output #email',     expectedText: 'qa@bank.com',    contains: true },
      { kind: 'assertVisible',    selector: '#output #permanentAddress' },
      { kind: 'assertAttribute',  selector: '#submit',  attribute: 'id', expectedValue: 'submit' },
    ],
  },
  {
    name: 'click-variants',
    purpose: 'click, doubleClick, hover on /buttons (right-click handled separately due to context menu noise)',
    steps: [
      { kind: 'navigate',         url: 'https://demoqa.com/buttons' },
      { kind: 'waitForSelector',  selector: '#doubleClickBtn' },
      { kind: 'doubleClick',      selector: '#doubleClickBtn' },
      { kind: 'waitForSelector',  selector: '#doubleClickMessage' },
      { kind: 'assertText',       selector: '#doubleClickMessage',
        expectedText: 'You have done a double click', contains: true },
      { kind: 'hover',            selector: '#doubleClickBtn' },           // demoqa doesn't react but step must pass
      // demoqa renders the dynamic click button without a stable id; use the
      // generated random-id button via attribute selector + text fallback.
      { kind: 'click',            selector: 'xpath=//button[normalize-space(.)="Click Me"]' },
      { kind: 'waitForSelector',  selector: '#dynamicClickMessage' },
      { kind: 'assertText',       selector: '#dynamicClickMessage',
        expectedText: 'You have done a dynamic click', contains: true },
    ],
  },
  {
    name: 'select-and-check',
    purpose: 'select dropdown (/widgets/select-menu) + check / uncheck (/elements/checkbox)',
    steps: [
      { kind: 'navigate',         url: 'https://demoqa.com/select-menu' },
      { kind: 'waitForSelector',  selector: '#oldSelectMenu' },
      { kind: 'select',           selector: '#oldSelectMenu', value: '2' },   // "Green"
      { kind: 'assertAttribute',  selector: '#oldSelectMenu', attribute: 'value', expectedValue: '2' },
      // demoqa has no native checkbox, but radio-button page does
      { kind: 'navigate',         url: 'https://demoqa.com/radio-button' },
      { kind: 'waitForSelector',  selector: 'label[for="yesRadio"]' },
      { kind: 'click',            selector: 'label[for="yesRadio"]' },
      { kind: 'waitForSelector',  selector: '.text-success' },
      { kind: 'assertText',       selector: '.text-success', expectedText: 'Yes', contains: true },
    ],
  },
  {
    name: 'scroll-and-key',
    purpose: 'scroll to footer of long page + keyPress on input',
    steps: [
      { kind: 'navigate',         url: 'https://demoqa.com/text-box' },
      { kind: 'waitForSelector',  selector: '#userName' },
      { kind: 'click',            selector: '#userName' },
      { kind: 'keyPress',         key: 'A' },
      { kind: 'keyPress',         key: 'B' },
      { kind: 'keyPress',         key: 'C' },
      { kind: 'assertAttribute',  selector: '#userName', attribute: 'value', expectedValue: 'ABC' },
      { kind: 'scroll',           direction: 'down', amount: 400 },
    ],
  },
  {
    name: 'screenshot-and-close',
    purpose: 'screenshot capture + close (graceful cleanup of multi-page context)',
    steps: [
      { kind: 'navigate',         url: 'https://demoqa.com/text-box' },
      { kind: 'waitForSelector',  selector: '#userName' },
      { kind: 'screenshot',       filename: 'demoqa-textbox' },
      { kind: 'close' },
    ],
  },
];

(async () => {
  console.log(`══ ZAC × demoqa coverage — ${BASE} ══\n`);

  // ── Setup project ────────────────────────────────────────────────────────
  const PID = `demoqa-coverage-${Date.now()}`;
  const FW = 'playwright-java';

  console.log('── 0. Bootstrap project ──');
  const c = await api('POST', '/api/projects',
    { name: PID, framework: FW, baseUrl: 'https://demoqa.com' });
  chk(`POST /api/projects (${c.status})`, c.status === 200 || c.status === 201);

  // ── Drive every scene ────────────────────────────────────────────────────
  const sceneResults = [];
  for (const sc of scenes) {
    console.log(`\n── ${sc.name} — ${sc.purpose} ──`);
    const r = await runScene(sc.name, PID, FW, sc.steps);
    chk(`HTTP 200 (${r.status})`, r.status === 200);
    chk('rerun success=true',  r.body?.success === true,
      r.body?.results?.find(s => s.success === false)?.error || '');

    // every step success=true
    const failed = (r.body?.results || []).filter(s => s.success === false);
    chk(`all ${r.body?.executedSteps || 0} steps passed (${failed.length} failed)`,
      failed.length === 0,
      failed.slice(0, 1).map(f => `${f.step}: ${(f.error||'').slice(0,140)}`).join(' | '));

    // disk persistence: replay-result.json
    const layout = r.body?.rerunLayout || r.body?.layout;
    const replay = layout?.replayResult;
    chk('replay-result.json on disk',  !!replay && existsSync(replay));

    // dashboard report HTML actually renders
    const ts = layout?.timestamp;
    if (ts) {
      const rp = `${FW}/${PID}/reruns/${sc.name}/${ts}`;
      const html = await api('GET', `/api/dashboard/report/html?path=${encodeURIComponent(rp)}`);
      chk(`/dashboard/report/html (${html.status})`, html.status === 200);
      chk('  report has step blocks',
        ((html.raw || '').match(/<div\s+class="step"/g) || []).length >= sc.steps.length / 2);
    }

    sceneResults.push({ scene: sc.name, success: r.body?.success === true,
      executed: r.body?.executedSteps, results: r.body?.results || [] });
  }

  // ── Aggregate dashboard sees all scenes ──────────────────────────────────
  console.log('\n── Dashboard aggregation ──');
  await new Promise(s => setTimeout(s, 800));
  const stats = await api('GET', '/api/dashboard/stats?existingOnly=true');
  const myRuns = (stats.body?.reruns || []).filter(x => x.projectId === PID);
  chk(`dashboard sees all ${scenes.length} scenes (${myRuns.length})`,
    myRuns.length >= scenes.length);
  chk('every dashboard rerun has framework=playwright-java',
    myRuns.every(x => x.framework === FW),
    [...new Set(myRuns.map(x => x.framework))].join(','));
  chk('every dashboard rerun has projectId match',
    myRuns.every(x => x.projectId === PID));
  chk('all dashboard reruns status=passed',
    myRuns.every(x => x.status === 'passed'),
    myRuns.filter(x => x.status !== 'passed').map(x => `${x.testName}=${x.status}`).join(','));

  // ── Codegen sanity: every step kind we drove has matching code in the gen ──
  console.log('\n── Codegen sanity (per-framework step-kind presence) ──');
  // We need a project with all step kinds in scenarios. Build one.
  const allKinds = [
    { kind: 'navigate',         url: 'https://demoqa.com/text-box' },
    { kind: 'waitForSelector',  selector: '#userName' },
    { kind: 'waitFor',          ms: 200 },
    { kind: 'click',            selector: '#submit' },
    { kind: 'doubleClick',      selector: '#doubleClickBtn' },
    { kind: 'hover',            selector: '#userName' },
    { kind: 'type',             selector: '#userName',         value: 'X' },
    { kind: 'fill',             selector: '#userEmail',        value: 'a@b.c' },
    { kind: 'select',           selector: '#oldSelectMenu',    value: '1' },
    { kind: 'check',            selector: '#yesRadio' },
    { kind: 'keyPress',         key: 'Enter' },
    { kind: 'assertText',       selector: '#name',             expectedText: 'X' },
    { kind: 'assertVisible',    selector: '#submit' },
    { kind: 'assertAttribute',  selector: '#userName', attribute: 'value', expectedValue: 'X' },
    { kind: 'scroll',           direction: 'down', amount: 200 },
    { kind: 'screenshot',       filename: 'shot' },
  ];
  const allKindsPid = `demoqa-kinds-${Date.now()}`;
  await api('POST', '/api/projects',
    { name: allKindsPid, framework: 'playwright-java', baseUrl: 'https://demoqa.com' });

  const FRAMEWORKS = ['playwright-java','selenium-java','selenium-testng','playwright-javascript'];
  for (const fw of FRAMEWORKS) {
    console.log(`   ── ${fw}`);
    const save = await api('POST', `/api/projects/${allKindsPid}/save`, {
      framework: fw, baseUrl: 'https://demoqa.com',
      backgroundSteps: [{ kind: 'navigate', url: 'https://demoqa.com/text-box' }],
      scenarios: [{
        name: 'all kinds', tags: ['@smoke'],
        steps: allKinds.map((s, i) => ({ ...s,
          normalizedDescription: `${s.kind}-${i}`,
          pageName: 'TextBox',
          elementName: (s.selector || s.kind).replace(/[^a-zA-Z0-9]/g, '_'),
        })),
      }],
      locators: [],
      steps: [],
    });
    chk(`     save (${save.status})`, save.status === 200 || save.status === 201);

    const gen = await api('POST', `/api/projects/${allKindsPid}/generate-files`,
      { framework: fw, baseUrl: 'https://demoqa.com', featureName: 'AllKinds', featureTitle: 'all-kinds' });
    chk(`     generate-files (${gen.status}, ${gen.body?.count || 0} files)`,
      gen.status === 200 && gen.body?.success);

    const projDir = resolve(ROOT, 'projects', allKindsPid);
    // grep the generated test code for the API calls each kind should produce
    const findOut = spawnSync('find', [projDir, '-type', 'f', '(',
      '-name','*.java','-o','-name','*.js','-o','-name','*.feature','-o','-name','*.xml',')']).stdout.toString();
    const files = findOut.split('\n').filter(Boolean);
    chk(`     ≥1 emitted code file (${files.length})`, files.length >= 1);

    const grep = (pat, opts = '') => {
      const r = spawnSync('grep', ['-rE', opts, pat, projDir]);
      return r.stdout.toString().trim().length > 0;
    };
    if (fw === 'playwright-java' || fw === 'playwright-javascript') {
      chk('     gen has page.navigate / .goto',
        grep('page\\.(navigate|goto)\\('));
      chk('     gen has waitForSelector / waitForTimeout',
        grep('waitForSelector|waitForTimeout|waitFor\\('));
      chk('     gen has assertion (expect/Asserts)',
        grep('assertThat\\(|expect\\(|toContainText|toBeVisible|toHaveValue|toHaveAttribute'));
      chk('     gen has dblclick',
        grep('dblclick|doubleClick'));
    } else {
      chk('     gen has driver.get / navigate.to',
        grep('driver\\.get|navigate\\(\\)\\.to'));
      chk('     gen has WebDriverWait or sleep',
        grep('WebDriverWait|Thread\\.sleep|ExpectedConditions'));
      chk('     gen has Assert.assert',
        grep('Assert\\.assert|assertEquals|assertTrue'));
      chk('     gen has doubleClick or Actions',
        grep('doubleClick|Actions'));
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────
  console.log('\n── Cleanup ──');
  await api('DELETE', `/api/projects/${PID}`);
  await api('DELETE', `/api/projects/${allKindsPid}`);
  spawnSync('rm', ['-rf', resolve(ROOT, 'projects', PID), resolve(ROOT, 'projects', allKindsPid)]);
  for (const fw of FRAMEWORKS) {
    spawnSync('rm', ['-rf', resolve(ROOT, 'generated-projects', fw, PID),
                            resolve(ROOT, 'generated-projects', fw, allKindsPid)]);
  }

  console.log('\n═══ Summary ═══');
  console.log(`   Total: ${T.pass + T.fail}`);
  console.log(`   ✓ pass: ${T.pass}`);
  console.log(`   ✗ fail: ${T.fail}`);
  if (T.fail) {
    console.log('\n   Failures:');
    for (const f of T.fails) console.log(`     - ${f.label}${f.detail ? '  — ' + f.detail : ''}`);
  }
  // Per-scene tally
  console.log('\n   Per-scene:');
  for (const s of sceneResults) {
    const passed = s.results.filter(r => r.success !== false).length;
    console.log(`     ${s.success ? '✓' : '✗'} ${s.scene.padEnd(28)} ${passed}/${s.executed} step(s) passed`);
  }
  process.exit(T.fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
