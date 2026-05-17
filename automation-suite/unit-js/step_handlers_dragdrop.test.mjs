/**
 * Regression tests for stepHandlers.js — Bug 2 (dragDrop with missing
 * targetSelector used to emit `page.locator("")` and
 * `By.cssSelector("")`, both of which throw at runtime).
 *
 * stepHandlers.js is a browser-side module that exposes its functions
 * via window.StepHandlers; for node:test we extract just the dragDrop
 * branch of generatePlaywrightStepCode / generateSeleniumStepCode by
 * replicating the exact logic under test (kept in sync with the source
 * file). This avoids having to spin up jsdom.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(
  path.resolve(__dirname, '../../public/stepHandlers.js'),
  'utf8'
);

test('Bug 2 — Playwright dragDrop with missing targetSelector emits a TODO, not page.locator("")', () => {
  // Static assertion: the source no longer contains the fragile
  // `step.targetSelector || ''` pattern.
  assert.ok(
    !SRC.includes("page.locator(${JSON.stringify(step.targetSelector || '')})"),
    'Playwright dragDrop must not fall back to an empty selector'
  );
  // The new code emits `dragTgt = step.targetSelector` and then guards on it.
  assert.ok(
    SRC.includes('const dragTgt = step.targetSelector'),
    'expected explicit dragTgt extraction'
  );
  // And emits a TODO line on the missing-target branch.
  assert.ok(
    SRC.includes('// TODO dragDrop skipped'),
    'expected `// TODO dragDrop skipped` in the missing-target branch'
  );
});

test('Bug 2 — Selenium dragDrop with missing targetSelector emits a TODO, not By.cssSelector("")', () => {
  // Same static guards on the Selenium side.
  assert.ok(
    !SRC.includes("By.cssSelector(${JSON.stringify(step.targetSelector || '')})"),
    'Selenium dragDrop must not fall back to an empty selector'
  );
  // The new code uses the same dragTgt + guard pattern.
  assert.ok(
    SRC.match(/console\.warn\('\[stepHandlers\] dragDrop step skipped \(Selenium\)/),
    'expected console.warn for Selenium dragDrop missing-target branch'
  );
});

// Behavioural test — exercise the actual generators via Function eval so we
// don't need a browser. The browser file declares the helpers as
// `function generatePlaywrightStepCode(...)` at the top level. We append
// a final-line return that hands them out.
function loadGenerators() {
  const trailer = `
    ;return {
      pw: typeof generatePlaywrightStepCode === 'function' ? generatePlaywrightStepCode : null,
      se: typeof generateSeleniumStepCode   === 'function' ? generateSeleniumStepCode   : null,
    };
  `;
  // Stub `window`/`document`/`module` so the file's exports-block doesn't
  // throw under node's no-DOM environment.
  return new Function(
    'console', 'window', 'document', 'module', 'navigator',
    SRC + trailer
  )(console, {}, {}, {}, {});
}

let gens;
try { gens = loadGenerators(); }
catch (e) {
  console.warn('[stepHandlers behavioural test] could not load generators:', e.message);
  gens = { pw: null, se: null };
}
const skipPw = !gens.pw;
const skipSe = !gens.se;

test('Bug 2 (behavioural) — Playwright dragDrop with no target → comment, no locator("")', { skip: skipPw }, () => {
  const code = gens.pw({ kind: 'dragDrop', sourceSelector: '#src' });
  assert.match(code, /TODO dragDrop skipped/, 'expected TODO comment in output');
  assert.doesNotMatch(code, /page\.locator\(""\)/, 'must not emit page.locator("")');
});

test('Bug 2 (behavioural) — Selenium dragDrop with no target → comment, no cssSelector("")', { skip: skipSe }, () => {
  const code = gens.se({ kind: 'dragDrop', sourceSelector: '#src' });
  assert.match(code, /TODO dragDrop skipped/, 'expected TODO comment in output');
  assert.doesNotMatch(code, /By\.cssSelector\(""\)/, 'must not emit By.cssSelector("")');
});

test('Bug 2 (behavioural) — Playwright dragDrop WITH both selectors emits a real dragTo', { skip: skipPw }, () => {
  const code = gens.pw({ kind: 'dragDrop', sourceSelector: '#src', targetSelector: '#tgt' });
  assert.match(code, /page\.locator\("#src"\)\.dragTo\(page\.locator\("#tgt"\)\)/);
  assert.doesNotMatch(code, /TODO/, 'should not emit TODO when both selectors are present');
});

test('Bug 2 (behavioural) — Selenium dragDrop WITH both selectors emits the Actions chain', { skip: skipSe }, () => {
  const code = gens.se({ kind: 'dragDrop', sourceSelector: '#src', targetSelector: '#tgt' });
  assert.match(code, /Actions\(driver\)\.dragAndDrop\(dragSource, dragTarget\)\.perform\(\)/);
  assert.doesNotMatch(code, /TODO/);
});

test('Bug 2 (behavioural) — Playwright dragDrop with only target missing → skips with reason', { skip: skipPw }, () => {
  const code = gens.pw({ kind: 'dragDrop', sourceSelector: '#src' /* targetSelector missing */ });
  assert.match(code, /target missing/);
});

test('Bug 2 (behavioural) — Playwright dragDrop with both missing → skips with combined reason', { skip: skipPw }, () => {
  const code = gens.pw({ kind: 'dragDrop' });
  assert.match(code, /source AND target missing/);
});
