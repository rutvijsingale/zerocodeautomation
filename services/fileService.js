import fs from 'fs/promises';
import path from 'path';
import archiver from 'archiver';
import { createWriteStream } from 'fs';

// Async file operations service
export class FileService {
  constructor(baseDir = 'sample-export') {
    this.baseDir = path.resolve(baseDir);
  }

  async ensureDirectory(dirPath) {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  async writeFile(filePath, content) {
    await this.ensureDirectory(path.dirname(filePath));
    await fs.writeFile(filePath, content, 'utf-8');
  }

  async readFile(filePath) {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${filePath}`);
      }
      throw error;
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async listDirectories(basePath) {
    try {
      const entries = await fs.readdir(basePath, { withFileTypes: true });
      return entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async deleteDirectory(dirPath) {
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async getProjectPath(projectName) {
    return path.join(this.baseDir, projectName);
  }

  async getProjectFiles(projectName) {
    const projectPath = await this.getProjectPath(projectName);

    if (!(await this.fileExists(projectPath))) {
      throw new Error(`Project not found: ${projectName}`);
    }

    const files = {};

    // Common project files
    const fileTypes = [
      { name: 'feature', path: 'features/recorded.feature' },
      { name: 'steps', path: 'steps/recorded.steps.ts' },
      { name: 'package', path: 'package.json' },
      { name: 'playwright', path: 'playwright.config.ts' },
      { name: 'cucumber', path: 'cucumber.config.js' }
    ];

    for (const fileType of fileTypes) {
      const filePath = path.join(projectPath, fileType.path);
      try {
        files[fileType.name] = await this.readFile(filePath);
      } catch (error) {
        // File doesn't exist, skip
        console.warn(`File not found: ${filePath}`);
      }
    }

    return files;
  }

  // [ZAC-FIX] Accept an optional explicit sourceDir. projectId-based exports
  // write their files under projects/<projectId>/ (via projectService), NOT
  // under this.baseDir/<projectName> (the legacy sample-export location). If
  // we always re-derived the path from projectName we'd zip the wrong (empty)
  // legacy dir and throw "Project not found". When the caller knows the real
  // export root it passes it here; legacy callers keep the projectName path.
  async createProjectZip(projectName, sourceDir = null) {
    const projectPath = sourceDir || await this.getProjectPath(projectName);

    if (!(await this.fileExists(projectPath))) {
      throw new Error(`Project not found: ${projectName}`);
    }

    const zipPath = path.join(this.baseDir, `${projectName}.zip`);
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    return new Promise((resolve, reject) => {
      output.on('close', () => {
        console.log(`Archive created: ${archive.pointer()} bytes`);
        resolve(zipPath);
      });

      archive.on('error', reject);
      archive.pipe(output);
      archive.directory(projectPath, false);
      archive.finalize();
    });
  }

  async cleanupOldProjects(maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 days
    try {
      const projects = await this.listDirectories(this.baseDir);
      const now = Date.now();

      for (const project of projects) {
        const projectPath = path.join(this.baseDir, project);
        try {
          const stats = await fs.stat(projectPath);
          const age = now - stats.mtime.getTime();

          if (age > maxAge) {
            console.log(`Cleaning up old project: ${project} (${Math.round(age / (24 * 60 * 60 * 1000))} days old)`);
            await this.deleteDirectory(projectPath);

            // Also remove zip file if it exists
            const zipPath = path.join(this.baseDir, `${project}.zip`);
            try {
              await fs.unlink(zipPath);
            } catch {
              // Zip file doesn't exist, ignore
            }
          }
        } catch (error) {
          console.warn(`Error checking project ${project}:`, error.message);
        }
      }
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  async getStorageStats() {
    try {
      const entries = await fs.readdir(this.baseDir, { withFileTypes: true });
      let totalSize = 0;
      let fileCount = 0;
      let projectCount = 0;

      for (const entry of entries) {
        const entryPath = path.join(this.baseDir, entry.name);
        const stats = await fs.stat(entryPath);

        if (entry.isDirectory()) {
          projectCount++;
          // Calculate directory size recursively
          totalSize += await this.getDirectorySize(entryPath);
        } else if (entry.isFile()) {
          fileCount++;
          totalSize += stats.size;
        }
      }

      return {
        totalSize,
        totalSizeMB: Math.round(totalSize / (1024 * 1024) * 100) / 100,
        projectCount,
        fileCount
      };
    } catch (error) {
      console.error('Error getting storage stats:', error);
      return { totalSize: 0, totalSizeMB: 0, projectCount: 0, fileCount: 0 };
    }
  }

  async getDirectorySize(dirPath) {
    let totalSize = 0;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          totalSize += await this.getDirectorySize(entryPath);
        } else {
          const stats = await fs.stat(entryPath);
          totalSize += stats.size;
        }
      }
    } catch (error) {
      // Directory might not exist or be accessible
    }

    return totalSize;
  }
}
