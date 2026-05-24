/**
 * Common Step Handlers - Reusable functionality for recording, code generation, and execution
 *
 * This module provides shared utilities for:
 * - Converting steps to code (Playwright, Selenium, Gherkin)
 * - Executing steps during rerun (with self-healing locator chain)
 * - Normalizing step descriptions
 * - Validating step data
 */

/* -------------------------------------------------------------------------- *
 *  Self-healing locator resolver                                             *
 *                                                                            *
 *  The actual logic lives in utils/locatorHealer.js so it can be unit-tested *
 *  without spinning up Playwright. This file just delegates and re-exports   *
 *  the legacy alias `resolveSelectorWithHealing` for back-compat.            *
 *                                                                            *
 *  Contract recap:                                                           *
 *    - Zero-overhead happy path: no fallbacks AND no element metadata →      *
 *      primary returned unchanged; underlying Playwright call validates.    *
 *    - With fallbacks: primary checked permissively, fallbacks checked       *
 *      strictly (must be unique). Ambiguous candidates are skipped, never    *
 *      silently chosen.                                                      *
 *    - Generated Java step defs already walk SELECTOR_FALLBACKS_BY_PRIMARY   *
 *      at runtime; this gives the live /api/rerun engine the same behaviour. *
 * -------------------------------------------------------------------------- */

import { findElementWithHealing } from './locatorHealer.js';
import {
  resolveCredentialPlaceholders,
  isCredentialPlaceholder,
  maskSecret,
} from './credentialResolver.js';

/**
 * Back-compat alias used by older imports / tests. Prefer
 * `findElementWithHealing` directly in new code.
 */
export async function resolveSelectorWithHealing(page, step, opts = {}) {
  return findElementWithHealing(page, step, opts);
}

/**
 * Internal helper: pull `step.value` and resolve any `${ENV_VAR}` placeholder
 * to the real environment value at runtime. The resolved string is NEVER
 * persisted back onto the step (so it doesn't leak into rerun reports).
 * For logging, callers should use `maskSecret(...)` on the resolved value
 * when the original was a placeholder.
 */
function resolveStepValue(step, fieldName = 'value') {
  const raw = step[fieldName];
  const resolved = resolveCredentialPlaceholders(raw, {
    context: `step.${fieldName}${step.selector ? ` for ${step.selector}` : ''}`,
  });
  const wasPlaceholder = isCredentialPlaceholder(raw);
  return { raw, resolved, wasPlaceholder };
}

/**
 * Execute a single step using Playwright.
 *
 * Returns an optional metadata object `{ healed, primarySelector, healedVia, attempts }`
 * when the self-healing locator chain rescued the step. Returns `null` when
 * the page was closed (legacy contract). Returns `undefined` otherwise.
 *
 * @param {Object} page - Playwright page object
 * @param {Object} step - Step action to execute
 * @param {Object} context - Optional Playwright context object (needed for checking new tabs)
 * @returns {Promise<({ healed: boolean, primarySelector: string, healedVia: string|null,
 *   attempts: Array }|null|undefined)>}
 */
export async function executePlaywrightStep(page, step, context = null) {
  // Single shared healing handle that interactive cases consume below.
  // Helpers may overwrite this; the caller in routes/api.js should pull
  // the final value off the return statement.
  let healInfo;
  switch (step.kind) {
    case 'navigate':
      // Get URL from multiple possible fields (url, selector, or value)
      // This handles cases where navigation might be recorded with different field names
      let navigateUrl = step.url || step.selector || step.value || 'about:blank';
      
      // If we have a selector but no URL, try to get the href from the element (for link clicks)
      if (step.selector && !step.url && !step.value) {
        try {
          const element = await page.locator(step.selector).first();
          const href = await element.getAttribute('href');
          if (href) {
            navigateUrl = href;
            console.log(`[Navigate] Extracted URL from selector ${step.selector}: ${href}`);
          }
        } catch (e) {
          console.warn(`[Navigate] Could not extract href from selector ${step.selector}, using selector as URL:`, e.message);
        }
      }
      
      // Handle relative URLs - resolve against current page URL
      let finalUrl = navigateUrl;
      if (navigateUrl && !navigateUrl.startsWith('http://') && !navigateUrl.startsWith('https://') && !navigateUrl.startsWith('about:') && !navigateUrl.startsWith('file://') && !navigateUrl.startsWith('javascript:')) {
        // If it's a relative path (starts with /), resolve it against the current page URL
        if (navigateUrl.startsWith('/')) {
          try {
            const currentUrl = page.url();
            const baseUrl = new URL(currentUrl).origin;
            finalUrl = baseUrl + navigateUrl;
            console.log(`[Navigate] Resolved relative URL: ${navigateUrl} -> ${finalUrl}`);
          } catch (e) {
            console.warn(`[Navigate] Could not resolve relative URL, using as-is:`, e.message);
            finalUrl = navigateUrl;
          }
        } else if (navigateUrl.includes('.')) {
          // If it looks like a domain, prepend https://
          finalUrl = `https://${navigateUrl}`;
          console.log(`[Navigate] Prefixed domain with https://: ${finalUrl}`);
        } else {
          // If it's just text, log a warning but still try to navigate
          console.warn(`[Navigate] URL "${navigateUrl}" doesn't look like a valid URL, attempting navigation anyway`);
        }
      }
      
      console.log(`[Navigate] Navigating to: ${finalUrl} (from: url=${step.url || 'none'}, selector=${step.selector || 'none'}, value=${step.value || 'none'})`);
      
      // Use 'domcontentloaded' instead of 'networkidle' for better reliability
      // 'networkidle' often times out on sites with continuous network activity (ads, analytics, etc.)
      // 'domcontentloaded' waits for HTML to be parsed and DOM to be ready, which is sufficient for most cases
      try {
        await page.goto(finalUrl, { 
          waitUntil: 'domcontentloaded', 
          timeout: 60000 // Increased timeout to 60s for slow-loading sites
        });
        // Wait a bit for any dynamic content to load
        await page.waitForTimeout(1000);
        console.log(`[Navigate] Successfully navigated to: ${finalUrl}`);
      } catch (error) {
        // If domcontentloaded times out, try with 'load' as fallback
        if (error.message.includes('timeout')) {
          console.warn(`[Navigate] domcontentloaded timed out for ${finalUrl}, trying 'load'...`);
          await page.goto(finalUrl, { 
            waitUntil: 'load', 
            timeout: 60000 
          });
          await page.waitForTimeout(1000);
          console.log(`[Navigate] Successfully navigated to: ${finalUrl} (using 'load' wait)`);
        } else {
          console.error(`[Navigate] Failed to navigate to ${finalUrl}:`, error.message);
          throw error;
        }
      }
      break;

    case 'click':
      // Detect if click causes navigation (pagination, links, etc.)
      const urlBeforeClick = page.url();
      const navigationPromise = page.waitForURL('**', { timeout: 5000 }).catch(() => null);

      // Heal first: pick whichever selector in the recorded chain is
      // currently visible, so the click survives a UI redesign.
      healInfo = await findElementWithHealing(page, step, { state: 'visible' });

      // Perform the click against the healed (or original) selector.
      await page.click(healInfo.selector, { timeout: 10000 });
      
      // Wait for potential navigation to start
      await page.waitForTimeout(200);
      
      // Check if navigation occurred
      try {
        await navigationPromise;
        // Navigation occurred - wait for page to stabilize
        console.log(`[Click] Navigation detected after clicking ${step.selector}, waiting for page to load...`);
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
        // Wait for dynamic content to load (pagination, AJAX, etc.)
        await page.waitForTimeout(1000);
        // Wait for network to be mostly idle (but don't fail if it times out)
        try {
          await page.waitForLoadState('networkidle', { timeout: 5000 });
        } catch (e) {
          // Network idle timeout is OK - some sites have continuous activity
          console.log(`[Click] Network idle timeout (expected for some sites), continuing...`);
        }
        console.log(`[Click] Page loaded after navigation to: ${page.url()}`);
      } catch (e) {
        // No navigation or navigation already completed
        const urlAfterClick = page.url();
        if (urlBeforeClick !== urlAfterClick) {
          // URL changed but navigation promise didn't catch it - wait anyway
          console.log(`[Click] URL changed from ${urlBeforeClick} to ${urlAfterClick}, waiting for page to load...`);
          await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
          await page.waitForTimeout(1000);
        } else {
          // No navigation - just wait a bit for any dynamic updates
          await page.waitForTimeout(500);
        }
      }
      break;

    case 'doubleClick':
      healInfo = await findElementWithHealing(page, step, { state: 'visible' });
      await page.dblclick(healInfo.selector, { timeout: 10000 });
      await page.waitForTimeout(300);
      break;

    case 'type':
    case 'fill': { // [ZAC-FIX] alias — Playwright API uses .fill(); QA naturally
                   //              writes step.kind = 'fill'. Treat both identically
                   //              so a recorded "type" and a hand-written "fill"
                   //              produce the same Playwright behaviour.
      healInfo = await findElementWithHealing(page, step, { state: 'visible' });
      const { resolved: typedValue, wasPlaceholder } = resolveStepValue(step, 'value');
      await page.fill(healInfo.selector, '', { timeout: 10000 });
      await page.fill(healInfo.selector, typedValue || '', { timeout: 10000 });
      // Mask the resolved value in logs when it came from a credential placeholder.
      const safeForLog = wasPlaceholder ? maskSecret(typedValue) : (typedValue || '');
      console.log(`[Step:${step.kind}] ${healInfo.selector} ← ${safeForLog} (${(typedValue || '').length} chars)`);
      await page.waitForTimeout(200);
      break;
    }

    case 'select': {
      healInfo = await findElementWithHealing(page, step, { state: 'attached' });
      const rawSel = step.value || step.selectedText || '';
      const selValue = resolveCredentialPlaceholders(rawSel, {
        context: `step.value for ${healInfo.selector}`,
      });
      await page.selectOption(healInfo.selector, selValue || '', { timeout: 10000 });
      await page.waitForTimeout(300);
      break;
    }

    case 'check':
      healInfo = await findElementWithHealing(page, step, { state: 'visible' });
      await page.check(healInfo.selector, { timeout: 10000 });
      await page.waitForTimeout(200);
      break;

    case 'uncheck':
      healInfo = await findElementWithHealing(page, step, { state: 'visible' });
      await page.uncheck(healInfo.selector, { timeout: 10000 });
      await page.waitForTimeout(200);
      break;

    case 'hover':
      healInfo = await findElementWithHealing(page, step, { state: 'visible' });
      await page.hover(healInfo.selector, { timeout: 10000 });
      await page.waitForTimeout(200);
      break;

    case 'keyPress':
      const key = step.key || step.value || 'Enter';
      await page.keyboard.press(key);
      await page.waitForTimeout(200);
      break;

    case 'waitFor':
      await page.waitForTimeout(Number(step.ms) || 500);
      break;

    case 'waitForSelector':
      healInfo = await findElementWithHealing(page, step, { state: 'attached' });
      await page.waitForSelector(healInfo.selector, { timeout: 10000 });
      break;

    case 'assertText':
      healInfo = await findElementWithHealing(page, step, { state: 'attached' });
      const text = await page.textContent(healInfo.selector);
      const expectedText = step.expectedValue || step.text || '';
      if (!text || !text.includes(expectedText)) {
        // T3.13 — assertion repair. The element exists but its text
        // doesn't match. This is the textbook "label changed" scenario:
        // "Sign in" → "Log in", "Cart (0)" → "Cart". Two-tier rescue:
        //   (a) Soft compare — strip non-alphanumerics + lowercase. If
        //       the cores match, accept the new text and tag healed.
        //   (b) AI suggest — ask the local LLM whether the actual text
        //       is a semantically equivalent rewording. Only consult
        //       AI when (a) fails AND a provider is available.
        const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
        const expectedCore = norm(expectedText);
        const actualCore   = norm(text);
        if (expectedCore && actualCore && actualCore.includes(expectedCore)) {
          // Soft repair — accept.
          if (healInfo) healInfo.repaired = { kind: 'assertion-soft', from: expectedText, to: text };
          break;
        }
        try {
          const { getAiProvider } = await import('../services/aiService.js');
          const ai = await getAiProvider();
          if (ai && ai.available && ai.available()) {
            // Reuse the locator-suggest channel as a generic ask. We
            // don't have a dedicated assertText prompt yet; phrase it
            // as a yes/no by passing the expected string as elementHint.
            const resp = await ai.suggestLocator({
              failedSelector: 'assertText',
              elementHint: `Are these texts equivalent in meaning? Expected: "${expectedText}". Actual: "${text}". Reply YES or NO only.`,
              htmlSnippet: '',
            }).catch(() => null);
            const raw = (resp && resp.raw) || '';
            if (/^\s*yes\b/i.test(raw) || /equivalent|same|match/i.test(raw)) {
              if (healInfo) healInfo.repaired = { kind: 'assertion-ai', from: expectedText, to: text };
              break;
            }
          }
        } catch (_aiErr) { /* AI is best-effort — fall through to throw */ }
        throw new Error(`Expected text "${expectedText}" not found. Found: "${text}"`);
      }
      break;

    case 'assertVisible':
      healInfo = await findElementWithHealing(page, step, { state: 'visible' });
      await page.waitForSelector(healInfo.selector, { state: 'visible', timeout: 10000 });
      break;

    case 'assertAttribute': {
      // [ZAC-FIX 2026-05-24] The recorder + every codegen writes the
      // attribute name into step.value; newer callers (and the docs)
      // use step.attribute / step.attributeName which is much clearer.
      // Accept all three so the rerun engine matches every other layer.
      // The expected value lives in step.expectedValue.
      const attrName = step.attribute || step.attributeName || step.value || 'value';
      const expectedAttr = step.expectedValue !== undefined ? String(step.expectedValue) : '';
      healInfo = await findElementWithHealing(page, step, { state: 'attached' });
      const attrValue = await page.getAttribute(healInfo.selector, attrName);
      // For form fields, getAttribute('value') returns the *initial* HTML
      // attribute, not the current input value (which is the .value DOM
      // property and changes after typing). When users assert against
      // 'value', read the live property so the assertion matches what the
      // user types in.
      const live = (attrName === 'value')
        ? await page.locator(healInfo.selector).inputValue().catch(() => null)
        : null;
      const actual = (live !== null && live !== undefined) ? live : attrValue;
      if (String(actual) !== expectedAttr) {
        throw new Error(`Expected attribute "${attrName}" to be "${expectedAttr}", got "${actual}"`);
      }
      break;
    }

    case 'screenshot': {
      // [ZAC-FIX 2026-05-24] Playwright infers mime type from the
      // file extension; a bare filename like "shot" 500s the rerun
      // with "unsupported mime type 'null'". Always normalise to .png
      // unless the caller explicitly asked for .jpg/.jpeg.
      //
      // Also: when invoked inside a rerun, route the file to the
      // rerun's <ts>/screenshots/ directory (passed in via
      // context.screenshotsDir). Without this, screenshots ended up
      // in the server's CWD, the report viewer's gallery showed
      // "0 screenshots", and users wondered where they went.
      let filename = step.filename || 'screenshot.png';
      if (!/\.(png|jpe?g)$/i.test(filename)) filename = `${filename}.png`;
      let outPath = filename;
      try {
        if (context && context.screenshotsDir && !filename.includes('/') && !filename.includes('\\')) {
          const path = (await import('path')).default;
          const fsp = (await import('fs/promises'));
          await fsp.mkdir(context.screenshotsDir, { recursive: true });
          outPath = path.join(context.screenshotsDir, filename);
        }
      } catch (_) { /* fall back to bare filename */ }
      await page.screenshot({ path: outPath });
      break;
    }

    case 'scroll':
      // Scroll can be: scroll to element, scroll to Y position, scroll to top/bottom
      if (step.scroll && step.scroll.mode === 'element') {
        // Scroll to element using locator candidates (with healing fallback)
        const seedSelector = step.selector || (step.scroll.locatorCandidates && step.scroll.locatorCandidates[step.scroll.primaryLocatorIndex || 0]?.selector);
        if (seedSelector) {
          healInfo = await findElementWithHealing(page, { ...step, selector: seedSelector }, { state: 'attached' });
          await page.locator(healInfo.selector).scrollIntoViewIfNeeded({ timeout: 10000 });
        } else {
          throw new Error('No selector available for scroll to element');
        }
      } else if (step.scroll && step.scroll.mode === 'bottom') {
        // Scroll to bottom
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
      } else if (step.scroll && step.scroll.mode === 'top') {
        // Scroll to top
        await page.evaluate(() => {
          window.scrollTo(0, 0);
        });
      } else if (step.scroll && step.scroll.mode === 'y') {
        // Scroll to Y position
        const y = step.scroll.y || step.scrollY || step.y || 0;
        await page.evaluate((yPos) => {
          window.scrollTo(0, yPos);
        }, y);
      } else if (step.selector) {
        // Legacy: Scroll to element
        await page.locator(step.selector).scrollIntoViewIfNeeded({ timeout: 10000 });
      } else if (step.deltaX !== undefined || step.deltaY !== undefined) {
        // Legacy: Scroll by pixels
        await page.mouse.wheel(step.deltaX || 0, step.deltaY || 0);
      } else if (step.x !== undefined || step.y !== undefined) {
        // Legacy: Scroll to position
        await page.evaluate(({ x, y }) => {
          window.scrollTo(x || 0, y || 0);
        }, { x: step.x, y: step.y });
      } else {
        // Default: scroll down by a reasonable amount
        await page.mouse.wheel(0, 500);
      }
      await page.waitForTimeout(300);
      break;

    case 'close':
      if (page && !page.isClosed()) {
        // The caller (routes/api.js) tracks page count before each step
        // and will check if a new tab was opened by previous steps
        // Here we just close the page - the caller handles the logic
        await page.close();
        // Return null to indicate page was closed (caller should handle this)
        return null;
      }
      break;

    // [ZAC-FIX 2026-05-24] DB / API validation step.
    // ZAC doesn't ship a SQL connector — the QA-tool design is that DB state
    // is exposed through a backend API endpoint, and the test asserts on
    // that response. Aliases: 'dbValidate', 'db', 'apiAssert', 'apiCall'.
    //
    // Step shape:
    //   {
    //     kind: 'dbValidate',
    //     url: 'https://api.example.com/users/42',   // or `endpoint`
    //     method: 'GET',                              // optional; default GET
    //     headers: { 'X-Auth': '...' },               // optional
    //     body: { ... } | string,                     // optional, for POST/PUT
    //     expectedStatus: 200,                        // optional; default 200
    //     expectedJsonPath: 'data.user.id',           // optional, dot path
    //     expectedValue: 42,                          // optional; pairs w/ jsonPath
    //     expectedRowCount: 5,                        // optional; pairs w/ jsonPath -> array
    //     timeoutMs: 10000                            // optional
    //   }
    case 'dbValidate':
    case 'db':
    case 'apiAssert':
    case 'apiCall': {
      const url = step.url || step.endpoint;
      if (!url) throw new Error('dbValidate step requires a url/endpoint');
      const method = (step.method || 'GET').toUpperCase();
      const expectedStatus = Number.isFinite(step.expectedStatus) ? step.expectedStatus : 200;
      const requestOpts = {
        method,
        headers: step.headers || {},
        timeout: step.timeoutMs || 10000,
      };
      if (step.body !== undefined && step.body !== null && method !== 'GET' && method !== 'HEAD') {
        requestOpts.data = typeof step.body === 'string' ? step.body : JSON.stringify(step.body);
        if (!requestOpts.headers['Content-Type'] && typeof step.body !== 'string') {
          requestOpts.headers['Content-Type'] = 'application/json';
        }
      }
      const apiCtx = page ? page.request : null;
      if (!apiCtx) throw new Error('dbValidate step requires a Playwright page (no API context)');
      const resp = await apiCtx.fetch(url, requestOpts);
      const status = resp.status();
      if (status !== expectedStatus) {
        throw new Error(`dbValidate ${method} ${url} → status ${status}, expected ${expectedStatus}`);
      }
      // Optional payload assertions
      if (step.expectedJsonPath) {
        const json = await resp.json().catch(() => null);
        if (!json) throw new Error(`dbValidate ${url} → response was not valid JSON`);
        const dotPath = String(step.expectedJsonPath).split('.').filter(Boolean);
        let cursor = json;
        for (const seg of dotPath) {
          const idx = /^\d+$/.test(seg) ? Number(seg) : seg;
          cursor = cursor != null ? cursor[idx] : undefined;
        }
        if ('expectedRowCount' in step) {
          const expected = step.expectedRowCount;
          const actual = Array.isArray(cursor) ? cursor.length : -1;
          if (actual !== expected) {
            throw new Error(`dbValidate ${url} jsonPath=${step.expectedJsonPath} expected ${expected} rows, got ${actual}`);
          }
        }
        if ('expectedValue' in step) {
          // Loose-eq comparison (numbers vs strings) since JSON sometimes
          // round-trips numbers as strings on the wire.
          // eslint-disable-next-line eqeqeq
          if (cursor != step.expectedValue) {
            throw new Error(`dbValidate ${url} jsonPath=${step.expectedJsonPath} expected ${JSON.stringify(step.expectedValue)}, got ${JSON.stringify(cursor)}`);
          }
        }
      }
      // No-op for the page; signals success via not throwing.
      break;
    }

    default:
      throw new Error(`Unknown step kind: ${step.kind}`);
  }

  // Surface healing metadata to the caller (routes/api.js -> rerun result)
  // so the UI can show "🩹 healed via …" next to the step AND the route can
  // call saveHealedLocator() to persist the heal mapping to disk.
  if (healInfo && healInfo.healed) {
    return {
      healed: true,
      primarySelector: healInfo.primarySelector,
      healedVia: healInfo.healedVia,
      reason: healInfo.reason || 'healed',
      attempts: healInfo.attempts,
    };
  }
  return undefined;
}

/**
 * Generate Playwright TypeScript code for a step
 * @param {Object} step - Step action
 * @returns {string} Generated code line(s)
 */
export function generatePlaywrightStepCode(step) {
  const lines = [];
  
  switch (step.kind) {
    case 'navigate':
      // Use 'domcontentloaded' for better reliability (avoids timeout on sites with continuous network activity)
      lines.push(`  await page.goto('${step.url}', { waitUntil: 'domcontentloaded', timeout: 60000 });`);
      break;
    case 'click':
      lines.push(`  await page.click(${JSON.stringify(step.selector)});`);
      break;
    case 'doubleClick':
      lines.push(`  await page.dblclick(${JSON.stringify(step.selector)});`);
      break;
    case 'type':
      lines.push(`  await page.fill(${JSON.stringify(step.selector)}, ${JSON.stringify(step.value || '')});`);
      break;
    case 'select':
      lines.push(`  await page.selectOption(${JSON.stringify(step.selector)}, ${JSON.stringify(step.value || step.selectedText || '')});`);
      break;
    case 'check':
      lines.push(`  await page.check(${JSON.stringify(step.selector)});`);
      break;
    case 'uncheck':
      lines.push(`  await page.uncheck(${JSON.stringify(step.selector)});`);
      break;
    case 'hover':
      lines.push(`  await page.hover(${JSON.stringify(step.selector)});`);
      break;
    case 'keyPress':
      lines.push(`  await page.keyboard.press('${step.key || step.value || 'Enter'}');`);
      break;
    case 'assertText':
      lines.push(`  await expect(page.locator(${JSON.stringify(step.selector)})).toContainText(${JSON.stringify(step.expectedValue || step.text)});`);
      break;
    case 'assertVisible':
      lines.push(`  await expect(page.locator(${JSON.stringify(step.selector)})).toBeVisible();`);
      break;
    case 'assertAttribute':
      const attrValue = step.expectedValue || '';
      if (step.assertionType === 'equals') {
        lines.push(`  await expect(page.locator(${JSON.stringify(step.selector)})).toHaveAttribute(${JSON.stringify(step.value)}, ${JSON.stringify(attrValue)});`);
      } else {
        lines.push(`  const attr = await page.locator(${JSON.stringify(step.selector)}).getAttribute(${JSON.stringify(step.value)});`);
        lines.push(`  expect(attr).${getAssertionMethod(step.assertionType)}(${JSON.stringify(attrValue)});`);
      }
      break;
    case 'assertCount':
      const count = parseInt(step.expectedValue) || 0;
      lines.push(`  await expect(page.locator(${JSON.stringify(step.selector)})).toHaveCount(${count});`);
      break;
    case 'assertValue':
      const val = step.expectedValue || '';
      if (step.assertionType === 'equals') {
        lines.push(`  await expect(page.locator(${JSON.stringify(step.selector)})).toHaveValue(${JSON.stringify(val)});`);
      } else {
        lines.push(`  const value = await page.locator(${JSON.stringify(step.selector)}).inputValue();`);
        lines.push(`  expect(value).${getAssertionMethod(step.assertionType)}(${JSON.stringify(val)});`);
      }
      break;
    case 'waitFor':
      lines.push(`  await page.waitForTimeout(${Number(step.ms) || 500});`);
      break;
    case 'waitForSelector':
      lines.push(`  await page.waitForSelector(${JSON.stringify(step.selector)});`);
      break;
    case 'screenshot':
      lines.push(`  await page.screenshot({ path: '${step.filename || 'screenshot.png'}' });`);
      break;
    case 'scroll':
      // Handle new scroll modes: element, y, bottom, top
      if (step.scroll && step.scroll.mode === 'element') {
        // Scroll to element using locator candidates
        const selector = step.selector || (step.scroll.locatorCandidates && step.scroll.locatorCandidates[step.scroll.primaryLocatorIndex || 0]?.selector);
        if (selector) {
          lines.push(`  await page.locator(${JSON.stringify(selector)}).scrollIntoViewIfNeeded();`);
        } else {
          lines.push(`  // No selector available for scroll to element`);
        }
      } else if (step.scroll && step.scroll.mode === 'bottom') {
        lines.push(`  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));`);
      } else if (step.scroll && step.scroll.mode === 'top') {
        lines.push(`  await page.evaluate(() => window.scrollTo(0, 0));`);
      } else if (step.scroll && step.scroll.mode === 'y') {
        const y = step.scroll.y || step.scrollY || step.y || 0;
        lines.push(`  await page.evaluate((yPos) => window.scrollTo(0, yPos), ${y});`);
      } else if (step.selector) {
        // Legacy: Scroll to element
        lines.push(`  await page.locator(${JSON.stringify(step.selector)}).scrollIntoViewIfNeeded();`);
      } else if (step.deltaX !== undefined || step.deltaY !== undefined) {
        // Legacy: Scroll by pixels
        lines.push(`  await page.mouse.wheel(${step.deltaX || 0}, ${step.deltaY || 0});`);
      } else {
        // Default: scroll down
        lines.push(`  await page.mouse.wheel(0, 500);`);
      }
      break;
    case 'close':
      lines.push(`  await page.close();`);
      break;
    case 'apiCall':
      lines.push(`  const resp = await page.request.${(step.method || 'GET').toLowerCase()}('${step.url}');`);
      if (step.assertResponse) {
        lines.push(`  expect(resp.status()).toBe(${step.expectedStatus || 200});`);
      }
      break;
  }
  
  return lines.join('\n');
}

/**
 * Generate Selenium Java code for a step
 * @param {Object} step - Step action
 * @returns {string} Generated code line(s)
 */
export function generateSeleniumStepCode(step) {
  const lines = [];
  
  switch (step.kind) {
    case 'navigate':
      lines.push(`    driver.get("${step.url}");`);
      break;
    case 'click':
      lines.push(`    wait.until(ExpectedConditions.elementToBeClickable(By.cssSelector(${JSON.stringify(step.selector)})))).click();`);
      break;
    case 'doubleClick':
      lines.push(`    WebElement element = driver.findElement(By.cssSelector(${JSON.stringify(step.selector)}));`);
      lines.push(`    new org.openqa.selenium.interactions.Actions(driver).doubleClick(element).perform();`);
      break;
    case 'type':
      lines.push(`    WebElement input = driver.findElement(By.cssSelector(${JSON.stringify(step.selector)}));`);
      lines.push(`    input.clear();`);
      lines.push(`    input.sendKeys(${JSON.stringify(step.value || '')});`);
      break;
    case 'select':
      lines.push(`    WebElement select = driver.findElement(By.cssSelector(${JSON.stringify(step.selector)}));`);
      lines.push(`    new Select(select).selectByVisibleText(${JSON.stringify(step.selectedText || step.value || '')});`);
      break;
    case 'check':
      lines.push(`    WebElement checkbox = driver.findElement(By.cssSelector(${JSON.stringify(step.selector)}));`);
      lines.push(`    if (!checkbox.isSelected()) checkbox.click();`);
      break;
    case 'uncheck':
      lines.push(`    WebElement checkbox = driver.findElement(By.cssSelector(${JSON.stringify(step.selector)}));`);
      lines.push(`    if (checkbox.isSelected()) checkbox.click();`);
      break;
    case 'hover':
      lines.push(`    WebElement element = driver.findElement(By.cssSelector(${JSON.stringify(step.selector)}));`);
      lines.push(`    new org.openqa.selenium.interactions.Actions(driver).moveToElement(element).perform();`);
      break;
    case 'keyPress':
      lines.push(`    driver.findElement(By.cssSelector("body")).sendKeys(org.openqa.selenium.Keys.${(step.key || step.value || 'ENTER').toUpperCase()});`);
      break;
    case 'assertText':
      lines.push(`    WebElement element = driver.findElement(By.cssSelector(${JSON.stringify(step.selector)}));`);
      lines.push(`    assertTrue(element.getText().contains(${JSON.stringify(step.expectedValue || step.text)}), "Expected text not found");`);
      break;
    case 'assertVisible':
      lines.push(`    wait.until(ExpectedConditions.visibilityOfElementLocated(By.cssSelector(${JSON.stringify(step.selector)})));`);
      break;
    case 'assertAttribute':
      const attrValue = step.expectedValue || '';
      lines.push(`    WebElement element = driver.findElement(By.cssSelector(${JSON.stringify(step.selector)}));`);
      lines.push(`    assertEquals(${JSON.stringify(attrValue)}, element.getAttribute(${JSON.stringify(step.value)}), "Attribute value mismatch");`);
      break;
    case 'assertCount':
      const count = parseInt(step.expectedValue) || 0;
      lines.push(`    assertEquals(${count}, driver.findElements(By.cssSelector(${JSON.stringify(step.selector)})).size(), "Element count mismatch");`);
      break;
    case 'assertValue':
      const val = step.expectedValue || '';
      lines.push(`    WebElement element = driver.findElement(By.cssSelector(${JSON.stringify(step.selector)}));`);
      lines.push(`    assertEquals(${JSON.stringify(val)}, element.getAttribute("value"), "Value mismatch");`);
      break;
    case 'waitFor':
      lines.push(`    try { Thread.sleep(${Number(step.ms) || 500}); } catch (InterruptedException e) {}`);
      break;
    case 'waitForSelector':
      lines.push(`    wait.until(ExpectedConditions.presenceOfElementLocated(By.cssSelector(${JSON.stringify(step.selector)})));`);
      break;
    case 'screenshot':
      lines.push(`    ((org.openqa.selenium.TakesScreenshot) driver).getScreenshotAs(org.openqa.selenium.OutputType.FILE);`);
      break;
    case 'scroll':
      // Handle new scroll modes: element, y, bottom, top
      if (step.scroll && step.scroll.mode === 'element') {
        // Scroll to element using locator candidates
        const selector = step.selector || (step.scroll.locatorCandidates && step.scroll.locatorCandidates[step.scroll.primaryLocatorIndex || 0]?.selector);
        if (selector) {
          lines.push(`    WebElement element = driver.findElement(By.cssSelector(${JSON.stringify(selector)}));`);
          lines.push(`    ((org.openqa.selenium.JavascriptExecutor) driver).executeScript("arguments[0].scrollIntoView(true);", element);`);
        } else {
          lines.push(`    // No selector available for scroll to element`);
        }
      } else if (step.scroll && step.scroll.mode === 'bottom') {
        lines.push(`    ((org.openqa.selenium.JavascriptExecutor) driver).executeScript("window.scrollTo(0, document.body.scrollHeight);");`);
      } else if (step.scroll && step.scroll.mode === 'top') {
        lines.push(`    ((org.openqa.selenium.JavascriptExecutor) driver).executeScript("window.scrollTo(0, 0);");`);
      } else if (step.scroll && step.scroll.mode === 'y') {
        const y = step.scroll.y || step.scrollY || step.y || 0;
        lines.push(`    ((org.openqa.selenium.JavascriptExecutor) driver).executeScript("window.scrollTo(0, " + ${y} + ");");`);
      } else if (step.selector) {
        // Legacy: Scroll to element
        lines.push(`    WebElement element = driver.findElement(By.cssSelector(${JSON.stringify(step.selector)}));`);
        lines.push(`    ((org.openqa.selenium.JavascriptExecutor) driver).executeScript("arguments[0].scrollIntoView(true);", element);`);
      } else if (step.deltaX !== undefined || step.deltaY !== undefined) {
        // Legacy: Scroll by pixels
        lines.push(`    ((org.openqa.selenium.JavascriptExecutor) driver).executeScript("window.scrollBy(${step.deltaX || 0}, ${step.deltaY || 0});");`);
      } else {
        // Default: scroll down
        lines.push(`    ((org.openqa.selenium.JavascriptExecutor) driver).executeScript("window.scrollBy(0, 500);");`);
      }
      break;
    case 'close':
      lines.push(`    driver.close();`);
      break;
  }
  
  return lines.join('\n');
}

/**
 * Generate Gherkin step line for a step
 * @param {Object} step - Step action
 * @param {boolean} usePlaceholders - Whether to use placeholders for Scenario Outline
 * @returns {string} Generated Gherkin step line
 */
export function generateGherkinStepLine(step, usePlaceholders = false) {
  switch (step.kind) {
    case 'navigate':
      const pageName = step.normalizedPageName || step.url || 'Page';
      return usePlaceholders ? `    Given I navigate to "<url>"` : `    Given I navigate to "${step.url}"`;
    
    case 'click':
      const desc = step.normalizedDescription || step.selector || 'Element';
      return usePlaceholders ? `    When I click "<selector>"` : `    When I click "${step.selector}"`;
    
    case 'type':
      const fieldDesc = step.normalizedDescription || step.selector || 'Field';
      const value = step.value || '';
      return usePlaceholders ? `    And I type "<value>" into "<selector>"` : `    And I type "${value}" into "${step.selector}"`;
    
    case 'doubleClick':
      const dblDesc = step.normalizedDescription || step.selector || 'Element';
      return usePlaceholders ? `    When I double click "<selector>"` : `    When I double click "${step.selector}"`;
    
    case 'select':
      const selectDesc = step.normalizedDescription || step.selector || 'Dropdown';
      const selectValue = step.selectedText || step.value || '';
      return usePlaceholders ? `    And I select "<value>" from "<selector>"` : `    And I select "${selectValue}" from "${step.selector}"`;
    
    case 'check':
      const checkDesc = step.normalizedDescription || step.selector || 'Checkbox';
      return usePlaceholders ? `    And I check "<selector>"` : `    And I check "${step.selector}"`;
    
    case 'uncheck':
      const uncheckDesc = step.normalizedDescription || step.selector || 'Checkbox';
      return usePlaceholders ? `    And I uncheck "<selector>"` : `    And I uncheck "${step.selector}"`;
    
    case 'hover':
      const hoverDesc = step.normalizedDescription || step.selector || 'Element';
      return usePlaceholders ? `    When I hover over "<selector>"` : `    When I hover over "${step.selector}"`;
    
    case 'assertText':
      const textDesc = step.normalizedDescription || step.selector || 'Element';
      const expectedText = step.expectedValue || step.text || '';
      return usePlaceholders ? `    Then I should see "<text>" in "<selector>"` : `    Then I should see "${expectedText}" in "${step.selector}"`;
    
    case 'assertVisible':
      const visibleDesc = step.normalizedDescription || step.selector || 'Element';
      return usePlaceholders ? `    Then "<selector>" should be visible` : `    Then "${step.selector}" should be visible`;
    
    case 'assertNotVisible':
      const notVisibleDesc = step.normalizedDescription || step.selector || 'Element';
      return usePlaceholders ? `    Then "<selector>" should not be visible` : `    Then "${step.selector}" should not be visible`;
    
    case 'assertEnabled':
      const enabledDesc = step.normalizedDescription || step.selector || 'Element';
      return usePlaceholders ? `    Then "<selector>" should be enabled` : `    Then "${step.selector}" should be enabled`;
    
    case 'assertDisabled':
      const disabledDesc = step.normalizedDescription || step.selector || 'Element';
      return usePlaceholders ? `    Then "<selector>" should be disabled` : `    Then "${step.selector}" should be disabled`;
    
    case 'assertChecked':
      const checkedDesc = step.normalizedDescription || step.selector || 'Element';
      return usePlaceholders ? `    Then "<selector>" should be checked` : `    Then "${step.selector}" should be checked`;
    
    case 'assertNotChecked':
      const notCheckedDesc = step.normalizedDescription || step.selector || 'Element';
      return usePlaceholders ? `    Then "<selector>" should not be checked` : `    Then "${step.selector}" should not be checked`;
    
    case 'assertAttribute':
      const attrDesc = step.normalizedDescription || step.selector || 'Element';
      const attr = step.value || 'value';
      const attrVal = step.expectedValue || '';
      return usePlaceholders ? `    Then "<selector>" should have attribute "<attr>" equal to "<value>"` : `    Then "${step.selector}" should have attribute "${attr}" equal to "${attrVal}"`;
    
    case 'waitFor':
      const waitMs = step.ms || 500;
      return usePlaceholders ? `    And I wait for <ms> milliseconds` : `    And I wait for ${waitMs} milliseconds`;
    
    case 'waitForSelector':
      const waitDesc = step.normalizedDescription || step.selector || 'Selector';
      return usePlaceholders ? `    And I wait for "<selector>" to appear` : `    And I wait for "${step.selector}" to appear`;
    
    case 'screenshot':
      return usePlaceholders ? `    And I take a screenshot` : `    And I take a screenshot`;
    
    case 'scroll':
      if (step.selector) {
        return usePlaceholders ? `    And I scroll to "<selector>"` : `    And I scroll to "${step.selector}"`;
      } else {
        return `    And I scroll the page`;
      }
    case 'close':
      return `    And I close the browser`;
    
    case 'keyPress':
      const key = step.key || step.value || 'Enter';
      return usePlaceholders ? `    When I press the "<key>" key` : `    When I press the "${key}" key`;
    
    default:
      return `    # Unknown step: ${step.kind}`;
  }
}

/**
 * Get assertion method name for Playwright
 * @param {string} type - Assertion type (equals, contains, etc.)
 * @returns {string} Method name
 */
export function getAssertionMethod(type) {
  const methods = {
    equals: 'toBe',
    contains: 'toContain',
    startsWith: 'toMatch',
    endsWith: 'toMatch',
    regex: 'toMatch'
  };
  return methods[type] || 'toBe';
}

/**
 * Get human-readable label for a step
 * @param {Object} step - Step action
 * @returns {string} Human-readable label
 */
export function getStepLabel(step) {
  switch (step.kind) {
    case 'navigate':
      return `Navigate to ${step.url || 'page'}`;
    case 'click':
      return `Click ${step.normalizedDescription || step.selector || 'element'}`;
    case 'doubleClick':
      return `Double click ${step.normalizedDescription || step.selector || 'element'}`;
    case 'type':
      const value = (step.value || '').substring(0, 30);
      return `Type "${value}${step.value && step.value.length > 30 ? '...' : ''}" into ${step.normalizedDescription || step.selector || 'field'}`;
    case 'select':
      return `Select "${step.selectedText || step.value || 'option'}" from ${step.normalizedDescription || step.selector || 'dropdown'}`;
    case 'check':
      return `Check ${step.normalizedDescription || step.selector || 'checkbox'}`;
    case 'uncheck':
      return `Uncheck ${step.normalizedDescription || step.selector || 'checkbox'}`;
    case 'hover':
      return `Hover over ${step.normalizedDescription || step.selector || 'element'}`;
    case 'assertText':
      return `Assert text "${step.expectedValue || step.text || ''}" in ${step.normalizedDescription || step.selector || 'element'}`;
    case 'assertVisible':
      return `Assert ${step.normalizedDescription || step.selector || 'element'} is visible`;
    case 'assertAttribute':
      return `Assert ${step.normalizedDescription || step.selector || 'element'} attribute "${step.value || ''}"`;
    case 'waitFor':
      return `Wait for ${step.ms || 500}ms`;
    case 'waitForSelector':
      return `Wait for ${step.normalizedDescription || step.selector || 'selector'}`;
    case 'screenshot':
      return `Take screenshot ${step.filename || ''}`;
    case 'close':
      return `Close browser`;
    case 'keyPress':
      return `Press key "${step.key || step.value || 'Enter'}"`;
    case 'scroll':
      if (step.selector) {
        return `Scroll to ${step.normalizedDescription || step.selector || 'element'}`;
      } else {
        return `Scroll page`;
      }
    default:
      return step.normalizedStepText || `${step.kind} action`;
  }
}

/**
 * Validate a step object
 * @param {Object} step - Step to validate
 * @returns {Object} { valid: boolean, error?: string }
 */
export function validateStep(step) {
  if (!step || typeof step !== 'object') {
    return { valid: false, error: 'Step must be an object' };
  }
  
  if (!step.kind || typeof step.kind !== 'string') {
    return { valid: false, error: 'Step must have a valid "kind" property' };
  }
  
  const kindsRequiringSelector = ['click', 'type', 'select', 'check', 'uncheck', 'hover', 'assertText', 'assertVisible', 'assertAttribute', 'waitForSelector'];
  // Scroll doesn't require selector (can scroll page without selector)
  if (kindsRequiringSelector.includes(step.kind) && step.kind !== 'scroll' && !step.selector) {
    return { valid: false, error: `Step kind "${step.kind}" requires a "selector" property` };
  }
  
  const kindsRequiringUrl = ['navigate'];
  if (kindsRequiringUrl.includes(step.kind) && !step.url) {
    return { valid: false, error: `Step kind "${step.kind}" requires a "url" property` };
  }
  
  return { valid: true };
}

/**
 * Get icon for a step kind
 * @param {string} kind - Step kind
 * @returns {string} Icon/emoji
 */
export function getStepIcon(kind) {
  const icons = {
    navigate: '🌐',
    click: '👆',
    doubleClick: '👆👆',
    type: '⌨️',
    select: '📋',
    check: '✅',
    uncheck: '☑️',
    hover: '🖱️',
    assertText: '🔍',
    assertVisible: '👁️',
    assertAttribute: '🏷️',
    waitFor: '⏳',
    waitForSelector: '⏱️',
    screenshot: '📸',
    close: '❌',
    keyPress: '⌨️',
    scroll: '📜'
  };
  return icons[kind] || '📝';
}

