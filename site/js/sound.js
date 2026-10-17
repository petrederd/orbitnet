/* Sound effects and a small chiptune loop, synthesized with the Web Audio API. No audio files.
   Browsers only allow sound after a user gesture, and the first click is one.
   Everything goes through a limiter, so nothing can get painfully loud. */
(function () {
  window.DPB = window.DPB || {};

  let ctx = null, out = null;
  let muted = false;
  try { muted = localStorage.getItem('dpb_muted') === '1'; } catch (e) {}

  function ac() {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -18; lim.knee.value = 12; lim.ratio.value = 12;
      lim.attack.value = 0.003; lim.release.value = 0.2;
      out = ctx.createGain(); out.gain.value = 0.9;
      out.connect(lim); lim.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // o.at = absolute time (used by the music), o.delay = seconds from now
  function tone(o) {
    if (muted) return;
    const c = ac(); if (!c) return;
    const f = o.f || 440, t = o.t || 0.15, vol = o.vol || 0.15;
    const t0 = o.at != null ? o.at : c.currentTime + (o.delay || 0);
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t0 + t);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
    osc.connect(g); g.connect(out);
    osc.start(t0); osc.stop(t0 + t + 0.03);
  }

  function noise(o) {
    if (muted) return;
    const c = ac(); if (!c) return;
    const t = o.t || 0.4;
    const len = Math.max(1, Math.floor(c.sampleRate * t));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = o.lp || 800;
    const g = c.createGain(); g.gain.value = o.vol || 0.3;
    src.connect(flt); flt.connect(g); g.connect(out);
    src.start(o.at != null ? o.at : c.currentTime + (o.delay || 0));
  }

  const sounds = {
    click(n) { tone({ f: 260 + Math.min(n || 0, 40) * 12, f2: 170, t: 0.08, type: 'square', vol: 0.1 }); },
    tick() { tone({ f: 1200, t: 0.02, type: 'square', vol: 0.03 }); },
    ding() { tone({ f: 880, t: 0.12, type: 'triangle', vol: 0.12 }); tone({ f: 1320, t: 0.18, type: 'triangle', vol: 0.12, delay: 0.1 }); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone({ f: f, t: 0.18, type: 'triangle', vol: 0.14, delay: i * 0.09 })); },
    sad() { [392, 370, 349, 311].forEach((f, i) => tone({ f: f, t: 0.35, type: 'triangle', vol: 0.14, delay: i * 0.28 })); },
    error() { tone({ f: 160, t: 0.3, type: 'sawtooth', vol: 0.12 }); tone({ f: 120, t: 0.3, type: 'sawtooth', vol: 0.12, delay: 0.18 }); },
    boom() { noise({ t: 0.6, vol: 0.5, lp: 400 }); tone({ f: 90, f2: 30, t: 0.5, type: 'sine', vol: 0.3 }); },
    whoosh() { noise({ t: 0.15, vol: 0.12, lp: 2200 }); tone({ f: 300, f2: 900, t: 0.12, type: 'sine', vol: 0.05 }); },
    whistle() { tone({ f: 800, f2: 1250, t: 0.8, type: 'sine', vol: 0.1 }); tone({ f: 810, f2: 1270, t: 0.8, type: 'sine', vol: 0.06 }); },
    jump() { tone({ f: 330, f2: 700, t: 0.12, type: 'square', vol: 0.05 }); },
    pop() { noise({ t: 0.18, vol: 0.3, lp: 1800 }); tone({ f: 220, f2: 60, t: 0.2, type: 'square', vol: 0.1 }); },
    // the jump scare: a noise burst and a nasty chord, kept under the limiter
    scare() {
      noise({ t: 1.0, vol: 0.5, lp: 5000 });
      tone({ f: 110, f2: 55, t: 1.0, type: 'sawtooth', vol: 0.2 });
      tone({ f: 116.5, f2: 58, t: 1.0, type: 'sawtooth', vol: 0.2 });
      tone({ f: 1760, f2: 1500, t: 0.6, type: 'square', vol: 0.06 });
    }
  };

  /* ----- music: a 4-bar loop (Am - F - C - G) with kick, bass and a little arpeggio ----- */
  const BPM = 140, STEP = 60 / BPM / 4;
  const ROOTS = [110, 87.31, 130.81, 98];
  const CHORDS = [[440, 523.25, 659.25], [349.23, 440, 523.25], [523.25, 659.25, 783.99], [392, 493.88, 587.33]];
  const ARP = [0, 1, 2, 1, 0, 1, 2, 2];
  let timer = 0, nextAt = 0, stepNo = 0;

  function playStep(i, at) {
    const bar = Math.floor(i / 16) % 4, s = i % 16;
    if (s % 4 === 0) tone({ f: 150, f2: 45, t: 0.12, type: 'sine', vol: 0.16, at: at });
    if (s % 4 === 2) noise({ t: 0.05, vol: 0.05, lp: 7000, at: at });
    if (s % 2 === 0) tone({ f: ROOTS[bar], t: STEP * 1.8, type: 'square', vol: 0.045, at: at });
    tone({ f: CHORDS[bar][ARP[s % 8]], t: STEP * 0.9, type: 'triangle', vol: 0.05, at: at });
  }
  function pump() {
    const c = ac(); if (!c) return;
    if (nextAt < c.currentTime) nextAt = c.currentTime + 0.05;
    while (nextAt < c.currentTime + 0.3) { playStep(stepNo++, nextAt); nextAt += STEP; }
  }
  const music = {
    start() {
      if (timer) return;
      const c = ac(); if (!c) return;
      nextAt = c.currentTime + 0.05; stepNo = 0;
      pump();
      timer = setInterval(pump, 80);
    },
    stop() { clearInterval(timer); timer = 0; }
  };

  window.DPB.sound = {
    play(name, arg) {
      try { if (sounds[name]) sounds[name](arg); } catch (e) { /* sound is optional */ }
    },
    music: music,
    isMuted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('dpb_muted', muted ? '1' : '0'); } catch (e) {}
      return muted;
    }
  };
})();
