/**
 * generators/frameworks/playwright-java/index.js
 * Clean generate(steps, opts) façade for the playwright-java framework.
 *
 * opts = {
 *   framework,        // always 'playwright-java'
 *   projectName,      // Maven artifact name
 *   baseUrl,          // e.g. 'https://example.com'
 *   stepDefMap,       // { [cucumberPattern]: true }
 *   groupedActions,   // grouped action map (passed through to stepDefs)
 *   className,        // Java class name override (optional)
 *   browserOptions,   // { headless, browserType, args }
 * }
 *
 * Returns {
 *   worldClass,       // PlaywrightWorld.java content
 *   stepDefs,         // StepDefinitions.java content
 *   pomXml,           // pom.xml content
 *   cucumberProps,    // cucumber.properties content
 *   cucumberRunner,   // RunCucumberTest.java content
 * }
 */

import { generateJavaWorld } from '../java/world.js';
import { generateJavaStepDefinitions } from '../java/stepDefs.js';
import { generateMavenPom } from '../java/pom.js';
import { generateCucumberProperties, generateCucumberRunner } from '../java/cucumber.js';

const FRAMEWORK = 'playwright-java';

export function generate(steps = [], opts = {}) {
  const {
    projectName = 'automation-project',
    baseUrl = 'https://example.com',
    stepDefMap = {},
    groupedActions = {},
    className = null,
    browserOptions = {},
  } = opts;

  const worldClass = generateJavaWorld(FRAMEWORK, browserOptions);
  const stepDefs = generateJavaStepDefinitions(
    FRAMEWORK,
    stepDefMap,
    groupedActions,
    baseUrl,
    steps,
    className,
  );
  const pomXml = generateMavenPom(FRAMEWORK, projectName, baseUrl);
  const cucumberProps = generateCucumberProperties();
  const cucumberRunner = generateCucumberRunner('runner', 'features', 'steps');

  return { worldClass, stepDefs, pomXml, cucumberProps, cucumberRunner };
}
