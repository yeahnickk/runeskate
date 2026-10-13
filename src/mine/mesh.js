// Chunk meshing as Minecraft draws it: only faces that show, per-vertex ambient occlusion and smooth lighting (sky +
// block light, flood-filled over the chunk padded by 15 so light from the neighbours reaches in), face shading (top
// 1, N/S 0.8, E/W 0.6, bottom 0.5), cross plants, torches, fences, doors, ladders, liquids. Pure: returns typed arrays
// of quads (4 verts each; the renderer shares one quad index buffer).
import { BLOCKS, TI, liquidTop } from './blocks.js'
import { CS, WH, ci } from './world.js'
import { edgeBoxes } from './phys.js'

const P = 15, R = CS + 2 * P
export const OPAC = new Uint8Array(256), EMIT = new Uint8Array(256), OPQ = new Uint8Array(256), SOLIDAO = new Uint8Array(256)
for (const b of BLOCKS) if (b) { OPAC[b.id] = b.opac; EMIT[b.id] = b.light; OPQ[b.id] = b.op && b.shape === 'cube' ? 1 : 0; SOLIDAO[b.id] = OPQ[b.id] }
// faces: normal, corners BL BR TR TL (CCW from outside), shade
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], sh: 0.6, k: 'side' },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], sh: 0.6, k: 'side' },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], sh: 1, k: 'top' },
  { n: [0, -1, 0], c: [[1, 0, 1], [0, 0, 1], [0, 0, 0], [1, 0, 0]], sh: 0.5, k: 'bot' },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], sh: 0.8, k: 'side' },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], sh: 0.8, k: 'side' },
]
// facing meta (0 north(-Z), 1 east(+X), 2 south(+Z), 3 west(-X)) -> which face index is the front
export const FRONT = [5, 0, 4, 1]
const AOB = [0.5, 0.68, 0.84, 1]

class Buf {
  constructor() { this.n = 0; this.cap = 1024; this.pos = new Float32Array(this.cap * 12); this.uv = new Float32Array(this.cap * 8); this.lt = new Uint8Array(this.cap * 16); this.tc = new Uint8Array(this.cap * 16); this.tf = null }
  grow() {
    this.cap *= 2
    const p = new Float32Array(this.cap * 12); p.set(this.pos); this.pos = p
    const u = new Float32Array(this.cap * 8); u.set(this.uv); this.uv = u
    const l = new Uint8Array(this.cap * 16); l.set(this.lt); this.lt = l
    const t = new Uint8Array(this.cap * 16); t.set(this.tc); this.tc = t
  }
  // v: 4 verts [x,y,z,u,v,sky,blk,shade]
  quad(v, rot = 0) {
    if (this.n >= this.cap) this.grow()
    const q = this.n++
    for (let j = 0; j < 4; j++) {
      const s = v[(j + rot) & 3], o = q * 4 + j
      this.pos[o * 3] = s[0]; this.pos[o * 3 + 1] = s[1]; this.pos[o * 3 + 2] = s[2]
      this.uv[o * 2] = s[3]; this.uv[o * 2 + 1] = s[4]
      this.lt[o * 4] = s[5]; this.lt[o * 4 + 1] = s[6]; this.lt[o * 4 + 2] = s[7]; this.lt[o * 4 + 3] = s[8] || 0
      if (this.tf) { this.tf(s[0], s[2], this.tc, o * 4); this.tc[o * 4 + 3] = 255 }         // (tinted: the RS ground colour at the vertex)
    }
  }
  out() { return { n: this.n, pos: this.pos.slice(0, this.n * 12), uv: this.uv.slice(0, this.n * 8), lt: this.lt.slice(0, this.n * 16), tc: this.tc.slice(0, this.n * 16) } }
}

// atlas uv of a tile; u0..u1 / v0..v1 in 16ths of the tile (v up)
function tuv(tile, u, v) { const t = TI[tile]; return [((t & 15) + u / 16) / 16, 1 - ((t >> 4) + 1 - v / 16) / 16] }

let SCR = null
// light + blocks over the chunk padded by P; returns the scratch (reused between calls)
export function lightRegion(world, cx, cz) {
  const ch = []
  let top = 1
  for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) { const k = world.chunk(cx + a, cz + c); ch[(c + 1) * 3 + a + 1] = k; top = Math.max(top, k.top) }
  const Hr = Math.min(WH, top + 1), N = R * R * Hr
  if (!SCR || SCR.cap < N) SCR = { cap: N, b: new Uint8Array(N), sky: new Uint8Array(N), bl: new Uint8Array(N), q: new Int32Array(N) }
  const { b, sky, bl, q } = SCR
  const x0 = cx * CS - P, z0 = cz * CS - P
  for (let rz = 0; rz < R; rz++) for (let rx = 0; rx < R; rx++) {
    const wx = x0 + rx, wz = z0 + rz, k = ch[((wz >> 4) - cz + 1) * 3 + (wx >> 4) - cx + 1], s = ci(wx & 15, wz & 15, 0)
    b.set(k.b.subarray(s, s + Hr), (rz * R + rx) * Hr)
  }
  // sky: straight down from the top until something stops it
  let qn = 0
  for (let col = 0; col < R * R; col++) {
    let l = 15, o = col * Hr
    for (let y = Hr - 1; y >= 0; y--) {
      const op = OPAC[b[o + y]]
      if (op >= 15) l = 0; else if (op) l = Math.max(0, l - op)
      sky[o + y] = l; bl[o + y] = EMIT[b[o + y]]
    }
  }
  const XS = Hr, ZS = R * Hr
  const spread = (L, seedSky) => {
    let h = 0; qn = 0
    for (let rz = 0; rz < R; rz++) for (let rx = 0; rx < R; rx++) {
      const o = (rz * R + rx) * Hr
      for (let y = 0; y < Hr; y++) {
        const i = o + y, l = L[i]
        if (l < 2) continue
        if (!seedSky) { q[qn++] = i; continue }
        // a sky cell only seeds if some neighbour is darker than it'd light it
        if ((rx > 0 && L[i - XS] < l - 1 && OPAC[b[i - XS]] < 15) || (rx < R - 1 && L[i + XS] < l - 1 && OPAC[b[i + XS]] < 15) ||
          (rz > 0 && L[i - ZS] < l - 1 && OPAC[b[i - ZS]] < 15) || (rz < R - 1 && L[i + ZS] < l - 1 && OPAC[b[i + ZS]] < 15) ||
          (y > 0 && L[i - 1] < l - 1 && OPAC[b[i - 1]] < 15) || (y < Hr - 1 && L[i + 1] < l - 1 && OPAC[b[i + 1]] < 15)) q[qn++] = i
      }
    }
    while (h < qn) {
      const i = q[h++], l = L[i], y = i % Hr, col = (i - y) / Hr, rx = col % R, rz = (col - rx) / R
      const go = (j) => { const op = OPAC[b[j]]; if (op >= 15) return; const nl = l - Math.max(1, op); if (nl > L[j]) { L[j] = nl; if (nl > 1) q[qn++] = j } }
      if (rx > 0) go(i - XS); if (rx < R - 1) go(i + XS); if (rz > 0) go(i - ZS); if (rz < R - 1) go(i + ZS); if (y > 0) go(i - 1); if (y < Hr - 1) go(i + 1)
    }
  }
  spread(sky, true); spread(bl, false)
  return { b, sky, bl, Hr, ch }
}

// light (sky, block 0-15) at a world block, for mobs/spawning/the F3 screen: from the last region, or a quick column guess
export function lightAt(world, x, y, z) {
  let sky = 15
  for (let yy = WH - 1; yy > y; yy--) { const o = OPAC[world.get(x, yy, z)]; if (o >= 15) { sky = 0; break } sky = Math.max(0, sky - o) }
  return sky
}

export function meshChunk(world, cx, cz, opts = {}) {
  const { b, sky, bl, Hr, ch } = lightRegion(world, cx, cz)
  const me = ch[4], fancy = opts.fancy !== false
  const S = new Buf(), Wt = new Buf()
  const I = (rx, rz, y) => (rz * R + rx) * Hr + y
  const at = (rx, rz, y) => y < 0 ? 5 : y >= Hr ? 0 : b[I(rx, rz, y)]
  const SK = (rx, rz, y) => y >= Hr ? 15 : y < 0 ? 0 : sky[I(rx, rz, y)]
  const BL = (rx, rz, y) => y >= Hr || y < 0 ? 0 : bl[I(rx, rz, y)]
  const ox = cx * CS, oz = cz * CS
  const tmp = [[0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0]]
  const ao = [0, 0, 0, 0]
  // the grass tint at a vertex (chunk-local x, z): bilinear over the tiles round it, so colours blend as MC's biomes
  const T4 = new Uint8Array(12)
  const tAt = opts.rs ? (X, Z, o, k) => world.rgbAt(X, Z, o, k) : (X, Z, o, k) => world.tintAt(X, Z, o, k)
  const tf = (x, z, o, k) => {
    const fx = ox + x - 0.5, fz = oz + z - 0.5, X = Math.floor(fx), Z = Math.floor(fz), a = fx - X, c = fz - Z
    tAt(X, Z, T4, 0); tAt(X + 1, Z, T4, 3); tAt(X, Z + 1, T4, 6); tAt(X + 1, Z + 1, T4, 9)
    for (let j = 0; j < 3; j++) o[k + j] = (T4[j] * (1 - a) + T4[3 + j] * a) * (1 - c) + (T4[6 + j] * (1 - a) + T4[9 + j] * a) * c
  }

  // one face of a box [x0..x1] (blocks, 0-1) at cell rx,rz,y; smooth light + AO sampled from the face's neighbour cells
  // tops: the top edge's height per corner (block units over ry; a side face cut or stretched to the RS ground)
  function face(buf, f, rx, ry, rz, box, tile, flags = 0, smooth = true, uvRot = 0, tops = null) {
    const F = FACES[f], n = F.n
    const ax = n[0] ? 0 : n[1] ? 1 : 2, t1 = ax === 0 ? 2 : 0, t2 = ax === 1 ? 2 : 1
    const bx = rx + n[0], by = ry + n[1], bz = rz + n[2]
    const own = !smooth
    for (let j = 0; j < 4; j++) {
      const c = F.c[j], v = tmp[j]
      const p = [c[0] ? box[3] : box[0], c[1] ? (tops ? (tops.length === 4 ? tops[c[0] + 2 * c[2]] : tops[c[0] + c[2]]) : box[4]) : box[1], c[2] ? box[5] : box[2]]
      v[0] = rx - P + p[0] + ox - ox; v[1] = ry + p[1]; v[2] = rz - P + p[2]
      // uv: sides use (horizontal tangent, y); top/bottom use (x, z)
      let u, w
      if (ax === 1) { u = p[0]; w = 1 - p[2] } else { u = ax === 0 ? (n[0] > 0 ? 1 - p[2] : p[2]) : (n[2] > 0 ? p[0] : 1 - p[0]); w = Math.min(1, p[1]) }
      if (uvRot === 1) { const t = u; u = w; w = 1 - t } else if (uvRot === 2) { u = 1 - u; w = 1 - w } else if (uvRot === 3) { const t = u; u = 1 - w; w = t }
      const uv = tuv(tile, u * 16, w * 16); v[3] = uv[0]; v[4] = uv[1]
      if (own) { v[5] = SK(rx, rz, ry) * 17; v[6] = BL(rx, rz, ry) * 17; v[7] = F.sh * 255; v[8] = flags; ao[j] = 3; continue }
      const s1 = c[t1] ? 1 : -1, s2 = c[t2] ? 1 : -1
      const d1 = [0, 0, 0], d2 = [0, 0, 0]; d1[t1] = s1; d2[t2] = s2
      const A = [bx + d1[0], by + d1[1], bz + d1[2]], Bc = [bx + d2[0], by + d2[1], bz + d2[2]], C = [bx + d1[0] + d2[0], by + d1[1] + d2[1], bz + d1[2] + d2[2]]
      const o1 = SOLIDAO[at(A[0], A[2], A[1])], o2 = SOLIDAO[at(Bc[0], Bc[2], Bc[1])], oc = SOLIDAO[at(C[0], C[2], C[1])]
      const a = o1 && o2 ? 0 : 3 - o1 - o2 - oc
      ao[j] = a
      let ss = SK(bx, bz, by), bb = BL(bx, bz, by), k = 1
      if (!o1) { ss += SK(A[0], A[2], A[1]); bb += BL(A[0], A[2], A[1]); k++ }
      if (!o2) { ss += SK(Bc[0], Bc[2], Bc[1]); bb += BL(Bc[0], Bc[2], Bc[1]); k++ }
      if (!oc && !(o1 && o2)) { ss += SK(C[0], C[2], C[1]); bb += BL(C[0], C[2], C[1]); k++ }
      v[5] = ss / k * 17; v[6] = bb / k * 17; v[7] = F.sh * AOB[a] * 255; v[8] = flags
    }
    buf.quad(tmp, ao[0] + ao[2] < ao[1] + ao[3] ? 1 : 0)
  }
  // a double-sided plant quad pair, X shaped
  function cross(buf, rx, ry, rz, tile, h = 1, inset = 0.15) {
    const s = SK(rx, rz, ry) * 17, l = BL(rx, rz, ry) * 17, X = rx - P, Z = rz - P
    const a = inset, c = 1 - inset
    const quads = [[[a, a], [c, c]], [[c, a], [a, c]]]
    for (const [[x0, z0], [x1, z1]] of quads) {
      const uv0 = tuv(tile, 0, 0), uv1 = tuv(tile, 16, 16 * h)
      const v = [[X + x0, ry, Z + z0, uv0[0], uv0[1], s, l, 230, 2], [X + x1, ry, Z + z1, uv1[0], uv0[1], s, l, 230, 2],
        [X + x1, ry + h, Z + z1, uv1[0], uv1[1], s, l, 255, 2], [X + x0, ry + h, Z + z0, uv0[0], uv1[1], s, l, 255, 2]]
      buf.quad(v); buf.quad([v[1], v[0], v[3], v[2]])
    }
  }
  // a box of 16ths with per-face tiles; cull: whether a face against an opaque neighbour is skipped
  function box(buf, rx, ry, rz, bx16, tiles, smooth = true) {
    const bb = bx16.map(v => v / 16)
    for (let f = 0; f < 6; f++) {
      const n = FACES[f].n
      const flush = (n[0] > 0 && bb[3] === 1) || (n[0] < 0 && bb[0] === 0) || (n[1] > 0 && bb[4] === 1) || (n[1] < 0 && bb[1] === 0) || (n[2] > 0 && bb[5] === 1) || (n[2] < 0 && bb[2] === 0)
      if (flush && OPQ[at(rx + n[0], rz + n[2], ry + n[1])]) continue
      const t = tiles[f]
      if (!t) continue
      faceBox(buf, f, rx, ry, rz, bb, t, smooth)
    }
  }
  // a face of a sub-block box: uv cropped to the box (MC's model uv), light from the face's neighbour if flush else own
  function faceBox(buf, f, rx, ry, rz, bb, tile, smooth) {
    const F = FACES[f], n = F.n
    const ax = n[0] ? 0 : n[1] ? 1 : 2
    const flush = (n[0] > 0 && bb[3] === 1) || (n[0] < 0 && bb[0] === 0) || (n[1] > 0 && bb[4] === 1) || (n[1] < 0 && bb[1] === 0) || (n[2] > 0 && bb[5] === 1) || (n[2] < 0 && bb[2] === 0)
    if (flush && smooth) return face(buf, f, rx, ry, rz, bb, tile)
    const s = Math.max(SK(rx, rz, ry), flush ? SK(rx + n[0], rz + n[2], ry + n[1]) : 0) * 17, l = Math.max(BL(rx, rz, ry), flush ? BL(rx + n[0], rz + n[2], ry + n[1]) : 0) * 17
    for (let j = 0; j < 4; j++) {
      const c = F.c[j], v = tmp[j]
      const p = [c[0] ? bb[3] : bb[0], c[1] ? bb[4] : bb[1], c[2] ? bb[5] : bb[2]]
      v[0] = rx - P + p[0]; v[1] = ry + p[1]; v[2] = rz - P + p[2]
      let u, w
      if (ax === 1) { u = p[0]; w = 1 - p[2] } else { u = ax === 0 ? (n[0] > 0 ? 1 - p[2] : p[2]) : (n[2] > 0 ? p[0] : 1 - p[0]); w = p[1] }
      const uv = tuv(tile, u * 16, w * 16); v[3] = uv[0]; v[4] = uv[1]
      v[5] = s; v[6] = l; v[7] = F.sh * 255; v[8] = 0
    }
    buf.quad(tmp)
  }

  // under the RS world (opts.rs): the map's own blocks from just under the ground up stay hidden (the RS meshes draw
  // them) unless their tile is blocks now (rs.vx) or a face looks into a cell you changed or a tile that is blocks
  const rs = opts.rs, ED = rs ? edMask(world, cx, cz, Hr) : null
  const hz = new Int16Array((CS + 2) * (CS + 2)).fill(WH)    // per column (padded by 1): the lowest y hidden, WH = none
  const hh = new Int16Array((CS + 2) * (CS + 2)).fill(WH)    // ... and the highest (a tile whose wall was knocked out
  if (rs) for (let a = -1; a <= CS; a++) for (let c = -1; c <= CS; c++) {   // keeps its ground: the rest shows as blocks)
    const t = world.tile(ox + a, oz + c), k = (c + 1) * (CS + 2) + a + 1
    if (t >= 0 && rs.cover[t] && rs.vx[t] !== 1) { hz[k] = world.gy[t] - 1; if (rs.vx[t] === 3) hh[k] = world.gy[t] }
  }
  const colK = (rx, rz) => (rz - P + 1) * (CS + 2) + rx - P + 1
  const hidden = (rx, rz, y) => { const k = colK(rx, rz); return y >= hz[k] && y <= hh[k] && !ED[I(rx, rz, y)] }
  // a face of a hidden block shows where the cell it faces was changed, or its column is blocks, or the cell is under
  // that column's RS ground (a cave, the air under a bridge deck: RS draws nothing there, so no seeing through the bank)
  const faceShows = (rx, rz, y) => { const k = colK(rx, rz); return hz[k] === WH || y <= hz[k] || (y >= 0 && y < Hr && ED[I(rx, rz, y)]) }
  // ...and toward a dug tile it meets the RS ground exactly: its top edge cut (or, the column's top block, stretched)
  // to the ground's height at the two corners, so the RS terrain and the pit wall share an edge with no gap
  const RT = [0, 0, 0]
  const rsTops = (f, rx, rz, y, top) => {
    if (!rs.h) return null
    const n = FACES[f].n, X = ox + rx - P, Z = oz + rz - P
    // the face's two top corners: (c0 + c2) indexes them as face() does
    const cs = n[0] ? [[n[0] > 0 ? 1 : 0, 0], [n[0] > 0 ? 1 : 0, 1]] : [[0, n[2] > 0 ? 1 : 0], [1, n[2] > 0 ? 1 : 0]]
    let any = false
    for (const [a, c] of cs) {
      const g = rs.h(X + a, Z + c); if (g === null) return null
      let h = g - y; if (!top) h = Math.min(1, h); h = Math.max(0, Math.min(2.5, h)); if (h > 0.01) any = true
      RT[a + c] = h
    }
    return any ? RT : false
  }
  for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
    const rx = lx + P, rz = lz + P, col = I(rx, rz, 0)
    for (let y = 0; y < Hr; y++) {
      const id = b[col + y]
      if (!id) continue
      const d = BLOCKS[id]
      if (!d) continue
      const hid = rs && hidden(rx, rz, y)
      const slab = hid && Array.isArray(d.shape) && d.shape[3] - d.shape[0] === 16 && d.shape[5] - d.shape[2] === 16 && d.shape[4] >= 14   // (a path or farmland the map has at its ground: a cube to the tunnel beside it)
      if (hid && !slab && d.shape !== 'cube' && d.shape !== 'liquid') continue
      if (hid && y > hz[colK(rx, rz)] + 1 && (slab || d.shape === 'cube')) continue        // (over the ground the tile's RS models still stand: a roof, a wall)
      const sh = slab ? 'cube' : d.shape, meta = me.m[ci(lx, lz, y)]
      S.tf = d.tint ? tf : null
      if (sh === 'cube') {
        const tr = d.tr === 'cut'
        for (let f = 0; f < 6; f++) {
          const n = FACES[f].n, nb = at(rx + n[0], rz + n[2], y + n[1])
          if (OPQ[nb]) continue
          const wet = BLOCKS[nb] && BLOCKS[nb].liquid === 'water'       // (RS draws nothing under the water: the banks and bed are blocks)
          if (hid && !faceShows(rx + n[0], rz + n[2], y + n[1]) && !wet) continue
          if (hid && n[1] > 0 && y === hz[colK(rx, rz)] + 1) continue     // (the ground's own top: RS draws it, even under a felled tree)
          if (tr && nb === id && (!d.leaves || !fancy)) continue
          let tops = null
          if (hid && n[1] === 0 && (wet || hz[colK(rx + n[0], rz + n[2])] === WH) && !OPQ[at(rx + n[0], rz + n[2], y + 1)]) {   // (cut to the ground only where the hole is open above: a tunnel's ceiling keeps the wall whole)
            tops = rsTops(f, rx, rz, y, !OPQ[at(rx, rz, y + 1)] || (y > hz[colK(rx, rz)] && hidden(rx, rz, y + 1))); if (tops === false) continue }   // (a trunk or wall over it is RS's to draw: still stretch up to the ground)
          let tile = d.t[FACES[f].k]
          let rot = 0
          if (d.facing && d.t.front && f === FRONT[meta & 3]) tile = d.t.front
          if (id === 1 && f === 2) rot = (hash4(ox + lx, y, oz + lz) & 3)      // (MC's random grass rotation)
          face(S, f, rx, y, rz, [0, 0, 0, 1, 1, 1], tile, 0, true, rot, tops)
        }
      } else if (sh === 'cross') {
        cross(S, rx, y, rz, d.t.side)
      } else if (sh === 'liquid') {
        const buf = d.liquid === 'water' ? Wt : S
        // the surface by the flow level (MC: a source or a fall 14/16 high, flowing 1..7 down to 1/9), full under its own
        // kind; each corner the average of the cells round it (a source counts 10, open air beside 1 at nothing), as MC,
        // so a flow slopes smoothly down and neighbours share their edges
        const full = at(rx, rz, y + 1) === id
        const corner = (a, c) => {
          let s = 0, n = 0
          for (let i = -1; i <= 0; i++) for (let k = -1; k <= 0; k++) {
            const qx = rx + a + i, qz = rz + c + k, q = at(qx, qz, y)
            if (q === id) { if (at(qx, qz, y + 1) === id) return 1; const m = world.meta(ox + qx - P, y, oz + qz - P), w = (m & 15) === 0 ? 10 : 1; s += liquidTop(m) * w; n += w }
            else if (!BLOCKS[q] || !BLOCKS[q].solid) n++
          }
          return n ? s / n : 14 / 16
        }
        const tops = full ? null : [corner(0, 0), corner(1, 0), corner(0, 1), corner(1, 1)]
        for (let f = 0; f < 6; f++) {
          const n = FACES[f].n, nb = at(rx + n[0], rz + n[2], y + n[1])
          if (nb === id || OPQ[nb]) continue
          if (hid && !faceShows(rx + n[0], rz + n[2], y + n[1])) continue
          if (f !== 2 && BLOCKS[nb] && BLOCKS[nb].liquid) continue
          face(buf, f, rx, y, rz, [0, 0, 0, 1, 1, 1], d.t.side, d.liquid === 'water' ? 1 : 3, false, 0, n[1] < 0 ? null : tops)
          if (d.liquid === 'water' && f === 2) {        // (seen from under the surface too)
            const v = buf.n - 1, q = [0, 1, 2, 3].map(j => { const o = v * 4 + j; return [buf.pos[o * 3], buf.pos[o * 3 + 1], buf.pos[o * 3 + 2], buf.uv[o * 2], buf.uv[o * 2 + 1], buf.lt[o * 4], buf.lt[o * 4 + 1], buf.lt[o * 4 + 2], 1] })
            buf.quad([q[1], q[0], q[3], q[2]])
          }
        }
      } else if (sh === 'torch') {
        const w = meta & 7, o = [[0, 0], [0, 5], [-5, 0], [0, -5], [5, 0]][w] || [0, 0], dy = w ? 3 : 0
        const bx = [7 + o[0], dy, 7 + o[1], 9 + o[0], 10 + dy, 9 + o[1]]
        const t = d.t.side, tl = [t, t, t, t, t, t]
        const bb = bx.map(v => v / 16)
        for (let f = 0; f < 6; f++) {
          if (f === 3 && dy === 0) continue
          // torch faces show the middle 2 px of the texture
          const F = FACES[f], s = SK(rx, rz, y) * 17, l = BL(rx, rz, y) * 17
          for (let j = 0; j < 4; j++) {
            const c = F.c[j], v = tmp[j]
            v[0] = rx - P + (c[0] ? bb[3] : bb[0]); v[1] = y + (c[1] ? bb[4] : bb[1]); v[2] = rz - P + (c[2] ? bb[5] : bb[2])
            const ax = F.n[0] ? 0 : F.n[1] ? 1 : 2
            let u, w2
            if (ax === 1) { u = 7 + (c[0] ? 2 : 0); w2 = f === 2 ? 8 + (c[2] ? 0 : 2) : (c[2] ? 0 : 2) } else { u = 7 + ((ax === 0 ? c[2] : c[0]) ? 2 : 0); w2 = c[1] ? 10 : 0 }
            const uv = tuv(t, u, w2); v[3] = uv[0]; v[4] = uv[1]; v[5] = s; v[6] = l; v[7] = 255; v[8] = 0
          }
          S.quad(tmp)
        }
      } else if (sh === 'fence') {
        const T = d.t.side, tl = [T, T, T, T, T, T]
        box(S, rx, y, rz, [6, 0, 6, 10, 16, 10], tl, false)
        const con = (dx, dz) => { const nb = at(rx + dx, rz + dz, y); return nb === id || OPQ[nb] }
        for (const [dx, dz, bx] of [[1, 0, [10, 0, 7, 16, 0, 9]], [-1, 0, [0, 0, 7, 6, 0, 9]], [0, 1, [7, 0, 10, 9, 0, 16]], [0, -1, [7, 0, 0, 9, 0, 6]]]) {
          if (!con(dx, dz)) continue
          box(S, rx, y, rz, [bx[0], 12, bx[2], bx[3], 15, bx[5]], tl, false)
          box(S, rx, y, rz, [bx[0], 6, bx[2], bx[3], 9, bx[5]], tl, false)
        }
      } else if (sh === 'edge') {                         // RS walls and fences: thin slabs on the tile's edges
        const T = d.t.side, tl = [T, T, d.t.top || T, T, T, T]
        for (const bx of edgeBoxes(meta, 1)) box(S, rx, y, rz, bx.map(v => Math.round(v * 16)), tl, false)
      } else if (sh === 'door') {
        const bx = doorBox(meta), T = d.t.side
        box(S, rx, y, rz, bx, [T, T, d.door === 2 ? T : null, d.door === 1 ? 'planks' : null, T, T], false)
      } else if (sh === 'ladder') {
        const bx = [[0, 0, 15, 16, 16, 16], [0, 0, 0, 1, 16, 16], [0, 0, 0, 16, 16, 1], [15, 0, 0, 16, 16, 16]][meta & 3]
        const T = d.t.side
        box(S, rx, y, rz, bx, [T, T, null, null, T, T], false)
      } else if (Array.isArray(sh)) {
        const t = d.t, F = FRONT[meta & 3]
        const tiles = FACES.map((F2, f) => d.facing && t.front && f === F ? t.front : t[F2.k])
        if (d.bed) {                                      // a bed: head half (meta bit 4) gets the pillow
          const head = meta & 4
          tiles[2] = head ? 'bed_head' : 'bed_foot'
          for (const f of [0, 1, 4, 5]) tiles[f] = f === FRONT[meta & 3] ? (head ? 'bed_end' : null) : f === FRONT[(meta + 2) & 3] ? (head ? null : 'bed_end') : head ? 'bed_side_head' : 'bed_side_foot'
          if (!head) for (const f of [0, 1, 4, 5]) if (f === FRONT[meta & 3]) tiles[f] = null
        }
        box(S, rx, y, rz, sh, tiles, !d.chest && !d.cactus)
      }
    }
  }
  S.tf = null
  return { s: S.out(), w: Wt.out(), ver: me.ver }
}
// which cells of the padded region hold an edit (the player changed them)
let EDS = null
function edMask(world, cx, cz, Hr) {
  const N = R * R * Hr
  if (!EDS || EDS.length < N) EDS = new Uint8Array(N); else EDS.fill(0, 0, N)
  for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) {
    const e = world.edits.get((cx + a) + ',' + (cz + c)); if (!e) continue
    for (const i of e.keys()) {
      const y = i % WH; if (y >= Hr) continue
      const col = (i - y) / WH, lx = col & 15, lz = col >> 4, rx = lx + a * CS + P, rz = lz + c * CS + P
      if (rx >= 0 && rx < R && rz >= 0 && rz < R) EDS[(rz * R + rx) * Hr + y] = 1
    }
  }
  return EDS
}
const hash4 = (x, y, z) => ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 8)

// a door's slab (meta: facing 0-3, bit 4 open)
export function doorBox(meta) {
  const f = (meta & 3) + (meta & 4 ? 1 : 0)
  return [[0, 0, 13, 16, 16, 16], [0, 0, 0, 3, 16, 16], [0, 0, 0, 16, 16, 3], [13, 0, 0, 16, 16, 16]][f & 3]
}
