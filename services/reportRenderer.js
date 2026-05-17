/**
 * services/reportRenderer.js
 *
 * Pure renderer that turns a replay-result.json (the JSON shape written
 * by the rerun engine) into a self-contained, downloadable HTML report.
 *
 * Why self-contained:
 *   - The user can save the file to disk and email/share it without
 *     the ZAC server running. All CSS is inlined; no external CDN; no
 *     external images. Screenshots that live next to the JSON are
 *     referenced by relative path so the file works when opened from
 *     the same `/reports/<...>/` directory.
 *
 * Print to PDF:
 *   - The HTML uses an @media print stylesheet that strips the
 *     download banner and switches to a print-friendly layout, so
 *     "File → Print → Save as PDF" produces a clean management report.
 *
 * Pure module: no fs / network / process state. The /api endpoint
 * loads the JSON from disk, calls renderHtmlReport(...), and writes
 * the response. Easy to unit-test (no Express needed).
 */

import path from 'path';

/**
 * @param {Object} input
 * @param {Object} input.replayResult         the parsed replay-result.json
 * @param {string} input.reportPath           "<framework>/<project>/reruns/<test>/<timestamp>"
 *                                            — used purely for display
 * @param {string} [input.generatedAt]        ISO timestamp for the report header
 * @param {Object<string,string>} [input.screenshots]  T2.7 — optional map of
 *                                            filename → data: URL. When
 *                                            provided, step rows embed
 *                                            their matching screenshot as
 *                                            an <img>. Caller (the API
 *                                            endpoint) is responsible for
 *                                            reading the files; this
 *                                            renderer stays pure.
 * @returns {string}                          standalone HTML
 */
export function renderHtmlReport({ replayResult, reportPath, generatedAt, screenshots = {} }) {
  const data = replayResult || {};
  const results = Array.isArray(data.results) ? data.results : [];
  const passed = data.successCount ?? results.filter((r) => r?.success).length;
  const failed = data.failureCount ?? results.filter((r) => r && r.success === false).length;
  const heal = data.healingSummary?.healedSteps
    ?? results.filter((r) => r?.healed).length;
  const duration = data.durationMs ?? results.reduce((s, r) => s + (Number(r?.duration) || 0), 0);
  const status = failed > 0 ? 'FAILED' : (results.length > 0 ? 'PASSED' : 'UNKNOWN');
  const generated = generatedAt || new Date().toISOString();

  const segs = String(reportPath || '').split('/');
  const framework = segs[0] || '';
  const project   = segs[1] || '';
  const testName  = segs[3] || '';
  const timestamp = segs[4] || '';

  const stepRows = results.map((r, i) => renderStepRow(r, i, screenshots)).join('\n');
  const screenshotPanel = renderScreenshotPanel(screenshots);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>ZAC Report — ${escapeHtml(reportPath)}</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #ffffff; color: #1a1a1a; margin: 0; padding: 24px;
  }
  h1 { margin: 0 0 4px 0; font-size: 22px; color: #111; }
  .meta { color: #6b7280; font-size: 12px; margin-bottom: 24px; font-family: monospace; }
  .summary {
    display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px;
    margin-bottom: 24px;
  }
  .stat {
    border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 16px;
    background: #f9fafb;
  }
  .stat .label { color: #6b7280; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .stat .value { font-size: 22px; font-weight: 700; margin-top: 4px; }
  .stat.passed .value { color: #16a34a; }
  .stat.failed .value { color: #dc2626; }
  .stat.amber .value  { color: #d97706; }
  .panel {
    border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px 18px; margin-bottom: 16px;
  }
  .panel h2 { margin: 0 0 12px 0; font-size: 14px; }
  .step {
    display: grid; grid-template-columns: 30px 100px 1fr 80px 100px;
    gap: 12px; padding: 8px 0; border-bottom: 1px solid #f3f4f6;
    font-size: 13px; align-items: center;
  }
  .step .idx { color: #6b7280; text-align: right; font-variant-numeric: tabular-nums; }
  .step .kind {
    font-weight: 600; color: #2563eb;
    font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 12px;
  }
  .step .desc { color: #4b5563; font-family: monospace; font-size: 12px; word-break: break-all; }
  .step .duration { text-align: right; color: #6b7280; font-variant-numeric: tabular-nums; font-size: 12px; }
  .step .status { text-align: right; }
  .pill {
    display: inline-block; padding: 2px 8px; border-radius: 12px;
    font-size: 11px; font-weight: 600; text-transform: uppercase;
  }
  .pill.passed { background: #dcfce7; color: #16a34a; }
  .pill.failed { background: #fee2e2; color: #dc2626; }
  .pill.heal   { background: #ede9fe; color: #7c3aed; }
  .heal-detail {
    margin-left: 142px; margin-top: 4px; padding: 6px 10px;
    background: #faf5ff; border-left: 3px solid #7c3aed;
    font-family: monospace; font-size: 11px; color: #4b5563;
  }
  .heal-detail .from { color: #dc2626; }
  .heal-detail .to   { color: #16a34a; }
  .err-detail {
    margin-left: 142px; margin-top: 4px; padding: 6px 10px;
    background: #fef2f2; border-left: 3px solid #dc2626;
    font-family: monospace; font-size: 11px; color: #991b1b;
  }
  .download-banner {
    background: #eff6ff; border: 1px solid #bfdbfe; padding: 10px 14px;
    border-radius: 6px; font-size: 12px; color: #1e40af; margin-bottom: 16px;
  }
  pre.json {
    background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px;
    padding: 12px; font-family: "SF Mono", Menlo, Consolas, monospace;
    font-size: 11px; color: #1a1a1a; overflow-x: auto; max-height: 400px;
  }
  /* T2.7 — screenshot rendering */
  .step-shot {
    margin: 6px 0 12px 142px; padding: 6px;
    background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px;
    max-width: 480px;
  }
  .step-shot img { max-width: 100%; height: auto; display: block; border-radius: 4px; }
  .shot-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
  }
  .shot-tile {
    margin: 0; padding: 8px;
    background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px;
  }
  .shot-tile img {
    max-width: 100%; height: auto; display: block; border-radius: 4px;
    cursor: zoom-in;
  }
  .shot-tile figcaption {
    font-family: monospace; font-size: 10px; color: #6b7280;
    margin-top: 6px; word-break: break-all;
  }

  /* Print rules — File → Print → Save as PDF produces a clean report. */
  @media print {
    body { padding: 0; font-size: 11px; }
    .download-banner { display: none; }
    .summary { grid-template-columns: repeat(5, 1fr); page-break-inside: avoid; }
    .panel { page-break-inside: avoid; border: 1px solid #ddd; }
    pre.json { max-height: none; overflow: visible; white-space: pre-wrap; }
    a { color: #1a1a1a; text-decoration: none; }
    .step-shot, .shot-tile img { max-width: 100%; }
  }
</style>
</head>
<body>

<div class="download-banner">
  📄 Self-contained HTML report.
  Save this file (Cmd/Ctrl+S) to share. To get a PDF: <strong>File → Print → Save as PDF</strong>.
</div>

<h1>ZAC Rerun Report</h1>
<div class="meta">
  Path:       ${escapeHtml(reportPath)}<br/>
  Framework:  ${escapeHtml(framework)}<br/>
  Project:    ${escapeHtml(project)}<br/>
  Test:       ${escapeHtml(testName)}<br/>
  Timestamp:  ${escapeHtml(timestamp)}<br/>
  Generated:  ${escapeHtml(generated)}
</div>

<div class="summary">
  <div class="stat ${status === 'PASSED' ? 'passed' : status === 'FAILED' ? 'failed' : ''}"><div class="label">Status</div><div class="value">${status}</div></div>
  <div class="stat passed"><div class="label">Steps passed</div><div class="value">${passed}</div></div>
  <div class="stat failed"><div class="label">Steps failed</div><div class="value">${failed}</div></div>
  <div class="stat amber"><div class="label">Healing events</div><div class="value">${heal}</div></div>
  <div class="stat"><div class="label">Duration</div><div class="value">${fmtMs(duration)}</div></div>
</div>

<div class="panel">
  <h2>Step-by-step results</h2>
  ${stepRows || '<p style="color:#6b7280;font-style:italic;">no step results in this report</p>'}
</div>

${screenshotPanel}

<div class="panel">
  <h2>Raw replay-result.json</h2>
  <pre class="json">${escapeHtml(JSON.stringify(data, null, 2))}</pre>
</div>

</body>
</html>`;
}

/* -------------------------------------------------------------------------- *
 *  Helpers                                                                   *
 * -------------------------------------------------------------------------- */

function renderStepRow(r, i, screenshots = {}) {
  const idx = i + 1;
  const kind = escapeHtml(String(r?.step || r?.kind || '?'));
  const desc = escapeHtml(String(r?.description || r?.selector || ''));
  const dur = fmtMs(r?.duration || 0);
  let pill;
  if (r?.healed)               pill = '<span class="pill heal">healed</span>';
  else if (r?.success === false) pill = '<span class="pill failed">failed</span>';
  else                         pill = '<span class="pill passed">passed</span>';

  let detail = '';
  if (r?.healed) {
    detail = `<div class="heal-detail">🩹 self-healed
      ${r?.primarySelector ? `<div>  primary failed: <span class="from">${escapeHtml(r.primarySelector)}</span></div>` : ''}
      ${r?.healedVia       ? `<div>  rescued via:    <span class="to">${escapeHtml(r.healedVia)}</span></div>` : ''}
      ${Array.isArray(r?.healAttempts) ? `<div>  attempted ${r.healAttempts.length} candidate(s)</div>` : ''}
    </div>`;
  } else if (r?.success === false && r?.error) {
    detail = `<div class="err-detail">✖ ${escapeHtml(String(r.error))}</div>`;
  }

  // T2.7 — embed a per-step screenshot when provided. We try several
  // naming conventions so we work with both auto-screenshots
  // ("step-N-failed.png") and explicit user-named ones (r.screenshot).
  let shot = '';
  const candidateNames = [
    r?.screenshot,
    `step-${idx}-failed.png`,
    `step-${idx}.png`,
  ].filter(Boolean);
  for (const name of candidateNames) {
    const url = screenshots[name];
    if (url) {
      shot = `<div class="step-shot"><img src="${url}" alt="screenshot for step ${idx}"/></div>`;
      break;
    }
  }

  return `<div class="step">
    <span class="idx">${idx}</span>
    <span class="kind">${kind}</span>
    <span class="desc">${desc}</span>
    <span class="duration">${dur}</span>
    <span class="status">${pill}</span>
  </div>${detail}${shot}`;
}

/**
 * T2.7 — render an "All screenshots" gallery panel below the step table.
 * Skipped entirely when no screenshots are present.
 */
function renderScreenshotPanel(screenshots = {}) {
  const entries = Object.entries(screenshots || {});
  if (entries.length === 0) return '';
  const tiles = entries.map(([name, url]) => `
    <figure class="shot-tile">
      <img src="${url}" alt="${escapeHtml(name)}"/>
      <figcaption>${escapeHtml(name)}</figcaption>
    </figure>
  `).join('\n');
  return `<div class="panel">
  <h2>Screenshots <span style="color:#6b7280;font-weight:normal;font-size:11px;">(${entries.length})</span></h2>
  <div class="shot-grid">${tiles}</div>
</div>`;
}

function fmtMs(ms) {
  if (!ms || ms < 0) return '—';
  if (ms < 1000) return Math.round(ms) + ' ms';
  return (ms / 1000).toFixed(1) + ' s';
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Helper: validate + decompose a report path string.
 * Throws Error on malformed input. Used by the API endpoint.
 *
 * @param {string} reportPath  expected: "<fw>/<project>/reruns/<test>/<timestamp>"
 * @returns {{ framework, project, testName, timestamp, replayResultPath }}
 */
export function decodeReportPath(reportPath, generatedRoot) {
  if (typeof reportPath !== 'string' || !reportPath.trim()) {
    throw new Error('reportPath is required');
  }
  // Reject any path-traversal attempts up front. The /reports static
  // route already guards this, but the renderer endpoint accepts a
  // body string so we belt-and-suspenders here.
  const normalized = path.posix.normalize(reportPath).replace(/^\/+/, '');
  if (normalized.includes('..')) {
    throw new Error('path traversal not allowed');
  }
  const segs = normalized.split('/');
  if (segs.length !== 5 || segs[2] !== 'reruns') {
    throw new Error(`bad reportPath shape — expected "<fw>/<project>/reruns/<test>/<timestamp>", got "${normalized}"`);
  }
  return {
    framework: segs[0],
    project:   segs[1],
    testName:  segs[3],
    timestamp: segs[4],
    replayResultPath: path.join(generatedRoot, normalized, 'replay-result.json'),
    relPath: normalized,
  };
}
