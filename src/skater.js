// RuneSkate skater physics. Pure JS (no three.js) so it can be unit-tested headless.
// Units: tiles and seconds. x = east, z = north, y = up. heading = board nose angle (atan2(north, east)).
import { railTop } from './world.js';

export const P = {
  radius: 0.28,
  gravity: 21,
  slopeG: 11,            // how hard slopes pull you
  rollFriction: 0.22,
  pushAccel: 3.6,        // speed per push kick (one full leg stroke)
  pushKick: 3.2,         // the first kick from (near) standstill is a big one
  pushEvery: 0.55,       // = rsanim PUSH_UNITS: one kick per stroke of the pushing leg
  pushMax: 8.2,
  maxSpeed: 13,
  brake: 6.5,
  gripLateral: 11,       // how fast sideways skid bleeds away (wheels grip)
  turnSlow: 3.4,         // rad/s when slow
  turnFast: 2.1,         // rad/s at speed
  ollieMin: 5.4,
  ollieMax: 8.1,         // ~0.8 tile pop at full charge
  chargeTime: 0.35,
  airSpin: 6.0,          // rad/s
  spinAssist: 3.2,       // rad/s the board settles toward the nearest 180 when you let go of A/D
  flipTime: 0.42,
  walkSpeed: 1.9,        // tiles/s on foot (RS walk is ~1.67)
  runSpeed: 3.6,
  slamWall: 9.5,         // head-on impact speed (tiles/s) into a wall that bails you
  slamAir: 8.0,
  slamHeadOn: 0.8,       // ...and only when you hit it this square-on (impact / speed)
  hardLanding: 15.5,     // vertical impact that bails you
  landAngle: 0.95,       // clean landing window (rad) between board and travel
  landSketchy: 1.52,     // up to here you ride it out (speed wobble), past it you bail
  grindCatch: 0.85,      // horizontal snap distance to a rail (generous: rails should be easy to land on)
  blockRadius: 0.17,     // trees/rocks/props: a smaller collider than walls, and you glance off them
  grindFriction: 0.55,
  grindMin: 2.2,
  slideDecel: 7.5,
  safeEvery: 0.4,
  manualMin: 1.5,        // tiles/s to hold a manual
  manualPts: 140,        // per second
  grabPts: 260,          // per second held
};

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

const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

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
    this.combo = []; this.comboPts = 0; this.score = this.score || 0;
    this.lastSafe = { x, z, heading }; this.safeT = 0;
    this.board = { x, z, y: this.y, vx: 0, vz: 0, vy: 0, yaw: heading, roll: 0, pitch: 0, spinR: 0, spinY: 0, free: false };
    this.ignoreRail = null; this.ignoreT = 0; this.railExitT = 0;
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
    if (this.mode === 'walk') { this.mode = 'ground'; this.vx = this.vz = 0; this.charge = -1; this.emit('mount'); return true; }
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
    this.y = w.height(this.x, this.z);
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
    this.heading = wrap(this.heading + inp.steer * rate * dt);
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
        const s = inp.fwd ? inp.fwd : (vf < -0.2 ? -1 : 1);
        const kick = Math.abs(vf) < 1.5 ? P.pushKick : P.pushAccel;
        vf += s * kick * (1 - Math.abs(vf) / (P.pushMax + 2.5));
        this.pushT = P.pushEvery; this.pushing = P.pushEvery + 0.08; this.emit('push');
      }
      if (inp.brake && !this.manual) vf -= Math.sign(vf) * Math.min(Math.abs(vf), P.brake * dt);
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), P.rollFriction * dt);
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
    this.vx -= gx * P.slopeG * dt; this.vz -= gz * P.slopeG * dt;
    this.clampSpeed();

    // ollie charge / pop (keyboard), or a flick-it gesture that pops immediately
    if (inp.flickPop) { this.pop(P.ollieMin + (P.ollieMax - P.ollieMin) * inp.flickPop, 'ollie'); return; }
    if (inp.jump && this.charge < 0) this.charge = 0;
    if (this.charge >= 0) {
      this.charge = Math.min(1, this.charge + dt / P.chargeTime);
      if (!inp.jump) { this.pop(P.ollieMin + (P.ollieMax - P.ollieMin) * this.charge, 'ollie'); return; }
    }

    const px = this.x, pz = this.z;
    this.x += this.vx * dt; this.z += this.vz * dt;
    if (this.collide(dt, false)) return;
    const h1 = w.height(this.x, this.z);
    const drop = this.y - h1;
    if (drop > Math.max(0.18, this.speed * dt * 1.4) && this.speed > 1) {
      // rolled off a ledge
      this.mode = 'air'; this.vy = 0; this.airTime = 0; this.spin = 0; this.airTricks = []; this.body = this.heading;
      this.emit('air');
      return;
    }
    this.y = h1;
    this.body = this.slide ? this.heading + this.slideSign * Math.PI / 2 * Math.min(1, this.slide) : this.heading;
    if (this.slide) this.slide = Math.min(1, this.slide + dt * 6);

    const under = w.tileKind(this.x, this.z);
    if (under === 2 || under === 3) { this.bail(under === 2 ? 'water' : 'rocks'); return; }
    this.safeT += dt;
    if (this.safeT > P.safeEvery && this.speed < 9) { this.safeT = 0; this.lastSafe = { x: this.x, z: this.z, heading: this.heading }; }
    void px; void pz; void h0;
  }

  pop(vy, kind) {
    if (this.manual) this.endManual(false);
    this.mode = 'air'; this.vy = vy; this.charge = -1; this.airTime = 0; this.spin = 0;
    this.body = this.heading; this.trick = null; this.airTricks = [];
    this.slide = 0;
    this.airTricks.push(kind === 'ollie' ? 'Ollie' : kind);
    this.emit('pop', { vy });
  }

  endManual(lost) {
    const t = this.manT, nose = this.manual < 0;
    this.manual = 0; this.manBal = 0;
    if (t > 0.3) this.addCombo(nose ? 'Nose Manual' : 'Manual', Math.round(t * P.manualPts));
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
    const sr = inp.steer * P.airSpin * dt;
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
    if (this.collide(dt, true)) return;

    const g = this.w.height(this.x, this.z);
    if (this.y <= g) {
      this.y = g;
      const kind = this.w.tileKind(this.x, this.z);
      if (kind === 2 || kind === 3) { this.bail(kind === 2 ? 'water' : 'rocks'); return; }    // 3 = a rocky outcrop
      this.land(-this.vy);
    }
  }

  releaseGrab() {
    if (!this.grab) return;
    if (this.grabT > 0.12) this.airTricks.push(`${this.grab} Grab`), (this.grabPts = (this.grabPts || 0) + this.grabT * P.grabPts);
    this.grab = null;
  }

  land(impact) {
    const spd = this.speed;
    if (this.grab) { const late = this.grabT; this.releaseGrab(); if (late > 0.25 && impact > 6) return this.bail('sketchy'); }
    if (this.trick && this.trickT < 0.82) return this.bail('flip');
    if (this.trick) { const T = TRICKS[this.trick]; this.airTricks.push(T.name); if (T.yaw % 2) this.heading = wrap(this.heading + Math.PI); this.trick = null; }
    this.boardRoll = 0; this.boardYaw = 0;
    const fromRail = this.railExitT > 0;
    if (impact > P.hardLanding * (fromRail ? 2 : 1)) return this.bail('slam');
    if (spd > 1.2) {
      const dir = Math.atan2(this.vz, this.vx);
      const a = Math.abs(wrap(this.heading - dir)), b = Math.abs(wrap(this.heading + Math.PI - dir));
      const mis = Math.min(a, b);
      if (mis > P.landSketchy && !fromRail) return this.bail('sketchy');
      if (mis > P.landAngle && !fromRail) {         // rode it out: scrub speed, no bail
        const k = 1 - 0.45 * (mis - P.landAngle) / (P.landSketchy - P.landAngle);
        this.vx *= k; this.vz *= k; this.emit('wobble');
      }
      // snap the board to the travel line (regular or fakie)
      this.heading = a < b ? dir : wrap(dir + Math.PI);
    }
    this.body = this.heading;
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
    const rdir = Math.atan2(r.dirz, r.dirx);
    const rel = Math.abs(wrap(this.heading - rdir));
    const relA = Math.min(rel, Math.PI - rel);           // 0 = board along rail, pi/2 = across
    this.releaseGrab();
    if (this.trick && this.trickT < 0.7) { this.bail('flip'); return true; }
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
    this.y = top; this.vy = 0;
    this.x = r.horiz ? r.ax + this.railT : r.ax; this.z = r.horiz ? r.az : r.az + this.railT;
    this.emit('grind', { kind: this.grindKind });
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
    this.comboPts += Math.round(dt * 160); this.grindPts = (this.grindPts || 0) + dt * 160;
    // hit something standing on the rail line (end posts, perpendicular walls)?
    for (const s of this.w.segsNear(this.x, this.z, 0.6)) {
      if (s.kind === 'rail' || s.kind === 'water' || s.kind === 'edge') continue;
      if (s.top && this.y > Math.max(...s.top) - 0.05) continue;   // low stuff under the rail can't stop you
      if ((s.dx === 0) !== r.horiz) continue;                 // only walls crossing the rail line
      const across = r.horiz ? [Math.min(s.az, s.bz), Math.max(s.az, s.bz), r.az, s.ax, this.x]
                             : [Math.min(s.ax, s.bx), Math.max(s.ax, s.bx), r.ax, s.az, this.z];
      if (across[0] < across[2] - 0.05 && across[1] > across[2] + 0.05 && Math.abs(across[4] - across[3]) < 0.1) { this.bail('slam'); return; }
    }
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
    this.rail = null;
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
      if (!hit) return false;
      let nx = this.x - hit.c.x, nz = this.z - hit.c.z;
      const L = Math.hypot(nx, nz);
      if (L < 1e-6) { nx = -hit.s.dz / hit.s.len; nz = hit.s.dx / hit.s.len; } else { nx /= L; nz /= L; }
      this.x = hit.c.x + nx * hit.r; this.z = hit.c.z + nz * hit.r;
      const vn = this.vx * nx + this.vz * nz;
      if (vn < 0 && hit.s.kind === 'block') {
        // trees, rocks, props: glance off and keep your speed, redirected along the obstacle. Never a dead stop.
        const sp = this.speed, headOn = -vn / Math.max(sp, 1e-6);
        let tx = -nz, tz = nx;
        const vt = this.vx * tx + this.vz * tz;
        if (Math.abs(vt) < 0.35 * sp) {
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
    if (s.kind === 'water') return !air;          // you can fly over the bank... and into the river
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
    if (!this.unstickTo) {
      // in the air you may be flying over a hedge/cactus tile: only a real wedge counts there
      const inBlocked = this.mode !== 'air' && w.tileKind(this.x, this.z) === 1;
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
    return false;
  }

  /** nearest open point clear of every solid segment, searched outward ring by ring */
  freeSpot(x, z) {
    const w = this.w; let best = null, bd = 1e9;
    const clear = (px, pz) => {
      if (w.tileKind(px, pz) !== 0) return false;
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
    b.spinR = (Math.random() - 0.5) * 22; b.spinY = (Math.random() - 0.5) * 12;
    if (why === 'wall') { b.vx *= -0.35; b.vz *= -0.35; this.vx *= -0.25; this.vz *= -0.25; }
    this.mode = 'bail'; this.bailWhy = why; this.bailT = 0; this.slide = 0;
    this.rail = null; this.trick = null; this.boardRoll = 0; this.boardYaw = 0; this.manual = 0; this.grab = null; this.grabPts = 0;
    this.tumble = 0; this.tumbleAxis = Math.atan2(this.vz, this.vx);
    this.lostCombo = this.comboPts; this.combo = []; this.comboPts = 0; this.comboTimer = 0;
    this.inWater = why === 'water';
    this.emit('bail', { why, ...o });
  }

  stepBail(dt, inp) {
    this.bailT += dt;
    const w = this.w;
    // body: skids along the floor and tumbles to a stop
    if (!this.inWater) {
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
    // board: its own little rigid body, bounces off the ground and walls
    const b = this.board;
    b.vy -= P.gravity * dt;
    b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt;
    b.roll += b.spinR * dt; b.yaw += b.spinY * dt;
    const gb = w.height(b.x, b.z);
    if (w.tileKind(b.x, b.z) === 2 && b.y < gb + 0.05) { b.vx *= 0.9; b.vz *= 0.9; b.vy = Math.max(b.vy, -0.5); b.y = Math.max(b.y, gb - 0.02); b.spinR *= 0.9; }
    else if (b.y <= gb) {
      b.y = gb;
      if (b.vy < -2) { b.vy = -b.vy * 0.35; b.spinR *= 0.6; this.emit('clack'); } else b.vy = 0;
      const d = Math.max(0, 1 - dt * 2.2); b.vx *= d; b.vz *= d; b.spinY *= d;
      // settle wheels-down or grip-down
      const k = Math.round(b.roll / Math.PI) * Math.PI; b.roll += (k - b.roll) * Math.min(1, dt * 8); b.spinR *= 0.85;
    }
    for (const s of w.segsNear(b.x, b.z, 1)) {
      if (s.kind === 'water' || (s.top && b.y > s.top[1])) continue;
      const c = closest(b.x, b.z, s); const d = Math.hypot(b.x - c.x, b.z - c.z);
      if (d < 0.2) {
        let nx = (b.x - c.x) / (d || 1), nz = (b.z - c.z) / (d || 1);
        b.x = c.x + nx * 0.2; b.z = c.z + nz * 0.2;
        const vn = b.vx * nx + b.vz * nz; if (vn < 0) { b.vx -= 1.6 * vn * nx; b.vz -= 1.6 * vn * nz; this.emit('clack'); }
      }
    }
    if (this.bailT > 2.4 && (inp.anyKey || this.bailT > 3.6)) this.recover();
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
    this.score = score; this.stat = stat;
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
        const total = this.comboPts * this.combo.length;
        this.score += total;
        this.stat.bestCombo = Math.max(this.stat.bestCombo, total);
        this.emit('banked', { total, n: this.combo.length });
        this.combo = []; this.comboPts = 0;
      }
    }
  }
}

function ease(u) { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }
function segParam(x, z, s) {
  const L2 = s.dx * s.dx + s.dz * s.dz;
  return Math.max(0, Math.min(1, ((x - s.ax) * s.dx + (z - s.az) * s.dz) / L2));
}
function closest(x, z, s) { const t = segParam(x, z, s); return { x: s.ax + s.dx * t, z: s.az + s.dz * t }; }
function segDist(x, z, s) { const c = closest(x, z, s); return Math.hypot(x - c.x, z - c.z); }
