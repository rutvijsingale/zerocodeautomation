/**
 * Unit tests for services/dashboardService.js#collectLiveSnapshot.
 *
 * Hard contracts under test:
 *   1. Empty maps → counts of 0, items=[], no exceptions.
 *   2. Active sessions are reported with sessionId, ageSeconds (≥0),
 *      actionCount, lastUrl, idleSeconds.
 *   3. Running reruns are reported with executionId, cancelled,
 *      hasBrowser flags.
 *   4. items[] is capped at 20 even if maps hold more — keeps the live
 *      payload bounded under load.
 *   5. Server snapshot includes uptime, heap, RSS, ISO timestamp.
 *   6. Function tolerates undefined / missing inputs (graceful degradation).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { collectLiveSnapshot } from '../../services/dashboardService.js';

test('collectLiveSnapshot: empty inputs return zeroed snapshot, no throws', () => {
  const snap = collectLiveSnapshot({ activeSessions: new Map(), runningReruns: new Map() });
  assert.equal(snap.sessions.count, 0);
  assert.deepEqual(snap.sessions.items, []);
  assert.equal(snap.reruns.count, 0);
  assert.deepEqual(snap.reruns.items, []);
});

test('collectLiveSnapshot: undefined inputs degrade gracefully', () => {
  const snap = collectLiveSnapshot();
  assert.equal(snap.sessions.count, 0);
  assert.equal(snap.reruns.count, 0);
  assert.ok(snap.server);
});

test('collectLiveSnapshot: server block always populated', () => {
  const snap = collectLiveSnapshot({ activeSessions: new Map(), runningReruns: new Map() });
  assert.ok(typeof snap.server.uptimeSeconds === 'number' && snap.server.uptimeSeconds >= 0);
  assert.ok(typeof snap.server.heapUsedMB === 'number' && snap.server.heapUsedMB > 0);
  assert.ok(typeof snap.server.rssMB === 'number' && snap.server.rssMB > 0);
  assert.match(snap.server.nowIso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  // loadAvg1m is null on Windows; numeric on unix. Just check it parses.
  assert.ok(snap.server.loadAvg1m === null || typeof snap.server.loadAvg1m === 'number');
});

test('collectLiveSnapshot: active session reports id + age + action count + url', () => {
  const sessions = new Map();
  const sess = {
    createdAt: Date.now() - 5_000, // 5s ago
    actions: [{}, {}, {}],
    lastUrl: 'https://example.com',
    lastActivity: Date.now() - 1_000,
  };
  sessions.set('sess-abc-123', sess);

  const snap = collectLiveSnapshot({ activeSessions: sessions, runningReruns: new Map() });
  assert.equal(snap.sessions.count, 1);
  assert.equal(snap.sessions.items.length, 1);
  const item = snap.sessions.items[0];
  assert.equal(item.sessionId, 'sess-abc-123');
  assert.ok(item.ageSeconds >= 4 && item.ageSeconds <= 7,
    `ageSeconds should be ~5s, got ${item.ageSeconds}`);
  assert.equal(item.actionCount, 3);
  assert.equal(item.lastUrl, 'https://example.com');
  assert.ok(typeof item.idleSeconds === 'number' && item.idleSeconds >= 0);
});

test('collectLiveSnapshot: running rerun reports id + cancelled + hasBrowser', () => {
  const reruns = new Map();
  reruns.set('exec-1', { cancelled: false, browser: { fake: true } });
  reruns.set('exec-2', { cancelled: true,  browser: null });

  const snap = collectLiveSnapshot({ activeSessions: new Map(), runningReruns: reruns });
  assert.equal(snap.reruns.count, 2);
  const ids = snap.reruns.items.map((r) => r.executionId).sort();
  assert.deepEqual(ids, ['exec-1', 'exec-2']);
  const e1 = snap.reruns.items.find((r) => r.executionId === 'exec-1');
  const e2 = snap.reruns.items.find((r) => r.executionId === 'exec-2');
  assert.equal(e1.cancelled, false);
  assert.equal(e1.hasBrowser, true);
  assert.equal(e2.cancelled, true);
  assert.equal(e2.hasBrowser, false);
});

test('collectLiveSnapshot: items[] capped at 20, count keeps the true total', () => {
  const sessions = new Map();
  for (let i = 0; i < 50; i++) {
    sessions.set(`sess-${i}`, { createdAt: Date.now(), actions: [], lastUrl: null, lastActivity: Date.now() });
  }
  const snap = collectLiveSnapshot({ activeSessions: sessions, runningReruns: new Map() });
  assert.equal(snap.sessions.count, 50, 'count must reflect true map size');
  assert.equal(snap.sessions.items.length, 20, 'items[] must be capped to bound payload size');
});

test('collectLiveSnapshot: tolerates partial session shapes', () => {
  // Sometimes a session ends up partially-constructed (race condition).
  // Snapshot must NOT throw — it just substitutes safe defaults.
  const sessions = new Map();
  sessions.set('partial-1', {}); // no createdAt, no actions, no lastUrl

  const snap = collectLiveSnapshot({ activeSessions: sessions, runningReruns: new Map() });
  assert.equal(snap.sessions.count, 1);
  const item = snap.sessions.items[0];
  assert.equal(item.sessionId, 'partial-1');
  assert.equal(item.actionCount, 0);
  assert.equal(item.lastUrl, null);
});
