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

function flattenObject(value, prefix, output) {
  const result = output || {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    result[prefix] = value;
    return result;
  }
  for (const [key, item] of Object.entries(value)) {
    const name = prefix ? prefix + '.' + key : key;
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      flattenObject(item, name, result);
    } else {
      result[name] = item;
    }
  }
  return result;
}

function protectFormula(text) {
  if (/^[+-]?\d+(?:\.\d+)?$/.test(text)) return text;
  return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
}

function cellText(value, protectFormulas) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const needsProtection = protectFormulas && typeof value !== 'number' && typeof value !== 'boolean';
  return needsProtection ? protectFormula(text) : text;
}

function csvEscape(value, delimiter, protectFormulas) {
  const text = cellText(value, protectFormulas);
  if (text.includes(delimiter) || text.includes('"') || /[\r\n]/.test(text)) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

function jsonToCsv(text, options) {
  const opts = Object.assign({ delimiter: ',', flatten: true, header: true, protectFormulas: true, bom: false }, options || {});
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error('JSON error: ' + error.message);
  }

  let rows;
  if (Array.isArray(parsed)) {
    rows = parsed;
  } else if (parsed !== null && typeof parsed === 'object') {
    rows = [parsed];
  } else {
    throw new Error('Input must be a JSON object or an array of objects');
  }
  if (!rows.length) throw new Error('The JSON array is empty');

  const normalized = rows.map((row, index) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('Row ' + (index + 1) + ' is not an object');
    }
    return opts.flatten ? flattenObject(row, '', {}) : row;
  });

  const columns = [];
  const seen = new Set();
  normalized.forEach(row => {
    Object.keys(row).forEach(key => {
      if (!seen.has(key)) { seen.add(key); columns.push(key); }
    });
  });

  const lines = [];
  if (opts.header) lines.push(columns.map(column => csvEscape(column, opts.delimiter, opts.protectFormulas)).join(opts.delimiter));
  normalized.forEach(row => {
    lines.push(columns.map(column => csvEscape(row[column], opts.delimiter, opts.protectFormulas)).join(opts.delimiter));
  });

  return {
    csv: (opts.bom ? '\uFEFF' : '') + lines.join('\r\n'),
    rows: normalized.length,
    columns: columns.length
  };
}

function optionsFromUi() {
  return {
    delimiter: document.getElementById('delimiter').value,
    flatten: document.getElementById('flatten').checked,
    header: document.getElementById('header').checked,
    protectFormulas: document.getElementById('protectFormulas').checked,
    bom: document.getElementById('bom').checked
  };
}

function convert() {
  showError('');
  try {
    const result = jsonToCsv(document.getElementById('jsonInput').value, optionsFromUi());
    document.getElementById('csvOutput').value = result.csv;
    document.getElementById('stats').textContent = result.rows + ' row(s), ' + result.columns + ' column(s).';
  } catch (error) {
    document.getElementById('csvOutput').value = '';
    document.getElementById('stats').textContent = '';
    showError(error.message);
  }
}

async function copyCsv() {
  const output = document.getElementById('csvOutput');
  output.select();
  if (!await copyText(output.value)) output.select();
}

function clearAll() {
  document.getElementById('jsonInput').value = '';
  document.getElementById('csvOutput').value = '';
  document.getElementById('stats').textContent = '';
  showError('');
}

document.getElementById('jsonInput').addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') convert();
});
convert();
