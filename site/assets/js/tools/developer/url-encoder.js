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

function encodeText(text, mode) {
  const value = String(text == null ? '' : text);
  try {
    if (mode === 'uri') return encodeURI(value);
    const encoded = encodeURIComponent(value);
    return mode === 'form' ? encoded.replace(/%20/g, '+') : encoded;
  } catch (error) {
    throw new Error('Cannot encode text: input contains an unpaired UTF-16 surrogate');
  }
}

function decodeText(text, mode) {
  let value = String(text == null ? '' : text);
  if (mode === 'form') value = value.replace(/\+/g, ' ');
  try {
    return mode === 'uri' ? decodeURI(value) : decodeURIComponent(value);
  } catch (error) {
    throw new Error('Invalid percent-encoding: ' + error.message);
  }
}

function byteLength(text) {
  return new TextEncoder().encode(String(text)).length;
}

function run(direction) {
  showError('');
  const input = document.getElementById('input').value;
  const mode = document.getElementById('mode').value;
  const outputEl = document.getElementById('output');
  try {
    outputEl.value = direction === 'encode' ? encodeText(input, mode) : decodeText(input, mode);
  } catch (error) {
    outputEl.value = '';
    showError(error.message);
  }
  const before = byteLength(input);
  const after = byteLength(outputEl.value);
  document.getElementById('stats').textContent =
    input.length + ' characters / ' + before + ' UTF-8 bytes → ' +
    outputEl.value.length + ' characters / ' + after + ' UTF-8 bytes';
}

function copyOutput() {
  const output = document.getElementById('output');
  output.select();
  copyText(output.value).then(copied => {
    if (!copied) output.select();
  });
}

function clearAll() {
  document.getElementById('input').value = '';
  document.getElementById('output').value = '';
  document.getElementById('stats').textContent = '';
  showError('');
}

document.getElementById('input').addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') run('encode');
});
run('encode');
