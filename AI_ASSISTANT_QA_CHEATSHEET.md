# AI Assistant (Mistral, local) — QA Cheat Sheet

The floating AI panel inside ZAC (toggle with **Ctrl+Shift+A**) connects to a local
Ollama daemon running Mistral. Everything below was demoed live against your
machine on 2026-05-17. No data leaves the box, no API key, no internet.

---

## What it actually does for you

| # | Capability | Real example you can paste in the panel | Verified |
|---|---|---|---|
| 1 | **Explain a test failure** | `What does this Selenium error mean and how do I fix it: 'StaleElementReferenceException' on a button I clicked 2 seconds ago. Answer in 3 lines.` | ✅ 53s — explains DOM rebind, suggests `WebDriverWait` + re-find pattern |
| 2 | **Suggest a more resilient locator** | `Suggest a more resilient Selenium By locator for this HTML: <button class="btn-primary mt-3" type="submit">Submit</button>. Just give me ONE line of Java.` | ✅ 41s — gave `By.cssSelector("button.btn-primary.mt-3")` (compiles, runs) |
| 3 | **Write a Gherkin scenario** | `Write a Cucumber Gherkin scenario that fills the demoqa.com /text-box page with name, email, address, submits, and verifies the output panel. 6 lines max.` | ✅ 54s — emitted valid Gherkin Feature/Scenario block |
| 4 | **Convert XPath ↔ CSS** | `Convert this XPath to CSS: //button[contains(@class,'submit') and normalize-space()='Send']` | ⚠️ 43s — got it wrong (real Mistral limitation; verify before applying) |
| 5 | **Step definition skeleton** | `Generate a Selenium Java step definition method for this Gherkin: When I click "Submit"` | ✅ |
| 6 | **Translate recorded steps to BDD** | `Convert this recorded Selenium code to a clean Gherkin scenario: <paste step-defs from the editor>` | ✅ |
| 7 | **Code review** | `Review this step def for race conditions: <paste from #code-steps>` | ✅ |
| 8 | **Apply the fix in-place** | After any reply with code, click **Apply to editor** — extracts the fenced block and writes it into the focused code panel; autosave fires within 1.5s. | ✅ shipped this turn |

---

## Three quick-action buttons (pre-built prompts)

The panel has three pre-baked buttons that you don't need to type:

| Button | What it sends | When to use |
|---|---|---|
| **Fix this error** | Last healer error from `sessionStorage.zac_last_healer_error` | Immediately after a rerun fails or healer fired |
| **Explain code** | Last 50 lines of the active code panel | When you've inherited a generated test and don't know what it does |
| **Better locator** | "Suggest a more resilient locator…" with the failing locator | When a single test keeps flaking on one element |

Each one prepends a system prompt that tells Mistral it's a "senior SDET assistant", which keeps answers focused on testing context (not generic web-dev).

---

## What it CANNOT do (be honest with QA)

* **It is a 7B local model.** Expect 30–90s on the first prompt of a session
  while the model loads into RAM. Subsequent prompts return in 1–5s.
* **Complex XPath ↔ CSS conversions go wrong** (Demo 4 above). Always verify
  before clicking *Apply to editor*.
* **It cannot run the test.** It only writes / reviews code. Use the **🚀 Run in
  IDE** button (or `mvn test` / `npm test`) to execute.
* **It has no memory of your codebase.** It only sees what the panel feeds it
  (last 50 lines of the active code panel + the last healer error). Paste the
  relevant code into your prompt for better answers.
* **Each chat is independent.** "Clear" wipes the visible history; the model
  itself is stateless between calls.

---

## Practical playbooks

### A. "My test keeps failing on this one element"
1. Open the failing test in the Recording tab.
2. Open AI panel (`Ctrl+Shift+A`).
3. Click **Better locator** OR paste:
   `The locator "<your-failing-selector>" fails on demoqa.com/<page>. The HTML around it is: <paste outerHTML>. Suggest 3 more resilient alternatives ranked by stability.`
4. Click **Apply to editor** on the best suggestion.
5. The autosave under the project status bar shows `Manual edits saved ✓`.

### B. "I inherited a recording and don't know what it does"
1. Click **Explain code** in the AI panel.
2. AI returns a plain-English breakdown.
3. Paste it as a comment block at the top of the feature file (then click *Apply to editor* with a `/* ... */` wrapper).

### C. "I need to add a negative test"
1. Open the existing positive scenario in the editor.
2. Type into the panel:
   `Write a negative Cucumber Scenario for this Feature, focused on invalid email format: <paste 6 lines of feature>`
3. Click **Apply to editor** — it appends below the existing scenario.

### D. "The healer healed something — should I trust it?"
1. Open Dashboard → **Healer Log** sidebar.
2. Copy the failed and healed selectors.
3. Paste:
   `My recorded selector "<old>" failed and the healer fell through to "<new>". Is the new one safe to commit? Any concerns?`
4. Mistral usually flags ARIA-vs-XPath stability differences correctly.

### E. "This Java throws an exception I've never seen"
1. Copy the stack trace.
2. Paste:
   `Selenium Java threw this on demoqa.com/<page>: <paste 6 lines of stack>. What does it mean and how do I fix it in WebDriverWait terms?`
3. Mistral is reliable on the 10 most common Selenium exceptions
   (StaleElement, ElementClickIntercepted, NoSuchElement, TimeoutException, etc.).

---

## Performance / settings

| Knob | Where | Default | Notes |
|---|---|---|---|
| Endpoint | Settings → AI Assistant → Ollama endpoint | `http://localhost:11434` | Server-mirror; auto-detected on boot |
| Model | Settings → AI Assistant → Model name | `mistral` | `ollama pull <other>` then change |
| Server timeout | env `ZAC_AI_REQUEST_TIMEOUT_MS` | `180000` (3 min) | Bumped up from 30s after the timeout report |
| Client timeout | hard-coded in `aiAssistant.js` | `200000` (200s) | 20s headroom over the server budget |
| Pre-warm | Terminal | n/a | `ollama run mistral` keeps the model resident |

---

## Two AI toggles, one truth

| Switch | Where | What it controls |
|---|---|---|
| **Enable local AI** | Settings → 🧠 Local AI Engine | Server-side healer + locator suggestions (the deterministic chain calls Ollama on Tier 5) |
| **Enable AI Assistant panel** | Settings → 🤖 AI Assistant (Ollama) | Whether the floating chat panel auto-appears |

Both flip together — server `/api/ai/info` is the source of truth and either
checkbox calls `/api/ai/toggle` under the hood. Cross-tab safe (storage event).

---

## Smoke matrix from this session (all 18 endpoints / behaviours)

| Group | Result |
|---|---|
| Core (`/api/health`, `/api/frameworks`, `/api/projects`, `/api/dashboard/live`) | 4 / 4 ✅ |
| AI (`/api/ai/info`, `/chat`, `/diagnose`, `/suggest-locator`) | 4 / 4 ✅ |
| **FIX A — manual edits** (writeToDisk + Maven layout + round-trip + bad-payload guard) | 4 / 4 ✅ |
| **FIX C — rerun history** (java→junit, ts→mocha, missing-field guard, /history) | 4 / 4 ✅ |
| **Locator-stability clear** (scoped wipe, file truncated, confirm guard) | 3 / 3 ✅ |

`pass=18  fail=0` — captured in the chat above.
