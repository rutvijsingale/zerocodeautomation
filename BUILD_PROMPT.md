# BUILD PROMPT — Zero-Code Automation IDE (ZAC)

> Hand this entire document to any AI coding agent. It is a **complete, self-contained build specification** to recreate the Zero-Code Automation IDE exactly as it stands today, with no missing pieces.

---

## 0. ROLE & GUARDRAILS FOR THE BUILDING AI

You are a Senior Full-Stack Engineer with experience in:
- Node.js + Express APIs
- WebSocket real-time streaming
- Playwright browser automation
- Java + Cucumber + Selenium / Playwright code generation
- Vanilla HTML / CSS / JS (no frameworks, no build step)
- Local-first software design (no internet at runtime)
- CSP-strict frontends (`script-src 'self'`, no `'unsafe-inline'`)

**Hard rules — break any of these and the build is wrong:**

1. **Local-first.** Zero CDNs, zero analytics, zero Google Fonts, zero external API calls at runtime. The tool must work fully offline. The only runtime dependencies on `localhost` are the Node server itself and (optionally) Ollama on `127.0.0.1:11434`.
2. **CSP-strict frontend.** Helmet sends `script-src 'self'` and `script-src-attr 'none'`. **No inline `<script>` blocks. No inline event handlers (`onclick=`, `onload=`, etc.). No `javascript:` URLs. No `eval()` / `new Function()` / `setTimeout(string)`.** Every JS file must live as a same-origin `.js` file.
3. **No build step on the client.** The `public/` folder is served as-is by `express.static`. Plain `.html`, `.css`, `.js`. No webpack, no Vite, no React, no JSX, no TypeScript transpile.
4. **No database.** All persistence is the filesystem. Recordings/projects under `projects/<projectId>/`. Generated test code under `generated-projects/<framework>/<projectId>/`. Reruns under `generated-projects/<framework>/<projectId>/reruns/<test>/<timestamp>/replay-result.json`.
5. **AI is optional.** A `NullProvider` must keep everything else working when no Ollama is detected. The deterministic locator healer must work without AI.
6. **Backward compatible.** Recording/execution flow may not be broken by any new feature.
7. **Charts are pure SVG**, hand-drawn against payloads — no chart libraries.

---

## 1. PROJECT IDENTITY

- **Name:** `zero-code-automation-ide` (a.k.a. **ZAC**)
- **Description:** A web-based IDE that records user interactions in a real browser, generates test automation code (Java + Cucumber for Playwright or Selenium WebDriver), runs the generated tests, and shows results on a live dashboard. Optional local LLM (Ollama) for locator-healing fallback.
- **Module type:** ESM (`"type": "module"` in `package.json`)
- **Engines:** Node `>= 18`
- **License:** MIT

---

## 2. TECH STACK (FROZEN — DO NOT SUBSTITUTE)

### Runtime dependencies (`dependencies`)
```json
{
  "archiver": "^6.0.1",
  "body-parser": "^1.20.2",
  "cors": "^2.8.5",
  "dotenv": "^16.3.1",
  "express": "^4.18.2",
  "express-rate-limit": "^7.1.5",
  "express-ws": "^5.0.2",
  "helmet": "^7.1.0",
  "mammoth": "^1.11.0",
  "multer": "^1.4.5-lts.1",
  "nodemailer": "^7.0.9",
  "playwright": "^1.40.1",
  "uuid": "^9.0.1"
}
```

### Dev dependencies
```json
{
  "@types/node": "^20.10.0",
  "eslint": "^8.55.0",
  "prettier": "^3.1.0"
}
```

### Frontend
- Vanilla HTML5, CSS3, JS (ES2022). No framework. No transpiler.
- All charts: pure inline SVG.
- All scripts loaded via `<script src="/file.js?v=<cache-bust>">`. NEVER inline.

### Optional AI
- **Ollama** at `http://127.0.0.1:11434`, default model `mistral`.
- Detection: HTTP `GET /api/tags` with 500 ms timeout; if reachable, `OllamaProvider`, else `NullProvider`.

### NPM scripts
```json
{
  "start": "node server.js",
  "dev": "node --watch server.js",
  "test": "node --test",
  "test:unit": "node --test automation-suite/unit-js/*.test.mjs",
  "lint": "eslint .",
  "format": "prettier --write .",
  "package": "node package-portable.js",
  "validate:live-flow": "node scripts/validate-live-flow.mjs",
  "validate:stability": "node scripts/stability-loop.mjs",
  "validate:stress": "node scripts/stress-loop.mjs",
  "seed:amazon-sony": "node scripts/seed-amazon-sony-wh-ch520.mjs"
}
```

---

## 3. DIRECTORY LAYOUT (MUST MATCH EXACTLY)

```
zero-code-automation-ide/
├── server.js                      # Express + express-ws bootstrap; ~10 KB
├── package.json
├── .env.example
├── README.md
├── middleware/
│   ├── security.js                # Helmet CSP, CORS, rate-limit, validators
│   └── errorHandler.js            # asyncHandler, notFoundHandler, requestLogger
├── routes/
│   ├── api.js                     # Mounts every /api/* endpoint (~4300 lines)
│   ├── websocket.js               # /api/recording/:sessionId WebSocket
│   └── requirements.js            # SRS / .docx / .md ingestion
├── services/                      # Business logic — one concern per file
│   ├── browserService.js          # Playwright browser session lifecycle
│   ├── projectService.js          # CRUD on projects/<id>/project.json
│   ├── projectLayout.js           # generated-projects/* directory schema
│   ├── locatorService.js          # Locator repository per project
│   ├── healedLocatorService.js    # Deterministic healing chain
│   ├── aiService.js               # Ollama / Null provider abstraction
│   ├── dashboardService.js        # collectDashboardStats, collectLiveSnapshot
│   ├── reportRenderer.js          # HTML report renderer for a single rerun
│   ├── environmentService.js      # Per-project environments (dev/qa/prod)
│   ├── fileService.js             # Safe FS reads/writes inside repo root
│   ├── mavenService.js            # mvn -B test invocation
│   ├── npmService.js              # npm test invocation
│   ├── requirementParser.js       # SRS → scenario extractor
│   ├── testCaseGenerator.js       # SRS → test cases
│   ├── testPlanGenerator.js       # generated-projects/<...>/test-plan/<flow>.md
│   └── amazonScenarios.js         # Bundled Amazon-walk demo scenarios
├── generators/                    # Code generators (pure functions)
│   ├── playwright.js              # Java + Playwright + Cucumber
│   ├── selenium-testng.js         # Java + Selenium + TestNG (legacy)
│   ├── gherkin.js                 # Feature-file builder
│   ├── steps_ts_template.js       # TypeScript step defs (when targeted)
│   ├── pageObjects.js             # PageObject Java/TS classes
│   ├── step-pattern-matcher.js    # Detects scenario-outline auto-cases
│   ├── zero-code-json.js          # Internal "zero-code" JSON IR
│   └── PLUGIN.md                  # How to add a new framework target
├── models/                        # Plain JS classes (no ORM)
│   ├── Project.js
│   ├── Feature.js
│   ├── Scenario.js
│   ├── Step.js
│   ├── LocatorDefinition.js
│   ├── Environment.js
│   ├── TestDataSet.js
│   └── index.js
├── public/                        # Static frontend (served by express.static)
│   ├── index.html                 # Top tab strip + recorder UI
│   ├── app-tabs.js                # Tab switcher + AI badge (CSP-clean)
│   ├── app.js                     # Recorder UI logic (~6300 lines)
│   ├── stepHandlers.js            # Step-form helpers
│   ├── styles.css                 # Theme + layout
│   ├── dashboard.html             # Dashboard shell (sidebar + main)
│   ├── dashboard.js               # Dashboard logic (~770 lines)
│   ├── settings.html              # Settings page (AI toggle + framework default)
│   ├── settings.js
│   ├── report.html                # Per-rerun HTML report viewer
│   ├── report.js
│   ├── markdown-viewer.html       # In-browser MD docs viewer
│   ├── markdown-viewer.js
│   └── demo/                      # Local demo HTML pages for self-tests
├── projects/                      # USER DATA — recordings, locator repo, healed-locators.json
├── generated-projects/            # USER DATA — generated code + reruns
│   └── <framework>/<projectId>/   # Java/Cucumber project + reruns/<test>/<timestamp>/replay-result.json
├── automation-suite/              # Python pytest QA suite (separate, optional)
├── config/
│   └── frameworks.json            # Framework registry (id, label, defaults)
├── scripts/                       # Maintenance scripts
├── sample-export/                 # Backwards-compat export target
├── test-results/, test-temp/      # Scratch dirs (gitignored)
├── normalization-utils.js         # Step text → canonical Gherkin
├── java-code-generators.js        # Legacy Java generators (~138 KB)
├── package-portable.js            # Builds an offline-ready zip
├── validate-linkage.js            # CI-ish dependency check
├── check-framework.js             # Framework prerequisite check (mvn / npx)
└── docs/ ...                      # *.md guides at repo root
```

---

## 4. SERVER (`server.js`)

### Bootstrap order — must match exactly
```js
import express from 'express';
import expressWs from 'express-ws';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const app = express();
const wsInstance = expressWs(app);

// 1. Security headers FIRST.
app.use(helmet(securityHeaders));
// 2. JSON / urlencoded body parsing (10 MB limit).
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// 3. Request logger.
app.use(requestLogger);
// 4. SPECIAL: Recording action capture endpoint must be defined BEFORE
//    the global CORS middleware so external sites (amazon.com etc.) can
//    POST to /api/recording/:sessionId/action with permissive CORS.
app.options('/api/recording/:sessionId/action', cors(recordingCorsOptions));
app.post('/api/recording/:sessionId/action', cors(recordingCorsOptions), handler);
// 5. Restrictive CORS for everything else.
app.use(cors(corsOptions));
// 6. Routes.
app.use('/api', apiRoutes);
app.use('/api/requirements', requirementsRoutes);
// 7. WebSocket endpoint for live recording streams.
app.ws('/api/recording/:sessionId', handleWebSocketConnection);
// 8. Static.
app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: 0 }));
// 9. Reports as static (browseable):
app.use('/reports', express.static(path.join(__dirname, 'generated-projects')));
// 10. 404 + error handlers LAST.
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(process.env.PORT || 3000);
```

### Helmet CSP (`middleware/security.js`) — exact directives
```js
helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],   // inline <style> OK; required for the recorder UI
      scriptSrc:  ["'self'"],                      // NO 'unsafe-inline' — every <script> must be external same-origin
      imgSrc:     ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc:    ["'self'"],
      objectSrc:  ["'none'"],
      mediaSrc:   ["'self'"],
      frameSrc:   ["'none'"],                      // we use same-origin iframes via SAMEORIGIN frame-ancestors
    },
  },
  crossOriginEmbedderPolicy: false,                // WebSocket-friendly
});
```

### Rate limiters (defined in `security.js`)
- `strictRateLimiter` — 15 min / 10 req — for write/destructive endpoints (recording/start, export, generate-files, …)
- `generalRateLimiter` — 15 min / 100 req — for normal CRUD
- `pollingRateLimiter` — 1 min / 60 req — for status / actions polling

---

## 5. API SURFACE (REST) — every endpoint that must exist

> All under `/api`. Non-JSON endpoints noted explicitly.

### Health & config
- `GET  /api/health` — `{ status, uptime, ... }`
- `GET  /api/config` — public-safe config snapshot
- `GET  /api/frameworks` — registry from `config/frameworks.json`

### Recording session lifecycle
- `POST /api/recording/start` body `{ baseUrl, browserType, projectId? }` → `{ sessionId, wsUrl }`
- `POST /api/recording/stop` body `{ sessionId, ... }` → returns captured actions + auto-creates project
- `POST /api/recording/:sessionId/action` (CORS-permissive) — receives in-page DOM events
- `POST /api/recording/:sessionId/save-locator` — right-click locator save from recorder browser
- `GET  /api/recording/:sessionId/status` (polling-rate-limited)
- `GET  /api/recording/:sessionId/actions` (polling-rate-limited)

### WebSocket
- `WS  /api/recording/:sessionId` — bidirectional action stream (event types: `action`, `pause`, `resume`, `stop`, `assertion`, `live-feature-update`)

### Projects
- `GET    /api/projects`
- `GET    /api/projects/current`
- `GET    /api/projects/:projectId`
- `POST   /api/projects` — body `{ name, framework, ... }`
- `POST   /api/projects/select` — sets currentProjectId
- `POST   /api/projects/:projectId/save` — overwrite project.json
- `POST   /api/projects/:projectId/append-steps` — extend recorded steps
- `POST   /api/projects/:projectId/generate-files` — run code generators
- `DELETE /api/projects/:projectId`

### Locators (per project)
- `GET    /api/projects/:projectId/locators`
- `POST   /api/projects/:projectId/locators`
- `DELETE /api/projects/:projectId/locators/:locatorId`

### Reusable flows / test data / environments
- `GET/POST/DELETE /api/projects/:projectId/flows[/:flowId]`
- `GET/POST        /api/projects/:projectId/test-data`
- `GET/POST/DELETE /api/projects/:projectId/environments[/:envId]`

### Maven / NPM execution
- `GET  /api/projects/:projectId/maven/check`
- `POST /api/projects/:projectId/maven/execute`  → spawns `mvn -B test`
- `GET  /api/projects/:projectId/npm/check`
- `POST /api/projects/:projectId/npm/execute`

### Rerun (executes generated tests in a fresh Playwright session, with healing)
- `POST /api/rerun` — body `{ framework, projectId, testName }` → `{ executionId }`. Spawns Playwright, replays steps, writes `replay-result.json` to `generated-projects/<fw>/<projectId>/reruns/<testName>/<timestamp>/`. Streams progress back via the same WS channel if still open.
- `POST /api/rerun/cancel` — body `{ executionId }`

### Export
- `POST /api/export` — zips a project into a portable archive

### AI
- `GET  /api/ai/info`            → `{ available, provider, model, baseUrl, reason? }`
- `POST /api/ai/toggle` body `{ mode: 'on'|'off'|'auto' }` → re-probes Ollama; returns same shape + `ok`
- `POST /api/ai/suggest-locator` body `{ failedSelector, htmlSnippet, elementHint? }` → `{ ok, suggestion, confidence, raw, provider }`

### Dashboard
- `GET  /api/dashboard/stats` — heavy disk walk; returns the full payload below
- `GET  /api/dashboard/live`  — cheap in-memory snapshot (sub-ms)
- `GET  /api/dashboard/report/html?path=<fw>/<proj>/reruns/<test>/<ts>` — self-contained HTML rerun report; downloads as `.html` (printable to PDF)

### Email (mounted at `/api/email`, see §22)
- `GET  /api/email/config`           → current SMTP config, password redacted to `'•••'`
- `POST /api/email/config`           body = partial config; empty `password` keeps existing
- `POST /api/email/test`             → `{ ok, message }` — verifies SMTP without sending
- `POST /api/email/send-test`        body `{ to?, subject? }` → fires a test email
- `POST /api/email/send-rerun`       body `{ framework, projectId, testName, timestamp, to?, subject?, note? }` — emails the HTML report
- `POST /api/email/send-dashboard`   body `{ to?, subject?, note? }` — emails the current `/api/dashboard/stats` JSON

### Requirements ingestion (mounted at `/api/requirements`)
- `POST /api/requirements/upload` — accepts `.txt`, `.md`, `.docx` (mammoth)
- `POST /api/requirements/parse` — extracts scenarios

---

## 6. DASHBOARD STATS PAYLOAD — exact shape

`GET /api/dashboard/stats` returns:

```ts
{
  summary: {
    totalProjects: number,
    totalFrameworks: number,
    totalReruns: number,
    totalHealingEvents: number,
    generatedAt: string,         // ISO
  },
  frameworks: Array<{ id: string, projectCount: number }>,
  projects: Array<{
    projectId: string, framework: string,
    rerunCount: number, lastRerunAt: string | null,
    healingEvents: number,
  }>,
  reruns: Array<{                // newest-first; capped at 500 total, 50 per project
    projectId: string, framework: string, testName: string,
    timestamp: string,           // "YYYY-MM-DDTHHMMSS-mmmZ"
    status: 'passed' | 'failed' | 'unknown',
    executedSteps: number, successCount: number, failureCount: number,
    healingHits: number, scrollSteps: number,
    durationMs: number | null,
    reportRoot: string, replayResultUrl: string,
    screenshotsUrl: string, videosUrl: string, tracesUrl: string, logsUrl: string,
  }>,
  healingLog: Array<{
    projectId: string,
    primarySelector: string, healedSelector: string,
    reason: string, savedAt: string,
  }>,
  signOffReports: Array<{ name: string, sizeBytes: number, mtime: string }>,
  testSummary: {                 // executive 5-card layout
    totalCases: number, passed: number, failed: number, skipped: number,
    passPct: number,
    lastRunStatus: 'passed' | 'failed' | 'unknown' | null,
    lastRunAt: string | null,
    totalExecutionMs: number, avgDurationMs: number,
  },
  topFailingTests: Array<{ framework, projectId, testName, failCount, lastFailAt }>,  // top 10
  flakiestLocators: Array<{ primarySelector, healCount, lastHealedTo, lastHealedAt, affectedProjects, affectedProjectCount }>,  // top 10
  errorCategories: Array<{ category: string, count: number }>,
  performance: {
    server: { uptimeSeconds, heapUsedMB, heapTotalMB, rssMB, nodeVersion, platform },
    rerunDurations: { sampleSize, meanMs, p50Ms, p95Ms, p99Ms, maxMs },
    rates: { totalReruns, passes, fails, passRatePct, healingEvents, healRatePerRerun },
    timeSeries: Array<{ timestamp, framework, durationMs, passed, failed, healed }>, // newest 20, oldest-first
  },
}
```

`GET /api/dashboard/live` returns:
```ts
{
  server: { nowIso, uptimeSeconds, heapUsedMB, rssMB, loadAvg1m },
  sessions: { count, items: Array<{ sessionId, ageSeconds, actionCount, lastUrl, idleSeconds }> },  // capped at 20
  reruns:   { count, items: Array<{ executionId, cancelled, hasBrowser }> },                        // capped at 20
}
```

---

## 7. DATA ON DISK — file conventions

### `projects/<projectId>/`
- `project.json` — Project model (name, framework, baseUrl, recorded steps, locator repo, environments, flows, test data, tags, scenarios, ...)
- `healed-locators.json` — append-only log: `{ entries: [{ primarySelector, healedSelector, reason, savedAt }] }`

### `generated-projects/<framework>/<projectId>/`
Generated Java + Cucumber project (Maven layout):
```
pom.xml
src/main/java/...PageObjects/...
src/test/java/...stepDefinitions/...
src/test/resources/features/<feature>.feature
test-plan/<flow>-test-plan.md
recordings/recording-<iso-ts>/      # raw recordings
   element-locators.json
   metadata.json
   recorded-steps.json
   scroll-events.json
reruns/<testName>/<timestamp>/
   replay-result.json               # ← dashboard scans this
   screenshots/, videos/, traces/, logs/
README.md
```

### `replay-result.json` shape
```ts
{
  executionId: string,
  framework: string,
  projectName: string,
  testName: string,
  timestamp: string,             // "YYYY-MM-DDTHHMMSS-mmmZ"
  cancelled: boolean,
  success: boolean,
  executedSteps: number,
  successCount: number, failureCount: number,
  durationMs: number,
  results: Array<{
    step: 'navigate'|'click'|'type'|'scroll'|'assertText'|'assertVisible'|'wait'|...,
    success: boolean,
    duration: number,
    error?: string,              // present when success=false
    healed?: boolean,            // present when healer rescued the step
  }>,
  healingSummary?: { healedSteps: number, ... },
  scrollSummary?: { scrollSteps: number, ... },
}
```

---

## 8. AI SERVICE (`services/aiService.js`) — must reproduce exactly

### Provider abstraction
```js
class NullProvider {
  available() { return false; }
  info()      { return { provider:'null', model:null, baseUrl:null, reason }; }
  async suggestLocator() { return { ok:false, reason, suggestion:null, confidence:0 }; }
}

class OllamaProvider {
  constructor({ baseUrl='http://127.0.0.1:11434', model='mistral' } = {}) { ... }
  available() { return true; }
  info()      { return { provider:'ollama', model, baseUrl }; }
  async suggestLocator({ failedSelector, htmlSnippet, elementHint }) { ... }
}
```

### Auto-detect logic (singleton, lazy)
- Probe `GET /api/tags` with **500 ms** timeout.
- Honor env vars: `ZAC_AI_PROVIDER` (`ollama`|`null`|unset=auto), `ZAC_AI_MODEL` (default `mistral`), `ZAC_AI_BASE_URL` (default `http://127.0.0.1:11434`).

### Toggle behavior (`setAiProvider(mode)`)
- `'on'`  → re-probe; if reachable install `OllamaProvider` else fallback to `NullProvider` with reason `'cannot enable AI: no Ollama at <url>. Install with "brew install ollama && ollama pull mistral && ollama serve".'`
- `'off'` → install `NullProvider` with reason `'disabled via dashboard toggle'`
- `'auto'`→ clear cache and re-detect

### Locator-suggestion prompt (CRITICAL — paste verbatim)
```
You are a senior test-automation engineer. The following CSS / Playwright selector failed at runtime:

  <failed>

The element is described as: <hint or "(no description provided)">

Here is the relevant HTML snippet from the page:

<html or "(no HTML provided)">

Your task: reply with ONE single CSS or Playwright selector that uniquely identifies the same element.

Strong rules:
  - Prefer [data-testid="..."] over any other attribute.
  - Then prefer #id, [name="..."], [aria-label="..."], role=, text=
  - NEVER use absolute XPath like /html/body/...
  - NEVER use :nth-child unless absolutely unavoidable.
  - Reply with ONLY the selector. No code block, no explanation, no quotes.
```

### Response parser (`extractSelectorFromResponse`)
- Strip markdown fences.
- Take first non-empty line.
- Strip surrounding quotes; strip `selector:` / `the selector is` prefixes.
- Validate via `looksLikeSelector(s)`: must start with `#`, `.`, `[`, `//`, `xpath=`, `text=`, `role=`, OR be tag-anchored (e.g. `button.primary`), OR be a bare tag in the whitelist.
- Tag whitelist: `a button input select textarea form label option div span p h1..h6 ul ol li table tr td th thead tbody nav header footer main section article aside img iframe svg video audio`
- Return `{ ok:true, suggestion, confidence:70, raw }` or `{ ok:false, reason:'no parsable selector in model response', raw }`.

### Truncation
`MAX_HTML_BYTES = 8 * 1024` — coarse-truncate with `<!-- truncated by aiService -->`.

---

## 9. DETERMINISTIC HEALER (`services/healedLocatorService.js`)

Order of strategies (try in this exact order, return first success):
1. **Primary** selector (as recorded).
2. **Repository** match by `pageName + elementName`.
3. **`data-testid`** if present in DOM near recorded position.
4. **`#id`** ancestor lookup.
5. **`[name="..."]`** if present.
6. **`role=` + accessible name**.
7. **Visible text** (`text=...`) for clickables / links.
8. **AI fallback** (only if `aiService.available()`), prompt as in §8.
9. **Give up** → record failure into `replay-result.json` and `healed-locators.json` if any rescue chain step succeeded.

Every successful rescue appends to `projects/<id>/healed-locators.json`.

---

## 10. FRONTEND ARCHITECTURE

### Top-level shell (`public/index.html`)
- Single `<header>` with app title + meta line.
- Tab strip `<nav class="nav-tabs">` with three buttons: `🎬 Recording`, `📊 Dashboard`, `⚙️ Settings`.
- Three `<div class="tab-pane">` panes:
  - `tab-pane-recorder` — full recorder UI (mounted DOM, JS in `app.js` + `stepHandlers.js`).
  - `tab-pane-dashboard` — `<iframe src="/dashboard.html?v=<bust>" id="dashboardFrame">`.
  - `tab-pane-settings` — `<iframe src="/settings.html" id="settingsFrame">`.
- CSS: `.tab-pane { display: none !important; }` / `.tab-pane.active { display: block !important; }` (`!important` defeats any cached/third-party CSS that might unhide a pane).
- **Tab-switch JS lives in `public/app-tabs.js`** (NEVER inline). Loaded via `<script src="/app-tabs.js?v=...">`. Handles button-click → toggle `.active` on pane + button, set `body.tab-<id>` for accent-band CSS, and auto-load the AI badge once at start.

### Recorder UI (`public/app.js`, ~6300 lines)
Sections, in order, on the recorder pane:
1. **Project selector** bar — dropdown of projects, "+ New project (optional)", Save, Delete, Clear.
2. **Step Builder card** with:
   - Framework dropdown: `playwright-java` (Playwright + Java + Cucumber), `selenium-java` (Selenium + Java + Cucumber).
   - Browser dropdown: `chromium` 🌐, `firefox` 🦊, `webkit` 🧭, `edge` 🔷.
   - Project name, base URL (optional), feature title, feature name, tags.
   - Advanced Cucumber toggles: Use scenario outline + examples-table JSON, Mark next steps as Background, Create new scenario.
   - Page name + Element name + Step kind selector (`navigate`, `click`, `type`, `assertText`, `assertVisible`, `scroll`, `wait`, ...).
   - Selector builder + Add step / Live recorder buttons.
3. **Generated Code card** with two tabs:
   - "Selenium Java" / "Playwright Java" — full step-defs class.
   - "Gherkin Feature" — full `.feature` text.
   Both have Copy + Save buttons.
4. **Full-screen Recording overlay** (display:none until recording starts) with live Gherkin + live Step Definitions textareas, Stop / Pause / Revert.

### Dashboard (`public/dashboard.html` + `dashboard.js`) — see §11.

### Settings (`public/settings.html` + `settings.js`)
- AI on/off toggle (POST `/api/ai/toggle`) with status line.
- Default framework dropdown (LocalStorage key `zac.defaultFramework`).
- Server-info read-only block (uptime / heap / rss / load) refreshed from `/api/dashboard/live` every 5 s.
- Footer note: "Settings live PER BROWSER via localStorage and PER SERVER PROCESS via /api/ai/toggle. Nothing here writes to disk in your repo."

### Per-rerun report viewer (`public/report.html` + `report.js`)
- Accepts `?path=<fw>/<proj>/reruns/<test>/<ts>`.
- Calls `/api/dashboard/report/html?path=...` (gets self-contained HTML) OR renders inline from `replay-result.json`.

### Markdown viewer (`public/markdown-viewer.html` + `markdown-viewer.js`)
- Hand-rolled markdown→HTML converter (no external lib). Supports headings, lists, code fences, inline code, blockquotes, hr, bold, italic, links, images.

---

## 11. DASHBOARD UI SPEC (`public/dashboard.html` + `dashboard.js`)

### Layout
- CSS Grid: `240px sidebar | 1fr main`.
- Sidebar is `position: sticky; height: 100vh`.

### Sidebar
- Brand row: pulsing teal dot + "ZeroAutomation\nCode IDE" (two lines, font-weight 700).
- Section "OVERVIEW":
  - `▦ Overview` — badge = current `running now` count (live).
- Section "TEST RUNS":
  - `≡ All Runs` — badge = `testSummary.totalCases`.
  - `⊘ Failures` — badge = `testSummary.failed` (red).
  - `✚ Healer Log` — badge = `summary.totalHealingEvents`.
- Section "REPORTS":
  - `↗ Trends`
  - `◧ Coverage`
- Sidebar footer: env card with label `Environment` + value `<env> / <hostname>` (derived from `window.top.location.hostname`).

### Main column
- Page header: `<h1 id="pageTitle">` + `<div id="pageSub">` + action row:
  - Live beacon `● live` (turns red on offline).
  - "updated <localtime>" timestamp.
  - `↻` refresh icon button.
  - **AI toggle pill** (`AI: OFF` / `AI: ON (mistral)` / `AI: unavailable`).
  - "Export report" — downloads current stats as JSON (filename `zac-dashboard-YYYY-MM-DD.json`).
  - "+ New run" — switches parent shell to recorder tab (postMessage / direct nav).

### Views (one visible at a time, swapped by sidebar nav clicks)
1. **Overview** — DEFAULT
   - 4 KPI cards (`Total runs` / `Passed` / `Failed` / `Running now`) with **colored 3-px left-bar** (blue/green/red/amber).
   - Live row with 4 cards (Active recordings, Running reruns, Server pulse, Server uptime).
   - Charts row:
     - **Pass / Fail — last 14 days** — smooth SVG line chart with green pass line, red fail line, light green area-fill under pass, axis grid, dot markers.
     - **Status breakdown** — donut chart with center-total + side legend (Passed / Failed / Skipped / Healed).
   - "Recent activity — last 5 runs" table (Run / Project / Feature / Browser / Status pill).
2. **All Runs** — per-framework stacked bar + filterable table (framework / status / search) with full rerun rows (Run, Project, Feature, Browser, Steps, Pass, Fail, Heals, Duration, When, Status).
3. **Failures** — top failing tests, flakiest locators, error categories.
4. **Healer Log** — AI-fix log table.
5. **Trends** — failures-over-time, locator-stability snapshot, rerun duration timeline (newest 20).
6. **Coverage** — server snapshot (6 cards), duration percentiles (5 cards), aggregate rates (4 cards), all projects table, sign-off reports table.

### Polling
- `/api/dashboard/stats` every **30 s**.
- `/api/dashboard/live` every **2 s**.
- `/api/ai/info` every **15 s**.

### Charts (must be SVG, no library)
- **Stacked horizontal bar** — for "Pass/Fail by framework". Labels left, total count right of bar.
- **Smooth line chart** — Catmull-Rom-ish interpolation (control points = ±¹⁄₆ of neighbour delta). Two lines (green pass / red fail) + area fill under pass. Grid lines + tick labels in monospace.
- **Donut** — outer r=78, inner r=50, in 200×200 viewBox; center label = total + "total".
- All SVG elements add `<title>` for hover-tooltip text.

### Critical UI defenses
- **`table()` helper** must coerce non-Node values: `if (typeof v === 'object' && typeof v.nodeType === 'number') td.appendChild(v); else td.textContent = String(v ?? '');` — anything else crashes when a numeric column is rendered.
- **Stats fetch `.catch()`** must NOT replace `<main>` — it shows a toast + sets `#generatedAt = "stats unavailable"` and lets the next interval recover.
- **`pollLive()` error path** must null-check `#liveDot` and `#liveText` before mutating (they may have been replaced by an earlier failure).
- All hostile string fields **must** render via `textContent`, never `innerHTML`. The `el()` helper supports an `html:` escape hatch — DO NOT use it with user data.

### Cache-busting (REQUIRED to avoid the "I don't see anything" bug)
- Every `<script src>` carries a `?v=<token>` query.
- `dashboard.html` includes `<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">`, `<meta http-equiv="Pragma" content="no-cache">`, `<meta http-equiv="Expires" content="0">`.
- Iframe in `index.html` uses the same `?v=` token.

---

## 12. RECORDING → CODE-GEN → RERUN FLOW

### Recording
1. User picks framework + browser + base URL, clicks "Start Recording".
2. Server `POST /api/recording/start` launches Playwright, opens base URL.
3. Recorder injects an in-page script that captures clicks, type, scroll, navigation, assertion picks, and POSTs them to `/api/recording/:sessionId/action` (lenient CORS).
4. Each action is broadcast on the `WS /api/recording/:sessionId` channel for the IDE's live preview (Gherkin updates as you click).
5. User clicks Stop → server stops Playwright → captured actions are normalized → the project is auto-created or updated under `projects/<id>/project.json` AND the generated Java/Cucumber project under `generated-projects/<framework>/<projectId>/`.

### Code generation (per project)
- `services/projectLayout.js` decides folder layout.
- `generators/playwright.js` or `generators/selenium-testng.js` writes `pom.xml`, page objects, step definitions, Cucumber runner.
- `generators/gherkin.js` writes `.feature` file (supports `Background`, `Scenario Outline` with `Examples` table).
- `generators/pageObjects.js` writes one Java class per `pageName` seen in the recording.
- `generators/zero-code-json.js` writes a portable IR so the rerun engine can replay without re-parsing Java.

### Rerun
- `POST /api/rerun` reads the project's zero-code JSON IR, launches Playwright, executes step-by-step, runs the healer chain on each locator failure (deterministic → AI fallback if available), captures screenshots / video / trace, writes `replay-result.json`.
- Dashboard's next 30-s stats poll picks it up automatically (file walk under `generated-projects/.../reruns/`).

---

## 13. SECURITY POSTURE

- **Helmet** enabled (CSP per §4, X-Frame-Options SAMEORIGIN, HSTS, Referrer-Policy no-referrer, X-Content-Type-Options nosniff).
- **CORS** restrictive everywhere except `/api/recording/:sessionId/action` (must accept arbitrary origins so the recorder injection on user sites works).
- **Rate limiting** as defined in §4.
- **Input validation:** `validateProjectName`, `validateSessionId`, path-traversal guard in `decodeReportPath` (must `path.resolve` and verify the result is **inside** `generated-projects/`).
- **No `eval` / `Function` constructors anywhere.**
- **No external CDN.** Run with `curl -sI` and confirm.

---

## 14. ENVIRONMENT VARIABLES (`.env.example`)

```
PORT=3000
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:3000
MAX_SESSIONS=5
SESSION_TIMEOUT=1800000
EXPORT_DIR=sample-export
ZAC_AI_PROVIDER=
ZAC_AI_MODEL=mistral
ZAC_AI_BASE_URL=http://127.0.0.1:11434
```

---

## 15. AUTOMATION-SUITE (Python QA harness — optional but ship it)

`automation-suite/` contains a separate Python pytest suite that exercises the IDE end-to-end (UI + API + accessibility + visual + security + performance). Folders:
- `tests/api/`, `tests/ui/`, `tests/accessibility/`, `tests/visual/`, `tests/security/`, `tests/perf/`
- `pages/` — page objects (Playwright-Python).
- `fixtures/`, `healer/` — YAML fixtures for stubbed services.
- `unit-js/` — Node-native `node --test` unit tests for the JS modules.

Driven by `pytest.ini` and the GitHub Actions in `.github/workflows/qa-suite.yml`.

---

## 16. SCRIPTS / DEMO SEEDS

- `scripts/seed-amazon-sony-wh-ch520.mjs` — populates a sample 12-step Amazon flow.
- `scripts/validate-live-flow.mjs` — record → save → rerun smoke loop.
- `scripts/stability-loop.mjs` — N-rerun stability loop.
- `scripts/stress-loop.mjs` — concurrent rerun stress.

---

## 17. PORTABLE PACKAGER (`package-portable.js`)

Builds an offline-installable zip:
- Bundles `node_modules` for Linux + macOS + Windows (or platform-specific).
- Includes Playwright's bundled browsers.
- Output: `zac-portable-<platform>-<version>.zip`.

---

## 18. ACCEPTANCE TESTS (the AI must pass these to declare done)

After building, the AI must run all of these and report PASS/FAIL.

1. **Static smoke** — `curl -sI http://localhost:3000/{,dashboard.html,dashboard.js,settings.html,report.html,api/health,api/dashboard/stats,api/dashboard/live,api/ai/info}` all return 200.
2. **No inline scripts in any HTML page** — for each of `/`, `/dashboard.html`, `/settings.html`, `/report.html`, `/markdown-viewer.html`, the regex `<script>([\s\S]+?)</script>` must capture only externals (body length 0).
3. **CSP headers correct** — `Content-Security-Policy` contains `script-src 'self'` and does NOT contain `'unsafe-inline'` for scripts.
4. **Real-browser end-to-end** (Playwright headless): load `/`, click Dashboard tab → pane gets `.active` class with non-zero width/height; iframe loads `dashboard.html`; sidebar shows "ZeroAutomationCode IDE", 6 nav items; KPIs are numeric; pass/fail SVG rendered; donut SVG rendered; recent activity ≤ 5 rows. Zero CSP violations, zero JS errors.
5. **Live sync** — write a synthetic `replay-result.json` to `generated-projects/<fw>/qa-fixture/reruns/qa-test/<ts>/`; next call to `/api/dashboard/stats` must include it. Delete it; the count returns to baseline.
6. **AI off (default, no Ollama)** — `/api/ai/info` returns `available:false, provider:'null'` with helpful `reason`. Dashboard button reads `AI: OFF`.
7. **AI on (Ollama running with model)** — toggle via POST `/api/ai/toggle {mode:'on'}` returns `ok:true, info.provider:'ollama'`. Dashboard button reads `AI: ON (<model>)`.
8. **Hostile-string XSS** — feed a stats payload where every string field is `<img src=x onerror=window.__pwned=true>`; after render, `window.__pwned` must be `undefined` and there must be 0 `<img>` elements created in any table host.
9. **1000-rerun perf** — rendering 1000 reruns into `All Runs` view completes < 5 s; table is capped at ≤ 100 visible rows.
10. **Memory drift** — 60 polls of `/api/dashboard/live` over 30 s leaves server heap drift < 20 MB.
11. **Recorder regression** — `/` still mounts the recorder UI: `#appTabs`, `#project-dropdown`, `Step Builder`, `Generated Code` strings all present in the body of `/`.
12. **Healer chain (deterministic, no AI)** — feed a simulated rerun where the recorded selector fails but a `data-testid` exists in the snippet; `replay-result.json` shows `healed: true` for that step.

If all 12 pass, the build is correct.

---

## 19. WHAT WAS LEARNED THE HARD WAY (the AI must avoid these traps)

### Trap A — Inline `<script>` blocks (FATAL under our CSP)
Helmet's default CSP is `script-src 'self'` with no `unsafe-inline`. Inline scripts are **silently** dropped — the browser logs a CSP error but nothing else. Symptoms include "the Dashboard tab does nothing when clicked" because the tab-switch handler never bound. **Every** `<script>` in the codebase must be `<script src="/file.js?v=...">`. There is one tab-switcher (`app-tabs.js`), one dashboard (`dashboard.js`), one settings (`settings.js`), one report (`report.js`), one markdown viewer (`markdown-viewer.js`). All same-origin.

### Trap B — `table()` helper crashing on numeric values
Many table columns provide a numeric `key` rather than a `render` function. Naive code does `td.appendChild(value)` which throws when value is a number. The fix is:
```js
if (v == null)                                  td.textContent = '';
else if (typeof v === 'object' && v.nodeType)   td.appendChild(v);
else                                            td.textContent = String(v);
```

### Trap C — Wiping `<main>` on transient stats failure
A naive `.catch()` that does `document.querySelector('main').innerHTML = '<error banner>'` deletes the live header and breaks `pollLive()` (it then can't find `#liveDot`). The correct behavior is a non-blocking toast + setting `#generatedAt = "stats unavailable"`, leaving the rest of the UI alone for the auto-retry interval to recover.

### Trap D — Browser caching the old `dashboard.html`
After making changes, browsers happily serve the cached old file. Always combine: (a) `?v=<token>` query in the iframe `src`, (b) `<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">` in the head, (c) `Cache-Control: public, max-age=0` from Express (default for `express.static`).

### Trap E — `ollama pull` from a foreground shell can be killed
Backgrounded `ollama pull` processes can be reaped when the parent shell exits, even with `disown`. Prefer driving the daemon directly via `POST http://127.0.0.1:11434/api/pull` with `stream:true` — the daemon performs the download in its own process and is unaffected by the curl client dying.

### Trap F — Mistral returns attribute fragment without brackets
The model often replies `data-testid="submit-login"` (no surrounding `[]`). The current `looksLikeSelector()` rejects this. **Future-improvement: wrap bare `attr="value"` patterns in `[ ]` before validating.** Documented but unfixed in this iteration.

### Trap G — Path traversal in HTML report endpoint
`/api/dashboard/report/html?path=../../etc/passwd` must return 400, not 200. Achieved by `decodeReportPath` which `path.resolve`s the user value against `generated-projects/` and verifies the result is a prefix of that root.

### Trap H — `setInterval` keeping jsdom processes alive
The dashboard's three intervals (30 s / 2 s / 15 s) keep Node alive forever in test harnesses. Tests must `process.exit()` after their assertions (not just await jsdom).

---

## 20. DELIVERABLE

When done, the AI must produce:
- A working server that satisfies all 12 acceptance tests.
- A README that points users to `npm install && npm start` and the dashboard at `http://localhost:3000/`.
- A `BUILD_PROMPT.md` (this file) checked in alongside the source so the next AI can refresh from the same spec.
- Optional: a `.github/workflows/` running `npm run lint`, `npm test`, and the Python QA suite under `automation-suite/`.

---

## 21. STYLE / TONE FOR ANY EMITTED CODE

- Comments explain **why**, not what. Every non-obvious heuristic gets a 2-line comment naming the bug-class it defends against.
- ESM throughout (`import`/`export`). No CommonJS in new files.
- Pure functions where possible; service singletons stored in module-level `let _foo = null;` with a `_resetForTests()` escape hatch.
- Errors thrown have a `.name` (e.g. `'NotFoundError'`, `'ValidationError'`) so `errorHandler.js` can map to HTTP status.
- All `console.log` lines start with a `[Tag]` prefix matching the module (e.g. `[AI]`, `[Tabs]`, `[API]`).
- Frontend SVG rendering uses `document.createElementNS('http://www.w3.org/2000/svg', ...)`, never `innerHTML` for SVG.

---

---

## 22. EMAIL SUBSYSTEM (added 2026-05-10)

### Purpose
Send rerun reports and dashboard summaries by email. Optional but
shipped by default because most teams want a "Email this report" button
that just works.

### Local-first guarantee
The service uses `nodemailer` to talk to **whatever SMTP host the user
configures** — could be Gmail (with app password), Outlook/Office 365, a
corporate Exchange relay, an internal Postfix, etc. **No third-party API
calls.** No data leaves the user's network unless they configure an
external SMTP server themselves.

### Configuration (in priority order)
1. **`config/email.json`** — written by the Settings UI. File mode `0600`. **Gitignored** (`config/.gitignore` excludes `email.json` and `*.local.json`).
2. **Env vars**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` (`true|false`), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_TO`. Useful for headless CI / air-gapped installs.
3. **Hard-coded defaults**: `{ host: '', port: 587, secure: false, enabled: false }` → all sends fail-soft with `{ ok: false, error: 'Email is disabled...' }`.

### Files

**`services/emailService.js`** — singleton with these exports:
- `getConfig()` — returns redacted config (`password: '•••'` if set), plus `hasPassword: boolean` and `source: 'file'|'env'|'unset'`.
- `saveConfig(patch)` — validates host (`/^[a-zA-Z0-9.\-_]+$/`), port (1–65535), email-shaped fields (`from`, `to`, accepts comma-separated). Empty `password` keeps the existing one (the UI never round-trips plaintext). Persists with `mode: 0o600`. Returns the redacted view.
- `testConnection()` — uses `transporter.verify()`. Returns `{ ok, message }`.
- `sendMail({ to, cc, bcc, subject, text, html, attachments, from? })` — generic sender. Honors per-call overrides; falls back to config defaults for `from`/`to`. Errors fail-soft as `{ ok: false, error }` (never throws to the route).
- `sendRerunReport({ framework, projectId, testName, timestamp, to?, subject?, note? })` — reads the rerun's `replay-result.json` from `generated-projects/<fw>/<proj>/reruns/<test>/<ts>/`, calls `services/reportRenderer.js#renderHtmlReport`, attaches the resulting self-contained HTML, and includes a structured plain-text summary in the body.
- `sendDashboardSummary({ stats, to?, subject?, note? })` — formats the executive summary in `text/html`, attaches the full JSON snapshot.

The transporter is created per-send (cheap; nodemailer pools internally).

**`routes/email.js`** — mounts six endpoints listed in §6.
- Reads use `generalRateLimiter`; writes/sends use `strictRateLimiter` (15 min / 10 req).
- `/send-dashboard` always re-collects `/api/dashboard/stats` server-side; never trusts client-supplied summary data.

**`public/settings.html` + `settings.js`** — adds an "📧 Email reports" panel with:
- Master enable switch (mirrors `enabled` in config).
- SMTP host / port / TLS-checkbox / username / password (placeholder reads `(unchanged — leave empty to keep)` once a password is set).
- Default From / Default To (comma-separated supported).
- Save / Verify connection / Send test email buttons.
- Status line shows current state (`✓ enabled`, `paused — host configured but switch is off`, `not configured`).

**`public/dashboard.html` + `dashboard.js`** — adds a `📧 Email report` button next to "Export report":
- First fetches `/api/email/config`. If `enabled === false` or `host === ''`, shows a toast `"Email is not configured — open Settings → Email"` and (when embedded as iframe) auto-clicks the parent shell's Settings tab.
- Otherwise POSTs `/api/email/send-dashboard` with a `note: 'Triggered from the ZAC dashboard "Email report" button.'` so the recipient sees clear provenance.

### Subject templates
- Rerun: `[ZAC] PASSED|FAILED — <projectId> / <testName> (<timestamp>)`
- Dashboard: `[ZAC] Dashboard summary — YYYY-MM-DD (<passed>/<total> passed)`

### Security
- Password is **never** sent back to the client. `getConfig()` returns `'•••'` exclusively.
- `config/email.json` is `chmod 0600` and listed in `config/.gitignore`.
- All endpoints use the same Helmet CSP / CORS / rate-limit posture as the rest of the API.
- Validation rejects malformed host/port/email at the API boundary.

### Acceptance criteria additions (extend §18)
13. `GET /api/email/config` returns `{ enabled:false, host:'', hasPassword:false, source:'unset' }` on a fresh install.
14. POSTing a valid config persists to `config/email.json`, returns the redacted view (`password: '•••'`, `hasPassword: true`).
15. POSTing again with `password: ''` does NOT clear the password.
16. `POST /api/email/test` against a working SMTP returns `{ ok: true, message: 'SMTP reachable…' }`.
17. `POST /api/email/send-test` against a working SMTP returns `{ ok: true, messageId: '<...>' }`.
18. `POST /api/email/send-dashboard` re-collects fresh stats server-side and attaches them as JSON.
19. `POST /api/email/send-rerun` for an existing on-disk replay attaches the rendered HTML report.
20. Disable → re-enable round trip preserves `host` and `password`.
21. Settings page shows the email panel with all 6 fields + 3 buttons; the dashboard shows the "📧 Email report" button.
22. Invalid port (e.g. `99999`) and invalid email (e.g. `not-an-email`) are rejected at the API boundary with HTTP 4xx.

### Known limitations
- No HTML-template engine — we emit a `<pre>` block plus an attachment. Sufficient for QA digests; an HTML newsletter generator is future work.
- No queueing / retry — a transient SMTP outage returns `ok: false` and the user retries manually. A background queue using `node-persist` or similar would be a clean enhancement but adds state-management complexity.
- No PDF rendering server-side — the same "HTML → File → Print → Save as PDF" path applies (rerun HTML report is print-clean).

---

> End of build spec. Anything not specified here is fair game for the implementing AI to invent — but the §18 + §22 acceptance tests must still pass.
