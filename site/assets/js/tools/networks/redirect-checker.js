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

function codeColor(s) {
  if (s == null) return 'var(--danger)';
  if (s >= 200 && s < 300) return 'var(--accent)';
  if (s >= 300 && s < 400) return 'var(--warning)';
  return 'var(--danger)';
}

function check() {
  clearError();
  const host = document.getElementById('host').value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!host) { showError('Please enter a host'); return; }

  document.getElementById('results').innerHTML = '<div class="loading">Tracing redirects...</div>';

  fetch('/api/redirect?host=' + encodeURIComponent(host))
    .then(r => r.json())
    .then(d => { if (d.error) { showError(d.error); document.getElementById('results').innerHTML = ''; return; } render(d); })
    .catch(e => { showError(e.message); document.getElementById('results').innerHTML = ''; });
}

function render(d) {
  const chain = d.chain || [];
  const httpsIssue = chain.some(c => /^http:\/\//i.test(c.url));
  const tooLong = chain.length >= 10;

  let status = '<div class="status-box success">Reached ' + esc(d.finalUrl) + ' in ' + chain.length + ' request(s).</div>';
  if (tooLong) status = '<div class="status-box error">Redirect chain is too long (10+ hops).</div>';
  else if (chain.some(c => c.blocked)) status = '<div class="status-box error">Chain stopped: a redirect points to a private address.</div>';
  else if (chain.some(c => c.error)) status = '<div class="status-box error">A hop failed.</div>';
  else if (httpsIssue) status = '<div class="status-box info">Chain reaches ' + esc(d.finalUrl) + ', but some hops use plain HTTP.</div>';

  let html = (d.source === 'worker'
    ? '<div class="status-box info">The local check failed or looked blocked; the chain was traced by the external checker.</div>'
    : '') + (d.workerError
    ? '<div class="status-box info">Worker fallback did not run: ' + esc(d.workerError) + '</div>'
    : '') + status + '<div class="result-box" style="margin-top:14px;"><div class="result-label">Final URL</div>' +
    '<div class="result-value" style="font-size:.95rem;word-break:break-all;">' + esc(d.finalUrl) + '</div></div>';

  html += '<div class="result-box"><div class="result-label">Chain</div><div style="margin-top:8px;">';
  chain.forEach((c, i) => {
    html += '<div style="display:flex;gap:10px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--line);">' +
      '<span style="font-weight:700;color:' + codeColor(c.status) + ';min-width:42px;">' + esc(c.status == null ? 'ERR' : c.status) + '</span>' +
      '<span style="font-family:monospace;font-size:.82rem;word-break:break-all;flex:1;">' + esc(c.url) +
      (c.location ? '<br><span style="color:var(--muted)">→ ' + esc(c.location) + '</span>' : '') +
      (c.error ? '<br><span style="color:var(--danger)">' + esc(c.error) + '</span>' : '') +
      (c.blocked ? '<br><span style="color:var(--danger)">blocked</span>' : '') +
      (c.ms != null ? '<br><span style="color:var(--muted)">' + esc(c.ms) + ' ms</span>' : '') +
      '</span></div>';
  });
  html += '</div></div>';

  document.getElementById('results').innerHTML = html;
}
