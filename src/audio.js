// Procedural skate sounds (WebAudio, no files): wheel roll, pop, land, grind scrape, bail, splash.
export class SkateAudio {
  constructor() { this.ctx = null; }
  start() {
    if (this.ctx) return;
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
  update(sk) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rolling = sk.mode === 'ground' ? Math.min(1, sk.speed / 8) : 0;
    this.roll.g.gain.setTargetAtTime(rolling * (sk.slide ? 0.25 : 0.45), t, 0.05);
    this.roll.f.frequency.setTargetAtTime(250 + sk.speed * 55 + (sk.slide ? 900 : 0), t, 0.05);
    const gr = sk.mode === 'grind' ? 0.35 : 0;
    this.grind.g.gain.setTargetAtTime(gr, t, 0.03);
    this.grind.f.frequency.setTargetAtTime(2200 + (sk.railSpeed || 0) * 90, t, 0.05);
  }
  event(e) {
    switch (e.type) {
      case 'pop': this.burst(3000, 0.06, 0.9, 'highpass'); this.tone(180, 70, 0.08, 0.35); break;
      case 'flip': this.burst(1800, 0.05, 0.3, 'bandpass', 3); break;
      case 'land': this.burst(900, 0.12, Math.min(1, 0.4 + e.impact / 12)); this.tone(120, 50, 0.1, 0.3); break;
      case 'grind': this.burst(4000, 0.08, 0.7, 'highpass'); break;
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
    }
  }
}
