// services/replayEngine.js
// Pure replay engine — no Express, no req/res.
// Route handlers in routes/rerun.js call these functions and write res.json(result) themselves.

import path from 'path';
import { buildRerunLaunchArgs, persistRerunHtmlReport } from '../routes/shared.js';

// ============================================================================
// Concurrency state
// ============================================================================

// Store running rerun executions for cancellation
const runningReruns = new Map(); // Map<executionId, { cancelled: boolean, browser, context, page }>
let mostRecentExecutionId = null; // Track most recent execution for cancellation without ID

// T2.6 — concurrency cap. Each rerun spins up a real Playwright browser
// (~150 MB RSS), so an unbounded fleet can OOM the host. Default 3
// concurrent reruns, override via env (ZAC_MAX_CONCURRENT_RERUNS=N).
//
// Behavior on overflow: return HTTP 429 with `retryAfter` so the caller
// can back off, instead of silently queueing (which would mask
// scheduling bugs). The limit is enforced INSIDE the route just before
// we call browser.launch(), so cancelled-but-not-yet-cleaned-up runs
// don't permanently consume a slot.
const MAX_CONCURRENT_RERUNS = (() => {
  const n = Number(process.env.ZAC_MAX_CONCURRENT_RERUNS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
})();

function rerunsCurrentlyRunning() {
  // Count entries that still have a live `browser` AND have not been
  // cancelled. This way a rerun that crashed (browser=null) frees its
  // slot immediately even before its handler unwinds.
  let n = 0;
  runningReruns.forEach((s) => { if (s.browser && !s.cancelled) n++; });
  return n;
}

export { runningReruns };
export { MAX_CONCURRENT_RERUNS };
export { rerunsCurrentlyRunning };

// ============================================================================
// cancelRun — extracted from the /rerun/cancel route body
// ============================================================================
export async function cancelRun(executionId) {
  // If no executionId provided, cancel the most recent execution
  const targetExecutionId = executionId || mostRecentExecutionId;

  if (!targetExecutionId) {
    return {
      success: false,
      message: 'No execution to cancel'
    };
  }

  const executionState = runningReruns.get(targetExecutionId);

  if (!executionState) {
    return {
      success: false,
      message: 'Execution not found or already completed'
    };
  }

  console.log(`[Rerun] Cancelling execution ${targetExecutionId}`);

  // Mark as cancelled
  executionState.cancelled = true;

  // Cleanup browser resources
  try {
    if (executionState.page && !executionState.page.isClosed()) {
      await executionState.page.close();
    }
    if (executionState.context) {
      await executionState.context.close();
    }
    if (executionState.browser) {
      await executionState.browser.close();
    }
  } catch (cleanupError) {
    console.warn('[Rerun] Cleanup error during cancellation:', cleanupError);
  }

  // Remove from running executions
  runningReruns.delete(targetExecutionId);

  // Clear most recent execution if it was the one cancelled
  if (mostRecentExecutionId === targetExecutionId) {
    mostRecentExecutionId = null;
  }

  return {
    success: true,
    message: 'Execution cancelled successfully',
    executionId: targetExecutionId
  };
}

// ============================================================================
// Pure utilities
// ============================================================================

// [ZAC-FIX] runWithTimeout — race any Promise against a timer. Used by the
// rerun loop so a single hung step (e.g. Playwright's internal waits never
// resolving on a deleted element) can never freeze the entire run forever.
// On timeout the rejection is a TimeoutError tagged with `.zacTimeout=true`
// so callers can branch on it cleanly.
export function runWithTimeout(promise, timeoutMs, label = 'operation') {
  const ms = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : 30000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      const err = new Error(`[Timeout] "${label}" exceeded ${ms}ms`);
      err.zacTimeout = true;
      err.zacTimeoutMs = ms;
      reject(err);
    }, ms);
    Promise.resolve(promise).then(
      (val) => { if (settled) return; settled = true; clearTimeout(t); resolve(val); },
      (err) => { if (settled) return; settled = true; clearTimeout(t); reject(err); },
    );
  });
}

export function inferTestRunner(framework) {
  if (!framework) return 'unknown';
  if (framework.includes('testng')) return 'testng';
  if (framework.includes('java')) return 'junit';
  if (framework.includes('cypress')) return 'mocha';
  if (framework.includes('typescript') || framework.includes('javascript') || framework.includes('playwright')) return 'mocha';
  return 'unknown';
}

// ============================================================================
// runSingleScenario — extracted from the POST /rerun route handler body
// ============================================================================
export async function runSingleScenario(steps, opts) {
  const {
    browserType = 'chromium',
    baseUrl = 'about:blank',
    headless = false,
    stopOnFailure = false,
    // Optional — when supplied, healed locator events are persisted to
    // projects/<projectId>/healed-locators.json for later QA review.
    projectId = null,
    // Optional — when projectId, framework and testName are all provided,
    // rerun output (status.json + logs) lands under
    // generated-projects/<framework>/<project>/reruns/<testName>/<timestamp>/.
    framework: rerunFramework = null,
    testName: rerunTestName = null,
    // [ZAC-FIX] Per-run knobs:
    //   stepTimeoutMs       global per-step ceiling; overridable per-step via step.timeoutMs
    //   defaultAssertMode   'hard' (default — fail run on the first assertion miss
    //                        unless stopOnFailure is false) or 'soft' (collect
    //                        failures, never break the loop, surface as
    //                        softFailures in the response). Per-step
    //                        step.assertMode wins when set.
    stepTimeoutMs = 30000,
    defaultAssertMode = 'hard',
    // [ZAC-FIX 2026-05-24] Capture knobs — defaults match the
    // Settings → 📸 Capture defaults panel.
    //   captureFailureScreenshot: when true (default), the engine
    //     calls page.screenshot() after every failed step and
    //     persists the PNG under <rerunDir>/screenshots/. When false,
    //     the screenshot capture is skipped (faster reruns, no PNG).
    //   captureVideo: when true, the BrowserContext is created with
    //     recordVideo pointed at <rerunDir>/videos/. Off by default
    //     because video makes reruns ~2× slower.
    captureFailureScreenshot = true,
    captureVideo = false,
  } = opts || {};

  // Generate unique execution ID
  const executionId = `rerun_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  console.log(`[Rerun] Starting execution ${executionId} of ${steps.length} steps`);
  console.log(`[Rerun] Browser: ${browserType}, Base URL: ${baseUrl}, Headless: ${headless}, Stop on Failure: ${stopOnFailure}`);

  const startTime = Date.now();
  const results = [];
  let browser, context, page;

  // Store execution state for cancellation. [ZAC-FIX] include framework /
  // projectId / testName so /api/dashboard/live can light up the right
  // Framework Projection card while this rerun is in flight.
  const executionState = {
    cancelled: false, browser: null, context: null, page: null,
    framework: rerunFramework || null,
    projectId: projectId || null,
    testName:  rerunTestName || null,
    startedAt: new Date().toISOString(),
  };
  runningReruns.set(executionId, executionState);
  mostRecentExecutionId = executionId; // Track most recent execution

  // T2.9 — per-rerun in-memory log buffers. Persisted to
  // <rerunDir>/logs/{steps,console}.log inside the layout-persistence
  // block. Keep these as plain string arrays so writing is a single
  // .join('\n').
  const stepLogLines = [];
  const consoleLogLines = [];
  const stepLog = (msg) => stepLogLines.push(`[${new Date().toISOString()}] ${msg}`);
  stepLog(`Rerun ${executionId} starting — browser=${browserType} headless=${headless} steps=${steps.length}`);

  // T3.10 + T3.11 — Resolve the rerun scaffold UPFRONT (before browser
  // launch) when we have enough info, so we can hand Playwright the
  // exact `videos/` and `network/` paths it should write to. If the
  // call doesn't supply projectId+framework+testName we skip — the
  // existing post-execution persistence block then handles it.
  let preResolvedScaffold = null;
  if (projectId && rerunFramework && rerunTestName) {
    try {
      const layout = await import('../services/projectLayout.js');
      const validation = await layout.validateLayoutInputs({ framework: rerunFramework, projectName: projectId });
      if (validation.ok) {
        preResolvedScaffold = await layout.ensureRerunScaffold({
          framework: validation.framework,
          projectName: validation.projectName,
          testName: rerunTestName,
        });
      }
    } catch (e) {
      console.warn('[Rerun] could not pre-resolve scaffold for video/HAR (will fall back to post-resolve):', e.message);
    }
  }

  try {
    // Get browser launcher
    const { chromium, firefox, webkit } = await import('playwright');
    const browserLauncher = browserType === 'firefox' ? firefox :
                           browserType === 'webkit' ? webkit : chromium;

    // Launch browser. Pass --start-maximized for Chromium/Edge in headed mode
    // so the rerun window matches the recorder's window size; otherwise
    // pages laid out for ≥1280-wide viewports break in the default 800x600.
    // Firefox/WebKit ignore the flag, so we omit it for them.
    browser = await browserLauncher.launch({
      headless: headless,
      args: buildRerunLaunchArgs(browserType, headless),
    });
    executionState.browser = browser;
    // [ZAC-FIX 2026-05-24] User-closed-browser detection — when the
    // user X's the rerun browser window, Playwright fires
    // 'disconnected'. Without this listener the rerun loop could
    // keep trying to drive a dead browser, throwing confusing errors
    // and leaking the executionState. Mark cancelled + drop from
    // runningReruns so /api/rerun/cancel returns "already completed"
    // gracefully and the next rerun gets a clean slate.
    browser.once('disconnected', () => {
      console.log(`[Rerun] 🔌 Browser disconnected externally — marking ${executionId} cancelled`);
      try { executionState.cancelled = true; } catch (_) {}
      try { runningReruns.delete(executionId); } catch (_) {}
      if (mostRecentExecutionId === executionId) mostRecentExecutionId = null;
    });

    // Detect screen size dynamically for proper fitting
    let screenSize = { width: 1920, height: 1080 }; // Default fallback

    if (!headless) {
      // Only detect screen size if not headless (headless doesn't need screen fitting)
      try {
        // Create a temporary context and page to get screen size
        const tempContext = await browser.newContext({ viewport: null });
        const tempPage = await tempContext.newPage();

        // Navigate to a blank page to ensure JavaScript can run
        await tempPage.goto('about:blank');

        // Get the actual available screen dimensions (accounts for taskbars, etc.)
        // Calculate viewport size that ensures the entire browser window fits on screen
        screenSize = await tempPage.evaluate(() => {
          // Get available screen space (excludes taskbar)
          const availWidth = window.screen.availWidth || window.screen.width || 1920;
          const availHeight = window.screen.availHeight || window.screen.height || 1080;

          // Browser chrome includes: title bar (~30px) + address bar (~40px) + tabs (~40px) + bookmarks bar (~30px if visible)
          // Total browser chrome: approximately 140-180px depending on browser and settings
          // Use a conservative estimate to ensure the full window fits on screen
          const browserChromeHeight = 180; // Conservative estimate for all browser UI elements
          const browserChromeWidth = 0; // Width is usually fine, but account for scrollbar if needed

          // Calculate viewport size that will make the total window fit on screen
          // Total window height = browser chrome + viewport height
          // So: viewport height = availHeight - browser chrome
          const viewportWidth = Math.max(800, availWidth - browserChromeWidth);
          const viewportHeight = Math.max(600, availHeight - browserChromeHeight);

          return {
            width: viewportWidth,
            height: viewportHeight
          };
        });

        // Close temporary page and context
        await tempPage.close();
        await tempContext.close();

        console.log(`[Rerun] Detected screen size: ${screenSize.width}x${screenSize.height}`);
      } catch (e) {
        console.log(`[Rerun] Could not detect screen size, using default: ${screenSize.width}x${screenSize.height}`);
      }
    }

    // T3.10 + T3.11 — When we know the scaffold, opt the context into
    //   videos      (recordVideo)        → reruns/<ts>/videos/*.webm
    //   HAR / net   (recordHar)          → reruns/<ts>/logs/network.har
    // Both are noop'd when scaffold is null (rerun without project layout).
    const ctxOptions = {
      viewport: { width: screenSize.width, height: screenSize.height },
    };
    let harPath = null;
    if (preResolvedScaffold) {
      // [ZAC-FIX 2026-05-24] recordVideo only when the user opts in
      // via Settings → 📸 Capture defaults (or per-rerun override).
      // Off by default — video makes reruns ~2× slower and consumes
      // significant disk space.
      if (captureVideo) {
        ctxOptions.recordVideo = {
          dir: preResolvedScaffold.videos,
          size: { width: Math.min(1280, screenSize.width), height: Math.min(720, screenSize.height) },
        };
      }
      harPath = path.join(preResolvedScaffold.logs, 'network.har');
      ctxOptions.recordHar = { path: harPath, mode: 'minimal' };
    }
    context = await browser.newContext(ctxOptions);
    executionState.context = context;
    // [ZAC-FIX 2026-05-24] Attach the rerun's screenshots directory to
    // the Playwright BrowserContext so the 'screenshot' step handler in
    // utils/stepHandlers.js routes captures into <rerunDir>/screenshots/
    // instead of the server CWD. Without this, screenshot files were
    // written to /Users/.../zerocodeautomation/<filename>.png and the
    // dashboard report's gallery showed an empty list.
    if (preResolvedScaffold) context.screenshotsDir = preResolvedScaffold.screenshots;

    page = await context.newPage();
    executionState.page = page;

    // T2.9 — capture browser console output to a per-rerun log file.
    // We hook ALL pages in the context (including new tabs / popups) by
    // attaching to context.on('page') and to the initial page directly.
    const wireConsoleCapture = (p) => {
      try {
        p.on('console', (msg) => {
          try {
            const t = msg.type ? msg.type() : 'log';
            const text = msg.text ? msg.text() : String(msg);
            consoleLogLines.push(`[${new Date().toISOString()}] [${t}] ${text}`);
          } catch (e) { /* swallow — diagnostic only */ }
        });
        p.on('pageerror', (err) => {
          consoleLogLines.push(`[${new Date().toISOString()}] [pageerror] ${err.message}`);
        });
      } catch (e) { /* attach failure — diagnostic only */ }
    };
    wireConsoleCapture(page);
    context.on('page', wireConsoleCapture);

    // Helper function to ensure page is available
    const ensurePage = async () => {
      // CRITICAL: Check cancellation BEFORE creating new page
      if (executionState.cancelled) {
        throw new Error('Execution cancelled - cannot create new page');
      }

      if (!page || page.isClosed()) {
        // Check cancellation again right before creating page
        if (executionState.cancelled) {
          throw new Error('Execution cancelled - cannot create new page');
        }

        console.log(`[Rerun] Page was closed, creating new page...`);
        page = await context.newPage();
        executionState.page = page;
      }
      return page;
    };

    // Import common step handlers + the persistence shim so we can write
    // healed locator events to projects/<id>/healed-locators.json.
    const { executePlaywrightStep } = await import('../utils/stepHandlers.js');
    const { saveHealedLocator } = await import('../utils/locatorHealer.js');

    // Track page count before each step to detect new tabs opened by previous steps
    let pageCountBeforeStep = context.pages().length;

    // Execute each step - ALWAYS continue through all steps (unless cancelled)
    for (let i = 0; i < steps.length; i++) {
      // Check for cancellation before each step (only check executionState, not req.aborted/destroyed)
      // req.aborted/destroyed can be unreliable in Express and cause false cancellations
      if (executionState.cancelled) {
        console.log(`[Rerun] Execution ${executionId} cancelled at step ${i + 1}/${steps.length}`);
        results.push({
          step: 'cancelled',
          success: false,
          error: 'Execution cancelled by user',
          duration: Date.now() - startTime
        });
        break;
      }

      const step = steps[i];
      const stepStartTime = Date.now();

      try {
        console.log(`[Rerun] [${i + 1}/${steps.length}] Executing: ${step.kind}${step.selector ? ` on ${step.selector}` : ''}`);

        // Check for cancellation again before executing step (only check executionState)
        if (executionState.cancelled) {
          console.log(`[Rerun] Execution ${executionId} cancelled during step ${i + 1}`);
          results.push({
            step: step.kind || 'unknown',
            success: false,
            error: 'Execution cancelled by user',
            duration: Date.now() - stepStartTime
          });
          break;
        }

        // Ensure page is available before each step (will throw if cancelled)
        await ensurePage();

        // Check cancellation after ensurePage (in case it was cancelled during page creation)
        if (executionState.cancelled) {
          console.log(`[Rerun] Execution ${executionId} cancelled after page creation`);
          results.push({
            step: step.kind || 'unknown',
            success: false,
            error: 'Execution cancelled by user',
            duration: Date.now() - stepStartTime
          });
          break;
        }

        // Track page count before this step to detect if a new tab was opened
        const pageCountBeforeThisStep = context.pages().length;

        // For close steps, check if a new tab was opened by previous step(s) BEFORE executing
        if (step.kind === 'close') {
          // Wait a bit to catch any asynchronous tab creation from previous steps
          await page.waitForTimeout(500);
          const currentPageCount = context.pages().length;

          if (currentPageCount > pageCountBeforeStep) {
            // A new tab was opened by a previous step - don't close
            console.log(`[Rerun] New tab detected (${pageCountBeforeStep} -> ${currentPageCount}), skipping close to preserve new tab`);
            pageCountBeforeStep = currentPageCount; // Update for potential next steps
            // Don't execute the close - skip it
            results.push({
              step: step.kind,
              success: true,
              skipped: true,
              reason: 'New tab detected, preserving page',
              duration: Date.now() - stepStartTime
            });
            console.log(`[Rerun] ✅ Step ${i + 1}/${steps.length} skipped (new tab detected)`);
            continue; // Skip to next step - don't execute the close
          }
          // No new tab detected - proceed with close execution below
        }

        // [ZAC-FIX] Per-step pre-wait knob — pause before executing this
        // step. Recorder can emit step.preWaitMs (e.g. for "click then wait
        // 2s before next click" sequences) without us having to add a
        // separate "wait" step type.
        if (Number.isFinite(Number(step.preWaitMs)) && Number(step.preWaitMs) > 0) {
          stepLog(`Step ${i + 1}: pre-wait ${step.preWaitMs}ms`);
          await page.waitForTimeout(Number(step.preWaitMs));
        }

        // [ZAC-FIX] Stuck-step guard — race the step against a timeout.
        // step.timeoutMs (per-step) wins over the run-level stepTimeoutMs.
        const effectiveTimeout = Number.isFinite(Number(step.timeoutMs)) && Number(step.timeoutMs) > 0
          ? Number(step.timeoutMs)
          : stepTimeoutMs;
        const stepLabel = `step ${i + 1} (${step.kind || 'unknown'})`;
        // Use common step handler - pass context for close step to check for new tabs
        const result = await runWithTimeout(
          executePlaywrightStep(page, step, context),
          effectiveTimeout,
          stepLabel
        );

        // Check cancellation after step execution (in case cancelled during long-running step)
        if (executionState.cancelled) {
          console.log(`[Rerun] Execution ${executionId} cancelled after step ${i + 1} execution`);
          results.push({
            step: step.kind || 'unknown',
            success: false,
            error: 'Execution cancelled by user',
            duration: Date.now() - stepStartTime
          });
          break;
        }

        // Check if a new tab was opened by this step (for non-close steps)
        // Wait a bit to catch asynchronous tab creation
        if (step.kind !== 'close') {
          await page.waitForTimeout(500);
          const pageCountAfterStep = context.pages().length;
          if (pageCountAfterStep > pageCountBeforeThisStep) {
            console.log(`[Rerun] Step ${i + 1} (${step.kind}) opened a new tab (${pageCountBeforeThisStep} -> ${pageCountAfterStep})`);
            pageCountBeforeStep = pageCountAfterStep; // Update for next step
          } else {
            pageCountBeforeStep = pageCountAfterStep; // Update for next step
          }
        }

        // Handle page close result
        if (step.kind === 'close' && result === null) {
          // Page was closed successfully
          page = null; // Mark as closed so next step will create new page
          executionState.page = null;
          pageCountBeforeStep = context.pages().length; // Update count after close
          console.log(`[Rerun] Page closed successfully`);
        }

        const stepDuration = Date.now() - stepStartTime;
        const stepResult = {
          step: step.kind,
          success: true,
          duration: stepDuration
        };
        // executePlaywrightStep returns { healed, primarySelector, healedVia, attempts }
        // when the live healer rescued the step from a stale primary locator.
        // Surface this so the UI can flag it (and so backtests can assert it).
        if (result && result.healed) {
          stepResult.healed = true;
          stepResult.primarySelector = result.primarySelector;
          stepResult.healedVia = result.healedVia;
          stepResult.healAttempts = result.attempts;
          // healer returns healingSource:'ai' when the local LLM provided
          // the rescue selector. Surface so the dashboard / report viewer
          // can render an "🤖 AI" pill instead of the regular 🩹 healing one.
          stepResult.rescuedBy = result.healingSource === 'ai' ? 'ai' : 'healer';
          const icon = stepResult.rescuedBy === 'ai' ? '🤖' : '🩹';
          console.log(`[Rerun] ${icon} Step ${i + 1} ${stepResult.rescuedBy}-rescued: "${result.primarySelector}" -> "${result.healedVia}"`);

          // Best-effort persistence — never block or fail the rerun if the
          // file write throws (disk full, permission, etc.). The healer
          // itself logs success/failure with the [Heal] tag.
          if (projectId) {
            try {
              const saved = await saveHealedLocator({
                projectName: projectId,
                pageName: step.normalizedPageName || null,
                elementName: step.normalizedDescription || step.kind,
                primarySelector: result.primarySelector,
                healedSelector: result.healedVia,
                reason: result.reason || 'primary not found',
                attempts: result.attempts,
              });
              if (saved.ok) stepResult.healSavedTo = saved.file;
            } catch (persistErr) {
              console.warn('[Rerun] saveHealedLocator threw (ignored):', persistErr.message);
            }
          }
        }
        // T2.7 — auto-screenshot on step failure. Buffered here so we can
        // write to disk later inside the layout-persistence block (the
        // rerun scaffold dir isn't resolved until then). Pass buffer +
        // suggested filename via the result object.
        // [ZAC-FIX 2026-05-24] Skip when captureFailureScreenshot=false.
        if (stepResult.success === false && page && captureFailureScreenshot) {
          try {
            const buf = await page.screenshot({ fullPage: false, timeout: 3000 });
            stepResult.screenshot = `step-${i + 1}-failed.png`;
            stepResult.screenshotBuffer = buf; // stripped from JSON later
          } catch (e) {
            console.warn(`[Rerun] auto-screenshot for failed step ${i + 1} failed: ${e.message}`);
          }
        }
        results.push(stepResult);

        // T2.9 — per-step text log entry.
        stepLog(`Step ${i + 1}/${steps.length} ${stepResult.success === false ? 'FAILED' : 'OK'} kind=${step.kind || '?'} duration=${stepDuration}ms${stepResult.healed ? ' (healed)' : ''}${stepResult.error ? ' err=' + String(stepResult.error).slice(0, 200) : ''}`);

        console.log(`[Rerun] ✅ Step ${i + 1}/${steps.length} completed in ${stepDuration}ms`);

      } catch (stepError) {
        const stepDuration = Date.now() - stepStartTime;

        // If error is due to cancellation, break immediately
        if (stepError.message.includes('cancelled') || executionState.cancelled) {
          console.log(`[Rerun] Execution ${executionId} cancelled during step ${i + 1} execution`);
          results.push({
            step: step.kind || 'unknown',
            success: false,
            error: 'Execution cancelled by user',
            duration: stepDuration
          });
          break; // Exit loop immediately
        }

        // [ZAC-FIX] Honour per-step assertion mode + identify timeout failures.
        const assertMode = String(step.assertMode || defaultAssertMode || 'hard').toLowerCase();
        const isSoft = assertMode === 'soft';
        const isTimeout = !!stepError.zacTimeout;
        const tag = isTimeout ? '⏰ TIMEOUT' : (isSoft ? '⚠️ SOFT-FAIL' : '❌ FAIL');
        console.error(`[Rerun] ${tag} Step ${i + 1}/${steps.length}:`, stepError.message);

        const failedRow = {
          step: step.kind || 'unknown',
          success: false,
          error: stepError.message,
          duration: stepDuration,
          // Surface so the dashboard / reports can render distinct icons.
          assertMode,
          softFailure: isSoft,
          timedOut: isTimeout,
          timeoutMs: isTimeout ? stepError.zacTimeoutMs : undefined,
        };
        // T2.7 — auto-screenshot on the throw path too. Honours the
        // per-rerun captureFailureScreenshot knob (Settings → 📸).
        if (page && captureFailureScreenshot) {
          try {
            const buf = await page.screenshot({ fullPage: false, timeout: 3000 });
            failedRow.screenshot = `step-${i + 1}-failed.png`;
            failedRow.screenshotBuffer = buf;
          } catch (e) { /* best-effort */ }
        }
        results.push(failedRow);
        // T2.9 — log the throw too, with the assert/timeout tag inline.
        stepLog(`Step ${i + 1}/${steps.length} ${tag} kind=${step.kind || '?'} duration=${stepDuration}ms mode=${assertMode}${isTimeout ? ' timeout=' + stepError.zacTimeoutMs + 'ms' : ''} err=${String(stepError.message).slice(0, 200)}`);

        // [ZAC-FIX] Soft assertions never break the loop — even when
        // stopOnFailure is on, the user explicitly tagged this step as
        // "best-effort". Hard assertions (or unset → defaults to hard)
        // honour stopOnFailure as before.
        if (!isSoft && stopOnFailure && !executionState.cancelled) {
          console.log(`[Rerun] Stop on failure enabled (hard assert) - stopping execution at step ${i + 1}`);
          break; // Exit loop immediately
        }

        // IMPORTANT: Continue to next step even if this one failed (unless cancelled or stopOnFailure)
        // This ensures ALL steps are attempted when stopOnFailure is false
        if (!executionState.cancelled) {
          console.log(`[Rerun] Continuing to next step despite failure...`);
        } else {
          // Cancelled during error handling, break immediately
          break;
        }
      }
    }

    const totalDuration = Date.now() - startTime;
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;
    // [ZAC-FIX] Counts soft-fail and timeout for the dashboard / report viewer.
    const softFailureCount = results.filter(r => r.softFailure).length;
    const timeoutCount     = results.filter(r => r.timedOut).length;
    const hardFailureCount = failureCount - softFailureCount;
    const wasCancelled = executionState.cancelled; // Only check explicit cancellation flag

    if (wasCancelled) {
      console.log(`[Rerun] Execution ${executionId} was cancelled: ${successCount} successful, ${failureCount} failed, ${totalDuration}ms total`);
    } else {
      console.log(`[Rerun] Execution ${executionId} completed: ${successCount} successful, ${failureCount} failed, ${totalDuration}ms total`);
    }

    // Persist the rerun status report under the framework-organized layout
    // when the caller supplied enough context (projectId + framework + testName).
    // Best-effort: write failures are logged but never abort the response.
    let rerunLayout = null;
    if (projectId && rerunFramework && rerunTestName) {
      try {
        const layout = await import('../services/projectLayout.js');
        const validation = await layout.validateLayoutInputs({
          framework: rerunFramework,
          projectName: projectId,
        });
        if (validation.ok) {
          // [ZAC-FIX 2026-05-24] When we pre-resolved a scaffold (so
          // Playwright could write video + HAR), reuse its timestamp.
          // Without this, a NEW timestamp dir was created here for
          // replay-result.json + report/, leaving the video stranded
          // in the OLD timestamp dir — splitting one rerun into two
          // sibling folders.
          const scaffold = await layout.ensureRerunScaffold({
            framework: validation.framework,
            projectName: validation.projectName,
            testName: rerunTestName,
            timestamp: preResolvedScaffold ? preResolvedScaffold.timestamp : undefined,
          });
          const fsp = await import('fs/promises');
          const statusPayload = {
            executionId,
            framework: scaffold.project.framework,
            projectName: scaffold.project.projectName,
            testName: scaffold.testName,
            timestamp: scaffold.timestamp,
            // T2.4 — record the browser actually used so the dashboard
            // can break stats down by browser. Was missing before, so
            // /api/dashboard/stats had no browser axis.
            browserType: browserType || 'chromium',
            headless: !!headless,
            cancelled: wasCancelled,
            success: failureCount === 0 && !wasCancelled,
            executedSteps: results.length,
            successCount,
            failureCount,
            durationMs: totalDuration,
            results,
            startedAt: new Date(startTime).toISOString(),
            completedAt: new Date().toISOString(),
          };
          await fsp.writeFile(
            path.join(scaffold.report, 'status.json'),
            JSON.stringify(statusPayload, null, 2),
            'utf8'
          );
          // Also drop replay-result.json at the rerun root so external tools
          // that scan `reruns/<test>/<ts>/replay-result.json` (the spec's
          // canonical location) find it without descending into report/.
          // Each row in `results` records the executed step under `r.step`
          // (the action kind, e.g. "scroll", "click"). Earlier this filter
          // accidentally read `r.kind`, which is never populated, so the
          // scroll counter always reported 0.
          const isScroll = (r) => r && (r.step === 'scroll' || r.kind === 'scroll');
          const replayPayload = {
            ...statusPayload,
            healingSummary: {
              healingEvents: results.filter((r) => r && r.healing).length,
              healedSteps: results.filter((r) => r && r.healing && r.healing.healed).length,
              exhausted: results.filter((r) => r && r.healing && r.healing.exhausted).length,
              // Split out AI-rescued vs deterministic-healer rescues so the
              // dashboard's Failure Insights tab can show the contribution
              // of the local LLM separately. Field is 0 when AI is off or
              // when no step needed an AI-suggested selector.
              aiRescues:     results.filter((r) => r && r.rescuedBy === 'ai').length,
              healerRescues: results.filter((r) => r && r.rescuedBy === 'healer').length,
            },
            scrollSummary: {
              scrollSteps: results.filter(isScroll).length,
              successfulScrolls: results.filter((r) => isScroll(r) && r.success).length,
            },
          };
          // T2.7 — write any auto-captured failure screenshots to
          // <rerunDir>/screenshots/<filename>, then strip the in-memory
          // Buffer from the JSON payload (Buffers don't serialize cleanly
          // and would bloat the JSON).
          for (const r of replayPayload.results || []) {
            if (r && r.screenshotBuffer && r.screenshot) {
              try {
                const shotPath = path.join(scaffold.screenshots, r.screenshot);
                await fsp.writeFile(shotPath, r.screenshotBuffer);
              } catch (e) {
                console.warn(`[Rerun] failed to persist screenshot ${r.screenshot}:`, e.message);
              }
              delete r.screenshotBuffer;
            }
          }
          // T2.9 — Write per-step text log + browser console log to
          // <rerunDir>/logs/. Both files are plain text so they're cheap
          // to grep through and don't need a viewer.
          stepLog(`Rerun ${executionId} finished — passed=${successCount} failed=${failureCount} duration=${totalDuration}ms`);
          try {
            await fsp.writeFile(path.join(scaffold.logs, 'steps.log'),    stepLogLines.join('\n')    + '\n', 'utf8');
            await fsp.writeFile(path.join(scaffold.logs, 'console.log'),  consoleLogLines.join('\n') + '\n', 'utf8');
          } catch (e) {
            console.warn('[Rerun] failed to write per-rerun logs:', e.message);
          }
          await fsp.writeFile(
            scaffold.replayResult,
            JSON.stringify(replayPayload, null, 2),
            'utf8'
          );
          // Persist the HTML report next to the JSON for portability.
          const htmlPath = await persistRerunHtmlReport({
            scaffold, replayPayload,
            framework: scaffold.project.framework,
            projectId: scaffold.project.projectName,
            testName: scaffold.testName,
          });
          // [ZAC-FIX 2026-05-31] Also write Allure results so users can
          //     allure serve <rerunDir>/allure-results
          // No-op if it fails — the canonical replay-result.json is
          // always the source of truth.
          let allureResultsDir = null;
          try {
            const { writeAllureResults } = await import('../utils/allureWriter.js');
            allureResultsDir = await writeAllureResults({
              rerunDir: scaffold.rerunDir,
              replayPayload,
              framework: scaffold.project.framework,
              projectId: scaffold.project.projectName,
              testName: scaffold.testName,
            });
          } catch (allureErr) {
            console.warn('[Rerun] Allure writer crashed (non-fatal):', allureErr.message);
          }
          rerunLayout = {
            framework: scaffold.project.framework,
            projectName: scaffold.project.projectName,
            testName: scaffold.testName,
            timestamp: scaffold.timestamp,
            rerunDir: scaffold.rerunDir,
            report: scaffold.report,
            replayResult: scaffold.replayResult,
            htmlReport: htmlPath,
            allureResults: allureResultsDir,
          };
          console.log(`[Rerun] Persisted rerun report (status.json + replay-result.json + report/index.html${allureResultsDir ? ' + allure-results/' : ''}) to ${scaffold.rerunDir}`);

          // Bump the live-counter exposed via /api/dashboard/live so any
          // open dashboard refreshes its stats within ~2s instead of
          // waiting for the 30s aggregate-poll interval. Uses the
          // pre-existing markRerunCompleted helper (don't re-roll).
          try {
            const { markRerunCompleted } = await import('../services/dashboardService.js');
            markRerunCompleted({
              executionId,
              framework: scaffold.project.framework,
              projectId: scaffold.project.projectName,
              testName: scaffold.testName,
              success: !(replayPayload.status === 'failed'),
            });
          } catch (_) { /* best-effort — never block on the marker */ }
        } else {
          console.log(`[Rerun] Skipping framework-organized rerun layout: ${validation.error}`);
        }
      } catch (layoutErr) {
        console.warn('[Rerun] Layout persistence failed (non-fatal):', layoutErr.message);
      }
    }

    // T4.1 — When the rerun ends with failures, attach an AI-or-
    // deterministic diagnosis for the FIRST failed step so the IDE can
    // surface it inline with the rerun result. Best-effort; never
    // changes the success/failure shape of the response.
    let firstFailureDiagnosis = null;
    if (failureCount > 0 && !wasCancelled) {
      const firstFail = results.find((r) => r && r.success === false && r.error);
      if (firstFail) {
        try {
          const { diagnoseError } = await import('../services/aiService.js');
          firstFailureDiagnosis = await diagnoseError({
            context: `executing step "${firstFail.step || 'unknown'}" in rerun ${executionId}`,
            error: firstFail.error,
            hint: firstFail.healed ? 'A healing attempt was made; the healer chain ran but ultimately failed.' : undefined,
          });
        } catch (_) { /* swallow — diagnosis is purely additive */ }
      }
    }

    // T4.2 — Mark when this rerun completed so the dashboard's live
    // poll can detect it and pull fresh stats immediately (without
    // waiting for the 30s aggregate tick). The marker lives in
    // dashboardService.markRerunCompleted, which is read by
    // collectLiveSnapshot and exposed at /api/dashboard/live.
    try {
      const { markRerunCompleted } = await import('../services/dashboardService.js');
      markRerunCompleted({
        executionId,
        framework: rerunFramework || null,
        projectId: projectId || null,
        testName: rerunTestName || null,
        success: failureCount === 0 && !wasCancelled,
      });
    } catch (_) { /* best-effort */ }

    // [ZAC-FIX] When every failure is soft, the run as a whole still
    // *passes* — soft assertions are explicit "best-effort" markers and
    // shouldn't flip the run red. Hard failures + timeouts + cancellation
    // still mark the run as failed.
    const overallPassed = (hardFailureCount === 0) && !wasCancelled;
    return {
      // [ZAC-FIX 2026-05-24] Normalised response shape — every rerun
      // branch (plain / Outline / multi-scenario) now returns the same
      // top-level fields: executionId + rerunLayout. The legacy
      // `layout` alias is kept for one cycle so existing clients don't
      // break, but new code should read `rerunLayout`.
      success: overallPassed,
      cancelled: wasCancelled,
      executionId,
      executedSteps: results.length,
      successCount: successCount,
      failureCount: failureCount,
      hardFailureCount,
      softFailureCount,
      timeoutCount,
      duration: `${(totalDuration / 1000).toFixed(2)}s`,
      results: results,
      rerunLayout: rerunLayout || null,
      ...(rerunLayout ? { layout: rerunLayout } : {}),  // legacy alias
      ...(firstFailureDiagnosis ? { aiDiagnosis: firstFailureDiagnosis } : {}),
    };

  } catch (error) {
    console.error(`[Rerun] Execution error:`, error);
    throw new Error(`Failed to execute script: ${error.message}`);
  } finally {
    // Cleanup
    try {
      if (page && !page.isClosed()) await page.close();
      if (context) await context.close();
      if (browser) await browser.close();
    } catch (cleanupError) {
      console.warn('[Rerun] Cleanup error:', cleanupError);
    }

    // Remove from running executions
    runningReruns.delete(executionId);

    // Clear most recent execution if it was this one
    if (mostRecentExecutionId === executionId) {
      mostRecentExecutionId = null;
    }
  }
}

// ============================================================================
// runMultiScenario — extracted from executeMultiScenario
// [ZAC-FIX 2026-05-24] Multi-scenario rerun. Iterates through every
// scenario inside the same browser session and aggregates results into
// one replay-result.json so the dashboard sees a single rerun event
// with N nested scenarios — exactly how Cucumber would report a
// suite-level run.
//
// Why one browser per call (not per scenario): scenarios in the same
// project usually share state (cookies, login). Keeping the same
// context mirrors what `mvn test` does when scenarios live in one
// Feature file. If a future use case wants isolation, a new
// `scenarioIsolation: true` flag can drop+recreate the context per
// scenario without touching this branch.
// ============================================================================
export async function runMultiScenario(scenarios, opts) {
  const {
    browserType = 'chromium',
    baseUrl = 'about:blank',
    headless = false,
    stopOnFailure = false,
    projectId = null,
    framework = null,
    testName = null,
    stepTimeoutMs = 30000,
    defaultAssertMode = 'hard',
  } = opts || {};

  const executionId = `rerun_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  console.log(`[Rerun] Multi-scenario execution ${executionId} — ${scenarios.length} scenario(s)`);

  const startTime = Date.now();
  let browser, context, page;
  const allScenarioResults = [];
  const flatStepResults = []; // stays compatible with replay-result.json shape

  const executionState = {
    cancelled: false, browser: null, context: null, page: null,
    framework: framework || null,
    projectId: projectId || null,
    testName: testName || 'multi-scenario',
    startedAt: new Date(startTime).toISOString(),
  };
  runningReruns.set(executionId, executionState);
  mostRecentExecutionId = executionId;

  try {
    const { chromium, firefox, webkit } = await import('playwright');
    const launcher = browserType === 'firefox' ? firefox : browserType === 'webkit' ? webkit : chromium;
    browser = await launcher.launch({ headless, args: buildRerunLaunchArgs(browserType, headless) });
    executionState.browser = browser;
    // [ZAC-FIX 2026-05-24] Same external-close detection as the plain
    // rerun branch — if the user X's the multi-scenario browser, drop
    // the executionState so cancel/status return cleanly.
    browser.once('disconnected', () => {
      console.log(`[Rerun] 🔌 Multi-scenario browser disconnected externally — marking ${executionId} cancelled`);
      try { executionState.cancelled = true; } catch (_) {}
      try { runningReruns.delete(executionId); } catch (_) {}
      if (mostRecentExecutionId === executionId) mostRecentExecutionId = null;
    });
    context = await browser.newContext();
    executionState.context = context;
    page = await context.newPage();
    executionState.page = page;

    const { executePlaywrightStep } = await import('../utils/stepHandlers.js');

    for (let scIdx = 0; scIdx < scenarios.length; scIdx++) {
      if (executionState.cancelled) break;
      const sc = scenarios[scIdx] || {};
      const scenarioName = sc.name || sc.title || `Scenario ${scIdx + 1}`;
      const scenarioSteps = Array.isArray(sc.steps) ? sc.steps : [];
      const scenarioTags  = Array.isArray(sc.tags)  ? sc.tags  : [];
      console.log(`[Rerun] ── Scenario ${scIdx + 1}/${scenarios.length}: "${scenarioName}" (${scenarioSteps.length} steps)`);

      const scenarioStart = Date.now();
      const scenarioStepResults = [];
      let scenarioFailed = false;

      for (let i = 0; i < scenarioSteps.length; i++) {
        if (executionState.cancelled) break;
        const step = scenarioSteps[i];
        const stepStart = Date.now();
        try {
          if (!page || page.isClosed()) {
            page = await context.newPage();
            executionState.page = page;
          }
          const result = await executePlaywrightStep(page, step, context);
          if (step.kind === 'close' && result === null) {
            page = null;
            executionState.page = null;
          }
          const row = {
            scenario: scenarioName,
            scenarioIndex: scIdx,
            step: step.kind,
            success: true,
            duration: Date.now() - stepStart,
          };
          if (result && typeof result === 'object' && result.healing) {
            row.healing = result.healing;
            if (result.rescuedBy) row.rescuedBy = result.rescuedBy;
          }
          scenarioStepResults.push(row);
          flatStepResults.push(row);
        } catch (err) {
          scenarioFailed = true;
          const row = {
            scenario: scenarioName,
            scenarioIndex: scIdx,
            step: step.kind,
            success: false,
            duration: Date.now() - stepStart,
            error: err && err.message ? err.message : String(err),
          };
          scenarioStepResults.push(row);
          flatStepResults.push(row);
          if (stopOnFailure) break;
        }
      }

      allScenarioResults.push({
        name: scenarioName,
        tags: scenarioTags,
        success: !scenarioFailed && !executionState.cancelled,
        durationMs: Date.now() - scenarioStart,
        executedSteps: scenarioStepResults.length,
        successCount: scenarioStepResults.filter(r => r.success).length,
        failureCount: scenarioStepResults.filter(r => !r.success).length,
        steps: scenarioStepResults,
      });

      if (scenarioFailed && stopOnFailure) {
        console.log(`[Rerun] stopOnFailure — aborting after scenario "${scenarioName}"`);
        break;
      }
    }

    const totalDuration = Date.now() - startTime;
    const successCount = flatStepResults.filter(r => r.success).length;
    const failureCount = flatStepResults.filter(r => !r.success).length;
    const passedScenarios = allScenarioResults.filter(s => s.success).length;
    const failedScenarios = allScenarioResults.filter(s => !s.success).length;

    // Persist to disk (same canonical layout as the single-scenario
    // and Outline branches so /api/dashboard/* sees it identically).
    let rerunLayout = null;
    if (projectId && framework && testName) {
      try {
        const fsp = await import('fs/promises');
        const layout = await import('../services/projectLayout.js');
        const validation = await layout.validateLayoutInputs({ framework, projectName: projectId });
        if (validation.ok) {
          const scaffold = await layout.ensureRerunScaffold({
            framework: validation.framework,
            projectName: validation.projectName,
            testName,
          });
          const replayPayload = {
            executionId, projectId, framework, testName,
            multiScenario: true,
            totalScenarios: allScenarioResults.length,
            passedScenarios,
            failedScenarios,
            success: failedScenarios === 0 && !executionState.cancelled,
            cancelled: executionState.cancelled,
            executedSteps: flatStepResults.length,
            successCount, failureCount,
            durationMs: totalDuration,
            startedAt: new Date(startTime).toISOString(),
            completedAt: new Date().toISOString(),
            results: flatStepResults,
            scenarioResults: allScenarioResults,
            healingSummary: {
              healingEvents:  flatStepResults.filter(s => s.healing).length,
              healedSteps:    flatStepResults.filter(s => s.healing && s.healing.healed).length,
              exhausted:      flatStepResults.filter(s => s.healing && s.healing.exhausted).length,
              aiRescues:      flatStepResults.filter(s => s.rescuedBy === 'ai').length,
              healerRescues:  flatStepResults.filter(s => s.rescuedBy === 'healer').length,
            },
            scrollSummary: { scrollSteps: 0, successfulScrolls: 0 },
          };
          await fsp.writeFile(scaffold.replayResult, JSON.stringify(replayPayload, null, 2), 'utf8');
          await fsp.writeFile(path.join(scaffold.report, 'status.json'),
            JSON.stringify(replayPayload, null, 2), 'utf8');
          const htmlPathMulti = await persistRerunHtmlReport({
            scaffold, replayPayload,
            framework: scaffold.project.framework,
            projectId: scaffold.project.projectName,
            testName: scaffold.testName,
          });
          // [ZAC-FIX 2026-05-31] Allure for multi-scenario runs.
          let allureMulti = null;
          try {
            const { writeAllureResults } = await import('../utils/allureWriter.js');
            allureMulti = await writeAllureResults({
              rerunDir: scaffold.rerunDir,
              replayPayload,
              framework: scaffold.project.framework,
              projectId: scaffold.project.projectName,
              testName: scaffold.testName,
            });
          } catch (_) {}
          rerunLayout = {
            framework: scaffold.project.framework,
            projectName: scaffold.project.projectName,
            testName: scaffold.testName,
            timestamp: scaffold.timestamp,
            rerunDir: scaffold.rerunDir,
            report: scaffold.report,
            replayResult: scaffold.replayResult,
            htmlReport: htmlPathMulti,
            allureResults: allureMulti,
          };
          try {
            const { markRerunCompleted } = await import('../services/dashboardService.js');
            markRerunCompleted({
              executionId, framework, projectId, testName,
              success: failedScenarios === 0 && !executionState.cancelled,
            });
          } catch (_) { /* best effort */ }
        }
      } catch (e) {
        console.warn('[Rerun] Multi-scenario persistence failed (non-fatal):', e.message);
      }
    }

    return {
      success: failedScenarios === 0 && !executionState.cancelled,
      cancelled: executionState.cancelled,
      executionId,
      multiScenario: true,
      totalScenarios: allScenarioResults.length,
      passedScenarios, failedScenarios,
      executedSteps: flatStepResults.length,
      successCount, failureCount,
      duration: `${(totalDuration / 1000).toFixed(2)}s`,
      scenarioResults: allScenarioResults,
      results: flatStepResults,
      rerunLayout,
    };
  } catch (error) {
    console.error('[Rerun] Multi-scenario execution error:', error);
    throw new Error(`Failed to execute multi-scenario rerun: ${error.message}`);
  } finally {
    try {
      if (page && !page.isClosed()) await page.close();
      if (context) await context.close();
      if (browser) await browser.close();
    } catch (cleanupError) {
      console.warn('[Rerun] Cleanup error:', cleanupError.message);
    }
    runningReruns.delete(executionId);
    if (mostRecentExecutionId === executionId) mostRecentExecutionId = null;
  }
}

// ============================================================================
// runScenarioOutline — extracted from executeScenarioOutline
// ============================================================================
export async function runScenarioOutline(steps, examples, opts) {
  const {
    browserType = 'chromium',
    baseUrl = 'about:blank',
    headless = false,
    stopOnFailure = false,
    projectId = null,
    framework = null,
    testName = null,
  } = opts || {};

  const executionId = `rerun_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  console.log(`[Rerun] Starting Scenario Outline execution ${executionId} with ${examples.length} examples`);

  const startTime = Date.now();
  const allResults = [];
  let browser, context, page;

  // Store execution state for cancellation. [ZAC-FIX] now also carries the
  // framework + testName so the persistence block below can drop a
  // replay-result.json that the dashboard / Framework Projection actually
  // sees (previously Outline runs were invisible on /api/dashboard/stats).
  const executionState = {
    cancelled: false, browser: null, context: null, page: null,
    framework: framework || null,
    projectId: projectId || null,
    testName: testName || 'scenario-outline',
    startedAt: new Date().toISOString(),
  };
  runningReruns.set(executionId, executionState);
  mostRecentExecutionId = executionId;

  try {
    // Get browser launcher
    const { chromium, firefox, webkit } = await import('playwright');
    const browserLauncher = browserType === 'firefox' ? firefox :
                           browserType === 'webkit' ? webkit : chromium;

    // Launch browser once for all examples. Same maximization rules as
    // /api/rerun: Chromium/Edge headed → --start-maximized; others omit it.
    browser = await browserLauncher.launch({
      headless: headless,
      args: buildRerunLaunchArgs(browserType, headless),
    });
    executionState.browser = browser;
    // [ZAC-FIX 2026-05-24] External-close detection for Scenario Outline
    // execution — same shape as the plain rerun branch.
    browser.once('disconnected', () => {
      console.log(`[Rerun] 🔌 Outline browser disconnected externally — marking ${executionId} cancelled`);
      try { executionState.cancelled = true; } catch (_) {}
      try { runningReruns.delete(executionId); } catch (_) {}
      if (mostRecentExecutionId === executionId) mostRecentExecutionId = null;
    });

    if (executionState.cancelled) {
      throw new Error('Execution cancelled after browser launch');
    }

    // Detect screen size dynamically
    let screenSize = { width: 1920, height: 1080 };
    if (!headless) {
      try {
        const tempContext = await browser.newContext({ viewport: null });
        const tempPage = await tempContext.newPage();
        await tempPage.goto('about:blank');
        screenSize = await tempPage.evaluate(() => {
          const availWidth = window.screen.availWidth || window.screen.width || 1920;
          const availHeight = window.screen.availHeight || window.screen.height || 1080;
          const browserChromeHeight = 180;
          return {
            width: Math.max(800, availWidth),
            height: Math.max(600, availHeight - browserChromeHeight)
          };
        });
        await tempPage.close();
        await tempContext.close();
      } catch (e) {
        console.log(`[Rerun] Could not detect screen size, using default`);
      }
    }

    context = await browser.newContext({
      viewport: { width: screenSize.width, height: screenSize.height }
    });
    executionState.context = context;

    // Import step handler + healed-locator persistence shim
    const { executePlaywrightStep } = await import('../utils/stepHandlers.js');
    const { saveHealedLocator } = await import('../utils/locatorHealer.js');

    // Execute scenario for each example
    for (let exampleIndex = 0; exampleIndex < examples.length; exampleIndex++) {
      if (executionState.cancelled) {
        console.log(`[Rerun] Execution ${executionId} cancelled at example ${exampleIndex + 1}/${examples.length}`);
        break;
      }

      const example = examples[exampleIndex];
      console.log(`[Rerun] Executing example ${exampleIndex + 1}/${examples.length}:`, example);

      // Create new page for each example
      page = await context.newPage();
      executionState.page = page;

      const exampleResults = {
        exampleIndex: exampleIndex + 1,
        example: example,
        steps: [],
        success: true
      };

      // Replace placeholders in steps with example values
      const stepsWithValues = steps.map(step => {
        const stepCopy = JSON.parse(JSON.stringify(step)); // Deep copy

        // For each key in the example, replace matching values in the step
        for (const key in example) {
          const exampleValue = example[key];

          // Replace in value field (for type, select, etc.)
          if (stepCopy.value !== undefined && stepCopy.value !== null) {
            if (typeof stepCopy.value === 'string') {
              // Replace placeholder format <key>
              if (stepCopy.value.includes(`<${key}>`)) {
                stepCopy.value = stepCopy.value.replace(new RegExp(`<${key}>`, 'g'), exampleValue);
              }
              // If the step kind uses value and we have a matching key, replace it
              // This handles cases where the recorded value should be replaced with example data
              // For type steps, if the key matches the field name, replace the value
              if (stepCopy.kind === 'type' && key === 'value') {
                stepCopy.value = exampleValue;
              }
            }
          }

          // Replace in selector field if it contains placeholder
          if (stepCopy.selector && typeof stepCopy.selector === 'string') {
            if (stepCopy.selector.includes(`<${key}>`)) {
              stepCopy.selector = stepCopy.selector.replace(new RegExp(`<${key}>`, 'g'), exampleValue);
            }
          }

          // Replace in expectedValue field (for assertions)
          if (stepCopy.expectedValue !== undefined && stepCopy.expectedValue !== null) {
            if (typeof stepCopy.expectedValue === 'string') {
              if (stepCopy.expectedValue.includes(`<${key}>`)) {
                stepCopy.expectedValue = stepCopy.expectedValue.replace(new RegExp(`<${key}>`, 'g'), exampleValue);
              }
              // If expectedValue matches a key name, use the example value
              if (stepCopy.expectedValue === key) {
                stepCopy.expectedValue = exampleValue;
              }
            }
          }

          // Replace in text field (for assertions)
          if (stepCopy.text && typeof stepCopy.text === 'string') {
            if (stepCopy.text.includes(`<${key}>`)) {
              stepCopy.text = stepCopy.text.replace(new RegExp(`<${key}>`, 'g'), exampleValue);
            }
          }

          // Replace in url field (for navigate)
          if (stepCopy.url && typeof stepCopy.url === 'string') {
            if (stepCopy.url.includes(`<${key}>`)) {
              stepCopy.url = stepCopy.url.replace(new RegExp(`<${key}>`, 'g'), exampleValue);
            }
          }
        }

        // Special handling: If step has a 'value' field and examples have a 'value' key,
        // replace the step's value with the example's value (for type steps)
        if (stepCopy.kind === 'type' && example.value !== undefined && stepCopy.value !== undefined) {
          stepCopy.value = example.value;
        }

        // Special handling: If step has a 'selectedText' or 'value' for select steps
        if (stepCopy.kind === 'select' && example.value !== undefined) {
          if (stepCopy.selectedText !== undefined) {
            stepCopy.selectedText = example.value;
          }
          if (stepCopy.value !== undefined) {
            stepCopy.value = example.value;
          }
        }

        return stepCopy;
      });

      // Execute steps for this example
      for (let i = 0; i < stepsWithValues.length; i++) {
        if (executionState.cancelled) {
          break;
        }

        const step = stepsWithValues[i];
        const stepStartTime = Date.now();

        try {
          if (!page || page.isClosed()) {
            page = await context.newPage();
            executionState.page = page;
          }

          // Use common step handler - pass context for close step to check for new tabs
          const result = await executePlaywrightStep(page, step, context);

          // Handle page close - if handler returns null, page was closed
          if (step.kind === 'close') {
            if (result === null) {
              // Page was closed
              page = null;
              executionState.page = null;
              console.log(`[Rerun] Page closed successfully in Scenario Outline`);
            } else {
              // Page close was skipped (new tab detected or other pages exist)
              console.log(`[Rerun] Page close skipped in Scenario Outline - preserving page due to new tab or other pages`);
            }
          }

          const outlineStepResult = {
            step: step.kind,
            success: true,
            duration: Date.now() - stepStartTime
          };
          // Forward heal info from executePlaywrightStep so Scenario Outline
          // reruns also surface "🩹 healed via …" in the UI, and persist the
          // mapping when projectId is known.
          if (result && result.healed) {
            outlineStepResult.healed = true;
            outlineStepResult.primarySelector = result.primarySelector;
            outlineStepResult.healedVia = result.healedVia;
            outlineStepResult.healAttempts = result.attempts;
            console.log(`[Rerun][Outline] 🩹 Step ${i + 1} healed: "${result.primarySelector}" -> "${result.healedVia}"`);
            if (projectId) {
              try {
                const saved = await saveHealedLocator({
                  projectName: projectId,
                  pageName: step.normalizedPageName || null,
                  elementName: step.normalizedDescription || step.kind,
                  primarySelector: result.primarySelector,
                  healedSelector: result.healedVia,
                  reason: result.reason || 'primary not found',
                  attempts: result.attempts,
                });
                if (saved.ok) outlineStepResult.healSavedTo = saved.file;
              } catch (persistErr) {
                console.warn('[Rerun][Outline] saveHealedLocator threw (ignored):', persistErr.message);
              }
            }
          }
          exampleResults.steps.push(outlineStepResult);
        } catch (stepError) {
          exampleResults.success = false;
          exampleResults.steps.push({
            step: step.kind || 'unknown',
            success: false,
            error: stepError.message,
            duration: Date.now() - stepStartTime
          });

          // If stopOnFailure is enabled, break immediately on failure (unless cancelled)
          if (stopOnFailure && !executionState.cancelled) {
            console.log(`[Rerun] Stop on failure enabled - stopping execution at step ${i + 1} in example ${exampleIndex + 1}`);
            break; // Exit step loop immediately
          }

          if (!executionState.cancelled) {
            console.log(`[Rerun] Continuing to next step despite failure...`);
          }
        }
      }

      // Close page after each example
      if (page && !page.isClosed()) {
        await page.close();
      }
      page = null;

      allResults.push(exampleResults);
    }

    const totalDuration = Date.now() - startTime;
    const successCount = allResults.filter(r => r.success).length;
    const failureCount = allResults.filter(r => !r.success).length;

    // [ZAC-FIX] Persist Scenario Outline results to disk so dashboards
    // and report viewers see them. Mirrors the non-outline branch
    // (uses validateLayoutInputs + ensureRerunScaffold).
    let rerunLayout = null;
    if (projectId && framework && testName) {
      try {
        const fsp = await import('fs/promises');
        const layout = await import('../services/projectLayout.js');
        const validation = await layout.validateLayoutInputs({ framework, projectName: projectId });
        if (validation.ok) {
          const scaffold = await layout.ensureRerunScaffold({
            framework: validation.framework,
            projectName: validation.projectName,
            testName,
          });
          const stepRows = [];
          for (const er of allResults) {
            (er.steps || []).forEach((s) => stepRows.push({
              step: s.step, success: s.success !== false,
              duration: s.duration, error: s.error,
              healing: s.healing, rescuedBy: s.rescuedBy,
            }));
          }
          const replayPayload = {
            executionId, projectId, framework, testName,
            scenarioOutline: true,
            totalExamples: examples.length,
            executedExamples: allResults.length,
            success: failureCount === 0 && !executionState.cancelled,
            cancelled: executionState.cancelled,
            executedSteps: stepRows.length,
            successCount: stepRows.filter(s => s.success).length,
            failureCount: stepRows.filter(s => !s.success).length,
            durationMs: totalDuration,
            startedAt: new Date(startTime).toISOString(),
            completedAt: new Date().toISOString(),
            results: stepRows,
            exampleResults: allResults,
            healingSummary: {
              healingEvents:  stepRows.filter(s => s.healing).length,
              healedSteps:    stepRows.filter(s => s.healing && s.healing.healed).length,
              exhausted:      stepRows.filter(s => s.healing && s.healing.exhausted).length,
              aiRescues:      stepRows.filter(s => s.rescuedBy === 'ai').length,
              healerRescues:  stepRows.filter(s => s.rescuedBy === 'healer').length,
            },
            scrollSummary: { scrollSteps: 0, successfulScrolls: 0 },
          };
          await fsp.writeFile(scaffold.replayResult, JSON.stringify(replayPayload, null, 2), 'utf8');
          await fsp.writeFile(path.join(scaffold.report, 'status.json'),
            JSON.stringify({ ...replayPayload, scenarioOutline: true }, null, 2), 'utf8');
          const htmlPathOutline = await persistRerunHtmlReport({
            scaffold, replayPayload: { ...replayPayload, scenarioOutline: true },
            framework: scaffold.project.framework,
            projectId: scaffold.project.projectName,
            testName: scaffold.testName,
          });
          // [ZAC-FIX 2026-05-31] Allure for outline runs.
          let allureOutline = null;
          try {
            const { writeAllureResults } = await import('../utils/allureWriter.js');
            allureOutline = await writeAllureResults({
              rerunDir: scaffold.rerunDir,
              replayPayload: { ...replayPayload, scenarioOutline: true },
              framework: scaffold.project.framework,
              projectId: scaffold.project.projectName,
              testName: scaffold.testName,
            });
          } catch (_) {}
          rerunLayout = {
            framework: scaffold.project.framework,
            projectName: scaffold.project.projectName,
            testName: scaffold.testName,
            timestamp: scaffold.timestamp,
            rerunDir: scaffold.rerunDir,
            report: scaffold.report,
            replayResult: scaffold.replayResult,
            htmlReport: htmlPathOutline,
            allureResults: allureOutline,
          };
          console.log(`[Rerun] Persisted Scenario Outline rerun (status.json + replay-result.json + report/index.html${allureOutline ? ' + allure-results/' : ''}) to ${scaffold.rerunDir}`);
          try {
            const { markRerunCompleted } = await import('../services/dashboardService.js');
            markRerunCompleted({
              executionId, framework, projectId, testName,
              success: failureCount === 0 && !executionState.cancelled,
            });
          } catch (_) { /* best effort */ }
        }
      } catch (e) {
        console.warn('[Rerun] Outline persistence failed (non-fatal):', e.message);
      }
    }

    return {
      success: failureCount === 0 && !executionState.cancelled,
      cancelled: executionState.cancelled,
      executionId: executionId,
      scenarioOutline: true,
      totalExamples: examples.length,
      executedExamples: allResults.length,
      successCount: successCount,
      failureCount: failureCount,
      duration: `${(totalDuration / 1000).toFixed(2)}s`,
      results: allResults,
      rerunLayout,
    };

  } catch (error) {
    console.error(`[Rerun] Scenario Outline execution error:`, error);
    throw new Error(`Failed to execute scenario outline: ${error.message}`);
  } finally {
    // Cleanup
    try {
      if (page && !page.isClosed()) await page.close();
      if (context) await context.close();
      if (browser) await browser.close();
    } catch (cleanupError) {
      console.warn('[Rerun] Cleanup error:', cleanupError);
    }

    runningReruns.delete(executionId);
    if (mostRecentExecutionId === executionId) {
      mostRecentExecutionId = null;
    }
  }
}

// ============================================================================
// Top-level dispatcher
// ============================================================================
export async function run(body) {
  const { steps, scenarios, useScenarioOutline, examples, ...opts } = body;
  if (Array.isArray(scenarios) && scenarios.length > 0) return runMultiScenario(scenarios, opts);
  if (useScenarioOutline && examples?.length > 0) return runScenarioOutline(steps, examples, opts);
  return runSingleScenario(steps, opts);
}
