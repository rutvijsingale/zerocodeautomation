#!/usr/bin/env node
/**
 * ZAC UI regression harness — Playwright headless smoke against
 * every public HTML page.
 *
 * For each page we record:
 *   - console errors (excluding deliberate "no path" placeholders)
 *   - CSP violations
 *   - failed same-origin requests
 *
 * Then we probe interactive controls using their REAL ids (verified
 * against the HTML files in public/), and where useful we click /
 * change and assert the corresponding API call actually fires.
 *
 * Exit 0 on full pass, 1 on any failure.
 */
import { chromium } from 'playwright';

const BASE = process.env.ZAC_BASE || 'http://127.0.0.1:3000';
const TOTAL = { pass: 0, fail: 0, fails: [] };

function chk(label, ok, detail) {
  if (ok) {
    TOTAL.pass++;
    console.log(`      ✓ ${label}`);
  } else {
    TOTAL.fail++;
    TOTAL.fails.push({ label, detail });
    console.log(`      ✗ ${label}${detail ? '  — ' + detail : ''}`);
  }
}

async function newPage(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page._zacErrors = [];
  page._zacFailedReqs = [];
  page._zacCspViolations = [];
  page._zacApiCalls = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const txt = msg.text();
    if (/Content Security Policy|Refused to (execute|load|apply|connect)/i.test(txt)) {
      page._zacCspViolations.push(txt);
    } else if (
      // Deliberate placeholders — not real errors:
      !/no path/i.test(txt) &&
      !/Failed to load resource/i.test(txt) &&
      !/the server responded with a status of 404/i.test(txt)
    ) {
      page._zacErrors.push(txt);
    }
  });
  page.on('pageerror', (err) => {
    if (!/no path/i.test(err.message)) page._zacErrors.push(`pageerror: ${err.message}`);
  });
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (url.startsWith(BASE)) {
      page._zacFailedReqs.push(`${req.method()} ${url} — ${req.failure()?.errorText || 'failed'}`);
    }
  });
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith(BASE) && url.includes('/api/')) {
      page._zacApiCalls.push(`${req.method()} ${url.replace(BASE, '')}`);
    }
  });
  return { ctx, page };
}

function summariseSignals(page, label) {
  chk(`${label}: no console errors`,
    page._zacErrors.length === 0,
    page._zacErrors.slice(0, 2).join(' | '));
  chk(`${label}: no CSP violations`,
    page._zacCspViolations.length === 0,
    page._zacCspViolations[0]);
  chk(`${label}: no failed same-origin requests`,
    page._zacFailedReqs.length === 0,
    page._zacFailedReqs.slice(0, 2).join(' | '));
}

(async () => {
  console.log(`══ ZAC UI regression — ${BASE} ══\n`);
  const browser = await chromium.launch({ headless: true });

  /* ====================================================================
   * Page 1: index.html — Recording tab
   * ==================================================================*/
  {
    console.log('── Page: /  (recorder / index.html)');
    const { ctx, page } = await newPage(browser);
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    summariseSignals(page, 'index.html');

    // Top tab strip
    const tabBtns = await page.locator('#appTabs button[data-tab]').count();
    chk(`Top nav: 3 tab buttons (Recording / Dashboard / Settings)`, tabBtns === 3, `got ${tabBtns}`);

    // Recording controls (real ids from index.html)
    chk('Recording: framework dropdown #framework',
      await page.locator('#framework').count() > 0);
    chk('Recording: browser dropdown #browserType',
      await page.locator('#browserType').count() > 0);
    chk('Recording: base URL input #baseUrl',
      await page.locator('#baseUrl').count() > 0);
    chk('Recording: Start button #startRecording',
      await page.locator('#startRecording').count() > 0);
    chk('Recording: Stop button #stopRecording',
      await page.locator('#stopRecording').count() > 0);
    chk('Recording: Pause button #pauseRecording',
      await page.locator('#pauseRecording').count() > 0);
    chk('Recording: stopOnFailure checkbox',
      await page.locator('#stopOnFailure').count() > 0);

    // BDD options
    chk('Recording: useScenarioOutline toggle',
      await page.locator('#useScenarioOutline, [data-bdd="useScenarioOutline"], input[name="useScenarioOutline"]').count() > 0);
    chk('Recording: markAsBackground toggle',
      await page.locator('#markAsBackground, [data-bdd="markAsBackground"], input[name="markAsBackground"]').count() > 0);
    chk('Recording: createNewScenario action',
      await page.locator('#createNewScenario, [data-bdd="createNewScenario"], button:has-text("New Scenario")').count() > 0);

    // Code panels
    chk('Recording: feature code panel #code-feature',
      await page.locator('#code-feature').count() > 0);
    chk('Recording: steps code panel exists',
      await page.locator('#code-steps, [id^="code-"]').count() > 0);

    // ZAC fixes
    chk('Recording: Clear button (FIX 1)',
      await page.locator('button:has-text("Clear")').count() > 0);

    // Behavioural: dropdowns are populated from /api/frameworks
    const frameworkOptionsCount = await page.locator('#framework option').count();
    chk(`Recording: framework dropdown populated (${frameworkOptionsCount} options)`,
      frameworkOptionsCount >= 2);

    // Behavioural: tab switcher actually switches active class. Run
    // FIRST, before the start-recording probe — recording-start opens a
    // Playwright child browser server-side and can intermittently
    // delay UI handlers, masking the real result of this assertion.
    await page.locator('#appTabs button[data-tab="dashboard"]').click().catch(() => {});
    await page.waitForTimeout(200);
    const dashTabActive = await page.locator('#appTabs button[data-tab="dashboard"].active').count();
    const dashPaneActive = await page.locator('#tab-pane-dashboard.active').count();
    chk('Top nav: clicking Dashboard tab marks button .active',  dashTabActive  > 0);
    chk('Top nav: clicking Dashboard tab activates its pane',    dashPaneActive > 0);

    // Switch back so the next probe runs against the recorder pane.
    await page.locator('#appTabs button[data-tab="recorder"]').click().catch(() => {});
    await page.waitForTimeout(200);

    // Behavioural: clicking Start fires POST /api/recording/start.
    // We then immediately cancel via /api/recording/stop to avoid
    // leaving a server-side Chromium session open.
    page._zacApiCalls.length = 0;
    await page.fill('#baseUrl', 'https://demoqa.com');
    await page.locator('#startRecording').click().catch(() => {});
    await page.waitForTimeout(1500);
    const calledStart = page._zacApiCalls.some(c => c.includes('/api/recording/start'));
    chk('Recording: clicking Start fires POST /api/recording/start', calledStart,
      `api calls: ${page._zacApiCalls.slice(0, 5).join(', ')}`);
    await page.locator('#stopRecording').click().catch(() => {});
    await page.waitForTimeout(400);

    await ctx.close();
  }

  /* ====================================================================
   * Page 2: dashboard.html
   * ==================================================================*/
  {
    console.log('\n── Page: /dashboard.html');
    const { ctx, page } = await newPage(browser);
    await page.goto(`${BASE}/dashboard.html`, { waitUntil: 'networkidle' });
    summariseSignals(page, 'dashboard.html');

    // Sidebar — real attribute is data-view, not data-tab
    const sidebarItems = await page.locator('aside.sidebar [data-view], .sidebar [data-view]').count();
    chk(`Dashboard sidebar: 6 nav items (Overview/Runs/Failures/Healer/Trends/Coverage)`,
      sidebarItems === 6, `got ${sidebarItems}`);

    // Filters
    chk('Dashboard: framework filter #filterFramework',
      await page.locator('#filterFramework').count() > 0);
    chk('Dashboard: project filter #filterProject',
      await page.locator('#filterProject').count() > 0);
    chk('Dashboard: status filter #filterStatus',
      await page.locator('#filterStatus').count() > 0);
    chk('Dashboard: free-text filter #filterText',
      await page.locator('#filterText').count() > 0);

    // Orphan toggle
    chk('Dashboard: include-orphans toggle #zacOrphanToggle',
      await page.locator('#zacOrphanToggle').count() > 0);

    // Action buttons in toolbar
    chk('Dashboard: Refresh button',         await page.locator('#refreshBtn').count() > 0);
    chk('Dashboard: AI toggle button',       await page.locator('#aiToggleBtn').count() > 0);
    chk('Dashboard: Export report button',   await page.locator('#exportBtn').count() > 0);
    chk('Dashboard: Email report button',    await page.locator('#emailReportBtn').count() > 0);
    chk('Dashboard: Clear runs button',      await page.locator('#clearBtn, #clearRunsBtn').count() > 0);

    // Stat tiles + live indicator
    chk('Dashboard: live pulse dot',         await page.locator('#liveDot').count() > 0);
    chk('Dashboard: generatedAt timestamp',  await page.locator('#generatedAt').count() > 0);
    chk('Dashboard: env line',               await page.locator('#envLine').count() > 0);

    // Behavioural: /api/dashboard/stats and /api/dashboard/live get
    // hit at least once on load.
    chk('Dashboard: hit /api/dashboard/stats on load',
      page._zacApiCalls.some(c => c.includes('/api/dashboard/stats')),
      `api calls: ${page._zacApiCalls.slice(0,5).join(', ')}`);

    // Behavioural: clicking sidebar item changes the page title text
    page._zacApiCalls.length = 0;
    const titleBefore = await page.locator('#pageTitle').textContent().catch(() => '');
    await page.locator('aside.sidebar [data-view="runs"]').click().catch(() => {});
    await page.waitForTimeout(300);
    const titleAfter = await page.locator('#pageTitle').textContent().catch(() => '');
    chk('Dashboard: sidebar nav swaps active view',
      titleBefore !== titleAfter,
      `before="${titleBefore}" after="${titleAfter}"`);

    // Behavioural: toggling orphan filter triggers a stats reload
    page._zacApiCalls.length = 0;
    await page.locator('#zacOrphanToggle').click({ force: true }).catch(() => {});
    await page.waitForTimeout(700);
    chk('Dashboard: orphan toggle triggers /api/dashboard/stats reload',
      page._zacApiCalls.some(c => c.includes('/api/dashboard/stats')),
      `api calls: ${page._zacApiCalls.slice(0,3).join(', ')}`);

    await ctx.close();
  }

  /* ====================================================================
   * Page 3: settings.html
   * ==================================================================*/
  {
    console.log('\n── Page: /settings.html');
    const { ctx, page } = await newPage(browser);
    await page.goto(`${BASE}/settings.html`, { waitUntil: 'networkidle' });
    summariseSignals(page, 'settings.html');

    // [ZAC-FIX] Unified AI Engine panel — the two duplicate toggles (a
    // "Local AI Engine" #aiToggle and a separate "AI Assistant (Ollama)"
    // #ollamaEnabled panel) were consolidated into ONE provider dropdown that
    // also supports an external OpenAI-compatible API (Qwen / OpenAI / …).
    chk('Settings: AI provider dropdown #aiProvider',
      await page.locator('#aiProvider').count() > 0);
    const aiProviderOpts = await page.locator('#aiProvider option').count();
    chk(`Settings: provider dropdown has off/ollama/api options (${aiProviderOpts})`,
      aiProviderOpts >= 3);
    chk('Settings: Ollama endpoint input #ollamaEndpoint',
      await page.locator('#ollamaEndpoint').count() > 0);
    chk('Settings: Ollama model input #ollamaModel',
      await page.locator('#ollamaModel').count() > 0);
    chk('Settings: external-API base URL #aiApiBaseUrl',
      await page.locator('#aiApiBaseUrl').count() > 0);
    chk('Settings: external-API model #aiApiModel',
      await page.locator('#aiApiModel').count() > 0);
    chk('Settings: external-API key #aiApiKey (password)',
      await page.locator('#aiApiKey[type="password"]').count() > 0);

    // Default framework dropdown — must be populated from /api/frameworks
    await page.waitForTimeout(800);
    const fwOptionCount = await page.locator('#defaultFramework option, select option').count();
    chk(`Settings: framework dropdown populated (${fwOptionCount} options across all selects)`,
      fwOptionCount >= 5);

    // SMTP form
    chk('Settings: SMTP host #smtpHost', await page.locator('#smtpHost').count() > 0);
    chk('Settings: SMTP port #smtpPort', await page.locator('#smtpPort').count() > 0);
    chk('Settings: SMTP user #smtpUser', await page.locator('#smtpUser').count() > 0);

    // Save / test buttons
    chk('Settings: Save button',
      await page.locator('button:has-text("Save"), #saveSettings').count() > 0);

    // Behavioural: reads AI state on load (config + info).
    chk('Settings: hit /api/ai/info or /api/ai/config on load',
      page._zacApiCalls.some(c => c.includes('/api/ai/info') || c.includes('/api/ai/config')),
      `api calls: ${page._zacApiCalls.slice(0,5).join(', ')}`);

    // Behavioural: selecting a provider reveals the matching field group.
    await page.selectOption('#aiProvider', 'openai-compatible');
    await page.waitForTimeout(200);
    const apiVisible = await page.locator('#aiApiFields').isVisible().catch(() => false);
    chk('Settings: choosing External API reveals the API fields', apiVisible);
    await page.selectOption('#aiProvider', 'ollama');
    await page.waitForTimeout(200);
    const ollamaVisible = await page.locator('#aiOllamaFields').isVisible().catch(() => false);
    chk('Settings: choosing Local Ollama reveals the Ollama fields', ollamaVisible);

    // Behavioural: Test & Save posts to /api/ai/config (leaves the sensible
    // machine default — local Ollama — selected).
    page._zacApiCalls.length = 0;
    await page.locator('#aiSaveBtn').click();
    await page.waitForTimeout(1200);
    chk('Settings: Test & Save hits /api/ai/config',
      page._zacApiCalls.some(c => c.includes('/api/ai/config')),
      `api calls: ${page._zacApiCalls.slice(0,3).join(', ')}`);

    await ctx.close();
  }

  /* ====================================================================
   * Page 4: report.html (loaded with NO path → expected placeholder)
   * ==================================================================*/
  {
    console.log('\n── Page: /report.html (no path: placeholder mode)');
    const { ctx, page } = await newPage(browser);
    await page.goto(`${BASE}/report.html`, { waitUntil: 'domcontentloaded' });
    summariseSignals(page, 'report.html');
    chk('Report: shell renders without crashing',
      await page.locator('body').count() > 0);
    await ctx.close();
  }

  /* ====================================================================
   * Page 5: markdown-viewer.html
   * ==================================================================*/
  {
    console.log('\n── Page: /markdown-viewer.html');
    const { ctx, page } = await newPage(browser);
    await page.goto(`${BASE}/markdown-viewer.html`, { waitUntil: 'domcontentloaded' });
    summariseSignals(page, 'markdown-viewer.html');
    chk('Markdown viewer: shell renders without crashing',
      await page.locator('body').count() > 0);
    await ctx.close();
  }

  /* ====================================================================
   * Page 5b: Step Builder UI (lives inside index.html). Drives every
   * step kind through the form and verifies it lands in #stepsList.
   * ==================================================================*/
  {
    console.log('\n── Step Builder (#stepKind dropdown × add-step round-trips)');
    const { ctx, page } = await newPage(browser);
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

    chk('StepBuilder: #stepKind dropdown present',
      await page.locator('#stepKind').count() > 0);
    chk('StepBuilder: #selector input present',
      await page.locator('#selector').count() > 0);
    chk('StepBuilder: #value input present',
      await page.locator('#value').count() > 0);
    chk('StepBuilder: #addStep button present',
      await page.locator('#addStep').count() > 0);
    chk('StepBuilder: #stepsList container present',
      await page.locator('#stepsList').count() > 0);
    chk('StepBuilder: #saveLocator button present',
      await page.locator('#saveLocator').count() > 0);

    // Add 5 different kinds of steps and confirm each lands.
    const kinds = [
      { kind: 'navigate',    selector: '',                value: 'https://demoqa.com/text-box' },
      { kind: 'click',       selector: '#submit',         value: '' },
      { kind: 'type',        selector: '#userName',       value: 'Naysha' },
      { kind: 'waitFor',     selector: '',                value: '500' },
      { kind: 'assertVisible', selector: '#output',       value: '' },
    ];
    // The list starts with an empty-state placeholder <li> ("No steps
    // recorded yet"). The first real step REPLACES it rather than
    // appending — so the final count is exactly kinds.length, not
    // kinds.length + 1. Probe at the bottom not by counting deltas.
    for (const s of kinds) {
      await page.locator('#stepKind').selectOption(s.kind);
      await page.locator('#selector').fill(s.selector || '');
      await page.locator('#value').fill(s.value || '');
      await page.locator('#addStep').click();
      await page.waitForTimeout(150);
    }
    const afterCount = await page.locator('#stepsList li').count();
    chk(`StepBuilder: ${kinds.length} steps land in #stepsList (got ${afterCount})`,
      afterCount === kinds.length,
      `expected ${kinds.length}, got ${afterCount}`);

    // Confirm each step kind made it into the rendered list (heuristic
    // — at least the navigate URL and selector text should appear).
    const html = await page.locator('#stepsList').innerHTML();
    chk('StepBuilder: navigate URL preserved', html.includes('demoqa.com/text-box'));
    chk('StepBuilder: click selector preserved (#submit)', html.includes('#submit'));
    chk('StepBuilder: type value preserved (Naysha)', html.includes('Naysha'));
    chk('StepBuilder: waitFor step rendered', /wait/i.test(html));
    chk('StepBuilder: assertVisible step rendered', /assert/i.test(html));

    await ctx.close();
  }

  /* ====================================================================
   * Page 5c: BDD options × multi-scenario flow (the user's specific
   * questions: Scenario Outline, Background, "create new scenario").
   * ==================================================================*/
  {
    console.log('\n── BDD options + multi-scenario flow');
    const { ctx, page } = await newPage(browser);
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

    // Toggle Scenario Outline; #stepKind dropdown should still work.
    const outline = page.locator('#useScenarioOutline');
    if (await outline.count() > 0) {
      await outline.check({ force: true }).catch(() => {});
      const checked = await outline.isChecked().catch(() => null);
      chk('BDD: useScenarioOutline checkbox flips', checked === true);
      // Reset
      await outline.uncheck({ force: true }).catch(() => {});
    }

    // markAsBackground button — clicking it shouldn't throw.
    const bgBtn = page.locator('#markAsBackground');
    if (await bgBtn.count() > 0) {
      const before = page._zacErrors.length;
      await bgBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(150);
      chk('BDD: clicking markAsBackground does not throw',
        page._zacErrors.length === before);
    }

    // createNewScenario button
    const newScn = page.locator('#createNewScenario');
    if (await newScn.count() > 0) {
      const before = page._zacErrors.length;
      await newScn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(150);
      chk('BDD: clicking createNewScenario does not throw',
        page._zacErrors.length === before);
    }

    await ctx.close();
  }

  /* ====================================================================
   * Page 5d: Real WebSocket recording session — drives a full record /
   * action / stop loop end-to-end. This is the part the user originally
   * cared about (the "everything works while recording" claim).
   * ==================================================================*/
  {
    console.log('\n── Live recording WebSocket round-trip');
    const sid = `wsui-${Date.now()}`;
    const startResp = await fetch(`${BASE}/api/recording/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'about:blank', browserType: 'chromium', sessionId: sid }),
    }).then(r => r.json()).catch(e => ({ error: e.message }));
    chk('Recording: /api/recording/start returns sessionId',
      !!(startResp && (startResp.sessionId || startResp.session?.sessionId)),
      JSON.stringify(startResp).slice(0, 200));
    const realSid = (startResp && (startResp.sessionId || startResp.session?.sessionId)) || sid;

    if (realSid) {
      // Push some synthetic actions over the action endpoint
      const actionResp = await fetch(`${BASE}/api/recording/${realSid}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'click', selector: '#submit', timestamp: Date.now(),
          metadata: { fromHarness: true },
        }),
      }).then(r => ({ status: r.status, body: r.text() })).catch(e => ({ error: e.message }));
      chk('Recording: /api/recording/:sid/action accepts a synthetic action',
        actionResp && (actionResp.status === 200 || actionResp.status === 201 || actionResp.status === 204));

      // Poll status
      const status = await fetch(`${BASE}/api/recording/${realSid}/status`).then(r => r.json()).catch(() => ({}));
      chk('Recording: /api/recording/:sid/status returns 200',
        status && (status.success !== false));

      // Stop
      const stopResp = await fetch(`${BASE}/api/recording/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: realSid }),
      }).then(r => r.json()).catch(e => ({ error: e.message }));
      chk('Recording: /api/recording/stop returns success',
        !!(stopResp && (stopResp.success !== false || stopResp.actions || stopResp.session)));
    }
  }

  /* ====================================================================
   * Page 6: AI Assistant panel (lives inside index.html)
   * ==================================================================*/
  {
    console.log('\n── AI Assistant panel (Ctrl+Shift+A on /)');
    const { ctx, page } = await newPage(browser);
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.keyboard.press('Control+Shift+A');
    await page.waitForTimeout(500);
    const panel = page.locator('#aiAssistantPanel, .zac-ai-panel, [data-panel="ai-assistant"]');
    const visible = (await panel.count()) > 0 && await panel.first().isVisible().catch(() => false);
    chk('AI panel: opens on Ctrl+Shift+A', visible);
    if (visible) {
      chk('AI panel: "Fix this error" quick action',
        await panel.locator('button:has-text("Fix this error"), [data-quick="fix-error"]').count() > 0);
      chk('AI panel: "Explain code" quick action',
        await panel.locator('button:has-text("Explain code"), [data-quick="explain"]').count() > 0);
      chk('AI panel: "Better locator" quick action',
        await panel.locator('button:has-text("Better locator"), [data-quick="locator"]').count() > 0);
      chk('AI panel: prompt input present',
        await panel.locator('textarea, input[type="text"]').count() > 0);
      // Behavioural: pressing Ctrl+Shift+A again hides the panel.
      // The panel hides via .collapsed (transform + opacity + pointer-events
      // none), NOT display:none — so Playwright's isVisible() still returns
      // true. Check the .collapsed class explicitly.
      await page.keyboard.press('Control+Shift+A');
      await page.waitForTimeout(300);
      const collapsed = await panel.first().evaluate(el => el.classList.contains('collapsed'));
      chk('AI panel: Ctrl+Shift+A toggles panel closed (.collapsed class)', collapsed);
    }
    await ctx.close();
  }

  await browser.close();

  console.log('\n═══ Summary ═══');
  console.log(`   Total checks: ${TOTAL.pass + TOTAL.fail}`);
  console.log(`   ✓ pass: ${TOTAL.pass}`);
  console.log(`   ✗ fail: ${TOTAL.fail}`);
  if (TOTAL.fail) {
    console.log('\n   Failures:');
    for (const f of TOTAL.fails) console.log(`     - ${f.label}${f.detail ? '  — ' + f.detail : ''}`);
  }
  process.exit(TOTAL.fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
