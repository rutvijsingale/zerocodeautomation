/**
 * Suite : record_to_generate_loop
 * Layer : JS unit (node:test)
 * Owner : ZAC Platform QA
 *
 * Gates the heart of the low-code framework: every framework path
 * (selenium-java, playwright-java, playwright-typescript) must turn a
 * recorded action timeline into:
 *   - step definitions wired to a self-healing fallback chain
 *   - page objects built from the locator repository
 *   - a feature file that drives those step defs
 *
 * If any of these contracts breaks, recording → generated test code
 * stops working end-to-end and this test fails the build.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import * as javaGenerators from '../../java-code-generators.js';
import * as pageObjects from '../../generators/pageObjects.js';
import * as gherkinGenerator from '../../generators/gherkin.js';
import * as normalizationUtils from '../../normalization-utils.js';
import { LocatorDefinition } from '../../models/index.js';

function decorate(action) {
  const out = { ...action };
  if (action.kind === 'navigate' && action.url) {
    out.normalizedPageName = normalizationUtils.extractPageNameFromUrl(action.url);
  } else if (action.selector) {
    out.normalizedDescription = normalizationUtils.normalizeElementDescription(action);
    out.normalizedSelector = normalizationUtils.normalizeSelector(action);
  }
  return out;
}

function buildSampleActions() {
  const raw = [
    {
      kind: 'navigate',
      url: 'http://localhost:3000/demo/shop.html',
      timestamp: 1,
    },
    {
      kind: 'type',
      selector: '#searchInput',
      value: 'Pixel',
      id: 'searchInput',
      placeholder: 'Search products',
      tagName: 'INPUT',
      timestamp: 2,
      fallbackSelectors: [
        '[data-testid="search-input"]',
        'input[aria-label="Search products"]',
      ],
    },
    {
      kind: 'click',
      selector: '[data-testid="add-to-cart-p-101"]',
      id: 'add-p-101',
      ariaLabel: 'Add Pixel Phone 9 to cart',
      textContent: 'Add to Cart',
      tagName: 'BUTTON',
      timestamp: 3,
      fallbackSelectors: ['#add-p-101', 'button[aria-label="Add Pixel Phone 9 to cart"]'],
    },
    {
      kind: 'assertText',
      selector: '[data-testid="cart-count"]',
      expectedValue: '1',
      timestamp: 4,
      fallbackSelectors: ['#cartCount'],
    },
  ];
  return raw.map(decorate);
}

function buildStepDefMapFromFeature(featureContent) {
  const map = {};
  for (const line of featureContent.split('\n')) {
    const trimmed = line.trim();
    if (/^(Given|When|Then|And)\s+/.test(trimmed)) {
      const pattern = trimmed.replace(/"[^"]*"/g, '{string}').replace(/\d+/g, '{int}');
      map[pattern] = true;
    }
  }
  return map;
}

test('record→generate: feature file emits Gherkin for every recorded action', () => {
  const actions = buildSampleActions();
  const feature = gherkinGenerator.generateFeatureFile({
    featureName: 'Recorded Feature',
    featureTitle: 'Recorded Test Flow',
    tags: [],
    steps: actions,
  });
  assert.match(feature, /Feature:/, 'must declare a Feature');
  assert.match(feature, /(Given|When)\s+/, 'must emit at least one step keyword');
  assert.ok(feature.includes('Pixel'), 'must surface the typed value');
  assert.ok(feature.includes('add-to-cart-p-101') || feature.includes('Add To Cart'),
    'must surface the click target either as selector or description');
});

test('record→generate: selenium-java step defs include SELECTOR_FALLBACKS_BY_PRIMARY chain', () => {
  const actions = buildSampleActions();
  const feature = gherkinGenerator.generateFeatureFile({
    featureName: 'Recorded Feature',
    featureTitle: 'Recorded Test Flow',
    tags: [],
    steps: actions,
  });
  const stepDefMap = buildStepDefMapFromFeature(feature);
  const code = javaGenerators.generateJavaStepDefinitions(
    'selenium-java',
    stepDefMap,
    [],
    'http://localhost:3000/demo/shop.html',
    actions,
    'RecordedTestFlowSteps'
  );

  assert.ok(code.includes('SELECTOR_FALLBACKS_BY_PRIMARY'),
    'self-healing map must be emitted');
  assert.ok(
    code.includes('SELECTOR_FALLBACKS_BY_PRIMARY.put("#searchInput"') ||
    code.includes("SELECTOR_FALLBACKS_BY_PRIMARY.put(\"#searchInput\""),
    'primary selector for the typed field must be registered'
  );
  assert.ok(code.includes('tryClickWithFallback'),
    'click step must route through the fallback helper');
  assert.ok(code.includes('ExpectedConditions.visibilityOfElementLocated'),
    'type step must wait for visibility before sending keys');
  assert.ok(/import\s+org\.openqa\.selenium\./.test(code),
    'must import Selenium API');
});

test('record→generate: playwright-java step defs compile-shape', () => {
  const actions = buildSampleActions();
  const feature = gherkinGenerator.generateFeatureFile({
    featureName: 'Recorded Feature',
    featureTitle: 'Recorded Test Flow',
    tags: [],
    steps: actions,
  });
  const stepDefMap = buildStepDefMapFromFeature(feature);
  const code = javaGenerators.generateJavaStepDefinitions(
    'playwright-java',
    stepDefMap,
    [],
    'http://localhost:3000/demo/shop.html',
    actions,
    'RecordedTestFlowSteps'
  );
  assert.ok(code.includes('com.microsoft.playwright'),
    'must use Playwright Java APIs');
  assert.match(code, /public class\s+\w+Steps/, 'must declare a Steps class');
});

test('record→generate: page objects render correctly for selenium and playwright-ts', () => {
  const locators = [
    new LocatorDefinition({
      pageName: 'Shop',
      elementName: 'searchProductsField',
      locatorType: 'id',
      locatorValue: '#searchInput',
      description: 'Shop.searchProductsField',
      fallbackLocators: [
        { type: 'testId', value: 'search-input' },
      ],
    }),
    new LocatorDefinition({
      pageName: 'Shop',
      elementName: 'addToCartButton',
      locatorType: 'testId',
      locatorValue: 'add-to-cart-p-101',
      description: 'Shop.addToCartButton',
      fallbackLocators: [],
    }),
  ];

  const seleniumPages = pageObjects.generateAllPageObjects({ Shop: locators }, 'selenium-java');
  const seleniumShop = seleniumPages.Shop;
  assert.ok(seleniumShop, 'selenium ShopPage must be generated');
  assert.ok(seleniumShop.includes('@FindBy(id = "searchInput")'),
    'selenium @FindBy must strip the # prefix from id locators');
  assert.ok(!seleniumShop.includes('@FindBy(id = "#'),
    'selenium @FindBy must never contain a leading # in id values');
  assert.ok(seleniumShop.includes('extends BasePage'),
    'selenium page must extend BasePage');

  const tsPages = pageObjects.generateAllPageObjects({ Shop: locators }, 'playwright-ts');
  const tsShop = tsPages.Shop;
  assert.ok(tsShop, 'playwright-ts ShopPage must be generated');
  assert.ok(tsShop.includes("this.page.locator('#searchInput')"),
    'playwright-ts must use page.locator for id locators');
  assert.ok(tsShop.includes('getByTestId('),
    'playwright-ts must prefer getByTestId for testId locators');
  assert.ok(!/locator\(['"]##/.test(tsShop),
    'playwright-ts must not double-prefix # in id locators');
});
