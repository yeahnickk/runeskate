// CartScape's karts, built from scratch out of low-poly parts (flat-shaded, RS-chunky): three bodies (a go-kart, an RS
// mine cart, a dragon racer) in seven god trims, each with its god's symbol painted on and its own bits (Zamorak's
// horns, Armadyl's feathers, Bandos spikes, a Seren crystal shell). The driver is a real RS player model sat in it,
// posed through the ragdoll skin: knees up, hands on the wheel. Built facing +x (three.js); left is -z.
import * as THREE from 'three';
import { RSModel } from '../model.js';
import { buildOutfitModel } from '../rsanim.js';
import { buildRagSkin, poseRagSkin, clipJoints } from '../ragskin.js';
import { J } from '../ragdoll.js';
import { ik2 } from '../rig.js';

export const THEMES = {
  sara: { name: 'SARADOMIN', body: 0x1f45a8, trim: 0xf2f0e6, acc: 0xffcf3a, dark: 0x16245a, sym: 'sara', outfit: [2665, 2661, 2663] },
  zam: { name: 'ZAMORAK', body: 0xa01212, trim: 0x1b1414, acc: 0xff8a1a, dark: 0x3a0606, sym: 'zam', outfit: [2657, 2653, 2655] },
  guthix: { name: 'GUTHIX', body: 0x2f7a2c, trim: 0x7a5228, acc: 0xd8d4c0, dark: 0x1a3a18, sym: 'guthix', outfit: [2673, 2669, 2671] },
  arma: { name: 'ARMADYL', body: 0xeceadf, trim: 0xc9a032, acc: 0x2f8a96, dark: 0x8a8670, sym: 'arma', outfit: [1163, 1127, 1079] },
  bandos: { name: 'BANDOS', body: 0x6a5a40, trim: 0x8c8c80, acc: 0xb84a1a, dark: 0x3a3022, sym: 'bandos', outfit: [1153, 1115, 1067] },
  zaros: { name: 'ZAROS', body: 0x45205e, trim: 0x15121c, acc: 0xc85cff, dark: 0x22102e, sym: 'zaros', outfit: [579, 577, 1011] },
  seren: { name: 'SEREN', body: 0x8fe4f2, trim: 0xffffff, acc: 0x3ab8ff, dark: 0x4a9ab0, sym: 'seren', outfit: [1165, 1125, 1077], glass: true },
};
export const BODIES = { kart: 'GO-KART', mine: 'MINE CART', dragon: 'DRAGON RACER' };
const TILT = -0.62, RIM = 0.17, LOCK = 1.2;                      // the column's tilt (down to the floor ahead; the wheel faces the driver's chest), the rim, full lock
/** where a hand grips the rim, in kart space: side -1 left (-z) / +1 right, steer -1..1 (+ left), as the wheel shows it */
export function gripAt(kart, side, steer) {
  const th = -steer * LOCK, z = side * RIM * Math.cos(th), y = -side * RIM * Math.sin(th);   // the rim's 3 / 9 o'clock, turned with the wheel
  const c = Math.cos(TILT), sn = Math.sin(TILT), back = 0.035;                               // (the palm sits just on the driver's side of the rim)
  return [kart.wheelAt.x - y * sn - c * back, kart.wheelAt.y + y * c - sn * back, kart.wheelAt.z + z];
}

// ---------------------------------------------------------------- the god's symbol, painted
const symTex = new Map();
export function symbol(sym, acc, body) {
  const key = sym + acc; if (symTex.has(key)) return symTex.get(key);
  const S = 128, c = Object.assign(document.createElement('canvas'), { width: S, height: S }), x = c.getContext('2d');
  const A = '#' + new THREE.Color(acc).getHexString(), B = '#' + new THREE.Color(body).getHexString();
  x.translate(S / 2, S / 2); x.lineJoin = 'round'; x.lineWidth = 7; x.strokeStyle = '#111'; x.fillStyle = A;
  const ring = () => { x.beginPath(); x.arc(0, 0, 54, 0, 7); x.fillStyle = B; x.fill(); x.lineWidth = 6; x.strokeStyle = A; x.stroke(); x.fillStyle = A; x.strokeStyle = '#111'; x.lineWidth = 4; };
  const star = (n, r0, r1, rot = -Math.PI / 2) => { x.beginPath(); for (let i = 0; i < n * 2; i++) { const a = rot + i * Math.PI / n, r = i % 2 ? r1 : r0; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.closePath(); x.fill(); x.stroke(); };
  ring();
  if (sym === 'sara') { star(4, 46, 12); star(4, 26, 8, -Math.PI / 4); }
  else if (sym === 'zam') { x.beginPath(); x.moveTo(-30, -36); x.lineTo(30, -36); x.lineTo(-18, 22); x.lineTo(30, 22); x.lineTo(30, 36); x.lineTo(-30, 36); x.lineTo(18, -22); x.lineTo(-30, -22); x.closePath(); x.fill(); x.stroke(); star(3, 12, 5, Math.PI / 2); }
  else if (sym === 'guthix') { x.beginPath(); x.arc(0, 0, 32, 0, 7); x.lineWidth = 10; x.strokeStyle = A; x.stroke(); x.fillRect(-5, -46, 10, 92); x.beginPath(); x.arc(0, -16, 9, 0, 7); x.arc(0, 16, 9, 0, 7); x.fill(); }
  else if (sym === 'arma') { for (const s of [-1, 1]) { x.beginPath(); x.moveTo(0, 18); for (let i = 0; i < 5; i++) x.lineTo(s * (10 + i * 9), -30 + i * 10); x.lineTo(s * 46, 10); x.closePath(); x.fill(); x.stroke(); } x.beginPath(); x.arc(0, 8, 9, 0, 7); x.fill(); }
  else if (sym === 'bandos') { x.save(); for (const s of [-1, 1]) { x.save(); x.rotate(s * 0.7); x.fillRect(-5, -42, 10, 84); x.strokeRect(-5, -42, 10, 84); x.beginPath(); x.moveTo(-5, -42); x.lineTo(s * 26, -34); x.lineTo(s * 22, -14); x.lineTo(-5, -20); x.fill(); x.stroke(); x.restore(); } x.restore(); }
  else if (sym === 'zaros') { x.beginPath(); x.moveTo(0, -44); x.lineTo(32, 0); x.lineTo(0, 44); x.lineTo(-32, 0); x.closePath(); x.fill(); x.stroke(); x.fillStyle = B; x.beginPath(); x.ellipse(0, 0, 14, 22, 0, 0, 7); x.fill(); x.fillStyle = A; x.beginPath(); x.arc(0, 0, 6, 0, 7); x.fill(); }
  else if (sym === 'seren') { for (let i = 0; i < 6; i++) { x.save(); x.rotate(i * Math.PI / 3); x.beginPath(); x.moveTo(0, -8); x.lineTo(9, -24); x.lineTo(0, -48); x.lineTo(-9, -24); x.closePath(); x.fill(); x.stroke(); x.restore(); } }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  symTex.set(key, t); return t;
}

// ---------------------------------------------------------------- parts, merged into one flat-shaded mesh per kart
export class Parts {
  constructor() { this.P = []; this.C = []; }
  add(geo, col, m) {
    const g = geo.index ? geo.toNonIndexed() : geo; if (m) g.applyMatrix4(m);
    const p = g.attributes.position.array, c = new THREE.Color(col);
    for (let i = 0; i < p.length; i += 3) { this.P.push(p[i], p[i + 1], p[i + 2]); this.C.push(c.r, c.g, c.b); }
  }
  box(w, h, d, x, y, z, col, rx = 0, ry = 0, rz = 0) { this.add(new THREE.BoxGeometry(w, h, d), col, M(x, y, z, rx, ry, rz)); }
  cyl(r0, r1, h, x, y, z, col, rx = 0, ry = 0, rz = 0, seg = 8) { this.add(new THREE.CylinderGeometry(r0, r1, h, seg), col, M(x, y, z, rx, ry, rz)); }
  cone(r, h, x, y, z, col, rx = 0, ry = 0, rz = 0, seg = 5) { this.add(new THREE.ConeGeometry(r, h, seg), col, M(x, y, z, rx, ry, rz)); }
  tri(a, b, c, col) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3)); this.add(g, col); }
  quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); }
  mesh(mat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  }
}
const M = (x, y, z, rx, ry, rz) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));

function wheel(r, w, tyre, rim, iron = false) {
  const g = new THREE.Group(), P = new Parts();
  P.cyl(r, r, w, 0, 0, 0, tyre, Math.PI / 2, 0, 0, 12);
  P.cyl(r * 0.62, r * 0.62, w + 0.02, 0, 0, 0, rim, Math.PI / 2, 0, 0, iron ? 6 : 8);
  if (iron) P.cyl(r * 1.12, r * 1.12, 0.05, 0, 0, w / 2 - 0.03, rim, Math.PI / 2, 0, 0, 12);    // (a mine cart's flange)
  for (let i = 0; i < 4; i++) P.box(r * 1.15, 0.05, w + 0.04, 0, 0, 0, rim, 0, 0, i * Math.PI / 4);   // spokes, so you see it turn
  g.add(P.mesh(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  return g;
}

/** a kart: { group, body (the sprung part), wheels: [{ g, front, r }], steer, seat, exhaust: [Vector3], theme } */
export function buildKart(bodyK = 'kart', themeK = 'sara') {
  const T = THEMES[themeK] || THEMES.sara, P = new Parts(), group = new THREE.Group(), body = new THREE.Group(); group.add(body);
  const { body: B, trim: Tr, acc: A, dark: D } = T, grey = 0x3a3a3e, black = 0x141414, metal = 0x9a9aa2;
  const wheels = [], exhaust = [], decals = [];
  let seat = new THREE.Vector3(-0.32, 0.36, 0), wheelAt = new THREE.Vector3(0.32, 0.78, 0), rw = 0.34, fw = 0.27;
  if (bodyK === 'mine') {
    // an RS mine cart: a riveted iron-banded tub on flanged iron wheels, a lantern up front, a pickaxe strapped on
    const yb = 0.24, yt = 1.0, bx = 0.95, bz = 0.52, tx = 1.18, tz = 0.7;
    const c = (x, y, z) => [x, y, z];
    const b0 = c(-bx, yb, -bz), b1 = c(bx, yb, -bz), b2 = c(bx, yb, bz), b3 = c(-bx, yb, bz), t0 = c(-tx, yt, -tz), t1 = c(tx, yt, -tz), t2 = c(tx, yt, tz), t3 = c(-tx, yt, tz);
    P.quad(b0, b1, t1, t0, B); P.quad(b2, b3, t3, t2, B); P.quad(b1, b2, t2, t1, B); P.quad(b3, b0, t0, t3, B); P.quad(b0, b3, b2, b1, D);
    for (const y of [0.4, 0.8]) { const u = (y - yb) / (yt - yb), x = bx + (tx - bx) * u + 0.02, z = bz + (tz - bz) * u + 0.02; P.box(x * 2, 0.07, 0.04, 0, y, -z, Tr); P.box(x * 2, 0.07, 0.04, 0, y, z, Tr); P.box(0.04, 0.07, z * 2, x, y, 0, Tr); P.box(0.04, 0.07, z * 2, -x, y, 0, Tr); }
    P.box(tx * 2 + 0.1, 0.08, 0.1, 0, yt, -tz, Tr); P.box(tx * 2 + 0.1, 0.08, 0.1, 0, yt, tz, Tr); P.box(0.1, 0.08, tz * 2, tx, yt, 0, Tr); P.box(0.1, 0.08, tz * 2, -tx, yt, 0, Tr);   // the rim
    P.box(0.16, 0.2, 0.16, tx + 0.08, yt - 0.05, 0, black); P.box(0.12, 0.14, 0.12, tx + 0.1, yt - 0.05, 0, 0xffe070);   // lantern
    P.cyl(0.03, 0.03, 1.3, 0, 0.62, tz + 0.08, 0x6a4a28, 0, 0, Math.PI / 2 - 0.25); P.box(0.08, 0.06, 0.5, 0.55, 0.78, tz + 0.08, 0x3d6c8a, 0, 0, -0.25);   // the pickaxe
    for (const [x, z] of [[-0.62, -0.62], [0.62, -0.62], [-0.62, 0.62], [0.62, 0.62]]) wheels.push({ g: wheel(0.3, 0.16, 0x2a2a2a, metal, true), x, z, r: 0.3, front: x > 0 });
    seat = new THREE.Vector3(-0.35, 0.42, 0); wheelAt = new THREE.Vector3(0.45, 0.92, 0);
    exhaust.push(new THREE.Vector3(-tx - 0.1, 0.5, 0));
    decals.push([new THREE.Vector3(0, 0.62, -0.62), 0.5, -Math.PI / 2 + 0, 'side'], [new THREE.Vector3(0, 0.62, 0.62), 0.5, 0, 'side2'], [new THREE.Vector3(1.08, 0.62, 0), 0.42, 0, 'front']);
  } else {
    // the go-kart (and the dragon racer's chassis): a floor pan, side pods, an engine, a spoiler
    P.box(2.2, 0.08, 1.0, -0.05, 0.2, 0, D);
    for (const s of [-1, 1]) { P.box(1.25, 0.3, 0.32, -0.1, 0.34, s * 0.62, B); P.box(1.27, 0.06, 0.34, -0.1, 0.5, s * 0.62, Tr); P.box(0.3, 0.22, 0.3, 0.62, 0.3, s * 0.6, B, 0, s * 0.35, 0); }
    P.box(0.5, 0.1, 0.5, -0.32, 0.32, 0, D); P.box(0.1, 0.62, 0.56, -0.6, 0.62, 0, D, 0, 0, 0.22); P.box(0.06, 0.66, 0.6, -0.64, 0.62, 0, Tr, 0, 0, 0.22);   // seat
    P.box(0.5, 0.36, 0.56, -0.95, 0.45, 0, grey); P.box(0.3, 0.12, 0.3, -0.95, 0.68, 0, metal);    // engine
    for (const s of [-1, 1]) { P.cyl(0.06, 0.07, 0.5, -1.25, 0.52, s * 0.16, metal, 0, 0, Math.PI / 2 + 0.25); exhaust.push(new THREE.Vector3(-1.5, 0.58, s * 0.16)); }
    P.box(0.34, 0.05, 1.5, -1.22, 1.02, 0, Tr); for (const s of [-1, 1]) { P.box(0.4, 0.34, 0.04, -1.2, 0.95, s * 0.75, B); P.box(0.05, 0.45, 0.05, -1.12, 0.75, s * 0.35, black); }   // spoiler
    P.cyl(0.04, 0.04, 2.0, 0.85, 0.27, 0, black, Math.PI / 2); P.cyl(0.05, 0.05, 1.7, -0.8, 0.34, 0, black, Math.PI / 2);   // axles
    if (bodyK === 'dragon') {
      // a dragon's head for a nose, horns, eyes that glow; wings for side fins; a tail sweeping up into the spoiler
      P.box(0.75, 0.32, 0.62, 0.95, 0.42, 0, B); P.box(0.5, 0.18, 0.5, 1.45, 0.38, 0, B); P.box(0.48, 0.1, 0.46, 1.42, 0.24, 0, D, 0, 0, 0.12);   // head, snout, jaw
      for (const s of [-1, 1]) { P.cone(0.07, 0.4, 0.82, 0.72, s * 0.22, A, 0, 0, 0.9); P.box(0.06, 0.08, 0.1, 1.28, 0.5, s * 0.2, 0xffe040); P.cone(0.04, 0.12, 1.66, 0.36, s * 0.12, 0xffffff, 0, 0, -Math.PI / 2); }
      for (const s of [-1, 1]) { P.tri([0.3, 0.52, s * 0.75], [-0.7, 0.52, s * 0.78], [-0.4, 0.95, s * 1.25], Tr); P.tri([-0.7, 0.52, s * 0.78], [-0.9, 0.55, s * 0.8], [-0.4, 0.95, s * 1.25], A); }
      for (let i = 0; i < 4; i++) P.box(0.18, 0.14 - i * 0.02, 0.18 - i * 0.03, -1.0 - i * 0.12, 0.62 + i * 0.12, 0, B, 0, 0, 0.6);
      decals.push([new THREE.Vector3(-0.1, 0.42, -0.79), 0.32, 0, 'side'], [new THREE.Vector3(-0.1, 0.42, 0.79), 0.32, 0, 'side2'], [new THREE.Vector3(1.0, 0.585, 0), 0.4, 0, 'top']);
    } else {
      P.box(0.62, 0.22, 0.86, 0.95, 0.32, 0, B); P.box(0.4, 0.06, 0.88, 1.0, 0.45, 0, Tr, 0, 0, -0.18); P.box(0.08, 0.1, 1.1, 1.32, 0.24, 0, A);   // nose, its stripe, the bumper
      decals.push([new THREE.Vector3(-0.1, 0.34, -0.785), 0.28, 0, 'side'], [new THREE.Vector3(-0.1, 0.34, 0.785), 0.28, 0, 'side2'], [new THREE.Vector3(0.95, 0.435, 0), 0.36, 0, 'top']);
    }
    for (const [x, z, r, w, f] of [[-0.8, -0.72, rw, 0.32, false], [-0.8, 0.72, rw, 0.32, false], [0.85, -0.68, fw, 0.24, true], [0.85, 0.68, fw, 0.24, true]]) wheels.push({ g: wheel(r, w, 0x1a1a1a, A), x, z, r, front: f });
  }
  // the god's own touches
  if (T.sym === 'zam') for (const s of [-1, 1]) P.cone(0.06, 0.34, bodyK === 'mine' ? -1.1 : -1.2, bodyK === 'mine' ? 1.18 : 1.24, s * 0.7, 0xe8e0c8, 0, 0, s * 0.3);
  if (T.sym === 'bandos') for (let i = -2; i <= 2; i++) P.cone(0.05, 0.2, bodyK === 'mine' ? 1.22 : 1.38, 0.3, i * 0.2, metal, 0, 0, -Math.PI / 2);
  if (T.sym === 'arma') for (const s of [-1, 1]) for (let i = 0; i < 3; i++) P.tri([-0.6 - i * 0.18, 0.55, s * 0.8], [-0.9 - i * 0.18, 0.55, s * 0.8], [-1.2 - i * 0.2, 0.9 + i * 0.1, s * (0.95 + i * 0.08)], i % 2 ? Tr : 0xffffff);
  if (T.sym === 'sara') P.cone(0.1, 0.3, bodyK === 'mine' ? 0 : -1.22, bodyK === 'mine' ? 1.2 : 1.2, 0, A, 0, 0, 0, 4);
  if (T.sym === 'guthix') for (const s of [-1, 1]) P.box(0.9, 0.05, 0.08, -0.1, bodyK === 'mine' ? 1.04 : 0.56, s * (bodyK === 'mine' ? 0.72 : 0.79), 0x5a9a3a);
  // the steering wheel
  const steer = new THREE.Group(); steer.position.copy(wheelAt); steer.rotation.order = 'ZYX'; steer.rotation.z = TILT;   // (x then spins it about its own column)
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.7, 6), new THREE.MeshLambertMaterial({ color: black, flatShading: true })); col.rotation.z = -Math.PI / 2; col.position.x = 0.35; steer.add(col);   // the column, down to the floor
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.03, 5, 12), new THREE.MeshLambertMaterial({ color: black, flatShading: true })); ring.rotation.y = Math.PI / 2; steer.add(ring);
  const hub = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.3), new THREE.MeshLambertMaterial({ color: A })); steer.add(hub);
  body.add(steer);
  const mat = T.glass ? new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.82, emissive: 0x1a4a5a })
    : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: T.sym === 'zaros' ? 0x1a0628 : 0x000000 });
  body.add(P.mesh(mat));
  // the god's symbol, painted on (a decal just off the surface)
  const tex = symbol(T.sym, T.acc, T.dark), dm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const [p, s, , k] of decals) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(s, 20), dm); m.position.copy(p);
    if (k === 'top') m.rotation.x = -Math.PI / 2; else if (k === 'front') m.rotation.y = Math.PI / 2; else if (k === 'side') m.rotation.y = Math.PI;
    body.add(m);
  }
  for (const w of wheels) { w.g.position.set(w.x, w.r, w.z); group.add(w.g); }
  return { group, body, wheels, steer, seat, wheelAt, exhaust, theme: T, bodyK };
}

// ---------------------------------------------------------------- the driver
const drivers = new Map();
/** an RS player sat at the wheel: items = { slot: item id } (god armour to match the kart, or your own outfit) */
export async function buildDriver(items, kart, g = 0) {
  const key = JSON.stringify(items) + g;
  if (!drivers.has(key)) drivers.set(key, (async () => {
    const model = await buildOutfitModel({ g, items, kits: {} });
    const skin = buildRagSkin(model);
    const fcol = new Uint8Array(model.geo.attributes.color.array.length); model.geo.attributes.color.array.forEach((c, j) => { fcol[j] = Math.round(c * 255); });
    model.play('ready'); model.update(0);
    const P0 = clipJoints(skin, model, model.cur >= 0 ? model.cur : 1);
    const F0 = skin.full, fx = (F0[15][0] + F0[16][0]) / 2 - (F0[J.lFt][0] + F0[J.rFt][0]) / 2, fz = (F0[15][2] + F0[16][2]) / 2 - (F0[J.lFt][2] + F0[J.rFt][2]) / 2, fl = Math.hypot(fx, fz) || 1;
    return { model, skin, fcol, P0, fwd: [fx / fl, 0, fz / fl] };
  })());
  const p = await drivers.get(key);
  const m = new RSModel(p.model.meta, p.model.frames, p.model.faces, p.fcol);
  m.mesh.material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true });
  placeWheel(p, kart);
  const sat = seated(p, kart);
  m.setVerts(sat.verts);
  const poses = new Map(); let cur = 0;
  /** turn the wheel: the hands go round with it (poses cached in tenths of lock) */
  const steer = v => { const q = Math.round(Math.max(-1, Math.min(1, v)) * 10); if (q === cur) return; cur = q; if (!poses.has(q)) poses.set(q, seated(p, kart, q / 10).verts); m.setVerts(poses.get(q)); };
  const g2 = new THREE.Group(); g2.add(m.group);
  const th = g2.rotation.y = Math.atan2(p.fwd[2], p.fwd[0]);      // model forward -> +x
  const [px, py, pz] = sat.pel, c = Math.cos(th), s = Math.sin(th);   // (the pelvis lands on the seat)
  g2.position.set(kart.seat.x - (px * c + pz * s), kart.seat.y - py, kart.seat.z - (-px * s + pz * c));
  return { group: g2, model: m, p, sat, steer };
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len = a => Math.hypot(a[0], a[1], a[2]), norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** sit the standing pose down: thighs out level, shins down to the pedals, hands to the wheel (model space) */
/** the sat-down body (model space): thighs out level, shins down to the pedals, sat back a little. Arms still to do */
function seatPose(p) {
  const P = p.P0.slice(0, 15).map(v => v.slice()), F = p.fwd, U = [0, 1, 0], full = p.skin.full;
  const L = (a, b) => len(sub(full[a], full[b]));
  const lean = 0.18;
  for (const j of [J.head, J.neck, J.lSh, J.rSh, J.lEl, J.rEl, J.lHa, J.rHa]) P[j] = add(P[j], mul(F, -lean * (P[j][1] - P[J.pelvis][1])));
  for (const sd of ['l', 'r']) {
    const hip = P[J[sd + 'Hip']], th = L(J[sd + 'Kn'], J[sd + 'Hip']), sh = L(J[sd + 'Ft'], J[sd + 'Kn']);
    const knee = add(add(hip, mul(F, th * 0.96)), mul(U, th * 0.22)); P[J[sd + 'Kn']] = knee;
    P[J[sd + 'Ft']] = add(add(knee, mul(F, sh * 0.55)), mul(U, -sh * 0.8));
  }
  return P;
}
/** move this kart's wheel to where this driver holds it: out in front of the chest and down a little, the arms bent
 * (an arm's reach x 0.82 from each shoulder to its grip), so the hands are on the rim, never reaching for it */
function placeWheel(p, kart) {
  const P = seatPose(p), F = p.fwd, U = [0, 1, 0], R = norm(cross(F, U)), full = p.skin.full, pel = P[J.pelvis];
  const M2K = q => { const d = sub(q, pel); return [kart.seat.x + d[0] * F[0] + d[1] * F[1] + d[2] * F[2], kart.seat.y + d[1], kart.seat.z + d[0] * R[0] + d[1] * R[1] + d[2] * R[2]]; };
  const sl = M2K(P[J.lSh]), sr = M2K(P[J.rSh]), mid = mul(add(sl, sr), 0.5), half = Math.abs(sl[2] - sr[2]) / 2;
  const reach = len(sub(full[J.lEl], full[J.lSh])) + len(sub(full[J.lHa], full[J.lEl])), want = reach * 0.82, dz = half - RIM;
  const dist = Math.sqrt(Math.max(0.01, want * want - dz * dz)), dn = 0.62;   // (out at ~35 degrees below the shoulders)
  kart.wheelAt.set(mid[0] + dist * Math.cos(dn), mid[1] - dist * Math.sin(dn), 0);
  kart.steer.position.copy(kart.wheelAt);
}
function seated(p, kart, steer = 0) {
  const P = seatPose(p), F = p.fwd, U = [0, 1, 0], R = norm(cross(F, U)), full = p.skin.full;
  const L = (a, b) => len(sub(full[a], full[b]));
  // the hands on the rim, from kart space to model space (kart x = the model's forward F, y = up U, z = its right R;
  // the pelvis sits on the seat)
  const pel = P[J.pelvis], K2M = q => add(add(add(pel, mul(F, q[0] - kart.seat.x)), mul(U, q[1] - kart.seat.y)), mul(R, q[2] - kart.seat.z));
  for (const sd of ['l', 'r']) {
    const sh = P[J[sd + 'Sh']], side = Math.sign((sh[0] - pel[0]) * R[0] + (sh[2] - pel[2]) * R[2]) || (sd === 'l' ? -1 : 1);
    const tgt = K2M(gripAt(kart, side, steer));
    const { mid, end } = ik2(sh, tgt, L(J[sd + 'El'], J[sd + 'Sh']), L(J[sd + 'Ha'], J[sd + 'El']), add(mul(U, -1), mul(R, side)));
    P[J[sd + 'El']] = mid; P[J[sd + 'Ha']] = end;
    (p.reach ||= {})[sd] = [len(sub(tgt, sh)), L(J[sd + 'El'], J[sd + 'Sh']) + L(J[sd + 'Ha'], J[sd + 'El'])];   // (dev: how far the grip is vs the arm)
  }
  const verts = poseRagSkin(p.skin, P).slice();
  return { verts, pel };
}
