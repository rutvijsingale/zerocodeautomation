/**
 * Domain Models Index
 * Central export point for all domain models
 */

export { Project } from './Project.js';
export { Feature } from './Feature.js';
export { Scenario } from './Scenario.js';
export { Step } from './Step.js';
export { LocatorDefinition } from './LocatorDefinition.js';
export { TestDataSet } from './TestDataSet.js';
export { Environment } from './Environment.js';

import { Step } from './Step.js';
import { Scenario } from './Scenario.js';
import { Feature } from './Feature.js';

/**
 * Helper function to convert legacy step array to Feature model
 * @param {Array<Object>} steps - Legacy steps array
 * @param {Object} options - Options (featureName, featureTitle, tags, backgroundSteps, scenarios)
 * @returns {Feature}
 */
export function createFeatureFromLegacySteps(steps, options = {}) {
  const featureSteps = steps.map(s => Step.fromLegacyStep(s));
  const backgroundSteps = (options.backgroundSteps || []).map(s => Step.fromLegacyStep(s));
  
  let scenarios = [];
  if (options.scenarios && Array.isArray(options.scenarios) && options.scenarios.length > 0) {
    scenarios = options.scenarios.map(sc => {
      const scenarioSteps = (sc.steps || []).map(s => Step.fromLegacyStep(s));
      return new Scenario({
        title: sc.title || options.featureTitle || 'Recorded Flow',
        tags: sc.tags || options.tags || [],
        steps: scenarioSteps
      });
    });
  } else {
    // Single scenario with all steps
    scenarios = [new Scenario({
      title: options.featureTitle || 'Recorded Flow',
      tags: options.tags || [],
      steps: featureSteps
    })];
  }
  
  return new Feature({
    name: options.featureName || 'Recorded Feature',
    title: options.featureTitle || 'Recorded Flow',
    tags: options.tags || [],
    backgroundSteps: backgroundSteps,
    scenarios: scenarios
  });
}

