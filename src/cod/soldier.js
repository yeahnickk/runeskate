// Everyone else on the battlefield, seen from outside: your RS player model in your side's colours (Castle
// Wars capes, god armour or leathers), skinned to the human skeleton the skate game uses (src/ragskin.js).
// The legs play RS's own walk / run / sidestep clips; the arms are two-bone IK onto the gun, which points
// where they aim (the chest and head lean into the pitch). Hit zones are measured off the posed joints, so a
// headshot is the head you see. Death hands the body to the skate game's ragdoll.
import * as THREE from 'three';
import { RSModel } from '../model.js';
import { buildOutfitModel } from '../rsanim.js';
import { buildRagSkin, poseRagSkin, clipJoints } from '../ragskin.js';
import { J, Ragdoll } from '../ragdoll.js';
import { ik2 } from '../rig.js';
import { buildGun } from './guns.js';
import { WEAPONS } from './weapons.js';

// what each side wears: a Castle Wars cape always, then one of a few sets
const KITS = {
  sara: [{ 1: 2412, 4: 2661, 7: 2663 }, { 1: 2412, 4: 2661, 7: 2663, 0: 2665 }, { 1: 2412, 4: 1129, 7: 1095, 0: 1169 }, { 1: 2412, 4: 1131, 7: 1097, 9: 1063 }],
  zam: [{ 1: 2414, 4: 2653, 7: 2655 }, { 1: 2414, 4: 2653, 7: 2655, 0: 2657 }, { 1: 2414, 4: 1129, 7: 1095, 0: 1167 }, { 1: 2414, 4: 1131, 7: 1099, 9: 1059 }],
};
const proto = new Map();                                    // 'team:i' -> { model, skin, fwd }
async function prototype(team, i) {
  const k = team + ':' + i;
  if (!proto.has(k)) proto.set(k, (async () => {
    const model = await buildOutfitModel({ g: 0, items: KITS[team][i], kits: {} });
    const skin = buildRagSkin(model);
    const fcol = new Uint8Array(model.geo.attributes.color.array.length);
    model.geo.attributes.color.array.forEach((c, j) => { fcol[j] = Math.round(c * 255); });
    // which way the body faces in model space: heels to toes
    const F = skin.full, fx = (F[15][0] + F[16][0]) / 2 - (F[J.lFt][0] + F[J.rFt][0]) / 2, fz = (F[15][2] + F[16][2]) / 2 - (F[J.lFt][2] + F[J.rFt][2]) / 2;
    const fl = Math.hypot(fx, fz) || 1;
    return { model, skin, fcol, fwd: [fx / fl, 0, fz / fl] };
  })());
  return proto.get(k);
}
/** load the outfits for a side up front (the menu does this while you pick a class) */
export const preloadTeam = team => Promise.all(KITS[team].map((_, i) => prototype(team, i)));

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const rotX = (p, o, a, R, U, F) => {                       // rotate p about the axis R through o by a (pitch the upper body)
  const v = sub(p, o), c = Math.cos(a), s = Math.sin(a);
  const r = v[0] * R[0] + v[1] * R[1] + v[2] * R[2], u = v[0] * U[0] + v[1] * U[1] + v[2] * U[2], f = v[0] * F[0] + v[1] * F[1] + v[2] * F[2];
  const u2 = u * c + f * s, f2 = -u * s + f * c;
  return [o[0] + R[0] * r + U[0] * u2 + F[0] * f2, o[1] + R[1] * r + U[1] * u2 + F[1] * f2, o[2] + R[2] * r + U[2] * u2 + F[2] * f2];
};

export class Avatar {
  static async create(team, variant = Math.floor(Math.random() * 4)) {
    const p = await prototype(team, variant % KITS[team].length);
    return new Avatar(p, team);
  }
  constructor(p, team) {
    this.p = p; this.team = team;
    this.m = new RSModel(p.model.meta, p.model.frames, p.model.faces, p.fcol);
    this.m.mesh.material = this.m.mesh.material.clone();
    this.group = new THREE.Group(); this.group.add(this.m.group);
    this.gunId = null; this.gun = null; this.P = null; this.rag = null; this.flashT = 0;
    this.walkDir = 1;
    // a muzzle flash others see
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flash.visible = false; this.group.add(this.flash);
  }

  setGun(id) {
    if (this.gunId === id) return;
    if (this.gun) this.group.remove(this.gun.group);
    this.gun = buildGun(WEAPONS[id].model); this.gunId = id;
    this.group.add(this.gun.group);
  }

  /**
   * s: { pos (feet), yaw, pitch, vel, crouch, onGround, sprinting, reloading } ; dt.
   * Poses the body; returns nothing (hit zones in this.zones).
   */
  update(dt, s) {
    if (this.rag) return;
    const m = this.m, sk = this.p.skin;
    // legs: which clip, and which way through it (backpedal = the walk backwards)
    const fwdS = -Math.sin(s.yaw) * s.vel.x - Math.cos(s.yaw) * s.vel.z, sideS = Math.cos(s.yaw) * s.vel.x - Math.sin(s.yaw) * s.vel.z;
    const sp = Math.hypot(s.vel.x, s.vel.z);
    let clip = 'ready', rate = 1;
    if (!s.onGround) clip = 'spot_jump';
    else if (sp > 0.6) {
      if (Math.abs(sideS) > Math.abs(fwdS) * 1.2) { clip = 'sidestep'; rate = Math.sign(sideS) * sp / 3.5; }
      else { clip = s.sprinting || sp > 7 ? 'run' : 'walk'; rate = (fwdS >= 0 ? 1 : -1) * sp / (clip === 'run' ? 7.5 : 4.2); }
    }
    if (m.clip !== clip) m.play(clip, clip !== 'spot_jump', true);
    m.clipT += dt * (Math.abs(rate) - 1) + (rate < 0 ? -2 * dt * Math.abs(rate) : 0);
    if (m.clipT < 0) { const a = m.meta.anims[clip]; m.clipT += a ? a.delay.reduce((x, d) => x + Math.max(1, d), 0) * 0.02 : 1; }
    m.update(dt);
    const P = clipJoints(sk, m, m.cur >= 0 ? m.cur : 1)?.map(p => p.slice());
    if (!P) return;
    const F = this.p.fwd, U = [0, 1, 0], R = norm(cross(U, F));       // model-space forward / up / right(ish)
    // crouch: drop the pelvis, bend the knees (IK the legs down)
    const crouch = s.crouch || 0;
    if (crouch > 0.01) {
      const drop = 0.38 * crouch;
      for (const j of [J.pelvis, J.neck, J.head, J.lSh, J.rSh, J.lEl, J.rEl, J.lHa, J.rHa, J.lHip, J.rHip, 19]) P[j] = [P[j][0], P[j][1] - drop, P[j][2]];
      for (const sd of ['l', 'r']) {
        const hip = P[J[sd + 'Hip']], ft = P[J[sd + 'Ft']], th = len(sub(sk.full[J[sd + 'Kn']], sk.full[J[sd + 'Hip']])), sh = len(sub(sk.full[J[sd + 'Ft']], sk.full[J[sd + 'Kn']]));
        P[J[sd + 'Kn']] = ik2(hip, ft, th, sh, F).mid;
      }
    }
    // upper body leans into the aim pitch, about the spine
    const pitch = Math.max(-1.2, Math.min(1.2, s.pitch || 0)), sp0 = P[19] || P[J.pelvis];
    for (const j of [J.neck, J.head, J.lSh, J.rSh, J.lEl, J.rEl, J.lHa, J.rHa]) P[j] = rotX(P[j], sp0, -pitch * 0.45, R, U, F);
    P[J.head] = rotX(P[J.head], P[J.neck], -pitch * 0.4, R, U, F);
    // the gun: shouldered, pointing along the aim; hands on its grip and fore end
    const aim = norm(add(mul(F, Math.cos(pitch)), mul(U, Math.sin(pitch))));
    const side = Math.sign(sub(P[J.rSh], P[J.lSh]).reduce((a, v, i) => a + v * R[i], 0)) || 1;   // which side the right shoulder is on
    const Rr = mul(R, side);
    const g = this.gun, low = s.sprinting ? 0.12 : 0;
    const grip = add(add(add(P[J.rSh], mul(aim, 0.24)), mul(U, -0.17 - low)), mul(Rr, -0.06));
    if (g) {
      const gm = g.group;
      gm.position.set(grip[0], grip[1], grip[2]);
      const fwd3 = new THREE.Vector3(aim[0], aim[1], aim[2]);
      if (s.sprinting) fwd3.set(F[0] * 0.6 + Rr[0] * -0.5, -0.5, F[2] * 0.6 + Rr[2] * -0.5).normalize();
      if (s.reloading) fwd3.set(aim[0], aim[1] + 0.35, aim[2]).normalize();
      gm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), fwd3);
      gm.updateMatrix();
      const fore = g.fore.clone().applyMatrix4(gm.matrix), gp = new THREE.Vector3(0, -0.01, 0.02).applyMatrix4(gm.matrix);
      for (const [sd, tgt] of [['r', [gp.x, gp.y, gp.z]], ['l', [fore.x, fore.y, fore.z]]]) {
        const sh = P[J[sd + 'Sh']], up = len(sub(sk.full[J[sd + 'El']], sk.full[J[sd + 'Sh']])), fo = len(sub(sk.full[J[sd + 'Ha']], sk.full[J[sd + 'El']]));
        const pole = add(mul(U, -1), mul(Rr, sd === 'r' ? 0.8 : -0.8));
        const { mid, end } = ik2(sh, tgt, up, fo, pole);
        P[J[sd + 'El']] = mid; P[J[sd + 'Ha']] = end;
      }
      g.muzzle.updateMatrixWorld?.();
    }
    m.setVerts(poseRagSkin(sk, P));
    this.P = P;
    // place it: feet at pos, facing yaw
    const modelYaw = Math.atan2(F[0], F[2]);                   // model forward's own heading
    this.group.position.copy(s.pos);
    this.group.rotation.set(0, s.yaw + Math.PI - modelYaw, 0);
    this.group.updateMatrixWorld(true);
    this.flashT -= dt; this.flash.visible = this.flashT > 0;
    if (this.flash.visible && g) { this.flash.position.copy(g.muzzle.position).applyMatrix4(g.group.matrix); this.flash.scale.setScalar(0.6 + Math.random() * 0.8); }
  }

  shot() { this.flashT = 0.05; }

  /** world-space joints (after update) */
  worldJoints() {
    if (this.rag) return this.rag.p.map(p => new THREE.Vector3(p[0], p[1], p[2]));
    if (!this.P) return null;
    const M = this.group.matrixWorld;
    return this.P.map(p => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(M));
  }
  /** the muzzle in world space (tracers start here) */
  muzzleWorld(out = new THREE.Vector3()) { if (!this.gun) return this.group.getWorldPosition(out); return this.gun.muzzle.getWorldPosition(out); }

  /**
   * hit test: ray (origin o, unit dir d, max far) against the body's zones -> { t, zone } or null.
   * Head (a ball), chest / stomach (the torso capsule, split), limbs (thin capsules).
   */
  hit(o, d, far) {
    const W = this.worldJoints(); if (!W) return null;
    let best = null;
    const test = (a, b, r, zone) => { const t = rayCapsule(o, d, a, b, r); if (t !== null && t < far && (!best || t < best.t)) best = { t, zone }; };
    const head = W[J.head], neck = W[J.neck], pel = W[J.pelvis], mid = neck.clone().lerp(pel, 0.45);
    test(head, head, 0.15, 'head');
    test(neck.clone().lerp(pel, 0.08), mid, 0.2, 'chest');
    test(mid, pel, 0.19, 'stomach');
    for (const [a, b] of [[J.lSh, J.lEl], [J.lEl, J.lHa], [J.rSh, J.rEl], [J.rEl, J.rHa]]) test(W[a], W[b], 0.075, 'limb');
    for (const [a, b] of [[J.lHip, J.lKn], [J.lKn, J.lFt], [J.rHip, J.rKn], [J.rKn, J.rFt]]) test(W[a], W[b], 0.095, 'limb');
    return best;
  }

  /** fall: the posed body becomes a ragdoll, shoved along the killing shot; floorAt(x, z) is the floor under them */
  die(dir, force, floorAt) {
    const W = this.worldJoints(); if (!W) return;
    const v = [dir.x * force, 1.2 + Math.random(), dir.z * force];
    this.rag = new Ragdoll(W.slice(0, 15).map(p => [p.x, p.y, p.z]), p => p, v, 'wall');
    this.ragW = { segsNear: () => [], height: (x, z) => floorAt(x, z), tileKind: () => 0 };
    this.group.position.set(0, 0, 0); this.group.rotation.set(0, 0, 0);
    if (this.gun) { this.dropGun = this.gun; this.gun = null; this.gunId = null; this.dropV = new THREE.Vector3(dir.x * 2, 2, dir.z * 2); this.dropGun.group.position.applyMatrix4(this.m.group.matrixWorld); }
    this.flash.visible = false;
  }
  updateRag(dt) {
    if (!this.rag) return;
    this.rag.step(Math.min(dt, 1 / 30), this.ragW);
    this.m.setVerts(poseRagSkin(this.p.skin, this.rag.p.map(p => [p[0], p[1], p[2]])));
    if (this.dropGun) {                                       // the gun clatters to the floor
      const g = this.dropGun.group; this.dropV.y -= 20 * dt; g.position.addScaledVector(this.dropV, dt);
      const fy = this.ragW.height(g.position.x, g.position.z) + 0.03;
      if (g.position.y < fy) { g.position.y = fy; this.dropV.set(0, 0, 0); g.rotation.z = Math.PI / 2; }
    }
  }
  revive() { this.rag = null; if (this.dropGun) { this.group.remove(this.dropGun.group); this.dropGun = null; } }
}

/** ray (o, unit d) against a capsule a-b of radius r: distance along the ray or null */
export function rayCapsule(o, d, a, b, r) {
  // closest approach between the ray and the segment, then the sphere at that segment point
  const ab = _ab.subVectors(b, a), ao = _ao.subVectors(o, a);
  const abL2 = ab.lengthSq();
  let s;
  if (abL2 < 1e-8) s = 0;
  else {
    const dd = d.dot(ab), e = ao.dot(ab), f = ao.dot(d), den = abL2 - dd * dd;
    s = Math.max(0, Math.min(1, den > 1e-8 ? (e - dd * f) / den : 0));
  }
  const c = _c.copy(a).addScaledVector(ab, s);
  // ray vs sphere(c, r)
  const oc = _oc.subVectors(o, c), bq = oc.dot(d), cq = oc.lengthSq() - r * r, disc = bq * bq - cq;
  if (disc < 0) return null;
  const t = -bq - Math.sqrt(disc);
  return t >= 0 ? t : (cq < 0 ? 0 : null);
}
const _ab = new THREE.Vector3(), _ao = new THREE.Vector3(), _c = new THREE.Vector3(), _oc = new THREE.Vector3();
