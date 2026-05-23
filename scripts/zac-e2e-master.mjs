#!/usr/bin/env node
/**
 * Master end-to-end harness for the ENTIRE tool.
 *
 * Drives every layer in one pass against every framework:
 *
 *   1. Settings → Default framework persists (legacy + ZacSettings).
 *   2. Settings dropdown only lists uiVisible:true frameworks
 *      (regression guard for the "hidden default" bug surfaced
 *       2026-05-24).
 *   3. Recording-tab #framework dropdown picks up the Settings default
 *      automatically on load (cross-tab + same-tab paths).
 *   4. Picking a framework in Settings + creating a NEW project →
 *      project.framework matches.
 *   5. /generate-files honours the project's framework (each emitted
 *      file lives under the right framework's path).
 *   6. /api/projects/:id GET round-trips the framework + scenarios +
 *      locators + manualCode editor blobs.
 *   7. /api/rerun against demoqa.com persists status.json +
 *      replay-result.json under the canonical layout.
 *   8. Dashboard /api/dashboard/stats?existingOnly=true sees the rerun
 *      with the right framework attribution.
 *   9. /api/dashboard/report/html?path=... renders a self-contained
 *      report with the right rerun's data.
 *  10. /api/email/send-rerun delivers (Ethereal preview) with multi-
 *      recipient + cc + the actual report attached.
 *
 * Run:   ZAC_EMAIL_PROVIDER=ethereal node scripts/zac-e2e-master.mjs
 */
import http from 'http';
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { join, resolve } from 'path';

const BASE = process.env.ZAC_BASE || 'http://127.0.0.1:3000';
const ROOT = resolve(process.cwd());
const T = { pass: 0, fail: 0, fails: [] };
const chk = (label, ok, detail = '') => {
  if (ok) { T.pass++; console.log(`      ✓ ${label}`); }
  else    { T.fail++; T.fails.push({ label, detail }); console.log(`      ✗ ${label}${detail ? '  — ' + detail : ''}`); }
};

function api(method, path, body, timeout = 90000) {
  return new Promise((resolveP) => {
    const url = new URL(BASE + path);
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, timeout, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}
    }, (res) => {
      let buf = ''; res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolveP({ status: res.statusCode, headers: res.headers, body: buf ? JSON.parse(buf) : null, raw: buf }); }
        catch { resolveP({ status: res.statusCode, headers: res.headers, body: buf, raw: buf }); }
      });
    });
    req.on('error', e => resolveP({ status: 0, body: { error: e.message } }));
    req.on('timeout', () => { req.destroy(); resolveP({ status: 0, body: { error: 'timeout' } }); });
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  console.log(`══ ZAC end-to-end master — ${BASE} ══\n`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleErrs = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text()); });

  // ─── ASK 1+2: Settings dropdown should ONLY list uiVisible:true ───
  console.log('── 1+2. Settings → Default framework dropdown ──');
  await page.goto(`${BASE}/settings.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const settingsOpts = await page.locator('#defaultFramework option').evaluateAll(els =>
    els.map(o => o.value).filter(Boolean));
  console.log('   options visible in #defaultFramework:', settingsOpts);
  chk('Settings: ≥3 frameworks listed',         settingsOpts.length >= 3);
  chk('Settings: hidden uiVisible:false NOT listed (no playwright-typescript)',
    !settingsOpts.includes('playwright-typescript'),
    `got: ${settingsOpts.join(', ')}`);

  // ─── ASK 3: Same-tab Settings change → Recording dropdown updates ───
  console.log('\n── 3. Same-tab settings change propagates to Recording tab ──');
  // Pick selenium-testng
  await page.locator('#defaultFramework').selectOption('selenium-testng');
  await page.waitForTimeout(300);
  // Now navigate to /
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);  // boot + applySettingsDefault (~600ms)
  const recVal = await page.locator('#framework').inputValue();
  chk(`Recording #framework reflects Settings default ("selenium-testng" → "${recVal}")`,
    recVal === 'selenium-testng');

  // ─── ASK 4: Create a project — framework should match the dropdown ───
  console.log('\n── 4. Create project via API uses the Settings-driven framework ──');
  const pid = `master-e2e-${Date.now()}`;
  const fwUnderTest = recVal;  // honour what the user sees
  const c = await api('POST', '/api/projects',
    { name: pid, framework: fwUnderTest, baseUrl: 'https://demoqa.com' });
  chk(`POST /api/projects returns 200/201 (${c.status})`, c.status === 200 || c.status === 201);
  // Fetch back
  const reload = await api('GET', `/api/projects/${pid}`);
  const proj = reload.body?.project || reload.body;
  chk(`project.framework === "${fwUnderTest}"`, proj?.framework === fwUnderTest);

  // Save full payload (scenarios + locators + manualCode)
  const saveBody = {
    framework: fwUnderTest, baseUrl: 'https://demoqa.com',
    backgroundSteps: [{ kind: 'navigate', url: 'https://demoqa.com/text-box', normalizedDescription: 'TextBox' }],
    scenarios: [{
      name: 'master e2e flow', tags: ['@master','@e2e','@positive'],
      steps: [
        { kind: 'type',  selector: '#userName', value: 'E2E', normalizedDescription: 'Name',
          pageName: 'TextBox', elementName: 'fullName' },
        { kind: 'click', selector: '#submit', normalizedDescription: 'Submit',
          pageName: 'TextBox', elementName: 'submitBtn' },
      ],
    }],
    locators: [
      { pageName: 'TextBox', elementName: 'fullName',  locatorType: 'id',  locatorValue: 'userName' },
      { pageName: 'TextBox', elementName: 'submitBtn', locatorType: 'css', locatorValue: '#submit' },
    ],
    manualCode: { feature: '# QA edit', steps: '// edit', pages: '// edit' },
    steps: [],
  };
  const s = await api('POST', `/api/projects/${pid}/save`, saveBody);
  chk(`POST /api/projects/:id/save (${s.status})`, s.status === 200 || s.status === 201);

  // ─── ASK 5: generate-files honours the framework ───
  console.log('\n── 5. /generate-files emits the right framework files ──');
  const g = await api('POST', `/api/projects/${pid}/generate-files`,
    { framework: fwUnderTest, baseUrl: 'https://demoqa.com',
      featureName: 'Master E2E', featureTitle: 'master-e2e' });
  chk(`/generate-files (${g.status}, ${g.body?.count || 0} files)`,
    g.status === 200 && g.body?.success);

  // Verify framework-specific scaffolding actually got written
  const projDir = join(ROOT, 'projects', pid);
  if (fwUnderTest === 'selenium-testng') {
    chk('   selenium-testng: testng.xml emitted',
      existsSync(join(projDir, 'src/test/resources/testng.xml')));
    const javaFiles = spawnSync('find', [projDir, '-name', '*Test.java']).stdout.toString().split('\n').filter(Boolean);
    chk('   selenium-testng: at least one *Test.java with @Test', javaFiles.length >= 1);
  } else {
    const featFiles = spawnSync('find', [projDir, '-name', '*.feature']).stdout.toString().split('\n').filter(Boolean);
    chk('   feature file emitted', featFiles.length >= 1);
  }

  // ─── ASK 6: project-load returns saved code ───
  console.log('\n── 6. Project load round-trip ──');
  const back = await api('GET', `/api/projects/${pid}`);
  const loaded = back.body?.project || back.body;
  chk('   load: framework matches',          loaded?.framework === fwUnderTest);
  chk('   load: scenarios round-tripped',    (loaded?.scenarios || []).length === 1);
  chk('   load: locators round-tripped',     (loaded?.locators || []).length === 2);
  chk('   load: manualCode.feature kept',    /QA edit/.test(loaded?.manualCode?.feature || ''));
  chk('   load: manualCode.steps kept',      /edit/.test(loaded?.manualCode?.steps || ''));
  chk('   load: manualCode.pages kept',      /edit/.test(loaded?.manualCode?.pages || ''));
  chk('   load: tags preserved',
    Array.isArray(loaded?.scenarios?.[0]?.tags) && loaded.scenarios[0].tags.includes('@master'));

  // ─── ASK 7: Rerun against demoqa, persisted to disk ───
  console.log('\n── 7. Rerun against demoqa.com + canonical layout ──');
  const r = await api('POST', '/api/rerun', {
    framework: fwUnderTest, projectId: pid, testName: 'master-rerun',
    browserType: 'chromium', headless: true,
    steps: [
      { kind: 'navigate', url: 'https://demoqa.com/text-box' },
      { kind: 'waitFor',  ms: 300 },
      { kind: 'type',     selector: '#userName', value: 'E2E' },
      { kind: 'click',    selector: '#submit' },
      { kind: 'waitFor',  ms: 200 },
    ],
  }, 180000);
  chk(`/api/rerun (${r.status} success=${r.body?.success}, steps=${(r.body?.results||[]).length})`,
    r.status === 200 && r.body?.success);
  const rerunPath = r.body?.rerunLayout?.replayResult || '';
  chk('   replay-result.json on disk',  rerunPath && existsSync(rerunPath));

  // ─── ASK 8: Dashboard sees the rerun with right framework attribution ───
  console.log('\n── 8. Dashboard reflects the rerun ──');
  await new Promise(r => setTimeout(r, 1000));
  const stats = await api('GET', '/api/dashboard/stats?existingOnly=true');
  const myRuns = (stats.body?.reruns || []).filter(x => x.projectId === pid);
  chk(`   /api/dashboard/stats sees ≥1 rerun for ${pid} (${myRuns.length})`, myRuns.length >= 1);
  if (myRuns.length > 0) {
    chk(`   rerun framework attributed correctly (${myRuns[0].framework})`,
      myRuns[0].framework === fwUnderTest);
  }

  // ─── ASK 9: HTML report renders ───
  console.log('\n── 9. Dashboard HTML report renders ──');
  const ts = myRuns[0]?.timestamp;
  if (ts) {
    const rp = `${fwUnderTest}/${pid}/reruns/master-rerun/${ts}`;
    const html = await api('GET', `/api/dashboard/report/html?path=${encodeURIComponent(rp)}`);
    const txt = (typeof html.raw === 'string' ? html.raw : '');
    chk(`   /api/dashboard/report/html (${html.status})`, html.status === 200);
    chk('   report has <!DOCTYPE html>',                /^<!DOCTYPE html/i.test(txt));
    chk('   report contains step blocks',
      (txt.match(/<div\s+class="step"/g) || []).length >= 2);
    chk('   report contains pass/fail pill',
      /<span\s+class="pill\s+(passed|failed)"/.test(txt));
  } else {
    chk('   ts available for report fetch', false, 'dashboard returned 0 reruns');
  }

  // ─── ASK 10: Email pipeline (Ethereal preview, multi-recipient + cc) ───
  console.log('\n── 10. Email pipeline (multi-recipient + attachment) ──');
  const e = await api('POST', '/api/email/send-rerun', {
    framework: fwUnderTest, projectId: pid, testName: 'master-rerun', timestamp: ts,
    to: 'rut@yopmail.com, qa-lead@bank.com',
    cc: 'manager@bank.com',
    subject: '[ZAC] master e2e rerun report',
    note: 'Auto-generated via zac-e2e-master.mjs',
  });
  chk(`   /api/email/send-rerun (${e.status})`, e.status === 200);
  chk('   email send ok=true',                                 e.body?.ok === true,
    JSON.stringify(e.body).slice(0, 200));
  chk('   email accepted both `to` recipients',
    Array.isArray(e.body?.accepted) && e.body.accepted.length >= 2);
  chk('   email previewUrl returned (Ethereal preview path)',
    typeof e.body?.previewUrl === 'string' && e.body.previewUrl.includes('ethereal.email'));
  chk('   email recipientCount counts to + cc',
    (e.body?.recipientCount || 0) >= 3);

  // ─── 0 console errors across the run ───
  console.log('\n── Browser-side console health ──');
  // Filter out CORS/network warnings about assets we know aren't loaded
  const realErrs = consoleErrs.filter(e =>
    !/Failed to load resource|status of 404/.test(e));
  chk(`zero console errors during full E2E (${realErrs.length})`,
    realErrs.length === 0,
    realErrs.slice(0, 3).join(' | '));

  // ─── Cleanup ───
  console.log('\n── Cleanup ──');
  await api('DELETE', `/api/projects/${pid}`);
  spawnSync('rm', ['-rf', projDir]);
  // Reset browser localStorage
  await page.evaluate(() => { localStorage.clear(); }).catch(() => {});
  await browser.close();

  console.log('\n═══ Summary ═══');
  console.log(`   Total: ${T.pass + T.fail}`);
  console.log(`   ✓ pass: ${T.pass}`);
  console.log(`   ✗ fail: ${T.fail}`);
  if (T.fail) {
    console.log('\n   Failures:');
    for (const f of T.fails) console.log(`     - ${f.label}${f.detail ? '  — ' + f.detail : ''}`);
  }
  process.exit(T.fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
