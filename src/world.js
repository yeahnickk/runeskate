// Collision world built from the server's own tile flags (tools/build.py -> assets/world.json).
// Coordinates: x = east, z = north, in tiles, local to the exported square. Heights in tiles (+up).

export class World {
  /** json = the core pack (tools/split.py): the full grid size, plus the rectangle it carries. Other packs
   *  (json.regions, e.g. Varrock) start as solid ground-level walls and are added with addRegion() once the
   *  client has streamed them in. An unsplit world.json (tests, old builds) is one region covering it all. */
  constructor(json) {
    this.N = json.size;
    this.base = [json.baseX, json.baseZ];
    const N = this.N;
    this.ground = new Float32Array(N * N * 4);
    this.blocked = new Uint8Array(N * N).fill(1);          // [z*N+x] 0 open, 1 blocked, 2 water, 3 rock (tools/lanes.py), 4 a tree stands here (its trunk collides, see trunks)
    this.live = new Uint8Array(N * N);                     // [z*N+x] 1 = inside a loaded region
    this.spawn = json.spawn;
    this.segs = [];
    this.grid = new Map();
    this.rails = [];
    this.railGrid = new Map();
    this.trunkGrid = new Map();
    this.ramps = new Map();                                // tz*N+tx -> Create-a-Park kicker on that tile (src/park.js)                            // 'tx,tz' -> [{x, z, r}]: tree trunks, measured by tools/build.py
    this.regions = json.regions || [];
    this.loaded = new Set();
    this.rects = [];
    this.addRegion(json.x0 === undefined ? { ...json, name: 'core', x0: 0, z0: 0, w: N, h: N } : json);
  }

  /** drop a streamed-in region into the grid: tiles, heights, segments, rails; moves the frontier wall */
  addRegion(p) {
    this._tall = null;                                   // skater.tallBlock cache: the new land may change it
    if (this.loaded.has(p.name)) return;
    const N = this.N, { x0, z0, w, h } = p;
    for (let i = 0; i < w; i++) this.ground.set(p.ground.slice(i * h * 4, (i + 1) * h * 4), ((x0 + i) * N + z0) * 4);
    for (let j = 0; j < h; j++) {
      this.blocked.set(p.blocked.slice(j * w, (j + 1) * w), (z0 + j) * N + x0);
      this.live.fill(1, (z0 + j) * N + x0, (z0 + j) * N + x0 + w);
    }
    for (const [x, z, r] of p.trunks || []) {
      const k = Math.floor(x) + ',' + Math.floor(z);
      if (!this.trunkGrid.has(k)) this.trunkGrid.set(k, []);
      this.trunkGrid.get(k).push({ x, z, r });
    }
    const added = [];
    for (const [ax, az, bx, bz, kind, top] of p.segs) { const s = { ax, az, bx, bz, kind, top }; this.addSeg(s); added.push(s); }
    // grindable: rails, fences/gates, and low obstacles with a measured top (hedges); a lone low block
    // (a cactus, a rock) is only jumpable, see buildRails' length filter
    for (const r of buildRails(added.filter(s => s.top && (s.kind === 'rail' || s.kind === 'fence' || s.kind === 'block')))) {
      this.rails.push(r);
      for (const cell of cellsAlong(r.ax, r.az, r.bx, r.bz, 1)) {
        if (!this.railGrid.has(cell)) this.railGrid.set(cell, []);
        this.railGrid.get(cell).push(r);
      }
    }
    this.loaded.add(p.name);
    this.rects.push({ x0, z0, w, h });
    this.frontier();
    this.weldGround(x0 - 1, z0 - 1, x0 + w + 1, z0 + h + 1);
  }

  /** is tile (tx,tz) inside a region the client has loaded? */
  isLive(tx, tz) { return tx >= 0 && tz >= 0 && tx < this.N && tz < this.N && this.live[tz * this.N + tx] === 1; }

  /** an invisible wall on every tile edge between loaded and not-yet-loaded (or never-playable) ground, so
   *  nobody skates onto land that has no collision; rebuilt each time a region arrives */
  frontier() {
    this.removeSegs(s => s.frontier);
    const N = this.N, edge = (ax, az, bx, bz) => this.addSeg({ ax, az, bx, bz, kind: 'edge', top: null, frontier: true });
    for (const { x0, z0, w, h } of this.rects) {
      for (let x = x0; x < x0 + w; x++) {
        if (z0 > 0 && !this.isLive(x, z0 - 1)) edge(x, z0, x + 1, z0);
        if (z0 + h < N && !this.isLive(x, z0 + h)) edge(x, z0 + h, x + 1, z0 + h);
      }
      for (let z = z0; z < z0 + h; z++) {
        if (x0 > 0 && !this.isLive(x0 - 1, z)) edge(x0, z, x0, z + 1);
        if (x0 + w < N && !this.isLive(x0 + w, z)) edge(x0 + w, z, x0 + w, z + 1);
      }
    }
  }

  removeSegs(pred) {
    const gone = new Set(this.segs.filter(pred)); if (!gone.size) return;
    this.segs = this.segs.filter(s => !gone.has(s));
    const cells = new Set();
    for (const s of gone) for (const c of cellsAlong(s.ax, s.az, s.bx, s.bz, 1)) cells.add(c);
    for (const k of cells) { const l = this.grid.get(k); if (!l) continue; const f = l.filter(s => !gone.has(s)); if (f.length) this.grid.set(k, f); else this.grid.delete(k); }
  }

  /** Each tile carries its own four corner heights, and where a loc (bridge deck, stairs) raised some tiles
   *  the neighbours can disagree about a shared corner: a pit or a cliff the renderer never shows (the
   *  Lumbridge bridge's west end dropped to the river bed, then stepped up 1.3 tiles). Weld every corner
   *  shared by two open tiles with no wall/ledge between them to the median of its copies. */
  weldGround(rx0 = 0, rz0 = 0, rx1 = this.N, rz1 = this.N) {
    const N = this.N, g = this.ground, B = this.blocked;
    rx0 = Math.max(0, rx0); rz0 = Math.max(0, rz0); rx1 = Math.min(N, rx1); rz1 = Math.min(N, rz1);
    const RW = rx1 - rx0, RH = rz1 - rz0;
    const edges = new Set();                              // tile edges that have a segment on them
    for (const s of this.segs) {
      if (Math.max(s.ax, s.bx) < rx0 || Math.min(s.ax, s.bx) > rx1 || Math.max(s.az, s.bz) < rz0 || Math.min(s.az, s.bz) > rz1) continue;
      if (s.ax === s.bx && Math.abs(s.bz - s.az) === 1) edges.add('v' + s.ax + ',' + Math.min(s.az, s.bz));
      else if (s.az === s.bz && Math.abs(s.bx - s.ax) === 1) edges.add('h' + Math.min(s.ax, s.bx) + ',' + s.az);
    }
    const par = new Int32Array(RW * RH * 4); for (let i = 0; i < par.length; i++) par[i] = i;
    const find = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
    const join = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
    const id = (tx, tz, k) => ((tx - rx0) * RH + tz - rz0) * 4 + k;     // corners: 0 (x0,z0) 1 (x1,z0) 2 (x1,z1) 3 (x0,z1)
    const gi = i => { const k = i & 3, t = i >> 2, tx = rx0 + Math.floor(t / RH), tz = rz0 + t % RH; return (tx * N + tz) * 4 + k; };
    const open = (tx, tz) => B[tz * N + tx] === 0;
    for (let tx = rx0; tx < rx1; tx++) for (let tz = rz0; tz < rz1; tz++) {
      if (!open(tx, tz)) continue;
      if (tx + 1 < rx1 && open(tx + 1, tz) && !edges.has('v' + (tx + 1) + ',' + tz)) { join(id(tx, tz, 1), id(tx + 1, tz, 0)); join(id(tx, tz, 2), id(tx + 1, tz, 3)); }
      if (tz + 1 < rz1 && open(tx, tz + 1) && !edges.has('h' + tx + ',' + (tz + 1))) { join(id(tx, tz, 3), id(tx, tz + 1, 0)); join(id(tx, tz, 2), id(tx, tz + 1, 1)); }
    }
    const size = new Int32Array(par.length);
    for (let i = 0; i < par.length; i++) size[find(i)]++;
    const groups = new Map();
    for (let i = 0; i < par.length; i++) {
      const r = find(i);
      if (size[r] < 2) continue;
      let l = groups.get(r); if (!l) groups.set(r, l = []); l.push(i);
    }
    let welded = 0;
    for (const l of groups.values()) {
      if (l.length < 2) continue;
      const G = l.map(gi);
      let lo = Infinity, hi = -Infinity; for (const i of G) { lo = Math.min(lo, g[i]); hi = Math.max(hi, g[i]); }
      if (hi - lo < 0.05) continue;
      const v = G.map(i => g[i]).sort((a, b) => a - b), m = v.length & 1 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
      for (const i of G) g[i] = m;
      welded++;
    }
    this.welded = welded;
  }

  addSeg(s) {
    s.dx = s.bx - s.ax; s.dz = s.bz - s.az; s.len = Math.hypot(s.dx, s.dz);
    this.segs.push(s);
    for (const cell of cellsAlong(s.ax, s.az, s.bx, s.bz, 1)) {
      if (!this.grid.has(cell)) this.grid.set(cell, []);
      this.grid.get(cell).push(s);
    }
  }

  /** ground height (tiles) at a point: bilinear over the tile's four corners */
  height(x, z) {
    const N = this.N;
    let tx = Math.floor(x), tz = Math.floor(z);
    tx = Math.max(0, Math.min(N - 1, tx)); tz = Math.max(0, Math.min(N - 1, tz));
    const u = Math.min(1, Math.max(0, x - tx)), v = Math.min(1, Math.max(0, z - tz));
    const o = (tx * N + tz) * 4, g = this.ground;
    const h = (g[o] * (1 - u) + g[o + 1] * u) * (1 - v) + (g[o + 3] * (1 - u) + g[o + 2] * u) * v;
    if (!this.ramps.size) return h;
    const r = this.ramps.get(tz * N + tx);
    return r ? h + r.rise * Math.max(0, Math.min(1, ((x - r.x0) * r.dx + (z - r.z0) * r.dz) / r.len)) : h;
  }

  /** Create-a-Park: a rail/ledge (rails + collision walls) or a kicker (a ramp on the ground). Undo with removePark */
  addPark(id, { rails = [], segs = [], ramp = null }) {
    for (const sg of segs) { sg.park = id; this.addSeg(sg); }
    for (const r of rails) {
      r.park = id; r.id = this.rails.length; this.rails.push(r);
      for (const cell of cellsAlong(r.ax, r.az, r.bx, r.bz, 1)) { if (!this.railGrid.has(cell)) this.railGrid.set(cell, []); this.railGrid.get(cell).push(r); }
    }
    if (ramp) for (const [tx, tz] of ramp.tiles) this.ramps.set(tz * this.N + tx, { ...ramp, park: id });
    this._tall = null;
  }
  removePark(id) {
    this.removeSegs(s => s.park === id);
    this.rails = this.rails.filter(r => r.park !== id);
    for (const [k, l] of this.railGrid) { const f = l.filter(r => r.park !== id); if (f.length !== l.length) { if (f.length) this.railGrid.set(k, f); else this.railGrid.delete(k); } }
    for (const [k, r] of this.ramps) if (r.park === id) this.ramps.delete(k);
    this._tall = null;
  }

  tileKind(x, z) {
    const tx = Math.floor(x), tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= this.N || tz >= this.N) return 1;
    return this.blocked[tz * this.N + tx];
  }

  /** tree trunks (circles) whose centre lies within r tiles' worth of grid cells of (x,z) */
  trunksNear(x, z, r = 1) {
    const out = [];
    for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++)
      for (let cz = Math.floor(z - r); cz <= Math.floor(z + r); cz++) {
        const l = this.trunkGrid.get(cx + ',' + cz);
        if (l) out.push(...l);
      }
    return out;
  }

  /** the nearest trunk surface within reach: distance from (x,z) to its edge (negative = inside) */
  trunkAt(x, z, reach) {
    let best = null;
    for (const t of this.trunksNear(x, z, reach + 0.8)) {
      const d = Math.hypot(x - t.x, z - t.z) - t.r;
      if (d < reach && (!best || d < best.d)) best = { t, d };
    }
    return best;
  }

  segsNear(x, z, r = 1) {
    const out = new Set();
    for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++)
      for (let cz = Math.floor(z - r); cz <= Math.floor(z + r); cz++) {
        const l = this.grid.get(cx + ',' + cz);
        if (l) for (const s of l) out.add(s);
      }
    return out;
  }

  railsNear(x, z, r = 1) {
    const out = new Set();
    for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++)
      for (let cz = Math.floor(z - r); cz <= Math.floor(z + r); cz++) {
        const l = this.railGrid.get(cx + ',' + cz);
        if (l) for (const s of l) out.add(s);
      }
    return out;
  }
}

/** top height of a single rail segment at parameter u (samples at 0.15/0.5/0.85) */
export function segTop(s, u) {
  const t = s.top;
  if (u <= 0.5) return t[0] + (t[1] - t[0]) * (u - 0.15) / 0.35;
  return t[1] + (t[2] - t[1]) * (u - 0.5) / 0.35;
}

function cellsAlong(ax, az, bx, bz, pad) {
  const out = [];
  for (let cx = Math.floor(Math.min(ax, bx) - pad); cx <= Math.floor(Math.max(ax, bx) + pad); cx++)
    for (let cz = Math.floor(Math.min(az, bz) - pad); cz <= Math.floor(Math.max(az, bz) + pad); cz++)
      out.push(cx + ',' + cz);
  return out;
}

/** merge collinear, touching 1-tile rail segments into long grindable rails with a height profile */
function buildRails(rs) {
  const lines = new Map();
  for (const s of rs) {
    const horiz = s.az === s.bz;
    const key = (horiz ? 'h' : 'v') + (horiz ? s.az : s.ax);
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(s);
  }
  const rails = [];
  for (const [key, list] of lines) {
    const horiz = key[0] === 'h';
    list.sort((a, b) => horiz ? Math.min(a.ax, a.bx) - Math.min(b.ax, b.bx) : Math.min(a.az, a.bz) - Math.min(b.az, b.bz));
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const first = run[0], last = run[run.length - 1];
      const a0 = horiz ? Math.min(first.ax, first.bx) : Math.min(first.az, first.bz);
      const a1 = horiz ? Math.max(last.ax, last.bx) : Math.max(last.az, last.bz);
      const c = horiz ? first.az : first.ax;
      // height profile: 3 samples per tile, ordered along +axis
      const prof = [];
      for (const s of run) {
        const lo = horiz ? Math.min(s.ax, s.bx) : Math.min(s.az, s.bz);
        const flip = horiz ? s.ax > s.bx : s.az > s.bz;
        const t = flip ? [...s.top].reverse() : s.top;
        prof.push([lo + 0.15, t[0]], [lo + 0.5, t[1]], [lo + 0.85, t[2]]);
      }
      const r = horiz ? { ax: a0, az: c, bx: a1, bz: c } : { ax: c, az: a0, bx: c, bz: a1 };
      r.horiz = horiz; r.len = a1 - a0; r.a0 = a0; r.prof = prof; r.id = rails.length;
      r.dirx = horiz ? 1 : 0; r.dirz = horiz ? 0 : 1;
      r.minLen = run.every(s => s.kind === 'block') ? 2 : 1;   // hedges: a row, not a single bush
      // what it's made of, for the grind sound: railings are metal, fences wood, walls and hedges stone/brush
      const nk = k => run.filter(s => s.kind === k).length;
      r.mat = nk('rail') >= nk('fence') && nk('rail') >= nk('block') ? 'metal' : nk('fence') >= nk('block') ? 'wood' : 'stone';
      rails.push(r);
      run = [];
    };
    for (const s of list) {
      const lo = horiz ? Math.min(s.ax, s.bx) : Math.min(s.az, s.bz);
      if (run.length) {
        const prev = run[run.length - 1];
        const phi = horiz ? Math.max(prev.ax, prev.bx) : Math.max(prev.az, prev.bz);
        const ptop = prev.top[2] ?? prev.top[1], ctop = s.top[0];
        if (phi !== lo || Math.abs(ptop - ctop) > 0.35) flush();
      }
      run.push(s);
    }
    flush();
  }
  return rails.filter(r => r.len >= r.minLen);
}

/** rail top height at arc position t (0..len) */
export function railTop(r, t) {
  const a = r.a0 + t, p = r.prof;
  if (a <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) if (a <= p[i][0]) {
    const [x0, y0] = p[i - 1], [x1, y1] = p[i];
    return y0 + (y1 - y0) * (a - x0) / (x1 - x0);
  }
  return p[p.length - 1][1];
}
