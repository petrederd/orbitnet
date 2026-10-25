function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function box(label, value, small) {
  return '<div class="result-box"><div class="result-label">' + esc(label) + '</div>' +
    '<div class="result-value"' + (small ? ' style="font-size:1.05rem;"' : '') + '>' +
    value + '</div></div>';
}

function geoHtml(geo) {
  if (!geo) {
    return '<div class="info">Geolocation data is unavailable for this address (private or reserved address, or the GeoLite2 databases are not loaded).</div>';
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

  const accuracy = geo.accuracyRadius != null ? '± ' + esc(geo.accuracyRadius) + ' km' : 'Unknown';

  return '<div class="grid-2">' +
    box('Location', esc(place)) +
    box('Provider', provider) +
    box('Timezone', esc(geo.timezone || 'Unknown')) +
    box('Coordinates', coordinates) +
    box('Accuracy radius', esc(accuracy)) +
    box('Country code', esc(geo.countryCode || '—')) +
    '</div>';
}

function loadIPInfo() {
  const loading = document.getElementById('loading');
  loading.textContent = 'Loading your IP information...';
  loading.style.display = 'block';
  document.getElementById('results').style.display = 'none';
  document.getElementById('error').style.display = 'none';

  fetch('/api/ip')
    .then(r => r.json())
    .then(data => {
      if (data.error) throw new Error(data.error);
      const html =
        '<div class="result-box highlight">' +
          '<div class="result-label">Your IP Address</div>' +
          '<div class="result-value large">' + esc(data.ip) + '</div>' +
          '<div class="result-sub">IPv' + data.version + (data.hostname ? ' · ' + esc(data.hostname) : '') + '</div>' +
        '</div>' +
        geoHtml(data.geo) +
        '<div class="grid-2" style="margin-top:12px;">' +
          box('IP version', 'IPv' + esc(data.version)) +
          box('Reverse DNS', esc(data.hostname || 'not set'), true) +
        '</div>';
      document.getElementById('results').innerHTML = html;
      document.getElementById('results').style.display = 'block';
      document.getElementById('loading').style.display = 'none';
    })
    .catch(err => {
      document.getElementById('error').innerHTML = '<div class="error">' + esc(err.message) + '</div>';
      document.getElementById('error').style.display = 'block';
      document.getElementById('loading').style.display = 'none';
    });
}
