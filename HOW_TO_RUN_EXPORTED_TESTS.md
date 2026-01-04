# How to Run Exported Test Projects

After recording and exporting your test project, follow these steps to run the generated tests.

---

## 📦 Step 1: Extract the Exported ZIP File

1. Download the ZIP file from the IDE (click "📦 Download ZIP" button)
2. Extract the ZIP file to a folder of your choice
3. Open a terminal/command prompt in the extracted project folder

---

## 🔍 Step 2: Identify Your Project Type

The exported project can be one of these types:

### **Java Projects:**
- **Playwright Java** (`playwright-java`)
- **Selenium Java** (`selenium-java`)

### **TypeScript Projects:**
- **Playwright TypeScript** (`playwright-ts`)

**How to identify:**
- **Java projects** have a `pom.xml` file in the root directory
- **TypeScript projects** have a `package.json` file in the root directory

---

## ☕ Running Java Projects (Playwright Java / Selenium Java)

### Prerequisites:
- ✅ **Java JDK 11 or higher** installed
- ✅ **Maven 3.6+** installed
- ✅ **Playwright browsers** installed (for Playwright Java only)

### Step 1: Install Playwright Browsers (Playwright Java only)
```bash
mvn exec:java -e -Dexec.mainClass=com.microsoft.playwright.CLI -Dexec.args="install"
```

Or manually:
```bash
npx playwright install
```

### Step 2: Install Dependencies
```bash
mvn clean install
```

### Step 3: Run Tests

**Option A: Run all tests**
```bash
mvn test
```

**Option B: Run specific feature file**
```bash
mvn test -Dcucumber.filter.tags="@Regression"
```

**Option C: Run with specific browser**
Edit `src/test/resources/cucumber.properties` and set:
```properties
cucumber.filter.tags=@Regression
```

Then run:
```bash
mvn test
```

**Option D: Run in headless mode**
Edit the `World.java` file in `src/test/java/support/` and change:
```java
.setHeadless(true);  // Change from false to true
```

Then run:
```bash
mvn test
```

### Step 4: View Test Results
- Test results appear in the terminal
- For detailed reports, check: `target/surefire-reports/`

---

## 📘 Running TypeScript Projects (Playwright TypeScript)

### Prerequisites:
- ✅ **Node.js 18+** installed
- ✅ **npm** or **yarn** installed

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Install Playwright Browsers
```bash
npx playwright install
```

### Step 3: Run Tests

**Option A: Run all tests**
```bash
npm test
```

Or:
```bash
npx playwright test
```

**Option B: Run with Cucumber (BDD)**
```bash
npx cucumber-js
```

**Option C: Run specific feature**
```bash
npx cucumber-js features/recorded.feature
```

**Option D: Run with tags**
```bash
npx cucumber-js --tags "@Regression"
```

**Option E: Run in headed mode (see browser)**
```bash
npx playwright test --headed
```

**Option F: Run in debug mode**
```bash
npx playwright test --debug
```

### Step 4: View Test Results
- Test results appear in the terminal
- HTML report: `npx playwright show-report`
- Screenshots on failure: `test-results/`

---

## 🎯 Quick Reference Commands

### Java Projects (Maven)

| Command | Description |
|---------|-------------|
| `mvn clean install` | Install dependencies |
| `mvn test` | Run all tests |
| `mvn test -Dcucumber.filter.tags="@Regression"` | Run tests with specific tag |
| `mvn clean` | Clean build artifacts |

### TypeScript Projects (npm)

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies |
| `npm test` | Run all tests |
| `npx playwright test` | Run Playwright tests |
| `npx cucumber-js` | Run Cucumber BDD tests |
| `npx playwright show-report` | View HTML test report |

---

## 🔧 Troubleshooting

### Issue: "Maven command not found"
**Solution:** Install Maven from https://maven.apache.org/download.cgi

### Issue: "Java not found"
**Solution:** Install JDK 11+ from https://adoptium.net/

### Issue: "Playwright browsers not installed"
**Solution:** Run `npx playwright install` or `mvn exec:java -e -Dexec.mainClass=com.microsoft.playwright.CLI -Dexec.args="install"`

### Issue: "npm command not found"
**Solution:** Install Node.js from https://nodejs.org/ (version 18+)

### Issue: Tests fail with "Element not found"
**Solution:** 
- Check if the website URL is correct in the feature file
- Verify selectors are still valid (website may have changed)
- Run tests in headed mode to see what's happening: `npx playwright test --headed`

### Issue: "Port already in use"
**Solution:** Close other browser instances or change the port in configuration

---

## 📁 Project Structure Reference

### Java Project Structure:
```
your-project/
├── pom.xml                          # Maven configuration
├── src/
│   ├── main/java/
│   └── test/
│       ├── java/
│       │   ├── steps/
│       │   │   └── RecordedTestSteps.java
│       │   └── support/
│       │       └── PlaywrightWorld.java (or SeleniumWorld.java)
│       └── resources/
│           ├── features/
│           │   └── recorded.feature
│           └── cucumber.properties
```

### TypeScript Project Structure:
```
your-project/
├── package.json                     # npm configuration
├── playwright.config.ts            # Playwright config
├── cucumber.config.js              # Cucumber config
├── features/
│   └── recorded.feature            # Gherkin feature file
├── steps/
│   └── recorded.steps.ts           # Step definitions
├── support/
│   └── world.ts                    # World configuration
└── tests/
    └── recorded.spec.ts            # Playwright test spec
```

---

## 💡 Tips

1. **First Run:** Always run `mvn clean install` or `npm install` first to ensure all dependencies are installed

2. **Debug Mode:** Use headed mode to see what the browser is doing:
   - Java: Edit `World.java` and set `setHeadless(false)`
   - TypeScript: Use `--headed` flag

3. **Tags:** Use Cucumber tags to organize and run specific test scenarios:
   ```gherkin
   @Regression
   Scenario: Test login
   ```

4. **Reports:** 
   - Java: Check `target/surefire-reports/` for test results
   - TypeScript: Use `npx playwright show-report` for HTML reports

5. **CI/CD:** These projects can be integrated into CI/CD pipelines (Jenkins, GitHub Actions, etc.)

---

## 🚀 Next Steps

After successfully running your tests:
1. Review test results and fix any failures
2. Integrate into your CI/CD pipeline
3. Add more test scenarios by recording again
4. Customize step definitions as needed

---

**Need Help?** Check the main README.md or create an issue in the repository.

