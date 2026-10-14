// The real RS world under MineScape: the skate game's map packs (assets/world*.json/.bin, terrain + locs as the 2004
// client lit them) drawn 1:1, a tile a block, the ground at the voxel tops (y = base + 1 - RS height). Blocks are what
// you touch; these are what you see. A tile the player has changed (dug, built into, a wall knocked out) turns to
// blocks: its triangles are hidden (an index over the chunk's kept triangles, rebuilt on change) and the mesher draws
// the blocks there instead. A felled tree takes its canopy's loc triangles with it. Regions stream in as you near them.
import * as THREE from 'three'
import { nearFarPlan } from '../nearfirst.js'

const PARTS = ['terrain', 'locs', 'locs_alpha'], STREAM_AT = 40, RANK = [0, 3, 1, 2], GROUND = { terrain: 1, water: 1 }

// RS walls carry pure black caps on top and roofs are black underneath (OSRS shows them with the roofs off). From
// first person they show through every gap under an upper floor and under every eave, so an all-black triangle takes
// the colour of the nearest coloured face of the same model (its wall, its roof)
function capWalls(p, c) {
  const n = p.length / 9, blk = (i) => { for (let j = i * 9; j < i * 9 + 9; j++) if (c[j] > 6) return false; return true }
  for (let i = 0; i < n; i++) {
    if (!blk(i)) continue
    const o = i * 9
    for (let d = 1; d <= 8; d++) {
      const j = [i - d, i + d].find(j => j >= 0 && j < n && !blk(j)); if (j === undefined) continue
      for (let v = 0; v < 3; v++) for (let q = 0; q < 3; q++) c[o + v * 3 + q] = c[j * 9 + q]
      break
    }
  }
}

// Moller-Trumbore, both sides: { t, n (unit normal facing the ray) } or null
function rayTri(o, d, A, B, C) {
  const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]]
  const px = d[1] * e2[2] - d[2] * e2[1], py = d[2] * e2[0] - d[0] * e2[2], pz = d[0] * e2[1] - d[1] * e2[0]
  const det = e1[0] * px + e1[1] * py + e1[2] * pz; if (Math.abs(det) < 1e-9) return null
  const iv = 1 / det, sx = o[0] - A[0], sy = o[1] - A[1], sz = o[2] - A[2], u = (sx * px + sy * py + sz * pz) * iv; if (u < 0 || u > 1) return null
  const qx = sy * e1[2] - sz * e1[1], qy = sz * e1[0] - sx * e1[2], qz = sx * e1[1] - sy * e1[0], w = (d[0] * qx + d[1] * qy + d[2] * qz) * iv
  if (w < 0 || u + w > 1) return null
  const t = (e2[0] * qx + e2[1] * qy + e2[2] * qz) * iv; if (t <= 0.01) return null
  let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
  const l = Math.hypot(...n) || 1; n = n.map(a => a / l); if (n[0] * d[0] + n[1] * d[1] + n[2] * d[2] > 0) n = n.map(a => -a)
  return { t, n }
}

// RS roofs and long walls are a few big triangles spanning many tiles; knocking a block out hides its tile's triangles,
// so split the big ones (longest edge first) until none is over a tile across: a break takes its own tile, no more
function splitBig(p, c) {
  const n = p.length / 9, L = 128 * 1.05
  const big = (a) => Math.max(Math.hypot(a[0] - a[3], a[2] - a[5]), Math.hypot(a[3] - a[6], a[5] - a[8]), Math.hypot(a[6] - a[0], a[8] - a[2])) > L
  let any = false
  for (let i = 0; i < n && !any; i++) if (big(p.subarray(i * 9, i * 9 + 9))) any = true
  if (!any) return [p, c]
  const P = [], C = []
  const emit = (v, k) => { if (!big(v) || P.length > 3e7) { for (const x of v) P.push(x); for (const x of k) C.push(x); return }
    const e = [Math.hypot(v[0] - v[3], v[2] - v[5]), Math.hypot(v[3] - v[6], v[5] - v[8]), Math.hypot(v[6] - v[0], v[8] - v[2])], j = e.indexOf(Math.max(...e))
    const a = j, b = (j + 1) % 3, o = (j + 2) % 3, V = (q) => [v[q * 3], v[q * 3 + 1], v[q * 3 + 2]], K = (q) => [k[q * 3], k[q * 3 + 1], k[q * 3 + 2]]
    const m = [0, 1, 2].map(t => Math.round((v[a * 3 + t] + v[b * 3 + t]) / 2)), mc = [0, 1, 2].map(t => (k[a * 3 + t] + k[b * 3 + t]) >> 1)
    emit([...V(a), ...m, ...V(o)], [...K(a), ...mc, ...K(o)]); emit([...m, ...V(b), ...V(o)], [...mc, ...K(b), ...K(o)]) }
  for (let i = 0; i < n; i++) emit(Array.from(p.subarray(i * 9, i * 9 + 9)), Array.from(c.subarray(i * 9, i * 9 + 9)))
  return [Int16Array.from(P), Uint8Array.from(C)]
}

export class RSWorld {
  constructor(world) {
    Object.assign(this, { world, CH: 32 })
    this.group = new THREE.Group()
    this.base = world.base + 1
    this.mats = {
      opaque: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      alpha: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.4, depthWrite: false }),
      water: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.62, depthWrite: false }),
      ground: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    }
    // the ground seen from under it (a bank over the water, from below the surface) is earth, not a sheet you see past
    this.mats.ground.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', 'if (!gl_FrontFacing) gl_FragColor.rgb = vec3(0.30, 0.22, 0.15) * diffuse;\n#include <fog_fragment>') }
    this.meshes = []; this.byChunk = new Map()            // 'cx,cz' -> [meshes]
    this.cover = new Uint8Array(world.W * world.H)          // 1 where an RS pack draws the tile
    this.drawn = new Uint8Array(world.W * world.H)          // 1 where a pack has ground triangles (some packs have empty map squares)
    this.vx = new Uint8Array(world.W * world.H)             // 1 = the tile is blocks now; 2 = only its tall locs are gone (a tree's canopy)
    this.dirty = new Set(); this.regions = []; this.state = new Map(); this.onCover = null; this.grounds = []
  }
  async loadCore(onp = () => {}) {
    const j = this.core = await (await fetch('assets/world.json')).json()
    this.regions = j.regions || []
    const plan = nearFarPlan(j.index, j.spawn)
    let bin = await fetch('assets/world.near.bin').then(r => r.ok ? r.arrayBuffer() : null).catch(() => null)
    onp(0.5)
    if (bin && bin.byteLength === plan.files[0].size) {
      this.addPack({ ...j, index: { chunk: j.index.chunk, chunks: plan.files[0].chunks } }, bin, false)
      this.far = fetch('assets/world.far.bin').then(r => r.arrayBuffer()).then(fb => {
        if (fb.byteLength !== plan.files[1].size) throw new Error('far size')
        this.addPack({ ...j, index: { chunk: j.index.chunk, chunks: plan.files[1].chunks } }, fb, true)
      }).catch(e => console.warn('far pack', e))
    } else {
      bin = await fetch('assets/world.bin').then(r => r.arrayBuffer())
      this.addPack(j, bin, true)
    }
    onp(1)
  }
  // a chunk's terrain split into the ground and its water (blue triangles on water tiles), the water drawn see-through
  // so the bed shows from the bank as in MC
  waterOut(p, c, gx, gz) {
    const n = p.length / 9, W = this.world, wet = new Uint8Array(n); let nw = 0
    for (let i = 0; i < n; i++) {
      const o = i * 9, tx = gx + Math.floor((p[o] + p[o + 3] + p[o + 6]) / 384), tz = gz + Math.floor((p[o + 2] + p[o + 5] + p[o + 8]) / 384)
      if (tx < 0 || tz < 0 || tx >= W.W || tz >= W.H || !(W.fl[tz * W.W + tx] & 8)) continue
      const r = c[o] + c[o + 3] + c[o + 6], g = c[o + 1] + c[o + 4] + c[o + 7], b = c[o + 2] + c[o + 5] + c[o + 8]
      if (b > r + 30 && b > g) { wet[i] = 1; nw++ }
    }
    if (!nw) return [['terrain', p, c]]
    const out = [[new Int16Array((n - nw) * 9), new Uint8Array((n - nw) * 9)], [new Int16Array(nw * 9), new Uint8Array(nw * 9)]], at = [0, 0]
    for (let i = 0; i < n; i++) { const w = wet[i], o = at[w]++ * 9; out[w][0].set(p.subarray(i * 9, i * 9 + 9), o); out[w][1].set(c.subarray(i * 9, i * 9 + 9), o) }
    return [['terrain', ...out[0]], ['water', ...out[1]]]
  }
  // the RS meshes of a pack; rect: also mark its tiles drawn (after its far half too, for the core)
  addPack(pack, bin, rect) {
    const CH = pack.index.chunk
    if (pack.ground && !this.grounds.some(g => g.name === pack.name)) this.grounds.push({ name: pack.name, x0: pack.x0, z0: pack.z0, w: pack.w, h: pack.h, g: Float32Array.from(pack.ground) })
    for (const ch of pack.index.chunks) {
      for (const k of PARTS) {
        const part = ch[k]; if (!part || !part.n) continue
        let pos = new Int16Array(bin, part.posOff, part.n * 3), col = new Uint8Array(bin, part.colOff, part.n * 3)
        if (k === 'terrain') this.hasGround(pos, ch.cx * CH, ch.cz * CH)
        if (k === 'locs') capWalls(pos, col)
        if (k !== 'terrain') [pos, col] = splitBig(pos, col)
        const parts = k === 'terrain' ? this.waterOut(pos, col, ch.cx * CH, ch.cz * CH) : [[k, pos, col]]
        for (const [kind, pos, col] of parts) {
          if (!pos.length) continue
          const g = new THREE.BufferGeometry()
          g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
          g.setAttribute('color', new THREE.BufferAttribute(col, 3, true))
          const m = new THREE.Mesh(g, kind === 'locs_alpha' ? this.mats.alpha : kind === 'water' ? this.mats.water : kind === 'terrain' ? this.mats.ground : this.mats.opaque)
          m.position.set(ch.cx * CH, this.base, -ch.cz * CH); m.scale.set(1 / 128, -1 / 128, -1 / 128)
          m.updateMatrix(); m.matrixAutoUpdate = false
          m.userData = { cx: ch.cx, cz: ch.cz, kind, c: [(ch.cx + 0.5) * CH, -(ch.cz + 0.5) * CH], tri: null }
          if (kind === 'locs_alpha') m.renderOrder = 1; if (kind === 'water') m.renderOrder = 2
          this.group.add(m); this.meshes.push(m)
          const key = ch.cx + ',' + ch.cz; let L = this.byChunk.get(key); if (!L) this.byChunk.set(key, L = []); L.push(m)
          this.dirty.add(m)
        }
      }
      if (!rect) this.markCover(ch.cx * CH, ch.cz * CH, CH, CH)
    }
    if (rect) this.markCover(pack.x0, pack.z0, pack.w, pack.h)
  }
  hasGround(p, gx, gz) {
    const W = this.world.W, H = this.world.H
    for (let o = 0; o < p.length; o += 9) { const tx = gx + Math.floor((p[o] + p[o + 3] + p[o + 6]) / 384), tz = gz + Math.floor((p[o + 2] + p[o + 5] + p[o + 8]) / 384); if (tx >= 0 && tz >= 0 && tx < W && tz < H) this.drawn[tz * W + tx] = 1 }
  }
  // only tiles the pack really draws: a tile with no RS ground stays plain blocks (no seeing through an empty square)
  markCover(x0, z0, w, h) {
    const W = this.world.W, H = this.world.H
    for (let z = Math.max(0, z0); z < Math.min(H, z0 + h); z++) for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) { const i = z * W + x; if (this.drawn[i]) this.cover[i] = 1 }
    if (this.onCover) this.onCover(x0, z0, w, h)
  }
  // fetch the region packs near a tile (x, z: tile coords), once each
  stream(tx, tz) {
    for (const r of this.regions) {
      if (this.state.has(r.name)) continue
      const dx = Math.max(0, r.x0 - tx, tx - (r.x0 + r.w)), dz = Math.max(0, r.z0 - tz, tz - (r.z0 + r.h))
      if (Math.hypot(dx, dz) > STREAM_AT) continue
      this.state.set(r.name, 'loading')
      Promise.all([fetch(`assets/world_${r.name}.json`).then(q => q.json()), fetch(`assets/world_${r.name}.bin`).then(q => q.arrayBuffer())])
        .then(([j, b]) => { this.addPack(j, b, true); this.state.set(r.name, 'ready') })
        .catch(e => { console.warn('region', r.name, e); this.state.set(r.name, 'failed') })
    }
  }
  // ------------------------------------------------------------------ blocks taking over tiles
  // tile (x, z) is blocks now (kind 1: its ground was dug), loses what stands on it (kind 3: a wall or rock knocked
  // out, the ground stays), or only what stands tall on it (kind 2: a felled tree's canopy). 1 > 3 > 2.
  setVx(tx, tz, kind = 1) {
    const W = this.world.W; if (tx < 0 || tz < 0 || tx >= W || tz >= this.world.H) return false
    const i = tz * W + tx; if (RANK[this.vx[i]] >= RANK[kind]) return false
    this.vx[i] = kind
    const L = this.byChunk.get((tx >> 5) + ',' + (tz >> 5)); if (L) for (const m of L) this.dirty.add(m)
    return true
  }
  // per triangle of a mesh: its tile (chunk-local, z*32+x) and how high its middle is over the tile's ground
  tris(m) {
    if (m.userData.tri) return m.userData.tri
    const p = m.geometry.attributes.position.array, n = p.length / 9, t = new Uint16Array(n), h = new Float32Array(n)
    const { cx, cz } = m.userData, W = this.world, CH = this.CH
    for (let i = 0; i < n; i++) {
      const o = i * 9, x = (p[o] + p[o + 3] + p[o + 6]) / 384, y = -(p[o + 1] + p[o + 4] + p[o + 7]) / 384, z = (p[o + 2] + p[o + 5] + p[o + 8]) / 384
      let lx = Math.min(CH - 1, Math.max(0, Math.floor(x))), lz = Math.min(CH - 1, Math.max(0, Math.floor(z)))
      // a wall or fence standing on a tile edge goes with the tile whose block it is (the bake keeps them on west/south
      // edges), so knocking the block out takes the wall or fence, not the floor beside it
      const ax = p[o + 3] - p[o], az = p[o + 5] - p[o + 2], bx = p[o + 6] - p[o], bz = p[o + 8] - p[o + 2], ay = p[o + 4] - p[o + 1], by = p[o + 7] - p[o + 1]
      const ny = Math.abs(az * bx - ax * bz), nl = Math.hypot(ay * bz - az * by, ny, ax * by - ay * bx) || 1
      if (ny / nl < 0.3 && W.ed) {
        const rx = Math.round(x), rz = Math.round(z), gx = cx * CH, gz = cz * CH
        const e = (tx, tz) => tx >= 0 && tz >= 0 && tx < W.W && tz < W.H ? W.ed[tz * W.W + tx] : 0
        if (Math.abs(x - rx) < 0.25 && (e(gx + rx, gz + lz) & 5) && rx >= 0 && rx < CH) lx = rx            // (1 a wall, 4 a fence on the west edge)
        else if (Math.abs(z - rz) < 0.25 && (e(gx + lx, gz + rz) & 10) && rz >= 0 && rz < CH) lz = rz     // (2, 8: the south edge)
      }
      t[i] = lz * CH + lx
      const ti = (cz * CH + lz) * W.W + cx * CH + lx
      h[i] = ti >= 0 && ti < W.gy.length ? this.base + y - (W.gy[ti] + 1) : 0
    }
    return (m.userData.tri = { t, h })
  }
  // rebuild the kept-triangle index of the meshes that changed (a few a frame)
  update(budget = 4) {
    let n = 0
    for (const m of this.dirty) {
      this.dirty.delete(m)
      const { cx, cz, kind } = m.userData, CH = this.CH, W = this.world.W
      let any = false
      for (let lz = 0; lz < CH && !any; lz++) { const o = (cz * CH + lz) * W + cx * CH; for (let lx = 0; lx < CH; lx++) if (this.vx[o + lx]) { any = true; break } }
      if (!any) { if (m.geometry.index) m.geometry.setIndex(null); continue }
      const { t, h } = this.tris(m), out = new Uint32Array(t.length * 3)
      let k = 0
      for (let i = 0; i < t.length; i++) {
        const v = this.vx[(cz * CH + (t[i] >> 5)) * W + cx * CH + (t[i] & 31)]
        if (v === 1 || (v === 3 && !GROUND[kind]) || (v === 2 && !GROUND[kind] && h[i] > 0.9)) continue
        out[k++] = i * 3; out[k++] = i * 3 + 1; out[k++] = i * 3 + 2
      }
      m.geometry.setIndex(new THREE.BufferAttribute(out.slice(0, k), 1))
      if (++n >= budget) break
    }
  }
  // hide what's past the fog
  cull(x, z, far) {
    const h = this.CH / 2
    for (const m of this.meshes) {
      const ex = Math.max(0, Math.abs(m.userData.c[0] - x) - h), ez = Math.max(0, Math.abs(m.userData.c[1] - z) - h)
      m.visible = Math.hypot(ex, ez) < far
    }
  }
  // the RS ground's height (three.js y) at a point (three.js x, z), bridges included; null off the loaded packs
  height(x, z) {
    const tx = x, tz = -z
    for (const P of this.grounds) {
      if (tx < P.x0 || tz < P.z0 || tx >= P.x0 + P.w || tz >= P.z0 + P.h) continue
      const lx = tx - P.x0, lz = tz - P.z0, i = Math.floor(lx), j = Math.floor(lz), u = lx - i, v = lz - j, o = (i * P.h + j) * 4, g = P.g
      return this.base + (g[o] * (1 - u) + g[o + 1] * u) * (1 - v) + (g[o + 3] * (1 - u) + g[o + 2] * u) * v
    }
    return null
  }
  // the average colour of what stands on a tile (its loc triangles over the ground), [r, g, b] 0-255, or null
  tileColour(tx, tz) {
    const key = tx + ',' + tz; this.tc ||= new Map()
    if (this.tc.has(key)) return this.tc.get(key)
    const L = this.byChunk.get((tx >> 5) + ',' + (tz >> 5)) || [], want = (tz & 31) * 32 + (tx & 31)
    let r = 0, g = 0, b = 0, n = 0
    for (const m of L) {
      if (GROUND[m.userData.kind]) continue
      const { t, h } = this.tris(m), c = m.geometry.attributes.color.array
      for (let i = 0; i < t.length; i++) if (t[i] === want && h[i] > 0.15) { const o = i * 9; r += c[o]; g += c[o + 1]; b += c[o + 2]; n++ }
    }
    const out = n ? [r / n, g / n, b / n] : null
    this.tc.set(key, out); return out
  }
  // the nearest RS triangle along a ray, as drawn: { t, X, Z (the block column of its tile), y, h (over the tile's
  // ground), n (its normal), ground (it's the terrain) } or null. Only the tiles the ray crosses (and their neighbours, for
  // models that overhang) are tested, through a per-mesh tile -> triangles list
  pick(o, d, reach) {
    const CH = this.CH, W = this.world.W, seen = new Set(), tiles = []
    for (let s = 0; s <= reach + 0.5; s += 0.25) {
      const X = Math.floor(o[0] + d[0] * s), Z = Math.floor(o[2] + d[2] * s)
      for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) { const k = (X + a) + ',' + (Z + c); if (!seen.has(k)) { seen.add(k); tiles.push([X + a, -(Z + c) - 1]) } }
    }
    let best = null
    for (const [tx, tz] of tiles) {
      if (tx < 0 || tz < 0) continue
      const L = this.byChunk.get((tx >> 5) + ',' + (tz >> 5)); if (!L) continue
      const v = this.vx[tz * W + tx], want = (tz & 31) * CH + (tx & 31)
      if (v === 1 || v === 3) continue
      for (const m of L) {
        const { kind, cx, cz } = m.userData; if (!m.visible || kind === 'water') continue
        const { t, h } = this.tris(m)
        if (!m.userData.bk) { const B = m.userData.bk = new Map(); for (let i = 0; i < t.length; i++) { let a = B.get(t[i]); if (!a) B.set(t[i], a = []); a.push(i) } }
        const ids = m.userData.bk.get(want); if (!ids) continue
        const p = m.geometry.attributes.position.array, ox = cx * CH, oz = -cz * CH
        for (const i of ids) {
          if (v === 2 && h[i] > 0.9) continue
          const q = i * 9, P = (j) => [ox + p[q + j * 3] / 128, this.base - p[q + j * 3 + 1] / 128, oz - p[q + j * 3 + 2] / 128]
          const A = P(0), B = P(1), C = P(2), r = rayTri(o, d, A, B, C)
          if (r && r.t <= reach && (!best || r.t < best.t)) best = { t: r.t, X: tx, Z: -tz - 1, y: o[1] + d[1] * r.t, h: kind === 'terrain' ? 0 : h[i], n: r.n, ground: kind === 'terrain' }
        }
      }
    }
    return best
  }
  setLight(k) { for (const m of Object.values(this.mats)) m.color.setScalar(k) }
}
