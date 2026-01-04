# Framework Updates - November 2024

## Summary of Changes

This document outlines the recent updates made to the Zero-Code Automation IDE framework to fix Maven project generation and Java code compilation issues.

---

## 🔧 Update 1: Maven ArtifactId Sanitization

### Problem
When exporting Java projects with project names containing spaces (e.g., "MY RECORDING"), Maven would fail with:
```
'artifactId' with value 'MY RECORDING' does not match a valid id pattern.
```

Maven `artifactId` must:
- Be lowercase
- Not contain spaces
- Only contain alphanumeric characters, hyphens, and underscores
- Not start with a number

### Solution
**File:** `java-code-generators.js`

**Added Function:** `sanitizeMavenArtifactId(projectName)`

This function:
1. Converts project names to lowercase
2. Replaces spaces and invalid characters with hyphens
3. Removes consecutive hyphens
4. Removes leading/trailing hyphens/underscores
5. Prefixes with 'project-' if name starts with a number
6. Ensures minimum length and maximum length (200 chars)

**Example:**
- Input: `"MY RECORDING"` → Output: `"my-recording"`
- Input: `"Test Project 123"` → Output: `"test-project-123"`
- Input: `"123Project"` → Output: `"project-123project"`

**Code Location:**
```javascript
// Line 789-824 in java-code-generators.js
function sanitizeMavenArtifactId(projectName) {
  // ... sanitization logic
}
```

**Usage:**
```javascript
// Line 827-828 in generateMavenPom()
const mavenArtifactId = sanitizeMavenArtifactId(projectName);
<artifactId>${mavenArtifactId}</artifactId>
```

---

## 🔧 Update 2: Removed Problematic Playwright Maven Plugin

### Problem
The generated `pom.xml` included:
```xml
<plugin>
    <groupId>com.microsoft.playwright</groupId>
    <artifactId>playwright-maven-plugin</artifactId>
    <version>0.200.0</version>
    ...
</plugin>
```

This plugin version doesn't exist in Maven Central, causing build failures:
```
Plugin com.microsoft.playwright:playwright-maven-plugin:0.200.0 or one of its dependencies could not be resolved
```

### Solution
**File:** `java-code-generators.js`

**Removed:** The entire `playwright-maven-plugin` configuration from `pom.xml` generation.

**Replaced with:** A comment instructing users to install browsers manually:
```xml
<!-- Note: Install Playwright browsers manually using: npx playwright install -->
```

**Why this works:**
- The Playwright Java dependency itself is sufficient for running tests
- Browsers can be installed using `npx playwright install` (which works with the Playwright dependency)
- This avoids dependency resolution issues

**Code Location:**
- Line 899 in `java-code-generators.js` (Playwright Java framework)
- Similar change for Selenium Java framework (if applicable)

---

## 🔧 Update 3: Fixed Java Code Generation Issues

### Problem 1: Missing Class Declaration
**File:** `RecordedTestFlowSteps.java`

Generated step definitions were missing the class wrapper:
```java
package steps;
// ... imports ...

    @Given("I navigate to {string}")  // ❌ Methods outside class
    public void iNavigateToUrl(String url) {
        ...
    }
```

### Solution
Added proper class declaration:
```java
package steps;
// ... imports ...

public class RecordedTestFlowSteps {  // ✅ Added class wrapper

    @Given("I navigate to {string}")
    public void iNavigateToUrl(String url) {
        ...
    }
}
```

---

### Problem 2: Emoji Characters in Java Strings
**File:** `PlaywrightTest.java`

Generated code contained emojis in multi-line strings:
```java
org.junit.jupiter.api.Assertions.assertTrue(
    page.locator("#browserType").textContent().contains("🌐 Chrome
        🦊 Firefox
        🧭 WebKit (Safari)
        🔷 Microsoft Edge"));  // ❌ Unclosed string, illegal characters
```

### Solution
Replaced with emoji-safe assertion:
```java
String browserOptions = page.locator("#browserType").textContent();
org.junit.jupiter.api.Assertions.assertTrue(browserOptions != null && 
    (browserOptions.contains("Chrome") || browserOptions.contains("Firefox") || 
     browserOptions.contains("WebKit") || browserOptions.contains("Edge")));  // ✅ Safe
```

**Note:** This is a temporary fix for the existing exported project. The code generator should be updated to handle emojis properly in future exports.

---

## 📋 Files Modified

1. **`java-code-generators.js`**
   - Added `sanitizeMavenArtifactId()` function (lines 789-824)
   - Updated `generateMavenPom()` to use sanitized artifactId (line 828)
   - Removed `playwright-maven-plugin` from generated pom.xml (line 899)

2. **`sample-export/MY RECORDING/pom.xml`** (example fix)
   - Changed `<artifactId>MY RECORDING</artifactId>` to `<artifactId>my-recording</artifactId>`
   - Removed problematic plugin

3. **`sample-export/MY RECORDING/src/test/java/steps/RecordedTestFlowSteps.java`** (example fix)
   - Added class declaration wrapper

4. **`sample-export/MY RECORDING/src/test/java/tests/PlaywrightTest.java`** (example fix)
   - Fixed emoji string issue

---

## ✅ Impact

### Before Updates:
- ❌ Projects with spaces in names failed Maven build
- ❌ Playwright plugin dependency resolution failed
- ❌ Generated Java code had compilation errors

### After Updates:
- ✅ Project names are automatically sanitized for Maven
- ✅ No problematic plugin dependencies
- ✅ Generated Java code compiles successfully (after manual fixes to existing exports)

---

## 🚀 Future Improvements Needed

1. **Code Generator Fixes:**
   - Update Java code generator to always include class declarations
   - Handle emojis and special characters in generated assertions
   - Ensure all generated Java files are syntactically correct

2. **Playwright Browser Installation:**
   - Consider adding a Maven exec plugin to run `npx playwright install` automatically
   - Or document the manual installation step more prominently

3. **Testing:**
   - Add automated tests for project name sanitization
   - Test with various project name formats (spaces, special chars, numbers, etc.)

---

## 📝 Usage Notes

### For New Exports:
All new exports will automatically:
- Have sanitized Maven artifactIds
- Not include the problematic plugin
- Generate valid Java code (once code generator is fully updated)

### For Existing Exports:
If you have existing exported projects with issues:
1. **Maven artifactId:** Manually edit `pom.xml` and change the `<artifactId>` to lowercase with hyphens
2. **Missing class:** Add `public class YourClassName { }` wrapper around step definitions
3. **Emoji issues:** Replace emoji-containing strings with simpler assertions

---

## 🔗 Related Documentation

- `HOW_TO_RUN_EXPORTED_TESTS.md` - Instructions for running exported projects
- `HOW_TO_RUN.md` - Instructions for running the IDE server

---

**Last Updated:** November 11, 2024

