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

function check() {
  clearError();
  const host = document.getElementById('host').value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const type = document.getElementById('type').value;
  if (!host) { showError('Please enter a name'); return; }

  document.getElementById('results').innerHTML = '<div class="loading">Querying ' + esc(type) + ' across resolvers...</div>';
  document.getElementById('summary').innerHTML = '';

  fetch('/api/propagation?host=' + encodeURIComponent(host) + '&type=' + encodeURIComponent(type))
    .then(r => r.json())
    .then(d => { if (d.error) { showError(d.error); document.getElementById('results').innerHTML = ''; return; } render(d); })
    .catch(e => { showError(e.message); document.getElementById('results').innerHTML = ''; });
}

function render(d) {
  const list = d.resolvers || [];
  const unique = new Set();
  list.forEach(r => unique.add(r.error ? 'ERR:' + r.error : (r.records || []).join('|')));

  let html = d.source === 'worker'
    ? '<div class="status-box info">The local resolvers did not answer; the comparison was performed by the external checker.</div>'
    : '';
  list.forEach(r => {
    let body;
    if (r.error) {
      body = '<div class="result-value" style="color:var(--danger);font-size:.9rem;">' + esc(r.error) + '</div>';
    } else if (!r.records || !r.records.length) {
      body = '<div class="result-value" style="color:var(--muted);font-size:.9rem;">No records</div>';
    } else {
      body = '<div class="result-value" style="font-family:monospace;font-size:.85rem;line-height:1.7;word-break:break-word;">' +
        r.records.map(esc).join('<br>') + '</div>';
    }
    html += '<div class="result-box"><div class="result-label">' + esc(r.server) + '</div>' + body + '</div>';
  });

  let summary;
  if (unique.size === 1) {
    const only = [...unique][0];
    if (only.startsWith('ERR:')) {
      summary = '<div class="status-box error">All resolvers failed (' + esc(only.slice(4)) + ').</div>';
    } else {
      summary = '<div class="status-box success">All ' + list.length + ' resolvers returned identical answers.</div>';
    }
  } else {
    summary = '<div class="status-box info">Resolvers disagree (' + unique.size + ' distinct answers) — propagation may be in progress.</div>';
  }
  document.getElementById('summary').innerHTML = summary;
  document.getElementById('results').innerHTML = html;
}
