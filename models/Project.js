/**
 * Project Domain Model
 * Represents a test automation project containing features, scenarios, and configuration
 */
import { Feature } from './Feature.js';
import { Environment } from './Environment.js';

export class Project {
  /**
   * @param {Object} data - Project data
   * @param {string} data.name - Project name (required)
   * @param {string} data.description - Project description
   * @param {string} data.framework - Framework type (playwright-java, selenium-java, playwright-ts)
   * @param {string} data.baseUrl - Base URL for the application
   * @param {string} data.browserType - Default browser type (chromium, firefox, webkit, edge)
   * @param {Array<Feature>} data.features - Array of features in this project
   * @param {Environment} data.environment - Current environment configuration
   * @param {Object} data.metadata - Additional metadata (created, updated, version, etc.)
   */
  constructor(data = {}) {
    this.name = data.name || '';
    this.description = data.description || '';
    this.framework = data.framework || 'playwright-ts';
    this.baseUrl = data.baseUrl || 'http://localhost:3000';
    this.browserType = data.browserType || 'chromium';
    this.features = data.features || [];
    this.environment = data.environment || null;
    this.metadata = {
      created: data.metadata?.created || new Date().toISOString(),
      updated: data.metadata?.updated || new Date().toISOString(),
      version: data.metadata?.version || '1.0.0',
      ...(data.metadata || {})
    };
  }

  /**
   * Convert to plain object for serialization
   * @returns {Object}
   */
  toJSON() {
    return {
      name: this.name,
      description: this.description,
      framework: this.framework,
      baseUrl: this.baseUrl,
      browserType: this.browserType,
      features: this.features.map(f => f instanceof Feature ? f.toJSON() : f),
      environment: this.environment instanceof Environment ? this.environment.toJSON() : this.environment,
      metadata: this.metadata
    };
  }

  /**
   * Create Project from plain object
   * @param {Object} data - Plain object data
   * @returns {Project}
   */
  static fromJSON(data) {
    const project = new Project(data);
    if (data.features && Array.isArray(data.features)) {
      project.features = data.features.map(f => Feature.fromJSON(f));
    }
    if (data.environment) {
      project.environment = Environment.fromJSON(data.environment);
    }
    return project;
  }
}

