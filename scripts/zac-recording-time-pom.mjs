#!/usr/bin/env node
/**
 * Recording-time POM + multi-env + protected-region demo.
 *
 * Walks through the exact flow a real Automation Engineer / QA team
 * would use, end-to-end, from "click Save in the IDE" to "I edited
 * a page class to add an executeLogin() wrapper and re-generated and
 * my edit is still there".
 *
 *   1. Create a project with EXPLICIT environments[] (QA / STAGE / DEV).
 *   2. Append a scenario whose tags include @<Name>Page tags AND a
 *      `pageBoundary` step that names where the next page begins
 *      (the "📄 New Page" button on the recording UI emits this kind
 *      of action).
 *   3. Hit /generate-files with `pomMode: true` — the response includes
 *      auto-generated POM classes (LoginPage / InventoryPage / …) and
 *      .env.qa / .env.stage / .env.dev config files.
 *   4. Open one page class and add a hand-written `executeLogin()`
 *      method OUTSIDE the // ZAC-MANAGED-BEGIN / END fence.
 *   5. Re-record / change a step and call /generate-files again.
 *   6. Verify the auto-generated body refreshed AND the hand-written
 *      executeLogin() survived the regeneration.
 *
 * Run:
 *   node scripts/zac-recording-time-pom.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const BASE = process.env.ZAC_BASE || 'http://127.0.0.1:3000';
const PROJECT_ID = 'recording-time-pom-demo';

const results = [];
const log = (m) => console.log(m);
const record = (id, label, ok, detail = '') => {
  results.push({ id, label, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(28)}  ${label}${detail ? ' — ' + detail : ''}`);
};
async function api(method, p, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${p}`, opts);
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { ok: r.ok, status: r.status, body: json, text };
}

const projectDir = path.join(REPO, 'projects', PROJECT_ID);

(async () => {
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('Recording-time POM + multi-env + protected regions');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // ── Phase 1: project with explicit environments[] ─────────────────────────
  log('\n── Phase 1: create project with environments[] ──');
  await api('DELETE', `/api/projects/${PROJECT_ID}`).catch(() => {});
  await api('POST', '/api/projects', {
    name: PROJECT_ID, framework: 'selenium-java', baseUrl: 'https://www.saucedemo.com',
    description: 'Recording-time POM demo',
  });
  // Persist environments via /save (uses spread so the field flows through).
  const r1 = await api('POST', `/api/projects/${PROJECT_ID}/save`, {
    id: PROJECT_ID, name: PROJECT_ID,
    framework: 'selenium-java', browserType: 'chromium',
    baseUrl: 'https://www.saucedemo.com',
    steps: [], scenarios: [], backgroundSteps: [],
    pages: [], locators: [], testData: [], reusableFlows: [],
    environments: [
      { name: 'QA',    baseUrl: 'https://www.saucedemo.com',          browser: 'chromium', headless: true },
      { name: 'STAGE', baseUrl: 'https://practice.expandtesting.com', browser: 'chromium', headless: true },
      { name: 'DEV',   baseUrl: 'http://uitestingplayground.com',     browser: 'chromium', headless: false },
    ],
  });
  record('P1.envs.persist', 'environments[] saved on project',
    !!(r1.body && r1.body.success), `status=${r1.status}`);
  const r1b = await api('GET', `/api/projects/${PROJECT_ID}`);
  const persistedEnvs = r1b.body && r1b.body.project && r1b.body.project.environments;
  record('P1.envs.reload', 'environments[] survives reload',
    Array.isArray(persistedEnvs) && persistedEnvs.length === 3,
    `got ${(persistedEnvs || []).map(e => e.name).join(',')}`);

  // ── Phase 2: append scenario with @PageName tags + pageBoundary marker ────
  log('\n── Phase 2: append scenario with @PageName tags + pageBoundary step ──');
  const scn = {
    id: 'login-and-cart',
    name: 'Login and add items',
    tags: ['@smoke', '@LoginPage', '@InventoryPage', '@CartSummaryPage'],
    steps: [
      // LoginPage
      { kind: 'navigate', url: 'https://www.saucedemo.com/' },
      { kind: 'fill',  selector: '#user-name', value: 'standard_user' },
      { kind: 'fill',  selector: '#password',  value: 'secret_sauce' },
      { kind: 'click', selector: '#login-button' },
      // 📄 New Page marker (recording UI button) — explicit boundary
      { kind: 'pageBoundary', pageName: 'InventoryPage' },
      { kind: 'waitForSelector', selector: '.inventory_list' },
      { kind: 'click', selector: '.inventory_item:nth-child(1) .btn_inventory' },
      { kind: 'click', selector: '.inventory_item:nth-child(2) .btn_inventory' },
      { kind: 'assertText', selector: '.shopping_cart_badge', expectedValue: '2' },
      { kind: 'click', selector: '.shopping_cart_link' },
      // Another boundary
      { kind: 'pageBoundary', pageName: 'CartSummaryPage' },
      { kind: 'waitForSelector', selector: '.cart_item' },
      { kind: 'assertCount', selector: '.cart_item .inventory_item_name', expectedCount: 2 },
    ],
  };
  const r2 = await api('POST', `/api/projects/${PROJECT_ID}/append-steps`, {
    steps: scn.steps,
    scenario: {
      id: scn.id, name: scn.name, tags: scn.tags,
      steps: scn.steps.map((a, i) => ({ stepId: `${scn.id}-${i}`, action: a })),
      createdAt: new Date().toISOString(),
    },
  });
  record('P2.append', 'scenario appended with @PageName tags + pageBoundary',
    r2.status === 200, `${scn.steps.length} steps`);

  // ── Phase 3: generate-files with pomMode:true ─────────────────────────────
  log('\n── Phase 3: /generate-files { pomMode: true } ──');
  const r3 = await api('POST', `/api/projects/${PROJECT_ID}/generate-files`, {
    framework: 'selenium-java',
    browserType: 'chromium',
    baseUrl: 'https://www.saucedemo.com',
    featureTitle: 'login flow',
    featureName: 'login-flow',
    pomMode: true,
  });
  const pom = r3.body && r3.body.pom;
  record('P3.codegen.success', 'generate-files succeeded',
    !!(r3.body && r3.body.success), `${(r3.body && r3.body.count) || 0} total files`);
  record('P3.codegen.pomReport', 'response carries POM report block',
    !!(pom && pom.enabled),
    pom ? `pages=${pom.pageCount} envs=${pom.envCount} methods=${pom.methodCount}` : 'no pom report');

  // ── Phase 4: verify on-disk POM + env files ───────────────────────────────
  log('\n── Phase 4: on-disk POM + env files ──');
  const expectedPages = ['LoginPage', 'InventoryPage', 'CartSummaryPage'];
  const pagesDir = path.join(projectDir, 'src/main/java/pages');
  const presentPages = expectedPages.filter(n => fs.existsSync(path.join(pagesDir, n + '.java')));
  record('P4.pageObjects', `${expectedPages.length} POM classes generated`,
    presentPages.length === expectedPages.length,
    `present=[${presentPages.join(',')}]`);
  const envDir = path.join(projectDir, 'config');
  const envFiles = ['.env.qa', '.env.stage', '.env.dev'];
  const presentEnvs = envFiles.filter(f => fs.existsSync(path.join(envDir, f)));
  record('P4.envFiles', `${envFiles.length} env config files`,
    presentEnvs.length === envFiles.length, `present=[${presentEnvs.join(',')}]`);

  // ── Phase 5: hand-edit a Page class (add executeLogin()) ──────────────────
  log('\n── Phase 5: hand-edit LoginPage to add executeLogin() ──');
  const loginPath = path.join(pagesDir, 'LoginPage.java');
  const before = fs.readFileSync(loginPath, 'utf8');
  // Inject AFTER the closing }-line of the class — find the LAST '}' and
  // insert our helper method just BEFORE that closing brace.
  const closingIdx = before.lastIndexOf('}');
  const handWritten = `
    // ── Hand-written by QA engineer (Naysha, 2026-06-01) ──
    public void executeLogin(String user, String pass) {
        for (int i = 0; i < 3; i++) {
            try {
                typeUserName(user);
                typePassword(pass);
                clickLoginButton();
                return;
            } catch (Exception e) {
                if (i == 2) throw e;
                try { Thread.sleep(500); } catch (InterruptedException ie) {}
            }
        }
    }

    public boolean isLoginErrorVisible() {
        return !driver.findElements(org.openqa.selenium.By.cssSelector("[data-test='error']")).isEmpty();
    }

`;
  const edited = before.slice(0, closingIdx) + handWritten + before.slice(closingIdx);
  fs.writeFileSync(loginPath, edited);
  record('P5.handEdit.applied', 'wrote executeLogin() + retry loop into LoginPage.java',
    edited.includes('executeLogin') && edited.includes('for (int i = 0'));

  // ── Phase 6: re-generate (after a small change to scenarios) and verify ──
  log('\n── Phase 6: re-generate and verify hand-edits SURVIVE ──');
  // Append one more step so the scenario is "modified" — proves regen runs.
  await api('POST', `/api/projects/${PROJECT_ID}/append-steps`, {
    steps: [{ kind: 'screenshot', filename: 'after-cart.png' }],
    scenario: {
      id: 'screenshot-after',
      name: 'Take a screenshot',
      tags: ['@CartSummaryPage'],
      steps: [{ stepId: 's-shot-0', action: { kind: 'screenshot', filename: 'after-cart.png' } }],
      createdAt: new Date().toISOString(),
    },
  });
  const r6 = await api('POST', `/api/projects/${PROJECT_ID}/generate-files`, {
    framework: 'selenium-java',
    browserType: 'chromium',
    baseUrl: 'https://www.saucedemo.com',
    featureTitle: 'login flow',
    featureName: 'login-flow',
    pomMode: true,
  });
  record('P6.regen.success', 'second /generate-files succeeded',
    !!(r6.body && r6.body.success));
  const after = fs.readFileSync(loginPath, 'utf8');
  record('P6.preserved.executeLogin',
    'hand-written executeLogin() survived regeneration',
    after.includes('executeLogin'));
  record('P6.preserved.retryLoop',
    'hand-written for-loop retry block survived',
    after.includes('for (int i = 0; i < 3; i++)'));
  record('P6.preserved.helperMethod',
    'hand-written isLoginErrorVisible() survived',
    after.includes('isLoginErrorVisible'));
  // ALSO verify the auto-generated body was actually refreshed
  // (i.e. ZAC-MANAGED-BEGIN block updated). The simplest signal: the
  // new file must STILL contain the BEGIN/END markers.
  record('P6.markersIntact',
    '// ZAC-MANAGED-BEGIN/END markers present',
    after.includes('// ZAC-MANAGED-BEGIN') && after.includes('// ZAC-MANAGED-END'));

  // ── Phase 7: keep project for inspection, summary ─────────────────────────
  log(`\nProject KEPT on disk: projects/${PROJECT_ID}/`);
  log(`  ls projects/${PROJECT_ID}/src/main/java/pages/`);
  log(`  ls projects/${PROJECT_ID}/config/`);
  log(`  cat projects/${PROJECT_ID}/src/main/java/pages/LoginPage.java`);

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(`SUMMARY: ${passed}/${results.length} checks passed`);
  if (failed.length) {
    log('\nFAILURES:');
    for (const f of failed) log(`  ✗ ${f.id}  ${f.label}  ${f.detail}`);
    process.exit(1);
  }
  log('Recording-time POM + environments + hand-edit preservation all green.');
})().catch(err => { console.error('Harness error:', err); process.exit(2); });
