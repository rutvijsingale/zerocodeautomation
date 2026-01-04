/**
 * TestDataSet Domain Model
 * Represents test data for Scenario Outline (Examples table)
 */
export class TestDataSet {
  /**
   * @param {Object} data - Test data set data
   * @param {string} data.name - Data set name
   * @param {Array<string>} data.parameters - Parameter names (column headers)
   * @param {Array<Object>} data.rows - Data rows (array of objects with parameter values)
   * @param {Object} data.metadata - Additional metadata
   */
  constructor(data = {}) {
    this.name = data.name || 'Examples';
    this.parameters = Array.isArray(data.parameters) ? data.parameters : [];
    this.rows = Array.isArray(data.rows) ? data.rows : [];
    this.metadata = data.metadata || {};
  }

  /**
   * Add a data row
   * @param {Object} rowData - Object with parameter values
   */
  addRow(rowData) {
    this.rows.push(rowData);
  }

  /**
   * Get parameter value from a row
   * @param {number} rowIndex - Row index (0-based)
   * @param {string} parameterName - Parameter name
   * @returns {string|undefined}
   */
  getValue(rowIndex, parameterName) {
    if (rowIndex < 0 || rowIndex >= this.rows.length) {
      return undefined;
    }
    return this.rows[rowIndex][parameterName];
  }

  /**
   * Convert to Gherkin Examples table format
   * @returns {Array<string>} Array of lines for Examples table
   */
  toGherkinExamples() {
    const lines = [];
    if (this.parameters.length === 0 || this.rows.length === 0) {
      return lines;
    }

    lines.push('    Examples:');
    lines.push(`      | ${this.parameters.join(' | ')} |`);
    
    this.rows.forEach(row => {
      const values = this.parameters.map(param => row[param] || '');
      lines.push(`      | ${values.join(' | ')} |`);
    });

    return lines;
  }

  /**
   * Convert to plain object for serialization
   * @returns {Object}
   */
  toJSON() {
    return {
      name: this.name,
      parameters: this.parameters,
      rows: this.rows,
      metadata: this.metadata
    };
  }

  /**
   * Create TestDataSet from plain object
   * @param {Object} data - Plain object data
   * @returns {TestDataSet}
   */
  static fromJSON(data) {
    return new TestDataSet(data);
  }

  /**
   * Create TestDataSet from legacy examples array format
   * @param {Array<Object>} examples - Legacy examples array
   * @returns {TestDataSet}
   */
  static fromLegacyExamples(examples) {
    if (!Array.isArray(examples) || examples.length === 0) {
      return new TestDataSet();
    }

    const parameters = Object.keys(examples[0]);
    return new TestDataSet({
      parameters: parameters,
      rows: examples
    });
  }
}

