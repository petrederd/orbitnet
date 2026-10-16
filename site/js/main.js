/* The engine: counts presses and runs the next joke. The jokes live in jokes.js. */
(function () {
  const U = DPB.ui, S = DPB.sound, st = DPB.state, J = DPB.jokes;
  const countEl = document.getElementById('count');
  const muteBtn = document.getElementById('mute');
  const cookie = document.getElementById('cookie');

  let step = 0, locked = false;
  const pick = a => a[Math.floor(Math.random() * a.length)];

  /* ----- returning visitor? ----- */
  st.name = (DPB.store.get('dpb_name') || '').slice(0, 20);
  st.total = parseInt(DPB.store.get('dpb_total'), 10) || 0;
  if (st.name) {
    U.say('Welcome back, ' + st.name + '. You have pressed this button ' + st.total + ' times in total. Please stop.');
  } else if (st.total > 0) {
    U.say("Oh. You're back. Still not pressing the button, right?");
  }

  /* ----- sound toggle ----- */
  function drawMute() { muteBtn.textContent = S.isMuted() ? '🔇' : '🔊'; }
  drawMute();
  muteBtn.addEventListener('click', () => { S.toggle(); drawMute(); S.play('click', 5); });

  /* ----- cookie banner ----- */
  cookie.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    U.hideCookie();
    S.play('click', 8);
    U.say('Thanks. We collect nothing. Except your time.');
  }));

  /* ----- the button ----- */
  U.btn.addEventListener('click', async () => {
    if (locked) return;
    st.clicks++; st.total++;
    DPB.store.set('dpb_total', String(st.total));
    countEl.textContent = 'Presses: ' + st.clicks;
    S.play('click', st.clicks);

    if (U.isRunaway()) return; // caught it mid-run: count it, but no new joke

    locked = true;
    try {
      if (step < J.steps.length) {
        await J.steps[step++]();
      } else {
        U.say(pick(J.late).replace('{name}', st.name || 'friend'));
        if (Math.random() < 0.35) pick(J.lateEvents)();
      }
    } catch (e) {
      console.error(e);
    } finally {
      locked = false;
    }
  });
})();
