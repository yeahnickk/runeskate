// Bots: they see you (line of sight through the real castle, a field of view), hear you (your shots, your
// near misses), take a moment to react, and aim like people: a flick that lands near you and settles onto
// you while they track, turned no faster than a hand can turn. They strafe in a fight, aim down sights at
// range, reload in cover, throw grenades at where you were, knife you up close. Between fights they play the
// mode: hunt in TDM / FFA; in CTF they split into attackers and defenders, run the flag home, chase down the
// carrier and return a dropped flag. Snipers take a tower or a wall walk and hold it.
// Four difficulties, Call of Duty's names: Recruit, Regular, Hardened, Veteran.
import * as THREE from 'three';
import { Arena } from './arena.js';
import { lobPitch } from './weapons.js';

export const DIFFICULTY = {
  recruit: { name: 'RECRUIT', react: 0.75, err: 9, settle: 1.6, turn: 3.0, head: 0.08, fov: 0.45, hear: 22, strafe: 0.3, burst: [0.15, 0.45], nade: 0, fireCone: 2.6, spot: 0.5, wobble: 2.4, range: 30, floor: 0.35 },
  regular: { name: 'REGULAR', react: 0.45, err: 5.5, settle: 1.1, turn: 5.0, head: 0.18, fov: 0.35, hear: 30, strafe: 0.6, burst: [0.25, 0.7], nade: 0.25, fireCone: 2.0, spot: 0.7, wobble: 1.5, range: 45, floor: 0.25 },
  hardened: { name: 'HARDENED', react: 0.28, err: 3.2, settle: 0.75, turn: 8.0, head: 0.32, fov: 0.25, hear: 38, strafe: 0.85, burst: [0.35, 1.0], nade: 0.5, fireCone: 1.6, spot: 0.85, wobble: 0.9, range: 65, floor: 0.15 },
  veteran: { name: 'VETERAN', react: 0.17, err: 1.8, settle: 0.45, turn: 12.0, head: 0.5, fov: 0.15, hear: 46, strafe: 1, burst: [0.5, 1.4], nade: 0.8, fireCone: 1.2, spot: 1, wobble: 0.45, range: 95, floor: 0.08 },
};
export const BOT_NAMES = ['Zezima', 'Durial321', 'Bluerose13x', 'Tedward', 'S U O M I', 'Lilyuffie88', 'Purepker895', 'Cow1337killr', 'Alkan', 'Drumgun',
  'Woox', 'Mr Mammal', 'Settled', 'B0aty', 'Sparc Mac', 'Torvesta', 'Framed', 'Mmorpg', 'King Kongo', 'Odablock', 'Hey Jase', 'A Friend', 'Zaros', 'Iron Hyger',
  'Gl Hf', 'Noob4life', 'Buying Gf', 'Sit', 'Sir Pugger', 'Dragon Slyr', 'Wizzy Kid', 'Lumby Guard', 'Varrock Vic', 'Rune Pure'];

const TAU = Math.PI * 2;
const angWrap = a => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _e = new THREE.Vector3();

export class Brain {
  constructor(f, level) {
    this.f = f; this.D = DIFFICULTY[level] || DIFFICULTY.regular;
    this.role = Math.random() < 0.3 ? 'defend' : 'attack';
    if (f.loadout.primary === 'intervention' || f.loadout.primary === 'barrett') this.role = 'snipe';
    this.reset();
  }
  reset() {
    this.target = null; this.seenT = 0; this.lostT = 0; this.known = null; this.knownT = -99;
    this.path = null; this.pi = 0; this.goal = -1; this.goalT = 0; this.stuck = 0; this.best = Infinity; this.repaths = 0;
    this.errX = 0; this.errY = 0; this.strafe = 0; this.strafeT = 0; this.fireT = 0; this.pauseT = 0; this.crouch = false;
    this.lookT = 0; this.nadeT = 8 + Math.random() * 8; this.checkT = 0; this.holdYaw = null; this.perch = null; this.cooking = 0; this.turnTo = null; this.next = null;
  }

  /** a shot or a hit told us where someone is */
  heard(o, strength) {
    if (!o.alive) return;
    if (!this.target || this.target === o) { this.known = o.body.pos.clone(); this.knownT = this.f.game.t; this.knownWho = o; }
    if (strength >= 2 && !this.target) this.turnTo = o.body.pos.clone();
  }

  /** a bot's own shot: the aim error it has not settled out of yet goes into the bullet */
  /** every shot wanders off the aim point a little (a person's hands, not a turret): misses grow with range */
  aimNoise(d) {
    const a = this.D.wobble * Math.PI / 180 * Math.sqrt(Math.random()), t = Math.random() * Math.PI * 2;
    const u = Math.abs(d.y) < 0.9 ? _w.set(0, 1, 0) : _w.set(1, 0, 0), r = _v.crossVectors(d, u).normalize(), up = u.crossVectors(r, d).normalize();
    d.addScaledVector(r, Math.cos(t) * Math.tan(a)).addScaledVector(up, Math.sin(t) * Math.tan(a)).normalize();
  }

  think(dt, game) {
    const f = this.f, b = f.body, D = this.D, G = f.gunner, w = G.w;
    const move = { x: 0, z: 0, sprint: false, crouch: false, crouchEdge: false, jump: false };
    const gun = { fire: false, ads: false, reload: false, swap: false, knife: false, nade: false };
    // ---- who can I see? (a few times a second, like a person glancing)
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 0.12 + Math.random() * 0.08;
      const eye = f.eye(_e), look = b.look(_w);
      let best = null, bs = Infinity;
      for (const e of game.enemies(f)) {
        const head = e.eye(_v), d = head.distanceTo(eye);
        if (d > 140) continue;
        const dir = _v.clone().sub(eye).normalize(), inFov = dir.dot(look) > D.fov - 0.1 || d < 5;
        const loud = game.t - e.lastShotT < 0.6 && d < D.hear * (e.gunner.w.cls === 'SNIPER' ? 2 : 1);
        if (!inFov && !loud && e !== this.target) continue;
        // visible: the head or the chest clear through the castle
        const chest = e.body.pos.clone().add(_v.set(0, 1.0, 0));
        if (!game.canSee(eye, head.clone()) && !game.canSee(eye, chest)) continue;
        if (!inFov && loud) { this.heard(e, 1); continue; }
        const s = d * (e === this.target ? 0.6 : 1) * (e.carrying ? 0.5 : 1);
        if (s < bs) { bs = s; best = e; }
      }
      if (best !== this.target) {
        if (best) { this.seenT = 0; const k = D.err * Math.PI / 180; this.errX = (Math.random() - 0.5) * 2 * k; this.errY = (Math.random() - 0.4) * 1.6 * k; this.aimHead = Math.random() < D.head; }
        this.target = best;
      }
      if (best) { this.known = best.body.pos.clone(); this.knownT = game.t; this.knownWho = best; this.lostT = 0; }
    }
    if (this.target && !this.target.alive) this.target = null;

    // ---- a flag runner runs: sprint home, only fight someone right on top of you
    if (f.carrying && (!this.target || this.target.body.pos.distanceTo(b.pos) > 9)) {
      this.navigate(dt, game, move, this.flagGoal(game));
      move.sprint = move.z > 0.5; gun.ads = false;
      if (this.next) { const dx = this.next.x - b.pos.x, dz = this.next.z - b.pos.z; if (Math.hypot(dx, dz) > 0.2) b.yaw += angWrap(Math.atan2(-dx, -dz) - b.yaw) * Math.min(1, dt * 10); b.pitch *= 0.9; }
      return { move, gun };
    }
    // ---- fight
    if (this.target) {
      const e = this.target, eye = f.eye(_e);
      this.seenT += dt;
      const aimAt = e.body.pos.clone().add(_v.set(0, this.aimHead ? e.body.height - 0.15 : e.body.height * 0.68, 0));
      // lead a moving target a touch (better bots more)
      aimAt.addScaledVector(e.body.vel, Math.min(0.12, eye.distanceTo(aimAt) / (w.vel || 800)) * D.spot);
      const dir = aimAt.sub(eye).normalize(), dist = e.body.pos.distanceTo(b.pos);
      // the error settles while they track you
      const settle = Math.exp(-dt / D.settle * 2.2), fl = D.floor * Math.PI / 180;     // (never all the way: a floor of shake that keeps re-rolling)
      this.errX *= settle; this.errY *= settle;
      if (Math.abs(this.errX) < fl && Math.random() < dt * 3) this.errX = (Math.random() - 0.5) * 2 * fl;
      if (Math.abs(this.errY) < fl && Math.random() < dt * 3) this.errY = (Math.random() - 0.5) * 2 * fl;
      const wantYaw = Math.atan2(-dir.x, -dir.z) + this.errX, wantPitch = Math.asin(Math.max(-1, Math.min(1, dir.y))) + this.errY;
      const dy = angWrap(wantYaw - b.yaw), dp = wantPitch - b.pitch, turn = D.turn * dt * (this.seenT < D.react ? 0.35 : 1);
      b.yaw += Math.max(-turn, Math.min(turn, dy)); b.pitch += Math.max(-turn, Math.min(turn, dp));
      const off = Math.hypot(angWrap(wantYaw - b.yaw), wantPitch - b.pitch), onTarget = off < (D.fireCone + Math.atan(0.35 / Math.max(1, dist)) * 180 / Math.PI) * Math.PI / 180;
      // aim down sights at range; snipers always
      const close = w.cls === 'SHOTGUN' || (w.cls === 'SMG' && dist < 10) || dist < 5;
      gun.ads = !close && this.seenT > D.react * 0.5;
      // shoot once reacted: auto in bursts, semi/bolt one at a time once on target and (scoped) once aimed
      const inRange = dist < D.range * (w.cls === 'SNIPER' ? 2.2 : w.cls === 'SHOTGUN' ? 0.5 : w.cls === 'SMG' ? 0.8 : 1);   // (past it they hold, track, and close in)
      if (this.seenT >= D.react && onTarget && inRange && (!w.scope || G.ads > 0.95 || dist < 6)) {
        if (w.kind === 'auto') {                     // bursts: longer up close, short taps at range
          if (this.fireT > 0) { this.fireT -= dt; gun.fire = true; }
          else if ((this.pauseT -= dt) <= 0) { this.fireT = (D.burst[0] + Math.random() * (D.burst[1] - D.burst[0])) * (dist > 25 ? 0.5 : 1); this.pauseT = 0.12 + Math.random() * 0.2 * Math.min(2, dist / 20); }
        } else gun.fire = !G.trig && Math.random() < dt * (w.kind === 'bolt' ? 6 : 9);
      }
      // knife up close
      if (dist < 1.8 && Math.random() < dt * 4 * D.spot) gun.knife = true;
      // out of rounds: reload, or the sidearm if they're close
      if (G.g.ammo === 0) { if (dist < 12 && G.slots[1 - G.cur]?.ammo > 0 && G.cur === 0) gun.swap = true; else gun.reload = true; }
      // move: strafe, sometimes crouch, push in with close-range guns, back off a sniper
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = 0.4 + Math.random() * 1.1; this.strafe = Math.random() < D.strafe ? (Math.random() < 0.5 ? -1 : 1) : 0; this.crouch = Math.random() < D.strafe * 0.25 && !close; }
      move.x = this.strafe * (G.ads > 0.5 ? 0.8 : 1);
      move.z = close && dist > 3 ? 1 : w.cls === 'SNIPER' && dist < 10 ? -0.6 : 0;
      move.crouch = this.crouch && dist > 12;
      if (this.strafe && Math.random() < dt * 0.4 * D.strafe && b.onGround && !w.scope) move.jump = true;   // the jump shot
      // CTF: the flag runner, the attackers and anyone chasing their own stolen flag keep moving on the
      // objective while they shoot (only a defender, or someone right on top of the enemy, stands and fights)
      if (game.modeId === 'ctf' && (f.carrying || this.role === 'attack' || game.flags[f.team].state !== 'home') && dist > 4) {
        const sx = move.x * 0.4; this.navigate(dt, game, move, this.objective(game)); move.x = Math.max(-1, Math.min(1, move.x + sx)); move.sprint = false;
      }
      // look away from a wall we're strafing into: handled by the body pushing out
      this.lostT = 0;
      return { move, gun };
    }

    // ---- no one in sight
    gun.ads = false;
    if (G.g.ammo < G.w.mag * 0.4 && G.g.reserve > 0 && !G.busy) gun.reload = true;
    if (G.cur === 1 && G.slots[0].ammo + G.slots[0].reserve > 0 && !G.busy) gun.swap = true;
    // a grenade over the wall at where they went
    this.nadeT -= dt;
    if (this.known && game.t - this.knownT < 3 && this.nadeT <= 0 && G.nades > 0 && Math.random() < D.nade) {
      const d = this.known.distanceTo(b.pos);
      if (d > 8 && d < 34) { this.nadeT = 14 + Math.random() * 10; this.lob = this.known.clone(); gun.nade = true; this.cooking = 0.45; }
      else this.nadeT = 3;
    }
    if (this.cooking > 0) {                                              // (turn onto the lob while cooking, then let go)
      const eye = f.eye(_e), hd = Math.hypot(this.lob.x - eye.x, this.lob.z - eye.z), dy = this.lob.y + 0.2 - eye.y;
      const yaw = Math.atan2(-(this.lob.x - eye.x), -(this.lob.z - eye.z)), r = D.turn * dt * 1.5;
      b.yaw += Math.max(-r, Math.min(r, angWrap(yaw - b.yaw))); b.pitch += Math.max(-r, Math.min(r, lobPitch(hd, dy) - b.pitch));
      this.cooking -= dt; gun.nade = this.cooking > 0; return { move, gun };
    }
    // where to go
    let goal = this.objective(game);
    if (this.known && game.t - this.knownT < 6 && (this.role === 'defend' || game.modeId !== 'ctf') && this.role !== 'snipe' && !f.carrying && this.knownWho?.alive) goal = this.known;   // chase the last sighting (in CTF only defenders do: attackers stay on the flag)
    this.navigate(dt, game, move, goal);
    // look where we're going (or the way the shot came from), with a little sweep
    this.lookT += dt;
    if (this.turnTo) { this.aimAtPoint(this.turnTo, D.turn * dt); if (Math.random() < dt * 2) this.turnTo = null; }
    else if (this.holdYaw !== null) { b.yaw += angWrap(this.holdYaw + Math.sin(this.lookT * 0.7) * 0.6 - b.yaw) * Math.min(1, dt * 3); b.pitch += (-0.05 - b.pitch) * Math.min(1, dt * 3); }
    else if (this.next) {
      const dx = this.next.x - b.pos.x, dz = this.next.z - b.pos.z;
      if (Math.hypot(dx, dz) > 0.2) { const want = Math.atan2(-dx, -dz) + Math.sin(this.lookT * 1.3) * 0.25; b.yaw += angWrap(want - b.yaw) * Math.min(1, dt * 6); }
      b.pitch += (Math.max(-0.4, Math.min(0.4, (this.next.y - b.pos.y) * 0.3)) - b.pitch) * Math.min(1, dt * 4);
    }
    return { move, gun };
  }

  aimAtPoint(p, rate) {
    const b = this.f.body, eye = this.f.eye(_e), d = _v.copy(p).sub(eye).normalize();
    const yaw = Math.atan2(-d.x, -d.z), pitch = Math.asin(Math.max(-1, Math.min(1, d.y))) + 0.18;
    b.yaw += Math.max(-rate, Math.min(rate, angWrap(yaw - b.yaw))); b.pitch += Math.max(-rate, Math.min(rate, pitch - b.pitch));
  }

  /** where the mode wants this bot (a point), or null to hold */
  objective(game) {
    const f = this.f, A = game.arena;
    this.holdYaw = null;
    if (game.modeId === 'ctf') {
      const mine = game.flags[f.team], theirs = game.flags[f.team === 'sara' ? 'zam' : 'sara'];
      if (f.carrying) return this.flagGoal(game);
      if (mine.state === 'carried' && mine.carrier) return mine.carrier.body.pos;      // get it back
      if (mine.state === 'dropped') return mine.pos;
      if (this.role === 'attack') return theirs.state === 'carried' && theirs.carrier ? theirs.carrier.body.pos : theirs.pos;
      if (this.role === 'snipe') return this.perchGoal(game);
      // defend: somewhere around our castle
      return this.wander(game, Arena.TEAMS[f.team].area, 12);
    }
    if (this.role === 'snipe') return this.perchGoal(game);
    // TDM / FFA: roam the middle and the other side, change mind every so often
    return this.wander(game, [2368, 3072, 2431, 3135], 9);
  }
  flagGoal(game) { return game.flags[this.f.team].home; }

  wander(game, area, every) {
    this.goalT -= 1 / 60;
    if (!this.wanderP || this.goalT <= 0 || this.f.body.pos.distanceTo(this.wanderP) < 2) {
      const nodes = game.arena.nodesIn(area).filter(i => game.arena.nav.nodes[i].n.length >= 6);
      const n = game.arena.nav.nodes[nodes[Math.floor(Math.random() * nodes.length)]];
      this.wanderP = new THREE.Vector3(n.x, n.y, n.z); this.goalT = every + Math.random() * every;
    }
    return this.wanderP;
  }
  /** a sniper's spot: a high node on our side with a view of the middle; hold it facing the middle */
  perchGoal(game) {
    const A = game.arena, f = this.f;
    if (!this.perch) {
      const area = game.mode.teams ? Arena.TEAMS[f.team].area : [2368, 3072, 2431, 3135];
      const nodes = A.nodesIn(area).filter(i => A.nav.nodes[i].y > 4.8 && A.nav.nodes[i].n.length >= 5);
      const pick = nodes.length ? nodes[Math.floor(Math.random() * nodes.length)] : null;
      if (pick === null) return this.wander(game, area, 10);
      const n = A.nav.nodes[pick]; this.perch = new THREE.Vector3(n.x, n.y, n.z); this.perchT = 25 + Math.random() * 20;
    }
    this.perchT -= 1 / 60;
    if (this.perchT <= 0) this.perch = null;
    if (this.perch && this.f.body.pos.distanceTo(this.perch) < 1.5) {
      const mid = A.at(2400, 3104); this.holdYaw = Math.atan2(-(mid.x - this.perch.x), -(mid.z - this.perch.z));
      return null;
    }
    return this.perch;
  }

  /** walk the nav graph to goal: plan, follow, re-plan when knocked off it, hop when stuck */
  navigate(dt, game, move, goal) {
    const f = this.f, b = f.body, A = game.arena, N = A.nav.nodes;
    if (!goal) { this.next = null; return; }
    const gi = A.nearestNode(goal.x, goal.y + 0.5, goal.z, 4);
    if (gi < 0) return;
    if (gi !== this.goal || !this.path) {
      if (this.goal >= 0 && this.path && gi !== this.goal && N[gi] && N[this.goal] && Math.hypot(N[gi].x - N[this.goal].x, N[gi].z - N[this.goal].z) < 3 && this.pi < this.path.length - 3) this.goal = gi;   // a moving goal: keep the plan a while
      else { this.goal = gi; this.replan(A); }
    }
    if (!this.path) { this.next = null; return; }
    if (this.pi >= this.path.length) { this.next = null; this.path = null; return; }
    const k = A.lookahead(this.path, this.pi, b.pos);                     // head for the furthest point in plain line
    const n = N[this.path[k]];
    this.next = n;
    if (Math.hypot(n.x - b.pos.x, n.z - b.pos.z) < 0.7 && Math.abs(n.y - b.pos.y) < 0.45) this.pi = k + 1;
    // steer: the stick in the body's own frame
    const dx = n.x - b.pos.x, dz = n.z - b.pos.z, L = Math.hypot(dx, dz) || 1;
    const s = Math.sin(b.yaw), c = Math.cos(b.yaw);
    move.x = (dx * c - dz * s) / L; move.z = (-dx * s - dz * c) / L;
    move.sprint = !this.target && move.z > 0.6 && this.path.length - this.pi > 6 && !f.gunner.busy;
    // progress, or plan again from where we are
    const left = this.path.length - this.pi;
    if (left < this.best) { this.best = left; this.stuck = 0; } else this.stuck += dt;
    if (this.stuck > 0.5 && b.onGround) move.jump = true;
    if (this.stuck > 1.2 || (b.onGround && Math.abs(n.y - b.pos.y) > 1.3)) this.replan(A);
  }
  replan(A) {
    const b = this.f.body, s = A.nearestNode(b.pos.x, b.pos.y, b.pos.z, 4);
    this.path = A.path(s, this.goal); this.pi = 0; this.best = Infinity; this.stuck = 0;
  }
}
