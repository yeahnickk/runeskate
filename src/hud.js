// HUD drawn with the game's own bitmap fonts (server/content/fonts/*_full.png) + the RS hitsplat.

export class RSFont {
  static async load(name) {
    const img = new Image();
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = `assets/${name}_full.png`; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    return new RSFont(x.getImageData(0, 0, img.width, img.height));
  }
  constructor(data) {
    this.glyph = [];
    let top = 20, bot = 0;
    const cells = [];
    for (let c = 0; c < 256; c++) {
      const ox = (c % 16) * 20, oy = Math.floor(c / 16) * 20;
      const ink = [];
      let x0 = 99, x1 = -1;
      for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
        const i = ((oy + y) * data.width + ox + x) * 4, d = data.data;
        const bg = d[i] > 200 && d[i + 1] < 60 && d[i + 2] > 200;
        if (!bg) { ink.push([x, y]); x0 = Math.min(x0, x); x1 = Math.max(x1, x); if (c !== 32) { top = Math.min(top, y); bot = Math.max(bot, y + 1); } }
      }
      cells.push({ ink, x0, x1 });
    }
    this.top = top; this.h = bot - top;
    for (let c = 0; c < 256; c++) {
      const { ink, x0, x1 } = cells[c];
      if (c === 32 || x1 < 0) { this.glyph[c] = { w: 4, px: [] }; continue; }
      this.glyph[c] = { w: x1 - x0 + 1, px: ink.map(([x, y]) => [x - x0, y - top]) };
    }
    this.cache = new Map();
  }
  measure(text) { let w = 0; for (const ch of text) w += (this.glyph[ch.charCodeAt(0)] || this.glyph[63]).w + 1; return w; }
  /** returns a canvas with the text at integer pixel scale k, with the RS 1px drop shadow */
  render(text, color = '#ff0', k = 2, shadow = true) {
    const key = text + '|' + color + '|' + k + '|' + shadow;
    if (this.cache.has(key)) return this.cache.get(key);
    const w = this.measure(text) + 1, h = this.h + 1;
    const c = document.createElement('canvas'); c.width = w * k; c.height = h * k;
    const x = c.getContext('2d');
    const draw = (col, ox, oy) => {
      x.fillStyle = col; let cx = 0;
      for (const ch of text) {
        const g = this.glyph[ch.charCodeAt(0)] || this.glyph[63];
        for (const [px, py] of g.px) x.fillRect((cx + px + ox) * k, (py + oy) * k, k, k);
        cx += g.w + 1;
      }
    };
    if (shadow) draw('#000', 1, 1);
    draw(color, 0, 0);
    if (this.cache.size > 400) this.cache.clear();
    this.cache.set(key, c);
    return c;
  }
}

export async function loadHitsplat() {
  const h = await (await fetch('assets/hitmark_1.json')).json();
  const c = document.createElement('canvas'); c.width = h.w; c.height = h.h;
  const x = c.getContext('2d'); const im = x.createImageData(h.w, h.h);
  h.px.forEach((p, i) => { if (p) { im.data[i * 4] = (p >> 16) & 255; im.data[i * 4 + 1] = (p >> 8) & 255; im.data[i * 4 + 2] = p & 255; im.data[i * 4 + 3] = 255; } });
  x.putImageData(im, 0, 0);
  return c;
}

import { levelFor, levelProgress, xpToNext, MAX_LEVEL } from './levels.js';

export class HUD {
  constructor(canvas, fonts, splat) {
    this.c = canvas; this.x = canvas.getContext('2d'); this.f = fonts; this.splat = splat;
    this.pops = [];       // floating trick names (on screen)
    this.popQ = [];       // ... and waiting their turn
    this.popGap = 0;
    this.msg = null;      // big centre message
    this.msgQ = [];       // ... and the ones waiting behind it
    this.splats = [];     // world-anchored hitsplats (screen pos supplied each frame)
    this.tags = [];       // name tags / overhead chat (screen pos supplied each frame)
    this.chat = [];       // chat + join/leave lines
    this.me = null;       // { name, xp }
    this.online = null;   // names online (null = solo)
    this.mini = null;     // { canvas, PX, N } top-down map, + dots each frame
    this.miniDots = [];   // {x, z, col, r}
  }
  resize() { this.c.width = innerWidth; this.c.height = innerHeight; this.x.imageSmoothingEnabled = false; }
  text(t, x, y, color = '#ff0', k = 2, align = 'l', font = 'b12', alpha = 1) {
    const im = this.f[font].render(t, color, k);
    const ox = align === 'c' ? im.width / 2 : align === 'r' ? im.width : 0;
    this.x.globalAlpha = alpha; this.x.drawImage(im, Math.round(x - ox), Math.round(y)); this.x.globalAlpha = 1;
    return im.width;
  }
  /** the owner's crown badge (5-point crown, gold with a black outline), left edge at x, top at y; returns its width */
  crown(x, y, k) {
    const c = this.x, w = 11 * k, h = 8 * k; x = Math.round(x); y = Math.round(y);
    c.beginPath();
    c.moveTo(x, y + h); c.lineTo(x, y + h * 0.25); c.lineTo(x + w * 0.25, y + h * 0.6); c.lineTo(x + w * 0.5, y);
    c.lineTo(x + w * 0.75, y + h * 0.6); c.lineTo(x + w, y + h * 0.25); c.lineTo(x + w, y + h); c.closePath();
    c.fillStyle = '#ffc933'; c.fill(); c.lineWidth = Math.max(1, k * 0.8); c.strokeStyle = '#000'; c.stroke();
    c.fillStyle = '#e0303a'; c.fillRect(x + w * 0.5 - k, y + h * 0.62, 2 * k, 2 * k);   // a ruby in the band
    return w;
  }
  /** a floating line (trick names, notices). At most POP_MAX show at once, the rest wait their turn and come
   *  in one at a time; the same line again while it is still up counts up (x2, x3) instead of stacking. */
  pop(text, color = '#fff') {
    const same = [...this.pops, ...this.popQ].find(p => p.text === text);
    if (same) { same.n = (same.n || 1) + 1; if (same.t !== undefined) same.t = Math.min(same.t, 0.3); return; }
    this.popQ.push({ text, color, n: 1 });
    if (this.popQ.length > 8) this.popQ.splice(0, this.popQ.length - 8);   // a flood: keep the newest
  }
  /** the big centre message. One at a time: a new one waits until the current has been read (its time is
   *  cut short when something is queued behind it). now = show it straight away and drop the queue. */
  big(text, color = '#f00', sub = '', dur = 2.2, now = false) {
    const m = { text, color, sub, t: 0, dur };
    if (now || !this.msg) { this.msg = m; if (now) this.msgQ.length = 0; return; }
    if (this.msg.text === text) { Object.assign(this.msg, { sub, color, dur: Math.max(this.msg.dur, this.msg.t + 1) }); return; }
    const q = this.msgQ.find(x => x.text === text);
    if (q) Object.assign(q, m); else this.msgQ.push(m);
    if (this.msgQ.length > 3) this.msgQ.shift();
  }

  draw(dt, sk, cfg) {
    const x = this.x, W = this.c.width, H = this.c.height;
    x.clearRect(0, 0, W, H);
    const K = Math.max(2, Math.round(Math.min(W, H) / 300));
    // score (RS yellow, top left, like the xp drops)
    this.text('SCORE ' + sk.score.toLocaleString(), 16, 14, '#ff0', K);
    this.text('BEST COMBO ' + sk.stat.bestCombo.toLocaleString(), 16, 14 + K * 12, '#ff981f', Math.max(2, K - 1), 'l', 'p12');
    const k1 = Math.max(1, K - 1);
    this.text(`SPEED ${(sk.speed * 3.6 * 1.1).toFixed(0)} KM/H`, W - 16, 14, '#0f0', k1, 'r', 'p12');
    if (this.mini && cfg.map !== false) this.drawMini(W - 16, 14 + k1 * 24, K, sk);
    // the one standing challenge, small, under the minimap: all runes unlock ::noclip (the owner has it anyway)
    if (this.goal && this.me && !this.me.own && !this.touch) {   // (a phone has its buttons there)
      const g = this.goal, cy = 14 + k1 * 24 + (this.mini && cfg.map !== false ? Math.round(34 * Math.max(2, K)) * 2 + 14 : 0);
      if (sk.noclip) this.text('NOCLIP ON', W - 16, cy, '#0ff', k1, 'r', 'p12', 0.8);
      else if (g.allRunes) this.text('::NOCLIP UNLOCKED', W - 16, cy, '#0f0', k1, 'r', 'p12', 0.8);
      else {
        this.text(`CHALLENGE  RUNES ${g.runes}/${g.runeTotal}`, W - 16, cy, '#ff981f', k1, 'r', 'p12', 0.75);
        this.text('reward: ::noclip', W - 16, cy + k1 * 9, '#fff', k1, 'r', 'p12', 0.65);
      }
    }
    // level + xp (points are total XP)
    if (this.me) {
      const xp = this.me.xp, L = levelFor(xp), y0 = 14 + K * 24 + 4;
      const cx = this.me.own ? 16 + this.crown(16, y0, k1) + 3 * k1 : 16;
      this.text(`${this.me.own ? '[OWNER] ' : ''}${this.me.name}  LEVEL ${L}${L >= MAX_LEVEL ? ' (MAX)' : ''}`, cx, y0, this.me.own ? '#ffc933' : '#0f0', k1, 'l', 'p12');
      const nx = xpToNext(xp);
      this.text(`XP ${Math.floor(xp).toLocaleString()}`, 16, y0 + k1 * 11, '#fff', k1, 'l', 'p12', 0.85);   // (the bar under it shows the way to the next level)
      void nx;
      const bw = 120 * k1 / 1.5, by = y0 + k1 * 23;
      x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillRect(16, by, bw, 5);
      x.fillStyle = '#0c0'; x.fillRect(16, by, bw * levelProgress(xp), 5);
    }
    // things to do
    const g = this.goal;
    if (g) {
      const y1 = 14 + K * 24 + 4 + k1 * 23 + 10;
      this.text(`RUNES ${g.runes}/${g.runeTotal}`, 16, y1, '#0cf', k1, 'l', 'p12', 0.9);
      if (this.playing) this.text(`${this.playing} ONLINE`, 16, y1 + k1 * 11, '#fff', k1, 'l', 'p12', 0.7);
      if (g.task) {
        this.text(g.task + (g.prog ? `   ${g.prog}` : ''), W / 2, 14, '#ff981f', K, 'c', 'b12');
        this.text(`${Math.ceil(g.t)}s`, W / 2, 14 + K * 13, g.t < 6 ? '#f00' : '#fff', K, 'c', 'b12');
      }
    }
    // who's online
    if (this.online) {
      this.text(`ONLINE (${this.online.length})`, W - 16, 14 + k1 * 24, '#ff981f', k1, 'r', 'p12');
      this.online.slice(0, 12).forEach((n, i) => this.text(n, W - 16, 14 + k1 * 35 + i * k1 * 10, i ? '#fff' : '#0ff', k1, 'r', 'p12', 0.85));
    }
    // name tags + overhead chat
    for (const t of this.tags) {
      if (t.text) { const w = this.text(t.text, t.screen[0], t.screen[1], t.col, k1, 'c', 'p12'); if (t.crown) this.crown(t.screen[0] - w / 2 - 14 * k1, t.screen[1], k1); }
      if (t.sub) this.text(t.sub, t.screen[0], t.screen[1] - k1 * 12, '#ff0', k1, 'c', 'b12');
    }
    // chat log: player messages linger ~2 min, join/leave notices fade after 10s. With the chat box open
    // (ENTER) the whole history shows, scrollable with the mouse wheel.
    for (const c of this.chat) c.t += dt;
    const life = c => c.old ? 0 : c.msg ? 120 : 10;
    const lineH = k1 * 11, baseY = H - 34 - K * 10 - (this.chatOpen ? 30 : 0);
    let rows;
    if (this.chatOpen) {
      const hist = this.chat.filter(c => c.msg || c.t < 10), n = 10;
      this.chatScroll = Math.max(0, Math.min(this.chatScroll || 0, hist.length - n));
      const end = hist.length - this.chatScroll;
      rows = hist.slice(Math.max(0, end - n), end).map(c => [c, 1]);
      if (rows.length) {
        x.fillStyle = 'rgba(0,0,0,0.45)';
        x.fillRect(10, baseY - (rows.length - 0.3) * lineH - 4, Math.min(W - 20, 520 * k1 / 2), rows.length * lineH + 6);
        if (hist.length > n) this.text(this.chatScroll ? `scroll: ${this.chatScroll} older below` : 'mouse wheel: scroll up', 16, baseY - rows.length * lineH - 2, '#aaa', k1 * 0.8, 'l', 'p12');
      }
    } else rows = this.chat.filter(c => c.t < life(c)).slice(-6).map(c => [c, Math.min(1, (life(c) - c.t) / 2)]);
    rows.forEach(([c, a], i) => {
      const y = baseY - (rows.length - 1 - i) * lineH;
      let cx = 16; if (c.crown) { this.x.globalAlpha = a; cx += this.crown(16, y, k1) + 3 * k1; this.x.globalAlpha = 1; }
      this.text(c.text, cx, y, c.col, k1, 'l', 'p12', a);
    });
    // live combo
    if (sk.combo.length || (sk.mode === 'grind')) {
      const names = sk.combo.slice(-4).join(' + ') + (sk.mode === 'grind' ? (sk.combo.length ? ' + ' : '') + sk.grindKind : '');
      this.text(names, W / 2, H - 120 - K * 10, '#fff', Math.max(2, K - 1), 'c', 'p12');
      const n = sk.combo.length + (sk.mode === 'grind' ? 1 : 0);
      this.text(`${Math.round(sk.comboPts).toLocaleString()} X ${Math.max(1, n)}`, W / 2, H - 110, '#ff0', K, 'c');
    }
    // manual balance meter (same look as the grind one)
    if (sk.mode === 'ground' && sk.manual) this.meter(W, H, sk.manBal, true);
    // grind balance meter
    if (sk.mode === 'grind') {
      const bw = 220, bx = W / 2 - bw / 2, by = H * 0.3;
      x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillRect(bx - 3, by - 3, bw + 6, 16);
      x.fillStyle = '#2a2'; x.fillRect(bx + bw * 0.35, by, bw * 0.3, 10);
      x.fillStyle = '#aa2'; x.fillRect(bx + bw * 0.15, by, bw * 0.2, 10); x.fillRect(bx + bw * 0.65, by, bw * 0.2, 10);
      x.fillStyle = '#a22'; x.fillRect(bx, by, bw * 0.15, 10); x.fillRect(bx + bw * 0.85, by, bw * 0.15, 10);
      const px = bx + bw / 2 + sk.balance * bw / 2;
      x.fillStyle = '#fff'; x.fillRect(px - 2, by - 4, 4, 18);
    }
    // ollie charge
    if (sk.charge >= 0 && sk.mode === 'ground') {
      x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(W / 2 - 42, H * 0.3, 84, 8);
      x.fillStyle = '#ff0'; x.fillRect(W / 2 - 40, H * 0.3 + 2, 80 * sk.charge, 4);
    }
    // floating trick pops: a few slots under the top bar, each line glides to its slot as older ones leave
    const POP_LIFE = 1.3, POP_MAX = 2;
    for (const p of this.pops) p.t += dt;
    this.pops = this.pops.filter(p => p.t < POP_LIFE);
    if ((this.popGap -= dt) <= 0 && this.popQ.length && this.pops.length < POP_MAX) {
      const p = this.popQ.shift(); p.t = 0; p.y = null; this.pops.push(p); this.popGap = 0.16;
    }
    const slot = K * 13, y0 = H * 0.17;
    this.pops.forEach((p, i) => {
      const want = y0 + i * slot;
      p.y = p.y == null ? want + slot * 0.6 : p.y + (want - p.y) * Math.min(1, dt * 12);
      const a = Math.min(1, p.t / 0.12, (POP_LIFE - p.t) / 0.35);
      this.text(p.text + (p.n > 1 ? `  x${p.n}` : ''), W / 2, p.y, p.color, K, 'c', 'b12', a);
    });
    // hitsplats
    this.splats = this.splats.filter(s => (s.t += dt) < 1.4);
    for (const s of this.splats) {
      if (!s.screen) continue;
      const k = K * 2 * (s.t < 0.12 ? 0.6 + s.t / 0.3 : 1);
      const w = this.splat.width * k, h = this.splat.height * k;
      const y = s.screen[1] - s.t * 40;
      x.drawImage(this.splat, s.screen[0] - w / 2, y - h / 2, w, h);
      this.text(String(s.n), s.screen[0], y - K * 6, '#fff', K * 2, 'c', 'p12');
    }
    // big message
    if (this.msg) {
      const m = this.msg; m.t += dt;
      if (this.msgQ.length && !m.cut) { m.cut = true; m.dur = Math.min(m.dur, Math.max(m.t + 0.3, 1.1)); }    // something waiting: wrap this one up
      const a = Math.min(1, (m.dur - m.t) / 0.3);
      if (m.t > m.dur) this.msg = this.msgQ.shift() || null;
      else {
        const k = K * 1.5 * (m.t < 0.12 ? 1.4 - m.t * 3.3 : 1);
        this.text(m.text, W / 2, H * 0.38, m.color, Math.max(K, Math.round(k)), 'c', 'b12', a);
        if (m.sub) this.text(m.sub, W / 2, H * 0.38 + K * 30, '#fff', K, 'c', 'p12', a);
      }
    }
    if (this.board) this.drawBoard(K);
    if (cfg.help) this.drawHelp(K);
    else if (!this.touch) this.text('H: controls', 16, H - 16 - K * 10, '#ff981f', Math.max(1, K - 1), 'l', 'p12', 0.75);
  }

  /** RS-style round minimap, north up, centred on the skater */
  drawMini(right, top, K, sk) {
    const x = this.x, m = this.mini, R = Math.round(34 * Math.max(2, K)), span = 40;   // span = tiles from centre to rim
    const S = m.S || 1, cx = right - R - 4, cy = top + R + 4, sc = R / span / S;   // (the map canvas is in tiles, positions in game units)
    x.save();
    x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.clip();
    x.fillStyle = '#000'; x.fillRect(cx - R, cy - R, R * 2, R * 2);
    x.imageSmoothingEnabled = true;
    const sx = (sk.x / S - span) * m.PX, sy = (m.N - sk.z / S - span) * m.PX;
    x.drawImage(m.canvas, sx, sy, span * 2 * m.PX, span * 2 * m.PX, cx - R, cy - R, R * 2, R * 2);
    x.imageSmoothingEnabled = false;
    for (const d of this.miniDots) {
      const px = cx + (d.x - sk.x) * sc, py = cy - (d.z - sk.z) * sc;
      if (Math.hypot(px - cx, py - cy) > R - 3) continue;
      x.fillStyle = '#000'; x.fillRect(px - d.r - 1, py - d.r - 1, d.r * 2 + 2, d.r * 2 + 2);
      x.fillStyle = d.col; x.fillRect(px - d.r, py - d.r, d.r * 2, d.r * 2);
    }
    // you: a white arrow along the heading
    const a = -sk.heading;
    x.translate(cx, cy); x.rotate(a);
    x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.lineWidth = 1;
    x.beginPath(); x.moveTo(7, 0); x.lineTo(-5, -5); x.lineTo(-2, 0); x.lineTo(-5, 5); x.closePath(); x.fill(); x.stroke();
    x.restore();
    x.strokeStyle = '#5a4a2a'; x.lineWidth = 3; x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.stroke();
    this.text('N', cx, cy - R - 2, '#fff', Math.max(1, K - 1), 'c', 'p12');
  }

  meter(W, H, v, vertical) {
    const x = this.x, bh = 160, bx = W * 0.62, by = H / 2 - bh / 2;
    x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillRect(bx - 3, by - 3, 16, bh + 6);
    x.fillStyle = '#a22'; x.fillRect(bx, by, 10, bh);
    x.fillStyle = '#aa2'; x.fillRect(bx, by + bh * 0.15, 10, bh * 0.7);
    x.fillStyle = '#2a2'; x.fillRect(bx, by + bh * 0.35, 10, bh * 0.3);
    x.fillStyle = '#fff'; x.fillRect(bx - 4, by + bh / 2 - v * bh / 2 - 2, 18, 4);
    void vertical;
  }

  drawBoard(K) {
    const x = this.x, W = this.c.width, H = this.c.height, k = Math.max(1, K - 1), lh = k * 12;
    const rows = this.board, pw = Math.max(460, 330 * k), ph = 12 + K * 14 + lh + 4 + rows.length * lh + 14;
    const px = W / 2 - pw / 2, py = H * 0.18;
    x.fillStyle = 'rgba(30,24,16,0.88)'; x.fillRect(px, py, pw, ph);
    x.strokeStyle = '#5a4a2a'; x.lineWidth = 3; x.strokeRect(px, py, pw, ph);
    this.text('TOP SKATERS', W / 2, py + 8, '#ff981f', K, 'c');
    const hy = py + 12 + K * 14;
    this.text('LEVEL', px + pw * 0.44, hy, '#a0927a', k, 'l', 'p12'); this.text('XP', px + pw * 0.80, hy, '#a0927a', k, 'r', 'p12'); this.text('RUNES', px + pw - 12, hy, '#a0927a', k, 'r', 'p12');
    rows.forEach((r, i) => {
      const y = py + 12 + K * 14 + lh + 4 + i * lh, me = this.me && r.name === this.me.name, col = r.own ? '#ffc933' : me ? '#0f0' : i < 3 ? '#ff0' : '#fff';
      const nw = this.text(`${i + 1}. ${r.name}${r.on ? ' *' : ''}`, px + 12, y, col, k, 'l', 'p12');
      if (r.own) this.crown(px + 12 + nw + 3 * k, y, k);
      this.text(`lvl ${levelFor(r.xp)}`, px + pw * 0.44, y, col, k, 'l', 'p12');
      this.text(Math.floor(r.xp).toLocaleString(), px + pw * 0.80, y, col, k, 'r', 'p12');
      this.text(`${r.runes || 0}/${r.runeTotal || 100}`, px + pw - 12, y, '#0cf', k, 'r', 'p12');
    });
  }

  drawHelp(K) {
    const x = this.x, W = this.c.width, H = this.c.height;
    const lines = [
      ['W / UP', 'push'], ['S / DOWN', 'brake'], ['A D / LEFT RIGHT', 'steer (air: spin, grind: balance)'],
      ['SPACE', 'hold + release: ollie'], ['J / K / L / I', 'kickflip / heelflip / shove-it / varial'], ['U / N / M / Y / B', '360 flip / hardflip / 360 shove / double kick / double heel'], ['MOUSE', 'pull down, flick up: ollie (up-left kickflip, up-right heelflip)'],
      ['SHIFT', 'powerslide'], ['Q (rolling)', 'manual, balance with W / S'], ['Q (in the air)', 'grab: hold, A/D pick the grab'], ['C', 'camera'], ['R', 'back to Lumbridge spawn'], ['E', 'step off / on the board (SPACE hops on foot)'], ['O', 'outfit'], ['1 - 5', 'emotes: wave, cheer, dance, laugh, clap'], ['ENTER', 'chat'],
      ['TAB', 'teleport anywhere + leaderboard'], ['X', 'replay editor: scrub, slow-mo, cameras, save video'], ['P', 'build mode: place rails, ledges, kickers'], ['::skate NAME', 'challenge someone to S.K.A.T.E.'], ['G', 'graphics: high / low'], ['H', 'hide this help'],
    ];
    const k2 = Math.max(1, K - 1), p12 = this.f.p12, lh = k2 * 12;
    const col = 8 + Math.max(...lines.map(([k]) => p12.measure(k))) * k2 + 10;
    const pw = col + Math.max(...lines.map(([, v]) => p12.measure(v))) * k2 + 10, ph = 10 + lines.length * lh;
    const px = 12, py = H - ph - 12;
    x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(px, py, pw, ph);
    x.strokeStyle = '#5a4a2a'; x.lineWidth = 1; x.strokeRect(px, py, pw, ph);
    lines.forEach(([k, v], i) => {
      this.text(k, px + 8, py + 6 + i * lh, '#ff0', k2, 'l', 'p12');
      this.text(v, px + col, py + 6 + i * lh, '#fff', k2, 'l', 'p12');
    });
  }
}
