// Rune League's stadium, in uu inside the arena group (scaled by SITE.K into the world): built like the RS world is
// drawn (flat-coloured faces, the light baked into the colours, no textures), and dressed with real RS models out of
// the 2004 cache (rsmodels.js) at the world's own scale, so it sits in Lumbridge like it was always there:
//  - the pitch: the patch's grass in mown bands, a little of each team's colour toward their end, chalk lines
//  - the walls swept round RL's octagon: turf quarter pipes, a barn-plank wall with a team trim, clear above with oak
//    posts, the patch's own fence along the top and rafters over the roof
//  - the goals: oak frames painted in the team's colour, rope nets; the team's standards, flags and banners outside
//  - the boost: real energy potions over the big pads, real rune essence over the small; the ball: RS's cabbage
//  - outside: haystacks, hay bales, the scarecrow, benches, torches, rows of cabbages (the crowd is main.js's)
import * as THREE from 'three';
import { W, L, H, R, CH, GW, GH, GD, PADS, D } from './arena.js';
import { meshOf, merged, rsMat } from './rsmodels.js';

export const TEAM = [{ name: 'BLUE', col: 0x2f6bff, dark: 0x16307a, css: '#4a86ff' }, { name: 'ORANGE', col: 0xff8a1a, dark: 0x8a3a06, css: '#ff9a2a' }];
const S2 = Math.SQRT2, kx = W - R, kz = L - R, kc = CH - R * S2;
export const TS = 600 / 128;                                     // RS units -> uu (a tile is 600 uu here: 1.5 world units at K)

// ---------------------------------------------------------------- baked light (RS bakes its light into the colours too)
const SUN = new THREE.Vector3(-0.42, 0.8, 0.43).normalize();
const shade = (c, n, ao = 1) => { const k = (0.66 + 0.42 * Math.max(0, n.x * SUN.x + n.y * SUN.y + n.z * SUN.z)) * ao; return [c[0] * k, c[1] * k, c[2] * k]; };
const rgb = h => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();
/** a growing list of flat-coloured triangles, one mesh at the end */
class Soup {
  constructor() { this.P = []; this.C = []; }
  /** a quad a b c d (in order round it), one colour per corner (or one for all), lit by its face normal */
  quad(a, b, c, d, col, ao = [1, 1, 1, 1], lit = true) {
    _a.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]); _b.set(d[0] - b[0], d[1] - b[1], d[2] - b[2]); _n.crossVectors(_a, _b).normalize();
    if (_n.y < 0 || (_n.y === 0 && _n.x * SUN.x + _n.z * SUN.z < 0)) _n.negate();   // (double sided: light whichever face looks up / sunward)
    const cs = Array.isArray(col[0]) ? col : [col, col, col, col];
    const cl = [0, 1, 2, 3].map(i => lit ? shade(cs[i], _n, ao[i]) : cs[i].map(x => x * ao[i])), vs = [a, b, c, d];
    for (const i of [0, 1, 2, 0, 2, 3]) { this.P.push(vs[i][0], vs[i][1], vs[i][2]); this.C.push(cl[i][0], cl[i][1], cl[i][2]); }
  }
  mesh(mat = rsMat) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3)); return new THREE.Mesh(g, mat); }
}
/** a square beam (oak posts, rafters) from p0 to p1, w thick */
function beam(S, p0, p1, w, col) {
  const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1), d = b.clone().sub(a).normalize();
  let u = new THREE.Vector3(0, 1, 0); if (Math.abs(u.dot(d)) > 0.9) u = new THREE.Vector3(1, 0, 0);
  const s = new THREE.Vector3().crossVectors(d, u).normalize().multiplyScalar(w / 2), t = new THREE.Vector3().crossVectors(s, d).normalize().multiplyScalar(w / 2);
  const c = (o, i, j) => o.clone().addScaledVector(s, i).addScaledVector(t, j).toArray();
  for (const [i0, j0, i1, j1] of [[1, 1, -1, 1], [-1, 1, -1, -1], [-1, -1, 1, -1], [1, -1, 1, 1]]) S.quad(c(a, i0, j0), c(b, i0, j0), c(b, i1, j1), c(a, i1, j1), col);
  S.quad(c(b, 1, 1), c(b, -1, 1), c(b, -1, -1), c(b, 1, -1), col);
}
// a little noise that holds still (RS's ground varies tile to tile)
const hash = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };
const noise = (x, z, f) => { const X = x / f, Z = z / f, i = Math.floor(X), j = Math.floor(Z), u = X - i, v = Z - j, sm = t => t * t * (3 - 2 * t); const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1); return a + (b - a) * sm(u) + (c - a) * sm(v) + (a - b - c + d) * sm(u) * sm(v); };

// ---------------------------------------------------------------- colours
const GRASS = rgb(0x4f7f2c), GRASS2 = rgb(0x5b8d34), TURF = rgb(0x48752a), CHALK = rgb(0xe8e6da);
const PLANKS = [0x6f4b29, 0x76502d].map(rgb), OAK = rgb(0x5c3b1c), OAK_D = rgb(0x46301a);
const teamC = t => rgb(TEAM[t].col);
/** the grass at (x, z): mown bands, RS-ish variation, each end leaning toward its team */
function grassAt(x, z, band = Math.floor((z + 6144) / 512) % 2) {
  const n = noise(x + 9000, z, 2600);                              // (broad and gentle: a real pitch, not patches)
  let c = band ? GRASS : GRASS2; c = c.map(v => v * (0.97 + 0.06 * n));
  const far = Math.max(0, Math.min(1, (Math.abs(z) - 1500) / 4000)); c = mix(c, teamC(z < 0 ? 0 : 1), far * 0.06);
  // a touch of shade where the floor meets the wall (a soft contact shadow)
  const w = Math.max(0, Math.min(1, (D(x, 700, z) - 256) / 1100));
  return c.map(v => v * (0.84 + 0.16 * w * w * (3 - 2 * w)));
}

// ---------------------------------------------------------------- the walls: a profile swept round the octagon
const OCT = [[kc - kz, kz], [-(kc - kz), kz], [-kx, kc - kx], [-kx, -(kc - kx)], [-(kc - kz), -kz], [kc - kz, -kz], [kx, -(kc - kx)], [kx, kc - kx]];
/** samples round the octagon: { b: base point on it, m: outward normal, s: distance round, back: on an end wall } */
function ring(step = 300) {
  const out = []; let s = 0, prev = null;
  const push = (b, m, back) => { if (prev) s += Math.hypot(b[0] - prev[0], b[1] - prev[1]); out.push({ b, m, s, back }); prev = b; };
  for (let i = 0; i < 8; i++) {
    const a = OCT[i], c = OCT[(i + 1) % 8], dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz), m = [dz / l, -dx / l];
    const back = Math.abs(dz) < 1;
    let ts = []; const n = Math.max(2, Math.ceil(l / step)); for (let j = 0; j <= n; j++) ts.push(j / n);
    if (back) { for (const x of [-GW, GW]) ts.push((x - a[0]) / dx); ts = ts.filter(t => t >= 0 && t <= 1).sort((p, q) => p - q); }
    for (const t of ts) push([a[0] + dx * t, a[1] + dz * t], m, back);
    const c2 = OCT[(i + 2) % 8], dx2 = c2[0] - c[0], dz2 = c2[1] - c[1], l2 = Math.hypot(dx2, dz2), m2 = [dz2 / l2, -dx2 / l2];
    const a0 = Math.atan2(m[1], m[0]); let a1 = Math.atan2(m2[1], m2[0]); while (a1 > a0) a1 -= Math.PI * 2; while (a1 < a0 - Math.PI) a1 += Math.PI * 2;
    for (let j = 1; j < 6; j++) { const aa = a0 + (a1 - a0) * j / 6; push([c[0], c[1]], [Math.cos(aa), Math.sin(aa)], false); }
  }
  push(out[0].b, out[0].m, out[0].back);
  return out;
}
/** the profile up the wall: [offset out from the octagon, height, part] */
function profile() {
  const P = [];
  for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + i / 8 * Math.PI / 2; P.push([R * Math.cos(a), R + R * Math.sin(a), 'turf']); }
  for (const y of [GH, 860, 900]) P.push([R, y, y === 900 ? 'trim' : 'wood']);
  for (const y of [1300, H - R]) P.push([R, y, 'glass']);
  for (let i = 1; i <= 6; i++) { const a = i / 6 * Math.PI / 2; P.push([R * Math.cos(a), H - R + R * Math.sin(a), 'glass']); }
  return P;
}

export function buildArena(lite) {
  const group = new THREE.Group(), RG = ring(), PR = profile(), S = new Soup(), G = { P: [], C: [] };
  const vtx = (j, k, out = 0) => { const { b, m } = RG[j], [o, y] = PR[k]; return [b[0] + m[0] * (o + out), y, b[1] + m[1] * (o + out)]; };
  const goalMouth = (j, k) => RG[j].back && RG[j + 1].back && Math.abs((RG[j].b[0] + RG[j + 1].b[0]) / 2) < GW && PR[k + 1][1] <= GH + 1;
  const L2 = (p, r, t) => [p[0] + (r[0] - p[0]) * t, p[1] + (r[1] - p[1]) * t, p[2] + (r[2] - p[2]) * t];
  for (let j = 0; j < RG.length - 1; j++) {
    const team = (RG[j].b[1] + RG[j + 1].b[1]) / 2 < 0 ? 0 : 1;
    for (let k = 0; k < PR.length - 1; k++) {
      const part = PR[k + 1][2];
      if (goalMouth(j, k) || PR[k][1] >= H - 1) continue;
      const a = vtx(j, k), b2 = vtx(j + 1, k), c = vtx(j + 1, k + 1), d = vtx(j, k + 1);
      if (part === 'turf') {
        const g = p => mix(grassAt(p[0] * 0.98, p[2] * 0.98), TURF, Math.min(1, p[1] / R) * 0.6), ao = p => 0.86 + 0.14 * Math.min(1, p[1] / 120);
        S.quad(a, b2, c, d, [g(a), g(b2), g(c), g(d)], [ao(a), ao(b2), ao(c), ao(d)]);
      } else if (part === 'wood') {
        // planks: ~110 uu boards, each its own shade (like RS's wooden walls), darker toward the floor
        const len = Math.hypot(b2[0] - a[0], b2[2] - a[2]), n = Math.max(1, Math.round(len / 110));
        for (let q = 0; q < n; q++) {
          const t0 = q / n, t1 = (q + 1) / n, col = q % 2 ? PLANKS[0] : PLANKS[1], ao = y => 0.8 + 0.2 * Math.min(1, (y - R) / 500);
          S.quad(L2(a, b2, t0), L2(a, b2, t1), L2(d, c, t1), L2(d, c, t0), col, [ao(a[1]), ao(b2[1]), ao(c[1]), ao(d[1])]);
        }
      } else if (part === 'trim') S.quad(a, b2, c, d, teamC(team));
      else { const t = mix([0.75, 0.85, 0.9], teamC(team), 0.25); for (const v of [a, b2, c, a, c, d]) { G.P.push(v[0], v[1], v[2]); G.C.push(t[0], t[1], t[2]); } }
    }
  }
  // the cut through the quarter pipe either side of each goal mouth (a flat face under the curve)
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    const pts = []; for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + i / 8 * Math.PI / 2; pts.push([kz + R * Math.cos(a), R + R * Math.sin(a)]); }
    for (let i = 0; i < pts.length - 1; i++) { const [z0, y0] = pts[i], [z1, y1] = pts[i + 1], P = (z, y) => [sx * GW, y, sz * z]; S.quad(P(z0, 0), P(z0, y0), P(z1, y1), P(z1, 0), TURF); }
  }
  // the pitch: a grid of grass (coloured per corner), the goals' floors leaning to the team's colour, the octagon under it all
  const step = lite ? 256 : 160;
  const floorAt = (x, z) => { const ax = Math.abs(x), az = Math.abs(z); return (ax <= kx && az <= kz && ax + az <= kc) || (ax <= GW && az <= L + GD); };
  const zs = step / 2 > 100 ? 256 : 128;                            // (rows split the 512 mown bands evenly: crisp stripes)
  for (let x = -kx; x < kx; x += step) for (let z = -6144; z < L + GD; z += zs) {
    const x1 = Math.min(kx, x + step), z1 = Math.min(L + GD, z + zs), za = Math.max(z, -(L + GD));
    if (z1 <= za || !floorAt(x, za) || !floorAt(x1, za) || !floorAt(x, z1) || !floorAt(x1, z1)) continue;
    const band = Math.floor((z + 6144) / 512) % 2, inGoal = Math.abs(z + zs / 2) > L;
    const g = (px, pz) => { const c = grassAt(px, pz, band); return inGoal ? mix(c, teamC(pz < 0 ? 0 : 1), 0.25) : c; };
    S.quad([x, 0, za], [x1, 0, za], [x1, 0, z1], [x, 0, z1], [g(x, za), g(x1, za), g(x1, z1), g(x, z1)]);
  }
  { const sh = new THREE.Shape(); OCT.forEach(([x, z], i) => i ? sh.lineTo(x, -z) : sh.moveTo(x, -z)); sh.closePath();
    const fg = new THREE.ShapeGeometry(sh); fg.rotateX(-Math.PI / 2); fg.translate(0, -2, 0);
    group.add(new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: new THREE.Color(...shade(GRASS, new THREE.Vector3(0, 1, 0), 0.85)) }))); }
  // chalk: the halfway line, the centre circle and spot, the boxes; strips a hair over the grass
  const chalk = (pts, w = 34) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1], l = Math.hypot(x1 - x0, z1 - z0) || 1, nx = -(z1 - z0) / l * w / 2, nz = (x1 - x0) / l * w / 2, ex = (x1 - x0) / l * w / 2, ez = (z1 - z0) / l * w / 2;
      S.quad([x0 - nx - ex, 2, z0 - nz - ez], [x1 - nx + ex, 2, z1 - nz + ez], [x1 + nx + ex, 2, z1 + nz + ez], [x0 + nx - ex, 2, z0 + nz - ez], CHALK, [0.95, 0.95, 0.95, 0.95]);
    }
  };
  const arc = (cx, cz, r, a0, a1, n = 48) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]; });
  chalk([[-kx, 0], [kx, 0]]); chalk(arc(0, 0, 1000, 0, Math.PI * 2, 64)); chalk(arc(0, 0, 35, 0, Math.PI * 2, 12), 70);
  for (const s of [-1, 1]) { chalk([[-1900, s * L], [-1900, s * (L - 1500)], [1900, s * (L - 1500)], [1900, s * L]]); chalk([[-GW, s * L], [GW, s * L]], 50); chalk(arc(0, s * (L - 1500), 600, s > 0 ? Math.PI : 0, s > 0 ? Math.PI * 2 : Math.PI, 24)); }
  // the goals: oak frames painted in the team's colour (posts, crossbar, the back frame), rope nets
  const nets = new Soup(), V = (x, y, z) => new THREE.Vector3(x, y, z);
  for (const [s, t] of [[-1, 0], [1, 1]]) {
    const z0 = s * (L + 20), z1 = s * (L + GD), tc = teamC(t);
    for (const sx of [-1, 1]) { beam(S, [sx * (GW + 30), 0, z0], [sx * (GW + 30), GH + 60, z0], 64, tc); beam(S, [sx * (GW + 20), 0, z1], [sx * (GW + 20), GH + 20, z1], 44, OAK); beam(S, [sx * (GW + 20), GH + 20, z0], [sx * (GW + 20), GH + 20, z1], 40, OAK); }
    beam(S, [-(GW + 62), GH + 30, z0], [GW + 62, GH + 30, z0], 64, tc); beam(S, [-(GW + 20), GH + 20, z1], [GW + 20, GH + 20, z1], 44, OAK);
    for (const sx of [-1, 1]) for (const y of [140, 380]) beam(S, [sx * (GW + 30), y, z0], [sx * (GW + 30), y + 40, z0], 68, CHALK);   // (white bands on the posts)
    // the nets: rope squares (thin strips both ways), over a faint team-coloured sheet
    const rope = rgb(0xcfc29a);
    const cord = (p0, p1, n) => { const d = p1.clone().sub(p0), side = new THREE.Vector3().crossVectors(d, n).normalize().multiplyScalar(4); nets.quad(p0.clone().add(side).toArray(), p1.clone().add(side).toArray(), p1.clone().sub(side).toArray(), p0.clone().sub(side).toArray(), rope, [1, 1, 1, 1], false); };
    const grid = (o, u, v, n) => { const nu = Math.round(u.length() / 110), nv = Math.round(v.length() / 110); for (let i = 0; i <= nu; i++) { const p = o.clone().addScaledVector(u, i / nu); cord(p, p.clone().add(v), n); } for (let i = 0; i <= nv; i++) { const p = o.clone().addScaledVector(v, i / nv); cord(p, p.clone().add(u), n); } };
    grid(V(-GW, 0, z1), V(2 * GW, 0, 0), V(0, GH, 0), V(0, 0, 1));
    for (const sx of [-1, 1]) grid(V(sx * GW, 0, z0), V(0, 0, z1 - z0), V(0, GH, 0), V(1, 0, 0));
    grid(V(-GW, GH, z0), V(2 * GW, 0, 0), V(0, 0, z1 - z0), V(0, 1, 0));
    const sheet = new Soup(), sc = mix(tc, [1, 1, 1], 0.3), F = [1, 1, 1, 1];
    sheet.quad([-GW, 0, z1], [GW, 0, z1], [GW, GH, z1], [-GW, GH, z1], sc, F, false);
    for (const sx of [-1, 1]) sheet.quad([sx * GW, 0, z0], [sx * GW, 0, z1], [sx * GW, GH, z1], [sx * GW, GH, z0], sc, F, false);
    sheet.quad([-GW, GH, z0], [GW, GH, z0], [GW, GH, z1], [-GW, GH, z1], sc, F, false);
    const sm = sheet.mesh(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false })); sm.renderOrder = 2; group.add(sm);
  }
  group.add(nets.mesh());
  // the clear upper walls: oak posts up them and round into the roof, rails, rafters across it (a barn's frame), faint glass
  const OUT = 30, k900 = PR.findIndex(q => q[1] === 900);
  for (let j = 0; j < RG.length - 1; j += 4) {
    if (RG[j].back && Math.abs(RG[j].b[0]) < GW + 100) continue;
    let prev = vtx(j, k900, OUT);
    for (let k = k900 + 1; k < PR.length; k++) { const q = vtx(j, k, OUT); beam(S, prev, q, 46, OAK); prev = q; }
  }
  for (const y of [1300, H - R]) { const k = PR.findIndex(q => q[1] === y); for (let j = 0; j < RG.length - 1; j++) beam(S, vtx(j, k, OUT), vtx(j + 1, k, OUT), 34, OAK_D); }
  for (let z = -L + 600; z <= L - 600; z += 1400) beam(S, [-kx, H + 30, z], [kx, H + 30, z], 60, OAK);
  for (const x of [-1600, 1600]) beam(S, [x, H + 70, -kz], [x, H + 70, kz], 50, OAK_D);
  const glass = new THREE.BufferGeometry(); glass.setAttribute('position', new THREE.Float32BufferAttribute(G.P, 3)); glass.setAttribute('color', new THREE.Float32BufferAttribute(G.C, 3));
  const gm = new THREE.Mesh(glass, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false })); gm.renderOrder = 3; group.add(gm);
  group.add(S.mesh());
  dress(group, lite);
  return { group };
}

// ---------------------------------------------------------------- RS models round it (merged: three draws)
function dress(group, lite) {
  const Y = new THREE.Vector3(0, 1, 0);
  const M = (x, y, z, ry = 0, s = TS, sy = s) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(Y, ry), new THREE.Vector3(s, sy, s));
  const plain = [], blue = [], orange = [];
  // the patch's fence along the top of the wall, all the way round (an RS fence panel a tile, edge to edge)
  for (let i = 0; i < 8; i++) {
    const a = OCT[i], c = OCT[(i + 1) % 8], dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz), m = [dz / l, -dx / l], n = Math.max(1, Math.round(l / 600));
    const ry = Math.atan2(dx, dz), off = new THREE.Vector3(60 * TS, 0, 0).applyAxisAngle(Y, ry);   // (the panel runs along its z, drawn on the tile's west edge)
    for (let q = 0; q < n; q++) {
      const t = (q + 0.5) / n, x = a[0] + dx * t + m[0] * (R + 70), z = a[1] + dz * t + m[1] * (R + 70);
      plain.push(['fence', M(x + off.x, 900, z + off.z, ry, TS, TS * 0.8).multiply(new THREE.Matrix4().makeScale(1, 1, l / n / 600))]);
    }
  }
  // team standards round the outside (blue's half blue, orange's orange), flags at the corners, banners behind the goals
  for (const side of [-1, 1]) for (const z of [-3600, -1400, 1400, 3600]) (z < 0 ? blue : orange).push([Math.abs(z) > 2000 ? 'std7' : 'std8', M(side * (W + 260), 0, z, side > 0 ? -Math.PI / 2 : Math.PI / 2, TS * 1.15)]);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { (sz < 0 ? blue : orange).push(['flag1', M(sx * 3500, 0, sz * (L + 500), sx > 0 ? Math.PI : 0, TS * 1.2)]); plain.push(['torch', M(sx * (W + 200), 0, sz * 2600, 0, TS)]); }
  for (const [s, list] of [[-1, blue], [1, orange]]) for (const x of [-1500, 1500]) list.push(['std8', M(x, 0, s * (L + GD + 260), s > 0 ? Math.PI : 0, TS * 1.4)]);
  // the farm round it: haystacks, bales, the scarecrow, benches for the crowd, rows of cabbages along the sides
  for (const [k, x, z, r] of [['haystack', -5400, -4700, 0.3], ['haystack', 5500, 4600, 2], ['hay', 5300, -4900, 1], ['hay', -5300, 5000, 0.5], ['bale', -4900, -5600, 0], ['bale', 4800, 5700, 1.2], ['bale', 5000, -5900, 2.2],
    ['scarecrow', -5900, 0, 1.6], ['bench2', 5600, -900, -Math.PI / 2], ['bench2', 5600, 900, -Math.PI / 2], ['bench2', -5600, -1600, Math.PI / 2], ['barrel', 5500, 2600, 0], ['crate', 5550, 2950, 0.4], ['barrel', -5400, -3000, 0]])
    plain.push([k, M(x, 0, z, r)]);
  if (!lite) for (const side of [-1, 1]) for (let z = -5600; z <= 5600; z += 560) for (const row of [0, 1]) plain.push(['cabbage', M(side * (W + 900 + row * 520), 0, z + row * 280, hash(z, row) * 6)]);
  group.add(merged(plain)); group.add(merged(blue, TEAM[0].col)); group.add(merged(orange, TEAM[1].col));
}

// ---------------------------------------------------------------- the boost pads
// RL's pads, in light: a soft glow on the grass, a column of it rising, and over a big pad a real RS energy potion
// turning in a halo (small pads: a bright mote). Taken, they go dark and the column drops away till they're back.
const gradTex = (draw, w = 128, h = 128) => { const c = Object.assign(document.createElement('canvas'), { width: w, height: h }), x = c.getContext('2d'); draw(x, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t; };
let TEX = null;
const texs = () => TEX ??= {
  disc: gradTex((x, w) => { const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.45, 'rgba(255,255,255,0.55)'); g.addColorStop(0.62, 'rgba(255,255,255,0.95)'); g.addColorStop(0.7, 'rgba(255,255,255,0.25)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, w, w); }),
  halo: gradTex((x, w) => { const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)'); g.addColorStop(0.6, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, w, w); }),
  col: gradTex((x, w, h) => { const g = x.createLinearGradient(0, h, 0, 0); g.addColorStop(0, 'rgba(255,255,255,0.75)'); g.addColorStop(0.35, 'rgba(255,255,255,0.25)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h); }, 8, 128),
};
export class Pads {
  constructor(group) {
    this.list = []; const T = texs();
    const add = (map, col, op) => new THREE.MeshBasicMaterial({ map, color: col, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    for (const p of PADS) {
      const g = new THREE.Group(); g.position.set(p.x, 0, p.z); group.add(g);
      const r = p.big ? 200 : 110, col = p.big ? 0xff8a1e : 0xffa83a;
      const disc = new THREE.Mesh(new THREE.PlaneGeometry(r * 2.2, r * 2.2), add(T.disc, col, 0.9)); disc.rotation.x = -Math.PI / 2; disc.position.y = 4; disc.renderOrder = 1; g.add(disc);
      const column = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.62, p.big ? 300 : 90, 40, 1, true), add(T.col, col, p.big ? 0.45 : 0.25)); column.position.y = (p.big ? 300 : 90) / 2 + 4; column.renderOrder = 2; g.add(column);
      const orb = new THREE.Group(); g.add(orb);
      if (p.big) { const md = meshOf('energy'), k = TS * 1.15; md.scale.setScalar(k); md.position.y = -14 * k; orb.add(md); }
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.halo, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: p.big ? 0.7 : 0.95 })); halo.scale.setScalar(p.big ? 300 : 80); halo.renderOrder = 3; orb.add(halo);
      this.list.push({ p, g, disc, column, orb, halo, on: 1 });
    }
  }
  update(match, t, dt = 0.016) {
    match.pads.forEach((mp, i) => {
      const P = this.list[i], want = mp.t <= 0 ? 1 : 0; P.on += (want - P.on) * Math.min(1, dt * (want ? 4 : 12));
      const k = P.on, pulse = 0.85 + Math.sin(t * 3 + i) * 0.15;
      P.orb.visible = k > 0.02; P.column.visible = k > 0.02;
      P.disc.material.opacity = (0.25 + 0.65 * k) * pulse; P.column.material.opacity = (P.p.big ? 0.45 : 0.25) * k * pulse; P.column.scale.y = Math.max(0.01, k);
      P.orb.scale.setScalar(Math.max(0.01, k)); P.orb.rotation.y = t * (P.p.big ? 1.6 : 2.4) + i; P.orb.position.y = (P.p.big ? 150 : 55) + Math.sin(t * 2 + i) * (P.p.big ? 14 : 8);
    });
  }
}

// ---------------------------------------------------------------- the ball: RS's own cabbage, six heads of it wrapped round
// a ball (one on each face of a cube, pushed out onto the sphere), the outer leaves overlapping at the seams
export function buildCabbage(r) {
  const src = meshOf('cabbage').geometry, p = src.attributes.position.array, c = src.attributes.color.array, P = [], Cc = [];
  let rmax = 0; for (let i = 0; i < p.length; i += 3) rmax = Math.max(rmax, Math.hypot(p[i], p[i + 2] - 3));
  const faces = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].map(n => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...n)));
  const v = new THREE.Vector3(), tw = new THREE.Quaternion();
  faces.forEach((fq, fi) => {
    tw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), fi * 1.1);
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2] - 3, rho = Math.min(1, Math.hypot(x, z) / rmax), phi = Math.atan2(z, x), th = rho * 1.05;   // (a head spans ~60 degrees: neighbours overlap)
      v.set(Math.sin(th) * Math.cos(phi), Math.cos(th), Math.sin(th) * Math.sin(phi)).multiplyScalar(r * (0.93 + 0.1 * (y - 2) / 13)).applyQuaternion(tw).applyQuaternion(fq);
      P.push(v.x, v.y, v.z); Cc.push(c[i] * 1.15, c[i + 1] * 1.15, c[i + 2] * 1.15);
    }
  });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
  const grp = new THREE.Group(); grp.add(new THREE.Mesh(g, rsMat));
  grp.add(new THREE.Mesh(new THREE.IcosahedronGeometry(r * 0.9, 2), new THREE.MeshBasicMaterial({ color: 0x5f9a38 })));   // (the heart, under the leaves)
  grp.add(new THREE.Mesh(new THREE.IcosahedronGeometry(r * 1.03, 2), new THREE.MeshBasicMaterial({ color: 0x223214, side: THREE.BackSide })));   // (a dark rim: it reads on the grass)
  return grp;
}
