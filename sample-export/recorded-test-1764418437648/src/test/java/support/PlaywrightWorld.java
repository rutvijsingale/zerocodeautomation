package support;

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
            .setHeadless(false);

        // Launch browser based on type
        switch ("chromium") {
            case "firefox":
                
                browser = playwright.firefox().launch(launchOptions);
                break;
            case "webkit":
                
                browser = playwright.webkit().launch(launchOptions);
                break;
            case "edge":
                // Edge uses Chromium engine with msedge channel
                launchOptions.setChannel("msedge");
                java.util.List<String> edgeArgs = new java.util.ArrayList<>(Arrays.asList());
                edgeArgs.add("--brand=Microsoft Edge");
                launchOptions.setArgs(edgeArgs);
                browser = playwright.chromium().launch(launchOptions);
                break;
            case "chromium":
            default:
                // Chrome uses chromium with chrome channel
                launchOptions.setChannel("chrome");
                
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
}