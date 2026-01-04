package runner;

import org.junit.platform.suite.api.ConfigurationParameter;
import org.junit.platform.suite.api.IncludeEngines;
import org.junit.platform.suite.api.SelectClasspathResource;
import org.junit.platform.suite.api.Suite;

import static io.cucumber.junit.platform.engine.Constants.PLUGIN_PROPERTY_NAME;
import static io.cucumber.junit.platform.engine.Constants.GLUE_PROPERTY_NAME;

@Suite
@IncludeEngines("cucumber")
@SelectClasspathResource("features")
@ConfigurationParameter(key = GLUE_PROPERTY_NAME, value = "steps")
@ConfigurationParameter(key = PLUGIN_PROPERTY_NAME, value = "pretty,html:target/cucumber-reports/html-report.html,json:target/cucumber-reports/cucumber.json,junit:target/cucumber-reports/cucumber.xml")
public class RunCucumberTest {
    // This class serves as the main entry point for running Cucumber BDD tests
    // Run this class or use: mvn test
    // 
    // Configuration is handled via:
    // 1. @Suite annotation with JUnit Platform Suite Engine
    // 2. @SelectClasspathResource("features") - discovers all .feature files in features directory
    // 3. cucumber.properties file for additional settings (tags, etc.)
    // 4. Maven Surefire plugin configured to include this test class
}
