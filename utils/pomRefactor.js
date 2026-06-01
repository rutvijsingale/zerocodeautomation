/**
 * POM Refactor — split a flat ZAC project into Page Object Model classes.
 *
 * The runtime recording engine emits scenarios as a flat sequence of
 * step actions. ZAC's default code generator preserves that flat shape
 * (one big *Steps.java with every binding inline). For enterprise QA
 * we want to fan that out into per-page classes:
 *
 *   src/main/java/pages/LoginPage.java
 *   src/main/java/pages/InventoryPage.java
 *   src/main/java/pages/CartSummaryPage.java
 *   …
 *   config/.env.qa     ← per-env baseUrl + env metadata
 *   config/.env.stage
 *   config/.env.dev
 *
 * This module is a pure transformation:
 *   in:   project.json + project dir
 *   out:  { pages: [{name, framework, code}], envs: [{name, file, body}] }
 *
 * The CLI wrapper (`scripts/zac-pom-refactor.mjs`) writes those files to
 * disk; the function itself stays side-effect-free so it's testable.
 *
 * Heuristics:
 *
 * 1. Page-boundary detection — within each scenario:
 *      - A `navigate` step starts a new "segment".
 *      - Each segment is owned by exactly one Page class.
 *      - Page name comes from (in order):
 *          a. an `@<Foo>Page` tag on the scenario, picked in
 *             positional order (1st nav segment → 1st @Page tag, etc.)
 *          b. derived from the navigate URL pathname (e.g. /inventory →
 *             InventoryPage, / → LoginPage).
 *
 * 2. Selector dedupe — within a page, each unique selector becomes one
 *    @FindBy field. Field name is derived from the selector:
 *      #user-name        → userName
 *      .shopping_cart_badge → shoppingCartBadge
 *      button:has-text("X") → buttonX
 *
 * 3. Action methods — for each step that touches a selector, emit a
 *    method on the page class:
 *      fill('#user-name', 'foo')   → public void typeUserName(String v)
 *      click('#login-button')      → public void clickLoginButton()
 *      assertVisible('.list')      → public void assertListVisible()
 *
 * 4. Multi-env — read the project's `environments` array if present;
 *    otherwise derive from the unique URL origins seen across all
 *    scenarios.
 */

/**
 * @param {Object} project   loaded project.json
 * @param {Object} opts
 * @param {('playwright-java'|'selenium-java'|'playwright-javascript')} opts.framework
 * @returns {{ pages: Array<{name:string, framework:string, code:string, relPath:string}>,
 *            envs: Array<{name:string, file:string, body:string}>,
 *            stepsImports: string,                   // additional imports the rewritten steps file should add
 *            summary: { pageCount:number, envCount:number, methodCount:number } }}
 */
export function refactorToPom(project, opts = {}) {
  const framework = opts.framework || project.framework || 'playwright-java';
  const lang = framework.startsWith('selenium') ? 'selenium-java'
             : framework === 'playwright-javascript' ? 'playwright-javascript'
             : 'playwright-java';

  // ── 1. Walk scenarios and split into per-page segments ───────────────────
  // Page-boundary detection rules (in order):
  //   a. `navigate` always starts a new segment.
  //   b. SPA/post-back transition: a click immediately followed by a
  //      waitForSelector. SPAs and React/Vue apps often use this instead
  //      of a real URL change. Only split this way when the scenario
  //      provides MORE @<X>Page tags than there are real navigates,
  //      and we still have an unused tag — that's the user telling us
  //      "I expect this many distinct pages".
  //   c. Naming preference (PER segment, in order):
  //      1. URL-derived name when the segment starts with a navigate
  //         (e.g. /inventory.html → InventoryPage). This is the most
  //         reliable signal and avoids the "first-tag-wins-everything"
  //         bug.
  //      2. The next @PageName tag NOT YET CONSUMED by a segment.
  //         (Only relevant for SPA-split segments and segments whose
  //         URL would derive a generic name like "HomePage".)
  const segments = [];
  const allUrls = new Set();

  for (const scn of (project.scenarios || [])) {
    const tags = Array.isArray(scn.tags) ? scn.tags : [];
    const pageHints = tags
      .filter(t => /^@.+Page$/.test(t))
      .map(t => t.replace(/^@/, ''));
    const stepsList = (scn.steps || []).map(s => (s && s.action ? s.action : s)).filter(Boolean);
    const navCount = stepsList.filter(s => s.kind === 'navigate').length;
    const needSpaSplit = pageHints.length > navCount;

    // Tags already used by a segment (so we don't reuse them across pages).
    const usedTags = new Set();
    let currentPage = null;
    let currentSeg = null;       // direct reference, NOT an index into global segments[]
    let lastWasClick = false;

    const consumeTag = (preferred) => {
      // Case-insensitive, strip non-alpha for matching ("DynamicIdPage" ↔ "DynamicidPage").
      const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (preferred) {
        const target = norm(preferred);
        for (const h of pageHints) {
          if (!usedTags.has(h) && norm(h) === target) { usedTags.add(h); return h; }
        }
      }
      for (const h of pageHints) if (!usedTags.has(h)) { usedTags.add(h); return h; }
      return null;
    };

    const startSegment = (urlForName, hintOverride) => {
      // Derive name from URL first; if URL gives a generic "HomePage"
      // and we have unused @PageName tags, prefer the tag. Otherwise,
      // try to MATCH the URL-derived name to a tag (case-insensitive)
      // so /dynamicid → @DynamicIdPage instead of "DynamicidPage".
      let name = null;
      if (urlForName) name = derivePageNameFromUrl(urlForName);
      const looksGeneric = !name || /HomePage$/i.test(name) || name === 'UnknownPage';
      if (hintOverride) {
        name = consumeTag(hintOverride) || name;
      } else if (looksGeneric) {
        const tag = consumeTag(null);
        if (tag) name = tag;
      } else {
        // Try fuzzy-match the URL-derived name to a hint tag.
        const matched = consumeTag(name);
        if (matched) name = matched;
      }
      if (!name) name = 'HomePage';
      currentPage = name;
      currentSeg = { pageName: name, scenarioId: scn.id, steps: [] };
      segments.push(currentSeg);
    };

    for (let i = 0; i < stepsList.length; i++) {
      const step = stepsList[i];

      // RULE A — explicit navigate
      if (step.kind === 'navigate' && step.url) {
        allUrls.add(step.url);
        startSegment(step.url, null);
        currentSeg.steps.push(step);
        lastWasClick = false;
        continue;
      }

      // RULE B — SPA/post-back transition (click → waitForSelector)
      if (needSpaSplit
          && step.kind === 'waitForSelector'
          && lastWasClick
          && pageHints.some(t => !usedTags.has(t))) {
        startSegment(null, null);
        currentSeg.steps.push(step);
        lastWasClick = false;
        continue;
      }

      // Fallback: first non-nav step becomes a HomePage segment.
      if (currentSeg == null) startSegment(null, null);
      currentSeg.steps.push(step);
      lastWasClick = (step.kind === 'click' || step.kind === 'doubleClick');
    }
  }

  // ── 2. Group segments by page name, dedupe selectors per page ────────────
  const pageMap = new Map();   // pageName -> { selectors: Set, actions: [{kind, selector, value, frameSelector}] }
  for (const seg of segments) {
    if (!pageMap.has(seg.pageName)) pageMap.set(seg.pageName, { selectors: new Map(), actions: [] });
    const page = pageMap.get(seg.pageName);
    for (const step of seg.steps) {
      if (step.selector) {
        if (!page.selectors.has(step.selector)) {
          page.selectors.set(step.selector, fieldNameFor(step.selector));
        }
      }
      page.actions.push(step);
    }
  }

  // ── 3. Derive environments from URLs ─────────────────────────────────────
  const projectEnvs = Array.isArray(project.environments) ? project.environments : null;
  const envs = projectEnvs && projectEnvs.length
    ? projectEnvs
    : deriveEnvsFromUrls([...allUrls]);

  // ── 4. Emit code per framework ───────────────────────────────────────────
  const pages = [];
  let totalMethods = 0;
  for (const [name, page] of pageMap) {
    const generated = lang === 'selenium-java' ? renderSeleniumJavaPage(name, page)
                    : lang === 'playwright-java' ? renderPlaywrightJavaPage(name, page)
                    : renderPlaywrightJsPage(name, page);
    pages.push(generated);
    totalMethods += generated.methodCount;
  }

  // ── 5. Emit per-env config files ─────────────────────────────────────────
  const envFiles = envs.map(e => ({
    name: e.name,
    file: `config/.env.${e.name.toLowerCase()}`,
    body: renderEnvFile(e),
  }));

  return {
    pages,
    envs: envFiles,
    stepsImports: lang.includes('java') ? `import pages.*;` : `// pages auto-imported via require`,
    summary: { pageCount: pages.length, envCount: envFiles.length, methodCount: totalMethods },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function derivePageNameFromUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/+|\/+$/g, '').replace(/\.(html?|php|aspx)$/, '');
    if (!path) {
      // Bare host — use the host minus TLD as the name, eg. "saucedemo.com" → "Saucedemo"
      const host = u.host.replace(/^www\./, '').split('.')[0];
      return capitalize(host) + 'HomePage';
    }
    // /inventory → Inventory; /shadow-dom → ShadowDom; /clientdelay → Clientdelay
    return path.split(/[\/\-_]/).filter(Boolean).map(capitalize).join('') + 'Page';
  } catch (_) {
    return 'UnknownPage';
  }
}

function deriveEnvsFromUrls(urls) {
  const byOrigin = new Map();
  for (const u of urls) {
    try {
      const o = new URL(u);
      const origin = `${o.protocol}//${o.host}`;
      if (!byOrigin.has(origin)) byOrigin.set(origin, []);
      byOrigin.get(origin).push(u);
    } catch (_) {}
  }
  // Stable env naming: QA, STAGE, DEV (most teams' convention).
  const labels = ['QA', 'STAGE', 'DEV', 'UAT', 'PROD'];
  const out = [];
  let i = 0;
  for (const [origin] of byOrigin) {
    out.push({ name: labels[i] || `ENV${i+1}`, baseUrl: origin });
    i++;
  }
  return out.length ? out : [{ name: 'QA', baseUrl: 'http://localhost:3000' }];
}

// Java/JS reserved words that we must NOT collide with for field names.
const RESERVED = new Set([
  'class','public','private','protected','static','final','void','int','long','boolean','float','double',
  'package','import','new','return','this','super','if','else','for','while','do','switch','case','break',
  'continue','try','catch','finally','throw','throws','default','interface','extends','implements',
  'true','false','null','instanceof',
  // JS additions
  'function','const','let','var','async','await','of','in','typeof','delete',
]);

/**
 * Map any selector → a valid Java/JS identifier (camelCase).
 * Replaces `/`, `(`, `)`, `:`, `,`, etc. with spaces so the resulting
 * tokens are pure ASCII letters/digits.
 */
function fieldNameFor(selector) {
  if (!selector) return 'element';
  let s = String(selector)
    .replace(/has-text\(/gi, ' hasText ')                          // :has-text(...) → token "hasText"
    .replace(/text-is\(/gi,  ' textIs ')                           // :text-is(...) → token "textIs"
    .replace(/[^A-Za-z0-9]+/g, ' ')                                // anything else → space
    .trim();
  if (!s) s = 'element';
  const parts = s.split(/\s+/).filter(Boolean);
  // Drop leading-digit-only words; if the first word starts with a digit,
  // prefix with `el`.
  let head = parts[0].toLowerCase();
  if (/^\d/.test(head)) head = 'el' + capitalize(head);
  let name = head + parts.slice(1).map(capitalize).join('');
  // Cap length so we don't get 80-char field names from XPath blobs.
  if (name.length > 50) name = name.slice(0, 50);
  if (RESERVED.has(name)) name = name + 'Field';
  return name;
}

function methodNameFor(prefix, fieldName) {
  let name = prefix + capitalize(fieldName);
  if (name.length > 60) name = name.slice(0, 60);
  return name;
}

/**
 * Return a stable per-page method-name uniquifier. Use this when the
 * same selector accepts multiple action kinds and the naive name
 * would collide. Caller passes a Set kept across all action emissions
 * for one page.
 */
function uniqueMethodName(seen, base) {
  if (!seen.has(base)) { seen.add(base); return base; }
  let i = 2;
  while (seen.has(base + i)) i++;
  const out = base + i;
  seen.add(out);
  return out;
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

function jsString(s) { return JSON.stringify(s == null ? '' : String(s)); }

// ────────────────────────────────────────────────────────────────────────────
// Page renderers
// ────────────────────────────────────────────────────────────────────────────

function renderSeleniumJavaPage(name, page) {
  const lines = [
    `package pages;`,
    ``,
    `import org.openqa.selenium.WebDriver;`,
    `import org.openqa.selenium.WebElement;`,
    `import org.openqa.selenium.By;`,
    `import org.openqa.selenium.support.FindBy;`,
    `import org.openqa.selenium.support.PageFactory;`,
    `import org.openqa.selenium.support.ui.Select;`,
    `import org.openqa.selenium.support.ui.WebDriverWait;`,
    `import org.openqa.selenium.support.ui.ExpectedConditions;`,
    `import java.time.Duration;`,
    `import static org.junit.jupiter.api.Assertions.*;`,
    ``,
    `/**`,
    ` * Auto-generated Page Object — derived from recorded steps for ${name}.`,
    ` * Selectors that begin with #/./[ are CSS; those starting with xpath= or //`,
    ` * are XPath; everything else is treated as raw CSS by Selenium.`,
    ` */`,
    `public class ${name} {`,
    ``,
    `    protected final WebDriver driver;`,
    `    protected final WebDriverWait wait;`,
    ``,
    `    public ${name}(WebDriver driver) {`,
    `        this.driver = driver;`,
    `        this.wait = new WebDriverWait(driver, Duration.ofSeconds(15));`,
    `        PageFactory.initElements(driver, this);`,
    `    }`,
    ``,
  ];
  // Fields (one @FindBy per unique selector)
  for (const [sel, field] of page.selectors) {
    lines.push(`    @FindBy(${seleniumFindByFor(sel)})`);
    lines.push(`    private WebElement ${field};`);
    lines.push(``);
  }
  // Action methods
  let methodCount = 0;
  const seen = new Set();
  for (const step of page.actions) {
    const m = renderSeleniumActionMethod(step, page.selectors, seen);
    if (m) { lines.push(m); methodCount++; }
  }
  lines.push(`}`);
  return {
    name,
    framework: 'selenium-java',
    relPath: `src/main/java/pages/${name}.java`,
    code: lines.join('\n') + '\n',
    methodCount,
  };
}

function seleniumFindByFor(selector) {
  if (selector.startsWith('xpath=') || selector.startsWith('//')) {
    return `xpath = ${jsString(selector.replace(/^xpath=/, ''))}`;
  }
  if (selector.startsWith('#') && /^#[a-zA-Z][\w-]*$/.test(selector)) {
    return `id = ${jsString(selector.slice(1))}`;
  }
  return `css = ${jsString(selector)}`;
}

function renderSeleniumActionMethod(step, selectorMap, seen) {
  const fld = step.selector ? selectorMap.get(step.selector) : null;
  const m = (base) => uniqueMethodName(seen, base);
  switch (step.kind) {
    case 'navigate':
      return `    public void ${m('open')}() {\n        driver.get(${jsString(step.url)});\n    }\n`;
    case 'click':
    case 'doubleClick':
      if (!fld) return null;
      return `    public void ${m(methodNameFor('click', fld))}() {\n        wait.until(ExpectedConditions.elementToBeClickable(${fld})).click();\n    }\n`;
    case 'fill':
    case 'type':
      if (!fld) return null;
      return `    public void ${m(methodNameFor('type', fld))}(String value) {\n        wait.until(ExpectedConditions.visibilityOf(${fld}));\n        ${fld}.clear();\n        ${fld}.sendKeys(value);\n    }\n`;
    case 'select':
      if (!fld) return null;
      return `    public void ${m(methodNameFor('select', fld))}(String value) {\n        new Select(${fld}).selectByValue(value);\n    }\n`;
    case 'assertVisible':
      if (!fld) return null;
      return `    public void ${m(methodNameFor('assert', fld + 'Visible'))}() {\n        wait.until(ExpectedConditions.visibilityOf(${fld}));\n    }\n`;
    case 'assertText':
      if (!fld) return null;
      return `    public void ${m(methodNameFor('assert', fld + 'Text'))}(String expected) {\n        wait.until(ExpectedConditions.visibilityOf(${fld}));\n        assertTrue(${fld}.getText().contains(expected),\n            "Expected text '" + expected + "' but got: " + ${fld}.getText());\n    }\n`;
    case 'assertCount':
      if (!step.selector) return null;
      return `    public void ${m(methodNameFor('assertCount', fld || 'elements'))}(int expected) {\n        int actual = driver.findElements(${seleniumByExpr(step.selector)}).size();\n        assertEquals(expected, actual, "Expected " + expected + " elements, got " + actual);\n    }\n`;
    case 'waitForSelector':
      if (!fld) return null;
      return `    public void ${m(methodNameFor('waitFor', fld))}() {\n        wait.until(ExpectedConditions.presenceOfElementLocated(${seleniumByExpr(step.selector)}));\n    }\n`;
    default:
      return null;
  }
}

function seleniumByExpr(selector) {
  if (selector.startsWith('xpath=') || selector.startsWith('//')) return `By.xpath(${jsString(selector.replace(/^xpath=/, ''))})`;
  return `By.cssSelector(${jsString(selector)})`;
}

// ────────────────────────────────────────────────────────────────────────────

function renderPlaywrightJavaPage(name, page) {
  const lines = [
    `package pages;`,
    ``,
    `import com.microsoft.playwright.Page;`,
    `import com.microsoft.playwright.Locator;`,
    `import com.microsoft.playwright.options.AriaRole;`,
    `import com.microsoft.playwright.assertions.PlaywrightAssertions;`,
    ``,
    `/**`,
    ` * Auto-generated Page Object for ${name}, Playwright-Java flavour.`,
    ` * Each Locator getter is lazy so the page can survive SPA route changes.`,
    ` */`,
    `public class ${name} {`,
    `    protected final Page page;`,
    ``,
    `    public ${name}(Page page) { this.page = page; }`,
    ``,
  ];
  // Locator getters
  for (const [sel, field] of page.selectors) {
    lines.push(`    public Locator ${field}() { return page.locator(${jsString(sel)}); }`);
  }
  lines.push(``);
  let methodCount = 0;
  const seen = new Set();
  for (const step of page.actions) {
    const m = renderPlaywrightJavaActionMethod(step, page.selectors, seen);
    if (m) { lines.push(m); methodCount++; }
  }
  lines.push(`}`);
  return {
    name,
    framework: 'playwright-java',
    relPath: `src/main/java/pages/${name}.java`,
    code: lines.join('\n') + '\n',
    methodCount,
  };
}

function renderPlaywrightJavaActionMethod(step, selectorMap, seen) {
  const fld = step.selector ? selectorMap.get(step.selector) : null;
  const m = (base) => uniqueMethodName(seen, base);
  switch (step.kind) {
    case 'navigate':
      return `    public void ${m('open')}() { page.navigate(${jsString(step.url)}); }`;
    case 'click':
      return fld ? `    public void ${m(methodNameFor('click', fld))}() { ${fld}().click(); }` : null;
    case 'fill':
    case 'type':
      return fld ? `    public void ${m(methodNameFor('type', fld))}(String v) { ${fld}().fill(v); }` : null;
    case 'select':
      return fld ? `    public void ${m(methodNameFor('select', fld))}(String v) { ${fld}().selectOption(v); }` : null;
    case 'assertVisible':
      return fld ? `    public void ${m(methodNameFor('assert', fld + 'Visible'))}() { PlaywrightAssertions.assertThat(${fld}()).isVisible(); }` : null;
    case 'assertText':
      return fld ? `    public void ${m(methodNameFor('assert', fld + 'Text'))}(String expected) { PlaywrightAssertions.assertThat(${fld}()).containsText(expected); }` : null;
    case 'assertCount':
      return fld ? `    public void ${m(methodNameFor('assertCount', fld))}(int expected) { PlaywrightAssertions.assertThat(${fld}()).hasCount(expected); }` : null;
    case 'waitForSelector':
      return fld ? `    public void ${m(methodNameFor('waitFor', fld))}() { ${fld}().first().waitFor(); }` : null;
    default:
      return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────

function renderPlaywrightJsPage(name, page) {
  const lines = [
    `// Auto-generated Page Object for ${name} (Playwright JavaScript)`,
    `'use strict';`,
    ``,
    `class ${name} {`,
    `  constructor(page) { this.page = page; }`,
    ``,
  ];
  for (const [sel, field] of page.selectors) {
    lines.push(`  get ${field}() { return this.page.locator(${jsString(sel)}); }`);
  }
  lines.push(``);
  let methodCount = 0;
  const seen = new Set();
  for (const step of page.actions) {
    const m = renderPlaywrightJsActionMethod(step, page.selectors, seen);
    if (m) { lines.push(m); methodCount++; }
  }
  lines.push(`}`);
  lines.push(``);
  lines.push(`module.exports = { ${name} };`);
  return {
    name,
    framework: 'playwright-javascript',
    relPath: `pages/${name}.js`,
    code: lines.join('\n') + '\n',
    methodCount,
  };
}

function renderPlaywrightJsActionMethod(step, selectorMap, seen) {
  const fld = step.selector ? selectorMap.get(step.selector) : null;
  const m = (base) => uniqueMethodName(seen, base);
  switch (step.kind) {
    case 'navigate':
      return `  async ${m('open')}() { await this.page.goto(${jsString(step.url)}); }`;
    case 'click':
      return fld ? `  async ${m(methodNameFor('click', fld))}() { await this.${fld}.click(); }` : null;
    case 'fill':
    case 'type':
      return fld ? `  async ${m(methodNameFor('type', fld))}(value) { await this.${fld}.fill(value); }` : null;
    case 'select':
      return fld ? `  async ${m(methodNameFor('select', fld))}(value) { await this.${fld}.selectOption(value); }` : null;
    case 'assertVisible':
      return fld ? `  async ${m(methodNameFor('assert', fld + 'Visible'))}() { await this.page.waitForSelector(${jsString(step.selector)}, { state: 'visible' }); }` : null;
    case 'assertText':
      return fld ? `  async ${m(methodNameFor('assert', fld + 'Text'))}(expected) { const t = await this.${fld}.textContent(); if (!t || !t.includes(expected)) throw new Error('Expected ' + expected + ' got ' + t); }` : null;
    case 'assertCount':
      return fld ? `  async ${m(methodNameFor('assertCount', fld))}(expected) { const n = await this.${fld}.count(); if (n !== expected) throw new Error('Expected ' + expected + ' got ' + n); }` : null;
    case 'waitForSelector':
      return fld ? `  async ${m(methodNameFor('waitFor', fld))}() { await this.${fld}.first().waitFor(); }` : null;
    default:
      return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Env config
// ────────────────────────────────────────────────────────────────────────────

function renderEnvFile(env) {
  const ts = new Date().toISOString();
  return [
    `# .env.${env.name.toLowerCase()} — auto-generated by ZAC POM Refactor at ${ts}`,
    `ENV=${env.name}`,
    `BASE_URL=${env.baseUrl}`,
    `BROWSER=${env.browser || 'chromium'}`,
    `HEADLESS=${env.headless == null ? 'true' : String(env.headless)}`,
    `# Selenium grid / Playwright remote (set when running in CI):`,
    `# SELENIUM_GRID_URL=`,
    `# PLAYWRIGHT_WS_ENDPOINT=`,
  ].join('\n') + '\n';
}
