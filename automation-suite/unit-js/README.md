# Domain-model & generator unit tests (JS)

These tests run against the **server-side JS** code directly (no HTTP, no
Playwright). They use Node's built-in test runner (`node --test`) so they
have **zero** new npm dependencies and can run in CI in milliseconds.

## Local run

```bash
# from repo root
npm install
node --test automation-suite/unit-js
```

## Reporting

The TAP output is captured by the unified `qa-suite.yml` workflow as
`unit-js-tap.log` and uploaded as an artifact for triage.
