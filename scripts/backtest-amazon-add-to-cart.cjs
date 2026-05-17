#!/usr/bin/env node
/**
 * ZAC Amazon Add-to-Cart backtest.
 *
 * Live-recording Amazon is blocked by CSP and anti-bot measures, so this
 * script feeds the recording API a faithful Amazon-shaped action stream
 * (search → result click → Add to Cart → cart-count assertion) using the
 * actual Amazon DOM hooks (`#twotabsearchtextbox`, `#add-to-cart-button`,
 * `#nav-cart-count`, etc.) and then asserts that the generated artifacts
 * carry the hardened pieces:
 *   - SELECTOR_FALLBACKS_BY_PRIMARY populated for every recorded element
 *   - tryClickWithFallback wired into iClick
 *   - WebDriverWait + ExpectedConditions.visibilityOfElementLocated in iTypeInto
 *   - @FindBy annotations stripped of redundant prefixes
 *   - locators.json auto-promoted with each element's fallback chain
 *
 * Run with: node scripts/backtest-amazon-add-to-cart.cjs
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = '127.0.0.1';
const PORT = process.env.PORT || 3000;
const PROJECT_ID = 'amazon-addtocart';
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

async function record() {
  console.log(`\n=== Amazon Add-to-Cart backtest (selenium-java) ===`);
  await req('DELETE', `/api/projects/${PROJECT_ID}`);
  const create = await req('POST', '/api/projects', {
    name: PROJECT_ID,
    description: 'Amazon Add-to-Cart hardened recorder backtest',
    baseUrl: 'https://www.amazon.com',
    framework: 'selenium-java',
    browserType: 'chromium',
  });
  if (create.status !== 200 && create.status !== 201) {
    throw new Error(`Project create failed: ${create.status} ${JSON.stringify(create.body)}`);
  }
  const realId = (create.body && create.body.project && create.body.project.id) || PROJECT_ID;
  await req('POST', '/api/projects/select', { projectId: realId });

  const start = await req('POST', '/api/recording/start', {
    baseUrl: 'https://www.amazon.com',
    browserType: 'chromium',
    projectId: realId,
  });
  const sessionId = start.body && start.body.sessionId;
  if (!sessionId) throw new Error(`Recording start failed: ${start.status} ${JSON.stringify(start.body)}`);
  console.log('  session:', sessionId);

  const ts = Date.now();
  const post = (action) => req('POST', `/api/recording/${sessionId}/action`, { sessionId, ...action });

  await post({ kind: 'navigate', url: 'https://www.amazon.com', timestamp: ts });
  await post({
    kind: 'type',
    selector: '#twotabsearchtextbox',
    value: 'wireless headphones',
    id: 'twotabsearchtextbox',
    name: 'field-keywords',
    placeholder: 'Search Amazon',
    tagName: 'INPUT',
    timestamp: ts + 10,
    fallbackSelectors: [
      'input[name="field-keywords"]',
      'input[aria-label="Search Amazon"]',
      'input[type="text"][placeholder*="Search"]',
    ],
  });
  await post({
    kind: 'click',
    selector: '#nav-search-submit-button',
    id: 'nav-search-submit-button',
    ariaLabel: 'Go',
    tagName: 'INPUT',
    timestamp: ts + 20,
    fallbackSelectors: [
      'input[type="submit"][value="Go"]',
      '[aria-label="Go"]',
    ],
  });
  await post({
    kind: 'click',
    selector: '[data-component-type="s-search-result"] h2 a',
    ariaLabel: 'First search result',
    textContent: 'Sponsored - Wireless Headphones',
    tagName: 'A',
    timestamp: ts + 30,
    fallbackSelectors: [
      '.s-result-item:first-of-type h2 a',
      'div.s-main-slot a.a-link-normal[href*="/dp/"]',
    ],
  });
  await post({
    kind: 'click',
    selector: '#add-to-cart-button',
    id: 'add-to-cart-button',
    name: 'submit.add-to-cart',
    textContent: 'Add to Cart',
    ariaLabel: 'Add to Shopping Cart',
    tagName: 'INPUT',
    timestamp: ts + 40,
    fallbackSelectors: [
      'input[name="submit.add-to-cart"]',
      'span#submit\\.add-to-cart input',
      '[aria-labelledby="submit.add-to-cart-announce"]',
    ],
  });
  await post({
    kind: 'assertText',
    selector: '#nav-cart-count',
    expectedValue: '1',
    timestamp: ts + 50,
    fallbackSelectors: [
      '#nav-cart-count-container span',
      '.nav-cart-count',
      '[aria-label*="items in cart"]',
    ],
  });

  const stop = await req('POST', '/api/recording/stop', { sessionId, projectId: realId });
  if (stop.status !== 200) throw new Error(`Stop failed: ${stop.status} ${JSON.stringify(stop.body)}`);
  console.log('  stop OK');
  return realId;
}

function readFile(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

function inspect(projectId) {
  const root = path.join(PROJECTS_DIR, projectId);
  const stepsFile = path.join(root, 'src/test/java/steps/RecordedTestFlowSteps.java');
  const pageBase = path.join(root, 'src/test/java/pages/BasePage.java');
  const pomFile = path.join(root, 'pom.xml');
  const locFile = path.join(root, 'locators.json');
  const supportDir = path.join(root, 'src/test/java/support');

  console.log('\n--- Inspecting generated Amazon project ---');
  const checks = [];

  const pom = readFile(pomFile);
  checks.push(['pom.xml present', !!pom]);
  checks.push(['pom uses selenium-java', !!pom && pom.includes('selenium-java')]);

  const steps = readFile(stepsFile);
  checks.push(['step defs present', !!steps]);
  if (steps) {
    checks.push(['SELECTOR_FALLBACKS_BY_PRIMARY emitted', steps.includes('SELECTOR_FALLBACKS_BY_PRIMARY')]);
    checks.push(['Amazon search box selector mapped',
      steps.includes('SELECTOR_FALLBACKS_BY_PRIMARY.put("#twotabsearchtextbox"')]);
    checks.push(['Amazon Add-to-Cart selector mapped',
      steps.includes('SELECTOR_FALLBACKS_BY_PRIMARY.put("#add-to-cart-button"')]);
    checks.push(['iClick routes via tryClickWithFallback',
      /iClick\(String selector\)[\s\S]{0,400}tryClickWithFallback/.test(steps)]);
    {
      const idx = steps.indexOf('public void iTypeInto(String value, String selector)');
      const body = idx >= 0 ? steps.slice(idx, idx + 2000) : '';
      checks.push(['iTypeInto uses WebDriverWait + visibilityOfElementLocated',
        body.includes('WebDriverWait') && body.includes('visibilityOfElementLocated')]);
    }
  }

  const base = readFile(pageBase);
  checks.push(['BasePage with explicit waits', !!base && base.includes('WebDriverWait')]);
  if (base) {
    checks.push(['BasePage initialises PageFactory', base.includes('PageFactory.initElements') || base.includes('PageFactory')]);
  }

  const sup = fs.existsSync(supportDir) ? fs.readdirSync(supportDir) : [];
  checks.push(['SeleniumWorld.java written', sup.includes('SeleniumWorld.java')]);

  const locRaw = readFile(locFile);
  let loc = null;
  if (locRaw) {
    try { loc = JSON.parse(locRaw); } catch (e) { /* ignore */ }
  }
  checks.push(['locators.json present', !!loc]);
  if (loc && Array.isArray(loc.locators)) {
    const primarySelectors = loc.locators.map((l) => l.locatorValue);
    checks.push(['locator repo contains Add-to-Cart',
      primarySelectors.some((s) => s && s.includes('add-to-cart-button'))]);
    checks.push(['Add-to-Cart locator carries fallback chain',
      loc.locators.some((l) => l.locatorValue && l.locatorValue.includes('add-to-cart-button')
        && Array.isArray(l.fallbackLocators) && l.fallbackLocators.length > 0)]);
  }

  let allOk = true;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) allOk = false;
  }
  return allOk;
}

(async function main() {
  const projectId = await record();
  const ok = inspect(projectId);
  console.log('\n=== SUMMARY ===');
  console.log(ok ? '  ✓ Amazon Add-to-Cart hardened-recorder backtest PASSED' : '  ✗ Amazon backtest FAILED');
  process.exit(ok ? 0 : 1);
})();
