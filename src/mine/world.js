// MineScape's world: 16x16 chunk columns, 128 high, generated from the baked RS map (tools/mine-bake.py) one tile a
// block. Block coords are three.js-native: X = tile x (east), Y up, Z = -(tile z) - 1 (north is -Z). Under the RS
// ground: dirt, stone, caves, ores and bedrock, as Minecraft. Player edits are kept per chunk (saved by main.js).
// Pure: no DOM, no three.
import { BLOCKS } from './blocks.js'

export const CS = 16, WH = 128
export const ci = (x, z, y) => ((z << 4) | x) * WH + y          // index in a chunk: columns contiguous
const ROOF = [33, 34, 35, 36, 37], WALL = [21, 38, 11, 36, 21]
// a wall's block from its RS colour (bake's json.walls: grey castle stone, dark stone, plaster, timber, brick, sandstone)
const WALLC = [0, 21, 4, 71, 11, 38, 53]
// grass/leaf tint: the RS ground colour brought to MC grass brightness, over the texture's own green (TREF)
const TREF = [116, 182, 74], TLUM = 95

// integer hash -> [0,1)
export function hash(a, b, c, s = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647) ^ Math.imul(s | 0, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
export function rngOf(seed) {         // mulberry32
  let a = seed >>> 0
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const sm = (t) => t * t * (3 - 2 * t)
function noise3(x, y, z, s) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), fx = sm(x - X), fy = sm(y - Y), fz = sm(z - Z)
  const h = (i, j, k) => hash(X + i, Y + j, Z + k, s) * 2 - 1
  const l = (a, b, t) => a + (b - a) * t
  return l(l(l(h(0, 0, 0), h(1, 0, 0), fx), l(h(0, 1, 0), h(1, 1, 0), fx), fy), l(l(h(0, 0, 1), h(1, 0, 1), fx), l(h(0, 1, 1), h(1, 1, 1), fx), fy), fz)
}

export class World {
  // map: { json, bin: Uint8Array } from assets/mine_world.*
  constructor(map, seed = 1) {
    const j = map.json, W = j.W, H = j.H, n = W * H, b = map.bin
    Object.assign(this, { W, H, base: j.base, seed, json: j })
    this.gy = b.subarray(0, n); this.sf = b.subarray(n, 2 * n); this.ru = b.subarray(2 * n, 3 * n); this.rc = b.subarray(3 * n, 4 * n); this.fl = b.subarray(4 * n, 5 * n)
    this.wc = b.length >= 6 * n ? b.subarray(5 * n, 6 * n) : new Uint8Array(n)
    // the tint multiplier per tile (x128 = 1), from the RS ground colour planes
    const T = this.tint = new Uint8Array(n * 3)
    if (b.length >= 9 * n) for (let i = 0; i < n; i++) {
      let r = b[6 * n + i], g = b[7 * n + i], bb = b[8 * n + i]
      const L = Math.max(20, (r + g + bb) / 3), k = TLUM / L
      r = r * 0.8 + L * 0.2; g = g * 0.8 + L * 0.2; bb = Math.min(bb * 0.8 + L * 0.2, g * 0.5); r = Math.min(r, g * 1.15)   // (kept to grass hues: no teal, no red)
      T[i * 3] = Math.min(255, r * k / TREF[0] * 128); T[i * 3 + 1] = Math.min(255, g * k / TREF[1] * 128); T[i * 3 + 2] = Math.min(255, bb * k / TREF[2] * 128)
    } else T.fill(128)
    this.chunks = new Map(); this.edits = new Map(); this.listeners = []
    // roofs step up toward the middle (distance to the roof's edge, 2-pass chamfer)
    const d = this.rd = new Uint8Array(n)
    for (let i = 0; i < n; i++) d[i] = this.ru[i] ? 99 : 0
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) { const i = z * W + x; if (!d[i]) continue; d[i] = Math.min(d[i], 1 + Math.min(x ? d[i - 1] : 0, z ? d[i - W] : 0)) }
    for (let z = H - 1; z >= 0; z--) for (let x = W - 1; x >= 0; x--) { const i = z * W + x; if (!d[i]) continue; d[i] = Math.min(d[i], 1 + Math.min(x < W - 1 ? d[i + 1] : 0, z < H - 1 ? d[i + W] : 0)) }
    // trees: thinned so canopies don't merge into one blob, bucketed by the chunks they reach
    this.treeAt = new Map()
    const taken = new Set(), tk = (x, z) => x + ',' + z
    for (const [x, t] of j.trees) {
      let near = false
      for (let a = -2; a <= 2 && !near; a++) for (let c = -2; c <= 2; c++) if (taken.has(tk(x + a, t + c))) { near = true; break }
      if (near || (this.fl[t * W + x] & 16)) continue
      taken.add(tk(x, t))
      const X = x, Z = -t - 1
      for (let cx = Math.floor((X - 3) / CS); cx <= Math.floor((X + 3) / CS); cx++)
        for (let cz = Math.floor((Z - 3) / CS); cz <= Math.floor((Z + 3) / CS); cz++) {
          const k = cx + ',' + cz; if (!this.treeAt.has(k)) this.treeAt.set(k, []); this.treeAt.get(k).push([X, Z, t * W + x])
        }
    }
  }
  tile(X, Z) { const t = -Z - 1; return X >= 0 && X < this.W && t >= 0 && t < this.H ? t * this.W + X : -1 }
  // the grass tint multiplier (x128 = 1) at a block, into o[0..2]
  tintAt(X, Z, o, k = 0) { const i = this.tile(X, Z); if (i < 0) { o[k] = 104; o[k + 1] = 86; o[k + 2] = 90; return } o[k] = this.tint[i * 3]; o[k + 1] = this.tint[i * 3 + 1]; o[k + 2] = this.tint[i * 3 + 2] }
  groundY(X, Z) { const i = this.tile(X, Z); return i < 0 ? this.base - 1 : this.gy[i] }
  chunk(cx, cz) {
    const k = cx + ',' + cz
    let c = this.chunks.get(k)
    if (!c) { c = this.gen(cx, cz); this.chunks.set(k, c) }
    return c
  }
  has(cx, cz) { return this.chunks.has(cx + ',' + cz) }
  get(x, y, z) {
    if (y < 0 || y >= WH) return 0
    const c = this.chunk(x >> 4, z >> 4)
    return c.b[ci(x & 15, z & 15, y)]
  }
  meta(x, y, z) {
    if (y < 0 || y >= WH) return 0
    return this.chunk(x >> 4, z >> 4).m[ci(x & 15, z & 15, y)]
  }
  set(x, y, z, id, meta = 0) {
    if (y < 0 || y >= WH) return false
    const cx = x >> 4, cz = z >> 4, c = this.chunk(cx, cz), i = ci(x & 15, z & 15, y)
    const was = c.b[i]
    c.b[i] = id; c.m[i] = meta; c.ver++
    if (y + 1 > c.top) c.top = y + 1
    const k = cx + ',' + cz
    let e = this.edits.get(k); if (!e) this.edits.set(k, e = new Map())
    e.set(i, id | (meta << 8))
    for (const f of this.listeners) f(x, y, z, id, was)
    return true
  }
  // highest block that isn't air (or passable plants) in a column
  top(x, z, solidOnly = false) {
    for (let y = WH - 1; y > 0; y--) { const b = this.get(x, y, z); if (b && (!solidOnly || BLOCKS[b].solid || BLOCKS[b].liquid)) return y }
    return 0
  }
  saveEdits() { const o = {}; for (const [k, e] of this.edits) o[k] = [...e].flat(); return o }
  loadEdits(o) {
    this.edits.clear()
    for (const k in o) { const a = o[k], e = new Map(); for (let i = 0; i < a.length; i += 2) e.set(a[i], a[i + 1]); this.edits.set(k, e) }
    this.chunks.clear()
  }

  gen(cx, cz) {
    const b = new Uint8Array(CS * CS * WH), m = new Uint8Array(CS * CS * WH), S = this.seed, base = this.base
    let top = 0
    const put = (x, z, y, id) => { b[ci(x, z, y)] = id; if (y + 1 > top) top = y + 1 }
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      const X = cx * CS + lx, Z = cz * CS + lz, ti = this.tile(X, Z)
      put(lx, lz, 0, 5)
      for (let y = 1; y < 4; y++) b[ci(lx, lz, y)] = hash(X, y, Z, S) < (4 - y) / 5 ? 5 : 3
      if (ti < 0) {                                     // off the RS map: the open sea
        for (let y = 4; y <= base - 7; y++) b[ci(lx, lz, y)] = 3
        for (let y = base - 6; y <= base - 5; y++) b[ci(lx, lz, y)] = hash(X, y, Z, S + 1) < 0.3 ? 7 : 6
        for (let y = base - 4; y <= base - 1; y++) put(lx, lz, y, 8)
        continue
      }
      const g = this.gy[ti], s = this.sf[ti], f = this.fl[ti]
      if (s === 8) {                                    // a river or lake: 3 deep, a sand/gravel/clay bed
        const bed = g - 3
        for (let y = 4; y < bed - 2; y++) b[ci(lx, lz, y)] = 3
        for (let y = bed - 2; y <= bed; y++) { const r = hash(X, y, Z, S + 2); b[ci(lx, lz, y)] = r < 0.12 ? 69 : r < 0.45 ? 7 : r < 0.75 ? 6 : 2 }
        for (let y = bed + 1; y <= g; y++) put(lx, lz, y, 8)
        continue
      }
      const surf = s === 3 ? 3 : s
      const under = s === 6 ? 6 : s === 3 ? 3 : 2
      for (let y = 4; y < g - 3; y++) b[ci(lx, lz, y)] = 3
      for (let y = Math.max(4, g - 3); y < g; y++) b[ci(lx, lz, y)] = under
      if (s === 6) for (let y = Math.max(4, g - 6); y < g - 2; y++) b[ci(lx, lz, y)] = 53
      put(lx, lz, g, surf)
      // caves: two noise ribbons crossing = tunnels (as MC's spaghetti caves), lava pools at the bottom
      for (let y = 5; y < g - 5; y++) {
        const a = noise3(X / 18, y / 11, Z / 18, S + 11), c = noise3(X / 18, y / 11, Z / 18, S + 23)
        let cave = Math.abs(a) < 0.085 && Math.abs(c) < 0.085
        if (!cave && y < 30) cave = noise3(X / 26, y / 9, Z / 26, S + 37) > 0.6
        if (cave) b[ci(lx, lz, y)] = y <= 10 ? 9 : 0
      }
      // above the ground: walls up to the roof, roofs stepping up to a ridge, fences
      const ru = this.ru[ti]
      if (f & 1) {
        const rr = ru || this.nearRoof(X, Z)
        const wcol = WALLC[this.wc[ti]], hh = rr || 3, mat = wcol || (rr ? WALL[this.rc[ti]] : hash(X, 7, Z, S) < 0.2 ? 63 : 4)
        for (let y = g + 1; y < g + hh; y++) put(lx, lz, y, mat)
        if (rr && hh >= 3 && (X + Z) % 3 === 0) put(lx, lz, g + 2, 13)
        if (!rr) put(lx, lz, g + hh, mat)
      } else if (f & 2) put(lx, lz, g + 1, 32)
      if (ru) {
        const d = this.rd[ti], ry = g + ru + Math.min(d - 1, 3)
        put(lx, lz, ry, ROOF[this.rc[ti]])
      } else if (!(f & 3) && !(f & 4)) {                  // plants on open ground
        const r = hash(X, 1, Z, S + 5)
        if (s === 1) { if (r < 0.1) put(lx, lz, g + 1, 29); else if (r < 0.112) put(lx, lz, g + 1, 30); else if (r < 0.124) put(lx, lz, g + 1, 31); else if (r < 0.1245) put(lx, lz, g + 1, 61) }
        else if (s === 6 && r < 0.008) put(lx, lz, g + 1, 52)
      }
    }
    // ores: MC's veins, per chunk from the seed
    const R = rngOf(Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ S)
    const vein = (id, count, size, y0, y1) => {
      for (let v = 0; v < count; v++) {
        let x = R() * 16, y = y0 + R() * (y1 - y0), z = R() * 16
        for (let k = 0; k < size; k++) {
          const xi = x | 0, yi = y | 0, zi = z | 0
          if (xi >= 0 && xi < 16 && zi >= 0 && zi < 16 && yi > 0 && yi < WH && b[ci(xi, zi, yi)] === 3) b[ci(xi, zi, yi)] = id
          x += R() * 2 - 1; y += R() * 2 - 1; z += R() * 2 - 1
        }
      }
    }
    vein(14, 20, 9, 5, base + 10); vein(15, 14, 6, 5, base - 2); vein(16, 2, 6, 5, 30); vein(18, 5, 6, 5, 16); vein(17, 1, 5, 5, 15)
    if (R() < 0.6) vein(19, 1, 1, 6, 30)
    if (-(cz * CS) - 1 > 704 && R() < 0.35) vein(67, 1, 3, 5, 14)    // runite under the Wilderness
    // trees from the RS trunks (bucketed in the constructor), parts that land in this chunk
    for (const [X, Z, ti] of this.treeAt.get(cx + ',' + cz) || []) {
      const g = this.gy[ti], s = this.sf[ti], r = hash(X, 3, Z, S)
      const loc = (x, y, z, id, over) => {
        const lx = x - cx * CS, lz = z - cz * CS
        if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y >= WH) return
        const i = ci(lx, lz, y); if (b[i] && !over && b[i] !== 29) return
        b[i] = id; if (y + 1 > top) top = y + 1
      }
      if (s === 6) { const h = 2 + (r * 2 | 0); for (let y = 1; y <= h; y++) loc(X, g + y, Z, 51, true); continue }
      if (s === 8) continue
      const birch = r < 0.22, log = birch ? 46 : 10, lv = birch ? 47 : 12, h = 4 + (hash(X, 4, Z, S) * 3 | 0), t = g + h
      for (let y = t - 3; y <= t + 1; y++) {
        const rad = y >= t ? 1 : 2
        for (let a = -rad; a <= rad; a++) for (let c = -rad; c <= rad; c++) {
          const corner = Math.abs(a) === rad && Math.abs(c) === rad
          if (corner && (y === t + 1 || hash(X + a, y, Z + c, S + 9) < 0.5)) continue
          loc(X + a, y, Z + c, lv)
        }
      }
      for (let y = 1; y <= h; y++) loc(X, g + y, Z, log, true)
      loc(X, g, Z, 2, true)
    }
    const c = { cx, cz, b, m, top: Math.min(WH, top + 1), ver: 0 }
    const e = this.edits.get(cx + ',' + cz)
    if (e) for (const [i, v] of e) { c.b[i] = v & 255; c.m[i] = v >> 8; const y = i % WH; if (y + 1 >= c.top) c.top = Math.min(WH, y + 2) }
    return c
  }
  nearRoof(X, Z) {
    let r = 0
    for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const t = this.tile(X + a, Z + c); if (t >= 0 && this.ru[t] > r) r = this.ru[t] }
    return r
  }
  // RS place names for the advancements + the F3 screen (tile coords, world - (2048, 2816))
  placeName(X, Z) {
    const t = -Z - 1
    if (t > 704) return 'Wilderness'
    let best = null, bd = 1e9
    for (const [n, x, z, r] of PLACES) { const d = Math.hypot(X - x, t - z); if (d < r && d < bd) { bd = d; best = n } }
    return best
  }
}
// [name, tile x, tile z, radius]
export const PLACES = [['Lumbridge', 1174, 402, 40], ['Varrock', 1164, 612, 60], ['Falador', 916, 552, 55], ['Draynor Village', 1045, 428, 30],
  ['Al Kharid', 1245, 358, 45], ['Port Sarim', 975, 392, 30], ['Barbarian Village', 1034, 604, 25], ['Edgeville', 1045, 677, 25],
  ['Rimmington', 909, 392, 22], ['Wizards\' Tower', 1061, 342, 16], ['Draynor Manor', 1062, 552, 18], ['Lumbridge Swamp', 1150, 360, 30],
  ['Champions\' Guild', 1143, 547, 14], ['Cooks\' Guild', 1095, 552, 12], ['Taverley', 846, 616, 30], ['Burthorpe', 850, 690, 25]]
