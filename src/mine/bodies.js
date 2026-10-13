// The bodies MineScape draws: the player is an RS character (the skate game's kit, rsanim.js) wearing what you wear
// (MC armour as its RS set) and holding what you hold (a pickaxe of the tool's tier, the rune scimitar for swords, a
// shortbow); mobs are the RS NPC models (assets/npc_*.json) with their own walk/ready/death clips.
import { loadRSModel } from '../model.js'
import { buildOutfitModel } from '../rsanim.js'
import { ITEMS } from './blocks.js'
import { MOBS, FOLK_RS } from './mobs.js'

const PICKS = [1265, 1267, 1269, 1273, 1271, 1275]                // bronze, iron, steel, mithril, adamant, rune (by MC tier)
const ARMOUR = [                                                   // [helm, body, legs, boots] per ARMOR_MATS
  [1167, 1129, 1095, 1061], [1153, 1115, 1067, 0], [1159, 1121, 1071, 0], [1161, 1123, 1073, 0], [1163, 1127, 1079, 0],
]
const SLOT = [0, 4, 7, 10]
// the RS outfit for the player as equipped now
export function outfitOf(P) {
  const items = {}
  const h = P.inv[P.sel], it = h && ITEMS[h.id]
  if (it) {
    if (it.tool === 'sword') items[3] = 1333
    else if (it.tool === 'hoe') items[3] = 1391
    else if (it.tool) items[3] = PICKS[it.tier] || 1265
    else if (it.bow) items[3] = 861
  }
  P.armor.forEach((a, i) => { const ai = a && ITEMS[a.id]; if (ai && ai.armor !== undefined) { const id = (ARMOUR[ai.mat] || [])[i]; if (id) items[SLOT[i]] = id } })
  return { g: 0, items, kits: {} }
}
const outfits = new Map()
export function playerModel(outfit) {
  const k = JSON.stringify(outfit.items)
  if (!outfits.has(k)) outfits.set(k, buildOutfitModel(outfit))
  return outfits.get(k)
}
// the RS model name for a mob (null: MC's own, drawn as blocks)
export function rsName(e) {
  if (e.type === 'villager') return e.rs || FOLK_RS[e.kind] || 'man'
  return MOBS[e.type] && MOBS[e.type].rs || null
}
export const npcModel = (name) => loadRSModel('npc_' + name)
// which RS clip the player plays, from what they're doing
export function playerClip(P, held, speed) {
  if (P.dead) return ['death', false]
  if (P.eat) return ['eat', true]
  if (P.bowT) return ['bow', false]
  const it = held && ITEMS[held.id]
  if (P.dig) return [it && it.tool === 'pick' ? 'mine' : it && it.tool === 'shovel' ? 'bend' : it && it.tool === 'axe' ? 'slash' : 'pound', true]
  if (P.swing > 0) return [it && it.tool === 'sword' ? 'slash' : it && it.tool ? 'slash' : 'pound', false]
  if (!P.onGround && !P.inWater && !P.flying && Math.abs(P.vy) > 0.15) return ['spot_jump', false]
  if (speed > 0.25 || (P.sprint && speed > 0.1)) return ['run', true]
  if (speed > 0.02) return ['walk', true]
  return ['ready', true]
}
