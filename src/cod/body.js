// A soldier's body in the arena: a capsule pushed out of the real castle mesh (src/cod/arena.js's BVH), feet
// snapped to whatever floor is under them (ground, wall walk, castle tier, stairs). Players and bots both move
// with this, so a bot can go anywhere you can. Movement is Call of Duty's shape: quick to full speed, sprint
// (no shooting until the sprint-out), tactical crouch, a slide out of a sprint, a jump that clears a crate.
import * as THREE from 'three';

export const MOVE = {
  walk: 6.0, sprint: 9.2, crouch: 0.5, ads: 0.55, accel: 70, airAccel: 14, friction: 12,
  wade: 0.5, wadeSink: 0.45,
  jump: 6.6, gravity: 20, step: 0.78, radius: 0.32, height: 1.62, crouchHeight: 1.1,
  eye: 1.5, crouchEye: 0.98, slideEye: 0.78, slideSpeed: 12, slideTime: 0.75, slideFriction: 2.8,
};

const _box = new THREE.Box3(), _seg = new THREE.Line3(), _tp = new THREE.Vector3(), _cp = new THREE.Vector3(), _v = new THREE.Vector3(), _d = new THREE.Vector3();

export class Body {
  constructor(pos) {
    this.pos = pos.clone();                                // feet
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;                          // yaw 0 looks down -z (north); + turns left
    this.onGround = true; this.crouch = 0; this.slide = 0; this.sprinting = false; this.airT = 0;
    this.eyeY = MOVE.eye; this.landed = 0; this.stepT = 0;
  }

  get height() { return MOVE.height + (MOVE.crouchHeight - MOVE.height) * this.crouch; }
  eye(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.eyeY, this.pos.z); }
  /** unit vector the body looks along */
  look(out = new THREE.Vector3()) { const c = Math.cos(this.pitch); return out.set(-Math.sin(this.yaw) * c, Math.sin(this.pitch), -Math.cos(this.yaw) * c); }

  /**
   * inp: { x, z (strafe right, forward: -1..1), sprint, crouch (held), jump (edge), ads (0..1) }; scale: the
   * gun's mobility. Returns events: 'jump', 'land', 'slide', 'step'.
   */
  update(dt, inp, arena, scale = 1) {
    const ev = [];
    let ix = inp.x || 0, iz = inp.z || 0; const il = Math.hypot(ix, iz); if (il > 1) { ix /= il; iz /= il; }
    // sprint: forward only, not aiming, not crouched
    this.wading = this.onGround && arena.inWater(this.pos.x, this.pos.y, this.pos.z);
    const wantSprint = inp.sprint && iz > 0.5 && !inp.ads && this.slide <= 0 && !this.wading;
    if (wantSprint && this.onGround) this.sprinting = true;
    if (!wantSprint || iz < 0.3) this.sprinting = false;
    // slide: crouch out of a sprint
    if (inp.crouchEdge && this.sprinting && this.onGround && this.slide <= 0 && !this.wading) {
      this.slide = MOVE.slideTime; this.sprinting = false; ev.push('slide');
      const sp = Math.max(MOVE.slideSpeed * scale, Math.hypot(this.vel.x, this.vel.z) * 1.15);
      this.vel.x = -Math.sin(this.yaw) * sp; this.vel.z = -Math.cos(this.yaw) * sp;
    }
    const crouching = (inp.crouch || this.slide > 0) && true;
    this.crouch += ((crouching ? 1 : 0) - this.crouch) * Math.min(1, dt * 12);
    if (this.blockedAbove(arena)) this.crouch = Math.max(this.crouch, 0.99);   // can't stand up under a ledge (and can't walk in standing)
    // target velocity on the ground plane
    const sp = (this.sprinting ? MOVE.sprint : MOVE.walk) * scale * (this.wading ? MOVE.wade : 1) * (1 - (1 - MOVE.ads) * (inp.ads || 0)) * (1 - (1 - MOVE.crouch) * this.crouch * (this.slide > 0 ? 0 : 1));
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const wx = (ix * c - iz * s) * sp, wz = (-ix * s - iz * c) * sp;
    if (this.slide > 0) {
      this.slide -= dt;
      const k = Math.max(0, 1 - MOVE.slideFriction * dt / Math.max(0.2, this.slide + 0.2));
      this.vel.x *= k; this.vel.z *= k;
      this.vel.x += wx * dt * 1.5; this.vel.z += wz * dt * 1.5;          // a little steer
    } else {
      const a = this.onGround ? MOVE.accel : MOVE.airAccel;
      const dx = wx - this.vel.x, dz = wz - this.vel.z, dl = Math.hypot(dx, dz), m = Math.min(dl, a * dt);
      if (dl > 1e-6) { this.vel.x += dx / dl * m; this.vel.z += dz / dl * m; }
    }
    if (inp.jump && this.onGround && this.slide <= 0.3) { this.vel.y = MOVE.jump; this.onGround = false; this.slide = 0; ev.push('jump'); }

    // horizontal move in steps (a fast slide never tunnels through a wall), pushed out of the mesh
    const ox = this.pos.x, oz = this.pos.z;
    const L = Math.hypot(this.vel.x, this.vel.z) * dt, n = Math.max(1, Math.ceil(L / 0.25));
    for (let i = 0; i < n; i++) {
      const px = this.pos.x, pz = this.pos.z, py = this.pos.y, mx = this.vel.x * dt / n, mz = this.vel.z * dt / n, want = Math.hypot(mx, mz);
      this.pos.x += mx; this.pos.z += mz;
      this.pushOut(arena);
      if (!arena.standable(this.pos.x, this.pos.y, this.pos.z)) { this.pos.x = px; this.pos.z = pz; }
      // step-up: blocked on the ground (a stair's top landing, a kerb, a stone)? try the move a step higher and
      // settle onto whatever floor is there; keep it if it got further
      const got = ((this.pos.x - px) * mx + (this.pos.z - pz) * mz) / (want || 1);
      if (this.onGround && want > 1e-4 && got < want * 0.6) {
        const sx = this.pos.x, sz = this.pos.z;
        this.pos.set(px + mx, py + MOVE.step, pz + mz);
        this.pushOut(arena);
        const fy = this.floorAt(arena, this.pos.x, py + MOVE.step * 0.98, this.pos.z), got2 = ((this.pos.x - px) * mx + (this.pos.z - pz) * mz) / want;
        // ...and only over open ground: a clear line just over the new floor and at chest height (the raised
        // capsule is short, and could otherwise slip through a window or under a lintel into the next room)
        if (fy > py + 0.02 && fy <= py + MOVE.step + 0.02 && got2 > got + want * 0.2 && arena.standable(this.pos.x, fy, this.pos.z) && this.clear(arena, px, pz, this.pos.x, this.pos.z, fy) && this.room(arena, this.pos.x, fy, this.pos.z) > MOVE.crouchHeight + 0.05) this.pos.y = fy;
        else this.pos.set(sx, py, sz);
      }
    }
    // what we actually moved is our speed (walls eat it)
    if (dt > 0 && this.onGround) { this.vel.x = (this.pos.x - ox) / dt; this.vel.z = (this.pos.z - oz) / dt; }

    // vertical: snap to the floor under us (stairs, steps, slopes) or fall
    let fy = this.floorAt(arena, this.pos.x, this.pos.y, this.pos.z);
    // a step up into a gap you don't fit in (a ledge under the storey above: standing on it put your head, and
    // the camera, through the next floor) is a wall
    if (this.onGround && fy > this.pos.y + 0.05 && this.room(arena, this.pos.x, fy, this.pos.z) < MOVE.crouchHeight + 0.05) {
      this.pos.x = ox; this.pos.z = oz; this.vel.x = this.vel.z = 0; fy = this.floorAt(arena, ox, this.pos.y, oz);
    }
    if (this.onGround) {
      if (fy > this.pos.y - MOVE.step) { if (fy > this.pos.y + 0.05) ev.push('step'); this.pos.y = fy; this.vel.y = 0; }
      else { this.onGround = false; this.vel.y = 0; }
    }
    if (!this.onGround) {
      this.airT += dt;
      this.vel.y -= MOVE.gravity * dt;
      const ny = this.pos.y + this.vel.y * dt;
      if (this.vel.y > 0) {                                  // head on a ceiling
        const h = arena.ray(_v.set(this.pos.x, this.pos.y + this.height, this.pos.z), UP, this.vel.y * dt + 0.05);
        if (h) this.vel.y = 0; else this.pos.y = ny;
      } else if (ny <= fy) {
        this.landed = Math.min(1, -this.vel.y / 14); this.pos.y = fy; this.vel.y = 0; this.onGround = true; this.airT = 0; ev.push('land');
      } else this.pos.y = ny;
    }
    if (this.pos.y < -20) this.pos.y = 5;                   // (never fall out of the world)
    // the eye follows the stance (and eases stairs instead of popping up them)
    const want = (this.slide > 0 ? MOVE.slideEye : MOVE.eye + (MOVE.crouchEye - MOVE.eye) * this.crouch) - (this.wading ? MOVE.wadeSink : 0);   // waist deep in the river
    this.eyeY += (want - this.eyeY) * Math.min(1, dt * 14);
    this.stepT += Math.hypot(this.vel.x, this.vel.z) * dt * (this.onGround ? 1 : 0);
    return ev;
  }

  /** the highest floor under the body's footprint (centre and four points round it) from a step above its feet */
  floorAt(arena, x, y, z) {
    const mid = arena.floor(x, y, z, MOVE.step, 60), r = MOVE.radius * 0.6;
    let best = mid;
    for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
      const f = arena.floor(x + dx, y, z + dz, MOVE.step, 60);
      // a foot's floor higher than the middle's counts only if nothing stands between (else it's the stair or
      // the next room's floor on the far side of a thin wall: taking it pulled bodies up and through)
      if (f > best && (f <= mid + 0.02 || !arena.ray(_v.set(x, f + 0.06, z), _d.set(dx / r, 0, dz / r), r + 0.02))) best = f;
    }
    return best;
  }
  /** nothing solid on the straight line between two spots, just over a floor at y and at chest height */
  clear(arena, x0, z0, x1, z1, y) {
    const L = Math.hypot(x1 - x0, z1 - z0); if (L < 1e-4) return true;
    _d.set((x1 - x0) / L, 0, (z1 - z0) / L);
    for (const h of [0.12, 1.1]) if (arena.ray(_v.set(x0, y + h, z0), _d, L + MOVE.radius * 0.5)) return false;
    return true;
  }

  blockedAbove(arena) { return this.room(arena, this.pos.x, this.pos.y, this.pos.z) < MOVE.height + 0.05; }
  /** headroom over a floor at (x, y, z) */
  room(arena, x, y, z) { const h = arena.ray(_v.set(x, y + 0.05, z), UP, 3); return h ? h.distance + 0.05 : 9; }

  /** push the capsule (from a step above the feet to the head) sideways out of every triangle it overlaps */
  pushOut(arena) {
    const r = MOVE.radius, y0 = this.pos.y + MOVE.step + r * 0.5, y1 = this.pos.y + Math.max(y0 - this.pos.y + 0.01, this.height - r);
    for (let it = 0; it < 3; it++) {
      _seg.start.set(this.pos.x, y0, this.pos.z); _seg.end.set(this.pos.x, y1, this.pos.z);
      _box.makeEmpty(); _box.expandByPoint(_seg.start); _box.expandByPoint(_seg.end); _box.min.addScalar(-r); _box.max.addScalar(r);
      let moved = false;
      arena.bvh.shapecast({
        intersectsBounds: b => b.intersectsBox(_box),
        intersectsTriangle: tri => {
          const d = tri.closestPointToSegment(_seg, _tp, _cp);
          if (d >= r) return false;
          let dx = _cp.x - _tp.x, dz = _cp.z - _tp.z, hl = Math.hypot(dx, dz);
          if (hl < 1e-4) {                                     // dead centre on a face: out along its normal
            tri.getNormal(_v); dx = _v.x; dz = _v.z; hl = Math.hypot(dx, dz); if (hl < 0.2) return false;
          }
          const push = r - d + 0.001;
          this.pos.x += dx / hl * push; this.pos.z += dz / hl * push;
          _seg.start.x = _seg.end.x = this.pos.x; _seg.start.z = _seg.end.z = this.pos.z;
          moved = true; return false;
        },
      });
      if (!moved) break;
    }
  }
}
const UP = new THREE.Vector3(0, 1, 0);
