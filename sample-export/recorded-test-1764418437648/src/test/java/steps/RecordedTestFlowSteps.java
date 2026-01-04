package steps;

import io.cucumber.java.en.*;
import static support.PlaywrightWorld.getPage;
import support.PlaywrightWorld;
import static org.junit.jupiter.api.Assertions.*;


public class RecordedTestFlowSteps {

    @Given("I navigate to {string}")
    public void iNavigateToUrl(String url) {
        getPage().navigate(url);
    }

    @When("I click {string}")
    public void iClick(String selector) {
        // Detect if click causes navigation (pagination, links, etc.)
        String urlBeforeClick = getPage().url();
        
        // Perform the click
        getPage().click(selector);
        
        // Wait a bit for potential navigation to start
        try {
            Thread.sleep(200);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        
        // Check if navigation occurred
        String urlAfterClick = getPage().url();
        if (!urlBeforeClick.equals(urlAfterClick)) {
            // Navigation occurred - wait for page to stabilize
            System.out.println("[Click] Navigation detected after clicking, waiting for page to load...");
            getPage().waitForLoadState(com.microsoft.playwright.options.LoadState.DOMCONTENTLOADED, new com.microsoft.playwright.Page.WaitForLoadStateOptions().setTimeout(30000));
            // Wait for dynamic content to load (pagination, AJAX, etc.)
            try {
                Thread.sleep(1000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            // Try to wait for network idle (but don't fail if it times out)
            try {
                getPage().waitForLoadState(com.microsoft.playwright.options.LoadState.NETWORKIDLE, new com.microsoft.playwright.Page.WaitForLoadStateOptions().setTimeout(5000));
            } catch (Exception e) {
                // Network idle timeout is OK - some sites have continuous activity
                System.out.println("[Click] Network idle timeout (expected for some sites), continuing...");
            }
            System.out.println("[Click] Page loaded after navigation to: " + getPage().url());
        } else {
            // No navigation - just wait a bit for any dynamic updates
            try {
                Thread.sleep(500);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    @When("I type {string} into {string}")
    public void iTypeInto(String value, String selector) {
        getPage().fill(selector, value);
    }

    @When("I select {string} from {string}")
    public void iSelectFromDropdown(String value, String selector) {
        getPage().selectOption(selector, value);
    }

    @Then("I should see {string} in {string}")
    public void iShouldSeeIn(String text, String elementDescription) {
        com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(getPage().locator("text=" + elementDescription)).containsText(text);
    }

    @Then("{string} should be visible")
    public void shouldBeVisible(String elementDescription) {
        com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(getPage().locator("text=" + elementDescription)).isVisible();
    }

    @Then("{string} attribute {string} should equal {string}")
    public void attributeShouldEqual(String elementDescription, String attributeName, String expectedValue) {
        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());
        String selector = selectors.isEmpty() ? elementDescription : selectors.get(0);
        com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(getPage().locator(selector)).hasAttribute(attributeName, expectedValue);
    }

    @Then("{string} attribute {string} should contain {string}")
    public void attributeShouldContain(String elementDescription, String attributeName, String expectedValue) {
        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());
        String selector = selectors.isEmpty() ? elementDescription : selectors.get(0);
        String actualValue = getPage().locator(selector).getAttribute(attributeName);
        assertTrue(actualValue != null && actualValue.contains(expectedValue), "Attribute '" + attributeName + "' does not contain '" + expectedValue + "'");
    }

    @Then("{string} count should be {int}")
    public void countShouldBe(String elementDescription, Integer expectedCount) {
        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());
        String selector = selectors.isEmpty() ? elementDescription : selectors.get(0);
        com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(getPage().locator(selector)).hasCount(expectedCount);
    }

    @Then("{string} value should equal {string}")
    public void valueShouldEqual(String elementDescription, String expectedValue) {
        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());
        String selector = selectors.isEmpty() ? elementDescription : selectors.get(0);
        com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(getPage().locator(selector)).hasValue(expectedValue);
    }

    @Then("{string} value should contain {string}")
    public void valueShouldContain(String elementDescription, String expectedValue) {
        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());
        String selector = selectors.isEmpty() ? elementDescription : selectors.get(0);
        String actualValue = getPage().locator(selector).inputValue();
        assertTrue(actualValue != null && actualValue.contains(expectedValue), "Element value does not contain '" + expectedValue + "'");
    }

    @Then("{string} should not be visible")
    public void shouldNotBeVisible(String elementDescription) {
        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());
        String selector = selectors.isEmpty() ? elementDescription : selectors.get(0);
        com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(getPage().locator(selector)).not().isVisible();
    }

    @Then("{string} should be enabled")
    public void shouldBeEnabled(String elementDescription) {
        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());
        String selector = selectors.isEmpty() ? elementDescription : selectors.get(0);
        com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(getPage().locator(selector)).isEnabled();
    }

    @Then("{string} should be disabled")
    public void shouldBeDisabled(String elementDescription) {
        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());
        String selector = selectors.isEmpty() ? elementDescription : selectors.get(0);
        com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(getPage().locator(selector)).isDisabled();
    }

    @Then("{string} should be checked")
    public void shouldBeChecked(String elementDescription) {
        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());
        String selector = selectors.isEmpty() ? elementDescription : selectors.get(0);
        com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(getPage().locator(selector)).isChecked();
    }

    @Then("{string} should not be checked")
    public void shouldNotBeChecked(String elementDescription) {
        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());
        String selector = selectors.isEmpty() ? elementDescription : selectors.get(0);
        com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat(getPage().locator(selector)).not().isChecked();
    }

    @And("I close the browser")
    public void iCloseTheBrowser() {
        try {
            Page currentPage = getPage();
            BrowserContext context = support.PlaywrightWorld.getContext();
            
            // Check if a new tab/page is opening before closing
            // This prevents closing when the application opens in a new tab
            // But allows closing when navigation happens in the same tab (normal link click)
            if (currentPage != null && context != null && !currentPage.isClosed()) {
                // Get page count before waiting
                int pagesBefore = context.pages().size();
                
                // Wait a short time to see if a new page is about to open
                // Some clicks trigger new tabs asynchronously
                try {
                    Thread.sleep(500);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                
                // Check page count after waiting
                int pagesAfter = context.pages().size();
                
                // ONLY skip closing if a new page/tab actually opened
                // If page count increased, it means a new tab was created
                // If page count stayed the same, it's normal navigation in the same tab - allow closing
                if (pagesAfter > pagesBefore) {
                    System.out.println("[Close] New tab detected (" + pagesBefore + " -> " + pagesAfter + "), skipping close to preserve new tab");
                    return; // Skip closing
                }
                
                // If we reach here, no new tab was created
                // This means either normal navigation happened in the same tab or no navigation
                // In both cases, it's safe to close the current page
                System.out.println("[Close] No new tab detected (page count: " + pagesBefore + "), proceeding with close");
                currentPage.close();
            }
            
            // Close context and browser if no pages remain
            if (context != null && context.pages().isEmpty()) {
                context.close();
            }
            if (support.PlaywrightWorld.getBrowser() != null) {
                support.PlaywrightWorld.getBrowser().close();
            }
        } catch (Exception e) {
            // Browser already closed or error closing
        }
    }

}