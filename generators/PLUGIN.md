# Generator Plugin Contract

ZAC's framework support is plugin-based. The recorder, locator engine, healer,
test plan generator, and dashboard are framework-agnostic — they only know
about an opaque `framework` id. A *generator plugin* is what turns a recorded
session into runnable code in a specific language + runner combination.

This document is the contract a new plugin must honor. Implement these and
ZAC will surface the framework in the UI dropdown, route generation requests
to your plugin, and persist artifacts under
`generated-projects/<framework-id>/<project-name>/` automatically — no core
changes required for additional plugins beyond the registry entry and the
dispatch wiring described below.

---

## 1. Lifecycle & where you fit

```
┌─────────────┐   recorded-steps.json   ┌─────────────────┐  files written  ┌──────────────────────┐
│  Recorder   │ ──────────────────────► │  Your Plugin    │ ──────────────► │  generated-projects/ │
│ (browser)   │                          │ (this contract) │                  │  <fw>/<proj>/...     │
└─────────────┘                          └─────────────────┘                  └──────────────────────┘
                                                  ▲
                                                  │ also called by
                                                  │
                                          /api/rerun  (to regenerate code before replay)
                                          /api/save   (when the user saves a project)
                                          /api/test-plan/generate (to refresh artifacts)
```

You receive a normalized step list and metadata. You produce file content
(strings) keyed by relative path. The dispatcher writes them.

---

## 2. The registry entry

Every plugin must add an entry to `config/frameworks.json`:

```json
{
  "id": "selenium-testng",
  "label": "Selenium WebDriver + Java + TestNG",
  "language": "java",
  "runner": {
    "command": "mvn clean test",
    "cwd": "."
  },
  "conventions": {
    "testDir": "src/test/java",
    "mainDir": "src/main/java",
    "resourcesDir": "src/test/resources",
    "configFiles": ["pom.xml", "src/test/resources/testng.xml"]
  },
  "uiVisible": true
}
```

Field rules (enforced by `services/projectLayout.js`):

| field         | required | notes |
|---------------|----------|-------|
| `id`          | yes      | lowercase, kebab-case, must be unique |
| `aliases`     | no       | alternate ids accepted by the API (`["playwright", "playwright-ts"]`) |
| `label`       | yes      | human-readable; appears in the UI dropdown |
| `language`    | yes      | `java`, `typescript`, `javascript`, `python`, … |
| `runner`      | yes      | `{ command, cwd }` — string template, no shell expansion |
| `conventions` | yes      | path roots; used by the layout scaffolder |
| `uiVisible`   | no       | default true; set false for experimental frameworks |

If your plugin lists a framework here that has no corresponding code emitter,
the dispatcher will refuse generation with HTTP 400 and the existing CI
backtest (`scripts/backtest-framework-layout.mjs`) will fail. This is by
design — you cannot land a half-finished plugin.

---

## 3. The plugin module

A generator plugin is an ES module under `generators/<framework-id>.js`
(or a folder with `index.js`) that exports the following surface:

```js
/**
 * @param {GenerateContext} ctx
 * @returns {Promise<GenerateResult>}
 */
export async function generateProject(ctx) { ... }
```

### `GenerateContext` (input)

```ts
type GenerateContext = {
  projectName: string;             // sanitized; safe as a path segment
  projectId: string | null;        // canonical project id, or null for legacy export
  framework: string;               // e.g. "selenium-testng" — your id
  baseUrl: string;                 // initial URL the recorded flow opens with
  browserType: "chromium" | "firefox" | "webkit" | "edge";

  // The recorded session, normalised into Step[]:
  steps: Step[];
  scenarios?: Scenario[];          // optional multi-scenario layout
  backgroundSteps?: Step[];        // optional Background block
  tags?: string[];                 // feature-level tags
  featureName?: string;
  featureTitle?: string;

  // Locators captured during recording — your code SHOULD prefer these
  // over re-deriving from step.selector since they include alternates +
  // confidence scores from the locator engine.
  locators?: LocatorMap;           // { [pageName]: { [elementName]: LocatorDefinition } }

  // Where to write. Use these — never assemble your own paths.
  paths: {
    projectRoot: string;           // generated-projects/<framework>/<project>/
    testsDir: string;
    pagesDir: string;
    locatorsDir: string;
    configDir: string;
    utilsDir: string;
  };
};
```

### `GenerateResult` (output)

```ts
type GenerateResult = {
  // Files to write, keyed by RELATIVE path under paths.projectRoot.
  // The dispatcher writes them; your plugin must NOT touch the filesystem
  // directly. This makes the plugin pure and unit-testable.
  files: { [relativePath: string]: string };

  // Optional: paths to surface to the UI (so the user can click them).
  // Each must be relative to paths.projectRoot.
  surfaced?: {
    runnerEntryPoint?: string;     // e.g. "pom.xml" or "package.json"
    primaryTestFile?: string;      // e.g. "src/test/java/AmazonE2ETest.java"
    readme?: string;
  };

  // Optional: a list of post-write shell commands the dispatcher MAY run
  // (e.g. `mvn -q dependency:resolve`). Currently informational only —
  // the dispatcher logs but does not execute these.
  postWrite?: string[];
};
```

### Plugin contract — hard rules

1. **Pure.** No filesystem writes, no network, no global state. The dispatcher
   handles persistence so your plugin is unit-testable as a pure function.
2. **Deterministic.** Same input → same output bytes. The dashboard's "diff
   between reruns" view depends on this.
3. **No credentials in output.** Use `${ENV_VAR}` placeholders. The framework's
   `utils/credentialResolver.js` resolves them at execution time and masks
   them in logs.
4. **No absolute XPath.** The locator engine never emits one; your plugin
   must not invent one either. Scored & enforced by
   `automation-suite/unit-js/locator_quality_contract.test.mjs`.
5. **Honor `paths.*`.** Never assemble your own — sanitization lives in
   `services/projectLayout.js`. Cross-OS path safety is the dispatcher's
   responsibility, not yours.

---

## 4. The dispatcher hook

Once your plugin is written, register it in two places:

1. `routes/api.js` — locate the framework dispatch (search for
   `framework === 'playwright-java'`) and add your branch:

   ```js
   } else if (framework === 'selenium-testng') {
     const plugin = await import('../generators/selenium-testng.js');
     const result = await plugin.generateProject(ctx);
     await writeAll(paths.projectRoot, result.files);
   }
   ```

2. `services/projectLayout.js` — no changes needed; the layout scaffolder
   reads from `config/frameworks.json` automatically.

---

## 5. Test surface every plugin must add

Place tests under `automation-suite/unit-js/<framework-id>.test.mjs`. The
existing `record_to_generate.test.mjs` is the template. At minimum:

| Test | What it must assert |
|------|---------------------|
| `<fw>: feature/test file is generated` | the runner entry file exists in `result.files` and parses as the expected language |
| `<fw>: every recorded interactive step yields a corresponding step in the test` | step count matches |
| `<fw>: locators include primary + ≥1 alternate` | uses `services/locatorService.js` |
| `<fw>: ${ENV} placeholders pass through verbatim` | no credential leak |
| `<fw>: generated project compiles a no-op page object class` | shape, not full compile |

The CI backtest harness `scripts/backtest-all-frameworks.cjs` calls each
plugin end-to-end via the live server and asserts the output tree matches
`config/frameworks.json#conventions`. Adding a plugin without updating the
backtest fails CI by design.

---

## 6. Reference plugins

| ID | File | Notes |
|----|------|-------|
| `playwright-java` | `generators/playwright.js` + `java-code-generators.js` | Cucumber + Playwright Java; reference for Java BDD |
| `selenium-java`   | `java-code-generators.js` (selenium branch)             | Cucumber + Selenium WebDriver Java |
| `playwright-typescript` | `generators/steps_ts_template.js` + `generators/playwright.js` | Cucumber + Playwright TS |

When adding a new plugin, copy the closest reference and modify in place.
Do **not** start from scratch — you'll inevitably drift from the locator
engine's contract and break the healer.

---

## 7. Adding a new framework — checklist

1. ☐ Add registry entry to `config/frameworks.json`.
2. ☐ Write `generators/<framework-id>.js` exporting `generateProject(ctx)`.
3. ☐ Add unit test file `automation-suite/unit-js/<framework-id>.test.mjs`.
4. ☐ Wire dispatch branch in `routes/api.js` (search for `framework === 'playwright-java'`).
5. ☐ Add backtest case to `scripts/backtest-all-frameworks.cjs`.
6. ☐ Run `npm run test:unit` — must stay green.
7. ☐ Run `ZAC_BASE=http://localhost:3000 node scripts/backtest-framework-layout.mjs` — must stay green.
8. ☐ Run `ZAC_BASE=http://localhost:3000 BASE_URL=http://localhost:3000 node scripts/backtest-all-frameworks.cjs` — must include your new framework.
9. ☐ Update `automation-suite/reports/QA-SIGNOFF-*.md` framework list.

If any step fails, stop. The framework registry treats half-implemented
plugins as a hard error.
