/**
 * Suite : page_objects_playwright_java
 * Layer : JS unit (node:test)
 * Owner : ZAC Platform QA
 *
 * Regression coverage for [ZAC-FIX] BUG-CG-1.
 *
 * Before the fix, the playwright-java framework had no Java page-object
 * generator — generateAllPageObjects() routed it to the playwright-ts
 * generator (TypeScript), and the route then wrote the result into a
 * file named `${pageName}Page.java`. The output looked like:
 *
 *     // TextBoxPage.java
 *     import { Page, Locator } from '@playwright/test';
 *     export class TextBoxPage { … }
 *
 * That cannot compile as Java, so every playwright-java project was
 * silently broken at the page-object layer. Step definitions
 * concurrently emit `import pages.TextBoxPage;` plus
 * `new TextBoxPage(getPage())`, so we also need to verify the
 * (Page page) constructor exists.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateAllPageObjects,
  generatePlaywrightJavaPageObject,
} from '../../generators/pageObjects.js';

const SAMPLE_LOCATORS = [
  { elementName: 'fullName',  locatorType: 'css', locatorValue: '#userName'  },
  { elementName: 'email',     locatorType: 'css', locatorValue: '#userEmail' },
  { elementName: 'submitBtn', locatorType: 'css', locatorValue: '#submit'    },
];

test('playwright-java page object: real Java content (no TypeScript leak)', () => {
  const code = generatePlaywrightJavaPageObject('TextBox', SAMPLE_LOCATORS);
  // Must NOT contain TypeScript-only constructs.
  assert.ok(!code.includes("import { Page"),
    'TS-style "import { Page ... } from ..." leaked into Java page object');
  assert.ok(!code.includes("import { Locator"),
    'TS-style "import { Locator ... }" leaked into Java page object');
  assert.ok(!/^\s*export\s+class\b/m.test(code),
    'TS "export class" leaked into Java page object');
});

test('playwright-java page object: package + Java imports + class shape', () => {
  const code = generatePlaywrightJavaPageObject('TextBox', SAMPLE_LOCATORS);
  assert.match(code, /^package pages;/m);
  assert.match(code, /import com\.microsoft\.playwright\.Page;/);
  assert.match(code, /import com\.microsoft\.playwright\.Locator;/);
  assert.match(code, /import static support\.PlaywrightWorld\.getPage;/);
  assert.match(code, /public class TextBoxPage \{/);
});

test('playwright-java page object: BOTH constructors (no-arg + Page-arg)', () => {
  // Generated step definitions emit `new TextBoxPage(getPage())`, so
  // the (Page page) constructor MUST exist. We also keep a no-arg
  // constructor for callers that prefer the static accessor.
  const code = generatePlaywrightJavaPageObject('TextBox', SAMPLE_LOCATORS);
  assert.match(code, /public TextBoxPage\(\)\s*\{/,        'no-arg constructor missing');
  assert.match(code, /public TextBoxPage\(Page page\)\s*\{/, '(Page page) constructor missing');
});

test('playwright-java page object: one Locator getter per recorded element', () => {
  const code = generatePlaywrightJavaPageObject('TextBox', SAMPLE_LOCATORS);
  for (const loc of SAMPLE_LOCATORS) {
    const re = new RegExp(`public Locator ${loc.elementName}\\(\\)\\s*\\{`);
    assert.match(code, re, `getter for ${loc.elementName} missing`);
    // And the actual recorded selector should appear inside that getter.
    assert.ok(code.includes(loc.locatorValue),
      `locator value ${loc.locatorValue} not embedded in page object`);
  }
});

test('playwright-java page object: balanced braces (no truncation)', () => {
  const code = generatePlaywrightJavaPageObject('TextBox', SAMPLE_LOCATORS);
  const open = (code.match(/\{/g) || []).length;
  const close = (code.match(/\}/g) || []).length;
  assert.equal(open, close, `unbalanced braces — open=${open} close=${close}`);
});

test('generateAllPageObjects routes playwright-java to the Java generator', () => {
  // Map shape used by the route: { pageName: { elementName: { selector, type } } }
  const map = {
    TextBox: {
      fullName:  { selector: '#userName',  type: 'css' },
      submitBtn: { selector: '#submit',    type: 'css' },
    },
  };
  const out = generateAllPageObjects(map, 'playwright-java');
  assert.ok(out.TextBox, 'TextBox page object missing from output map');
  // Must look like Java (package keyword), NOT TypeScript (`export class`).
  assert.match(out.TextBox, /^package pages;/m);
  assert.ok(!out.TextBox.includes("import { Page"),
    'playwright-java still falling through to playwright-ts generator');
});

test('generateAllPageObjects: selenium-java still uses Selenium FindBy generator', () => {
  // Sanity: the dispatch table didn't break the existing Selenium path.
  const map = { Login: { user: { selector: '#u', type: 'css' } } };
  const out = generateAllPageObjects(map, 'selenium-java');
  assert.match(out.Login, /@FindBy\(/);
  assert.match(out.Login, /import org\.openqa\.selenium\.WebDriver/);
});

test('generateAllPageObjects: playwright-ts still uses TypeScript generator', () => {
  const map = { Login: { user: { selector: '#u', type: 'css' } } };
  const out = generateAllPageObjects(map, 'playwright-ts');
  assert.match(out.Login, /import \{ Page, Locator \} from '@playwright\/test'/);
  assert.match(out.Login, /export class LoginPage/);
});
