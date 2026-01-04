$body = @{
    projectName = "test-feature-gen"
    baseUrl = "https://example.com"
    featureTitle = "Login Test"
    featureName = "User Authentication"
    tags = @("@smoke", "@test")
    steps = @(
        @{ kind = "navigate"; url = "https://example.com" },
        @{ kind = "click"; selector = "button#login" },
        @{ kind = "type"; selector = "#username"; value = "testuser" },
        @{ kind = "type"; selector = "#password"; value = "password123" },
        @{ kind = "click"; selector = "button[type=submit]" },
        @{ kind = "assertText"; selector = ".welcome"; expectedValue = "Welcome"; assertionType = "contains" },
        @{ kind = "assertVisible"; selector = ".dashboard" },
        @{ kind = "assertAttribute"; selector = "#user-menu"; value = "data-user"; expectedValue = "testuser"; assertionType = "equals" },
        @{ kind = "assertCount"; selector = ".notification"; expectedValue = "3" },
        @{ kind = "screenshot"; filename = "login-success.png" }
    )
} | ConvertTo-Json -Depth 10

Write-Host "🧪 Testing Code Generation..." -ForegroundColor Cyan
Write-Host "`n1. Testing feature file generation..." -ForegroundColor Yellow

try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000/api/export" `
        -Method POST `
        -ContentType "application/json" `
        -Body $body
    
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Code generation successful!" -ForegroundColor Green
        
        # Check if zip file was created
        $zipPath = "sample-export/test-feature-gen.zip"
        if (Test-Path $zipPath) {
            Write-Host "✅ Export ZIP created at: $zipPath" -ForegroundColor Green
        }
        
        # Check generated files
        Write-Host "`n2. Verifying generated files..." -ForegroundColor Yellow
        $projectPath = "sample-export/test-feature-gen"
        
        $filesToCheck = @(
            "package.json",
            "playwright.config.ts",
            "tests/recorded.spec.ts",
            "features/recorded.feature",
            "steps/recorded.steps.ts",
            "support/world.ts",
            "cucumber.config.js"
        )
        
        $allExist = $true
        foreach ($file in $filesToCheck) {
            $filePath = Join-Path $projectPath $file
            if (Test-Path $filePath) {
                Write-Host "   ✅ $file" -ForegroundColor Green
                
                # Check content quality
                $content = Get-Content $filePath -Raw
                if ($file -like "*feature*") {
                    if ($content -match "Assert|assert") {
                        Write-Host "      ✓ Contains assertions" -ForegroundColor DarkGreen
                    } else {
                        Write-Host "      ⚠ Missing assertions" -ForegroundColor Yellow
                    }
                    if ($content -match "Given|When|Then|And|But") {
                        Write-Host "      ✓ Contains Gherkin keywords" -ForegroundColor DarkGreen
                    }
                }
                if ($file -like "*steps.ts*") {
                    if ($content -match "assertVisible|assertText|assertAttribute|assertCount") {
                        Write-Host "      ✓ Contains assertion step definitions" -ForegroundColor DarkGreen
                    }
                }
            } else {
                Write-Host "   ❌ $file - NOT FOUND" -ForegroundColor Red
                $allExist = $false
            }
        }
        
        if ($allExist) {
            Write-Host "`n✅ All files generated successfully!" -ForegroundColor Green
            
            # Show feature file preview
            Write-Host "`n📄 Feature File Preview:" -ForegroundColor Cyan
            Write-Host ("=" * 60) -ForegroundColor DarkGray
            $featurePath = Join-Path $projectPath "features/recorded.feature"
            if (Test-Path $featurePath) {
                $featureContent = Get-Content $featurePath -Raw
                Write-Host $featureContent -ForegroundColor White
            }
            Write-Host ("=" * 60) -ForegroundColor DarkGray
            
        } else {
            Write-Host "`n❌ Some files are missing" -ForegroundColor Red
        }
    } else {
        Write-Host "❌ Unexpected status code: $($response.StatusCode)" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Test failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response: $responseBody" -ForegroundColor Yellow
    }
}

