#!/usr/bin/env node
/**
 * demoqa.com tab-by-tab visibility + assertion coverage.
 *
 * Drives the live ZAC /api/rerun engine to:
 *   1. Navigate to each demoqa section
 *   2. Wait for an anchor element to be visible
 *   3. Assert visibility + text/attribute on multiple key elements
 *   4. Report pass/fail per section
 *
 * Sections covered (per user request 2026-05-25):
 *   ELEMENTS         — Text Box, Check Box, Radio Button, Web Tables,
 *                      Buttons, Links, Broken Links - Images,
 *                      Dynamic Properties
 *   FORMS            — Practice Form
 *   ALERTS / FRAMES  — Browser Windows, Alerts, Click Button to see
 *                      alert, Nested Frames, Frames, Modal Dialogs
 *   WIDGETS          — Accordian, Auto Complete, Date Picker
 *   INTERACTIONS     — Sortable, Selectable
 *   BOOK STORE       — Login
 *
 * Run:
 *   node scripts/zac-demoqa-tabs-coverage.mjs
 */

import path from 'node:path';
import fs from 'node:fs';

const BASE = process.env.ZAC_BASE || 'http://127.0.0.1:3000';
const PROJECT_ID = 'demoqa-tabs-coverage';
const FRAMEWORK = 'playwright-java';

const results = [];
const log = (m) => console.log(m);
const record = (id, label, ok, detail = '') => {
  results.push({ id, label, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(14)}  ${label}${detail ? ' — ' + detail : ''}`);
};

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { ok: r.ok, status: r.status, body: json, text };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function rerun(testName, steps) {
  const r = await api('POST', '/api/rerun', {
    steps,
    browserType: 'chromium',
    baseUrl: 'https://demoqa.com',
    headless: true,
    projectId: PROJECT_ID,
    framework: FRAMEWORK,
    testName,
    stopOnFailure: false,
    captureFailureScreenshot: true,
    captureVideo: false,
  });
  return r;
}

// Common preamble for every section: navigate + brief wait + handle ad
// banners that demoqa serves. demoqa.com has aggressive ad slots that
// can shift layout; the waitFor here gives them time to settle.
const preamble = (url) => [
  { kind: 'navigate', url },
  { kind: 'waitFor', ms: 2000 },
];

// Each section is a {id, label, url, steps[]} entry. `steps[]` are the
// SECTION-SPECIFIC assertions (preamble is auto-prepended). We wait for
// an anchor selector first to absorb network latency, then assert on
// 2-3 elements using visibility / text / attribute checks.
const SECTIONS = [
  // ── ELEMENTS ───────────────────────────────────────────────────────────
  {
    id: 'E.TextBox', label: 'Elements › Text Box', url: 'https://demoqa.com/text-box',
    steps: [
      { kind: 'waitForSelector', selector: '#userName', timeoutMs: 15000 },
      { kind: 'assertVisible',   selector: '#userName' },
      { kind: 'assertVisible',   selector: '#userEmail' },
      { kind: 'assertVisible',   selector: '#currentAddress' },
      { kind: 'assertVisible',   selector: '#submit' },
      { kind: 'assertAttribute', selector: '#userName',
        attribute: 'placeholder', expectedValue: 'Full Name' },
      { kind: 'assertText',      selector: 'h1.text-center', expectedValue: 'Text Box' },
    ],
  },
  {
    id: 'E.CheckBox', label: 'Elements › Check Box', url: 'https://demoqa.com/checkbox',
    steps: [
      { kind: 'waitForSelector', selector: '.check-box-tree-wrapper', timeoutMs: 15000 },
      { kind: 'assertVisible',   selector: '.check-box-tree-wrapper' },
      { kind: 'assertText',      selector: 'h1.text-center', expectedValue: 'Check Box' },
    ],
  },
  {
    id: 'E.RadioBtn', label: 'Elements › Radio Button', url: 'https://demoqa.com/radio-button',
    steps: [
      { kind: 'waitForSelector', selector: '#yesRadio', timeoutMs: 15000 },
      { kind: 'assertText',      selector: 'h1.text-center', expectedValue: 'Radio Button' },
      { kind: 'assertVisible',   selector: 'label[for="yesRadio"]' },
      { kind: 'assertVisible',   selector: 'label[for="impressiveRadio"]' },
    ],
  },
  {
    id: 'E.WebTables', label: 'Elements › Web Tables', url: 'https://demoqa.com/webtables',
    steps: [
      { kind: 'waitForSelector', selector: '#addNewRecordButton', timeoutMs: 15000 },
      { kind: 'assertText',      selector: 'h1.text-center', expectedValue: 'Web Tables' },
      { kind: 'assertVisible',   selector: '#addNewRecordButton' },
      { kind: 'assertVisible',   selector: '#searchBox' },
    ],
  },
  {
    id: 'E.Buttons', label: 'Elements › Buttons', url: 'https://demoqa.com/buttons',
    steps: [
      { kind: 'waitForSelector', selector: '#doubleClickBtn', timeoutMs: 15000 },
      { kind: 'assertText',      selector: 'h1.text-center', expectedValue: 'Buttons' },
      { kind: 'assertVisible',   selector: '#doubleClickBtn' },
      { kind: 'assertVisible',   selector: '#rightClickBtn' },
    ],
  },
  {
    id: 'E.Links', label: 'Elements › Links', url: 'https://demoqa.com/links',
    steps: [
      { kind: 'waitForSelector', selector: '#simpleLink', timeoutMs: 15000 },
      { kind: 'assertText',      selector: 'h1.text-center', expectedValue: 'Links' },
      { kind: 'assertVisible',   selector: '#simpleLink' },
      { kind: 'assertVisible',   selector: '#dynamicLink' },
      { kind: 'assertVisible',   selector: '#created' },
    ],
  },
  {
    id: 'E.BrokenImg', label: 'Elements › Broken Links - Images', url: 'https://demoqa.com/broken',
    steps: [
      { kind: 'waitForSelector', selector: 'h1.text-center', timeoutMs: 15000 },
      { kind: 'assertText',      selector: 'h1.text-center', expectedValue: 'Broken Links - Images' },
      // The page has a "Valid image" + "Broken image" pair; just verify
      // the <img> tags exist (visibility of broken images is iffy).
      { kind: 'waitForSelector', selector: 'img', timeoutMs: 5000 },
    ],
  },
  {
    id: 'E.DynProps', label: 'Elements › Dynamic Properties', url: 'https://demoqa.com/dynamic-properties',
    steps: [
      { kind: 'waitForSelector', selector: '#enableAfter', timeoutMs: 15000 },
      { kind: 'assertText',      selector: 'h1.text-center', expectedValue: 'Dynamic Properties' },
      { kind: 'assertVisible',   selector: '#enableAfter' },
      { kind: 'assertVisible',   selector: '#colorChange' },
    ],
  },

  // ── FORMS ──────────────────────────────────────────────────────────────
  {
    id: 'F.PracticeForm', label: 'Forms › Practice Form', url: 'https://demoqa.com/automation-practice-form',
    steps: [
      { kind: 'waitForSelector', selector: '#firstName', timeoutMs: 15000 },
      { kind: 'assertText',      selector: 'h1.text-center', expectedValue: 'Practice Form' },
      { kind: 'assertVisible',   selector: '#firstName' },
      { kind: 'assertVisible',   selector: '#lastName' },
      { kind: 'assertVisible',   selector: '#userEmail' },
      { kind: 'assertVisible',   selector: '#userNumber' },
      { kind: 'assertVisible',   selector: '#submit' },
      { kind: 'assertAttribute', selector: '#firstName',
        attribute: 'placeholder', expectedValue: 'First Name' },
    ],
  },

  // ── ALERTS / FRAMES / WINDOWS ──────────────────────────────────────────
  {
    id: 'A.BrowserWin', label: 'Alerts › Browser Windows', url: 'https://demoqa.com/browser-windows',
    steps: [
      { kind: 'waitForSelector', selector: '#tabButton', timeoutMs: 15000 },
      { kind: 'assertText',      selector: 'h1.text-center', expectedValue: 'Browser Windows' },
      { kind: 'assertVisible',   selector: '#tabButton' },
      { kind: 'assertVisible',   selector: '#windowButton' },
      { kind: 'assertVisible',   selector: '#messageWindowButton' },
    ],
  },
  {
    id: 'A.Alerts', label: 'Alerts › Alerts (incl. Click Button to see alert)', url: 'https://demoqa.com/alerts',
    steps: [
      { kind: 'waitForSelector', selector: '#alertButton', timeoutMs: 15000 },
      { kind: 'assertText',      selector: 'h1.text-center', expectedValue: 'Alerts' },
      { kind: 'assertVisible',   selector: '#alertButton' },           // "Click Button to see alert"
      { kind: 'assertVisible',   selector: '#timerAlertButton' },
      { kind: 'assertVisible',   selector: '#confirmButton' },
      { kind: 'assertVisible',   selector: '#promtButton' },           // sic — demoqa typo
    ],
  },
  {
    id: 'A.Frames', label: 'Alerts › Frames (with iframe assertion)', url: 'https://demoqa.com/frames',
    steps: [
      { kind: 'waitForSelector', selector: '#frame1', timeoutMs: 15000 },
      { kind: 'assertText',      selector: 'h1.text-center', expectedValue: 'Frames' },
      { kind: 'assertVisible',   selector: '#frame1' },
      { kind: 'assertVisible',   selector: '#frame2' },
      // iframe-aware assertion (rerun engine cdffc5c)
      { kind: 'assertText',      selector: '#sampleHeading',
        frameSelector: '#frame1', expectedValue: 'This is a sample page' },
    ],
  },
  {
    id: 'A.NestedFrm', label: 'Alerts › Nested Frames', url: 'https://demoqa.com/nestedframes',
    steps: [
      { kind: 'waitForSelector', selector: '#frame1', timeoutMs: 15000 },
      { kind: 'assertText',      selector: 'h1.text-center', expectedValue: 'Nested Frames' },
      { kind: 'assertVisible',   selector: '#frame1' },
    ],
  },
  {
    id: 'A.Modals', label: 'Alerts › Modal Dialogs', url: 'https://demoqa.com/modal-dialogs',
    steps: [
      { kind: 'waitForSelector', selector: '#showSmallModal', timeoutMs: 15000 },
      { kind: 'assertText',      selector: 'h1.text-center', expectedValue: 'Modal Dialogs' },
      { kind: 'assertVisible',   selector: '#showSmallModal' },
      { kind: 'assertVisible',   selector: '#showLargeModal' },
    ],
  },

  // ── WIDGETS ────────────────────────────────────────────────────────────
  {
    // demoqa.com refreshed the Accordian markup in May 2026 — the old
    // #section1Heading IDs are gone; the new structure uses
    // <button class="accordion-button"> with text labels.
    id: 'W.Accordian', label: 'Widgets › Accordian', url: 'https://demoqa.com/accordian',
    steps: [
      { kind: 'waitForSelector', selector: '#accordianContainer', timeoutMs: 15000 },
      { kind: 'assertText',      selector: 'h1.text-center', expectedValue: 'Accordian' },
      { kind: 'assertVisible',   selector: '.accordion-button:has-text("What is Lorem Ipsum?")' },
      { kind: 'assertVisible',   selector: '.accordion-button:has-text("Where does it come from?")' },
      { kind: 'assertVisible',   selector: '.accordion-button:has-text("Why do we use it?")' },
    ],
  },
  {
    id: 'W.AutoCompl', label: 'Widgets › Auto Complete', url: 'https://demoqa.com/auto-complete',
    steps: [
      { kind: 'waitForSelector', selector: '#autoCompleteMultipleInput', timeoutMs: 15000 },
      { kind: 'assertText',      selector: 'h1.text-center', expectedValue: 'Auto Complete' },
      { kind: 'assertVisible',   selector: '#autoCompleteMultipleInput' },
      { kind: 'assertVisible',   selector: '#autoCompleteSingleInput' },
    ],
  },
  {
    id: 'W.DatePicker', label: 'Widgets › Date Picker', url: 'https://demoqa.com/date-picker',
    steps: [
      { kind: 'waitForSelector', selector: '#datePickerMonthYearInput', timeoutMs: 15000 },
      { kind: 'assertText',      selector: 'h1.text-center', expectedValue: 'Date Picker' },
      { kind: 'assertVisible',   selector: '#datePickerMonthYearInput' },
      { kind: 'assertVisible',   selector: '#dateAndTimePickerInput' },
    ],
  },

  // ── INTERACTIONS ───────────────────────────────────────────────────────
  {
    id: 'I.Sortable', label: 'Interactions › Sortable', url: 'https://demoqa.com/sortable',
    steps: [
      { kind: 'waitForSelector', selector: '.vertical-list-container', timeoutMs: 15000 },
      { kind: 'assertText',      selector: 'h1.text-center', expectedValue: 'Sortable' },
      { kind: 'assertVisible',   selector: '.vertical-list-container' },
    ],
  },
  {
    id: 'I.Selectable', label: 'Interactions › Selectable', url: 'https://demoqa.com/selectable',
    steps: [
      { kind: 'waitForSelector', selector: '#verticalListContainer', timeoutMs: 15000 },
      { kind: 'assertText',      selector: 'h1.text-center', expectedValue: 'Selectable' },
      { kind: 'assertVisible',   selector: '#verticalListContainer' },
    ],
  },

  // ── BOOK STORE APPLICATION ─────────────────────────────────────────────
  {
    id: 'B.Login', label: 'Book Store › Login', url: 'https://demoqa.com/login',
    steps: [
      { kind: 'waitForSelector', selector: '#userName', timeoutMs: 15000 },
      { kind: 'assertText',      selector: 'h1.text-center', expectedValue: 'Login' },
      { kind: 'assertVisible',   selector: '#userName' },
      { kind: 'assertVisible',   selector: '#password' },
      { kind: 'assertVisible',   selector: '#login' },
      { kind: 'assertVisible',   selector: '#newUser' },
      { kind: 'assertAttribute', selector: '#userName',
        attribute: 'placeholder', expectedValue: 'UserName' },
    ],
  },
];

(async () => {
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('demoqa.com — tab-by-tab visibility + assertion coverage');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Project setup (shared, lets dashboard collect all 20 reruns under one banner).
  await api('DELETE', `/api/projects/${PROJECT_ID}`).catch(() => {});
  await api('POST', '/api/projects', {
    name: PROJECT_ID, framework: FRAMEWORK, baseUrl: 'https://demoqa.com',
  });

  const reruns = [];
  for (const s of SECTIONS) {
    const testName = s.id.toLowerCase().replace(/\W+/g, '-');
    const steps = [...preamble(s.url), ...s.steps];
    const r = await rerun(testName, steps);
    const layout = r.body && (r.body.rerunLayout || r.body.layout);
    const ok = r.body && r.body.success === true && r.body.failureCount === 0;
    const fail = r.body && r.body.results && r.body.results.find(x => !x.success);
    record(s.id, s.label, !!ok,
      `${r.body && r.body.executedSteps}/${steps.length} steps OK` +
      (fail ? ` · firstErr=${(fail.error || '').replace(/\n/g, ' ').slice(0, 100)}` : ''));
    if (layout && layout.rerunDir) reruns.push({ section: s, layout });
    await sleep(300);  // gentle throttle to avoid concurrent-rerun cap (10)
  }

  // ── Verify on-disk artifacts ─────────────────────────────────────────────
  log('\n── Per-rerun artifact verification ──');
  let artOk = 0;
  for (const e of reruns) {
    const replay = path.join(e.layout.rerunDir, 'replay-result.json');
    const html   = path.join(e.layout.rerunDir, 'report', 'index.html');
    const ok = fs.existsSync(replay) && fs.statSync(replay).size > 0
            && fs.existsSync(html)   && fs.statSync(html).size > 0;
    if (ok) artOk++;
    record(`art.${e.section.id}`, `report artifacts`, ok);
  }

  // ── Dashboard visibility ─────────────────────────────────────────────────
  log('\n── Dashboard visibility ──');
  await sleep(2000);
  const stats = await api('GET', `/api/dashboard/stats?existingOnly=true`);
  const dashReruns = (stats.body && stats.body.reruns) || [];
  const ourReruns = dashReruns.filter(r => r.projectId === PROJECT_ID && r.framework === FRAMEWORK);
  record('dash.count', `≥${SECTIONS.length} reruns visible in dashboard`,
    ourReruns.length >= SECTIONS.length, `got ${ourReruns.length}`);

  // ── Teardown ─────────────────────────────────────────────────────────────
  await api('DELETE', `/api/projects/${PROJECT_ID}`).catch(() => {});

  // ── Summary ──────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(`SUMMARY: ${passed}/${results.length} passed`);
  if (failed.length) {
    log('\nFAILURES:');
    for (const f of failed) log(`  ✗ ${f.id}  ${f.label}  ${f.detail}`);
    process.exit(1);
  }
  log('All scenarios passed.');
})().catch(err => {
  console.error('Harness error:', err);
  process.exit(2);
});
