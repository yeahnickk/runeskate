// Minecraft's box models: mobs built from cuboids (MC's pixel sizes) with painted pixel faces, the first-person arm,
// held blocks and extruded item sprites. Animals wear OSRS colours (the black and white Lumbridge cows), villagers wear
// their RS jobs (guard's steel, monk's robe, dwarf's beard).
import * as THREE from 'three'
import { BLOCKS } from './blocks.js'
import { TI } from './blocks.js'
import { spritePixels, isFlat } from './tex.js'

const PX = 1 / 16
const R = (s) => { let a = s; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
// a face texture: w x h pixels of base colour with noise, then a painter for features
function face(w, h, base, paint, seed = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const x = c.getContext('2d'), r = R(seed * 7919 + w * 31 + h)
  const b = new THREE.Color(base)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = 0.9 + r() * 0.16; x.fillStyle = `rgb(${b.r * 255 * k | 0},${b.g * 255 * k | 0},${b.b * 255 * k | 0})`; x.fillRect(i, j, 1, 1) }
  if (paint) paint(x, w, h, r)
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  return t
}
const px = (x, col, i, j, w = 1, h = 1) => { x.fillStyle = col; x.fillRect(i, j, w, h) }
const MATS = []
// a cuboid of w,h,d pixels; faces: {all, front, back, top, bottom, side} -> texture or colour
function box(w, h, d, f, seed) {
  const g = new THREE.BoxGeometry(w * PX, h * PX, d * PX)
  const get = (k, fw, fh) => {
    const v = f[k] ?? (k === 'front' || k === 'back' ? f.side : null) ?? f.side ?? f.all
    if (typeof v === 'function') return v(fw, fh)
    return face(fw, fh, v, null, seed)
  }
  // three box order: +x, -x, +y, -y, +z (back: models face -z), -z (front)
  const mats = [get('side', d, h), get('side', d, h), get('top', w, d), get('bottom', w, d), get('back', w, h), get('front', w, h)].map(map => { const m = new THREE.MeshBasicMaterial({ map, color: 0xffffff }); MATS.push(m); return m })
  return new THREE.Mesh(g, mats)
}
// a part pivoting at its top (legs/arms) or anywhere: returns the pivot group
function part(mesh, px0, py0, pz0, ox = 0, oy = 0, oz = 0) {
  const g = new THREE.Group(); g.position.set(px0 * PX, py0 * PX, pz0 * PX)
  mesh.position.set(ox * PX, oy * PX, oz * PX); g.add(mesh); return g
}
const eyes = (col, pupil, y = 3, w = 2) => (x, W, H) => { px(x, col, 1, y, w, 1); px(x, col, W - 1 - w, y, w, 1); if (pupil) { px(x, pupil, 1 + w - 1, y, 1, 1); px(x, pupil, W - 1 - w, y, 1, 1) } }

export const MODELS = {
  cow() {
    const patch = (x, W, H, r) => { for (let k = 0; k < 4; k++) { const i = r() * W | 0, j = r() * H | 0; px(x, '#1e1e1e', i, j, 2 + (r() * 4 | 0), 2 + (r() * 3 | 0)) } }
    const hide = (w, h) => face(w, h, '#e8e8e4', patch, w * h)
    const g = new THREE.Group()
    const body = box(12, 10, 18, { all: hide }, 3); body.position.set(0, 17 * PX, 0); g.add(body)
    const head = part(box(8, 8, 6, { side: hide, front: (w, h) => face(w, h, '#e8e8e4', (x) => { eyes('#fff', '#000', 2)(x, w, h); px(x, '#c9a0a0', 2, 5, 4, 3); px(x, '#000', 3, 6, 1, 1); px(x, '#000', 4, 6, 1, 1) }) }, 5), 0, 20, -9, 0, 0, -3)
    const horn = box(1, 3, 1, { all: '#d8d0b0' }); horn.position.set(-4.5 * PX, 4.5 * PX, -3 * PX); head.add(horn); const h2 = horn.clone(); h2.position.x = 4.5 * PX; head.add(h2)
    g.add(head)
    const legs = []
    for (const [x, z] of [[-4, -7], [4, -7], [-4, 7], [4, 7]]) { const l = part(box(4, 12, 4, { all: hide, bottom: '#3a3a3a' }, x * z), x, 12, z, 0, -6, 0); legs.push(l); g.add(l) }
    return { g, head, legs, eye: 20 }
  },
  pig() {
    const pink = '#f0a5a2', g = new THREE.Group()
    const body = box(10, 8, 16, { all: pink }); body.position.set(0, 10 * PX, 0); g.add(body)
    const head = part(box(8, 8, 8, { all: pink, front: (w, h) => face(w, h, pink, (x) => { eyes('#fff', '#000', 2)(x, w, h); px(x, '#e07a80', 2, 5, 4, 3); px(x, '#a04a50', 3, 6, 1, 1); px(x, '#a04a50', 4, 6, 1, 1) }) }), 0, 12, -8, 0, 0, -4)
    g.add(head)
    const legs = []
    for (const [x, z] of [[-3, -5], [3, -5], [-3, 5], [3, 5]]) { const l = part(box(4, 6, 4, { all: pink }), x, 6, z, 0, -3, 0); legs.push(l); g.add(l) }
    return { g, head, legs, eye: 12 }
  },
  sheep() {
    const g = new THREE.Group(), wool = '#eeeeee'
    const body = box(10, 9, 17, { all: wool }); body.position.set(0, 16 * PX, 0); g.add(body)
    const head = part(box(6, 6, 8, { all: '#d7c3b0', front: (w, h) => face(w, h, '#d7c3b0', eyes('#fff', '#000', 2, 1)) }), 0, 18, -8, 0, 0, -4)
    const cap = box(7, 3, 7, { all: wool }); cap.position.set(0, 2.5 * PX, -3 * PX); head.add(cap)
    g.add(head)
    const legs = []
    for (const [x, z] of [[-3, -5], [3, -5], [-3, 6], [3, 6]]) { const l = part(box(4, 12, 4, { all: '#d7c3b0', top: wool }), x, 12, z, 0, -6, 0); legs.push(l); g.add(l) }
    return { g, head, legs, eye: 18 }
  },
  chicken() {
    const g = new THREE.Group()
    const body = box(6, 8, 6, { all: '#f6f6f6' }); body.rotation.x = Math.PI / 2; body.position.set(0, 6 * PX, 0); g.add(body)
    const head = part(box(4, 6, 3, { all: '#f6f6f6', front: (w, h) => face(w, h, '#f6f6f6', (x) => { px(x, '#000', 0, 1, 1, 1); px(x, '#000', 3, 1, 1, 1) }) }), 0, 9, -4, 0, 3, -1.5)
    const beak = box(4, 2, 2, { all: '#f9b233' }); beak.position.set(0, 3 * PX, -2.5 * PX); head.children[0].add(beak)
    const wattle = box(2, 2, 2, { all: '#d82020' }); wattle.position.set(0, -1 * PX, -2 * PX); head.children[0].add(wattle)
    g.add(head)
    const legs = []
    for (const x of [-1, 2]) { const l = part(box(1, 5, 1, { all: '#f9b233' }), x, 5, 1, 0, -2.5, 0); legs.push(l); g.add(l) }
    for (const x of [-3.5, 3.5]) { const w = box(1, 4, 6, { all: '#ececec' }); w.position.set(x * PX, 7 * PX, 0); g.add(w) }
    return { g, head, legs, eye: 9 }
  },
  steve() { return humanoid({ skin: '#c69a74', shirt: '#2ea4a4', pants: '#3a3aa0', face: (x) => { px(x, '#4a2e14', 0, 0, 8, 2); px(x, '#fff', 1, 4, 2, 1); px(x, '#fff', 5, 4, 2, 1); px(x, '#3a3ab0', 2, 4, 1, 1); px(x, '#3a3ab0', 5, 4, 1, 1); px(x, '#7a4a2a', 3, 6, 2, 1) } }) },
  zombie() { return humanoid({ skin: '#5f9a4a', shirt: '#2fa7a0', pants: '#4a3f8a', face: (x, w, h) => { px(x, '#1a1a1a', 1, 3, 2, 1); px(x, '#1a1a1a', 5, 3, 2, 1); px(x, '#3d6a30', 2, 5, 4, 1) }, armsOut: true }) },
  skeleton() { return humanoid({ skin: '#c8c8c8', shirt: '#b0b0b0', pants: '#a8a8a8', thin: true, face: (x) => { px(x, '#222', 1, 3, 2, 2); px(x, '#222', 5, 3, 2, 2); px(x, '#555', 3, 5, 2, 1); px(x, '#333', 2, 6, 4, 1) }, bow: true }) },
  creeper() {
    const g = new THREE.Group(), C = '#5ab84a'
    const spots = (w, h) => face(w, h, C, (x, W, H, r) => { for (let k = 0; k < W * H / 5; k++) px(x, r() < 0.5 ? '#3e8a32' : '#8ad27a', r() * W | 0, r() * H | 0) })
    const body = box(8, 12, 4, { all: spots }); body.position.set(0, 12 * PX, 0); g.add(body)
    const head = part(box(8, 8, 8, { all: spots, front: (w, h) => face(w, h, C, (x) => { px(x, '#111', 1, 2, 2, 2); px(x, '#111', 5, 2, 2, 2); px(x, '#111', 3, 4, 2, 3); px(x, '#111', 2, 5, 1, 3); px(x, '#111', 5, 5, 1, 3) }) }), 0, 18, 0, 0, 4, 0)
    g.add(head)
    const legs = []
    for (const [x, z] of [[-2, -4], [2, -4], [-2, 4], [2, 4]]) { const l = part(box(4, 6, 4, { all: spots }), x, 6, z, 0, -3, 0); legs.push(l); g.add(l) }
    return { g, head, legs, eye: 22 }
  },
  spider() {
    const g = new THREE.Group(), D = '#2e2620'
    const abd = box(10, 8, 12, { all: (w, h) => face(w, h, D, (x, W, H, r) => { for (let k = 0; k < 10; k++) px(x, '#4a3a30', r() * W | 0, r() * H | 0, 2, 1) }) }); abd.position.set(0, 9 * PX, 9 * PX); g.add(abd)
    const th = box(6, 6, 6, { all: D }); th.position.set(0, 9 * PX, 0); g.add(th)
    const head = part(box(8, 8, 8, { all: D, front: (w, h) => face(w, h, D, (x) => { px(x, '#d01010', 1, 2, 2, 1); px(x, '#d01010', 5, 2, 2, 1); px(x, '#ff3030', 2, 4, 1, 1); px(x, '#ff3030', 5, 4, 1, 1); px(x, '#d01010', 3, 3, 2, 1) }) }), 0, 9, -3, 0, 0, -4)
    g.add(head)
    const legs = []
    for (let i = 0; i < 8; i++) {
      const s = i < 4 ? -1 : 1, k = i % 4
      const l = part(box(16, 2, 2, { all: D }), s * 3, 9, -3 + k * 2, s * 8, 0, 0)
      l.rotation.z = -s * 0.55; l.rotation.y = (k - 1.5) * 0.4 * s
      legs.push(l); g.add(l)
    }
    return { g, head, legs, eye: 9, spider: true }
  },
  villager(kind) {
    const robe = { man: '#7a5230', woman: '#8a3a8a', farmer: '#6a8a3a', guard: '#8a8a92', dwarf: '#a04a20', shopkeeper: '#e8e8e0', monk: '#6a4a2a', barbarian: '#8a6a40' }[kind] || '#7a5230'
    const skin = kind === 'barbarian' ? '#c08a5a' : '#c69a74'
    const g = new THREE.Group(), s = kind === 'dwarf' ? 0.75 : 1
    const body = box(8, 12, 6, { all: robe, front: (w, h) => face(w, h, robe, (x) => { if (kind === 'shopkeeper') px(x, '#ffffff', 1, 2, 6, 10); if (kind === 'guard') { px(x, '#d0d0d8', 0, 0, 8, 2); px(x, '#c0a020', 3, 5, 2, 2) } }) })
    body.position.set(0, 18 * PX, 0); g.add(body)
    const lower = box(8, 6, 6, { all: robe }); lower.position.set(0, 9 * PX, 0); g.add(lower)
    const head = part(box(8, 10, 8, { all: skin, top: kind === 'monk' ? '#4a3a2a' : '#5a3a20', front: (w, h) => face(w, h, skin, (x) => {
      px(x, '#fff', 1, 4, 2, 1); px(x, '#fff', 5, 4, 2, 1); px(x, '#3a6a2a', 2, 4, 1, 1); px(x, '#3a6a2a', 5, 4, 1, 1); px(x, '#3a2a1a', 1, 3, 6, 1)
      if (kind === 'dwarf' || kind === 'barbarian') { px(x, kind === 'dwarf' ? '#c87a2a' : '#e0c050', 0, 7, 8, 3) }
    }) }), 0, 24, 0, 0, 5, 0)
    const nose = box(2, 4, 2, { all: skin }); nose.position.set(0, 2 * PX, -5 * PX); head.children[0].add(nose)
    if (kind === 'farmer') { const hat = box(14, 1, 14, { all: '#d8b860' }); hat.position.set(0, 10.5 * PX, 0); head.children[0].add(hat); const top = box(8, 3, 8, { all: '#d8b860' }); top.position.set(0, 12 * PX, 0); head.children[0].add(top) }
    if (kind === 'guard') { const helm = box(9, 5, 9, { all: '#9a9aa2' }); helm.position.set(0, 3.5 * PX, 0); head.children[0].add(helm) }
    if (kind === 'monk') { const hood = box(9, 6, 9, { all: '#5a3a1e', front: '#3a2814' }); hood.position.set(0, 3 * PX, 0.5 * PX); head.children[0].add(hood) }
    if (kind === 'barbarian') { const helm = box(9, 3, 9, { all: '#7a7a7a' }); helm.position.set(0, 4.5 * PX, 0); head.children[0].add(helm); for (const sx of [-1, 1]) { const horn = box(1, 4, 1, { all: '#e8e0c8' }); horn.position.set(sx * 5 * PX, 6 * PX, 0); head.children[0].add(horn) } }
    g.add(head)
    const arms = box(8, 4, 4, { all: robe }); arms.position.set(0, 20 * PX, -3.5 * PX); g.add(arms)
    const hands = box(8, 4, 4, { all: skin }); hands.position.set(0, 20 * PX, -4 * PX); hands.scale.set(0.5, 1, 1); g.add(hands)
    const legs = []
    for (const x of [-2, 2]) { const l = part(box(4, 6, 4, { all: kind === 'monk' ? robe : '#3a3a4a' }), x, 6, 0, 0, -3, 0); legs.push(l); g.add(l) }
    g.scale.setScalar(s)
    return { g, head, legs, eye: 28 * s }
  },
}
function humanoid(o) {
  const g = new THREE.Group(), t = o.thin ? 2 : 4
  const body = box(8, 12, 4, { all: o.shirt, front: o.thin ? (w, h) => face(w, h, o.shirt, (x) => { for (let j = 1; j < 10; j += 2) px(x, '#555', 1, j, 6, 1) }) : null }); body.position.set(0, 18 * PX, 0); g.add(body)
  const head = part(box(8, 8, 8, { all: o.skin, front: (w, h) => face(w, h, o.skin, o.face) }), 0, 24, 0, 0, 4, 0)
  g.add(head)
  const arms = []
  for (const s of [-1, 1]) {
    const a = part(box(t, 12, t, { all: o.skin, top: o.shirt }), s * (4 + t / 2), 22, 0, 0, -4, 0)
    if (o.armsOut) a.rotation.x = -Math.PI / 2
    arms.push(a); g.add(a)
  }
  if (o.bow) { const b = box(1, 10, 1, { all: '#6a4c22' }); b.position.set(0, -10 * PX, -1 * PX); arms[1].add(b); arms[1].rotation.x = -Math.PI / 2; arms[0].rotation.x = -Math.PI / 2.2 }
  const legs = []
  for (const s of [-1, 1]) { const l = part(box(t, 12, t, { all: o.pants }), s * 2, 12, 0, 0, -6, 0); legs.push(l); g.add(l) }
  return { g, head, legs, arms, eye: 26, armsOut: o.armsOut || o.bow }
}
// the first-person right arm (Steve's: skin, a cyan sleeve)
export function armModel() {
  const a = box(4, 12, 4, { all: (w, h) => face(w, h, '#c69a74', (x, W, H) => { px(x, '#2ea4a4', 0, 0, W, 4) }), top: '#2ea4a4', bottom: '#b88a64' })
  return a
}

// a block as a little cube with the atlas (dropped/held blocks)
export function blockMesh(id, atlasTex) {
  const b = BLOCKS[id], g = new THREE.BoxGeometry(1, 1, 1)
  const uv = g.attributes.uv
  // box face order: +x -x +y -y +z -z; 4 verts each
  const tiles = [b.t.side, b.t.side, b.t.top, b.t.bot, b.t.front || b.t.side, b.t.side]
  for (let f = 0; f < 6; f++) {
    const t = TI[tiles[f]], u0 = (t & 15) / 16, v1 = 1 - (t >> 4) / 16, u1 = u0 + 1 / 16, v0 = v1 - 1 / 16
    for (let j = 0; j < 4; j++) { const i = f * 4 + j; uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0) }
  }
  const shades = [0.6, 0.6, 1, 0.5, 0.8, 0.8], col = []
  for (let f = 0; f < 6; f++) for (let j = 0; j < 4; j++) col.push(shades[f], shades[f], shades[f])
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  if (Array.isArray(b.shape)) { const s = b.shape; g.scale((s[3] - s[0]) / 16, (s[4] - s[1]) / 16, (s[5] - s[2]) / 16); g.translate(0, ((s[4] + s[1]) / 32) - 0.5, 0) }
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, alphaTest: 0.5, transparent: false }))
  return m
}
// an item sprite extruded 1 px thick, as MC renders items in hand and on the ground
const EXT = new Map()
export function itemMesh(id) {
  let geo = EXT.get(id)
  const d = spritePixels(id)
  if (!geo) {
    const pos = [], col = [], a = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && d[(y * 16 + x) * 4 + 3] > 20
    const quad = (p, c) => { for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(...p[i]); col.push(...c) } }
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (!a(x, y)) continue
      const o = (y * 16 + x) * 4, c = [d[o] / 255, d[o + 1] / 255, d[o + 2] / 255]
      const X0 = x / 16 - 0.5, X1 = X0 + 1 / 16, Y1 = 0.5 - y / 16, Y0 = Y1 - 1 / 16, Z0 = -0.5 / 16, Z1 = 0.5 / 16
      quad([[X0, Y0, Z1], [X1, Y0, Z1], [X1, Y1, Z1], [X0, Y1, Z1]], c)
      quad([[X1, Y0, Z0], [X0, Y0, Z0], [X0, Y1, Z0], [X1, Y1, Z0]], c)
      const k = c.map(v => v * 0.7)
      if (!a(x - 1, y)) quad([[X0, Y0, Z0], [X0, Y0, Z1], [X0, Y1, Z1], [X0, Y1, Z0]], k)
      if (!a(x + 1, y)) quad([[X1, Y0, Z1], [X1, Y0, Z0], [X1, Y1, Z0], [X1, Y1, Z1]], k)
      if (!a(x, y - 1)) quad([[X0, Y1, Z1], [X1, Y1, Z1], [X1, Y1, Z0], [X0, Y1, Z0]], c.map(v => v * 0.9))
      if (!a(x, y + 1)) quad([[X0, Y0, Z0], [X1, Y0, Z0], [X1, Y0, Z1], [X0, Y0, Z1]], c.map(v => v * 0.5))
    }
    geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    EXT.set(id, geo)
  }
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }))
}
export const isBlockModel = (id) => id < 256 && !isFlat(id)
