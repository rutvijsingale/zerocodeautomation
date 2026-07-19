/**
 * generators/frameworks/java/pom.js
 * Generates Maven pom.xml for Playwright-Java and Selenium-Java projects.
 */

import { VERSIONS } from './constants.js';

// Helper function to sanitize project name for Maven artifactId
// Maven artifactId must be lowercase, no spaces, and follow specific naming rules
function sanitizeMavenArtifactId(projectName) {
  if (!projectName || typeof projectName !== 'string') {
    return 'automation-project';
  }
  
  // Convert to lowercase
  let sanitized = projectName.toLowerCase();
  
  // Replace spaces and invalid characters with hyphens
  sanitized = sanitized.replace(/[^a-z0-9\-_]/g, '-');
  
  // Remove consecutive hyphens
  sanitized = sanitized.replace(/-+/g, '-');
  
  // Remove leading/trailing hyphens and underscores
  sanitized = sanitized.replace(/^[-_]+|[-_]+$/g, '');
  
  // If it starts with a number, prefix with 'project-'
  if (/^\d/.test(sanitized)) {
    sanitized = 'project-' + sanitized;
  }
  
  // If empty after sanitization, use default
  if (!sanitized || sanitized.length === 0) {
    sanitized = 'automation-project';
  }
  
  // Ensure it's not too long (Maven has limits)
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 200).replace(/-+$/, '');
  }
  
  return sanitized;
}

function generateMavenPom(framework, projectName, baseUrl) {
  // Sanitize project name for Maven artifactId
  const mavenArtifactId = sanitizeMavenArtifactId(projectName);
  
  if (framework === 'playwright-java') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    
    <groupId>com.automation</groupId>
    <artifactId>${mavenArtifactId}</artifactId>
    <version>1.0-SNAPSHOT</version>
    <packaging>jar</packaging>
    
    <name>${projectName}</name>
    <description>Automated tests with Playwright and Cucumber</description>
    
    <properties>
        <maven.compiler.source>11</maven.compiler.source>
        <maven.compiler.target>11</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <playwright.version>${VERSIONS.PLAYWRIGHT}</playwright.version>
        <cucumber.version>${VERSIONS.CUCUMBER}</cucumber.version>
        <junit.version>${VERSIONS.JUNIT}</junit.version>
        <allure.version>${VERSIONS.ALLURE}</allure.version>
        <maven.surefire.version>${VERSIONS.SUREFIRE}</maven.surefire.version>
    </properties>
    
    <dependencies>
        <!-- Playwright -->
        <dependency>
            <groupId>com.microsoft.playwright</groupId>
            <artifactId>playwright</artifactId>
            <version>\${playwright.version}</version>
        </dependency>
        
        <!-- Cucumber -->
        <dependency>
            <groupId>io.cucumber</groupId>
            <artifactId>cucumber-java</artifactId>
            <version>\${cucumber.version}</version>
        </dependency>
        <dependency>
            <groupId>io.cucumber</groupId>
            <artifactId>cucumber-junit-platform-engine</artifactId>
            <version>\${cucumber.version}</version>
        </dependency>
        
        <!-- JUnit 5 -->
        <dependency>
            <groupId>org.junit.platform</groupId>
            <artifactId>junit-platform-suite</artifactId>
            <version>1.10.0</version>
        </dependency>
        <dependency>
            <groupId>org.junit.jupiter</groupId>
            <artifactId>junit-jupiter</artifactId>
            <version>\${junit.version}</version>
            <scope>test</scope>
        </dependency>
        
        <!-- Allure Reports -->
        <dependency>
            <groupId>io.qameta.allure</groupId>
            <artifactId>allure-junit5</artifactId>
            <version>\${allure.version}</version>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>io.qameta.allure</groupId>
            <artifactId>allure-cucumber7-jvm</artifactId>
            <version>\${allure.version}</version>
            <scope>test</scope>
        </dependency>
    </dependencies>
    
    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <version>3.11.0</version>
                <configuration>
                    <source>11</source>
                    <target>11</target>
                </configuration>
            </plugin>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-surefire-plugin</artifactId>
                <version>\${maven.surefire.version}</version>
                <configuration>
                    <argLine>
                        -javaagent:"\${settings.localRepository}/org/aspectj/aspectjweaver/1.9.20.1/aspectjweaver-1.9.20.1.jar"
                    </argLine>
                    <properties>
                        <property>
                            <name>listener</name>
                            <value>io.qameta.allure.junit5.AllureJunit5</value>
                        </property>
                    </properties>
                </configuration>
                <dependencies>
                    <dependency>
                        <groupId>org.aspectj</groupId>
                        <artifactId>aspectjweaver</artifactId>
                        <version>1.9.20.1</version>
                    </dependency>
                </dependencies>
            </plugin>
            <plugin>
                <groupId>io.qameta.allure</groupId>
                <artifactId>allure-maven</artifactId>
                <version>2.12.0</version>
                <configuration>
                    <reportVersion>\${allure.version}</reportVersion>
                </configuration>
            </plugin>
            <!-- Note: Install Playwright browsers manually using: npx playwright install -->
        </plugins>
    </build>
</project>`;
  } else {
    return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    
    <groupId>com.automation</groupId>
    <artifactId>${mavenArtifactId}</artifactId>
    <version>1.0-SNAPSHOT</version>
    <packaging>jar</packaging>
    
    <name>${projectName}</name>
    <description>Automated tests with Selenium and Cucumber</description>
    
    <properties>
        <maven.compiler.source>11</maven.compiler.source>
        <maven.compiler.target>11</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <selenium.version>${VERSIONS.SELENIUM}</selenium.version>
        <cucumber.version>${VERSIONS.CUCUMBER}</cucumber.version>
        <junit.version>${VERSIONS.JUNIT}</junit.version>
        <webdrivermanager.version>${VERSIONS.WEBDRIVER_MANAGER}</webdrivermanager.version>
        <allure.version>${VERSIONS.ALLURE}</allure.version>
        <maven.surefire.version>${VERSIONS.SUREFIRE}</maven.surefire.version>
    </properties>
    
    <dependencies>
        <!-- Selenium WebDriver -->
        <dependency>
            <groupId>org.seleniumhq.selenium</groupId>
            <artifactId>selenium-java</artifactId>
            <version>\${selenium.version}</version>
        </dependency>
        
        <!-- WebDriverManager for automatic driver management -->
        <dependency>
            <groupId>io.github.bonigarcia</groupId>
            <artifactId>webdrivermanager</artifactId>
            <version>\${webdrivermanager.version}</version>
        </dependency>
        
        <!-- Cucumber -->
        <dependency>
            <groupId>io.cucumber</groupId>
            <artifactId>cucumber-java</artifactId>
            <version>\${cucumber.version}</version>
        </dependency>
        <dependency>
            <groupId>io.cucumber</groupId>
            <artifactId>cucumber-junit-platform-engine</artifactId>
            <version>\${cucumber.version}</version>
        </dependency>
        
        <!-- JUnit 5 -->
        <dependency>
            <groupId>org.junit.platform</groupId>
            <artifactId>junit-platform-suite</artifactId>
            <version>1.10.0</version>
        </dependency>
        <dependency>
            <groupId>org.junit.jupiter</groupId>
            <artifactId>junit-jupiter</artifactId>
            <version>\${junit.version}</version>
            <scope>test</scope>
        </dependency>
        
        <!-- Allure Reports -->
        <dependency>
            <groupId>io.qameta.allure</groupId>
            <artifactId>allure-junit5</artifactId>
            <version>\${allure.version}</version>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>io.qameta.allure</groupId>
            <artifactId>allure-cucumber7-jvm</artifactId>
            <version>\${allure.version}</version>
            <scope>test</scope>
        </dependency>
    </dependencies>
    
    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <version>3.11.0</version>
                <configuration>
                    <source>11</source>
                    <target>11</target>
                </configuration>
            </plugin>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-surefire-plugin</artifactId>
                <version>\${maven.surefire.version}</version>
                <configuration>
                    <argLine>
                        -javaagent:"\${settings.localRepository}/org/aspectj/aspectjweaver/1.9.20.1/aspectjweaver-1.9.20.1.jar"
                    </argLine>
                    <properties>
                        <property>
                            <name>listener</name>
                            <value>io.qameta.allure.junit5.AllureJunit5</value>
                        </property>
                    </properties>
                </configuration>
                <dependencies>
                    <dependency>
                        <groupId>org.aspectj</groupId>
                        <artifactId>aspectjweaver</artifactId>
                        <version>1.9.20.1</version>
                    </dependency>
                </dependencies>
            </plugin>
            <plugin>
                <groupId>io.qameta.allure</groupId>
                <artifactId>allure-maven</artifactId>
                <version>2.12.0</version>
                <configuration>
                    <reportVersion>\${allure.version}</reportVersion>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>`;
  }
}

export { sanitizeMavenArtifactId, generateMavenPom };
