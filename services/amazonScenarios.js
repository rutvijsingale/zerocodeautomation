/**
 * services/amazonScenarios.js
 *
 * Curated catalog of Amazon test plan scenarios (A–L from the spec).
 *
 * SAFETY CONTRACT (enforced by amazon_scenarios.test.mjs):
 *   1. Every credential / sensitive value is referenced as `${ENV_VAR}` only.
 *      No real email, password, OTP, or API key is ever inlined.
 *   2. Checkout-shaped scenarios stop BEFORE payment / final order placement.
 *      Each such scenario carries `requiresCheckoutGuard: true` and the
 *      renderer prints a safety banner.
 *   3. The negative-login scenario uses obviously-fake test data, never the
 *      real env credentials.
 *   4. Scenarios are pure data — no side effects, no network calls.
 *
 * Each scenario is consumable by `services/testPlanGenerator.js#renderTestPlan`.
 */

const APP_NAME = 'Amazon';
const APP_URL = 'https://www.amazon.com';

// Common env-var placeholders. The Java step defs already resolve these via
// `support.CredentialsHelper.resolve(...)` so the test plan can refer to them
// safely.
const CRED_USERNAME = '${AMAZON_USERNAME}';
const CRED_PASSWORD = '${AMAZON_PASSWORD}';

/**
 * Return all 12 scenarios A–L. Each scenario is shaped to feed
 * `renderTestPlan` directly (plus a `letter` field for ordering / lookup).
 *
 * @param {Object} ctx
 * @param {string} ctx.framework
 * @param {string} ctx.projectName
 * @returns {Array<Object>}
 */
export function listAmazonScenarios({ framework, projectName }) {
  if (!framework || !projectName) {
    throw new Error('listAmazonScenarios: framework and projectName are required');
  }
  const base = (extra) => ({
    framework,
    projectName,
    applicationName: APP_NAME,
    applicationUrl: APP_URL,
    ...extra,
  });

  return [
    /* A */ base({
      letter: 'A',
      scenarioId: 'amazon-open-home',
      title: 'A. Open Amazon home page',
      objective: 'Confirm the home page loads and the primary navigation chrome is visible.',
      preconditions: ['Internet access to amazon.com', 'No prior session required'],
      credentialsSource: null,
      steps: [
        '1. Navigate to `https://www.amazon.com`.',
        '2. Wait for the page to reach `domcontentloaded`.',
        '3. Validate the global search input is visible (`#twotabsearchtextbox`).',
        '4. Validate the navigation header is visible (`#nav-main`).',
        '5. Validate the primary logo is rendered (`#nav-logo-sprites`).',
      ],
      expectedResults: ['Home page renders within 10 s', 'Search bar accepts focus', 'No 5xx response codes'],
      replayValidationPoints: ['Locator healer is NOT triggered on the happy path'],
    }),

    /* B */ base({
      letter: 'B',
      scenarioId: 'amazon-login',
      title: 'B. Sign in (positive)',
      objective: 'Authenticate with credentials supplied via environment variables.',
      preconditions: [
        `Environment variables set: \`AMAZON_USERNAME\`, \`AMAZON_PASSWORD\``,
        'Account is not currently locked / OTP-challenged',
      ],
      credentialsSource: { username: CRED_USERNAME, password: CRED_PASSWORD },
      steps: [
        '1. Navigate to the Sign-In page (`#nav-link-accountList`).',
        `2. Type ${CRED_USERNAME} into the email field (`+ '`#ap_email`' + ').',
        '3. Click **Continue** (`#continue`).',
        `4. Type ${CRED_PASSWORD} into the password field (`+ '`#ap_password`' + ').',
        '5. Click **Sign-In** (`#signInSubmit`).',
        '6. Validate the account name appears in `#nav-link-accountList-nav-line-1`.',
      ],
      expectedResults: ['User session established', 'No password value appears in logs / screenshots / traces'],
      negativeScenarios: ['See scenario K (invalid credentials)'],
      cleanupSteps: ['Sign out at the end of the suite (scenario reversed via `#nav-item-signout`)'],
      limitations: [
        'Captcha / OTP challenges abort the run with a clear message; the framework does not bypass them.',
      ],
    }),

    /* C */ base({
      letter: 'C',
      scenarioId: 'amazon-search-product',
      title: 'C. Search for a product',
      objective: 'Issue a free-text product search and confirm the results page loads.',
      preconditions: ['Home page is reachable'],
      testData: { searchTerm: 'wireless headphones' },
      steps: [
        '1. Navigate to `https://www.amazon.com`.',
        '2. Type `wireless headphones` into `#twotabsearchtextbox`.',
        '3. Submit the form (`#nav-search-submit-button`).',
        '4. Wait for the results container `[data-component-type="s-search-result"]`.',
        '5. Validate the result count is at least 1.',
      ],
      expectedResults: ['Results page loads under the `/s` URL', 'At least one product card renders'],
    }),

    /* D */ base({
      letter: 'D',
      scenarioId: 'amazon-scroll-results',
      title: 'D. Scroll search results',
      objective: 'Exercise the scroll recorder against a paginated, lazy-loading results page.',
      preconditions: ['Scenario C has loaded a results page'],
      steps: [
        '1. Capture the initial visible product cards.',
        '2. Scroll **down** in 800 px increments until the page bottom is reached.',
        '3. After each scroll pause for 600 ms so lazy-loaded cards finish rendering.',
        '4. Capture the locator candidates for the *first* product visible only after scroll.',
        '5. Scroll back to top (mode = `top`) and verify the first card is unchanged.',
      ],
      scrollDependentElements: [
        'Product cards rendered after the first viewport (>= y ≈ 800 px)',
        'Sponsored result strips that hydrate on scroll',
      ],
      expectedResults: [
        'Scroll events are recorded with `direction`, `mode`, and `targetElementMetadata`',
        'Element locators captured for items that appeared only after scroll',
      ],
      replayValidationPoints: [
        'Replay scrolls in the same order; healer\'s `scrollIntoViewIfNeeded` rescues any newly-positioned card',
      ],
    }),

    /* E */ base({
      letter: 'E',
      scenarioId: 'amazon-apply-filters',
      title: 'E. Apply filters on a results page',
      objective: 'Apply category / brand / price / rating / delivery filters where available.',
      preconditions: ['Scenario C produced a results page'],
      steps: [
        '1. Scroll the left rail into view (filters live below the fold for some viewports).',
        '2. Click the **Brand** filter checkbox for any visible brand.',
        '3. Wait for the URL to update with the filter query param.',
        '4. Validate the result count changes (it may go up or down).',
        '5. Optionally apply a **4 stars & up** rating filter and re-validate.',
      ],
      scrollDependentElements: ['Filter checkboxes (left rail) on viewports under 900 px height'],
      expectedResults: ['Each filter changes the URL', 'No 5xx response codes', 'Result list refreshes'],
    }),

    /* F */ base({
      letter: 'F',
      scenarioId: 'amazon-sort-results',
      title: 'F. Sort results',
      objective: 'Change the sort order of the results page and confirm reload.',
      preconditions: ['Scenario C produced a results page'],
      steps: [
        '1. Click the **Sort** dropdown (`#a-autoid-0-announce`).',
        '2. Select **Price: Low to High**.',
        '3. Wait for the results to refresh.',
        '4. Validate the first result\'s price is less than or equal to the second result\'s.',
      ],
      expectedResults: ['URL contains `s=price-asc-rank` (or equivalent)', 'Result order is non-decreasing by price'],
    }),

    /* G */ base({
      letter: 'G',
      scenarioId: 'amazon-product-details',
      title: 'G. Open a product details page',
      objective: 'Validate the PDP renders all primary above-the-fold elements and exercise scroll-only sections.',
      preconditions: ['A search results page is loaded'],
      steps: [
        '1. Click the first product title (`h2 a.a-link-normal`).',
        '2. Wait for `#productTitle` to be visible.',
        '3. Validate price (`.a-price`), rating (`#acrPopover`), images (`#imgTagWrapperId img`), availability (`#availability`).',
        '4. Scroll **down** to bring the **Product description** section into view (`#productDescription`).',
        '5. Continue scrolling to the **Customer reviews** section (`#cm-cr-dp-review-list`).',
        '6. Capture locator candidates for review cards visible only after scroll.',
      ],
      scrollDependentElements: ['Product description', 'Specifications', 'Customer reviews'],
      expectedResults: ['PDP loads under 8 s', 'All scroll-revealed sections become visible without manual intervention'],
    }),

    /* H */ base({
      letter: 'H',
      scenarioId: 'amazon-add-to-cart',
      title: 'H. Add product to cart (no payment)',
      objective: 'Add the current product to the cart and verify the cart count increments.',
      requiresCheckoutGuard: true,
      preconditions: ['Scenario G has loaded a PDP', 'User is signed in (scenario B)'],
      steps: [
        '1. Click **Add to Cart** (`#add-to-cart-button`).',
        '2. Wait for the confirmation panel (`#sw-atc-details-single-container` or `[data-feature-name="addedToCart"]`).',
        '3. Validate the cart count badge (`#nav-cart-count`) increments by 1.',
        '4. **Stop here.** Do not proceed to the order summary, do not navigate to `/gp/buy/`, do not click Buy Now.',
      ],
      expectedResults: ['Cart count increments by exactly 1', 'No payment / order URL is opened'],
      cleanupSteps: ['Scenario I removes the test item from the cart'],
      limitations: [
        '⚠️ This scenario stops BEFORE payment by design. Extending it to place a real order is forbidden.',
      ],
    }),

    /* I */ base({
      letter: 'I',
      scenarioId: 'amazon-cart-validation',
      title: 'I. Cart validation and cleanup',
      objective: 'Open the cart, validate the test item is present, then remove it.',
      requiresCheckoutGuard: true,
      preconditions: ['Scenario H added a test item'],
      steps: [
        '1. Click the cart icon (`#nav-cart`).',
        '2. Wait for the cart page (`#sc-active-cart`).',
        '3. Validate the test product appears at least once.',
        '4. Optionally update quantity from 1 → 1 (no-op write to confirm controls work).',
        '5. Click **Delete** for the test item (`input[value="Delete"]`).',
        '6. Validate the cart is empty or the count decreased by 1.',
        '7. **Stop.** Do not proceed to checkout.',
      ],
      expectedResults: ['Test item removed; cart count restored to its pre-test value'],
    }),

    /* J */ base({
      letter: 'J',
      scenarioId: 'amazon-save-for-later',
      title: 'J. Save for Later (optional, only if available)',
      objective: 'If the cart shows a Save for Later option for the test item, exercise it.',
      preconditions: ['A test item is in the cart (scenario H)', 'Save for Later is visible — feature gating may hide it'],
      steps: [
        '1. Click **Save for later** next to the test item.',
        '2. Validate the item moves to the **Saved for later** section (`#sc-saved-cart`).',
        '3. Move it back to the cart, then delete it (scenario I cleanup).',
      ],
      expectedResults: ['Item appears in Saved for later', 'No irreversible account-level change'],
      limitations: ['Skipped automatically when the Save for Later control is absent for the test account.'],
    }),

    /* K */ base({
      letter: 'K',
      scenarioId: 'amazon-login-negative',
      title: 'K. Sign in with invalid credentials (negative)',
      objective: 'Verify the error message for an obviously-bad credential pair without locking the real account.',
      preconditions: [
        'Use synthetic test data (NOT the real `AMAZON_PASSWORD`).',
        'The real account is signed out before this scenario runs.',
      ],
      // Synthetic data only — never the real password.
      testData: {
        invalidEmail: 'zac-test-invalid@example.invalid',
        invalidPassword: '<obviously-wrong synthetic value, not from env>',
      },
      steps: [
        '1. Navigate to the Sign-In page.',
        '2. Type the synthetic invalid email into `#ap_email`.',
        '3. Click Continue.',
        '4. If a password field appears, type the synthetic invalid password into `#ap_password`.',
        '5. Click Sign-In.',
        '6. Validate the error banner contains text such as "There was a problem".',
        '7. **Stop after one failed attempt** to avoid triggering account lockout / captcha.',
      ],
      expectedResults: ['Sign-in fails with a visible error', 'No real password is ever transmitted'],
      limitations: ['Single attempt only. Repeated runs may eventually trigger captcha — abort if encountered.'],
    }),

    /* M */ base({
      letter: 'M',
      scenarioId: 'amazon-sony-wh-ch520-end-to-end',
      title: 'M. Sony WH-CH520 — login → search → assert → add to cart → logout (end-to-end)',
      objective:
        'Drive a complete user journey: sign in, search for the Sony WH-CH520 headphones, ' +
        'verify the product card / PDP, add it to the cart, then sign out. Stops BEFORE payment.',
      requiresCheckoutGuard: true,
      preconditions: [
        'Environment variables set: `AMAZON_USERNAME`, `AMAZON_PASSWORD`',
        'Account is not currently OTP-challenged or locked',
        'Internet access to amazon.com',
      ],
      credentialsSource: { username: CRED_USERNAME, password: CRED_PASSWORD },
      testData: { searchTerm: 'Sony WH-CH520', expectedProductSubstring: 'WH-CH520' },
      steps: [
        // Sign in
        '1. Navigate to `https://www.amazon.com`.',
        '2. Click the sign-in link (`#nav-link-accountList`).',
        `3. Type ${CRED_USERNAME} into \`#ap_email\`.`,
        '4. Click **Continue** (`#continue`).',
        `5. Type ${CRED_PASSWORD} into \`#ap_password\`.`,
        '6. Click **Sign-In** (`#signInSubmit`).',
        '7. Validate the account name appears in `#nav-link-accountList-nav-line-1`.',
        // Search
        '8. Type `Sony WH-CH520` into the search box (`#twotabsearchtextbox`).',
        '9. Click the search submit button (`#nav-search-submit-button`).',
        '10. Wait for the results container `[data-component-type="s-search-result"]`.',
        // Scroll + assert
        '11. Scroll **down** ~600 px so the Sony WH-CH520 cards are inside the viewport.',
        '12. Assert at least one search result contains the text **WH-CH520**.',
        '13. Click the first matching product title.',
        // PDP + add to cart
        '14. Wait for `#productTitle` to be visible.',
        '15. Validate the product title contains `WH-CH520`.',
        '16. Click **Add to Cart** (`#add-to-cart-button`).',
        '17. Wait for the confirmation panel (`[data-feature-name="addedToCart"]` or `#sw-atc-details-single-container`).',
        '18. Validate `#nav-cart-count` increments by 1.',
        '19. **Stop.** Do not navigate to `/gp/buy/`, do not click Buy Now, do not enter payment info.',
        // Sign out
        '20. Hover over the account menu (`#nav-link-accountList`).',
        '21. Click **Sign Out** (`#nav-item-signout`).',
        '22. Validate the sign-in link is visible again on the home page.',
      ],
      scrollDependentElements: [
        'Lower-positioned search result cards on long results pages',
        'Sponsored result strips that hydrate on scroll',
      ],
      expectedResults: [
        'User signs in successfully (no captcha / OTP encountered)',
        'Search returns at least one Sony WH-CH520 result',
        'Add-to-cart confirmation panel renders, `#nav-cart-count` increments by 1',
        'User signs out and lands back on an anonymous home page',
      ],
      replayValidationPoints: [
        'Replay scrolls before clicking the product card so it is in view',
        'Locator healing rescues `#add-to-cart-button` if Amazon rotates to a variant id',
        'Healer falls back to `role=button[name="Add to Cart"]` when the primary id is gone',
        'Cart cleanup: scenario I removes the test item if the rerun is aborted mid-flow',
      ],
      negativeScenarios: ['Scenario K covers invalid-credential error path'],
      cleanupSteps: [
        'If rerun is interrupted with the product still in the cart, run scenario I afterwards to remove it.',
      ],
      limitations: [
        '⚠️ This scenario stops BEFORE payment by design. Extending it to place a real order is forbidden.',
        'Captcha / OTP challenges abort the run with a clear message; the framework does not bypass them.',
        'Sony WH-CH520 stock / SKU may change — the assertion uses substring match (`WH-CH520`) to tolerate variants.',
      ],
    }),

    /* L */ base({
      letter: 'L',
      scenarioId: 'amazon-replay-validation',
      title: 'L. Replay the recorded scenario',
      objective: 'Replay one of the prior recordings and validate the scroll + healer machinery.',
      preconditions: ['At least one prior recording exists in `recordings/`'],
      steps: [
        '1. Pick the most recent recording from `recordings/`.',
        '2. POST `/api/rerun` with the recording\'s steps and `projectId` set so heal events persist.',
        '3. Confirm the rerun report lands under `reruns/<test-name>/<timestamp>/replay-result.json`.',
        '4. Confirm any heal events are appended to `locators/healed-locators.json`.',
      ],
      replayValidationPoints: [
        'Scroll events execute in recorded order',
        'Lazy-loaded elements are reachable via the healer\'s `scrollIntoViewIfNeeded`',
        'Healed locators are unique (no ambiguous match silently selected)',
        'Replay artifacts are confined to the framework project folder',
      ],
    }),
  ];
}

/**
 * Sanity-check helper used by tests AND by the generator endpoint to refuse
 * to write a plan that contains literal credentials. Returns an array of
 * offending strings (empty when safe).
 *
 * @param {string} markdown
 * @returns {Array<string>}
 */
// RFC 2606 reserved test domains — emails on these are demonstrably synthetic
// and should never be flagged as a leak.
const SYNTHETIC_EMAIL_RE = /@(?:[\w.-]+\.)?(?:example\.(?:com|org|net|invalid)|invalid|test|localhost)$/i;

/**
 * Build a runnable action sequence for scenario M (Sony WH-CH520 e2e).
 *
 * The shape of each entry matches what /api/recording/:sessionId/action
 * accepts AND what /api/rerun's step handlers consume:
 *   - `kind`: action verb (navigate / click / type / scroll / assertVisible / hover)
 *   - `selector`: primary CSS / XPath / role selector
 *   - `value`: typed text or env-var ref
 *   - `locatorCandidates[]`: ordered list of fallbacks for the healer
 *   - `pageUrl`, `scrollY`, `elementMetadata`: extra context the recorder
 *     normally captures from the live DOM
 *
 * Credentials use ${AMAZON_USERNAME} / ${AMAZON_PASSWORD} placeholders. The
 * step handlers (and CredentialsHelper.java) resolve them from environment
 * variables at runtime so no real secret is ever serialized to disk.
 *
 * @returns {Array<Object>}
 */
export function getAmazonSonyWhCh520Steps() {
  const URL = 'https://www.amazon.com';
  const t = Date.now();
  let i = 0;
  const next = () => t + (++i * 50);

  return [
    {
      kind: 'navigate', url: URL, pageUrl: URL,
      pageTitle: 'Amazon.com', timestamp: next(),
    },
    {
      kind: 'click', selector: '#nav-link-accountList', tagName: 'a', pageUrl: URL,
      textContent: 'Hello, sign in Account & Lists',
      ariaLabel: 'Hello, sign in Account & Lists',
      locatorCandidates: [
        { type: 'id', selector: '#nav-link-accountList', unique: true },
        { type: 'css', selector: 'a#nav-link-accountList', unique: true },
        { type: 'role', selector: 'role=link[name="Hello, sign in Account & Lists"]', unique: true },
        { type: 'text', selector: 'text=Sign in', unique: false },
      ],
      primaryLocatorIndex: 0,
      elementMetadata: { tag: 'a', role: 'link' },
      timestamp: next(),
    },
    {
      kind: 'type', selector: '#ap_email', tagName: 'input',
      value: '${AMAZON_USERNAME}',
      placeholder: 'Email or mobile phone number',
      pageUrl: `${URL}/ap/signin`,
      locatorCandidates: [
        { type: 'id', selector: '#ap_email', unique: true },
        { type: 'css', selector: 'input[type="email"]', unique: false },
        { type: 'name', selector: 'input[name="email"]', unique: true },
      ],
      primaryLocatorIndex: 0,
      elementMetadata: { tag: 'input', type: 'email' },
      timestamp: next(),
    },
    {
      kind: 'click', selector: '#continue', tagName: 'input',
      textContent: 'Continue', pageUrl: `${URL}/ap/signin`,
      locatorCandidates: [
        { type: 'id', selector: '#continue', unique: true },
        { type: 'css', selector: 'input#continue[type="submit"]', unique: true },
        { type: 'role', selector: 'role=button[name="Continue"]', unique: false },
      ],
      primaryLocatorIndex: 0,
      elementMetadata: { tag: 'input', type: 'submit', text: 'Continue' },
      timestamp: next(),
    },
    {
      kind: 'type', selector: '#ap_password', tagName: 'input',
      value: '${AMAZON_PASSWORD}',
      pageUrl: `${URL}/ap/signin`,
      locatorCandidates: [
        { type: 'id', selector: '#ap_password', unique: true },
        { type: 'css', selector: 'input[type="password"]', unique: false },
        { type: 'name', selector: 'input[name="password"]', unique: true },
      ],
      primaryLocatorIndex: 0,
      elementMetadata: { tag: 'input', type: 'password' },
      timestamp: next(),
    },
    {
      kind: 'click', selector: '#signInSubmit', tagName: 'input',
      textContent: 'Sign-In', pageUrl: `${URL}/ap/signin`,
      locatorCandidates: [
        { type: 'id', selector: '#signInSubmit', unique: true },
        { type: 'css', selector: 'input#signInSubmit[type="submit"]', unique: true },
        { type: 'role', selector: 'role=button[name="Sign-In"]', unique: false },
      ],
      primaryLocatorIndex: 0,
      elementMetadata: { tag: 'input', type: 'submit', text: 'Sign-In' },
      timestamp: next(),
    },
    {
      kind: 'assertVisible', selector: '#nav-link-accountList-nav-line-1',
      pageUrl: URL,
      locatorCandidates: [
        { type: 'id', selector: '#nav-link-accountList-nav-line-1', unique: true },
        { type: 'css', selector: '#nav-link-accountList .nav-line-1', unique: true },
      ],
      primaryLocatorIndex: 0,
      elementMetadata: { tag: 'span' },
      timestamp: next(),
    },
    {
      kind: 'type', selector: '#twotabsearchtextbox', tagName: 'input',
      value: 'Sony WH-CH520',
      placeholder: 'Search Amazon',
      pageUrl: URL,
      locatorCandidates: [
        { type: 'id', selector: '#twotabsearchtextbox', unique: true },
        { type: 'name', selector: 'input[name="field-keywords"]', unique: true },
        { type: 'placeholder', selector: 'placeholder=Search Amazon', unique: true },
        { type: 'role', selector: 'role=searchbox', unique: false },
      ],
      primaryLocatorIndex: 0,
      elementMetadata: { tag: 'input', type: 'text', role: 'searchbox' },
      timestamp: next(),
    },
    {
      kind: 'click', selector: '#nav-search-submit-button', tagName: 'input',
      textContent: 'Go', pageUrl: URL,
      locatorCandidates: [
        { type: 'id', selector: '#nav-search-submit-button', unique: true },
        { type: 'css', selector: 'input.nav-input[type="submit"]', unique: false },
        { type: 'role', selector: 'role=button[name="Go"]', unique: false },
      ],
      primaryLocatorIndex: 0,
      elementMetadata: { tag: 'input', type: 'submit', text: 'Go' },
      timestamp: next(),
    },
    {
      kind: 'scroll',
      scrollX: 0, scrollY: 600, direction: 'down', reason: 'element_search',
      pageUrl: `${URL}/s?k=Sony+WH-CH520`,
      viewportHeight: 720, viewportWidth: 1280,
      scroll: {
        mode: 'y', y: 600, direction: 'down', reason: 'element_search',
        targetElementVisibleAfter: true,
      },
      targetElementMetadata: { tag: 'div', text: 'Sony WH-CH520' },
      timestamp: next(),
    },
    {
      kind: 'assertVisible',
      selector: 'div[data-component-type="s-search-result"]:has-text("WH-CH520")',
      pageUrl: `${URL}/s?k=Sony+WH-CH520`,
      scrollY: 600,
      locatorCandidates: [
        { type: 'css', selector: 'div[data-component-type="s-search-result"]:has-text("WH-CH520")', unique: false },
        { type: 'text', selector: 'text=Sony WH-CH520', unique: false },
        { type: 'xpath', selector: '//span[contains(text(),"WH-CH520")]', unique: false },
      ],
      primaryLocatorIndex: 0,
      elementMetadata: { tag: 'div', text: 'Sony WH-CH520' },
      timestamp: next(),
    },
    {
      kind: 'click',
      selector: 'div[data-component-type="s-search-result"]:has-text("WH-CH520") h2 a',
      textContent: 'Sony WH-CH520 Wireless Headphones',
      pageUrl: `${URL}/s?k=Sony+WH-CH520`,
      scrollY: 600,
      locatorCandidates: [
        { type: 'css', selector: 'div[data-component-type="s-search-result"]:has-text("WH-CH520") h2 a', unique: false },
        { type: 'role', selector: 'role=link[name=/Sony WH-CH520/i]', unique: false },
        { type: 'xpath', selector: '//h2//a[contains(., "WH-CH520")]', unique: false },
      ],
      primaryLocatorIndex: 0,
      elementMetadata: { tag: 'a', role: 'link', text: 'Sony WH-CH520' },
      timestamp: next(),
    },
    {
      kind: 'assertVisible', selector: '#productTitle',
      pageUrl: `${URL}/dp/<sku>`,
      locatorCandidates: [
        { type: 'id', selector: '#productTitle', unique: true },
        { type: 'css', selector: 'span#productTitle', unique: true },
      ],
      primaryLocatorIndex: 0,
      elementMetadata: { tag: 'span' },
      timestamp: next(),
    },
    {
      kind: 'click', selector: '#add-to-cart-button', tagName: 'input',
      textContent: 'Add to Cart',
      pageUrl: `${URL}/dp/<sku>`,
      locatorCandidates: [
        { type: 'id', selector: '#add-to-cart-button', unique: true },
        { type: 'css', selector: 'input[name="submit.add-to-cart"]', unique: true },
        { type: 'role', selector: 'role=button[name="Add to Cart"]', unique: true },
        { type: 'text', selector: 'text=Add to Cart', unique: false },
      ],
      primaryLocatorIndex: 0,
      elementMetadata: { tag: 'input', type: 'submit', text: 'Add to Cart' },
      timestamp: next(),
    },
    {
      kind: 'assertVisible',
      selector: '[data-feature-name="addedToCart"], #sw-atc-details-single-container',
      pageUrl: `${URL}/cart/add-to-cart`,
      locatorCandidates: [
        { type: 'css', selector: '[data-feature-name="addedToCart"]', unique: false },
        { type: 'id', selector: '#sw-atc-details-single-container', unique: true },
        { type: 'text', selector: 'text=Added to Cart', unique: false },
      ],
      primaryLocatorIndex: 0,
      elementMetadata: { tag: 'div' },
      timestamp: next(),
    },
    {
      kind: 'hover', selector: '#nav-link-accountList', pageUrl: URL,
      locatorCandidates: [
        { type: 'id', selector: '#nav-link-accountList', unique: true },
        { type: 'css', selector: 'a#nav-link-accountList', unique: true },
      ],
      primaryLocatorIndex: 0,
      timestamp: next(),
    },
    {
      kind: 'click', selector: '#nav-item-signout', tagName: 'a',
      textContent: 'Sign Out', pageUrl: URL,
      locatorCandidates: [
        { type: 'id', selector: '#nav-item-signout', unique: true },
        { type: 'css', selector: 'a[href*="signout"]', unique: false },
        { type: 'role', selector: 'role=link[name="Sign Out"]', unique: false },
        { type: 'text', selector: 'text=Sign Out', unique: false },
      ],
      primaryLocatorIndex: 0,
      elementMetadata: { tag: 'a', role: 'link', text: 'Sign Out' },
      timestamp: next(),
    },
    {
      kind: 'assertVisible', selector: '#nav-link-accountList',
      pageUrl: URL,
      locatorCandidates: [
        { type: 'id', selector: '#nav-link-accountList', unique: true },
        { type: 'text', selector: 'text=Hello, sign in', unique: false },
      ],
      primaryLocatorIndex: 0,
      elementMetadata: { tag: 'a', role: 'link' },
      timestamp: next(),
    },
  ];
}

export function findCredentialLeaks(markdown) {
  if (!markdown) return [];
  const offenders = [];
  const text = String(markdown);

  // 1) Real-looking emails. We allow any email at a synthetic / reserved
  //    domain (example.com, *.invalid, etc.) because the K scenario uses one.
  const emailRe = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;
  for (const match of text.matchAll(emailRe)) {
    const email = match[0];
    if (SYNTHETIC_EMAIL_RE.test(email)) continue;
    offenders.push(email);
  }

  // 2) `password: <something not env-var>` — ignore values inside <...> placeholders
  //    or `${...}` env refs.
  const passwordRe = /(?:^|[^\w])password\s*[:=]\s*([^\s`<]+)/i;
  const pw = text.match(passwordRe);
  if (pw && pw[1] && !pw[1].startsWith('${') && !pw[1].startsWith('***')) {
    offenders.push(pw[0]);
  }
  return offenders;
}
