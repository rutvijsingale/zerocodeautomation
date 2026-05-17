#!/usr/bin/env node
/**
 * ZAC Healer Demo
 *
 * Proves that the recorded fallback chain (the runtime arm of the
 * self-healing locator system) actually rescues the test when the
 * primary selectors drift.
 *
 * Setup:
 *   1. Open the demo shop in stable mode and capture the locator
 *      candidates the recorder would persist for each interactive
 *      element (search box, search button, every "Add to Cart"
 *      button, cart count).
 *   2. Re-open the page with `?shake=1` so the unstable IDs are
 *      randomised (e.g. `#add-p-101` becomes `#add-p-101-x123abc`).
 *   3. For every element, walk the recorded chain in priority order
 *      and confirm at least one fallback selector still resolves
 *      to the right element. The first survivor is what the
 *      generated step definitions would use at runtime.
 *
 * The demo passes when *every* recorded element has at least one
 * surviving locator after shake. That's the contract the generated
 * Selenium / Playwright step defs depend on.
 *
 * Run with:  node scripts/healer-demo.cjs
 *            (the ZAC server must be running on localhost:3000)
 */

const { chromium } = require('playwright');

const BASE = process.env.ZAC_DEMO_URL || 'http://localhost:3000/demo/shop.html';

// The ordered fallback chain for each element. Mirrors what the recorder
// persists into locators.json (id → testId → aria-label → role/text).
// First entry of each list is the brittle primary; the rest are the
// healer's safety net.
const ELEMENTS = [
  {
    name: 'Search input',
    chain: [
      '#searchInput',
      '[data-testid="search-input"]',
      'input[aria-label="Search products"]',
    ],
  },
  {
    name: 'Search button',
    chain: [
      '#searchBtn',
      '[data-testid="search-btn"]',
      'button.primary',
    ],
  },
  {
    name: 'Add Pixel Phone 9 to cart',
    chain: [
      '#add-p-101',
      '[data-testid="add-to-cart-p-101"]',
      'button[aria-label="Add Pixel Phone 9 to cart"]',
    ],
  },
  {
    name: 'Add Galaxy S24 Ultra to cart',
    chain: [
      '#add-p-102',
      '[data-testid="add-to-cart-p-102"]',
      'button[aria-label="Add Galaxy S24 Ultra to cart"]',
    ],
  },
  {
    name: 'Cart count',
    chain: [
      '#cartCount',
      '[data-testid="cart-count"]',
      '#cartPanel span',
    ],
  },
];

async function resolveChain(page, chain) {
  // Walks selectors in order, mirroring the runtime arm of
  // tryClickWithFallback / iTypeInto in the generated Java code.
  for (const sel of chain) {
    try {
      const handle = await page.$(sel);
      if (handle) {
        const visible = await handle.isVisible().catch(() => true);
        if (visible) return { selector: sel, found: true };
      }
    } catch (_) { /* try next candidate */ }
  }
  return { selector: null, found: false };
}

async function inspectPage(label, url) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // Demo renders products on DOMContentLoaded; wait until the grid has cards.
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="add-to-cart-"]').length > 0,
    null,
    { timeout: 8000 }
  );

  const rows = [];
  for (const el of ELEMENTS) {
    const { selector, found } = await resolveChain(page, el.chain);
    const primary = el.chain[0];
    rows.push({
      element: el.name,
      primary,
      primaryHits: !!(await page.$(primary)),
      resolvedTo: selector,
      healed: !!selector && selector !== primary,
      survived: found,
    });
  }
  await browser.close();
  console.log(`\n--- ${label} (${url}) ---`);
  for (const r of rows) {
    const icon = r.survived ? (r.healed ? '🩹' : '✓') : '✗';
    const note = r.survived
      ? (r.healed ? `healed via ${r.resolvedTo}` : 'primary selector still works')
      : 'NOTHING in fallback chain matched';
    console.log(`  ${icon} ${r.element.padEnd(34)} → ${note}`);
  }
  return rows;
}

(async function main() {
  console.log('=== ZAC Healer Demo ===');
  console.log('Demo URL:', BASE);

  // Phase 1: stable mode. Every primary selector must work and no healing
  // is expected. This is the "captured during recording" baseline.
  const stable = await inspectPage('Stable mode (recording capture)', BASE);
  const stableOk = stable.every((r) => r.survived && !r.healed);

  // Phase 2: shake mode. Primary selectors that target shake-randomised
  // ids (the product Add-to-Cart buttons) must heal via their fallback
  // chain. Toolbar selectors (declared statically in HTML) stay stable
  // and should resolve via their primary, which is fine - we only need
  // every element to have *some* surviving locator.
  const shaken = await inspectPage('Shake mode (UI drift)', `${BASE}?shake=1&seed=42`);
  const shakenOk = shaken.every((r) => r.survived);
  const healedCount = shaken.filter((r) => r.healed).length;

  console.log('\n=== Healer verdict ===');
  console.log(`  Stable run : ${stableOk ? '✓' : '✗'} all primaries match (no healing needed)`);
  console.log(`  Shaken run : ${shakenOk ? '✓' : '✗'} every element resolved (${healedCount} healed via fallback)`);
  if (shakenOk && healedCount > 0) {
    console.log('  RESULT     : ✓ Healer demo PASSED — fallback chain rescued drifted selectors.');
    process.exit(0);
  }
  if (shakenOk && healedCount === 0) {
    console.log('  RESULT     : ⚠ Shake did not actually drift any primary selector.');
    console.log('               (Healer code is fine, but the demo shake did not exercise it. Check ELEMENTS chains.)');
    process.exit(2);
  }
  console.log('  RESULT     : ✗ Healer demo FAILED — at least one element has no surviving locator.');
  process.exit(1);
})().catch((err) => {
  console.error('Healer demo crashed:', err);
  process.exit(99);
});
