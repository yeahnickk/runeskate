// The skate rig: while riding, the rider is posed from a 15-joint skeleton (src/ragdoll.js's joints, measured
// off the RS model by src/ragskin.js) instead of a baked RuneScape clip. Two-bone IK keeps the feet locked to
// the deck through carves, pops, flips, grinds and manuals; the pelvis crouches for an ollie, extends on the
// pop, tucks in the air, absorbs the landing on a spring; arms balance; the back foot pushes off the street.
// Pure math (no three.js): positions are three.js world space [x, y, z], y up.
import { J } from './ragdoll.js';

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** rotate v about unit axis k by angle a (Rodrigues) */
const rot = (v, k, a) => { const c = Math.cos(a), s = Math.sin(a), kv = cross(k, v), kd = dot(k, v); return [v[0] * c + kv[0] * s + k[0] * kd * (1 - c), v[1] * c + kv[1] * s + k[1] * kd * (1 - c), v[2] * c + kv[2] * s + k[2] * kd * (1 - c)]; };

/** two-bone IK: the middle joint for root a reaching target t with bones l1, l2, bending toward pole */
export function ik2(a, t, l1, l2, pole) {
  let d = sub(t, a), dl = len(d);
  const reach = (l1 + l2) * 0.999, minR = Math.abs(l1 - l2) + 1e-3;
  dl = clamp(dl, minR, reach); const dir = norm(d);
  const x = (l1 * l1 - l2 * l2 + dl * dl) / (2 * dl), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  let p = sub(pole, mul(dir, dot(pole, dir))); if (len(p) < 1e-5) p = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  p = norm(p);
  return { mid: add(add(a, mul(dir, x)), mul(p, h)), end: add(a, mul(dir, dl)) };
}

/** bone lengths of a skeleton */
export function rigDims(skel) {
  const d = (a, b) => len(sub(skel[a], skel[b]));
  return {
    thigh: (d(J.lHip, J.lKn) + d(J.rHip, J.rKn)) / 2, shin: (d(J.lKn, J.lFt) + d(J.rKn, J.rFt)) / 2,
    upper: (d(J.lSh, J.lEl) + d(J.rSh, J.rEl)) / 2, fore: (d(J.lEl, J.lHa) + d(J.rEl, J.rHa)) / 2,
    torso: d(J.pelvis, J.neck), neck: d(J.neck, J.head), sh: d(J.lSh, J.rSh) / 2, hip: d(J.lHip, J.rHip) / 2,
    shDrop: skel[J.neck][1] - (skel[J.lSh][1] + skel[J.rSh][1]) / 2, hipDrop: skel[J.pelvis][1] - (skel[J.lHip][1] + skel[J.rHip][1]) / 2,
    ankle: Math.max(0.03, (skel[J.lFt][1] + skel[J.rFt][1]) / 2 - Math.min(skel[J.lFt][1], skel[J.rFt][1]) + 0.05),
  };
}

const PUSH_T = 0.63;                    // one push stroke (skater P.pushEvery + 0.08)

/**
 * Pose the rider. s: skater state (mode, charge, airTime, pushing, manual, balance, lean, grab, trick,
 * boardRoll, boardYaw, grindKind, slide, vy). b: the board in world space: { front, back } deck foot spots,
 * nose (unit, along the deck), up (deck normal), ground (street height under the board), ryaw (rider yaw:
 * the nose direction the rider stands to, unrolled). st: per-rider rig state (springs, kept between frames).
 * Returns 15 joints (three.js world space).
 */
export function poseRider(s, b, dims, st, dt) {
  const D = dims, legL = D.thigh + D.shin;
  // ---- the rider's own frame: world up, facing across the board (right side to the nose)
  const up = [0, 1, 0], nose = [Math.cos(b.ryaw), 0, -Math.sin(b.ryaw)], face = norm(cross(nose, up));
  // ---- springs and phases
  const air = s.mode === 'air', grind = s.mode === 'grind', ground = s.mode === 'ground';
  if (st.mode === 'air' && !air && s.mode !== 'bail') st.absorbV = (st.absorbV || 0) + clamp(0.5 + Math.abs(st.vy || 0) * 0.08, 0.5, 2.2);   // landing: knees take it
  if (st.mode !== 'air' && air) st.popT = 0;
  st.mode = s.mode; st.vy = s.vy ?? st.vy;
  st.absorb = st.absorb || 0; st.absorbV = st.absorbV || 0;
  st.absorbV += (-st.absorb * 120 - st.absorbV * 16) * dt; st.absorb = clamp(st.absorb + st.absorbV * dt, 0, 0.75);
  st.popT = (st.popT || 0) + dt;
  let crouch;
  if (air) {
    const a = s.airTime || 0;
    crouch = a < 0.1 ? 0.05 : Math.min(0.65, 0.05 + (a - 0.1) * 3);            // pop: legs snap straight, then tuck
    if (s.grab) crouch = 0.8;
  } else if (grind) crouch = 0.32;
  else crouch = 0.12 + Math.max(0, s.charge ?? -1) * 0.5 + (s.manual ? 0.15 : 0) + Math.abs(s.lean || 0) * 0.06;
  crouch = clamp(crouch + st.absorb, 0, 0.92);
  st.crouch = st.crouch === undefined ? crouch : st.crouch + (crouch - st.crouch) * Math.min(1, dt * 14);
  const c = st.crouch;
  // ---- feet: on the deck unless the board is flipping or shoving out from under them
  const flipping = air && (Math.abs(Math.sin((s.boardRoll || 0) / 2)) > 0.12 || Math.abs(Math.sin((s.boardYaw || 0) / 2)) > 0.12);
  st.off = (st.off || 0) + ((flipping ? 1 : 0) - (st.off || 0)) * Math.min(1, dt * (flipping ? 20 : 12));
  const deckMid = lerp(b.front, b.back, 0.5);
  let front = add(b.front, mul(b.up, D.ankle)), back = add(b.back, mul(b.up, D.ankle));
  // the ollie: front foot slides up toward the nose, back foot snaps the tail
  if (air && (s.airTime || 0) < 0.22 && !flipping) {
    const k = Math.sin(clamp((s.airTime || 0) / 0.22, 0, 1) * Math.PI);
    front = add(front, add(mul(nose, 0.07 * k), mul(up, 0.06 * k)));
  }
  // pushing: the back foot steps off, plants beside the board and drives back along the street
  const pushing = ground && (s.pushing || 0) > 0 && !s.manual && !((s.charge ?? -1) >= 0);
  if (pushing) {
    const u = clamp(1 - s.pushing / PUSH_T, 0, 1), street = b.ground + D.ankle;
    const side = mul(face, 0.17);
    const at = x => add(add(deckMid, mul(nose, x)), side);
    let p, lift;
    if (u < 0.22) { const t = u / 0.22; p = lerp(back, at(0.12), t); lift = Math.sin(t * Math.PI) * 0.12; p = [p[0], lerp([0, back[1], 0], [0, street, 0], t)[1] + lift, p[2]]; }
    else if (u < 0.72) { const t = (u - 0.22) / 0.5; p = at(0.12 - 0.62 * t); p = [p[0], street, p[2]]; }
    else { const t = (u - 0.72) / 0.28; const q = at(-0.5); p = lerp([q[0], street, q[2]], back, t); p = [p[0], p[1] + Math.sin(t * Math.PI) * 0.12, p[2]]; }
    back = p;
  }
  // feet tucked under the hips while the board turns under them (flips, shuvits)
  const hipsGuess = add(deckMid, mul(up, legL * (1 - 0.5 * c)));
  if (st.off > 0.01) {
    const tuck = (side) => add(add(add(hipsGuess, mul(up, -legL * 0.62)), mul(nose, 0.24 * side)), mul(face, 0.05));
    front = lerp(front, add(tuck(1), mul(up, 0.08)), st.off); back = lerp(back, tuck(-1), st.off);
  }
  // ---- pelvis: over the feet, low as the crouch, leaning into carves and manuals
  const mid = lerp(front, pushing ? add(b.back, mul(b.up, D.ankle)) : back, 0.5);
  const spread = len(sub(front, back)) / 2;
  const hMax = Math.sqrt(Math.max(0.01, (legL * 0.985) ** 2 - spread * spread)) - D.hipDrop;
  let h = Math.min(hMax, legL * (0.98 - 0.5 * c));
  if (pushing) h = Math.min(h, legL * 0.78);
  const lean = s.lean || 0, man = s.manual || 0, bal = s.balance || 0;
  let pelvis = add(add(mid, mul(up, h)), add(mul(face, -0.03 + lean * 0.09 + (grind ? bal * 0.08 : 0)), mul(nose, -man * 0.07)));
  // ---- torso: bends at the hips with the crouch, leans back over the tail on a manual
  // (a turn about the nose tips toward the face, about the face toward the tail)
  let tdir = rot(up, nose, 0.1 + c * 0.55 + lean * 0.15 + (grind ? bal * 0.3 : 0));   // fold forward, lean into the carve
  tdir = rot(tdir, face, man * 0.28);                                        // manual: back over the tail
  tdir = norm(tdir);
  const neck = add(pelvis, mul(tdir, D.torso));
  const head = add(neck, mul(norm(add(tdir, add(mul(nose, 0.22), mul(face, 0.18)))), D.neck));
  // shoulders: open toward the nose; square to it when pushing
  st.twist = st.twist === undefined ? 0 : st.twist + (((pushing ? 1.0 : 0.25) + (air ? (s.spinRate || 0) * 0.04 : 0)) - st.twist) * Math.min(1, dt * 8);
  const shR = norm(rot(nose, tdir, st.twist)), shC = sub(neck, mul(tdir, D.shDrop));
  const rSh = add(shC, mul(shR, D.sh)), lSh = add(shC, mul(shR, -D.sh));
  const hipR = norm(rot(nose, up, pushing ? 0.5 : 0.1)), hipC = sub(pelvis, mul(up, D.hipDrop));
  const rHip = add(hipC, mul(hipR, D.hip)), lHip = add(hipC, mul(hipR, -D.hip));
  // ---- legs: right foot to the nose (feet come off the deck spots in IK order: front = right)
  const legPole = side => norm(add(face, mul(nose, 0.35 * side)));
  const rLeg = ik2(rHip, front, D.thigh, D.shin, legPole(1)), lLeg = ik2(lHip, back, D.thigh, D.shin, legPole(-1));
  // ---- arms: balance. Out wide on rails and in the air, a hand to the board for a grab
  const out = grind ? 0.75 : air ? 0.55 : s.manual ? 0.6 : 0.25 + Math.abs(lean) * 0.3;
  const armT = (sh, side) => {
    const o = norm(add(add(mul(up, -1), mul(shR, side * out * 1.3)), mul(face, 0.25 + (pushing ? 0.2 : 0))));
    return add(sh, mul(o, (D.upper + D.fore) * 0.93));
  };
  let rHaT = armT(rSh, 1), lHaT = armT(lSh, -1);
  if (s.grab) {
    const k = clamp(((s.grabT ?? 0.2) - 0) / 0.1, 0, 1);
    const g = s.grab, edge = /Melon|Stalefish/.test(g) ? -1 : 1;              // heel edge vs toe edge
    const spot = /Nose/.test(g) ? b.front : /Tail/.test(g) ? b.back : add(deckMid, mul(face, 0.11 * edge));
    if (/Melon|Method|Nose/.test(g)) rHaT = lerp(rHaT, spot, k); else lHaT = lerp(lHaT, spot, k);
  }
  const armPole = side => norm(add(mul(face, -0.6), add(mul(shR, side * 0.5), mul(up, -0.2))));
  const rArm = ik2(rSh, rHaT, D.upper, D.fore, armPole(1)), lArm = ik2(lSh, lHaT, D.upper, D.fore, armPole(-1));
  const P = [];
  P[J.head] = head; P[J.neck] = neck; P[J.pelvis] = pelvis;
  P[J.lSh] = lSh; P[J.lEl] = lArm.mid; P[J.lHa] = lArm.end; P[J.rSh] = rSh; P[J.rEl] = rArm.mid; P[J.rHa] = rArm.end;
  P[J.lHip] = lHip; P[J.lKn] = lLeg.mid; P[J.lFt] = lLeg.end; P[J.rHip] = rHip; P[J.rKn] = rLeg.mid; P[J.rFt] = rLeg.end;
  return P;
}
