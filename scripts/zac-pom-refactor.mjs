#!/usr/bin/env node
/**
 * Refactor a ZAC project's flat steps into Page Object Model classes
 * and per-environment config files.
 *
 * Closes the architecture gaps surfaced by the master stress-test
 * audit (2026-06-01):
 *   ✗ AUDIT.envFiles    →  emits config/.env.qa / .env.stage / .env.dev
 *   ✗ AUDIT.pomFiles    →  emits pages/<PageName>.<lang> per detected page
 *   ✗ AUDIT.pagesFolder →  creates the pages/ subdirectory
 *
 * Usage:
 *   # Refactor one project for ALL three frameworks
 *   node scripts/zac-pom-refactor.mjs <projectId>
 *
 *   # Or: only one framework
 *   node scripts/zac-pom-refactor.mjs <projectId> --framework playwright-java
 *
 *   # See planned changes without writing
 *   node scripts/zac-pom-refactor.mjs <projectId> --dry-run
 *
 * The refactor is opt-in and ADDITIVE — it does NOT touch the existing
 * Steps file or any other generated artifact. The output is dropped
 * into the project dir alongside the existing structure so you can
 * compare side-by-side.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refactorToPom } from '../utils/pomRefactor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const projectId = args.find(a => !a.startsWith('--'));
const fwIdx = args.indexOf('--framework');
const FRAMEWORK = fwIdx > -1 ? args[fwIdx + 1] : null;
const DRY = args.includes('--dry-run');

if (!projectId) {
  console.error('Usage: node scripts/zac-pom-refactor.mjs <projectId> [--framework <fw>] [--dry-run]');
  process.exit(1);
}

const projectDir = path.join(REPO, 'projects', projectId);
const projectJson = path.join(projectDir, 'project.json');
if (!fs.existsSync(projectJson)) {
  console.error(`Project not found: ${projectJson}`);
  process.exit(1);
}
const project = JSON.parse(fs.readFileSync(projectJson, 'utf8'));

const FRAMEWORKS = FRAMEWORK ? [FRAMEWORK] : ['playwright-java', 'selenium-java', 'playwright-javascript'];

console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`POM Refactor — ${projectId}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Frameworks:   ${FRAMEWORKS.join(', ')}`);
console.log(`Project:      ${path.relative(REPO, projectDir)}`);
console.log(`Mode:         ${DRY ? 'DRY-RUN (no writes)' : 'WRITE'}`);
console.log();

let totalWritten = 0;
let totalSkipped = 0;

for (const fw of FRAMEWORKS) {
  const out = refactorToPom(project, { framework: fw });
  console.log(`── ${fw} ──`);
  console.log(`  pages: ${out.summary.pageCount}, env files: ${out.summary.envCount}, action methods: ${out.summary.methodCount}`);

  // ── Write Page Object files ──
  for (const p of out.pages) {
    const abs = path.join(projectDir, p.relPath);
    if (DRY) {
      console.log(`  + ${path.relative(REPO, abs)}  (${p.methodCount} methods, ${p.code.length}B)`);
      continue;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, p.code);
    console.log(`  ✓ wrote ${path.relative(REPO, abs)}  (${p.methodCount} methods, ${p.code.length}B)`);
    totalWritten++;
  }

  // ── Write env config files (only once — env is framework-agnostic) ──
  // Use a sentinel on the project to dedupe across framework loops.
  for (const e of out.envs) {
    const abs = path.join(projectDir, e.file);
    if (fs.existsSync(abs)) { totalSkipped++; continue; }
    if (DRY) {
      console.log(`  + ${path.relative(REPO, abs)}  (${e.body.length}B)`);
      continue;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, e.body);
    console.log(`  ✓ wrote ${path.relative(REPO, abs)}  (${e.body.length}B)`);
    totalWritten++;
  }
  console.log();
}

if (!DRY) {
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✓ Refactor complete.`);
  console.log(`  ${totalWritten} files written, ${totalSkipped} env-files reused.`);
  console.log();
  console.log(`Inspect the result:`);
  console.log(`  ls ${path.relative(REPO, projectDir)}/src/main/java/pages/`);
  console.log(`  ls ${path.relative(REPO, projectDir)}/pages/                (JS variant)`);
  console.log(`  ls ${path.relative(REPO, projectDir)}/config/`);
}
