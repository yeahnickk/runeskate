// The skate body. An RS player model, kept exactly as RS draws it (same low-poly parts, same flat colours, every
// outfit item), skinned to a human skeleton:
//  - bones from RS's own vertex labels (the bone groups RS animates by), so every helm, platebody, cape and pair
//    of boots follows the same skeleton
//  - human proportions, the way Skate draws a skater: longer thighs, slightly longer shins, a slightly smaller head
//  - joints that bend instead of cracking: vertices near a knee, elbow, hip, shoulder, neck or waist blend between
//    the two bones
//  - feet of their own (RS welds the foot to the shin) so they stay flat on the deck when the knees bend, and a
//    two-part spine so the back curves
//  - the RS clips (walking, emotes) are retargeted onto the same body, so it never pops between proportions
// Posed from the 15-joint skeleton (src/ragdoll.js) plus 5 extra points: toes, foot-up references and the spine.
// A model without labels (the stock model) falls back to measuring a skeleton off the mesh in height bands.
import { J, PARTS, Ragdoll } from './ragdoll.js';

/** the extra points after the 15 ragdoll joints (src/rig.js fills them; the ragdoll's are derived) */
export const X = { lToe: 15, rToe: 16, lFtUp: 17, rFtUp: 18, spine: 19 };
// parts of the label skin: [origin, axis end, side reference]
const DEFS = {
  head: [J.neck, J.head, J.rSh], chest: [X.spine, J.neck, J.rSh], abdomen: [J.pelvis, X.spine, J.rHip],
  lUpper: [J.lSh, J.lEl, J.pelvis], lFore: [J.lEl, J.lHa, J.neck], rUpper: [J.rSh, J.rEl, J.pelvis], rFore: [J.rEl, J.rHa, J.neck],
  lThigh: [J.lHip, J.lKn, J.rHip], lShin: [J.lKn, J.lFt, J.rHip], lFoot: [J.lFt, X.lToe, X.lFtUp],
  rThigh: [J.rHip, J.rKn, J.lHip], rShin: [J.rKn, J.rFt, J.lHip], rFoot: [J.rFt, X.rToe, X.rFtUp],
};
const PARENT = { head: 'chest', chest: 'abdomen', abdomen: null, lUpper: 'chest', rUpper: 'chest', lFore: 'lUpper', rFore: 'rUpper',
  lThigh: 'abdomen', rThigh: 'abdomen', lShin: 'lThigh', rShin: 'rThigh', lFoot: 'lShin', rFoot: 'rShin' };
// RS vertex labels -> bone (grouped by the animation transforms that move them; +x is the model's right)
const LABELS = {
  head: [16, 17], chest: [18, 19, 20, 21, 30, 31, 32, 33, 34, 39, 42, 43, 54, 55, 58, 79], abdomen: [22, 23, 41, 62, 64, 65, 78, 81, 82, 85],
  rUpper: [4, 5], lUpper: [3, 7], rFore: [6, 14], lFore: [2, 80, 15, 86],
  rThigh: [24, 27, 61, 77], lThigh: [25, 29, 63, 83, 84], rShin: [8, 12, 26, 59], lShin: [10, 13, 28, 60], rFoot: [9], lFoot: [11],
};
// how a real body is built next to an RS one (Skate's skaters are realistically proportioned)
const K_THIGH = 1.18, K_SHIN = 1.06, K_HEAD = 0.9;
// joint blends: [parent part, child part, joint, half-width of the blend (tiles)]
const BLENDS = [['abdomen', 'chest', X.spine, 0.08], ['chest', 'head', J.neck, 0.035],
  ['chest', 'lUpper', J.lSh, 0.06], ['chest', 'rUpper', J.rSh, 0.06], ['lUpper', 'lFore', J.lEl, 0.06], ['rUpper', 'rFore', J.rEl, 0.06],
  ['abdomen', 'lThigh', J.lHip, 0.07], ['abdomen', 'rThigh', J.rHip, 0.07], ['lThigh', 'lShin', J.lKn, 0.07], ['rThigh', 'rShin', J.rKn, 0.07],
  ['lShin', 'lFoot', J.lFt, 0.03], ['rShin', 'rFoot', J.rFt, 0.03]];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const toLocal = ([o, x, y, z], p) => { const r = sub(p, o); return [dot(r, x), dot(r, y), dot(r, z)]; };
const fromLocal = ([o, x, y, z], l) => [o[0] + x[0] * l[0] + y[0] * l[1] + z[0] * l[2], o[1] + x[1] * l[0] + y[1] * l[1] + z[1] * l[2], o[2] + x[2] * l[0] + y[2] * l[1] + z[2] * l[2]];

export function buildRagSkin(model) {
  return (model.meta.labels && buildLabelSkin(model)) || buildBandSkin(model);
}

// ------------------------------------------------------------------ label skin (outfit models)
function buildLabelSkin(model) {
  const nv = model.nv, F = model.frames, L = model.meta.labels;      // frame 0 = the bind pose
  const V = i => [F[i * 3], F[i * 3 + 1], F[i * 3 + 2]];
  const byLab = new Map();
  for (let i = 0; i < nv; i++) { if (!byLab.has(L[i])) byLab.set(L[i], []); byLab.get(L[i]).push(i); }
  // the skeleton is measured on the plain body (meta.bodyRef, src/rsanim.js), so armour doesn't move joints;
  // without it, on the worn model itself
  const ref = model.meta.bodyRef;
  const pts = labs => labs.flatMap(l => byLab.get(l) || []).map(V);
  const cen = ref ? labs => { const r = labs.map(l => ref.labels[l]).filter(Boolean); return r.length ? [0, 1, 2].map(k => r.reduce((s, q) => s + q[k], 0) / r.length) : null; }
    : labs => { const p = pts(labs); return p.length ? [0, 1, 2].map(k => p.reduce((s, q) => s + q[k], 0) / p.length) : null; };
  const ext = ref ? (labs, k, f) => { const r = labs.map(l => ref.labels[l]).filter(Boolean); return r.length ? f(...r.map(q => k === 1 && f === Math.min ? q[3] : k === 1 ? q[4] : q[k])) : null; }
    : (labs, k, f) => { const p = pts(labs); return p.length ? f(...p.map(q => q[k])) : null; };
  const need = [16, 3, 4, 5, 7, 24, 25, 26, 27, 28, 29, 12, 13, 9, 11, 6, 2];
  if (need.some(l => !(ref ? ref.labels[l] : byLab.has(l)))) return null;
  let y0 = Infinity; for (let i = 0; i < nv; i++) y0 = Math.min(y0, F[i * 3 + 1]);
  if (ref) y0 = ref.sole;
  // ---- the bind skeleton, from the label groups
  const S = [];
  const c16 = cen([16]), c18 = cen([18]) || [c16[0], ext([16], 1, Math.min), c16[2]];
  S[J.head] = c16; S[J.neck] = c18;
  for (const [side, up, el, fore, hand] of [['r', 4, 5, 6, 14], ['l', 7, 3, 2, 15]]) {
    const cu = cen([up]), cf = cen([fore]), ch = cen([hand]) || cf;
    S[J[side + 'Sh']] = [cu[0] * 0.95, ext([up], 1, Math.max) - 0.045, cu[2]];
    S[J[side + 'El']] = cen([el]);
    const wy = ch === cf ? ext([fore], 1, Math.min) : (ext([fore], 1, Math.min) + ext([hand], 1, Math.max)) / 2;
    S[J[side + 'Ha']] = [(cf[0] + ch[0]) / 2, wy, (cf[2] + ch[2]) / 2];
  }
  const ankleH = Math.max(0.06, (cen([12])[1] - y0) * 0.8);
  for (const [side, hip, kt, kb, ank, toe] of [['r', 24, 27, 26, 12, 9], ['l', 25, 29, 28, 13, 11]]) {
    const ch = cen([hip]);
    S[J[side + 'Hip']] = [ch[0] * 0.72, ch[1] - 0.01, ch[2]];
    S[J[side + 'Kn']] = lerp(cen([kt]), cen([kb]), 0.5);
    const ca = cen([ank]); S[J[side + 'Ft']] = [ca[0], y0 + ankleH, ca[2]];
    S[X[side + 'Toe']] = cen([toe]);
    S[X[side + 'FtUp']] = add(S[J[side + 'Ft']], [0, 0.1, 0]);
  }
  const hipY = (S[J.lHip][1] + S[J.rHip][1]) / 2;
  S[J.pelvis] = [(S[J.lHip][0] + S[J.rHip][0]) / 2, hipY + 0.05, (S[J.lHip][2] + S[J.rHip][2]) / 2];
  const ct = cen([33]) || S[J.pelvis];
  S[X.spine] = [S[J.pelvis][0], S[J.pelvis][1] + (S[J.neck][1] - S[J.pelvis][1]) * 0.42, (S[J.pelvis][2] + ct[2]) / 2];
  // ---- every vertex to a bone: by label, else (labels only some items use) the nearest bone
  const names = Object.keys(DEFS), idx = Object.fromEntries(names.map((n, i) => [n, i]));
  const labPart = new Map(); for (const [n, ls] of Object.entries(LABELS)) for (const l of ls) labPart.set(l, idx[n]);
  const seg = n => [S[DEFS[n][0]], S[DEFS[n][1]]];
  const dseg = (p, [a, b]) => { const d = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), d) / (dot(d, d) || 1e-9))); return len(sub(p, add(a, mul(d, t)))); };
  const p = new Uint8Array(nv), q = new Uint8Array(nv), w = new Float32Array(nv);
  for (let i = 0; i < nv; i++) {
    const v = V(i); let k = labPart.get(L[i]);
    if (k === undefined) {
      let bd = Infinity;
      for (const n of names) { if (n === 'head' && v[1] < S[J.neck][1]) continue; const d = dseg(v, seg(n)) - (n === 'chest' || n === 'abdomen' ? 0.08 : 0); if (d < bd) { bd = d; k = idx[n]; } }
    }
    // RS's torso runs down to the belt and its shin includes the heel: split them at the spine and the ankle
    if (k === idx.chest && v[1] < S[X.spine][1]) k = idx.abdomen;
    if (k === idx.lShin && v[1] < S[J.lFt][1] + 0.015) k = idx.lFoot;
    if (k === idx.rShin && v[1] < S[J.rFt][1] + 0.015) k = idx.rFoot;
    p[i] = q[i] = k;
  }
  // ---- joint blends: a vertex within reach of a joint shares itself with the bone across it (0.5 at the joint)
  for (const [pa, ch, j, r] of BLENDS) {
    const a = idx[pa], b = idx[ch], o = S[j], ax = (() => { const d = sub(S[DEFS[ch][1]], S[DEFS[ch][0]]); return mul(d, 1 / (len(d) || 1)); })();
    for (let i = 0; i < nv; i++) {
      if (p[i] !== a && p[i] !== b) continue;
      const v = V(i), d = dot(sub(v, o), ax);
      if (len(sub(v, o)) > r * 3.2) continue;
      if (p[i] === b && d >= 0 && d < r) { const ww = 0.5 * (1 - d / r); if (ww > w[i]) { q[i] = a; w[i] = ww; } }
      if (p[i] === a && d < 0 && -d < r) { const ww = 0.5 * (1 + d / r); if (ww > w[i]) { q[i] = b; w[i] = ww; } }
    }
  }
  // ---- the human skeleton: longer legs (the sole stays put), a smaller head
  const R = S.map(x => x.slice());
  let dy = 0;
  for (const s of ['l', 'r']) {
    const hip = S[J[s + 'Hip']], kn = S[J[s + 'Kn']], ft = S[J[s + 'Ft']];
    R[J[s + 'Kn']] = add(hip, mul(sub(kn, hip), K_THIGH));
    R[J[s + 'Ft']] = add(R[J[s + 'Kn']], mul(sub(ft, kn), K_SHIN));
    dy += (ft[1] - R[J[s + 'Ft']][1]) / 2;
  }
  for (const s of ['l', 'r']) { R[X[s + 'Toe']] = add(R[J[s + 'Ft']], sub(S[X[s + 'Toe']], S[J[s + 'Ft']])); R[X[s + 'FtUp']] = add(R[J[s + 'Ft']], [0, 0.1, 0]); }
  for (const x of R) x[1] += dy;
  R[J.head] = add(R[J.neck], mul(sub(S[J.head], S[J.neck]), K_HEAD));
  // ---- local coordinates, in each bone's bind frame, stretched to the human bone lengths
  const bindF = names.map(n => Ragdoll.frame(S, DEFS[n]));
  const scale = (k, l) => { const n = names[k]; return n === 'head' ? mul(l, K_HEAD) : /Thigh/.test(n) ? [l[0], l[1] * K_THIGH, l[2]] : /Shin/.test(n) ? [l[0], l[1] * K_SHIN, l[2]] : l; };
  const lp = new Float32Array(nv * 3), lq = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) { lp.set(scale(p[i], toLocal(bindF[p[i]], V(i))), i * 3); lq.set(scale(q[i], toLocal(bindF[q[i]], V(i))), i * 3); }
  // where the toes and foot-up points ride on the shin, for poses that only have the 15 joints (the ragdoll)
  const rF = Ragdoll.frame(R, DEFS.rShin), lF = Ragdoll.frame(R, DEFS.lShin);
  const shinRide = { [X.rToe]: [DEFS.rShin, toLocal(rF, R[X.rToe])], [X.rFtUp]: [DEFS.rShin, toLocal(rF, R[X.rFtUp])],
    [X.lToe]: [DEFS.lShin, toLocal(lF, R[X.lToe])], [X.lFtUp]: [DEFS.lShin, toLocal(lF, R[X.lFtUp])] };
  const spineK = len(sub(R[X.spine], R[J.pelvis])) / (len(sub(R[J.neck], R[J.pelvis])) || 1);
  // per bone: its vertices (for fitting RS clip frames) and bind centroid
  const members = names.map(() => []); for (let i = 0; i < nv; i++) members[p[i]].push(i);
  return {
    labelled: true, skel: R.slice(0, 15), full: R, names, defs: names.map(n => DEFS[n]), nv, p, q, w, lp, lq,
    ankleH, spineK, shinRide, bindS: S, bindF, members, dy, cache: new Map(), out: new Float32Array(nv * 3),
  };
}

/** the 20 points a label skin poses from: P's own when it has them (the rig), else derived (the ragdoll) */
function completeP(skin, P) {
  if (P.length >= 20) return P;
  const Q = P.slice(0, 15);
  Q[X.spine] = lerp(Q[J.pelvis], Q[J.neck], skin.spineK);
  for (const [k, [def, l]] of Object.entries(skin.shinRide)) Q[+k] = fromLocal(Ragdoll.frame(Q, def), l);
  return Q;
}

/** pose the mesh: P = joints in three.js world space (or model-local); returns per-vertex xyz */
export function poseRagSkin(skin, P) {
  // P.refs (optional, src/rig.js): a part's side reference point, to turn it about its own bone (the head's look)
  const Q = skin.labelled ? completeP(skin, P) : P, R = P.refs;
  const frames = skin.names.map((n, k) => R?.[n] ? Ragdoll.frame([...Q, R[n]], [skin.defs[k][0], skin.defs[k][1], Q.length]) : Ragdoll.frame(Q, skin.defs[k]));
  return writeVerts(skin, frames);
}

function writeVerts(skin, frames) {
  const { p, q, w, lp, lq, out } = skin;
  for (let i = 0; i < p.length; i++) {
    const A = frames[p[i]], a = lp[i * 3], b = lp[i * 3 + 1], c = lp[i * 3 + 2];
    let x = A[0][0] + A[1][0] * a + A[2][0] * b + A[3][0] * c, y = A[0][1] + A[1][1] * a + A[2][1] * b + A[3][1] * c, z = A[0][2] + A[1][2] * a + A[2][2] * b + A[3][2] * c;
    const t = w[i];
    if (t > 0) {
      const B = frames[q[i]], d = lq[i * 3], e = lq[i * 3 + 1], f = lq[i * 3 + 2];
      x += (B[0][0] + B[1][0] * d + B[2][0] * e + B[3][0] * f - x) * t;
      y += (B[0][1] + B[1][1] * d + B[2][1] * e + B[3][1] * f - y) * t;
      z += (B[0][2] + B[1][2] * d + B[2][2] * e + B[3][2] * f - z) * t;
    }
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
  }
  return out;
}

// ------------------------------------------------------------------ RS clips on the human body
/** best-fit rotation (Horn's quaternion method) taking points a (centred) onto b (centred): 3x3 rows */
function fitRotation(A, B) {
  let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
  for (let i = 0; i < A.length; i++) {
    const a = A[i], b = B[i];
    Sxx += a[0] * b[0]; Sxy += a[0] * b[1]; Sxz += a[0] * b[2]; Syx += a[1] * b[0]; Syy += a[1] * b[1]; Syz += a[1] * b[2]; Szx += a[2] * b[0]; Szy += a[2] * b[1]; Szz += a[2] * b[2];
  }
  const N = [[Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx], [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy], [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz]];
  const sh = Math.abs(Sxx) + Math.abs(Syy) + Math.abs(Szz) + Math.abs(Sxy) + Math.abs(Sxz) + Math.abs(Syx) + Math.abs(Syz) + Math.abs(Szx) + Math.abs(Szy) + 1e-9;
  for (let i = 0; i < 4; i++) N[i][i] += sh * 2;                    // shift: the largest eigenvalue is the one power iteration finds
  let v = [1, 0, 0, 0];
  for (let it = 0; it < 40; it++) {
    const u = N.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2] + r[3] * v[3]), l = Math.hypot(...u) || 1;
    v = u.map(x => x / l);
  }
  const [qw, qx, qy, qz] = v;
  return [[1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
    [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
    [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)]];
}
const rotV = (M, v) => [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]];

/** an RS clip frame (model.frames index fi) retargeted onto the human body: model-local per-vertex xyz */
export function skinFrame(skin, model, fi) {
  if (!skin.labelled) return null;
  const hit = skin.cache.get(fi); if (hit) return hit;
  const nv = skin.nv, F = model.frames, o = fi * nv * 3, S = skin.bindS, R0 = skin.full;
  const B = i => [F[i * 3], F[i * 3 + 1], F[i * 3 + 2]], Fv = i => [F[o + i * 3], F[o + i * 3 + 1], F[o + i * 3 + 2]];
  // each bone's rotation in this frame, fitted to its vertices (a bone with too few to fit takes its parent's)
  const rot = [], cB = [], cF = [];
  skin.names.forEach((n, k) => {
    const m = skin.members[k];
    if (m.length < 3) { rot[k] = null; return; }
    const cb = [0, 0, 0], cf = [0, 0, 0];
    for (const i of m) { const b = B(i), f = Fv(i); for (let c = 0; c < 3; c++) { cb[c] += b[c] / m.length; cf[c] += f[c] / m.length; } }
    rot[k] = fitRotation(m.map(i => sub(B(i), cb)), m.map(i => sub(Fv(i), cf))); cB[k] = cb; cF[k] = cf;
  });
  const ix = Object.fromEntries(skin.names.map((n, k) => [n, k]));
  const Rof = n => { let k = ix[n]; while (!rot[k] && PARENT[skin.names[k]]) k = ix[PARENT[skin.names[k]]]; return rot[k] || [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; };
  // rebuild the joints down the chain with the human bone lengths
  const P = [], step = (from, n, j) => add(P[from], rotV(Rof(n), sub(R0[j], R0[from])));
  const a = ix.abdomen, ra = rot[a] ? a : ix.chest;
  P[J.pelvis] = add(add(rotV(rot[ra], sub(S[J.pelvis], cB[ra])), cF[ra]), [0, skin.dy, 0]);
  P[X.spine] = step(J.pelvis, 'abdomen', X.spine);
  P[J.neck] = step(X.spine, 'chest', J.neck); P[J.head] = step(J.neck, 'head', J.head);
  for (const s of ['l', 'r']) {
    P[J[s + 'Sh']] = step(X.spine, 'chest', J[s + 'Sh']); P[J[s + 'El']] = step(J[s + 'Sh'], s + 'Upper', J[s + 'El']); P[J[s + 'Ha']] = step(J[s + 'El'], s + 'Fore', J[s + 'Ha']);
    P[J[s + 'Hip']] = step(J.pelvis, 'abdomen', J[s + 'Hip']); P[J[s + 'Kn']] = step(J[s + 'Hip'], s + 'Thigh', J[s + 'Kn']); P[J[s + 'Ft']] = step(J[s + 'Kn'], s + 'Shin', J[s + 'Ft']);
    P[X[s + 'Toe']] = step(J[s + 'Ft'], s + 'Foot', X[s + 'Toe']); P[X[s + 'FtUp']] = step(J[s + 'Ft'], s + 'Foot', X[s + 'FtUp']);
  }
  // each bone's frame: its posed origin, its bind axes turned by the fitted rotation
  const frames = skin.names.map((n, k) => { const [, x, y, z] = skin.bindF[k], M = Rof(n); return [P[skin.defs[k][0]], rotV(M, x), rotV(M, y), rotV(M, z)]; });
  const out = Float32Array.from(writeVerts(skin, frames));
  // feet on the floor: the lowest point lands where the clip's did
  let lo = Infinity, lf = Infinity;
  for (let i = 0; i < nv; i++) { lo = Math.min(lo, out[i * 3 + 1]); lf = Math.min(lf, F[o + i * 3 + 1]); }
  for (let i = 0; i < nv; i++) out[i * 3 + 1] += lf - lo;
  if (skin.cache.size > 400) skin.cache.clear();
  skin.cache.set(fi, out);
  return out;
}

// ------------------------------------------------------------------ band skin (models without labels)
function buildBandSkin(model) {
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
  // facing: the face sticks out in front of the chest (the toes don't tell: a stance frame splits the feet)
  const head = band(0.86, 1), chest = band(0.6, 0.8), hips = band(0.42, 0.56), fs = Math.sign(mean(head, Fw) - mean(chest, Fw)) || 1;
  const sx = armOut * 0.78, hx = armOut * 0.36;
  const at = (lat, y, f = 0) => { const p = [0, y0 + y * H, 0]; p[L] = cL + lat; p[Fw] = cF + f * fs; return p; };
  const fwd = [0, 0, 0]; fwd[Fw] = fs;
  const right = [fwd[2], 0, -fwd[0]];                   // (0,1,0) x fwd
  const rs = Math.sign(right[L]) || 1;
  const side = (pts, sg) => pts.filter(p => (p[L] - cL) * sg * rs > 0);
  const cen = (pts, fb) => pts.length ? [mean(pts, 0), mean(pts, 1), mean(pts, 2)] : fb;
  const midF = k => { const p = [0, 0, 0]; p[L] = cL; p[Fw] = mean(k, Fw); return p; };
  const spine = (y, pts) => { const p = midF(pts); p[1] = y0 + y * H; return p; };
  const skel = [];
  skel[J.head] = spine(0.92, head); skel[J.neck] = spine(0.82, chest); skel[J.pelvis] = spine(0.52, hips);
  const shoulder = sg => { const p = spine(0.79, chest); p[L] = cL + sx * rs * sg; return p; };
  const hipJ = sg => { const p = spine(0.5, hips); p[L] = cL + hx * rs * sg; return p; };
  skel[J.lSh] = shoulder(-1); skel[J.rSh] = shoulder(1); skel[J.lHip] = hipJ(-1); skel[J.rHip] = hipJ(1);
  const foot = band(0, 0.07), knee = band(0.24, 0.31);
  const armPts = sg => band(0.4, 0.78).filter(p => (p[L] - cL) * sg * rs > sx * 0.7);
  for (const [sg, Ft, Kn, El, Ha] of [[-1, J.lFt, J.lKn, J.lEl, J.lHa], [1, J.rFt, J.rKn, J.rEl, J.rHa]]) {
    skel[Ft] = cen(side(foot, sg), at(hx * rs * sg, 0.04)); skel[Ft][1] = y0 + 0.04 * H;
    skel[Kn] = cen(side(knee, sg), at(hx * rs * sg, 0.27));
    const ap = armPts(sg), lo = ap.length ? Math.min(...ap.map(p => p[1])) : 0;
    skel[Ha] = ap.length ? cen(ap.filter(p => p[1] < lo + 0.07 * H), at(sx * rs * sg, 0.46)) : at(sx * rs * sg, 0.46);
    skel[El] = ap.length ? cen(ap.filter(p => p[1] > y0 + 0.58 * H && p[1] < y0 + 0.67 * H), at(sx * rs * sg, 0.62)) : at(sx * rs * sg, 0.62);
  }
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
    local.set(toLocal(frames[best], p), i * 3);
  }
  return { labelled: false, skel, names, defs: names.map(n => PARTS[n]), nv, p: part, q: part, w: new Float32Array(nv), lp: local, lq: local, out: new Float32Array(nv * 3) };
}
