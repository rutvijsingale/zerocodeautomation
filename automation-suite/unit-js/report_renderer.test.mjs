/**
 * Unit tests for services/reportRenderer.js — the self-contained HTML
 * report renderer + path validator.
 *
 * Hard contracts under test:
 *   1. renderHtmlReport returns a complete <html>…</html> document with
 *      no external CDN / no broken script src / no absolute paths.
 *   2. The report includes status, step counts, healing count, duration.
 *   3. The report HTML-escapes user-controlled fields (no XSS risk if
 *      a recorded selector contains < or ").
 *   4. @media print rules are present so File→Print→Save as PDF works.
 *   5. decodeReportPath rejects malformed input (path traversal, bad
 *      shape) and accepts well-formed input.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';

import { renderHtmlReport, decodeReportPath } from '../../services/reportRenderer.js';

const SAMPLE_REPLAY = {
  executedSteps: 4,
  successCount: 3,
  failureCount: 1,
  durationMs: 12345,
  scrollSummary: { scrollSteps: 1, successfulScrolls: 1 },
  healingSummary: { healingEvents: 1, healedSteps: 1 },
  results: [
    { step: 'navigate', success: true,  duration: 1500 },
    { step: 'click',    success: true,  duration: 450, healed: true,
      primarySelector: '#stale', healedVia: '[data-testid="login"]', healAttempts: [{}, {}] },
    { step: 'type',     success: true,  duration: 300, description: 'email field' },
    { step: 'click',    success: false, duration: 5000, error: 'Timeout 5000ms exceeded' },
  ],
};

test('renderHtmlReport: returns a complete standalone HTML document', () => {
  const html = renderHtmlReport({
    replayResult: SAMPLE_REPLAY,
    reportPath: 'playwright-java/demo/reruns/login/2026-05-04T010000-000Z',
  });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<\/html>\s*$/);
  // No external CDN / no <script src=...>
  assert.equal(/<script[^>]+src\s*=/.test(html), false,
    'report must not pull external scripts');
  assert.equal(/<link[^>]+href\s*=\s*["']https?:\/\//.test(html), false,
    'report must not pull external stylesheets');
  // CSS lives inline.
  assert.match(html, /<style>[\s\S]*<\/style>/);
});

test('renderHtmlReport: surfaces status / counts / duration', () => {
  const html = renderHtmlReport({
    replayResult: SAMPLE_REPLAY,
    reportPath: 'playwright-java/demo/reruns/login/2026-05-04T010000-000Z',
  });
  assert.match(html, /FAILED/);                    // 1 failure → overall FAILED
  assert.match(html, />3</);                       // passed = 3
  assert.match(html, />1</);                       // failed = 1 OR healed = 1
  assert.match(html, /12\.3 s/);                   // duration formatted
  assert.match(html, /1500/);                      // first step duration listed in raw json (visible)
});

test('renderHtmlReport: includes step list with healed + failed indicators', () => {
  const html = renderHtmlReport({
    replayResult: SAMPLE_REPLAY,
    reportPath: 'playwright-java/demo/reruns/login/2026-05-04T010000-000Z',
  });
  // Healed pill present, primary + rescued shown (HTML-escaped form).
  assert.match(html, /class="pill heal">healed</);
  assert.match(html, /#stale/);
  assert.match(html, /\[data-testid=&quot;login&quot;\]/);
  // Failed pill + error text present
  assert.match(html, /class="pill failed">failed</);
  assert.match(html, /Timeout 5000ms exceeded/);
});

test('renderHtmlReport: HTML-escapes user-controlled fields (no XSS)', () => {
  const dangerous = {
    results: [
      { step: 'click', success: false, duration: 100,
        description: '<script>alert(1)</script>',
        error: '"><img src=x onerror=alert(1)>',
        primarySelector: '<svg/onload=alert(1)>',
        healedVia: '"><script>',
      },
    ],
  };
  const html = renderHtmlReport({
    replayResult: dangerous,
    reportPath: 'playwright-java/demo/reruns/x/x',
  });
  // No raw <script> tag from the dangerous fields anywhere in the body.
  assert.equal(html.includes('<script>alert(1)</script>'), false,
    'description must be escaped');
  assert.equal(html.includes('<img src=x onerror=alert(1)>'), false,
    'error must be escaped');
  assert.equal(html.includes('<svg/onload=alert(1)>'), false,
    'primarySelector must be escaped');
  // The escaped form must appear instead.
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('renderHtmlReport: includes @media print rules for clean PDF output', () => {
  const html = renderHtmlReport({
    replayResult: SAMPLE_REPLAY,
    reportPath: 'playwright-java/demo/reruns/login/2026-05-04T010000-000Z',
  });
  assert.match(html, /@media print/);
  assert.match(html, /\.download-banner\s*\{[^}]*display:\s*none/);
});

test('renderHtmlReport: passes through metadata in the header', () => {
  const html = renderHtmlReport({
    replayResult: SAMPLE_REPLAY,
    reportPath: 'selenium-java/amazon/reruns/login/2026-05-04T010000-000Z',
    generatedAt: '2026-05-04T01:00:00.000Z',
  });
  assert.match(html, /Framework:\s+selenium-java/);
  assert.match(html, /Project:\s+amazon/);
  assert.match(html, /Test:\s+login/);
  assert.match(html, /Generated:\s+2026-05-04T01:00:00\.000Z/);
});

/* -------------------------------------------------------------------------- *
 *  decodeReportPath                                                          *
 * -------------------------------------------------------------------------- */

test('decodeReportPath: accepts well-formed path', () => {
  const r = decodeReportPath(
    'playwright-java/demo/reruns/login/2026-05-04T010000-000Z',
    '/abs/generated-projects'
  );
  assert.equal(r.framework, 'playwright-java');
  assert.equal(r.project,   'demo');
  assert.equal(r.testName,  'login');
  assert.equal(r.timestamp, '2026-05-04T010000-000Z');
  assert.equal(r.replayResultPath,
    path.join('/abs/generated-projects', 'playwright-java/demo/reruns/login/2026-05-04T010000-000Z/replay-result.json'));
});

test('decodeReportPath: rejects path traversal attempts', () => {
  for (const bad of [
    '../etc/passwd',
    'playwright-java/../../../etc/passwd',
    'playwright-java/demo/reruns/login/../../../secret',
  ]) {
    assert.throws(() => decodeReportPath(bad, '/abs'),
      /traversal|bad reportPath/i,
      `path traversal "${bad}" must be rejected`);
  }
});

test('decodeReportPath: rejects empty / non-string / wrong-shape input', () => {
  for (const bad of ['', null, undefined, 'too/short', 'a/b/c/d/e/f/g/h']) {
    assert.throws(() => decodeReportPath(bad, '/abs'),
      `bad input "${bad}" must be rejected`);
  }
});

test('decodeReportPath: requires "reruns" as the third segment', () => {
  assert.throws(() => decodeReportPath('fw/proj/notReruns/test/ts', '/abs'),
    /bad reportPath shape/);
});
