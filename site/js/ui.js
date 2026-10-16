/* Shared helpers: state, storage, message, toast, overlay, cookie banner, runaway button. */
(function () {
  window.DPB = window.DPB || {};
  const S = DPB.sound;
  const $ = id => document.getElementById(id);

  const btn = $('btn'), msg = $('msg'), toastEl = $('toast'), overlay = $('overlay');
  const ovText = $('ovText'), ovBar = $('ovBar'), cookie = $('cookie');

  DPB.state = { clicks: 0, total: 0, name: '' };

  DPB.store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage is optional */ } }
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const say = t => { msg.textContent = t; };

  function shake(el) {
    const target = el || document.body;
    target.classList.remove('shake');
    void target.offsetWidth;
    target.classList.add('shake');
  }

  let toastTimer;
  function toast(t) {
    toastEl.textContent = '🏆 ' + t;
    toastEl.classList.add('show');
    S.play('ding');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }

  async function progress(text, ms, plain, endAt) {
    endAt = endAt || 100;
    overlay.classList.toggle('plain', !!plain);
    ovText.textContent = text;
    ovBar.style.width = '0';
    overlay.classList.add('show');
    const steps = 40;
    for (let i = 1; i <= steps; i++) {
      ovBar.style.width = (endAt * i / steps) + '%';
      if (i % 4 === 0) S.play('tick');
      await sleep(ms / steps);
    }
  }
  const hideOverlay = () => overlay.classList.remove('show');

  const showCookie = () => cookie.classList.add('show');
  const hideCookie = () => cookie.classList.remove('show');

  /* ----- the runaway button ----- */
  let runaway = false, dodges = 0, onCaught = null;

  function moveBtn() {
    const w = btn.offsetWidth, h = btn.offsetHeight;
    btn.style.left = Math.random() * Math.max(innerWidth - w - 20, 0) + 10 + 'px';
    btn.style.top = Math.random() * Math.max(innerHeight - h - 20, 0) + 10 + 'px';
  }

  function startRunaway(cb) {
    runaway = true; dodges = 0; onCaught = cb || null;
    btn.classList.add('runner');
    moveBtn();
  }

  btn.addEventListener('pointerenter', () => {
    if (!runaway) return;
    if (dodges < 5) { dodges++; moveBtn(); S.play('whoosh'); return; }
    runaway = false;
    btn.classList.remove('runner');
    btn.style.left = btn.style.top = '';
    if (onCaught) onCaught();
  });

  DPB.ui = {
    btn, say, toast, shake, sleep, progress, hideOverlay,
    showCookie, hideCookie, startRunaway, isRunaway: () => runaway
  };
})();
