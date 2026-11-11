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
  if (!host) { showError(t('Please enter a domain')); return; }

  document.getElementById('results').innerHTML = '<div class="loading">' + t('Checking {host}...', { host: esc(host) }) + '</div>';

  fetch('/api/site?host=' + encodeURIComponent(host))
    .then(r => r.json())
    .then(data => {
      if (data.error) {
        document.getElementById('results').innerHTML = '';
        showError(t('Could not reach {host}: {error}', { host, error: data.error }) +
          (data.workerError ? ' (' + t('Worker: {error}', { error: data.workerError }) + ')' : ''));
        return;
      }
      const statusText = data.status ? ('HTTP ' + data.status) : t('No response');
      const html = `
        ${data.source === 'worker' ? '<div class="status-box info">' + t('The local check failed or looked blocked; the result was checked by a Cloudflare Worker.') + '</div>' : ''}
        <div class="grid-2">
          <div class="result-box">
            <div class="result-label">${t('Resolved IP')}</div>
            <div class="result-value">${esc(data.ip || t('unknown'))}</div>
          </div>
          <div class="result-box">
            <div class="result-label">${t('Response time')}</div>
            <div class="result-value">${data.responseMs} ms</div>
          </div>
          <div class="result-box">
            <div class="result-label">${t('HTTP status')}</div>
            <div class="result-value">${esc(statusText)}</div>
          </div>
          <div class="result-box">
            <div class="result-label">${t('Server')}</div>
            <div class="result-value">${esc(data.server || t('hidden'))}</div>
          </div>
        </div>
        <div class="result-box">
          <div class="result-label">${t('Page title')}</div>
          <div class="result-value" style="font-size:1.05rem;">${esc(data.title || t('(none)'))}</div>
        </div>
        <div class="result-box">
          <div class="result-label">${t('Protocol')}</div>
          <div class="result-value">${esc((data.protocol || '').toUpperCase())}</div>
        </div>
        ${data.redirect ? `<div class="result-box"><div class="result-label">${t('Redirects to')}</div><div class="result-value" style="font-size:1rem;">${esc(data.redirect)}</div></div>` : ''}
      `;
      document.getElementById('results').innerHTML = html;
    })
    .catch(e => {
      document.getElementById('results').innerHTML = '';
      showError(e.message);
    });
}
