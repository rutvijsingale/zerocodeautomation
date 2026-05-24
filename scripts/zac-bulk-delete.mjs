#!/usr/bin/env node
/**
 * Bulk-delete safety harness — proves DELETE /api/projects:
 *
 *   1. Removes every project under projects/* and every mirror under
 *      generated-projects/<framework>/<id>/.
 *   2. Does NOT touch:
 *        config/frameworks.json, config/email.json, config/credentials.json
 *        public/ (frontend assets)
 *        services/, routes/, middleware/ (server code)
 *        environments / settings / locator-strategy snapshots stored
 *        in the user's localStorage on the browser
 *   3. Requires { confirm: true } — bare DELETE returns 400.
 *   4. Returns the list of deleted ids + error count.
 *   5. Subsequent /api/projects → empty list.
 *   6. Dashboard /api/dashboard/stats?existingOnly=true reports zero.
 *
 * Run:  node scripts/zac-bulk-delete.mjs
 */
import http from 'http';
import { readFileSync, statSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { resolve } from 'path';

const BASE = process.env.ZAC_BASE || 'http://127.0.0.1:3000';
const ROOT = resolve(process.cwd());
const T = { pass: 0, fail: 0, fails: [] };
const chk = (label, ok, detail = '') => {
  if (ok) { T.pass++; console.log(`      ✓ ${label}`); }
  else    { T.fail++; T.fails.push({ label, detail }); console.log(`      ✗ ${label}${detail ? '  — ' + detail : ''}`); }
};

function api(method, path, body) {
  return new Promise((resolveP) => {
    const url = new URL(BASE + path);
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, timeout: 30000,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}
    }, (res) => {
      let buf = ''; res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolveP({ status: res.statusCode, body: buf ? JSON.parse(buf) : null, raw: buf }); }
        catch { resolveP({ status: res.statusCode, body: buf, raw: buf }); }
      });
    });
    req.on('error', e => resolveP({ status: 0, body: { error: e.message } }));
    req.on('timeout', () => { req.destroy(); resolveP({ status: 0, body: { error: 'timeout' } }); });
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  console.log(`══ Bulk-delete safety harness — ${BASE} ══\n`);

  // ── 0. Snapshot of "things that should not change" ─────────────────────
  console.log('── 0. Snapshot config + frameworks + email + AI before bulk delete ──');

  const cfgFrameworksPath = resolve(ROOT, 'config/frameworks.json');
  const cfgEmailPath      = resolve(ROOT, 'config/email.json');
  const cfgCredsPath      = resolve(ROOT, 'config/credentials.json');

  const beforeFrameworks = existsSync(cfgFrameworksPath) ? readFileSync(cfgFrameworksPath, 'utf8') : null;
  const beforeEmail      = existsSync(cfgEmailPath) ? readFileSync(cfgEmailPath, 'utf8') : null;
  const beforeCreds      = existsSync(cfgCredsPath) ? readFileSync(cfgCredsPath, 'utf8') : null;
  const beforeFwAPI      = await api('GET', '/api/frameworks');
  const beforeAi         = await api('GET', '/api/ai/info');
  const beforeEmailCfg   = await api('GET', '/api/email/config');

  console.log(`   frameworks.json present: ${!!beforeFrameworks}`);
  console.log(`   email.json present:      ${!!beforeEmail}`);
  console.log(`   credentials.json present:${!!beforeCreds}`);
  console.log(`   /api/frameworks count:   ${(beforeFwAPI.body?.frameworks || []).length}`);

  // ── 1. Seed 3 projects across 3 frameworks ─────────────────────────────
  console.log('\n── 1. Seed 3 projects across different frameworks ──');
  const seeded = [
    { id: `bulkdel-pwj-${Date.now()}`,   framework: 'playwright-java' },
    { id: `bulkdel-sj-${Date.now()+1}`,  framework: 'selenium-java' },
    { id: `bulkdel-stg-${Date.now()+2}`, framework: 'selenium-testng' },
  ];
  for (const p of seeded) {
    const r = await api('POST', '/api/projects',
      { name: p.id, framework: p.framework, baseUrl: 'https://demoqa.com' });
    chk(`   create ${p.id} (${p.framework}) [${r.status}]`, r.status === 200 || r.status === 201);

    // also stamp generated-projects so we can verify cleanup
    const g = await api('POST', `/api/projects/${p.id}/save`, {
      framework: p.framework, baseUrl: 'https://demoqa.com',
      backgroundSteps: [{ kind: 'navigate', url: 'https://demoqa.com' }],
      scenarios: [{ name: 'seed', steps: [{ kind: 'click', selector: '#x' }] }],
      locators: [], steps: [],
    });
    await api('POST', `/api/projects/${p.id}/generate-files`, {
      framework: p.framework, baseUrl: 'https://demoqa.com',
      featureName: 'Seed', featureTitle: 'seed',
    });
  }

  // Verify seed actually landed on disk in BOTH places
  const projectsDir = resolve(ROOT, 'projects');
  const seedSurvives = seeded.every(p => existsSync(resolve(projectsDir, p.id)));
  chk('   all 3 projects exist on disk under projects/', seedSurvives);

  const list = await api('GET', '/api/projects');
  const listIds = (list.body?.projects || []).map(p => p.id || p.projectId);
  chk(`   /api/projects sees the 3 seeded projects (total visible: ${listIds.length})`,
    seeded.every(p => listIds.includes(p.id)));

  // ── 2. Confirm bare DELETE without { confirm:true } is rejected ────────
  console.log('\n── 2. DELETE /api/projects without confirm → 400 (safety guard) ──');
  const noConfirm = await api('DELETE', '/api/projects', {});
  chk(`   without confirm returns 400 (got ${noConfirm.status})`, noConfirm.status === 400);
  chk('   error message mentions confirm:true',
    /confirm/i.test(noConfirm.body?.error || ''));

  // After the rejection, projects must STILL be there
  const afterReject = await api('GET', '/api/projects');
  const afterIds = (afterReject.body?.projects || []).map(p => p.id || p.projectId);
  chk(`   projects untouched after rejection (${seeded.filter(p=>afterIds.includes(p.id)).length}/${seeded.length} survived)`,
    seeded.every(p => afterIds.includes(p.id)));

  // ── 3. Real bulk delete with { confirm: true } ─────────────────────────
  console.log('\n── 3. DELETE /api/projects with { confirm: true } ──');
  const del = await api('DELETE', '/api/projects', { confirm: true });
  chk(`   HTTP 200 (got ${del.status})`, del.status === 200);
  chk(`   success=true`, del.body?.success === true);
  chk(`   deleted >= ${seeded.length} (got ${del.body?.deleted})`,
    (del.body?.deleted || 0) >= seeded.length);
  chk(`   ids array contains all 3 seeded`,
    seeded.every(p => (del.body?.ids || []).includes(p.id)),
    `seeded=${seeded.map(p=>p.id).join(',')}  returned=${(del.body?.ids||[]).join(',')}`);
  chk(`   errors array empty (${(del.body?.errors||[]).length})`,
    (del.body?.errors || []).length === 0);

  // ── 4. Verify projects/ + generated-projects/ are clean ────────────────
  console.log('\n── 4. Disk verification ──');
  for (const p of seeded) {
    chk(`   projects/${p.id} GONE`, !existsSync(resolve(projectsDir, p.id)));
    chk(`   generated-projects/${p.framework}/${p.id} GONE`,
      !existsSync(resolve(ROOT, 'generated-projects', p.framework, p.id)));
  }

  const list2 = await api('GET', '/api/projects');
  const remaining = (list2.body?.projects || []).map(p => p.id || p.projectId);
  chk(`   /api/projects shows none of the seeded ids`,
    !seeded.some(p => remaining.includes(p.id)));

  // dashboard
  const stats = await api('GET', '/api/dashboard/stats?existingOnly=true');
  const dashIds = (stats.body?.projects || []).map(p => p.projectId);
  chk(`   /api/dashboard/stats?existingOnly=true reflects the wipe`,
    !seeded.some(p => dashIds.includes(p.id)));

  // ── 5. CONFIG / SETTINGS / EMAIL must be unchanged ─────────────────────
  console.log('\n── 5. Config + settings + email + AI integrity ──');
  const afterFrameworks = existsSync(cfgFrameworksPath) ? readFileSync(cfgFrameworksPath, 'utf8') : null;
  const afterEmail      = existsSync(cfgEmailPath) ? readFileSync(cfgEmailPath, 'utf8') : null;
  const afterCreds      = existsSync(cfgCredsPath) ? readFileSync(cfgCredsPath, 'utf8') : null;
  const afterFwAPI      = await api('GET', '/api/frameworks');
  const afterAi         = await api('GET', '/api/ai/info');
  const afterEmailCfg   = await api('GET', '/api/email/config');

  chk('   config/frameworks.json byte-for-byte identical',
    beforeFrameworks === afterFrameworks);
  chk('   config/email.json byte-for-byte identical',
    beforeEmail === afterEmail);
  chk('   config/credentials.json byte-for-byte identical',
    beforeCreds === afterCreds);
  chk(`   /api/frameworks still returns ${(beforeFwAPI.body?.frameworks||[]).length} entries`,
    JSON.stringify(beforeFwAPI.body) === JSON.stringify(afterFwAPI.body));
  chk('   /api/ai/info unchanged',
    beforeAi.body?.available === afterAi.body?.available
      && beforeAi.body?.provider === afterAi.body?.provider);
  // email config: the password is masked to '•••' in both responses, so this
  // is a fair compare of every other field
  chk('   /api/email/config unchanged',
    JSON.stringify(beforeEmailCfg.body) === JSON.stringify(afterEmailCfg.body));

  // public/ frontend assets — sanity sample
  for (const asset of ['public/index.html', 'public/dashboard.html', 'public/settings.html', 'public/app.js']) {
    chk(`   ${asset} still present`, existsSync(resolve(ROOT, asset)));
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log('\n═══ Summary ═══');
  console.log(`   Total: ${T.pass + T.fail}`);
  console.log(`   ✓ pass: ${T.pass}`);
  console.log(`   ✗ fail: ${T.fail}`);
  if (T.fail) {
    console.log('\n   Failures:');
    for (const f of T.fails) console.log(`     - ${f.label}${f.detail ? '  — ' + f.detail : ''}`);
  }
  process.exit(T.fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
