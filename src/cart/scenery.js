// CartScape's scenery: the world pack round the track (cut by tools/cart-track.ts), and everything built for the race
// on top of it: the road (RS-tiled stone, red and white kerbs on the corners), the fence and hay bales, the bridge
// deck, the plank ramps, the start/finish gantry, the god arches, boost pads, item boxes, and the obstacles (Lumbridge's
// cows and chickens wandering over, swinging blades, boulders rolling across). Three coords: (x, y, -z).
import * as THREE from 'three';
import { S } from './track.js';
import { THEMES, symbol, Parts } from './models.js';
import { loadRSModel } from '../model.js';

export const FENCE = 4.95;                                        // the fence line, off the road edge (karts stop at hw + 3.6)
const V = (x, y, z) => [x, y, -z];
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/** the cut world pack: { group } (baked RS colours, unlit, as the skate game draws it) */
export async function loadPack(name, onStatus = () => {}) {
  onStatus('loading Lumbridge...');
  const [pack, bin] = await Promise.all([fetch(`assets/${name}.json`).then(r => r.json()), fetch(`assets/${name}.bin`).then(r => r.arrayBuffer())]);
  const CH = pack.index.chunk, group = new THREE.Group();
  const opaque = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const alpha = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.45, depthWrite: false });
  for (const ch of pack.index.chunks) for (const k of ['terrain', 'locs', 'locs_alpha']) {
    const part = ch[k]; if (!part || !part.n) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Int16Array(bin, part.posOff, part.n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(bin, part.colOff, part.n * 3), 3, true));
    const m = new THREE.Mesh(g, k === 'locs_alpha' ? alpha : opaque);
    m.position.set(ch.cx * CH * S, 0, -ch.cz * CH * S); m.scale.set(S / 128, -1 / 128, -S / 128);
    m.updateMatrix(); m.matrixAutoUpdate = false; if (k === 'locs_alpha') m.renderOrder = 1;
    group.add(m);
  }
  return { group, pack };
}

// ---------------------------------------------------------------- canvas textures
function canvasTex(w, h, draw, repeat = false) {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h }), x = c.getContext('2d'); draw(x, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; } t.anisotropy = 4; return t;
}
const chevrons = () => canvasTex(64, 64, (x, w, h) => {
  x.fillStyle = '#3a1d04'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#ffb000'; x.beginPath(); x.moveTo(8, 44); x.lineTo(32, 20); x.lineTo(56, 44); x.lineTo(56, 60); x.lineTo(32, 36); x.lineTo(8, 60); x.closePath(); x.fill();
  x.fillStyle = '#fff4a0'; x.beginPath(); x.moveTo(14, 46); x.lineTo(32, 28); x.lineTo(50, 46); x.lineTo(50, 50); x.lineTo(32, 33); x.lineTo(14, 50); x.closePath(); x.fill();
}, true);
const banner = (text, sub) => canvasTex(512, 96, (x, w, h) => {
  for (let i = 0; i < 32; i++) for (let j = 0; j < 2; j++) { x.fillStyle = (i + j) % 2 ? '#fff' : '#111'; x.fillRect(i * 16, j * 8, 16, 8); x.fillRect(i * 16, h - 16 + j * 8, 16, 8); }
  x.fillStyle = '#3a2a16'; x.fillRect(0, 16, w, h - 32);
  x.font = 'bold 52px Impact, "Arial Black", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#000'; x.fillText(text, w / 2 + 3, h / 2 + 3); x.fillStyle = '#ff981f'; x.fillText(text, w / 2, h / 2);
});
const chequer = () => canvasTex(64, 16, (x) => { for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) { x.fillStyle = (i + j) % 2 ? '#f4f4f0' : '#141414'; x.fillRect(i * 8, j * 8, 8, 8); } }, true);

// an RS chest (the lid apart: it hinges at the back). Front (the lock) is +z
function chestParts(lid) {
  const B = new Parts(), oak = 0x7a4e26, oak2 = 0x5a3818, iron = 0x5c5c66, gold = 0xe8b830;
  if (!lid) {
    B.box(1.3, 0.72, 0.9, 0, 0.38, 0, oak); for (const y of [0.24, 0.5]) B.box(1.32, 0.04, 0.92, 0, y, 0, oak2);
    for (const x of [-0.46, 0.46]) B.box(0.1, 0.76, 0.94, x, 0.38, 0, iron);
    B.box(1.36, 0.08, 0.96, 0, 0.04, 0, iron);
    B.box(0.26, 0.3, 0.06, 0, 0.6, 0.47, gold); B.box(0.06, 0.12, 0.07, 0, 0.58, 0.48, 0x111111);   // the lock and its keyhole
  } else {                                                          // (in the hinge's space: the back edge at z = 0)
    B.box(1.3, 0.14, 0.92, 0, 0.07, 0.46, oak); B.box(1.3, 0.12, 0.66, 0, 0.2, 0.46, oak); B.box(1.3, 0.1, 0.36, 0, 0.31, 0.46, oak2);
    for (const x of [-0.46, 0.46]) { B.box(0.11, 0.15, 0.94, x, 0.07, 0.46, iron); B.box(0.11, 0.13, 0.68, x, 0.2, 0.46, iron); B.box(0.11, 0.11, 0.38, x, 0.31, 0.46, iron); }
    B.box(0.26, 0.12, 0.06, 0, 0.04, 0.93, gold);
  }
  return B;
}
const glintTex = () => canvasTex(64, 64, (x, w, h) => {
  const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(255,230,140,0.9)'); g.addColorStop(0.25, 'rgba(255,200,80,0.35)'); g.addColorStop(1, 'rgba(255,200,80,0)');
  x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = 'rgba(255,250,220,0.9)'; x.fillRect(w / 2 - 1, 6, 2, h - 12); x.fillRect(6, h / 2 - 1, w - 12, 2);
});
// a chinchompa: grey fluff, a white face, ears and a tail (thrown, it's a grenade)
function chinMesh() {
  const B = new Parts(), grey = 0x8a8a90, white = 0xe8e4dc;
  B.box(0.5, 0.42, 0.44, 0, 0.22, 0, grey); B.box(0.2, 0.26, 0.36, 0.25, 0.24, 0, white); B.box(0.05, 0.06, 0.06, 0.36, 0.3, 0.1, 0x111111); B.box(0.05, 0.06, 0.06, 0.36, 0.3, -0.1, 0x111111);
  for (const z of [-0.14, 0.14]) B.cone(0.08, 0.18, 0.12, 0.5, z, grey, 0, 0, 0, 4);
  B.box(0.3, 0.12, 0.12, -0.32, 0.36, 0, grey, 0, 0, 0.7);
  const m = B.mesh(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  const g = new THREE.Group(); m.position.y = -0.22; g.add(m); g.position.y = 0.22; return g;
}

// ---------------------------------------------------------------- a strip laid on the road (pads, the line, the grid)
function strip(T, s0, s1, d0, d1, lift, step = 0.5) {
  const pos = [], uv = [], idx = [], n = Math.max(1, Math.ceil((s1 - s0) / step));
  for (let i = 0; i <= n; i++) {
    const s = s0 + (s1 - s0) * i / n, y = T.h(s) + lift;
    for (const [d, u] of [[d0, 0], [d1, 1]]) { const p = T.pos(s, d); pos.push(...V(p.x, y, p.z)); uv.push(u, (s - s0) / (s1 - s0)); }
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}

/** everything built for the race. Returns { group, update(t, race) } */
export function buildCourse(T, race) {
  const group = new THREE.Group(), hw = T.hw, N = T.N, F = hw + FENCE;
  const lit = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const flat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const curveAt = new Float32Array(N); for (let i = 0; i < N; i++) curveAt[i] = T.curve(i * T.ds, 6);
  const gap = i => T.flags[(i + N) % N] & 2, ramp = i => T.flags[(i + N) % N] & 4, bridge = i => (T.flags[(i + N) % N] & 3) === 1;
  // where the fence opens: the cow field, and the boulders' path across
  const open = [];
  for (const f of T.feats) { if (f.k === 'cows') open.push([f.s - 4, f.s + (f.span || 50) + 6]); if (f.k === 'boulders') for (const o of [0, 16]) open.push([f.s + o - 3.2, f.s + o + 3.2]); }
  const isOpen = s => open.some(([a, b]) => T.wrap(s - a) < b - a);
  // a line offset past the radius of a tight corner folds back over the road: anything built off the edge has to
  // really be that far from the road everywhere, or it's left out
  const clear = (x, z, s, d) => Math.abs(T.locate(x, z, s).d) > Math.abs(d) - 0.6;

  // ---- the road: RS stone tiles, kerbs, a skirt down into the ground; bridge decks; plank ramps
  const P = [], C = [];
  const pt = (i, d, y) => { i = (i + N) % N; return V(T.x[i] - T.tz[i] * d, y, T.z[i] + T.tx[i] * d); };
  const tri = (a, b, c, col) => { P.push(...a, ...b, ...c); for (let k = 0; k < 3; k++) C.push(col[0], col[1], col[2]); };
  const quad = (a, b, c, d, col) => { tri(a, b, c, col); tri(a, c, d, col); };
  const rgb = (r, g, b) => [r / 255, g / 255, b / 255];
  const across = 9, tileL = 1.5;
  for (let i = 0; i < N; i++) {
    const j = i + 1; if (gap(i) || gap(j)) continue;
    const yi = T.y[i] + 0.02, yj = T.y[j % N] + 0.02, row = Math.floor(i * T.ds / tileL), br = bridge(i) && bridge(j), rp = ramp(i) && ramp(j);
    for (let c = 0; c < across; c++) {
      const d0 = -hw + 2 * hw * c / across, d1 = -hw + 2 * hw * (c + 1) / across, h = hash(row, c) * 14 - 7;
      let col = rp ? ((row + (T.flags[i] & 16 ? 0 : c)) % 2 ? rgb(128 + h, 92 + h, 52 + h) : rgb(110 + h, 78 + h, 44 + h))
        : br ? rgb(122 + h, 96 + h, 64 + h) : rgb(112 + h, 104 + h, 94 + h);
      if (rp && T.flags[i] & 16 && (c === 0 || c === across - 1)) col = row % 2 ? rgb(240, 200, 30) : rgb(30, 26, 20);   // the river ramp's hazard edges
      quad(pt(i, d0, yi), pt(i, d1, yi), pt(j, d1, yj), pt(j, d0, yj), col);
    }
    for (const sd of [-1, 1]) {                                    // kerbs: red and white on the corners, a stone edge on the straights
      const cv = curveAt[i], kerb = Math.abs(cv) > 0.12, out = sd * Math.sign(cv) < 0, k = Math.floor(i * T.ds / 2) % 2;
      const col = kerb ? (k ? rgb(196, 30, 24) : rgb(236, 232, 220)) : rgb(150, 142, 128), kw = kerb && out ? 1.3 : 0.8, ky = kerb ? 0.07 : 0.03;
      quad(pt(i, sd * hw, yi), pt(j, sd * hw, yj), pt(j, sd * (hw + kw), yj + ky), pt(i, sd * (hw + kw), yi + ky), col);
      if (br) {                                                   // the bridge deck out to the railing, then its side and underside
        const e = F + 0.3, dk = rgb(92, 70, 44);
        quad(pt(i, sd * (hw + kw), yi + ky), pt(j, sd * (hw + kw), yj + ky), pt(j, sd * e, yj), pt(i, sd * e, yi), (Math.floor(i / 1.5) % 2) ? rgb(120, 92, 60) : rgb(108, 82, 52));
        quad(pt(i, sd * e, yi), pt(j, sd * e, yj), pt(j, sd * e, yj - 1.1), pt(i, sd * e, yi - 1.1), dk);
        if (sd > 0) quad(pt(i, -e, yi - 1.1), pt(j, -e, yj - 1.1), pt(j, e, yj - 1.1), pt(i, e, yi - 1.1), rgb(60, 46, 30));
      } else if (rp) {                                            // a ramp's side, down to the ground it stands on
        const gi = T.g[i] - 0.3, gj = T.g[j % N] - 0.3; quad(pt(i, sd * hw, yi), pt(j, sd * hw, yj), pt(j, sd * hw, gj), pt(i, sd * hw, gi), rgb(84, 60, 34));
      } else quad(pt(i, sd * (hw + kw), yi + ky), pt(j, sd * (hw + kw), yj + ky), pt(j, sd * (hw + kw), yj - 0.6), pt(i, sd * (hw + kw), yi - 0.6), rgb(86, 72, 52));
    }
    if (rp && T.y[i] - T.y[j % N] > 0.4) quad(pt(j, -hw, yi), pt(j, hw, yi), pt(j, hw, yj), pt(j, -hw, yj), rgb(70, 50, 28));   // the lip's face
  }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); rg.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  const road = new THREE.Mesh(rg, flat); group.add(road);

  // ---- the fence (RS wooden posts and rails), hay bales round the outside of the tight corners, railings on the bridge
  const W = new Parts(), wood = 0x6b4a2a, wood2 = 0x5a3c20, hay = 0xc8a24a, hay2 = 0x9a7a30, stone = 0x8a8478;
  for (const sd of [-1, 1]) {
    let lastPost = -9;
    for (let i = 0; i < N; i++) {
      const s = i * T.ds; if (gap(i) || isOpen(s)) continue;
      const cv = curveAt[i], baleSide = Math.abs(cv) > 0.26 && sd * Math.sign(cv) < 0, br = bridge(i);
      const d = sd * (br ? F + 0.2 : baleSide ? F + 0.4 : F), p = T.pos(s, d), gy = br ? T.y[i] : T.g[i], a = Math.atan2(p.tz, p.tx);
      if (!clear(p.x, p.z, s, d)) continue;
      if (baleSide && !br) { if (i % 2 === 0) { W.box(1.9, 0.9, 1.0, p.x, gy + 0.35, -p.z, (i / 2) % 2 ? hay : hay2, 0, a, 0); if (i % 4 === 0) W.box(1.9, 0.9, 1.0, p.x, gy + 1.25, -p.z, hay, 0, a + 0.05, 0); } continue; }
      if (s - lastPost >= 3 || i === 0) { lastPost = s; W.box(0.24, 2.0, 0.24, p.x, gy + 0.4, -p.z, br ? stone : wood2, 0, a, 0); }
      const q = T.pos(s + T.ds, d), gq = br ? T.y[(i + 1) % N] : T.g[(i + 1) % N];
      if (gap(i + 1) || isOpen(s + T.ds) || !clear(q.x, q.z, s + T.ds, d)) continue;
      for (const hgt of [0.55, 1.15]) { const len = Math.hypot(q.x - p.x, q.z - p.z) + 0.05, mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2, my = (gy + gq) / 2 + hgt; W.box(len, 0.16, 0.08, mx, my, -mz, br ? stone : wood, 0, Math.atan2(q.z - p.z, q.x - p.x), 0); }
    }
  }
  // ---- the start/finish gantry, and the grid
  const fin = T.at(T.finish), fa = Math.atan2(fin.tz, fin.tx), side = F + 1.2;
  for (const sd of [-1, 1]) { const p = T.pos(T.finish, sd * side); W.box(1.2, 9, 1.2, p.x, fin.y + 3.5, -p.z, stone, 0, fa, 0); W.box(1.5, 0.5, 1.5, p.x, fin.y + 8.2, -p.z, 0x6a6458, 0, fa, 0); W.box(1.5, 0.6, 1.5, p.x, fin.y - 0.6, -p.z, 0x6a6458, 0, fa, 0); }
  { const p = T.pos(T.finish, 0); W.box(0.6, 0.6, 2 * side, p.x, fin.y + 7.6, -p.z, wood, 0, fa, 0); }
  group.add(W.mesh(lit));
  { const tex = banner('CARTSCAPE'), m = new THREE.Mesh(new THREE.PlaneGeometry(2 * side - 2, (2 * side - 2) * 96 / 512), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    const p = T.pos(T.finish, 0); m.position.set(p.x, fin.y + 6.4, -p.z); m.rotation.y = fa + Math.PI / 2; group.add(m); }
  const lineMat = new THREE.MeshBasicMaterial({ map: chequer(), polygonOffset: true, polygonOffsetFactor: -2 }); lineMat.map.repeat.set(8, 1);
  group.add(new THREE.Mesh(strip(T, T.finish - 0.8, T.finish + 0.8, -hw, hw, 0.04), lineMat));
  const gridMat = new THREE.MeshBasicMaterial({ color: 0xf0ece0, polygonOffset: true, polygonOffsetFactor: -2 });
  for (let i = 0; i < 8; i++) { const s = T.finish - 6 - i * 4.2 + 1.3, d = (i % 2 ? -1 : 1) * hw * 0.32; group.add(new THREE.Mesh(strip(T, s, s + 0.3, d - 1.2, d + 1.2, 0.04), gridMat)); }

  // ---- the god arches: stone pillars banded in the god's colours, the symbol hung over the road
  for (const f of T.feats) if (f.k === 'arch') {
    const th = THEMES[f.god] || THEMES.sara, A = new Parts(), at = T.at(f.s), a = Math.atan2(at.tz, at.tx), span = F + 1.2;
    for (const sd of [-1, 1]) {
      const p = T.pos(f.s, sd * span);
      A.box(1.5, 11, 1.5, p.x, at.y + 4.5, -p.z, 0x8a8478, 0, a, 0); for (const y of [1.5, 5, 8.5]) A.box(1.7, 0.5, 1.7, p.x, at.y + y, -p.z, th.body, 0, a, 0);
      A.box(1.9, 0.8, 1.9, p.x, at.y + 10.2, -p.z, th.trim, 0, a, 0); A.cone(0.9, 1.6, p.x, at.y + 11.4, -p.z, th.acc, 0, a, 0, 4);
      A.box(0.1, 4.2, 1.3, p.x + Math.cos(a) * 0.8, at.y + 6.4, -(p.z + Math.sin(a) * 0.8), th.body, 0, a, 0);   // a hanging banner
    }
    const c = T.pos(f.s, 0); A.box(1.2, 1.4, 2 * span + 1.5, c.x, at.y + 9.6, -c.z, 0x8a8478, 0, a, 0); A.box(1.3, 0.4, 2 * span + 1.6, c.x, at.y + 10.4, -c.z, th.body, 0, a, 0);
    group.add(A.mesh(lit));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(2.1, 24), new THREE.MeshBasicMaterial({ map: symbol(th.sym, th.acc, th.dark), transparent: true, side: THREE.DoubleSide }));
    disc.position.set(c.x, at.y + 7.2, -c.z); disc.rotation.y = a + Math.PI / 2; group.add(disc);
  }

  // ---- boost pads (chevrons that run), item boxes (spinning ? crates)
  const chev = chevrons(), padMat = new THREE.MeshBasicMaterial({ map: chev, transparent: true, opacity: 0.95, polygonOffset: true, polygonOffsetFactor: -3 });
  chev.repeat.set(1, 3);
  for (const p of race.pads) group.add(new THREE.Mesh(strip(T, p.s - p.len / 2, p.s + p.len / 2, p.d - 2.1, p.d + 2.1, 0.05), padMat));
  // the item rows: RS treasure chests (oak, iron bands, a gold lock), a glint over each so you see them coming
  const chestBase = chestParts(false).mesh(lit), chestLid = chestParts(true).mesh(lit), glint = new THREE.SpriteMaterial({ map: glintTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 });
  const boxes = race.boxes.map((b, i) => {
    const m = new THREE.Group(), p = T.pos(b.s, b.d), at = T.at(b.s); m.position.set(p.x, T.h(b.s) + 0.02, -p.z);
    m.userData = { ph: i * 0.9, a: Math.atan2(at.tz, at.tx) - Math.PI / 2 };   // (the lock faces the karts coming)
    m.add(chestBase.clone()); const lid = new THREE.Group(); lid.position.set(0, 0.74, -0.46); lid.add(chestLid.clone()); m.add(lid); m.userData.lid = lid;
    const sp = new THREE.Sprite(glint); sp.position.y = 0.9; sp.scale.setScalar(2.6); m.add(sp); m.userData.sp = sp;
    group.add(m); return m;
  });

  // ---- the obstacles
  const mobs = race.mobs.map(o => ({ o, g: new THREE.Group(), st: {} }));
  const bladeParts = () => {
    const B = new Parts();
    B.cyl(0.12, 0.12, 13, 0, -6.5, 0, 0x4a3420);
    B.box(0.18, 1.9, 2.6, 0, -12.6, 0, 0x8a2a1a); B.box(0.2, 0.3, 2.8, 0, -13.5, 0, 0xd8d0c0); B.box(0.22, 0.5, 0.5, 0, -11.6, 0, 0x3a3a3e);   // a dragon-steel blade, a bright edge
    B.cone(0.4, 1.2, 0, -12.6, 1.9, 0xd8d0c0, Math.PI / 2, 0, 0, 4); B.cone(0.4, 1.2, 0, -12.6, -1.9, 0xd8d0c0, -Math.PI / 2, 0, 0, 4);
    return B.mesh(lit);
  };
  const rock = new THREE.DodecahedronGeometry(1.6, 0), rockMat = new THREE.MeshLambertMaterial({ color: 0x7a7266, flatShading: true });
  for (const m of mobs) {
    const o = m.o; group.add(m.g);
    if (o.k === 'blade') {
      const at = T.at(o.s0), a = Math.atan2(at.tz, at.tx), G = new Parts();
      for (const sd of [-1, 1]) { const p = T.pos(o.s0, sd * (F + 0.6)); G.box(0.9, 15, 0.9, p.x, at.y + 7, -p.z, 0x5a4a38, 0, a, 0); }
      const c = T.pos(o.s0, 0); G.box(0.8, 0.8, 2 * F + 2.4, c.x, at.y + 14.2, -c.z, 0x5a4a38, 0, a, 0);
      group.add(G.mesh(lit));
      m.g.position.set(c.x, at.y + 14, -c.z); m.g.rotation.y = a; m.pend = new THREE.Group(); m.pend.add(bladeParts()); m.g.add(m.pend);
    } else if (o.k === 'boulder') { const r = new THREE.Mesh(rock, rockMat); m.g.add(r); m.rock = r; }
    else loadRSModel(o.k === 'cow' ? 'npc_cow' : 'npc_chicken').then(md => { md.play('walk'); m.md = md; m.g.add(md.group); }).catch(() => {});
  }

  // ---- what the race throws about: bananas, wind strikes, fire bolts, the dragon
  const live = new Map();
  const banana = () => { const B = new Parts(); for (let i = 0; i < 5; i++) { const u = i / 4 - 0.5; B.box(0.22, 0.2, 0.2, u * 0.9, 0.18 + u * u * 0.9, 0, i === 0 || i === 4 ? 0x5a4a10 : 0xf4d020, 0, 0, u * 1.4); } return B.mesh(lit); };
  let dragon = null; loadRSModel('npc_kbd').then(md => { dragon = md; md.group.scale.setScalar(0.45); md.play(Object.keys(md.meta.anims)[0]); }).catch(() => {});

  const tmp = {};
  return {
    group, road, boxes, mobs,
    update(t, dt, race, fx) {
      chev.offset.y = -t * 2.2;
      race.boxes.forEach((b, i) => {                              // shut and sparkling; taken: the lid flies open, it sinks away, then pops back shut
        const m = boxes[i], u = m.userData, since = 2.5 - b.gone, taken = b.gone > 0;
        let sc = 1, lid = 0;
        if (taken) { lid = -Math.min(1, since / 0.18) * 1.9; sc = since < 0.7 ? 1 : since < 1.0 ? 1 - (since - 0.7) / 0.3 : b.gone < 0.3 ? 1 - b.gone / 0.3 : 0; if (b.gone < 0.3) lid = 0; }
        m.visible = sc > 0.01; m.scale.setScalar(Math.max(0.01, sc) * (taken && b.gone < 0.3 ? 1 + Math.sin((0.3 - b.gone) / 0.3 * Math.PI) * 0.25 : 1));
        u.lid.rotation.x = lid; m.rotation.y = u.a + Math.sin(t * 1.3 + u.ph) * 0.35;
        u.sp.scale.setScalar((taken ? 3.6 : 2.4) + Math.sin(t * 4 + u.ph) * 0.3);
      });
      for (const m of mobs) {
        const o = m.o, q = race.mobAt(o, race.t, tmp);
        if (o.k === 'blade') { m.pend.rotation.x = Math.asin(Math.max(-0.99, Math.min(0.99, q.d / 13))); continue; }   // (d, + left, is local -z)
        const p = T.pos(q.s, q.d), y = T.h(q.s) + q.y;
        if (o.k === 'boulder') { m.g.position.set(p.x, y + 1.5, -p.z); const at = T.at(q.s); m.g.rotation.set(0, Math.atan2(at.tz, at.tx), 0); m.rock.rotation.x = -q.a; continue; }
        const vx = p.x - (m.px ?? p.x), vz = p.z - (m.pz ?? p.z); m.px = p.x; m.pz = p.z;   // facing the way they're walking
        if (vx * vx + vz * vz > 1e-6) m.face = Math.atan2(vz, vx);
        m.g.position.set(p.x, y, -p.z); m.g.rotation.y = (m.face ?? 0) + Math.PI / 2;
        m.md?.update(dt);
      }
      // the shots and hazards: made when they appear, dropped when they're gone
      const seen = new Set();
      for (const h of race.hazards) { seen.add('h' + h.id); let g = live.get('h' + h.id); if (!g) { g = banana(); g.rotation.y = h.id; live.set('h' + h.id, g); group.add(g); } const p = T.pos(h.s, h.d); g.position.set(p.x, T.h(h.s) + 0.05, -p.z); }
      for (const s of race.shots) {
        seen.add('s' + s.id); let g = live.get('s' + s.id);
        if (!g) { g = new THREE.Group(); if (s.k === 'dragon' && dragon) { g.add(dragon.group); g.userData.dragon = true; } if (s.k === 'chin') { g.add(chinMesh()); g.userData.chin = true; } live.set('s' + s.id, g); group.add(g); }
        const p = T.pos(s.s, s.d), at = T.at(s.s), y = T.h(s.s) + (s.k === 'dragon' ? 7 + Math.sin(t * 3) * 0.8 : s.k === 'chin' ? 0.05 + (s.y || 0) : 1.0);
        if (g.userData.chin) { const fuse = s.age > 0.75; g.children[0].rotation.x = fuse ? 0 : s.age * 14; g.children[0].scale.setScalar(fuse && Math.sin(t * (10 + (2.4 - s.life) * 12)) > 0 ? 1.18 : 1); }   // (tumbles through the air, then swells and shrinks as the fuse runs)
        g.position.set(p.x, y, -p.z); g.rotation.y = Math.atan2(at.tz, at.tx) + Math.PI / 2;
        if (g.userData.dragon) dragon?.update(dt);
        fx?.shot(s, p.x, y, -p.z, dt);
      }
      for (const [k, g] of live) if (!seen.has(k)) { g.removeFromParent(); live.delete(k); }
    },
  };
}
