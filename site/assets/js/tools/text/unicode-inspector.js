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

const CONTROL_NAMES = {
  0x0000: ['NULL', 'high'],
  0x0009: ['CHARACTER TABULATION', 'low'],
  0x000A: ['LINE FEED', 'low'],
  0x000D: ['CARRIAGE RETURN', 'low'],
  0x00A0: ['NO-BREAK SPACE', 'low'],
  0x00AD: ['SOFT HYPHEN', 'low'],
  0x034F: ['COMBINING GRAPHEME JOINER', 'medium'],
  0x061C: ['ARABIC LETTER MARK', 'high'],
  0x180E: ['MONGOLIAN VOWEL SEPARATOR', 'medium'],
  0x200B: ['ZERO WIDTH SPACE', 'high'],
  0x200C: ['ZERO WIDTH NON-JOINER', 'high'],
  0x200D: ['ZERO WIDTH JOINER', 'medium'],
  0x200E: ['LEFT-TO-RIGHT MARK', 'high'],
  0x200F: ['RIGHT-TO-LEFT MARK', 'high'],
  0x202A: ['LEFT-TO-RIGHT EMBEDDING', 'high'],
  0x202B: ['RIGHT-TO-LEFT EMBEDDING', 'high'],
  0x202C: ['POP DIRECTIONAL FORMATTING', 'high'],
  0x202D: ['LEFT-TO-RIGHT OVERRIDE', 'high'],
  0x202E: ['RIGHT-TO-LEFT OVERRIDE', 'high'],
  0x2060: ['WORD JOINER', 'medium'],
  0x2061: ['FUNCTION APPLICATION', 'medium'],
  0x2062: ['INVISIBLE TIMES', 'medium'],
  0x2063: ['INVISIBLE SEPARATOR', 'medium'],
  0x2064: ['INVISIBLE PLUS', 'medium'],
  0x2066: ['LEFT-TO-RIGHT ISOLATE', 'high'],
  0x2067: ['RIGHT-TO-LEFT ISOLATE', 'high'],
  0x2068: ['FIRST STRONG ISOLATE', 'high'],
  0x2069: ['POP DIRECTIONAL ISOLATE', 'high'],
  0xFEFF: ['ZERO WIDTH NO-BREAK SPACE / BOM', 'high']
};

function charInfo(ch) {
  const cp = ch.codePointAt(0);
  let name = '';
  let risk = 'none';
  if (CONTROL_NAMES[cp]) {
    name = CONTROL_NAMES[cp][0];
    risk = CONTROL_NAMES[cp][1];
  } else if (cp >= 0xFE00 && cp <= 0xFE0F) {
    name = 'VARIATION SELECTOR-' + (cp - 0xFE00 + 1);
    risk = 'medium';
  } else if (cp >= 0xE0100 && cp <= 0xE01EF) {
    name = 'VARIATION SELECTOR SUPPLEMENT';
    risk = 'medium';
  } else if (cp >= 0xE0000 && cp <= 0xE007F) {
    name = 'TAG CHARACTER';
    risk = 'high';
  } else if (cp < 0x20 || (cp >= 0x7F && cp <= 0x9F)) {
    name = 'CONTROL CHARACTER';
    risk = 'medium';
  }
  return { cp, name, risk };
}

function displayChar(ch) {
  if (ch === '\n') return '\\n';
  if (ch === '\r') return '\\r';
  if (ch === '\t') return '\\t';
  const info = charInfo(ch);
  if (info.risk !== 'none' && info.risk !== 'low') return '∅';
  if (info.cp < 0x20 || (info.cp >= 0x7F && info.cp <= 0x9F)) return '␀';
  return ch;
}

function bytesFor(ch) {
  return [...new TextEncoder().encode(ch)].map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

function inspectText(text) {
  const source = String(text == null ? '' : text);
  const chars = [];
  const suspicious = [];
  for (const ch of source) {
    const info = charInfo(ch);
    const row = {
      char: ch,
      cp: info.cp,
      hex: 'U+' + info.cp.toString(16).toUpperCase().padStart(4, '0'),
      decimal: info.cp,
      bytes: bytesFor(ch),
      utf16: ch.length,
      name: info.name,
      risk: info.risk
    };
    chars.push(row);
    if (info.risk === 'high' || info.risk === 'medium') suspicious.push(row);
  }
  return {
    chars,
    suspicious,
    codePoints: chars.length,
    utf16Units: source.length,
    bytes: new TextEncoder().encode(source).length,
    nfc: source.normalize('NFC'),
    nfd: source.normalize('NFD'),
    nfkc: source.normalize('NFKC'),
    nfkd: source.normalize('NFKD')
  };
}

function stripInvisible(text) {
  return String(text == null ? '' : text)
    .replace(/[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, '')
    .replace(/[\uFE00-\uFE0F]/g, '')
    .replace(/[\u{E0000}-\u{E007F}]/gu, '')
    .replace(/[\u{E0100}-\u{E01EF}]/gu, '');
}

function shortValue(value) {
  if (!value) return '(empty)';
  return value.length > 120 ? value.slice(0, 120) + '…' : value;
}

function inspect() {
  showError('');
  const text = document.getElementById('input').value;
  const report = inspectText(text);
  if (!text) {
    document.getElementById('results').innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);">Enter text to inspect it.</div>';
    return;
  }

  let html = '<div class="grid-2">' +
    '<div class="result-box"><div class="result-label">Code points</div><div class="result-value">' + report.codePoints + '</div></div>' +
    '<div class="result-box"><div class="result-label">UTF-16 code units</div><div class="result-value">' + report.utf16Units + '</div></div>' +
    '<div class="result-box"><div class="result-label">UTF-8 bytes</div><div class="result-value">' + report.bytes + '</div></div>' +
    '<div class="result-box"><div class="result-label">Suspicious characters</div><div class="result-value" style="color:' + (report.suspicious.length ? 'var(--warning)' : 'var(--accent)') + ';">' + report.suspicious.length + '</div></div>' +
    '</div>';

  if (report.suspicious.length) {
    html += '<div class="status-box error">Found ' + report.suspicious.length + ' invisible or bidirectional control character(s). Review the table below before trusting this text.</div>';
  } else {
    html += '<div class="status-box success">No known invisible or bidirectional controls found.</div>';
  }

  html += '<div class="result-box"><div class="result-label">Normalization</div><table class="data-table"><thead><tr><th>Form</th><th>Result</th><th>Changed</th></tr></thead><tbody>';
  const forms = [['NFC', report.nfc], ['NFD', report.nfd], ['NFKC', report.nfkc], ['NFKD', report.nfkd]];
  forms.forEach(([name, value]) => {
    html += '<tr><td>' + name + '</td><td>' + esc(shortValue(value)) + '</td><td>' + (value === text ? 'no' : 'yes') + '</td></tr>';
  });
  html += '</tbody></table></div>';

  const limit = Math.min(report.chars.length, 500);
  html += '<div class="result-box"><div class="result-label">Characters (' + report.chars.length + ')</div><table class="data-table"><thead><tr><th>#</th><th>Char</th><th>Code point</th><th>Decimal</th><th>UTF-8</th><th>UTF-16</th><th>Note</th></tr></thead><tbody>';
  for (let i = 0; i < limit; i++) {
    const row = report.chars[i];
    const color = row.risk === 'high' ? 'var(--danger)' : row.risk === 'medium' ? 'var(--warning)' : 'inherit';
    html += '<tr><td>' + i + '</td><td style="color:' + color + ';">' + esc(displayChar(row.char)) + '</td><td>' + esc(row.hex) + '</td><td>' + row.decimal + '</td><td>' + esc(row.bytes) + '</td><td>' + row.utf16 + '</td><td>' + esc(row.name) + '</td></tr>';
  }
  html += '</tbody></table>';
  if (report.chars.length > limit) {
    html += '<div class="result-sub" style="margin-top:10px;">Showing the first ' + limit + ' of ' + report.chars.length + ' characters.</div>';
  }
  html += '</div>';

  document.getElementById('results').innerHTML = html;
}

function removeInvisible() {
  const input = document.getElementById('input');
  input.value = stripInvisible(input.value);
  inspect();
}

function loadExample() {
  document.getElementById('input').value = 'Hello\u200B world \u202Eevil\u202C 👋 é';
  inspect();
}

function clearAll() {
  document.getElementById('input').value = '';
  showError('');
  document.getElementById('results').innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);">Enter text to inspect it.</div>';
}

inspect();
