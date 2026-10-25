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
  document.getElementById('gradePanel').hidden = true;
  document.getElementById('checksPanel').hidden = true;
}
function clearError() { document.getElementById('errorMsg').innerHTML = ''; }

const LABELS = { pass: 'Pass', warn: 'Warning', fail: 'Fail', unknown: 'Unknown' };
const ORDER = { fail: 0, warn: 1, unknown: 2, pass: 3 };

function run() {
  clearError();
  const host = document.getElementById('host').value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!host) { showError('Please enter a domain'); return; }
  document.getElementById('gradePanel').hidden = true;
  document.getElementById('checksPanel').hidden = true;

  fetch('/api/security?host=' + encodeURIComponent(host))
    .then(r => r.json())
    .then(d => {
      if (d.error) { showError(d.error + (d.localError ? ' (local: ' + d.localError + ')' : '')); return; }
      render(d);
    })
    .catch(e => showError(e.message));
}

function render(d) {
  const gradeBox = document.getElementById('gradeBox');
  gradeBox.innerHTML =
    '<div class="grade-row">' +
      '<div class="grade-badge ' + esc(d.grade) + '">' + esc(d.grade) + '</div>' +
      '<div class="grade-meta">' +
        '<h3>' + esc(d.score) + ' / 100</h3>' +
        '<p class="mono">' + esc(d.host) + (d.ip ? ' · ' + esc(d.ip) : '') + '</p>' +
        '<p>Source: ' + esc(d.source || 'local') +
          ' · Status: ' + esc(d.status == null ? 'n/a' : d.status) +
          (d.bodyChecked === false ? ' · body not inspected (header-only result)' : '') +
        '</p>' +
      '</div>' +
    '</div>';
  document.getElementById('gradePanel').hidden = false;

  const checks = (d.checks || []).slice().sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  document.getElementById('checks').innerHTML = checks.map(item =>
    '<div class="check-row">' +
      '<span class="check-badge ' + esc(item.status) + '">' + esc(LABELS[item.status] || item.status) + '</span>' +
      '<div class="check-body"><h4>' + esc(item.title) + '</h4>' +
        (item.detail ? '<p class="mono">' + esc(item.detail) + '</p>' : '') +
        (item.fix ? '<p class="check-fix">Fix: ' + esc(item.fix) + '</p>' : '') +
      '</div>' +
    '</div>'
  ).join('');
  document.getElementById('checksPanel').hidden = false;
}
