// MineScape's 3D view: chunk meshes lit like Minecraft (sky light dimmed by the time of day, warm torch light, AO,
// distance fog to the sky colour), the sky (gradient, square sun + moon, stars, scrolling clouds), the block outline +
// cracks, entities (mobs, dropped items, XP orbs, arrows, falling sand, TNT), particles and the first-person arm.
import * as THREE from 'three'
import { BLOCKS, TI } from './blocks.js'
import { CS, WH } from './world.js'
import { selBox } from './phys.js'
import { celestial } from './game.js'
import { MODELS, armModel, blockMesh, itemMesh, isBlockModel } from './models.js'
import { text, width } from './font.js'
import { outfitOf, playerModel, playerClip, rsName, npcModel } from './bodies.js'

const VS = `
attribute vec4 lt; attribute vec4 tc;
varying vec2 vUv; varying vec4 vL; varying vec4 vT; varying float vD;
uniform vec3 uCam;
void main() {
  vUv = uv; vL = lt; vT = tc;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vD = length(wp.xyz - uCam);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`
const FS = `
uniform sampler2D map; uniform float uSky, uFogN, uFogF, uBright, uWater; uniform vec3 uFog;
varying vec2 vUv; varying vec4 vL; varying vec4 vT; varying float vD;
float lum(float l) { float b = l / (4.0 - 3.0 * l); return mix(b, 1.0 - pow(1.0 - l, 3.0), uBright); }
void main() {
  vec4 t = texture2D(map, vUv);
  float fl = floor(vL.w * 255.0 + 0.5);
  if (uWater < 0.5 && t.a < 0.5) discard;
  // MC's biome colour, here the RS ground's: over the texel's green only (a grass block's dirt stays dirt)
  if (vT.a > 0.5) t.rgb *= mix(vec3(1.0), vT.rgb * (255.0 / 128.0), clamp((t.g - max(t.r, t.b)) * 6.0, 0.0, 1.0));
  float sky = lum(vL.x * uSky), blk = lum(vL.y);
  vec3 light = max(vec3(sky) * mix(vec3(0.62, 0.66, 0.9), vec3(1.0), uSky), vec3(blk) * vec3(1.0, 0.92, 0.78));
  light = max(light, vec3(0.035));
  if (fl > 2.5) light = vec3(1.0);
  vec3 c = t.rgb * light * vL.z;
  float f = clamp((vD - uFogN) / (uFogF - uFogN), 0.0, 1.0);
  gl_FragColor = vec4(mix(c, uFog, f), uWater > 0.5 ? t.a : 1.0);
}`

// turn an angle toward another the short way round
const turnTo = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * Math.min(1, k) }

export class View {
  constructor(renderer, atlas, world, game, opts = {}) {
    Object.assign(this, { R: renderer, world, game, rd: opts.rd || 8, fancy: opts.fancy !== false })
    this.scene = new THREE.Scene()
    this.cam = new THREE.PerspectiveCamera(70, 1, 0.05, 1000); this.cam.rotation.order = 'YXZ'
    const tex = this.atlas = new THREE.CanvasTexture(atlas)
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false
    this.U = { map: { value: tex }, uSky: { value: 1 }, uFog: { value: new THREE.Color() }, uFogN: { value: 60 }, uFogF: { value: 120 }, uCam: { value: new THREE.Vector3() }, uBright: { value: 0.35 }, uWater: { value: 0 } }
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: this.U })
    this.wmat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: { ...this.U, uWater: { value: 1 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide })
    this.chunks = new Map(); this.idx = null; this.queue = []; this.dirty = new Set(); this.soon = new Set()
    this.ents = new Map(); this.parts = []
    this.buildSky(); this.buildOutline(); this.buildHand(); this.buildParticles()
    this.listener = (x, y, z, id, was, nat) => this.onEdit(x, y, z, id, was, nat)
    world.listeners.push(this.listener)
    // the RS world drawn over the blocks (rsworld.js): which tiles are blocks now comes from the edits
    const rsw = this.rsw = opts.rsw || null
    if (rsw) {
      this.scene.add(rsw.group)
      this.rs = { vx: rsw.vx, cover: rsw.cover, h: (x, z) => rsw.height(x, z) }
      rsw.vx.fill(0); for (const m of rsw.meshes) rsw.dirty.add(m)
      // MC's grass/dirt ticks leave the map's own ground alone (else every tile under a tree or wall turns to blocks)
      world.keep = (x, y, z) => { const t = world.tile(x, z); return t >= 0 && rsw.cover[t] && rsw.vx[t] !== 1 && world.natural(x, y, z) }
      this.forgetFlips()
      this.vxFromEdits()
      rsw.onCover = (x0, z0, w, h) => { for (const [k, c] of this.chunks) { const X = c.cx * CS, T = -c.cz * CS - CS; if (X + CS > x0 && X < x0 + w && T + CS > z0 && T < z0 + h) this.soon.add(k) } }
    }
  }
  dispose() { const L = this.world.listeners, i = L.indexOf(this.listener); if (i >= 0) L.splice(i, 1); if (this.rsw) this.rsw.onCover = null }
  // a tile turns to blocks when you change its ground; knocking out what the map stood on it takes the RS model but
  // keeps the ground; under the ground (tunnels) and building on top leave the RS tile as it is
  vxEdit(x, y, z, was, nat) {
    const W = this.world, t = W.tile(x, z); if (t < 0) return
    const tx = x, tz = -z - 1, g = W.gy[t]
    if (y < g) return
    if (y === g) return this.rsw.setVx(tx, tz, 1)
    if (nat && was) {
      this.rsw.setVx(tx, tz, 3)
      if (was === 79) for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) if (a || c) this.rsw.setVx(tx + a, tz + c, 2)   // (the canopy)
    }
  }
  // older saves: drop the edits that were only those grass <-> dirt ticks on the map's own ground
  forgetFlips() {
    const W = this.world
    for (const [k, e] of W.edits) {
      const [cx, cz] = k.split(',').map(Number); let o = null, n = 0
      for (const [i, v] of e) { if (v !== 1 && v !== 2) continue; if (!o) o = W.orig(cx, cz); const was = o.b[i]; if (was === 1 || was === 2) { e.delete(i); n++ } }
      if (n) W.chunks.delete(k)
      if (!e.size) W.edits.delete(k)
    }
  }
  vxFromEdits() {
    const W = this.world
    for (const [k, e] of W.edits) {
      const [cx, cz] = k.split(',').map(Number); let o = null
      for (const i of e.keys()) {
        const y = i % WH, col = (i - y) / WH, x = cx * CS + (col & 15), z = cz * CS + (col >> 4), t = W.tile(x, z)
        if (t < 0) continue
        if (y <= W.gy[t]) { this.vxEdit(x, y, z, 0, false); continue }
        if (!o) o = W.orig(cx, cz)
        const was = o.b[i]; if (was) this.vxEdit(x, y, z, was, true)
      }
    }
  }
  quadIndex(n) {
    if (this.idx && this.idx.count >= n * 6) return this.idx
    const m = Math.max(n, 16384) * 2, a = new Uint32Array(m * 6)
    for (let q = 0; q < m; q++) { const o = q * 6, v = q * 4; a[o] = v; a[o + 1] = v + 1; a[o + 2] = v + 2; a[o + 3] = v; a[o + 4] = v + 2; a[o + 5] = v + 3 }
    return this.idx = new THREE.BufferAttribute(a, 1)
  }
  geo(m) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2))
    g.setAttribute('lt', new THREE.BufferAttribute(m.lt, 4, true))
    g.setAttribute('tc', new THREE.BufferAttribute(m.tc, 4, true))
    g.setIndex(this.quadIndex(m.n)); g.setDrawRange(0, m.n * 6)
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(8, 64, 8), 75)
    return g
  }
  // put a chunk's freshly meshed arrays on screen
  setChunk(cx, cz, m) {
    const k = cx + ',' + cz
    let c = this.chunks.get(k)
    if (!c) { c = { cx, cz, s: null, w: null }; this.chunks.set(k, c) }
    for (const [key, data, mat] of [['s', m.s, this.mat], ['w', m.w, this.wmat]]) {
      if (c[key]) { this.scene.remove(c[key]); c[key].geometry.dispose(); c[key] = null }
      if (data.n) { const mesh = new THREE.Mesh(this.geo(data), mat); mesh.position.set(cx * CS, 0, cz * CS); mesh.matrixAutoUpdate = false; mesh.updateMatrix(); if (key === 'w') mesh.renderOrder = 1; this.scene.add(mesh); c[key] = mesh }
    }
    c.ver = m.ver
  }
  dropChunk(k) { const c = this.chunks.get(k); if (!c) return; for (const key of ['s', 'w']) if (c[key]) { this.scene.remove(c[key]); c[key].geometry.dispose() } this.chunks.delete(k) }
  onEdit(x, y, z, id, was, nat) {
    const cx = x >> 4, cz = z >> 4
    this.dirty.add(cx + ',' + cz)
    if (this.rsw) this.vxEdit(x, y, z, was, nat)
    const lx = x & 15, lz = z & 15
    // neighbours sharing the face, now; the rest (light reaches 15) a little later
    if (lx === 0) this.dirty.add((cx - 1) + ',' + cz); if (lx === 15) this.dirty.add((cx + 1) + ',' + cz)
    if (lz === 0) this.dirty.add(cx + ',' + (cz - 1)); if (lz === 15) this.dirty.add(cx + ',' + (cz + 1))
    const B = BLOCKS[id], A = BLOCKS[was]
    if ((B && (B.opac || B.light)) || (A && (A.opac || A.light))) for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) this.soon.add((cx + a) + ',' + (cz + c))
  }

  // ------------------------------------------------------------------------ sky
  buildSky() {
    const g = new THREE.SphereGeometry(500, 24, 16)
    this.skyU = { top: { value: new THREE.Color() }, bot: { value: new THREE.Color() }, glow: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3() }, glowA: { value: 0 } }
    this.sky = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top, bot, glow, sunDir; uniform float glowA; varying vec3 vP;
        void main(){ float h = clamp(vP.y * 2.2 + 0.08, 0.0, 1.0); vec3 c = mix(bot, top, h);
          float s = max(0.0, dot(normalize(vec3(vP.x, 0.0, vP.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z)))); c = mix(c, glow, glowA * pow(s, 3.0) * (1.0 - clamp(abs(vP.y) * 3.0, 0.0, 1.0)));
          gl_FragColor = vec4(c, 1.0); }`,
    }))
    this.sky.renderOrder = -10; this.sky.frustumCulled = false
    this.scene.add(this.sky)
    const sq = (draw) => { const c = document.createElement('canvas'); c.width = c.height = 32; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; return t }
    const sunT = sq((x) => { x.fillStyle = 'rgba(255,255,200,0.25)'; x.fillRect(0, 0, 32, 32); x.fillStyle = '#fff8b0'; x.fillRect(8, 8, 16, 16); x.fillStyle = '#ffffe8'; x.fillRect(10, 10, 12, 12) })
    const moonT = sq((x) => { x.fillStyle = '#d8dce8'; x.fillRect(8, 8, 16, 16); x.fillStyle = '#a8acb8'; x.fillRect(11, 11, 3, 3); x.fillRect(17, 15, 4, 3); x.fillRect(12, 18, 2, 2) })
    const mk = (t, s) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); m.renderOrder = -9; m.frustumCulled = false; this.scene.add(m); return m }
    this.sun = mk(sunT, 90); this.moon = mk(moonT, 70)
    const sp = [], r = Math.random
    for (let i = 0; i < 1500; i++) { const v = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize().multiplyScalar(450); sp.push(v.x, v.y, v.z) }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3))
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false }))
    this.stars.renderOrder = -9; this.stars.frustumCulled = false; this.scene.add(this.stars)
    // clouds: MC's cloud map, a flat layer of 12-block cells scrolling east
    const cc = document.createElement('canvas'); cc.width = cc.height = 64
    const cx = cc.getContext('2d'), rr = (() => { let a = 99; return () => { a = (a * 16807) % 2147483647; return a / 2147483647 } })()
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const n = Math.sin(x * 0.4) * Math.cos(y * 0.35) + Math.sin((x + y) * 0.17) + rr() * 0.9; if (n > 0.9) { cx.fillStyle = '#fff'; cx.fillRect(x, y, 1, 1) } }
    const ct = new THREE.CanvasTexture(cc); ct.magFilter = ct.minFilter = THREE.NearestFilter; ct.wrapS = ct.wrapT = THREE.RepeatWrapping; ct.repeat.set(2, 2)
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(1536, 1536), new THREE.MeshBasicMaterial({ map: ct, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, fog: false }))
    this.clouds.rotation.x = -Math.PI / 2; this.clouds.frustumCulled = false; this.clouds.renderOrder = 2
    this.scene.add(this.clouds)
  }
  // MC's sky + fog colours by the time of day
  skyColours(time) {
    const a = celestial(time), d = Math.max(0, Math.min(1, Math.cos(a * Math.PI * 2) * 2 + 0.5))
    const top = new THREE.Color(0x78a7ff).multiplyScalar(d), bot = new THREE.Color(0xc0d8ff).multiplyScalar(d * 0.94 + 0.06)
    top.r += 0.0; top.b += 0.04 * (1 - d); bot.b += 0.06 * (1 - d)
    // sunrise/sunset glow (MC: when the sun is near the horizon)
    const c = Math.cos(a * Math.PI * 2), glowA = Math.abs(c) < 0.4 ? (1 - Math.abs(c) / 0.4) * 0.85 : 0
    return { top, bot, d, glowA, a }
  }

  buildOutline() {
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1))
    this.outline = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }))
    this.outline.visible = false; this.scene.add(this.outline)
    const cg = new THREE.BoxGeometry(1.004, 1.004, 1.004)
    this.crack = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ map: this.atlas, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, opacity: 0.85 }))
    this.crack.visible = false; this.crackStage = -1; this.scene.add(this.crack)
  }
  setCrack(stage) {
    if (stage === this.crackStage) return
    this.crackStage = stage
    const t = TI['destroy' + stage], uv = this.crack.geometry.attributes.uv, u0 = (t & 15) / 16, v0 = 1 - ((t >> 4) + 1) / 16
    const o = this.crackUV0 = this.crackUV0 || uv.array.slice()
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + o[i * 2] / 16, v0 + o[i * 2 + 1] / 16)
    uv.needsUpdate = true
  }

  // ------------------------------------------------------------------------ first-person hand
  buildHand() {
    this.hscene = new THREE.Scene(); this.hcam = new THREE.PerspectiveCamera(70, 1, 0.01, 10)
    this.hand = new THREE.Group(); this.hscene.add(this.hand)
    this.arm = armModel(); this.arm.scale.setScalar(1.2)
    this.armPivot = new THREE.Group(); this.armPivot.add(this.arm); this.arm.position.set(0, -0.35, 0)
    this.hand.add(this.armPivot)
    this.held = null; this.heldId = -1; this.equip = 1; this.handLight = 1
    this.armPose = [0.6, -0.7, -0.6, 1.5, 0.6, 0.3]
  }
  setHeld(id) {
    if (id === this.heldId) return
    this.heldId = id
    if (this.held) { this.hand.remove(this.held); this.held = null }
    if (!id) return
    const m = isBlockModel(id) ? blockMesh(id, this.atlas) : itemMesh(id)
    const g = new THREE.Group(); g.add(m); this.held = g
    if (isBlockModel(id)) { m.scale.setScalar(0.4); m.rotation.set(0, Math.PI / 4, 0); g.position.set(0.56, -0.52, -0.82) }
    else { m.scale.setScalar(0.68); m.rotation.set(0, -Math.PI / 2 + 0.3, 0.45); g.position.set(0.6, -0.42, -0.78) }
    this.hand.add(g)
  }

  // ------------------------------------------------------------------------ particles (block bits, smoke, crits)
  buildParticles() {
    const N = this.PN = 600
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3))
    g.setAttribute('aUv', new THREE.BufferAttribute(new Float32Array(N * 2), 2))
    g.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(N * 4), 4))
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(N), 1))
    this.pts = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { map: { value: this.atlas }, uScale: { value: 400 } }, transparent: true, depthWrite: false,
      vertexShader: 'attribute vec2 aUv; attribute vec4 aCol; attribute float aSize; varying vec2 vUv; varying vec4 vCol; uniform float uScale; void main(){ vUv = aUv; vCol = aCol; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec2 vUv; varying vec4 vCol; void main(){ vec4 c = vUv.x < 0.0 ? vec4(1.0) : texture2D(map, vUv + vec2(gl_PointCoord.x, -gl_PointCoord.y) / 64.0); if (c.a < 0.5 || vCol.a <= 0.0) discard; gl_FragColor = vec4(c.rgb * vCol.rgb, vCol.a); }',
    }))
    this.pts.frustumCulled = false; this.scene.add(this.pts)
  }
  burst(x, y, z, id, n = 24, spread = 0.5) {
    const d = BLOCKS[id]; if (!d || !d.t) return
    const tile = TI[d.t.side]
    for (let i = 0; i < n; i++) {
      const r = Math.random
      this.parts.push({ x: x + 0.5 + (r() - 0.5) * spread * 2, y: y + 0.5 + (r() - 0.5) * spread * 2, z: z + 0.5 + (r() - 0.5) * spread * 2, vx: (r() - 0.5) * 3, vy: r() * 4, vz: (r() - 0.5) * 3,
        u: ((tile & 15) + (r() * 12 | 0) / 16) / 16, v: 1 - ((tile >> 4) + 1) / 16 + (4 + (r() * 12 | 0)) / 256, c: [1, 1, 1], s: 0.1 + r() * 0.06, life: 0.6 + r() * 0.6, g: 14 })
    }
  }
  puff(x, y, z, n, col = [0.8, 0.8, 0.8], s = 0.25, up = 1) {
    for (let i = 0; i < n; i++) { const r = Math.random; this.parts.push({ x: x + (r() - 0.5), y: y + (r() - 0.5), z: z + (r() - 0.5), vx: (r() - 0.5) * 2, vy: r() * up, vz: (r() - 0.5) * 2, u: -1, v: 0, c: col.map(v => v * (0.8 + r() * 0.2)), s: s * (0.6 + r()), life: 0.6 + r() * 0.8, g: -0.5 }) }
  }
  tickParticles(dt) {
    const g = this.pts.geometry, P = g.attributes.position.array, U = g.attributes.aUv.array, C = g.attributes.aCol.array, S = g.attributes.aSize.array
    const W = this.world
    let n = 0
    this.parts = this.parts.filter(p => (p.life -= dt) > 0)
    if (this.parts.length > this.PN) this.parts.splice(0, this.parts.length - this.PN)
    for (const p of this.parts) {
      p.vy -= p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt
      if (p.g > 0 && BLOCKS[W.get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))].solid) { p.y = Math.floor(p.y) + 1.01; p.vy = 0; p.vx *= 0.5; p.vz *= 0.5 }
      P[n * 3] = p.x; P[n * 3 + 1] = p.y; P[n * 3 + 2] = p.z; U[n * 2] = p.u; U[n * 2 + 1] = p.v
      const b = this.lightK(p.x, p.y, p.z); C[n * 4] = p.c[0] * b; C[n * 4 + 1] = p.c[1] * b; C[n * 4 + 2] = p.c[2] * b; C[n * 4 + 3] = Math.min(1, p.life * 3)
      S[n] = p.s; n++
    }
    for (let i = n; i < this.PN; i++) C[i * 4 + 3] = 0
    for (const k of ['position', 'aUv', 'aCol', 'aSize']) g.attributes[k].needsUpdate = true
    g.setDrawRange(0, n)
  }
  // a rough light at a point for entities: open sky (by the time of day) or torches near, else the cave dark
  lightK(x, y, z) {
    const W = this.world, X = Math.floor(x), Z = Math.floor(z)
    let sky = true
    for (let yy = Math.floor(y + 0.5); yy < Math.min(WH, Math.floor(y) + 40); yy++) { const b = BLOCKS[W.get(X, yy, Z)]; if (b && b.opac >= 15) { sky = false; break } }
    let k = sky ? 0.25 + 0.75 * this.U.uSky.value : 0.32
    if (!sky || this.U.uSky.value < 0.6) { if (this.game.torchNear(X, Math.floor(y), Z, 7)) k = Math.max(k, 0.9) }
    return k
  }

  // ------------------------------------------------------------------------ entities
  syncEnts(alpha, dt) {
    const seen = new Set(), G = this.game, P = G.player
    for (const e of G.ents) {
      if (Math.abs(e.x - P.x) > 64 || Math.abs(e.z - P.z) > 64) continue
      seen.add(e)
      let o = this.ents.get(e)
      if (!o) { o = this.makeEnt(e); if (!o) continue; this.ents.set(e, o); this.scene.add(o.g) }
      const ix = e.px !== undefined ? e.px + (e.x - e.px) * alpha : e.x, iy = e.py !== undefined ? e.py + (e.y - e.py) * alpha : e.y, iz = e.pz !== undefined ? e.pz + (e.z - e.pz) * alpha : e.z
      o.g.position.set(ix, iy, iz)
      const t = performance.now() / 1000
      if (e.e === 'item') { o.g.position.y += 0.18 + Math.sin(t * 2 + o.ph) * 0.06; o.g.rotation.y = t * 1.2 + o.ph }
      else if (e.e === 'xp') { o.g.position.y += 0.15; const k = 0.5 + 0.5 * Math.sin(t * 6 + o.ph); o.mat.color.setRGB(0.6 + k * 0.4, 1, 0.2 + k * 0.2) }
      else if (e.e === 'arrow') { if (!e.stuck) { o.g.rotation.y = Math.atan2(-e.vx, -e.vz); o.g.rotation.x = Math.atan2(e.vy, Math.hypot(e.vx, e.vz)) } }
      else if (e.e === 'tnt') { const f = (e.fuse / 5 | 0) % 2; o.mat.color.setScalar(f ? 1.6 : 1) }
      else if (e.e === 'mob') this.animMob(e, o, dt)
      if (o.light !== undefined && (o.lt = (o.lt || 0) - 1) <= 0) { o.lt = 6; const k = this.lightK(e.x, e.y + 0.5, e.z); o.light = k; this.tint(o, k, e) }
    }
    for (const [e, o] of this.ents) if (!seen.has(e)) { this.scene.remove(o.g); this.ents.delete(e) }
  }
  tint(o, k, e) {
    const hurt = e && e.hurt > 0 || (e && e.death), white = e && e.fuse > 0 && (e.fuse >> 2) % 2
    o.g.traverse(m => { if (m.material) for (const mm of [].concat(m.material)) { if (white) mm.color.setRGB(2, 2, 2); else if (hurt) mm.color.setRGB(k * 1.4, k * 0.45, k * 0.45); else mm.color.setScalar(k) } })
  }
  makeEnt(e) {
    const g = new THREE.Group(), ph = Math.random() * 6.28
    if (e.e === 'item') {
      const id = e.st.id, m = isBlockModel(id) ? blockMesh(id, this.atlas) : itemMesh(id)
      m.scale.setScalar(isBlockModel(id) ? 0.25 : 0.42); g.add(m)
      if (e.st.n > 1) { const m2 = m.clone(); m2.position.set(0.06, 0.04, 0.06); g.add(m2) }
      return { g, ph, light: 1 }
    }
    if (e.e === 'xp') {
      const c = document.createElement('canvas'); c.width = c.height = 8; const x = c.getContext('2d'); x.fillStyle = '#304010'; x.fillRect(1, 1, 6, 6); x.fillStyle = '#c0ff40'; x.fillRect(2, 2, 4, 4); x.fillStyle = '#ffffa0'; x.fillRect(3, 3, 1, 1)
      const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter
      const mat = new THREE.SpriteMaterial({ map: t, color: 0xffffff }), s = new THREE.Sprite(mat); s.scale.setScalar(0.15 + Math.min(0.2, e.v * 0.02)); g.add(s)
      return { g, ph, mat }
    }
    if (e.e === 'arrow') {
      const sh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.6), new THREE.MeshBasicMaterial({ color: 0x8a6a3a })); g.add(sh)
      const hd = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.1), new THREE.MeshBasicMaterial({ color: 0xa0a0a0 })); hd.position.z = -0.32; g.add(hd)
      const ft = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.1), new THREE.MeshBasicMaterial({ color: 0xeeeeee })); ft.position.z = 0.26; g.add(ft)
      return { g, ph, light: 1 }
    }
    if (e.e === 'fall' || e.e === 'tnt') {
      const m = blockMesh(e.e === 'tnt' ? 60 : e.id, this.atlas); m.position.y = 0.5; g.add(m)
      return { g, ph, mat: m.material, light: 1 }
    }
    if (e.e === 'mob') {
      const o = { g, ph, M: null, rs: null, walk: 0, light: 1 }, name = rsName(e)
      if (name) npcModel(name).then(m => { o.rs = m; m.mesh.material.fog = true; g.add(m.group); if (o.light !== undefined) this.tint(o, o.light, e) }).catch(() => { o.M = MODELS.zombie(); g.add(o.M.g) })
      else if (MODELS[e.type]) { o.M = MODELS[e.type](e.kind); g.add(o.M.g) }
      return o
    }
    return null
  }
  animMob(e, o, dt) {
    const sp = Math.hypot(e.x - (e.px ?? e.x), e.z - (e.pz ?? e.z))
    o.yaw = turnTo(o.yaw ?? e.yaw, e.yaw, dt * 10)
    o.g.rotation.y = o.yaw + Math.PI         // (RS models face +z; MC's yaw 0 faces -z)
    o.g.position.y = this.drawY(e, o.g.position.x, o.g.position.y, o.g.position.z, o); e.drawDy = o.dy
    if (o.rs) {
      const m = o.rs, clip = e.death ? 'death' : sp > 0.01 ? 'walk' : 'ready'
      m.play(clip, clip !== 'death'); m.update(dt)
      // a lunge when it lands a hit (RS NPCs here have no attack clip)
      if (e.atkFx > 0) { e.atkFx -= dt; m.group.position.z = Math.sin(Math.max(0, e.atkFx) / 0.25 * Math.PI) * 0.25 } else m.group.position.z = 0
    } else if (o.M) {
      const M = o.M
      o.walk += sp * 20 * dt * 2.2
      const amp = Math.min(1, sp * 8) * 0.9
      if (M.spider) M.legs.forEach((l, i) => { l.rotation.x = Math.sin(o.walk * 2 + i * 1.3) * 0.4 * amp })
      else M.legs.forEach((l, i) => { l.rotation.x = Math.sin(o.walk + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI : 0)) * amp })
      if (M.arms && !M.armsOut) M.arms.forEach((a, i) => { a.rotation.x = Math.sin(o.walk + (i ? 0 : Math.PI)) * amp * 0.8 })
      if (e.death) o.g.rotation.z = Math.min(1, e.death / 10) * Math.PI / 2
      if (e.fuse > 0) o.g.scale.setScalar(1 + Math.min(0.3, e.fuse / 100))
    }
    if (e.hurt > 0 || e.death || e.fuse > 0 || o.wasHurt) { this.tint(o, o.light, e); o.wasHurt = e.hurt > 0 || e.death || e.fuse > 0 }
  }
  // where a body is drawn: on the RS ground where it stands on the map's own ground (smoothly), else on the blocks
  drawY(e, x, y, z, o) {
    const rsw = this.rsw; if (!rsw) return y
    const W = this.world, bx = Math.floor(x), bz = Math.floor(z), by = Math.floor(y - 0.05), t = W.tile(bx, bz)
    let want = y
    if (t >= 0 && rsw.cover[t] && rsw.vx[t] !== 1 && by >= W.gy[t] - 1 && by <= W.gy[t] && W.natural(bx, by, bz) && (e.onGround || e.e !== 'mob')) {
      const h = rsw.height(x, z); if (h !== null && Math.abs(h - y) < 1.3) want = h
    }
    o.dy = (o.dy ?? 0) + ((want - y) - (o.dy ?? 0)) * 0.35
    return y + o.dy
  }
  // the player's RS body (third person, F5)
  syncPlayer(alpha, dt, show) {
    const P = this.game.player, out = outfitOf(P), key = JSON.stringify(out.items)
    if (key !== this.plKey) {
      this.plKey = key
      playerModel(out).then(m => {
        if (this.plKey !== key) return
        if (this.pl) this.plG.remove(this.pl.group)
        this.pl = m; this.plG.add(m.group); m.mesh.material.fog = true; m.clip = null
      })
    }
    if (!this.plG) { this.plG = new THREE.Group(); this.scene.add(this.plG); this.plO = {} }
    if (this.plG.parent !== this.scene) this.scene.add(this.plG)
    this.plG.visible = show
    const x = P.px + (P.x - P.px) * alpha, y = P.py + (P.y - P.py) * alpha, z = P.pz + (P.z - P.pz) * alpha
    this.plG.position.set(x, this.drawY(P, x, y, z, this.plO), z)
    this.plYaw = turnTo(this.plYaw ?? P.yaw, P.face ?? P.yaw, dt * 12)
    this.plG.rotation.y = this.plYaw + Math.PI
    if (this.pl) {
      const sp = Math.hypot(P.x - P.px, P.z - P.pz), [clip, loop] = playerClip(P, P.inv[P.sel], sp)
      if (P.swing === 6 && !P.dig && this.lastSwing !== 6) this.pl.play(clip, loop, true)
      this.lastSwing = P.swing
      if (this.pl.clip !== clip && !(this.pl.clip === 'slash' || this.pl.clip === 'pound') || (this.pl.done && this.pl.clip !== clip)) this.pl.play(clip, loop)
      this.pl.update(dt)
      const k = this.lightK(P.x, P.y + 1.2, P.z), hurt = P.hurtT > 0
      this.pl.mesh.material.color.setRGB(hurt ? k * 1.4 : k, hurt ? k * 0.5 : k, hurt ? k * 0.5 : k)
    }
    return this.plG.position
  }

  // the inventory's portrait: your RS body front on (MC draws its player model there, turning to the mouse), drawn to
  // a little canvas the GUI blits. The body is borrowed from the world for the one render.
  portrait(w, h, look) {
    const pl = this.pl; if (!pl) return null
    let p = this.pt
    if (!p || p.w !== w || p.h !== h) {
      if (p) p.rt.dispose()
      const c = document.createElement('canvas'); c.width = w; c.height = h
      p = this.pt = { w, h, c, x: c.getContext('2d'), rt: new THREE.WebGLRenderTarget(w, h), px: new Uint8Array(w * h * 4), im: new ImageData(w, h), sc: new THREE.Scene(), hold: new THREE.Group(), cam: new THREE.PerspectiveCamera(28, w / h, 0.1, 20) }
      p.sc.add(p.hold); p.cam.position.set(0, 1.0, 3.5); p.cam.lookAt(0, 0.95, 0)
    }
    const par = pl.group.parent, mat = pl.mesh.material, col = mat.color.clone()
    p.hold.add(pl.group); p.hold.rotation.y = look;   // (RS models face +z: at you)
    mat.color.setScalar(1)
    const R = this.R; R.setRenderTarget(p.rt); R.setClearColor(0, 0); R.clear(); R.render(p.sc, p.cam); R.readRenderTargetPixels(p.rt, 0, 0, w, h, p.px); R.setRenderTarget(null)
    if (par) par.add(pl.group); mat.color.copy(col)
    for (let y = 0; y < h; y++) p.im.data.set(p.px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4)   // (GL rows run bottom up)
    p.x.putImageData(p.im, 0, 0)
    return p.c
  }

  // ------------------------------------------------------------------------ a frame
  frame(dt, alpha, cam) {
    const G = this.game, P = G.player, sc = this.skyColours(G.time + alpha)
    const uSky = Math.max(0.2, G.daylight())
    this.U.uSky.value = uSky
    const fogC = sc.bot.clone()
    const under = cam.water
    let fn = this.rd * 16 * 0.62, ff = this.rd * 16 - 6
    if (under) { fogC.setRGB(0.05, 0.12, 0.42).multiplyScalar(0.3 + 0.7 * uSky); fn = 2; ff = 22 }
    if (cam.lava) { fogC.setRGB(0.6, 0.15, 0.02); fn = 0; ff = 2 }
    this.U.uFog.value.copy(fogC); this.U.uFogN.value = fn; this.U.uFogF.value = ff
    if (!this.scene.fog) this.scene.fog = new THREE.Fog(0, 1, 2)
    this.scene.fog.color.copy(fogC); this.scene.fog.near = fn; this.scene.fog.far = ff
    this.R.setClearColor(fogC)
    this.skyU.top.value.copy(under ? fogC : sc.top); this.skyU.bot.value.copy(fogC); this.skyU.glowA.value = under ? 0 : sc.glowA
    this.skyU.glow.value.setRGB(1, 0.45, 0.2)
    const th = sc.a * Math.PI * 2, sd = new THREE.Vector3(-Math.sin(th), Math.cos(th), 0.1).normalize()
    this.skyU.sunDir.value.copy(sd)
    // the camera
    const c = this.cam
    c.position.copy(cam.pos); c.rotation.set(cam.pitch, cam.yaw, cam.roll || 0)
    c.fov = cam.fov; c.updateProjectionMatrix()
    this.U.uCam.value.copy(cam.pos)
    this.sky.position.copy(cam.pos); this.stars.position.copy(cam.pos)
    this.sun.position.copy(cam.pos).addScaledVector(sd, 400); this.sun.lookAt(cam.pos)
    this.moon.position.copy(cam.pos).addScaledVector(sd, -400); this.moon.lookAt(cam.pos)
    this.sun.visible = this.moon.visible = !under
    this.stars.material.opacity = Math.max(0, 1 - sc.d * 1.8) * 0.9; this.stars.visible = this.stars.material.opacity > 0.02 && !under
    this.stars.rotation.z = th
    this.clouds.position.set(cam.pos.x, 112, cam.pos.z)
    this.clouds.material.map.offset.set(((G.time + alpha) * 0.0006 + cam.pos.x / 1536 * 2) % 1, (-cam.pos.z / 1536 * 2) % 1)
    this.clouds.material.color.setScalar(0.12 + 0.88 * Math.max(0, (uSky - 0.2) / 0.8))
    this.clouds.visible = this.fancy || true
    if (this.rsw) { this.rsw.update(); this.rsw.cull(cam.pos.x, cam.pos.z, ff + 20); this.rsw.setLight(0.3 + 0.7 * uSky) }
    this.syncEnts(alpha, dt)
    this.tickParticles(dt)
    this.pts.material.uniforms.uScale.value = this.R.domElement.height / (2 * Math.tan(c.fov * Math.PI / 360))
    // the target outline + cracks
    const t = cam.target
    if (t && !cam.hideHud) {
      const b = selBox(this.world, t.x, t.y, t.z, t.id) || [0, 0, 0, 1, 1, 1], e = 0.002
      this.outline.visible = true
      this.outline.scale.set(b[3] - b[0] + e * 2, b[4] - b[1] + e * 2, b[5] - b[2] + e * 2)
      this.outline.position.set(t.x + (b[0] + b[3]) / 2, t.y + (b[1] + b[4]) / 2, t.z + (b[2] + b[5]) / 2)
      if (P.dig && P.dig.prog > 0) { this.crack.visible = true; this.crack.position.copy(this.outline.position); this.crack.scale.copy(this.outline.scale); this.setCrack(Math.min(9, Math.floor(P.dig.prog * 10))) }
      else this.crack.visible = false
    } else { this.outline.visible = false; this.crack.visible = false }
    this.R.autoClear = true
    this.R.render(this.scene, c)
  }
  // the hand pass on top (MC: its own FOV, bobbing with the walk, the swing arc, the equip dip)
  drawHand(h) {
    const P = this.game.player
    this.hcam.aspect = this.cam.aspect; this.hcam.updateProjectionMatrix()
    const s = h.swing, sw = Math.sin(Math.sqrt(s) * Math.PI), sw2 = Math.sin(s * Math.PI)
    const bob = h.bob
    this.hand.position.set(Math.sin(bob * Math.PI) * h.bobAmt * 0.5 - sw * 0.25, -Math.abs(Math.cos(bob * Math.PI) * h.bobAmt) + sw2 * 0.12 - (1 - this.equip) * 0.6, -sw2 * 0.1)
    this.hand.rotation.set(0, 0, 0)
    this.hand.rotation.y = -sw * 0.35; this.hand.rotation.x = -sw2 * 0.6
    if (h.eat) { this.hand.position.y += Math.abs(Math.cos(h.eat * 0.6)) * 0.08 - 0.05; this.hand.position.x -= 0.25; this.hand.rotation.y = 0.6 }
    if (h.bow) { this.hand.position.x -= 0.15; this.hand.rotation.z = 0.2; this.hand.position.z += Math.min(1, h.bow / 20) * 0.12 }
    this.armPivot.visible = !this.held || this.heldId === 0
    const A = this.armPose; this.armPivot.position.set(A[0], A[1], A[2]); this.armPivot.rotation.set(A[3], A[4], A[5])
    const k = h.light
    for (const o of [this.armPivot, this.held]) if (o) o.traverse(m => { if (m.material) for (const mm of [].concat(m.material)) mm.color.setScalar(k) })
    this.R.autoClear = false
    this.R.clearDepth()
    this.R.render(this.hscene, this.hcam)
  }
}
