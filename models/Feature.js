import { Scenario } from './Scenario.js';

/**
 * Feature Domain Model
 * Represents a Gherkin Feature containing scenarios and background steps
 */
export class Feature {
  /**
   * @param {Object} data - Feature data
   * @param {string} data.name - Feature name (required)
   * @param {string} data.title - Feature title/description
   * @param {Array<string>} data.tags - Feature-level tags (e.g., ['@smoke', '@regression'])
   * @param {Array<Step>} data.backgroundSteps - Background steps shared across scenarios
   * @param {Array<Scenario>} data.scenarios - Scenarios in this feature
   * @param {string} data.description - Feature description
   */
  constructor(data = {}) {
    this.name = data.name || 'Recorded Feature';
    this.title = data.title || 'Recorded Flow';
    this.tags = Array.isArray(data.tags) ? data.tags : [];
    this.backgroundSteps = data.backgroundSteps || [];
    this.scenarios = data.scenarios || [];
    this.description = data.description || '';
  }

  /**
   * Convert to plain object for serialization
   * @returns {Object}
   */
  toJSON() {
    return {
      name: this.name,
      title: this.title,
      tags: this.tags,
      backgroundSteps: this.backgroundSteps.map(s => s instanceof Step ? s.toJSON() : s),
      scenarios: this.scenarios.map(s => s instanceof Scenario ? s.toJSON() : s),
      description: this.description
    };
  }

  /**
   * Create Feature from plain object
   * @param {Object} data - Plain object data
   * @returns {Feature}
   */
  static fromJSON(data) {
    const feature = new Feature(data);
    if (data.backgroundSteps && Array.isArray(data.backgroundSteps)) {
      feature.backgroundSteps = data.backgroundSteps.map(s => Step.fromJSON(s));
    }
    if (data.scenarios && Array.isArray(data.scenarios)) {
      feature.scenarios = data.scenarios.map(s => Scenario.fromJSON(s));
    }
    return feature;
  }
}

