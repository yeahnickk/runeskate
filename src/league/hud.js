// Rune League's HUD in RuneScape's clothes: RS bitmap fonts on brown stone panels. The score and the clock top centre
// (team boxes either side), your boost bottom right as an RS orb filling with stamina, your points popping up over it
// ("SHOT ON GOAL +20"), the feed top right ("Bob scored!"), names over the cars, quick chat in the RS chatbox, the
// big shouts (3 2 1 GO, GOAL!, OVERTIME), the scoreboard on TAB.
import { TEAM } from './scenery.js';

const PANEL = 'rgba(62,53,41,0.88)', EDGE = '#2b2117', LIGHT = '#7a6a4c';
export const clock = (t, ot) => { const s = Math.ceil(Math.max(0, t) - 1e-6), m = Math.floor(s / 60); return (ot ? '+' : '') + `${m}:${String(s % 60).padStart(2, '0')}`; };
export const QUICK = [
  ['INFORMATION', ['Mine!', 'Need run energy!', 'Shoot it!', 'Tanking...']],
  ['COMPLIMENTS', ['Gz!', 'Nice prayer flick!', 'Gz on the pass!', 'Ty!']],
  ['REACTIONS', ['Woah!', 'Noooo!', 'Wtf!', 'Close one!']],
  ['APOLOGIES', ['Sry, lag...', 'Misclick...', 'My bad...', 'Oops!']],
];

export class LeagueHud {
  constructor(canvas, fonts) { this.c = canvas; this.x = canvas.getContext('2d'); this.f = fonts; this.k = 2; this.feedL = []; this.pops = []; this.chat = []; this.bigM = null; this.qc = 0; }
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
  panel(x, y, w, h, a = 1, fill = PANEL) {
    const c = this.x; c.globalAlpha = a; c.fillStyle = fill; c.fillRect(x, y, w, h);
    c.strokeStyle = EDGE; c.lineWidth = 2 * this.k; c.strokeRect(x, y, w, h); c.strokeStyle = LIGHT; c.lineWidth = this.k; c.strokeRect(x + 2 * this.k, y + 2 * this.k, w - 4 * this.k, h - 4 * this.k); c.globalAlpha = 1;
  }
  feed(text, col = '#ff0') { this.feedL.push({ text, col, t: 0 }); if (this.feedL.length > 5) this.feedL.shift(); }
  pop(text, col = '#ff0') { this.pops.push({ text, col, t: 0 }); if (this.pops.length > 4) this.pops.shift(); }
  say(name, text, col) { this.chat.push({ name, text, col, t: 0 }); if (this.chat.length > 5) this.chat.shift(); }
  big(text, sub = '', col = '#ff981f', dur = 2.2) { this.bigM = { text, sub, col, t: 0, dur }; }

  /** st: { touch, ballcam, board, names: [{ x, y, name, team, boost, me }], replay, freeplay, hidden } */
  draw(dt, m, me, st) {
    const c = this.x, W = this.c.width, H = this.c.height, k = this.k;
    c.clearRect(0, 0, W, H);
    if (st.hidden) return;
    const pad = 10 * k;
    // ---- names over the cars (team colour; your mates' boost under them)
    for (const n of st.names || []) {
      if (n.me) continue;
      this.T(n.name, n.x, n.y - 14 * k, TEAM[n.team].css, 'c', k, 'p12');
      if (n.mate) { c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(n.x - 16 * k, n.y, 32 * k, 4 * k); c.fillStyle = '#ffb030'; c.fillRect(n.x - 16 * k, n.y, 32 * k * n.boost / 100, 4 * k); }
    }
    // ---- the score and the clock
    if (!st.freeplay) {
      const bw = 56 * k, cw = 92 * k, h = 40 * k, x0 = W / 2 - cw / 2 - bw, y = pad;
      c.fillStyle = TEAM[0].css; c.fillRect(x0, y, bw, h); c.fillStyle = TEAM[1].css; c.fillRect(W / 2 + cw / 2, y, bw, h);
      c.strokeStyle = EDGE; c.lineWidth = 2 * k; c.strokeRect(x0, y, bw, h); c.strokeRect(W / 2 + cw / 2, y, bw, h);
      this.panel(W / 2 - cw / 2, y, cw, h);
      this.T(m.score[0], x0 + bw / 2, y + 7 * k, '#fff', 'c', k * 2); this.T(m.score[1], W / 2 + cw / 2 + bw / 2, y + 7 * k, '#fff', 'c', k * 2);
      this.T(clock(m.ot ? m.otT : m.clock, m.ot), W / 2, y + 7 * k, m.ot ? '#ff981f' : m.clock < 30 && m.clock > 0 ? '#f44' : '#ff0', 'c', k * 2);
      if (m.ot) this.T('OVERTIME', W / 2, y + h + 4 * k, '#ff981f', 'c', k, 'p12');
    } else this.T('FREE PLAY', W / 2, pad + 4 * k, '#ff981f', 'c', k * 2);
    // ---- the feed, top right
    this.feedL = this.feedL.filter(f => (f.t += dt) < 6);
    this.feedL.forEach((f, i) => { const a = Math.min(1, (6 - f.t) * 2); const w = this.f.p12.render(f.text, f.col, k).width + 16 * k, y = pad + 40 * k + i * 22 * k; this.panel(W - pad - w, y, w, 20 * k, 0.85 * a); this.T(f.text, W - pad - 8 * k, y + 4 * k, f.col, 'r', k, 'p12', a); });
    // ---- your boost: an RS orb, filling
    if (me && !st.replay) {
      const r = 46 * k, cx = st.touch ? W / 2 + 150 * k : W - pad - r - 10 * k, cy = st.touch ? H - pad - r - 6 * k : H - pad - r - 10 * k;
      c.fillStyle = '#2b2117'; c.beginPath(); c.arc(cx, cy, r + 5 * k, 0, 7); c.fill();
      c.fillStyle = '#1a140c'; c.beginPath(); c.arc(cx, cy, r, 0, 7); c.fill();
      const f = me.boost / 100; c.save(); c.beginPath(); c.arc(cx, cy, r - 3 * k, 0, 7); c.clip();
      const g = c.createLinearGradient(0, cy + r, 0, cy - r); g.addColorStop(0, '#a8501a'); g.addColorStop(1, me.sonic ? '#fff3a0' : '#ffb030');
      c.fillStyle = g; c.fillRect(cx - r, cy + r - 2 * r * f, 2 * r, 2 * r * f); c.restore();
      c.strokeStyle = LIGHT; c.lineWidth = 2 * k; c.beginPath(); c.arc(cx, cy, r + 2 * k, 0, 7); c.stroke();
      this.T(Math.floor(me.boost), cx, cy - 12 * k, '#fff', 'c', k * 2);
      // your points, popping up over it
      this.pops = this.pops.filter(p => (p.t += dt) < 2.4);
      this.pops.forEach((p, i) => this.T(p.text, st.touch ? cx : cx + r, cy - r - 26 * k - (this.pops.length - 1 - i) * 18 * k - p.t * 6 * k, p.col, st.touch ? 'c' : 'r', k, 'b12', Math.min(1, (2.4 - p.t) * 2)));
    }
    if (st.ballcam && !st.replay) this.T('BALL CAM', st.touch ? W / 2 - 150 * k : W - pad - 112 * k - 10 * k, H - pad - 14 * k, '#ff981f', st.touch ? 'c' : 'r', k, 'p12');
    // ---- the chatbox: quick chat, RS style
    this.chat = this.chat.filter(l => (l.t += dt) < 8);
    if (this.chat.length) {
      const w = Math.min(W * 0.42, 380 * k), lh = 15 * k, x0 = pad, y0 = H - pad - (st.touch ? 170 * k : 0) - this.chat.length * lh - 8 * k;
      c.fillStyle = 'rgba(200,184,140,0.82)'; c.fillRect(x0, y0, w, this.chat.length * lh + 8 * k); c.strokeStyle = EDGE; c.lineWidth = k; c.strokeRect(x0, y0, w, this.chat.length * lh + 8 * k);
      this.chat.forEach((l, i) => { const nw = this.T(l.name + ': ', x0 + 6 * k, y0 + 4 * k + i * lh, l.col, 'l', k, 'p12'); this.T(l.text, x0 + 6 * k + nw, y0 + 4 * k + i * lh, '#000080', 'l', k, 'p12'); });
    }
    // ---- the quick chat menu (a category open: its four lines)
    if (this.qc) {
      const [cat, lines] = QUICK[this.qc - 1], x0 = pad, y0 = H * 0.36, w = 200 * k;
      this.panel(x0, y0, w, 26 * k + 4 * 16 * k);
      this.T(cat, x0 + 8 * k, y0 + 6 * k, '#ff981f', 'l', k);
      lines.forEach((l, i) => this.T(`${i + 1}. ${l}`, x0 + 8 * k, y0 + 24 * k + i * 16 * k, '#ff0', 'l', k, 'p12'));
    }
    // ---- the big shouts
    if (this.bigM) {
      const b = this.bigM; b.t += dt;
      if (b.t > b.dur) this.bigM = null;
      else {
        const a = Math.min(1, (b.dur - b.t) * 3, b.t * 8), kk = k * 2, w = Math.max(this.f.b12.render(b.text, b.col, kk).width, b.sub ? this.f.p12.render(b.sub, '#fff', k).width : 0) + 40 * k, h = (b.sub ? 50 : 34) * k, y = H * 0.24;
        this.panel(W / 2 - w / 2, y, w, h, 0.9 * a); this.T(b.text, W / 2, y + 7 * k, b.col, 'c', kk, 'b12', a); if (b.sub) this.T(b.sub, W / 2, y + 33 * k, '#fff', 'c', k, 'p12', a);
      }
    }
    if (m.state === 'count' && !st.replay && !st.freeplay) { const n = Math.ceil(m.stateT); if (n >= 1 && n <= 3) { const r = 26 * k, y = H * 0.3; c.fillStyle = '#2b2117'; c.beginPath(); c.arc(W / 2, y, r + 3 * k, 0, 7); c.fill(); c.fillStyle = PANEL; c.beginPath(); c.arc(W / 2, y, r, 0, 7); c.fill(); this.T(String(n), W / 2, y - 12 * k, '#ff0', 'c', k * 2); } }
    if (st.replay) { this.panel(pad, H * 0.18, 150 * k, 30 * k, 0.9); this.T('REPLAY', pad + 75 * k, H * 0.18 + 8 * k, '#f44', 'c', k); this.T(st.touch ? 'tap JUMP to skip' : 'JUMP to skip', pad + 75 * k, H * 0.18 + 36 * k, '#fff', 'c', k, 'p12'); }
    // ---- the scoreboard
    if (st.board && !st.freeplay) this.board(m, me);
  }
  board(m, me) {
    const c = this.x, W = this.c.width, H = this.c.height, k = this.k, cols = ['SCORE', 'GOALS', 'ASSISTS', 'SAVES', 'SHOTS'], keys = ['score', 'goals', 'assists', 'saves', 'shots'];
    const w = Math.min(W - 40 * k, 620 * k), rh = 22 * k, rows = m.cars.length + 2, h = rows * rh + 40 * k, x0 = W / 2 - w / 2, y0 = H / 2 - h / 2;
    this.panel(x0, y0, w, h, 0.95);
    let y = y0 + 12 * k;
    for (const team of [0, 1]) {
      c.fillStyle = TEAM[team].css; c.globalAlpha = 0.55; c.fillRect(x0 + 6 * k, y, w - 12 * k, rh); c.globalAlpha = 1;
      this.T(`${TEAM[team].name}  ${m.score[team]}`, x0 + 12 * k, y + 4 * k, '#fff', 'l', k);
      cols.forEach((t, i) => this.T(t, x0 + w * 0.42 + i * w * 0.115, y + 5 * k, '#fff', 'c', k, 'p12'));
      y += rh;
      for (const car of m.cars.filter(o => o.team === team).sort((a, b) => b.st.score - a.st.score)) {
        this.T(car.name + (car.bot ? ' [BOT]' : ''), x0 + 14 * k, y + 4 * k, car === me ? '#0f0' : '#ff0', 'l', k, 'p12');
        keys.forEach((kk, i) => this.T(car.st[kk], x0 + w * 0.42 + i * w * 0.115, y + 4 * k, '#fff', 'c', k, 'p12'));
        y += rh;
      }
      y += 6 * k;
    }
  }
}
