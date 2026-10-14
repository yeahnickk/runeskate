// Minecraft's entity physics, per 20 Hz tick, in blocks: AABB moves clipped axis by axis (y, x, z) against block
// boxes, step-up 0.6, sneaking can't walk off edges, gravity 0.08 with 0.98 drag, ground slip 0.6*0.91, water and lava
// drag, ladders. Pure.
import { BLOCKS, liquidTop } from './blocks.js'
import { doorBox } from './mesh.js'

// a wall/fence on a block's edges (meta: 1 west -x, 2 south +z, 4 east +x, 8 north -z), 2/16 thick
export function edgeBoxes(m, h = 1) {
  const t = 2 / 16, B = []
  if (m & 1) B.push([0, 0, 0, t, h, 1]); if (m & 4) B.push([1 - t, 0, 0, 1, h, 1])
  if (m & 2) B.push([0, 0, 1 - t, 1, h, 1]); if (m & 8) B.push([0, 0, 0, 1, h, t])
  return B.length ? B : [[0, 0, 0, t, h, 1]]
}
// collision boxes of a block (in block-local 0..1), or null
export function boxesOf(world, x, y, z, id) {
  const d = BLOCKS[id]
  if (!d || !d.solid) return null
  const sh = d.shape
  if (sh === 'cube') return [[0, 0, 0, 1, 1, 1]]
  if (sh === 'fence') {
    const B = [[6 / 16, 0, 6 / 16, 10 / 16, 1.5, 10 / 16]]
    const con = (dx, dz) => { const n = world.get(x + dx, y, z + dz), nd = BLOCKS[n]; return n === id || (nd && nd.op && nd.shape === 'cube') }
    if (con(1, 0)) B.push([10 / 16, 0, 6 / 16, 1, 1.5, 10 / 16])
    if (con(-1, 0)) B.push([0, 0, 6 / 16, 6 / 16, 1.5, 10 / 16])
    if (con(0, 1)) B.push([6 / 16, 0, 10 / 16, 10 / 16, 1.5, 1])
    if (con(0, -1)) B.push([6 / 16, 0, 0, 10 / 16, 1.5, 6 / 16])
    return B
  }
  if (sh === 'door') return [doorBox(world.meta(x, y, z)).map(v => v / 16)]
  if (sh === 'edge') return edgeBoxes(world.meta(x, y, z), d.fence ? 1.5 : 1)
  if (Array.isArray(sh)) return [sh.map(v => v / 16)]
  return null
}

// all block boxes (world space) overlapping an AABB
function collect(world, a, out) {
  out.length = 0
  const x0 = Math.floor(a[0]), x1 = Math.floor(a[3] - 1e-9), y0 = Math.floor(a[1]) - 1, y1 = Math.floor(a[4] - 1e-9), z0 = Math.floor(a[2]), z1 = Math.floor(a[5] - 1e-9)
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = Math.max(0, y0); y <= y1; y++) {
    const id = world.get(x, y, z)
    if (!id) continue
    const bs = boxesOf(world, x, y, z, id)
    if (!bs) continue
    for (const b of bs) {
      const w = [x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]]
      if (w[3] > a[0] && w[0] < a[3] && w[4] > a[1] && w[1] < a[4] && w[5] > a[2] && w[2] < a[5]) out.push(w)
    }
  }
  if (y0 < 0 && a[1] < 0) out.push([a[0] - 1, -64, a[2] - 1, a[3] + 1, 0, a[5] + 1])    // (the void floor)
  return out
}
const tmpB = []
function clip(boxes, a, ax, d) {
  const o1 = (ax + 1) % 3, o2 = (ax + 2) % 3
  for (const b of boxes) {
    if (b[o1 + 3] <= a[o1] || b[o1] >= a[o1 + 3] || b[o2 + 3] <= a[o2] || b[o2] >= a[o2 + 3]) continue
    if (d > 0 && b[ax] >= a[ax + 3] - 1e-7) d = Math.min(d, b[ax] - a[ax + 3])
    else if (d < 0 && b[ax + 3] <= a[ax] + 1e-7) d = Math.max(d, b[ax + 3] - a[ax])
  }
  return d
}
export const aabb = (e) => [e.x - e.w / 2, e.y, e.z - e.w / 2, e.x + e.w / 2, e.y + e.h, e.z + e.w / 2]

// move an entity by (dx,dy,dz) blocks; sets onGround, hitH, hitV
export function move(world, e, dx, dy, dz) {
  const want = [dx, dy, dz]
  if (e.sneak && e.onGround) {                    // MC: sneaking stops you walking off a ledge
    const ok = (ddx, ddz) => { const a = aabb(e); a[0] += ddx; a[3] += ddx; a[2] += ddz; a[5] += ddz; a[1] -= 1; a[4] = a[1] + 1; return collect(world, a, tmpB).length > 0 }
    const st = 0.05
    while (dx !== 0 && !ok(dx, 0)) dx = Math.abs(dx) < st ? 0 : dx - Math.sign(dx) * st
    while (dz !== 0 && !ok(0, dz)) dz = Math.abs(dz) < st ? 0 : dz - Math.sign(dz) * st
    while (dx !== 0 && dz !== 0 && !ok(dx, dz)) { dx = Math.abs(dx) < st ? 0 : dx - Math.sign(dx) * st; dz = Math.abs(dz) < st ? 0 : dz - Math.sign(dz) * st }
    want[0] = dx; want[2] = dz
  }
  const a = aabb(e)
  const reach = [Math.min(a[0], a[0] + dx), Math.min(a[1], a[1] + dy), Math.min(a[2], a[2] + dz), Math.max(a[3], a[3] + dx), Math.max(a[4], a[4] + dy), Math.max(a[5], a[5] + dz)]
  reach[4] += e.step || 0
  const boxes = collect(world, reach, [])
  const a0 = a.slice()
  let my = clip(boxes, a, 1, dy); a[1] += my; a[4] += my
  let mx = clip(boxes, a, 0, dx); a[0] += mx; a[3] += mx
  let mz = clip(boxes, a, 2, dz); a[2] += mz; a[5] += mz
  const onG = dy < 0 && my > dy
  // step up (MC: if a horizontal move was cut while on the ground, try it again lifted by step height)
  if ((e.onGround || onG) && e.step && (mx !== dx || mz !== dz)) {
    const b = a0.slice()
    let sy = clip(boxes, b, 1, e.step); b[1] += sy; b[4] += sy
    let sx = clip(boxes, b, 0, dx); b[0] += sx; b[3] += sx
    let sz = clip(boxes, b, 2, dz); b[2] += sz; b[5] += sz
    let dn = clip(boxes, b, 1, -sy + (dy < 0 ? dy : 0)); b[1] += dn; b[4] += dn
    if (sx * sx + sz * sz > mx * mx + mz * mz + 1e-9) { a.splice(0, 6, ...b); mx = sx; mz = sz; my = b[1] - a0[1] }
  }
  e.x = (a[0] + a[3]) / 2; e.y = a[1]; e.z = (a[2] + a[5]) / 2
  e.hitH = mx !== dx || mz !== dz
  e.hitV = my !== dy
  e.onGround = dy < 0 && my > dy + 1e-9
  if (mx !== dx) e.vx = 0
  if (mz !== dz) e.vz = 0
  if (my !== dy) e.vy = 0
}

// what the entity is in: water / lava / ladder (feet or body)
// the surface of the liquid in a cell (in its block, 0-1): full under more of it, else by its flow level
export function liquidH(world, x, y, z) { const id = world.get(x, y, z); return world.get(x, y + 1, z) === id ? 1 : liquidTop(world.meta(x, y, z)) }
// MC's current: a liquid runs from its higher cells to its lower (levels: a source or a fall 0, flowing 1-7)
export function flowAt(world, x, y, z) {
  const id = world.get(x, y, z), d = BLOCKS[id]; if (!d || !d.liquid) return null
  const lv = (m) => { const l = m & 15; return l >= 8 ? 0 : l }, my = lv(world.meta(x, y, z))
  let fx = 0, fz = 0
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = world.get(x + dx, y, z + dz)
    if (n === id) { const k = lv(world.meta(x + dx, y, z + dz)) - my; fx += dx * k; fz += dz * k }
    else if (!BLOCKS[n].solid && world.get(x + dx, y - 1, z + dz) === id) { const k = lv(world.meta(x + dx, y - 1, z + dz)) + 8 - my; fx += dx * k; fz += dz * k }   // (a drop beside: it runs over the edge)
  }
  const L = Math.hypot(fx, fz); return L ? [fx / L, fz / L] : null
}
export function medium(world, e) {
  const a = aabb(e)
  let water = false, lava = false, climb = false, eyesWater = false, fire = false, fx = 0, fz = 0
  for (let x = Math.floor(a[0] + 0.001); x <= Math.floor(a[3] - 0.001); x++) for (let z = Math.floor(a[2] + 0.001); z <= Math.floor(a[5] - 0.001); z++)
    for (let y = Math.floor(a[1] + 0.001); y <= Math.floor(a[4] - 0.001); y++) {
      const id = world.get(x, y, z), d = BLOCKS[id]
      if (!d) continue
      if (d.liquid && a[1] < y + liquidH(world, x, y, z)) {
        if (d.liquid === 'water') water = true; else lava = true
        const f = flowAt(world, x, y, z); if (f) { fx += f[0]; fz += f[1] }
      }
      if (d.climb) climb = true
      if (d.fire) fire = true
    }
  const ey = e.y + (e.eye || e.h * 0.85), ex = Math.floor(e.x), eyy = Math.floor(ey), ez = Math.floor(e.z), ed = BLOCKS[world.get(ex, eyy, ez)]
  if (ed && ed.liquid === 'water' && ey < eyy + liquidH(world, ex, eyy, ez)) eyesWater = true
  const L = Math.hypot(fx, fz)
  return { water, lava, climb, eyesWater, fire, flow: L ? [fx / L, fz / L] : null }
}

// one 20 Hz tick of MC movement. inp: { fw, st (-1..1), jump, sneak, sprint, yaw (radians, 0 = facing -Z), fly }
export function tickMove(world, e, inp) {
  const m = medium(world, e)
  e.inWater = m.water; e.inLava = m.lava; e.eyesWater = m.eyesWater; e.onLadder = m.climb; e.inFire = m.fire
  let fw = inp.fw || 0, st = inp.st || 0
  if (e.sneak) { fw *= 0.3; st *= 0.3 }
  const len = Math.hypot(fw, st); if (len > 1) { fw /= len; st /= len }
  const yaw = inp.yaw || 0, s = Math.sin(yaw), c = Math.cos(yaw)
  const mr = (acc) => {     // moveRelative: forward = -Z rotated by yaw
    e.vx += (st * c - fw * s) * acc
    e.vz += (-fw * c - st * s) * acc
  }
  if (inp.fly) {
    mr(e.sprint ? 0.1 : 0.05)          // (MC's flySpeed 0.05, doubled sprinting, under air drag 0.91: ~10.9 blocks/s, 21.8 sprinting)
    e.vy += (inp.jump ? 0.15 : 0) - (inp.sneakFly ? 0.15 : 0)
    move(world, e, e.vx, e.vy, e.vz)
    e.vx *= 0.91; e.vz *= 0.91; e.vy *= 0.6
    e.fall = 0
    return
  }
  if (e.inWater || e.inLava) {
    const y0 = e.y
    mr(0.02)
    if (m.flow) { const k = e.inWater ? 0.014 : 0.0023; e.vx += m.flow[0] * k; e.vz += m.flow[1] * k }   // (MC: the current carries you)
    // MC: only shallowly in (the water's top under 0.4 over your feet) a jump is a real jump; deeper, a stroke up
    let wy = Math.floor(e.y); while (BLOCKS[world.get(Math.floor(e.x), wy + 1, Math.floor(e.z))].liquid === 'water') wy++
    const fh = BLOCKS[world.get(Math.floor(e.x), wy, Math.floor(e.z))].liquid === 'water' ? wy + liquidH(world, Math.floor(e.x), wy, Math.floor(e.z)) - e.y : 0
    if (inp.jump && e.inWater && fh <= 0.4 && !(e.jumpCd > 0)) { e.vy = 0.42; e.jumpCd = 10 }
    else if (inp.jump) e.vy += 0.04
    if (e.jumpCd > 0) e.jumpCd--
    if (!inp.jump) e.jumpCd = 0
    move(world, e, e.vx, e.vy, e.vz)
    const k = e.inWater ? 0.8 : 0.5
    e.vx *= k; e.vy *= k; e.vz *= k
    e.vy -= e.inWater ? 0.02 : 0.02
    // MC: swimming into a bank pops you up onto it
    // (and at the top, a bank a block up: RS banks slope where the blocks step, so they let you out)
    if (e.hitH) {
      const free = (dy) => { const t = { ...e, y: e.y + dy - (e.y - y0) }; return !collect(world, aabb(t), tmpB).length && !medium(world, t).water }
      if (fh <= 1 && free(1.3)) e.vy = Math.max(e.vy, 0.45)
      else if (free(0.6)) e.vy = 0.3
    }
    e.fall = 0
    return
  }
  const slip = e.onGround ? 0.6 * 0.91 : 0.91
  const acc = e.onGround ? 0.1 * (0.16277136 / (slip * slip * slip)) * (e.sprint ? 1.3 : 1) * (e.speedMul || 1) : (e.sprint ? 0.026 : 0.02)
  if (inp.jump && e.onGround && !(e.jumpCd > 0)) {
    e.vy = 0.42; e.jumpCd = 10
    if (e.sprint) { e.vx += -s * 0.2; e.vz += -c * 0.2 }
  }
  if (e.jumpCd > 0) e.jumpCd--
  if (!inp.jump) e.jumpCd = 0
  mr(acc)
  if (e.onLadder) {
    e.vx = Math.max(-0.15, Math.min(0.15, e.vx)); e.vz = Math.max(-0.15, Math.min(0.15, e.vz))
    e.vy = Math.max(e.vy, e.sneak ? 0 : -0.15)
    e.fall = 0
  }
  const y0 = e.y
  move(world, e, e.vx, e.vy, e.vz)
  if (e.onLadder && (e.hitH || inp.jump)) e.vy = 0.2
  // fall distance (MC: damage = fallen - 3 on landing)
  if (e.y < y0) e.fall = (e.fall || 0) + (y0 - e.y)
  e.landed = 0
  if (e.onGround) { if (e.fall > 0) e.landed = e.fall; e.fall = 0 }
  e.vy = (e.vy - 0.08) * 0.98
  e.vx *= slip; e.vz *= slip
}

// voxel raycast (Amanatides-Woo) from eye along dir, up to reach; returns { x,y,z, face:[nx,ny,nz], id, dist } or null
export function raycast(world, o, d, reach, pick) {
  let x = Math.floor(o[0]), y = Math.floor(o[1]), z = Math.floor(o[2])
  const sx = Math.sign(d[0]), sy = Math.sign(d[1]), sz = Math.sign(d[2])
  const tdx = Math.abs(1 / d[0]), tdy = Math.abs(1 / d[1]), tdz = Math.abs(1 / d[2])
  let tx = d[0] ? ((sx > 0 ? x + 1 - o[0] : o[0] - x) * tdx) : Infinity
  let ty = d[1] ? ((sy > 0 ? y + 1 - o[1] : o[1] - y) * tdy) : Infinity
  let tz = d[2] ? ((sz > 0 ? z + 1 - o[2] : o[2] - z) * tdz) : Infinity
  let face = [0, 0, 0], t = 0
  for (let i = 0; i < 64 && t <= reach; i++) {
    const id = world.get(x, y, z)
    if (id && (!pick || pick(id, x, y, z, face))) {
      const bx = selBox(world, x, y, z, id)
      if (bx) {      // the real (sub-block) box: test the ray against it
        const h = rayBox(o, d, [x + bx[0], y + bx[1], z + bx[2], x + bx[3], y + bx[4], z + bx[5]])
        if (h && h.t <= reach) return { x, y, z, face: h.n, id, dist: h.t, hit: [o[0] + d[0] * h.t, o[1] + d[1] * h.t, o[2] + d[2] * h.t] }
      }
    }
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; face = [-sx, 0, 0] }
    else if (ty < tz) { y += sy; t = ty; ty += tdy; face = [0, -sy, 0] }
    else { z += sz; t = tz; tz += tdz; face = [0, 0, -sz] }
  }
  return null
}
// the outline/pick box of a block (MC's selection box)
export function selBox(world, x, y, z, id) {
  const d = BLOCKS[id]
  if (!d || d.liquid) return null
  const sh = d.shape
  if (sh === 'cube') return [0, 0, 0, 1, 1, 1]
  if (sh === 'cross') return [0.15, 0, 0.15, 0.85, id === 29 ? 0.8 : 0.7, 0.85]
  if (sh === 'torch') return [6 / 16, 0, 6 / 16, 10 / 16, 10 / 16, 10 / 16]
  if (sh === 'fence') return [6 / 16, 0, 6 / 16, 10 / 16, 1, 10 / 16]
  if (sh === 'edge') { const B = edgeBoxes(world.meta(x, y, z)), u = [1, 1, 1, 0, 0, 0]; for (const b of B) for (let k = 0; k < 3; k++) { u[k] = Math.min(u[k], b[k]); u[k + 3] = Math.max(u[k + 3], b[k + 3]) } return u }
  if (sh === 'door') return doorBox(world.meta(x, y, z)).map(v => v / 16)
  if (sh === 'ladder') return [[0, 0, 13, 16, 16, 16], [0, 0, 0, 3, 16, 16], [0, 0, 0, 16, 16, 3], [13, 0, 0, 16, 16, 16]][world.meta(x, y, z) & 3].map(v => v / 16)
  if (Array.isArray(sh)) return sh.map(v => v / 16)
  return null
}
export function rayBox(o, d, b) {
  let t0 = 0, t1 = 1e9, n = null
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) { if (o[a] < b[a] || o[a] > b[a + 3]) return null; continue }
    let ta = (b[a] - o[a]) / d[a], tb = (b[a + 3] - o[a]) / d[a], na = -1
    if (ta > tb) { const t = ta; ta = tb; tb = t; na = 1 }
    if (ta > t0) { t0 = ta; n = [0, 0, 0]; n[a] = na }
    t1 = Math.min(t1, tb)
    if (t0 > t1) return null
  }
  return { t: t0, n: n || [0, 1, 0] }
}
