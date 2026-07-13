/**
 * generators/selenium-testng.js
 *
 * Generator plugin for: Selenium WebDriver + Java + TestNG (no Cucumber).
 *
 * This is a pure module: it returns file content keyed by relative path
 * and never writes to disk itself (the dispatcher does that). See
 * `generators/PLUGIN.md` for the full plugin contract.
 *
 * Output shape (under generated-projects/selenium-testng/<project>/):
 *
 *   pom.xml
 *   src/test/resources/testng.xml
 *   src/test/java/<ClassName>Test.java       — TestNG test class
 *   src/test/java/support/BasePage.java      — page-object base class
 *   src/test/java/support/CredentialsHelper.java — env-var resolver (mirrors JS)
 *   src/test/java/support/Locators.java      — primary + fallback chain
 *   locators.json                             — the same chain in JSON
 *   README.md
 *
 * What's intentionally NOT in this plugin:
 *   - feature files / step defs (TestNG is not BDD; selenium-java covers BDD)
 *   - Cucumber dependencies in pom.xml
 *   - Gherkin in the test class
 *
 * If you want BDD with Selenium, use the existing `selenium-java` plugin.
 */

/* -------------------------------------------------------------------------- *
 *  Tiny string helpers (no project dependency)                               *
 * -------------------------------------------------------------------------- */

function pascalCase(name) {
  if (!name) return 'RecordedFlow';
  const cleaned = String(name).replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  if (cleaned.length === 0) return 'RecordedFlow';
  return cleaned.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

function safeJavaIdentifier(name) {
  const p = pascalCase(name);
  // Java identifiers can't start with a digit.
  return /^[0-9]/.test(p) ? `Step${p}` : p;
}

function escapeJavaString(s) {
  if (s == null) return '';
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

/* -------------------------------------------------------------------------- *
 *  File templates                                                            *
 * -------------------------------------------------------------------------- */

function pomXml({ projectName, groupId = 'com.zac.generated' }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>

  <groupId>${groupId}</groupId>
  <artifactId>${projectName}</artifactId>
  <version>1.0.0-SNAPSHOT</version>
  <packaging>jar</packaging>

  <properties>
    <maven.compiler.source>17</maven.compiler.source>
    <maven.compiler.target>17</maven.compiler.target>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <selenium.version>4.18.1</selenium.version>
    <testng.version>7.10.2</testng.version>
    <webdrivermanager.version>5.7.0</webdrivermanager.version>
  </properties>

  <dependencies>
    <dependency>
      <groupId>org.seleniumhq.selenium</groupId>
      <artifactId>selenium-java</artifactId>
      <version>\${selenium.version}</version>
    </dependency>
    <dependency>
      <groupId>org.testng</groupId>
      <artifactId>testng</artifactId>
      <version>\${testng.version}</version>
    </dependency>
    <dependency>
      <groupId>io.github.bonigarcia</groupId>
      <artifactId>webdrivermanager</artifactId>
      <version>\${webdrivermanager.version}</version>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.2.5</version>
        <configuration>
          <suiteXmlFiles>
            <suiteXmlFile>src/test/resources/testng.xml</suiteXmlFile>
          </suiteXmlFiles>
        </configuration>
      </plugin>
    </plugins>
  </build>
</project>
`;
}

function testngXml({ className }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE suite SYSTEM "https://testng.org/testng-1.0.dtd">
<suite name="ZAC Recorded Suite" verbose="1">
  <test name="${className} test">
    <classes>
      <class name="${className}Test"/>
    </classes>
  </test>
</suite>
`;
}

function credentialsHelperJava() {
  return `package support;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Resolves \${ENV_VAR} placeholders in step values to actual values from
 * the process environment at execution time. Mirrors the JS-side
 * utils/credentialResolver.js so both runtimes apply identical rules:
 *
 *   - Only \${UPPERCASE_WITH_UNDERSCORES} placeholders are resolved.
 *   - Empty / unset variables throw IllegalStateException naming the
 *     missing variable. We never silently fall back to typing the
 *     placeholder text.
 *   - Resolved values are NOT logged or surfaced; callers must use
 *     mask() before any println / report write.
 */
public final class CredentialsHelper {
  private static final Pattern PLACEHOLDER = Pattern.compile("\\\\\\$\\\\{([A-Z][A-Z0-9_]*)\\\\}");

  private CredentialsHelper() {}

  public static String resolve(String value) {
    if (value == null) return null;
    Matcher m = PLACEHOLDER.matcher(value);
    if (!m.find()) return value;
    m.reset();
    StringBuffer out = new StringBuffer();
    while (m.find()) {
      String name = m.group(1);
      String env = System.getenv(name);
      if (env == null || env.isEmpty()) {
        throw new IllegalStateException(
          "Missing required environment variable " + name +
          ". Set it before running, e.g.  export " + name + "='...'");
      }
      m.appendReplacement(out, Matcher.quoteReplacement(env));
    }
    m.appendTail(out);
    return out.toString();
  }

  public static String mask(String value) {
    if (value == null || value.isEmpty()) return "";
    return "***";
  }
}
`;
}

function basePageJava() {
  return `package support;

import org.openqa.selenium.By;
import org.openqa.selenium.NoSuchElementException;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;
import java.time.Duration;
import java.util.List;

/**
 * Page-object base. Walks a primary + fallback selector chain and
 * returns the first one that matches a unique, visible element.
 * Mirrors the JS-side utils/locatorHealer.js contract:
 *
 *   - Primary first
 *   - Each fallback in recorded order
 *   - Skip ambiguous (>1 match) candidates — never silently click
 *     the wrong element.
 *   - If the chain is exhausted, throw NoSuchElementException naming
 *     EVERY selector that was tried.
 */
public class BasePage {
  protected final WebDriver driver;
  protected final WebDriverWait wait;

  public BasePage(WebDriver driver) {
    this.driver = driver;
    this.wait = new WebDriverWait(driver, Duration.ofSeconds(10));
  }

  /**
   * Find an element using a self-healing selector chain.
   *
   * @param chain  primary selector first, then fallbacks in priority order
   * @return       the resolved WebElement (visible, unique on the page)
   */
  public WebElement findWithHealing(List<String> chain) {
    StringBuilder tried = new StringBuilder();
    for (int i = 0; i < chain.size(); i++) {
      String raw = chain.get(i);
      if (tried.length() > 0) tried.append(", ");
      tried.append(raw);
      try {
        By by = parseSelector(raw);
        wait.until(ExpectedConditions.visibilityOfElementLocated(by));
        List<WebElement> matches = driver.findElements(by);
        if (matches.isEmpty()) continue;
        if (matches.size() > 1) {
          System.out.println("[Heal] Selector " + raw + " matched " + matches.size() + " elements; skipping (ambiguous)");
          continue;
        }
        if (i > 0) {
          System.out.println("[Heal] Healed primary -> " + raw);
        }
        return matches.get(0);
      } catch (Exception e) {
        // Try next fallback.
      }
    }
    throw new NoSuchElementException("Locator chain exhausted. Tried: " + tried);
  }

  /**
   * Convert a selector string into a Selenium By. Mirrors the JS-side
   * routing in utils/locatorHealer.js.
   */
  protected By parseSelector(String raw) {
    if (raw == null) throw new IllegalArgumentException("null selector");
    String s = raw.trim();
    if (s.startsWith("xpath=")) return By.xpath(s.substring(6));
    if (s.startsWith("//"))     return By.xpath(s);
    if (s.startsWith("text="))  return By.xpath("//*[normalize-space(text())='" + s.substring(5).replace("'", "\\\\'") + "']");
    if (s.startsWith("role="))  return By.cssSelector("[role='" + s.substring(5) + "']");
    return By.cssSelector(s);
  }

  protected void scrollIntoView(WebElement el) {
    try {
      ((org.openqa.selenium.JavascriptExecutor) driver)
        .executeScript("arguments[0].scrollIntoView({block:'center', behavior:'instant'});", el);
    } catch (Exception ignore) {}
  }
}
`;
}

function locatorsJava({ steps }) {
  // Convert steps to a static map of element-name -> selector chain.
  const lines = [];
  lines.push('package support;');
  lines.push('');
  lines.push('import java.util.Arrays;');
  lines.push('import java.util.List;');
  lines.push('import java.util.Map;');
  lines.push('import java.util.HashMap;');
  lines.push('');
  lines.push('/**');
  lines.push(' * Generated locator chains. The first entry is the primary; the');
  lines.push(' * remaining entries are alternate strategies the recorder captured');
  lines.push(' * (data-testid, aria-label, role, text, etc).');
  lines.push(' */');
  lines.push('public final class Locators {');
  lines.push('  public static final Map<String, List<String>> CHAINS = new HashMap<>();');
  lines.push('  static {');
  let nameSeed = 0;
  for (const step of steps) {
    if (!step.selector) continue;
    const name = (step.normalizedDescription || step.description || `step${++nameSeed}`)
      .replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase();
    if (!name) continue;
    const chain = [step.selector];
    if (Array.isArray(step.fallbackSelectors)) {
      for (const s of step.fallbackSelectors) if (typeof s === 'string') chain.push(s);
    }
    if (Array.isArray(step.locatorCandidates)) {
      for (const c of step.locatorCandidates) {
        if (c && typeof c.selector === 'string') chain.push(c.selector);
      }
    }
    const dedup = Array.from(new Set(chain));
    const args = dedup.map((s) => `"${escapeJavaString(s)}"`).join(', ');
    lines.push(`    CHAINS.put("${name}", Arrays.asList(${args}));`);
  }
  lines.push('  }');
  lines.push('  private Locators() {}');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function testClassJava({ className, baseUrl, steps, scenarios }) {
  const lines = [];
  lines.push('import io.github.bonigarcia.wdm.WebDriverManager;');
  lines.push('import org.openqa.selenium.By;');
  lines.push('import org.openqa.selenium.WebDriver;');
  lines.push('import org.openqa.selenium.WebElement;');
  lines.push('import org.openqa.selenium.chrome.ChromeDriver;');
  lines.push('import org.openqa.selenium.chrome.ChromeOptions;');
  lines.push('import org.openqa.selenium.firefox.FirefoxDriver;');
  lines.push('import org.openqa.selenium.firefox.FirefoxOptions;');
  lines.push('import org.openqa.selenium.remote.RemoteWebDriver;');
  lines.push('import org.openqa.selenium.safari.SafariDriver;');
  lines.push('import org.openqa.selenium.safari.SafariOptions;');
  lines.push('import org.testng.Assert;');
  lines.push('import org.testng.annotations.AfterMethod;');
  lines.push('import org.testng.annotations.BeforeMethod;');
  lines.push('import org.testng.annotations.Test;');
  lines.push('import support.BasePage;');
  lines.push('import support.CredentialsHelper;');
  lines.push('import support.Locators;');
  lines.push('import java.net.URL;');
  lines.push('');
  // [ZAC-FIX 2026-05-24] Selenium Grid + browser-type override hooks
  // for the TestNG path (parity with the Cucumber selenium-java World).
  // Same env / JVM-prop precedence so QA can flip between local and a
  // hub without recompiling.
  lines.push(`public class ${className}Test {`);
  lines.push('  private WebDriver driver;');
  lines.push('  private BasePage page;');
  lines.push('');
  lines.push('  /** Pick browser via ZAC_BROWSER env or zac.browser system property; default chrome. */');
  lines.push('  private static String resolveBrowserType() {');
  lines.push('    String env = System.getenv("ZAC_BROWSER");      if (env  != null && !env.isEmpty())  return env;');
  lines.push('    String prop= System.getProperty("zac.browser"); if (prop != null && !prop.isEmpty()) return prop;');
  lines.push('    return "chrome";');
  lines.push('  }');
  lines.push('  /** Hub URL via SELENIUM_HUB_URL env or zac.seleniumHubUrl property; null = local. */');
  lines.push('  private static String resolveHubUrl() {');
  lines.push('    String env = System.getenv("SELENIUM_HUB_URL");        if (env  != null && !env.isEmpty())  return env;');
  lines.push('    String prop= System.getProperty("zac.seleniumHubUrl"); if (prop != null && !prop.isEmpty()) return prop;');
  lines.push('    return null;');
  lines.push('  }');
  lines.push('');
  lines.push('  @BeforeMethod');
  lines.push('  public void setUp() throws Exception {');
  lines.push('    String browserType = resolveBrowserType();');
  lines.push('    String hubUrl      = resolveHubUrl();');
  lines.push('    ChromeOptions chromeOpts   = new ChromeOptions();');
  lines.push('    chromeOpts.addArguments("--start-maximized");');
  lines.push('    chromeOpts.addArguments("--disable-blink-features=AutomationControlled");');
  lines.push('    FirefoxOptions firefoxOpts = new FirefoxOptions();');
  lines.push('    SafariOptions  safariOpts  = new SafariOptions();');
  lines.push('    if (hubUrl != null) {');
  lines.push('      // ── Selenium Grid path ──');
  lines.push('      System.out.println("[TestNG] Using Grid: " + hubUrl + " (browser=" + browserType + ")");');
  lines.push('      switch (browserType.toLowerCase()) {');
  lines.push('        case "firefox": driver = new RemoteWebDriver(new URL(hubUrl), firefoxOpts); break;');
  lines.push('        case "safari":  driver = new RemoteWebDriver(new URL(hubUrl), safariOpts);  break;');
  lines.push('        default:        driver = new RemoteWebDriver(new URL(hubUrl), chromeOpts);  break;');
  lines.push('      }');
  lines.push('    } else {');
  lines.push('      // ── Local driver path (WebDriverManager auto-resolves binaries) ──');
  lines.push('      switch (browserType.toLowerCase()) {');
  lines.push('        case "firefox": WebDriverManager.firefoxdriver().setup(); driver = new FirefoxDriver(firefoxOpts); break;');
  lines.push('        case "safari":  driver = new SafariDriver(safariOpts); break;');
  lines.push('        default:        WebDriverManager.chromedriver().setup(); driver = new ChromeDriver(chromeOpts); break;');
  lines.push('      }');
  lines.push('    }');
  lines.push('    try { driver.manage().window().maximize(); } catch (Exception ignored) { /* not all grid nodes support */ }');
  lines.push('    page = new BasePage(driver);');
  lines.push('  }');
  lines.push('');
  // [ZAC-FIX 2026-05-24] Failure screenshot — required for parity
  // with the other 3 frameworks. TestNG passes ITestResult into
  // @AfterMethod; status==FAILURE means a @Test threw or an assert
  // tripped. Save the PNG into target/screenshots/<test>-<ts>.png so
  // it survives the next run and is easy to attach in Allure.
  lines.push('  @AfterMethod');
  lines.push('  public void tearDown(org.testng.ITestResult result) {');
  lines.push('    try {');
  lines.push('      if (result != null && result.getStatus() == org.testng.ITestResult.FAILURE && driver != null) {');
  lines.push('        byte[] png = ((org.openqa.selenium.TakesScreenshot) driver)');
  lines.push('            .getScreenshotAs(org.openqa.selenium.OutputType.BYTES);');
  lines.push('        java.nio.file.Path dir = java.nio.file.Paths.get("target", "screenshots");');
  lines.push('        java.nio.file.Files.createDirectories(dir);');
  lines.push('        String safe = result.getName().replaceAll("[^A-Za-z0-9._-]+", "_");');
  lines.push('        String ts = String.valueOf(System.currentTimeMillis());');
  lines.push('        java.nio.file.Path out = dir.resolve("failure-" + safe + "-" + ts + ".png");');
  lines.push('        java.nio.file.Files.write(out, png);');
  lines.push('        System.err.println("[ZAC] Failure screenshot saved: " + out.toAbsolutePath());');
  lines.push('      }');
  lines.push('    } catch (Exception e) {');
  lines.push('      System.err.println("[ZAC] Failure-screenshot capture failed: " + e.getMessage());');
  lines.push('    } finally {');
  lines.push('      if (driver != null) driver.quit();');
  lines.push('    }');
  lines.push('  }');
  lines.push('');
  // [ZAC-FIX] When scenario structure is available, emit one @Test method per
  // scenario (with @DataProvider for Scenario Outlines) instead of collapsing
  // everything into a single method. The locator-name seed is shared across
  // all methods so the generated names stay aligned with the Locators map,
  // which is built from the same flat step order.
  const seedRef = { n: 0 };
  if (Array.isArray(scenarios) && scenarios.length) {
    emitScenarioMethods({ lines, scenarios, baseUrl, seedRef });
    lines.push(`}`);
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`  @Test(description = "Recorded flow → ${escapeJavaString(className)}")`);
  lines.push(`  public void test${className}() {`);
  lines.push(`    driver.get("${escapeJavaString(baseUrl || 'about:blank')}");`);
  emitStepStatements({ lines, steps, seedRef });
  lines.push(`  }`);
  lines.push(`}`);
  lines.push('');
  return lines.join('\n');
}

// [ZAC-FIX] Shared step-statement emitter. `examples` (when set) lets a value
// that matches a Scenario-Outline example column be substituted with a lookup
// into the DataProvider row (row.get("col")) instead of a hard-coded literal.
function emitStepStatements({ lines, steps, seedRef, examples = null }) {
  for (const step of steps) {
    const kind = step.kind || step.action;
    const name = (step.normalizedDescription || step.description || `step${++seedRef.n}`)
      .replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase();

    switch (kind) {
      case 'navigate':
        if (step.url) lines.push(`    driver.get("${escapeJavaString(step.url)}");`);
        break;
      case 'click': {
        lines.push(`    {`);
        lines.push(`      WebElement e = page.findWithHealing(Locators.CHAINS.get("${name}"));`);
        lines.push(`      e.click();`);
        lines.push(`    }`);
        break;
      }
      case 'type': {
        // CredentialsHelper.resolve handles the ${VAR} placeholder; the
        // value is never echoed to logs. [ZAC-FIX] In a Scenario Outline, a
        // value that matches an Examples column is read from the DataProvider
        // row instead of being hard-coded.
        const typeCol = colForValue(step.value, examples);
        const valueExpr = typeCol ? `row.get("${escapeJavaString(typeCol)}")` : `"${escapeJavaString(step.value || '')}"`;
        lines.push(`    {`);
        lines.push(`      WebElement e = page.findWithHealing(Locators.CHAINS.get("${name}"));`);
        lines.push(`      String resolved = CredentialsHelper.resolve(${valueExpr});`);
        lines.push(`      e.clear();`);
        lines.push(`      e.sendKeys(resolved);`);
        lines.push(`    }`);
        break;
      }
      case 'select': {
        const valueLit = `"${escapeJavaString(step.value || step.selectedText || '')}"`;
        lines.push(`    {`);
        lines.push(`      WebElement e = page.findWithHealing(Locators.CHAINS.get("${name}"));`);
        lines.push(`      new org.openqa.selenium.support.ui.Select(e).selectByVisibleText(${valueLit});`);
        lines.push(`    }`);
        break;
      }
      case 'hover': {
        lines.push(`    {`);
        lines.push(`      WebElement e = page.findWithHealing(Locators.CHAINS.get("${name}"));`);
        lines.push(`      new org.openqa.selenium.interactions.Actions(driver).moveToElement(e).perform();`);
        lines.push(`    }`);
        break;
      }
      // [ZAC-FIX] doubleClick via the Actions class — mirrors the Cucumber
      // Java generator. Previously fell through to "// [unsupported]".
      case 'doubleClick': {
        lines.push(`    {`);
        lines.push(`      WebElement e = page.findWithHealing(Locators.CHAINS.get("${name}"));`);
        lines.push(`      new org.openqa.selenium.interactions.Actions(driver).doubleClick(e).perform();`);
        lines.push(`    }`);
        break;
      }
      // [ZAC-FIX] JS-executor click — bypasses overlay/interceptor issues.
      case 'jsClick': {
        lines.push(`    {`);
        lines.push(`      WebElement e = page.findWithHealing(Locators.CHAINS.get("${name}"));`);
        lines.push(`      ((org.openqa.selenium.JavascriptExecutor) driver).executeScript("arguments[0].click();", e);`);
        lines.push(`    }`);
        break;
      }
      // [ZAC-FIX] DB query assertion — env-configured JDBC (defaults to
      // in-memory H2 for zero-setup), assert row count via TestNG Assert.
      case 'dbQuery': {
        const sql = escapeJavaString(step.query || step.value || 'SELECT 1');
        const expectedRows = Number.isFinite(Number(step.expectedRows)) ? Number(step.expectedRows) : 1;
        lines.push(`    {`);
        lines.push(`      String dbUrl  = System.getenv().getOrDefault("DB_URL", "jdbc:h2:mem:testdb;DB_CLOSE_DELAY=-1");`);
        lines.push(`      String dbUser = System.getenv().getOrDefault("DB_USER", "sa");`);
        lines.push(`      String dbPass = System.getenv().getOrDefault("DB_PASS", "");`);
        lines.push(`      try (java.sql.Connection c = java.sql.DriverManager.getConnection(dbUrl, dbUser, dbPass);`);
        lines.push(`           java.sql.Statement st = c.createStatement();`);
        lines.push(`           java.sql.ResultSet rs = st.executeQuery("${sql}")) {`);
        lines.push(`        int count = 0; while (rs.next()) count++;`);
        lines.push(`        Assert.assertEquals(count, ${expectedRows}, "DB row count mismatch for [${sql}]");`);
        lines.push(`      } catch (java.sql.SQLException ex) { throw new RuntimeException(ex); }`);
        lines.push(`    }`);
        break;
      }
      // [ZAC-FIX] waitForSelector — reuse the healing finder, which polls for
      // presence/visibility, instead of skipping the wait entirely.
      case 'waitForSelector': {
        lines.push(`    {`);
        lines.push(`      WebElement e = page.findWithHealing(Locators.CHAINS.get("${name}")); // explicit wait for element`);
        lines.push(`      org.testng.Assert.assertNotNull(e, "waitForSelector: element never appeared");`);
        lines.push(`    }`);
        break;
      }
      case 'check': {
        lines.push(`    {`);
        lines.push(`      WebElement e = page.findWithHealing(Locators.CHAINS.get("${name}"));`);
        lines.push(`      if (!e.isSelected()) e.click();`);
        lines.push(`    }`);
        break;
      }
      case 'uncheck': {
        lines.push(`    {`);
        lines.push(`      WebElement e = page.findWithHealing(Locators.CHAINS.get("${name}"));`);
        lines.push(`      if (e.isSelected()) e.click();`);
        lines.push(`    }`);
        break;
      }
      case 'selectRadio': {
        lines.push(`    {`);
        lines.push(`      WebElement e = page.findWithHealing(Locators.CHAINS.get("${name}"));`);
        lines.push(`      if (!e.isSelected()) e.click();`);
        lines.push(`    }`);
        break;
      }
      case 'scroll': {
        const x = Number(step.scrollX || 0), y = Number(step.scrollY || 0);
        lines.push(`    ((org.openqa.selenium.JavascriptExecutor) driver).executeScript("window.scrollTo(${x}, ${y});");`);
        break;
      }
      case 'assertText': {
        // [ZAC-FIX] also accept step.value — the recorder stores the expected
        // text there for asserts added from the UI; without it the generated
        // assertion degraded to contains("") which trivially passes.
        const expected = `"${escapeJavaString(step.expectedValue || step.text || step.value || '')}"`;
        lines.push(`    {`);
        lines.push(`      WebElement e = page.findWithHealing(Locators.CHAINS.get("${name}"));`);
        lines.push(`      Assert.assertTrue(e.getText().contains(${expected}), "expected text not found");`);
        lines.push(`    }`);
        break;
      }
      case 'assertVisible': {
        lines.push(`    {`);
        lines.push(`      WebElement e = page.findWithHealing(Locators.CHAINS.get("${name}"));`);
        lines.push(`      Assert.assertTrue(e.isDisplayed(), "element not visible");`);
        lines.push(`    }`);
        break;
      }
      // [ZAC-FIX] assertValue / assertChecked — parity with the other
      // frameworks; previously skipped as "// [unsupported]".
      case 'assertValue': {
        const expected = `"${escapeJavaString(step.expectedValue || step.value || step.text || '')}"`;
        lines.push(`    {`);
        lines.push(`      WebElement e = page.findWithHealing(Locators.CHAINS.get("${name}"));`);
        lines.push(`      Assert.assertEquals(e.getAttribute("value"), ${expected}, "value mismatch");`);
        lines.push(`    }`);
        break;
      }
      case 'assertChecked': {
        lines.push(`    {`);
        lines.push(`      WebElement e = page.findWithHealing(Locators.CHAINS.get("${name}"));`);
        lines.push(`      Assert.assertTrue(e.isSelected(), "element not checked");`);
        lines.push(`    }`);
        break;
      }
      case 'assertNotChecked': {
        lines.push(`    {`);
        lines.push(`      WebElement e = page.findWithHealing(Locators.CHAINS.get("${name}"));`);
        lines.push(`      Assert.assertFalse(e.isSelected(), "element unexpectedly checked");`);
        lines.push(`    }`);
        break;
      }
      case 'waitFor': {
        const ms = Number(step.ms || 500);
        lines.push(`    try { Thread.sleep(${ms}); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }`);
        break;
      }
      default:
        lines.push(`    // [unsupported] step kind="${escapeJavaString(kind || 'unknown')}" — skipped`);
    }
  }
}

// [ZAC-FIX] Return the example column whose recorded values include `value`,
// so a Scenario-Outline step value can be swapped for a DataProvider lookup.
function colForValue(value, examples) {
  if (!examples || !examples.length || value == null || value === '') return null;
  for (const col of Object.keys(examples[0] || {})) {
    if (examples.some((row) => String(row[col]) === String(value))) return col;
  }
  return null;
}

// [ZAC-FIX] Emit one @Test method per scenario. Scenario Outlines become a
// @DataProvider (rows from the Examples table) + a data-driven @Test that
// receives a Map<String,String> row; step values matching an example column
// are read from the row. Plain scenarios become a simple @Test.
function emitScenarioMethods({ lines, scenarios, baseUrl, seedRef }) {
  const used = new Set();
  scenarios.forEach((sc, idx) => {
    const steps = Array.isArray(sc.steps) ? sc.steps : [];
    let method = safeJavaIdentifier(sc.title || sc.name || `scenario${idx + 1}`);
    if (!method) method = `scenario${idx + 1}`;
    method = `test${method}`;
    while (used.has(method)) method = `${method}_${idx + 1}`;
    used.add(method);
    const desc = escapeJavaString(sc.title || sc.name || `Scenario ${idx + 1}`);
    const isOutline = sc.useScenarioOutline && Array.isArray(sc.examples) && sc.examples.length > 0;

    if (isOutline) {
      const cols = Object.keys(sc.examples[0] || {});
      const dp = `${method}Data`;
      lines.push(`  @org.testng.annotations.DataProvider(name = "${dp}")`);
      lines.push(`  public Object[][] ${dp}() {`);
      lines.push(`    return new Object[][] {`);
      sc.examples.forEach((row) => {
        const entries = cols.map((c) => `put("${escapeJavaString(c)}", "${escapeJavaString(String(row[c]))}");`).join(' ');
        lines.push(`      { new java.util.HashMap<String,String>() {{ ${entries} }} },`);
      });
      lines.push(`    };`);
      lines.push(`  }`);
      lines.push(`  @Test(dataProvider = "${dp}", description = "${desc}")`);
      lines.push(`  public void ${method}(java.util.Map<String,String> row) {`);
      lines.push(`    driver.get("${escapeJavaString(baseUrl || 'about:blank')}");`);
      emitStepStatements({ lines, steps, seedRef, examples: sc.examples });
      lines.push(`  }`);
      lines.push('');
    } else {
      lines.push(`  @Test(description = "${desc}")`);
      lines.push(`  public void ${method}() {`);
      lines.push(`    driver.get("${escapeJavaString(baseUrl || 'about:blank')}");`);
      emitStepStatements({ lines, steps, seedRef });
      lines.push(`  }`);
      lines.push('');
    }
  });
}

function locatorsJson({ steps }) {
  const out = {};
  let nameSeed = 0;
  for (const step of steps) {
    if (!step.selector) continue;
    const name = (step.normalizedDescription || step.description || `step${++nameSeed}`)
      .replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase();
    if (!name) continue;
    const chain = [step.selector];
    if (Array.isArray(step.fallbackSelectors)) {
      for (const s of step.fallbackSelectors) if (typeof s === 'string') chain.push(s);
    }
    if (Array.isArray(step.locatorCandidates)) {
      for (const c of step.locatorCandidates) if (c?.selector) chain.push(c.selector);
    }
    out[name] = { chain: Array.from(new Set(chain)) };
  }
  return JSON.stringify(out, null, 2);
}

function readme({ projectName, className, baseUrl, stepCount }) {
  return `# ${projectName}

Generated by ZAC — Selenium WebDriver + Java + TestNG.

## Layout

\`\`\`
pom.xml
src/test/resources/testng.xml
src/test/java/${className}Test.java       — TestNG test class
src/test/java/support/BasePage.java       — page-object base + healing chain
src/test/java/support/CredentialsHelper.java — \${ENV_VAR} resolver
src/test/java/support/Locators.java       — generated locator chains
locators.json                              — same chains in JSON
\`\`\`

## Running

\`\`\`
mvn clean test
\`\`\`

## Recorded session

- Base URL: \`${baseUrl || 'about:blank'}\`
- Steps:    \`${stepCount}\`

## Credentials

Any step value of the form \`\${VAR_NAME}\` is resolved at runtime against the
process environment via \`support.CredentialsHelper.resolve(...)\`. **Never**
hard-code real credentials in the test class — they will leak to logs and
to git. Set them in your shell instead:

\`\`\`
export AMAZON_USERNAME='your.email@example.com'
export AMAZON_PASSWORD='your-password'
mvn clean test
\`\`\`

## Self-healing locators

Each interactive step in this project resolves through
\`BasePage.findWithHealing(chain)\`:

  - Primary selector tried first (the recorder's top-ranked candidate).
  - On failure, alternates are tried in recorded order.
  - Ambiguous matches (>1 element) are skipped — we never silently click
    the wrong element.
  - When the entire chain is exhausted, the test fails with a clear error
    listing every selector that was attempted.
`;
}

/* -------------------------------------------------------------------------- *
 *  Public entrypoint                                                         *
 * -------------------------------------------------------------------------- */

/**
 * @param {Object} ctx          see generators/PLUGIN.md#GenerateContext
 * @returns {Object}            see generators/PLUGIN.md#GenerateResult
 */
export function generateProject(ctx) {
  const projectName = ctx.projectName || 'recorded-project';
  const className = safeJavaIdentifier(ctx.featureTitle || ctx.featureName || projectName);
  const steps = Array.isArray(ctx.steps) ? ctx.steps : [];
  // [ZAC-FIX] Optional scenario structure — enables per-scenario @Test methods
  // and @DataProvider-driven Scenario Outlines. Only use scenarios that
  // actually carry steps; otherwise fall back to the flat step list.
  const scenarios = (Array.isArray(ctx.scenarios) ? ctx.scenarios : [])
    .filter((s) => s && Array.isArray(s.steps) && s.steps.length > 0);
  const baseUrl = ctx.baseUrl || (steps.find((s) => s?.kind === 'navigate')?.url) || 'about:blank';

  // [ZAC-FIX] The Locators map must be built from the SAME step order that the
  // test methods emit, or findWithHealing lookups miss. When we render
  // per-scenario methods, the names come from the scenarios flattened in
  // order; otherwise from the flat step list.
  const locatorSteps = scenarios.length ? scenarios.flatMap((s) => s.steps) : steps;

  const files = {
    'pom.xml': pomXml({ projectName }),
    'src/test/resources/testng.xml': testngXml({ className }),
    [`src/test/java/${className}Test.java`]: testClassJava({ className, baseUrl, steps, scenarios }),
    'src/test/java/support/BasePage.java': basePageJava(),
    'src/test/java/support/CredentialsHelper.java': credentialsHelperJava(),
    'src/test/java/support/Locators.java': locatorsJava({ steps: locatorSteps }),
    'locators.json': locatorsJson({ steps: locatorSteps }),
    'README.md': readme({ projectName, className, baseUrl, stepCount: locatorSteps.length }),
  };

  return {
    files,
    surfaced: {
      runnerEntryPoint: 'pom.xml',
      primaryTestFile: `src/test/java/${className}Test.java`,
      readme: 'README.md',
    },
    postWrite: [
      'mvn -q dependency:resolve',
    ],
  };
}
