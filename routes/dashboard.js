// [ZAC-FIX] split from routes/api.js
import express from 'express';
import path from 'path';
import { asyncHandler } from '../middleware/errorHandler.js';
import { generalRateLimiter, strictRateLimiter, pollingRateLimiter } from '../middleware/security.js';
import { browserService } from '../services/browserService.js';
import { runningReruns } from './rerun.js';

const router = express.Router();

// Module-level state for PDF concurrency
const PDF_CONCURRENCY_LIMIT = 2;
let _pdfInFlight = 0;

// ============================================================================
// Orphan cleanup
// ============================================================================
//       paths so the UI can show "Cleaned N orphan dir(s)".
router.post('/dashboard/clean-orphans', strictRateLimiter, asyncHandler(async (req, res) => {
  const confirm = req.body && (req.body.confirm === true || req.body.confirm === 'true');
  if (!confirm) {
    return res.status(400).json({
      success: false,
      error: 'Cleanup requires { "confirm": true } in the request body.',
    });
  }
  try {
    const fsp = await import('fs/promises');
    const repoRoot = path.resolve('.');
    const projectsRoot = path.join(repoRoot, 'projects');
    const genRoot = path.join(repoRoot, 'generated-projects');

    // [ZAC-FIX 2026-05-24] Source of truth: a "real project" is a
    // directory under projects/ that contains a project.json. The
    // earlier dir-presence check treated stub dirs (left by failed
    // saves or harness aborts) as real, which kept inflated counts
    // in the Framework Projection panel even after the user deleted
    // every project. The Recording-tab dropdown uses the same
    // project.json check, so both surfaces now agree.
    const projectDirs = (await fsp.readdir(projectsRoot, { withFileTypes: true }).catch(() => []))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    const realIds = new Set();
    const stubIds = [];
    for (const id of projectDirs) {
      try {
        await fsp.access(path.join(projectsRoot, id, 'project.json'));
        realIds.add(id);
      } catch (_) {
        stubIds.push(id);   // dir exists but no project.json — orphan stub
      }
    }
    // Sweep the stub dirs themselves so subsequent reads of projects/
    // are honest. Best-effort: a permission failure logs + continues.
    const removedStubs = [];
    for (const id of stubIds) {
      try {
        await fsp.rm(path.join(projectsRoot, id), { recursive: true, force: true });
        removedStubs.push(`projects/${id}`);
      } catch (e) {
        console.warn('[API] /clean-orphans: could not remove stub projects/' + id + ':', e.message);
      }
    }

    const frameworks = (await fsp.readdir(genRoot, { withFileTypes: true }).catch(() => []))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    const removed = [];
    const errors = [];
    for (const fw of frameworks) {
      const fwDir = path.join(genRoot, fw);
      const projDirs = (await fsp.readdir(fwDir, { withFileTypes: true }).catch(() => []))
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      for (const projId of projDirs) {
        if (realIds.has(projId)) continue; // not orphan
        const target = path.join(fwDir, projId);
        try {
          await fsp.rm(target, { recursive: true, force: true });
          removed.push(`${fw}/${projId}`);
        } catch (e) {
          errors.push({ path: `${fw}/${projId}`, error: e.message });
        }
      }
    }
    // [ZAC-FIX 2026-05-24] Also compact reports/rerun-history.jsonl —
    // an append-only log that accumulates a row per rerun across the
    // entire dev lifetime. After deleting projects the dashboard's
    // Runner dropdown still pulls 'unknown / mocha / testng / etc.'
    // from this log, even though no current project uses them. Drop
    // every row whose `project` is no longer in projects/.
    let logCompacted = { kept: 0, removed: 0 };
    try {
      const logFile = path.join(repoRoot, 'reports', 'rerun-history.jsonl');
      const text = await fsp.readFile(logFile, 'utf8').catch(() => '');
      if (text) {
        const all = text.split('\n').filter(Boolean).map((l) => {
          try { return JSON.parse(l); } catch { return null; }
        }).filter(Boolean);
        const kept = all.filter((r) => r && r.project && realIds.has(r.project));
        if (kept.length !== all.length) {
          await fsp.writeFile(logFile, kept.map((r) => JSON.stringify(r)).join('\n') + (kept.length ? '\n' : ''), 'utf8');
        }
        logCompacted = { kept: kept.length, removed: all.length - kept.length };
      }
    } catch (e) {
      console.warn('[API] /dashboard/clean-orphans: log compaction failed:', e.message);
    }

    console.log(`[API] /dashboard/clean-orphans: removed ${removedStubs.length} project stub dir(s), ${removed.length} generated-projects mirror(s), ${logCompacted.removed} log rows (errors: ${errors.length})`);
    const totalRemoved = removed.length + removedStubs.length;
    res.json({
      success: true,
      removed,
      removedStubs,        // projects/<id>/ dirs that lacked project.json
      errors,
      removedCount: totalRemoved,
      historyCompacted: logCompacted,
      keptRealProjects: Array.from(realIds),
      message:
        `Cleaned ${removedStubs.length} stub project dir${removedStubs.length === 1 ? '' : 's'}` +
        ` + ${removed.length} orphan generated-project mirror${removed.length === 1 ? '' : 's'}` +
        (logCompacted.removed ? ` + ${logCompacted.removed} stale history row${logCompacted.removed === 1 ? '' : 's'}` : '') + '.',
    });
  } catch (e) {
    console.error('[API] /dashboard/clean-orphans error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}));


// ============================================================================
// Dashboard stats + live + reports
// ============================================================================

router.get('/dashboard/stats', asyncHandler(async (req, res) => {
  // [ZAC-FIX] Default existingOnly=true — the dashboard should reflect
  // projects the user can still load in the Recording tab, not every
  // leftover directory under generated-projects/. Pass ?existingOnly=false
  // to opt back into the old "show everything" view (orphan toggle in UI).
  const { collectDashboardStats } = await import('../services/dashboardService.js');
  const existingOnly = req.query.existingOnly === undefined
    ? true
    : (String(req.query.existingOnly) !== 'false');
  const stats = await collectDashboardStats({ existingOnly });
  res.json(stats);
}));

// Live activity snapshot — what's happening RIGHT NOW. Polled every 2s
// by the dashboard's live panel. Cheap (in-memory only) so we can sustain
// the polling without affecting recorder/rerun throughput.
//
// Includes `lastRerunCompleted` (set by markRerunCompleted from the rerun
// finalize block) so the dashboard can detect a freshly-completed rerun
// and refresh the heavier /api/dashboard/stats endpoint without polling
// it on a fixed schedule.
router.get('/dashboard/live', asyncHandler(async (req, res) => {
  const { collectLiveSnapshot } = await import('../services/dashboardService.js');
  const snap = collectLiveSnapshot({
    activeSessions: browserService.activeSessions,
    runningReruns,
  });
  res.json(snap);
}));

// Self-contained HTML report download for a single rerun.
// Query: ?path=<fw>/<project>/reruns/<test>/<timestamp>
// Headers force a download; the file embeds all CSS so it works offline
// and prints cleanly to PDF (File → Print → Save as PDF).
// [ZAC-FIX 2026-05-24] List the artefacts (files in each subdir)
// produced for one rerun so the report.html page can render real
// per-file links instead of broken directory-listing links.
//
// /reports/<path> serves files via express.static({index:false}),
// which intentionally returns 404 on a bare directory. Without
// this endpoint the user sees broken links for report/, screenshots/,
// videos/, traces/, logs/.
//
// Response shape:
//   {
//     ok: true,
//     replayResult: { url, bytes },              // top-level
//     htmlReport:   { url, bytes } | null,       // report/index.html
//     report:       Array<{ name, url, bytes }>, // report/* (excl. index.html)
//     screenshots:  Array<{ name, url, bytes }>,
//     videos:       Array<{ name, url, bytes }>,
//     traces:       Array<{ name, url, bytes }>,
//     logs:         Array<{ name, url, bytes }>,
//   }
router.get('/dashboard/list-files', asyncHandler(async (req, res) => {
  const reportPath = String(req.query.path || '');
  if (!reportPath) return res.status(400).json({ ok: false, error: 'Missing ?path=' });
  const fsp = await import('fs/promises');
  const pathLib = await import('path');
  const { decodeReportPath } = await import('../services/reportRenderer.js');
  let parts;
  try {
    parts = decodeReportPath(reportPath, pathLib.resolve('generated-projects'));
  } catch (e) {
    return res.status(400).json({ ok: false, error: `Bad path: ${e.message}` });
  }
  const rerunRoot = pathLib.dirname(parts.replayResultPath);
  async function listDir(name) {
    try {
      const dir = pathLib.join(rerunRoot, name);
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      const out = [];
      for (const e of entries) {
        if (!e.isFile()) continue;
        const stat = await fsp.stat(pathLib.join(dir, e.name)).catch(() => ({ size: 0 }));
        out.push({
          name: e.name,
          url: `/reports/${reportPath}/${name}/${encodeURIComponent(e.name)}`,
          bytes: stat.size,
        });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    } catch (_) { return []; }
  }
  const [reportFiles, screenshots, videos, traces, logs] = await Promise.all([
    listDir('report'), listDir('screenshots'), listDir('videos'), listDir('traces'), listDir('logs'),
  ]);
  // Promote the rendered HTML report (if present) to a top-level field.
  const htmlIdx = reportFiles.findIndex(f => f.name === 'index.html');
  let htmlReport = null;
  if (htmlIdx >= 0) {
    htmlReport = reportFiles[htmlIdx];
    reportFiles.splice(htmlIdx, 1);
  }
  let replayBytes = 0;
  try { replayBytes = (await fsp.stat(parts.replayResultPath)).size; } catch (_) {}
  res.json({
    ok: true,
    replayResult: { url: `/reports/${reportPath}/replay-result.json`, bytes: replayBytes },
    htmlReport,
    report: reportFiles,
    screenshots, videos, traces, logs,
  });
}));

router.get('/dashboard/report/html', asyncHandler(async (req, res) => {
  const reportPath = String(req.query.path || '');
  if (!reportPath) return res.status(400).send('Missing ?path=<framework>/<project>/reruns/<test>/<timestamp>');

  const { renderHtmlReport, decodeReportPath } = await import('../services/reportRenderer.js');
  const fsp = await import('fs/promises');
  const pathLib = await import('path');

  let parts;
  try {
    parts = decodeReportPath(reportPath, pathLib.resolve('generated-projects'));
  } catch (e) {
    return res.status(400).send(`Bad path: ${e.message}`);
  }

  let replay;
  try {
    replay = JSON.parse(await fsp.readFile(parts.replayResultPath, 'utf8'));
  } catch (e) {
    return res.status(404).send(`replay-result.json not found at ${parts.relPath}`);
  }

  // T2.7 — read any PNG/JPG/WEBP under reruns/<ts>/screenshots/ and pass
  // them as base64 data URLs so the resulting HTML is fully self-contained
  // (works offline, in email, in archive). Cap each image at ~2 MB so a
  // pathological 4K screenshot doesn't bloat the report past memory.
  const screenshots = {};
  try {
    const shotsDir = path.dirname(parts.replayResultPath) + '/screenshots';
    const entries = await fsp.readdir(shotsDir, { withFileTypes: true }).catch(() => []);
    const TWO_MB = 2 * 1024 * 1024;
    const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const ext = pathLib.extname(ent.name).toLowerCase();
      const mime = MIME_BY_EXT[ext];
      if (!mime) continue;
      const filePath = pathLib.join(shotsDir, ent.name);
      const stat = await fsp.stat(filePath).catch(() => null);
      if (!stat || stat.size > TWO_MB) continue;
      const buf = await fsp.readFile(filePath).catch(() => null);
      if (!buf) continue;
      screenshots[ent.name] = `data:${mime};base64,${buf.toString('base64')}`;
    }
  } catch (e) {
    console.warn('[Report] screenshot load failed (non-fatal):', e.message);
  }

  const html = renderHtmlReport({
    replayResult: replay,
    reportPath: parts.relPath,
    generatedAt: new Date().toISOString(),
    screenshots,
  });
  // Friendly file-name: <framework>-<project>-<test>-<timestamp>.html
  const filename = `${parts.framework}-${parts.project}-${parts.testName}-${parts.timestamp}.html`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(html);
}));

// T3.9 — Native PDF download. Renders the same HTML report we serve at
// /report/html and runs it through Playwright's headless `page.pdf()`,
// honouring the report's print stylesheet (banner hidden, full-bleed
// step table, screenshots embedded as data URLs). Output is a real
// PDF, not a "save-as-pdf-from-print-dialog" workaround.
//
// Note: this spawns a short-lived Chromium instance for each request.
// We cap concurrent PDF renders inline so a flood of requests can't
// exhaust file handles. The first PDF after server boot is slower
// (~1.5s) due to Chromium cold start; subsequent renders are <500ms.
router.get('/dashboard/report/pdf', generalRateLimiter, asyncHandler(async (req, res) => {
  if (_pdfInFlight >= PDF_CONCURRENCY_LIMIT) {
    return res.status(429).json({ error: 'PDF render queue full; retry shortly.' });
  }
  const reportPath = String(req.query.path || '');
  if (!reportPath) return res.status(400).send('Missing ?path=<framework>/<project>/reruns/<test>/<timestamp>');

  const { renderHtmlReport, decodeReportPath } = await import('../services/reportRenderer.js');
  const fsp = await import('fs/promises');
  const pathLib = await import('path');

  let parts;
  try {
    parts = decodeReportPath(reportPath, pathLib.resolve('generated-projects'));
  } catch (e) {
    return res.status(400).send(`Bad path: ${e.message}`);
  }

  let replay;
  try {
    replay = JSON.parse(await fsp.readFile(parts.replayResultPath, 'utf8'));
  } catch (e) {
    return res.status(404).send(`replay-result.json not found at ${parts.relPath}`);
  }

  // Reuse the exact same HTML the /report/html endpoint emits — single
  // source of truth, so PDF and HTML can never drift apart.
  const screenshots = {};
  try {
    const shotsDir = pathLib.dirname(parts.replayResultPath) + '/screenshots';
    const entries = await fsp.readdir(shotsDir, { withFileTypes: true }).catch(() => []);
    const TWO_MB = 2 * 1024 * 1024;
    const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const ext = pathLib.extname(ent.name).toLowerCase();
      const mime = MIME_BY_EXT[ext];
      if (!mime) continue;
      const filePath = pathLib.join(shotsDir, ent.name);
      const stat = await fsp.stat(filePath).catch(() => null);
      if (!stat || stat.size > TWO_MB) continue;
      const buf = await fsp.readFile(filePath).catch(() => null);
      if (!buf) continue;
      screenshots[ent.name] = `data:${mime};base64,${buf.toString('base64')}`;
    }
  } catch { /* ignore */ }

  const html = renderHtmlReport({
    replayResult: replay,
    reportPath: parts.relPath,
    generatedAt: new Date().toISOString(),
    screenshots,
  });

  _pdfInFlight++;
  let browser = null;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 15000 });
    // Force the print media so our @media print rules fire — the HTML
    // already has print styles that hide the download banner, etc.
    await page.emulateMedia({ media: 'print' });
    const pdfBuf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
    });
    await browser.close().catch(() => {});
    browser = null;

    const filename = `${parts.framework}-${parts.project}-${parts.testName}-${parts.timestamp}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuf);
  } catch (e) {
    if (browser) try { await browser.close(); } catch { /* ignore */ }
    res.status(500).json({ error: 'PDF render failed: ' + e.message });
  } finally {
    _pdfInFlight = Math.max(0, _pdfInFlight - 1);
  }
}));

// T4.4 — Dashboard "Clear" endpoint. Destructive: removes rerun data
// under generated-projects/<framework>/<project>/reruns/. Filter-aware:
// when `framework` or `projectId` is provided, ONLY entries matching
// the filter are removed — runs that the user filtered TO see are
// preserved by default. Pass `preserve: true` to invert (keep only
// the filtered subset, clear everything else).
//
// Behaviour matrix:
//   • body = {}                            → clear ALL rerun dirs (every project)
//   • body = { framework: 'playwright-java' } → clear only that framework's reruns
//   • body = { framework, projectId }       → clear only that project's reruns
//   • body = { projectId, preserve: true }  → clear EVERYTHING EXCEPT that project
//   • body = { confirm: true } MUST be present — guard against accidents
router.post('/dashboard/clear', strictRateLimiter, asyncHandler(async (req, res) => {
  const {
    framework = null,
    projectId = null,
    preserve = false,
    confirm = false,
    // [ZAC-FIX 2026-05-24] New scoping options requested by QA:
    //   testName        — limit to one test name within a project's reruns/
    //   timestamp       — limit to ONE specific rerun (the YYYY...Z dir)
    //   olderThanDays   — only remove rerun timestamps older than N days
    testName = null,
    timestamp = null,
    olderThanDays = null,
  } = req.body || {};
  if (!confirm) {
    return res.status(400).json({
      success: false,
      error: 'Destructive: pass { confirm: true } to proceed. See body schema.',
    });
  }
  const fsp = await import('fs/promises');
  const pathLib = await import('path');
  const GENERATED_ROOT = pathLib.resolve('generated-projects');
  // Compute the cutoff once. Reruns whose mtime is *older* than the
  // cutoff get deleted; everything newer is preserved.
  const cutoffMs = (typeof olderThanDays === 'number' && olderThanDays > 0)
    ? Date.now() - olderThanDays * 24 * 60 * 60 * 1000
    : null;

  const removed = [];
  const skipped = [];

  // Walk generated-projects/<framework>/<projectId>/reruns/* and delete
  // the entire reruns subtree (or matching subset). We never touch the
  // surrounding project (pom.xml, page-objects, features, etc.) — only
  // the reruns/ directory, so re-runs can start fresh.
  const frameworkDirs = await fsp.readdir(GENERATED_ROOT, { withFileTypes: true }).catch(() => []);
  for (const fwEnt of frameworkDirs) {
    if (!fwEnt.isDirectory()) continue;
    const fwName = fwEnt.name;

    // Framework-level filtering. When both `framework` and `projectId` are
    // supplied, defer the framework check to the project loop so the
    // "preserve a SPECIFIC project" path works correctly.
    if (framework && !projectId) {
      if (!preserve && fwName !== framework) { skipped.push({ framework: fwName, reason: 'framework-mismatch' }); continue; }
      if (preserve  && fwName === framework) { skipped.push({ framework: fwName, reason: 'preserved-framework' }); continue; }
    }
    if (framework && projectId && fwName !== framework) {
      // Both filters set + this framework doesn't match → skip silently
      // regardless of preserve mode (the user is targeting one specific
      // project; other frameworks aren't candidates).
      skipped.push({ framework: fwName, reason: 'framework-mismatch' });
      continue;
    }

    const fwRoot = pathLib.join(GENERATED_ROOT, fwName);
    const projectDirs = await fsp.readdir(fwRoot, { withFileTypes: true }).catch(() => []);
    for (const pjEnt of projectDirs) {
      if (!pjEnt.isDirectory()) continue;
      const pjName = pjEnt.name;
      if (projectId && !preserve && pjName !== projectId) { skipped.push({ framework: fwName, project: pjName, reason: 'project-mismatch' }); continue; }
      if (projectId && preserve && pjName === projectId) { skipped.push({ framework: fwName, project: pjName, reason: 'preserved-project' }); continue; }
      const rerunsDir = pathLib.join(fwRoot, pjName, 'reruns');
      try {
        const stat = await fsp.stat(rerunsDir).catch(() => null);
        if (!stat || !stat.isDirectory()) {
          skipped.push({ framework: fwName, project: pjName, reason: 'no-reruns-dir' });
          continue;
        }
        // [ZAC-FIX 2026-05-24] Granular delete: when testName / timestamp /
        // olderThanDays is set, walk the rerun tree and delete only the
        // matching timestamp directories instead of nuking the whole
        // reruns/ subtree.
        const isGranular = (testName || timestamp || cutoffMs !== null);
        let rerunCount = 0;
        if (isGranular) {
          const tests = await fsp.readdir(rerunsDir, { withFileTypes: true }).catch(() => []);
          for (const t of tests) {
            if (!t.isDirectory()) continue;
            if (testName && t.name !== testName) continue;
            const testDir = pathLib.join(rerunsDir, t.name);
            const tsDirs = await fsp.readdir(testDir, { withFileTypes: true }).catch(() => []);
            for (const tsEnt of tsDirs) {
              if (!tsEnt.isDirectory()) continue;
              if (timestamp && tsEnt.name !== timestamp) continue;
              const tsPath = pathLib.join(testDir, tsEnt.name);
              if (cutoffMs !== null) {
                const tsStat = await fsp.stat(tsPath).catch(() => null);
                if (!tsStat || tsStat.mtimeMs >= cutoffMs) continue; // newer → preserve
              }
              await fsp.rm(tsPath, { recursive: true, force: true });
              rerunCount++;
            }
          }
          if (rerunCount > 0) {
            removed.push({ framework: fwName, project: pjName, rerunsRemoved: rerunCount,
              filter: { testName, timestamp, olderThanDays } });
          } else {
            skipped.push({ framework: fwName, project: pjName, reason: 'no-matching-runs' });
          }
        } else {
          // Bulk path: count + nuke + recreate empty dir for project scaffold.
          const tests = await fsp.readdir(rerunsDir, { withFileTypes: true }).catch(() => []);
          for (const t of tests) {
            if (!t.isDirectory()) continue;
            const tsDirs = await fsp.readdir(pathLib.join(rerunsDir, t.name), { withFileTypes: true }).catch(() => []);
            rerunCount += tsDirs.filter((d) => d.isDirectory()).length;
          }
          await fsp.rm(rerunsDir, { recursive: true, force: true });
          await fsp.mkdir(rerunsDir, { recursive: true }).catch(() => {});
          removed.push({ framework: fwName, project: pjName, rerunsRemoved: rerunCount });
        }
      } catch (e) {
        skipped.push({ framework: fwName, project: pjName, reason: 'error: ' + e.message });
      }
    }
  }

  // T4.2 — bump the rerun-completed marker so connected dashboards
  // refresh their stats immediately after a clear (otherwise the stat
  // cards would lag for up to 30s showing stale totals).
  try {
    const { markRerunCompleted } = await import('../services/dashboardService.js');
    markRerunCompleted({ executionId: 'cleared-by-user', framework, projectId, success: true });
  } catch (_) { /* best-effort */ }

  const total = removed.reduce((s, r) => s + r.rerunsRemoved, 0);
  res.json({
    success: true,
    removed,
    skipped,
    rerunsRemoved: total,
    filter: { framework, projectId, preserve },
  });
}));

// (POST /api/dashboard/clear is registered earlier in this file with the
//  full preserve-flag contract. Don't add a second handler here — Express
//  would silently call only the first one and the second would be dead code.)
console.log('  GET    /api/dashboard/report/pdf?path=...');
console.log('  POST   /api/dashboard/clear  body={framework?, projectId?, preserve?, confirm:true}');

// ----------------------------------------------------------------------------
// [ZAC-FIX] /dashboard/framework-summary — per-framework projection cards
// ----------------------------------------------------------------------------
// Aggregates the existing /api/dashboard/stats output into one row per
// framework so the dashboard can render a card grid showing:
//   - project count
//   - total reruns
//   - passed / failed counts
//   - pass rate
//   - heal event count
//   - latest run timestamp
//   - link target for "show only this framework's runs"
// Pure read; no destructive ops. Cheap (delegates to collectDashboardStats).
router.get('/dashboard/framework-summary', pollingRateLimiter, asyncHandler(async (req, res) => {
  const { collectDashboardStats } = await import('../services/dashboardService.js');
  const existingOnly = req.query.existingOnly === undefined
    ? true
    : (String(req.query.existingOnly) !== 'false');
  const stats = await collectDashboardStats({ existingOnly });
  const byFw = new Map();
  // Seed with all frameworks ZAC knows about so a framework with 0 runs
  // still gets a card (and the QA can see "selenium-testng — 0 projects").
  for (const f of stats.frameworks || []) {
    byFw.set(f.id, {
      framework: f.id,
      projectCount: f.projectCount || 0,
      totalReruns: 0,
      passed: 0,
      failed: 0,
      healed: 0,
      lastRunAt: null,
      lastRun: null,
    });
  }
  for (const r of stats.reruns || []) {
    if (!byFw.has(r.framework)) {
      byFw.set(r.framework, {
        framework: r.framework, projectCount: 0,
        totalReruns: 0, passed: 0, failed: 0, healed: 0,
        lastRunAt: null, lastRun: null,
      });
    }
    const row = byFw.get(r.framework);
    row.totalReruns++;
    if (r.status === 'passed') row.passed++;
    else if (r.status === 'failed') row.failed++;
    row.healed += Number(r.healingHits || 0);
    if (!row.lastRunAt || (r.timestamp || '') > row.lastRunAt) {
      row.lastRunAt = r.timestamp || null;
      row.lastRun = {
        projectId: r.projectId,
        testName: r.testName,
        status: r.status,
        // Same shape as dashboard.js#reportHref so the card link goes to
        // the existing report viewer.
        reportPath: `${r.framework}/${r.projectId}/reruns/${r.testName}/${r.timestamp}`,
      };
    }
  }
  // Add per-framework projects from stats.projects (covers projects that
  // never had a rerun yet).
  for (const p of stats.projects || []) {
    if (!byFw.has(p.framework)) {
      byFw.set(p.framework, {
        framework: p.framework, projectCount: 0,
        totalReruns: 0, passed: 0, failed: 0, healed: 0,
        lastRunAt: null, lastRun: null,
      });
    }
  }
  const rows = Array.from(byFw.values()).map(r => ({
    ...r,
    passRatePct: r.totalReruns === 0 ? null
      : Math.round((r.passed / r.totalReruns) * 1000) / 10,
  }));
  // Sort: most active first, then by projectCount desc, then alphabetic.
  rows.sort((a, b) => {
    if (b.totalReruns !== a.totalReruns) return b.totalReruns - a.totalReruns;
    if (b.projectCount !== a.projectCount) return b.projectCount - a.projectCount;
    return String(a.framework).localeCompare(String(b.framework));
  });
  res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    frameworks: rows,
    totals: {
      frameworks: rows.length,
      projects: rows.reduce((s, r) => s + r.projectCount, 0),
      reruns: rows.reduce((s, r) => s + r.totalReruns, 0),
      heals: rows.reduce((s, r) => s + r.healed, 0),
    },
  });
}));
console.log('  GET    /api/dashboard/framework-summary');

// ----------------------------------------------------------------------------
// [ZAC-FIX] /dashboard/clear-locators — wipe healed-locators.json files
// ----------------------------------------------------------------------------
// The existing /dashboard/clear only removes reruns/ subtrees. The
// "Locator-stability snapshot" panel ALSO reads from healed-locators.json
// files which previously had no clear path, so the panel kept showing
// stale heal counts. This endpoint wipes them.
//
// Body: { projectId?, framework?, confirm:true }
//   • {} + confirm:true                       → wipe ALL projects' heal logs
//   • { projectId, confirm:true }             → wipe just that project
//   • { framework, confirm:true }             → wipe every project under a framework
//
// Targets two locations because the heal log can be written to either:
//   1. projects/<projectId>/healed-locators.json    (recording-time)
//   2. generated-projects/<framework>/<projectId>/locators/healed-locators.json (rerun-time)
router.post('/dashboard/clear-locators', strictRateLimiter, asyncHandler(async (req, res) => {
  const { framework = null, projectId = null, confirm = false, includeRerunHistory = true } = req.body || {};
  if (!confirm) {
    return res.status(400).json({ ok: false, error: 'Destructive: pass { confirm: true } to proceed.' });
  }
  const fsp = await import('fs/promises');
  const pathLib = (await import('path')).default;
  const PROJECTS_ROOT = pathLib.resolve('projects');
  const GENERATED_ROOT = pathLib.resolve('generated-projects');

  const cleared = [];
  const skipped = [];
  // [ZAC-FIX] expanded scope: ALSO zero healingHits in replay-result.json so
  // the Locator-stability snapshot's "Healing events" column actually goes
  // to 0 (its source is the rerun results file, not healed-locators.json).
  // Set includeRerunHistory:false in the body to keep the old behaviour.
  const rerunHealsZeroed = [];

  async function tryClear(filePath, meta) {
    try {
      const stat = await fsp.stat(filePath).catch(() => null);
      if (!stat || !stat.isFile()) {
        skipped.push({ ...meta, reason: 'no-heal-log' });
        return;
      }
      await fsp.writeFile(filePath, JSON.stringify({ entries: [], clearedAt: new Date().toISOString() }, null, 2));
      cleared.push({ ...meta, file: filePath });
    } catch (e) {
      skipped.push({ ...meta, reason: 'error: ' + e.message });
    }
  }

  async function zeroHealingHitsInRerunResults(projectRoot, meta) {
    try {
      const rerunsDir = pathLib.join(projectRoot, 'reruns');
      const stat = await fsp.stat(rerunsDir).catch(() => null);
      if (!stat || !stat.isDirectory()) return;
      // Walk reruns/<testName>/<timestamp>/replay-result.json and zero the
      // healingHits counters. Preserve everything else so the timing,
      // pass/fail, and step records survive the reset.
      const tests = await fsp.readdir(rerunsDir, { withFileTypes: true }).catch(() => []);
      for (const t of tests) {
        if (!t.isDirectory()) continue;
        const tsDirs = await fsp.readdir(pathLib.join(rerunsDir, t.name), { withFileTypes: true }).catch(() => []);
        for (const ts of tsDirs) {
          if (!ts.isDirectory()) continue;
          const replayPath = pathLib.join(rerunsDir, t.name, ts.name, 'replay-result.json');
          try {
            const raw = await fsp.readFile(replayPath, 'utf8');
            const data = JSON.parse(raw);
            const before = Number(data.healingHits || 0);
            if (before === 0) continue;
            data.healingHits = 0;
            data.healingHitsClearedAt = new Date().toISOString();
            // Also zero per-step healing flags if present.
            if (Array.isArray(data.results)) {
              for (const step of data.results) {
                if (step && step.healed) step.healed = false;
              }
            }
            await fsp.writeFile(replayPath, JSON.stringify(data, null, 2));
            rerunHealsZeroed.push({ ...meta, test: t.name, timestamp: ts.name, healingHitsWas: before });
          } catch (_) { /* skip unreadable / non-json */ }
        }
      }
    } catch (_) { /* skip */ }
  }

  // 1) Recording-time logs in projects/<id>/healed-locators.json
  const projectDirs = await fsp.readdir(PROJECTS_ROOT, { withFileTypes: true }).catch(() => []);
  for (const ent of projectDirs) {
    if (!ent.isDirectory()) continue;
    if (projectId && ent.name !== projectId) { skipped.push({ scope: 'projects', project: ent.name, reason: 'project-mismatch' }); continue; }
    await tryClear(
      pathLib.join(PROJECTS_ROOT, ent.name, 'healed-locators.json'),
      { scope: 'projects', project: ent.name }
    );
  }

  // 2) Rerun-time logs (and optionally their healingHits counters) under
  //    generated-projects/<fw>/<pj>/{locators,reruns}/.
  const fwDirs = await fsp.readdir(GENERATED_ROOT, { withFileTypes: true }).catch(() => []);
  for (const fwEnt of fwDirs) {
    if (!fwEnt.isDirectory()) continue;
    if (framework && fwEnt.name !== framework) { skipped.push({ scope: 'generated', framework: fwEnt.name, reason: 'framework-mismatch' }); continue; }
    const fwRoot = pathLib.join(GENERATED_ROOT, fwEnt.name);
    const pjDirs = await fsp.readdir(fwRoot, { withFileTypes: true }).catch(() => []);
    for (const pjEnt of pjDirs) {
      if (!pjEnt.isDirectory()) continue;
      if (projectId && pjEnt.name !== projectId) { skipped.push({ scope: 'generated', framework: fwEnt.name, project: pjEnt.name, reason: 'project-mismatch' }); continue; }
      const meta = { scope: 'generated', framework: fwEnt.name, project: pjEnt.name };
      const projectRoot = pathLib.join(fwRoot, pjEnt.name);
      await tryClear(pathLib.join(projectRoot, 'locators', 'healed-locators.json'), meta);
      if (includeRerunHistory) {
        await zeroHealingHitsInRerunResults(projectRoot, meta);
      }
    }
  }

  // Bump the live marker so the dashboard re-fetches stats.
  try {
    const { markRerunCompleted } = await import('../services/dashboardService.js');
    markRerunCompleted({ executionId: 'locators-cleared', framework, projectId, success: true });
  } catch (_) { /* best-effort */ }

  console.log(`[ZAC-FIX] cleared ${cleared.length} heal log(s) + zeroed healingHits in ${rerunHealsZeroed.length} replay-result(s) (framework=${framework}, project=${projectId})`);
  res.json({
    ok: true,
    cleared,
    skipped,
    rerunHealsZeroed,
    totalCleared: cleared.length,
    totalRerunHealsZeroed: rerunHealsZeroed.length,
  });
}));
console.log('  POST   /api/dashboard/clear-locators body={framework?, projectId?, confirm:true}');

export default router;
