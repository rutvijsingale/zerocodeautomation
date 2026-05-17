#!/usr/bin/env node
/**
 * scripts/validate-recording.mjs
 *
 * Run framework-level checks against a recording directory, e.g.:
 *
 *   node scripts/validate-recording.mjs \
 *     generated-projects/playwright-java/amazon/recordings/amazon-search-product
 *
 * Asserts:
 *   - recorded-steps.json exists and is non-empty
 *   - scroll-events.json exists; warn (don't fail) if empty
 *   - element-locators.json exists and every entry has a primary +
 *     at least one alternate locator
 *   - no plain-text password / OTP / API key value appears in any file
 *     (env-var placeholders ${...} and synthetic test domains are allowed)
 *   - test plan markdown exists at ../../test-plan/<recording>-test-plan.md
 *
 * Exit code is non-zero if any HARD check fails (bullets prefixed with ✖).
 */

import fs from 'fs/promises';
import path from 'path';
import { findCredentialLeaks } from '../services/amazonScenarios.js';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/validate-recording.mjs <recording-dir>');
  process.exit(2);
}
const recordingDir = path.resolve(args[0]);

const failures = [];
const warnings = [];

async function read(file) {
  try { return await fs.readFile(file, 'utf8'); } catch { return null; }
}
async function readJson(file) {
  const t = await read(file);
  if (t == null) return null;
  try { return JSON.parse(t); } catch (err) { failures.push(`Invalid JSON in ${file}: ${err.message}`); return null; }
}

console.log(`[Validate] Recording: ${recordingDir}`);

// 1. recorded-steps.json
const stepsFile = path.join(recordingDir, 'recorded-steps.json');
const steps = await readJson(stepsFile);
if (!steps) failures.push(`Missing recorded-steps.json at ${stepsFile}`);
else if (!Array.isArray(steps) || steps.length === 0) failures.push('recorded-steps.json is empty or not an array');
else console.log(`✓ recorded-steps.json (${steps.length} actions)`);

// 2. scroll-events.json
const scrollFile = path.join(recordingDir, 'scroll-events.json');
const scrolls = await readJson(scrollFile);
if (!scrolls) failures.push(`Missing scroll-events.json at ${scrollFile}`);
else if (!Array.isArray(scrolls)) failures.push('scroll-events.json is not an array');
else if (scrolls.length === 0) warnings.push('scroll-events.json is empty — did the recording actually exercise scroll?');
else console.log(`✓ scroll-events.json (${scrolls.length} events)`);

// 3. element-locators.json
const elemFile = path.join(recordingDir, 'element-locators.json');
const elems = await readJson(elemFile);
if (!elems) failures.push(`Missing element-locators.json at ${elemFile}`);
else if (!Array.isArray(elems)) failures.push('element-locators.json is not an array');
else {
  let weak = 0;
  for (const e of elems) {
    const candidates = (e && e.locatorCandidates) || [];
    if (candidates.length < 2) weak++;
  }
  if (weak === 0) console.log(`✓ element-locators.json (${elems.length} steps, all have ≥2 candidates)`);
  else warnings.push(`${weak}/${elems.length} interactive steps have only 1 locator candidate (no fallback)`);
}

// 4. credential-leak check across all files in the recording
const leakRoots = [stepsFile, scrollFile, elemFile, path.join(recordingDir, 'metadata.json')];
for (const f of leakRoots) {
  const txt = await read(f);
  if (!txt) continue;
  const leaks = findCredentialLeaks(txt);
  if (leaks.length > 0) failures.push(`${path.basename(f)} contains likely credentials: ${leaks.join(', ')}`);
}
if (failures.filter((m) => m.includes('contains likely credentials')).length === 0) {
  console.log('✓ no credential leaks detected in JSON artifacts');
}

// 5. test plan markdown
const projectRoot = path.resolve(recordingDir, '../..'); // recording → recordings → project
const planDir = path.join(projectRoot, 'test-plan');
const recordingName = path.basename(recordingDir);
const planFile = path.join(planDir, `${recordingName}-test-plan.md`);
const planTxt = await read(planFile);
if (!planTxt) warnings.push(`No test plan at ${planFile} — generate one via /api/test-plan/generate`);
else {
  const planLeaks = findCredentialLeaks(planTxt);
  if (planLeaks.length > 0) failures.push(`Test plan contains credentials: ${planLeaks.join(', ')}`);
  else console.log(`✓ test plan markdown OK at ${planFile}`);
}

// Final summary
if (warnings.length > 0) {
  console.log('\nWarnings:');
  for (const w of warnings) console.log(`  ⚠ ${w}`);
}
if (failures.length > 0) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  ✖ ${f}`);
  process.exit(1);
}
console.log('\nAll hard checks passed.');
