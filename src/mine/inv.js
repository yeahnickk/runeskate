// Stacks, the player's inventory and Minecraft's container screens: slot layouts (in GUI pixels, as MC's own
// textures: 176x166 inventory, crafting table, furnace, chest; the villager trade screen) and the click rules (left takes
// or drops the stack, right halves or drops one, shift moves it across, number keys swap with the hotbar). Pure.
import { maxStack, craft, ITEMS, SMELT, fuelOf, def } from './blocks.js'

export const stack = (id, n = 1, d = 0) => ({ id, n, d })
export const same = (a, b) => a && b && a.id === b.id && !(ITEMS[a.id] && ITEMS[a.id].dur) && !a.d && !b.d

// put a stack into arr[from..to) (merge first, then empty slots); returns what's left (count)
export function addTo(arr, st, from = 0, to = arr.length, rev = false) {
  let n = st.n
  const ms = maxStack(st.id), order = []
  for (let i = from; i < to; i++) order.push(i)
  if (rev) order.reverse()
  for (const i of order) { const s = arr[i]; if (n && same(s, st) && s.n < ms) { const k = Math.min(n, ms - s.n); s.n += k; n -= k } }
  for (const i of order) if (n && !arr[i]) { const k = Math.min(n, ms); arr[i] = { ...st, n: k }; n -= k }
  return n
}
// into the player's inventory, MC order: merge anywhere, then the first empty hotbar slot, then the main inventory
export function give(inv, st) {
  let n = st.n
  const ms = maxStack(st.id)
  for (let i = 0; i < 36 && n; i++) { const s = inv[i]; if (same(s, st) && s.n < ms) { const k = Math.min(n, ms - s.n); s.n += k; n -= k } }
  for (let i = 0; i < 36 && n; i++) if (!inv[i]) { const k = Math.min(n, ms); inv[i] = { ...st, n: k }; n -= k }
  return n
}
export function count(inv, id) { let n = 0; for (const s of inv) if (s && s.id === id) n += s.n; return n }
export function take(inv, id, n) {
  for (let i = 0; i < inv.length && n > 0; i++) { const s = inv[i]; if (s && s.id === id) { const k = Math.min(n, s.n); s.n -= k; n -= k; if (!s.n) inv[i] = null } }
  return n === 0
}

// ---------------------------------------------------------------------------- screens
const invSlots = (P, ox, oy) => {
  const S = []
  for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) S.push({ arr: P.inv, i: 9 + r * 9 + c, x: ox + c * 18, y: oy + r * 18, sec: 'main' })
  for (let c = 0; c < 9; c++) S.push({ arr: P.inv, i: c, x: ox + c * 18, y: oy + 58, sec: 'hot' })
  return S
}
export function screenFor(type, game, key) {
  const P = game.player
  if (type === 'inv') {
    const S = invSlots(P, 8, 84)
    for (let i = 0; i < 4; i++) S.push({ arr: P.armor, i, x: 8, y: 8 + i * 18, sec: 'armor', only: (st) => ITEMS[st.id] && ITEMS[st.id].armor === i || (i === 0 && (st.id === 61)) })
    S.push({ arr: P, i: 'off', x: 77, y: 62, sec: 'off' })
    for (let i = 0; i < 4; i++) S.push({ arr: P.craft2, i, x: 98 + (i % 2) * 18, y: 18 + (i >> 1) * 18, sec: 'grid' })
    S.push({ res: true, x: 154, y: 28, sec: 'res', grid: P.craft2, gw: 2 })
    return { type, w: 176, h: 166, slots: S, title: 'Crafting', titleAt: [97, 8], grid: P.craft2, gw: 2 }
  }
  if (type === 'craft') {
    const g = game.tableGrid = game.tableGrid || Array(9).fill(null)
    const S = invSlots(P, 8, 84)
    for (let i = 0; i < 9; i++) S.push({ arr: g, i, x: 30 + (i % 3) * 18, y: 17 + ((i / 3) | 0) * 18, sec: 'grid' })
    S.push({ res: true, x: 124, y: 35, sec: 'res', grid: g, gw: 3, big: true })
    return { type, w: 176, h: 166, slots: S, title: 'Crafting', titleAt: [28, 6], inv: [8, 72], grid: g, gw: 3 }
  }
  if (type === 'furnace') {
    const f = game.furnace(key)
    const S = invSlots(P, 8, 84)
    S.push({ arr: f.s, i: 0, x: 56, y: 17, sec: 'fin' }, { arr: f.s, i: 1, x: 56, y: 53, sec: 'fuel', only: (st) => fuelOf(st.id) > 0 || st.id === 282 },
      { arr: f.s, i: 2, x: 116, y: 35, sec: 'fout', out: true, big: true })
    return { type, w: 176, h: 166, slots: S, title: 'Furnace', titleAt: [62, 6], inv: [8, 72], furnace: f, key }
  }
  if (type === 'chest') {
    const c = game.chest(key)
    const S = invSlots(P, 8, 84)
    for (let i = 0; i < 27; i++) S.push({ arr: c, i, x: 8 + (i % 9) * 18, y: 18 + ((i / 9) | 0) * 18, sec: 'box' })
    return { type, w: 176, h: 166, slots: S, title: 'Chest', titleAt: [8, 6], inv: [8, 72], key }
  }
  if (type === 'trade') {
    const v = key, g = game.tradeGrid = game.tradeGrid || [null, null]
    const S = invSlots(P, 108, 84)
    S.push({ arr: g, i: 0, x: 136, y: 37, sec: 'tin' }, { arr: g, i: 1, x: 162, y: 37, sec: 'tin' }, { res: true, x: 220, y: 37, sec: 'tres', big: true })
    return { type, w: 276, h: 166, slots: S, title: '', titleAt: [0, 0], inv: [107, 72], villager: v, sel: -1, grid: g }
  }
  if (type === 'creative') {
    const S = []
    for (let c = 0; c < 9; c++) S.push({ arr: P.inv, i: c, x: 9 + c * 18, y: 112, sec: 'hot' })
    return { type, w: 195, h: 136, slots: S, title: 'Search Items', titleAt: [8, 6], page: 0 }
  }
  return null
}
const get = (s) => s.arr[s.i] || null
const put = (s, v) => { s.arr[s.i] = v && v.n > 0 ? v : null }

// the result shown in a result slot
export function resultOf(game, scr, s) {
  if (s.sec === 'res') { const r = craft(s.grid.map(t => t ? t.id : 0), s.gw); return r ? { id: r.out, n: r.n, d: 0 } : null }
  if (s.sec === 'tres') { const t = tradeMatch(scr); return t ? { id: t.sell[0], n: t.sell[1], d: 0 } : null }
  return null
}
export function tradeMatch(scr) {
  const v = scr.villager, g = scr.grid
  for (const t of v.trades) {
    if (t.uses >= t.max) continue
    const a = g[0], b = g[1]
    const ok1 = a && a.id === t.buy[0] && a.n >= t.buy[1], ok2 = !t.buy2 || (b && b.id === t.buy2[0] && b.n >= t.buy2[1])
    if (ok1 && ok2 && (t.buy2 || !b || b === a)) return t
    if (!t.buy2 && b && b.id === t.buy[0] && b.n >= t.buy[1] && !a) return { ...t, swap: true, ref: t }
  }
  return null
}
function consumeResult(game, scr, s) {
  if (s.sec === 'res') {
    const r = resultOf(game, scr, s)
    for (let i = 0; i < s.grid.length; i++) { const t = s.grid[i]; if (!t) continue; t.n--; if (!t.n) s.grid[i] = t.id === 283 || t.id === 287 ? { id: 282, n: 1, d: 0 } : null }
    game.emit({ t: 'craft', id: r.id })
    return r
  }
  if (s.sec === 'tres') {
    let t = tradeMatch(scr); const ref = t.ref || t
    const g = scr.grid, a = t.swap ? 1 : 0
    g[a].n -= t.buy[1]; if (!g[a].n) g[a] = null
    if (t.buy2) { g[1].n -= t.buy2[1]; if (!g[1].n) g[1] = null }
    ref.uses++
    game.emit({ t: 'trade', v: scr.villager })
    game.addXp(3 + (Math.random() * 4 | 0))
    return { id: t.sell[0], n: t.sell[1], d: 0 }
  }
}

// a click on slot index si: btn 0 left, 1 right; shift; num = 0..8 for a hotbar-key swap
export function click(game, scr, si, btn, shift, num = -1) {
  const P = game.player, s = scr.slots[si]
  if (!s) return
  let cur = P.cursor
  if (s.res) {
    const r = resultOf(game, scr, s)
    if (!r) return
    if (shift) {           // craft as many as fit
      for (let k = 0; k < 64; k++) {
        const r2 = resultOf(game, scr, s); if (!r2) break
        const test = P.inv.map(t => t && { ...t })
        if (addTo(test, r2, 0, 36) > 0) break
        consumeResult(game, scr, s); give(P.inv, r2)
        if (s.sec === 'tres') break
      }
      return
    }
    if (cur && !(same(cur, r) && cur.n + r.n <= maxStack(r.id))) return
    consumeResult(game, scr, s)
    if (cur) cur.n += r.n; else P.cursor = r
    return
  }
  const here = get(s)
  if (num >= 0) {                                       // swap with hotbar slot num
    const h = P.inv[num]
    if (s.out && h) return
    if (s.only && h && !s.only(h)) return
    P.inv[num] = here; put(s, h)
    return
  }
  if (shift) {
    if (!here) return
    const st = { ...here }
    let left
    if (scr.type === 'inv' || scr.type === 'creative') {
      const it = ITEMS[st.id]
      if ((s.sec === 'main' || s.sec === 'hot') && it && it.armor !== undefined && !P.armor[it.armor]) { P.armor[it.armor] = st; put(s, null); return }
      if (s.sec === 'main') left = addTo(P.inv, st, 0, 9)
      else if (s.sec === 'hot') left = addTo(P.inv, st, 9, 36)
      else left = give(P.inv, st)
    } else if (s.sec === 'main' || s.sec === 'hot') {
      if (scr.type === 'chest') left = addTo(game.chest(scr.key), st)
      else if (scr.type === 'furnace') {
        const f = scr.furnace
        if (SMELT[st.id] !== undefined) left = addTo(f.s, st, 0, 1)
        else if (fuelOf(st.id)) left = addTo(f.s, st, 1, 2)
        else left = s.sec === 'main' ? addTo(P.inv, st, 0, 9) : addTo(P.inv, st, 9, 36)
      } else if (scr.type === 'trade') left = addTo(scr.grid, st)
      else left = s.sec === 'main' ? addTo(P.inv, st, 0, 9) : addTo(P.inv, st, 9, 36)
    } else left = addTo(P.inv, st, 0, 36, true)
    if (left === st.n) return
    if (s.out) game.furnaceXp(scr.furnace)
    put(s, left ? { ...st, n: left } : null)
    return
  }
  if (btn === 0) {
    if (!cur) { if (here) { if (s.out) game.furnaceXp(scr.furnace); P.cursor = here; put(s, null) } return }
    if (s.out) { if (here && same(here, cur) && cur.n + here.n <= maxStack(cur.id)) { cur.n += here.n; put(s, null); game.furnaceXp(scr.furnace) } return }
    if (s.only && !s.only(cur)) return
    if (!here) { const ms = slotMax(s, cur); if (cur.n <= ms) { put(s, cur); P.cursor = null } else { put(s, { ...cur, n: ms }); cur.n -= ms } return }
    if (same(here, cur)) { const k = Math.min(cur.n, slotMax(s, cur) - here.n); here.n += k; cur.n -= k; if (!cur.n) P.cursor = null; return }
    put(s, cur); P.cursor = here
    return
  }
  // right
  if (!cur) { if (here) { if (s.out) game.furnaceXp(scr.furnace); const k = Math.ceil(here.n / 2); P.cursor = { ...here, n: k }; here.n -= k; if (!here.n) put(s, null) } return }
  if (s.out) return
  if (s.only && !s.only(cur)) return
  if (!here) { put(s, { ...cur, n: 1 }); cur.n--; if (!cur.n) P.cursor = null; return }
  if (same(here, cur) && here.n < slotMax(s, cur)) { here.n++; cur.n--; if (!cur.n) P.cursor = null; return }
  if (!same(here, cur)) { put(s, cur); P.cursor = here }
}
const slotMax = (s, st) => s.sec === 'armor' ? 1 : maxStack(st.id)

// closing a screen: grids hand their items back (MC drops what doesn't fit)
export function closeScreen(game, scr) {
  const P = game.player
  const back = (arr) => { for (let i = 0; i < arr.length; i++) if (arr[i]) { const left = give(P.inv, arr[i]); if (left) game.dropAtPlayer({ ...arr[i], n: left }); arr[i] = null } }
  if (scr.type === 'inv') back(P.craft2)
  if (scr.type === 'craft') back(game.tableGrid)
  if (scr.type === 'trade') back(game.tradeGrid)
  if (P.cursor) { const left = give(P.inv, P.cursor); if (left) game.dropAtPlayer({ ...P.cursor, n: left }); P.cursor = null }
}
export { def }
