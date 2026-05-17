/**
 * Contract tests for BDD tag handling in the Gherkin generator.
 *
 * Hard contracts under test:
 *   - Feature-level tags (e.g. @smoke @regression) are emitted on the
 *     line immediately above `Feature:` so Cucumber tag filters
 *     (`--tags @smoke`) can target them.
 *   - Scenario-level tags are emitted on the line immediately above
 *     `Scenario:` / `Scenario Outline:`.
 *   - Tags must be preserved verbatim — no rewriting of `@smoke` to
 *     `smoke`, no case normalisation. Cucumber matches them literally.
 *   - When multiple scenarios are emitted in one feature, EACH scenario
 *     keeps its own tag set independently (no leakage between scenarios).
 *   - Steps inside a tagged scenario inherit the tag (asserted indirectly
 *     by checking the tag still appears at scenario level after generation).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateFeatureFile } from '../../generators/gherkin.js';

test('feature-level tags are emitted above the Feature: line', () => {
  const out = generateFeatureFile({
    featureName: 'Login',
    featureTitle: 'Successful login',
    tags: ['@smoke', '@auth'],
    steps: [{ kind: 'navigate', url: 'https://example.com' }],
  });
  const lines = out.split('\n');
  const featureLineIdx = lines.findIndex((l) => l.startsWith('Feature:'));
  assert.ok(featureLineIdx > 0, 'Feature: line must exist and not be the first line when tags are present');
  // The line above Feature: is the tag line.
  assert.match(lines[featureLineIdx - 1], /@smoke/);
  assert.match(lines[featureLineIdx - 1], /@auth/);
});

test('scenario-level tags are emitted above the Scenario: line', () => {
  const out = generateFeatureFile({
    featureName: 'Checkout',
    scenarios: [
      {
        title: 'Add to cart',
        tags: ['@regression', '@cart'],
        steps: [{ kind: 'click', selector: '#add-to-cart' }],
      },
    ],
  });
  const lines = out.split('\n').map((l) => l.trim());
  const scenarioIdx = lines.findIndex((l) => l.startsWith('Scenario:'));
  assert.ok(scenarioIdx > 0, 'Scenario: line must exist and follow a tag line');
  assert.match(lines[scenarioIdx - 1], /@regression/);
  assert.match(lines[scenarioIdx - 1], /@cart/);
});

test('tags are preserved verbatim — no case folding or @ stripping', () => {
  const out = generateFeatureFile({
    featureName: 'X',
    tags: ['@SMOKE', '@CamelCaseTag', '@with-dashes', '@with_underscore'],
    steps: [{ kind: 'navigate', url: 'https://x.com' }],
  });
  // All four must appear exactly as provided.
  assert.match(out, /@SMOKE/);
  assert.match(out, /@CamelCaseTag/);
  assert.match(out, /@with-dashes/);
  assert.match(out, /@with_underscore/);
});

test('multi-scenario feature: each scenario keeps its OWN tag set, no leakage', () => {
  const out = generateFeatureFile({
    featureName: 'AmazonE2E',
    scenarios: [
      { title: 'Login',  tags: ['@smoke'],              steps: [{ kind: 'navigate', url: 'https://amazon.com' }] },
      { title: 'Search', tags: ['@regression'],         steps: [{ kind: 'type', selector: '#q', value: 'sony' }] },
      { title: 'Cart',   tags: ['@cart', '@checkout'],  steps: [{ kind: 'click', selector: '#add' }] },
    ],
  });
  const lines = out.split('\n').map((l) => l.trim());

  // Helper: find the line N steps above a given index that is non-empty.
  const prevNonEmpty = (idx) => {
    for (let i = idx - 1; i >= 0; i--) {
      if (lines[i].length > 0) return lines[i];
    }
    return '';
  };

  const sIdx = {
    Login:  lines.findIndex((l) => l === 'Scenario: Login'),
    Search: lines.findIndex((l) => l === 'Scenario: Search'),
    Cart:   lines.findIndex((l) => l === 'Scenario: Cart'),
  };
  for (const [name, idx] of Object.entries(sIdx)) {
    assert.ok(idx > 0, `Scenario: ${name} must be present`);
  }

  // Each scenario's tag line is the immediately-preceding non-empty line,
  // and that line MUST contain only the tags belonging to THIS scenario.
  const tagAbove = {
    Login:  prevNonEmpty(sIdx.Login),
    Search: prevNonEmpty(sIdx.Search),
    Cart:   prevNonEmpty(sIdx.Cart),
  };
  assert.equal(tagAbove.Login,  '@smoke');
  assert.equal(tagAbove.Search, '@regression');
  assert.equal(tagAbove.Cart,   '@cart @checkout');
});

test('Scenario Outline: tags appear above the Scenario Outline: line', () => {
  const out = generateFeatureFile({
    featureName: 'Search',
    featureTitle: 'Search products',
    tags: ['@dataDriven', '@search'],
    useScenarioOutline: true,
    examples: [{ q: 'laptop' }, { q: 'phone' }, { q: 'book' }],
    steps: [{ kind: 'type', selector: '#q', value: '<q>' }],
  });
  // Feature-level tags above Feature:
  assert.match(out, /@dataDriven .*@search\nFeature:/s);
  // Scenario Outline keyword must be present.
  assert.match(out, /Scenario Outline: Search products/);
  // Examples table must be present.
  assert.match(out, /Examples:/);
  assert.match(out, /\|\s*q\s*\|/);
  assert.match(out, /\|\s*laptop\s*\|/);
});

test('non-string / falsy tags are silently dropped — never crashes the generator', () => {
  const out = generateFeatureFile({
    featureName: 'Resilience',
    tags: ['@valid', null, undefined, '', 42, '@another'],
    steps: [{ kind: 'navigate', url: 'about:blank' }],
  });
  assert.match(out, /@valid/);
  assert.match(out, /@another/);
  // Garbage entries should not appear in output.
  assert.equal(out.includes('null'), false);
  assert.equal(out.includes('undefined'), false);
  assert.equal(out.includes(' 42 '), false);
});
