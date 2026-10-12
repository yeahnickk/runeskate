// CartScape's HUD in RuneScape's clothes: RS bitmap fonts on brown stone panels. The lap and the clock top left, the
// item slot top centre (it spins like a slot machine when you hit a box), the standings down the left, the place big
// bottom right, the minimap bottom left, the countdown and the shouts ("FINAL LAP!") in the middle.
import { ITEMS } from './race.js';
import { THEMES } from './models.js';

const PANEL = 'rgba(62,53,41,0.86)', EDGE = '#2b2117', LIGHT = '#7a6a4c';
const ORD = n => n + (n % 10 === 1 && n !== 11 ? 'ST' : n % 10 === 2 && n !== 12 ? 'ND' : n % 10 === 3 && n !== 13 ? 'RD' : 'TH');
const PLACE_COL = ['#ffd700', '#e8e8f0', '#e09040', '#ff981f'];
export const clock = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`; };
const hex = c => '#' + c.toString(16).padStart(6, '0');

// ---------------------------------------------------------------- item icons, drawn RS-chunky (cached per size)
const icons = new Map();
export function itemIcon(it, S) {
  const key = it + S; if (icons.has(key)) return icons.get(key);
  const c = Object.assign(document.createElement('canvas'), { width: S, height: S }), x = c.getContext('2d'), u = S / 32;
  x.lineJoin = 'round'; x.lineWidth = Math.max(1, u * 1.2); x.strokeStyle = '#000';
  const vial = (cx, cy, k, liquid) => {
    x.save(); x.translate(cx, cy); x.scale(k, k);
    x.fillStyle = '#c8d8e0'; x.beginPath(); x.moveTo(-3 * u, -11 * u); x.lineTo(3 * u, -11 * u); x.lineTo(3 * u, -5 * u); x.lineTo(8 * u, 1 * u); x.lineTo(8 * u, 9 * u); x.lineTo(-8 * u, 9 * u); x.lineTo(-8 * u, 1 * u); x.lineTo(-3 * u, -5 * u); x.closePath(); x.fill(); x.stroke();
    x.fillStyle = liquid; x.fillRect(-7 * u, 0, 14 * u, 8 * u); x.fillStyle = 'rgba(255,255,255,0.5)'; x.fillRect(-5 * u, 1 * u, 2 * u, 5 * u);
    x.fillStyle = '#7a5228'; x.fillRect(-3.5 * u, -14 * u, 7 * u, 4 * u); x.strokeRect(-3.5 * u, -14 * u, 7 * u, 4 * u); x.restore();
  };
  const rune = (col, draw) => {
    x.fillStyle = '#8a8478'; x.beginPath(); x.ellipse(16 * u, 16 * u, 12 * u, 11 * u, 0.2, 0, 7); x.fill(); x.stroke();
    x.fillStyle = '#a8a294'; x.beginPath(); x.ellipse(15 * u, 14 * u, 9 * u, 8 * u, 0.2, 0, 7); x.fill();
    x.fillStyle = col; x.strokeStyle = col; x.lineWidth = 2.4 * u; draw(); x.strokeStyle = '#000'; x.lineWidth = Math.max(1, u * 1.2);
  };
  if (it === 'energy') vial(16 * u, 18 * u, 1, '#c87a3a');
  else if (it === 'energy3') { vial(9 * u, 20 * u, 0.62, '#b83ac8'); vial(23 * u, 20 * u, 0.62, '#b83ac8'); vial(16 * u, 12 * u, 0.62, '#b83ac8'); }
  else if (it === 'overload') { vial(16 * u, 18 * u, 1, '#3a3a3a'); x.fillStyle = '#7aff6a'; for (const [a, b] of [[8, 8], [25, 6], [26, 22], [5, 24]]) x.fillRect(a * u, b * u, 2 * u, 2 * u); }
  else if (it === 'banana') { x.fillStyle = '#f4d020'; x.beginPath(); x.moveTo(5 * u, 8 * u); x.quadraticCurveTo(10 * u, 28 * u, 28 * u, 22 * u); x.quadraticCurveTo(12 * u, 22 * u, 9 * u, 6 * u); x.closePath(); x.fill(); x.stroke(); x.fillStyle = '#5a4a10'; x.fillRect(4 * u, 4 * u, 4 * u, 4 * u); }
  else if (it === 'wind') rune('#f0f0f0', () => { x.beginPath(); x.arc(16 * u, 15 * u, 5 * u, 0.5, 5.5); x.stroke(); x.beginPath(); x.moveTo(8 * u, 21 * u); x.lineTo(22 * u, 21 * u); x.stroke(); });
  else if (it === 'fire') rune('#ff4a10', () => { x.beginPath(); x.moveTo(16 * u, 6 * u); x.quadraticCurveTo(24 * u, 14 * u, 20 * u, 22 * u); x.lineTo(12 * u, 22 * u); x.quadraticCurveTo(8 * u, 14 * u, 16 * u, 6 * u); x.fill(); });
  else if (it === 'barrage') rune('#7ad8ff', () => { for (let i = 0; i < 3; i++) { x.save(); x.translate(15 * u, 15 * u); x.rotate(i * Math.PI / 3); x.beginPath(); x.moveTo(0, -8 * u); x.lineTo(0, 8 * u); x.stroke(); x.restore(); } });
  else if (it === 'chin') {
    x.fillStyle = '#8a8a90'; x.beginPath(); x.ellipse(15 * u, 19 * u, 10 * u, 8 * u, 0, 0, 7); x.fill(); x.stroke();
    x.fillStyle = '#e8e4dc'; x.beginPath(); x.ellipse(23 * u, 18 * u, 5 * u, 6 * u, 0, 0, 7); x.fill(); x.stroke();
    x.fillStyle = '#8a8a90'; for (const ex of [19, 25]) { x.beginPath(); x.moveTo((ex - 3) * u, 13 * u); x.lineTo(ex * u, 5 * u); x.lineTo((ex + 2) * u, 13 * u); x.fill(); x.stroke(); }
    x.fillStyle = '#000'; x.fillRect(22 * u, 16 * u, 2 * u, 2 * u); x.fillRect(25 * u, 16 * u, 2 * u, 2 * u);
    x.strokeStyle = '#8a8a90'; x.lineWidth = 3 * u; x.beginPath(); x.moveTo(6 * u, 16 * u); x.quadraticCurveTo(1 * u, 8 * u, 7 * u, 6 * u); x.stroke();
  }
  else if (it === 'protect') {
    x.fillStyle = '#c8ccd4'; x.beginPath(); x.moveTo(16 * u, 2 * u); x.lineTo(29 * u, 7 * u); x.lineTo(26 * u, 20 * u); x.lineTo(16 * u, 30 * u); x.lineTo(6 * u, 20 * u); x.lineTo(3 * u, 7 * u); x.closePath(); x.fill(); x.stroke();
    x.strokeStyle = '#2a8a2a'; x.lineWidth = 3 * u; x.beginPath(); x.moveTo(16 * u, 8 * u); x.lineTo(16 * u, 24 * u); x.stroke();
    x.fillStyle = '#2a8a2a'; x.beginPath(); x.moveTo(11 * u, 20 * u); x.lineTo(16 * u, 27 * u); x.lineTo(21 * u, 20 * u); x.closePath(); x.fill();
  }
  else if (it === 'smoke') rune('#4a4048', () => { for (const [a, b, r] of [[12, 17, 5], [19, 14, 6], [18, 20, 5]]) { x.beginPath(); x.arc(a * u, b * u, r * u, 0, 7); x.fill(); } });
  else if (it === 'dragon') {
    x.fillStyle = '#b01818'; x.beginPath(); x.moveTo(4 * u, 22 * u); x.lineTo(10 * u, 8 * u); x.lineTo(14 * u, 12 * u); x.lineTo(20 * u, 4 * u); x.lineTo(22 * u, 12 * u); x.lineTo(29 * u, 14 * u); x.lineTo(24 * u, 20 * u); x.lineTo(14 * u, 22 * u); x.closePath(); x.fill(); x.stroke();
    x.fillStyle = '#ffd040'; x.fillRect(19 * u, 12 * u, 2.5 * u, 2.5 * u); x.fillStyle = '#ff8a1a'; x.beginPath(); x.moveTo(26 * u, 20 * u); x.lineTo(31 * u, 28 * u); x.lineTo(22 * u, 26 * u); x.closePath(); x.fill();
  }
  icons.set(key, c); return c;
}
const ROULETTE = Object.keys(ITEMS);

export class CartHud {
  constructor(canvas, fonts) { this.c = canvas; this.x = canvas.getContext('2d'); this.f = fonts; this.msgs = []; this.chat = []; this.k = 2; this.mini = null; this.puffs = null; }
  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.c.width = innerWidth * dpr; this.c.height = innerHeight * dpr; this.dpr = dpr;
    this.c.style.width = innerWidth + 'px'; this.c.style.height = innerHeight + 'px';
    this.x.imageSmoothingEnabled = false;
    this.k = Math.max(1, Math.round(Math.min(this.c.width, this.c.height * 1.6) / 900));
  }
  T(t, x, y, col = '#ff0', align = 'l', k = this.k, font = 'b12', alpha = 1) {
    const im = this.f[font].render(String(t), col, k), ox = align === 'c' ? im.width / 2 : align === 'r' ? im.width : 0;
    this.x.globalAlpha = alpha; this.x.drawImage(im, Math.round(x - ox), Math.round(y)); this.x.globalAlpha = 1; return im.width;
  }
  panel(x, y, w, h, a = 1) {
    const c = this.x; c.globalAlpha = a; c.fillStyle = PANEL; c.fillRect(x, y, w, h);
    c.strokeStyle = EDGE; c.lineWidth = 2 * this.k; c.strokeRect(x, y, w, h); c.strokeStyle = LIGHT; c.lineWidth = this.k; c.strokeRect(x + 2 * this.k, y + 2 * this.k, w - 4 * this.k, h - 4 * this.k); c.globalAlpha = 1;
  }
  /** the RS chatbox line: "You open the chest..." */
  say(text, col = '#000') { this.chat.push({ text, col, t: 0 }); if (this.chat.length > 4) this.chat.shift(); }
  message(text, col = '#ff0', dur = 1.6, big = false) { this.msgs = this.msgs.filter(m => m.text !== text); this.msgs.push({ text, col, t: 0, dur, big }); if (this.msgs.length > 3) this.msgs.shift(); }

  /** the track outline for the minimap, fitted to a box */
  buildMini(T) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < T.N; i++) { x0 = Math.min(x0, T.x[i]); x1 = Math.max(x1, T.x[i]); z0 = Math.min(z0, T.z[i]); z1 = Math.max(z1, T.z[i]); }
    this.mini = { T, x0, x1, z0, z1 };
  }

  draw(dt, race, me, st) {
    const c = this.x, W = this.c.width, H = this.c.height, k = this.k, T = race.T;
    c.clearRect(0, 0, W, H);
    if (st.hidden) return;
    const pad = 10 * k, safeB = st.touch ? 150 * k : 0;
    // ---- lap and clock
    if (me) {
      const lap = Math.max(1, Math.min(race.laps, me.lap));
      this.panel(pad, pad, 150 * k, 46 * k);
      this.T('LAP', pad + 8 * k, pad + 7 * k, '#ff981f'); this.T(`${lap}/${race.laps}`, pad + 46 * k, pad + 3 * k, '#fff', 'l', k + 1);
      this.T(clock(me.finished || Math.max(0, race.t)), pad + 8 * k, pad + 26 * k, '#ff0', 'l', k, 'p12');
    }
    // ---- the item slot (a slot machine while it rolls)
    if (me) {
      const S = 56 * k, x = W / 2 - S / 2, y = pad;
      this.panel(x - 4 * k, y - 2 * k, S + 8 * k, S + 8 * k, 0.95);
      let it = me.item;
      if (it === 'roll') it = ROULETTE[Math.floor(race.t * 14) % ROULETTE.length];
      if (it) { c.drawImage(itemIcon(it, S - 8 * k), x + 4 * k, y + 6 * k); if (me.item !== 'roll') this.T(ITEMS[it].name, W / 2, y + S + 10 * k, '#ff0', 'c', k, 'p12'); if (me.item === 'energy3' && me.uses > 1) this.T('x' + me.uses, x + S - 4 * k, y + S - 12 * k, '#fff', 'r'); }
    }
    // ---- the standings
    if (race.order && st.board !== false) {
      const rows = race.order, rh = 15 * k, y0 = pad + 56 * k;
      this.panel(pad, y0, 150 * k, rh * rows.length + 10 * k, 0.8);
      rows.forEach((q, i) => {
        const y = y0 + 5 * k + i * rh, col = hex(THEMES[q.theme]?.acc ?? 0xffffff);
        c.fillStyle = col; c.fillRect(pad + 6 * k, y + 3 * k, 6 * k, 6 * k);
        this.T(String(i + 1), pad + 26 * k, y, q === me ? '#fff' : '#ff981f', 'r', k, 'p12');
        this.T(q.name.slice(0, 13), pad + 32 * k, y, q === me ? '#0f0' : '#ff0', 'l', k, 'p12');
      });
    }
    // ---- the place, big
    if (me && race.state === 'go') {
      const p = me.place, col = PLACE_COL[Math.min(3, p - 1)], txt = ORD(p);
      if (st.touch) this.T(txt, W - pad - 122 * k, pad + 70 * k, col, 'r', k * 4);   // (beside the minimap: the bottom right is thumbs)
      else this.T(txt, W - pad - 6 * k, H - pad - 52 * k, col, 'r', k * 4);
    }
    // ---- the minimap
    if (this.mini && st.mini !== false) {
      const m = this.mini, S = (st.touch ? 110 : 150) * k, x = st.touch ? W - pad - S : pad, y = st.touch ? pad + 70 * k : H - pad - S - safeB;
      this.panel(x, y, S, S, 0.85);
      const sc = (S - 20 * k) / Math.max(m.x1 - m.x0, m.z1 - m.z0), ox = x + S / 2 - (m.x0 + m.x1) / 2 * sc, oz = y + S / 2 + (m.z0 + m.z1) / 2 * sc;
      const P = (px, pz) => [ox + px * sc, oz - pz * sc];
      c.lineCap = c.lineJoin = 'round';
      for (const [w, col] of [[7 * k, '#2b2117'], [4 * k, '#b0a490']]) { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); for (let i = 0; i <= T.N; i += 3) { const [a, b] = P(T.x[i % T.N], T.z[i % T.N]); i ? c.lineTo(a, b) : c.moveTo(a, b); } c.closePath(); c.stroke(); }
      const f = T.at(T.finish), [fx, fz] = P(f.x, f.z); c.fillStyle = '#fff'; c.fillRect(fx - 3 * k, fz - 3 * k, 6 * k, 6 * k);
      for (const q of [...race.karts].sort((a, b) => (a === me) - (b === me))) {
        const [a, b] = P(q.x, q.z), r = (q === me ? 5 : 3.2) * k;
        c.fillStyle = hex(THEMES[q.theme]?.acc ?? 0xffffff); c.strokeStyle = '#000'; c.lineWidth = k; c.beginPath(); c.arc(a, b, r, 0, 7); c.fill(); c.stroke();
        if (q === me) { c.strokeStyle = '#fff'; c.lineWidth = 1.5 * k; c.beginPath(); c.arc(a, b, r + 2 * k, 0, 7); c.stroke(); }
      }
    }
    // ---- the countdown
    if (race.state === 'count' && race.t > -3.05) {
      const n = Math.ceil(-race.t), u = -race.t - Math.floor(-race.t);
      this.T(String(n), W / 2, H * 0.32, ['#0f0', '#ff0', '#ff981f', '#f44'][Math.min(3, n)], 'c', Math.round(k * (6 + u * 3)));
    } else if (race.state === 'go' && race.t < 1.2) this.T('GO!', W / 2, H * 0.32, '#0f0', 'c', Math.round(k * (8 + race.t * 2)), 'b12', Math.min(1, (1.2 - race.t) * 2));
    // ---- shouts
    let my = H * 0.42;
    for (let i = this.msgs.length - 1; i >= 0; i--) {
      const m = this.msgs[i]; m.t += dt; if (m.t > m.dur) { this.msgs.splice(i, 1); continue; }
      const a = Math.min(1, (m.dur - m.t) * 3), pop = m.t < 0.12 ? 1 + (0.12 - m.t) * 4 : 1, kk = Math.round((m.big ? k * 3 : k * 2) * pop);
      this.T(m.text, W / 2, my, m.col, 'c', kk, 'b12', a); my += (m.big ? 40 : 26) * k;
    }
    // ---- the chatbox, bottom centre: parchment, RS fonts, lines fade after a few seconds
    for (let i = this.chat.length - 1; i >= 0; i--) if ((this.chat[i].t += dt) > 6) this.chat.splice(i, 1);
    if (this.chat.length && me) {
      const w = Math.min(W - 2 * pad, 420 * k), x0 = W / 2 - w / 2, lh = 15 * k, y0 = H - pad - safeB - this.chat.length * lh - 10 * k;
      c.globalAlpha = 0.82; c.fillStyle = '#c8b48a'; c.fillRect(x0, y0, w, this.chat.length * lh + 8 * k); c.strokeStyle = EDGE; c.lineWidth = 2 * k; c.strokeRect(x0, y0, w, this.chat.length * lh + 8 * k); c.globalAlpha = 1;
      this.chat.forEach((m, i) => this.T(m.text, x0 + 6 * k, y0 + 4 * k + i * lh, m.col, 'l', k, 'p12', Math.min(1, (6 - m.t) * 2)));
    }
    // ---- smoke barrage: the cloud over your screen (it thins as it wears off)
    if (me && me.smokeT > 0) {
      if (!this.puffs) this.puffs = Array.from({ length: 14 }, () => [Math.random(), Math.random() * 0.8 + 0.1, 0.12 + Math.random() * 0.16, Math.random() * 6]);
      const a = Math.min(1, me.smokeT / 1.2) * 0.92;
      for (const [px, py, r, ph] of this.puffs) { const R2 = Math.max(W, H) * r * (1 + Math.sin(performance.now() / 600 + ph) * 0.08), g = c.createRadialGradient(px * W, py * H, 0, px * W, py * H, R2); g.addColorStop(0, `rgba(40,36,42,${a})`); g.addColorStop(1, 'rgba(40,36,42,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H); }
    } else this.puffs = null;
    // ---- a red edge when you're hit, the boost's rush
    if (me && me.spinT > 0) { c.fillStyle = `rgba(255,40,20,${Math.min(0.25, me.spinT * 0.25)})`; c.fillRect(0, 0, W, H); }
    if (me && me.frozenT > 0) { c.fillStyle = 'rgba(140,220,255,0.28)'; c.fillRect(0, 0, W, H); }
  }
}
