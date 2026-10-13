// Mobs as Minecraft's: cows, pigs, sheep and chickens wander (and panic when hit, follow wheat), zombies and spiders
// chase, skeletons keep their distance and shoot, creepers creep up and blow. Villagers are RS townsfolk (Hans, the
// Lumbridge guards, Doric, Peksa...) with Minecraft professions to trade emeralds with. Pure.
import { tickMove, raycast } from './phys.js'
import { BLOCKS } from './blocks.js'

// w/h: hitbox; hp; sp: walk speed (x player walk); dmg: melee; xp; drops: [id, min, max]; hostile
export const MOBS = {
  cow: { n: 'Cow', w: 0.9, h: 1.4, hp: 10, sp: 0.45, xp: [1, 3], drops: [[268, 1, 3], [279, 0, 2]], cooked: 269, food: [266] },
  pig: { n: 'Pig', w: 0.9, h: 0.9, hp: 10, sp: 0.45, xp: [1, 3], drops: [[270, 1, 3]], cooked: 271, food: [266, 267] },
  sheep: { n: 'Sheep', w: 0.9, h: 1.3, hp: 8, sp: 0.45, xp: [1, 3], drops: [[39, 1, 1], [285, 1, 2]], cooked: 286, food: [266] },
  chicken: { n: 'Chicken', w: 0.4, h: 0.7, hp: 4, sp: 0.4, xp: [1, 3], drops: [[272, 1, 1], [278, 0, 2]], cooked: 273, food: [267] },
  zombie: { n: 'Zombie', w: 0.6, h: 1.95, hp: 20, sp: 0.55, dmg: 3, xp: [5, 5], drops: [[274, 0, 2]], hostile: true, burns: true, armor: 2 },
  skeleton: { n: 'Skeleton', w: 0.6, h: 1.99, hp: 20, sp: 0.6, xp: [5, 5], drops: [[275, 0, 2], [280, 0, 2]], hostile: true, burns: true, ranged: true },
  creeper: { n: 'Creeper', w: 0.6, h: 1.7, hp: 20, sp: 0.6, xp: [5, 5], drops: [[277, 0, 2]], hostile: true, creeper: true },
  spider: { n: 'Spider', w: 1.4, h: 0.9, hp: 16, sp: 0.75, dmg: 2, xp: [5, 5], drops: [[276, 0, 2]], hostile: true, climbs: true },
  villager: { n: 'Villager', w: 0.6, h: 1.95, hp: 20, sp: 0.4, xp: [0, 0], drops: [], villager: true },
}
// RS townsfolk: names + their MC profession's trades ([buy id, n], [sell id, n], max uses)
export const FOLK = {
  man: { names: ['Hans', 'Gee', 'Donie', 'Bob', 'Thessalia'], job: 'Fisherman', trades: [[[276, 20], [261, 1], 16], [[261, 1], [326, 6], 16], [[257, 10], [261, 1], 16], [[261, 2], [281, 1], 6]] },
  woman: { names: ['Gillie Groats', 'Aggie', 'Wyson', 'Romily', 'Baraek'], job: 'Shepherd', trades: [[[39, 18], [261, 1], 16], [[261, 1], [39, 1], 16], [[261, 3], [40, 1], 12]] },
  farmer: { names: ['Fred the Farmer', 'Farmer Brumty', 'Seth Groats', 'Millie Miller'], job: 'Farmer', trades: [[[266, 20], [261, 1], 16], [[261, 1], [265, 6], 16], [[61, 6], [261, 1], 12], [[261, 1], [264, 4], 16], [[261, 1], [329, 1], 12]] },
  guard: { names: ['Lumbridge Guard', 'Varrock Guard', 'Falador Guard', 'Sir Prysin'], job: 'Armorer', trades: [[[257, 15], [261, 1], 16], [[261, 5], [334, 1], 12], [[261, 9], [335, 1], 12], [[261, 7], [336, 1], 12], [[261, 4], [337, 1], 12], [[261, 30], [347, 1], 3]] },
  dwarf: { names: ['Doric', 'Thurgo', 'Nurmof', 'Hamal'], job: 'Toolsmith', trades: [[[257, 15], [261, 1], 16], [[261, 1], [308, 1], 12], [[261, 3], [312, 1], 12], [[261, 13], [322, 1], 3], [[261, 32], [352, 1], 2]] },
  barbarian: { names: ['Peksa', 'Gunthor', 'Haakon', 'Hunding'], job: 'Weaponsmith', trades: [[[257, 15], [261, 1], 16], [[261, 3], [313, 1], 12], [[261, 7], [310, 1], 12], [[261, 14], [320, 1], 3], [[261, 28], [350, 1], 2]] },
  shopkeeper: { names: ['Shop keeper', 'Lowe', 'Horvik', 'Zaff', 'Aubury'], job: 'Shopkeeper', trades: [[[256, 32], [261, 1], 16], [[261, 1], [28, 8], 16], [[261, 1], [282, 1], 12], [[261, 1], [280, 16], 16], [[261, 4], [27, 1], 12], [[261, 1], [291, 3], 12]] },
  monk: { names: ['Brother Jered', 'Father Aereck', 'Brother Kojo', 'Father Urhney'], job: 'Cleric', trades: [[[274, 32], [261, 1], 16], [[261, 1], [262, 2], 12], [[259, 3], [261, 1], 12], [[261, 2], [288, 6], 12], [[261, 5], [292, 1], 6]] },
}
export const FOLK_KINDS = Object.keys(FOLK)

let nid = 1
export function makeMob(type, x, y, z, R = Math.random, extra = {}) {
  const M = MOBS[type]
  const m = { e: 'mob', id: nid++, type, x, y, z, vx: 0, vy: 0, vz: 0, w: M.w, h: M.h, step: 0.6, hp: M.hp, yaw: R() * 6.28, hurt: 0, death: 0, ai: { t: 0 }, fall: 0, onGround: false, age: 0, ...extra }
  if (type === 'sheep') m.wool = true
  if (type === 'villager') {
    const kind = m.kind || 'man', F = FOLK[kind]
    m.kind = kind; m.name = m.name || F.names[(R() * F.names.length) | 0]
    m.trades = m.trades || F.trades.map(([buy, sell, max]) => ({ buy, sell, max, uses: 0 }))
    m.home = m.home || [x, z]
  }
  return m
}
export const setNid = (n) => { nid = Math.max(nid, n) }

const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a }
const yawTo = (m, x, z) => Math.atan2(-(x - m.x), -(z - m.z))

// one tick of a mob's brain + body. game: world, player, rng, hooks (attack, shoot, explode)
export function tickMob(game, m) {
  const M = MOBS[m.type], P = game.player, W = game.world, R = game.rng
  m.age++
  if (m.hurt > 0) m.hurt--
  if (m.death) { m.death++; m.vx *= 0.5; m.vz *= 0.5; tickMove(W, m, {}); return }
  const dx = P.x - m.x, dz = P.z - m.z, dist = Math.hypot(dx, dz), dy = P.y - m.y
  const pAlive = !P.dead && game.mode !== 'creative'
  const night = game.isNight()
  let fw = 0, jump = false, yaw = m.yaw, sp = M.sp
  const ai = m.ai
  ai.t--
  // a hostile's target: the player, if near and seen (spiders only at night, or once hit)
  let chase = false
  if (M.hostile && pAlive && dist < 24 && Math.abs(dy) < 12) {
    if (m.type !== 'spider' || night || m.angry) chase = ai.seen = dist < 16 || ai.seen ? (m.age % 10 ? ai.seen : sees(W, m, P)) : false
  }
  if (m.panic > 0) {
    m.panic--; sp *= 2
    if (ai.t <= 0) { m.yaw = R() * 6.28; ai.t = 20 }
    fw = 1; yaw = m.yaw
  } else if (chase && M.creeper) {
    yaw = yawTo(m, P.x, P.z)
    if (dist < 3 && Math.abs(dy) < 3) { m.fuse = (m.fuse || 0) + 1; fw = 0; if (m.fuse === 1) game.emit({ t: 'snd', s: 'fuse', x: m.x, y: m.y, z: m.z }) }
    else { if (m.fuse > 0) m.fuse = Math.max(0, m.fuse - 1); fw = 1 }
    if (m.fuse >= 30) { game.explode(m.x, m.y + 0.8, m.z, 3, m); m.gone = true; return }
  } else if (chase && M.ranged) {
    yaw = yawTo(m, P.x, P.z)
    fw = dist > 12 ? 1 : dist < 5 ? -1 : 0
    ai.shoot = (ai.shoot || 40) - 1
    if (ai.shoot <= 0 && dist < 16) { ai.shoot = 30 + (R() * 30 | 0); game.shoot(m, P.x, P.y + 0.6, P.z) } // MC aims a third of the way up the target, then lifts by distance
  } else if (chase) {
    yaw = yawTo(m, P.x, P.z); fw = 1
    if (m.type === 'spider' && dist < 4 && dist > 2 && m.onGround && R() < 0.1) { m.vy = 0.4; m.vx += -Math.sin(yaw) * 0.25; m.vz += -Math.cos(yaw) * 0.25 }
    ai.cd = (ai.cd || 0) - 1
    if (dist < m.w / 2 + 0.3 + 0.6 && Math.abs(dy) < 1.5 && ai.cd <= 0) { ai.cd = 20; game.hurtPlayer(M.dmg, m) }
  } else if (M.villager) {
    if (night) fw = 0
    else {
      if (ai.t <= 0) {
        const hx = m.home[0] + (R() * 2 - 1) * 8, hz = m.home[1] + (R() * 2 - 1) * 8
        ai.goal = R() < 0.6 ? [hx, hz] : null; ai.t = 60 + (R() * 120 | 0)
      }
      if (ai.goal) { yaw = yawTo(m, ai.goal[0], ai.goal[1]); fw = Math.hypot(ai.goal[0] - m.x, ai.goal[1] - m.z) > 1 ? 1 : 0 }
      if (dist < 4 && pAlive) { yaw = yawTo(m, P.x, P.z); fw = 0 }
    }
  } else {
    // passive: follow the player holding their food, else amble
    const held = P.inv[P.sel], food = M.food && held && M.food.includes(held.id) && dist < 8
    if (food) { yaw = yawTo(m, P.x, P.z); fw = dist > 2 ? 1 : 0 }
    else {
      if (ai.t <= 0) { ai.walk = R() < 0.35; m.yaw = R() * 6.28 - 3.14; ai.t = 40 + (R() * 100 | 0) }
      fw = ai.walk ? 1 : 0; yaw = m.yaw
    }
  }
  // turn toward yaw (MC: 10 deg a tick-ish), walk, hop over a block in the way, swim up in water
  const dyaw = wrap(yaw - m.yaw)
  m.yaw += Math.max(-0.35, Math.min(0.35, dyaw))
  if (fw && m.hitH && m.onGround) jump = true
  if (m.inWater) jump = true
  if (fw && m.onGround && !avoidDrop(W, m, fw)) fw = 0
  m.speedMul = sp
  tickMove(W, m, { fw, st: 0, jump, yaw: m.yaw })
  if (M.climbs && m.hitH && fw) m.vy = 0.2
  if (m.type === 'chicken' && m.vy < -0.1) m.vy = -0.1
  // fall damage, drowning-free (mobs float), lava + daylight burn
  if (m.landed > 3 && m.type !== 'chicken') game.hurtMob(m, Math.ceil(m.landed - 3), null)
  if (m.inLava) { m.fire = 100; if (m.age % 10 === 0) game.hurtMob(m, 4, null) }
  if (M.burns && !night && m.age % 20 === 0 && skyAbove(W, m)) m.fire = Math.max(m.fire || 0, 60)
  if (m.fire > 0) { m.fire--; if (m.inWater) m.fire = 0; else if (m.age % 20 === 0) game.hurtMob(m, 1, null) }
}
// will a step forward drop more than 3? (mobs don't walk off cliffs unless chasing; MC pathing)
function avoidDrop(W, m, fw) {
  const fx = m.x - Math.sin(m.yaw) * 0.8 * fw, fz = m.z - Math.cos(m.yaw) * 0.8 * fw
  for (let k = 0; k < 4; k++) { const b = BLOCKS[W.get(Math.floor(fx), Math.floor(m.y) - 1 - k, Math.floor(fz))]; if (b && (b.solid || b.liquid === 'water')) return !(b.liquid === 'lava') }
  return false
}
function skyAbove(W, m) {
  for (let y = Math.floor(m.y + m.h); y < 128; y++) { const b = BLOCKS[W.get(Math.floor(m.x), y, Math.floor(m.z))]; if (b && b.opac) return false }
  return true
}
export function sees(W, m, P) {
  const o = [m.x, m.y + m.h * 0.85, m.z], t = [P.x - o[0], P.y + 1.62 - o[1], P.z - o[2]], L = Math.hypot(...t)
  const h = raycast(W, o, t.map(v => v / L), L, (id) => BLOCKS[id].op)
  return !h
}
