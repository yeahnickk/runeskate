// CODScape's map: the real Castle Wars arena, cut out of the castlewars pack by tools/cw-arena.py. Drawn the way
// the skate game draws the world (baked RS colours, int16 chunks, WORLD_SCALE wide, heights 1:1), plus one merged
// triangle soup with a BVH over it: bodies, bullets, grenades and bot sight lines all hit the exact mesh you see,
// so the castle floors, stairs, battlements and arrow slits all play like they look.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { WORLD_SCALE as S } from '../mapdata.js';

export { S };
// three coords: x = east, y = up, z = -north (same as the skate game)

export async function loadArena(onStatus = () => {}) {
  onStatus('loading Castle Wars...');
  const [pack, bin] = await Promise.all([
    fetch('assets/cw_arena.json').then(r => r.json()),
    fetch('assets/cw_arena.bin').then(r => r.arrayBuffer()),
  ]);
  return new Arena(pack, bin);
}

export class Arena {
  constructor(pack, bin) {
    this.pack = pack; this.base = [pack.baseX, pack.baseZ];
    const CH = pack.index.chunk;
    this.group = new THREE.Group();
    this.mats = {
      opaque: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      alpha: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.4, depthWrite: false }),
    };
    const solid = [];                                     // world-space triangle positions for the collider
    let nSolid = 0;
    this.meshes = [];
    for (const ch of pack.index.chunks) for (const k of ['terrain', 'locs', 'locs_alpha']) {
      const part = ch[k]; if (!part || !part.n) continue;
      const pos = new Int16Array(bin, part.posOff, part.n * 3), col = new Uint8Array(bin, part.colOff, part.n * 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
      const alpha = k === 'locs_alpha';
      const m = new THREE.Mesh(g, alpha ? this.mats.alpha : this.mats.opaque);
      const ox = ch.cx * CH * S, oz = -ch.cz * CH * S;
      m.position.set(ox, 0, oz); m.scale.set(S / 128, -1 / 128, -S / 128);
      m.updateMatrix(); m.matrixAutoUpdate = false; m.userData.kind = k;
      if (alpha) m.renderOrder = 1;
      this.group.add(m); this.meshes.push(m);
      if (!alpha) { solid.push({ pos, ox, oz }); nSolid += part.n; }
    }
    // the 2004 map stops south of the arena (the Feldip Hills came later): rolling grass instead of the void
    for (const ch of pack.index.chunks) if (!ch.terrain?.n) this.group.add(this.filler(ch.cx * CH, ch.cz * CH, CH));
    // one collider: every opaque triangle, baked to world space
    const P = new Float32Array(nSolid * 3); let o = 0;
    for (const { pos, ox, oz } of solid) for (let i = 0; i < pos.length; i += 3) {
      P[o++] = ox + pos[i] * S / 128; P[o++] = -pos[i + 1] / 128; P[o++] = oz - pos[i + 2] * S / 128;
    }
    this.setCollider(P);
    // the arena wall: Castle Wars is walled in where the castles' own walls stand; everywhere else (the river
    // corners, the open fields) a new crenellated wall closes the square, so the fight stays inside
    const wall = this.buildWall();
    const all = new Float32Array(P.length + wall.length); all.set(P); all.set(wall, P.length);
    this.setCollider(all);
  }

  /** RS-looking grass hills over a missing chunk (tiles tx0.., tz0.., n x n), meeting the real ground at its edges */
  filler(tx0, tz0, n) {
    const p = this.pack, pos = [], col = [], H = (tx, tz) => {
      // the real ground where there is some (a neighbour chunk's edge), hills further in
      const hill = 2.4 + Math.sin(tx * 0.21) * 0.9 + Math.cos(tz * 0.17 + tx * 0.05) * 1.1 + Math.sin((tx + tz) * 0.09) * 1.4;
      let best = null, bd = Infinity;
      for (const [dx, dz] of [[0, n + 1 - (tz - tz0)], [0, -(tz - tz0) - 1], [n + 1 - (tx - tx0), 0], [-(tx - tx0) - 1, 0]]) {
        const x = tx + dx, z = tz + dz; if (x < 0 || z < 0 || x >= p.w || z >= p.h) continue;
        const g = p.ground[(x * p.h + z) * 4]; if (!g && !p.ground[(x * p.h + z) * 4 + 2]) continue;
        const d = Math.abs(dx) + Math.abs(dz); if (d < bd) { bd = d; best = g; }
      }
      if (best === null) return hill;
      const t = Math.min(1, bd / 10); return best * (1 - t) + hill * t;
    };
    const L = [-0.35, 0.82, 0.45];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const tx = tx0 + i, tz = tz0 + j, h00 = H(tx, tz), h10 = H(tx + 1, tz), h11 = H(tx + 1, tz + 1), h01 = H(tx, tz + 1);
      const v = [[tx, h00, tz], [tx + 1, h10, tz], [tx + 1, h11, tz + 1], [tx, h01, tz + 1]].map(([x, y, z]) => [x * S, y, -z * S]);
      const nx = (h00 - h10 + h01 - h11) / (2 * S), nz = (h01 - h00 + h11 - h10) / (2 * S), nl = Math.hypot(nx, 1, nz);
      const lit = 0.6 + 0.4 * Math.max(0, (nx * L[0] + L[1] + -nz * L[2]) / nl), k = 0.9 + ((tx * 73 + tz * 151) % 17) / 80;
      const c = [0.36 * lit * k, 0.43 * lit * k, 0.14 * lit * k];
      for (const q of [0, 1, 2, 0, 2, 3]) { pos.push(...v[q]); col.push(...c); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, this.mats.opaque); m.userData.kind = 'terrain'; this.meshes.push(m);
    return m;
  }

  setCollider(P) {
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.BufferAttribute(P, 3));
    cg.boundsTree = new MeshBVH(cg, { maxLeafTris: 8 });
    this.collider = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ visible: false }));
    this.bvh = cg.boundsTree;
  }

  /** walls along the arena's edge wherever nothing stands there already; adds the mesh, returns its triangles */
  buildWall() {
    const [X0, Z0, X1, Z1] = Arena.BOUNDS, b = this.base;
    const ex0 = (X0 - b[0]) * S, ex1 = (X1 + 1 - b[0]) * S, en0 = (Z0 - b[1]) * S, en1 = (Z1 + 1 - b[1]) * S;   // east/north extents (game units)
    const T = 1.1, RISE = 3.3, MER = 0.75;                 // thickness, height over the ground, merlon height
    const pos = [], col = [], LIGHT = [-0.35, 0.82, 0.45];
    const stone = (k, n) => {                              // RS-ish castle stone, baked light like the world's own
      const l = 0.55 + 0.45 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      return [0.53 * l * k, 0.5 * l * k, 0.45 * l * k];
    };
    // a box in three coords [x0,x1] x [y0,y1] x [z0,z1]
    const box = (x0, x1, y0, y1, z0, z1, k) => {
      const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
      for (const [a, b2, c, d, n] of [[0, 1, 2, 3, [0, 0, -1]], [5, 4, 7, 6, [0, 0, 1]], [4, 0, 3, 7, [-1, 0, 0]], [1, 5, 6, 2, [1, 0, 0]], [3, 2, 6, 7, [0, 1, 0]], [4, 5, 1, 0, [0, -1, 0]]]) {
        const c3 = stone(k, n);
        for (const i of [a, b2, c, a, c, d]) { pos.push(...v[i]); col.push(...c3); }
      }
    };
    const up = new THREE.Vector3(0, -1, 0), o3 = new THREE.Vector3();
    // something already standing just outside this stretch of edge? (a castle wall: its top well over the ground)
    const standing = (x, n, ox, on) => {
      // from just inside, at chest height, straight out: a castle wall stops the ray, a tree's canopy doesn't
      for (const y of [1.0, 1.6]) {
        const gy = this.ground(x - ox * 0.4, -(n - on * 0.4));
        if (!this.ray(o3.set(x - ox * 0.4, gy + y, -(n - on * 0.4)), _dir.set(ox, 0, -on), 1.9)) return false;
      }
      return true;
    };
    // each side: walk it a tile at a time; (ox, on) points out of the arena
    const sides = [[ex0, en0, ex1, en0, 0, -1], [ex0, en1, ex1, en1, 0, 1], [ex0, en0, ex0, en1, -1, 0], [ex1, en0, ex1, en1, 1, 0]];
    let built = 0;
    for (const [ax, an, bx, bn, ox, on] of sides) {
      const L = Math.hypot(bx - ax, bn - an), n = Math.round(L / S);
      const at = i => { const t = (i + 0.5) / n; return standing(ax + (bx - ax) * t, an + (bn - an) * t, ox, on); };
      // a castle wall is a long run of "something tall outside"; a tree or a rock is a tile or two (wall over it)
      const st = Array.from({ length: n }, (_, i) => at(i)), walled = new Uint8Array(n);
      for (let i = 0; i < n;) { let j = i; while (j < n && st[j]) j++; if (j - i >= 5) walled.fill(1, i, j); i = Math.max(j, i + 1); }
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n, x0 = ax + (bx - ax) * t0, n0 = an + (bn - an) * t0, x1 = ax + (bx - ax) * t1, n1 = an + (bn - an) * t1;
        if (walled[i]) continue;
        // the ground here, a tile inward (the arena side decides how tall it looks) and under the wall
        let g = -Infinity, lo = Infinity;
        for (const f of [0, 0.5, 1]) for (const k of [-S, 0, T]) {
          const gx = x0 + (x1 - x0) * f + ox * k, gn = n0 + (n1 - n0) * f + on * k, gy = this.ground(gx, -gn);
          g = Math.max(g, gy); lo = Math.min(lo, gy);
        }
        const top = g + RISE, k = 0.92 + ((i * 7919 + ax * 31) % 13) / 100;   // a little block-to-block variation
        const wx0 = Math.min(x0, x1, x0 + ox * T), wx1 = Math.max(x0, x1, x1 + ox * T), wn0 = Math.min(n0, n1, n0 + on * T), wn1 = Math.max(n0, n1, n1 + on * T);
        box(wx0, wx1, lo - 2, top, -wn1, -wn0, k);
        // merlons: one per tile, half its length, on the outer half of the wall top
        const along = ox === 0 ? [x0 + (x1 - x0) * 0.25, x0 + (x1 - x0) * 0.75] : [n0 + (n1 - n0) * 0.25, n0 + (n1 - n0) * 0.75];
        if (ox === 0) box(Math.min(...along), Math.max(...along), top, top + MER, -(Math.max(n0 + on * T, n0 + on * T * 0.45)), -(Math.min(n0 + on * T, n0 + on * T * 0.45)), k * 1.05);
        else box(Math.min(x0 + ox * T, x0 + ox * T * 0.45), Math.max(x0 + ox * T, x0 + ox * T * 0.45), top, top + MER, -Math.max(...along), -Math.min(...along), k * 1.05);
        built++;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, this.mats.opaque); m.userData.kind = 'locs';
    this.group.add(m); this.meshes.push(m); this.wallTiles = built;
    return new Float32Array(pos);
  }

  /** the bit you can play in: the walled Castle Wars square (world tiles, inclusive) */
  static BOUNDS = [2368, 3072, 2431, 3135];
  // the two sides, Castle Wars style: Saradomin (blue) holds the south-east castle, Zamorak (red) the north-west.
  // flag: the castle-top tile the flag stands on; area: the castle's tiles (spawns are picked inside it)
  static TEAMS = {
    sara: { name: 'SARADOMIN', col: '#4aa8ff', hex: 0x2f7fe0, flag: [2428, 3075], area: [2414, 3072, 2431, 3091] },
    zam: { name: 'ZAMORAK', col: '#ff4a3a', hex: 0xd02a1a, flag: [2371, 3132], area: [2368, 3115, 2386, 3135] },
  };

  inBounds(x, z, pad = 0.35) {
    const [x0, z0, x1, z1] = Arena.BOUNDS, b = this.base;
    return x > (x0 - b[0]) * S + pad && x < (x1 + 1 - b[0]) * S - pad && -z > (z0 - b[1]) * S + pad && -z < (z1 + 1 - b[1]) * S - pad;
  }
  /** the pack's tile kind under (x, z): 0 open, 1 blocked, 2 water, 4 tree */
  tileKind(x, z) {
    const tx = Math.floor(x / S), tz = Math.floor(-z / S), p = this.pack;
    if (tx < 0 || tz < 0 || tx >= p.w || tz >= p.h) return 1;
    return p.blocked[tz * p.w + tx];
  }
  /** the terrain's own height at (x, z) (bilinear over the tile corners; a bridge deck sits above it) */
  ground(x, z) {
    const p = this.pack, fx = x / S, fz = -z / S, tx = Math.max(0, Math.min(p.w - 1, Math.floor(fx))), tz = Math.max(0, Math.min(p.h - 1, Math.floor(fz)));
    const u = Math.min(1, Math.max(0, fx - tx)), v = Math.min(1, Math.max(0, fz - tz)), o = (tx * p.h + tz) * 4, g = p.ground;
    return (g[o] * (1 - u) + g[o + 1] * u) * (1 - v) + (g[o + 3] * (1 - u) + g[o + 2] * u) * v;
  }
  /** can a body stand at (x, z)? anywhere inside the walls (the river is shallow: you wade it, src/cod/body.js) */
  standable(x, y, z) { return this.inBounds(x, z); }
  /** feet in the river (not on a bridge or a stepping stone)? */
  inWater(x, y, z) { return this.tileKind(x, z) === 2 && y < this.ground(x, z) + 0.2; }

  /**
   * The bots' map: walkable spots every half tile, on every level (ground, wall walks, castle tiers, tower
   * tops), linked to their neighbours when the step between is small and nothing stands in the way.
   * nodes: { x, y, z, n: [ids] }; a grid of node ids per cell for the nearest-node lookup.
   */
  buildNav() {
    const [X0, Z0, X1, Z1] = Arena.BOUNDS, b = this.base, C = S / 2;
    const ox = (X0 - b[0]) * S, oz = (Z0 - b[1]) * S, nx = Math.round((X1 + 1 - X0) * S / C), nz = Math.round((Z1 + 1 - Z0) * S / C);
    const nodes = [], cell = new Array(nx * nz);
    const o = new THREE.Vector3(), d = new THREE.Vector3(0, -1, 0);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = ox + (i + 0.5) * C, z = -(oz + (j + 0.5) * C);
      const here = [];
      let top = 30, ceil = Infinity;
      for (let k = 0; k < 6; k++) {
        const h = this.ray(o.set(x, top, z), d, 60); if (!h) break;
        const y = h.point.y;
        if (Math.abs(h.normal.y) > 0.6 && ceil - y >= 1.45 && this.standable(x, y, z)) here.push(nodes.length), nodes.push({ x, y, z, i, j, n: [], water: this.inWater(x, y, z) });
        ceil = y; top = y - 0.06;
      }
      cell[i * nz + j] = here;
    }
    // an edge is what a body can really walk: nothing across it at the knee or the chest, and room for the
    // capsule (src/cod/body.js MOVE: radius 0.32, from a step above the feet to the head) at its middle
    const step = 0.6, room = (x, y, z) => !this.capsuleHits(x, y + 0.94, y + 1.3, z, 0.29);
    const clear = (a, c) => {
      const dx = c.x - a.x, dy = c.y - a.y, dz = c.z - a.z, L = Math.hypot(dx, dy, dz);
      for (const up of [0.55, 1.25]) if (this.ray(o.set(a.x, a.y + up, a.z), _dir.set(dx / L, dy / L, dz / L), L)) return false;
      return true;
    };
    for (const n of nodes) n.room = room(n.x, n.y, n.z);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) for (const a of cell[i * nz + j]) {
      for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        for (const c of cell[ii * nz + jj]) {
          const A = nodes[a], B = nodes[c];
          if (!A.room || !B.room || Math.abs(A.y - B.y) > step || !clear(A, B) || !clear(B, A) || !room((A.x + B.x) / 2, Math.max(A.y, B.y), (A.z + B.z) / 2)) continue;
          A.n.push(c); B.n.push(a);
        }
      }
    }
    // keep only what connects to the middle of the arena (no sealed-off ledges or wall tops nobody can reach)
    const mid = this.at(2400, 3104), seen = new Uint8Array(nodes.length);
    let start = -1, bd = Infinity;
    nodes.forEach((n, k) => { const dd = Math.hypot(n.x - mid.x, n.z - mid.z) + Math.abs(n.y - 3.4) * 3; if (n.n.length > 2 && dd < bd) { bd = dd; start = k; } });
    const q = [start]; seen[start] = 1;
    while (q.length) { const k = q.pop(); for (const m of nodes[k].n) if (!seen[m]) { seen[m] = 1; q.push(m); } }
    nodes.forEach((n, k) => { n.ok = !!seen[k]; });
    this.nav = { nodes, cell, nx, nz, C, ox, oz };
    return this.nav;
  }

  /** does anything come within r of the vertical segment (x, y0..y1, z)? (a body's capsule fits there or not) */
  capsuleHits(x, y0, y1, z, r) {
    _seg.start.set(x, y0, z); _seg.end.set(x, y1, z);
    _box.min.set(x - r, y0 - r, z - r); _box.max.set(x + r, y1 + r, z + r);
    return this.bvh.shapecast({ intersectsBounds: b => b.intersectsBox(_box), intersectsTriangle: tri => tri.closestPointToSegment(_seg, _tp, _cp) < r });
  }

  /** the nearest connected nav node to a point (same level first: height counts triple) */
  nearestNode(x, y, z, r = 3) {
    const N = this.nav, i0 = Math.floor((x - N.ox) / N.C), j0 = Math.floor((-z - N.oz) / N.C);
    let best = -1, bd = Infinity;
    for (let i = i0 - r; i <= i0 + r; i++) for (let j = j0 - r; j <= j0 + r; j++) {
      if (i < 0 || j < 0 || i >= N.nx || j >= N.nz) continue;
      for (const k of N.cell[i * N.nz + j]) {
        const n = N.nodes[k]; if (!n.ok || n.y > y + 0.7) continue;             // (not a ledge above us we can't step up to)
        const d = Math.hypot(n.x - x, n.z - z) + Math.abs(n.y - y) * 3;
        if (d < bd) { bd = d; best = k; }
      }
    }
    return best;
  }

  /** A* over the nav nodes: a list of node ids from a to b (null if no way) */
  path(a, b) {
    const N = this.nav.nodes; if (a < 0 || b < 0) return null;
    const g = new Float32Array(N.length).fill(Infinity), from = new Int32Array(N.length).fill(-1), done = new Uint8Array(N.length);
    const h = k => Math.hypot(N[k].x - N[b].x, N[k].y - N[b].y, N[k].z - N[b].z);
    const heap = new Heap(); g[a] = 0; heap.push(h(a), a);
    while (heap.size) {
      const k = heap.pop();
      if (k === b) { const out = [k]; let c = k; while (from[c] >= 0) out.push(c = from[c]); return out.reverse(); }
      if (done[k]) continue; done[k] = 1;
      for (const m of N[k].n) {
        if (!N[m].ok || done[m]) continue;
        const ng = g[k] + Math.hypot(N[m].x - N[k].x, (N[m].y - N[k].y) * 2, N[m].z - N[k].z) * (N[m].water ? 4 : 1);   // wading is slow: bridges and stones first
        if (ng < g[m]) { g[m] = ng; from[m] = k; heap.push(ng + h(m), m); }
      }
    }
    return null;
  }

  /** can a body walk straight from p (feet) to node n? nothing across the line at the knee or the chest */
  walkLine(p, n) {
    const dx = n.x - p.x, dz = n.z - p.z, L = Math.hypot(dx, dz); if (L < 0.05) return true;
    for (const up of [0.6, 1.25]) {
      const dy = n.y - p.y, LL = Math.hypot(dx, dy, dz);
      if (this.ray(_o.set(p.x, p.y + up, p.z), _dir.set(dx / LL, dy / LL, dz / LL), LL)) return false;
    }
    return true;
  }

  /** the furthest point along a path (from index i) a body at p can head straight for, within reach */
  lookahead(path, i, p, reach = 1.6) {
    const N = this.nav.nodes; let k = i, acc = 0;
    while (k + 1 < path.length) {
      const a = N[path[k]], b = N[path[k + 1]];
      acc += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (acc > reach || !this.walkLine(p, b)) break;
      k++;
    }
    return k;
  }

  /** nav nodes inside a world-tile rectangle [x0, z0, x1, z1] (spawns, objectives) */
  nodesIn([x0, z0, x1, z1]) {
    const b = this.base, a0 = (x0 - b[0]) * S, a1 = (x1 + 1 - b[0]) * S, c0 = (z0 - b[1]) * S, c1 = (z1 + 1 - b[1]) * S;
    return this.nav.nodes.map((n, k) => k).filter(k => { const n = this.nav.nodes[k]; return n.ok && n.x > a0 && n.x < a1 && -n.z > c0 && -n.z < c1; });
  }

  /** a real Castle Wars tile (RS world coords, e.g. 2400,3103) -> three.js position at height y */
  at(wx, wz, y = 0) { return new THREE.Vector3((wx - this.base[0] + 0.5) * S, y, -(wz - this.base[1] + 0.5) * S); }

  /** first hit along a ray (origin, unit dir, max distance): { point, normal, distance } or null */
  ray(o, d, far = 500) {
    const r = this._ray ||= new THREE.Ray();
    r.origin.copy(o); r.direction.copy(d);
    const h = this.bvh.raycastFirst(r, THREE.DoubleSide, 0, far);
    if (!h) return null;
    if (h.face) { h.normal = h.face.normal.clone(); if (h.normal.dot(d) > 0) h.normal.negate(); }
    return h;
  }

  /** the floor under (x, y, z): highest surface below y + up, within down (castle floors stack, so not just the ground) */
  floor(x, y, z, up = 0.5, down = 40) {
    const h = this.ray(_o.set(x, y + up, z), _down, up + down);
    return h ? h.point.y : -Infinity;
  }
}
/** a binary min-heap of (priority, id) for A* */
class Heap {
  constructor() { this.p = []; this.v = []; }
  get size() { return this.v.length; }
  push(p, v) {
    const P = this.p, V = this.v; let i = V.length; P.push(p); V.push(v);
    while (i > 0) { const u = (i - 1) >> 1; if (P[u] <= P[i]) break; [P[u], P[i]] = [P[i], P[u]]; [V[u], V[i]] = [V[i], V[u]]; i = u; }
  }
  pop() {
    const P = this.p, V = this.v, top = V[0], lp = P.pop(), lv = V.pop();
    if (V.length) {
      P[0] = lp; V[0] = lv; let i = 0;
      for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < V.length && P[l] < P[m]) m = l; if (r < V.length && P[r] < P[m]) m = r; if (m === i) break; [P[m], P[i]] = [P[i], P[m]]; [V[m], V[i]] = [V[i], V[m]]; i = m; }
    }
    return top;
  }
}

const _o = new THREE.Vector3(), _down = new THREE.Vector3(0, -1, 0), _dir = new THREE.Vector3();
const _seg = new THREE.Line3(), _box = new THREE.Box3(), _tp = new THREE.Vector3(), _cp = new THREE.Vector3();
