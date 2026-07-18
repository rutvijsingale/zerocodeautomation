// [ZAC-FIX] split from routes/api.js
// Thin HTTP wrapper — all replay logic lives in services/replayEngine.js.
import express from 'express';
import path from 'path';
import { asyncHandler } from '../middleware/errorHandler.js';
import { generalRateLimiter, pollingRateLimiter } from '../middleware/security.js';
import { projectService } from '../services/projectService.js';
import { mavenService } from '../services/mavenService.js';
import {
  run,
  runningReruns,
  rerunsCurrentlyRunning,
  cancelRun,
  MAX_CONCURRENT_RERUNS,
  inferTestRunner,
} from '../services/replayEngine.js';

const router = express.Router();

// Re-export runningReruns so routes/dashboard.js keeps working unchanged.
export { runningReruns } from '../services/replayEngine.js';

// POST /rerun — concurrency check is an HTTP concern; engine does the rest.
router.post('/rerun', generalRateLimiter, asyncHandler(async (req, res) => {
  const { steps, scenarios } = req.body;

  // T2.6 — concurrency cap. Reject (429) when the active rerun count
  // already meets the limit. We compare to LIVE entries only, so a
  // stuck/cancelled run doesn't permanently steal a slot.
  const inFlight = rerunsCurrentlyRunning();
  if (inFlight >= MAX_CONCURRENT_RERUNS) {
    console.warn(`[Rerun] Rejected — ${inFlight}/${MAX_CONCURRENT_RERUNS} concurrent reruns already running`);
    return res.status(429).json({
      success: false,
      error: `Too many concurrent reruns (${inFlight}/${MAX_CONCURRENT_RERUNS}). Wait for one to finish or set ZAC_MAX_CONCURRENT_RERUNS to raise the cap.`,
      retryAfterSeconds: 10,
      inFlight,
      maxConcurrent: MAX_CONCURRENT_RERUNS,
    });
  }

  if (!steps && !scenarios) throw new Error('No steps provided to execute');

  const result = await run(req.body);
  return res.json(result);
}));

// POST /rerun/cancel
router.post('/rerun/cancel', generalRateLimiter, asyncHandler(async (req, res) => {
  const { executionId } = req.body;
  const result = await cancelRun(executionId);
  return res.json(result);
}));


// Test Runner - Execute Gherkin feature files through step definitions
router.post('/test-runner/run', generalRateLimiter, asyncHandler(async (req, res) => {
  const { projectName, projectId, framework = 'playwright-java', browserType = 'chromium' } = req.body;

  if (!projectName && !projectId) {
    throw new Error('Project name or project ID is required');
  }

  // Try to find project directory
  let projectDir = null;

  // First, try using projectId if provided
  if (projectId) {
    try {
      projectDir = projectService.getProjectDir(projectId);
      if (!fs.existsSync(projectDir)) {
        projectDir = null;
      }
    } catch (e) {
      console.warn(`[Test Runner] Could not get project dir for ID ${projectId}:`, e.message);
    }
  }

  // If not found, try using projectName
  if (!projectDir && projectName) {
    // Try to find project by name
    try {
      const projects = await projectService.listProjects();
      const project = projects.find(p => p.name === projectName || p.id === projectName);
      if (project) {
        projectDir = projectService.getProjectDir(project.id);
      } else {
        // Fallback: try direct path
        const projectsDir = path.join(__dirname, '..', 'projects');
        const directPath = path.join(projectsDir, projectName);
        if (fs.existsSync(directPath)) {
          projectDir = directPath;
        }
      }
    } catch (e) {
      console.warn(`[Test Runner] Could not find project by name ${projectName}:`, e.message);
    }
  }

  if (!projectDir || !fs.existsSync(projectDir)) {
    throw new Error(`Project directory not found: ${projectName || projectId}. Please generate/export the project first.`);
  }

  console.log(`[Test Runner] Running tests for project: ${projectName}, framework: ${framework}`);

  // Set up streaming response
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const sendChunk = (data) => {
    res.write(data + '\n');
  };

  try {
    if (framework === 'playwright-java' || framework === 'selenium-java') {
      // Check if Maven is installed before attempting to run tests
      sendChunk(`[Test Runner] Checking Maven installation...`);
      const mavenCheck = await mavenService.checkMavenInstalled();

      if (!mavenCheck.installed) {
        const errorMsg = `Maven is not installed or not found in PATH.\n\nPlease install Maven to run Java tests:\n- Windows: Download from https://maven.apache.org/download.cgi or use chocolatey: choco install maven\n- macOS: brew install maven\n- Linux: sudo apt-get install maven (Ubuntu/Debian) or sudo yum install maven (RHEL/CentOS)\n\nAfter installation, ensure Maven is added to your system PATH and restart the application.`;
        sendChunk(`\n[Test Runner] ❌ ${errorMsg}`);
        res.write(JSON.stringify({ success: false, error: errorMsg }) + '\n');
        res.end();
        return;
      }

      sendChunk(`[Test Runner] Maven ${mavenCheck.version || 'found'} detected ✓`);
      sendChunk(`[Test Runner] Running Maven tests for ${framework}...`);
      sendChunk(`[Test Runner] Project directory: ${projectDir}`);

      // Handle cancellation - find running command by projectDir
      req.on('close', () => {
        const runningCommands = mavenService.getRunningCommands();
        const runningCommand = runningCommands.find(cmd => cmd.projectDir === projectDir);
        if (runningCommand) {
          mavenService.cancelCommand(runningCommand.executionId).then(() => {
            sendChunk('\n[Test Runner] ⏹️ Test execution cancelled');
          }).catch(() => {
            // Ignore cancellation errors
          });
        }
      });

      // Use mavenService to execute the command for better error handling
      try {
        const result = await mavenService.executeMavenCommand(
          projectDir,
          'test',
          ['clean'],
          {
            timeout: 300000,
            onOutput: (line, type) => {
              sendChunk(line);
            }
          }
        );

        if (result.success) {
          sendChunk('\n[Test Runner] ✅ Tests completed successfully!');
          res.write(JSON.stringify({ success: true, exitCode: 0, duration: result.duration }) + '\n');
        } else {
          sendChunk(`\n[Test Runner] ❌ Tests failed with exit code: ${result.exitCode}`);
          res.write(JSON.stringify({ success: false, exitCode: result.exitCode, duration: result.duration }) + '\n');
        }
        res.end();
      } catch (mavenError) {
        sendChunk(`\n[Test Runner] ❌ Error running tests: ${mavenError.message}`);
        res.write(JSON.stringify({ success: false, error: mavenError.message }) + '\n');
        res.end();
      }
      return;

    } else if (framework === 'playwright-ts' || framework === 'playwright-typescript') {
      // Run npm test
      sendChunk(`[Test Runner] Running npm tests for ${framework}...`);
      sendChunk(`[Test Runner] Project directory: ${projectDir}`);

      const { spawn } = await import('child_process');
      const npmProcess = spawn('npm', ['test'], {
        cwd: projectDir,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      npmProcess.stdout.on('data', (data) => {
        sendChunk(data.toString());
      });

      npmProcess.stderr.on('data', (data) => {
        sendChunk(data.toString());
      });

      npmProcess.on('close', (code) => {
        if (code === 0) {
          sendChunk('\n[Test Runner] ✅ Tests completed successfully!');
          res.write(JSON.stringify({ success: true, exitCode: code }) + '\n');
        } else {
          sendChunk(`\n[Test Runner] ❌ Tests failed with exit code: ${code}`);
          res.write(JSON.stringify({ success: false, exitCode: code }) + '\n');
        }
        res.end();
      });

      npmProcess.on('error', (error) => {
        sendChunk(`\n[Test Runner] ❌ Error running tests: ${error.message}`);
        res.write(JSON.stringify({ success: false, error: error.message }) + '\n');
        res.end();
      });

      // Handle cancellation
      req.on('close', () => {
        if (npmProcess && !npmProcess.killed) {
          npmProcess.kill('SIGTERM');
          sendChunk('\n[Test Runner] ⏹️ Test execution cancelled');
        }
      });

    } else {
      throw new Error(`Unsupported framework: ${framework}`);
    }

  } catch (error) {
    sendChunk(`\n[Test Runner] ❌ Error: ${error.message}`);
    res.write(JSON.stringify({ success: false, error: error.message }) + '\n');
    res.end();
  }
}));


// ============================================================================
// Run history
// ============================================================================
// Body: { projectId, framework, testRunner, status, durationMs, healCount?, totalScenarios? }
router.post('/runs/append', generalRateLimiter, asyncHandler(async (req, res) => {
  const fs = await import('fs/promises');
  const path = (await import('path')).default;
  const body = req.body || {};
  const required = ['projectId', 'framework', 'status'];
  for (const k of required) {
    if (!body[k]) return res.status(400).json({ ok: false, error: 'missing ' + k });
  }
  const row = {
    id: body.id || `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    timestamp: body.timestamp || new Date().toISOString(),
    project: body.projectId,
    framework: body.framework,
    test_runner: body.testRunner || inferTestRunner(body.framework),
    status: body.status,
    duration_ms: Number(body.durationMs) || 0,
    heal_count: Number(body.healCount) || 0,
    deliberate_heal_count: Number(body.deliberateHealCount) || 0,
    total_scenarios: Number(body.totalScenarios) || 0,
    passed: Number(body.passed) || 0,
    failed: Number(body.failed) || 0,
    healed: Number(body.healed) || 0,
  };
  const reportsDir = path.resolve(process.cwd(), 'reports');
  await fs.mkdir(reportsDir, { recursive: true });
  const file = path.join(reportsDir, 'rerun-history.jsonl');
  await fs.appendFile(file, JSON.stringify(row) + '\n', 'utf8');
  console.log('[ZAC-FIX] rerun history appended:', row.id, row.framework, row.status);
  res.json({ ok: true, row });
}));

router.get('/runs/history', pollingRateLimiter, asyncHandler(async (req, res) => {
  const fs = await import('fs/promises');
  const path = (await import('path')).default;
  const file = path.resolve(process.cwd(), 'reports', 'rerun-history.jsonl');
  try {
    const text = await fs.readFile(file, 'utf8');
    const allRows = text.split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    // [ZAC-FIX 2026-05-24] existingOnly filter — when true (default),
    // hide rows whose project no longer exists in projects/. The log
    // file is append-only and accumulates rows from harness runs +
    // deleted projects, polluting the Runner dropdown with stale
    // values like 'unknown' that the user can't tie back to anything.
    // Pass ?existingOnly=false to see the full historical log.
    const existingOnly = String(req.query.existingOnly ?? 'true').toLowerCase() !== 'false';
    let rows = allRows;
    let hiddenCount = 0;
    if (existingOnly) {
      const projDir = path.resolve(process.cwd(), 'projects');
      const realIds = new Set(
        (await fs.readdir(projDir, { withFileTypes: true }).catch(() => []))
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
      );
      rows = allRows.filter((r) => r.project && realIds.has(r.project));
      hiddenCount = allRows.length - rows.length;
    }
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const filtered = rows.slice(-limit).reverse();
    res.json({ ok: true, total: rows.length, totalAll: allRows.length, hiddenCount, rows: filtered });
  } catch (e) {
    if (e.code === 'ENOENT') return res.json({ ok: true, total: 0, rows: [] });
    res.status(500).json({ ok: false, error: e.message });
  }
}));

// Optimized endpoint to append steps to a project without loading all existing steps

export default router;
