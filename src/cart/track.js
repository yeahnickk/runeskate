// CartScape's tracks: a loop of waypoints over the real 2004 map (world tiles), and everything along it: the boost
// pads, item rows, ramps, the river jump, the herds that wander across. Pure JS (no DOM / Three): tools/cart-track.ts
// bakes a track with the pack's ground heights (a road that's perfectly smooth whatever the RS terrain does: the
// terrain is dug down under it, the scenery on it taken out) and the race sim + the client read the baked track.
// Track space: s = distance along the centre line (game units, wraps at L), d = sideways, + to the left.

export const S = 1.5;                                           // WORLD_SCALE (mapdata.js), kept here so this stays standalone
const BASE = [2048, 2816];                                      // world tile -> grid tile

export const TRACKS = {
  lumbridge: {
    name: 'LUMBRIDGE LOOP', pack: 'cart_lumbridge', laps: 3, w: 13,
    // from the grid in front of Lumbridge Castle north, right over the river bridge, up the Al Kharid desert edge,
    // back west along the north road, over the River Lum (jump it), round the windmill farms, down past the swamp
    pts: [[3223, 3204], [3223, 3220], [3227, 3230], [3236, 3231], [3248, 3230], [3260, 3232], [3267, 3246], [3271, 3259], [3278, 3267], [3274, 3283],
      [3282, 3294], [3290, 3310], [3293, 3326], [3285, 3336], [3272, 3334], [3256, 3335], [3246, 3328], [3234, 3330], [3226, 3323], [3212, 3319],
      [3192, 3315], [3176, 3305], [3160, 3298], [3150, 3287], [3136, 3281], [3135, 3268], [3146, 3259], [3147, 3248], [3157, 3236], [3170, 3229],
      [3180, 3220], [3188, 3208], [3201, 3200], [3214, 3199]],
    finish: 1.05,                                              // the line, as waypoint index + fraction
    // at: waypoint index + fraction along to the next. d: sideways offset (+ left), as a fraction of the half width.
    // the corners: a right-hander onto the bridge, an S through the desert dunes, the hairpin at the top, the S before
    // the river, a switchback through the west fields
    features: [
      { k: 'items', at: 3.3 }, { k: 'boost', at: 5.4, d: 0.45 }, { k: 'ramp', at: 6.6, rise: 1.6, len: 9 },
      { k: 'boulders', at: 7.6 }, { k: 'items', at: 9.6 }, { k: 'ramp', at: 10.6, rise: 2.2, len: 11 }, { k: 'boost', at: 11.4, d: -0.45 },
      { k: 'blades', at: 14.5 }, { k: 'items', at: 15.5 }, { k: 'boost', at: 18.0, d: 0 }, { k: 'jump', at: 18.6, rise: 3.6, len: 20 },
      { k: 'items', at: 20.3 }, { k: 'chickens', at: 21.5 }, { k: 'boost', at: 22.5, d: 0.5 }, { k: 'items', at: 25.6 },
      { k: 'cows', at: 27.2, span: 45 }, { k: 'ramp', at: 29.6, rise: 1.8, len: 10 }, { k: 'boost', at: 30.5, d: -0.4 }, { k: 'items', at: 31.6 },
      { k: 'arch', at: 2.7, god: 'sara' }, { k: 'arch', at: 12.5, god: 'zam' }, { k: 'arch', at: 19.7, god: 'guthix' }, { k: 'arch', at: 28.4, god: 'arma' },
    ],
  },
};

const lerp = (a, b, t) => a + (b - a) * t;
/** the signed turn from heading a to heading b, in (-PI, PI], for any a and b (a kart's heading winds up a lap at a time) */
export const angd = (a, b) => { const d = ((b - a) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI); return d - Math.PI; };

/** centripetal Catmull-Rom through the loop (no overshoot kinks), resampled every ds game units */
export function sampleLoop(ptsTiles, ds = 1) {
  const P = ptsTiles.map(([x, z]) => [(x - BASE[0]) * S, (z - BASE[1]) * S]), n = P.length, dense = [], knots = [];
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    const tj = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-3;
    const t0 = 0, t1 = t0 + tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3);
    knots.push(dense.length);
    for (let k = 0; k < 40; k++) {
      const t = t1 + (t2 - t1) * k / 40, q = [];
      for (let c = 0; c < 2; c++) {
        const A1 = (t1 - t) / (t1 - t0) * p0[c] + (t - t0) / (t1 - t0) * p1[c], A2 = (t2 - t) / (t2 - t1) * p1[c] + (t - t1) / (t2 - t1) * p2[c], A3 = (t3 - t) / (t3 - t2) * p2[c] + (t - t2) / (t3 - t2) * p3[c];
        const B1 = (t2 - t) / (t2 - t0) * A1 + (t - t0) / (t2 - t0) * A2, B2 = (t3 - t) / (t3 - t1) * A2 + (t - t1) / (t3 - t1) * A3;
        q.push((t2 - t) / (t2 - t1) * B1 + (t - t1) / (t2 - t1) * B2);
      }
      dense.push(q);
    }
  }
  const acc = [0];
  for (let i = 1; i <= dense.length; i++) acc.push(acc[i - 1] + Math.hypot(dense[i % dense.length][0] - dense[i - 1][0], dense[i % dense.length][1] - dense[i - 1][1]));
  const L = acc[dense.length], N = Math.round(L / ds), step = L / N, x = new Float64Array(N), z = new Float64Array(N);
  let j = 0;
  for (let i = 0; i < N; i++) {
    const s = i * step; while (acc[j + 1] < s) j++;
    const u = (s - acc[j]) / (acc[j + 1] - acc[j] || 1), a = dense[j], b = dense[(j + 1) % dense.length];
    x[i] = lerp(a[0], b[0], u); z[i] = lerp(a[1], b[1], u);
  }
  return { L, N, ds: step, x, z, knotS: knots.map(k => acc[k]) };
}

/** waypoint index + fraction -> s */
export function atS(knotS, L, at) {
  const n = knotS.length, i = Math.floor(at) % n, f = at - Math.floor(at), a = knotS[i], b = i + 1 < n ? knotS[i + 1] : L;
  return (a + (b - a) * f) % L;
}

/** bake a track: heightAt(gx, gz) the ground, waterAt(gx, gz) true over water. Returns plain data (JSON-able) */
export function bakeTrack(def, heightAt, waterAt) {
  const sm = sampleLoop(def.pts), { N, L, ds, x, z } = sm, hw = def.w / 2;
  const tx = new Float64Array(N), tz = new Float64Array(N);
  for (let i = 0; i < N; i++) { const a = (i - 1 + N) % N, b = (i + 1) % N, dx = x[b] - x[a], dz = z[b] - z[a], l = Math.hypot(dx, dz); tx[i] = dx / l; tz[i] = dz / l; }
  const at = a => atS(sm.knotS, L, a), wrap = i => ((i % N) + N) % N;
  // the ground under the road: the high side of it (the road sits on the land, never in a dip of it), water as a hole
  const raw = new Float64Array(N), wet = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    let hi = -Infinity, sum = 0, n = 0, w = 0;
    for (const f of [-1, -0.5, 0, 0.5, 1]) {
      const gx = x[i] - tz[i] * f * hw, gz = z[i] + tx[i] * f * hw;
      if (waterAt(gx, gz)) { w++; continue; }
      const h = heightAt(gx, gz); hi = Math.max(hi, h); sum += h; n++;
    }
    wet[i] = w >= 2; raw[i] = n ? hi * 0.55 + sum / n * 0.45 : NaN;
    if (wet[i]) raw[i] = NaN;
  }
  // over water: a straight span from bank to bank (a bridge), lifted a touch in the middle
  for (let i = 0; i < N; i++) if (isNaN(raw[i])) {
    let a = i; while (isNaN(raw[wrap(a - 1)]) && a > i - N) a--;
    let b = i; while (isNaN(raw[wrap(b + 1)]) && b < i + N) b++;
    const ya = raw[wrap(a - 1)], yb = raw[wrap(b + 1)], span = b - a + 2;
    for (let k = a; k <= b; k++) { const u = (k - a + 1) / span; raw[wrap(k)] = lerp(ya, yb, u) + Math.sin(u * Math.PI) * Math.min(1.2, span * 0.04); }
    i = Math.max(i, b);
  }
  // smooth it: a road with no bumps (a wide gaussian, twice), then the features on top
  let y = Float64Array.from(raw);
  for (let pass = 0; pass < 3; pass++) {
    const R = 14, K = [], out = new Float64Array(N); for (let k = -R; k <= R; k++) K.push(Math.exp(-(k * k) / (2 * 6 * 6)));
    const ks = K.reduce((a, b) => a + b);
    for (let i = 0; i < N; i++) { let v = 0; for (let k = -R; k <= R; k++) v += y[wrap(i + k)] * K[k + R]; out[i] = v / ks; }
    y = out;
  }
  const g = Float64Array.from(y);                               // the road before the ramps go on (the ground they stand on)
  const flags = new Uint8Array(N);                               // 1 bridge, 2 gap (no road: you fly it or you swim), 4 ramp, 8 lip, 16 dash ramp
  for (let i = 0; i < N; i++) if (wet[i]) flags[i] |= 1;
  const feats = [];
  for (const f of def.features) {
    const s = at(f.at), i0 = Math.round(s / ds);
    if (f.k === 'ramp' || f.k === 'jump') {
      let lip = i0, land = i0;
      if (f.k === 'jump') {                                       // over the river: the ramp's lip on the near bank, the landing past the far one
        let a = -1; for (let k = -40; k <= 40; k++) if (wet[wrap(i0 + k)]) { a = i0 + k; break; }
        if (a >= 0) { let b = a; while (wet[wrap(b + 1)]) b++; lip = a - 2; land = b + 4; }
        for (let k = lip + 1; k < land; k++) { flags[wrap(k)] = (flags[wrap(k)] & ~1) | 2; }
      }
      const n = Math.round(f.len / ds);
      for (let k = 0; k <= n; k++) { const i = wrap(lip - n + k), u = k / n; y[i] += f.rise * Math.pow(u, 1.6); flags[i] |= f.k === 'jump' ? 20 : 4; }   // (16: the river ramp, a dash ramp)
      flags[wrap(lip)] |= 8;
      feats.push({ ...f, s: wrap(lip) * ds, land: wrap(land) * ds });
    } else feats.push({ ...f, s: i0 * ds });
  }
  // a gap's water: where you land if you come up short
  for (const f of feats) if (f.k === 'jump') { const i = Math.round(f.s / ds); f.water = Math.min(heightAt(x[wrap(i + 4)], z[wrap(i + 4)]), y[wrap(i)] - 4); }
  const r = v => Array.from(v, q => Math.round(q * 1000) / 1000);
  return { name: def.name, laps: def.laps, w: def.w, L, N, ds, x: r(x), z: r(z), y: r(y), g: r(g), tx: r(tx), tz: r(tz), flags: Array.from(flags), finish: at(def.finish), feats };
}

/** a baked track at run time: frames at any s, and where a point is in track space */
export class Track {
  constructor(b) {
    Object.assign(this, b); this.hw = b.w / 2;
    // a coarse grid of samples for nearest lookups from anywhere (a kart knocked flying, a fresh spawn)
    this.cell = new Map();
    for (let i = 0; i < this.N; i++) { const k = Math.floor(this.x[i] / 16) + ',' + Math.floor(this.z[i] / 16); if (!this.cell.has(k)) this.cell.set(k, []); this.cell.get(k).push(i); }
  }
  wrap(s) { return ((s % this.L) + this.L) % this.L; }
  /** the centre line at s: { x, z, y, tx, tz, flags } (lerped) */
  at(s, o = {}) {
    s = this.wrap(s); const f = s / this.ds, i = Math.floor(f) % this.N, j = (i + 1) % this.N, u = f - Math.floor(f);
    o.x = lerp(this.x[i], this.x[j], u); o.z = lerp(this.z[i], this.z[j], u); o.y = lerp(this.y[i], this.y[j], u);
    let tx = lerp(this.tx[i], this.tx[j], u), tz = lerp(this.tz[i], this.tz[j], u); const l = Math.hypot(tx, tz); o.tx = tx / l; o.tz = tz / l;
    o.flags = this.flags[u < 0.5 ? i : j];
    return o;
  }
  /** the road's height at s (the profile is flat across) */
  h(s) { s = this.wrap(s); const f = s / this.ds, i = Math.floor(f) % this.N; return lerp(this.y[i], this.y[(i + 1) % this.N], f - Math.floor(f)); }
  flag(s) { return this.flags[Math.round(this.wrap(s) / this.ds) % this.N]; }
  /** (x, z) -> { s, d } in track space. hint: a recent s to search round (cheap); without one, the grid finds it */
  locate(x, z, hint = null) {
    let best = -1, bd = Infinity;
    const test = i => { const d = (x - this.x[i]) ** 2 + (z - this.z[i]) ** 2; if (d < bd) { bd = d; best = i; } };
    if (hint != null) { const c = Math.round(this.wrap(hint) / this.ds); for (let k = -24; k <= 24; k++) test(((c + k) % this.N + this.N) % this.N); }
    if (hint == null || bd > 30 * 30) { const cx = Math.floor(x / 16), cz = Math.floor(z / 16); for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (const i of this.cell.get((cx + a) + ',' + (cz + b)) || []) test(i); }
    if (best < 0) for (let i = 0; i < this.N; i += 4) test(i);
    // refine along the segment to the better neighbour
    const i = best, j = (i + 1) % this.N, h = (i - 1 + this.N) % this.N;
    const proj = (a, b) => { const ex = this.x[b] - this.x[a], ez = this.z[b] - this.z[a], l2 = ex * ex + ez * ez; return Math.max(0, Math.min(1, ((x - this.x[a]) * ex + (z - this.z[a]) * ez) / l2)); };
    let s, ox, oz, otx, otz;
    const u1 = proj(i, j), u0 = proj(h, i);
    if (u1 > 0) { s = i * this.ds + u1 * this.ds; } else { s = h * this.ds + u0 * this.ds; }
    for (let k = 0; k < 3; k++) { const f = this.at(s); s += (x - f.x) * f.tx + (z - f.z) * f.tz; }   // slide along until the point sits square off the line (inverts pos() on tight corners)
    const f = this.at(s); ox = f.x; oz = f.z; otx = f.tx; otz = f.tz;
    return { s: this.wrap(s), d: (x - ox) * -otz + (z - oz) * otx };
  }
  /** track space -> (x, z) */
  pos(s, d, o = {}) { const f = this.at(s); o.x = f.x - f.tz * d; o.z = f.z + f.tx * d; o.y = f.y; o.tx = f.tx; o.tz = f.tz; o.flags = f.flags; return o; }
  /** signed curvature at s (+ = turning left), per unit */
  curve(s, span = 6) { const a = this.at(s - span), b = this.at(s + span); return (Math.atan2(b.tz, b.tx) - Math.atan2(a.tz, a.tx) + Math.PI * 3) % (Math.PI * 2) - Math.PI; }
}
