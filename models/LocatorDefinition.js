/**
 * LocatorDefinition Domain Model
 * Represents a locator entry in the locator repository
 */
export class LocatorDefinition {
  /**
   * @param {Object} data - Locator definition data
   * @param {string} data.id - Unique identifier for this locator
   * @param {string} data.pageName - Page name this locator belongs to (required)
   * @param {string} data.elementName - Element name/identifier (required)
   * @param {string} data.locatorType - Locator type (css, xpath, id, name, testId, role, text) (required)
   * @param {string} data.locatorValue - Locator value/expression (required)
   * @param {Array<Object>} data.fallbackLocators - Array of fallback locators [{type, value}, ...]
   * @param {string} data.description - Human-readable description
   * @param {Object} data.metadata - Metadata (lastSuccess, notes, priority, etc.)
   */
  constructor(data = {}) {
    this.id = data.id || `loc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.pageName = data.pageName || '';
    this.elementName = data.elementName || '';
    this.locatorType = data.locatorType || 'css'; // css, xpath, id, name, testId, role, text
    this.locatorValue = data.locatorValue || '';
    this.fallbackLocators = Array.isArray(data.fallbackLocators) ? data.fallbackLocators : [];
    this.description = data.description || '';
    this.metadata = {
      lastSuccess: data.metadata?.lastSuccess || null,
      lastFailure: data.metadata?.lastFailure || null,
      successCount: data.metadata?.successCount || 0,
      failureCount: data.metadata?.failureCount || 0,
      notes: data.metadata?.notes || '',
      priority: data.metadata?.priority || 'medium', // high, medium, low
      ...(data.metadata || {})
    };
  }

  /**
   * Get the primary locator as an object
   * @returns {Object} {type, value}
   */
  getPrimaryLocator() {
    return {
      type: this.locatorType,
      value: this.locatorValue
    };
  }

  /**
   * Get all locators (primary + fallbacks)
   * @returns {Array<Object>} Array of {type, value} objects
   */
  getAllLocators() {
    const locators = [this.getPrimaryLocator()];
    return locators.concat(this.fallbackLocators);
  }

  /**
   * Convert to Playwright locator string
   * @returns {string}
   */
  toPlaywrightLocator() {
    switch (this.locatorType) {
      case 'css':
        return this.locatorValue;
      case 'xpath':
        return `xpath=${this.locatorValue}`;
      case 'id':
        return `#${this.locatorValue}`;
      case 'name':
        return `[name="${this.locatorValue}"]`;
      case 'testId':
        return `[data-testid="${this.locatorValue}"]`;
      case 'role':
        return `role=${this.locatorValue}`;
      case 'text':
        return `text=${this.locatorValue}`;
      default:
        return this.locatorValue;
    }
  }

  /**
   * Convert to Selenium locator (By object representation)
   * @returns {Object} {type, value} for Selenium By
   */
  toSeleniumLocator() {
    return {
      type: this.locatorType === 'css' ? 'cssSelector' : 
            this.locatorType === 'xpath' ? 'xpath' :
            this.locatorType === 'id' ? 'id' :
            this.locatorType === 'name' ? 'name' :
            'cssSelector', // default
      value: this.locatorValue
    };
  }

  /**
   * Convert to plain object for serialization
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      pageName: this.pageName,
      elementName: this.elementName,
      locatorType: this.locatorType,
      locatorValue: this.locatorValue,
      fallbackLocators: this.fallbackLocators,
      description: this.description,
      metadata: this.metadata
    };
  }

  /**
   * Create LocatorDefinition from plain object
   * @param {Object} data - Plain object data
   * @returns {LocatorDefinition}
   */
  static fromJSON(data) {
    return new LocatorDefinition(data);
  }
}

