// The real RS world under MineScape: the skate game's map packs (assets/world*.json/.bin, terrain + locs as the 2004
// client lit them) drawn 1:1, a tile a block, the ground at the voxel tops (y = base + 1 - RS height). Blocks are what
// you touch; these are what you see. A tile the player has changed (dug, built into, a wall knocked out) turns to
// blocks: its triangles are hidden (an index over the chunk's kept triangles, rebuilt on change) and the mesher draws
// the blocks there instead. A felled tree takes its canopy's loc triangles with it. Regions stream in as you near them.
import * as THREE from 'three'
import { nearFarPlan } from '../nearfirst.js'

const PARTS = ['terrain', 'locs', 'locs_alpha'], STREAM_AT = 40

export class RSWorld {
  constructor(world) {
    Object.assign(this, { world, CH: 32 })
    this.group = new THREE.Group()
    this.base = world.base + 1
    this.mats = {
      opaque: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      alpha: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.4, depthWrite: false }),
    }
    this.meshes = []; this.byChunk = new Map()            // 'cx,cz' -> [meshes]
    this.cover = new Uint8Array(world.W * world.H)          // 1 where an RS pack draws the tile
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
  // the RS meshes of a pack; rect: also mark its tiles drawn (after its far half too, for the core)
  addPack(pack, bin, rect) {
    const CH = pack.index.chunk
    if (pack.ground && !this.grounds.some(g => g.name === pack.name)) this.grounds.push({ name: pack.name, x0: pack.x0, z0: pack.z0, w: pack.w, h: pack.h, g: Float32Array.from(pack.ground) })
    for (const ch of pack.index.chunks) {
      for (const k of PARTS) {
        const part = ch[k]; if (!part || !part.n) continue
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.BufferAttribute(new Int16Array(bin, part.posOff, part.n * 3), 3))
        g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(bin, part.colOff, part.n * 3), 3, true))
        const alpha = k === 'locs_alpha', m = new THREE.Mesh(g, alpha ? this.mats.alpha : this.mats.opaque)
        m.position.set(ch.cx * CH, this.base, -ch.cz * CH); m.scale.set(1 / 128, -1 / 128, -1 / 128)
        m.updateMatrix(); m.matrixAutoUpdate = false
        m.userData = { cx: ch.cx, cz: ch.cz, kind: k, c: [(ch.cx + 0.5) * CH, -(ch.cz + 0.5) * CH], tri: null }
        if (alpha) m.renderOrder = 1
        this.group.add(m); this.meshes.push(m)
        const key = ch.cx + ',' + ch.cz; let L = this.byChunk.get(key); if (!L) this.byChunk.set(key, L = []); L.push(m)
        this.dirty.add(m)
      }
      if (!rect) this.markCover(ch.cx * CH, ch.cz * CH, CH, CH)
    }
    if (rect) this.markCover(pack.x0, pack.z0, pack.w, pack.h)
  }
  markCover(x0, z0, w, h) {
    const W = this.world.W, H = this.world.H
    for (let z = Math.max(0, z0); z < Math.min(H, z0 + h); z++) this.cover.fill(1, z * W + Math.max(0, x0), z * W + Math.min(W, x0 + w))
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
  // tile (x, z) is blocks now (kind 1), or loses only what stands tall on it (kind 2: a canopy)
  setVx(tx, tz, kind = 1) {
    const W = this.world.W; if (tx < 0 || tz < 0 || tx >= W || tz >= this.world.H) return false
    const i = tz * W + tx; if (this.vx[i] === 1 || this.vx[i] === kind) return false
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
      const lx = Math.min(CH - 1, Math.max(0, Math.floor(x))), lz = Math.min(CH - 1, Math.max(0, Math.floor(z)))
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
        if (v === 1 || (v === 2 && kind !== 'terrain' && h[i] > 0.9)) continue
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
      if (m.userData.kind === 'terrain') continue
      const { t, h } = this.tris(m), c = m.geometry.attributes.color.array
      for (let i = 0; i < t.length; i++) if (t[i] === want && h[i] > 0.15) { const o = i * 9; r += c[o]; g += c[o + 1]; b += c[o + 2]; n++ }
    }
    const out = n ? [r / n, g / n, b / n] : null
    this.tc.set(key, out); return out
  }
  setLight(k) { this.mats.opaque.color.setScalar(k); this.mats.alpha.color.setScalar(k) }
}
