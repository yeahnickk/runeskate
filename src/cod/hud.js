// CODScape's HUD: Call of Duty's layout in RuneScape's clothes. RS bitmap fonts and stone panels; RS hitsplats
// pop off whoever you shoot; the crosshair opens with your spread; hitmarkers tick (red for the kill); the
// screen bleeds red as you take damage, with arrows to where it came from; minimap with red dots for anyone
// firing (everyone, under a UAV); killfeed; score; flags; the scoreboard; "Oh dear, you are dead!".
import * as THREE from 'three';
import { Arena } from './arena.js';
import { STREAKS } from './game.js';

const TEAM_COL = { sara: '#5ab4ff', zam: '#ff5a48' };
const PANEL = 'rgba(62,53,41,0.86)', EDGE = '#2b2117', LIGHT = '#7a6a4c';

const isBot = f => !!(f.brain || f.isBot);                 // (online, the server's bots arrive flagged; offline they carry a brain)

export class CodHud {
  constructor(canvas, fonts, splat) {
    this.c = canvas; this.x = canvas.getContext('2d'); this.f = fonts; this.splat = splat;
    this.hitT = 0; this.hitKill = false; this.hitHead = false; this.dmgDirs = []; this.splats = []; this.pops = []; this.msgs = []; this.points = []; this.chat = [];
    this.mini = null; this.k = 2;
  }
  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.c.width = innerWidth * dpr; this.c.height = innerHeight * dpr; this.dpr = dpr;
    this.c.style.width = innerWidth + 'px'; this.c.style.height = innerHeight + 'px';
    this.x.imageSmoothingEnabled = false;
    this.k = Math.max(1, Math.round(Math.min(this.c.width, this.c.height * 1.6) / 900));
  }
  T(t, x, y, col = '#ff0', align = 'l', k = this.k, font = 'b12', alpha = 1) {
    const im = this.f[font].render(String(t), col, k);
    const ox = align === 'c' ? im.width / 2 : align === 'r' ? im.width : 0;
    this.x.globalAlpha = alpha; this.x.drawImage(im, Math.round(x - ox), Math.round(y)); this.x.globalAlpha = 1;
    return im.width;
  }
  panel(x, y, w, h, a = 1) {
    const c = this.x; c.globalAlpha = a;
    c.fillStyle = PANEL; c.fillRect(x, y, w, h);
    c.strokeStyle = EDGE; c.lineWidth = 2 * this.k; c.strokeRect(x, y, w, h);
    c.strokeStyle = LIGHT; c.lineWidth = this.k; c.strokeRect(x + 2 * this.k, y + 2 * this.k, w - 4 * this.k, h - 4 * this.k);
    c.globalAlpha = 1;
  }

  // ---- things that happen
  hit(kill, head) { this.hitT = 0.28; this.hitKill = kill; this.hitHead = head; }
  hurt(fromDir) { this.dmgDirs.push({ d: fromDir.clone(), t: 1.4 }); if (this.dmgDirs.length > 5) this.dmgDirs.shift(); }
  splatAt(p, n, kill) { this.splats.push({ p: p.clone(), n, t: 0, kill, ox: (Math.random() - 0.5) * 0.3 }); if (this.splats.length > 12) this.splats.shift(); }
  point(text, col = '#ff0') { this.points.push({ text, col, t: 0 }); if (this.points.length > 4) this.points.shift(); }
  say(name, text, col = '#fff') { this.chat.push({ name, text, col, t: 0 }); if (this.chat.length > 6) this.chat.shift(); }
  message(text, col = '#ff0', sub = '', dur = 2.4) { this.msgs = this.msgs.filter(m => m.text !== text); this.msgs.push({ text, col, sub, t: 0, dur }); if (this.msgs.length > 3) this.msgs.shift(); }

  /**
   * g: the Game; me: the player's fighter (or the one we watch); cam: the camera; st: { spreadPx, ads, scope,
   * scopeSway, fov, board (tab held), paused, dead, touch }
   */
  draw(dt, g, me, cam, st) {
    const c = this.x, W = this.c.width, H = this.c.height, k = this.k;
    c.clearRect(0, 0, W, H);
    const proj = p => { const v = p.clone().project(cam); return v.z < 1 && v.z > -1 ? [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H] : null; };

    // the scope: black round a circle, the mil-dot reticle, the sway
    if (st.scope && me?.alive) {
      const r = Math.min(W, H) * 0.46, cx = W / 2 + st.scopeSway.x * r * 0.08, cy = H / 2 + st.scopeSway.y * r * 0.08;
      c.fillStyle = '#000'; c.beginPath(); c.rect(0, 0, W, H); c.arc(cx, cy, r, 0, Math.PI * 2, true); c.fill();
      const gr = c.createRadialGradient(cx, cy, r * 0.75, cx, cy, r); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.85)');
      c.fillStyle = gr; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#000'; c.lineWidth = Math.max(1, k * 0.8);
      c.beginPath(); c.moveTo(cx - r, cy); c.lineTo(cx + r, cy); c.moveTo(cx, cy - r); c.lineTo(cx, cy + r); c.stroke();
      c.lineWidth = 3 * k; c.beginPath(); c.moveTo(cx - r, cy); c.lineTo(cx - r * 0.35, cy); c.moveTo(cx + r * 0.35, cy); c.lineTo(cx + r, cy); c.moveTo(cx, cy + r * 0.35); c.lineTo(cx, cy + r); c.stroke();
      c.fillStyle = '#000'; for (let i = 1; i <= 4; i++) for (const s of [-1, 1]) { c.fillRect(cx + s * i * r * 0.07 - k, cy - k, 2 * k, 2 * k); c.fillRect(cx - k, cy + s * i * r * 0.07 - k, 2 * k, 2 * k); }
      if (st.breath !== undefined) { this.T(st.breath > 0 ? 'HOLDING BREATH' : 'SHIFT / L3: HOLD BREATH', cx, cy + r * 0.55, st.breath > 0 ? '#0f0' : '#aaa', 'c', Math.max(1, k - 1), 'p12', 0.8); }
    }

    // name tags: teammates always, an enemy under the crosshair
    if (me) for (const f of g.fighters) {
      if (f === me || !f.alive) continue;
      const friend = g.mode.teams && f.team === me.team;
      if (!friend && f !== st.aimedAt) continue;
      const p = proj(f.body.pos.clone().add(new THREE.Vector3(0, f.body.height + 0.45, 0))); if (!p) continue;
      const d = f.body.pos.distanceTo(me.body.pos); if (friend && d > 60) continue;
      this.T(f.name + (isBot(f) ? ' [BOT]' : ''), p[0], p[1] - 10 * k, friend ? TEAM_COL[f.team] : '#ff3030', 'c', Math.max(1, k - (d > 25 ? 1 : 0)), 'p12', friend ? 0.85 : 1);
      if (f.carrying) this.T('FLAG', p[0], p[1] - 22 * k, '#fff', 'c', Math.max(1, k - 1));
    }
    // CTF: the flags, wherever they are
    if (g.modeId === 'ctf') for (const fl of Object.values(g.flags)) {
      if (fl.state === 'carried' && fl.carrier === me) continue;
      const p = proj(fl.pos.clone().add(new THREE.Vector3(0, 3.2, 0)));
      const col = TEAM_COL[fl.team], label = fl.state === 'home' ? (me && fl.team === me.team ? 'DEFEND' : 'CAPTURE') : fl.state === 'dropped' ? (me && fl.team === me.team ? 'RETURN' : 'TAKE') : (me && fl.team === me.team ? 'KILL' : 'ESCORT');
      if (p) { this.diamond(p[0], p[1], 7 * k, col); this.T(label, p[0], p[1] + 9 * k, col, 'c', Math.max(1, k - 1), 'p12'); }
    }
    // RS hitsplats on whoever you hit
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const s = this.splats[i]; s.t += dt; if (s.t > 1.1) { this.splats.splice(i, 1); continue; }
      const p = proj(s.p.clone().add(new THREE.Vector3(s.ox, s.t * 0.4, 0))); if (!p) continue;
      const sz = this.splat.width * k * 1.4, a = s.t > 0.8 ? 1 - (s.t - 0.8) / 0.3 : 1;
      c.globalAlpha = a; c.drawImage(this.splat, p[0] - sz / 2, p[1] - sz / 2, sz, sz); c.globalAlpha = 1;
      this.T(s.n, p[0], p[1] - this.f.b12.h * k / 2 - k, '#fff', 'c', k, 'b12', a);
    }

    if (me && me.alive && !st.scope) this.crosshair(W / 2, H / 2, st);
    // hitmarker
    if (this.hitT > 0) {
      this.hitT -= dt;
      const s = (7 + (this.hitKill ? 4 : 0)) * k, gap = 4 * k, a = Math.min(1, this.hitT / 0.12);
      c.strokeStyle = this.hitKill ? `rgba(255,40,30,${a})` : this.hitHead ? `rgba(255,220,60,${a})` : `rgba(255,255,255,${a})`; c.lineWidth = (this.hitKill ? 2.5 : 2) * k;
      c.beginPath();
      for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { c.moveTo(W / 2 + sx * gap, H / 2 + sy * gap); c.lineTo(W / 2 + sx * (gap + s), H / 2 + sy * (gap + s)); }
      c.stroke();
    }
    // damage: a red edge, darker the lower you are, and arcs toward the shooter
    if (me && me.alive) {
      const hurt = 1 - me.hp / 100;
      if (hurt > 0.02) {
        const gr = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.7);
        gr.addColorStop(0, 'rgba(120,0,0,0)'); gr.addColorStop(1, `rgba(150,0,0,${Math.min(0.85, hurt * 0.95)})`);
        c.fillStyle = gr; c.fillRect(0, 0, W, H);
      }
      for (let i = this.dmgDirs.length - 1; i >= 0; i--) {
        const d = this.dmgDirs[i]; d.t -= dt; if (d.t <= 0) { this.dmgDirs.splice(i, 1); continue; }
        const yaw = me.body.yaw, from = Math.atan2(-d.d.x, -d.d.z), a = from - yaw;          // 0 = in front
        const r = Math.min(W, H) * 0.18, ang = -a - Math.PI / 2;
        c.strokeStyle = `rgba(255,30,20,${Math.min(1, d.t)})`; c.lineWidth = 6 * k;
        c.beginPath(); c.arc(W / 2, H / 2, r, ang - 0.32, ang + 0.32); c.stroke();
      }
    }
    // grenade nearby
    if (me && me.alive) for (const gr of g.grenades) {
      const d = gr.p.distanceTo(me.body.pos); if (d > 10) continue;
      const p = proj(gr.p);
      const at = p ? [Math.max(30 * k, Math.min(W - 30 * k, p[0])), Math.max(30 * k, Math.min(H - 30 * k, p[1]))] : [W / 2, H * 0.7];
      c.fillStyle = 'rgba(255,40,30,0.85)'; c.beginPath(); c.arc(at[0], at[1], 9 * k, 0, Math.PI * 2); c.fill();
      this.T('!', at[0], at[1] - 6 * k, '#fff', 'c', k);
    }

    this.scores(g, me);
    this.feed(g, me);
    if (me) this.ammo(me, st);
    if (this.mini && me) this.minimap(g, me);
    // +points under the crosshair
    for (let i = this.points.length - 1; i >= 0; i--) {
      const p = this.points[i]; p.t += dt; if (p.t > 1.6) { this.points.splice(i, 1); continue; }
      this.T(p.text, W / 2, H * 0.58 + i * 14 * k - p.t * 8 * k, p.col, 'c', k, 'b12', p.t > 1.2 ? 1 - (p.t - 1.2) / 0.4 : 1);
    }
    // big messages (streaks, flags, the match)
    for (let i = 0; i < this.msgs.length; i++) {
      const m = this.msgs[i]; m.t += dt;
      const a = m.t < 0.15 ? m.t / 0.15 : m.t > m.dur - 0.4 ? Math.max(0, (m.dur - m.t) / 0.4) : 1;
      this.T(m.text, W / 2, H * 0.24 + i * 34 * k, m.col, 'c', k + 1, 'b12', a);
      if (m.sub) this.T(m.sub, W / 2, H * 0.24 + i * 34 * k + 22 * k, '#fff', 'c', k, 'p12', a);
    }
    this.msgs = this.msgs.filter(m => m.t < m.dur);
    // dead
    if (me && !me.alive && !g.over) {
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, 0, W, H);
      this.T('Oh dear, you are dead!', W / 2, H * 0.36, '#ff0', 'c', k + 1);
      if (me.killer && me.killer !== me) this.T(`Killed by ${me.killer.name}${me.killedWith ? ' - ' + me.killedWith.name : ''}`, W / 2, H * 0.36 + 26 * k, '#ff981f', 'c', k);
      const t = Math.max(0, me.respawnT);
      this.T(t > 0 ? `Respawn in ${t.toFixed(1)}` : (st.touch ? 'TAP TO RESPAWN' : 'PRESS SPACE / CLICK / A TO RESPAWN'), W / 2, H * 0.36 + 48 * k, '#fff', 'c', k, 'p12');
    }
    // at a supply table: restocking, or how long until it'll restock you again
    if (me?.alive && g.supplies) {
      const s = g.supplies.find(s => (!g.mode.teams || s.team === me.team) && Math.abs(s.p.y - me.body.pos.y) < 1.2 && Math.hypot(s.p.x - me.body.pos.x, s.p.z - me.body.pos.z) < 2.6);
      if (s) this.T(me.supplyCool > 0 ? `SUPPLIES RESTOCK IN ${Math.ceil(me.supplyCool)}s` : me.supplyT > 0 ? 'RESUPPLYING...' : 'SUPPLIES: STAND HERE TO RESTOCK', W / 2, H * 0.66, '#ffd040', 'c', k, 'p12');
    }
    if (st.clickToAim && me?.alive) { this.panel(W / 2 - 90 * k, H * 0.42, 180 * k, 22 * k, 0.9); this.T('CLICK TO AIM', W / 2, H * 0.42 + 5 * k, '#ff0', 'c', k); }
    // chat, bottom left over the minimap's column
    { let y = H - (st.touch ? 230 : 120) * k; this.chat = this.chat.filter(m => (m.t += dt) < 12);
      for (const m of this.chat.slice().reverse()) { const a = m.t > 10 ? (12 - m.t) / 2 : 1; const x = 10 * k + this.T(m.name + ': ', 10 * k, y, m.col, 'l', k, 'p12', a); this.T(m.text, x, y, '#fff', 'l', k, 'p12', a); y -= 14 * k; } }
    if (st.pick) this.picker(g, me, st.pick);
    if (st.wrath) {                                                     // God's Wrath: the sky fills, the count, the flash
      const w = st.wrath, col = w.team === 'zam' ? [255, 60, 30] : w.team === 'sara' ? [255, 246, 200] : [120, 255, 120];
      if (w.tint) { c.fillStyle = `rgba(${col},${w.tint})`; c.fillRect(0, 0, W, H); }
      if (w.left > 0) { this.panel(W / 2 - 150 * k, H * 0.12 - 8 * k, 300 * k, 74 * k, 0.92); this.T(w.name, W / 2, H * 0.12, w.team === 'zam' ? '#ff5040' : w.team === 'sara' ? '#ffd040' : '#7f7', 'c', k + 1); this.T(String(Math.ceil(w.left)), W / 2, H * 0.12 + 24 * k, '#fff', 'c', k * 2); }
      if (w.flash) { c.fillStyle = `rgba(${col},${Math.min(1, w.flash * 1.2)})`; c.fillRect(0, 0, W, H); }
    }
    if (st.board || (g.over && !st.wrath)) this.scoreboard(g, me);           // (God's Wrath gets its moment before the scores)
  }

  /** the Ice Barrage map: the whole arena big, everyone you can see, the strike reticle */
  picker(g, me, pick) {
    const c = this.x, k = this.k, W = this.c.width, H = this.c.height, M = this.mini; if (!M) return;
    const size = Math.min(W, H) * 0.82, x = (W - size) / 2, y = (H - size) / 2 + 8 * k;
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(0, 0, W, H);
    this.panel(x - 4 * k, y - 4 * k, size + 8 * k, size + 8 * k);
    c.drawImage(M.canvas, x, y, size, size);
    const to = p => [x + (p.x - M.x0) / (M.x1 - M.x0) * size, y + (p.z - M.z0) / (M.z1 - M.z0) * size];
    const uav = me.uavT > 0;
    for (const f of g.fighters) {
      if (!f.alive) continue;
      const friend = f === me || (g.mode.teams && f.team === me.team);
      if (!friend && !uav && !f.carrying) continue;
      const [px, py] = to(f.body.pos);
      c.fillStyle = f === me ? '#fff' : friend ? TEAM_COL[f.team] : '#ff2a1a'; c.beginPath(); c.arc(px, py, 4 * k, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#000'; c.lineWidth = k; c.stroke();
    }
    if (g.modeId === 'ctf') for (const fl of Object.values(g.flags)) { const [px, py] = to(fl.pos); this.diamond(px, py, 6 * k, TEAM_COL[fl.team]); }
    const [px, py] = to(pick), r = 8.5 / (M.x1 - M.x0) * size;              // (the strike's reach: the blasts' spread plus their radius)
    c.strokeStyle = '#9fe0ff'; c.lineWidth = 2 * k; c.beginPath(); c.arc(px, py, r, 0, Math.PI * 2); c.stroke();
    c.fillStyle = 'rgba(159,224,255,0.18)'; c.fill();
    c.beginPath(); c.moveTo(px - r * 1.3, py); c.lineTo(px + r * 1.3, py); c.moveTo(px, py - r * 1.3); c.lineTo(px, py + r * 1.3); c.stroke();
    this.T(pick.kind === 'dragon' ? 'KING BLACK DRAGON' : 'ICE BARRAGE', W / 2, y - 26 * k, pick.kind === 'dragon' ? '#ff8a3a' : '#9fe0ff', 'c', k + 1);
    if (pick.kind === 'dragon') {                                       // his run: in from your side, a line of fire through the target
      const [mx, my] = to(me.body.pos), dx = px - mx, dy = py - my, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, h = 13 / (M.x1 - M.x0) * size;
      c.strokeStyle = '#ff7a2a'; c.lineWidth = 4 * k; c.beginPath(); c.moveTo(px - ux * h, py - uy * h); c.lineTo(px + ux * h, py + uy * h); c.stroke();
    }
    this.T('move to aim  ·  FIRE to call it in  ·  AIM / 4 to cancel', W / 2, y + size + 8 * k, '#fff', 'c', k, 'p12');
  }

  diamond(x, y, r, col) {
    const c = this.x; c.fillStyle = col; c.strokeStyle = '#000'; c.lineWidth = this.k;
    c.beginPath(); c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y); c.closePath(); c.fill(); c.stroke();
  }

  crosshair(cx, cy, st) {
    const c = this.x, k = this.k;
    const a = 1 - Math.min(1, st.ads * 1.6); if (a <= 0.02) return;
    const g = Math.max(4 * k, st.spreadPx), L = 7 * k;
    c.globalAlpha = a * (st.sprint ? 0.2 : 1);
    for (const [col, w] of [['#000', 3.2 * k], ['#fff', 1.4 * k]]) {
      c.strokeStyle = col; c.lineWidth = w; c.beginPath();
      c.moveTo(cx - g - L, cy); c.lineTo(cx - g, cy); c.moveTo(cx + g, cy); c.lineTo(cx + g + L, cy);
      c.moveTo(cx, cy - g - L); c.lineTo(cx, cy - g); c.moveTo(cx, cy + g); c.lineTo(cx, cy + g + L);
      c.stroke();
    }
    if (st.aimedAt) { c.fillStyle = '#ff3030'; c.fillRect(cx - k, cy - k, 2 * k, 2 * k); }
    c.globalAlpha = 1;
  }

  scores(g, me) {
    const c = this.x, k = this.k, W = this.c.width;
    const w = 190 * k, x = W / 2 - w / 2, y = 6 * k, h = 30 * k;
    this.panel(x, y, w, h);
    const m = Math.max(0, Math.floor(g.timeLeft / 60)), s = Math.max(0, Math.floor(g.timeLeft % 60));
    this.T(`${m}:${String(s).padStart(2, '0')}`, W / 2, y + 9 * k, g.timeLeft < 30 ? '#f44' : '#fff', 'c', k);
    if (g.mode.teams) {
      const mine = me?.team || 'sara', other = mine === 'sara' ? 'zam' : 'sara';
      for (const [team, side] of [[mine, -1], [other, 1]]) {
        const bx = W / 2 + side * 62 * k, val = g.score[team], frac = Math.min(1, val / g.limit);
        this.T(String(val), bx, y + 5 * k, TEAM_COL[team], 'c', k + 1);
        c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(bx - 26 * k, y + 22 * k, 52 * k, 4 * k);
        c.fillStyle = TEAM_COL[team]; const bw = 52 * k * frac; c.fillRect(side < 0 ? bx + 26 * k - bw : bx - 26 * k, y + 22 * k, bw, 4 * k);
      }
      if (g.modeId === 'ctf') for (const [team, side] of [[mine, -1], [other, 1]]) {
        const fl = g.flags[team], bx = W / 2 + side * 112 * k;
        this.diamond(bx, y + 15 * k, 8 * k, fl.state === 'home' ? TEAM_COL[team] : '#888');
        if (fl.state !== 'home') this.T(fl.state === 'carried' ? 'TAKEN' : 'DROPPED', bx, y + 25 * k, '#fff', 'c', Math.max(1, k - 1), 'p12');
      }
    } else if (me) {
      const lead = [...g.fighters].sort((a, b) => b.kills - a.kills)[0];
      this.T(`${me.kills}`, W / 2 - 62 * k, y + 5 * k, '#5f5', 'c', k + 1);
      this.T(`${lead === me ? [...g.fighters].sort((a, b) => b.kills - a.kills)[1]?.kills ?? 0 : lead.kills}`, W / 2 + 62 * k, y + 5 * k, '#f55', 'c', k + 1);
      this.T(`to ${g.limit}`, W / 2 + 62 * k, y + 20 * k, '#ccc', 'c', Math.max(1, k - 1), 'p12');
    }
  }

  feed(g, me) {
    const W = this.c.width, k = this.k; let y = 8 * k;
    for (const e of g.feed.slice(-5)) {
      const age = g.t - e.t; if (age > 7) continue;
      const a = age > 6 ? 1 - (age - 6) : 1;
      const col = f => !f ? '#ccc' : f === me ? '#ff0' : g.mode.teams ? TEAM_COL[f.team] : '#ddd';
      let x = W - 8 * k;
      const tag = e.tags.length ? ' [' + e.tags.join(' ') + ']' : '';
      x -= this.T(e.v.name, x, y, col(e.v), 'r', k, 'p12', a) + 6 * k;
      x -= this.T(`[${e.w?.name || '?'}]${tag}`, x, y, e.tags.includes('360') ? '#f0f' : '#ff981f', 'r', k, 'p12', a) + 6 * k;
      if (e.k && e.k !== e.v) this.T(e.k.name, x, y, col(e.k), 'r', k, 'p12', a);
      y += 14 * k;
    }
  }

  ammo(me, st) {
    const c = this.x, k = this.k, W = this.c.width, H = this.c.height, G = me.gunner, gg = G.g, w = G.w;
    const pw = 170 * k, ph = 52 * k, x = W - pw - 10 * k - (st.touch ? 0 : 0), y = H - ph - 10 * k - (st.touch ? 150 * k : 0);
    this.panel(x, y, pw, ph, 0.9);
    this.T(w.name, x + 8 * k, y + 6 * k, '#ff981f', 'l', k);
    const low = gg.ammo <= Math.ceil(w.mag * 0.25);
    const ammoW = this.T(String(gg.ammo), x + pw - 70 * k, y + 20 * k, low ? '#f44' : '#fff', 'r', k + 1);
    this.T('/' + gg.reserve, x + pw - 68 * k, y + 26 * k, '#ccc', 'l', k);
    void ammoW;
    // rounds in the mag as little ticks
    const n = Math.min(w.mag, 40), tw = Math.max(1, Math.floor((pw - 20 * k) / n) - 1);
    for (let i = 0; i < n; i++) { c.fillStyle = i < Math.round(gg.ammo / w.mag * n) ? '#e8d27a' : 'rgba(0,0,0,0.5)'; c.fillRect(x + 8 * k + i * (tw + 1), y + ph - 9 * k, tw, 4 * k); }
    // grenades
    for (let i = 0; i < G.nades; i++) { c.fillStyle = '#6b7a3c'; c.beginPath(); c.arc(x + pw - 14 * k - i * 12 * k, y + 12 * k, 4 * k, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#000'; c.stroke(); }
    if (G.reloading) this.T('RELOADING', W / 2, H * 0.62, '#fff', 'c', k, 'p12');
    else if (gg.ammo === 0 && gg.reserve === 0) this.T('NO AMMO', W / 2, H * 0.62, '#f44', 'c', k, 'p12');
    else if (low && gg.reserve > 0) this.T(st.touch ? 'RELOAD' : 'PRESS R TO RELOAD', W / 2, H * 0.62, '#ff0', 'c', k, 'p12');
    // killstreak progress
    const next = STREAKS.find(s => s.n > me.streak);
    if (next) this.T(`${me.streak}/${next.n} ${next.name}`, x + 8 * k, y - 14 * k, '#ccc', 'l', Math.max(1, k - 1), 'p12');
    if (me.uavT > 0) this.T('UAV ONLINE', x + pw - 8 * k, y - 14 * k, '#5f5', 'r', Math.max(1, k - 1), 'p12');
    const rd = me.ready?.[me.ready.length - 1], rs = rd && STREAKS.find(s => s.id === rd);
    if (rs) this.T(`${rs.name} READY ${st.touch ? '(tap STREAK)' : '[4]'}${me.ready.length > 1 ? `  +${me.ready.length - 1}` : ''}`, x + pw - 8 * k, y - 28 * k, rd === 'wrath' ? '#fff6c0' : rd === 'dragon' ? '#ff8a3a' : '#9fe0ff', 'r', k, 'b12');
  }

  /** the arena from above (made once) with everyone on it */
  minimap(g, me) {
    const c = this.x, k = this.k, M = this.mini, size = 120 * k, x = 10 * k, y = 10 * k;
    this.panel(x - 3 * k, y - 3 * k, size + 6 * k, size + 6 * k);
    c.save(); c.beginPath(); c.rect(x, y, size, size); c.clip();
    c.drawImage(M.canvas, x, y, size, size);
    const to = p => [x + (p.x - M.x0) / (M.x1 - M.x0) * size, y + (p.z - M.z0) / (M.z1 - M.z0) * size];
    const uav = me.uavT > 0;
    for (const f of g.fighters) {
      if (!f.alive || f === me) continue;
      const friend = g.mode.teams && f.team === me.team;
      if (!friend && !uav && !f.carrying) continue;                 // (enemies only show while your side's UAV is up; a flag carrier always does)
      const [px, py] = to(f.body.pos);
      c.fillStyle = friend ? TEAM_COL[f.team] : '#ff2a1a'; c.beginPath(); c.arc(px, py, 2.6 * k, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#000'; c.lineWidth = k * 0.6; c.stroke();
    }
    if (g.modeId === 'ctf') for (const fl of Object.values(g.flags)) { const [px, py] = to(fl.pos); this.diamond(px, py, 4 * k, TEAM_COL[fl.team]); }
    for (const s of g.supplies || []) if (!g.mode.teams || s.team === me.team) { const [px, py] = to(s.p); c.fillStyle = '#ffd040'; c.strokeStyle = '#000'; c.lineWidth = k * 0.6; c.fillRect(px - 2.5 * k, py - 2.5 * k, 5 * k, 5 * k); c.strokeRect(px - 2.5 * k, py - 2.5 * k, 5 * k, 5 * k); }   // (your side's supply tables)
    // you: an arrow along your look
    const [px, py] = to(me.body.pos), a = -me.body.yaw;
    c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = k;
    c.beginPath(); c.moveTo(px + Math.sin(a) * 6 * k, py - Math.cos(a) * 6 * k); c.lineTo(px + Math.sin(a + 2.5) * 4 * k, py - Math.cos(a + 2.5) * 4 * k); c.lineTo(px + Math.sin(a - 2.5) * 4 * k, py - Math.cos(a - 2.5) * 4 * k); c.closePath(); c.fill(); c.stroke();
    c.restore();
  }

  scoreboard(g, me) {
    const c = this.x, k = this.k, W = this.c.width, H = this.c.height;
    const w = Math.min(W - 20 * k, 560 * k), x = W / 2 - w / 2;
    const B = g.board(), groups = g.mode.teams ? [['sara', B.sara], ['zam', B.zam]] : [['all', B.all]];
    const rows = groups.reduce((a, [, l]) => a + l.length + 2, 0), h = Math.min(H - 20 * k, (rows * 13 + 40) * k), y = Math.max(10 * k, H / 2 - h / 2);
    this.panel(x, y, w, h, 0.95);
    let yy = y + 8 * k;
    if (g.over) {
      const win = g.winner, txt = !g.mode.teams ? (win === me ? 'VICTORY' : `${win?.name} WINS`) : win === 'draw' ? 'DRAW' : win === me?.team ? 'VICTORY' : 'DEFEAT';
      this.T(txt, W / 2, yy, txt === 'VICTORY' ? '#5f5' : txt === 'DRAW' ? '#ff0' : '#f55', 'c', k + 1); yy += 22 * k;
    }
    const cols = [['NAME', 0.03], ['SCORE', 0.5], ['K', 0.64], ['D', 0.74], ['A', 0.84], [g.modeId === 'ctf' ? 'CAPS' : 'K/D', 0.92]];
    for (const [team, list] of groups) {
      const tc = team === 'all' ? '#ff981f' : TEAM_COL[team];
      if (team !== 'all') this.T(`${Arena.TEAMS[team].name}  ${g.score[team]}`, x + 10 * k, yy, tc, 'l', k); yy += 14 * k;
      for (const [n, fx] of cols) this.T(n, x + w * fx, yy, '#ff981f', 'l', Math.max(1, k - 1), 'p12'); yy += 12 * k;
      for (const f of list) {
        if (f === me) { c.fillStyle = 'rgba(255,255,0,0.12)'; c.fillRect(x + 4 * k, yy - k, w - 8 * k, 12 * k); }
        const vals = [f.name + (isBot(f) ? ' [BOT]' : '') + (f.alive ? '' : ' (dead)'), f.score, f.kills, f.deaths, f.assists, g.modeId === 'ctf' ? f.caps : (f.kills / Math.max(1, f.deaths)).toFixed(2)];
        vals.forEach((v, i) => this.T(String(v), x + w * cols[i][1], yy, i === 0 ? (f === me ? '#ff0' : tc === '#ff981f' ? '#fff' : tc) : '#fff', 'l', Math.max(1, k - 1), 'p12'));
        yy += 12 * k;
      }
      yy += 6 * k;
    }
  }
}
