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
function setStatus(message) {
  document.getElementById('status').textContent = message || '';
}

function yamlToJson(text) {
  if (typeof jsyaml === 'undefined') throw new Error('YAML parser is not loaded');
  const source = String(text == null ? '' : text);
  if (!source.trim()) throw new Error('Please enter YAML');
  let value;
  try {
    value = jsyaml.load(source);
  } catch (error) {
    throw new Error('YAML error: ' + error.message);
  }
  if (value === undefined) throw new Error('YAML contains no document');
  return JSON.stringify(value, null, 2);
}

function jsonToYaml(text) {
  if (typeof jsyaml === 'undefined') throw new Error('YAML parser is not loaded');
  const source = String(text == null ? '' : text);
  if (!source.trim()) throw new Error('Please enter JSON');
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error('JSON error: ' + error.message);
  }
  try {
    return jsyaml.dump(value, { noRefs: true, lineWidth: -1, noCompatMode: true });
  } catch (error) {
    throw new Error('YAML serialization error: ' + error.message);
  }
}

function convertYamlToJson() {
  showError('');
  setStatus('');
  try {
    const json = yamlToJson(document.getElementById('yamlInput').value);
    document.getElementById('jsonInput').value = json;
    setStatus('Converted YAML → JSON.');
  } catch (error) {
    showError(error.message);
  }
}

function convertJsonToYaml() {
  showError('');
  setStatus('');
  try {
    const yaml = jsonToYaml(document.getElementById('jsonInput').value);
    document.getElementById('yamlInput').value = yaml;
    setStatus('Converted JSON → YAML.');
  } catch (error) {
    showError(error.message);
  }
}

function loadYamlExample() {
  document.getElementById('yamlInput').value = 'name: orbitnet\nports:\n  - 80\n  - 443\nsettings:\n  debug: false\n  retries: 3\n';
  convertYamlToJson();
}

async function copyText(id) {
  const el = document.getElementById(id);
  el.select();
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(el.value);
    } else {
      document.execCommand('copy');
    }
    setStatus('Copied to clipboard.');
  } catch (error) {
    setStatus('Copy failed; select the text manually.');
  }
}
function copyJson() { copyText('jsonInput'); }
function copyYaml() { copyText('yamlInput'); }

function clearAll() {
  document.getElementById('yamlInput').value = '';
  document.getElementById('jsonInput').value = '';
  showError('');
  setStatus('');
}

convertYamlToJson();
