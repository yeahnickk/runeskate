// CODScape's guns as low-poly models: real proportions (an M4 is 0.84 long, an Intervention 1.24), flat-shaded
// like the RS world, with the moving parts split out so the reloads move them: the magazine drops, the bolt
// rides back, the slide locks, the pump racks. Built from boxes and cylinders, no assets.
// Gun space: x right, y up, the barrel along -z. The origin is where the right hand grips (top of the pistol
// grip). Each model reports: muzzle (Object3D at the barrel tip), fore (where the left hand holds), sightY
// (the sight line's height over the origin: ADS lines it up with the eye), magPos (the mag's seat), eject
// (the ejection port), parts { mag, bolt, slide, pump, handle, cover }, scope (a scoped rifle).
import * as THREE from 'three';

const M = {};
// colours are given as-is (linear, like the RS world's baked colours): no sRGB conversion on the way in
const col = (hex, k = 1) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace).multiplyScalar(k);
const mat = (hex, k = 1) => M[hex + ':' + k] ||= new THREE.MeshLambertMaterial({ color: col(hex, k), flatShading: true });
const glow = hex => M['g' + hex] ||= new THREE.MeshBasicMaterial({ color: col(hex), toneMapped: false });
const STEEL = 0x55585e, DARK = 0x34363b, POLY = 0x404246, WOOD = 0x8a5228, TAN = 0xc4a878, OD = 0x5f6644, BRASS = 0xd8b050, GLASS = 0x3a6090;

class Kit {
  constructor() { this.g = new THREE.Group(); this.parts = {}; }
  box(w, h, d, x, y, z, c, { rx = 0, ry = 0, rz = 0, to } = {}) {
    const m = new THREE.Mesh(BOX, mat(c)); m.scale.set(w, h, d); m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    (to || this.g).add(m); return m;
  }
  cyl(r, len, x, y, z, c, { axis = 'z', seg = 10, r2, to, rx = 0, ry = 0, rz = 0 } = {}) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r2 ?? r, r, len, seg), mat(c));
    m.position.set(x, y, z);
    if (axis === 'z') m.rotation.set(Math.PI / 2 + rx, ry, rz); else if (axis === 'x') m.rotation.set(rx, ry, Math.PI / 2 + rz); else m.rotation.set(rx, ry, rz);
    (to || this.g).add(m); return m;
  }
  part(name, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); g.userData.home = g.position.clone(); g.userData.rot = g.rotation.clone(); this.g.add(g); this.parts[name] = g; return g; }
  out(o) {
    const muzzle = new THREE.Object3D(); muzzle.position.copy(o.muzzle); this.g.add(muzzle);
    this.g.traverse(m => { if (m.isMesh) m.castShadow = false; });
    return { group: this.g, parts: this.parts, muzzle, fore: o.fore, sightY: o.sightY, magPos: o.magPos || new THREE.Vector3(0, -0.04, -0.06), eject: o.eject || new THREE.Vector3(0.03, 0.04, -0.02), scope: !!o.scope, reticle: o.reticle || null, len: o.len || 0.8, rl: o.rl || { style: 'rifle', empty: 'none' }, port: o.port || null };
  }
}
const BOX = new THREE.BoxGeometry(1, 1, 1);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// a curved box magazine hanging from its top (its own part, so a reload can pull it)
function curvedMag(k, name, z, len, w, d, curve, c, { y = -0.03, segs = 4 } = {}) {
  const mag = k.part(name, 0, y, z);
  for (let i = 0; i < segs; i++) {
    const t = (i + 0.5) / segs, a = curve * t;
    k.box(w, len / segs * 1.08, d, 0, -len * t, -Math.sin(a) * len * 0.45 * t, c, { rx: -a, to: mag });
  }
  k.box(w * 1.08, 0.012, d * 1.1, 0, -len - 0.004, -Math.sin(curve) * len * 0.45, DARK, { rx: -curve, to: mag });   // base plate
  return mag;
}
/** a square frame (aperture, window) centred at (0, y, z): outer size o, hole h, depth d */
function frame(k, y, z, o, h, d, c, to) {
  const t = (o - h) / 2;
  k.box(o, t, d, 0, y + (o - t) / 2, z, c, { to }); k.box(o, t, d, 0, y - (o - t) / 2, z, c, { to });
  k.box(t, h, d, -(o - t) / 2, y, z, c, { to }); k.box(t, h, d, (o - t) / 2, y, z, c, { to });
}
/** a red-dot sight on the rail at height y: a hollow window, the glowing dot in the middle of it */
function redDot(k, z, y, c = DARK) {
  k.box(0.034, 0.012, 0.06, 0, y, z, c);                                 // the mount
  const cy = y + 0.03;
  frame(k, cy, z - 0.026, 0.044, 0.034, 0.008, c);                        // the window
  k.box(0.006, 0.02, 0.02, 0.019, cy - 0.006, z, c);                      // the brightness turret
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0016, 6, 4), glow(0xff2020)); dot.position.set(0, cy, z - 0.026); k.g.add(dot);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.034, 0.034), new THREE.MeshBasicMaterial({ color: col(0x80c0ff), transparent: true, opacity: 0.12, depthWrite: false }));
  glass.position.set(0, cy, z - 0.0265); k.g.add(glass);
  return cy;                                                               // the dot's height
}
function scope(k, z0, z1, y, r = 0.022) {
  const len = z0 - z1, zc = (z0 + z1) / 2;
  k.cyl(r, len * 0.6, 0, y, zc, DARK, { seg: 12 });
  k.cyl(r * 1.45, len * 0.22, 0, y, z1 + len * 0.11, DARK, { seg: 12, r2: r });    // objective bell (front)
  k.cyl(r * 1.25, len * 0.18, 0, y, z0 - len * 0.09, DARK, { seg: 12 });           // eyepiece
  k.cyl(r * 0.9, 0.035, 0, y + r * 1.1, zc, DARK, { axis: 'y', seg: 8 });           // turrets
  k.cyl(r * 0.9, 0.035, r * 1.1, y, zc, DARK, { axis: 'x', seg: 8 });
  k.cyl(r * 1.3, 0.004, 0, y, z1 - 0.002, GLASS, { seg: 12 });
  k.box(0.02, y - 0.03, 0.02, 0, (y + 0.03) / 2, z0 - len * 0.25, DARK); k.box(0.02, y - 0.03, 0.02, 0, (y + 0.03) / 2, z1 + len * 0.3, DARK);   // rings
  return y;
}

const BUILD = {
  m4(c = STEEL) {
    const k = new Kit();
    k.box(0.05, 0.075, 0.34, 0, 0.012, -0.06, c);                           // upper + lower receiver
    k.box(0.044, 0.012, 0.34, 0, 0.056, -0.07, DARK);                        // top rail
    k.box(0.06, 0.064, 0.3, 0, 0.018, -0.375, POLY);                         // quad rail handguard
    for (let i = 0; i < 7; i++) k.box(0.066, 0.004, 0.012, 0, 0.018, -0.25 - i * 0.04, DARK);
    k.cyl(0.011, 0.24, 0, 0.018, -0.62, c);                                   // barrel
    k.cyl(0.016, 0.06, 0, 0.018, -0.765, DARK, { seg: 6 });                   // flash hider
    k.box(0.012, 0.06, 0.016, 0, 0.078, -0.535, c); k.box(0.004, 0.012, 0.004, 0, 0.112, -0.535, c);   // front sight post (A-frame), its tip on the sight line
    k.box(0.016, 0.02, 0.012, -0.012, 0.11, -0.535, c); k.box(0.016, 0.02, 0.012, 0.012, 0.11, -0.535, c);   // the A-frame's ears
    k.box(0.026, 0.03, 0.05, 0, 0.076, 0.055, c);                                                        // rear sight base
    frame(k, 0.118, 0.06, 0.02, 0.012, 0.006, c);                                                        // the rear aperture
    k.cyl(0.016, 0.22, 0, 0.022, 0.2, DARK);                                  // buffer tube
    k.box(0.04, 0.085, 0.16, 0, 0.0, 0.28, POLY);                             // stock
    k.box(0.04, 0.1, 0.045, 0, -0.06, 0.035, POLY, { rx: -0.35 });            // pistol grip
    k.box(0.01, 0.006, 0.07, 0, -0.03, -0.01, DARK);                          // trigger guard
    const h = k.part('handle', 0, 0.056, 0.11); k.box(0.05, 0.01, 0.02, 0, 0, 0, DARK, { to: h });   // charging handle
    k.part('bolt', 0.026, 0.02, -0.04); k.box(0.004, 0.026, 0.05, 0, 0, 0, BRASS, { to: k.parts.bolt });   // the bolt carrier in the port
    curvedMag(k, 'mag', -0.075, 0.18, 0.026, 0.065, 0.35, DARK);
    return k.out({ muzzle: V(0, 0.018, -0.8), fore: V(0, -0.02, -0.36), sightY: 0.118, len: 0.84, magPos: V(0, -0.03, -0.075), rl: { style: 'rifle', empty: 'release', at: V(-0.03, 0.0, -0.035) } });
  },
  ak() {
    const k = new Kit();
    k.box(0.046, 0.07, 0.36, 0, 0.006, -0.08, STEEL);                        // receiver
    k.box(0.044, 0.02, 0.26, 0, 0.05, -0.04, STEEL, { rx: 0 });              // dust cover
    k.box(0.054, 0.058, 0.2, 0, 0.006, -0.36, WOOD);                          // lower handguard
    k.box(0.04, 0.03, 0.2, 0, 0.05, -0.36, WOOD);                             // upper handguard (gas tube)
    k.cyl(0.01, 0.34, 0, 0.012, -0.6, STEEL);                                 // barrel
    k.cyl(0.008, 0.22, 0, 0.05, -0.55, STEEL);                                // gas tube
    k.box(0.014, 0.04, 0.03, 0, 0.04, -0.74, STEEL); k.cyl(0.014, 0.04, 0, 0.07, -0.74, STEEL, { axis: 'z', seg: 6 });   // front sight hood
    k.box(0.026, 0.022, 0.07, 0, 0.066, -0.2, STEEL);                         // rear sight leaf
    k.cyl(0.016, 0.03, 0, 0.012, -0.785, STEEL, { seg: 6 });                  // muzzle nut
    k.box(0.042, 0.06, 0.1, 0, -0.005, 0.13, WOOD, { rx: 0.05 });
    k.box(0.04, 0.11, 0.22, 0, -0.035, 0.28, WOOD, { rx: 0.12 });             // stock
    k.box(0.036, 0.095, 0.04, 0, -0.065, 0.04, WOOD, { rx: -0.4 });           // grip
    const b = k.part('bolt', 0.03, 0.03, 0.03); k.box(0.03, 0.012, 0.016, 0, 0, 0, STEEL, { to: b }); k.cyl(0.008, 0.02, 0.02, 0, 0, STEEL, { axis: 'x', to: b });   // charging knob on the right
    curvedMag(k, 'mag', -0.1, 0.2, 0.024, 0.07, 0.6, 0x7a4a24);              // the bakelite banana
    return k.out({ muzzle: V(0, 0.012, -0.81), fore: V(0, -0.02, -0.36), sightY: 0.082, len: 0.88, magPos: V(0, -0.03, -0.1), rl: { style: 'rifle', empty: 'handle', part: 'bolt', pull: 0.085, at: V(0.05, 0, 0) } });
  },
  scar() {
    const k = new Kit(), T = TAN;
    k.box(0.054, 0.06, 0.48, 0, 0.03, -0.18, T);                            // monolithic upper
    k.box(0.044, 0.012, 0.48, 0, 0.066, -0.18, DARK);                         // top rail
    k.box(0.048, 0.05, 0.16, 0, -0.02, -0.02, T);                             // lower
    k.cyl(0.012, 0.2, 0, 0.03, -0.52, DARK); k.box(0.026, 0.026, 0.05, 0, 0.03, -0.64, DARK);   // barrel + brake
    k.box(0.036, 0.1, 0.045, 0, -0.07, 0.04, T, { rx: -0.3 });
    k.box(0.036, 0.075, 0.2, 0, 0.0, 0.24, T); k.box(0.03, 0.02, 0.12, 0, 0.045, 0.23, T);   // folding stock + cheek rest
    const sy = redDot(k, -0.02, 0.078);
    k.part('handle', -0.03, 0.04, -0.2); k.box(0.02, 0.012, 0.012, 0, 0, 0, DARK, { to: k.parts.handle });   // non-reciprocating charger
    curvedMag(k, 'mag', -0.095, 0.13, 0.028, 0.072, 0.15, DARK);
    return k.out({ muzzle: V(0, 0.03, -0.67), fore: V(0, -0.0, -0.3), sightY: sy, len: 0.75, magPos: V(0, -0.045, -0.095), rl: { style: 'rifle', empty: 'handle', part: 'handle', pull: 0.08, at: V(-0.02, 0, 0) } });
  },
  famas() {
    const k = new Kit();
    k.box(0.06, 0.1, 0.58, 0, 0.0, -0.1, POLY);                              // bullpup body
    k.box(0.05, 0.02, 0.5, 0, 0.11, -0.12, DARK);                             // carry handle top
    k.box(0.016, 0.07, 0.02, 0, 0.075, -0.36, DARK); k.box(0.016, 0.07, 0.02, 0, 0.075, 0.1, DARK);   // its posts
    k.cyl(0.011, 0.18, 0, 0.0, -0.48, STEEL); k.cyl(0.015, 0.05, 0, 0.0, -0.585, DARK, { seg: 6 });
    k.box(0.036, 0.095, 0.04, 0, -0.08, -0.06, POLY, { rx: -0.3 });
    k.box(0.05, 0.03, 0.16, 0, -0.06, -0.18, POLY);                           // trigger guard / hand guard
    const h = k.part('handle', 0, 0.09, -0.15); k.box(0.012, 0.03, 0.02, 0, 0, 0, DARK, { to: h });   // the charging lever under the handle
    curvedMag(k, 'mag', 0.12, 0.14, 0.026, 0.065, 0.2, DARK, { y: -0.05 });   // behind the grip
    return k.out({ muzzle: V(0, 0.0, -0.61), fore: V(0, -0.04, -0.22), sightY: 0.13, len: 0.76, magPos: V(0, -0.05, 0.12), rl: { style: 'rifle', empty: 'handle', part: 'handle', pull: 0.08, at: V(0, -0.02, 0) } });
  },
  mp5() {
    const k = new Kit();
    k.cyl(0.026, 0.3, 0, 0.03, -0.08, STEEL, { seg: 10 });                    // receiver tube
    k.box(0.044, 0.04, 0.3, 0, 0.005, -0.08, STEEL);
    k.cyl(0.026, 0.14, 0, 0.012, -0.3, POLY, { seg: 10 });                     // handguard
    k.cyl(0.009, 0.08, 0, 0.026, -0.41, STEEL);
    k.cyl(0.012, 0.02, -0.024, 0.06, -0.2, STEEL, { seg: 6 });                 // cocking tube
    k.cyl(0.018, 0.03, 0, 0.07, -0.37, STEEL, { seg: 8 });                     // front sight hood
    k.cyl(0.016, 0.03, 0, 0.07, 0.04, STEEL, { axis: 'x', seg: 8 });            // rear drum sight
    k.box(0.006, 0.05, 0.2, -0.02, 0.0, 0.16, STEEL); k.box(0.006, 0.05, 0.2, 0.02, 0.0, 0.16, STEEL); k.box(0.05, 0.07, 0.02, 0, -0.01, 0.26, DARK);   // retractable stock
    k.box(0.034, 0.1, 0.045, 0, -0.065, 0.02, POLY, { rx: -0.25 });
    k.box(0.01, 0.006, 0.07, 0, -0.03, -0.03, DARK);
    const h = k.part('handle', -0.034, 0.06, -0.3); k.box(0.012, 0.03, 0.012, 0, 0, 0, DARK, { to: h });   // the HK slap lever
    curvedMag(k, 'mag', -0.1, 0.19, 0.02, 0.05, 0.45, DARK, { y: -0.015 });
    return k.out({ muzzle: V(0, 0.026, -0.45), fore: V(0, -0.01, -0.3), sightY: 0.092, len: 0.66, magPos: V(0, -0.015, -0.1), rl: { style: 'rifle', empty: 'hk', part: 'handle', pull: 0.075, at: V(-0.015, 0, 0) } });
  },
  mp7() {
    const k = new Kit();
    k.box(0.05, 0.08, 0.3, 0, 0.02, -0.1, POLY);
    k.box(0.04, 0.01, 0.26, 0, 0.065, -0.1, DARK);
    k.cyl(0.01, 0.07, 0, 0.03, -0.28, STEEL); k.cyl(0.013, 0.03, 0, 0.03, -0.32, DARK, { seg: 6 });
    k.box(0.03, 0.08, 0.03, 0, -0.05, -0.2, POLY, { rx: 0.1 });               // folding foregrip
    k.box(0.006, 0.04, 0.14, -0.02, 0.0, 0.11, DARK); k.box(0.006, 0.04, 0.14, 0.02, 0.0, 0.11, DARK); k.box(0.046, 0.05, 0.02, 0, -0.01, 0.18, DARK);
    const sy = redDot(k, -0.05, 0.072);
    k.part('handle', 0, 0.068, 0.04); k.box(0.04, 0.01, 0.014, 0, 0, 0, DARK, { to: k.parts.handle });
    const mag = k.part('mag', 0, -0.02, 0.02);                                 // the mag rides in the grip
    k.box(0.032, 0.17, 0.045, 0, -0.07, 0.0, POLY, { rx: -0.15, to: mag });
    k.box(0.034, 0.012, 0.05, 0, -0.16, 0.012, DARK, { rx: -0.15, to: mag });
    return k.out({ muzzle: V(0, 0.03, -0.34), fore: V(0, -0.08, -0.2), sightY: sy, len: 0.42, magPos: V(0, -0.02, 0.02), rl: { style: 'rifle', empty: 'handle', part: 'handle', pull: 0.05, at: V(0, 0.015, 0.01) } });
  },
  ump() {
    const k = new Kit();
    k.box(0.054, 0.09, 0.42, 0, 0.01, -0.12, POLY);
    k.box(0.04, 0.012, 0.28, 0, 0.062, -0.08, DARK);
    k.cyl(0.011, 0.06, 0, 0.03, -0.36, STEEL); k.cyl(0.014, 0.03, 0, 0.03, -0.4, DARK, { seg: 6 });
    k.box(0.036, 0.1, 0.045, 0, -0.07, 0.04, POLY, { rx: -0.25 });
    k.box(0.044, 0.07, 0.18, 0, 0.0, 0.18, POLY); k.box(0.04, 0.03, 0.04, 0, 0.0, 0.28, POLY);
    const sy = redDot(k, -0.04, 0.072);
    k.part('handle', -0.032, 0.04, -0.2); k.box(0.012, 0.012, 0.02, 0, 0, 0, DARK, { to: k.parts.handle });
    const mag = k.part('mag', 0, -0.035, -0.11); k.box(0.03, 0.17, 0.06, 0, -0.085, -0.01, POLY, { rx: -0.08, to: mag });
    return k.out({ muzzle: V(0, 0.03, -0.42), fore: V(0, -0.02, -0.27), sightY: sy, len: 0.6, magPos: V(0, -0.035, -0.11), rl: { style: 'rifle', empty: 'handle', part: 'handle', pull: 0.07, at: V(-0.015, 0, 0) } });
  },
  m249() {
    const k = new Kit();
    k.box(0.07, 0.1, 0.4, 0, 0.02, -0.08, OD, { });                         // receiver
    const cover = k.part('cover', 0, 0.075, 0.08);                              // feed tray cover, hinged at the back
    k.box(0.068, 0.025, 0.24, 0, 0, -0.12, OD, { to: cover });
    k.box(0.016, 0.03, 0.03, 0, 0.025, -0.04, DARK, { to: cover });           // rear sight on the cover
    k.box(0.06, 0.05, 0.18, 0, 0.0, -0.36, DARK);                              // handguard/heat shield
    k.cyl(0.013, 0.36, 0, 0.02, -0.62, STEEL); k.cyl(0.018, 0.05, 0, 0.02, -0.82, DARK, { seg: 6 });
    k.box(0.01, 0.06, 0.012, 0, 0.065, -0.76, DARK);                           // front sight
    k.box(0.02, 0.04, 0.12, 0, 0.11, -0.25, DARK);                             // carry handle
    k.box(0.006, 0.18, 0.012, -0.015, -0.06, -0.7, DARK, { rx: -1.35 }); k.box(0.006, 0.18, 0.012, 0.015, -0.06, -0.7, DARK, { rx: -1.35 });   // folded bipod
    k.box(0.036, 0.1, 0.045, 0, -0.07, 0.06, POLY, { rx: -0.25 });
    k.box(0.04, 0.1, 0.22, 0, 0.0, 0.26, POLY); k.cyl(0.02, 0.14, 0, 0.02, 0.15, DARK);
    const mag = k.part('mag', -0.02, -0.04, -0.12);                          // the 100-round box pouch, hanging left
    k.box(0.08, 0.13, 0.12, -0.03, -0.06, 0, 0x3c4130, { to: mag }); k.box(0.084, 0.02, 0.124, -0.03, 0.01, 0, 0x2d3124, { to: mag });
    k.part('handle', 0.04, 0.02, -0.1); k.box(0.02, 0.012, 0.02, 0, 0, 0, DARK, { to: k.parts.handle });
    return k.out({ muzzle: V(0, 0.02, -0.85), fore: V(0, -0.02, -0.38), sightY: 0.122, len: 1.0, magPos: V(-0.02, -0.04, -0.12), rl: { style: 'lmg', empty: 'handle', part: 'handle', pull: 0.09, at: V(0.02, 0, 0) } });
  },
  intervention() {
    const k = new Kit(), c = 0x3b3d2c;
    k.box(0.05, 0.06, 0.34, 0, 0.01, -0.12, c);                                // receiver/chassis
    k.cyl(0.015, 0.62, 0, 0.02, -0.6, DARK, { seg: 8 });                        // long fluted barrel
    k.box(0.04, 0.034, 0.08, 0, 0.02, -0.94, DARK);                            // muzzle brake
    k.box(0.05, 0.05, 0.24, 0, 0.0, -0.4, c);                                   // fore end
    k.box(0.036, 0.1, 0.045, 0, -0.07, 0.05, c, { rx: -0.35 });
    k.box(0.016, 0.14, 0.03, 0, -0.01, 0.2, c); k.box(0.04, 0.03, 0.22, 0, 0.04, 0.24, c); k.box(0.04, 0.03, 0.2, 0, -0.07, 0.25, c);   // skeleton stock
    k.box(0.05, 0.12, 0.03, 0, -0.01, 0.36, DARK);                              // butt pad
    const bolt = k.part('bolt', 0.026, 0.035, 0.0);                            // bolt + handle: lifts and draws back
    k.cyl(0.012, 0.12, -0.02, 0, -0.02, STEEL, { to: bolt }); k.cyl(0.005, 0.05, 0.02, 0, 0.02, STEEL, { axis: 'x', to: bolt }); k.cyl(0.011, 0.012, 0.045, 0, 0.02, DARK, { axis: 'x', seg: 8, to: bolt });
    const sy = scope(k, 0.06, -0.26, 0.095, 0.022);
    const mag = k.part('mag', 0, -0.03, -0.09); k.box(0.03, 0.08, 0.08, 0, -0.04, 0, DARK, { to: mag });
    return k.out({ muzzle: V(0, 0.02, -0.98), fore: V(0, -0.03, -0.4), sightY: sy, scope: true, reticle: 'mil', len: 1.24, magPos: V(0, -0.03, -0.09), rl: { style: 'rifle', empty: 'bolt' } });
  },
  barrett() {
    const k = new Kit(), c = 0x2b2b2b;
    k.box(0.07, 0.11, 0.62, 0, 0.0, -0.08, c);                                  // the big receiver
    k.box(0.05, 0.014, 0.4, 0, 0.062, -0.1, DARK);
    k.cyl(0.018, 0.5, 0, 0.02, -0.62, DARK, { seg: 8 });
    k.box(0.07, 0.045, 0.1, 0, 0.02, -0.9, DARK); k.box(0.074, 0.05, 0.012, 0, 0.02, -0.88, c); k.box(0.074, 0.05, 0.012, 0, 0.02, -0.92, c);   // double-chamber brake
    k.box(0.04, 0.1, 0.05, 0, -0.08, 0.06, c, { rx: -0.3 });
    k.box(0.05, 0.12, 0.12, 0, -0.01, 0.3, DARK);
    k.box(0.02, 0.04, 0.14, 0, 0.11, -0.05, DARK);                               // carry handle
    k.box(0.006, 0.22, 0.014, -0.02, -0.07, -0.5, DARK, { rx: -1.4 }); k.box(0.006, 0.22, 0.014, 0.02, -0.07, -0.5, DARK, { rx: -1.4 });
    k.part('handle', 0.04, 0.03, -0.02); k.box(0.02, 0.016, 0.02, 0, 0, 0, DARK, { to: k.parts.handle });
    const sy = scope(k, 0.1, -0.24, 0.11, 0.024);
    const mag = k.part('mag', 0, -0.055, -0.06); k.box(0.05, 0.11, 0.11, 0, -0.05, 0, c, { to: mag });
    return k.out({ muzzle: V(0, 0.02, -0.96), fore: V(0, -0.04, -0.34), sightY: sy, scope: true, reticle: 'mil', len: 1.45, magPos: V(0, -0.055, -0.06), rl: { style: 'rifle', empty: 'handle', part: 'handle', pull: 0.1, at: V(0.02, 0, 0) } });
  },
  r870() {
    const k = new Kit();
    k.box(0.05, 0.08, 0.22, 0, 0.01, -0.06, STEEL);                            // receiver
    k.cyl(0.013, 0.5, 0, 0.032, -0.42, STEEL);                                  // barrel
    k.cyl(0.013, 0.4, 0, 0.0, -0.37, STEEL);                                    // magazine tube
    k.cyl(0.004, 0.01, 0, 0.05, -0.66, BRASS, { axis: 'y', seg: 6 });            // bead
    const pump = k.part('pump', 0, 0.0, -0.32); k.box(0.05, 0.05, 0.16, 0, -0.004, 0, POLY, { to: pump });
    for (let i = 0; i < 5; i++) k.box(0.054, 0.004, 0.008, 0, -0.004, -0.06 + i * 0.03, DARK, { to: pump });
    k.box(0.036, 0.1, 0.045, 0, -0.065, 0.05, POLY, { rx: -0.35 });
    k.box(0.04, 0.09, 0.26, 0, -0.03, 0.22, POLY, { rx: 0.08 });
    k.box(0.006, 0.02, 0.06, 0.026, 0.02, -0.06, DARK);                         // ejection port
    return k.out({ muzzle: V(0, 0.032, -0.67), fore: V(0, -0.02, -0.32), sightY: 0.058, len: 0.95, magPos: V(0, -0.02, -0.08), rl: { style: 'shells', empty: 'pump' }, port: V(0, -0.035, -0.06) });
  },
  m1911() {
    const k = new Kit();
    const slide = k.part('slide', 0, 0.035, -0.06); k.box(0.028, 0.032, 0.2, 0, 0, 0, STEEL, { to: slide });
    k.box(0.005, 0.013, 0.006, 0, 0.022, -0.095, STEEL, { to: slide }); k.box(0.008, 0.013, 0.008, -0.008, 0.022, 0.09, STEEL, { to: slide }); k.box(0.008, 0.013, 0.008, 0.008, 0.022, 0.09, STEEL, { to: slide });   // front post, rear notch
    k.box(0.026, 0.02, 0.17, 0, 0.012, -0.05, STEEL);                            // frame
    k.cyl(0.006, 0.01, 0, 0.035, -0.165, DARK, { seg: 6 });
    k.box(0.03, 0.11, 0.04, 0, -0.045, 0.03, WOOD, { rx: -0.2 });                // grip panels
    k.box(0.012, 0.016, 0.012, 0, 0.04, 0.05, STEEL, { rx: 0.5 });              // hammer
    k.box(0.008, 0.006, 0.05, 0, -0.012, -0.03, STEEL);
    const mag = k.part('mag', 0, -0.02, 0.03); k.box(0.022, 0.1, 0.034, 0, -0.04, 0.008, DARK, { rx: -0.2, to: mag });
    return k.out({ muzzle: V(0, 0.035, -0.17), fore: V(-0.005, -0.06, 0.02), sightY: 0.062, len: 0.22, magPos: V(0, -0.02, 0.03), rl: { style: 'pistol', empty: 'slide', part: 'slide', pull: 0.045, at: V(0, 0.022, 0.07) } });
  },
  deagle() {
    const k = new Kit(), c = 0x8d8d8d;
    const slide = k.part('slide', 0, 0.04, -0.07); k.box(0.032, 0.04, 0.24, 0, 0, 0, c, { to: slide });
    k.box(0.005, 0.014, 0.006, 0, 0.027, -0.115, c, { to: slide }); k.box(0.009, 0.014, 0.008, -0.009, 0.027, 0.11, c, { to: slide }); k.box(0.009, 0.014, 0.008, 0.009, 0.027, 0.11, c, { to: slide });
    k.box(0.03, 0.022, 0.2, 0, 0.012, -0.06, c); k.box(0.016, 0.01, 0.2, 0, 0.064, -0.07, DARK);
    k.box(0.034, 0.12, 0.045, 0, -0.05, 0.03, DARK, { rx: -0.2 });
    k.box(0.008, 0.006, 0.05, 0, -0.014, -0.03, c);
    const mag = k.part('mag', 0, -0.02, 0.03); k.box(0.024, 0.11, 0.036, 0, -0.045, 0.008, DARK, { rx: -0.2, to: mag });
    return k.out({ muzzle: V(0, 0.04, -0.2), fore: V(-0.005, -0.065, 0.02), sightY: 0.074, len: 0.27, magPos: V(0, -0.02, 0.03), rl: { style: 'pistol', empty: 'slide', part: 'slide', pull: 0.05, at: V(0, 0.026, 0.08) } });
  },
  g18() {
    const k = new Kit();
    const slide = k.part('slide', 0, 0.035, -0.055); k.box(0.026, 0.03, 0.18, 0, 0, 0, STEEL, { to: slide });
    k.box(0.005, 0.014, 0.006, 0, 0.022, -0.085, STEEL, { to: slide }); k.box(0.007, 0.014, 0.008, -0.007, 0.022, 0.08, STEEL, { to: slide }); k.box(0.007, 0.014, 0.008, 0.007, 0.022, 0.08, STEEL, { to: slide });
    k.box(0.026, 0.024, 0.16, 0, 0.01, -0.05, POLY);
    k.box(0.03, 0.1, 0.04, 0, -0.045, 0.03, POLY, { rx: -0.22 });
    k.box(0.008, 0.006, 0.05, 0, -0.012, -0.03, POLY);
    const mag = k.part('mag', 0, -0.02, 0.03); k.box(0.022, 0.15, 0.032, 0, -0.06, 0.012, DARK, { rx: -0.22, to: mag });   // the extended mag
    return k.out({ muzzle: V(0, 0.035, -0.15), fore: V(-0.005, -0.06, 0.02), sightY: 0.064, len: 0.2, magPos: V(0, -0.02, 0.03), rl: { style: 'pistol', empty: 'slide', part: 'slide', pull: 0.04, at: V(0, 0.02, 0.06) } });
  },
  knife() {
    const k = new Kit();
    k.box(0.024, 0.03, 0.11, 0, 0, 0.02, POLY);
    k.box(0.05, 0.034, 0.012, 0, 0, -0.04, DARK);
    const bl = k.box(0.004, 0.03, 0.17, 0, 0.004, -0.13, 0xb8bcc0); bl.material = mat(0xb8bcc0, 1.1);
    return k.out({ muzzle: V(0, 0, -0.22), fore: V(0, 0, 0), sightY: 0, len: 0.3 });
  },
  frag() {
    const k = new Kit();
    k.cyl(0.03, 0.07, 0, 0, 0, OD, { axis: 'y', seg: 8 });
    k.cyl(0.012, 0.03, 0, 0.045, 0, DARK, { axis: 'y', seg: 6 }); k.box(0.012, 0.05, 0.016, 0.018, 0.03, 0, STEEL, { rz: -0.4 });
    return k.out({ muzzle: V(0, 0, 0), fore: V(0, 0, 0), sightY: 0, len: 0.1 });
  },
};
BUILD.semtex = () => { const g = BUILD.frag(); g.group.traverse(m => { if (m.isMesh && m.material === mat(OD)) m.material = mat(0x8a8a6a); }); return g; };

const cache = new Map();
/** a fresh copy of a gun model (model key from src/cod/weapons.js: m4, ak, ..., knife, frag) */
export function buildGun(model) {
  const f = BUILD[model] || BUILD.m4;
  if (!cache.has(model)) cache.set(model, f());
  const src = cache.get(model), group = src.group.clone(true);
  // re-find the parts and muzzle in the clone (same child order)
  const map = new Map(); const a = [], b = [];
  src.group.traverse(o => a.push(o)); group.traverse(o => b.push(o)); a.forEach((o, i) => map.set(o, b[i]));
  const parts = {}; for (const [k, v] of Object.entries(src.parts)) { parts[k] = map.get(v); parts[k].userData.home = v.position.clone(); parts[k].userData.rot = v.rotation.clone(); }
  const muzzle = group.children[group.children.length - 1];
  return { ...src, group, parts, muzzle };
}

/** a spent casing / a dropped mag: a small mesh in a colour */
export const casingMesh = () => new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.02, 5), mat(BRASS, 1.1));
export { mat as gunMat };
