function esc(s) {
  return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
}

function getFlags() {
  let f = '';
  ['g', 'i', 'm', 's', 'u'].forEach(k => { if (document.getElementById('f_' + k).checked) f += k; });
  return f;
}

const MAX_MATCHES = 10000;
const RENDER_LIMIT = 200;
const WORKER_TIMEOUT = 2000;

let currentWorker = null;
let runId = 0;

const WORKER_URL = '../../assets/js/regex-worker.js?v=1';

function clearOutput(sumEl, hlEl, mEl, text) {
  sumEl.innerHTML = '';
  hlEl.innerHTML = esc(text);
  mEl.innerHTML = '';
}

function renderMatches(matches, truncated, text, sumEl, hlEl, mEl) {
  let html = '';
  let last = 0;
  matches.forEach(mt => {
    if (mt.index < last) return;
    html += esc(text.slice(last, mt.index));
    html += '<span style="background:var(--accent-dim);color:var(--accent);border-radius:3px;padding:0 2px;">' + esc(mt.value) + '</span>';
    last = mt.index + mt.value.length;
  });
  html += esc(text.slice(last));
  hlEl.innerHTML = html;

  const label = matches.length + (truncated ? '+' : '');
  sumEl.innerHTML = '<div class="stats"><span>' + label + '</span> match' + (matches.length === 1 && !truncated ? '' : 'es') + (truncated ? ' (limit of ' + MAX_MATCHES.toLocaleString('en-US') + ' reached)' : '') + '</div>';

  const shown = matches.slice(0, RENDER_LIMIT);
  let list = shown.map((mt, i) => {
    const groups = mt.groups.map((g, gi) => '<div class="result-sub">group ' + (gi + 1) + ': ' + (g === undefined ? '—' : esc(g)) + '</div>').join('');
    return '<div class="result-box"><div class="result-label">Match ' + (i + 1) + ' at index ' + mt.index + '</div>' +
      '<div class="result-value" style="font-size:1rem;">' + esc(mt.value) + '</div>' + groups + '</div>';
  }).join('');
  if (matches.length > shown.length) {
    list += '<div class="result-sub" style="margin-top:12px;">Showing the first ' + shown.length + ' of ' + label + ' matches.</div>';
  }
  mEl.innerHTML = list;
}

function run() {
  const pattern = document.getElementById('pattern').value;
  const text = document.getElementById('text').value;
  const errEl = document.getElementById('errorMsg');
  const sumEl = document.getElementById('summary');
  const hlEl = document.getElementById('highlight');
  const mEl = document.getElementById('matches');
  const id = ++runId;
  errEl.innerHTML = '';

  if (currentWorker) {
    currentWorker.terminate();
    currentWorker = null;
  }

  if (!pattern) {
    clearOutput(sumEl, hlEl, mEl, text);
    return;
  }

  const flags = getFlags();
  try {
    new RegExp(pattern, flags);
  } catch (e) {
    errEl.innerHTML = '<div class="error">Invalid regular expression: ' + esc(e.message) + '</div>';
    clearOutput(sumEl, hlEl, mEl, text);
    return;
  }

  let worker;
  try {
    worker = new Worker(WORKER_URL);
  } catch (e) {
    errEl.innerHTML = '<div class="error">Could not start the regex worker. Check that your browser and Content Security Policy allow Web Workers.</div>';
    clearOutput(sumEl, hlEl, mEl, text);
    return;
  }
  currentWorker = worker;

  const timer = setTimeout(() => {
    worker.terminate();
    if (currentWorker === worker) currentWorker = null;
    if (id !== runId) return;
    errEl.innerHTML = '<div class="error">Evaluation timed out after ' + (WORKER_TIMEOUT / 1000) + ' seconds. The pattern may cause catastrophic backtracking.</div>';
    clearOutput(sumEl, hlEl, mEl, text);
  }, WORKER_TIMEOUT);

  worker.onmessage = function(ev) {
    clearTimeout(timer);
    worker.terminate();
    if (currentWorker === worker) currentWorker = null;
    if (id !== runId) return;
    const data = ev.data;
    if (!data.ok) {
      errEl.innerHTML = '<div class="error">Invalid regular expression: ' + esc(data.error) + '</div>';
      clearOutput(sumEl, hlEl, mEl, text);
      return;
    }
    renderMatches(data.matches, data.truncated, text, sumEl, hlEl, mEl);
  };

  worker.onerror = function(ev) {
    clearTimeout(timer);
    worker.terminate();
    if (currentWorker === worker) currentWorker = null;
    if (id !== runId) return;
    errEl.innerHTML = '<div class="error">Regex evaluation failed: ' + esc(ev.message || 'unknown error') + '</div>';
    clearOutput(sumEl, hlEl, mEl, text);
  };

  worker.postMessage({ pattern, flags, text, maxMatches: MAX_MATCHES });
}

run();
