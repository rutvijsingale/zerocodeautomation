/**
 * Step Domain Model
 * Represents a single test step (action, assertion, navigation, etc.)
 */
export class Step {
  /**
   * @param {Object} data - Step data
   * @param {string} data.kind - Step kind (navigate, click, type, assertText, etc.) (required)
   * @param {string} data.selector - Element selector (CSS/XPath/role)
   * @param {string} data.url - URL for navigation steps
   * @param {string} data.value - Input value or other step-specific value
   * @param {string} data.expectedValue - Expected value for assertions
   * @param {string} data.assertionType - Assertion type (equals, contains, etc.)
   * @param {string} data.pageName - Page name for page object mapping
   * @param {string} data.elementName - Element name for locator repository
   * @param {string} data.locatorId - Reference to locator repository entry
   * @param {Object} data.waitStrategy - Wait strategy configuration
   * @param {string} data.normalizedDescription - Human-readable description
   * @param {string} data.normalizedSelector - Normalized selector
   * @param {number} data.timestamp - Timestamp when step was recorded
   * @param {Object} data.metadata - Additional step metadata
   */
  constructor(data = {}) {
    this.kind = data.kind || 'click';
    this.selector = data.selector || '';
    this.url = data.url || '';
    this.value = data.value || '';
    this.expectedValue = data.expectedValue || '';
    this.assertionType = data.assertionType || 'equals';
    this.pageName = data.pageName || '';
    this.elementName = data.elementName || '';
    this.locatorId = data.locatorId || '';
    this.waitStrategy = data.waitStrategy || {
      type: 'default', // default, visible, clickable, urlContains, custom
      timeout: 10000,
      customCondition: null
    };
    this.normalizedDescription = data.normalizedDescription || '';
    this.normalizedSelector = data.normalizedSelector || '';
    this.timestamp = data.timestamp || Date.now();
    this.metadata = data.metadata || {};
  }

  /**
   * Convert to plain object for serialization
   * @returns {Object}
   */
  toJSON() {
    return {
      kind: this.kind,
      selector: this.selector,
      url: this.url,
      value: this.value,
      expectedValue: this.expectedValue,
      assertionType: this.assertionType,
      pageName: this.pageName,
      elementName: this.elementName,
      locatorId: this.locatorId,
      waitStrategy: this.waitStrategy,
      normalizedDescription: this.normalizedDescription,
      normalizedSelector: this.normalizedSelector,
      timestamp: this.timestamp,
      metadata: this.metadata
    };
  }

  /**
   * Create Step from plain object (backward compatible with existing step format)
   * @param {Object} data - Plain object data
   * @returns {Step}
   */
  static fromJSON(data) {
    // Handle both new Step model and legacy step format
    if (data instanceof Step) {
      return data;
    }
    return new Step(data);
  }

  /**
   * Convert legacy step format to Step model
   * @param {Object} legacyStep - Legacy step object
   * @returns {Step}
   */
  static fromLegacyStep(legacyStep) {
    return new Step({
      kind: legacyStep.kind,
      selector: legacyStep.selector,
      url: legacyStep.url,
      value: legacyStep.value,
      expectedValue: legacyStep.expectedValue,
      assertionType: legacyStep.assertionType,
      normalizedDescription: legacyStep.normalizedDescription,
      normalizedSelector: legacyStep.normalizedSelector,
      timestamp: legacyStep.timestamp,
      metadata: legacyStep
    });
  }
}

