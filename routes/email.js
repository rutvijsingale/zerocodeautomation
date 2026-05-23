/**
 * routes/email.js — Email subsystem REST API.
 *
 * Mounted at /api/email by server.js.
 *
 * All endpoints share the same security posture as the rest of the API:
 *   - Helmet CSP headers from server-level middleware.
 *   - Restrictive CORS (already applied at app level).
 *   - generalRateLimiter on read paths, strictRateLimiter on writes/sends.
 *   - getConfig() always redacts the password before returning.
 */

import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { generalRateLimiter, strictRateLimiter } from '../middleware/security.js';
import * as email from '../services/emailService.js';

const router = express.Router();

/**
 * GET /api/email/config — return the current SMTP config (password redacted).
 */
router.get('/config', generalRateLimiter, asyncHandler(async (req, res) => {
  res.json(await email.getConfig());
}));

/**
 * POST /api/email/config — update SMTP config. Empty `password` keeps the
 * existing one (the UI never round-trips the plaintext).
 */
router.post('/config', strictRateLimiter, asyncHandler(async (req, res) => {
  const updated = await email.saveConfig(req.body || {});
  res.json(updated);
}));

/**
 * POST /api/email/test — verify SMTP login without sending.
 */
router.post('/test', strictRateLimiter, asyncHandler(async (req, res) => {
  res.json(await email.testConnection());
}));

/**
 * POST /api/email/send-test — send a tiny test email to confirm end-to-end
 * delivery. Body: { to?, subject? } (defaults to configured recipient).
 */
router.post('/send-test', strictRateLimiter, asyncHandler(async (req, res) => {
  // [ZAC-FIX 2026-05-24] Forward cc + bcc + from in addition to to + subject
  // so the multi-recipient feature actually works through this endpoint.
  // emailService normalises each field (commas, semicolons, arrays).
  const { to, cc, bcc, from, subject } = req.body || {};
  const r = await email.sendMail({
    to, cc, bcc, from,
    subject: subject || '[ZAC] Email subsystem test',
    text: 'This is a test email from the Zero-Code Automation IDE.\n\n' +
          'If you received this, your SMTP credentials are working.\n\n' +
          `Generated at: ${new Date().toISOString()}`,
    html: `<p>This is a test email from the <strong>Zero-Code Automation IDE</strong>.</p>` +
          `<p>If you received this, your SMTP credentials are working.</p>` +
          `<p style="color:#666;font-size:12px">Generated at ${new Date().toISOString()}</p>`,
  });
  res.json(r);
}));

/**
 * POST /api/email/send-rerun — attach a rerun's HTML report and send.
 * Body: { framework, projectId, testName, timestamp, to?, subject?, note? }
 */
router.post('/send-rerun', strictRateLimiter, asyncHandler(async (req, res) => {
  const r = await email.sendRerunReport(req.body || {});
  res.json(r);
}));

/**
 * POST /api/email/send-dashboard — send the current /api/dashboard/stats
 * snapshot as a JSON attachment. We collect fresh stats here rather than
 * trusting client-supplied data, so the email always reflects the
 * authoritative server view.
 *
 * Body: { to?, subject?, note? }
 */
router.post('/send-dashboard', strictRateLimiter, asyncHandler(async (req, res) => {
  const { collectDashboardStats } = await import('../services/dashboardService.js');
  const stats = await collectDashboardStats();
  const r = await email.sendDashboardSummary({ ...(req.body || {}), stats });
  res.json(r);
}));

console.log('[API Routes] Email routes registered:');
console.log('  GET    /api/email/config');
console.log('  POST   /api/email/config');
console.log('  POST   /api/email/test');
console.log('  POST   /api/email/send-test');
console.log('  POST   /api/email/send-rerun');
console.log('  POST   /api/email/send-dashboard');

export default router;
