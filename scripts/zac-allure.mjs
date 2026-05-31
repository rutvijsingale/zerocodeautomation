#!/usr/bin/env node
/**
 * Allure helper for ZAC reruns.
 *
 * The rerun engine now writes <rerunDir>/allure-results/ for every run
 * (utils/allureWriter.js). This script walks the generated-projects/
 * tree and either:
 *   1. Generates per-rerun static HTML next to each results dir
 *      (<rerunDir>/allure-report/index.html) if the Allure CLI is
 *      available; OR
 *   2. Builds a single combined Allure report under
 *      reports/allure-report-<timestamp>/ if you pass --aggregate.
 *
 * Locating the Allure CLI: tries `allure` on PATH, then
 * `npx --no-install allure-commandline`. If neither is available it
 * prints clear install instructions and exits with status 0 (the
 * results JSON files on disk are still useful even without the CLI).
 *
 * Usage:
 *   node scripts/zac-allure.mjs                      # per-rerun HTML
 *   node scripts/zac-allure.mjs --aggregate          # one combined report
 *   node scripts/zac-allure.mjs --serve              # combined + allure serve
 *   node scripts/zac-allure.mjs --filter playwright  # only matching framework
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const GEN_ROOT = path.join(REPO, 'generated-projects');

const args = new Set(process.argv.slice(2));
const FILTER_IDX = process.argv.indexOf('--filter');
const FILTER = FILTER_IDX > -1 ? process.argv[FILTER_IDX + 1] : null;
const AGGREGATE = args.has('--aggregate') || args.has('--serve');
const SERVE = args.has('--serve');

/**
 * Locate an Allure CLI we can use.
 *
 * Order of preference:
 *   1. The locally-installed Node-native Allure 3 (`./node_modules/.bin/allure`)
 *      — uses the `awesome` renderer, no Java needed.
 *   2. `allure` on PATH (the Java-based allure-commandline) — needs a JRE.
 *   3. `npx --no-install allure-commandline` — also needs Java.
 *
 * We return both the binary AND the kind ('node3' | 'java2') so the caller
 * can pick the right sub-command (`allure awesome` vs `allure generate`).
 */
function findAllureCli() {
  const localBin = path.join(REPO, 'node_modules', '.bin', 'allure');
  if (fs.existsSync(localBin)) {
    const v = spawnSync(localBin, ['--version'], { stdio: 'pipe' });
    if (v.status === 0) return { kind: 'node3', cmd: localBin, prefixArgs: [] };
  }
  const candidates = [
    { kind: 'java2', cmd: 'allure', args: ['--version'], prefix: [] },
    { kind: 'java2', cmd: 'npx',    args: ['--no-install', 'allure-commandline', '--version'],
      prefix: ['--no-install', 'allure-commandline'] },
  ];
  for (const c of candidates) {
    const r = spawnSync(c.cmd, c.args, { stdio: 'pipe' });
    if (r.status === 0) return { kind: c.kind, cmd: c.cmd, prefixArgs: c.prefix };
  }
  return null;
}

function* walkAllureResults(root) {
  if (!fs.existsSync(root)) return;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (!e.isDirectory()) continue;
      if (e.name === 'allure-results') {
        // Verify it has at least one *-result.json
        const has = fs.readdirSync(full).some(f => f.endsWith('-result.json'));
        if (has) yield full;
        continue;
      }
      stack.push(full);
    }
  }
}

function relPretty(p) { return path.relative(REPO, p); }

const cli = findAllureCli();
const runs = [...walkAllureResults(GEN_ROOT)].filter(p => !FILTER || p.includes(FILTER));

console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`ZAC Allure helper`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Found ${runs.length} allure-results dir(s) under generated-projects/${FILTER ? `  (filtered: ${FILTER})` : ''}`);

if (runs.length === 0) {
  console.log(`No Allure results yet — run a /api/rerun first.`);
  process.exit(0);
}

if (!cli) {
  console.log(``);
  console.log(`Allure CLI was not found. Per-rerun JSON results are still on disk;`);
  console.log(`view them by installing one of:`);
  console.log(``);
  console.log(`  # Node-native Allure 3 (recommended — NO Java needed):`);
  console.log(`  npm install --save-dev allure`);
  console.log(`  # OR Homebrew (Java-based Allure 2):`);
  console.log(`  brew install allure`);
  console.log(``);
  console.log(`Then run this script again. Or for any single rerun manually:`);
  for (const r of runs.slice(0, 3)) console.log(`  allure serve ${relPretty(r)}`);
  if (runs.length > 3) console.log(`  …(${runs.length - 3} more)`);
  process.exit(0);
}

console.log(`Using Allure CLI: ${cli.kind === 'node3' ? 'allure 3 (Node-native)' : 'allure-commandline (Java)'}`);
console.log(`Binary: ${cli.cmd}\n`);

// Allure 3 (Node-native) uses `allure awesome` for the static HTML report
// and `--cwd <dir-containing-allure-results>` instead of taking the
// results dir as a positional argument. Allure 2 (Java) uses
// `allure generate <results-dir> -o <out> --clean`.
function genCmd(resultsDir, outDir) {
  if (cli.kind === 'node3') {
    // Node-native: --cwd points at the dir whose `allure-results/` folder
    // we want to render. Because each rerun directory CONTAINS its own
    // `allure-results/`, we pass the rerun dir as cwd.
    return [...cli.prefixArgs, 'awesome', '-o', outDir, '--cwd', path.dirname(resultsDir), '--single-file'];
  }
  return [...cli.prefixArgs, 'generate', resultsDir, '-o', outDir, '--clean'];
}

if (AGGREGATE) {
  // Combined report: copy every result/attachment into one staging dir
  // (the renderer treats the staging dir itself as the source of truth).
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const stageContainer = path.join(REPO, 'reports', `allure-stage-${ts}`);
  const stage          = path.join(stageContainer, 'allure-results');
  const out            = path.join(REPO, 'reports', `allure-report-${ts}`);
  fs.mkdirSync(stage, { recursive: true });
  let copied = 0;
  for (const r of runs) {
    for (const f of fs.readdirSync(r)) {
      if (!/-result\.json$|-attachment\.|^environment\.properties$|^executor\.json$|^categories\.json$/.test(f)) continue;
      // Dedupe environment / executor / categories — only keep the first.
      if (f === 'environment.properties' || f === 'executor.json' || f === 'categories.json') {
        if (!fs.existsSync(path.join(stage, f))) {
          try { fs.copyFileSync(path.join(r, f), path.join(stage, f)); copied++; } catch (_) {}
        }
        continue;
      }
      // For UUID-prefixed result/attachment files we don't need to rewrite
      // names; the UUIDs are unique across runs.
      try { fs.copyFileSync(path.join(r, f), path.join(stage, f)); copied++; } catch (_) {}
    }
  }
  console.log(`Staged ${copied} files from ${runs.length} reruns into ${relPretty(stage)}`);

  const genArgs = genCmd(stage, out);
  console.log(`> ${cli.cmd} ${genArgs.join(' ')}`);
  const gen = spawnSync(cli.cmd, genArgs, { stdio: 'inherit' });
  if (gen.status !== 0) { console.error('allure generate failed.'); process.exit(gen.status || 1); }
  console.log(`\n✓ Combined Allure HTML report: file://${out}/index.html`);

  if (SERVE && cli.kind === 'java2') {
    spawnSync(cli.cmd, [...cli.prefixArgs, 'open', out], { stdio: 'inherit' });
  } else if (SERVE) {
    console.log(`(Allure 3 doesn't support 'open'; the report is a single-file HTML you can open directly.)`);
  }
  process.exit(0);
}

// Per-rerun static HTML — write report next to the results dir as
// <rerunDir>/allure-report/index.html
let okCount = 0;
for (const r of runs) {
  const outDir = path.join(path.dirname(r), 'allure-report');
  const genArgs = genCmd(r, outDir);
  process.stdout.write(`  ${relPretty(r)} → `);
  const gen = spawnSync(cli.cmd, genArgs, { stdio: 'pipe' });
  if (gen.status === 0) {
    okCount++;
    const idx = path.join(outDir, 'index.html');
    console.log(`OK  ${relPretty(idx)}`);
  } else {
    console.log(`FAIL  ${(gen.stderr || gen.stdout || '').toString().slice(0, 100)}`);
  }
}
console.log(`\n${okCount}/${runs.length} per-rerun Allure reports generated.`);
console.log(`Aggregate them with:  node scripts/zac-allure.mjs --aggregate`);
