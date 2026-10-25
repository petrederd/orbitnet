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
function get(url) { return fetch(url).then(r => r.json()).catch(() => ({ error: 'request failed' })); }
function box(label, value, color) {
  return '<div class="result-box"><div class="result-label">' + esc(label) + '</div><div class="result-value" style="font-size:.95rem;' +
    (color ? 'color:' + color + ';' : '') + 'word-break:break-all;">' + esc(value) + '</div></div>';
}
function isIp(s) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || s.includes(':'); }

let captchaId = '';

function showNotice(m) {
  const el = document.getElementById('errorMsg');
  el.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'info';
  div.textContent = String(m == null ? '' : m);
  el.appendChild(div);
}

function loadCaptcha() {
  const img = document.getElementById('captchaImg');
  const field = document.getElementById('captchaAnswer');
  img.removeAttribute('src');
  field.value = '';

  fetch('/api/captcha')
    .then(r => r.json())
    .then(data => {
      if (data.error) throw new Error(data.error);
      captchaId = data.id;
      img.src = data.image;
      field.focus();
    })
    .catch(e => {
      captchaId = '';
      img.alt = 'Captcha unavailable';
      showError(e.message);
    });
}

function showCaptcha(message) {
  document.getElementById('captchaGroup').hidden = false;
  loadCaptcha();
  showNotice(message || 'This port check needs a captcha');
  document.getElementById('results').innerHTML =
    '<div style="text-align: center; padding: 40px 20px; color: var(--muted);">' +
    'Enter the captcha code and click Run diagnostics again.</div>';
}

function hideCaptcha() {
  document.getElementById('captchaGroup').hidden = true;
  document.getElementById('captchaAnswer').value = '';
  document.getElementById('captchaImg').removeAttribute('src');
  captchaId = '';
}

function postPort(host, port) {
  const group = document.getElementById('captchaGroup');
  const payload = { host, port: Number(port) };
  if (!group.hidden && captchaId) {
    payload.captcha = captchaId;
    payload.answer = document.getElementById('captchaAnswer').value.trim();
  }
  return fetch('/api/port', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then(r => r.json())
    .catch(() => ({ error: 'request failed' }));
}

function needsCaptcha(portR) {
  if (portR && portR.captchaRequired) {
    showCaptcha(portR.error || 'This port check needs a captcha');
    return true;
  }
  hideCaptcha();
  return false;
}

function run() {
  clearError();
  const host = document.getElementById('host').value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const port = document.getElementById('port').value.trim() || '443';
  if (!host) { showError('Please enter a host or IP'); return; }
  if (!/^\d{1,5}$/.test(port)) { showError('Port must be a number 1-65535'); return; }
  const group = document.getElementById('captchaGroup');
  if (!group.hidden && !/^\d{4}$/.test(document.getElementById('captchaAnswer').value.trim())) {
    showError('Enter the 4 digits from the captcha');
    return;
  }

  document.getElementById('results').innerHTML = '<div class="loading">Running diagnostics...</div>';
  const tasks = [get('/api/ip'), postPort(host, port)];
  if (isIp(host)) {
    tasks.push(get('/api/dns?host=' + encodeURIComponent(host) + '&type=PTR'));
    Promise.all(tasks).then(([me, portR, ptr]) => {
      if (needsCaptcha(portR)) return;
      render(host, port, me, portR, null, null, ptr);
    });
  } else {
    tasks.push(get('/api/dns?host=' + encodeURIComponent(host) + '&type=A'));
    tasks.push(get('/api/dns?host=' + encodeURIComponent(host) + '&type=AAAA'));
    Promise.all(tasks).then(([me, portR, a, aaaa]) => {
      if (needsCaptcha(portR)) return;
      if (a.records && a.records.length) {
        get('/api/dns?host=' + encodeURIComponent(a.records[0]) + '&type=PTR')
          .then(ptr => render(host, port, me, portR, a, aaaa, ptr));
      } else {
        render(host, port, me, portR, a, aaaa, { records: [] });
      }
    });
  }
}

function render(host, port, me, portR, a, aaaa, ptr) {
  let html = '';
  html += box('Your public IP', me.ip || '—');

  if (a) {
    const aText = a.nxdomain ? 'NXDOMAIN (domain does not exist)'
      : ((a.records || []).join(', ') || (a.nodata ? 'none (NODATA)' : (a.error || 'none')));
    const aaaaText = aaaa && aaaa.nxdomain ? 'NXDOMAIN (domain does not exist)'
      : ((aaaa && aaaa.records || []).join(', ') || (aaaa && aaaa.nodata ? 'none (NODATA)' : (aaaa && aaaa.error) || 'none'));
    html += box('Forward DNS (A)', aText);
    html += box('Forward DNS (AAAA)', aaaaText);
  }

  const ptrHosts = (ptr && ptr.records) || [];
  html += box('Reverse DNS (PTR)', ptrHosts.length ? ptrHosts.join(', ') : (ptr && ptr.error ? ptr.error : 'none'));

  const open = portR && portR.open;
  let portDetail;
  let portColor = open ? 'var(--accent)' : 'var(--danger)';
  if (portR && portR.error === 'timeout') {
    portDetail = 'closed / filtered (no response)';
    portColor = 'var(--warning)';
  } else if (portR && portR.error === 'ECONNREFUSED') {
    portDetail = 'closed (connection refused)';
  } else if (portR && portR.error) {
    portDetail = portR.error;
  } else {
    portDetail = open ? 'open' : 'closed / filtered';
  }
  html += box('TCP port ' + port, (portR && portR.ip ? portR.ip + ' · ' : '') + portDetail, portColor);

  document.getElementById('results').innerHTML = html;
}
