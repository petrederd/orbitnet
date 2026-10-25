function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function showError(m) {
  const el = document.getElementById('errorMsg');
  el.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'error';
  div.textContent = String(m == null ? '' : m);
  el.appendChild(div);
}
function clearError() { document.getElementById('errorMsg').innerHTML = ''; }

function verdict(item) {
  if (item.error) return { kind: 'error', label: 'Error' };
  if (item.blocked) return { kind: 'blocked', label: 'Blocked' };
  if (item.listed) {
    if (item.spam === false) return { kind: 'info', label: item.label || 'Informational listing' };
    return { kind: 'listed', label: item.label || 'Listed' };
  }
  return { kind: 'clean', label: 'Not listed' };
}

function listRows(lists) {
  return lists.map(function (item) {
    const v = verdict(item);
    const detail = item.error
      ? 'Query failed: ' + esc(item.error)
      : (item.blocked
        ? esc(item.reason || 'The list refused the query.')
        : (item.listed
          ? 'Answer ' + esc(item.code) + '. ' + esc(item.reason || '')
          : ''));
    return '<div class="bl-row">' +
      '<span class="bl-name">' + esc(item.name) + '</span>' +
      '<span class="bl-badge ' + v.kind + '">' + esc(v.label) + '</span>' +
      '<span class="bl-detail">' + detail + '</span>' +
      '</div>';
  }).join('');
}

function group(title, note, lists, skipReason) {
  const body = lists.length
    ? listRows(lists)
    : '<div class="bl-row"><span class="bl-detail">' + esc(skipReason || 'No databases were queried for this target.') + '</span></div>';
  return '<div class="bl-group"><h3>' + title + (note ? ' <span class="mono">' + esc(note) + '</span>' : '') + '</h3>' +
    body + '</div>';
}

function run() {
  clearError();
  const target = document.getElementById('target').value.trim();
  if (!target) { showError('Please enter an IP address, domain or email'); return; }

  document.getElementById('summary').innerHTML = '<div class="loading">Checking blacklists...</div>';
  document.getElementById('details').innerHTML = '<div class="loading">Querying lists...</div>';

  fetch('/api/spam?target=' + encodeURIComponent(target))
    .then(r => r.json().then(d => ({ ok: r.ok, d })))
    .then(({ ok, d }) => {
      if (!ok || d.error) { showError(d.error || 'Check failed'); document.getElementById('summary').innerHTML = ''; document.getElementById('details').innerHTML = ''; return; }
      render(d);
    })
    .catch(e => { showError(e.message); });
}

function render(d) {
  let listed = 0, blocked = 0, errors = 0, informational = 0, unsupported = 0;
  const allGroups = [];

  if (d.kind === 'ip') {
    const entry = d.ips[0];
    allGroups.push(group('IP address', entry.ip, entry.lists || [], entry.note));
    if (!entry.supported) unsupported++;
  } else {
    (d.domains || []).forEach(function (domain) {
      allGroups.push(group('Domain', domain.name, domain.lists || []));
    });
    (d.ips || []).forEach(function (entry) {
      allGroups.push(group(entry.version === 6 ? 'IPv6 address' : 'Mail server IP', entry.ip, entry.lists || [], entry.note));
      if (!entry.supported) unsupported++;
    });
  }

  const entries = [];
  if (d.kind === 'ip') entries.push(d.ips[0]);
  else {
    (d.domains || []).forEach(x => entries.push(x));
    (d.ips || []).forEach(x => entries.push(x));
  }
  let totalLists = 0;
  entries.forEach(function (entry) {
    (entry.lists || []).forEach(function (item) {
      totalLists++;
      const v = verdict(item);
      if (v.kind === 'listed') listed++;
      else if (v.kind === 'info') informational++;
      else if (v.kind === 'blocked') blocked++;
      else if (v.kind === 'error') errors++;
    });
  });

  const kindLabel = { ip: 'IP address', domain: 'Domain', email: 'Email' }[d.kind] || 'Target';
  const resolverBlocked = Boolean(d.resolver && d.resolver.blocked);
  const resolverUnknown = Boolean(d.resolver && d.resolver.checked === false && !resolverBlocked);
  const incomplete = blocked > 0 || errors > 0 || resolverBlocked;
  const summaryClass = listed ? 'error' : ((incomplete || !totalLists) ? 'warning' : 'success');
  const summaryText = listed
    ? listed + ' listing' + (listed === 1 ? '' : 's') + ' found'
    : (incomplete
      ? 'Could not verify all lists'
      : (!totalLists
        ? 'No database was queried for this target'
        : (informational
          ? 'No spam listings found, but some lists returned informational codes'
          : 'Not listed on the checked databases')));
  const notes = [];
  if (blocked) notes.push(blocked + ' blocked');
  if (informational) notes.push(informational + ' informational');
  if (unsupported) notes.push(unsupported + ' not supported');
  if (errors) notes.push(errors + ' query error' + (errors === 1 ? '' : 's'));
  if (resolverBlocked) notes.push('DNSBL resolver blocked');
  if (resolverUnknown) notes.push('DNSBL resolver status unknown');

  document.getElementById('summary').innerHTML =
    '<div class="status-box ' + summaryClass + '"><strong>' + esc(summaryText) + '</strong>' +
    '<div class="result-sub" style="margin-top:4px;color:inherit;">' +
    esc(kindLabel) + ': <span class="mono">' + esc(d.target) + '</span>' +
    (notes.length ? ' · ' + esc(notes.join(', ')) : '') +
    '</div></div>';

  const resolverWarning = resolverBlocked
    ? '<div class="status-box warning"><strong>DNSBL resolver is blocked.</strong> ' +
      esc(d.resolver.reason || 'Spamhaus refused the test query; results may be incomplete.') + '</div>'
    : (resolverUnknown
      ? '<div class="status-box warning"><strong>DNSBL resolver status is unknown.</strong> ' +
        esc(d.resolver.error || 'The Spamhaus test query did not return an expected answer; results may be incomplete.') + '</div>'
      : '');
  document.getElementById('details').innerHTML = resolverWarning + allGroups.join('');
}
