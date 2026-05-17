# ZAC `automation-suite`

Production-grade QA suite for the **Zero-Code Automation IDE** (ZAC v2.x).
Now covers **20 modules** across every test layer.

Layers covered:

- **API** (`requests` + light JSON Schema contract) - positive / negative / edge
- **WebSocket** (`/api/recording/:id` ping/pong, drain, close-1008)
- **UI / E2E** (Playwright + POM + self-healing locator chain)
- **Accessibility** (axe-core, WCAG 2.1 AA)
- **Visual regression** (Playwright snapshot)
- **Security** (Helmet headers, CORS allow-list, rate limit, input validation, MIME)
- **Performance** (k6, p95 SLOs)
- **JS unit** (`node:test` for `models/*` + `generators/gherkin.js`)
- **Self-healing** (ZAC `HealerEngine` + per-suite YAML)

All tests are atomic, independent, idempotent, smart-waited, parametrized
where useful, and fully wired into Allure + GitHub Actions.

See **`reports/coverage/_index.md`** for the master matrix.

---

## Layout

```
automation-suite/
├── conftest.py
├── pytest.ini                 # markers (one per module) + retries + allure
├── requirements.txt
├── .env.example
├── pages/                     # POMs for UI-bearing modules
│   ├── base_page.py
│   ├── project_management_page.py
│   ├── recording_session_page.py
│   ├── browser_selection_page.py
│   ├── recording_assertions_page.py
│   └── docs_viewer_page.py
├── tests/
│   ├── api/                   # 14 API test modules
│   ├── ui/                    # 4 UI test modules
│   ├── accessibility/         # axe-core scans
│   ├── visual/                # snapshot diffs
│   └── security/              # CORS / Helmet / rate limit / input validation
├── unit-js/                   # node --test (models + generators)
├── perf/                      # k6 scripts
├── fixtures/                  # one YAML per module
├── healer/                    # one YAML per UI-bearing module
├── utils/
│   ├── api_client.py          # full /api/* surface
│   ├── ws_client.py           # /api/recording/:id WS helpers
│   ├── locator_strategy.py
│   ├── healer_engine.py
│   ├── retry.py
│   ├── logger.py
│   ├── cmd_check.py           # skips on missing mvn/npm/k6
│   └── sample_files.py        # generates SRS/empty/binary fixtures at runtime
└── reports/
    ├── allure-results/        # runtime
    ├── healer/                # runtime
    └── coverage/              # _index.md + one per module
```

CI lives at `.github/workflows/qa-suite.yml` (matrix over module x lane x browser).
The original `qa-project-management.yml` is kept as a per-module reference lane.

---

## Quick start

```bash
# 1. start the ZAC server (separate shell, from repo root)
npm install
npm start                # serves http://localhost:3000

# 2. install + run the suite
cd automation-suite
cp .env.example .env
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install --with-deps

# Smoke (cheap)
pytest -m smoke

# Full module
pytest -m project_management

# Single lane within a module
pytest -m "recording_session and websocket"
pytest -m "code_export and negative"

# JS unit lanes (no Python required)
node --test unit-js
```

## Selecting test lanes

```bash
pytest -m "smoke"                              # critical lane only
pytest -m "api"                                # all API tests
pytest -m "ui" --browser chromium              # UI only
pytest -m "accessibility"                      # WCAG scans
pytest -m "visual"                             # snapshot diffs
pytest -m "security and not flaky_quarantine"  # security gates
pytest -m "websocket"                          # /api/recording/:id WS
pytest -m "negative or edge"                   # robustness sweep
pytest -m "requires_mvn or requires_npm"       # only-when-tool-on-PATH
```

## Updating visual baselines

```bash
pytest tests/visual --update-snapshots
git add tests/visual/__snapshots__
```

## Healer report

After every run the engine writes `reports/healer/<module>.suggest.md`
listing locators that resolved via fallback. Promote those fallbacks to
`primary` in `pages/<module>_page.py` to stabilise the suite.

## Module index

| Module               | Has POM | Has WS | Markers                              |
| -------------------- | ------- | ------ | ------------------------------------ |
| project_management   | ✓       |        | `project_management`                 |
| step_builder         |         |        | `step_builder`                       |
| code_export          |         |        | `code_export`                        |
| test_runner          |         |        | `test_runner`                        |
| locators             |         |        | `locators`                           |
| reusable_flows       |         |        | `reusable_flows`                     |
| test_data            |         |        | `test_data`                          |
| environments         |         |        | `environments`                       |
| requirements_parser  |         |        | `requirements_parser`                |
| test_case_generator  |         |        | `test_case_generator`                |
| append_steps         |         |        | `append_steps`                       |
| maven_runner         |         |        | `maven_runner` + `requires_mvn`      |
| npm_runner           |         |        | `npm_runner` + `requires_npm`        |
| storage              |         |        | `storage`                            |
| recording_session    | ✓       | ✓      | `recording_session` + `websocket`    |
| browser_selection    | ✓       |        | `browser_selection`                  |
| recording_assertions | ✓       |        | `recording_assertions`               |
| docs_viewer          | ✓       |        | `docs_viewer`                        |
| domain_models        |         |        | (`unit-js` lane)                     |
| scenario_outline     |         |        | (`unit-js` lane)                     |
| lifecycle            |         |        | `lifecycle`                          |

## Scaffolding a new module

Use any existing module as a template. For each new feature produce these
six artefacts in order:

1. `pages/<module>_page.py`               - Page Object + LocatorStrategy chain (UI only)
2. `tests/<layer>/test_<module>.py`        - positive + negative + edge
3. `fixtures/<module>.yaml`                - parametrize-friendly data
4. `healer/<module>.healer.yaml`           - HealerEngine config (UI only)
5. Add the marker name to `pytest.ini` and the matrix in
   `.github/workflows/qa-suite.yml`
6. `reports/coverage/<module>.entry.md`    - coverage matrix
