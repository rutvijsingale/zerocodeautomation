#!/usr/bin/env node
/**
 * ZAC backtest: drives the recording API for each supported framework
 * (selenium-java, playwright-java, playwright-typescript) against the
 * local demo shop, then inspects the generated artifacts to confirm the
 * full record → generate → POM/Steps/Feature pipeline works.
 *
 * Run with: node scripts/backtest-all-frameworks.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = '127.0.0.1';
const PORT = process.env.PORT || 3000;
const PROJECTS_DIR = path.resolve(__dirname, '..', 'projects');

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      host: HOST,
      port: PORT,
      method,
      path: urlPath,
      headers: data
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        : {},
    };
    const r = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const txt = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(txt); } catch (e) { json = { raw: txt }; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function recordOnce({ projectId, framework }) {
  console.log(`\n=== Backtest: ${framework} → project ${projectId} ===`);
  await req('DELETE', `/api/projects/${projectId}`);
  const create = await req('POST', '/api/projects', {
    name: projectId,
    description: `ZAC backtest for ${framework}`,
    baseUrl: `http://localhost:${PORT}/demo/shop.html`,
    framework,
    browserType: 'chromium',
  });
  if (create.status !== 200 && create.status !== 201) {
    throw new Error(`Project create failed: ${create.status} ${JSON.stringify(create.body)}`);
  }
  const realId = (create.body && create.body.project && create.body.project.id) || projectId;
  if (realId !== projectId) {
    console.log(`  (project id normalized to "${realId}")`);
  }
  projectId = realId;
  await req('POST', '/api/projects/select', { projectId });

  const start = await req('POST', '/api/recording/start', {
    baseUrl: `http://localhost:${PORT}/demo/shop.html`,
    browserType: 'chromium',
    projectId,
  });
  const sessionId = start.body && start.body.sessionId;
  if (!sessionId) throw new Error(`Recording start failed: ${start.status} ${JSON.stringify(start.body)}`);
  console.log('  session:', sessionId);

  const ts = Date.now();
  const post = (action) => req('POST', `/api/recording/${sessionId}/action`, { sessionId, ...action });

  await post({ kind: 'navigate', url: `http://localhost:${PORT}/demo/shop.html`, timestamp: ts });
  await post({
    kind: 'type',
    selector: '#searchInput',
    value: 'Pixel',
    id: 'searchInput',
    placeholder: 'Search products',
    tagName: 'INPUT',
    timestamp: ts + 10,
    fallbackSelectors: ['[data-testid="search-input"]', 'input[aria-label="Search products"]'],
  });
  await post({
    kind: 'click',
    selector: '[data-testid="search-btn"]',
    id: 'searchBtn',
    textContent: 'Search',
    tagName: 'BUTTON',
    timestamp: ts + 20,
    fallbackSelectors: ['#searchBtn', 'button.primary'],
  });
  await post({
    kind: 'click',
    selector: '[data-testid="add-to-cart-p-101"]',
    id: 'add-p-101',
    ariaLabel: 'Add Pixel Phone 9 to cart',
    textContent: 'Add to Cart',
    tagName: 'BUTTON',
    timestamp: ts + 30,
    fallbackSelectors: ['#add-p-101', 'button[aria-label="Add Pixel Phone 9 to cart"]'],
  });
  await post({
    kind: 'assertText',
    selector: '[data-testid="cart-count"]',
    expectedValue: '1',
    timestamp: ts + 40,
    fallbackSelectors: ['#cartCount'],
  });

  const stop = await req('POST', '/api/recording/stop', { sessionId, projectId });
  if (stop.status !== 200) throw new Error(`Stop failed: ${stop.status} ${JSON.stringify(stop.body)}`);
  console.log('  stop OK');
  return projectId;
}

function checkFile(file, mustContain) {
  const exists = fs.existsSync(file);
  console.log(`  ${exists ? '✓' : '✗'} ${path.relative(PROJECTS_DIR, file)}`);
  if (!exists) return { ok: false, reason: 'missing' };
  const content = fs.readFileSync(file, 'utf8');
  for (const needle of mustContain || []) {
    if (!content.includes(needle)) {
      console.log(`      ✗ missing fragment: ${needle.slice(0, 80)}`);
      return { ok: false, reason: `missing fragment: ${needle.slice(0, 60)}` };
    }
  }
  return { ok: true };
}

function inspectJavaProject(projectId, framework) {
  const root = path.join(PROJECTS_DIR, projectId);
  const checks = [];
  checks.push(checkFile(
    path.join(root, 'pom.xml'),
    [framework === 'selenium-java' ? 'selenium-java' : 'com.microsoft.playwright']
  ));
  checks.push(checkFile(
    path.join(root, 'src/test/java/steps/RecordedTestFlowSteps.java'),
    framework === 'selenium-java'
      ? ['SELECTOR_FALLBACKS_BY_PRIMARY', 'tryClickWithFallback']
      : ['Page', 'fallback']
  ));
  const supportDir = path.join(root, 'src/test/java/support');
  if (fs.existsSync(supportDir)) {
    const expected = framework === 'selenium-java' ? 'SeleniumWorld.java' : 'PlaywrightWorld.java';
    const files = fs.readdirSync(supportDir);
    const ok = files.includes(expected);
    console.log(`  ${ok ? '✓' : '✗'} support/${expected} (found: ${files.join(', ')})`);
    if (!ok) checks.push({ ok: false, reason: 'wrong World class' });
  }
  const pageDir = path.join(root, 'src/test/java/pages');
  if (fs.existsSync(pageDir)) {
    const pages = fs.readdirSync(pageDir);
    console.log(`  pages/: ${pages.join(', ')}`);
    if (!pages.includes('BasePage.java')) checks.push({ ok: false, reason: 'BasePage.java missing' });
  } else {
    console.log('  ! pages/ directory not present');
  }
  const locatorsFile = path.join(root, 'locators.json');
  checks.push(checkFile(locatorsFile, []));
  return checks;
}

function inspectTSProject(projectId) {
  const root = path.join(PROJECTS_DIR, projectId);
  const checks = [];
  checks.push(checkFile(path.join(root, 'package.json'), ['playwright']));
  checks.push(checkFile(path.join(root, 'tests/recorded.spec.ts'), ['page.goto', 'page.click']));
  const stepsDir = path.join(root, 'steps');
  if (fs.existsSync(stepsDir)) {
    console.log(`  steps/: ${fs.readdirSync(stepsDir).join(', ')}`);
  } else {
    checks.push({ ok: false, reason: 'steps/ missing' });
  }
  const featureDir = path.join(root, 'features');
  if (fs.existsSync(featureDir)) {
    console.log(`  features/: ${fs.readdirSync(featureDir).join(', ')}`);
  } else {
    checks.push({ ok: false, reason: 'features/ missing' });
  }
  const pageDir = path.join(root, 'pages');
  if (fs.existsSync(pageDir)) {
    const pages = fs.readdirSync(pageDir);
    console.log(`  pages/: ${pages.join(', ')}`);
  } else {
    console.log('  ! pages/ directory not present (POM gen skipped for this framework)');
  }
  checks.push(checkFile(path.join(root, 'locators.json'), []));
  return checks;
}

(async function main() {
  const matrix = [
    { projectId: 'demoshop-se', framework: 'selenium-java' },
    { projectId: 'demoshop-pwj', framework: 'playwright-java' },
    { projectId: 'demoshop-pwts', framework: 'playwright-typescript' },
  ];

  const summary = [];
  for (const m of matrix) {
    try {
      const actualId = await recordOnce(m);
      m.projectId = actualId;
      const checks = m.framework === 'playwright-typescript'
        ? inspectTSProject(m.projectId)
        : inspectJavaProject(m.projectId, m.framework);
      const failed = checks.filter((c) => c && c.ok === false);
      summary.push({ ...m, ok: failed.length === 0, failed });
    } catch (err) {
      console.error(`  ! ${m.framework} backtest threw:`, err.message);
      summary.push({ ...m, ok: false, error: err.message });
    }
  }

  console.log('\n=== SUMMARY ===');
  for (const s of summary) {
    if (s.ok) {
      console.log(`  ✓ ${s.framework}`);
    } else {
      console.log(`  ✗ ${s.framework}`);
      if (s.error) console.log(`    error: ${s.error}`);
      if (s.failed) for (const f of s.failed) console.log(`    fail: ${f.reason}`);
    }
  }
  const allOk = summary.every((s) => s.ok);
  process.exit(allOk ? 0 : 1);
})();
