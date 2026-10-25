function intToIp(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

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

function parseValue(fmt, raw) {
  raw = raw.trim();
  if (!raw) return null;
  if (fmt === 'ip') return ipToInt(raw);
  if (fmt === 'bin') {
    const b = raw.replace(/[\s.]/g, '');
    if (!/^[01]{1,32}$/.test(b)) return null;
    return parseInt(b, 2) >>> 0;
  }
  if (fmt === 'hex') {
    const h = raw.replace(/^0x/i, '').replace(/[\s:]/g, '');
    if (!/^[0-9a-fA-F]{1,8}$/.test(h)) return null;
    return parseInt(h, 16) >>> 0;
  }
  if (fmt === 'dec') {
    if (!/^\d{1,10}$/.test(raw)) return null;
    const v = Number(raw);
    if (v > 4294967295) return null;
    return v >>> 0;
  }
  return null;
}

function convert() {
  const fmt = document.getElementById('format').value;
  const raw = document.getElementById('value').value;
  const errEl = document.getElementById('errorMsg');
  const resEl = document.getElementById('results');
  errEl.innerHTML = '';

  if (!raw.trim()) { resEl.innerHTML = '<div class="result-sub">Enter a value to convert.</div>'; return; }

  const n = parseValue(fmt, raw);
  if (n === null) {
    errEl.innerHTML = '<div class="error">Value does not match the selected input format.</div>';
    resEl.innerHTML = '<div class="result-sub">Enter a valid value.</div>';
    return;
  }

  const bin = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].map(o => o.toString(2).padStart(8, '0'));
  const binStr = bin.join('.');
  const hex = '0x' + n.toString(16).toUpperCase().padStart(8, '0');

  resEl.innerHTML =
    '<div class="result-box highlight"><div class="result-label">IPv4 address</div><div class="result-value large">' + intToIp(n) + '</div></div>' +
    '<div class="result-box"><div class="result-label">Binary</div><div class="result-value" style="font-size:.95rem;font-family:ui-monospace,Menlo,Consolas,monospace;">' + binStr + '</div></div>' +
    '<div class="result-box"><div class="result-label">Decimal</div><div class="result-value">' + n + '</div></div>' +
    '<div class="result-box"><div class="result-label">Hexadecimal</div><div class="result-value">' + hex + '</div></div>' +
    '<div class="grid-2">' +
      '<div class="result-box"><div class="result-label">Octets</div><div class="result-value" style="font-size:1rem;">' + intToIp(n).split('.').join(' · ') + '</div></div>' +
      '<div class="result-box"><div class="result-label">Octets (binary)</div><div class="result-value" style="font-size:.9rem;">' + bin.join(' ') + '</div></div>' +
    '</div>';
}

convert();
