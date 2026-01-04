package steps;

import io.cucumber.java.en.*;
import static support.SeleniumWorld.getDriver;
import org.openqa.selenium.By;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.ui.Select;
import org.openqa.selenium.support.ui.WebDriverWait;
import org.openqa.selenium.support.ui.ExpectedConditions;
import java.time.Duration;
import static org.junit.jupiter.api.Assertions.*;


public class AmazonaddtocartSteps {

    // Selector lookup map: maps element descriptions to actual selectors with fallbacks
    private static final java.util.Map<String, java.util.List<String>> SELECTOR_MAP = new java.util.HashMap<>();
    static {
        java.util.List<String> selectors_Search_Amazon_in_Field = new java.util.ArrayList<>();
        selectors_Search_Amazon_in_Field.add("#twotabsearchtextbox");
        selectors_Search_Amazon_in_Field.add("[name=\"field-keywords\"]");
        selectors_Search_Amazon_in_Field.add("[aria-label=\"Search Amazon.in\"]");
        SELECTOR_MAP.put("Search Amazon.in Field", selectors_Search_Amazon_in_Field);
        java.util.List<String> selectors_Samsung_s24_ultra_5g_mobile = new java.util.ArrayList<>();
        selectors_Samsung_s24_ultra_5g_mobile.add("[aria-label=\"samsung s24 ultra 5g mobile\"]");
        selectors_Samsung_s24_ultra_5g_mobile.add("text=\"samsung s24 ultra 5g mobile\"");
        SELECTOR_MAP.put("Samsung s24 ultra 5g mobile", selectors_Samsung_s24_ultra_5g_mobile);
        java.util.List<String> selectors_Sponsored_Sponsored_You_are_seeing_this_ad___ = new java.util.ArrayList<>();
        selectors_Sponsored_Sponsored_You_are_seeing_this_ad___.add("text=\"SponsoredSponsored You are seeing this ad based on\"");
        SELECTOR_MAP.put("Sponsored Sponsored You are seeing this ad...", selectors_Sponsored_Sponsored_You_are_seeing_this_ad___);
        java.util.List<String> selectors_Samsung_Galaxy_S25_Ultra_5G_AI_Smartphone_Titanium_Gray__12GB_RAM__512GB_Storage___200MP_Camera__S_Pen_Included__Long_Battery_Life = new java.util.ArrayList<>();
        selectors_Samsung_Galaxy_S25_Ultra_5G_AI_Smartphone_Titanium_Gray__12GB_RAM__512GB_Storage___200MP_Camera__S_Pen_Included__Long_Battery_Life.add("text=\"Samsung Galaxy S25 Ultra 5G AI Smartphone (Titaniu\"");
        SELECTOR_MAP.put("Samsung Galaxy S25 Ultra 5G AI Smartphone Titanium Gray, 12GB RAM, 512GB Storage , 200MP Camera, S Pen Included, Long Battery Life", selectors_Samsung_Galaxy_S25_Ultra_5G_AI_Smartphone_Titanium_Gray__12GB_RAM__512GB_Storage___200MP_Camera__S_Pen_Included__Long_Battery_Life);
        java.util.List<String> selectors_Add_To_Cart_Button = new java.util.ArrayList<>();
        selectors_Add_To_Cart_Button.add("#a-autoid-1-announce");
        selectors_Add_To_Cart_Button.add("text=\"Add to cart\"");
        SELECTOR_MAP.put("Add To Cart Button", selectors_Add_To_Cart_Button);
        java.util.List<String> selectors_Go_To_Cart_Button = new java.util.ArrayList<>();
        selectors_Go_To_Cart_Button.add("text=\"Go to Cart\"");
        SELECTOR_MAP.put("Go To Cart Button", selectors_Go_To_Cart_Button);
        java.util.List<String> selectors_Proceed_To_Retail_Checkout_Field = new java.util.ArrayList<>();
        selectors_Proceed_To_Retail_Checkout_Field.add("[name=\"proceedToRetailCheckout\"]");
        SELECTOR_MAP.put("Proceed To Retail Checkout Field", selectors_Proceed_To_Retail_Checkout_Field);
    }

    // Helper method to try selectors with fallback and auto-healing
    private boolean tryClickWithFallback(java.util.List<String> selectors, String elementDescription) {
        for (String selector : selectors) {
            try {
                if (selector.startsWith("#") || selector.startsWith(".") || selector.startsWith("[")) {
                    getDriver().findElement(By.cssSelector(selector)).click();
                    return true;
                } else if (selector.startsWith("//") || selector.startsWith("xpath=")) {
                    String xpath = selector.startsWith("xpath=") ? selector.substring(6) : selector;
                    getDriver().findElement(By.xpath(xpath)).click();
                    return true;
                } else {
                    getDriver().findElement(By.cssSelector(selector)).click();
                    return true;
                }
            } catch (Exception e) {
                // Try next selector
                continue;
            }
        }
        // If all selectors failed, try text-based fallback
        try {
            getDriver().findElement(By.xpath("//*[contains(text(), '" + elementDescription + "')]")).click();
            return true;
        } catch (Exception e) {
            getDriver().findElement(By.partialLinkText(elementDescription)).click();
            return true;
        }
    }

    // Helper method for fill operations with auto-healing
    private boolean tryFillWithFallback(java.util.List<String> selectors, String value, String elementDescription) {
        for (String selector : selectors) {
            try {
                WebElement field;
                if (selector.startsWith("#") || selector.startsWith(".") || selector.startsWith("[")) {
                    field = getDriver().findElement(By.cssSelector(selector));
                } else if (selector.startsWith("//") || selector.startsWith("xpath=")) {
                    String xpath = selector.startsWith("xpath=") ? selector.substring(6) : selector;
                    field = getDriver().findElement(By.xpath(xpath));
                } else {
                    field = getDriver().findElement(By.cssSelector(selector));
                }
                field.clear();
                field.sendKeys(value);
                return true;
            } catch (Exception e) {
                continue;
            }
        }
        // Fallback
        try {
            WebElement field = new WebDriverWait(getDriver(), Duration.ofSeconds(10))
                .until(ExpectedConditions.presenceOfElementLocated(By.xpath("//input[contains(@placeholder, '" + elementDescription + "') or contains(@name, '" + elementDescription + "')]")));
            field.clear();
            field.sendKeys(value);
            return true;
        } catch (Exception e) {
            getDriver().findElement(By.id(elementDescription.toLowerCase().replace(" ", ""))).sendKeys(value);
            return true;
        }
    }

    private boolean tryCheckVisibleWithFallback(java.util.List<String> selectors, String elementDescription) {
        for (String selector : selectors) {
            try {
                WebElement element = getDriver().findElement(By.cssSelector(selector));
                assertTrue(element.isDisplayed());
                return true;
            } catch (Exception e) {
                continue;
            }
        }
        // Fallback
        WebElement element = getDriver().findElement(By.xpath("//*[contains(text(), '" + elementDescription + "')]"));
        assertTrue(element.isDisplayed());
            return true;
    }

    @Given("I navigate to {string}")
    public void iNavigateToUrl(String url) {
        getDriver().get(url);
    }

    @When("I click {string}")
    public void iClick(String selector) {
        // Detect if click causes navigation (pagination, links, etc.)
        String urlBeforeClick = getDriver().getCurrentUrl();
        
        // Perform the click
        getDriver().findElement(By.cssSelector(selector)).click();
        
        // Wait a bit for potential navigation to start
        try {
            Thread.sleep(200);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        
        // Check if navigation occurred
        String urlAfterClick = getDriver().getCurrentUrl();
        if (!urlBeforeClick.equals(urlAfterClick)) {
            // Navigation occurred - wait for page to load
            System.out.println("[Click] Navigation detected after clicking, waiting for page to load...");
            // Wait for page to load (check for document.readyState)
            org.openqa.selenium.support.ui.WebDriverWait wait = new org.openqa.selenium.support.ui.WebDriverWait(getDriver(), java.time.Duration.ofSeconds(30));
            wait.until(webDriver -> ((org.openqa.selenium.JavascriptExecutor) webDriver).executeScript("return document.readyState").equals("complete"));
            // Wait for dynamic content to load (pagination, AJAX, etc.)
            try {
                Thread.sleep(1000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            System.out.println("[Click] Page loaded after navigation to: " + getDriver().getCurrentUrl());
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
        WebElement input = getDriver().findElement(By.cssSelector(selector));
        input.clear();
        input.sendKeys(value);
    }

    @When("I select {string} from {string}")
    public void iSelectFromDropdown(String value, String selector) {
        WebElement select = getDriver().findElement(By.cssSelector(selector));
        new org.openqa.selenium.support.ui.Select(select).selectByVisibleText(value);
    }

    @Then("I should see {string} in {string}")
    public void iShouldSeeIn(String text, String elementDescription) {
        // Look up selectors with fallbacks from recorded steps
        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());
        if (selectors.isEmpty()) {
            selectors = new java.util.ArrayList<>();
            selectors.add(elementDescription);
        }
        // Try each selector until one works
        boolean found = false;
        for (String selector : selectors) {
            try {
                WebElement element = getDriver().findElement(By.cssSelector(selector));
                assertTrue(element.getText().contains(text), "Expected text '" + text + "' not found");
                found = true;
                break;
            } catch (Exception e) {
                continue;
            }
        }
        if (!found) {
            WebElement element = getDriver().findElement(By.xpath("//*[contains(text(), '" + elementDescription + "')]"));
            assertTrue(element.getText().contains(text), "Expected text '" + text + "' not found");
        }
    }

    @Then("{string} should be visible")
    public void shouldBeVisible(String elementDescription) {
        // Look up selectors with fallbacks from recorded steps
        java.util.List<String> selectors = SELECTOR_MAP.getOrDefault(elementDescription, new java.util.ArrayList<>());
        if (selectors.isEmpty()) {
            // No recorded selectors, create default list with description
            selectors = new java.util.ArrayList<>();
            selectors.add(elementDescription);
        }
        tryCheckVisibleWithFallback(selectors, elementDescription);
    }

    @Then("{string} attribute {string} should equal {string}")
    public void attributeShouldEqual(String elementDescription, String attributeName, String expectedValue) {
        WebElement element = getDriver().findElement(By.cssSelector(elementDescription));
        String actualValue = element.getAttribute(attributeName);
        assertEquals(expectedValue, actualValue, "Attribute '" + attributeName + "' value mismatch");
    }

    @Then("{string} attribute {string} should contain {string}")
    public void attributeShouldContain(String elementDescription, String attributeName, String expectedValue) {
        WebElement element = getDriver().findElement(By.cssSelector(elementDescription));
        String actualValue = element.getAttribute(attributeName);
        assertTrue(actualValue != null && actualValue.contains(expectedValue), "Attribute '" + attributeName + "' does not contain '" + expectedValue + "'");
    }

    @Then("{string} count should be {int}")
    public void countShouldBe(String elementDescription, Integer expectedCount) {
        java.util.List<WebElement> elements = getDriver().findElements(By.cssSelector(elementDescription));
        assertEquals(expectedCount.intValue(), elements.size(), "Element count mismatch");
    }

    @Then("{string} value should equal {string}")
    public void valueShouldEqual(String elementDescription, String expectedValue) {
        WebElement element = getDriver().findElement(By.cssSelector(elementDescription));
        String actualValue = element.getAttribute("value");
        assertEquals(expectedValue, actualValue, "Element value mismatch");
    }

    @Then("{string} value should contain {string}")
    public void valueShouldContain(String elementDescription, String expectedValue) {
        WebElement element = getDriver().findElement(By.cssSelector(elementDescription));
        String actualValue = element.getAttribute("value");
        assertTrue(actualValue != null && actualValue.contains(expectedValue), "Element value does not contain '" + expectedValue + "'");
    }

    @Then("{string} should not be visible")
    public void shouldNotBeVisible(String elementDescription) {
        try {
            WebElement element = getDriver().findElement(By.cssSelector(elementDescription));
            assertFalse(element.isDisplayed(), "Element '" + elementDescription + "' should not be visible");
        } catch (org.openqa.selenium.NoSuchElementException e) {
            // Element not found means it's not visible, which is expected
        }
    }

    @Then("{string} should be enabled")
    public void shouldBeEnabled(String elementDescription) {
        WebElement element = getDriver().findElement(By.cssSelector(elementDescription));
        assertTrue(element.isEnabled(), "Element '" + elementDescription + "' is not enabled");
    }

    @Then("{string} should be disabled")
    public void shouldBeDisabled(String elementDescription) {
        WebElement element = getDriver().findElement(By.cssSelector(elementDescription));
        assertFalse(element.isEnabled(), "Element '" + elementDescription + "' should be disabled");
    }

    @Then("{string} should be checked")
    public void shouldBeChecked(String elementDescription) {
        WebElement element = getDriver().findElement(By.cssSelector(elementDescription));
        assertTrue(element.isSelected(), "Element '" + elementDescription + "' is not checked");
    }

    @Then("{string} should not be checked")
    public void shouldNotBeChecked(String elementDescription) {
        WebElement element = getDriver().findElement(By.cssSelector(elementDescription));
        assertFalse(element.isSelected(), "Element '" + elementDescription + "' should not be checked");
    }

    @And("I close the browser")
    public void iCloseTheBrowser() {
        try {
            org.openqa.selenium.WebDriver driver = getDriver();
            if (driver != null) {
                // Check if a new window/tab is opening before closing
            // This prevents closing when the application opens in a new tab
            // But allows closing when navigation happens in the same tab (normal link click)
                String currentWindow = driver.getWindowHandle();
                int windowsBefore = driver.getWindowHandles().size();
                
                // Wait a short time to see if a new window is about to open
                // Some clicks trigger new tabs asynchronously
                try {
                    Thread.sleep(500);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                
                // Check window count after waiting
                int windowsAfter = driver.getWindowHandles().size();
                
                // ONLY skip closing if a new window/tab actually opened
                // If window count increased, it means a new tab was created
                // If window count stayed the same, it's normal navigation in the same tab - allow closing
                if (windowsAfter > windowsBefore) {
                    System.out.println("[Close] New tab detected (" + windowsBefore + " -> " + windowsAfter + "), skipping close to preserve new tab");
                    return; // Skip closing
                }
                
                // If we reach here, no new tab was created
                // This means either normal navigation happened in the same tab or no navigation
                // In both cases, it's safe to close the browser
                System.out.println("[Close] No new tab detected (window count: " + windowsBefore + "), proceeding with close");
                driver.quit();
            }
        } catch (Exception e) {
            // Browser already closed or error closing
        }
    }

}