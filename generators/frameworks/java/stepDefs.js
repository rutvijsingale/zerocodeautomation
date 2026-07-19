/**
 * generators/frameworks/java/stepDefs.js
 * Generates Java Cucumber step definitions for Playwright and Selenium frameworks.
 * This is a single function covering both frameworks with internal branching — do not split.
 */

import { isPlaywrightJava, generatePageUrlMappingCode, getNavigationAction, toCamelCase, capitalize } from './helpers.js';

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
  // This ensures standard steps are always available for both frameworks
  const commonSteps = {
    'Given I navigate to {string}': true,
    'When I click {string}': true,
    'And I click {string}': true,
    'When I type {string} into {string}': true,
    'And I type {string} into {string}': true,
    'When I select {string} from {string}': true,
    'And I select {string} from {string}': true,
    'Then I should see {string} in {string}': true,
    'Then {string} should be visible': true,
    'And I close the browser': true
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
    lines.push('    static {');
    selectorMap.forEach((selectorData, description) => {
      // Escape quotes in selectors and description
      const escapedDesc = description.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const allSelectors = [selectorData.primary, ...selectorData.fallbacks];
      const escapedSelectors = allSelectors.map(s => 
        s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      );
      lines.push(`        java.util.List<String> selectors_${description.replace(/[^a-zA-Z0-9]/g, '_')} = new java.util.ArrayList<>();`);
      escapedSelectors.forEach(sel => {
        lines.push(`        selectors_${description.replace(/[^a-zA-Z0-9]/g, '_')}.add("${sel}");`);
      });
      lines.push(`        SELECTOR_MAP.put("${escapedDesc}", selectors_${description.replace(/[^a-zA-Z0-9]/g, '_')});`);
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
        const typeAction = isPlaywrightJava(framework)
          ? ['getPage().fill(selector, value);']
          : [
              'WebElement input = getDriver().findElement(By.cssSelector(selector));',
              'input.clear();',
              'input.sendKeys(value);'
            ];
        lines.push(...typeAction.map(line => `        ${line}`));
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

export { generateJavaStepDefinitions };
