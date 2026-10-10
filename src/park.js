// Create-a-Park (client): the rails, ledges and kickers everyone has built (shapes in src/park-shape.js, kept
// by serve.ts in data/parks.json). Each one goes into the World as grindable rails and collision walls or as a
// ramp on the ground, and into the scene as a mesh. P opens build mode: a ghost piece sits in front of the
// board, 1/2/3 pick rail/ledge/kicker, [ and ] change the length, R turns it, F builds it, Backspace removes
// the nearest piece of yours.
import * as THREE from 'three';
import { PARK_KINDS, DIRS, footprint, cleanPark } from './park-shape.js';

const COL = { rail: 0x9aa2ad, ledge: 0xb9b3a6, kicker: 0x9c6b3c };

/** world pieces for an object: rails + walls, or a ramp. bx, bz = the world's base tile (game = world - base) */
export function parkPieces(o, w) {
  const K = PARK_KINDS[o.kind], [dx, dz] = DIRS[o.dir], bx = w.base[0], bz = w.base[1];
  // the run along the object's axis in game coords: from the start tile's edge to the far end
  const x0 = o.x - bx + (dx < 0 ? 1 : 0), z0 = o.z - bz + (dz < 0 ? 1 : 0);
  if (o.kind === 'kicker') {
    // the ramp rises from the start edge to the lip, across both tiles of its width
    const tiles = footprint(o).map(([x, z]) => [x - bx, z - bz]);
    return { ramp: { tiles, x0, z0, dx, dz, len: o.len, rise: K.h } };
  }
  const horiz = dz === 0, a0 = horiz ? Math.min(x0, x0 + dx * o.len) : Math.min(z0, z0 + dz * o.len), a1 = a0 + o.len;
  const sx = -dz, sz = dx;                               // across the object
  const lines = o.kind === 'rail' ? [0.5] : [0.02, 0.98]; // a rail down the middle; a ledge grinds on both edges
  const rails = [], segs = [];
  for (const off of lines) {
    // across offset in game coords (side vector points along +s from the start tile's corner)
    const c = horiz ? (o.z - bz) + (sz > 0 ? off : 1 - off) : (o.x - bx) + (sx > 0 ? off : 1 - off);
    const prof = [];
    for (let a = a0; a < a1; a++) for (const f of [0.15, 0.5, 0.85]) {
      const gx = horiz ? a + f : c, gz = horiz ? c : a + f;
      prof.push([a + f, w.height(gx, gz) + K.h]);
    }
    const r = horiz ? { ax: a0, az: c, bx: a1, bz: c } : { ax: c, az: a0, bx: c, bz: a1 };
    Object.assign(r, { horiz, len: o.len, a0, prof, dirx: horiz ? 1 : 0, dirz: horiz ? 0 : 1, minLen: 1, mat: o.kind === 'rail' ? 'metal' : 'stone' });
    rails.push(r);
    for (let a = a0; a < a1; a++) {
      const top = [0.15, 0.5, 0.85].map(f => w.height(horiz ? a + f : c, horiz ? c : a + f) + K.h);
      segs.push(horiz ? { ax: a, az: c, bx: a + 1, bz: c, kind: o.kind === 'rail' ? 'rail' : 'block', top } : { ax: c, az: a, bx: c, bz: a + 1, kind: o.kind === 'rail' ? 'rail' : 'block', top });
    }
  }
  if (o.kind === 'ledge') {                              // the two short ends
    const c0 = horiz ? Math.min(...rails.map(r => r.az)) : Math.min(...rails.map(r => r.ax)), c1 = horiz ? Math.max(...rails.map(r => r.az)) : Math.max(...rails.map(r => r.ax));
    for (const a of [a0, a1]) {
      const top = [0.15, 0.5, 0.85].map(() => w.height(horiz ? a : (c0 + c1) / 2, horiz ? (c0 + c1) / 2 : a) + K.h);
      segs.push(horiz ? { ax: a, az: c0, bx: a, bz: c1, kind: 'block', top } : { ax: c0, az: a, bx: c1, bz: a, kind: 'block', top });
    }
  }
  return { rails, segs };
}

/** a mesh for an object (three.js coords: x, y, -z) */
export function parkMesh(o, w, ghost = false) {
  const K = PARK_KINDS[o.kind], [dx, dz] = DIRS[o.dir], bx = w.base[0], bz = w.base[1];
  const mat = ghost ? new THREE.MeshBasicMaterial({ color: 0x33ffaa, transparent: true, opacity: 0.45, depthWrite: false })
    : new THREE.MeshLambertMaterial({ color: COL[o.kind], flatShading: true, side: THREE.DoubleSide });
  const g = new THREE.Group();
  const tiles = footprint(o);
  const cx = tiles.reduce((s, t) => s + t[0], 0) / tiles.length + 0.5 - bx, cz = tiles.reduce((s, t) => s + t[1], 0) / tiles.length + 0.5 - bz;
  const gy = w.height(cx, cz), along = o.len, wide = K.wide, yaw = Math.atan2(dz, dx);
  const box = (lx, ly, lz, px, py, pz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(lx, ly, lz), mat); m.position.set(px, py, pz); g.add(m); return m;
  };
  if (o.kind === 'rail') {
    box(along, 0.05, 0.05, 0, K.h - 0.025, 0);
    for (let i = 0; i < Math.max(2, Math.round(along / 2) + 1); i++) box(0.04, K.h - 0.05, 0.04, -along / 2 + 0.25 + i * (along - 0.5) / Math.max(1, Math.round(along / 2)), (K.h - 0.05) / 2, 0);
  } else if (o.kind === 'ledge') {
    box(along, K.h, wide * 0.96, 0, K.h / 2, 0);
    if (!ghost) { const e = box(along, 0.03, wide * 0.98, 0, K.h, 0); e.material = new THREE.MeshLambertMaterial({ color: 0x8a8f96, flatShading: true }); }
  } else {
    // wedge: rises along +x (the object's dir)
    const L = along / 2, W = wide / 2, H = K.h;
    const v = [-L, 0, -W, L, 0, -W, L, H, -W, -L, 0, W, L, 0, W, L, H, W];
    const idx = [0, 1, 2, 3, 5, 4, 0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2, 0, 2, 5, 0, 5, 3];
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); geo.setIndex(idx);
    g.add(new THREE.Mesh(geo.toNonIndexed(), mat));
  }
  // in three.js the game's +z is -z: yaw about y by the game angle, mirrored
  g.rotation.y = yaw; g.position.set(cx, gy + 0.005, -cz);
  g.traverse(m => { if (m.isMesh) { m.castShadow = !ghost; m.receiveShadow = !ghost; } });
  return g;
}

export class Parks {
  constructor({ scene, world, lighting, net, hud, me }) {
    Object.assign(this, { scene, world, lighting, net, hud, me });
    this.objs = new Map();                               // id -> { o, mesh }
    this.pending = []; this.retryT = 0;                  // pieces in land that hasn't streamed in yet
    this.build = false; this.kind = 'rail'; this.len = 4; this.turn = 0; this.ghost = null; this.ghostKey = '';
  }
  load(list) { for (const id of [...this.objs.keys()]) this.remove(id); this.pending = []; for (const o of list || []) this.add(o); }
  add(o) {
    if (this.objs.has(o.id)) return;
    const w = this.world;
    if (!footprint(o).every(([x, z]) => w.isLive(x - w.base[0], z - w.base[1]))) { if (!this.pending.some(p => p.id === o.id)) this.pending.push(o); return; }
    const pieces = parkPieces(o, this.world), mesh = parkMesh(o, this.world);
    this.world.addPark(o.id, pieces); this.scene.add(mesh);
    mesh.traverse(m => { if (m.isMesh) this.lighting?.add(m, 'solid'); });
    this.objs.set(o.id, { o, mesh });
  }
  remove(id) {
    this.pending = this.pending.filter(p => p.id !== id);
    const e = this.objs.get(id); if (!e) return;
    this.world.removePark(id); this.scene.remove(e.mesh);
    e.mesh.traverse(m => { if (m.isMesh) { this.lighting?.meshes.delete(m); m.geometry.dispose(); } });
    this.objs.delete(id);
  }
  mine() { return [...this.objs.values()].filter(e => e.o.by === this.me.name); }

  toggle() { this.build = !this.build; if (!this.build) this.clearGhost(); return this.build; }
  clearGhost() { if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; this.ghostKey = ''; } }
  /** the piece build mode would place: just ahead of the board, squared to the nearest compass direction */
  candidate(sk) {
    const K = PARK_KINDS[this.kind], w = this.world;
    const a = Math.round(sk.heading / (Math.PI / 2)) & 3, dir = (a + this.turn) & 3, [dx, dz] = DIRS[dir];
    const fx = Math.cos(sk.heading), fz = Math.sin(sk.heading);
    const len = Math.max(K.min, Math.min(K.max, this.len));
    // start 2 tiles ahead; kickers face you (rise away from you), rails and ledges run along your line
    const sx = Math.floor(sk.x + fx * 2.5 + w.base[0]), sz = Math.floor(sk.z + fz * 2.5 + w.base[1]);
    return { kind: this.kind, x: sx, z: sz, dir, len };
  }
  /** why this piece can't go here, or null */
  blocked(o) {
    const c = cleanPark(o); if (!c) return 'too close to a portal';
    const w = this.world, taken = new Set([...this.objs.values()].flatMap(e => footprint(e.o).map(t => t.join(','))));
    for (const [tx, tz] of footprint(c)) {
      const gx = tx - w.base[0], gz = tz - w.base[1];
      if (!w.isLive(gx, gz) || w.tileKind(gx + 0.5, gz + 0.5) !== 0) return 'needs open ground';
      if (taken.has(tx + ',' + tz)) return 'something is already built there';
    }
    return null;
  }
  update(sk, dt) {
    if (this.pending.length && (this.retryT -= dt) <= 0) { this.retryT = 1; for (const o of this.pending.splice(0)) this.add(o); }
    if (!this.build) return;
    const o = this.candidate(sk), why = this.blocked(o), key = JSON.stringify(o) + !!why;
    if (key !== this.ghostKey) {
      this.clearGhost(); this.ghostKey = key;
      this.ghost = parkMesh(o, this.world, true);
      this.ghost.traverse(m => { if (m.isMesh) m.material.color.set(why ? 0xff4040 : 0x33ffaa); });
      this.scene.add(this.ghost);
    }
    this.why = why;
  }
  place(sk) {
    const o = this.candidate(sk), why = this.blocked(o);
    if (why) { this.hud.pop("CAN'T BUILD: " + why.toUpperCase(), '#f80'); return; }
    if (!this.net.online) { this.hud.pop('BUILDING NEEDS THE SERVER', '#f80'); return; }
    this.net.send({ t: 'park', op: 'add', o });
  }
  removeNearest(sk) {
    const w = this.world; let best = null, bd = 6;
    for (const e of this.objs.values()) {
      if (e.o.by !== this.me.name && !this.me.own) continue;
      for (const [tx, tz] of footprint(e.o)) { const d = Math.hypot(tx + 0.5 - w.base[0] - sk.x, tz + 0.5 - w.base[1] - sk.z); if (d < bd) { bd = d; best = e; } }
    }
    if (!best) { this.hud.pop('NONE OF YOUR PIECES NEARBY', '#f80'); return; }
    this.net.send({ t: 'park', op: 'del', id: best.o.id });
  }
  /** build-mode keys; true if the key was used */
  key(k, sk) {
    if (!this.build) return false;
    if (k === '1' || k === '2' || k === '3') { this.kind = ['rail', 'ledge', 'kicker'][+k - 1]; const K = PARK_KINDS[this.kind]; this.len = Math.max(K.min, Math.min(K.max, this.len)); return true; }
    if (k === '[') { this.len = Math.max(PARK_KINDS[this.kind].min, this.len - 1); return true; }
    if (k === ']') { this.len = Math.min(PARK_KINDS[this.kind].max, this.len + 1); return true; }
    if (k === 'r') { this.turn = (this.turn + 1) & 3; return true; }
    if (k === 'f') { this.place(sk); return true; }
    if (k === 'backspace' || k === 'delete') { this.removeNearest(sk); return true; }
    return false;
  }
  status() {
    if (!this.build) return null;
    const K = PARK_KINDS[this.kind];
    return `BUILD: ${K.label} x${this.len}  ·  1 rail 2 ledge 3 kicker  ·  [ ] length  ·  R turn  ·  F build  ·  Backspace remove  ·  P done  (${this.mine().length}/12)` + (this.why ? `  ·  ${this.why}` : '');
  }
}
