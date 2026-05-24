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
          // [ZAC-FIX 2026-05-24] Inline the failure screenshot when
          // the rerun engine captured one. Massively shortens the
          // root-cause loop — instead of "go find the file in the
          // screenshots/ dir", the user sees the exact viewport at
          // failure right next to the error.
          if (r.screenshot) {
            const url = `/reports/${path}/screenshots/${encodeURIComponent(r.screenshot)}`;
            const a = el('a', { href: url, target: '_blank', rel: 'noopener',
              style: 'display:inline-block;margin-top:8px;' });
            a.appendChild(el('img', {
              src: url, alt: 'failure screenshot',
              style: 'max-width:480px;max-height:300px;border:1px solid var(--red);border-radius:6px;display:block;',
            }));
            a.appendChild(el('div', {
              style: 'font-size:11px;color:var(--muted);margin-top:4px;font-family:monospace;',
            }, '📸 ' + r.screenshot + ' — click to enlarge'));
            detail.appendChild(a);
          }
          host.appendChild(detail);
        }
      });
    }

    // ── Raw JSON pretty-print ──
    document.getElementById('rawJson').textContent = JSON.stringify(data, null, 2);
  }

  // ── Artifact links bar ───────────────────────────────────────
  // [ZAC-FIX 2026-05-24] The old version linked to bare directories
  // (/reports/<path>/screenshots/) which 404'd because
  // express.static is mounted with index:false (no directory
  // listing). Now we hit /api/dashboard/list-files which enumerates
  // each subdir's files, and render direct per-file links so EVERY
  // link actually opens.
  const links = document.getElementById('artifactLinks');
  // Always show the JSON link first — it's the only top-level file
  // and serves as a stable link even if the API is unreachable.
  links.appendChild(el('a', {
    class: 'file-link',
    href: `/reports/${path}/replay-result.json`,
    target: '_blank',
    rel: 'noopener',
  }, 'replay-result.json'));

  function fmtBytes(n) {
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n < 1024)        return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  fetch(`/api/dashboard/list-files?path=${encodeURIComponent(path)}`)
    .then((r) => r.ok ? r.json() : { ok: false })
    .then((data) => {
      if (!data || !data.ok) return;

      // Promote the rendered HTML report (if present) to a top-of-bar pill —
      // this is what most users actually want when they click "report/".
      if (data.htmlReport) {
        const a = el('a', {
          class: 'file-link',
          href: data.htmlReport.url,
          target: '_blank',
          rel: 'noopener',
          title: 'self-contained HTML report (' + fmtBytes(data.htmlReport.bytes) + ')',
          style: 'background:rgba(16,185,129,0.18);border-color:rgba(16,185,129,0.45);color:#10b981;',
        }, '📊 report/index.html');
        links.appendChild(a);
      }

      // Per-section file pills. Empty sections render a muted placeholder
      // so users can see "no screenshots in this run" instead of clicking
      // a broken directory link.
      for (const [sectionLabel, files] of [
        ['report',      data.report],
        ['screenshots', data.screenshots],
        ['videos',      data.videos],
        ['traces',      data.traces],
        ['logs',        data.logs],
      ]) {
        if (!files || files.length === 0) {
          links.appendChild(el('span', {
            class: 'file-link',
            style: 'opacity:0.4;cursor:default;',
            title: 'no files in this section for this rerun',
          }, `${sectionLabel}/ — none`));
          continue;
        }
        for (const f of files) {
          links.appendChild(el('a', {
            class: 'file-link',
            href: f.url,
            target: '_blank',
            rel: 'noopener',
            title: `${sectionLabel}/${f.name} — ${fmtBytes(f.bytes)}`,
          }, `${sectionLabel}/${f.name}`));
        }
      }

      // Inline gallery: render screenshots + videos directly so users
      // don't need to open them one-by-one. Empty-state messages
      // explain WHY a section may be empty so the user doesn't think
      // the report is broken (most happy-path reruns don't capture
      // any of these — they only fire on explicit step kinds or
      // failures).
      const emptyHint = (kind) => ({
        screenshots:
          'No screenshots in this rerun. They\'re only captured when a step has ' +
          'kind:"screenshot" or when a step fails. ' +
          'To capture during recording: right-click → "Save screenshot here", ' +
          'or add a screenshot step in the Step Builder.',
        videos:
          'No videos in this rerun. Videos are off by default — enable them ' +
          'via the Recording tab\'s "Capture video" toggle, or set ' +
          'ZAC_RECORD_VIDEO=true at server start.',
      }[kind] || ('No ' + kind + ' captured.'));

      const sHost = document.getElementById('screenshotsHost');
      sHost.innerHTML = '';
      if (data.screenshots.length === 0) {
        sHost.appendChild(el('div', { class: 'empty', style: 'padding:14px;line-height:1.5;' }, emptyHint('screenshots')));
      } else {
        for (const f of data.screenshots) {
          const fig = el('figure', { style: 'margin:8px 12px 8px 0;display:inline-block;vertical-align:top;' });
          fig.appendChild(el('img', {
            src: f.url,
            alt: f.name,
            style: 'max-width:240px;max-height:180px;border-radius:6px;display:block;',
          }));
          fig.appendChild(el('figcaption', { style: 'font-family:monospace;font-size:11px;color:var(--muted);margin-top:4px;' }, f.name));
          sHost.appendChild(fig);
        }
      }
      const vHost = document.getElementById('videosHost');
      vHost.innerHTML = '';
      if (data.videos.length === 0) {
        vHost.appendChild(el('div', { class: 'empty', style: 'padding:14px;line-height:1.5;' }, emptyHint('videos')));
      } else {
        for (const f of data.videos) {
          const fig = el('figure', { style: 'margin:8px 12px 8px 0;display:inline-block;vertical-align:top;' });
          const v = el('video', {
            src: f.url,
            controls: '',
            style: 'max-width:320px;max-height:240px;border-radius:6px;display:block;background:#000;',
          });
          fig.appendChild(v);
          fig.appendChild(el('figcaption', { style: 'font-family:monospace;font-size:11px;color:var(--muted);margin-top:4px;' }, f.name));
          vHost.appendChild(fig);
        }
      }
    })
    .catch(() => {
      // Falls open: the JSON link above still works without this endpoint.
      const sHost = document.getElementById('screenshotsHost');
      const vHost = document.getElementById('videosHost');
      sHost.appendChild(el('div', { class: 'empty' }, 'Could not load artifact list. The replay-result.json link above still works.'));
      vHost.appendChild(el('div', { class: 'empty' }, 'Could not load artifact list. The replay-result.json link above still works.'));
    });
