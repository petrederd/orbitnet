function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function showError(message) {
  const el = document.getElementById('errorMsg');
  el.innerHTML = '';
  if (!message) return;
  const div = document.createElement('div');
  div.className = 'error';
  div.textContent = String(message);
  el.appendChild(div);
}

function parseUrl(raw) {
  let value = String(raw == null ? '' : raw).trim();
  if (!value) throw new Error('Please enter a URL');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = 'https://' + value;
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error('Invalid URL: ' + error.message);
  }
  if (!url.hostname) throw new Error('The URL has no hostname');
  return {
    href: url.href,
    protocol: url.protocol,
    username: url.username,
    password: url.password,
    hostname: url.hostname,
    port: url.port,
    host: url.host,
    origin: url.origin,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    segments: url.pathname.split('/').filter(Boolean).map(segment => {
      try { return decodeURIComponent(segment); } catch (error) { return segment; }
    }),
    params: [...url.searchParams.entries()].map(([key, value]) => ({ key, value }))
  };
}

function row(label, value) {
  return '<tr><td>' + esc(label) + '</td><td>' + (value === '' || value == null ? '<span style="color:var(--muted)">—</span>' : esc(value)) + '</td></tr>';
}

function render() {
  showError('');
  let parsed;
  try {
    parsed = parseUrl(document.getElementById('urlInput').value);
  } catch (error) {
    showError(error.message);
    document.getElementById('results').innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);">Enter a valid URL to parse it.</div>';
    return;
  }

  let html = '<div class="result-box highlight"><div class="result-label">Normalized URL</div>' +
    '<div class="result-value mono" style="font-size:1rem;">' + esc(parsed.href) + '</div></div>';

  html += '<div class="result-box"><div class="result-label">Parts</div><table class="data-table"><tbody>';
  html += row('Protocol', parsed.protocol);
  html += row('Origin', parsed.origin);
  html += row('Username', parsed.username);
  html += row('Password', parsed.password ? '••••••••' : '');
  html += row('Hostname', parsed.hostname);
  html += row('Port', parsed.port || '(default)');
  html += row('Path', parsed.pathname);
  html += row('Query string', parsed.search);
  html += row('Fragment', parsed.hash);
  html += '</tbody></table></div>';

  html += '<div class="result-box"><div class="result-label">Path segments (' + parsed.segments.length + ')</div>';
  if (parsed.segments.length) {
    html += '<table class="data-table"><thead><tr><th>#</th><th>Segment</th></tr></thead><tbody>';
    parsed.segments.forEach((segment, index) => {
      html += '<tr><td>' + (index + 1) + '</td><td>' + esc(segment) + '</td></tr>';
    });
    html += '</tbody></table>';
  } else {
    html += '<div class="result-sub">No path segments.</div>';
  }
  html += '</div>';

  html += '<div class="result-box"><div class="result-label">Query parameters (' + parsed.params.length + ')</div>';
  if (parsed.params.length) {
    html += '<table class="data-table"><thead><tr><th>#</th><th>Key (decoded)</th><th>Value (decoded)</th></tr></thead><tbody>';
    parsed.params.forEach((param, index) => {
      html += '<tr><td>' + (index + 1) + '</td><td>' + esc(param.key) + '</td><td>' + esc(param.value) + '</td></tr>';
    });
    html += '</tbody></table>';
  } else {
    html += '<div class="result-sub">No query parameters.</div>';
  }
  html += '</div>';

  document.getElementById('results').innerHTML = html;
}

function loadExample() {
  document.getElementById('urlInput').value = 'https://user:pass@example.com:8443/path/to/page?tag=a&tag=b&q=hello%20world#section-2';
  render();
}

function clearAll() {
  document.getElementById('urlInput').value = '';
  showError('');
  document.getElementById('results').innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);">Enter a URL to parse it.</div>';
}

document.getElementById('urlInput').addEventListener('keydown', event => {
  if (event.key === 'Enter') render();
});
render();
