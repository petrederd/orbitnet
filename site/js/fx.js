/* Background effects: falling mini buttons, ripples, peeking eyes, fake pop-up ads
   and one jump scare. Everything is drawn with code, so there is nothing to download. */
(function () {
  window.DPB = window.DPB || {};
  const S = DPB.sound;
  const reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  let scaresOn = !(DPB.store && DPB.store.get('dpb_scares') === '0');   // the visitor can switch scares off

  const cv = document.getElementById('fx');
  const g = cv && cv.getContext ? cv.getContext('2d') : null;
  let W = innerWidth, H = innerHeight;

  function size() {
    if (!g) return;
    const d = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    cv.width = W * d; cv.height = H * d;
    g.setTransform(d, 0, 0, d, 0, 0);
  }
  size();
  addEventListener('resize', size);

  /* ---------- falling mini buttons + ripples (canvas behind the page) ---------- */
  let drops = [], rings = [], raf = 0, last = 0;

  function tick(t) {
    const dt = Math.min((t - last) / 1000, 0.05);
    last = t;
    g.clearRect(0, 0, W, H);

    drops = drops.filter(p => p.y < H + 40);
    for (const p of drops) {
      p.vy += 900 * dt; p.y += p.vy * dt; p.x += p.vx * dt; p.a += p.va * dt;
      if (p.y > H - p.r && p.vy > 0 && p.bounces < 1) { p.y = H - p.r; p.vy *= -0.45; p.bounces++; }
      g.save();
      g.translate(p.x, p.y); g.rotate(p.a);
      g.fillStyle = '#8d0220'; g.beginPath(); g.arc(0, 3, p.r, 0, 6.2832); g.fill();
      g.fillStyle = '#d90429'; g.beginPath(); g.arc(0, 0, p.r, 0, 6.2832); g.fill();
      g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.arc(-p.r * 0.3, -p.r * 0.35, p.r * 0.3, 0, 6.2832); g.fill();
      g.restore();
    }

    rings = rings.filter(r => r.life > 0);
    for (const r of rings) {
      r.life -= dt; r.r += 520 * dt;
      g.strokeStyle = 'rgba(217,4,41,' + (Math.max(r.life, 0) * 0.8) + ')';
      g.lineWidth = 4;
      g.beginPath(); g.arc(r.x, r.y, r.r, 0, 6.2832); g.stroke();
    }

    if (drops.length || rings.length) raf = requestAnimationFrame(tick);
    else { raf = 0; g.clearRect(0, 0, W, H); }
  }
  function kick() {
    if (!raf && g) { last = performance.now(); raf = requestAnimationFrame(tick); }
  }

  function rain(n) {
    if (reduce || !g) return;
    for (let i = 0; i < n; i++) {
      drops.push({
        x: Math.random() * W, y: -20 - Math.random() * 120,
        vx: (Math.random() - 0.5) * 60, vy: 40 + Math.random() * 120,
        r: 10 + Math.random() * 14, a: Math.random() * 6.28, va: (Math.random() - 0.5) * 6, bounces: 0
      });
    }
    kick();
  }

  function ripple() {
    if (reduce || !g || !DPB.ui) return;
    const b = DPB.ui.btn.getBoundingClientRect();
    rings.push({ x: b.left + b.width / 2, y: b.top + b.height / 2, r: b.width / 2, life: 0.6 });
    kick();
  }

  /* ---------- eyes peeking from the screen edge ---------- */
  function peek() {
    if (reduce) return;
    const side = pick(['b', 't', 'l', 'r']);
    const el = document.createElement('div');
    el.className = 'peek ' + side;
    el.textContent = pick(['👀', '🫣', '🐙', '👻']);
    const pos = Math.round(10 + Math.random() * 80) + '%';
    if (side === 'b' || side === 't') el.style.left = pos; else el.style.top = pos;
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
    setTimeout(() => el.classList.remove('in'), 1700);
    setTimeout(() => el.remove(), 2400);
  }

  /* ---------- fake pop-up ads (obviously silly, nothing real) ---------- */
  const ads = [
    ['CONGRATULATIONS!', "You are today's 1,000,000th visitor! Your prize: nothing."],
    ['Hot singles near you', 'They are also not pressing the button.'],
    ['System warning', 'Your computer has 0 viruses. This is suspicious.'],
    ['Download more RAM', 'Free. Instant. Does not work.'],
    ['Breaking news', 'Local person presses button. Nothing happens.'],
    ['Your free trial has ended', 'You were never on a trial. Please pay us anyway.']
  ];
  let lastAd = 0;

  function popup() {
    const box = document.getElementById('popups');
    const now = Date.now();
    if (!box || now - lastAd < 4000) return;
    lastAd = now;
    while (box.children.length >= 3) box.firstChild.remove();

    const narrow = innerWidth < 700;
    const left = narrow ? 8 + Math.random() * Math.max(innerWidth - 300, 0)
                        : (Math.random() < 0.5 ? 12 : innerWidth - 292);
    const top = narrow ? 60 + Math.random() * 40
                       : 70 + Math.random() * Math.max(innerHeight - 280, 0);

    const item = pick(ads);
    const ad = document.createElement('div');
    ad.className = 'ad';
    ad.style.left = Math.round(left) + 'px';
    ad.style.top = Math.round(top) + 'px';

    const bar = document.createElement('div'); bar.className = 'bar';
    const title = document.createElement('span'); title.textContent = item[0];
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'Close');
    bar.append(title, x);

    const body = document.createElement('div'); body.className = 'body'; body.textContent = item[1];

    const row = document.createElement('div'); row.className = 'row';
    const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'ok'; ok.textContent = 'OK';
    row.append(ok);

    ad.append(bar, body, row);
    const close = () => ad.remove();
    x.addEventListener('click', close);
    ok.addEventListener('click', close);
    box.appendChild(ad);
    S.play('ding');
    setTimeout(close, 8000);
  }

  /* ---------- the jump scare: one cartoon face, no strobing, at most once per 20 s ---------- */
  let scareReady = 0;

  function scare() {
    const el = document.getElementById('scare');
    const now = Date.now();
    if (reduce || !scaresOn || !el || now < scareReady) return Promise.resolve(false);
    scareReady = now + 20000;
    return new Promise(resolve => {
      let timer = 0;
      const end = () => {
        clearTimeout(timer);
        el.removeEventListener('click', end);
        el.hidden = true;
        resolve(true);
      };
      el.hidden = false;
      S.play('scare');
      el.addEventListener('click', end);
      timer = setTimeout(end, 1400);
    });
  }

  /* ---------- called by main.js on every press ---------- */
  function onPress(n) {
    ripple();
    rain(Math.min(4 + n, 16));
    if (n % 5 === 0 || (n > 2 && Math.random() < 0.1)) peek();
    if (n === 3 || (n > 5 && Math.random() < 0.1)) popup();
  }

  DPB.fx = {
    onPress, rain, peek, popup, scare,
    scaresOn: () => scaresOn && !reduce,
    toggleScares() {
      scaresOn = !scaresOn;
      if (DPB.store) DPB.store.set('dpb_scares', scaresOn ? '1' : '0');
      return scaresOn;
    }
  };
})();
