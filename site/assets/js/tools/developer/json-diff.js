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

function childPath(path, key) {
  if (typeof key === 'number') return path + '[' + key + ']';
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? path + '.' + key
    : path + '[' + JSON.stringify(key) + ']';
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function diffJson(left, right, path, changes) {
  const base = path || '$';
  const result = changes || [];

  if (isObject(left) && isObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      const next = childPath(base, key);
      if (!(key in left)) result.push({ path: next, type: 'added', right: right[key] });
      else if (!(key in right)) result.push({ path: next, type: 'removed', left: left[key] });
      else diffJson(left[key], right[key], next, result);
    }
    return result;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index++) {
      const next = childPath(base, index);
      if (index >= left.length) result.push({ path: next, type: 'added', right: right[index] });
      else if (index >= right.length) result.push({ path: next, type: 'removed', left: left[index] });
      else diffJson(left[index], right[index], next, result);
    }
    return result;
  }

  if (!Object.is(left, right)) {
    result.push({ path: base, type: 'changed', left, right });
  }
  return result;
}

function valueText(value) {
  if (value === undefined) return '—';
  const text = JSON.stringify(value);
  return text && text.length > 240 ? text.slice(0, 240) + '…' : text;
}

function compare() {
  showError('');
  let left;
  let right;
  try {
    left = JSON.parse(document.getElementById('leftInput').value);
  } catch (error) {
    showError('Left side JSON error: ' + error.message);
    return;
  }
  try {
    right = JSON.parse(document.getElementById('rightInput').value);
  } catch (error) {
    showError('Right side JSON error: ' + error.message);
    return;
  }

  const changes = diffJson(left, right, '$', []);
  if (!changes.length) {
    document.getElementById('results').innerHTML = '<div class="status-box success">No structural differences.</div>';
    return;
  }

  const counts = { added: 0, removed: 0, changed: 0 };
  changes.forEach(change => { counts[change.type]++; });

  let html = '<div class="result-box highlight"><div class="result-label">Summary</div>' +
    '<div class="result-value" style="font-size:1.05rem;">' + changes.length + ' difference(s): ' +
    counts.added + ' added, ' + counts.removed + ' removed, ' + counts.changed + ' changed.</div></div>';

  html += '<div class="result-box"><div class="result-label">Changes</div><table class="data-table"><thead><tr><th>Path</th><th>Change</th><th>Old</th><th>New</th></tr></thead><tbody>';
  const limit = Math.min(changes.length, 500);
  for (let i = 0; i < limit; i++) {
    const change = changes[i];
    const color = change.type === 'added' ? 'var(--accent)' : change.type === 'removed' ? 'var(--danger)' : 'var(--warning)';
    html += '<tr><td>' + esc(change.path) + '</td>' +
      '<td style="color:' + color + ';font-weight:600;">' + esc(change.type) + '</td>' +
      '<td>' + esc(valueText(change.left)) + '</td>' +
      '<td>' + esc(valueText(change.right)) + '</td></tr>';
  }
  html += '</tbody></table>';
  if (changes.length > limit) {
    html += '<div class="result-sub" style="margin-top:10px;">Showing the first ' + limit + ' of ' + changes.length + ' differences.</div>';
  }
  html += '</div>';
  document.getElementById('results').innerHTML = html;
}

function swap() {
  const left = document.getElementById('leftInput');
  const right = document.getElementById('rightInput');
  const temp = left.value;
  left.value = right.value;
  right.value = temp;
  compare();
}

function clearAll() {
  document.getElementById('leftInput').value = '';
  document.getElementById('rightInput').value = '';
  document.getElementById('results').innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);">Paste two JSON documents and compare them.</div>';
  showError('');
}

compare();
