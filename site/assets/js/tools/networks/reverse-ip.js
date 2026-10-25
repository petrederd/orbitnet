function isIp(s) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || (s.includes(':') && /^[0-9a-f:]+$/i.test(s)); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

let timer = null;

function run() {
  clearTimeout(timer);
  timer = setTimeout(doRun, 300);
}

function doRun() {
  const raw = document.getElementById('query').value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const errEl = document.getElementById('errorMsg');
  const resEl = document.getElementById('results');
  errEl.innerHTML = '';

  if (!raw) { resEl.innerHTML = '<div class="result-sub">Enter an IP address or domain.</div>'; return; }

  resEl.innerHTML = '<div class="loading">Looking up ' + esc(raw) + '...</div>';

  if (isIp(raw)) {
    ptr(raw);
  } else {
    fetch('/api/dns?host=' + encodeURIComponent(raw) + '&type=A')
      .then(r => r.json())
      .then(data => {
        const ips = data.records || [];
        if (!ips.length) {
          const message = data.nxdomain
            ? 'Domain does not exist (NXDOMAIN)'
            : 'Could not resolve ' + esc(raw) + ' to an IP address.';
          resEl.innerHTML = '<div class="error">' + message + '</div>';
          return;
        }
        return Promise.all(ips.map(ip => ptrData(ip))).then(results => renderDomain(raw, results));
      })
      .catch(e => { resEl.innerHTML = '<div class="error">' + esc(e.message) + '</div>'; });
  }
}

function ptr(ip) {
  ptrData(ip).then(r => render([r]));
}

function ptrData(ip) {
  return fetch('/api/dns?host=' + encodeURIComponent(ip) + '&type=PTR')
    .then(r => r.json())
    .then(d => ({ ip, hostnames: d.records || [], error: d.error || null }))
    .catch(e => ({ ip, hostnames: [], error: e.message }));
}

function render(results) {
  const rows = results.map(r => {
    const names = r.hostnames.length
      ? r.hostnames.map(esc).join('<br>')
      : '<span class="result-sub">No PTR record</span>';
    return '<div class="result-box"><div class="result-label">' + esc(r.ip) + '</div><div class="result-value" style="font-size:1.1rem;">' + names + '</div></div>';
  }).join('');
  document.getElementById('results').innerHTML = rows;
}

function renderDomain(domain, results) {
  const rows = results.map(r => {
    const names = r.hostnames.length
      ? r.hostnames.map(esc).join('<br>')
      : '<span class="result-sub">No PTR record</span>';
    return '<div class="result-box"><div class="result-label">' + esc(r.ip) + '</div><div class="result-value" style="font-size:1.1rem;">' + names + '</div></div>';
  }).join('');
  document.getElementById('results').innerHTML =
    '<div class="info">' + esc(domain) + ' resolves to ' + results.length + ' address' + (results.length > 1 ? 'es' : '') + '.</div>' + rows;
}
