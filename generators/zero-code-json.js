/**
 * Generate zero-code JSON format from recorded steps
 * Output format compatible with Playwright zero-code engine
 */

export function generateZeroCodeJson(steps = []) {
  const zeroCodeActions = steps.map(step => {
    const action = {
      action: step.kind
    };

    switch (step.kind) {
      case 'navigate':
        action.url = step.url || step.selector || '';
        break;

      case 'click':
      case 'doubleClick':
        action.selector = step.selector || step.normalizedSelector || '';
        break;

      case 'type':
        action.selector = step.selector || step.normalizedSelector || '';
        action.text = step.value || '';
        break;

      case 'assertText':
        action.selector = step.selector || step.normalizedSelector || '';
        action.expected = step.expectedValue || step.text || '';
        break;

      case 'assertVisible':
        action.selector = step.selector || step.normalizedSelector || '';
        break;

      case 'assertAttribute':
        action.selector = step.selector || step.normalizedSelector || '';
        action.attribute = step.value || '';
        action.expected = step.expectedValue || '';
        break;

      case 'assertCount':
        action.selector = step.selector || step.normalizedSelector || '';
        action.expected = parseInt(step.expectedValue) || 0;
        break;

      case 'assertValue':
        action.selector = step.selector || step.normalizedSelector || '';
        action.expected = step.expectedValue || '';
        break;

      case 'waitFor':
        action.delay = Number(step.ms) || 500;
        break;

      case 'waitForSelector':
        action.selector = step.selector || step.normalizedSelector || '';
        break;

      case 'screenshot':
        action.filename = step.filename || 'screenshot.png';
        break;

      case 'select':
        action.selector = step.selector || step.normalizedSelector || '';
        action.value = step.value || step.selectedText || '';
        break;

      case 'check':
      case 'uncheck':
        action.selector = step.selector || step.normalizedSelector || '';
        break;

      case 'selectRadio':
        action.selector = step.selector || step.normalizedSelector || '';
        action.value = step.value || '';
        break;

      case 'hover':
        action.selector = step.selector || step.normalizedSelector || '';
        break;

      case 'scroll':
        action.selector = step.selector || step.normalizedSelector || '';
        if (step.x !== undefined) action.x = step.x;
        if (step.y !== undefined) action.y = step.y;
        break;

      case 'keyPress':
        action.key = step.key || step.value || '';
        // T1.10 — modifier-key chord metadata so replay engines can dispatch
        // page.keyboard.press('Control+S') correctly.
        if (Array.isArray(step.modifiers) && step.modifiers.length > 0) {
          action.modifiers = step.modifiers.slice(0);
        }
        if (step.selector) action.selector = step.selector;
        break;

      case 'dragDrop':
        // T1.2 — preserve both endpoints. `selector` carries the source for
        // backwards compatibility with code paths that read `step.selector`.
        action.selector = step.sourceSelector || step.selector || '';
        action.sourceSelector = step.sourceSelector || step.selector || '';
        action.targetSelector = step.targetSelector || '';
        break;

      case 'fileUpload':
        // T1.3 — captured file metadata (names + sizes only — no bytes).
        action.selector = step.selector || step.normalizedSelector || '';
        action.value = step.value || (Array.isArray(step.files) ? step.files.map(f => f.name).join(', ') : '');
        if (Array.isArray(step.files)) action.files = step.files.slice(0);
        break;

      case 'download':
        // T1.4 — Playwright-side capture, no DOM selector.
        if (step.filename) action.filename = step.filename;
        if (step.url) action.url = step.url;
        break;

      case 'popup':
        // T1.9 — Playwright-side capture, only the popup URL.
        if (step.url) action.url = step.url;
        break;

      default:
        // For unknown actions, include all properties
        if (step.selector) action.selector = step.selector;
        if (step.value) action.value = step.value;
        if (step.expectedValue) action.expected = step.expectedValue;
        if (step.url) action.url = step.url;
    }

    return action;
  });

  return JSON.stringify(zeroCodeActions, null, 2);
}

/**
 * Validate zero-code JSON format
 */
export function validateZeroCodeJson(jsonString) {
  try {
    const actions = JSON.parse(jsonString);
    if (!Array.isArray(actions)) {
      return { valid: false, error: 'Zero-code JSON must be an array' };
    }

    for (const action of actions) {
      if (!action.action) {
        return { valid: false, error: 'Each action must have an "action" property' };
      }
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

