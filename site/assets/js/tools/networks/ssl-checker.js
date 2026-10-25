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

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString().replace('T', ' ').replace(/\..+/, ' UTC');
}
function name(obj) {
  if (!obj) return '—';
  const parts = [obj.CN, obj.O].filter(Boolean);
  return parts.length ? parts.join(' — ') : '—';
}
function box(label, value, cls) {
  return '<div class="result-box"><div class="result-label">' + esc(label) + '</div>' +
    '<div class="result-value" style="font-size:1rem;' + (cls ? 'color:' + cls + ';' : '') + '">' + esc(value) + '</div></div>';
}
function listSans(s) {
  if (!s) return [];
  return s.split(',').map(x => x.trim()).filter(Boolean).map(x => x.replace(/^DNS:/i, ''));
}

function check() {
  clearError();
  const host = document.getElementById('host').value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const port = document.getElementById('port').value.trim() || '443';
  if (!host) { showError('Please enter a host'); return; }
  if (!/^\d{1,5}$/.test(port) || ![443, 465, 993, 995, 8443].includes(Number(port))) {
    showError('Port must be one of 443, 465, 993, 995, 8443');
    return;
  }

  const deep = document.getElementById('deep').checked;
  const res = document.getElementById('results');
  res.innerHTML = '<div class="loading">Connecting to ' + esc(host) + ':' + esc(port) + '...</div>';

  fetch('/api/tls?host=' + encodeURIComponent(host) + '&port=' + port + '&deep=' + (deep ? '1' : '0'))
    .then(r => r.json())
    .then(data => {
      if (data.error) { showError(data.error); res.innerHTML = ''; return; }
      render(host, port, data);
    })
    .catch(e => { showError(e.message); res.innerHTML = ''; });
}

function versionLabel(v) {
  return ({ 'TLSv1': 'TLS 1.0', 'TLSv1.1': 'TLS 1.1', 'TLSv1.2': 'TLS 1.2', 'TLSv1.3': 'TLS 1.3' })[v] || v;
}
function mark(supported) {
  if (supported === true) return '<span style="color:var(--accent);">supported</span>';
  if (supported === null) return '<span style="color:var(--muted);">not verifiable</span>';
  return '<span style="color:var(--danger);">rejected</span>';
}

function keyLabel(k) {
  if (!k) return '—';
  const parts = [];
  if (k.type) parts.push(String(k.type).toUpperCase());
  if (k.bits) parts.push(k.bits + ' bits');
  if (k.curve) parts.push(k.curve);
  return parts.join(' ') || '—';
}
function gradeColor(g) {
  return ({ A: 'var(--accent)', B: '#8ab4f8', C: '#e7c65b', D: 'var(--warning)', E: '#e0a06b', F: 'var(--danger)' })[g] || 'var(--muted)';
}
function statusColor(status) {
  if (status === 'pass') return 'var(--accent)';
  if (status === 'fail') return 'var(--danger)';
  if (status === 'info') return 'var(--muted)';
  return 'var(--warning)';
}

function render(host, port, d) {
  const validity = d.validity || {};
  const expired = validity.expiryStatus === 'expired' || (d.daysRemaining != null && d.daysRemaining < 0);
  const expiringSoon = validity.expiryStatus === 'warning' ||
    (d.daysRemaining != null && d.daysRemaining >= 0 && d.daysRemaining < 30);
  const hostnameOk = d.hostnameMatch !== false;
  const chainInfo = d.chainAnalysis || {};
  const certOk = d.authorized && hostnameOk && !expired;

  let statusCls = certOk ? 'success' : 'error';
  let statusText = certOk ? 'Certificate is valid and trusted' : 'Certificate is not trusted or invalid';
  if (certOk && (expiringSoon || chainInfo.incomplete ||
      (chainInfo.orderIssues && chainInfo.orderIssues.length))) {
    statusCls = 'info';
    statusText = 'Certificate is valid, with warnings';
  }
  if (!certOk && d.authorizationError) statusText += ' (' + d.authorizationError + ')';

  let html = '<div class="status-box ' + statusCls + '">' + esc(statusText) + '</div>';
  if (d.deepError) html += '<div class="status-box warning">' + esc(d.deepError) + '</div>';

  if (d.grade) {
    html += '<div class="grade-row" style="margin-top:14px;">' +
      '<div class="grade-badge ' + esc(d.grade) + '">' + esc(d.grade) + '</div>' +
      '<div class="grade-meta"><h3>' + esc(d.score) + ' / 100 · OrbitNet TLS grade</h3>' +
      '<p>' + esc(d.gradeCappedBy ? 'Capped by: ' + d.gradeCappedBy : 'No rule cap applied.') + '</p>' +
      '<p>This is OrbitNet’s own scale with the rules shown openly below.</p></div></div>';
  }

  if (validity.message && validity.expiryStatus !== 'ok') {
    const cls = validity.expiryStatus === 'expired' || validity.expiryStatus === 'error' ? 'error' : 'warning';
    html += '<div class="status-box ' + cls + '">' + esc(validity.message) + '</div>';
  }
  if (chainInfo.incomplete) {
    html += '<div class="status-box error">Incomplete chain: ' + esc(chainInfo.incompleteReason || 'missing intermediate certificate') + '</div>';
  }
  if (chainInfo.extraRoot) {
    html += '<div class="status-box info">The server sends the root certificate in the chain. This is common on legacy servers and mail ports; roots are normally omitted, but it is not a security defect.</div>';
  }
  if (chainInfo.orderIssues && chainInfo.orderIssues.length) {
    html += '<div class="status-box warning">Chain order: ' + chainInfo.orderIssues.map(esc).join('; ') + '</div>';
  }
  if (validity.validityTooLong) {
    html += '<div class="status-box warning">Certificate lifetime is ' + esc(validity.validityDays) +
      ' days; the current CA/B Forum limit is ' + esc(validity.maxValidityDays) + ' days (' + esc(validity.validityRule) + ').</div>';
  }

  html += '<div class="grid-2" style="margin-top:14px;">';
  html += box('Trust', d.authorized ? 'Trusted chain' : 'Not trusted' + (d.authorizationError ? ' (' + d.authorizationError + ')' : ''),
    d.authorized ? 'var(--accent)' : 'var(--danger)');
  html += box('Hostname match', hostnameOk ? 'Yes' : 'No — name does not match',
    hostnameOk ? 'var(--accent)' : 'var(--danger)');
  html += box('Days remaining', d.daysRemaining == null ? '—' : String(d.daysRemaining),
    expired ? 'var(--danger)' : (expiringSoon ? 'var(--warning)' : 'var(--accent)'));
  const pk = d.publicKey || d.key || {};
  html += box('Public key', keyLabel(pk) + (pk.weak ? ' — weak' : ''),
    pk.weak ? 'var(--danger)' : 'var(--accent)');
  const cipherGrade = d.cipherGrade || {};
  const cipherColor = cipherGrade.strength === 'strong' ? 'var(--accent)' : (cipherGrade.strength === 'weak' ? 'var(--danger)' : 'var(--warning)');
  html += box('Protocol / cipher', (d.protocol || '—') + ' / ' + (d.cipher || '—') +
    (cipherGrade.strength ? ' (' + cipherGrade.strength + ')' : ''), cipherColor);
  html += box('ALPN', d.alpn ? d.alpn + ' (offered h2, http/1.1)' : 'none (offered h2, http/1.1)',
    d.alpn === 'h2' ? 'var(--accent)' : 'var(--warning)');

  if (d.ocsp) {
    let ocspText;
    let ocspColor;
    if (d.ocsp.stapled) {
      ocspText = 'Stapled';
      ocspColor = 'var(--accent)';
    } else if (d.ocsp.applicable) {
      ocspText = 'Not stapled (certificate contains an OCSP URL)';
      ocspColor = 'var(--warning)';
    } else {
      ocspText = 'Not applicable — no OCSP URL in the certificate';
      ocspColor = 'var(--muted)';
    }
    html += box('OCSP stapling', ocspText, ocspColor);
  }
  if (d.sct) {
    html += box('Certificate Transparency',
      d.sct.present ? 'Embedded SCT (' + d.sct.count + ')' : 'No embedded SCT',
      d.sct.present ? 'var(--accent)' : 'var(--warning)');
  }
  if (d.altSvc) {
    let altText;
    let altColor;
    if (!d.altSvc.checked) {
      altText = 'Not evaluated on this port';
      altColor = 'var(--muted)';
    } else if (d.altSvc.raw) {
      altText = d.altSvc.raw;
      altColor = d.altSvc.http3 ? 'var(--accent)' : 'var(--warning)';
    } else {
      altText = 'No Alt-Svc header';
      altColor = 'var(--warning)';
    }
    html += box('HTTP/3 (Alt-Svc)', altText, altColor);
  }
  if (d.caa) {
    const caaText = d.caa.found
      ? (d.caa.domain + ': ' + d.caa.records.map(r => r.tag + ' ' + r.value).join(', '))
      : (d.caa.error ? 'Lookup failed (' + d.caa.error + ')' : 'No CAA records');
    html += box('CAA (certificate authority)', caaText, d.caa.found ? 'var(--accent)' : 'var(--warning)');
  }
  html += '</div>';

  if (!hostnameOk) {
    const mismatch = d.hostnameCheck || {};
    const san = (mismatch.san && mismatch.san.length) ? mismatch.san : listSans(d.subjectaltname);
    html += '<div class="result-box"><div class="result-label">Hostname mismatch</div>' +
      '<div class="result-value" style="font-size:.9rem;line-height:1.7;color:var(--danger);">' +
      esc(mismatch.message || d.hostnameMessage || d.hostnameError || ('Certificate name does not match ' + host)) +
      (san.length ? '<div style="margin-top:6px;color:var(--muted);">SAN: ' + san.map(esc).join(', ') + '</div>' : '') +
      '</div></div>';
  }

  if (Array.isArray(d.protocols) && d.protocols.length) {
    const vs = d.versionSummary || {};
    let vh = '<div class="result-box"><div class="result-label">Supported protocol versions</div>' +
      '<div class="result-value" style="font-size:.9rem;line-height:1.9;">';
    d.protocols.forEach(p => {
      vh += '<div>' + esc(versionLabel(p.version)) + ': ' + mark(p.supported) + '</div>';
    });
    if (vs.issues && vs.issues.length) {
      vh += '<div style="margin-top:6px;color:var(--warning);">' + vs.issues.map(esc).join('<br>') + '</div>';
    }
    vh += '</div></div>';
    html += vh;
  }

  if (Array.isArray(d.ciphers) && d.ciphers.length) {
    const supported = d.ciphers.filter(c => c.supported === true);
    const weakSupported = supported.filter(c => c.weak);
    const legacySupported = supported.filter(c => c.strength === 'legacy');
    let ch = '<div class="result-box"><div class="result-label">Cipher suites (' + supported.length + ' of ' + d.ciphers.length + ' probed)</div>' +
      '<div class="result-value" style="font-size:.9rem;line-height:1.9;">';
    d.ciphers.forEach(c => {
      const color = c.supported !== true ? 'var(--muted)'
        : (c.strength === 'weak' ? 'var(--danger)' : (c.strength === 'legacy' ? 'var(--warning)' : 'var(--accent)'));
      const note = c.supported === true && c.strength === 'weak' ? ' — weak'
        : (c.supported === true && c.strength === 'legacy' ? ' — legacy' : '');
      ch += '<div style="color:' + color + ';">' + esc(c.name) + ': ' + mark(c.supported) + esc(note) + '</div>';
    });
    if (weakSupported.length) {
      ch += '<div style="margin-top:6px;color:var(--danger);">Weak suites enabled: ' + weakSupported.map(c => esc(c.name)).join(', ') + '</div>';
    }
    if (legacySupported.length) {
      ch += '<div style="margin-top:6px;color:var(--warning);">Legacy suites enabled: ' + legacySupported.map(c => esc(c.name)).join(', ') + '</div>';
    }
    ch += '<div class="result-sub" style="margin-top:6px;">Legacy versions and ciphers that our own OpenSSL refuses to offer are shown as “not verifiable”.</div>';
    ch += '</div></div>';
    html += ch;
  }

  html += '<div class="grid-2">';
  html += box('Issued to', name(d.subject));
  html += box('Issued by', name(d.issuer));
  html += box('Valid from', fmtDate(d.valid_from));
  html += box('Valid to', fmtDate(d.valid_to));
  html += box('Certificate lifetime', validity.validityDays == null ? '—' :
    validity.validityDays + ' days' + (d.authorized
      ? ' (limit ' + validity.maxValidityDays + ')'
      : ' (CA/B limit not applied: chain is not trusted)'),
    validity.validityTooLong ? 'var(--warning)' : 'var(--accent)');
  html += box('Serial number', d.serialNumber || '—');
  html += '</div>';

  const sans = listSans(d.subjectaltname);
  if (sans.length) {
    html += '<div class="result-box"><div class="result-label">Subject alternative names (' + sans.length + ')</div>' +
      '<div class="result-value" style="font-size:.9rem;line-height:1.7;">' + sans.map(esc).join('<br>') + '</div></div>';
  }

  if (Array.isArray(d.chain) && d.chain.length) {
    let chain = '<div class="result-box"><div class="result-label">Certificate chain (' + d.chain.length + ')' +
      (chainInfo.incomplete ? ' — incomplete' : (chainInfo.ordered === false ? ' — out of order' : ' — ordered')) +
      '</div><div class="result-value"><div style="overflow-x:auto;"><table class="chain-table">' +
      '<thead><tr><th>#</th><th>Subject</th><th>Issuer</th><th>Valid to</th><th>Key</th><th>Flags</th></tr></thead><tbody>';
    d.chain.forEach((c, i) => {
      const flags = [];
      if (c.selfSigned) flags.push('self-signed');
      if (c.ca) flags.push('CA');
      if (c.publicKey && c.publicKey.weak) flags.push('weak key');
      if (c.sct && c.sct.present) flags.push('SCT');
      chain += '<tr><td>' + (i + 1) + '</td><td>' + esc(name(c.subject)) + '</td><td>' +
        esc(name(c.issuer)) + '</td><td>' + esc(fmtDate(c.valid_to)) + '</td><td>' +
        esc(keyLabel(c.publicKey)) + '</td><td>' + esc(flags.join(', ') || '—') + '</td></tr>';
    });
    chain += '</tbody></table></div></div></div>';
    html += chain;
  }

  if (Array.isArray(d.gradeChecks) && d.gradeChecks.length) {
    let gh = '<div class="result-box"><div class="result-label">TLS grade checks</div>' +
      '<div class="result-value" style="font-size:.9rem;line-height:1.8;">';
    d.gradeChecks.forEach(item => {
      gh += '<div><span style="color:' + statusColor(item.status) + ';font-weight:600;">' +
        esc(String(item.status || '').toUpperCase()) + '</span> — ' + esc(item.title) +
        (item.detail ? ': <span style="color:var(--muted);">' + esc(item.detail) + '</span>' : '') + '</div>';
    });
    gh += '</div></div>';
    html += gh;
  }

  document.getElementById('results').innerHTML = html;
}
