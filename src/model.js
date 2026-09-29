// RS animated models (1:1 frames from the game cache) + the skateboard.
import * as THREE from 'three';

const modelCache = new Map();
export async function loadRSModel(name) {
  // all four parts in parallel: over a tunnel each round trip is ~0.5 s, so serial fetches added up fast
  const buf = ext => fetch(`assets/${name}.${ext}`).then(r => r.arrayBuffer());
  if (!modelCache.has(name)) modelCache.set(name, Promise.all([
    fetch(`assets/${name}.json`).then(r => r.json()),
    buf('frames.bin').then(b => new Float32Array(b)),
    buf('faces.bin').then(b => new Uint32Array(b)),
    buf('fcol.bin').then(b => new Uint8Array(b)),
  ]));
  const [meta, frames, faces, fcol] = await modelCache.get(name);
  return new RSModel(meta, frames, faces, fcol);
}

export class RSModel {
  constructor(meta, frames, faces, fcol) {
    this.meta = meta; this.frames = frames; this.faces = faces; this.nv = meta.verts;
    const nc = faces.length;
    this.pos = new Float32Array(nc * 3);
    const col = new Float32Array(nc * 3);
    for (let i = 0; i < nc * 3; i++) col[i] = fcol[i] / 255;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geo = g;
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true }));
    this.mesh.frustumCulled = false;
    this.group = new THREE.Group(); this.group.add(this.mesh);
    this.cur = -1;
    this.clip = null; this.clipT = 0; this.loop = true;
    this.feet = new Map();
    this.setFrame(1);
  }

  setFrame(fi) {
    if (fi === this.cur) return;
    this.cur = fi;
    const f = this.frames, o = fi * this.nv * 3, F = this.faces, p = this.pos;
    for (let i = 0; i < F.length; i++) {
      const v = o + F[i] * 3;
      p[i * 3] = f[v]; p[i * 3 + 1] = f[v + 1]; p[i * 3 + 2] = f[v + 2];
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeBoundingSphere();
  }

  /** centroid (x, z) of the lowest vertices of a frame = where the feet are */
  footOffset(fi) {
    if (!this.feet.has(fi)) {
      const f = this.frames, o = fi * this.nv * 3;
      let ymin = Infinity;
      for (let v = 0; v < this.nv; v++) ymin = Math.min(ymin, f[o + v * 3 + 1]);
      let sx = 0, sz = 0, n = 0;
      for (let v = 0; v < this.nv; v++) if (f[o + v * 3 + 1] < ymin + 0.12) { sx += f[o + v * 3]; sz += f[o + v * 3 + 2]; n++; }
      this.feet.set(fi, [sx / n, sz / n, ymin]);
    }
    return this.feet.get(fi);
  }

  play(label, loop = true, restart = false) {
    if (this.clip === label && !restart) return;
    this.clip = label; this.clipT = 0; this.loop = loop;
  }

  /** advance the current clip with the RS 20 ms delay unit */
  update(dt) {
    const a = this.meta.anims[this.clip];
    if (!a) return;
    this.clipT += dt;
    let t = this.clipT / 0.02;
    const total = a.delay.reduce((s, d) => s + Math.max(1, d), 0);
    if (this.loop) t %= total; else t = Math.min(t, total - 0.001);
    let i = 0;
    while (i < a.frames.length - 1 && t >= Math.max(1, a.delay[i])) { t -= Math.max(1, a.delay[i]); i++; }
    this.setFrame(a.frames[i]);
  }

  get done() {
    const a = this.meta.anims[this.clip];
    return !a || this.clipT / 0.02 >= a.delay.reduce((s, d) => s + Math.max(1, d), 0);
  }
}

// ---------------------------------------------------------------- skateboard (RS-style low poly)
const LIGHT = new THREE.Vector3(-0.35, 0.82, 0.45).normalize();
export const L_BOARD = 0.92, W_BOARD = 0.24, DECK_Z = 0.075, DECK_T = 0.014, TOP_Z = DECK_Z + DECK_T;

export function buildBoard() {
  // local frame: +x = nose, +y = up, z across; origin at wheel contact
  const pos = [], col = [];
  const lit = (base, n) => { const k = 0.45 + 0.65 * Math.max(0, n.dot(LIGHT)) + 0.1 * Math.max(0, -n.dot(LIGHT)); return base.map(c => Math.min(255, c * k) / 255); };
  const tri = (a, b, c, base) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const cc = lit(base, n.y < 0 ? n.clone().negate() : n);
    for (const p of [a, b, c]) { pos.push(p.x, p.y, p.z); col.push(...cc); }
  };
  const quad = (a, b, c, d, base) => { tri(a, b, c, base); tri(a, c, d, base); };
  const half = L_BOARD / 2;
  const xs = [-half, -half * 0.9, -half * 0.72, -half * 0.55, 0, half * 0.55, half * 0.72, half * 0.9, half];
  const lift = x => { const u = (Math.abs(x) - half * 0.6) / (half * 0.4); return u <= 0 ? 0 : 0.07 * Math.pow(u, 1.6); };
  const width = x => { const u = Math.abs(x) / half; return W_BOARD / 2 * (u < 0.82 ? 1 : Math.sqrt(Math.max(0.05, 1 - ((u - 0.82) / 0.18) ** 2))); };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const T = [], B = [];
  for (const x of xs) {
    const y = DECK_Z + lift(x), w = width(x);
    T.push([V(x, y + DECK_T, -w), V(x, y + DECK_T - 0.004, 0), V(x, y + DECK_T, w)]);
    B.push([V(x, y, -w), V(x, y - 0.004, 0), V(x, y, w)]);
  }
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < 2; j++) {
      const g = ((i + j) % 3) ? [34, 34, 36] : [48, 48, 50];
      quad(T[i][j], T[i + 1][j], T[i + 1][j + 1], T[i][j + 1], g);
      const cx = (xs[i] + xs[i + 1]) / 2, u = (cx + half) / L_BOARD;
      const flame = 0.55 + 0.25 * Math.sin((j - 0.5) * 0.12 * 70 + u * 9);
      const gfx = u > flame ? [205, 30, 25] : [255, 205, 20];
      quad(B[i][j], B[i][j + 1], B[i + 1][j + 1], B[i + 1][j], gfx);
    }
    for (const s of [0, 2]) quad(T[i][s], T[i + 1][s], B[i + 1][s], B[i][s], [150, 95, 50]);
  }
  for (const [t, b] of [[T[0], B[0]], [T[T.length - 1], B[B.length - 1]]])
    for (let j = 0; j < 2; j++) quad(t[j], t[j + 1], b[j + 1], b[j], [150, 95, 50]);
  const box = (x0, x1, y0, y1, z0, z1, c) => {
    const p = [V(x0, y0, z0), V(x1, y0, z0), V(x1, y0, z1), V(x0, y0, z1), V(x0, y1, z0), V(x1, y1, z0), V(x1, y1, z1), V(x0, y1, z1)];
    for (const q of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) quad(p[q[0]], p[q[1]], p[q[2]], p[q[3]], c);
  };
  const wheel = (cx, cz, r = 0.028, w = 0.03, seg = 8) => {
    const a = [], b = [];
    for (let k = 0; k < seg; k++) { const t = 2 * Math.PI * k / seg; a.push(V(cx + r * Math.cos(t), r + r * Math.sin(t), cz - w / 2)); b.push(V(cx + r * Math.cos(t), r + r * Math.sin(t), cz + w / 2)); }
    for (let k = 1; k < seg - 1; k++) { tri(a[0], a[k], a[k + 1], [238, 232, 210]); tri(b[0], b[k + 1], b[k], [238, 232, 210]); }
    for (let k = 0; k < seg; k++) quad(a[k], b[k], b[(k + 1) % seg], a[(k + 1) % seg], [238, 232, 210]);
  };
  for (const tx of [-half * 0.62, half * 0.62]) {
    box(tx - 0.025, tx + 0.025, 0.045, DECK_Z, -0.03, 0.03, [170, 172, 178]);
    box(tx - 0.012, tx + 0.012, 0.022, 0.036, -0.095, 0.095, [170, 172, 178]);
    wheel(tx, -0.095); wheel(tx, 0.095);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true }));
  // hierarchy: yaw -> pitch -> roll(flip, about the long axis through the deck centre)
  const yaw = new THREE.Group(), pitch = new THREE.Group(), roll = new THREE.Group();
  roll.position.y = DECK_Z; mesh.position.y = -DECK_Z;
  yaw.add(pitch); pitch.add(roll); roll.add(mesh);
  return { root: yaw, pitch, roll, mesh };
}
