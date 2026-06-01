/**
 * Project Service
 * Manages multi-project support - CRUD operations for projects
 */

import { FileService } from './fileService.js';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

export class ProjectService {
  /**
   * @param {FileService} fileService - File service instance
   * @param {string} projectsDir - Directory for storing projects
   */
  constructor(fileService, projectsDir = 'projects') {
    this.fileService = fileService;
    this.projectsDir = path.resolve(projectsDir);
    this.currentProjectId = null;
    this.projectsCache = null;
  }

  /**
   * Ensure projects directory exists
   */
  async ensureProjectsDir() {
    await this.fileService.ensureDirectory(this.projectsDir);
  }

  /**
   * Get project directory path
   * @param {string} projectId - Project ID
   * @returns {string} Project directory path
   */
  getProjectDir(projectId) {
    return path.join(this.projectsDir, projectId);
  }

  /**
   * Get project.json file path
   * @param {string} projectId - Project ID
   * @returns {string} Project JSON file path
   */
  getProjectFilePath(projectId) {
    return path.join(this.getProjectDir(projectId), 'project.json');
  }

  /**
   * List all projects
   * @returns {Promise<Array<Object>>} Array of project metadata
   */
  async listProjects() {
    try {
      await this.ensureProjectsDir();
      const entries = await fs.readdir(this.projectsDir, { withFileTypes: true });
      const projects = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const projectId = entry.name;
          const projectPath = this.getProjectFilePath(projectId);
          
          try {
            const content = await this.fileService.readFile(projectPath);
            const projectData = JSON.parse(content);
            projects.push({
              id: projectId,
              name: projectData.name || projectId,
              description: projectData.description || '',
              baseUrl: projectData.baseUrl || '',
              framework: projectData.framework || 'playwright-java',
              updated: projectData.updated || projectData.metadata?.updated || new Date().toISOString(),
              created: projectData.created || projectData.metadata?.created || new Date().toISOString()
            });
          } catch (error) {
            // Project file doesn't exist or is invalid, skip it
            console.warn(`[ProjectService] Skipping invalid project: ${projectId}`, error.message);
          }
        }
      }

      // Sort by updated date (newest first)
      projects.sort((a, b) => new Date(b.updated) - new Date(a.updated));
      return projects;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Projects directory doesn't exist yet
        await this.ensureProjectsDir();
        return [];
      }
      console.error('[ProjectService] Error listing projects:', error);
      return [];
    }
  }

  /**
   * Create a new project
   * @param {string} name - Project name
   * @param {Object} options - Project options
   * @returns {Promise<Object>} Created project data
   */
  async createProject(name, options = {}) {
    if (!name || typeof name !== 'string' || name.trim() === '') {
      throw new Error('Project name is required');
    }

    await this.ensureProjectsDir();

    // Generate project ID from name (sanitized)
    const projectId = this.sanitizeProjectId(name);
    
    // Check if project already exists
    const existingProjects = await this.listProjects();
    if (existingProjects.some(p => p.id === projectId)) {
      // Append timestamp to make it unique
      const timestamp = Date.now();
      const projectIdWithTimestamp = `${projectId}-${timestamp}`;
      return this.createProject(name, { ...options, projectId: projectIdWithTimestamp });
    }

    // Use provided projectId if available
    const finalProjectId = options.projectId || projectId;
    const projectDir = this.getProjectDir(finalProjectId);

    // Create project structure
    await this.fileService.ensureDirectory(projectDir);
    await this.fileService.ensureDirectory(path.join(projectDir, 'features'));
    await this.fileService.ensureDirectory(path.join(projectDir, 'steps'));
    await this.fileService.ensureDirectory(path.join(projectDir, 'pages'));
    await this.fileService.ensureDirectory(path.join(projectDir, 'locators'));

    // Create initial project data
    const projectData = {
      id: finalProjectId,
      name: name.trim(),
      description: options.description || '',
      baseUrl: options.baseUrl || 'http://localhost:3000',
      framework: options.framework || 'playwright-java',
      browserType: options.browserType || 'chromium',
      features: [],
      scenarios: [],
      steps: [],
      backgroundSteps: [],
      pages: [],
      locators: [],
      testData: [],
      reusableFlows: [],
      metadata: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        version: '1.0.0'
      }
    };

    // Save project.json
    await this.fileService.writeFile(
      this.getProjectFilePath(finalProjectId),
      JSON.stringify(projectData, null, 2)
    );

    return projectData;
  }

  /**
   * Load project data
   * @param {string} projectId - Project ID
   * @returns {Promise<Object>} Project data
   */
  async loadProjectData(projectId) {
    if (!projectId) {
      throw new Error('Project ID is required');
    }

    const projectPath = this.getProjectFilePath(projectId);
    
    try {
      const content = await this.fileService.readFile(projectPath);
      const projectData = JSON.parse(content);
      
      // Ensure all required fields exist
      return {
        id: projectData.id || projectId,
        name: projectData.name || projectId,
        description: projectData.description || '',
        baseUrl: projectData.baseUrl || 'http://localhost:3000',
        framework: projectData.framework || 'playwright-java',
        // [ZAC-FIX] FIX E — surface stored framework version (defaults to "latest"
        // so old project files keep loading without a migration).
        frameworkVersion: projectData.frameworkVersion || 'latest',
        browserType: projectData.browserType || 'chromium',
        features: projectData.features || [],
        scenarios: projectData.scenarios || [],
        steps: projectData.steps || [],
        backgroundSteps: projectData.backgroundSteps || [],
        pages: projectData.pages || [],
        locators: projectData.locators || [],
        testData: projectData.testData || [],
        reusableFlows: projectData.reusableFlows || [],
        // [ZAC-FIX] FIX A — manual editor edits (Selenium / Feature / Steps panes).
        manualCode: projectData.manualCode || null,
        // [ZAC-FIX 2026-06-01] Multi-environment support.
        // Each entry: { name: 'QA' | 'STAGE' | 'DEV' | …, baseUrl, browser?, headless? }.
        // The IDE's recording tab + Settings let users define these and pick
        // which env to record/run against. The POM refactor reads this field
        // and emits config/.env.<name> files per env.
        environments: Array.isArray(projectData.environments) ? projectData.environments : [],
        metadata: {
          created: projectData.metadata?.created || new Date().toISOString(),
          updated: projectData.metadata?.updated || new Date().toISOString(),
          version: projectData.metadata?.version || '1.0.0',
          ...(projectData.metadata || {})
        }
      };
    } catch (error) {
      if (error.message.includes('File not found')) {
        throw new Error(`Project not found: ${projectId}`);
      }
      throw error;
    }
  }

  /**
   * Save project data
   * @param {string} projectId - Project ID
   * @param {Object} projectData - Project data to save
   * @returns {Promise<void>}
   */
  async saveProjectData(projectId, projectData) {
    if (!projectId) {
      throw new Error('Project ID is required');
    }

    // Ensure project directory exists
    const projectDir = this.getProjectDir(projectId);
    await this.fileService.ensureDirectory(projectDir);

    // Update metadata
    const updatedData = {
      ...projectData,
      id: projectId,
      metadata: {
        ...(projectData.metadata || {}),
        updated: new Date().toISOString()
      }
    };

    // Save project.json
    await this.fileService.writeFile(
      this.getProjectFilePath(projectId),
      JSON.stringify(updatedData, null, 2)
    );

    // Clear cache
    this.projectsCache = null;
  }

  /**
   * Set current project
   * @param {string} projectId - Project ID
   * @returns {Promise<void>}
   */
  async setCurrentProject(projectId) {
    this.currentProjectId = projectId;
    // Could also persist to a config file if needed
  }

  /**
   * Get current project ID
   * @returns {string|null} Current project ID
   */
  getCurrentProject() {
    return this.currentProjectId;
  }

  /**
   * Delete a project
   * @param {string} projectId - Project ID
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteProject(projectId) {
    if (!projectId) {
      throw new Error('Project ID is required');
    }

    try {
      const projectDir = this.getProjectDir(projectId);
      await fs.rm(projectDir, { recursive: true, force: true });

      // [ZAC-FIX 2026-05-24] Single delete previously left orphans
      // under generated-projects/<framework>/<projectId>/ (the
      // generated Java/JS code, reruns, screenshots, videos). The
      // dashboard then showed "ghost" projects with 0 reruns and
      // confused QA. Sweep every framework dir and remove any
      // matching folder. Anything else under generated-projects/
      // (other projects, framework dirs themselves) is untouched.
      try {
        const repoRoot = path.resolve(this.projectsDir, '..');
        const genRoot = path.join(repoRoot, 'generated-projects');
        const frameworkDirs = await fs.readdir(genRoot, { withFileTypes: true }).catch(() => []);
        for (const fw of frameworkDirs) {
          if (!fw.isDirectory()) continue;
          const target = path.join(genRoot, fw.name, projectId);
          await fs.rm(target, { recursive: true, force: true }).catch(() => {});
        }
      } catch (genErr) {
        // Best-effort: don't block the primary delete on cleanup failures.
        console.warn(`[ProjectService] generated-projects cleanup for ${projectId} failed:`, genErr.message);
      }

      if (this.currentProjectId === projectId) {
        this.currentProjectId = null;
      }

      this.projectsCache = null;
      return true;
    } catch (error) {
      console.error(`[ProjectService] Error deleting project ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Bulk-delete every project: wipes projects/<id>/ + every
   * generated-projects/<framework>/<id>/ mirror for ids we own.
   *
   * Does NOT touch:
   *   - config/ (frameworks.json, email.json, credentials.json)
   *   - public/ (frontend assets)
   *   - services/ (backend code)
   *   - environments / locators-strategy snapshots stored elsewhere
   *
   * @returns {Promise<{ deleted: number, ids: string[], errors: Array<{id, error}> }>}
   */
  async deleteAllProjects() {
    const projects = await this.listProjects();
    const ids = projects.map((p) => p.id).filter(Boolean);
    const errors = [];
    for (const id of ids) {
      try {
        await this.deleteProject(id);
      } catch (e) {
        errors.push({ id, error: e.message });
      }
    }
    this.currentProjectId = null;
    this.projectsCache = null;
    return { deleted: ids.length - errors.length, ids, errors };
  }

  /**
   * Sanitize project name to create valid project ID
   * @param {string} name - Project name
   * @returns {string} Sanitized project ID
   */
  sanitizeProjectId(name) {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50) || `project-${Date.now()}`;
  }

}

// Create default FileService instance
const defaultFileService = new FileService();

// Export singleton instance
export const projectService = new ProjectService(defaultFileService);

