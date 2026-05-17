/**
 * services/healedLocatorService.js
 *
 * Persists self-healing locator events to a per-project JSON file
 * (`projects/<name>/healed-locators.json`). Kept separate from the main
 * `locators.json` repository so a buggy heal can't poison the source-of-
 * truth locator definitions — the QA engineer reviews this file and
 * decides whether to promote a healed mapping into the canonical store.
 *
 * Schema:
 * {
 *   "version": 1,
 *   "project": "<projectName>",
 *   "updatedAt": "<iso>",
 *   "entries": [
 *     {
 *       "timestamp":        "<iso>",
 *       "pageName":         "ProductsPage" | null,
 *       "elementName":      "addToCartButton" | null,
 *       "primarySelector":  "#add-p-101",
 *       "healedSelector":   "[data-testid=\"add-to-cart-p-101\"]",
 *       "reason":           "primary not found",
 *       "attempts":         [ ... ]
 *     }
 *   ]
 * }
 *
 * Concurrency: a per-project mutex serialises writes from the rerun loop
 * so two simultaneous heals on the same project don't lose entries.
 */

import path from 'path';
import fs from 'fs/promises';

const FILE_NAME = 'healed-locators.json';
const VERSION = 1;
const MAX_ENTRIES = 1000;

// Per-project write lock keyed by projectName. Map<string, Promise<void>>.
const writeLocks = new Map();

function fileFor(projectName) {
  return path.join('projects', projectName, FILE_NAME);
}

async function readJson(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Serialise writes per project so concurrent reruns can't clobber each other.
 */
async function withLock(projectName, fn) {
  const prev = writeLocks.get(projectName) || Promise.resolve();
  let release;
  const next = new Promise((resolve) => { release = resolve; });
  writeLocks.set(projectName, prev.then(() => next));
  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (writeLocks.get(projectName) === next) writeLocks.delete(projectName);
  }
}

/**
 * Append a single heal record. Idempotent on (primarySelector, healedSelector)
 * within a 60-second window — repeated reruns of the same flow won't bloat
 * the file.
 *
 * @param {string} projectName
 * @param {Object} entry
 * @returns {Promise<{file: string, entriesCount: number, deduped: boolean}>}
 */
export async function saveHealRecord(projectName, entry) {
  if (!projectName || typeof projectName !== 'string') {
    throw new Error('saveHealRecord: projectName is required');
  }
  if (!entry || !entry.primarySelector || !entry.healedSelector) {
    throw new Error('saveHealRecord: primarySelector and healedSelector are required');
  }

  return withLock(projectName, async () => {
    const file = fileFor(projectName);
    const existing = (await readJson(file)) || {
      version: VERSION,
      project: projectName,
      updatedAt: new Date().toISOString(),
      entries: [],
    };
    if (!Array.isArray(existing.entries)) existing.entries = [];

    // Idempotence: skip if we already logged this exact heal in the last
    // 60 s. Otherwise the file would grow once per replay.
    const now = Date.now();
    const dedupeWindow = 60_000;
    const duplicate = existing.entries.find((e) => {
      if (!e || e.primarySelector !== entry.primarySelector) return false;
      if (e.healedSelector !== entry.healedSelector) return false;
      const t = Date.parse(e.timestamp || '');
      return Number.isFinite(t) && (now - t) < dedupeWindow;
    });
    if (duplicate) {
      return { file, entriesCount: existing.entries.length, deduped: true };
    }

    existing.entries.push({
      timestamp: entry.timestamp || new Date().toISOString(),
      pageName: entry.pageName || null,
      elementName: entry.elementName || null,
      primarySelector: entry.primarySelector,
      healedSelector: entry.healedSelector,
      reason: entry.reason || 'healed',
      attempts: Array.isArray(entry.attempts) ? entry.attempts : [],
    });

    // Cap the file size to keep CI logs healthy.
    if (existing.entries.length > MAX_ENTRIES) {
      existing.entries = existing.entries.slice(-MAX_ENTRIES);
    }
    existing.updatedAt = new Date().toISOString();
    existing.project = projectName;
    existing.version = VERSION;

    await writeJson(file, existing);
    return { file, entriesCount: existing.entries.length, deduped: false };
  });
}

/**
 * Read all heal records for a project. Returns an empty array if the file
 * doesn't exist (project never healed).
 *
 * @param {string} projectName
 * @returns {Promise<Array>}
 */
export async function listHealedLocators(projectName) {
  if (!projectName) return [];
  const data = await readJson(fileFor(projectName));
  if (!data || !Array.isArray(data.entries)) return [];
  return data.entries;
}

/**
 * Wipe the heal history for a project (used when a project is deleted or
 * when QA wants a clean slate after promoting healed selectors).
 *
 * @param {string} projectName
 */
export async function clearHealedLocators(projectName) {
  if (!projectName) return;
  return withLock(projectName, async () => {
    try {
      await fs.unlink(fileFor(projectName));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  });
}
