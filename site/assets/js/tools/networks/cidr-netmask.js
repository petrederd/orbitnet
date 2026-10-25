function ipToInt(ip) {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n * 256) + v;
  }
  return n >>> 0;
}

function intToIp(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

function prefixToMask(prefix) {
  return prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
}

function parsePrefix(raw) {
  raw = raw.trim().replace(/^\//, '');
  if (/^\d+$/.test(raw)) {
    const p = Number(raw);
    return p >= 0 && p <= 32 ? p : null;
  }
  const mask = ipToInt(raw);
  if (mask === null) return null;
  // count leading ones
  let p = 0;
  for (let i = 31; i >= 0; i--) {
    if (mask & (1 << i)) p++; else break;
  }
  // validate contiguous
  if (prefixToMask(p) !== mask) return null;
  return p;
}

function convert() {
  const errEl = document.getElementById('errorMsg');
  const resEl = document.getElementById('results');
  errEl.innerHTML = '';

  const ip = ipToInt(document.getElementById('ip').value);
  const prefix = parsePrefix(document.getElementById('prefix').value);

  if (ip === null) { errEl.innerHTML = '<div class="error">Invalid IPv4 address.</div>'; resEl.innerHTML = '<div class="result-sub">Check the IP address.</div>'; return; }
  if (prefix === null) { errEl.innerHTML = '<div class="error">Invalid prefix or netmask (must be 0–32 or a valid dotted mask).</div>'; resEl.innerHTML = '<div class="result-sub">Check the prefix.</div>'; return; }

  const mask = prefixToMask(prefix);
  const wildcard = (~mask) >>> 0;
  const network = (ip & mask) >>> 0;
  const broadcast = (network | wildcard) >>> 0;
  const total = Math.pow(2, 32 - prefix);
  const usable = prefix >= 31 ? (prefix === 32 ? 1 : 2) : total - 2;
  const first = prefix >= 31 ? network : network + 1;
  const last = prefix >= 31 ? broadcast : broadcast - 1;

  resEl.innerHTML =
    '<div class="grid-2">' +
      '<div class="result-box highlight"><div class="result-label">CIDR</div><div class="result-value large">/' + prefix + '</div></div>' +
      '<div class="result-box"><div class="result-label">Subnet mask</div><div class="result-value">' + intToIp(mask) + '</div></div>' +
      '<div class="result-box"><div class="result-label">Wildcard mask</div><div class="result-value">' + intToIp(wildcard) + '</div></div>' +
      '<div class="result-box"><div class="result-label">Network address</div><div class="result-value">' + intToIp(network) + '</div></div>' +
      '<div class="result-box"><div class="result-label">Broadcast</div><div class="result-value">' + intToIp(broadcast) + '</div></div>' +
      '<div class="result-box"><div class="result-label">Total addresses</div><div class="result-value">' + total.toLocaleString('en-US') + '</div></div>' +
      '<div class="result-box"><div class="result-label">Usable hosts</div><div class="result-value">' + usable.toLocaleString('en-US') + '</div></div>' +
      '<div class="result-box"><div class="result-label">Host range</div><div class="result-value" style="font-size:.95rem;">' + intToIp(first) + ' – ' + intToIp(last) + '</div></div>' +
    '</div>' +
    '<div class="result-box"><div class="result-label">Mask in binary</div><div class="result-value" style="font-size:.85rem;font-family:ui-monospace,Menlo,Consolas,monospace;">' +
      intToIp(mask).split('.').map(o => Number(o).toString(2).padStart(8, '0')).join('.') + '</div></div>';

  highlightTableRow(prefix);
}

function buildTable() {
  const el = document.getElementById('table');
  let html = '<table style="width:100%;border-collapse:collapse;">';
  html += '<tr><th style="text-align:left;padding:4px 8px;color:var(--muted);">CIDR</th><th style="text-align:left;padding:4px 8px;color:var(--muted);">Netmask</th><th style="text-align:left;padding:4px 8px;color:var(--muted);">Hosts</th></tr>';
  for (let p = 0; p <= 32; p++) {
    const mask = prefixToMask(p);
    const total = Math.pow(2, 32 - p);
    const usable = p >= 31 ? (p === 32 ? 1 : 2) : total - 2;
    html += '<tr data-prefix="' + p + '"><td style="padding:4px 8px;border-top:1px solid var(--line);">/' + p + '</td>' +
      '<td style="padding:4px 8px;border-top:1px solid var(--line);">' + intToIp(mask) + '</td>' +
      '<td style="padding:4px 8px;border-top:1px solid var(--line);">' + usable.toLocaleString('en-US') + '</td></tr>';
  }
  html += '</table>';
  el.innerHTML = html;
}

function highlightTableRow(prefix) {
  document.querySelectorAll('#table tr[data-prefix]').forEach(tr => {
    const on = Number(tr.dataset.prefix) === prefix;
    tr.style.background = on ? 'var(--accent-dim)' : '';
    tr.style.color = on ? 'var(--accent)' : '';
  });
}

buildTable();
