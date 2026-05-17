package support;

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
    if (s.startsWith("text="))  return By.xpath("//*[normalize-space(text())='" + s.substring(5).replace("'", "\\'") + "']");
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
