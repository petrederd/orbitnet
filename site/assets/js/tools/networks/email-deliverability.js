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
function finding(state, title, detail) {
  const cls = state === 'ok' ? 'success' : (state === 'warn' ? 'info' : 'error');
  const icon = state === 'ok' ? 'OK' : (state === 'warn' ? '!' : 'X');
  return '<div class="status-box ' + cls + '"><strong>' + icon + ' · ' + esc(title) + '</strong>' +
    '<div class="result-sub" style="margin-top:4px;color:inherit;">' + esc(detail) + '</div></div>';
}
function rec(label, value) {
  return '<div class="result-box"><div class="result-label">' + esc(label) + '</div>' +
    '<div class="result-value" style="font-family:monospace;font-size:.85rem;word-break:break-word;">' + esc(value) + '</div></div>';
}

function run() {
  clearError();
  const host = document.getElementById('host').value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const selector = document.getElementById('selector').value.trim();
  if (!host) { showError('Please enter a domain'); return; }

  document.getElementById('findings').innerHTML = '<div class="loading">Analysing...</div>';
  document.getElementById('records').innerHTML = '<div class="loading">Loading...</div>';

  const url = '/api/email?host=' + encodeURIComponent(host) + (selector ? '&selector=' + encodeURIComponent(selector) : '');
  fetch(url).then(r => r.json()).then(d => {
    if (d.error) { showError(d.error); document.getElementById('findings').innerHTML = ''; return; }
    analyse(host, selector, d);
  }).catch(e => { showError(e.message); });
}

function analyse(host, selector, d) {
  const out = [];

  const mxOk = d.mx && d.mx.length;
  out.push(finding(mxOk ? 'ok' : 'err', 'MX records',
    mxOk ? 'Mail can be delivered to: ' + d.mx.map(m => m.host).join(', ')
         : 'No MX records. The domain cannot receive email (add MX records or, if it sends only, an SPF "null MX" is not the same as no MX).'));

  let spfOk = false;
  if (!d.spf) {
    out.push(finding('warn', 'SPF missing',
      'No v=spf1 TXT record. Anyone can spoof the domain. Add an SPF record listing your sending servers, ending with -all or ~all.'));
  } else {
    const mechanisms = d.spf.split(/\s+/).slice(1);
    const allMech = mechanisms.find(m => /^[+\-~?]?all$/i.test(m));
    const lookups = mechanisms.filter(m => /^(include:|a$|a:|mx$|mx:|ptr$|ptr:|exists:|redirect=)/i.test(m)).length;
    if (!allMech) {
      out.push(finding('warn', 'SPF has no "all" mechanism', 'The record "' + d.spf + '" does not end with an "all" clause, so unmatched senders are undecided. Add -all (strict) or ~all (soft).'));
    } else if (/^[+?]all$/i.test(allMech)) {
      out.push(finding('warn', 'SPF is permissive', 'The "all" mechanism is "' + allMech + '", which allows everyone. Use -all or ~all instead.'));
    } else {
      spfOk = true;
      out.push(finding('ok', 'SPF present', 'Policy "' + allMech + '". ' + d.spf));
    }
    if (lookups > 10) {
      out.push(finding('warn', 'SPF exceeds 10 DNS lookups', 'SPF allows at most 10 DNS lookups; this record uses about ' + lookups + '. Receivers may return a permerror. Flatten includes.'));
    }
  }

  let dmarcOk = false;
  if (!d.dmarc) {
    out.push(finding('warn', 'DMARC missing', 'No TXT record at _dmarc.' + host + '. Add one, e.g. "v=DMARC1; p=quarantine; rua=mailto:dmarc@' + host + '".'));
  } else {
    const p = (/;\s*p\s*=\s*(none|quarantine|reject)/i.exec(d.dmarc) || [])[1];
    const hasRua = /rua\s*=/i.test(d.dmarc);
    if (!p) {
      out.push(finding('warn', 'DMARC without a policy', 'The record has no p= policy: ' + d.dmarc));
    } else if (p.toLowerCase() === 'none') {
      dmarcOk = true;
      out.push(finding('warn', 'DMARC policy is p=none', 'Reporting only — failures are not blocked. Move to p=quarantine or p=reject once reports look clean.' + (hasRua ? '' : ' Add a rua= address to receive reports.')));
    } else {
      dmarcOk = true;
      out.push(finding('ok', 'DMARC policy is p=' + p.toLowerCase(), d.dmarc));
    }
  }

  if (selector) {
    const dkimOk = d.dkim && d.dkim.length;
    out.push(finding(dkimOk ? 'ok' : 'warn', 'DKIM selector "' + selector + '"',
      dkimOk ? 'A key is published at ' + selector + '._domainkey.' + host + '.' :
      'No key found at ' + selector + '._domainkey.' + host + '. A missing DKIM record breaks alignment and can fail DMARC.'));
  } else {
    out.push(finding('warn', 'DKIM not checked', 'Provide a selector to look up a DKIM public key.'));
  }

  if (d.mxPtr) {
    out.push(finding('ok', 'PTR for primary MX', d.mxPtr.ip + ' → ' + d.mxPtr.hostnames.join(', ')));
  } else {
    out.push(finding('warn', 'No PTR for primary MX', 'Many receivers expect the mail server IP to have a matching PTR. Ask your provider to set reverse DNS.'));
  }

  const sourceNote = d.source === 'worker'
    ? '<div class="status-box info">The local resolver did not answer; the email records were fetched by the external checker.</div>'
    : (d.workerError
      ? '<div class="status-box info">Worker fallback did not run: ' + esc(d.workerError) + '</div>'
      : '');
  document.getElementById('findings').innerHTML = sourceNote + out.join('');

  let records = '';
  records += rec('MX', mxOk ? d.mx.map(m => m.priority + ' ' + m.host).join('\n') : 'none');
  records += rec('SPF', d.spf || 'none');
  records += rec('DMARC', d.dmarc || 'none');
  if (selector) records += rec('DKIM (' + selector + ')', (d.dkim && d.dkim.join('\n')) || 'none');
  document.getElementById('records').innerHTML = records;
}
