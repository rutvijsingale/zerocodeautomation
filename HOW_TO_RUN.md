# How to Run the Zero-Code Automation IDE

## Quick Start Guide

### Step 1: Navigate to the Project Directory
Open PowerShell or Command Prompt and navigate to the project folder:

```powershell
cd E:\eclispe_workspace_playwrite\zero-code-automation-ide\zero-code-automation-ide\zero-code-automation-ide
```

### Step 2: Install Dependencies (First Time Only)
If you haven't installed dependencies yet, run:

```powershell
npm install
```

This will install all required packages (Express, Playwright, etc.)

### Step 3: Start the Server
Run one of these commands:

**Option 1: Using npm (Recommended)**
```powershell
npm start
```

**Option 2: Using node directly**
```powershell
node server.js
```

### Step 4: Access the Application
Once the server starts, open your web browser and go to:

```
http://localhost:3000
```

You should see the Zero-Code Automation IDE interface.

---

## Troubleshooting

### Issue: "Cannot find module" or "MODULE_NOT_FOUND"
**Solution:** Make sure you're in the correct directory:
- The correct path is: `E:\eclispe_workspace_playwrite\zero-code-automation-ide\zero-code-automation-ide\zero-code-automation-ide`
- Check that `server.js` and `package.json` exist in this directory

### Issue: "Port 3000 already in use"
**Solution:** Stop any existing Node.js processes:
```powershell
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
```
Then try starting the server again.

### Issue: "npm: command not found"
**Solution:** Install Node.js from https://nodejs.org/ (version 18 or higher)

### Issue: Dependencies not installed
**Solution:** Run `npm install` in the project directory

---

## What the Server Does

- Starts a web server on port 3000
- Provides a web-based IDE interface
- Allows you to record browser interactions
- Generates test automation code (Playwright, Selenium, Cucumber)
- Exports test projects as ZIP files

---

## Development Mode (Auto-reload)

If you want the server to automatically restart when you make code changes:

```powershell
npm run dev
```

---

## Stopping the Server

Press `Ctrl + C` in the terminal where the server is running.

Or stop all Node.js processes:
```powershell
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
```

---

## 📚 Additional Guides

- **How to Run Exported Test Projects**: See `HOW_TO_RUN_EXPORTED_TESTS.md` for detailed instructions on running the test projects you export after recording.

