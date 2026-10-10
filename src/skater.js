// RuneSkate skater physics. Pure JS (no three.js) so it can be unit-tested headless.
// Units: tiles and seconds. x = east, z = north, y = up. heading = board nose angle (atan2(north, east)).
//
// The model follows Skate 3's skater as reverse-engineered by the Rust/Bevy rebuild (SK8-ENGINE/skate-3-rust-engine):
// a push adds a speed GAIN capped by a speed-blended limit and a hard ceiling; rolling friction is a curve of speed
// (plus extra drag once you stop giving input) and is ignored when a slope pulls harder, so you never stick on a
// hill; the trucks ease to the stick's lean over 0.165 s and you turn less mid-push; the ollie pops to a target
// HEIGHT (low/high by speed, picked by flick strength) at v = sqrt(2gh); air spins wind up and fade out; a landing
// is resolved against the ground normal (the velocity's tangent part carries on, so landing down a bank keeps your
// speed) and judged sketchy from spin rate and sideways speed; touching down with the board upside down mid-flip
// is a bail. That project ships the model, not Skate 3's tuning tables, so the numbers here are tuned for this map.
// Clean-room: written from a description of its behaviour (it is GPL-3.0; this file is MIT).
import { railTop } from './world.js';
import { Ragdoll, RD, defaultSkeleton } from './ragdoll.js';

export const P = {
  radius: 0.28,
  gravity: 21,
  slopeG: 11,            // how hard slopes pull you
  rollFriction: 0.18,    // rolling friction curve: rollFriction + rollFrictionV * speed (tiles/s^2)
  rollFrictionV: 0.02,
  idleFriction: 0.3,     // extra drag once you have given no input for idleAfter seconds
  idleAfter: 2,
  slopeMax: 9,           // most a slope can accelerate you (tiles/s^2)
  brakeStop: 0.8,        // braking below this speed brings you to a dead stop
  leanTime: 0.165,       // seconds for the trucks to ease to the stick's lean
  pushTurn: 0.7,         // turn scale while a push is in progress
  pushLow: 3.4,          // most speed one push adds from a standstill...
  pushHigh: 1.5,         // ...blending down to this at pushMax (Skate 3: limit = mix(low, high, v / max push speed))
  pushEvery: 0.55,       // = rsanim PUSH_UNITS: one kick per stroke of the pushing leg
  pushMax: 8.2,
  maxSpeed: 13,
  brake: 6.5,
  gripLateral: 11,       // how fast sideways skid bleeds away (wheels grip)
  turnSlow: 3.4,         // rad/s when slow
  turnFast: 2.1,         // rad/s at speed
  ollieMin: 5.4,         // (kept for callers that pop by velocity)
  ollieMax: 8.1,
  popAbsMin: 0.5,        // pop heights (tiles): the floor every ollie reaches...
  popMin: 0.69,          // ...a weak pop at speed...
  popMax: 1.56,          // ...a full pop at speed
  popSpeed: 4,           // tiles/s where the pop reaches its full range (slower = lower, like Skate 3)
  chargeTime: 0.35,
  airSpin: 6.0,          // rad/s
  airSpinAccel: 30,      // rad/s^2: spins wind up instead of starting at full speed
  airSpinFade: 0.96,     // per 1/60 s once you let go of A/D (Skate 3's stick fade)
  spinAssist: 3.2,       // rad/s the board settles toward the nearest 180 when you let go of A/D
  flipTime: 0.42,
  walkSpeed: 1.9,        // tiles/s on foot (RS walk is ~1.67)
  runSpeed: 3.6,
  footJump: 6.2,         // SPACE on foot: ~0.9 tile hop
  slamWall: 9.5,         // head-on impact speed (tiles/s) into a wall that bails you
  slamAir: 8.0,
  slamHeadOn: 0.8,       // ...and only when you hit it this square-on (impact / speed)
  hardLanding: 15.5,     // vertical impact that bails you
  landAngle: 0.95,       // clean landing window (rad) between board and travel
  landSketchy: 1.52,     // up to here you ride it out (speed wobble), past it you bail
  landSlowBonus: 1.25,   // ...and slow landings (< 3 tiles/s) tolerate a wider angle
  sketchyAt: 0.35,       // landing sketchiness (spin rate / side speed) from which you wobble
  grindCatch: 0.85,      // horizontal snap distance to a rail (generous: rails should be easy to land on)
  blockRadius: 0.17,     // trees/rocks/props: a smaller collider than walls, and you glance off them
  grindFriction: 0.55,
  grindMin: 2.2,
  grindGap: 1.6,
  trunkPad: 0.1,         // rider half-width against a tree trunk (the trunk itself is measured, see tools/build.py)
  treeClear: 0.6,         // tiles of air under the board: from here up you fly through trees/props
  treeGain: 0.1,          // steer only toward a line at least this much clearer (fraction of the look distance)
  treeCap: 1.4,           // rad: most the board will steer itself off your line
  treeAvoid: 7,           // rad/s max: the board steers itself round trees in your line (forests flow instead of pinballing)
          // a grind carries on across a gap/corner up to this long onto the next rail
  slideDecel: 7.5,
  safeEvery: 0.4,
  manualMin: 1.5,        // tiles/s to hold a manual
  manualPts: 140,        // per second
  grabPts: 260,          // per second held
  // combo scoring: bank = points x min(tricks, multCap). Repeats of the same trick in one combo halve each time,
  // and anything you can hold forever (grinding a looping fence, an endless manual) pays full rate for holdFull
  // seconds then fades out, so no spot farms a runaway score. Highscores themselves are uncapped.
  multCap: 10,
  repeatDecay: 0.5,
  holdFull: 6,           // seconds of a grind/manual at full points...
  holdFade: 4,           // ...then the rate decays with this time constant
};
/** points per second for something held t seconds (grind, manual): full rate, then a fade so it can't be farmed */
const holdRate = (rate, t) => t < P.holdFull ? rate : rate * Math.exp(-(t - P.holdFull) / P.holdFade);

const TRICKS = {
  kickflip: { name: 'Kickflip', pts: 200, roll: 1, yaw: 0 },
  heelflip: { name: 'Heelflip', pts: 200, roll: -1, yaw: 0 },
  shove: { name: 'Pop Shove-it', pts: 150, roll: 0, yaw: 1 },
  varial: { name: 'Varial Kickflip', pts: 350, roll: 1, yaw: 1 },
  tre: { name: '360 Flip', pts: 600, roll: 1, yaw: 2 },
  hardflip: { name: 'Hardflip', pts: 450, roll: -1, yaw: -1 },
  shove360: { name: '360 Shove-it', pts: 400, roll: 0, yaw: 2 },
  double: { name: 'Double Kickflip', pts: 500, roll: 2, yaw: 0 },
  doubleheel: { name: 'Double Heelflip', pts: 500, roll: -2, yaw: 0 },
};
export const TRICK_KEYS = { j: 'kickflip', k: 'heelflip', l: 'shove', i: 'varial', u: 'tre', n: 'hardflip', m: 'shove360', y: 'double', b: 'doubleheel' };

/**
 * four-wheel contact: the ground under each wheel (trucks 0.245 either side of the middle, wheels 0.082 out)
 * tips the board to the slope and over kerbs. Returns the contact height and the pitch (nose up +) and roll
 * (right side down +) the board sits at.
 */
export function wheelContact(w, x, z, yaw) {
  const nx = Math.cos(yaw), nz = Math.sin(yaw), rx = nz, rz = -nx, T = 0.245, S = 0.082;     // (the drawn deck, model.js BOARD_SCALE)
  const h = (a, b) => w.height(x + nx * a + rx * b, z + nz * a + rz * b);
  const fl = h(T, -S), fr = h(T, S), bl = h(-T, -S), br = h(-T, S);
  const f = Math.max(fl, fr), b = Math.max(bl, br), l = Math.max(fl, bl), r = Math.max(fr, br);
  // a wheel can't sit lower than the middle of the board allows over a sharp step: limit the tilt
  const pitch = Math.max(-0.5, Math.min(0.5, Math.atan2(f - b, 2 * T))), roll = Math.max(-0.4, Math.min(0.4, Math.atan2(l - r, 2 * S)));
  return { y: Math.max((f + b) / 2, w.height(x, z)), pitch, roll };
}

const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

const TRUNK = { kind: 'block', trunk: true };            // collide()'s stand-in segment for a trunk hit

export class Skater {
  constructor(world) {
    this.w = world;
    this.events = [];          // {type, ...} consumed by the renderer/audio/HUD
    this.reset(world.spawn[0], world.spawn[1], Math.PI / 2);
  }

  reset(x, z, heading) {
    this.x = x; this.z = z; this.y = this.w.height(x, z);
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.heading = heading;          // board nose
    this.body = heading;             // body/board yaw used for rendering (air spins)
    this.mode = 'ground';
    this.charge = -1; this.pushT = 0; this.pushing = 0;
    this.airTime = 0; this.spin = 0; this.trick = null; this.trickT = 0; this.boardRoll = 0; this.boardYaw = 0;
    this.airTricks = [];
    this.rail = null; this.railT = 0; this.railDir = 1; this.balance = 0; this.grindKind = '';
    this.bailT = 0; this.slide = 0;
    this.manual = 0; this.manBal = 0; this.manT = 0; this.grab = null; this.grabT = 0;
    this.combo = []; this.comboPts = 0; this.comboSeen = new Map(); this.score = this.score || 0;
    this.lastSafe = { x, z, heading }; this.safeT = 0;
    this.board = { x, z, y: this.y, vx: 0, vz: 0, vy: 0, yaw: heading, roll: 0, pitch: 0, spinR: 0, spinY: 0, free: false };
    this.ignoreRail = null; this.ignoreT = 0; this.railExitT = 0;
    this.lean = 0; this.idleT = 0; this.spinRate = 0;
    this.stat = { bails: 0, bestCombo: 0 };
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  /** wall-slide contacts happen every physics step: one knock per real hit, not a 240 Hz buzz */
  bumpSound(impact) { if (this.bumpT > 0) return; this.bumpT = 0.45; this.emit('bump', { impact }); }
  emit(type, o = {}) { this.events.push({ type, ...o }); }

  // ------------------------------------------------------------ main step
  step(dt, input) {
    this.pushing = Math.max(0, this.pushing - dt);
    if (this.bumpT > 0) this.bumpT -= dt;
    if (this.ignoreT > 0 && (this.ignoreT -= dt) <= 0) this.ignoreRail = null;
    if (this.railExitT > 0) this.railExitT -= dt;
    switch (this.mode) {
      case 'ground': this.stepGround(dt, input); break;
      case 'air': this.stepAir(dt, input); break;
      case 'grind': this.stepGrind(dt, input); break;
      case 'bail': this.stepBail(dt, input); break;
      case 'walk': this.stepWalk(dt, input); break;
    }
    // the exported map ends: a soft invisible edge, so nobody rides off the world
    const lo = 0.6, hi = this.w.N - 0.6;
    if (this.x < lo) { this.x = lo; this.vx = Math.max(0, this.vx); } else if (this.x > hi) { this.x = hi; this.vx = Math.min(0, this.vx); }
    if (this.z < lo) { this.z = lo; this.vz = Math.max(0, this.vz); } else if (this.z > hi) { this.z = hi; this.vz = Math.min(0, this.vz); }
    if (this.mode === 'ground' || this.mode === 'walk' || this.mode === 'air') this.unstick(dt);
    if (this.mode !== 'bail') { this.board.x = this.x; this.board.z = this.z; }
  }

  // ------------------------------------------------------------ on foot
  /** E: step off the board (only when rolling slowly) or hop back on */
  toggleWalk() {
    if (this.mode === 'walk') { this.mode = 'ground'; this.footAir = false; this.y = this.w.height(this.x, this.z); this.vx = this.vz = 0; this.charge = -1; this.emit('mount'); return true; }
    if (this.mode === 'ground' && this.speed < 3.5) { this.mode = 'walk'; this.vx = this.vz = 0; this.slide = 0; this.charge = -1; this.combo.length && this.bankCombo?.(); this.emit('dismount'); return true; }
    return false;
  }

  stepWalk(dt, inp) {
    const w = this.w;
    this.heading = wrap(this.heading + inp.steer * 3.4 * dt);
    const mv = (inp.push ? 1 : 0) - (inp.brake ? 0.55 : 0);
    const spd = (inp.slide ? P.runSpeed : P.walkSpeed) * mv;
    this.vx = Math.cos(this.heading) * spd; this.vz = Math.sin(this.heading) * spd;
    this.x += this.vx * dt; this.z += this.vz * dt;
    const h = this.heading;
    this.collide(dt, false);
    this.heading = h; this.body = h;
    if (this.mode !== 'walk') return;
    // SPACE on foot: a little hop (clears low fences and hedges the same way an ollie does)
    if (inp.jumpPressed && !this.footAir) { this.footAir = true; this.footVy = P.footJump; this.emit('hop'); }
    const g = w.height(this.x, this.z);
    if (this.footAir) {
      this.footVy -= P.gravity * dt; this.y += this.footVy * dt;
      if (this.y <= g) { this.y = g; this.footAir = false; this.footVy = 0; }
    } else this.y = g;
    this.walking = Math.abs(spd) > 0.1 ? (inp.slide ? 2 : 1) : 0;
  }

  // ------------------------------------------------------------ ground
  stepGround(dt, inp) {
    const w = this.w;
    let fx = Math.cos(this.heading), fz = Math.sin(this.heading);
    let vf = this.vx * fx + this.vz * fz;
    let vl = -this.vx * fz + this.vz * fx;
    const spd = Math.hypot(vf, vl);

    // powerslide: board kicks sideways, big decel, carves you to a stop
    const wantSlide = inp.slide && spd > 2.5;
    if (wantSlide && !this.slide) { this.slide = 1; this.slideSign = inp.steer >= 0 ? 1 : -1; this.emit('slide'); }
    if (!wantSlide && this.slide) { this.slide = 0; this.emit('slideEnd'); }

    // steering (tighter when slow, like pivoting); reverses sense riding fakie so it follows the screen
    const rate = spd < 3 ? P.turnSlow : P.turnSlow + (P.turnFast - P.turnSlow) * Math.min(1, (spd - 3) / 5);
    // no fakie inversion: the chase cam follows TRAVEL, and rotating the nose rotates travel the same way,
    // so A is always screen-left whichever end of the board leads
    // the trucks ease to the stick's lean (Skate 3: 0.165 s), and you turn less while a push is in progress
    this.lean += (inp.steer - this.lean) * Math.min(1, dt / P.leanTime);
    if (!inp.steer && Math.abs(this.lean) < 0.02) this.lean = 0;
    this.heading = wrap(this.heading + this.lean * rate * (this.pushing > 0 ? P.pushTurn : 1) * dt);
    // forests: bend the line round the trees ahead instead of pinballing off them (velocity turns with the board)
    if (!this.slide && !this.noclip && spd > 1.2) {
      // what the board has steered itself: resets as you steer yourself, or slowly once it's had nothing to dodge
      this.treeYaw = (this.treeYaw || 0) * Math.exp(-dt * (inp.steer ? 4 : this.treeIdle > 0.6 ? 0.6 : 0));
      const yaw = this.treeSteer(spd) * dt, c = Math.cos(yaw), s = Math.sin(yaw);
      this.treeYaw += yaw; this.treeIdle = yaw ? 0 : (this.treeIdle || 0) + dt;
      if (yaw) { this.heading = wrap(this.heading + yaw); const vx = this.vx; this.vx = vx * c - this.vz * s; this.vz = vx * s + this.vz * c; }
    }
    fx = Math.cos(this.heading); fz = Math.sin(this.heading);
    vf = this.vx * fx + this.vz * fz; vl = -this.vx * fz + this.vz * fx;

    if (this.slide) {
      const d = Math.max(0, spd - P.slideDecel * dt) / Math.max(spd, 1e-6);
      this.vx *= d; this.vz *= d;
      vf = this.vx * fx + this.vz * fz; vl = -this.vx * fz + this.vz * fx;
    } else {
      // wheels grip: lateral skid bleeds away -> velocity follows the board
      vl *= Math.exp(-P.gripLateral * dt);
      // pushing
      this.pushT -= dt;
      if (inp.push && !this.manual && this.pushT <= 0 && Math.abs(vf) < P.pushMax && this.charge < 0) {
        // camera-relative: W always pushes toward where the camera looks, whichever end of the board that is
        const s = 1, want = inp.fwd ? inp.fwd : (vf < -0.2 ? -1 : 1);
        if (want < 0) {
          // riding switch and pushing where the camera looks: the rider turns round and pushes regular, so W
          // always takes you toward the screen and you're never stuck steering a backwards board
          this.heading = wrap(this.heading + Math.PI); fx = -fx; fz = -fz; vf = -vf; vl = -vl; this.emit('revert');
        }
        // Skate 3's push: a speed gain, capped by a limit blended from pushLow (standstill) to pushHigh (at pushMax),
        // and never past pushMax itself
        const v = Math.abs(vf), lim = P.pushLow + (P.pushHigh - P.pushLow) * Math.min(1, v / P.pushMax);
        vf += s * Math.max(0, Math.min(lim, P.pushMax - v));
        this.pushT = P.pushEvery; this.pushing = P.pushEvery + 0.08; this.emit('push');
      }
      if (inp.brake && !this.manual) { vf -= Math.sign(vf) * Math.min(Math.abs(vf), P.brake * dt); if (Math.abs(vf) < P.brakeStop) vf = 0; }
      // rolling friction: a curve of speed, more once you stop giving input; a slope that pulls harder than
      // friction overrides it (Skate 3), so you never stick on a hill
      this.idleT = inp.push || inp.steer || inp.brake || inp.jump ? 0 : this.idleT + dt;
      const fr = P.rollFriction + P.rollFrictionV * Math.abs(vf) + (this.idleT > P.idleAfter ? P.idleFriction : 0);
      if (!(Math.abs(this.slopePull || 0) > fr && Math.sign(this.slopePull) === Math.sign(vf))) vf -= Math.sign(vf) * Math.min(Math.abs(vf), fr * dt);
      this.vx = vf * fx - vl * fz; this.vz = vf * fz + vl * fx;
    }

    // manual (hold Q while rolling): balance on two wheels with W/S; keeps the combo alive across flat ground
    if (inp.manual && !this.manual && !this.slide && spd > P.manualMin && this.charge < 0) {
      this.manual = inp.brake ? -1 : 1; this.manBal = this.manual * 0.15; this.manT = 0; this.emit('manual');
    }
    if (this.manual) {
      this.manT += dt;
      const drift = Math.sign(this.manBal || this.manual) * (0.25 + Math.abs(this.manBal) * 1.1) + Math.sin(this.manT * 4.3) * 0.18;
      this.manBal += (drift - ((inp.push ? 1 : 0) - (inp.brake ? 1 : 0)) * 3.0) * dt * 0.7;
      if (!inp.manual || spd < P.manualMin * 0.7 || Math.abs(this.manBal) >= 1) this.endManual(Math.abs(this.manBal) >= 1);
    }

    // slopes
    const e = 0.2, h0 = w.height(this.x, this.z);
    const gx = (w.height(this.x + e, this.z) - w.height(this.x - e, this.z)) / (2 * e);
    const gz = (w.height(this.x, this.z + e) - w.height(this.x, this.z - e)) / (2 * e);
    let ax = -gx * P.slopeG, az = -gz * P.slopeG; const am = Math.hypot(ax, az);
    if (am > P.slopeMax) { ax *= P.slopeMax / am; az *= P.slopeMax / am; }
    this.vx += ax * dt; this.vz += az * dt;
    this.slopePull = ax * fx + az * fz;                  // downhill pull along the board (next step's friction check)
    this.clampSpeed();

    // ollie charge / pop (keyboard), or a flick-it gesture that pops immediately
    if (inp.flickPop) { this.pop(this.popVel(inp.flickPop), 'ollie'); return; }
    if (inp.jump && this.charge < 0) this.charge = 0;
    if (this.charge >= 0) {
      this.charge = Math.min(1, this.charge + dt / P.chargeTime);
      if (!inp.jump) { this.pop(this.popVel(this.charge), 'ollie'); return; }
    }

    const px = this.x, pz = this.z;
    this.x += this.vx * dt; this.z += this.vz * dt;
    if (this.collide(dt, false)) return;
    const h1 = w.height(this.x, this.z);
    const drop = this.y - h1;
    if (drop > Math.max(0.18, this.speed * dt * 1.4) && this.speed > 1) {
      // rolled off a ledge (off the lip of a kicker or a crest: keep the climb you had)
      this.mode = 'air'; this.vy = Math.max(0, Math.min(7, this.climb || 0)); this.airTime = 0; this.spin = 0; this.airTricks = []; this.body = this.heading;
      this.emit('air');
      return;
    }
    this.climb = (h1 - this.y) / dt; this.y = h1;
    this.body = this.slide ? this.heading + this.slideSign * Math.PI / 2 * Math.min(1, this.slide) : this.heading;
    if (this.slide) this.slide = Math.min(1, this.slide + dt * 6);

    const under = w.tileKind(this.x, this.z);
    if ((under === 2 || under === 3) && !this.noclip) { this.bail(under === 2 ? 'water' : 'rocks'); return; }
    this.safeT += dt;
    if (this.safeT > P.safeEvery && this.speed < 9) { this.safeT = 0; this.lastSafe = { x: this.x, z: this.z, heading: this.heading }; }
    void px; void pz; void h0;
  }

  /** turn rate (rad/s, + = left) that steers round tall blocked tiles (trees, statues) in the path ahead:
   *  cast feelers across a fan of directions and bend toward the clearest one. Only kicks in when a TREE is in
   *  the line (never for walls, water or low stuff you can ollie/grind), but a feeler that runs into water counts
   *  as blocked so it never dodges a tree into the river. */
  treeSteer(spd) {
    const a0 = Math.atan2(this.vz, this.vx), LOOK = Math.max(1.6, Math.min(4, 0.45 * spd + 0.8));
    const first = this.feeler(a0, LOOK);
    if (first.d >= LOOK || !first.tree) return 0;
    let best = { off: 0, score: first.d / LOOK };
    for (let k = 1; k <= 10; k++) for (const sgn of [1, -1]) {
      const off = sgn * k * 0.12, f = this.feeler(a0 + off, LOOK);
      const score = f.d / LOOK - 0.22 * Math.abs(off);
      if (score > best.score + 1e-3) best = { off, score };
    }
    // only for a line that is really clearer, and never more than ~60 degrees off where you were going in total
    // (it helps you round trees, it doesn't drive for you: no U-turns in a dead end)
    if (!best.off || best.score < first.d / LOOK + P.treeGain) return 0;
    if (Math.sign(best.off) === Math.sign(this.treeYaw) && Math.abs(this.treeYaw) > P.treeCap) return 0;
    return Math.max(-P.treeAvoid, Math.min(P.treeAvoid, best.off * 10)) * Math.min(1, spd / 2.5);
  }

  /** distance along a ray (half-width ~ the rider) to the first tall block / water / rock tile */
  feeler(a, look) {
    const dx = Math.cos(a), dz = Math.sin(a), lx = -dz * 0.3, lz = dx * 0.3, w = this.w;
    for (let d = 0.3; d < look; d += 0.25) {
      const px = this.x + dx * d, pz = this.z + dz * d;
      for (const o of [0, 1, -1]) {
        const qx = px + lx * o, qz = pz + lz * o, k = w.tileKind(qx, qz);
        if (w.trunkAt(qx, qz, 0.05)) return { d, tree: true };
        if (k === 0 || k === 4) continue;
        const tree = k === 1 && this.tallBlock(Math.floor(qx), Math.floor(qz));
        if (tree || k !== 1) return { d, tree };
      }
      // walls/fences (anything you can't just roll through) end a feeler too, so it never dodges a tree into a wall
      if (d > 0.5) for (const s of w.segsNear(px, pz, 0.5)) if (s.kind !== 'block' && s.kind !== 'water' && this.solid(s, false) && segDist(px, pz, s) < 0.3) return { d, tree: false };
    }
    return { d: look, tree: false };
  }

  tallBlock(tx, tz) {
    const w = this.w;
    if (w.tileKind(tx + 0.5, tz + 0.5) !== 1) return false;
    const c = w._tall || (w._tall = new Map()), k = tx * 4096 + tz;
    let v = c.get(k);
    if (v === undefined) {
      v = true;
      for (const s of w.segsNear(tx + 0.5, tz + 0.5, 0.6)) if (s.kind === 'block' && s.top && segDist(tx + 0.5, tz + 0.5, s) < 0.55) { v = false; break; }
      c.set(k, v);
    }
    return v;
  }

  /** Skate 3's ollie: a target HEIGHT between a low and a high pop (both grow with speed up to popSpeed), picked by
   *  the pop strength (flick speed or SPACE charge, 0..1), turned into a launch speed v = sqrt(2 g h) */
  popVel(strength) {
    const c = Math.min(1, 0.6 + 0.4 * this.speed / P.popSpeed);
    const lo = P.popAbsMin + c * (P.popMin - P.popAbsMin), hi = P.popAbsMin + c * (P.popMax - P.popAbsMin);
    const h = lo + (hi - lo) * Math.max(0, Math.min(1, strength));
    return Math.sqrt(2 * P.gravity * h);
  }

  pop(vy, kind) {
    if (this.manual) this.endManual(false);
    this.mode = 'air'; this.vy = vy; this.charge = -1; this.airTime = 0; this.spin = 0; this.spinRate = 0;
    this.body = this.heading; this.trick = null; this.airTricks = [];
    this.slide = 0;
    this.airTricks.push(kind === 'ollie' ? 'Ollie' : kind);
    this.emit('pop', { vy });
  }

  endManual(lost) {
    const t = this.manT, nose = this.manual < 0;
    this.manual = 0; this.manBal = 0;
    // integral of the held rate: full for holdFull seconds, then fading
    const full = Math.min(t, P.holdFull), fade = t > P.holdFull ? P.holdFade * (1 - Math.exp(-(t - P.holdFull) / P.holdFade)) : 0;
    if (t > 0.3) this.addCombo(nose ? 'Nose Manual' : 'Manual', Math.round((full + fade) * P.manualPts));
    if (lost) { this.comboTimer = Math.min(this.comboTimer || 0, 0.35); this.emit('wobble'); }   // touched down: combo banks soon
    this.emit('manualEnd');
  }

  // ------------------------------------------------------------ air
  stepAir(dt, inp) {
    this.airTime += dt;
    // grabs (hold Q in the air): points while held, let go before you land
    if (inp.manual && !this.grab && !this.trick && this.airTime > 0.08) {
      this.grab = inp.steer > 0 ? 'Melon' : inp.steer < 0 ? 'Indy' : (this.vy > 0 ? 'Method' : 'Stalefish'); this.grabT = 0; this.emit('grab', { kind: this.grab });
    }
    if (this.grab) {
      this.grabT += dt;
      if (!inp.manual) this.releaseGrab();
    }
    this.vy -= P.gravity * dt;
    // spins (A/D in the air)
    // spins wind up toward the stick's rate and fade out when you let go (Skate 3's body spin)
    if (inp.steer) { const want = inp.steer * P.airSpin, d = want - this.spinRate; this.spinRate += Math.sign(d) * Math.min(Math.abs(d), P.airSpinAccel * dt); }
    else this.spinRate *= Math.pow(P.airSpinFade, dt * 60);
    const sr = this.spinRate * dt;
    this.spin += sr; this.body = wrap(this.body + sr); this.heading = wrap(this.heading + sr);
    if (!inp.steer && this.speed > 1) {
      // let go of A/D and the board settles onto the nearest 180 of your travel line, so a half-held spin still lands
      const dir = Math.atan2(this.vz, this.vx);
      const off = wrap(this.heading - dir), tgt = Math.abs(off) < Math.PI / 2 ? 0 : (off > 0 ? Math.PI : -Math.PI);
      const err = off - tgt, step = Math.sign(err) * Math.min(Math.abs(err), P.spinAssist * dt);
      this.heading = wrap(this.heading - step); this.body = wrap(this.body - step); this.spin -= step;
    }
    // flip tricks
    if (!this.trick && inp.trick) {
      this.trick = inp.trick; this.trickT = 0; this.emit('flip', { trick: inp.trick });
    }
    if (this.trick) {
      const T = TRICKS[this.trick];
      this.trickT += dt / P.flipTime;
      const u = Math.min(1, this.trickT);
      this.boardRoll = T.roll * 2 * Math.PI * ease(u);
      this.boardYaw = T.yaw * Math.PI * ease(u);
      if (this.trickT >= 1) {
        this.airTricks.push(T.name); this.trick = null; this.boardRoll = 0;
        if (T.yaw % 2) this.heading = wrap(this.heading + Math.PI); this.boardYaw = 0;   // board ends switched ends
      }
    }
    this.x += this.vx * dt; this.z += this.vz * dt; this.y += this.vy * dt;
    // catch a rail on the way down (checked before walls, so brushing a rail's side catches it instead of bouncing off)
    if (this.vy < 3 && this.tryGrind()) return;
    // flying through a tree: hold the board just over it until you're out the other side, so you never land in one
    if (!this.noclip && this.speed > 1.5 && (this.w.trunkAt(this.x, this.z, P.trunkPad + 0.1)
        || (this.w.tileKind(this.x, this.z) === 1 && this.tallBlock(Math.floor(this.x), Math.floor(this.z))))) {
      const gt = this.w.height(this.x, this.z) + P.treeClear + 0.01;
      if (this.y < gt && this.y > gt - 0.5) { this.y = gt; this.vy = Math.max(this.vy, -1.5); }
    }
    if (this.collide(dt, true)) return;

    const g = this.w.height(this.x, this.z);
    if (this.y <= g) {
      this.y = g;
      const kind = this.w.tileKind(this.x, this.z);
      if ((kind === 2 || kind === 3) && !this.noclip) { this.bail(kind === 2 ? 'water' : 'rocks'); return; }    // 3 = a rocky outcrop
      this.land(-this.vy);
    }
  }

  releaseGrab() {
    if (!this.grab) return;
    if (this.grabT > 0.12) this.airTricks.push(`${this.grab} Grab`), (this.grabPts = (this.grabPts || 0) + this.grabT * P.grabPts);
    this.grab = null;
  }

  /** how far the board is from wheels-down mid-flip (rad): roll off the nearest full turn, yaw off the nearest half */
  flipError() {
    if (!this.trick) return 0;
    const r = Math.abs(wrap(this.boardRoll)), y = Math.abs(wrap(this.boardYaw)), yh = Math.min(y, Math.PI - y);
    return Math.max(r, yh);
  }

  land(impact) {
    const w = this.w, e = 0.2;
    // resolve the touchdown against the ground normal: the part of the velocity INTO the ground is the impact, the
    // tangent part carries on (landing down a bank keeps your speed, landing into a rise eats it)
    const gx = (w.height(this.x + e, this.z) - w.height(this.x - e, this.z)) / (2 * e);
    const gz = (w.height(this.x, this.z + e) - w.height(this.x, this.z - e)) / (2 * e);
    const nl = Math.hypot(gx, 1, gz), nx = -gx / nl, ny = 1 / nl, nz = -gz / nl;
    const into = -(this.vx * nx + this.vy * ny + this.vz * nz);
    if (into > 0) {
      this.vx += into * nx; this.vz += into * nz;          // drop the normal part; what is left rolls on
      this.clampSpeed();
      impact = into;
    }
    const spd = this.speed;
    const sideV = Math.abs(-this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading));
    const spinRate = Math.abs(this.spinRate);
    if (this.grab) { const late = this.grabT; this.releaseGrab(); if (late > 0.25 && impact > 6) return this.bail('sketchy'); }
    // mid-flip: wheels nearly down = you catch it late and ride it out; board upside down or across = bail
    if (this.trick) {
      const err = this.flipError();
      if (err > Math.PI / 2) return this.bail('flip');
      const T = TRICKS[this.trick]; this.airTricks.push(T.name); if (T.yaw % 2) this.heading = wrap(this.heading + Math.PI); this.trick = null;
      if (err > 0.5) this.emit('wobble');
    }
    this.boardRoll = 0; this.boardYaw = 0;
    const fromRail = this.railExitT > 0;
    if (impact > P.hardLanding * (fromRail ? 2 : 1)) return this.bail('slam');
    if (spd > 1.2) {
      const dir = Math.atan2(this.vz, this.vx);
      const a = Math.abs(wrap(this.heading - dir)), b = Math.abs(wrap(this.heading + Math.PI - dir));
      const mis = Math.min(a, b), wide = spd < 3 ? P.landSlowBonus : 1;
      if (mis > P.landSketchy * wide && !fromRail) return this.bail('sketchy');
      // sketchiness (Skate 3, from 2 tiles/s): spin rate over 0.1..7 rad/s, sideways speed over 0.1..10 tiles/s, and
      // how far the board is off the travel line
      const k01 = v => Math.max(0, Math.min(1, v));
      const sk = spd < 2 ? 0 : Math.max(k01((spinRate - 0.1) / 6.9), k01((sideV - 0.1) / 9.9), k01((mis - P.landAngle * wide) / (P.landSketchy * wide - P.landAngle * wide)));
      if (sk > P.sketchyAt && !fromRail) {               // rode it out: scrub speed, no bail
        const k = 1 - 0.45 * sk;
        this.vx *= k; this.vz *= k; this.emit('wobble');
      }
      // snap the board to the travel line (regular or fakie)
      this.heading = a < b ? dir : wrap(dir + Math.PI);
    }
    this.body = this.heading; this.spinRate = 0;
    this.mode = 'ground'; this.vy = 0;
    this.scoreAir();
    this.emit('land', { impact });
  }

  scoreAir() {
    const spins = Math.round(Math.abs(this.spin) / Math.PI) * 180;
    const tricks = this.airTricks.slice();
    if (!tricks.length) return;
    // "Ollie" on its own is only worth a little; flips replace the ollie
    let names = tricks.filter(t => t !== 'Ollie');
    if (!names.length) names = ['Ollie'];
    let pts = names.reduce((a, n) => a + (Object.values(TRICKS).find(t => t.name === n)?.pts ?? 50), 0);
    if (spins >= 180) { names[0] = `${this.spin > 0 ? 'FS' : 'BS'} ${spins} ${names[0]}`; pts += spins * 1.1; }
    pts += Math.round(this.airTime * 60) + Math.round(this.grabPts || 0); this.grabPts = 0;
    this.addCombo(names.join(' + '), Math.round(pts));
  }

  addCombo(name, pts) {
    // the same trick again in one combo is worth half as much each time (by its base name: 'FS 180 Kickflip' and
    // 'Kickflip' are the same flip)
    const base = name.replace(/^(FS|BS) \d+ /, '');
    const k = this.comboSeen.get(base) || 0; this.comboSeen.set(base, k + 1);
    pts = Math.round(pts * Math.pow(P.repeatDecay, k));
    this.combo.push(name); this.comboPts += pts;
    this.comboTimer = 1.6;
    this.emit('trick', { name, pts });
  }

  // ------------------------------------------------------------ grind
  tryGrind() {
    let best = null;
    for (const r of this.w.railsNear(this.x, this.z, 1)) {
      if (r === this.ignoreRail) continue;
      // distance to the rail line + position along it
      const t = r.horiz ? this.x - r.ax : this.z - r.az;
      if (t < -0.3 || t > r.len + 0.3) continue;
      const off = r.horiz ? this.z - r.az : this.x - r.ax;
      if (Math.abs(off) > P.grindCatch) continue;
      const top = railTop(r, Math.max(0, Math.min(r.len, t)));
      if (this.y < top - (this.vy < 0 ? 0.6 : 0.3) || this.y > top + 1.0) continue;
      if (!best || Math.abs(off) < best.off) best = { r, t, off: Math.abs(off), top };
    }
    if (!best) return false;
    const { r, t, top } = best;
    const along = this.vx * r.dirx + this.vz * r.dirz;
    if (Math.abs(along) < 0.6 || Math.abs(along) < 0.2 * this.speed) return false;   // crossing it, not riding along it
    const left = along >= 0 ? r.len - t : t;            // rail still ahead of you
    if (left < 0.25) return false;                       // leaving its end already: nothing to lock onto
    const rdir = Math.atan2(r.dirz, r.dirx);
    const rel = Math.abs(wrap(this.heading - rdir));
    const relA = Math.min(rel, Math.PI - rel);           // 0 = board along rail, pi/2 = across
    this.releaseGrab();
    if (this.trick && this.flipError() > Math.PI / 2) return false;   // board still upside down/across mid-flip: it can't take the rail
    if (this.trick) { this.airTricks.push(TRICKS[this.trick].name); this.trick = null; }
    this.boardRoll = 0; this.boardYaw = 0;
    this.scoreAir();
    const offv = r.horiz ? this.z - r.az : this.x - r.ax;
    this.railSide = offv >= 0 ? 1 : -1;                 // the side we came up from
    this.mode = 'grind'; this.rail = r;
    this.railDir = along >= 0 ? 1 : -1;
    this.railT = Math.max(0, Math.min(r.len, t));
    this.railSpeed = Math.max(P.grindMin, Math.abs(along) * 0.95);
    this.grindKind = relA > 0.9 ? 'Boardslide' : relA > 0.45 ? 'Crooked Grind' : '50-50';
    this.grindHeading = relA > 0.9 ? rdir + Math.PI / 2 : (Math.abs(wrap(this.heading - rdir)) < Math.PI / 2 ? rdir : rdir + Math.PI);
    if (this.grindKind === 'Crooked Grind') this.grindHeading += (wrap(this.heading - this.grindHeading) > 0 ? 0.5 : -0.5);
    this.heading = wrap(this.grindHeading); this.body = this.heading;
    this.balance = (Math.random() - 0.5) * 0.2; this.grindTime = 0;
    this.grindHold = 0;
    this.y = top; this.vy = 0;
    this.x = r.horiz ? r.ax + this.railT : r.ax; this.z = r.horiz ? r.az : r.az + this.railT;
    this.emit('grind', { kind: this.grindKind, mat: this.rail?.mat });
    return true;
  }

  stepGrind(dt, inp) {
    const r = this.rail;
    this.grindTime += dt;
    // balance: drifts and grows unless you correct with A/D
    const drift = (this.balance >= 0 ? 1 : -1) * (0.16 + Math.abs(this.balance) * 0.9) + Math.sin(this.grindTime * 5.1) * 0.12;
    this.balance += (drift - inp.steer * 3.4) * dt * (this.grindKind === '50-50' ? 0.55 : 0.8);
    if (Math.abs(this.balance) >= 1) {
      // lost it: step off the side you leaned to and roll away (the grind still scores), no slam
      this.popOffRail = true; this.railSide = this.balance > 0 ? 1 : -1;
      const r0 = this.rail, o = 0.4 * this.railSide;
      this.leaveRail(1.0);
      if (r0.horiz) this.z = r0.az + o; else this.x = r0.ax + o;
      this.emit('wobble');
      return;
    }
    // board swings smoothly onto the rail line (corners, stair-stepped diagonal fences) instead of snapping
    this.heading = wrap(this.heading + wrap(this.grindHeading - this.heading) * Math.min(1, dt * 12)); this.body = this.heading;
    if (this.bridge) { this.stepBridge(dt, inp); return; }
    // slope of the rail speeds you up / slows you down
    const t0 = this.railT;
    const slope = (railTop(r, Math.min(r.len, t0 + 0.2)) - railTop(r, Math.max(0, t0 - 0.2))) / 0.4 * this.railDir;
    this.railSpeed = Math.max(0.5, this.railSpeed - (P.grindFriction + slope * 7) * dt);
    this.railT += this.railDir * this.railSpeed * dt;
    const top = railTop(r, Math.max(0, Math.min(r.len, this.railT)));
    this.x = r.horiz ? r.ax + this.railT : r.ax;
    this.z = r.horiz ? r.az : r.az + this.railT;
    this.y = top;
    this.vx = r.dirx * this.railDir * this.railSpeed; this.vz = r.dirz * this.railDir * this.railSpeed;
    { const g = holdRate(160, this.grindHold = (this.grindHold || 0) + dt) * dt; this.comboPts += g; this.grindPts = (this.grindPts || 0) + g; }
    // hit something standing on the rail line (end posts, perpendicular walls)?
    for (const s of this.w.segsNear(this.x, this.z, 0.6)) {
      if (s.kind === 'rail' || s.kind === 'water' || s.kind === 'edge') continue;
      if (s.top && this.y > Math.max(...s.top) - 0.05) continue;   // low stuff under the rail can't stop you
      if ((s.dx === 0) !== r.horiz) continue;                 // only walls crossing the rail line
      const across = r.horiz ? [Math.min(s.az, s.bz), Math.max(s.az, s.bz), r.az, s.ax, this.x]
                             : [Math.min(s.ax, s.bx), Math.max(s.ax, s.bx), r.ax, s.az, this.z];
      if (across[0] < across[2] - 0.05 && across[1] > across[2] + 0.05 && Math.abs(across[4] - across[3]) < 0.1) { this.bail('slam'); return; }
    }
    // rail end: carry the grind round the corner / across the gap onto the next rail if there is one
    if (!inp.jumpPressed && (this.railT < -0.05 || this.railT > r.len + 0.05) && this.continueRail()) return;
    // pop off / rail end
    if (inp.jumpPressed || this.railT < -0.05 || this.railT > r.len + 0.05) {
      const pop = inp.jumpPressed ? P.ollieMin * 0.95 : 1.2;
      this.popOffRail = !!inp.jumpPressed;
      const side = inp.jumpPressed ? inp.steer : 0;   // hold A/D while popping to hop across to the next rail
      this.leaveRail(pop);
      if (side) {
        // same sense as steering: rotate the travel direction 90 degrees toward the steer side
        const dx = r.dirx * this.railDir, dz = r.dirz * this.railDir, k = 2.6 * Math.sign(side);
        this.vx += -dz * k; this.vz += dx * k;
      }
    }
  }

  /** at the end of this.rail: find the rail the line carries on to (a corner, a bend, a small gap) and bridge
   *  onto it. Fences in RS are chains of straight tile edges, so a bent fence is several rails end to end. */
  continueRail() {
    const r = this.rail, endT = this.railDir > 0 ? r.len : 0;
    const ex = r.horiz ? r.ax + endT : r.ax, ez = r.horiz ? r.az : r.az + endT, ey = railTop(r, endT);
    const fx = r.dirx * this.railDir, fz = r.dirz * this.railDir;
    let best = null;
    for (const q of this.w.railsNear(ex, ez, 2)) {
      if (q === r) continue;
      for (const [qt, qdir] of [[0, 1], [q.len, -1]]) {
        const qx = q.horiz ? q.ax + qt : q.ax, qz = q.horiz ? q.az : q.az + qt;
        const gap = Math.hypot(qx - ex, qz - ez);
        if (gap > P.grindGap) continue;
        const ox = q.dirx * qdir, oz = q.dirz * qdir, dot = fx * ox + fz * oz;
        if (dot < -0.1) continue;                                           // no hairpins
        if (gap > 0.05 && (qx - ex) * fx + (qz - ez) * fz < -0.3) continue;   // never hop back to a rail behind you
        const qy = railTop(q, qt);
        if (qy - ey > 0.6 || ey - qy > 1.3) continue;
        if (gap > 0.05 && this.gapBlocked(ex, ez, qx, qz, Math.max(ey, qy))) continue;
        const score = gap + (1 - dot) * 0.6;
        if (!best || score < best.score) best = { q, qt, qdir, qx, qz, qy, dot, score, gap };
      }
    }
    if (!best) return false;
    const { q, qt, qdir, qx, qz, qy, dot, gap } = best;
    // keep riding on the same side of the line and with the board the same way round relative to travel
    const left = this.railSide * (r.horiz ? fx : -fz), ox = q.dirx * qdir, oz = q.dirz * qdir;
    const off = wrap(this.grindHeading - Math.atan2(fz, fx));
    this.railSpeed = Math.max(P.grindMin * 0.8, this.railSpeed * (0.9 + 0.1 * Math.max(0, dot)));
    this.bridge = { x0: ex, z0: ez, y0: ey, x1: qx, z1: qz, y1: qy, len: gap, d: 0, dx: gap > 1e-6 ? (qx - ex) / gap : ox, dz: gap > 1e-6 ? (qz - ez) / gap : oz,
      next: { rail: q, t: qt, dir: qdir, side: left * (q.horiz ? ox : -oz) || this.railSide, heading: wrap(Math.atan2(oz, ox) + off) } };
    if (gap < 1e-6) this.stepBridge(0, {});
    return true;
  }

  /** a solid wall/fence standing across the gap you'd bridge? (low stuff under the rail height is fine) */
  gapBlocked(ax, az, bx, bz, y) {
    for (const s of this.w.segsNear((ax + bx) / 2, (az + bz) / 2, Math.hypot(bx - ax, bz - az) / 2 + 0.6)) {
      if (s.kind === 'rail' || s.kind === 'water' || s.kind === 'edge') continue;
      if (s.top && y > Math.max(...s.top) - 0.05) continue;
      if (segsCross(ax, az, bx, bz, s.ax, s.az, s.bx, s.bz)) return true;
    }
    return false;
  }

  /** riding across the gap between two rails (straight line, a little float over longer gaps) */
  stepBridge(dt, inp) {
    const b = this.bridge;
    b.d += this.railSpeed * dt;
    const u = b.len > 1e-6 ? Math.min(1, b.d / b.len) : 1;
    this.x = b.x0 + (b.x1 - b.x0) * u; this.z = b.z0 + (b.z1 - b.z0) * u;
    this.y = b.y0 + (b.y1 - b.y0) * u + Math.sin(u * Math.PI) * Math.min(0.25, b.len * 0.15);
    this.vx = b.dx * this.railSpeed; this.vz = b.dz * this.railSpeed;
    { const g = holdRate(160, this.grindHold = (this.grindHold || 0) + dt) * dt; this.comboPts += g; this.grindPts = (this.grindPts || 0) + g; }
    if (inp.jumpPressed) {                                // popping off mid-gap: same as popping off the rail
      this.bridge = null; this.popOffRail = true; this.leaveRail(P.ollieMin * 0.95);
      if (inp.steer) { const k = 2.6 * Math.sign(inp.steer); this.vx += -b.dz * k; this.vz += b.dx * k; }
      return;
    }
    if (u >= 1) {
      const n = b.next;
      this.bridge = null; this.rail = n.rail; this.railT = n.t; this.railDir = n.dir; this.railSide = n.side;
      this.grindHeading = n.heading;
      this.emit('grindLink');
    }
  }

  leaveRail(vy) {
    const kind = this.grindKind;
    this.addCombo(kind, Math.round(100 + (this.grindPts || 0)));
    this.grindPts = 0;
    this.ignoreRail = this.rail; this.ignoreT = 0.35;
    this.railExitT = 1.2;             // coming off a rail always lands clean (no sketchy/slam, no air wall slam)
    const r = this.rail;
    if (!this.popOffRail) {
      // rolled off the end: drop back down on the side we came up from, clear of the wall line
      const o = 0.34 * this.railSide;
      if (r.horiz) this.z = r.az + o; else this.x = r.ax + o;
    }
    this.rail = null; this.bridge = null;
    this.mode = 'air'; this.vy = vy; this.airTime = 0; this.spin = 0; this.airTricks = []; this.trick = null;
    // boardslide exits: board swings back in line with travel
    const dir = Math.atan2(this.vz, this.vx);
    this.heading = Math.abs(wrap(this.heading - dir)) < Math.PI / 2 ? dir : wrap(dir + Math.PI);
    this.body = this.heading;
    this.emit('ungrind');
  }

  // ------------------------------------------------------------ collisions
  /** push the skater out of walls; returns true if it caused a bail */
  collide(dt, air) {
    if (this.unstickTo) return false;   // gliding out of a hitbox: from inside, wall pushes point further in
    const R = P.radius;
    for (let iter = 0; iter < 3; iter++) {
      let hit = null;
      for (const s of this.w.segsNear(this.x, this.z, 1)) {
        if (!this.solid(s, air)) continue;
        const r = s.kind === 'block' ? P.blockRadius : R;
        const c = closest(this.x, this.z, s);
        const d = Math.hypot(this.x - c.x, this.z - c.z);
        if (d < r && (!hit || d - r < hit.d - hit.r)) hit = { s, c, d, r };
      }
      // tree trunks: circles the size of the trunk itself, so you only touch a tree where it stands
      if (!this.noclip && !(air && this.y - this.w.height(this.x, this.z) > P.treeClear)) {
        for (const t of this.w.trunksNear(this.x, this.z, 1)) {
          const r = t.r + P.trunkPad, d = Math.hypot(this.x - t.x, this.z - t.z);
          if (d < r && (!hit || d - r < hit.d - hit.r)) hit = { s: TRUNK, t, c: { x: t.x, z: t.z }, d, r };
        }
      }
      if (!hit) return false;
      if (hit.t && this.speed > 0.8) {
        // a trunk is small: slip round it on the side you're already on and keep your line, like brushing past
        // (a glance along the tangent turned a dead-centre hit into a 90 degree swerve)
        const sp = this.speed, ux = this.vx / sp, uz = this.vz / sp, lx = -uz, lz = ux;
        const rx = this.x - hit.c.x, rz = this.z - hit.c.z, a = rx * ux + rz * uz, lat = rx * lx + rz * lz;
        const side = lat >= 0 ? 1 : -1, need = Math.sqrt(Math.max(0, hit.r * hit.r - a * a)) + 0.005;
        this.x = hit.c.x + ux * a + lx * need * side; this.z = hit.c.z + uz * a + lz * need * side;
        const headOn = Math.max(0, 1 - Math.abs(lat) / hit.r), k = Math.exp(-dt * 1.5 * headOn);
        this.vx *= k; this.vz *= k;
        if (headOn > 0.7 && sp > 3) this.bumpSound(sp * headOn);
        continue;
      }
      let nx = this.x - hit.c.x, nz = this.z - hit.c.z;
      const L = Math.hypot(nx, nz);
      if (L < 1e-6) {
        if (hit.t) { const sp = Math.max(this.speed, 1e-6); nx = -this.vz / sp || 1; nz = this.vx / sp; }
        else { nx = -hit.s.dz / hit.s.len; nz = hit.s.dx / hit.s.len; }
      } else { nx /= L; nz /= L; }
      this.x = hit.c.x + nx * hit.r; this.z = hit.c.z + nz * hit.r;
      const vn = this.vx * nx + this.vz * nz;
      if (vn < 0 && hit.s.kind === 'block') {
        // trees, rocks, props: glance off and keep your speed, redirected along the obstacle. Never a dead stop.
        const sp = this.speed, headOn = -vn / Math.max(sp, 1e-6);
        let tx = -nz, tz = nx;
        const vt = this.vx * tx + this.vz * tz;
        if (hit.t) { if (vt < 0) { tx = -tx; tz = -tz; } }   // round a trunk on whichever side you're already heading
        else if (Math.abs(vt) < 0.35 * sp) {
          // (nearly) head-on: go round whichever corner of the obstacle is open, preferring the nearer one
          const s = hit.s, u = segParam(this.x, this.z, s), sx = s.dx / s.len, sz = s.dz / s.len;
          const cost = dir => {                          // dir +1 = toward s.b, -1 = toward s.a
            const run = (dir > 0 ? 1 - u : u) * s.len;
            const ex = (dir > 0 ? s.bx : s.ax) + sx * dir * 0.45 + nx * 0.35, ez = (dir > 0 ? s.bz : s.az) + sz * dir * 0.45 + nz * 0.35;
            let open = this.w.tileKind(ex, ez) === 0;
            if (open) for (const o of this.w.segsNear(ex, ez, 1)) if (o !== s && o.kind !== 'water' && this.solid(o, air) && segDist(ex, ez, o) < 0.2) { open = false; break; }
            return run + (open ? 0 : 5);
          };
          const want = cost(1) <= cost(-1) ? 1 : -1;
          if ((tx * sx + tz * sz) * want < 0) { tx = -tx; tz = -tz; }
        } else if (vt < 0) { tx = -tx; tz = -tz; }
        const keep = 1 - 0.2 * headOn, out = Math.min(1.2, -vn * 0.12);
        this.vx = tx * sp * keep + nx * out; this.vz = tz * sp * keep + nz * out;
        if (!air && this.speed > 0.5) {
          const dir = Math.atan2(this.vz, this.vx);
          this.heading = Math.abs(wrap(this.heading - dir)) < Math.PI / 2 ? dir : wrap(dir + Math.PI);
        }
        if (headOn > 0.6 && sp > 3) this.bumpSound(-vn);
        continue;
      }
      if (vn < 0) {
        const impact = -vn;
        const headOn = impact / Math.max(this.speed, 1e-6);
        if (impact > (air ? P.slamAir : P.slamWall) && headOn > P.slamHeadOn && !(this.railExitT > 0) && hit.s.kind !== 'rail') { this.bail('wall', { impact }); return true; }
        if (headOn > 0.85 && impact > 2.5) {
          // square-on but survivable: bounce back off it and stay on the board
          this.vx -= vn * nx * 1.1; this.vz -= vn * nz * 1.1;   // mostly stop, tiny rebound: no 180 camera flip
          this.vx *= 0.7; this.vz *= 0.7; this.bumpSound(impact);
          continue;
        }
        // slide along the wall, lose a little speed, board turns to follow
        this.vx -= vn * nx * 1.15; this.vz -= vn * nz * 1.15;
        const loss = 1 - Math.min(0.35, 0.08 * impact);          // scrub scales with how hard you hit
        this.vx *= loss; this.vz *= loss;
        if (!air && this.speed > 0.5) {
          const dir = Math.atan2(this.vz, this.vx);
          this.heading = Math.abs(wrap(this.heading - dir)) < Math.PI / 2 ? dir : wrap(dir + Math.PI);
        }
        if (impact > 1.8) this.bumpSound(impact);
      }
    }
    return false;
  }

  solid(s, air) {
    if (this.noclip) return !!s.frontier;         // owner ::noclip: through everything except the edge of the loaded map
    if (s.kind === 'water') return !air;          // you can fly over the bank... and into the river
    // trees, statues, props: any real air carries you straight through (not realistic, but forests are for flowing)
    if (s.kind === 'block' && air && this.y - this.w.height(this.x, this.z) > P.treeClear) return false;
    if (s.top) {
      // low walls, railings, fences, gates, hedges, small cacti/rocks: clear them if the board is above the top
      const u = segParam(this.x, this.z, s);
      const top = s.top[0] + (s.top[2] - s.top[0]) * u;
      return this.y < Math.max(s.top[0], s.top[1], s.top[2], top) - 0.02;
    }
    return true;
  }

  /** never stay inside a hitbox: if the skater ends up in a blocked tile or wedged between walls,
   *  glide it smoothly to the nearest open spot (a few tiles/s), keeping its speed, then carry on. */
  unstick(dt) {
    const w = this.w;
    if (this.noclip) { this.unstickTo = null; return; }
    if (!this.unstickTo) {
      // in the air you may be flying over a hedge/cactus tile: only a real wedge counts there
      const inBlocked = this.mode !== 'air' && (w.tileKind(this.x, this.z) === 1 || !!w.trunkAt(this.x, this.z, -0.02));
      if (!inBlocked && !this.wedged()) { this.stuckT = 0; return; }
      this.stuckT = (this.stuckT || 0) + dt;
      if (this.stuckT < 0.08) return;                    // a one-frame graze resolves itself
      this.unstickTo = this.freeSpot(this.x, this.z);
      if (!this.unstickTo) return;
    }
    const t = this.unstickTo, dx = t.x - this.x, dz = t.z - this.z, d = Math.hypot(dx, dz);
    if (d < 0.02) { this.unstickTo = null; this.stuckT = 0; return; }
    const step = Math.min(d, Math.max(3, d * 6) * dt);
    this.x += dx / d * step; this.z += dz / d * step;
    const vn = (this.vx * dx + this.vz * dz) / d;        // no speed back into the thing we left
    if (vn < 0) { this.vx -= vn * dx / d; this.vz -= vn * dz / d; }
    if (this.mode !== 'air') this.y = w.height(this.x, this.z);
    if (d - step < 0.02) { this.unstickTo = null; this.stuckT = 0; }
  }

  /** closer to a solid segment than collide() could resolve (pinched in a corner, landed inside a footprint) */
  wedged() {
    const air = this.mode === 'air';
    for (const s of this.w.segsNear(this.x, this.z, 1)) {
      if (s.kind === 'water' || !this.solid(s, air)) continue;
      if (segDist(this.x, this.z, s) < (s.kind === 'block' ? P.blockRadius : P.radius) * 0.5) return true;
    }
    return !air && !this.noclip && !!this.w.trunkAt(this.x, this.z, P.trunkPad * 0.5);
  }

  /** nearest open point clear of every solid segment, searched outward ring by ring */
  freeSpot(x, z) {
    const w = this.w; let best = null, bd = 1e9;
    const clear = (px, pz) => {
      const k = w.tileKind(px, pz);
      if ((k !== 0 && k !== 4) || w.trunkAt(px, pz, P.trunkPad + 0.06)) return false;
      if (this.mode !== 'air' && Math.abs(w.height(px, pz) - this.y) > 1.6) return false;
      for (const s of w.segsNear(px, pz, 1)) {
        if (s.kind === 'water' || s.kind === 'edge') continue;
        if (segDist(px, pz, s) < (s.kind === 'block' ? P.blockRadius : P.radius) + 0.06) return false;
      }
      return true;
    };
    for (let r = 0; r <= 5 && !best; r++) {
      for (let ix = -r; ix <= r; ix++) for (let iz = -r; iz <= r; iz++) {
        if (Math.max(Math.abs(ix), Math.abs(iz)) !== r) continue;
        const tx = Math.floor(x) + ix, tz = Math.floor(z) + iz;
        const near = [Math.min(tx + 0.95, Math.max(tx + 0.05, x)), Math.min(tz + 0.95, Math.max(tz + 0.05, z))];
        for (const [px, pz] of [near, [tx + 0.5, tz + 0.5]]) {
          const d = Math.hypot(px - x, pz - z);
          if (d < bd && clear(px, pz)) { bd = d; best = { x: px, z: pz }; }
        }
      }
    }
    return best;
  }

  clampSpeed() {
    const s = this.speed;
    if (s > P.maxSpeed) { this.vx *= P.maxSpeed / s; this.vz *= P.maxSpeed / s; }
  }

  // ------------------------------------------------------------ stacking it
  bail(why, o = {}) {
    if (this.mode === 'bail') return;
    this.stat.bails++;
    const b = this.board;
    b.free = true; b.x = this.x; b.z = this.z; b.y = this.y + 0.05;
    b.vx = this.vx * 1.15 + (Math.random() - 0.5) * 2; b.vz = this.vz * 1.15 + (Math.random() - 0.5) * 2;
    b.vy = 2.5 + Math.random() * 2.5; b.yaw = this.heading; b.roll = this.boardRoll; b.pitch = 0;
    b.spinR = (Math.random() - 0.5) * 22; b.spinY = (Math.random() - 0.5) * 12; b.spinP = (Math.random() - 0.5) * 10;
    // the rider goes limp: a ragdoll built from the body's pose on this frame, carrying its speed (the renderer
    // hands over the real model's skeleton and where it stands; headless, a standard one side-on to the board)
    if (why !== 'water') {
      // model-local -> three.js (a yaw about y) -> game (z mirrored)
      const xf = this.ragXf || { yaw: -this.heading, gx: this.x, gy: this.y + 0.09, gz3: -this.z };
      const c = Math.cos(xf.yaw), sn = Math.sin(xf.yaw);
      // riding with the skate rig: start from the pose on screen (src/rig.js), else the standing skeleton
      const pose = this.ragPose && this.ragPose.length >= 15 ? this.ragPose : null;   // (the rig adds toes and a spine after the 15)
      const place = pose ? (l, i) => pose[i].slice() : l => [xf.gx + l[0] * c + l[2] * sn, xf.gy + l[1], -(xf.gz3 - l[0] * sn + l[2] * c)];
      this.rag = new Ragdoll(this.ragSkel || defaultSkeleton(), place, [this.vx, this.mode === 'air' ? this.vy : Math.min(0, this.vy), this.vz], why);
    } else this.rag = null;
    if (why === 'wall') { b.vx *= -0.35; b.vz *= -0.35; this.vx *= -0.25; this.vz *= -0.25; }
    this.mode = 'bail'; this.bailWhy = why; this.bailT = 0; this.slide = 0;
    this.rail = null; this.bridge = null; this.trick = null; this.boardRoll = 0; this.boardYaw = 0; this.manual = 0; this.grab = null; this.grabPts = 0;
    this.tumble = 0; this.tumbleAxis = Math.atan2(this.vz, this.vx);
    this.lostCombo = this.comboPts; this.combo = []; this.comboPts = 0; this.comboTimer = 0; this.comboSeen.clear();
    this.inWater = why === 'water';
    this.emit('bail', { why, ...o });
  }

  stepBail(dt, inp) {
    this.bailT += dt;
    const w = this.w;
    const rag = this.rag;
    if (rag && !this.inWater) {
      // the ragdoll: falls, tumbles, slides and comes to rest; the stick still steers it (Skate 3)
      const hits = rag.hits.length;
      rag.step(dt, w, inp, this.heading);
      this.thudT = (this.thudT || 0) - dt;
      if (this.thudT <= 0) for (let i = hits; i < rag.hits.length; i++) if (rag.hits[i].dv > 5) { this.emit('bump', { impact: rag.hits[i].dv }); this.thudT = 0.15; break; }
      if (rag.newBreak) { this.emit('broke', { region: rag.newBreak }); rag.newBreak = null; }
      if (rag.splash) { rag.splash = false; this.inWater = true; this.emit('splash'); }
      const p = rag.pelvis, v = rag.vel(2, Math.min(dt, 1 / 15) / Math.max(RD.substeps, Math.ceil(Math.min(dt, 1 / 15) * 120 - 1e-6)));
      this.x = p[0]; this.z = p[2]; this.y = Math.max(w.height(p[0], p[2]), p[1] - 0.5); this.vx = v[0]; this.vz = v[2]; this.vy = v[1];
    } else if (!this.inWater) {
      // body: skids along the floor and tumbles to a stop
      this.vy -= P.gravity * dt;
      this.x += this.vx * dt; this.z += this.vz * dt; this.y += this.vy * dt;
      const g = w.height(this.x, this.z);
      if (this.y <= g) { this.y = g; this.vy = 0; const d = Math.max(0, 1 - dt * 3.2); this.vx *= d; this.vz *= d; }
      this.collideBody();
      if (w.tileKind(this.x, this.z) === 2 && this.y <= g + 0.05) { this.inWater = true; this.emit('splash'); }
    } else {
      this.vx *= 0.9; this.vz *= 0.9;
      this.y = Math.max(this.y - dt * 0.6, w.height(this.x, this.z) - 0.9);
    }
    this.tumble = Math.min(1, this.tumble + dt * 3.5);
    // board: its own little rigid body. Tumbles in the air, bounces off the ground and walls; once it lands
    // wheels-down it rolls on along its length (grips sideways) and runs away downhill
    const b = this.board;
    b.vy -= P.gravity * dt;
    b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt;
    b.roll += b.spinR * dt; b.yaw += b.spinY * dt; b.pitch = (b.pitch || 0) + (b.spinP || 0) * dt;
    const gb = w.height(b.x, b.z);
    if (w.tileKind(b.x, b.z) === 2 && b.y < gb + 0.05) { b.vx *= 0.9; b.vz *= 0.9; b.vy = Math.max(b.vy, -0.5); b.y = Math.max(b.y, gb - 0.02); b.spinR *= 0.9; b.spinP = 0; }
    else if (b.y <= gb) {
      b.y = gb;
      if (b.vy < -2) { b.vy = -b.vy * 0.35; b.spinR *= 0.6; b.spinP = (b.spinP || 0) * -0.4; this.emit('clack'); } else b.vy = 0;
      // settle wheels-down or grip-down, flat to the ground
      const k = Math.round(b.roll / Math.PI) * Math.PI; b.roll += (k - b.roll) * Math.min(1, dt * 8); b.spinR *= 0.85;
      const wc = wheelContact(w, b.x, b.z, b.yaw);
      b.pitch += (wc.pitch * (k % (2 * Math.PI) ? -1 : 1) - b.pitch) * Math.min(1, dt * 10); b.spinP = 0;
      const nx = Math.cos(b.yaw), nz = Math.sin(b.yaw), along = b.vx * nx + b.vz * nz, side = -b.vx * nz + b.vz * nx;
      const wheels = Math.abs(wrap(b.roll)) < 0.5;
      // rolling: little drag along the board, the wheels grip across it; upside down it just scrapes to a stop
      const dA = Math.max(0, 1 - dt * (wheels ? 0.35 : 2.2)), dS = Math.max(0, 1 - dt * (wheels ? 9 : 2.2));
      let a = along * dA, sd = side * dS;
      if (wheels) a -= Math.sin(wc.pitch) * P.gravity * 0.6 * dt;            // downhill
      b.vx = nx * a - nz * sd; b.vz = nz * a + nx * sd;
      b.spinY *= Math.max(0, 1 - dt * 2.2);
    }
    for (const s of w.segsNear(b.x, b.z, 1)) {
      if (s.kind === 'water' || (s.top && b.y > s.top[1])) continue;
      const c = closest(b.x, b.z, s); const d = Math.hypot(b.x - c.x, b.z - c.z);
      if (d < 0.2) {
        let nx = (b.x - c.x) / (d || 1), nz = (b.z - c.z) / (d || 1);
        b.x = c.x + nx * 0.2; b.z = c.z + nz * 0.2;
        const vn = b.vx * nx + b.vz * nz; if (vn < 0) { b.vx -= 1.6 * vn * nx; b.vz -= 1.6 * vn * nz; b.spinY += (Math.random() - 0.5) * 6; this.emit('clack'); }
      }
    }
    if (rag && !this.inWater) {
      // over: lying still. Get up with any key once over (or after manualAfter), on your own a moment after
      // settling, and never later than maxTime
      if ((inp.anyKey && (rag.over || this.bailT > RD.manualAfter)) || rag.settled > RD.settleReset || this.bailT > RD.maxTime) {
        if (rag.meat > 0) this.emit('meat', { score: rag.meat, broken: [...rag.broken], peak: rag.peak });
        this.recover();
      }
    } else if (this.bailT > 2.4 && (inp.anyKey || this.bailT > 3.6)) this.recover();
  }

  collideBody() {
    const R = 0.3;
    for (const s of this.w.segsNear(this.x, this.z, 1)) {
      if (s.kind === 'water') continue;
      if (s.top && this.y > Math.max(...s.top)) continue;
      const c = closest(this.x, this.z, s); const d = Math.hypot(this.x - c.x, this.z - c.z);
      if (d < R) {
        const nx = (this.x - c.x) / (d || 1), nz = (this.z - c.z) / (d || 1);
        this.x = c.x + nx * R; this.z = c.z + nz * R;
        const vn = this.vx * nx + this.vz * nz; if (vn < 0) { this.vx -= 1.4 * vn * nx; this.vz -= 1.4 * vn * nz; }
      }
    }
  }

  recover() {
    // get back on at the stop point, unless that's in the river -> last safe spot
    let x = this.x, z = this.z, h = this.heading;
    if (this.inWater || this.w.tileKind(x, z) !== 0 || this.nearWall(x, z)) { x = this.lastSafe.x; z = this.lastSafe.z; h = this.lastSafe.heading; }
    const score = this.score, stat = this.stat;
    this.reset(x, z, h);
    this.score = score; this.stat = stat; this.rag = null;
    this.emit('recover');
  }

  nearWall(x, z) {
    for (const s of this.w.segsNear(x, z, 1)) if (s.kind !== 'water' && segDist(x, z, s) < P.radius) return true;
    return false;
  }

  /** bank the combo when it times out on the ground */
  tickCombo(dt) {
    if (this.mode === 'ground' && this.combo.length && !this.manual) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        const total = Math.round(this.comboPts * Math.min(this.combo.length, P.multCap));
        this.score += total;
        this.stat.bestCombo = Math.max(this.stat.bestCombo, total);
        this.emit('banked', { total, n: this.combo.length });
        this.combo = []; this.comboPts = 0; this.comboSeen.clear();
      }
    }
  }
}

function ease(u) { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }
function segParam(x, z, s) {
  const L2 = s.dx * s.dx + s.dz * s.dz;
  return Math.max(0, Math.min(1, ((x - s.ax) * s.dx + (z - s.az) * s.dz) / L2));
}
function segsCross(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9;
}
function closest(x, z, s) { const t = segParam(x, z, s); return { x: s.ax + s.dx * t, z: s.az + s.dz * t }; }
function segDist(x, z, s) { const c = closest(x, z, s); return Math.hypot(x - c.x, z - c.z); }
