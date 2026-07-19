// java-code-generators.js — backward-compat barrel.
// All logic lives in generators/frameworks/java/*.js
// Callers (routes/codegen.js, routes/recording.js) still import from here.
export {
  generateJavaWorld,
  generateJavaStepDefinitions,
  generateMavenPom,
  generateCucumberProperties,
  generateCucumberRunner,
  generatePlaywrightTest
} from './generators/frameworks/java/index.js';
