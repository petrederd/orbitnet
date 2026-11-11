const COMMON = ['password','123456','12345678','qwerty','abc123','111111','letmein','welcome','admin','iloveyou','monkey','dragon','football','000000','123456789','login','passw0rd'];

function updateLengthLabel() {
  document.getElementById('lengthVal').textContent = this.value;
}

function selectedSets() {
  const groups = [];
  if (document.getElementById('upper').checked) groups.push('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  if (document.getElementById('lower').checked) groups.push('abcdefghijklmnopqrstuvwxyz');
  if (document.getElementById('digits').checked) groups.push('0123456789');
  if (document.getElementById('symbols').checked) groups.push('!@#$%^&*()-_=+[]{};:,.<>?/~');
  return groups;
}

function sets() {
  return selectedSets().join('');
}

function rand(max) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % max;
}

function generate() {
  const groups = selectedSets();
  const chars = groups.join('');
  const len = parseInt(document.getElementById('length').value, 10);
  if (!chars) {
    document.getElementById('password').textContent = t('select at least one character set');
    document.getElementById('pwdMeta').textContent = '—';
    return;
  }

  // Put one character from every selected set first, fill the rest freely,
  // then shuffle with Fisher-Yates so the required characters are not at fixed
  // positions (and character-set requirements on websites are satisfied).
  const charsArray = groups.map(group => group[rand(group.length)]);
  while (charsArray.length < len) charsArray.push(chars[rand(chars.length)]);
  for (let i = charsArray.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    const tmp = charsArray[i];
    charsArray[i] = charsArray[j];
    charsArray[j] = tmp;
  }

  const pwd = charsArray.slice(0, len).join('');
  document.getElementById('password').textContent = pwd;
  document.getElementById('pwdMeta').textContent = t('{len} characters · {count} possible symbols', { len: formatNumber(len), count: formatNumber(chars.length) });
  updateStrengthPanel(evaluate(pwd, chars.length));
}

function copyPassword() {
  const text = document.getElementById('password').textContent;
  if (!text || text === t('click generate')) return;
  copyText(text).then(copied => {
    const b = document.getElementById('copyBtn');
    const old = b.textContent;
    b.textContent = copied ? t('Copied') : t('Copy failed');
    setTimeout(() => { b.textContent = old; }, 1200);
  });
}

function checkCustom() {
  const pwd = document.getElementById('checkInput').value;
  const box = document.getElementById('checkResult');
  if (!pwd) {
    box.innerHTML = '<div class="result-sub">' + t('Strength of the password you type will appear here.') + '</div>';
    return;
  }
  let size = 0;
  if (/[a-z]/.test(pwd)) size += 26;
  if (/[A-Z]/.test(pwd)) size += 26;
  if (/[0-9]/.test(pwd)) size += 10;
  if (/[^a-zA-Z0-9]/.test(pwd)) size += 30;
  const r = evaluate(pwd, size);
  box.innerHTML = '<div class="result-label">' + t('Strength') + '</div>' +
    '<div class="result-value">' + r.bits.toFixed(1) + ' ' + t('bits') + '</div>' +
    '<div class="result-sub">' + r.label + (r.note ? ' · ' + r.note : '') + ' · ' + r.time + '</div>';
}

function evaluate(pwd, charsetSize) {
  let bits = pwd.length * Math.log2(charsetSize || 1);
  let label, cls, note = '';
  const lower = pwd.toLowerCase();
  const isCommon = COMMON.includes(lower) || /^(.)\1+$/.test(pwd);
  if (isCommon) {
    bits = Math.min(bits, 10);
    note = t('common password or pattern');
  } else {
    const prefix = pwd.match(/^(0123|1234|abcd|qwer)/i);
    if (prefix) {
      // A known prefix weakens only those characters, not the whole password.
      bits = Math.max(0, bits - prefix[0].length * Math.log2(charsetSize || 1));
      note = t('common prefix pattern');
    }
  }

  if (bits < 28) { label = t('Very weak'); cls = 'error'; }
  else if (bits < 50) { label = t('Weak'); cls = 'error'; }
  else if (bits < 70) { label = t('Reasonable'); cls = 'info'; }
  else if (bits < 100) { label = t('Strong'); cls = 'success'; }
  else { label = t('Very strong'); cls = 'success'; }

  const time = crackTime(bits);
  return { bits, label, cls, note, time };
}

function updateStrengthPanel(r) {
  document.getElementById('entropy').textContent = r.bits.toFixed(1) + ' ' + t('bits');
  document.getElementById('crackTime').textContent = t('Brute-force estimate: {time}', { time: r.time });
  const el = document.getElementById('strengthLabel');
  el.className = 'status-box ' + r.cls;
  el.textContent = r.label + (r.note ? ' (' + r.note + ')' : '');
}

function crackTime(bits) {
  // assume 1e10 guesses per second
  const guesses = Math.pow(2, bits);
  const seconds = guesses / 2 / 1e10;
  if (seconds < 1) return t('instantly');
  const units = [
    ['second', 1], ['minute', 60], ['hour', 3600], ['day', 86400],
    ['year', 31557600], ['century', 3155760000]
  ];
  if (seconds < 60) return t('{count} seconds', { count: formatNumber(Math.round(seconds)) });
  if (seconds < 3600) return t('{count} minutes', { count: formatNumber(Math.round(seconds / 60)) });
  if (seconds < 86400) return t('{count} hours', { count: formatNumber(Math.round(seconds / 3600)) });
  if (seconds < 31557600) return t('{count} days', { count: formatNumber(Math.round(seconds / 86400)) });
  const years = seconds / 31557600;
  if (years < 1000) return t('{count} years', { count: formatNumber(Math.round(years)) });
  if (years < 1e6) return t('{count} thousand years', { count: formatNumber(Math.round(years / 1000)) });
  if (years < 1e9) return t('{count} million years', { count: formatNumber(Math.round(years / 1e6)) });
  if (years < 1e12) return t('{count} billion years', { count: formatNumber(Math.round(years / 1e9)) });
  return t('practically forever');
}

generate();
