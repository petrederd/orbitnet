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
function block(label, body) {
  return '<div class="result-box"><div class="result-label">' + esc(label) + '</div>' + body + '</div>';
}
function mono(lines) {
  return '<div class="result-value" style="font-family:monospace;font-size:.85rem;line-height:1.7;word-break:break-word;">' + lines + '</div>';
}

function check() {
  clearError();
  const host = document.getElementById('host').value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const selector = document.getElementById('selector').value.trim();
  if (!host) { showError('Please enter a domain'); return; }

  document.getElementById('results').innerHTML = '<div class="loading">Querying DNS...</div>';

  const url = '/api/email?host=' + encodeURIComponent(host) + (selector ? '&selector=' + encodeURIComponent(selector) : '');
  fetch(url).then(r => r.json()).then(d => {
    if (d.error) { showError(d.error); document.getElementById('results').innerHTML = ''; return; }
    render(host, d);
  }).catch(e => { showError(e.message); document.getElementById('results').innerHTML = ''; });
}

function render(host, d) {
  let html = d.source === 'worker'
    ? '<div class="status-box info">The local resolver did not answer; the email records were fetched by the external checker.</div>'
    : (d.workerError
      ? '<div class="status-box info">Worker fallback did not run: ' + esc(d.workerError) + '</div>'
      : '');
  const errors = d.errors || {};

  if (d.mx && d.mx.length) {
    html += block('MX — mail servers (' + d.mx.length + ')', mono(
      d.mx.map(m => esc(m.priority + '  ' + m.host)).join('<br>')));
  } else {
    html += block('MX — mail servers', '<div class="result-value" style="color:var(--danger)">Not found' +
      (errors.mx ? ' (' + esc(errors.mx) + ')' : '') + ' — the domain cannot receive email.</div>');
  }

  if (d.mxPtr) {
    html += block('PTR — reverse DNS of primary MX', mono(
      esc(d.mxPtr.ip) + ' → ' + d.mxPtr.hostnames.map(esc).join(', ')));
  }

  html += block('SPF', d.spf
    ? mono(esc(d.spf))
    : '<div class="result-value" style="color:var(--warning)">Not found' + (errors.spf ? ' (' + esc(errors.spf) + ')' : '') + '</div>');

  html += block('DMARC', d.dmarc
    ? mono(esc(d.dmarc))
    : '<div class="result-value" style="color:var(--warning)">Not found' + (errors.dmarc ? ' (' + esc(errors.dmarc) + ')' : '') + '</div>');

  const sel = document.getElementById('selector').value.trim();
  if (sel) {
    html += block('DKIM — selector "' + sel + '"', (d.dkim && d.dkim.length)
      ? mono(d.dkim.map(esc).join('<br>'))
      : '<div class="result-value" style="color:var(--warning)">Not found' + (errors.dkim ? ' (' + esc(errors.dkim) + ')' : '') + '</div>');
  } else {
    html += block('DKIM', '<div class="result-value" style="color:var(--muted)">Enter a selector to look up a DKIM key.</div>');
  }

  document.getElementById('results').innerHTML = html;
}
