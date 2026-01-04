// Normalization utilities for standardizing step names, page titles, and element identifiers

/**
 * Normalize page titles to a consistent format
 * Examples:
 *   "landing page" -> "Landing Page"
 *   "pre-eligibility page" -> "Pre-Eligibility Page"
 *   "financial_flow_page" -> "Financial Flow Page"
 */
export function normalizePageTitle(title) {
  if (!title) return 'Page';
  
  // Remove common suffixes/prefixes and clean up
  let normalized = title.trim()
    .toLowerCase()
    .replace(/\s*page\s*$/i, '') // Remove trailing "page"
    .replace(/^the\s+/i, '') // Remove leading "the"
    .replace(/[^\w\s-]/g, ' ') // Replace special chars with space
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
  
  // Handle common patterns
  const patterns = {
    'landing': 'Landing',
    'home': 'Home',
    'login': 'Login',
    'signup': 'Sign Up',
    'sign-up': 'Sign Up',
    'sign in': 'Sign In',
    'sign-in': 'Sign In',
    'preeligibility': 'Pre-Eligibility',
    'pre-eligibility': 'Pre-Eligibility',
    'prescreener': 'Pre-Screener',
    'pre-screener': 'Pre-Screener',
    'financial': 'Financial',
    'application': 'Application',
    'dashboard': 'Dashboard',
    'profile': 'Profile',
    'settings': 'Settings',
    'checkout': 'Checkout',
    'cart': 'Shopping Cart',
    'products': 'Products',
    'product': 'Product Details',
    'search': 'Search Results',
    'results': 'Results'
  };
  
  // Apply known patterns
  for (const [pattern, replacement] of Object.entries(patterns)) {
    if (normalized.includes(pattern)) {
      normalized = normalized.replace(pattern, replacement.toLowerCase());
    }
  }
  
  // Convert to Title Case
  normalized = normalized
    .split(/[\s_-]+/)
    .map(word => {
      // Handle special cases
      if (word === '') return '';
      // Handle abbreviations
      if (word.length <= 2 && word === word.toUpperCase()) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .filter(word => word.length > 0)
    .join(' ');
  
  // Add "Page" suffix
  return normalized + ' Page';
}

/**
 * Normalize element descriptions to readable, standardized format
 * Examples:
 *   "start_shopping" -> "Start Shopping"
 *   "btnSubmit" -> "Submit Button"
 *   "login-username-field" -> "Username Field"
 */
export function normalizeElementDescription(element) {
  if (!element) return 'Element';
  
  // Handle string input
  if (typeof element === 'string') {
    let normalized = element.trim();
    // Clean up common prefixes/suffixes
    normalized = normalized
      .replace(/^(btn|button|link|input|field|txt|lbl|label)-?/i, '') // Remove common prefixes
      .replace(/-?(btn|button|link|input|field|txt|lbl|label)$/i, '') // Remove common suffixes
      .replace(/^#/, '') // Remove CSS ID prefix
      .replace(/^\./, '') // Remove CSS class prefix
      .replace(/[_-]/g, ' ') // Replace underscores and hyphens with spaces
      .trim();
    
    // Capitalize words
    normalized = normalized.split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
    
    return normalized || 'Element';
  }
  
  // Handle object input - extract from different sources with priority
  // For inputs: prioritize placeholder, aria-label, name, id
  // For buttons/links: prioritize text, aria-label, title, id
  // For other elements: prioritize text, aria-label, title, id
  const tagName = (element.tagName || '').toLowerCase();
  const isInput = tagName === 'input' || tagName === 'textarea';
  const isButton = tagName === 'button' || tagName === 'a';
  
  let sources = [];
  
  if (isInput) {
    // For input fields, prioritize: placeholder, aria-label, name, id, type
    sources = [
      element.placeholder,
      element.ariaLabel,
      element.name,
      element.id,
      element.type ? `${element.type} input` : null,
      element.selector
    ].filter(Boolean);
  } else if (isButton) {
    // For buttons/links, prioritize: text, aria-label, title, id, value
    sources = [
      element.elementText,
      element.textContent,
      element.ariaLabel,
      element.title,
      element.value,
      element.id,
      element.selector
    ].filter(Boolean);
  } else {
    // For other elements (spans, divs, etc.), prioritize: text, aria-label, title, id
    // For spans with long text, truncate to first few words
    let textContent = element.textContent || element.elementText || '';
    
    // Also try to extract text from selector if textContent is not available
    if (!textContent && element.selector) {
      const textMatch = element.selector.match(/text=["']([^"']+)["']/i) || 
                       element.selector.match(/text=([^\s,]+)/i);
      if (textMatch && textMatch[1]) {
        textContent = textMatch[1].trim();
      }
    }
    
    if (textContent && textContent.trim().length > 0) {
      // Truncate long text to first 5-6 words for better readability
      const words = textContent.trim().split(/\s+/);
      if (words.length > 6) {
        textContent = words.slice(0, 6).join(' ') + '...';
      }
    }
    
    sources = [
      textContent,  // Always prioritize text content for spans/divs
      element.ariaLabel,
      element.title,
      element.id,
      element.name,
      element.dataTestId,
      element.selector
    ].filter(Boolean);
  }
  
  let normalized = sources.length > 0 ? String(sources[0]) : (tagName ? tagName.charAt(0).toUpperCase() + tagName.slice(1) : 'Element');
  
  // Special handling for spans and divs: if we only have tag name, try to extract from selector or add context
  if (normalized.toLowerCase() === 'span' || normalized.toLowerCase() === 'div' || normalized.toLowerCase() === tagName || normalized === 'Element') {
    // Try multiple strategies to get meaningful text
    
    // Strategy 1: Check if textContent was provided but not used (maybe it was empty string)
    let textContent = element.textContent || element.elementText || '';
    if (textContent && textContent.trim().length > 0) {
      const words = textContent.trim().split(/\s+/);
      normalized = words.length > 6 ? words.slice(0, 6).join(' ') + '...' : textContent.trim();
    }
    // Strategy 2: Extract text from selector
    else if (element.selector) {
      // Extract text from text= selector or has-text() selector
      const textMatch = element.selector.match(/text=["']([^"']+)["']/i) || 
                       element.selector.match(/has-text\(["']([^"']+)["']\)/i) ||
                       element.selector.match(/text=([^\s,]+)/i);
      if (textMatch && textMatch[1]) {
        const text = textMatch[1].trim();
        const words = text.split(/\s+/);
        normalized = words.length > 6 ? words.slice(0, 6).join(' ') + '...' : text;
      }
      // Try to extract from CSS selector with text content
      else if (element.selector.includes('::text') || element.selector.includes(':has-text')) {
        const parts = element.selector.split(/::text|:has-text/);
        if (parts.length > 1) {
          normalized = parts[0].replace(/[^\w\s]/g, ' ').trim() || normalized;
        }
      }
    }
    // Strategy 3: Use aria-label
    if ((normalized.toLowerCase() === 'span' || normalized.toLowerCase() === 'div' || normalized === 'Element') && element.ariaLabel) {
      normalized = element.ariaLabel;
    }
    // Strategy 4: Use id
    else if ((normalized.toLowerCase() === 'span' || normalized.toLowerCase() === 'div' || normalized === 'Element') && element.id) {
      normalized = element.id.replace(/[-_]/g, ' ');
    }
    // Strategy 5: Use className
    else if ((normalized.toLowerCase() === 'span' || normalized.toLowerCase() === 'div' || normalized === 'Element') && element.className) {
      const classes = (typeof element.className === 'string' ? element.className : '').split(/\s+/).filter(c => 
        c && c.length > 2 && !c.startsWith('css-') && !/^\d+$/.test(c) && !c.startsWith('a-')
      );
      if (classes.length > 0) {
        normalized = classes[0].replace(/[-_]/g, ' ');
      }
    }
    // Strategy 6: Use dataTestId
    else if ((normalized.toLowerCase() === 'span' || normalized.toLowerCase() === 'div' || normalized === 'Element') && element.dataTestId) {
      normalized = element.dataTestId.replace(/[-_]/g, ' ');
    }
  }
  
  // Clean up common prefixes/suffixes (but preserve meaningful text content)
  // Don't clean if it looks like actual content (has multiple words or is descriptive)
  const isDescriptiveText = normalized.split(/\s+/).length > 2 || normalized.length > 15;
  
  if (!isDescriptiveText) {
    normalized = normalized
      .toString()
      .trim()
      .replace(/^(btn|button|link|input|field|txt|lbl|label)-?/i, '') // Remove common prefixes
      .replace(/-?(btn|button|link|input|field|txt|lbl|label)$/i, '') // Remove common suffixes
      .replace(/^#/, '') // Remove CSS ID prefix
      .replace(/^\./, '') // Remove CSS class prefix
      .replace(/\[.*?\]/g, '') // Remove attribute selectors
      .trim();
  }
  
  // Always normalize whitespace and clean special chars (but preserve content)
  normalized = normalized
    .toString()
    .trim()
    .replace(/[^\w\s\-.,!?]/g, ' ') // Replace special chars but keep punctuation
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
  
  // Handle camelCase and snake_case
  normalized = normalized
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase -> camel Case
    .replace(/[-_]/g, ' ') // snake_case/kebab-case -> spaces
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
  
  // Convert to Title Case (but preserve product names, long text, etc.)
  // If it's descriptive text (long or has many words), preserve original capitalization better
  const isLongDescriptiveText = normalized.split(/\s+/).length > 4 || normalized.length > 30;
  
  if (!isLongDescriptiveText) {
    normalized = normalized
      .split(/\s+/)
      .map(word => {
        if (word.length === 0) return '';
        // Preserve common abbreviations
        if (['ID', 'API', 'URL', 'OK', 'FAQ', 'GB', 'GBP', 'USD', 'AI', 'S25', 'S24', 'S23'].includes(word.toUpperCase())) {
          return word.toUpperCase();
        }
        // Preserve numbers and special patterns
        if (/^\d+[A-Z]?$/.test(word) || /^[A-Z]\d+$/.test(word)) {
          return word;
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .filter(word => word.length > 0)
      .join(' ');
  } else {
    // For long descriptive text, just ensure first letter is capitalized
    normalized = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }
  
  // Add context if it's a common element type (but not for spans with long text)
  if (normalized.length > 0 && normalized.length < 100) {
    // Check if it already has context
    const hasContext = /\b(button|link|field|input|text|label|tab|menu|icon|product|item|title|heading)\b/i.test(normalized);
    if (!hasContext && element.tagName) {
      const tag = element.tagName.toLowerCase();
      if (tag === 'button' || (tag === 'a' && !normalized.toLowerCase().includes('link'))) {
        normalized = normalized + (normalized.toLowerCase().includes('button') ? '' : ' Button');
      } else if (tag === 'input') {
        normalized = normalized + (normalized.toLowerCase().includes('field') || normalized.toLowerCase().includes('input') ? '' : ' Field');
      } else if (tag === 'a' && !normalized.toLowerCase().includes('button')) {
        normalized = normalized + (normalized.toLowerCase().includes('link') ? '' : ' Link');
      } else if ((tag === 'span' || tag === 'div') && normalized.length > 20) {
        // For spans/divs with meaningful text, don't add "Span"/"Div" suffix
        // The text itself is descriptive enough
      } else if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
        normalized = normalized + (normalized.toLowerCase().includes('heading') ? '' : ' Heading');
      }
    }
  }
  
  // Final cleanup: if still just "span", "div", or tag name, try one more time
  if (normalized.toLowerCase() === tagName || normalized.toLowerCase() === 'span' || normalized.toLowerCase() === 'div' || normalized.toLowerCase() === 'element') {
    // Look for any meaningful attribute
    if (element.dataTestId) {
      normalized = element.dataTestId.replace(/[-_]/g, ' ');
    } else if (element.className && typeof element.className === 'string') {
      const classes = element.className.split(/\s+/).filter(c => 
        c && c.length > 2 && !c.startsWith('css-') && !/^\d+$/.test(c)
      );
      if (classes.length > 0) {
        normalized = classes[0].replace(/[-_]/g, ' ');
      }
    }
  }
  
  return normalized || 'Element';
}

/**
 * Normalize step names to follow BDD best practices
 * Examples:
 *   "I click on start shopping button" -> "I Click Start Shopping Button"
 *   "enter data in form" -> "I Enter Data In Form"
 */
export function normalizeStepName(stepText, keyword) {
  if (!stepText) return '';
  
  let normalized = stepText.trim();
  
  // Remove redundant words
  normalized = normalized
    .replace(/\b(on|at|in|to|from|with|for|the|a|an)\s+/gi, ' ') // Remove common prepositions
    .replace(/\s+(on|at|in|to|from|with|for|the|a|an)\b/gi, ' ') // Remove trailing prepositions
    .replace(/\b(click on|click|tap|press)\b/gi, 'Click') // Normalize click actions
    .replace(/\b(type|enter|input|fill|set)\b/gi, 'Enter') // Normalize input actions
    .replace(/\b(navigate|go to|visit|open|load)\b/gi, 'Navigate To') // Normalize navigation
    .replace(/\b(verify|check|assert|validate|ensure)\b/gi, 'Verify') // Normalize assertions
    .replace(/\b(see|view|display|show)\b/gi, 'See') // Normalize visibility
    .replace(/\b(should be|must be|is)\b/gi, 'Is') // Normalize state checks
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
  
  // Convert to Title Case
  normalized = normalized
    .split(/\s+/)
    .map(word => {
      if (word.length === 0) return '';
      // Preserve keywords as-is
      if (['Click', 'Enter', 'Navigate', 'Verify', 'See', 'Is', 'On', 'In', 'To'].includes(word)) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
  
  // Add "I" prefix for Given/When/Then steps if missing
  if ((keyword === 'Given' || keyword === 'When' || keyword === 'Then') && !/^I\s/i.test(normalized)) {
    normalized = 'I ' + normalized;
  }
  
  return normalized;
}

/**
 * Generate a clean, reusable selector from element information
 */
export function normalizeSelector(element) {
  if (!element || !element.selector) return '';
  
  let selector = element.selector.trim();
  
  // Prioritize stable selectors
  if (element.dataTestId) {
    return `[data-testid="${element.dataTestId}"]`;
  }
  
  if (element.id && element.id.trim()) {
    const id = element.id.trim().replace(/^#/, '');
    return `#${id}`;
  }
  
  if (element.name && element.name.trim()) {
    return `[name="${element.name}"]`;
  }
  
  // Try to extract meaningful parts from complex selectors
  if (selector.includes('has-text')) {
    const textMatch = selector.match(/has-text\(["']([^"']+)["']\)/);
    if (textMatch) {
      return `text="${textMatch[1]}"`;
    }
  }
  
  if (selector.includes('aria-label')) {
    const ariaMatch = selector.match(/\[aria-label=["']([^"']+)["']\]/);
    if (ariaMatch) {
      return `[aria-label="${ariaMatch[1]}"]`;
    }
  }
  
  // Return cleaned selector
  return selector.replace(/\s+/g, ' ').trim();
}

/**
 * Normalize form group descriptions
 */
export function normalizeFormDescription(actions, pageContext) {
  if (!actions || actions.length === 0) return 'Form Data';
  
  // Count field types
  const fieldTypes = new Set();
  actions.forEach(action => {
    if (action.selector) {
      const fieldName = normalizeElementDescription(action)
        .replace(/\s*(field|input|textbox)\s*$/i, '')
        .trim();
      if (fieldName && fieldName !== 'Element') {
        fieldTypes.add(fieldName);
      }
    }
  });
  
  if (fieldTypes.size === 0) return 'Form Data';
  
  // Generate description
  const fields = Array.from(fieldTypes).slice(0, 3); // Limit to first 3 fields
  let description = fields.join(', ');
  
  if (fieldTypes.size > 3) {
    description += ' and Others';
  }
  
  // Add page context if available
  if (pageContext) {
    const pageName = normalizePageTitle(pageContext);
    return `${description} On ${pageName}`;
  }
  
  return description;
}

/**
 * Clean and deduplicate steps
 */
export function deduplicateSteps(steps) {
  const seen = new Set();
  const cleaned = [];
  
  for (const step of steps) {
    // Create a unique key for the step
    const key = `${step.kind}:${step.selector || step.url || ''}:${step.value || ''}`;
    
    if (!seen.has(key)) {
      seen.add(key);
      cleaned.push(step);
    }
  }
  
  return cleaned;
}

/**
 * Extract meaningful page name from URL
 */
export function extractPageNameFromUrl(url) {
  if (!url) return 'Page';
  
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    
    // Handle common patterns
    if (path === '/' || path === '' || url.includes('localhost:3000')) {
      return 'Landing Page';
    }
    
    // Extract from path segments
    const segments = path.split('/').filter(s => s && s !== 'index' && s !== 'home');
    
    if (segments.length > 0) {
      const lastSegment = segments[segments.length - 1];
      return normalizePageTitle(lastSegment);
    }
    
    return 'Landing Page';
  } catch (e) {
    // Fallback parsing
    const matches = url.match(/\/([^\/?#]+)/);
    if (matches && matches[1]) {
      return normalizePageTitle(matches[1]);
    }
    return 'Page';
  }
}

export default {
  normalizePageTitle,
  normalizeElementDescription,
  normalizeStepName,
  normalizeSelector,
  normalizeFormDescription,
  deduplicateSteps,
  extractPageNameFromUrl
};


