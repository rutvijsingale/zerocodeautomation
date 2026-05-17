/**
 * Locator Service
 * Manages locator repository - stores and retrieves locator definitions per project
 */

import { FileService } from './fileService.js';
import { LocatorDefinition } from '../models/LocatorDefinition.js';
import path from 'path';
import fs from 'fs/promises';

// Create default FileService instance
const defaultFileService = new FileService();

export class LocatorService {
  /**
   * @param {FileService} fileService - File service instance
   * @param {string} baseDir - Base directory for storing locator files
   */
  constructor(fileService, baseDir = 'test-temp') {
    this.fileService = fileService;
    this.baseDir = baseDir;
    this.locatorCache = new Map(); // Cache for loaded locators per project
  }

  /**
   * Drop the in-memory cache for a project. Call this whenever a project
   * is deleted or its locators.json is removed from disk; otherwise the
   * next loadLocators() call returns stale data and auto-promotion on a
   * fresh recording silently treats every locator as a duplicate.
   * @param {string} [projectName] - When omitted, clears the entire cache.
   */
  invalidateCache(projectName) {
    if (!projectName) {
      this.locatorCache.clear();
      return;
    }
    this.locatorCache.delete(projectName);
  }

  /**
   * Get locator repository file path for a project
   * @param {string} projectName - Project name (or project ID)
   * @returns {string} File path
   */
  getLocatorFilePath(projectName) {
    // Use projects directory structure for new multi-project support
    // Check if projects directory exists by trying to access it
    const projectsPath = path.join('projects', projectName, 'locators.json');
    // For now, prefer projects directory, fallback to test-temp for backward compatibility
    // The fileService will handle directory creation
    return projectsPath;
  }

  /**
   * Load locators for a project
   * @param {string} projectName - Project name
   * @returns {Promise<Array<LocatorDefinition>>}
   */
  async loadLocators(projectName) {
    if (!projectName) {
      return [];
    }

    // Check cache first
    if (this.locatorCache.has(projectName)) {
      return this.locatorCache.get(projectName);
    }

    try {
      const filePath = this.getLocatorFilePath(projectName);
      const content = await this.fileService.readFile(filePath);
      const data = JSON.parse(content);
      
      const locators = Array.isArray(data.locators) 
        ? data.locators.map(loc => LocatorDefinition.fromJSON(loc))
        : [];
      
      // Cache the loaded locators
      this.locatorCache.set(projectName, locators);
      return locators;
    } catch (error) {
      if (error.message.includes('File not found')) {
        // File doesn't exist yet, return empty array
        this.locatorCache.set(projectName, []);
        return [];
      }
      console.error(`[LocatorService] Error loading locators for ${projectName}:`, error);
      return [];
    }
  }

  /**
   * Save locators for a project
   * @param {string} projectName - Project name
   * @param {Array<LocatorDefinition>} locators - Locators to save
   * @returns {Promise<void>}
   */
  async saveLocators(projectName, locators) {
    if (!projectName) {
      throw new Error('Project name is required');
    }

    const filePath = this.getLocatorFilePath(projectName);
    const data = {
      projectName: projectName,
      updated: new Date().toISOString(),
      locators: locators.map(loc => loc instanceof LocatorDefinition ? loc.toJSON() : loc)
    };

    await this.fileService.writeFile(filePath, JSON.stringify(data, null, 2));
    
    // Update cache
    this.locatorCache.set(projectName, locators);
  }

  /**
   * Add or update a locator
   * @param {string} projectName - Project name
   * @param {LocatorDefinition} locator - Locator to add/update
   * @returns {Promise<void>}
   */
  async saveLocator(projectName, locator) {
    const locators = await this.loadLocators(projectName);
    const existingIndex = locators.findIndex(l => l.id === locator.id);
    
    if (existingIndex >= 0) {
      locators[existingIndex] = locator;
    } else {
      locators.push(locator);
    }
    
    await this.saveLocators(projectName, locators);
  }

  /**
   * Get locator by ID
   * @param {string} projectName - Project name
   * @param {string} locatorId - Locator ID
   * @returns {Promise<LocatorDefinition|null>}
   */
  async getLocatorById(projectName, locatorId) {
    const locators = await this.loadLocators(projectName);
    return locators.find(l => l.id === locatorId) || null;
  }

  /**
   * Get locator by page name and element name
   * @param {string} projectName - Project name
   * @param {string} pageName - Page name
   * @param {string} elementName - Element name
   * @returns {Promise<LocatorDefinition|null>}
   */
  async getLocatorByPageAndElement(projectName, pageName, elementName) {
    const locators = await this.loadLocators(projectName);
    return locators.find(l => 
      l.pageName === pageName && l.elementName === elementName
    ) || null;
  }

  /**
   * Get all locators for a page
   * @param {string} projectName - Project name
   * @param {string} pageName - Page name
   * @returns {Promise<Array<LocatorDefinition>>}
   */
  async getLocatorsByPage(projectName, pageName) {
    const locators = await this.loadLocators(projectName);
    return locators.filter(l => l.pageName === pageName);
  }

  /**
   * Delete a locator
   * @param {string} projectName - Project name
   * @param {string} locatorId - Locator ID to delete
   * @returns {Promise<boolean>} True if deleted, false if not found
   */
  async deleteLocator(projectName, locatorId) {
    const locators = await this.loadLocators(projectName);
    const initialLength = locators.length;
    const filtered = locators.filter(l => l.id !== locatorId);
    
    if (filtered.length < initialLength) {
      await this.saveLocators(projectName, filtered);
      return true;
    }
    return false;
  }

  /**
   * Find or create locator from step
   * If step has pageName and elementName, try to find existing locator or create new one
   * @param {string} projectName - Project name
   * @param {Object} step - Step object
   * @returns {Promise<LocatorDefinition|null>}
   */
  async findOrCreateLocatorFromStep(projectName, step) {
    if (!step.pageName || !step.elementName) {
      return null;
    }

    let locator = await this.getLocatorByPageAndElement(projectName, step.pageName, step.elementName);
    
    if (!locator && step.selector) {
      // Create new locator from step
      locator = new LocatorDefinition({
        pageName: step.pageName,
        elementName: step.elementName,
        locatorType: this.inferLocatorType(step.selector),
        locatorValue: step.selector,
        description: step.normalizedDescription || step.elementName
      });
      
      await this.saveLocator(projectName, locator);
    }
    
    return locator;
  }

  /**
   * Infer locator type from selector string
   * @param {string} selector - Selector string
   * @returns {string} Locator type
   */
  inferLocatorType(selector) {
    if (!selector) return 'css';
    
    if (selector.startsWith('//') || selector.startsWith('(//')) {
      return 'xpath';
    }
    if (selector.startsWith('#')) {
      return 'id';
    }
    if (selector.startsWith('[') && selector.includes('data-testid')) {
      return 'testId';
    }
    if (selector.startsWith('role=') || selector.startsWith('getByRole')) {
      return 'role';
    }
    if (selector.startsWith('text=') || selector.startsWith('getByText')) {
      return 'text';
    }
    if (selector.startsWith('[name=')) {
      return 'name';
    }
    
    return 'css'; // default
  }

  /**
   * Clear cache for a project
   * @param {string} projectName - Project name
   */
  clearCache(projectName) {
    if (projectName) {
      this.locatorCache.delete(projectName);
    } else {
      this.locatorCache.clear();
    }
  }
}

// Export singleton instance
export const locatorService = new LocatorService(defaultFileService);

