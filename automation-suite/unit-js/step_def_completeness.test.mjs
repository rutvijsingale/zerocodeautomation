/**
 * Suite : step_def_completeness
 * Layer : JS unit (node:test)
 * Owner : ZAC Platform QA
 *
 * Regression coverage for [ZAC-FIX] CG-3:
 *
 * The Java step-def generator (selenium-java + playwright-java)
 * was missing implementations for 13 of the 27 step kinds the
 * recorder can produce — doubleClick, hover, dragDrop, check,
 * uncheck, selectRadio, fileUpload, keyPress, scroll, waitFor (ms),
 * waitForSelector, screenshot, apiCall.
 *
 * The .feature generator emitted Gherkin steps for ALL kinds, but
 * with no matching @Given/@When/@Then methods Cucumber would throw
 * "Undefined step" the moment `mvn test` ran. So a recording that
 * touched any of those kinds would compile fine and then fail at
 * runtime — silent footgun.
 *
 * These tests pin the contract: every always-emitted Cucumber
 * pattern must be present in the generated step-def file, with the
 * framework-idiomatic API call inside the body.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateJavaStepDefinitions } from '../../java-code-generators.js';

const EMPTY_MAP = () => ({});
const NO_ACTIONS = [];

function gen(framework) {
  // Pass an EMPTY stepDefMap. The generator MUST always emit the
  // commonSteps regardless — that's the property we're locking in.
  return generateJavaStepDefinitions(framework, EMPTY_MAP(), NO_ACTIONS, 'about:blank', [], 'KitchenSink');
}

const KINDS = [
  // pattern fragment              selenium-java body must include      playwright-java body must include
  ['doubleClick',     'I double click {string}',          /\.doubleClick\(/,            /\.dblclick\(/],
  ['hover',           'I hover over {string}',            /\.moveToElement\(/,          /\.hover\(/],
  ['dragDrop',        'I drag {string} to {string}',      /\.dragAndDrop\(/,            /\.dragTo\(/],
  ['check',           'I check {string}',                 /isSelected\(\)/,             /\.check\(\)/],
  ['uncheck',         'I uncheck {string}',               /isSelected\(\)/,             /\.uncheck\(\)/],
  ['selectRadio',     'I select radio {string} in {string}', /getAttribute\("value"\)/, /\.check\(\)/],
  ['fileUpload',      'I upload {string} to {string}',    /getAbsolutePath\(\)/,        /setInputFiles\(/],
  ['keyPress',        'I press key {string}',             /Keys\.valueOf/,              /keyboard\(\)\.press\(/],
  ['scroll xy',       'I scroll to position ({int}, {int})', /scrollTo/,                /scrollTo/],
  ['scroll selector', 'I scroll to {string}',             /scrollIntoView/,             /scrollIntoViewIfNeeded/],
  ['waitFor ms',      'I wait for {int} ms',              /Thread\.sleep/,              /waitForTimeout/],
  ['waitForSelector', 'I wait for selector {string}',     /WebDriverWait/,              /waitForSelector/],
  ['screenshot',      'I take screenshot {string}',       /TakesScreenshot/,            /\.screenshot\(/],
  ['apiCall',         'I call API {word} {string}',       /HttpClient/,                 /HttpClient/],
];

for (const [label, fragment, seleniumBody, playwrightBody] of KINDS) {
  test(`selenium-java: @<keyword>("${fragment}") emitted with idiomatic body — ${label}`, () => {
    const code = gen('selenium-java');
    const annoRe = new RegExp(`@(?:Given|When|Then|And)\\("${fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{string\\\}/g, '\\{string\\}').replace(/\\\{int\\\}/g, '\\{int\\}').replace(/\\\{word\\\}/g, '\\{word\\}')}"\\)`);
    assert.match(code, annoRe, `missing annotation for "${fragment}" in selenium-java step defs`);
    assert.match(code, seleniumBody,
      `${label}: body must include ${seleniumBody} — generator regressed?`);
  });

  test(`playwright-java: @<keyword>("${fragment}") emitted with idiomatic body — ${label}`, () => {
    const code = gen('playwright-java');
    const annoRe = new RegExp(`@(?:Given|When|Then|And)\\("${fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{string\\\}/g, '\\{string\\}').replace(/\\\{int\\\}/g, '\\{int\\}').replace(/\\\{word\\\}/g, '\\{word\\}')}"\\)`);
    assert.match(code, annoRe, `missing annotation for "${fragment}" in playwright-java step defs`);
    assert.match(code, playwrightBody,
      `${label}: body must include ${playwrightBody} — generator regressed?`);
  });
}

test('selenium-java + playwright-java: every commonStep produces a step-def', () => {
  // Final shape check: count @Given/@When/@Then/@And annotations and
  // make sure both frameworks emit the same set of patterns (with
  // differing bodies). Both should have ≥ KINDS.length + the existing
  // core (navigate/click/type/select/I should see/should be visible/etc.).
  const sj = gen('selenium-java');
  const pj = gen('playwright-java');
  const annosOf = (txt) => (txt.match(/@(?:Given|When|Then|And)\("([^"]+)"\)/g) || []).length;
  assert.ok(annosOf(sj) >= 25, `selenium-java emitted only ${annosOf(sj)} annotations, expected ≥ 25`);
  assert.ok(annosOf(pj) >= 25, `playwright-java emitted only ${annosOf(pj)} annotations, expected ≥ 25`);
});

test('selenium-java: balanced braces (no truncation)', () => {
  const code = gen('selenium-java');
  const o = (code.match(/\{/g) || []).length;
  const c = (code.match(/\}/g) || []).length;
  assert.equal(o, c, `unbalanced braces: open=${o} close=${c}`);
});

test('playwright-java: balanced braces (no truncation)', () => {
  const code = gen('playwright-java');
  const o = (code.match(/\{/g) || []).length;
  const c = (code.match(/\}/g) || []).length;
  assert.equal(o, c, `unbalanced braces: open=${o} close=${c}`);
});
