const state = {
  steps: [],
  backgroundSteps: [], // Steps marked as background
  scenarios: [], // Multiple scenarios
  currentScenarioSteps: [], // Steps for current scenario
  config: { baseUrl: '', appName: '', defaultBrowser: 'chromium' },
  recording: {
    active: false,
    paused: false,
    sessionId: null,
    ws: null,
    pollingInterval: null,
    renderTimeout: null, // For debounced rendering
    pendingRender: false, // Flag to indicate render is needed
    lastStepCount: 0, // Cache for step count to avoid unnecessary renders
    codeCache: {} // Cache for generated code
  },
  bddOptions: {
    useScenarioOutline: false,
    examples: [],
    markAsBackground: false,
    createNewScenario: false
  },
  examplesJustUpdated: false, // Flag to force feature code update when examples change
  stepsChangedAfterRecording: false, // Flag to force update Gherkin and step definitions when steps change after recording
  clipboard: [], // Clipboard to store copied steps for paste operation
  stateHistory: [], // History of state snapshots for revert functionality
  maxHistorySize: 50, // Maximum number of history entries
  currentProjectName: null,
  currentProjectId: null, // Current project ID
  currentStepsFilePath: null,
  autoSaveEnabled: true, // Auto-save project on changes
  autoSaveTimeout: null, // Debounce timer for auto-save
  stepDefinitionMap: new Map(), // Maps step patterns to line numbers in step definitions
  stepMapping: {
    gherkinToStep: new Map(), // Maps Gherkin line index to step index
    stepToGherkin: new Map(), // Maps step index to Gherkin line index
    gherkinToStepDef: new Map(), // Maps Gherkin line index to step definition line
    stepDefToGherkin: new Map(), // Maps step definition line to Gherkin line indices
    highlightedStep: null, // Currently highlighted step index
    highlightedGherkinLine: null, // Currently highlighted Gherkin line
    highlightedStepDefLine: null // Currently highlighted step definition line
  },
  flows: [], // Reusable flows (saved step sequences)
  testDataSets: [], // Saved test data sets for scenario outlines
  selectedStepIndices: [], // For multi-select operations
  pendingRecording: null // Stores recording data waiting for user approval
};

// [ZAC-FIX 2026-05-24] Expose `state` on window so other same-origin
// scripts (zacFixes.js framework-pill installer, the rerun→dashboard
// harness, and any future integration) can read currentProjectId /
// currentProjectFramework / steps without parsing app.js's IIFE
// closure. Read-only by convention; mutate at your own risk.
try { if (typeof window !== 'undefined') window.state = state; } catch (_) { /* SSR/sandbox */ }

// State history management for revert functionality
function saveStateSnapshot() {
  try {
    const snapshot = {
      timestamp: Date.now(),
      steps: JSON.parse(JSON.stringify(state.steps)),
      backgroundSteps: JSON.parse(JSON.stringify(state.backgroundSteps)),
      scenarios: JSON.parse(JSON.stringify(state.scenarios)),
      bddOptions: JSON.parse(JSON.stringify(state.bddOptions)),
    };
    
    // Add to history
    state.stateHistory.push(snapshot);
    
    // Limit history size
    if (state.stateHistory.length > state.maxHistorySize) {
      state.stateHistory.shift(); // Remove oldest entry
    }
    
    console.log(`[State History] Saved snapshot (${state.stateHistory.length}/${state.maxHistorySize})`);
  } catch (e) {
    console.warn('[State History] Failed to save snapshot:', e);
  }
}

// Revert to previous state
function revertToPreviousState() {
  if (state.stateHistory.length === 0) {
    showToast('No previous state to revert to!', 'error');
    return;
  }
  
  // Ask for confirmation
  if (!confirm('Are you sure you want to revert to the previous state? This will undo your recent changes.')) {
    return;
  }
  
  try {
    const previousState = state.stateHistory.pop(); // Get and remove the last snapshot
    
    // Restore state
    state.steps = previousState.steps;
    state.backgroundSteps = previousState.backgroundSteps;
    state.scenarios = previousState.scenarios;
    state.bddOptions = previousState.bddOptions;
    
    // Mark that steps changed
    state.stepsChangedAfterRecording = true;
    
    // Save to localStorage
    saveStateToLocalStorage();
    
    // Re-render everything
    render();
    
    showToast('State reverted successfully!', 'success');
    console.log('[State History] Reverted to previous state');
  } catch (e) {
    console.error('[State History] Failed to revert state:', e);
    showToast('Failed to revert state!', 'error');
  }
}

// LocalStorage persistence functions
function saveStateToLocalStorage() {
  try {
    const stateToSave = {
      steps: state.steps,
      backgroundSteps: state.backgroundSteps,
      scenarios: state.scenarios,
      bddOptions: state.bddOptions,
      currentProjectName: state.currentProjectName,
      // Don't save recording state, sessionId, ws, etc. as they're session-specific
    };
    localStorage.setItem('zeroCodeAutomationState', JSON.stringify(stateToSave));
    console.log('[State] Saved to localStorage');
  } catch (e) {
    console.warn('[State] Failed to save to localStorage:', e);
  }
}

function loadStateFromLocalStorage() {
  try {
    const saved = localStorage.getItem('zeroCodeAutomationState');
    if (saved) {
      const savedState = JSON.parse(saved);
      if (savedState.steps && Array.isArray(savedState.steps) && savedState.steps.length > 0) {
        state.steps = savedState.steps;
        console.log(`[State] Loaded ${state.steps.length} steps from localStorage`);
      }
      if (savedState.backgroundSteps && Array.isArray(savedState.backgroundSteps)) {
        state.backgroundSteps = savedState.backgroundSteps;
      }
      if (savedState.scenarios && Array.isArray(savedState.scenarios)) {
        state.scenarios = savedState.scenarios;
      }
      if (savedState.bddOptions) {
        state.bddOptions = { ...state.bddOptions, ...savedState.bddOptions };
      }
      if (savedState.currentProjectName) {
        state.currentProjectName = savedState.currentProjectName;
      }
      return true;
    }
  } catch (e) {
    console.warn('[State] Failed to load from localStorage:', e);
  }
  return false;
}

function clearStateFromLocalStorage() {
  try {
    localStorage.removeItem('zeroCodeAutomationState');
    console.log('[State] Cleared from localStorage');
  } catch (e) {
    console.warn('[State] Failed to clear localStorage:', e);
  }
}

// Optimized debounced render function for smooth recording
function debouncedRender() {
  if (!state.recording.active) {
    // Not recording, render immediately
    render();
    return;
  }
  
  // Update step count immediately (lightweight operation)
  const stepCount = document.getElementById('stepCount');
  if (stepCount && state.steps.length !== state.recording.lastStepCount) {
    stepCount.textContent = state.steps.length;
    state.recording.lastStepCount = state.steps.length;
  }
  
  // Clear existing timeout
  if (state.recording.renderTimeout) {
    clearTimeout(state.recording.renderTimeout);
  }
  
  // Mark that render is needed
  state.recording.pendingRender = true;
  
  // Use requestAnimationFrame for smooth updates, debounced to max 5fps during recording (200ms)
  // This reduces CPU usage and makes recording smoother
  state.recording.renderTimeout = setTimeout(() => {
    if (state.recording.pendingRender) {
      // Use requestAnimationFrame for smooth UI updates
      requestAnimationFrame(() => {
        render();
        state.recording.pendingRender = false;
      });
    }
  }, 200); // Update at most every 200ms (5fps) during recording for better performance
}


async function loadConfig(){
  // [ZAC-FIX] Defensive load — when the rate limiter kicks in or the
  // server is restarting, we used to render literal "undefined | undefined"
  // in the header. Now we keep the previous good values, fall back to the
  // ZacSettings store when present, and retry once after a short delay.
  const meta = document.getElementById('app-meta');
  function paint(cfg) {
    if (!cfg || (cfg.error && !cfg.baseUrl)) return false;
    state.config = cfg;
    document.getElementById('app-title').textContent = cfg.appName || 'Zero-Code Automation IDE';
    if (meta) {
      const baseUrl = cfg.baseUrl    || (window.ZacSettings && window.ZacSettings.get().defaultBaseUrl)  || '—';
      const browser = cfg.defaultBrowser || (window.ZacSettings && window.ZacSettings.get().defaultBrowser) || '—';
      meta.textContent = `Base URL: ${baseUrl} | Browser: ${browser}`;
    }
    const bu = document.getElementById('baseUrl');
    if (bu && cfg.baseUrl) bu.value = cfg.baseUrl;
    return true;
  }
  async function attempt(retry) {
    try {
      const resp = await fetch('/api/config');
      const cfg = await resp.json();
      if (resp.status === 429 || (cfg && cfg.error)) {
        if (meta && !meta.textContent) meta.textContent = '(loading config…)';
        if (retry) setTimeout(() => attempt(false), 4000);
        return;
      }
      paint(cfg);
    } catch (e) {
      console.warn('[loadConfig]', e.message);
      if (retry) setTimeout(() => attempt(false), 4000);
    }
  }
  attempt(true);
}

// Use common step icon from StepHandlers with fallback
function getStepIcon(kind) {
  if (window.StepHandlers && window.StepHandlers.getStepIcon) {
    return window.StepHandlers.getStepIcon(kind);
  }
  // Fallback for additional icons not in common handler
  const additionalIcons = {
    selectRadio: '🔘',
    dragDrop: '↔️',
    fileUpload: '📁',
    scroll: '📜',
    assertCount: '🔢',
    assertValue: '📋',
    assertVisible: '✓',
    assertNotVisible: '✗',
    assertEnabled: '✅',
    assertDisabled: '❌',
    assertChecked: '☑',
    assertNotChecked: '☐',
    assertText: '📝',
    assertAttribute: '🏷️',
    apiCall: '🌐',
    close: '❌'
  };
  return additionalIcons[kind] || '•';
}

// Use common step label from StepHandlers with fallback for additional cases
function getStepLabel(step) {
  // Try common handler first
  if (window.StepHandlers && window.StepHandlers.getStepLabel) {
    const commonLabel = window.StepHandlers.getStepLabel(step);
    if (commonLabel && !commonLabel.includes('action')) {
      return commonLabel;
    }
  }
  
  // Fallback for additional step types not in common handler
  switch(step.kind) {
    case 'selectRadio': return `Select radio "${step.value || step.expectedValue || 'option'}" in ${step.normalizedDescription || step.selector || 'group'}`;
    case 'dragDrop': return `Drag ${step.normalizedDescription || step.selector || 'element'} to ${step.normalizedTargetDescription || step.targetSelector || 'target'}`;
    case 'fileUpload': return `Upload "${step.value || step.filename || 'file'}" to ${step.normalizedDescription || step.selector || 'input'}`;
    case 'scroll': 
      if (step.scroll && step.scroll.mode === 'element') {
        return `Scroll to ${step.normalizedDescription || step.selector || 'element'}`;
      } else if (step.scroll && step.scroll.mode === 'bottom') {
        return `Scroll to bottom`;
      } else if (step.scroll && step.scroll.mode === 'top') {
        return `Scroll to top`;
      } else if (step.scrollY !== undefined || (step.scroll && step.scroll.y !== undefined)) {
        const y = step.scrollY || (step.scroll && step.scroll.y) || 0;
        return `Scroll to Y position ${y}`;
      } else if (step.x !== undefined && step.y !== undefined) {
        return `Scroll to position (${step.x}, ${step.y})`;
      }
      return `Scroll to ${step.normalizedDescription || step.selector || 'element'}`;
    case 'apiCall': return `${step.method || 'GET'} ${step.url || ''}`;
    default: 
      // Try to use normalized step text if available
      if (step.normalizedStepText) {
        return step.normalizedStepText;
      }
      // Fallback to showing kind and selector
      return `${step.kind || 'action'}: ${step.selector || step.value || step.url || 'N/A'}`;
  }
}

function renderSteps(){
  const list = document.getElementById('stepsList');
  const stepCount = document.getElementById('stepCount');
  
  if (!list) {
    console.error('[renderSteps] stepsList element not found!');
    return;
  }
  
  // Update step count immediately (lightweight operation)
  if (stepCount) {
    stepCount.textContent = state.steps.length;
  }
  
  // Add global paste button in header if clipboard has steps
  const stepsContainer = list.closest('.steps-container');
  if (stepsContainer) {
    const header = stepsContainer.querySelector('div[style*="justify-content: space-between"]');
    if (header) {
      // Remove existing paste button if any
      const existingPasteBtn = header.querySelector('.global-paste-btn');
      if (existingPasteBtn) {
        existingPasteBtn.remove();
      }
      
      // Add paste button if clipboard has steps
      if (state.clipboard && state.clipboard.length > 0) {
        const pasteBtn = document.createElement('button');
        pasteBtn.className = 'global-paste-btn';
        pasteBtn.style.cssText = 'padding: 6px 12px; font-size: 12px; background: linear-gradient(135deg, #10b981 0%, #34d399 100%); border: none; border-radius: 6px; color: white; cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 6px;';
        pasteBtn.innerHTML = `<span>📥 Paste ${state.clipboard.length} step(s) at beginning</span>`;
        pasteBtn.title = `Paste ${state.clipboard.length} step(s) at the beginning of the list`;
        pasteBtn.onclick = () => {
          // Paste at beginning (index -1 means before first step)
          pasteStep(-1);
        };
        header.appendChild(pasteBtn);
      }
    }
  }
  
  // During recording, use DocumentFragment for better performance
  const fragment = state.recording.active ? document.createDocumentFragment() : null;
  
  // Clear list
  list.innerHTML = '';
  
  // Reduced logging during recording for better performance
  if (!state.recording.active) {
    console.log(`[renderSteps] Rendering ${state.steps.length} steps`);
  }
  
  if (state.steps.length === 0) {
    const emptyMsg = document.createElement('li');
    emptyMsg.style.cssText = 'padding: 20px; text-align: center; color: var(--muted); font-style: italic;';
    emptyMsg.textContent = 'No steps recorded yet. Start recording to capture actions.';
    
    // Add paste button in empty state if clipboard has steps
    if (state.clipboard && state.clipboard.length > 0) {
      const pasteBtnContainer = document.createElement('div');
      pasteBtnContainer.style.cssText = 'margin-top: 12px;';
      const pasteBtn = document.createElement('button');
      pasteBtn.style.cssText = 'padding: 8px 16px; font-size: 13px; background: linear-gradient(135deg, #10b981 0%, #34d399 100%); border: none; border-radius: 6px; color: white; cursor: pointer; font-weight: 600;';
      pasteBtn.innerHTML = `📥 Paste ${state.clipboard.length} step(s)`;
      pasteBtn.onclick = () => pasteStep(-1);
      pasteBtnContainer.appendChild(pasteBtn);
      emptyMsg.appendChild(pasteBtnContainer);
    }
    
    list.appendChild(emptyMsg);
    return;
  }
  
  state.steps.forEach((s, idx) => {
    try {
      const isAssertion = s.kind && s.kind.startsWith('assert');
      const li = document.createElement('li');
      li.className = `step-item ${isAssertion ? 'assertion' : 'action'}`;
      li.style.cssText = 'padding: 12px; margin-bottom: 8px; background: rgba(15, 21, 34, 0.4); border: 1px solid var(--border); border-radius: 8px; display: flex; justify-content: space-between; align-items: center;';
      
      const stepLabel = getStepLabel(s);
      const stepIcon = getStepIcon(s.kind);
      
      // Check if this step will be parameterized in Scenario Outline
      const useScenarioOutline = state.bddOptions.useScenarioOutline && state.bddOptions.examples.length > 0;
      const exampleKeys = useScenarioOutline && state.bddOptions.examples.length > 0 ? Object.keys(state.bddOptions.examples[0]) : [];
      const parameterizedFields = useScenarioOutline ? getParameterizedStepFields(s, exampleKeys) : [];
      const willBeParameterized = parameterizedFields.length > 0;
      
      // Create step content structure
      const stepContent = document.createElement('div');
      stepContent.className = 'step-content';
      stepContent.style.cssText = 'display: flex; align-items: center; gap: 8px; flex: 1;';
      
      const stepIconSpan = document.createElement('span');
      stepIconSpan.className = 'step-icon';
      stepIconSpan.style.cssText = 'font-size: 18px;';
      stepIconSpan.textContent = stepIcon;
      
      // Create editable step text
      const stepTextSpan = document.createElement('span');
      stepTextSpan.className = 'step-text';
      let displayLabel = stepLabel;
      
      // Show placeholder indicator if step will be parameterized
      if (willBeParameterized) {
        // Replace actual values with placeholders in display
        parameterizedFields.forEach(({ field, placeholder }) => {
          if (s[field] !== undefined && s[field] !== null) {
            const value = String(s[field]);
            // Escape special regex characters
            const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Replace the value with placeholder
            displayLabel = displayLabel.replace(new RegExp(`"${escapedValue}"`, 'g'), `"${placeholder}"`);
            // Also handle cases where value might not be in quotes
            displayLabel = displayLabel.replace(new RegExp(`\\b${escapedValue}\\b`, 'g'), placeholder);
          }
        });
        
        // Add visual indicator
        stepTextSpan.style.cssText = 'flex: 1; cursor: text; padding: 4px 8px 4px 11px; border-left: 3px solid #8b5cf6; border-radius: 4px; transition: background 0.2s; min-width: 0;';
        const fieldNames = parameterizedFields.map(f => f.placeholder).join(', ');
        stepTextSpan.title = `This step will be parameterized with Scenario Outline data (${fieldNames})`;
      } else {
        stepTextSpan.style.cssText = 'flex: 1; cursor: text; padding: 4px 8px; border-radius: 4px; transition: background 0.2s; min-width: 0;';
        stepTextSpan.title = 'Click to edit step description';
      }
      
      stepTextSpan.textContent = displayLabel;
      
      // Make step text editable on click
      stepTextSpan.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        const currentText = this.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentText;
        input.style.cssText = 'width: 100%; padding: 4px 8px; background: rgba(13, 17, 23, 0.8); border: 1px solid var(--accent); border-radius: 4px; color: var(--text); font-size: 14px; flex: 1; min-width: 200px;';
        
        const stepIndex = idx; // Capture idx in closure
        const textSpan = this; // Reference to the span
        
        const saveEdit = () => {
          const newText = input.value.trim();
          if (newText && newText !== currentText) {
            // Update step's normalizedStepText or create a custom label
            if (!state.steps[stepIndex]) {
              console.warn(`[renderSteps] Step at index ${stepIndex} not found`);
              return;
            }
            state.steps[stepIndex].normalizedStepText = newText;
            // Also update normalizedDescription for display
            state.steps[stepIndex].normalizedDescription = newText;
            textSpan.textContent = newText;
            saveStateToLocalStorage();
            render(); // Re-render to update code generation
          } else {
            textSpan.textContent = currentText;
          }
          textSpan.style.display = '';
          if (input.parentNode) {
            input.parentNode.removeChild(input);
          }
        };
        
        input.addEventListener('blur', saveEdit);
        input.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            this.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            textSpan.textContent = currentText;
            textSpan.style.display = '';
            if (this.parentNode) {
              this.parentNode.removeChild(this);
            }
          }
        });
        
        textSpan.style.display = 'none';
        textSpan.parentNode.insertBefore(input, textSpan);
        input.focus();
        input.select();
      });
      
      // Hover effect
      stepTextSpan.addEventListener('mouseenter', function() {
        this.style.background = 'rgba(90, 169, 255, 0.1)';
      });
      stepTextSpan.addEventListener('mouseleave', function() {
        this.style.background = '';
      });
      
      // Build step content
      stepContent.appendChild(stepIconSpan);
      stepContent.appendChild(stepTextSpan);
      
      // Create step actions
      const stepActions = document.createElement('div');
      stepActions.className = 'step-actions';
      stepActions.style.cssText = 'display: flex; gap: 4px;';
      
      const editBtn = document.createElement('button');
      editBtn.className = 'step-btn';
      editBtn.innerHTML = '<span>✏️ Edit</span>';
      editBtn.title = 'Edit';
      editBtn.onclick = () => editStep(idx);
      
      const copyBtn = document.createElement('button');
      copyBtn.className = 'step-btn';
      copyBtn.innerHTML = '<span>📋 Copy</span>';
      copyBtn.title = 'Copy to clipboard';
      copyBtn.onclick = (e) => {
        e.stopPropagation();
        copyStep(idx);
      };
      
      const dupBtn = document.createElement('button');
      dupBtn.className = 'step-btn';
      dupBtn.innerHTML = '<span>📄 Duplicate</span>';
      dupBtn.title = 'Duplicate immediately';
      dupBtn.onclick = (e) => {
        e.stopPropagation();
        duplicateStep(idx);
      };
      
      const delBtn = document.createElement('button');
      delBtn.className = 'step-btn danger';
      delBtn.innerHTML = '<span>🗑️ Delete</span>';
      delBtn.title = 'Delete';
      delBtn.onclick = (e) => {
        e.stopPropagation();
        deleteStep(idx);
      };
      
      stepActions.appendChild(editBtn);
      stepActions.appendChild(copyBtn);
      stepActions.appendChild(dupBtn);
      stepActions.appendChild(delBtn);
      
      // Add paste button if clipboard has steps
      if (state.clipboard && state.clipboard.length > 0) {
        const pasteBtn = document.createElement('button');
        pasteBtn.className = 'step-btn';
        pasteBtn.style.background = 'rgba(16, 185, 129, 0.2)';
        pasteBtn.style.border = '1px solid rgba(16, 185, 129, 0.4)';
        pasteBtn.innerHTML = `<span>📥 Paste (${state.clipboard.length})</span>`;
        pasteBtn.title = `Paste ${state.clipboard.length} step(s) after this step`;
        pasteBtn.onclick = (e) => {
          e.stopPropagation();
          pasteStep(idx);
        };
        stepActions.appendChild(pasteBtn);
      }
      
      if (idx > 0) {
        const upBtn = document.createElement('button');
        upBtn.className = 'step-btn';
        upBtn.innerHTML = '<span>⬆️ Up</span>';
        upBtn.title = 'Move Up';
        upBtn.onclick = () => moveStepUp(idx);
        stepActions.appendChild(upBtn);
      }
      
      if (idx < state.steps.length - 1) {
        const downBtn = document.createElement('button');
        downBtn.className = 'step-btn';
        downBtn.innerHTML = '<span>⬇️ Down</span>';
        downBtn.title = 'Move Down';
        downBtn.onclick = () => moveStepDown(idx);
        stepActions.appendChild(downBtn);
      }
      
      // Add scroll options button for scroll steps
      if (s.kind === 'scroll') {
        const scrollConfigBtn = document.createElement('button');
        scrollConfigBtn.className = 'step-btn';
        scrollConfigBtn.style.background = 'rgba(139, 92, 246, 0.2)';
        scrollConfigBtn.style.border = '1px solid rgba(139, 92, 246, 0.4)';
        scrollConfigBtn.innerHTML = '<span>⚙️ Scroll Options</span>';
        scrollConfigBtn.title = 'Configure scroll options';
        scrollConfigBtn.onclick = (e) => {
          e.stopPropagation();
          showScrollOptionsModal(idx, s);
        };
        stepActions.appendChild(scrollConfigBtn);
      }
      
      // Add click handler to navigate to Gherkin and step definition
      li.addEventListener('click', function(e) {
        // Don't navigate if clicking on buttons or editing text
        if (e.target.closest('.step-actions') || e.target.closest('input')) {
          return;
        }
        
        // Navigate to corresponding Gherkin line
        const gherkinLine = state.stepMapping.stepToGherkin.get(idx);
        if (gherkinLine !== undefined) {
          navigateToGherkin(gherkinLine);
          
          // Navigate to step definition
          const stepDefLine = state.stepMapping.gherkinToStepDef.get(gherkinLine);
          if (stepDefLine) {
            navigateToStepDef(stepDefLine);
          }
        }
      });
      
      // Add visual indicator that step is clickable
      li.style.cursor = 'pointer';
      li.title = 'Click to navigate to Gherkin and Step Definition';
      
      // Assemble the list item
      li.appendChild(stepContent);
      li.appendChild(stepActions);
      
      // Use fragment during recording for better performance
      if (fragment) {
        fragment.appendChild(li);
      } else {
    list.appendChild(li);
      }
    } catch (error) {
      console.error(`[renderSteps] Error rendering step ${idx}:`, error, s);
    }
  });
  
  // Append fragment in one operation for better performance during recording
  if (fragment) {
    list.appendChild(fragment);
  }
  
  // Add paste button at the end if clipboard has steps
  if (state.clipboard && state.clipboard.length > 0 && state.steps.length > 0) {
    const pasteAtEndLi = document.createElement('li');
    pasteAtEndLi.style.cssText = 'padding: 12px; margin-top: 8px; background: rgba(16, 185, 129, 0.1); border: 2px dashed rgba(16, 185, 129, 0.4); border-radius: 8px; text-align: center;';
    const pasteAtEndBtn = document.createElement('button');
    pasteAtEndBtn.style.cssText = 'padding: 8px 16px; font-size: 13px; background: linear-gradient(135deg, #10b981 0%, #34d399 100%); border: none; border-radius: 6px; color: white; cursor: pointer; font-weight: 600;';
    pasteAtEndBtn.innerHTML = `📥 Paste ${state.clipboard.length} step(s) at end`;
    pasteAtEndBtn.title = `Paste ${state.clipboard.length} step(s) at the end of the list`;
    pasteAtEndBtn.onclick = () => {
      // Paste at end (after last step)
      pasteStep(state.steps.length - 1);
    };
    pasteAtEndLi.appendChild(pasteAtEndBtn);
    list.appendChild(pasteAtEndLi);
  }
  
  // Reduced logging during recording for better performance
  if (!state.recording.active) {
    console.log(`[renderSteps] Successfully rendered ${list.children.length} step items`);
  }
}

// Step management functions
window.editStep = (idx) => {
  const step = state.steps[idx];
  document.getElementById('stepKind').value = step.kind || 'click';
  document.getElementById('selector').value = step.selector || '';
  document.getElementById('value').value = step.value || step.url || step.text || '';
  document.getElementById('expectedValue').value = step.expectedValue || '';
  document.getElementById('method').value = step.method || 'GET';
  document.getElementById('pageName').value = step.pageName || '';
  document.getElementById('elementName').value = step.elementName || '';
  
  // Show/hide assertion fields
  const stepKind = document.getElementById('stepKind').value;
  const isAssertion = stepKind.startsWith('assert');
  document.getElementById('expectedValue').style.display = isAssertion ? 'block' : 'none';
  document.getElementById('assertionType').style.display = isAssertion ? 'block' : 'none';
  
  // Save snapshot before making changes
  if (!state.recording.active) {
    saveStateSnapshot();
  }
  
  // Delete the step and allow re-adding
  state.steps.splice(idx, 1);
  // Mark that steps changed after recording
  if (!state.recording.active) {
    state.stepsChangedAfterRecording = true;
  }
  saveStateToLocalStorage();
  render();
};

window.deleteStep = (idx) => {
  if (confirm('Delete this step?')) {
    // Save snapshot before making changes
    if (!state.recording.active) {
      saveStateSnapshot();
    }
    
    state.steps.splice(idx, 1);
    // Mark that steps changed after recording
    if (!state.recording.active) {
      state.stepsChangedAfterRecording = true;
    }
    saveStateToLocalStorage();
    autoSaveProject(); // Auto-save project
    render();
  }
};

window.duplicateStep = (idx) => {
  const step = JSON.parse(JSON.stringify(state.steps[idx]));
  state.steps.splice(idx + 1, 0, step);
  // Mark that steps changed after recording
  if (!state.recording.active) {
    state.stepsChangedAfterRecording = true;
  }
  saveStateToLocalStorage();
  render();
};

// Simple toast notification function
function showToast(message, type = 'info') {
  // Create toast element
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    background: ${type === 'success' ? 'rgba(16, 185, 129, 0.9)' : type === 'error' ? 'rgba(239, 68, 68, 0.9)' : 'rgba(90, 169, 255, 0.9)'};
    color: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 10000;
    font-size: 14px;
    font-weight: 500;
    animation: slideIn 0.3s ease-out;
  `;
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  // Remove after 3 seconds
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 3000);
}

// Copy step(s) to clipboard
window.copyStep = (idx) => {
  // Copy single step
  const step = JSON.parse(JSON.stringify(state.steps[idx]));
  state.clipboard = [step];
  // Show visual feedback
  showToast('Step copied to clipboard!', 'success');
  // Re-render to show paste button
  render();
};

// Copy multiple steps (for future multi-select feature)
window.copySteps = (indices) => {
  const steps = indices.map(idx => JSON.parse(JSON.stringify(state.steps[idx])));
  state.clipboard = steps;
  showToast(`${steps.length} step(s) copied to clipboard!`, 'success');
  render();
};

// Paste step(s) from clipboard at a specific position
window.pasteStep = (idx) => {
  if (!state.clipboard || state.clipboard.length === 0) {
    showToast('No steps in clipboard!', 'error');
    return;
  }
  
  // Deep copy clipboard steps
  const stepsToPaste = state.clipboard.map(step => JSON.parse(JSON.stringify(step)));
  
  // Insert steps after the specified index
  // If idx is -1, paste at the beginning
  if (idx === -1) {
    state.steps.splice(0, 0, ...stepsToPaste);
  } else {
    state.steps.splice(idx + 1, 0, ...stepsToPaste);
  }
  
  // Mark that steps changed after recording
  if (!state.recording.active) {
    state.stepsChangedAfterRecording = true;
  }
  
  saveStateToLocalStorage();
  autoSaveProject(); // Auto-save project
  showToast(`${stepsToPaste.length} step(s) pasted!`, 'success');
  render();
};

window.moveStepUp = (idx) => {
  if (idx > 0) {
    [state.steps[idx], state.steps[idx - 1]] = [state.steps[idx - 1], state.steps[idx]];
    // Mark that steps changed after recording
    if (!state.recording.active) {
      state.stepsChangedAfterRecording = true;
    }
    saveStateToLocalStorage();
    autoSaveProject(); // Auto-save project
    render();
  }
};

window.moveStepDown = (idx) => {
  if (idx < state.steps.length - 1) {
    [state.steps[idx], state.steps[idx + 1]] = [state.steps[idx + 1], state.steps[idx]];
    // Mark that steps changed after recording
    if (!state.recording.active) {
      state.stepsChangedAfterRecording = true;
    }
    saveStateToLocalStorage();
    autoSaveProject(); // Auto-save project
    render();
  }
};

function generatePlaywright(){
  const baseUrl = document.getElementById('baseUrl').value || 'http://example.com';
  const lines = [];
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push('');
  const title = document.getElementById('featureTitle').value || 'Recorded Flow';
  lines.push(`test('${title}', async ({ page }) => {`);
  lines.push(`  await page.goto('${baseUrl}');`);
  
  // Use common step handler function
  for(const s of state.steps){
    const stepCode = window.StepHandlers.generatePlaywrightStepCode(s);
    if (stepCode) {
      lines.push(stepCode);
    }
  }
  
  lines.push('});');
  return lines.join('\n');
}

// [ZAC-FIX 2026-05-24] Framework-aware code preview dispatcher.
// Replaces the old hard-coded `generateSelenium()` that always emitted
// Selenium Java even when the user picked Playwright. Each framework
// gets its own preview generator below; generateSelenium() is kept
// as the kept name (because renderCode + many call sites already
// reference it) but now dispatches to the correct branch.
function generateSelenium() {
  const fwRaw = document.getElementById('framework')?.value;
  const fw = fwRaw || state.currentProjectFramework || 'playwright-java';
  switch (fw) {
    case 'selenium-java':
    case 'selenium-testng':
      return _generateSeleniumJavaCode(fw);
    case 'playwright-java':
      return _generatePlaywrightJavaCode();
    case 'playwright-javascript':
      return _generatePlaywrightJsCode(false);
    case 'playwright-typescript':
      return _generatePlaywrightJsCode(true);
    default:
      return _generateSeleniumJavaCode('selenium-java');
  }
}

// ── Playwright Java preview ────────────────────────────────────────
function _generatePlaywrightJavaCode() {
  const baseUrl = document.getElementById('baseUrl')?.value || 'about:blank';
  const browserType = document.getElementById('browserType')?.value || 'chromium';
  const title = (document.getElementById('featureTitle')?.value || 'Recorded').replace(/\s+/g, '');
  const lines = [];
  lines.push('package tests;');
  lines.push('');
  lines.push('import com.microsoft.playwright.*;');
  lines.push('import org.junit.jupiter.api.*;');
  lines.push('import static org.junit.jupiter.api.Assertions.*;');
  lines.push('');
  lines.push('public class ' + title + 'Test {');
  lines.push('    private static Playwright playwright;');
  lines.push('    private static Browser browser;');
  lines.push('    private static BrowserContext context;');
  lines.push('    private static Page page;');
  lines.push('');
  lines.push('    @BeforeAll public static void setUp() {');
  lines.push('        playwright = Playwright.create();');
  lines.push('        browser = playwright.' + browserType + '().launch(new BrowserType.LaunchOptions().setHeadless(false));');
  lines.push('        context = browser.newContext();');
  lines.push('        page = context.newPage();');
  lines.push('    }');
  lines.push('');
  lines.push('    @Test public void testRecordedFlow() {');
  lines.push('        page.navigate("' + baseUrl + '");');
  for (const s of (state.steps || [])) {
    if (s.kind === 'navigate' && s.url)         lines.push('        page.navigate("' + s.url + '");');
    else if (s.kind === 'click' && s.selector)  lines.push('        page.click("' + s.selector.replace(/"/g, '\\"') + '");');
    else if ((s.kind === 'type' || s.kind === 'fill') && s.selector)
                                                lines.push('        page.fill("' + s.selector.replace(/"/g, '\\"') + '", "' + (s.value || '').replace(/"/g, '\\"') + '");');
    else if (s.kind === 'waitFor' && s.ms)      lines.push('        page.waitForTimeout(' + s.ms + ');');
    else if (s.kind === 'waitForSelector' && s.selector)
                                                lines.push('        page.waitForSelector("' + s.selector.replace(/"/g, '\\"') + '");');
  }
  lines.push('    }');
  lines.push('');
  lines.push('    @AfterAll public static void tearDown() {');
  lines.push('        if (context != null) context.close();');
  lines.push('        if (browser != null) browser.close();');
  lines.push('        if (playwright != null) playwright.close();');
  lines.push('    }');
  lines.push('}');
  return lines.join('\n');
}

// ── Playwright JS / TS preview ─────────────────────────────────────
function _generatePlaywrightJsCode(isTs) {
  const baseUrl = document.getElementById('baseUrl')?.value || 'about:blank';
  const lines = [];
  if (isTs) {
    lines.push("import { test, expect, Page } from '@playwright/test';");
  } else {
    lines.push("const { test, expect } = require('@playwright/test');");
  }
  lines.push('');
  lines.push("test('recorded flow', async ({ page }" + (isTs ? ': { page: Page }' : '') + ") => {");
  lines.push("  await page.goto('" + baseUrl + "');");
  for (const s of (state.steps || [])) {
    if (s.kind === 'navigate' && s.url)         lines.push("  await page.goto('" + s.url + "');");
    else if (s.kind === 'click' && s.selector)  lines.push("  await page.click('" + s.selector.replace(/'/g, "\\'") + "');");
    else if ((s.kind === 'type' || s.kind === 'fill') && s.selector)
                                                lines.push("  await page.fill('" + s.selector.replace(/'/g, "\\'") + "', '" + (s.value || '').replace(/'/g, "\\'") + "');");
    else if (s.kind === 'waitFor' && s.ms)      lines.push('  await page.waitForTimeout(' + s.ms + ');');
    else if (s.kind === 'waitForSelector' && s.selector)
                                                lines.push("  await page.waitForSelector('" + s.selector.replace(/'/g, "\\'") + "');");
  }
  lines.push('});');
  return lines.join('\n');
}

// ── Selenium Java preview (covers selenium-java + selenium-testng) ──
function _generateSeleniumJavaCode(fw) {
  const baseUrl = document.getElementById('baseUrl').value || 'http://example.com';
  const browserType = document.getElementById('browserType')?.value || 'chromium';
  const lines = [];
  lines.push(`package tests;`);
  lines.push('');
  lines.push(`import org.openqa.selenium.WebDriver;`);
  lines.push(`import org.openqa.selenium.By;`);
  lines.push(`import org.openqa.selenium.WebElement;`);
  lines.push(`import org.openqa.selenium.chrome.ChromeDriver;`);
  lines.push(`import org.openqa.selenium.chrome.ChromeOptions;`);
  lines.push(`import org.openqa.selenium.firefox.FirefoxDriver;`);
  lines.push(`import org.openqa.selenium.firefox.FirefoxOptions;`);
  lines.push(`import org.openqa.selenium.support.ui.WebDriverWait;`);
  lines.push(`import org.openqa.selenium.support.ui.ExpectedConditions;`);
  lines.push(`import org.openqa.selenium.support.ui.Select;`);
  lines.push(`import org.junit.jupiter.api.*;`);
  lines.push(`import static org.junit.jupiter.api.Assertions.*;`);
  lines.push(`import java.time.Duration;`);
  lines.push('');
  const title = document.getElementById('featureTitle').value || 'Recorded Flow';
  lines.push(`public class ${title.replace(/\s+/g, '')}Test {`);
  lines.push(`  private static WebDriver driver;`);
  lines.push(`  private static WebDriverWait wait;`);
  lines.push('');
  lines.push(`  @BeforeAll`);
  lines.push(`  public static void setUp() {`);
  const seleniumBrowser = browserType === 'chromium' ? 'chrome' : browserType === 'webkit' ? 'safari' : browserType;
  if (seleniumBrowser === 'chrome') {
    lines.push(`    ChromeOptions options = new ChromeOptions();`);
    lines.push(`    driver = new ChromeDriver(options);`);
  } else if (seleniumBrowser === 'firefox') {
    lines.push(`    FirefoxOptions options = new FirefoxOptions();`);
    lines.push(`    driver = new FirefoxDriver(options);`);
  } else {
    lines.push(`    ChromeOptions options = new ChromeOptions();`);
    lines.push(`    driver = new ChromeDriver(options);`);
  }
  lines.push(`    wait = new WebDriverWait(driver, Duration.ofSeconds(10));`);
  lines.push(`  }`);
  lines.push('');
  lines.push(`  @Test`);
  lines.push(`  public void test${title.replace(/\s+/g, '')}() {`);
  lines.push(`    driver.get("${baseUrl}");`);
  lines.push('');
  
  // Use common step handler function
  for(const s of state.steps){
    const stepCode = window.StepHandlers.generateSeleniumStepCode(s);
    if (stepCode) {
      lines.push(stepCode);
    }
  }
  
  lines.push('  }');
  lines.push('');
  lines.push(`  @AfterAll`);
  lines.push(`  public static void tearDown() {`);
  lines.push(`    if (driver != null) driver.quit();`);
  lines.push(`  }`);
  lines.push('}');
  return lines.join('\n');
}

// Use common assertion method from StepHandlers
function getAssertionMethod(type) {
  return window.StepHandlers ? window.StepHandlers.getAssertionMethod(type) : 'toBe';
}

function generateFeature(){
  const title = document.getElementById('featureTitle').value || 'Recorded Flow';
  const name = document.getElementById('featureName').value || 'Recorded Feature';
  
  // Only use tags from UI input field (entered before recording)
  // Tags typed during recording are treated as normal text, not extracted as Cucumber tags
  const tags = (document.getElementById('tags').value || '').trim().split(/\s+/).filter(t => t.startsWith('@'));
  
  // Use BDD options for advanced features
  const useScenarioOutline = state.bddOptions.useScenarioOutline && state.bddOptions.examples.length > 0;
  const backgroundSteps = state.backgroundSteps || [];
  const scenarios = state.scenarios.length > 0 ? state.scenarios : null;
  const examples = state.bddOptions.examples || [];
  
  // Get example keys to use as placeholders
  const exampleKeys = examples.length > 0 ? Object.keys(examples[0]) : [];
  
  const lines = [];
  if (tags.length > 0) lines.push(tags.join(' '));
  lines.push(`Feature: ${name}`);
  lines.push('');
  
  // Add Background if exists
  if (backgroundSteps.length > 0) {
    lines.push('  Background:');
    for(const s of backgroundSteps){
      // Use common Gherkin step generator (never use placeholders in background)
      if (window.StepHandlers && window.StepHandlers.generateGherkinStepLine) {
        const stepLine = window.StepHandlers.generateGherkinStepLine(s, false);
        if (stepLine && !stepLine.startsWith('    #')) {
          lines.push(stepLine);
        }
      }
    }
    lines.push('');
  }
  
  // Add Scenario or Scenario Outline
  if (useScenarioOutline) {
    lines.push(`  Scenario Outline: ${title}`);
  } else {
    if (tags.length > 0) lines.push(`  ${tags.join(' ')}`);
    lines.push(`  Scenario: ${title}`);
  }
  
  // Helper function to replace step values with placeholders based on example keys
  const replaceWithPlaceholders = (step, stepText) => {
    if (!useScenarioOutline || exampleKeys.length === 0) return stepText;
    
    let result = stepText;
    const parameterizedFields = getParameterizedStepFields(step, exampleKeys);
    
    // Replace each parameterized field with its placeholder
    parameterizedFields.forEach(({ field, placeholder }) => {
      if (step[field] !== undefined && step[field] !== null) {
        const value = String(step[field]);
        // Escape special regex characters
        const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Replace the value with placeholder (handle both quoted and unquoted)
        result = result.replace(new RegExp(`"${escapedValue}"`, 'g'), `"${placeholder}"`);
        result = result.replace(new RegExp(`\\b${escapedValue}\\b`, 'g'), placeholder);
      }
    });
    
    return result;
  };
  
  // Use common Gherkin step generator
  for(const s of state.steps){
    if (window.StepHandlers && window.StepHandlers.generateGherkinStepLine) {
      // Pass usePlaceholders flag when Scenario Outline is enabled
      let stepLine = window.StepHandlers.generateGherkinStepLine(s, useScenarioOutline);
      
      // Apply additional placeholder replacement based on example keys
      if (useScenarioOutline && stepLine) {
        stepLine = replaceWithPlaceholders(s, stepLine);
      }
      
      if (stepLine && !stepLine.startsWith('    #')) {
        lines.push(stepLine);
      }
    } else {
      // Fallback for additional step types
      switch(s.kind) {
        case 'apiCall':
          lines.push(`    And I call API ${s.method||'GET'} "${s.url}"`);
          break;
        default:
          // Skip unknown steps
          break;
      }
    }
  }
  
  // Add Examples table if Scenario Outline is enabled
  if (useScenarioOutline && examples.length > 0) {
    lines.push('');
    lines.push('    Examples:');
    // Get column headers from first example
    const headers = Object.keys(examples[0]);
    lines.push(`      | ${headers.join(' | ')} |`);
    examples.forEach(example => {
      const values = headers.map(h => example[h] || '');
      lines.push(`      | ${values.join(' | ')} |`);
    });
  }
  
  return lines.join('\n');
}

// [ZAC-FIX 2026-05-24] Framework-aware step-def preview dispatcher.
// The previous hard-coded implementation always returned the Playwright
// TypeScript template, even when the framework dropdown said
// "Selenium WebDriver + Java + Cucumber". Now each framework gets a
// minimal but framework-correct step-def preview. The full project-
// grade output still happens server-side in /generate-files.
function generateStepDefs() {
  // Prefer the dropdown value, but fall back to the loaded project's
  // framework when the dropdown is empty (some frameworks like
  // playwright-typescript are uiVisible:false in /api/frameworks but
  // are still valid project frameworks — without this fallback those
  // projects show a default-branch step-def even though the project
  // tells us exactly which variant to render).
  const fwRaw = document.getElementById('framework')?.value;
  const fw = fwRaw || state.currentProjectFramework || 'playwright-java';
  switch (fw) {
    case 'selenium-java':
      return _generateSeleniumJavaStepDefs();
    case 'selenium-testng':
      return _generateSeleniumTestNgStepDefs();
    case 'playwright-java':
      return _generatePlaywrightJavaStepDefs();
    case 'playwright-javascript':
      return _generateCucumberJsStepDefs(false);
    case 'playwright-typescript':
      return _generateCucumberJsStepDefs(true);
    default:
      return _generateCucumberJsStepDefs(true);
  }
}

function _generateSeleniumJavaStepDefs() {
  return `package steps;

import io.cucumber.java.en.Given;
import io.cucumber.java.en.When;
import io.cucumber.java.en.Then;
import io.cucumber.java.en.And;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;
import java.time.Duration;
import static org.junit.jupiter.api.Assertions.*;

public class StepDefinitions {
    private final WebDriver driver = SeleniumWorld.getDriver();
    private final WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(10));

    @Given("I navigate to {string}")
    public void iNavigateTo(String url) { driver.get(url); }

    @When("I click {string}")
    public void iClick(String selector) {
        wait.until(ExpectedConditions.elementToBeClickable(By.cssSelector(selector))).click();
    }

    @When("I type {string} into {string}")
    public void iTypeInto(String value, String selector) {
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.cssSelector(selector))).sendKeys(value);
    }

    @Then("I should see {string} in {string}")
    public void iShouldSeeIn(String text, String selector) {
        String actual = driver.findElement(By.cssSelector(selector)).getText();
        assertTrue(actual.contains(text), "Expected '" + text + "' in '" + actual + "'");
    }

    @Then("{string} should be visible")
    public void shouldBeVisible(String selector) {
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.cssSelector(selector)));
    }

    @And("I wait for {int} ms")
    public void iWaitForMs(Integer ms) throws InterruptedException { Thread.sleep(ms); }
}
`;
}

function _generateSeleniumTestNgStepDefs() {
  // TestNG doesn't use Cucumber by default; its "test runner" is the @Test
  // method itself. Show a TestNG class that maps recorded steps to
  // discrete @Test methods (matches generators/selenium-testng.js output).
  return `package tests;

import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;
import org.testng.Assert;
import org.testng.annotations.AfterMethod;
import org.testng.annotations.BeforeMethod;
import org.testng.annotations.Test;
import io.github.bonigarcia.wdm.WebDriverManager;
import org.openqa.selenium.chrome.ChromeDriver;
import java.time.Duration;

public class RecordedTest {
    private WebDriver driver;
    private WebDriverWait wait;

    @BeforeMethod
    public void setUp() {
        WebDriverManager.chromedriver().setup();
        driver = new ChromeDriver();
        wait = new WebDriverWait(driver, Duration.ofSeconds(10));
    }

    @Test(description = "Recorded flow")
    public void testRecordedFlow() {
        driver.get("https://example.com");
        wait.until(ExpectedConditions.elementToBeClickable(By.cssSelector("#submit"))).click();
        // type / assertions follow the same pattern
    }

    @AfterMethod
    public void tearDown() { if (driver != null) driver.quit(); }
}
`;
}

function _generatePlaywrightJavaStepDefs() {
  return `package steps;

import io.cucumber.java.en.Given;
import io.cucumber.java.en.When;
import io.cucumber.java.en.Then;
import io.cucumber.java.en.And;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.assertions.PlaywrightAssertions;

public class StepDefinitions {
    private final Page page = PlaywrightWorld.getPage();

    @Given("I navigate to {string}")
    public void iNavigateTo(String url) { page.navigate(url); }

    @When("I click {string}")
    public void iClick(String selector) { page.click(selector); }

    @When("I type {string} into {string}")
    public void iTypeInto(String value, String selector) { page.fill(selector, value); }

    @Then("I should see {string} in {string}")
    public void iShouldSeeIn(String text, String selector) {
        PlaywrightAssertions.assertThat(page.locator(selector)).containsText(text);
    }

    @Then("{string} should be visible")
    public void shouldBeVisible(String selector) {
        PlaywrightAssertions.assertThat(page.locator(selector)).isVisible();
    }

    @And("I wait for {int} ms")
    public void iWaitForMs(Integer ms) { page.waitForTimeout(ms); }
}
`;
}

function _generateCucumberJsStepDefs(isTs) {
  // The full TypeScript template (kept as-is for backwards compat with
  // anyone copy-pasting from this panel). The JS variant strips types.
  const ts = `import { Given, When, Then, And } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { PlaywrightWorld } from '../support/world';

// Navigation
Given('I navigate to {string}', async function(this: PlaywrightWorld, url: string) {
  await this.page.goto(url);
});

// Clicks
When('I click {string}', async function(this: PlaywrightWorld, selector: string) {
  await this.page.click(selector);
});

And('I click {string}', async function(this: PlaywrightWorld, selector: string) {
  await this.page.click(selector);
});

// Typing
When('I type {string} into {string}', async function(this: PlaywrightWorld, val: string, selector: string) {
  await this.page.fill(selector, val);
});

And('I type {string} into {string}', async function(this: PlaywrightWorld, val: string, selector: string) {
  await this.page.fill(selector, val);
});

// Select/Dropdown
When('I select {string} from {string}', async function(this: PlaywrightWorld, value: string, selector: string) {
  await this.page.selectOption(selector, value);
});

And('I select {string} from {string}', async function(this: PlaywrightWorld, value: string, selector: string) {
  await this.page.selectOption(selector, value);
});

// Assertions - Text
Then('I should see {string} in {string}', async function(this: PlaywrightWorld, text: string, selector: string) {
  await expect(this.page.locator(selector)).toContainText(text);
});

// Assertions - Visible
Then('{string} should be visible', async function(this: PlaywrightWorld, selector: string) {
  await expect(this.page.locator(selector)).toBeVisible();
});

// Assertions - Attribute
Then('{string} attribute {string} should equal {string}', async function(this: PlaywrightWorld, selector: string, attr: string, value: string) {
  await expect(this.page.locator(selector)).toHaveAttribute(attr, value);
});

Then('{string} attribute {string} should contain {string}', async function(this: PlaywrightWorld, selector: string, attr: string, value: string) {
  const attrValue = await this.page.locator(selector).getAttribute(attr);
  expect(attrValue).toContain(value);
});

// Assertions - Count
Then('{string} count should be {int}', async function(this: PlaywrightWorld, selector: string, count: number) {
  await expect(this.page.locator(selector)).toHaveCount(count);
});

// Assertions - Value
Then('{string} value should equal {string}', async function(this: PlaywrightWorld, selector: string, value: string) {
  await expect(this.page.locator(selector)).toHaveValue(value);
});

// Wait
And('I wait for {int} ms', async function(this: PlaywrightWorld, ms: number) {
  await this.page.waitForTimeout(ms);
});

When('I wait for {int} ms', async function(this: PlaywrightWorld, ms: number) {
  await this.page.waitForTimeout(ms);
});

And('I wait for selector {string}', async function(this: PlaywrightWorld, selector: string) {
  await this.page.waitForSelector(selector);
});

// Close Browser
And('I close the browser', async function(this: PlaywrightWorld) {
  // Check if a new tab/page is opening before closing
  // This prevents closing when the application opens in a new tab
  // But allows closing when navigation happens in the same tab (normal link click)
  if (this.page && this.context && !this.page.isClosed()) {
    // Get page count before waiting
    const pagesBefore = this.context.pages();
    const currentPageCount = pagesBefore.length;
    
    // Wait a short time to see if a new page is about to open
    // Some clicks trigger new tabs asynchronously
    await this.page.waitForTimeout(500);
    
    // Check page count after waiting
    const pagesAfter = this.context.pages();
    const newPageCount = pagesAfter.length;
    
    // ONLY skip closing if a new page/tab actually opened
    // If page count increased, it means a new tab was created
    // If page count stayed the same, it's normal navigation in the same tab - allow closing
    if (newPageCount > currentPageCount) {
      console.log('[Close] New tab detected (' + currentPageCount + ' -> ' + newPageCount + '), skipping close to preserve new tab');
      return; // Skip closing
    }
    
    // If we reach here, no new tab was created
    // This means either normal navigation happened in the same tab or no navigation
    // In both cases, it's safe to close the current page
    console.log('[Close] No new tab detected (page count: ' + currentPageCount + '), proceeding with close');
    await this.page.close();
  }
  
  // Close context and browser if no pages remain
  if (this.context && this.context.pages().length === 0) {
    await this.context.close();
  }
  if (this.browser) {
    await this.browser.close();
  }
});

// Screenshot
And('I take screenshot {string}', async function(this: PlaywrightWorld, filename: string) {
  await this.page.screenshot({ path: filename });
});

// API Calls
When('I call API GET {string}', async function(this: PlaywrightWorld, url: string) {
  const resp = await this.page.request.get(url);
  this.lastResponse = resp;
});

When('I call API POST {string}', async function(this: PlaywrightWorld, url: string) {
  const resp = await this.page.request.post(url);
  this.lastResponse = resp;
});

And('I call API GET {string}', async function(this: PlaywrightWorld, url: string) {
  const resp = await this.page.request.get(url);
  this.lastResponse = resp;
});

And('I call API POST {string}', async function(this: PlaywrightWorld, url: string) {
  const resp = await this.page.request.post(url);
  this.lastResponse = resp;
});`;
  if (isTs) return ts;
  // Strip TypeScript artifacts for the JS variant: `(this: PlaywrightWorld, x: type)`
  // → `(x)`. We avoid full TS parsing — these are well-known shapes from the
  // template above.
  return ts
    .replace(/import \{ expect \} from '@playwright\/test';\s*\n/g, "const { expect } = require('expect');\n")
    .replace(/import \{ Given, When, Then, And \} from '@cucumber\/cucumber';/, "const { Given, When, Then, And } = require('@cucumber/cucumber');")
    .replace(/import \{ PlaywrightWorld \} from '\.\.\/support\/world';\s*\n/g, "")
    .replace(/this: PlaywrightWorld(?:,\s*)?/g, '')
    .replace(/:\s*string/g, '')
    .replace(/:\s*number/g, '')
    .replace(/:\s*PlaywrightWorld/g, '');
}

function renderCode(){
  // During recording, optimize by caching code generation and only updating when needed
  const isRecording = state.recording.active;

  // [ZAC-FIX 2026-05-24] Detect framework switch — when the framework
  // dropdown changes (or a project with a different framework loads)
  // we MUST overwrite the code panels with newly-generated framework-
  // specific code, even if the user had edits. Without this the user
  // picks "Selenium WebDriver + Java + Cucumber" and sees stale
  // Playwright Java code.
  //
  // Two trigger paths:
  //   (a) framework value differs from what we last rendered, OR
  //   (b) state.forceCodeRefresh is set (project-load sets this so
  //       a project switch always refreshes, even when both projects
  //       happen to use the same framework — their step text differs).
  const currentFramework = document.getElementById('framework')?.value || 'playwright-java';
  const frameworkChanged =
    !!state.forceCodeRefresh ||
    (state.lastRenderedFramework && state.lastRenderedFramework !== currentFramework);
  state.lastRenderedFramework = currentFramework;
  if (state.forceCodeRefresh) state.forceCodeRefresh = false;   // consume the flag

  // Generate code (with caching during recording)
  let seleniumCode, featureCode, stepsCode;
  
  if (isRecording) {
    // During recording: cache code generation to reduce CPU usage
    const cacheKey = state.steps.length; // Use step count as cache key
    if (state.recording.codeCache[cacheKey]) {
      seleniumCode = state.recording.codeCache[cacheKey].selenium;
      stepsCode = state.recording.codeCache[cacheKey].steps;
    } else {
      // Generate all code but cache it
      seleniumCode = generateSelenium();
      stepsCode = generateStepDefs();
      state.recording.codeCache[cacheKey] = { selenium: seleniumCode, steps: stepsCode };
      // Limit cache size to prevent memory issues
      if (Object.keys(state.recording.codeCache).length > 10) {
        const keys = Object.keys(state.recording.codeCache).sort((a, b) => Number(a) - Number(b));
        delete state.recording.codeCache[keys[0]]; // Remove oldest entry
      }
    }
    // Always generate feature file fresh (it's lightweight)
    featureCode = generateFeature();
  } else {
    // Not recording: generate all code normally
    seleniumCode = generateSelenium();
    featureCode = generateFeature();
    stepsCode = generateStepDefs();
    // Clear cache when not recording
    state.recording.codeCache = {};
  }
  
  // Update code blocks
  const seleniumEl = document.getElementById('code-selenium');
  const featEl = document.getElementById('code-feature');
  const stepsEl = document.getElementById('code-steps');
  
  // Update Selenium code - editable textarea
  if (seleniumEl) {
    if (isRecording) {
      // During recording: only update if content changed
      if (seleniumEl.value !== seleniumCode) {
        seleniumEl.value = seleniumCode;
      }
    } else {
      // When not recording: only update if empty (preserve user edits)
      // [ZAC-FIX 2026-05-24] OR if the framework just changed —
      // user explicitly switched, the previous content is now wrong.
      if (!seleniumEl.value || seleniumEl.value.trim() === '' || frameworkChanged) {
        seleniumEl.value = seleniumCode;
      }
    }
    // Add visual indicator when recording is active
    if (isRecording) {
      seleniumEl.style.border = '2px solid var(--accent)';
    } else {
      seleniumEl.style.border = '';
    }
    // Show save button if code has content
    const saveSeleniumBtn = document.getElementById('saveSeleniumBtn');
    if (saveSeleniumBtn && seleniumEl.value && seleniumEl.value.trim() !== '') {
      saveSeleniumBtn.style.display = 'inline-block';
    }
  }
  
  // Always update feature file - show live updates during recording
  if (featEl) {
    // Build step mapping for navigation
    state.stepMapping.gherkinToStep.clear();
    state.stepMapping.stepToGherkin.clear();
    state.stepMapping.gherkinToStepDef.clear();
    
    const featureLines = featureCode.split('\n');
    let stepIndex = 0;
    let gherkinLineIndex = 0;
    
    featureLines.forEach((line, idx) => {
      const trimmed = line.trim();
      // Check if this is a step line (starts with Given/When/Then/And)
      if (/^(Given|When|Then|And)\s+/i.test(trimmed)) {
        if (stepIndex < state.steps.length) {
          // Map Gherkin line to step index
          state.stepMapping.gherkinToStep.set(idx, stepIndex);
          state.stepMapping.stepToGherkin.set(stepIndex, idx);
          
          // Find corresponding step definition
          const stepDefLine = findStepDefLine(line);
          if (stepDefLine) {
            state.stepMapping.gherkinToStepDef.set(idx, stepDefLine);
          }
          
          stepIndex++;
        }
      }
    });
    
    if (isRecording) {
      // During recording: only update if content changed
      if (featEl.value !== featureCode) {
        featEl.value = featureCode;
        addGherkinClickHandlers(featEl);
      }
    } else {
      // When not recording: update if empty OR if examples were just updated OR if steps changed after recording (force update)
      if (!featEl.value || featEl.value.trim() === '' || state.examplesJustUpdated || state.stepsChangedAfterRecording) {
        featEl.value = featureCode;
        addGherkinClickHandlers(featEl);
        // Reset flag after updating
        if (state.stepsChangedAfterRecording) {
          state.stepsChangedAfterRecording = false;
        }
      } else if (featEl.value !== featureCode) {
        // Content changed, update mapping
        addGherkinClickHandlers(featEl);
      }
    }
    // Show save button if feature file has content
    const saveFeatureBtn = document.getElementById('saveFeatureBtn');
    if (saveFeatureBtn && featEl.value && featEl.value.trim() !== '') {
      saveFeatureBtn.style.display = 'inline-block';
    }
  }
  
  // Update step definitions - only update if changed during recording
  if (stepsEl) {
    if (isRecording) {
      // During recording: only update if content changed
      if (stepsEl.value !== stepsCode) {
        stepsEl.value = stepsCode;
        addStepDefClickHandlers(stepsEl);
      }
    } else {
      // When not recording: update if empty OR if steps changed after recording (force update)
      // Preserve user edits only if steps haven't changed.
      // [ZAC-FIX 2026-05-24] Also force-update on framework switch —
      // each framework emits totally different step-def syntax
      // (Java + Cucumber vs JS + Cucumber vs TestNG vs …) and the
      // old content is wrong for the new framework.
      if (!state.currentProjectName || stepsEl.value === '' || stepsEl.value === stepsCode || state.stepsChangedAfterRecording || frameworkChanged) {
        stepsEl.value = stepsCode;
        addStepDefClickHandlers(stepsEl);
        // Reset flag after updating (already reset in Gherkin section, but ensure it's reset here too)
        if (state.stepsChangedAfterRecording) {
          state.stepsChangedAfterRecording = false;
        }
      } else if (stepsEl.value !== stepsCode) {
        // Content changed, update handlers
        addStepDefClickHandlers(stepsEl);
      }
    }
  }
  
  // Update step definition map for navigation (only when not recording or when steps change)
  if (!isRecording || !state.recording.codeCache[state.steps.length]) {
    updateStepDefinitionMap(stepsEl ? (stepsEl.value || stepsCode) : stepsCode);
  }
  
  // Sync overlay content when recording is active
  if (isRecording) {
    const overlayFeatEl = document.getElementById('code-feature-overlay');
    const overlayStepsEl = document.getElementById('code-steps-overlay');
    const overlayStatusEl = document.getElementById('recordingOverlayStatus');
    const liveBadgeOverlay = document.getElementById('live-feature-badge-overlay');
    
    // Update overlay feature file
    if (overlayFeatEl && overlayFeatEl.value !== featureCode) {
      overlayFeatEl.value = featureCode;
    }
    
    // Update overlay step definitions
    if (overlayStepsEl && overlayStepsEl.value !== stepsCode) {
      overlayStepsEl.value = stepsCode;
    }
    
    // Update overlay status
    if (overlayStatusEl) {
      overlayStatusEl.innerHTML = `
        <span style="display: inline-block; width: 8px; height: 8px; background: #10b981; border-radius: 50%; margin-right: 8px; animation: pulse 1s ease-in-out infinite;"></span>
        Recording... ${state.steps.length} step(s) captured
      `;
    }
    
    // Show live badge in overlay
    if (liveBadgeOverlay) {
      liveBadgeOverlay.style.display = 'inline-block';
    }
  }
}

// Update step definition map for click-to-navigate
function updateStepDefinitionMap(stepDefContent) {
  state.stepDefinitionMap.clear();
  state.stepMapping.stepDefToGherkin.clear();
  const lines = stepDefContent.split('\n');
  
  lines.forEach((line, index) => {
    const stepMatch = line.match(/(Given|When|Then|And)\s*\(['"]([^'"]+)['"]/);
    if (stepMatch) {
      const keyword = stepMatch[1];
      const pattern = stepMatch[2];
      state.stepDefinitionMap.set(pattern, { keyword, pattern, lineNumber: index + 1 });
      // Store step definition line for navigation
      state.stepMapping.stepDefToGherkin.set(index + 1, pattern);
    }
  });
}

// Extract step pattern from Gherkin line
function extractStepPattern(gherkinLine) {
  // Remove leading whitespace and keyword (Given/When/Then/And)
  const trimmed = gherkinLine.trim();
  const match = trimmed.match(/^(Given|When|Then|And)\s+(.+)$/i);
  if (match) {
    // Extract the pattern part (everything after keyword)
    let pattern = match[2];
    // Replace quoted strings with {string} or {int} placeholders
    pattern = pattern.replace(/"([^"]+)"/g, '{string}');
    pattern = pattern.replace(/\b(\d+)\b/g, '{int}');
    return pattern.trim();
  }
  return null;
}

// Find step definition line for a Gherkin step
function findStepDefLine(gherkinLine) {
  const pattern = extractStepPattern(gherkinLine);
  if (!pattern) return null;
  
  // Try exact match first
  for (const [lineNum, storedPattern] of state.stepMapping.stepDefToGherkin.entries()) {
    if (storedPattern === pattern) {
      return lineNum;
    }
  }
  
  // Try fuzzy match (handle variations)
  for (const [lineNum, storedPattern] of state.stepMapping.stepDefToGherkin.entries()) {
    // Normalize patterns for comparison
    const normalizedPattern = pattern.toLowerCase().replace(/\s+/g, ' ');
    const normalizedStored = storedPattern.toLowerCase().replace(/\s+/g, ' ');
    if (normalizedPattern === normalizedStored || normalizedStored.includes(normalizedPattern)) {
      return lineNum;
    }
  }
  
  return null;
}

// Highlight a line in a textarea
function highlightLine(textarea, lineNumber, highlightClass = 'highlighted-line') {
  if (!textarea) return;
  
  // Scroll to line
  const lines = textarea.value.split('\n');
  if (lineNumber < 1 || lineNumber > lines.length) return;
  
  // Calculate position
  let position = 0;
  for (let i = 0; i < lineNumber - 1; i++) {
    position += lines[i].length + 1; // +1 for newline
  }
  
  // Only focus and set selection if textarea is not already focused (to avoid interrupting editing)
  const wasFocused = document.activeElement === textarea;
  if (!wasFocused) {
    textarea.focus();
    textarea.setSelectionRange(position, position);
  }
  
  // Calculate scroll position
  const lineHeight = 20; // Approximate line height
  const visibleLines = Math.floor(textarea.clientHeight / lineHeight);
  const targetLine = lineNumber - 1;
  textarea.scrollTop = (targetLine - Math.floor(visibleLines / 2)) * lineHeight;
  
  // Add visual highlight via CSS (less intrusive - no blur/white screen)
  const originalBoxShadow = textarea.style.boxShadow;
  const originalBackgroundColor = textarea.style.backgroundColor;
  const originalBorder = textarea.style.border;
  
  // Use a subtle border highlight instead of boxShadow to avoid blur/white screen issues
  textarea.style.border = '2px solid rgba(88, 166, 255, 0.6)';
  textarea.style.backgroundColor = 'rgba(88, 166, 255, 0.03)';
  
  // Clear highlight after a shorter duration and restore original styles
  setTimeout(() => {
    textarea.style.boxShadow = originalBoxShadow;
    textarea.style.backgroundColor = originalBackgroundColor;
    textarea.style.border = originalBorder;
  }, 1500);
}

// Add click handlers to Gherkin feature file
function addGherkinClickHandlers(textarea) {
  if (!textarea) return;
  
  // Remove existing handlers
  textarea.removeEventListener('dblclick', handleGherkinDoubleClick);
  textarea.removeEventListener('click', handleGherkinClick);
  
  // Add double-click handler for navigation (allows editing on single click)
  textarea.addEventListener('dblclick', handleGherkinDoubleClick);
  
  // Add Ctrl+Click handler for navigation (allows editing on normal click)
  textarea.addEventListener('click', handleGherkinClick);
  
  // Add cursor text style for editing
  textarea.style.cursor = 'text';
}

// Handle double-click on Gherkin feature file (for navigation)
function handleGherkinDoubleClick(e) {
  const textarea = e.target;
  if (textarea.tagName !== 'TEXTAREA') return;
  
  // Prevent default text selection behavior
  e.preventDefault();
  
  // Use a small delay to get accurate cursor position after click
  setTimeout(() => {
    const clickPos = textarea.selectionStart;
    const text = textarea.value;
    const lines = text.split('\n');
    
    // Find which line was clicked
    let charCount = 0;
    let lineNumber = 0;
    for (let i = 0; i < lines.length; i++) {
      if (charCount + lines[i].length >= clickPos) {
        lineNumber = i;
        break;
      }
      charCount += lines[i].length + 1; // +1 for newline
    }
    
    const clickedLine = lines[lineNumber];
    if (!clickedLine || !/^(Given|When|Then|And)\s+/i.test(clickedLine.trim())) {
      return; // Not a step line
    }
    
    // Find corresponding step index
    const stepIndex = state.stepMapping.gherkinToStep.get(lineNumber);
    if (stepIndex !== undefined) {
      // Navigate to recorded step
      navigateToStep(stepIndex);
      
      // Navigate to step definition
      const stepDefLine = state.stepMapping.gherkinToStepDef.get(lineNumber);
      if (stepDefLine) {
        navigateToStepDef(stepDefLine);
      }
    }
  }, 10);
}

// Handle Ctrl+Click on Gherkin feature file (for navigation while allowing normal editing)
function handleGherkinClick(e) {
  // Only navigate on Ctrl+Click (or Cmd+Click on Mac)
  if (!e.ctrlKey && !e.metaKey) {
    return; // Allow normal editing on single click
  }
  
  const textarea = e.target;
  if (textarea.tagName !== 'TEXTAREA') return;
  
  // Prevent default text selection behavior
  e.preventDefault();
  
  // Use a small delay to get accurate cursor position after click
  setTimeout(() => {
    const clickPos = textarea.selectionStart;
    const text = textarea.value;
    const lines = text.split('\n');
    
    // Find which line was clicked
    let charCount = 0;
    let lineNumber = 0;
    for (let i = 0; i < lines.length; i++) {
      if (charCount + lines[i].length >= clickPos) {
        lineNumber = i;
        break;
      }
      charCount += lines[i].length + 1; // +1 for newline
    }
    
    const clickedLine = lines[lineNumber];
    if (!clickedLine || !/^(Given|When|Then|And)\s+/i.test(clickedLine.trim())) {
      return; // Not a step line
    }
    
    // Find corresponding step index
    const stepIndex = state.stepMapping.gherkinToStep.get(lineNumber);
    if (stepIndex !== undefined) {
      // Navigate to recorded step
      navigateToStep(stepIndex);
      
      // Navigate to step definition
      const stepDefLine = state.stepMapping.gherkinToStepDef.get(lineNumber);
      if (stepDefLine) {
        navigateToStepDef(stepDefLine);
      }
    }
  }, 10);
}

// Add click handlers to step definitions
function addStepDefClickHandlers(textarea) {
  if (!textarea) return;
  
  // Remove existing handlers
  textarea.removeEventListener('dblclick', handleStepDefDoubleClick);
  textarea.removeEventListener('click', handleStepDefClick);
  
  // Add double-click handler for navigation (allows editing on single click)
  textarea.addEventListener('dblclick', handleStepDefDoubleClick);
  
  // Add Ctrl+Click handler for navigation (allows editing on normal click)
  textarea.addEventListener('click', handleStepDefClick);
  
  // Add cursor text style for editing
  textarea.style.cursor = 'text';
}

// Handle double-click on step definitions (for navigation)
function handleStepDefDoubleClick(e) {
  const textarea = e.target;
  if (textarea.tagName !== 'TEXTAREA') return;
  
  // Prevent default text selection behavior
  e.preventDefault();
  
  // Use a small delay to get accurate cursor position after click
  setTimeout(() => {
    const clickPos = textarea.selectionStart;
    const text = textarea.value;
    const lines = text.split('\n');
    
    // Find which line was clicked
    let charCount = 0;
    let lineNumber = 0;
    for (let i = 0; i < lines.length; i++) {
      if (charCount + lines[i].length >= clickPos) {
        lineNumber = i + 1; // 1-based line number
        break;
      }
      charCount += lines[i].length + 1;
    }
    
    // Check if this line has a step definition
    const pattern = state.stepMapping.stepDefToGherkin.get(lineNumber);
    if (pattern) {
      // Find corresponding Gherkin lines
      for (const [gherkinLine, stepDefLine] of state.stepMapping.gherkinToStepDef.entries()) {
        if (stepDefLine === lineNumber) {
          navigateToGherkin(gherkinLine);
          const stepIndex = state.stepMapping.gherkinToStep.get(gherkinLine);
          if (stepIndex !== undefined) {
            navigateToStep(stepIndex);
          }
          break;
        }
      }
    }
  }, 10);
}

// Handle Ctrl+Click on step definitions (for navigation while allowing normal editing)
function handleStepDefClick(e) {
  // Only navigate on Ctrl+Click (or Cmd+Click on Mac)
  if (!e.ctrlKey && !e.metaKey) {
    return; // Allow normal editing on single click
  }
  
  const textarea = e.target;
  if (textarea.tagName !== 'TEXTAREA') return;
  
  // Prevent default text selection behavior
  e.preventDefault();
  
  // Use a small delay to get accurate cursor position after click
  setTimeout(() => {
    const clickPos = textarea.selectionStart;
    const text = textarea.value;
    const lines = text.split('\n');
    
    // Find which line was clicked
    let charCount = 0;
    let lineNumber = 0;
    for (let i = 0; i < lines.length; i++) {
      if (charCount + lines[i].length >= clickPos) {
        lineNumber = i + 1; // 1-based line number
        break;
      }
      charCount += lines[i].length + 1;
    }
    
    // Check if this line has a step definition
    const pattern = state.stepMapping.stepDefToGherkin.get(lineNumber);
    if (pattern) {
      // Find corresponding Gherkin lines
      for (const [gherkinLine, stepDefLine] of state.stepMapping.gherkinToStepDef.entries()) {
        if (stepDefLine === lineNumber) {
          navigateToGherkin(gherkinLine);
          const stepIndex = state.stepMapping.gherkinToStep.get(gherkinLine);
          if (stepIndex !== undefined) {
            navigateToStep(stepIndex);
          }
          break;
        }
      }
    }
  }, 10);
}

// Navigate to a specific step in the recorded steps list
function navigateToStep(stepIndex) {
  const stepsList = document.getElementById('stepsList');
  if (!stepsList) return;
  
  const stepItems = stepsList.querySelectorAll('.step-item');
  if (stepIndex >= 0 && stepIndex < stepItems.length) {
    const stepItem = stepItems[stepIndex];
    
    // Remove previous highlight
    stepItems.forEach(item => {
      item.style.border = '';
      item.style.boxShadow = '';
    });
    
    // Highlight this step
    stepItem.style.border = '2px solid rgba(88, 166, 255, 0.8)';
    stepItem.style.boxShadow = '0 0 20px rgba(88, 166, 255, 0.4)';
    stepItem.style.backgroundColor = 'rgba(88, 166, 255, 0.1)';
    
    // Scroll into view
    stepItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Remove highlight after 2 seconds
    setTimeout(() => {
      stepItem.style.border = '';
      stepItem.style.boxShadow = '';
      stepItem.style.backgroundColor = '';
    }, 2000);
    
    state.stepMapping.highlightedStep = stepIndex;
  }
}

// Navigate to a specific line in Gherkin
function navigateToGherkin(lineIndex) {
  const featEl = document.getElementById('code-feature');
  if (!featEl) return;
  
  // Only highlight if the textarea is not currently being edited
  // This prevents interrupting the user's editing session
  const isCurrentlyEditing = document.activeElement === featEl;
  if (!isCurrentlyEditing) {
    highlightLine(featEl, lineIndex + 1); // Convert to 1-based
  }
  state.stepMapping.highlightedGherkinLine = lineIndex;
}

// Navigate to a specific line in step definitions
function navigateToStepDef(lineNumber) {
  const stepsEl = document.getElementById('code-steps');
  if (!stepsEl) return;
  
  // Only highlight if the textarea is not currently being edited
  // This prevents interrupting the user's editing session
  const isCurrentlyEditing = document.activeElement === stepsEl;
  if (!isCurrentlyEditing) {
    highlightLine(stepsEl, lineNumber);
  }
  state.stepMapping.highlightedStepDefLine = lineNumber;
}

// Load step definitions from file (optional - file may not exist until project is exported)
async function loadStepDefinitionsFile(projectName) {
  if (!projectName) {
    return; // No project name, skip file loading
  }
  
  try {
    const resp = await fetch(`/api/files/steps/${encodeURIComponent(projectName)}`);
    if (!resp.ok) {
      if (resp.status === 404) {
        // File doesn't exist yet - this is normal, step definitions are generated in-memory
        // The generated code is already displayed via renderCode()
        return;
      }
      // Only log non-404 errors
      console.warn('Failed to load step definitions file:', resp.status);
      return;
    }
    
    const data = await resp.json();
    const stepsEl = document.getElementById('code-steps');
    if (stepsEl && data.content) {
      stepsEl.value = data.content;
      // Update step definition map
      updateStepDefinitionMap(data.content);
      // Show save/load buttons
      const saveBtn = document.getElementById('saveStepsBtn');
      const loadBtn = document.getElementById('loadStepsBtn');
      if (saveBtn) saveBtn.style.display = 'inline-block';
      if (loadBtn) loadBtn.style.display = 'inline-block';
    }
    
    // Also try to load feature file
    await loadFeatureFile(projectName);
  } catch (error) {
    // Silently handle network errors - step definitions are already generated in-memory
    // Only log unexpected errors
    if (error.name !== 'TypeError' && !error.message.includes('fetch')) {
      console.warn('Error loading step definitions file:', error.message);
    }
  }
}

// Save step definitions to file
async function saveStepDefinitionsFile() {
  if (!state.currentProjectName) {
    alert('No project loaded. Please record first.');
    return;
  }
  
  const stepsEl = document.getElementById('code-steps');
  if (!stepsEl) return;
  
  const content = stepsEl.value;
  const statusEl = document.getElementById('stepsSaveStatus');
  
  statusEl.textContent = 'Saving...';
  statusEl.style.color = 'var(--accent)';
  
  try {
    const resp = await fetch(`/api/files/steps/${encodeURIComponent(state.currentProjectName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    
    if (!resp.ok) {
      const error = await resp.json();
      throw new Error(error.error || 'Failed to save');
    }
    
    const data = await resp.json();
    statusEl.textContent = '✅ Saved successfully!';
    statusEl.style.color = '#10b981';
    
    // Clear status after 3 seconds
    setTimeout(() => {
      statusEl.textContent = '';
    }, 3000);
  } catch (error) {
    console.error('Error saving step definitions:', error);
    statusEl.textContent = `❌ Error: ${error.message}`;
    statusEl.style.color = 'var(--danger)';
  }
}

// Load feature file from project
async function loadFeatureFile(projectName) {
  if (!projectName) {
    return; // No project name, skip file loading
  }
  
  try {
    const resp = await fetch(`/api/files/feature/${encodeURIComponent(projectName)}`);
    if (!resp.ok) {
      if (resp.status === 404) {
        // File doesn't exist yet - this is normal, feature file is generated in-memory
        return;
      }
      console.warn('Failed to load feature file:', resp.status);
      return;
    }
    
    const data = await resp.json();
    const featEl = document.getElementById('code-feature');
    if (featEl && data.content) {
      featEl.value = data.content;
      // Show save button
      const saveBtn = document.getElementById('saveFeatureBtn');
      if (saveBtn) saveBtn.style.display = 'inline-block';
    }
  } catch (error) {
    // Silently handle network errors - feature file is already generated in-memory
    if (error.name !== 'TypeError' && !error.message.includes('fetch')) {
      console.warn('Error loading feature file:', error);
    }
  }
}

// Save feature file to project
async function saveFeatureFile() {
  if (!state.currentProjectName) {
    alert('No project loaded. Please record first.');
    return;
  }
  
  const featEl = document.getElementById('code-feature');
  if (!featEl) return;
  
  const content = featEl.value;
  const statusEl = document.getElementById('featureSaveStatus');
  
  statusEl.textContent = 'Saving...';
  statusEl.style.color = 'var(--accent)';
  
  try {
    const resp = await fetch(`/api/files/feature/${encodeURIComponent(state.currentProjectName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    
    if (!resp.ok) {
      const error = await resp.json();
      throw new Error(error.error || 'Failed to save');
    }
    
    const data = await resp.json();
    statusEl.textContent = '✅ Saved successfully!';
    statusEl.style.color = '#10b981';
    
    // Clear status after 3 seconds
    setTimeout(() => {
      statusEl.textContent = '';
    }, 3000);
  } catch (error) {
    console.error('Error saving feature file:', error);
    statusEl.textContent = `❌ Error: ${error.message}`;
    statusEl.style.color = 'var(--danger)';
  }
}

// Save Playwright code to project
async function savePlaywrightFile() {
  if (!state.currentProjectName) {
    alert('No project loaded. Please record first.');
    return;
  }
  
  const pwEl = document.getElementById('code-playwright');
  if (!pwEl) return;
  
  const content = pwEl.value;
  const statusEl = document.getElementById('playwrightSaveStatus');
  
  statusEl.textContent = 'Saving...';
  statusEl.style.color = 'var(--accent)';
  
  try {
    const resp = await fetch(`/api/files/playwright/${encodeURIComponent(state.currentProjectName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    
    if (!resp.ok) {
      const error = await resp.json();
      throw new Error(error.error || 'Failed to save');
    }
    
    const data = await resp.json();
    statusEl.textContent = '✅ Saved successfully!';
    statusEl.style.color = '#10b981';
    
    // Clear status after 3 seconds
    setTimeout(() => {
      statusEl.textContent = '';
    }, 3000);
  } catch (error) {
    console.error('Error saving Playwright file:', error);
    statusEl.textContent = `❌ Error: ${error.message}`;
    statusEl.style.color = 'var(--danger)';
  }
}

// Save Selenium code to project
async function saveSeleniumFile() {
  if (!state.currentProjectName) {
    alert('No project loaded. Please record first.');
    return;
  }
  
  const seleniumEl = document.getElementById('code-selenium');
  if (!seleniumEl) return;
  
  const content = seleniumEl.value;
  const statusEl = document.getElementById('seleniumSaveStatus');
  
  statusEl.textContent = 'Saving...';
  statusEl.style.color = 'var(--accent)';
  
  try {
    const resp = await fetch(`/api/files/selenium/${encodeURIComponent(state.currentProjectName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    
    if (!resp.ok) {
      const error = await resp.json();
      throw new Error(error.error || 'Failed to save');
    }
    
    const data = await resp.json();
    statusEl.textContent = '✅ Saved successfully!';
    statusEl.style.color = '#10b981';
    
    // Clear status after 3 seconds
    setTimeout(() => {
      statusEl.textContent = '';
    }, 3000);
  } catch (error) {
    console.error('Error saving Selenium file:', error);
    statusEl.textContent = `❌ Error: ${error.message}`;
    statusEl.style.color = 'var(--danger)';
  }
}

function render(){ 
  renderSteps(); 
  renderCode();
  // Ensure click handlers are attached after render
  setTimeout(() => {
    const featEl = document.getElementById('code-feature');
    const stepsEl = document.getElementById('code-steps');
    if (featEl) addGherkinClickHandlers(featEl);
    if (stepsEl) addStepDefClickHandlers(stepsEl);
  }, 100);
}

// Show scroll options modal for configuring scroll steps
function showScrollOptionsModal(stepIndex, step) {
  // Remove existing modals
  const existingModal = document.getElementById('zero-code-scroll-options-modal');
  if (existingModal) {
    existingModal.remove();
  }
  
  // Create overlay
  const overlay = document.createElement('div');
  overlay.id = 'zero-code-scroll-options-overlay';
  overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 1000001; display: flex; align-items: center; justify-content: center;';
  
  // Create modal
  const modal = document.createElement('div');
  modal.id = 'zero-code-scroll-options-modal';
  modal.style.cssText = 'background: #1a1f2e; border: 2px solid #8b5cf6; border-radius: 12px; padding: 24px; max-width: 800px; max-height: 85vh; overflow-y: auto; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #e1e8ed; box-shadow: 0 8px 32px rgba(0,0,0,0.6);';
  
  // Header
  const header = document.createElement('div');
  header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid #2a3441;';
  
  const title = document.createElement('h3');
  title.textContent = '⚙️ Configure Scroll Options';
  title.style.cssText = 'margin: 0; font-size: 20px; font-weight: 600; color: #8b5cf6;';
  
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background: transparent; border: none; color: #e1e8ed; font-size: 24px; cursor: pointer; padding: 0; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 4px; transition: background 0.2s;';
  closeBtn.onmouseenter = () => { closeBtn.style.background = 'rgba(255,255,255,0.1)'; };
  closeBtn.onmouseleave = () => { closeBtn.style.background = 'transparent'; };
  closeBtn.onclick = () => {
    if (modal.parentElement) modal.remove();
    if (overlay.parentElement) overlay.remove();
  };
  
  header.appendChild(title);
  header.appendChild(closeBtn);
  modal.appendChild(header);
  
  // Current scroll info
  const infoSection = document.createElement('div');
  infoSection.style.cssText = 'margin-bottom: 20px; padding: 12px; background: rgba(139, 92, 246, 0.1); border-radius: 8px; border-left: 3px solid #8b5cf6;';
  
  const currentMode = step.scroll?.mode || 'y';
  const currentY = step.scrollY || step.scroll?.y || step.y || 0;
  
  const infoLabel = document.createElement('div');
  infoLabel.textContent = 'Current Scroll Configuration:';
  infoLabel.style.cssText = 'font-size: 12px; color: #9ca3af; margin-bottom: 6px; font-weight: 600;';
  
  const infoValue = document.createElement('div');
  infoValue.textContent = `Mode: ${currentMode} | Y Position: ${currentY}`;
  infoValue.style.cssText = 'font-size: 14px; color: #8b5cf6; font-family: monospace;';
  
  infoSection.appendChild(infoLabel);
  infoSection.appendChild(infoValue);
  modal.appendChild(infoSection);
  
  // Scroll options
  const optionsContainer = document.createElement('div');
  optionsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px;';
  
  let selectedMode = currentMode;
  
  // Option 1: Scroll to element (if locator candidates available)
  if (step.scroll?.locatorCandidates && step.scroll.locatorCandidates.length > 0) {
    const elementCard = document.createElement('div');
    elementCard.style.cssText = 'padding: 16px; background: rgba(42, 52, 65, 0.5); border: 2px solid ' + (selectedMode === 'element' ? '#8b5cf6' : 'rgba(139, 92, 246, 0.3)') + '; border-radius: 8px; cursor: pointer; transition: all 0.2s; position: relative;';
    
    if (selectedMode === 'element') {
      const badge = document.createElement('div');
      badge.textContent = '⭐ Recommended';
      badge.style.cssText = 'position: absolute; top: 8px; right: 8px; font-size: 10px; color: #8b5cf6; font-weight: 600; padding: 4px 8px; background: rgba(139, 92, 246, 0.2); border-radius: 4px;';
      elementCard.appendChild(badge);
    }
    
    elementCard.onclick = () => {
      selectedMode = 'element';
      optionsContainer.querySelectorAll('div[data-scroll-option]').forEach(card => {
        const mode = card.getAttribute('data-scroll-option');
        card.style.borderColor = mode === selectedMode ? '#8b5cf6' : 'rgba(139, 92, 246, 0.3)';
        card.style.background = mode === selectedMode ? 'rgba(139, 92, 246, 0.2)' : 'rgba(42, 52, 65, 0.5)';
      });
    };
    
    elementCard.setAttribute('data-scroll-option', 'element');
    
    const elementTitle = document.createElement('div');
    elementTitle.textContent = '📌 Scroll to Element';
    elementTitle.style.cssText = 'font-size: 15px; font-weight: 600; color: #8b5cf6; margin-bottom: 8px;';
    elementCard.appendChild(elementTitle);
    
    const elementDesc = document.createElement('div');
    elementDesc.textContent = 'Scroll to a specific element using its locator';
    elementDesc.style.cssText = 'font-size: 12px; color: #9ca3af; margin-bottom: 8px;';
    elementCard.appendChild(elementDesc);
    
    const primaryCandidate = step.scroll.locatorCandidates[step.scroll.primaryLocatorIndex || 0];
    if (primaryCandidate) {
      const selectorValue = document.createElement('div');
      selectorValue.textContent = primaryCandidate.selector;
      selectorValue.style.cssText = 'font-size: 11px; color: #8b5cf6; font-family: monospace; background: rgba(0,0,0,0.3); padding: 6px; border-radius: 4px; word-break: break-all;';
      elementCard.appendChild(selectorValue);
    }
    
    optionsContainer.appendChild(elementCard);
  }
  
  // Option 2: Scroll to Y position
  const yCard = document.createElement('div');
  yCard.style.cssText = 'padding: 16px; background: rgba(42, 52, 65, 0.5); border: 2px solid ' + (selectedMode === 'y' ? '#8b5cf6' : 'rgba(139, 92, 246, 0.3)') + '; border-radius: 8px; cursor: pointer; transition: all 0.2s;';
  yCard.onclick = () => {
    selectedMode = 'y';
    optionsContainer.querySelectorAll('div[data-scroll-option]').forEach(card => {
      const mode = card.getAttribute('data-scroll-option');
      card.style.borderColor = mode === selectedMode ? '#8b5cf6' : 'rgba(139, 92, 246, 0.3)';
      card.style.background = mode === selectedMode ? 'rgba(139, 92, 246, 0.2)' : 'rgba(42, 52, 65, 0.5)';
    });
  };
  yCard.setAttribute('data-scroll-option', 'y');
  
  const yTitle = document.createElement('div');
  yTitle.textContent = '📍 Scroll to Y Position';
  yTitle.style.cssText = 'font-size: 15px; font-weight: 600; color: #8b5cf6; margin-bottom: 8px;';
  yCard.appendChild(yTitle);
  
  const yDesc = document.createElement('div');
  yDesc.textContent = `Scroll to Y position: ${currentY}`;
  yDesc.style.cssText = 'font-size: 12px; color: #9ca3af; margin-bottom: 8px;';
  yCard.appendChild(yDesc);
  
  const yCode = document.createElement('div');
  yCode.textContent = `window.scrollTo(0, ${currentY})`;
  yCode.style.cssText = 'font-size: 11px; color: #8b5cf6; font-family: monospace; background: rgba(0,0,0,0.3); padding: 6px; border-radius: 4px;';
  yCard.appendChild(yCode);
  
  optionsContainer.appendChild(yCard);
  
  // Option 3: Scroll to bottom
  const bottomCard = document.createElement('div');
  bottomCard.style.cssText = 'padding: 16px; background: rgba(42, 52, 65, 0.5); border: 2px solid ' + (selectedMode === 'bottom' ? '#8b5cf6' : 'rgba(139, 92, 246, 0.3)') + '; border-radius: 8px; cursor: pointer; transition: all 0.2s;';
  bottomCard.onclick = () => {
    selectedMode = 'bottom';
    optionsContainer.querySelectorAll('div[data-scroll-option]').forEach(card => {
      const mode = card.getAttribute('data-scroll-option');
      card.style.borderColor = mode === selectedMode ? '#8b5cf6' : 'rgba(139, 92, 246, 0.3)';
      card.style.background = mode === selectedMode ? 'rgba(139, 92, 246, 0.2)' : 'rgba(42, 52, 65, 0.5)';
    });
  };
  bottomCard.setAttribute('data-scroll-option', 'bottom');
  
  const bottomTitle = document.createElement('div');
  bottomTitle.textContent = '⬇️ Scroll to Bottom';
  bottomTitle.style.cssText = 'font-size: 15px; font-weight: 600; color: #8b5cf6; margin-bottom: 8px;';
  bottomCard.appendChild(bottomTitle);
  
  const bottomDesc = document.createElement('div');
  bottomDesc.textContent = 'Scroll to the bottom of the page';
  bottomDesc.style.cssText = 'font-size: 12px; color: #9ca3af; margin-bottom: 8px;';
  bottomCard.appendChild(bottomDesc);
  
  const bottomCode = document.createElement('div');
  bottomCode.textContent = 'window.scrollTo(0, document.body.scrollHeight)';
  bottomCode.style.cssText = 'font-size: 11px; color: #8b5cf6; font-family: monospace; background: rgba(0,0,0,0.3); padding: 6px; border-radius: 4px;';
  bottomCard.appendChild(bottomCode);
  
  optionsContainer.appendChild(bottomCard);
  
  // Option 4: Scroll to top
  const topCard = document.createElement('div');
  topCard.style.cssText = 'padding: 16px; background: rgba(42, 52, 65, 0.5); border: 2px solid ' + (selectedMode === 'top' ? '#8b5cf6' : 'rgba(139, 92, 246, 0.3)') + '; border-radius: 8px; cursor: pointer; transition: all 0.2s;';
  topCard.onclick = () => {
    selectedMode = 'top';
    optionsContainer.querySelectorAll('div[data-scroll-option]').forEach(card => {
      const mode = card.getAttribute('data-scroll-option');
      card.style.borderColor = mode === selectedMode ? '#8b5cf6' : 'rgba(139, 92, 246, 0.3)';
      card.style.background = mode === selectedMode ? 'rgba(139, 92, 246, 0.2)' : 'rgba(42, 52, 65, 0.5)';
    });
  };
  topCard.setAttribute('data-scroll-option', 'top');
  
  const topTitle = document.createElement('div');
  topTitle.textContent = '⬆️ Scroll to Top';
  topTitle.style.cssText = 'font-size: 15px; font-weight: 600; color: #8b5cf6; margin-bottom: 8px;';
  topCard.appendChild(topTitle);
  
  const topDesc = document.createElement('div');
  topDesc.textContent = 'Scroll to the top of the page';
  topDesc.style.cssText = 'font-size: 12px; color: #9ca3af; margin-bottom: 8px;';
  topCard.appendChild(topDesc);
  
  const topCode = document.createElement('div');
  topCode.textContent = 'window.scrollTo(0, 0)';
  topCode.style.cssText = 'font-size: 11px; color: #8b5cf6; font-family: monospace; background: rgba(0,0,0,0.3); padding: 6px; border-radius: 4px;';
  topCard.appendChild(topCode);
  
  optionsContainer.appendChild(topCard);
  
  modal.appendChild(optionsContainer);
  
  // Apply button
  const applyBtn = document.createElement('button');
  applyBtn.textContent = 'Apply Scroll Mode';
  applyBtn.style.cssText = 'width: 100%; padding: 12px; background: #8b5cf6; border: none; border-radius: 6px; color: white; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; margin-bottom: 10px;';
  applyBtn.onmouseenter = () => { applyBtn.style.background = '#7c3aed'; };
  applyBtn.onmouseleave = () => { applyBtn.style.background = '#8b5cf6'; };
  applyBtn.onclick = () => {
    // Update step with selected mode
    if (!state.steps[stepIndex]) return;
    
    if (!state.steps[stepIndex].scroll) {
      state.steps[stepIndex].scroll = {};
    }
    
    state.steps[stepIndex].scroll.mode = selectedMode;
    
    // If mode is element, ensure locator candidates are preserved
    if (selectedMode === 'element' && step.scroll?.locatorCandidates) {
      state.steps[stepIndex].scroll.locatorCandidates = step.scroll.locatorCandidates;
      state.steps[stepIndex].scroll.primaryLocatorIndex = step.scroll.primaryLocatorIndex || 0;
    }
    
    // If mode is y, ensure y value is preserved
    if (selectedMode === 'y') {
      state.steps[stepIndex].scroll.y = currentY;
    }
    
    // Mark that steps changed
    state.stepsChangedAfterRecording = true;
    
    // Re-render
    render();
    saveStateToLocalStorage();
    
    // Close modal
    if (modal.parentElement) modal.remove();
    if (overlay.parentElement) overlay.remove();
    
    showToast('Scroll mode updated successfully!', 'success');
  };
  modal.appendChild(applyBtn);
  
  // Cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'width: 100%; padding: 12px; background: rgba(107, 114, 128, 0.3); border: 1px solid #6b7280; border-radius: 6px; color: #e1e8ed; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s;';
  cancelBtn.onmouseenter = () => { cancelBtn.style.background = 'rgba(107, 114, 128, 0.5)'; };
  cancelBtn.onmouseleave = () => { cancelBtn.style.background = 'rgba(107, 114, 128, 0.3)'; };
  cancelBtn.onclick = () => {
    if (modal.parentElement) modal.remove();
    if (overlay.parentElement) overlay.remove();
  };
  modal.appendChild(cancelBtn);
  
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  
  // Close on overlay click
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      if (modal.parentElement) modal.remove();
      if (overlay.parentElement) overlay.remove();
    }
  };
}

// Initialize BDD feature controls
function initBDDFeatures() {
  // Toggle Examples container when Scenario Outline is checked
  const useScenarioOutline = document.getElementById('useScenarioOutline');
  const examplesContainer = document.getElementById('examplesContainer');
  
  if (useScenarioOutline && examplesContainer) {
    useScenarioOutline.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      examplesContainer.style.display = isChecked ? 'block' : 'none';
      state.bddOptions.useScenarioOutline = isChecked;
      
      // If unchecked, clear examples to ensure clean revert
      if (!isChecked) {
        state.bddOptions.examples = [];
        const examplesTable = document.getElementById('examplesTable');
        if (examplesTable) {
          examplesTable.value = '';
        }
        const examplesUpdateStatus = document.getElementById('examplesUpdateStatus');
        if (examplesUpdateStatus) {
          examplesUpdateStatus.style.display = 'none';
        }
      } else {
        // Auto-detect examples if enabled
        if (state.steps.length > 0) {
          detectAndSuggestExamples();
        }
      }
      
      // Mark that examples/outline was updated to force feature code update
      state.examplesJustUpdated = true;
      saveStateToLocalStorage();
      // Re-render to update Gherkin and step display (revert to original values if unchecked)
      render();
      // Clear the flag after render
      state.examplesJustUpdated = false;
      
      // Show status message
      const examplesUpdateStatus = document.getElementById('examplesUpdateStatus');
      if (examplesUpdateStatus) {
        if (!isChecked) {
          examplesUpdateStatus.textContent = '✅ Scenario Outline disabled. Steps and Gherkin reverted to original values.';
          examplesUpdateStatus.style.background = 'rgba(16, 185, 129, 0.2)';
          examplesUpdateStatus.style.borderColor = '#10b981';
          examplesUpdateStatus.style.color = '#34d399';
          examplesUpdateStatus.style.display = 'block';
          setTimeout(() => {
            if (examplesUpdateStatus) {
              examplesUpdateStatus.style.display = 'none';
            }
          }, 3000);
        } else {
          examplesUpdateStatus.style.display = 'none';
        }
      }
    });
  }
  
  // Handle Background checkbox
  const markAsBackground = document.getElementById('markAsBackground');
  if (markAsBackground) {
    markAsBackground.addEventListener('change', (e) => {
      state.bddOptions.markAsBackground = e.target.checked;
      saveStateToLocalStorage(); // Auto-save on change
    });
  }
  
  // Handle New Scenario checkbox
  const createNewScenario = document.getElementById('createNewScenario');
  if (createNewScenario) {
    createNewScenario.addEventListener('change', (e) => {
      state.bddOptions.createNewScenario = e.target.checked;
      saveStateToLocalStorage(); // Auto-save on change
    });
  }
  
  // Parse Examples table when changed
  const examplesTable = document.getElementById('examplesTable');
  if (examplesTable) {
    examplesTable.addEventListener('blur', () => {
      try {
        const examplesText = examplesTable.value;
        const trimmedText = examplesText.trim();
        const examplesUpdateStatus = document.getElementById('examplesUpdateStatus');
        
        // Always save raw text (even if invalid JSON)
        state.bddOptions.examplesRawText = examplesText;
        saveStateToLocalStorage(); // Auto-save on blur
        
        if (trimmedText) {
          const parsed = JSON.parse(trimmedText);
          state.bddOptions.examples = parsed;
          // Mark that examples were updated to force feature code update
          state.examplesJustUpdated = true;
          console.log('[BDD] Examples parsed:', state.bddOptions.examples);
          saveStateToLocalStorage(); // Save parsed examples too
          
          // Re-render to update Gherkin and step display with placeholders
          render();
          // Clear the flag after render
          state.examplesJustUpdated = false;
          
          // Show success status
          if (examplesUpdateStatus) {
            const exampleKeys = Object.keys(parsed[0] || {});
            const keyCount = exampleKeys.length;
            const rowCount = parsed.length;
            examplesUpdateStatus.textContent = `✅ Auto-saved! ${rowCount} example(s) with ${keyCount} parameter(s). Steps and Gherkin updated.`;
            examplesUpdateStatus.style.display = 'block';
            examplesUpdateStatus.style.background = 'rgba(139, 92, 246, 0.2)';
            examplesUpdateStatus.style.borderColor = '#8b5cf6';
            examplesUpdateStatus.style.color = '#a78bfa';
            
            setTimeout(() => {
              if (examplesUpdateStatus) {
                examplesUpdateStatus.style.display = 'none';
              }
            }, 3000);
          }
        } else {
          state.bddOptions.examples = [];
          state.examplesJustUpdated = true;
          saveStateToLocalStorage();
          render();
          state.examplesJustUpdated = false;
          if (examplesUpdateStatus) {
            examplesUpdateStatus.style.display = 'none';
          }
        }
      } catch (e) {
        console.warn('[BDD] Invalid JSON in Examples table:', e);
        // Raw text is already saved above, so user's work is preserved
        examplesTable.style.borderColor = 'var(--danger)';
        const examplesUpdateStatus = document.getElementById('examplesUpdateStatus');
        if (examplesUpdateStatus) {
          examplesUpdateStatus.textContent = '❌ Invalid JSON format. Text saved, but please fix syntax.';
          examplesUpdateStatus.style.background = 'rgba(239, 68, 68, 0.2)';
          examplesUpdateStatus.style.borderColor = '#ef4444';
          examplesUpdateStatus.style.color = '#f87171';
          examplesUpdateStatus.style.display = 'block';
        }
        setTimeout(() => {
          examplesTable.style.borderColor = 'var(--border)';
        }, 2000);
      }
    });
    
    // Also update on input for real-time feedback (debounced) - auto-save enabled
    let examplesInputTimeout = null;
    const examplesUpdateStatus = document.getElementById('examplesUpdateStatus');
    
    examplesTable.addEventListener('input', () => {
      clearTimeout(examplesInputTimeout);
      
      // Hide status while typing
      if (examplesUpdateStatus) {
        examplesUpdateStatus.style.display = 'none';
      }
      
      // Save raw text immediately (even if invalid JSON) for better UX
      const examplesText = examplesTable.value;
      if (state.bddOptions.examplesRawText !== examplesText) {
        state.bddOptions.examplesRawText = examplesText; // Store raw text for persistence
        saveStateToLocalStorage(); // Auto-save immediately on any change
      }
      
      examplesInputTimeout = setTimeout(() => {
        try {
          const trimmedText = examplesText.trim();
          if (trimmedText) {
            const parsed = JSON.parse(trimmedText);
            state.bddOptions.examples = parsed;
            // Mark that examples were updated to force feature code update
            state.examplesJustUpdated = true;
            saveStateToLocalStorage(); // Save parsed examples
            // Re-render to show placeholders in steps and update Gherkin
            render();
            // Clear the flag after render
            state.examplesJustUpdated = false;
            
            // Show success status
            if (examplesUpdateStatus) {
              const exampleKeys = Object.keys(parsed[0] || {});
              const keyCount = exampleKeys.length;
              const rowCount = parsed.length;
              examplesUpdateStatus.textContent = `✅ Auto-saved! ${rowCount} example(s) with ${keyCount} parameter(s). Steps and Gherkin updated.`;
              examplesUpdateStatus.style.display = 'block';
              
              // Hide after 3 seconds
              setTimeout(() => {
                if (examplesUpdateStatus) {
                  examplesUpdateStatus.style.display = 'none';
                }
              }, 3000);
            }
          } else {
            // Empty examples - clear and re-render
            state.bddOptions.examples = [];
            state.examplesJustUpdated = true;
            saveStateToLocalStorage();
            render();
            state.examplesJustUpdated = false;
            if (examplesUpdateStatus) {
              examplesUpdateStatus.style.display = 'none';
            }
          }
        } catch (e) {
          // Invalid JSON - don't update parsed examples, but raw text is already saved
          if (examplesUpdateStatus) {
            examplesUpdateStatus.textContent = '⚠️ Invalid JSON format. Text saved, but please fix syntax.';
            examplesUpdateStatus.style.background = 'rgba(239, 68, 68, 0.2)';
            examplesUpdateStatus.style.borderColor = '#ef4444';
            examplesUpdateStatus.style.color = '#f87171';
            examplesUpdateStatus.style.display = 'block';
          }
        }
      }, 300); // Reduced debounce from 500ms to 300ms for faster updates
    });
  }
}

// Auto-detect Scenario Outline opportunities
function detectAndSuggestExamples() {
  // Group type steps by selector
  const typeGroups = {};
  state.steps.filter(s => s.kind === 'type').forEach(step => {
    const key = step.selector || step.normalizedDescription;
    if (key) {
      if (!typeGroups[key]) typeGroups[key] = [];
      if (step.value) typeGroups[key].push(step.value);
    }
  });
  
  // Find selectors with multiple values
  const candidates = Object.entries(typeGroups).filter(([_, values]) => {
    const uniqueValues = [...new Set(values)];
    return uniqueValues.length >= 2;
  });
  
  if (candidates.length > 0) {
    const [selector, values] = candidates[0];
    const uniqueValues = [...new Set(values)];
    const examples = uniqueValues.map(value => ({ value }));
    
    const examplesTable = document.getElementById('examplesTable');
    if (examplesTable) {
      examplesTable.value = JSON.stringify(examples, null, 2);
      state.bddOptions.examples = examples;
      // Mark that examples were updated to force feature code update
      state.examplesJustUpdated = true;
      console.log('[BDD] 💡 Auto-detected Examples for selector:', selector, examples);
      // Trigger re-render to show placeholders
      render();
      // Clear the flag after render
      state.examplesJustUpdated = false;
    }
  }
}

// Map example keys to step fields for parameterization
function getParameterizedStepFields(step, exampleKeys) {
  const fields = [];
  
  // Check which fields in this step should be parameterized based on example keys
  if (exampleKeys.includes('value')) {
    // For type, select, selectRadio steps - parameterize the value field
    if (step.kind === 'type' || step.kind === 'select' || step.kind === 'selectRadio') {
      fields.push({ field: 'value', placeholder: '<value>' });
    }
  }
  
  if (exampleKeys.includes('expectedValue') || exampleKeys.includes('expectedText')) {
    // For assertion steps - parameterize expectedValue
    if (step.kind === 'assertText' || step.kind === 'assertValue') {
      fields.push({ field: 'expectedValue', placeholder: exampleKeys.includes('expectedValue') ? '<expectedValue>' : '<expectedText>' });
    }
  }
  
  if (exampleKeys.includes('selector')) {
    // Parameterize selector if needed
    if (step.selector) {
      fields.push({ field: 'selector', placeholder: '<selector>' });
    }
  }
  
  if (exampleKeys.includes('url')) {
    // Parameterize URL for navigate steps
    if (step.kind === 'navigate') {
      fields.push({ field: 'url', placeholder: '<url>' });
    }
  }
  
  // Check for custom keys that match step fields
  exampleKeys.forEach(key => {
    if (step[key] !== undefined && !['kind', 'timestamp', 'normalizedDescription', 'normalizedSelector', 'normalizedStepText'].includes(key)) {
      if (!fields.find(f => f.field === key)) {
        fields.push({ field: key, placeholder: `<${key}>` });
      }
    }
  });
  
  return fields;
}

// Recording functions
async function startRecording() {
  if (state.recording.active) return;
  
  // No need to require project selection - will be created from form details when recording stops
  const baseUrl = document.getElementById('baseUrl').value || 'about:blank';
  const browserType = document.getElementById('browserType').value || 'chromium';

  // T2.5 — viewport preset. "maximize" → null (existing default). Otherwise
  // map preset → {width,height}. Custom reads numeric inputs.
  const viewportPreset = (document.getElementById('viewportPreset') || {}).value || 'maximize';
  const VP_PRESETS = {
    'desktop-1920': { width: 1920, height: 1080 },
    'laptop-1366':  { width: 1366, height: 768  },
    'tablet-768':   { width: 768,  height: 1024 },
    'mobile-375':   { width: 375,  height: 667  },
    'mobile-390':   { width: 390,  height: 844  },
  };
  let viewport = null; // null = maximize / no override
  if (viewportPreset === 'custom') {
    const w = Number((document.getElementById('viewportWidth')  || {}).value);
    const h = Number((document.getElementById('viewportHeight') || {}).value);
    if (Number.isFinite(w) && Number.isFinite(h) && w >= 200 && h >= 200) {
      viewport = { width: Math.min(4096, Math.floor(w)), height: Math.min(4096, Math.floor(h)) };
    }
  } else if (VP_PRESETS[viewportPreset]) {
    viewport = VP_PRESETS[viewportPreset];
  }

  document.getElementById('recordingStatus').textContent =
    `Starting recording with ${browserType}${viewport ? ` @ ${viewport.width}×${viewport.height}` : ' (maximized)'}...`;

  try {
    const resp = await fetch('/api/recording/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl,
        browserType,
        viewport,           // T2.5 — null means existing maximize behavior
        viewportPreset,     // raw preset name for diagnostics / future use
        // Don't require projectId - will be created from form details when recording stops
      })
    });
    
    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to start recording');
    }
    
    const data = await resp.json();
    
    // Save state snapshot before starting recording
    saveStateSnapshot();
    
    state.recording.active = true;
    state.recording.sessionId = data.sessionId;
    
    // Show full-screen recording overlay
    const overlay = document.getElementById('recordingOverlay');
    if (overlay) {
      overlay.style.display = 'block';
      document.body.style.overflow = 'hidden'; // Prevent scrolling on main page
    }
    
    // Connect WebSocket for real-time updates
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = data.wsUrl.replace(/wss?:\/\/[^/]+/, `${protocol}//${host}`);
    console.log('[Frontend] Connecting WebSocket to:', wsUrl);
    state.recording.ws = new WebSocket(wsUrl);
    
    state.recording.ws.onopen = () => {
      console.log('[Frontend] ✅ WebSocket connected!');
    };
    
    state.recording.ws.onmessage = (event) => {
      // Reduced logging during recording for better performance
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'action') {
          // Skip actions if recording is paused
          if (state.recording.paused) {
            return;
          }

          // Add normalized action to steps immediately
          const normalizedAction = msg.normalized ? msg.data : msg.data;
          
          // Check if this should be a background step
          if (state.bddOptions.markAsBackground) {
            state.backgroundSteps.push(normalizedAction);
          } else {
            state.steps.push(normalizedAction);
          }
          
          // Save to localStorage
          saveStateToLocalStorage();
          
          // Check if we should create a new scenario
          if (state.bddOptions.createNewScenario && state.steps.length > 0) {
            state.scenarios.push({
              title: document.getElementById('featureTitle').value || 'Recorded Flow',
              tags: (document.getElementById('tags').value || '').trim().split(/\s+/).filter(t => t.startsWith('@')),
              steps: [...state.steps]
            });
            state.steps = [];
            state.bddOptions.createNewScenario = false;
            document.getElementById('createNewScenario').checked = false;
            saveStateToLocalStorage(); // Save scenario creation
          }
          
          // Update UI smoothly with debounced rendering
          debouncedRender();
        } else if (msg.type === 'action_updated') {
          // Handle merged type actions - update existing step instead of adding new one
          if (state.recording.paused) {
            return;
          }
          
          const updatedAction = msg.data;
          const actionIdx = msg.actionIndex;
          
          // Update the step at the specified index
          if (actionIdx >= 0 && actionIdx < state.steps.length) {
            state.steps[actionIdx] = updatedAction;
          } else {
            // Fallback: find and update by timestamp
            const idx = state.steps.findIndex(s => s.timestamp === updatedAction.timestamp);
            if (idx >= 0) {
              state.steps[idx] = updatedAction;
            }
          }
          
          // Save to localStorage
          saveStateToLocalStorage();
          
          // Update UI smoothly
          debouncedRender();
          
          // Update status
          const statusText = `Recording... (${state.steps.length} steps)`;
          const statusEl = document.getElementById('recordingStatus');
          if (statusEl) {
            statusEl.innerHTML = `<span style="display: inline-block; width: 8px; height: 8px; background: #10b981; border-radius: 50%; margin-right: 8px; animation: pulse 1s ease-in-out infinite;"></span>${statusText}`;
            statusEl.style.color = 'var(--accent)';
          }
          
          // Scroll code previews to show latest changes (debounced)
          setTimeout(() => {
          const codePreview = document.getElementById('code-feature');
          if (codePreview) {
              codePreview.scrollTop = codePreview.scrollHeight;
            }
            const stepsPreview = document.getElementById('code-steps');
            if (stepsPreview) {
              stepsPreview.scrollTop = stepsPreview.scrollHeight;
            }
            const playwrightPreview = document.getElementById('code-playwright');
            if (playwrightPreview) {
              playwrightPreview.scrollTop = playwrightPreview.scrollHeight;
            }
          }, 100);
        } else if (msg.type === 'status') {
          const statusEl = document.getElementById('recordingStatus');
          if (statusEl) {
            statusEl.textContent = msg.message || 'Recording...';
          }
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };
    
    state.recording.ws.onerror = (error) => {
      console.error('[Frontend] ❌ WebSocket error:', error);
    };
    
    state.recording.ws.onclose = (event) => {
      console.log('[Frontend] ⚠️ WebSocket closed. Code:', event.code, 'Reason:', event.reason);
      if (state.recording.active) {
        state.recording.ws = null;
        console.log('[Frontend] 🔄 Starting polling fallback...');
        // Fallback: use polling if WebSocket fails
        startPollingForActions();
      }
    };
    
    // Fallback polling mechanism
    let lastActionCount = 0;
    function startPollingForActions() {
      if (state.recording.pollingInterval) return;
      state.recording.pollingInterval = setInterval(async () => {
        if (!state.recording.active || !state.recording.sessionId) {
          clearInterval(state.recording.pollingInterval);
          state.recording.pollingInterval = null;
          return;
        }

        try {
          const resp = await fetch(`/api/recording/${state.recording.sessionId}/status`);
          if (resp.ok) {
            const status = await resp.json();
            if (status.actionCount > lastActionCount) {
              const actionsResp = await fetch(`/api/recording/${state.recording.sessionId}/actions?since=${lastActionCount > 0 ? state.steps[state.steps.length - 1]?.timestamp || 0 : 0}`);
              if (actionsResp.ok) {
                const data = await actionsResp.json();
                if (data.actions && data.actions.length > 0) {
                  data.actions.forEach(action => {
                    if (!state.recording.paused && !state.steps.find(s => s.timestamp === action.timestamp)) {
                      state.steps.push(action);
                    }
                  });
                  // Save to localStorage
                  saveStateToLocalStorage();
                  // Update UI smoothly
                  debouncedRender();
                  lastActionCount = status.actionCount;
                }
              }
            }
          }
        } catch (e) {
          console.warn('Polling error:', e);
        }
      }, 1000);
    }
    
    // Update UI
    document.getElementById('startRecording').disabled = true;
    document.getElementById('stopRecording').disabled = false;
    document.getElementById('pauseRecording').disabled = false;
    const statusEl = document.getElementById('recordingStatus');
    if (statusEl) {
      statusEl.innerHTML = `<span style="display: inline-block; width: 8px; height: 8px; background: #10b981; border-radius: 50%; margin-right: 8px; animation: pulse 1s ease-in-out infinite;"></span>Recording... A browser window has opened. Interact with it to record actions. Code updates in real-time!`;
      statusEl.style.color = 'var(--accent)';
    }
    
    // Show LIVE badge
    const liveBadge = document.getElementById('live-feature-badge');
    if (liveBadge) {
      liveBadge.style.display = 'inline-block';
    }
    
  } catch (error) {
    console.error('Recording start error:', error);
    document.getElementById('recordingStatus').textContent = `Error: ${error.message}`;
    document.getElementById('recordingStatus').style.color = 'var(--danger)';
  }
}

async function stopRecording() {
  if (!state.recording.active || !state.recording.sessionId) return;
  
  document.getElementById('recordingStatus').textContent = 'Stopping recording...';
  
  try {
    // Just stop recording and get actions - don't create project yet
    const resp = await fetch('/api/recording/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        sessionId: state.recording.sessionId,
        // Don't send project details yet - wait for user approval
        skipProjectCreation: true
      })
    });
    
    if (!resp.ok) {
      throw new Error('Failed to stop recording');
    }
    
    const data = await resp.json();
    
    // Merge all actions from server
    if (data.actions && data.actions.length > 0) {
      state.steps = data.actions;
      // Reset flag when recording stops (steps are being set from server, not user edits)
      state.stepsChangedAfterRecording = false;
      
      // Store recording data for approval
      state.pendingRecording = {
        actions: data.actions,
        actionCount: data.actionCount || data.actions.length
      };
      
      saveStateToLocalStorage(); // Save merged steps
      render(); // Update all code panels with final steps
      
      // Show approval dialog after a short delay to ensure UI is updated
      setTimeout(() => {
        showRecordingApprovalDialog();
      }, 100);
    } else {
      showToast('No steps recorded', 'warning');
    }
    
    // Close WebSocket
    if (state.recording.ws) {
      state.recording.ws.close();
      state.recording.ws = null;
    }

    // Clear polling interval if active
    if (state.recording.pollingInterval) {
      clearInterval(state.recording.pollingInterval);
      state.recording.pollingInterval = null;
    }
    
    // Clear render timeout and force final render
    if (state.recording.renderTimeout) {
      clearTimeout(state.recording.renderTimeout);
      state.recording.renderTimeout = null;
    }
    state.recording.pendingRender = false;
    
    // Clear code cache and force full regeneration
    state.recording.codeCache = {};
    state.recording.lastStepCount = 0;
    
    // Hide LIVE badge
    const liveBadge = document.getElementById('live-feature-badge');
    if (liveBadge) {
      liveBadge.style.display = 'none';
    }
    
    // Hide overlay and restore scrolling
    const overlay = document.getElementById('recordingOverlay');
    if (overlay) {
      overlay.style.display = 'none';
      document.body.style.overflow = ''; // Restore scrolling
    }
    
    // Show revert button if there's history
    const revertBtn = document.getElementById('revertChangesBtn');
    if (revertBtn && state.stateHistory.length > 0) {
      revertBtn.style.display = 'inline-block';
    }
    
    state.recording.active = false;
    state.recording.sessionId = null;
    
    // Update UI
    document.getElementById('startRecording').disabled = false;
    document.getElementById('stopRecording').disabled = true;
    document.getElementById('pauseRecording').disabled = true;
    
    document.getElementById('recordingStatus').textContent = `✅ Recording stopped! Review steps and approve to save to project.`;
    document.getElementById('recordingStatus').style.color = '#10b981';
    
    // Show step definitions generation prompt
    const stepDefsPrompt = document.getElementById('stepDefsPrompt');
    const recordedStepsCount = document.getElementById('recordedStepsCount');
    if (stepDefsPrompt && recordedStepsCount) {
      recordedStepsCount.textContent = data.actionCount || state.steps.length;
      stepDefsPrompt.style.display = 'block';
      
      // Set framework selector to match current selection
      const frameworkSelect = document.getElementById('stepDefsFramework');
      const currentFramework = document.getElementById('framework')?.value || 'playwright-java';
      if (frameworkSelect) {
        // Map framework values
        if (currentFramework === 'playwright-java') {
          frameworkSelect.value = 'playwright-java';
        } else if (currentFramework === 'selenium-java') {
          frameworkSelect.value = 'selenium-java';
        } else {
          frameworkSelect.value = 'playwright-java'; // Default to playwright-java
        }
      }
    }
    
    // Show generate button in header
    const generateBtn = document.getElementById('generateStepDefsBtn');
    if (generateBtn) {
      generateBtn.style.display = 'inline-block';
    }
    
    // Ensure step definitions are displayed (they're already generated via renderCode() at line 940)
    // The step definitions textarea should already be populated, but double-check
    const stepsEl = document.getElementById('code-steps');
    if (stepsEl && (!stepsEl.value || stepsEl.value.trim() === '')) {
      // If somehow empty, regenerate
      renderCode();
    }
    
    // Surface the framework-organized layout location when the backend
    // mirrored the recording into generated-projects/<framework>/<project>/.
    if (data.layout) {
      const statusEl = document.getElementById('recordingStatus');
      if (statusEl) {
        const rel = data.layout.recordingDir
          ? data.layout.recordingDir.split(/[\\\/]generated-projects[\\\/]/).pop()
          : '';
        statusEl.innerHTML = `${statusEl.innerHTML || ''}` +
          `<div style="color: var(--muted); font-size: 11px; margin-top: 6px;">` +
          `📁 Framework layout: <code>generated-projects/${rel}</code>` +
          `</div>`;
      }
      console.log('[Recording] Mirrored to', data.layout);
    }

    // Try to load step definitions from file if available (optional - file may not exist until export)
    // This is a best-effort attempt - step definitions are already displayed via renderCode()
    if (data.exportPath) {
      const pathParts = data.exportPath.split(/[/\\]/);
      state.currentProjectName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
      if (data.stepsFile && state.currentProjectName) {
        state.currentStepsFilePath = data.stepsFile;
        // Load from file if it exists (non-blocking, silent if 404)
        loadStepDefinitionsFile(state.currentProjectName).catch(() => {
          // Ignore errors - step definitions are already displayed via renderCode()
        });
      }
    } else if (projectName) {
      // If project name was provided but no export path, try loading anyway
      state.currentProjectName = projectName;
      loadStepDefinitionsFile(projectName).catch(() => {
        // Ignore errors - step definitions are already displayed via renderCode()
      });
    }
    
  } catch (error) {
    console.error('Recording stop error:', error);
    document.getElementById('recordingStatus').textContent = `Error: ${error.message}`;
    document.getElementById('recordingStatus').style.color = 'var(--danger)';
  }
}

// Show recording approval dialog
function showRecordingApprovalDialog() {
  console.log('[Recording Approval] Showing approval dialog');
  
  // Get form details
  const projectName = document.getElementById('projectName')?.value?.trim() || `Project-${Date.now()}`;
  const featureTitle = document.getElementById('featureTitle')?.value?.trim() || 'Recorded Test Flow';
  const featureName = document.getElementById('featureName')?.value?.trim() || 'Recorded Feature';
  const framework = document.getElementById('framework')?.value || 'playwright-java';
  const browserType = document.getElementById('browserType')?.value || 'chromium';
  const baseUrl = document.getElementById('baseUrl')?.value || 'http://localhost:3000';
  const tagsInput = document.getElementById('tags')?.value || '';
  const uiTags = tagsInput.trim().split(/\s+/).filter(t => t.startsWith('@'));
  
  const stepCount = state.pendingRecording?.actionCount || state.steps.length;
  console.log('[Recording Approval] Step count:', stepCount, 'Project name:', projectName);
  
  // Create approval dialog
  const dialog = document.createElement('div');
  dialog.id = 'recordingApprovalDialog';
  dialog.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
    backdrop-filter: blur(4px);
  `;
  
  dialog.innerHTML = `
    <div style="background: var(--bg-secondary); border: 2px solid var(--border); border-radius: 16px; padding: 32px; max-width: 600px; width: 90%; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);">
      <h2 style="margin: 0 0 20px 0; color: var(--text); font-size: 24px; font-weight: 700;">✅ Approve Recording</h2>
      <p style="color: var(--text-secondary); margin-bottom: 24px; line-height: 1.6;">
        Review the recording details below. Click "Approve & Save to Project" to create the project and save the recorded steps.
        <br><br>
        <strong style="color: var(--accent);">💡 Note:</strong> Steps are already available for rerun. You can test them using the "Rerun Script" button even without approving.
      </p>
      
      <div style="background: rgba(13, 17, 23, 0.6); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <div style="margin-bottom: 12px;">
          <strong style="color: var(--muted); font-size: 12px; text-transform: uppercase;">Project Name:</strong>
          <div style="color: var(--text); font-size: 14px; margin-top: 4px;">${projectName}</div>
        </div>
        <div style="margin-bottom: 12px;">
          <strong style="color: var(--muted); font-size: 12px; text-transform: uppercase;">Feature Title:</strong>
          <div style="color: var(--text); font-size: 14px; margin-top: 4px;">${featureTitle}</div>
        </div>
        <div style="margin-bottom: 12px;">
          <strong style="color: var(--muted); font-size: 12px; text-transform: uppercase;">Framework:</strong>
          <div style="color: var(--text); font-size: 14px; margin-top: 4px;">${framework}</div>
        </div>
        <div style="margin-bottom: 12px;">
          <strong style="color: var(--muted); font-size: 12px; text-transform: uppercase;">Steps Recorded:</strong>
          <div style="color: var(--accent); font-size: 14px; font-weight: 600; margin-top: 4px;">${stepCount} step(s)</div>
        </div>
        ${uiTags.length > 0 ? `
        <div>
          <strong style="color: var(--muted); font-size: 12px; text-transform: uppercase;">Tags:</strong>
          <div style="color: var(--text); font-size: 14px; margin-top: 4px;">${uiTags.join(' ')}</div>
        </div>
        ` : ''}
      </div>
      
      <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
        <button id="rejectRecordingBtn" style="padding: 12px 24px; font-size: 14px; background: rgba(107, 114, 128, 0.2); border: 1px solid rgba(107, 114, 128, 0.4); border-radius: 8px; color: #9ca3af; cursor: pointer; font-weight: 600;">❌ Discard</button>
        <button id="approveRecordingBtn" style="padding: 12px 24px; font-size: 14px; background: linear-gradient(135deg, #10b981 0%, #34d399 100%); border: none; border-radius: 8px; color: white; cursor: pointer; font-weight: 600;">✅ Approve & Save to Project</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(dialog);
  console.log('[Recording Approval] Dialog added to DOM');
  
  // Handle approve button
  document.getElementById('approveRecordingBtn').onclick = async () => {
    const btn = document.getElementById('approveRecordingBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Saving...';
    try {
      await approveAndSaveRecording(projectName, featureTitle, featureName, framework, browserType, baseUrl, uiTags);
      if (dialog.parentNode) {
        document.body.removeChild(dialog);
      }
    } catch (error) {
      console.error('Error approving recording:', error);
      btn.disabled = false;
      btn.textContent = '✅ Approve & Save to Project';
      showToast(`Error: ${error.message}`, 'error');
    }
  };
  
  // Handle reject button
  document.getElementById('rejectRecordingBtn').onclick = () => {
    // Clear pending recording (but keep steps for rerun)
    state.pendingRecording = null;
    if (dialog.parentNode) {
      document.body.removeChild(dialog);
    }
    showToast('Recording not saved to project, but steps are available for rerun', 'info');
  };
  
  // Don't allow closing by clicking outside - user must choose approve or reject
}

// Approve and save recording to project
async function approveAndSaveRecording(projectName, featureTitle, featureName, framework, browserType, baseUrl, uiTags) {
  console.log('[Recording Approval] Starting approval process for project:', projectName);
  try {
    // Use current project if available, otherwise create new project from form details
    let projectId = state.currentProjectId;
    console.log('[Recording Approval] Current project ID:', projectId);
    
    if (!projectId) {
      // Create project from form details
      try {
        const createProjectResp = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: projectName,
            description: `Created from recording: ${featureTitle}`,
            baseUrl: baseUrl,
            framework: framework,
            browserType: browserType
          })
        });
        
        if (createProjectResp.ok) {
          const projectData = await createProjectResp.json();
          projectId = projectData.project?.id || projectData.id;
          
          if (!projectId) {
            console.error('[Recording Approval] Project created but no ID returned:', projectData);
            throw new Error('Project created but no ID returned from server');
          }
          
          state.currentProjectId = projectId;
          state.currentProjectName = projectName;
          
          console.log('[Recording Approval] Project created successfully:', projectId);
          
          // Update project dropdown
          await loadProjects();
          const dropdown = document.getElementById('project-dropdown');
          if (dropdown) {
            dropdown.value = projectId;
          }
          
          // Show save and delete buttons
          const saveProjectBtn = document.getElementById('save-project-btn');
          if (saveProjectBtn) saveProjectBtn.style.display = 'inline-block';
          const deleteProjectBtn = document.getElementById('delete-project-btn');
          if (deleteProjectBtn) deleteProjectBtn.style.display = 'inline-block';
          
          updateProjectStatus(`Project "${projectName}" created and selected`);
        } else {
          // Get detailed error message
          let errorMessage = 'Failed to create project';
          try {
            const errorData = await createProjectResp.json();
            errorMessage = errorData.error || errorData.message || errorMessage;
            console.error('[Recording Approval] Project creation failed:', errorData);
          } catch (e) {
            errorMessage = `HTTP ${createProjectResp.status}: ${createProjectResp.statusText}`;
            console.error('[Recording Approval] Project creation failed:', createProjectResp.status, createProjectResp.statusText);
          }
          throw new Error(errorMessage);
        }
      } catch (error) {
        console.error('[Recording Approval] Error creating project:', error);
        const btn = document.getElementById('approveRecordingBtn');
        if (btn) {
          btn.disabled = false;
          btn.textContent = '✅ Approve & Save to Project';
        }
        showToast(`Failed to create project: ${error.message}`, 'error');
        throw error; // Re-throw to stop execution
      }
    }
    
    // Save steps to project via API (optimized for large step counts)
    if (projectId && state.steps && state.steps.length > 0) {
      try {
        console.log(`[Recording Approval] Saving ${state.steps.length} steps to project...`);
        const saveStartTime = Date.now();
        
        // Optimized: Only send new steps and scenario, let backend append
        const newSteps = state.steps;
        const scenario = {
          id: `scenario-${Date.now()}`,
          name: featureTitle,
          steps: newSteps.map((a, idx) => ({ stepId: `step-${Date.now()}-${idx}`, action: a })),
          tags: uiTags,
          createdAt: new Date().toISOString()
        };
        
        // Save new steps and scenario via optimized API endpoint
        console.log(`[Recording Approval] Saving ${newSteps.length} steps to project ${projectId}...`);
        
        // Add timeout to prevent hanging
        const saveController = new AbortController();
        const saveTimeout = setTimeout(() => saveController.abort(), 60000); // 60 second timeout
        
        let saveResp;
        try {
          saveResp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/append-steps`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              steps: newSteps,
              scenario: scenario
            }),
            signal: saveController.signal
          });
        } catch (fetchError) {
          clearTimeout(saveTimeout);
          if (fetchError.name === 'AbortError') {
            throw new Error('Save request timed out after 60 seconds');
          }
          throw new Error(`Network error: ${fetchError.message}`);
        }
        clearTimeout(saveTimeout);
        
        if (!saveResp.ok) {
          // Get detailed error message
          let errorMessage = 'Failed to save steps to project';
          try {
            const errorData = await saveResp.json();
            errorMessage = errorData.error || errorData.message || errorMessage;
            console.error('[Recording Approval] Step save failed:', errorData);
          } catch (e) {
            errorMessage = `HTTP ${saveResp.status}: ${saveResp.statusText}`;
            console.error('[Recording Approval] Step save failed:', saveResp.status, saveResp.statusText);
          }
          const btn = document.getElementById('approveRecordingBtn');
          if (btn) {
            btn.disabled = false;
            btn.textContent = '✅ Approve & Save to Project';
          }
          throw new Error(errorMessage);
        }
        
        // Steps saved successfully
        const saveData = await saveResp.json();
        const saveElapsed = Date.now() - saveStartTime;
        console.log(`[Recording Approval] Steps saved in ${saveElapsed}ms`);
        
        // Update button to show progress
        const btn = document.getElementById('approveRecordingBtn');
        if (btn) {
          btn.textContent = `⏳ Generating code files...`;
        }
        
        // Generate and save all code files to project directory
        try {
          console.log('[Recording Approval] Generating code files for project:', projectId);
          const generateStartTime = Date.now();
          
          // Add timeout to prevent hanging
          const generateController = new AbortController();
          const generateTimeout = setTimeout(() => generateController.abort(), 120000); // 120 second timeout for file generation
          
          let generateResp;
          try {
            generateResp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/generate-files`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                featureTitle: featureTitle,
                featureName: featureName,
                framework: framework,
                browserType: browserType,
                baseUrl: baseUrl,
                tags: uiTags
              }),
              signal: generateController.signal
            });
          } catch (fetchError) {
            clearTimeout(generateTimeout);
            if (fetchError.name === 'AbortError') {
              throw new Error('File generation request timed out after 120 seconds');
            }
            throw new Error(`Network error: ${fetchError.message}`);
          }
          clearTimeout(generateTimeout);
          
          if (generateResp.ok) {
            const generateData = await generateResp.json();
            const generateElapsed = Date.now() - generateStartTime;
            const totalElapsed = Date.now() - saveStartTime;
            console.log(`[Recording Approval] Generated ${generateData.generatedFiles?.length || 0} files in ${generateElapsed}ms (total: ${totalElapsed}ms)`);
            
            if (btn) {
              btn.textContent = '✅ Saved!';
              btn.disabled = false;
              setTimeout(() => {
                btn.textContent = '✅ Approve & Save to Project';
              }, 2000);
            }
            
            showToast(`✅ Project created! ${state.steps.length} step(s) saved and ${generateData.count || 0} code files generated in ${Math.round(totalElapsed / 1000)}s!`, 'success');
          } else {
            const errorData = await generateResp.json().catch(() => ({}));
            console.warn('[Recording Approval] File generation failed:', errorData.error);
            if (btn) {
              btn.textContent = '✅ Approve & Save to Project';
              btn.disabled = false;
            }
            showToast(`✅ Project created! ${state.steps.length} step(s) saved. Warning: File generation failed: ${errorData.error || 'Unknown error'}`, 'warning');
          }
        } catch (genError) {
          console.error('[Recording Approval] Error generating files:', genError);
          const btn = document.getElementById('approveRecordingBtn');
          if (btn) {
            btn.textContent = '✅ Approve & Save to Project';
            btn.disabled = false;
          }
          showToast(`✅ Project created! ${state.steps.length} step(s) saved. Warning: File generation failed.`, 'warning');
        }
        
        const statusEl = document.getElementById('recordingStatus');
        if (statusEl) {
          statusEl.textContent = `✅ Recording approved and saved! Total steps: ${state.steps.length}`;
        }
        
        // Auto-save project state
        await autoSaveProject();
        
        // Re-render to update UI
        render();
        renderCode();
      } catch (error) {
        console.error('Error saving to project:', error);
        const btn = document.getElementById('approveRecordingBtn');
        if (btn) {
          btn.disabled = false;
          btn.textContent = '✅ Approve & Save to Project';
        }
        showToast(`Failed to save to project: ${error.message}`, 'error');
        throw error; // Re-throw to be caught by outer catch
      }
    }
    
    // Clear pending recording
    state.pendingRecording = null;
    
  } catch (error) {
    console.error('Error approving recording:', error);
    const btn = document.getElementById('approveRecordingBtn');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '✅ Approve & Save to Project';
    }
    showToast(`Error: ${error.message}`, 'error');
  }
}

// Generate step definitions function
async function generateStepDefinitions() {
  const frameworkSelect = document.getElementById('stepDefsFramework');
  const selectedFramework = frameworkSelect ? frameworkSelect.value : 'playwright-java';
  
  // Map framework values
  let framework = 'playwright-java';
  if (selectedFramework === 'playwright-java') {
    framework = 'playwright-java';
  } else if (selectedFramework === 'selenium-java') {
    framework = 'selenium-java';
  }
  
  // Generate step definitions based on framework
  const stepsEl = document.getElementById('code-steps');
  if (!stepsEl) return;
  
  // Show loading state
  stepsEl.value = '// Generating step definitions...\n';
  stepsEl.style.opacity = '0.6';
  
  try {
    let stepDefs = '';
    
    if (framework === 'playwright-java' || framework === 'selenium-java') {
      // For Java frameworks, call backend API to generate step definitions
      const resp = await fetch('/api/generate-step-definitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          framework: framework,
          steps: state.steps
        })
      });
      
      if (!resp.ok) {
        // Try to get error message from response
        let errorMessage = 'Failed to generate Java step definitions';
        try {
          const errorData = await resp.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (e) {
          errorMessage = `HTTP ${resp.status}: ${resp.statusText}`;
        }
        throw new Error(errorMessage);
      }
      
      const data = await resp.json();
      if (!data.stepDefinitions) {
        throw new Error('Server did not return step definitions');
      }
      stepDefs = data.stepDefinitions;
    }
    
    // Update the textarea
    stepsEl.value = stepDefs;
    stepsEl.style.opacity = '1';
    
    // Hide the prompt
    const stepDefsPrompt = document.getElementById('stepDefsPrompt');
    if (stepDefsPrompt) {
      stepDefsPrompt.style.display = 'none';
    }
    
    // Show success message
    const statusEl = document.getElementById('stepsSaveStatus');
    if (statusEl) {
      statusEl.textContent = '✅ Step definitions generated successfully!';
      statusEl.style.color = '#10b981';
      setTimeout(() => {
        statusEl.textContent = '';
      }, 3000);
    }
    
    // Scroll to step definitions
    stepsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    
  } catch (error) {
    console.error('Error generating step definitions:', error);
    const errorMessage = error.message || 'Unknown error occurred';
    
    // Show detailed error message
    if (framework === 'playwright-java' || framework === 'selenium-java') {
      stepsEl.value = `// Error generating Java step definitions: ${errorMessage}\n// \n// Note: Java step definitions are automatically generated when you export the project.\n// The step definitions will be included in the downloaded ZIP file.\n// \n// For now, here are the TypeScript step definitions as reference:\n\n${generateStepDefs()}`;
    } else {
      stepsEl.value = `// Error generating step definitions: ${errorMessage}\n// \n// Please check the console for more details.`;
    }
    stepsEl.style.opacity = '1';
    
    // Still hide prompt and show message
    const stepDefsPrompt = document.getElementById('stepDefsPrompt');
    if (stepDefsPrompt) {
      stepDefsPrompt.style.display = 'none';
    }
    
    const statusEl = document.getElementById('stepsSaveStatus');
    if (statusEl) {
      statusEl.textContent = `❌ Error: ${errorMessage}`;
      statusEl.style.color = 'var(--danger)';
      setTimeout(() => {
        statusEl.textContent = '';
      }, 8000);
    }
  }
}

// Display test cases results
function displayTestCasesResults(data) {
  const resultsDiv = document.getElementById('testCasesResults');
  const summaryDiv = document.getElementById('testCasesSummary');
  const listDiv = document.getElementById('testCasesList');
  
  if (!resultsDiv || !summaryDiv || !listDiv) return;

  // Store feature file for later use
  resultsDiv.dataset.featureFile = data.featureFile;

  // Display summary
  const summary = data.summary;
  summaryDiv.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px;">
      <div><strong>Total Test Cases:</strong> ${summary.totalTestCases}</div>
      <div><strong>Positive Cases:</strong> ${summary.positiveCases}</div>
      <div><strong>Negative Cases:</strong> ${summary.negativeCases}</div>
      <div><strong>Total Steps:</strong> ${summary.totalSteps}</div>
      <div><strong>Flows Identified:</strong> ${summary.flowsIdentified}</div>
      <div><strong>Assertions Found:</strong> ${summary.assertionsFound}</div>
    </div>
  `;

  // Display test cases list
  listDiv.innerHTML = data.testCases.map((tc, index) => `
    <div style="margin-bottom: 16px; padding: 16px; background: rgba(13, 17, 23, 0.6); border: 1px solid var(--border); border-radius: 8px;">
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
        <div>
          <strong style="color: var(--accent);">${tc.id}</strong>
          <span style="margin-left: 8px; font-weight: 600;">${tc.title}</span>
          <span style="margin-left: 8px; padding: 2px 8px; background: ${tc.type === 'positive' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(248, 81, 73, 0.2)'}; border-radius: 4px; font-size: 11px; color: ${tc.type === 'positive' ? '#10b981' : '#f85149'};">
            ${tc.type}
          </span>
          <span style="margin-left: 8px; padding: 2px 8px; background: rgba(88, 166, 255, 0.2); border-radius: 4px; font-size: 11px; color: #58a6ff;">
            ${tc.priority}
          </span>
        </div>
        <div style="font-size: 11px; color: var(--muted);">${tc.steps.length} steps</div>
      </div>
      <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">${tc.description}</div>
      <div style="font-size: 11px; color: var(--muted); margin-top: 8px;">
        <strong>Tags:</strong> ${tc.tags.join(', ')}
      </div>
      ${tc.preconditions && tc.preconditions.length > 0 ? `
        <div style="font-size: 11px; color: var(--muted); margin-top: 4px;">
          <strong>Preconditions:</strong> ${tc.preconditions.join(', ')}
        </div>
      ` : ''}
      ${tc.expectedResults && tc.expectedResults.length > 0 ? `
        <div style="font-size: 11px; color: var(--muted); margin-top: 4px;">
          <strong>Expected:</strong> ${tc.expectedResults.join(', ')}
        </div>
      ` : ''}
    </div>
  `).join('');

  // Show results section
  resultsDiv.style.display = 'block';
  resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================================
// PROJECT MANAGEMENT FUNCTIONS
// ============================================================================

/**
 * Load all projects and populate dropdown
 */
async function loadProjects() {
  try {
    const response = await fetch('/api/projects');
    const data = await response.json();
    
    if (data.success && data.projects) {
      const dropdown = document.getElementById('project-dropdown');
      if (!dropdown) return;
      
      // Clear existing options except the first one
      dropdown.innerHTML = '<option value="">-- Select Project --</option>';
      
      // Add projects to dropdown
      data.projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        dropdown.appendChild(option);
      });
      
      // Restore last selected project from localStorage
      const lastProjectId = localStorage.getItem('currentProjectId');
      if (lastProjectId && data.projects.some(p => p.id === lastProjectId)) {
        dropdown.value = lastProjectId;
        await selectProject(lastProjectId);
      }
    }
  } catch (error) {
    console.error('Error loading projects:', error);
    showToast('Failed to load projects', 'error');
  }
}

/**
 * Clear project list and reset UI
 */
function clearProjectList() {
  // Clear dropdown
  const dropdown = document.getElementById('project-dropdown');
  if (dropdown) {
    dropdown.innerHTML = '<option value="">-- Select Project --</option>';
    dropdown.value = '';
  }
  
  // Clear current project state
  state.currentProjectId = null;
  state.currentProjectName = null;
  state.steps = [];
  state.backgroundSteps = [];
  state.scenarios = [];
  localStorage.removeItem('currentProjectId');
  
  // Hide save and delete buttons
  const saveProjectBtn = document.getElementById('save-project-btn');
  if (saveProjectBtn) saveProjectBtn.style.display = 'none';
  
  const deleteProjectBtn = document.getElementById('delete-project-btn');
  if (deleteProjectBtn) deleteProjectBtn.style.display = 'none';
  
  // Update status
  updateProjectStatus('No project selected');
  
  // Clear UI
  render();
  renderCode();
  
  showToast('Project list cleared', 'success');
}

/**
 * Select a project and load its data
 */
async function selectProject(projectId) {
  if (!projectId) {
    state.currentProjectId = null;
    state.currentProjectName = null;
    localStorage.removeItem('currentProjectId');
    updateProjectStatus('No project selected');
    return;
  }
  
  try {
    const response = await fetch('/api/projects/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId })
    });
    
    const data = await response.json();
    
    if (data.success && data.project) {
      state.currentProjectId = projectId;
      state.currentProjectName = data.project.name;
      localStorage.setItem('currentProjectId', projectId);
      
      // Load project data into state
      state.steps = data.project.steps || [];
      state.backgroundSteps = data.project.backgroundSteps || [];
      state.scenarios = data.project.scenarios || [];
      state.bddOptions = {
        useScenarioOutline: false,
        examples: [],
        markAsBackground: false,
        createNewScenario: false,
        ...(data.project.bddOptions || {})
      };
      
      // Update UI fields
      const baseUrlInput = document.getElementById('baseUrl');
      if (baseUrlInput) baseUrlInput.value = data.project.baseUrl || '';
      
      const projectNameInput = document.getElementById('projectName');
      if (projectNameInput) projectNameInput.value = data.project.name || '';
      
      const frameworkSelect = document.getElementById('framework');
      if (frameworkSelect) frameworkSelect.value = data.project.framework || 'playwright-java';

      // [ZAC-FIX] FIX B — remember the framework this project was saved with so
      // zacFixes.js can warn the user before they switch dropdowns.
      state.currentProjectFramework = data.project.framework || frameworkSelect?.value || null;

      // [ZAC-FIX 2026-05-24] Force the next renderCode() to refresh
      // panels — but ONLY when this project has no saved manual code.
      // If the user previously hand-edited the step-defs / code panels,
      // those are stored in project.manualCode and restored a few
      // lines below. Force-refreshing would overwrite them. So:
      //   - no manualCode  → regenerate from framework + state.steps
      //   - has manualCode → leave it alone, user's edits win
      const mc = data.project.manualCode || null;
      const hasManualSteps = !!(mc && typeof mc.steps === 'string' && mc.steps.trim());
      const hasManualPages = !!(mc && typeof mc.pages === 'string' && mc.pages.trim());
      // forceCodeRefresh is consumed (set false) by renderCode after
      // it runs; this means each project-load either regenerates from
      // framework+steps or restores manualCode, never both.
      // If EITHER manual edit exists, preserve the loaded project's
      // saved content; otherwise regenerate.
      state.forceCodeRefresh = !(hasManualSteps || hasManualPages);

      // [ZAC-FIX] FIX E — restore pinned framework version.
      const fwVersionSelect = document.getElementById('frameworkVersion');
      if (fwVersionSelect && data.project.frameworkVersion) {
        const v = data.project.frameworkVersion;
        const opt = Array.from(fwVersionSelect.options).find(o => o.value === v);
        if (opt) fwVersionSelect.value = v;
        else {
          // Project was saved with a value not in the current list — add it
          // dynamically so the dropdown still shows the truth.
          const dyn = document.createElement('option');
          dyn.value = v;
          dyn.textContent = v + ' (saved)';
          fwVersionSelect.appendChild(dyn);
          fwVersionSelect.value = v;
        }
      }

      // [ZAC-FIX] FIX A — restore manual editor edits if present so QA's
      // hand-written code is what they see when they re-open the project.
      if (data.project.manualCode) {
        const mc = data.project.manualCode;
        const setIfPresent = (id, value) => {
          if (typeof value !== 'string') return;
          const el = document.getElementById(id);
          if (el) el.value = value;
        };
        setIfPresent('code-feature', mc.feature);
        setIfPresent('code-feature-overlay', mc.feature);
        setIfPresent('code-steps', mc.steps);
        setIfPresent('code-steps-overlay', mc.steps);
        setIfPresent('code-selenium', mc.pages);
        // [ZAC-FIX 2026-05-24] Anchor lastRenderedFramework to the loaded
        // project's framework AFTER restoring manualCode. Without this,
        // the next renderCode() sees `lastRenderedFramework` from the
        // previously-displayed project (e.g. 'playwright-java') vs the
        // newly-loaded project's framework (e.g. 'selenium-java') and
        // treats it as a framework switch — which overwrites the manual
        // code we just restored.
        const newFw = data.project.framework || frameworkSelect?.value || null;
        if (newFw) state.lastRenderedFramework = newFw;
        console.log('[ZAC-FIX] FIX A: restored manual edits for project', data.project.id, '(', (mc.editedKeys || []).join(','), ')');
      }
      
      // Show save and delete buttons
      const saveProjectBtn = document.getElementById('save-project-btn');
      if (saveProjectBtn) saveProjectBtn.style.display = 'inline-block';
      
      const deleteProjectBtn = document.getElementById('delete-project-btn');
      if (deleteProjectBtn) deleteProjectBtn.style.display = 'inline-block';
      
      // Update project status
      updateProjectStatus(`Project: ${data.project.name}`);
      
      // Render UI
      render();
      renderCode();
      
      showToast(`Project "${data.project.name}" loaded`, 'success');
      
      // Check if this is a Maven or npm project
      if (typeof checkMavenProject === 'function') {
        setTimeout(() => {
          checkMavenProject();
        }, 500);
      }
      if (typeof checkNpmProject === 'function') {
        setTimeout(() => {
          checkNpmProject();
        }, 500);
      }
    } else {
      throw new Error(data.error || 'Failed to select project');
    }
  } catch (error) {
    console.error('Error selecting project:', error);
    showToast(`Failed to select project: ${error.message}`, 'error');
  }
}

/**
 * Create a new project
 */
async function createNewProject() {
  const name = prompt('Enter project name:');
  if (!name || name.trim() === '') return;
  
  const description = prompt('Enter project description (optional):') || '';
  const baseUrl = prompt('Enter base URL (optional):') || 'http://localhost:3000';
  
  try {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        description,
        baseUrl,
        framework: 'playwright-java',
        browserType: 'chromium'
      })
    });
    
    const data = await response.json();
    
    if (data.success && data.project) {
      // Reload projects list
      await loadProjects();
      
      // Select the new project
      const dropdown = document.getElementById('project-dropdown');
      if (dropdown) {
        dropdown.value = data.project.id;
        await selectProject(data.project.id);
      }
      
      showToast(`Project "${data.project.name}" created`, 'success');
    } else {
      throw new Error(data.error || 'Failed to create project');
    }
  } catch (error) {
    console.error('Error creating project:', error);
    showToast(`Failed to create project: ${error.message}`, 'error');
  }
}

/**
 * Save current project data
 */
async function saveCurrentProject() {
  if (!state.currentProjectId) {
    showToast('No project selected', 'error');
    return;
  }

  // [ZAC-FIX] FIX A — flush any pending manual editor edits BEFORE we save
  // project.json so the next reload definitely sees them.
  try {
    if (typeof window.zacFlushManualEdits === 'function') {
      await window.zacFlushManualEdits();
    }
  } catch (e) { /* non-fatal */ }
  
  try {
    // Collect current project data from state. We include the raw editor
    // contents in `manualCode` as a belt-and-suspenders fallback in case the
    // dedicated /manual-edits endpoint hasn't been called yet.
    const codeFeature  = document.getElementById('code-feature')?.value
                      || document.getElementById('code-feature-overlay')?.value;
    const codeSteps    = document.getElementById('code-steps')?.value
                      || document.getElementById('code-steps-overlay')?.value;
    const codeSelenium = document.getElementById('code-selenium')?.value;
    const projectData = {
      id: state.currentProjectId,
      name: state.currentProjectName || document.getElementById('projectName')?.value || 'Untitled Project',
      baseUrl: document.getElementById('baseUrl')?.value || 'http://localhost:3000',
      framework: document.getElementById('framework')?.value || 'playwright-java',
      frameworkVersion: document.getElementById('frameworkVersion')?.value || 'latest-stable',
      browserType: state.config.defaultBrowser || 'chromium',
      steps: state.steps,
      backgroundSteps: state.backgroundSteps,
      scenarios: state.scenarios,
      bddOptions: state.bddOptions,
      pages: [], // Will be populated from locators
      locators: [], // Will be loaded from locator service
      testData: state.bddOptions.examples || [],
      reusableFlows: [],
      manualCode: (codeFeature || codeSteps || codeSelenium) ? {
        feature: codeFeature,
        steps:   codeSteps,
        pages:   codeSelenium,
        updatedAt: new Date().toISOString(),
      } : null,
    };
    
    const response = await fetch(`/api/projects/${state.currentProjectId}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(projectData)
    });
    
    const data = await response.json();
    
    if (data.success) {
      updateProjectStatus(`Project saved: ${new Date().toLocaleTimeString()}`);
      showToast('Project saved successfully', 'success');
    } else {
      throw new Error(data.error || 'Failed to save project');
    }
  } catch (error) {
    console.error('Error saving project:', error);
    showToast(`Failed to save project: ${error.message}`, 'error');
  }
}

/**
 * Auto-save project (debounced)
 */
function autoSaveProject() {
  if (!state.currentProjectId || !state.autoSaveEnabled) return;
  
  // Clear existing timeout
  if (state.autoSaveTimeout) {
    clearTimeout(state.autoSaveTimeout);
  }
  
  // Set new timeout (save after 2 seconds of inactivity)
  state.autoSaveTimeout = setTimeout(() => {
    saveCurrentProject().catch(err => {
      console.error('Auto-save failed:', err);
    });
  }, 2000);
}

/**
 * Update project status text
 */
function updateProjectStatus(text) {
  const statusEl = document.getElementById('project-status');
  if (statusEl) {
    statusEl.textContent = text;
  }
}

/**
 * Delete current project
 */
async function deleteCurrentProject() {
  if (!state.currentProjectId) {
    showToast('No project selected', 'error');
    return;
  }
  
  const projectName = state.currentProjectName || state.currentProjectId;
  const confirmMessage = `Are you sure you want to delete project "${projectName}"?\n\nThis action cannot be undone and will delete all project data including:\n- Steps\n- Scenarios\n- Features\n- Locators\n- Test Data`;
  
  if (!confirm(confirmMessage)) {
    return;
  }
  
  // Double confirmation for safety
  if (!confirm(`⚠️ FINAL WARNING: This will permanently delete "${projectName}".\n\nType the project name to confirm: "${projectName}"`)) {
    return;
  }
  
  try {
    console.log('[Delete Project] Attempting to delete project:', state.currentProjectId);
    const response = await fetch(`/api/projects/${encodeURIComponent(state.currentProjectId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    });
    
    console.log('[Delete Project] Response status:', response.status);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}: ${response.statusText}` }));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('[Delete Project] Response data:', data);
    
    if (data.success) {
      showToast(`Project "${projectName}" deleted successfully`, 'success');
      
      // Clear current project
      state.currentProjectId = null;
      state.currentProjectName = null;
      state.steps = [];
      state.backgroundSteps = [];
      state.scenarios = [];
      localStorage.removeItem('currentProjectId');
      
      // Update UI
      const dropdown = document.getElementById('project-dropdown');
      if (dropdown) {
        dropdown.value = '';
      }
      
      // Hide save and delete buttons
      const saveProjectBtn = document.getElementById('save-project-btn');
      if (saveProjectBtn) saveProjectBtn.style.display = 'none';
      
      const deleteProjectBtn = document.getElementById('delete-project-btn');
      if (deleteProjectBtn) deleteProjectBtn.style.display = 'none';
      
      updateProjectStatus('No project selected');
      
      // Reload projects list
      await loadProjects();
      
      // Clear UI
      render();
      renderCode();
    } else {
      throw new Error(data.error || 'Failed to delete project');
    }
  } catch (error) {
    console.error('Error deleting project:', error);
    showToast(`Failed to delete project: ${error.message}`, 'error');
  }
}

/**
 * Populate framework <select> elements from /api/frameworks so the UI stays
 * in sync with the backend registry. Falls back silently to whatever static
 * options are already in the markup if the call fails (offline / boot order).
 */
async function loadFrameworkRegistry() {
  try {
    const res = await fetch('/api/frameworks');
    if (!res.ok) return;
    const data = await res.json();
    const list = Array.isArray(data && data.frameworks) ? data.frameworks : [];
    const ids = ['framework', 'stepDefsFramework'];
    for (const selectId of ids) {
      const sel = document.getElementById(selectId);
      if (!sel) continue;
      const previous = sel.value;
      const visible = list.filter((f) => f.uiVisible !== false);
      if (visible.length === 0) continue;
      sel.innerHTML = visible
        .map((f) => `<option value="${f.id}">${f.label || f.id}</option>`) 
        .join('');
      if (visible.some((f) => f.id === previous)) sel.value = previous;
    }
  } catch (err) {
    console.warn('[FrameworkRegistry] could not load /api/frameworks:', err && err.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  loadFrameworkRegistry();

  // [ZAC-FIX 2026-05-24] Wire framework dropdown to re-render code panels.
  // Without this, switching from "Selenium WebDriver + Java + Cucumber"
  // to "Playwright + Java + Cucumber" left the previous framework's code
  // stuck in the Generated Code panel because renderCode() preserves
  // user edits when not recording.
  const frameworkSel = document.getElementById('framework');
  if (frameworkSel) {
    frameworkSel.addEventListener('change', (e) => {
      const newFw = e.currentTarget.value;
      // [ZAC-FIX 2026-05-24] Synthetic events (zacFixes.js applying the
      // Settings default, project-load handlers programmatically setting
      // the framework) carry isTrusted=false. Don't prompt the user in
      // those paths — just refresh the panels silently. The confirm is
      // only useful when a HUMAN clicks the dropdown.
      const isUserEvent = e.isTrusted === true;
      const seleniumEl = document.getElementById('code-selenium');
      const stepsEl = document.getElementById('code-steps');
      const hasUserContent = isUserEvent && (
        (seleniumEl && seleniumEl.value && seleniumEl.value.trim().length > 50) ||
        (stepsEl && stepsEl.value && stepsEl.value.trim().length > 50)
      );
      if (hasUserContent) {
        const ok = window.confirm(
          'Switching framework will regenerate the Selenium/Playwright code ' +
          'and step definitions for "' + newFw + '". Any unsaved manual ' +
          'edits in those panels will be replaced.\n\n' +
          'Continue?'
        );
        if (!ok) {
          // Roll back the dropdown to the previous framework so the
          // panels and the dropdown stay in sync.
          if (state.lastRenderedFramework) {
            e.currentTarget.value = state.lastRenderedFramework;
          }
          return;
        }
      }
      // Force renderCode() to overwrite (frameworkChanged will be true).
      try { if (typeof renderCode === 'function') renderCode(); } catch (_) {}
    });
  }
  // Also wire the step-defs sub-panel framework dropdown if present.
  const stepDefsFwSel = document.getElementById('stepDefsFramework');
  if (stepDefsFwSel) {
    stepDefsFwSel.addEventListener('change', () => {
      try { if (typeof renderCode === 'function') renderCode(); } catch (_) {}
    });
  }

  // T2.5 — viewport preset: show/hide the custom width/height row when
  // the user picks "Custom…", and wire its initial state on load.
  const vpSel = document.getElementById('viewportPreset');
  const vpRow = document.getElementById('viewportCustomRow');
  if (vpSel && vpRow) {
    const sync = () => { vpRow.style.display = (vpSel.value === 'custom') ? 'flex' : 'none'; };
    vpSel.addEventListener('change', sync);
    sync();
  }

  // Load projects on startup
  loadProjects();
  
  // Project management event listeners
  const projectDropdown = document.getElementById('project-dropdown');
  if (projectDropdown) {
    projectDropdown.addEventListener('change', async (e) => {
      await selectProject(e.target.value);
    });
  }
  
  const newProjectBtn = document.getElementById('new-project-btn');
  if (newProjectBtn) {
    newProjectBtn.addEventListener('click', createNewProject);
  }
  
  const saveProjectBtn = document.getElementById('save-project-btn');
  if (saveProjectBtn) {
    saveProjectBtn.addEventListener('click', saveCurrentProject);
  }
  
  const deleteProjectBtn = document.getElementById('delete-project-btn');
  if (deleteProjectBtn) {
    deleteProjectBtn.addEventListener('click', deleteCurrentProject);
  }
  
  const clearProjectBtn = document.getElementById('clear-project-btn');
  if (clearProjectBtn) {
    clearProjectBtn.addEventListener('click', clearProjectList);
  }
  
  // Load saved state from localStorage
  const loaded = loadStateFromLocalStorage();
  if (loaded && state.steps.length > 0) {
    console.log(`[State] Restored ${state.steps.length} steps from previous session`);
    // Restore form fields if project name exists
    if (state.currentProjectName) {
      const projectNameEl = document.getElementById('projectName');
      if (projectNameEl) projectNameEl.value = state.currentProjectName;
    }
    // Restore BDD options if they exist
    if (state.bddOptions.useScenarioOutline) {
      const useScenarioOutlineEl = document.getElementById('useScenarioOutline');
      if (useScenarioOutlineEl) {
        useScenarioOutlineEl.checked = true;
        const examplesContainer = document.getElementById('examplesContainer');
        if (examplesContainer) examplesContainer.style.display = 'block';
      }
    }
    // Restore other BDD checkboxes
    if (state.bddOptions.markAsBackground) {
      const markAsBackgroundEl = document.getElementById('markAsBackground');
      if (markAsBackgroundEl) markAsBackgroundEl.checked = true;
    }
    if (state.bddOptions.createNewScenario) {
      const createNewScenarioEl = document.getElementById('createNewScenario');
      if (createNewScenarioEl) createNewScenarioEl.checked = true;
    }
    // Restore examples table - prefer raw text if available (preserves user formatting)
    const examplesTableEl = document.getElementById('examplesTable');
    if (examplesTableEl) {
      if (state.bddOptions.examplesRawText) {
        // Restore raw text (preserves user's exact formatting)
        examplesTableEl.value = state.bddOptions.examplesRawText;
      } else if (state.bddOptions.examples && state.bddOptions.examples.length > 0) {
        // Fallback to formatted JSON from parsed examples
        examplesTableEl.value = JSON.stringify(state.bddOptions.examples, null, 2);
      }
    }
    // Render the restored steps
    render();
  }

  // Recording controls - with null checks
  const startRecordingBtn = document.getElementById('startRecording');
  const stopRecordingBtn = document.getElementById('stopRecording');
  const pauseRecordingBtn = document.getElementById('pauseRecording');
  
  if (startRecordingBtn) {
    startRecordingBtn.onclick = startRecording;
  }
  if (stopRecordingBtn) {
    stopRecordingBtn.onclick = stopRecording;
  }
  
  // Step definitions generation buttons - with null checks
  const generateStepDefsBtn = document.getElementById('generateStepDefsBtn');
  const generateStepDefsPromptBtn = document.getElementById('generateStepDefsPromptBtn');
  
  if (generateStepDefsBtn) {
    generateStepDefsBtn.addEventListener('click', generateStepDefinitions);
  }
  if (generateStepDefsPromptBtn) {
    generateStepDefsPromptBtn.addEventListener('click', generateStepDefinitions);
  }
  
  // Pause recording - with null check
  if (pauseRecordingBtn) {
    pauseRecordingBtn.onclick = async () => {
      if (!state.recording.active || !state.recording.sessionId) return;
      
      if (!state.recording.paused) {
        state.recording.paused = true;
        pauseRecordingBtn.textContent = '▶ Resume';
        const recordingStatus = document.getElementById('recordingStatus');
        if (recordingStatus) recordingStatus.textContent = 'Recording paused';
      } else {
        state.recording.paused = false;
        pauseRecordingBtn.textContent = '⏸ Pause';
        const recordingStatus = document.getElementById('recordingStatus');
        if (recordingStatus) recordingStatus.textContent = 'Recording...';
      }
    };
  }

  // Generate Test Cases button
  const generateTestCasesBtn = document.getElementById('generateTestCases');
  if (generateTestCasesBtn) {
    generateTestCasesBtn.onclick = async () => {
      if (state.steps.length === 0) {
        alert('Please record some steps first before generating test cases.');
        return;
      }

      try {
        generateTestCasesBtn.disabled = true;
        generateTestCasesBtn.textContent = '⏳ Generating...';

        const featureName = document.getElementById('featureName')?.value || 'Generated Test Cases';
        
        const resp = await fetch('/api/generate-test-cases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            steps: state.steps,
            options: {
              featureName,
              groupByFlow: true,
              includeNegativeCases: true,
              minStepsPerTestCase: 2
            }
          })
        });

        if (!resp.ok) {
          const error = await resp.json();
          throw new Error(error.error || 'Failed to generate test cases');
        }

        const data = await resp.json();
        
        // Display results
        displayTestCasesResults(data);
        
      } catch (error) {
        console.error('Error generating test cases:', error);
        alert(`Error: ${error.message}`);
      } finally {
        generateTestCasesBtn.disabled = false;
        generateTestCasesBtn.textContent = '✨ Generate Test Cases';
      }
    };
  }

  // Copy Test Cases Feature button
  const copyTestCasesFeatureBtn = document.getElementById('copyTestCasesFeature');
  if (copyTestCasesFeatureBtn) {
    copyTestCasesFeatureBtn.onclick = () => {
      const resultsDiv = document.getElementById('testCasesResults');
      if (resultsDiv && resultsDiv.dataset.featureFile) {
        navigator.clipboard.writeText(resultsDiv.dataset.featureFile);
        copyTestCasesFeatureBtn.textContent = '✅ Copied!';
        setTimeout(() => {
          copyTestCasesFeatureBtn.textContent = '📋 Copy Feature File';
        }, 2000);
      }
    };
  }

  // Apply Test Cases Feature button
  const applyTestCasesFeatureBtn = document.getElementById('applyTestCasesFeature');
  if (applyTestCasesFeatureBtn) {
    applyTestCasesFeatureBtn.onclick = () => {
      const resultsDiv = document.getElementById('testCasesResults');
      if (resultsDiv && resultsDiv.dataset.featureFile) {
        const featEl = document.getElementById('code-feature');
        if (featEl) {
          featEl.value = resultsDiv.dataset.featureFile;
          applyTestCasesFeatureBtn.textContent = '✅ Applied!';
          setTimeout(() => {
            applyTestCasesFeatureBtn.textContent = '✅ Apply to Feature File';
          }, 2000);
        }
      }
    };
  }

  // Show/hide assertion fields based on step kind - with null check
  const stepKindEl = document.getElementById('stepKind');
  if (stepKindEl) {
    stepKindEl.onchange = () => {
      const kind = stepKindEl.value;
    const isAssertion = kind.startsWith('assert');
      const expectedValueEl = document.getElementById('expectedValue');
      const assertionTypeEl = document.getElementById('assertionType');
      const methodEl = document.getElementById('method');
      
      if (expectedValueEl) expectedValueEl.style.display = isAssertion ? 'block' : 'none';
      if (assertionTypeEl) assertionTypeEl.style.display = isAssertion ? 'block' : 'none';
      if (methodEl) methodEl.style.display = kind === 'apiCall' ? 'block' : 'none';
    };
  }

  // Wire up overlay buttons
  const stopRecordingOverlayBtn = document.getElementById('stopRecordingOverlay');
  if (stopRecordingOverlayBtn) {
    stopRecordingOverlayBtn.onclick = () => stopRecording();
  }
  
  const pauseRecordingOverlayBtn = document.getElementById('pauseRecordingOverlay');
  if (pauseRecordingOverlayBtn) {
    pauseRecordingOverlayBtn.onclick = () => {
      if (state.recording.paused) {
        state.recording.paused = false;
        pauseRecordingOverlayBtn.textContent = '⏸ Pause';
        document.getElementById('pauseRecording').textContent = '⏸ Pause';
      } else {
        state.recording.paused = true;
        pauseRecordingOverlayBtn.textContent = '▶ Resume';
        document.getElementById('pauseRecording').textContent = '▶ Resume';
      }
    };
  }
  
  const revertChangesBtn = document.getElementById('revertChangesBtn');
  if (revertChangesBtn) {
    revertChangesBtn.onclick = () => revertToPreviousState();
  }
  
  // Wire up overlay copy buttons
  const copyFeatureBtnOverlay = document.getElementById('copyFeatureBtnOverlay');
  if (copyFeatureBtnOverlay) {
    copyFeatureBtnOverlay.onclick = () => {
      const featEl = document.getElementById('code-feature-overlay');
      if (featEl && featEl.value) {
        featEl.select();
        document.execCommand('copy');
        showToast('Feature file copied to clipboard!', 'success');
      }
    };
  }
  
  const copyStepsBtnOverlay = document.getElementById('copyStepsBtnOverlay');
  if (copyStepsBtnOverlay) {
    copyStepsBtnOverlay.onclick = () => {
      const stepsEl = document.getElementById('code-steps-overlay');
      if (stepsEl && stepsEl.value) {
        stepsEl.select();
        document.execCommand('copy');
        showToast('Step definitions copied to clipboard!', 'success');
      }
    };
  }

  // Add Step button - with null check
  const addStepBtn = document.getElementById('addStep');
  if (addStepBtn) {
    addStepBtn.onclick = () => {
    const kind = document.getElementById('stepKind').value;
    const selector = document.getElementById('selector').value;
    const value = document.getElementById('value').value;
    const expectedValue = document.getElementById('expectedValue').value;
    const assertionType = document.getElementById('assertionType').value;
    const method = document.getElementById('method').value;
    const pageName = document.getElementById('pageName').value.trim();
    const elementName = document.getElementById('elementName').value.trim();
    const step = { kind };
    
    // Add locator metadata if provided
    if (pageName) step.pageName = pageName;
    if (elementName) step.elementName = elementName;
    
    switch(kind) {
      case 'navigate':
        step.url = value || selector;
        break;
      case 'click':
        step.selector = selector || value;
        break;
      case 'type':
        step.selector = selector;
        step.value = value;
        break;
      case 'assertText':
        step.selector = selector;
        step.expectedValue = expectedValue || value;
        step.assertionType = assertionType;
        break;
      case 'assertVisible':
        step.selector = selector || value;
        break;
      case 'assertNotVisible':
        step.selector = selector || value;
        break;
      case 'assertEnabled':
        step.selector = selector || value;
        break;
      case 'assertDisabled':
        step.selector = selector || value;
        break;
      case 'assertChecked':
        step.selector = selector || value;
        break;
      case 'assertNotChecked':
        step.selector = selector || value;
        break;
      case 'assertAttribute':
        step.selector = selector;
        step.value = value; // attribute name
        step.expectedValue = expectedValue;
        step.assertionType = assertionType;
        break;
      case 'assertCount':
        step.selector = selector;
        step.expectedValue = expectedValue || value;
        step.assertionType = assertionType;
        break;
      case 'assertValue':
        step.selector = selector;
        step.expectedValue = expectedValue || value;
        step.assertionType = assertionType;
        break;
      case 'waitFor':
        step.ms = Number(value) || 500;
        break;
      case 'waitForSelector':
        step.selector = selector || value;
        break;
      case 'screenshot':
        step.filename = value || `screenshot-${Date.now()}.png`;
        break;
      case 'apiCall':
        step.method = method;
        step.url = value || selector;
        break;
    }
    
    // Save snapshot before making changes
    if (!state.recording.active) {
      saveStateSnapshot();
    }
    
    state.steps.push(step);
    // Mark that steps changed after recording
    if (!state.recording.active) {
      state.stepsChangedAfterRecording = true;
    }
    saveStateToLocalStorage();
    autoSaveProject(); // Auto-save project
    render();
    
    // Clear form
      const selectorEl = document.getElementById('selector');
      const valueEl = document.getElementById('value');
      const expectedValueEl = document.getElementById('expectedValue');
      const pageNameEl = document.getElementById('pageName');
      const elementNameEl = document.getElementById('elementName');
      
      if (selectorEl) selectorEl.value = '';
      if (valueEl) valueEl.value = '';
      if (expectedValueEl) expectedValueEl.value = '';
      if (pageNameEl) pageNameEl.value = '';
      if (elementNameEl) elementNameEl.value = '';
    };
  }
  
  // Locator Repository Functions
  async function loadLocators() {
    if (!state.currentProjectId) {
      showToast('Please select a project first', 'error');
      return;
    }
    
    try {
      const response = await fetch(`/api/projects/${state.currentProjectId}/locators`);
      const data = await response.json();
      
      if (data.success && data.locators) {
        state.locators = data.locators;
        renderLocatorList();
        showToast(`Loaded ${data.locators.length} locator(s)`, 'success');
      }
    } catch (error) {
      console.error('Error loading locators:', error);
      showToast('Failed to load locators', 'error');
    }
  }
  
  function renderLocatorList() {
    const locatorList = document.getElementById('locatorList');
    if (!locatorList) return;
    
    if (!state.locators || state.locators.length === 0) {
      locatorList.innerHTML = '<p style="color: var(--muted); font-size: 13px; text-align: center; padding: 20px;">No locators saved yet. Save locators from steps to build your repository.</p>';
      return;
    }
    
    locatorList.innerHTML = state.locators.map((loc, idx) => `
      <div style="padding: 8px; margin-bottom: 8px; background: rgba(13, 17, 23, 0.6); border-radius: 6px; border: 1px solid var(--border); cursor: pointer;" 
           onclick="selectLocator(${idx})" 
           id="locator-${idx}">
        <div style="font-weight: 600; color: var(--text); font-size: 13px;">${loc.pageName || 'Unknown'}.${loc.elementName || 'Unknown'}</div>
        <div style="font-size: 11px; color: var(--muted); margin-top: 4px;">${loc.locatorType || 'css'}: ${(loc.locatorValue || '').substring(0, 50)}${(loc.locatorValue || '').length > 50 ? '...' : ''}</div>
      </div>
    `).join('');
  }
  
  window.selectLocator = (idx) => {
    // Remove previous selection
    document.querySelectorAll('[id^="locator-"]').forEach(el => {
      el.style.border = '1px solid var(--border)';
    });
    
    // Highlight selected
    const selectedEl = document.getElementById(`locator-${idx}`);
    if (selectedEl) {
      selectedEl.style.border = '2px solid var(--accent)';
      state.selectedLocatorIndex = idx;
    }
  };
  
  async function saveLocatorFromForm() {
    if (!state.currentProjectId) {
      showToast('Please select a project first', 'error');
      return;
    }
    
    const pageName = document.getElementById('pageName').value.trim();
    const elementName = document.getElementById('elementName').value.trim();
    const selector = document.getElementById('selector').value.trim();
    
    if (!pageName || !elementName || !selector) {
      showToast('Please fill in Page Name, Element Name, and Selector', 'error');
      return;
    }
    
    try {
      const response = await fetch(`/api/projects/${state.currentProjectId}/locators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageName,
          elementName,
          locatorValue: selector,
          locatorType: inferLocatorType(selector)
        })
      });
      
      const data = await response.json();
      if (data.success) {
        showToast('Locator saved to repository!', 'success');
        await loadLocators();
      } else {
        throw new Error(data.error || 'Failed to save locator');
      }
    } catch (error) {
      console.error('Error saving locator:', error);
      showToast('Failed to save locator', 'error');
    }
  }
  
  function inferLocatorType(selector) {
    if (!selector) return 'css';
    if (selector.startsWith('//') || selector.startsWith('(//')) return 'xpath';
    if (selector.startsWith('#')) return 'id';
    if (selector.includes('data-testid')) return 'testId';
    if (selector.startsWith('role=') || selector.startsWith('getByRole')) return 'role';
    if (selector.startsWith('text=') || selector.startsWith('getByText')) return 'text';
    if (selector.startsWith('[name=')) return 'name';
    return 'css';
  }
  
  function loadLocatorToForm() {
    if (state.selectedLocatorIndex === undefined || !state.locators || !state.locators[state.selectedLocatorIndex]) {
      showToast('Please select a locator first', 'error');
      return;
    }
    
    const loc = state.locators[state.selectedLocatorIndex];
    document.getElementById('pageName').value = loc.pageName || '';
    document.getElementById('elementName').value = loc.elementName || '';
    document.getElementById('selector').value = loc.locatorValue || '';
    showToast('Locator loaded to form', 'success');
  }
  
  async function deleteSelectedLocator() {
    if (state.selectedLocatorIndex === undefined || !state.locators || !state.locators[state.selectedLocatorIndex]) {
      showToast('Please select a locator first', 'error');
      return;
    }
    
    if (!confirm('Delete this locator from repository?')) return;
    
    const loc = state.locators[state.selectedLocatorIndex];
    if (!state.currentProjectId || !loc.id) {
      showToast('Cannot delete: missing project or locator ID', 'error');
      return;
    }
    
    try {
      const response = await fetch(`/api/projects/${state.currentProjectId}/locators/${loc.id}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      if (data.success) {
        showToast('Locator deleted', 'success');
        state.selectedLocatorIndex = undefined;
        await loadLocators();
      } else {
        throw new Error(data.error || 'Failed to delete locator');
      }
    } catch (error) {
      console.error('Error deleting locator:', error);
      showToast('Failed to delete locator', 'error');
    }
  }
  
  // Initialize locators array in state
  if (!state.locators) {
    state.locators = [];
  }
  
  // Locator Repository UI Handlers
  const saveLocatorBtn = document.getElementById('saveLocator');
  if (saveLocatorBtn) {
    saveLocatorBtn.onclick = saveLocatorFromForm;
  }
  
  const toggleLocatorPanelBtn = document.getElementById('toggleLocatorPanel');
  const locatorPanel = document.getElementById('locatorRepositoryPanel');
  if (toggleLocatorPanelBtn && locatorPanel) {
    toggleLocatorPanelBtn.onclick = () => {
      if (locatorPanel.style.display === 'none') {
        locatorPanel.style.display = 'block';
        toggleLocatorPanelBtn.textContent = 'Hide';
        if (state.currentProjectId) {
          loadLocators();
        }
      } else {
        locatorPanel.style.display = 'none';
        toggleLocatorPanelBtn.textContent = 'Show Locator Repository';
      }
    };
  }
  
  const loadLocatorBtn = document.getElementById('loadLocator');
  if (loadLocatorBtn) {
    loadLocatorBtn.onclick = loadLocatorToForm;
  }
  
  const deleteLocatorBtn = document.getElementById('deleteLocator');
  if (deleteLocatorBtn) {
    deleteLocatorBtn.onclick = deleteSelectedLocator;
  }
  
  // Auto-load locators when project is selected
  const originalSelectProject = window.selectProject;
  if (originalSelectProject) {
    window.selectProject = async (projectId) => {
      await originalSelectProject(projectId);
      if (locatorPanel && locatorPanel.style.display !== 'none') {
        await loadLocators();
      }
      // Also load flows and test data sets
      await loadFlows();
      await loadTestDataSets();
    };
  }
  
  // ============================================================================
  // REUSABLE FLOWS MANAGEMENT
  // ============================================================================
  
  async function loadFlows() {
    if (!state.currentProjectId) return;
    
    try {
      const response = await fetch(`/api/projects/${state.currentProjectId}/flows`);
      const data = await response.json();
      
      if (data.success && data.flows) {
        state.flows = data.flows;
        renderFlowsList();
      }
    } catch (error) {
      console.error('Error loading flows:', error);
      // Flows might not exist yet, that's okay
      state.flows = [];
    }
  }
  
  function renderFlowsList() {
    const flowsList = document.getElementById('flowsList');
    if (!flowsList) return;
    
    if (!state.flows || state.flows.length === 0) {
      flowsList.innerHTML = '<p style="color: var(--muted); font-size: 13px; text-align: center; padding: 20px;">No flows saved yet. Select steps and click "Save Selected Steps as Flow" to create one.</p>';
      return;
    }
    
    flowsList.innerHTML = state.flows.map((flow, idx) => `
      <div style="padding: 8px; margin-bottom: 8px; background: rgba(13, 17, 23, 0.6); border-radius: 6px; border: 1px solid var(--border); cursor: pointer;" 
           onclick="selectFlow(${idx})" 
           id="flow-${idx}">
        <div style="font-weight: 600; color: var(--text); font-size: 13px;">${flow.name || 'Unnamed Flow'}</div>
        <div style="font-size: 11px; color: var(--muted); margin-top: 4px;">${flow.steps ? flow.steps.length : 0} step(s)</div>
      </div>
    `).join('');
  }
  
  window.selectFlow = (idx) => {
    document.querySelectorAll('[id^="flow-"]').forEach(el => {
      el.style.border = '1px solid var(--border)';
    });
    
    const selectedEl = document.getElementById(`flow-${idx}`);
    if (selectedEl) {
      selectedEl.style.border = '2px solid var(--accent)';
      state.selectedFlowIndex = idx;
    }
  };
  
  async function saveCurrentStepsAsFlow() {
    if (!state.currentProjectId) {
      showToast('Please select a project first', 'error');
      return;
    }
    
    if (state.steps.length === 0) {
      showToast('No steps to save. Please record or add some steps first.', 'error');
      return;
    }
    
    const flowName = prompt('Enter a name for this flow:', `Flow-${Date.now()}`);
    if (!flowName) return;
    
    try {
      const response = await fetch(`/api/projects/${state.currentProjectId}/flows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: flowName,
          steps: state.steps.map(s => JSON.parse(JSON.stringify(s)))
        })
      });
      
      const data = await response.json();
      if (data.success) {
        showToast('Flow saved successfully!', 'success');
        await loadFlows();
      } else {
        throw new Error(data.error || 'Failed to save flow');
      }
    } catch (error) {
      console.error('Error saving flow:', error);
      showToast('Failed to save flow', 'error');
    }
  }
  
  async function insertSelectedFlow() {
    if (state.selectedFlowIndex === undefined || !state.flows || !state.flows[state.selectedFlowIndex]) {
      showToast('Please select a flow first', 'error');
      return;
    }
    
    const flow = state.flows[state.selectedFlowIndex];
    if (!flow.steps || flow.steps.length === 0) {
      showToast('Selected flow has no steps', 'error');
      return;
    }
    
    // Insert flow steps at the end
    const stepsToInsert = flow.steps.map(s => JSON.parse(JSON.stringify(s)));
    state.steps.push(...stepsToInsert);
    
    state.stepsChangedAfterRecording = true;
    saveStateToLocalStorage();
    autoSaveProject();
    render();
    
    showToast(`Inserted ${stepsToInsert.length} step(s) from flow "${flow.name}"`, 'success');
  }
  
  async function deleteSelectedFlow() {
    if (state.selectedFlowIndex === undefined || !state.flows || !state.flows[state.selectedFlowIndex]) {
      showToast('Please select a flow first', 'error');
      return;
    }
    
    if (!confirm('Delete this flow?')) return;
    
    const flow = state.flows[state.selectedFlowIndex];
    if (!state.currentProjectId || !flow.id) {
      showToast('Cannot delete: missing project or flow ID', 'error');
      return;
    }
    
    try {
      const response = await fetch(`/api/projects/${state.currentProjectId}/flows/${flow.id}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      if (data.success) {
        showToast('Flow deleted', 'success');
        state.selectedFlowIndex = undefined;
        await loadFlows();
      } else {
        throw new Error(data.error || 'Failed to delete flow');
      }
    } catch (error) {
      console.error('Error deleting flow:', error);
      showToast('Failed to delete flow', 'error');
    }
  }
  
  // ============================================================================
  // TEST DATA SETS MANAGEMENT
  // ============================================================================
  
  async function loadTestDataSets() {
    if (!state.currentProjectId) return;
    
    try {
      const response = await fetch(`/api/projects/${state.currentProjectId}/test-data`);
      const data = await response.json();
      
      if (data.success && data.testDataSets) {
        state.testDataSets = data.testDataSets;
      }
    } catch (error) {
      console.error('Error loading test data sets:', error);
      state.testDataSets = [];
    }
  }
  
  async function saveCurrentTestDataSet() {
    if (!state.currentProjectId) {
      showToast('Please select a project first', 'error');
      return;
    }
    
    const examplesTable = document.getElementById('examplesTable');
    if (!examplesTable || !examplesTable.value.trim()) {
      showToast('Please enter test data in the Examples Table first', 'error');
      return;
    }
    
    try {
      const examples = JSON.parse(examplesTable.value);
      if (!Array.isArray(examples) || examples.length === 0) {
        throw new Error('Examples must be a non-empty array');
      }
      
      const dataSetName = prompt('Enter a name for this test data set:', `TestData-${Date.now()}`);
      if (!dataSetName) return;
      
      const response = await fetch(`/api/projects/${state.currentProjectId}/test-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: dataSetName,
          examples: examples
        })
      });
      
      const data = await response.json();
      if (data.success) {
        showToast('Test data set saved successfully!', 'success');
        await loadTestDataSets();
      } else {
        throw new Error(data.error || 'Failed to save test data set');
      }
    } catch (error) {
      console.error('Error saving test data set:', error);
      showToast(`Failed to save test data set: ${error.message}`, 'error');
    }
  }
  
  async function loadTestDataSet() {
    if (!state.testDataSets || state.testDataSets.length === 0) {
      showToast('No test data sets saved. Save one first.', 'error');
      return;
    }
    
    const dataSetNames = state.testDataSets.map((ds, idx) => `${idx + 1}. ${ds.name}`).join('\n');
    const selection = prompt(`Select a test data set (enter number):\n\n${dataSetNames}`);
    if (!selection) return;
    
    const idx = parseInt(selection) - 1;
    if (idx < 0 || idx >= state.testDataSets.length) {
      showToast('Invalid selection', 'error');
      return;
    }
    
    const dataSet = state.testDataSets[idx];
    const examplesTable = document.getElementById('examplesTable');
    if (examplesTable) {
      examplesTable.value = JSON.stringify(dataSet.examples, null, 2);
      state.bddOptions.examples = dataSet.examples;
      state.bddOptions.examplesRawText = examplesTable.value;
      saveStateToLocalStorage();
      render();
      showToast(`Loaded test data set: ${dataSet.name}`, 'success');
    }
  }
  
  // Flows UI Handlers
  const saveAsFlowBtn = document.getElementById('saveAsFlow');
  if (saveAsFlowBtn) {
    saveAsFlowBtn.onclick = saveCurrentStepsAsFlow;
  }
  
  const insertFlowBtn = document.getElementById('insertFlow');
  const flowsPanel = document.getElementById('flowsPanel');
  if (insertFlowBtn && flowsPanel) {
    insertFlowBtn.onclick = () => {
      if (flowsPanel.style.display === 'none') {
        flowsPanel.style.display = 'block';
        if (state.currentProjectId) {
          loadFlows();
        }
      } else {
        flowsPanel.style.display = 'none';
      }
    };
  }
  
  const toggleFlowsPanelBtn = document.getElementById('toggleFlowsPanel');
  if (toggleFlowsPanelBtn && flowsPanel) {
    toggleFlowsPanelBtn.onclick = () => {
      flowsPanel.style.display = flowsPanel.style.display === 'none' ? 'block' : 'none';
      toggleFlowsPanelBtn.textContent = flowsPanel.style.display === 'none' ? 'Show Flows' : 'Hide';
      if (flowsPanel.style.display !== 'none' && state.currentProjectId) {
        loadFlows();
      }
    };
  }
  
  const insertSelectedFlowBtn = document.getElementById('insertSelectedFlow');
  if (insertSelectedFlowBtn) {
    insertSelectedFlowBtn.onclick = insertSelectedFlow;
  }
  
  const deleteSelectedFlowBtn = document.getElementById('deleteSelectedFlow');
  if (deleteSelectedFlowBtn) {
    deleteSelectedFlowBtn.onclick = deleteSelectedFlow;
  }
  
  // Test Data Sets UI Handlers
  const saveTestDataSetBtn = document.getElementById('saveTestDataSet');
  if (saveTestDataSetBtn) {
    saveTestDataSetBtn.onclick = saveCurrentTestDataSet;
  }
  
  const loadTestDataSetBtn = document.getElementById('loadTestDataSet');
  if (loadTestDataSetBtn) {
    loadTestDataSetBtn.onclick = loadTestDataSet;
  }
  
  // Export steps - with null check
  const exportStepsBtn = document.getElementById('exportSteps');
  if (exportStepsBtn) {
    exportStepsBtn.onclick = () => {
    const json = JSON.stringify(state.steps, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'steps.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  }
  
  // Clear Steps button - with null check
  const clearStepsBtn = document.getElementById('clearSteps');
  if (clearStepsBtn) {
    clearStepsBtn.onclick = () => {
      if (confirm('Are you sure you want to clear ALL steps, scenarios, and form data? This cannot be undone.')) {
      // Clear all state
      state.steps = [];
      state.backgroundSteps = [];
      state.scenarios = [];
      state.currentScenarioSteps = [];
      state.currentProjectName = null;
      state.currentStepsFilePath = null;
      state.stepDefinitionMap.clear();
      // Mark that steps changed after recording
      if (!state.recording.active) {
        state.stepsChangedAfterRecording = true;
      }
      
      // Clear localStorage
      clearStateFromLocalStorage();
      
      // Reset BDD options
      state.bddOptions = {
        useScenarioOutline: false,
        examples: [],
        markAsBackground: false,
        createNewScenario: false
      };
      
      // Clear all form fields
      const projectNameEl = document.getElementById('projectName');
      const baseUrlEl = document.getElementById('baseUrl');
      const featureTitleEl = document.getElementById('featureTitle');
      const featureNameEl = document.getElementById('featureName');
      const tagsEl = document.getElementById('tags');
      const useScenarioOutlineEl = document.getElementById('useScenarioOutline');
      const examplesTableEl = document.getElementById('examplesTable');
      const markAsBackgroundEl = document.getElementById('markAsBackground');
      const createNewScenarioEl = document.getElementById('createNewScenario');
      const selectorEl = document.getElementById('selector');
      const valueEl = document.getElementById('value');
      const expectedValueEl = document.getElementById('expectedValue');
      
      if (projectNameEl) projectNameEl.value = '';
      if (baseUrlEl) baseUrlEl.value = state.config.baseUrl || '';
      if (featureTitleEl) featureTitleEl.value = '';
      if (featureNameEl) featureNameEl.value = '';
      if (tagsEl) tagsEl.value = '';
      if (useScenarioOutlineEl) {
        useScenarioOutlineEl.checked = false;
        const examplesContainer = document.getElementById('examplesContainer');
        if (examplesContainer) examplesContainer.style.display = 'none';
      }
      if (examplesTableEl) examplesTableEl.value = '';
      if (markAsBackgroundEl) markAsBackgroundEl.checked = false;
      if (createNewScenarioEl) createNewScenarioEl.checked = false;
      if (selectorEl) selectorEl.value = '';
      if (valueEl) valueEl.value = '';
      if (expectedValueEl) expectedValueEl.value = '';
      
      // Clear code panels
      const codeStepsEl = document.getElementById('code-steps');
      const codeFeatureEl = document.getElementById('code-feature');
      const codeGherkinEl = document.getElementById('code-gherkin');
      
      if (codeStepsEl) codeStepsEl.value = '';
      if (codeFeatureEl) codeFeatureEl.value = '';
      if (codeGherkinEl) codeGherkinEl.value = '';
      
      // Re-render everything
      render();
      
      console.log('✅ All steps, scenarios, and form data cleared');
    }
  };
  }
  
  // Initialize BDD features
  initBDDFeatures();
  
  // Copy functionality for Gherkin Feature - with null check
  const copyFeatureBtn = document.getElementById('copyFeatureBtn');
  if (copyFeatureBtn) {
    copyFeatureBtn.onclick = async () => {
      const featureEl = document.getElementById('code-feature');
      if (!featureEl) return;
      
      const text = featureEl.value || featureEl.textContent || featureEl.innerText || '';
      if (!text.trim()) {
        alert('No feature content to copy');
        return;
      }
      
      try {
        await navigator.clipboard.writeText(text);
        // Visual feedback
        const icon = document.getElementById('copyFeatureIcon');
        const textEl = document.getElementById('copyFeatureText');
        const btn = document.getElementById('copyFeatureBtn');
        
        if (icon) icon.textContent = '✅';
        if (textEl) textEl.textContent = 'Copied!';
        if (btn) {
          btn.style.background = 'rgba(16, 185, 129, 0.2)';
          btn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
          btn.style.color = '#10b981';
        }
        
        // Reset after 2 seconds
        setTimeout(() => {
          if (icon) icon.textContent = '📋';
          if (textEl) textEl.textContent = 'Copy';
          if (btn) {
            btn.style.background = 'rgba(90, 169, 255, 0.2)';
            btn.style.borderColor = 'rgba(90, 169, 255, 0.4)';
            btn.style.color = '#5aa9ff';
          }
        }, 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand('copy');
          alert('Copied to clipboard!');
        } catch (fallbackErr) {
          alert('Failed to copy. Please select and copy manually.');
        }
        document.body.removeChild(textArea);
      }
    };
  }
  
  // Copy functionality for Step Definitions - with null check
  const copyStepsBtn = document.getElementById('copyStepsBtn');
  if (copyStepsBtn) {
    copyStepsBtn.onclick = async () => {
      const stepsEl = document.getElementById('code-steps');
      if (!stepsEl) return;
      
      const text = stepsEl.value || stepsEl.textContent || '';
      if (!text.trim()) {
        alert('No step definitions to copy');
        return;
      }
      
      try {
        await navigator.clipboard.writeText(text);
        // Visual feedback
        const icon = document.getElementById('copyStepsIcon');
        const textEl = document.getElementById('copyStepsText');
        const btn = document.getElementById('copyStepsBtn');
        
        if (icon) icon.textContent = '✅';
        if (textEl) textEl.textContent = 'Copied!';
        if (btn) {
          btn.style.background = 'rgba(16, 185, 129, 0.2)';
          btn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
          btn.style.color = '#10b981';
        }
        
        // Reset after 2 seconds
        setTimeout(() => {
          if (icon) icon.textContent = '📋';
          if (textEl) textEl.textContent = 'Copy';
          if (btn) {
            btn.style.background = 'rgba(90, 169, 255, 0.2)';
            btn.style.borderColor = 'rgba(90, 169, 255, 0.4)';
            btn.style.color = '#5aa9ff';
          }
        }, 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
        // Fallback for older browsers
        stepsEl.select();
        try {
          document.execCommand('copy');
          alert('Copied to clipboard!');
        } catch (fallbackErr) {
          alert('Failed to copy. Please select and copy manually.');
        }
      }
    };
  }
  
  // Step definitions file management - with null checks
  const saveStepsBtn = document.getElementById('saveStepsBtn');
  const loadStepsBtn = document.getElementById('loadStepsBtn');
  
  if (saveStepsBtn) {
    saveStepsBtn.onclick = saveStepDefinitionsFile;
  }
  if (loadStepsBtn) {
    loadStepsBtn.onclick = () => {
    if (state.currentProjectName) {
      loadStepDefinitionsFile(state.currentProjectName);
    } else {
        alert('No project loaded. Please record or generate a project first.');
      }
    };
  }

  // Feature file management - with null checks
  const saveFeatureBtn = document.getElementById('saveFeatureBtn');
  if (saveFeatureBtn) {
    saveFeatureBtn.onclick = saveFeatureFile;
  }

  // Playwright code management
  const copyPlaywrightBtn = document.getElementById('copyPlaywrightBtn');
  if (copyPlaywrightBtn) {
    copyPlaywrightBtn.onclick = async () => {
      const pwEl = document.getElementById('code-playwright');
      if (!pwEl) return;
      
      const text = pwEl.value || pwEl.textContent || '';
      if (!text.trim()) {
        alert('No Playwright code to copy');
        return;
      }
      
      try {
        await navigator.clipboard.writeText(text);
        const icon = document.getElementById('copyPlaywrightIcon');
        const textEl = document.getElementById('copyPlaywrightText');
        const btn = document.getElementById('copyPlaywrightBtn');
        
        if (icon) icon.textContent = '✅';
        if (textEl) textEl.textContent = 'Copied!';
        if (btn) {
          btn.style.background = 'rgba(16, 185, 129, 0.2)';
          btn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
          btn.style.color = '#10b981';
        }
        
        setTimeout(() => {
          if (icon) icon.textContent = '📋';
          if (textEl) textEl.textContent = 'Copy';
          if (btn) {
            btn.style.background = 'rgba(90, 169, 255, 0.2)';
            btn.style.borderColor = 'rgba(90, 169, 255, 0.4)';
            btn.style.color = '#5aa9ff';
          }
        }, 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
        pwEl.select();
        try {
          document.execCommand('copy');
          alert('Copied to clipboard!');
        } catch (fallbackErr) {
          alert('Failed to copy. Please select and copy manually.');
        }
      }
    };
  }

  const savePlaywrightBtn = document.getElementById('savePlaywrightBtn');
  if (savePlaywrightBtn) {
    savePlaywrightBtn.onclick = savePlaywrightFile;
  }

  // Selenium code management
  const copySeleniumBtn = document.getElementById('copySeleniumBtn');
  if (copySeleniumBtn) {
    copySeleniumBtn.onclick = async () => {
      const seleniumEl = document.getElementById('code-selenium');
      if (!seleniumEl) return;
      
      const text = seleniumEl.value || seleniumEl.textContent || '';
      if (!text.trim()) {
        alert('No Selenium code to copy');
        return;
      }
      
      try {
        await navigator.clipboard.writeText(text);
        const icon = document.getElementById('copySeleniumIcon');
        const textEl = document.getElementById('copySeleniumText');
        const btn = document.getElementById('copySeleniumBtn');
        
        if (icon) icon.textContent = '✅';
        if (textEl) textEl.textContent = 'Copied!';
        if (btn) {
          btn.style.background = 'rgba(16, 185, 129, 0.2)';
          btn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
          btn.style.color = '#10b981';
        }
        
        setTimeout(() => {
          if (icon) icon.textContent = '📋';
          if (textEl) textEl.textContent = 'Copy';
          if (btn) {
            btn.style.background = 'rgba(90, 169, 255, 0.2)';
            btn.style.borderColor = 'rgba(90, 169, 255, 0.4)';
            btn.style.color = '#5aa9ff';
          }
        }, 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
        seleniumEl.select();
        try {
          document.execCommand('copy');
          alert('Copied to clipboard!');
        } catch (fallbackErr) {
          alert('Failed to copy. Please select and copy manually.');
        }
      }
    };
  }

  const saveSeleniumBtn = document.getElementById('saveSeleniumBtn');
  if (saveSeleniumBtn) {
    saveSeleniumBtn.onclick = saveSeleniumFile;
  }

  // Rerun Script functionality - with null check
  const rerunScriptBtn = document.getElementById('rerunScript');
  const stopRerunScriptBtn = document.getElementById('stopRerunScript');
  const runTestRunnerBtn = document.getElementById('runTestRunner');
  let currentAbortController = null;
  let testRunnerAbortController = null;

  if (rerunScriptBtn) {
    rerunScriptBtn.onclick = async () => {
      if (state.steps.length === 0) {
        alert('No steps to rerun. Please record some steps first.');
        return;
      }

      // [ZAC-FIX 2026-05-24] If no project is selected/saved, the
      // server can't persist replay-result.json (the dashboard's
      // source of truth) and the rerun won't appear in any report.
      // Tell the user up-front instead of letting them rerun N times
      // and wonder why the dashboard is empty.
      if (!state.currentProjectId) {
        const proceed = window.confirm(
          'No project is currently saved.\n\n' +
          'You can still rerun, but the result will NOT appear in the ' +
          'Dashboard or any report (we have nowhere to file it).\n\n' +
          'Click OK to rerun anyway, or Cancel to save the project first ' +
          '(use "Save Project" or pick one from the dropdown).'
        );
        if (!proceed) return;
      }

      const rerunStatusEl = document.getElementById('rerunStatus');
      const rerunStatusIcon = document.getElementById('rerunStatusIcon');
      const rerunStatusText = document.getElementById('rerunStatusText');
      const rerunProgress = document.getElementById('rerunProgress');
      const rerunResults = document.getElementById('rerunResults');
      const rerunBtn = document.getElementById('rerunScript');
      const stopBtn = document.getElementById('stopRerunScript');

      // Show status and disable button
      rerunStatusEl.style.display = 'block';
      const stopOnFailure = document.getElementById('stopOnFailure')?.checked || false;
      rerunStatusIcon.textContent = '⏳';
      rerunStatusText.textContent = 'Executing entire script...';
      rerunProgress.textContent = stopOnFailure 
        ? `Will execute ${state.steps.length} steps (will stop on first failure)...`
        : `Will execute all ${state.steps.length} steps (continuing even if some fail)...`;
      rerunResults.innerHTML = '<div style="color: var(--muted); font-size: 11px; margin-top: 4px;">⏳ Waiting for execution to start...</div>';
      rerunBtn.disabled = true;
      rerunBtn.style.opacity = '0.6';
      rerunBtn.style.cursor = 'not-allowed';
      
      // Show stop button
      if (stopBtn) {
        stopBtn.style.display = 'inline-block';
        stopBtn.disabled = false;
        stopBtn.style.opacity = '1';
        stopBtn.style.cursor = 'pointer';
      }

      // Create AbortController for cancellation
      currentAbortController = new AbortController();

      try {
        // Get Scenario Outline options
        const useScenarioOutline = document.getElementById('useScenarioOutline')?.checked || false;
        let examples = [];
        if (useScenarioOutline) {
          try {
            const examplesText = document.getElementById('examplesTable')?.value?.trim();
            if (examplesText) {
              examples = JSON.parse(examplesText);
            }
          } catch (e) {
            console.warn('[Rerun] Failed to parse examples:', e);
          }
        }
        
        // [ZAC-FIX 2026-05-24] Pass projectId / framework / testName so
        // the server persists the rerun to disk under
        //   generated-projects/<framework>/<projectId>/reruns/<testName>/<timestamp>/replay-result.json
        // Without these three fields the rerun runs in-memory and the
        // dashboard never sees it (root cause of: "after rerunning not
        // even once report is generated in the dashboard"). Falls
        // back to the dropdown-selected framework + a synthesised
        // testName when the project hasn't been saved yet.
        const rerunFramework = state.currentProjectFramework
          || document.getElementById('framework')?.value
          || 'playwright-java';
        const rerunTestName = (state.currentProjectName
          || state.currentProjectId
          || 'rerun-' + new Date().toISOString().slice(0, 10))
          .toString()
          .replace(/[^a-zA-Z0-9._-]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60) || 'rerun';

        // [ZAC-FIX 2026-05-24] Read capture defaults from Settings.
        // Allow per-rerun overrides via #captureFailureScreenshotOverride
        // / #captureVideoOverride if the user has the recording tab's
        // override checkboxes ticked. Defaults: screenshot ON, video OFF.
        const _zs = (window.ZacSettings && window.ZacSettings.get()) || {};
        const overrideShot = document.getElementById('captureFailureScreenshotOverride');
        const overrideVid  = document.getElementById('captureVideoOverride');
        const captureFailureScreenshot = overrideShot
          ? !!overrideShot.checked
          : (_zs.captureFailureScreenshot !== false);
        const captureVideo = overrideVid
          ? !!overrideVid.checked
          : !!_zs.captureVideo;

        const payload = {
          steps: state.steps,
          browserType: document.getElementById('browserType')?.value || 'chromium',
          baseUrl: document.getElementById('baseUrl').value || state.config.baseUrl,
          headless: false, // Show browser during execution
          useScenarioOutline: useScenarioOutline,
          examples: examples,
          stopOnFailure: document.getElementById('stopOnFailure')?.checked || false,
          // Persist-to-disk hints (used by routes/api.js#/api/rerun → ensureRerunScaffold)
          projectId: state.currentProjectId || undefined,
          framework: rerunFramework,
          testName: rerunTestName,
          // Capture-config (server reads these, falls back to ON/OFF defaults)
          captureFailureScreenshot,
          captureVideo,
        };

        const resp = await fetch('/api/rerun', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: currentAbortController.signal
        });

        if (!resp.ok) {
          const error = await resp.json();
          throw new Error(error.error || 'Execution failed');
        }

        const result = await resp.json();
        
        // Handle Scenario Outline results differently
        if (result.scenarioOutline) {
          const totalExamples = result.totalExamples || 0;
          const executedExamples = result.executedExamples || 0;
          const successCount = result.successCount || 0;
          const failureCount = result.failureCount || 0;
          
          if (result.cancelled) {
            rerunStatusIcon.textContent = '⏹️';
            rerunStatusText.textContent = 'Scenario Outline execution cancelled';
            rerunStatusEl.style.borderColor = '#f59e0b';
            rerunProgress.textContent = `Cancelled: ${executedExamples}/${totalExamples} examples executed (${successCount} ✅ passed, ${failureCount} ❌ failed)`;
          } else if (result.success || (successCount === totalExamples && failureCount === 0)) {
            rerunStatusIcon.textContent = '✅';
            rerunStatusText.textContent = 'Scenario Outline completed successfully!';
            rerunStatusEl.style.borderColor = '#10b981';
            rerunProgress.textContent = `All ${totalExamples} examples passed (${result.duration || 'N/A'})`;
          } else if (successCount > 0 && failureCount > 0) {
            rerunStatusIcon.textContent = '⚠️';
            rerunStatusText.textContent = 'Scenario Outline completed with some failures';
            rerunStatusEl.style.borderColor = '#f59e0b';
            rerunProgress.textContent = `${executedExamples} examples executed: ${successCount} ✅ passed, ${failureCount} ❌ failed (${result.duration || 'N/A'})`;
          } else {
            rerunStatusIcon.textContent = '❌';
            rerunStatusText.textContent = 'Scenario Outline execution failed';
            rerunStatusEl.style.borderColor = '#ef4444';
            rerunProgress.textContent = `All ${executedExamples} examples failed (${result.duration || 'N/A'})`;
          }
          
          // Show detailed results for each example
          if (result.results && result.results.length > 0) {
            const resultsHtml = result.results.map((exampleResult, idx) => {
              const icon = exampleResult.success ? '✅' : '❌';
              const color = exampleResult.success ? '#10b981' : '#ef4444';
              const exampleData = JSON.stringify(exampleResult.example);
              const stepCount = exampleResult.steps ? exampleResult.steps.length : 0;
              const stepSuccessCount = exampleResult.steps ? exampleResult.steps.filter(s => s.success).length : 0;
              
              return `<div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                  <span style="color: ${color}; font-weight: 600;">${icon}</span>
                  <span style="color: var(--text); font-weight: 600;">Example ${exampleResult.exampleIndex}:</span>
                  <span style="color: var(--muted); font-size: 11px; font-family: monospace;">${exampleData}</span>
                </div>
                <div style="color: var(--muted); font-size: 11px; margin-left: 24px;">
                  Steps: ${stepSuccessCount}/${stepCount} passed
                </div>
              </div>`;
            }).join('');
            
            rerunResults.innerHTML = `<div style="max-height: 300px; overflow-y: auto; margin-top: 8px; font-family: monospace; font-size: 12px;">
              <div style="color: var(--muted); font-size: 11px; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.2);">
                📊 Scenario Outline Results (${executedExamples} examples):
              </div>
              ${resultsHtml}
            </div>`;
          }
        } else {
          // Regular execution (non-Scenario Outline)
          const totalSteps = result.executedSteps || state.steps.length;
          const successCount = result.successCount || (result.results ? result.results.filter(r => r.success).length : 0);
          const failureCount = result.failureCount || (result.results ? result.results.filter(r => !r.success).length : 0);
          
          // Update status based on result - show partial success if some steps passed
          if (result.cancelled) {
            // Execution was cancelled
            rerunStatusIcon.textContent = '⏹️';
            rerunStatusText.textContent = 'Execution cancelled';
            rerunStatusEl.style.borderColor = '#f59e0b';
            rerunProgress.textContent = `Execution cancelled: ${successCount} ✅ successful before cancellation, ${failureCount} ❌ failed (${result.duration || 'N/A'})`;
          } else if (result.success || (successCount > 0 && failureCount === 0)) {
            // All steps passed
            rerunStatusIcon.textContent = '✅';
            rerunStatusText.textContent = 'Execution completed successfully!';
            rerunStatusEl.style.borderColor = '#10b981';
            rerunProgress.textContent = `Completed all ${totalSteps} steps: ${successCount} ✅ successful, ${failureCount} ❌ failed (${result.duration || 'N/A'})`;
          } else if (successCount > 0 && failureCount > 0) {
            // Partial success - some steps passed, some failed
            rerunStatusIcon.textContent = '⚠️';
            rerunStatusText.textContent = 'Execution completed with some failures';
            rerunStatusEl.style.borderColor = '#f59e0b';
            rerunProgress.textContent = `Completed ${totalSteps} steps: ${successCount} ✅ successful, ${failureCount} ❌ failed (${result.duration || 'N/A'})`;
          } else {
            // All steps failed
            rerunStatusIcon.textContent = '❌';
            rerunStatusText.textContent = 'Execution failed';
            rerunStatusEl.style.borderColor = '#ef4444';
            rerunProgress.textContent = result.error || `All ${totalSteps} steps failed (${result.duration || 'N/A'})`;
          }
          
          // [ZAC-FIX 2026-05-24] When the rerun was persisted, surface a
          // direct "Open Report" link in the post-rerun panel — users
          // were rerunning N times and wondering "where's the report?"
          // because they had to dig into the Dashboard tab. Now there's
          // a one-click jump straight to the rendered HTML report.
          // The link works because routes/api.js now returns rerunLayout
          // on EVERY branch (plain / Outline / multi-scenario).
          let reportLink = '';
          const layout = result.rerunLayout || result.layout;
          if (layout && layout.framework && layout.projectName && layout.testName && layout.timestamp) {
            const reportUrl = '/report.html?path=' + encodeURIComponent(
              layout.framework + '/' + layout.projectName + '/reruns/' +
              layout.testName + '/' + layout.timestamp
            );
            const dlUrl = '/api/dashboard/report/html?path=' + encodeURIComponent(
              layout.framework + '/' + layout.projectName + '/reruns/' +
              layout.testName + '/' + layout.timestamp
            );
            reportLink = `
              <div style="display:flex;gap:8px;align-items:center;margin:8px 0 12px;padding:10px;border:1px solid rgba(16,185,129,0.35);border-radius:6px;background:rgba(16,185,129,0.08);">
                <span style="color:#10b981;font-weight:600;">📊 Report ready</span>
                <a href="${reportUrl}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;">Open report</a>
                <span style="color:var(--muted);font-size:11px;">·</span>
                <a href="${dlUrl}" download="${layout.testName}-${layout.timestamp}.html" style="color:var(--accent);text-decoration:none;">Download .html</a>
                <span style="color:var(--muted);font-size:11px;margin-left:auto;">${layout.testName} @ ${layout.timestamp}</span>
              </div>`;
          }

          // Always show detailed results if available (for regular execution)
          if (result.results && result.results.length > 0 && !result.scenarioOutline) {
            // Pre-compute heal summary so we can flag the whole run when the
            // self-healing chain rescued any step. Mirrors what mvn test does
            // via SELECTOR_FALLBACKS_BY_PRIMARY in the generated framework.
            const healedSteps = result.results.filter(r => r && r.healed);
            const healedBanner = healedSteps.length > 0
              ? `<div style="color: #f59e0b; font-size: 11px; margin-bottom: 8px;">
                   🩹 Self-healing kicked in on ${healedSteps.length} step${healedSteps.length === 1 ? '' : 's'} —
                   primary locator was stale, run continued via fallback chain.
                 </div>`
              : '';

            const resultsHtml = result.results.map((r, i) => {
              const icon = r.success ? '✅' : '❌';
              const color = r.success ? '#10b981' : '#ef4444';
              const step = state.steps[i];
              const stepDesc = step ? getStepLabel(step) : (r.step || r.kind || 'Unknown');
              const duration = r.duration ? ` (${r.duration}ms)` : '';
              const healLine = r.healed
                ? `<div style="color: #f59e0b; font-size: 11px; margin-left: 24px; margin-top: 2px;">
                     🩹 Healed: primary <code>${escapeHtml(r.primarySelector || '')}</code> →
                     <code>${escapeHtml(r.healedVia || '')}</code>
                   </div>`
                : '';
              return `<div style="padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                <span style="color: ${color}; font-weight: 600;">${icon}</span> 
                <span style="color: var(--text);">[${i + 1}/${totalSteps}] ${stepDesc}${duration}</span>
                ${healLine}
                ${r.error ? `<div style="color: #ef4444; font-size: 11px; margin-left: 24px; margin-top: 2px;">${r.error}</div>` : ''}
              </div>`;
            }).join('');
            rerunResults.innerHTML = `${reportLink}<div style="max-height: 200px; overflow-y: auto; margin-top: 8px; font-family: monospace; font-size: 12px;">
              <div style="color: var(--muted); font-size: 11px; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.2);">
                📊 Step-by-step results (${result.cancelled ? 'execution cancelled' : `all ${totalSteps} steps executed`}):
              </div>
              ${healedBanner}
              ${resultsHtml}
            </div>`;
          } else if (result.error && !result.scenarioOutline) {
            // Show error if no detailed results but error message exists
            rerunResults.innerHTML = `${reportLink}<div style="color: #ef4444; margin-top: 8px;">${result.error}</div>`;
          } else if (reportLink) {
            // No step rows but persistence happened — still show the link.
            rerunResults.innerHTML = reportLink;
          }
        }
      } catch (error) {
        // Check if error is due to abort
        if (error.name === 'AbortError') {
          rerunStatusIcon.textContent = '⏹️';
          rerunStatusText.textContent = 'Execution cancelled';
          rerunStatusEl.style.borderColor = '#f59e0b';
          rerunProgress.textContent = 'Execution cancelled by user';
          rerunResults.innerHTML = '<div style="color: #f59e0b; margin-top: 8px;">Execution was cancelled. Browser resources have been cleaned up.</div>';
        } else {
          rerunStatusIcon.textContent = '❌';
          rerunStatusText.textContent = 'Execution error';
          rerunStatusEl.style.borderColor = '#ef4444';
          rerunProgress.textContent = error.message || 'Failed to execute script';
          rerunResults.innerHTML = `<div style="color: #ef4444; margin-top: 8px;">${error.message}</div>`;
        }
      } finally {
        rerunBtn.disabled = false;
        rerunBtn.style.opacity = '1';
        rerunBtn.style.cursor = 'pointer';
        
        // Hide stop button
        if (stopBtn) {
          stopBtn.style.display = 'none';
        }
        
        // Reset execution state
        currentAbortController = null;
      }
    };
  }

  // Stop Rerun Script functionality
  if (stopRerunScriptBtn) {
    stopRerunScriptBtn.onclick = async () => {
      const stopBtn = document.getElementById('stopRerunScript');
      const rerunStatusIcon = document.getElementById('rerunStatusIcon');
      const rerunStatusText = document.getElementById('rerunStatusText');
      const rerunProgress = document.getElementById('rerunProgress');
      const testRunnerStatusIcon = document.getElementById('testRunnerStatusIcon');
      const testRunnerStatusText = document.getElementById('testRunnerStatusText');
      const testRunnerProgress = document.getElementById('testRunnerProgress');

      // Check if test runner is running
      if (testRunnerAbortController) {
        testRunnerAbortController.abort();
        if (testRunnerStatusIcon) testRunnerStatusIcon.textContent = '⏹️';
        if (testRunnerStatusText) testRunnerStatusText.textContent = 'Test execution cancelled';
        if (testRunnerProgress) testRunnerProgress.textContent = 'Cancelling test execution...';
        testRunnerAbortController = null;
        return;
      }

      if (!currentAbortController) {
        console.warn('[Stop] No active execution to cancel');
        return;
      }

      // Disable stop button to prevent multiple clicks
      if (stopBtn) {
        stopBtn.disabled = true;
        stopBtn.style.opacity = '0.6';
        stopBtn.style.cursor = 'not-allowed';
        stopBtn.textContent = '⏹️ Stopping...';
      }

      try {
        // First, try to cancel via explicit endpoint (will cancel most recent execution)
        try {
          const cancelResp = await fetch('/api/rerun/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}) // No executionId needed - will cancel most recent
          });
          const cancelResult = await cancelResp.json();
          if (cancelResult.success) {
            console.log('[Stop] Successfully cancelled execution via endpoint');
          }
        } catch (cancelError) {
          console.warn('[Stop] Failed to send cancel request:', cancelError);
        }
        
        // Also abort the fetch request - this will close the connection
        if (currentAbortController) {
          currentAbortController.abort();
          console.log('[Stop] Aborted fetch request');
        }

        // Update UI immediately
        if (rerunStatusIcon) rerunStatusIcon.textContent = '⏹️';
        if (rerunStatusText) rerunStatusText.textContent = 'Cancelling execution...';
        if (rerunProgress) rerunProgress.textContent = 'Stopping execution and cleaning up browser resources...';

      } catch (error) {
        console.error('[Stop] Error cancelling execution:', error);
        if (rerunProgress) {
          rerunProgress.textContent = `Error cancelling: ${error.message}`;
        }
      }
    };
  }

  // Test Runner functionality - Run Gherkin through Step Definitions
  if (runTestRunnerBtn) {
    runTestRunnerBtn.onclick = async () => {
      // Check if project has been generated
      const projectName = document.getElementById('projectName')?.value || state.currentProjectName;
      if (!projectName) {
        alert('Please enter a project name and generate/export the project first.');
        return;
      }

      const framework = document.getElementById('framework')?.value || 'playwright-java';
      const testRunnerStatusEl = document.getElementById('testRunnerStatus');
      const testRunnerStatusIcon = document.getElementById('testRunnerStatusIcon');
      const testRunnerStatusText = document.getElementById('testRunnerStatusText');
      const testRunnerProgress = document.getElementById('testRunnerProgress');
      const testRunnerOutput = document.getElementById('testRunnerOutput');
      const testRunnerResults = document.getElementById('testRunnerResults');
      const runBtn = document.getElementById('runTestRunner');
      const stopBtn = document.getElementById('stopRerunScript');

      // Show status and disable button
      testRunnerStatusEl.style.display = 'block';
      testRunnerStatusIcon.textContent = '⏳';
      testRunnerStatusText.textContent = 'Running tests via Test Runner...';
      testRunnerProgress.textContent = `Preparing to run ${framework} tests for project: ${projectName}`;
      testRunnerOutput.textContent = '';
      testRunnerResults.innerHTML = '';
      runBtn.disabled = true;
      runBtn.style.opacity = '0.6';
      runBtn.style.cursor = 'not-allowed';
      
      // Show stop button
      if (stopBtn) {
        stopBtn.style.display = 'inline-block';
        stopBtn.disabled = false;
        stopBtn.style.opacity = '1';
        stopBtn.style.cursor = 'pointer';
      }

      // Create AbortController for cancellation
      testRunnerAbortController = new AbortController();

      try {
        const payload = {
          projectName: projectName,
          projectId: state.currentProjectId || null,
          framework: framework,
          browserType: document.getElementById('browserType')?.value || 'chromium'
        };

        const resp = await fetch('/api/test-runner/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: testRunnerAbortController.signal
        });

        if (!resp.ok) {
          const error = await resp.json();
          throw new Error(error.error || 'Test execution failed');
        }

        // Handle streaming response
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim()) {
              testRunnerOutput.textContent += line + '\n';
              testRunnerOutput.scrollTop = testRunnerOutput.scrollHeight;
            }
          }
        }

        // Process final buffer
        if (buffer.trim()) {
          testRunnerOutput.textContent += buffer;
        }

        // Try to parse final result
        try {
          const finalResult = JSON.parse(buffer || '{}');
          if (finalResult.success) {
            testRunnerStatusIcon.textContent = '✅';
            testRunnerStatusText.textContent = 'Tests completed successfully!';
            testRunnerStatusEl.style.borderColor = '#10b981';
            testRunnerResults.innerHTML = `<div style="color: #10b981; margin-top: 8px;">✅ All tests passed!</div>`;
          } else {
            testRunnerStatusIcon.textContent = '❌';
            testRunnerStatusText.textContent = 'Tests failed';
            testRunnerStatusEl.style.borderColor = '#ef4444';
            testRunnerResults.innerHTML = `<div style="color: #ef4444; margin-top: 8px;">❌ Tests failed. Check output above for details.</div>`;
          }
        } catch (e) {
          // If we can't parse JSON, check output for success indicators
          const outputText = testRunnerOutput.textContent.toLowerCase();
          if (outputText.includes('tests passed') || outputText.includes('build success')) {
            testRunnerStatusIcon.textContent = '✅';
            testRunnerStatusText.textContent = 'Tests completed!';
            testRunnerStatusEl.style.borderColor = '#10b981';
          } else if (outputText.includes('tests failed') || outputText.includes('build failure')) {
            testRunnerStatusIcon.textContent = '❌';
            testRunnerStatusText.textContent = 'Tests failed';
            testRunnerStatusEl.style.borderColor = '#ef4444';
          } else {
            testRunnerStatusIcon.textContent = '⚠️';
            testRunnerStatusText.textContent = 'Test execution completed';
            testRunnerStatusEl.style.borderColor = '#f59e0b';
          }
        }

      } catch (error) {
        if (error.name === 'AbortError') {
          testRunnerStatusIcon.textContent = '⏹️';
          testRunnerStatusText.textContent = 'Test execution cancelled';
          testRunnerStatusEl.style.borderColor = '#f59e0b';
          testRunnerProgress.textContent = 'Execution was cancelled by user';
        } else {
          testRunnerStatusIcon.textContent = '❌';
          testRunnerStatusText.textContent = 'Test execution error';
          testRunnerStatusEl.style.borderColor = '#ef4444';
          testRunnerOutput.textContent += `\n\nError: ${error.message}`;
          testRunnerResults.innerHTML = `<div style="color: #ef4444; margin-top: 8px;">❌ Error: ${error.message}</div>`;
        }
      } finally {
        // Re-enable button
        runBtn.disabled = false;
        runBtn.style.opacity = '1';
        runBtn.style.cursor = 'pointer';
        
        // Hide stop button
        if (stopBtn) {
          stopBtn.style.display = 'none';
        }
        
        testRunnerAbortController = null;
      }
    };
  }

  // Download Zip button - with null check
  const downloadZipBtn = document.getElementById('downloadZip');
  if (downloadZipBtn) {
    downloadZipBtn.onclick = async () => {
      // Check if project is selected
      if (!state.currentProjectId) {
        showToast('Please select a project before exporting', 'error');
        return;
      }
      
      const statusElDownload = document.getElementById('status');
      if (statusElDownload) statusElDownload.textContent = 'Generating...';
    const payload = {
      projectId: state.currentProjectId, // Use current project ID
      projectName: state.currentProjectName || document.getElementById('projectName')?.value || 'sample-project',
        framework: document.getElementById('framework')?.value || 'playwright-java',
        browserType: document.getElementById('browserType')?.value || 'chromium',
      baseUrl: document.getElementById('baseUrl').value || state.config.baseUrl,
      featureTitle: document.getElementById('featureTitle').value || 'Recorded Flow',
      featureName: document.getElementById('featureName').value || 'Recorded Feature',
        tags: (document.getElementById('tags').value || '').split(/\s+/).filter(t => t.startsWith('@')),
        steps: state.steps,
        // Advanced BDD features
        useScenarioOutline: state.bddOptions.useScenarioOutline,
        examples: state.bddOptions.examples,
        backgroundSteps: state.backgroundSteps,
        scenarios: state.scenarios.length > 0 ? state.scenarios : null
    };
    const resp = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok){
        if (statusElDownload) statusElDownload.textContent = 'Error generating zip';
      return;
    }
    // Stream download
    const blob = await resp.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (payload.projectName || 'project') + '.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
      if (statusElDownload) statusElDownload.textContent = 'Downloaded!';
    };
  }

  // Requirements/SRS/BRD parsing functionality
  let requirementsData = null;
  
  const parseRequirementsBtn = document.getElementById('parseRequirements');
  if (parseRequirementsBtn) {
    parseRequirementsBtn.addEventListener('click', async () => {
      const fileInput = document.getElementById('requirementDocument');
      if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        alert('Please select a document to upload');
        return;
      }
      
      const file = fileInput.files[0];
      const formData = new FormData();
      formData.append('document', file);
      formData.append('format', 'text');
      
      const parseBtn = document.getElementById('parseRequirements');
      parseBtn.disabled = true;
      parseBtn.textContent = '⏳ Parsing...';
      
      try {
        const resp = await fetch('/api/requirements/parse', {
          method: 'POST',
          body: formData
        });
        
        if (!resp.ok) {
          throw new Error('Failed to parse document');
        }
        
        const data = await resp.json();
        requirementsData = data;
        
        // Display results
        displayRequirementsResults(data);
        
      } catch (error) {
        console.error('Error parsing requirements:', error);
        alert('Error parsing document: ' + error.message);
      } finally {
        parseBtn.disabled = false;
        parseBtn.textContent = '🔍 Parse Requirements & Generate Test Cases';
      }
    });
  }
  
  function displayRequirementsResults(data) {
    const resultsDiv = document.getElementById('requirementsResults');
    if (!resultsDiv) return;
    
    resultsDiv.style.display = 'block';
    
    // Display summary
    const summaryEl = document.getElementById('reqSummary');
    if (summaryEl) {
      summaryEl.textContent = `${data.summary.totalRequirements} Requirements, ${data.summary.totalTestScenarios} Test Scenarios, ${data.summary.coverage}% Coverage`;
    }
    
    // Display requirements
    const reqListEl = document.getElementById('requirementsList');
    if (reqListEl && data.requirements) {
      reqListEl.innerHTML = data.requirements.map(req => `
        <div style="margin-bottom: 12px; padding: 12px; background: rgba(13, 17, 23, 0.5); border-radius: 6px; border-left: 3px solid var(--accent);">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
            <strong style="color: var(--accent);">${req.id}</strong>
            <span style="font-size: 11px; padding: 4px 8px; background: rgba(139, 92, 246, 0.2); border-radius: 4px; color: var(--accent);">
              ${req.type} | ${req.priority}
            </span>
          </div>
          <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.5;">
            ${req.description.substring(0, 200)}${req.description.length > 200 ? '...' : ''}
          </div>
          ${req.acceptanceCriteria && req.acceptanceCriteria.length > 0 ? `
            <div style="margin-top: 8px; font-size: 12px; color: var(--muted);">
              <strong>Acceptance Criteria:</strong> ${req.acceptanceCriteria.length} items
            </div>
          ` : ''}
        </div>
      `).join('');
    }
    
    // Display test scenarios
    const scenariosEl = document.getElementById('testScenariosList');
    if (scenariosEl && data.testScenarios) {
      scenariosEl.innerHTML = data.testScenarios.map(scenario => `
        <div style="margin-bottom: 12px; padding: 12px; background: rgba(13, 17, 23, 0.5); border-radius: 6px; border-left: 3px solid #10b981;">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
            <strong style="color: #10b981;">${scenario.id}</strong>
            <div style="display: flex; gap: 4px; flex-wrap: wrap;">
              ${scenario.tags.filter(t => t.startsWith('@')).map(tag => `
                <span style="font-size: 10px; padding: 2px 6px; background: rgba(16, 185, 129, 0.2); border-radius: 3px; color: #10b981;">
                  ${tag}
                </span>
              `).join('')}
            </div>
          </div>
          <div style="font-size: 13px; color: var(--text); font-weight: 600; margin-bottom: 6px;">
            ${scenario.title}
          </div>
          <div style="font-size: 11px; color: var(--muted); margin-bottom: 8px;">
            Requirement: ${scenario.requirementId}
          </div>
          <div style="font-size: 12px; color: var(--text-secondary);">
            <strong>Steps:</strong> ${scenario.steps.length} steps
          </div>
        </div>
      `).join('');
    }
    
    // Display traceability matrix
    const traceabilityEl = document.getElementById('traceabilityContent');
    if (traceabilityEl && data.traceability) {
      const matrix = data.traceability;
      traceabilityEl.innerHTML = `
        <div style="margin-bottom: 12px;">
          <strong style="color: var(--accent);">Coverage:</strong> 
          ${matrix.coverage.requirementsWithTests} / ${matrix.coverage.totalRequirements} requirements have test cases
          (${matrix.coverage.coveragePercentage}%)
        </div>
        <div style="max-height: 200px; overflow-y: auto;">
          ${matrix.requirements.map(req => `
            <div style="margin-bottom: 8px; padding: 8px; background: rgba(13, 17, 23, 0.4); border-radius: 4px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 600; color: var(--text);">${req.id}</span>
                <span style="font-size: 11px; color: ${req.testCases.length > 0 ? '#10b981' : '#ef4444'};">
                  ${req.testCases.length} test case(s)
                </span>
              </div>
              ${req.testCases.length > 0 ? `
                <div style="margin-top: 6px; font-size: 11px; color: var(--muted);">
                  ${req.testCases.map(tc => tc.id).join(', ')}
                </div>
              ` : '<div style="margin-top: 6px; font-size: 11px; color: #ef4444;">⚠️ No test cases</div>'}
            </div>
          `).join('')}
        </div>
      `;
    }
  }
  
  const generateFeatureFromRequirementsBtn = document.getElementById('generateFeatureFromRequirements');
  if (generateFeatureFromRequirementsBtn) {
    generateFeatureFromRequirementsBtn.addEventListener('click', async () => {
      if (!requirementsData || !requirementsData.testScenarios) {
        alert('Please parse a document first');
        return;
      }
      
      // Check if there are any test scenarios
      if (!Array.isArray(requirementsData.testScenarios) || requirementsData.testScenarios.length === 0) {
        alert('No test scenarios were extracted from the document. Please ensure the document contains requirements that can be converted to test scenarios.');
        return;
      }
      
      const featureName = prompt('Enter feature name:', 'Generated Test Cases from Requirements') || 'Generated Test Cases from Requirements';
      
      try {
        const resp = await fetch('/api/requirements/generate-feature', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scenarios: requirementsData.testScenarios,
            featureName: featureName,
            tags: []
          })
        });
        
        if (!resp.ok) {
          // Try to read the error message from the server response
          let errorMessage = 'Failed to generate feature file';
          try {
            const errorData = await resp.json();
            errorMessage = errorData.error || errorData.message || errorMessage;
          } catch (e) {
            errorMessage = `HTTP ${resp.status}: ${resp.statusText}`;
          }
          throw new Error(errorMessage);
        }
        
        const data = await resp.json();
        
        // Display generated feature
        const featureDiv = document.getElementById('generatedFeatureFromReq');
        const featureCodeEl = document.getElementById('requirementFeatureCode');
        
        if (featureDiv && featureCodeEl) {
          featureDiv.style.display = 'block';
          featureCodeEl.textContent = data.gherkin;
        }
        
      } catch (error) {
        console.error('Error generating feature:', error);
        alert('Error generating feature file: ' + error.message);
      }
    });
  }
  
  const copyRequirementFeatureBtn = document.getElementById('copyRequirementFeature');
  if (copyRequirementFeatureBtn) {
    copyRequirementFeatureBtn.addEventListener('click', () => {
      const featureCodeEl = document.getElementById('requirementFeatureCode');
      if (!featureCodeEl) return;
      
      navigator.clipboard.writeText(featureCodeEl.textContent).then(() => {
        const btn = document.getElementById('copyRequirementFeature');
        const originalText = btn.textContent;
        btn.textContent = '✅ Copied!';
        btn.style.background = 'linear-gradient(135deg, #10b981 0%, #34d399 100%)';
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.background = 'linear-gradient(135deg, #5aa9ff 0%, #8b5cf6 100%)';
        }, 2000);
      }).catch(err => {
        console.error('Failed to copy:', err);
        alert('Failed to copy to clipboard');
      });
    });
  }

  // ============================================================================
  // MAVEN INTEGRATION
  // ============================================================================
  
  let currentMavenExecutionId = null;
  let mavenOutputBuffer = [];

  // Check Maven installation status
  async function checkMavenStatus() {
    const statusIcon = document.getElementById('mavenStatusIcon');
    const statusText = document.getElementById('mavenStatusText');
    const statusDetails = document.getElementById('mavenStatusDetails');
    
    if (!statusIcon || !statusText || !statusDetails) return;

    try {
      statusIcon.textContent = '⏳';
      statusText.textContent = 'Checking Maven installation...';
      statusDetails.textContent = '';

      const response = await fetch('/api/maven/check');
      const data = await response.json();

      if (data.installed) {
        statusIcon.textContent = '✅';
        statusText.textContent = 'Maven is installed';
        statusDetails.textContent = `Version: ${data.version || 'unknown'}`;
      } else {
        statusIcon.textContent = '❌';
        statusText.textContent = 'Maven is not installed';
        statusDetails.textContent = data.error || 'Please install Maven to use this feature.';
      }
    } catch (error) {
      statusIcon.textContent = '❌';
      statusText.textContent = 'Error checking Maven';
      statusDetails.textContent = error.message;
    }
  }

  // Check if current project is a Maven project
  async function checkMavenProject() {
    const mavenPanel = document.getElementById('mavenPanel');
    if (!mavenPanel || !state.currentProjectId) {
      if (mavenPanel) mavenPanel.style.display = 'none';
      return;
    }

    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(state.currentProjectId)}/maven/check`);
      const data = await response.json();

      if (data.isMavenProject) {
        mavenPanel.style.display = 'block';
        await checkMavenStatus();
      } else {
        mavenPanel.style.display = 'none';
      }
    } catch (error) {
      console.error('Error checking Maven project:', error);
      mavenPanel.style.display = 'none';
    }
  }

  // Execute Maven command
  async function executeMavenCommand(command, args = []) {
    if (!state.currentProjectId) {
      showToast('Please select a project first', 'error');
      return;
    }

    const mavenOutput = document.getElementById('mavenOutput');
    const mavenStopBtn = document.getElementById('mavenStop');
    const quickActionBtns = ['mavenCleanInstall', 'mavenTest', 'mavenClean', 'mavenCompile', 'mavenRunCustom'];

    // Clear output
    mavenOutputBuffer = [];
    if (mavenOutput) {
      mavenOutput.innerHTML = '<div style="color: var(--muted);">Executing Maven command...</div>';
    }

    // Show stop button and disable quick actions
    if (mavenStopBtn) mavenStopBtn.style.display = 'inline-block';
    quickActionBtns.forEach(btnId => {
      const btn = document.getElementById(btnId);
      if (btn) btn.disabled = true;
    });

    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(state.currentProjectId)}/maven/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, args, timeout: 300000 })
      });

      const data = await response.json();

      if (data.success) {
        currentMavenExecutionId = data.executionId;
        
        // Display output
        if (mavenOutput) {
          const outputText = data.output && data.output.length > 0 
            ? data.output.join('\n') 
            : (data.stdout || 'Command completed successfully');
          
          const successColor = data.success ? '#10b981' : '#ef4444';
          mavenOutput.innerHTML = `<div style="color: ${successColor}; font-weight: 600; margin-bottom: 8px;">✓ Command completed in ${data.duration}</div><pre style="margin: 0; white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(outputText)}</pre>`;
          mavenOutput.scrollTop = mavenOutput.scrollHeight;
        }

        showToast(`Maven command completed: ${command}`, data.success ? 'success' : 'error');
      } else {
        throw new Error(data.error || 'Maven command failed');
      }
    } catch (error) {
      console.error('Maven execution error:', error);
      if (mavenOutput) {
        mavenOutput.innerHTML = `<div style="color: #ef4444; font-weight: 600;">✗ Error: ${escapeHtml(error.message)}</div>`;
      }
      showToast(`Maven command failed: ${error.message}`, 'error');
    } finally {
      // Hide stop button and enable quick actions
      if (mavenStopBtn) mavenStopBtn.style.display = 'none';
      quickActionBtns.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) btn.disabled = false;
      });
      currentMavenExecutionId = null;
    }
  }

  // Cancel running Maven command
  async function cancelMavenCommand() {
    if (!currentMavenExecutionId) return;

    try {
      const response = await fetch('/api/maven/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executionId: currentMavenExecutionId })
      });

      const data = await response.json();
      if (data.success) {
        showToast('Maven command cancelled', 'info');
        currentMavenExecutionId = null;
      }
    } catch (error) {
      console.error('Error cancelling Maven command:', error);
    }
  }

  // Helper function to escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Maven event listeners
  const mavenCleanInstallBtn = document.getElementById('mavenCleanInstall');
  if (mavenCleanInstallBtn) {
    mavenCleanInstallBtn.addEventListener('click', () => executeMavenCommand('clean', ['install']));
  }

  const mavenTestBtn = document.getElementById('mavenTest');
  if (mavenTestBtn) {
    mavenTestBtn.addEventListener('click', () => executeMavenCommand('test'));
  }

  const mavenCleanBtn = document.getElementById('mavenClean');
  if (mavenCleanBtn) {
    mavenCleanBtn.addEventListener('click', () => executeMavenCommand('clean'));
  }

  const mavenCompileBtn = document.getElementById('mavenCompile');
  if (mavenCompileBtn) {
    mavenCompileBtn.addEventListener('click', () => executeMavenCommand('compile'));
  }

  const mavenStopBtn = document.getElementById('mavenStop');
  if (mavenStopBtn) {
    mavenStopBtn.addEventListener('click', cancelMavenCommand);
  }

  const mavenRunCustomBtn = document.getElementById('mavenRunCustom');
  const mavenCustomCommandInput = document.getElementById('mavenCustomCommand');
  if (mavenRunCustomBtn && mavenCustomCommandInput) {
    mavenRunCustomBtn.addEventListener('click', () => {
      const command = mavenCustomCommandInput.value.trim();
      if (!command) {
        showToast('Please enter a Maven command', 'error');
        return;
      }
      
      // Parse command into command and args
      const parts = command.split(/\s+/);
      const mavenCommand = parts[0];
      const args = parts.slice(1);
      
      executeMavenCommand(mavenCommand, args);
    });

    // Allow Enter key to execute
    mavenCustomCommandInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        mavenRunCustomBtn.click();
      }
    });
  }

  const mavenClearOutputBtn = document.getElementById('mavenClearOutput');
  if (mavenClearOutputBtn) {
    mavenClearOutputBtn.addEventListener('click', () => {
      const mavenOutput = document.getElementById('mavenOutput');
      if (mavenOutput) {
        mavenOutput.innerHTML = '<div style="color: var(--muted); font-style: italic;">No output yet. Run a Maven command to see results here.</div>';
      }
    });
  }

  // Make checkMavenProject available globally so selectProject can call it
  window.checkMavenProject = checkMavenProject;
  
  // Initial check after page load
  setTimeout(() => {
    checkMavenProject();
  }, 1500);

  // Initial Maven status check
  checkMavenStatus();

  // ============================================================================
  // NPM INTEGRATION
  // ============================================================================
  
  let currentNpmExecutionId = null;
  let npmOutputBuffer = [];

  // Check npm installation status
  async function checkNpmStatus() {
    const statusIcon = document.getElementById('npmStatusIcon');
    const statusText = document.getElementById('npmStatusText');
    const statusDetails = document.getElementById('npmStatusDetails');
    
    if (!statusIcon || !statusText || !statusDetails) return;

    try {
      statusIcon.textContent = '⏳';
      statusText.textContent = 'Checking npm installation...';
      statusDetails.textContent = '';

      const response = await fetch('/api/npm/check');
      const data = await response.json();

      if (data.installed) {
        statusIcon.textContent = '✅';
        statusText.textContent = 'npm is installed';
        statusDetails.textContent = `Version: ${data.version || 'unknown'}`;
      } else {
        statusIcon.textContent = '❌';
        statusText.textContent = 'npm is not installed';
        statusDetails.textContent = data.error || 'Please install Node.js/npm to use this feature.';
      }
    } catch (error) {
      statusIcon.textContent = '❌';
      statusText.textContent = 'Error checking npm';
      statusDetails.textContent = error.message;
    }
  }

  // Check if current project is an npm project
  async function checkNpmProject() {
    const npmPanel = document.getElementById('npmPanel');
    if (!npmPanel || !state.currentProjectId) {
      if (npmPanel) npmPanel.style.display = 'none';
      return;
    }

    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(state.currentProjectId)}/npm/check`);
      const data = await response.json();

      if (data.isNpmProject) {
        npmPanel.style.display = 'block';
        await checkNpmStatus();
      } else {
        npmPanel.style.display = 'none';
      }
    } catch (error) {
      console.error('Error checking npm project:', error);
      npmPanel.style.display = 'none';
    }
  }

  // Execute npm command
  async function executeNpmCommand(command, args = []) {
    if (!state.currentProjectId) {
      showToast('Please select a project first', 'error');
      return;
    }

    const npmOutput = document.getElementById('npmOutput');
    const npmStopBtn = document.getElementById('npmStop');
    const quickActionBtns = ['npmInstall', 'npmTest', 'npmRunBuild', 'npmRunPlaywright', 'npmRunCustom'];

    // Clear output
    npmOutputBuffer = [];
    if (npmOutput) {
      npmOutput.innerHTML = '<div style="color: var(--muted);">Executing npm command...</div>';
    }

    // Show stop button and disable quick actions
    if (npmStopBtn) npmStopBtn.style.display = 'inline-block';
    quickActionBtns.forEach(btnId => {
      const btn = document.getElementById(btnId);
      if (btn) btn.disabled = true;
    });

    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(state.currentProjectId)}/npm/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, args, timeout: 300000 })
      });

      const data = await response.json();

      if (data.success) {
        currentNpmExecutionId = data.executionId;
        
        // Display output
        if (npmOutput) {
          const outputText = data.output && data.output.length > 0 
            ? data.output.join('\n') 
            : (data.stdout || 'Command completed successfully');
          
          const successColor = data.success ? '#10b981' : '#ef4444';
          npmOutput.innerHTML = `<div style="color: ${successColor}; font-weight: 600; margin-bottom: 8px;">✓ Command completed in ${data.duration}</div><pre style="margin: 0; white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(outputText)}</pre>`;
          npmOutput.scrollTop = npmOutput.scrollHeight;
        }

        showToast(`npm command completed: ${command}`, data.success ? 'success' : 'error');
      } else {
        throw new Error(data.error || 'npm command failed');
      }
    } catch (error) {
      console.error('npm execution error:', error);
      if (npmOutput) {
        npmOutput.innerHTML = `<div style="color: #ef4444; font-weight: 600;">✗ Error: ${escapeHtml(error.message)}</div>`;
      }
      showToast(`npm command failed: ${error.message}`, 'error');
    } finally {
      // Hide stop button and enable quick actions
      if (npmStopBtn) npmStopBtn.style.display = 'none';
      quickActionBtns.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) btn.disabled = false;
      });
      currentNpmExecutionId = null;
    }
  }

  // Cancel running npm command
  async function cancelNpmCommand() {
    if (!currentNpmExecutionId) return;

    try {
      const response = await fetch('/api/npm/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executionId: currentNpmExecutionId })
      });

      const data = await response.json();
      if (data.success) {
        showToast('npm command cancelled', 'info');
        currentNpmExecutionId = null;
      }
    } catch (error) {
      console.error('Error cancelling npm command:', error);
    }
  }

  // NPM event listeners
  const npmInstallBtn = document.getElementById('npmInstall');
  if (npmInstallBtn) {
    npmInstallBtn.addEventListener('click', () => executeNpmCommand('install'));
  }

  const npmTestBtn = document.getElementById('npmTest');
  if (npmTestBtn) {
    npmTestBtn.addEventListener('click', () => executeNpmCommand('test'));
  }

  const npmRunBuildBtn = document.getElementById('npmRunBuild');
  if (npmRunBuildBtn) {
    npmRunBuildBtn.addEventListener('click', () => executeNpmCommand('run', ['build']));
  }

  const npmRunPlaywrightBtn = document.getElementById('npmRunPlaywright');
  if (npmRunPlaywrightBtn) {
    npmRunPlaywrightBtn.addEventListener('click', () => executeNpmCommand('run', ['test']));
  }

  const npmStopBtn = document.getElementById('npmStop');
  if (npmStopBtn) {
    npmStopBtn.addEventListener('click', cancelNpmCommand);
  }

  const npmRunCustomBtn = document.getElementById('npmRunCustom');
  const npmCustomCommandInput = document.getElementById('npmCustomCommand');
  if (npmRunCustomBtn && npmCustomCommandInput) {
    npmRunCustomBtn.addEventListener('click', () => {
      const command = npmCustomCommandInput.value.trim();
      if (!command) {
        showToast('Please enter an npm command', 'error');
        return;
      }
      
      // Parse command - handle "run script" format
      const parts = command.split(/\s+/);
      let npmCommand, npmArgs;
      
      if (parts[0] === 'run' && parts.length > 1) {
        npmCommand = 'run';
        npmArgs = parts.slice(1);
      } else {
        npmCommand = parts[0];
        npmArgs = parts.slice(1);
      }
      
      executeNpmCommand(npmCommand, npmArgs);
    });

    // Allow Enter key to execute
    npmCustomCommandInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        npmRunCustomBtn.click();
      }
    });
  }

  const npmClearOutputBtn = document.getElementById('npmClearOutput');
  if (npmClearOutputBtn) {
    npmClearOutputBtn.addEventListener('click', () => {
      const npmOutput = document.getElementById('npmOutput');
      if (npmOutput) {
        npmOutput.innerHTML = '<div style="color: var(--muted); font-style: italic;">No output yet. Run an npm command to see results here.</div>';
      }
    });
  }

  // Make checkNpmProject available globally so selectProject can call it
  window.checkNpmProject = checkNpmProject;
  
  // Check npm project when project changes (in selectProject function)
  // Initial check after page load
  setTimeout(() => {
    checkNpmProject();
  }, 1500);

  // Initial npm status check
  checkNpmStatus();

  render();
});
