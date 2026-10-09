// The bail ragdoll: the rider goes limp and the body falls, tumbles, slides and comes to rest, the way Skate 3's
// wipeouts do. Pure JS (no three.js) so test/sim.js runs it headless. Clean-room from the structure of
// SK8-ENGINE/skate-3-rust-engine's wipeout code (the retail tuning is EA data that isn't in that repo):
//  - the rider's speed carries into every body part on the frame of the bail, clamped to 20
//  - a hard landing strips the speed into the ground from the legs, the upper body keeps 10% of it
//  - ground contact: friction 0.9, no bounce; one frame can't add more than 5 to vertical speed
//  - the stick still steers the body: in the air it spins it toward 8.4 rad/s ((target - w) * 2.4 * dt, max
//    0.5 a frame), on the ground it shoves it
//  - the body is "over" once the pelvis and neck both drop below a speed; drag ramps up the longer it lies
//    there (0.05 + 0.15 * settled, max 0.5), then the screen fades and you're back on the board
// The body is a verlet particle skeleton: rigid torso, hinge elbows and knees that only bend the right way.
// Units are tiles (about a metre) and seconds; y is up; x/z are the game's ground axes.

// particles
export const J = { head: 0, neck: 1, pelvis: 2, lSh: 3, lEl: 4, lHa: 5, rSh: 6, rEl: 7, rHa: 8, lHip: 9, lKn: 10, lFt: 11, rHip: 12, rKn: 13, rFt: 14 };
const MASS = [5, 9, 9, 3, 2, 1, 3, 2, 1, 3, 4, 2, 3, 4, 2];
const RAD = [0.14, 0.12, 0.13, 0.09, 0.07, 0.06, 0.09, 0.07, 0.06, 0.1, 0.08, 0.07, 0.1, 0.08, 0.07];
const LOWER = new Set([J.lHip, J.lKn, J.lFt, J.rHip, J.rKn, J.rFt, J.pelvis]);
// rigid links: bones plus the cross-braces that keep the torso a box
const LINKS = [
  ['head', 'neck'], ['head', 'lSh'], ['head', 'rSh'],
  ['neck', 'lSh'], ['neck', 'rSh'], ['lSh', 'rSh'], ['neck', 'pelvis'],
  ['lSh', 'pelvis'], ['rSh', 'pelvis'], ['pelvis', 'lHip'], ['pelvis', 'rHip'], ['lHip', 'rHip'],
  ['lSh', 'lHip'], ['rSh', 'rHip'], ['lSh', 'rHip'], ['rSh', 'lHip'], ['neck', 'lHip'], ['neck', 'rHip'],
  ['lSh', 'lEl'], ['lEl', 'lHa'], ['rSh', 'rEl'], ['rEl', 'rHa'],
  ['lHip', 'lKn'], ['lKn', 'lFt'], ['rHip', 'rKn'], ['rKn', 'rFt'],
].map(([a, b]) => [J[a], J[b]]);
// joint limits as minimum spans: an elbow/knee can't fold flat, a limb can't swing through the body
// (a fraction of the standing distance; negative = an absolute gap in tiles). Elbows and knees fold to ~150°,
// arms can't go through the chest, knees come up to the chest but not into it, limbs don't pass through each other
const MINS = [['lSh', 'lHa', 0.3], ['rSh', 'rHa', 0.3], ['lHip', 'lFt', 0.3], ['rHip', 'rFt', 0.3],
  ['lHa', 'rHa', -0.12], ['lFt', 'rFt', -0.1], ['lKn', 'rKn', -0.12],
  ['lEl', 'pelvis', 0.7], ['rEl', 'pelvis', 0.7], ['lKn', 'neck', 0.45], ['rKn', 'neck', 0.45]].map(([a, b, f]) => [J[a], J[b], f]);
// rigid parts the mesh is skinned to: [origin, axis end, side reference]
export const PARTS = {
  head: [J.neck, J.head, J.rSh], torso: [J.pelvis, J.neck, J.rSh],
  lUpper: [J.lSh, J.lEl, J.pelvis], lFore: [J.lEl, J.lHa, J.neck], rUpper: [J.rSh, J.rEl, J.pelvis], rFore: [J.rEl, J.rHa, J.neck],
  lThigh: [J.lHip, J.lKn, J.rHip], lShin: [J.lKn, J.lFt, J.rHip], rThigh: [J.rHip, J.rKn, J.lHip], rShin: [J.rKn, J.rFt, J.lHip],
};
// Hall of Meat regions
const REGION = ['HEAD', 'NECK', 'BACK', 'LEFT SHOULDER', 'LEFT ARM', 'LEFT WRIST', 'RIGHT SHOULDER', 'RIGHT ARM', 'RIGHT WRIST',
  'LEFT HIP', 'LEFT LEG', 'LEFT ANKLE', 'RIGHT HIP', 'RIGHT LEG', 'RIGHT ANKLE'];
const REGION_W = [3, 2, 1.5, 1, 1, 1, 1, 1, 1, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2];

export const RD = {
  substeps: 2, iters: 10, maxV: 20, airKeep: 0.995, friction: 0.9, maxDvy: 5,
  spinTarget: 8.4, spinGain: 2.4, spinMax: 0.5, groundShove: 1.5,
  overSpeed: 0.4, overFor: 0.5, overMin: 1.0, manualAfter: 1.6, settleReset: 1.0, maxTime: 6,
  breakDv: 11, hurtDv: 4,
};

/** a standing skeleton (model-local: y up from the feet, x across the shoulders, z forward), H tall */
export function defaultSkeleton(H = 1.55) {
  const s = (x, y, z = 0) => [x * H, y * H, z * H];
  return [s(0, 0.93), s(0, 0.83), s(0, 0.52), s(-0.13, 0.8), s(-0.15, 0.63), s(-0.15, 0.47), s(0.13, 0.8), s(0.15, 0.63), s(0.15, 0.47),
    s(-0.07, 0.5), s(-0.07, 0.27), s(-0.07, 0.04), s(0.07, 0.5), s(0.07, 0.27), s(0.07, 0.04)];
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export class Ragdoll {
  /**
   * skel: 15 joint positions, model-local. place(p) maps model-local -> game [x, y, z].
   * v: the rider's velocity [vx, vy, vz]; why: the bail reason (shapes how the body is thrown).
   */
  constructor(skel, place, v, why, rnd = Math.random) {
    this.n = skel.length;
    this.p = skel.map(place);
    this.rest = LINKS.map(([a, b]) => len(sub(skel[a], skel[b])));
    this.mins = MINS.map(([a, b, f]) => [a, b, f < 0 ? -f : f * len(sub(skel[a], skel[b]))]);
    // how fast each part is going on the frame of the bail
    let [vx, vy, vz] = v; const sp = Math.hypot(vx, vy, vz);
    if (sp > RD.maxV) { vx *= RD.maxV / sp; vy *= RD.maxV / sp; vz *= RD.maxV / sp; }
    const fwd = norm([vx, 0, vz]), hs = Math.hypot(vx, vz);
    const vel = this.p.map((_, i) => {
      let w = [vx, vy, vz];
      if (why === 'slam' && vy < 0) w = [vx, LOWER.has(i) ? 0 : vy * 0.1, vz];          // hard landing: the legs stop dead
      else if (why === 'wall' || why === 'monster') {                                    // caught at the shins: the top keeps going
        const k = LOWER.has(i) ? -0.15 : i === J.head || i === J.neck ? 1.05 : 0.85;
        w = [vx * k, vy + (LOWER.has(i) ? 0 : 1.2), vz * k];
      } else if (why === 'flip' || why === 'sketchy' || why === 'rocks') {               // the board shoots out from under you
        const k = LOWER.has(i) ? 0.55 : 1;
        w = [vx * k, vy, vz * k];
        if (i === J.lFt || i === J.rFt || i === J.lKn || i === J.rKn) w = [w[0] + fwd[0] * Math.min(3, hs * 0.3), w[1] + 0.8, w[2] + fwd[2] * Math.min(3, hs * 0.3)];
      }
      return [w[0] + (rnd() - 0.5) * 1.2, w[1] + (rnd() - 0.5) * 0.6, w[2] + (rnd() - 0.5) * 1.2];
    });
    this.dt0 = 1 / 120;
    this.q = this.p.map((p, i) => [p[0] - vel[i][0] * this.dt0, p[1] - vel[i][1] * this.dt0, p[2] - vel[i][2] * this.dt0]);
    this.t = 0; this.overT = 0; this.settled = 0; this.over = false; this.inWater = false;
    this.ground = new Uint8Array(this.n);
    this.lastVy = vel.map(v => v[1]);
    this.vi = vel.map(v => v.slice());
    this.hits = []; this.damage = 0; this.broken = new Set(); this.peak = 0;
  }

  get pelvis() { return this.p[J.pelvis]; }
  vel(i, dt) { const p = this.p[i], q = this.q[i]; return [(p[0] - q[0]) / dt, (p[1] - q[1]) / dt, (p[2] - q[2]) / dt]; }

  /** inp: { steer, fwd } (the stick) and yaw (which way "forward" is for it) */
  step(dt, w, inp = {}, yaw = 0) {
    this.t += dt;
    // fixed-size substeps (about 1/120 s) so a slow frame rate tumbles the same as a fast one
    const ft = Math.min(dt, 1 / 15), n = Math.max(RD.substeps, Math.ceil(ft * 120 - 1e-6)), h = ft / n;
    const p0 = this.p[J.pelvis].slice(), n0 = this.p[J.neck].slice();
    for (let s = 0; s < n; s++) this.substep(h, w, inp, yaw);
    // over: pelvis and neck both slow for a moment (after a minimum time). Measured over the whole frame, so
    // the resting contact's per-substep settle doesn't read as motion
    const fdt = h * n, vp = len(sub(this.p[J.pelvis], p0)) / fdt, vn = len(sub(this.p[J.neck], n0)) / fdt;
    this.peak = Math.max(this.peak, vp);
    if (vp < RD.overSpeed && vn < RD.overSpeed && this.t > RD.overMin) this.overT += dt; else this.overT = 0;
    this.over = this.overT > RD.overFor;
    this.settled = this.over ? this.settled + dt : 0;
  }

  substep(h, w, inp, yaw) {
    const N = this.n, P = this.p, Q = this.q, g = 21;
    const air = !this.ground.some(Boolean);
    // the stick: spin the body in the air (about its centre of mass), shove it on the ground
    const st = Math.abs(inp.steer || 0) > 0.2 ? inp.steer : 0, fw = Math.abs(inp.fwd || 0) > 0.2 ? inp.fwd : 0;
    let cx = 0, cy = 0, cz = 0, M = 0;
    for (let i = 0; i < N; i++) { cx += P[i][0] * MASS[i]; cy += P[i][1] * MASS[i]; cz += P[i][2] * MASS[i]; M += MASS[i]; }
    cx /= M; cy /= M; cz /= M;
    if ((st || fw) && !this.over && this.t < 3) {
      const fx = Math.cos(yaw), fz = Math.sin(yaw);
      if (air) {
        // spin about the vertical (steer) and about the sideways axis (forward/back = front/back flip)
        const want = [-fz * fw * RD.spinTarget, st * RD.spinTarget, fx * fw * RD.spinTarget];
        const om = this.omega([cx, cy, cz], h);
        const d = [0, 1, 2].map(k => Math.max(-RD.spinMax, Math.min(RD.spinMax, (want[k] - om[k]) * RD.spinGain * h)));
        for (let i = 0; i < N; i++) {
          const r = [P[i][0] - cx, P[i][1] - cy, P[i][2] - cz], t = cross(d, r);
          Q[i][0] -= t[0] * h; Q[i][1] -= t[1] * h; Q[i][2] -= t[2] * h;
        }
      } else {
        const ax = (fx * fw - fz * st) * RD.groundShove, az = (fz * fw + fx * st) * RD.groundShove;
        for (let i = 0; i < N; i++) { Q[i][0] -= ax * h * h; Q[i][2] -= az * h * h; }
      }
    }
    // integrate
    const drag = this.over ? Math.min(0.5, 0.05 + 0.15 * this.settled) : 0;
    const keep = Math.pow(RD.airKeep, h * 60) * (1 - drag * h);
    for (let i = 0; i < N; i++) {
      const p = P[i], q = Q[i];
      let vx = (p[0] - q[0]) * keep, vy = (p[1] - q[1]) * keep, vz = (p[2] - q[2]) * keep;
      if (this.inWater) { vx *= 0.92; vz *= 0.92; vy = vy * 0.85 + 0.6 * h; }
      // one step can't kick a part upward by more than maxDvy (a squeeze between constraints and the ground)
      const lv = this.lastVy[i]; if (vy / h > lv + RD.maxDvy) vy = (lv + RD.maxDvy) * h;
      this.lastVy[i] = vy / h;
      this.vi[i] = [vx / h, vy / h, vz / h];           // this step's real speed (damage is judged on it, not on constraint fixes)
      q[0] = p[0]; q[1] = p[1]; q[2] = p[2];
      p[0] += vx; p[1] += vy - (this.inWater ? 0 : g * h * h); p[2] += vz;
    }
    // constraints
    for (let it = 0; it < RD.iters; it++) {
      for (let k = 0; k < LINKS.length; k++) this.link(LINKS[k][0], LINKS[k][1], this.rest[k], 0);
      for (const [a, b, m] of this.mins) this.link(a, b, m, 1);
      this.hinges();
    }
    // world: ground, walls, water
    for (let i = 0; i < N; i++) this.collide(i, h, w);
  }

  /** angular velocity of the body about c (least-squares, cheap) */
  omega(c, h) {
    let L = [0, 0, 0], I = 0;
    for (let i = 0; i < this.n; i++) {
      const r = sub(this.p[i], c), v = this.vel(i, h), m = MASS[i];
      const lc = cross(r, v); L = [L[0] + lc[0] * m, L[1] + lc[1] * m, L[2] + lc[2] * m]; I += m * dot(r, r);
    }
    return I ? [L[0] / I, L[1] / I, L[2] / I] : [0, 0, 0];
  }

  /** keep a and b exactly d apart (mode 0), or at least d apart (mode 1) */
  link(a, b, d, mode) {
    const pa = this.p[a], pb = this.p[b];
    const dx = pb[0] - pa[0], dy = pb[1] - pa[1], dz = pb[2] - pa[2], l = Math.hypot(dx, dy, dz) || 1e-6;
    if (mode === 1 && l >= d) return;
    const wa = 1 / MASS[a], wb = 1 / MASS[b], k = (l - d) / l / (wa + wb);
    pa[0] += dx * k * wa; pa[1] += dy * k * wa; pa[2] += dz * k * wa;
    pb[0] -= dx * k * wb; pb[1] -= dy * k * wb; pb[2] -= dz * k * wb;
  }

  /** knees bend forward only, elbows backward only (relative to the chest's facing) */
  hinges() {
    const P = this.p;
    const right = norm(sub(P[J.rSh], P[J.lSh])), up = norm(sub(P[J.neck], P[J.pelvis]));
    // chest forward. Game space is three.js space with z mirrored (the skeleton is placed through that mirror),
    // which flips handedness: forward = up x right here, not right x up
    const f = norm(cross(up, right));
    for (const [a, m, c, sgn] of [[J.lHip, J.lKn, J.lFt, 1], [J.rHip, J.rKn, J.rFt, 1], [J.lSh, J.lEl, J.lHa, -1], [J.rSh, J.rEl, J.rHa, -1]]) {
      const mid = [(P[a][0] + P[c][0]) / 2, (P[a][1] + P[c][1]) / 2, (P[a][2] + P[c][2]) / 2];
      const off = dot(sub(P[m], mid), f) * sgn;
      if (off >= 0) continue;
      const k = -off * sgn * 0.5;
      P[m][0] += f[0] * k; P[m][1] += f[1] * k; P[m][2] += f[2] * k;
      for (const e of [a, c]) { P[e][0] -= f[0] * k * 0.5; P[e][1] -= f[1] * k * 0.5; P[e][2] -= f[2] * k * 0.5; }
    }
  }

  collide(i, h, w) {
    const p = this.p[i], q = this.q[i], r = RAD[i];
    // walls (anything but water and what we're above)
    for (const s of w.segsNear(p[0], p[2], 1)) {
      if (s.kind === 'water' || (s.top && p[1] > Math.max(...s.top) + 0.05)) continue;
      const L2 = s.dx * s.dx + s.dz * s.dz || 1e-9, t = Math.max(0, Math.min(1, ((p[0] - s.ax) * s.dx + (p[2] - s.az) * s.dz) / L2));
      const cx = s.ax + s.dx * t, cz = s.az + s.dz * t, dx = p[0] - cx, dz = p[2] - cz, d = Math.hypot(dx, dz);
      if (d >= r) continue;
      let nx = dx / (d || 1), nz = dz / (d || 1);
      if (!d) { const vx = p[0] - q[0], vz = p[2] - q[2], l = Math.hypot(vx, vz) || 1; nx = -vx / l; nz = -vz / l; }
      const vn = ((p[0] - q[0]) * nx + (p[2] - q[2]) * nz) / h;
      p[0] = cx + nx * r; p[2] = cz + nz * r;
      if (vn < 0) { this.hurt(i, -Math.min(-vn, Math.max(0, -(this.vi[i][0] * nx + this.vi[i][2] * nz)))); q[0] = p[0] - ((p[0] - q[0]) - vn * h * nx) * 0.5; q[2] = p[2] - ((p[2] - q[2]) - vn * h * nz) * 0.5; }
    }
    const gy = w.height(p[0], p[2]);
    if (w.tileKind(p[0], p[2]) === 2 && p[1] < gy + 0.1) { if (!this.inWater) { this.inWater = true; this.splash = true; } }
    if (this.inWater) { if (p[1] < gy - 0.5) p[1] = gy - 0.5; return; }
    this.ground[i] = 0;
    if (p[1] < gy + r) {
      const vy = (p[1] - q[1]) / h;
      p[1] = gy + r; this.ground[i] = 1;
      // no bounce, 0.9 friction
      q[1] = p[1];
      const fr = 1 - Math.min(1, RD.friction * h * 24);
      q[0] = p[0] - (p[0] - q[0]) * fr; q[2] = p[2] - (p[2] - q[2]) * fr;
      if (vy < 0) this.hurt(i, Math.min(-vy, Math.max(0, -this.vi[i][1])));
    }
  }

  /** Hall of Meat: the change in speed into the surface, weighted by body region */
  hurt(i, dv) {
    if (dv < RD.hurtDv) return;
    const pts = Math.round(dv * dv * MASS[i] * 2 * REGION_W[i]);
    this.damage += pts;
    this.hits.push({ i, dv, region: REGION[i] });
    if (dv > RD.breakDv && !this.broken.has(REGION[i])) { this.broken.add(REGION[i]); this.newBreak = REGION[i]; }
  }

  /** a rigid frame for a part: origin, then x (side), y (axis), z (forward) unit vectors */
  static frame(P, [a, b, c]) {
    const o = P[a], y = norm(sub(P[b], o));
    let x = sub(P[c], o); x = sub(x, y.map(v => v * dot(x, y)));
    if (len(x) < 1e-5) x = Math.abs(y[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
    x = norm(x); const z = cross(x, y);
    return [o, x, y, z];
  }

  /** score when it's over: damage, plus bones */
  get meat() { return this.damage + this.broken.size * 1000; }
}
