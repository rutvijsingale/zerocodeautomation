package support;

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
        String browserType = "chrome";

        switch (browserType.toLowerCase()) {
            case "firefox":
                FirefoxOptions firefoxOptions = new FirefoxOptions();
                
                
                driver = new FirefoxDriver(firefoxOptions);
                break;
            case "edge":
                // Edge uses Chromium, so we use ChromeOptions with Edge binary
                ChromeOptions edgeOptions = new ChromeOptions();
                edgeOptions.setBinary("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe");
                
                edgeOptions.addArguments("--start-maximized");
                edgeOptions.addArguments("--disable-blink-features=AutomationControlled");
                
                driver = new ChromeDriver(edgeOptions);
                break;
            case "safari":
                driver = new SafariDriver();
                break;
            default: // chrome
                ChromeOptions chromeOptions = new ChromeOptions();
                
                chromeOptions.addArguments("--start-maximized");
                chromeOptions.addArguments("--disable-blink-features=AutomationControlled");
                
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
}