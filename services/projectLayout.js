/**
 * services/projectLayout.js
 *
 * Framework-aware project layout module.
 *
 * Responsibilities:
 *   1. Provide a single registry of supported frameworks (sourced from
 *      config/frameworks.json — discovered from existing generators, NOT
 *      hand-invented).
 *   2. Build canonical paths under
 *        generated-projects/<framework-id>/<project-name>/
 *      for tests, pages, locators, data, config, utils, recordings,
 *      reruns, reports, screenshots, videos, logs.
 *   3. Sanitize all user-supplied names so we can't write outside the
 *      generated-projects root.
 *   4. Scaffold the directory tree on demand, idempotently.
 *   5. Generate / refresh a per-project README.md describing the layout
 *      and how to run the tests.
 *
 * Non-goals:
 *   - This module does NOT replace projectService. The canonical home for
 *     a project's source-of-truth `project.json`, `locators.json`, generated
 *     `pom.xml`, `src/test/java/...` etc. remains projects/<id>/. The
 *     generated-projects/ tree is a framework-organized *output bucket*
 *     where recording artifacts and rerun artifacts are persisted in a
 *     consistent shape, and where generated test code is mirrored so QA
 *     can navigate one tree per framework.
 */

import fs from 'fs/promises';
import path from 'path';
import url from 'url';

/* -------------------------------------------------------------------------- *
 *  Constants                                                                 *
 * -------------------------------------------------------------------------- */

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REGISTRY_PATH = path.resolve(__dirname, '..', 'config', 'frameworks.json');
const GENERATED_ROOT = 'generated-projects';

// Generic spec-mandated subdirs. Created for every framework so the layout
// stays consistent regardless of language / runner. `test-plan/` joins the
// list because every recording emits a Markdown plan there.
const GENERIC_SUBDIRS = [
  'tests',
  'pages',
  'locators',
  'data',
  'config',
  'utils',
  'recordings',
  'reruns',
  'reports',
  'screenshots',
  'videos',
  'logs',
  'test-plan',
];

/* -------------------------------------------------------------------------- *
 *  Registry                                                                  *
 * -------------------------------------------------------------------------- */

let registryCache = null;

async function loadRegistry() {
  if (registryCache) return registryCache;
  const raw = await fs.readFile(REGISTRY_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.frameworks)) {
    throw new Error('config/frameworks.json is malformed — missing frameworks[]');
  }
  registryCache = parsed;
  return parsed;
}

// Mostly for tests: drop the in-memory registry cache.
export function _resetRegistryCache() {
  registryCache = null;
}

/**
 * Return the canonical list of supported frameworks.
 * Pure data — UI dropdowns, validation, and tests can all rely on it.
 *
 * @returns {Promise<Array<{id:string,label:string,language:string,runner:object,conventions:object,uiVisible:boolean,aliases:string[]}>>}
 */
export async function listFrameworks() {
  const reg = await loadRegistry();
  return reg.frameworks.map((f) => ({
    id: f.id,
    label: f.label,
    language: f.language,
    runner: f.runner,
    conventions: f.conventions || {},
    uiVisible: f.uiVisible !== false,
    aliases: Array.isArray(f.aliases) ? f.aliases : [],
  }));
}

/**
 * Resolve any framework id (or known alias) to the canonical id.
 * Returns null when not supported.
 *
 * @param {string} id
 * @returns {Promise<string|null>}
 */
export async function normalizeFrameworkId(id) {
  if (!id || typeof id !== 'string') return null;
  const reg = await loadRegistry();
  const lc = id.trim().toLowerCase();
  for (const f of reg.frameworks) {
    if (f.id === lc) return f.id;
    if (Array.isArray(f.aliases) && f.aliases.map((a) => a.toLowerCase()).includes(lc)) {
      return f.id;
    }
  }
  return null;
}

/**
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function isFrameworkSupported(id) {
  return (await normalizeFrameworkId(id)) !== null;
}

/**
 * Look up the full framework definition for a given id (canonical or alias).
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getFrameworkDefinition(id) {
  const canonical = await normalizeFrameworkId(id);
  if (!canonical) return null;
  const all = await listFrameworks();
  return all.find((f) => f.id === canonical) || null;
}

/* -------------------------------------------------------------------------- *
 *  Sanitization                                                              *
 * -------------------------------------------------------------------------- */

/**
 * Sanitize a user-supplied name so it's safe to use as a single path segment.
 * Rules:
 *   - lowercase
 *   - replace anything outside [a-z0-9-_] with '-'
 *   - collapse repeats of '-'
 *   - trim leading/trailing '-' and '_'
 *   - cap length at 64 to keep paths sane on Windows (260 char limit)
 *   - reject reserved names ('.', '..', '') — caller must handle null
 *
 * @param {string} name
 * @returns {string|null}
 */
export function sanitizeName(name) {
  if (typeof name !== 'string') return null;
  let s = name.trim().toLowerCase();
  if (!s) return null;
  // Replace path separators and unsafe chars.
  s = s.replace(/[^a-z0-9_\-.]+/g, '-');
  s = s.replace(/-+/g, '-');
  s = s.replace(/^[-_.]+|[-_.]+$/g, '');
  if (!s || s === '.' || s === '..') return null;
  if (s.length > 64) s = s.slice(0, 64);
  return s;
}

/**
 * Build a timestamp slug suitable for a folder name (UTC, sortable).
 * Example: 2026-04-26T173049-621Z
 *
 * @param {Date} [date]
 * @returns {string}
 */
export function timestampSlug(date) {
  const d = date || new Date();
  const iso = d.toISOString(); // 2026-04-26T17:30:49.621Z
  return iso.replace(/[:]/g, '').replace(/\./g, '-');
}

/* -------------------------------------------------------------------------- *
 *  Path builders                                                             *
 * -------------------------------------------------------------------------- */

/**
 * @param {Object} args
 * @param {string} args.framework  - framework id (or alias)
 * @param {string} args.projectName
 * @returns {Promise<{
 *   framework: string,
 *   projectName: string,
 *   root: string,
 *   tests: string, pages: string, locators: string, data: string,
 *   config: string, utils: string, recordings: string, reruns: string,
 *   reports: string, screenshots: string, videos: string, logs: string,
 *   readme: string,
 *   conventions: object
 * }>}
 */
export async function getProjectPaths({ framework, projectName }) {
  const def = await getFrameworkDefinition(framework);
  if (!def) {
    throw new Error(`Unsupported framework: ${framework}. ` +
      `Supported: ${(await listFrameworks()).map((f) => f.id).join(', ')}`);
  }
  const safeProject = sanitizeName(projectName);
  if (!safeProject) {
    throw new Error(`Invalid project name: "${projectName}"`);
  }

  const root = path.resolve(GENERATED_ROOT, def.id, safeProject);
  const out = {
    framework: def.id,
    projectName: safeProject,
    root,
    readme: path.join(root, 'README.md'),
    conventions: def.conventions || {},
  };
  for (const sub of GENERIC_SUBDIRS) {
    const dir = path.join(root, sub);
    // Expose the path under both the on-disk kebab name AND a camelCase
    // alias so callers can write either `paths['test-plan']` or
    // `paths.testPlan` — old loops keep working, new code stays idiomatic.
    out[sub] = dir;
    const camel = sub.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (camel !== sub) out[camel] = dir;
  }
  // Locator file leaves — referenced by recording stop and the healer service.
  out.originalLocators = path.join(out.locators, 'original-locators.json');
  out.healedLocators = path.join(out.locators, 'healed-locators.json');
  return out;
}

/**
 * Recording artifact paths under recordings/<recording-name-or-timestamp>/.
 *
 * @param {Object} args
 * @param {string} args.framework
 * @param {string} args.projectName
 * @param {string} [args.recordingName] - if omitted, timestamp slug used
 * @returns {Promise<{
 *   recordingDir: string, recordedSteps: string, metadata: string,
 *   screenshots: string, logs: string, recordingName: string
 * }>}
 */
export async function getRecordingPaths({ framework, projectName, recordingName }) {
  const project = await getProjectPaths({ framework, projectName });
  const safe = recordingName ? sanitizeName(recordingName) : null;
  const folder = safe || timestampSlug();
  const recordingDir = path.join(project.recordings, folder);
  return {
    recordingName: folder,
    recordingDir,
    recordedSteps: path.join(recordingDir, 'recorded-steps.json'),
    scrollEvents: path.join(recordingDir, 'scroll-events.json'),
    elementLocators: path.join(recordingDir, 'element-locators.json'),
    metadata: path.join(recordingDir, 'metadata.json'),
    screenshots: path.join(recordingDir, 'screenshots'),
    domSnapshots: path.join(recordingDir, 'dom-snapshots'),
    logs: path.join(recordingDir, 'logs'),
  };
}

/**
 * Rerun artifact paths under reruns/<test-name>/<timestamp>/.
 *
 * @param {Object} args
 * @param {string} args.framework
 * @param {string} args.projectName
 * @param {string} args.testName
 * @param {string|Date} [args.timestamp]
 * @returns {Promise<{
 *   rerunDir: string, report: string, screenshots: string,
 *   videos: string, traces: string, logs: string,
 *   testName: string, timestamp: string
 * }>}
 */
export async function getRerunPaths({ framework, projectName, testName, timestamp }) {
  if (!testName) throw new Error('getRerunPaths: testName is required');
  const project = await getProjectPaths({ framework, projectName });
  const safeTest = sanitizeName(testName);
  if (!safeTest) throw new Error(`Invalid testName: "${testName}"`);
  const tsSlug = typeof timestamp === 'string' ? timestamp : timestampSlug(timestamp instanceof Date ? timestamp : undefined);
  const rerunDir = path.join(project.reruns, safeTest, tsSlug);
  return {
    testName: safeTest,
    timestamp: tsSlug,
    rerunDir,
    report: path.join(rerunDir, 'report'),
    replayResult: path.join(rerunDir, 'replay-result.json'),
    screenshots: path.join(rerunDir, 'screenshots'),
    videos: path.join(rerunDir, 'videos'),
    traces: path.join(rerunDir, 'traces'),
    logs: path.join(rerunDir, 'logs'),
  };
}

/* -------------------------------------------------------------------------- *
 *  Scaffolding                                                               *
 * -------------------------------------------------------------------------- */

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

/**
 * Create the project folder skeleton on disk. Idempotent.
 *
 * @param {Object} args
 * @param {string} args.framework
 * @param {string} args.projectName
 * @param {boolean} [args.writeReadme=true]
 * @returns {Promise<ReturnType<typeof getProjectPaths>>}
 */
export async function ensureProjectScaffold({ framework, projectName, writeReadme = true }) {
  const paths = await getProjectPaths({ framework, projectName });
  await ensureDir(paths.root);
  for (const sub of GENERIC_SUBDIRS) await ensureDir(paths[sub]);

  // Framework-specific skeletons (Java needs Maven layout to actually compile).
  const conv = paths.conventions || {};
  if (conv.testDir) await ensureDir(path.join(paths.root, conv.testDir));
  if (conv.mainDir) await ensureDir(path.join(paths.root, conv.mainDir));
  if (conv.resourcesDir) await ensureDir(path.join(paths.root, conv.resourcesDir));
  if (conv.stepsDir) await ensureDir(path.join(paths.root, conv.stepsDir));
  if (conv.featuresDir) await ensureDir(path.join(paths.root, conv.featuresDir));
  if (conv.pagesDir) await ensureDir(path.join(paths.root, conv.pagesDir));

  if (writeReadme) await writeProjectReadme(paths);
  return paths;
}

/**
 * Pre-create the directory tree for a recording. Returns the same shape as
 * getRecordingPaths so callers can write directly to recordedSteps/metadata.
 */
export async function ensureRecordingScaffold({ framework, projectName, recordingName }) {
  const project = await ensureProjectScaffold({ framework, projectName });
  const paths = await getRecordingPaths({ framework, projectName, recordingName });
  await ensureDir(paths.recordingDir);
  await ensureDir(paths.screenshots);
  await ensureDir(paths.domSnapshots);
  await ensureDir(paths.logs);
  return { project, ...paths };
}

/**
 * Pre-create the directory tree for a rerun. Returns the same shape as
 * getRerunPaths so callers can write directly to report/etc.
 */
export async function ensureRerunScaffold({ framework, projectName, testName, timestamp }) {
  const project = await ensureProjectScaffold({ framework, projectName });
  const paths = await getRerunPaths({ framework, projectName, testName, timestamp });
  await ensureDir(paths.rerunDir);
  await ensureDir(paths.report);
  await ensureDir(paths.screenshots);
  await ensureDir(paths.videos);
  await ensureDir(paths.traces);
  await ensureDir(paths.logs);
  return { project, ...paths };
}

/* -------------------------------------------------------------------------- *
 *  README                                                                    *
 * -------------------------------------------------------------------------- */

/**
 * Render the project README with the resolved framework conventions.
 * Returns the markdown so callers can write to disk OR display it.
 */
export function renderProjectReadme(paths) {
  const conv = paths.conventions || {};
  const runner = conv.runner ? `\`${conv.runner}\`` : 'see framework docs';
  const cfgList = (conv.configFiles || [])
    .map((c) => `- \`${c}\``)
    .join('\n') || '_(no framework-specific config files)_';

  return `# ${paths.projectName}

Generated by ZeroAutomationCode (ZAC).

| Property              | Value                                |
|-----------------------|--------------------------------------|
| Project name          | \`${paths.projectName}\`             |
| Framework             | \`${paths.framework}\`               |

## Folder layout

\`\`\`
${paths.framework}/${paths.projectName}/
├── tests/                  # generated test files (mirrors framework's testDir)
├── pages/                  # page object models
├── locators/               # locator JSON / pageobject locators
├── data/                   # test data fixtures
├── config/                 # environment / runner config
├── utils/                  # helpers shared across tests
├── recordings/             # raw recording artifacts
│   └── <recording-name>/
│       ├── recorded-steps.json
│       ├── scroll-events.json
│       ├── element-locators.json
│       ├── metadata.json
│       ├── screenshots/
│       ├── dom-snapshots/
│       └── logs/
├── test-plan/              # one Markdown test plan per recording / scenario
├── reruns/                 # rerun output, never overwritten
│   └── <test-name>/
│       └── <timestamp>/
│           ├── report/
│           ├── replay-result.json
│           ├── screenshots/
│           ├── videos/
│           ├── traces/
│           └── logs/
├── reports/                # aggregated reports
├── screenshots/            # screenshots not tied to a single rerun
├── videos/                 # videos not tied to a single rerun
├── logs/                   # framework-level logs
└── README.md               # this file
\`\`\`

## Framework conventions

${conv.testDir ? `- Test code lives in \`${conv.testDir}\`` : ''}
${conv.mainDir ? `\n- Main code lives in \`${conv.mainDir}\`` : ''}
${conv.resourcesDir ? `\n- Test resources live in \`${conv.resourcesDir}\`` : ''}
${conv.stepsDir ? `\n- Step definitions live in \`${conv.stepsDir}\`` : ''}
${conv.featuresDir ? `\n- Feature files live in \`${conv.featuresDir}\`` : ''}
${conv.pagesDir ? `\n- Page objects live in \`${conv.pagesDir}\`` : ''}

### Framework-specific config files

${cfgList}

## Running the tests

\`\`\`bash
cd "${path.relative(process.cwd(), paths.root) || '.'}"
${runner === 'see framework docs' ? '# see framework docs' : runner.replace(/`/g, '')}
\`\`\`

## Where things live

| Artifact            | Location                                                |
|---------------------|---------------------------------------------------------|
| Recorded steps      | \`recordings/<recording>/recorded-steps.json\`          |
| Scroll events       | \`recordings/<recording>/scroll-events.json\`           |
| Element locators    | \`recordings/<recording>/element-locators.json\`        |
| Recording metadata  | \`recordings/<recording>/metadata.json\`                |
| Recording screenshots | \`recordings/<recording>/screenshots/\`              |
| DOM snapshots       | \`recordings/<recording>/dom-snapshots/\`               |
| Recording logs      | \`recordings/<recording>/logs/\`                        |
| Test plans          | \`test-plan/<recording>-test-plan.md\`                  |
| Original locators   | \`locators/original-locators.json\`                     |
| Healed locators     | \`locators/healed-locators.json\`                       |
| Rerun reports       | \`reruns/<test-name>/<timestamp>/report/\`              |
| Rerun replay JSON   | \`reruns/<test-name>/<timestamp>/replay-result.json\`   |
| Rerun screenshots   | \`reruns/<test-name>/<timestamp>/screenshots/\`         |
| Rerun videos        | \`reruns/<test-name>/<timestamp>/videos/\`              |
| Rerun traces        | \`reruns/<test-name>/<timestamp>/traces/\`              |
| Rerun logs          | \`reruns/<test-name>/<timestamp>/logs/\`                |
| Aggregated reports  | \`reports/\`                                            |
`;
}

async function writeProjectReadme(paths) {
  // Re-resolve the runner for the README from the registry definition so the
  // README always matches the canonical value (paths.conventions.runner is
  // the conventions block, doesn't include the runner.command).
  const def = await getFrameworkDefinition(paths.framework);
  const conventions = {
    ...(paths.conventions || {}),
    runner: def && def.runner ? def.runner.command : null,
    configFiles: (paths.conventions || {}).configFiles || [],
  };
  const md = renderProjectReadme({ ...paths, conventions });
  await fs.writeFile(paths.readme, md, 'utf8');
}

/* -------------------------------------------------------------------------- *
 *  Validation helper                                                         *
 * -------------------------------------------------------------------------- */

/**
 * Validate the inputs for any layout-producing operation. Returns
 * `{ ok: true, framework, projectName }` when valid, or
 * `{ ok: false, status, error }` with a clear message and HTTP status hint.
 *
 * @param {Object} input
 * @returns {Promise<{ok:true,framework:string,projectName:string}|{ok:false,status:number,error:string}>}
 */
export async function validateLayoutInputs(input) {
  const { framework, projectName } = input || {};
  if (!framework) {
    return { ok: false, status: 400, error: 'No framework provided' };
  }
  const canonical = await normalizeFrameworkId(framework);
  if (!canonical) {
    const supported = (await listFrameworks()).map((f) => f.id).join(', ');
    return { ok: false, status: 400, error: `Unsupported framework "${framework}". Supported: ${supported}` };
  }
  if (!projectName || typeof projectName !== 'string') {
    return { ok: false, status: 400, error: 'projectName is required' };
  }
  const safe = sanitizeName(projectName);
  if (!safe) {
    return { ok: false, status: 400, error: `Invalid projectName: "${projectName}"` };
  }
  return { ok: true, framework: canonical, projectName: safe };
}

export const __test__ = {
  GENERIC_SUBDIRS,
  GENERATED_ROOT,
  REGISTRY_PATH,
};
