/* A tiny rhythm-platformer level, drawn on a canvas. Reached on the 19th press.
   Hold or tap (mouse, touch, Space, Up, W) to jump. At the end: press the button.
   The physics lives in createSim(), so it can be tested without drawing anything. */
(function () {
  window.DPB = window.DPB || {};
  const S = DPB.sound;
  const $ = id => document.getElementById(id);

  // all sizes are in "tiles"; the picture is scaled to the screen
  const SPEED = 8;                              // tiles per second
  const GRAV = 70;
  const JUMP_H = 2.4;                           // jump height in tiles
  const V0 = Math.sqrt(2 * GRAV * JUMP_H);
  const PW = 0.8;                               // player size
  const END = 158;                              // x where the level stops
  const STEP = 1 / 120;                         // fixed physics step

  /* ----- the level: edit this to change it ----- */
  const level = (() => {
    const spikes = [], blocks = [];
    const one = x => spikes.push({ x });
    const two = x => { one(x); one(x + 1); };
    const block = (x, w, h) => blocks.push({ x, w: w || 1, h: h || 1 });
    one(20); one(30); one(40);
    two(51);
    block(61, 1, 1);
    one(71);
    two(81);
    block(92, 3, 1);
    one(102);
    two(112);
    one(122);
    two(133);
    one(143);
    return { spikes, blocks };
  })();

  /* ----- physics (no drawing here) ----- */
  function createSim() {
    const s = { x: 0, y: 0, vy: 0, onGround: true, rot: 0, dead: false, finale: false, stopped: false, speed: SPEED };

    s.step = function (dt, held) {
      if (s.dead) return;
      if (s.x >= END) {
        s.finale = true;
        s.speed = Math.max(0, s.speed - 16 * dt);
        if (s.speed === 0) s.stopped = true;
      }
      s.x += s.speed * dt;

      const prevY = s.y;
      if (s.onGround && held && !s.finale) { s.vy = V0; s.onGround = false; }
      s.vy -= GRAV * dt;
      s.y += s.vy * dt;

      // floor = the ground, or the top of a block we were above a moment ago
      let floor = 0;
      for (const b of level.blocks) {
        if (s.x + PW > b.x && s.x < b.x + b.w && prevY >= b.h - 0.05) floor = Math.max(floor, b.h);
      }
      const wasAir = !s.onGround;
      if (s.y <= floor && s.vy <= 0) {
        s.y = floor; s.vy = 0; s.onGround = true;
        if (wasAir) s.rot = Math.round(s.rot / (Math.PI / 2)) * (Math.PI / 2);
      } else {
        s.onGround = false;
        s.rot += (Math.PI / 0.52) * dt;
      }

      // hitting the side of a block, or a spike, is the end
      for (const b of level.blocks) {
        if (s.x + PW > b.x && s.x < b.x + b.w && s.y < b.h - 0.2) s.dead = true;
      }
      for (const u of level.spikes) {
        if (s.x + PW > u.x + 0.25 && s.x < u.x + 0.75 && s.y < 0.5) s.dead = true;
      }
    };
    return s;
  }

  /* ----- the game screen ----- */
  let running = null;      // promise of the game in progress
  let liveSim = null;

  function play() {
    if (running) return running;
    running = new Promise(resolve => {
      const root = $('game'), cv = $('gd'), ctx = cv.getContext('2d');
      const msg = $('gd-msg'), fill = $('gd-fill'), skip = $('gd-skip'), fin = $('gd-final');
      const reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

      let W = 0, H = 0, T = 40;
      let sim = liveSim = createSim();
      let attempts = 1, held = false, acc = 0, last = 0, raf = 0;
      let deadAt = 0, attemptAt = performance.now(), startAt = performance.now();
      let won = false, finaleUp = false;
      let bits = [];

      function size() {
        const d = Math.min(window.devicePixelRatio || 1, 2);
        W = root.clientWidth; H = root.clientHeight;
        cv.width = W * d; cv.height = H * d;
        ctx.setTransform(d, 0, 0, d, 0, 0);
        T = Math.max(26, Math.min(56, Math.min(W / 14, H / 9)));
      }

      /* input */
      const isBtn = e => e.target && e.target.closest && e.target.closest('button');
      const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW'];
      const onDown = e => { if (isBtn(e)) return; held = true; if (e.cancelable) e.preventDefault(); };
      const onUp = () => { held = false; };
      const onKeyDown = e => {
        if (finaleUp || isBtn(e) || JUMP_KEYS.indexOf(e.code) < 0) return;
        held = true; e.preventDefault();
      };
      const onKeyUp = e => {
        if (JUMP_KEYS.indexOf(e.code) < 0) return;
        held = false;
        if (!isBtn(e)) e.preventDefault();
      };

      /* effects */
      function burst() {
        const cx = W * 0.25 + (PW * T) / 2, cy = H * 0.78 - sim.y * T - (PW * T) / 2;
        for (let i = 0; i < 18; i++) {
          bits.push({ x: cx, y: cy, vx: (Math.random() - 0.5) * 520, vy: -Math.random() * 520, s: 6 + Math.random() * 8, life: 0.9, c: '#ffd23f' });
        }
      }
      function confetti() {
        const cols = ['#ff6b6b', '#ffd23f', '#39ff14', '#39d0ff', '#ff7bff'];
        for (let i = 0; i < 110; i++) {
          bits.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.5, vx: (Math.random() - 0.5) * 160, vy: 80 + Math.random() * 240, s: 6 + Math.random() * 8, life: 3, c: cols[i % cols.length] });
        }
      }

      function restart(t) {
        sim = liveSim = createSim();
        attempts++; deadAt = 0; acc = 0; attemptAt = t;
        msg.textContent = 'Attempt ' + attempts;
        if (attempts >= 4) skip.hidden = false;
      }

      /* drawing */
      function draw() {
        const prog = Math.min(sim.x / END, 1);
        const hue = (210 + prog * 140) % 360;
        const gy = H * 0.78, px = W * 0.25;

        const grd = ctx.createLinearGradient(0, 0, 0, gy);
        grd.addColorStop(0, 'hsl(' + hue + ',65%,28%)');
        grd.addColorStop(1, 'hsl(' + hue + ',70%,14%)');
        ctx.fillStyle = grd; ctx.fillRect(0, 0, W, gy);

        ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 2;
        const gs = T * 3, off = (sim.x * T * 0.4) % gs;
        for (let x = -off; x < W; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, gy); ctx.stroke(); }
        for (let y = gy; y > 0; y -= gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

        ctx.fillStyle = 'hsl(' + hue + ',55%,8%)'; ctx.fillRect(0, gy, W, H - gy);
        ctx.fillStyle = '#fff'; ctx.fillRect(0, gy, W, 3);

        const sx = x => px + (x - sim.x) * T;
        ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.fillStyle = '#0b0b12';
        for (const b of level.blocks) {
          const x0 = sx(b.x);
          if (x0 > W || x0 + b.w * T < 0) continue;
          ctx.fillRect(x0, gy - b.h * T, b.w * T, b.h * T);
          ctx.strokeRect(x0 + 1.5, gy - b.h * T + 1.5, b.w * T - 3, b.h * T - 3);
        }
        for (const u of level.spikes) {
          const x0 = sx(u.x);
          if (x0 > W || x0 + T < 0) continue;
          ctx.beginPath(); ctx.moveTo(x0, gy); ctx.lineTo(x0 + T / 2, gy - T); ctx.lineTo(x0 + T, gy); ctx.closePath();
          ctx.fill(); ctx.stroke();
        }

        if (!sim.dead) {
          const size = PW * T;
          ctx.save();
          ctx.translate(px + size / 2, gy - sim.y * T - size / 2);
          ctx.rotate(sim.rot);
          ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
          ctx.fillRect(-size / 2, -size / 2, size, size);
          ctx.strokeRect(-size / 2, -size / 2, size, size);
          ctx.fillStyle = '#111';
          ctx.fillRect(-size * 0.28, -size * 0.18, size * 0.16, size * 0.22);
          ctx.fillRect(size * 0.12, -size * 0.18, size * 0.16, size * 0.22);
          ctx.fillRect(-size * 0.22, size * 0.18, size * 0.44, size * 0.08);
          ctx.restore();
        }

        for (const b of bits) {
          ctx.globalAlpha = Math.max(Math.min(b.life, 1), 0);
          ctx.fillStyle = b.c; ctx.fillRect(b.x, b.y, b.s, b.s);
        }
        ctx.globalAlpha = 1;
      }

      /* main loop */
      function frame(t) {
        raf = requestAnimationFrame(frame);
        const dt = Math.min((t - (last || t)) / 1000, 0.1);
        last = t;

        if (!sim.dead) {
          acc += dt;
          while (acc >= STEP) {
            const wasGround = sim.onGround;
            sim.step(STEP, held);
            acc -= STEP;
            if (wasGround && !sim.onGround && sim.vy > 0) S.play('jump');
            if (sim.dead) break;
          }
        }
        if (sim.dead) {
          if (!deadAt) { deadAt = t; burst(); S.play('pop'); }
          else if (t - deadAt > 700) restart(t);
        }

        for (const b of bits) { b.vy += 1400 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; }
        bits = bits.filter(b => b.life > 0);

        fill.style.width = Math.min(100, (sim.x / END) * 100) + '%';
        if (!won && !finaleUp && attempts > 0 && t - attemptAt > 1600) msg.textContent = '';
        if (!won && !finaleUp && skip.hidden && t - startAt > 25000) skip.hidden = false;

        if (sim.stopped && !finaleUp && !won) {
          finaleUp = true; held = false;
          fin.hidden = false; skip.hidden = true;
          msg.textContent = 'You made it. Now press the button.';
          fin.focus();
        }
        draw();
      }

      function finish() {
        cancelAnimationFrame(raf);
        root.removeEventListener('pointerdown', onDown);
        removeEventListener('pointerup', onUp);
        removeEventListener('pointercancel', onUp);
        removeEventListener('keydown', onKeyDown);
        removeEventListener('keyup', onKeyUp);
        removeEventListener('resize', size);
        skip.onclick = fin.onclick = null;
        S.music.stop();
        root.hidden = true; skip.hidden = true; fin.hidden = true;
        msg.textContent = ''; fill.style.width = '0';
        liveSim = null; running = null;
        resolve({ attempts: attempts });
      }

      skip.onclick = () => {
        sim = liveSim = createSim();
        sim.x = END; deadAt = 0; acc = 0;
        skip.hidden = true;
        msg.textContent = "Skipping... we won't tell anyone.";
        attemptAt = performance.now() + 100000;
      };
      fin.onclick = () => {
        if (won) return;
        won = true; fin.hidden = true;
        S.play('win'); S.play('boom');
        confetti();
        msg.textContent = 'LEVEL COMPLETE!';
        setTimeout(finish, 2200);
      };

      /* go */
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      root.hidden = false;
      size();
      root.addEventListener('pointerdown', onDown);
      addEventListener('pointerup', onUp);
      addEventListener('pointercancel', onUp);
      addEventListener('keydown', onKeyDown);
      addEventListener('keyup', onKeyUp);
      addEventListener('resize', size);
      skip.hidden = !reduce;       // with reduced motion, offer the skip button right away
      fin.hidden = true;
      msg.textContent = 'Attempt 1';
      S.music.start();
      raf = requestAnimationFrame(frame);
    });
    return running;
  }

  DPB.game = {
    play, createSim, level,
    isActive: () => !!running,
    current: () => liveSim,
    constants: { SPEED, GRAV, JUMP_H, V0, PW, END, STEP }
  };
})();
