// CODScape's sounds, made on the spot with Web Audio (no files): each gun class has its own report (a noise
// crack through a filter + a low thump + a tail that rings off the castle walls), sniper rounds crack and
// echo, distant shots are duller and quieter, reloads click and clack, the hitmarker ticks, footsteps scuff.
export class Sfx {
  constructor() { this.ctx = null; this.vol = 0.8; }
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    this.ctx = new C();
    this.out = this.ctx.createGain(); this.out.gain.value = this.vol;
    const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    this.out.connect(comp).connect(this.ctx.destination);
    // one second of white noise, reused by every burst
    const n = this.ctx.sampleRate, b = this.ctx.createBuffer(1, n, n), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noise = b;
    // a short room tail for the castle walls
    const L = n * 0.9, ir = this.ctx.createBuffer(2, L, n);
    for (let c = 0; c < 2; c++) { const x = ir.getChannelData(c); for (let i = 0; i < L; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / L, 3.2) * 0.6; }
    this.verb = this.ctx.createConvolver(); this.verb.buffer = ir;
    this.verbGain = this.ctx.createGain(); this.verbGain.gain.value = 0.35; this.verb.connect(this.verbGain).connect(this.out);
  }
  setVolume(v) { this.vol = v; if (this.out) this.out.gain.value = v; }
  get ok() { return !!this.ctx && this.ctx.state === 'running'; }

  /** a filtered noise burst: f (Hz), dur (s), vol, type, q, pan, wet (into the room) */
  burst(f, dur, vol, type = 'lowpass', q = 1, pan = 0, wet = 0.3, at = 0) {
    if (!this.ok || vol < 0.003) return;
    const c = this.ctx, t = c.currentTime + at, s = c.createBufferSource(); s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    s.connect(fl).connect(g); if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(this.out); if (wet) { const wg = c.createGain(); wg.gain.value = wet; p.connect(wg).connect(this.verb); } } else g.connect(this.out);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  tone(f0, f1, dur, vol, type = 'sine', pan = 0, at = 0) {
    if (!this.ok || vol < 0.003) return;
    const c = this.ctx, t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    o.connect(g); if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p).connect(this.out); } else g.connect(this.out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /** a gunshot of a kind; dist 0 = yours. pan -1..1 */
  shot(kind, dist = 0, pan = 0, suppressed = false) {
    const far = Math.min(1, dist / 90), v = (dist ? 0.55 / (1 + dist * 0.05) : 1) * (suppressed ? 0.35 : 1), dull = 1 - far * 0.75;
    const K = {
      rifle: [2600, 0.11, 140, 0.16], rifleHeavy: [1900, 0.14, 110, 0.2], smg: [3200, 0.08, 170, 0.12], smgHeavy: [2400, 0.1, 140, 0.14],
      sniper: [1500, 0.3, 70, 0.45], shotgun: [1300, 0.24, 80, 0.35], pistol: [2900, 0.09, 160, 0.12], magnum: [1700, 0.18, 95, 0.25],
    }[kind] || [2400, 0.1, 140, 0.15];
    this.burst(K[0] * dull, K[1], 0.75 * v, 'lowpass', 0.7, pan, 0.25 + far * 0.5);
    this.burst(K[0] * 2.2 * dull, K[1] * 0.4, 0.4 * v * dull, 'highpass', 0.5, pan, 0.1);           // the crack
    this.tone(K[2] * 1.6, K[2] * 0.5, K[3], 0.55 * v, 'sine', pan);                                    // the thump
    if (kind === 'sniper' || kind === 'magnum') this.burst(700 * dull, 0.9, 0.18 * v, 'bandpass', 0.6, pan, 0.8, 0.06);   // echo off the castles
  }
  // the hands
  click(f = 3000, vol = 0.25, at = 0) { this.burst(f, 0.03, vol, 'bandpass', 4, 0, 0, at); }
  magOut() { this.click(1800, 0.3); this.burst(900, 0.08, 0.15, 'bandpass', 2, 0, 0, 0.02); }
  magIn() { this.click(2200, 0.4); this.click(1400, 0.35, 0.05); }
  bolt() { this.click(2600, 0.35); this.click(1700, 0.3, 0.09); this.burst(1200, 0.06, 0.2, 'bandpass', 3, 0, 0, 0.05); }
  pump() { this.burst(900, 0.07, 0.35, 'bandpass', 2); this.burst(1300, 0.07, 0.35, 'bandpass', 2, 0, 0, 0.16); }
  shell() { this.click(2400, 0.22); this.burst(600, 0.05, 0.15, 'bandpass', 2, 0, 0, 0.02); }
  dry() { this.click(4200, 0.25); }
  swap() { this.burst(1500, 0.12, 0.12, 'bandpass', 1.2); this.click(2000, 0.2, 0.1); }
  knife() { this.burst(3500, 0.15, 0.3, 'highpass', 0.7); }
  pin() { this.click(5200, 0.25); this.tone(4800, 4000, 0.08, 0.06, 'triangle', 0, 0.03); }
  hitmarker(kill) { this.tone(kill ? 1700 : 2400, kill ? 1500 : 2300, 0.05, 0.22, 'square'); if (kill) this.tone(1100, 900, 0.12, 0.2, 'square', 0, 0.05); }
  headshot() { this.tone(3200, 2800, 0.06, 0.18, 'triangle'); }
  hurt() { this.burst(400, 0.12, 0.35, 'lowpass', 1); this.tone(120, 70, 0.15, 0.3); }
  boom(dist = 0, pan = 0) { const v = 1 / (1 + dist * 0.06); this.burst(500, 1.2, 0.9 * v, 'lowpass', 0.5, pan, 0.8); this.tone(80, 30, 0.8, 0.9 * v, 'sine', pan); this.burst(2500, 0.3, 0.3 * v, 'highpass', 0.5, pan, 0.4); }
  bounce() { this.click(900, 0.15); }
  step(surface = 0, vol = 0.12, pan = 0) { this.burst(surface ? 900 : 500, 0.07, vol, 'lowpass', 1, pan, 0.05); }
  land(k) { this.burst(400, 0.14, 0.25 * k + 0.08, 'lowpass', 1); }
  // the RS touches: the level-up jingle on a killstreak, the "oh dear" on death, the flag fanfare
  jingle() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.18, 0.18, 'square', 0, i * 0.11)); }
  dead() { [392, 330, 262].forEach((f, i) => this.tone(f, f * 0.98, 0.28, 0.16, 'triangle', 0, i * 0.22)); }
  flag(good) { (good ? [659, 784, 988, 1319] : [494, 440, 370, 330]).forEach((f, i) => this.tone(f, f, 0.16, 0.16, 'square', 0, i * 0.12)); }
  whizz(pan) { this.burst(3000, 0.12, 0.2, 'bandpass', 2, pan, 0); }
}
