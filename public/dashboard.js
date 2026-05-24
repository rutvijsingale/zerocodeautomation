  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of children) {
      if (c == null) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }
  function emptyState(msg) { return el('div', { class: 'empty' }, msg); }
  function fmtNum(n) { return (n ?? 0).toLocaleString(); }
  function fmtPct(num, denom) { if (!denom) return '—'; return Math.round(num / denom * 1000) / 10 + '%'; }
  function fmtMs(ms) {
    if (!ms || ms < 0) return '—';
    if (ms < 1000) return Math.round(ms) + ' ms';
    if (ms < 60_000) return (ms / 1000).toFixed(1) + ' s';
    return Math.round(ms / 60_000) + ' min';
  }
  function fmtUptimeShort(s) {
    if (s < 60) return s + 's';
    if (s < 3600) return Math.round(s / 60) + 'm';
    if (s < 86400) return Math.round(s / 3600) + 'h ' + Math.round((s % 3600) / 60) + 'm';
    return Math.round(s / 86400) + 'd ' + Math.round((s % 86400) / 3600) + 'h';
  }

  // Server emits "YYYY-MM-DDTHHMMSS-mmmZ"; convert to a real Date.
  function parseRunTs(ts) {
    if (!ts) return null;
    const m = String(ts).match(/^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})-(\d{3})Z$/);
    if (m) return new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
    const d = new Date(ts);
    return isNaN(d) ? null : d;
  }

  // Stable short id derived from rerun identity (display only).
  function runIdFor(r) {
    const seed = `${r.framework}|${r.projectId}|${r.testName}|${r.timestamp}`;
    let h = 0;
    for (let i = 0; i < seed.length; i++) { h = ((h << 5) - h) + seed.charCodeAt(i); h |= 0; }
    return '#RUN-' + String(Math.abs(h) % 10000).padStart(4, '0');
  }
  function browserChip(framework) {
    const fw = (framework || '').toLowerCase();
    let label = framework || '—';
    if (fw.includes('playwright')) label = 'Chromium';
    else if (fw.includes('selenium')) label = 'Selenium';
    return el('span', { class: 'browser-chip' }, label);
  }
  function statusPill(status) {
    return el('span', { class: 'pill dot ' + (status || 'unknown') }, status || 'unknown');
  }
  function reportHref(r) {
    return `/report.html?path=${encodeURIComponent(r.framework + '/' + r.projectId + '/reruns/' + r.testName + '/' + r.timestamp)}`;
  }

  function table(host, columns, rows) {
    host.innerHTML = '';
    if (!rows || !rows.length) { host.appendChild(emptyState('no rows')); return; }
    const t = el('table');
    const thead = el('thead');
    const trh = el('tr');
    for (const c of columns) trh.appendChild(el('th', {}, c.label));
    thead.appendChild(trh);
    t.appendChild(thead);
    const tbody = el('tbody');
    for (const r of rows) {
      const tr = el('tr');
      for (const c of columns) {
        const cellAttrs = c.numeric ? { class: 'num' } : (c.mono ? { class: 'mono' } : {});
        const v = c.render ? c.render(r) : (r[c.key] ?? '');
        const td = el('td', cellAttrs);
        // A column may yield a primitive (string / number / boolean) OR a
        // real DOM node (when `render` returns el(...)). Detect Nodes by
        // `nodeType`; coerce everything else to text so appendChild never
        // receives a non-Node and crashes the whole table render.
        if (v == null) {
          td.textContent = '';
        } else if (typeof v === 'object' && typeof v.nodeType === 'number') {
          td.appendChild(v);
        } else {
          td.textContent = String(v);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    t.appendChild(tbody);
    host.appendChild(t);
  }

  function barChart(host, rows) {
    host.innerHTML = '';
    if (!rows.length) { host.appendChild(emptyState('no data yet')); return; }
    const w = host.clientWidth || 800;
    const barH = 24, gap = 10, leftLabel = 180, rightPad = 50, topPad = 8;
    const h = topPad + rows.length * (barH + gap);
    const maxVal = Math.max(...rows.map((r) => (r.pass || 0) + (r.fail || 0)), 1);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', w); svg.setAttribute('height', h);
    rows.forEach((r, i) => {
      const y = topPad + i * (barH + gap);
      const total = (r.pass || 0) + (r.fail || 0);
      const totalW = (w - leftLabel - rightPad) * (total / maxVal);
      const passW = total > 0 ? totalW * (r.pass / total) : 0;
      const failW = totalW - passW;
      const label = document.createElementNS(ns, 'text');
      label.setAttribute('x', 0); label.setAttribute('y', y + barH / 2 + 4);
      label.setAttribute('fill', '#8d97a8'); label.setAttribute('font-size', '12');
      label.setAttribute('font-family', 'sans-serif');
      label.textContent = r.label;
      svg.appendChild(label);
      if (passW > 0) {
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', leftLabel); rect.setAttribute('y', y);
        rect.setAttribute('width', passW); rect.setAttribute('height', barH);
        rect.setAttribute('fill', '#4ade80'); rect.setAttribute('rx', '4');
        svg.appendChild(rect);
      }
      if (failW > 0) {
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', leftLabel + passW); rect.setAttribute('y', y);
        rect.setAttribute('width', failW); rect.setAttribute('height', barH);
        rect.setAttribute('fill', '#f87171'); rect.setAttribute('rx', '4');
        svg.appendChild(rect);
      }
      const count = document.createElementNS(ns, 'text');
      count.setAttribute('x', leftLabel + totalW + 8);
      count.setAttribute('y', y + barH / 2 + 4);
      count.setAttribute('fill', '#e8ecf2'); count.setAttribute('font-size', '12');
      count.setAttribute('font-family', 'sans-serif');
      count.textContent = `${r.pass}/${total}`;
      svg.appendChild(count);
    });
    host.appendChild(svg);
  }

  function passFailLineChart(host, daily) {
    host.innerHTML = '';
    const w = host.clientWidth || 600;
    const h = host.clientHeight || 260;
    const padL = 32, padR = 14, padT = 14, padB = 26;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', w); svg.setAttribute('height', h);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    if (!daily.length) { host.appendChild(emptyState('no data yet')); return; }

    const maxY = Math.max(1, ...daily.map((d) => Math.max(d.pass, d.fail)));
    const yTicks = (() => {
      if (maxY <= 5) return Array.from({ length: maxY + 1 }, (_, i) => i);
      const step = Math.ceil(maxY / 5);
      const out = [];
      for (let v = 0; v <= maxY + step - 1; v += step) out.push(v);
      return out;
    })();
    const yMax = yTicks[yTicks.length - 1] || 1;
    const xFor = (i) => padL + (innerW * (i / Math.max(1, daily.length - 1)));
    const yFor = (v) => padT + innerH - innerH * (v / yMax);

    const passArea = ['M', xFor(0), padT + innerH];
    daily.forEach((d, i) => { passArea.push('L', xFor(i), yFor(d.pass)); });
    passArea.push('L', xFor(daily.length - 1), padT + innerH, 'Z');
    const areaP = document.createElementNS(ns, 'path');
    areaP.setAttribute('d', passArea.join(' '));
    areaP.setAttribute('fill', 'rgba(74,222,128,0.10)');
    svg.appendChild(areaP);

    const axisG = document.createElementNS(ns, 'g');
    axisG.setAttribute('class', 'axis');
    yTicks.forEach((v) => {
      const y = yFor(v);
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', padL); line.setAttribute('x2', padL + innerW);
      line.setAttribute('y1', y); line.setAttribute('y2', y);
      line.setAttribute('stroke', 'rgba(255,255,255,0.04)');
      axisG.appendChild(line);
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', padL - 6); t.setAttribute('y', y + 3);
      t.setAttribute('text-anchor', 'end');
      t.textContent = v;
      axisG.appendChild(t);
    });
    svg.appendChild(axisG);

    const xAxisG = document.createElementNS(ns, 'g');
    xAxisG.setAttribute('class', 'axis');
    daily.forEach((d, i) => {
      if (i % 2 !== 0 && i !== daily.length - 1) return;
      const x = xFor(i);
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', x); t.setAttribute('y', padT + innerH + 16);
      t.setAttribute('text-anchor', 'middle');
      t.textContent = d.label;
      xAxisG.appendChild(t);
    });
    svg.appendChild(xAxisG);

    function smoothPath(points) {
      if (points.length < 2) return '';
      const d = ['M', points[0][0], points[0][1]];
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];
        const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
        const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
        const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
        const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
        d.push('C', cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
      }
      return d.join(' ');
    }
    const passPts = daily.map((d, i) => [xFor(i), yFor(d.pass)]);
    const failPts = daily.map((d, i) => [xFor(i), yFor(d.fail)]);

    const passLine = document.createElementNS(ns, 'path');
    passLine.setAttribute('d', smoothPath(passPts));
    passLine.setAttribute('fill', 'none');
    passLine.setAttribute('stroke', '#4ade80');
    passLine.setAttribute('stroke-width', '2');
    passLine.setAttribute('stroke-linecap', 'round');
    svg.appendChild(passLine);

    const failLine = document.createElementNS(ns, 'path');
    failLine.setAttribute('d', smoothPath(failPts));
    failLine.setAttribute('fill', 'none');
    failLine.setAttribute('stroke', '#f87171');
    failLine.setAttribute('stroke-width', '2');
    failLine.setAttribute('stroke-linecap', 'round');
    svg.appendChild(failLine);

    daily.forEach((d, i) => {
      const dotP = document.createElementNS(ns, 'circle');
      dotP.setAttribute('cx', xFor(i)); dotP.setAttribute('cy', yFor(d.pass));
      dotP.setAttribute('r', '3'); dotP.setAttribute('fill', '#4ade80');
      const tit = document.createElementNS(ns, 'title');
      tit.textContent = `${d.label}: ${d.pass} passed, ${d.fail} failed`;
      dotP.appendChild(tit);
      svg.appendChild(dotP);
      const dotF = document.createElementNS(ns, 'circle');
      dotF.setAttribute('cx', xFor(i)); dotF.setAttribute('cy', yFor(d.fail));
      dotF.setAttribute('r', '3'); dotF.setAttribute('fill', '#f87171');
      const tit2 = document.createElementNS(ns, 'title');
      tit2.textContent = `${d.label}: ${d.pass} passed, ${d.fail} failed`;
      dotF.appendChild(tit2);
      svg.appendChild(dotF);
    });

    host.appendChild(svg);
  }

  function donutChart(host, legendHost, slices) {
    host.innerHTML = '';
    legendHost.innerHTML = '';
    const total = slices.reduce((s, x) => s + x.value, 0);
    if (total === 0) { host.appendChild(emptyState('no data')); return; }
    const size = 200, cx = size / 2, cy = size / 2;
    const r = 78, ir = 50;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', size); svg.setAttribute('height', size);
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

    let cursor = -Math.PI / 2;
    slices.forEach((s) => {
      if (s.value <= 0) return;
      const angle = (s.value / total) * Math.PI * 2;
      const a0 = cursor;
      const a1 = cursor + angle;
      cursor = a1;
      const largeArc = angle > Math.PI ? 1 : 0;
      const x0o = cx + r * Math.cos(a0), y0o = cy + r * Math.sin(a0);
      const x1o = cx + r * Math.cos(a1), y1o = cy + r * Math.sin(a1);
      const x0i = cx + ir * Math.cos(a1), y0i = cy + ir * Math.sin(a1);
      const x1i = cx + ir * Math.cos(a0), y1i = cy + ir * Math.sin(a0);
      const d = [
        'M', x0o, y0o,
        'A', r, r, 0, largeArc, 1, x1o, y1o,
        'L', x0i, y0i,
        'A', ir, ir, 0, largeArc, 0, x1i, y1i,
        'Z',
      ].join(' ');
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', s.color);
      const t = document.createElementNS(ns, 'title');
      t.textContent = `${s.label}: ${s.value} (${Math.round(s.value / total * 100)}%)`;
      path.appendChild(t);
      svg.appendChild(path);
    });

    const tCount = document.createElementNS(ns, 'text');
    tCount.setAttribute('x', cx); tCount.setAttribute('y', cy - 2);
    tCount.setAttribute('text-anchor', 'middle');
    tCount.setAttribute('fill', '#e8ecf2');
    tCount.setAttribute('font-size', '22');
    tCount.setAttribute('font-weight', '700');
    tCount.textContent = total;
    svg.appendChild(tCount);
    const tLabel = document.createElementNS(ns, 'text');
    tLabel.setAttribute('x', cx); tLabel.setAttribute('y', cy + 16);
    tLabel.setAttribute('text-anchor', 'middle');
    tLabel.setAttribute('fill', '#8d97a8');
    tLabel.setAttribute('font-size', '11');
    tLabel.textContent = 'total';
    svg.appendChild(tLabel);

    host.appendChild(svg);

    slices.forEach((s) => {
      legendHost.appendChild(el('div', { class: 'leg-row' },
        el('span', { class: 'sw', style: `background:${s.color}` }),
        el('span', { class: 'name' }, s.label),
        el('span', { class: 'v' }, `${s.value} (${total ? Math.round(s.value / total * 100) : 0}%)`),
      ));
    });
  }

  let allReruns = [];
  let lastStats = null;
  let liveCount = 0;

  function applyFilters() {
    const fw = document.getElementById('filterFramework').value;
    // T4.3 — project filter dropdown.
    const pj = (document.getElementById('filterProject') || { value: '' }).value;
    const st = document.getElementById('filterStatus').value;
    const q  = document.getElementById('filterText').value.trim().toLowerCase();
    let filtered = allReruns;
    if (fw) filtered = filtered.filter((r) => r.framework === fw);
    if (pj) filtered = filtered.filter((r) => r.projectId === pj);
    if (st) filtered = filtered.filter((r) => r.status === st);
    if (q)  filtered = filtered.filter((r) =>
      (r.projectId || '').toLowerCase().includes(q) ||
      (r.testName  || '').toLowerCase().includes(q));
    document.getElementById('filterCount').textContent =
      `showing ${filtered.length} of ${allReruns.length}`;
    renderRerunTable(filtered.slice(0, 50));
  }

  function renderRerunTable(rows) {
    table(document.getElementById('rerunTableHost'), [
      { label: 'Run',        render: (r) => el('a', { href: reportHref(r), class: 'run-id' }, runIdFor(r)) },
      { label: 'Project',    key: 'projectId' },
      { label: 'Feature',    key: 'testName' },
      { label: 'Browser',    render: (r) => browserChip(r.framework) },
      { label: 'Steps',      key: 'executedSteps', numeric: true },
      { label: 'Pass',       key: 'successCount',  numeric: true },
      { label: 'Fail',       key: 'failureCount',  numeric: true },
      { label: 'Heals',      key: 'healingHits',   numeric: true },
      { label: 'Duration',   render: (r) => document.createTextNode(
          r.durationMs ? (r.durationMs < 1000 ? r.durationMs + 'ms' : (r.durationMs / 1000).toFixed(1) + 's') : '—'
        ) },
      { label: 'When',       key: 'timestamp', mono: true,
        render: (r) => el('a', { href: reportHref(r), style: 'color:var(--accent); text-decoration:none;', title: 'Open this rerun report' }, r.timestamp) },
      { label: 'Status',     render: (r) => statusPill(r.status) },
    ], rows);
  }

  function buildDailySeries(reruns, days = 14) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const buckets = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      buckets.push({
        key,
        label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        pass: 0, fail: 0,
      });
    }
    const idx = new Map(buckets.map((b, i) => [b.key, i]));
    for (const r of reruns) {
      const d = parseRunTs(r.timestamp);
      if (!d) continue;
      const k = d.toISOString().slice(0, 10);
      const i = idx.get(k);
      if (i == null) continue;
      if (r.status === 'passed') buckets[i].pass++;
      else if (r.status === 'failed') buckets[i].fail++;
    }
    return buckets;
  }

  function render(stats) {
    document.getElementById('generatedAt').textContent =
      'updated ' + new Date(stats.summary.generatedAt).toLocaleTimeString();

    const ts = stats.testSummary || { totalCases: 0, passed: 0, failed: 0, skipped: 0, passPct: 0 };
    const total  = ts.totalCases || stats.reruns.length;
    const passed = ts.passed;
    const failed = ts.failed;

    document.getElementById('kTotal').textContent  = fmtNum(total);
    document.getElementById('kPassed').textContent = fmtNum(passed);
    document.getElementById('kFailed').textContent = fmtNum(failed);
    document.getElementById('kPassedFoot').textContent = fmtPct(passed, total) + ' pass rate';
    document.getElementById('kFailedFoot').textContent = fmtPct(failed, total) + ' failure rate';
    document.getElementById('kTotalFoot').textContent  = stats.summary.totalProjects + ' projects · ' + stats.summary.totalFrameworks + ' frameworks';

    document.getElementById('navRunsCount').textContent = fmtNum(total);
    document.getElementById('navFailCount').textContent = fmtNum(failed);
    document.getElementById('navHealCount').textContent = fmtNum(stats.summary.totalHealingEvents);

    const perFw = {};
    for (const r of stats.reruns) {
      perFw[r.framework] = perFw[r.framework] || { label: r.framework, pass: 0, fail: 0 };
      if (r.status === 'passed') perFw[r.framework].pass++;
      else if (r.status === 'failed') perFw[r.framework].fail++;
    }
    document.getElementById('resultsWindow').textContent = stats.reruns.length;
    barChart(document.getElementById('resultsChart'), Object.values(perFw));

    passFailLineChart(document.getElementById('passFailChart'), buildDailySeries(stats.reruns, 14));

    donutChart(
      document.getElementById('statusDonut'),
      document.getElementById('statusDonutLegend'),
      [
        { label: 'Passed',  value: passed,                                 color: '#4ade80' },
        { label: 'Failed',  value: failed,                                 color: '#f87171' },
        { label: 'Skipped', value: ts.skipped || 0,                        color: '#fbbf24' },
        { label: 'Healed',  value: stats.summary.totalHealingEvents || 0,  color: '#a78bfa' },
      ],
    );

    table(document.getElementById('recentActivityHost'), [
      { label: 'Run',     render: (r) => el('a', { href: reportHref(r), class: 'run-id' }, runIdFor(r)) },
      { label: 'Project', key: 'projectId' },
      { label: 'Feature', key: 'testName' },
      { label: 'Browser', render: (r) => browserChip(r.framework) },
      { label: 'Status',  render: (r) => statusPill(r.status) },
    ], stats.reruns.slice(0, 5));

    const trendRows = stats.reruns.slice(0, 30).map((r) => ({
      label: r.timestamp + '  ' + r.testName,
      pass: r.successCount,
      fail: r.failureCount,
    }));
    barChart(document.getElementById('trendsChart'), trendRows);

    table(document.getElementById('locatorStabilityHost'), [
      { label: 'Framework', key: 'framework' },
      { label: 'Project',   key: 'projectId' },
      { label: 'Reruns',    key: 'rerunCount',     numeric: true },
      { label: 'Healing events', key: 'healingEvents', numeric: true },
      { label: 'Last rerun', key: 'lastRerunAt',   mono: true },
    ], stats.projects);

    table(document.getElementById('healLogHost'), [
      { label: 'When',     key: 'savedAt',         mono: true },
      { label: 'Project',  key: 'projectId' },
      { label: 'Primary (failed)', key: 'primarySelector', mono: true },
      { label: 'Healed → ',        key: 'healedSelector',  mono: true,
        render: (r) => el('span', { class: 'mono' }, r.healedSelector || '') },
      { label: 'Reason',           key: 'reason' },
    ], stats.healingLog);

    table(document.getElementById('projectsHost'), [
      { label: 'Framework',      key: 'framework' },
      { label: 'Project',        key: 'projectId' },
      { label: 'Reruns',         key: 'rerunCount',     numeric: true },
      { label: 'Healing events', key: 'healingEvents',  numeric: true },
      { label: 'Last rerun',     key: 'lastRerunAt',    mono: true },
    ], stats.projects);

    table(document.getElementById('topFailingHost'), [
      { label: 'Framework', key: 'framework' },
      { label: 'Project',   key: 'projectId' },
      { label: 'Test',      key: 'testName' },
      { label: 'Failures',  key: 'failCount',  numeric: true },
      { label: 'Last fail', key: 'lastFailAt', mono: true },
    ], stats.topFailingTests || []);

    table(document.getElementById('flakiestLocatorsHost'), [
      { label: 'Primary selector (failed)', key: 'primarySelector', mono: true },
      { label: 'Heal count',                key: 'healCount',       numeric: true },
      { label: 'Last healed to',            key: 'lastHealedTo',    mono: true },
      { label: 'Last healed at',            key: 'lastHealedAt',    mono: true },
      { label: 'Affected projects',         key: 'affectedProjectCount', numeric: true },
    ], stats.flakiestLocators || []);

    table(document.getElementById('errorCategoriesHost'), [
      { label: 'Category', key: 'category' },
      { label: 'Count',    key: 'count', numeric: true },
    ], stats.errorCategories || []);

    if (stats.performance) renderPerformance(stats.performance);

    // T2.4 — browser-wise stats (Coverage view). Populated only when at
    // least one rerun on disk recorded `browserType` (post-T2.4 reruns).
    // Legacy reruns appear in the "unknown" bucket so the user can spot
    // them and re-run for full attribution.
    const bbHost = document.getElementById('browserStatsHost');
    if (bbHost) {
      table(bbHost, [
        { label: 'Browser',  key: 'browser' },
        { label: 'Total',    key: 'total',   numeric: true },
        { label: 'Passed',   key: 'passed',  numeric: true },
        { label: 'Failed',   key: 'failed',  numeric: true },
        { label: 'Skipped',  key: 'skipped', numeric: true },
        { label: 'Pass %',   render: (r) => document.createTextNode((r.passPct ?? 0) + '%') },
      ], stats.byBrowser || []);
    }

    table(document.getElementById('reportsHost'), [
      { label: 'Report',        key: 'name', mono: true },
      { label: 'Modified',      key: 'mtime',     mono: true },
      { label: 'Size (bytes)',  key: 'sizeBytes', numeric: true },
    ], stats.signOffReports);
  }

  function statCard(host, label, value, klass = 'accent') {
    const card = el('div', { class: 'stat-card ' + klass });
    card.appendChild(el('div', { class: 'lbl' }, label));
    card.appendChild(el('div', { class: 'val' }, String(value)));
    host.appendChild(card);
  }

  function renderPerformance(perf) {
    const ssh = document.getElementById('serverSnapshotHost'); ssh.innerHTML = '';
    statCard(ssh, 'Uptime',     fmtUptimeShort(perf.server.uptimeSeconds), 'accent');
    statCard(ssh, 'Heap used',  perf.server.heapUsedMB + ' MB',           'accent');
    statCard(ssh, 'Heap total', perf.server.heapTotalMB + ' MB',          'accent');
    statCard(ssh, 'RSS',        perf.server.rssMB + ' MB',                'amber');
    statCard(ssh, 'Node',       perf.server.nodeVersion,                  'accent');
    statCard(ssh, 'Platform',   perf.server.platform,                     'accent');

    document.getElementById('perfSampleSize').textContent = perf.rerunDurations.sampleSize;
    const dph = document.getElementById('durationPercentilesHost'); dph.innerHTML = '';
    statCard(dph, 'Mean', fmtMs(perf.rerunDurations.meanMs), 'accent');
    statCard(dph, 'p50',  fmtMs(perf.rerunDurations.p50Ms),  'accent');
    statCard(dph, 'p95',  fmtMs(perf.rerunDurations.p95Ms),  'amber');
    statCard(dph, 'p99',  fmtMs(perf.rerunDurations.p99Ms),  'amber');
    statCard(dph, 'Max',  fmtMs(perf.rerunDurations.maxMs),  'danger');

    const rh = document.getElementById('ratesHost'); rh.innerHTML = '';
    statCard(rh, 'Total reruns',    perf.rates.totalReruns,           'accent');
    statCard(rh, 'Pass rate',       perf.rates.passRatePct + '%',     perf.rates.passRatePct >= 95 ? 'success' : 'amber');
    statCard(rh, 'Healing events',  perf.rates.healingEvents,         'amber');
    statCard(rh, 'Heals per rerun', perf.rates.healRatePerRerun,      'amber');

    const tlHost = document.getElementById('durationTimelineHost'); tlHost.innerHTML = '';
    if (perf.timeSeries.length === 0) { tlHost.appendChild(emptyState('no rerun timeline data yet')); return; }
    const maxD = Math.max(...perf.timeSeries.map((p) => p.durationMs || 0), 1);
    const w = tlHost.clientWidth || 800;
    const h = 180, padL = 60, padR = 20, padT = 10, padB = 30;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const barW = Math.max(8, (innerW / perf.timeSeries.length) - 4);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', w); svg.setAttribute('height', h);
    [maxD, maxD / 2, 0].forEach((v, i) => {
      const y = padT + (innerH * i / 2);
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', padL - 8); t.setAttribute('y', y + 4);
      t.setAttribute('fill', '#8d97a8'); t.setAttribute('font-size', '10');
      t.setAttribute('font-family', 'sans-serif'); t.setAttribute('text-anchor', 'end');
      t.textContent = v < 1000 ? Math.round(v) + 'ms' : (v / 1000).toFixed(1) + 's';
      svg.appendChild(t);
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', padL); line.setAttribute('x2', padL + innerW);
      line.setAttribute('y1', y);    line.setAttribute('y2', y);
      line.setAttribute('stroke', '#232a3a'); line.setAttribute('stroke-dasharray', '2 4');
      svg.appendChild(line);
    });
    perf.timeSeries.forEach((p, i) => {
      const x = padL + i * (barW + 4);
      const bh = innerH * ((p.durationMs || 0) / maxD);
      const y = padT + innerH - bh;
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', x); rect.setAttribute('y', y);
      rect.setAttribute('width', barW); rect.setAttribute('height', bh);
      rect.setAttribute('rx', 2);
      rect.setAttribute('fill', p.failed > 0 ? '#f87171' : '#4ade80');
      const title = document.createElementNS(ns, 'title');
      title.textContent = `${p.timestamp}  ${p.framework}\nduration: ${fmtMs(p.durationMs)}\npassed: ${p.passed}  failed: ${p.failed}  healed: ${p.healed}`;
      rect.appendChild(title);
      svg.appendChild(rect);
    });
    tlHost.appendChild(svg);
  }

  const VIEW_TITLES = {
    overview: ['Dashboard overview', 'Summary of all test runs across projects'],
    runs:     ['All test runs', 'Filter, search, and inspect every rerun'],
    failures: ['Failures', 'Failing tests, flaky locators, and error categories'],
    healer:   ['Healer log', 'AI-assisted locator healing events across projects'],
    trends:   ['Trends', 'Failure trends, locator stability, and duration history'],
    coverage: ['Coverage', 'Server snapshot, percentiles, and sign-off reports'],
  };
  function switchView(view) {
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === view));
    document.querySelectorAll('section.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + view));
    const t = VIEW_TITLES[view] || VIEW_TITLES.overview;
    document.getElementById('pageTitle').textContent = t[0];
    document.getElementById('pageSub').textContent   = t[1];
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  document.querySelectorAll('.nav-item').forEach((n) => {
    n.addEventListener('click', () => switchView(n.dataset.view));
  });
  document.getElementById('viewAllLink').addEventListener('click', (e) => {
    e.preventDefault();
    switchView('runs');
  });

  function setAiBadgeState(info, mode) {
    const btn = document.getElementById('aiToggleBtn');
    btn.classList.remove('on', 'off', 'error');
    if (info?.provider === 'ollama') {
      btn.classList.add('on');
      btn.textContent = `AI: ON (${info.model})`;
      btn.title = `Click to disable. Local LLM: ${info.model} @ ${info.baseUrl}`;
    } else if (mode === 'on') {
      btn.classList.add('error');
      btn.textContent = 'AI: unavailable';
      btn.title = info?.reason || 'Ollama not detected';
    } else {
      btn.classList.add('off');
      btn.textContent = 'AI: OFF';
      btn.title = info?.reason || 'Click to enable local AI (requires Ollama)';
    }
  }
  async function refreshAiStatus() {
    try {
      const info = await (await fetch('/api/ai/info')).json();
      setAiBadgeState(info, info.provider === 'ollama' ? 'on' : 'off');
    } catch (e) { /* network blip — leave previous state */ }
  }
  document.getElementById('aiToggleBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const isOn = btn.classList.contains('on');
    const target = isOn ? 'off' : 'on';
    btn.disabled = true; btn.textContent = 'AI: …';
    try {
      const r = await (await fetch('/api/ai/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: target }),
      })).json();
      setAiBadgeState(r.info, target);
      if (target === 'on' && !r.ok) showToast(r.reason || 'Could not enable AI', 'error');
      else if (target === 'on')     showToast(`AI enabled — ${r.info.provider}/${r.info.model}`, 'ok');
      else                           showToast('AI disabled', 'info');
      // [ZAC-FIX 2026-05-24] Broadcast for the top-bar badge + AI panel
      // so they re-render without a page refresh. Same event that
      // zacFixes.js fires after a Settings-page toggle.
      try {
        window.dispatchEvent(new CustomEvent('zac:ai-state-changed', {
          detail: { info: r.info, reason: 'dashboard-toggle', at: Date.now() },
        }));
      } catch (_) { /* ignore */ }
      // Also write through ZacSettings so OTHER tabs (Settings page,
      // Recording page) see the change via the storage event. Without
      // this, the Settings page checkbox stays out of sync until reload.
      // NOTE: /api/ai/toggle returns { ok, mode, info: { provider,
      // model, baseUrl } } — there is NO `available` field on the
      // toggle response (that lives on /api/ai/info). Derive the
      // desired bool from provider === 'ollama' + ok flag.
      try {
        const desired = target === 'on' && r.ok && r.info?.provider === 'ollama';
        if (window.ZacSettings && window.ZacSettings.get().ollamaEnabled !== desired) {
          window.ZacSettings.set({ ollamaEnabled: desired });
        }
      } catch (_) { /* ZacSettings might not be loaded — ignore */ }
    } catch (e) {
      setAiBadgeState({ provider: 'null', reason: e.message }, target);
      showToast('Toggle failed: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // [ZAC-FIX 2026-05-24] Listen for AI state changes triggered elsewhere
  // (Settings page toggle, AI panel, another tab) and re-render the
  // dashboard badge live.
  window.addEventListener('zac:ai-state-changed', (e) => {
    const info = e?.detail?.info;
    setAiBadgeState(info, info?.available ? 'on' : 'off');
  });

  function showToast(msg, kind) {
    const t = document.createElement('div');
    const colors = { ok: '#4ade80', error: '#f87171', info: '#5aa9ff' }[kind] || '#5aa9ff';
    t.style.cssText = `position:fixed; bottom:24px; right:24px; padding:12px 18px;
      background:#161a22; border:1px solid ${colors}; color:${colors};
      border-radius:8px; font-size:13px; z-index:9999;
      box-shadow:0 8px 24px rgba(0,0,0,0.4); max-width:400px;`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }

  let liveFailStreak = 0;
  // T4.2 — track the last rerun-completed timestamp the server reported.
  // When this changes, we trigger an immediate full /api/dashboard/stats
  // refresh so the user sees their new run in the dashboard within ~2s
  // (the live-poll cadence) instead of up to 30s (the stats cadence).
  let lastSeenRerunCompletedAt = 0;
  async function pollLive() {
    try {
      const snap = await (await fetch('/api/dashboard/live')).json();
      liveFailStreak = 0;
      const dot = document.getElementById('liveDot');
      dot.style.background = '#4ade80';
      document.getElementById('liveText').textContent = 'live';

      // T4.2 — detect a freshly-completed rerun and refresh stats now.
      if (snap.lastRerunCompleted && snap.lastRerunCompleted.completedAt
          && snap.lastRerunCompleted.completedAt > lastSeenRerunCompletedAt) {
        const wasFirstObservation = lastSeenRerunCompletedAt === 0;
        lastSeenRerunCompletedAt = snap.lastRerunCompleted.completedAt;
        // Skip the toast on the first poll after page-load (the
        // server's marker survives from before we opened the dashboard).
        if (!wasFirstObservation) {
          const lrc = snap.lastRerunCompleted;
          showToast(
            `Rerun finished${lrc.success ? ' ✓' : ' ✗'}${lrc.projectId ? ' — ' + lrc.projectId : ''}${lrc.testName ? ' / ' + lrc.testName : ''}`,
            lrc.success ? 'ok' : 'error',
          );
          load(); // pull fresh aggregate stats now
        }
      }

      const sn = document.getElementById('liveSessions');
      sn.textContent = snap.sessions.count;
      sn.classList.toggle('busy', snap.sessions.count > 0);
      document.getElementById('liveSessionsDetail').textContent = snap.sessions.count === 0
        ? 'no active sessions'
        : snap.sessions.items.slice(0, 3).map((s) =>
            `${s.sessionId.slice(0, 8)}… (${s.actionCount} actions)`).join(', ');

      const rn = document.getElementById('liveReruns');
      rn.textContent = snap.reruns.count;
      rn.classList.toggle('busy', snap.reruns.count > 0);
      document.getElementById('liveRerunsDetail').textContent = snap.reruns.count === 0
        ? 'no active reruns'
        : snap.reruns.items.slice(0, 3).map((r) =>
            `${r.executionId.slice(0, 8)}…${r.cancelled ? ' (cancelled)' : ''}`).join(', ');

      document.getElementById('liveHeap').textContent = `${snap.server.heapUsedMB} MB`;
      document.getElementById('liveServerDetail').textContent = `RSS ${snap.server.rssMB} MB · ${snap.server.nowIso.slice(11, 19)} UTC`;
      document.getElementById('liveUptime').textContent = fmtUptimeShort(snap.server.uptimeSeconds);
      document.getElementById('liveLoad').textContent = snap.server.loadAvg1m != null ? `load: ${snap.server.loadAvg1m}` : 'load: n/a';

      liveCount = (snap.sessions.count || 0) + (snap.reruns.count || 0);
      document.getElementById('kRunning').textContent = liveCount;
      const overviewBadge = document.getElementById('navOverviewCount');
      overviewBadge.textContent = liveCount;
      overviewBadge.classList.toggle('muted', liveCount === 0);
    } catch (e) {
      liveFailStreak++;
      // Defensive: these elements live inside <main>, which a prior load()
      // failure may have replaced with an error banner. Skip cleanly if so.
      const dot = document.getElementById('liveDot');
      if (dot) dot.style.background = '#f87171';
      const txt = document.getElementById('liveText');
      if (txt) txt.textContent = `offline (${liveFailStreak})`;
    }
  }

  function load() {
    // [ZAC-FIX 2026-05-24] Honor the orphan toggle — when the user
    // ticks "Include orphan projects", `window.zacIncludeOrphans`
    // is set to true and we must pass `existingOnly=false` to the
    // stats endpoint. Without this the table kept showing "0 rows"
    // because the server filters out reruns whose project no
    // longer exists in projects/, regardless of what the toggle
    // says. Default = filter on (current behaviour).
    const includeOrphans = !!window.zacIncludeOrphans;
    const url = '/api/dashboard/stats' + (includeOrphans ? '?existingOnly=false' : '');
    fetch(url).then((r) => r.json()).then((stats) => {
      lastStats = stats;
      const sel = document.getElementById('filterFramework');
      const cur = sel.value;
      sel.innerHTML = '<option value="">all</option>';
      for (const f of stats.frameworks) {
        const o = document.createElement('option');
        o.value = f.id; o.textContent = `${f.id} (${f.projectCount})`;
        sel.appendChild(o);
      }
      sel.value = cur;

      // T4.3 — repopulate the project filter, preserving the current
      // selection. Projects come from stats.projects (sorted newest-first
      // by dashboardService). Each option is "<projectId> (<rerunCount>)".
      const pjSel = document.getElementById('filterProject');
      if (pjSel) {
        const pjCur = pjSel.value;
        pjSel.innerHTML = '<option value="">all</option>';
        // Deduplicate by projectId (in case the same id appears under
        // multiple frameworks — rare but possible).
        const seen = new Set();
        for (const p of (stats.projects || [])) {
          if (!p || !p.projectId || seen.has(p.projectId)) continue;
          seen.add(p.projectId);
          const o = document.createElement('option');
          o.value = p.projectId;
          o.textContent = `${p.projectId} (${p.rerunCount || 0})`;
          pjSel.appendChild(o);
        }
        pjSel.value = pjCur;
      }

      allReruns = stats.reruns;
      render(stats);
      applyFilters();
    }).catch((err) => {
      // Don't wipe <main> on a transient failure — that would also kill the
      // live header, sidebar links and break pollLive(). Show a non-blocking
      // toast instead so the user can retry via the refresh button.
      console.error('[dashboard] stats fetch failed:', err);
      showToast('Stats fetch failed: ' + err.message, 'error');
      const ts = document.getElementById('generatedAt');
      if (ts) ts.textContent = 'stats unavailable';
    });
  }

  ['filterFramework', 'filterProject', 'filterStatus', 'filterText'].forEach((id) => {
    const elNode = document.getElementById(id);
    if (elNode) elNode.addEventListener('input', applyFilters);
  });

  document.getElementById('refreshBtn').addEventListener('click', () => { load(); pollLive(); });

  // ── Clear runs (with confirmation modal) ──────────────────────
  // Honors the dashboard's framework filter — when a filter is active,
  // only that subset is cleared. With no filter, every rerun across all
  // frameworks is targeted (after explicit confirmation).
  function buildClearScope() {
    const fw = document.getElementById('filterFramework')?.value || '';
    const proj = document.getElementById('filterProject')?.value || '';
    if (!fw && !proj) return 'all';
    const scope = {};
    if (fw)   scope.framework = fw;
    if (proj) scope.projectId = proj;
    return scope;
  }
  function describeScope(scope) {
    if (scope === 'all') return 'ALL reruns across every framework';
    const parts = [];
    if (scope.framework) parts.push(`framework=${scope.framework}`);
    if (scope.projectId) parts.push(`project=${scope.projectId}`);
    return parts.join(', ') || '(no filter)';
  }
  function fmtBytes(n) {
    if (!n) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  // Preview is built client-side from lastStats — the existing
  // /api/dashboard/clear route doesn't support dry-run, so we filter
  // the rerun list locally to show "X reruns will be deleted".
  function previewRerunsForScope(scope) {
    const reruns = lastStats?.reruns || [];
    if (scope === 'all') return reruns;
    return reruns.filter((r) =>
      (!scope.framework || r.framework === scope.framework) &&
      (!scope.projectId || r.projectId === scope.projectId)
    );
  }
  async function openClearModal() {
    const backdrop = document.getElementById('clearModalBackdrop');
    const scopeLine = document.getElementById('clearModalScope');
    const preview = document.getElementById('clearModalPreview');
    const confirm = document.getElementById('clearModalConfirm');
    const scope = buildClearScope();
    scopeLine.textContent = 'scope: ' + describeScope(scope);
    backdrop.classList.add('show');

    const matched = previewRerunsForScope(scope);
    if (matched.length === 0) {
      preview.innerHTML = '';
      preview.appendChild(el('div', { class: 'row' }, 'Nothing to delete in this scope.'));
      confirm.disabled = true;
      return;
    }
    preview.innerHTML = '';
    preview.appendChild(el('div', { class: 'row', style: 'color:var(--text); margin-bottom:6px;' },
      `${matched.length} rerun${matched.length === 1 ? '' : 's'} matched ` +
      `(across ${new Set(matched.map((r) => r.projectId)).size} project${new Set(matched.map((r) => r.projectId)).size === 1 ? '' : 's'})`));
    matched.slice(0, 50).forEach((r) =>
      preview.appendChild(el('div', { class: 'row' },
        `${r.framework}/${r.projectId}/reruns/${r.testName}/${r.timestamp}`)));
    if (matched.length > 50) {
      preview.appendChild(el('div', { class: 'row', style: 'color:var(--text-mute);' },
        `…and ${matched.length - 50} more`));
    }
    confirm.disabled = false;
    confirm.dataset.scope = JSON.stringify(scope);
  }
  function closeClearModal() {
    document.getElementById('clearModalBackdrop').classList.remove('show');
  }
  async function executeClear() {
    const confirm = document.getElementById('clearModalConfirm');
    const raw = confirm.dataset.scope;
    if (!raw) { closeClearModal(); return; }
    const scope = JSON.parse(raw);
    confirm.disabled = true;
    confirm.textContent = 'Deleting…';
    try {
      // Map our scope shape to the existing route's body shape.
      // body = { framework?, projectId?, confirm:true }
      const body = scope === 'all'
        ? { confirm: true }
        : { ...scope, confirm: true };
      const r = await (await fetch('/api/dashboard/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })).json();
      closeClearModal();
      if (r.success) {
        showToast(`Cleared ${r.rerunsRemoved} reruns across ${r.removed?.length || 0} project(s)`, 'ok');
      } else {
        showToast('Clear failed: ' + (r.error || 'unknown'), 'error');
      }
      load(); pollLive();
    } catch (e) {
      closeClearModal();
      showToast('Clear failed: ' + e.message, 'error');
    } finally {
      confirm.disabled = false;
      confirm.textContent = 'Confirm delete';
    }
  }
  document.getElementById('clearBtn').addEventListener('click', openClearModal);
  document.getElementById('clearModalCancel').addEventListener('click', closeClearModal);
  document.getElementById('clearModalConfirm').addEventListener('click', executeClear);
  // Esc to close, click backdrop to close.
  document.getElementById('clearModalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'clearModalBackdrop') closeClearModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeClearModal();
  });
  // Live-update the button label whenever the filter changes.
  function updateClearButtonLabel() {
    const scope = buildClearScope();
    const btn = document.getElementById('clearBtn');
    btn.textContent = scope === 'all' ? '🗑 Clear ALL runs' : '🗑 Clear filtered runs';
    btn.title = 'Will clear: ' + describeScope(scope);
  }
  ['filterFramework', 'filterProject'].forEach((id) => {
    const node = document.getElementById(id);
    if (node) node.addEventListener('change', updateClearButtonLabel);
  });
  updateClearButtonLabel();

  document.getElementById('exportBtn').addEventListener('click', () => {
    if (!lastStats) { showToast('Nothing to export yet', 'info'); return; }
    const blob = new Blob([JSON.stringify(lastStats, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zac-dashboard-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Report downloaded', 'ok');
  });

  // "📧 Email report" — POSTs to /api/email/send-dashboard. The server
  // T4.4 — "Clear" button. Filter-aware:
  //   • no filters active                  → confirm-then-clear ALL reruns
  //   • framework filter active            → clear only that framework
  //   • project filter active              → clear EVERYTHING EXCEPT that
  //                                          project (preserve mode) — so
  //                                          the user's currently-focused
  //                                          project is never accidentally
  //                                          wiped
  // We use window.confirm() rather than a custom modal so the IDE has no
  // additional dependencies and the prompt cannot be misclicked.
  const clearBtn = document.getElementById('clearRunsBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      const fw = document.getElementById('filterFramework').value;
      const pj = (document.getElementById('filterProject') || {}).value;
      let body, summary;
      if (pj) {
        body = { projectId: pj, preserve: true, confirm: true };
        summary = `Clear ALL rerun history EXCEPT project "${pj}"?`;
      } else if (fw) {
        body = { framework: fw, confirm: true };
        summary = `Clear rerun history for ALL projects in framework "${fw}"?`;
      } else {
        body = { confirm: true };
        summary = 'Clear rerun history for EVERY project? This cannot be undone.';
      }
      if (!window.confirm(summary)) return;
      clearBtn.disabled = true;
      const origText = clearBtn.textContent;
      clearBtn.textContent = '🗑 clearing…';
      try {
        const r = await fetch('/api/dashboard/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const j = await r.json();
        if (j.success) {
          showToast(`Cleared ${j.rerunsRemoved} reruns across ${j.removed?.length || 0} projects`, 'ok');
          load();    // refresh stats now
          pollLive();// and pick up the bumped marker
        } else {
          showToast('Clear failed: ' + (j.error || 'unknown'), 'error');
        }
      } catch (e) {
        showToast('Clear failed: ' + e.message, 'error');
      } finally {
        clearBtn.disabled = false;
        clearBtn.textContent = origText;
      }
    });
  }

  // [ZAC-FIX 2026-05-24] "Delete all projects" — bulk wipe.
  //
  // Confirms via a hard double-prompt before firing DELETE /api/projects.
  // The endpoint deletes:
  //   - projects/<id>/                      (recordings, project.json, locator repo)
  //   - generated-projects/<framework>/<id>/ (generated code, reruns, screenshots, videos)
  //
  // It does NOT touch:
  //   - config/                  (frameworks.json, email.json, credentials.json)
  //   - public/                  (frontend assets / Settings UI)
  //   - the AI / locator-strategy / environment / settings stored in
  //     localStorage on the user's browser
  const deleteAllBtn = document.getElementById('deleteAllProjectsBtn');
  if (deleteAllBtn) {
    deleteAllBtn.addEventListener('click', async () => {
      // Two-stage confirmation: a confirm() and then a typed-string check.
      // Even with a misclick this can't fire by accident.
      const ok1 = window.confirm(
        'Delete EVERY project? This will remove all recordings, generated ' +
        'code, reruns, screenshots, and videos.\n\n' +
        'Settings, AI config, email config, framework registry, and locator ' +
        'strategy snapshots will be PRESERVED.\n\n' +
        'Click OK to continue.'
      );
      if (!ok1) return;
      const typed = window.prompt(
        'Type DELETE in capitals to confirm bulk-deleting every project:'
      );
      if (typed !== 'DELETE') {
        showToast('Bulk delete cancelled.', 'info');
        return;
      }

      const orig = deleteAllBtn.textContent;
      deleteAllBtn.disabled = true;
      deleteAllBtn.textContent = '🗑 deleting…';
      try {
        const r = await fetch('/api/projects', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: true }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.success) {
          const errCount = (j.errors || []).length;
          const msg = errCount > 0
            ? `Deleted ${j.deleted} project(s); ${errCount} error(s).`
            : `Deleted ${j.deleted} project(s).`;
          showToast(msg, errCount > 0 ? 'warn' : 'success');
          console.log('[ZAC-FIX] bulk delete:', j);
          // Force a fresh stats fetch so the dashboard zeroes out
          // (load + pollLive are the same handlers Refresh uses).
          try { if (typeof load === 'function') load(); } catch (_) { /* ignore */ }
          try { if (typeof pollLive === 'function') pollLive(); } catch (_) { /* ignore */ }
        } else {
          showToast('Bulk delete failed: ' + (j.error || ('HTTP ' + r.status)), 'error');
        }
      } catch (e) {
        showToast('Bulk delete failed: ' + e.message, 'error');
      } finally {
        deleteAllBtn.disabled = false;
        deleteAllBtn.textContent = orig;
      }
    });
  }

  // [ZAC-FIX 2026-05-24] Clean orphans button — removes
  // generated-projects/<fw>/<id>/ dirs whose <id> isn't in projects/.
  // Less destructive than bulk delete; ideal after harness runs leave
  // clutter behind. Single confirmation (vs the two-step
  // "Delete all projects" because nothing user-recorded is at stake).
  const cleanOrphansBtn = document.getElementById('cleanOrphansBtn');
  if (cleanOrphansBtn) {
    cleanOrphansBtn.addEventListener('click', async () => {
      const ok = window.confirm(
        'Clean orphan generated-projects/* directories?\n\n' +
        'This removes generated code + reruns for projects whose ' +
        'project.json no longer exists in projects/. Real projects ' +
        'and their reruns are NOT affected.'
      );
      if (!ok) return;
      const orig = cleanOrphansBtn.textContent;
      cleanOrphansBtn.disabled = true;
      cleanOrphansBtn.textContent = '🧹 cleaning…';
      try {
        const r = await fetch('/api/dashboard/clean-orphans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: true }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.success) {
          showToast(
            j.removedCount === 0
              ? 'No orphans to clean — disk is tidy.'
              : `Cleaned ${j.removedCount} orphan director${j.removedCount === 1 ? 'y' : 'ies'}.`,
            j.removedCount > 0 ? 'success' : 'info'
          );
          console.log('[ZAC-FIX] orphans cleaned:', j);
          // Refresh dashboard so framework projection numbers drop
          try { if (typeof load === 'function') load(); } catch (_) {}
          try { if (typeof pollLive === 'function') pollLive(); } catch (_) {}
          window.dispatchEvent(new CustomEvent('zac-runs:changed'));
        } else {
          showToast('Cleanup failed: ' + (j.error || ('HTTP ' + r.status)), 'error');
        }
      } catch (e) {
        showToast('Cleanup failed: ' + e.message, 'error');
      } finally {
        cleanOrphansBtn.disabled = false;
        cleanOrphansBtn.textContent = orig;
      }
    });
  }

  // collects fresh stats itself (we don't trust client-side cache for the
  // authoritative summary) and sends to the address configured in
  // Settings → Email. Falls open with a clear message if SMTP isn't set
  // up yet — never silently no-ops.
  document.getElementById('emailReportBtn').addEventListener('click', async () => {
    const btn = document.getElementById('emailReportBtn');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '📧 sending…';
    try {
      // Pre-check: is email even enabled? Saves a confusing 500.
      const cfg = await (await fetch('/api/email/config')).json();
      if (!cfg.enabled || !cfg.host) {
        showToast('Email is not configured — open Settings → Email to set SMTP credentials.', 'error');
        try {
          const top = window.top;
          if (top && top !== window) {
            const settingsBtn = top.document.querySelector('#appTabs button[data-tab="settings"]');
            if (settingsBtn) settingsBtn.click();
          }
        } catch { /* cross-origin: ignore */ }
        return;
      }
      const r = await (await fetch('/api/email/send-dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'Triggered from the ZAC dashboard "Email report" button.' }),
      })).json();
      if (r.ok) showToast(`Sent → ${cfg.to || 'configured recipient'}`, 'ok');
      else      showToast('Send failed: ' + (r.error || 'unknown'), 'error');
    } catch (e) {
      showToast('Send failed: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  });

  // "+ New run" — switch parent IDE to the recorder tab when embedded; fall back to /
  document.getElementById('newRunBtn').addEventListener('click', () => {
    try {
      const top = window.top;
      if (top && top !== window) {
        const recBtn = top.document.querySelector('#appTabs button[data-tab="recorder"]');
        if (recBtn) { recBtn.click(); return; }
      }
    } catch { /* cross-origin guard — fall through */ }
    try { window.top.location.href = '/'; }
    catch { window.location.href = '/'; }
  });

  // Approximate "dev / localhost" environment label for the sidebar foot.
  (function initEnv() {
    try {
      const host = (window.top && window.top.location.hostname) || window.location.hostname || 'localhost';
      const env = (host === 'localhost' || host === '127.0.0.1') ? 'dev' : (host.split('.')[0] || 'dev');
      document.getElementById('envLine').textContent = `${env} / ${host}`;
    } catch { /* keep default */ }
  })();

  refreshAiStatus();
  load();
  pollLive();
  setInterval(load, 30_000);
  setInterval(pollLive, 2_000);
  setInterval(refreshAiStatus, 15_000);

  // [ZAC-FIX 2026-05-24] When zacFixes.js fires the orphan-toggle
  // change event, immediately reload stats with the new filter so
  // the user sees orphan reruns appear/disappear without waiting
  // for the 30s tick. Also expose `load` on window so the toggle's
  // existing best-effort `window.load?.()` actually works.
  try { if (typeof window !== 'undefined') window.load = load; } catch (_) {}
  window.addEventListener('zac-runs:changed', () => load());
