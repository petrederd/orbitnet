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
function isIp(s) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || s.includes(':'); }

function box(label, value, small) {
  return '<div class="result-box"><div class="result-label">' + esc(label) + '</div>' +
    '<div class="result-value"' + (small ? ' style="font-size:1.05rem;"' : '') + '>' +
    value + '</div></div>';
}

function geoHtml(ip, geo) {
  if (!geo) {
    return '<div class="info">No geolocation data is available for <strong>' + esc(ip) + '</strong> (private address, or the GeoLite2 databases are not loaded).</div>';
  }

  const place = [geo.city, geo.region, geo.country].filter(Boolean).join(', ') || 'Unknown';
  const provider = geo.asnOrganization
    ? esc(geo.asnOrganization) + (geo.asn ? ' (AS' + esc(geo.asn) + ')' : '')
    : 'Unknown';

  let coordinates = 'Unknown';
  if (geo.latitude != null && geo.longitude != null) {
    const lat = Number(geo.latitude).toFixed(4);
    const lon = Number(geo.longitude).toFixed(4);
    coordinates = '<a href="https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lon +
      '#map=9/' + lat + '/' + lon + '" target="_blank" rel="noopener">' + lat + ', ' + lon + '</a>';
  }

  return '<div class="grid-2">' +
    box('Address', esc(ip)) +
    box('Location', esc(place)) +
    box('Provider', provider) +
    box('Timezone', esc(geo.timezone || 'Unknown')) +
    box('Coordinates', coordinates) +
    box('Accuracy radius', geo.accuracyRadius != null ? '± ' + esc(geo.accuracyRadius) + ' km' : 'Unknown') +
    '</div>';
}

function lookup() {
  clearError();
  const q = document.getElementById('query').value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!q) { showError('Please enter an IP address or domain'); return; }

  const dnsEl = document.getElementById('dnsResults');
  const whoisEl = document.getElementById('whoisResults');
  const geoPanel = document.getElementById('geoPanel');
  const geoEl = document.getElementById('geoResults');
  dnsEl.innerHTML = '<div class="loading">Loading DNS records...</div>';
  whoisEl.innerHTML = '<div class="loading">Loading whois data...</div>';
  geoEl.innerHTML = '<div class="loading">Loading geolocation...</div>';
  geoPanel.style.display = 'block';

  loadGeo(q);
  loadDns(q);
  loadWhois(q);
}

function loadGeo(q) {
  const el = document.getElementById('geoResults');
  const url = isIp(q)
    ? '/api/geo?ip=' + encodeURIComponent(q)
    : '/api/geo?host=' + encodeURIComponent(q);
  fetch(url)
    .then(r => r.json())
    .then(data => {
      if (data.error) { el.innerHTML = '<div class="error">' + esc(data.error) + '</div>'; return; }
      el.innerHTML = geoHtml(data.ip || q, data.geo);
    })
    .catch(e => { el.innerHTML = '<div class="error">' + esc(e.message) + '</div>'; });
}

function loadDns(q) {
  const el = document.getElementById('dnsResults');
  if (isIp(q)) {
    // For an IP we show the address itself and its reverse DNS (PTR)
    fetch('/api/dns?host=' + encodeURIComponent(q) + '&type=PTR')
      .then(r => r.json())
      .then(data => {
        const ptr = (data.records && data.records.length)
          ? data.records.map(esc).join('<br>')
          : '<span class="result-sub">no reverse DNS</span>';
        el.innerHTML = '<div class="grid-2">' +
          '<div class="result-box"><div class="result-label">IP address</div><div class="result-value">' + esc(q) + '</div></div>' +
          '<div class="result-box"><div class="result-label">Reverse DNS (PTR)</div><div class="result-value" style="font-size:1rem;">' + ptr + '</div></div>' +
          '</div><div class="info">For an IP address, whois registration data is shown below.</div>';
      })
      .catch(() => { el.innerHTML = '<div class="error">Failed to resolve reverse DNS</div>'; });
    return;
  }
  const types = ['A', 'AAAA', 'MX', 'NS', 'TXT'];
  Promise.all(types.map(t =>
    fetch('/api/dns?host=' + encodeURIComponent(q) + '&type=' + t)
      .then(r => r.json())
      .then(d => ({ type: t, records: d.records || [], error: d.error, nxdomain: d.nxdomain, nodata: d.nodata }))
      .catch(() => ({ type: t, records: [], error: 'failed' }))
  )).then(results => {
    let html = '<div class="grid-2">';
    results.forEach(res => {
      html += '<div class="result-box"><div class="result-label">' + res.type + '</div>';
      if (res.records.length) {
        html += '<div class="result-value" style="font-size:.95rem;">' +
          res.records.map(r => esc(formatRec(res.type, r))).join('<br>') + '</div>';
      } else if (res.nxdomain) {
        html += '<div class="result-sub">NXDOMAIN (domain does not exist)</div>';
      } else {
        html += '<div class="result-sub">' + (res.nodata ? 'No records (NODATA)' : 'No records') + '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
    el.innerHTML = html;
  });
}

function formatRec(type, rec) {
  if (type === 'MX') return rec.priority + '  ' + rec.host;
  return String(rec);
}

function loadWhois(q) {
  const el = document.getElementById('whoisResults');
  fetch('/api/whois?host=' + encodeURIComponent(q))
    .then(r => r.json())
    .then(data => {
      if (data.error) { el.innerHTML = '<div class="error">' + esc(data.error) + '</div>'; return; }
      const raw = data.raw || '';
      const summary = extractSummary(raw);
      el.innerHTML =
        '<div class="result-box"><div class="result-label">Summary</div>' +
        '<div class="result-value" style="font-size:1rem;">' +
        (summary ? summary.split('\n').map(esc).join('<br>') : 'No summary available') +
        '</div></div>' +
        '<details style="margin-top:12px;"><summary style="cursor:pointer;color:var(--muted);font-size:.88rem;">Show raw whois response</summary>' +
        '<pre style="white-space:pre-wrap;word-break:break-word;background:var(--paper);border:1px solid var(--line);border-radius:6px;padding:12px;margin-top:10px;font-size:.8rem;max-height:400px;overflow:auto;">' +
        esc(raw) + '</pre></details>';
    })
    .catch(e => { el.innerHTML = '<div class="error">' + esc(e.message) + '</div>'; });
}

function extractSummary(raw) {
  const lines = raw.split(/\r?\n/);
  const wanted = [];
  const keys = [
    ['domain', 'Domain'], ['domain name', 'Domain'],
    ['registrar', 'Registrar'], ['creation date', 'Created'], ['created', 'Created'],
    ['updated date', 'Updated'], ['registry expiry date', 'Expires'], ['expiry date', 'Expires'],
    ['paid-till', 'Expires'], ['status', 'Status'], ['state', 'State'],
    ['name server', 'Nameserver'], ['nserver', 'Nameserver'], ['org', 'Organization']
  ];
  const seen = new Set();
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    for (const [matchKey, label] of keys) {
      if (key === matchKey && !seen.has(label)) {
        wanted.push(label + ': ' + value);
        seen.add(label);
        break;
      }
    }
  }
  return wanted.slice(0, 10).join('\n');
}
