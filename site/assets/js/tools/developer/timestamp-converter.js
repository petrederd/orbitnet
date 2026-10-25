function parseInput(raw, type) {
  raw = raw.trim();
  if (!raw) return null;
  if (type === 'date') { const d = new Date(raw); return isNaN(d) ? null : d; }
  if (type === 's') { return /^-?\d+(\.\d+)?$/.test(raw) ? new Date(Number(raw) * 1000) : null; }
  if (type === 'ms') { return /^-?\d+$/.test(raw) ? new Date(Number(raw)) : null; }
  // auto
  if (/^-?\d+$/.test(raw)) {
    const n = Number(raw);
    const isMs = Math.abs(n) >= 1e11 || (n < 0 && Math.abs(n) >= 1e7);
    return new Date(isMs ? n : n * 1000);
  }
  const d = new Date(raw);
  return isNaN(d) ? null : d;
}

function relativeLabel(v, name) {
  const n = Math.abs(v);
  const word = name + (n === 1 ? '' : 's');
  return v === 0 ? 'now' : (v > 0 ? 'in ' + n + ' ' + word : n + ' ' + word + ' ago');
}

function relative(d) {
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const units = [
    ['year', 31557600000], ['month', 2629800000], ['day', 86400000],
    ['hour', 3600000], ['minute', 60000], ['second', 1000]
  ];
  for (let i = 0; i < units.length; i++) {
    const [name, ms] = units[i];
    if (abs >= ms || name === 'second') {
      const v = Math.round(diff / ms);
      // Rounding can push a value into the next larger unit ("60 minutes").
      if (i > 0 && Math.abs(v) * ms >= units[i - 1][1]) {
        return relativeLabel(Math.round(diff / units[i - 1][1]), units[i - 1][0]);
      }
      return relativeLabel(v, name);
    }
  }
  return 'now';
}

function convert() {
  const type = document.getElementById('inputType').value;
  const raw = document.getElementById('value').value;
  const errEl = document.getElementById('errorMsg');
  const resEl = document.getElementById('results');
  errEl.innerHTML = '';

  if (!raw.trim()) { resEl.innerHTML = '<div class="result-sub">Enter a timestamp or date.</div>'; return; }

  const d = parseInput(raw, type);
  if (!d || isNaN(d)) {
    errEl.innerHTML = '<div class="error">Could not parse that value.</div>';
    resEl.innerHTML = '<div class="result-sub">Enter a valid timestamp or date.</div>';
    return;
  }

  const sec = Math.floor(d.getTime() / 1000);
  const ms = d.getTime();
  const iso = d.toISOString();
  const utc = d.toUTCString();
  const local = d.toString();

  const trimmed = raw.trim();
  let dateNote = '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    dateNote = 'A date without a time is interpreted as UTC midnight.';
  } else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(trimmed)) {
    dateNote = 'A date-time without a timezone is interpreted in your local time zone.';
  }

  resEl.innerHTML =
    '<div class="result-box highlight"><div class="result-label">Unix seconds</div><div class="result-value large">' + sec + '</div><div class="result-sub">' + relative(d) + '</div></div>' +
    '<div class="grid-2">' +
      '<div class="result-box"><div class="result-label">Unix milliseconds</div><div class="result-value" style="font-size:1rem;">' + ms + '</div></div>' +
      '<div class="result-box"><div class="result-label">ISO 8601 (UTC)</div><div class="result-value" style="font-size:1rem;">' + iso + '</div></div>' +
      '<div class="result-box"><div class="result-label">UTC</div><div class="result-value" style="font-size:1rem;">' + utc + '</div></div>' +
      '<div class="result-box"><div class="result-label">Local time</div><div class="result-value" style="font-size:.95rem;">' + local + '</div></div>' +
    '</div>' +
    (dateNote ? '<div class="result-sub" style="margin-top:12px;">' + dateNote + '</div>' : '');
}

function useNow() {
  document.getElementById('inputType').value = 's';
  document.getElementById('value').value = Math.floor(Date.now() / 1000);
  convert();
}

function tick() {
  document.getElementById('live').textContent = Math.floor(Date.now() / 1000) + '  (' + new Date().toISOString() + ')';
}

tick();
setInterval(tick, 1000);
