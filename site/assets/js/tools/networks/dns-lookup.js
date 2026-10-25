function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function clearError() { document.getElementById('errorMsg').innerHTML = ''; }
function showError(m) {
  const el = document.getElementById('errorMsg');
  el.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'error';
  div.textContent = String(m == null ? '' : m);
  el.appendChild(div);
}

function lookup() {
  clearError();
  const host = document.getElementById('host').value.trim();
  const type = document.getElementById('type').value;
  if (!host) { showError('Please enter a domain'); return; }

  document.getElementById('results').innerHTML = '<div class="loading">Looking up ' + esc(host) + '...</div>';

  fetch('/api/dns?host=' + encodeURIComponent(host) + '&type=' + encodeURIComponent(type))
    .then(r => r.json())
    .then(data => {
      if (data.error) throw new Error(data.error);
      const records = Array.isArray(data.records)
        ? data.records
        : (data.records ? [data.records] : []);
      let html = data.source === 'worker'
        ? '<div class="status-box info">The local resolver did not answer; the lookup was performed by the external checker.</div>'
        : '';
      records.forEach(rec => {
        html += '<div class="result-box"><div class="result-label">' + esc(type) +
          '</div><div class="result-value">' + esc(formatRecord(type, rec)) + '</div></div>';
      });
      if (!records.length) {
        html += data.nxdomain
          ? '<div class="info">Domain does not exist (NXDOMAIN).</div>'
          : '<div class="info">No records of this type (NODATA).</div>';
      }
      document.getElementById('results').innerHTML = html;
    })
    .catch(e => {
      document.getElementById('results').innerHTML = '';
      showError(e.message);
    });
}

function formatRecord(type, rec) {
  if (type === 'MX') return rec.priority + '  ' + rec.host;
  if (type === 'SOA') return JSON.stringify(rec, null, 1);
  if (type === 'CAA') return rec.flag + ' ' + rec.tag + ' ' + rec.value;
  return String(rec);
}
