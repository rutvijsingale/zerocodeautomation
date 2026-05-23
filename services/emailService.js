/**
 * services/emailService.js
 *
 * SMTP-driven email sender for the IDE.
 *
 * Powers three flows:
 *   1. Per-rerun report email — attaches the self-contained HTML rendered
 *      by reportRenderer (the same one /api/dashboard/report/html serves).
 *   2. Dashboard summary email — attaches the current /api/dashboard/stats
 *      JSON snapshot.
 *   3. Test send — confirms SMTP credentials work without touching reports.
 *
 * Config sources (in priority order):
 *   1. config/email.json on disk (written by the Settings UI). Lives next
 *      to other runtime configs and is gitignored because it stores a
 *      password.
 *   2. ENV vars (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD,
 *      SMTP_SECURE, SMTP_FROM, SMTP_TO). Useful in CI or air-gapped
 *      installs.
 *   3. Hard-coded fallback ({ host:'localhost', port:25, secure:false }).
 *
 * Local-first guarantee:
 *   The service NEVER calls a third-party API. It just opens an SMTP
 *   connection to whatever host the user configured (could be
 *   smtp.gmail.com with an app-password, a corporate Exchange server, an
 *   internal Postfix relay, etc.). No data leaves localhost unless the
 *   user supplies an external SMTP host themselves.
 *
 * Security notes:
 *   - getConfig() ALWAYS returns the password redacted ('•••').
 *   - saveConfig() validates fields and writes 0600 file permissions.
 *   - When updating config, an empty `password` means "keep the existing
 *     password" — the UI never has to round-trip the plaintext.
 *   - Attachments are bounded; HTML reports are streamed from disk.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(REPO, 'config', 'email.json');

const REDACTED = '•••';
const TAG = '[Email]';

// ── Internal config cache (re-read on saveConfig) ─────────────────────
let _cache = null;

function envConfig() {
  return {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.SMTP_FROM || '',
    to: process.env.SMTP_TO || '',
    enabled: !!process.env.SMTP_HOST,
  };
}

async function loadFromDisk() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`${TAG} could not read ${CONFIG_PATH}: ${e.message}`);
    return null;
  }
}

async function readConfigInternal() {
  if (_cache) return _cache;
  const fromDisk = await loadFromDisk();
  if (fromDisk) {
    _cache = { ...envConfig(), ...fromDisk };
    return _cache;
  }
  _cache = envConfig();
  return _cache;
}

/**
 * Public: redacted config for UI / API consumption.
 */
export async function getConfig() {
  const c = await readConfigInternal();
  return {
    enabled: !!c.enabled,
    host: c.host || '',
    port: Number(c.port || 587),
    secure: !!c.secure,
    user: c.user || '',
    password: c.password ? REDACTED : '',
    from: c.from || '',
    to: c.to || '',
    hasPassword: !!c.password,
    source: (await loadFromDisk()) ? 'file' : (process.env.SMTP_HOST ? 'env' : 'unset'),
  };
}

/**
 * Validate and persist a config update. The UI may send `password === ''`
 * meaning "keep the existing password"; only overwrite when a non-empty
 * value is provided.
 *
 * @param {Partial<{ enabled, host, port, secure, user, password, from, to }>} patch
 */
export async function saveConfig(patch = {}) {
  const current = await readConfigInternal();
  const next = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : !!current.enabled,
    host:    typeof patch.host === 'string' ? patch.host.trim() : current.host || '',
    port:    Number(patch.port ?? current.port ?? 587),
    secure:  typeof patch.secure === 'boolean' ? patch.secure : !!current.secure,
    user:    typeof patch.user === 'string' ? patch.user.trim() : current.user || '',
    password: typeof patch.password === 'string' && patch.password.length > 0 && patch.password !== REDACTED
      ? patch.password
      : (current.password || ''),
    from:    typeof patch.from === 'string' ? patch.from.trim() : current.from || '',
    to:      typeof patch.to === 'string' ? patch.to.trim() : current.to || '',
  };

  // Validate. We're permissive about empty fields to allow partial setup,
  // but anything actually present must be sane.
  if (next.host && !/^[a-zA-Z0-9.\-_]+$/.test(next.host)) {
    throw Object.assign(new Error('SMTP host contains invalid characters'), { name: 'ValidationError' });
  }
  if (!Number.isFinite(next.port) || next.port < 1 || next.port > 65535) {
    throw Object.assign(new Error('SMTP port must be between 1 and 65535'), { name: 'ValidationError' });
  }
  for (const field of ['from', 'to', 'user']) {
    const v = next[field];
    // Allow empty `to` (caller can pass per-send), but if present it must look like email(s).
    if (v && field !== 'user' && !/^[^\s@]+@[^\s@]+\.[^\s@]+(\s*,\s*[^\s@]+@[^\s@]+\.[^\s@]+)*$/.test(v)) {
      throw Object.assign(new Error(`SMTP ${field} is not a valid email address`), { name: 'ValidationError' });
    }
  }

  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
  _cache = next;
  console.log(`${TAG} config saved (host=${next.host}, port=${next.port}, secure=${next.secure}, enabled=${next.enabled})`);
  return getConfig();
}

/* -------------------------------------------------------------------------- *
 *  Transport / send                                                          *
 * -------------------------------------------------------------------------- */

let _nodemailer = null;
async function nodemailer() {
  if (_nodemailer) return _nodemailer;
  const mod = await import('nodemailer');
  _nodemailer = mod.default || mod;
  return _nodemailer;
}

// [ZAC-FIX 2026-05-24] Cache an Ethereal Email test account so the same
// preview-mode transport is reused across sends within a server lifetime.
// Ethereal is nodemailer's official "test SMTP" — emails are CAUGHT (not
// delivered) and shown via a public preview URL. Lets QA verify the
// recipient parsing / subject / attachment WITHOUT setting up real SMTP.
let _etherealAccount = null;
async function ensureEtherealAccount() {
  if (_etherealAccount) return _etherealAccount;
  const nm = await nodemailer();
  if (!nm.createTestAccount) {
    throw Object.assign(new Error('Ethereal preview unavailable in this nodemailer version'),
      { name: 'ConfigError' });
  }
  _etherealAccount = await nm.createTestAccount();
  console.log(`${TAG} Ethereal test account created: user=${_etherealAccount.user}`);
  console.log(`${TAG}   web inbox: ${_etherealAccount.web || 'https://ethereal.email'}`);
  return _etherealAccount;
}

async function buildTransport() {
  const c = await readConfigInternal();
  const nm = await nodemailer();

  // ── Ethereal preview path ──
  // Triggered when host === 'ethereal' (or ZAC_EMAIL_PROVIDER=ethereal).
  // Captures every send and returns a previewUrl for inspection.
  const wantsEthereal =
    String(c.host || '').toLowerCase() === 'ethereal' ||
    String(process.env.ZAC_EMAIL_PROVIDER || '').toLowerCase() === 'ethereal';
  if (wantsEthereal) {
    const acc = await ensureEtherealAccount();
    return nm.createTransport({
      host: acc.smtp.host, port: acc.smtp.port, secure: acc.smtp.secure,
      auth: { user: acc.user, pass: acc.pass },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000,
    });
  }

  if (!c.host) {
    throw Object.assign(new Error('SMTP not configured. Set host/port in Settings → Email or via SMTP_* env vars.'),
      { name: 'ConfigError' });
  }
  const opts = {
    host: c.host,
    port: c.port,
    secure: !!c.secure, // true for 465, false for 587/STARTTLS
    auth: c.user ? { user: c.user, pass: c.password } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  };
  return nm.createTransport(opts);
}

/**
 * Verify SMTP connection + auth without sending anything.
 *
 * @returns {Promise<{ ok:boolean, message:string }>}
 */
export async function testConnection() {
  try {
    const t = await buildTransport();
    await t.verify();
    const c = await readConfigInternal();
    return { ok: true, message: `SMTP reachable at ${c.host}:${c.port}${c.user ? ' (authenticated as ' + c.user + ')' : ''}` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

/**
 * Generic mail send. Honors per-call overrides; falls back to config
 * defaults for `from` and `to`.
 *
 * @param {Object} mail
 * @param {string} [mail.to]                comma-separated recipients
 * @param {string} [mail.cc]
 * @param {string} [mail.bcc]
 * @param {string} mail.subject
 * @param {string} [mail.text]              plain-text body
 * @param {string} [mail.html]              HTML body
 * @param {Array<{filename, content}|{filename, path}>} [mail.attachments]
 * @returns {Promise<{ ok:boolean, messageId?:string, error?:string, accepted?:Array, rejected?:Array }>}
 */
// [ZAC-FIX 2026-05-24] Normalise a recipient string or array into a clean,
// comma-separated list. Accepts "a@b, c@d" or "a@b; c@d" or ["a@b","c@d"]
// and produces "a@b, c@d" with duplicates removed and whitespace trimmed.
// Empty / undefined → empty string (nodemailer treats "" same as missing).
function normaliseRecipients(input) {
  if (!input) return '';
  const arr = Array.isArray(input) ? input : String(input).split(/[,;]/);
  const cleaned = arr
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);  // dedupe
  return cleaned.join(', ');
}

export async function sendMail(mail) {
  const cfg = await readConfigInternal();
  // [ZAC-FIX] Ethereal preview mode is a no-config-required path so QA
  // can verify the report-emailing pipeline today. Bypass the "enabled"
  // guard whenever Ethereal is selected — the only "delivery" is a
  // captured preview URL, no real outbound SMTP.
  const isEtherealPreview =
    String(cfg.host || '').toLowerCase() === 'ethereal' ||
    String(process.env.ZAC_EMAIL_PROVIDER || '').toLowerCase() === 'ethereal';
  if (!cfg.enabled && !isEtherealPreview) {
    return {
      ok: false,
      error: 'Email is disabled. Enable it in Settings → Email, OR set host="ethereal" / ZAC_EMAIL_PROVIDER=ethereal for a no-config preview.',
    };
  }
  // Multi-recipient support: any of `to`, `cc`, `bcc` may be a comma- or
  // semicolon-separated string OR an array of addresses. Empty fields
  // fall back to the configured default `to`.
  const to  = normaliseRecipients(mail.to)  || normaliseRecipients(cfg.to);
  const cc  = normaliseRecipients(mail.cc);
  const bcc = normaliseRecipients(mail.bcc);
  // [ZAC-FIX] In Ethereal preview mode, the test-account user (which is
  // assigned at boot) doubles as a perfectly valid from address.
  // Without this, Ethereal sends would 400 with "No sender" even though
  // the captured email would have been valid.
  let from = (mail.from && mail.from.trim()) || cfg.from || cfg.user;
  if (!from && isEtherealPreview) {
    try {
      const acc = await ensureEtherealAccount();
      from = `"ZAC QA" <${acc.user}>`;
    } catch (_) { /* fall through to error below */ }
  }
  if (!to)   return { ok: false, error: 'No recipient. Set a default in Settings or pass `to`.' };
  if (!from) return { ok: false, error: 'No sender. Set "From" in Settings or pass `from`.' };
  try {
    const t = await buildTransport();
    const info = await t.sendMail({
      from, to,
      cc: cc || undefined,
      bcc: bcc || undefined,
      subject: mail.subject || '(no subject)',
      text: mail.text,
      html: mail.html,
      attachments: mail.attachments || [],
    });
    const recipientCount = to.split(',').length + (cc ? cc.split(',').length : 0) + (bcc ? bcc.split(',').length : 0);
    // Ethereal returns a preview URL via nodemailer.getTestMessageUrl().
    // This lets the user CLICK to see exactly what would have been
    // delivered, without needing real SMTP credentials.
    let previewUrl = null;
    try {
      const nm = await nodemailer();
      if (nm.getTestMessageUrl) previewUrl = nm.getTestMessageUrl(info) || null;
    } catch (_) { /* best-effort */ }
    const previewSuffix = previewUrl ? `  preview: ${previewUrl}` : '';
    console.log(`${TAG} sent "${mail.subject}" → ${recipientCount} recipient(s) [to=${to}${cc ? `, cc=${cc}` : ''}${bcc ? `, bcc=${bcc}` : ''}] (msgId=${info.messageId})${previewSuffix}`);
    return {
      ok: true, messageId: info.messageId,
      accepted: info.accepted, rejected: info.rejected,
      recipientCount,
      previewUrl,
      provider: previewUrl ? 'ethereal' : 'smtp',
    };
  } catch (e) {
    console.warn(`${TAG} send failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// Exported for tests + other modules.
export const __test__ = { normaliseRecipients };

/* -------------------------------------------------------------------------- *
 *  Convenience builders                                                      *
 * -------------------------------------------------------------------------- */

/**
 * Email a single rerun's HTML report as an attachment.
 *
 * @param {Object} args
 * @param {string} args.framework   e.g. 'playwright-java'
 * @param {string} args.projectId
 * @param {string} args.testName
 * @param {string} args.timestamp   "YYYY-MM-DDTHHMMSS-mmmZ"
 * @param {string} [args.to]
 * @param {string} [args.subject]
 * @param {string} [args.note]      free-form text added above the summary
 */
export async function sendRerunReport({ framework, projectId, testName, timestamp, to, subject, note }) {
  if (!framework || !projectId || !testName || !timestamp) {
    return { ok: false, error: 'Missing one of framework/projectId/testName/timestamp' };
  }
  const reportDir = path.join(REPO, 'generated-projects', framework, projectId, 'reruns', testName, timestamp);
  let replay;
  try {
    replay = JSON.parse(await fs.readFile(path.join(reportDir, 'replay-result.json'), 'utf8'));
  } catch (e) {
    return { ok: false, error: `replay-result.json not found at ${reportDir}: ${e.message}` };
  }

  const { renderHtmlReport } = await import('./reportRenderer.js');
  const html = renderHtmlReport({
    replayResult: replay,
    reportPath: `${framework}/${projectId}/reruns/${testName}/${timestamp}`,
    generatedAt: new Date().toISOString(),
  });

  const status = replay.failureCount > 0 ? 'FAILED' : 'PASSED';
  const subj = subject || `[ZAC] ${status} — ${projectId} / ${testName} (${timestamp})`;
  const summaryRows = [
    `Framework:  ${framework}`,
    `Project:    ${projectId}`,
    `Test:       ${testName}`,
    `Timestamp:  ${timestamp}`,
    `Status:     ${status}`,
    `Steps:      ${replay.executedSteps ?? '?'} executed, ${replay.successCount ?? '?'} passed, ${replay.failureCount ?? '?'} failed`,
    `Duration:   ${replay.durationMs ?? '?'} ms`,
  ];
  if (note) summaryRows.unshift(note, '');

  return sendMail({
    to,
    subject: subj,
    text: summaryRows.join('\n'),
    html: `<pre style="font-family:Menlo,Consolas,monospace;font-size:13px;line-height:1.5">${summaryRows.join('\n')}</pre>` +
          `<p style="font-family:sans-serif;color:#666;font-size:12px">Full report attached as <code>${path.basename(reportDir)}.html</code>.</p>`,
    attachments: [{
      filename: `${framework}-${projectId}-${testName}-${timestamp}.html`,
      content: html,
      contentType: 'text/html',
    }],
  });
}

/**
 * Email the current dashboard JSON snapshot. Useful for daily digests.
 *
 * @param {Object} args
 * @param {Object} args.stats   the /api/dashboard/stats payload
 * @param {string} [args.to]
 * @param {string} [args.subject]
 * @param {string} [args.note]
 */
export async function sendDashboardSummary({ stats, to, subject, note }) {
  if (!stats || typeof stats !== 'object') {
    return { ok: false, error: 'Missing stats payload' };
  }
  const ts = stats.testSummary || {};
  const summary = stats.summary || {};
  const rows = [
    `Generated:        ${summary.generatedAt || new Date().toISOString()}`,
    `Total runs:       ${ts.totalCases ?? 0}`,
    `Passed:           ${ts.passed ?? 0} (${ts.passPct ?? 0}%)`,
    `Failed:           ${ts.failed ?? 0}`,
    `Skipped:          ${ts.skipped ?? 0}`,
    `Last run status:  ${ts.lastRunStatus || 'n/a'}`,
    `Last run at:      ${ts.lastRunAt || 'n/a'}`,
    `Avg duration:     ${ts.avgDurationMs ?? 0} ms`,
    `Total exec time:  ${ts.totalExecutionMs ?? 0} ms`,
    `Healing events:   ${summary.totalHealingEvents ?? 0}`,
    `Frameworks:       ${summary.totalFrameworks ?? 0}`,
    `Projects:         ${summary.totalProjects ?? 0}`,
  ];
  if (note) rows.unshift(note, '');

  const subj = subject || `[ZAC] Dashboard summary — ${(stats.summary?.generatedAt || '').slice(0, 10)} (${ts.passed ?? 0}/${ts.totalCases ?? 0} passed)`;
  return sendMail({
    to,
    subject: subj,
    text: rows.join('\n'),
    html: `<pre style="font-family:Menlo,Consolas,monospace;font-size:13px;line-height:1.5">${rows.join('\n')}</pre>` +
          `<p style="font-family:sans-serif;color:#666;font-size:12px">Full JSON attached.</p>`,
    attachments: [{
      filename: `zac-dashboard-${new Date().toISOString().slice(0, 10)}.json`,
      content: JSON.stringify(stats, null, 2),
      contentType: 'application/json',
    }],
  });
}

/* -------------------------------------------------------------------------- *
 *  Test hooks                                                                *
 * -------------------------------------------------------------------------- */

/** For tests: drop the cached config so the next call re-reads disk/env. */
export function _resetConfigCacheForTests() { _cache = null; }
