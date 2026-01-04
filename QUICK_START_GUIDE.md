# 🚀 Quick Start Guide - Zero-Code Automation IDE

## 5-Minute Quick Start

### Step 1: Start the Server
```bash
cd zero-code-automation-ide/zero-code-automation-ide
npm start
```

### Step 2: Open Browser
Navigate to: `http://localhost:3000`

### Step 3: Configure Basic Settings
- **Project Name**: `my-test-project`
- **Base URL**: `http://localhost:3000` (or your app URL)
- **Feature Title**: `Login Test`
- **Feature Name**: `Authentication`
- **Tags**: `@Smoke` (optional)

### Step 4: Start Recording
1. Click **"🎬 Start Recording"**
2. Browser window opens automatically
3. Interact with the browser (click, type, navigate)
4. Watch steps appear in real-time

### Step 5: Stop & Review
1. Click **"⏹ Stop Recording"**
2. Review generated code in right panel:
   - 📜 Playwright TypeScript
   - 🥒 Gherkin Feature
   - 🔧 Step Definitions

### Step 6: Export
1. Click **"🚀 Generate & Download Project"**
2. ZIP file downloads
3. Extract and use in your IDE

---

## 🎯 Common Use Cases

### Use Case 1: Simple Login Test

**Steps**:
1. Set Project Name: `login-test`
2. Set Base URL: `http://localhost:3000`
3. Start Recording
4. Navigate to login page
5. Type username
6. Type password
7. Click login button
8. Stop Recording
9. Download Project

**Result**: Complete test project with feature file and step definitions

---

### Use Case 2: Data-Driven Testing (Scenario Outline)

**Steps**:
1. Configure basic settings
2. Check **"Use Scenario Outline"**
3. Enter Examples:
   ```json
   [
     {"username": "admin", "password": "admin123"},
     {"username": "user", "password": "user123"}
   ]
   ```
4. Start Recording
5. Record login flow (use placeholders will be created)
6. Stop Recording
7. Download Project

**Result**: Scenario Outline with Examples table

---

### Use Case 3: Multiple Scenarios

**Steps**:
1. Configure basic settings
2. Start Recording
3. Record Scenario 1 steps
4. Check **"Create new scenario"**
5. Record Scenario 2 steps
6. Stop Recording
7. Download Project

**Result**: Feature file with multiple scenarios

---

### Use Case 4: Background Steps

**Steps**:
1. Configure basic settings
2. Check **"Mark next steps as Background"**
3. Start Recording
4. Record login steps (these become background)
5. Uncheck Background
6. Record scenario-specific steps
7. Stop Recording
8. Download Project

**Result**: Feature file with Background section

---

## 📋 UI Controls Cheat Sheet

| What You Want | Where to Click | What to Enter |
|---------------|----------------|---------------|
| Record browser actions | 🎬 Start Recording | - |
| Stop recording | ⏹ Stop Recording | - |
| Pause recording | ⏸ Pause | - |
| Copy Gherkin Feature | 📋 Copy (next to Gherkin) | - |
| Copy Step Definitions | 📋 Copy (next to Step Definitions) | - |
| Download project | 🚀 Generate & Download | - |
| Add manual step | ➕ Add Step | Selector, Value |
| Clear all steps | 🗑️ Clear All Steps | - |
| Enable Scenario Outline | ☑ Use Scenario Outline | JSON Examples |
| Mark as Background | ☑ Mark next steps as Background | - |
| Create new scenario | ☑ Create new scenario | - |

---

## 🎨 Visual Guide

### Left Panel (Step Builder)
```
┌─────────────────────────────────┐
│ Framework Selection              │
│ Browser Selection                │
│ Project Name: [________]         │
│ Base URL: [________]             │
│ Feature Title: [________]        │
│ Feature Name: [________]         │
│ Tags: [________]                 │
│                                  │
│ 🥒 Advanced Cucumber Features    │
│ ☐ Use Scenario Outline          │
│ ☐ Mark as Background            │
│ ☐ Create new scenario           │
│                                  │
│ Step Kind: [Dropdown]           │
│ Selector: [________]             │
│ Value: [________]                │
│ [➕ Add Step]                    │
│                                  │
│ 📋 Recorded Steps (X)           │
│ 1. Navigate to...               │
│ 2. Click...                      │
│                                  │
│ [🎬 Start Recording]             │
│ [⏹ Stop Recording]              │
└─────────────────────────────────┘
```

### Right Panel (Generated Code)
```
┌─────────────────────────────────┐
│ 📜 Playwright TypeScript        │
│ ┌─────────────────────────────┐ │
│ │ await page.goto(...)        │ │
│ │ await page.click(...)       │ │
│ └─────────────────────────────┘ │
│                                  │
│ 🥒 Gherkin Feature [📋 Copy]    │
│ ┌─────────────────────────────┐ │
│ │ Feature: ...                │ │
│ │   Scenario: ...             │ │
│ │     Given I navigate...     │ │
│ └─────────────────────────────┘ │
│                                  │
│ 🔧 Step Definitions [📋 Copy]   │
│ ┌─────────────────────────────┐ │
│ │ Given('I navigate...', ...) │ │
│ │ When('I click...', ...)     │ │
│ └─────────────────────────────┘ │
│                                  │
│ [🚀 Generate & Download]        │
└─────────────────────────────────┘
```

---

## ⚡ Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Focus selector field | Click in selector input |
| Focus value field | Click in value input |
| Add step | Click "➕ Add Step" button |
| Start recording | Click "🎬 Start Recording" |
| Stop recording | Click "⏹ Stop Recording" |

---

## 🔍 What Gets Recorded?

### ✅ Recorded Automatically
- Page navigation (`navigate`)
- Element clicks (`click`)
- Text input (`type`) - debounced to final value
- Dropdown selections (`select`)
- Browser close (`close`)
- Assertions (if using assertion tools)

### ❌ Not Recorded
- Mouse movements (without clicks)
- Keyboard shortcuts (unless they trigger actions)
- Browser dev tools interactions
- Internal browser events

---

## 💡 Pro Tips

1. **Use Descriptive Names**: 
   - Project Name: `login-regression-test`
   - Feature Title: `User Login with Valid Credentials`

2. **Leverage Tags**:
   - `@Smoke` for quick tests
   - `@Regression` for full suite
   - `@Critical` for important flows

3. **Scenario Outline for Data**:
   - Use when testing same flow with different data
   - Auto-detects when same selector has multiple values

4. **Background for Common Setup**:
   - Login steps
   - Navigation steps
   - Common initialization

5. **Copy Before Export**:
   - Copy Gherkin Feature for quick review
   - Copy Step Definitions for customization
   - Then export full project

---

## 🎓 Learning Path

### Beginner
1. ✅ Start with simple recording
2. ✅ Review generated code
3. ✅ Export and run in IDE

### Intermediate
1. ✅ Use tags for organization
2. ✅ Add manual steps
3. ✅ Edit step definitions

### Advanced
1. ✅ Use Scenario Outline
2. ✅ Create Background steps
3. ✅ Multiple scenarios in one feature
4. ✅ Customize generated code

---

## 📞 Need Help?

1. **Check Server Logs**: Terminal output shows errors
2. **Browser Console**: Press F12, check Console tab
3. **Review User Manual**: See `USER_MANUAL.md` for details
4. **Verify Setup**: Ensure Node.js and dependencies installed

---

**Happy Testing! 🚀**

