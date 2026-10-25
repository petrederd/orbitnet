function num(v) {
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function median(sorted) {
  const n = sorted.length;
  if (!n) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function fmt(x) {
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return '0';
  const abs = Math.abs(x);
  if (abs >= 1e21 || abs < 1e-9) {
    return x.toExponential(10).replace(/\.?0+e/, 'e');
  }
  return Number(x.toPrecision(12)).toLocaleString('en-US', { maximumFractionDigits: 20 });
}

// Handles thousands ("1,234"), decimal commas ("3,5") and comma lists ("1,2,3").
// Commas are read as decimals only when a value is alone or when every value
// looks like "12,5"; otherwise commas act as separators (so "5,10 7" is 5, 10, 7).
function parseSingleToken(token) {
  const t = token.trim();
  if (!t) return [];
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return [t.replace(/,/g, '')];
  if (/^[-+]?\d+,\d+$/.test(t)) return [t.replace(',', '.')];
  return t.split(',').map(p => p.trim()).filter(p => p !== '');
}

function parseTokens(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  // Semicolons are an explicit list separator, allowing decimal commas in each value.
  if (trimmed.includes(';')) return trimmed.split(';').flatMap(parseSingleToken);

  const tokens = trimmed.split(/\s+/).filter(t => t !== '');
  if (tokens.length <= 1) return parseSingleToken(tokens[0] || '');

  const allCommaValues = tokens.every(t =>
    /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) || /^[-+]?\d+,\d+$/.test(t)
  );
  if (allCommaValues) {
    return tokens.flatMap(t =>
      /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) ? [t.replace(/,/g, '')] : [t.replace(',', '.')]
    );
  }
  return tokens.flatMap(t => t.split(',')).map(t => t.trim()).filter(t => t !== '');
}

function calculate() {
  const raw = document.getElementById('data').value;
  const errEl = document.getElementById('errorMsg');
  const resEl = document.getElementById('results');
  errEl.innerHTML = '';

  const tokens = parseTokens(raw);
  if (!tokens.length) {
    resEl.innerHTML = '<div class="result-sub">Enter some numbers to see statistics.</div>';
    return;
  }

  const numbers = [];
  const bad = [];
  tokens.forEach(t => {
    const v = num(t);
    if (v === null) bad.push(t); else numbers.push(v);
  });

  if (bad.length) {
    errEl.innerHTML = '<div class="error">Ignored non-numeric value(s): ' + bad.slice(0, 6).map(e => e.replace(/</g, '&lt;')).join(', ') + (bad.length > 6 ? '…' : '') + '</div>';
  }
  if (!numbers.length) {
    resEl.innerHTML = '<div class="result-sub">No valid numbers found.</div>';
    return;
  }

  const n = numbers.length;
  const sorted = [...numbers].sort((a, b) => a - b);
  const sum = numbers.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const med = median(sorted);
  const min = sorted[0];
  const max = sorted[n - 1];

  // mode
  const counts = {};
  let best = 0;
  numbers.forEach(v => { counts[v] = (counts[v] || 0) + 1; best = Math.max(best, counts[v]); });
  const modes = Object.keys(counts).filter(k => counts[k] === best).map(Number).sort((a, b) => a - b);
  const modeText = best <= 1 ? 'none' : modes.map(fmt).join(', ');

  const sumSq = numbers.reduce((a, b) => a + Math.pow(b - mean, 2), 0);
  const popVar = sumSq / n;
  const sampVar = n > 1 ? sumSq / (n - 1) : NaN;
  const popSd = Math.sqrt(popVar);
  const sampSd = Math.sqrt(sampVar);

  const q1 = median(sorted.slice(0, Math.floor(n / 2)));
  const q3 = median(sorted.slice(Math.ceil(n / 2)));
  const iqr = q3 - q1;

  resEl.innerHTML =
    '<div class="grid-2">' +
      '<div class="result-box"><div class="result-label">Count</div><div class="result-value">' + n + '</div></div>' +
      '<div class="result-box"><div class="result-label">Sum</div><div class="result-value">' + fmt(sum) + '</div></div>' +
      '<div class="result-box"><div class="result-label">Mean</div><div class="result-value">' + fmt(mean) + '</div></div>' +
      '<div class="result-box"><div class="result-label">Median</div><div class="result-value">' + fmt(med) + '</div></div>' +
      '<div class="result-box"><div class="result-label">Mode</div><div class="result-value" style="font-size:1rem;">' + modeText + '</div></div>' +
      '<div class="result-box"><div class="result-label">Range</div><div class="result-value">' + fmt(max - min) + '</div><div class="result-sub">' + fmt(min) + ' – ' + fmt(max) + '</div></div>' +
    '</div>' +
    '<div class="grid-2">' +
      '<div class="result-box"><div class="result-label">Population std dev</div><div class="result-value">' + fmt(popSd) + '</div><div class="result-sub">variance ' + fmt(popVar) + '</div></div>' +
      '<div class="result-box"><div class="result-label">Sample std dev</div><div class="result-value">' + fmt(sampSd) + '</div><div class="result-sub">variance ' + fmt(sampVar) + '</div></div>' +
      '<div class="result-box"><div class="result-label">Q1</div><div class="result-value">' + fmt(q1) + '</div></div>' +
      '<div class="result-box"><div class="result-label">Q3</div><div class="result-value">' + fmt(q3) + '</div></div>' +
    '</div>' +
    '<div class="result-box"><div class="result-label">Interquartile range (IQR)</div><div class="result-value">' + fmt(iqr) + '</div></div>';
}

calculate();
