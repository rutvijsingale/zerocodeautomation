// [ZAC-FIX] split from routes/api.js
import express from 'express';
import { asyncHandler, createHealthResponse } from '../middleware/errorHandler.js';
import { generalRateLimiter, pollingRateLimiter } from '../middleware/security.js';
import { browserService } from '../services/browserService.js';

const router = express.Router();


// Health check endpoint
router.get('/health', (req, res) => {
  createHealthResponse(req, res);
});

/* -------------------------------------------------------------------------- *
 *  Framework registry + project layout endpoints                             *
 *                                                                            *
 *  Gives the UI a single source of truth for supported frameworks (so the    *
 *  dropdown can be populated dynamically) and lets any client materialize    *
 *  the canonical generated-projects/<framework>/<project>/ folder tree on    *
 *  demand. See services/projectLayout.js + config/frameworks.json.           *
 * -------------------------------------------------------------------------- */

// List supported frameworks. Sourced from config/frameworks.json which itself
// is sourced from the existing generators/UI dropdowns — no fabricated entries.
// [ZAC-FIX] Was generalRateLimiter (100/15min). Bumped to pollingRateLimiter
// because every iframe boot, recorder load, and framework-summary cycle
// hits this — easy to exhaust the strict budget under normal use.
router.get('/frameworks', pollingRateLimiter, asyncHandler(async (req, res) => {
  const { listFrameworks } = await import('../services/projectLayout.js');
  const frameworks = await listFrameworks();
  res.json({ frameworks });
}));

// [ZAC-FIX] Configurable DB engines for dbQuery steps. Lets the IDE populate a
// "Database" dropdown; the chosen id is stored on the project as
// project.dbConfig.engine and drives the generated driver dependency +
// connection code. Connection values themselves come from env at run time
// (DB_URL/DB_USER/DB_PASS, or DB_FILE for sqlite) — never hard-coded.
router.get('/db/engines', pollingRateLimiter, asyncHandler(async (req, res) => {
  const { DB_ENGINES } = await import('../generators/db-config.js');
  const engines = Object.values(DB_ENGINES).map((e) => ({
    id: e.id,
    label: e.label,
    connectionEnv: e.node.driver === 'sqlite' ? ['DB_FILE'] : ['DB_URL', 'DB_USER', 'DB_PASS'],
  }));
  res.json({ engines, default: 'auto' });
}));

// Get configuration
// [ZAC-FIX] Same reason as /frameworks — boot-time fetch on every tab load.
router.get('/config', pollingRateLimiter, (req, res) => {
  res.json({
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    appName: process.env.APP_NAME || 'Zero‑Code Automation IDE',
    defaultBrowser: process.env.DEFAULT_BROWSER || 'chromium',
    maxSessions: browserService.maxSessions,
    sessionTimeout: browserService.sessionTimeout,
    version: process.env.npm_package_version || '1.0.0'
  });
});

export default router;
