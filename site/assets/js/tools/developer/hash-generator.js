function rotl(x, c) { return ((x << c) | (x >>> (32 - c))) >>> 0; }

function md5Bytes(bytes) {
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
             5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
             4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
             6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const msgLen = bytes.length;
  const withOne = msgLen + 1;
  const padLen = ((56 - (withOne % 64)) + 64) % 64;
  const totalLen = withOne + padLen + 8;
  const buf = new Uint8Array(totalLen);
  buf.set(bytes);
  buf[msgLen] = 0x80;
  let bl = BigInt(msgLen) * 8n;
  for (let i = 0; i < 8; i++) { buf[totalLen - 8 + i] = Number(bl & 0xffn); bl >>= 8n; }

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < totalLen; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + 4 * i;
      M[i] = (buf[j] | (buf[j + 1] << 8) | (buf[j + 2] << 16) | (buf[j + 3] << 24)) >>> 0;
    }
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      const r = rotl(F, S[i]);
      A = D; D = C; C = B; B = (B + r) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  [a0, b0, c0, d0].forEach((w, idx) => {
    out[idx * 4] = w & 0xff;
    out[idx * 4 + 1] = (w >>> 8) & 0xff;
    out[idx * 4 + 2] = (w >>> 16) & 0xff;
    out[idx * 4 + 3] = (w >>> 24) & 0xff;
  });
  return out;
}

function toHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

const ALGOS = [
  ['MD5', 16], ['SHA-1', 20], ['SHA-256', 32], ['SHA-384', 48], ['SHA-512', 64],
];

let runId = 0;

function run() {
  const id = ++runId;
  const text = document.getElementById('input').value;
  const resEl = document.getElementById('results');
  const statusEl = document.getElementById('status');
  statusEl.innerHTML = '';

  if (!text) { resEl.innerHTML = '<div class="result-sub">Enter text to compute hashes.</div>'; return; }

  const data = new TextEncoder().encode(text);
  const md5hex = toHex(md5Bytes(data));

  const results = { MD5: md5hex, 'SHA-1': null, 'SHA-256': null, 'SHA-384': null, 'SHA-512': null };

  const jobs = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'].map(name =>
    crypto.subtle.digest(name, data)
      .then(buf => { results[name] = toHex(new Uint8Array(buf)); })
      .catch(() => { results[name] = 'unavailable'; })
  );

  Promise.all(jobs).then(() => {
    if (id !== runId) return;
    const bi = new TextEncoder().encode(text).length;
    resEl.innerHTML = '<div class="result-sub" style="margin-bottom:12px;">' + bi + ' bytes · ' + text.length + ' characters</div>' +
      ALGOS.map(([name]) =>
        '<div class="result-box"><div class="result-label">' + name + '</div>' +
        '<div class="result-value" style="font-size:.9rem;font-family:ui-monospace,Menlo,Consolas,monospace;word-break:break-all;">' + results[name] + '</div></div>'
      ).join('');
  });
}

function clearAll() {
  document.getElementById('input').value = '';
  run();
}

run();
