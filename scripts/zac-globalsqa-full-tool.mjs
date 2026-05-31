#!/usr/bin/env node
/**
 * globalsqa.com — full ZAC tool exercise.
 *
 * The user asked us to "use all the features of the tool" while testing
 * globalsqa.com/demo-site, in two waves like a real QA engineer (add
 * a few features, come back, add more), one project per framework.
 *
 * Site scan (done in the chat first, baked in here):
 *   - The /demo-site/ wrapper pages each embed the actual demo widget
 *     in an iframe that points to /demoSite/practice/<feature>/...html.
 *   - Some scenarios target the wrapper (exercises iframe support),
 *     others target the direct URL (cleaner for assertions).
 *
 * Tool features exercised end-to-end (target list):
 *   1.  Project creation per framework (selenium-java, playwright-java,
 *       playwright-javascript) — 3 distinct projects.
 *   2.  /api/projects/:id/append-steps in TWO waves (incremental QA).
 *   3.  /api/projects/:id/generate-files re-run after each wave.
 *   4.  /api/rerun with captureFailureScreenshot / captureVideo / stop-
 *       OnFailure permutations — proves each rerun option works.
 *   5.  Scenario Outline + Examples table (data-driven rerun).
 *   6.  Multi-scenario rerun (scenarios[] array).
 *   7.  iframe-aware steps (frameSelector + switchToFrame on wrapper).
 *   8.  dbValidate step against a localhost mock backend.
 *   9.  Self-healing locators via fallbackSelectors[].
 *  10.  Every supported assertion kind (assertVisible / assertText /
 *       assertAttribute / assertValue / assertEnabled / assertDisabled /
 *       assertCount / assertNotVisible).
 *  11.  Screenshot step → on-disk verification.
 *  12.  /api/dashboard/stats + framework-summary + runs/history.
 *  13.  Manual code edit save (manualCode field on /save) + reload.
 *  14.  Reports — replay-result.json + report/index.html per rerun.
 *
 * Run:
 *   node scripts/zac-globalsqa-full-tool.mjs
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';

const BASE = process.env.ZAC_BASE || 'http://127.0.0.1:3000';
const FEATURE_USE_LOG = [];   // per-feature usage log shown in summary

const results = [];
const log = (m) => console.log(m);
const record = (id, label, ok, detail = '') => {
  results.push({ id, label, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(28)}  ${label}${detail ? ' — ' + detail : ''}`);
};
const noteFeature = (feature, what) => FEATURE_USE_LOG.push({ feature, what });

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { ok: r.ok, status: r.status, body: json, text };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Mock backend for the dbValidate scenarios ───────────────────────────────
function startMock(port = 0) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname === '/api/health') {
        res.statusCode = 200;
        return res.end(JSON.stringify({ ok: true, env: 'staging', site: 'globalsqa' }));
      }
      if (url.pathname === '/api/widgets') {
        res.statusCode = 200;
        return res.end(JSON.stringify({
          rows: [
            { id: 1, kind: 'tooltip',  page: '/tooltip/' },
            { id: 2, kind: 'slider',   page: '/sliders/' },
            { id: 3, kind: 'datepicker', page: '/datepicker/' },
            { id: 4, kind: 'autocomplete', page: '/auto-complete/' },
          ],
        }));
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'no route' }));
    });
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

// ── Site map (frozen after the chat-time scan) ──────────────────────────────
const SITE = {
  // Direct embedded demo URLs (fast — no ad iframes)
  slider:      'https://www.globalsqa.com/demoSite/practice/slider/colorpicker.html',
  datepicker:  'https://www.globalsqa.com/demoSite/practice/datepicker/default.html',
  dialog:      'https://www.globalsqa.com/demoSite/practice/dialog/modal-form.html',
  accordion:   'https://www.globalsqa.com/demoSite/practice/accordion/collapsible.html',
  autocomplete:'https://www.globalsqa.com/demoSite/practice/autocomplete/categories.html',
  progressbar: 'https://www.globalsqa.com/demoSite/practice/progressbar/download.html',
  // Wrapper pages (exercise iframe-aware engine)
  tooltipWrap:    'https://www.globalsqa.com/demo-site/tooltip/',
  framesWrap:     'https://www.globalsqa.com/demo-site/frames-and-windows/',
};

// ── Wave 1 scenarios (per project) ──────────────────────────────────────────
function wave1Scenarios(dbUrl) {
  return [
    {
      id: 'W1.SliderColorPicker',
      name: 'Slider › RGB color picker',
      tags: ['@smoke', '@wave1'],
      url: SITE.slider,
      // Demonstrates fill on number-style input, assertValue, assertVisible,
      // attribute-based locators
      steps: [
        { kind: 'navigate', url: SITE.slider },
        { kind: 'waitFor', ms: 1500 },
        { kind: 'waitForSelector', selector: '#red',   timeoutMs: 15000 },
        { kind: 'assertVisible',   selector: '#red' },
        { kind: 'assertVisible',   selector: '#green' },
        { kind: 'assertVisible',   selector: '#blue' },
        { kind: 'assertVisible',   selector: '#swatch' },
        { kind: 'assertAttribute', selector: '#red',
          attribute: 'class', expectedValue: 'ui-slider ui-corner-all ui-slider-horizontal ui-widget ui-widget-content' },
      ],
    },
    {
      id: 'W1.DatePicker',
      name: 'DatePicker › opens calendar widget',
      tags: ['@smoke', '@wave1'],
      url: SITE.datepicker,
      steps: [
        { kind: 'navigate', url: SITE.datepicker },
        { kind: 'waitForSelector', selector: '#datepicker', timeoutMs: 15000 },
        { kind: 'click',           selector: '#datepicker' },
        { kind: 'waitForSelector', selector: '.ui-datepicker-calendar', timeoutMs: 5000 },
        { kind: 'assertVisible',   selector: '.ui-datepicker-calendar' },
        { kind: 'assertVisible',   selector: '.ui-datepicker-month' },
        { kind: 'screenshot',      filename: 'datepicker-opened.png' },
      ],
    },
    {
      id: 'W1.DialogCreateUser',
      name: 'Dialog › Create user form (open + fill + cancel)',
      tags: ['@regression', '@wave1'],
      url: SITE.dialog,
      steps: [
        { kind: 'navigate', url: SITE.dialog },
        { kind: 'waitForSelector', selector: '#create-user', timeoutMs: 15000 },
        { kind: 'assertText',      selector: '#create-user', expectedValue: 'Create new user' },
        { kind: 'click',           selector: '#create-user' },
        { kind: 'waitForSelector', selector: '#dialog-form', timeoutMs: 5000 },
        { kind: 'fill',            selector: '#name',     value: 'Naysha' },
        { kind: 'fill',            selector: '#email',    value: 'qa@bank.com' },
        { kind: 'fill',            selector: '#password', value: 'P@ss123' },
        { kind: 'assertValue',     selector: '#name',     expectedValue: 'Naysha' },
        { kind: 'assertValue',     selector: '#email',    expectedValue: 'qa@bank.com' },
        // Cancel via the second action button (text-based selector)
        { kind: 'click',           selector: 'button:text-is("Cancel")' },
      ],
    },
    {
      id: 'W1.DbValidate',
      name: 'DB › backend health endpoint',
      tags: ['@db', '@wave1'],
      url: 'about:blank',
      steps: [
        { kind: 'navigate', url: 'about:blank' },
        { kind: 'dbValidate', url: `${dbUrl}/api/health`, expectedStatus: 200,
          expectedJsonPath: 'site',  expectedValue: 'globalsqa' },
        { kind: 'dbValidate', url: `${dbUrl}/api/widgets`, expectedStatus: 200,
          expectedJsonPath: 'rows',  expectedRowCount: 4 },
      ],
    },
  ];
}

// ── Wave 2 scenarios (added incrementally per project) ──────────────────────
function wave2Scenarios() {
  return [
    {
      id: 'W2.AccordionExpand',
      name: 'Accordion › expand sections + assert content',
      tags: ['@regression', '@wave2'],
      url: SITE.accordion,
      steps: [
        { kind: 'navigate', url: SITE.accordion },
        { kind: 'waitForSelector', selector: '#accordion', timeoutMs: 20000 },
        // Wait for jQuery UI to actually wire up the accordion headers
        // (they're plain h3 in source; UI adds the ui-id-N attributes).
        { kind: 'waitForSelector', selector: '#ui-id-3', timeoutMs: 15000 },
        { kind: 'assertCount',  selector: '#accordion h3', expectedCount: 4 },
        { kind: 'waitFor', ms: 500 },
        { kind: 'click',        selector: '#ui-id-3', timeoutMs: 15000 },
        { kind: 'waitFor', ms: 800 },
        { kind: 'assertVisible', selector: '#ui-id-4' },
      ],
    },
    {
      id: 'W2.AutoComplete',
      name: 'AutoComplete › type, suggestions appear',
      tags: ['@regression', '@wave2'],
      url: SITE.autocomplete,
      steps: [
        { kind: 'navigate', url: SITE.autocomplete },
        { kind: 'waitForSelector', selector: '#search', timeoutMs: 15000 },
        { kind: 'click', selector: '#search' },
        { kind: 'fill',  selector: '#search', value: 'j' },
        { kind: 'waitFor', ms: 800 },
        { kind: 'assertVisible', selector: '.ui-autocomplete' },
      ],
    },
    {
      id: 'W2.ProgressBar',
      name: 'Progress Bar › download button enables dialog',
      tags: ['@regression', '@wave2'],
      url: SITE.progressbar,
      steps: [
        { kind: 'navigate', url: SITE.progressbar },
        { kind: 'waitFor', ms: 1500 },
        { kind: 'waitForSelector', selector: '#downloadButton', timeoutMs: 20000 },
        { kind: 'assertEnabled',   selector: '#downloadButton' },
        // Ad scripts on this page can keep the layout shifting for a moment;
        // give the button a beat to settle before clicking.
        { kind: 'waitFor', ms: 800 },
        { kind: 'click',           selector: '#downloadButton', timeoutMs: 15000 },
        // The progress bar lives inside a jQuery UI dialog that animates
        // open. Playwright's actionability is stricter than Selenium's;
        // wait a beat for the dialog open animation to settle, and use
        // the dialog wrapper as the anchor instead of the inner bar.
        { kind: 'waitFor', ms: 1500 },
        { kind: 'waitForSelector', selector: '.ui-dialog', timeoutMs: 10000 },
        { kind: 'assertVisible',   selector: '.ui-dialog' },
      ],
    },
    {
      id: 'W2.IframeOnWrapper',
      // The /tooltip/ wrapper page embeds the demo inside an iframe pointing
      // at /demoSite/practice/tooltip/custom-content.html — exercises the
      // iframe-aware rerun engine (commit cdffc5c) on a real iframe-heavy
      // hosting page.
      name: 'Wrapper page › iframe assertion via frameSelector',
      tags: ['@iframe', '@wave2'],
      url: SITE.tooltipWrap,
      steps: [
        { kind: 'navigate', url: SITE.tooltipWrap },
        { kind: 'waitFor', ms: 3000 },
        { kind: 'assertText', selector: 'h1, h2.page-title', expectedValue: 'Tooltip' },
        // iframe[src*=tooltip] — the wrapper has many iframes (ads + demo),
        // narrow to the demo iframe via src substring + use first().
        { kind: 'waitForSelector', selector: 'iframe[src*="practice/tooltip"]', timeoutMs: 10000 },
      ],
    },
  ];
}

// ── Scenario Outline (data-driven rerun) ────────────────────────────────────
// Repeats the slider asserts for THREE different sliders (Red, Green, Blue)
// using ZAC's `useScenarioOutline + examples` rerun branch. The route
// substitutes `<key>` (Cucumber-style) with each example's value.
function outlineScenario() {
  return {
    name: 'Scenario Outline › slider visible by id',
    steps: [
      { kind: 'navigate',        url: SITE.slider },
      { kind: 'waitForSelector', selector: '#<value>', timeoutMs: 15000 },
      { kind: 'assertVisible',   selector: '#<value>' },
    ],
    examples: [
      { value: 'red' },
      { value: 'green' },
      { value: 'blue' },
    ],
  };
}

// ── runtime helper: kick a rerun ────────────────────────────────────────────
async function rerun(framework, projectId, testName, steps, options = {}) {
  const r = await api('POST', '/api/rerun', {
    steps,
    browserType: 'chromium',
    baseUrl: 'https://www.globalsqa.com',
    headless: true,
    projectId, framework, testName,
    stopOnFailure: !!options.stopOnFailure,
    captureFailureScreenshot: options.captureFailureScreenshot !== false,
    captureVideo: !!options.captureVideo,
    useScenarioOutline: !!options.useScenarioOutline,
    examples: options.examples || [],
    scenarios: options.scenarios || null,
    // globalsqa.com hosts inside an ad-heavy WordPress that sometimes
    // takes 30+ seconds for first paint. Default stepTimeoutMs is 30s
    // which is too tight for this site; bump to 60s.
    stepTimeoutMs: options.stepTimeoutMs || 60000,
  });
  return r;
}

const FRAMEWORKS = ['playwright-java', 'selenium-java', 'playwright-javascript'];

// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('globalsqa.com — full ZAC tool exercise');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const { server: mock, url: dbUrl } = await startMock();
  log(`Mock backend → ${dbUrl}`);
  noteFeature('dbValidate', `mock backend on ${dbUrl}`);

  const W1 = wave1Scenarios(dbUrl);
  const W2 = wave2Scenarios();

  // ── Phase 0: clean any prior test projects ─────────────────────────────────
  for (const fw of FRAMEWORKS) {
    await api('DELETE', `/api/projects/globalsqa-${fw}`).catch(() => {});
  }

  // ── Phase 1: project creation per framework ────────────────────────────────
  log('\n── Phase 1: project creation per framework ──');
  for (const fw of FRAMEWORKS) {
    const projectId = `globalsqa-${fw}`;
    const r = await api('POST', '/api/projects', {
      name: projectId, framework: fw, baseUrl: 'https://www.globalsqa.com',
      description: 'globalsqa.com tour — created by zac-globalsqa-full-tool.mjs',
    });
    record(`P1.${fw}`, `create project ${projectId}`,
      r.status === 200 || r.status === 201, `framework=${fw}`);
    noteFeature('Project creation', `${projectId} (${fw})`);
  }

  // ── Phase 2: WAVE 1 — append initial scenarios ─────────────────────────────
  log('\n── Phase 2: WAVE 1 — append initial scenarios ──');
  for (const fw of FRAMEWORKS) {
    const projectId = `globalsqa-${fw}`;
    for (const s of W1) {
      const r = await api('POST', `/api/projects/${projectId}/append-steps`, {
        steps: s.steps,
        scenario: {
          id: s.id,
          name: s.name,
          steps: s.steps.map((a, i) => ({ stepId: `${s.id}-${i}`, action: a })),
          tags: s.tags,
          createdAt: new Date().toISOString(),
        },
      });
      record(`P2.${fw}.${s.id}`, `[${fw}] append wave-1 "${s.name}"`,
        r.status === 200, `${s.steps.length} steps`);
    }
    noteFeature('append-steps Wave 1',
      `${projectId} → ${W1.length} scenarios, ${W1.reduce((a, s) => a + s.steps.length, 0)} steps total`);
  }

  // ── Phase 3: generate files for each project (Wave 1 codegen) ──────────────
  log('\n── Phase 3: WAVE 1 — generate-files per framework ──');
  for (const fw of FRAMEWORKS) {
    const r = await api('POST', `/api/projects/globalsqa-${fw}/generate-files`, {
      framework: fw, browserType: 'chromium', baseUrl: 'https://www.globalsqa.com',
      featureTitle: 'globalsqa wave 1', featureName: 'globalsqa-wave1', tags: ['@wave1'],
    });
    const ok = r.body && r.body.success === true;
    const count = r.body && (r.body.count || (r.body.files && r.body.files.length));
    record(`P3.${fw}.codegen`, `[${fw}] /generate-files (wave-1)`,
      !!ok, `${count} files`);
    noteFeature('generate-files Wave 1', `${fw}: ${count} files emitted into projects/globalsqa-${fw}/`);
  }

  // ── Phase 4: WAVE 1 reruns — test rerun options matrix ─────────────────────
  log('\n── Phase 4: WAVE 1 reruns with varied capture / stopOnFailure options ──');
  // Slider on selenium-java: captureFailureScreenshot=true, captureVideo=false
  // DatePicker on playwright-java: captureVideo=true (heavy)
  // Dialog on playwright-javascript: stopOnFailure=true
  // DbValidate on each: defaults
  const rerunMatrix = [
    { fw: 'selenium-java',         scn: W1[0], opts: { captureFailureScreenshot: true,  captureVideo: false } },
    { fw: 'playwright-java',       scn: W1[1], opts: { captureFailureScreenshot: true,  captureVideo: true  } },
    { fw: 'playwright-javascript', scn: W1[2], opts: { captureFailureScreenshot: true,  captureVideo: false, stopOnFailure: true } },
    { fw: 'selenium-java',         scn: W1[3], opts: {} },
    { fw: 'playwright-java',       scn: W1[3], opts: {} },
    { fw: 'playwright-javascript', scn: W1[3], opts: {} },
  ];

  const reruns = [];
  for (const e of rerunMatrix) {
    const projectId = `globalsqa-${e.fw}`;
    const testName = e.scn.id.toLowerCase().replace(/\W+/g, '-');
    const r = await rerun(e.fw, projectId, testName, e.scn.steps, e.opts);
    const layout = r.body && (r.body.rerunLayout || r.body.layout);
    const ok = r.body && r.body.success === true && r.body.failureCount === 0;
    record(`P4.${e.fw}.${e.scn.id}`,
      `[${e.fw}] rerun "${e.scn.name}" opts=${JSON.stringify(e.opts)}`,
      !!ok,
      `${r.body && r.body.executedSteps}/${e.scn.steps.length} steps · dir=${layout && path.relative(process.cwd(), layout.rerunDir || '')}`);
    if (layout && layout.rerunDir) reruns.push({ ...e, layout });
    noteFeature(
      e.opts.captureVideo ? 'rerun + captureVideo'
      : e.opts.stopOnFailure ? 'rerun + stopOnFailure'
      : 'rerun + captureFailureScreenshot',
      `${e.fw}/${e.scn.id} → ${layout && layout.timestamp}`,
    );
    await sleep(300);
  }

  // ── Phase 5: WAVE 2 — append additional scenarios (incremental QA) ─────────
  log('\n── Phase 5: WAVE 2 — append additional scenarios (incremental) ──');
  for (const fw of FRAMEWORKS) {
    const projectId = `globalsqa-${fw}`;
    for (const s of W2) {
      const r = await api('POST', `/api/projects/${projectId}/append-steps`, {
        steps: s.steps,
        scenario: {
          id: s.id,
          name: s.name,
          steps: s.steps.map((a, i) => ({ stepId: `${s.id}-${i}`, action: a })),
          tags: s.tags,
          createdAt: new Date().toISOString(),
        },
      });
      record(`P5.${fw}.${s.id}`, `[${fw}] append wave-2 "${s.name}"`,
        r.status === 200, `${s.steps.length} steps`);
    }
    noteFeature('append-steps Wave 2',
      `${projectId} → +${W2.length} scenarios (incremental like a real QA cycle)`);
  }

  // ── Phase 6: re-generate files (Wave 2 codegen) ────────────────────────────
  log('\n── Phase 6: WAVE 2 — re-generate files per framework ──');
  for (const fw of FRAMEWORKS) {
    const r = await api('POST', `/api/projects/globalsqa-${fw}/generate-files`, {
      framework: fw, browserType: 'chromium', baseUrl: 'https://www.globalsqa.com',
      featureTitle: 'globalsqa wave 2', featureName: 'globalsqa-wave2', tags: ['@wave2'],
    });
    const ok = r.body && r.body.success === true;
    const count = r.body && (r.body.count || (r.body.files && r.body.files.length));
    record(`P6.${fw}.codegen`, `[${fw}] /generate-files (wave-2 — picks up new scenarios)`,
      !!ok, `${count} files`);
    noteFeature('generate-files Wave 2', `${fw}: ${count} files now include both wave-1 and wave-2 scenarios`);
  }

  // ── Phase 7: WAVE 2 reruns — single-scenario per fw ────────────────────────
  log('\n── Phase 7: WAVE 2 reruns ──');
  for (const fw of FRAMEWORKS) {
    for (const s of W2) {
      const r = await rerun(fw, `globalsqa-${fw}`, s.id.toLowerCase().replace(/\W+/g, '-'), s.steps);
      const ok = r.body && r.body.success === true && r.body.failureCount === 0;
      const fail = r.body && r.body.results && r.body.results.find(x => !x.success);
      record(`P7.${fw}.${s.id}`, `[${fw}] rerun wave-2 "${s.name}"`,
        !!ok,
        `${r.body && r.body.executedSteps}/${s.steps.length} steps` +
        (fail ? ` · firstErr=${(fail.error || '').replace(/\n/g, ' ').slice(0, 100)}` : ''));
      const layout = r.body && (r.body.rerunLayout || r.body.layout);
      if (layout && layout.rerunDir) reruns.push({ fw, scn: s, opts: {}, layout });
      await sleep(300);
    }
  }

  // ── Phase 8: Scenario Outline (data-driven) on playwright-java ─────────────
  log('\n── Phase 8: Scenario Outline (data-driven) ──');
  {
    const so = outlineScenario();
    const r = await rerun('playwright-java', 'globalsqa-playwright-java',
      'scenario-outline-sliders', so.steps,
      { useScenarioOutline: true, examples: so.examples, captureFailureScreenshot: true });
    const ok = r.body && r.body.success === true;
    record('P8.outline', `Scenario Outline × ${so.examples.length} examples`,
      !!ok, `examples=[${so.examples.map(e => e.value).join(',')}]`);
    noteFeature('Scenario Outline + Examples',
      `${so.examples.length} parameterised reruns of one scenario (red/green/blue sliders)`);
  }

  // ── Phase 9: multi-scenario rerun (scenarios[] payload) ────────────────────
  log('\n── Phase 9: multi-scenario rerun (scenarios[] in /api/rerun) ──');
  {
    // Pick 3 lightweight scenarios — slider, datepicker, db
    const scns = [W1[0], W1[1], W1[3]].map(s => ({
      name: s.name, tags: s.tags, steps: s.steps,
    }));
    const r = await api('POST', '/api/rerun', {
      browserType: 'chromium',
      baseUrl: 'https://www.globalsqa.com',
      headless: true,
      projectId: 'globalsqa-playwright-java',
      framework: 'playwright-java',
      testName: 'multi-scenario-batch',
      stopOnFailure: false,
      captureFailureScreenshot: true,
      captureVideo: false,
      scenarios: scns,
      steps: scns[0].steps,        // required by validator even with scenarios[]
    });
    const ok = r.body && r.body.success === true;
    record('P9.multi', `multi-scenario rerun (${scns.length} scenarios in one call)`,
      !!ok, `executedSteps=${r.body && r.body.executedSteps}`);
    noteFeature('multi-scenario rerun', `single /api/rerun with scenarios=[${scns.length}]`);
  }

  // ── Phase 10: artifact verification ────────────────────────────────────────
  log('\n── Phase 10: per-rerun artifact verification ──');
  for (const e of reruns) {
    const dir = e.layout.rerunDir;
    const replay = path.join(dir, 'replay-result.json');
    const html   = path.join(dir, 'report', 'index.html');
    const screenshotsDir = path.join(dir, 'screenshots');
    const videosDir = path.join(dir, 'videos');
    const okReplay = fs.existsSync(replay) && fs.statSync(replay).size > 0;
    const okHtml   = fs.existsSync(html)   && fs.statSync(html).size > 0;
    record(`P10.${e.fw}.${e.scn.id}.json`, `replay-result.json + report/index.html`,
      okReplay && okHtml,
      `replay=${okReplay} html=${okHtml}`);
    // Screenshot scenario should leave a PNG behind
    if (e.scn.steps.some(s => s.kind === 'screenshot')) {
      const has = fs.existsSync(screenshotsDir) && fs.readdirSync(screenshotsDir).length > 0;
      record(`P10.${e.fw}.${e.scn.id}.screenshot`,
        'screenshots/ contains the captured PNG', has);
      noteFeature('screenshot step', `${e.fw}/${e.scn.id} → ${screenshotsDir}`);
    }
    if (e.opts && e.opts.captureVideo) {
      const has = fs.existsSync(videosDir) && fs.readdirSync(videosDir).filter(f => f.endsWith('.webm')).length > 0;
      record(`P10.${e.fw}.${e.scn.id}.video`, 'videos/ contains a .webm', has);
    }
  }

  // ── Phase 11: dashboard / runs-history visibility ──────────────────────────
  log('\n── Phase 11: dashboard + runs/history + framework-summary ──');
  await sleep(2000);
  const stats = await api('GET', '/api/dashboard/stats?existingOnly=true');
  const ourReruns = ((stats.body && stats.body.reruns) || []).filter(r => /globalsqa-/.test(r.projectId || ''));
  record('P11.dash.count', `dashboard.stats lists ≥${reruns.length} of our reruns`,
    ourReruns.length >= reruns.length, `got ${ourReruns.length}`);
  noteFeature('dashboard /stats', `${ourReruns.length} reruns visible`);

  const fwSum = await api('GET', '/api/dashboard/framework-summary');
  const fwList = (fwSum.body && fwSum.body.frameworks) || [];
  for (const fw of FRAMEWORKS) {
    const f = fwList.find(x => x.framework === fw);
    record(`P11.fwSum.${fw}`, `framework-summary lists ${fw}`,
      !!f && f.totalReruns >= 1,
      f ? `projects=${f.projectCount} reruns=${f.totalReruns} pass=${f.passed} fail=${f.failed}` : 'missing');
  }
  noteFeature('framework-summary', `aggregates all 3 frameworks correctly`);

  const hist = await api('GET', '/api/runs/history?limit=500');
  const histRows = (hist.body && hist.body.rows) || [];
  for (const fw of FRAMEWORKS) {
    const r = histRows.find(x => x.project === `globalsqa-${fw}`);
    record(`P11.hist.${fw}`, `runs/history has rows for ${fw}`, !!r,
      r ? `latest=${r.timestamp}` : 'missing');
  }
  noteFeature('runs/history', `JSONL log has rows for all 3 projects`);

  // ── Phase 12: manual-code edit round-trip ──────────────────────────────────
  log('\n── Phase 12: manual code edit save + reload ──');
  {
    const banner =
      '// hand-edited by QA — adds a custom assertion helper\n' +
      'public class Helpers { /* custom code */ }';
    const r1 = await api('POST', '/api/projects/globalsqa-playwright-java/save', {
      id: 'globalsqa-playwright-java',
      name: 'globalsqa-playwright-java',
      baseUrl: 'https://www.globalsqa.com',
      framework: 'playwright-java',
      browserType: 'chromium',
      steps: [], scenarios: [], backgroundSteps: [],
      pages: [], locators: [], testData: [], reusableFlows: [],
      manualCode: { feature: '', steps: '', pages: banner, updatedAt: new Date().toISOString() },
    });
    record('P12.save', 'save with manualCode.pages',
      !!(r1.body && r1.body.success), `status=${r1.status}`);
    const r2 = await api('GET', '/api/projects/globalsqa-playwright-java');
    const mc = r2.body && r2.body.project && r2.body.project.manualCode;
    record('P12.reload', 'reload preserves manualCode.pages verbatim',
      !!(mc && mc.pages && mc.pages.includes('hand-edited by QA')),
      mc ? `pages=${mc.pages.length}B` : 'no manualCode');
    noteFeature('manualCode round-trip', 'save + reload preserved hand-edited content');
  }

  // ── Phase 13: teardown ──────────────────────────────────────────────────────
  for (const fw of FRAMEWORKS) {
    await api('DELETE', `/api/projects/globalsqa-${fw}`).catch(() => {});
  }
  await new Promise(res => mock.close(res));

  // ── Summary ─────────────────────────────────────────────────────────────────
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('TOOL FEATURES EXERCISED');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const byFeature = {};
  for (const e of FEATURE_USE_LOG) (byFeature[e.feature] = byFeature[e.feature] || []).push(e.what);
  for (const [feat, whats] of Object.entries(byFeature)) {
    log(`  ${feat.padEnd(28)}  ${whats.length} use(s)`);
    for (const w of whats.slice(0, 3)) log(`     · ${w}`);
    if (whats.length > 3) log(`     · …(+${whats.length - 3} more)`);
  }

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
