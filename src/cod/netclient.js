// CODScape online, the browser end: mirrors the server's match into a local Game (role 'client'). You run your
// own movement and bullets (so aiming feels local); everyone else is a puppet posed from the server's snapshots,
// drawn ~0.12 s in the past and interpolated, so they glide instead of stepping. Your hits, grenades, shots and
// chat go up; health, kills, flags, grenades and respawns come down.
import * as THREE from 'three';
import { Game, STREAKS } from './game.js';
import { Gunner } from './gunner.js';
import { LETHALS, HP } from './weapons.js';
import { WKEY, unwireW, R3 } from './netwire.js';

const DELAY = 0.12, SEND = 1 / 30;
const V = a => new THREE.Vector3(a[0], a[1], a[2]);
const lerpA = (a, b, t) => { const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };

export class NetClient {
  /** hooks: { welcome(game, me), roster(added, removed), event(e), chat(name, team, text), status(text), closed(why) } */
  constructor(arena, hooks) {
    this.arena = arena; this.h = hooks; this.game = null; this.me = null; this.you = -1;
    this.renderT = null; this.lastT = 0; this.sendT = 0; this.nades = new Map(); this.byId = new Map();
  }
  connect(name, cls) {
    const ws = this.ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/cod-ws');
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, cls }));
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } this.recv(m); };
    ws.onclose = () => { if (!this.closing) this.h.closed?.(this.game ? 'lost the connection to the server' : 'the online match is unavailable right now'); };
  }
  close() { this.closing = true; try { this.ws?.close(); } catch {} }
  send(m) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)); }

  // ---- Game.net: what your browser tells the server
  hit(v, dmg, zone, w, dir, at) { this.send({ t: 'hit', v: v.id, dmg: Math.round(dmg * 10) / 10, zone, w: w.cls === 'MELEE' ? 'knife' : WKEY.get(w), dir: dir ? R3(dir) : null, at: at ? R3(at) : null }); }
  nade(g) { this.send({ t: 'nade', p: R3(g.p), v: R3(g.v), fuse: g.fuse, lethal: g.lethal }); }
  shot(f, w, o, to) { this.send({ t: 'shot', w: WKEY.get(w), o: R3(o), to: R3(to) }); }
  barrage(x, z) { this.send({ t: 'barrage', x, z }); }
  respawn() { this.send({ t: 'respawn' }); }
  cls(i) { this.send({ t: 'cls', i }); }
  chat(text) { this.send({ t: 'chat', text }); }

  recv(m) {
    switch (m.t) {
      case 'w': this.welcome(m); break;
      case 'r': if (this.game) this.roster(m.roster); break;
      case 's': if (this.game) this.snap(m); break;
      case 'e': if (this.game) for (const e of m.e) this.event(e); break;
      case 'chat': this.h.chat?.(m.n, m.team, m.text); break;
      case 'full': this.h.closed?.('both sides are full (8 v 8): try again soon'); this.close(); break;
    }
  }

  welcome(m) {
    if (m.you !== undefined) this.you = m.you;
    const g = this.game = new Game(this.arena, { mode: m.mode, role: 'client', net: this, limit: m.limit });
    g.timeLeft = m.tl; g.score = m.sc;
    this.byId.clear(); this.nades.clear(); this.renderT = null; this.me = null;
    this.roster(m.roster, true);
    this.h.welcome?.(g, this.me);
  }
  roster(list, fresh = false) {
    const g = this.game, ids = new Set(list.map(r => r.id)), added = [], removed = [];
    for (const f of [...g.fighters]) if (!ids.has(f.id)) { g.fighters = g.fighters.filter(o => o !== f); this.byId.delete(f.id); removed.push(f); }
    for (const r of list) {
      if (this.byId.has(r.id)) continue;
      const mine = r.id === this.you;
      const f = g.addFighter({ id: r.id, name: r.name, team: r.team, loadout: r.lo, player: mine });
      f.puppet = !mine; f.isBot = r.bot; f.snaps = []; f.alive = false;
      if (mine) { g.player = this.me = f; f.netInit = false; }
      this.byId.set(r.id, f); added.push(f);
    }
    if (!fresh) this.h.roster?.(added, removed);
  }

  snap(s) {
    const g = this.game;
    this.lastT = s.T; if (this.renderT === null) this.renderT = s.T - DELAY;
    g.timeLeft = s.tl; g.score = s.sc;
    for (const a of s.f) {
      const f = this.byId.get(a[0]); if (!f) continue;
      const bits = a[10];
      f.hp = a[11]; f.kills = a[14]; f.deaths = a[15]; f.score = a[16]; f.streak = a[17]; f.caps = a[18]; f.assists = a[19];
      f.uavT = bits & 64 ? 1 : 0;
      if (f === this.me) {
        f.barrage = !!(bits & 128);
        if (!f.netInit && bits & 1) { f.netInit = true; f.alive = true; f.body.pos.set(a[1], a[2], a[3]); f.body.yaw = a[4]; f.body.pitch = 0; f.hp = HP; }
        else if (f.alive && !(bits & 1)) { f.alive = false; f.respawnT = g.mode.respawn; }            // (a death whose event went missing)
        continue;
      }
      f.snaps.push([s.T, a]); if (f.snaps.length > 12) f.snaps.shift();
      if (!f.alive && bits & 1 && !f.dying) { f.alive = true; f.snaps = [[s.T, a]]; }                 // (a respawn whose event went missing)
      if (f.alive && !(bits & 1)) f.alive = false;
    }
    // grenades: stable objects (the renderer keys its models on them), flown on between snapshots
    const live = new Set();
    for (const n of s.g) {
      live.add(n[0]); let o = this.nades.get(n[0]);
      if (!o) { o = { id: n[0], p: new THREE.Vector3(), v: new THREE.Vector3(), L: LETHALS[n[7] ? 'semtex' : 'frag'], f: this.byId.get(n[9]) || null }; this.nades.set(n[0], o); }
      o.p.set(n[1], n[2], n[3]); o.v.set(n[4], n[5], n[6]); o.rest = !!n[8];
    }
    for (const id of this.nades.keys()) if (!live.has(id)) this.nades.delete(id);
    g.grenades = [...this.nades.values()];
    for (const [k, a] of Object.entries(s.fl)) { const fl = g.flags[k]; if (!fl) continue; fl.state = a[0]; fl.pos.set(a[1], a[2], a[3]); fl.carrier = this.byId.get(a[4]) || null; }
    for (const f of g.fighters) f.carrying = null;
    for (const fl of Object.values(g.flags)) if (fl.carrier) fl.carrier.carrying = fl.team;
  }

  /** before the local step: pose the puppets at the render time, fly the grenades; after it: send where you are */
  frame(dt) {
    const g = this.game; if (!g || this.renderT === null) return;
    this.renderT += dt;
    const want = this.lastT - DELAY;
    if (Math.abs(want - this.renderT) > 0.35) this.renderT = want; else this.renderT += (want - this.renderT) * Math.min(1, dt * 2);
    const rt = this.renderT;
    for (const f of g.fighters) {
      if (!f.puppet || !f.snaps.length) continue;
      let i = f.snaps.length - 1; while (i > 0 && f.snaps[i - 1][0] > rt) i--;
      const [tb, b] = f.snaps[i], [ta, a] = i > 0 ? f.snaps[i - 1] : f.snaps[i];
      let t = tb > ta ? (rt - ta) / (tb - ta) : 1; const over = Math.max(0, Math.min(0.2, rt - tb));
      t = Math.max(0, Math.min(1, t));
      const B = f.body, L = (j) => a[j] + (b[j] - a[j]) * t;
      B.pos.set(L(1), L(2), L(3));
      if (over > 0) B.pos.add(new THREE.Vector3(b[7], 0, b[9]).multiplyScalar(over));                  // (a late snapshot: carry on a little)
      B.yaw = lerpA(a[4], b[4], t); B.pitch = L(5); B.crouch = L(6); B.vel.set(L(7), L(8), L(9));
      const bits = b[10];
      B.onGround = !!(bits & 2); B.sprinting = !!(bits & 4); B.slide = bits & 8 ? 0.1 : 0; B.wading = !!(bits & 32);
      const G = f.gunner; if (G.slots[b[12]]) G.cur = b[12]; G.phase = bits & 16 ? 'reload' : 'idle'; G.ads = b[13];
    }
    for (const n of g.grenades) if (!n.rest) { n.v.y -= 12 * dt; n.p.addScaledVector(n.v, dt); }
  }
  sendState(dt) {
    const f = this.me; if (!f || !f.alive) return;
    if ((this.sendT += dt) < SEND) return; this.sendT = 0;
    const b = f.body, r = x => Math.round(x * 1000) / 1000, G = f.gunner;
    this.send({ t: 'st', p: R3(b.pos), v: R3(b.vel), yaw: r(b.yaw), pitch: r(b.pitch), cr: r(b.crouch), ads: r(G.ads), sp: b.sprinting ? 1 : 0, sl: b.slide > 0 ? 1 : 0, gr: b.onGround ? 1 : 0, wa: b.wading ? 1 : 0, rl: G.reloading ? 1 : 0, slot: G.cur });
  }

  /** a server event -> the local match's state + the event the renderer/HUD already know */
  event(e) {
    const g = this.game, F = id => this.byId.get(id) || null, me = this.me, push = x => g.events.push(x);
    switch (e.t) {
      case 'shot': {
        const f = F(e.f); if (!f || f === me) return;
        const w = unwireW({ k: e.w }) || f.gunner.w;
        g.tracers.push({ from: f.avatar ? f.avatar.muzzleWorld(new THREE.Vector3()) : null, o: V(e.o), to: V(e.to), t: 0.06, f, w });
        f.lastShotT = g.t;
        push({ t: 'shot', f, w });
        return;
      }
      case 'impact': push({ t: 'impact', p: V(e.p), n: V(e.n) }); return;
      case 'hit': {
        const f = F(e.f), v = F(e.v); if (!v) return;
        if (f === me && v !== me) { if (e.kill) push({ t: 'confirm', head: e.zone === 'head' }); return; }      // (the hitmarker already showed when you fired)
        if (v === me) v.hp = Math.max(0, v.hp - e.dmg);
        push({ t: 'hit', f, v, dmg: e.dmg, zone: e.zone, dir: e.dir ? V(e.dir) : new THREE.Vector3(0, 0, -1), at: e.at ? V(e.at) : null, kill: e.kill });
        return;
      }
      case 'kill': {
        const f = F(e.f), v = F(e.v); if (!v) return;
        const w = unwireW(e.w);
        v.alive = false; v.hp = 0; v.killer = f; v.killedWith = w; v.respawnT = g.mode.respawn; v.carrying = null; v.diedAt = v.body.pos.clone();
        if (v.puppet) v.snaps = [];
        g.feed.push({ k: f, v, w, tags: e.tags, t: g.t }); if (g.feed.length > 6) g.feed.shift();
        push({ t: 'kill', f, v, w, zone: e.zone, dir: e.dir ? V(e.dir) : null, tags: e.tags });
        return;
      }
      case 'assist': { const f = F(e.f), v = F(e.v); if (f && v) push({ t: 'assist', f, v }); return; }
      case 'spawn': {
        const f = F(e.f); if (!f) return;
        f.alive = true; f.hp = HP; f.loadout = e.lo; f.gunner = new Gunner(e.lo); f.carrying = null; f.killer = null;
        f.body.pos.set(e.p[0], e.p[1], e.p[2]); f.body.vel.set(0, 0, 0); f.body.yaw = e.yaw; f.body.pitch = 0;
        if (f === me) { f.netInit = true; f.body.onGround = true; f.body.slide = 0; f.body.crouch = 0; }
        else f.snaps = [];
        push({ t: 'spawn', f });
        return;
      }
      case 'streak': { const f = F(e.f), s = STREAKS.find(x => x.id === e.s); if (!f || !s) return; if (f === me && s.id === 'barrage') me.barrage = true; push({ t: 'streak', f, s }); return; }
      case 'boom': push({ t: 'boom', p: V(e.p), r: e.r, ice: e.ice }); return;
      case 'bounce': push({ t: 'bounce', p: V(e.p) }); return;
      case 'stuck': { const f = F(e.f), v = F(e.v); if (v) push({ t: 'stuck', f, v }); return; }
      case 'flag': { const fl = g.flags[e.fl]; if (fl) push({ t: 'flag', what: e.what, f: F(e.f), fl }); return; }
      case 'barrage': { const f = F(e.f); if (f) push({ t: 'barrage', f, p: V(e.p), blasts: (e.b || []).map(([p, t]) => ({ p: V(p), t })) }); return; }
      case 'end': g.over = true; g.winner = typeof e.winner === 'string' ? e.winner : F(e.winner); push({ t: 'end', winner: g.winner }); return;
    }
  }
}
