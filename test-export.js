// Simple test for code generation
const testSteps = [
  { kind: 'navigate', url: 'https://example.com' },
  { kind: 'click', selector: 'button#login' },
  { kind: 'type', selector: '#username', value: 'testuser' },
  { kind: 'type', selector: '#password', value: 'password123' },
  { kind: 'click', selector: 'button[type=submit]' },
  { kind: 'assertText', selector: '.welcome', expectedValue: 'Welcome', assertionType: 'contains' },
  { kind: 'assertVisible', selector: '.dashboard' },
  { kind: 'assertAttribute', selector: '#user-menu', value: 'data-user', expectedValue: 'testuser', assertionType: 'equals' },
  { kind: 'assertCount', selector: '.notification', expectedValue: '3' },
  { kind: 'screenshot', filename: 'login-success.png' }
];

async function testExport() {
  console.log('Testing code generation...\n');
  
  try {
    const response = await fetch('http://localhost:3000/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectName: 'test-export',
        baseUrl: 'https://example.com',
        featureTitle: 'Login Test',
        featureName: 'User Authentication',
        tags: ['@smoke', '@test'],
        steps: testSteps
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error('Error:', error);
      return;
    }
    
    console.log('✅ Code generation successful!\n');
    
    // Check generated files
    const fs = await import('fs');
    const path = await import('path');
    const projectPath = path.join(process.cwd(), 'sample-export', 'test-export');
    
    const files = [
      'package.json',
      'playwright.config.ts',
      'tests/recorded.spec.ts',
      'features/recorded.feature',
      'steps/recorded.steps.ts',
      'support/world.ts',
      'cucumber.config.js'
    ];
    
    console.log('Verifying generated files:');
    let allExist = true;
    
    for (const file of files) {
      const filePath = path.join(projectPath, file);
      if (fs.existsSync(filePath)) {
        console.log(`  ✓ ${file}`);
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Check feature file
        if (file.includes('feature')) {
          if (content.includes('Assert') || content.includes('assert')) {
            console.log('    ✓ Contains assertions');
          }
          if (content.includes('Given') || content.includes('When') || content.includes('Then')) {
            console.log('    ✓ Contains Gherkin keywords');
          }
        }
        
        // Check step definitions
        if (file.includes('steps.ts')) {
          if (content.includes('assertVisible') || content.includes('assertText') || 
              content.includes('assertAttribute') || content.includes('assertCount')) {
            console.log('    ✓ Contains assertion step definitions');
          }
        }
      } else {
        console.log(`  ✗ ${file} - NOT FOUND`);
        allExist = false;
      }
    }
    
    if (allExist) {
      console.log('\n✅ All files generated successfully!\n');
      
      // Show feature file
      const featurePath = path.join(projectPath, 'features/recorded.feature');
      if (fs.existsSync(featurePath)) {
        console.log('Feature File Content:');
        console.log('='.repeat(60));
        console.log(fs.readFileSync(featurePath, 'utf8'));
        console.log('='.repeat(60));
      }
    } else {
      console.log('\n✗ Some files are missing');
    }
    
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

testExport();

