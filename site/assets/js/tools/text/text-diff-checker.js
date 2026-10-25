function esc(s) {
  return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
}

function normalize(line) {
  let s = line;
  if (document.getElementById('ignoreCase').checked) s = s.toLowerCase();
  if (document.getElementById('ignoreSpace').checked) s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function lines(value) {
  return value === '' ? [] : value.split(/\r?\n/);
}

function run() {
  const left = lines(document.getElementById('left').value);
  const right = lines(document.getElementById('right').value);

  // Empty inputs
  if (left.length === 0 && right.length === 0) {
    document.getElementById('diff').innerHTML = '<div style="padding:20px;color:var(--muted);">Enter text in both boxes to compare.</div>';
    document.getElementById('summary').innerHTML = '';
    return;
  }

  const a = left.map(normalize);
  const b = right.map(normalize);

  if (a.length * b.length > 12000000) {
    document.getElementById('diff').innerHTML = '<div style="padding:20px;color:var(--danger);">Input too large to compare. Please shorten the texts.</div>';
    document.getElementById('summary').innerHTML = '';
    return;
  }

  // LCS table
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Backtrack
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push(['same', left[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push(['del', left[i]]); i++; }
    else { ops.push(['add', right[j]]); j++; }
  }
  while (i < n) { ops.push(['del', left[i]]); i++; }
  while (j < m) { ops.push(['add', right[j]]); j++; }

  let added = 0, removed = 0, same = 0;
  ops.forEach(([t]) => { if (t === 'add') added++; else if (t === 'del') removed++; else same++; });

  const showSame = document.getElementById('showSame').checked;
  const rows = ops.filter(([t]) => showSame || t !== 'same').map(([t, line]) => {
    let bg = 'transparent', color = 'var(--muted)', sign = '  ';
    if (t === 'add') { bg = 'rgba(110,207,160,.14)'; color = 'var(--accent)'; sign = '+ '; }
    else if (t === 'del') { bg = 'rgba(242,139,130,.14)'; color = 'var(--danger)'; sign = '- '; }
    return '<div style="padding:3px 10px;white-space:pre-wrap;word-break:break-word;background:' + bg + ';color:' + color + ';">' + esc(sign + line) + '</div>';
  }).join('');

  document.getElementById('diff').innerHTML = rows || '<div style="padding:20px;color:var(--muted);">The texts are identical.</div>';
  document.getElementById('summary').innerHTML =
    '<div class="stats"><span>' + added + '</span> added · <span>' + removed + '</span> removed · <span>' + same + '</span> unchanged</div>';
}

run();
