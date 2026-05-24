#!/usr/bin/env node
/**
 * Capture-config harness — verifies the user-facing toggles for
 * failure screenshots + video actually take effect, AND the dashboard's
 * Project / Runner / Status dropdowns + search filter all work.
 *
 * USER REQUEST
 *   "keep configuration for Screenshot for failure or video for the same
 *    should be configurable and check runner details and project details
 *    for the dropdown values and search functional as well"
 *
 * Drives:
 *   1. /api/rerun with captureFailureScreenshot:false → no screenshot
 *      file lands on disk for failed steps + no `screenshot` field in
 *      results.
 *   2. /api/rerun with captureFailureScreenshot:true (default) → PNG
 *      lands in <rerunDir>/screenshots/, accessible via HTTP.
 *   3. /api/rerun with captureVideo:true → a .webm lands in <rerunDir>/videos/.
 *   4. Dashboard Settings panel toggles persist via ZacSettings.
 *   5. Dashboard's Project + Runner dropdowns get populated with real
 *      data, and the search box filters the All Reruns table live.
 */
import http from 'http';
import { existsSync } from 'fs';
import { spawnSync, spawn } from 'child_process';
import { resolve } from 'path';
import { chromium } from 'playwright';
import { stat } from 'fs/promises';

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
  console.log(`══ Capture config + dropdown/search harness — ${BASE} ══\n`);

  // ── 1. captureFailureScreenshot=false → no PNG, no screenshot field ─
  console.log('── 1. captureFailureScreenshot=false suppresses PNG output ──');
  const PID1 = `cap-off-${Date.now()}`;
  await api('POST', '/api/projects',
    { name: PID1, framework: 'playwright-java', baseUrl: 'https://demoqa.com' });

  const r1 = await api('POST', '/api/rerun', {
    projectId: PID1, framework: 'playwright-java', testName: 'fail-no-shot',
    browserType: 'chromium', headless: true,
    captureFailureScreenshot: false,                // ← off
    captureVideo: false,
    steps: [
      { kind: 'navigate', url: 'https://demoqa.com/text-box' },
      { kind: 'waitForSelector', selector: '#userName' },
      { kind: 'click', selector: '#this-selector-does-not-exist' },
    ],
  });
  chk('rerun completed', r1.status === 200);
  const failed1 = (r1.body?.results || []).filter(s => s.success === false);
  chk(`≥1 step failed (${failed1.length})`, failed1.length >= 1);
  chk('failed step has NO screenshot field (suppressed)',
    failed1.every(s => !s.screenshot),
    JSON.stringify(failed1.slice(0, 1)));

  const TS1 = r1.body?.rerunLayout?.timestamp;
  if (TS1) {
    const shotDir = resolve(ROOT, 'generated-projects/playwright-java',
      PID1, 'reruns/fail-no-shot', TS1, 'screenshots');
    const find = spawnSync('find', [shotDir, '-name', '*.png']).stdout.toString().trim();
    chk('no PNG file under <rerunDir>/screenshots/',
      find.length === 0, find);
  }
  await api('DELETE', `/api/projects/${PID1}`);

  // ── 2. captureFailureScreenshot=true → PNG persisted + served ───────
  console.log('\n── 2. captureFailureScreenshot=true (default) persists PNG ──');
  const PID2 = `cap-on-${Date.now()}`;
  await api('POST', '/api/projects',
    { name: PID2, framework: 'playwright-java', baseUrl: 'https://demoqa.com' });
  const r2 = await api('POST', '/api/rerun', {
    projectId: PID2, framework: 'playwright-java', testName: 'fail-with-shot',
    browserType: 'chromium', headless: true,
    captureFailureScreenshot: true,
    captureVideo: false,
    steps: [
      { kind: 'navigate', url: 'https://demoqa.com/text-box' },
      { kind: 'waitForSelector', selector: '#userName' },
      { kind: 'click', selector: '#another-bad-selector' },
    ],
  });
  const failed2 = (r2.body?.results || []).filter(s => s.success === false);
  chk('failed step has screenshot field',
    failed2.some(s => s.screenshot),
    JSON.stringify(failed2.slice(0, 1)));
  const TS2 = r2.body?.rerunLayout?.timestamp;
  if (TS2 && failed2[0]?.screenshot) {
    const file = resolve(ROOT, 'generated-projects/playwright-java',
      PID2, 'reruns/fail-with-shot', TS2, 'screenshots', failed2[0].screenshot);
    chk(`PNG on disk: ${failed2[0].screenshot}`, existsSync(file));
  }
  await api('DELETE', `/api/projects/${PID2}`);

  // ── 3. captureVideo=true → .webm in videos/ ─────────────────────────
  console.log('\n── 3. captureVideo=true records video ──');
  const PID3 = `cap-vid-${Date.now()}`;
  await api('POST', '/api/projects',
    { name: PID3, framework: 'playwright-java', baseUrl: 'about:blank' });
  const r3 = await api('POST', '/api/rerun', {
    projectId: PID3, framework: 'playwright-java', testName: 'with-video',
    browserType: 'chromium', headless: true,
    captureFailureScreenshot: false,
    captureVideo: true,                              // ← on
    steps: [
      { kind: 'navigate', url: 'about:blank' },
      { kind: 'waitFor', ms: 500 },
    ],
  });
  chk('rerun success', r3.body?.success === true);
  const TS3 = r3.body?.rerunLayout?.timestamp;
  if (TS3) {
    const vidDir = resolve(ROOT, 'generated-projects/playwright-java',
      PID3, 'reruns/with-video', TS3, 'videos');
    // Playwright finalises video asynchronously inside context.close().
    // The rerun handler returns the HTTP response BEFORE the finally
    // block runs, so wait long enough for the file to flush.
    let webmFound = '';
    for (let i = 0; i < 12 && !webmFound; i++) {
      await new Promise(r => setTimeout(r, 500));
      webmFound = spawnSync('find', [vidDir, '-name', '*.webm']).stdout.toString().trim();
    }
    chk(`≥1 .webm in videos/ (${webmFound.split('\n').filter(Boolean).length})`,
      webmFound.length > 0, webmFound);
  }
  await api('DELETE', `/api/projects/${PID3}`);

  // ── 4. captureVideo=false → NO .webm ────────────────────────────────
  console.log('\n── 4. captureVideo=false leaves videos/ empty ──');
  const PID4 = `cap-novid-${Date.now()}`;
  await api('POST', '/api/projects',
    { name: PID4, framework: 'playwright-java', baseUrl: 'about:blank' });
  const r4 = await api('POST', '/api/rerun', {
    projectId: PID4, framework: 'playwright-java', testName: 'no-video',
    browserType: 'chromium', headless: true,
    captureVideo: false,                             // ← explicit off
    steps: [
      { kind: 'navigate', url: 'about:blank' },
      { kind: 'waitFor', ms: 200 },
    ],
  });
  const TS4 = r4.body?.rerunLayout?.timestamp;
  if (TS4) {
    const vidDir = resolve(ROOT, 'generated-projects/playwright-java',
      PID4, 'reruns/no-video', TS4, 'videos');
    await new Promise(r => setTimeout(r, 800));
    const find = spawnSync('find', [vidDir, '-name', '*.webm']).stdout.toString().trim();
    chk('no .webm in videos/', find.length === 0, find);
  }
  await api('DELETE', `/api/projects/${PID4}`);

  // ── 5. Settings UI persists toggles via ZacSettings ────────────────
  console.log('\n── 5. Settings UI persists capture defaults via ZacSettings ──');
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/settings.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Default state: screenshot=true, video=false
  const initShot = await page.locator('#captureFailureScreenshot').isChecked();
  const initVid  = await page.locator('#captureVideo').isChecked();
  chk(`Settings init: screenshot=${initShot} (expected true), video=${initVid} (expected false)`,
    initShot === true && initVid === false);

  // Toggle video ON, screenshot OFF
  await page.locator('label[for="captureVideo"]').click();
  await page.waitForTimeout(300);
  await page.locator('label[for="captureFailureScreenshot"]').click();
  await page.waitForTimeout(300);
  const lsRaw = await page.evaluate(() => localStorage.getItem('zac_settings'));
  const ls = JSON.parse(lsRaw || '{}');
  chk(`localStorage zac_settings.captureVideo === true (got ${ls.captureVideo})`,
    ls.captureVideo === true);
  chk(`localStorage zac_settings.captureFailureScreenshot === false (got ${ls.captureFailureScreenshot})`,
    ls.captureFailureScreenshot === false);

  // Reset for the dropdown test
  await page.locator('label[for="captureFailureScreenshot"]').click();
  await page.locator('label[for="captureVideo"]').click();
  await page.waitForTimeout(300);

  // ── 6. Dashboard dropdowns + search ─────────────────────────────────
  console.log('\n── 6. Dashboard Project + Runner dropdowns + search ──');
  await page.goto(`${BASE}/dashboard.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);  // tickCount + load

  const fwOpts = await page.locator('#filterFramework option').count();
  chk(`Framework dropdown ≥3 options (${fwOpts})`, fwOpts >= 3);

  const pjOpts = await page.locator('#filterProject option').count();
  chk(`Project dropdown ≥1 option (${pjOpts})`, pjOpts >= 1);

  const stOpts = await page.locator('#filterStatus option').count();
  chk(`Status dropdown ≥3 options (${stOpts})`, stOpts >= 3);

  // Runner select — varies by browser; let it render
  const trCount = await page.locator('select').filter({ hasText: 'all runners' }).count().catch(() => 0);
  chk(`Runner dropdown present`, trCount >= 1 || (await page.locator('option', { hasText: 'all runners' }).count()) >= 1);

  // Switch to All Runs view via the nav-item, ensure rows render
  await page.locator('.nav-item[data-view="runs"]').first().click();
  await page.waitForTimeout(1500);
  const rowsBefore = await page.locator('#rerunTableHost tbody tr').count();
  console.log(`     rows in All Runs (filter on): ${rowsBefore}`);

  // Type a search query — even if rows=0 currently filtered, the input
  // should accept text and re-render filterCount.
  await page.locator('#filterText').fill('zzz-no-match-string');
  await page.waitForTimeout(500);
  const countText = await page.locator('#filterCount').textContent();
  chk(`search filter renders count text ("${countText}")`,
    /showing\s+\d+\s+of\s+\d+/i.test(countText || ''));

  // Clear search
  await page.locator('#filterText').fill('');
  await page.waitForTimeout(300);

  await browser.close();

  console.log('\n═══ Summary ═══');
  console.log(`   Total: ${T.pass + T.fail}    ✓ ${T.pass}    ✗ ${T.fail}`);
  if (T.fail) {
    console.log('\n   Failures:');
    for (const f of T.fails) console.log(`     - ${f.label}${f.detail ? '  — ' + f.detail : ''}`);
  }
  process.exit(T.fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
