// [ZAC-FIX] split from routes/api.js
// Shared helpers used by multiple route modules.

import path from 'path';
import { locatorService } from '../services/locatorService.js';
import { LocatorDefinition } from '../models/LocatorDefinition.js';

// ----------------------------------------------------------------------------
// Browser launch arg builder (shared by /api/rerun and /api/execute-test)
// ----------------------------------------------------------------------------
// Tests covering this live in automation-suite/unit-js/launch_args.test.mjs.
// [ZAC-FIX 2026-05-24] Persist a self-contained HTML report alongside
// replay-result.json so users can open the report directly from disk
// (or attach to an email / Jira / Slack) WITHOUT having to navigate
// the dashboard. The dashboard's `/api/dashboard/report/html` endpoint
// already renders the same HTML on-demand from the JSON, but a stale
// JSON-only state on disk meant users had no portable artefact and
// reasonably reported "the rerun didn't generate a report".
//
// Best-effort: a render failure must never break the rerun success
// path (the JSON is the source of truth — HTML is a derived view).
async function persistRerunHtmlReport({ scaffold, replayPayload, framework, projectId, testName }) {
  try {
    const fsp = await import('fs/promises');
    const { renderHtmlReport } = await import('../services/reportRenderer.js');
    const html = renderHtmlReport({
      replayResult: replayPayload,
      reportPath: `${framework}/${projectId}/reruns/${testName}/${scaffold.timestamp}`,
      generatedAt: new Date().toISOString(),
    });
    await fsp.mkdir(scaffold.report, { recursive: true });
    const reportFile = path.join(scaffold.report, 'index.html');
    await fsp.writeFile(reportFile, html, 'utf8');
    return reportFile;
  } catch (err) {
    console.warn('[Rerun] HTML report render failed (replay-result.json is still on disk):', err.message);
    return null;
  }
}

function buildRerunLaunchArgs(browserType, headless) {
  const args = ['--no-sandbox', '--disable-setuid-sandbox'];
  if (!headless && (browserType === 'chromium' || browserType === 'edge')) {
    args.push('--start-maximized');
  }
  return args;
}

// Exposed for unit tests; not part of the public router contract.
export const __testables = { buildRerunLaunchArgs };

// ----------------------------------------------------------------------------
// Helpers for auto-promoting captured locators into the project repo
// ----------------------------------------------------------------------------
// Sanitises a free-form normalizedPageName (e.g. "Shop Html", "Landing Page")
// into a valid Java class prefix ("ShopHtml", "Landing"). Returns null if
// the input cannot be turned into a usable identifier.
function sanitizePageName(name) {
  if (!name || typeof name !== 'string') return null;
  const cleaned = name
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  return cleaned || null;
}

// Sanitises an element description ("add to cart - p-101") into a valid
// camelCase Java field name ("addToCartP101").
function sanitizeElementName(desc) {
  if (!desc || typeof desc !== 'string') return null;
  const parts = desc
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return null;
  return parts
    .map((p, i) => (i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('')
    .replace(/[^a-zA-Z0-9_]/g, '');
}

// Auto-promote stable selectors captured during recording into the project's
// locator repository so Page Objects can be generated. We deliberately only
// promote selectors anchored on stable attributes (id, data-testid, name,
// aria-label) to avoid polluting the repo with brittle nth-child paths.
async function autoPromoteLocatorsFromActions(projectId, actions) {
  if (!projectId || !Array.isArray(actions) || actions.length === 0) return 0;

  const STABLE_KINDS = new Set(['id', 'testId', 'name', 'role']);
  const STABLE_PATTERNS = [
    /^#[A-Za-z][\w-]*$/,                      // #elementId
    /^\[data-testid=["'][^"']+["']\]$/,       // [data-testid="..."]
    /^\[name=["'][^"']+["']\]$/,              // [name="..."]
    /^\[aria-label=["'][^"']+["']\]$/,        // [aria-label="..."]
  ];

  let promoted = 0;
  for (const action of actions) {
    if (!action || typeof action !== 'object') continue;
    const selector = action.selector || action.normalizedSelector;
    if (!selector || typeof selector !== 'string') continue;

    const inferredType = locatorService.inferLocatorType(selector);
    const looksStable = STABLE_KINDS.has(inferredType) || STABLE_PATTERNS.some((re) => re.test(selector));
    if (!looksStable) continue;

    const pageName = sanitizePageName(action.normalizedPageName) || 'Generic';
    const elementName = sanitizeElementName(action.normalizedDescription) || sanitizeElementName(selector) || 'element';

    // Skip if this exact (pageName, elementName) already exists with the same selector
    const existing = await locatorService.getLocatorByPageAndElement(projectId, pageName, elementName);
    if (existing && existing.locatorValue === selector) continue;

    // Convert any pre-recorded fallback selectors to the model's {type,value} shape
    const fallbackList = Array.isArray(action.fallbackSelectors)
      ? action.fallbackSelectors
          .filter((s) => typeof s === 'string' && s && s !== selector)
          .map((s) => ({ type: locatorService.inferLocatorType(s), value: s }))
      : [];

    const locator = new LocatorDefinition({
      pageName,
      elementName,
      locatorType: inferredType,
      locatorValue: selector,
      description: action.normalizedDescription || `${pageName}.${elementName}`,
      fallbackLocators: fallbackList,
    });
    await locatorService.saveLocator(projectId, locator);
    promoted++;
  }
  return promoted;
}

// Helper function to validate and decode projectId from URL params
function validateAndDecodeProjectId(projectIdParam) {
  // Decode projectId from URL (it's already encoded by frontend)
  let projectId = decodeURIComponent(projectIdParam);
  
  // Basic security validation - only allow alphanumeric, dashes, underscores, and dots
  if (!/^[a-zA-Z0-9._-]+$/.test(projectId)) {
    throw new Error('Invalid project ID format');
  }
  
  return projectId;
}

// Named exports consumed by the individual route modules
export {
  persistRerunHtmlReport,
  buildRerunLaunchArgs,
  sanitizePageName,
  sanitizeElementName,
  autoPromoteLocatorsFromActions,
  validateAndDecodeProjectId,
};
