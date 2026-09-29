// Collision world built from the server's own tile flags (tools/build.py -> assets/world.json).
// Coordinates: x = east, z = north, in tiles, local to the exported square. Heights in tiles (+up).

export class World {
  constructor(json) {
    this.N = json.size;
    this.base = [json.baseX, json.baseZ];
    this.ground = Float32Array.from(json.ground);
    this.blocked = Uint8Array.from(json.blocked);          // [z*N+x] 0 open, 1 blocked, 2 water
    this.spawn = json.spawn;
    this.segs = [];
    this.grid = new Map();
    for (const [ax, az, bx, bz, kind, top] of json.segs) this.addSeg({ ax, az, bx, bz, kind, top });
    this.rails = buildRails(this.segs.filter(s => s.kind === 'rail'));
    this.railGrid = new Map();
    for (const r of this.rails) {
      for (const cell of cellsAlong(r.ax, r.az, r.bx, r.bz, 1)) {
        if (!this.railGrid.has(cell)) this.railGrid.set(cell, []);
        this.railGrid.get(cell).push(r);
      }
    }
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
    return (g[o] * (1 - u) + g[o + 1] * u) * (1 - v) + (g[o + 3] * (1 - u) + g[o + 2] * u) * v;
  }

  tileKind(x, z) {
    const tx = Math.floor(x), tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= this.N || tz >= this.N) return 1;
    return this.blocked[tz * this.N + tx];
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
  return rails.filter(r => r.len >= 1);
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
