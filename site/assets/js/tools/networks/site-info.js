function clearError() { document.getElementById('errorMsg').innerHTML = ''; }
function showError(m) {
  const el = document.getElementById('errorMsg');
  el.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'error';
  div.textContent = String(m == null ? '' : m);
  el.appendChild(div);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function inspect() {
  clearError();
  const host = document.getElementById('host').value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!host) { showError('Please enter a domain'); return; }

  document.getElementById('results').innerHTML = '<div class="loading">Checking ' + esc(host) + '...</div>';

  fetch('/api/site?host=' + encodeURIComponent(host))
    .then(r => r.json())
    .then(data => {
      if (data.error) {
        document.getElementById('results').innerHTML = '';
        showError('Could not reach ' + host + ': ' + data.error +
          (data.workerError ? ' (Worker: ' + data.workerError + ')' : ''));
        return;
      }
      const statusText = data.status ? ('HTTP ' + data.status) : 'No response';
      const html = `
        ${data.source === 'worker' ? '<div class="status-box info">The local check failed or looked blocked; the result was checked by a Cloudflare Worker.</div>' : ''}
        <div class="grid-2">
          <div class="result-box">
            <div class="result-label">Resolved IP</div>
            <div class="result-value">${esc(data.ip || 'unknown')}</div>
          </div>
          <div class="result-box">
            <div class="result-label">Response time</div>
            <div class="result-value">${data.responseMs} ms</div>
          </div>
          <div class="result-box">
            <div class="result-label">HTTP status</div>
            <div class="result-value">${esc(statusText)}</div>
          </div>
          <div class="result-box">
            <div class="result-label">Server</div>
            <div class="result-value">${esc(data.server || 'hidden')}</div>
          </div>
        </div>
        <div class="result-box">
          <div class="result-label">Page title</div>
          <div class="result-value" style="font-size:1.05rem;">${esc(data.title || '(none)')}</div>
        </div>
        <div class="result-box">
          <div class="result-label">Protocol</div>
          <div class="result-value">${esc((data.protocol || '').toUpperCase())}</div>
        </div>
        ${data.redirect ? `<div class="result-box"><div class="result-label">Redirects to</div><div class="result-value" style="font-size:1rem;">${esc(data.redirect)}</div></div>` : ''}
      `;
      document.getElementById('results').innerHTML = html;
    })
    .catch(e => {
      document.getElementById('results').innerHTML = '';
      showError(e.message);
    });
}
