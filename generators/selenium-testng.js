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

function testClassJava({ className, baseUrl, steps }) {
  const lines = [];
  lines.push('import io.github.bonigarcia.wdm.WebDriverManager;');
  lines.push('import org.openqa.selenium.By;');
  lines.push('import org.openqa.selenium.WebDriver;');
  lines.push('import org.openqa.selenium.WebElement;');
  lines.push('import org.openqa.selenium.chrome.ChromeDriver;');
  lines.push('import org.openqa.selenium.chrome.ChromeOptions;');
  lines.push('import org.testng.Assert;');
  lines.push('import org.testng.annotations.AfterMethod;');
  lines.push('import org.testng.annotations.BeforeMethod;');
  lines.push('import org.testng.annotations.Test;');
  lines.push('import support.BasePage;');
  lines.push('import support.CredentialsHelper;');
  lines.push('import support.Locators;');
  lines.push('');
  lines.push(`public class ${className}Test {`);
  lines.push('  private WebDriver driver;');
  lines.push('  private BasePage page;');
  lines.push('');
  lines.push('  @BeforeMethod');
  lines.push('  public void setUp() {');
  lines.push('    WebDriverManager.chromedriver().setup();');
  lines.push('    ChromeOptions opts = new ChromeOptions();');
  // Always start maximized — matches the recorder + rerun contract.
  lines.push('    opts.addArguments("--start-maximized");');
  lines.push('    driver = new ChromeDriver(opts);');
  lines.push('    page = new BasePage(driver);');
  lines.push('  }');
  lines.push('');
  lines.push('  @AfterMethod');
  lines.push('  public void tearDown() {');
  lines.push('    if (driver != null) driver.quit();');
  lines.push('  }');
  lines.push('');
  lines.push(`  @Test(description = "Recorded flow → ${escapeJavaString(className)}")`);
  lines.push(`  public void test${className}() {`);
  lines.push(`    driver.get("${escapeJavaString(baseUrl || 'about:blank')}");`);

  let nameSeed = 0;
  for (const step of steps) {
    const kind = step.kind || step.action;
    const name = (step.normalizedDescription || step.description || `step${++nameSeed}`)
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
        // value is never echoed to logs.
        const valueLit = `"${escapeJavaString(step.value || '')}"`;
        lines.push(`    {`);
        lines.push(`      WebElement e = page.findWithHealing(Locators.CHAINS.get("${name}"));`);
        lines.push(`      String resolved = CredentialsHelper.resolve(${valueLit});`);
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
      case 'scroll': {
        const x = Number(step.scrollX || 0), y = Number(step.scrollY || 0);
        lines.push(`    ((org.openqa.selenium.JavascriptExecutor) driver).executeScript("window.scrollTo(${x}, ${y});");`);
        break;
      }
      case 'assertText': {
        const expected = `"${escapeJavaString(step.expectedValue || step.text || '')}"`;
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
      case 'waitFor': {
        const ms = Number(step.ms || 500);
        lines.push(`    try { Thread.sleep(${ms}); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }`);
        break;
      }
      default:
        lines.push(`    // [unsupported] step kind="${escapeJavaString(kind || 'unknown')}" — skipped`);
    }
  }

  lines.push(`  }`);
  lines.push(`}`);
  lines.push('');
  return lines.join('\n');
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
  const baseUrl = ctx.baseUrl || (steps.find((s) => s?.kind === 'navigate')?.url) || 'about:blank';

  const files = {
    'pom.xml': pomXml({ projectName }),
    'src/test/resources/testng.xml': testngXml({ className }),
    [`src/test/java/${className}Test.java`]: testClassJava({ className, baseUrl, steps }),
    'src/test/java/support/BasePage.java': basePageJava(),
    'src/test/java/support/CredentialsHelper.java': credentialsHelperJava(),
    'src/test/java/support/Locators.java': locatorsJava({ steps }),
    'locators.json': locatorsJson({ steps }),
    'README.md': readme({ projectName, className, baseUrl, stepCount: steps.length }),
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
