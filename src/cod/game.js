// A CODScape match: the fighters, their bullets, the score. Team Deathmatch, Capture the Flag (Castle Wars'
// own: the flags stand on top of the castles) and Free-for-all. No rendering here (src/cod/main.js draws it;
// test/cod.js plays whole bot matches headless): every fighter is a Body + a Gunner, steered by the player's
// input or a bot brain, and what happens comes back as events for the HUD and the speakers.
import * as THREE from 'three';
import { Arena, S } from './arena.js';
import { Body, MOVE } from './body.js';
import { Gunner } from './gunner.js';
import { WEAPONS, LETHALS, CLASSES, NADE, KNIFE, HP, REGEN_DELAY, REGEN_RATE, damageAt } from './weapons.js';
import { Brain, BOT_NAMES } from './bots.js';
import { rayCapsule } from './soldier.js';

export const MODES = {
  tdm: { name: 'TEAM DEATHMATCH', short: 'TDM', teams: true, limit: 50, time: 600, respawn: 3, desc: 'First side to the kill limit.' },
  ctf: { name: 'CAPTURE THE FLAG', short: 'CTF', teams: true, limit: 3, time: 600, respawn: 5, desc: "Castle Wars: take their standard off their tower, bring it home to yours." },
  ffa: { name: 'FREE-FOR-ALL', short: 'FFA', teams: false, limit: 25, time: 600, respawn: 2.5, desc: 'Everyone for themselves.' },
};
export const STREAKS = [{ n: 3, id: 'uav', name: 'UAV', desc: 'enemies on your minimap' }, { n: 5, id: 'barrage', name: 'ICE BARRAGE', desc: 'blasts rain on the enemy' }, { n: 7, id: 'vengeance', name: 'VENGEANCE', desc: 'take the next one with you' }];
const TEAM_HALF = { sara: [2400, 3072, 2431, 3103], zam: [2368, 3104, 2399, 3135] };
const FLAG_R = 1.4;                                        // touch distance for a flag

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3();

export class Fighter {
  constructor(game, { id, name, team, bot = null, loadout, player = false }) {
    Object.assign(this, { game, id, name, team, player });
    this.loadout = loadout; this.gunner = new Gunner(loadout);
    this.body = new Body(new THREE.Vector3());
    this.brain = bot ? new Brain(this, bot) : null;
    this.hp = HP; this.alive = false; this.respawnT = 0; this.regenT = 0;
    this.kills = 0; this.deaths = 0; this.score = 0; this.streak = 0; this.caps = 0; this.returns = 0; this.assists = 0;
    this.lastShotT = -99; this.carrying = null; this.hurtBy = new Map(); this.uavT = 0; this.vengeance = false;
    this.yawTrail = []; this.adsStart = -1; this.recoil = { p: 0, y: 0 };
    this.avatar = null;                                    // set by the renderer
  }
  get w() { return this.gunner.w; }
  eye(out = new THREE.Vector3()) { return this.body.eye(out); }
  /** ray test against this fighter: the posed avatar's zones if drawn, else a stand-in made of the body */
  hit(o, d, far) {
    if (this.avatar && this.avatar.P && !this.avatar.rag) return this.avatar.hit(o, d, far);
    const b = this.body, p = b.pos, h = b.height, best = [];
    const A = (y) => _v.set(p.x, p.y + y, p.z).clone();
    for (const [a, c, r, zone] of [[h - 0.16, h - 0.16, 0.15, 'head'], [h - 0.35, h * 0.62, 0.21, 'chest'], [h * 0.62, h * 0.45, 0.2, 'stomach'], [h * 0.45, 0.1, 0.17, 'limb']]) {
      const t = rayCapsule(o, d, A(a), A(c), r); if (t !== null && t < far) best.push({ t, zone });
    }
    best.sort((x, y) => x.t - y.t); return best[0] || null;
  }
}

export class Game {
  /**
   * opts: { mode, difficulty, perTeam (bots a side, player included), playerTeam, loadout (player's),
   * limit, time, name }
   */
  constructor(arena, opts) {
    this.arena = arena; this.opts = opts;
    this.mode = MODES[opts.mode] || MODES.tdm; this.modeId = opts.mode in MODES ? opts.mode : 'tdm';
    this.limit = opts.limit || this.mode.limit; this.timeLeft = opts.time || this.mode.time;
    this.score = { sara: 0, zam: 0 }; this.t = 0; this.over = false; this.winner = null;
    this.fighters = []; this.events = []; this.feed = []; this.grenades = []; this.blasts = []; this.tracers = [];
    if (!arena.nav) arena.buildNav();
    this.spawnNodes = {};
    for (const [k, T] of Object.entries(Arena.TEAMS)) {
      const near = arena.nodesIn(T.area), half = arena.nodesIn(TEAM_HALF[k]);
      this.spawnNodes[k] = { near: near.filter(i => arena.nav.nodes[i].n.length >= 6), half: half.filter(i => arena.nav.nodes[i].n.length >= 6) };
    }
    this.allNodes = arena.nav.nodes.map((n, i) => i).filter(i => arena.nav.nodes[i].ok && arena.nav.nodes[i].n.length >= 6);
    // the flags: on the castle tops
    this.flags = {};
    for (const [k, T] of Object.entries(Arena.TEAMS)) {
      const p = arena.at(...T.flag), y = arena.floor(p.x, 12, p.z, 0, 20);
      this.flags[k] = { team: k, home: new THREE.Vector3(p.x, y, p.z), pos: new THREE.Vector3(p.x, y, p.z), state: 'home', carrier: null, dropT: 0 };
    }
    // the sides
    const per = Math.max(1, opts.perTeam || 6), names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    let id = 0;
    const loadouts = BOT_LOADOUTS;
    const add = (team, isPlayer) => {
      const f = new Fighter(this, isPlayer ? { id: id++, name: opts.name || 'You', team, loadout: opts.loadout, player: true }
        : { id: id++, name: names.pop() || 'Bot' + id, team, bot: opts.difficulty || 'regular', loadout: loadouts[Math.floor(Math.random() * loadouts.length)] });
      this.fighters.push(f); return f;
    };
    if (this.mode.teams) {
      const pt = opts.playerTeam === 'zam' ? 'zam' : 'sara', other = pt === 'sara' ? 'zam' : 'sara';
      if (opts.spectate) { for (let i = 0; i < per; i++) add(pt, false); }
      else { this.player = add(pt, true); for (let i = 1; i < per; i++) add(pt, false); }
      for (let i = 0; i < per; i++) add(other, false);
    } else {
      if (!opts.spectate) this.player = add('ffa0', true);
      for (let i = 1; i < per * 2; i++) { const f = add('ffa' + i, false); f.team = 'ffa' + f.id; }
      if (this.player) this.player.team = 'ffa' + this.player.id;
    }
    for (const f of this.fighters) this.spawn(f, true);
  }

  enemies(f) { return this.fighters.filter(o => o !== f && o.alive && o.team !== f.team); }
  emit(e) { this.events.push(e); }
  teamOf(f) { return this.mode.teams ? f.team : null; }

  // ------------------------------------------------------------------ spawning
  spawn(f, first = false) {
    const A = this.arena, N = A.nav.nodes;
    let cands;
    if (this.mode.teams) cands = first || this.modeId === 'ctf' ? this.spawnNodes[f.team].near : this.spawnNodes[f.team].half;
    else cands = this.allNodes;
    // Call of Duty spawn logic, lite: of a handful of candidates, the one furthest from any living enemy (and
    // never in one's sight); team spawns lean toward teammates
    const foes = this.fighters.filter(o => o.alive && o.team !== f.team);
    let best = null, bs = -Infinity;
    for (let k = 0; k < 14; k++) {
      const i = cands[Math.floor(Math.random() * cands.length)], n = N[i];
      let s = 0, dmin = 99;
      for (const e of foes) { const d = Math.hypot(e.body.pos.x - n.x, e.body.pos.z - n.z); dmin = Math.min(dmin, d); if (d < 40 && this.canSee(_o.set(n.x, n.y + 1.5, n.z), e.eye(_v))) s -= 30; }
      s += Math.min(dmin, 40) + Math.random() * 4;
      if (s > bs) { bs = s; best = n; }
    }
    const b = f.body;
    b.pos.set(best.x, best.y + 0.02, best.z); b.vel.set(0, 0, 0); b.onGround = true; b.slide = 0; b.crouch = 0; b.sprinting = false;
    // face the middle of the arena
    const mid = A.at(2400, 3104); b.yaw = Math.atan2(-(mid.x - b.pos.x), -(mid.z - b.pos.z)); b.pitch = 0;
    f.hp = HP; f.alive = true; f.regenT = 0; f.hurtBy.clear(); f.carrying = null;
    f.gunner = new Gunner(f.loadout); f.streakAt = f.streak = 0; f.vengeance = false;
    f.spawnT = this.t;
    if (f.brain) f.brain.reset();
    this.emit({ t: 'spawn', f });
  }

  canSee(a, b) {
    _d.subVectors(b, a); const L = _d.length(); _d.multiplyScalar(1 / L);
    return !this.arena.ray(a, _d, L - 0.05);
  }

  // ------------------------------------------------------------------ the frame
  /** inp: the player's { move: {x,z,sprint,crouch,crouchEdge,jump}, gun: {fire, ads, reload, swap, knife, nade}, look: {dyaw, dpitch} } */
  step(dt, inp = null) {
    if (this.over) return;
    this.t += dt; this.timeLeft -= dt;
    for (const f of this.fighters) {
      if (!f.alive) {
        f.respawnT -= dt;
        if (f.respawnT <= 0 && !(f.player && inp && !inp.respawn && f.respawnT > -10)) this.spawn(f);
        continue;
      }
      let move, gun;
      if (f.brain) ({ move, gun } = f.brain.think(dt, this));
      else if (inp) {
        ({ move, gun } = inp);
        f.body.yaw += inp.look.dyaw; f.body.pitch = Math.max(-1.45, Math.min(1.45, f.body.pitch + inp.look.dpitch));
        f.yawTrail.push([this.t, inp.look.dyaw]); while (f.yawTrail.length && f.yawTrail[0][0] < this.t - 1.5) f.yawTrail.shift();   // (a 360 counts if the spin was within the last 1.5 s)
      } else { move = {}; gun = {}; }
      // recoil recovers toward where you were aiming (Call of Duty pulls most of it back down)
      const rec = f.recoil, k = Math.min(1, dt * 7);
      f.body.pitch -= rec.p * k; f.body.yaw -= rec.y * k; rec.p -= rec.p * k; rec.y -= rec.y * k;
      const G = f.gunner, w = G.w;
      const bev = f.body.update(dt, { ...move, ads: G.ads > 0.3 ? G.ads : 0 }, this.arena, w.move * (f.carrying ? 0.9 : 1));
      for (const e of bev) this.emit({ t: 'move', e, f });
      const prevAds = G.ads;
      const gev = G.update(dt, { ...gun, sprinting: f.body.sprinting || f.body.slide > 0, moving: Math.hypot(f.body.vel.x, f.body.vel.z) / MOVE.walk, air: !f.body.onGround });
      if (prevAds < 0.9 && G.ads >= 0.9) f.adsStart = this.t;
      for (const e of gev) this.gunEvent(f, e);
      // health comes back
      f.regenT += dt;
      if (f.regenT > REGEN_DELAY && f.hp < HP) f.hp = Math.min(HP, f.hp + REGEN_RATE * dt);
      if (f.uavT > 0) f.uavT -= dt;
      if (this.modeId === 'ctf') this.flagTouch(f);
    }
    this.stepGrenades(dt);
    this.stepBlasts(dt);
    if (this.modeId === 'ctf') for (const fl of Object.values(this.flags)) {
      if (fl.state === 'carried' && fl.carrier) fl.pos.copy(fl.carrier.body.pos);
      if (fl.state === 'dropped' && (fl.dropT -= dt) <= 0) this.returnFlag(fl, null);
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) if ((this.tracers[i].t -= dt) <= 0) this.tracers.splice(i, 1);
    // the end
    if (this.timeLeft <= 0) this.end();
    if (this.mode.teams && Math.max(this.score.sara, this.score.zam) >= this.limit) this.end();
    if (!this.mode.teams && this.fighters.some(f => f.kills >= this.limit)) this.end();
  }

  end() {
    if (this.over) return;
    this.over = true;
    if (this.mode.teams) this.winner = this.score.sara === this.score.zam ? 'draw' : this.score.sara > this.score.zam ? 'sara' : 'zam';
    else this.winner = [...this.fighters].sort((a, b) => b.kills - a.kills)[0];
    this.emit({ t: 'end', winner: this.winner });
  }

  gunEvent(f, e) {
    const G = f.gunner, w = G.w;
    if (typeof e === 'object' && e.t === 'shot') {
      f.lastShotT = this.t;
      this.emit({ t: 'shot', f, w });
      for (let i = 0; i < e.pellets; i++) this.bullet(f, w, i === 0);
      // kick: the camera climbs (less aimed and crouched), with a jitter sideways
      const kk = (G.ads > 0.9 ? 0.6 : 1) * (f.body.crouch > 0.5 ? 0.8 : 1) * Math.PI / 180;
      const p = w.recoil[0] * kk * (0.85 + Math.random() * 0.3), y = (Math.random() - 0.45) * w.recoil[1] * kk * 2;
      f.body.pitch += p; f.body.yaw += y; f.recoil.p += p * 0.62; f.recoil.y += y * 0.5;
      return;
    }
    if (typeof e === 'object' && e.t === 'throw') { this.throwNade(f, e.cook); return; }
    if (e === 'knife') this.knife(f);
    this.emit({ t: 'gun', e, f, w });
  }

  // ------------------------------------------------------------------ bullets
  bullet(f, w, first) {
    const G = f.gunner, b = f.body;
    const o = f.eye(new THREE.Vector3()), d = b.look(new THREE.Vector3());
    const sp = G.spreadDeg(Math.hypot(b.vel.x, b.vel.z) / MOVE.walk, !b.onGround, b.crouch > 0.5) * Math.PI / 180;
    if (sp > 0) {                                          // a random point in the cone
      const r = sp * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
      const right = new THREE.Vector3(Math.cos(b.yaw), 0, -Math.sin(b.yaw)), up = new THREE.Vector3().crossVectors(right, d).normalize();
      d.addScaledVector(right, Math.cos(a) * Math.tan(r)).addScaledVector(up, Math.sin(a) * Math.tan(r)).normalize();
    }
    if (f.brain) f.brain.aimNoise(d);
    const far = 300, wall = this.arena.ray(o, d, far);
    let wallT = wall ? wall.distance : far, hit = null, who = null;
    for (const e of this.fighters) {
      if (e === f || !e.alive || (this.mode.teams && e.team === f.team)) continue;
      const h = e.hit(o, d, wallT);
      if (h && (!hit || h.t < hit.t)) { hit = h; who = e; }
    }
    const end = o.clone().addScaledVector(d, hit ? hit.t : wallT);
    if (first || w.pellets) this.tracers.push({ from: f.avatar && !f.player ? f.avatar.muzzleWorld(new THREE.Vector3()) : null, o: o.clone(), to: end, t: 0.06, f, w });
    if (hit) {
      const dmg = damageAt(w, hit.t, hit.zone);
      this.damage(who, dmg, f, w, hit.zone, d, end);
      G.stats.hits++;
    } else if (wall) this.emit({ t: 'impact', p: end, n: wall.normal, w, f });
    // a near miss whizzes past: bots hear where it came from
    for (const e of this.fighters) if (e.brain && e.alive && e !== f && e.team !== f.team) {
      const ep = e.eye(_v), t = Math.max(0, Math.min(hit ? hit.t : wallT, _o.subVectors(ep, o).dot(d)));
      if (o.clone().addScaledVector(d, t).distanceTo(ep) < 3) e.brain.heard(f, 1);
    }
  }

  /** hurt a fighter (bullets, blasts, the knife); dir: the way the hit travelled */
  damage(v, dmg, f, w, zone, dir, at) {
    if (!v.alive || dmg <= 0) return;
    if (f && this.mode.teams && f !== v && f.team === v.team) return;      // no friendly fire
    v.hp -= dmg; v.regenT = 0;
    if (f) v.hurtBy.set(f, (v.hurtBy.get(f) || 0) + dmg);
    this.emit({ t: 'hit', f, v, dmg: Math.round(dmg), zone, dir, at, kill: v.hp <= 0, w });
    if (v.brain && f) v.brain.heard(f, 2);
    if (v.hp <= 0) this.kill(v, f, w, zone, dir);
  }

  kill(v, f, w, zone, dir) {
    v.alive = false; v.hp = 0; v.deaths++; v.streak = 0; v.respawnT = this.mode.respawn;
    v.diedAt = v.body.pos.clone(); v.killer = f; v.killedWith = w;
    const tags = [];
    if (f && f !== v) {
      f.kills++; f.streak++; f.score += 100;
      if (zone === 'head') { tags.push('HEADSHOT'); f.score += 50; }
      if (w && w.cls === 'SNIPER' && f.gunner.ads < 0.9 && w !== KNIFE) {
        tags.push('NOSCOPE'); f.score += 100;
        const spin = Math.abs(f.yawTrail.reduce((a, [, dy]) => a + dy, 0));
        if (spin >= Math.PI * 2 * 0.92) { tags.unshift('360'); f.score += 500; }
      }
      if (w && w.cls === 'SNIPER' && f.gunner.ads >= 0.9 && this.t - f.adsStart < 0.55) { tags.push('QUICKSCOPE'); f.score += 100; }
      if (f.alive === false) tags.push('FROM THE GRAVE');
      if (v.carrying) { tags.push('CARRIER KILL'); f.score += 100; }
      if (this.mode.teams) { if (this.modeId === 'tdm') this.score[f.team]++; }
      // assists: anyone else who hurt them
      for (const [o, d] of v.hurtBy) if (o !== f && o !== v && d >= 30) { o.assists++; o.score += 50; this.emit({ t: 'assist', f: o, v }); }
      for (const s of STREAKS) if (f.streak === s.n) this.reward(f, s);
    }
    if (v.carrying) this.dropFlag(v);
    this.feed.push({ k: f, v, w, tags, t: this.t });
    if (this.feed.length > 6) this.feed.shift();
    this.emit({ t: 'kill', f, v, w, zone, dir, tags });
    if (v.vengeance) { v.vengeance = false; this.explode(v.body.pos.clone().add(_v.set(0, 0.5, 0)), 7, 160, v, { name: 'Vengeance' }); }
  }

  reward(f, s) {
    this.emit({ t: 'streak', f, s });
    if (s.id === 'uav') for (const o of this.fighters) if (!this.mode.teams ? o === f : o.team === f.team) o.uavT = 30;
    if (s.id === 'vengeance') f.vengeance = true;
    if (s.id === 'barrage') {                                 // blasts land on (and around) where the enemy are, after a warning
      const foes = this.enemies(f);
      for (let i = 0; i < 7; i++) {
        const e = foes[i % Math.max(1, foes.length)]; if (!e) break;
        const p = e.body.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6));
        this.blasts.push({ p, t: 1.6 + i * 0.35, f, r: 5.5, dmg: 140, name: 'Ice Barrage' });
      }
    }
  }
  stepBlasts(dt) {
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i]; b.t -= dt;
      if (b.t <= 0) { b.p.y = this.arena.floor(b.p.x, b.p.y + 10, b.p.z, 0, 30) + 0.3; this.explode(b.p, b.r, b.dmg, b.f, { name: b.name, ice: true }); this.blasts.splice(i, 1); }
    }
  }

  knife(f) {
    const b = f.body, look = b.look(new THREE.Vector3()); look.y = 0; look.normalize();
    let best = null, bd = KNIFE.lunge;
    for (const e of this.enemies(f)) {
      const d = _v.subVectors(e.body.pos, b.pos), dy = Math.abs(d.y); d.y = 0; const L = d.length();
      if (L < bd && dy < 1.2 && d.normalize().dot(look) > 0.55 && this.canSee(f.eye(_o), e.eye(new THREE.Vector3()))) { bd = L; best = e; }
    }
    if (best) {
      if (bd > KNIFE.reach * 0.6) { const d = _v.subVectors(best.body.pos, b.pos); d.y = 0; d.setLength(Math.min(bd - 0.5, KNIFE.lunge)); b.vel.x += d.x * 6; b.vel.z += d.z * 6; }
      this.damage(best, KNIFE.dmg, f, { name: 'Knife', cls: 'MELEE' }, 'chest', look);
    }
  }

  // ------------------------------------------------------------------ grenades
  throwNade(f, cook) {
    const L = LETHALS[f.gunner.lethal], d = f.body.look(new THREE.Vector3());
    const v = d.clone().multiplyScalar(NADE.speed).add(new THREE.Vector3(0, NADE.lift, 0)).add(_v.set(f.body.vel.x, 0, f.body.vel.z).multiplyScalar(0.5));
    const p = f.eye(new THREE.Vector3()).addScaledVector(d, 0.5);
    this.grenades.push({ p, v, fuse: L.fuse - cook, f, L, stuck: null, id: Math.random() });
    this.emit({ t: 'nade', f });
  }
  stepGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      if (g.stuck) { if (g.stuck.alive) g.p.copy(g.stuck.body.pos).add(_v.set(0, 1.1, 0)); }
      else {
        g.v.y -= NADE.g * dt; g.air = (g.air || 0) + dt;
        if (g.rest) g.v.y = 0;                                           // (lying on the floor: gravity doesn't drag it through)
        const step = g.v.length() * dt;
        if (step > 0) {
          _d.copy(g.v).normalize();
          const h = this.arena.ray(g.p, _d, step + 0.06);
          if (h) {
            g.p.copy(h.point).addScaledVector(h.normal, 0.06);
            if (g.L.sticky) { g.v.set(0, 0, 0); g.stuckWall = true; }
            else {
              const vn = h.normal.clone().multiplyScalar(g.v.dot(h.normal)); g.v.sub(vn.multiplyScalar(1.4)).multiplyScalar(0.5);
              if (h.normal.y > 0.7 && g.v.length() < 1.2) g.v.set(0, 0, 0), g.rest = true;   // (settled: lie still instead of buzzing on the floor)
              else this.emit({ t: 'bounce', p: g.p.clone() });
              g.air = 0;
            }
          } else if (!g.stuckWall) { g.p.addScaledVector(g.v, dt); g.rest = false; }
        }
        if (g.L.sticky && !g.stuckWall) for (const e of this.fighters) if (e.alive && e !== g.f && e.body.pos.distanceTo(g.p) < 0.9 + (g.p.y - e.body.pos.y < 2 ? 0.3 : 0) && g.p.y > e.body.pos.y - 0.2 && g.p.y < e.body.pos.y + 2) { g.stuck = e; this.emit({ t: 'stuck', f: g.f, v: e }); }
        if (!this.arena.inBounds(g.p.x, g.p.z, 0)) { g.v.x *= -0.5; g.v.z *= -0.5; }
      }
      if (g.fuse <= 0) { this.explode(g.p.clone(), g.L.radius, g.L.dmg, g.f, { name: g.L.name }); this.grenades.splice(i, 1); }
    }
  }
  /** a blast: damage falls off with distance; walls in between shield you */
  explode(p, r, dmg, f, w) {
    this.emit({ t: 'boom', p: p.clone(), r, ice: !!w.ice });
    for (const e of this.fighters) {
      if (!e.alive) continue;
      if (f && this.mode.teams && e !== f && e.team === f.team) continue;
      const c = e.body.pos.clone().add(_v.set(0, 1, 0)), d = c.distanceTo(p);
      if (d > r || !this.canSee(p.clone().add(_v.set(0, 0.2, 0)), c)) continue;
      const k = 1 - d / r, amount = dmg * (0.25 + 0.75 * k) * (e === f ? 0.6 : 1);
      this.damage(e, amount, f, { ...w, cls: 'LETHAL' }, 'chest', c.clone().sub(p).normalize());
    }
  }

  // ------------------------------------------------------------------ Castle Wars flags
  flagTouch(f) {
    for (const fl of Object.values(this.flags)) {
      const near = f.body.pos.distanceTo(fl.pos) < FLAG_R + (fl.state === 'home' ? 0.4 : 0);
      if (!near) continue;
      if (fl.team !== f.team && (fl.state === 'home' || fl.state === 'dropped') && !f.carrying) {
        fl.state = 'carried'; fl.carrier = f; f.carrying = fl.team; f.score += 100;
        this.emit({ t: 'flag', what: 'taken', f, fl });
      } else if (fl.team === f.team && fl.state === 'dropped') { this.returnFlag(fl, f); }
      else if (fl.team === f.team && fl.state === 'home' && f.carrying) {
        const theirs = this.flags[f.carrying];
        this.returnFlag(theirs, null, true);
        f.carrying = null; f.caps++; f.score += 500; this.score[f.team]++;
        this.emit({ t: 'flag', what: 'captured', f, fl: theirs });
      }
    }
  }
  dropFlag(v) {
    const fl = this.flags[v.carrying]; if (!fl) return;
    fl.state = 'dropped'; fl.carrier = null; fl.dropT = 30; v.carrying = null;
    fl.pos.copy(v.body.pos);
    this.emit({ t: 'flag', what: 'dropped', f: v, fl });
  }
  returnFlag(fl, f, quiet = false) {
    fl.state = 'home'; fl.carrier = null; fl.pos.copy(fl.home);
    if (f) { f.returns++; f.score += 100; }
    if (!quiet) this.emit({ t: 'flag', what: 'returned', f, fl });
  }

  /** the sides' fighters, best first (the scoreboard) */
  board() {
    const by = f => (b, a) => (a.score - b.score) || (a.kills - b.kills);
    if (!this.mode.teams) return { all: [...this.fighters].sort(by()) };
    return { sara: this.fighters.filter(f => f.team === 'sara').sort(by()), zam: this.fighters.filter(f => f.team === 'zam').sort(by()) };
  }
}

// what the bots carry: the player's five classes, weighted like a real lobby (lots of ARs/SMGs, few snipers)
export const BOT_LOADOUTS = [0, 0, 0, 1, 1, 1, 2, 3, 4].map(i => CLASSES[i]);
export { S };
