function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

const inputTextarea = document.getElementById('inputJSON');
const outputTextarea = document.getElementById('outputJSON');
const autoFormat = document.getElementById('autoFormat');

// Auto-format on input if enabled
inputTextarea.addEventListener('input', () => {
  if (autoFormat.checked) {
    formatJSON();
  }
});

function getIndent() {
  const size = document.getElementById('indentSize').value;
  return size === 'tab' ? '\t' : parseInt(size);
}

// Keep the original lexical form of every scalar. JSON.parse/stringify would
// round large integers, turn 1.0 into 1, normalise 1e3 and drop duplicate keys.
function tokenizeJSON(text) {
  const tokens = [];
  const whitespace = ' \t\n\r';
  const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (whitespace.includes(c)) { i++; continue; }
    if ('{}[],:'.includes(c)) {
      tokens.push({ type: c, value: c });
      i++;
      continue;
    }
    if (c === '"') {
      const start = i;
      i++;
      let closed = false;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === '"') { i++; closed = true; break; }
        i++;
      }
      if (!closed) throw new Error('Unterminated string');
      tokens.push({ type: 'string', value: text.slice(start, i) });
      continue;
    }
    if (c === '-' || (c >= '0' && c <= '9')) {
      numberPattern.lastIndex = i;
      const match = numberPattern.exec(text);
      if (!match) throw new Error('Invalid number at position ' + (i + 1));
      tokens.push({ type: 'number', value: match[0] });
      i += match[0].length;
      continue;
    }
    if (text.startsWith('true', i) || text.startsWith('null', i)) {
      const value = text.slice(i, i + 4);
      tokens.push({ type: 'literal', value });
      i += 4;
      continue;
    }
    if (text.startsWith('false', i)) {
      tokens.push({ type: 'literal', value: 'false' });
      i += 5;
      continue;
    }
    throw new Error('Unexpected character at position ' + (i + 1));
  }
  return tokens;
}

function formatTokens(tokens, indent) {
  const unit = indent === '\t' ? '\t' : ' '.repeat(indent);
  let out = '';
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const value = tokens[i].value;
    if (value === '{' || value === '[') {
      out += value;
      const close = value === '{' ? '}' : ']';
      if (tokens[i + 1] && tokens[i + 1].value === close) {
        out += close;
        i++;
        continue;
      }
      depth++;
      out += '\n' + unit.repeat(depth);
    } else if (value === '}' || value === ']') {
      depth--;
      out += '\n' + unit.repeat(depth) + value;
    } else if (value === ',') {
      out += ',\n' + unit.repeat(depth);
    } else if (value === ':') {
      out += ': ';
    } else {
      out += value;
    }
  }
  return out;
}

function showStatus(elementId, type, message, detail = '') {
  const statusDiv = document.getElementById(elementId);

  let html = `<div class="status-box ${type}">${esc(message)}`;
  if (detail) {
    html += `<div class="error-detail">${esc(detail)}</div>`;
  }
  html += '</div>';
  statusDiv.innerHTML = html;
}

function clearStatus(elementId) {
  document.getElementById(elementId).innerHTML = '';
}

function updateStats(text) {
  const tokens = tokenizeJSON(text);
  const lines = text ? text.split('\n').length : 0;
  const chars = text.length;
  const bytes = new Blob([text]).size;

  let objectCount = 0;
  let arrayCount = 0;
  tokens.forEach(token => {
    if (token.value === '{') objectCount++;
    else if (token.value === '[') arrayCount++;
  });

  document.getElementById('outputStats').innerHTML = `
    <div><span>${lines}</span> lines</div><div><span>${chars.toLocaleString('en-US')}</span> characters</div><div><span>${bytes.toLocaleString('en-US')}</span> bytes</div><div><span>${objectCount}</span> objects</div><div><span>${arrayCount}</span> arrays</div>
  `;
}

function formatJSON() {
  clearStatus('inputStatus');
  clearStatus('outputStatus');
  
  const input = inputTextarea.value.trim();
  
  if (!input) {
    outputTextarea.value = '';
    document.getElementById('outputStats').innerHTML = '';
    return;
  }
  
  try {
    JSON.parse(input);
    const formatted = formatTokens(tokenizeJSON(input), getIndent());
    outputTextarea.value = formatted;

    showStatus('inputStatus', 'success', 'Valid JSON');
    updateStats(formatted);
  } catch (error) {
    outputTextarea.value = '';
    document.getElementById('outputStats').innerHTML = '';
    showStatus('inputStatus', 'error', 'Invalid JSON', error.message);
  }
}

function minifyJSON() {
  clearStatus('inputStatus');
  clearStatus('outputStatus');
  
  const input = inputTextarea.value.trim();
  
  if (!input) {
    showStatus('inputStatus', 'error', 'No input to minify');
    return;
  }
  
  try {
    JSON.parse(input);
    const minified = tokenizeJSON(input).map(token => token.value).join('');
    outputTextarea.value = minified;

    showStatus('inputStatus', 'success', 'Valid JSON — minified');
    showStatus('outputStatus', 'info', `Reduced to ${minified.length} characters`);
    updateStats(minified);
  } catch (error) {
    outputTextarea.value = '';
    showStatus('inputStatus', 'error', 'Invalid JSON', error.message);
  }
}

function copyToClipboard() {
  const output = outputTextarea.value;
  
  if (!output) {
    showStatus('outputStatus', 'error', 'Nothing to copy');
    return;
  }
  
  navigator.clipboard.writeText(output).then(() => {
    showStatus('outputStatus', 'success', 'Copied to clipboard!');
    setTimeout(() => clearStatus('outputStatus'), 3000);
  }).catch(() => {
    showStatus('outputStatus', 'error', 'Failed to copy to clipboard');
  });
}

function downloadJSON() {
  const output = outputTextarea.value;
  
  if (!output) {
    showStatus('outputStatus', 'error', 'Nothing to download');
    return;
  }
  
  const blob = new Blob([output], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `formatted-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showStatus('outputStatus', 'success', 'File downloaded');
  setTimeout(() => clearStatus('outputStatus'), 3000);
}

function clearAll() {
  inputTextarea.value = '';
  outputTextarea.value = '';
  clearStatus('inputStatus');
  clearStatus('outputStatus');
  document.getElementById('outputStats').innerHTML = '';
}
