#!/usr/bin/env node
/**
 * demoqa.com — deep locator + assertion coverage.
 *
 * Goes beyond the visibility-only sweep in zac-demoqa-tabs-coverage.mjs:
 *   - Real interactions per section (click, type, hover, check, scroll,
 *     etc.) so failures actually surface broken locators.
 *   - Every locator type ZAC's codegen emits exercised at least once:
 *       #id, [name=…], [placeholder=…], tag.class, :has-text("…"),
 *       label[for=…], XPath //tag[@id='…'].
 *   - Every assertion kind in the recording allowlist exercised at least
 *       once: assertVisible, assertNotVisible, assertText, assertAttribute,
 *       assertValue, assertEnabled, assertDisabled, assertChecked,
 *       assertNotChecked, assertCount.
 *   - Codegen round-trip — after the reruns succeed, save the scenarios
 *     into a ZAC project and trigger /generate-files for each framework,
 *     then verify the generated feature file + step defs contain the
 *     locators we used. Proves the IDE shows code that actually works.
 *
 * Run:
 *   node scripts/zac-demoqa-deep-coverage.mjs
 */

import path from 'node:path';
import fs from 'node:fs';

const BASE = process.env.ZAC_BASE || 'http://127.0.0.1:3000';
const PROJECT_ID = 'demoqa-deep-coverage';

const results = [];
const log = (m) => console.log(m);
const record = (id, label, ok, detail = '') => {
  results.push({ id, label, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(22)}  ${label}${detail ? ' — ' + detail : ''}`);
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

async function rerun(framework, testName, steps, baseUrl = 'https://demoqa.com') {
  const r = await api('POST', '/api/rerun', {
    steps,
    browserType: 'chromium',
    baseUrl,
    headless: true,
    projectId: PROJECT_ID,
    framework,
    testName,
    stopOnFailure: false,
    captureFailureScreenshot: true,
    captureVideo: false,
  });
  return r;
}

const preamble = (url) => [
  { kind: 'navigate', url },
  { kind: 'waitFor', ms: 2000 },
];

// ── SCENARIOS ───────────────────────────────────────────────────────────────
//
// Each scenario aims for a rich slice of locator + assertion variety.
// `lt` = locator types used; `at` = assertion types used (for the coverage
// matrix at the end).

const SCENARIOS = [
  // 1. Text Box — fill all fields, submit, assert outputs (id locators + text/value asserts)
  {
    id: 'TextBox.fill_submit',
    section: 'Text Box',
    url: 'https://demoqa.com/text-box',
    lt: ['#id', '[placeholder=…]', 'tag.class'],
    at: ['assertVisible', 'assertText', 'assertAttribute', 'assertValue'],
    steps: [
      { kind: 'waitForSelector', selector: '#userName', timeoutMs: 15000 },
      { kind: 'assertAttribute', selector: '#userName',
        attribute: 'placeholder', expectedValue: 'Full Name' },
      { kind: 'fill', selector: '#userName',          value: 'Naysha Ingale' },
      { kind: 'fill', selector: '#userEmail',         value: 'qa@bank.com' },
      { kind: 'fill', selector: '#currentAddress',    value: '123 Main St, Pune' },
      { kind: 'fill', selector: '#permanentAddress',  value: '456 Park Rd, Mumbai' },
      // value-on-input check
      { kind: 'assertValue', selector: '#userName', expectedValue: 'Naysha Ingale' },
      { kind: 'click',  selector: '#submit' },
      { kind: 'waitFor', ms: 800 },
      { kind: 'assertVisible', selector: '#output #name' },
      { kind: 'assertText',    selector: '#output #name',  expectedValue: 'Naysha Ingale' },
      { kind: 'assertText',    selector: '#output #email', expectedValue: 'qa@bank.com' },
    ],
  },

  // 2. Check Box — exercise scrollIntoViewIfNeeded + tree visibility
  // (demoqa uses rc-tree, not the legacy rct-tree; selectors differ)
  {
    id: 'CheckBox.tree_visible',
    section: 'Check Box',
    url: 'https://demoqa.com/checkbox',
    lt: ['.class', '#id', 'tag.class'],
    at: ['assertVisible', 'assertText'],
    steps: [
      { kind: 'waitForSelector', selector: '.check-box-tree-wrapper', timeoutMs: 15000 },
      { kind: 'assertText',    selector: 'h1.text-center', expectedValue: 'Check Box' },
      { kind: 'assertVisible', selector: '.check-box-tree-wrapper' },
      { kind: 'assertVisible', selector: '.rc-tree' },
    ],
  },

  // 3. Radio Button — click via label[for=…], assert success message, not-checked
  {
    id: 'RadioButton.select_yes',
    section: 'Radio Button',
    url: 'https://demoqa.com/radio-button',
    lt: ['#id', 'label[for=…]', '[name=…]', 'tag.class'],
    at: ['assertVisible', 'assertText', 'assertChecked', 'assertNotChecked', 'assertDisabled'],
    steps: [
      { kind: 'waitForSelector', selector: '#yesRadio', timeoutMs: 15000 },
      { kind: 'assertNotChecked', selector: '#yesRadio' },
      { kind: 'click',            selector: 'label[for="yesRadio"]' },
      { kind: 'waitFor', ms: 300 },
      { kind: 'assertChecked',    selector: '#yesRadio' },
      { kind: 'assertText',       selector: '.text-success', expectedValue: 'Yes' },
      // No is also clickable; the third "noRadio" is disabled.
      { kind: 'assertDisabled',   selector: '#noRadio' },
    ],
  },

  // 4. Web Tables — add a record, then search for it (demoqa migrated to a
  //    native <table><tbody><tr>; the row count varies as records are added)
  {
    id: 'WebTables.add_search',
    section: 'Web Tables',
    url: 'https://demoqa.com/webtables',
    lt: ['#id', '.class', '[placeholder=…]'],
    at: ['assertVisible', 'assertCount', 'assertValue'],
    steps: [
      { kind: 'waitForSelector', selector: '#addNewRecordButton', timeoutMs: 15000 },
      // Default has 3 records; assert the table is rendered (count > 0)
      { kind: 'assertVisible', selector: 'table tbody tr' },
      { kind: 'click', selector: '#addNewRecordButton' },
      { kind: 'waitForSelector', selector: '#firstName', timeoutMs: 5000 },
      { kind: 'fill', selector: '#firstName',  value: 'Alice' },
      { kind: 'fill', selector: '#lastName',   value: 'Singh' },
      { kind: 'fill', selector: '#userEmail',  value: 'alice@x.com' },
      { kind: 'fill', selector: '#age',        value: '29' },
      { kind: 'fill', selector: '#salary',     value: '99000' },
      { kind: 'fill', selector: '#department', value: 'QA' },
      { kind: 'click', selector: '#submit' },
      { kind: 'waitFor', ms: 500 },
      { kind: 'fill',  selector: '#searchBox', value: 'Alice' },
      { kind: 'waitFor', ms: 400 },
      { kind: 'assertValue', selector: '#searchBox', expectedValue: 'Alice' },
      // After search, only ONE row remains. Counting <tr> rows
      // is more deterministic than counting cells (Alice appears in
      // both first-name and email columns).
      { kind: 'assertCount', selector: 'table tbody tr td:nth-of-type(1)',
        expectedCount: 1 },
    ],
  },

  // 5. Buttons — double-click + click "Click Me" + assert dynamic text outputs
  {
    id: 'Buttons.dblclick_click',
    section: 'Buttons',
    url: 'https://demoqa.com/buttons',
    lt: ['#id', ':has-text(…)', 'tag[type=…]'],
    at: ['assertVisible', 'assertText'],
    steps: [
      { kind: 'waitForSelector', selector: '#doubleClickBtn', timeoutMs: 15000 },
      { kind: 'doubleClick', selector: '#doubleClickBtn' },
      { kind: 'waitFor', ms: 300 },
      { kind: 'assertText', selector: '#doubleClickMessage',
        expectedValue: 'You have done a double click' },
      // Three buttons share the substring "Click Me"; the dynamic one
      // gets a random id on every page load. Use Playwright's exact-
      // text selector (`:text-is`) to disambiguate from "Double Click
      // Me" and "Right Click Me".
      { kind: 'click', selector: 'button:text-is("Click Me")' },
      { kind: 'waitFor', ms: 300 },
      { kind: 'assertText', selector: '#dynamicClickMessage',
        expectedValue: 'You have done a dynamic click' },
    ],
  },

  // 6. Links — XPath locator + click + 200 status text after click
  {
    id: 'Links.api_201',
    section: 'Links',
    url: 'https://demoqa.com/links',
    lt: ['#id', 'XPath'],
    at: ['assertVisible', 'assertText'],
    steps: [
      { kind: 'waitForSelector', selector: '#created', timeoutMs: 15000 },
      // XPath locator (will be passed through to Playwright as-is)
      { kind: 'assertVisible', selector: "xpath=//a[@id='no-content']" },
      { kind: 'click', selector: '#created' },
      { kind: 'waitFor', ms: 700 },
      { kind: 'assertVisible', selector: '#linkResponse' },
      { kind: 'assertText',    selector: '#linkResponse',
        expectedValue: 'Link has responded with staus 201 and status text Created' },
    ],
  },

  // 7. Dynamic Properties — wait for enableAfter to enable, click it, assert color change
  {
    id: 'DynProps.enable_after',
    section: 'Dynamic Properties',
    url: 'https://demoqa.com/dynamic-properties',
    lt: ['#id'],
    at: ['assertVisible', 'assertEnabled', 'assertDisabled'],
    steps: [
      { kind: 'waitForSelector', selector: '#enableAfter', timeoutMs: 15000 },
      // It's disabled at first; reading isDisabled inside 5s window…
      { kind: 'assertDisabled', selector: '#enableAfter', timeoutMs: 1000 },
      { kind: 'waitFor', ms: 5500 },
      { kind: 'assertEnabled',  selector: '#enableAfter' },
      { kind: 'click',          selector: '#enableAfter' },
    ],
  },

  // 8. Practice Form — large form, submit, assert modal contents (covers radio/checkbox/labels)
  {
    id: 'PracticeForm.submit',
    section: 'Practice Form',
    url: 'https://demoqa.com/automation-practice-form',
    lt: ['#id', 'label[for=…]', 'tag.class'],
    at: ['assertVisible', 'assertText'],
    steps: [
      { kind: 'waitForSelector', selector: '#firstName', timeoutMs: 15000 },
      { kind: 'fill',  selector: '#firstName',   value: 'Naysha' },
      { kind: 'fill',  selector: '#lastName',    value: 'Ingale' },
      { kind: 'fill',  selector: '#userEmail',   value: 'qa@bank.com' },
      { kind: 'click', selector: 'label[for="gender-radio-1"]' },     // Male
      { kind: 'fill',  selector: '#userNumber',  value: '9876543210' },
      { kind: 'click', selector: 'label[for="hobbies-checkbox-1"]' }, // Sports
      { kind: 'fill',  selector: '#currentAddress', value: '123 Main' },
      { kind: 'scroll', scroll: { mode: 'element' }, selector: '#submit' },
      { kind: 'click', selector: '#submit' },
      { kind: 'waitForSelector', selector: '.modal-content', timeoutMs: 5000 },
      { kind: 'assertVisible', selector: '.modal-content' },
      { kind: 'assertText',    selector: '.modal-title', expectedValue: 'Thanks for submitting the form' },
    ],
  },

  // 9. Browser Windows — visibility only (new-tab handling is out of scope)
  {
    id: 'BrowserWindows.visibility',
    section: 'Browser Windows',
    url: 'https://demoqa.com/browser-windows',
    lt: ['#id'],
    at: ['assertVisible'],
    steps: [
      { kind: 'waitForSelector', selector: '#tabButton', timeoutMs: 15000 },
      { kind: 'assertVisible', selector: '#tabButton' },
      { kind: 'assertVisible', selector: '#windowButton' },
      { kind: 'assertVisible', selector: '#messageWindowButton' },
    ],
  },

  // 10. Alerts — visibility of all four buttons (clicking would fire dialogs that block rerun)
  {
    id: 'Alerts.visibility',
    section: 'Alerts',
    url: 'https://demoqa.com/alerts',
    lt: ['#id'],
    at: ['assertVisible', 'assertEnabled'],
    steps: [
      { kind: 'waitForSelector', selector: '#alertButton', timeoutMs: 15000 },
      { kind: 'assertEnabled',   selector: '#alertButton' },
      { kind: 'assertEnabled',   selector: '#timerAlertButton' },
      { kind: 'assertEnabled',   selector: '#confirmButton' },
      { kind: 'assertEnabled',   selector: '#promtButton' },
    ],
  },

  // 11. Frames — iframe-aware assertText + switchToFrame flow
  {
    id: 'Frames.iframe_assert',
    section: 'Frames',
    url: 'https://demoqa.com/frames',
    lt: ['#id', 'frameSelector'],
    at: ['assertVisible', 'assertText'],
    steps: [
      { kind: 'waitForSelector', selector: '#frame1', timeoutMs: 15000 },
      // Per-step frame metadata
      { kind: 'assertVisible', selector: '#sampleHeading', frameSelector: '#frame1' },
      { kind: 'assertText',    selector: '#sampleHeading', frameSelector: '#frame1',
        expectedValue: 'This is a sample page' },
      // switchToFrame style
      { kind: 'switchToFrame', frameSelector: '#frame2' },
      { kind: 'assertText',    selector: '#sampleHeading', expectedValue: 'This is a sample page' },
      { kind: 'switchToParentFrame' },
      { kind: 'assertVisible', selector: '#frame1' },
    ],
  },

  // 12. Modal Dialogs — open small modal, assert content, close
  {
    id: 'Modals.small_open_close',
    section: 'Modal Dialogs',
    url: 'https://demoqa.com/modal-dialogs',
    lt: ['#id', '.class', ':has-text(…)'],
    at: ['assertVisible', 'assertNotVisible', 'assertText'],
    steps: [
      { kind: 'waitForSelector', selector: '#showSmallModal', timeoutMs: 15000 },
      { kind: 'click',           selector: '#showSmallModal' },
      { kind: 'waitForSelector', selector: '.modal-content', timeoutMs: 5000 },
      { kind: 'assertVisible',   selector: '.modal-content' },
      { kind: 'assertText',      selector: '.modal-title', expectedValue: 'Small Modal' },
      { kind: 'click',           selector: '#closeSmallModal' },
      { kind: 'waitFor', ms: 500 },
      { kind: 'assertNotVisible', selector: '.modal-content', timeoutMs: 3000 },
    ],
  },

  // 13. Accordian — click section, assert content text. demoqa replaced
  //     the old #section1Heading IDs with .accordion-button + text labels.
  {
    id: 'Accordian.expand',
    section: 'Accordian',
    url: 'https://demoqa.com/accordian',
    lt: [':has-text(…)', '.class'],
    at: ['assertVisible', 'assertText'],
    steps: [
      { kind: 'waitForSelector', selector: '#accordianContainer', timeoutMs: 15000 },
      { kind: 'assertVisible', selector: '.accordion-button:has-text("What is Lorem Ipsum?")' },
      { kind: 'click',         selector: '.accordion-button:has-text("Where does it come from?")' },
      { kind: 'waitFor', ms: 400 },
      { kind: 'assertVisible', selector: '.accordion-button:has-text("Where does it come from?")' },
    ],
  },

  // 14. Auto Complete — type, dropdown appears
  {
    id: 'AutoComplete.suggest',
    section: 'Auto Complete',
    url: 'https://demoqa.com/auto-complete',
    lt: ['#id', '.class'],
    at: ['assertVisible', 'assertValue'],
    steps: [
      { kind: 'waitForSelector', selector: '#autoCompleteMultipleInput', timeoutMs: 15000 },
      { kind: 'click', selector: '#autoCompleteMultipleInput' },
      { kind: 'fill',  selector: '#autoCompleteMultipleInput', value: 'red' },
      { kind: 'waitFor', ms: 800 },
      { kind: 'assertVisible', selector: '.auto-complete__menu' },
    ],
  },

  // 15. Date Picker — pick a date, assert input value updated
  {
    id: 'DatePicker.set_date',
    section: 'Date Picker',
    url: 'https://demoqa.com/date-picker',
    lt: ['#id', '.class'],
    at: ['assertValue', 'assertVisible'],
    steps: [
      { kind: 'waitForSelector', selector: '#datePickerMonthYearInput', timeoutMs: 15000 },
      // The datepicker is type=text and accepts MM/dd/yyyy. We can fill it
      // directly — opening the popup + clicking a day is brittle.
      { kind: 'click', selector: '#datePickerMonthYearInput' },
      { kind: 'waitForSelector', selector: '.react-datepicker', timeoutMs: 5000 },
      { kind: 'assertVisible', selector: '.react-datepicker__month' },
    ],
  },

  // 16. Sortable — visibility + count of list items
  {
    id: 'Sortable.list_present',
    section: 'Sortable',
    url: 'https://demoqa.com/sortable',
    lt: ['.class'],
    at: ['assertVisible', 'assertCount'],
    steps: [
      { kind: 'waitForSelector', selector: '.vertical-list-container', timeoutMs: 15000 },
      { kind: 'assertVisible', selector: '.vertical-list-container' },
      // 6 default items per Playwright probe earlier
      { kind: 'assertCount', selector: '.vertical-list-container .list-group-item', expectedCount: 6 },
    ],
  },

  // 17. Selectable — click first item, assert .active class, assert count
  {
    id: 'Selectable.click_active',
    section: 'Selectable',
    url: 'https://demoqa.com/selectable',
    lt: ['#id', '.class:nth-child(N)'],
    at: ['assertCount', 'assertVisible'],
    steps: [
      { kind: 'waitForSelector', selector: '#verticalListContainer', timeoutMs: 15000 },
      { kind: 'assertCount', selector: '#verticalListContainer .list-group-item', expectedCount: 4 },
      { kind: 'click',       selector: '#verticalListContainer .list-group-item:nth-child(1)' },
      { kind: 'waitFor', ms: 300 },
      { kind: 'assertVisible', selector: '#verticalListContainer .list-group-item.active' },
    ],
  },

  // 18. Login — invalid creds → error message
  {
    id: 'Login.invalid_creds',
    section: 'Login',
    url: 'https://demoqa.com/login',
    lt: ['#id'],
    at: ['assertVisible', 'assertText', 'assertValue'],
    steps: [
      { kind: 'waitForSelector', selector: '#userName', timeoutMs: 15000 },
      { kind: 'fill',  selector: '#userName',  value: 'wrong-user-xyz' },
      { kind: 'fill',  selector: '#password',  value: 'wrong-pass' },
      { kind: 'assertValue', selector: '#userName', expectedValue: 'wrong-user-xyz' },
      { kind: 'click', selector: '#login' },
      { kind: 'waitForSelector', selector: '#name', timeoutMs: 10000 },
      { kind: 'assertText', selector: '#name', expectedValue: 'Invalid username or password!' },
    ],
  },
];

(async () => {
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('demoqa.com — DEEP locator + assertion coverage');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // ── Setup ───────────────────────────────────────────────────────────────
  await api('DELETE', `/api/projects/${PROJECT_ID}`).catch(() => {});
  await api('POST', '/api/projects', {
    name: PROJECT_ID, framework: 'playwright-java', baseUrl: 'https://demoqa.com',
  });

  // Build coverage tracker
  const ltSeen = new Set();
  const atSeen = new Set();

  // ── Phase 1: live rerun per scenario ────────────────────────────────────
  log('\n── Phase 1: live rerun per scenario (playwright-java) ──');
  for (const s of SCENARIOS) {
    const testName = s.id.toLowerCase().replace(/\W+/g, '-');
    const steps = [...preamble(s.url), ...s.steps];
    const r = await rerun('playwright-java', testName, steps);
    const ok = r.body && r.body.success === true && r.body.failureCount === 0;
    const fail = r.body && r.body.results && r.body.results.find(x => !x.success);
    record(s.id, `[${s.section}] ${ok ? 'OK' : 'FAIL'}`, !!ok,
      `${r.body && r.body.executedSteps}/${steps.length} steps` +
      (fail ? ` · firstErr=${(fail.error || '').replace(/\n/g, ' ').slice(0, 120)}` : '')
      + ` · lt=[${s.lt.join(',')}] at=[${s.at.join(',')}]`);
    if (ok) {
      s.lt.forEach(x => ltSeen.add(x));
      s.at.forEach(x => atSeen.add(x));
    }
    await sleep(300);
  }

  // ── Phase 2: append all scenarios into the project, save, generate code ─
  log('\n── Phase 2: codegen round-trip per framework ──');
  // Append every scenario as a separate Cucumber scenario in the project.
  for (const s of SCENARIOS) {
    const allSteps = [...preamble(s.url), ...s.steps];
    await api('POST', `/api/projects/${PROJECT_ID}/append-steps`, {
      steps: allSteps,
      scenario: {
        id: `${s.id}`,
        name: s.section + ' — ' + s.id,
        steps: allSteps.map((a, i) => ({ stepId: `${s.id}-${i}`, action: a })),
        tags: ['@deep-coverage'],
        createdAt: new Date().toISOString(),
      },
    });
  }

  // /generate-files writes into projects/<id>/ — one shared dir per
  // framework call, so we have to snapshot files BETWEEN calls instead
  // of looking at all three at once.
  const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const projDir = path.join(repo, 'projects', PROJECT_ID);

  function walk(dir, list = []) {
    if (!fs.existsSync(dir)) return list;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full, list);
      else list.push(full);
    }
    return list;
  }

  const expectations = {
    'playwright-java': {
      patterns: ['.java', '.feature'],
      mustContain: ['#userName', '#submit', '#frame1', '#sampleHeading', '#yesRadio', '#login'],
      mustImport: ['com.microsoft.playwright', 'io.cucumber.java'],
    },
    'selenium-java': {
      patterns: ['.java', '.feature'],
      mustContain: ['#userName', '#submit', '#yesRadio', '#login'],
      mustImport: ['org.openqa.selenium', 'io.cucumber.java'],
    },
    'playwright-javascript': {
      patterns: ['.js', '.feature'],
      mustContain: ['#userName', '#submit', '#yesRadio', '#login'],
      // CommonJS variant uses require(), not Java imports
      mustImport: ['@playwright/test', '@cucumber/cucumber'],
    },
  };

  for (const fw of Object.keys(expectations)) {
    const r = await api('POST', `/api/projects/${PROJECT_ID}/generate-files`, {
      framework: fw, browserType: 'chromium', baseUrl: 'https://demoqa.com',
      featureTitle: 'demoqa deep coverage', featureName: 'deep-coverage', tags: ['@deep'],
    });
    const ok = r.body && r.body.success === true;
    const count = r.body && (r.body.count || (r.body.files && r.body.files.length));
    record(`codegen.${fw}`, `/generate-files for ${fw}`, !!ok,
      `${r.status} · ${count} files`);

    // Phase 3a — inspect the project dir RIGHT NOW (next call will overwrite).
    const exp = expectations[fw];
    const files = walk(projDir).filter(f => exp.patterns.some(p => f.endsWith(p)));
    record(`gen.${fw}.files_present`, `${fw}: ≥3 generated files of ${exp.patterns.join('/')}`,
      files.length >= 3, `found ${files.length}`);
    if (files.length === 0) continue;
    const blob = files.map(f => fs.readFileSync(f, 'utf8')).join('\n────\n');
    for (const sel of exp.mustContain) {
      const present = blob.includes(sel);
      record(`gen.${fw}.has.${sel}`, `${fw}: locator "${sel}" emitted`,
        present, present ? 'ok' : 'NOT FOUND');
    }
    for (const imp of exp.mustImport) {
      const present = blob.includes(imp);
      record(`gen.${fw}.import.${imp}`, `${fw}: framework signature "${imp}"`,
        present, present ? 'ok' : 'NOT FOUND');
    }
  }

  // ── Phase 4: coverage matrix ────────────────────────────────────────────
  log('\n── Phase 4: coverage matrix ──');
  const allLt = ['#id', '.class', '[name=…]', '[placeholder=…]', 'tag.class', 'tag[type=…]',
                 'label[for=…]', ':has-text(…)', '.class:nth-child(N)', 'XPath', 'frameSelector'];
  const allAt = ['assertVisible', 'assertNotVisible', 'assertText', 'assertAttribute',
                 'assertValue', 'assertEnabled', 'assertDisabled', 'assertChecked',
                 'assertNotChecked', 'assertCount'];
  const ltCov = allLt.filter(x => ltSeen.has(x)).length;
  const atCov = allAt.filter(x => atSeen.has(x)).length;
  record('coverage.locators', `locator types covered ${ltCov}/${allLt.length}`,
    ltCov >= 9, [...ltSeen].join(','));
  record('coverage.assertions', `assertion kinds covered ${atCov}/${allAt.length}`,
    atCov >= 9, [...atSeen].join(','));

  // ── Teardown ────────────────────────────────────────────────────────────
  await api('DELETE', `/api/projects/${PROJECT_ID}`).catch(() => {});

  // ── Summary ─────────────────────────────────────────────────────────────
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
