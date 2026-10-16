/* Sound effects, synthesized with the Web Audio API. No audio files needed.
   Browsers only allow sound after a user gesture, and the first click is one. */
(function () {
  window.DPB = window.DPB || {};

  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem('dpb_muted') === '1'; } catch (e) {}

  function ac() {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(o) {
    if (muted) return;
    const c = ac(); if (!c) return;
    const f = o.f || 440, t = o.t || 0.15, vol = o.vol || 0.15;
    const t0 = c.currentTime + (o.delay || 0);
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t0 + t);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
    osc.connect(g); g.connect(c.destination);
    osc.start(t0); osc.stop(t0 + t + 0.03);
  }

  function noise(o) {
    if (muted) return;
    const c = ac(); if (!c) return;
    const t = o.t || 0.4;
    const len = Math.floor(c.sampleRate * t);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const flt = c.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = o.lp || 800;
    const g = c.createGain(); g.gain.value = o.vol || 0.3;
    src.connect(flt); flt.connect(g); g.connect(c.destination);
    src.start(c.currentTime + (o.delay || 0));
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
    whistle() { tone({ f: 800, f2: 1250, t: 0.8, type: 'sine', vol: 0.1 }); tone({ f: 810, f2: 1270, t: 0.8, type: 'sine', vol: 0.06 }); }
  };

  window.DPB.sound = {
    play(name, arg) {
      try { if (sounds[name]) sounds[name](arg); } catch (e) { /* sound is optional */ }
    },
    isMuted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('dpb_muted', muted ? '1' : '0'); } catch (e) {}
      return muted;
    }
  };
})();
