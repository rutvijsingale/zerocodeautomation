import { BrowserService } from './services/browserService.js';
import { FileService } from './services/fileService.js';
import { validateSessionId, validateProjectName } from './middleware/security.js';
import * as normalizationUtils from './normalization-utils.js';

console.log('🔍 Zero-Code Automation IDE Framework Check\n');
console.log('='.repeat(50));

let passed = 0;
let failed = 0;

function check(name, testFn) {
  try {
    const result = testFn();
    if (result === true || result === undefined) {
      console.log(`✅ ${name}`);
      passed++;
      return true;
    } else {
      console.log(`❌ ${name}: ${result}`);
      failed++;
      return false;
    }
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}`);
    failed++;
    return false;
  }
}

async function checkAsync(name, testFn) {
  try {
    const result = await testFn();
    if (result === true || result === undefined) {
      console.log(`✅ ${name}`);
      passed++;
      return true;
    } else {
      console.log(`❌ ${name}: ${result}`);
      failed++;
      return false;
    }
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}`);
    failed++;
    return false;
  }
}

// 1. Check Services Instantiation
console.log('\n📦 Service Instantiation:');
check('BrowserService can be instantiated', () => {
  const bs = new BrowserService();
  return bs && typeof bs.createSession === 'function';
});

check('FileService can be instantiated', () => {
  const fs = new FileService();
  return fs && typeof fs.writeFile === 'function';
});

// 2. Check Security Middleware
console.log('\n🔒 Security Middleware:');
check('Session ID validation works', () => {
  // Valid UUID v4 format
  const validId = '12345678-1234-1234-1234-123456789abc';
  const result = validateSessionId(validId);
  return result === validId;
});

check('Invalid session ID is rejected', () => {
  try {
    validateSessionId('invalid-id');
    return false; // Should throw
  } catch (e) {
    return true; // Expected to throw
  }
});

check('Project name validation works', () => {
  const result = validateProjectName('test-project');
  return typeof result === 'string' && result.length > 0;
});

check('Invalid project name is rejected', () => {
  try {
    validateProjectName('');
    return false; // Should throw
  } catch (e) {
    return true; // Expected to throw
  }
});

// 3. Check Normalization Utils
console.log('\n🔧 Normalization Utils:');
check('extractPageNameFromUrl works', () => {
  const result = normalizationUtils.extractPageNameFromUrl('https://example.com/login');
  return typeof result === 'string';
});

check('normalizeElementDescription works', () => {
  const action = { selector: '#login-button', kind: 'click', text: 'Login Button' };
  const result = normalizationUtils.normalizeElementDescription(action);
  return typeof result === 'string' && result.length > 0;
});

check('normalizeSelector works', () => {
  const action = { selector: '#login-button', kind: 'click' };
  const result = normalizationUtils.normalizeSelector(action);
  return typeof result === 'string';
});

// 4. Check File Service
console.log('\n📁 File Service:');
check('FileService baseDir is set', () => {
  const fs = new FileService();
  return fs.baseDir && fs.baseDir.length > 0;
});

check('FileService has required methods', () => {
  const fs = new FileService();
  return typeof fs.writeFile === 'function' && 
         typeof fs.readFile === 'function' &&
         typeof fs.ensureDirectory === 'function';
});

// 5. Check Browser Service
console.log('\n🌐 Browser Service:');
check('BrowserService has activeSessions Map', () => {
  const bs = new BrowserService();
  return bs.activeSessions instanceof Map;
});

check('BrowserService has session limit', () => {
  const bs = new BrowserService();
  return typeof bs.maxSessions === 'number' && bs.maxSessions > 0;
});

check('BrowserService can get browser launcher', () => {
  const bs = new BrowserService();
  const launcher = bs.getBrowserLauncher('chromium');
  return launcher !== null && launcher !== undefined;
});

// 6. Check Code Generators
console.log('\n📝 Code Generators:');
(async () => {
  try {
    const playwrightGen = await import('./generators/playwright.js');
    check('Playwright generator exists', () => {
      return playwrightGen && typeof playwrightGen.generatePlaywrightSpec === 'function';
    });
  } catch (e) {
    console.log(`❌ Playwright generator: ${e.message}`);
    failed++;
  }

  try {
    const gherkinGen = await import('./generators/gherkin.js');
    check('Gherkin generator exists', () => {
      return gherkinGen && typeof gherkinGen.generateFeatureFile === 'function';
    });
  } catch (e) {
    console.log(`❌ Gherkin generator: ${e.message}`);
    failed++;
  }

  try {
    const stepsGen = await import('./generators/steps_ts_template.js');
    check('Steps generator exists', () => {
      return stepsGen && typeof stepsGen.generateStepDefinitions === 'function';
    });
  } catch (e) {
    console.log(`❌ Steps generator: ${e.message}`);
    failed++;
  }

  // 7. Check API Endpoints (if server is running)
  console.log('\n🌍 API Endpoints:');
  await checkAsync('Health endpoint is accessible', async () => {
    const response = await fetch('http://localhost:3000/api/health');
    if (!response.ok) return 'Health endpoint returned non-OK status';
    const data = await response.json();
    if (data.status !== 'healthy') return 'Health endpoint returned invalid status';
    return true;
  });

  await checkAsync('Config endpoint is accessible', async () => {
    const response = await fetch('http://localhost:3000/api/config');
    if (!response.ok) return 'Config endpoint returned non-OK status';
    const data = await response.json();
    if (!data.appName || data.baseUrl === undefined) return 'Config endpoint returned invalid data';
    return true;
  });

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📈 Total:  ${passed + failed}`);

  if (failed === 0) {
    console.log('\n🎉 All framework checks passed!');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some checks failed. Please review the errors above.');
    process.exit(1);
  }
})();
