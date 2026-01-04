# Zero-Code Automation IDE - Operation Guide

## 📋 Step-by-Step Instructions

### Prerequisites
- ✅ Server running on `http://localhost:3000`
- ✅ Node.js installed (v18+)
- ✅ Playwright browsers installed (`npx playwright install`)

---

## 🚀 Starting the Application

### Step 1: Start the Server
```bash
cd zero-code-automation-ide
npm start
```

**Expected Output:**
```
🚀 Zero-Code Automation IDE Server running on port 3000
📊 Health check: http://localhost:3000/api/health
```

### Step 2: Open the Application
1. Open your web browser
2. Navigate to: `http://localhost:3000`
3. You should see the Zero-Code Automation IDE interface

---

## 🎬 Recording a Test Session

### Step 3: Configure Recording Settings
1. **Project Name** (optional): Enter a name like `my-test-project`
2. **Base URL** (optional): Leave blank or enter a starting URL (e.g., `https://example.com`)
3. **Feature Title**: Enter a title (e.g., `Login Flow Test`)
4. **Feature Name**: Enter a name (e.g., `User Authentication`)
5. **Browser Type**: Select from dropdown (Chromium, Firefox, WebKit, Edge)

### Step 4: Start Recording
1. Click the **"🎬 Start Recording"** button
2. Wait for the browser window to open
3. You'll see status: `Recording... A browser window has opened`

**What Happens:**
- A new browser window opens
- Recording script is injected into the page
- All interactions are captured automatically

### Step 5: Interact with the Website
1. **Navigate**: Type a URL in the browser or click links
2. **Click Elements**: Click buttons, links, menus, etc.
3. **Type Text**: Enter text in input fields
4. **Scroll**: Scroll through pages

**All actions are captured automatically!**

---

## ✅ Adding Assertions (Right-Click Menu)

### Step 6: Add Assertions During Recording
1. **Right-click** on any element you want to assert
2. A context menu appears with options:
   - ✓ **Assert Visible** - Verify element is visible
   - 📝 **Assert Text Contains** - Verify text content
   - 🏷️ **Assert Attribute** - Verify HTML attribute
   - 🔢 **Assert Count** - Verify number of elements
   - 📋 **Assert Value** - Verify input value

3. **Click** the assertion type you want
4. The assertion is immediately added to your steps

**Example:**
- Right-click on "Login" button → Select "✓ Assert Visible"
- Right-click on heading text → Select "📝 Assert Text Contains"
- Right-click on username field → Select "📋 Assert Value"

---

## 📊 Monitoring Recording Progress

### Step 7: Watch Real-Time Updates
While recording, you'll see:

1. **Steps List** (left panel):
   - Shows all captured actions with icons
   - Assertions appear with special icons (✓, 📝, 🏷️, 🔢, 📋)
   - Actions are numbered sequentially

2. **Status Bar**:
   - Shows current recording status
   - Displays latest action captured
   - Example: `Recording... (5 steps) | Click Login Button`

3. **Feature File** (middle panel):
   - Updates in real-time with Gherkin syntax
   - Shows normalized step descriptions
   - Clickable steps link to step definitions

4. **Step Definitions** (right panel):
   - Auto-generates TypeScript step definitions
   - Updates as you record
   - Shows implementation code

---

## ⏸️ Pausing and Resuming

### Step 8: Pause Recording (Optional)
1. Click the **"⏸ Pause"** button
2. Status changes to: `Recording paused`
3. Actions during pause are **not** captured

### Step 9: Resume Recording
1. Click the **"▶ Resume"** button
2. Status changes back to: `Recording...`
3. Actions are captured again

---

## ⏹️ Stopping and Saving

### Step 10: Stop Recording
1. Click the **"⏹ Stop Recording"** button
2. A prompt appears asking for:
   - **Project Name** (optional - leave blank for auto-generated)
   - **Feature Title** (optional - defaults to "Recorded Test Flow")
3. Click **OK** or press Enter

**What Happens:**
- Recording stops
- Browser window closes
- All actions are processed
- Project files are generated
- Files are saved to disk

### Step 11: View Results
After stopping, you'll see:
- **Total steps captured**: Number of actions recorded
- **Export path**: Location where files were saved
- **Feature file path**: Location of `.feature` file
- **Status message**: Confirmation of successful export

---

## 📁 Accessing Generated Files

### Step 12: Find Your Project Files
Files are saved in: `sample-export/{project-name}/`

**Project Structure:**
```
sample-export/
  └── my-test-project/
      ├── features/
      │   └── recorded.feature      (Gherkin feature file)
      ├── steps/
      │   └── recorded.steps.ts     (Step definitions)
      ├── support/
      │   └── world.ts              (World configuration)
      ├── tests/
      │   └── recorded.spec.ts      (Playwright test)
      ├── package.json
      ├── playwright.config.ts
      └── cucumber.config.js
```

---

## 🔧 Advanced Features

### Assertion Mode (Automatic Assertions)
1. Toggle **"Assertion Mode: OFF"** button
2. When ON, every click automatically becomes an "Assert Visible"
3. Useful for quick validation of element visibility

### Manual Step Addition
1. Use the **Step Form** at the top
2. Select step type from dropdown
3. Enter selector, value, expected value
4. Click **"➕ Add Step"**

### Export Project
1. Fill in project details
2. Click **"📦 Download ZIP"** button
3. Project is packaged and downloaded

---

## ❓ Troubleshooting

### Recording Not Starting?
- ✅ Check server is running on port 3000
- ✅ Check browser is installed (run `npx playwright install`)
- ✅ Check browser console for errors

### Context Menu Not Appearing?
- ✅ Ensure recording is active (green status)
- ✅ Try right-clicking on different elements
- ✅ Check browser console for JavaScript errors

### Actions Not Being Captured?
- ✅ Check WebSocket connection (should show in status)
- ✅ Verify server logs for errors
- ✅ Try refreshing the page in recording browser

### Files Not Being Generated?
- ✅ Check you have write permissions
- ✅ Verify `sample-export` directory exists
- ✅ Check server logs for file generation errors

---

## 📝 Quick Reference

| Action | Method | Icon |
|--------|--------|------|
| Start Recording | Click "🎬 Start Recording" | - |
| Add Assertion | Right-click element → Select type | ✓📝🏷️🔢📋 |
| Pause Recording | Click "⏸ Pause" | - |
| Resume Recording | Click "▶ Resume" | - |
| Stop Recording | Click "⏹ Stop Recording" | - |
| View Steps | Look at Steps List panel | - |
| View Feature File | Look at Feature File panel | - |
| View Step Definitions | Look at Step Definitions panel | - |

---

## 🎯 Example Workflow

1. **Start**: Click "Start Recording"
2. **Navigate**: Type `https://example.com` in browser
3. **Click**: Click on "Login" link
4. **Assert**: Right-click "Login" heading → "Assert Text Contains"
5. **Type**: Enter username in username field
6. **Assert**: Right-click username field → "Assert Visible"
7. **Type**: Enter password
8. **Click**: Click "Submit" button
9. **Assert**: Right-click success message → "Assert Text Contains"
10. **Stop**: Click "Stop Recording"
11. **Review**: Check generated files in `sample-export/`

---

## ✅ Success Indicators

You'll know it's working when:
- ✅ Browser window opens automatically
- ✅ Status shows "Recording..." with green indicator
- ✅ Steps appear in Steps List as you interact
- ✅ Feature file updates in real-time
- ✅ Right-click shows assertion menu
- ✅ Stop recording shows success message with file paths

---

**Happy Recording! 🎉**

