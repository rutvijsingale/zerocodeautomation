/**
 * generators/frameworks/java/world.js
 * Generates PlaywrightWorld / SeleniumWorld class for Cucumber lifecycle hooks.
 */

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

public class PlaywrightWorld {
    private static Browser browser;
    private static BrowserContext context;
    private static Page page;

    public static Browser getBrowser() {
        return browser;
    }

    public static BrowserContext getContext() {
        return context;
    }

    public static Page getPage() {
        return page;
    }

    @Before
    public void init() {
        Playwright playwright = Playwright.create();
        BrowserType.LaunchOptions launchOptions = new BrowserType.LaunchOptions()
            .setHeadless(${headless});

        // Launch browser based on type
        switch ("${browserType}") {
            case "firefox":
                ${args.length > 0 ? `launchOptions.setArgs(Arrays.asList(${args.map(arg => `"${arg}"`).join(', ')}));` : ''}
                browser = playwright.firefox().launch(launchOptions);
                break;
            case "webkit":
                ${args.length > 0 ? `launchOptions.setArgs(Arrays.asList(${args.map(arg => `"${arg}"`).join(', ')}));` : ''}
                browser = playwright.webkit().launch(launchOptions);
                break;
            case "edge":
                // Edge uses Chromium engine with msedge channel
                launchOptions.setChannel("msedge");
                java.util.List<String> edgeArgs = new java.util.ArrayList<>(${args.length > 0 ? `Arrays.asList(${args.map(arg => `"${arg}"`).join(', ')})` : 'Arrays.asList()'});
                edgeArgs.add("--brand=Microsoft Edge");
                launchOptions.setArgs(edgeArgs);
                browser = playwright.chromium().launch(launchOptions);
                break;
            case "chromium":
            default:
                // Chrome uses chromium with chrome channel
                launchOptions.setChannel("chrome");
                ${args.length > 0 ? `launchOptions.setArgs(Arrays.asList(${args.map(arg => `"${arg}"`).join(', ')}));` : ''}
                browser = playwright.chromium().launch(launchOptions);
                break;
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
import io.cucumber.java.After;
import io.cucumber.java.Before;
import java.time.Duration;
import java.util.Arrays;

public class SeleniumWorld {
    private static WebDriver driver;

    public static WebDriver getDriver() {
        return driver;
    }

    @Before
    public void init() {
        String browserType = "${seleniumBrowserType}";

        switch (browserType.toLowerCase()) {
            case "firefox":
                FirefoxOptions firefoxOptions = new FirefoxOptions();
                ${headless ? 'firefoxOptions.addArguments("--headless");' : ''}
                ${args.length > 0 ? `firefoxOptions.addArguments(${args.map(arg => `"${arg}"`).join(', ')});` : ''}
                driver = new FirefoxDriver(firefoxOptions);
                break;
            case "edge":
                // Edge uses Chromium, so we use ChromeOptions with Edge binary
                ChromeOptions edgeOptions = new ChromeOptions();
                edgeOptions.setBinary("C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe");
                ${headless ? 'edgeOptions.addArguments("--headless");' : ''}
                edgeOptions.addArguments("--start-maximized");
                edgeOptions.addArguments("--disable-blink-features=AutomationControlled");
                ${args.length > 0 ? `edgeOptions.addArguments(${args.map(arg => `"${arg}"`).join(', ')});` : ''}
                driver = new ChromeDriver(edgeOptions);
                break;
            case "safari":
                driver = new SafariDriver();
                break;
            default: // chrome
                ChromeOptions chromeOptions = new ChromeOptions();
                ${headless ? 'chromeOptions.addArguments("--headless");' : ''}
                chromeOptions.addArguments("--start-maximized");
                chromeOptions.addArguments("--disable-blink-features=AutomationControlled");
                ${args.length > 0 ? `chromeOptions.addArguments(${args.map(arg => `"${arg}"`).join(', ')});` : ''}
                driver = new ChromeDriver(chromeOptions);
                break;
        }

        driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(10));
        driver.manage().window().maximize();
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

export { generateJavaWorld };
