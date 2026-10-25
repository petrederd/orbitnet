const MODES = [
  ['upper', 'UPPERCASE'],
  ['lower', 'lowercase'],
  ['title', 'Title Case'],
  ['sentence', 'Sentence case'],
  ['camel', 'camelCase'],
  ['pascal', 'PascalCase'],
  ['snake', 'snake_case'],
  ['kebab', 'kebab-case'],
  ['constant', 'CONSTANT_CASE'],
  ['alternating', 'aLtErNaTiNg'],
  ['inverse', 'iNVERSE'],
];

let currentMode = 'title';

function buildButtons() {
  const el = document.getElementById('modes');
  el.innerHTML = MODES.map(([key, label]) =>
    '<button class="mode-btn' + (key === currentMode ? ' active' : '') + '" data-mode="' + key + '">' + label + '</button>'
  ).join('');
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    currentMode = b.dataset.mode;
    el.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    applyCurrent();
  }));
}

function words(text) {
  return text.match(/[\p{L}\p{N}]+/gu) || [];
}

// Splits identifiers as well as plain text: "myVariableName" -> ["my", "Variable", "Name"].
function splitWords(text) {
  return words(
    text
      .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
      .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
  );
}

function upperFirst(word) {
  const chars = [...word];
  return chars.length ? chars[0].toUpperCase() + chars.slice(1).join('').toLowerCase() : word;
}

function upperFirstKeep(word) {
  const chars = [...word];
  return chars.length ? chars[0].toUpperCase() + chars.slice(1).join('') : word;
}

function convert(text, mode) {
  switch (mode) {
    case 'upper': return text.toUpperCase();
    case 'lower': return text.toLowerCase();
    case 'title': return text.replace(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu, upperFirst);
    case 'sentence': return text.toLowerCase().replace(/(^\s*|[.!?]\s+|\n\s*)(\p{L})/gu, (m, pre, ch) => pre + ch.toUpperCase());
    case 'camel': {
      const w = splitWords(text).map(x => x.toLowerCase());
      return w.map((x, i) => i === 0 ? x : upperFirstKeep(x)).join('');
    }
    case 'pascal': {
      const w = splitWords(text).map(x => x.toLowerCase());
      return w.map(x => upperFirstKeep(x)).join('');
    }
    case 'snake': return splitWords(text).map(x => x.toLowerCase()).join('_');
    case 'kebab': return splitWords(text).map(x => x.toLowerCase()).join('-');
    case 'constant': return splitWords(text).map(x => x.toUpperCase()).join('_');
    case 'alternating': return [...text].map((c, i) => i % 2 ? c.toUpperCase() : c.toLowerCase()).join('');
    case 'inverse': return [...text].map(c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()).join('');
    default: return text;
  }
}

function applyCurrent() {
  const input = document.getElementById('input').value;
  const out = convert(input, currentMode);
  document.getElementById('output').value = out;
  updateStats(input, out);
}

function updateStats(input, out) {
  const chars = input.length;
  const w = words(input).length;
  const lines = input ? input.split(/\r?\n/).length : 0;
  document.getElementById('stats').innerHTML =
    '<span>' + chars + '</span> characters · <span>' + w + '</span> words · <span>' + lines + '</span> lines';
}

function copyOutput(btn) {
  const out = document.getElementById('output');
  if (!out.value) return;
  copyText(out.value).then(copied => flash(btn, copied ? 'Copied' : 'Copy failed'));
}

function useOutput() {
  const out = document.getElementById('output').value;
  document.getElementById('input').value = out;
  applyCurrent();
  document.getElementById('input').focus();
}

function clearAll() {
  document.getElementById('input').value = '';
  applyCurrent();
}

function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1200);
}

buildButtons();
applyCurrent();
