// Skins an RS model onto the bail ragdoll (src/ragdoll.js). The model's standing frame is measured for a
// skeleton (head, shoulders, elbows, hands, hips, knees, feet), every vertex is given to one rigid body part,
// and while the rider is limp each part follows its bones. Model-local space: y up, the rest as exported.
import { J, PARTS, Ragdoll } from './ragdoll.js';

export function buildRagSkin(model) {
  const a = model.meta.anims.ready || Object.values(model.meta.anims)[0];
  const fi = a ? a.frames[0] : 1, nv = model.nv, F = model.frames, o = fi * nv * 3;
  const V = i => [F[o + i * 3], F[o + i * 3 + 1], F[o + i * 3 + 2]];
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < nv; i++) { const y = F[o + i * 3 + 1]; y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const H = y1 - y0; if (!(H > 0.3)) return null;
  const band = (lo, hi) => { const r = []; for (let i = 0; i < nv; i++) { const y = F[o + i * 3 + 1] - y0; if (y >= lo * H && y <= hi * H) r.push(V(i)); } return r; };
  const mean = (pts, k) => pts.reduce((s, p) => s + p[k], 0) / Math.max(1, pts.length);
  // across the shoulders is whichever ground axis the arms spread along
  const arms = band(0.5, 0.8), spread = k => { const m = mean(arms, k); return arms.reduce((s, p) => s + Math.abs(p[k] - m), 0); };
  const L = spread(0) >= spread(2) ? 0 : 2, Fw = 2 - L;
  const cL = mean(arms, L), torso = band(0.45, 0.85), cF = mean(torso, Fw);
  const out = arms.map(p => Math.abs(p[L] - cL)).sort((x, y) => x - y), armOut = out[Math.floor(out.length * 0.95)] || 0.25 * H;
  // facing: the toes stick out in front of the hips
  const feet = band(0, 0.08), hips = band(0.35, 0.55), fs = Math.sign(mean(feet, Fw) - mean(hips, Fw)) || 1;
  const sx = armOut * 0.78, hx = armOut * 0.36;
  const at = (lat, y, f = 0) => { const p = [0, y0 + y * H, 0]; p[L] = cL + lat; p[Fw] = cF + f * fs; return p; };
  // right = up x forward; pick the lateral sign that makes that true
  const fwd = [0, 0, 0]; fwd[Fw] = fs;
  const right = [fwd[2], 0, -fwd[0]];                   // (0,1,0) x fwd
  const rs = Math.sign(right[L]) || 1;
  const skel = [];
  skel[J.head] = at(0, 0.92); skel[J.neck] = at(0, 0.82); skel[J.pelvis] = at(0, 0.52);
  skel[J.lSh] = at(-sx * rs, 0.79); skel[J.lEl] = at(-sx * rs, 0.62); skel[J.lHa] = at(-sx * rs, 0.46);
  skel[J.rSh] = at(sx * rs, 0.79); skel[J.rEl] = at(sx * rs, 0.62); skel[J.rHa] = at(sx * rs, 0.46);
  skel[J.lHip] = at(-hx * rs, 0.5); skel[J.lKn] = at(-hx * rs, 0.27, 0.02 * H); skel[J.lFt] = at(-hx * rs, 0.04);
  skel[J.rHip] = at(hx * rs, 0.5); skel[J.rKn] = at(hx * rs, 0.27, 0.02 * H); skel[J.rFt] = at(hx * rs, 0.04);
  // each vertex to the nearest bone (head above the neck, legs below the hips)
  const names = Object.keys(PARTS), segs = names.map(n => [skel[PARTS[n][0]], skel[PARTS[n][1]]]);
  const dseg = (p, [a, b]) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2 || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / l2));
    return Math.hypot(p[0] - a[0] - d[0] * t, p[1] - a[1] - d[1] * t, p[2] - a[2] - d[2] * t);
  };
  const neckY = skel[J.neck][1] - 0.02 * H, hipY = skel[J.lHip][1];
  const legs = new Set(['lThigh', 'lShin', 'rThigh', 'rShin']);
  const part = new Uint8Array(nv), local = new Float32Array(nv * 3);
  const frames = names.map(n => Ragdoll.frame(skel, PARTS[n]));
  for (let i = 0; i < nv; i++) {
    const p = V(i); let best = 0, bd = Infinity;
    if (p[1] > neckY && Math.abs(p[L] - cL) < sx * 0.8) best = names.indexOf('head');
    else names.forEach((n, k) => {
      if (n === 'head') return;
      if (legs.has(n) !== (p[1] < hipY)) return;
      const d = dseg(p, segs[k]) - (n === 'torso' ? 0.07 * H : 0);
      if (d < bd) { bd = d; best = k; }
    });
    part[i] = best;
    const [oo, x, y, z] = frames[best], r = [p[0] - oo[0], p[1] - oo[1], p[2] - oo[2]];
    local[i * 3] = r[0] * x[0] + r[1] * x[1] + r[2] * x[2];
    local[i * 3 + 1] = r[0] * y[0] + r[1] * y[1] + r[2] * y[2];
    local[i * 3 + 2] = r[0] * z[0] + r[1] * z[1] + r[2] * z[2];
  }
  return { skel, part, local, names, out: new Float32Array(nv * 3) };
}

/** pose the mesh from the ragdoll: P = particle positions in three.js world space; returns per-vertex xyz */
export function poseRagSkin(skin, P) {
  const frames = skin.names.map(n => Ragdoll.frame(P, PARTS[n])), { part, local, out } = skin;
  for (let i = 0; i < part.length; i++) {
    const [o, x, y, z] = frames[part[i]], a = local[i * 3], b = local[i * 3 + 1], c = local[i * 3 + 2];
    out[i * 3] = o[0] + x[0] * a + y[0] * b + z[0] * c;
    out[i * 3 + 1] = o[1] + x[1] * a + y[1] * b + z[1] * c;
    out[i * 3 + 2] = o[2] + x[2] * a + y[2] * b + z[2] * c;
  }
  return out;
}
