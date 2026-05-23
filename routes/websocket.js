import { validateSessionId } from '../middleware/security.js';
import { browserService } from '../services/browserService.js';
import * as normalizationUtils from '../normalization-utils.js';

// WebSocket connection handler
export const handleWebSocketConnection = (ws, req) => {
  const sessionId = req.params.sessionId;

  console.log(`[WebSocket] ========================================`);
  console.log(`[WebSocket] Connection attempt for session: ${sessionId}`);
  console.log(`[WebSocket] Active sessions: ${browserService.getActiveSessionCount()}`);
  console.log(`[WebSocket] Session IDs: ${Array.from(browserService.activeSessions.keys()).join(', ')}`);

  try {
    validateSessionId(sessionId);
  } catch (error) {
    console.error(`[WebSocket] ❌ Invalid session ID: ${sessionId}`);
    ws.close(1008, 'Invalid session ID');
    return;
  }

  // Retry mechanism - sometimes WebSocket connects before session is fully ready
  let session = browserService.getSession(sessionId);
  if (!session) {
    console.warn(`[WebSocket] ⚠️ Session not found immediately, retrying in 100ms...`);
    setTimeout(() => {
      session = browserService.getSession(sessionId);
      if (!session) {
        console.error(`[WebSocket] ❌ Session still not found after retry: ${sessionId}`);
        console.error(`[WebSocket] Active sessions: ${Array.from(browserService.activeSessions.keys()).join(', ')}`);
        ws.close(1008, 'Session not found');
        return;
      }
      // Associate WebSocket with session
      session.ws = ws;
      browserService.updateSessionActivity(sessionId);
      console.log(`[WebSocket] ✅ Connected for session: ${sessionId} (after retry)`);
      console.log(`[WebSocket] Session has ${session.actions.length} existing actions`);
      
      // Send any queued actions
      if (session.actions && session.actions.length > 0) {
        session.actions.forEach(action => {
          try {
            ws.send(JSON.stringify({ type: 'action', data: action }));
          } catch (e) {
            console.warn('Failed to send queued action:', e);
          }
        });
      }
      
      // Setup handlers
      setupWebSocketEventHandlers(ws, session, sessionId);
    }, 100);
    return;
  }

  // Associate WebSocket with session
  session.ws = ws;
  browserService.updateSessionActivity(sessionId);

  console.log(`[WebSocket] ========================================`);
  console.log(`[WebSocket] ✅ Connected for session: ${sessionId}`);
  console.log(`[WebSocket] Session has ${session.actions.length} existing actions`);
  console.log(`[WebSocket] ========================================`);

  // Send any queued actions that happened before WebSocket connected
  if (session.actions && session.actions.length > 0) {
    session.actions.forEach(action => {
      try {
        ws.send(JSON.stringify({
          type: 'action',
          data: action
        }));
      } catch (e) {
        console.warn('Failed to send queued action:', e);
      }
    });
  }

  // Setup WebSocket event handlers
  setupWebSocketEventHandlers(ws, session, sessionId);
};

// Helper function to setup WebSocket event handlers
function setupWebSocketEventHandlers(ws, session, sessionId) {
  // Handle WebSocket messages
  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      } else if (data.type === 'pause') {
        // Handle pause/resume commands
        browserService.updateSessionActivity(sessionId);
        // Implementation would go here
      }
    } catch (e) {
      console.error('WebSocket message error:', e);
    }
  });

  // Handle WebSocket close
  ws.on('close', () => {
    if (session.ws === ws) {
      session.ws = null;
      console.log(`WebSocket disconnected for session ${sessionId}`);
    }
  });

  // Handle WebSocket errors
  ws.on('error', (error) => {
    console.error(`WebSocket error for session ${sessionId}:`, error);
    if (session.ws === ws) {
      session.ws = null;
    }
  });
}

// Action capture handler
export const handleActionCapture = async (req, res) => {
  try {
    // [ZAC-FIX] Read sessionId from the URL param if it's missing in
    // the body. The route is /api/recording/:sessionId/action, so the
    // URL param is always present; the in-page bridge happens to also
    // duplicate it in the body, but a client (or our regression
    // harness) that follows the URL convention alone shouldn't 400.
    const { sessionId: bodySid, ...action } = req.body || {};
    const sessionId = bodySid || (req.params && req.params.sessionId);

    console.log(`[Action Capture] ========================================`);
    console.log(`[Action Capture] Received action: ${action.kind} for session: ${sessionId}`);
    console.log(`[Action Capture] Action details:`, JSON.stringify(action, null, 2));

    // Debug: Log metadata for normalization
    if (action.textContent || action.ariaLabel || action.placeholder || action.id) {
      console.log(`[Action Capture] Element metadata:`, {
        textContent: action.textContent,
        ariaLabel: action.ariaLabel,
        placeholder: action.placeholder,
        id: action.id,
        tagName: action.tagName,
        selector: action.selector
      });
    }

    if (!sessionId) {
      console.error('[Action Capture] Missing sessionId in body AND in :sessionId URL param');
      return res.status(400).json({ error: 'Session ID is required' });
    }
    
    validateSessionId(sessionId);

    const session = browserService.getSession(sessionId);

    if (!session) {
      const activeSessions = Array.from(browserService.activeSessions.keys());
      console.error(`[Action Capture] ❌ Session not found: ${sessionId}`);
      console.error(`[Action Capture] Active sessions (${activeSessions.length}): ${activeSessions.join(', ')}`);
      console.error(`[Action Capture] Request body sessionId: ${sessionId}`);
      console.error(`[Action Capture] ========================================`);
      return res.status(404).json({ error: 'Session not found' });
    }
    
    console.log(`[Action Capture] ✅ Session found! Actions count: ${session.actions.length}`);

    browserService.updateSessionActivity(sessionId);

    // Validate allowed action kinds.
    // TIER 1 added: `download` (T1.4) and `popup` (T1.9). Both are emitted
    // by the Node-side Playwright hooks in browserService.setupPageEventHandlers
    // — they're not browser-DOM events but they round-trip through the same
    // /action endpoint when the WebSocket isn't connected, so the allowlist
    // must include them.
    // TIER 3: T3.5 (shadowDom) and T3.6 (iframe) actions ride on existing
    // kinds (`click`, `type`) but carry sidecar metadata. They don't need
    // new entries here — the kind itself is still allowed.
    const allowedKinds = [
      'click', 'doubleClick', 'type', 'select', 'check', 'uncheck', 'selectRadio',
      'navigate', 'assertText', 'assertVisible', 'assertNotVisible', 'assertAttribute', 'assertCount',
      'assertValue', 'assertEnabled', 'assertDisabled', 'assertChecked', 'assertNotChecked',
      'waitFor', 'waitForSelector', 'screenshot', 'hover',
      'dragDrop', 'fileUpload', 'keyPress', 'scroll', 'close',
      'download', 'popup',
    ];

    // T2.8 — auto-suggested assertions take a side-channel. They are
    // NOT real steps — they're proposals the recorder offers for the
    // user to accept later. We stash them on session.suggestions and
    // return early so they don't pollute session.actions.
    if (action.kind === 'assertion-suggested') {
      if (!Array.isArray(session.suggestions)) session.suggestions = [];
      // Cap and de-dup adjacent identical suggestions to keep the list
      // small even on a chatty page.
      const last = session.suggestions[session.suggestions.length - 1];
      const sig = `${action.suggestedKind}|${action.selector}|${action.expectedValue || ''}`;
      const lastSig = last ? `${last.suggestedKind}|${last.selector}|${last.expectedValue || ''}` : '';
      if (sig !== lastSig) {
        session.suggestions.push({
          suggestedKind: action.suggestedKind,
          selector: action.selector,
          expectedValue: action.expectedValue,
          timestamp: action.timestamp || Date.now(),
        });
        if (session.suggestions.length > 100) session.suggestions.splice(0, session.suggestions.length - 100);
      }
      return res.json({ success: true, suggested: true });
    }

    if (!allowedKinds.includes(action.kind)) {
      return res.json({ success: true, ignored: true });
    }

    // Normalize action in real-time
    const normalizedAction = { ...action };

    // T2.3 — server-side locator-quality re-rank.
    // The injected recorder produces `locatorCandidates` (array of
    // {selector, type, unique, count, ...}) sorted by an in-page
    // `stabilityScore` heuristic. Apply utils/locatorQuality.js#rankCandidates
    // here so the saved action carries the production scorer's ranking
    // (which the dashboard's flakiest-locators panel and the healer chain
    // both rely on for consistent scoring). The original ordering is
    // preserved on `originalCandidates` for forensics.
    if (Array.isArray(action.locatorCandidates) && action.locatorCandidates.length > 0) {
      try {
        const { rankCandidates } = await import('../utils/locatorQuality.js');
        const ranked = rankCandidates(action.locatorCandidates);
        normalizedAction.locatorCandidates = ranked;
        normalizedAction.originalCandidates = action.locatorCandidates;
        // Promote the highest-scoring selector if the recorder's primary
        // pick scored low. This is the "AI-style" win — the production
        // scorer knows about dynamic-attribute penalties the in-page
        // heuristic doesn't.
        if (ranked[0] && ranked[0].confidence > 0 &&
            ranked[0].selector !== action.selector &&
            (typeof ranked[0].confidence === 'number') &&
            ranked[0].confidence >= 60) {
          normalizedAction.primaryPromotedFrom = action.selector;
          normalizedAction.selector = ranked[0].selector;
          normalizedAction.locatorConfidence = ranked[0].confidence;
          normalizedAction.locatorStrategy = ranked[0].strategy;
        } else if (ranked[0]) {
          normalizedAction.locatorConfidence = ranked[0].confidence;
          normalizedAction.locatorStrategy = ranked[0].strategy;
        }
      } catch (e) {
        console.warn('[Action Capture] locatorQuality re-rank failed:', e.message);
      }
    }

    // Normalize page names for navigation
    if (action.kind === 'navigate' && action.url) {
      normalizedAction.normalizedPageName = normalizationUtils.extractPageNameFromUrl(action.url);
    }

    // Normalize element descriptions for clicks, types, and assertions
    if ((action.kind === 'click' || action.kind === 'doubleClick' || action.kind === 'type' || 
         action.kind === 'select' || action.kind === 'check' || action.kind === 'uncheck' ||
         action.kind === 'selectRadio' || action.kind === 'hover' || action.kind === 'scroll' ||
         action.kind === 'dragDrop' || action.kind === 'fileUpload' ||
         action.kind === 'assertText' || action.kind === 'assertVisible' || action.kind === 'assertNotVisible' ||
         action.kind === 'assertAttribute' || action.kind === 'assertCount' || 
         action.kind === 'assertValue' || action.kind === 'assertEnabled' || action.kind === 'assertDisabled' ||
         action.kind === 'assertChecked' || action.kind === 'assertNotChecked' ||
         action.kind === 'waitForSelector') && action.selector) {
      normalizedAction.normalizedDescription = normalizationUtils.normalizeElementDescription(action);
      normalizedAction.normalizedSelector = normalizationUtils.normalizeSelector(action);
    }
    
    // Normalize target for dragDrop
    if (action.kind === 'dragDrop' && action.targetSelector) {
      normalizedAction.normalizedTargetDescription = normalizationUtils.normalizeElementDescription({ selector: action.targetSelector });
    }

    // Generate normalized step text for display
    let normalizedStepText = '';
    if (normalizedAction.kind === 'navigate') {
      const pageName = normalizedAction.normalizedPageName || 'Page';
      normalizedStepText = `Navigate To ${pageName}`;
    } else if (normalizedAction.kind === 'click') {
      normalizedStepText = `Click ${normalizedAction.normalizedDescription || 'Element'}`;
    } else if (normalizedAction.kind === 'type') {
      const value = (normalizedAction.value || '').substring(0, 20);
      normalizedStepText = `Enter "${value}${value.length >= 20 ? '...' : ''}" In ${normalizedAction.normalizedDescription || 'Field'}`;
    } else if (normalizedAction.kind === 'assertText') {
      const text = (normalizedAction.expectedValue || normalizedAction.text || '').substring(0, 20);
      normalizedStepText = `Assert Text "${text}${text.length >= 20 ? '...' : ''}" In ${normalizedAction.normalizedDescription || 'Element'}`;
    } else if (normalizedAction.kind === 'assertVisible') {
      normalizedStepText = `Assert ${normalizedAction.normalizedDescription || 'Element'} Is Visible`;
    } else if (normalizedAction.kind === 'assertNotVisible') {
      normalizedStepText = `Assert ${normalizedAction.normalizedDescription || 'Element'} Is Not Visible`;
    } else if (normalizedAction.kind === 'assertEnabled') {
      normalizedStepText = `Assert ${normalizedAction.normalizedDescription || 'Element'} Is Enabled`;
    } else if (normalizedAction.kind === 'assertDisabled') {
      normalizedStepText = `Assert ${normalizedAction.normalizedDescription || 'Element'} Is Disabled`;
    } else if (normalizedAction.kind === 'assertChecked') {
      normalizedStepText = `Assert ${normalizedAction.normalizedDescription || 'Element'} Is Checked`;
    } else if (normalizedAction.kind === 'assertNotChecked') {
      normalizedStepText = `Assert ${normalizedAction.normalizedDescription || 'Element'} Is Not Checked`;
    } else if (normalizedAction.kind === 'assertAttribute') {
      const attr = normalizedAction.value || 'attribute';
      normalizedStepText = `Assert ${normalizedAction.normalizedDescription || 'Element'} Attribute ${attr}`;
    } else if (normalizedAction.kind === 'assertCount') {
      const count = normalizedAction.expectedValue || '0';
      normalizedStepText = `Assert ${normalizedAction.normalizedDescription || 'Element'} Count Is ${count}`;
    } else if (normalizedAction.kind === 'assertValue') {
      normalizedStepText = `Assert ${normalizedAction.normalizedDescription || 'Element'} Value`;
    } else if (normalizedAction.kind === 'waitForSelector') {
      normalizedStepText = `Wait For ${normalizedAction.normalizedDescription || 'Selector'}`;
    } else if (normalizedAction.kind === 'waitFor') {
      normalizedStepText = `Wait For ${normalizedAction.ms || 500}ms`;
    } else if (normalizedAction.kind === 'screenshot') {
      normalizedStepText = `Take Screenshot ${normalizedAction.filename || ''}`;
    } else if (normalizedAction.kind === 'doubleClick') {
      normalizedStepText = `Double Click ${normalizedAction.normalizedDescription || 'Element'}`;
    } else if (normalizedAction.kind === 'select') {
      const value = normalizedAction.value || normalizedAction.selectedText || '';
      normalizedStepText = `Select "${value}" From ${normalizedAction.normalizedDescription || 'Dropdown'}`;
    } else if (normalizedAction.kind === 'check') {
      normalizedStepText = `Check ${normalizedAction.normalizedDescription || 'Checkbox'}`;
    } else if (normalizedAction.kind === 'uncheck') {
      normalizedStepText = `Uncheck ${normalizedAction.normalizedDescription || 'Checkbox'}`;
    } else if (normalizedAction.kind === 'selectRadio') {
      const value = normalizedAction.value || '';
      normalizedStepText = `Select Radio "${value}" In ${normalizedAction.normalizedDescription || 'Group'}`;
    } else if (normalizedAction.kind === 'hover') {
      normalizedStepText = `Hover Over ${normalizedAction.normalizedDescription || 'Element'}`;
    } else if (normalizedAction.kind === 'dragDrop') {
      const target = normalizedAction.targetSelector || normalizedAction.target || 'Target';
      normalizedStepText = `Drag ${normalizedAction.normalizedDescription || 'Element'} To ${target}`;
    } else if (normalizedAction.kind === 'fileUpload') {
      const filename = normalizedAction.filename || normalizedAction.filePath || 'File';
      normalizedStepText = `Upload "${filename}" To ${normalizedAction.normalizedDescription || 'Field'}`;
    } else if (normalizedAction.kind === 'keyPress') {
      const key = normalizedAction.key || normalizedAction.value || 'Key';
      normalizedStepText = `Press Key "${key}"`;
    } else if (normalizedAction.kind === 'scroll') {
      // Handle scroll with different modes
      if (normalizedAction.scroll && normalizedAction.scroll.mode === 'element') {
        normalizedStepText = `Scroll To ${normalizedAction.normalizedDescription || 'Element'}`;
      } else if (normalizedAction.scroll && normalizedAction.scroll.mode === 'bottom') {
        normalizedStepText = `Scroll To Bottom`;
      } else if (normalizedAction.scroll && normalizedAction.scroll.mode === 'top') {
        normalizedStepText = `Scroll To Top`;
      } else if (normalizedAction.scrollY !== undefined) {
        normalizedStepText = `Scroll To Y Position ${normalizedAction.scrollY}`;
      } else if (normalizedAction.x !== undefined || normalizedAction.y !== undefined) {
        normalizedStepText = `Scroll To (${normalizedAction.x || 0}, ${normalizedAction.y || 0})`;
      } else {
        normalizedStepText = `Scroll ${normalizedAction.normalizedDescription || 'Element'}`;
      }
    }
    normalizedAction.normalizedStepText = normalizedStepText;

    // Avoid duplicates using normalized data
    let isDuplicate = false;
    const recentAction = session.actions[session.actions.length - 1];

    if (recentAction && normalizedAction.timestamp && recentAction.timestamp) {
      // For navigation: check if same URL or same normalized page name
      if (normalizedAction.kind === 'navigate' && recentAction.kind === 'navigate') {
        const sameUrl = normalizedAction.url === recentAction.url;
        const samePage = normalizedAction.normalizedPageName === recentAction.normalizedPageName;
        if ((sameUrl || samePage) && (normalizedAction.timestamp - recentAction.timestamp) < 500) {
          isDuplicate = true;
        }
      }
      // For type actions: merge consecutive types on same selector (keep only the latest value)
      else if (normalizedAction.kind === 'type' && recentAction.kind === 'type') {
        const sameSelector = normalizedAction.normalizedSelector === recentAction.normalizedSelector ||
                            normalizedAction.selector === recentAction.selector;
        if (sameSelector && (normalizedAction.timestamp - recentAction.timestamp) < 2000) {
          // Replace the previous type action with the new one (latest value)
          console.log(`[Action Capture] 🔄 Merging type action: replacing "${recentAction.value}" with "${normalizedAction.value}"`);
          const stepIndex = session.actions.length; // Keep same index since we're replacing
          session.actions[session.actions.length - 1] = normalizedAction;
          
          // Generate live feature step for the updated action
          const liveFeatureStep = generateLiveFeatureStep(normalizedAction, stepIndex, session.actions);
          normalizedAction.liveFeatureStep = liveFeatureStep;
          
          // Update WebSocket client with the merged action
          if (session.ws && session.ws.readyState === 1) {
            try {
              session.ws.send(JSON.stringify({
                type: 'action_updated',
                data: normalizedAction,
                normalized: true,
                liveFeatureStep: liveFeatureStep,
                totalActions: stepIndex,
                actionIndex: stepIndex - 1 // 0-based index
              }));
              console.log(`[Action Capture] ✅ Sent merged type action via WebSocket`);
            } catch (wsError) {
              console.warn(`[Action Capture] ⚠️ Failed to send merged action via WebSocket:`, wsError);
            }
          }
          
          isDuplicate = true; // Don't add as new action, we replaced the previous one
        }
      }
      // For keyPress: check if same key pressed quickly
      else if (normalizedAction.kind === 'keyPress' && recentAction.kind === 'keyPress') {
        const sameKey = normalizedAction.key === recentAction.key;
        if (sameKey && (normalizedAction.timestamp - recentAction.timestamp) < 200) {
          isDuplicate = true;
        }
      }
      // For other actions: check normalized selectors
      else if (normalizedAction.kind === recentAction.kind) {
        const sameSelector = normalizedAction.normalizedSelector === recentAction.normalizedSelector ||
                            normalizedAction.selector === recentAction.selector;
        const sameValue = normalizedAction.value === recentAction.value ||
                         (!normalizedAction.value && !recentAction.value);
        if (sameSelector && sameValue && (normalizedAction.timestamp - recentAction.timestamp) < 100) {
          isDuplicate = true;
        }
      }
    }

    if (!isDuplicate) {
      session.actions.push(normalizedAction);
      const stepIndex = session.actions.length;

      // Generate live feature step
      const liveFeatureStep = generateLiveFeatureStep(normalizedAction, stepIndex, session.actions);
      normalizedAction.liveFeatureStep = liveFeatureStep;

      console.log(`[Action Capture] ✅ Action added! Total actions: ${stepIndex}`);
      console.log(`[Action Capture] Action: ${normalizedAction.kind} - ${normalizedStepText || (normalizedAction.kind === 'navigate' ? normalizedAction.url : (normalizedAction.selector || normalizedAction.value || 'N/A'))}`);

      // Forward to WebSocket client if connected
      if (session.ws && session.ws.readyState === 1) {
        try {
          session.ws.send(JSON.stringify({
            type: 'action',
            data: normalizedAction,
            normalized: true,
            liveFeatureStep: liveFeatureStep,
            totalActions: stepIndex
          }));
          console.log(`[Action Capture] ✅ Sent via WebSocket to client`);
        } catch (wsError) {
          console.warn(`[Action Capture] ⚠️ Failed to send via WebSocket:`, wsError);
        }
      } else {
        console.warn(`[Action Capture] ⚠️ WebSocket not connected (readyState: ${session.ws?.readyState || 'null'})`);
      }
    } else {
      console.log(`[Action Capture] ⏭️ Duplicate action filtered: ${normalizedAction.kind}`);
    }

    console.log(`[Action Capture] ========================================`);
    res.json({
      success: true,
      normalized: !isDuplicate,
      normalizedAction: isDuplicate ? null : normalizedAction,
      duplicate: isDuplicate
    });
  } catch (error) {
    console.error('Action capture error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Helper function to generate live feature step
function generateLiveFeatureStep(action, stepIndex, allActions) {
  if (action.kind === 'navigate') {
    const pageName = action.normalizedPageName || normalizationUtils.extractPageNameFromUrl(action.url || '');
    const keyword = stepIndex === 1 ? 'Given' : 'And';
    return { keyword, text: `${keyword} I Am On ${pageName}`, lineNumber: stepIndex };
  } else if (action.kind === 'click') {
    const desc = action.normalizedDescription || 'Element';
    const keyword = (stepIndex === 1 || allActions[stepIndex - 2]?.kind === 'navigate') ? 'When' : 'And';
    return { keyword, text: `${keyword} I Click "${desc}"`, lineNumber: stepIndex };
  } else if (action.kind === 'type') {
    const desc = action.normalizedDescription || 'Field';
    const value = action.value || '';
    const keyword = 'And';
    return { keyword, text: `And I Enter "${value}" In "${desc}"`, lineNumber: stepIndex };
  } else if (action.kind === 'assertText') {
    const selector = action.selector || action.normalizedDescription || 'element';
    const expectedText = action.expectedValue || action.text || '';
    const keyword = 'Then';
    return { keyword, text: `Then I should see "${expectedText}" in "${selector}"`, lineNumber: stepIndex };
  } else if (action.kind === 'assertVisible') {
    const selector = action.selector || action.normalizedDescription || 'element';
    const keyword = 'Then';
    return { keyword, text: `Then "${selector}" should be visible`, lineNumber: stepIndex };
  } else if (action.kind === 'assertNotVisible') {
    const selector = action.selector || action.normalizedDescription || 'element';
    const keyword = 'Then';
    return { keyword, text: `Then "${selector}" should not be visible`, lineNumber: stepIndex };
  } else if (action.kind === 'assertEnabled') {
    const selector = action.selector || action.normalizedDescription || 'element';
    const keyword = 'Then';
    return { keyword, text: `Then "${selector}" should be enabled`, lineNumber: stepIndex };
  } else if (action.kind === 'assertDisabled') {
    const selector = action.selector || action.normalizedDescription || 'element';
    const keyword = 'Then';
    return { keyword, text: `Then "${selector}" should be disabled`, lineNumber: stepIndex };
  } else if (action.kind === 'assertChecked') {
    const selector = action.selector || action.normalizedDescription || 'element';
    const keyword = 'Then';
    return { keyword, text: `Then "${selector}" should be checked`, lineNumber: stepIndex };
  } else if (action.kind === 'assertNotChecked') {
    const selector = action.selector || action.normalizedDescription || 'element';
    const keyword = 'Then';
    return { keyword, text: `Then "${selector}" should not be checked`, lineNumber: stepIndex };
  } else if (action.kind === 'assertAttribute') {
    const selector = action.selector || action.normalizedDescription || 'element';
    const attrName = action.value || 'attribute';
    const expectedValue = action.expectedValue || '';
    const assertionType = action.assertionType || 'equal';
    const keyword = 'Then';
    return { keyword, text: `Then "${selector}" attribute "${attrName}" should ${assertionType} "${expectedValue}"`, lineNumber: stepIndex };
  } else if (action.kind === 'assertCount') {
    const selector = action.selector || action.normalizedDescription || 'element';
    const count = parseInt(action.expectedValue) || 0;
    const keyword = 'Then';
    return { keyword, text: `Then "${selector}" count should be ${count}`, lineNumber: stepIndex };
  } else if (action.kind === 'assertValue') {
    const selector = action.selector || action.normalizedDescription || 'element';
    const expectedValue = action.expectedValue || '';
    const assertionType = action.assertionType || 'equal';
    const keyword = 'Then';
    return { keyword, text: `Then "${selector}" value should ${assertionType} "${expectedValue}"`, lineNumber: stepIndex };
  } else if (action.kind === 'waitFor') {
    const waitMs = Number(action.ms) || 500;
    const keyword = 'And';
    return { keyword, text: `And I wait for ${waitMs} ms`, lineNumber: stepIndex };
  } else if (action.kind === 'waitForSelector') {
    const selector = action.selector || 'selector';
    const keyword = 'And';
    return { keyword, text: `And I wait for selector "${selector}"`, lineNumber: stepIndex };
  } else if (action.kind === 'screenshot') {
    const filename = action.filename || 'screenshot.png';
    const keyword = 'And';
    return { keyword, text: `And I take screenshot "${filename}"`, lineNumber: stepIndex };
  } else if (action.kind === 'doubleClick') {
    const desc = action.normalizedDescription || 'Element';
    const keyword = 'And';
    return { keyword, text: `And I double click "${desc}"`, lineNumber: stepIndex };
  } else if (action.kind === 'select') {
    const desc = action.normalizedDescription || 'Dropdown';
    const value = action.value || action.selectedText || '';
    const keyword = 'And';
    return { keyword, text: `And I select "${value}" from "${desc}"`, lineNumber: stepIndex };
  } else if (action.kind === 'check') {
    const desc = action.normalizedDescription || 'Checkbox';
    const keyword = 'And';
    return { keyword, text: `And I check "${desc}"`, lineNumber: stepIndex };
  } else if (action.kind === 'uncheck') {
    const desc = action.normalizedDescription || 'Checkbox';
    const keyword = 'And';
    return { keyword, text: `And I uncheck "${desc}"`, lineNumber: stepIndex };
  } else if (action.kind === 'selectRadio') {
    const desc = action.normalizedDescription || 'Radio Group';
    const value = action.value || '';
    const keyword = 'And';
    return { keyword, text: `And I select radio "${value}" in "${desc}"`, lineNumber: stepIndex };
  } else if (action.kind === 'hover') {
    const desc = action.normalizedDescription || 'Element';
    const keyword = 'And';
    return { keyword, text: `And I hover over "${desc}"`, lineNumber: stepIndex };
  } else if (action.kind === 'dragDrop') {
    const source = action.normalizedDescription || 'Element';
    const target = action.normalizedTargetDescription || action.targetSelector || action.target || 'Target';
    const keyword = 'And';
    return { keyword, text: `And I drag "${source}" to "${target}"`, lineNumber: stepIndex };
  } else if (action.kind === 'fileUpload') {
    const desc = action.normalizedDescription || 'Field';
    const filename = action.filename || action.filePath || 'file';
    const keyword = 'And';
    return { keyword, text: `And I upload "${filename}" to "${desc}"`, lineNumber: stepIndex };
  } else if (action.kind === 'keyPress') {
    const key = action.key || action.value || 'Enter';
    const keyword = 'And';
    return { keyword, text: `And I press key "${key}"`, lineNumber: stepIndex };
  } else if (action.kind === 'scroll') {
    const keyword = 'And';
    // Handle new scroll modes: element, y, bottom, top
    if (action.scroll && action.scroll.mode === 'element') {
      const desc = action.normalizedDescription || 'Element';
      return { keyword, text: `And I scroll to "${desc}"`, lineNumber: stepIndex };
    } else if (action.scroll && action.scroll.mode === 'bottom') {
      return { keyword, text: `And I scroll to bottom`, lineNumber: stepIndex };
    } else if (action.scroll && action.scroll.mode === 'top') {
      return { keyword, text: `And I scroll to top`, lineNumber: stepIndex };
    } else if (action.scroll && action.scroll.mode === 'y') {
      const y = action.scroll.y || action.scrollY || action.y || 0;
      return { keyword, text: `And I scroll to position Y ${y}`, lineNumber: stepIndex };
    } else if (action.x !== undefined || action.y !== undefined) {
      // Legacy: scroll to position
      return { keyword, text: `And I scroll to position (${action.x || 0}, ${action.y || 0})`, lineNumber: stepIndex };
    } else {
      // Legacy: scroll to element
      const desc = action.normalizedDescription || 'Element';
      return { keyword, text: `And I scroll to "${desc}"`, lineNumber: stepIndex };
    }
  }
  return null;
}
