/**
 * Page Object Generators
 * Generates Page Object classes for Java Selenium and Playwright TypeScript
 */

import { LocatorDefinition } from '../models/LocatorDefinition.js';

/**
 * Generate Java Selenium BasePage class with explicit wait helpers
 * @param {Object} options - Generation options
 * @param {number} options.defaultTimeout - Default timeout in seconds
 * @returns {string} Generated BasePage.java code
 */
export function generateSeleniumBasePage(options = {}) {
  const timeout = options.defaultTimeout || 10;
  
  return `package pages;

import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.PageFactory;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;
import java.time.Duration;

/**
 * BasePage - Provides common page object functionality with explicit waits
 * All page objects should extend this class
 */
public class BasePage {
    protected WebDriver driver;
    protected WebDriverWait wait;
    
    public BasePage(WebDriver driver) {
        this.driver = driver;
        this.wait = new WebDriverWait(driver, Duration.ofSeconds(${timeout}));
        PageFactory.initElements(driver, this);
    }
    
    /**
     * Click an element with explicit wait for clickability
     */
    protected void click(WebElement element) {
        wait.until(ExpectedConditions.elementToBeClickable(element)).click();
    }
    
    /**
     * Type text into an element with explicit wait for visibility
     */
    protected void type(WebElement element, String text) {
        wait.until(ExpectedConditions.visibilityOf(element));
        element.clear();
        element.sendKeys(text);
    }
    
    /**
     * Get text from an element with explicit wait for visibility
     */
    protected String getText(WebElement element) {
        return wait.until(ExpectedConditions.visibilityOf(element)).getText();
    }
    
    /**
     * Wait for element to be visible
     */
    protected WebElement waitForVisible(WebElement element) {
        return wait.until(ExpectedConditions.visibilityOf(element));
    }
    
    /**
     * Wait for element to be clickable
     */
    protected WebElement waitForClickable(WebElement element) {
        return wait.until(ExpectedConditions.elementToBeClickable(element));
    }
    
    /**
     * Check if element is visible
     */
    protected boolean isVisible(WebElement element) {
        try {
            return wait.until(ExpectedConditions.visibilityOf(element)) != null;
        } catch (Exception e) {
            return false;
        }
    }
    
    /**
     * Wait for URL to contain text
     */
    protected void waitForUrlContains(String text) {
        wait.until(ExpectedConditions.urlContains(text));
    }
    
    /**
     * Navigate to URL
     */
    protected void navigateTo(String url) {
        driver.get(url);
        waitForPageLoad();
    }
    
    /**
     * Wait for page to load (basic implementation)
     */
    protected void waitForPageLoad() {
        wait.until(ExpectedConditions.jsReturnsValue("return document.readyState === 'complete'"));
    }
}
`;
}

/**
 * Generate Java Selenium Page Object class
 * @param {string} pageName - Page name (e.g., "LoginPage")
 * @param {Array<LocatorDefinition>} locators - Locators for this page
 * @param {Object} options - Generation options
 * @returns {string} Generated Page.java code
 */
export function generateSeleniumPageObject(pageName, locators = [], options = {}) {
  const className = `${pageName}Page`;
  const basePage = options.basePage || 'BasePage';
  
  // Generate @FindBy annotations for each locator
  const fields = locators.map(loc => {
    const fieldName = toCamelCase(loc.elementName);
    const findByAnnotation = getFindByAnnotation(loc);
    return `    @FindBy(${findByAnnotation})
    private WebElement ${fieldName};`;
  }).join('\n\n');
  
  // Generate public methods for high-level operations
  const methods = generatePageObjectMethods(locators, 'selenium');
  
  return `package pages;

import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.FindBy;
import org.openqa.selenium.support.How;
import org.openqa.selenium.support.ui.Select;

/**
 * ${className} - Page Object for ${pageName}
 * Generated automatically from locator repository
 */
public class ${className} extends ${basePage} {
    
    public ${className}(WebDriver driver) {
        super(driver);
    }
    
${fields ? fields + '\n' : ''}
${methods}
}
`;
}

/**
 * Generate Playwright TypeScript Page Object class
 * @param {string} pageName - Page name (e.g., "LoginPage")
 * @param {Array<LocatorDefinition>} locators - Locators for this page
 * @param {Object} options - Generation options
 * @returns {string} Generated Page.ts code
 */
export function generatePlaywrightPageObject(pageName, locators = [], options = {}) {
  const className = `${pageName}Page`;
  
  // Generate locator properties
  const locatorProperties = locators.map(loc => {
    const propertyName = toCamelCase(loc.elementName);
    const locatorCode = getPlaywrightLocatorCode(loc);
    return `  get ${propertyName}() {
    return ${locatorCode};
  }`;
  }).join('\n\n');
  
  // Generate public methods for high-level operations
  const methods = generatePageObjectMethods(locators, 'playwright');
  
  return `import { Page, Locator } from '@playwright/test';

/**
 * ${className} - Page Object for ${pageName}
 * Generated automatically from locator repository
 */
export class ${className} {
  constructor(private page: Page) {}
  
${locatorProperties ? locatorProperties + '\n' : ''}
${methods}
}
`;
}

/**
 * Get @FindBy annotation for a locator
 * @param {LocatorDefinition} locator - Locator definition
 * @returns {string} FindBy annotation string
 */
function getFindByAnnotation(locator) {
  const raw = locator.locatorValue || '';
  // Selenium's @FindBy(id = ...) expects the bare id (no leading "#"). The
  // recorder/inferLocatorType labels things "id" when the selector starts
  // with "#", so we have to strip the prefix here. Same for [name="x"] and
  // [data-testid="x"] which the recorder normalises to type "name"/"testId".
  const stripHashId = (v) => v.replace(/^#/, '');
  const stripBracket = (v, attr) => {
    const m = v.match(new RegExp('^\\\[' + attr + '=(?:"|\\\')([^"\\\']+)(?:"|\\\')\\\]$'));
    return m ? m[1] : v;
  };
  const escape = (v) => String(v).replace(/"/g, '\\"');

  // [ZAC-FIX] Bug 1 — `text` case produced invalid XPath when the text
  // contained an apostrophe (e.g. "don't") because XPath 1.0 has NO
  // escape syntax for quote characters inside its string literals. The
  // *only* correct strategies are:
  //   • Wrap in '...' when the text has no '         (preferred)
  //   • Wrap in "..."  when it has no "
  //   • Use concat('a', "'", 'b') when both are present
  // After picking the XPath wrapping, every literal " (whether from the
  // outer wrap or from the value) must still be escaped for the
  // surrounding Java double-quoted string literal — JavaScript template
  // produces "\\\"" → JS string "\\"" → output `\"` → Java sees `"`.
  function xpathTextLiteralForJava(text) {
    const hasSingle = text.includes("'");
    const hasDouble = text.includes('"');
    // Java-escape any literal " inside `s` so it survives the surrounding
    // Java "..." string. Bare " would otherwise terminate the literal.
    const j = (s) => String(s).replace(/"/g, '\\"');

    if (!hasSingle && !hasDouble) {
      // Plain text — XPath 'text' wrapped in Java "..." needs no escapes.
      return `'${text}'`;
    }
    if (!hasSingle) {
      // Value contains ", but no '. XPath wraps in '...'; the inner "
      // chars are literal in XPath but still need Java-escaping.
      return `'${j(text)}'`;
    }
    if (!hasDouble) {
      // Value contains ', but no ". XPath wraps in "..."; both the
      // wrapping quotes and any value " (none here) are Java-escaped.
      return `${j('"')}${text}${j('"')}`;
    }
    // Both ' and " present in the value. XPath has no native escape so
    // we splice via concat(). Split on ' to get chunks (none of which
    // contain '), wrap each in '...', join with the literal "'" string
    // — which itself needs Java-escaping.
    const chunks = text.split("'").map((piece) => `'${j(piece)}'`);
    const apostropheLiteral = `${j('"')}'${j('"')}`; // → \"'\"
    return `concat(${chunks.join(`, ${apostropheLiteral}, `)})`;
  }

  switch (locator.locatorType) {
    case 'css':
      return `css = "${escape(raw)}"`;
    case 'xpath':
      return `xpath = "${escape(raw)}"`;
    case 'id':
      return `id = "${escape(stripHashId(raw))}"`;
    case 'name':
      return `name = "${escape(stripBracket(raw, 'name'))}"`;
    case 'testId':
      // Selenium has no native testId locator; fall back to css with the
      // raw [data-testid="..."] selector which is the most stable form.
      return `css = "${escape(raw)}"`;
    case 'role':
      return `css = "${escape(raw)}"`;
    case 'text': {
      // text= is Playwright; for Selenium, fall back to xpath that filters
      // by text. xpathTextLiteralForJava() handles every combination of
      // ' and " in the value (Bug 1 fix).
      const text = raw.replace(/^text=/, '');
      return `xpath = "//*[normalize-space(text())=${xpathTextLiteralForJava(text)}]"`;
    }
    default:
      return `css = "${escape(raw)}"`;
  }
}

/**
 * Get Playwright locator code for a locator
 * @param {LocatorDefinition} locator - Locator definition
 * @returns {string} Playwright locator code
 */
function getPlaywrightLocatorCode(locator) {
  const raw = locator.locatorValue || '';
  // Strip prefixes that the inferLocatorType heuristic added but that the
  // generator wraps again (e.g. "#searchInput" + "#" prefix would become
  // "##searchInput"). Keep raw strings if the prefix isn't present.
  const stripHash = (v) => v.replace(/^#/, '');
  const stripBracket = (v, attr) => {
    const m = v.match(new RegExp('^\\\[' + attr + '=(?:"|\\\')([^"\\\']+)(?:"|\\\')\\\]$'));
    return m ? m[1] : v;
  };
  const stripTestId = (v) => stripBracket(v, 'data-testid');
  const stripRole = (v) => v.replace(/^role=/, '');
  const stripText = (v) => v.replace(/^text=/, '');
  const escape = (v) => String(v).replace(/'/g, "\\'");

  switch (locator.locatorType) {
    case 'css':
      return `this.page.locator('${escape(raw)}')`;
    case 'xpath':
      return `this.page.locator('xpath=${escape(raw)}')`;
    case 'id':
      return `this.page.locator('#${escape(stripHash(raw))}')`;
    case 'name':
      return `this.page.locator('[name="${escape(stripBracket(raw, 'name'))}"]')`;
    case 'testId':
      return `this.page.getByTestId('${escape(stripTestId(raw))}')`;
    case 'role':
      return `this.page.getByRole('${escape(stripRole(raw))}')`;
    case 'text':
      return `this.page.getByText('${escape(stripText(raw))}')`;
    default:
      return `this.page.locator('${escape(raw)}')`;
  }
}

/**
 * Generate page object methods based on locators
 * @param {Array<LocatorDefinition>} locators - Locators
 * @param {string} framework - Framework type ('selenium' or 'playwright')
 * @returns {string} Generated methods code
 */
function generatePageObjectMethods(locators, framework) {
  const methods = [];
  
  // Generate click methods for buttons/links
  locators.forEach(loc => {
    const methodName = toCamelCase(loc.elementName);
    const lowerName = methodName.toLowerCase();
    
    if (lowerName.includes('button') || lowerName.includes('btn') || 
        lowerName.includes('link') || lowerName.includes('click')) {
      if (framework === 'selenium') {
        methods.push(`    /**
     * Click ${loc.elementName}
     */
    public void click${capitalize(methodName)}() {
        click(${methodName});
    }`);
      } else {
        methods.push(`  /**
   * Click ${loc.elementName}
   */
  async click${capitalize(methodName)}() {
    await this.${methodName}.click();
  }`);
      }
    }
    
    // Generate type methods for inputs
    if (lowerName.includes('input') || lowerName.includes('field') || 
        lowerName.includes('textbox') || lowerName.includes('search')) {
      if (framework === 'selenium') {
        methods.push(`    /**
     * Type text into ${loc.elementName}
     */
    public void type${capitalize(methodName)}(String text) {
        type(${methodName}, text);
    }`);
      } else {
        methods.push(`  /**
   * Type text into ${loc.elementName}
   */
  async type${capitalize(methodName)}(text: string) {
    await this.${methodName}.fill(text);
  }`);
      }
    }
    
    // Generate getText methods
    if (lowerName.includes('text') || lowerName.includes('label') || 
        lowerName.includes('message') || lowerName.includes('error')) {
      if (framework === 'selenium') {
        methods.push(`    /**
     * Get text from ${loc.elementName}
     */
    public String get${capitalize(methodName)}Text() {
        return getText(${methodName});
    }`);
      } else {
        methods.push(`  /**
   * Get text from ${loc.elementName}
   */
  async get${capitalize(methodName)}Text(): Promise<string> {
    return await this.${methodName}.textContent() || '';
  }`);
      }
    }
  });
  
  return methods.join('\n\n');
}

/**
 * Convert string to camelCase
 * @param {string} str - Input string
 * @returns {string} Camel case string
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
 * @param {string} str - Input string
 * @returns {string} Capitalized string
 */
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Generate all page objects for a project
 * @param {Object} pageLocatorsMap - Map of pageName -> Array<LocatorDefinition>
 * @param {string} framework - Framework type ('selenium-java' or 'playwright-ts')
 * @param {Object} options - Generation options
 * @returns {Object} Map of pageName -> generated code
 */
export function generateAllPageObjects(pageLocatorsMap, framework, options = {}) {
  const result = {};

  // Accept two input shapes:
  //   1. { pageName: [ { elementName, locatorType, locatorValue, ... }, ... ] }
  //   2. { pageName: { elementName: { selector, type } } }   <-- routes/api.js shape
  // Normalise to (1) so the Selenium / Playwright generators (which both .map
  // over `locators`) get a real array regardless of how the caller built it.
  const normaliseLocators = (locators) => {
    if (Array.isArray(locators)) return locators;
    if (locators && typeof locators === 'object') {
      return Object.entries(locators).map(([elementName, value]) => ({
        elementName,
        locatorType: value.type || value.locatorType || 'css',
        locatorValue: value.selector || value.locatorValue || '',
        fallbackLocators: value.fallbackLocators || [],
      }));
    }
    return [];
  };

  Object.entries(pageLocatorsMap).forEach(([pageName, locators]) => {
    const normalised = normaliseLocators(locators);
    if (framework === 'selenium-java') {
      result[pageName] = generateSeleniumPageObject(pageName, normalised, options);
    } else if (framework === 'playwright-ts') {
      result[pageName] = generatePlaywrightPageObject(pageName, normalised, options);
    }
  });

  return result;
}

