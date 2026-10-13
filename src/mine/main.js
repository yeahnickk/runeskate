// MineScape's client: RuneScape to look at, Minecraft to play. The real 2004 map (rsworld.js) drawn over the blocks,
// RS NPCs and your RS character (F5), Minecraft's own first person, HUD and screens. The title screen over a turning
// Lumbridge panorama, worlds saved in the browser, the 20 Hz game loop with interpolated frames, chunk streaming nearest first, Minecraft's controls (WASD,
// space, shift, ctrl sprint / double-tap W, E, Q, F, 1-9 + wheel, mouse dig/use/pick, T and / chat, F1/F3/F5, Esc)
// and Bedrock's touch layout on phones.
import * as THREE from 'three'
import { World, CS, WH } from './world.js'
import { Game, TPS, DAY } from './game.js'
import { meshChunk } from './mesh.js'
import { View } from './render.js'
import { Gui } from './gui.js'
import { Sfx } from './audio.js'
import { buildAtlas, setTiles } from './tex.js'
import { BLOCKS, ITEMS, nameOf } from './blocks.js'
import { give } from './inv.js'
import { RSWorld } from './rsworld.js'

THREE.ColorManagement.enabled = false
const TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window
const $ = (id) => document.getElementById(id)
const canvas = $('game'), guiC = $('gui'), chatIn = $('chat'), nameIn = $('name')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
renderer.outputColorSpace = THREE.LinearSRGBColorSpace
const sfx = new Sfx()
const gui = new Gui(guiC, sfx); gui.touch = TOUCH
const OPT_KEY = 'minescape.opts', LIST_KEY = 'minescape.worlds'
try { Object.assign(gui.opts, JSON.parse(localStorage.getItem(OPT_KEY) || '{}')) } catch (e) {}
if (TOUCH && !localStorage.getItem(OPT_KEY)) Object.assign(gui.opts, { rd: 5, fancy: false, autoJump: true })
let rsw = null, map = null, world = null, game = null, view = null, tiles = null, atlas = null
let acc = 0, last = performance.now(), saveAt = 0, curFile = null
const keys = new Set(); let mouse = { l: false, r: false, lp: false, rp: false }, wheel = 0, lastW = 0, sprintTap = false, lastSpace = 0, flyToggle = false
let third = 0, camYaw = 0, camPitch = 0, bobT = 0, bobAmt = 0, swing = 0, hurtTilt = 0, shake = 0, fovK = 1
let panorama = true, panYaw = 0

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, TOUCH ? 2 : 2), w = innerWidth, h = innerHeight
  renderer.setPixelRatio(dpr); renderer.setSize(w, h, false)
  guiC.width = Math.round(w * dpr); guiC.height = Math.round(h * dpr)
  if (view) { view.cam.aspect = w / h; view.cam.updateProjectionMatrix() }
}
addEventListener('resize', resize)

// ---------------------------------------------------------------------------- loading
async function fetchBin(url, onp) {
  const r = await fetch(url)
  const len = +r.headers.get('content-length') || 0, rd = r.body && r.body.getReader ? r.body.getReader() : null
  if (!rd || !len) return new Uint8Array(await r.arrayBuffer())
  const parts = []; let got = 0
  for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; onp(Math.min(1, got / len)) }
  const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
async function boot() {
  resize()
  gui.state = 'loading'; gui.loadMsg = 'Loading MineScape...'
  loop()
  const at = buildAtlas(); tiles = at.tiles; atlas = flatten(at.canvas); setTiles(tiles); gui.tiles = tiles
  const json = await (await fetch('assets/mine_world.json')).json()
  gui.loadMsg = 'Loading the RuneScape map...'
  const bin = await fetchBin('assets/mine_world.bin', (p) => { gui.progress = p * 0.8 })
  map = { json, bin }
  gui.loadMsg = 'Loading Gielinor...'
  rsw = new RSWorld(new World(map, 1))
  await rsw.loadCore((p) => { gui.progress = 0.8 + p * 0.2 })
  // the title panorama: a creative game round Lumbridge castle
  startWorld(null)
  gui.state = 'title'
  refreshWorlds()
}
// RS draws flat colours: each block texture is pulled toward its own average (busy ones, ores, keep more detail)
function flatten(src) {
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height
  const x = c.getContext('2d'); x.drawImage(src, 0, 0)
  const im = x.getImageData(0, 0, c.width, c.height), d = im.data, T = 16
  const each = (tx, ty, f) => { for (let y = 0; y < T; y++) for (let xx = 0; xx < T; xx++) { const o = ((ty * T + y) * c.width + tx * T + xx) * 4; if (d[o + 3] > 128) f(o) } }
  for (let ty = 0; ty < c.height / T; ty++) for (let tx = 0; tx < c.width / T; tx++) {
    let r = 0, g = 0, b = 0, n = 0
    each(tx, ty, (o) => { r += d[o]; g += d[o + 1]; b += d[o + 2]; n++ })
    if (!n) continue
    r /= n; g /= n; b /= n
    let sp = 0; each(tx, ty, (o) => { sp += Math.abs(d[o] - r) + Math.abs(d[o + 1] - g) + Math.abs(d[o + 2] - b) })
    const k = sp / n > 90 ? 0.75 : 0.35
    each(tx, ty, (o) => { d[o] = r + (d[o] - r) * k; d[o + 1] = g + (d[o + 1] - g) * k; d[o + 2] = b + (d[o + 2] - b) * k })
  }
  x.putImageData(im, 0, 0)
  return c
}
function refreshWorlds() { try { gui.worlds = JSON.parse(localStorage.getItem(LIST_KEY) || '[]').sort((a, b) => b.at - a.at) } catch (e) { gui.worlds = [] } gui.selWorld = gui.worlds.length ? 0 : -1 }

function startWorld(entry, create) {
  if (view) { for (const k of [...view.chunks.keys()]) view.dropChunk(k); view.dispose(); view.scene.clear(); }
  world = new World(map, entry ? entry.seed || 1 : 1)
  rsw.world = world
  game = new Game(world, { mode: entry ? entry.mode : 'creative', name: localStorage.getItem('minescape.name') || 'Steve' })
  panorama = !entry
  if (entry && !create) { try { const s = JSON.parse(localStorage.getItem('minescape.w.' + entry.file)); if (s) game.load(s) } catch (e) { console.warn('save unreadable', e) } }
  if (create) { game.time = 1000; const P = game.player; P.inv[0] = null }
  view = new View(renderer, atlas, world, game, { rd: gui.opts.rd, fancy: gui.opts.fancy, rsw })
  view.U.uBright.value = gui.opts.bright
  resize()
  curFile = entry ? entry.file : null
  if (panorama) { const P = game.player; P.x = 1170.5; P.z = -402.5; P.y = 50; game.time = 4000 }
  gui.G = game
}
function save() {
  if (!game || !curFile) return
  try {
    localStorage.setItem('minescape.w.' + curFile, JSON.stringify(game.save()))
    const list = JSON.parse(localStorage.getItem(LIST_KEY) || '[]'), e = list.find(w => w.file === curFile)
    if (e) { e.at = Date.now(); e.mode = game.mode; e.day = Math.floor(game.time / DAY) + 1 }
    localStorage.setItem(LIST_KEY, JSON.stringify(list))
  } catch (e) { gui.say('§cCould not save the world (browser storage full?)') }
}

gui.onAction = (a, arg) => {
  sfx.init()
  if (a === 'worlds') { refreshWorlds(); gui.state = 'worlds' }
  else if (a === 'quit') location.href = 'index.html'
  else if (a === 'nameInput') showName(arg)
  else if (a === 'create') {
    const name = (nameIn.value || 'New World').slice(0, 32), file = name.replace(/[^\w ]/g, '_') + '_' + Date.now().toString(36)
    const e = { file, name, mode: arg.mode, at: Date.now(), seed: (Math.random() * 1e9) | 0, day: 1 }
    const list = JSON.parse(localStorage.getItem(LIST_KEY) || '[]'); list.push(e); localStorage.setItem(LIST_KEY, JSON.stringify(list))
    showName(false); play(e, true)
  }
  else if (a === 'play') play(arg)
  else if (a === 'delete') { const list = JSON.parse(localStorage.getItem(LIST_KEY) || '[]').filter(w => w.file !== arg.file); localStorage.setItem(LIST_KEY, JSON.stringify(list)); localStorage.removeItem('minescape.w.' + arg.file); refreshWorlds() }
  else if (a === 'resume') resume()
  else if (a === 'saveQuit') { save(); startWorld(null); gui.state = 'title'; document.exitPointerLock && document.exitPointerLock() }
  else if (a === 'respawn') { game.respawn(); gui.state = 'play'; lock() }
  else if (a === 'opts') applyOpts()
  else if (a === 'sel') { game.player.sel = arg; selChanged() }
}
function applyOpts() {
  localStorage.setItem(OPT_KEY, JSON.stringify(gui.opts))
  sfx.setVol(gui.opts.vol); sfx.music = gui.opts.music
  if (view) { view.rd = gui.opts.rd; view.U.uBright.value = gui.opts.bright; if (view.fancy !== gui.opts.fancy) { view.fancy = gui.opts.fancy; for (const k of view.chunks.keys()) view.dirty.add(k) } }
}
function play(e, create) {
  gui.state = 'loading'; gui.loadMsg = 'Loading terrain...'; gui.progress = 0
  setTimeout(() => {
    startWorld(e, create)
    const P = game.player
    if (create) { const s = game.spawn; Object.assign(P, { x: s[0], y: s[1], z: s[2] }) }
    loadingUntil = performance.now() + 20000
    gui.state = 'loading'
  }, 30)
}
let loadingUntil = 0
function resume() { gui.state = 'play'; lock() }
function lock() { if (!TOUCH && guiC.requestPointerLock) { try { const p = guiC.requestPointerLock(); if (p && p.catch) p.catch(() => {}) } catch (e) {} } }
function showName(on) {
  nameIn.style.display = on ? 'block' : 'none'
  if (on) { nameIn.value = 'New World'; placeName(); setTimeout(() => nameIn.focus(), 30) }
}
function placeName() {
  if (!gui.nameBox) return
  const [x, y, w, h] = gui.nameBox, s = gui.s * innerWidth / guiC.width
  Object.assign(nameIn.style, { left: x * s + 'px', top: y * s + 'px', width: w * s + 'px', height: h * s + 'px', fontSize: Math.round(8 * s) + 'px' })
}

// ---------------------------------------------------------------------------- input
const KEYMAP = { KeyW: 'fw', KeyS: 'bk', KeyA: 'lf', KeyD: 'rt', Space: 'jump', ShiftLeft: 'sneak', ShiftRight: 'sneak', ControlLeft: 'sprint', ArrowUp: 'fw', ArrowDown: 'bk', ArrowLeft: 'lf', ArrowRight: 'rt' }
const queued = { drop: false, dropAll: false, swap: false }
addEventListener('keydown', (e) => {
  sfx.init()
  if (gui.state === 'chat') {
    if (e.code === 'Escape') { closeChat(); e.preventDefault() }
    else if (e.code === 'Enter') { sendChat(); e.preventDefault() }
    return
  }
  if (gui.state === 'create') { if (e.code === 'Enter') gui.onAction('create', { mode: gui.newMode }); return }
  if (e.code === 'F3') { gui.debug = !gui.debug; e.preventDefault(); return }
  if (e.code === 'F1') { gui.hideHud = !gui.hideHud; e.preventDefault(); return }
  if (e.code === 'F5') { third = (third + 1) % 3; e.preventDefault(); return }
  if (gui.state === 'screen') {
    if (e.code === 'Escape' || e.code === 'KeyE') { gui.close(); lock(); e.preventDefault(); return }
    if (/^Digit[1-9]$/.test(e.code) && gui.hovSlot) { import('./inv.js').then(m => m.click(game, gui.scr, gui.hovSlot.i, 0, false, +e.code[5] - 1)); return }
    if (e.code === 'KeyQ' && gui.hovSlot && gui.hovSlot.st && !gui.hovSlot.s.res) { const s = gui.hovSlot.s, st = s.arr[s.i]; if (st) { const n = e.ctrlKey ? st.n : 1; game.throwItem({ ...st, n }); st.n -= n; if (!st.n) s.arr[s.i] = null } return }
    return
  }
  if (gui.state === 'pause' || gui.state === 'adv' || gui.state === 'options') {
    if (e.code === 'Escape') { if (gui.state === 'pause') resume(); else if (gui.state === 'options' && gui.back !== 'title') { gui.state = 'pause'; applyOpts() } else if (gui.state === 'adv') gui.state = 'pause'; else if (gui.state === 'options') { gui.state = 'title'; applyOpts() } }
    return
  }
  if (gui.state !== 'play') return
  if (KEYMAP[e.code]) {
    if (e.code === 'KeyW' && !e.repeat) { const t = performance.now(); if (t - lastW < 300) sprintTap = true; lastW = t }
    if (e.code === 'Space' && !e.repeat) { const t = performance.now(); if (t - lastSpace < 300) flyToggle = true; lastSpace = t }
    keys.add(KEYMAP[e.code]); e.preventDefault()
  }
  if (/^Digit[1-9]$/.test(e.code)) { game.player.sel = +e.code[5] - 1; selChanged() }
  if (e.code === 'KeyE') { gui.open(game.mode === 'creative' ? 'creative' : 'inv'); document.exitPointerLock && document.exitPointerLock() }
  if (e.code === 'KeyQ') { queued.drop = true; queued.dropAll = e.ctrlKey }
  if (e.code === 'KeyF') queued.swap = true
  if (e.code === 'KeyT' || e.code === 'Enter' || e.code === 'Slash') { openChat(e.code === 'Slash' ? '/' : ''); e.preventDefault() }
  if (e.code === 'Escape') { gui.state = 'pause'; save() }
})
addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys.delete(KEYMAP[e.code]) })
addEventListener('blur', () => { keys.clear(); mouse.l = mouse.r = false })
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && gui.state === 'play' && !TOUCH) { gui.state = 'pause'; save() }
})
function selChanged() { const h = game.player.inv[game.player.sel]; gui.heldName = h ? { s: nameOf(h.id), t: 2 } : null }
const gxy = (e) => { const r = guiC.getBoundingClientRect(); return [(e.clientX - r.left) * guiC.width / r.width, (e.clientY - r.top) * guiC.height / r.height] }
guiC.addEventListener('mousedown', (e) => {
  sfx.init()
  if (TOUCH) return
  if (gui.state === 'play') {
    if (!document.pointerLockElement) { lock(); return }
    if (e.button === 0) { mouse.l = true; mouse.lp = true }
    if (e.button === 2) { mouse.r = true; mouse.rp = true }
    if (e.button === 1) pickBlock()
    return
  }
  const [x, y] = gxy(e); gui.mouse('down', x, y, e.button === 2 ? 1 : 0, e.shiftKey)
})
addEventListener('mouseup', (e) => { if (e.button === 0) mouse.l = false; if (e.button === 2) mouse.r = false; const [x, y] = gxy(e); gui.mouse('up', x, y) })
addEventListener('mousemove', (e) => {
  if (gui.state === 'play' && document.pointerLockElement) {
    const k = 0.0022 * (0.4 + gui.opts.sens * 1.6)
    game.player.yaw -= e.movementX * k; game.player.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, game.player.pitch - e.movementY * k))
    return
  }
  const [x, y] = gxy(e); gui.mouse('move', x, y)
})
guiC.addEventListener('wheel', (e) => {
  if (gui.state === 'play') { const d = Math.sign(e.deltaY); game.player.sel = (game.player.sel + d + 9) % 9; selChanged() }
  else { const [x, y] = gxy(e); gui.mouse('wheel', x, y, Math.sign(e.deltaY)) }
  e.preventDefault()
}, { passive: false })
guiC.addEventListener('contextmenu', (e) => e.preventDefault())
function pickBlock() {
  const t = game.target(); if (!t) return
  let id = t.id; if (id === 26) id = 25; if (id === 1) id = game.mode === 'creative' ? 1 : 2; if (BLOCKS[id].crop !== undefined) id = 267; if (id === 57 || id === 56) id = 290
  const P = game.player, have = P.inv.findIndex(s => s && s.id === id)
  if (have >= 0 && have < 9) P.sel = have
  else if (have >= 9) { const t2 = P.inv[P.sel]; P.inv[P.sel] = P.inv[have]; P.inv[have] = t2 }
  else if (game.mode === 'creative') P.inv[P.sel] = { id, n: 1, d: 0 }
  selChanged()
}
function openChat(pre) {
  gui.state = 'chat'; document.exitPointerLock && document.exitPointerLock()
  chatIn.style.display = 'block'; chatIn.value = pre; setTimeout(() => { chatIn.focus(); chatIn.setSelectionRange(pre.length, pre.length) }, 20)
  keys.clear()
}
function closeChat() { chatIn.style.display = 'none'; chatIn.blur(); gui.state = 'play'; lock() }
function sendChat() {
  const s = chatIn.value.trim()
  if (s) {
    if (s[0] === '/') { const r = game.command(s); if (r) gui.say(r, '#aaaaaa') }
    else gui.say('<' + game.name + '> ' + s)
  }
  closeChat()
}

// touch: Bedrock's layout. Buttons from gui.touchRects; elsewhere drag to look, tap to use, hold to dig/attack
const touches = new Map()
gui.touchOn = new Set()
function touchStart(e) {
  sfx.init()
  for (const t of e.changedTouches) {
    const [x, y] = gxy(t), gx = x / gui.s, gy = y / gui.s
    if (gui.state !== 'play') { gui.mouse('down', x, y, 0, false); touches.set(t.identifier, { ui: true }); continue }
    const r = (gui.touchRects || []).find(r => gx >= r.x && gy >= r.y && gx < r.x + r.w && gy < r.y + r.h)
    if (r) {
      touches.set(t.identifier, { k: r.k }); gui.touchOn.add(r.k)
      if (r.k === 'inv') gui.open(game.mode === 'creative' ? 'creative' : 'inv')
      if (r.k === 'pause') { gui.state = 'pause'; save() }
      if (r.k === 'chat') openChat('')
      if (r.k === 'drop') queued.drop = true
      if (r.k === 'sneak') { if (keys.has('sneak')) keys.delete('sneak'); else keys.add('sneak') }
      if (r.k === 'jump2' || r.k === 'jump') { keys.add('jump'); const now = performance.now(); if (now - lastSpace < 300) flyToggle = true; lastSpace = now }
      if (['fw', 'bk', 'lf', 'rt'].includes(r.k)) keys.add(r.k)
      continue
    }
    if (gui.mouse('down', x, y, 0, false)) { touches.set(t.identifier, { ui: true }); continue }
    touches.set(t.identifier, { look: true, x: t.clientX, y: t.clientY, t0: performance.now(), moved: 0, digging: false })
  }
  e.preventDefault()
}
function touchMove(e) {
  for (const t of e.changedTouches) {
    const s = touches.get(t.identifier); if (!s) continue
    if (s.ui) { const [x, y] = gxy(t); gui.mouse('move', x, y); continue }
    if (s.k === 'fw' || s.k === 'jump') {     // sliding off the d-pad's centre keeps you walking
      const [x, y] = gxy(t), gx = x / gui.s, gy = y / gui.s
      const r = (gui.touchRects || []).find(r => gx >= r.x && gy >= r.y && gx < r.x + r.w && gy < r.y + r.h)
      if (r && r.k !== s.k && ['fw', 'bk', 'lf', 'rt'].includes(r.k)) { keys.delete(s.k); gui.touchOn.delete(s.k); s.k = r.k; keys.add(r.k); gui.touchOn.add(r.k) }
      continue
    }
    if (!s.look) continue
    const dx = t.clientX - s.x, dy = t.clientY - s.y; s.x = t.clientX; s.y = t.clientY; s.moved += Math.abs(dx) + Math.abs(dy)
    const k = 0.006 * (0.4 + gui.opts.sens * 1.6)
    game.player.yaw -= dx * k; game.player.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, game.player.pitch - dy * k))
  }
  e.preventDefault()
}
function touchEnd(e) {
  for (const t of e.changedTouches) {
    const s = touches.get(t.identifier); touches.delete(t.identifier)
    if (!s) continue
    if (s.ui) { const [x, y] = gxy(t); gui.mouse('up', x, y); continue }
    if (s.k) { gui.touchOn.delete(s.k); if (s.k === 'jump2' || s.k === 'jump') keys.delete('jump'); if (['fw', 'bk', 'lf', 'rt'].includes(s.k)) keys.delete(s.k); continue }
    if (s.look) { if (s.digging) mouse.l = false; else if (s.moved < 14 && performance.now() - s.t0 < 300) { mouse.rp = true; mouse.lp = true; tapUse = true } }
  }
  e.preventDefault()
}
let tapUse = false
guiC.addEventListener('touchstart', touchStart, { passive: false })
guiC.addEventListener('touchmove', touchMove, { passive: false })
guiC.addEventListener('touchend', touchEnd, { passive: false })
guiC.addEventListener('touchcancel', touchEnd, { passive: false })
function touchHolds() {
  for (const s of touches.values()) if (s.look && !s.digging && s.moved < 14 && performance.now() - s.t0 > 300) { s.digging = true; mouse.l = true; mouse.lp = true }
}

// ---------------------------------------------------------------------------- chunks
function stream(budgetMs) {
  const P = game.player, pcx = Math.floor(P.x) >> 4, pcz = Math.floor(P.z) >> 4, rd = view.rd, t0 = performance.now()
  rsw.stream(P.x, -P.z)
  let n = 0
  // edits first: the chunk you changed, then the neighbours its light reaches
  for (const set of [view.dirty, view.soon]) {
    for (const k of set) {
      set.delete(k); view.soon.delete(k)
      if (!view.chunks.has(k)) continue
      const [cx, cz] = k.split(',').map(Number)
      view.setChunk(cx, cz, meshChunk(world, cx, cz, { fancy: view.fancy, rs: view.rs })); n++
      if (performance.now() - t0 > budgetMs * (set === view.dirty ? 3 : 1)) return n
    }
  }
  // new chunks nearest first (in view direction a touch earlier)
  const want = []
  for (let a = -rd; a <= rd; a++) for (let c = -rd; c <= rd; c++) {
    if (a * a + c * c > (rd + 0.5) ** 2) continue
    const k = (pcx + a) + ',' + (pcz + c)
    if (!view.chunks.has(k)) want.push([a * a + c * c, pcx + a, pcz + c])
  }
  want.sort((p, q) => p[0] - q[0])
  for (const [, cx, cz] of want) {
    view.setChunk(cx, cz, meshChunk(world, cx, cz, { fancy: view.fancy, rs: view.rs })); n++
    if (performance.now() - t0 > budgetMs) break
  }
  // drop what's far
  for (const [k, c] of view.chunks) if (Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) > rd + 2) view.dropChunk(k)
  if (Math.random() < 0.02) for (const k of [...world.chunks.keys()]) { const [cx, cz] = k.split(',').map(Number); if (Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) > rd + 5) world.chunks.delete(k) }
  return want.length
}

// ---------------------------------------------------------------------------- the loop
function input() {
  const P = game.player
  const fw = (keys.has('fw') ? 1 : 0) - (keys.has('bk') ? 1 : 0), st = (keys.has('rt') ? 1 : 0) - (keys.has('lf') ? 1 : 0)
  if (fw <= 0) sprintTap = false
  let jump = keys.has('jump')
  if (gui.opts.autoJump && P.onGround && P.hitH && (fw || st)) {
    const fx = Math.floor(P.x - Math.sin(P.yaw) * 0.7 * fw), fz = Math.floor(P.z - Math.cos(P.yaw) * 0.7 * fw), y = Math.floor(P.y)
    const a = BLOCKS[world.get(fx, y, fz)], b = BLOCKS[world.get(fx, y + 1, fz)], c = BLOCKS[world.get(fx, y + 2, fz)]
    if (a.solid && !b.solid && !c.solid) jump = true
  }
  const inp = { fw, st, jump, sneak: keys.has('sneak'), sprint: keys.has('sprint') || sprintTap || (TOUCH && fw > 0 && keys.has('sprint')), yaw: P.yaw, pitch: P.pitch,
    attack: mouse.l, attackPress: mouse.lp, use: mouse.r || tapUse, usePress: mouse.rp, drop: queued.drop, dropAll: queued.dropAll, swapHands: queued.swap, flyToggle }
  if (tapUse) { inp.attack = false; inp.use = true; inp.attackPress = !!game.targetMob(); if (inp.attackPress) { inp.usePress = false; inp.use = false } }
  mouse.lp = mouse.rp = false; queued.drop = queued.swap = false; flyToggle = false; tapUse = false
  return inp
}
function handleEvents() {
  const P = game.player
  for (const e of game.drainEvents()) {
    const d = e.x !== undefined ? Math.hypot(e.x - P.x, e.y - P.y, e.z - P.z) : 0
    switch (e.t) {
      case 'snd': sfx.play(e.s, d); break
      case 'hit': sfx.block(e.id, 'hit', d); if (Math.random() < 0.6) view.burst(e.x, e.y, e.z, e.id, 3, 0.55); break
      case 'break': sfx.block(e.id, 'dig', d); view.burst(e.x, e.y, e.z, e.id, 26); break
      case 'place': if (!e.quiet) sfx.block(e.id, 'dig', d); break
      case 'step': sfx.block(e.id, 'step', d); break
      case 'land': sfx.block(e.id, 'step'); break
      case 'pickup': sfx.play('pop', d); break
      case 'orb': sfx.play('orb'); break
      case 'hurt': sfx.play('hurt'); hurtTilt = 1; break
      case 'death': gui.state = 'dead'; gui.deathMsg = e.msg; gui.deathScore = e.score; gui.deadAt = performance.now(); document.exitPointerLock && document.exitPointerLock(); break
      case 'screen': if (gui.state === 'play') { gui.open(e.type, e.key); mouse.l = mouse.r = false; document.exitPointerLock && document.exitPointerLock() } break
      case 'toast': gui.toast(e.a); break
      case 'chat': gui.say(e.msg, e.col); break
      case 'boom': sfx.play('boom', d * 0.3); view.puff(e.x, e.y, e.z, 40, [0.9, 0.9, 0.9], 0.6, 1.5); view.puff(e.x, e.y, e.z, 20, [1, 0.7, 0.3], 0.4, 3); shake = Math.max(shake, Math.max(0, 1 - d / 20)); break
      case 'poof': view.puff(e.x, e.y, e.z, 12, [1, 1, 1], 0.2, 0.6); break
      case 'crit': view.puff(e.x, e.y, e.z, 10, [0.9, 0.9, 0.6], 0.12, 2); break
      case 'meal': view.puff(e.x + 0.5, e.y + 0.5, e.z + 0.5, 10, [0.4, 1, 0.4], 0.12, 1); break
      case 'sleep': gui.sleepFade = 1.6; break
      case 'region': gui.heldName = { s: '§e' + e.n, t: 2.5 }; break
    }
  }
}
function tick() {
  for (const e of game.ents) { e.px = e.x; e.py = e.y; e.pz = e.z }
  const P = game.player
  P.px = P.x; P.py = P.y; P.pz = P.z
  const wasSel = P.sel
  game.tick(input())
  if (P.sel !== wasSel) selChanged()
  if (P.swing === 6) swing = 0.0001
  handleEvents()
}
function camera(alpha, dt) {
  const P = game.player
  const ix = P.px + (P.x - P.px) * alpha, iy = P.py + (P.y - P.py) * alpha, iz = P.pz + (P.z - P.pz) * alpha
  P.eyeH = (P.eyeH || 1.62) + ((P.sneak ? 1.27 : 1.62) - (P.eyeH || 1.62)) * Math.min(1, dt * 14)
  const pos = new THREE.Vector3(ix, iy + P.eyeH, iz)
  // MC's view bob: from the distance walked on the ground
  const sp = Math.hypot(P.x - P.px, P.z - P.pz)
  if (P.onGround && !P.flying) { bobT += sp * 0.6 * dt * 20; bobAmt += (Math.min(0.1, sp * 0.5) - bobAmt) * Math.min(1, dt * 8) } else bobAmt *= 0.9
  const bob = gui.opts.bob ? bobAmt : 0
  let yaw = P.yaw, pitch = P.pitch, roll = 0
  if (bob) { pos.x += Math.cos(yaw) * Math.sin(bobT * Math.PI) * bob * 0.5; pos.z -= Math.sin(yaw) * Math.sin(bobT * Math.PI) * bob * 0.5; pos.y -= Math.abs(Math.cos(bobT * Math.PI) * bob); roll = Math.sin(bobT * Math.PI) * bob * 0.05; pitch += Math.abs(Math.cos(bobT * Math.PI - 0.2) * bob) * 0.05 }
  hurtTilt = Math.max(0, hurtTilt - dt * 2.5); roll += Math.sin(hurtTilt * Math.PI) * hurtTilt * 0.25
  if (shake > 0) { shake = Math.max(0, shake - dt * 1.5); pos.x += (Math.random() - 0.5) * shake * 0.3; pos.y += (Math.random() - 0.5) * shake * 0.3 }
  if (P.dead) { roll = Math.PI / 6; pos.y = iy + 0.3 }
  if (third) {
    const back = third === 1 ? 1 : -1, d = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)).multiplyScalar(4 * back)
    // pull in if a block is in the way
    let L = 4
    for (let s = 0.2; s <= 4; s += 0.2) { const q = pos.clone().addScaledVector(d, s / 4); if (BLOCKS[world.get(Math.floor(q.x), Math.floor(q.y), Math.floor(q.z))].op) { L = s - 0.3; break } }
    pos.addScaledVector(d, Math.max(0.3, L) / 4)
    if (third === 2) { yaw += Math.PI; pitch = -pitch }
  }
  fovK += ((P.sprint ? 1.15 : 1) * (P.eat || P.bowT ? 0.9 : 1) - fovK) * Math.min(1, dt * 10)
  const eyeB = BLOCKS[world.get(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z))]
  const water = eyeB && eyeB.liquid === 'water' && pos.y < Math.floor(pos.y) + 14 / 16, lava = eyeB && eyeB.liquid === 'lava'
  return { pos, yaw, pitch, roll, fov: gui.opts.fov * fovK * (water ? 0.86 : 1), water, lava, target: P.dead || gui.state === 'loading' ? null : game.target(), hideHud: gui.hideHud }
}
function debugLines(cam) {
  const P = game.player, bx = Math.floor(P.x), by = Math.floor(P.y), bz = Math.floor(P.z)
  const dirs = ['north (Towards negative Z)', 'west (Towards negative X)', 'south (Towards positive Z)', 'east (Towards positive X)']
  const k = ((Math.round(P.yaw / (Math.PI / 2)) % 4) + 4) % 4
  const t = cam.target
  gui.debugLines = [
    'MineScape 1.0 (RuneScape 2004 map)', fps + ' fps C: ' + view.chunks.size + ' E: ' + game.ents.length + ' P: ' + view.parts.length, '',
    'XYZ: ' + P.x.toFixed(3) + ' / ' + P.y.toFixed(5) + ' / ' + P.z.toFixed(3), 'Block: ' + bx + ' ' + by + ' ' + bz + '  RS tile: ' + (bx + 2048) + ', ' + (-bz - 1 + 2816),
    'Chunk: ' + (bx & 15) + ' ' + (by & 15) + ' ' + (bz & 15) + ' in ' + (bx >> 4) + ' ' + (by >> 4) + ' ' + (bz >> 4),
    'Facing: ' + dirs[k] + ' (' + (-P.yaw * 180 / Math.PI).toFixed(1) + ' / ' + (-P.pitch * 180 / Math.PI).toFixed(1) + ')',
    'Region: ' + (world.placeName(bx, bz) || 'Gielinor'), 'Day ' + (Math.floor(game.time / DAY) + 1) + ', time ' + (game.time % DAY), 'Mode: ' + game.mode,
  ]
  gui.debugRight = ['JS ' + (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + 'MB' : ''), 'Display: ' + guiC.width + 'x' + guiC.height, '', ...(t ? ['Targeted Block: ' + t.x + ', ' + t.y + ', ' + t.z, nameOf(t.id) + ' (#' + t.id + ')'] : [])]
}
let fps = 0, fN = 0, fT = 0, musicT = 0
function loop() {
  requestAnimationFrame(loop)
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now
  fN++; if (now - fT > 1000) { fps = fN; fN = 0; fT = now }
  if (gui.state === 'create') placeName()
  if (!game || !view) { gui.draw(null, dt); return }
  if (gui.state === 'loading') {
    // stream the spawn area before play (MC's "Loading terrain")
    const left = stream(40)
    const total = (2 * view.rd + 1) ** 2 * 0.78
    gui.progress = Math.min(1, view.chunks.size / Math.min(total, 9 * 9))
    if (view.chunks.size >= Math.min(total, 81) || now > loadingUntil) {
      if (!panorama) { gui.state = 'play'; lock(); gui.say('§eWelcome to MineScape: Gielinor, one block a tile. ' + (TOUCH ? 'Tap ... for your inventory.' : 'Press E for your inventory.')); selChanged() }
    }
    view.frame(dt, 1, { pos: new THREE.Vector3(game.player.x, game.player.y + 1.6, game.player.z), yaw: panYaw, pitch: -0.1, fov: 70, target: null })
    gui.draw(game, dt)
    return
  }
  if (panorama) {
    stream(8)
    panYaw += dt * 0.03
    game.time += dt * 2
    const P = game.player
    view.frame(dt, 1, { pos: new THREE.Vector3(P.x, P.y + 1.6, P.z), yaw: panYaw, pitch: -0.12, fov: 85, target: null, hideHud: true })
    gui.draw(null, dt)
    return
  }
  const running = gui.state !== 'pause' && gui.state !== 'adv' && !(gui.state === 'options' && gui.back === 'pause')
  if (running) {
    if (TOUCH) touchHolds()
    acc += dt
    let n = 0
    while (acc >= 1 / TPS && n < 5) { tick(); acc -= 1 / TPS; n++ }
    if (n >= 5) acc = 0
  }
  stream(gui.state === 'play' ? 6 : 10)
  const alpha = running ? Math.min(1, acc * TPS) : 1
  const cam = camera(alpha, dt)
  view.syncPlayer(alpha, dt, !!third && !game.player.dead)
  view.frame(dt, alpha, cam)
  // the hand
  const P = game.player, held = P.inv[P.sel]
  if (!third && !P.dead && !gui.hideHud) {
    view.setHeld(held ? held.id : 0)
    if (swing > 0) { swing += dt / 0.3; if (swing >= 1) swing = 0 }
    if (P.swing > 0 && swing === 0 && (mouse.l || P.dig)) swing = 0.0001
    view.equip = Math.min(1, view.equip + dt * 4)
    view.drawHand({ swing, bob: bobT, bobAmt: gui.opts.bob ? bobAmt : 0, light: view.lightK(P.x, P.y + 1.5, P.z), eat: P.eat, bow: P.bowT })
  }
  if (gui.sleepFade > 0) gui.sleepFade -= dt * 0.6
  if (gui.debug) debugLines(cam)
  gui.draw(game, dt)
  sfx.tickMusic(now / 1000, game.isNight())
  if (now - saveAt > 45000) { saveAt = now; save() }
}
addEventListener('beforeunload', () => save())
document.addEventListener('visibilitychange', () => { if (document.hidden) save() })
window.MINE = { get game() { return game }, get world() { return world }, get view() { return view }, gui, renderer, give: (id, n = 1) => give(game.player.inv, { id, n, d: 0 }) }
boot().catch((e) => { console.error(e); gui.loadMsg = 'Failed to load: ' + e.message })
