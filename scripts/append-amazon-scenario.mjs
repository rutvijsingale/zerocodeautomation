#!/usr/bin/env node
/* eslint-disable */
/**
 * scripts/append-amazon-scenario.mjs
 *
 * Demonstrates: new scenarios get added to the SAME project (`projects/amazon`)
 * without disturbing existing artefacts. This is the "low-code, additive"
 * promise — the QA tester records something new, ZAC drops one more
 * .feature + Steps.java + page object alongside what's already there, and the
 * locator repo grows.
 *
 * Adds a 5th scenario (Apply Price Filter on the search results page) to the
 * Amazon suite already produced by build-amazon-suite.mjs.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as gherkinGenerator from '../generators/gherkin.js';
import * as pageObjectGenerators from '../generators/pageObjects.js';
import * as javaGenerators from '../java-code-generators.js';
import { LocatorService } from '../services/locatorService.js';
import { LocatorDefinition } from '../models/LocatorDefinition.js';
import { FileService } from '../services/fileService.js';
import normalizationUtils from '../normalization-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PROJECT_ID = 'amazon';
const PROJECT_DIR = path.join(REPO_ROOT, 'projects', PROJECT_ID);
const FRAMEWORK = 'selenium-java';
const BASE_URL = 'https://www.amazon.in';

function el(o) {
  return { elementText: '', ariaLabel: '', placeholder: '', name: '', id: '', dataTestId: '', tagName: 'button', ...o };
}

const NEW_SCENARIO = {
  id: 'filter',
  featureTitle: 'Amazon Apply Price Filter',
  featureName: 'Amazon Search Filter',
  tags: ['@regression', '@filter', '@amazon'],
  actions: [
    {
      kind: 'navigate',
      url: `${BASE_URL}/s?k=mobile`,
      normalizedPageName: 'AmazonSearchResults',
    },
    {
      kind: 'click',
      selector: '#low-price',
      fallbackSelectors: [
        'input[name="low-price"]',
        '//input[@id="low-price"]',
      ],
      normalizedPageName: 'AmazonSearchResults',
      ...el({ id: 'low-price', tagName: 'input', name: 'low-price', placeholder: 'Min' }),
    },
    {
      kind: 'type',
      selector: '#low-price',
      fallbackSelectors: [
        'input[name="low-price"]',
        '//input[@id="low-price"]',
      ],
      value: '10000',
      normalizedPageName: 'AmazonSearchResults',
      ...el({ id: 'low-price', tagName: 'input', name: 'low-price' }),
    },
    {
      kind: 'click',
      selector: 'span.a-button.a-button-icon-only.a-button-go',
      fallbackSelectors: [
        'span.a-button-go input',
        '//span[contains(@class,"a-button-go")]//input',
      ],
      normalizedPageName: 'AmazonSearchResults',
      ...el({ tagName: 'span', elementText: 'Go', ariaLabel: 'Apply price filter' }),
    },
    {
      kind: 'assertVisible',
      selector: '[data-component-type="s-search-result"]',
      fallbackSelectors: [
        'div.s-search-results',
        '//div[@data-component-type="s-search-result"]',
      ],
      normalizedPageName: 'AmazonSearchResults',
      ...el({ tagName: 'div', dataTestId: 's-search-result' }),
    },
  ],
};

function decorateAction(action) {
  const normalizedDescription = normalizationUtils.normalizeElementDescription(action);
  const normalizedSelector = normalizationUtils.normalizeSelector(action) || action.selector;
  const candidateType = (s) => (s.startsWith('//') || s.startsWith('(//') ? 'xpath' : 'css');
  const locatorCandidates = [];
  if (action.selector) {
    locatorCandidates.push({ selector: action.selector, type: candidateType(action.selector), unique: true, stabilityScore: 100, matchCount: 1 });
  }
  if (Array.isArray(action.fallbackSelectors)) {
    action.fallbackSelectors.forEach((f, i) => {
      locatorCandidates.push({ selector: f, type: candidateType(f), unique: true, stabilityScore: 90 - i * 5, matchCount: 1 });
    });
  }
  return { ...action, normalizedDescription, normalizedSelector, locatorCandidates };
}

async function main() {
  console.log('\n[APPEND] Verifying base project exists ...');
  const baseFeatures = ['AmazonLogin', 'AmazonSearchMobile', 'AmazonAddToCart', 'AmazonLogout'];
  for (const f of baseFeatures) {
    const p = path.join(PROJECT_DIR, 'src/test/resources/features', `${f}.feature`);
    try {
      await fs.access(p);
    } catch {
      console.error(`[ERROR] Base feature ${f} not found. Run build-amazon-suite.mjs first.`);
      process.exit(1);
    }
  }
  console.log('  [ok] all 4 base scenarios present');

  const fileService = new FileService();
  const locatorService = new LocatorService(fileService);
  locatorService.invalidateCache(PROJECT_ID);

  const enrichedActions = NEW_SCENARIO.actions.map(decorateAction);

  console.log('[APPEND] Promoting any new stable selectors into shared locators.json ...');
  const STABLE_KINDS = new Set(['id', 'testId', 'name', 'role']);
  const STABLE_PATTERNS = [/^#[A-Za-z][\w-]*$/, /^\[data-testid=["'][^"']+["']\]$/, /^\[name=["'][^"']+["']\]$/];

  // Seed the locator cache from projects/amazon/locators.json so we don't lose
  // the existing locators (LocatorService keeps them in test-temp/<id>/, but
  // build-amazon-suite copies the result into projects/<id>/ — re-seed from
  // there so this script extends the same repo.)
  const projectLocatorsPath = path.join(PROJECT_DIR, 'locators.json');
  try {
    const buf = await fs.readFile(projectLocatorsPath, 'utf8');
    const parsed = JSON.parse(buf);
    const tempLocatorsDir = path.join(REPO_ROOT, 'test-temp', PROJECT_ID);
    await fs.mkdir(tempLocatorsDir, { recursive: true });
    await fs.writeFile(path.join(tempLocatorsDir, 'locators.json'), buf);
    console.log(`  [ok] re-seeded locator repo with ${parsed.locators?.length || 0} existing locators`);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  for (const a of enrichedActions) {
    if (!a.selector) continue;
    const inferredType = locatorService.inferLocatorType(a.selector);
    const looksStable = STABLE_KINDS.has(inferredType) || STABLE_PATTERNS.some((re) => re.test(a.selector));
    if (!looksStable) continue;

    const pageName = (a.normalizedPageName || 'Generic').replace(/[^A-Za-z0-9]/g, '');
    const elementName = (a.normalizedDescription || a.selector)
      .replace(/[^A-Za-z0-9 ]/g, '')
      .trim()
      .split(/\s+/)
      .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      .join('') || 'element';

    const existing = await locatorService.getLocatorByPageAndElement(PROJECT_ID, pageName, elementName);
    if (existing && existing.locatorValue === a.selector) continue;

    const fallbackList = (a.fallbackSelectors || [])
      .filter((s) => typeof s === 'string' && s && s !== a.selector)
      .map((s) => ({ type: locatorService.inferLocatorType(s), value: s }));

    await locatorService.saveLocator(PROJECT_ID, new LocatorDefinition({
      pageName,
      elementName,
      locatorType: inferredType,
      locatorValue: a.selector,
      description: a.normalizedDescription || `${pageName}.${elementName}`,
      fallbackLocators: fallbackList,
    }));
  }

  // Write merged locators.json back into projects/<id>/
  const tempLocatorsPath = path.join(REPO_ROOT, 'test-temp', PROJECT_ID, 'locators.json');
  await fs.copyFile(tempLocatorsPath, projectLocatorsPath);

  console.log('[APPEND] Regenerating Page Objects from accumulated locator repo ...');
  const allLocators = await locatorService.loadLocators(PROJECT_ID);
  const pageLocatorsMap = {};
  for (const loc of allLocators) {
    if (!pageLocatorsMap[loc.pageName]) pageLocatorsMap[loc.pageName] = {};
    pageLocatorsMap[loc.pageName][loc.elementName] = {
      selector: loc.locatorValue,
      type: loc.locatorType || 'css',
    };
  }
  const pagesDir = path.join(PROJECT_DIR, 'src/test/java/pages');
  const pageObjects = pageObjectGenerators.generateAllPageObjects(pageLocatorsMap, 'selenium-java');
  for (const [pageName, code] of Object.entries(pageObjects)) {
    await fs.writeFile(path.join(pagesDir, `${pageName}Page.java`), code);
  }
  console.log(`  [ok] regenerated ${Object.keys(pageObjects).length} Page Objects`);

  console.log('[APPEND] Emitting new feature + step-def files ...');
  const featuresDir = path.join(PROJECT_DIR, 'src/test/resources/features');
  const stepsDir = path.join(PROJECT_DIR, 'src/test/java/steps');

  const featureContent = gherkinGenerator.generateFeatureFile({
    featureName: NEW_SCENARIO.featureName,
    featureTitle: NEW_SCENARIO.featureTitle,
    tags: NEW_SCENARIO.tags,
    steps: enrichedActions,
  });
  const featureFileName = NEW_SCENARIO.featureTitle.replace(/[^a-zA-Z0-9]/g, '');
  await fs.writeFile(path.join(featuresDir, `${featureFileName}.feature`), featureContent);

  const className = `${featureFileName}Steps`;
  const stepDefMap = {};
  featureContent.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (/^(Given|When|Then|And)\s+/.test(trimmed)) {
      const pattern = trimmed.replace(/"[^"]*"/g, '{string}').replace(/\d+/g, '{int}');
      stepDefMap[pattern] = true;
    }
  });
  let stepDefs = javaGenerators.generateJavaStepDefinitions(
    FRAMEWORK,
    stepDefMap,
    enrichedActions,
    BASE_URL,
    enrichedActions,
    className
  );
  if (!stepDefs.includes('import support.CredentialsHelper;')) {
    stepDefs = stepDefs.replace(/^(package steps;\s*\n)/m, '$1\nimport support.CredentialsHelper;\n');
  }
  if (stepDefs.includes('public void iTypeInto(String value, String selector) {')) {
    stepDefs = stepDefs.replace(
      'public void iTypeInto(String value, String selector) {',
      'public void iTypeInto(String value, String selector) {\n        value = CredentialsHelper.resolve(value);'
    );
  }
  await fs.writeFile(path.join(stepsDir, `${className}.java`), stepDefs);
  console.log(`  [ok] wrote ${featureFileName}.feature + ${className}.java`);

  // Keep project.json in sync so the UI dropdown shows the new scenario.
  console.log('[APPEND] Updating project.json with the new scenario ...');
  const projectJsonPath = path.join(PROJECT_DIR, 'project.json');
  try {
    const existing = JSON.parse(await fs.readFile(projectJsonPath, 'utf8'));
    existing.steps = [...(existing.steps || []), ...enrichedActions];
    existing.scenarios = [
      ...(existing.scenarios || []),
      {
        id: `scenario-${NEW_SCENARIO.id}`,
        name: NEW_SCENARIO.featureTitle,
        tags: NEW_SCENARIO.tags,
        steps: enrichedActions.map((a, idx) => ({
          stepId: `step-${NEW_SCENARIO.id}-${idx}`,
          action: a,
        })),
        createdAt: new Date().toISOString(),
      },
    ];
    existing.locators = (await locatorService.loadLocators(PROJECT_ID))
      .map((l) => (typeof l.toJSON === 'function' ? l.toJSON() : l));
    existing.metadata = { ...(existing.metadata || {}), updated: new Date().toISOString() };
    await fs.writeFile(projectJsonPath, JSON.stringify(existing, null, 2));
    console.log(`  [ok] project.json now has ${existing.scenarios.length} scenarios, ${existing.steps.length} steps`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error('[ERROR] project.json missing — run scripts/build-amazon-suite.mjs first.');
      process.exit(1);
    }
    throw err;
  }

  console.log('\n[VALIDATE] All 5 scenarios coexist in same project:');
  const allFeatures = await fs.readdir(featuresDir);
  const allSteps = await fs.readdir(stepsDir);
  for (const f of allFeatures.sort()) console.log(`  feature: ${f}`);
  for (const s of allSteps.sort()) console.log(`  steps:   ${s}`);

  if (allFeatures.length !== 5 || allSteps.length !== 5) {
    console.error('[FAIL] Expected exactly 5 feature files and 5 step files');
    process.exit(1);
  }

  console.log('\n[DONE] New scenario appended without disturbing existing 4.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
