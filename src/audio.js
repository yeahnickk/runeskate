// Procedural skate sounds (WebAudio, no files): wheel roll per surface, pop, land, grind scrape per material,
// bail, splash. Surfaces: the roll changes colour and the wheels click over cobble joints and plank gaps at a
// rate set by speed. Plus gamepad rumble.
// surface -> roll filter (freq, Q, gain), joint spacing (tiles, 0 = smooth) and the joint click's filter
const SURF = {
  stone: { f: 520, q: 0.9, g: 0.5, gap: 0.5, cf: 1700, cq: 2.5, cv: 0.16 },
  wood: { f: 330, q: 2.2, g: 0.55, gap: 0.33, cf: 520, cq: 6, cv: 0.26 },
  grass: { f: 170, q: 0.7, g: 0.32, gap: 0, cf: 0, cq: 1, cv: 0 },
  dirt: { f: 900, q: 0.6, g: 0.4, gap: 0, cf: 0, cq: 1, cv: 0 },
  sand: { f: 1900, q: 0.5, g: 0.3, gap: 0, cf: 0, cq: 1, cv: 0 },
};
const GRIND = { metal: { f: 2900, q: 9, g: 0.4 }, wood: { f: 900, q: 3, g: 0.45 }, stone: { f: 1500, q: 1.4, g: 0.5 } };
export class SkateAudio {
  constructor() { this.ctx = null; this.surface = 'stone'; this.dist = 0; this.pad = null; }
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }   // iOS suspends it when the app goes to the background
    const C = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = C.createGain(); this.master.gain.value = 0.55; this.master.connect(C.destination);
    const len = C.sampleRate * 2, buf = C.createBuffer(1, len, C.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // continuous wheel roll
    this.roll = this.loop(400, 0.9, 'lowpass');
    // grind scrape (bandpass, metallic)
    this.grind = this.loop(2600, 6, 'bandpass');
  }
  loop(freq, q, type) {
    const C = this.ctx, src = C.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = C.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = C.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
    return { f, g };
  }
  burst(freq, dur, vol, type = 'lowpass', q = 1) {
    if (!this.ctx) return;
    const C = this.ctx, t = C.currentTime, src = C.createBufferSource(); src.buffer = this.noise;
    const f = C.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = C.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }
  tone(f0, f1, dur, vol, type = 'square') {
    if (!this.ctx) return;
    const C = this.ctx, t = C.currentTime, o = C.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = C.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  update(sk, dt = 1 / 60) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, S = SURF[this.surface] || SURF.stone;
    const rolling = sk.mode === 'ground' ? Math.min(1, sk.speed / 8) : 0;
    this.roll.g.gain.setTargetAtTime(rolling * S.g * (sk.slide ? 0.6 : 1), t, 0.06);
    this.roll.f.frequency.setTargetAtTime(S.f * (0.6 + sk.speed * 0.06) + (sk.slide ? 900 : 0), t, 0.06);
    this.roll.f.Q.setTargetAtTime(S.q, t, 0.1);
    // wheels over joints: a click every `gap` tiles travelled
    if (sk.mode === 'ground' && S.gap && sk.speed > 0.6) {
      this.dist += sk.speed * dt;
      if (this.dist > S.gap) { this.dist %= S.gap; this.burst(S.cf * (0.9 + Math.random() * 0.2), 0.035, S.cv * Math.min(1, sk.speed / 6), 'bandpass', S.cq); }
    }
    const G = GRIND[sk.rail?.mat] || GRIND.metal;
    const gr = sk.mode === 'grind' ? G.g : 0;
    this.grind.g.gain.setTargetAtTime(gr, t, 0.03);
    this.grind.f.frequency.setTargetAtTime(G.f + (sk.railSpeed || 0) * 60, t, 0.05);
    this.grind.f.Q.setTargetAtTime(G.q, t, 0.05);
    if (sk.mode === 'grind') this.rumble(0.05, 0.12, 0, 70);
  }
  /** gamepad rumble (no-op without a pad that supports it) */
  rumble(strong, weak, _x, ms) {
    const pad = this.pad; const a = pad?.vibrationActuator;
    if (!a || this._rumbleUntil > performance.now()) return;
    this._rumbleUntil = performance.now() + ms * 0.8;
    try { a.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }); } catch {}
  }
  event(e) {
    // rumble first (it works without the audio context)
    switch (e.type) {
      case 'pop': this._rumbleUntil = 0; this.rumble(0.1, 0.45, 0, 80); break;
      case 'land': this._rumbleUntil = 0; this.rumble(Math.min(1, (e.impact || 4) / 12), 0.3, 0, 120); break;
      case 'bail': case 'broke': this._rumbleUntil = 0; this.rumble(1, 0.8, 0, e.type === 'bail' ? 380 : 220); break;
      case 'bump': this.rumble(Math.min(0.8, (e.impact || 4) / 14), 0.3, 0, 90); break;
      case 'grind': this._rumbleUntil = 0; this.rumble(0.3, 0.5, 0, 90); break;
    }
    switch (e.type) {
      case 'pop': this.burst(3000, 0.06, 0.9, 'highpass'); this.tone(180, 70, 0.08, 0.35); break;
      case 'flip': this.burst(1800, 0.05, 0.3, 'bandpass', 3); break;
      case 'land': this.burst(900, 0.12, Math.min(1, 0.4 + e.impact / 12)); this.tone(120, 50, 0.1, 0.3); break;
      case 'grind': { const G = GRIND[e.mat] || GRIND.metal; this.burst(G.f * 1.3, 0.08, 0.7, 'bandpass', G.q * 0.5); break; }
      case 'bail': this.burst(500, 0.35, 1.0); this.tone(110, 40, 0.3, 0.5, 'sawtooth'); break;
      case 'clack': this.burst(2400, 0.05, 0.35, 'bandpass', 4); break;
      case 'bump': this.burst(500, 0.08, Math.min(0.3, 0.08 + (e.impact || 0) * 0.03)); break;
      case 'splash': this.burst(1200, 0.9, 0.9, 'lowpass'); this.burst(300, 1.2, 0.6); break;
      case 'push': this.burst(260, 0.1, 0.25); break;
      case 'smack': this.tone(220, 60, 0.18, 0.5); this.burst(1500, 0.15, 0.8, 'bandpass', 2); break;
      case 'banked': this.tone(660, 990, 0.12, 0.15, 'triangle'); break;
      case 'rune': this.tone(880, 1760, 0.18, 0.18, 'sine'); this.tone(1320, 2640, 0.25, 0.1, 'sine'); break;
      case 'manual': case 'grab': this.burst(1800, 0.05, 0.12, 'highpass'); break;
      case 'levelup': this.tone(523, 1046, 0.5, 0.25, 'triangle'); this.tone(659, 1318, 0.6, 0.18, 'triangle'); break;
      case 'stomp': this.tone(300, 80, 0.2, 0.5); this.burst(900, 0.2, 0.9); break;
      // battle royale (src/br.js); v = loudness by distance
      case 'shot': {
        const v = e.v ?? 1, w = e.w;
        if (w === 'smg') { this.burst(2600, 0.07, 0.5 * v, 'bandpass', 2); this.tone(900, 300, 0.05, 0.12 * v, 'triangle'); }
        else if (w === 'ar') { this.burst(1400, 0.1, 0.8 * v, 'bandpass', 1.5); this.tone(220, 70, 0.08, 0.3 * v); }
        else if (w === 'shotgun') { this.burst(700, 0.3, 1.0 * v); this.tone(160, 40, 0.25, 0.4 * v, 'sawtooth'); }
        else if (w === 'sniper') { this.burst(1100, 0.5, 1.0 * v); this.tone(300, 50, 0.35, 0.45 * v, 'sawtooth'); }
        else if (w === 'rocket') { this.burst(500, 0.6, 0.7 * v); this.tone(140, 260, 0.5, 0.2 * v, 'sawtooth'); }
        else this.burst(1600, 0.08, 0.4 * v, 'bandpass', 3);
        break;
      }
      case 'boom': this.burst(240, 1.2, Math.min(1, e.v ?? 1)); this.tone(90, 30, 0.9, 0.6 * (e.v ?? 1), 'sawtooth'); break;
      case 'hitmark': this.tone(e.hd ? 1900 : 1400, e.hd ? 2400 : 1500, 0.06, 0.18, 'square'); break;
      case 'hurt': this.tone(200, 90, 0.18, 0.35, 'sawtooth'); this.burst(600, 0.12, 0.5); break;
      case 'shieldhit': this.tone(1200, 500, 0.12, 0.2, 'triangle'); break;
      case 'build': this.burst(900, 0.09, 0.5, 'bandpass', 2); this.tone(260, 140, 0.07, 0.2, 'square'); break;
      case 'chop': this.burst(e.mat === 'stone' ? 2200 : e.mat === 'metal' ? 3400 : 1200, 0.1, 0.6, 'bandpass', 4); break;
      case 'crumble': this.burst(350, 0.7, 0.8); this.burst(1600, 0.3, 0.3, 'bandpass', 2); break;
      case 'chest': this.tone(784, 1568, 0.3, 0.2, 'triangle'); this.tone(988, 1976, 0.4, 0.15, 'sine'); break;
      case 'pickup': this.tone(660, 880, 0.08, 0.15, 'triangle'); break;
      case 'reload': this.burst(2800, 0.04, 0.3, 'bandpass', 6); this.burst(1900, 0.05, 0.3, 'bandpass', 6); break;
      case 'eat': this.burst(800, 0.15, 0.3, 'bandpass', 3); break;
      case 'elim': this.tone(440, 880, 0.15, 0.25, 'triangle'); this.tone(660, 1320, 0.3, 0.2, 'triangle'); break;
      case 'glide': this.burst(400, 0.4, 0.4); break;
      case 'victory': for (const [a, b, d] of [[523, 523, 0.3], [659, 659, 0.45], [784, 1568, 0.9]]) this.tone(a, b, d, 0.22, 'triangle'); break;
    }
  }
}
