/**
 * Environment Domain Model
 * Represents a test environment configuration
 */
export class Environment {
  /**
   * @param {Object} data - Environment data
   * @param {string} data.name - Environment name (required, e.g., 'DEV', 'SIT', 'UAT', 'PROD')
   * @param {string} data.baseUrl - Base URL for this environment (required)
   * @param {string} data.browserType - Default browser type
   * @param {boolean} data.headless - Whether to run in headless mode
   * @param {Object} data.timeouts - Timeout configuration
   * @param {Object} data.config - Additional environment-specific configuration
   * @param {string} data.description - Environment description
   */
  constructor(data = {}) {
    this.name = data.name || 'DEV';
    this.baseUrl = data.baseUrl || 'http://localhost:3000';
    this.browserType = data.browserType || 'chromium';
    this.headless = data.headless !== undefined ? data.headless : false;
    this.timeouts = {
      default: data.timeouts?.default || 10000,
      navigation: data.timeouts?.navigation || 30000,
      element: data.timeouts?.element || 10000,
      pageLoad: data.timeouts?.pageLoad || 30000,
      script: data.timeouts?.script || 30000,
      ...(data.timeouts || {})
    };
    this.config = data.config || {};
    this.description = data.description || '';
  }

  /**
   * Convert to Java properties format
   * @returns {string}
   */
  toJavaProperties() {
    const lines = [];
    lines.push(`# Environment: ${this.name}`);
    lines.push(`environment.name=${this.name}`);
    lines.push(`environment.baseUrl=${this.baseUrl}`);
    lines.push(`environment.browserType=${this.browserType}`);
    lines.push(`environment.headless=${this.headless}`);
    lines.push(`timeout.default=${this.timeouts.default}`);
    lines.push(`timeout.navigation=${this.timeouts.navigation}`);
    lines.push(`timeout.element=${this.timeouts.element}`);
    lines.push(`timeout.pageLoad=${this.timeouts.pageLoad}`);
    lines.push(`timeout.script=${this.timeouts.script}`);
    
    // Add custom config
    Object.entries(this.config).forEach(([key, value]) => {
      lines.push(`config.${key}=${value}`);
    });
    
    return lines.join('\n');
  }

  /**
   * Convert to TypeScript config format
   * @returns {string}
   */
  toTypeScriptConfig() {
    return `export const environment = {
  name: '${this.name}',
  baseUrl: '${this.baseUrl}',
  browserType: '${this.browserType}',
  headless: ${this.headless},
  timeouts: {
    default: ${this.timeouts.default},
    navigation: ${this.timeouts.navigation},
    element: ${this.timeouts.element},
    pageLoad: ${this.timeouts.pageLoad},
    script: ${this.timeouts.script}
  },
  config: ${JSON.stringify(this.config, null, 2)}
};`;
  }

  /**
   * Convert to plain object for serialization
   * @returns {Object}
   */
  toJSON() {
    return {
      name: this.name,
      baseUrl: this.baseUrl,
      browserType: this.browserType,
      headless: this.headless,
      timeouts: this.timeouts,
      config: this.config,
      description: this.description
    };
  }

  /**
   * Create Environment from plain object
   * @param {Object} data - Plain object data
   * @returns {Environment}
   */
  static fromJSON(data) {
    return new Environment(data);
  }
}

