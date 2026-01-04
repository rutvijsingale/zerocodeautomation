/**
 * Maven Service
 * Handles Maven command execution for Java projects
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

export class MavenService {
  constructor() {
    this.runningCommands = new Map(); // Map<executionId, { process, projectId, command }>
  }

  /**
   * Check if Maven is installed
   * @returns {Promise<{installed: boolean, version?: string, error?: string}>}
   */
  async checkMavenInstalled() {
    try {
      const result = await this.executeCommand('mvn', ['--version'], null, { timeout: 10000 });
      if (result.success && result.stdout) {
        const versionMatch = result.stdout.match(/Apache Maven (\d+\.\d+\.\d+)/);
        return {
          installed: true,
          version: versionMatch ? versionMatch[1] : 'unknown',
          output: result.stdout
        };
      }
      return { installed: false, error: 'Maven command failed' };
    } catch (error) {
      return { installed: false, error: error.message };
    }
  }

  /**
   * Check if a project directory has a pom.xml file
   * @param {string} projectDir - Project directory path
   * @returns {Promise<boolean>}
   */
  async isMavenProject(projectDir) {
    try {
      const pomPath = path.join(projectDir, 'pom.xml');
      await fs.access(pomPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute a Maven command
   * @param {string} projectDir - Project directory path
   * @param {string} command - Maven command (e.g., 'test', 'clean', 'install')
   * @param {Array<string>} args - Additional Maven arguments
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Execution result
   */
  async executeMavenCommand(projectDir, command, args = [], options = {}) {
    const executionId = `maven_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const { timeout = 300000, onOutput } = options; // Default 5 minutes timeout

    // Check if Maven is installed
    const mavenCheck = await this.checkMavenInstalled();
    if (!mavenCheck.installed) {
      const errorMessage = mavenCheck.error && mavenCheck.error.includes('spawn mvn')
        ? `Maven is not installed or not found in PATH. Please install Maven to run Java projects.\n\nInstallation instructions:\n- Windows: Download from https://maven.apache.org/download.cgi or use chocolatey: choco install maven\n- macOS: brew install maven\n- Linux: sudo apt-get install maven (Ubuntu/Debian) or sudo yum install maven (RHEL/CentOS)\n\nAfter installation, ensure Maven is added to your system PATH and restart the application.`
        : `Maven is not available: ${mavenCheck.error || 'Unknown error'}`;
      throw new Error(errorMessage);
    }

    // Check if project is a Maven project
    const isMaven = await this.isMavenProject(projectDir);
    if (!isMaven) {
      throw new Error('Project directory does not contain a pom.xml file');
    }

    // Build Maven command
    const mavenArgs = [command, ...args];
    
    // Add common Maven options
    if (!mavenArgs.includes('-X') && !mavenArgs.includes('--debug')) {
      // Use -q (quiet) by default, but allow override
      if (!mavenArgs.includes('-q') && !mavenArgs.includes('--quiet')) {
        mavenArgs.push('-q'); // Quiet mode to reduce noise
      }
    }

    console.log(`[Maven] Executing: mvn ${mavenArgs.join(' ')} in ${projectDir}`);

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let outputLines = [];

      // Spawn Maven process
      const mavenProcess = spawn('mvn', mavenArgs, {
        cwd: projectDir,
        shell: process.platform === 'win32', // Use shell on Windows
        env: {
          ...process.env,
          // Ensure UTF-8 encoding
          JAVA_TOOL_OPTIONS: '-Dfile.encoding=UTF-8',
          ...(options.env || {})
        }
      });

      // Store process for cancellation
      const executionState = {
        process: mavenProcess,
        projectDir,
        command: `mvn ${mavenArgs.join(' ')}`,
        startTime
      };
      this.runningCommands.set(executionId, executionState);

      // Handle stdout
      mavenProcess.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        const lines = text.split('\n').filter(line => line.trim());
        outputLines.push(...lines);
        
        // Call onOutput callback if provided
        if (onOutput) {
          lines.forEach(line => onOutput(line, 'stdout'));
        }
      });

      // Handle stderr
      mavenProcess.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        const lines = text.split('\n').filter(line => line.trim());
        outputLines.push(...lines);
        
        // Call onOutput callback if provided
        if (onOutput) {
          lines.forEach(line => onOutput(line, 'stderr'));
        }
      });

      // Handle process exit
      mavenProcess.on('close', (code) => {
        const duration = Date.now() - startTime;
        this.runningCommands.delete(executionId);

        const result = {
          executionId,
          success: code === 0,
          exitCode: code,
          duration: `${(duration / 1000).toFixed(2)}s`,
          stdout,
          stderr,
          output: outputLines,
          command: `mvn ${mavenArgs.join(' ')}`,
          projectDir
        };

        if (code === 0) {
          resolve(result);
        } else {
          reject(new Error(`Maven command failed with exit code ${code}: ${stderr || stdout}`));
        }
      });

      // Handle process error
      mavenProcess.on('error', (error) => {
        this.runningCommands.delete(executionId);
        // Check if error is due to Maven not being found
        if (error.code === 'ENOENT' || error.message.includes('spawn mvn') || error.message.includes('not found')) {
          reject(new Error(`Maven is not installed or not found in PATH. Please install Maven to run Java projects.\n\nInstallation instructions:\n- Windows: Download from https://maven.apache.org/download.cgi or use chocolatey: choco install maven\n- macOS: brew install maven\n- Linux: sudo apt-get install maven (Ubuntu/Debian) or sudo yum install maven (RHEL/CentOS)\n\nAfter installation, ensure Maven is added to your system PATH and restart the application.`));
        } else {
          reject(new Error(`Failed to execute Maven command: ${error.message}`));
        }
      });

      // Set timeout
      if (timeout > 0) {
        setTimeout(() => {
          if (mavenProcess.killed === false) {
            console.log(`[Maven] Command timeout after ${timeout}ms, killing process...`);
            mavenProcess.kill('SIGTERM');
            this.runningCommands.delete(executionId);
            
            // Force kill after 5 seconds if still running
            setTimeout(() => {
              if (mavenProcess.killed === false) {
                mavenProcess.kill('SIGKILL');
              }
            }, 5000);
            
            reject(new Error(`Maven command timed out after ${timeout}ms`));
          }
        }, timeout);
      }
    });
  }

  /**
   * Cancel a running Maven command
   * @param {string} executionId - Execution ID
   * @returns {Promise<boolean>} True if cancelled
   */
  async cancelCommand(executionId) {
    const executionState = this.runningCommands.get(executionId);
    
    if (!executionState) {
      return false;
    }

    try {
      console.log(`[Maven] Cancelling command ${executionId}`);
      executionState.process.kill('SIGTERM');
      
      // Force kill after 3 seconds if still running
      setTimeout(() => {
        if (executionState.process.killed === false) {
          executionState.process.kill('SIGKILL');
        }
      }, 3000);
      
      this.runningCommands.delete(executionId);
      return true;
    } catch (error) {
      console.error(`[Maven] Error cancelling command:`, error);
      return false;
    }
  }

  /**
   * Get running commands
   * @returns {Array<Object>} List of running commands
   */
  getRunningCommands() {
    return Array.from(this.runningCommands.entries()).map(([id, state]) => ({
      executionId: id,
      projectDir: state.projectDir,
      command: state.command,
      startTime: state.startTime,
      duration: Date.now() - state.startTime
    }));
  }

  /**
   * Generic command execution helper (for checking Maven installation)
   * @private
   */
  async executeCommand(command, args, cwd, options = {}) {
    return new Promise((resolve, reject) => {
      const childProcess = spawn(command, args, {
        cwd: cwd || process.cwd(),
        shell: process.platform === 'win32',
        ...options
      });

      let stdout = '';
      let stderr = '';

      childProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      childProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      childProcess.on('close', (code) => {
        resolve({
          success: code === 0,
          exitCode: code,
          stdout,
          stderr
        });
      });

      childProcess.on('error', (error) => {
        reject(error);
      });

      if (options.timeout) {
        setTimeout(() => {
          if (childProcess.killed === false) {
            childProcess.kill('SIGTERM');
            reject(new Error('Command timed out'));
          }
        }, options.timeout);
      }
    });
  }
}

// Export singleton instance
export const mavenService = new MavenService();

