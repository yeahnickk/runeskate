// MineScape's game: Minecraft survival rules at 20 ticks a second. The player (health, hunger + saturation +
// exhaustion, air, XP levels, armour), digging (MC's break times, tools wearing out), placing, using blocks
// (crafting table, furnace, chest, bed, door), food, bows, buckets, hoes, bone meal, TNT; dropped items + XP orbs,
// falling sand, water filling holes, crops and saplings growing; mobs spawning (animals by day, monsters in the dark),
// villagers to trade with; the day/night cycle; advancements. Pure (no DOM/three): the client reads `events`.
import { BLOCKS, ITEMS, def, digInfo, dropsOf, placeOf, melee, SMELT, SMELT_XP, COOK_TICKS, fuelOf, maxStack, nameOf, ARMOR_MATS } from './blocks.js'
import { World, rngOf, hash, CS, WH } from './world.js'
import { tickMove, raycast, aabb, rayBox, move, flowAt } from './phys.js'
import { MOBS, makeMob, tickMob, FOLK_KINDS, setNid, RS_SPAWN } from './mobs.js'
import { give, stack, same, count, take } from './inv.js'

export const TPS = 20, DAY = 24000
export const REACH = 4.5

const EVADV = new Set(['killHostile', 'trade', 'arrowHit', 'plant', 'sleep'])
export const ADV = [
  { id: 'root', n: 'MineScape', d: 'The heart and story of the game', icon: 24, has: [24] },
  { id: 'wood', n: 'Getting Wood', d: 'Punch a tree until a block of wood pops out', icon: 10, has: [10, 46] },
  { id: 'stone', n: 'Stone Age', d: 'Mine Stone with your new Pickaxe', icon: 4, has: [4] },
  { id: 'upgrade', n: 'Getting an Upgrade', d: 'Construct a better Pickaxe', icon: 307, has: [307] },
  { id: 'iron', n: 'Acquire Hardware', d: 'Smelt an Iron Ingot', icon: 258, has: [258] },
  { id: 'ironpick', n: "Isn't It Iron Pick", d: 'Upgrade your Pickaxe', icon: 312, has: [312] },
  { id: 'suit', n: 'Suit Up', d: 'Protect yourself with a piece of iron armor', icon: 335, worn: [334, 335, 336, 337] },
  { id: 'diamonds', n: 'Diamonds!', d: 'Acquire diamonds', icon: 260, has: [260] },
  { id: 'lava', n: 'Hot Stuff', d: 'Fill a Bucket with lava', icon: 287, has: [287] },
  { id: 'rune', n: 'Rune Ore? In MY Wilderness?', d: 'Mine runite ore deep under the Wilderness', icon: 296, has: [296] },
  { id: 'runepick', n: 'Dragon Pick Not Included', d: 'Craft a Runite Pickaxe', icon: 352, has: [352] },
  { id: 'bread', n: 'Bake Bread', d: 'Turn wheat into bread', icon: 265, has: [265] },
  { id: 'cook', n: 'Cooking Level Up!', d: 'Cook food in a Furnace', icon: 269, has: [269, 271, 273, 286, 326] },
  { id: 'seedy', n: 'A Seedy Place', d: 'Plant a seed and watch it grow', icon: 267, ev: 'plant' },
  { id: 'hunter', n: 'Monster Hunter', d: 'Kill any hostile monster', icon: 310, ev: 'killHostile' },
  { id: 'aim', n: 'Take Aim', d: 'Shoot something with an Arrow', icon: 281, ev: 'arrowHit' },
  { id: 'trade', n: 'What a Deal!', d: 'Successfully trade with a Villager', icon: 261, ev: 'trade' },
  { id: 'sleep', n: 'Sweet Dreams', d: 'Sleep in a Bed to change your respawn point', icon: 40, ev: 'sleep' },
  { id: 'varrock', n: 'Welcome to Varrock', d: 'Walk to the city of Varrock', icon: 21, place: 'Varrock' },
  { id: 'falador', n: 'The White City', d: 'Walk to Falador', icon: 39, place: 'Falador' },
  { id: 'alkharid', n: 'Pay the Toll', d: 'Cross into Al Kharid', icon: 6, place: 'Al Kharid' },
  { id: 'draynor', n: 'Count Me In', d: 'Find Draynor Manor', icon: 36, place: 'Draynor Manor' },
  { id: 'wildy', n: 'Ditch Jumper', d: 'Step into the Wilderness', icon: 5, place: 'Wilderness' },
]

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]], N6 = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]
const LQ = { water: { id: 8, drop: 1, max: 7, delay: 5 }, lava: { id: 9, drop: 2, max: 6, delay: 30 } }    // (MC overworld: lava runs 3)
// MC's blast resistance (explosionResistance / 5): its hardness, but stone-like blocks hold 6, planks 3, obsidian 1200
const resist = (id) => { const b = BLOCKS[id]; return b.liquid ? 100 : b.h < 0 ? 3.6e6 : id === 55 ? 1200 : [3, 4, 21, 38, 63, 72, 75, 76].includes(id) ? 6 : [11, 36].includes(id) ? 3 : b.h }
// what running water or lava goes into (and breaks): air and anything that doesn't block it, bar doors and ladders
const washes = (b) => { const d = BLOCKS[b]; return !b || (!d.solid && !d.liquid && d.shape !== 'door' && !d.climb) }
const xpNeed = (l) => l < 16 ? 2 * l + 7 : l < 31 ? 5 * l - 38 : 9 * l - 158

// a normal's main axis as a block face
const axisOf = (n) => { const ax = Math.abs(n[0]) > Math.abs(n[1]) ? (Math.abs(n[0]) > Math.abs(n[2]) ? 0 : 2) : (Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2), f = [0, 0, 0]; f[ax] = Math.sign(n[ax]) || 1; return f }

export class Game {
  constructor(world, opts = {}) {
    this.world = world
    this.mode = opts.mode || 'survival'
    this.rng = opts.rng || Math.random
    this.time = 1000; this.ticks = 0
    this.ents = []; this.events = []
    this.furnaces = new Map(); this.chests = new Map()
    this.adv = {}; this.populated = new Set(); this.torches = new Set(); this.flow = new Map(); this.fires = new Map(); this.lavas = new Set(); this.respawns = []
    this.name = opts.name || 'Steve'
    const j = world.json, sx = j.spawn[0], sz = -j.spawn[1] - 1
    this.spawn = [sx + 0.5, this.standY(sx, sz), sz + 0.5]
    this.player = this.newPlayer()
    world.listeners.push((x, y, z, id, was) => {
      const k = x + ',' + y + ',' + z
      if (id === 28) this.torches.add(k); else if (was === 28) this.torches.delete(k)
    })
  }
  newPlayer() {
    const s = this.spawn
    return { x: s[0], y: s[1], z: s[2], vx: 0, vy: 0, vz: 0, w: 0.6, h: 1.8, eye: 1.62, step: 1.05, yaw: 0, pitch: 0, onGround: false, fall: 0,
      hp: 20, food: 20, sat: 5, exh: 0, air: 300, xp: 0, lvl: 0, score: 0, inv: Array(36).fill(null), armor: Array(4).fill(null), off: null,
      craft2: Array(4).fill(null), cursor: null, sel: 0, dead: false, invul: 0, hurtT: 0, fire: 0, regen: 0, starve: 0, swing: 0, dig: null,
      digCd: 0, useCd: 0, eat: 0, bowT: 0, sneak: false, sprint: false, flying: false, atkT: 100, bed: null }
  }
  emit(e) { this.events.push(e); if (EVADV.has(e.t)) this.onEvent(e.t) }   // (awarded as it happens, not when a client drains the queue)
  chat(msg, col) { this.emit({ t: 'chat', msg, col }) }
  get dayTime() { return this.time % DAY }
  isNight() { const t = this.dayTime; return t > 13000 && t < 23000 }
  // MC's sky light dimming (0..11 subtracted at midnight): a 0-1 daylight factor for the renderer + spawning
  daylight() {
    const a = celestial(this.time), f = Math.max(0, Math.min(1, 1 - (Math.cos(a * Math.PI * 2) * 2 + 0.5)))
    return 1 - f
  }
  eyePos() { const P = this.player; return [P.x, P.y + (P.sneak ? 1.27 : 1.62), P.z] }
  lookDir() { const P = this.player, cp = Math.cos(P.pitch); return [-Math.sin(P.yaw) * cp, Math.sin(P.pitch), -Math.cos(P.yaw) * cp] }
  reach() { return this.mode === 'creative' ? 5 : REACH }
  target(liquids = false) {
    const o = this.eyePos(), d = this.lookDir(), W = this.world
    // (a ray that goes on through the hidden ground into a block deeper down hits the ground block it went in at, not one
    // that's out of sight under it: run = the hidden solid cells it has passed through in a row)
    const hide = this.hidden; let run = null, last = null
    let b = raycast(W, o, d, this.reach(), (id, x, y, z, f) => {
      if (!liquids && BLOCKS[id].liquid) return false
      const after = last && last[0] === x + f[0] && last[1] === y + f[1] && last[2] === z + f[2]
      if (hide && hide(x, y, z, f)) { if (BLOCKS[id].solid) { if (!after) run = [x, y, z, f]; last = [x, y, z] } return false }
      if (!after) run = null
      return true
    })
    if (b && run) { const [x, y, z, f] = run, id = W.get(x, y, z), h = rayBox(o, d, [x, y, z, x + 1, y + 1, z + 1]); if (id && h) b = { x, y, z, face: f.some(v => v) ? f : h.n, id, dist: h.t, hit: [o[0] + d[0] * h.t, o[1] + d[1] * h.t, o[2] + d[2] * h.t] } }
    // the client draws the RS models over the blocks (this.see: the nearest one along the ray). Hit what you see: a
    // model in front of the block the ray reaches is the block standing for it on its tile (the fence under a gate,
    // the top of a wall under its gable); a model with no block on its tile (a canopy, a roof) lets the ray on
    // A ground face the RS terrain stands in for (this.hidden) is never what you hit (its flat top pokes through where
    // the RS ground dips): the block ray goes by it and what's drawn there decides (ground: that tile's top block)
    const s = this.see && this.see(o, d, this.reach())
    if (!s || (b && b.dist <= s.t + 0.02)) return b
    const t = W.tile(s.X, s.Z); if (t < 0) return b
    const g = W.gy[t]
    const hit = [o[0] + d[0] * s.t, o[1] + d[1] * s.t, o[2] + d[2] * s.t]
    // (a model on a tile edge, a fence or gate, may be drawn from the tile across it: look there too)
    const fx = hit[0] - s.X, fz = hit[2] - s.Z, cols = [[s.X, s.Z]]
    if (fx < 0.3) cols.push([s.X - 1, s.Z]); else if (fx > 0.7) cols.push([s.X + 1, s.Z])
    if (fz < 0.3) cols.push([s.X, s.Z - 1]); else if (fz > 0.7) cols.push([s.X, s.Z + 1])
    if (!s.ground) for (const [X, Z] of cols) {
      const tc = W.tile(X, Z); if (tc < 0) continue
      const gc = W.gy[tc]
      for (let y = Math.min(Math.max(Math.floor(s.y), gc + 1), gc + 12); y > gc; y--) {
        const id = W.get(X, y, Z)
        if (!id || BLOCKS[id].liquid) continue
        return { x: X, y, z: Z, face: axisOf(s.n), id, dist: s.t, hit, rs: true }
      }
    }
    if (s.ground || s.h < 0.35) {            // (the ground, or a flat thing lying on it: a rug, a stone)
      const id = W.get(s.X, g, s.Z); if (!id || BLOCKS[id].liquid) return b
      return { x: s.X, y: g, z: s.Z, face: s.n[1] > 0.5 ? [0, 1, 0] : axisOf(s.n), id, dist: s.t, hit, rs: true }
    }
    return b
  }
  targetMob() {
    const o = this.eyePos(), d = this.lookDir(), b = this.target(), lim = Math.min(b ? b.dist : 99, this.mode === 'creative' ? 5 : 3)
    let best = null, bt = lim + 0.4
    for (const m of this.ents) {
      if (m.e !== 'mob' || m.death) continue
      if (Math.abs(m.x - o[0]) > 6 || Math.abs(m.z - o[2]) > 6) continue
      const a = aabb(m), dy = m.drawDy || 0      // (the client may draw it on the RS ground, a little off its box: hit what you see)
      const h = rayBox(o, d, [a[0] - 0.1, Math.min(a[1], a[1] + dy) - 0.1, a[2] - 0.1, a[3] + 0.1, Math.max(a[4], a[4] + dy) + 0.1, a[5] + 0.1])
      if (h && h.t < bt) { bt = h.t; best = m }
    }
    return best
  }

  // ------------------------------------------------------------------------ one tick
  tick(inp = {}) {
    this.ticks++; this.time++
    const P = this.player, W = this.world
    if (!P.dead) this.tickPlayer(inp)
    // entities near the player
    for (const e of this.ents) {
      if (Math.abs(e.x - P.x) > 96 || Math.abs(e.z - P.z) > 96) { if ((e.e === 'mob' && MOBS[e.type].hostile && !e.home) || e.e === 'tnt') e.gone = true; continue }   // (lit TNT thrown out of reach is gone, not frozen there for ever)
      if (!W.has(Math.floor(e.x) >> 4, Math.floor(e.z) >> 4)) { if (e.e === 'tnt') e.gone = true; continue }
      if (e.e === 'mob') { tickMob(this, e); if (e.death > 20) { e.gone = true; this.emit({ t: 'poof', x: e.x, y: e.y + e.h / 2, z: e.z }) } }
      else if (e.e === 'item') this.tickItem(e)
      else if (e.e === 'xp') this.tickOrb(e)
      else if (e.e === 'arrow') this.tickArrow(e)
      else if (e.e === 'fall') this.tickFalling(e)
      else if (e.e === 'tnt') this.tickTnt(e)
    }
    if (this.ents.some(e => e.gone)) this.ents = this.ents.filter(e => !e.gone)
    for (const [k, f] of this.furnaces) this.tickFurnace(k, f)
    if (this.ticks % 20 === 0) this.spawnTick()
    if (this.ticks % 10 === 0) this.checkAdv()
    this.randomTicks()
    this.flowTick()
    this.fireTick()
    this.lavaTicks()
  }

  tickPlayer(inp) {
    const P = this.player, W = this.world, crea = this.mode === 'creative'
    P.yaw = inp.yaw ?? P.yaw; P.pitch = inp.pitch ?? P.pitch
    P.sneak = !!inp.sneak && !P.flying
    const fw = inp.fw || 0
    if (inp.sprint && fw > 0 && (P.food > 6 || crea) && !P.sneak && !P.eat) P.sprint = true
    if (fw <= 0 || P.sneak || (P.food <= 6 && !crea) || P.hitH) P.sprint = false
    if (crea && inp.flyToggle) { P.flying = !P.flying; P.vy = 0 }
    if (!crea) P.flying = false
    if (P.flying && P.onGround && !inp.jump) P.flying = false
    const x0 = P.x, z0 = P.z, wasG = P.onGround
    tickMove(W, P, { fw: P.eat || P.bowT ? fw * 0.2 : fw, st: P.eat || P.bowT ? (inp.st || 0) * 0.2 : inp.st, jump: inp.jump, yaw: P.yaw, fly: P.flying, sneakFly: inp.sneak })
    if (P.y < -20) { this.hurtPlayer(4, null, 'void'); }
    const moved = Math.hypot(P.x - x0, P.z - z0)
    if (!crea) {
      if (P.sprint) P.exh += 0.1 * moved
      if (wasG && !P.onGround && P.vy > 0.3) P.exh += P.sprint ? 0.2 : 0.05
      if (P.inWater) P.exh += 0.01 * moved
    }
    P.walked = (P.walked || 0) + moved
    if (P.onGround && P.walked > 1.7) { P.walked = 0; if (!P.sneak) this.emit({ t: 'step', x: P.x, y: P.y - 0.2, z: P.z, id: W.get(Math.floor(P.x), Math.floor(P.y - 0.2), Math.floor(P.z)) }) }
    if (P.landed > 3 && !crea && !P.inWater) { this.hurtPlayer(Math.ceil(P.landed - 3), null, 'fall'); this.emit({ t: 'snd', s: 'fall', x: P.x, y: P.y, z: P.z }) }
    if (P.landed > 1.5) this.emit({ t: 'land', id: W.get(Math.floor(P.x), Math.floor(P.y - 0.2), Math.floor(P.z)) })
    // drowning, lava, fire, cactus
    if (P.eyesWater && !crea) { P.air--; if (P.air <= -20) { P.air = 0; this.hurtPlayer(2, null, 'drown') } }
    else P.air = Math.min(300, P.air + 4)
    if (P.inLava && !crea) { P.fire = 300; if (this.ticks % 10 === 0) this.hurtPlayer(4, null, 'lava') }
    if (P.inFire && !crea && !P.inWater) { P.fire = Math.max(P.fire, 160); if (this.ticks % 10 === 0) this.hurtPlayer(1, null, 'fire') }   // (MC: standing in fire, 1 a hit and alight 8 s)
    if (P.fire > 0) { P.fire--; if (P.inWater) P.fire = 0; else if (P.fire % 20 === 0 && !P.inLava && !crea) this.hurtPlayer(1, null, 'fire') }
    if (!crea && this.ticks % 10 === 0) {
      const a = aabb(P)
      for (let x = Math.floor(a[0] - 0.05); x <= Math.floor(a[3] + 0.05); x++) for (let z = Math.floor(a[2] - 0.05); z <= Math.floor(a[5] + 0.05); z++)
        for (let y = Math.floor(a[1]); y <= Math.floor(a[4]); y++) if (W.get(x, y, z) === 51) { this.hurtPlayer(1, null, 'cactus'); x = 1e9; break }
    }
    if (P.invul > 0) P.invul--
    if (P.hurtT > 0) P.hurtT--
    // hunger (MC: 4 exhaustion = 1 saturation or hunger), natural regeneration, starving
    if (!crea) {
      while (P.exh >= 8) { P.exh -= 8; if (P.sat > 0) P.sat = Math.max(0, P.sat - 1); else P.food = Math.max(0, P.food - 1) }   // (twice MC's 4: a meal lasts)
      if (P.food >= 20 && P.sat > 0 && P.hp < 20) { if (++P.regen >= 10) { P.regen = 0; const k = Math.min(P.sat, 6); P.hp = Math.min(20, P.hp + k / 6); P.exh += k } }
      else if (P.food >= 18 && P.hp < 20) { if (++P.regen >= 80) { P.regen = 0; P.hp = Math.min(20, P.hp + 1); P.exh += 6 } }
      else if (P.food <= 0) { if (++P.starve >= 80) { P.starve = 0; if (P.hp > 1) this.hurtPlayer(1, null, 'starve') } }
      else P.regen = 0
    } else { P.hp = 20; P.food = 20; P.air = 300 }
    // hotbar
    if (inp.sel !== undefined && inp.sel !== P.sel) { P.sel = inp.sel; P.dig = null; P.eat = 0; P.bowT = 0 }
    if (inp.drop) this.dropHeld(inp.dropAll)
    if (inp.swapHands) { const t = P.inv[P.sel]; P.inv[P.sel] = P.off; P.off = t }
    P.atkT++
    if (P.swing > 0) P.swing--
    this.tickHands(inp)
    this.pickups()
    if (this.ticks % 40 === 0) { const pl = W.placeName(Math.floor(P.x), Math.floor(P.z)); if (pl !== P.place) { P.place = pl; if (pl) this.emit({ t: 'region', n: pl }) } }
  }

  // digging, attacking, using: MC's left/right mouse
  tickHands(inp) {
    const P = this.player, W = this.world, crea = this.mode === 'creative'
    const held = P.inv[P.sel], hid = held ? held.id : 0
    if (P.digCd > 0) P.digCd--
    if (P.useCd > 0) P.useCd--
    // attack a mob first (MC: the crosshair's entity wins over the block behind it)
    if (inp.attackPress) {
      P.swing = 6
      const m = this.targetMob()
      if (m) { this.attackMob(m); P.dig = null; return }
    }
    if (inp.attack && !P.eat) {
      const t = this.target()
      if (!t) { P.dig = null }
      else if (crea) {
        if (inp.attackPress || P.digCd === 0) { if (!(held && ITEMS[hid] && ITEMS[hid].tool === 'sword')) this.breakBlock(t.x, t.y, t.z, false); P.digCd = 5 }
      } else if (P.digCd === 0) {
        if (!P.dig || P.dig.x !== t.x || P.dig.y !== t.y || P.dig.z !== t.z || P.dig.id !== t.id) P.dig = { x: t.x, y: t.y, z: t.z, id: t.id, prog: 0, n: 0 }
        const info = digInfo(t.id, hid, { water: P.eyesWater, air: !P.onGround && !P.flying })
        P.swing = Math.max(P.swing, 1)
        if (info.ticks === Infinity) P.dig.prog = 0
        else {
          P.dig.prog += info.ticks ? 1 / info.ticks : 1
          if (P.dig.n++ % 4 === 0) this.emit({ t: 'hit', id: t.id, x: t.x, y: t.y, z: t.z })
          if (P.dig.prog >= 1) { this.breakBlock(t.x, t.y, t.z, info.harvest); P.dig = null; P.digCd = 5; P.exh += 0.005 }
        }
      }
    } else P.dig = null
    // eating + bows run while use is held
    const it = ITEMS[hid]
    if (P.eat) {
      if (!inp.use || !held || !it || !it.food) P.eat = 0
      else if (++P.eat >= 33) { this.eatHeld(); P.eat = 0; P.useCd = 4 }
      else if (P.eat % 4 === 0) this.emit({ t: 'snd', s: 'eat' })
      return
    }
    if (P.bowT) {
      if (!inp.use) { this.fireBow(P.bowT); P.bowT = 0 }
      else P.bowT++
      return
    }
    if (!(inp.usePress || (inp.use && P.useCd === 0))) return
    P.useCd = 4
    this.use(inp)
  }

  use(inp) {
    const P = this.player, W = this.world, crea = this.mode === 'creative'
    const held = P.inv[P.sel], hid = held ? held.id : 0, it = ITEMS[hid]
    // villagers
    const m = this.targetMob()
    if (m && m.type === 'villager' && !m.angry && inp.usePress) { this.emit({ t: 'screen', type: 'trade', key: m }); this.emit({ t: 'snd', s: 'villager', x: m.x, y: m.y, z: m.z }); return }
    const t = this.target()
    if (t && !P.sneak && inp.usePress) {
      const d = BLOCKS[t.id]
      if (d.use === 'craft') return this.emit({ t: 'screen', type: 'craft' })
      if (d.use === 'furnace') return this.emit({ t: 'screen', type: 'furnace', key: t.x + ',' + t.y + ',' + t.z })
      if (d.use === 'chest') return this.emit({ t: 'screen', type: 'chest', key: t.x + ',' + t.y + ',' + t.z })
      if (d.use === 'bed') return this.sleep(t)
      if (d.use === 'door') {
        const y0 = d.door === 2 ? t.y - 1 : t.y, mm = W.meta(t.x, y0, t.z) ^ 4
        W.set(t.x, y0, t.z, 56, mm); W.set(t.x, y0 + 1, t.z, 57, mm)
        return this.emit({ t: 'snd', s: mm & 4 ? 'door_open' : 'door_close', x: t.x, y: t.y, z: t.z })
      }
      if (d.tnt && it && it.fire) { this.prime(t.x, t.y, t.z); this.wear(1); P.swing = 6; return }
    }
    if (!held) return
    if (it && it.food) { if (P.food < 20 || crea || hid === 329) { P.eat = 1 } return }
    if (it && it.bow) { if (crea || count(P.inv, 280) > 0) P.bowT = 1; return }
    if (it && it.bucket !== undefined) return this.useBucket(it)
    if (it && it.tntBall) { if (t && inp.usePress) { this.tntBall(t.x + t.face[0], t.y + t.face[1], t.z + t.face[2], it.tntBall); if (!crea && !--held.n) P.inv[P.sel] = null; P.swing = 6 } return }
    if (!t) return
    const tb = BLOCKS[t.id]
    if (it && it.fire) {          // flint and steel: fire on the face you click (in a plant's own cell)
      const [x, y, z] = tb.rep && !tb.liquid ? [t.x, t.y, t.z] : [t.x + t.face[0], t.y + t.face[1], t.z + t.face[2]]
      if (inp.usePress && this.setFire(x, y, z)) { this.wear(1); P.swing = 6; this.emit({ t: 'snd', s: 'ignite', x: x + 0.5, y: y + 0.5, z: z + 0.5 }) }
      return
    }
    if (it && it.tool === 'hoe' && (t.id === 1 || t.id === 2 || t.id === 20) && t.face[1] >= 0 && !W.get(t.x, t.y + 1, t.z)) {
      W.set(t.x, t.y, t.z, 45); this.emit({ t: 'snd', s: 'till', x: t.x, y: t.y, z: t.z }); this.wear(1); P.swing = 6; return
    }
    if (it && it.tool === 'shovel' && t.id === 1 && t.face[1] >= 0 && !W.get(t.x, t.y + 1, t.z)) { W.set(t.x, t.y, t.z, 20); this.wear(1); P.swing = 6; return }
    if (it && it.meal) {
      if (tb.crop !== undefined && tb.crop < 3) { W.set(t.x, t.y, t.z, Math.min(44, t.id + 1 + (this.rng() * 2 | 0))); this.consume(); this.emit({ t: 'meal', x: t.x, y: t.y, z: t.z }); return }
      if (tb.sapling) { this.growTree(t.x, t.y, t.z, tb.sapling); this.consume(); this.emit({ t: 'meal', x: t.x, y: t.y, z: t.z }); return }
      if (t.id === 1) { for (let k = 0; k < 12; k++) { const x = t.x + (this.rng() * 7 | 0) - 3, z = t.z + (this.rng() * 7 | 0) - 3; if (W.get(x, t.y, z) === 1 && !W.get(x, t.y + 1, z)) W.set(x, t.y + 1, z, this.rng() < 0.85 ? 29 : 30 + (this.rng() * 2 | 0)) } this.consume(); this.emit({ t: 'meal', x: t.x, y: t.y + 1, z: t.z }); return }
    }
    const pid = placeOf(hid)
    if (!pid) return
    this.place(t, pid, hid)
  }

  place(t, pid, hid) {
    const P = this.player, W = this.world, d = BLOCKS[pid]
    let x = t.x, y = t.y, z = t.z
    if (!BLOCKS[t.id].rep || t.id === pid) { x += t.face[0]; y += t.face[1]; z += t.face[2] }
    if (y < 1 || y >= WH - 1) return
    const here = BLOCKS[W.get(x, y, z)]
    if (!here.rep) return
    const below = W.get(x, y - 1, z)
    // what needs what under it
    if (ITEMS[hid] && ITEMS[hid].plant && below !== 45) return
    if ((d.shape === 'cross') && !d.crop && ![1, 2, 45, 23].includes(below) && !(pid === 52 && below === 6)) return
    if (d.cactus && below !== 6 && below !== 51) return
    if (d.shape === 'torch' && t.face[1] < 0) return
    if (d.shape === 'torch' && !BLOCKS[t.id].op && t.face[1] === 0) return
    if (pid === 58 && t.face[1] !== 0) return
    let meta = 0
    const k = ((Math.round(P.yaw / (Math.PI / 2)) % 4) + 4) % 4, look = [0, 3, 2, 1][k]   // the way the player faces: 0 N 1 E 2 S 3 W
    if (d.facing) meta = (look + 2) & 3
    if (d.shape === 'torch' && t.face[1] === 0) meta = t.face[0] === -1 ? 4 : t.face[0] === 1 ? 2 : t.face[2] === -1 ? 1 : 3    // wall torch leans off its wall
    if (pid === 58) meta = t.face[2] === -1 ? 0 : t.face[0] === 1 ? 1 : t.face[2] === 1 ? 2 : 3
    if (d.solid) {   // never place a block inside someone
      const bx = [x, y, z, x + 1, y + 1, z + 1]
      for (const e of [P, ...this.ents.filter(e => e.e === 'mob' && !e.death)]) { const a = aabb(e); if (a[0] < bx[3] && a[3] > bx[0] && a[1] < bx[4] && a[4] > bx[1] && a[2] < bx[5] && a[5] > bx[2]) return }
    }
    if (d.bed) {
      const dx = [0, 1, 0, -1][look], dz = [-1, 0, 1, 0][look]
      if (!BLOCKS[W.get(x + dx, y, z + dz)].rep || !BLOCKS[W.get(x + dx, y - 1, z + dz)].solid) return
      W.set(x, y, z, 40, look); W.set(x + dx, y, z + dz, 40, look | 4)
    } else if (d.door) {
      if (!BLOCKS[W.get(x, y + 1, z)].rep) return
      W.set(x, y, z, 56, look); W.set(x, y + 1, z, 57, look)
    } else W.set(x, y, z, pid, meta)
    if (d.crop !== undefined) this.emit({ t: 'plant' })
    this.emit({ t: 'place', id: pid, x, y, z })
    P.swing = 6
    this.consume()
    if (d.fall) this.checkFall(x, y, z)
    this.wake(x, y, z)
    // a redstone torch lights the TNT it touches (placed either way round), as MC's redstone power
    if (d.tnt || d.power) for (const [dx, dy, dz] of N6) { const b = BLOCKS[W.get(x + dx, y + dy, z + dz)]; if (d.tnt && b.power) { this.prime(x, y, z); break } if (d.power && b.tnt) this.prime(x + dx, y + dy, z + dz) }
  }
  consume(n = 1) {
    if (this.mode === 'creative') return
    const P = this.player, h = P.inv[P.sel]
    if (!h) return
    h.n -= n; if (h.n <= 0) P.inv[P.sel] = null
  }
  wear(n) {
    if (this.mode === 'creative') return
    const P = this.player, h = P.inv[P.sel], it = h && ITEMS[h.id]
    if (!it || !it.dur) return
    h.d = (h.d || 0) + n
    if (h.d >= it.dur) { P.inv[P.sel] = null; this.emit({ t: 'snd', s: 'break_tool' }) }
  }
  // a ball of TNT r across round (x, y, z): it takes the ground and whatever stands there (bar bedrock and what keeps
  // things: chests, furnaces, beds, doors), but never your body: your cells and a shaft up out of the ball stay open
  tntBall(x, y, z, r) {
    const W = this.world, P = this.player, R2 = (r + 0.5) ** 2
    const free = (bx, by, bz) => bx + 1 > P.x - P.w / 2 - 0.2 && bx < P.x + P.w / 2 + 0.2 && bz + 1 > P.z - P.w / 2 - 0.2 && bz < P.z + P.w / 2 + 0.2 && by + 1 > P.y - 0.01
    let n = 0
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
      if (a * a + b * b + c * c > R2) continue
      const bx = x + a, by = y + b, bz = z + c; if (by < 1 || by >= WH) continue
      const id = W.get(bx, by, bz), d = BLOCKS[id]
      if (d.h < 0 || d.use) continue
      if (free(bx, by, bz)) { if (id && !d.liquid) { W.set(bx, by, bz, 0); this.afterRemove(bx, by, bz) } continue }
      if (id !== 60) { W.set(bx, by, bz, 60); n++ }
    }
    this.emit({ t: 'place', id: 60, x, y, z })
    return n
  }
  useBucket(it) {
    const P = this.player, W = this.world
    const t = this.target(true)
    if (!t) return
    if (it.bucket === 0) {
      const d = BLOCKS[t.id]
      if (!d.liquid) return
      if ((W.meta(t.x, t.y, t.z) & 15) !== 0) return          // (MC: only a source fills a bucket)
      W.set(t.x, t.y, t.z, 0); this.wake(t.x, t.y, t.z)
      const full = { id: d.liquid === 'water' ? 283 : 287, n: 1, d: 0 }
      if (this.mode !== 'creative') { this.consume(); if (!P.inv[P.sel]) P.inv[P.sel] = full; else if (give(P.inv, full)) this.dropAtPlayer(full) }
      this.emit({ t: 'snd', s: 'bucket' })
      return
    }
    let x = t.x, y = t.y, z = t.z
    if (!BLOCKS[t.id].rep) { x += t.face[0]; y += t.face[1]; z += t.face[2] }
    if (!BLOCKS[W.get(x, y, z)].rep) return
    if (W.get(x, y, z)) this.breakBlock(x, y, z, true)
    W.set(x, y, z, it.bucket); this.wake(x, y, z)
    if (this.mode !== 'creative') P.inv[P.sel] = { id: 282, n: 1, d: 0 }
    this.emit({ t: 'snd', s: 'bucket' })
  }
  eatHeld() {
    const P = this.player, h = P.inv[P.sel], it = h && ITEMS[h.id]
    if (!it || !it.food) return
    P.food = Math.min(20, P.food + it.food[0]); P.sat = Math.min(P.food, P.sat + it.food[1])
    this.emit({ t: 'snd', s: 'burp' })
    if (it.poison && this.rng() < it.poison) { P.exh += 6; this.chat('You feel sick...', '#5f5') }
    this.consume()
  }
  fireBow(ticks) {
    const P = this.player, crea = this.mode === 'creative'
    let f = ticks / 20; f = (f * f + f * 2) / 3; if (f > 1) f = 1
    if (f < 0.1) return
    if (!crea && !take(P.inv, 280, 1)) return
    const o = this.eyePos(), d = this.lookDir(), v = f * 3
    this.ents.push({ e: 'arrow', x: o[0], y: o[1] - 0.1, z: o[2], vx: d[0] * v, vy: d[1] * v, vz: d[2] * v, w: 0.5, h: 0.5, by: 'player', crit: f >= 1, age: 0 })
    this.wear(1)
    this.emit({ t: 'snd', s: 'bow' })
  }
  dropHeld(all) {
    const P = this.player, h = P.inv[P.sel]
    if (!h) return
    const n = all ? h.n : 1
    const st = { ...h, n }
    h.n -= n; if (!h.n) P.inv[P.sel] = null
    this.throwItem(st)
  }
  throwItem(st) {
    const P = this.player, o = this.eyePos(), d = this.lookDir()
    this.ents.push({ e: 'item', st, x: o[0], y: o[1] - 0.3, z: o[2], vx: d[0] * 0.3, vy: d[1] * 0.3 + 0.1, vz: d[2] * 0.3, w: 0.25, h: 0.25, age: 0, delay: 40 })
  }
  dropAtPlayer(st) { const P = this.player; this.ents.push({ e: 'item', st, x: P.x, y: P.y + 1, z: P.z, vx: 0, vy: 0.1, vz: 0, w: 0.25, h: 0.25, age: 0, delay: 40 }) }
  dropItem(st, x, y, z) {
    const R = this.rng
    this.ents.push({ e: 'item', st, x, y, z, vx: (R() - 0.5) * 0.2, vy: 0.2, vz: (R() - 0.5) * 0.2, w: 0.25, h: 0.25, age: 0, delay: 10 })
  }
  dropXp(n, x, y, z) {
    while (n > 0) { const v = n >= 17 ? 17 : n >= 7 ? 7 : n >= 3 ? 3 : 1; n -= v; this.ents.push({ e: 'xp', v, x, y, z, vx: (this.rng() - 0.5) * 0.2, vy: 0.2, vz: (this.rng() - 0.5) * 0.2, w: 0.5, h: 0.5, age: 0 }) }
  }
  addXp(n) {
    const P = this.player
    P.score += n
    P.xp += n / xpNeed(P.lvl)
    while (P.xp >= 1) { P.xp = (P.xp - 1) * xpNeed(P.lvl) / xpNeed(P.lvl + 1); P.lvl++; if (P.lvl % 5 === 0) this.emit({ t: 'snd', s: 'levelup' }) }
  }

  breakBlock(x, y, z, harvest) {
    const W = this.world, id = W.get(x, y, z), d = BLOCKS[id], crea = this.mode === 'creative'
    if (!id || d.h < 0 && !crea) return
    if (id === 5 && !crea) return
    const meta = W.meta(x, y, z)
    if (d.tree) {                                       // an RS tree falls whole (RS woodcutting): logs, a sapling, maybe an apple
      const cs = W.trunk(x, y, z), ys = W.treeAt(x, y, z)
      for (const c of cs) W.set(c[0], c[1], c[2], 0)
      this.emit({ t: 'fell', x, y: ys[0], z })
      if (!crea) {
        this.dropItem({ id: 10, n: 2 + Math.floor(this.rng() * 3), d: 0 }, x + 0.5, ys[0] + 0.5, z + 0.5)
        if (this.rng() < 0.4) this.dropItem({ id: 65, n: 1, d: 0 }, x + 0.5, ys[0] + 0.5, z + 0.5)
        if (this.rng() < 0.08) this.dropItem({ id: 256, n: 1, d: 0 }, x + 0.5, ys[0] + 0.5, z + 0.5)
        const h = this.player.inv[this.player.sel], it = h && ITEMS[h.id]
        if (it && it.tool) this.wear(it.tool === 'sword' ? 2 : 1)
      }
      return
    }
    W.set(x, y, z, 0)
    this.emit({ t: 'break', id, x, y, z })
    if (d.scenery) for (const s of [-1, 1]) for (let yy = y + s; W.get(x, yy, z) === id; yy += s) {   // (an RS object goes whole: its RS model is gone, so no bare block of it stays)
      W.set(x, yy, z, 0); if (!crea) for (const [did, n] of dropsOf(id, this.rng, harvest)) this.dropItem({ id: did, n, d: 0 }, x + 0.5, yy + 0.3, z + 0.5)
      this.afterRemove(x, yy, z)
    }
    if (d.door) { const oy = d.door === 1 ? y + 1 : y - 1; if (BLOCKS[W.get(x, oy, z)].door) W.set(x, oy, z, 0) }
    if (d.bed) { const look = meta & 3, s = meta & 4 ? -1 : 1, dx = [0, 1, 0, -1][look] * s, dz = [-1, 0, 1, 0][look] * s; if (W.get(x + dx, y, z + dz) === 40) W.set(x + dx, y, z + dz, 0) }
    const key = x + ',' + y + ',' + z
    if (this.chests.has(key)) { for (const s of this.chests.get(key)) if (s && !crea) this.dropItem(s, x + 0.5, y + 0.5, z + 0.5); this.chests.delete(key) }
    if (this.furnaces.has(key)) { for (const s of this.furnaces.get(key).s) if (s && !crea) this.dropItem(s, x + 0.5, y + 0.5, z + 0.5); this.furnaces.delete(key) }
    if (!crea) {
      for (const [did, n] of dropsOf(id, this.rng, harvest)) this.dropItem({ id: did, n, d: 0 }, x + 0.5, y + 0.3, z + 0.5)
      if (harvest && d.xp) this.dropXp(d.xp[0] + Math.floor(this.rng() * (d.xp[1] - d.xp[0] + 1)), x + 0.5, y + 0.5, z + 0.5)
      const h = this.player.inv[this.player.sel], it = h && ITEMS[h.id]
      if (it && it.tool && d.h > 0) this.wear(it.tool === 'sword' ? 2 : 1)
    }
    this.afterRemove(x, y, z)
  }
  // what a hole does to its neighbours: plants/torches lose support, sand falls, water runs in
  afterRemove(x, y, z) {
    const W = this.world
    const up = W.get(x, y + 1, z), ud = BLOCKS[up]
    if (ud.sup && (ud.shape !== 'torch' || (W.meta(x, y + 1, z) & 7) === 0)) { this.breakBlock(x, y + 1, z, true) }
    for (const [dx, dz, w] of [[1, 0, 4], [-1, 0, 2], [0, 1, 1], [0, -1, 3]]) if (BLOCKS[W.get(x + dx, y, z + dz)].shape === 'torch' && (W.meta(x + dx, y, z + dz) & 7) === w) this.breakBlock(x + dx, y, z + dz, true)
    if (ud.fall) this.checkFall(x, y + 1, z)
    this.wake(x, y, z)
  }
  // ------------------------------------------------------------------------ liquids (MC's levels: meta 0 a source, 1-7
  // flowing, 8 falling). Water runs 7 blocks every 5 ticks, lava 3 every 30; a cell works out what runs into it from
  // above and beside, so only cells something changed by are ever looked at (a whole lake never ticks)
  wake(x, y, z) { this.sched(x, y, z, 2); for (const [dx, dy, dz] of N6) this.sched(x + dx, y + dy, z + dz, 2) }
  sched(x, y, z, dt) { const k = x + ',' + y + ',' + z, t = this.ticks + dt, o = this.flow.get(k); if (o === undefined || o > t) this.flow.set(k, t) }
  flowTick() {
    if (!this.flow.size) return
    const due = []
    for (const [k, t] of this.flow) { if (t <= this.ticks) { due.push(k); if (due.length >= 400) break } }
    for (const k of due) { this.flow.delete(k); const [x, y, z] = k.split(',').map(Number); this.liquid(x, y, z) }
  }
  liquid(x, y, z) {
    const W = this.world, id = W.get(x, y, z), d = BLOCKS[id]
    if (y < 1 || y >= WH - 1 || !W.has(x >> 4, z >> 4)) return
    const lvl = (x, y, z) => W.meta(x, y, z) & 15
    const open = washes
    if (d.liquid === 'lava') {
      // lava meets water: a source sets to obsidian, flowing lava to cobblestone; lava running down onto water makes stone
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) if (BLOCKS[W.get(x + dx, y + dy, z + dz)].liquid === 'water') {
        W.set(x, y, z, lvl(x, y, z) === 0 ? 55 : 4); this.emit({ t: 'snd', s: 'fizz', x: x + 0.5, y: y + 0.5, z: z + 0.5 }); this.emit({ t: 'smoke', x: x + 0.5, y: y + 1, z: z + 0.5 }); this.wake(x, y, z); return
      }
      if (BLOCKS[W.get(x, y - 1, z)].liquid === 'water') { W.set(x, y - 1, z, 3); this.emit({ t: 'snd', s: 'fizz', x: x + 0.5, y, z: z + 0.5 }); this.wake(x, y - 1, z) }
      this.lavas.add(x + ',' + y + ',' + z)
      for (const [dx, dy, dz] of N6) if (BLOCKS[W.get(x + dx, y + dy, z + dz)].tnt) this.prime(x + dx, y + dy, z + dz)   // (TNT in lava's heat goes off)
      if (this.rng() < 0.3) this.lavaTick(x, y, z)
    }
    if (d.liquid && lvl(x, y, z) === 0) { this.spreadFrom(x, y, z, d.liquid); return }    // (a source stays; it only feeds)
    if (!d.liquid && !open(id)) return
    // what runs in: from above (falling), else the lowest-level feeder beside it that can't run down instead
    let L = null, lv = 99, srcs = 0, fall = false
    const up = BLOCKS[W.get(x, y + 1, z)]
    if (up.liquid) { L = up.liquid; lv = 8; fall = true }
    else for (const [dx, dz] of N4) {
      const nb = BLOCKS[W.get(x + dx, y, z + dz)]; if (!nb.liquid) continue
      const nl = lvl(x + dx, y, z + dz), below = W.get(x + dx, y - 1, z + dz)
      if (nl === 0 && nb.liquid === 'water') srcs++
      if (open(below) || (BLOCKS[below].liquid === nb.liquid && lvl(x + dx, y - 1, z + dz) !== 0)) continue   // (it falls instead)
      const e = (nl >= 8 ? 0 : nl) + LQ[nb.liquid].drop
      if (e < lv || (e === lv && nb.liquid === 'water')) { L = nb.liquid; lv = e }
    }
    if (L === 'water' && srcs >= 2) { const b = W.get(x, y - 1, z); if (BLOCKS[b].solid || (b === 8 && lvl(x, y - 1, z) === 0)) lv = 0 }   // (MC's infinite water)
    if (L && !fall && lv > LQ[L].max) L = null
    if (!L) { if (d.liquid) { W.set(x, y, z, 0); this.nb6(x, y, z, LQ[d.liquid].delay) } return }   // (its feeder is gone: it dries up)
    if (d.liquid && d.liquid !== L) {           // (the other kind runs into it)
      W.set(x, y, z, d.liquid === 'lava' ? 4 : 3); this.emit({ t: 'snd', s: 'fizz', x: x + 0.5, y: y + 0.5, z: z + 0.5 }); this.wake(x, y, z); return
    }
    if (d.liquid === L && lvl(x, y, z) === lv) return
    if (id && !d.liquid) { if (L === 'lava') { W.set(x, y, z, 0); this.emit({ t: 'snd', s: 'fizz', x: x + 0.5, y, z: z + 0.5 }) } else { W.set(x, y, z, 0); for (const [did, n] of dropsOf(id, this.rng, true)) this.dropItem({ id: did, n, d: 0 }, x + 0.5, y + 0.3, z + 0.5); this.afterRemove(x, y, z) } }   // (water washes a torch or a plant off, in any mode; lava burns it)
    W.set(x, y, z, LQ[L].id, lv)
    this.nb6(x, y, z, LQ[L].delay)
  }
  nb6(x, y, z, dt) { for (const [dx, dy, dz] of N6) this.sched(x + dx, y + dy, z + dz, dt) }
  // a source wakes the cells it could run into (never the rest of its lake)
  spreadFrom(x, y, z, L) {
    const W = this.world
    for (const [dx, dy, dz] of N6) { if (dy > 0) continue; const b = W.get(x + dx, y + dy, z + dz), bd = BLOCKS[b]; if (washes(b) || (bd.liquid && ((W.meta(x + dx, y + dy, z + dz) & 15) !== 0 || bd.liquid !== L))) this.sched(x + dx, y + dy, z + dz, LQ[L].delay) }
  }

  // ------------------------------------------------------------------------ fire (MC's BlockFire): it burns what's
  // flammable beside it away (TNT it lights), creeps to air beside flammable blocks, and dies out with nothing to burn
  flam(x, y, z) { const b = BLOCKS[this.world.get(x, y, z)].burn; return b ? b[1] : 0 }
  enc(x, y, z) { let e = 0; for (const [dx, dy, dz] of N6) { const b = BLOCKS[this.world.get(x + dx, y + dy, z + dz)].burn; if (b && b[0] > e) e = b[0] } return e }
  setFire(x, y, z, age = 0) {
    const W = this.world, b = W.get(x, y, z)
    if (b && !(BLOCKS[b].rep && !BLOCKS[b].liquid && !BLOCKS[b].fire)) return false
    if (!BLOCKS[W.get(x, y - 1, z)].solid && !this.enc(x, y, z)) return false      // (fire needs a floor or something to burn)
    W.set(x, y, z, 81, Math.min(15, age))
    this.fires.set(x + ',' + y + ',' + z, this.ticks + 30 + (this.rng() * 10 | 0))
    return true
  }
  prime(x, y, z, fuse = 80) {
    this.world.set(x, y, z, 0)
    const a = this.rng() * Math.PI * 2     // (MC: a little hop, 0.02 sideways in a random direction)
    this.ents.push({ e: 'tnt', x: x + 0.5, y, z: z + 0.5, vx: -Math.sin(a) * 0.02, vy: 0.2, vz: -Math.cos(a) * 0.02, w: 0.98, h: 0.98, fuse })
    this.emit({ t: 'snd', s: 'fuse', x: x + 0.5, y, z: z + 0.5 })
    this.afterRemove(x, y, z)
  }
  fireTick() {
    if (!this.fires.size) return
    const W = this.world, R = this.rng, due = []
    for (const [k, t] of this.fires) if (t <= this.ticks) { due.push(k); if (due.length >= 64) break }
    for (const k of due) {
      const [x, y, z] = k.split(',').map(Number)
      if (W.get(x, y, z) !== 81) { this.fires.delete(k); continue }
      if (!W.has(x >> 4, z >> 4)) continue
      const floor = BLOCKS[W.get(x, y - 1, z)].solid, fuel = this.enc(x, y, z) > 0
      const out = () => { W.set(x, y, z, 0); this.fires.delete(k) }
      let age = W.meta(x, y, z) & 15
      if (!floor && !fuel) { out(); continue }
      if (age < 15) { age = Math.min(15, age + (R() * 3 / 2 | 0)); W.set(x, y, z, 81, age) }
      if (!fuel) { if (!floor || age > 3) out(); else this.fires.set(k, this.ticks + 30 + (R() * 10 | 0)); continue }
      if (age === 15 && R() < 0.25 && !this.flam(x, y - 1, z)) { out(); continue }
      // burn the blocks round it
      for (const [dx, dy, dz] of N6) {
        const bx = x + dx, by = y + dy, bz = z + dz, f = this.flam(bx, by, bz)
        if (!f || R() * (dy ? 250 : 300) >= f) continue
        if (BLOCKS[W.get(bx, by, bz)].tnt) { this.prime(bx, by, bz); continue }
        W.set(bx, by, bz, 0); this.afterRemove(bx, by, bz)
        if (R() * (age + 10) < 5) this.setFire(bx, by, bz, age + (R() * 5 / 4 | 0))
      }
      // creep to the air round it beside something flammable
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 4; dy++) {
        if (!dx && !dy && !dz) continue
        const bx = x + dx, by = y + dy, bz = z + dz; if (W.get(bx, by, bz)) continue
        const e = this.enc(bx, by, bz); if (!e) continue
        const range = 100 + (dy > 1 ? (dy - 1) * 100 : 0), ch = (e + 40) / (age + 30)
        if (R() * range <= ch) this.setFire(bx, by, bz, age + (R() * 5 / 4 | 0))
      }
      if (W.get(x, y, z) === 81) this.fires.set(k, this.ticks + 30 + (R() * 10 | 0))
    }
  }
  // lava sets the air round it alight where something flammable is (MC's lava random tick)
  lavaTick(x, y, z) {
    const W = this.world, R = this.rng, n = R() * 3 | 0
    if (n > 0) {
      let px = x, py = y, pz = z
      for (let i = 0; i < n; i++) {
        px += (R() * 3 | 0) - 1; py++; pz += (R() * 3 | 0) - 1
        const b = W.get(px, py, pz)
        if (!b) { if (this.enc(px, py, pz)) { this.setFire(px, py, pz); return } }
        else if (BLOCKS[b].solid) return
      }
    } else for (let i = 0; i < 3; i++) {
      const px = x + (R() * 3 | 0) - 1, pz = z + (R() * 3 | 0) - 1
      if (!W.get(px, y + 1, pz) && this.flam(px, y, pz)) this.setFire(px, y + 1, pz)
    }
  }
  lavaTicks() {
    if (!this.lavas.size || this.ticks % 10) return
    const W = this.world
    let n = 0
    for (const k of this.lavas) {
      if (n++ > 300) break
      const [x, y, z] = k.split(',').map(Number)
      if (BLOCKS[W.get(x, y, z)].liquid !== 'lava') { this.lavas.delete(k); continue }
      if (this.rng() < 1 / 30) this.lavaTick(x, y, z)
    }
  }
  checkFall(x, y, z) {
    const W = this.world
    while (BLOCKS[W.get(x, y, z)].fall) {
      const below = BLOCKS[W.get(x, y - 1, z)]
      if (below.solid) return
      const id = W.get(x, y, z)
      W.set(x, y, z, 0)
      this.ents.push({ e: 'fall', id, x: x + 0.5, y, z: z + 0.5, vx: 0, vy: 0, vz: 0, w: 0.98, h: 0.98, age: 0 })
      y++
    }
  }
  // MC's primed TNT: its own fall (0.04 a tick, drag 0.98, x/z 0.7 and a half bounce on the ground), carried by water,
  // and the blast from just over its feet (y + height / 16) when the 80-tick fuse runs out
  tickTnt(e) {
    const W = this.world, b = BLOCKS[W.get(Math.floor(e.x), Math.floor(e.y + 0.1), Math.floor(e.z))]
    e.inWater = !!b && b.liquid === 'water'
    if (e.inWater) { const f = flowAt(W, Math.floor(e.x), Math.floor(e.y + 0.1), Math.floor(e.z)); if (f) { e.vx += f[0] * 0.014; e.vz += f[1] * 0.014 } }
    e.vy -= 0.04
    move(W, e, e.vx, e.vy, e.vz)
    e.vx *= 0.98; e.vy *= 0.98; e.vz *= 0.98
    if (e.onGround) { e.vx *= 0.7; e.vz *= 0.7; e.vy *= -0.5 }
    if (--e.fuse <= 0) { e.gone = true; this.explode(e.x, e.y + e.h / 16, e.z, 4, e) }
  }
  tickFalling(e) {
    e.age++
    e.vy = (e.vy - 0.04) * 0.98
    move(this.world, e, 0, e.vy, 0)
    if (e.onGround || e.age > 600) {
      e.gone = true
      const x = Math.floor(e.x), y = Math.floor(e.y + 0.5), z = Math.floor(e.z)
      if (BLOCKS[this.world.get(x, y, z)].rep) { this.world.set(x, y, z, e.id); this.emit({ t: 'place', id: e.id, x, y, z, quiet: true }) }
      else this.dropItem({ id: e.id, n: 1, d: 0 }, e.x, e.y, e.z)
    }
  }

  attackMob(m) {
    const P = this.player, h = P.inv[P.sel], M = melee(h ? h.id : 0)
    const cd = Math.min(1, P.atkT / (20 / M.speed)), crit = !P.onGround && P.vy < 0 && cd > 0.9 && !P.inWater
    let dmg = M.dmg * (0.2 + cd * cd * 0.8) * (crit ? 1.5 : 1)
    P.atkT = 0
    P.exh += 0.1
    const kb = (P.sprint && cd > 0.9 ? 1 : 0) + 0.5
    this.hurtMob(m, dmg, P, kb)
    if (crit) this.emit({ t: 'crit', x: m.x, y: m.y + m.h * 0.7, z: m.z })
    if (h && ITEMS[h.id] && ITEMS[h.id].tool) this.wear(ITEMS[h.id].tool === 'sword' ? 1 : 2)
    if (P.sprint) P.sprint = false
  }
  hurtMob(m, dmg, by, kb = 0.4) {
    if (m.death || m.hurt > 0) return
    const M = MOBS[m.type]
    if (M.armor) dmg *= 1 - M.armor * 0.04
    m.hp -= dmg; m.hurt = 10
    this.emit({ t: 'splat', id: m.id, n: Math.max(0, Math.round(dmg)) })                   // (the client's RS hitsplat)
    this.emit({ t: 'snd', s: 'hurt_' + m.type, x: m.x, y: m.y, z: m.z })
    if (by) {
      const dx = m.x - by.x, dz = m.z - by.z, L = Math.hypot(dx, dz) || 1
      const r = 1 - (M.kbr || 0); m.vx = dx / L * kb * r; m.vz = dz / L * kb * r; if (r > 0) m.vy = 0.36 * r
      if (!M.hostile && !M.villager) m.panic = 80
      if (m.type === 'spider' || M.aggro !== undefined || M.villager) m.angry = true
    }
    if (m.hp <= 0) {
      m.death = 1
      if (m.spawn) this.respawns.push([this.ticks + 600, m.spawn])                        // (RS: it comes back in half a minute)
      this.emit({ t: 'snd', s: 'death_' + m.type, x: m.x, y: m.y, z: m.z })
      if (by === this.player || (by && by.by === 'player')) {
        const R = this.rng, burnt = m.fire > 0
        for (const [id, a, b] of M.drops) { const n = a + Math.floor(R() * (b - a + 1)); if (n > 0) this.dropItem({ id: burnt && M.cooked && id === M.drops[0][0] ? M.cooked : id, n, d: 0 }, m.x, m.y + 0.5, m.z) }
        if (m.type === 'sheep' && m.wool === false) {}
        const [x0, x1] = M.xp; this.dropXp(x0 + Math.floor(R() * (x1 - x0 + 1)), m.x, m.y + 0.5, m.z)
        if (M.hostile) this.emit({ t: 'killHostile' })
      }
    }
  }
  // a hit on the player (MC: armour points cut damage, 10 ticks of invulnerability, knockback)
  hurtPlayer(dmg, src, why = 'mob') {
    const P = this.player
    if (this.mode === 'creative' && why !== 'void') return
    if (P.dead || (P.invul > 0 && why !== 'void')) return
    let pts = 0, tough = 0
    if (why === 'mob' || why === 'arrow' || why === 'boom') for (const a of P.armor) if (a && ITEMS[a.id] && ITEMS[a.id].armor !== undefined) { pts += ITEMS[a.id].pts; tough += ITEMS[a.id].tough }
    if (pts) {
      dmg *= 1 - Math.min(20, Math.max(pts / 5, pts - dmg / (2 + tough / 4))) / 25
      for (let i = 0; i < 4; i++) { const a = P.armor[i]; if (!a) continue; a.d = (a.d || 0) + Math.max(1, Math.floor(dmg / 4)); if (a.d >= ITEMS[a.id].dur) { P.armor[i] = null; this.emit({ t: 'snd', s: 'break_tool' }) } }
    }
    P.hp -= dmg; P.invul = 10; P.hurtT = 10; P.exh += 0.1
    P.lastHurt = { why, by: src && src.type }
    this.emit({ t: 'hurt', why })
    if (src) { const dx = P.x - src.x, dz = P.z - src.z, L = Math.hypot(dx, dz) || 1; P.vx = dx / L * 0.4; P.vz = dz / L * 0.4; P.vy = 0.36 }
    if (P.hp <= 0) this.die()
  }
  die() {
    const P = this.player
    P.hp = 0; P.dead = true; P.dig = null; P.eat = 0; P.bowT = 0
    const by = P.lastHurt || {}, mob = by.by && MOBS[by.by] ? MOBS[by.by].n : null
    const msg = {
      fall: 'fell from a high place', drown: 'drowned', lava: 'tried to swim in lava', fire: 'burned to death', starve: 'starved to death',
      cactus: 'was pricked to death', void: 'fell out of the world', boom: mob ? 'was blown up by ' + mob : 'blew up',
      arrow: 'was shot by ' + (mob || 'Skeleton'), mob: 'was slain by ' + (mob || 'something'),
    }[by.why] || 'died'
    for (const arr of [P.inv, P.armor, P.craft2]) for (let i = 0; i < arr.length; i++) if (arr[i]) { this.dropItem(arr[i], P.x, P.y + 1, P.z); arr[i] = null }
    if (P.off) { this.dropItem(P.off, P.x, P.y + 1, P.z); P.off = null }
    this.dropXp(Math.min(100, P.lvl * 7), P.x, P.y + 0.5, P.z)
    this.emit({ t: 'death', msg: this.name + ' ' + msg, score: P.score })
    this.chat(this.name + ' ' + msg)
  }
  respawn() {
    const P = this.player, s = P.bed && this.world.get(P.bed[0], P.bed[1], P.bed[2]) === 40 ? [P.bed[0] + 0.5, P.bed[1] + 0.6, P.bed[2] + 0.5] : this.spawn
    if (P.bed && s === this.spawn) { this.chat('You have no home bed or charged respawn anchor, or it was obstructed'); P.bed = null }
    Object.assign(P, { x: s[0], y: s[1], z: s[2], vx: 0, vy: 0, vz: 0, hp: 20, food: 20, sat: 5, exh: 0, air: 300, xp: 0, lvl: 0, score: 0, dead: false, fire: 0, fall: 0, invul: 60 })
  }
  sleep(t) {
    const P = this.player, dt = this.dayTime
    if (Math.hypot(t.x + 0.5 - P.x, t.z + 0.5 - P.z) > 3) return this.chat('You may not rest now; the bed is too far away')
    P.bed = [t.x, t.y, t.z]
    if (!(dt > 12541 && dt < 23458)) { this.chat('Respawn point set'); return this.onEvent('sleep') }
    if (this.ents.some(m => m.e === 'mob' && MOBS[m.type].hostile && !m.death && Math.abs(m.x - P.x) < 8 && Math.abs(m.y - P.y) < 5 && Math.abs(m.z - P.z) < 8)) return this.chat('You may not rest now; there are monsters nearby')
    this.emit({ t: 'sleep' })
    this.time += DAY - dt
    this.chat('Respawn point set')
  }
  shoot(m, tx, ty, tz) {
    const o = [m.x, m.y + 1.5, m.z], dx = tx - o[0], dz = tz - o[2], d = Math.hypot(dx, dz), dy = ty - o[1] + d * 0.2, L = Math.hypot(dx, dy, dz), R = this.rng
    const v = 1.6, sp = 0.07 * (R() - 0.5) * 2
    this.ents.push({ e: 'arrow', x: o[0], y: o[1], z: o[2], vx: dx / L * v + sp, vy: dy / L * v + sp, vz: dz / L * v + sp, w: 0.5, h: 0.5, by: 'mob', src: m, age: 0 })
    this.emit({ t: 'snd', s: 'bow', x: m.x, y: m.y, z: m.z })
  }
  tickArrow(a) {
    a.age++
    if (a.stuck) { if (a.age > 1200) a.gone = true; if (a.by === 'player' && this.near(a, 1.5) && !this.player.dead) { if (this.mode === 'creative' || !give(this.player.inv, { id: 280, n: 1, d: 0 })) { a.gone = true; this.emit({ t: 'pickup' }) } } return }
    const W = this.world, sp = Math.hypot(a.vx, a.vy, a.vz)
    // hit a body?
    const o = [a.x, a.y, a.z], d = [a.vx / sp, a.vy / sp, a.vz / sp]
    const P = this.player
    const targets = a.by === 'player' ? this.ents.filter(m => m.e === 'mob' && !m.death) : [P]
    for (const m of targets) {
      if (m === P && (P.dead || a.age < 2)) continue
      const bb = aabb(m), h = rayBox(o, d, [bb[0] - 0.15, bb[1] - 0.15, bb[2] - 0.15, bb[3] + 0.15, bb[4] + 0.15, bb[5] + 0.15])
      if (h && h.t <= sp) {
        const dmg = Math.ceil(sp * 2 * (a.crit ? 1.5 : 1))
        if (m === P) this.hurtPlayer(a.by === 'mob' ? Math.min(dmg, 4) : dmg, a.src || null, 'arrow')
        else { this.hurtMob(m, dmg, { x: a.x, z: a.z, by: 'player' }, 0.3); this.emit({ t: 'arrowHit' }) }
        a.gone = true; return
      }
    }
    const hit = raycast(W, o, d, sp, (id) => BLOCKS[id].solid)
    if (hit) { a.x = hit.hit[0] - d[0] * 0.05; a.y = hit.hit[1] - d[1] * 0.05; a.z = hit.hit[2] - d[2] * 0.05; a.stuck = true; a.age = 0; this.emit({ t: 'snd', s: 'arrow_hit', x: a.x, y: a.y, z: a.z }); return }
    a.x += a.vx; a.y += a.vy; a.z += a.vz
    a.vx *= 0.99; a.vy = a.vy * 0.99 - 0.05; a.vz *= 0.99
    if (a.age > 400) a.gone = true
  }
  // MC's explosion: rays out from the middle, each worn down by the blast resistance of what it crosses (stone holds,
  // obsidian and bedrock stop it, water swallows it: TNT in water breaks nothing); what a ray still has power for goes
  explode(x, y, z, r, src) {
    const W = this.world, R = this.rng, crea = this.mode === 'creative'
    this.emit({ t: 'boom', x, y, z, r })
    const hit = new Map()
    if (!(src && src.inWater)) for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) for (let k = 0; k < 16; k++) {   // (MC: TNT in water breaks nothing)
      if (i && i < 15 && j && j < 15 && k && k < 15) continue
      let dx = i / 7.5 - 1, dy = j / 7.5 - 1, dz = k / 7.5 - 1; const L = Math.hypot(dx, dy, dz); dx /= L; dy /= L; dz /= L
      let f = r * (0.7 + R() * 0.6), px = x, py = y, pz = z
      while (f > 0) {
        const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz), id = W.get(bx, by, bz)
        if (id) { f -= (resist(id) + 0.3) * 0.3; if (f > 0 && !BLOCKS[id].liquid) hit.set(bx + ',' + by + ',' + bz, id) }
        px += dx * 0.3; py += dy * 0.3; pz += dz * 0.3; f -= 0.225
      }
    }
    // MC's damage + knockback: impact = (1 - dist / 2r) * how much of the body the blast can see
    const seen = (e) => { let n = 0, c = 0; for (let a = 0; a <= 1; a += 0.5) for (let b = 0; b <= 1; b += 0.5) for (let d = 0; d <= 1; d += 0.5) {
      c++; const tx = e.x - e.w / 2 + e.w * a, ty = e.y + e.h * b, tz = e.z - e.w / 2 + e.w * d, o = [x, y, z], v = [tx - x, ty - y, tz - z], L = Math.hypot(...v) || 1
      if (!raycast(W, o, v.map(q => q / L), L, (id) => BLOCKS[id].solid && BLOCKS[id].op)) n++ } return n / c }
    const knock = (e, isP) => {
      const d = Math.hypot(e.x - x, e.y + (e.h || 0.5) / 2 - y, e.z - z)
      if (d > r * 2) return
      const imp = (1 - d / (r * 2)) * (e.e === 'tnt' ? 1 : seen(e)), L = d || 1, kr = e.e === 'mob' && MOBS[e.type] ? 1 - (MOBS[e.type].kbr || 0) : 1
      e.vx += (e.x - x) / L * imp * kr; e.vy += ((e.y + (e.h || 0.5) / 2 - y) / L * imp + 0.1 * imp) * kr; e.vz += (e.z - z) / L * imp * kr
      const dmg = (imp * imp + imp) / 2 * 7 * r * 2 + 1
      if (isP) { if (imp > 0) this.hurtPlayer(dmg, src && src.type ? src : null, 'boom') }
      else if (e.e === 'mob') { if (imp > 0) this.hurtMob(e, dmg, null) }
      else if (e.e === 'item' || e.e === 'xp') { if (imp > 0.3) e.gone = true }             // (MC: a blast destroys the items it catches)
    }
    knock(this.player, true)
    for (const m of this.ents) if (m !== src && !m.death && m.e !== 'arrow') knock(m, false)
    for (const [key, id] of hit) {
      const [bx, by, bz] = key.split(',').map(Number)
      if (W.get(bx, by, bz) !== id) continue
      if (BLOCKS[id].tnt) { this.prime(bx, by, bz, 10 + (R() * 20 | 0)); continue }      // (MC: a short fuse from a blast)
      if (this.chests.has(key)) { this.breakBlock(bx, by, bz, true); continue }
      W.set(bx, by, bz, 0)
      if (!crea && R() < 1 / r) for (const [did, n] of dropsOf(id, R, true)) this.dropItem({ id: did, n, d: 0 }, bx + 0.5, by + 0.5, bz + 0.5)
    }
    for (const key of hit.keys()) { const [bx, by, bz] = key.split(',').map(Number); if (!W.get(bx, by, bz)) this.afterRemove(bx, by, bz) }
  }

  tickItem(e) {
    const W = this.world
    e.age++
    if (e.age > 6000) { e.gone = true; return }
    const id = W.get(Math.floor(e.x), Math.floor(e.y + 0.1), Math.floor(e.z))
    if (BLOCKS[id] && (BLOCKS[id].liquid === 'lava' || BLOCKS[id].fire)) { e.gone = true; this.emit({ t: 'snd', s: 'fizz', x: e.x, y: e.y, z: e.z }); return }
    if (BLOCKS[id] && BLOCKS[id].liquid === 'water') { e.vy += 0.05; const f = flowAt(W, Math.floor(e.x), Math.floor(e.y + 0.1), Math.floor(e.z)); if (f) { e.vx += f[0] * 0.014; e.vz += f[1] * 0.014 } }   // (MC: items ride the current)
    // pushed out of a block it's stuck in
    if (BLOCKS[id] && BLOCKS[id].solid && BLOCKS[id].shape === 'cube') e.vy = 0.2
    e.vy -= 0.04
    move(W, e, e.vx, e.vy, e.vz)
    e.vx *= e.onGround ? 0.6 * 0.98 : 0.98; e.vz *= e.onGround ? 0.6 * 0.98 : 0.98; e.vy *= 0.98
    if (e.onGround) e.vy *= -0.5
    if (e.age % 10 === 0) for (const o of this.ents) {
      if (o === e || o.e !== 'item' || o.gone || !same(o.st, e.st)) continue
      if (Math.abs(o.x - e.x) < 1 && Math.abs(o.y - e.y) < 0.5 && Math.abs(o.z - e.z) < 1 && o.st.n + e.st.n <= maxStack(e.st.id)) { e.st.n += o.st.n; o.gone = true }
    }
  }
  tickOrb(e) {
    const P = this.player, W = this.world
    e.age++
    if (e.age > 6000) { e.gone = true; return }
    const dx = P.x - e.x, dy = P.y + 0.9 - e.y, dz = P.z - e.z, d = Math.hypot(dx, dy, dz)
    if (d < 8 && !P.dead) { const k = (1 - d / 8) ** 2 * 0.1; e.vx += dx / d * k; e.vy += dy / d * k; e.vz += dz / d * k }
    e.vy -= 0.03
    move(W, e, e.vx, e.vy, e.vz)
    e.vx *= 0.98; e.vy *= 0.98; e.vz *= 0.98
    if (e.onGround) { e.vx *= 0.6; e.vz *= 0.6; e.vy *= -0.9 }
    if (d < 1.3 && !P.dead && (P.orbCd || 0) <= this.ticks) { P.orbCd = this.ticks + 2; this.addXp(e.v); e.gone = true; this.emit({ t: 'orb' }) }
  }
  near(e, r) { const P = this.player; return Math.abs(P.x - e.x) < r + 0.3 && Math.abs(P.y + 0.9 - e.y) < r + 0.5 && Math.abs(P.z - e.z) < r + 0.3 }
  pickups() {
    const P = this.player
    for (const e of this.ents) {
      if (e.e !== 'item' || e.gone || e.age < e.delay || !this.near(e, 1)) continue
      const n0 = e.st.n, left = give(P.inv, e.st)
      if (left < n0) { this.emit({ t: 'pickup', id: e.st.id, x: e.x, y: e.y, z: e.z }); this.emit({ t: 'got', id: e.st.id }) }
      if (!left) e.gone = true; else e.st.n = left
    }
  }

  // ------------------------------------------------------------------------ furnaces + chests
  furnace(key) { let f = this.furnaces.get(key); if (!f) this.furnaces.set(key, f = { s: [null, null, null], burn: 0, burnMax: 0, cook: 0, xp: 0 }); return f }
  chest(key) { let c = this.chests.get(key); if (!c) this.chests.set(key, c = Array(27).fill(null)); return c }
  furnaceXp(f) { if (f && f.xp >= 1) { const n = Math.floor(f.xp); f.xp -= n; this.addXp(n) } }
  tickFurnace(key, f) {
    const [i, fu, o] = f.s, out = i && SMELT[i.id]
    const can = !!out && (!o || (o.id === out && o.n < maxStack(out)))
    const was = f.burn > 0
    if (f.burn > 0) f.burn--
    if (f.burn === 0 && can && fu && fuelOf(fu.id)) {
      f.burn = f.burnMax = fuelOf(fu.id)
      fu.n--; if (!fu.n) f.s[1] = fu.id === 287 ? { id: 282, n: 1, d: 0 } : null
    }
    if (f.burn > 0 && can) {
      if (++f.cook >= COOK_TICKS) {
        f.cook = 0
        i.n--; if (!i.n) f.s[0] = null
        if (o) o.n++; else f.s[2] = { id: out, n: 1, d: 0 }
        f.xp += SMELT_XP[i.id] || 0.1
      }
    } else f.cook = Math.max(0, f.cook - 2)
    if (was !== f.burn > 0) {
      const [x, y, z] = key.split(',').map(Number), id = this.world.get(x, y, z)
      if (id === 25 || id === 26) this.world.set(x, y, z, f.burn > 0 ? 26 : 25, this.world.meta(x, y, z))
    }
  }

  // ------------------------------------------------------------------------ the living world
  randomTicks() {
    const P = this.player, W = this.world, R = this.rng
    const pcx = Math.floor(P.x) >> 4, pcz = Math.floor(P.z) >> 4
    for (let a = -4; a <= 4; a++) for (let c = -4; c <= 4; c++) {
      const cx = pcx + a, cz = pcz + c
      if (!W.has(cx, cz)) continue
      const ch = W.chunk(cx, cz)
      for (let k = 0; k < 3; k++) {
        const x = cx * CS + (R() * 16 | 0), z = cz * CS + (R() * 16 | 0), y = 30 + (R() * Math.max(1, ch.top - 30) | 0)
        const id = W.get(x, y, z), d = BLOCKS[id]
        if (d.crop !== undefined && d.crop < 3) { const wet = this.nearWater(x, y - 1, z); if (R() < (wet ? 0.35 : 0.15)) W.set(x, y, z, id + 1) }
        else if (d.sapling && R() < 0.15) this.growTree(x, y, z, d.sapling)
        else if (W.keep && (id === 1 || id === 2) && W.keep(x, y, z)) continue      // (the RS map's own ground stays as drawn)
        else if (id === 2 && !BLOCKS[W.get(x, y + 1, z)].opac) {
          for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [1, 1, 0], [0, -1, 1]]) if (W.get(x + dx, y + dy, z + dz) === 1) { W.set(x, y, z, 1); break }
        } else if (id === 1 && BLOCKS[W.get(x, y + 1, z)].op) W.set(x, y, z, 2)
        else if (id === 45 && BLOCKS[W.get(x, y + 1, z)].crop === undefined && R() < 0.05 && !this.nearWater(x, y, z)) W.set(x, y, z, 2)
      }
    }
  }
  nearWater(x, y, z) { const W = this.world; for (let a = -4; a <= 4; a++) for (let c = -4; c <= 4; c++) if (W.get(x + a, y, z + c) === 8) return true; return false }
  growTree(x, y, z, log) {
    const W = this.world, R = this.rng, h = 4 + (R() * 3 | 0), lv = log === 46 ? 47 : 12
    for (let k = 1; k <= h + 1; k++) if (!BLOCKS[W.get(x, y + k, z)].rep && !BLOCKS[W.get(x, y + k, z)].leaves) return
    const t = y + h - 1
    for (let yy = t - 2; yy <= t + 1; yy++) {
      const rad = yy >= t ? 1 : 2
      for (let a = -rad; a <= rad; a++) for (let c = -rad; c <= rad; c++) {
        if (Math.abs(a) === rad && Math.abs(c) === rad && (yy === t + 1 || R() < 0.5)) continue
        if (BLOCKS[W.get(x + a, yy, z + c)].rep) W.set(x + a, yy, z + c, lv)
      }
    }
    for (let k = 0; k < h; k++) W.set(x, y + k, z, log)
  }
  // mobs: herds + villagers the first time the player comes near a chunk; monsters in the dark every second
  spawnTick() {
    const P = this.player, W = this.world, R = this.rng
    const pcx = Math.floor(P.x) >> 4, pcz = Math.floor(P.z) >> 4
    for (let a = -3; a <= 3; a++) for (let c = -3; c <= 3; c++) {
      const cx = pcx + a, cz = pcz + c, k = cx + ',' + cz
      if (this.populated.has(k) || !W.has(cx, cz)) continue
      this.populated.add(k)
      this.populate(cx, cz)
    }
    for (let i = this.respawns.length - 1; i >= 0; i--) if (this.respawns[i][0] <= this.ticks) { this.spawnRS(this.respawns[i][1]); this.respawns.splice(i, 1) }
    if (this.mode === 'creative' && !this.monstersInCreative) return
    let hostile = 0
    for (const m of this.ents) if (m.e === 'mob' && MOBS[m.type].hostile && !m.home) {
      hostile++
      const d = Math.hypot(m.x - P.x, m.z - P.z)
      if (d > 48 && R() < 0.02) m.gone = true
    }
    if (hostile >= 18 || P.dead) return
    for (let k = 0; k < 4; k++) {
      const ang = R() * Math.PI * 2, dist = 20 + R() * 28
      const x = Math.floor(P.x + Math.cos(ang) * dist), z = Math.floor(P.z + Math.sin(ang) * dist)
      if (!W.has(x >> 4, z >> 4)) continue
      const tt = W.tile(x, z); if (tt >= 0 && (W.fl[tt] & 116 || W.ed[tt] & 3)) continue     // (not on RS trees, rocks, objects or indoors)
      const top = W.top(x, z, true)
      let y = -1
      const surf = BLOCKS[W.get(x, top, z)]
      if (this.daylight() < 0.35 && surf.solid && !surf.liquid && W.get(x, top, z) !== 32 && !W.get(x, top + 1, z) && !W.get(x, top + 2, z)) y = top + 1
      else {     // a dark cave spot: air, solid under, no sky, no torch near
        const cy = 6 + (R() * Math.max(1, top - 12) | 0)
        if (!W.get(x, cy, z) && !W.get(x, cy + 1, z) && BLOCKS[W.get(x, cy - 1, z)].solid && BLOCKS[W.get(x, cy - 1, z)].op && !this.skyAt(x, cy, z) && !this.torchNear(x, cy, z, 11)) y = cy
      }
      if (y < 0 || Math.hypot(x - this.spawn[0], z - this.spawn[2]) < 12 && !this.isNight()) continue
      if (this.torchNear(x, y, z, 9)) continue
      const r = R(), type = r < 0.4 ? 'zombie' : r < 0.7 ? 'skeleton' : 'spider'   // (RS's undead and giant spiders; no RS creeper)
      this.ents.push(makeMob(type, x + 0.5, y, z + 0.5, R))
    }
  }
  skyAt(x, y, z) { const W = this.world; for (let yy = y + 1; yy < WH; yy++) if (BLOCKS[W.get(x, yy, z)].opac) return false; return true }
  torchNear(x, y, z, r) {
    for (const k of this.torches) { const [a, b, c] = k.split(',').map(Number); if (Math.abs(a - x) + Math.abs(b - y) + Math.abs(c - z) < r) return true }
    // glowstone-like blocks: lit furnaces, jack o'lanterns, lava near are light too
    return false
  }
  spawnRS(sp, R = this.rng) {
    const [X0, tz, kind] = sp, Z0 = -tz - 1, W = this.world, S = RS_SPAWN[kind]
    if (!S) return
    const X = X0, Z = Z0, y = this.standY(X, Z)
    const m = makeMob(S[0], X + 0.5, y, Z + 0.5, R, { ...(S[1] || {}), home: [X + 0.5, Z + 0.5], spawn: sp })
    this.ents.push(m)
    return m
  }
  // where something stands on a tile: on top of the ground (not on the RS tree/rock/object sharing it)
  standY(X, Z) { const W = this.world, t = W.tile(X, Z); if (t >= 0 && !(W.fl[t] & 128)) { let y = W.gy[t] + 1; while (y < 120 && BLOCKS[W.get(X, y, Z)].solid) y++; return y } return W.top(X, Z, true) + 1 }
  populate(cx, cz) {
    const W = this.world, R = rngOf(Math.imul(cx, 7919) ^ Math.imul(cz, 104729) ^ 77)
    // the RS map's NPCs at their RS spawns (cows in the cow field, goblins over the river...)
    const j = W.json
    for (const sp of j.npcs || []) {
      const [tx, tz] = sp, X = tx, Z = -tz - 1
      if (X >> 4 !== cx || Z >> 4 !== cz) continue
      this.spawnRS(sp, R)
    }
    // more townsfolk where there are houses
    let roofed = 0, open = []
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const X = cx * 16 + lx, Z = cz * 16 + lz, t = W.tile(X, Z)
      if (t < 0) continue
      if (W.ru[t]) roofed++
      else if (!W.fl[t] && W.sf[t] !== 8) open.push([X, Z, W.sf[t]])
    }
    if (roofed > 24 && open.length && R() < 0.55) {
      const [X, Z] = open[(R() * open.length) | 0]
      const kind = FOLK_KINDS[(R() * FOLK_KINDS.length) | 0]
      this.ents.push(makeMob('villager', X + 0.5, this.standY(X, Z), Z + 0.5, R, { kind }))
    }
    // a herd on open grass
    const grass = open.filter(o => o[2] === 1)
    if (grass.length > 120 && R() < 0.06) {
      const type = ['cow', 'chicken', 'cow'][(R() * 3) | 0], n = 2 + (R() * 3 | 0)
      for (let i = 0; i < n; i++) { const [X, Z] = grass[(R() * grass.length) | 0]; this.ents.push(makeMob(type, X + 0.5, this.standY(X, Z), Z + 0.5, R)) }
    }
  }

  checkAdv() {
    const P = this.player
    const have = new Set(); for (const s of [...P.inv, ...P.armor, P.off, P.cursor]) if (s) have.add(s.id)
    const worn = new Set(P.armor.filter(Boolean).map(s => s.id))
    for (const a of ADV) {
      if (this.adv[a.id]) continue
      if ((a.has && a.has.some(id => have.has(id))) || (a.worn && a.worn.some(id => worn.has(id))) || (a.place && P.place === a.place)) this.award(a)
    }
  }
  onEvent(ev) { for (const a of ADV) if (!this.adv[a.id] && a.ev === ev) this.award(a) }
  award(a) {
    this.adv[a.id] = this.ticks
    this.emit({ t: 'toast', a })
    this.chat(this.name + ' has made the advancement §a[' + a.n + ']')
  }
  drainEvents() { const ev = this.events; this.events = []; return ev }

  // chat commands (MC's)
  command(s) {
    const a = s.trim().split(/\s+/), P = this.player
    const c = a[0].toLowerCase()
    if (c === '/time') { const v = { day: 1000, noon: 6000, night: 13000, midnight: 18000 }[a[2]] ?? +a[2]; if (a[1] === 'set' && isFinite(v)) { this.time = Math.floor(this.time / DAY) * DAY + v; return 'Set the time to ' + v } return 'Usage: /time set <day|night|noon|midnight|ticks>' }
    if (c === '/gamemode') { const m = { s: 'survival', c: 'creative', 0: 'survival', 1: 'creative', survival: 'survival', creative: 'creative' }[a[1]]; if (!m) return 'Usage: /gamemode <survival|creative>'; this.mode = m; P.flying = false; return 'Set own game mode to ' + m[0].toUpperCase() + m.slice(1) + ' Mode' }
    if (c === '/give') { const id = +a[1], n = +(a[2] || 1); if (!def(id)) return 'Unknown item'; give(P.inv, { id, n, d: 0 }); return 'Gave ' + n + ' [' + nameOf(id) + '] to ' + this.name }
    if (c === '/tp') { const x = +a[1], y = +a[2], z = +a[3]; if ([x, y, z].some(v => !isFinite(v))) return 'Usage: /tp <x> <y> <z>'; Object.assign(P, { x, y, z, vx: 0, vy: 0, vz: 0, fall: 0 }); return 'Teleported ' + this.name + ' to ' + x + ', ' + y + ', ' + z }
    if (c === '/kill') { this.hurtPlayer(1000, null, 'void'); return '' }
    if (c === '/spawnpoint') { this.spawn = [P.x, P.y, P.z]; return 'Set spawn point' }
    if (c === '/summon') { const al = MOBS[a[1]] ? null : RS_SPAWN[a[1]], type = al ? al[0] : a[1]; if (!MOBS[type]) return 'Unknown entity: ' + a[1]; this.ents.push(makeMob(type, P.x - Math.sin(P.yaw) * 3, P.y, P.z - Math.cos(P.yaw) * 3, this.rng, a[2] ? { kind: a[2] } : al && al[1] ? { ...al[1] } : {})); return 'Summoned new ' + (al && al[1] ? a[1][0].toUpperCase() + a[1].slice(1) : MOBS[type].n) }   // RS names too: /summon man, guard, dwarf
    if (c === '/help') return 'Commands: /time set day|night, /gamemode survival|creative, /give <id> [n], /tp x y z, /summon <mob>, /kill, /spawnpoint'
    return 'Unknown command. Type "/help" for help.'
  }

  // ------------------------------------------------------------------------ saving
  save() {
    const P = this.player
    const keep = (m) => m.e === 'mob' && !m.death && !MOBS[m.type].hostile
    return {
      v: 1, time: this.time, mode: this.mode, name: this.name, spawn: this.spawn, adv: this.adv,
      player: Object.fromEntries(Object.entries(P).filter(([k]) => !['dig', 'cursor'].includes(k))),
      edits: this.world.saveEdits(), furnaces: [...this.furnaces], chests: [...this.chests], populated: [...this.populated],
      mobs: this.ents.filter(keep).map(m => ({ type: m.type, x: m.x, y: m.y, z: m.z, yaw: m.yaw, hp: m.hp, kind: m.kind, name: m.name, trades: m.trades, home: m.home, wool: m.wool })),
    }
  }
  load(s) {
    this.time = s.time; this.mode = s.mode || 'survival'; this.name = s.name || this.name; this.spawn = s.spawn || this.spawn; this.adv = s.adv || {}
    this.world.loadEdits(s.edits || {})
    Object.assign(this.player, s.player, { dig: null, cursor: null, eat: 0, bowT: 0 })
    this.furnaces = new Map(s.furnaces || []); this.chests = new Map(s.chests || []); this.populated = new Set(s.populated || [])
    this.ents = (s.mobs || []).map(m => makeMob(m.type, m.x, m.y, m.z, this.rng, m))
    this.torches.clear(); this.fires.clear(); this.lavas.clear(); this.flow.clear()
    for (const k in s.edits || {}) { const a = s.edits[k]; const [cx, cz] = k.split(',').map(Number); for (let i = 0; i < a.length; i += 2) {
      const id = a[i + 1] & 255, ci0 = a[i], y = ci0 % WH, col = (ci0 - y) / WH, x = cx * 16 + (col & 15), z = cz * 16 + (col >> 4), key = x + ',' + y + ',' + z
      if (id === 28) this.torches.add(key)
      else if (id === 81) this.fires.set(key, 1)                                   // (fires burn on, liquids run on, after a load)
      else if (id === 8 || id === 9) { if (id === 9) this.lavas.add(key); if (a[i + 1] >> 8) this.flow.set(key, 1) }
    } }
  }
}
// MC's celestial angle (0 at noon... as MC: time 6000 = noon)
export function celestial(t) {
  let f = ((t % DAY) / DAY) - 0.25
  if (f < 0) f += 1; if (f > 1) f -= 1
  const g = f
  f = 1 - ((Math.cos(f * Math.PI) + 1) / 2)
  return g + (f - g) / 3
}
export { World }
