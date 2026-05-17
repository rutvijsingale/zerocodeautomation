# ZAC Master Fix — Status & Follow-up Plan

> Tracks the 8-fix master prompt sent on 2026-05-17. Each row is "what landed
> this turn", "what still needs verification on a real browser", and "where
> the code lives". Reach for this doc when scoping the next iteration.

---

## Landed in this turn

| # | Fix                                              | Status      | Files touched                                                                                |
| - | ------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------- |
| 1 | Clear button reset (Recording tab)               | ✅ scaffold  | `public/zacFixes.js` (`installClearButtonFix`), `public/index.html` (script tag)             |
| 2 | Settings persistence + AI mode 2-way sync        | ✅ scaffold  | `public/settingsStore.js` (new), `index.html` / `settings.html` / `dashboard.html`            |
| 3 | Project-management delete flow                   | ⚠️ deferred | See §"Follow-up: FIX 3" below                                                                |
| 4 | Recording engine viewport + action mapping       | ⚠️ deferred | See §"Follow-up: FIX 4" below                                                                |
| 5 | Right-click conflict (Ctrl+Right opens ZAC menu) | ✅ scaffold  | `public/zacFixes.js` (`installRightClickFix`)                                                |
| 6 | Dashboard report filter (framework + runner)     | ✅ scaffold  | `public/zacFixes.js` (`installDashboardFilters`)                                             |
| 7 | demoqa.com full Selenium suite + healer + Allure | ✅ scaffold  | Entire `projects/demoqa/src/main/**` and `projects/demoqa/src/test/**` (see RUN_INSTRUCTIONS.md) |
| 8 | Ollama / Mistral AI assistant panel              | ✅ scaffold  | `public/aiAssistant.js` (new), settings.html "AI Assistant" section, `zacFixes.js` wiring     |

Every fix is wrapped in a try/catch and prints a `[ZAC-FIX] ...` console marker
(per the prompt's ground rule #5). If any single fix is broken, the others still
boot.

---

## Verification status

These can only be confirmed against a running ZAC server with a real browser
session. Recommended verification path is per-fix using the prompt's checklist
language. None of them was executed end-to-end because Java/Maven were not
available in this turn's environment.

| Fix | What to verify                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------- |
| 1   | Fill all 8 fields, generate code, click 🗑️ Clear → all fields blank, both code panels blank, project list intact, "Cleared" toast for 2s. |
| 2   | Toggle AI in Dashboard → Settings reflects within 100ms; reverse direction; refresh page; defaultFramework persists into Recording dropdown. |
| 5   | demoqa.com/right-click: plain right-click → native context menu fires (this is what's being recorded). On any plain `<div>`: Ctrl+right → ZAC menu stub. |
| 6   | Dashboard: choose Selenium → only Selenium rows visible; CSV export contains `framework` & `test_runner` columns. Open Playwright run report header reads "Playwright". |
| 7   | `mvn -B test -Dtest=RunZacSuiteTest`. Look for `reports/smoke_test_results.json` with passed/failed/healed counts. |
| 8   | `Ctrl+Shift+A` toggles the panel on Recording, Settings, and Dashboard tabs. Send a question with Ollama running locally → response appears. With Ollama off → setup instructions shown, no crash. |

---

## Follow-up: FIX 3 — project deletion flow

Existing entry points (already in tree):

* `public/app.js` line ~3566 — `clearProjectList()` (clears the dropdown only)
* `public/app.js` line ~3952 — wires `clear-project-btn` click → `clearProjectList`
* `public/index.html` line ~169 — `delete-project-btn` (currently `display: none`)
* `routes/api.js` — search for `projects/delete` to find the existing API

**Plan for the next turn**

1. Add an audit pass on boot: read `localStorage.getItem('zac_run_history')`,
   group by `projectId`, log per-project run counts. Tag projects with
   `runs.length === 0` as "orphaned" (`console.warn('[ZAC-FIX] orphaned project ...')`).
2. Replace the no-op delete handler with a confirmation modal that interpolates
   the run count: *"Delete project 'X'? This will also remove N associated runs."*
3. On confirm:
   1. `DELETE /api/projects/:id` (already exists in `routes/api.js`).
   2. Remove from `localStorage.zac_run_history` rows that match `projectId`.
   3. Splice the row out of `state.projects` and re-render the dropdown
      *without* hitting the server again.
   4. If the deleted project was selected, fall back to `-- Select Project --`.
   5. Notify the dashboard sidebar via `window.dispatchEvent(new CustomEvent('zac-runs:changed'))`.
4. Toast "Project deleted" 2s.

Bind in `zacFixes.js` so we don't touch `app.js` directly. Add `installProjectDeleteFix()`
mirroring the same shape as the other installers.

---

## Follow-up: FIX 4 — recording engine viewport + action mapping

**Where the recording is generated**

* `services/recordingService.js` (not in this prompt's tree, but referenced by
  `routes/api.js`)
* `java-code-generators.js` — generator for Selenium-Java bodies
* `generators/` — per-framework generators

**What to add**

* On `recording:start` event, capture `window.innerWidth/innerHeight` from the
  injected page script (the recorder already injects scripts into the recorded
  page; pipe the dimensions through the same channel).
* Store as `recording.viewport = { width, height }` on the recording session.
* Add a small mapping table in each generator that emits the viewport line:
  - Selenium-Java: `options.addArguments("--window-size=" + W + "," + H);`
  - Playwright:    `browser.newContext({ viewport: { width: W, height: H } })`
  - Cypress:       config block `{ viewportWidth: W, viewportHeight: H }`
  Default to `1280x720` when capture failed and `console.warn('[ZAC-FIX] viewport capture failed, defaulting to 1280x720')`.
* Action-mapping table for the recorder's event-to-step translator:

  | DOM event             | Generator output                                                       |
  | --------------------- | ---------------------------------------------------------------------- |
  | `mouseover`/`mouseenter` | Selenium: `new Actions(driver).moveToElement(el).perform();`         |
  | `change` on `<select>`   | Selenium: `new Select(el).selectByVisibleText("opt");`               |
  | `dragstart`+`drop`       | Selenium: `new Actions(driver).dragAndDrop(src,tgt).perform();`      |
  | `change` on `input[type=file]` | Selenium: `el.sendKeys("/abs/path/to/file");`                  |
  | `scroll` (debounced 500ms) | Selenium: `js.executeScript("window.scrollBy(0," + dy + ");");`    |
  | `dblclick`               | Selenium: `new Actions(driver).doubleClick(el).perform();`           |
  | `contextmenu` (native)   | Selenium: `new Actions(driver).contextClick(el).perform();`          |

  The Playwright/Cypress equivalents are similarly straightforward — keep them
  in the same lookup table so all three generators use one source of truth.

**Verification scenarios**

```text
demoqa.com/droppable        → drag recorded as dragAndDrop
demoqa.com/select-menu      → select recorded as selectByVisibleText
demoqa.com/upload-download  → upload recorded as sendKeys
demoqa.com/tool-tips        → hover recorded as moveToElement
demoqa.com/slider           → scroll recorded as scrollBy
```

These can be wired into the existing `automation-suite/tests/ui/test_recording_session.py`
or a small new node script under `scripts/validate-recording.mjs`.

---

## Final Quality Gate (smoke)

The `Hooks` + `SmokeAggregator` already write `projects/demoqa/reports/smoke_test_results.json`.
For the toplevel smoke result described in the master prompt
(`reports/smoke_test_results.json` at repo root covering both UI fixes and the
demoqa run), wire a small script at `scripts/run-smoke.mjs` in a follow-up
that:

1. Boots the ZAC server (or assumes one is running on `localhost:3000`).
2. Drives Playwright through the per-tab UI checks listed in §"Verification status".
3. Runs `mvn -B test -Dtest=RunZacSuiteTest` and reads
   `projects/demoqa/reports/smoke_test_results.json`.
4. Concatenates both into `reports/smoke_test_results.json` at repo root.
5. Exits non-zero on any `failed > 0` (which would block release).
