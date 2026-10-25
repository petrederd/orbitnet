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
function clearAll() {
  document.getElementById('token').value = '';
  document.getElementById('secret').value = '';
  document.getElementById('secretIsBase64').checked = false;
  clearError();
  clearVerification();
  document.getElementById('results').innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);">Paste a token and click Decode</div>';
}

function b64urlBytes(str) {
  let value = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (value.length % 4) value += '=';
  const bin = atob(value);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function b64url(str) {
  return new TextDecoder().decode(b64urlBytes(str));
}

function bytesToB64url(bytes) {
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fmtTs(sec) {
  const d = new Date(sec * 1000);
  return isNaN(d.getTime()) ? '—' : d.toISOString().replace('T', ' ').replace(/\..+/, ' UTC');
}

function durationText(ms) {
  const total = Math.max(0, Math.floor(Math.abs(ms) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days) return days + 'd ' + hours + 'h';
  if (hours) return hours + 'h ' + minutes + 'm';
  if (minutes) return minutes + 'm ' + seconds + 's';
  return seconds + 's';
}

function timeStatus(claim, sec) {
  const diff = sec * 1000 - Date.now();
  if (claim === 'exp') {
    return diff < 0
      ? ['var(--danger)', 'expired ' + durationText(diff) + ' ago']
      : ['var(--accent)', 'expires in ' + durationText(diff)];
  }
  if (claim === 'nbf') {
    return diff > 0
      ? ['var(--warning)', 'not valid yet — starts in ' + durationText(diff)]
      : ['var(--muted)', 'valid since ' + durationText(diff) + ' ago'];
  }
  return diff > 0
    ? ['var(--warning)', 'issued in the future (' + durationText(diff) + ')']
    : ['var(--muted)', 'issued ' + durationText(diff) + ' ago'];
}

function showVerifyError(message) {
  const el = document.getElementById('verifyError');
  el.innerHTML = '';
  if (!message) return;
  const div = document.createElement('div');
  div.className = 'error';
  div.textContent = String(message);
  el.appendChild(div);
}

function clearVerification() {
  showVerifyError('');
  document.getElementById('verifyResult').innerHTML = '';
}

function decodeSecret(secret, isBase64) {
  if (!isBase64) return new TextEncoder().encode(secret);
  let value = String(secret).replace(/\s+/g, '');
  if (!value || /[^A-Za-z0-9+/=_-]/.test(value)) throw new Error('Secret is not valid base64');
  value = value.replace(/-/g, '+').replace(/_/g, '/');
  if (value.length % 4 === 1) throw new Error('Secret is not valid base64');
  while (value.length % 4) value += '=';
  try {
    const bin = atob(value);
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  } catch (error) {
    throw new Error('Secret is not valid base64');
  }
}

async function verifySignature() {
  clearVerification();
  clearError();
  const raw = document.getElementById('token').value.trim();
  const secret = document.getElementById('secret').value;
  if (!raw) { showVerifyError('Please paste a token'); return; }
  if (!secret) { showVerifyError('Enter the HMAC secret used to sign the token'); return; }

  const parts = raw.split('.');
  if (parts.length !== 3 || !parts[2]) {
    showVerifyError('A signed JWT must have three parts, including a signature');
    return;
  }

  let header;
  try { header = JSON.parse(b64url(parts[0])); }
  catch (error) { showVerifyError('Cannot decode header: ' + error.message); return; }

  const hashes = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' };
  const alg = header && header.alg;
  if (!hashes[alg]) {
    showVerifyError('Local verification supports HS256, HS384 and HS512 only (token alg: ' + String(alg || 'missing') + ').');
    return;
  }
  if (!crypto || !crypto.subtle) {
    showVerifyError('Web Crypto is not available in this browser.');
    return;
  }

  let keyBytes;
  try {
    keyBytes = decodeSecret(secret, document.getElementById('secretIsBase64').checked);
  } catch (error) {
    showVerifyError(error.message);
    return;
  }

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: hashes[alg] },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(parts[0] + '.' + parts[1])
    );
    const expected = bytesToB64url(new Uint8Array(signature));
    const actual = parts[2].replace(/=+$/, '');
    const output = document.getElementById('verifyResult');
    if (expected === actual) {
      output.innerHTML = '<div class="status-box success">Signature is valid for ' + esc(alg) + '. The token was signed with this secret.</div>';
    } else {
      output.innerHTML = '<div class="status-box error">Signature does not match. The token is invalid for this secret, or its header/payload was modified.</div>';
    }
  } catch (error) {
    showVerifyError('Verification failed: ' + error.message);
  }
}

function decode() {
  clearError();
  clearVerification();
  const raw = document.getElementById('token').value.trim();
  if (!raw) { showError('Please paste a token'); return; }
  const parts = raw.split('.');
  if (parts.length < 2) { showError('A JWT must have at least two dot-separated parts'); return; }

  let header, payload;
  try { header = JSON.parse(b64url(parts[0])); }
  catch (e) { showError('Cannot decode header: ' + e.message); return; }
  try { payload = JSON.parse(b64url(parts[1])); }
  catch (e) { showError('Cannot decode payload: ' + e.message); return; }

  if (header === null || typeof header !== 'object' || Array.isArray(header)) {
    showError('The header is not a JSON object');
    return;
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    showError('The payload is not a JSON object');
    return;
  }

  let html = '';

  if (typeof payload.exp === 'number') {
    if (payload.exp * 1000 < Date.now()) {
      html += '<div class="status-box error">Token expired on ' + esc(fmtTs(payload.exp)) + ' (' + esc(durationText(payload.exp * 1000 - Date.now())) + ' ago)</div>';
    } else {
      html += '<div class="status-box success">Token expires on ' + esc(fmtTs(payload.exp)) + ' (in ' + esc(durationText(payload.exp * 1000 - Date.now())) + ')</div>';
    }
  } else {
    html += '<div class="status-box info">No exp claim — this token has no built-in expiry.</div>';
  }

  if (typeof payload.nbf === 'number' && payload.nbf * 1000 > Date.now()) {
    html += '<div class="status-box error">Token is not valid yet: nbf is ' + esc(fmtTs(payload.nbf)) + ' (in ' + esc(durationText(payload.nbf * 1000 - Date.now())) + ')</div>';
  }

  html += '<div class="result-box"><div class="result-label">Header (alg: ' + esc(header.alg || '—') + ', typ: ' + esc(header.typ || '—') + ')</div>' +
    '<pre class="jwt-json">' + esc(JSON.stringify(header, null, 2)) + '</pre></div>';

  html += '<div class="result-box"><div class="result-label">Payload</div>' +
    '<pre class="jwt-json">' + esc(JSON.stringify(payload, null, 2)) + '</pre></div>';

  const timeClaims = ['iat', 'nbf', 'exp'];
  const rows = timeClaims.filter(c => typeof payload[c] === 'number');
  if (rows.length) {
    html += '<div class="result-box"><div class="result-label">Time claims</div><div style="margin-top:8px;font-size:.88rem;line-height:1.8;">';
    rows.forEach(c => {
      const label = { iat: 'Issued at', nbf: 'Not before', exp: 'Expires at' }[c];
      const status = timeStatus(c, payload[c]);
      html += '<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:baseline;">' +
        '<strong>' + esc(c) + '</strong><span>' + esc(label) + ':</span><span>' + esc(fmtTs(payload[c])) + '</span>' +
        '<span style="color:' + status[0] + ';font-weight:600;">' + esc(status[1]) + '</span></div>';
    });
    html += '</div></div>';
  }

  html += '<div class="result-box"><div class="result-label">Signature</div>' +
    '<div class="result-value jwt-part" style="color:var(--muted)">' + esc(parts[2] || '(none)') + '</div>' +
    '<div class="result-sub" style="margin-top:6px;">Not verified. Only the presence of a signature is shown.</div></div>';

  document.getElementById('results').innerHTML = html;
}
