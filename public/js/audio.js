/*
 * Fully synthesized positional audio (WebAudio) — no sound files.
 * Gunshots = filtered noise burst + low thump + tail; footsteps; reload clicks;
 * hit/headshot ticks; bomb beeps; explosion; UI blips; per-map ambience (wind, waves + gulls,
 * snowy gusts, fortress birds, city hum) — all generated live, nothing downloaded.
 */
const GUN_SFX = {
  knife: { f: 2600, q: 0.8, dur: 0.12, vol: 0.25, thump: 0, swish: true },
  p9: { f: 3200, q: 0.7, dur: 0.16, vol: 0.55, thump: 110 },
  p12: { f: 1500, q: 0.9, dur: 0.12, vol: 0.35, thump: 80 },
  hc50: { f: 1700, q: 0.6, dur: 0.38, vol: 0.85, thump: 70 },
  viper: { f: 3600, q: 0.7, dur: 0.12, vol: 0.45, thump: 120 },
  krait: { f: 2100, q: 0.6, dur: 0.26, vol: 0.75, thump: 75 },
  vex: { f: 3000, q: 0.7, dur: 0.14, vol: 0.5, thump: 100 },
  wasp: { f: 3300, q: 0.7, dur: 0.12, vol: 0.45, thump: 110 },
  hornet: { f: 3800, q: 0.7, dur: 0.11, vol: 0.42, thump: 120 },
  breacher: { f: 900, q: 0.4, dur: 0.45, vol: 1.0, thump: 60 },
  mauler: { f: 1000, q: 0.45, dur: 0.38, vol: 0.9, thump: 65 },
  titan: { f: 1900, q: 0.55, dur: 0.28, vol: 0.8, thump: 70 },
  falcon: { f: 2300, q: 0.6, dur: 0.22, vol: 0.7, thump: 80 },
  lynx: { f: 2500, q: 0.6, dur: 0.2, vol: 0.65, thump: 85 },
  ranger: { f: 1600, q: 0.5, dur: 0.5, vol: 0.9, thump: 60 },
  sentinel: { f: 2600, q: 0.65, dur: 0.2, vol: 0.62, thump: 90 },
  longshot: { f: 1300, q: 0.5, dur: 0.7, vol: 1.0, thump: 55 }
};

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.7;
    this.noise = null;
    this.ambVol = 0.5;
    this.ambTheme = null;
    this.amb = null;
  }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 5;
    this.master.connect(comp); comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  setListener(pos, fwd) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    if (L.positionX) {
      L.positionX.value = pos[0]; L.positionY.value = pos[1]; L.positionZ.value = pos[2];
      L.forwardX.value = fwd[0]; L.forwardY.value = fwd[1]; L.forwardZ.value = fwd[2];
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(pos[0], pos[1], pos[2]);
      L.setOrientation(fwd[0], fwd[1], fwd[2], 0, 1, 0);
    }
  }
  out(pos) {
    if (!pos) return this.master;
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 3; p.maxDistance = 120; p.rolloffFactor = 1.1;
    if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; }
    else p.setPosition(pos[0], pos[1], pos[2]);
    p.connect(this.master);
    return p;
  }
  noiseBurst(dest, t, dur, f, q, vol, type) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filt = c.createBiquadFilter();
    filt.type = type || 'bandpass'; filt.frequency.value = f; filt.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(dest);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }
  tone(dest, t, f0, f1, dur, vol, type) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }
  shot(weaponId, pos) {
    if (!this.ctx) return;
    const s = GUN_SFX[weaponId] || GUN_SFX.krait;
    const t = this.ctx.currentTime, d = this.out(pos);
    if (s.swish) { this.noiseBurst(d, t, s.dur, s.f, s.q, s.vol, 'highpass'); return; }
    this.noiseBurst(d, t, s.dur, s.f, s.q, s.vol);
    this.noiseBurst(d, t, s.dur * 2.2, 600, 0.5, s.vol * 0.35, 'lowpass');
    if (s.thump) this.tone(d, t, s.thump * 2, s.thump * 0.5, 0.12, s.vol * 0.9);
    if (pos) this.noiseBurst(d, t + 0.05, s.dur * 3, 900, 0.3, s.vol * 0.12, 'lowpass');
  }
  throwNade(pos) { if (this.ctx) this.noiseBurst(this.out(pos), this.ctx.currentTime, 0.18, 1400, 0.6, 0.25, 'bandpass'); }
  nadeBounce(pos) { if (this.ctx) this.tone(this.out(pos), this.ctx.currentTime, 900 + Math.random() * 300, 600, 0.05, 0.25, 'triangle'); }
  heBlast(pos) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, d = this.out(pos);
    this.noiseBurst(d, t, 1.2, 300, 0.4, 1.0, 'lowpass');
    this.noiseBurst(d, t, 0.25, 2500, 0.5, 0.6, 'bandpass');
    this.tone(d, t, 110, 30, 0.6, 0.9, 'sine');
  }
  flashBang(pos, ringSec) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(this.out(pos), t, 0.35, 3500, 0.4, 0.9, 'highpass');
    if (ringSec) this.tone(this.master, t, 3200, 3150, ringSec, 0.12, 'sine');
  }
  smokeHiss(pos) { if (this.ctx) this.noiseBurst(this.out(pos), this.ctx.currentTime, 2.5, 5000, 0.3, 0.35, 'highpass'); }
  pump() { if (this.ctx) { const t = this.ctx.currentTime; this.noiseBurst(this.master, t + 0.15, 0.08, 1100, 2, 0.35); this.noiseBurst(this.master, t + 0.35, 0.07, 1500, 2, 0.3); } }
  dryFire() { if (!this.ctx) return; this.tone(this.master, this.ctx.currentTime, 2200, 1800, 0.03, 0.15, 'square'); }
  footstep(pos, vol) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(this.out(pos), t, 0.07, 500 + Math.random() * 300, 1.2, (vol || 0.25));
  }
  land(vol) { if (this.ctx) this.noiseBurst(this.master, this.ctx.currentTime, 0.12, 300, 0.8, vol || 0.3); }
  reload(kind) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, d = this.master;
    const step = kind === 'pistol' ? 0.6 : 1;
    this.noiseBurst(d, t + 0.25 * step, 0.05, 2500, 3, 0.25);
    this.noiseBurst(d, t + 0.9 * step, 0.06, 1800, 3, 0.3);
    this.noiseBurst(d, t + 1.6 * step, 0.08, 1400, 2, 0.35);
  }
  draw() { if (this.ctx) this.noiseBurst(this.master, this.ctx.currentTime, 0.08, 3000, 2, 0.15); }
  hit(head) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (head) { this.tone(this.master, t, 1800, 1700, 0.18, 0.25, 'triangle'); this.tone(this.master, t, 2700, 2600, 0.12, 0.12, 'sine'); }
    else this.tone(this.master, t, 900, 700, 0.06, 0.2, 'square');
  }
  kill() { if (this.ctx) { const t = this.ctx.currentTime; this.tone(this.master, t, 660, 660, 0.1, 0.2, 'triangle'); this.tone(this.master, t + 0.08, 990, 990, 0.14, 0.2, 'triangle'); } }
  hurt() { if (this.ctx) this.noiseBurst(this.master, this.ctx.currentTime, 0.15, 350, 0.7, 0.45, 'lowpass'); }
  beep(pos, urgent) { if (this.ctx) this.tone(this.out(pos), this.ctx.currentTime, urgent ? 1650 : 1450, urgent ? 1650 : 1450, 0.09, 0.4, 'sine'); }
  plantTick() { if (this.ctx) this.tone(this.master, this.ctx.currentTime, 1200, 1200, 0.05, 0.12, 'square'); }
  explosion(pos) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, d = this.out(pos);
    this.noiseBurst(d, t, 2.4, 220, 0.4, 1.0, 'lowpass');
    this.noiseBurst(d, t, 0.6, 1200, 0.5, 0.6, 'lowpass');
    this.tone(d, t, 90, 25, 1.2, 1.0, 'sine');
  }
  ui(ok) { if (this.ctx) this.tone(this.master, this.ctx.currentTime, ok === false ? 260 : 820, ok === false ? 200 : 980, 0.08, 0.15, 'triangle'); }
  roundStart() { if (this.ctx) { const t = this.ctx.currentTime; [523, 659, 784].forEach((f, i) => this.tone(this.master, t + i * 0.09, f, f, 0.18, 0.18, 'triangle')); } }
  // ---------------------------------------------------------------- new grenades
  molotovBurst(pos) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, d = this.out(pos);
    this.noiseBurst(d, t, 0.18, 3000, 0.8, 0.6, 'highpass');                // glass
    this.tone(d, t, 2400, 1800, 0.08, 0.15, 'triangle');
    this.noiseBurst(d, t + 0.05, 1.2, 500, 0.5, 0.7, 'lowpass');              // whoosh
  }
  fireCrackle(pos) { if (this.ctx) this.noiseBurst(this.out(pos), this.ctx.currentTime, 0.05 + Math.random() * 0.08, 1500 + Math.random() * 2500, 2, 0.12 + Math.random() * 0.1); }
  fireOut(pos) { if (this.ctx) this.noiseBurst(this.out(pos), this.ctx.currentTime, 1.0, 4000, 0.4, 0.4, 'highpass'); }
  c4Stick(pos) { if (this.ctx) { const t = this.ctx.currentTime, d = this.out(pos); this.tone(d, t, 300, 200, 0.06, 0.4, 'square'); this.tone(d, t + 0.25, 1800, 1800, 0.05, 0.25, 'sine'); this.tone(d, t + 0.75, 1800, 1800, 0.05, 0.25, 'sine'); this.tone(d, t + 1.2, 2200, 2200, 0.05, 0.3, 'sine'); } }
  breachBlast(pos) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, d = this.out(pos);
    this.noiseBurst(d, t, 1.6, 260, 0.4, 1.0, 'lowpass');
    this.noiseBurst(d, t + 0.02, 0.9, 900, 0.5, 0.7, 'bandpass');               // debris
    this.tone(d, t, 120, 28, 0.9, 1.0, 'sine');
  }
  levelUp() { if (this.ctx) { const t = this.ctx.currentTime; [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(this.master, t + i * 0.08, f, f, 0.25, 0.2, 'triangle')); } }
  coin() { if (this.ctx) { const t = this.ctx.currentTime; this.tone(this.master, t, 1318, 1318, 0.08, 0.18, 'square'); this.tone(this.master, t + 0.07, 1760, 1760, 0.16, 0.18, 'square'); } }

  // ---------------------------------------------------------------- ambience
  setAmbienceVolume(v) { this.ambVol = v; if (this.amb) this.amb.gain.gain.setTargetAtTime(v * 0.5, this.ctx.currentTime, 0.3); }
  /** theme: 'desert' | 'harbor' | 'snow' | 'fortress' | 'city' | null (stop) */
  ambience(theme) {
    if (!this.ctx || theme === this.ambTheme) return;
    this.ambTheme = theme;
    const c = this.ctx;
    if (this.amb) {
      const old = this.amb;
      old.gain.gain.setTargetAtTime(0.0001, c.currentTime, 0.4);
      setTimeout(() => { old.nodes.forEach((n) => { try { n.stop ? n.stop() : n.disconnect(); } catch (e) { /* ignore */ } }); clearInterval(old.timer); }, 2000);
      this.amb = null;
    }
    if (!theme) return;
    const gain = c.createGain();
    gain.gain.value = 0.0001;
    gain.gain.setTargetAtTime(this.ambVol * 0.5, c.currentTime, 1.2);
    gain.connect(this.master);
    const nodes = [];
    const loopNoise = (type, f, q, vol, lfoHz, lfoDepth) => {
      const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true; src.playbackRate.value = 0.6;
      const filt = c.createBiquadFilter(); filt.type = type; filt.frequency.value = f; filt.Q.value = q;
      const g = c.createGain(); g.gain.value = vol;
      src.connect(filt); filt.connect(g); g.connect(gain);
      if (lfoHz) {
        const lfo = c.createOscillator(); lfo.frequency.value = lfoHz;
        const lg = c.createGain(); lg.gain.value = lfoDepth;
        lfo.connect(lg); lg.connect(g.gain); lfo.start(); nodes.push(lfo);
        const lfo2 = c.createOscillator(); lfo2.frequency.value = lfoHz * 0.37;
        const lg2 = c.createGain(); lg2.gain.value = f * 0.35;
        lfo2.connect(lg2); lg2.connect(filt.frequency); lfo2.start(); nodes.push(lfo2);
      }
      src.start(); nodes.push(src, filt, g);
    };
    let events = null;
    if (theme === 'desert') { loopNoise('bandpass', 520, 0.6, 0.22, 0.07, 0.12); events = () => this.tone(gain, c.currentTime, 2400, 2100, 0.12, 0.05, 'sine'); }
    else if (theme === 'harbor') {
      loopNoise('lowpass', 420, 0.5, 0.3, 0.11, 0.22);           // waves
      events = () => { const t = c.currentTime, f = 1700 + Math.random() * 500; this.tone(gain, t, f, f * 0.7, 0.25, 0.06, 'triangle'); this.tone(gain, t + 0.3, f * 1.05, f * 0.6, 0.3, 0.05, 'triangle'); };
    } else if (theme === 'snow') { loopNoise('highpass', 1400, 0.4, 0.12, 0.09, 0.1); loopNoise('bandpass', 300, 0.7, 0.12, 0.05, 0.08); }
    else if (theme === 'fortress') {
      loopNoise('bandpass', 380, 0.5, 0.14, 0.06, 0.08);
      events = () => { const t = c.currentTime, f = 2800 + Math.random() * 1200; for (let i = 0; i < 3; i++) this.tone(gain, t + i * 0.11, f, f * 1.15, 0.07, 0.05, 'sine'); };
    } else if (theme === 'city') {
      const hum = c.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 55;
      const hf = c.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 160;
      const hg = c.createGain(); hg.gain.value = 0.05;
      hum.connect(hf); hf.connect(hg); hg.connect(gain); hum.start(); nodes.push(hum);
      loopNoise('lowpass', 260, 0.5, 0.18, 0.04, 0.1);           // distant traffic
      events = () => this.noiseBurst(gain, c.currentTime, 1.8, 600 + Math.random() * 400, 0.6, 0.06, 'bandpass');
    }
    const timer = events ? setInterval(() => { if (Math.random() < 0.35) events(); }, 2500) : null;
    this.amb = { gain, nodes, timer };
  }

  roundEnd(win) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = win ? [523, 659, 784, 1046] : [392, 349, 311, 262];
    notes.forEach((f, i) => this.tone(this.master, t + i * 0.13, f, f, 0.3, 0.22, 'triangle'));
  }
}
