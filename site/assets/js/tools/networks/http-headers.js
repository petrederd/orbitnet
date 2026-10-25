function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function showError(m) {
  const el = document.getElementById('errorMsg');
  el.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'error';
  div.textContent = String(m == null ? '' : m);
  el.appendChild(div);
}
function clearError() { document.getElementById('errorMsg').innerHTML = ''; }

const AUDIT = [
  { name: 'strict-transport-security', label: 'HSTS', hint: 'Add Strict-Transport-Security: max-age=31536000; includeSubDomains (HTTPS only).' },
  { name: 'content-security-policy', label: 'CSP', hint: 'Define a Content-Security-Policy to reduce XSS risk.' },
  { name: 'x-content-type-options', label: 'nosniff', expect: 'nosniff', hint: 'Set X-Content-Type-Options: nosniff.' },
  { name: 'x-frame-options', label: 'X-Frame-Options', hint: 'Set X-Frame-Options: DENY or SAMEORIGIN (or use CSP frame-ancestors).' },
  { name: 'referrer-policy', label: 'Referrer-Policy', hint: 'Set Referrer-Policy: strict-origin-when-cross-origin.' },
  { name: 'permissions-policy', label: 'Permissions-Policy', hint: 'Consider a Permissions-Policy to disable unused features.' }
];

function check() {
  clearError();
  const host = document.getElementById('host').value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!host) { showError('Please enter a host'); return; }

  document.getElementById('results').innerHTML = '<div class="loading">Fetching headers...</div>';
  document.getElementById('audit').innerHTML = '<div class="loading">Checking...</div>';

  fetch('/api/headers?host=' + encodeURIComponent(host))
    .then(r => r.json())
    .then(d => { if (d.error) { showError(d.error + (d.workerError ? ' (Worker: ' + d.workerError + ')' : '')); } render(d); })
    .catch(e => { showError(e.message); });
}

function render(d) {
  const map = {};
  (d.headers || []).forEach(h => { map[h.name.toLowerCase()] = h.value; });

  const presenceOnly = d.source === 'worker' &&
    (d.headers || []).some(h => h.value === 'present');
  let html = (d.source === 'worker'
    ? '<div class="status-box info">The local check failed or looked blocked; the response was fetched by the external checker.</div>'
    : '') +
    '<div class="grid-2">' +
    '<div class="result-box"><div class="result-label">Status</div><div class="result-value" style="font-size:1.4rem;color:' + (d.status && d.status < 400 ? 'var(--accent)' : 'var(--danger)') + '">' + esc(d.status == null ? '—' : d.status) + '</div></div>' +
    '<div class="result-box"><div class="result-label">Protocol</div><div class="result-value" style="font-size:1.4rem;">' + esc(d.protocol || '—') + '</div></div>' +
    '<div class="result-box"><div class="result-label">Resolved IP</div><div class="result-value">' + esc(d.ip || '—') + '</div></div>' +
    '<div class="result-box"><div class="result-label">Response time</div><div class="result-value">' + esc(d.responseMs == null ? '—' : d.responseMs + ' ms') + '</div></div>' +
    '</div>';

  if (d.redirect) {
    html += '<div class="result-box"><div class="result-label">Location</div><div class="result-value" style="font-size:.9rem;">' + esc(d.redirect) + '</div></div>';
  }

  if (d.headers && d.headers.length) {
    let rows = '<div class="result-box"><div class="result-label">' + (presenceOnly ? 'Detected headers' : 'All headers') + ' (' + d.headers.length + ')</div>' +
      '<div style="margin-top:8px;font-family:monospace;font-size:.82rem;line-height:1.7;word-break:break-word;">';
    d.headers.forEach(h => {
      rows += '<div><span style="color:var(--accent)">' + esc(h.name) + '</span>: ' + esc(h.value) + '</div>';
    });
    rows += '</div></div>';
    html += rows;
  } else {
    html += '<div class="result-box"><div class="result-label">Headers</div><div class="result-value">No headers received</div></div>';
  }

  document.getElementById('results').innerHTML = html;

  let audit = '';
  AUDIT.forEach(a => {
    if (d.protocol !== 'https' && a.name === 'strict-transport-security') {
      audit += '<div class="status-box info">HSTS skipped — the site is served over plain HTTP.</div>';
      return;
    }
    const val = map[a.name];
    const flagOnly = presenceOnly && val === 'present';
    if (val && (flagOnly || !a.expect || val.toLowerCase().includes(a.expect))) {
      audit += '<div class="status-box success">' + esc(a.label) + ' present</div>';
    } else {
      audit += '<div class="status-box error">' + esc(a.label) + ' missing — ' + esc(a.hint) + '</div>';
    }
  });
  if (map['cache-control']) {
    audit += '<div class="status-box info">Cache-Control: ' + esc(map['cache-control']) + '</div>';
  } else {
    audit += '<div class="status-box info">No Cache-Control header — caching behaviour is left to defaults.</div>';
  }
  document.getElementById('audit').innerHTML = audit;
}
