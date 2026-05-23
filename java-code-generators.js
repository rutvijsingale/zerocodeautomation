/**
 * Optimized Java Code Generators
 * Generates Java test code for Playwright and Selenium frameworks
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const VERSIONS = {
  PLAYWRIGHT: '1.47.0',
  CUCUMBER: '7.14.0',
  JUNIT: '5.10.0',
  ALLURE: '2.24.0',
  SUREFIRE: '3.2.2',
  SELENIUM: '4.15.0',
  WEBDRIVER_MANAGER: '5.6.2'
};

const DEFAULT_PAGE_URLS = [
  { name: 'Landing Page', path: '' },
  { name: 'PreEligibility Page', path: '/prescreener/' },
  { name: 'Financial Flow Page', path: '/financial' },
  { name: 'Application Page', path: '/application' }
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if framework is Playwright Java
 */
function isPlaywrightJava(framework) {
  return framework === 'playwright-java';
}

/**
 * Generate page URL mapping code (reduces duplication)
 */
function generatePageUrlMappingCode(baseUrl, defaultUrl = null) {
  const urlLines = DEFAULT_PAGE_URLS.map(page => 
    `        pageUrls.put("${page.name}", "${baseUrl}${page.path}");`
  ).join('\n');
  const defaultUrlValue = defaultUrl || baseUrl;
  return `        java.util.Map<String, String> pageUrls = new java.util.HashMap<>();\n${urlLines}\n        String url = pageUrls.getOrDefault(pageName, "${defaultUrlValue}");`;
}

/**
 * Generate navigation action based on framework
 */
function getNavigationAction(framework) {
  return isPlaywrightJava(framework) ? 'getPage().navigate(url);' : 'getDriver().get(url);';
}

/**
 * Escape Java string for use in generated code
 */
function escapeJavaString(str) {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * Convert string to camelCase
 */
function toCamelCase(str) {
  return str
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => {
      return index === 0 ? word.toLowerCase() : word.toUpperCase();
    })
    .replace(/\s+/g, '')
    .replace(/[^a-zA-Z0-9]/g, '');
}

/**
 * Capitalize first letter
 */
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================================================
// MAIN GENERATION FUNCTIONS
// ============================================================================

function generateJavaWorld(framework, browserOptions = {}) {
  if (framework === 'playwright-java') {
    const headless = browserOptions.headless !== undefined ? browserOptions.headless : false;
    const browserType = browserOptions.browserType || 'chromium';
    const args = browserOptions.args || [];

    return `package support;

import com.microsoft.playwright.*;
import io.cucumber.java.After;
import io.cucumber.java.Before;
import java.util.Arrays;

/**
 * PlaywrightWorld - shared Playwright lifecycle for all step definitions.
 *
 * Remote-browser support (added 2026-05-24):
 *   Set PLAYWRIGHT_WS_ENDPOINT (or zac.playwrightWsEndpoint JVM property)
 *   to a Playwright Server / BrowserStack / Sauce Labs websocket
 *   endpoint, e.g. ws://playwright.qa.bank:3001/ . The World will then
 *   call BrowserType#connect(wsEndpoint) instead of launch(), so the
 *   same generated JAR runs on a developer laptop AND on a remote
 *   Playwright cluster without recompile.
 *
 * Browser-type override:
 *   ZAC_BROWSER env var or zac.browser JVM prop wins over the
 *   compiled-in default.
 */
public class PlaywrightWorld {
    private static Browser browser;
    private static BrowserContext context;
    private static Page page;
    private static Playwright playwright;

    public static Browser getBrowser() {
        return browser;
    }

    public static BrowserContext getContext() {
        return context;
    }

    public static Page getPage() {
        return page;
    }

    private static String resolveBrowserType() {
        String env  = System.getenv("ZAC_BROWSER");      if (env  != null && !env.isEmpty())  return env;
        String prop = System.getProperty("zac.browser"); if (prop != null && !prop.isEmpty()) return prop;
        return "${browserType}";
    }

    private static String resolveWsEndpoint() {
        String env  = System.getenv("PLAYWRIGHT_WS_ENDPOINT");        if (env  != null && !env.isEmpty())  return env;
        String prop = System.getProperty("zac.playwrightWsEndpoint"); if (prop != null && !prop.isEmpty()) return prop;
        return null;
    }

    @Before
    public void init() {
        playwright = Playwright.create();
        String browserType = resolveBrowserType();
        String wsEndpoint  = resolveWsEndpoint();

        BrowserType.LaunchOptions launchOptions = new BrowserType.LaunchOptions()
            .setHeadless(${headless});

        BrowserType bt;
        switch (browserType) {
            case "firefox":
                bt = playwright.firefox();
                ${args.length > 0 ? `launchOptions.setArgs(Arrays.asList(${args.map(arg => `"${arg}"`).join(', ')}));` : ''}
                break;
            case "webkit":
                bt = playwright.webkit();
                ${args.length > 0 ? `launchOptions.setArgs(Arrays.asList(${args.map(arg => `"${arg}"`).join(', ')}));` : ''}
                break;
            case "edge":
                bt = playwright.chromium();
                launchOptions.setChannel("msedge");
                java.util.List<String> edgeArgs = new java.util.ArrayList<>(${args.length > 0 ? `Arrays.asList(${args.map(arg => `"${arg}"`).join(', ')})` : 'Arrays.asList()'});
                edgeArgs.add("--brand=Microsoft Edge");
                launchOptions.setArgs(edgeArgs);
                break;
            default: // chromium / chrome
                bt = playwright.chromium();
                launchOptions.setChannel("chrome");
                ${args.length > 0 ? `launchOptions.setArgs(Arrays.asList(${args.map(arg => `"${arg}"`).join(', ')}));` : ''}
                break;
        }

        if (wsEndpoint != null) {
            // ── Remote Playwright cluster path ──
            System.out.println("[PlaywrightWorld] Using remote browser at: " + wsEndpoint + " (browser=" + browserType + ")");
            browser = bt.connect(wsEndpoint);
        } else {
            // ── Local launch path ──
            browser = bt.launch(launchOptions);
        }

        // Enable video recording and screenshots for better reporting
        Browser.NewContextOptions contextOptions = new Browser.NewContextOptions()
            .setRecordVideoDir(java.nio.file.Paths.get("target/allure-results/videos"))
            .setRecordVideoSize(1280, 720);
        context = browser.newContext(contextOptions);
        page = context.newPage();
    }

    @After
    public void cleanup(io.cucumber.java.Scenario scenario) {
        // Capture screenshot on failure
        if (scenario.isFailed() && page != null) {
            try {
                byte[] screenshot = page.screenshot();
                scenario.attach(screenshot, "image/png", "Screenshot on Failure");
            } catch (Exception e) {
                System.err.println("Failed to capture screenshot: " + e.getMessage());
            }
        }
        
        // Close page and context (video is saved automatically)
        if (page != null) {
            page.close();
        }
        if (context != null) {
            context.close();
        }
        if (browser != null) {
            browser.close();
        }
        // [ZAC-FIX] Close Playwright last — was leaking the driver
        // process across scenarios and breaking remote endpoints that
        // enforce per-session cleanup (BrowserStack / SauceLabs).
        if (playwright != null) {
            try { playwright.close(); } catch (Exception ignored) { /* best-effort */ }
            playwright = null;
        }
    }
}`;
  } else if (framework === 'selenium-java') {
    const headless = browserOptions.headless !== undefined ? browserOptions.headless : false;
    const args = browserOptions.args || [];
    // Map Playwright browser types to Selenium browser types
    let seleniumBrowserType = browserOptions.browserType || 'chromium';
    if (seleniumBrowserType === 'chromium') {
      seleniumBrowserType = 'chrome';
    } else if (seleniumBrowserType === 'webkit') {
      seleniumBrowserType = 'safari';
    }

    return `package support;

import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.firefox.FirefoxDriver;
import org.openqa.selenium.firefox.FirefoxOptions;
import org.openqa.selenium.safari.SafariDriver;
import org.openqa.selenium.remote.RemoteWebDriver;
import io.cucumber.java.After;
import io.cucumber.java.Before;
import java.net.URL;
import java.time.Duration;
import java.util.Arrays;

/**
 * SeleniumWorld - shared WebDriver lifecycle for all step definitions.
 *
 * Selenium Grid support (added 2026-05-24):
 *   Set SELENIUM_HUB_URL (or zac.seleniumHubUrl JVM property) to the hub
 *   endpoint, e.g. http://grid.example.com:4444/wd/hub. When the env
 *   var is present, the World instantiates a RemoteWebDriver against
 *   the grid using the same browser-type capabilities; when it's absent
 *   it falls back to a local driver — so the same generated JAR works
 *   on a developer laptop AND on a CI farm without recompile.
 *
 * Browser selection precedence:
 *   1. ZAC_BROWSER env var       (CI: any of chrome|firefox|edge|safari)
 *   2. zac.browser JVM prop      (mvn -Dzac.browser=firefox test)
 *   3. compiled-in default below
 */
public class SeleniumWorld {
    private static WebDriver driver;

    public static WebDriver getDriver() {
        return driver;
    }

    private static String resolveBrowserType() {
        String env = System.getenv("ZAC_BROWSER");
        if (env != null && !env.isEmpty()) return env;
        String prop = System.getProperty("zac.browser");
        if (prop != null && !prop.isEmpty()) return prop;
        return "${seleniumBrowserType}";
    }

    private static String resolveHubUrl() {
        // Either SELENIUM_HUB_URL env var or zac.seleniumHubUrl JVM prop
        // (so users can pass it via mvn -Dzac.seleniumHubUrl=... ).
        String env = System.getenv("SELENIUM_HUB_URL");
        if (env != null && !env.isEmpty()) return env;
        String prop = System.getProperty("zac.seleniumHubUrl");
        if (prop != null && !prop.isEmpty()) return prop;
        return null; // run locally
    }

    @Before
    public void init() throws Exception {
        String browserType = resolveBrowserType();
        String hubUrl = resolveHubUrl();

        // Build per-browser capabilities first so they work identically
        // for local AND remote driver paths.
        ChromeOptions chromeOptions   = new ChromeOptions();
        FirefoxOptions firefoxOptions = new FirefoxOptions();
        ${headless ? 'chromeOptions.addArguments("--headless=new"); firefoxOptions.addArguments("--headless");' : ''}
        chromeOptions.addArguments("--start-maximized");
        chromeOptions.addArguments("--disable-blink-features=AutomationControlled");
        ${args.length > 0 ? `chromeOptions.addArguments(${args.map(arg => `"${arg}"`).join(', ')});` : ''}
        ${args.length > 0 ? `firefoxOptions.addArguments(${args.map(arg => `"${arg}"`).join(', ')});` : ''}

        if (hubUrl != null) {
            // ────── Selenium Grid path ──────
            System.out.println("[SeleniumWorld] Using Grid: " + hubUrl + " (browser=" + browserType + ")");
            switch (browserType.toLowerCase()) {
                case "firefox":
                    driver = new RemoteWebDriver(new URL(hubUrl), firefoxOptions);
                    break;
                case "edge":
                    // Edge uses Chromium options; the Grid node decides the binary.
                    driver = new RemoteWebDriver(new URL(hubUrl), chromeOptions);
                    break;
                case "safari":
                    org.openqa.selenium.safari.SafariOptions safariOptions = new org.openqa.selenium.safari.SafariOptions();
                    driver = new RemoteWebDriver(new URL(hubUrl), safariOptions);
                    break;
                default: // chrome / chromium
                    driver = new RemoteWebDriver(new URL(hubUrl), chromeOptions);
                    break;
            }
        } else {
            // ────── Local driver path ──────
            switch (browserType.toLowerCase()) {
                case "firefox":
                    driver = new FirefoxDriver(firefoxOptions);
                    break;
                case "edge":
                    // Edge uses Chromium binary on Windows; fall through to Chrome options.
                    ChromeOptions edgeOptions = new ChromeOptions();
                    edgeOptions.setBinary("C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe");
                    ${headless ? 'edgeOptions.addArguments("--headless=new");' : ''}
                    edgeOptions.addArguments("--start-maximized");
                    edgeOptions.addArguments("--disable-blink-features=AutomationControlled");
                    ${args.length > 0 ? `edgeOptions.addArguments(${args.map(arg => `"${arg}"`).join(', ')});` : ''}
                    driver = new ChromeDriver(edgeOptions);
                    break;
                case "safari":
                    driver = new SafariDriver();
                    break;
                default: // chrome / chromium
                    driver = new ChromeDriver(chromeOptions);
                    break;
            }
        }

        driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(10));
        try { driver.manage().window().maximize(); } catch (Exception ignored) { /* not all grid nodes support */ }
    }

    @After
    public void cleanup() {
        if (driver != null) {
            driver.quit();
        }
    }
}`;
  }
  return '';
}

function generateJavaStepDefinitions(framework, stepDefMap, groupedActions, baseUrl, steps = [], className = null) {
  // Check if any steps have pageName and elementName (indicating page object support)
  const hasPageObjects = steps && steps.some(s => s.pageName && s.elementName);
  const pageObjectsMap = new Map(); // Map pageName -> Set of elementNames used
  
  if (hasPageObjects) {
    steps.forEach(step => {
      if (step.pageName && step.elementName) {
        if (!pageObjectsMap.has(step.pageName)) {
          pageObjectsMap.set(step.pageName, new Set());
        }
        pageObjectsMap.get(step.pageName).add(step.elementName);
      }
    });
  }
  
  // Track generated step patterns to prevent duplicates
  // Key: step pattern (normalized, case-insensitive for matching)
  // Value: annotation type that was used (@When, @And, etc.)
  const generatedSteps = new Map();
  
  // Helper function to normalize step pattern for duplicate detection
  const normalizePattern = (pattern) => {
    // Remove leading keyword (Given/When/Then/And) and normalize
    // Also normalize case for common patterns (e.g., "I click" vs "I Click")
    let normalized = pattern.replace(/^(Given|When|Then|And)\s+/i, '').trim();
    // Normalize common case variations
    normalized = normalized.replace(/^I\s+Click\s+/i, 'I click ');
    normalized = normalized.replace(/^I\s+Enter\s+/i, 'I enter ');
    normalized = normalized.replace(/^I\s+Type\s+/i, 'I type ');
    return normalized;
  };
  
  // Helper function to check if a step pattern has already been generated
  const isStepGenerated = (pattern) => {
    const normalized = normalizePattern(pattern);
    return generatedSteps.has(normalized);
  };
  
  // Helper function to mark a step as generated
  const markStepGenerated = (pattern, annotationType) => {
    const normalized = normalizePattern(pattern);
    generatedSteps.set(normalized, annotationType);
  };
  
  // Always include common step definitions regardless of stepDefMap
  // This ensures standard steps are always available for both frameworks.
  //
  // [ZAC-FIX 2026-05-24] Greatly expanded so every step kind the recorder
  // can produce has a guaranteed matching @annotation in the generated
  // .java. Without these entries, recordings using doubleClick / hover /
  // dragDrop / check / uncheck / selectRadio / fileUpload / keyPress /
  // scroll / waitFor / waitForSelector / screenshot / apiCall would
  // compile but throw "Undefined step" the moment Cucumber executed.
  const commonSteps = {
    // Existing core
    'Given I navigate to {string}': true,
    'When I click {string}': true,
    'And I click {string}': true,
    'When I type {string} into {string}': true,
    'And I type {string} into {string}': true,
    'When I select {string} from {string}': true,
    'And I select {string} from {string}': true,
    'Then I should see {string} in {string}': true,
    'Then {string} should be visible': true,
    'And I close the browser': true,

    // [ZAC-FIX] Newly always-emitted matchers for missing step kinds.
    'And I double click {string}': true,
    'And I hover over {string}': true,
    'And I drag {string} to {string}': true,
    'And I check {string}': true,
    'And I uncheck {string}': true,
    'And I select radio {string} in {string}': true,
    'And I upload {string} to {string}': true,
    'And I press key {string}': true,
    'And I scroll to position ({int}, {int})': true,
    'And I scroll to {string}': true,
    'And I wait for {int} ms': true,
    'And I wait for selector {string}': true,
    'And I take screenshot {string}': true,
    'And I call API {word} {string}': true,
  };
  
  // Merge common steps with stepDefMap
  Object.keys(commonSteps).forEach(key => {
    if (!stepDefMap[key]) {
      stepDefMap[key] = true;
    }
  });
  
  // Remove duplicate patterns - if both "When" and "And" versions exist, keep only "When"
  const normalizedPatterns = new Map();
  Object.keys(stepDefMap).forEach(pattern => {
    const normalized = normalizePattern(pattern);
    if (!normalizedPatterns.has(normalized)) {
      // Prefer "When" over "And", "Given" over others, "Then" for assertions
      normalizedPatterns.set(normalized, pattern);
    } else {
      const existing = normalizedPatterns.get(normalized);
      const existingKeyword = existing.match(/^(Given|When|Then|And)/i)?.[1] || '';
      const newKeyword = pattern.match(/^(Given|When|Then|And)/i)?.[1] || '';
      
      // Priority: Given > When > Then > And
      const priority = { 'Given': 4, 'When': 3, 'Then': 2, 'And': 1 };
      if (priority[newKeyword] > priority[existingKeyword]) {
        normalizedPatterns.set(normalized, pattern);
        // Remove the lower priority one from stepDefMap
        delete stepDefMap[existing];
      } else {
        // Remove the lower priority one from stepDefMap
        delete stepDefMap[pattern];
      }
    }
  });
  
  // Track which imports are actually needed
  const needsLocator = stepDefMap['And I drag {string} to {string}'] || false;
  const needsPlaywrightWorld = stepDefMap['And I close the browser'] || false;
  const needsAssertions = true; // Always include assertions - they're always available
  const needsExpectedConditions = stepDefMap['And I wait for {string} to appear'] || false;
  const needsWebDriverWait = stepDefMap['And I wait for {string} to appear'] || false;
  const needsDuration = stepDefMap['And I wait for {string} to appear'] || false;
  
  // Build minimal imports based on what's actually used
  let imports = 'package steps;\n\n';
  imports += 'import io.cucumber.java.en.*;\n';
  
  // Add page object imports if page objects are used
  if (hasPageObjects && pageObjectsMap.size > 0) {
    pageObjectsMap.forEach((_, pageName) => {
      imports += `import pages.${pageName}Page;\n`;
    });
  }
  
  if (isPlaywrightJava(framework)) {
    imports += 'import static support.PlaywrightWorld.getPage;\n';
    if (needsPlaywrightWorld) imports += 'import support.PlaywrightWorld;\n';
    if (needsLocator) imports += 'import com.microsoft.playwright.Locator;\n';
    if (needsAssertions) imports += 'import static org.junit.jupiter.api.Assertions.*;\n';
  } else {
    imports += 'import static support.SeleniumWorld.getDriver;\n';
    imports += 'import org.openqa.selenium.By;\n';
    imports += 'import org.openqa.selenium.WebElement;\n';
    if (stepDefMap['When I select {string} from {string}'] || stepDefMap['And I select {string} from {string}']) {
      imports += 'import org.openqa.selenium.support.ui.Select;\n';
    }
    if (needsExpectedConditions) imports += 'import org.openqa.selenium.support.ui.ExpectedConditions;\n';
    if (needsWebDriverWait) imports += 'import org.openqa.selenium.support.ui.WebDriverWait;\n';
    if (needsDuration) imports += 'import java.time.Duration;\n';
    if (needsAssertions) imports += 'import static org.junit.jupiter.api.Assertions.*;\n';
  }

  // Generate class name from feature title or use default
  const finalClassName = className || 'RecordedTestFlowSteps';
  
  const lines = [imports, ''];
  lines.push(`public class ${finalClassName} {`);
  lines.push('');
  
  // Build selector lookup map: maps normalizedDescription to actual selector and fallbacks
  // Now uses locatorCandidates if available, otherwise falls back to selector + fallbackSelectors
  const selectorMap = new Map(); // description -> { primary: selector, fallbacks: [selector1, selector2, ...] }
  steps.forEach(step => {
    if (step.normalizedDescription) {
      let primarySelector = step.selector;
      let fallbacks = [];
      
      // Prefer locatorCandidates if available (new smart system)
      if (step.locatorCandidates && Array.isArray(step.locatorCandidates) && step.locatorCandidates.length > 0) {
        const primaryIndex = step.primaryLocatorIndex !== undefined ? step.primaryLocatorIndex : 0;
        const primaryCandidate = step.locatorCandidates[primaryIndex];
        if (primaryCandidate && primaryCandidate.selector) {
          primarySelector = primaryCandidate.selector;
          // Use all other candidates as fallbacks (sorted by stability)
          fallbacks = step.locatorCandidates
            .filter((c, idx) => idx !== primaryIndex && c.selector)
            .sort((a, b) => {
              if (a.unique !== b.unique) return a.unique ? -1 : 1;
              if (a.stabilityScore !== b.stabilityScore) return b.stabilityScore - a.stabilityScore;
              return a.matchCount - b.matchCount;
            })
            .map(c => c.selector);
        }
      } else if (step.fallbackSelectors) {
        // Fallback to old system if locatorCandidates not available
        fallbacks = step.fallbackSelectors;
      }
      
      // Only add if selector is valid and different from description
      if (primarySelector && primarySelector !== step.normalizedDescription) {
        if (primarySelector.startsWith('#') || primarySelector.startsWith('.') || 
            primarySelector.startsWith('[') || primarySelector.startsWith('text=') ||
            primarySelector.startsWith('//') || primarySelector.startsWith('role=') ||
            primarySelector.startsWith('xpath=') || primarySelector.includes('=')) {
          
          // Filter fallbacks to only include valid selectors
          const validFallbacks = fallbacks.filter(s => 
            s && (s.startsWith('#') || s.startsWith('.') || s.startsWith('[') || 
                  s.startsWith('text=') || s.startsWith('//') || s.startsWith('role=') ||
                  s.startsWith('xpath=') || s.includes('='))
          );
          
          selectorMap.set(step.normalizedDescription, {
            primary: primarySelector,
            fallbacks: validFallbacks
          });
        }
      }
    }
  });
  
  // Add selector lookup map if we have mappings
  if (selectorMap.size > 0) {
    lines.push('    // Selector lookup map: maps element descriptions to actual selectors with fallbacks');
    lines.push('    private static final java.util.Map<String, java.util.List<String>> SELECTOR_MAP = new java.util.HashMap<>();');
    // Parallel map keyed by the primary selector value. Lets the lowercase-c
    // step (`iClick(String selector)`) discover its recorded fallback chain at
    // runtime so a brittle primary selector still resolves via the secondary
    // candidates the recorder captured. This is the runtime arm of the
    // self-healing locator system.
    lines.push('    private static final java.util.Map<String, java.util.List<String>> SELECTOR_FALLBACKS_BY_PRIMARY = new java.util.HashMap<>();');
    lines.push('    static {');
    selectorMap.forEach((selectorData, description) => {
      // Escape quotes in selectors and description
      const escapedDesc = description.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const allSelectors = [selectorData.primary, ...selectorData.fallbacks];
      const escapedSelectors = allSelectors.map(s => 
        s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      );
      const varSafe = description.replace(/[^a-zA-Z0-9]/g, '_');
      lines.push(`        java.util.List<String> selectors_${varSafe} = new java.util.ArrayList<>();`);
      escapedSelectors.forEach(sel => {
        lines.push(`        selectors_${varSafe}.add("${sel}");`);
      });
      lines.push(`        SELECTOR_MAP.put("${escapedDesc}", selectors_${varSafe});`);
      // Index the same list by the primary selector value so a feature file
      // that calls "I click <primary>" can recover the fallbacks at runtime.
      lines.push(`        SELECTOR_FALLBACKS_BY_PRIMARY.put("${escapedSelectors[0]}", selectors_${varSafe});`);
    });
    lines.push('    }');
    lines.push('');
    
    // Add auto-healing helper method - intelligently finds elements when selectors fail
    // Only generate for Playwright projects
    if (isPlaywrightJava(framework)) {
    lines.push('    // Auto-healing: Try multiple strategies to find an element when selectors fail');
    lines.push('    private com.microsoft.playwright.Locator autoHealLocator(String elementDescription) {');
      lines.push('        // Strategy 1: Exact text match');
      lines.push('        try {');
      lines.push('            com.microsoft.playwright.Locator locator = getPage().locator("text=" + elementDescription);');
      lines.push('            if (locator.count() > 0) return locator.first();');
      lines.push('        } catch (Exception e) { /* Continue to next strategy */ }');
      lines.push('');
      lines.push('        // Strategy 2: Partial text match (case-insensitive)');
      lines.push('        try {');
      lines.push('            String normalized = elementDescription.toLowerCase().trim();');
      lines.push('            com.microsoft.playwright.Locator locator = getPage().locator("text=/.*" + java.util.regex.Pattern.quote(normalized) + ".*/i");');
      lines.push('            if (locator.count() > 0) return locator.first();');
      lines.push('        } catch (Exception e) { /* Continue to next strategy */ }');
      lines.push('');
      lines.push('        // Strategy 3: Aria-label containing the description');
      lines.push('        try {');
      lines.push('            com.microsoft.playwright.Locator locator = getPage().locator("[aria-label*=\'" + elementDescription + "\']");');
      lines.push('            if (locator.count() > 0) return locator.first();');
      lines.push('        } catch (Exception e) { /* Continue to next strategy */ }');
      lines.push('');
      lines.push('        // Strategy 4: Title attribute');
      lines.push('        try {');
      lines.push('            com.microsoft.playwright.Locator locator = getPage().locator("[title*=\'" + elementDescription + "\']");');
      lines.push('            if (locator.count() > 0) return locator.first();');
      lines.push('        } catch (Exception e) { /* Continue to next strategy */ }');
      lines.push('');
      lines.push('        // Strategy 5: Button or link with text');
      lines.push('        try {');
      lines.push('            com.microsoft.playwright.Locator locator = getPage().locator("button:has-text(\\\'" + elementDescription + "\\\'), a:has-text(\\\'" + elementDescription + "\\\'), input[type=\\\'button\\\'][value*=\\\'" + elementDescription + "\\\']");');
      lines.push('            if (locator.count() > 0) return locator.first();');
      lines.push('        } catch (Exception e) { /* Continue to next strategy */ }');
      lines.push('');
      lines.push('        // Strategy 6: ID containing description (normalized)');
      lines.push('        try {');
      lines.push('            String idNormalized = elementDescription.toLowerCase().replaceAll("[^a-z0-9]", "");');
      lines.push('            com.microsoft.playwright.Locator locator = getPage().locator("[id*=\'" + idNormalized + "\']");');
      lines.push('            if (locator.count() > 0) return locator.first();');
      lines.push('        } catch (Exception e) { /* Continue to next strategy */ }');
      lines.push('');
      lines.push('        // Strategy 7: Name attribute');
      lines.push('        try {');
      lines.push('            com.microsoft.playwright.Locator locator = getPage().locator("[name*=\'" + elementDescription.toLowerCase() + "\']");');
      lines.push('            if (locator.count() > 0) return locator.first();');
      lines.push('        } catch (Exception e) { /* Continue to next strategy */ }');
      lines.push('');
      lines.push('        // Strategy 8: Placeholder attribute (for inputs)');
      lines.push('        try {');
      lines.push('            com.microsoft.playwright.Locator locator = getPage().locator("[placeholder*=\'" + elementDescription + "\']");');
      lines.push('            if (locator.count() > 0) return locator.first();');
      lines.push('        } catch (Exception e) { /* Continue to next strategy */ }');
      lines.push('');
      lines.push('        // Strategy 9: Data attributes');
      lines.push('        try {');
      lines.push('            com.microsoft.playwright.Locator locator = getPage().locator("[data-testid*=\'" + elementDescription + "\'], [data-id*=\'" + elementDescription + "\'], [data-name*=\'" + elementDescription + "\']");');
      lines.push('            if (locator.count() > 0) return locator.first();');
      lines.push('        } catch (Exception e) { /* Continue to next strategy */ }');
      lines.push('');
      lines.push('        // Strategy 10: XPath with contains text (case-insensitive)');
      lines.push('        try {');
      lines.push('            String xpath = "//*[contains(translate(text(), \\\'ABCDEFGHIJKLMNOPQRSTUVWXYZ\\\', \\\'abcdefghijklmnopqrstuvwxyz\\\'), \\\'" + elementDescription.toLowerCase() + "\\\')]";');
      lines.push('            com.microsoft.playwright.Locator locator = getPage().locator(xpath);');
      lines.push('            if (locator.count() > 0) return locator.first();');
      lines.push('        } catch (Exception e) { /* Continue to next strategy */ }');
      lines.push('');
      lines.push('        // Strategy 11: Role-based with accessible name');
      lines.push('        try {');
      lines.push('            com.microsoft.playwright.Locator locator = getPage().getByRole(com.microsoft.playwright.options.AriaRole.BUTTON).filter(new com.microsoft.playwright.Locator.FilterOptions().setHasText(elementDescription));');
      lines.push('            if (locator.count() > 0) return locator.first();');
      lines.push('        } catch (Exception e) { /* Continue to next strategy */ }');
      lines.push('');
      lines.push('        // Strategy 12: Link role');
      lines.push('        try {');
      lines.push('            com.microsoft.playwright.Locator locator = getPage().getByRole(com.microsoft.playwright.options.AriaRole.LINK).filter(new com.microsoft.playwright.Locator.FilterOptions().setHasText(elementDescription));');
      lines.push('            if (locator.count() > 0) return locator.first();');
      lines.push('        } catch (Exception e) { /* Continue to next strategy */ }');
      lines.push('');
      lines.push('                // If all strategies fail, return a locator that will throw a descriptive error');
      lines.push('        return getPage().locator("body"); // This will fail with a clear error message');
    lines.push('    }');
    lines.push('');
    }
    // Note: autoHealLocator not generated for Selenium - use tryClickWithFallback instead
    lines.push('    // Helper method to try selectors with fallback and auto-healing');
    lines.push('    private boolean tryClickWithFallback(java.util.List<String> selectors, String elementDescription) {');
      if (isPlaywrightJava(framework)) {
        lines.push('        if (selectors == null || selectors.isEmpty()) {');
        lines.push('            selectors = new java.util.ArrayList<>();');
        lines.push('            selectors.add(elementDescription);');
        lines.push('        }');
        lines.push('        for (String selector : selectors) {');
        lines.push('            try {');
        lines.push('                // Wait for element to be visible and enabled before clicking');
        lines.push('                com.microsoft.playwright.Locator locator;');
        lines.push('                if (selector.startsWith("text=") || selector.startsWith("#") || selector.startsWith(".") || selector.startsWith("[") || selector.startsWith("role=")) {');
        lines.push('                    locator = getPage().locator(selector);');
        lines.push('                } else if (selector.startsWith("xpath=")) {');
        lines.push('                    locator = getPage().locator(selector.substring(6)); // Remove "xpath=" prefix');
        lines.push('                } else {');
        lines.push('                    locator = getPage().locator(selector);');
        lines.push('                }');
        lines.push('                // Wait for element to be visible and enabled');
                lines.push('                locator.waitFor(new com.microsoft.playwright.Locator.WaitForOptions().setState(com.microsoft.playwright.options.WaitForSelectorState.VISIBLE).setTimeout(10000));');
                lines.push('                ');
                lines.push('                // Detect if click causes navigation (pagination, links, etc.)');
                lines.push('                String urlBeforeClick = getPage().url();');
                lines.push('                ');
                lines.push('                // Perform the click');
        lines.push('                locator.click();');
                lines.push('                ');
                lines.push('                // Wait a bit for potential navigation to start');
                lines.push('                try {');
                lines.push('                    Thread.sleep(200);');
                lines.push('                } catch (InterruptedException e) {');
                lines.push('                    Thread.currentThread().interrupt();');
                lines.push('                }');
                lines.push('                ');
                lines.push('                // Check if navigation occurred');
                lines.push('                String urlAfterClick = getPage().url();');
                lines.push('                if (!urlBeforeClick.equals(urlAfterClick)) {');
                lines.push('                    // Navigation occurred - wait for page to stabilize');
                lines.push('                    System.out.println("[Click] Navigation detected after clicking, waiting for page to load...");');
                lines.push('                    getPage().waitForLoadState(com.microsoft.playwright.options.LoadState.DOMCONTENTLOADED, new com.microsoft.playwright.Page.WaitForLoadStateOptions().setTimeout(30000));');
                lines.push('                    // Wait for dynamic content to load (pagination, AJAX, etc.)');
                lines.push('                    try {');
                lines.push('                        Thread.sleep(1000);');
                lines.push('                    } catch (InterruptedException e) {');
                lines.push('                        Thread.currentThread().interrupt();');
                lines.push('                    }');
                lines.push('                    // Try to wait for network idle (but don\'t fail if it times out)');
                lines.push('                    try {');
                lines.push('                        getPage().waitForLoadState(com.microsoft.playwright.options.LoadState.NETWORKIDLE, new com.microsoft.playwright.Page.WaitForLoadStateOptions().setTimeout(5000));');
                lines.push('                    } catch (Exception e) {');
                lines.push('                        // Network idle timeout is OK - some sites have continuous activity');
                lines.push('                        System.out.println("[Click] Network idle timeout (expected for some sites), continuing...");');
                lines.push('                    }');
                lines.push('                    System.out.println("[Click] Page loaded after navigation to: " + getPage().url());');
                lines.push('                } else {');
                lines.push('                    // No navigation - just wait a bit for any dynamic updates');
                lines.push('                    try {');
                lines.push('                        Thread.sleep(500);');
                lines.push('                    } catch (InterruptedException e) {');
                lines.push('                        Thread.currentThread().interrupt();');
                lines.push('                    }');
                lines.push('                }');
        lines.push('                return true;');
        lines.push('            } catch (Exception e) {');
        lines.push('                // Try next selector');
        lines.push('                continue;');
        lines.push('            }');
        lines.push('        }');
        lines.push('        // Auto-healing: If all recorded selectors failed, try intelligent element discovery');
        lines.push('        try {');
        lines.push('            com.microsoft.playwright.Locator locator = autoHealLocator(elementDescription);');
        lines.push('            locator.waitFor(new com.microsoft.playwright.Locator.WaitForOptions().setState(com.microsoft.playwright.options.WaitForSelectorState.VISIBLE).setTimeout(10000));');
        lines.push('            ');
        lines.push('            // Detect if click causes navigation (pagination, links, etc.)');
        lines.push('            String urlBeforeClick = getPage().url();');
        lines.push('            ');
        lines.push('            // Perform the click');
        lines.push('            locator.click();');
        lines.push('            ');
        lines.push('            // Wait a bit for potential navigation to start');
        lines.push('            try {');
        lines.push('                Thread.sleep(200);');
        lines.push('            } catch (InterruptedException e) {');
        lines.push('                Thread.currentThread().interrupt();');
        lines.push('            }');
        lines.push('            ');
        lines.push('            // Check if navigation occurred');
        lines.push('            String urlAfterClick = getPage().url();');
        lines.push('            if (!urlBeforeClick.equals(urlAfterClick)) {');
        lines.push('                // Navigation occurred - wait for page to stabilize');
        lines.push('                System.out.println("[Click] Navigation detected after clicking, waiting for page to load...");');
        lines.push('                getPage().waitForLoadState(com.microsoft.playwright.options.LoadState.DOMCONTENTLOADED, new com.microsoft.playwright.Page.WaitForLoadStateOptions().setTimeout(30000));');
        lines.push('                // Wait for dynamic content to load (pagination, AJAX, etc.)');
        lines.push('                try {');
        lines.push('                    Thread.sleep(1000);');
        lines.push('                } catch (InterruptedException e) {');
        lines.push('                    Thread.currentThread().interrupt();');
        lines.push('                }');
        lines.push('                // Try to wait for network idle (but don\'t fail if it times out)');
        lines.push('                try {');
        lines.push('                    getPage().waitForLoadState(com.microsoft.playwright.options.LoadState.NETWORKIDLE, new com.microsoft.playwright.Page.WaitForLoadStateOptions().setTimeout(5000));');
        lines.push('                } catch (Exception e) {');
        lines.push('                    // Network idle timeout is OK - some sites have continuous activity');
        lines.push('                    System.out.println("[Click] Network idle timeout (expected for some sites), continuing...");');
        lines.push('                }');
        lines.push('                System.out.println("[Click] Page loaded after navigation to: " + getPage().url());');
        lines.push('            } else {');
        lines.push('                // No navigation - just wait a bit for any dynamic updates');
        lines.push('                try {');
        lines.push('                    Thread.sleep(500);');
        lines.push('                } catch (InterruptedException e) {');
        lines.push('                    Thread.currentThread().interrupt();');
        lines.push('                }');
        lines.push('            }');
        lines.push('            System.out.println("[Auto-Healing] Successfully found and clicked element: " + elementDescription);');
        lines.push('            return true;');
        lines.push('        } catch (Exception e) {');
        lines.push('            System.err.println("[Auto-Healing] Failed to find element: " + elementDescription + " - " + e.getMessage());');
        lines.push('            throw new RuntimeException("Could not find element: " + elementDescription, e);');
        lines.push('        }');
    } else {
      lines.push('        for (String selector : selectors) {');
      lines.push('            try {');
      lines.push('                if (selector.startsWith("#") || selector.startsWith(".") || selector.startsWith("[")) {');
      lines.push('                    getDriver().findElement(By.cssSelector(selector)).click();');
      lines.push('                    return true;');
      lines.push('                } else if (selector.startsWith("//") || selector.startsWith("xpath=")) {');
      lines.push('                    String xpath = selector.startsWith("xpath=") ? selector.substring(6) : selector;');
      lines.push('                    getDriver().findElement(By.xpath(xpath)).click();');
      lines.push('                    return true;');
      lines.push('                } else {');
      lines.push('                    getDriver().findElement(By.cssSelector(selector)).click();');
      lines.push('                    return true;');
      lines.push('                }');
      lines.push('            } catch (Exception e) {');
      lines.push('                // Try next selector');
      lines.push('                continue;');
      lines.push('            }');
      lines.push('        }');
      lines.push('        // If all selectors failed, try text-based fallback');
      lines.push('        try {');
      lines.push('            getDriver().findElement(By.xpath("//*[contains(text(), \'" + elementDescription + "\')]")).click();');
      lines.push('            return true;');
      lines.push('        } catch (Exception e) {');
      lines.push('            getDriver().findElement(By.partialLinkText(elementDescription)).click();');
      lines.push('            return true;');
      lines.push('        }');
    }
    lines.push('    }');
    lines.push('');
    
    // Auto-healing helper for input fields - only for Playwright
    if (isPlaywrightJava(framework)) {
      lines.push('    private com.microsoft.playwright.Locator autoHealInputLocator(String fieldDescription) {');
      lines.push('        // Strategy 1: Placeholder attribute');
      lines.push('        try {');
      lines.push('            com.microsoft.playwright.Locator locator = getPage().locator("[placeholder*=\'" + fieldDescription + "\']");');
      lines.push('            if (locator.count() > 0) return locator.first();');
      lines.push('        } catch (Exception e) { /* Continue */ }');
      lines.push('');
      lines.push('        // Strategy 2: Name attribute');
      lines.push('        try {');
      lines.push('            String nameNormalized = fieldDescription.toLowerCase().replaceAll("[^a-z0-9]", "");');
      lines.push('            com.microsoft.playwright.Locator locator = getPage().locator("[name*=\'" + nameNormalized + "\']");');
      lines.push('            if (locator.count() > 0) return locator.first();');
      lines.push('        } catch (Exception e) { /* Continue */ }');
      lines.push('');
      lines.push('        // Strategy 3: ID containing description');
      lines.push('        try {');
      lines.push('            String idNormalized = fieldDescription.toLowerCase().replaceAll("[^a-z0-9]", "");');
      lines.push('            com.microsoft.playwright.Locator locator = getPage().locator("input[id*=\'" + idNormalized + "\'], textarea[id*=\'" + idNormalized + "\']");');
      lines.push('            if (locator.count() > 0) return locator.first();');
      lines.push('        } catch (Exception e) { /* Continue */ }');
      lines.push('');
      lines.push('        // Strategy 4: Aria-label');
      lines.push('        try {');
      lines.push('            com.microsoft.playwright.Locator locator = getPage().locator("input[aria-label*=\'" + fieldDescription + "\'], textarea[aria-label*=\'" + fieldDescription + "\']");');
      lines.push('            if (locator.count() > 0) return locator.first();');
      lines.push('        } catch (Exception e) { /* Continue */ }');
      lines.push('');
      lines.push('        // Strategy 5: Label text (find label, then associated input)');
      lines.push('        try {');
      lines.push('            com.microsoft.playwright.Locator label = getPage().locator("label:has-text(\\\'" + fieldDescription + "\\\')");');
      lines.push('            if (label.count() > 0) {');
      lines.push('                String forAttr = label.first().getAttribute("for");');
      lines.push('                if (forAttr != null && !forAttr.isEmpty()) {');
      lines.push('                    com.microsoft.playwright.Locator input = getPage().locator("#" + forAttr);');
      lines.push('                    if (input.count() > 0) return input.first();');
      lines.push('                }');
      lines.push('            }');
      lines.push('        } catch (Exception e) { /* Continue */ }');
      lines.push('');
      lines.push('        // Strategy 6: Textbox role');
      lines.push('        try {');
      lines.push('            com.microsoft.playwright.Locator locator = getPage().getByRole(com.microsoft.playwright.options.AriaRole.TEXTBOX).filter(new com.microsoft.playwright.Locator.FilterOptions().setHasText(fieldDescription));');
      lines.push('            if (locator.count() > 0) return locator.first();');
      lines.push('        } catch (Exception e) { /* Continue */ }');
      lines.push('');
      lines.push('        // Strategy 7: Data attributes');
      lines.push('        try {');
      lines.push('            com.microsoft.playwright.Locator locator = getPage().locator("input[data-testid*=\'" + fieldDescription + "\'], input[data-name*=\'" + fieldDescription + "\']");');
      lines.push('            if (locator.count() > 0) return locator.first();');
      lines.push('        } catch (Exception e) { /* Continue */ }');
      lines.push('');
      lines.push('        // Strategy 8: Type attribute (email, password, text, etc.)');
      lines.push('        try {');
      lines.push('            String normalized = fieldDescription.toLowerCase();');
      lines.push('            if (normalized.contains("email") || normalized.contains("mail")) {');
      lines.push('                com.microsoft.playwright.Locator locator = getPage().locator("input[type=\\\'email\\\']");');
      lines.push('                if (locator.count() > 0) return locator.first();');
      lines.push('            } else if (normalized.contains("password") || normalized.contains("pwd")) {');
      lines.push('                com.microsoft.playwright.Locator locator = getPage().locator("input[type=\\\'password\\\']");');
      lines.push('                if (locator.count() > 0) return locator.first();');
      lines.push('            } else if (normalized.contains("search")) {');
      lines.push('                com.microsoft.playwright.Locator locator = getPage().locator("input[type=\\\'search\\\']");');
      lines.push('                if (locator.count() > 0) return locator.first();');
      lines.push('            }');
      lines.push('        } catch (Exception e) { /* Continue */ }');
      lines.push('');
      lines.push('        return getPage().locator("body"); // Fallback');
    lines.push('    }');
    lines.push('');
    }
    // Note: autoHealInputLocator not generated for Selenium - use tryFillWithFallback instead
    lines.push('    // Helper method for fill operations with auto-healing');
    lines.push('    private boolean tryFillWithFallback(java.util.List<String> selectors, String value, String elementDescription) {');
      if (isPlaywrightJava(framework)) {
        lines.push('        if (selectors == null || selectors.isEmpty()) {');
        lines.push('            selectors = new java.util.ArrayList<>();');
        lines.push('            selectors.add(elementDescription);');
        lines.push('        }');
        lines.push('        for (String selector : selectors) {');
        lines.push('            try {');
        lines.push('                com.microsoft.playwright.Locator locator;');
        lines.push('                if (selector.startsWith("text=") || selector.startsWith("#") || selector.startsWith(".") || selector.startsWith("[") || selector.startsWith("role=")) {');
        lines.push('                    locator = getPage().locator(selector);');
        lines.push('                } else if (selector.startsWith("xpath=")) {');
        lines.push('                    locator = getPage().locator(selector.substring(6));');
        lines.push('                } else {');
        lines.push('                    locator = getPage().locator(selector);');
        lines.push('                }');
        lines.push('                // Wait for element to be visible and enabled');
        lines.push('                locator.waitFor(new com.microsoft.playwright.Locator.WaitForOptions().setState(com.microsoft.playwright.options.WaitForSelectorState.VISIBLE).setTimeout(10000));');
        lines.push('                locator.fill(value);');
        lines.push('                return true;');
        lines.push('            } catch (Exception e) {');
        lines.push('                continue;');
        lines.push('            }');
        lines.push('        }');
        lines.push('        // Auto-healing: If all recorded selectors failed, try intelligent element discovery');
        lines.push('        try {');
        lines.push('            com.microsoft.playwright.Locator locator = autoHealInputLocator(elementDescription);');
        lines.push('            locator.waitFor(new com.microsoft.playwright.Locator.WaitForOptions().setState(com.microsoft.playwright.options.WaitForSelectorState.VISIBLE).setTimeout(10000));');
        lines.push('            locator.fill(value);');
        lines.push('            System.out.println("[Auto-Healing] Successfully found and filled field: " + elementDescription);');
        lines.push('            return true;');
        lines.push('        } catch (Exception e) {');
        lines.push('            System.err.println("[Auto-Healing] Failed to find input field: " + elementDescription + " - " + e.getMessage());');
        lines.push('            throw new RuntimeException("Could not find input field: " + elementDescription, e);');
        lines.push('        }');
    } else {
      lines.push('        for (String selector : selectors) {');
      lines.push('            try {');
      lines.push('                WebElement field;');
      lines.push('                if (selector.startsWith("#") || selector.startsWith(".") || selector.startsWith("[")) {');
      lines.push('                    field = getDriver().findElement(By.cssSelector(selector));');
      lines.push('                } else if (selector.startsWith("//") || selector.startsWith("xpath=")) {');
      lines.push('                    String xpath = selector.startsWith("xpath=") ? selector.substring(6) : selector;');
      lines.push('                    field = getDriver().findElement(By.xpath(xpath));');
      lines.push('                } else {');
      lines.push('                    field = getDriver().findElement(By.cssSelector(selector));');
      lines.push('                }');
      lines.push('                field.clear();');
      lines.push('                field.sendKeys(value);');
      lines.push('                return true;');
      lines.push('            } catch (Exception e) {');
      lines.push('                continue;');
      lines.push('            }');
      lines.push('        }');
      lines.push('        // Fallback');
      lines.push('        try {');
      lines.push('            WebElement field = new WebDriverWait(getDriver(), Duration.ofSeconds(10))');
      lines.push('                .until(ExpectedConditions.presenceOfElementLocated(By.xpath("//input[contains(@placeholder, \'" + elementDescription + "\') or contains(@name, \'" + elementDescription + "\')]")));');
      lines.push('            field.clear();');
      lines.push('            field.sendKeys(value);');
      lines.push('            return true;');
      lines.push('        } catch (Exception e) {');
      lines.push('            getDriver().findElement(By.id(elementDescription.toLowerCase().replace(" ", ""))).sendKeys(value);');
      lines.push('            return true;');
      lines.push('        }');
    }
    lines.push('    }');
    lines.push('');
    
    // Helper method for visibility checks with auto-healing
    lines.push('    private boolean tryCheckVisibleWithFallback(java.util.List<String> selectors, String elementDescription) {');
    if (isPlaywrightJava(framework)) {
      lines.push('        if (selectors == null || selectors.isEmpty()) {');
      lines.push('            selectors = new java.util.ArrayList<>();');
      lines.push('            selectors.add(elementDescription);');
      lines.push('        }');
      lines.push('        for (String selector : selectors) {');
      lines.push('            try {');
      lines.push('                com.microsoft.playwright.Locator locator;');
      lines.push('                if (selector.startsWith("text=") || selector.startsWith("#") || selector.startsWith(".") || selector.startsWith("[") || selector.startsWith("role=")) {');
      lines.push('                    locator = getPage().locator(selector);');
      lines.push('                } else if (selector.startsWith("xpath=")) {');
      lines.push('                    locator = getPage().locator(selector.substring(6));');
      lines.push('                } else {');
      lines.push('                    locator = getPage().locator(selector);');
      lines.push('                }');
      lines.push('                // Wait for element to be visible');
      lines.push('                locator.waitFor(new com.microsoft.playwright.Locator.WaitForOptions().setState(com.microsoft.playwright.options.WaitForSelectorState.VISIBLE).setTimeout(10000));');
      lines.push('                com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(locator).isVisible();');
      lines.push('                return true;');
      lines.push('            } catch (Exception e) {');
      lines.push('                continue;');
      lines.push('            }');
      lines.push('        }');
      lines.push('        // Auto-healing: If all recorded selectors failed, try intelligent element discovery');
      lines.push('        try {');
      lines.push('            com.microsoft.playwright.Locator locator = autoHealLocator(elementDescription);');
      lines.push('            locator.waitFor(new com.microsoft.playwright.options.WaitForOptions().setState(com.microsoft.playwright.options.WaitForSelectorState.VISIBLE).setTimeout(10000));');
      lines.push('            com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(locator).isVisible();');
      lines.push('            System.out.println("[Auto-Healing] Successfully found and verified visibility: " + elementDescription);');
      lines.push('            return true;');
      lines.push('        } catch (Exception e) {');
      lines.push('            System.err.println("[Auto-Healing] Failed to find element for visibility check: " + elementDescription + " - " + e.getMessage());');
      lines.push('            throw new RuntimeException("Could not verify visibility of element: " + elementDescription, e);');
      lines.push('        }');
    } else {
      lines.push('        for (String selector : selectors) {');
      lines.push('            try {');
      lines.push('                WebElement element = getDriver().findElement(By.cssSelector(selector));');
      lines.push('                assertTrue(element.isDisplayed());');
      lines.push('                return true;');
      lines.push('            } catch (Exception e) {');
      lines.push('                continue;');
      lines.push('            }');
      lines.push('        }');
      lines.push('        // Fallback');
      lines.push('        WebElement element = getDriver().findElement(By.xpath("//*[contains(text(), \'" + elementDescription + "\')]"));');
      lines.push('        assertTrue(element.isDisplayed());');
      lines.push('        return true;');
    }
    lines.push('    }');
    lines.push('');
  }
  
  // Add page object instances if page objects are used
  if (hasPageObjects && pageObjectsMap.size > 0) {
    pageObjectsMap.forEach((_, pageName) => {
      const pageVarName = pageName.charAt(0).toLowerCase() + pageName.slice(1) + 'Page';
      if (isPlaywrightJava(framework)) {
        lines.push(`    private ${pageName}Page ${pageVarName} = new ${pageName}Page(getPage());`);
      } else {
        lines.push(`    private ${pageName}Page ${pageVarName} = new ${pageName}Page(getDriver());`);
      }
    });
    lines.push('');
  }
  
  // Navigation steps (optimized - using helper functions)
  if (stepDefMap['Given I Am On {string}']) {
    lines.push('    @Given("I Am On {string}")');
    lines.push('    public void iAmOnPage(String pageName) {');
    if (isPlaywrightJava(framework)) {
      lines.push('        // Extract URL from page name');
    }
    lines.push(...generatePageUrlMappingCode(baseUrl).split('\n'));
    lines.push(`        ${getNavigationAction(framework)}`);
    lines.push('    }');
    lines.push('');
  }
  
  if (stepDefMap['And I Navigate To {string}']) {
    lines.push('    @And("I Navigate To {string}")');
    lines.push('    public void iNavigateToPage(String pageName) {');
    lines.push(...generatePageUrlMappingCode(baseUrl, 'pageName').split('\n'));
    lines.push(`        ${getNavigationAction(framework)}`);
    lines.push('    }');
    lines.push('');
  }
  
  // Standard Navigation step - Always included
  if (stepDefMap['Given I navigate to {string}']) {
    lines.push('    @Given("I navigate to {string}")');
    lines.push('    public void iNavigateToUrl(String url) {');
    lines.push(`        ${getNavigationAction(framework)}`);
    lines.push('    }');
    lines.push('');
  }
  
  // Standard Click steps - Always included (optimized)
  // Enhanced to use page objects when pageName/elementName are available
  const getClickAction = (step) => {
    if (hasPageObjects && step && step.pageName && step.elementName) {
      const pageVarName = step.pageName.charAt(0).toLowerCase() + step.pageName.slice(1) + 'Page';
      const elementMethodName = toCamelCase(step.elementName);
      // Use page object method if available
      return `${pageVarName}.click${capitalize(elementMethodName)}();`;
    }
    // Fallback to raw selector
    return isPlaywrightJava(framework) 
      ? 'getPage().click(selector);' 
      : 'getDriver().findElement(By.cssSelector(selector)).click();';
  };
  
  // Generate "I click {string}" step - only once, prefer "When" over "And"
  if (stepDefMap['When I click {string}'] || stepDefMap['And I click {string}']) {
    if (!isStepGenerated('I click {string}')) {
      const useWhen = stepDefMap['When I click {string}'];
      lines.push(`    @${useWhen ? 'When' : 'And'}("I click {string}")`);
      lines.push('    public void iClick(String selector) {');
      // Try to find matching step with page object, otherwise use selector
      const matchingStep = steps.find(s => s.kind === 'click' && (s.selector === 'selector' || s.selector));
      if (matchingStep && hasPageObjects && matchingStep.pageName && matchingStep.elementName) {
        const pageVarName = matchingStep.pageName.charAt(0).toLowerCase() + matchingStep.pageName.slice(1) + 'Page';
        const elementMethodName = toCamelCase(matchingStep.elementName);
        lines.push(`        ${pageVarName}.click${capitalize(elementMethodName)}();`);
      } else {
        if (isPlaywrightJava(framework)) {
          lines.push('        // Detect if click causes navigation (pagination, links, etc.)');
          lines.push('        String urlBeforeClick = getPage().url();');
          lines.push('        ');
          lines.push('        // Perform the click');
          lines.push('        getPage().click(selector);');
          lines.push('        ');
          lines.push('        // Wait a bit for potential navigation to start');
          lines.push('        try {');
          lines.push('            Thread.sleep(200);');
          lines.push('        } catch (InterruptedException e) {');
          lines.push('            Thread.currentThread().interrupt();');
          lines.push('        }');
          lines.push('        ');
          lines.push('        // Check if navigation occurred');
          lines.push('        String urlAfterClick = getPage().url();');
          lines.push('        if (!urlBeforeClick.equals(urlAfterClick)) {');
          lines.push('            // Navigation occurred - wait for page to stabilize');
          lines.push('            System.out.println("[Click] Navigation detected after clicking, waiting for page to load...");');
          lines.push('            getPage().waitForLoadState(com.microsoft.playwright.options.LoadState.DOMCONTENTLOADED, new com.microsoft.playwright.Page.WaitForLoadStateOptions().setTimeout(30000));');
          lines.push('            // Wait for dynamic content to load (pagination, AJAX, etc.)');
          lines.push('            try {');
          lines.push('                Thread.sleep(1000);');
          lines.push('            } catch (InterruptedException e) {');
          lines.push('                Thread.currentThread().interrupt();');
          lines.push('            }');
          lines.push('            // Try to wait for network idle (but don\'t fail if it times out)');
          lines.push('            try {');
          lines.push('                getPage().waitForLoadState(com.microsoft.playwright.options.LoadState.NETWORKIDLE, new com.microsoft.playwright.Page.WaitForLoadStateOptions().setTimeout(5000));');
          lines.push('            } catch (Exception e) {');
          lines.push('                // Network idle timeout is OK - some sites have continuous activity');
          lines.push('                System.out.println("[Click] Network idle timeout (expected for some sites), continuing...");');
          lines.push('            }');
          lines.push('            System.out.println("[Click] Page loaded after navigation to: " + getPage().url());');
          lines.push('        } else {');
          lines.push('            // No navigation - just wait a bit for any dynamic updates');
          lines.push('            try {');
          lines.push('                Thread.sleep(500);');
          lines.push('            } catch (InterruptedException e) {');
          lines.push('                Thread.currentThread().interrupt();');
          lines.push('            }');
          lines.push('        }');
        } else {
          // Selenium: route through tryClickWithFallback when the recorder
          // captured fallback selectors for this primary, otherwise fall back
          // to single-shot. This is the runtime arm of self-healing locators.
          if (selectorMap.size > 0) {
            lines.push('        // Self-healing: walk the recorded fallback chain when available');
            lines.push('        java.util.List<String> selectors = SELECTOR_FALLBACKS_BY_PRIMARY.get(selector);');
            lines.push('        if (selectors == null || selectors.isEmpty()) {');
            lines.push('            selectors = new java.util.ArrayList<>();');
            lines.push('            selectors.add(selector);');
            lines.push('        }');
            lines.push('        tryClickWithFallback(selectors, selector);');
          } else {
            lines.push('        // Detect if click causes navigation (pagination, links, etc.)');
            lines.push('        String urlBeforeClick = getDriver().getCurrentUrl();');
            lines.push('        ');
            lines.push('        // Perform the click');
            lines.push('        getDriver().findElement(By.cssSelector(selector)).click();');
            lines.push('        ');
            lines.push('        // Wait a bit for potential navigation to start');
            lines.push('        try {');
            lines.push('            Thread.sleep(200);');
            lines.push('        } catch (InterruptedException e) {');
            lines.push('            Thread.currentThread().interrupt();');
            lines.push('        }');
            lines.push('        ');
            lines.push('        // Check if navigation occurred');
            lines.push('        String urlAfterClick = getDriver().getCurrentUrl();');
            lines.push('        if (!urlBeforeClick.equals(urlAfterClick)) {');
            lines.push('            // Navigation occurred - wait for page to load');
            lines.push('            System.out.println("[Click] Navigation detected after clicking, waiting for page to load...");');
            lines.push('            // Wait for page to load (check for document.readyState)');
            lines.push('            org.openqa.selenium.support.ui.WebDriverWait wait = new org.openqa.selenium.support.ui.WebDriverWait(getDriver(), java.time.Duration.ofSeconds(30));');
            lines.push('            wait.until(webDriver -> ((org.openqa.selenium.JavascriptExecutor) webDriver).executeScript("return document.readyState").equals("complete"));');
            lines.push('            // Wait for dynamic content to load (pagination, AJAX, etc.)');
            lines.push('            try {');
            lines.push('                Thread.sleep(1000);');
            lines.push('            } catch (InterruptedException e) {');
            lines.push('                Thread.currentThread().interrupt();');
            lines.push('            }');
            lines.push('            System.out.println("[Click] Page loaded after navigation to: " + getDriver().getCurrentUrl());');
            lines.push('        } else {');
            lines.push('            // No navigation - just wait a bit for any dynamic updates');
            lines.push('            try {');
            lines.push('                Thread.sleep(500);');
            lines.push('            } catch (InterruptedException e) {');
            lines.push('                Thread.currentThread().interrupt();');
            lines.push('            }');
            lines.push('        }');
          }
        }
      }
      lines.push('    }');
      lines.push('');
      markStepGenerated('I click {string}', useWhen ? 'When' : 'And');
    }
  }
  
  // Click steps with capital C - generate all variations (@Given, @When, @And)
  // Note: normalizePattern will treat "I Click" and "I click" as the same
  const hasClickCapitalC = stepDefMap['When I Click {string}'] || stepDefMap['Given I Click {string}'] || stepDefMap['And I Click {string}'];
  if (hasClickCapitalC && !isStepGenerated('I Click {string}')) {
    const annotations = [];
    if (stepDefMap['Given I Click {string}']) annotations.push('Given');
    if (stepDefMap['When I Click {string}']) annotations.push('When');
    if (stepDefMap['And I Click {string}']) annotations.push('And');
    
    annotations.forEach(ann => {
      lines.push(`    @${ann}("I Click {string}")`);
    });
    lines.push('    public void iClickElement(String elementDescription) {');
    if (selectorMap.size > 0) {
      lines.push('        // Look up selectors with fallbacks from recorded steps');
      lines.push('        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());');
      lines.push('        if (selectors.isEmpty()) {');
      lines.push('            // No recorded selectors, create default list with description');
      lines.push('            selectors = new java.util.ArrayList<>();');
      lines.push('            selectors.add(elementDescription);');
      lines.push('        }');
      lines.push('        tryClickWithFallback(selectors, elementDescription);');
    } else {
      // Fallback if no selector map
      if (framework === 'playwright-java') {
        lines.push('        try {');
        lines.push('            getPage().locator("text=" + elementDescription).click();');
        lines.push('        } catch (Exception e) {');
        lines.push('            getPage().locator("[aria-label*=\'" + elementDescription + "\'], button:has-text(\'" + elementDescription + "\'), a:has-text(\'" + elementDescription + "\')").first().click();');
        lines.push('        }');
      } else {
        lines.push('        try {');
        lines.push('            getDriver().findElement(By.xpath("//*[contains(text(), \'" + elementDescription + "\')]")).click();');
        lines.push('        } catch (Exception e) {');
        lines.push('            getDriver().findElement(By.partialLinkText(elementDescription)).click();');
        lines.push('        }');
      }
    }
    lines.push('    }');
    lines.push('');
    markStepGenerated('I Click {string}', annotations[0] || 'When');
  }
  
  if (stepDefMap['Then Click {string} On {string}'] && !isStepGenerated('Click {string} On {string}')) {
    lines.push('    @Then("Click {string} On {string}")');
    lines.push('    public void clickElementOnPage(String elementDescription, String pageName) {');
    if (framework === 'playwright-java') {
      lines.push('        try {');
      lines.push('            getPage().locator("text=" + elementDescription).click();');
      lines.push('        } catch (Exception e) {');
      lines.push('            getPage().locator("[aria-label*=\'" + elementDescription + "\'], button:has-text(\'" + elementDescription + "\'), a:has-text(\'" + elementDescription + "\')").click();');
      lines.push('        }');
    } else {
      lines.push('        try {');
      lines.push('            getDriver().findElement(By.xpath("//*[contains(text(), \'" + elementDescription + "\')]")).click();');
      lines.push('        } catch (Exception e) {');
      lines.push('            getDriver().findElement(By.partialLinkText(elementDescription)).click();');
      lines.push('        }');
    }
    lines.push('    }');
    lines.push('');
  }
  
  // Standard Typing steps - Always included (optimized)
  // Enhanced to use page objects when pageName/elementName are available
  // Generate "I type {string} into {string}" step - only once, prefer "When" over "And"
  if (stepDefMap['When I type {string} into {string}'] || stepDefMap['And I type {string} into {string}']) {
    if (!isStepGenerated('I type {string} into {string}')) {
      const useWhen = stepDefMap['When I type {string} into {string}'];
      lines.push(`    @${useWhen ? 'When' : 'And'}("I type {string} into {string}")`);
      lines.push('    public void iTypeInto(String value, String selector) {');
      const matchingStep = steps.find(s => s.kind === 'type' && (s.selector === 'selector' || s.selector));
      if (matchingStep && hasPageObjects && matchingStep.pageName && matchingStep.elementName) {
        const pageVarName = matchingStep.pageName.charAt(0).toLowerCase() + matchingStep.pageName.slice(1) + 'Page';
        const elementMethodName = toCamelCase(matchingStep.elementName);
        lines.push(`        ${pageVarName}.type${capitalize(elementMethodName)}(value);`);
      } else {
        if (isPlaywrightJava(framework)) {
          lines.push('        getPage().fill(selector, value);');
        } else if (selectorMap.size > 0) {
          // Selenium with healing: walk the recorded fallback chain on type too.
          lines.push('        java.util.List<String> selectors = SELECTOR_FALLBACKS_BY_PRIMARY.get(selector);');
          lines.push('        if (selectors == null || selectors.isEmpty()) {');
          lines.push('            selectors = new java.util.ArrayList<>();');
          lines.push('            selectors.add(selector);');
          lines.push('        }');
          lines.push('        org.openqa.selenium.support.ui.WebDriverWait wait = new org.openqa.selenium.support.ui.WebDriverWait(getDriver(), java.time.Duration.ofSeconds(15));');
          lines.push('        WebElement input = null;');
          lines.push('        for (String candidate : selectors) {');
          lines.push('            try {');
          lines.push('                if (candidate.startsWith("//") || candidate.startsWith("(//") || candidate.startsWith("xpath=")) {');
          lines.push('                    String xp = candidate.startsWith("xpath=") ? candidate.substring(6) : candidate;');
          lines.push('                    input = wait.until(org.openqa.selenium.support.ui.ExpectedConditions.visibilityOfElementLocated(By.xpath(xp)));');
          lines.push('                } else {');
          lines.push('                    input = wait.until(org.openqa.selenium.support.ui.ExpectedConditions.visibilityOfElementLocated(By.cssSelector(candidate)));');
          lines.push('                }');
          lines.push('                if (input != null) break;');
          lines.push('            } catch (Exception ignored) { /* try next candidate */ }');
          lines.push('        }');
          lines.push('        if (input == null) {');
          lines.push('            throw new RuntimeException("[Type] All recorded selectors failed for: " + selector);');
          lines.push('        }');
          lines.push('        input.clear();');
          lines.push('        input.sendKeys(value);');
        } else {
          lines.push('        WebElement input = getDriver().findElement(By.cssSelector(selector));');
          lines.push('        input.clear();');
          lines.push('        input.sendKeys(value);');
        }
      }
      lines.push('    }');
      lines.push('');
      markStepGenerated('I type {string} into {string}', useWhen ? 'When' : 'And');
    }
  }
  
  // Typing steps with capital E - generate all variations (@Given, @When, @And)
  // Note: These are different patterns ("Enter ... In" vs "type ... into"), so both can exist
  const hasEnterCapitalE = stepDefMap['Given I Enter {string} In {string}'] || stepDefMap['When I Enter {string} In {string}'] || stepDefMap['And I Enter {string} In {string}'];
  if (hasEnterCapitalE && !isStepGenerated('I Enter {string} In {string}')) {
    const annotations = [];
    if (stepDefMap['Given I Enter {string} In {string}']) annotations.push('Given');
    if (stepDefMap['When I Enter {string} In {string}']) annotations.push('When');
    if (stepDefMap['And I Enter {string} In {string}']) annotations.push('And');
    
    annotations.forEach(ann => {
      lines.push(`    @${ann}("I Enter {string} In {string}")`);
    });
    lines.push('    public void iEnterValueInField(String value, String fieldDescription) {');
    if (selectorMap.size > 0) {
      lines.push('        // Look up selectors with fallbacks from recorded steps');
      lines.push('        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(fieldDescription, new java.util.ArrayList<>());');
      lines.push('        if (selectors.isEmpty()) {');
      lines.push('            // No recorded selectors, create default list with description');
      lines.push('            selectors = new java.util.ArrayList<>();');
      lines.push('            selectors.add(fieldDescription);');
      lines.push('        }');
      lines.push('        tryFillWithFallback(selectors, value, fieldDescription);');
    } else {
      // Fallback if no selector map
      if (framework === 'playwright-java') {
        lines.push('        try {');
        lines.push('            getPage().locator("[placeholder*=\'" + fieldDescription + "\'], [name*=\'" + fieldDescription + "\'], [aria-label*=\'" + fieldDescription + "\']").fill(value);');
        lines.push('        } catch (Exception e) {');
        lines.push('            getPage().locator(fieldDescription).fill(value);');
        lines.push('        }');
      } else {
        lines.push('        try {');
        lines.push('            WebElement field = new org.openqa.selenium.support.ui.WebDriverWait(getDriver(), java.time.Duration.ofSeconds(10))');
        lines.push('                .until(org.openqa.selenium.support.ui.ExpectedConditions.presenceOfElementLocated(By.xpath("//input[contains(@placeholder, \'" + fieldDescription + "\') or contains(@name, \'" + fieldDescription + "\')]")));');
        lines.push('            field.clear();');
        lines.push('            field.sendKeys(value);');
        lines.push('        } catch (Exception e) {');
        lines.push('            getDriver().findElement(By.id(fieldDescription.toLowerCase().replace(" ", ""))).sendKeys(value);');
        lines.push('        }');
      }
    }
    lines.push('    }');
    lines.push('');
    markStepGenerated('I Enter {string} In {string}', annotations[0] || 'And');
  }
  
  // Form group step
  if (stepDefMap['Then Enter {string} On {string}'] && !isStepGenerated('Enter {string} On {string}')) {
    lines.push('    @Then("Enter {string} On {string}")');
    lines.push('    public void enterFormDetailsOnPage(String formDescription, String pageName) {');
    const allFormGroups = groupedActions.filter(a => a.kind === 'formGroup');
    if (allFormGroups.length > 0) {
      allFormGroups.forEach((formGroup, idx) => {
        const condition = idx === 0 ? 'if' : 'else if';
        const formDesc = formGroup.formDescription.replace(/'/g, "\\'");
        const pageNameVal = formGroup.pageContext ? formGroup.pageContext.replace(/'/g, "\\'") : '';
        lines.push(`        ${condition} (formDescription.equals("${formDesc}") && pageName.equals("${pageNameVal}")) {`);
        formGroup.actions.forEach((fieldAction) => {
          const selector = fieldAction.selector || '';
          const value = (fieldAction.value || '').replace(/"/g, '\\"').replace(/\n/g, '\\n');
          if (selector && value) {
            if (framework === 'playwright-java') {
              lines.push(`            getPage().locator(${JSON.stringify(selector)}).fill(${JSON.stringify(value)});`);
            } else {
              lines.push(`            getDriver().findElement(By.cssSelector(${JSON.stringify(selector)})).sendKeys(${JSON.stringify(value)});`);
            }
          }
        });
        lines.push('        }');
      });
    }
    if (framework === 'playwright-java') {
      lines.push('        getPage().waitForLoadState(com.microsoft.playwright.options.LoadState.NETWORKIDLE);');
    } else {
      lines.push('        try { Thread.sleep(1000); } catch (Exception e) {}');
    }
    lines.push('    }');
    lines.push('');
  }
  
  // Double Click
  if (stepDefMap['And I double click {string}']) {
    lines.push('    @And("I double click {string}")');
    lines.push('    public void iDoubleClickElement(String elementDescription) {');
    if (framework === 'playwright-java') {
      lines.push('        try {');
      lines.push('            getPage().locator("text=" + elementDescription).dblclick();');
      lines.push('        } catch (Exception e) {');
      lines.push('            getPage().locator("[aria-label*=\'" + elementDescription + "\'], button:has-text(\'" + elementDescription + "\')").dblclick();');
      lines.push('        }');
    } else {
      lines.push('        try {');
      lines.push('            WebElement element = getDriver().findElement(By.xpath("//*[contains(text(), \'" + elementDescription + "\')]"));');
      lines.push('            org.openqa.selenium.interactions.Actions actions = new org.openqa.selenium.interactions.Actions(getDriver());');
      lines.push('            actions.doubleClick(element).perform();');
      lines.push('        } catch (Exception e) {');
      lines.push('            WebElement element = getDriver().findElement(By.partialLinkText(elementDescription));');
      lines.push('            org.openqa.selenium.interactions.Actions actions = new org.openqa.selenium.interactions.Actions(getDriver());');
      lines.push('            actions.doubleClick(element).perform();');
      lines.push('        }');
    }
    lines.push('    }');
    lines.push('');
  }
  
  // Select dropdown - Generate only once, prefer "When" over "And"
  if ((stepDefMap['When I select {string} from {string}'] || stepDefMap['And I select {string} from {string}']) && 
      !isStepGenerated('I select {string} from {string}')) {
    const useWhen = stepDefMap['When I select {string} from {string}'];
    lines.push(`    @${useWhen ? 'When' : 'And'}("I select {string} from {string}")`);
    lines.push('    public void iSelectFromDropdown(String value, String selector) {');
    if (framework === 'playwright-java') {
      lines.push('        getPage().selectOption(selector, value);');
    } else {
      lines.push('        WebElement select = getDriver().findElement(By.cssSelector(selector));');
      lines.push('        new org.openqa.selenium.support.ui.Select(select).selectByVisibleText(value);');
    }
    lines.push('    }');
    lines.push('');
    markStepGenerated('I select {string} from {string}', useWhen ? 'When' : 'And');
  }
  
  // Select dropdown - Legacy regex pattern (for backward compatibility)
  // Only generate if the standard version wasn't already generated
  if (stepDefMap['And I select {string} from {string} (regex)'] && 
      !isStepGenerated('I select {string} from {string}')) {
    lines.push('    @And("I select {string} from {string}")');
    lines.push('    public void iSelectFromDropdownLegacy(String value, String dropdownDescription) {');
    if (framework === 'playwright-java') {
      lines.push('        try {');
      lines.push('            getPage().locator("[aria-label*=\'" + dropdownDescription + "\'], [name*=\'" + dropdownDescription + "\'], select:has-text(\'" + dropdownDescription + "\')").selectOption(value);');
      lines.push('        } catch (Exception e) {');
      lines.push('            getPage().locator(dropdownDescription).selectOption(value);');
      lines.push('        }');
    } else {
      lines.push('        try {');
      lines.push('            WebElement select = getDriver().findElement(By.xpath("//select[contains(@aria-label, \'" + dropdownDescription + "\') or contains(@name, \'" + dropdownDescription + "\')]"));');
      lines.push('            org.openqa.selenium.support.ui.Select dropdown = new org.openqa.selenium.support.ui.Select(select);');
      lines.push('            dropdown.selectByVisibleText(value);');
      lines.push('        } catch (Exception e) {');
      lines.push('            WebElement select = getDriver().findElement(By.cssSelector(dropdownDescription));');
      lines.push('            org.openqa.selenium.support.ui.Select dropdown = new org.openqa.selenium.support.ui.Select(select);');
      lines.push('            dropdown.selectByVisibleText(value);');
      lines.push('        }');
    }
    lines.push('    }');
    lines.push('');
  }
  
  // Check checkbox
  if (stepDefMap['And I check {string}']) {
    lines.push('    @And("I check {string}")');
    lines.push('    public void iCheckCheckbox(String checkboxDescription) {');
    if (framework === 'playwright-java') {
      lines.push('        try {');
      lines.push('            getPage().locator("[aria-label*=\'" + checkboxDescription + "\'], [name*=\'" + checkboxDescription + "\'], label:has-text(\'" + checkboxDescription + "\') input[type=\\"checkbox\\"]").check();');
      lines.push('        } catch (Exception e) {');
      lines.push('            getPage().locator(checkboxDescription).check();');
      lines.push('        }');
    } else {
      lines.push('        try {');
      lines.push('            WebElement checkbox = getDriver().findElement(By.xpath("//input[@type=\\"checkbox\\" and (contains(@aria-label, \'" + checkboxDescription + "\') or contains(@name, \'" + checkboxDescription + "\'))]"));');
      lines.push('            if (!checkbox.isSelected()) checkbox.click();');
      lines.push('        } catch (Exception e) {');
      lines.push('            getDriver().findElement(By.cssSelector(checkboxDescription)).click();');
      lines.push('        }');
    }
    lines.push('    }');
    lines.push('');
  }
  
  // Uncheck checkbox
  if (stepDefMap['And I uncheck {string}']) {
    lines.push('    @And("I uncheck {string}")');
    lines.push('    public void iUncheckCheckbox(String checkboxDescription) {');
    if (framework === 'playwright-java') {
      lines.push('        try {');
      lines.push('            getPage().locator("[aria-label*=\'" + checkboxDescription + "\'], [name*=\'" + checkboxDescription + "\'], label:has-text(\'" + checkboxDescription + "\') input[type=\\"checkbox\\"]").uncheck();');
      lines.push('        } catch (Exception e) {');
      lines.push('            getPage().locator(checkboxDescription).uncheck();');
      lines.push('        }');
    } else {
      lines.push('        try {');
      lines.push('            WebElement checkbox = getDriver().findElement(By.xpath("//input[@type=\\"checkbox\\" and (contains(@aria-label, \'" + checkboxDescription + "\') or contains(@name, \'" + checkboxDescription + "\'))]"));');
      lines.push('            if (checkbox.isSelected()) checkbox.click();');
      lines.push('        } catch (Exception e) {');
      lines.push('            getDriver().findElement(By.cssSelector(checkboxDescription)).click();');
      lines.push('        }');
    }
    lines.push('    }');
    lines.push('');
  }
  
  // Select radio button
  if (stepDefMap['And I select radio {string} in {string}']) {
    lines.push('    @And("I select radio {string} in {string}")');
    lines.push('    public void iSelectRadio(String value, String radioGroupDescription) {');
    if (framework === 'playwright-java') {
      lines.push('        try {');
      lines.push('            getPage().locator("input[type=\\"radio\\"][value=\'" + value + "\']").check();');
      lines.push('        } catch (Exception e) {');
      lines.push('            getPage().locator("input[type=\\"radio\\"][value=\'" + value + "\']").first().check();');
      lines.push('        }');
    } else {
      lines.push('        try {');
      lines.push('            getDriver().findElement(By.xpath("//input[@type=\\"radio\\" and @value=\'" + value + "\']")).click();');
      lines.push('        } catch (Exception e) {');
      lines.push('            getDriver().findElement(By.cssSelector("input[type=\\"radio\\"][value=\'" + value + "\']")).click();');
      lines.push('        }');
    }
    lines.push('    }');
    lines.push('');
  }
  
  // Hover
  if (stepDefMap['And I hover over {string}']) {
    lines.push('    @And("I hover over {string}")');
    lines.push('    public void iHoverOverElement(String elementDescription) {');
    if (framework === 'playwright-java') {
      lines.push('        try {');
      lines.push('            getPage().locator("text=" + elementDescription).hover();');
      lines.push('        } catch (Exception e) {');
      lines.push('            getPage().locator("[aria-label*=\'" + elementDescription + "\'], button:has-text(\'" + elementDescription + "\')").hover();');
      lines.push('        }');
    } else {
      lines.push('        try {');
      lines.push('            WebElement element = getDriver().findElement(By.xpath("//*[contains(text(), \'" + elementDescription + "\')]"));');
      lines.push('            org.openqa.selenium.interactions.Actions actions = new org.openqa.selenium.interactions.Actions(getDriver());');
      lines.push('            actions.moveToElement(element).perform();');
      lines.push('        } catch (Exception e) {');
      lines.push('            WebElement element = getDriver().findElement(By.partialLinkText(elementDescription));');
      lines.push('            org.openqa.selenium.interactions.Actions actions = new org.openqa.selenium.interactions.Actions(getDriver());');
      lines.push('            actions.moveToElement(element).perform();');
      lines.push('        }');
    }
    lines.push('    }');
    lines.push('');
  }
  
  // Drag and Drop
  if (stepDefMap['And I drag {string} to {string}']) {
    lines.push('    @And("I drag {string} to {string}")');
    lines.push('    public void iDragToTarget(String sourceDescription, String targetDescription) {');
    if (framework === 'playwright-java') {
      lines.push('        try {');
      lines.push('            Locator source = getPage().locator("text=" + sourceDescription);');
      lines.push('            Locator target = getPage().locator("text=" + targetDescription);');
      lines.push('            source.dragTo(target);');
      lines.push('        } catch (Exception e) {');
      lines.push('            Locator source = getPage().locator("[aria-label*=\'" + sourceDescription + "\']");');
      lines.push('            Locator target = getPage().locator("[aria-label*=\'" + targetDescription + "\']");');
      lines.push('            source.dragTo(target);');
      lines.push('        }');
    } else {
      lines.push('        try {');
      lines.push('            WebElement source = getDriver().findElement(By.xpath("//*[contains(text(), \'" + sourceDescription + "\')]"));');
      lines.push('            WebElement target = getDriver().findElement(By.xpath("//*[contains(text(), \'" + targetDescription + "\')]"));');
      lines.push('            org.openqa.selenium.interactions.Actions actions = new org.openqa.selenium.interactions.Actions(getDriver());');
      lines.push('            actions.dragAndDrop(source, target).perform();');
      lines.push('        } catch (Exception e) {');
      lines.push('            WebElement source = getDriver().findElement(By.cssSelector(sourceDescription));');
      lines.push('            WebElement target = getDriver().findElement(By.cssSelector(targetDescription));');
      lines.push('            org.openqa.selenium.interactions.Actions actions = new org.openqa.selenium.interactions.Actions(getDriver());');
      lines.push('            actions.dragAndDrop(source, target).perform();');
      lines.push('        }');
    }
    lines.push('    }');
    lines.push('');
  }
  
  // File Upload
  if (stepDefMap['And I upload {string} to {string}']) {
    lines.push('    @And("I upload {string} to {string}")');
    lines.push('    public void iUploadFile(String filename, String fieldDescription) {');
    if (framework === 'playwright-java') {
      lines.push('        try {');
      lines.push('            getPage().locator("[aria-label*=\'" + fieldDescription + "\'], [name*=\'" + fieldDescription + "\'], input[type=\\"file\\"]").setInputFiles(java.nio.file.Paths.get(filename));');
      lines.push('        } catch (Exception e) {');
      lines.push('            getPage().locator(fieldDescription).setInputFiles(java.nio.file.Paths.get(filename));');
      lines.push('        }');
    } else {
      lines.push('        try {');
      lines.push('            WebElement fileInput = getDriver().findElement(By.xpath("//input[@type=\\"file\\" and (contains(@aria-label, \'" + fieldDescription + "\') or contains(@name, \'" + fieldDescription + "\'))]"));');
      lines.push('            fileInput.sendKeys(new java.io.File(filename).getAbsolutePath());');
      lines.push('        } catch (Exception e) {');
      lines.push('            getDriver().findElement(By.cssSelector(fieldDescription)).sendKeys(new java.io.File(filename).getAbsolutePath());');
      lines.push('        }');
    }
    lines.push('    }');
    lines.push('');
  }
  
  // Key Press
  if (stepDefMap['And I press key {string}']) {
    lines.push('    @And("I press key {string}")');
    lines.push('    public void iPressKey(String key) {');
    if (framework === 'playwright-java') {
      lines.push('        getPage().keyboard().press(key);');
    } else {
      lines.push('        org.openqa.selenium.Keys keyEnum;');
      lines.push('        try {');
      lines.push('            keyEnum = org.openqa.selenium.Keys.valueOf(key.toUpperCase());');
      lines.push('        } catch (Exception e) {');
      lines.push('            keyEnum = org.openqa.selenium.Keys.valueOf(key);');
      lines.push('        }');
      lines.push('        org.openqa.selenium.interactions.Actions actions = new org.openqa.selenium.interactions.Actions(getDriver());');
      lines.push('        actions.sendKeys(keyEnum).perform();');
    }
    lines.push('    }');
    lines.push('');
  }
  
  // Scroll
  if (stepDefMap['And I scroll to position ({int}, {int})']) {
    lines.push('    @And("I scroll to position ({int}, {int})")');
    lines.push('    public void iScrollToPosition(int x, int y) {');
    if (framework === 'playwright-java') {
      lines.push('        getPage().evaluate("window.scrollTo(" + x + ", " + y + ")");');
    } else {
      lines.push('        ((org.openqa.selenium.JavascriptExecutor) getDriver()).executeScript("window.scrollTo(" + x + ", " + y + ")");');
    }
    lines.push('    }');
    lines.push('');
  }
  
  if (stepDefMap['And I scroll to {string}']) {
    lines.push('    @And("I scroll to {string}")');
    lines.push('    public void iScrollToElement(String elementDescription) {');
    if (framework === 'playwright-java') {
      lines.push('        // Try selectors from SELECTOR_MAP first');
      lines.push('        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());');
      lines.push('        boolean found = false;');
      lines.push('        for (String selector : selectors) {');
      lines.push('            try {');
      lines.push('                getPage().locator(selector).scrollIntoViewIfNeeded();');
      lines.push('                found = true;');
      lines.push('                break;');
      lines.push('            } catch (Exception e) {');
      lines.push('                continue;');
      lines.push('            }');
      lines.push('        }');
      lines.push('        if (!found) {');
      lines.push('            try {');
      lines.push('                getPage().locator("text=" + elementDescription).scrollIntoViewIfNeeded();');
      lines.push('            } catch (Exception e) {');
      lines.push('                getPage().locator("[aria-label*=\'" + elementDescription + "\']").scrollIntoViewIfNeeded();');
      lines.push('            }');
      lines.push('        }');
    } else {
      lines.push('        // Try selectors from SELECTOR_MAP first');
      lines.push('        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());');
      lines.push('        boolean found = false;');
      lines.push('        for (String selector : selectors) {');
      lines.push('            try {');
      lines.push('                WebElement element = getDriver().findElement(By.cssSelector(selector));');
      lines.push('                ((org.openqa.selenium.JavascriptExecutor) getDriver()).executeScript("arguments[0].scrollIntoView(true);", element);');
      lines.push('                found = true;');
      lines.push('                break;');
      lines.push('            } catch (Exception e) {');
      lines.push('                continue;');
      lines.push('            }');
      lines.push('        }');
      lines.push('        if (!found) {');
      lines.push('            try {');
      lines.push('                WebElement element = getDriver().findElement(By.xpath("//*[contains(text(), \'" + elementDescription + "\')]"));');
      lines.push('                ((org.openqa.selenium.JavascriptExecutor) getDriver()).executeScript("arguments[0].scrollIntoView(true);", element);');
      lines.push('            } catch (Exception e) {');
      lines.push('                WebElement element = getDriver().findElement(By.cssSelector(elementDescription));');
      lines.push('                ((org.openqa.selenium.JavascriptExecutor) getDriver()).executeScript("arguments[0].scrollIntoView(true);", element);');
      lines.push('            }');
      lines.push('        }');
    }
    lines.push('    }');
    lines.push('');
  }
  
  // Scroll to bottom
  if (stepDefMap['And I scroll to bottom']) {
    lines.push('    @And("I scroll to bottom")');
    lines.push('    public void iScrollToBottom() {');
    if (framework === 'playwright-java') {
      lines.push('        getPage().evaluate("window.scrollTo(0, document.body.scrollHeight)");');
    } else {
      lines.push('        ((org.openqa.selenium.JavascriptExecutor) getDriver()).executeScript("window.scrollTo(0, document.body.scrollHeight);");');
    }
    lines.push('    }');
    lines.push('');
  }
  
  // Scroll to top
  if (stepDefMap['And I scroll to top']) {
    lines.push('    @And("I scroll to top")');
    lines.push('    public void iScrollToTop() {');
    if (framework === 'playwright-java') {
      lines.push('        getPage().evaluate("window.scrollTo(0, 0)");');
    } else {
      lines.push('        ((org.openqa.selenium.JavascriptExecutor) getDriver()).executeScript("window.scrollTo(0, 0);");');
    }
    lines.push('    }');
    lines.push('');
  }
  
  // Scroll to Y position
  if (stepDefMap['And I scroll to position Y {int}']) {
    lines.push('    @And("I scroll to position Y {int}")');
    lines.push('    public void iScrollToPositionY(int y) {');
    if (framework === 'playwright-java') {
      lines.push('        getPage().evaluate("window.scrollTo(0, " + y + ")");');
    } else {
      lines.push('        ((org.openqa.selenium.JavascriptExecutor) getDriver()).executeScript("window.scrollTo(0, " + y + ");");');
    }
    lines.push('    }');
    lines.push('');
  }
  
  // Standard Assertion steps - Always included
  if (stepDefMap['Then I should see {string} in {string}']) {
    lines.push('    @Then("I should see {string} in {string}")');
    lines.push('    public void iShouldSeeIn(String text, String elementDescription) {');
    if (selectorMap.size > 0) {
      lines.push('        // Look up selectors with fallbacks from recorded steps');
      lines.push('        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());');
      lines.push('        if (selectors.isEmpty()) {');
      lines.push('            selectors = new java.util.ArrayList<>();');
      lines.push('            selectors.add(elementDescription);');
      lines.push('        }');
      lines.push('        // Try each selector until one works');
      if (framework === 'playwright-java') {
        lines.push('        boolean found = false;');
        lines.push('        for (String selector : selectors) {');
        lines.push('            try {');
        lines.push('                com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(getPage().locator(selector)).containsText(text);');
        lines.push('                found = true;');
        lines.push('                break;');
        lines.push('            } catch (Exception e) {');
        lines.push('                continue;');
        lines.push('            }');
        lines.push('        }');
        lines.push('        if (!found) {');
        lines.push('            com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(getPage().locator("text=" + elementDescription)).containsText(text);');
        lines.push('        }');
      } else {
        lines.push('        boolean found = false;');
        lines.push('        for (String selector : selectors) {');
        lines.push('            try {');
        lines.push('                WebElement element = getDriver().findElement(By.cssSelector(selector));');
        lines.push('                assertTrue(element.getText().contains(text), "Expected text \'" + text + "\' not found");');
        lines.push('                found = true;');
        lines.push('                break;');
        lines.push('            } catch (Exception e) {');
        lines.push('                continue;');
        lines.push('            }');
        lines.push('        }');
        lines.push('        if (!found) {');
        lines.push('            WebElement element = getDriver().findElement(By.xpath("//*[contains(text(), \'" + elementDescription + "\')]"));');
        lines.push('            assertTrue(element.getText().contains(text), "Expected text \'" + text + "\' not found");');
        lines.push('        }');
      }
    } else {
      // Fallback if no selector map
      if (framework === 'playwright-java') {
        lines.push('        com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(getPage().locator("text=" + elementDescription)).containsText(text);');
      } else {
        lines.push('        WebElement element = getDriver().findElement(By.xpath("//*[contains(text(), \'" + elementDescription + "\')]"));');
        lines.push('        assertTrue(element.getText().contains(text), "Expected text \'" + text + "\' not found in element");');
      }
    }
    lines.push('    }');
    lines.push('');
  }
  
  if (stepDefMap['Then {string} should be visible']) {
    lines.push('    @Then("{string} should be visible")');
    lines.push('    public void shouldBeVisible(String elementDescription) {');
    if (selectorMap.size > 0) {
      lines.push('        // Look up selectors with fallbacks from recorded steps');
      lines.push('        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());');
      lines.push('        if (selectors.isEmpty()) {');
      lines.push('            // No recorded selectors, create default list with description');
      lines.push('            selectors = new java.util.ArrayList<>();');
      lines.push('            selectors.add(elementDescription);');
      lines.push('        }');
      lines.push('        tryCheckVisibleWithFallback(selectors, elementDescription);');
    } else {
      // Fallback if no selector map
      if (framework === 'playwright-java') {
        lines.push('        com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(getPage().locator("text=" + elementDescription)).isVisible();');
      } else {
        lines.push('        WebElement element = getDriver().findElement(By.xpath("//*[contains(text(), \'" + elementDescription + "\')]"));');
        lines.push('        assertTrue(element.isDisplayed(), "Element \'" + elementDescription + "\' is not visible");');
      }
    }
    lines.push('    }');
    lines.push('');
  }
  
  // Assertion - Attribute Equal (Always available)
  lines.push('    @Then("{string} attribute {string} should equal {string}")');
  lines.push('    public void attributeShouldEqual(String elementDescription, String attributeName, String expectedValue) {');
  if (framework === 'playwright-java') {
    lines.push('        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());');
    lines.push('        String selector = selectors.isEmpty() ? elementDescription : selectors.get(0);');
    lines.push('        com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(getPage().locator(selector)).hasAttribute(attributeName, expectedValue);');
  } else {
    lines.push('        WebElement element = getDriver().findElement(By.cssSelector(elementDescription));');
    lines.push('        String actualValue = element.getAttribute(attributeName);');
    lines.push('        assertEquals(expectedValue, actualValue, "Attribute \'" + attributeName + "\' value mismatch");');
  }
  lines.push('    }');
  lines.push('');
  
  // Assertion - Attribute Contains (Always available)
  lines.push('    @Then("{string} attribute {string} should contain {string}")');
  lines.push('    public void attributeShouldContain(String elementDescription, String attributeName, String expectedValue) {');
  if (framework === 'playwright-java') {
    lines.push('        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());');
    lines.push('        String selector = selectors.isEmpty() ? elementDescription : selectors.get(0);');
    lines.push('        String actualValue = getPage().locator(selector).getAttribute(attributeName);');
    lines.push('        assertTrue(actualValue != null && actualValue.contains(expectedValue), "Attribute \'" + attributeName + "\' does not contain \'" + expectedValue + "\'");');
  } else {
    lines.push('        WebElement element = getDriver().findElement(By.cssSelector(elementDescription));');
    lines.push('        String actualValue = element.getAttribute(attributeName);');
    lines.push('        assertTrue(actualValue != null && actualValue.contains(expectedValue), "Attribute \'" + attributeName + "\' does not contain \'" + expectedValue + "\'");');
  }
  lines.push('    }');
  lines.push('');
  
  // Assertion - Count (Always available)
  lines.push('    @Then("{string} count should be {int}")');
  lines.push('    public void countShouldBe(String elementDescription, Integer expectedCount) {');
  if (framework === 'playwright-java') {
    lines.push('        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());');
    lines.push('        String selector = selectors.isEmpty() ? elementDescription : selectors.get(0);');
    lines.push('        com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(getPage().locator(selector)).hasCount(expectedCount);');
  } else {
    lines.push('        java.util.List<WebElement> elements = getDriver().findElements(By.cssSelector(elementDescription));');
    lines.push('        assertEquals(expectedCount.intValue(), elements.size(), "Element count mismatch");');
  }
  lines.push('    }');
  lines.push('');
  
  // Assertion - Value Equal (Always available)
  lines.push('    @Then("{string} value should equal {string}")');
  lines.push('    public void valueShouldEqual(String elementDescription, String expectedValue) {');
  if (framework === 'playwright-java') {
    lines.push('        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());');
    lines.push('        String selector = selectors.isEmpty() ? elementDescription : selectors.get(0);');
    lines.push('        com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(getPage().locator(selector)).hasValue(expectedValue);');
  } else {
    lines.push('        WebElement element = getDriver().findElement(By.cssSelector(elementDescription));');
    lines.push('        String actualValue = element.getAttribute("value");');
    lines.push('        assertEquals(expectedValue, actualValue, "Element value mismatch");');
  }
  lines.push('    }');
  lines.push('');
  
  // Assertion - Value Contains (Always available)
  lines.push('    @Then("{string} value should contain {string}")');
  lines.push('    public void valueShouldContain(String elementDescription, String expectedValue) {');
  if (framework === 'playwright-java') {
    lines.push('        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());');
    lines.push('        String selector = selectors.isEmpty() ? elementDescription : selectors.get(0);');
    lines.push('        String actualValue = getPage().locator(selector).inputValue();');
    lines.push('        assertTrue(actualValue != null && actualValue.contains(expectedValue), "Element value does not contain \'" + expectedValue + "\'");');
  } else {
    lines.push('        WebElement element = getDriver().findElement(By.cssSelector(elementDescription));');
    lines.push('        String actualValue = element.getAttribute("value");');
    lines.push('        assertTrue(actualValue != null && actualValue.contains(expectedValue), "Element value does not contain \'" + expectedValue + "\'");');
  }
  lines.push('    }');
  lines.push('');
  
  // Assertion - Element should not be visible (Always available)
  lines.push('    @Then("{string} should not be visible")');
  lines.push('    public void shouldNotBeVisible(String elementDescription) {');
  if (framework === 'playwright-java') {
    lines.push('        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());');
    lines.push('        String selector = selectors.isEmpty() ? elementDescription : selectors.get(0);');
    lines.push('        com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(getPage().locator(selector)).not().isVisible();');
  } else {
    lines.push('        try {');
    lines.push('            WebElement element = getDriver().findElement(By.cssSelector(elementDescription));');
    lines.push('            assertFalse(element.isDisplayed(), "Element \'" + elementDescription + "\' should not be visible");');
    lines.push('        } catch (org.openqa.selenium.NoSuchElementException e) {');
    lines.push('            // Element not found means it\'s not visible, which is expected');
    lines.push('        }');
  }
  lines.push('    }');
  lines.push('');
  
  // Assertion - Element should be enabled (Always available)
  lines.push('    @Then("{string} should be enabled")');
  lines.push('    public void shouldBeEnabled(String elementDescription) {');
  if (framework === 'playwright-java') {
    lines.push('        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());');
    lines.push('        String selector = selectors.isEmpty() ? elementDescription : selectors.get(0);');
    lines.push('        com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(getPage().locator(selector)).isEnabled();');
  } else {
    lines.push('        WebElement element = getDriver().findElement(By.cssSelector(elementDescription));');
    lines.push('        assertTrue(element.isEnabled(), "Element \'" + elementDescription + "\' is not enabled");');
  }
  lines.push('    }');
  lines.push('');
  
  // Assertion - Element should be disabled (Always available)
  lines.push('    @Then("{string} should be disabled")');
  lines.push('    public void shouldBeDisabled(String elementDescription) {');
  if (framework === 'playwright-java') {
    lines.push('        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());');
    lines.push('        String selector = selectors.isEmpty() ? elementDescription : selectors.get(0);');
    lines.push('        com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(getPage().locator(selector)).isDisabled();');
  } else {
    lines.push('        WebElement element = getDriver().findElement(By.cssSelector(elementDescription));');
    lines.push('        assertFalse(element.isEnabled(), "Element \'" + elementDescription + "\' should be disabled");');
  }
  lines.push('    }');
  lines.push('');
  
  // Assertion - Element should be checked (Always available)
  lines.push('    @Then("{string} should be checked")');
  lines.push('    public void shouldBeChecked(String elementDescription) {');
  if (framework === 'playwright-java') {
    lines.push('        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());');
    lines.push('        String selector = selectors.isEmpty() ? elementDescription : selectors.get(0);');
    lines.push('        com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(getPage().locator(selector)).isChecked();');
  } else {
    lines.push('        WebElement element = getDriver().findElement(By.cssSelector(elementDescription));');
    lines.push('        assertTrue(element.isSelected(), "Element \'" + elementDescription + "\' is not checked");');
  }
  lines.push('    }');
  lines.push('');
  
  // Assertion - Element should not be checked (Always available)
  lines.push('    @Then("{string} should not be checked")');
  lines.push('    public void shouldNotBeChecked(String elementDescription) {');
  if (framework === 'playwright-java') {
    lines.push('        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());');
    lines.push('        String selector = selectors.isEmpty() ? elementDescription : selectors.get(0);');
    lines.push('        com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(getPage().locator(selector)).not().isChecked();');
  } else {
    lines.push('        WebElement element = getDriver().findElement(By.cssSelector(elementDescription));');
    lines.push('        assertFalse(element.isSelected(), "Element \'" + elementDescription + "\' should not be checked");');
  }
  lines.push('    }');
  lines.push('');
  
  // Close Browser
  if (stepDefMap['And I close the browser']) {
    lines.push('    @And("I close the browser")');
    lines.push('    public void iCloseTheBrowser() {');
    if (framework === 'playwright-java') {
      lines.push('        try {');
      lines.push('            Page currentPage = getPage();');
      lines.push('            BrowserContext context = support.PlaywrightWorld.getContext();');
      lines.push('            ');
      lines.push('            // Check if a new tab/page is opening before closing');
      lines.push('            // This prevents closing when the application opens in a new tab');
      lines.push('            // But allows closing when navigation happens in the same tab (normal link click)');
      lines.push('            if (currentPage != null && context != null && !currentPage.isClosed()) {');
      lines.push('                // Get page count before waiting');
      lines.push('                int pagesBefore = context.pages().size();');
      lines.push('                ');
      lines.push('                // Wait a short time to see if a new page is about to open');
      lines.push('                // Some clicks trigger new tabs asynchronously');
      lines.push('                try {');
      lines.push('                    Thread.sleep(500);');
      lines.push('                } catch (InterruptedException e) {');
      lines.push('                    Thread.currentThread().interrupt();');
      lines.push('                }');
      lines.push('                ');
      lines.push('                // Check page count after waiting');
      lines.push('                int pagesAfter = context.pages().size();');
      lines.push('                ');
      lines.push('                // ONLY skip closing if a new page/tab actually opened');
      lines.push('                // If page count increased, it means a new tab was created');
      lines.push('                // If page count stayed the same, it\'s normal navigation in the same tab - allow closing');
      lines.push('                if (pagesAfter > pagesBefore) {');
      lines.push('                    System.out.println("[Close] New tab detected (" + pagesBefore + " -> " + pagesAfter + "), skipping close to preserve new tab");');
      lines.push('                    return; // Skip closing');
      lines.push('                }');
      lines.push('                ');
      lines.push('                // If we reach here, no new tab was created');
      lines.push('                // This means either normal navigation happened in the same tab or no navigation');
      lines.push('                // In both cases, it\'s safe to close the current page');
      lines.push('                System.out.println("[Close] No new tab detected (page count: " + pagesBefore + "), proceeding with close");');
      lines.push('                currentPage.close();');
      lines.push('            }');
      lines.push('            ');
      lines.push('            // Close context and browser if no pages remain');
      lines.push('            if (context != null && context.pages().isEmpty()) {');
      lines.push('                context.close();');
      lines.push('            }');
      lines.push('            if (support.PlaywrightWorld.getBrowser() != null) {');
      lines.push('                support.PlaywrightWorld.getBrowser().close();');
      lines.push('            }');
      lines.push('        } catch (Exception e) {');
      lines.push('            // Browser already closed or error closing');
      lines.push('        }');
    } else {
      // Selenium Java - check for new windows/tabs before closing
      lines.push('        try {');
      lines.push('            org.openqa.selenium.WebDriver driver = getDriver();');
      lines.push('            if (driver != null) {');
      lines.push('                // Check if a new window/tab is opening before closing');
      lines.push('                // This prevents closing when the application opens in a new tab');
      lines.push('                // But allows closing when navigation happens in the same tab (normal link click)');
      lines.push('                String currentWindow = driver.getWindowHandle();');
      lines.push('                int windowsBefore = driver.getWindowHandles().size();');
      lines.push('                ');
      lines.push('                // Wait a short time to see if a new window is about to open');
      lines.push('                // Some clicks trigger new tabs asynchronously');
      lines.push('                try {');
      lines.push('                    Thread.sleep(500);');
      lines.push('                } catch (InterruptedException e) {');
      lines.push('                    Thread.currentThread().interrupt();');
      lines.push('                }');
      lines.push('                ');
      lines.push('                // Check window count after waiting');
      lines.push('                int windowsAfter = driver.getWindowHandles().size();');
      lines.push('                ');
      lines.push('                // ONLY skip closing if a new window/tab actually opened');
      lines.push('                // If window count increased, it means a new tab was created');
      lines.push('                // If window count stayed the same, it\'s normal navigation in the same tab - allow closing');
      lines.push('                if (windowsAfter > windowsBefore) {');
      lines.push('                    System.out.println("[Close] New tab detected (" + windowsBefore + " -> " + windowsAfter + "), skipping close to preserve new tab");');
      lines.push('                    return; // Skip closing');
      lines.push('                }');
      lines.push('                ');
      lines.push('                // If we reach here, no new tab was created');
      lines.push('                // This means either normal navigation happened in the same tab or no navigation');
      lines.push('                // In both cases, it\'s safe to close the browser');
      lines.push('                System.out.println("[Close] No new tab detected (window count: " + windowsBefore + "), proceeding with close");');
      lines.push('                driver.quit();');
      lines.push('            }');
      lines.push('        } catch (Exception e) {');
      lines.push('            // Browser already closed or error closing');
      lines.push('        }');
    }
    lines.push('    }');
    lines.push('');
  }
  
  // Scroll to position Y - Always available if used in feature file
  const hasScrollStep = stepDefMap['Given I scroll to position Y {int}'] || stepDefMap['And I scroll to position Y {int}'];
  if (hasScrollStep) {
    const annotations = [];
    if (stepDefMap['Given I scroll to position Y {int}']) annotations.push('Given');
    if (stepDefMap['And I scroll to position Y {int}']) annotations.push('And');
    
    annotations.forEach(ann => {
      lines.push(`    @${ann}("I scroll to position Y {int}")`);
    });
    lines.push('    public void iScrollToPositionY(Integer yPosition) {');
    if (framework === 'playwright-java') {
      lines.push('        getPage().evaluate("window.scrollTo(0, " + yPosition + ");");');
    } else {
      lines.push('        ((org.openqa.selenium.JavascriptExecutor) getDriver()).executeScript("window.scrollTo(0, " + yPosition + ");");');
    }
    lines.push('        try {');
    lines.push('            Thread.sleep(500);');
    lines.push('        } catch (InterruptedException e) {');
    lines.push('            Thread.currentThread().interrupt();');
    lines.push('        }');
    lines.push('    }');
    lines.push('');
  }
  
  // ──────────────────────────────────────────────────────────────────────
  // [ZAC-FIX 2026-05-24] Step-defs that the feature-file generator emits
  // but the Java step-def generator was missing. Without these 12+
  // blocks, any recording that used doubleClick / hover / dragDrop /
  // check / uncheck / selectRadio / fileUpload / keyPress / scroll /
  // waitFor / waitForSelector / screenshot / apiCall would compile fine
  // but throw "Undefined step" the moment Cucumber executes the run.
  //
  // Each block:
  //   1. Probes the stepDefMap for the pattern emitted by gherkin.js
  //   2. Picks the highest-priority annotation (Given > When > Then > And)
  //   3. Emits a framework-specific body (Selenium WebDriver vs
  //      Playwright Java) that's idempotent + uses the existing
  //      SELECTOR_FALLBACKS_BY_PRIMARY healing helper when sensible.
  // ──────────────────────────────────────────────────────────────────────
  const isPw = framework === 'playwright-java';
  const emitStep = (patterns, paramSig, bodyLines) => {
    const found = patterns.find(p => stepDefMap[p]);
    if (!found) return;
    const kw = found.match(/^(Given|When|Then|And)/)[1];
    // Strip the leading keyword + space for the @annotation literal.
    const rest = found.replace(/^(Given|When|Then|And)\s+/, '');
    lines.push(`    @${kw}("${rest}")`);
    lines.push(`    public void ${paramSig} {`);
    bodyLines.forEach(l => lines.push('        ' + l));
    lines.push('    }');
    lines.push('');
  };

  // doubleClick
  emitStep(
    ['And I double click {string}', 'When I double click {string}'],
    'iDoubleClick(String selector)',
    isPw
      ? ['getPage().locator(selector).dblclick();']
      : [
          'org.openqa.selenium.WebElement el = getDriver().findElement(By.cssSelector(selector));',
          'new org.openqa.selenium.interactions.Actions(getDriver()).doubleClick(el).perform();',
        ],
  );

  // hover
  emitStep(
    ['And I hover over {string}', 'When I hover over {string}'],
    'iHoverOver(String selector)',
    isPw
      ? ['getPage().locator(selector).hover();']
      : [
          'org.openqa.selenium.WebElement el = getDriver().findElement(By.cssSelector(selector));',
          'new org.openqa.selenium.interactions.Actions(getDriver()).moveToElement(el).perform();',
        ],
  );

  // dragDrop
  emitStep(
    ['And I drag {string} to {string}', 'When I drag {string} to {string}'],
    'iDragDrop(String sourceSelector, String targetSelector)',
    isPw
      ? ['getPage().locator(sourceSelector).dragTo(getPage().locator(targetSelector));']
      : [
          'org.openqa.selenium.WebElement src = getDriver().findElement(By.cssSelector(sourceSelector));',
          'org.openqa.selenium.WebElement tgt = getDriver().findElement(By.cssSelector(targetSelector));',
          'new org.openqa.selenium.interactions.Actions(getDriver()).dragAndDrop(src, tgt).perform();',
        ],
  );

  // check (set checkbox to checked)
  emitStep(
    ['And I check {string}', 'When I check {string}'],
    'iCheck(String selector)',
    isPw
      ? ['getPage().locator(selector).check();']
      : [
          'org.openqa.selenium.WebElement el = getDriver().findElement(By.cssSelector(selector));',
          'if (!el.isSelected()) el.click();',
        ],
  );

  // uncheck
  emitStep(
    ['And I uncheck {string}', 'When I uncheck {string}'],
    'iUncheck(String selector)',
    isPw
      ? ['getPage().locator(selector).uncheck();']
      : [
          'org.openqa.selenium.WebElement el = getDriver().findElement(By.cssSelector(selector));',
          'if (el.isSelected()) el.click();',
        ],
  );

  // selectRadio
  emitStep(
    ['And I select radio {string} in {string}', 'When I select radio {string} in {string}'],
    'iSelectRadio(String value, String groupSelector)',
    isPw
      ? [
          'String xp = groupSelector + "[value=\\"" + value + "\\"]";',
          'getPage().locator(xp).check();',
        ]
      : [
          'java.util.List<org.openqa.selenium.WebElement> radios = getDriver().findElements(By.cssSelector(groupSelector));',
          'for (org.openqa.selenium.WebElement r : radios) {',
          '    if (value.equals(r.getAttribute("value")) && !r.isSelected()) { r.click(); return; }',
          '}',
        ],
  );

  // fileUpload
  emitStep(
    ['And I upload {string} to {string}', 'When I upload {string} to {string}'],
    'iUpload(String filename, String selector)',
    isPw
      ? [
          'java.nio.file.Path file = java.nio.file.Paths.get(filename);',
          'getPage().locator(selector).setInputFiles(file);',
        ]
      : [
          'org.openqa.selenium.WebElement el = getDriver().findElement(By.cssSelector(selector));',
          'java.io.File file = new java.io.File(filename);',
          'el.sendKeys(file.getAbsolutePath());',
        ],
  );

  // keyPress
  emitStep(
    ['And I press key {string}', 'When I press key {string}'],
    'iPressKey(String key)',
    isPw
      ? ['getPage().keyboard().press(key);']
      : [
          'new org.openqa.selenium.interactions.Actions(getDriver())',
          '    .sendKeys(org.openqa.selenium.Keys.valueOf(key.toUpperCase())).perform();',
        ],
  );

  // scroll to position (x, y)
  emitStep(
    ['And I scroll to position ({int}, {int})', 'When I scroll to position ({int}, {int})'],
    'iScrollToXY(Integer x, Integer y)',
    isPw
      ? ['getPage().evaluate("window.scrollTo(" + x + ", " + y + ");");']
      : ['((org.openqa.selenium.JavascriptExecutor) getDriver()).executeScript("window.scrollTo(" + x + ", " + y + ");");'],
  );

  // scroll to element selector
  emitStep(
    ['And I scroll to {string}', 'When I scroll to {string}'],
    'iScrollToSelector(String selector)',
    isPw
      ? ['getPage().locator(selector).scrollIntoViewIfNeeded();']
      : [
          'org.openqa.selenium.WebElement el = getDriver().findElement(By.cssSelector(selector));',
          '((org.openqa.selenium.JavascriptExecutor) getDriver()).executeScript("arguments[0].scrollIntoView({behavior:\\"smooth\\", block:\\"center\\"});", el);',
        ],
  );

  // waitFor (sleep N ms)
  emitStep(
    ['And I wait for {int} ms', 'When I wait for {int} ms'],
    'iWaitForMs(Integer ms)',
    isPw
      ? ['getPage().waitForTimeout(ms);']
      : [
          'try { Thread.sleep(ms); }',
          'catch (InterruptedException e) { Thread.currentThread().interrupt(); }',
        ],
  );

  // waitForSelector
  emitStep(
    ['And I wait for selector {string}', 'When I wait for selector {string}'],
    'iWaitForSelector(String selector)',
    isPw
      ? ['getPage().waitForSelector(selector);']
      : [
          'new org.openqa.selenium.support.ui.WebDriverWait(getDriver(), java.time.Duration.ofSeconds(15))',
          '    .until(org.openqa.selenium.support.ui.ExpectedConditions.visibilityOfElementLocated(By.cssSelector(selector)));',
        ],
  );

  // screenshot
  emitStep(
    ['And I take screenshot {string}', 'When I take screenshot {string}'],
    'iTakeScreenshot(String filename)',
    isPw
      ? [
          'java.nio.file.Path out = java.nio.file.Paths.get(filename);',
          'getPage().screenshot(new com.microsoft.playwright.Page.ScreenshotOptions().setPath(out));',
        ]
      : [
          'java.io.File src = ((org.openqa.selenium.TakesScreenshot) getDriver()).getScreenshotAs(org.openqa.selenium.OutputType.FILE);',
          'try { java.nio.file.Files.copy(src.toPath(), java.nio.file.Paths.get(filename), java.nio.file.StandardCopyOption.REPLACE_EXISTING); }',
          'catch (java.io.IOException e) { throw new RuntimeException("Screenshot save failed: " + filename, e); }',
        ],
  );

  // apiCall — pure Java HTTP, framework-agnostic, just needs java.net.http
  emitStep(
    ['And I call API {word} {string}', 'When I call API {word} {string}'],
    'iCallApi(String method, String url)',
    [
      'try {',
      '    java.net.http.HttpClient client = java.net.http.HttpClient.newHttpClient();',
      '    java.net.http.HttpRequest.Builder req = java.net.http.HttpRequest.newBuilder()',
      '        .uri(java.net.URI.create(url));',
      '    switch (method.toUpperCase()) {',
      '        case "POST":   req.POST(java.net.http.HttpRequest.BodyPublishers.noBody()); break;',
      '        case "PUT":    req.PUT(java.net.http.HttpRequest.BodyPublishers.noBody());  break;',
      '        case "DELETE": req.DELETE(); break;',
      '        default:       req.GET();',
      '    }',
      '    java.net.http.HttpResponse<String> resp = client.send(req.build(), java.net.http.HttpResponse.BodyHandlers.ofString());',
      '    System.out.println("[apiCall] " + method + " " + url + " -> " + resp.statusCode());',
      '} catch (Exception e) {',
      '    throw new RuntimeException("apiCall failed: " + e.getMessage(), e);',
      '}',
    ],
  );

  // Page wait step - Always available if used in feature file
  const hasPageWaitStep = stepDefMap['Given I Am On S Page'] || stepDefMap['And I Am On S Page'];
  if (hasPageWaitStep) {
    const annotations = [];
    if (stepDefMap['Given I Am On S Page']) annotations.push('Given');
    if (stepDefMap['And I Am On S Page']) annotations.push('And');
    
    annotations.forEach(ann => {
      lines.push(`    @${ann}("I Am On S Page")`);
    });
    lines.push('    public void iAmOnSPage() {');
    lines.push('        // Wait for page to load');
    if (framework === 'playwright-java') {
      lines.push('        getPage().waitForLoadState(com.microsoft.playwright.options.LoadState.DOMCONTENTLOADED, new com.microsoft.playwright.Page.WaitForLoadStateOptions().setTimeout(10000));');
    } else {
      lines.push('        org.openqa.selenium.support.ui.WebDriverWait wait = new org.openqa.selenium.support.ui.WebDriverWait(getDriver(), java.time.Duration.ofSeconds(10));');
      lines.push('        wait.until(webDriver -> ((org.openqa.selenium.JavascriptExecutor) webDriver).executeScript("return document.readyState").equals("complete"));');
    }
    lines.push('        try {');
    lines.push('            Thread.sleep(1000);');
    lines.push('        } catch (InterruptedException e) {');
    lines.push('            Thread.currentThread().interrupt();');
    lines.push('        }');
    lines.push('    }');
    lines.push('');
  }
  
  lines.push('}');
  
  return lines.join('\n');
}

// Helper function to sanitize project name for Maven artifactId
// Maven artifactId must be lowercase, no spaces, and follow specific naming rules
function sanitizeMavenArtifactId(projectName) {
  if (!projectName || typeof projectName !== 'string') {
    return 'automation-project';
  }
  
  // Convert to lowercase
  let sanitized = projectName.toLowerCase();
  
  // Replace spaces and invalid characters with hyphens
  sanitized = sanitized.replace(/[^a-z0-9\-_]/g, '-');
  
  // Remove consecutive hyphens
  sanitized = sanitized.replace(/-+/g, '-');
  
  // Remove leading/trailing hyphens and underscores
  sanitized = sanitized.replace(/^[-_]+|[-_]+$/g, '');
  
  // If it starts with a number, prefix with 'project-'
  if (/^\d/.test(sanitized)) {
    sanitized = 'project-' + sanitized;
  }
  
  // If empty after sanitization, use default
  if (!sanitized || sanitized.length === 0) {
    sanitized = 'automation-project';
  }
  
  // Ensure it's not too long (Maven has limits)
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 200).replace(/-+$/, '');
  }
  
  return sanitized;
}

function generateMavenPom(framework, projectName, baseUrl) {
  // Sanitize project name for Maven artifactId
  const mavenArtifactId = sanitizeMavenArtifactId(projectName);
  
  if (framework === 'playwright-java') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    
    <groupId>com.automation</groupId>
    <artifactId>${mavenArtifactId}</artifactId>
    <version>1.0-SNAPSHOT</version>
    <packaging>jar</packaging>
    
    <name>${projectName}</name>
    <description>Automated tests with Playwright and Cucumber</description>
    
    <properties>
        <maven.compiler.source>11</maven.compiler.source>
        <maven.compiler.target>11</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <playwright.version>${VERSIONS.PLAYWRIGHT}</playwright.version>
        <cucumber.version>${VERSIONS.CUCUMBER}</cucumber.version>
        <junit.version>${VERSIONS.JUNIT}</junit.version>
        <allure.version>${VERSIONS.ALLURE}</allure.version>
        <maven.surefire.version>${VERSIONS.SUREFIRE}</maven.surefire.version>
    </properties>
    
    <dependencies>
        <!-- Playwright -->
        <dependency>
            <groupId>com.microsoft.playwright</groupId>
            <artifactId>playwright</artifactId>
            <version>\${playwright.version}</version>
        </dependency>
        
        <!-- Cucumber -->
        <dependency>
            <groupId>io.cucumber</groupId>
            <artifactId>cucumber-java</artifactId>
            <version>\${cucumber.version}</version>
        </dependency>
        <dependency>
            <groupId>io.cucumber</groupId>
            <artifactId>cucumber-junit-platform-engine</artifactId>
            <version>\${cucumber.version}</version>
        </dependency>
        
        <!-- JUnit 5 -->
        <dependency>
            <groupId>org.junit.platform</groupId>
            <artifactId>junit-platform-suite</artifactId>
            <version>1.10.0</version>
        </dependency>
        <dependency>
            <groupId>org.junit.jupiter</groupId>
            <artifactId>junit-jupiter</artifactId>
            <version>\${junit.version}</version>
            <scope>test</scope>
        </dependency>
        
        <!-- Allure Reports -->
        <dependency>
            <groupId>io.qameta.allure</groupId>
            <artifactId>allure-junit5</artifactId>
            <version>\${allure.version}</version>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>io.qameta.allure</groupId>
            <artifactId>allure-cucumber7-jvm</artifactId>
            <version>\${allure.version}</version>
            <scope>test</scope>
        </dependency>
    </dependencies>
    
    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <version>3.11.0</version>
                <configuration>
                    <source>11</source>
                    <target>11</target>
                </configuration>
            </plugin>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-surefire-plugin</artifactId>
                <version>\${maven.surefire.version}</version>
                <configuration>
                    <argLine>
                        -javaagent:"\${settings.localRepository}/org/aspectj/aspectjweaver/1.9.20.1/aspectjweaver-1.9.20.1.jar"
                    </argLine>
                    <properties>
                        <property>
                            <name>listener</name>
                            <value>io.qameta.allure.junit5.AllureJunit5</value>
                        </property>
                    </properties>
                </configuration>
                <dependencies>
                    <dependency>
                        <groupId>org.aspectj</groupId>
                        <artifactId>aspectjweaver</artifactId>
                        <version>1.9.20.1</version>
                    </dependency>
                </dependencies>
            </plugin>
            <plugin>
                <groupId>io.qameta.allure</groupId>
                <artifactId>allure-maven</artifactId>
                <version>2.12.0</version>
                <configuration>
                    <reportVersion>\${allure.version}</reportVersion>
                </configuration>
            </plugin>
            <!-- Note: Install Playwright browsers manually using: npx playwright install -->
        </plugins>
    </build>
</project>`;
  } else {
    return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    
    <groupId>com.automation</groupId>
    <artifactId>${mavenArtifactId}</artifactId>
    <version>1.0-SNAPSHOT</version>
    <packaging>jar</packaging>
    
    <name>${projectName}</name>
    <description>Automated tests with Selenium and Cucumber</description>
    
    <properties>
        <maven.compiler.source>11</maven.compiler.source>
        <maven.compiler.target>11</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <selenium.version>${VERSIONS.SELENIUM}</selenium.version>
        <cucumber.version>${VERSIONS.CUCUMBER}</cucumber.version>
        <junit.version>${VERSIONS.JUNIT}</junit.version>
        <webdrivermanager.version>${VERSIONS.WEBDRIVER_MANAGER}</webdrivermanager.version>
        <allure.version>${VERSIONS.ALLURE}</allure.version>
        <maven.surefire.version>${VERSIONS.SUREFIRE}</maven.surefire.version>
    </properties>
    
    <dependencies>
        <!-- Selenium WebDriver -->
        <dependency>
            <groupId>org.seleniumhq.selenium</groupId>
            <artifactId>selenium-java</artifactId>
            <version>\${selenium.version}</version>
        </dependency>
        
        <!-- WebDriverManager for automatic driver management -->
        <dependency>
            <groupId>io.github.bonigarcia</groupId>
            <artifactId>webdrivermanager</artifactId>
            <version>\${webdrivermanager.version}</version>
        </dependency>
        
        <!-- Cucumber -->
        <dependency>
            <groupId>io.cucumber</groupId>
            <artifactId>cucumber-java</artifactId>
            <version>\${cucumber.version}</version>
        </dependency>
        <dependency>
            <groupId>io.cucumber</groupId>
            <artifactId>cucumber-junit-platform-engine</artifactId>
            <version>\${cucumber.version}</version>
        </dependency>
        
        <!-- JUnit 5 -->
        <dependency>
            <groupId>org.junit.platform</groupId>
            <artifactId>junit-platform-suite</artifactId>
            <version>1.10.0</version>
        </dependency>
        <dependency>
            <groupId>org.junit.jupiter</groupId>
            <artifactId>junit-jupiter</artifactId>
            <version>\${junit.version}</version>
            <scope>test</scope>
        </dependency>
        
        <!-- Allure Reports -->
        <dependency>
            <groupId>io.qameta.allure</groupId>
            <artifactId>allure-junit5</artifactId>
            <version>\${allure.version}</version>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>io.qameta.allure</groupId>
            <artifactId>allure-cucumber7-jvm</artifactId>
            <version>\${allure.version}</version>
            <scope>test</scope>
        </dependency>
    </dependencies>
    
    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <version>3.11.0</version>
                <configuration>
                    <source>11</source>
                    <target>11</target>
                </configuration>
            </plugin>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-surefire-plugin</artifactId>
                <version>\${maven.surefire.version}</version>
                <configuration>
                    <argLine>
                        -javaagent:"\${settings.localRepository}/org/aspectj/aspectjweaver/1.9.20.1/aspectjweaver-1.9.20.1.jar"
                    </argLine>
                    <properties>
                        <property>
                            <name>listener</name>
                            <value>io.qameta.allure.junit5.AllureJunit5</value>
                        </property>
                    </properties>
                </configuration>
                <dependencies>
                    <dependency>
                        <groupId>org.aspectj</groupId>
                        <artifactId>aspectjweaver</artifactId>
                        <version>1.9.20.1</version>
                    </dependency>
                </dependencies>
            </plugin>
            <plugin>
                <groupId>io.qameta.allure</groupId>
                <artifactId>allure-maven</artifactId>
                <version>2.12.0</version>
                <configuration>
                    <reportVersion>\${allure.version}</reportVersion>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>`;
  }
}

function generateCucumberProperties() {
  // [ZAC-FIX 2026-05-24] Defaults stay sequential (safe, deterministic).
  // QA can flip on parallel scenario execution via either:
  //   • mvn -Dcucumber.execution.parallel.enabled=true \
  //         -Dcucumber.execution.parallel.config.strategy=dynamic \
  //         -Dcucumber.execution.parallel.config.dynamic.factor=1 test
  //   • Or, in CI, set the same keys as <systemPropertyVariables> on
  //     maven-surefire-plugin. JVM properties override these literals.
  // When parallel is on, dynamic strategy picks N = CPUs * factor.
  return `cucumber.publish.quiet=true
cucumber.filter.tags=@recorded
cucumber.plugin=pretty,html:target/cucumber-reports/html-report.html,json:target/cucumber-reports/cucumber.json,junit:target/cucumber-reports/cucumber.xml,io.qameta.allure.cucumber7jvm.AllureCucumber7Jvm
cucumber.execution.parallel.enabled=false
cucumber.execution.parallel.config.strategy=dynamic
cucumber.execution.parallel.config.dynamic.factor=1
cucumber.execution.strict=true
cucumber.snippet-type=camelcase`;
}

/**
 * Generate Cucumber JUnit Runner class
 * This is the main entry point for running Cucumber BDD tests
 * @param {string} packageName - Package name for the runner class
 * @param {string} featurePath - Path to feature files (relative to resources)
 * @param {string} gluePath - Path to step definitions package
 * @returns {string} Generated Cucumber runner class code
 */
function generateCucumberRunner(packageName = 'runner', featurePath = 'features', gluePath = 'steps') {
  // Always include 'support' package for World classes with @Before/@After hooks
  const fullGluePath = gluePath.includes('support') ? gluePath : `${gluePath},support`;
  return `package ${packageName};

import org.junit.platform.suite.api.ConfigurationParameter;
import org.junit.platform.suite.api.IncludeEngines;
import org.junit.platform.suite.api.SelectClasspathResource;
import org.junit.platform.suite.api.Suite;

import static io.cucumber.junit.platform.engine.Constants.PLUGIN_PROPERTY_NAME;
import static io.cucumber.junit.platform.engine.Constants.GLUE_PROPERTY_NAME;

@Suite
@IncludeEngines("cucumber")
@SelectClasspathResource("${featurePath}")
@ConfigurationParameter(key = GLUE_PROPERTY_NAME, value = "${fullGluePath}")
@ConfigurationParameter(key = PLUGIN_PROPERTY_NAME, value = "pretty, html:target/cucumber-reports/html-report.html, json:target/cucumber-reports/cucumber.json, junit:target/cucumber-reports/cucumber.xml")
public class RunCucumberTest {
    // This class serves as the main entry point for running Cucumber BDD tests
    // Run this class or use: mvn test
}
`;
}

/**
 * Generate standalone Playwright Java test (runnable with mvn test)
 * @param {string} testName - Test class name
 * @param {string} baseUrl - Base URL for navigation
 * @param {Array} steps - Array of recorded actions
 * @param {string} browserType - Browser type (chromium, firefox, webkit)
 * @returns {string} Generated Playwright Java test code
 */
function generatePlaywrightTest(testName = 'PlaywrightTest', baseUrl = 'https://example.com', steps = [], browserType = 'chromium') {
  const className = testName.replace(/[^a-zA-Z0-9]/g, '') || 'PlaywrightTest';
  let varCounter = 0;
  
let code = `package tests;

import com.microsoft.playwright.*;
import org.junit.jupiter.api.*;

public class ${className} {
    private static Playwright playwright;
    private static Browser browser;
    private static BrowserContext context;
    private static Page page;

    @BeforeAll
    public static void setUp() {
        playwright = Playwright.create();
        BrowserType.LaunchOptions launchOptions = new BrowserType.LaunchOptions()
            .setHeadless(false);
        
        // Launch browser based on type
        switch ("${browserType}") {
            case "firefox":
                browser = playwright.firefox().launch(launchOptions);
                break;
            case "webkit":
                browser = playwright.webkit().launch(launchOptions);
                break;
            case "edge":
                launchOptions.setChannel("msedge");
                browser = playwright.chromium().launch(launchOptions);
                break;
            case "chromium":
            default:
                launchOptions.setChannel("chrome");
                browser = playwright.chromium().launch(launchOptions);
                break;
        }
        
        context = browser.newContext();
        page = context.newPage();
    }

    @AfterAll
    public static void tearDown() {
        if (context != null) context.close();
        if (browser != null) browser.close();
        if (playwright != null) playwright.close();
    }

    @Test
    public void recordedTest() {
`;

  // Generate test steps
  for (const step of steps) {
    switch (step.kind) {
      case 'navigate':
        const url = step.url || baseUrl;
        code += `        page.navigate("${escapeJavaString(url)}");\n`;
        break;
        
      case 'click':
      case 'doubleClick':
        const clickSelector = step.selector || step.normalizedSelector || '';
        if (clickSelector) {
          code += `        page.locator("${escapeJavaString(clickSelector)}").click();\n`;
        }
        break;
        
      case 'type':
        const typeSelector = step.selector || step.normalizedSelector || '';
        const value = escapeJavaString(step.value || '');
        if (typeSelector && value) {
          code += `        page.locator("${escapeJavaString(typeSelector)}").fill("${value}");\n`;
        }
        break;
        
      case 'assertText':
        const assertTextSelector = step.selector || step.normalizedSelector || '';
        const expectedText = step.expectedValue || step.text || '';
        if (assertTextSelector && expectedText) {
          // Handle multi-line strings by storing textContent in a variable first
          const varName = `textContent${varCounter++}`;
          const safeExpectedText = escapeJavaString(expectedText);
          code += `        String ${varName} = page.locator("${escapeJavaString(assertTextSelector)}").textContent();\n`;
          code += `        org.junit.jupiter.api.Assertions.assertTrue(${varName} != null && ${varName}.contains("${safeExpectedText}"));\n`;
        }
        break;
        
      case 'assertVisible':
        const assertVisibleSelector = step.selector || step.normalizedSelector || '';
        if (assertVisibleSelector) {
          code += `        org.junit.jupiter.api.Assertions.assertTrue(page.locator("${escapeJavaString(assertVisibleSelector)}").isVisible());\n`;
        }
        break;
        
      case 'assertAttribute':
        const assertAttrSelector = step.selector || step.normalizedSelector || '';
        const attrName = step.value || '';
        const attrValue = escapeJavaString(step.expectedValue || '');
        if (assertAttrSelector && attrName && attrValue) {
          code += `        org.junit.jupiter.api.Assertions.assertEquals("${attrValue}", page.locator("${escapeJavaString(assertAttrSelector)}").getAttribute("${attrName}"));\n`;
        }
        break;
        
      case 'assertCount':
        const assertCountSelector = step.selector || step.normalizedSelector || '';
        const count = parseInt(step.expectedValue) || 0;
        if (assertCountSelector) {
          code += `        org.junit.jupiter.api.Assertions.assertEquals(${count}, page.locator("${escapeJavaString(assertCountSelector)}").count());\n`;
        }
        break;
        
      case 'assertValue':
        const assertValueSelector = step.selector || step.normalizedSelector || '';
        const expectedValue = escapeJavaString(step.expectedValue || '');
        if (assertValueSelector && expectedValue) {
          code += `        org.junit.jupiter.api.Assertions.assertEquals("${expectedValue}", page.locator("${escapeJavaString(assertValueSelector)}").inputValue());\n`;
        }
        break;
        
      case 'waitFor':
        const waitMs = Number(step.ms) || 500;
        code += `        page.waitForTimeout(${waitMs});\n`;
        break;
        
      case 'waitForSelector':
        const waitSelector = step.selector || step.normalizedSelector || '';
        if (waitSelector) {
          code += `        page.waitForSelector("${escapeJavaString(waitSelector)}");\n`;
        }
        break;
        
      case 'screenshot':
        const filename = step.filename || 'screenshot.png';
        code += `        page.screenshot(new Page.ScreenshotOptions().setPath("${escapeJavaString(filename)}"));\n`;
        break;
    }
  }

  code += `    }
}
`;

  return code;
}

export {
  generateJavaWorld,
  generateJavaStepDefinitions,
  generateMavenPom,
  generateCucumberProperties,
  generateCucumberRunner,
  generatePlaywrightTest
};

