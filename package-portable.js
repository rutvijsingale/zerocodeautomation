/**
 * Portable Package Creator
 * 
 * This script creates a portable package that can be shared with others
 * without requiring them to install Node.js or run npm install.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageName = 'zero-code-automation-ide-portable';
const outputDir = path.join(__dirname, '..', packageName);

// Source directory (current directory where script is run)
const sourceDir = __dirname;

// Files to exclude
const excludePatterns = [
  'node_modules',
  '.git',
  'sample-export',
  'test-temp',
  '*.log',
  '.env',
  '.DS_Store'
];

function createPortablePackage() {
  console.log('📦 Creating portable package...\n');
  
  // Create output directory
  if (fs.existsSync(outputDir)) {
    console.log('🗑️  Removing existing package directory...');
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });
  
  // Copy files
  console.log('📋 Copying files...');
  copyDirectory(sourceDir, path.join(outputDir, 'zero-code-automation-ide'), excludePatterns);
  
  // Create launcher scripts
  createLauncherScripts(outputDir);
  
  // Create README
  createReadme(outputDir);
  
  // Create ZIP file
  createZipPackage(outputDir, packageName);
  
  console.log('\n✅ Portable package created successfully!');
  console.log(`📁 Location: ${outputDir}`);
  console.log(`📦 ZIP file: ${path.join(path.dirname(outputDir), `${packageName}.zip`)}`);
  console.log('\n💡 Share the ZIP file with your friend!');
}

function copyDirectory(src, dest, excludePatterns) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    // Check if should be excluded
    const shouldExclude = excludePatterns.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace('*', '.*'));
        return regex.test(entry.name);
      }
      return entry.name === pattern;
    });
    
    if (shouldExclude) {
      continue;
    }
    
    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath, excludePatterns);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function createLauncherScripts(outputDir) {
  console.log('📝 Creating launcher scripts...');
  
  // Windows launcher (batch file)
  const windowsLauncher = `@echo off
echo ========================================
echo Zero-Code Automation IDE
echo ========================================
echo.
echo Starting server...
echo.
cd zero-code-automation-ide
if not exist node_modules (
    echo Installing dependencies...
    call npm install
    echo.
)
echo Starting server on http://localhost:3000
echo Press Ctrl+C to stop the server
echo.
call npm start
pause
`;
  
  fs.writeFileSync(
    path.join(outputDir, 'START-SERVER.bat'),
    windowsLauncher
  );
  
  // Windows launcher (PowerShell)
  const powershellLauncher = `Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Zero-Code Automation IDE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Starting server..." -ForegroundColor Yellow
Write-Host ""
Set-Location zero-code-automation-ide
if (-not (Test-Path node_modules)) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install
    Write-Host ""
}
Write-Host "Starting server on http://localhost:3000" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Gray
Write-Host ""
npm start
`;
  
  fs.writeFileSync(
    path.join(outputDir, 'START-SERVER.ps1'),
    powershellLauncher
  );
  
  // Linux/Mac launcher
  const unixLauncher = `#!/bin/bash
echo "========================================"
echo "Zero-Code Automation IDE"
echo "========================================"
echo ""
echo "Starting server..."
echo ""
cd zero-code-automation-ide
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    echo ""
fi
echo "Starting server on http://localhost:3000"
echo "Press Ctrl+C to stop the server"
echo ""
npm start
`;
  
  fs.writeFileSync(
    path.join(outputDir, 'START-SERVER.sh'),
    unixLauncher
  );
  
  // Make shell script executable (on Unix systems)
  try {
    fs.chmodSync(path.join(outputDir, 'START-SERVER.sh'), '755');
  } catch (e) {
    // Ignore on Windows
  }
}

function createReadme(outputDir) {
  console.log('📖 Creating README...');
  
  const readme = `# Zero-Code Automation IDE - Portable Package

## 🚀 Quick Start

### Prerequisites
- **Node.js** (v18 or higher) must be installed on the system
- Download from: https://nodejs.org/

### Windows Users
1. Double-click **START-SERVER.bat** (or **START-SERVER.ps1**)
2. Wait for dependencies to install (first time only)
3. Open your browser and go to: **http://localhost:3000**

### Mac/Linux Users
1. Open Terminal
2. Run: \`chmod +x START-SERVER.sh\`
3. Run: \`./START-SERVER.sh\`
4. Open your browser and go to: **http://localhost:3000**

## 📋 First Time Setup

The first time you run the launcher:
- It will automatically install all required dependencies
- This may take 2-5 minutes
- You only need to do this once

## 🛑 Stopping the Server

Press **Ctrl+C** in the terminal/command prompt window

## ❓ Troubleshooting

### Port 3000 is already in use
- Close other applications using port 3000
- Or change the port in \`zero-code-automation-ide/.env\` file

### Node.js not found
- Make sure Node.js is installed
- Check by running: \`node --version\`
- Download from: https://nodejs.org/

### Dependencies installation fails
- Check your internet connection
- Try running manually: \`cd zero-code-automation-ide && npm install\`

## 📞 Support

For issues or questions, contact the person who shared this package with you.

---
**Version:** 1.0.0
**Last Updated:** ${new Date().toLocaleDateString()}
`;
  
  fs.writeFileSync(
    path.join(outputDir, 'README.txt'),
    readme
  );
}

function createZipPackage(outputDir, packageName) {
  console.log('📦 Creating ZIP archive...');
  
  return new Promise((resolve, reject) => {
    const zipPath = path.join(path.dirname(outputDir), `${packageName}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', () => {
      console.log(`✅ ZIP created: ${zipPath} (${archive.pointer()} bytes)`);
      resolve();
    });
    
    archive.on('error', (err) => {
      reject(err);
    });
    
    archive.pipe(output);
    archive.directory(outputDir, packageName);
    archive.finalize();
  });
}

// Run the packaging
createPortablePackage().catch(console.error);

