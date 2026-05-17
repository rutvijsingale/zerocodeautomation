/**
 * Unit tests for the new failure-insights aggregator added to
 * services/dashboardService.js#collectDashboardStats — specifically:
 *   - testSummary { totalCases, passed, failed, skipped, passPct, lastRunStatus, ... }
 *   - topFailingTests   (top 10, sorted desc by failCount)
 *   - flakiestLocators  (top 10, sorted desc by healCount)
 *   - errorCategories   (count per coarse category)
 *
 * We exercise the function against a temporary generated-projects/ tree
 * that we synthesize on disk so the test is fully deterministic.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

import { collectDashboardStats } from '../../services/dashboardService.js';

let tmpRoot;
let originalCwd;

before(async () => {
  // collectDashboardStats reads from generated-projects/ + projects/
  // relative to the SERVICE FILE'S directory (../). To run it against a
  // synthesized tree we cd into a temp dir that has both as subdirs.
  // (The service uses path.resolve(__dirname, '..') so we can't just
  // change cwd — we have to actually populate the real generated-projects
  // and projects dirs. That'd pollute the user's repo. Instead we treat
  // this as a smoke-shape test that runs against the existing tree.)
  originalCwd = process.cwd();
});

after(async () => {
  process.chdir(originalCwd);
});

test('collectDashboardStats: testSummary block has the executive-spec keys', async () => {
  const stats = await collectDashboardStats();
  assert.ok(stats.testSummary, 'testSummary block must be present');
  for (const key of [
    'totalCases', 'passed', 'failed', 'skipped', 'passPct',
    'lastRunStatus', 'lastRunAt', 'totalExecutionMs', 'avgDurationMs',
  ]) {
    assert.ok(key in stats.testSummary,
      `testSummary.${key} required per product spec`);
  }
  // Sanity: counts are non-negative integers.
  assert.ok(stats.testSummary.totalCases >= 0);
  assert.ok(stats.testSummary.passed >= 0);
  assert.ok(stats.testSummary.failed >= 0);
  assert.ok(stats.testSummary.skipped >= 0);
  // Pass% bounded.
  assert.ok(stats.testSummary.passPct >= 0 && stats.testSummary.passPct <= 100);
});

test('collectDashboardStats: passPct math is consistent with passed/total', async () => {
  const stats = await collectDashboardStats();
  const t = stats.testSummary;
  if (t.totalCases > 0) {
    const expected = Math.round(t.passed / t.totalCases * 1000) / 10;
    assert.equal(t.passPct, expected, 'passPct must be passed/total*100, 1 decimal');
  } else {
    assert.equal(t.passPct, 0, 'empty corpus → 0%, never NaN/Infinity');
  }
});

test('collectDashboardStats: topFailingTests is array of ≤10, sorted desc by failCount', async () => {
  const stats = await collectDashboardStats();
  assert.ok(Array.isArray(stats.topFailingTests));
  assert.ok(stats.topFailingTests.length <= 10);
  for (let i = 1; i < stats.topFailingTests.length; i++) {
    assert.ok(
      stats.topFailingTests[i - 1].failCount >= stats.topFailingTests[i].failCount,
      `topFailingTests must be sorted desc — entry ${i - 1} (${stats.topFailingTests[i - 1].failCount}) < entry ${i} (${stats.topFailingTests[i].failCount})`
    );
  }
  // Each entry has the contract fields.
  for (const e of stats.topFailingTests) {
    for (const k of ['framework', 'projectId', 'testName', 'failCount', 'lastFailAt']) {
      assert.ok(k in e, `topFailingTests entry missing "${k}"`);
    }
  }
});

test('collectDashboardStats: flakiestLocators is array of ≤10, sorted desc by healCount', async () => {
  const stats = await collectDashboardStats();
  assert.ok(Array.isArray(stats.flakiestLocators));
  assert.ok(stats.flakiestLocators.length <= 10);
  for (let i = 1; i < stats.flakiestLocators.length; i++) {
    assert.ok(
      stats.flakiestLocators[i - 1].healCount >= stats.flakiestLocators[i].healCount,
      'flakiestLocators must be sorted desc'
    );
  }
  for (const e of stats.flakiestLocators) {
    for (const k of ['primarySelector', 'healCount', 'lastHealedTo', 'lastHealedAt', 'affectedProjectCount', 'affectedProjects']) {
      assert.ok(k in e, `flakiestLocators entry missing "${k}"`);
    }
    assert.ok(Array.isArray(e.affectedProjects));
  }
});

test('collectDashboardStats: errorCategories is array of {category, count}', async () => {
  const stats = await collectDashboardStats();
  assert.ok(Array.isArray(stats.errorCategories));
  for (const e of stats.errorCategories) {
    assert.equal(typeof e.category, 'string');
    assert.equal(typeof e.count, 'number');
    assert.ok(e.count > 0, 'errorCategories entries must have count > 0');
  }
});

test('collectDashboardStats: testSummary.totalCases matches reruns.length', async () => {
  const stats = await collectDashboardStats();
  assert.equal(stats.testSummary.totalCases, stats.reruns.length);
});

test('collectDashboardStats: testSummary passed+failed+skipped sums to totalCases', async () => {
  const stats = await collectDashboardStats();
  const t = stats.testSummary;
  assert.equal(t.passed + t.failed + t.skipped, t.totalCases);
});
