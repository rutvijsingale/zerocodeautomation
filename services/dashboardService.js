/**
 * services/dashboardService.js
 *
 * Two responsibilities:
 *
 *   collectDashboardStats()
 *     Aggregates on-disk artifacts (rerun reports, healed-locator log,
 *     sign-off reports) into a single payload for the dashboard's
 *     historical / aggregate views. Slow-ish (walks the file tree),
 *     polled every 30s by the dashboard.
 *
 *   collectLiveSnapshot({ activeSessions, runningReruns })
 *     Cheap in-memory snapshot for the dashboard's live activity panel:
 *     active recording sessions, currently-executing reruns, server
 *     pulse (uptime/heap/rss). Polled every 2s, must stay sub-millisecond.
 *
 * Both are pure read-only walks; no side effects; safe to call
 * concurrently with normal recording / rerun activity.
 *
 * Sources:
 *   - generated-projects/<framework>/<project>/                 -> framework + project list
 *   - generated-projects/<framework>/<project>/reruns/<test>/<ts>/replay-result.json
 *                                                              -> pass/fail counts, healing events, scroll counts
 *   - projects/<projectId>/healed-locators.json                 -> healing log per project
 *   - automation-suite/reports/*.md                             -> sign-off reports list
 *
 * Performance:
 *   - Caps the number of rerun reports walked per project at MAX_REPORTS_PER_PROJECT
 *     (default 50 — enough for "last N days" without scanning the world).
 *   - Newest-first directory scan via mtime.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const GENERATED_ROOT = path.join(REPO, 'generated-projects');
const PROJECTS_ROOT = path.join(REPO, 'projects');
const REPORTS_ROOT = path.join(REPO, 'automation-suite', 'reports');

const MAX_REPORTS_PER_PROJECT = 50;
const MAX_REPORTS_TOTAL = 500;

async function safeReadJson(p) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); }
  catch { return null; }
}

async function safeReaddir(p) {
  try { return await fs.readdir(p, { withFileTypes: true }); }
  catch { return []; }
}

async function listSorted(p) {
  const entries = await safeReaddir(p);
  const dirs = entries.filter((d) => d.isDirectory()).map((d) => d.name);
  // Sort newest-first by mtime; falls back to lex order if stat fails.
  const stats = await Promise.all(dirs.map(async (n) => {
    try {
      const s = await fs.stat(path.join(p, n));
      return { n, mtimeMs: s.mtimeMs };
    } catch { return { n, mtimeMs: 0 }; }
  }));
  stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return stats.map((s) => s.n);
}

/**
 * Main entry point.
 *
 * @returns {Promise<{
 *   summary: { totalProjects:number, totalFrameworks:number, totalReruns:number,
 *              totalHealingEvents:number, generatedAt:string },
 *   frameworks: Array<{ id:string, projectCount:number }>,
 *   projects:  Array<{ projectId:string, framework:string, rerunCount:number,
 *                      lastRerunAt:string|null, healingEvents:number }>,
 *   reruns:    Array<{ projectId:string, framework:string, testName:string,
 *                      timestamp:string, status:string, executedSteps:number,
 *                      successCount:number, failureCount:number,
 *                      healingHits:number, scrollSteps:number }>,
 *   healingLog: Array<{ projectId:string, primarySelector:string,
 *                       healedSelector:string, reason:string, savedAt:string }>,
 *   signOffReports: Array<{ name:string, sizeBytes:number, mtime:string }>
 * }>}
 */
export async function collectDashboardStats(opts = {}) {
  // [ZAC-FIX] when opts.existingOnly is true, the stats only include
  // generated-projects/<fw>/<pj>/ folders that have a matching
  // projects/<pj>/project.json (i.e. a "real" project the user can still
  // see in the Recording dropdown). Old auto-generated live-flow-* dirs
  // and one-off backtests are filtered out so the dashboard reflects
  // what actually exists, not historical clutter on disk.
  const { existingOnly = false } = opts;
  let existingSet = null;
  if (existingOnly) {
    const projectDirs = await safeReaddir(PROJECTS_ROOT);
    existingSet = new Set();
    for (const ent of projectDirs) {
      if (!ent.isDirectory()) continue;
      const pj = path.join(PROJECTS_ROOT, ent.name, 'project.json');
      // Only count it as "existing" if project.json is actually present.
      const stat = await fs.stat(pj).then(s => s.isFile()).catch(() => false);
      if (stat) existingSet.add(ent.name);
    }
  }

  const out = {
    summary: {
      totalProjects: 0,
      totalFrameworks: 0,
      totalReruns: 0,
      totalHealingEvents: 0,
      generatedAt: new Date().toISOString(),
      // Surfaces back to the dashboard so it can label the view honestly.
      filteredToExisting: !!existingOnly,
      orphansHidden: 0,
      // [ZAC-FIX 2026-05-24] Count RERUNS belonging to orphan
      // projects so the dashboard can show "N hidden runs · Show
      // all" instead of silently lying about empty run history.
      hiddenReruns: 0,
    },
    frameworks: [],
    projects: [],
    reruns: [],
    healingLog: [],
    signOffReports: [],
  };

  // ── Frameworks + projects ────────────────────────────────────────────
  const frameworkDirs = await listSorted(GENERATED_ROOT);
  out.summary.totalFrameworks = frameworkDirs.length;

  for (const fw of frameworkDirs) {
    const fwRoot = path.join(GENERATED_ROOT, fw);
    const projectDirs = await listSorted(fwRoot);
    // Filter to existing only when requested; record how many we hid.
    const visibleProjects = existingSet
      ? projectDirs.filter(p => existingSet.has(p))
      : projectDirs;
    out.summary.orphansHidden += projectDirs.length - visibleProjects.length;
    // [ZAC-FIX 2026-05-24] Count rerun replay files that BELONG to
    // hidden orphan projects so we can tell the user they have
    // run history that's currently filtered out. Cheap directory
    // walk — counts files only.
    if (existingSet) {
      const hiddenProjects = projectDirs.filter(p => !existingSet.has(p));
      for (const orphan of hiddenProjects) {
        const orphanReruns = path.join(fwRoot, orphan, 'reruns');
        const tests = await listSorted(orphanReruns);
        for (const t of tests) {
          const tsList = await listSorted(path.join(orphanReruns, t));
          for (const ts of tsList) {
            const f = path.join(orphanReruns, t, ts, 'replay-result.json');
            try {
              await fs.access(f);
              out.summary.hiddenReruns++;
            } catch (_) { /* missing replay-result.json — skip */ }
          }
        }
      }
    }
    out.frameworks.push({ id: fw, projectCount: visibleProjects.length });

    for (const projectId of visibleProjects) {
      out.summary.totalProjects++;
      const projRoot = path.join(fwRoot, projectId);
      const rerunsRoot = path.join(projRoot, 'reruns');

      // Walk reruns/<testName>/<timestamp>/ for replay-result.json.
      const testNames = await listSorted(rerunsRoot);
      let rerunCount = 0;
      let lastRerunAt = null;
      let healingEventsForProject = 0;
      const projectReruns = [];

      for (const testName of testNames) {
        const testRoot = path.join(rerunsRoot, testName);
        const timestamps = await listSorted(testRoot);
        for (const ts of timestamps.slice(0, MAX_REPORTS_PER_PROJECT)) {
          const replayPath = path.join(testRoot, ts, 'replay-result.json');
          const data = await safeReadJson(replayPath);
          if (!data) continue;
          rerunCount++;
          out.summary.totalReruns++;
          if (out.reruns.length >= MAX_REPORTS_TOTAL) continue;

          const healingHits = data.healingSummary?.healedSteps
            ?? data.healingSummary?.heals
            ?? (Array.isArray(data.results) ? data.results.filter((r) => r?.healed).length : 0);
          const scrollSteps = data.scrollSummary?.scrollSteps ?? 0;
          const successCount = data.successCount ?? (Array.isArray(data.results) ? data.results.filter((r) => r?.success).length : 0);
          const failureCount = data.failureCount ?? (Array.isArray(data.results) ? data.results.filter((r) => r && r.success === false).length : 0);
          const executedSteps = data.executedSteps ?? (Array.isArray(data.results) ? data.results.length : 0);

          healingEventsForProject += healingHits;

          if (!lastRerunAt || ts > lastRerunAt) lastRerunAt = ts;

          // Duration from start/end timestamps if available, else from
          // sum of per-step durations.
          let durationMs = data.durationMs ?? null;
          if (durationMs == null && Array.isArray(data.results)) {
            durationMs = data.results.reduce((s, r) => s + (Number(r?.duration) || 0), 0);
          }

          // Relative path under generated-projects/ so the dashboard
          // can link via /reports/<...>.
          const relReportRoot = path.posix.join(fw, projectId, 'reruns', testName, ts);

          const entry = {
            projectId,
            framework: fw,
            testName,
            timestamp: ts,
            status: failureCount > 0 ? 'failed' : (executedSteps > 0 ? 'passed' : 'unknown'),
            executedSteps,
            successCount,
            failureCount,
            healingHits,
            scrollSteps,
            durationMs: Number.isFinite(durationMs) ? durationMs : null,
            // T2.4 — surface browserType + headless so the dashboard can
            // break stats down by browser. Defaults to "unknown" for
            // legacy reruns (pre-T2.4) that didn't record this field.
            browserType: data.browserType || 'unknown',
            headless: typeof data.headless === 'boolean' ? data.headless : null,
            // Deep-link targets — rendered via /reports/<...> by Express.
            reportRoot:        `/reports/${relReportRoot}`,
            replayResultUrl:   `/reports/${relReportRoot}/replay-result.json`,
            screenshotsUrl:    `/reports/${relReportRoot}/screenshots/`,
            videosUrl:         `/reports/${relReportRoot}/videos/`,
            tracesUrl:         `/reports/${relReportRoot}/traces/`,
            logsUrl:           `/reports/${relReportRoot}/logs/`,
          };
          projectReruns.push(entry);
          out.reruns.push(entry);
        }
      }

      out.projects.push({
        projectId,
        framework: fw,
        rerunCount,
        lastRerunAt,
        healingEvents: healingEventsForProject,
      });
    }
  }

  // ── Healed locators (from projects/<id>/healed-locators.json) ───────
  const projectIds = await safeReaddir(PROJECTS_ROOT);
  for (const ent of projectIds) {
    if (!ent.isDirectory()) continue;
    const data = await safeReadJson(path.join(PROJECTS_ROOT, ent.name, 'healed-locators.json'));
    if (!data) continue;
    const entries = Array.isArray(data) ? data : (Array.isArray(data.entries) ? data.entries : []);
    for (const e of entries) {
      out.summary.totalHealingEvents++;
      out.healingLog.push({
        projectId: ent.name,
        primarySelector: e.primarySelector || e.original || '',
        healedSelector: e.healedSelector || e.healed || '',
        reason: e.reason || '',
        savedAt: e.savedAt || e.timestamp || '',
      });
    }
  }

  // Newest-first.
  out.reruns.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  out.healingLog.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));

  // ── Performance block ───────────────────────────────────────────────
  // Aggregates across all reruns we just walked. The dashboard's
  // Performance Metrics tab renders this directly.
  const ds = out.reruns.map((r) => r.durationMs).filter((x) => Number.isFinite(x) && x > 0);
  const sortedDs = ds.slice().sort((a, b) => a - b);
  const pct = (p) => sortedDs.length === 0 ? 0 : sortedDs[Math.floor(sortedDs.length * p / 100)];
  const totalRerunsWalked = out.reruns.length;
  const totalPasses = out.reruns.filter((r) => r.status === 'passed').length;
  const totalFails = out.reruns.filter((r) => r.status === 'failed').length;
  const totalHealsAcrossReruns = out.reruns.reduce((s, r) => s + (r.healingHits || 0), 0);

  // Server snapshot — uptime, mem, node version. Walked at request
  // time so it reflects the live process serving this dashboard.
  const memUsage = process.memoryUsage();
  const performance = {
    server: {
      uptimeSeconds: Math.round(process.uptime()),
      heapUsedMB:    Math.round(memUsage.heapUsed / 1024 / 1024 * 10) / 10,
      heapTotalMB:   Math.round(memUsage.heapTotal / 1024 / 1024 * 10) / 10,
      rssMB:         Math.round(memUsage.rss / 1024 / 1024 * 10) / 10,
      nodeVersion:   process.version,
      platform:      process.platform,
    },
    rerunDurations: {
      sampleSize: ds.length,
      meanMs: ds.length === 0 ? 0 : Math.round(ds.reduce((a, b) => a + b, 0) / ds.length),
      p50Ms: pct(50),
      p95Ms: pct(95),
      p99Ms: pct(99),
      maxMs: ds.length === 0 ? 0 : Math.round(sortedDs[sortedDs.length - 1]),
    },
    rates: {
      totalReruns: totalRerunsWalked,
      passes: totalPasses,
      fails: totalFails,
      passRatePct: totalRerunsWalked === 0 ? 0
        : Math.round(totalPasses / totalRerunsWalked * 1000) / 10,
      healingEvents: totalHealsAcrossReruns,
      healRatePerRerun: totalRerunsWalked === 0 ? 0
        : Math.round(totalHealsAcrossReruns / totalRerunsWalked * 100) / 100,
    },
    // Newest 20 reruns as time-series data (for the trend chart).
    timeSeries: out.reruns.slice(0, 20).map((r) => ({
      timestamp: r.timestamp,
      framework: r.framework,
      durationMs: r.durationMs ?? 0,
      passed: r.successCount,
      failed: r.failureCount,
      healed: r.healingHits,
    })).reverse(), // oldest-first for left-to-right chart
  };
  out.performance = performance;

  // ── Sign-off reports ────────────────────────────────────────────────
  const reportEntries = await safeReaddir(REPORTS_ROOT);
  for (const ent of reportEntries) {
    if (!ent.isFile() || !ent.name.endsWith('.md')) continue;
    try {
      const stat = await fs.stat(path.join(REPORTS_ROOT, ent.name));
      out.signOffReports.push({
        name: ent.name,
        sizeBytes: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    } catch { /* ignore */ }
  }
  out.signOffReports.sort((a, b) => b.mtime.localeCompare(a.mtime));

  // ── Test Summary (matches the executive-spec card layout) ──────────
  // "Total / Passed / Failed / Skipped / Pass %" — at the rerun level
  // (one rerun = one "test case" in product terms; per-step counts feed
  // the more detailed Performance Metrics tab).
  const totalCases = out.reruns.length;
  const passed     = out.reruns.filter((r) => r.status === 'passed').length;
  const failed     = out.reruns.filter((r) => r.status === 'failed').length;
  const skipped    = out.reruns.filter((r) => r.status === 'unknown').length;
  out.testSummary = {
    totalCases, passed, failed, skipped,
    passPct: totalCases === 0 ? 0 : Math.round(passed / totalCases * 1000) / 10,
    lastRunStatus: out.reruns[0]?.status ?? null,
    lastRunAt:     out.reruns[0]?.timestamp ?? null,
    totalExecutionMs: ds.reduce((a, b) => a + b, 0),
    avgDurationMs:    ds.length === 0 ? 0 : Math.round(ds.reduce((a, b) => a + b, 0) / ds.length),
  };

  // ── Failure Insights — top failing tests + flakiest locators ──────
  // "Top failing tests": which testName has accumulated the most failed
  // reruns. Keyed by framework+project+testName so the dashboard can
  // link straight to the right report.
  const failureBuckets = new Map();
  for (const r of out.reruns) {
    if (r.status !== 'failed') continue;
    const key = `${r.framework}|${r.projectId}|${r.testName}`;
    const cur = failureBuckets.get(key) || {
      framework: r.framework, projectId: r.projectId, testName: r.testName,
      failCount: 0, lastFailAt: null,
    };
    cur.failCount++;
    if (!cur.lastFailAt || r.timestamp > cur.lastFailAt) cur.lastFailAt = r.timestamp;
    failureBuckets.set(key, cur);
  }
  out.topFailingTests = Array.from(failureBuckets.values())
    .sort((a, b) => b.failCount - a.failCount)
    .slice(0, 10);

  // "Flakiest locators": from the healed-locators log, count distinct
  // primary selectors that have been healed AT LEAST ONCE. Higher count
  // = more brittle. Each entry includes the most-recent healed-to value
  // so the user can see the rescue chain at a glance.
  const flakyBuckets = new Map();
  for (const h of out.healingLog) {
    if (!h.primarySelector) continue;
    const cur = flakyBuckets.get(h.primarySelector) || {
      primarySelector: h.primarySelector, healCount: 0,
      lastHealedTo: '', lastHealedAt: '',
      affectedProjects: new Set(),
    };
    cur.healCount++;
    if (!cur.lastHealedAt || (h.savedAt || '') > cur.lastHealedAt) {
      cur.lastHealedAt = h.savedAt || '';
      cur.lastHealedTo = h.healedSelector || '';
    }
    if (h.projectId) cur.affectedProjects.add(h.projectId);
    flakyBuckets.set(h.primarySelector, cur);
  }
  out.flakiestLocators = Array.from(flakyBuckets.values())
    .map(({ affectedProjects, ...rest }) => ({
      ...rest,
      affectedProjects: Array.from(affectedProjects),
      affectedProjectCount: affectedProjects.size,
    }))
    .sort((a, b) => b.healCount - a.healCount)
    .slice(0, 10);

  // T2.4 — Browser-wise stats. Buckets: chromium, firefox, webkit, edge,
  // unknown (legacy reruns that didn't record browserType). Each bucket
  // shows total/passed/failed + pass-rate so dashboards can answer
  // "which browser is flakiest right now?".
  const browserBuckets = new Map();
  for (const r of out.reruns) {
    const key = r.browserType || 'unknown';
    const cur = browserBuckets.get(key) || { browser: key, total: 0, passed: 0, failed: 0, skipped: 0 };
    cur.total++;
    if (r.status === 'passed') cur.passed++;
    else if (r.status === 'failed') cur.failed++;
    else cur.skipped++;
    browserBuckets.set(key, cur);
  }
  out.byBrowser = Array.from(browserBuckets.values())
    .map((b) => Object.assign(b, {
      passPct: b.total === 0 ? 0 : Math.round(b.passed / b.total * 1000) / 10,
    }))
    .sort((a, b) => b.total - a.total);

  // "Error categories": coarse classification of the first error we
  // encounter per failed rerun, by inspecting failed step kinds.
  // Inputs are bounded (one entry per rerun walked) so this loop is
  // sub-millisecond in practice.
  const errorBuckets = new Map();
  for (const r of out.reruns) {
    if (r.status !== 'failed') continue;
    const cat = inferErrorCategory(r);
    errorBuckets.set(cat, (errorBuckets.get(cat) || 0) + 1);
  }
  out.errorCategories = Array.from(errorBuckets.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  // T3.14 — Per-test flakiness scoring → retry-budget recommendations.
  // Group reruns by (framework, projectId, testName) and compute a flake
  // score: 0 if always pass or always fail (deterministic), 1.0 if 50/50.
  // Recommend retries 0–2 based on the score so the rerun engine can
  // dial up retries for genuinely flaky tests without wasting time on
  // stable ones. Local var name distinct from `flakyBuckets` (already
  // used above for flakiestLocators selector aggregation).
  const retryFlakeBuckets = new Map();
  for (const r of out.reruns) {
    if (r.status === 'unknown') continue;
    const key = `${r.framework}|${r.projectId}|${r.testName}`;
    const cur = retryFlakeBuckets.get(key) || {
      framework: r.framework, projectId: r.projectId, testName: r.testName,
      total: 0, passed: 0, failed: 0,
    };
    cur.total++;
    if (r.status === 'passed') cur.passed++;
    else if (r.status === 'failed') cur.failed++;
    retryFlakeBuckets.set(key, cur);
  }
  out.retryRecommendations = Array.from(retryFlakeBuckets.values())
    .filter((t) => t.total >= 2 && t.passed > 0 && t.failed > 0) // both observed
    .map((t) => {
      // Flake = 4 * p * (1-p) — peaks at p=0.5
      const p = t.passed / t.total;
      const flake = Math.round(4 * p * (1 - p) * 100);
      const recommendedRetries = flake >= 60 ? 2 : flake >= 25 ? 1 : 0;
      return { ...t, flakeScore: flake, recommendedRetries };
    })
    .sort((a, b) => b.flakeScore - a.flakeScore)
    .slice(0, 20);

  // T3.15 — Root-cause analysis. Cluster failed reruns by error-message
  // similarity using a tiny shingle-set Jaccard heuristic (no external
  // deps). The goal is a panel like "12 failures share root cause:
  // 'Timeout 10000ms exceeded waiting for #cta'" so users see at a
  // glance whether a wave of red is one underlying issue or many.
  const failedWithMsg = [];
  for (const r of out.reruns) {
    if (r.status !== 'failed' || !Array.isArray(r.results)) continue;
    const firstFail = r.results.find((s) => s && s.success === false && s.error);
    if (firstFail && firstFail.error) {
      failedWithMsg.push({
        rerun: { framework: r.framework, projectId: r.projectId, testName: r.testName, timestamp: r.timestamp },
        message: String(firstFail.error).slice(0, 400),
      });
    }
  }
  const rcaClusters = clusterByMessageSimilarity(failedWithMsg, 0.6);
  out.rootCauses = rcaClusters
    .map((c) => ({
      pattern: c.exemplar.slice(0, 200),
      count: c.members.length,
      affectedTests: Array.from(new Set(c.members.map((m) => m.testName))).slice(0, 10),
      examples: c.members.slice(0, 5).map((m) => ({
        testName: m.testName, projectId: m.projectId, timestamp: m.timestamp, snippet: m.message.slice(0, 120),
      })),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return out;
}

/**
 * T3.15 — Cluster strings by similarity. Greedy single-pass: for each
 * incoming message, attach to the first existing cluster whose exemplar
 * has Jaccard similarity above `threshold`, otherwise start a new
 * cluster. O(n²) worst case but bounded by the rerun count (≤500).
 */
function clusterByMessageSimilarity(items, threshold = 0.6) {
  const clusters = [];
  for (const item of items) {
    const tokens = tokenize(item.message);
    let placed = false;
    for (const c of clusters) {
      const sim = jaccard(tokens, c.tokens);
      if (sim >= threshold) {
        c.members.push({ ...item.rerun, message: item.message });
        // Keep tokens of the SHORTER message (more representative
        // exemplar — long stack-traces dilute clustering).
        if (item.message.length < c.exemplar.length) {
          c.exemplar = item.message;
          c.tokens = tokens;
        }
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({
        exemplar: item.message,
        tokens,
        members: [{ ...item.rerun, message: item.message }],
      });
    }
  }
  return clusters;
}

function tokenize(s) {
  return new Set(
    String(s || '')
      .toLowerCase()
      .replace(/['"`]/g, '')
      .replace(/[^a-z0-9_]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3)
  );
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Coarse error-category classifier. Used by the dashboard's Failure
 * Insights panel. Pure helper; keep heuristic and bounded.
 */
function inferErrorCategory(rerun) {
  if (!rerun || typeof rerun !== 'object') return 'unknown';
  if (rerun.failureCount > 0 && rerun.scrollSteps > 0) return 'visibility / scroll';
  if (rerun.healingHits > 0)                            return 'locator (rescued)';
  if (rerun.failureCount === rerun.executedSteps)       return 'navigation / load';
  if (rerun.failureCount > 0)                           return 'interaction';
  return 'other';
}

/* -------------------------------------------------------------------------- *
 *  Live snapshot (cheap; polled every 2s)                                    *
 * -------------------------------------------------------------------------- */

/**
 * Build a live activity snapshot for the dashboard's "what's happening
 * right now" panel. Pure read on in-memory maps — must stay sub-ms so
 * the 2s polling cost is invisible.
 *
 * @param {Object} opts
 * @param {Map}    opts.activeSessions  browserService.activeSessions
 * @param {Map}    opts.runningReruns   routes/api.js#runningReruns
 * @returns {{
 *   server: { nowIso:string, uptimeSeconds:number, heapUsedMB:number, rssMB:number, loadAvg1m:number|null },
 *   sessions: { count:number, items:Array<{ sessionId:string, ageSeconds:number,
 *                                            actionCount:number, lastUrl:string|null }> },
 *   reruns:   { count:number, items:Array<{ executionId:string,
 *                                            cancelled:boolean, hasBrowser:boolean }> }
 * }}
 */
export function collectLiveSnapshot({ activeSessions, runningReruns } = {}) {
  const now = Date.now();
  const memUsage = process.memoryUsage();

  // os.loadavg() is unix-only — guard for Windows where it returns [0,0,0].
  let loadAvg1m = null;
  try {
    const la = os.loadavg();
    if (Array.isArray(la) && la.length > 0) loadAvg1m = Math.round(la[0] * 100) / 100;
  } catch { /* ignore */ }

  const sessions = { count: 0, items: [] };
  if (activeSessions && typeof activeSessions.forEach === 'function') {
    activeSessions.forEach((sess, sessionId) => {
      sessions.count++;
      // Cap at 20 to keep the live payload small even under heavy load.
      if (sessions.items.length >= 20) return;
      sessions.items.push({
        sessionId,
        ageSeconds: Math.max(0, Math.round((now - (sess.createdAt || now)) / 1000)),
        actionCount: Array.isArray(sess.actions) ? sess.actions.length : 0,
        lastUrl: sess.lastUrl || null,
        idleSeconds: sess.lastActivity
          ? Math.max(0, Math.round((now - sess.lastActivity) / 1000))
          : null,
      });
    });
  }

  const reruns = { count: 0, items: [] };
  if (runningReruns && typeof runningReruns.forEach === 'function') {
    runningReruns.forEach((state, executionId) => {
      reruns.count++;
      if (reruns.items.length >= 20) return;
      reruns.items.push({
        executionId,
        cancelled: !!state.cancelled,
        hasBrowser: !!state.browser,
        // [ZAC-FIX] propagate framework/projectId/testName so the dashboard
        // can light up the right Framework Projection card while the rerun
        // is in flight (was previously only known after it finished).
        framework: state.framework || null,
        projectId: state.projectId || null,
        testName:  state.testName  || null,
        startedAt: state.startedAt || null,
      });
    });
  }

  return {
    server: {
      nowIso: new Date(now).toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      heapUsedMB:    Math.round(memUsage.heapUsed / 1024 / 1024 * 10) / 10,
      rssMB:         Math.round(memUsage.rss / 1024 / 1024 * 10) / 10,
      loadAvg1m,
    },
    sessions,
    reruns,
    // T4.2 — surface the most recently completed rerun so the dashboard's
    // 2-second live poll can detect a new run and pull fresh
    // /api/dashboard/stats immediately, instead of waiting up to 30s
    // for the next aggregate tick.
    lastRerunCompleted: _lastRerunCompleted ? { ..._lastRerunCompleted } : null,
  };
}

// T4.2 — Module-level marker for the most recently completed rerun.
// `markRerunCompleted` is called by routes/api.js#/rerun after the
// per-step persistence block; `collectLiveSnapshot` exposes it so the
// dashboard JS can compare the timestamp on each poll and refresh
// /api/dashboard/stats the moment a run lands. Survives until the next
// rerun completes; cleared on server restart.
let _lastRerunCompleted = null;

// [ZAC-FIX] Authoritative, server-side rerun-history logging.
//
// Previously reports/rerun-history.jsonl was populated ONLY by a frontend
// poller (public/zacFixes.js) that mirrored the single-slot _lastRerunCompleted
// snapshot via /api/runs/append. That mirror was lossy: when reruns completed
// faster than the ~2s dashboard poll (rapid multi-project runs) intermediate
// completions were overwritten in the single slot and never recorded, and when
// NO dashboard tab was open (headless / CI / API-driven reruns) NOTHING was ever
// logged. It also risked phantom rows from the clear operations that call this
// with executionId 'cleared-by-user' / 'locators-cleared'.
//
// The history is now written here, at the server-side completion funnel, so it
// is durable regardless of whether a dashboard is open. markRerunCompleted is
// called more than once per rerun (layout block + main marker), so we dedupe by
// executionId, and we skip the non-rerun clear sentinels.
const _loggedRunIds = new Set();
const _CLEAR_SENTINELS = new Set(['cleared-by-user', 'locators-cleared']);

function _inferTestRunner(framework) {
  if (!framework) return 'unknown';
  if (framework.includes('testng')) return 'testng';
  if (framework.includes('java')) return 'junit';
  if (framework.includes('typescript') || framework.includes('javascript') || framework.includes('playwright')) return 'mocha';
  return 'unknown';
}

async function _appendRerunHistory({ executionId, framework, projectId, testName, success }) {
  const row = {
    id: executionId,
    timestamp: new Date().toISOString(),
    project: projectId || 'unknown',
    framework: framework || 'unknown',
    test_runner: _inferTestRunner(framework),
    status: success ? 'passed' : 'failed',
    duration_ms: 0,
    heal_count: 0,
    deliberate_heal_count: 0,
    total_scenarios: 0,
    passed: 0,
    failed: 0,
    healed: 0,
    test_name: testName || null,
  };
  const reportsDir = path.join(REPO, 'reports');
  await fs.mkdir(reportsDir, { recursive: true });
  await fs.appendFile(path.join(reportsDir, 'rerun-history.jsonl'), JSON.stringify(row) + '\n', 'utf8');
}

export function markRerunCompleted({ executionId, framework, projectId, testName, success } = {}) {
  _lastRerunCompleted = {
    executionId: executionId || null,
    framework: framework || null,
    projectId: projectId || null,
    testName: testName || null,
    success: !!success,
    completedAt: Date.now(),
    completedAtIso: new Date().toISOString(),
  };

  // Durable history append — once per real rerun, skipping clear sentinels.
  if (executionId && !_CLEAR_SENTINELS.has(executionId) && !_loggedRunIds.has(executionId)) {
    _loggedRunIds.add(executionId);
    _appendRerunHistory({ executionId, framework, projectId, testName, success: !!success })
      .catch((e) => console.warn('[ZAC-FIX] rerun-history append failed (non-fatal):', e.message));
  }
}

/** Test hook: clear the marker so subsequent polls report null again. */
export function _clearLastRerunForTests() { _lastRerunCompleted = null; _loggedRunIds.clear(); }
