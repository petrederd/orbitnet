const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

function parseBase(str, base) {
  str = str.trim().toLowerCase();
  if (!str) return null;
  let negative = false;
  if (str[0] === '-' || str[0] === '+') {
    negative = str[0] === '-';
    str = str.slice(1);
  }
  if (!str) return null;
  // Strip only the prefix that matches the selected base.
  const prefix = base === 16 ? '0x' : base === 8 ? '0o' : base === 2 ? '0b' : null;
  if (prefix && str.startsWith(prefix)) str = str.slice(2);
  if (!str) return null;
  let result = 0n;
  for (const ch of str) {
    const d = DIGITS.indexOf(ch);
    if (d < 0 || d >= base) return null;
    result = result * BigInt(base) + BigInt(d);
  }
  return negative ? -result : result;
}

function toBase(num, base) {
  if (num === 0n) return '0';
  let negative = num < 0n;
  let n = negative ? -num : num;
  let out = '';
  const B = BigInt(base);
  while (n > 0n) {
    out = DIGITS[Number(n % B)] + out;
    n = n / B;
  }
  return (negative ? '-' : '') + out;
}

function convert() {
  const raw = document.getElementById('value').value;
  const base = parseInt(document.getElementById('base').value, 10);
  const errEl = document.getElementById('errorMsg');
  const resEl = document.getElementById('results');
  errEl.innerHTML = '';

  if (!raw.trim()) {
    resEl.innerHTML = '<div class="result-sub">Enter a value to convert.</div>';
    return;
  }

  const num = parseBase(raw, base);
  if (num === null) {
    errEl.innerHTML = '<div class="error">Not a valid base-' + base + ' number.</div>';
    resEl.innerHTML = '<div class="result-sub">Enter a valid value.</div>';
    return;
  }

  const bin = toBase(num, 2);
  const negative = num < 0n;
  const bitLength = negative ? '—' : bin.length.toString();

  const group = (s, size) => {
    const neg = s[0] === '-';
    const body = neg ? s.slice(1) : s;
    const chunks = [];
    for (let i = body.length; i > 0; i -= size) chunks.unshift(body.slice(Math.max(0, i - size), i));
    return (neg ? '-' : '') + chunks.join(' ');
  };

  resEl.innerHTML =
    '<div class="result-box"><div class="result-label">Decimal</div><div class="result-value">' + toBase(num, 10) + '</div></div>' +
    '<div class="result-box"><div class="result-label">Hexadecimal</div><div class="result-value">' + group(toBase(num, 16).toUpperCase(), 4) + '</div></div>' +
    '<div class="result-box"><div class="result-label">Octal</div><div class="result-value">' + group(toBase(num, 8), 3) + '</div></div>' +
    '<div class="result-box"><div class="result-label">Binary</div><div class="result-value" style="font-size:1rem;">' + group(bin, 4) + '</div><div class="result-sub">' + bitLength + ' bits</div></div>';
}

convert();
