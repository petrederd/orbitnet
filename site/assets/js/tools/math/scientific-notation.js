function parseInput(raw) {
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  // Remove whitespace first so "6.02 × 10^23" is recognised.
  s = s.replace(/\s+/g, '');
  s = s.replace(/×10\^?/g, 'e').replace(/x10\^?/g, 'e').replace(/\*10\^?/g, 'e');
  if (/,/.test(s)) {
    // Keep thousands groups ("1,234,567") but treat a single comma as a decimal separator ("1,5").
    if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?(e[-+]?\d+)?$/.test(s)) {
      s = s.replace(/,/g, '');
    } else if (/^[-+]?\d+,\d+(e[-+]?\d+)?$/.test(s)) {
      s = s.replace(',', '.');
    } else {
      return null;
    }
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return { n, warning: /^[-+]?\d+$/.test(s) && !Number.isSafeInteger(n) };
}

function sciParts(n, sig) {
  if (n === 0) return { mantissa: 0, exponent: 0 };
  // toExponential also works for subnormal numbers such as 5e-324.
  const [m, e] = Math.abs(n).toExponential(sig - 1).split('e');
  return { mantissa: Number(m) * Math.sign(n), exponent: Number(e) };
}

// Expands JS exponential notation into a plain decimal string.
function toPlainDecimal(n) {
  if (n === 0) return '0';
  const s = n.toString();
  if (!/e/i.test(s)) return s;
  const [mant, expStr] = s.split(/e/i);
  const exp = parseInt(expStr, 10);
  let sign = '';
  let m = mant;
  if (m[0] === '-') { sign = '-'; m = m.slice(1); }
  const [intPart, fracPart = ''] = m.split('.');
  const digits = intPart + fracPart;
  const point = intPart.length + exp;
  let out;
  if (point <= 0) out = '0.' + '0'.repeat(-point) + digits;
  else if (point >= digits.length) out = digits + '0'.repeat(point - digits.length);
  else out = digits.slice(0, point) + '.' + digits.slice(point);
  return sign + out;
}

function groupThousands(str) {
  const neg = str.startsWith('-');
  const body = neg ? str.slice(1) : str;
  const [intPart, fracPart] = body.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + grouped + (fracPart !== undefined ? '.' + fracPart : '');
}

function convert() {
  const raw = document.getElementById('value').value;
  const errEl = document.getElementById('errorMsg');
  const resEl = document.getElementById('results');
  errEl.innerHTML = '';

  if (!raw.trim()) {
    resEl.innerHTML = '<div class="result-sub">Enter a number to convert.</div>';
    return;
  }

  const parsed = parseInput(raw);
  if (parsed === null) {
    errEl.innerHTML = '<div class="error">Could not parse that as a number.</div>';
    resEl.innerHTML = '<div class="result-sub">Enter a valid number.</div>';
    return;
  }

  const n = parsed.n;
  const warning = parsed.warning
    ? '<div class="result-sub" style="margin-bottom:12px;">Warning: this integer is larger than 2^53, so JavaScript cannot represent it exactly and the result is rounded.</div>'
    : '';

  const sig = 10;
  const { mantissa, exponent } = sciParts(n, sig);
  const engExp = Math.floor(exponent / 3) * 3;
  const engMantissa = Number((mantissa * Math.pow(10, exponent - engExp)).toPrecision(sig));

  const plain = groupThousands(toPlainDecimal(n));
  const scientific = mantissa + ' × 10^' + exponent;
  const engineering = engMantissa + ' × 10^' + engExp;
  const eNotation = mantissa + 'e' + (exponent >= 0 ? '+' : '') + exponent;

  resEl.innerHTML = warning +
    '<div class="result-box highlight"><div class="result-label">Scientific notation</div><div class="result-value large" style="font-size:1.3rem;">' + scientific + '</div></div>' +
    '<div class="result-box"><div class="result-label">Engineering notation</div><div class="result-value" style="font-size:1.1rem;">' + engineering + '</div></div>' +
    '<div class="result-box"><div class="result-label">E-notation</div><div class="result-value" style="font-size:1.1rem;">' + eNotation + '</div></div>' +
    '<div class="result-box"><div class="result-label">Plain decimal</div><div class="result-value" style="font-size:1.05rem;">' + plain + '</div></div>' +
    '<div class="grid-2">' +
      '<div class="result-box"><div class="result-label">Mantissa</div><div class="result-value">' + mantissa + '</div></div>' +
      '<div class="result-box"><div class="result-label">Exponent</div><div class="result-value">' + exponent + '</div></div>' +
    '</div>';
}

convert();
