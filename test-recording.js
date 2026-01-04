import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testRecording() {
  console.log('🧪 Testing Recording Functionality...\n');
  
  try {
    // Test 1: Start recording
    console.log('1. Testing recording start...');
    const startResp = await fetch('http://localhost:3000/api/recording/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'https://example.com', browserType: 'chromium' })
    });
    
    if (!startResp.ok) {
      const error = await startResp.json();
      console.error('❌ Failed to start recording:', error);
      return;
    }
    
    const { sessionId } = await startResp.json();
    console.log('✅ Recording started. Session ID:', sessionId);
    
    // Wait a bit for browser to open
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test 2: Simulate actions
    console.log('\n2. Simulating actions...');
    const testActions = [
      { kind: 'navigate', url: 'https://example.com', timestamp: Date.now() },
      { kind: 'click', selector: 'a[href*="example"]', timestamp: Date.now() + 100 },
      { kind: 'type', selector: '#search', value: 'test query', timestamp: Date.now() + 200 },
      { kind: 'assertText', selector: 'h1', expectedValue: 'Example Domain', timestamp: Date.now() + 300 },
      { kind: 'assertVisible', selector: 'nav', timestamp: Date.now() + 400 },
    ];
    
    for (const action of testActions) {
      const actionResp = await fetch('http://localhost:3000/api/recording/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, ...action })
      });
      
      if (actionResp.ok) {
        console.log(`   ✅ ${action.kind} action recorded`);
      } else {
        console.log(`   ⚠️  ${action.kind} action failed`);
      }
    }
    
    // Test 3: Stop recording and get actions
    console.log('\n3. Stopping recording...');
    const stopResp = await fetch('http://localhost:3000/api/recording/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId })
    });
    
    if (!stopResp.ok) {
      console.error('❌ Failed to stop recording');
      return;
    }
    
    const { actions } = await stopResp.json();
    console.log(`✅ Recording stopped. Captured ${actions.length} actions`);
    
    // Test 4: Generate code
    console.log('\n4. Testing code generation...');
    const exportResp = await fetch('http://localhost:3000/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectName: 'test-project',
        baseUrl: 'https://example.com',
        featureTitle: 'Test Flow',
        featureName: 'Test Feature',
        tags: ['@smoke', '@test'],
        steps: [
          { kind: 'navigate', url: 'https://example.com' },
          { kind: 'click', selector: 'a' },
          { kind: 'type', selector: 'input', value: 'test' },
          { kind: 'assertText', selector: 'h1', expectedValue: 'Example', assertionType: 'contains' },
          { kind: 'assertVisible', selector: 'nav' },
          { kind: 'assertAttribute', selector: 'input', value: 'type', expectedValue: 'text', assertionType: 'equals' },
          { kind: 'assertCount', selector: 'div', expectedValue: '5' },
        ]
      })
    });
    
    if (!exportResp.ok) {
      console.error('❌ Failed to generate code');
      return;
    }
    
    console.log('✅ Code generation successful');
    
    // Test 5: Verify generated files
    console.log('\n5. Verifying generated files...');
    const exportDir = path.join(__dirname, 'sample-export', 'test-project');
    
    const filesToCheck = [
      'package.json',
      'playwright.config.ts',
      'tests/recorded.spec.ts',
      'features/recorded.feature',
      'steps/recorded.steps.ts',
      'support/world.ts',
      'cucumber.config.js'
    ];
    
    let allFilesExist = true;
    for (const file of filesToCheck) {
      const filePath = path.join(exportDir, file);
      if (fs.existsSync(filePath)) {
        console.log(`   ✅ ${file}`);
        
        // Check content
        const content = fs.readFileSync(filePath, 'utf8');
        if (file.includes('feature') && !content.includes('Assert')) {
          console.log(`   ⚠️  Feature file missing assertions`);
        }
        if (file.includes('steps.ts') && !content.includes('assertVisible')) {
          console.log(`   ⚠️  Step definitions missing assertion types`);
        }
      } else {
        console.log(`   ❌ ${file} - NOT FOUND`);
        allFilesExist = false;
      }
    }
    
    if (allFilesExist) {
      console.log('\n✅ All files generated successfully!');
      
      // Show feature file content
      const featureFile = path.join(exportDir, 'features/recorded.feature');
      if (fs.existsSync(featureFile)) {
        console.log('\n📄 Feature File Content:');
        console.log('─'.repeat(50));
        console.log(fs.readFileSync(featureFile, 'utf8'));
        console.log('─'.repeat(50));
      }
    } else {
      console.log('\n❌ Some files are missing');
    }
    
    console.log('\n✅ Test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

testRecording();

