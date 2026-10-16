/* Fake registration: three absurd steps. Nothing is sent anywhere.
   Only the nickname is saved, in this browser's localStorage. */
(function () {
  window.DPB = window.DPB || {};
  const $ = id => document.getElementById(id);
  const S = DPB.sound, U = DPB.ui;

  const modal = $('signup'), card = modal.querySelector('.card');
  const p1 = $('su-p1'), p2 = $('su-p2'), p3 = $('su-p3');
  const nick = $('su-nick'), pass = $('su-pass'), rulesEl = $('su-rules'), err = $('su-error');
  const submit = $('su-submit');
  const cap = $('su-cap'), capLabel = $('su-cap-label'), capMsg = $('su-cap-msg'), capNext = $('su-cap-next');
  const terms = $('su-terms'), termsMsg = $('su-terms-msg'), accept = $('su-accept'), decline = $('su-decline');

  const rules = [
    { text: 'At least 8 characters', ok: v => v.length >= 8 },
    { text: 'At most 3 characters', ok: v => v.length <= 3 },
    { text: 'Contains a number', ok: v => /\d/.test(v) },
    { text: 'Contains the sound a cat makes', ok: v => /meow|miau|nya|mrr+p?/i.test(v) },
    { text: 'Is not "password"', ok: v => v.toLowerCase() !== 'password' }
  ];
  const ruleItems = rules.map(r => {
    const li = document.createElement('li');
    li.textContent = '✗ ' + r.text;
    rulesEl.appendChild(li);
    return li;
  });
  function checkRules() {
    rules.forEach((r, i) => {
      const ok = r.ok(pass.value);
      ruleItems[i].className = ok ? 'ok' : '';
      ruleItems[i].textContent = (ok ? '✓ ' : '✗ ') + r.text;
    });
  }
  pass.addEventListener('input', checkRules);
  checkRules();

  const clauses = [
    'By pressing the button you agree to not have pressed it.',
    'The button owns all your future clicks, and some of your past ones.',
    'We may sell your attention to a very small, very tired pigeon.',
    'You will not ask what the button is for. Nobody knows.',
    'Any resemblance of this site to a useful website is purely accidental.',
    'The button may become offended at any time without notice.',
    'You accept that 99% is a perfectly valid amount of done.',
    'We are not responsible for lost time, found time, or time spent here.',
    'If a teapot appears, it is not our fault.',
    'You promise to read these terms. Both of them.',
    'Scrolling to the bottom does not mean you read it. We know.',
    'This agreement is governed by the laws of Buttonland.'
  ];
  clauses.concat(clauses, clauses).forEach((c, i) => {
    const p = document.createElement('p');
    p.textContent = (i + 1) + '. ' + c;
    terms.appendChild(p);
  });

  let attempts = 0, capTries = 0, done = null;

  function reset() {
    attempts = 0; capTries = 0;
    p1.hidden = false; p2.hidden = true; p3.hidden = true;
    err.textContent = capMsg.textContent = termsMsg.textContent = '';
    cap.checked = false; cap.disabled = false; capNext.hidden = true;
    capLabel.textContent = "I'm not a button";
    accept.disabled = true; terms.scrollTop = 0;
    submit.disabled = false;
  }

  submit.addEventListener('click', async () => {
    attempts++;
    if (attempts === 1) {
      err.textContent = 'Password rejected: too short and too long at the same time.';
    } else if (attempts === 2) {
      err.textContent = 'Still rejected. Have you tried being a different password?';
    } else {
      submit.disabled = true;
      err.textContent = "Fine. We picked a password for you: hunter2. Don't tell anyone.";
      S.play('win');
      await U.sleep(1800);
      DPB.state.name = nick.value.trim() || 'Stranger';
      p1.hidden = true; p2.hidden = false;
      return;
    }
    S.play('error');
    U.shake(card);
  });

  cap.addEventListener('change', async () => {
    if (!cap.checked) return;
    cap.disabled = true;
    capLabel.textContent = 'Verifying…';
    await U.sleep(1200);
    capTries++;
    if (capTries === 1) {
      capMsg.textContent = 'Verification failed: you are 62% button.';
    } else if (capTries === 2) {
      capMsg.textContent = 'Closer. 41% button. Try being less round.';
    } else {
      capMsg.textContent = 'Fine. Human. Probably.';
      capLabel.textContent = 'Verified (probably)';
      capNext.hidden = false;
      S.play('win');
      return;
    }
    S.play('error');
    cap.checked = false; cap.disabled = false;
    capLabel.textContent = "I'm not a button";
  });

  capNext.addEventListener('click', () => { p2.hidden = true; p3.hidden = false; });

  terms.addEventListener('scroll', () => {
    if (terms.scrollTop + terms.clientHeight >= terms.scrollHeight - 4) {
      accept.disabled = false;
      termsMsg.textContent = '';
    }
  });

  decline.addEventListener('click', () => {
    termsMsg.textContent = 'Declining is not supported. Please keep scrolling.';
    S.play('error');
    U.shake(card);
  });

  accept.addEventListener('click', () => {
    modal.hidden = true;
    DPB.store.set('dpb_name', DPB.state.name);
    if (done) { const f = done; done = null; f(DPB.state.name); }
  });

  DPB.signup = {
    open() {
      return new Promise(resolve => {
        reset();
        done = resolve;
        modal.hidden = false;
        nick.focus();
      });
    }
  };
})();
