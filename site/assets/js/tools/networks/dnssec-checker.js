function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function short(value, max) {
  const text = String(value == null ? '' : value);
  const limit = max || 80;
  return text.length > limit ? text.slice(0, limit) + '…' : text;
}

function showDnssecError(message) {
  const el = document.getElementById('errorMsg');
  el.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'error';
  div.textContent = String(message == null ? '' : message);
  el.appendChild(div);
}

function clearDnssecError() {
  document.getElementById('errorMsg').innerHTML = '';
}

function resultBlock(label, body) {
  return '<div class="result-box"><div class="result-label">' + esc(label) + '</div>' + body + '</div>';
}

function monoBlock(lines) {
  return '<div class="result-value" style="font-family:monospace;font-size:.85rem;line-height:1.7;word-break:break-word;">' +
    lines + '</div>';
}

function statusMeta(status) {
  if (status === 'secure') {
    return { className: 'success', label: 'Secure', summary: 'The DNSSEC chain of trust validated.' };
  }
  if (status === 'insecure') {
    return { className: 'warning', label: 'Insecure', summary: 'The zone is not signed with DNSSEC.' };
  }
  if (status === 'bogus') {
    return { className: 'error', label: 'Bogus', summary: 'DNSSEC validation failed.' };
  }
  return { className: 'info', label: 'Indeterminate', summary: 'The result could not be classified.' };
}

function yesNo(value) {
  if (value === true) return 'set';
  if (value === false) return 'not set';
  return 'unavailable';
}

function renderDnssec(host, recordType, data) {
  const meta = statusMeta(data.status);
  let html = '<div class="status-box ' + meta.className + '"><strong>' + esc(meta.label) + '</strong> — ' +
    esc(data.detail || meta.summary) + '</div>';

  html += resultBlock('Validation summary', monoBlock([
    'Query: ' + esc(host) + ' ' + esc(recordType),
    'AD bit: ' + esc(yesNo(data.ad)),
    'DNS status: ' + esc(data.dnsStatus == null ? 'unavailable' : data.dnsStatus),
    'Zone: ' + esc(data.zone || 'unknown'),
    'Resolver: ' + esc(data.resolver || 'unknown')
  ].join('<br>')));

  const zones = Array.isArray(data.zones) ? data.zones : [];
  if (!zones.length) {
    html += resultBlock('Delegation chain', '<div class="result-value" style="color:var(--muted)">No DS/DNSKEY data was returned for this query.</div>');
  }

  zones.forEach(zone => {
    const ds = Array.isArray(zone.ds) ? zone.ds : [];
    const dnskey = Array.isArray(zone.dnskey) ? zone.dnskey : [];
    const rrsig = Array.isArray(zone.rrsig) ? zone.rrsig : [];
    const lines = [];

    if (ds.length) {
      ds.forEach(record => {
        lines.push('DS keyTag=' + esc(record.keyTag == null ? '?' : record.keyTag) +
          ' alg=' + esc(record.algorithm == null ? '?' : record.algorithm) +
          ' digestType=' + esc(record.digestType == null ? '?' : record.digestType) +
          ' ' + esc(short(record.digest, 48)));
      });
    } else if (zone.dsOk) {
      lines.push('<span style="color:var(--warning)">No DS record — unsigned delegation.</span>');
    } else {
      lines.push('<span style="color:var(--muted)">DS query failed.</span>');
    }

    if (dnskey.length) {
      dnskey.forEach(record => {
        lines.push('DNSKEY flags=' + esc(record.flags == null ? '?' : record.flags) +
          ' protocol=' + esc(record.protocol == null ? '?' : record.protocol) +
          ' alg=' + esc(record.algorithm == null ? '?' : record.algorithm));
      });
    } else if (zone.dnskeyOk) {
      lines.push('<span style="color:var(--danger)">No DNSKEY record.</span>');
    } else {
      lines.push('<span style="color:var(--muted)">DNSKEY query failed.</span>');
    }

    if (rrsig.length) {
      rrsig.forEach(record => {
        lines.push('RRSIG ' + esc(record.typeCovered || '?') +
          ' alg=' + esc(record.algorithm == null ? '?' : record.algorithm) +
          ' keyTag=' + esc(record.keyTag == null ? '?' : record.keyTag) +
          ' signer=' + esc(record.signer || '?'));
      });
    } else {
      lines.push('<span style="color:var(--danger)">No RRSIG covering the DNSKEY RRset.</span>');
    }

    html += resultBlock('Zone — ' + zone.name, monoBlock(lines.join('<br>')));
  });

  const answer = Array.isArray(data.answer) ? data.answer : [];
  if (answer.length) {
    html += resultBlock('Answer — ' + recordType, monoBlock(answer.map(record =>
      esc(record.name + (record.ttl == null ? '' : ' ' + record.ttl) + ' IN ' + record.type + ' ' + record.data)
    ).join('<br>')));
  } else {
    html += resultBlock('Answer — ' + recordType, '<div class="result-value" style="color:var(--muted)">No answer records (NODATA, NXDOMAIN or validation failure).</div>');
  }

  const rrsig = Array.isArray(data.rrsig) ? data.rrsig : [];
  if (rrsig.length) {
    html += resultBlock('RRSIG — answer signatures', monoBlock(rrsig.map(record =>
      esc((record.typeCovered || '?') + ' alg=' + (record.algorithm == null ? '?' : record.algorithm) +
        ' keyTag=' + (record.keyTag == null ? '?' : record.keyTag) +
        ' signer=' + (record.signer || '?') +
        ' expires=' + (record.expiration == null ? '?' : record.expiration))
    ).join('<br>')));
  } else {
    html += resultBlock('RRSIG — answer signatures', '<div class="result-value" style="color:var(--muted)">No RRSIG records were returned with the answer.</div>');
  }

  document.getElementById('results').innerHTML = html;
}

function checkDnssec() {
  clearDnssecError();
  const host = document.getElementById('host').value.trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
  const recordType = document.getElementById('type').value;
  if (!host) {
    showDnssecError('Please enter a domain');
    return;
  }

  document.getElementById('results').innerHTML = '<div class="loading">Checking DNSSEC for ' + esc(host) + '...</div>';

  const url = '/api/dnssec?host=' + encodeURIComponent(host) + '&type=' + encodeURIComponent(recordType);
  fetch(url)
    .then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) throw new Error(data.error || 'DNSSEC check failed');
      return data;
    })
    .then(data => renderDnssec(host, recordType, data))
    .catch(error => {
      document.getElementById('results').innerHTML = '';
      showDnssecError(error.message);
    });
}
