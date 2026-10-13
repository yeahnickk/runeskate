// MineScape's sounds, synthesised (no samples): dig/step/place per material (grass, stone, wood, gravel, sand, cloth,
// glass), item pops, XP orb dings, hurt, eating, bows, doors, explosions, UI clicks, and a sparse calm piano in the
// background like C418's.
import { BLOCKS } from './blocks.js'

export class Sfx {
  constructor() { this.ctx = null; this.vol = 0.8; this.music = true; this.nextNote = 0 }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return }
    const C = window.AudioContext || window.webkitAudioContext
    if (!C) return
    this.ctx = new C()
    this.out = this.ctx.createGain(); this.out.gain.value = this.vol; this.out.connect(this.ctx.destination)
    const n = this.ctx.sampleRate, b = this.noiseBuf = this.ctx.createBuffer(1, n, n), d = b.getChannelData(0)
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
  }
  setVol(v) { this.vol = v; if (this.out) this.out.gain.value = v }
  // a filtered noise burst
  noise(dur, f, q, g, type = 'bandpass', at = 0, sweep) {
    const c = this.ctx; if (!c) return
    const t = c.currentTime + at, s = c.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 0.8 + Math.random() * 0.4
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q
    if (sweep) fl.frequency.exponentialRampToValueAtTime(sweep, t + dur)
    const gn = c.createGain(); gn.gain.setValueAtTime(g, t); gn.gain.exponentialRampToValueAtTime(0.001, t + dur)
    s.connect(fl).connect(gn).connect(this.out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05)
  }
  tone(f, dur, g, type = 'sine', at = 0, f2) {
    const c = this.ctx; if (!c) return
    const t = c.currentTime + at, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t)
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur)
    const gn = c.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(gn).connect(this.out); o.start(t); o.stop(t + dur + 0.05)
  }
  // material sounds: kind 'dig' (break), 'hit' (mining ticks), 'step', 'place'
  block(id, kind, dist = 0) {
    const d = BLOCKS[id]; if (!d) return
    const m = d.snd, k = kind === 'step' ? 0.35 : kind === 'hit' ? 0.3 : 0.7, a = Math.max(0, 1 - dist / 16) * k
    if (a <= 0) return
    const dur = kind === 'step' ? 0.12 : kind === 'hit' ? 0.1 : 0.22
    if (m === 'grass') this.noise(dur, 2400, 0.6, a * 0.7, 'highpass')
    else if (m === 'stone') { this.noise(dur, 900, 1.2, a, 'bandpass'); this.noise(dur * 0.5, 3000, 2, a * 0.4) }
    else if (m === 'wood') { this.noise(dur, 420, 3, a * 1.1, 'bandpass'); this.tone(160 + Math.random() * 40, dur, a * 0.25, 'triangle') }
    else if (m === 'gravel') this.noise(dur * 1.2, 1300, 0.5, a * 0.9, 'bandpass')
    else if (m === 'sand') this.noise(dur * 1.3, 3200, 0.4, a * 0.6, 'highpass')
    else if (m === 'cloth') this.noise(dur, 800, 0.3, a * 0.5, 'lowpass')
    else if (m === 'glass') { this.tone(2400 + Math.random() * 600, 0.25, a * 0.25, 'triangle'); this.noise(0.25, 5000, 1, a * 0.5, 'highpass') }
  }
  play(n, dist = 0) {
    const a = Math.max(0, 1 - dist / 24)
    if (!this.ctx || a <= 0) return
    const r = Math.random
    switch (n) {
      case 'pop': this.tone(500 + r() * 300, 0.08, 0.18 * a, 'sine', 0, 1200 + r() * 400); break
      case 'orb': this.tone(1400 + r() * 900, 0.35, 0.12, 'sine'); this.tone(2100 + r() * 900, 0.3, 0.06, 'sine', 0.02); break
      case 'levelup': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.4, 0.15, 'triangle', i * 0.09)); break
      case 'hurt': this.tone(220, 0.18, 0.35, 'square', 0, 120); this.noise(0.12, 600, 1, 0.2); break
      case 'eat': this.noise(0.09, 1800, 1.5, 0.35 * a); break
      case 'burp': this.tone(140, 0.3, 0.25, 'sawtooth', 0, 90); break
      case 'bow': this.noise(0.3, 1200, 0.8, 0.4 * a, 'bandpass', 0, 300); break
      case 'arrow_hit': this.noise(0.08, 700, 2, 0.4 * a); break
      case 'fuse': this.noise(1.4, 4000, 0.5, 0.25 * a, 'highpass'); break
      case 'boom': this.noise(1.6, 300, 0.4, 1.1 * a, 'lowpass', 0, 60); this.noise(0.5, 1200, 0.3, 0.5 * a); break
      case 'fall': this.noise(0.2, 300, 1, 0.5); break
      case 'door_open': case 'door_close': this.noise(0.15, 500, 3, 0.5 * a); this.tone(120, 0.15, 0.2 * a, 'triangle'); break
      case 'click': this.tone(1000, 0.04, 0.15, 'square'); break
      case 'break_tool': this.noise(0.25, 2500, 4, 0.5); this.tone(1800, 0.2, 0.15, 'square', 0, 600); break
      case 'bucket': this.noise(0.3, 700, 0.7, 0.4, 'lowpass'); break
      case 'ignite': this.noise(0.12, 3000, 2, 0.35 * a, 'highpass'); this.noise(0.4, 900, 0.6, 0.2 * a, 'bandpass', 0.05); break
      case 'crackle': this.noise(0.05 + r() * 0.08, 1500 + r() * 2500, 2, 0.12 * a, 'bandpass'); break
      case 'lava_pop': this.tone(180 + r() * 120, 0.08, 0.12 * a, 'sine', 0, 60); break
      case 'fizz': this.noise(0.5, 4000, 1, 0.3 * a, 'highpass'); break
      case 'till': this.noise(0.15, 900, 0.6, 0.5); break
      case 'splash': this.noise(0.5, 900, 0.4, 0.5 * a, 'lowpass', 0, 3000); break
      case 'villager': [0, 0.12].forEach((t, i) => this.tone(240 + r() * 60 - i * 40, 0.14, 0.2 * a, 'sawtooth', t, 180)); break
      case 'chest': this.noise(0.25, 300, 2, 0.4 * a); break
      default:
        if (n.startsWith('hurt_') || n.startsWith('death_')) {
          const m = n.split('_')[1], death = n.startsWith('death')
          const f = { cow: 110, pig: 280, sheep: 330, chicken: 900, zombie: 120, skeleton: 600, creeper: 200, spider: 300, villager: 220 }[m] || 300
          if (m === 'skeleton') { this.noise(0.15, 2000, 4, 0.4 * a); this.tone(f, 0.1, 0.1 * a, 'square') }
          else this.tone(f * (1 + r() * 0.2), death ? 0.5 : 0.22, 0.3 * a, m === 'zombie' || m === 'cow' ? 'sawtooth' : 'square', 0, f * 0.7)
        }
    }
  }
  // sparse calm piano: a note every few seconds from a pentatonic, sometimes a little phrase
  tickMusic(now, night) {
    if (!this.ctx || !this.music || now < this.nextNote) return
    const scale = night ? [220, 246.9, 293.7, 329.6, 392, 440] : [261.6, 293.7, 329.6, 392, 440, 523.3, 587.3]
    const n = 1 + (Math.random() * 3 | 0)
    for (let i = 0; i < n; i++) {
      const f = scale[(Math.random() * scale.length) | 0] * (Math.random() < 0.2 ? 0.5 : 1)
      this.tone(f, 2.6, 0.045, 'triangle', i * 0.55); this.tone(f * 2, 1.4, 0.012, 'sine', i * 0.55)
    }
    this.nextNote = now + 3 + Math.random() * 9
  }
}
