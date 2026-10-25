function convert() {
  const raw = document.getElementById('mac').value;
  const errEl = document.getElementById('errorMsg');
  const resEl = document.getElementById('results');
  errEl.innerHTML = '';

  const cleaned = raw.trim();
  if (!cleaned) { resEl.innerHTML = '<div class="result-sub">Enter a MAC address to convert.</div>'; return; }
  const hex = cleaned.replace(/[\s:.-]/g, '');
  if (/[^0-9a-fA-F]/.test(hex)) {
    errEl.innerHTML = '<div class="error">A MAC address may contain only hexadecimal digits (0-9, a-f) and : - . separators.</div>';
    resEl.innerHTML = '<div class="result-sub">Enter a valid MAC address.</div>';
    return;
  }
  if (hex.length !== 12) {
    errEl.innerHTML = '<div class="error">A MAC address must contain exactly 12 hexadecimal digits (found ' + hex.length + ').</div>';
    resEl.innerHTML = '<div class="result-sub">Enter a valid MAC address.</div>';
    return;
  }

  const upper = hex.toUpperCase();
  const lower = hex.toLowerCase();
  const bytes = upper.match(/.{2}/g);

  const colon = bytes.join(':');
  const hyphen = bytes.join('-');
  const dot = bytes.slice(0, 2).join('') + '.' + bytes.slice(2, 4).join('') + '.' + bytes.slice(4, 6).join('');
  const plain = upper;

  const first = parseInt(bytes[0], 16);
  const multicast = (first & 0x01) === 1;
  const locallyAdmin = (first & 0x02) === 2;
  const oui = bytes.slice(0, 3).join(':');

  const allFF = upper === 'FFFFFFFFFFFF';

  resEl.innerHTML =
    '<div class="result-box highlight"><div class="result-label">Colon (upper)</div><div class="result-value large" style="font-size:1.3rem;">' + colon + '</div></div>' +
    '<div class="grid-2">' +
      '<div class="result-box"><div class="result-label">Colon (lower)</div><div class="result-value" style="font-size:1rem;">' + bytes.join(':').toLowerCase() + '</div></div>' +
      '<div class="result-box"><div class="result-label">Hyphen</div><div class="result-value" style="font-size:1rem;">' + hyphen + '</div></div>' +
      '<div class="result-box"><div class="result-label">Cisco (dotted)</div><div class="result-value" style="font-size:1rem;">' + dot.toLowerCase() + '</div></div>' +
      '<div class="result-box"><div class="result-label">Plain</div><div class="result-value" style="font-size:1rem;">' + plain + '</div></div>' +
    '</div>' +
    '<div class="grid-2">' +
      '<div class="result-box"><div class="result-label">OUI (vendor prefix)</div><div class="result-value" style="font-size:1rem;">' + oui + '</div></div>' +
      '<div class="result-box"><div class="result-label">Address type</div><div class="result-value" style="font-size:1rem;">' + (multicast ? 'Multicast' : 'Unicast') + '</div><div class="result-sub">' + (locallyAdmin ? 'Locally administered' : 'Globally unique') + '</div></div>' +
    '</div>' +
    (allFF ? '<div class="info">FF:FF:FF:FF:FF:FF is the Ethernet broadcast address.</div>' : '');
}

convert();
