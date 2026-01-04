/**
 * Common Step Handlers - Browser-Compatible Version
 * 
 * This module provides shared utilities for the frontend:
 * - Converting steps to code (Playwright, Selenium, Gherkin)
 * - Normalizing step descriptions
 * - Validating step data
 */

/**
 * Generate Playwright TypeScript code for a step
 * @param {Object} step - Step action
 * @returns {string} Generated code line(s)
 */
function generatePlaywrightStepCode(step) {
  const lines = [];
  
  switch (step.kind) {
    case 'navigate':
      lines.push(`  await page.goto('${step.url}');`);
      break;
    case 'click':
      lines.push(`  await page.click(${JSON.stringify(step.selector)});`);
      break;
    case 'doubleClick':
      lines.push(`  await page.dblclick(${JSON.stringify(step.selector)});`);
      break;
    case 'type':
      lines.push(`  await page.fill(${JSON.stringify(step.selector)}, ${JSON.stringify(step.value || '')});`);
      break;
    case 'select':
      lines.push(`  await page.selectOption(${JSON.stringify(step.selector)}, ${JSON.stringify(step.value || step.selectedText || '')});`);
      break;
    case 'check':
      lines.push(`  await page.check(${JSON.stringify(step.selector)});`);
      break;
    case 'uncheck':
      lines.push(`  await page.uncheck(${JSON.stringify(step.selector)});`);
      break;
    case 'hover':
      lines.push(`  await page.hover(${JSON.stringify(step.selector)});`);
      break;
    case 'keyPress':
      lines.push(`  await page.keyboard.press('${step.key || step.value || 'Enter'}');`);
      break;
    case 'assertText':
      lines.push(`  await expect(page.locator(${JSON.stringify(step.selector)})).toContainText(${JSON.stringify(step.expectedValue || step.text)});`);
      break;
    case 'assertVisible':
      lines.push(`  await expect(page.locator(${JSON.stringify(step.selector)})).toBeVisible();`);
      break;
    case 'assertNotVisible':
      lines.push(`  await expect(page.locator(${JSON.stringify(step.selector)})).not.toBeVisible();`);
      break;
    case 'assertEnabled':
      lines.push(`  await expect(page.locator(${JSON.stringify(step.selector)})).toBeEnabled();`);
      break;
    case 'assertDisabled':
      lines.push(`  await expect(page.locator(${JSON.stringify(step.selector)})).toBeDisabled();`);
      break;
    case 'assertChecked':
      lines.push(`  await expect(page.locator(${JSON.stringify(step.selector)})).toBeChecked();`);
      break;
    case 'assertNotChecked':
      lines.push(`  await expect(page.locator(${JSON.stringify(step.selector)})).not.toBeChecked();`);
      break;
    case 'assertAttribute':
      const attrValue = step.expectedValue || '';
      if (step.assertionType === 'equals') {
        lines.push(`  await expect(page.locator(${JSON.stringify(step.selector)})).toHaveAttribute(${JSON.stringify(step.value)}, ${JSON.stringify(attrValue)});`);
      } else {
        lines.push(`  const attr = await page.locator(${JSON.stringify(step.selector)}).getAttribute(${JSON.stringify(step.value)});`);
        lines.push(`  expect(attr).${getAssertionMethod(step.assertionType)}(${JSON.stringify(attrValue)});`);
      }
      break;
    case 'assertCount':
      const count = parseInt(step.expectedValue) || 0;
      lines.push(`  await expect(page.locator(${JSON.stringify(step.selector)})).toHaveCount(${count});`);
      break;
    case 'assertValue':
      const val = step.expectedValue || '';
      if (step.assertionType === 'equals') {
        lines.push(`  await expect(page.locator(${JSON.stringify(step.selector)})).toHaveValue(${JSON.stringify(val)});`);
      } else {
        lines.push(`  const value = await page.locator(${JSON.stringify(step.selector)}).inputValue();`);
        lines.push(`  expect(value).${getAssertionMethod(step.assertionType)}(${JSON.stringify(val)});`);
      }
      break;
    case 'waitFor':
      lines.push(`  await page.waitForTimeout(${Number(step.ms) || 500});`);
      break;
    case 'waitForSelector':
      lines.push(`  await page.waitForSelector(${JSON.stringify(step.selector)});`);
      break;
    case 'screenshot':
      lines.push(`  await page.screenshot({ path: '${step.filename || 'screenshot.png'}' });`);
      break;
    case 'close':
      lines.push(`  await page.close();`);
      break;
    case 'apiCall':
      lines.push(`  const resp = await page.request.${(step.method || 'GET').toLowerCase()}('${step.url}');`);
      if (step.assertResponse) {
        lines.push(`  expect(resp.status()).toBe(${step.expectedStatus || 200});`);
      }
      break;
  }
  
  return lines.join('\n');
}

/**
 * Generate Selenium Java code for a step
 * @param {Object} step - Step action
 * @returns {string} Generated code line(s)
 */
function generateSeleniumStepCode(step) {
  const lines = [];
  
  switch (step.kind) {
    case 'navigate':
      lines.push(`    driver.get("${step.url}");`);
      break;
    case 'click':
      lines.push(`    wait.until(ExpectedConditions.elementToBeClickable(By.cssSelector(${JSON.stringify(step.selector)})))).click();`);
      break;
    case 'doubleClick':
      lines.push(`    WebElement element = driver.findElement(By.cssSelector(${JSON.stringify(step.selector)}));`);
      lines.push(`    new org.openqa.selenium.interactions.Actions(driver).doubleClick(element).perform();`);
      break;
    case 'type':
      lines.push(`    WebElement input = driver.findElement(By.cssSelector(${JSON.stringify(step.selector)}));`);
      lines.push(`    input.clear();`);
      lines.push(`    input.sendKeys(${JSON.stringify(step.value || '')});`);
      break;
    case 'select':
      lines.push(`    WebElement select = driver.findElement(By.cssSelector(${JSON.stringify(step.selector)}));`);
      lines.push(`    new Select(select).selectByVisibleText(${JSON.stringify(step.selectedText || step.value || '')});`);
      break;
    case 'check':
      lines.push(`    WebElement checkbox = driver.findElement(By.cssSelector(${JSON.stringify(step.selector)}));`);
      lines.push(`    if (!checkbox.isSelected()) checkbox.click();`);
      break;
    case 'uncheck':
      lines.push(`    WebElement checkbox = driver.findElement(By.cssSelector(${JSON.stringify(step.selector)}));`);
      lines.push(`    if (checkbox.isSelected()) checkbox.click();`);
      break;
    case 'hover':
      lines.push(`    WebElement element = driver.findElement(By.cssSelector(${JSON.stringify(step.selector)}));`);
      lines.push(`    new org.openqa.selenium.interactions.Actions(driver).moveToElement(element).perform();`);
      break;
    case 'keyPress':
      lines.push(`    driver.findElement(By.cssSelector("body")).sendKeys(org.openqa.selenium.Keys.${(step.key || step.value || 'ENTER').toUpperCase()});`);
      break;
    case 'assertText':
      lines.push(`    WebElement element = driver.findElement(By.cssSelector(${JSON.stringify(step.selector)}));`);
      lines.push(`    assertTrue(element.getText().contains(${JSON.stringify(step.expectedValue || step.text)}), "Expected text not found");`);
      break;
    case 'assertVisible':
      lines.push(`    wait.until(ExpectedConditions.visibilityOfElementLocated(By.cssSelector(${JSON.stringify(step.selector)})));`);
      break;
    case 'assertAttribute':
      const attrValue = step.expectedValue || '';
      lines.push(`    WebElement element = driver.findElement(By.cssSelector(${JSON.stringify(step.selector)}));`);
      lines.push(`    assertEquals(${JSON.stringify(attrValue)}, element.getAttribute(${JSON.stringify(step.value)}), "Attribute value mismatch");`);
      break;
    case 'assertCount':
      const count = parseInt(step.expectedValue) || 0;
      lines.push(`    assertEquals(${count}, driver.findElements(By.cssSelector(${JSON.stringify(step.selector)})).size(), "Element count mismatch");`);
      break;
    case 'assertValue':
      const val = step.expectedValue || '';
      lines.push(`    WebElement element = driver.findElement(By.cssSelector(${JSON.stringify(step.selector)}));`);
      lines.push(`    assertEquals(${JSON.stringify(val)}, element.getAttribute("value"), "Value mismatch");`);
      break;
    case 'waitFor':
      lines.push(`    try { Thread.sleep(${Number(step.ms) || 500}); } catch (InterruptedException e) {}`);
      break;
    case 'waitForSelector':
      lines.push(`    wait.until(ExpectedConditions.presenceOfElementLocated(By.cssSelector(${JSON.stringify(step.selector)})));`);
      break;
    case 'screenshot':
      lines.push(`    ((org.openqa.selenium.TakesScreenshot) driver).getScreenshotAs(org.openqa.selenium.OutputType.FILE);`);
      break;
    case 'close':
      lines.push(`    driver.close();`);
      break;
  }
  
  return lines.join('\n');
}

/**
 * Generate Gherkin step line for a step
 * @param {Object} step - Step action
 * @param {boolean} usePlaceholders - Whether to use placeholders for Scenario Outline
 * @returns {string} Generated Gherkin step line
 */
function generateGherkinStepLine(step, usePlaceholders = false) {
  switch (step.kind) {
    case 'navigate':
      return usePlaceholders ? `    Given I navigate to "<url>"` : `    Given I navigate to "${step.url}"`;
    
    case 'click':
      return usePlaceholders ? `    When I click "<selector>"` : `    When I click "${step.selector}"`;
    
    case 'type':
      const value = step.value || '';
      const typeDesc = step.normalizedDescription || step.selector || 'Field';
      // When using placeholders, use <value> for the value and keep selector as-is
      return usePlaceholders ? `    And I type "<value>" into "${typeDesc}"` : `    And I type "${value}" into "${typeDesc}"`;
    
    case 'doubleClick':
      return usePlaceholders ? `    When I double click "<selector>"` : `    When I double click "${step.selector}"`;
    
    case 'select':
      const selectValue = step.selectedText || step.value || '';
      return usePlaceholders ? `    And I select "<value>" from "<selector>"` : `    And I select "${selectValue}" from "${step.selector}"`;
    
    case 'check':
      return usePlaceholders ? `    And I check "<selector>"` : `    And I check "${step.selector}"`;
    
    case 'uncheck':
      return usePlaceholders ? `    And I uncheck "<selector>"` : `    And I uncheck "${step.selector}"`;
    
    case 'hover':
      return usePlaceholders ? `    When I hover over "<selector>"` : `    When I hover over "${step.selector}"`;
    
    case 'assertText':
      const expectedText = step.expectedValue || step.text || '';
      return usePlaceholders ? `    Then I should see "<text>" in "<selector>"` : `    Then I should see "${expectedText}" in "${step.selector}"`;
    
    case 'assertVisible':
      return usePlaceholders ? `    Then "<selector>" should be visible` : `    Then "${step.selector}" should be visible`;
    
    case 'assertAttribute':
      const attr = step.value || 'value';
      const attrVal = step.expectedValue || '';
      return usePlaceholders ? `    Then "<selector>" should have attribute "<attr>" equal to "<value>"` : `    Then "${step.selector}" should have attribute "${attr}" equal to "${attrVal}"`;
    
    case 'waitFor':
      const waitMs = step.ms || 500;
      return usePlaceholders ? `    And I wait for <ms> milliseconds` : `    And I wait for ${waitMs} milliseconds`;
    
    case 'waitForSelector':
      return usePlaceholders ? `    And I wait for "<selector>" to appear` : `    And I wait for "${step.selector}" to appear`;
    
    case 'screenshot':
      return usePlaceholders ? `    And I take a screenshot` : `    And I take a screenshot`;
    
    case 'close':
      return `    And I close the browser`;
    
    case 'keyPress':
      const key = step.key || step.value || 'Enter';
      return usePlaceholders ? `    When I press the "<key>" key` : `    When I press the "${key}" key`;
    
    default:
      return `    # Unknown step: ${step.kind}`;
  }
}

/**
 * Get assertion method name for Playwright
 * @param {string} type - Assertion type (equals, contains, etc.)
 * @returns {string} Method name
 */
function getAssertionMethod(type) {
  const methods = {
    equals: 'toBe',
    contains: 'toContain',
    startsWith: 'toMatch',
    endsWith: 'toMatch',
    regex: 'toMatch'
  };
  return methods[type] || 'toBe';
}

/**
 * Get human-readable label for a step
 * @param {Object} step - Step action
 * @returns {string} Human-readable label
 */
function getStepLabel(step) {
  switch (step.kind) {
    case 'navigate':
      return `Navigate to ${step.url || 'page'}`;
    case 'click':
      return `Click ${step.normalizedDescription || step.selector || 'element'}`;
    case 'doubleClick':
      return `Double click ${step.normalizedDescription || step.selector || 'element'}`;
    case 'type':
      const value = (step.value || '').substring(0, 30);
      return `Type "${value}${step.value && step.value.length > 30 ? '...' : ''}" into ${step.normalizedDescription || step.selector || 'field'}`;
    case 'select':
      return `Select "${step.selectedText || step.value || 'option'}" from ${step.normalizedDescription || step.selector || 'dropdown'}`;
    case 'check':
      return `Check ${step.normalizedDescription || step.selector || 'checkbox'}`;
    case 'uncheck':
      return `Uncheck ${step.normalizedDescription || step.selector || 'checkbox'}`;
    case 'hover':
      return `Hover over ${step.normalizedDescription || step.selector || 'element'}`;
    case 'assertText':
      return `Assert text "${step.expectedValue || step.text || ''}" in ${step.normalizedDescription || step.selector || 'element'}`;
    case 'assertVisible':
      return `Assert ${step.normalizedDescription || step.selector || 'element'} is visible`;
    case 'assertNotVisible':
      return `Assert ${step.normalizedDescription || step.selector || 'element'} is not visible`;
    case 'assertEnabled':
      return `Assert ${step.normalizedDescription || step.selector || 'element'} is enabled`;
    case 'assertDisabled':
      return `Assert ${step.normalizedDescription || step.selector || 'element'} is disabled`;
    case 'assertChecked':
      return `Assert ${step.normalizedDescription || step.selector || 'element'} is checked`;
    case 'assertNotChecked':
      return `Assert ${step.normalizedDescription || step.selector || 'element'} is not checked`;
    case 'assertAttribute':
      return `Assert ${step.normalizedDescription || step.selector || 'element'} attribute "${step.value || ''}"`;
    case 'assertCount':
      return `Assert ${step.normalizedDescription || step.selector || 'element'} count is ${step.expectedValue || '0'}`;
    case 'assertValue':
      return `Assert ${step.normalizedDescription || step.selector || 'element'} value is "${step.expectedValue || ''}"`;
    case 'waitFor':
      return `Wait for ${step.ms || 500}ms`;
    case 'waitForSelector':
      return `Wait for ${step.normalizedDescription || step.selector || 'selector'}`;
    case 'screenshot':
      return `Take screenshot ${step.filename || ''}`;
    case 'close':
      return `Close browser`;
    case 'keyPress':
      return `Press key "${step.key || step.value || 'Enter'}"`;
    default:
      return step.normalizedStepText || `${step.kind} action`;
  }
}

/**
 * Get icon for a step kind
 * @param {string} kind - Step kind
 * @returns {string} Icon/emoji
 */
function getStepIcon(kind) {
  const icons = {
    navigate: '🌐',
    click: '👆',
    doubleClick: '👆👆',
    type: '⌨️',
    select: '📋',
    check: '✅',
    uncheck: '☑️',
    hover: '🖱️',
    assertText: '📝',
    assertVisible: '✓',
    assertNotVisible: '✗',
    assertAttribute: '🏷️',
    assertCount: '🔢',
    assertValue: '📋',
    assertEnabled: '✅',
    assertDisabled: '❌',
    assertChecked: '☑',
    assertNotChecked: '☐',
    waitFor: '⏳',
    waitForSelector: '⏱️',
    screenshot: '📸',
    close: '❌',
    keyPress: '⌨️'
  };
  return icons[kind] || '📝';
}

// Export for use in browser
if (typeof window !== 'undefined') {
  window.StepHandlers = {
    generatePlaywrightStepCode,
    generateSeleniumStepCode,
    generateGherkinStepLine,
    getAssertionMethod,
    getStepLabel,
    getStepIcon
  };
}

