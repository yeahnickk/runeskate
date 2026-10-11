// CODScape online: one Castle Wars CTF match that never stops, run by serve.ts. Bots hold it at 4 a side; a person
// who joins takes a bot's place, and past that the sides grow to 8 people each. Each browser runs its own movement
// and its own bullets (it sees where everyone is and tells us who it hit); here we own everything else: health,
// kills, the flags, grenades, the bots, the clock. Plain JS, Three only for vectors.
import { readFileSync } from 'fs';
import * as THREE from 'three';
import { Arena } from './arena.js';
import { Game } from './game.js';
import { WEAPONS, LETHALS, CLASSES, KNIFE } from './weapons.js';
import { WKEY, wireW, R3, ZONES } from './netwire.js';

const TICK = 1 / 30, SNAP_EVERY = 2;                    // 30 Hz match, 15 Hz snapshots
const BOTS = 4, MAX = 8;                                 // bots fill each side to 4; up to 8 people a side

export class CodServer {
  constructor(root, clean = s => s) {
    const A = root + '/assets/';
    const file = readFileSync(A + 'cw_arena.bin');
    this.arena = new Arena(JSON.parse(readFileSync(A + 'cw_arena.json', 'utf8')), file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
    this.arena.buildNav();
    this.clean = clean; this.clients = new Set(); this.n = 0; this.restartAt = 0;
    this.newGame();
    setInterval(() => this.tick(), TICK * 1000);
  }

  newGame() {
    this.game = new Game(this.arena, { mode: 'ctf', difficulty: 'recruit', perTeam: BOTS, spectate: true, role: 'server' });
    this.restartAt = 0;
    for (const c of this.clients) { c.f = null; this.seat(c); }
    for (const c of this.clients) if (c.f) c.ws.send(JSON.stringify({ t: 'w', you: c.f.id, ...this.state() }));
  }

  /** what a browser needs to mirror the match: the roster, the flags, the score */
  state() {
    const g = this.game;
    return { mode: g.modeId, limit: g.limit, tl: g.timeLeft, sc: g.score, roster: this.roster() };
  }
  roster() { return this.game.fighters.map(f => ({ id: f.id, name: f.name, team: f.team, bot: !!f.brain, lo: { primary: f.loadout.primary, secondary: f.loadout.secondary, lethal: f.loadout.lethal } })); }

  /** a seat on the side with fewer people: a bot stands down for them, or the side grows (up to 8) */
  seat(c) {
    const g = this.game, people = t => g.fighters.filter(f => f.team === t && f.net).length;
    const team = people('sara') < people('zam') ? 'sara' : people('zam') < people('sara') ? 'zam' : (Math.random() < 0.5 ? 'sara' : 'zam');
    if (people(team) >= MAX) { c.ws.send(JSON.stringify({ t: 'full' })); return false; }
    const bots = g.fighters.filter(f => f.team === team && f.brain);
    const out = bots.find(f => !f.carrying) || bots[0];
    if (out) g.removeFighter(out);
    const cls = CLASSES[c.cls] || CLASSES[0];
    const f = g.addFighter({ name: c.name, team, loadout: { primary: cls.primary, secondary: cls.secondary, lethal: cls.lethal } });
    f.net = { respawn: false }; c.f = f;
    g.spawn(f, true);
    this.flush();
    this.sendAll({ t: 'r', roster: this.roster() });
    return true;
  }
  unseat(c) {
    const g = this.game, f = c.f; if (!f) return;
    c.f = null; g.removeFighter(f);
    if (g.fighters.filter(o => o.team === f.team).length < BOTS) { const b = g.addBot(f.team); g.spawn(b, true); }
    this.flush();
    this.sendAll({ t: 'r', roster: this.roster() });
  }

  // ------------------------------------------------------------------ sockets (serve.ts forwards /cod-ws here)
  open(ws) { const c = { ws, f: null, name: 'Soldier', cls: 0, chatT: 0, nadeT: 0, hits: 0, hitT: 0 }; ws.data.c = c; this.clients.add(c); }
  close(ws) { const c = ws.data.c; if (!c) return; this.clients.delete(c); this.unseat(c); }
  message(ws, raw) {
    const c = ws.data.c; if (!c) return;
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    const g = this.game, f = c.f, num = x => typeof x === 'number' && Number.isFinite(x);
    const vec = a => Array.isArray(a) && a.length === 3 && a.every(num) ? new THREE.Vector3(a[0], a[1], a[2]) : null;
    switch (m.t) {
      case 'hello': {
        if (c.f) return;
        c.name = this.clean(String(m.name || '').replace(/[^\w -]/g, '').trim().slice(0, 12)) || 'Soldier' + (++this.n % 1000);
        c.cls = Math.max(0, Math.min(CLASSES.length - 1, m.cls | 0));
        if (this.seat(c)) c.ws.send(JSON.stringify({ t: 'w', you: c.f.id, ...this.state() }));
        return;
      }
      case 'st': {                                         // where they are (their browser runs their physics)
        if (!f || !f.net || !vec(m.p) || !vec(m.v)) return;
        const n = f.net, [X0, Z0, X1, Z1] = Arena.BOUNDS, sw = this.arena.at(X0 - 1, Z0 - 1), ne = this.arena.at(X1 + 1, Z1 + 1);
        n.p = [Math.max(sw.x, Math.min(ne.x, m.p[0])), Math.max(-5, Math.min(40, m.p[1])), Math.max(ne.z, Math.min(sw.z, m.p[2]))];
        n.v = m.v.map(x => Math.max(-30, Math.min(30, x)));
        n.yaw = num(m.yaw) ? m.yaw : 0; n.pitch = num(m.pitch) ? Math.max(-1.5, Math.min(1.5, m.pitch)) : 0;
        n.crouch = num(m.cr) ? Math.max(0, Math.min(1, m.cr)) : 0; n.ads = num(m.ads) ? Math.max(0, Math.min(1, m.ads)) : 0;
        n.sprint = !!m.sp; n.slide = !!m.sl; n.ground = !!m.gr; n.wade = !!m.wa; n.reload = !!m.rl; n.slot = m.slot ? 1 : 0;
        return;
      }
      case 'shot': {                                       // they fired: everyone else hears it, sees the tracer
        if (!f || !f.alive) return;
        const o = vec(m.o), to = vec(m.to); if (!o || !to || !WEAPONS[m.w]) return;
        f.lastShotT = g.t;
        for (const e of g.fighters) if (e.brain && e.alive && e.team !== f.team && e.body.pos.distanceTo(o) < 45) e.brain.heard(f, 1);
        this.sendAll({ t: 'e', e: [{ t: 'shot', f: f.id, w: m.w, o: R3(o), to: R3(to) }] }, c);
        return;
      }
      case 'hit': {                                        // they hit someone (their view of it); sanity, then it counts
        if (!f || !f.alive) return;
        const v = g.fighters.find(o => o.id === m.v), w = m.w === 'knife' ? KNIFE : WEAPONS[m.w];
        if (!v || !v.alive || v === f || v.team === f.team || !w || !num(m.dmg) || m.dmg <= 0 || !ZONES.includes(m.zone)) return;
        if (g.t - c.hitT > 1) { c.hitT = g.t; c.hits = 0; } if (++c.hits > 60) return;      // (a pellet storm, not a script)
        if (v.body.pos.distanceTo(f.body.pos) > 320) return;
        const dir = vec(m.dir) || new THREE.Vector3(0, 0, -1), at = vec(m.at);
        g.damage(v, Math.min(m.dmg, 300), f, m.w === 'knife' ? { name: 'Knife', cls: 'MELEE' } : w, m.zone, dir.normalize(), at);
        return;
      }
      case 'nade': {
        if (!f || !f.alive || g.t - c.nadeT < 0.6) return;
        const p = vec(m.p), v = vec(m.v), L = LETHALS[m.lethal]; if (!p || !v || !L || !num(m.fuse)) return;
        c.nadeT = g.t;
        if (p.distanceTo(f.body.pos) > 4 || v.length() > 40) return;
        g.addNade(f, p, v, Math.max(0.05, Math.min(L.fuse, m.fuse)), L);
        g.emit({ t: 'nade', f });
        return;
      }
      case 'respawn': if (f && f.net) f.net.respawn = true; return;
      case 'cls': { const cls = CLASSES[m.i | 0]; c.cls = m.i | 0; if (f && cls) f.loadout = { primary: cls.primary, secondary: cls.secondary, lethal: cls.lethal }; return; }
      case 'streak': if (f && typeof m.id === 'string' && num(m.x) && num(m.z)) g.callStreak(f, m.id, m.x, m.z); return;
      case 'chat': {
        if (!f || g.t - c.chatT < 0.8) return;
        const text = this.clean(String(m.text || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100)); if (!text) return;
        c.chatT = g.t;
        this.sendAll({ t: 'chat', n: f.name, team: f.team, text });
        return;
      }
    }
  }

  // ------------------------------------------------------------------ the match
  tick() {
    if (!this.clients.size) return;                      // (nobody in: the match holds still, no CPU burnt)
    const g = this.game;
    if (g.over) { if (!this.restartAt) this.restartAt = Date.now() + 12000; else if (Date.now() > this.restartAt) this.newGame(); return; }
    g.step(TICK, null);
    this.flush();
    if ((this.tickN = (this.tickN || 0) + 1) % SNAP_EVERY === 0) this.sendAll(this.snap());
  }
  /** the match's events, on the wire (fighters by id, weapons by key) */
  flush() {
    const g = this.game, out = [];
    for (const e of g.events) {
      const id = x => x ? x.id : -1;
      switch (e.t) {
        case 'tracer': out.push({ t: 'shot', f: e.f.id, w: WKEY.get(e.f.gunner.w), o: R3(e.o), to: R3(e.to) }); break;
        case 'impact': if (e.f.brain) out.push({ t: 'impact', p: R3(e.p), n: R3(e.n) }); break;
        case 'hit': out.push({ t: 'hit', f: id(e.f), v: e.v.id, dmg: e.dmg, zone: e.zone, dir: e.dir ? R3(e.dir) : null, at: e.at ? R3(e.at) : null, kill: e.kill }); break;
        case 'kill': out.push({ t: 'kill', f: id(e.f), v: e.v.id, w: wireW(e.w), zone: e.zone, dir: e.dir ? R3(e.dir) : null, tags: e.tags }); break;
        case 'assist': out.push({ t: 'assist', f: e.f.id, v: e.v.id }); break;
        case 'spawn': out.push({ t: 'spawn', f: e.f.id, p: R3(e.f.body.pos), yaw: e.f.body.yaw, lo: e.f.loadout }); break;
        case 'streak': out.push({ t: 'streak', f: e.f.id, s: e.s.id }); break;
        case 'boom': out.push({ t: 'boom', p: R3(e.p), r: e.r, ice: e.ice }); break;
        case 'bounce': out.push({ t: 'bounce', p: R3(e.p) }); break;
        case 'nade': out.push({ t: 'nade', f: e.f.id }); break;
        case 'stuck': out.push({ t: 'stuck', f: id(e.f), v: e.v.id }); break;
        case 'flag': out.push({ t: 'flag', what: e.what, f: id(e.f), fl: e.fl.team }); break;
        case 'barrage': out.push({ t: 'barrage', f: e.f.id, p: R3(e.p), b: e.blasts.map(b => [R3(b.p), Math.round(b.t * 100) / 100]) }); break;
        case 'dragon': out.push({ t: 'dragon', f: e.f.id, a: R3(e.a), b: R3(e.b), lead: e.lead, dur: e.dur, bl: e.blasts.map(b => [R3(b.p), Math.round(b.t * 100) / 100]) }); break;
        case 'wrath': out.push({ t: 'wrath', f: e.f.id, left: e.left }); break;
        case 'wrathhit': out.push({ t: 'wrathhit', f: e.f.id }); break;
        case 'end': out.push({ t: 'end', winner: typeof e.winner === 'string' ? e.winner : id(e.winner) }); break;
      }
    }
    g.events.length = 0;
    if (out.length) this.sendAll({ t: 'e', e: out });
  }
  /** where everyone is, 15 times a second */
  snap() {
    const g = this.game, r = x => Math.round(x * 1000) / 1000;
    return {
      t: 's', T: r(g.t), tl: Math.round(g.timeLeft), sc: g.score,
      f: g.fighters.map(f => { const b = f.body; return [f.id, r(b.pos.x), r(b.pos.y), r(b.pos.z), r(b.yaw), r(b.pitch), r(b.crouch), r(b.vel.x), r(b.vel.y), r(b.vel.z),
        (f.alive ? 1 : 0) | (b.onGround ? 2 : 0) | (b.sprinting ? 4 : 0) | (b.slide > 0 ? 8 : 0) | (f.gunner.reloading ? 16 : 0) | (b.wading ? 32 : 0) | (f.uavT > 0 ? 64 : 0),
        Math.round(f.hp), f.gunner.cur, r(f.gunner.ads), f.kills, f.deaths, f.score, f.streak, f.caps, f.assists, f.ready.join(',')]; }),
      g: g.grenades.map(n => [n.id, r(n.p.x), r(n.p.y), r(n.p.z), r(n.v.x), r(n.v.y), r(n.v.z), n.L.sticky ? 1 : 0, n.rest || n.stuck || n.stuckWall ? 1 : 0, n.f ? n.f.id : -1]),
      fl: Object.fromEntries(Object.entries(g.flags).map(([k, fl]) => [k, [fl.state, r(fl.pos.x), r(fl.pos.y), r(fl.pos.z), fl.carrier ? fl.carrier.id : -1]])),
    };
  }
  sendAll(msg, except = null) { const s = JSON.stringify(msg); for (const c of this.clients) if (c !== except && c.f) c.ws.send(s); }
}
