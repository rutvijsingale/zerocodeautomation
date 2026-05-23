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
    case 'fill': // [ZAC-FIX] Playwright-native verb alias — QA writing a step
                 //              from scratch reaches for "fill" before "type".
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
    case 'selectRadio':
      // T1.6 — semantic radio click. We use page.check() because it works
      // for radio inputs in Playwright and matches Selenium's click().
      lines.push(`  await page.check(${JSON.stringify(step.selector)});`);
      break;
    case 'scroll':
      // T1.12 — element-into-view scroll if a selector is present, else
      // a window-level scroll to a recorded (x,y) position.
      if (step.selector) {
        lines.push(`  await page.locator(${JSON.stringify(step.selector)}).scrollIntoViewIfNeeded();`);
      } else {
        const x = Number(step.x) || 0, y = Number(step.y) || 0;
        lines.push(`  await page.evaluate(({x, y}) => window.scrollTo(x, y), { x: ${x}, y: ${y} });`);
      }
      break;
    case 'dragDrop': {
      // T1.2 — Playwright has dragTo for the common case.
      // [ZAC-FIX] Bug 2 — validate both selectors before generating; an
      // empty selector compiles to `page.locator("")` which throws at
      // runtime ("locator(): expected non-empty selector"). When either
      // side is missing we emit a TODO so the QA can spot it instead of
      // silently producing a flaky test.
      const dragSrc = step.sourceSelector || step.selector;
      const dragTgt = step.targetSelector;
      if (!dragSrc || !dragTgt) {
        const reason = !dragSrc && !dragTgt
          ? 'source AND target missing'
          : (!dragSrc ? 'source missing' : 'target missing');
        console.warn('[stepHandlers] dragDrop step skipped (Playwright):', reason, step);
        lines.push(`  // TODO dragDrop skipped — ${reason}. Recorded payload: ${JSON.stringify(step).replace(/\*\//g, '*\\/').slice(0, 200)}`);
      } else {
        lines.push(`  await page.locator(${JSON.stringify(dragSrc)}).dragTo(page.locator(${JSON.stringify(dragTgt)}));`);
      }
      break;
    }
    case 'fileUpload':
      // T1.3 — accept either a single filename or an array of names. We
      // pass the recorded value through; the test runner is responsible
      // for resolving fixture paths.
      const fnames = Array.isArray(step.files)
        ? step.files.map(f => f.name || f).filter(Boolean)
        : (step.value ? String(step.value).split(',').map(s => s.trim()) : []);
      lines.push(`  await page.setInputFiles(${JSON.stringify(step.selector)}, ${JSON.stringify(fnames.length === 1 ? fnames[0] : fnames)});`);
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
    case 'fill': // [ZAC-FIX] alias for ergonomic parity (matches Playwright's verb)
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
    case 'selectRadio':
      // T1.6 — semantic radio. Selenium has no separate "selectRadio";
      // a click is sufficient since radios are mutually exclusive.
      lines.push(`    WebElement radio = driver.findElement(By.cssSelector(${JSON.stringify(step.selector)}));`);
      lines.push(`    if (!radio.isSelected()) radio.click();`);
      break;
    case 'scroll':
      // T1.12 — Selenium uses the JS executor for scrolling.
      if (step.selector) {
        lines.push(`    WebElement scrollTarget = driver.findElement(By.cssSelector(${JSON.stringify(step.selector)}));`);
        lines.push(`    ((org.openqa.selenium.JavascriptExecutor) driver).executeScript("arguments[0].scrollIntoView({block: 'center'})", scrollTarget);`);
      } else {
        const x = Number(step.x) || 0, y = Number(step.y) || 0;
        lines.push(`    ((org.openqa.selenium.JavascriptExecutor) driver).executeScript("window.scrollTo(${x}, ${y})");`);
      }
      break;
    case 'dragDrop': {
      // T1.2 — Actions API drag-and-drop.
      // [ZAC-FIX] Bug 2 — validate both selectors before generating;
      // `By.cssSelector("")` throws InvalidSelectorException at runtime.
      // Emit a TODO comment + console.warn instead of producing broken code.
      const dragSrc = step.sourceSelector || step.selector;
      const dragTgt = step.targetSelector;
      if (!dragSrc || !dragTgt) {
        const reason = !dragSrc && !dragTgt
          ? 'source AND target missing'
          : (!dragSrc ? 'source missing' : 'target missing');
        console.warn('[stepHandlers] dragDrop step skipped (Selenium):', reason, step);
        lines.push(`    // TODO dragDrop skipped — ${reason}. Recorded payload: ${JSON.stringify(step).replace(/\*\//g, '*\\/').slice(0, 200)}`);
      } else {
        lines.push(`    WebElement dragSource = driver.findElement(By.cssSelector(${JSON.stringify(dragSrc)}));`);
        lines.push(`    WebElement dragTarget = driver.findElement(By.cssSelector(${JSON.stringify(dragTgt)}));`);
        lines.push(`    new org.openqa.selenium.interactions.Actions(driver).dragAndDrop(dragSource, dragTarget).perform();`);
      }
      break;
    }
    case 'fileUpload':
      // T1.3 — sendKeys on the file input is the standard Selenium upload.
      const uploadFile = Array.isArray(step.files) && step.files[0]
        ? (step.files[0].name || step.files[0])
        : (step.value || '');
      lines.push(`    WebElement fileInput = driver.findElement(By.cssSelector(${JSON.stringify(step.selector)}));`);
      lines.push(`    fileInput.sendKeys(${JSON.stringify(uploadFile)});`);
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

    case 'selectRadio':
      const radioVal = step.value || step.selectedText || '';
      return usePlaceholders
        ? `    When I select radio "<value>" from "<selector>"`
        : `    When I select radio "${radioVal}" from "${step.selector}"`;

    case 'scroll':
      if (step.selector) {
        return usePlaceholders
          ? `    When I scroll to "<selector>"`
          : `    When I scroll to "${step.selector}"`;
      }
      return `    When I scroll to position (${Number(step.x) || 0}, ${Number(step.y) || 0})`;

    case 'dragDrop':
      return usePlaceholders
        ? `    When I drag "<source>" to "<target>"`
        : `    When I drag "${step.sourceSelector || step.selector}" to "${step.targetSelector || ''}"`;

    case 'fileUpload':
      const upName = Array.isArray(step.files) && step.files[0]
        ? (step.files[0].name || step.files[0])
        : (step.value || '');
      return usePlaceholders
        ? `    When I upload "<file>" to "<selector>"`
        : `    When I upload "${upName}" to "${step.selector}"`;

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
    case 'selectRadio':
      return `Select radio "${step.value || step.selectedText || ''}" in ${step.normalizedDescription || step.selector || 'group'}`;
    case 'scroll':
      return step.selector
        ? `Scroll to ${step.normalizedDescription || step.selector}`
        : `Scroll to (${Number(step.x) || 0}, ${Number(step.y) || 0})`;
    case 'dragDrop':
      return `Drag ${step.sourceSelector || step.selector || 'source'} → ${step.targetSelector || 'target'}`;
    case 'fileUpload':
      const fname = Array.isArray(step.files) && step.files[0] ? (step.files[0].name || step.files[0]) : (step.value || '');
      return `Upload "${fname}" to ${step.normalizedDescription || step.selector || 'file input'}`;
    case 'download':
      return `Download "${step.filename || step.url || 'file'}"`;
    case 'popup':
      return `Popup opened: ${step.url || ''}`;
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

