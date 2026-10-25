function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function clearError() { document.getElementById('errorMsg').innerHTML = ''; }
function showError(m) {
  const el = document.getElementById('errorMsg');
  el.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'error';
  div.textContent = String(m == null ? '' : m);
  el.appendChild(div);
}

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
  showNotice(message || 'This check needs a captcha');
  document.getElementById('results').innerHTML =
    '<div style="text-align: center; padding: 40px 20px; color: var(--muted);">' +
    'Enter the captcha code and click Check Port again.</div>';
}

function hideCaptcha() {
  document.getElementById('captchaGroup').hidden = true;
  document.getElementById('captchaAnswer').value = '';
  document.getElementById('captchaImg').removeAttribute('src');
  captchaId = '';
}

function check() {
  clearError();
  const host = document.getElementById('host').value.trim();
  const port = parseInt(document.getElementById('port').value, 10);
  const group = document.getElementById('captchaGroup');
  const answer = document.getElementById('captchaAnswer').value.trim();
  if (!host) { showError('Please enter a host'); return; }
  if (isNaN(port) || port < 1 || port > 65535) { showError('Port must be 1-65535'); return; }
  if (!group.hidden && !/^\d{4}$/.test(answer)) {
    showError('Enter the 4 digits from the captcha');
    return;
  }

  const payload = { host, port };
  if (!group.hidden && captchaId) {
    payload.captcha = captchaId;
    payload.answer = answer;
  }

  document.getElementById('results').innerHTML = '<div class="loading">Checking ' + esc(host) + ':' + port + '...</div>';

  fetch('/api/port', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then(r => r.json())
    .then(data => {
      if (data.captchaRequired) {
        showCaptcha(data.error || 'This check needs a captcha');
        return;
      }
      if (data.error) throw new Error(data.error);

      let cls = 'success';
      let text = 'Port is open';
      let sub = 'Connection established';
      if (!data.open) {
        if (data.error === 'timeout') {
          cls = 'warning';
          text = 'Port is closed or filtered';
          sub = 'No response — a firewall may be dropping packets';
        } else if (data.error === 'ECONNREFUSED') {
          cls = 'error';
          text = 'Port is closed';
          sub = 'Connection refused';
        } else {
          cls = 'error';
          text = 'Port is closed or unreachable';
          sub = data.error || 'No response';
        }
      }

      document.getElementById('results').innerHTML =
        '<div class="result-box highlight"><div class="result-label">' + esc(host) + ':' + port + '</div>' +
        '<div class="result-value large ' + cls + '">' + text + '</div>' +
        '<div class="result-sub">' + esc(sub) + '</div></div>';
      hideCaptcha();
    })
    .catch(e => {
      document.getElementById('results').innerHTML = '';
      showError(e.message);
      if (!group.hidden) loadCaptcha();
    });
}
