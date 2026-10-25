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

const ALL_ONES = (1n << 128n) - 1n;

function ipv4TailToGroups(tail) {
  const parts = tail.split('.');
  if (parts.length !== 4) throw new Error('Invalid embedded IPv4 address');
  const values = parts.map(part => {
    if (!/^\d{1,3}$/.test(part)) throw new Error('Invalid embedded IPv4 address');
    const value = Number(part);
    if (value > 255) throw new Error('Invalid embedded IPv4 address');
    return value;
  });
  return [((values[0] << 8) | values[1]).toString(16), ((values[2] << 8) | values[3]).toString(16)];
}

function parseIPv6(raw) {
  let value = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!value) throw new Error('Please enter an IPv6 address');
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  value = value.split('%')[0];

  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    if (lastColon < 0) throw new Error('Invalid IPv6 address');
    const groups = ipv4TailToGroups(value.slice(lastColon + 1));
    value = value.slice(0, lastColon + 1) + groups.join(':');
  }

  const halves = value.split('::');
  if (halves.length > 2) throw new Error('An IPv6 address may contain only one "::"');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const all = left.concat(right);
  all.forEach(group => {
    if (!/^[0-9a-f]{1,4}$/.test(group)) throw new Error('Invalid IPv6 group: "' + group + '"');
  });

  if (halves.length === 1) {
    if (all.length !== 8) throw new Error('A full IPv6 address must have 8 groups');
  } else if (all.length >= 8) {
    throw new Error('"::" must replace at least one group');
  }

  const missing = 8 - all.length;
  const groups = halves.length === 2
    ? left.concat(Array(missing).fill('0'), right)
    : all;
  let result = 0n;
  groups.forEach(group => { result = (result << 16n) + BigInt(parseInt(group, 16)); });
  return result;
}

function expandIPv6(value) {
  const number = typeof value === 'bigint' ? value : parseIPv6(value);
  const groups = [];
  for (let shift = 112n; shift >= 0n; shift -= 16n) {
    groups.push(((number >> shift) & 0xffffn).toString(16).padStart(4, '0'));
  }
  return groups.join(':');
}

function compressIPv6(value) {
  const number = typeof value === 'bigint' ? value : parseIPv6(value);
  const groups = expandIPv6(number).split(':').map(group => parseInt(group, 16).toString(16));

  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i] !== '0') continue;
    let end = i;
    while (end < groups.length && groups[end] === '0') end++;
    const length = end - i;
    if (length > bestLength) { bestStart = i; bestLength = length; }
    i = end - 1;
  }

  if (bestLength < 2) return groups.join(':');
  const left = groups.slice(0, bestStart).join(':');
  const right = groups.slice(bestStart + bestLength).join(':');
  if (left && right) return left + '::' + right;
  if (left) return left + '::';
  if (right) return '::' + right;
  return '::';
}

function prefixMask(prefix) {
  return prefix === 0 ? 0n : (ALL_ONES << BigInt(128 - prefix)) & ALL_ONES;
}

function inPrefix(address, prefixAddress, prefixLength) {
  const mask = prefixMask(prefixLength);
  return (address & mask) === (prefixAddress & mask);
}

function addressType(address) {
  if (address === 0n) return 'Unspecified (::)';
  if (address === 1n) return 'Loopback (::1)';
  if (inPrefix(address, parseIPv6('::ffff:0:0'), 96)) return 'IPv4-mapped';
  if (inPrefix(address, parseIPv6('64:ff9b::'), 96)) return 'IPv4/IPv6 translation';
  if (inPrefix(address, parseIPv6('fc00::'), 7)) return 'Unique local (ULA)';
  if (inPrefix(address, parseIPv6('fe80::'), 10)) return 'Link-local';
  if (inPrefix(address, parseIPv6('ff00::'), 8)) return 'Multicast';
  if (inPrefix(address, parseIPv6('2000::'), 3)) return 'Global unicast';
  return 'Other / reserved';
}

function binaryString(number) {
  return number.toString(2).padStart(128, '0').match(/.{1,16}/g).join(' ');
}

function reverseDns(number) {
  return number.toString(16).padStart(32, '0').split('').reverse().join('.') + '.ip6.arpa';
}

function convert() {
  showError('');
  try {
    const number = parseIPv6(document.getElementById('ipv6').value);
    const expanded = expandIPv6(number);
    const groups = expanded.split(':');

    let html = '<div class="result-box highlight"><div class="result-label">Compressed</div>' +
      '<div class="result-value mono" style="font-size:1.35rem;">' + esc(compressIPv6(number)) + '</div></div>';
    html += '<div class="grid-2">' +
      '<div class="result-box"><div class="result-label">Expanded</div><div class="result-value mono" style="font-size:.95rem;">' + esc(expanded) + '</div></div>' +
      '<div class="result-box"><div class="result-label">Uppercase</div><div class="result-value mono" style="font-size:.95rem;">' + esc(expanded.toUpperCase()) + '</div></div>' +
      '<div class="result-box"><div class="result-label">Address type</div><div class="result-value">' + esc(addressType(number)) + '</div></div>' +
      '<div class="result-box"><div class="result-label">128-bit decimal</div><div class="result-value mono" style="font-size:.8rem;">' + esc(number.toString(10)) + '</div></div>' +
      '</div>';

    html += '<div class="result-box"><div class="result-label">Hextets</div><table class="data-table"><thead><tr><th>#</th><th>Hex</th><th>Decimal</th><th>Binary</th></tr></thead><tbody>';
    groups.forEach((group, index) => {
      const value = parseInt(group, 16);
      html += '<tr><td>' + index + '</td><td>' + esc(group) + '</td><td>' + value + '</td><td>' + value.toString(2).padStart(16, '0') + '</td></tr>';
    });
    html += '</tbody></table></div>';

    html += '<div class="result-box"><div class="result-label">Binary (16-bit groups)</div><pre class="code-block">' + esc(binaryString(number)) + '</pre></div>';
    html += '<div class="result-box"><div class="result-label">Reverse DNS</div><div class="result-value mono" style="font-size:.78rem;">' + esc(reverseDns(number)) + '</div></div>';

    document.getElementById('results').innerHTML = html;
  } catch (error) {
    showError(error.message);
    document.getElementById('results').innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);">Enter a valid IPv6 address.</div>';
  }
}

function loadExample() {
  document.getElementById('ipv6').value = '2001:db8::ff00:42:8329';
  convert();
}

function clearAll() {
  document.getElementById('ipv6').value = '';
  showError('');
  document.getElementById('results').innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);">Enter an IPv6 address to convert it.</div>';
}

document.getElementById('ipv6').addEventListener('keydown', event => {
  if (event.key === 'Enter') convert();
});
convert();
