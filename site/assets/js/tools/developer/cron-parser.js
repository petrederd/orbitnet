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

const MONTH_NAMES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DOW_NAMES = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTH_LABELS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MACROS = {
  '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *', '@minutely': '* * * * *'
};
const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTH_NAMES },
  { name: 'day-of-week', min: 0, max: 7, names: DOW_NAMES }
];

function parseCronNumber(token, field) {
  const lower = String(token).trim().toLowerCase();
  if (field.names && Object.prototype.hasOwnProperty.call(field.names, lower)) return field.names[lower];
  if (!/^\d+$/.test(lower)) throw new Error('Invalid ' + field.name + ' value: "' + token + '"');
  const value = Number(lower);
  if (value < field.min || value > field.max) {
    throw new Error(field.name + ' must be between ' + field.min + ' and ' + field.max);
  }
  return value;
}

function parseField(raw, field) {
  let text = String(raw).trim().toLowerCase();
  if (text === '?') text = '*';
  if (!text) throw new Error('Empty ' + field.name + ' field');

  const values = new Set();
  for (const part of text.split(',')) {
    if (!part) throw new Error('Empty value in ' + field.name + ' field');
    const pieces = part.split('/');
    if (pieces.length > 2) throw new Error('Too many "/" in ' + field.name + ' value "' + part + '"');
    const range = pieces[0];
    const step = pieces.length === 2 ? Number(pieces[1]) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error('Step must be a positive integer in "' + part + '"');

    let start;
    let end;
    if (range === '*') {
      start = field.min;
      end = field.max;
    } else if (range.includes('-')) {
      const bounds = range.split('-');
      if (bounds.length !== 2) throw new Error('Invalid range "' + part + '"');
      start = parseCronNumber(bounds[0], field);
      end = parseCronNumber(bounds[1], field);
      if (start > end) throw new Error('Range start is greater than end in "' + part + '"');
    } else {
      start = parseCronNumber(range, field);
      end = pieces.length === 2 ? field.max : start;
    }

    for (let value = start; value <= end; value += step) {
      values.add(field.name === 'day-of-week' && value === 7 ? 0 : value);
    }
  }

  if (!values.size) throw new Error('No values in ' + field.name + ' field');
  return [...values].sort((a, b) => a - b);
}

function parseCron(expression) {
  const raw = String(expression || '').trim();
  if (!raw) throw new Error('Please enter a cron expression');
  const expanded = MACROS[raw.toLowerCase()] || raw;
  const parts = expanded.split(/\s+/);
  if (parts.length !== 5) throw new Error('Expected 5 fields, got ' + parts.length);

  const dayField = parts[2].trim().toLowerCase();
  const dowField = parts[4].trim().toLowerCase();
  const parsed = {
    minutes: parseField(parts[0], FIELDS[0]),
    hours: parseField(parts[1], FIELDS[1]),
    days: parseField(parts[2], FIELDS[2]),
    months: parseField(parts[3], FIELDS[3]),
    dows: parseField(parts[4], FIELDS[4]),
    daysStar: dayField === '?' || dayField.startsWith('*'),
    dowsStar: dowField === '?' || dowField.startsWith('*'),
    normalized: expanded
  };
  return parsed;
}

function formatList(values, formatter) {
  const items = [...new Set(values)].sort((a, b) => a - b);
  const chunks = [];
  let start = 0;
  for (let i = 0; i < items.length; i++) {
    const endOfRun = i === items.length - 1 || items[i + 1] !== items[i] + 1;
    if (!endOfRun) continue;
    const length = i - start + 1;
    if (length >= 3) chunks.push(formatter(items[start]) + ' through ' + formatter(items[i]));
    else for (let j = start; j <= i; j++) chunks.push(formatter(items[j]));
    start = i + 1;
  }
  return chunks.join(', ');
}

function formatTime(hours, minutes) {
  if (hours.length === 24 && minutes.length === 60) return 'Every minute';
  if (hours.length === 24) {
    return 'At minute ' + formatList(minutes, String) + ' of every hour';
  }
  const combos = [];
  for (const hour of hours) {
    for (const minute of minutes) {
      combos.push(String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0'));
    }
  }
  if (combos.length > 12) {
    return 'At ' + combos.length + ' specific times per day (' + combos.slice(0, 4).join(', ') + ', …)';
  }
  return 'At ' + combos.join(', ');
}

function describeCron(parsed) {
  const pieces = [];
  if (parsed.days.length !== 31) {
    pieces.push('day ' + formatList(parsed.days, String) + ' of the month');
  }
  if (parsed.dows.length !== 7) {
    pieces.push(formatList(parsed.dows, value => DOW_LABELS[value]));
  }
  const bothRestricted = !parsed.daysStar && !parsed.dowsStar;
  const dayText = pieces.length ? pieces.join(bothRestricted ? ' or ' : ' and ') : 'every day';

  const monthText = parsed.months.length === 12
    ? ''
    : ' in ' + formatList(parsed.months, value => MONTH_LABELS[value]);

  return formatTime(parsed.hours, parsed.minutes) + ', ' + dayText + monthText + '.';
}

function matchesDay(parsed, date) {
  const dayMatch = parsed.days.includes(date.getDate());
  const dowMatch = parsed.dows.includes(date.getDay());
  if (!parsed.daysStar && !parsed.dowsStar) return dayMatch || dowMatch;
  return dayMatch && dowMatch;
}

function matchesCron(parsed, date) {
  return parsed.minutes.includes(date.getMinutes()) &&
    parsed.hours.includes(date.getHours()) &&
    parsed.months.includes(date.getMonth() + 1) &&
    matchesDay(parsed, date);
}

function nextRuns(parsed, count, from) {
  const runs = [];
  const cursor = new Date(from ? from.getTime() : Date.now());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const end = new Date(cursor);
  end.setFullYear(end.getFullYear() + 8);

  while (runs.length < count && cursor <= end) {
    if (!parsed.months.includes(cursor.getMonth() + 1)) {
      cursor.setDate(1);
      cursor.setMonth(cursor.getMonth() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (!matchesDay(parsed, cursor)) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (!parsed.hours.includes(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!parsed.minutes.includes(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
      continue;
    }
    runs.push(new Date(cursor));
    cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
  }
  return runs;
}

function formatDate(date) {
  return date.toLocaleString(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

function useExample(expression) {
  document.getElementById('cron').value = expression;
  render();
}

function render() {
  showError('');
  const expression = document.getElementById('cron').value;
  let parsed;
  try {
    parsed = parseCron(expression);
  } catch (error) {
    showError(error.message);
    document.getElementById('results').innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);">Fix the expression to see its schedule.</div>';
    return;
  }

  const runs = nextRuns(parsed, 6, new Date());
  let html = '<div class="result-box highlight"><div class="result-label">Plain English</div>' +
    '<div class="result-value" style="font-size:1.15rem;">' + esc(describeCron(parsed)) + '</div></div>';

  html += '<div class="result-box"><div class="result-label">Parsed fields</div><table class="data-table"><thead><tr><th>Field</th><th>Values</th></tr></thead><tbody>';
  html += '<tr><td>Minute</td><td>' + esc(parsed.minutes.join(', ')) + '</td></tr>';
  html += '<tr><td>Hour</td><td>' + esc(parsed.hours.join(', ')) + '</td></tr>';
  html += '<tr><td>Day of month</td><td>' + esc(parsed.days.join(', ')) + '</td></tr>';
  html += '<tr><td>Month</td><td>' + esc(parsed.months.join(', ')) + '</td></tr>';
  html += '<tr><td>Day of week</td><td>' + esc(parsed.dows.map(value => DOW_LABELS[value]).join(', ')) + '</td></tr>';
  html += '</tbody></table></div>';

  html += '<div class="result-box"><div class="result-label">Next runs (local time)</div>';
  if (runs.length) {
    html += '<table class="data-table"><thead><tr><th>#</th><th>Date and time</th><th>UTC</th></tr></thead><tbody>';
    runs.forEach((run, index) => {
      html += '<tr><td>' + (index + 1) + '</td><td>' + esc(formatDate(run)) + '</td><td>' + esc(run.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')) + '</td></tr>';
    });
    html += '</tbody></table>';
  } else {
    html += '<div class="result-sub">No matching run found in the next eight years.</div>';
  }
  html += '</div>';

  document.getElementById('results').innerHTML = html;
}

document.getElementById('cron').addEventListener('keydown', event => {
  if (event.key === 'Enter') render();
});
render();
