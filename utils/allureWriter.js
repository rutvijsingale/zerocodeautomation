/**
 * Allure result writer.
 *
 * After every rerun, ZAC's persistence block writes:
 *   - <rerunDir>/replay-result.json   (canonical IR)
 *   - <rerunDir>/report/index.html    (self-contained HTML report)
 *
 * This module ALSO writes Allure-format result files so users can run
 *
 *   allure serve <rerunDir>/allure-results
 *   allure generate <rerunDir>/allure-results -o <rerunDir>/allure-report --clean
 *
 * to get the full Allure UI (charts, history, attachments) without us
 * having to bundle the Allure HTML ourselves.
 *
 * Spec we follow (Allure 2 schema):
 *   <uuid>-result.json            — one per scenario / case
 *   <uuid>-attachment.<ext>       — attachments referenced by uuid
 *   environment.properties        — env metadata shown in the dashboard
 *   executor.json                 — info about the runner (ZAC)
 *   categories.json               — failure-bucket rules (optional)
 *
 * Reference: https://allurereport.org/docs/test-results-format/
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const uuid = () => crypto.randomUUID
  ? crypto.randomUUID()
  : crypto.randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');

/**
 * Map ZAC step result → Allure status enum.
 *   passed | failed | broken | skipped | unknown
 */
function allureStatus(stepResult) {
  if (!stepResult) return 'unknown';
  if (stepResult.success === true)  return 'passed';
  if (stepResult.success === false) return 'failed';
  return 'unknown';
}

function allureRunStatus(failureCount, hardFailureCount) {
  if (!failureCount) return 'passed';
  if (hardFailureCount > 0) return 'failed';
  return 'broken';   // soft failures only
}

/**
 * Convert a single ZAC step result row → an Allure step entry.
 * ZAC stores duration in ms on r.duration; some rows have r.startedAt
 * but most don't, so we fake start/stop relative to the run's start.
 */
function toAllureSteps(results, runStartedAt) {
  const steps = [];
  let cursor = runStartedAt;
  for (const r of (results || [])) {
    const duration = Number(r.duration) || 0;
    const start = cursor;
    const stop = cursor + duration;
    cursor = stop;
    const labelBits = [r.step || r.kind || 'step'];
    if (r.selector)      labelBits.push(`"${r.selector}"`);
    else if (r.url)      labelBits.push(`→ ${r.url}`);
    const stepEntry = {
      name: labelBits.join(' '),
      status: allureStatus(r),
      stage: 'finished',
      start, stop,
      attachments: [],
      parameters: [],
    };
    if (r.success === false && r.error) {
      stepEntry.statusDetails = {
        message: String(r.error).slice(0, 1000),
        trace: String(r.errorStack || r.error || '').slice(0, 4000),
      };
    }
    if (r.healing && r.healing.healed) {
      stepEntry.parameters.push({ name: 'healed', value: 'true' });
      if (r.healing.healedVia) stepEntry.parameters.push({ name: 'healedVia', value: String(r.healing.healedVia) });
    }
    steps.push(stepEntry);
  }
  return steps;
}

/**
 * Write the full set of Allure files for a single rerun.
 *
 * @param {Object} args
 * @param {string} args.rerunDir       absolute path to the rerun output dir
 * @param {Object} args.scaffold       layout.ensureRerunScaffold result
 * @param {Object} args.replayPayload  the JSON we already wrote to replay-result.json
 * @param {string} args.framework
 * @param {string} args.projectId
 * @param {string} args.testName
 * @returns {Promise<string|null>}     allure-results dir path, or null on failure
 */
export async function writeAllureResults({ rerunDir, replayPayload, framework, projectId, testName }) {
  try {
    const dir = path.join(rerunDir, 'allure-results');
    await fs.mkdir(dir, { recursive: true });

    const runUuid = uuid();
    const historyId = crypto.createHash('sha256')
      .update(`${framework}|${projectId}|${testName}`)
      .digest('hex')
      .slice(0, 32);

    // Run timing — derive from replayPayload (which already has totals).
    // duration in payload looks like "13.20s"; parse back to ms.
    const totalMs = (() => {
      const m = String(replayPayload.duration || '').match(/(\d+(?:\.\d+)?)/);
      return m ? Math.round(parseFloat(m[1]) * 1000) : 0;
    })();
    // Walk the results to compute start/stop. We don't have an absolute
    // start, so pin "stop" to "now" and "start" to now - totalMs so the
    // Allure timeline is at least proportional.
    const stop = Date.now();
    const start = stop - totalMs;

    const failureCount = Number(replayPayload.failureCount) || 0;
    const hardFailureCount = Number(replayPayload.hardFailureCount) || 0;
    const status = allureRunStatus(failureCount, hardFailureCount);

    // Build attachments list from existing files in the rerun dir
    // (screenshots/ + videos/ + logs/network.har + logs/steps.log).
    const attachments = [];
    async function tryAttach(absPath, mediaType, displayName) {
      try {
        const stat = await fs.stat(absPath);
        if (!stat.isFile() || stat.size === 0) return;
        const ext = path.extname(absPath) || '';
        const attachUuid = uuid();
        const targetName = `${attachUuid}-attachment${ext}`;
        // Allure expects attachments INSIDE allure-results/, alongside the
        // *-result.json. Copy rather than symlink so the dir is portable.
        await fs.copyFile(absPath, path.join(dir, targetName));
        attachments.push({
          name: displayName || path.basename(absPath),
          type: mediaType,
          source: targetName,
        });
      } catch (_) { /* best-effort */ }
    }
    // Screenshots
    try {
      const shotsDir = path.join(rerunDir, 'screenshots');
      const entries = await fs.readdir(shotsDir).catch(() => []);
      for (const f of entries) {
        if (/\.(png|jpe?g)$/i.test(f)) {
          await tryAttach(path.join(shotsDir, f), 'image/png', f);
        }
      }
    } catch (_) {}
    // Videos
    try {
      const videosDir = path.join(rerunDir, 'videos');
      const entries = await fs.readdir(videosDir).catch(() => []);
      for (const f of entries) {
        if (/\.webm$/i.test(f)) {
          await tryAttach(path.join(videosDir, f), 'video/webm', f);
        }
      }
    } catch (_) {}
    // Logs
    await tryAttach(path.join(rerunDir, 'logs', 'steps.log'),    'text/plain', 'steps.log');
    await tryAttach(path.join(rerunDir, 'logs', 'console.log'),  'text/plain', 'console.log');
    await tryAttach(path.join(rerunDir, 'logs', 'network.har'),  'application/json', 'network.har');

    // Pull the first failure for run-level statusDetails.
    const firstFail = (replayPayload.results || []).find(r => r && r.success === false);
    const statusDetails = firstFail
      ? {
          message: String(firstFail.error || '').slice(0, 1000),
          trace:   String(firstFail.errorStack || firstFail.error || '').slice(0, 4000),
        }
      : undefined;

    // Build the Allure result object (one per "test case", which is the
    // whole rerun in our model).
    const result = {
      uuid: runUuid,
      historyId,
      testCaseId: historyId,
      fullName: `${framework}.${projectId}.${testName}`,
      name: testName,
      status,
      stage: 'finished',
      start, stop,
      labels: [
        { name: 'framework',  value: framework },
        { name: 'feature',    value: projectId },
        { name: 'story',      value: testName },
        { name: 'suite',      value: projectId },
        { name: 'subSuite',   value: framework },
        { name: 'severity',   value: 'normal' },
        { name: 'epic',       value: 'globalsqa' },
        { name: 'host',       value: 'zac' },
        { name: 'thread',     value: 'main' },
      ],
      links: [],
      parameters: [],
      steps: toAllureSteps(replayPayload.results, start),
      attachments,
      ...(statusDetails ? { statusDetails } : {}),
    };

    await fs.writeFile(
      path.join(dir, `${runUuid}-result.json`),
      JSON.stringify(result, null, 2),
      'utf8',
    );

    // executor.json — shows up under "Executor" widget in the Allure UI.
    await fs.writeFile(
      path.join(dir, 'executor.json'),
      JSON.stringify({
        name: 'ZAC',
        type: 'zerocodeautomation',
        url: 'http://localhost:3000',
        buildOrder: Date.now(),
        buildName: testName,
        buildUrl: '',
        reportName: `${projectId} (${framework})`,
        reportUrl: '',
      }, null, 2),
      'utf8',
    );

    // environment.properties — shown under "Environment" widget.
    const envLines = [
      `framework=${framework}`,
      `project=${projectId}`,
      `test=${testName}`,
      `browser=${replayPayload.browserType || 'chromium'}`,
      `headless=${replayPayload.headless !== false}`,
      `executedSteps=${replayPayload.executedSteps || 0}`,
      `passed=${(replayPayload.successCount || 0)}`,
      `failed=${(replayPayload.failureCount || 0)}`,
      `softFailed=${(replayPayload.softFailureCount || 0)}`,
      `hardFailed=${(replayPayload.hardFailureCount || 0)}`,
      `duration=${replayPayload.duration || ''}`,
      `generatedAt=${new Date(stop).toISOString()}`,
    ];
    await fs.writeFile(
      path.join(dir, 'environment.properties'),
      envLines.join('\n') + '\n',
      'utf8',
    );

    // categories.json — failure-bucket rules so the Allure dashboard
    // groups recurring errors. Optional but cheap to add.
    await fs.writeFile(
      path.join(dir, 'categories.json'),
      JSON.stringify([
        { name: 'Locator failures',       matchedStatuses: ['failed'], messageRegex: '.*[Ll]ocator|selector.*' },
        { name: 'Timeout',                matchedStatuses: ['failed'], messageRegex: '.*[Tt]imeout.*' },
        { name: 'Assertion failures',     matchedStatuses: ['failed'], messageRegex: '.*Expected.*' },
        { name: 'DB validation failures', matchedStatuses: ['failed'], messageRegex: '.*dbValidate.*' },
      ], null, 2),
      'utf8',
    );

    return dir;
  } catch (err) {
    console.warn('[Allure] writer failed (replay-result.json is still on disk):', err.message);
    return null;
  }
}
