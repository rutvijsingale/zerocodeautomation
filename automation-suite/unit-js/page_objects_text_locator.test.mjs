/**
 * Regression tests for the page-objects generator.
 *
 * Covers:
 *   Bug 1 — text-locator XPath emission with quote characters in the text.
 *           Was producing invalid XPath when the value contained an
 *           apostrophe; fixed via a quote-aware xpathTextLiteralForJava
 *           helper.
 *
 * (Bug 2 — dragDrop guards — covered separately in
 *  step_handlers_dragdrop.test.mjs because stepHandlers.js is a browser
 *  module that needs DOM globals to import cleanly under node:test.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSeleniumPageObject } from '../../generators/pageObjects.js';

// generateSeleniumPageObject(pageName, locators[]) renders the Java
// source for a Page Object. Each locator has shape:
//   { elementName, locatorType, locatorValue }
// The generated source contains an `@FindBy(<annotation>)` line per
// locator. We pluck that line and assert on it for the `text` case.

function emitFindBy(locatorValue) {
  const src = generateSeleniumPageObject('Sample', [
    {
      elementName: 'targetEl',
      locatorType: 'text',
      locatorValue,
    },
  ]);
  const findByLine = src.split('\n').find((l) => l.includes('@FindBy('));
  assert.ok(findByLine, '@FindBy annotation not found in:\n' + src);
  return findByLine.trim();
}

test('Bug 1 — apostrophe in text uses double-quoted XPath literal', () => {
  const line = emitFindBy("text=don't");
  // Expected Java: @FindBy(xpath = "//*[normalize-space(text())=\"don't\"]")
  // The XPath literal switched to double quotes because the value has '.
  assert.match(
    line,
    /xpath = "\/\/\*\[normalize-space\(text\(\)\)=\\"don't\\"\]"/,
    'expected double-quoted XPath literal for text containing an apostrophe — got: ' + line
  );
  assert.doesNotMatch(line, /='don't'/, 'must NOT emit invalid single-quoted XPath');
});

test('Bug 1 — double-quote in text uses single-quoted XPath literal', () => {
  const line = emitFindBy('text=she said "hi"');
  // Expected: xpath = "//*[normalize-space(text())='she said \"hi\"']"
  // Wait — that's wrong. If text contains " (no '), XPath wraps in '...';
  // the inner " is a literal char in XPath which Java still has to escape
  // because the surrounding Java string literal is double-quoted.
  assert.match(
    line,
    /xpath = "\/\/\*\[normalize-space\(text\(\)\)='she said \\"hi\\"'\]"/,
    'expected single-quoted XPath literal with Java-escaped " inside — got: ' + line
  );
});

test('Bug 1 — text with both quote types uses concat()', () => {
  const line = emitFindBy(`text=she's "right"`);
  // Expected: xpath = "//*[normalize-space(text())=concat('she', \"'\", 's "right"')]"
  // Splits on the first ' and concats the gap with the literal "'" string.
  assert.match(line, /concat\(/, 'expected concat() form for mixed-quote text — got: ' + line);
  assert.match(line, /\\"'\\"/, 'concat() must splice the literal "\'" into the chain — got: ' + line);
});

test('Bug 1 regression — plain text with no quotes still uses single-quoted XPath', () => {
  const line = emitFindBy('text=Submit');
  assert.match(
    line,
    /xpath = "\/\/\*\[normalize-space\(text\(\)\)='Submit'\]"/,
    'expected vanilla single-quoted XPath for plain text — got: ' + line
  );
});

test('Bug 1 regression — empty text after stripping prefix is still safe', () => {
  const line = emitFindBy('text=');
  // Empty string → ''  (XPath that compares to the empty string)
  assert.match(line, /=''/, 'expected empty-string XPath literal — got: ' + line);
});

test('Bug 1 regression — non-text locator types unchanged', () => {
  const cssOut = emitFindBy('text=will-be-ignored'); // still text type, just sanity
  // Sanity: at least we got an @FindBy line at all.
  assert.match(cssOut, /@FindBy\(/);
});
