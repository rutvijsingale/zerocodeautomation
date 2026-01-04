/**
 * Environment Service
 * Manages environment configurations (DEV, SIT, UAT, PROD, etc.)
 */

import { FileService } from './fileService.js';
import { Environment } from '../models/Environment.js';
import path from 'path';
import fs from 'fs/promises';

export class EnvironmentService {
  /**
   * @param {FileService} fileService - File service instance
   * @param {string} configDir - Directory for storing environment configs
   */
  constructor(fileService, configDir = 'config') {
    this.fileService = fileService;
    this.configDir = configDir;
    this.configFilePath = path.join(configDir, 'environments.json');
    this.environmentsCache = null;
  }

  /**
   * Load all environments from config file
   * @returns {Promise<Array<Environment>>}
   */
  async loadEnvironments() {
    // Return cached if available
    if (this.environmentsCache) {
      return this.environmentsCache;
    }

    try {
      const content = await this.fileService.readFile(this.configFilePath);
      const data = JSON.parse(content);
      
      const environments = Array.isArray(data.environments)
        ? data.environments.map(env => Environment.fromJSON(env))
        : [];
      
      // Cache the loaded environments
      this.environmentsCache = environments;
      return environments;
    } catch (error) {
      if (error.message.includes('File not found')) {
        // File doesn't exist, create default environments
        const defaultEnvs = this.getDefaultEnvironments();
        await this.saveEnvironments(defaultEnvs);
        this.environmentsCache = defaultEnvs;
        return defaultEnvs;
      }
      console.error('[EnvironmentService] Error loading environments:', error);
      return this.getDefaultEnvironments();
    }
  }

  /**
   * Save environments to config file
   * @param {Array<Environment>} environments - Environments to save
   * @returns {Promise<void>}
   */
  async saveEnvironments(environments) {
    const data = {
      updated: new Date().toISOString(),
      environments: environments.map(env => 
        env instanceof Environment ? env.toJSON() : env
      )
    };

    await this.fileService.writeFile(
      this.configFilePath,
      JSON.stringify(data, null, 2)
    );
    
    // Update cache
    this.environmentsCache = environments;
  }

  /**
   * Get environment by name
   * @param {string} name - Environment name
   * @returns {Promise<Environment|null>}
   */
  async getEnvironment(name) {
    const environments = await this.loadEnvironments();
    return environments.find(env => env.name === name) || null;
  }

  /**
   * Add or update an environment
   * @param {Environment} environment - Environment to save
   * @returns {Promise<void>}
   */
  async saveEnvironment(environment) {
    const environments = await this.loadEnvironments();
    const existingIndex = environments.findIndex(env => env.name === environment.name);
    
    if (existingIndex >= 0) {
      environments[existingIndex] = environment;
    } else {
      environments.push(environment);
    }
    
    await this.saveEnvironments(environments);
  }

  /**
   * Delete an environment
   * @param {string} name - Environment name to delete
   * @returns {Promise<boolean>} True if deleted, false if not found
   */
  async deleteEnvironment(name) {
    const environments = await this.loadEnvironments();
    const initialLength = environments.length;
    const filtered = environments.filter(env => env.name !== name);
    
    if (filtered.length < initialLength) {
      await this.saveEnvironments(filtered);
      return true;
    }
    return false;
  }

  /**
   * Get default environments
   * @returns {Array<Environment>}
   */
  getDefaultEnvironments() {
    return [
      new Environment({
        name: 'DEV',
        baseUrl: 'http://localhost:3000',
        browserType: 'chromium',
        headless: false,
        description: 'Development environment'
      }),
      new Environment({
        name: 'SIT',
        baseUrl: 'http://sit.example.com',
        browserType: 'chromium',
        headless: true,
        description: 'System Integration Testing environment'
      }),
      new Environment({
        name: 'UAT',
        baseUrl: 'http://uat.example.com',
        browserType: 'chromium',
        headless: true,
        description: 'User Acceptance Testing environment'
      }),
      new Environment({
        name: 'PROD',
        baseUrl: 'https://example.com',
        browserType: 'chromium',
        headless: true,
        description: 'Production environment'
      })
    ];
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.environmentsCache = null;
  }
}

// Create default FileService instance
const defaultFileService = new FileService();

// Export singleton instance
export const environmentService = new EnvironmentService(defaultFileService);

