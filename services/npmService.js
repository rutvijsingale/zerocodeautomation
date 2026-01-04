/**
 * NPM Service
 * Handles npm command execution for Node.js/TypeScript projects
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

export class NpmService {
  constructor() {
    this.runningCommands = new Map(); // Map<executionId, { process, projectDir, command }>
  }

  /**
   * Check if npm is installed
   * @returns {Promise<{installed: boolean, version?: string, error?: string}>}
   */
  async checkNpmInstalled() {
    try {
      const result = await this.executeCommand('npm', ['--version'], null, { timeout: 10000 });
      if (result.success && result.stdout) {
        return {
          installed: true,
          version: result.stdout.trim(),
          output: result.stdout
        };
      }
      return { installed: false, error: 'npm command failed' };
    } catch (error) {
      return { installed: false, error: error.message };
    }
  }

  /**
   * Check if a project directory has a package.json file
   * @param {string} projectDir - Project directory path
   * @returns {Promise<boolean>}
   */
  async isNpmProject(projectDir) {
    try {
      const packageJsonPath = path.join(projectDir, 'package.json');
      await fs.access(packageJsonPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute an npm command
   * @param {string} projectDir - Project directory path
   * @param {string} command - npm command (e.g., 'test', 'install', 'run build')
   * @param {Array<string>} args - Additional npm arguments
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Execution result
   */
  async executeNpmCommand(projectDir, command, args = [], options = {}) {
    const executionId = `npm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const { timeout = 300000, onOutput } = options; // Default 5 minutes timeout

    // Check if project is an npm project
    const isNpm = await this.isNpmProject(projectDir);
    if (!isNpm) {
      throw new Error('Project directory does not contain a package.json file');
    }

    // Build npm command
    // Handle 'run' commands specially (e.g., 'run test' becomes 'test' with 'run' prefix)
    let npmArgs = [];
    if (command.startsWith('run ')) {
      // Command is like "run test" - split it
      const parts = command.split(/\s+/);
      npmArgs = ['run', ...parts.slice(1), ...args];
    } else if (command === 'run') {
      // Command is just "run" - first arg should be the script name
      npmArgs = ['run', ...args];
    } else {
      // Regular npm command (install, test, etc.)
      npmArgs = [command, ...args];
    }

    console.log(`[NPM] Executing: npm ${npmArgs.join(' ')} in ${projectDir}`);

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let outputLines = [];

      // Spawn npm process
      const npmProcess = spawn('npm', npmArgs, {
        cwd: projectDir,
        shell: process.platform === 'win32', // Use shell on Windows
        env: {
          ...process.env,
          ...(options.env || {})
        }
      });

      // Store process for cancellation
      const executionState = {
        process: npmProcess,
        projectDir,
        command: `npm ${npmArgs.join(' ')}`,
        startTime
      };
      this.runningCommands.set(executionId, executionState);

      // Handle stdout
      npmProcess.stdout.on('data', (data) => {
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
      npmProcess.stderr.on('data', (data) => {
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
      npmProcess.on('close', (code) => {
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
          command: `npm ${npmArgs.join(' ')}`,
          projectDir
        };

        if (code === 0) {
          resolve(result);
        } else {
          reject(new Error(`npm command failed with exit code ${code}: ${stderr || stdout}`));
        }
      });

      // Handle process error
      npmProcess.on('error', (error) => {
        this.runningCommands.delete(executionId);
        reject(new Error(`Failed to execute npm command: ${error.message}`));
      });

      // Set timeout
      if (timeout > 0) {
        setTimeout(() => {
          if (npmProcess.killed === false) {
            console.log(`[NPM] Command timeout after ${timeout}ms, killing process...`);
            npmProcess.kill('SIGTERM');
            this.runningCommands.delete(executionId);
            
            // Force kill after 5 seconds if still running
            setTimeout(() => {
              if (npmProcess.killed === false) {
                npmProcess.kill('SIGKILL');
              }
            }, 5000);
            
            reject(new Error(`npm command timed out after ${timeout}ms`));
          }
        }, timeout);
      }
    });
  }

  /**
   * Cancel a running npm command
   * @param {string} executionId - Execution ID
   * @returns {Promise<boolean>} True if cancelled
   */
  async cancelCommand(executionId) {
    const executionState = this.runningCommands.get(executionId);
    
    if (!executionState) {
      return false;
    }

    try {
      console.log(`[NPM] Cancelling command ${executionId}`);
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
      console.error(`[NPM] Error cancelling command:`, error);
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
   * Generic command execution helper (for checking npm installation)
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
export const npmService = new NpmService();

