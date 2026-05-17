import { chromium, firefox, webkit } from 'playwright';
import { v4 as uuidv4 } from 'uuid';

export class BrowserService {
  constructor() {
    this.activeSessions = new Map();
    this.maxSessions = parseInt(process.env.MAX_SESSIONS) || 5;
    this.sessionTimeout = parseInt(process.env.SESSION_TIMEOUT) || 30 * 60 * 1000; // 30 minutes
  }

  async createSession(baseUrl = 'about:blank', browserType = 'chromium', options = {}) {
    // T2.5 — `options.viewport` (optional): { width, height } to force a
    // specific viewport size instead of the default "maximize". Passed
    // through from the recorder UI's viewport-preset dropdown.
    const requestedViewport = (options && options.viewport &&
      Number.isFinite(options.viewport.width) && Number.isFinite(options.viewport.height) &&
      options.viewport.width >= 200 && options.viewport.height >= 200)
      ? { width: Math.floor(options.viewport.width), height: Math.floor(options.viewport.height) }
      : null;

    // Check session limit
    if (this.activeSessions.size >= this.maxSessions) {
      throw new Error('Maximum number of concurrent recording sessions reached');
    }

    const sessionId = uuidv4();
    let browser;
    let launchError;

    // Get the appropriate browser launcher
    const browserLauncher = this.getBrowserLauncher(browserType);

    // Base args for all browsers
    const getBaseArgs = (browserType) => {
      const baseArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ];
      
      // Add --start-maximized for Chromium-based browsers (Chrome, Edge, Chromium)
      if (browserType === 'chromium' || browserType === 'edge') {
        baseArgs.push('--start-maximized');
      }
      
      return baseArgs;
    };

    // Launch strategies with fallback
    const launchStrategies = [
      // Strategy 1: Try with default options (with channel for Chromium/Edge)
      async () => {
        const options = {
          headless: false,
          args: getBaseArgs(browserType)
        };
        
        // Add channel for chromium-based browsers
        if (browserType === 'chromium') {
          options.channel = 'chrome';
        } else if (browserType === 'edge') {
          options.channel = 'msedge';
        }
        
        console.log(`[BrowserService] Strategy 1: Launching ${browserType} with channel and --start-maximized`);
        return await browserLauncher.launch(options);
      },
      // Strategy 2: Try without channel specification (chromium/edge only)
      async () => {
        if (browserType !== 'chromium' && browserType !== 'edge') {
          throw new Error('Not applicable for this browser type');
        }
        console.log(`[BrowserService] Strategy 2: Launching ${browserType} without channel, with --start-maximized`);
        return await browserLauncher.launch({
          headless: false,
          args: getBaseArgs(browserType)
        });
      },
      // Strategy 3: Try with executable path (chromium/edge only)
      async () => {
        if (browserType !== 'chromium' && browserType !== 'edge') {
          throw new Error('Not applicable for this browser type');
        }
        const executablePath = this.getBrowserExecutablePath(browserType);
        console.log(`[BrowserService] Strategy 3: Launching ${browserType} with executable path, with --start-maximized`);
        return await browserLauncher.launch({
          headless: false,
          executablePath,
          args: getBaseArgs(browserType)
        });
      }
    ];

    for (let i = 0; i < launchStrategies.length; i++) {
      try {
        browser = await launchStrategies[i]();
        console.log(`[BrowserService] ✅ Browser launched successfully using strategy ${i + 1}`);
        break;
      } catch (error) {
        launchError = error;
        console.warn(`[BrowserService] ⚠️ Strategy ${i + 1} failed for ${browserType}: ${error.message}`);
        if (error.stack) {
          console.warn(`[BrowserService] Stack trace:`, error.stack);
        }
      }
    }

    if (!browser) {
      const errorMessage = launchError?.message || 'Unknown error';
      const errorStack = launchError?.stack || 'No stack trace available';
      const browserNames = {
        chromium: 'Chrome',
        firefox: 'Firefox',
        webkit: 'WebKit',
        edge: 'Microsoft Edge'
      };
      // Edge uses chromium engine, so install chromium
      const installBrowser = browserType === 'edge' ? 'chromium' : browserType;
      const installCommand = `npx playwright install ${installBrowser}`;
      const browserName = browserNames[browserType] || browserType;
      
      console.error(`[BrowserService] ❌ Failed to launch ${browserName} after ${launchStrategies.length} strategies`);
      console.error(`[BrowserService] Last error: ${errorMessage}`);
      console.error(`[BrowserService] Stack trace: ${errorStack}`);
      
      throw new Error(
        `Failed to launch ${browserName} after trying ${launchStrategies.length} different strategies.\n` +
        `Error: ${errorMessage}\n\n` +
        `Possible solutions:\n` +
        `1. Install browser: ${installCommand}\n` +
        `2. Check if browser is already running and close it\n` +
        `3. Verify Playwright installation: npm list playwright\n` +
        `4. Check system permissions for browser execution`
      );
    }

    try {
      // For headed mode, use viewport: null to let Playwright use full available window
      // Combined with --start-maximized, this ensures maximum screen usage.
      // T2.5 — if the caller passed an explicit viewport (e.g. a tablet
      // preset), use that instead so the recording reflects the device
      // the user wants to test.
      let viewportConfig = requestedViewport; // null → full window (maximized); object → forced size
      let detectedViewport = null;
      
      // Try to detect screen size for logging purposes (optional, won't fail if it doesn't work)
      try {
        const tempContext = await browser.newContext({ viewport: null });
        const tempPage = await tempContext.newPage();
        
        await tempPage.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 5000 });
        await tempPage.waitForTimeout(200); // Give browser time to maximize
        
        detectedViewport = await tempPage.evaluate(() => {
          try {
            const availWidth = window.screen.availWidth || window.screen.width || 1920;
            const availHeight = window.screen.availHeight || window.screen.height || 1080;
            const innerWidth = window.innerWidth || availWidth;
            const innerHeight = window.innerHeight || availHeight;
            
            return {
              screen: { width: availWidth, height: availHeight },
              viewport: { width: innerWidth, height: innerHeight }
            };
          } catch (err) {
            return null;
          }
        });
        
        await tempPage.close().catch(() => {});
        await tempContext.close().catch(() => {});
        
        if (detectedViewport) {
          console.log(`[BrowserService] 📊 Screen: ${detectedViewport.screen.width}x${detectedViewport.screen.height}, Viewport: ${detectedViewport.viewport.width}x${detectedViewport.viewport.height}`);
        }
      } catch (e) {
        console.warn(`[BrowserService] ⚠️ Could not detect screen size (${e.message}), will use full window`);
      }

      // Create context with viewport: null for maximum window size
      // With --start-maximized flag, this will use the full available screen
      const context = await browser.newContext({
        viewport: viewportConfig, // null = full window
        userAgent: 'Zero-Code-Automation-Recorder/1.0'
      });

      console.log(`[BrowserService] ✅ Browser context created with viewport: ${viewportConfig === null ? 'full window (maximized)' : `${viewportConfig.width}x${viewportConfig.height}`}`);

      // Inject recording script at context level (persists across all pages)
      await this.injectRecordingScript(context, sessionId);

      // ── T1.8 Multi-tab handlers ─────────────────────────────────
      // When the user opens a new tab via Cmd-click / window.open / etc.,
      // Playwright fires `context.on('page', …)`. Wire the SAME
      // setupPageEventHandlers (scroll, navigation, download, popup,
      // close) to that new page or the recorder is blind to anything the
      // user does there. The context-level addInitScript already covers
      // click/type/select/check/etc. but the page-level Node hooks are
      // per-page and must be attached explicitly.
      //
      // We use a WeakSet (`__zacWired`) to track pages we've already
      // bound to, so the first page (which createSession attaches to
      // directly) doesn't get double-wired when context.on('page')
      // fires for it.
      const __zacWired = new WeakSet();
      context.on('page', async (newPage) => {
        try {
          if (__zacWired.has(newPage)) return;
          __zacWired.add(newPage);
          console.log(`[BrowserService] context.on('page') fired — wiring handlers to new tab (${newPage.url()})`);
          await this.setupPageEventHandlers(newPage, sessionId);
        } catch (e) {
          console.warn(`[BrowserService] failed to attach handlers to new tab:`, e.message);
        }
      });

      const page = await context.newPage();
      __zacWired.add(page); // mark first page as wired before setup below
      
      // Verify actual viewport after page creation
      try {
        await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 5000 });
        await page.waitForTimeout(300); // Wait for window to maximize
        
        const actualViewport = page.viewportSize();
        if (actualViewport) {
          console.log(`[BrowserService] ✅ Actual viewport size: ${actualViewport.width}x${actualViewport.height}`);
          
          // Warn if viewport is unreasonably small
          if (actualViewport.width < 1024 || actualViewport.height < 600) {
            console.warn(`[BrowserService] ⚠️ WARNING: Viewport is smaller than expected (${actualViewport.width}x${actualViewport.height}). Expected at least 1024x600.`);
            console.warn(`[BrowserService] This may indicate the browser did not maximize properly.`);
          } else {
            console.log(`[BrowserService] ✅ Viewport size is acceptable (${actualViewport.width}x${actualViewport.height})`);
          }
        }
      } catch (e) {
        console.warn(`[BrowserService] ⚠️ Could not verify viewport size: ${e.message}`);
      }

      // Set up page event handlers
      await this.setupPageEventHandlers(page, sessionId);

      const session = {
        sessionId,
        browser,
        context,
        page,
        ws: null,
        actions: [],
        createdAt: Date.now(),
        lastActivity: Date.now(),
        lastUrl: null // Track last URL to detect navigation changes
      };

      this.activeSessions.set(sessionId, session);
      console.log(`[BrowserService] Session created: ${sessionId}, total active sessions: ${this.activeSessions.size}`);

      // Set up session cleanup timer
      this.setupSessionCleanup(sessionId);

      // Navigate to initial URL
      await this.navigateToUrl(session, baseUrl);

      return session;
    } catch (error) {
      // Enhanced error logging with context
      console.error(`[BrowserService] ❌ Failed to create session for ${browserType}:`, error.message);
      if (error.stack) {
        console.error(`[BrowserService] Stack trace:`, error.stack);
      }
      console.error(`[BrowserService] Error context:`, {
        browserType,
        baseUrl,
        sessionId,
        browserLaunched: !!browser
      });
      
      // Cleanup on failure
      if (browser) {
        try {
          await browser.close();
          console.log(`[BrowserService] ✅ Browser closed after error`);
        } catch (closeError) {
          console.error(`[BrowserService] ⚠️ Error closing browser:`, closeError.message);
        }
      }
      
      // Re-throw with enhanced message
      const enhancedError = new Error(
        `Failed to create browser session: ${error.message}\n` +
        `Browser Type: ${browserType}\n` +
        `Base URL: ${baseUrl}\n` +
        `Session ID: ${sessionId}\n\n` +
        `Original error: ${error.message}`
      );
      enhancedError.stack = error.stack;
      throw enhancedError;
    }
  }

  async injectRecordingScript(context, sessionId) {
    const port = process.env.PORT || 3000;
    // Inject recording script with context menu for assertions at context level
    // This runs before page scripts, so we need to ensure DOM is ready
    const scriptContent = `
      (function() {
        const SESSION_ID = '${sessionId}';
        const API_URL = 'http://localhost:${port}/api/recording/' + SESSION_ID + '/action';
        
        console.log('[Recording Script] ========================================');
        console.log('[Recording Script] ✅ Script injected for session:', SESSION_ID);
        console.log('[Recording Script] API URL:', API_URL);
        console.log('[Recording Script] ========================================');
        console.log('[Recording Script] 📋 Event listeners will be attached when DOM is ready');
        
        // Guard flags to prevent duplicate initialization
        if (window.__ZERO_CODE_RECORDING_INITIALIZED__) {
          console.warn('[Recording Script] ⚠️ Recording script already initialized, skipping duplicate initialization');
          return;
        }
        window.__ZERO_CODE_RECORDING_INITIALIZED__ = true;
        window.__ZERO_CODE_RECORDING_SESSION_ID__ = SESSION_ID;
        
        // Add a visual indicator that the script is loaded (after DOM is ready)
        function addVisualIndicator() {
          if (document.body && !document.getElementById('zero-code-recording-indicator')) {
            const indicator = document.createElement('div');
            indicator.id = 'zero-code-recording-indicator';
            indicator.style.cssText = 'position: fixed; top: 10px; right: 10px; background: #10b981; color: white; padding: 8px 16px; border-radius: 6px; z-index: 999998; font-size: 12px; font-family: monospace; box-shadow: 0 2px 8px rgba(0,0,0,0.3);';
            indicator.textContent = '🎬 Recording Active - Right-click for assertions';
            document.body.appendChild(indicator);
            console.log('[Recording Script] ✅ Visual indicator added');
          }
        }
        
        // Try to add indicator immediately if body exists, otherwise wait
        if (document.body) {
          addVisualIndicator();
        } else {
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', addVisualIndicator, { once: true });
          } else {
            setTimeout(addVisualIndicator, 100);
          }
        }
        
        // Context menu element
        let contextMenu = null;
        let currentElement = null;
        let contextMenuListenersAttached = false;
        
        // Create context menu
        function createContextMenu() {
          if (contextMenu) {
            console.log('[Recording Script] Context menu already exists');
            return;
          }
          
          console.log('[Recording Script] Creating context menu...');
          
          contextMenu = document.createElement('div');
          contextMenu.id = 'zero-code-context-menu';
          contextMenu.style.cssText = 'position: fixed; background: #1a1f2e; border: 1px solid #2a3441; border-radius: 8px; padding: 8px; z-index: 999999; box-shadow: 0 4px 20px rgba(0,0,0,0.5); display: none; min-width: 200px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;';
          
          const menuItems = [
            { label: '🌐 Navigate To', kind: 'navigate', separator: true },
            { label: '📌 Save as Locator', kind: 'saveLocator', separator: true },
            { label: '✓ Assert Visible', kind: 'assertVisible', separator: true },
            { label: '✗ Assert Not Visible', kind: 'assertNotVisible' },
            { label: '📝 Assert Text Contains', kind: 'assertText' },
            { label: '🏷️ Assert Attribute', kind: 'assertAttribute' },
            { label: '🔢 Assert Count', kind: 'assertCount' },
            { label: '📋 Assert Value', kind: 'assertValue' },
            { label: '✅ Assert Enabled', kind: 'assertEnabled' },
            { label: '❌ Assert Disabled', kind: 'assertDisabled' },
            { label: '☑ Assert Checked', kind: 'assertChecked' },
            { label: '☐ Assert Not Checked', kind: 'assertNotChecked' }
          ];
          
          menuItems.forEach((item, index) => {
            if (item.separator && index > 0) {
              const separator = document.createElement('div');
              separator.style.cssText = 'height: 1px; background: #2a3441; margin: 6px 0;';
              contextMenu.appendChild(separator);
            }
            
            const menuItem = document.createElement('div');
            menuItem.textContent = item.label;
            menuItem.style.cssText = 'padding: 12px 16px; cursor: pointer; font-size: 13px; border-radius: 6px; transition: all 0.2s; color: #e1e8ed; margin: 2px 0;';
            menuItem.onmouseenter = () => {
              menuItem.style.background = 'rgba(90, 169, 255, 0.2)';
              menuItem.style.color = '#5aa9ff';
            };
            menuItem.onmouseleave = () => {
              menuItem.style.background = '';
              menuItem.style.color = '#e1e8ed';
            };
            menuItem.onclick = (e) => {
              e.stopPropagation();
              if (item.kind === 'navigate') {
                console.log('[Recording Script] Navigate selected');
                handleNavigate();
              } else if (item.kind === 'saveLocator') {
                console.log('[Recording Script] Save as Locator selected');
                handleSaveLocator();
              } else {
                console.log('[Recording Script] Assertion selected:', item.kind);
                handleAssertion(item.kind);
              }
              hideContextMenu();
            };
            contextMenu.appendChild(menuItem);
          });
          
          if (!document.body) {
            console.error('[Recording Script] ❌ document.body is null! Cannot append context menu');
            return;
          }
          
          document.body.appendChild(contextMenu);
          console.log('[Recording Script] ✅ Context menu created and appended to body. Menu items:', menuItems.length);
        }
        
        // Show context menu
        function showContextMenu(x, y, element) {
          console.log('[Recording Script] showContextMenu called', { x, y, element: element?.tagName });
          currentElement = element;
          if (!contextMenu) {
            console.log('[Recording Script] Creating context menu...');
            createContextMenu();
          }
          
          if (!contextMenu) {
            console.error('[Recording Script] ❌ Context menu creation failed!');
            return;
          }
          
          // Use viewport coordinates for fixed positioning
          // Get viewport-relative coordinates
          const clientX = typeof x === 'number' ? x : (window.event ? window.event.clientX : 0);
          const clientY = typeof y === 'number' ? y : (window.event ? window.event.clientY : 0);
          
          console.log('[Recording Script] Showing menu at:', clientX, clientY);
          
          // Show menu first to calculate dimensions
          contextMenu.style.display = 'block';
          contextMenu.style.visibility = 'hidden'; // Hide while calculating
          
          // Get menu dimensions
          const menuWidth = contextMenu.offsetWidth || 200;
          const menuHeight = contextMenu.offsetHeight || 250;
          
          // Calculate position - start at cursor
          let left = clientX;
          let top = clientY;
          
          // Adjust if menu goes off screen (right edge)
          if (left + menuWidth > window.innerWidth) {
            left = clientX - menuWidth;
            // Don't go off left edge
            if (left < 0) left = 10;
          }
          
          // Adjust if menu goes off screen (bottom edge)
          if (top + menuHeight > window.innerHeight) {
            top = clientY - menuHeight;
            // Don't go off top edge
            if (top < 0) top = 10;
          }
          
          // Apply position and make visible
          contextMenu.style.left = left + 'px';
          contextMenu.style.top = top + 'px';
          contextMenu.style.visibility = 'visible';
          
          console.log('[Recording Script] ✅ Context menu displayed at:', left, top);
        }
        
        // Hide context menu
        function hideContextMenu() {
          if (contextMenu) {
            contextMenu.style.display = 'none';
          }
          currentElement = null;
        }
        
        // Helper function to get the nearest clickable ancestor element
        // This normalizes clicks on child elements (like spans inside buttons) to the actual clickable element
        function getClickableElement(element) {
          if (!element) return null;
          
          // Walk up the DOM tree to find the nearest clickable ancestor
          let current = element;
          let maxDepth = 10; // Prevent infinite loops
          let depth = 0;
          
          while (current && depth < maxDepth) {
            const tag = current.tagName.toLowerCase();
            const role = current.getAttribute('role');
            const hasHref = current.hasAttribute('href');
            const hasOnClick = current.onclick !== null || current.getAttribute('onclick');
            const tabIndex = current.getAttribute('tabindex');
            
            // Check if current element is clickable
            const isClickable = 
              tag === 'a' || 
              tag === 'button' ||
              (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(current.type)) ||
              role === 'button' ||
              role === 'link' ||
              hasHref ||
              hasOnClick ||
              (tabIndex !== null && parseInt(tabIndex) >= 0);
            
            if (isClickable) {
              return current;
            }
            
            // Move to parent
            current = current.parentElement;
            depth++;
          }
          
          // If no clickable ancestor found, return the original element
          return element;
        }
        
        // Helper function to check if a selector matches multiple elements
        function checkSelectorUniqueness(selector, targetElement) {
          if (!selector || !targetElement) return { unique: true, count: 0, suggestions: [] };
          
          try {
            let matches = [];
            let selectorType = 'css';
            
            if (selector.startsWith('text=')) {
              const text = selector.substring(5).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
              // For text selectors, match visible text only (exclude hidden elements)
              matches = Array.from(document.querySelectorAll('*')).filter(el => {
                // Skip hidden elements
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                  return false;
                }
                const elText = (el.textContent || '').trim();
                // Match exact text or partial text (for long strings)
                return elText === text || (text.length > 20 && elText.includes(text));
              });
              selectorType = 'text';
            } else if (selector.startsWith('role=')) {
              const role = selector.substring(5);
              matches = Array.from(document.querySelectorAll('[role="' + role + '"]'));
              selectorType = 'role';
            } else if (selector.startsWith('xpath=') || selector.startsWith('//')) {
              const xpath = selector.startsWith('xpath=') ? selector.substring(6) : selector;
              try {
                const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                matches = [];
                for (let i = 0; i < result.snapshotLength; i++) {
                  matches.push(result.snapshotItem(i));
                }
              } catch (e) {
                return { unique: false, count: 0, suggestions: [], error: 'Invalid XPath' };
              }
              selectorType = 'xpath';
            } else {
              try {
                matches = Array.from(document.querySelectorAll(selector));
              } catch (e) {
                return { unique: false, count: 0, suggestions: [], error: 'Invalid CSS selector' };
              }
            }
            
            const count = matches.length;
            const isUnique = count === 1;
            const suggestions = [];
            
            if (!isUnique && count > 1) {
              // Generate context-aware suggestions
              let parent = targetElement.parentElement;
              let ancestorDepth = 0;
              const maxAncestorDepth = 5;
              
              // Walk up ancestors to find a good parent context
              while (parent && ancestorDepth < maxAncestorDepth) {
                const parentTag = parent.tagName.toLowerCase();
                
                // Skip body and html
                if (parentTag === 'body' || parentTag === 'html') {
                  parent = parent.parentElement;
                  ancestorDepth++;
                  continue;
                }
                
                // Try parent with ID
                if (parent.id) {
                  const parentIdSelector = '#' + parent.id;
                  suggestions.push(parentIdSelector + ' ' + selector);
                  suggestions.push(parentIdSelector + ' > ' + targetElement.tagName.toLowerCase());
                  
                  // Add nth-child if siblings exist
                  const siblings = Array.from(parent.children);
                  const index = siblings.indexOf(targetElement);
                  if (index >= 0) {
                    suggestions.push(parentIdSelector + ' > ' + targetElement.tagName.toLowerCase() + ':nth-child(' + (index + 1) + ')');
                    suggestions.push(parentIdSelector + ' > ' + targetElement.tagName.toLowerCase() + ':nth-of-type(' + (siblings.filter(s => s.tagName === targetElement.tagName).indexOf(targetElement) + 1) + ')');
                  }
                }
                
                // Try parent with meaningful class (ignore auto-generated classes)
                if (parent.className && typeof parent.className === 'string') {
                  const parentClasses = parent.className.split(' ').filter(c => {
                    const clean = c.trim();
                    return clean && 
                           !clean.startsWith('css-') && 
                           !clean.startsWith('ng-') && 
                           !clean.startsWith('_') &&
                           clean.length > 2;
                  });
                  if (parentClasses.length > 0) {
                    const parentClassSelector = '.' + parentClasses[0];
                    suggestions.push(parentClassSelector + ' ' + selector);
                    
                    const siblings = Array.from(parent.children);
                    const index = siblings.indexOf(targetElement);
                    if (index >= 0) {
                      suggestions.push(parentClassSelector + ' > ' + targetElement.tagName.toLowerCase() + ':nth-child(' + (index + 1) + ')');
                    }
                  }
                }
                
                // Try parent with data-testid
                if (parent.getAttribute('data-testid')) {
                  const parentTestId = '[data-testid="' + parent.getAttribute('data-testid') + '"]';
                  suggestions.push(parentTestId + ' ' + selector);
                }
                
                // If we found a good parent context, break
                if (parent.id || (parent.className && parent.className.split(' ').some(c => c && !c.startsWith('css-') && !c.startsWith('ng-')))) {
                  break;
                }
                
                parent = parent.parentElement;
                ancestorDepth++;
              }
              
              // Add text-based suggestions if available
              const text = targetElement.textContent && targetElement.textContent.trim();
              if (text && text.length > 0 && text.length < 50) {
                if (selectorType === 'css') {
                  const escapedText = text.substring(0, 30).replace(/"/g, '\\"');
                  suggestions.push(selector + ':has-text("' + escapedText + '")');
                }
                // Also suggest pure text selector
                const escapedText = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                suggestions.push('text=' + escapedText);
              }
              
              // Add data attribute suggestions
              if (targetElement.getAttribute('data-testid')) {
                suggestions.push('[data-testid="' + targetElement.getAttribute('data-testid') + '"]');
              }
              if (targetElement.getAttribute('data-id')) {
                suggestions.push('[data-id="' + targetElement.getAttribute('data-id') + '"]');
              }
            }
            
            return {
              unique: isUnique,
              count: count,
              suggestions: suggestions,
              selectorType: selectorType
            };
          } catch (error) {
            return { unique: true, count: 0, suggestions: [], error: error.message };
          }
        }
        
        // Helper function to build context-aware selector using parent/ancestor
        function buildContextAwareSelector(element, baseSelector, parent) {
          if (!parent || !element) return null;
          
          const parentTag = parent.tagName.toLowerCase();
          if (parentTag === 'body' || parentTag === 'html') return null;
          
          // Try parent with ID
          if (parent.id) {
            const contextSelector = '#' + parent.id + ' ' + baseSelector;
            const uniqueness = checkSelectorUniqueness(contextSelector, element);
            if (uniqueness.unique) return contextSelector;
            
            // Try with direct child combinator
            const directChildSelector = '#' + parent.id + ' > ' + baseSelector;
            const directUniqueness = checkSelectorUniqueness(directChildSelector, element);
            if (directUniqueness.unique) return directChildSelector;
            
            // Try with nth-child
            const siblings = Array.from(parent.children);
            const index = siblings.indexOf(element);
            if (index >= 0) {
              const tag = element.tagName.toLowerCase();
              const nthChildSelector = '#' + parent.id + ' > ' + tag + ':nth-child(' + (index + 1) + ')';
              const nthUniqueness = checkSelectorUniqueness(nthChildSelector, element);
              if (nthUniqueness.unique) return nthChildSelector;
            }
          }
          
          // Try parent with meaningful class
          if (parent.className && typeof parent.className === 'string') {
            const parentClasses = parent.className.split(' ').filter(c => {
              const clean = c.trim();
              return clean && 
                     !clean.startsWith('css-') && 
                     !clean.startsWith('ng-') && 
                     !clean.startsWith('_') &&
                     clean.length > 2;
            });
            if (parentClasses.length > 0) {
              const contextSelector = '.' + parentClasses[0] + ' ' + baseSelector;
              const uniqueness = checkSelectorUniqueness(contextSelector, element);
              if (uniqueness.unique) return contextSelector;
            }
          }
          
          // Try parent with data-testid
          if (parent.getAttribute('data-testid')) {
            const contextSelector = '[data-testid="' + parent.getAttribute('data-testid') + '"] ' + baseSelector;
            const uniqueness = checkSelectorUniqueness(contextSelector, element);
            if (uniqueness.unique) return contextSelector;
          }
          
          return null;
        }
        
        // Get element selector with priority-based algorithm
        function getElementSelector(element) {
          if (!element) return null;
          
          const tag = element.tagName.toLowerCase();
          const isGenericElement = tag === 'span' || tag === 'div' || tag === 'p' || tag === 'a' || tag === 'button';
          
          // Candidate selectors with priority scores (lower = higher priority)
          const candidates = [];
          
          // 1. STRONG ATTRIBUTE SELECTORS (Priority 1-5)
          
          // 1.1 ID selector (highest priority)
          if (element.id) {
            const idSelector = '#' + element.id;
            const uniqueness = checkSelectorUniqueness(idSelector, element);
            candidates.push({
              selector: idSelector,
              priority: 1,
              unique: uniqueness.unique,
              count: uniqueness.count
            });
            if (uniqueness.unique) {
              // Return immediately if unique
              return idSelector;
            }
          }
          
          // 1.2 Data-testid
          const dataTestId = element.getAttribute('data-testid');
          if (dataTestId) {
            const testIdSelector = '[data-testid="' + dataTestId + '"]';
            const uniqueness = checkSelectorUniqueness(testIdSelector, element);
            candidates.push({
              selector: testIdSelector,
              priority: 2,
              unique: uniqueness.unique,
              count: uniqueness.count
            });
            if (uniqueness.unique) return testIdSelector;
          }
          
          // 1.3 Data-id
          const dataId = element.getAttribute('data-id');
          if (dataId) {
            const dataIdSelector = '[data-id="' + dataId + '"]';
            const uniqueness = checkSelectorUniqueness(dataIdSelector, element);
            candidates.push({
              selector: dataIdSelector,
              priority: 3,
              unique: uniqueness.unique,
              count: uniqueness.count
            });
            if (uniqueness.unique) return dataIdSelector;
          }
          
          // 1.4 Name attribute (for form controls)
          if (element.name && (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'button')) {
            const nameSelector = '[name="' + element.name + '"]';
            const uniqueness = checkSelectorUniqueness(nameSelector, element);
            if (uniqueness.unique || uniqueness.count <= 3) {
              candidates.push({
                selector: nameSelector,
                priority: 4,
                unique: uniqueness.unique,
                count: uniqueness.count
              });
              if (uniqueness.unique) return nameSelector;
            }
          }
          
          // 1.5 Aria-label
          const ariaLabel = element.getAttribute('aria-label');
          if (ariaLabel) {
            const ariaSelector = '[aria-label="' + ariaLabel + '"]';
            const uniqueness = checkSelectorUniqueness(ariaSelector, element);
            if (uniqueness.unique || uniqueness.count <= 2) {
              candidates.push({
                selector: ariaSelector,
                priority: 5,
                unique: uniqueness.unique,
                count: uniqueness.count
              });
              if (uniqueness.unique) return ariaSelector;
            }
          }
          
          // 2. ROLE + TEXT (Priority 6-7)
          const role = element.getAttribute('role');
          const text = element.textContent && element.textContent.trim();
          
          if (role && text && text.length > 0 && text.length < 100) {
            // For Playwright, we can use role with name
            const roleSelector = 'role=' + role;
            const uniqueness = checkSelectorUniqueness(roleSelector, element);
            
            // If role alone is unique, use it
            if (uniqueness.unique) {
              candidates.push({
                selector: roleSelector,
                priority: 6,
                unique: true,
                count: 1
              });
            } else if (uniqueness.count <= 3) {
              // Try to combine with parent context
              let contextSelector = buildContextAwareSelector(element, roleSelector, element.parentElement);
              if (contextSelector) {
                const contextUniqueness = checkSelectorUniqueness(contextSelector, element);
                if (contextUniqueness.unique) {
                  candidates.push({
                    selector: contextSelector,
                    priority: 6,
                    unique: true,
                    count: 1
                  });
                }
              }
            }
          }
          
          // 3. TEXT-BASED SELECTORS (Priority 8-9)
          if (text && text.length > 0) {
            const escapedText = text.length < 100 
              ? text.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"')
              : text.trim().substring(0, 50).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            
            const textSelector = 'text=' + escapedText;
            const uniqueness = checkSelectorUniqueness(textSelector, element);
            
            if (uniqueness.unique) {
              candidates.push({
                selector: textSelector,
                priority: isGenericElement ? 7 : 8,
                unique: true,
                count: 1
              });
            } else if (uniqueness.count <= 2) {
              candidates.push({
                selector: textSelector,
                priority: isGenericElement ? 8 : 9,
                unique: false,
                count: uniqueness.count
              });
              
              // Try context-aware text selector
              if (uniqueness.suggestions && uniqueness.suggestions.length > 0) {
                const contextTextSelector = uniqueness.suggestions[0];
                const contextUniqueness = checkSelectorUniqueness(contextTextSelector, element);
                if (contextUniqueness.unique) {
                  candidates.push({
                    selector: contextTextSelector,
                    priority: isGenericElement ? 7 : 8,
                    unique: true,
                    count: 1
                  });
                }
              }
            }
          }
          
          // 4. CLASS-BASED CSS SELECTORS (Priority 10-11)
          if (element.className && typeof element.className === 'string') {
            // Filter out auto-generated classes
            const meaningfulClasses = element.className.split(' ').filter(c => {
              const clean = c.trim();
              return clean && 
                     !clean.startsWith('css-') && 
                     !clean.startsWith('ng-') && 
                     !clean.startsWith('_') &&
                     clean.length > 2;
            });
            
            if (meaningfulClasses.length > 0) {
              const classSelector = tag + '.' + meaningfulClasses.map(c => c.trim()).join('.');
              const uniqueness = checkSelectorUniqueness(classSelector, element);
              
              if (uniqueness.unique) {
                candidates.push({
                  selector: classSelector,
                  priority: 10,
                  unique: true,
                  count: 1
                });
              } else if (uniqueness.count <= 3) {
                candidates.push({
                  selector: classSelector,
                  priority: 11,
                  unique: false,
                  count: uniqueness.count
                });
                
                // Try context-aware class selector
                if (uniqueness.suggestions && uniqueness.suggestions.length > 0) {
                  const contextClassSelector = uniqueness.suggestions[0];
                  const contextUniqueness = checkSelectorUniqueness(contextClassSelector, element);
                  if (contextUniqueness.unique) {
                    candidates.push({
                      selector: contextClassSelector,
                      priority: 10,
                      unique: true,
                      count: 1
                    });
                  }
                }
              }
            }
          }
          
          // 5. DOM CONTEXT SELECTORS (Priority 12+)
          // Walk up ancestors to build context-aware selectors
          let parent = element.parentElement;
          let ancestorDepth = 0;
          const maxAncestorDepth = 5;
          
          while (parent && ancestorDepth < maxAncestorDepth) {
            const parentTag = parent.tagName.toLowerCase();
            if (parentTag === 'body' || parentTag === 'html') {
              parent = parent.parentElement;
              ancestorDepth++;
              continue;
            }
            
            // Try building context-aware selector with current candidates
            for (const candidate of candidates) {
              if (!candidate.unique) {
                const contextSelector = buildContextAwareSelector(element, candidate.selector, parent);
                if (contextSelector) {
                  const contextUniqueness = checkSelectorUniqueness(contextSelector, element);
                  if (contextUniqueness.unique) {
                    candidates.push({
                      selector: contextSelector,
                      priority: 12 + ancestorDepth,
                      unique: true,
                      count: 1
                    });
                  }
                }
              }
            }
            
            // If we found a good parent context, try building a base selector with it
            if (parent.id || (parent.className && parent.className.split(' ').some(c => c && !c.startsWith('css-') && !c.startsWith('ng-')))) {
              const baseTagSelector = tag;
              const contextSelector = buildContextAwareSelector(element, baseTagSelector, parent);
              if (contextSelector) {
                const contextUniqueness = checkSelectorUniqueness(contextSelector, element);
                if (contextUniqueness.unique) {
                  candidates.push({
                    selector: contextSelector,
                    priority: 12 + ancestorDepth,
                    unique: true,
                    count: 1
                  });
                }
              }
              break; // Found good parent, stop walking
            }
            
            parent = parent.parentElement;
            ancestorDepth++;
          }
          
          // 6. XPath as last resort (Priority 20+)
          if (element.parentElement) {
            const siblings = Array.from(element.parentElement.children).filter(el => el.tagName === element.tagName);
            if (siblings.length > 1) {
              const index = siblings.indexOf(element) + 1;
              const xpathSelector = 'xpath=//' + tag + '[' + index + ']';
              const uniqueness = checkSelectorUniqueness(xpathSelector, element);
              if (uniqueness.unique || uniqueness.count <= 2) {
                candidates.push({
                  selector: xpathSelector,
                  priority: 20,
                  unique: uniqueness.unique,
                  count: uniqueness.count
                });
              }
            }
          }
          
          // 7. SELECT FINAL SELECTOR
          // Sort by: unique first, then priority, then count
          candidates.sort((a, b) => {
            if (a.unique !== b.unique) return a.unique ? -1 : 1;
            if (a.priority !== b.priority) return a.priority - b.priority;
            return a.count - b.count;
          });
          
          // Reject generic selectors without context
          const genericTags = ['span', 'div', 'p', 'a', 'button', 'input', 'body'];
          for (const candidate of candidates) {
            const sel = candidate.selector;
            // Skip if it's just a generic tag without any qualifiers
            if (genericTags.some(gt => sel === gt || sel === 'text=' + gt)) {
              continue;
            }
            // Accept this candidate
            const finalUniqueness = checkSelectorUniqueness(sel, element);
            if (!finalUniqueness.unique && finalUniqueness.count > 1) {
              console.warn('[Recording Script] ⚠️ Selector matches', finalUniqueness.count, 'elements:', sel);
              if (finalUniqueness.suggestions && finalUniqueness.suggestions.length > 0) {
                console.warn('[Recording Script] 💡 Consider using:', finalUniqueness.suggestions[0]);
              }
            }
            return sel;
          }
          
          // Last resort: return tag with parent context if available
          if (element.parentElement) {
            const parent = element.parentElement;
            if (parent.id) {
              return '#' + parent.id + ' > ' + tag;
            }
            if (parent.className && typeof parent.className === 'string') {
              const parentClasses = parent.className.split(' ').filter(c => {
                const clean = c.trim();
                return clean && !clean.startsWith('css-') && !clean.startsWith('ng-') && clean.length > 2;
              });
              if (parentClasses.length > 0) {
                return '.' + parentClasses[0] + ' > ' + tag;
              }
            }
          }
          
          // Absolute last resort: return tag (but this should rarely happen)
          console.warn('[Recording Script] ⚠️ Using generic tag selector as last resort:', tag);
          return tag;
        }
        
        // Get all selector strategies for an element (for fallback)
        function getAllSelectorStrategies(element) {
          if (!element) return [];
          
          const strategies = [];
          
          // ID
          if (element.id) {
            strategies.push({ type: 'id', value: '#' + element.id, priority: 1 });
          }
          
          // Name
          if (element.name) {
            strategies.push({ type: 'name', value: '[name="' + element.name + '"]', priority: 2 });
          }
          
          // Data attributes
          if (element.getAttribute('data-testid')) {
            strategies.push({ type: 'data-testid', value: '[data-testid="' + element.getAttribute('data-testid') + '"]', priority: 3 });
          }
          
          // Aria-label
          if (element.getAttribute('aria-label')) {
            strategies.push({ type: 'aria-label', value: '[aria-label="' + element.getAttribute('aria-label') + '"]', priority: 4 });
          }
          
          // Text content
          const text = element.textContent && element.textContent.trim();
          if (text && text.length > 0 && text.length < 100) {
            strategies.push({ type: 'text', value: 'text=' + text.trim(), priority: 5 });
          }
          
          // CSS class
          if (element.className && typeof element.className === 'string') {
            const classes = element.className.split(' ').filter(c => c && c.trim());
            if (classes.length > 0) {
          const tag = element.tagName.toLowerCase();
              strategies.push({ type: 'css', value: tag + '.' + classes.join('.'), priority: 6 });
            }
          }
          
          return strategies.sort((a, b) => a.priority - b.priority);
        }
        
        // Handle assertion
        async function handleAssertion(kind) {
          if (!currentElement) return;
          
          // Normalize to clickable element for assertions (if applicable)
          const targetElement = getClickableElement(currentElement);
          if (!targetElement) {
            console.warn('[Recording Script] ⚠️ Could not determine target element for assertion');
            return;
          }
          
          let selector = getElementSelector(targetElement);
          if (!selector) {
            console.warn('[Recording Script] ⚠️ No selector found for assertion element:', targetElement);
            return;
          }
          
          // Reject generic selectors without context
          const genericTags = ['span', 'div', 'p', 'a', 'button', 'input', 'body'];
          if (genericTags.includes(selector)) {
            console.warn('[Recording Script] ⚠️ Rejected generic selector for assertion, trying to refine...');
            // Try to get a better selector with context - use getAllSelectorStrategies to find alternatives
            const allStrategies = getAllSelectorStrategies(targetElement);
            const betterSelector = allStrategies.find(s => {
              const sel = s.value;
              return sel && !genericTags.includes(sel);
            });
            if (betterSelector && !genericTags.includes(betterSelector.value)) {
              selector = betterSelector.value;
            } else {
              console.warn('[Recording Script] ⚠️ Could not find better selector for assertion');
              return;
            }
          }
          
          // Get all selector strategies for fallback
          const allStrategies = getAllSelectorStrategies(targetElement);
          const fallbackSelectors = allStrategies.map(s => s.value).filter(s => s !== selector);
          
          // Check selector uniqueness for assertions
          const uniqueness = checkSelectorUniqueness(selector, targetElement);
          
          // Extract element metadata for better normalization
          const metadata = extractElementMetadata(targetElement);
          
          let action = {
            kind: kind,
            selector: selector,
            fallbackSelectors: fallbackSelectors, // Store all fallback selectors
            timestamp: Date.now(),
            selectorUniqueness: {
              unique: uniqueness.unique,
              count: uniqueness.count,
              suggestions: uniqueness.suggestions || []
            },
            // Add metadata for normalization
            ...metadata
          };
          
          if (!uniqueness.unique && uniqueness.count > 1) {
            console.warn('[Recording Script] ⚠️ Assertion selector matches', uniqueness.count, 'elements:', selector);
            if (uniqueness.suggestions && uniqueness.suggestions.length > 0) {
              console.warn('[Recording Script] 💡 Consider using:', uniqueness.suggestions[0]);
            }
          }
          
          // Add specific data based on assertion type
          if (kind === 'assertText') {
            action.text = (targetElement.textContent && targetElement.textContent.trim()) || targetElement.value || '';
            action.expectedValue = action.text;
          } else if (kind === 'assertAttribute') {
            // For attribute, we'll need to prompt or use common attributes
            const attrs = ['href', 'src', 'title', 'alt', 'value'];
            for (let i = 0; i < attrs.length; i++) {
              const attr = attrs[i];
              const value = targetElement.getAttribute(attr);
              if (value) {
                action.value = attr;
                action.expectedValue = value;
                break;
              }
            }
          } else if (kind === 'assertCount') {
            // Count similar elements
            const parent = targetElement.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter(el => 
                el.tagName === targetElement.tagName
              );
              action.expectedValue = siblings.length.toString();
            }
          } else if (kind === 'assertValue') {
            action.expectedValue = targetElement.value || (targetElement.textContent && targetElement.textContent.trim()) || '';
          }
          
          // Send assertion to server
          try {
            const response = await fetch(API_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionId: SESSION_ID,
                kind: action.kind,
                selector: action.selector,
                fallbackSelectors: action.fallbackSelectors, // Include fallback selectors
                text: action.text,
                value: action.value,
                expectedValue: action.expectedValue,
                timestamp: action.timestamp
              })
            });
            console.log('Assertion sent:', kind, response.ok);
          } catch (error) {
            console.error('Failed to send assertion:', error);
          }
        }

        // Right-click → "Save as Locator". Persists the current element
        // (with its full fallback chain) directly into the project's
        // locators.json via /api/recording/:sessionId/save-locator.
        async function handleSaveLocator() {
          if (!currentElement) {
            console.warn('[Recording Script] ⚠️ No element selected for Save as Locator');
            return;
          }

          const targetElement = getClickableElement(currentElement) || currentElement;
          let primarySelector = getElementSelector(targetElement);
          if (!primarySelector) {
            alert('[ZAC] Could not determine a stable selector for this element.');
            return;
          }

          let strategies = [];
          try {
            strategies = (typeof getAllSelectorStrategies === 'function')
              ? (getAllSelectorStrategies(targetElement) || [])
              : [];
          } catch (err) {
            console.warn('[Recording Script] getAllSelectorStrategies failed:', err);
          }
          const fallbackSelectors = strategies
            .map((s) => (s && s.value) ? s.value : null)
            .filter((v) => v && v !== primarySelector);

          const guessedPage = (function () {
            try {
              const path = (window.location && window.location.pathname) || '/';
              const segs = path.split('/').filter(Boolean);
              const tail = segs.length ? segs[segs.length - 1] : 'home';
              const base = tail.replace(/\.[a-zA-Z0-9]+$/, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim() || 'Home';
              return base.replace(/\s+(.)/g, (_, c) => c.toUpperCase()).replace(/^./, (c) => c.toUpperCase()) + 'Page';
            } catch (e) { return 'HomePage'; }
          })();

          const guessedElement = (function () {
            try {
              if (targetElement.id) return targetElement.id.replace(/[^a-zA-Z0-9]+/g, '_');
              const aria = targetElement.getAttribute && targetElement.getAttribute('aria-label');
              if (aria) return aria.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
              const txt = (targetElement.textContent || '').trim().slice(0, 30);
              if (txt) return txt.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
              return (targetElement.tagName || 'element').toLowerCase() + 'Element';
            } catch (e) { return 'element'; }
          })();

          const pageInput = window.prompt('Save Locator: Page name', guessedPage);
          if (pageInput === null) return;
          const elementInput = window.prompt('Save Locator: Element name', guessedElement);
          if (elementInput === null) return;

          const pageName = (pageInput || '').trim() || guessedPage;
          const elementName = (elementInput || '').trim() || guessedElement;

          const SAVE_URL = 'http://localhost:${port}/api/recording/' + SESSION_ID + '/save-locator';
          try {
            const resp = await fetch(SAVE_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                pageName,
                elementName,
                selector: primarySelector,
                fallbackSelectors,
                description: pageName + '.' + elementName,
              }),
            });
            const body = await resp.json().catch(() => ({}));
            if (resp.ok) {
              console.log('[Recording Script] 📌 Locator saved:', body);
              showToast('📌 Locator saved: ' + pageName + '.' + elementName);
            } else {
              console.error('[Recording Script] Save locator failed:', resp.status, body);
              alert('[ZAC] Save locator failed: ' + (body && body.error ? body.error : resp.statusText));
            }
          } catch (err) {
            console.error('[Recording Script] Save locator network error:', err);
            alert('[ZAC] Save locator network error: ' + err.message);
          }
        }

        // Lightweight in-page toast (no-op if a host site already defines one)
        function showToast(message) {
          try {
            const id = 'zac-toast-' + Date.now();
            const el = document.createElement('div');
            el.id = id;
            el.textContent = message;
            el.style.cssText = 'position:fixed;right:20px;bottom:20px;background:#1a1f2e;color:#5aa9ff;border:1px solid #2a3441;border-radius:8px;padding:12px 16px;font:13px -apple-system,BlinkMacSystemFont,sans-serif;z-index:999999;box-shadow:0 4px 20px rgba(0,0,0,0.5);';
            document.body.appendChild(el);
            setTimeout(() => { try { el.remove(); } catch (e) {} }, 2500);
          } catch (e) { /* ignore */ }
        }

        // Handle navigate action (context-level) - shows selection dialog
        async function handleNavigate() {
          if (!currentElement) {
            console.warn('[Recording Script] ⚠️ No element selected for navigation');
            return;
          }
          
          // Get the clickable element (link, button with href, etc.)
          const targetElement = getClickableElement(currentElement);
          if (!targetElement) {
            console.warn('[Recording Script] ⚠️ Could not determine target element for navigation');
            return;
          }
          
          // Extract URL from element
          let url = null;
          
          // Check for href attribute (links)
          if (targetElement.href) {
            url = targetElement.href;
          } else if (targetElement.getAttribute('href')) {
            url = targetElement.getAttribute('href');
          } else if (targetElement.getAttribute('data-href')) {
            url = targetElement.getAttribute('data-href');
          } else if (targetElement.onclick) {
            // Try to extract URL from onclick handler (if it's a simple navigation)
            const onclickStr = targetElement.getAttribute('onclick') || targetElement.onclick.toString();
            const urlMatch = onclickStr.match(/(?:window\.location|location\.href)\s*=\s*['"]([^'"]+)['"]/);
            if (urlMatch) {
              url = urlMatch[1];
            }
          }
          
          // If no URL found, use current page URL
          if (!url) {
            url = window.location.href;
            console.warn('[Recording Script] ⚠️ No URL found in element, using current page URL:', url);
          }
          
          // Build locator candidates using the new smart system
          const locatorCandidates = buildLocatorCandidates(targetElement);
          
          // Add URL candidate as first option
          const urlCandidate = {
            selector: url,
            type: 'url',
            unique: true,
            matchCount: 1,
            stabilityScore: 70,
            description: 'Direct navigation to URL',
            seleniumExample: 'driver.get("' + url + '");',
            playwrightExample: 'await page.goto("' + url + '");'
          };
          locatorCandidates.unshift(urlCandidate);
          
          // Determine primary locator index (prefer non-URL unique candidates)
          const primaryLocatorIndex = getPrimaryLocatorIndex(locatorCandidates, true); // excludeUrl = true
          
          // Show selection dialog with smart candidates (reuse page-level function)
          showNavigateSelectorDialog(locatorCandidates, url, primaryLocatorIndex, targetElement);
        }
        
        // Function to show selector selection dialog for navigation (context-level) - uses same implementation as page-level
        function showNavigateSelectorDialog(locatorCandidates, url, primaryLocatorIndex, targetElement) {
          // Remove existing dialogs
          const existingDialog = document.getElementById('zero-code-navigate-selector-dialog');
          if (existingDialog) {
            existingDialog.remove();
          }
          
          // Create overlay
          const overlay = document.createElement('div');
          overlay.id = 'zero-code-navigate-selector-overlay';
          overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 1000001; display: flex; align-items: center; justify-content: center;';
          
          // Create dialog
          const dialog = document.createElement('div');
          dialog.id = 'zero-code-navigate-selector-dialog';
          dialog.style.cssText = 'background: #1a1f2e; border: 2px solid #5aa9ff; border-radius: 12px; padding: 24px; max-width: 900px; max-height: 85vh; overflow-y: auto; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #e1e8ed; box-shadow: 0 8px 32px rgba(0,0,0,0.6);';
          
          // Header
          const header = document.createElement('div');
          header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid #2a3441;';
          
          const title = document.createElement('h3');
          title.textContent = '🌐 Select Navigation Method';
          title.style.cssText = 'margin: 0; font-size: 20px; font-weight: 600; color: #5aa9ff;';
          
          const closeBtn = document.createElement('button');
          closeBtn.textContent = '✕';
          closeBtn.style.cssText = 'background: transparent; border: none; color: #e1e8ed; font-size: 24px; cursor: pointer; padding: 0; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 4px; transition: background 0.2s;';
          closeBtn.onmouseenter = () => { closeBtn.style.background = 'rgba(255,255,255,0.1)'; };
          closeBtn.onmouseleave = () => { closeBtn.style.background = 'transparent'; };
          closeBtn.onclick = (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();
            setTimeout(() => {
              if (dialog.parentElement) dialog.remove();
              if (overlay.parentElement) overlay.remove();
            }, 100);
          };
          
          header.appendChild(title);
          header.appendChild(closeBtn);
          dialog.appendChild(header);
          
          // URL section
          const urlSection = document.createElement('div');
          urlSection.style.cssText = 'margin-bottom: 20px; padding: 12px; background: rgba(90, 169, 255, 0.1); border-radius: 8px; border-left: 3px solid #5aa9ff;';
          
          const urlLabel = document.createElement('div');
          urlLabel.textContent = '📍 Navigation URL:';
          urlLabel.style.cssText = 'font-size: 12px; color: #9ca3af; margin-bottom: 6px; font-weight: 600;';
          
          const urlValue = document.createElement('div');
          urlValue.textContent = url;
          urlValue.style.cssText = 'font-size: 14px; color: #5aa9ff; word-break: break-all; font-family: monospace;';
          
          urlSection.appendChild(urlLabel);
          urlSection.appendChild(urlValue);
          dialog.appendChild(urlSection);
          
          // Instructions
          const instructions = document.createElement('div');
          instructions.textContent = 'Select a locator method to use for navigation:';
          instructions.style.cssText = 'font-size: 14px; color: #9ca3af; margin-bottom: 16px;';
          dialog.appendChild(instructions);
          
          // Selected index tracking
          let selectedIndex = primaryLocatorIndex || 0;
          
          // Locator candidate cards (same implementation as page-level)
          const optionsContainer = document.createElement('div');
          optionsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px;';
          
          locatorCandidates.forEach((candidate, index) => {
            const isRecommended = index === primaryLocatorIndex && candidate.type !== 'url';
            const isSelected = index === selectedIndex;
            
            const optionCard = document.createElement('div');
            optionCard.style.cssText = 'padding: 16px; background: rgba(42, 52, 65, 0.5); border: 2px solid ' + (isRecommended ? '#10b981' : isSelected ? '#5aa9ff' : 'rgba(90, 169, 255, 0.3)') + '; border-radius: 8px; cursor: pointer; transition: all 0.2s; position: relative;';
            optionCard.setAttribute('data-candidate-card', 'true');
            optionCard.setAttribute('data-candidate-index', index);
            
            // Recommended badge
            if (isRecommended) {
              const recommendedBadge = document.createElement('div');
              recommendedBadge.textContent = '⭐ Recommended';
              recommendedBadge.style.cssText = 'position: absolute; top: 8px; right: 8px; font-size: 10px; color: #10b981; font-weight: 600; padding: 4px 8px; background: rgba(16, 185, 129, 0.2); border-radius: 4px;';
              optionCard.appendChild(recommendedBadge);
            }
            
            // Selection indicator (will be updated dynamically)
            const selectedIndicator = document.createElement('div');
            selectedIndicator.style.cssText = 'position: absolute; top: 8px; left: 8px; width: 20px; height: 20px; background: ' + (isSelected ? '#5aa9ff' : 'transparent') + '; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: bold; border: 2px solid ' + (isSelected ? '#5aa9ff' : 'rgba(90, 169, 255, 0.3)') + ';';
            if (isSelected) selectedIndicator.textContent = '✓';
            optionCard.appendChild(selectedIndicator);
            
            optionCard.onmouseenter = () => {
              if (!isSelected) {
                optionCard.style.background = 'rgba(90, 169, 255, 0.2)';
                optionCard.style.borderColor = '#5aa9ff';
              }
            };
            optionCard.onmouseleave = () => {
              if (!isSelected) {
                optionCard.style.background = 'rgba(42, 52, 65, 0.5)';
                optionCard.style.borderColor = isRecommended ? '#10b981' : 'rgba(90, 169, 255, 0.3)';
              }
            };
            
            optionCard.onclick = (e) => {
              e.stopPropagation();
              e.stopImmediatePropagation();
              e.preventDefault();
              
              // Update selected index
              selectedIndex = index;
              
              // Update all cards' visual selection
              optionsContainer.querySelectorAll('div[data-candidate-card]').forEach((card) => {
                const cardIndex = parseInt(card.getAttribute('data-candidate-index'));
                const isRec = cardIndex === primaryLocatorIndex && locatorCandidates[cardIndex].type !== 'url';
                const isCardSelected = cardIndex === index;
                const indicator = card.querySelector('div:first-child');
                
                if (isCardSelected) {
                  card.style.borderColor = '#5aa9ff';
                  card.style.background = 'rgba(90, 169, 255, 0.2)';
                  if (indicator) {
                    indicator.style.background = '#5aa9ff';
                    indicator.style.borderColor = '#5aa9ff';
                    indicator.textContent = '✓';
                  }
                } else {
                  card.style.borderColor = isRec ? '#10b981' : 'rgba(90, 169, 255, 0.3)';
                  card.style.background = 'rgba(42, 52, 65, 0.5)';
                  if (indicator) {
                    indicator.style.background = 'transparent';
                    indicator.style.borderColor = 'rgba(90, 169, 255, 0.3)';
                    indicator.textContent = '';
                  }
                }
              });
            };
            
            // Type badge with color coding
            const typeColors = {
              'id': '#10b981', 'data-testid': '#10b981', 'data-id': '#3b82f6',
              'role+text': '#8b5cf6', 'smart-path': '#06b6d4', 'text': '#ec4899',
              'name': '#f59e0b', 'aria': '#f59e0b', 'css': '#6366f1',
              'xpath': '#6b7280', 'url': '#9ca3af'
            };
            const typeColor = typeColors[candidate.type] || '#6b7280';
            
            const typeBadge = document.createElement('span');
            typeBadge.textContent = candidate.type.toUpperCase() + (candidate.unique ? ' (unique)' : ' (' + candidate.matchCount + ' matches)');
            typeBadge.style.cssText = 'font-size: 10px; color: white; font-weight: 600; padding: 4px 8px; background: ' + typeColor + '; border-radius: 4px; display: inline-block; margin-bottom: 8px;';
            
            const headerRow = document.createElement('div');
            headerRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;';
            headerRow.appendChild(typeBadge);
            
            const stabilityBadge = document.createElement('span');
            stabilityBadge.textContent = 'Stability: ' + candidate.stabilityScore;
            stabilityBadge.style.cssText = 'font-size: 10px; color: #9ca3af; padding: 2px 6px; background: rgba(156, 163, 175, 0.2); border-radius: 4px;';
            headerRow.appendChild(stabilityBadge);
            optionCard.appendChild(headerRow);
            
            const desc = document.createElement('div');
            desc.textContent = candidate.description;
            desc.style.cssText = 'font-size: 13px; color: #e1e8ed; font-weight: 500; margin-bottom: 8px;';
            optionCard.appendChild(desc);
            
            const selectorValue = document.createElement('div');
            selectorValue.textContent = candidate.selector;
            selectorValue.style.cssText = 'font-size: 11px; color: #5aa9ff; font-family: monospace; background: rgba(0,0,0,0.3); padding: 6px; border-radius: 4px; word-break: break-all; margin-bottom: 8px;';
            optionCard.appendChild(selectorValue);
            
            // Code examples (collapsible)
            const codeToggle = document.createElement('div');
            codeToggle.textContent = '📝 Show code examples';
            codeToggle.style.cssText = 'font-size: 11px; color: #9ca3af; cursor: pointer; margin-bottom: 4px; text-decoration: underline;';
            
            const codeContainer = document.createElement('div');
            codeContainer.style.cssText = 'display: none; margin-top: 8px; padding: 8px; background: rgba(0,0,0,0.3); border-radius: 4px; font-size: 10px;';
            
            let codeExpanded = false;
            codeToggle.onclick = (e) => {
              e.stopPropagation();
              codeExpanded = !codeExpanded;
              codeContainer.style.display = codeExpanded ? 'block' : 'none';
              codeToggle.textContent = codeExpanded ? '📝 Hide code examples' : '📝 Show code examples';
            };
            
            const seleniumLabel = document.createElement('div');
            seleniumLabel.textContent = 'Selenium:';
            seleniumLabel.style.cssText = 'color: #9ca3af; margin-bottom: 4px; font-weight: 600;';
            codeContainer.appendChild(seleniumLabel);
            
            const seleniumCode = document.createElement('div');
            seleniumCode.textContent = candidate.seleniumExample || 'N/A';
            seleniumCode.style.cssText = 'color: #5aa9ff; font-family: monospace; margin-bottom: 8px; word-break: break-all;';
            codeContainer.appendChild(seleniumCode);
            
            const playwrightLabel = document.createElement('div');
            playwrightLabel.textContent = 'Playwright:';
            playwrightLabel.style.cssText = 'color: #9ca3af; margin-bottom: 4px; font-weight: 600;';
            codeContainer.appendChild(playwrightLabel);
            
            const playwrightCode = document.createElement('div');
            playwrightCode.textContent = candidate.playwrightExample || 'N/A';
            playwrightCode.style.cssText = 'color: #5aa9ff; font-family: monospace; word-break: break-all;';
            codeContainer.appendChild(playwrightCode);
            
            optionCard.appendChild(codeToggle);
            optionCard.appendChild(codeContainer);
            optionsContainer.appendChild(optionCard);
          });
          
          dialog.appendChild(optionsContainer);
          
          // Use button
          const useBtn = document.createElement('button');
          useBtn.textContent = 'Use Selected Locator';
          useBtn.style.cssText = 'width: 100%; padding: 12px; background: #5aa9ff; border: none; border-radius: 6px; color: white; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; margin-bottom: 10px;';
          useBtn.onmouseenter = () => { useBtn.style.background = '#4a99ef'; };
          useBtn.onmouseleave = () => { useBtn.style.background = '#5aa9ff'; };
          useBtn.onclick = (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();
            
            const selectedCandidate = locatorCandidates[selectedIndex];
            recordNavigateAction(url, selectedCandidate, locatorCandidates, selectedIndex, targetElement);
            
            setTimeout(() => {
              if (dialog.parentElement) dialog.remove();
              if (overlay.parentElement) overlay.remove();
            }, 100);
          };
          dialog.appendChild(useBtn);
          
          // Cancel button
          const cancelBtn = document.createElement('button');
          cancelBtn.textContent = 'Cancel';
          cancelBtn.style.cssText = 'width: 100%; padding: 12px; background: rgba(107, 114, 128, 0.3); border: 1px solid #6b7280; border-radius: 6px; color: #e1e8ed; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s;';
          cancelBtn.onmouseenter = () => { cancelBtn.style.background = 'rgba(107, 114, 128, 0.5)'; };
          cancelBtn.onmouseleave = () => { cancelBtn.style.background = 'rgba(107, 114, 128, 0.3)'; };
          cancelBtn.onclick = (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();
            setTimeout(() => {
              if (dialog.parentElement) dialog.remove();
              if (overlay.parentElement) overlay.remove();
            }, 100);
          };
          dialog.appendChild(cancelBtn);
          
          overlay.appendChild(dialog);
          document.body.appendChild(overlay);
          
          // Prevent clicks inside dialog from bubbling to document
          dialog.onclick = (e) => {
            e.stopPropagation();
          };
          
          // Close on overlay click (but not on dialog click)
          overlay.onclick = (e) => {
            if (e.target === overlay) {
              e.stopPropagation();
              e.stopImmediatePropagation();
              setTimeout(() => {
                if (dialog.parentElement) dialog.remove();
                if (overlay.parentElement) overlay.remove();
              }, 100);
            }
          };
        }
        
        // Function to record navigate action after selection (context-level) - using locator candidates
        function recordNavigateAction(url, selectedCandidate, locatorCandidates, primaryLocatorIndex, targetElement) {
          // Extract element metadata
          const metadata = extractElementMetadata(targetElement);
          
          // Create navigate action with locator candidates
          const navigateAction = {
            sessionId: SESSION_ID,
            kind: 'navigate',
            url: url,
            selector: selectedCandidate.selector,
            locatorCandidates: locatorCandidates,
            primaryLocatorIndex: primaryLocatorIndex,
            timestamp: Date.now(),
            ...metadata
          };
          
          console.log('[Recording Script] 📍 Navigate action (selected):', navigateAction);
          
          // Send navigate action to server
          try {
            const response = await fetch(API_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(navigateAction)
            });
            
            if (response.ok) {
              console.log('[Recording Script] ✅ Navigate action sent successfully:', navigateAction);
            } else {
              console.error('[Recording Script] ❌ Navigate action failed:', response.status, response.statusText);
            }
            
            const data = await response.json();
            console.log('[Recording Script] Server response:', data);
          } catch (error) {
            console.error('[Recording Script] ❌ Failed to send navigate action:', error);
          }
        }
        
        // Helper function to show locator path in a container (context-level)
        function showLocatorPathInContainer(container, locatorPath, fullSelectorPath) {
          if (fullSelectorPath) {
            const fullPathSection = document.createElement('div');
            fullPathSection.style.cssText = 'margin-bottom: 12px; padding: 8px; background: rgba(90, 169, 255, 0.1); border-radius: 6px;';
            
            const fullPathLabel = document.createElement('div');
            fullPathLabel.textContent = '🔗 Full Selector Path:';
            fullPathLabel.style.cssText = 'font-size: 11px; color: #9ca3af; margin-bottom: 4px;';
            
            const fullPathValue = document.createElement('div');
            fullPathValue.textContent = fullSelectorPath;
            fullPathValue.style.cssText = 'font-size: 12px; color: #5aa9ff; word-break: break-all; font-family: monospace;';
            
            fullPathSection.appendChild(fullPathLabel);
            fullPathSection.appendChild(fullPathValue);
            container.appendChild(fullPathSection);
          }
          
          if (locatorPath && locatorPath.length > 0) {
            locatorPath.forEach((item, index) => {
              const pathItem = document.createElement('div');
              pathItem.style.cssText = 'padding: 8px; background: rgba(42, 52, 65, 0.5); border-radius: 4px; margin-bottom: 6px; font-size: 11px;';
              
              const pathText = document.createElement('span');
              pathText.textContent = (index + 1) + '. ' + item.tag.toUpperCase() + ' → ' + item.locator;
              pathText.style.cssText = 'color: #5aa9ff; font-family: monospace;';
              
              pathItem.appendChild(pathText);
              container.appendChild(pathItem);
            });
          }
        }
        
        // Ensure script runs after DOM is ready
        let contextMenuListenerAttached = false;
        let contextMenuHandlers = { document: null, window: null };
        
        function attachContextMenuListener() {
          if (contextMenuListenerAttached) {
            console.log('[Recording Script] ⚠️ Context menu listener already attached, skipping duplicate attachment');
            return;
          }
          
          // Remove existing listeners if any (safety check)
          if (contextMenuHandlers.document) {
            document.removeEventListener('contextmenu', contextMenuHandlers.document, true);
          }
          if (contextMenuHandlers.window) {
            window.removeEventListener('contextmenu', contextMenuHandlers.window, true);
          }
          
          // Create handler functions
          const documentHandler = (e) => {
            try {
              console.log('[Recording Script] 🔵 Right-click detected!', {
                target: e.target?.tagName,
                clientX: e.clientX,
                clientY: e.clientY
              });
              // CRITICAL: Prevent default browser context menu
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              const element = e.target;
              showContextMenu(e.clientX, e.clientY, element);
              return false;
            } catch (err) {
              console.error('[Recording Script] ❌ Error in context menu handler:', err);
              // Don't let errors break recording - still prevent default menu
              e.preventDefault();
              e.stopPropagation();
              return false;
            }
          };
          
          const windowHandler = (e) => {
            try {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              const element = e.target;
              showContextMenu(e.clientX, e.clientY, element);
              return false;
            } catch (err) {
              console.error('[Recording Script] ❌ Error in window context menu handler:', err);
              e.preventDefault();
              e.stopPropagation();
              return false;
            }
          };
          
          // Store handlers for potential removal
          contextMenuHandlers.document = documentHandler;
          contextMenuHandlers.window = windowHandler;
          
          // Attach listeners
          document.addEventListener('contextmenu', documentHandler, true); // Use capture phase to intercept early
          window.addEventListener('contextmenu', windowHandler, true);
          
          contextMenuListenerAttached = true;
          console.log('[Recording Script] ✅ Context menu listener attached successfully (document + window)');
        }
        
        function initializeRecording() {
          // Create context menu immediately
          createContextMenu();
          
          // Attach context menu listener
          attachContextMenuListener();
          
          console.log('[Recording Script] ✅ Recording initialized - context menu ready');
        }
        
        // Make initializeRecording available globally for page-level injection
        window.initializeRecording = initializeRecording;
        
        // Run immediately if DOM is ready, otherwise wait
        if (document.readyState === 'loading') {
          console.log('[Recording Script] DOM is loading, waiting for DOMContentLoaded...');
          document.addEventListener('DOMContentLoaded', () => {
            console.log('[Recording Script] DOMContentLoaded fired, initializing...');
            initializeRecording();
          });
        } else {
          console.log('[Recording Script] DOM already ready, initializing immediately...');
          initializeRecording();
        }
        
        // Also try after a short delay as backup
        setTimeout(() => {
          if (!document.getElementById('zero-code-context-menu')) {
            console.log('[Recording Script] ⚠️ Context menu not found after delay, re-initializing...');
            initializeRecording();
          }
        }, 1000);
        
        // Re-attach on page load for SPA navigation (with guard to prevent duplicates)
        window.addEventListener('load', () => {
          try {
            if (!document.getElementById('zero-code-context-menu')) {
              createContextMenu();
            }
            // Only re-attach if not already attached
            if (!contextMenuListenerAttached) {
              attachContextMenuListener();
              console.log('[Recording Script] ✅ Context menu re-initialized on page load');
            } else {
              console.log('[Recording Script] ⚠️ Context menu listener already attached, skipping re-initialization');
            }
          } catch (err) {
            console.error('[Recording Script] ❌ Error re-initializing context menu on page load:', err);
          }
        }, { once: true }); // Use once to prevent multiple attachments
        
        // Hide menu on click outside
        document.addEventListener('click', (e) => {
          // Don't hide menu if clicking on navigation selector dialog or overlay
          const navigateDialog = document.getElementById('zero-code-navigate-selector-dialog');
          const navigateOverlay = document.getElementById('zero-code-navigate-selector-overlay');
          if (navigateDialog && (navigateDialog.contains(e.target) || navigateDialog === e.target)) {
            return; // Don't hide menu or record clicks on the dialog
          }
          if (navigateOverlay && (navigateOverlay.contains(e.target) || navigateOverlay === e.target)) {
            return; // Don't hide menu or record clicks on the overlay
          }
          
          if (contextMenu && !contextMenu.contains(e.target)) {
            hideContextMenu();
          }
        }, true);
        
        // Hide menu on scroll
        document.addEventListener('scroll', hideContextMenu, true);
        
        // Note: Scroll recording is handled by page-level injection (see setupPageEventHandlers)
        // This ensures we have access to all helper functions (buildLocatorCandidates, etc.)
        // and can properly detect scroll modes (element, bottom, top, y position)
        
        // Record clicks
        document.addEventListener('click', (e) => {
          console.log('[Recording Script] 🖱️ Click event detected on:', e.target.tagName, e.target);
          
          if (contextMenu && contextMenu.style.display !== 'none') {
            console.log('[Recording Script] ⏭️ Skipping click - context menu was open');
            return; // Don't record click if menu was open
          }
          
          // Normalize to clickable element (e.g., if clicking on span inside button, get the button)
          const clickableElement = getClickableElement(e.target);
          if (!clickableElement) {
            console.warn('[Recording Script] ⚠️ Could not determine clickable element');
            return;
          }
          
          let selector = getElementSelector(clickableElement);
          if (!selector) {
            console.warn('[Recording Script] ⚠️ No selector found for clicked element:', clickableElement);
            return;
          }
          
          // Reject generic selectors without context
          const genericTags = ['span', 'div', 'p', 'a', 'button', 'input', 'body'];
          if (genericTags.includes(selector)) {
            console.warn('[Recording Script] ⚠️ Rejected generic selector, trying to refine...');
            // Try to get a better selector with context - use getAllSelectorStrategies to find alternatives
            const allStrategies = getAllSelectorStrategies(clickableElement);
            const betterSelector = allStrategies.find(s => {
              const sel = s.value;
              return sel && !genericTags.includes(sel) && !sel.startsWith('text=' + sel);
            });
            if (betterSelector && !genericTags.includes(betterSelector.value)) {
              selector = betterSelector.value;
            } else {
              console.warn('[Recording Script] ⚠️ Could not find better selector, skipping click');
              return;
            }
          }
          
          console.log('[Recording Script] ✅ Click selector found:', selector);
          
          // Get all selector strategies for fallback
          const allClickStrategies = getAllSelectorStrategies(clickableElement);
          const fallbackSelectors = allClickStrategies.map(s => s.value).filter(s => s !== selector);
          
          // Check selector uniqueness
          const uniqueness = checkSelectorUniqueness(selector, clickableElement);
          
          // Extract element metadata for better normalization
          const metadata = extractElementMetadata(clickableElement);
          
          const clickData = {
            sessionId: SESSION_ID,
            kind: 'click',
            selector: selector,
            fallbackSelectors: fallbackSelectors, // Store all fallback selectors
            timestamp: Date.now(),
            selectorUniqueness: {
              unique: uniqueness.unique,
              count: uniqueness.count,
              suggestions: uniqueness.suggestions || []
            },
            // Add metadata for normalization
            ...metadata
          };
          
          if (!uniqueness.unique && uniqueness.count > 1) {
            console.warn('[Recording Script] ⚠️ Selector matches', uniqueness.count, 'elements:', selector);
            if (uniqueness.suggestions && uniqueness.suggestions.length > 0) {
              console.warn('[Recording Script] 💡 Consider using:', uniqueness.suggestions[0]);
            }
          }
          
          console.log('[Recording Script] Sending click action:', clickData);
          
          fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(clickData)
          })
          .then(resp => {
            if (!resp.ok) {
              console.error('[Recording Script] ❌ Click action failed:', resp.status, resp.statusText);
              return resp.text().then(text => {
                console.error('[Recording Script] Error response:', text);
              });
            } else {
              console.log('[Recording Script] ✅ Click action sent successfully');
            }
          })
          .catch(err => console.error('[Recording Script] ❌ Failed to send click:', err));
        }, true);
        
        // Debounce typing - only record final value after user stops typing
        const typeDebounceTimers = new Map(); // selector -> timer
        const TYPE_DEBOUNCE_MS = 600; // 600ms for better stability (prevents duplicate recordings)
        
        // Helper function to extract element metadata for better normalization
        function extractElementMetadata(element) {
          if (!element) return {};
          
          // Get textContent - includes text from all child elements
          let textContent = '';
          if (element.textContent) {
            textContent = element.textContent.trim();
          }
          // If no textContent, try innerText (more reliable for visible text)
          if (!textContent && element.innerText) {
            textContent = element.innerText.trim();
          }
          // If still no text, try to get text from first text node child
          if (!textContent && element.firstChild && element.firstChild.nodeType === 3) {
            textContent = element.firstChild.textContent.trim();
          }
          
          return {
            tagName: element.tagName || '',
            id: element.id || '',
            name: element.name || '',
            placeholder: element.placeholder || '',
            ariaLabel: element.getAttribute('aria-label') || '',
            title: element.title || '',
            textContent: textContent,
            value: element.value || '',
            type: element.type || '',
            dataTestId: element.getAttribute('data-testid') || '',
            className: (element.className && typeof element.className === 'string' ? element.className : '') || ''
          };
        }
        
        // Helper function to send type action
        function sendTypeAction(element, reason = 'debounced') {
          if (!element) {
            console.warn('[Recording Script] ⚠️ No element provided for type action');
            return;
          }
          
          // For input elements, prioritize id, name, placeholder, aria-label
          // Don't normalize to clickable element for inputs (they are already the target)
          let selector = getElementSelector(element);
          if (!selector) {
            console.warn('[Recording Script] ⚠️ No selector found for input element');
            return;
          }
          
          // Reject generic input selector without context
          if (selector === 'input') {
            console.warn('[Recording Script] ⚠️ Rejected generic input selector, trying to refine...');
            // Try to get a better selector - use getAllSelectorStrategies to find alternatives
            const allStrategies = getAllSelectorStrategies(element);
            const betterSelector = allStrategies.find(s => {
              const sel = s.value;
              return sel && sel !== 'input' && !sel.startsWith('text=input');
            });
            if (betterSelector && betterSelector.value !== 'input') {
              selector = betterSelector.value;
            } else {
              // Try placeholder, name, or parent context
              if (element.placeholder) {
                selector = '[placeholder="' + element.placeholder + '"]';
              } else if (element.name) {
                selector = '[name="' + element.name + '"]';
              } else if (element.parentElement && element.parentElement.id) {
                selector = '#' + element.parentElement.id + ' input';
              } else {
                console.warn('[Recording Script] ⚠️ Could not find better selector for input, skipping');
                return;
              }
            }
          }
          
          // Get all selector strategies for fallback
          const allStrategies = getAllSelectorStrategies(element);
          const fallbackSelectors = allStrategies.map(s => s.value).filter(s => s !== selector);
          
          // Extract element metadata for better normalization
          const metadata = extractElementMetadata(element);
          
              const typeData = {
                sessionId: SESSION_ID,
                kind: 'type',
                selector: selector,
            fallbackSelectors: fallbackSelectors,
            value: element.value || '', // Final value
            timestamp: Date.now(),
            // Add metadata for normalization
            ...metadata
          };
          
          console.log('[Recording Script] 📝 Sending type action (' + reason + '):', typeData);
              
              fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(typeData)
              })
              .then(resp => {
                if (!resp.ok) {
                  console.error('[Recording Script] ❌ Type action failed:', resp.status, resp.statusText);
                  return resp.text().then(text => {
                    console.error('[Recording Script] Error response:', text);
                  });
                } else {
                  console.log('[Recording Script] ✅ Type action sent successfully');
                }
              })
              .catch(err => console.error('[Recording Script] ❌ Failed to send input:', err));
        }
        
        // Record typing with debouncing
        document.addEventListener('input', (e) => {
          console.log('[Recording Script] ⌨️ Input event detected on:', e.target.tagName, 'value:', e.target.value);
          
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
            let selector = getElementSelector(e.target);
            if (!selector) {
              console.warn('[Recording Script] ⚠️ No selector found for input element:', e.target);
              return;
            }
            
            // Reject generic input selector without context
            if (selector === 'input' || selector === 'textarea') {
              const allStrategies = getAllSelectorStrategies(e.target);
              const betterSelector = allStrategies.find(s => {
                const sel = s.value;
                return sel && sel !== 'input' && sel !== 'textarea';
              });
              if (betterSelector) {
                selector = betterSelector.value;
              } else if (e.target.placeholder) {
                selector = '[placeholder="' + e.target.placeholder + '"]';
              } else if (e.target.name) {
                selector = '[name="' + e.target.name + '"]';
              } else if (e.target.parentElement && e.target.parentElement.id) {
                selector = '#' + e.target.parentElement.id + ' ' + e.target.tagName.toLowerCase();
              } else {
                console.warn('[Recording Script] ⚠️ Could not find better selector for input, skipping');
                return;
              }
            }
            
            console.log('[Recording Script] ✅ Input selector found:', selector, 'value length:', (e.target.value || '').length);
            
            // Clear existing timer for this selector
            if (typeDebounceTimers.has(selector)) {
              clearTimeout(typeDebounceTimers.get(selector));
            }
            
            // Set new timer to send action after user stops typing
            const timer = setTimeout(() => {
              sendTypeAction(e.target, 'debounced');
              typeDebounceTimers.delete(selector);
            }, TYPE_DEBOUNCE_MS);
            
            typeDebounceTimers.set(selector, timer);
          }
        }, true);
        
        // Also handle blur event to capture final value when user leaves the field
        document.addEventListener('blur', (e) => {
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
            let selector = getElementSelector(e.target);
            if (!selector) return;
            
            // Reject generic selectors
            if (selector === 'input' || selector === 'textarea') {
              const allStrategies = getAllSelectorStrategies(e.target);
              const betterSelector = allStrategies.find(s => {
                const sel = s.value;
                return sel && sel !== 'input' && sel !== 'textarea';
              });
              if (betterSelector) {
                selector = betterSelector.value;
              } else if (e.target.placeholder) {
                selector = '[placeholder="' + e.target.placeholder + '"]';
              } else if (e.target.name) {
                selector = '[name="' + e.target.name + '"]';
              } else {
                return; // Skip if no good selector
              }
            }
            
            // Clear timer and send immediately if there's a pending timer
            if (typeDebounceTimers.has(selector)) {
              clearTimeout(typeDebounceTimers.get(selector));
              typeDebounceTimers.delete(selector);
              // Only send if there's actually a value
              if (e.target.value && e.target.value.trim().length > 0) {
                sendTypeAction(e.target, 'on blur');
              }
            }
          }
        }, true);
        
        // Also capture Enter key press in input fields (for search, forms, etc.)
        document.addEventListener('keydown', (e) => {
          if ((e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') && e.key === 'Enter') {
            let selector = getElementSelector(e.target);
            if (!selector) return;
            
            // Reject generic selectors
            if (selector === 'input' || selector === 'textarea') {
              const allStrategies = getAllSelectorStrategies(e.target);
              const betterSelector = allStrategies.find(s => {
                const sel = s.value;
                return sel && sel !== 'input' && sel !== 'textarea';
              });
              if (betterSelector) {
                selector = betterSelector.value;
              } else if (e.target.placeholder) {
                selector = '[placeholder="' + e.target.placeholder + '"]';
              } else if (e.target.name) {
                selector = '[name="' + e.target.name + '"]';
              } else {
                return; // Skip if no good selector
              }
            }
            
            // Clear any pending timer and send immediately
            if (typeDebounceTimers.has(selector)) {
              clearTimeout(typeDebounceTimers.get(selector));
              typeDebounceTimers.delete(selector);
            }
            
            // Send type action immediately on Enter (for search, form submission, etc.)
            if (e.target.value && e.target.value.trim().length > 0) {
              sendTypeAction(e.target, 'on Enter key');
            }
          }
        }, true);
        
        // Record dropdown/select changes
        document.addEventListener('change', (e) => {
          if (e.target.tagName === 'SELECT') {
            let selector = getElementSelector(e.target);
            if (!selector) return;
            
            // Reject generic select selector
            if (selector === 'select') {
              const allStrategies = getAllSelectorStrategies(e.target);
              const betterSelector = allStrategies.find(s => {
                const sel = s.value;
                return sel && sel !== 'select';
              });
              if (betterSelector) {
                selector = betterSelector.value;
              } else if (e.target.name) {
                selector = '[name="' + e.target.name + '"]';
              } else if (e.target.id) {
                selector = '#' + e.target.id;
              } else if (e.target.parentElement && e.target.parentElement.id) {
                selector = '#' + e.target.parentElement.id + ' select';
              } else {
                return; // Skip if no good selector
              }
            }
            
            const selectedOption = e.target.options[e.target.selectedIndex];
            const selectedText = selectedOption ? selectedOption.text : '';
            const selectedValue = e.target.value;
            
            // Get all selector strategies for fallback
            const allStrategies = getAllSelectorStrategies(e.target);
            const fallbackSelectors = allStrategies.map(s => s.value).filter(s => s !== selector);
            
            const selectData = {
              sessionId: SESSION_ID,
              kind: 'select',
              selector: selector,
              fallbackSelectors: fallbackSelectors, // Store all fallback selectors
              value: selectedValue,
              selectedText: selectedText,
              timestamp: Date.now()
            };
            
            console.log('[Recording Script] Sending select action:', selectData);
            
            fetch(API_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(selectData)
            })
            .then(resp => {
              if (!resp.ok) {
                console.error('[Recording Script] ❌ Select action failed:', resp.status, resp.statusText);
                return resp.text().then(text => {
                  console.error('[Recording Script] Error response:', text);
                });
              } else {
                console.log('[Recording Script] ✅ Select action sent successfully');
              }
            })
            .catch(err => console.error('[Recording Script] ❌ Failed to send select:', err));
          }
        }, true);
        
        // Record keyboard key presses (special keys like Enter, Tab, Escape, Arrow keys, etc.)
        // Track last key press to avoid duplicates
        let lastKeyPress = { key: null, timestamp: 0 };
        const KEY_PRESS_DEBOUNCE_MS = 100; // Debounce key presses
        
        // List of special keys to record (not regular text input)
        const SPECIAL_KEYS = [
          'Enter', 'Tab', 'Escape', 'Esc', 'Backspace', 'Delete', 'Insert',
          'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
          'Home', 'End', 'PageUp', 'PageDown',
          'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
          'Control', 'Alt', 'Shift', 'Meta', 'CapsLock',
          'Space' // Space key when not in input field
        ];
        
        document.addEventListener('keydown', (e) => {
          // Skip if it's a regular text input (we capture that via 'input' event)
          const isTextInput = e.target.tagName === 'INPUT' || 
                             e.target.tagName === 'TEXTAREA' || 
                             e.target.isContentEditable;
          
          // Only record special keys, or Space key when not in text input
          const key = e.key || e.code;
          const isSpecialKey = SPECIAL_KEYS.includes(key) || 
                              key.startsWith('Arrow') || 
                              key.startsWith('F') ||
                              (key === ' ' && !isTextInput);
          
          if (!isSpecialKey) return;
          
          // Debounce: avoid recording same key multiple times quickly
          const now = Date.now();
          if (lastKeyPress.key === key && (now - lastKeyPress.timestamp) < KEY_PRESS_DEBOUNCE_MS) {
            return;
          }
          lastKeyPress = { key: key, timestamp: now };
          
          // Get selector for the focused element
          const selector = getElementSelector(e.target) || 'body';
          
          // Normalize key name
          let normalizedKey = key;
          if (key === ' ') normalizedKey = 'Space';
          if (key === 'Esc') normalizedKey = 'Escape';
          
          fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: SESSION_ID,
              kind: 'keyPress',
              key: normalizedKey,
              value: normalizedKey, // For compatibility
              selector: selector,
              timestamp: now
            })
          }).catch(err => console.error('Failed to send keyPress:', err));
        }, true);
        
        // ============================================================
        // TIER 1 — additional action capture (T1.1, T1.2, T1.3, T1.5,
        // T1.6, T1.7, T1.10). Each new listener follows the same pattern
        // as the click/type/select listeners above: event handler → build
        // payload with the action kind → POST to API_URL. All registered with
        // capture=true so we see events before any page handler can call
        // stopPropagation. Inserted ABOVE the navigation block so the
        // navigation poller stays the last thing in the IIFE.
        // ============================================================

        // Generic "send to recorder" helper for the new handlers. Keeps
        // each listener body small and uniform.
        function __zacSend(action) {
          try {
            fetch(API_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(Object.assign({ sessionId: SESSION_ID, timestamp: Date.now() }, action)),
            }).catch(function (e) { console.warn('[Recording] send failed for', action.kind, e); });
          } catch (e) {
            console.warn('[Recording] send threw for', action.kind, e);
          }
        }

        // ── T1.1 Hover capture ────────────────────────────────────────
        // Debounced per-selector so a single hover doesn't emit a flood of
        // mouseover bubbles. Limited to interactive-looking targets so we
        // don't capture every passing pixel as a step.
        var __zacHoverLast = { sel: null, t: 0 };
        var __ZAC_HOVER_DEBOUNCE_MS = 800;
        document.addEventListener('mouseover', function (e) {
          if (!e.target || !e.target.tagName) return;
          var tag = e.target.tagName.toLowerCase();
          if (tag === 'html' || tag === 'body') return;
          var isInteractive =
            tag === 'a' || tag === 'button' ||
            e.target.getAttribute('role') === 'button' ||
            e.target.getAttribute('role') === 'menuitem' ||
            e.target.hasAttribute('aria-haspopup') ||
            (e.target.title && e.target.title.length > 0) ||
            (e.target.dataset && (e.target.dataset.tooltip || e.target.dataset.toggle));
          if (!isInteractive) return;
          var sel = getElementSelector(e.target);
          if (!sel) return;
          var now = Date.now();
          if (__zacHoverLast.sel === sel && (now - __zacHoverLast.t) < __ZAC_HOVER_DEBOUNCE_MS) return;
          __zacHoverLast = { sel: sel, t: now };
          __zacSend({ kind: 'hover', selector: sel });
        }, true);

        // ── T1.2 Drag-and-drop capture ────────────────────────────────
        // Pair dragstart + drop. Emit one dragDrop step at drop time
        // carrying both source + target selectors. The action's primary
        // selector points at the source so existing locator-healing
        // strategies still apply.
        var __zacDragSource = null;
        document.addEventListener('dragstart', function (e) {
          if (!e.target || !e.target.tagName) return;
          var sel = getElementSelector(e.target);
          if (sel) __zacDragSource = { selector: sel, t: Date.now() };
        }, true);
        document.addEventListener('drop', function (e) {
          if (!__zacDragSource) return;
          var targetSel = e.target ? getElementSelector(e.target) : null;
          if (!targetSel) { __zacDragSource = null; return; }
          __zacSend({
            kind: 'dragDrop',
            selector: __zacDragSource.selector,
            sourceSelector: __zacDragSource.selector,
            targetSelector: targetSel,
          });
          __zacDragSource = null;
        }, true);

        // ── T1.3 File-upload capture (input[type=file]) ───────────────
        // Capture file NAMES + sizes only — not bytes. The IDE's action
        // stream isn't a file pipe and replay engines accept names/paths.
        document.addEventListener('change', function (e) {
          if (!e.target || e.target.tagName !== 'INPUT' || e.target.type !== 'file') return;
          var sel = getElementSelector(e.target);
          if (!sel) return;
          var files = e.target.files
            ? Array.prototype.slice.call(e.target.files).map(function (f) { return { name: f.name, size: f.size, type: f.type }; })
            : [];
          __zacSend({
            kind: 'fileUpload',
            selector: sel,
            files: files,
            value: files.map(function (f) { return f.name; }).join(', '),
          });
        }, true);

        // ── T1.5 + T1.6 Semantic checkbox / radio ─────────────────────
        // The existing change handler above only handles <select>. This
        // ADDITIONAL change handler emits explicit check/uncheck/
        // selectRadio steps for INPUT toggles (instead of the user
        // ending up with an opaque click).
        document.addEventListener('change', function (e) {
          if (!e.target || e.target.tagName !== 'INPUT') return;
          var t = e.target.type;
          var sel = getElementSelector(e.target);
          if (!sel) return;
          if (t === 'checkbox') {
            __zacSend({
              kind: e.target.checked ? 'check' : 'uncheck',
              selector: sel,
              value: !!e.target.checked,
              name: e.target.name || null,
            });
          } else if (t === 'radio' && e.target.checked) {
            __zacSend({
              kind: 'selectRadio',
              selector: sel,
              value: e.target.value || '',
              name: e.target.name || null,
            });
          }
        }, true);

        // ── T1.7 Custom dropdown / ARIA combobox capture ──────────────
        // Modern UIs (Material, Ant, headlessui, custom) are NOT <select>
        // so the change handler can't see them. When the user clicks an
        // item inside a role=listbox/menu, emit a select step naming
        // the owning combobox + the picked option text.
        document.addEventListener('click', function (e) {
          if (!e.target || !e.target.closest) return;
          var opt = e.target.closest(
            '[role="option"], [role="menuitem"], li[role="option"], li[role="menuitem"]'
          );
          if (!opt) return;
          var list = opt.closest('[role="listbox"], [role="menu"]');
          var combobox = null;
          if (list && list.id) {
            combobox = document.querySelector('[aria-controls="' + list.id + '"]');
          }
          if (!combobox) combobox = opt.closest('[role="combobox"]');
          if (!combobox) return; // Not a combobox interaction → existing click handler covers it
          var cbSel = getElementSelector(combobox);
          if (!cbSel) return;
          var optionText = (opt.textContent || '').trim().slice(0, 200);
          __zacSend({
            kind: 'select',
            selector: cbSel,
            value: optionText,
            selectedText: optionText,
            customDropdown: true,
          });
        }, true);

        // ── T3.5 Shadow DOM piercing ─────────────────────────────────
        // When the click target lives inside a shadow root, the bare
        // selector wont match because document.querySelector doesnt
        // pierce shadow boundaries. Walk up getRootNode() from the
        // event target and emit a Playwright shadow-piercing chain
        // (zac-card >> button.primary) that DOES pierce. Filed as a
        // sidecar shadowSelector on the click action so existing
        // primary selector logic stays intact.
        function __zacShadowChain(target) {
          if (!target || !target.getRootNode) return null;
          const chain = [];
          let cur = target;
          let safety = 8;
          while (cur && safety-- > 0) {
            const root = cur.getRootNode && cur.getRootNode();
            if (!root || root === document) break;
            // Inside a shadow root — push a relative selector for cur
            // and jump up to the host's enclosing root.
            const inHost = root.host;
            if (!inHost) break;
            // Local selector inside this shadow root: prefer id, then
            // [data-testid], then tag.
            let local;
            if (cur.id) local = '#' + cur.id;
            else if (cur.getAttribute && cur.getAttribute('data-testid')) {
              local = '[data-testid="' + cur.getAttribute('data-testid') + '"]';
            } else {
              local = cur.tagName ? cur.tagName.toLowerCase() : '*';
            }
            chain.unshift(local);
            // Now walk the host up to the next shadow root or document.
            const hostId = inHost.id ? '#' + inHost.id : (inHost.tagName ? inHost.tagName.toLowerCase() : '*');
            chain.unshift(hostId);
            chain.unshift('>>'); // Playwright shadow piercing combinator
            cur = inHost;
          }
          if (chain.length === 0) return null;
          // Drop the leading '>>' if it ended up first.
          if (chain[0] === '>>') chain.shift();
          return chain.join(' ').replace(/\s+>>\s+/g, ' >> ');
        }
        document.addEventListener('click', function (e) {
          if (!e.target || !e.target.getRootNode) return;
          const root = e.target.getRootNode();
          if (!root || root === document) return; // not in shadow DOM
          const shadowSel = __zacShadowChain(e.target);
          if (!shadowSel) return;
          __zacSend({
            kind: 'click',
            selector: shadowSel,
            shadowSelector: shadowSel,
            shadowDom: true,
          });
        }, true);

        // ── T3.6 iframe deep recording ──────────────────────────────
        // The browser recording script runs at TOP level. When the user
        // clicks INSIDE an iframe, the click event fires INSIDE THE FRAME
        // and never reaches our top-level listener. We can't add cross-
        // origin frame listeners, but we CAN attach to same-origin
        // frames via document.querySelectorAll('iframe') + frame's
        // contentDocument. We do it lazily on each click hint.
        function __zacAttachFrameRecorders() {
          try {
            const frames = document.querySelectorAll('iframe, frame');
            frames.forEach(function (f) {
              if (f.__zacFrameWired) return;
              let doc = null;
              try { doc = f.contentDocument; } catch (_e) { /* cross-origin */ }
              if (!doc) return;
              f.__zacFrameWired = true;
              const frameId = f.id || f.name || (f.src ? f.src.slice(0, 80) : 'frame-' + Date.now());
              doc.addEventListener('click', function (ev) {
                try {
                  const sel = (typeof getElementSelector === 'function')
                    ? getElementSelector(ev.target)
                    : (ev.target && ev.target.id ? '#' + ev.target.id : (ev.target && ev.target.tagName ? ev.target.tagName.toLowerCase() : null));
                  if (!sel) return;
                  __zacSend({
                    kind: 'click',
                    selector: sel,
                    iframe: true,
                    frameId: frameId,
                    frameSelector: f.id ? '#' + f.id : (f.name ? '[name="' + f.name + '"]' : 'iframe'),
                  });
                } catch (_clickErr) { /* swallow */ }
              }, true);
              doc.addEventListener('input', function (ev) {
                try {
                  if (!ev.target || (ev.target.tagName !== 'INPUT' && ev.target.tagName !== 'TEXTAREA')) return;
                  const sel = (typeof getElementSelector === 'function')
                    ? getElementSelector(ev.target)
                    : (ev.target.id ? '#' + ev.target.id : ev.target.tagName.toLowerCase());
                  if (!sel) return;
                  __zacSend({
                    kind: 'type',
                    selector: sel,
                    value: ev.target.value || '',
                    iframe: true,
                    frameId: frameId,
                    frameSelector: f.id ? '#' + f.id : (f.name ? '[name="' + f.name + '"]' : 'iframe'),
                  });
                } catch (_typeErr) { /* swallow */ }
              }, true);
            });
          } catch (_outerErr) { /* swallow */ }
        }
        // Wire on page load + every click (cheap idempotent re-scan
        // via the .__zacFrameWired marker).
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', __zacAttachFrameRecorders);
        } else {
          __zacAttachFrameRecorders();
        }
        document.addEventListener('click', __zacAttachFrameRecorders, true);

        // ── T2.8 Auto-suggested smart assertions ─────────────────────
        // After every meaningful interaction (click, type-blur), propose a
        // soft assertion the user MIGHT want to add as a step:
        //   • after a click on a link/button → assertVisible on the
        //     element OR assertText if it has stable visible text
        //   • after a type-blur on an input → assertValue
        // These are sent with kind:'assertion-suggested' (NOT a real step
        // kind) and a suggested:true flag. The server route handler
        // stashes them on session.suggestions; the IDE can pull them via
        // /api/recording/:id/suggestions and let the user promote/dismiss.
        function __zacEmitAssertion(kind, target, extras) {
          if (!target) return;
          const sel = getElementSelector(target);
          if (!sel) return;
          const action = Object.assign({
            kind: 'assertion-suggested',
            suggestedKind: kind,
            selector: sel,
            suggested: true,
          }, extras || {});
          __zacSend(action);
        }
        document.addEventListener('click', function (e) {
          if (!e.target || !e.target.tagName) return;
          const t = e.target;
          const tag = t.tagName.toLowerCase();
          if (tag === 'html' || tag === 'body') return;
          // Only suggest after clicks on interactive triggers — avoids
          // proposing an assertion for every passing click.
          const isInteractive =
            tag === 'a' || tag === 'button' ||
            t.getAttribute('role') === 'button' ||
            t.getAttribute('role') === 'menuitem' ||
            (t.type && (t.type === 'submit' || t.type === 'button'));
          if (!isInteractive) return;
          const text = (t.textContent || '').trim();
          if (text && text.length > 0 && text.length < 80) {
            __zacEmitAssertion('assertText', t, { expectedValue: text });
          } else {
            __zacEmitAssertion('assertVisible', t, {});
          }
        }, true);
        document.addEventListener('blur', function (e) {
          if (!e.target || e.target.tagName !== 'INPUT') return;
          const t = e.target;
          if (t.type === 'password' || t.type === 'file' || t.type === 'checkbox' || t.type === 'radio') return;
          const v = t.value || '';
          if (v && v.length < 200) {
            __zacEmitAssertion('assertValue', t, { expectedValue: v });
          }
        }, true);

        // ── T1.10 Modifier-key chords ────────────────────────────────
        // Existing keydown handler skips non-special keys. Capture chords
        // (Ctrl+S, Cmd+A, Shift+Tab, etc.) separately so they become
        // first-class steps. Fire only on keydown of the non-modifier key.
        document.addEventListener('keydown', function (e) {
          var k = e.key || e.code;
          if (k === 'Control' || k === 'Alt' || k === 'Shift' || k === 'Meta') return;
          var mods = [];
          if (e.ctrlKey)  mods.push('Control');
          if (e.metaKey)  mods.push('Meta');
          if (e.altKey)   mods.push('Alt');
          if (e.shiftKey) mods.push('Shift');
          if (mods.length === 0) return;
          var chord = mods.concat([k.length === 1 ? k.toUpperCase() : k]).join('+');
          var sel = getElementSelector(e.target) || 'body';
          __zacSend({
            kind: 'keyPress',
            key: chord,
            value: chord,
            selector: sel,
            modifiers: mods,
          });
        }, true);

        // Record navigation
        let lastUrl = window.location.href;
        setInterval(() => {
          if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            fetch(API_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionId: SESSION_ID,
                kind: 'navigate',
                url: lastUrl,
                timestamp: Date.now()
              })
            }).catch(err => console.error('Failed to send navigation:', err));
          }
        }, 500);
      })();
    `;
    await context.addInitScript(scriptContent);
  }

  async setupPageEventHandlers(page, sessionId) {
    // Also inject script at page level as backup (runs after page loads)
    const port = process.env.PORT || 3000;
    const API_URL = `http://localhost:${port}/api/recording/${sessionId}/action`;
    
    // Inject complete context menu script after page loads (backup injection)
    page.on('load', async () => {
      try {
        console.log('[Recording] Page loaded, injecting context menu script...');
        await page.evaluate(({ sessionId, apiUrl }) => {
          console.log('[Recording Script] ========== PAGE-LEVEL INJECTION ==========');
          console.log('[Recording Script] Session ID:', sessionId);
          console.log('[Recording Script] API URL:', apiUrl);
          
          // Guard: Check if already initialized for this session
          if (window.__ZERO_CODE_PAGE_LEVEL_INITIALIZED__ === sessionId) {
            console.warn('[Recording Script] ⚠️ Page-level script already initialized for session:', sessionId, '- skipping duplicate initialization');
            return;
          }
          window.__ZERO_CODE_PAGE_LEVEL_INITIALIZED__ = sessionId;
          
          // Remove any existing listeners and menu (safety cleanup)
          const existingMenu = document.getElementById('zero-code-context-menu');
          if (existingMenu) {
            console.log('[Recording Script] Removing existing context menu before re-initialization');
            existingMenu.remove();
          }
          
          // Create context menu
          let contextMenu = null;
          let currentElement = null;
          let pageLevelListenersAttached = false;
          
          // ========== HELPER FUNCTIONS (must be defined before createContextMenu) ==========
          
          // Helper function to get the nearest clickable ancestor element
          function getClickableElement(element) {
            if (!element) return null;
            let current = element;
            let maxDepth = 10;
            let depth = 0;
            while (current && depth < maxDepth) {
              const tag = current.tagName.toLowerCase();
              const role = current.getAttribute('role');
              const hasHref = current.hasAttribute('href');
              const hasOnClick = current.onclick !== null || current.getAttribute('onclick');
              const tabIndex = current.getAttribute('tabindex');
              const isClickable = 
                tag === 'a' || 
                tag === 'button' ||
                (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(current.type)) ||
                role === 'button' ||
                role === 'link' ||
                hasHref ||
                hasOnClick ||
                (tabIndex !== null && parseInt(tabIndex) >= 0);
              if (isClickable) {
                return current;
              }
              current = current.parentElement;
              depth++;
            }
            return element;
          }
          
          // Helper function to get full locator path (breadcrumb) from root to element
          function getLocatorPath(element) {
            if (!element) return [];
            const path = [];
            let current = element;
            let depth = 0;
            const maxDepth = 10;
            
            while (current && current !== document.body && current !== document.documentElement && depth < maxDepth) {
              const tag = current.tagName.toLowerCase();
              let locator = null;
              let selectorType = 'tag'; // Default type
              let selectorPriority = 10; // Lower is better (1 = best, 10 = worst)
              let alternativeSelectors = []; // Store alternative selector strategies
              
              // Try to get the best locator for this element (priority order)
              
              // 1. ID selector (highest priority)
              if (current.id) {
                locator = '#' + current.id;
                selectorType = 'ID';
                selectorPriority = 1;
                alternativeSelectors.push({ type: 'ID', value: locator, priority: 1 });
              }
              
              // 2. Data-testid (very reliable)
              if (!locator && current.getAttribute('data-testid')) {
                locator = '[data-testid="' + current.getAttribute('data-testid') + '"]';
                selectorType = 'data-testid';
                selectorPriority = 2;
                alternativeSelectors.push({ type: 'data-testid', value: locator, priority: 2 });
              }
              
              // 3. Data-id
              if (!locator && current.getAttribute('data-id')) {
                locator = '[data-id="' + current.getAttribute('data-id') + '"]';
                selectorType = 'data-id';
                selectorPriority = 3;
                alternativeSelectors.push({ type: 'data-id', value: locator, priority: 3 });
              }
              
              // 4. Name attribute (for form elements)
              if (!locator && current.name && (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'button')) {
                locator = '[name="' + current.name + '"]';
                selectorType = 'name';
                selectorPriority = 4;
                alternativeSelectors.push({ type: 'name', value: locator, priority: 4 });
              }
              
              // 5. Aria-label
              if (!locator && current.getAttribute('aria-label')) {
                locator = '[aria-label="' + current.getAttribute('aria-label') + '"]';
                selectorType = 'aria-label';
                selectorPriority = 5;
                alternativeSelectors.push({ type: 'aria-label', value: locator, priority: 5 });
              }
              
              // 6. Role attribute
              if (!locator && current.getAttribute('role')) {
                locator = '[role="' + current.getAttribute('role') + '"]';
                selectorType = 'role';
                selectorPriority = 6;
                alternativeSelectors.push({ type: 'role', value: locator, priority: 6 });
              }
              
              // 7. Text content (for elements with unique text)
              if (!locator) {
                const text = (current.textContent && current.textContent.trim()) || '';
                if (text && text.length > 0 && text.length < 100) {
                  const escapedText = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                  locator = 'text="' + escapedText + '"';
                  selectorType = 'text';
                  selectorPriority = 7;
                  alternativeSelectors.push({ type: 'text', value: locator, priority: 7 });
                }
              }
              
              // 8. Class-based selector
              if (!locator && current.className && typeof current.className === 'string') {
                const classes = current.className.split(' ').filter(c => {
                  const clean = c.trim();
                  return clean && !clean.startsWith('css-') && !clean.startsWith('ng-') && !clean.startsWith('_') && clean.length > 2;
                });
                if (classes.length > 0) {
                  locator = tag + '.' + classes.join('.');
                  selectorType = 'class';
                  selectorPriority = 8;
                  alternativeSelectors.push({ type: 'class', value: locator, priority: 8 });
                  // Also add single class option
                  if (classes.length > 1) {
                    alternativeSelectors.push({ type: 'class', value: tag + '.' + classes[0], priority: 8 });
                  }
                }
              }
              
              // 9. Tag with parent context
              if (!locator && current.parentElement) {
                const parent = current.parentElement;
                if (parent.id) {
                  locator = '#' + parent.id + ' > ' + tag;
                  selectorType = 'parent-id';
                  selectorPriority = 9;
                  alternativeSelectors.push({ type: 'parent-id', value: locator, priority: 9 });
                } else if (parent.className && typeof parent.className === 'string') {
                  const parentClasses = parent.className.split(' ').filter(c => {
                    const clean = c.trim();
                    return clean && !clean.startsWith('css-') && !clean.startsWith('ng-') && clean.length > 2;
                  });
                  if (parentClasses.length > 0) {
                    locator = '.' + parentClasses[0] + ' > ' + tag;
                    selectorType = 'parent-class';
                    selectorPriority = 9;
                    alternativeSelectors.push({ type: 'parent-class', value: locator, priority: 9 });
                  }
                }
              }
              
              // 10. Fallback to tag
              if (!locator) {
                locator = tag;
                selectorType = 'tag';
                selectorPriority = 10;
                alternativeSelectors.push({ type: 'tag', value: locator, priority: 10 });
              }
              
              // Add index if there are siblings with same tag
              let hasNthChild = false;
              if (current.parentElement) {
                const siblings = Array.from(current.parentElement.children).filter(el => el.tagName === current.tagName);
                if (siblings.length > 1) {
                  const index = siblings.indexOf(current) + 1;
                  locator = locator + ':nth-child(' + index + ')';
                  selectorType = selectorType + ' + nth-child';
                  hasNthChild = true;
                  // Add alternative without nth-child
                  if (alternativeSelectors.length > 0) {
                    const baseLocator = alternativeSelectors[0].value;
                    alternativeSelectors.push({ 
                      type: alternativeSelectors[0].type + ' + nth-child', 
                      value: baseLocator + ':nth-child(' + index + ')', 
                      priority: alternativeSelectors[0].priority 
                    });
                  }
                }
              }
              
              // Collect all available attributes for this element
              const attributes = {};
              if (current.id) attributes.id = current.id;
              if (current.name) attributes.name = current.name;
              if (current.getAttribute('data-testid')) attributes['data-testid'] = current.getAttribute('data-testid');
              if (current.getAttribute('data-id')) attributes['data-id'] = current.getAttribute('data-id');
              if (current.getAttribute('aria-label')) attributes['aria-label'] = current.getAttribute('aria-label');
              if (current.getAttribute('role')) attributes.role = current.getAttribute('role');
              if (current.className && typeof current.className === 'string') {
                attributes.class = current.className;
              }
              
              path.unshift({
                tag: tag,
                locator: locator,
                selectorType: selectorType,
                selectorPriority: selectorPriority,
                alternativeSelectors: alternativeSelectors,
                hasNthChild: hasNthChild,
                id: current.id || '',
                className: (current.className && typeof current.className === 'string' ? current.className.split(' ')[0] : '') || '',
                text: (current.textContent && current.textContent.trim().substring(0, 30)) || '',
                attributes: attributes
              });
              
              current = current.parentElement;
              depth++;
            }
            
            return path;
          }
          
          // Helper function to get all selector strategies for an element (for fallback)
          function getAllSelectorStrategies(element) {
            if (!element) return [];
            const strategies = [];
            if (element.id) strategies.push({ type: 'id', value: '#' + element.id, priority: 1 });
            if (element.name) strategies.push({ type: 'name', value: '[name="' + element.name + '"]', priority: 2 });
            if (element.getAttribute('data-testid')) {
              strategies.push({ type: 'data-testid', value: '[data-testid="' + element.getAttribute('data-testid') + '"]', priority: 3 });
            }
            if (element.getAttribute('aria-label')) {
              strategies.push({ type: 'aria-label', value: '[aria-label="' + element.getAttribute('aria-label') + '"]', priority: 4 });
            }
            const text = element.textContent && element.textContent.trim();
            if (text && text.length > 0) {
              const escapedText = text.length < 100 ? text.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"') : text.trim().substring(0, 50).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
              strategies.push({ type: 'text', value: 'text=' + escapedText, priority: 5 });
            }
            return strategies.sort((a, b) => a.priority - b.priority);
          }
          
          // Helper function to show locator path popup
          function showLocatorPathPopup(locatorPath, fullSelectorPath, url) {
            // Remove existing popup if any
            const existingPopup = document.getElementById('zero-code-locator-path-popup');
            if (existingPopup) {
              existingPopup.remove();
            }
            
            // Create popup container
            const popup = document.createElement('div');
            popup.id = 'zero-code-locator-path-popup';
            popup.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #1a1f2e; border: 2px solid #5aa9ff; border-radius: 12px; padding: 24px; z-index: 1000000; box-shadow: 0 8px 32px rgba(0,0,0,0.6); max-width: 800px; max-height: 80vh; overflow-y: auto; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #e1e8ed;';
            
            // Create header
            const header = document.createElement('div');
            header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid #2a3441;';
            
            const title = document.createElement('h3');
            title.textContent = '📍 Full Locator Path (Breadcrumb)';
            title.style.cssText = 'margin: 0; font-size: 18px; font-weight: 600; color: #5aa9ff;';
            
            const closeBtn = document.createElement('button');
            closeBtn.textContent = '✕';
            closeBtn.style.cssText = 'background: transparent; border: none; color: #e1e8ed; font-size: 24px; cursor: pointer; padding: 0; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 4px; transition: background 0.2s;';
            closeBtn.onmouseenter = () => { closeBtn.style.background = 'rgba(255,255,255,0.1)'; };
            closeBtn.onmouseleave = () => { closeBtn.style.background = 'transparent'; };
            closeBtn.onclick = () => { popup.remove(); };
            
            header.appendChild(title);
            header.appendChild(closeBtn);
            popup.appendChild(header);
            
            // URL section
            if (url) {
              const urlSection = document.createElement('div');
              urlSection.style.cssText = 'margin-bottom: 20px; padding: 12px; background: rgba(90, 169, 255, 0.1); border-radius: 8px; border-left: 3px solid #5aa9ff;';
              
              const urlLabel = document.createElement('div');
              urlLabel.textContent = '🌐 Navigation URL:';
              urlLabel.style.cssText = 'font-size: 12px; color: #9ca3af; margin-bottom: 6px;';
              
              const urlValue = document.createElement('div');
              urlValue.textContent = url;
              urlValue.style.cssText = 'font-size: 14px; color: #5aa9ff; word-break: break-all; font-family: monospace;';
              
              urlSection.appendChild(urlLabel);
              urlSection.appendChild(urlValue);
              popup.appendChild(urlSection);
            }
            
            // Full selector path section
            if (fullSelectorPath) {
              const fullPathSection = document.createElement('div');
              fullPathSection.style.cssText = 'margin-bottom: 20px; padding: 12px; background: rgba(90, 169, 255, 0.1); border-radius: 8px; border-left: 3px solid #5aa9ff;';
              
              const fullPathLabel = document.createElement('div');
              fullPathLabel.textContent = '🔗 Full Selector Path:';
              fullPathLabel.style.cssText = 'font-size: 12px; color: #9ca3af; margin-bottom: 6px;';
              
              const fullPathValue = document.createElement('div');
              fullPathValue.textContent = fullSelectorPath;
              fullPathValue.style.cssText = 'font-size: 13px; color: #5aa9ff; word-break: break-all; font-family: monospace; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px;';
              
              fullPathSection.appendChild(fullPathLabel);
              fullPathSection.appendChild(fullPathValue);
              popup.appendChild(fullPathSection);
            }
            
            // Locator path breadcrumb section
            if (locatorPath && locatorPath.length > 0) {
              const pathLabel = document.createElement('div');
              pathLabel.textContent = '📋 Locator Path (Root → Element):';
              pathLabel.style.cssText = 'font-size: 14px; font-weight: 600; color: #e1e8ed; margin-bottom: 12px;';
              popup.appendChild(pathLabel);
              
              const pathContainer = document.createElement('div');
              pathContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';
              
              locatorPath.forEach((item, index) => {
                const pathItem = document.createElement('div');
                pathItem.style.cssText = 'padding: 12px; background: rgba(42, 52, 65, 0.5); border-radius: 6px; border-left: 3px solid #5aa9ff; margin-bottom: 8px;';
                
                // First row: Index, Tag, Selector Type, Locator
                const firstRow = document.createElement('div');
                firstRow.style.cssText = 'display: flex; align-items: center; margin-bottom: 8px;';
                
                const indexSpan = document.createElement('span');
                indexSpan.textContent = (index + 1) + '.';
                indexSpan.style.cssText = 'font-weight: 600; color: #5aa9ff; margin-right: 12px; min-width: 30px;';
                
                const tagSpan = document.createElement('span');
                tagSpan.textContent = item.tag.toUpperCase();
                tagSpan.style.cssText = 'color: #9ca3af; margin-right: 8px; font-size: 11px; font-weight: 600; padding: 2px 6px; background: rgba(156, 163, 175, 0.2); border-radius: 3px;';
                
                // Selector type badge
                const typeBadge = document.createElement('span');
                const typeColors = {
                  'ID': '#10b981',
                  'data-testid': '#3b82f6',
                  'data-id': '#3b82f6',
                  'name': '#8b5cf6',
                  'aria-label': '#f59e0b',
                  'role': '#f59e0b',
                  'text': '#ec4899',
                  'class': '#06b6d4',
                  'parent-id': '#6366f1',
                  'parent-class': '#6366f1',
                  'tag': '#6b7280'
                };
                const baseType = item.selectorType.split(' ')[0];
                const typeColor = typeColors[baseType] || '#6b7280';
                typeBadge.textContent = item.selectorType;
                typeBadge.style.cssText = 'color: white; font-size: 10px; font-weight: 600; padding: 3px 8px; background: ' + typeColor + '; border-radius: 4px; margin-right: 8px; text-transform: uppercase;';
                
                const arrowSpan = document.createElement('span');
                arrowSpan.textContent = '→';
                arrowSpan.style.cssText = 'color: #5aa9ff; margin: 0 8px; font-weight: bold;';
                
                const locatorSpan = document.createElement('span');
                locatorSpan.textContent = item.locator;
                locatorSpan.style.cssText = 'color: #5aa9ff; font-family: monospace; font-size: 13px; flex: 1; word-break: break-all;';
                
                firstRow.appendChild(indexSpan);
                firstRow.appendChild(tagSpan);
                firstRow.appendChild(typeBadge);
                firstRow.appendChild(arrowSpan);
                firstRow.appendChild(locatorSpan);
                pathItem.appendChild(firstRow);
                
                // Second row: Alternative selectors (if available)
                if (item.alternativeSelectors && item.alternativeSelectors.length > 1) {
                  const altRow = document.createElement('div');
                  altRow.style.cssText = 'margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(42, 52, 65, 0.8);';
                  
                  const altLabel = document.createElement('div');
                  altLabel.textContent = '💡 Alternative Selectors:';
                  altLabel.style.cssText = 'font-size: 11px; color: #9ca3af; margin-bottom: 6px; font-weight: 600;';
                  altRow.appendChild(altLabel);
                  
                  const altContainer = document.createElement('div');
                  altContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px;';
                  
                  // Show top 3 alternatives (excluding the primary one)
                  const alternatives = item.alternativeSelectors
                    .filter(alt => alt.value !== item.locator)
                    .slice(0, 3);
                  
                  alternatives.forEach(alt => {
                    const altBadge = document.createElement('div');
                    altBadge.style.cssText = 'display: inline-flex; align-items: center; padding: 4px 8px; background: rgba(90, 169, 255, 0.15); border: 1px solid rgba(90, 169, 255, 0.3); border-radius: 4px; font-size: 10px;';
                    
                    const altType = document.createElement('span');
                    altType.textContent = alt.type + ':';
                    altType.style.cssText = 'color: #9ca3af; margin-right: 6px; font-weight: 600;';
                    
                    const altValue = document.createElement('span');
                    altValue.textContent = alt.value;
                    altValue.style.cssText = 'color: #5aa9ff; font-family: monospace; font-size: 10px;';
                    
                    altBadge.appendChild(altType);
                    altBadge.appendChild(altValue);
                    altContainer.appendChild(altBadge);
                  });
                  
                  altRow.appendChild(altContainer);
                  pathItem.appendChild(altRow);
                }
                
                // Third row: Attributes and text (if available)
                if (item.attributes && Object.keys(item.attributes).length > 0) {
                  const attrRow = document.createElement('div');
                  attrRow.style.cssText = 'margin-top: 6px; font-size: 10px; color: #9ca3af;';
                  
                  const attrList = [];
                  if (item.attributes.id) attrList.push('id: ' + item.attributes.id);
                  if (item.attributes.name) attrList.push('name: ' + item.attributes.name);
                  if (item.attributes['data-testid']) attrList.push('data-testid: ' + item.attributes['data-testid']);
                  if (item.attributes['aria-label']) attrList.push('aria-label: ' + item.attributes['aria-label']);
                  if (item.attributes.role) attrList.push('role: ' + item.attributes.role);
                  
                  if (attrList.length > 0) {
                    const attrSpan = document.createElement('span');
                    attrSpan.textContent = '📌 ' + attrList.join(' • ');
                    attrSpan.style.cssText = 'font-size: 10px; color: #9ca3af;';
                    attrRow.appendChild(attrSpan);
                    pathItem.appendChild(attrRow);
                  }
                }
                
                if (item.text) {
                  const textRow = document.createElement('div');
                  textRow.style.cssText = 'margin-top: 6px; font-size: 11px; color: #9ca3af; font-style: italic;';
                  textRow.textContent = '📝 Text: "' + item.text + '"';
                  pathItem.appendChild(textRow);
                }
                
                pathContainer.appendChild(pathItem);
              });
              
              popup.appendChild(pathContainer);
            } else {
              const noPathMsg = document.createElement('div');
              noPathMsg.textContent = 'No locator path available';
              noPathMsg.style.cssText = 'color: #9ca3af; font-style: italic; padding: 20px; text-align: center;';
              popup.appendChild(noPathMsg);
            }
            
            // Add to body
            document.body.appendChild(popup);
            
            // Close on outside click
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 999999;';
            overlay.onclick = () => {
              popup.remove();
              overlay.remove();
            };
            document.body.insertBefore(overlay, popup);
            
            // Auto-close after 10 seconds
            setTimeout(() => {
              if (popup.parentElement) {
                popup.remove();
                if (overlay.parentElement) overlay.remove();
              }
            }, 10000);
          }
          
          function createContextMenu() {
            if (contextMenu) return;
            
            contextMenu = document.createElement('div');
            contextMenu.id = 'zero-code-context-menu';
            contextMenu.style.cssText = 'position: fixed; background: #1a1f2e; border: 1px solid #2a3441; border-radius: 8px; padding: 8px; z-index: 999999; box-shadow: 0 4px 20px rgba(0,0,0,0.5); display: none; min-width: 200px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;';
            
            // Handle navigate action (page-level) - define before use
            function handleNavigate() {
              if (!currentElement) {
                console.warn('[Recording Script] ⚠️ No element selected for navigation');
                return;
              }
              
              // Get the clickable element (link, button with href, etc.)
              const targetElement = getClickableElement(currentElement);
              if (!targetElement) {
                console.warn('[Recording Script] ⚠️ Could not determine target element for navigation');
                return;
              }
              
              // Extract URL from element
              let url = null;
              
              // Check for href attribute (links)
              if (targetElement.href) {
                url = targetElement.href;
              } else if (targetElement.getAttribute('href')) {
                url = targetElement.getAttribute('href');
              } else if (targetElement.getAttribute('data-href')) {
                url = targetElement.getAttribute('data-href');
              } else if (targetElement.onclick) {
                // Try to extract URL from onclick handler (if it's a simple navigation)
                const onclickStr = targetElement.getAttribute('onclick') || targetElement.onclick.toString();
                const urlMatch = onclickStr.match(/(?:window\.location|location\.href)\s*=\s*['"]([^'"]+)['"]/);
                if (urlMatch) {
                  url = urlMatch[1];
                }
              }
              
              // If no URL found, use current page URL
              if (!url) {
                url = window.location.href;
                console.warn('[Recording Script] ⚠️ No URL found in element, using current page URL:', url);
              }
              
              // Build locator candidates using the new smart system
              const locatorCandidates = buildLocatorCandidates(targetElement);
              
              // Add URL candidate as first option
              const urlCandidate = {
                selector: url,
                type: 'url',
                unique: true,
                matchCount: 1,
                stabilityScore: 70,
                description: 'Direct navigation to URL',
                seleniumExample: 'driver.get("' + url + '");',
                playwrightExample: 'await page.goto("' + url + '");'
              };
              locatorCandidates.unshift(urlCandidate);
              
              // Determine primary locator index (prefer non-URL unique candidates)
              const primaryLocatorIndex = getPrimaryLocatorIndex(locatorCandidates, true); // excludeUrl = true
              
              // Show selection dialog with smart candidates
              showNavigateSelectorDialog(locatorCandidates, url, primaryLocatorIndex, targetElement);
              
              if (contextMenu) contextMenu.style.display = 'none';
            }
            
            // Function to show selector selection dialog for navigation (using smart locator candidates)
            function showNavigateSelectorDialog(locatorCandidates, url, primaryLocatorIndex, targetElement) {
              // Remove existing dialogs
              const existingDialog = document.getElementById('zero-code-navigate-selector-dialog');
              if (existingDialog) {
                existingDialog.remove();
              }
              
              // Create overlay
              const overlay = document.createElement('div');
              overlay.id = 'zero-code-navigate-selector-overlay';
              overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 1000001; display: flex; align-items: center; justify-content: center;';
              
              // Create dialog
              const dialog = document.createElement('div');
              dialog.id = 'zero-code-navigate-selector-dialog';
              dialog.style.cssText = 'background: #1a1f2e; border: 2px solid #5aa9ff; border-radius: 12px; padding: 24px; max-width: 900px; max-height: 85vh; overflow-y: auto; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #e1e8ed; box-shadow: 0 8px 32px rgba(0,0,0,0.6);';
              
              // Header
              const header = document.createElement('div');
              header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid #2a3441;';
              
              const title = document.createElement('h3');
              title.textContent = '🌐 Select Navigation Method';
              title.style.cssText = 'margin: 0; font-size: 20px; font-weight: 600; color: #5aa9ff;';
              
              const closeBtn = document.createElement('button');
              closeBtn.textContent = '✕';
              closeBtn.style.cssText = 'background: transparent; border: none; color: #e1e8ed; font-size: 24px; cursor: pointer; padding: 0; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 4px; transition: background 0.2s;';
              closeBtn.onmouseenter = () => { closeBtn.style.background = 'rgba(255,255,255,0.1)'; };
              closeBtn.onmouseleave = () => { closeBtn.style.background = 'transparent'; };
              closeBtn.onclick = (e) => {
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();
                setTimeout(() => {
                  if (dialog.parentElement) dialog.remove();
                  if (overlay.parentElement) overlay.remove();
                }, 100);
              };
              
              header.appendChild(title);
              header.appendChild(closeBtn);
              dialog.appendChild(header);
              
              // URL section
              const urlSection = document.createElement('div');
              urlSection.style.cssText = 'margin-bottom: 20px; padding: 12px; background: rgba(90, 169, 255, 0.1); border-radius: 8px; border-left: 3px solid #5aa9ff;';
              
              const urlLabel = document.createElement('div');
              urlLabel.textContent = '📍 Navigation URL:';
              urlLabel.style.cssText = 'font-size: 12px; color: #9ca3af; margin-bottom: 6px; font-weight: 600;';
              
              const urlValue = document.createElement('div');
              urlValue.textContent = url;
              urlValue.style.cssText = 'font-size: 14px; color: #5aa9ff; word-break: break-all; font-family: monospace;';
              
              urlSection.appendChild(urlLabel);
              urlSection.appendChild(urlValue);
              dialog.appendChild(urlSection);
              
              // Instructions
              const instructions = document.createElement('div');
              instructions.textContent = 'Select a locator method to use for navigation:';
              instructions.style.cssText = 'font-size: 14px; color: #9ca3af; margin-bottom: 16px;';
              dialog.appendChild(instructions);
              
              // Selected index tracking
              let selectedIndex = primaryLocatorIndex || 0;
              
              // Locator candidate cards
              const optionsContainer = document.createElement('div');
              optionsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px;';
              
              locatorCandidates.forEach((candidate, index) => {
                const isRecommended = index === primaryLocatorIndex && candidate.type !== 'url';
                const isSelected = index === selectedIndex;
                
                const optionCard = document.createElement('div');
                optionCard.style.cssText = 'padding: 16px; background: rgba(42, 52, 65, 0.5); border: 2px solid ' + (isRecommended ? '#10b981' : isSelected ? '#5aa9ff' : 'rgba(90, 169, 255, 0.3)') + '; border-radius: 8px; cursor: pointer; transition: all 0.2s; position: relative;';
                
                // Recommended badge
                if (isRecommended) {
                  const recommendedBadge = document.createElement('div');
                  recommendedBadge.textContent = '⭐ Recommended';
                  recommendedBadge.style.cssText = 'position: absolute; top: 8px; right: 8px; font-size: 10px; color: #10b981; font-weight: 600; padding: 4px 8px; background: rgba(16, 185, 129, 0.2); border-radius: 4px;';
                  optionCard.appendChild(recommendedBadge);
                }
                
                // Selection indicator (will be updated dynamically)
                const selectedIndicator = document.createElement('div');
                selectedIndicator.style.cssText = 'position: absolute; top: 8px; left: 8px; width: 20px; height: 20px; background: ' + (isSelected ? '#5aa9ff' : 'transparent') + '; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: bold; border: 2px solid ' + (isSelected ? '#5aa9ff' : 'rgba(90, 169, 255, 0.3)') + ';';
                if (isSelected) selectedIndicator.textContent = '✓';
                optionCard.appendChild(selectedIndicator);
                optionCard.setAttribute('data-candidate-index', index);
                
                optionCard.onmouseenter = () => {
                  if (!isSelected) {
                    optionCard.style.background = 'rgba(90, 169, 255, 0.2)';
                    optionCard.style.borderColor = '#5aa9ff';
                  }
                };
                optionCard.onmouseleave = () => {
                  if (!isSelected) {
                    optionCard.style.background = 'rgba(42, 52, 65, 0.5)';
                    optionCard.style.borderColor = isRecommended ? '#10b981' : 'rgba(90, 169, 255, 0.3)';
                  }
                };
                
                optionCard.onclick = (e) => {
                  e.stopPropagation();
                  e.stopImmediatePropagation();
                  e.preventDefault();
                  
                  // Update selected index
                  selectedIndex = index;
                  
                  // Update all cards' visual selection
                  optionsContainer.querySelectorAll('div[data-candidate-card]').forEach((card) => {
                    const cardIndex = parseInt(card.getAttribute('data-candidate-index'));
                    const isRec = cardIndex === primaryLocatorIndex && locatorCandidates[cardIndex].type !== 'url';
                    const isCardSelected = cardIndex === index;
                    const indicator = card.querySelector('div:first-child');
                    
                    if (isCardSelected) {
                      card.style.borderColor = '#5aa9ff';
                      card.style.background = 'rgba(90, 169, 255, 0.2)';
                      if (indicator) {
                        indicator.style.background = '#5aa9ff';
                        indicator.style.borderColor = '#5aa9ff';
                        indicator.textContent = '✓';
                      }
                    } else {
                      card.style.borderColor = isRec ? '#10b981' : 'rgba(90, 169, 255, 0.3)';
                      card.style.background = 'rgba(42, 52, 65, 0.5)';
                      if (indicator) {
                        indicator.style.background = 'transparent';
                        indicator.style.borderColor = 'rgba(90, 169, 255, 0.3)';
                        indicator.textContent = '';
                      }
                    }
                  });
                };
                
                optionCard.setAttribute('data-candidate-card', 'true');
                
                // Type badge with color coding
                const typeColors = {
                  'id': '#10b981',
                  'data-testid': '#10b981',
                  'data-id': '#3b82f6',
                  'role+text': '#8b5cf6',
                  'smart-path': '#06b6d4',
                  'text': '#ec4899',
                  'name': '#f59e0b',
                  'aria': '#f59e0b',
                  'css': '#6366f1',
                  'xpath': '#6b7280',
                  'url': '#9ca3af'
                };
                const typeColor = typeColors[candidate.type] || '#6b7280';
                
                const typeBadge = document.createElement('span');
                typeBadge.textContent = candidate.type.toUpperCase() + (candidate.unique ? ' (unique)' : ' (' + candidate.matchCount + ' matches)');
                typeBadge.style.cssText = 'font-size: 10px; color: white; font-weight: 600; padding: 4px 8px; background: ' + typeColor + '; border-radius: 4px; display: inline-block; margin-bottom: 8px;';
                
                // Header row: Type badge + Stability score
                const headerRow = document.createElement('div');
                headerRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;';
                headerRow.appendChild(typeBadge);
                
                const stabilityBadge = document.createElement('span');
                stabilityBadge.textContent = 'Stability: ' + candidate.stabilityScore;
                stabilityBadge.style.cssText = 'font-size: 10px; color: #9ca3af; padding: 2px 6px; background: rgba(156, 163, 175, 0.2); border-radius: 4px;';
                headerRow.appendChild(stabilityBadge);
                optionCard.appendChild(headerRow);
                
                // Description
                const desc = document.createElement('div');
                desc.textContent = candidate.description;
                desc.style.cssText = 'font-size: 13px; color: #e1e8ed; font-weight: 500; margin-bottom: 8px;';
                optionCard.appendChild(desc);
                
                // Selector value (CSS/Playwright selector)
                const selectorLabel = document.createElement('div');
                selectorLabel.textContent = candidate.xpath ? 'CSS/Playwright Selector:' : 'Selector:';
                selectorLabel.style.cssText = 'font-size: 10px; color: #9ca3af; margin-bottom: 4px; font-weight: 600;';
                optionCard.appendChild(selectorLabel);
                
                const selectorValue = document.createElement('div');
                selectorValue.textContent = candidate.selector;
                selectorValue.style.cssText = 'font-size: 11px; color: #5aa9ff; font-family: monospace; background: rgba(0,0,0,0.3); padding: 6px; border-radius: 4px; word-break: break-all; margin-bottom: ' + (candidate.xpath ? '8px' : '8px') + ';';
                optionCard.appendChild(selectorValue);
                
                // XPath alternative (if available)
                if (candidate.xpath) {
                  const xpathLabel = document.createElement('div');
                  xpathLabel.textContent = 'XPath Alternative:';
                  xpathLabel.style.cssText = 'font-size: 10px; color: #9ca3af; margin-bottom: 4px; font-weight: 600; margin-top: 8px;';
                  optionCard.appendChild(xpathLabel);
                  
                  const xpathValue = document.createElement('div');
                  xpathValue.textContent = candidate.xpath;
                  xpathValue.style.cssText = 'font-size: 11px; color: #10b981; font-family: monospace; background: rgba(16, 185, 129, 0.1); padding: 6px; border-radius: 4px; word-break: break-all; margin-bottom: 8px; border-left: 2px solid #10b981;';
                  optionCard.appendChild(xpathValue);
                }
                
                // Code examples (collapsible)
                const codeToggle = document.createElement('div');
                codeToggle.textContent = '📝 Show code examples';
                codeToggle.style.cssText = 'font-size: 11px; color: #9ca3af; cursor: pointer; margin-bottom: 4px; text-decoration: underline;';
                
                const codeContainer = document.createElement('div');
                codeContainer.style.cssText = 'display: none; margin-top: 8px; padding: 8px; background: rgba(0,0,0,0.3); border-radius: 4px; font-size: 10px;';
                
                let codeExpanded = false;
                codeToggle.onclick = (e) => {
                  e.stopPropagation();
                  codeExpanded = !codeExpanded;
                  codeContainer.style.display = codeExpanded ? 'block' : 'none';
                  codeToggle.textContent = codeExpanded ? '📝 Hide code examples' : '📝 Show code examples';
                };
                
                // Selenium example
                const seleniumLabel = document.createElement('div');
                seleniumLabel.textContent = 'Selenium:';
                seleniumLabel.style.cssText = 'color: #9ca3af; margin-bottom: 4px; font-weight: 600;';
                codeContainer.appendChild(seleniumLabel);
                
                const seleniumCode = document.createElement('div');
                seleniumCode.textContent = candidate.seleniumExample || 'N/A';
                seleniumCode.style.cssText = 'color: #5aa9ff; font-family: monospace; margin-bottom: 8px; word-break: break-all;';
                codeContainer.appendChild(seleniumCode);
                
                // Playwright example
                const playwrightLabel = document.createElement('div');
                playwrightLabel.textContent = 'Playwright:';
                playwrightLabel.style.cssText = 'color: #9ca3af; margin-bottom: 4px; font-weight: 600;';
                codeContainer.appendChild(playwrightLabel);
                
                const playwrightCode = document.createElement('div');
                playwrightCode.textContent = candidate.playwrightExample || 'N/A';
                playwrightCode.style.cssText = 'color: #5aa9ff; font-family: monospace; word-break: break-all;';
                codeContainer.appendChild(playwrightCode);
                
                optionCard.appendChild(codeToggle);
                optionCard.appendChild(codeContainer);
                
                optionsContainer.appendChild(optionCard);
              });
              
              dialog.appendChild(optionsContainer);
              
              // Use button
              const useBtn = document.createElement('button');
              useBtn.textContent = 'Use Selected Locator';
              useBtn.style.cssText = 'width: 100%; padding: 12px; background: #5aa9ff; border: none; border-radius: 6px; color: white; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; margin-bottom: 10px;';
              useBtn.onmouseenter = () => { useBtn.style.background = '#4a99ef'; };
              useBtn.onmouseleave = () => { useBtn.style.background = '#5aa9ff'; };
              useBtn.onclick = (e) => {
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();
                
                const selectedCandidate = locatorCandidates[selectedIndex];
                recordNavigateAction(url, selectedCandidate, locatorCandidates, selectedIndex, targetElement);
                
                setTimeout(() => {
                  if (dialog.parentElement) dialog.remove();
                  if (overlay.parentElement) overlay.remove();
                }, 100);
              };
              dialog.appendChild(useBtn);
              
              // Cancel button
              const cancelBtn = document.createElement('button');
              cancelBtn.textContent = 'Cancel';
              cancelBtn.style.cssText = 'width: 100%; padding: 12px; background: rgba(107, 114, 128, 0.3); border: 1px solid #6b7280; border-radius: 6px; color: #e1e8ed; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s;';
              cancelBtn.onmouseenter = () => { cancelBtn.style.background = 'rgba(107, 114, 128, 0.5)'; };
              cancelBtn.onmouseleave = () => { cancelBtn.style.background = 'rgba(107, 114, 128, 0.3)'; };
              cancelBtn.onclick = (e) => {
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();
                setTimeout(() => {
                  if (dialog.parentElement) dialog.remove();
                  if (overlay.parentElement) overlay.remove();
                }, 100);
              };
              dialog.appendChild(cancelBtn);
              
              overlay.appendChild(dialog);
              document.body.appendChild(overlay);
              
              // Prevent clicks inside dialog from bubbling to document
              dialog.onclick = (e) => {
                e.stopPropagation();
              };
              
              // Close on overlay click (but not on dialog click)
              overlay.onclick = (e) => {
                if (e.target === overlay) {
                  e.stopPropagation();
                  e.stopImmediatePropagation();
                  setTimeout(() => {
                    if (dialog.parentElement) dialog.remove();
                    if (overlay.parentElement) overlay.remove();
                  }, 100);
                }
              };
            }
            
            // Function to record navigate action after selection (using locator candidates)
            function recordNavigateAction(url, selectedCandidate, locatorCandidates, primaryLocatorIndex, targetElement) {
              // Extract element metadata
              const metadata = extractElementMetadata(targetElement);
              
              // Create navigate action with locator candidates
              const navigateAction = {
                sessionId: sessionId,
                kind: 'navigate',
                url: url,
                selector: selectedCandidate.selector,
                locatorCandidates: locatorCandidates,
                primaryLocatorIndex: primaryLocatorIndex,
                timestamp: Date.now(),
                ...metadata
              };
              
              console.log('[Recording Script] 📍 Navigate action (selected):', navigateAction);
              
              // Send navigate action to server
              fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(navigateAction)
              }).then(resp => {
                if (resp.ok) {
                  console.log('[Recording Script] ✅ Navigate action sent successfully:', navigateAction);
                } else {
                  console.error('[Recording Script] ❌ Navigate action failed:', resp.status, resp.statusText);
                }
                return resp.json();
              }).then(data => {
                console.log('[Recording Script] Server response:', data);
              }).catch(err => {
                console.error('[Recording Script] ❌ Failed to send navigate action:', err);
              });
            }
            
            // Helper function to show locator path in a container (reusable)
            function showLocatorPathInContainer(container, locatorPath, fullSelectorPath) {
              if (fullSelectorPath) {
                const fullPathSection = document.createElement('div');
                fullPathSection.style.cssText = 'margin-bottom: 12px; padding: 8px; background: rgba(90, 169, 255, 0.1); border-radius: 6px;';
                
                const fullPathLabel = document.createElement('div');
                fullPathLabel.textContent = '🔗 Full Selector Path:';
                fullPathLabel.style.cssText = 'font-size: 11px; color: #9ca3af; margin-bottom: 4px;';
                
                const fullPathValue = document.createElement('div');
                fullPathValue.textContent = fullSelectorPath;
                fullPathValue.style.cssText = 'font-size: 12px; color: #5aa9ff; word-break: break-all; font-family: monospace;';
                
                fullPathSection.appendChild(fullPathLabel);
                fullPathSection.appendChild(fullPathValue);
                container.appendChild(fullPathSection);
              }
              
              if (locatorPath && locatorPath.length > 0) {
                locatorPath.forEach((item, index) => {
                  const pathItem = document.createElement('div');
                  pathItem.style.cssText = 'padding: 8px; background: rgba(42, 52, 65, 0.5); border-radius: 4px; margin-bottom: 6px; font-size: 11px;';
                  
                  const pathText = document.createElement('span');
                  pathText.textContent = (index + 1) + '. ' + item.tag.toUpperCase() + ' → ' + item.locator;
                  pathText.style.cssText = 'color: #5aa9ff; font-family: monospace;';
                  
                  pathItem.appendChild(pathText);
                  container.appendChild(pathItem);
                });
              }
            }
            
            const menuItems = [
              { label: '🌐 Navigate To', kind: 'navigate', separator: true },
              { label: '📌 Save as Locator', kind: 'saveLocator', separator: true },
              { label: '✓ Assert Visible', kind: 'assertVisible', separator: true },
              { label: '✗ Assert Not Visible', kind: 'assertNotVisible' },
              { label: '📝 Assert Text Contains', kind: 'assertText' },
              { label: '🏷️ Assert Attribute', kind: 'assertAttribute' },
              { label: '🔢 Assert Count', kind: 'assertCount' },
              { label: '📋 Assert Value', kind: 'assertValue' },
              { label: '✅ Assert Enabled', kind: 'assertEnabled' },
              { label: '❌ Assert Disabled', kind: 'assertDisabled' },
              { label: '☑ Assert Checked', kind: 'assertChecked' },
              { label: '☐ Assert Not Checked', kind: 'assertNotChecked' }
            ];
            
            menuItems.forEach((item, index) => {
              // Add separator if needed
              if (item.separator && index > 0) {
                const separator = document.createElement('div');
                separator.style.cssText = 'height: 1px; background: #2a3441; margin: 6px 0;';
                contextMenu.appendChild(separator);
              }
              
              const menuItem = document.createElement('div');
              menuItem.textContent = item.label;
              menuItem.style.cssText = 'padding: 12px 16px; cursor: pointer; font-size: 13px; border-radius: 6px; transition: all 0.2s; color: #e1e8ed; margin: 2px 0;';
              menuItem.onmouseenter = () => {
                menuItem.style.background = 'rgba(90, 169, 255, 0.2)';
                menuItem.style.color = '#5aa9ff';
              };
              menuItem.onmouseleave = () => {
                menuItem.style.background = '';
                menuItem.style.color = '#e1e8ed';
              };
              menuItem.onclick = (e) => {
                e.stopPropagation();
                if (item.kind === 'navigate') {
                  console.log('[Recording Script] Navigate selected');
                  handleNavigate();
                  hideContextMenu();
                  return;
                }
                if (item.kind === 'saveLocator') {
                  console.log('[Recording Script] Save as Locator selected (menu v2)');
                  handleSaveLocator();
                  hideContextMenu();
                  return;
                }
                {
                  console.log('[Recording Script] Assertion selected:', item.kind);
                  
                  // Normalize to clickable element for assertions
                  const targetElement = currentElement ? getClickableElement(currentElement) : null;
                  if (!targetElement) {
                    console.warn('[Recording Script] ⚠️ Could not determine target element for assertion');
                    return;
                  }
                  
                  // Build locator candidates using the new smart system
                  const locatorCandidates = buildLocatorCandidates(targetElement);
                  if (!locatorCandidates || locatorCandidates.length === 0) {
                    console.warn('[Recording Script] ⚠️ No locator candidates found for assertion element');
                    return;
                  }
                  
                  // Determine primary locator index (best unique candidate)
                  const primaryLocatorIndex = getPrimaryLocatorIndex(locatorCandidates);
                  const primaryCandidate = locatorCandidates[primaryLocatorIndex];
                  
                  // Reject generic selectors
                  const genericTags = ['span', 'div', 'p', 'a', 'button', 'input', 'body'];
                  if (genericTags.includes(primaryCandidate.selector)) {
                    const betterCandidate = locatorCandidates.find(c => 
                      c.selector && !genericTags.includes(c.selector) && c.selector !== primaryCandidate.selector
                    );
                    if (!betterCandidate) {
                      console.warn('[Recording Script] ⚠️ Could not find better selector for assertion');
                      return;
                    }
                  }
                  
                  // Extract element metadata for better normalization
                  const metadata = extractElementMetadata(targetElement);
                  
                  let action = {
                    sessionId: sessionId,
                    kind: item.kind,
                    selector: primaryCandidate.selector,
                    locatorCandidates: locatorCandidates,
                    primaryLocatorIndex: primaryLocatorIndex,
                    timestamp: Date.now(),
                    // Add metadata for normalization
                    ...metadata
                  };
                  
                  // Warn about non-unique selectors with helpful suggestions
                  if (!primaryCandidate.unique && primaryCandidate.matchCount > 1) {
                    console.warn('[Recording Script] ⚠️ WARNING: Assertion selector is NOT UNIQUE!');
                    console.warn('[Recording Script] ⚠️ Selector "' + primaryCandidate.selector + '" matches ' + primaryCandidate.matchCount + ' elements');
                    console.warn('[Recording Script] ⚠️ This may cause flaky test failures. Consider using a more specific selector.');
                    
                    // Log alternative suggestions if available
                    if (locatorCandidates && locatorCandidates.length > 1) {
                      const uniqueAlternatives = locatorCandidates.filter(c => c.unique && c.selector !== primaryCandidate.selector);
                      if (uniqueAlternatives.length > 0) {
                        console.warn('[Recording Script] 💡 Suggested unique alternatives:');
                        uniqueAlternatives.slice(0, 3).forEach((alt, idx) => {
                          console.warn('[Recording Script]    ' + (idx + 1) + '. ' + alt.selector + ' (type: ' + alt.type + ')');
                        });
                      }
                    }
                    
                    // Add warning to action metadata
                    action.selectorWarning = {
                      unique: false,
                      matchCount: primaryCandidate.matchCount,
                      message: 'Selector matches ' + primaryCandidate.matchCount + ' elements - may cause flaky tests'
                    };
                  } else if (primaryCandidate.unique) {
                    console.log('[Recording Script] ✅ Assertion selector is unique:', primaryCandidate.selector);
                  }
                  
                  // Add specific data based on assertion type
                  if (item.kind === 'assertText') {
                    action.text = (targetElement.textContent && targetElement.textContent.trim()) || targetElement.value || '';
                    action.expectedValue = action.text;
                  } else if (item.kind === 'assertAttribute') {
                    const attrs = ['href', 'src', 'title', 'alt', 'value'];
                    for (let i = 0; i < attrs.length; i++) {
                      const attr = attrs[i];
                      const value = targetElement.getAttribute(attr);
                      if (value) {
                        action.value = attr;
                        action.expectedValue = value;
                        break;
                      }
                    }
                  } else if (item.kind === 'assertCount') {
                    if (targetElement.parentElement) {
                      const parent = targetElement.parentElement;
                      const siblings = Array.from(parent.children).filter(el => 
                        el.tagName === targetElement.tagName
                      );
                      action.expectedValue = siblings.length.toString();
                    }
                  } else if (item.kind === 'assertValue') {
                    action.expectedValue = targetElement.value || (targetElement.textContent && targetElement.textContent.trim()) || '';
                  }
                  // assertEnabled, assertDisabled, assertChecked, assertNotChecked, assertNotVisible don't need extra data
                  
                  fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(action)
                  }).then(resp => {
                    if (resp.ok) {
                      console.log('[Recording Script] ✅ Assertion sent successfully:', item.kind, action);
                    } else {
                      console.error('[Recording Script] ❌ Assertion failed:', item.kind, resp.status, resp.statusText);
                    }
                    return resp.json();
                  }).then(data => {
                    console.log('[Recording Script] Server response:', data);
                  }).catch(err => {
                    console.error('[Recording Script] ❌ Failed to send assertion:', item.kind, err);
                  });
                  
                  if (contextMenu) contextMenu.style.display = 'none';
                }
              };
              contextMenu.appendChild(menuItem);
            });
            
            document.body.appendChild(contextMenu);
            console.log('[Recording Script] ✅ Context menu created (page-level)');
          }
          
          function showContextMenu(x, y, element) {
            currentElement = element;
            if (!contextMenu) createContextMenu();
            if (!contextMenu) return;
            
            const clientX = typeof x === 'number' ? x : 0;
            const clientY = typeof y === 'number' ? y : 0;
            
            contextMenu.style.display = 'block';
            contextMenu.style.visibility = 'hidden';
            const menuWidth = contextMenu.offsetWidth || 200;
            const menuHeight = contextMenu.offsetHeight || 250;
            let left = clientX;
            let top = clientY;
            if (left + menuWidth > window.innerWidth) left = clientX - menuWidth;
            if (top + menuHeight > window.innerHeight) top = clientY - menuHeight;
            if (left < 0) left = 10;
            if (top < 0) top = 10;
            contextMenu.style.left = left + 'px';
            contextMenu.style.top = top + 'px';
            contextMenu.style.visibility = 'visible';
            console.log('[Recording Script] ✅ Context menu displayed');
          }
          
          // Attach event listener with highest priority (capture phase) - only if not already attached
          if (!pageLevelListenersAttached) {
            const documentHandler = function(e) {
              try {
                console.log('[Recording Script] 🔵 Right-click intercepted (page-level)!');
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                showContextMenu(e.clientX, e.clientY, e.target);
                return false;
              } catch (err) {
                console.error('[Recording Script] ❌ Error in page-level context menu handler:', err);
                e.preventDefault();
                e.stopPropagation();
                return false;
              }
            };
            
            const windowHandler = function(e) {
              try {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                showContextMenu(e.clientX, e.clientY, e.target);
                return false;
              } catch (err) {
                console.error('[Recording Script] ❌ Error in page-level window context menu handler:', err);
                e.preventDefault();
                e.stopPropagation();
                return false;
              }
            };
            
            document.addEventListener('contextmenu', documentHandler, true);
            window.addEventListener('contextmenu', windowHandler, true);
            pageLevelListenersAttached = true;
            console.log('[Recording Script] ✅ Page-level context menu listeners attached');
          } else {
            console.log('[Recording Script] ⚠️ Page-level context menu listeners already attached, skipping');
          }
          
          // ========== SCROLL EVENT LISTENERS (with debouncing and target detection) ==========
          const scrollDebounceTimers = new Map();
          const SCROLL_DEBOUNCE_MS = 400;
          let lastScrollTime = 0;
          let scrollTargetElement = null;
          let scrollTargetDetectionTimeout = null;
          // Track previous scroll position so we can compute direction (up/down/left/right)
          // for each emitted scroll event. The recorder annotates this on the action
          // payload so replay + test-plan generation can describe scrolls naturally.
          let prevScrollX = window.scrollX || window.pageXOffset || 0;
          let prevScrollY = window.scrollY || window.pageYOffset || 0;
          
          // Track scroll events
          window.addEventListener('scroll', (e) => {
            const now = Date.now();
            lastScrollTime = now;
            
            // Clear existing timer
            if (scrollDebounceTimers.has('scroll')) {
              clearTimeout(scrollDebounceTimers.get('scroll'));
            }
            
            // Set new debounce timer
            const timer = setTimeout(() => {
              const scrollX = window.scrollX || window.pageXOffset || 0;
              const scrollY = window.scrollY || window.pageYOffset || 0;
              const viewportHeight = window.innerHeight;
              const viewportWidth = window.innerWidth;
              
              // Try to detect target element (element at scroll position or center of viewport)
              let targetElement = null;
              
              // Method 1: Check element at center of viewport
              const centerX = viewportWidth / 2;
              const centerY = scrollY + (viewportHeight / 2);
              const elementAtCenter = document.elementFromPoint(centerX, centerY);
              
              // Method 2: Check element at scroll position (top of viewport)
              const elementAtTop = document.elementFromPoint(viewportWidth / 2, scrollY + 10);
              
              // Prefer element at center, fallback to element at top
              targetElement = elementAtCenter || elementAtTop;
              
              // Walk up to find a meaningful element (not body/html)
              if (targetElement) {
                let current = targetElement;
                let depth = 0;
                while (current && depth < 5) {
                  const tag = current.tagName.toLowerCase();
                  if (tag !== 'body' && tag !== 'html' && 
                      (current.id || current.getAttribute('data-testid') || 
                       (current.className && typeof current.className === 'string' && current.className.trim()))) {
                    targetElement = current;
                    break;
                  }
                  current = current.parentElement;
                  depth++;
                }
              }
              
              // Determine scroll mode and build scroll action
              let scrollMode = 'y'; // Default: scroll to Y position
              const documentHeight = document.documentElement.scrollHeight;
              const isAtBottom = scrollY + viewportHeight >= documentHeight - 10; // 10px threshold
              const isAtTop = scrollY <= 10; // 10px threshold
              
              // If we found a target element, prefer element mode
              if (targetElement) {
                const locatorCandidates = buildLocatorCandidates(targetElement);
                if (locatorCandidates && locatorCandidates.length > 0) {
                  const primaryLocatorIndex = getPrimaryLocatorIndex(locatorCandidates);
                  const metadata = extractElementMetadata(targetElement);
                  
                  // Prefer element mode if we have a unique locator
                  const primaryCandidate = locatorCandidates[primaryLocatorIndex];
                  if (primaryCandidate && primaryCandidate.unique) {
                    scrollMode = 'element';
                  }
                  
                  // Compute direction relative to the previous emitted scroll. We
                  // prefer vertical direction since real users scroll vertically,
                  // but record the horizontal axis when it dominates.
                  const dy = scrollY - prevScrollY;
                  const dx = scrollX - prevScrollX;
                  const direction = Math.abs(dy) >= Math.abs(dx)
                    ? (dy >= 0 ? 'down' : 'up')
                    : (dx >= 0 ? 'right' : 'left');
                  prevScrollX = scrollX;
                  prevScrollY = scrollY;

                  // Build scroll action with element data
                  const scrollData = {
                    sessionId: sessionId,
                    kind: 'scroll',
                    scrollX: scrollX,
                    scrollY: scrollY,
                    direction: direction,
                    reason: 'element_search',
                    pageUrl: window.location && window.location.href ? window.location.href : null,
                    viewportHeight: viewportHeight,
                    viewportWidth: viewportWidth,
                    scroll: {
                      mode: scrollMode,
                      y: scrollY,
                      direction: direction,
                      reason: 'element_search',
                      locatorCandidates: locatorCandidates,
                      primaryLocatorIndex: primaryLocatorIndex,
                      targetElementVisibleAfter: true
                    },
                    targetElementMetadata: metadata,
                    timestamp: Date.now()
                  };

                  console.log('[Scroll] 📜 Recorded ' + direction + ' to y=' + scrollY + ' (target=' + (metadata && metadata.tag ? metadata.tag : 'unknown') + ')');
                  
                  // Send scroll action to server
                  fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(scrollData)
                  }).then(resp => {
                    if (resp.ok) {
                      console.log('[Recording Script] ✅ Scroll action sent successfully');
                    } else {
                      console.error('[Recording Script] ❌ Scroll action failed:', resp.status);
                    }
                  }).catch(err => console.error('[Recording Script] ❌ Failed to send scroll:', err));
                  
                  scrollDebounceTimers.delete('scroll');
                  return;
                }
              }
              
              // No target element or no good locators - use position-based modes
              if (isAtBottom) {
                scrollMode = 'bottom';
              } else if (isAtTop) {
                scrollMode = 'top';
              }
              
              // Compute direction (no target element form).
              const dy2 = scrollY - prevScrollY;
              const dx2 = scrollX - prevScrollX;
              const direction2 = Math.abs(dy2) >= Math.abs(dx2)
                ? (dy2 >= 0 ? 'down' : 'up')
                : (dx2 >= 0 ? 'right' : 'left');
              prevScrollX = scrollX;
              prevScrollY = scrollY;

              // Build scroll action without element
              const scrollData = {
                sessionId: sessionId,
                kind: 'scroll',
                scrollX: scrollX,
                scrollY: scrollY,
                direction: direction2,
                reason: 'page_explore',
                pageUrl: window.location && window.location.href ? window.location.href : null,
                viewportHeight: viewportHeight,
                viewportWidth: viewportWidth,
                scroll: {
                  mode: scrollMode,
                  y: scrollY,
                  direction: direction2,
                  reason: 'page_explore'
                },
                timestamp: Date.now()
              };

              console.log('[Scroll] 📜 Recorded ' + direction2 + ' to y=' + scrollY + ' (mode=' + scrollMode + ')');
              
              // Send scroll action to server
              fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(scrollData)
              }).then(resp => {
                if (resp.ok) {
                  console.log('[Recording Script] ✅ Scroll action sent successfully');
                } else {
                  console.error('[Recording Script] ❌ Scroll action failed:', resp.status);
                }
              }).catch(err => console.error('[Recording Script] ❌ Failed to send scroll:', err));
              
              scrollDebounceTimers.delete('scroll');
            }, SCROLL_DEBOUNCE_MS);
            
            scrollDebounceTimers.set('scroll', timer);
          }, true);
          
          // Detect target element after scroll stops (for better accuracy)
          window.addEventListener('scroll', () => {
            // Clear existing detection timeout
            if (scrollTargetDetectionTimeout) {
              clearTimeout(scrollTargetDetectionTimeout);
            }
            
            // Set timeout to detect target element after scroll stops
            scrollTargetDetectionTimeout = setTimeout(() => {
              const scrollY = window.scrollY || window.pageYOffset || 0;
              const viewportHeight = window.innerHeight;
              const centerY = scrollY + (viewportHeight / 2);
              const elementAtCenter = document.elementFromPoint(window.innerWidth / 2, centerY);
              
              if (elementAtCenter) {
                scrollTargetElement = elementAtCenter;
              }
            }, 200);
          }, true);
          
          // ========== INPUT EVENT LISTENERS (for text input recording) ==========
          // These need to be in page-level injection to catch dynamically created elements
          
          // ========== LOCATOR CANDIDATE GENERATION ==========
          // Build comprehensive LocatorCandidate[] with stability scores and code examples
          
          /**
           * Generate code examples for a locator candidate
           */
          function generateCodeExamples(selector, type) {
            let seleniumExample = '';
            let playwrightExample = '';
            
            if (type === 'url') {
              seleniumExample = 'driver.get("' + selector + '");';
              playwrightExample = 'await page.goto("' + selector + '");';
            } else if (type === 'id') {
              const id = selector.replace('#', '');
              seleniumExample = 'By.id("' + id + '")';
              playwrightExample = 'page.locator("' + selector + '")';
            } else if (type === 'data-testid') {
              const testId = selector.match(/data-testid="([^"]+)"/)?.[1] || '';
              seleniumExample = 'By.cssSelector("[data-testid=\'' + testId + '\']")';
              playwrightExample = 'page.getByTestId("' + testId + '")';
            } else if (type === 'data-id') {
              const dataId = selector.match(/data-id="([^"]+)"/)?.[1] || '';
              seleniumExample = 'By.cssSelector("[data-id=\'' + dataId + '\']")';
              playwrightExample = 'page.locator("' + selector + '")';
            } else if (type === 'name') {
              const name = selector.match(/name="([^"]+)"/)?.[1] || '';
              seleniumExample = 'By.name("' + name + '")';
              playwrightExample = 'page.locator("' + selector + '")';
            } else if (type === 'aria') {
              const ariaLabel = selector.match(/aria-label="([^"]+)"/)?.[1] || '';
              seleniumExample = 'By.cssSelector("[aria-label=\'' + ariaLabel + '\']")';
              playwrightExample = 'page.getByRole(..., { name: "' + ariaLabel + '" })';
            } else if (type === 'role+text') {
              const parts = selector.split(' >> ');
              const role = parts[0].replace('role=', '');
              const text = parts[1]?.replace('text=', '').replace(/"/g, '') || '';
              seleniumExample = 'By.xpath("//*[@role=\'' + role + '\' and normalize-space()=\'' + text + '\']")';
              playwrightExample = 'page.getByRole(\'' + role + '\', { name: "' + text + '" })';
            } else if (type === 'text') {
              const text = selector.replace('text=', '').replace(/"/g, '');
              seleniumExample = 'By.xpath("//*[normalize-space()=\'' + text.substring(0, 30) + '\']")';
              playwrightExample = 'page.locator("' + selector + '")';
            } else if (type === 'smart-path') {
              seleniumExample = 'By.cssSelector("' + selector + '")';
              playwrightExample = 'page.locator("' + selector + '")';
            } else if (type === 'css') {
              seleniumExample = 'By.cssSelector("' + selector + '")';
              playwrightExample = 'page.locator("' + selector + '")';
            } else if (type === 'xpath') {
              const xpath = selector.replace('xpath=', '');
              seleniumExample = 'By.xpath("' + xpath + '")';
              playwrightExample = 'page.locator("' + xpath + '")';
            }
            
            return { seleniumExample, playwrightExample };
          }
          
          /**
           * Build comprehensive LocatorCandidate[] for an element
           * Returns array of candidates sorted by stability and uniqueness
           */
          function buildLocatorCandidates(element) {
            if (!element) return [];
            
            const candidates = [];
            const tag = element.tagName.toLowerCase();
            const text = (element.textContent && element.textContent.trim()) || '';
            const role = element.getAttribute('role');
            
            // 1. ID selector (stability: 100) - CSS and XPath
            if (element.id) {
              // CSS ID selector
              const cssSelector = '#' + element.id;
              const cssUniqueness = checkSelectorUniqueness(cssSelector, element);
              const cssCodeExamples = generateCodeExamples(cssSelector, 'id');
              candidates.push({
                selector: cssSelector,
                xpath: '//*[@id=\'' + element.id.replace(/'/g, "\\'") + '\']',
                type: 'id',
                unique: cssUniqueness.unique,
                matchCount: cssUniqueness.count,
                stabilityScore: 100,
                description: 'ID: ' + cssSelector,
                seleniumExample: cssCodeExamples.seleniumExample,
                playwrightExample: cssCodeExamples.playwrightExample
              });
            }
            
            // 2. data-testid (stability: 100) - CSS and XPath
            const dataTestId = element.getAttribute('data-testid');
            if (dataTestId) {
              const escapedTestId = dataTestId.replace(/'/g, "\\'");
              const cssSelector = '[data-testid="' + dataTestId + '"]';
              const xpathSelector = '//*[@data-testid=\'' + escapedTestId + '\']';
              const cssUniqueness = checkSelectorUniqueness(cssSelector, element);
              const codeExamples = generateCodeExamples(cssSelector, 'data-testid');
              candidates.push({
                selector: cssSelector,
                xpath: xpathSelector,
                type: 'data-testid',
                unique: cssUniqueness.unique,
                matchCount: cssUniqueness.count,
                stabilityScore: 100,
                description: 'data-testid: ' + dataTestId,
                seleniumExample: codeExamples.seleniumExample,
                playwrightExample: codeExamples.playwrightExample
              });
            }
            
            // 3. data-id (stability: 95) - CSS and XPath
            const dataId = element.getAttribute('data-id');
            if (dataId) {
              const escapedDataId = dataId.replace(/'/g, "\\'");
              const cssSelector = '[data-id="' + dataId + '"]';
              const xpathSelector = '//*[@data-id=\'' + escapedDataId + '\']';
              const cssUniqueness = checkSelectorUniqueness(cssSelector, element);
              const codeExamples = generateCodeExamples(cssSelector, 'data-id');
              candidates.push({
                selector: cssSelector,
                xpath: xpathSelector,
                type: 'data-id',
                unique: cssUniqueness.unique,
                matchCount: cssUniqueness.count,
                stabilityScore: 95,
                description: 'data-id: ' + dataId,
                seleniumExample: codeExamples.seleniumExample,
                playwrightExample: codeExamples.playwrightExample
              });
            }
            
            // 4. name attribute (stability: 75) - CSS and XPath
            if (element.name && (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'button')) {
              const escapedName = element.name.replace(/'/g, "\\'");
              const cssSelector = '[name="' + element.name + '"]';
              const xpathSelector = '//*[@name=\'' + escapedName + '\']';
              const cssUniqueness = checkSelectorUniqueness(cssSelector, element);
              if (cssUniqueness.count <= 3) {
                const codeExamples = generateCodeExamples(cssSelector, 'name');
                candidates.push({
                  selector: cssSelector,
                  xpath: xpathSelector,
                  type: 'name',
                  unique: cssUniqueness.unique,
                  matchCount: cssUniqueness.count,
                  stabilityScore: 75,
                  description: 'name: ' + element.name,
                  seleniumExample: codeExamples.seleniumExample,
                  playwrightExample: codeExamples.playwrightExample
                });
              }
            }
            
            // 5. aria-label (stability: 75) - CSS and XPath
            const ariaLabel = element.getAttribute('aria-label');
            if (ariaLabel) {
              const escapedAriaLabel = ariaLabel.replace(/'/g, "\\'");
              const cssSelector = '[aria-label="' + ariaLabel + '"]';
              const xpathSelector = '//*[@aria-label=\'' + escapedAriaLabel + '\']';
              const cssUniqueness = checkSelectorUniqueness(cssSelector, element);
              if (cssUniqueness.count <= 2) {
                const codeExamples = generateCodeExamples(cssSelector, 'aria');
                candidates.push({
                  selector: cssSelector,
                  xpath: xpathSelector,
                  type: 'aria',
                  unique: cssUniqueness.unique,
                  matchCount: cssUniqueness.count,
                  stabilityScore: 75,
                  description: 'aria-label: ' + ariaLabel,
                  seleniumExample: codeExamples.seleniumExample,
                  playwrightExample: codeExamples.playwrightExample
                });
              }
            }
            
            // 6. Role + text (stability: 95) - Playwright role selector and XPath
            if (role && text && text.length > 0 && text.length < 100) {
              const roleSelector = 'role=' + role;
              const uniqueness = checkSelectorUniqueness(roleSelector, element);
              if (uniqueness.unique || uniqueness.count <= 3) {
                const escapedText = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                const escapedTextXPath = text.trim().replace(/'/g, "\\'");
                const combinedSelector = roleSelector + ' >> text="' + escapedText + '"';
                // Generate XPath for role + text: //tag[@role='role' and normalize-space()='text']
                const xpathSelector = '//' + tag + '[@role=\'' + role + '\' and normalize-space()=\'' + escapedTextXPath + '\']';
                const codeExamples = generateCodeExamples(combinedSelector, 'role+text');
                candidates.push({
                  selector: combinedSelector,
                  xpath: xpathSelector,
                  type: 'role+text',
                  unique: uniqueness.unique,
                  matchCount: uniqueness.count,
                  stabilityScore: 95,
                  description: 'Role + Text: ' + role + ' with "' + (text.length > 30 ? text.substring(0, 30) + '...' : text) + '"',
                  seleniumExample: codeExamples.seleniumExample,
                  playwrightExample: codeExamples.playwrightExample
                });
              }
            }
            
            // 7. Text selector (stability: 80) - Playwright text selector and XPath
            if (text && text.length > 0) {
              const textToUse = text.length < 100 ? text.trim() : text.trim().substring(0, 50);
              const escapedText = textToUse.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
              const escapedTextXPath = textToUse.replace(/'/g, "\\'");
              const selector = 'text="' + escapedText + '"';
              // Generate XPath: //tag[normalize-space()='text'] for exact match, or contains for long text
              const xpathSelector = textToUse.length < 50 
                ? '//' + tag + '[normalize-space()=\'' + escapedTextXPath + '\']'
                : '//' + tag + '[contains(normalize-space(), \'' + escapedTextXPath.substring(0, 30) + '\')]';
              const uniqueness = checkSelectorUniqueness(selector, element);
              if (uniqueness.unique || uniqueness.count <= 2) {
                const codeExamples = generateCodeExamples(selector, 'text');
                candidates.push({
                  selector: selector,
                  xpath: xpathSelector,
                  type: 'text',
                  unique: uniqueness.unique,
                  matchCount: uniqueness.count,
                  stabilityScore: 80,
                  description: 'Text: "' + (text.length > 40 ? text.substring(0, 40) + '...' : text) + '"',
                  seleniumExample: codeExamples.seleniumExample,
                  playwrightExample: codeExamples.playwrightExample
                });
              }
            }
            
            // 8. Smart path (stability: 90) - build context-aware XPath selectors (preferred over CSS chains)
            let parent = element.parentElement;
            let ancestorDepth = 0;
            const maxAncestorDepth = 3; // Limit depth to avoid long paths
            
            // Helper to build element XPath part
            const buildElementXPath = (el) => {
              if (el.id) {
                return '//*[@id=\'' + el.id.replace(/'/g, "\\'") + '\']';
              } else if (el.getAttribute('data-testid')) {
                const testId = el.getAttribute('data-testid').replace(/'/g, "\\'");
                return '//*[@data-testid=\'' + testId + '\']';
              } else if (text && text.length > 0 && text.length < 50) {
                const escapedText = text.trim().replace(/'/g, "\\'");
                return '//' + tag + '[normalize-space()=\'' + escapedText + '\']';
              } else {
                return '//' + tag;
              }
            };
            
            while (parent && ancestorDepth < maxAncestorDepth) {
              const parentTag = parent.tagName.toLowerCase();
              if (parentTag === 'body' || parentTag === 'html') {
                parent = parent.parentElement;
                ancestorDepth++;
                continue;
              }
              
              let smartXPath = null;
              let smartCssSelector = null;
              let smartDescription = '';
              
              if (parent.id) {
                // Use parent ID with XPath (preferred) and CSS (fallback)
                const parentIdEscaped = parent.id.replace(/'/g, "\\'");
                const elementXPath = buildElementXPath(element);
                smartXPath = '//*[@id=\'' + parentIdEscaped + '\']' + (elementXPath.startsWith('//') ? elementXPath.substring(2) : elementXPath);
                smartCssSelector = '#' + parent.id + ' >> ' + (element.id ? '#' + element.id : 
                                   dataTestId ? '[data-testid="' + dataTestId + '"]' :
                                   text && text.length < 50 ? 'text="' + text.replace(/"/g, '\\"') + '"' :
                                   tag);
                smartDescription = 'Smart XPath: //*[@id=\'' + parent.id + '\']//' + tag;
                
                const xpathUniqueness = checkSelectorUniqueness('xpath=' + smartXPath, element);
                if (xpathUniqueness.unique) {
                  const codeExamples = generateCodeExamples(smartCssSelector, 'smart-path');
                  candidates.push({
                    selector: smartCssSelector,
                    xpath: smartXPath,
                    type: 'smart-path',
                    unique: true,
                    matchCount: 1,
                    stabilityScore: 90,
                    description: smartDescription,
                    seleniumExample: codeExamples.seleniumExample,
                    playwrightExample: codeExamples.playwrightExample
                  });
                  break; // Found good smart path, stop
                }
              } else if (parent.getAttribute('data-testid')) {
                // Use parent data-testid with XPath
                const parentTestId = parent.getAttribute('data-testid').replace(/'/g, "\\'");
                const elementXPath = buildElementXPath(element);
                smartXPath = '//*[@data-testid=\'' + parentTestId + '\']' + (elementXPath.startsWith('//') ? elementXPath.substring(2) : elementXPath);
                smartCssSelector = '[data-testid="' + parent.getAttribute('data-testid') + '"] >> ' + 
                                   (element.id ? '#' + element.id : 
                                    dataTestId ? '[data-testid="' + dataTestId + '"]' :
                                    text && text.length < 50 ? 'text="' + text.replace(/"/g, '\\"') + '"' :
                                    tag);
                smartDescription = 'Smart XPath: //*[@data-testid=\'' + parent.getAttribute('data-testid') + '\']//' + tag;
                
                const xpathUniqueness = checkSelectorUniqueness('xpath=' + smartXPath, element);
                if (xpathUniqueness.unique) {
                  const codeExamples = generateCodeExamples(smartCssSelector, 'smart-path');
                  candidates.push({
                    selector: smartCssSelector,
                    xpath: smartXPath,
                    type: 'smart-path',
                    unique: true,
                    matchCount: 1,
                    stabilityScore: 90,
                    description: smartDescription,
                    seleniumExample: codeExamples.seleniumExample,
                    playwrightExample: codeExamples.playwrightExample
                  });
                  break; // Found good smart path, stop
                }
              } else if (parent.className && typeof parent.className === 'string') {
                const parentClasses = parent.className.split(' ').filter(c => {
                  const clean = c.trim();
                  return clean && 
                         !clean.startsWith('css-') && 
                         !clean.startsWith('ng-') && 
                         !clean.startsWith('_') &&
                         clean.length > 2;
                });
                if (parentClasses.length > 0) {
                  const parentClassEscaped = parentClasses[0].replace(/'/g, "\\'");
                  const elementXPath = buildElementXPath(element);
                  smartXPath = '//*[contains(@class, \'' + parentClassEscaped + '\')]' + (elementXPath.startsWith('//') ? elementXPath.substring(2) : elementXPath);
                  smartCssSelector = '.' + parentClasses[0] + ' >> ' + 
                                     (element.id ? '#' + element.id : 
                                      dataTestId ? '[data-testid="' + dataTestId + '"]' :
                                      text && text.length < 50 ? 'text="' + text.replace(/"/g, '\\"') + '"' :
                                      tag);
                  smartDescription = 'Smart XPath: //*[contains(@class, \'' + parentClasses[0] + '\')]//' + tag;
                  
                  const xpathUniqueness = checkSelectorUniqueness('xpath=' + smartXPath, element);
                  if (xpathUniqueness.unique) {
                    const codeExamples = generateCodeExamples(smartCssSelector, 'smart-path');
                    candidates.push({
                      selector: smartCssSelector,
                      xpath: smartXPath,
                      type: 'smart-path',
                      unique: true,
                      matchCount: 1,
                      stabilityScore: 90,
                      description: smartDescription,
                      seleniumExample: codeExamples.seleniumExample,
                      playwrightExample: codeExamples.playwrightExample
                    });
                    break; // Found good smart path, stop
                  }
                }
              }
              
              if (parent.id || parent.getAttribute('data-testid') || 
                  (parent.className && parent.className.split(' ').some(c => c && !c.startsWith('css-')))) {
                break; // Found meaningful parent, stop searching
              }
              parent = parent.parentElement;
              ancestorDepth++;
            }
            
            // 9. CSS class selector (stability: 60)
            if (element.className && typeof element.className === 'string') {
              const meaningfulClasses = element.className.split(' ').filter(c => {
                const clean = c.trim();
                return clean && 
                       !clean.startsWith('css-') && 
                       !clean.startsWith('ng-') && 
                       !clean.startsWith('_') &&
                       clean.length > 2;
              });
              if (meaningfulClasses.length > 0) {
                const selector = tag + '.' + meaningfulClasses.map(c => c.trim()).join('.');
                const uniqueness = checkSelectorUniqueness(selector, element);
                if (uniqueness.count <= 3) {
                  const codeExamples = generateCodeExamples(selector, 'css');
                  candidates.push({
                    selector: selector,
                    type: 'css',
                    unique: uniqueness.unique,
                    matchCount: uniqueness.count,
                    stabilityScore: 60,
                    description: 'CSS: ' + selector,
                    seleniumExample: codeExamples.seleniumExample,
                    playwrightExample: codeExamples.playwrightExample
                  });
                }
              }
            }
            
            // ════════════════════════════════════════════════════════
            // TIER 3 — additional locator strategies (T3.4, T3.7)
            // ════════════════════════════════════════════════════════

            // T3.7 — Dynamic-ID handling. Many React/Angular apps emit
            // ids like "btn-1234" or "field-xyz-456" that change every
            // build. If the element's id contains a numeric tail (or a
            // hash-looking suffix), also generate a stable
            // contains(@id,'prefix') / [id^="prefix"] selector keyed
            // off the prefix, so the next build still matches.
            if (element.id) {
              const m = String(element.id).match(/^([a-zA-Z][a-zA-Z_-]+?)[-_]?(?:\d+|[a-f0-9]{6,})$/);
              if (m && m[1] && m[1].length >= 3) {
                const prefix = m[1];
                const cssPrefix = '[id^="' + prefix + '"]';
                const xpathPrefix = '//*[starts-with(@id, \'' + prefix.replace(/'/g, "\\'") + '\')]';
                const cssU = checkSelectorUniqueness(cssPrefix, element);
                if (cssU.count <= 5) {
                  const codeExamples = generateCodeExamples(cssPrefix, 'attribute');
                  candidates.push({
                    selector: cssPrefix,
                    xpath: xpathPrefix,
                    type: 'dynamic-id-prefix',
                    unique: cssU.unique,
                    matchCount: cssU.count,
                    stabilityScore: cssU.unique ? 70 : 55,
                    description: 'dynamic id prefix: ' + prefix,
                    seleniumExample: codeExamples.seleniumExample,
                    playwrightExample: codeExamples.playwrightExample
                  });
                }
              }
            }

            // T3.4 — Following / preceding sibling XPath.
            // Useful when the recorded element has no stable attributes
            // BUT a sibling with stable text/role exists. Common pattern:
            // a label sits next to an unmarked input. Generate
            // //label[text()='Email']/following-sibling::input[1].
            if (element.parentElement) {
              const sibs = Array.from(element.parentElement.children);
              const myIdx = sibs.indexOf(element);
              // Look at the immediately preceding sibling for an anchor.
              if (myIdx > 0) {
                const prev = sibs[myIdx - 1];
                const prevText = (prev.textContent || '').trim();
                if (prevText && prevText.length > 0 && prevText.length < 60 && /\S/.test(prevText)) {
                  const escTxt = prevText.replace(/'/g, "\\'");
                  const xpathSel = 'xpath=//' + prev.tagName.toLowerCase() +
                    "[normalize-space(.)='" + escTxt + "']/following-sibling::" + tag + '[1]';
                  const u = checkSelectorUniqueness(xpathSel, element);
                  if (u.count <= 2) {
                    const codeExamples = generateCodeExamples(xpathSel, 'xpath');
                    candidates.push({
                      selector: xpathSel,
                      type: 'sibling-xpath',
                      unique: u.unique,
                      matchCount: u.count,
                      stabilityScore: 60,
                      description: 'following-sibling of "' + prevText.slice(0, 30) + '"',
                      seleniumExample: codeExamples.seleniumExample,
                      playwrightExample: codeExamples.playwrightExample
                    });
                  }
                }
              }
              // Look at the immediately following sibling too (less common
              // but useful when the input precedes its label).
              if (myIdx >= 0 && myIdx < sibs.length - 1) {
                const next = sibs[myIdx + 1];
                const nextText = (next.textContent || '').trim();
                if (nextText && nextText.length > 0 && nextText.length < 60 && /\S/.test(nextText)) {
                  const escTxt = nextText.replace(/'/g, "\\'");
                  const xpathSel = 'xpath=//' + next.tagName.toLowerCase() +
                    "[normalize-space(.)='" + escTxt + "']/preceding-sibling::" + tag + '[1]';
                  const u = checkSelectorUniqueness(xpathSel, element);
                  if (u.count <= 2) {
                    const codeExamples = generateCodeExamples(xpathSel, 'xpath');
                    candidates.push({
                      selector: xpathSel,
                      type: 'sibling-xpath',
                      unique: u.unique,
                      matchCount: u.count,
                      stabilityScore: 58,
                      description: 'preceding-sibling of "' + nextText.slice(0, 30) + '"',
                      seleniumExample: codeExamples.seleniumExample,
                      playwrightExample: codeExamples.playwrightExample
                    });
                  }
                }
              }
            }

            // 10. XPath (stability: 40) - last resort
            if (element.parentElement) {
              const siblings = Array.from(element.parentElement.children).filter(el => el.tagName === element.tagName);
              if (siblings.length > 1) {
                const index = siblings.indexOf(element) + 1;
                const selector = 'xpath=//' + tag + '[' + index + ']';
                const uniqueness = checkSelectorUniqueness(selector, element);
                if (uniqueness.count <= 2) {
                  const codeExamples = generateCodeExamples(selector, 'xpath');
                  candidates.push({
                    selector: selector,
                    type: 'xpath',
                    unique: uniqueness.unique,
                    matchCount: uniqueness.count,
                    stabilityScore: 40,
                    description: 'XPath: //' + tag + '[' + index + ']',
                    seleniumExample: codeExamples.seleniumExample,
                    playwrightExample: codeExamples.playwrightExample
                  });
                }
              }
            }

            // T3.8 — Cross-selector duplicate detection.
            // Two DIFFERENT selectors might resolve to the SAME element.
            // That's actually fine — but two different selectors that
            // resolve to DIFFERENT elements is a flag we want surfaced
            // so the user knows the candidate pool isn't aliasing the
            // same node. We detect by querying each candidate and
            // hashing the matched element's outerHTML; collisions mean
            // candidates are equivalent and we can drop low-quality
            // duplicates.
            try {
              const seenTargets = new Map(); // outerHTML hash → first selector index
              const drop = new Set();
              for (let ci = 0; ci < candidates.length; ci++) {
                const c = candidates[ci];
                if (!c || !c.selector) continue;
                let target = null;
                try {
                  target = document.querySelector(c.selector);
                } catch (_e) {
                  // Playwright-extended selectors (xpath=, text=, role=)
                  // may not be valid CSS. Skip equivalence detection for
                  // those — keep them in the pool unconditionally.
                  continue;
                }
                if (!target) continue;
                const sig = (target.outerHTML || '').slice(0, 256);
                if (seenTargets.has(sig)) {
                  // Duplicate target. Keep the higher stabilityScore.
                  const firstIdx = seenTargets.get(sig);
                  if ((candidates[firstIdx].stabilityScore || 0) < (c.stabilityScore || 0)) {
                    drop.add(firstIdx);
                    seenTargets.set(sig, ci);
                  } else {
                    drop.add(ci);
                  }
                } else {
                  seenTargets.set(sig, ci);
                }
              }
              if (drop.size > 0) {
                for (let i = candidates.length - 1; i >= 0; i--) {
                  if (drop.has(i)) candidates.splice(i, 1);
                }
              }
            } catch (_dedupeErr) { /* best-effort dedup; keep candidates as-is on failure */ }

            // Sort candidates: unique first, then by stability score, then by match count
            candidates.sort((a, b) => {
              if (a.unique !== b.unique) return a.unique ? -1 : 1;
              if (a.stabilityScore !== b.stabilityScore) return b.stabilityScore - a.stabilityScore;
              return a.matchCount - b.matchCount;
            });
            
            return candidates;
          }
          
          /**
           * Determine the best primary locator index from candidates
           * Prefers unique, high-stability candidates
           */
          function getPrimaryLocatorIndex(candidates, excludeUrl = false) {
            if (!candidates || candidates.length === 0) return 0;
            
            // Filter out URL candidates if requested
            const filtered = excludeUrl ? candidates.filter(c => c.type !== 'url') : candidates;
            if (filtered.length === 0) return 0;
            
            // Find best unique candidate
            const uniqueCandidates = filtered.filter(c => c.unique);
            if (uniqueCandidates.length > 0) {
              // Return index of highest stability unique candidate
              const best = uniqueCandidates.reduce((best, current) => 
                current.stabilityScore > best.stabilityScore ? current : best
              );
              return candidates.indexOf(best);
            }
            
            // No unique candidates, find best by stability and match count
            const best = filtered.reduce((best, current) => {
              if (current.stabilityScore > best.stabilityScore) return current;
              if (current.stabilityScore === best.stabilityScore && current.matchCount < best.matchCount) return current;
              return best;
            });
            
            return candidates.indexOf(best);
          }
          
          // Helper function to get the nearest clickable ancestor element
          function getClickableElement(element) {
            if (!element) return null;
            let current = element;
            let maxDepth = 10;
            let depth = 0;
            while (current && depth < maxDepth) {
              const tag = current.tagName.toLowerCase();
              const role = current.getAttribute('role');
              const hasHref = current.hasAttribute('href');
              const hasOnClick = current.onclick !== null || current.getAttribute('onclick');
              const tabIndex = current.getAttribute('tabindex');
              const isClickable = 
                tag === 'a' || 
                tag === 'button' ||
                (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(current.type)) ||
                role === 'button' ||
                role === 'link' ||
                hasHref ||
                hasOnClick ||
                (tabIndex !== null && parseInt(tabIndex) >= 0);
              if (isClickable) {
                return current;
              }
              current = current.parentElement;
              depth++;
            }
            return element;
          }
          
          // Helper function to check if a selector matches multiple elements
          function checkSelectorUniqueness(selector, targetElement) {
            if (!selector || !targetElement) return { unique: true, count: 0, suggestions: [] };
            
            try {
              let matches = [];
              let selectorType = 'css';
              
              // Determine selector type and find matches
              if (selector.startsWith('text=')) {
                // Playwright text selector - count elements with matching text (visible only)
                const text = selector.substring(5).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                matches = Array.from(document.querySelectorAll('*')).filter(el => {
                  // Skip hidden elements
                  const style = window.getComputedStyle(el);
                  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                    return false;
                  }
                  const elText = (el.textContent || '').trim();
                  return elText === text || (text.length > 20 && elText.includes(text));
                });
                selectorType = 'text';
              } else if (selector.startsWith('role=')) {
                // Playwright role selector
                const role = selector.substring(5);
                matches = Array.from(document.querySelectorAll('[role="' + role + '"]'));
                selectorType = 'role';
              } else if (selector.startsWith('xpath=') || selector.startsWith('//')) {
                // XPath selector
                const xpath = selector.startsWith('xpath=') ? selector.substring(6) : selector;
                try {
                  const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                  matches = [];
                  for (let i = 0; i < result.snapshotLength; i++) {
                    matches.push(result.snapshotItem(i));
                  }
                } catch (e) {
                  // Invalid XPath
                  return { unique: false, count: 0, suggestions: [], error: 'Invalid XPath' };
                }
                selectorType = 'xpath';
              } else {
                // CSS selector
                try {
                  matches = Array.from(document.querySelectorAll(selector));
                } catch (e) {
                  // Invalid CSS selector
                  return { unique: false, count: 0, suggestions: [], error: 'Invalid CSS selector' };
                }
              }
              
              const count = matches.length;
              const isUnique = count === 1;
              const suggestions = [];
              
              // If not unique, generate context-aware suggestions
              if (!isUnique && count > 1) {
                let parent = targetElement.parentElement;
                let ancestorDepth = 0;
                const maxAncestorDepth = 5;
                
                // Walk up ancestors to find a good parent context
                while (parent && ancestorDepth < maxAncestorDepth) {
                  const parentTag = parent.tagName.toLowerCase();
                  if (parentTag === 'body' || parentTag === 'html') {
                    parent = parent.parentElement;
                    ancestorDepth++;
                    continue;
                  }
                  
                  // Try parent with ID
                  if (parent.id) {
                    const parentIdSelector = '#' + parent.id;
                    suggestions.push(parentIdSelector + ' ' + selector);
                    suggestions.push(parentIdSelector + ' > ' + targetElement.tagName.toLowerCase());
                    const siblings = Array.from(parent.children);
                    const index = siblings.indexOf(targetElement);
                    if (index >= 0) {
                      suggestions.push(parentIdSelector + ' > ' + targetElement.tagName.toLowerCase() + ':nth-child(' + (index + 1) + ')');
                      suggestions.push(parentIdSelector + ' > ' + targetElement.tagName.toLowerCase() + ':nth-of-type(' + (siblings.filter(s => s.tagName === targetElement.tagName).indexOf(targetElement) + 1) + ')');
                    }
                  }
                  
                  // Try parent with meaningful class
                  if (parent.className && typeof parent.className === 'string') {
                    const parentClasses = parent.className.split(' ').filter(c => {
                      const clean = c.trim();
                      return clean && 
                             !clean.startsWith('css-') && 
                             !clean.startsWith('ng-') && 
                             !clean.startsWith('_') &&
                             clean.length > 2;
                    });
                    if (parentClasses.length > 0) {
                      const parentClassSelector = '.' + parentClasses[0];
                      suggestions.push(parentClassSelector + ' ' + selector);
                      const siblings = Array.from(parent.children);
                      const index = siblings.indexOf(targetElement);
                      if (index >= 0) {
                        suggestions.push(parentClassSelector + ' > ' + targetElement.tagName.toLowerCase() + ':nth-child(' + (index + 1) + ')');
                      }
                    }
                  }
                  
                  // Try parent with data-testid
                  if (parent.getAttribute('data-testid')) {
                    const parentTestId = '[data-testid="' + parent.getAttribute('data-testid') + '"]';
                    suggestions.push(parentTestId + ' ' + selector);
                  }
                  
                  // If we found a good parent context, break
                  if (parent.id || (parent.className && parent.className.split(' ').some(c => c && !c.startsWith('css-') && !c.startsWith('ng-')))) {
                    break;
                  }
                  
                  parent = parent.parentElement;
                  ancestorDepth++;
                }
                
                // Add text-based suggestions
                const text = targetElement.textContent && targetElement.textContent.trim();
                if (text && text.length > 0 && text.length < 50) {
                  if (selectorType === 'css') {
                    const escapedText = text.substring(0, 30).replace(/"/g, '\\"');
                    suggestions.push(selector + ':has-text("' + escapedText + '")');
                  }
                  const escapedText = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                  suggestions.push('text=' + escapedText);
                }
                
                // Add data attribute suggestions
                if (targetElement.getAttribute('data-testid')) {
                  suggestions.push('[data-testid="' + targetElement.getAttribute('data-testid') + '"]');
                }
                if (targetElement.getAttribute('data-id')) {
                  suggestions.push('[data-id="' + targetElement.getAttribute('data-id') + '"]');
                }
              }
              
              return {
                unique: isUnique,
                count: count,
                suggestions: suggestions,
                selectorType: selectorType
              };
            } catch (error) {
              return { unique: true, count: 0, suggestions: [], error: error.message };
            }
          }
          
          // Helper function to build context-aware selector using parent/ancestor
          function buildContextAwareSelector(element, baseSelector, parent) {
            if (!parent || !element) return null;
            const parentTag = parent.tagName.toLowerCase();
            if (parentTag === 'body' || parentTag === 'html') return null;
            if (parent.id) {
              const contextSelector = '#' + parent.id + ' ' + baseSelector;
              const uniqueness = checkSelectorUniqueness(contextSelector, element);
              if (uniqueness.unique) return contextSelector;
              const directChildSelector = '#' + parent.id + ' > ' + baseSelector;
              const directUniqueness = checkSelectorUniqueness(directChildSelector, element);
              if (directUniqueness.unique) return directChildSelector;
              const siblings = Array.from(parent.children);
              const index = siblings.indexOf(element);
              if (index >= 0) {
                const tag = element.tagName.toLowerCase();
                const nthChildSelector = '#' + parent.id + ' > ' + tag + ':nth-child(' + (index + 1) + ')';
                const nthUniqueness = checkSelectorUniqueness(nthChildSelector, element);
                if (nthUniqueness.unique) return nthChildSelector;
              }
            }
            if (parent.className && typeof parent.className === 'string') {
              const parentClasses = parent.className.split(' ').filter(c => {
                const clean = c.trim();
                return clean && 
                       !clean.startsWith('css-') && 
                       !clean.startsWith('ng-') && 
                       !clean.startsWith('_') &&
                       clean.length > 2;
              });
              if (parentClasses.length > 0) {
                const contextSelector = '.' + parentClasses[0] + ' ' + baseSelector;
                const uniqueness = checkSelectorUniqueness(contextSelector, element);
                if (uniqueness.unique) return contextSelector;
              }
            }
            if (parent.getAttribute('data-testid')) {
              const contextSelector = '[data-testid="' + parent.getAttribute('data-testid') + '"] ' + baseSelector;
              const uniqueness = checkSelectorUniqueness(contextSelector, element);
              if (uniqueness.unique) return contextSelector;
            }
            return null;
          }
          
          // Helper functions for input recording (same improved logic as context-level)
          function getElementSelector(element) {
            if (!element) return null;
            const tag = element.tagName.toLowerCase();
            const isGenericElement = tag === 'span' || tag === 'div' || tag === 'p' || tag === 'a' || tag === 'button';
            const candidates = [];
            
            // 1. STRONG ATTRIBUTE SELECTORS
            if (element.id) {
              const idSelector = '#' + element.id;
              const uniqueness = checkSelectorUniqueness(idSelector, element);
              candidates.push({ selector: idSelector, priority: 1, unique: uniqueness.unique, count: uniqueness.count });
              if (uniqueness.unique) return idSelector;
            }
            const dataTestId = element.getAttribute('data-testid');
            if (dataTestId) {
              const testIdSelector = '[data-testid="' + dataTestId + '"]';
              const uniqueness = checkSelectorUniqueness(testIdSelector, element);
              candidates.push({ selector: testIdSelector, priority: 2, unique: uniqueness.unique, count: uniqueness.count });
              if (uniqueness.unique) return testIdSelector;
            }
            const dataId = element.getAttribute('data-id');
            if (dataId) {
              const dataIdSelector = '[data-id="' + dataId + '"]';
              const uniqueness = checkSelectorUniqueness(dataIdSelector, element);
              candidates.push({ selector: dataIdSelector, priority: 3, unique: uniqueness.unique, count: uniqueness.count });
              if (uniqueness.unique) return dataIdSelector;
            }
            if (element.name && (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'button')) {
              const nameSelector = '[name="' + element.name + '"]';
              const uniqueness = checkSelectorUniqueness(nameSelector, element);
              if (uniqueness.unique || uniqueness.count <= 3) {
                candidates.push({ selector: nameSelector, priority: 4, unique: uniqueness.unique, count: uniqueness.count });
                if (uniqueness.unique) return nameSelector;
              }
            }
            const ariaLabel = element.getAttribute('aria-label');
            if (ariaLabel) {
              const ariaSelector = '[aria-label="' + ariaLabel + '"]';
              const uniqueness = checkSelectorUniqueness(ariaSelector, element);
              if (uniqueness.unique || uniqueness.count <= 2) {
                candidates.push({ selector: ariaSelector, priority: 5, unique: uniqueness.unique, count: uniqueness.count });
                if (uniqueness.unique) return ariaSelector;
              }
            }
            
            // 2. ROLE + TEXT
            const role = element.getAttribute('role');
            const text = element.textContent && element.textContent.trim();
            if (role && text && text.length > 0 && text.length < 100) {
              const roleSelector = 'role=' + role;
              const uniqueness = checkSelectorUniqueness(roleSelector, element);
              if (uniqueness.unique) {
                candidates.push({ selector: roleSelector, priority: 6, unique: true, count: 1 });
              } else if (uniqueness.count <= 3) {
                const contextSelector = buildContextAwareSelector(element, roleSelector, element.parentElement);
                if (contextSelector) {
                  const contextUniqueness = checkSelectorUniqueness(contextSelector, element);
                  if (contextUniqueness.unique) {
                    candidates.push({ selector: contextSelector, priority: 6, unique: true, count: 1 });
                  }
                }
              }
            }
            
            // 3. TEXT-BASED SELECTORS
            if (text && text.length > 0) {
              const escapedText = text.length < 100 
                ? text.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"')
                : text.trim().substring(0, 50).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
              const textSelector = 'text=' + escapedText;
              const uniqueness = checkSelectorUniqueness(textSelector, element);
              if (uniqueness.unique) {
                candidates.push({ selector: textSelector, priority: isGenericElement ? 7 : 8, unique: true, count: 1 });
              } else if (uniqueness.count <= 2) {
                candidates.push({ selector: textSelector, priority: isGenericElement ? 8 : 9, unique: false, count: uniqueness.count });
                if (uniqueness.suggestions && uniqueness.suggestions.length > 0) {
                  const contextTextSelector = uniqueness.suggestions[0];
                  const contextUniqueness = checkSelectorUniqueness(contextTextSelector, element);
                  if (contextUniqueness.unique) {
                    candidates.push({ selector: contextTextSelector, priority: isGenericElement ? 7 : 8, unique: true, count: 1 });
                  }
                }
              }
            }
            
            // 4. CLASS-BASED CSS SELECTORS
            if (element.className && typeof element.className === 'string') {
              const meaningfulClasses = element.className.split(' ').filter(c => {
                const clean = c.trim();
                return clean && 
                       !clean.startsWith('css-') && 
                       !clean.startsWith('ng-') && 
                       !clean.startsWith('_') &&
                       clean.length > 2;
              });
              if (meaningfulClasses.length > 0) {
                const classSelector = tag + '.' + meaningfulClasses.map(c => c.trim()).join('.');
                const uniqueness = checkSelectorUniqueness(classSelector, element);
                if (uniqueness.unique) {
                  candidates.push({ selector: classSelector, priority: 10, unique: true, count: 1 });
                } else if (uniqueness.count <= 3) {
                  candidates.push({ selector: classSelector, priority: 11, unique: false, count: uniqueness.count });
                  if (uniqueness.suggestions && uniqueness.suggestions.length > 0) {
                    const contextClassSelector = uniqueness.suggestions[0];
                    const contextUniqueness = checkSelectorUniqueness(contextClassSelector, element);
                    if (contextUniqueness.unique) {
                      candidates.push({ selector: contextClassSelector, priority: 10, unique: true, count: 1 });
                    }
                  }
                }
              }
            }
            
            // 5. DOM CONTEXT SELECTORS
            let parent = element.parentElement;
            let ancestorDepth = 0;
            const maxAncestorDepth = 5;
            while (parent && ancestorDepth < maxAncestorDepth) {
              const parentTag = parent.tagName.toLowerCase();
              if (parentTag === 'body' || parentTag === 'html') {
                parent = parent.parentElement;
                ancestorDepth++;
                continue;
              }
              for (const candidate of candidates) {
                if (!candidate.unique) {
                  const contextSelector = buildContextAwareSelector(element, candidate.selector, parent);
                  if (contextSelector) {
                    const contextUniqueness = checkSelectorUniqueness(contextSelector, element);
                    if (contextUniqueness.unique) {
                      candidates.push({ selector: contextSelector, priority: 12 + ancestorDepth, unique: true, count: 1 });
                    }
                  }
                }
              }
              if (parent.id || (parent.className && parent.className.split(' ').some(c => c && !c.startsWith('css-') && !c.startsWith('ng-')))) {
                const baseTagSelector = tag;
                const contextSelector = buildContextAwareSelector(element, baseTagSelector, parent);
                if (contextSelector) {
                  const contextUniqueness = checkSelectorUniqueness(contextSelector, element);
                  if (contextUniqueness.unique) {
                    candidates.push({ selector: contextSelector, priority: 12 + ancestorDepth, unique: true, count: 1 });
                  }
                }
                break;
              }
              parent = parent.parentElement;
              ancestorDepth++;
            }
            
            // 6. XPath as last resort
            if (element.parentElement) {
              const siblings = Array.from(element.parentElement.children).filter(el => el.tagName === element.tagName);
              if (siblings.length > 1) {
                const index = siblings.indexOf(element) + 1;
                const xpathSelector = 'xpath=//' + tag + '[' + index + ']';
                const uniqueness = checkSelectorUniqueness(xpathSelector, element);
                if (uniqueness.unique || uniqueness.count <= 2) {
                  candidates.push({ selector: xpathSelector, priority: 20, unique: uniqueness.unique, count: uniqueness.count });
                }
              }
            }
            
            // 7. SELECT FINAL SELECTOR
            candidates.sort((a, b) => {
              if (a.unique !== b.unique) return a.unique ? -1 : 1;
              if (a.priority !== b.priority) return a.priority - b.priority;
              return a.count - b.count;
            });
            
            const genericTags = ['span', 'div', 'p', 'a', 'button', 'input', 'body'];
            for (const candidate of candidates) {
              const sel = candidate.selector;
              if (genericTags.some(gt => sel === gt || sel === 'text=' + gt)) {
                continue;
              }
              const finalUniqueness = checkSelectorUniqueness(sel, element);
              if (!finalUniqueness.unique && finalUniqueness.count > 1) {
                console.warn('[Recording Script] ⚠️ Selector matches', finalUniqueness.count, 'elements:', sel);
                if (finalUniqueness.suggestions && finalUniqueness.suggestions.length > 0) {
                  console.warn('[Recording Script] 💡 Consider using:', finalUniqueness.suggestions[0]);
                }
              }
              return sel;
            }
            
            // Last resort: return tag with parent context
            if (element.parentElement) {
              const parent = element.parentElement;
              if (parent.id) {
                return '#' + parent.id + ' > ' + tag;
              }
              if (parent.className && typeof parent.className === 'string') {
                const parentClasses = parent.className.split(' ').filter(c => {
                  const clean = c.trim();
                  return clean && !clean.startsWith('css-') && !clean.startsWith('ng-') && clean.length > 2;
                });
                if (parentClasses.length > 0) {
                  return '.' + parentClasses[0] + ' > ' + tag;
                }
              }
            }
            
            console.warn('[Recording Script] ⚠️ Using generic tag selector as last resort:', tag);
            return tag;
          }
          
          function extractElementMetadata(element) {
            if (!element) return {};
            
            // Get textContent - includes text from all child elements
            let textContent = '';
            if (element.textContent) {
              textContent = element.textContent.trim();
            }
            // If no textContent, try innerText (more reliable for visible text)
            if (!textContent && element.innerText) {
              textContent = element.innerText.trim();
            }
            // If still no text, try to get text from first text node child
            if (!textContent && element.firstChild && element.firstChild.nodeType === 3) {
              textContent = element.firstChild.textContent.trim();
            }
            
            return {
              tagName: element.tagName || '',
              id: element.id || '',
              name: element.name || '',
              placeholder: element.placeholder || '',
              ariaLabel: element.getAttribute('aria-label') || '',
              title: element.title || '',
              textContent: textContent,
              value: element.value || '',
              type: element.type || '',
              dataTestId: element.getAttribute('data-testid') || '',
              className: (element.className && typeof element.className === 'string' ? element.className : '') || ''
            };
          }
          
          const typeDebounceTimers = new Map();
          const TYPE_DEBOUNCE_MS = 500;
          
          function sendTypeAction(element, reason) {
            if (!element) {
              console.warn('[Recording Script] ⚠️ No element provided for type action');
              return;
            }
            
            // Build locator candidates using the new smart system
            const locatorCandidates = buildLocatorCandidates(element);
            if (!locatorCandidates || locatorCandidates.length === 0) {
              console.warn('[Recording Script] ⚠️ No locator candidates found for input element');
              return;
            }
            
            // Determine primary locator index (best unique candidate)
            const primaryLocatorIndex = getPrimaryLocatorIndex(locatorCandidates);
            const primaryCandidate = locatorCandidates[primaryLocatorIndex];
            
            // Reject generic input selectors
            const genericTags = ['input', 'textarea'];
            if (genericTags.includes(primaryCandidate.selector)) {
              const betterCandidate = locatorCandidates.find(c => 
                c.selector && !genericTags.includes(c.selector) && c.selector !== primaryCandidate.selector
              );
              if (!betterCandidate) {
                console.warn('[Recording Script] ⚠️ Could not find better selector for input, skipping');
                return;
              }
            }
            
            const metadata = extractElementMetadata(element);
            
            const typeData = {
              sessionId: sessionId,
              kind: 'type',
              selector: primaryCandidate.selector,
              value: element.value || '',
              locatorCandidates: locatorCandidates,
              primaryLocatorIndex: primaryLocatorIndex,
              timestamp: Date.now(),
              ...metadata
            };
            
            if (!primaryCandidate.unique && primaryCandidate.matchCount > 1) {
              console.warn('[Recording Script] ⚠️ Input selector matches', primaryCandidate.matchCount, 'elements:', primaryCandidate.selector);
            }
            
            console.log('[Recording Script] 📝 Sending type action (' + reason + '):', typeData);
            
            fetch(apiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(typeData)
            }).then(resp => {
              if (resp.ok) {
                console.log('[Recording Script] ✅ Type action sent successfully');
              } else {
                console.error('[Recording Script] ❌ Type action failed:', resp.status);
              }
            }).catch(err => console.error('[Recording Script] ❌ Failed to send input:', err));
          }
          
          // Input event listener
          document.addEventListener('input', (e) => {
            console.log('[Recording Script] ⌨️ Input event detected (page-level):', e.target.tagName, 'value:', e.target.value);
            
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
              let selector = getElementSelector(e.target);
              if (!selector) {
                console.warn('[Recording Script] ⚠️ No selector found for input element');
                return;
              }
              
              // Reject generic selectors
              if (selector === 'input' || selector === 'textarea') {
                const allStrategies = getAllSelectorStrategies(e.target);
                const betterSelector = allStrategies.find(s => {
                  const sel = s.value;
                  return sel && sel !== 'input' && sel !== 'textarea';
                });
                if (betterSelector) {
                  selector = betterSelector.value;
                } else if (e.target.placeholder) {
                  selector = '[placeholder="' + e.target.placeholder + '"]';
                } else if (e.target.name) {
                  selector = '[name="' + e.target.name + '"]';
                } else if (e.target.parentElement && e.target.parentElement.id) {
                  selector = '#' + e.target.parentElement.id + ' ' + e.target.tagName.toLowerCase();
                } else {
                  console.warn('[Recording Script] ⚠️ Could not find better selector for input, skipping');
                  return;
                }
              }
              
              console.log('[Recording Script] ✅ Input selector found:', selector);
              
              if (typeDebounceTimers.has(selector)) {
                clearTimeout(typeDebounceTimers.get(selector));
              }
              
              const timer = setTimeout(() => {
                sendTypeAction(e.target, 'debounced');
                typeDebounceTimers.delete(selector);
              }, TYPE_DEBOUNCE_MS);
              
              typeDebounceTimers.set(selector, timer);
            }
          }, true);
          
          // Blur event listener
          document.addEventListener('blur', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
              let selector = getElementSelector(e.target);
              if (!selector) return;
              
              // Reject generic selectors
              if (selector === 'input' || selector === 'textarea') {
                const allStrategies = getAllSelectorStrategies(e.target);
                const betterSelector = allStrategies.find(s => {
                  const sel = s.value;
                  return sel && sel !== 'input' && sel !== 'textarea';
                });
                if (betterSelector) {
                  selector = betterSelector.value;
                } else if (e.target.placeholder) {
                  selector = '[placeholder="' + e.target.placeholder + '"]';
                } else if (e.target.name) {
                  selector = '[name="' + e.target.name + '"]';
                } else {
                  return; // Skip if no good selector
                }
              }
              
              if (typeDebounceTimers.has(selector)) {
                clearTimeout(typeDebounceTimers.get(selector));
                typeDebounceTimers.delete(selector);
                if (e.target.value && e.target.value.trim().length > 0) {
                  sendTypeAction(e.target, 'on blur');
                }
              }
            }
          }, true);
          
          // Enter key listener
          document.addEventListener('keydown', (e) => {
            if ((e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') && e.key === 'Enter') {
              let selector = getElementSelector(e.target);
              if (!selector) return;
              
              // Reject generic selectors
              if (selector === 'input' || selector === 'textarea') {
                const allStrategies = getAllSelectorStrategies(e.target);
                const betterSelector = allStrategies.find(s => {
                  const sel = s.value;
                  return sel && sel !== 'input' && sel !== 'textarea';
                });
                if (betterSelector) {
                  selector = betterSelector.value;
                } else if (e.target.placeholder) {
                  selector = '[placeholder="' + e.target.placeholder + '"]';
                } else if (e.target.name) {
                  selector = '[name="' + e.target.name + '"]';
                } else {
                  return; // Skip if no good selector
                }
              }
              
              if (typeDebounceTimers.has(selector)) {
                clearTimeout(typeDebounceTimers.get(selector));
                typeDebounceTimers.delete(selector);
              }
              
              if (e.target.value && e.target.value.trim().length > 0) {
                sendTypeAction(e.target, 'on Enter key');
              }
            }
          }, true);
          
          // Click event listener (for recording clicks and hiding context menu)
          document.addEventListener('click', (e) => {
            // Hide context menu if clicking outside
            if (contextMenu && !contextMenu.contains(e.target)) {
              contextMenu.style.display = 'none';
            }
            
            // Don't record click if clicking on navigation selector dialog or overlay
            const navigateDialog = document.getElementById('zero-code-navigate-selector-dialog');
            const navigateOverlay = document.getElementById('zero-code-navigate-selector-overlay');
            if (navigateDialog && (navigateDialog.contains(e.target) || navigateDialog === e.target)) {
              return; // Don't record clicks on the dialog
            }
            if (navigateOverlay && (navigateOverlay.contains(e.target) || navigateOverlay === e.target)) {
              return; // Don't record clicks on the overlay
            }
            
            // Don't record click if menu was open or if clicking on menu
            if (contextMenu && (contextMenu.style.display !== 'none' || contextMenu.contains(e.target))) {
              return;
            }
            
            // Normalize to clickable element
            const clickableElement = getClickableElement(e.target);
            if (!clickableElement) {
              console.warn('[Recording Script] ⚠️ Could not determine clickable element');
              return;
            }
            
            // Build locator candidates using the new smart system
            const locatorCandidates = buildLocatorCandidates(clickableElement);
            if (!locatorCandidates || locatorCandidates.length === 0) {
              console.warn('[Recording Script] ⚠️ No locator candidates found for clicked element');
              return;
            }
            
            // Determine primary locator index (best unique candidate)
            const primaryLocatorIndex = getPrimaryLocatorIndex(locatorCandidates);
            const primaryCandidate = locatorCandidates[primaryLocatorIndex];
            
            // Reject generic selectors - if primary is generic, try to find better
            const genericTags = ['span', 'div', 'p', 'a', 'button', 'input', 'body'];
            if (genericTags.includes(primaryCandidate.selector)) {
              const betterCandidate = locatorCandidates.find(c => 
                c.selector && !genericTags.includes(c.selector) && c.selector !== primaryCandidate.selector
              );
              if (!betterCandidate) {
                console.warn('[Recording Script] ⚠️ Could not find better selector, skipping click');
                return;
              }
            }
            
            const metadata = extractElementMetadata(clickableElement);
            
            const clickData = {
              sessionId: sessionId,
              kind: 'click',
              selector: primaryCandidate.selector,
              locatorCandidates: locatorCandidates,
              primaryLocatorIndex: primaryLocatorIndex,
              timestamp: Date.now(),
              ...metadata
            };
            
            if (!primaryCandidate.unique && primaryCandidate.matchCount > 1) {
              console.warn('[Recording Script] ⚠️ Selector matches', primaryCandidate.matchCount, 'elements:', primaryCandidate.selector);
            }
            
            console.log('[Recording Script] 🖱️ Click action (page-level):', clickData);
            
            fetch(apiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(clickData)
            }).then(resp => {
              if (resp.ok) {
                console.log('[Recording Script] ✅ Click action sent successfully');
              } else {
                console.error('[Recording Script] ❌ Click action failed:', resp.status);
              }
            }).catch(err => console.error('[Recording Script] ❌ Failed to send click:', err));
          }, true);
          
          console.log('[Recording Script] ✅ Page-level context menu and input listeners injected and active');
        }, { sessionId, apiUrl: API_URL });
      } catch (error) {
        console.error(`[BrowserService] ❌ Error in page-level script injection for session ${sessionId}:`, error.message);
        if (error.stack) {
          console.error(`[BrowserService] Stack trace:`, error.stack);
        }
        console.error(`[BrowserService] This may cause recording issues. The context-level script should still work.`);
      }
    });
    
    // Also inject immediately after page is created
    page.once('domcontentloaded', async () => {
      try {
        console.log('[Recording] DOMContentLoaded fired, verifying script...');
        const hasScript = await page.evaluate(() => {
          return typeof window.initializeRecording === 'function' || 
                 document.getElementById('zero-code-context-menu') !== null;
        });
        console.log('[Recording] Script verification:', hasScript ? '✅ Found' : '❌ Not found');
      } catch (error) {
        console.error(`[BrowserService] ❌ Error verifying script for session ${sessionId}:`, error.message);
        if (error.stack) {
          console.error(`[BrowserService] Stack trace:`, error.stack);
        }
      }
    });
    
    // Handle page navigation
    page.on('framenavigated', async (frame) => {
      if (frame === page.mainFrame()) {
        const newUrl = frame.url();
        console.log(`[Recording] Page navigated to: ${newUrl}`);
        
        // Update session activity on navigation to keep it alive
        this.updateSessionActivity(sessionId);
        
        // Record navigation as a step if URL changed (not initial navigation)
        const session = this.getSession(sessionId);
        if (session) {
          // Check if this is a different URL than the last one
          // Skip recording if it's the initial URL or same URL (refresh)
          if (session.lastUrl && session.lastUrl !== newUrl && !newUrl.startsWith('about:blank') && !newUrl.startsWith('data:')) {
            console.log(`[Recording] URL changed from ${session.lastUrl} to ${newUrl}, recording navigation step`);
            
            // Import normalization utils
            const normalizationUtils = await import('../normalization-utils.js');
            
            // Create navigation action
            const navigateAction = {
              kind: 'navigate',
              url: newUrl,
              timestamp: Date.now(),
              normalizedPageName: normalizationUtils.extractPageNameFromUrl(newUrl)
            };
            
            // Check for duplicates (avoid recording same navigation twice)
            const isDuplicate = session.actions.some(action => 
              action.kind === 'navigate' && 
              action.url === newUrl &&
              Date.now() - action.timestamp < 2000 // Within 2 seconds
            );
            
            if (!isDuplicate) {
              session.actions.push(navigateAction);
              console.log(`[Recording] ✅ Navigation step recorded: ${newUrl}. Total actions: ${session.actions.length}`);
              
              // Notify WebSocket clients if connected
              if (session.ws && session.ws.readyState === 1) {
                try {
                  session.ws.send(JSON.stringify({
                    type: 'action',
                    data: navigateAction,
                    normalized: true,
                    totalActions: session.actions.length
                  }));
                  console.log(`[Recording] ✅ Navigation action sent via WebSocket`);
                } catch (wsError) {
                  console.warn(`[Recording] ⚠️ Failed to send navigation action via WebSocket:`, wsError);
                }
              }
            } else {
              console.log(`[Recording] ⏭️ Duplicate navigation filtered: ${newUrl}`);
            }
          }
          
          // Update last URL
          session.lastUrl = newUrl;
        }
      }
    });

    // Handle page close - record it as an action
    page.on('close', async () => {
      console.log(`[Recording] Page closed for session ${sessionId}, recording close action`);
      
      // Add close action directly to session (we're in Node.js context, not browser)
      const session = this.getSession(sessionId);
      if (session) {
        const closeAction = {
          kind: 'close',
          timestamp: Date.now()
        };
        
        session.actions.push(closeAction);
        console.log(`[Recording] ✅ Close action added to session. Total actions: ${session.actions.length}`);
        
        // Notify WebSocket clients if connected
        if (session.ws && session.ws.readyState === 1) {
          try {
            session.ws.send(JSON.stringify({
              type: 'action',
              data: closeAction,
              normalized: true
            }));
            console.log(`[Recording] ✅ Close action sent via WebSocket`);
          } catch (wsError) {
            console.warn(`[Recording] ⚠️ Failed to send close action via WebSocket:`, wsError);
          }
        }
      }
      
      // Don't destroy session immediately - actions might still be in flight
      // The cleanup timer will handle it if no more activity
    });

    // ── T1.4 File-download capture ──────────────────────────────────
    // Playwright's page.on('download') fires whenever the browser starts
    // a download. We push a `download` action carrying the suggested
    // filename + the URL Playwright reports — that's enough for replay
    // engines to assert "a download named X happened" without us having
    // to actually save the bytes to disk.
    page.on('download', async (download) => {
      try {
        const session = this.getSession(sessionId);
        if (!session) return;
        const action = {
          kind: 'download',
          filename: download.suggestedFilename ? download.suggestedFilename() : null,
          url: download.url ? download.url() : null,
          timestamp: Date.now(),
        };
        session.actions.push(action);
        console.log(`[Recording] ⬇️ Download recorded: ${action.filename || action.url}`);
        if (session.ws && session.ws.readyState === 1) {
          try {
            session.ws.send(JSON.stringify({ type: 'action', data: action, normalized: true, totalActions: session.actions.length }));
          } catch (e) { /* ws blip — non-fatal */ }
        }
      } catch (e) {
        console.warn('[Recording] download capture failed:', e.message);
      }
    });

    // ── T1.9 Popup window handling ──────────────────────────────────
    // Capture window.open / target=_blank / window.popup as a step AND
    // attach the same recorder handlers to the new page so interactions
    // inside the popup are captured too. The init script (T1.1–T1.10)
    // already runs on every page in the context — we only need to wire
    // setupPageEventHandlers (scroll, navigation, etc.) to the popup.
    page.on('popup', async (popup) => {
      try {
        const session = this.getSession(sessionId);
        if (session) {
          const action = {
            kind: 'popup',
            url: popup.url ? popup.url() : null,
            timestamp: Date.now(),
          };
          session.actions.push(action);
          console.log(`[Recording] 🪟 Popup recorded: ${action.url}`);
          if (session.ws && session.ws.readyState === 1) {
            try {
              session.ws.send(JSON.stringify({ type: 'action', data: action, normalized: true, totalActions: session.actions.length }));
            } catch (e) { /* ws blip — non-fatal */ }
          }
        }
        // Attach the same per-page handlers (scroll, navigation, close,
        // download, popup) to the popup so it's a first-class recordable
        // surface, not a black hole.
        await this.setupPageEventHandlers(popup, sessionId);
      } catch (e) {
        console.warn('[Recording] popup handler failed:', e.message);
      }
    });

    // Handle console messages for debugging
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.warn('Browser console error:', msg.text());
      }
    });
  }

  async navigateToUrl(session, url) {
    const { page } = session;

    if (url && url !== 'about:blank' && !url.startsWith('data:')) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Record initial navigation
      const normalizationUtils = await import('../normalization-utils.js');
      session.actions.push({
        kind: 'navigate',
        url: url,
        timestamp: Date.now(),
        normalizedPageName: normalizationUtils.extractPageNameFromUrl(url)
      });

      // Set last URL to track future navigation changes
      session.lastUrl = url;

      console.log(`[Recording] Initial navigation recorded: ${url}`);
    } else {
      // Set up blank page with recording UI
      await this.setupBlankPage(session);
      session.lastUrl = 'about:blank';
    }
  }

  async setupBlankPage(session) {
    const { page } = session;

    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Recording Browser - Start Interacting</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
          }
          .welcome {
            text-align: center;
            padding: 40px;
            background: rgba(255,255,255,0.1);
            border-radius: 20px;
            backdrop-filter: blur(10px);
            max-width: 600px;
          }
          h1 { margin: 0 0 20px 0; font-size: 32px; }
          p { font-size: 18px; line-height: 1.6; opacity: 0.9; }
          .example-links {
            margin-top: 30px;
          }
          .example-links a {
            display: inline-block;
            margin: 10px;
            padding: 12px 24px;
            background: rgba(255,255,255,0.2);
            color: white;
            text-decoration: none;
            border-radius: 8px;
            transition: background 0.3s;
          }
          .example-links a:hover {
            background: rgba(255,255,255,0.3);
          }
        </style>
      </head>
      <body>
        <div class="welcome">
          <h1>🎬 Recording Active</h1>
          <p>This browser is being recorded. Navigate to any website or interact with the page. All your clicks, typing, and navigation will be captured.</p>
          <div class="example-links">
            <a href="https://example.com">Example.com</a>
            <a href="https://www.google.com">Google</a>
            <a href="https://github.com">GitHub</a>
          </div>
        </div>
      </body>
      </html>
    `, { waitUntil: 'domcontentloaded' });
  }

  getBrowserExecutablePath(browserType = 'chromium') {
    const platform = process.platform;
    const arch = process.arch;

    if (browserType === 'edge') {
      if (platform === 'win32') {
        return 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
      } else if (platform === 'darwin') {
        return '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
      } else {
        // Linux
        return '/usr/bin/microsoft-edge';
      }
    } else {
      // Chrome/Chromium
    if (platform === 'win32') {
      return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    } else if (platform === 'darwin') {
      return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    } else {
      // Linux
      return '/usr/bin/google-chrome';
      }
    }
  }

  getBrowserLauncher(browserType) {
    switch (browserType) {
      case 'firefox':
        return firefox;
      case 'webkit':
        return webkit;
      case 'edge':
      case 'chromium':
      default:
        // Edge uses Chromium engine
        return chromium;
    }
  }

  setupSessionCleanup(sessionId) {
    const cleanup = () => {
      const session = this.activeSessions.get(sessionId);
      if (session) {
        const now = Date.now();
        const timeSinceActivity = now - session.lastActivity;

        // Only cleanup if session has been inactive for a very long time (30 minutes)
        // Don't cleanup just because of navigation - actions might still be coming
        if (timeSinceActivity > this.sessionTimeout) {
          console.log(`Session ${sessionId} timed out after ${Math.round(timeSinceActivity / 1000 / 60)} minutes, cleaning up`);
          this.destroySession(sessionId);
        } else {
          // Schedule next check - check less frequently to avoid premature cleanup
          session.cleanupTimer = setTimeout(cleanup, 5 * 60000); // Check every 5 minutes
        }
      }
    };

    // Initial cleanup scheduling - start checking after 25 minutes
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.cleanupTimer = setTimeout(cleanup, 25 * 60000);
    }
  }

  updateSessionActivity(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
    }
  }

  getSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      console.warn(`[BrowserService] Session ${sessionId} not found. Active sessions: ${Array.from(this.activeSessions.keys()).join(', ')}`);
    }
    return session;
  }

  async destroySession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    try {
      // Clear cleanup timer
      if (session.cleanupTimer) {
        clearTimeout(session.cleanupTimer);
      }

      // Close WebSocket
      if (session.ws && session.ws.readyState === 1) {
        session.ws.close();
      }

      // Close browser context and browser
      if (session.context) {
        await session.context.close().catch(() => {});
      }
      if (session.browser) {
        await session.browser.close().catch(() => {});
      }
    } catch (error) {
      console.error(`Error cleaning up session ${sessionId}:`, error);
    } finally {
      this.activeSessions.delete(sessionId);
    }
  }

  getActiveSessionCount() {
    return this.activeSessions.size;
  }

  getSessionStats() {
    const sessions = Array.from(this.activeSessions.values());
    return {
      total: sessions.length,
      active: sessions.filter(s => s.ws && s.ws.readyState === 1).length,
      averageActions: sessions.length > 0
        ? Math.round(sessions.reduce((sum, s) => sum + s.actions.length, 0) / sessions.length)
        : 0
    };
  }
}

// Export singleton instance - all routes must use this same instance
export const browserService = new BrowserService();
