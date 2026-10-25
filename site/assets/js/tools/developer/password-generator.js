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
    document.getElementById('password').textContent = 'select at least one character set';
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
  document.getElementById('pwdMeta').textContent = len + ' characters · ' + chars.length + ' possible symbols';
  updateStrengthPanel(evaluate(pwd, chars.length));
}

function copyPassword() {
  const text = document.getElementById('password').textContent;
  if (!text || text === 'click generate') return;
  navigator.clipboard.writeText(text).then(() => {
    const b = document.getElementById('copyBtn');
    const old = b.textContent;
    b.textContent = 'Copied';
    setTimeout(() => { b.textContent = old; }, 1200);
  });
}

function checkCustom() {
  const pwd = document.getElementById('checkInput').value;
  const box = document.getElementById('checkResult');
  if (!pwd) {
    box.innerHTML = '<div class="result-sub">Strength of the password you type will appear here.</div>';
    return;
  }
  let size = 0;
  if (/[a-z]/.test(pwd)) size += 26;
  if (/[A-Z]/.test(pwd)) size += 26;
  if (/[0-9]/.test(pwd)) size += 10;
  if (/[^a-zA-Z0-9]/.test(pwd)) size += 30;
  const r = evaluate(pwd, size);
  box.innerHTML = '<div class="result-label">Strength</div>' +
    '<div class="result-value">' + r.bits.toFixed(1) + ' bits</div>' +
    '<div class="result-sub">' + r.label + (r.note ? ' · ' + r.note : '') + ' · ' + r.time + '</div>';
}

function evaluate(pwd, charsetSize) {
  let bits = pwd.length * Math.log2(charsetSize || 1);
  let label, cls, note = '';
  const lower = pwd.toLowerCase();
  const isCommon = COMMON.includes(lower) || /^(.)\1+$/.test(pwd);
  if (isCommon) {
    bits = Math.min(bits, 10);
    note = 'common password or pattern';
  } else {
    const prefix = pwd.match(/^(0123|1234|abcd|qwer)/i);
    if (prefix) {
      // A known prefix weakens only those characters, not the whole password.
      bits = Math.max(0, bits - prefix[0].length * Math.log2(charsetSize || 1));
      note = 'common prefix pattern';
    }
  }

  if (bits < 28) { label = 'Very weak'; cls = 'error'; }
  else if (bits < 50) { label = 'Weak'; cls = 'error'; }
  else if (bits < 70) { label = 'Reasonable'; cls = 'info'; }
  else if (bits < 100) { label = 'Strong'; cls = 'success'; }
  else { label = 'Very strong'; cls = 'success'; }

  const time = crackTime(bits);
  return { bits, label, cls, note, time };
}

function updateStrengthPanel(r) {
  document.getElementById('entropy').textContent = r.bits.toFixed(1) + ' bits';
  document.getElementById('crackTime').textContent = 'Brute-force estimate: ' + r.time;
  const el = document.getElementById('strengthLabel');
  el.className = 'status-box ' + r.cls;
  el.textContent = r.label + (r.note ? ' (' + r.note + ')' : '');
}

function crackTime(bits) {
  // assume 1e10 guesses per second
  const guesses = Math.pow(2, bits);
  const seconds = guesses / 2 / 1e10;
  if (seconds < 1) return 'instantly';
  const units = [
    ['second', 1], ['minute', 60], ['hour', 3600], ['day', 86400],
    ['year', 31557600], ['century', 3155760000]
  ];
  if (seconds < 60) return Math.round(seconds) + ' seconds';
  if (seconds < 3600) return Math.round(seconds / 60) + ' minutes';
  if (seconds < 86400) return Math.round(seconds / 3600) + ' hours';
  if (seconds < 31557600) return Math.round(seconds / 86400) + ' days';
  const years = seconds / 31557600;
  if (years < 1000) return Math.round(years) + ' years';
  if (years < 1e6) return Math.round(years / 1000) + ' thousand years';
  if (years < 1e9) return Math.round(years / 1e6) + ' million years';
  if (years < 1e12) return Math.round(years / 1e9) + ' billion years';
  return 'practically forever';
}

generate();
