import io.github.bonigarcia.wdm.WebDriverManager;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.testng.Assert;
import org.testng.annotations.AfterMethod;
import org.testng.annotations.BeforeMethod;
import org.testng.annotations.Test;
import support.BasePage;
import support.CredentialsHelper;
import support.Locators;

public class DemoQATest {
  private WebDriver driver;
  private BasePage page;

  @BeforeMethod
  public void setUp() {
    WebDriverManager.chromedriver().setup();
    ChromeOptions opts = new ChromeOptions();
    opts.addArguments("--start-maximized");
    driver = new ChromeDriver(opts);
    page = new BasePage(driver);
  }

  @AfterMethod
  public void tearDown() {
    if (driver != null) driver.quit();
  }

  @Test(description = "Recorded flow → DemoQA")
  public void testDemoQA() {
    driver.get("https://demoqa.com/");
    driver.get("https://demoqa.com/");
    driver.get("https://demoqa.com/elements");
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("elements_button"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("text_box"));
      e.click();
    }
    driver.get("https://demoqa.com/text-box");
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("elements_text_box_check_box_radio_button_web_tables_buttons_links_broken"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("full_name_field"));
      String resolved = CredentialsHelper.resolve("ddwdfwe");
      e.clear();
      e.sendKeys(resolved);
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("elements_text_box_check_box_radio_button_web_tables_buttons_links_broken"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("name_example_com_field"));
      String resolved = CredentialsHelper.resolve("wedw");
      e.clear();
      e.sendKeys(resolved);
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("elements_text_box_check_box_radio_button_web_tables_buttons_links_broken"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("current_address"));
      String resolved = CredentialsHelper.resolve("ww");
      e.clear();
      e.sendKeys(resolved);
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("elements_text_box_check_box_radio_button_web_tables_buttons_links_broken"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("name_example_com_field"));
      String resolved = CredentialsHelper.resolve("wedw@yopmail.com");
      e.clear();
      e.sendKeys(resolved);
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("elements_text_box_check_box_radio_button_web_tables_buttons_links_broken"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("current_address"));
      String resolved = CredentialsHelper.resolve("wwfwef");
      e.clear();
      e.sendKeys(resolved);
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("elements_text_box_check_box_radio_button_web_tables_buttons_links_broken"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("permanent_address"));
      String resolved = CredentialsHelper.resolve("wefef");
      e.clear();
      e.sendKeys(resolved);
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("submit_button"));
      e.click();
    }
    driver.get("https://demoqa.com/checkbox");
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("check_box_button"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("select_home"));
      e.click();
    }
    ((org.openqa.selenium.JavascriptExecutor) driver).executeScript("window.scrollTo(0, 290);");
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("alerts_frame_windows"));
      e.click();
    }
    ((org.openqa.selenium.JavascriptExecutor) driver).executeScript("window.scrollTo(0, 34);");
    driver.get("https://demoqa.com/frames");
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("frames_button"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("elements_text_box_check_box_radio_button_web_tables_buttons_links_broken"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("widgets"));
      e.click();
    }
    ((org.openqa.selenium.JavascriptExecutor) driver).executeScript("window.scrollTo(0, 34);");
    driver.get("https://demoqa.com/accordian");
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("accordian_button"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("lorem_ipsum_is_simply_dummy_text"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("lorem_ipsum_is_simply_dummy_text"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("lorem_ipsum_is_simply_dummy_text"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("lorem_ipsum_is_simply_dummy_text"));
      Assert.assertTrue(e.isDisplayed(), "element not visible");
    }
    driver.get("https://demoqa.com/auto-complete");
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("auto_complete_button"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("div_auto_complete_input_container"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("auto_complete_multiple_input"));
      String resolved = CredentialsHelper.resolve("dwdwq");
      e.clear();
      e.sendKeys(resolved);
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("div_auto_complete_input_container"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("auto_complete_single_input"));
      String resolved = CredentialsHelper.resolve("wdqd");
      e.clear();
      e.sendKeys(resolved);
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("elements_text_box_check_box_radio_button_web_tables_buttons_links_broken"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("div_auto_complete_input_container"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("auto_complete_single_input"));
      String resolved = CredentialsHelper.resolve("red");
      e.clear();
      e.sendKeys(resolved);
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("red"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("elements_text_box_check_box_radio_button_web_tables_buttons_links_broken"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("div_auto_complete_control_auto_complete_control_is_focused_auto_complete_control_menu_is_open"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("auto_complete_multiple_input"));
      String resolved = CredentialsHelper.resolve("gree");
      e.clear();
      e.sendKeys(resolved);
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("green"));
      e.click();
    }
    ((org.openqa.selenium.JavascriptExecutor) driver).executeScript("window.scrollTo(0, 290);");
    driver.get("https://demoqa.com/select-menu");
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("select_menu"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("elements_text_box_check_box_radio_button_web_tables_buttons_links_broken"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("elements_text_box_check_box_radio_button_web_tables_buttons_links_broken"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("mr"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("blue"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("green"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("elements_text_box_check_box_radio_button_web_tables_buttons_links_broken"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("elements_text_box_check_box_radio_button_web_tables_buttons_links_broken"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("elements_text_box_check_box_radio_button_web_tables_buttons_links_broken"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("elements_text_box_check_box_radio_button_web_tables_buttons_links_broken"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("elements_text_box_check_box_radio_button_web_tables_buttons_links_broken"));
      e.click();
    }
    {
      WebElement e = page.findWithHealing(Locators.CHAINS.get("elements_text_box_check_box_radio_button_web_tables_buttons_links_broken"));
      e.click();
    }
    // [unsupported] step kind="close" — skipped
    // [unsupported] step kind="close" — skipped
  }
}
