// Rune League's match: Rocket League's physics and rules, pure (no DOM, no three.js), stepped at RL's 120 Hz. Runs in
// the browser for exhibition games vs bots, and on the server for online ones. Units are RL's (uu, seconds); axes are
// three.js's (x across, y up, z down the pitch, blue defends -z). A car's own axes: forward +x, up +y, right +z.
// The numbers are RL's own (as measured by the RLBot / RocketSim folk): gravity 650, throttle 1600 falling to 0 at
// 1410, boost 991.67 on the ground / 1058.33 in the air, top speed 2300, supersonic 2200, jump 291.67 + 1458.33 held
// for 0.2 s, a second jump or dodge within 1.25 s, dodge impulses scaled by speed, flips that spin for 0.65 s, air
// control torques 36 / 12 / 9 rad/s^2 with their damping, the Psyonix hit on the ball, 33 boost at kickoff.
import { D, N, inGoal, L, PADS, PAD, KICKOFF, RESPAWN, KICK_SETS } from './arena.js';

export const TICK = 1 / 120;
export const C = {
  g: 650, maxV: 2300, sonic: 2200, sonicKeep: 2100, brake: 3500, coast: 525, boostG: 2975 / 3, boostA: 3175 / 3, airThr: 200 / 3, boostUse: 100 / 3,
  jump: 875 / 3, jumpHold: 4375 / 3, jumpMax: 0.2, jumpMin: 0.025, dblWin: 1.25, sticky: 325, ride: 17,
  flipV: 500, flipT: 0.65, flipPitch: 224, flipRoll: 260, torqueK: 2 * Math.PI / 65536 * 1000, maxW: 5.5,
  ballR: 92.75, ballM: 30, ballMaxV: 6000, ballMaxW: 6, carM: 180,
  box: { o: [13.88, 20.75, 0], h: [59.005, 18.08, 42.1] },       // the Octane's hitbox (local: forward, up, right), off the car's origin
  demoT: 3, startBoost: 100 / 3,
};
const curve = (pts, x) => { if (x <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return pts[pts.length - 1][1]; };
const THROTTLE = [[0, 1600], [1400, 160], [1410, 0]];
const CURV = [[0, 0.0069], [500, 0.00398], [1000, 0.00235], [1500, 0.001375], [1750, 0.0011], [2500, 0.00088]];   // turning curvature (1/uu) by speed
const HIT = [[0, 0.65], [500, 0.65], [2300, 0.55], [4600, 0.3]];   // the Psyonix ball hit, by closing speed
const BUMP_G = [[0, 5 / 6], [1400, 1100], [2200, 1530]], BUMP_A = [[0, 5 / 6], [1400, 1390], [2200, 1945]], BUMP_UP = [[0, 0], [1400, 278], [2200, 417]];
export const curvature = v => curve(CURV, Math.abs(v));

// ---------------------------------------------------------------- small vector / quaternion helpers (arrays)
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const addS = (a, b, k) => { a[0] += b[0] * k; a[1] += b[1] * k; a[2] += b[2] * k; return a; };
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const capLen = (a, m) => { const l = len(a); if (l > m) { a[0] *= m / l; a[1] *= m / l; a[2] *= m / l; } };
export function qrot(q, v) {                                     // rotate v by unit quaternion q = [x, y, z, w]
  const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qnorm = q => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l; return q; };
export const qaxis = (ax, a) => { const s = Math.sin(a / 2); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(a / 2)]; };
/** facing heading a (0 = +z, up the pitch; + turns toward +x), wheels down */
export const qheading = a => qaxis([0, 1, 0], a - Math.PI / 2);
export const basis = q => ({ f: qrot(q, [1, 0, 0]), u: qrot(q, [0, 1, 0]), r: qrot(q, [0, 0, 1]) });
/** turn q so its up meets n (the least turn) */
function alignUp(q, n) {
  const u = qrot(q, [0, 1, 0]), c = Math.max(-1, Math.min(1, dot(u, n)));
  if (c > 0.99999) return q;
  let ax = cross(u, n); const l = len(ax); if (l < 1e-6) ax = qrot(q, [1, 0, 0]); else ax = [ax[0] / l, ax[1] / l, ax[2] / l];
  return qnorm(qmul(qaxis(ax, Math.acos(c)), q));
}
const rng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// the car's inertia (a box the size of its hitbox, 180 mass): about forward, up, right
const IF = C.carM / 12 * (36.16 ** 2 + 84.2 ** 2), IU = C.carM / 12 * (118 ** 2 + 84.2 ** 2), IR = C.carM / 12 * (118 ** 2 + 36.16 ** 2);
const invI = (b, v) => { const a = dot(b.f, v) / IF, c = dot(b.u, v) / IU, d = dot(b.r, v) / IR; return [b.f[0] * a + b.u[0] * c + b.r[0] * d, b.f[1] * a + b.u[1] * c + b.r[1] * d, b.f[2] * a + b.u[2] * c + b.r[2] * d]; };
const IB = 0.4 * C.ballM * C.ballR ** 2;
const CORNERS = []; for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) CORNERS.push([C.box.o[0] + sx * C.box.h[0], C.box.o[1] + sy * C.box.h[1], C.box.o[2] + sz * C.box.h[2]]);

export const NO_INPUT = { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false };
/** an input on the wire: [throttle, steer, pitch, yaw, roll] in hundredths, then jump | boost | handbrake bits */
const q100 = x => Math.max(-100, Math.min(100, Math.round((+x || 0) * 100)));
export const packIn = i => [q100(i.throttle), q100(i.steer), q100(i.pitch), q100(i.yaw), q100(i.roll), (i.jump ? 1 : 0) | (i.boost ? 2 : 0) | (i.handbrake ? 4 : 0)];
export const unpackIn = a => Array.isArray(a) && a.length === 6 ? { throttle: (a[0] | 0) / 100, steer: (a[1] | 0) / 100, pitch: (a[2] | 0) / 100, yaw: (a[3] | 0) / 100, roll: (a[4] | 0) / 100, jump: !!(a[5] & 1), boost: !!(a[5] & 2), handbrake: !!(a[5] & 4) } : NO_INPUT;

// ---------------------------------------------------------------- the ball
export class Ball {
  constructor() { this.p = [0, C.ballR, 0]; this.v = [0, 0, 0]; this.w = [0, 0, 0]; }
  reset() { this.p = [0, C.ballR, 0]; this.v = [0, 0, 0]; this.w = [0, 0, 0]; }
  clone() { const b = new Ball(); b.p = this.p.slice(); b.v = this.v.slice(); b.w = this.w.slice(); return b; }
  /** fly and bounce off the arena (RL's bounce: 0.6 restitution, friction that spins it up). Returns the bounce speed */
  step(dt) {
    const v = this.v, p = this.p;
    v[1] -= C.g * dt; addS(v, v, -0.0305 * dt);
    capLen(v, C.ballMaxV); capLen(this.w, C.ballMaxW);
    addS(p, v, dt);
    const d = D(p[0], p[1], p[2]);
    if (d >= C.ballR) return 0;
    const n = N(p[0], p[1], p[2]); addS(p, n, C.ballR - d);
    const vn = dot(v, n); if (vn >= 0) return 0;
    const vperp = [n[0] * vn, n[1] * vn, n[2] * vn], vpara = [v[0] - vperp[0], v[1] - vperp[1], v[2] - vperp[2]];
    const spin = cross(n, this.w).map(x => x * C.ballR), s = [vpara[0] + spin[0], vpara[1] + spin[1], vpara[2] + spin[2]];
    const ratio = len(vperp) / Math.max(len(s), 1e-4), k = Math.min(1, 2 * ratio) * 0.285;
    const dpara = [-s[0] * k, -s[1] * k, -s[2] * k];
    addS(this.w, cross(dpara, n), 0.0003 * C.ballR);
    addS(v, vperp, -1.6); addS(v, dpara, 1);
    return -vn;
  }
}

// ---------------------------------------------------------------- a car
export class Car {
  constructor(o) {
    Object.assign(this, { id: o.id, name: o.name || o.id, team: o.team | 0, bot: !!o.bot, diff: o.diff || 'pro', body: o.body || 'kart', theme: o.theme || (o.team ? 'zam' : 'sara'), hat: o.hat || 'god', boom: o.boom || 'party' });
    this.st = { score: 0, goals: 0, assists: 0, saves: 0, shots: 0, demos: 0, touches: 0 };
    this.place([0, C.ride, 0], 0);
  }
  /** put it down, wheels on the floor, facing heading a */
  place(p, a) {
    this.p = p.slice(); this.v = [0, 0, 0]; this.w = [0, 0, 0]; this.q = qheading(a);
    this.ground = true; this.n = [0, 1, 0]; this.boost = C.startBoost; this.demoT = 0;
    this.jumping = false; this.jumpT = 0; this.jumped = false; this.airT = 0; this.hasFlip = false; this.flipT = -1; this.flipDir = [0, 0]; this.dbl = false;
    this.jumpHeld = false; this.sonic = false; this.sonicT = 0; this.hitTick = -9; this.hull = 0; this.autoT = 0; this.boosting = false; this.in = NO_INPUT;
  }
  get speed() { return len(this.v); }
  get hitCentre() { const b = basis(this.q); return [this.p[0] + b.f[0] * C.box.o[0] + b.u[0] * C.box.o[1], this.p[1] + b.f[1] * C.box.o[0] + b.u[1] * C.box.o[1], this.p[2] + b.f[2] * C.box.o[0] + b.u[2] * C.box.o[1]]; }
}

// ---------------------------------------------------------------- the match
export const MODES = { 1: '1v1 DUEL', 2: '2v2 DOUBLES', 3: '3v3 STANDARD' };
export class Match {
  /** o: { players: [{ id, name, team, bot, diff, body, theme, hat }], time (s, 300), seed, replayT (s the goal pause adds for the replay), freeplay (no clock; a goal just resets the ball) } */
  constructor(o) {
    this.rand = rng(o.seed ?? 1); this.time = o.time ?? 300; this.freeplay = !!o.freeplay; this.replayT = o.replayT ?? 0;
    this.cars = o.players.map(p => new Car(p)); this.ball = new Ball();
    this.pads = PADS.map(p => ({ ...p, t: 0 }));
    this.score = [0, 0]; this.clock = this.time; this.ot = false; this.otT = 0;
    this.tick = 0; this.t = 0; this.acc = 0; this.events = []; this.touches = [];
    this.state = 'count'; this.stateT = 3; this.kickoff();
  }
  get size() { return Math.max(1, ...[0, 1].map(t => this.cars.filter(c => c.team === t).length)); }
  emit(e) { this.events.push(e); }
  kickoff() {
    this.ball.reset(); this.touches = []; this.ballPathAt = -1;
    for (const p of this.pads) p.t = 0;
    for (const team of [0, 1]) {
      const cars = this.cars.filter(c => c.team === team), sets = KICK_SETS[Math.min(3, Math.max(1, cars.length))] || KICK_SETS[3];
      const set = this.kickSet ?? (this.kickSet = sets[Math.floor(this.rand() * sets.length)]);
      cars.forEach((c, i) => {
        const [x, z, a] = KICKOFF[set[i] ?? (i % 5)], s = team ? -1 : 1;
        c.place([x * s, C.ride, z * s], team ? a + Math.PI : a);
      });
    }
    this.kickSet = null; this.state = 'count'; this.stateT = 3; this.firstTouch = false;
    this.emit({ t: 'kickoff' });
  }
  /** advance by dt (real seconds): fixed 120 Hz ticks. inputs: Map id -> input (cars without one hold their last) */
  step(dt, inputs) {
    if (inputs) for (const c of this.cars) { const i = inputs.get(c.id); if (i) c.in = i; }
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= TICK) { this.acc -= TICK; this.tickOnce(); }
  }
  tickOnce() {
    const dt = TICK; this.tick++; this.t += dt;
    if (this.state === 'end') return;
    if (this.state === 'count') {
      this.stateT -= dt;
      for (const c of this.cars) { c.jumpHeld = c.in.jump; c.boosting = false; }
      if (this.stateT <= 0) { this.state = 'play'; this.emit({ t: 'go' }); }
      return;
    }
    for (const c of this.cars) this.stepCar(c, c.in, dt);
    if (this.state === 'goal') {
      this.stateT -= dt;
      if (this.stateT <= 0) { if (this.freeplay) { this.ball.reset(); this.ball.p[1] = 400; this.state = 'play'; this.touches = []; } else if (this.over()) this.end(); else this.kickoff(); }
    } else {
      const bv = this.ball.step(dt); if (bv > 300) this.emit({ t: 'bounce', v: bv, p: this.ball.p.slice() });
      for (const c of this.cars) this.carBall(c);
      this.ball.step(0);                                          // (a car pushing the ball into a wall: back out)
      const g = inGoal(this.ball.p[0], this.ball.p[1], this.ball.p[2], C.ballR); if (g) this.goal(g < 0 ? 1 : 0);
      // the clock: ticks while the ball's in play; at 0:00 the game ends the moment the ball next touches the floor
      if (this.state === 'play' && !this.freeplay) {
        if (this.ot) this.otT += dt;
        else if (this.clock > 0) { this.clock = Math.max(0, this.clock - dt); if (this.clock === 0) this.emit({ t: 'zero' }); }
        if (!this.ot && this.clock === 0 && this.ball.p[1] < C.ballR + 2) {
          if (this.score[0] !== this.score[1]) this.end();
          else { this.ot = true; this.emit({ t: 'ot' }); this.kickoff(); }
        }
      }
    }
    for (let i = 0; i < this.cars.length; i++) for (let j = i + 1; j < this.cars.length; j++) this.carCar(this.cars[i], this.cars[j]);
    this.padsStep(dt);
  }
  over() { return this.ot || (this.clock <= 0 && this.score[0] !== this.score[1]); }
  end() { this.state = 'end'; const win = this.score[0] > this.score[1] ? 0 : 1; this.emit({ t: 'end', win, mvp: this.mvp(win)?.id }); }
  mvp(win) { return this.cars.filter(c => c.team === win).sort((a, b) => b.st.score - a.st.score)[0]; }
  // ---------------- goals, touches, shots and saves
  goal(team) {
    const scorerT = [...this.touches].reverse().find(t => t.team === team), scorer = scorerT && this.cars.find(c => c.id === scorerT.id);
    let assist = null;
    if (scorerT) { const i = this.touches.lastIndexOf(scorerT), prev = this.touches.slice(0, i).reverse().find(t => t.id !== scorerT.id); if (prev && prev.team === team && scorerT.t - prev.t < 6) assist = this.cars.find(c => c.id === prev.id); }
    this.score[team]++;
    if (scorer) { scorer.st.goals++; scorer.st.score += 100; }
    if (assist) { assist.st.assists++; assist.st.score += 50; }
    const v = len(this.ball.v);
    this.emit({ t: 'goal', team, id: scorer?.id, assist: assist?.id, v: v * 0.036, p: this.ball.p.slice() });   // (v in km/h, as RL shows it)
    // the blast: cars near the ball are thrown clear (RL's goal explosion)
    for (const c of this.cars) { const d = [c.p[0] - this.ball.p[0], c.p[1] - this.ball.p[1], c.p[2] - this.ball.p[2]], l = len(d); if (l < 1200 && !c.demoT) { addS(c.v, norm(d), (1200 - l) * 1.4); c.v[1] += (1200 - l) * 0.6; c.ground = false; } }
    this.ball.v = [0, 0, 0]; this.ball.p = [0, -5000, 0];         // (gone, till the kickoff)
    this.state = 'goal'; this.stateT = this.freeplay ? 1.5 : 3 + this.replayT;
  }
  /** where the ball goes on its own (no cars) for up to t s: [{ t, p, v }] at 1/60 */
  predict(ball = this.ball, t = 4, step = 1 / 60) {
    const b = ball.clone(), out = [];
    for (let s = step; s <= t + 1e-6; s += step) { b.step(step); out.push({ t: s, p: b.p.slice(), v: b.v.slice() }); if (inGoal(b.p[0], b.p[1], b.p[2], C.ballR)) { out.goal = inGoal(b.p[0], b.p[1], b.p[2], C.ballR); out.at = s; break; } }
    return out;
  }
  /** the ball's path, shared by the bots: refreshed every few ticks */
  ballPath() { if (this.tick - this.ballPathAt >= 4 || !this.path) { this.path = this.predict(this.ball, 4); this.ballPathAt = this.tick; } return this.path; }
  touched(c, before) {
    c.st.touches++; c.st.score += 2;
    this.touches.push({ id: c.id, team: c.team, t: this.t }); if (this.touches.length > 12) this.touches.shift();
    const after = this.predict(this.ball, 3);
    // a shot: it's going in the other goal. A save: it was going in your own, now it isn't
    const theirs = c.team === 0 ? 1 : -1, ours = -theirs;
    if (after.goal === theirs) { c.st.shots++; c.st.score += 20; this.emit({ t: 'shot', id: c.id }); }
    if (before?.goal === ours && after.goal !== ours) { const epic = before.at < 0.6; c.st.saves++; c.st.score += epic ? 75 : 50; this.emit({ t: 'save', id: c.id, epic }); }
    this.emit({ t: 'touch', id: c.id, v: len(this.ball.v) });
  }
  // ---------------- the boost pads
  padsStep(dt) {
    for (let i = 0; i < this.pads.length; i++) {
      const p = this.pads[i]; if (p.t > 0) { p.t -= dt; continue; }
      const k = p.big ? PAD.big : PAD.small;
      for (const c of this.cars) {
        if (c.demoT > 0 || c.boost >= 100 || c.p[1] > k.h) continue;
        if ((c.p[0] - p.x) ** 2 + (c.p[2] - p.z) ** 2 < k.r * k.r) { c.boost = Math.min(100, c.boost + k.amt); p.t = k.t; this.emit({ t: 'pad', id: c.id, i, big: p.big }); break; }
      }
    }
  }
  // ---------------- a car's tick: controls, then where it ends up
  stepCar(c, inp, dt) {
    if (c.demoT > 0) {
      c.demoT -= dt;
      if (c.demoT <= 0) { const s = c.team ? -1 : 1, spots = RESPAWN.filter(([x, z]) => !this.cars.some(o => o !== c && !o.demoT && Math.hypot(o.p[0] - x * s, o.p[2] - z * s) < 200)), [x, z] = spots[Math.floor(this.rand() * spots.length)] || RESPAWN[0];
        c.place([x * s, C.ride, z * s], c.team ? Math.PI : 0); this.emit({ t: 'respawn', id: c.id }); }
      return;
    }
    let b = basis(c.q);
    const v = c.v, jumpPress = inp.jump && !c.jumpHeld; c.jumpHeld = inp.jump;
    c.boosting = !!inp.boost && c.boost > 0;
    if (c.boosting) c.boost = Math.max(0, c.boost - C.boostUse * dt);
    if (c.ground) {
      const n = c.n, vf = dot(v, b.f), thr = c.boosting ? 1 : Math.max(-1, Math.min(1, inp.throttle || 0));
      let a = 0;
      if (thr) a = (vf * thr >= 0 || Math.abs(vf) < 25 ? thr * curve(THROTTLE, Math.abs(vf)) : Math.sign(thr) * C.brake);
      else a = -Math.sign(vf) * Math.min(C.coast, Math.abs(vf) / dt);
      if (c.boosting) a += C.boostG;
      addS(v, b.f, a * dt);
      // steering: RL's curvature for the speed (a powerslide swings round quicker and lets the back slide)
      const vf2 = dot(v, b.f), yaw = -(inp.steer || 0) * vf2 * curvature(vf2) * (inp.handbrake ? 1.5 : 1);
      c.w = [b.u[0] * yaw, b.u[1] * yaw, b.u[2] * yaw];
      const vl = dot(v, b.r); addS(v, b.r, -vl * (1 - Math.exp(-dt * (inp.handbrake ? 2.2 : 26))));
      // gravity along the surface (down a wall); off it only where it beats the sticky force (the ceiling)
      const gn = -C.g * n[1]; v[1] -= C.g * dt; addS(v, n, -gn * dt); if (gn - C.sticky > 0) addS(v, n, (gn - C.sticky) * dt);
      if (jumpPress) {
        addS(v, b.u, C.jump); c.ground = false; c.jumping = true; c.jumpT = 0; c.jumped = true; c.airT = 0; c.hasFlip = true; c.dbl = false;
        this.emit({ t: 'jump', id: c.id });
      }
    } else {
      v[1] -= C.g * dt;
      if (c.jumping) {
        c.jumpT += dt;
        if ((inp.jump || c.jumpT < C.jumpMin) && c.jumpT < C.jumpMax) addS(v, b.u, C.jumpHold * dt); else c.jumping = false;
      } else if (c.jumped) c.airT += dt;
      // the second jump: a double jump with the stick centred, else a dodge that way
      if (jumpPress && !c.jumping && c.hasFlip && (!c.jumped || c.airT < C.dblWin) && c.autoT <= 0) {
        const fx = -(inp.pitch || 0), sy = inp.yaw || inp.roll || 0;
        c.hasFlip = false;
        if (Math.hypot(fx, sy) < 0.5) { addS(v, b.u, C.jump); c.dbl = true; this.emit({ t: 'jump', id: c.id, dbl: true }); }
        else this.dodge(c, b, fx, sy);
      }
      // a flip spins for 0.65 s (hold the stick back against it to cancel the pitch); else air control
      const w = c.w;
      if (c.flipT >= 0 && c.flipT < C.flipT) {
        const [fx, sy] = c.flipDir; let dp = -fx * C.flipPitch * C.torqueK, dr = sy * C.flipRoll * C.torqueK;
        const pin = inp.pitch || 0; if (pin * fx > 0) dp *= 1 - Math.min(1, Math.abs(pin));   // (the flip cancel: the stick pulled against the flip; held with it, the flip runs full)
        addS(w, b.r, dp * dt); addS(w, b.f, dr * dt);
      } else if (c.autoT > 0) {
        c.autoT -= dt;
      } else if (c.flipT >= 0 && c.flipT < 0.95) {
        // (pitch-locked: the flip carries round undamped)
      } else {
        const roll = inp.roll || 0, pitch = inp.pitch || 0, yawIn = inp.yaw || 0;
        const wf = dot(w, b.f), wr = dot(w, b.r), wu = dot(w, b.u);
        addS(w, b.f, (36.07956616966136 * roll - 4.47166302201591 * wf) * dt);
        addS(w, b.r, (12.14599781908070 * pitch - 2.798194258050845 * wr * (1 - Math.abs(pitch))) * dt);
        addS(w, b.u, (-8.91962804287785 * yawIn - 1.886491900437232 * wu * (1 - Math.abs(yawIn))) * dt);
      }
      if (c.flipT >= 0) {
        c.flipT += dt;
        if (c.flipT >= 0.15 && (v[1] < 0 || c.flipT < 0.21) && c.flipT < C.flipT) v[1] *= Math.pow(1 - 0.35, dt * 120);   // (flips flatten out: the fall is damped)
      }
      addS(v, b.f, (c.boosting ? C.boostA : C.airThr * (inp.throttle || 0)) * dt);
    }
    capLen(v, C.maxV); capLen(c.w, c.autoT > 0 ? 7 : C.maxW);
    // move
    addS(c.p, v, dt);
    const w = c.w, wl = len(w);
    if (wl > 1e-6) c.q = qnorm(qmul(qaxis([w[0] / wl, w[1] / wl, w[2] / wl], wl * dt), c.q));
    this.carWorld(c);
    // supersonic: from 2200; kept down to 2100 for a second
    const sp = len(v);
    if (sp >= C.sonic) { if (!c.sonic) this.emit({ t: 'sonic', id: c.id }); c.sonic = true; c.sonicT = 0; }
    else if (c.sonic && sp >= C.sonicKeep && c.sonicT < 1) c.sonicT += dt; else c.sonic = false;
  }
  dodge(c, b, fx, sy) {
    const l = Math.hypot(fx, sy); fx /= l; sy /= l;
    if (Math.abs(fx) < 0.1) fx = 0; if (Math.abs(sy) < 0.1) sy = 0;
    const fh = norm([b.f[0], 0, b.f[2]]), rh = [-fh[2], 0, fh[0]];     // (forward and right, flat)
    const fwdSpeed = dot(c.v, fh), ratio = Math.abs(fwdSpeed) / C.maxV;
    const back = Math.abs(fwdSpeed) < 100 ? fx < 0 : (fx >= 0) !== (fwdSpeed > 0);
    let ix = fx * C.flipV, iy = sy * C.flipV;
    ix *= ((back ? 2.5 : 1) - 1) * ratio + 1; iy *= (1.9 - 1) * ratio + 1; if (back) ix *= 16 / 15;
    addS(c.v, fh, ix); addS(c.v, rh, iy);
    c.flipT = 0; c.flipDir = [fx, sy]; c.jumping = false;
    this.emit({ t: 'flip', id: c.id, fx, sy });
  }
  /** the car against the arena: drive along it (floor, walls, ceiling), land on it, or bounce off it */
  carWorld(c) {
    const b = basis(c.q), v = c.v, p = c.p, d = D(p[0], p[1], p[2]);
    const wasGround = c.ground;
    let stuck = false;
    if (d < C.ride + (c.ground ? 24 : 6)) {
      const n = N(p[0], p[1], p[2]), un = dot(b.u, n), vn = dot(v, n);
      const ok = c.ground ? un > 0.35 && vn < 120 : un > 0.55 && vn < 60 && !(c.jumping && c.jumpT < 0.05);
      if (ok) {
        addS(p, n, C.ride - d); c.q = alignUp(c.q, n); c.n = n;
        if (vn < 0) { if (wasGround) { const sp = len(v); addS(v, n, -vn); const l = len(v); if (l > 1e-3) for (let i = 0; i < 3; i++) v[i] *= sp / l; } else addS(v, n, -vn); }
        if (!wasGround) {
          c.ground = true; c.jumping = false; c.jumped = false; c.hasFlip = false; c.flipT = -1; c.dbl = false; c.airT = 0; c.autoT = 0;
          const nb = basis(c.q), wu = dot(c.w, nb.u); c.w = [nb.u[0] * wu, nb.u[1] * wu, nb.u[2] * wu];
          this.emit({ t: 'land', id: c.id, v: -vn });
        }
        stuck = true;
      }
    }
    if (!stuck && wasGround) { c.ground = false; if (!c.jumped) { c.hasFlip = true; c.airT = 0; } }   // (drove off a wall: you keep your flip)
    // the hitbox's corners against the walls (a roof landing, a goal post, nose first into a wall)
    const bb = basis(c.q);
    let deep = 0, at = null;
    for (const k of CORNERS) {
      const w = [p[0] + bb.f[0] * k[0] + bb.u[0] * k[1] + bb.r[0] * k[2], p[1] + bb.f[1] * k[0] + bb.u[1] * k[1] + bb.r[1] * k[2], p[2] + bb.f[2] * k[0] + bb.u[2] * k[1] + bb.r[2] * k[2]];
      const dd = D(w[0], w[1], w[2]); if (dd < deep) { deep = dd; at = w; }
    }
    c.hull = Math.max(0, c.hull - 1);
    if (!at) return;
    const n = N(at[0], at[1], at[2]);
    if (c.ground && dot(n, bb.u) > 0.7) return;                 // (just the curve under the wheels)
    addS(p, n, -deep);
    const rc = [at[0] - p[0], at[1] - p[1], at[2] - p[2]], vp = addS(v.slice(), cross(c.w, rc), 1), vn = dot(vp, n);
    c.hull = 3;
    if (vn < 0) {
      const rxn = cross(rc, n), k = 1 / C.carM + dot(n, cross(invI(bb, rxn), rc)), j = -(1 + 0.3) * vn / k;
      addS(v, n, j / C.carM); addS(c.w, invI(bb, rxn), j);
      const vt = addS(vp.slice(), n, -vn), tl = len(vt);           // friction along the wall
      if (tl > 1) { const t = [vt[0] / tl, vt[1] / tl, vt[2] / tl], rxt = cross(rc, t), kt = 1 / C.carM + dot(t, cross(invI(bb, rxt), rc)), jt = Math.min(0.35 * j, tl / kt); addS(v, t, -jt / C.carM); addS(c.w, invI(bb, rxt), -jt); }
      if (-vn > 400) this.emit({ t: 'wall', id: c.id, v: -vn });
    }
    // on its roof or side: jump rights it (RL's auto-flip)
    if (!c.ground && c.jumpHeld && !c.prevAuto && dot(bb.u, n) < 0.3 && c.autoT <= 0) {
      addS(v, n, 260); const s = dot(bb.r, n) > 0 ? 1 : -1; c.w = [bb.f[0] * 6.5 * s, bb.f[1] * 6.5 * s, bb.f[2] * 6.5 * s]; c.autoT = 0.5;
    }
    c.prevAuto = c.jumpHeld;
  }
  // ---------------- car meets ball: the physical push (no bounce, high friction) plus the Psyonix hit
  carBall(c) {
    if (c.demoT > 0 || this.state === 'goal') return;
    const ball = this.ball, b = basis(c.q), rel = [ball.p[0] - c.p[0], ball.p[1] - c.p[1], ball.p[2] - c.p[2]];
    const l = [dot(rel, b.f) - C.box.o[0], dot(rel, b.u) - C.box.o[1], dot(rel, b.r) - C.box.o[2]];
    const cl = l.map((x, i) => Math.max(-C.box.h[i], Math.min(C.box.h[i], x))), off = [l[0] - cl[0], l[1] - cl[1], l[2] - cl[2]], dist = len(off);
    if (dist >= C.ballR) return;
    let nl;
    if (dist > 1e-3) nl = [off[0] / dist, off[1] / dist, off[2] / dist];
    else { const i = [0, 1, 2].reduce((m, k) => (C.box.h[k] - Math.abs(l[k]) < C.box.h[m] - Math.abs(l[m]) ? k : m), 0); nl = [0, 0, 0]; nl[i] = Math.sign(l[i]) || 1; }
    const n = [b.f[0] * nl[0] + b.u[0] * nl[1] + b.r[0] * nl[2], b.f[1] * nl[0] + b.u[1] * nl[1] + b.r[1] * nl[2], b.f[2] * nl[0] + b.u[2] * nl[1] + b.r[2] * nl[2]];
    const cw = [c.p[0] + b.f[0] * (cl[0] + C.box.o[0]) + b.u[0] * (cl[1] + C.box.o[1]) + b.r[0] * cl[2], c.p[1] + b.f[1] * (cl[0] + C.box.o[0]) + b.u[1] * (cl[1] + C.box.o[1]) + b.r[1] * cl[2], c.p[2] + b.f[2] * (cl[0] + C.box.o[0]) + b.u[2] * (cl[1] + C.box.o[1]) + b.r[2] * cl[2]];
    const pen = C.ballR - (dist > 1e-3 ? dist : -0), mt = C.ballM + C.carM;
    const rv0 = [ball.v[0] - c.v[0], ball.v[1] - c.v[1], ball.v[2] - c.v[2]];   // (the closing speed BEFORE contact: what RL scales its extra hit by)
    addS(ball.p, n, pen * C.carM / mt); if (!c.ground) addS(c.p, n, -pen * C.ballM / mt);
    const before = this.tick - c.hitTick > 1 ? this.predict(ball, 3) : null;
    const rc = [cw[0] - c.p[0], cw[1] - c.p[1], cw[2] - c.p[2]], rb = [-n[0] * C.ballR, -n[1] * C.ballR, -n[2] * C.ballR];
    const vc = addS(c.v.slice(), cross(c.w, rc), 1), vb = addS(ball.v.slice(), cross(ball.w, rb), 1), vr = [vb[0] - vc[0], vb[1] - vc[1], vb[2] - vc[2]], vn = dot(vr, n);
    if (vn < 0) {
      const rcn = cross(rc, n), rbn = cross(rb, n), k = 1 / C.ballM + 1 / C.carM + dot(n, cross(invI(b, rcn), rc)) + dot(rbn, rbn) / IB, j = -vn / k;
      addS(ball.v, n, j / C.ballM); addS(ball.w, rbn, j / IB);
      addS(c.v, n, -j / C.carM); addS(c.w, invI(b, rcn), -j);
      const vt = addS(vr.slice(), n, -vn), tl = len(vt);
      if (tl > 1) { const t = [vt[0] / tl, vt[1] / tl, vt[2] / tl], jt = Math.min(2 * j, tl / (1 / C.ballM + 1 / C.carM + C.ballR ** 2 / IB)); addS(ball.v, t, -jt / C.ballM); addS(ball.w, cross(rb, t), -jt / IB); addS(c.v, t, jt / C.carM); }
    }
    if (this.tick - c.hitTick > 1) {
      const rs = Math.min(len(rv0), 4600);
      if (rs > 0) {
        let hd = [rel[0], rel[1] * 0.35, rel[2]]; const fa = dot(hd, b.f) * (1 - 0.65); hd = norm([hd[0] - b.f[0] * fa, hd[1] - b.f[1] * fa, hd[2] - b.f[2] * fa]);
        addS(ball.v, hd, rs * curve(HIT, rs));
      }
      capLen(ball.v, C.ballMaxV);
      if (!this.firstTouch) { this.firstTouch = true; }
      this.touched(c, before);
    }
    c.hitTick = this.tick;
  }
  // ---------------- car meets car: a bump, or a demolition if you're supersonic and it's your nose
  carCar(a, o) {
    if (a.demoT > 0 || o.demoT > 0) return;
    const ca = a.hitCentre, co = o.hitCentre, d = [co[0] - ca[0], co[1] - ca[1], co[2] - ca[2]], l = len(d), R2 = 88;
    if (l >= R2 || l < 1e-3) return;
    const n = [d[0] / l, d[1] / l, d[2] / l], pen = R2 - l;
    addS(a.p, n, -pen / 2); addS(o.p, n, pen / 2);
    const vr = dot([o.v[0] - a.v[0], o.v[1] - a.v[1], o.v[2] - a.v[2]], n);
    if (vr < 0) { addS(a.v, n, vr * 0.55); addS(o.v, n, -vr * 0.55); }
    const key = a.id < o.id ? a.id + '|' + o.id : o.id + '|' + a.id; this.bumpT ??= new Map();
    if (this.t - (this.bumpT.get(key) ?? -9) < 0.25) return;
    // who hit whom: the one driving into the other, nose first
    const ba = basis(a.q), bo = basis(o.q), fa = dot(a.v, n) * (dot(ba.f, n) > 0.55 ? 1 : 0), fo = -dot(o.v, n) * (dot(bo.f, n) < -0.55 ? 1 : 0);
    if (Math.max(fa, fo) < 200) return;
    const [att, vic, dir] = fa >= fo ? [a, o, n] : [o, a, [-n[0], -n[1], -n[2]]];
    this.bumpT.set(key, this.t);
    if (att.sonic && att.team !== vic.team) {
      vic.demoT = C.demoT; vic.v = [0, 0, 0]; att.st.demos++; att.st.score += 25;
      this.emit({ t: 'demo', a: att.id, b: vic.id, p: vic.p.slice() }); return;
    }
    const sp = dot(att.v, basis(att.q).f), hd = norm([dir[0], vic.ground ? 0 : dir[1], dir[2]]), up = vic.ground ? basis(vic.q).u : [0, 1, 0];
    addS(vic.v, hd, curve(vic.ground ? BUMP_G : BUMP_A, sp)); addS(vic.v, up, curve(BUMP_UP, sp)); vic.ground = false;
    this.emit({ t: 'bump', a: att.id, b: vic.id, v: sp });
  }
  // ---------------- the state, for the wire (online: the server sends it, browsers load it then run ahead on their inputs)
  save() {
    const r = (a, k) => a.map(x => Math.round(x * k) / k);
    return {
      tk: this.tick, t: +this.t.toFixed(4), st: this.state, sT: +this.stateT.toFixed(4), sc: this.score, cl: +this.clock.toFixed(3), ot: this.ot ? 1 : 0, oT: +this.otT.toFixed(2), ft: this.firstTouch ? 1 : 0,
      b: [...r(this.ball.p, 100), ...r(this.ball.v, 100), ...r(this.ball.w, 1e4)], pd: this.pads.map(p => +p.t.toFixed(2)), tc: this.touches,
      c: this.cars.map(c => [c.id, ...r(c.p, 100), ...r(c.v, 100), ...r(c.w, 1e4), ...r(c.q, 1e6), ...r(c.n, 1e4), +c.boost.toFixed(2), +c.demoT.toFixed(3),
        (c.ground ? 1 : 0) | (c.jumping ? 2 : 0) | (c.jumped ? 4 : 0) | (c.hasFlip ? 8 : 0) | (c.dbl ? 16 : 0) | (c.jumpHeld ? 32 : 0) | (c.sonic ? 64 : 0) | (c.boosting ? 128 : 0) | (c.prevAuto ? 256 : 0),
        +c.jumpT.toFixed(4), +c.airT.toFixed(4), +c.flipT.toFixed(4), ...r(c.flipDir, 1e4), +c.sonicT.toFixed(3), c.hitTick, c.hull, +c.autoT.toFixed(3), packIn(c.in), Object.values(c.st)]),
    };
  }
  load(s) {
    this.tick = s.tk; this.t = s.t; this.state = s.st; this.stateT = s.sT; this.score = s.sc.slice(); this.clock = s.cl; this.ot = !!s.ot; this.otT = s.oT; this.firstTouch = !!s.ft;
    const B = s.b; this.ball.p = B.slice(0, 3); this.ball.v = B.slice(3, 6); this.ball.w = B.slice(6, 9);
    s.pd.forEach((t, i) => { if (this.pads[i]) this.pads[i].t = t; }); this.touches = s.tc.map(t => ({ ...t })); this.ballPathAt = -99; this.path = null;
    for (const a of s.c) {
      const c = this.cars.find(o => o.id === a[0]); if (!c) continue;
      let i = 1; const n = k => { const v = a.slice(i, i + k); i += k; return v; };
      c.p = n(3); c.v = n(3); c.w = n(3); c.q = n(4); c.n = n(3); c.boost = a[i++]; c.demoT = a[i++];
      const f = a[i++]; c.ground = !!(f & 1); c.jumping = !!(f & 2); c.jumped = !!(f & 4); c.hasFlip = !!(f & 8); c.dbl = !!(f & 16); c.jumpHeld = !!(f & 32); c.sonic = !!(f & 64); c.boosting = !!(f & 128); c.prevAuto = !!(f & 256);
      c.jumpT = a[i++]; c.airT = a[i++]; c.flipT = a[i++]; c.flipDir = n(2); c.sonicT = a[i++]; c.hitTick = a[i++]; c.hull = a[i++]; c.autoT = a[i++]; c.in = unpackIn(a[i++]);
      const st = a[i++]; Object.keys(c.st).forEach((k, j) => c.st[k] = st[j]);
    }
  }
}
