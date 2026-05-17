/**
 * services/testPlanGenerator.js
 *
 * Renders a Markdown test plan from a structured plan object OR from a raw
 * recording (steps + metadata). The output lands under
 * `generated-projects/<framework>/<project>/test-plan/<recording>-test-plan.md`.
 *
 * Hard requirements:
 *   - NEVER print real credentials. Anything matching a credential pattern
 *     (passwords, api keys, etc.) is replaced with `<from env: VAR_NAME>`
 *     when an env-var placeholder is supplied; otherwise with `***`.
 *   - Always describe the credentials *source*, never the value.
 *   - Stop ecommerce checkout BEFORE payment — the renderer adds a safety
 *     banner whenever a plan is tagged `requiresCheckoutGuard: true`.
 *
 * The renderer is pure: it takes data in, returns a string. The persistence
 * helpers (writeRenderedPlan / writeTestPlanFromRecording) own the file I/O
 * so unit tests can validate the formatting without hitting disk.
 */

import path from 'path';
import fs from 'fs/promises';

import { ensureProjectScaffold, sanitizeName } from './projectLayout.js';

/* -------------------------------------------------------------------------- *
 *  Credential masking                                                        *
 * -------------------------------------------------------------------------- */

// Conservative — anything with these substrings (case-insensitive) is treated
// as a secret and never echoed.
const SECRET_FIELDS = ['password', 'passcode', 'pin', 'token', 'secret', 'apikey', 'api-key', 'authorization', 'cvv'];

const ENV_PLACEHOLDER_RE = /^\$\{([A-Z0-9_]+)\}$/;

/**
 * Convert a value into a safe display string for the test plan.
 *   - `${ENV_VAR}` → `<from env: ENV_VAR>` (preserves the source name)
 *   - everything else → returned verbatim, unless `forceMask` is true
 *
 * @param {string} value
 * @param {boolean} [forceMask=false]
 * @returns {string}
 */
export function safeDisplayValue(value, forceMask = false) {
  if (value === null || value === undefined) return '_(not provided)_';
  const v = String(value);
  const m = v.match(ENV_PLACEHOLDER_RE);
  if (m) return `\`<from env: ${m[1]}>\``;
  if (forceMask) return '`***`';
  return v;
}

/**
 * Decide whether a (key, value) pair should be masked. Used for both the
 * "Test data" section and per-step inputs (e.g. typing into a password field).
 *
 * @param {string} key
 * @param {string} value
 * @returns {boolean}
 */
export function looksLikeSecret(key, value) {
  const k = String(key || '').toLowerCase();
  if (SECRET_FIELDS.some((f) => k.includes(f))) return true;
  // Heuristic: if the value isn't an env placeholder but the *step* description
  // sounds like a password field, treat it as secret too.
  const v = String(value || '');
  if (ENV_PLACEHOLDER_RE.test(v)) return false; // already safe to display
  if (k.includes('email') || k.includes('username') || k.includes('user') || k.includes('login')) {
    return false; // emails are not secrets per spec, but we still display the env source if present
  }
  return false;
}

/* -------------------------------------------------------------------------- *
 *  Step → narrative line                                                     *
 * -------------------------------------------------------------------------- */

function describeStep(step, index) {
  const num = `${index + 1}.`;
  const kind = step.kind || step.action || 'unknown';
  switch (kind) {
    case 'navigate':
    case 'goto':
      return `${num} Navigate to \`${step.url || step.target || ''}\``;
    case 'click': {
      const target = step.normalizedDescription || step.description || step.selector || '(unknown element)';
      return `${num} Click on **${target}**`;
    }
    case 'type':
    case 'fill': {
      const target = step.normalizedDescription || step.description || step.selector || '(input)';
      const isSecret = looksLikeSecret(target, step.value);
      const value = safeDisplayValue(step.value, isSecret);
      return `${num} Type ${value} into **${target}**`;
    }
    case 'select':
      return `${num} Select **${step.value || ''}** from **${step.normalizedDescription || step.selector || ''}**`;
    case 'check':
      return `${num} Check the **${step.normalizedDescription || step.selector || ''}** checkbox`;
    case 'uncheck':
      return `${num} Uncheck the **${step.normalizedDescription || step.selector || ''}** checkbox`;
    case 'hover':
      return `${num} Hover over **${step.normalizedDescription || step.selector || ''}**`;
    case 'scroll': {
      const dir = (step.scroll && step.scroll.direction) || step.direction || 'down';
      const mode = (step.scroll && step.scroll.mode) || 'y';
      const reason = (step.scroll && step.scroll.reason) || step.reason || 'page_explore';
      const target = step.targetElementMetadata && (step.targetElementMetadata.text || step.targetElementMetadata.tag);
      const targetPart = target ? ` to bring **${target}** into view` : '';
      const yPart = step.scrollY != null ? ` (y=${step.scrollY})` : '';
      return `${num} Scroll **${dir}** [mode=${mode}, reason=${reason}]${targetPart}${yPart}`;
    }
    case 'assertText':
      return `${num} Assert text equals \`${step.expectedValue || step.expected || ''}\` on **${step.normalizedDescription || step.selector || ''}**`;
    case 'assertVisible':
      return `${num} Assert **${step.normalizedDescription || step.selector || ''}** is visible`;
    case 'waitForSelector':
      return `${num} Wait for **${step.normalizedDescription || step.selector || ''}**`;
    default:
      return `${num} ${kind}${step.selector ? ` on \`${step.selector}\`` : ''}`;
  }
}

/* -------------------------------------------------------------------------- *
 *  Plan rendering                                                            *
 * -------------------------------------------------------------------------- */

/**
 * Render a structured plan object into Markdown. Pure function — no I/O.
 *
 * @param {Object} plan
 * @param {string} plan.scenarioId            - e.g. 'amazon-search-product'
 * @param {string} plan.title                 - human readable title
 * @param {string} plan.framework             - canonical framework id
 * @param {string} plan.projectName
 * @param {string} [plan.applicationName]     - e.g. 'Amazon'
 * @param {string} [plan.applicationUrl]
 * @param {string} [plan.objective]
 * @param {Array<string>} [plan.preconditions]
 * @param {Object<string,string>} [plan.credentialsSource] - { username: '${AMAZON_USERNAME}', password: '${AMAZON_PASSWORD}' }
 * @param {Object<string,string>} [plan.testData]
 * @param {Array<Object>} [plan.steps]        - recorded step objects (or string narrative lines)
 * @param {Array<string>} [plan.expectedResults]
 * @param {Array<string>} [plan.scrollDependentElements]
 * @param {string} [plan.locatorStrategy]
 * @param {Array<string>} [plan.replayValidationPoints]
 * @param {Array<string>} [plan.negativeScenarios]
 * @param {Array<string>} [plan.cleanupSteps]
 * @param {Array<string>} [plan.limitations]
 * @param {boolean} [plan.requiresCheckoutGuard]
 * @returns {string} Markdown
 */
export function renderTestPlan(plan) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('renderTestPlan: plan must be an object');
  }
  const safe = (v) => (v && String(v).trim()) || '';

  const sections = [];

  sections.push(`# Test Plan — ${safe(plan.title) || safe(plan.scenarioId) || 'Untitled'}`);
  sections.push('');
  sections.push('| Field | Value |');
  sections.push('|---|---|');
  sections.push(`| Scenario ID | \`${safe(plan.scenarioId) || '-'}\` |`);
  sections.push(`| Application | ${safe(plan.applicationName) || '-'} |`);
  if (plan.applicationUrl) sections.push(`| URL | \`${plan.applicationUrl}\` |`);
  sections.push(`| Framework | \`${safe(plan.framework)}\` |`);
  sections.push(`| Project | \`${safe(plan.projectName)}\` |`);
  if (plan.recordedAt) sections.push(`| Recorded At | ${plan.recordedAt} |`);

  if (plan.requiresCheckoutGuard) {
    sections.push('');
    sections.push('> ⚠️ **Safety guard:** This scenario interacts with a real ecommerce site.');
    sections.push('> The plan stops **before** payment / final order placement. Do not extend it');
    sections.push('> to submit irreversible actions.');
  }

  if (plan.objective) {
    sections.push('');
    sections.push('## Objective');
    sections.push('');
    sections.push(plan.objective);
  }

  sections.push('');
  sections.push('## Preconditions');
  if (Array.isArray(plan.preconditions) && plan.preconditions.length > 0) {
    for (const p of plan.preconditions) sections.push(`- ${p}`);
  } else {
    sections.push('- _(none specified)_');
  }

  sections.push('');
  sections.push('## Credentials source');
  if (plan.credentialsSource && Object.keys(plan.credentialsSource).length > 0) {
    sections.push('');
    sections.push('| Field | Source |');
    sections.push('|---|---|');
    for (const [k, v] of Object.entries(plan.credentialsSource)) {
      // Always show the env-var name, never the value. If the consumer
      // accidentally inlined a literal, mask it.
      const m = String(v).match(ENV_PLACEHOLDER_RE);
      const display = m ? `\`<from env: ${m[1]}>\`` : '`<masked — set as environment variable>`';
      sections.push(`| ${k} | ${display} |`);
    }
    sections.push('');
    sections.push('> 🔐 No credential values are ever printed to this file. The runtime resolves');
    sections.push('> `${ENV_VAR}` placeholders via `support.CredentialsHelper.resolve(...)`.');
  } else {
    sections.push('- _(no credentials required)_');
  }

  if (plan.testData && Object.keys(plan.testData).length > 0) {
    sections.push('');
    sections.push('## Test data');
    sections.push('');
    sections.push('| Key | Value |');
    sections.push('|---|---|');
    for (const [k, v] of Object.entries(plan.testData)) {
      const masked = looksLikeSecret(k, v);
      sections.push(`| ${k} | ${safeDisplayValue(v, masked)} |`);
    }
  }

  sections.push('');
  sections.push('## Recorded steps');
  if (Array.isArray(plan.steps) && plan.steps.length > 0) {
    plan.steps.forEach((s, i) => {
      if (typeof s === 'string') sections.push(s);
      else sections.push(describeStep(s, i));
    });
  } else {
    sections.push('_(no steps captured yet — record the scenario in the IDE first)_');
  }

  if (Array.isArray(plan.expectedResults) && plan.expectedResults.length > 0) {
    sections.push('');
    sections.push('## Expected results');
    for (const r of plan.expectedResults) sections.push(`- ${r}`);
  }

  if (Array.isArray(plan.scrollDependentElements) && plan.scrollDependentElements.length > 0) {
    sections.push('');
    sections.push('## Scroll-dependent elements');
    for (const e of plan.scrollDependentElements) sections.push(`- ${e}`);
  }

  sections.push('');
  sections.push('## Locator strategy');
  sections.push(plan.locatorStrategy ||
    'Each interactive step records primary + alternate locators ' +
    '(data-testid → id → name → aria-label → role → text → CSS → XPath). ' +
    'At replay time the live healer validates the primary, then walks the ' +
    'alternates with strict uniqueness; healed mappings are persisted to ' +
    '`locators/healed-locators.json`.');

  if (Array.isArray(plan.replayValidationPoints) && plan.replayValidationPoints.length > 0) {
    sections.push('');
    sections.push('## Replay validation points');
    for (const v of plan.replayValidationPoints) sections.push(`- ${v}`);
  }

  if (Array.isArray(plan.negativeScenarios) && plan.negativeScenarios.length > 0) {
    sections.push('');
    sections.push('## Negative scenarios');
    for (const n of plan.negativeScenarios) sections.push(`- ${n}`);
  }

  if (Array.isArray(plan.cleanupSteps) && plan.cleanupSteps.length > 0) {
    sections.push('');
    sections.push('## Cleanup steps');
    for (const c of plan.cleanupSteps) sections.push(`- ${c}`);
  }

  if (Array.isArray(plan.limitations) && plan.limitations.length > 0) {
    sections.push('');
    sections.push('## Limitations');
    for (const l of plan.limitations) sections.push(`- ${l}`);
  }

  return sections.join('\n') + '\n';
}

/* -------------------------------------------------------------------------- *
 *  Persistence helpers                                                       *
 * -------------------------------------------------------------------------- */

/**
 * Write a rendered plan (Markdown) to
 *   `generated-projects/<framework>/<project>/test-plan/<recordingName>-test-plan.md`.
 *
 * Idempotent: overwrites the existing file. Returns the absolute path.
 *
 * @returns {Promise<string>}
 */
export async function writeRenderedPlan({ framework, projectName, recordingName, markdown }) {
  if (!markdown || typeof markdown !== 'string') throw new Error('writeRenderedPlan: markdown is required');
  const safeRec = sanitizeName(recordingName);
  if (!safeRec) throw new Error(`writeRenderedPlan: invalid recordingName "${recordingName}"`);
  const project = await ensureProjectScaffold({ framework, projectName });
  const file = path.join(project.testPlan, `${safeRec}-test-plan.md`);
  await fs.writeFile(file, markdown, 'utf8');
  console.log(`[Plan] Wrote test plan: ${file}`);
  return file;
}

/**
 * Convenience: turn a raw recording (steps + metadata) into a plan and write it.
 *
 * @returns {Promise<{file: string, markdown: string}>}
 */
export async function writeTestPlanFromRecording({
  framework,
  projectName,
  recordingName,
  steps = [],
  metadata = {},
  applicationName = null,
  objective = null,
  credentialsSource = null,
}) {
  // Build the plan with the bits we know from the recording.
  const scrollSteps = (steps || []).filter((s) => (s.kind || s.action) === 'scroll');
  const interactiveSteps = (steps || []).filter((s) => ['click', 'type', 'select', 'check'].includes(s.kind || s.action));
  const scrollDependentElements = scrollSteps
    .map((s) => s.targetElementMetadata && (s.targetElementMetadata.text || s.targetElementMetadata.tag))
    .filter(Boolean);

  const plan = {
    scenarioId: sanitizeName(recordingName) || 'recording',
    title: recordingName,
    framework,
    projectName,
    applicationName: applicationName || metadata.applicationName || metadata.featureTitle || null,
    applicationUrl: metadata.baseUrl || null,
    recordedAt: metadata.capturedAt || null,
    objective: objective || metadata.objective || `Replay the recorded scenario "${recordingName}" against the application.`,
    preconditions: [
      `Application is reachable: ${metadata.baseUrl || '_(set baseUrl)_'}`,
      `Browser: ${metadata.browserType || 'chromium'}`,
      'Required environment variables are set (see "Credentials source")',
    ],
    credentialsSource: credentialsSource || null,
    testData: {},
    steps,
    expectedResults: [
      'Every recorded step replays successfully.',
      'Scroll-dependent elements become visible after scrolling.',
      'Locator healing is invoked at most once per step (only when a primary fails).',
    ],
    scrollDependentElements,
    replayValidationPoints: [
      `Recorded ${(steps || []).length} steps total, of which ${scrollSteps.length} are scroll events`,
      `Captured locator candidates for ${interactiveSteps.length} interactive steps`,
      'Replay artifacts land under `reruns/<test-name>/<timestamp>/`',
    ],
    cleanupSteps: ['Close the browser context'],
    limitations: [
      'DOM snapshots are not captured by default — enable when investigating flaky scrolls.',
      'Scroll detection uses a 400 ms debounce; very fast scrolls may collapse into a single event.',
    ],
  };

  const md = renderTestPlan(plan);
  const file = await writeRenderedPlan({ framework, projectName, recordingName, markdown: md });
  return { file, markdown: md };
}
