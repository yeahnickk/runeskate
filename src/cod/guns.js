// CODScape's guns: real-world firearms modelled to their real dimensions. Each gun is built from its side
// silhouette traced in millimetres (receivers, curved magazines, grips, stocks, handguards: extruded with bevelled
// edges), turned profiles for the round parts (barrels, muzzle devices, gas tubes, scope bodies), Picatinny rails
// with real teeth, and physically based materials (anodised aluminium, parkerised steel, polymer, wood, brass) that
// catch the environment light like the metal in a Call of Duty viewmodel. Moving parts are split out so the reloads
// move them: the magazine, the bolt / charging handle, the slide, the pump, the LMG's feed cover.
//
// Gun space (metres): x right, y up, the barrel along -z. The origin is where the right hand grips (top of the
// pistol grip). Authoring is in mm along u (forward) and v (up), with the bore axis at v = B.
// Each model reports: muzzle (Object3D at the barrel tip), fore (left hand), sightY (the sight line's height:
// ADS puts it on the eye), magPos, eject, parts, scope, len, rl (how it reloads), port (shotgun loading port).
import * as THREE from 'three';

// ------------------------------------------------------------------ materials (PBR; colours as written)
const M = {};
// authored as display (sRGB) colours, shaded in linear light: the gun pass renders with sRGB output + filmic tone
// mapping like a modern game (see setGunPass), so metal gets its sheen; the RS world keeps its own 1:1 colours
const lin = (hex, k = 1) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace).convertSRGBToLinear().multiplyScalar(k);
const PBR = {
  black: [0x2a2c30, 0.6, 0.38], park: [0x3a3c40, 0.75, 0.45], poly: [0x232427, 0.0, 0.55], steel: [0x9a9ea6, 0.95, 0.25],
  wood: [0x7a3f1c, 0.0, 0.45], bakelite: [0x8a3510, 0.05, 0.35], tan: [0xb59a70, 0.05, 0.6], od: [0x5a6142, 0.05, 0.58],
  brass: [0xd4aa48, 1.0, 0.28], chrome: [0xc8cad0, 1.0, 0.12], rubber: [0x1a1a1c, 0.0, 0.9], glass: [0x3a6a96, 0.3, 0.05],
  silver: [0xb8bbc2, 0.92, 0.28], green: [0x4c553a, 0.05, 0.68],
};
export function gunMat(key, k = 1, ds = false) {
  if (typeof key === 'number') return M['n' + key + ':' + k] ||= new THREE.MeshStandardMaterial({ color: lin(key, k), metalness: 0.1, roughness: 0.7 });
  const [c, m, r] = PBR[key] || PBR.black;
  return M[key + ':' + k + ds] ||= new THREE.MeshStandardMaterial({ color: lin(c, k), metalness: m, roughness: r, envMapIntensity: 1.2, side: ds ? THREE.DoubleSide : THREE.FrontSide });
}
/** render a gun pass like a modern engine (sRGB out, filmic curve), then put the RS world's settings back */
export function withGunPass(renderer, fn) {
  const o = renderer.outputColorSpace, t = renderer.toneMapping, e = renderer.toneMappingExposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  fn();
  renderer.outputColorSpace = o; renderer.toneMapping = t; renderer.toneMappingExposure = e;
}
const glow = hex => M['g' + hex] ||= new THREE.MeshBasicMaterial({ color: lin(hex), toneMapped: false });

/** a studio-ish environment for the metal to reflect (a sky, a horizon, a ground), as a PMREM texture */
export function gunEnvironment(renderer) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#dfe9f6'); g.addColorStop(0.42, '#9db6d6'); g.addColorStop(0.5, '#f4efe2'); g.addColorStop(0.56, '#6e6252'); g.addColorStop(1, '#2a241c');
  x.fillStyle = g; x.fillRect(0, 0, 256, 128);
  x.fillStyle = 'rgba(255,255,255,0.9)'; x.fillRect(40, 20, 50, 14); x.fillRect(170, 26, 30, 10);   // a couple of bright windows for highlights
  const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  const pm = new THREE.PMREMGenerator(renderer), env = pm.fromEquirectangular(t).texture; pm.dispose(); t.dispose();
  return env;
}

// ------------------------------------------------------------------ the builder
const mm = v => v / 1000;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Vm = (u, v, x = 0) => new THREE.Vector3(mm(x), mm(v), -mm(u));        // authoring (u fwd, v up, x right) in mm -> gun space
const BOX = new THREE.BoxGeometry(1, 1, 1);

class Kit {
  constructor() { this.g = new THREE.Group(); this.parts = {}; }
  /** a side profile (pts [[u, v], ...] mm) extruded w mm wide about x; holes: [[[u, v]...]] */
  ext(pts, w, mat, { x = 0, bevel = 1.2, holes = [], to } = {}) {
    const s = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(mm(u), mm(v))));
    for (const h of holes) s.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(mm(u), mm(v)))));
    const b = Math.min(mm(bevel), mm(w) * 0.3);
    const geo = new THREE.ExtrudeGeometry(s, { depth: Math.max(1e-4, mm(w) - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 6 });
    geo.rotateY(Math.PI / 2); geo.translate(mm(x) - (mm(w) - 2 * b) / 2, 0, 0);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, gunMat(mat)); (to || this.g).add(m); return m;
  }
  /** a turned part along the bore: prof [[u, r], ...] mm at height v (and x) */
  lathe(prof, mat, { v = 0, x = 0, seg = 16, to, ds = false } = {}) {
    const geo = new THREE.LatheGeometry(prof.map(([u, r]) => new THREE.Vector2(Math.max(mm(r), 1e-5), mm(u))), seg);
    geo.rotateX(-Math.PI / 2); geo.translate(mm(x), mm(v), 0);
    const m = new THREE.Mesh(geo, gunMat(mat, 1, ds)); (to || this.g).add(m); return m;
  }
  /** a box from u0..u1, v0..v1, x0..x1 (mm) */
  box(u0, u1, v0, v1, x0, x1, mat, { to, rx = 0, ry = 0, rz = 0 } = {}) {
    const m = new THREE.Mesh(BOX, gunMat(mat));
    m.scale.set(mm(Math.abs(x1 - x0)), mm(Math.abs(v1 - v0)), mm(Math.abs(u1 - u0)));
    m.position.set(mm((x0 + x1) / 2), mm((v0 + v1) / 2), -mm((u0 + u1) / 2)); m.rotation.set(rx, ry, rz);
    (to || this.g).add(m); return m;
  }
  /** a cylinder across x (pins, screws, knobs), up y, or along z */
  pin(u, v, r, len, mat, { x = 0, axis = 'x', to, seg = 10 } = {}) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(mm(r), mm(r), mm(len), seg), gunMat(mat));
    m.position.set(mm(x), mm(v), -mm(u)); if (axis === 'x') m.rotation.z = Math.PI / 2; else if (axis === 'z') m.rotation.x = Math.PI / 2;
    (to || this.g).add(m); return m;
  }
  /** a Picatinny rail on top (side: -1 left, 1 right, 'b' underneath) from u0 to u1, its base at height v */
  rail(u0, u1, v, mat = 'black', { side = 0, x = 0, to } = {}) {
    const g = new THREE.Group(); (to || this.g).add(g);
    this.box(u0, u1, 0, 5, -8, 8, mat, { to: g }); this.box(u0, u1, 5, 9.5, -10.5, 10.5, mat, { to: g });
    for (let u = u0 + 3; u < u1 - 3; u += 10) this.box(u, u + 5.2, 9.5, 12, -10.5, 10.5, mat, { to: g });
    if (side === 0) g.position.set(mm(x), mm(v), 0);
    else if (side === 'b') { g.rotation.z = Math.PI; g.position.set(mm(x), mm(v), 0); }
    else { g.rotation.z = -side * Math.PI / 2; g.position.set(mm(x), mm(v), 0); }
    return g;
  }
  part(name, u = 0, v = 0, x = 0) { const g = new THREE.Group(); g.position.copy(Vm(u, v, x)); g.userData.home = g.position.clone(); g.userData.rot = g.rotation.clone(); this.g.add(g); this.parts[name] = g; return g; }
  out(o) {
    const muzzle = new THREE.Object3D(); muzzle.position.copy(o.muzzle); this.g.add(muzzle);
    return { group: this.g, parts: this.parts, muzzle, fore: o.fore, sightY: o.sightY, magPos: o.magPos || V(0, -0.04, -0.06), eject: o.eject || V(0.03, 0.04, -0.02),
      scope: !!o.scope, reticle: o.reticle || null, len: o.len || 0.8, rl: o.rl || { style: 'rifle', empty: 'none' }, port: o.port || null,
      rearZ: o.rear !== undefined ? -mm(o.rear) : 0.14 };   // the rear sight / eyepiece (gun-space z): ADS puts the eye a few cm behind it
  }
}

// ------------------------------------------------------------------ shared pieces
/** an Aimpoint-style red dot on a rail whose top is at v, centred at u: returns the dot height (mm) */
function redDot(k, u, v) {
  const c = v + 30;
  k.box(u - 22, u + 22, v, v + 10, -11, 11, 'black');                         // QD mount
  k.box(u - 16, u + 16, v + 10, c - 12, -8, 8, 'black');
  k.lathe([[u + 34, 17], [u + 34, 19], [u - 34, 19], [u - 34, 17], [u + 34, 17]], 'black', { v: c, seg: 20, ds: true });   // the tube: open, you look through it
  k.pin(u, c, 7, 10, 'black', { x: 19 }); k.pin(u, c + 17, 7, 9, 'black', { axis: 'y' });   // windage / elevation caps
  const dot = new THREE.Mesh(new THREE.SphereGeometry(mm(1.3), 8, 6), glow(0xff2020)); dot.position.copy(Vm(u + 10, c)); k.g.add(dot);
  return c;
}
/** a rifle scope on rings: rail top v, from u0 (eyepiece) to u1 (objective); returns its axis height (mm) */
function scope(k, u0, u1, v, big = false) {
  const c = v + (big ? 42 : 36), R = big ? 17 : 15;
  k.lathe([[u0, 0], [u0, 20], [u0 + 8, 21], [u0 + 70, 19], [u0 + 95, R], [u1 - 105, R], [u1 - 70, big ? 28 : 24], [u1 - 4, big ? 29 : 25], [u1, big ? 27 : 23], [u1, 0]], 'black', { v: c, seg: 20 });
  k.lathe([[u1 + 0.5, big ? 26 : 22], [u1 + 1.5, 0]], 'glass', { v: c, seg: 20 });
  const mid = u0 + (u1 - u0) * 0.48;
  k.lathe([[mid - 22, 18.5], [mid + 22, 18.5]], 'black', { v: c, seg: 20 });                    // the saddle
  k.pin(mid, c + 22, 10, 14, 'black', { axis: 'y', seg: 14 }); k.pin(mid, c, 10, 14, 'black', { x: 22, seg: 14 });   // turrets
  k.pin(mid - 30, c, 8, 10, 'black', { x: -20 });
  for (const ru of [u0 + 110, u1 - 120]) { k.box(ru - 9, ru + 9, v, c - 4, -13, 13, 'black'); k.lathe([[ru - 9, R + 3], [ru + 9, R + 3]], 'black', { v: c }); }
  k.lathe([[u0 - 50, 0], [u0 - 50, 21], [u0, 21], [u0, 0]], 'rubber', { v: c, seg: 16 });       // the rubber eyecup
  return c;
}
/** an aperture / ghost ring facing the eye: centred on the sight line at height c (mm), at u, hole h mm, ring t mm,
 *  d deep, with a post down to the mount at v0 */
function ring(k, u, c, h, t, d, v0, mat = 'black', to) {
  const o = h / 2 + t;
  k.box(u - d / 2, u + d / 2, c + h / 2, c + o, -o, o, mat, { to }); k.box(u - d / 2, u + d / 2, c - o, c - h / 2, -o, o, mat, { to });
  k.box(u - d / 2, u + d / 2, c - h / 2, c + h / 2, -o, -h / 2, mat, { to }); k.box(u - d / 2, u + d / 2, c - h / 2, c + h / 2, h / 2, o, mat, { to });
  if (v0 < c - o) k.box(u - d / 2 - 2, u + d / 2 + 2, v0, c - o, -o * 0.7, o * 0.7, mat, { to });
}
/** a box magazine as its own part: its top-front corner at (u, v); prof relative to that corner */
function mag(k, u, v, prof, w, mat, { x = 0 } = {}) {
  const g = k.part('mag', u, v, x);
  k.ext(prof, w, mat, { to: g, bevel: 1.5 });
  return g;
}
/** the usual trigger guard + trigger under a receiver whose underside is at v */
function guard(k, u, v, mat = 'black', len = 62) {
  k.ext([[u, v], [u + 2, v - 22], [u + len, v - 22], [u + len + 6, v], [u + len - 2, v], [u + len - 6, v - 16], [u + 6, v - 16], [u + 4, v]], 7, mat, { bevel: 0.8 });
  k.ext([[u + 30, v + 2], [u + 40, v - 12], [u + 36, v - 16], [u + 32, v - 4]], 4, 'steel', { bevel: 0.4 });
}
/** a pistol grip hanging from (u, v), raked back */
function grip(k, u, v, mat = 'poly', w = 27, h = 100) {
  k.ext([[u, v], [u + 36, v], [u + 26, v - 36], [u + 18, v - h * 0.9], [u + 8, v - h * 1.05], [u - 18, v - h], [u - 14, v - h * 0.7], [u - 16, v - 36], [u - 16, v - 4]], w, mat, { bevel: 3 });
}

// ------------------------------------------------------------------ the guns (mm)
const BUILD = {
  // M4A1 carbine: flat-top upper, KAC quad rail, A-frame front sight, flip-up rear, CAR stock, 30-round STANAG
  m4() {
    const k = new Kit(), B = 34;
    k.ext([[-160, 16], [155, 16], [155, 58], [-150, 58], [-160, 50]], 29, 'black');                  // upper receiver
    k.ext([[-150, 30], [-162, 32], [-162, 52], [-150, 54]], 34, 'black', { bevel: 3 });               // receiver extension
    k.rail(-150, 152, 58);
    k.ext([[-150, 16], [130, 16], [138, 4], [120, -6], [95, -6], [95, -44], [30, -44], [30, -6], [-15, -6], [-40, -14], [-130, -14], [-150, -4]], 26, 'black');   // lower + magwell
    guard(k, -40, -14);
    grip(k, -44, -10);
    k.pin(-90, 2, 6, 30, 'black'); k.pin(25, 2, 3, 30, 'steel'); k.pin(-60, 2, 3, 30, 'steel');      // safety, pins
    k.pin(-120, 40, 6, 12, 'black', { x: 16 });                                                     // forward assist
    k.box(-70, 10, 26, 46, 13, 15.5, 'park');                                                       // ejection port cover
    k.lathe([[-160, 15.5], [-330, 15.5]], 'black', { v: 36 });                                      // buffer tube
    k.ext([[-255, 52], [-355, 52], [-372, 44], [-380, 30], [-385, -60], [-360, -62], [-330, -10], [-290, 10], [-255, 18]], 40, 'poly', { bevel: 4 });   // collapsible stock
    k.box(-386, -380, -62, 50, -19, 19, 'rubber');
    k.ext([[155, -6], [330, -6], [330, 58], [155, 58]], 54, 'black', { bevel: 3 });                 // quad rail handguard
    k.rail(158, 328, 58); k.rail(160, 326, 26, 'black', { side: -1, x: -27 }); k.rail(160, 326, 26, 'black', { side: 1, x: 27 }); k.rail(160, 326, -6, 'black', { side: 'b' });
    k.lathe([[330, 9.5], [440, 9.5], [440, 8], [500, 8]], 'park', { v: B });                       // barrel (with the M203 cut)
    k.ext([[425, 20], [452, 20], [452, 50], [448, 90], [443, 104], [437, 104], [432, 90], [427, 50]], 14, 'black');   // front sight base, the post's tip on the sight line
    k.ext([[425, 75], [452, 75], [450, 96], [445, 98], [432, 98], [428, 96]], 24, 'black', { holes: [[[432, 80], [445, 80], [445, 94], [432, 94]]] });   // its ears
    k.lathe([[500, 11], [548, 11], [552, 9], [552, 0]], 'park', { v: B, seg: 12 });                 // A2 birdcage
    for (let a = 0; a < 5; a++) { const r = mm(10.5), t = a / 5 * Math.PI * 2 + 0.3, s = new THREE.Mesh(BOX, gunMat('poly')); s.scale.set(mm(3), mm(3), mm(26)); s.position.set(Math.cos(t) * r, mm(B) + Math.sin(t) * r, -mm(530)); k.g.add(s); }
    ring(k, -134, 104, 9, 4, 6, 70);                                                                 // flip-up rear aperture on the sight line
    k.box(-148, -120, 70, 80, -10, 10, 'black');
    k.pin(-134, 76, 5, 26, 'black');
    const h = k.part('handle', -158, 54); k.ext([[0, 0], [-12, 0], [-14, 4], [-12, 9], [0, 9]], 36, 'black', { to: h });   // charging handle (T)
    const b = k.part('bolt', -30, 36, 12); k.box(-30, 30, -6, 6, -2, 2, 'steel', { to: b });
    mag(k, 95, -6, [[0, 0], [-64, 0], [-60, -70], [-54, -120], [-46, -170], [-38, -196], [26, -196], [18, -166], [8, -120], [3, -60]], 23, 'black');
    return k.out({ rear: -134, muzzle: Vm(552, B), fore: Vm(250, -18, -4), sightY: mm(104), len: 0.84, magPos: Vm(95, -6), eject: Vm(-30, 40, 16),
      rl: { style: 'rifle', empty: 'release', at: Vm(-20, 0, -16) } });
  },

  // AK-47: stamped receiver, ribbed dust cover, wood furniture, slant brake, the bakelite 30-rounder
  ak() {
    const k = new Kit(), B = 26;
    k.ext([[-170, 6], [145, 6], [150, 14], [150, 48], [-150, 48], [-172, 36]], 30, 'park');         // receiver
    k.ext([[-150, 48], [130, 48], [138, 54], [120, 62], [-130, 64], [-158, 56]], 29, 'park', { bevel: 3 });   // dust cover
    for (let u = -120; u < 110; u += 22) k.box(u, u + 6, 62, 64.5, -11, 11, 'park');
    grip(k, -60, 6, 'bakelite', 27, 104);
    guard(k, -50, 6, 'park');
    k.ext([[-170, 40], [-170, 6], [-420, -66], [-445, -70], [-445, 18], [-420, 24]], 38, 'wood', { bevel: 5 });   // the stock
    k.box(-449, -445, -70, 18, -19, 19, 'park');
    k.ext([[150, 44], [320, 40], [330, 30], [326, 6], [300, -4], [170, -4], [150, 6]], 46, 'wood', { bevel: 4 });   // lower handguard
    k.lathe([[150, 14], [158, 16], [320, 16], [326, 13]], 'wood', { v: 58 });                      // upper handguard over the gas tube
    k.lathe([[326, 9], [430, 9]], 'park', { v: 58 });
    k.lathe([[150, 11], [400, 11], [400, 10], [540, 10]], 'park', { v: B });                        // barrel
    k.ext([[405, 16], [440, 16], [442, 40], [432, 66], [410, 66]], 26, 'park');                     // gas block
    k.ext([[505, 16], [540, 16], [540, 92], [530, 92], [522, 70], [515, 70], [508, 92], [505, 92]], 22, 'park', { holes: [[[514, 74], [528, 74], [528, 88], [514, 88]]] });   // front sight block + hood
    k.box(519, 523, 64, 76, -1.5, 1.5, 'steel');                                                    // the post, its tip on the sight line
    k.ext([[540, 16], [580, 18], [580, 36], [540, 36]], 24, 'park', { bevel: 2 });                  // slant brake
    k.ext([[105, 48], [160, 48], [160, 62], [118, 70], [105, 70]], 26, 'park');                      // rear sight block
    k.box(108, 118, 68, 78, -10, -2.5, 'park'); k.box(108, 118, 68, 78, 2.5, 10, 'park');           // the notch
    k.ext([[-100, 18], [40, 18], [40, 26], [-100, 30]], 3, 'park', { x: 16, bevel: 0.5 });         // the long safety lever
    const b = k.part('bolt', 70, 40, 15); k.box(-10, 10, -4, 4, 0, 6, 'steel', { to: b }); k.pin(8, 0, 6, 14, 'steel', { x: 12, to: b });
    mag(k, 98, 6, [[0, 0], [-56, 0], [-50, -50], [-30, -110], [0, -170], [20, -200], [74, -176], [52, -120], [32, -60], [10, -10]], 26, 'bakelite');
    return k.out({ rear: 113, muzzle: Vm(580, B), fore: Vm(240, -10, -4), sightY: mm(76), len: 0.88, magPos: Vm(98, 6), eject: Vm(20, 40, 16),
      rl: { style: 'rifle', empty: 'handle', part: 'bolt', pull: 0.085, at: V(0.012, 0, 0) } });
  },

  // SCAR-H: monolithic aluminium upper with full-length rail, polymer lower, folding stock, the 20-round 7.62 mag
  scar() {
    const k = new Kit(), B = 36;
    k.ext([[-150, 20], [330, 20], [330, 66], [-150, 66]], 52, 'tan', { bevel: 3 });
    k.rail(-145, 328, 66, 'tan'); k.rail(200, 326, 43, 'tan', { side: 1, x: 26 }); k.rail(200, 326, 43, 'tan', { side: -1, x: -26 }); k.rail(220, 326, 20, 'tan', { side: 'b' });
    k.ext([[-150, 20], [120, 20], [120, -2], [96, -2], [96, -40], [36, -40], [36, -4], [-10, -4], [-40, -12], [-150, -12]], 44, 'tan', { bevel: 2.5 });
    grip(k, -44, -8, 'black'); guard(k, -38, -12);
    k.ext([[-150, 62], [-200, 60], [-340, 54], [-372, 46], [-378, -50], [-350, -54], [-300, -12], [-210, 6], [-150, 10]], 42, 'tan', { bevel: 4, holes: [[[-300, 20], [-220, 26], [-220, 44], [-300, 44]]] });   // folding stock
    k.box(-380, -374, -52, 48, -20, 20, 'rubber');
    k.lathe([[330, 11], [430, 11], [430, 0]], 'park', { v: B });
    k.lathe([[430, 15], [470, 15], [474, 12], [474, 0]], 'black', { v: B });
    k.ext([[296, 78], [326, 78], [326, 86], [296, 84]], 16, 'black');                             // front sight, folded down under the optic
    const sy = redDot(k, -40, 78);
    const h = k.part('handle', 120, 50, -27); k.box(-8, 8, -5, 5, -12, 0, 'black', { to: h });
    mag(k, 96, -2, [[0, 0], [-60, 0], [-58, -60], [-52, -118], [-46, -132], [14, -132], [10, -110], [4, -50]], 26, 'black');
    return k.out({ rear: -74, muzzle: Vm(474, B), fore: Vm(260, 0, -6), sightY: mm(sy), len: 0.85, magPos: Vm(96, -2), eject: Vm(-10, 40, 22),
      rl: { style: 'rifle', empty: 'handle', part: 'handle', pull: 0.08, at: V(-0.02, 0, 0) } });
  },

  // FAMAS F1: bullpup, the long carry handle with the sights in it, magazine behind the grip
  famas() {
    const k = new Kit(), B = 30;
    k.ext([[-330, 50], [-40, 52], [80, 50], [230, 40], [240, 10], [200, -10], [60, -18], [-330, -22], [-345, 10]], 54, 'poly', { bevel: 6 });   // body
    k.box(-347, -339, -22, 52, -24, 24, 'rubber');
    k.ext([[-300, 60], [200, 60], [205, 90], [-300, 92]], 22, 'poly', { bevel: 4, holes: [[[-240, 66], [140, 66], [140, 82], [-240, 82]]] });   // the carry handle
    k.ext([[-300, 50], [-285, 50], [-285, 92], [-300, 92]], 30, 'poly'); k.ext([[180, 40], [205, 50], [205, 92], [190, 92]], 30, 'poly');
    ring(k, -265, 104, 9, 4, 8, 92);                                                                 // rear aperture in the handle
    k.ext([[176, 92], [196, 92], [190, 104], [182, 104]], 12, 'black'); k.box(184, 188, 100, 106, -1.5, 1.5, 'steel');   // front post on the sight line
    k.ext([[20, -18], [56, -18], [44, -60], [36, -100], [8, -102], [12, -60], [8, -20]], 26, 'poly', { bevel: 3 });   // grip
    k.ext([[0, -18], [-30, -18], [-50, -40], [70, -40], [96, -18], [80, -18], [66, -30], [-26, -30]], 8, 'poly', { bevel: 1 });   // full-hand guard
    k.lathe([[240, 10], [360, 9], [360, 0]], 'park', { v: B });
    k.lathe([[360, 12], [395, 12], [395, 0]], 'black', { v: B });
    const h = k.part('handle', 120, 66, 0); k.box(-6, 6, -4, 6, -8, 8, 'black', { to: h });       // cocking lever under the handle
    mag(k, -70, -20, [[0, 0], [-58, 0], [-60, -60], [-62, -120], [-60, -130], [2, -130], [4, -60]], 24, 'black');
    return k.out({ rear: -265, muzzle: Vm(395, B), fore: Vm(120, -14, -4), sightY: mm(104), len: 0.76, magPos: Vm(-70, -20), eject: Vm(-120, 30, 28),
      rl: { style: 'rifle', empty: 'handle', part: 'handle', pull: 0.08, at: V(0, -0.02, 0) } });
  },

  // MP5A3: round receiver + cocking tube, slimline handguard, drum rear sight, hooded front, retractable stock
  mp5() {
    const k = new Kit(), B = 40;
    k.lathe([[-150, 22], [160, 22]], 'park', { v: 42, seg: 18 });                                    // receiver tube
    k.ext([[-150, 20], [160, 20], [160, 44], [-150, 44]], 40, 'park', { bevel: 2 });
    k.ext([[-150, 20], [60, 20], [60, -6], [28, -6], [28, -2], [-20, -2], [-60, -8], [-150, -6]], 36, 'poly', { bevel: 3 });   // trigger group
    grip(k, -44, -4); guard(k, -38, -6, 'poly');
    k.lathe([[160, 22], [170, 24], [300, 22], [305, 18]], 'poly', { v: B, seg: 16 });               // slimline handguard
    for (let u = 180; u < 290; u += 16) k.lathe([[u, 23.5], [u + 4, 23.5]], 'poly', { v: B });
    k.lathe([[300, 8.5], [370, 8.5], [370, 11], [380, 11], [380, 0]], 'park', { v: B });            // barrel + trilug
    k.lathe([[140, 9], [312, 9]], 'park', { v: 68 });                                                // cocking tube
    k.ext([[300, 60], [330, 60], [330, 74], [300, 78]], 28, 'park');
    k.lathe([[308, 16], [332, 16]], 'park', { v: 92, seg: 16 }); k.lathe([[308, 13], [332, 13]], 'black', { v: 92, seg: 16 });   // hooded front sight
    k.box(318, 322, 76, 100, -1.5, 1.5, 'steel');
    k.ext([[-130, 64], [-90, 64], [-96, 80], [-124, 80]], 26, 'park');
    k.lathe([[-122, 0], [-122, 10], [-98, 10], [-98, 0]], 'park', { v: 84, seg: 14 });             // the drum, its top aperture...
    ring(k, -110, 100, 8, 3.5, 10, 92, 'park');                                                       // ...a ring on the sight line
    for (const x of [-18, 18]) k.lathe([[-150, 5], [-340, 5]], 'park', { v: 40, x });                // retractable stock struts
    k.ext([[-330, 52], [-350, 52], [-356, -40], [-334, -40]], 50, 'rubber', { bevel: 4 });
    const h = k.part('handle', 270, 68, -16); k.ext([[0, 0], [-8, 0], [-10, 16], [-2, 16]], 10, 'black', { to: h });   // the HK slap lever
    mag(k, 52, -4, [[0, 0], [-40, 0], [-30, -80], [-6, -150], [10, -180], [52, -168], [34, -120], [16, -60], [6, -10]], 20, 'park');
    return k.out({ rear: -110, muzzle: Vm(380, B), fore: Vm(230, 4, -4), sightY: mm(100), len: 0.66, magPos: Vm(52, -4), eject: Vm(20, 44, 20),
      rl: { style: 'rifle', empty: 'hk', part: 'handle', pull: 0.075, at: V(-0.012, 0, 0) } });
  },

  // MP7A1: compact PDW, mag in the grip, folding foregrip, top rail with a red dot
  mp7() {
    const k = new Kit(), B = 34;
    k.ext([[-150, 6], [175, 6], [190, 20], [190, 56], [-110, 60], [-150, 50]], 46, 'poly', { bevel: 5 });
    k.rail(-110, 175, 58);
    k.ext([[-40, 10], [10, 10], [4, -110], [-26, -116], [-46, -110], [-44, -20]], 30, 'poly', { bevel: 4 });   // grip (the mag goes up it)
    guard(k, -60, 6, 'poly', 90);
    k.ext([[110, 6], [150, 6], [146, -70], [126, -76], [114, -70]], 26, 'poly', { bevel: 4 });      // folding foregrip
    k.lathe([[190, 9], [240, 9], [240, 0]], 'park', { v: B });
    k.lathe([[240, 12], [258, 12], [258, 0]], 'black', { v: B });
    for (const x of [-20, 20]) k.lathe([[-150, 4], [-280, 4]], 'park', { v: 30, x });
    k.ext([[-270, 40], [-292, 40], [-296, -30], [-276, -30]], 46, 'poly', { bevel: 4 });
    const sy = redDot(k, 30, 70);
    const h = k.part('handle', -150, 52); k.box(-10, 0, -4, 6, -20, 20, 'black', { to: h });
    const g = k.part('mag', -16, -4); k.ext([[16, 0], [-20, 0], [-28, -150], [8, -156]], 24, 'poly', { to: g }); k.box(-30, 10, -162, -152, -14, 14, 'poly', { to: g });
    return k.out({ rear: -4, muzzle: Vm(258, B), fore: Vm(132, -50, -2), sightY: mm(sy), len: 0.42, magPos: Vm(-16, -4), eject: Vm(20, 40, 24),
      rl: { style: 'rifle', empty: 'handle', part: 'handle', pull: 0.05, at: V(0, 0.015, 0.008) } });
  },

  // UMP45: the boxy polymer SMG, straight mag, side folder, rails, red dot
  ump() {
    const k = new Kit(), B = 34;
    k.ext([[-150, 0], [300, 0], [312, 14], [312, 60], [-150, 62]], 50, 'poly', { bevel: 4 });
    k.rail(-130, 160, 62); k.rail(200, 300, 0, 'black', { side: 'b' });
    grip(k, -44, 2); guard(k, -38, 0, 'poly');
    k.lathe([[312, 10], [350, 10], [350, 0]], 'park', { v: B });
    k.ext([[-150, 56], [-320, 54], [-336, 44], [-338, -40], [-318, -44], [-280, -10], [-150, -6]], 30, 'poly', { bevel: 4, holes: [[[-300, 6], [-180, 8], [-180, 40], [-300, 40]]] });
    const sy = redDot(k, -40, 74);
    const h = k.part('handle', 180, 46, -26); k.box(-8, 8, -4, 4, -10, 0, 'black', { to: h });
    mag(k, 112, 0, [[0, 0], [-52, 0], [-52, -150], [-46, -160], [6, -160], [4, -40]], 26, 'poly');
    return k.out({ rear: -74, muzzle: Vm(350, B), fore: Vm(240, -12, -4), sightY: mm(sy), len: 0.6, magPos: Vm(112, 0), eject: Vm(0, 40, 24),
      rl: { style: 'rifle', empty: 'handle', part: 'handle', pull: 0.07, at: V(-0.012, 0, 0) } });
  },

  // M249 SAW: big receiver, hinged feed cover with the rear sight, carry handle, heat shield, folded bipod, the 200-round box
  m249() {
    const k = new Kit(), B = 36;
    k.ext([[-160, 0], [190, 0], [190, 66], [-150, 70], [-170, 50]], 62, 'black', { bevel: 3 });
    const cover = k.part('cover', -150, 70);
    k.ext([[0, 0], [300, 0], [300, 22], [40, 26], [0, 20]], 60, 'black', { to: cover });
    ring(k, 32, 42, 9, 4, 8, 20, 'black', cover);                                                       // rear aperture on the feed cover
    k.ext([[190, 0], [340, 4], [340, 60], [190, 64]], 58, 'poly', { bevel: 4 });
    k.lathe([[340, 12], [560, 12], [560, 14], [600, 14], [600, 0]], 'park', { v: B });
    k.ext([[350, 50], [520, 50], [520, 58], [350, 60]], 40, 'black');                               // heat shield
    k.ext([[520, 46], [544, 46], [540, 112], [526, 112]], 16, 'black');                             // front sight
    k.ext([[160, 96], [180, 96], [178, 130], [40, 134], [20, 130], [20, 112], [140, 112], [160, 108]], 18, 'black', { bevel: 3 });   // carry handle
    for (const x of [-12, 12]) k.ext([[400, 24], [600, 22], [600, 14], [400, 16]], 6, 'black', { x });   // folded bipod legs
    grip(k, -44, 4); guard(k, -38, 0);
    k.ext([[-170, 56], [-360, 52], [-380, 40], [-384, -46], [-360, -48], [-300, -10], [-170, 0]], 46, 'poly', { bevel: 5 });
    const h = k.part('handle', 40, 30, 32); k.box(-8, 8, -6, 6, 0, 14, 'black', { to: h });
    const g = k.part('mag', 110, 0, -30); k.ext([[0, 0], [-120, 0], [-120, -120], [-112, -128], [-8, -128], [0, -120]], 70, 'green', { to: g, bevel: 6 });
    k.box(-110, -10, -4, 6, -36, 36, 'od', { to: g });
    return k.out({ rear: -118, muzzle: Vm(600, B), fore: Vm(260, -16, -4), sightY: mm(112), len: 1.0, magPos: Vm(110, 0, -30), eject: Vm(-20, 20, 32),
      rl: { style: 'lmg', empty: 'handle', part: 'handle', pull: 0.09, at: V(0.02, 0, 0) } });
  },

  // CheyTac M200 Intervention: chassis, long fluted barrel with the big brake, bolt with the tactical knob, scope, skeleton stock
  intervention() {
    const k = new Kit(), B = 30;
    k.ext([[-140, 6], [210, 6], [210, 54], [-140, 54]], 46, 'od', { bevel: 3 });
    k.rail(-130, 200, 54);
    k.ext([[210, 4], [520, 10], [520, 56], [210, 58]], 50, 'od', { bevel: 4 });                    // the fore end tube
    for (let u = 240; u < 500; u += 46) k.ext([[u, 22], [u + 28, 22], [u + 28, 42], [u, 42]], 52, 'black');
    k.lathe([[520, 14], [900, 13]], 'park', { v: B });
    for (let a = 0; a < 6; a++) { const t = a / 6 * Math.PI * 2, s = new THREE.Mesh(BOX, gunMat('black')); s.scale.set(mm(2.5), mm(2.5), mm(300)); s.position.set(Math.cos(t) * mm(13.2), mm(B) + Math.sin(t) * mm(13.2), -mm(720)); k.g.add(s); }
    k.ext([[900, 10], [990, 10], [990, 50], [900, 50]], 40, 'black', { bevel: 3, holes: [[[920, 18], [940, 18], [940, 42], [920, 42]], [[955, 18], [975, 18], [975, 42], [955, 42]]] });   // muzzle brake
    grip(k, -44, 4, 'od'); guard(k, -38, 6);
    k.ext([[-140, 50], [-420, 46], [-440, 30], [-444, -70], [-420, -74], [-300, -20], [-140, -6]], 40, 'od', { bevel: 4, holes: [[[-400, 0], [-200, 6], [-200, 30], [-400, 30]], [[-410, -50], [-330, -20], [-410, -20]]] });   // skeleton stock
    k.ext([[-200, 46], [-380, 46], [-380, 64], [-200, 62]], 36, 'od', { bevel: 5 });               // cheek rest
    k.box(-448, -440, -74, 46, -22, 22, 'rubber');
    const sy = scope(k, -110, 230, 66, true);
    const bolt = k.part('bolt', 0, 40, 20);
    k.lathe([[-120, 9], [-10, 9]], 'steel', { to: bolt }); k.pin(-90, 0, 4, 34, 'steel', { x: 17, to: bolt });
    const knob = new THREE.Mesh(new THREE.SphereGeometry(mm(10), 12, 10), gunMat('black')); knob.position.copy(Vm(-90, 0, 36)); bolt.add(knob);
    mag(k, 70, 6, [[0, 0], [-80, 0], [-80, -70], [-74, -76], [-4, -76], [0, -70]], 30, 'black');
    return k.out({ rear: -160, muzzle: Vm(990, B), fore: Vm(330, -10, -4), sightY: mm(sy), scope: true, reticle: 'mil', len: 1.24, magPos: Vm(70, 6), eject: Vm(-30, 40, 24),
      rl: { style: 'rifle', empty: 'bolt' } });
  },

  // Barrett M82A1: the big receiver with its cooling slots, carry handle, the double-chamber brake, bipod, scope, 10-round mag
  barrett() {
    const k = new Kit(), B = 34;
    k.ext([[-240, -4], [480, -4], [480, 60], [-200, 66], [-240, 54]], 66, 'black', { bevel: 4 });
    for (let u = 160; u < 460; u += 40) k.ext([[u, 10], [u + 24, 10], [u + 24, 50], [u, 50]], 68, 'park', { bevel: 3 });
    k.rail(-160, 200, 66);
    k.lathe([[480, 16], [800, 15]], 'park', { v: B });
    k.ext([[800, 2], [920, 2], [920, 66], [800, 66]], 70, 'black', { bevel: 6, holes: [[[820, 10], [850, 10], [850, 58], [820, 58]], [[870, 10], [900, 10], [900, 58], [870, 58]]] });   // the brake
    grip(k, -44, -4); guard(k, -38, -4);
    k.ext([[-240, 50], [-430, 40], [-440, -96], [-410, -100], [-300, -60], [-240, -10]], 56, 'black', { bevel: 6 });
    k.box(-446, -438, -100, 42, -28, 28, 'rubber');
    k.ext([[60, 160], [200, 160], [196, 136], [180, 136], [180, 150], [80, 150], [80, 136], [64, 136]], 22, 'black', { bevel: 3 });   // carry handle (over the scope)
    for (const x of [-16, 16]) k.ext([[480, 4], [740, 0], [740, -10], [480, -6]], 8, 'black', { x });
    const sy = scope(k, -140, 200, 66, true);
    const h = k.part('handle', 120, 30, 36); k.box(-10, 10, -8, 8, 0, 18, 'black', { to: h });
    mag(k, 60, -4, [[0, 0], [-100, 0], [-100, -100], [-94, -108], [-6, -108], [0, -100]], 34, 'black');
    return k.out({ rear: -190, muzzle: Vm(920, B), fore: Vm(300, -20, -4), sightY: mm(sy), scope: true, reticle: 'mil', len: 1.45, magPos: Vm(60, -4), eject: Vm(-30, 30, 34),
      rl: { style: 'rifle', empty: 'handle', part: 'handle', pull: 0.1, at: V(0.02, 0, 0) } });
  },

  // Remington 870 MCS: receiver, tube magazine, the ribbed pump, polymer stock, bead sight
  r870() {
    const k = new Kit(), B = 46;
    k.ext([[-90, -4], [170, -4], [170, 64], [-80, 64], [-96, 50]], 36, 'park', { bevel: 3 });
    k.box(20, 110, 40, 58, 17, 19, 'black');                                                         // ejection port
    k.lathe([[170, 13], [520, 12.5]], 'park', { v: B });
    k.lathe([[170, 12], [480, 12], [490, 14], [500, 14], [500, 0]], 'park', { v: 14 });              // mag tube + cap
    k.lathe([[505, 2.2], [510, 2.2]], 'brass', { v: B + 13 });                                       // the bead
    grip(k, -44, -2); guard(k, -38, -4, 'park');
    k.ext([[-90, 60], [-360, 50], [-376, 40], [-380, -60], [-350, -64], [-200, -14], [-90, -4]], 42, 'poly', { bevel: 5 });
    k.box(-386, -378, -64, 50, -21, 21, 'rubber');
    const pump = k.part('pump', 300, 14);
    k.ext([[-70, -18], [70, -18], [74, 0], [70, 20], [-70, 20], [-74, 0]], 50, 'poly', { to: pump, bevel: 6 });
    for (let u = -60; u < 64; u += 12) k.ext([[u, -20], [u + 5, -20], [u + 5, 22], [u, 22]], 52, 'poly', { to: pump });
    return k.out({ rear: -70, muzzle: Vm(520, B), fore: Vm(300, -8, -4), sightY: mm(B + 16), len: 0.95, magPos: Vm(80, 0), eject: Vm(60, 50, 20),
      rl: { style: 'shells', empty: 'pump' }, port: Vm(80, -6) });
  },

  // M1911A1: the slide with its serrations and sights, frame, wood grips, hammer, the grip safety
  m1911() {
    const k = new Kit(), B = 16;
    const slide = k.part('slide', 0, 0);
    k.ext([[-60, 6], [150, 6], [150, 30], [-50, 32], [-62, 26]], 23, 'park', { to: slide, bevel: 2 });
    for (let u = -54; u < -20; u += 5) k.box(u, u + 2, 8, 30.5, -12, 12, 'black', { to: slide });   // rear serrations
    k.box(64, 120, 14, 30, 11, 12.5, 'black', { to: slide });                                         // ejection port
    k.ext([[140, 30], [146, 30], [145, 37], [141, 37]], 3, 'steel', { to: slide });                   // front post
    for (const x of [-6, 6]) k.ext([[-52, 30], [-38, 30], [-38, 37], [-52, 37]], 5, 'park', { to: slide, x });   // rear notch
    k.ext([[-50, -2], [140, -2], [140, 8], [-50, 8]], 22, 'park');
    k.lathe([[150, 5], [154, 5]], 'park', { v: B });
    k.ext([[-58, 6], [-10, 6], [-14, -20], [-24, -96], [-60, -100], [-66, -20], [-68, 0]], 25, 'park', { bevel: 2 });   // grip frame
    for (const x of [-13.5, 13.5]) k.ext([[-16, -12], [-24, -90], [-58, -92], [-62, -18]], 3, 'wood', { x, bevel: 0.8 });   // grip panels
    k.ext([[-8, 6], [6, -16], [40, -16], [44, 6], [36, 6], [32, -10], [6, -10], [0, 6]], 6, 'park', { bevel: 0.6 });   // trigger guard
    k.ext([[-66, 22], [-80, 34], [-74, 40], [-60, 28]], 8, 'park');                                   // hammer
    k.ext([[-66, -6], [-90, 0], [-90, 6], [-64, 4]], 26, 'park', { bevel: 2 });                      // grip safety spur
    const g = k.part('mag', -30, -2); k.ext([[-10, 0], [-24, -100], [-6, -104], [8, -4]], 18, 'park', { to: g }); k.box(-26, -2, -108, -100, -11, 11, 'black', { to: g });
    return k.out({ muzzle: Vm(154, B), fore: Vm(-36, -60, -14), sightY: mm(37), len: 0.22, magPos: Vm(-30, -2), eject: Vm(90, 26, 14),
      rl: { style: 'pistol', empty: 'slide', part: 'slide', pull: 0.045, at: V(0, 0.026, 0.045) } });
  },

  // Desert Eagle Mk XIX: the big triangular-barrel slab, polished, with the top rail
  deagle() {
    const k = new Kit(), B = 22;
    const slide = k.part('slide', 0, 0);
    k.ext([[-70, 10], [40, 10], [40, 42], [-60, 44], [-72, 36]], 30, 'silver', { to: slide, bevel: 2.5 });
    for (let u = -64; u < -30; u += 6) k.box(u, u + 2.5, 14, 42.5, -16, 16, 'park', { to: slide });
    for (const x of [-7, 7]) k.box(-62, -52, 44, 52, x - 3, x + 3, 'silver', { to: slide });
    k.ext([[40, 4], [200, 4], [200, 46], [40, 46]], 30, 'silver', { bevel: 2.5 });                   // the barrel slab
    k.ext([[40, 46], [196, 46], [196, 54], [40, 54]], 14, 'silver');                                 // its rail
    k.ext([[186, 54], [194, 54], [193, 52], [188, 52]], 4, 'silver');
    k.lathe([[200, 6], [202, 6]], 'black', { v: B });
    k.ext([[-60, 4], [40, 4], [40, 12], [-60, 12]], 26, 'silver');
    k.ext([[-60, 8], [-12, 8], [-16, -20], [-26, -100], [-64, -104], [-70, -20], [-72, 0]], 30, 'poly', { bevel: 3 });
    k.ext([[-8, 6], [6, -18], [44, -18], [48, 6], [40, 6], [36, -12], [6, -12], [0, 6]], 7, 'silver', { bevel: 0.6 });
    k.ext([[-70, 30], [-86, 42], [-80, 48], [-64, 36]], 9, 'silver');
    const g = k.part('mag', -36, 2); k.ext([[-10, 0], [-26, -104], [-6, -108], [10, -4]], 22, 'park', { to: g }); k.box(-28, -2, -112, -104, -13, 13, 'black', { to: g });
    return k.out({ muzzle: Vm(202, B), fore: Vm(-40, -62, -15), sightY: mm(52), len: 0.27, magPos: Vm(-36, 2), eject: Vm(10, 30, 16),
      rl: { style: 'pistol', empty: 'slide', part: 'slide', pull: 0.05, at: V(0, 0.034, 0.05) } });
  },

  // Glock 18: the polymer frame with the finger grooves, the squared slide with the selector, the 33-round mag
  g18() {
    const k = new Kit(), B = 16;
    const slide = k.part('slide', 0, 0);
    k.ext([[-60, 6], [128, 6], [130, 30], [-60, 30]], 25, 'park', { to: slide, bevel: 2 });
    for (let u = -54; u < -26; u += 5) k.box(u, u + 2, 10, 30.5, -13, 13, 'black', { to: slide });
    k.box(-48, -40, 26, 34, 6, 14, 'black', { to: slide });                                           // the selector
    k.ext([[118, 30], [124, 30], [123, 37], [119, 37]], 3.5, 'steel', { to: slide });
    for (const x of [-6, 6]) k.ext([[-56, 30], [-44, 30], [-44, 37], [-56, 37]], 5, 'park', { to: slide, x });
    k.lathe([[128, 5], [132, 5]], 'park', { v: B });
    k.ext([[-58, 6], [118, 6], [118, -4], [40, -6], [-58, -4]], 24, 'poly', { bevel: 2 });
    k.rail(70, 116, -4, 'poly', { side: 'b' });
    k.ext([[-58, 2], [-10, 2], [-14, -20], [-12, -40], [-18, -50], [-14, -64], [-20, -74], [-24, -96], [-60, -100], [-66, -20], [-64, 0]], 28, 'poly', { bevel: 3 });   // finger-grooved grip
    k.ext([[-8, 2], [6, -18], [40, -18], [44, 2], [36, 2], [32, -12], [6, -12], [0, 2]], 7, 'poly', { bevel: 0.6 });
    const g = k.part('mag', -30, -2); k.ext([[-10, 0], [-28, -160], [-4, -164], [8, -4]], 20, 'poly', { to: g }); k.box(-30, -2, -168, -160, -12, 12, 'poly', { to: g });
    return k.out({ muzzle: Vm(132, B), fore: Vm(-36, -62, -15), sightY: mm(37), len: 0.2, magPos: Vm(-30, -2), eject: Vm(70, 26, 14),
      rl: { style: 'pistol', empty: 'slide', part: 'slide', pull: 0.04, at: V(0, 0.026, 0.04) } });
  },

  knife() {
    const k = new Kit();
    k.ext([[-110, -12], [-10, -12], [-10, 12], [-110, 12], [-118, 0]], 22, 'rubber', { bevel: 4 });
    for (let u = -100; u < -20; u += 14) k.box(u, u + 4, -13, 13, -12, 12, 'poly');
    k.ext([[-10, -20], [0, -20], [0, 20], [-10, 20]], 26, 'black');
    k.ext([[0, -12], [120, -10], [170, 8], [150, 14], [0, 12]], 4, 'steel', { bevel: 0.6 });
    return k.out({ muzzle: Vm(170, 0), fore: Vm(-60, 0), sightY: 0, len: 0.3 });
  },
  frag() {
    const k = new Kit();
    const s = new THREE.Mesh(new THREE.SphereGeometry(mm(32), 14, 10), gunMat('od')); s.scale.y = 1.15; k.g.add(s);
    k.pin(0, 40, 9, 14, 'park', { axis: 'y' });
    k.ext([[-6, 34], [6, 34], [4, -20], [-4, -20]], 6, 'park', { x: 20 });                            // the spoon
    const ring = new THREE.Mesh(new THREE.TorusGeometry(mm(10), mm(1.5), 6, 14), gunMat('steel')); ring.position.copy(Vm(0, 52, -10)); k.g.add(ring);
    return k.out({ muzzle: V(0, 0, 0), fore: V(0, 0, 0), sightY: 0, len: 0.1 });
  },
};
BUILD.semtex = () => { const g = BUILD.frag(); g.group.traverse(m => { if (m.isMesh && m.material === gunMat('od')) m.material = gunMat('tan'); }); return g; };

const cache = new Map();
/** a fresh copy of a gun model (model key from src/cod/weapons.js: m4, ak, ..., knife, frag) */
export function buildGun(model) {
  const f = BUILD[model] || BUILD.m4;
  if (!cache.has(model)) cache.set(model, f());
  const src = cache.get(model), group = src.group.clone(true);
  const a = [], b = []; src.group.traverse(o => a.push(o)); group.traverse(o => b.push(o));
  const map = new Map(a.map((o, i) => [o, b[i]]));
  const parts = {}; for (const [k, v] of Object.entries(src.parts)) { parts[k] = map.get(v); parts[k].userData.home = v.position.clone(); parts[k].userData.rot = v.rotation.clone(); }
  return { ...src, group, parts, muzzle: map.get(src.muzzle) };
}
export const casingMesh = () => new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.02, 6), gunMat('brass'));
