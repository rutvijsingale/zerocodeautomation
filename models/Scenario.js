import { Step } from './Step.js';
import { TestDataSet } from './TestDataSet.js';

/**
 * Scenario Domain Model
 * Represents a Gherkin Scenario or Scenario Outline
 */
export class Scenario {
  /**
   * @param {Object} data - Scenario data
   * @param {string} data.title - Scenario title (required)
   * @param {Array<string>} data.tags - Scenario-level tags
   * @param {Array<Step>} data.steps - Steps in this scenario
   * @param {boolean} data.isOutline - Whether this is a Scenario Outline
   * @param {TestDataSet} data.testData - Test data for Scenario Outline (if isOutline is true)
   * @param {string} data.description - Scenario description
   */
  constructor(data = {}) {
    this.title = data.title || 'Recorded Flow';
    this.tags = Array.isArray(data.tags) ? data.tags : [];
    this.steps = data.steps || [];
    this.isOutline = data.isOutline || false;
    this.testData = data.testData || null;
    this.description = data.description || '';
  }

  /**
   * Convert to plain object for serialization
   * @returns {Object}
   */
  toJSON() {
    return {
      title: this.title,
      tags: this.tags,
      steps: this.steps.map(s => s instanceof Step ? s.toJSON() : s),
      isOutline: this.isOutline,
      testData: this.testData instanceof TestDataSet ? this.testData.toJSON() : this.testData,
      description: this.description
    };
  }

  /**
   * Create Scenario from plain object
   * @param {Object} data - Plain object data
   * @returns {Scenario}
   */
  static fromJSON(data) {
    const scenario = new Scenario(data);
    if (data.steps && Array.isArray(data.steps)) {
      scenario.steps = data.steps.map(s => Step.fromJSON(s));
    }
    if (data.testData) {
      scenario.testData = TestDataSet.fromJSON(data.testData);
    }
    return scenario;
  }
}

