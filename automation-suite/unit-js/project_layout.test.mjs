/**
 * Unit tests for services/projectLayout.js — pure logic, no HTTP.
 *
 * Covers:
 *   - registry discovery (only the frameworks the app actually wires up)
 *   - alias resolution
 *   - sanitization edge cases
 *   - path builders shaped exactly like the spec
 *   - scaffold creates every required directory and a README
 *   - recording / rerun directories are time-bucketed (no overwrite)
 *   - validation returns clear, actionable errors
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

import {
  listFrameworks,
  normalizeFrameworkId,
  isFrameworkSupported,
  getFrameworkDefinition,
  sanitizeName,
  timestampSlug,
  getProjectPaths,
  getRecordingPaths,
  getRerunPaths,
  ensureProjectScaffold,
  ensureRecordingScaffold,
  ensureRerunScaffold,
  validateLayoutInputs,
  __test__,
} from '../../services/projectLayout.js';

// All scaffolding tests run inside an isolated temp cwd so we don't pollute
// the real generated-projects/ folder during CI.
let originalCwd;
let tmpRoot;

before(async () => {
  originalCwd = process.cwd();
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'zac-layout-'));
  process.chdir(tmpRoot);
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- *
 *  Registry                                                                  *
 * -------------------------------------------------------------------------- */

test('listFrameworks returns the canonical set discovered from existing code', async () => {
  const fws = await listFrameworks();
  const ids = fws.map((f) => f.id).sort();
  // Every entry here MUST have a corresponding generator wired into
  // routes/api.js OR a pure plugin in generators/<id>.js. No fabricated
  // entries — the test fails if someone adds one to the registry without
  // first shipping the generator. See generators/PLUGIN.md for the
  // contract a new framework must honor.
  assert.deepEqual(ids, [
    'playwright-java',
    'playwright-javascript',
    'playwright-typescript',
    'selenium-java',
    'selenium-testng', // plugin: generators/selenium-testng.js
  ]);
  for (const f of fws) {
    assert.ok(f.label, `framework ${f.id} must have a label`);
    assert.ok(f.language, `framework ${f.id} must have a language`);
    assert.ok(f.runner && f.runner.command, `framework ${f.id} must have a runner.command`);
    assert.ok(f.conventions, `framework ${f.id} must have conventions`);
  }
});

test('normalizeFrameworkId resolves aliases and rejects unknown ids', async () => {
  assert.equal(await normalizeFrameworkId('playwright-ts'), 'playwright-typescript');
  assert.equal(await normalizeFrameworkId('playwright'), 'playwright-typescript');
  assert.equal(await normalizeFrameworkId('PLAYWRIGHT-JAVA'), 'playwright-java');
  assert.equal(await normalizeFrameworkId('Selenium-Java'), 'selenium-java');
  assert.equal(await normalizeFrameworkId('cypress'), null);
  assert.equal(await normalizeFrameworkId(''), null);
  assert.equal(await normalizeFrameworkId(null), null);
});

test('isFrameworkSupported / getFrameworkDefinition agree with normalize', async () => {
  assert.equal(await isFrameworkSupported('selenium-java'), true);
  assert.equal(await isFrameworkSupported('cypress'), false);
  const def = await getFrameworkDefinition('playwright-ts');
  assert.equal(def.id, 'playwright-typescript');
  assert.equal(def.language, 'typescript');
  assert.equal(await getFrameworkDefinition('webdriverio'), null);
});

/* -------------------------------------------------------------------------- *
 *  Sanitization                                                              *
 * -------------------------------------------------------------------------- */

test('sanitizeName lowercases and strips unsafe characters', () => {
  assert.equal(sanitizeName('My Project'), 'my-project');
  assert.equal(sanitizeName('My/Project'), 'my-project');
  assert.equal(sanitizeName('  --foo--  '), 'foo');
  assert.equal(sanitizeName('Amazon Add To Cart'), 'amazon-add-to-cart');
  assert.equal(sanitizeName('foo___bar'), 'foo___bar');
  assert.equal(sanitizeName('foo\u0000bar'), 'foo-bar');
  assert.equal(sanitizeName('a'.repeat(80)).length, 64);
});

test('sanitizeName rejects empty / reserved names', () => {
  assert.equal(sanitizeName(''), null);
  assert.equal(sanitizeName('   '), null);
  assert.equal(sanitizeName('.'), null);
  assert.equal(sanitizeName('..'), null);
  assert.equal(sanitizeName(null), null);
  assert.equal(sanitizeName(123), null);
});

test('timestampSlug is sortable and free of forbidden chars', () => {
  const slug = timestampSlug(new Date('2026-04-26T17:30:49.621Z'));
  assert.equal(slug, '2026-04-26T173049-621Z');
  assert.match(slug, /^[A-Za-z0-9-]+$/);
});

/* -------------------------------------------------------------------------- *
 *  Path builders                                                             *
 * -------------------------------------------------------------------------- */

test('getProjectPaths assembles the spec-mandated subdirs', async () => {
  const paths = await getProjectPaths({
    framework: 'selenium-java',
    projectName: 'AmazonShop',
  });
  assert.equal(paths.framework, 'selenium-java');
  assert.equal(paths.projectName, 'amazonshop');
  assert.ok(paths.root.endsWith(path.join('generated-projects', 'selenium-java', 'amazonshop')));
  for (const sub of __test__.GENERIC_SUBDIRS) {
    assert.ok(paths[sub], `missing path for ${sub}`);
    assert.ok(paths[sub].startsWith(paths.root), `${sub} must be inside root`);
  }
  assert.equal(paths.readme, path.join(paths.root, 'README.md'));
});

test('getProjectPaths rejects unsupported framework + invalid project name', async () => {
  await assert.rejects(
    () => getProjectPaths({ framework: 'cypress', projectName: 'foo' }),
    /Unsupported framework/
  );
  await assert.rejects(
    () => getProjectPaths({ framework: 'selenium-java', projectName: '..' }),
    /Invalid project name/
  );
});

test('getRecordingPaths uses sanitized name and returns the file leaves the spec asks for', async () => {
  const r = await getRecordingPaths({
    framework: 'playwright-ts',
    projectName: 'demo',
    recordingName: 'Login Flow #1',
  });
  assert.equal(r.recordingName, 'login-flow-1');
  assert.ok(r.recordingDir.endsWith(path.join('recordings', 'login-flow-1')));
  assert.ok(r.recordedSteps.endsWith('recorded-steps.json'));
  assert.ok(r.metadata.endsWith('metadata.json'));
  assert.ok(r.screenshots.endsWith('screenshots'));
  assert.ok(r.logs.endsWith('logs'));
});

test('getRecordingPaths falls back to a timestamp slug when name omitted', async () => {
  const r = await getRecordingPaths({ framework: 'selenium-java', projectName: 'demo' });
  // Must be a valid timestamp slug shape: 2026-04-26T173049-621Z
  assert.match(r.recordingName, /^\d{4}-\d{2}-\d{2}T\d{6}-\d{3}Z$/);
});

test('getRerunPaths nests under <test-name>/<timestamp>/ and demands a testName', async () => {
  await assert.rejects(
    () => getRerunPaths({ framework: 'selenium-java', projectName: 'demo' }),
    /testName is required/
  );
  const r = await getRerunPaths({
    framework: 'selenium-java',
    projectName: 'demo',
    testName: 'Add To Cart',
    timestamp: '2026-04-26T173049-621Z',
  });
  assert.equal(r.testName, 'add-to-cart');
  assert.equal(r.timestamp, '2026-04-26T173049-621Z');
  assert.ok(r.rerunDir.endsWith(path.join('reruns', 'add-to-cart', '2026-04-26T173049-621Z')));
  for (const leaf of ['report', 'screenshots', 'videos', 'traces', 'logs']) {
    assert.ok(r[leaf].endsWith(leaf), `expected leaf ${leaf}`);
  }
});

/* -------------------------------------------------------------------------- *
 *  Scaffolding                                                               *
 * -------------------------------------------------------------------------- */

test('ensureProjectScaffold creates every generic subdir + README + framework conventions', async () => {
  const paths = await ensureProjectScaffold({
    framework: 'selenium-java',
    projectName: 'scaffold-test',
  });
  for (const sub of __test__.GENERIC_SUBDIRS) {
    const stat = await fs.stat(paths[sub]);
    assert.ok(stat.isDirectory(), `${sub} must exist as a directory`);
  }
  // Java framework needs Maven dirs.
  await assert.doesNotReject(fs.stat(path.join(paths.root, 'src/test/java')));
  await assert.doesNotReject(fs.stat(path.join(paths.root, 'src/main/java')));
  await assert.doesNotReject(fs.stat(path.join(paths.root, 'src/test/resources')));
  // README must mention the framework and the runner command.
  const readme = await fs.readFile(paths.readme, 'utf8');
  assert.match(readme, /selenium-java/);
  assert.match(readme, /mvn clean test/);
  assert.match(readme, /Folder layout/);
});

test('ensureProjectScaffold is idempotent — second call does not throw', async () => {
  await ensureProjectScaffold({ framework: 'selenium-java', projectName: 'scaffold-test' });
  await assert.doesNotReject(
    ensureProjectScaffold({ framework: 'selenium-java', projectName: 'scaffold-test' })
  );
});

test('ensureRecordingScaffold creates recordingDir + screenshots + logs + dom-snapshots', async () => {
  const r = await ensureRecordingScaffold({
    framework: 'playwright-ts',
    projectName: 'rec-test',
    recordingName: 'login flow',
  });
  await assert.doesNotReject(fs.stat(r.recordingDir));
  await assert.doesNotReject(fs.stat(r.screenshots));
  await assert.doesNotReject(fs.stat(r.logs));
  // Spec adds dom-snapshots/ for forensics on flaky scrolls.
  await assert.doesNotReject(fs.stat(r.domSnapshots));
  // Note: recordedSteps / metadata are FILES, not dirs — the layout module
  // creates the parent dir, callers do the writeFile. Verify parent is present.
  await assert.doesNotReject(fs.stat(path.dirname(r.recordedSteps)));
  // The new artifact leaves are exposed (parent dir already created).
  assert.ok(r.scrollEvents.endsWith('scroll-events.json'));
  assert.ok(r.elementLocators.endsWith('element-locators.json'));
});

test('getProjectPaths exposes test-plan/ + locator file leaves', async () => {
  const p = await getProjectPaths({ framework: 'selenium-java', projectName: 'leaves' });
  assert.ok(p['test-plan'] && p['test-plan'].endsWith('test-plan'),
    'kebab-style key for test-plan must be present');
  assert.ok(p.testPlan && p.testPlan.endsWith('test-plan'),
    'camel-style alias for testPlan must be present');
  assert.ok(p.originalLocators && p.originalLocators.endsWith('original-locators.json'));
  assert.ok(p.healedLocators && p.healedLocators.endsWith('healed-locators.json'));
});

test('ensureProjectScaffold creates the test-plan/ directory', async () => {
  const p = await ensureProjectScaffold({ framework: 'playwright-ts', projectName: 'tp-dir' });
  await assert.doesNotReject(fs.stat(p.testPlan));
  // README mentions the new artifacts so reviewers find them.
  const readme = await fs.readFile(p.readme, 'utf8');
  assert.match(readme, /test-plan/);
  assert.match(readme, /scroll-events\.json/);
  assert.match(readme, /healed-locators\.json/);
  assert.match(readme, /replay-result\.json/);
});

test('getRerunPaths exposes replay-result.json file leaf', async () => {
  const r = await getRerunPaths({
    framework: 'selenium-java',
    projectName: 'rr-test',
    testName: 'demo',
    timestamp: '2026-04-26T173049-621Z',
  });
  assert.ok(r.replayResult.endsWith('replay-result.json'));
});

test('ensureRerunScaffold creates a unique timestamped folder per call', async () => {
  const a = await ensureRerunScaffold({
    framework: 'selenium-java',
    projectName: 'rerun-test',
    testName: 'add to cart',
  });
  // Pause so the timestamp slug differs deterministically.
  await new Promise((r) => setTimeout(r, 5));
  const b = await ensureRerunScaffold({
    framework: 'selenium-java',
    projectName: 'rerun-test',
    testName: 'add to cart',
  });
  assert.notEqual(a.rerunDir, b.rerunDir, 'each rerun must get its own timestamp folder');
  await assert.doesNotReject(fs.stat(a.report));
  await assert.doesNotReject(fs.stat(b.report));
});

/* -------------------------------------------------------------------------- *
 *  Validation                                                                *
 * -------------------------------------------------------------------------- */

test('validateLayoutInputs returns ok for canonical and aliased framework ids', async () => {
  const okJ = await validateLayoutInputs({ framework: 'selenium-java', projectName: 'X' });
  assert.equal(okJ.ok, true);
  assert.equal(okJ.framework, 'selenium-java');
  assert.equal(okJ.projectName, 'x');

  const okT = await validateLayoutInputs({ framework: 'playwright-ts', projectName: 'X-Y' });
  assert.equal(okT.ok, true);
  assert.equal(okT.framework, 'playwright-typescript');
  assert.equal(okT.projectName, 'x-y');
});

test('validateLayoutInputs surfaces clear errors for every failure mode', async () => {
  const noFw = await validateLayoutInputs({ projectName: 'x' });
  assert.equal(noFw.ok, false);
  assert.equal(noFw.status, 400);
  assert.match(noFw.error, /No framework provided/);

  const badFw = await validateLayoutInputs({ framework: 'cypress', projectName: 'x' });
  assert.equal(badFw.ok, false);
  assert.match(badFw.error, /Unsupported framework/);

  const noName = await validateLayoutInputs({ framework: 'selenium-java' });
  assert.equal(noName.ok, false);
  assert.match(noName.error, /projectName is required/);

  const badName = await validateLayoutInputs({ framework: 'selenium-java', projectName: '..' });
  assert.equal(badName.ok, false);
  assert.match(badName.error, /Invalid projectName/);
});
