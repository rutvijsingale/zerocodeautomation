/**
 * generators/frameworks/java/cucumber.js
 * Generates cucumber.properties and JUnit RunCucumberTest runner class.
 */

function generateCucumberProperties() {
  return `cucumber.publish.quiet=true
cucumber.filter.tags=@recorded
cucumber.plugin=pretty,html:target/cucumber-reports/html-report.html,json:target/cucumber-reports/cucumber.json,junit:target/cucumber-reports/cucumber.xml,io.qameta.allure.cucumber7jvm.AllureCucumber7Jvm
cucumber.execution.parallel.enabled=false
cucumber.execution.strict=true
cucumber.snippet-type=camelcase`;
}

/**
 * Generate Cucumber JUnit Runner class
 * This is the main entry point for running Cucumber BDD tests
 * @param {string} packageName - Package name for the runner class
 * @param {string} featurePath - Path to feature files (relative to resources)
 * @param {string} gluePath - Path to step definitions package
 * @returns {string} Generated Cucumber runner class code
 */
function generateCucumberRunner(packageName = 'runner', featurePath = 'features', gluePath = 'steps') {
  // Always include 'support' package for World classes with @Before/@After hooks
  const fullGluePath = gluePath.includes('support') ? gluePath : `${gluePath},support`;
  return `package ${packageName};

import org.junit.platform.suite.api.ConfigurationParameter;
import org.junit.platform.suite.api.IncludeEngines;
import org.junit.platform.suite.api.SelectClasspathResource;
import org.junit.platform.suite.api.Suite;

import static io.cucumber.junit.platform.engine.Constants.PLUGIN_PROPERTY_NAME;
import static io.cucumber.junit.platform.engine.Constants.GLUE_PROPERTY_NAME;

@Suite
@IncludeEngines("cucumber")
@SelectClasspathResource("${featurePath}")
@ConfigurationParameter(key = GLUE_PROPERTY_NAME, value = "${fullGluePath}")
@ConfigurationParameter(key = PLUGIN_PROPERTY_NAME, value = "pretty, html:target/cucumber-reports/html-report.html, json:target/cucumber-reports/cucumber.json, junit:target/cucumber-reports/cucumber.xml")
public class RunCucumberTest {
    // This class serves as the main entry point for running Cucumber BDD tests
    // Run this class or use: mvn test
}
`;
}

export { generateCucumberProperties, generateCucumberRunner };
