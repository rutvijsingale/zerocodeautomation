/**
 * Unit tests for services/testPlanGenerator.js.
 *
 * The renderer is pure, so we exercise it end-to-end without touching disk.
 * The persistence helpers are smoke-tested against a temp project so we
 * can verify the file actually lands under `test-plan/`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

import {
  renderTestPlan,
  safeDisplayValue,
  looksLikeSecret,
  writeRenderedPlan,
  writeTestPlanFromRecording,
} from '../../services/testPlanGenerator.js';

test('safeDisplayValue: env placeholders surface the variable name', () => {
  assert.equal(safeDisplayValue('${AMAZON_PASSWORD}'), '`<from env: AMAZON_PASSWORD>`');
  assert.equal(safeDisplayValue('${MY_VAR}'), '`<from env: MY_VAR>`');
});

test('safeDisplayValue: forceMask hides literal values', () => {
  assert.equal(safeDisplayValue('hunter2', true), '`***`');
});

test('safeDisplayValue: handles null / undefined', () => {
  assert.equal(safeDisplayValue(null), '_(not provided)_');
  assert.equal(safeDisplayValue(undefined), '_(not provided)_');
});

test('looksLikeSecret: classic password fields detected', () => {
  assert.equal(looksLikeSecret('password', 'foo'), true);
  assert.equal(looksLikeSecret('apiKey', 'bar'), true);
  assert.equal(looksLikeSecret('cvv', '123'), true);
  assert.equal(looksLikeSecret('searchTerm', 'laptop'), false);
});

test('renderTestPlan: produces a non-empty Markdown plan with required sections', () => {
  const md = renderTestPlan({
    scenarioId: 'demo',
    title: 'Demo plan',
    framework: 'playwright-java',
    projectName: 'demo-proj',
    applicationName: 'Demo App',
    objective: 'Smoke test',
    preconditions: ['App is up'],
    credentialsSource: { username: '${USER}', password: '${PASS}' },
    testData: { searchTerm: 'phones', password: 'shouldBeMasked' },
    steps: [{ kind: 'click', selector: '#btn', normalizedDescription: 'Submit button' }],
    expectedResults: ['Click registers'],
    scrollDependentElements: ['Footer'],
    locatorStrategy: 'data-testid → id → role → text',
    cleanupSteps: ['Close browser'],
    limitations: ['Not for prod'],
  });

  assert.match(md, /^# Test Plan — Demo plan/);
  assert.match(md, /## Objective/);
  assert.match(md, /## Preconditions/);
  assert.match(md, /## Credentials source/);
  assert.match(md, /## Test data/);
  assert.match(md, /## Recorded steps/);
  assert.match(md, /## Expected results/);
  assert.match(md, /## Scroll-dependent elements/);
  assert.match(md, /## Locator strategy/);
  assert.match(md, /## Cleanup steps/);
  assert.match(md, /## Limitations/);
  // Step verbalised
  assert.match(md, /Click on \*\*Submit button\*\*/);
});

test('renderTestPlan: NEVER prints a literal password value', () => {
  const md = renderTestPlan({
    scenarioId: 'login',
    title: 'Login',
    framework: 'playwright-java',
    projectName: 'p',
    credentialsSource: { username: '${U}', password: '${P}' },
    testData: { password: 'plaintext-secret-do-not-leak' },
    steps: [{ kind: 'type', selector: '#pw', normalizedDescription: 'Password field', value: 'plaintext-secret-do-not-leak' }],
  });
  assert.ok(!md.includes('plaintext-secret-do-not-leak'),
    'Test plan must mask literal password values');
  // Env-var name visible
  assert.match(md, /from env: P/);
});

test('renderTestPlan: requiresCheckoutGuard prints safety banner', () => {
  const md = renderTestPlan({
    scenarioId: 'checkout',
    title: 'Add to cart',
    framework: 'playwright-java',
    projectName: 'amazon',
    requiresCheckoutGuard: true,
    steps: [],
  });
  assert.match(md, /Safety guard/);
  assert.match(md, /stops \*\*before\*\* payment/);
});

test('renderTestPlan: scroll step verbalises direction + reason + target', () => {
  const md = renderTestPlan({
    scenarioId: 'scroll',
    title: 'Scroll test',
    framework: 'playwright-java',
    projectName: 'p',
    steps: [{
      kind: 'scroll',
      scrollY: 1250,
      scroll: { direction: 'down', mode: 'y', reason: 'element_search' },
      targetElementMetadata: { tag: 'button', text: 'Add to Cart' },
    }],
  });
  assert.match(md, /Scroll \*\*down\*\*/);
  assert.match(md, /reason=element_search/);
  assert.match(md, /Add to Cart/);
  assert.match(md, /y=1250/);
});

test('writeRenderedPlan: persists a markdown file under test-plan/', async () => {
  // Run inside a temp cwd so we don't pollute generated-projects/.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tpg-'));
  const prevCwd = process.cwd();
  process.chdir(tmp);
  try {
    const md = '# minimal\n';
    const file = await writeRenderedPlan({
      framework: 'playwright-java',
      projectName: 'unit-test-plan',
      recordingName: 'demo-recording',
      markdown: md,
    });
    const written = await fs.readFile(file, 'utf8');
    assert.equal(written, md);
    assert.match(file, /test-plan[\\/]demo-recording-test-plan\.md$/);
  } finally {
    process.chdir(prevCwd);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('writeTestPlanFromRecording: derives plan + writes file', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tpg-'));
  const prevCwd = process.cwd();
  process.chdir(tmp);
  try {
    const result = await writeTestPlanFromRecording({
      framework: 'playwright-java',
      projectName: 'unit-test-plan',
      recordingName: 'derived-recording',
      steps: [
        { kind: 'navigate', url: 'https://example.com' },
        { kind: 'scroll', scrollY: 500, scroll: { direction: 'down', mode: 'y' } },
        { kind: 'click', selector: '#btn', normalizedDescription: 'Submit' },
      ],
      metadata: { baseUrl: 'https://example.com', browserType: 'chromium' },
    });
    assert.match(result.file, /derived-recording-test-plan\.md$/);
    assert.match(result.markdown, /Navigate to/);
    assert.match(result.markdown, /Scroll \*\*down\*\*/);
    assert.match(result.markdown, /Click on \*\*Submit\*\*/);
    // Replay validation point quotes the action / scroll counts
    assert.match(result.markdown, /3 steps total/);
    assert.match(result.markdown, /1 are scroll events/);
  } finally {
    process.chdir(prevCwd);
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('writeRenderedPlan: rejects invalid recordingName', async () => {
  await assert.rejects(
    () => writeRenderedPlan({
      framework: 'playwright-java',
      projectName: 'p',
      recordingName: '',
      markdown: '# x\n',
    }),
    /invalid recordingName/i
  );
});
