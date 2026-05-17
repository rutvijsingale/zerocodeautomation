  const params = new URLSearchParams(location.search);
  const path = params.get('path');
  if (!path) {
    document.getElementById('error').style.display = 'block';
    document.getElementById('error').textContent = 'Missing ?path=<framework>/<project>/reruns/<test>/<timestamp>';
    throw new Error('no path');
  }
  document.getElementById('reportTitle').textContent = 'Report: ' + path;

  // ── Download buttons (HTML / JSON / PDF) ─────────────────────────
  // HTML: server-side rendered, self-contained, downloads via /api endpoint
  document.getElementById('dlHtmlBtn').addEventListener('click', () => {
    window.location.href = `/api/dashboard/report/html?path=${encodeURIComponent(path)}`;
  });
  // JSON: direct link to the static replay-result.json (download attribute)
  document.getElementById('dlJsonBtn').href = `/reports/${path}/replay-result.json`;
  // PDF: window.print() → user picks "Save as PDF" in the print dialog.
  // The @media print rules in <style> above strip the dark theme and
  // collapse extraneous chrome before printing.
  document.getElementById('dlPdfBtn').addEventListener('click', () => window.print());

  function fmtMs(ms) {
    if (!ms || ms < 0) return '—';
    if (ms < 1000) return ms + ' ms';
    return (ms / 1000).toFixed(1) + ' s';
  }

  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v);
    }
    for (const c of children) {
      if (c == null) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }

  // ── Load main result ──────────────────────────────────────────
  fetch(`/reports/${path}/replay-result.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(renderResult)
    .catch((err) => {
      document.getElementById('error').style.display = 'block';
      document.getElementById('error').textContent = `Failed to load report: ${err.message}`;
    });

  function renderResult(data) {
    // ── KPI strip ──
    const results = Array.isArray(data.results) ? data.results : [];
    const passed = data.successCount ?? results.filter((r) => r?.success).length;
    const failed = data.failureCount ?? results.filter((r) => r && r.success === false).length;
    const heal = data.healingSummary?.healedSteps
      ?? results.filter((r) => r?.healed).length;
    const duration = data.durationMs ?? results.reduce((s, r) => s + (Number(r?.duration) || 0), 0);
    const status = failed > 0 ? 'FAILED' : (results.length > 0 ? 'PASSED' : 'UNKNOWN');

    document.getElementById('statValStatus').textContent = status;
    document.getElementById('statValStatus').style.color = failed > 0 ? 'var(--red)' : 'var(--green)';
    document.getElementById('statValPassed').textContent = passed;
    document.getElementById('statValFailed').textContent = failed;
    document.getElementById('statValHeal').textContent = heal;
    document.getElementById('statValDuration').textContent = fmtMs(duration);

    // Header timestamp pulled from path (last segment).
    const ts = path.split('/').pop();
    document.getElementById('reportTimestamp').textContent = ts;

    // ── Step list ──
    const host = document.getElementById('stepListHost');
    if (results.length === 0) {
      host.appendChild(el('div', { class: 'empty' }, 'no step results in this report'));
    } else {
      results.forEach((r, i) => {
        const row = el('div', { class: 'step-row' });
        row.appendChild(el('span', { class: 'idx' }, String(i + 1)));
        row.appendChild(el('span', { class: 'kind' }, String(r.step || r.kind || '?')));
        const desc = r.description || r.selector || '';
        row.appendChild(el('span', { class: 'desc' }, desc));
        row.appendChild(el('span', { class: 'duration' }, fmtMs(r.duration || 0)));
        const statusCell = el('span', { class: 'status' });
        if (r.healed) {
          statusCell.appendChild(el('span', { class: 'pill heal' }, 'healed'));
        } else if (r.success === false) {
          statusCell.appendChild(el('span', { class: 'pill failed' }, 'failed'));
        } else {
          statusCell.appendChild(el('span', { class: 'pill passed' }, 'passed'));
        }
        row.appendChild(statusCell);
        host.appendChild(row);

        // Healing detail (collapsible-style mini-panel under the row)
        if (r.healed) {
          const detail = el('div', { class: 'heal-detail' });
          detail.appendChild(el('div', {}, '🩹 self-healed'));
          if (r.primarySelector) {
            const fromLine = el('div');
            fromLine.appendChild(document.createTextNode('  primary failed: '));
            fromLine.appendChild(el('span', { class: 'from' }, r.primarySelector));
            detail.appendChild(fromLine);
          }
          if (r.healedVia) {
            const toLine = el('div');
            toLine.appendChild(document.createTextNode('  rescued via:    '));
            toLine.appendChild(el('span', { class: 'to' }, r.healedVia));
            detail.appendChild(toLine);
          }
          if (Array.isArray(r.healAttempts)) {
            detail.appendChild(el('div', {}, `  attempted ${r.healAttempts.length} candidate(s)`));
          }
          host.appendChild(detail);
        }

        // Failure detail
        if (r.success === false && r.error) {
          const detail = el('div', { class: 'heal-detail' });
          detail.style.borderLeftColor = 'var(--red)';
          detail.style.background = 'rgba(248,113,113,0.05)';
          detail.appendChild(el('div', {}, '✖ ' + r.error));
          host.appendChild(detail);
        }
      });
    }

    // ── Raw JSON pretty-print ──
    document.getElementById('rawJson').textContent = JSON.stringify(data, null, 2);
  }

  // ── Artifact links bar ───────────────────────────────────────
  const links = document.getElementById('artifactLinks');
  for (const [label, sub] of [
    ['replay-result.json', '/replay-result.json'],
    ['report/',            '/report/'],
    ['screenshots/',       '/screenshots/'],
    ['videos/',            '/videos/'],
    ['traces/',            '/traces/'],
    ['logs/',              '/logs/'],
  ]) {
    links.appendChild(el('a', {
      class: 'file-link',
      href: `/reports/${path}${sub}`,
      target: '_blank',
      rel: 'noopener',
    }, label));
  }

  // ── Try to auto-render screenshot + video files via static listing.
  // Browsers don't support directory listing of /reports/...,
  // so instead we attempt a small set of conventional names and
  // fall back to the link bar above. The key UX: clicking any of
  // the link-bar entries gets the raw asset.
  ['screenshotsHost', 'videosHost'].forEach((id) => {
    document.getElementById(id).appendChild(el('div', { class: 'empty' },
      'Use the artifact-link buttons above to browse files in a new tab.'));
  });
