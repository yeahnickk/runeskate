// MineScape's GUI as Minecraft draws it, on one canvas at MC's GUI scale (the biggest whole number with 320x240 GUI
// pixels on screen): the HUD (crosshair, hotbar, hearts, hunger, armour, air, XP bar + level, held item name, chat,
// advancement toasts, F3), container screens (inventory with 2x2 crafting + armour, crafting table, furnace, chest,
// villager trading, creative), and the menus (title with logo + splash, worlds, create world, options, pause, death,
// advancements). Immediate mode: each frame's draw registers its click targets.
import { BLOCKS, ITEMS, nameOf, def, maxStack, ARMOR_SLOTS } from './blocks.js'
import { icon, hudIcon, sprite } from './tex.js'
import { text, textC, width } from './font.js'
import { screenFor, click, resultOf, closeScreen, give, tradeMatch, count } from './inv.js'
import { ADV } from './game.js'

export const SPLASHES = ['Buying gf!', 'Also try RuneSkate!', 'Sit rat!', 'Lumbridge edition!', '100% blocky Gielinor!', 'Now with villagers!', 'Wildy is dangerous!',
  'Doric approves!', 'Selling lobbies 10gp ea!', 'Cows go moo!', 'Dig straight down!', 'Not affiliated with Jagex!', 'Hans has seen it all!', 'Cabbage!',
  'Free trimming armour!', 'Runite under the Wildy!', '2004 forever!', 'Now in 3D!', 'Does anyone have a spare emerald?', 'Draynor Manor at night...', 'Pickaxe not included!']

// OSRS's interface stone: dark brown panels with a lit top-left bevel, sunken slots, orange titles, yellow text
const COL = { panel: '#3e3529', hi: '#6b5d48', lo: '#1e1912', slot: '#2b2419', slotHi: '#55493a', slotLo: '#14100b', title: '#ff981f' }

// the keys you can rebind (Controls): [action, name, MC's default]
export const BINDS = [['fw', 'Walk Forwards', 'KeyW'], ['bk', 'Walk Backwards', 'KeyS'], ['lf', 'Strafe Left', 'KeyA'], ['rt', 'Strafe Right', 'KeyD'],
  ['jump', 'Jump', 'Space'], ['sneak', 'Sneak', 'ShiftLeft'], ['sprint', 'Sprint', 'ControlLeft'], ['inv', 'Inventory', 'KeyE'],
  ['drop', 'Drop Item', 'KeyQ'], ['swap', 'Swap Hands', 'KeyF'], ['chat', 'Open Chat', 'KeyT'], ['cmd', 'Open Command', 'Slash'],
  ['persp', 'Perspective', 'F5'], ['hud', 'Hide HUD', 'F1'], ['debug', 'Debug Screen', 'F3'], ['pick', 'Pick Block', 'Mouse1']]
export const keyName = (c) => !c ? 'NONE' : c.startsWith('Key') ? c.slice(3) : c.startsWith('Digit') ? c.slice(5) : ({ Space: 'Space', ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', AltLeft: 'L Alt', Slash: '/', Mouse0: 'Button 1', Mouse1: 'Button 3', Mouse2: 'Button 2', Tab: 'Tab', Enter: 'Enter', Backquote: '`' })[c] || c

// the creative inventory's tabs (MC's: building, decoration, nature, ... and search), MineScape's RS blocks their own
function creativeTabs() {
  const RS = [71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 33, 34, 35, 36, 37]
  const NAT = [1, 2, 3, 6, 7, 10, 46, 12, 47, 22, 70, 23, 69, 53, 51, 52, 29, 30, 31, 65, 66, 61, 14, 15, 16, 18, 19, 17, 67, 55, 5]
  const DEC = [13, 24, 25, 27, 28, 82, 32, 39, 40, 58, 59, 60]
  const skip = new Set([0, 9, 26, 45, 20, 56, 57, 41, 42, 43, 44, 8, 81])
  const blocks = Object.keys(BLOCKS).map(Number).filter(i => !skip.has(i))
  const items = Object.keys(ITEMS).map(Number), I = (id) => ITEMS[id]
  const used = new Set([...RS, ...NAT, ...DEC])
  const build = blocks.filter(i => !used.has(i))
  const combat = items.filter(i => I(i).tool === 'sword' || I(i).armor !== undefined || I(i).bow || i === 280)
  const tools = items.filter(i => (I(i).tool && I(i).tool !== 'sword') || I(i).bucket !== undefined || I(i).fire || i === 288)
  const food = items.filter(i => I(i).food)
  const deco = [...DEC, 290]
  const got = new Set([...combat, ...tools, ...food, 290])
  const mats = items.filter(i => !got.has(i))
  const T = [
    { n: 'Building Blocks', icon: 21, ids: build }, { n: 'Decoration Blocks', icon: 31, ids: deco }, { n: 'Natural Blocks', icon: 1, ids: NAT },
    { n: 'RuneScape', icon: 34, ids: RS }, { n: 'Tools', icon: 322, ids: tools }, { n: 'Combat', icon: 320, ids: combat },
    { n: 'Food', icon: 264, ids: food }, { n: 'Ingredients', icon: 258, ids: mats }, { n: 'Search Items', icon: 292, ids: [], search: true }]
  T.all = [...blocks, 290, ...items.filter(i => i !== 290)]
  return T
}

export class Gui {
  constructor(canvas, sfx) {
    this.c = canvas; this.x = canvas.getContext('2d'); this.sfx = sfx
    this.state = 'loading'; this.hits = []; this.mx = -1; this.my = -1; this.toasts = []; this.chatLines = []; this.heldName = null
    this.splash = SPLASHES[(Math.random() * SPLASHES.length) | 0]
    this.opts = { rd: 8, fov: 70, sens: 0.5, gui: 0, fancy: true, autoJump: false, vol: 0.8, music: true, bright: 0.5, bob: true }
    this.debug = false; this.hideHud = false; this.logo = null; this.scroll = 0
    this.progress = 0; this.loadMsg = 'Loading terrain...'
    this.worlds = []; this.selWorld = -1
    this.onAction = () => {}
  }
  resize() {
    const W = this.c.width, H = this.c.height
    let s = Math.max(1, Math.min(Math.floor(W / 320), Math.floor(H / 240)))
    if (this.opts.gui) s = Math.min(s, this.opts.gui)
    if (this.touch) s = Math.max(s, Math.min(Math.floor(W / 300), Math.floor(H / 200), s + 1))
    this.s = s; this.W = Math.floor(W / s); this.H = Math.floor(H / s)
  }
  // ------------------------------------------------------------------------ primitives
  rect(x, y, w, h, col) { this.x.fillStyle = col; this.x.fillRect(x, y, w, h) }
  hit(x, y, w, h, fn, opts = {}) { this.hits.push({ x, y, w, h, fn, ...opts }) }
  over(x, y, w, h) { return this.mx >= x && this.my >= y && this.mx < x + w && this.my < y + h }
  panel(x, y, w, h) {
    const r = (a, b, c, d, col) => this.rect(a, b, c, d, col)
    r(x + 1, y, w - 2, h, '#000'); r(x, y + 1, w, h - 2, '#000')
    r(x + 1, y + 1, w - 2, h - 2, COL.panel)
    r(x + 1, y + 1, w - 3, 2, COL.hi); r(x + 1, y + 1, 2, h - 3, COL.hi)
    r(x + 2, y + h - 3, w - 3, 2, COL.lo); r(x + w - 3, y + 2, 2, h - 3, COL.lo)
    r(x + 3, y + 3, w - 6, h - 6, COL.panel)
  }
  slotBox(x, y, big) {
    const o = big ? 5 : 1, w = big ? 26 : 18
    this.rect(x - o, y - o, w, w, COL.slot)
    this.rect(x - o, y - o, w - 1, 1, COL.slotLo); this.rect(x - o, y - o, 1, w - 1, COL.slotLo)
    this.rect(x - o + 1, y - o + w - 1, w - 1, 1, COL.slotHi); this.rect(x - o + w - 1, y - o + 1, 1, w - 1, COL.slotHi)
  }
  item(st, x, y, k = 1) {
    if (!st) return
    const im = icon(st.id), X = this.x
    X.drawImage(im, x, y, 16 * k, 16 * k)
    if (st.n > 1) { const s = String(st.n); text(X, s, x - 1, y - 1, '#ffff00') }   // (OSRS: the count top-left in yellow)
    const it = ITEMS[st.id]
    if (it && it.dur && st.d > 0) {
      const f = 1 - st.d / it.dur, w = Math.round(13 * f)
      this.rect(x + 2, y + 13, 13, 2, '#000')
      this.rect(x + 2, y + 13, w, 1, `hsl(${f * 120},100%,50%)`)
    }
  }
  button(x, y, w, h, label, fn, on = true) {
    const hov = on && this.over(x, y, w, h), X = this.x
    this.rect(x, y, w, h, '#000')
    this.rect(x + 1, y + 1, w - 2, h - 2, on ? (hov ? '#6a5b44' : '#4b4133') : '#2a241b')
    if (on) {
      this.rect(x + 1, y + 1, w - 2, 1, hov ? '#8f7c5e' : '#6b5d48'); this.rect(x + 1, y + 1, 1, h - 2, hov ? '#8f7c5e' : '#6b5d48')
      this.rect(x + 1, y + h - 3, w - 2, 2, hov ? '#3a3226' : '#2a241b'); this.rect(x + w - 2, y + 2, 1, h - 3, hov ? '#3a3226' : '#2a241b')
      // the stone's grain
      X.globalAlpha = 0.08; for (let i = 0; i < w * h / 18; i++) { const a = (i * 7919) % (w - 4), b = (i * 104729) % (h - 5); this.rect(x + 2 + a, y + 2 + b, 1, 1, i % 2 ? '#000' : '#fff') } X.globalAlpha = 1
    }
    textC(X, label, x + w / 2, y + (h - 8) / 2, on ? (hov ? '#ffffff' : '#ff981f') : '#7a6a50')
    if (on) this.hit(x, y, w, h, () => { this.sfx.play('click'); fn() }, { label })
  }
  slider(x, y, w, h, label, v, set) {
    this.rect(x, y, w, h, '#000'); this.rect(x + 1, y + 1, w - 2, h - 2, '#241e16')
    const hx = x + Math.round(v * (w - 8))
    const hov = this.over(x, y, w, h)
    this.rect(hx, y, 8, h, '#000'); this.rect(hx + 1, y + 1, 6, h - 2, hov ? '#6a5b44' : '#4b4133'); this.rect(hx + 1, y + 1, 6, 1, hov ? '#8f7c5e' : '#6b5d48')
    textC(this.x, label, x + w / 2, y + (h - 8) / 2, hov ? '#ffffff' : '#ff981f')
    this.hit(x, y, w, h, () => set(Math.max(0, Math.min(1, (this.mx - x - 4) / (w - 8)))), { drag: true })
  }
  dirtBg() {
    const t = this.tiles && this.tiles.dirt, X = this.x
    if (!t) return this.rect(0, 0, this.W, this.H, '#2a1e14')
    for (let y = 0; y < this.H; y += 32) for (let x = 0; x < this.W; x += 32) X.drawImage(t, x, y, 32, 32)
    X.fillStyle = 'rgba(0,0,0,0.75)'; X.fillRect(0, 0, this.W, this.H)
  }
  tooltip(lines, x, y) {
    const X = this.x, w = Math.max(...lines.map(l => width(l))) + 6, h = lines.length * 10 + (lines.length > 1 ? 2 : 0) + 4
    let tx = x + 12, ty = y - 12
    if (tx + w > this.W) tx = x - 16 - w
    if (ty + h > this.H) ty = this.H - h
    // (OSRS's right-click menu: black edge, brown body, the name in orange)
    this.rect(tx - 1, ty - 1, w + 2, h + 2, '#000'); this.rect(tx, ty, w, h, '#5d5447'); this.rect(tx + 1, ty + 1, w - 2, h - 2, '#000')
    lines.forEach((l, i) => text(X, l, tx + 3, ty + 3 + i * 10 + (i ? 2 : 0), i ? '#ffffff' : '#ff981f'))
  }
  itemLines(st) {
    const L = [nameOf(st.id)], it = ITEMS[st.id]
    if (it && it.tool) { L.push(''); L.push('§7When in Main Hand:'); }
    if (it && it.armor !== undefined) L.push('§9+' + it.pts + ' Armor')
    if (it && it.food) L.push('§7Restores ' + it.food[0] / 2 + ' hunger')
    if (it && it.dur) L.push('§7Durability: ' + (it.dur - (st.d || 0)) + ' / ' + it.dur)
    return L.filter((l, i) => !(l === '' && i === L.length - 1))
  }

  // ------------------------------------------------------------------------ the frame
  draw(G, dt) {
    const X = this.x
    this.resize()
    X.setTransform(1, 0, 0, 1, 0, 0); X.clearRect(0, 0, this.c.width, this.c.height)
    X.setTransform(this.s, 0, 0, this.s, 0, 0); X.imageSmoothingEnabled = false
    this.hits = []
    this.G = G
    const st = this.state
    if (st === 'loading') return this.drawLoading()
    if (st === 'title') return this.drawTitle()
    if (st === 'worlds') return this.drawWorlds()
    if (st === 'create') return this.drawCreate()
    if (st === 'options') return this.drawOptions()
    if (st === 'controls') return this.drawControls()
    if (!G) return
    if (!this.hideHud) this.drawHud(G, dt)
    if (st === 'pause') this.drawPause()
    else if (st === 'dead') this.drawDead()
    else if (st === 'adv') this.drawAdv()
    else if (st === 'screen') this.drawScreen()
    this.drawToasts(dt)
    if (this.touch && st === 'play') this.drawTouch()
  }
  drawLoading() {
    this.dirtBg()
    textC(this.x, this.loadMsg, this.W / 2, this.H / 2 - 20, '#ffffff')
    const w = 100, x = (this.W - w) / 2, y = this.H / 2
    this.rect(x, y, w, 2, '#808080'); this.rect(x, y, Math.round(w * this.progress), 2, '#80ff80')
  }
  drawLogo(cx, y) {
    if (!this.logo) {
      const word = 'MINESCAPE', k = 2, cell = 3
      const tmp = document.createElement('canvas'); tmp.width = width(word) * k + 4; tmp.height = 9 * k
      const tx = tmp.getContext('2d'); text(tx, word, 0, 0, '#ffffff', false, k)
      const id = tx.getImageData(0, 0, tmp.width, tmp.height).data
      const c = document.createElement('canvas'); c.width = tmp.width * cell + 8; c.height = 7 * k * cell + 10
      const x = c.getContext('2d')
      for (let j = 0; j < 7 * k; j++) for (let i = 0; i < tmp.width; i++) {
        if (id[(j * tmp.width + i) * 4 + 3] < 128) continue
        const px = i * cell, py = j * cell
        x.fillStyle = '#1a1a1a'; x.fillRect(px + 3, py + 4, cell, cell)                      // (extrusion)
        x.fillStyle = '#3a3a3a'; x.fillRect(px + 1, py + 2, cell, cell)
      }
      for (let j = 0; j < 7 * k; j++) for (let i = 0; i < tmp.width; i++) {
        if (id[(j * tmp.width + i) * 4 + 3] < 128) continue
        const px = i * cell, py = j * cell, h = ((i * 31 + j * 17) * 2654435761 >>> 24) / 255
        const v = 130 + h * 50 - j * 3
        x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(px, py, cell, cell)
        if (j === 0 || id[((j - 1) * tmp.width + i) * 4 + 3] < 128) { x.fillStyle = '#e8e8e8'; x.fillRect(px, py, cell, 1) }
      }
      this.logo = c
    }
    const L = this.logo, w = Math.min(L.width, this.W - 20), h = L.height * w / L.width
    this.x.drawImage(L, Math.round(cx - w / 2), y, Math.round(w), Math.round(h))
    return h
  }
  drawTitle() {
    const X = this.x, W = this.W, H = this.H
    X.fillStyle = 'rgba(0,0,0,0.15)'; X.fillRect(0, 0, W, H)
    const lh = this.drawLogo(W / 2, Math.max(8, H / 4 - 40))
    // the splash: yellow, tilted, pulsing
    const t = performance.now() / 1000, k = 1.8 - Math.abs(Math.sin(t * 2 * Math.PI) * 0.1)
    const sw = width(this.splash), sk = Math.min(k, 200 / sw * 1.4)
    X.save(); X.translate(W / 2 + Math.min(110, W / 2 - 40), Math.max(8, H / 4 - 40) + lh - 8); X.rotate(-20 * Math.PI / 180); X.scale(sk / 1.4, sk / 1.4)
    textC(X, this.splash, 0, -4, '#ffff00'); X.restore()
    const bx = W / 2 - 100, by = Math.max(lh + 20, H / 4 + 48)
    this.button(bx, by, 200, 20, 'Singleplayer', () => this.onAction('worlds'))
    this.button(bx, by + 24, 200, 20, 'Multiplayer', () => {}, false)
    this.button(bx, by + 48, 200, 20, 'Back to RuneSkate', () => this.onAction('quit'))
    this.button(bx, by + 84, 98, 20, 'Options...', () => { this.back = 'title'; this.state = 'options' })
    this.button(bx + 102, by + 84, 98, 20, 'Quit Game', () => this.onAction('quit'))
    text(X, 'MineScape 1.0 (RS 2004 map)', 2, H - 10, '#ffffff')
    const cr = 'A fan game. Not affiliated with Jagex.'
    text(X, cr, W - width(cr) - 2, H - 10, '#ffffff')
  }
  drawWorlds() {
    this.dirtBg()
    const W = this.W, H = this.H, X = this.x
    textC(X, 'Select World', W / 2, 8, '#ff981f')
    const top = 24, bot = H - 56, rowH = 36
    X.fillStyle = 'rgba(0,0,0,0.5)'; X.fillRect(0, top, W, bot - top)
    this.worlds.forEach((w, i) => {
      const y = top + 4 + i * rowH - this.scroll, x = W / 2 - 110
      if (y < top || y > bot - rowH) return
      if (i === this.selWorld) { this.rect(x - 2, y - 2, 224, rowH, '#808080'); this.rect(x - 1, y - 1, 222, rowH - 2, '#000') }
      if (this.tiles) X.drawImage(icon(1), x, y, 32, 32)
      text(X, w.name, x + 36, y + 2, '#ffffff')
      text(X, w.file + ' (' + new Date(w.at).toLocaleDateString() + ')', x + 36, y + 13, '#808080')
      text(X, (w.mode === 'creative' ? 'Creative' : 'Survival') + ' Mode, Day ' + (w.day || 1), x + 36, y + 23, '#808080')
      this.hit(x - 2, y - 2, 224, rowH, () => { if (this.selWorld === i && performance.now() - (this.lastPick || 0) < 400) this.onAction('play', w); this.selWorld = i; this.lastPick = performance.now() })
    })
    if (!this.worlds.length) textC(X, 'No worlds yet. Create one!', W / 2, top + 20, '#a0a0a0')
    const sel = this.worlds[this.selWorld]
    this.button(W / 2 - 154, H - 52, 150, 20, 'Play Selected World', () => this.onAction('play', sel), !!sel)
    this.button(W / 2 + 4, H - 52, 150, 20, 'Create New World', () => { this.newName = 'New World'; this.newMode = 'survival'; this.state = 'create'; this.onAction('nameInput', true) })
    this.button(W / 2 - 154, H - 28, 72, 20, 'Delete', () => { if (sel && confirm("Are you sure you want to delete '" + sel.name + "'? It will be lost forever!")) this.onAction('delete', sel) }, !!sel)
    this.button(W / 2 + 82, H - 28, 72, 20, 'Cancel', () => { this.state = 'title' })
  }
  drawCreate() {
    this.dirtBg()
    const W = this.W, H = this.H, X = this.x
    textC(X, 'Create New World', W / 2, 20, '#ff981f')
    text(X, 'World Name', W / 2 - 100, 47, '#a0a0a0')
    this.nameBox = [W / 2 - 100, 60, 200, 20]
    this.rect(W / 2 - 101, 59, 202, 22, '#a0a0a0'); this.rect(W / 2 - 100, 60, 200, 20, '#000')
    this.button(W / 2 - 75, 100, 150, 20, 'Game Mode: ' + (this.newMode === 'creative' ? 'Creative' : 'Survival'), () => { this.newMode = this.newMode === 'creative' ? 'survival' : 'creative' })
    textC(X, this.newMode === 'creative' ? 'Unlimited resources, free flying and' : 'Search for resources, craft, gain', W / 2, 124, '#a0a0a0')
    textC(X, this.newMode === 'creative' ? 'destroy blocks instantly' : 'levels, health and hunger', W / 2, 134, '#a0a0a0')
    textC(X, 'The world is the 2004 RuneScape map, block for tile.', W / 2, 152, '#a0a0a0')
    this.button(W / 2 - 154, H - 28, 150, 20, 'Create New World', () => this.onAction('create', { name: this.newName, mode: this.newMode }))
    this.button(W / 2 + 4, H - 28, 150, 20, 'Cancel', () => { this.state = 'worlds'; this.onAction('nameInput', false) })
  }
  drawOptions() {
    if (this.back === 'title') this.dirtBg(); else { this.x.fillStyle = 'rgba(16,16,16,0.75)'; this.x.fillRect(0, 0, this.W, this.H) }
    const W = this.W, X = this.x, o = this.opts
    textC(X, 'Options', W / 2, 15, '#ff981f')
    const c1 = W / 2 - 155, c2 = W / 2 + 5
    this.slider(c1, 40, 150, 20, 'FOV: ' + (o.fov === 70 ? 'Normal' : o.fov), (o.fov - 30) / 80, (v) => { o.fov = Math.round(30 + v * 80) })
    this.slider(c2, 40, 150, 20, 'Render Distance: ' + o.rd + ' chunks', (o.rd - 2) / 14, (v) => { o.rd = Math.round(2 + v * 14) })
    this.slider(c1, 64, 150, 20, 'Sensitivity: ' + Math.round(o.sens * 200) + '%', o.sens, (v) => { o.sens = Math.max(0.05, v) })
    this.slider(c2, 64, 150, 20, 'Brightness: ' + (o.bright < 0.05 ? 'Moody' : o.bright > 0.95 ? 'Bright' : Math.round(o.bright * 100) + '%'), o.bright, (v) => { o.bright = v })
    this.button(c1, 88, 150, 20, 'Graphics: ' + (o.fancy ? 'Fancy' : 'Fast'), () => { o.fancy = !o.fancy })
    this.button(c2, 88, 150, 20, 'GUI Scale: ' + (o.gui ? o.gui : 'Auto'), () => { o.gui = (o.gui + 1) % 5 })
    this.slider(c1, 112, 150, 20, 'Sound: ' + Math.round(o.vol * 100) + '%', o.vol, (v) => { o.vol = v })
    this.button(c2, 112, 150, 20, 'Music: ' + (o.music ? 'ON' : 'OFF'), () => { o.music = !o.music })
    this.button(c1, 136, 150, 20, 'Auto-Jump: ' + (o.autoJump ? 'ON' : 'OFF'), () => { o.autoJump = !o.autoJump })
    this.button(c2, 136, 150, 20, 'View Bobbing: ' + (o.bob ? 'ON' : 'OFF'), () => { o.bob = !o.bob })
    this.button(W / 2 - 75, 160, 150, 20, 'Controls...', () => { this.state = 'controls'; this.binding = null })
    this.button(W / 2 - 100, this.H - 28, 200, 20, 'Done', () => { this.state = this.back || 'title'; this.onAction('opts') })
  }
  // MC's Controls screen: every key, click one then press its new key (ESC keeps it)
  drawControls() {
    if (this.back === 'title') this.dirtBg(); else { this.x.fillStyle = 'rgba(16,16,16,0.75)'; this.x.fillRect(0, 0, this.W, this.H) }
    const W = this.W, X = this.x, o = this.opts, keys = o.keys || {}
    textC(X, 'Controls', W / 2, 15, '#ff981f')
    this.button(W / 2 - 155, 30, 150, 20, 'Invert Mouse: ' + (o.invertY ? 'ON' : 'OFF'), () => { o.invertY = !o.invertY })
    this.slider(W / 2 + 5, 30, 150, 20, 'Sensitivity: ' + Math.round(o.sens * 200) + '%', o.sens, (v) => { o.sens = Math.max(0.05, v) })
    const rows = Math.ceil(BINDS.length / 2), top = 58, gap = Math.min(22, (this.H - top - 34) / rows | 0)
    BINDS.forEach(([a, n, def], i) => {
      const x = i < rows ? W / 2 - 155 : W / 2 + 5, y = top + (i % rows) * gap, code = keys[a] || def
      const clash = BINDS.some(([b, , d]) => b !== a && (keys[b] || d) === code)
      text(X, n, x, y + 6, '#ffffff', true)
      this.button(x + 90, y, 60, Math.min(20, gap - 2), this.binding === a ? '> ' + keyName(code) + ' <' : keyName(code), () => { this.binding = a })
      if (clash && this.binding !== a) this.rect(x + 88, y + 2, 1, Math.min(16, gap - 6), '#ff4040')
    })
    this.button(W / 2 - 155, this.H - 28, 150, 20, 'Reset Keys', () => { o.keys = {}; this.binding = null })
    this.button(W / 2 + 5, this.H - 28, 150, 20, 'Done', () => { this.state = 'options'; this.binding = null; this.onAction('opts') })
  }
  drawPause() {
    const W = this.W, X = this.x
    const g = X.createLinearGradient(0, 0, 0, this.H); g.addColorStop(0, 'rgba(16,16,16,0.75)'); g.addColorStop(1, 'rgba(16,16,16,0.82)'); X.fillStyle = g; X.fillRect(0, 0, W, this.H)
    textC(X, 'Game Menu', W / 2, 40, '#ff981f')
    const y = this.H / 4 + 24
    this.button(W / 2 - 102, y, 204, 20, 'Back to Game', () => this.onAction('resume'))
    this.button(W / 2 - 102, y + 24, 98, 20, 'Advancements', () => { this.state = 'adv'; this.scroll = 0 })
    this.button(W / 2 + 4, y + 24, 98, 20, 'Statistics', () => {}, false)
    this.button(W / 2 - 102, y + 48, 204, 20, 'Options...', () => { this.back = 'pause'; this.state = 'options' })
    this.button(W / 2 - 102, y + 84, 204, 20, 'Save and Quit to Title', () => this.onAction('saveQuit'))
  }
  drawDead() {
    const W = this.W, X = this.x, H = this.H
    const g = X.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(80,0,0,0.38)'); g.addColorStop(1, 'rgba(160,32,32,0.62)'); X.fillStyle = g; X.fillRect(0, 0, W, H)
    X.save(); X.scale(2, 2); textC(X, 'You died!', W / 4, 30, '#ffffff'); X.restore()
    textC(X, this.deathMsg || '', W / 2, 85, '#ffffff')
    textC(X, 'Score: §e' + (this.deathScore || 0), W / 2, 100, '#ffffff')
    const ok = performance.now() - (this.deadAt || 0) > 1000
    this.button(W / 2 - 100, H / 4 + 72, 200, 20, 'Respawn', () => this.onAction('respawn'), ok)
    this.button(W / 2 - 100, H / 4 + 96, 200, 20, 'Title Screen', () => this.onAction('saveQuit'), ok)
  }
  drawAdv() {
    const W = this.W, H = this.H, X = this.x, G = this.G
    X.fillStyle = 'rgba(16,16,16,0.75)'; X.fillRect(0, 0, W, H)
    const pw = Math.min(300, W - 8), ph = Math.min(H - 40, 180), px = (W - pw) / 2, py = (H - ph) / 2 - 10
    this.panel(px, py, pw, ph)
    text(X, 'Advancements', px + 8, py + 6, COL.title, false)
    const got = ADV.filter(a => G.adv[a.id]).length
    text(X, got + '/' + ADV.length, px + pw - 8 - width(got + '/' + ADV.length), py + 6, COL.title, false)
    // the dirt backdrop + entries
    const ix = px + 9, iy = py + 18, iw = pw - 18, ih = ph - 27
    X.save(); X.beginPath(); X.rect(ix, iy, iw, ih); X.clip()
    if (this.tiles) for (let y = iy; y < iy + ih; y += 16) for (let x = ix; x < ix + iw; x += 16) X.drawImage(this.tiles.dirt, x, y, 16, 16)
    X.fillStyle = 'rgba(0,0,0,0.45)'; X.fillRect(ix, iy, iw, ih)
    const max = Math.max(0, ADV.length * 26 - ih + 4); this.scroll = Math.max(0, Math.min(max, this.scroll))
    ADV.forEach((a, i) => {
      const y = iy + 4 + i * 26 - this.scroll, on = !!G.adv[a.id]
      this.rect(ix + 4, y, 24, 24, on ? '#e8c840' : '#6a6a6a'); this.rect(ix + 5, y + 1, 22, 22, on ? '#a07a10' : '#2a2a2a')
      X.drawImage(icon(a.icon), ix + 8, y + 4, 16, 16)
      text(X, a.n, ix + 34, y + 3, on ? '#ffff55' : '#ffffff')
      text(X, a.d, ix + 34, y + 13, on ? '#55ff55' : '#a0a0a0')
    })
    X.restore()
    this.button(W / 2 - 100, py + ph + 6, 200, 20, 'Done', () => { this.state = 'pause' })
    this.hit(ix, iy, iw, ih, () => {}, { wheel: (d) => { this.scroll += d * 13 } })
  }

  // ------------------------------------------------------------------------ the HUD
  drawHud(G, dt) {
    const X = this.x, W = this.W, H = this.H, P = G.player, cx = W / 2 | 0, crea = G.mode === 'creative'
    // crosshair (inverted, as MC)
    if (this.state === 'play' && !this.touch) { X.globalCompositeOperation = 'difference'; this.rect(cx - 4, (H / 2 | 0), 9, 1, '#fff'); this.rect(cx, (H / 2 | 0) - 4, 1, 4, '#fff'); this.rect(cx, (H / 2 | 0) + 1, 1, 4, '#fff'); X.globalCompositeOperation = 'source-over' }
    if (P.hurtT > 0 || G.mode === 'spectator') {}
    if (P.fire > 0 && !crea && !P.inWater) {       // (MC: alight, flames lick up the bottom of the screen)
      const t = performance.now() / 90
      for (let x = 0; x < W; x += 4) { const h = H * (0.18 + 0.1 * Math.sin(x * 0.07 + t) + 0.06 * Math.sin(x * 0.19 - t * 1.7)); const g = X.createLinearGradient(0, H - h, 0, H); g.addColorStop(0, 'rgba(255,120,20,0)'); g.addColorStop(0.5, 'rgba(255,140,30,0.45)'); g.addColorStop(1, 'rgba(255,220,90,0.7)'); X.fillStyle = g; X.fillRect(x, H - h, 4, h) }
    }
    // hotbar
    const hx = cx - 91, hy = H - 22
    this.rect(hx, hy, 182, 22, 'rgba(62,53,41,0.85)')                // (an OSRS stone strip)
    this.rect(hx, hy, 182, 1, '#6b5d48'); this.rect(hx, hy + 21, 182, 1, '#1e1912'); this.rect(hx, hy, 1, 22, '#6b5d48'); this.rect(hx + 181, hy, 1, 22, '#1e1912')
    for (let i = 0; i < 9; i++) { const x = hx + 1 + i * 20; this.rect(x, hy + 1, 20, 20, 'rgba(30,25,18,0.45)'); this.rect(x, hy + 1, 1, 20, 'rgba(20,16,11,0.9)'); this.rect(x + 19, hy + 1, 1, 20, 'rgba(107,93,72,0.7)') }
    const sx = hx - 1 + P.sel * 20
    // the selected slot: OSRS's red selection glow (as the active tab)
    this.rect(sx, hy - 1, 24, 24, '#000'); this.rect(sx + 1, hy, 22, 22, '#c8a040'); this.rect(sx + 2, hy + 1, 20, 20, '#7a2a16')
    X.clearRect(sx + 3, hy + 2, 18, 18); this.rect(sx + 3, hy + 2, 18, 18, 'rgba(120,40,20,0.45)')
    for (let i = 0; i < 9; i++) { this.item(P.inv[i], hx + 3 + i * 20, hy + 3); if (this.touch) this.hit(hx + 1 + i * 20, hy, 20, 22, () => this.onAction('sel', i)) }
    if (P.off) { this.rect(hx - 29, hy, 22, 22, 'rgba(0,0,0,0.55)'); this.item(P.off, hx - 26, hy + 3) }
    if (!crea) {
      // XP bar + level
      const xy = H - 29
      this.rect(hx, xy, 182, 5, '#000'); this.rect(hx + 1, xy + 1, 180, 3, '#2b2b2b'); this.rect(hx + 1, xy + 1, Math.round(180 * P.xp), 3, '#80ff20')
      if (P.lvl > 0) { const s = String(P.lvl), tx = cx - width(s) / 2 | 0; for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) text(X, s, tx + a, xy - 7 + b, '#000', false); text(X, s, tx, xy - 7, '#80ff20', false) }
      // hearts (MC: shake when low; flash white when hurt)
      const hy2 = H - 39, low = P.hp <= 4, t = performance.now()
      for (let i = 0; i < 10; i++) {
        const x = hx + i * 8, y = hy2 + (low ? ((Math.sin(t / 40 + i * 7) > 0.3) ? -1 : 0) : 0)
        X.drawImage(hudIcon(P.hurtT > 0 && P.hurtT % 4 < 2 ? 'heartHurt' : 'heartEmpty'), x, y)
        const v = P.hp - i * 2
        if (v >= 2) X.drawImage(hudIcon('heart'), x, y); else if (v >= 1) X.drawImage(hudIcon('heartHalf'), x, y)
      }
      // armour
      let pts = 0; for (const a of P.armor) if (a && ITEMS[a.id]) pts += ITEMS[a.id].pts || 0
      if (pts > 0) for (let i = 0; i < 10; i++) { const v = pts - i * 2; X.drawImage(hudIcon(v >= 2 ? 'armor' : v >= 1 ? 'armorHalf' : 'armorEmpty'), hx + i * 8, hy2 - 10) }
      // hunger (right to left; jitters when saturation is gone)
      for (let i = 0; i < 10; i++) {
        const x = hx + 182 - 9 - i * 8, y = hy2 + (P.sat <= 0 && ((t / 50 + i * 13) | 0) % 13 === 0 ? -1 : 0), v = P.food - i * 2
        X.drawImage(hudIcon(v >= 2 ? 'food' : v >= 1 ? 'foodHalf' : 'foodEmpty'), x, y)
      }
      if (P.eyesWater || P.air < 300) { const n = Math.ceil(Math.max(0, P.air) / 30); for (let i = 0; i < n; i++) X.drawImage(hudIcon('bubble'), hx + 182 - 9 - i * 8, hy2 - 10) }
    }
    // the held item's name after switching
    if (this.heldName && this.heldName.t > 0) {
      this.heldName.t -= dt
      X.globalAlpha = Math.min(1, this.heldName.t * 2)
      textC(X, this.heldName.s, cx, H - (crea ? 37 : 59), '#ffffff')
      X.globalAlpha = 1
    }
    this.drawChat()
    if (this.debug) this.drawDebug()
    if (this.sleepFade > 0) { X.fillStyle = `rgba(16,16,32,${Math.min(1, this.sleepFade)})`; X.fillRect(0, 0, W, H) }
  }
  drawChat() {
    const X = this.x, H = this.H, open = this.state === 'chat', now = performance.now()
    let y = this.touch && !open ? Math.round(H * 0.45) : H - (open ? 26 : 48)
    const lines = this.chatLines.slice(-(open ? 20 : 10)).reverse()
    for (const l of lines) {
      const age = (now - l.t) / 1000
      if (!open && age > 10) continue
      const a = open ? 1 : Math.min(1, (10 - age) * 1)
      X.globalAlpha = a
      this.rect(2, y - 1, 320 - 2, 9, 'rgba(0,0,0,0.5)')
      text(X, l.msg, 4, y, l.col || '#ffffff')
      y -= 9
    }
    X.globalAlpha = 1
    if (open) this.rect(2, H - 14, this.W - 4, 12, 'rgba(0,0,0,0.5)')
  }
  drawDebug() {
    const X = this.x, L = this.debugLines || [], R = this.debugRight || []
    L.forEach((l, i) => { this.rect(1, 1 + i * 9, width(l) + 2, 9, 'rgba(80,80,80,0.55)'); text(X, l, 2, 2 + i * 9, '#e0e0e0', false) })
    R.forEach((l, i) => { const w = width(l); this.rect(this.W - w - 3, 1 + i * 9, w + 2, 9, 'rgba(80,80,80,0.55)'); text(X, l, this.W - w - 2, 2 + i * 9, '#e0e0e0', false) })
  }
  // chat lines wrap at MC's 320 px chat width
  say(msg, col) {
    const words = String(msg).split(' '), out = []
    let cur = '', code = ''
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (width(t) > 312 && cur) { out.push(cur); const m = cur.match(/\u00a7.(?!.*\u00a7)/); code = m ? m[0] : code; cur = code + w } else cur = t }
    if (cur) out.push(cur)
    for (const l of out) this.chatLines.push({ msg: l, t: performance.now(), col })
    if (this.chatLines.length > 100) this.chatLines.splice(0, this.chatLines.length - 100)
  }
  toast(a) { this.toasts.push({ a, t: 0 }); this.sfx.play('levelup') }
  drawToasts(dt) {
    const X = this.x
    this.toasts = this.toasts.filter(t => (t.t += dt) < 5)
    this.toasts.slice(0, 3).forEach((t, i) => {
      const slide = Math.min(1, t.t * 3, (5 - t.t) * 3), x = this.W - 160 * slide, y = i * 32
      this.rect(x, y, 160, 32, '#000'); this.rect(x + 1, y + 1, 158, 30, '#6b5d48'); this.rect(x + 2, y + 2, 156, 28, '#3e3529')
      X.drawImage(icon(t.a.icon), x + 8, y + 8, 16, 16)
      text(X, 'Advancement Made!', x + 30, y + 7, '#ff981f', false)
      text(X, t.a.n, x + 30, y + 18, '#ffffff', false)
    })
  }

  // ------------------------------------------------------------------------ containers
  open(type, key) {
    const scr = screenFor(type, this.G, key)
    if (!scr) return
    this.scr = scr; this.state = 'screen'
    if (type === 'chest') this.sfx.play('chest')
  }
  close() {
    if (this.scr) closeScreen(this.G, this.scr)
    this.scr = null; this.state = 'play'
  }
  drawScreen() {
    const X = this.x, G = this.G, P = G.player, scr = this.scr, W = this.W, H = this.H
    X.fillStyle = 'rgba(16,16,16,0.75)'; X.fillRect(0, 0, W, H)
    if (scr.type === 'creative') return this.drawCreative()
    const ox = (W - scr.w) / 2 | 0, oy = (H - scr.h) / 2 | 0
    this.panel(ox, oy, scr.w, scr.h)
    if (scr.title) text(X, scr.title, ox + scr.titleAt[0], oy + scr.titleAt[1], COL.title, false)
    if (scr.inv) text(X, 'Inventory', ox + scr.inv[0], oy + scr.inv[1], COL.title, false)
    if (scr.type === 'inv') this.drawPlayerBox(ox + 26, oy + 8)
    if (scr.type === 'inv' || scr.type === 'craft') this.arrow(ox + (scr.type === 'inv' ? 135 : 90), oy + (scr.type === 'inv' ? 29 : 36), 0)
    if (scr.type === 'furnace') {
      const f = scr.furnace
      this.arrow(ox + 79, oy + 35, f.cook / 200)
      const fl = f.burnMax ? f.burn / f.burnMax : 0
      this.flame(ox + 57, oy + 37, fl)
    }
    if (scr.type === 'trade') this.drawTrades(ox, oy)
    let hov = null
    scr.slots.forEach((s, i) => {
      const x = ox + s.x, y = oy + s.y
      this.slotBox(x, y, s.big)
      const st = s.res ? resultOf(G, scr, s) : s.arr[s.i]
      if (!st && s.sec === 'armor') { X.globalAlpha = 0.35; X.drawImage(sprite(330 + 4 + s.i), x, y); X.globalAlpha = 1 }
      this.item(st, x, y)
      if (this.over(x - 1, y - 1, 18, 18)) { hov = { s, st, i }; X.fillStyle = 'rgba(255,255,255,0.5)'; X.fillRect(x, y, 16, 16) }
      this.hit(x - 1, y - 1, 18, 18, (btn, shift) => { click(G, scr, i, btn, shift); this.sfx.play('click') }, { slot: i })
    })
    // click outside the panel: throw the held stack
    this.hit(0, 0, W, H, (btn) => { if (P.cursor && !this.over(ox, oy, scr.w, scr.h)) { const st = btn === 1 ? { ...P.cursor, n: 1 } : P.cursor; if (btn === 1) { P.cursor.n--; if (!P.cursor.n) P.cursor = null } else P.cursor = null; G.throwItem(st) } }, { back: true })
    this.hovSlot = hov
    if (P.cursor) this.item(P.cursor, this.mx - 8, this.my - 8)
    else if (hov && hov.st) this.tooltip(this.itemLines(hov.st), this.mx, this.my)
    else if (this.tipLater) this.tooltip(this.tipLater, this.mx, this.my)
    this.tipLater = null
  }
  arrow(x, y, f) {
    const A = ['.........#.............', '.........##............', '#####################.', '######################', '######################', '#####################.', '.........##............', '.........#.............']
    // MC's crafting arrow: grey, filling white left to right in a furnace
    A.forEach((r, j) => [...r].forEach((c, i) => { if (c === '#') this.rect(x + i, y + 4 + j, 1, 1, i < f * 22 ? '#ffffff' : '#5a4d3a') }))
  }
  flame(x, y, f) {
    const F = ['......#.......', '.....##.......', '....###.#.....', '...#######....', '...########...', '..##########..', '..##########..', '.############.', '.############.', '..##########..', '...########...', '....######....']
    F.forEach((r, j) => [...r].forEach((c, i) => { if (c === '#') this.rect(x + i, y + j, 1, 1, j >= (1 - f) * 12 ? (j < 5 ? '#ffd000' : j < 9 ? '#ff8800' : '#d84000') : '#5a4d3a') }))
  }
  drawPlayerBox(x, y) {
    const P = this.G.player
    this.rect(x, y, 51, 72, '#000')
    const cx = x + 25, t = performance.now() / 1000, look = Math.max(-3, Math.min(3, (this.mx - cx) / 15))
    if (this.portrait) { const c = this.portrait(51 * this.s, 72 * this.s, look * 0.25); if (c) { this.x.drawImage(c, x, y, 51, 72); return } }   // (the RS body, from the 3D view)
    // a little front-on Steve (MC draws the 3D model following the mouse)
    const r = (a, b, w, h, c) => this.rect(cx + a, y + b, w, h, c)
    const ar = P.armor.map(a => a && ITEMS[a.id] ? ['#a06540', '#d8d8d8', '#fcee4b', '#33ebcb', '#4fb0c6'][ITEMS[a.id].mat] : null)
    r(-8 + look * 0.5, 6, 16, 16, '#c69a74'); r(-8 + look * 0.5, 6, 16, 5, '#4a2e14'); r(-5 + look, 13, 3, 2, '#fff'); r(2 + look, 13, 3, 2, '#fff'); r(-4 + look, 13, 2, 2, '#3a3ab0'); r(3 + look, 13, 2, 2, '#3a3ab0'); r(-3 + look, 18, 6, 1, '#7a4a2a')
    if (ar[0]) { r(-9 + look * 0.5, 4, 18, 6, ar[0]); r(-9 + look * 0.5, 4, 2, 12, ar[0]); r(7 + look * 0.5, 4, 2, 12, ar[0]) }
    r(-8, 22, 16, 24, ar[1] || '#2ea4a4'); r(-16, 22, 8, 24, ar[1] || '#2ea4a4'); r(8, 22, 8, 24, ar[1] || '#2ea4a4'); r(-16, 34, 8, 12, '#c69a74'); r(8, 34, 8, 12, '#c69a74')
    r(-8, 46, 8, 22, ar[2] || '#3a3aa0'); r(0, 46, 8, 22, ar[2] || '#34349a')
    if (ar[3]) { r(-8, 60, 8, 8, ar[3]); r(0, 60, 8, 8, ar[3]) } else { r(-8, 64, 8, 4, '#6a6a6a'); r(0, 64, 8, 4, '#6a6a6a') }
  }
  drawTrades(ox, oy) {
    const X = this.x, scr = this.scr, v = scr.villager, G = this.G
    text(X, 'Trades', ox + 31, oy + 6, COL.title, false)
    textC(X, v.name, ox + 107 + 84, oy + 6, COL.title, false)
    v.trades.forEach((t, i) => {
      const x = ox + 5, y = oy + 17 + i * 20, w = 88, sel = scr.sel === i, out = t.uses >= t.max
      const hov = this.over(x, y, w, 20)
      this.rect(x, y, w, 20, '#000'); this.rect(x + 1, y + 1, w - 2, 18, sel ? '#7a2a16' : hov ? '#5a4d3a' : '#4b4133'); this.rect(x + 1, y + 1, w - 2, 1, '#6b5d48')
      this.item({ id: t.buy[0], n: t.buy[1] }, x + 3, y + 2)
      if (t.buy2) this.item({ id: t.buy2[0], n: t.buy2[1] }, x + 26, y + 2)
      this.rect(x + 50, y + 9, 10, 2, out ? '#a00' : '#fff'); this.rect(x + 58, y + 7, 2, 6, out ? '#a00' : '#fff')
      this.item({ id: t.sell[0], n: t.sell[1] }, x + 66, y + 2)
      if (hov) this.tipLater = [nameOf(t.sell[0]) + ' x' + t.sell[1], '§7for ' + t.buy[1] + ' ' + nameOf(t.buy[0]), out ? '§cOut of stock' : '§7' + (t.max - t.uses) + ' left']
      this.hit(x, y, w, 20, () => { if (out) return; scr.sel = i; this.fillTrade(t); this.sfx.play('click') })
    })
    this.arrow(ox + 186, oy + 33, tradeMatch(scr) ? 1 : 0)
  }
  // MC: picking an offer moves what it costs from the inventory into the trade slots
  fillTrade(t) {
    const G = this.G, P = G.player, g = this.scr.grid
    for (let i = 0; i < 2; i++) if (g[i]) { give(P.inv, g[i]); g[i] = null }
    const pull = (id, n) => { let got = 0; for (let i = 0; i < 36 && got < Math.max(n, maxStack(id)); i++) { const s = P.inv[i]; if (s && s.id === id) { const k = Math.min(s.n, maxStack(id) - got); s.n -= k; got += k; if (!s.n) P.inv[i] = null } } return got ? { id, n: got, d: 0 } : null }
    g[0] = pull(t.buy[0], t.buy[1]); if (t.buy2) g[1] = pull(t.buy2[0], t.buy2[1])
  }
  drawCreative() {
    const X = this.x, G = this.G, P = G.player, scr = this.scr, W = this.W, H = this.H
    const tabs = this.crTabs || (this.crTabs = creativeTabs())
    scr.tab = scr.tab || 0; scr.q = scr.q || ''
    const tab = tabs[scr.tab], q = scr.q.toLowerCase()
    const all = tab.search ? tabs.all.filter(id => nameOf(id).toLowerCase().includes(q)) : tab.ids
    const pw = 195, ph = 136, ox = (W - pw) / 2 | 0, oy = (H - ph) / 2 | 0 + 10
    // MC's tabs along the top, each showing its icon
    tabs.forEach((t, i) => {
      const tx = ox + i * 21, ty = oy - 22, on = i === scr.tab
      this.rect(tx, ty, 20, on ? 23 : 21, on ? COL.panel : COL.slot); this.rect(tx, ty, 20, 1, COL.hi); this.rect(tx, ty, 1, on ? 23 : 21, COL.hi); this.rect(tx + 19, ty, 1, 21, COL.lo)
      X.drawImage(icon(t.icon), tx + 2, ty + 3, 16, 16)
      if (this.over(tx, ty, 20, 21)) this.tipLater = [t.n]
      this.hit(tx, ty, 20, 21, () => { scr.tab = i; scr.page = 0; this.sfx.play('click') })
    })
    this.panel(ox, oy, pw, ph)
    const per = 45, pages = Math.max(1, Math.ceil(all.length / per)); scr.page = Math.max(0, Math.min(pages - 1, scr.page || 0))
    if (tab.search) {          // the search box: type to filter
      this.rect(ox + 80, oy + 4, 88, 11, '#000000'); this.rect(ox + 80, oy + 4, 88, 1, '#a0a0a0')
      text(X, (scr.q || '') + ((performance.now() / 500 | 0) % 2 ? '_' : ''), ox + 82, oy + 6, '#ffffff', false)
    }
    text(X, tab.n + (pages > 1 ? ' ' + (scr.page + 1) + '/' + pages : ''), ox + 8, oy + 6, COL.title, false)
    let hov = null; this.crHov = null
    for (let i = 0; i < per; i++) {
      const id = all[scr.page * per + i], x = ox + 9 + (i % 9) * 18, y = oy + 18 + ((i / 9) | 0) * 18
      this.slotBox(x, y)
      if (!id) continue
      X.drawImage(icon(id), x, y, 16, 16)
      if (this.over(x - 1, y - 1, 18, 18)) { hov = { id }; this.crHov = id; X.fillStyle = 'rgba(255,255,255,0.5)'; X.fillRect(x, y, 16, 16) }
      this.hit(x - 1, y - 1, 18, 18, (btn, shift) => { if (P.cursor) { P.cursor = null; return } if (shift) { give(P.inv, { id, n: maxStack(id), d: 0 }); return } P.cursor = { id, n: btn === 1 ? 1 : maxStack(id), d: 0 } })
    }
    scr.slots.forEach((s, i) => {
      const x = ox + s.x, y = oy + s.y
      this.slotBox(x, y); this.item(s.arr[s.i], x, y)
      if (this.over(x - 1, y - 1, 18, 18) && s.arr[s.i]) hov = { id: s.arr[s.i].id }
      this.hit(x - 1, y - 1, 18, 18, (btn, shift) => { if (shift) { s.arr[s.i] = null; return } click(G, scr, i, btn, false) })
    })
    // the bin
    const bx = ox + 173, by = oy + 112
    this.slotBox(bx, by); this.rect(bx + 3, by + 4, 10, 10, '#6a2a2a'); this.rect(bx + 2, by + 2, 12, 2, '#8a3a3a')
    if (this.over(bx, by, 16, 16) && !P.cursor) this.tipLater = ['Destroy Item']
    this.hit(bx - 1, by - 1, 18, 18, (btn, shift) => { if (shift) P.inv.fill(null, 0, 9); P.cursor = null })
    this.button(ox + 173, oy + 18, 16, 16, '<', () => { scr.page-- })
    this.button(ox + 173, oy + 38, 16, 16, '>', () => { scr.page++ })
    this.hit(ox, oy, pw, ph, () => {}, { wheel: (d) => { scr.page += d > 0 ? 1 : -1 } })
    text(X, 'Hover + 1-9: to the hotbar', ox + 8, oy + ph + 3, '#a0a0a0', true)
    if (P.cursor) X.drawImage(icon(P.cursor.id), this.mx - 8, this.my - 8, 16, 16)
    else if (hov) this.tooltip([nameOf(hov.id)], this.mx, this.my)
    else if (this.tipLater) this.tooltip(this.tipLater, this.mx, this.my)
    this.tipLater = null
  }

  // ------------------------------------------------------------------------ touch (MC Bedrock's layout)
  drawTouch() {
    const X = this.x, W = this.W, H = this.H, s = Math.min(34, Math.round(H / 7)), bx = 8, by = H - 8 - s * 3
    this.touchRects = []
    const btn = (k, x, y, w, h, label) => {
      const on = this.touchOn && this.touchOn.has(k)
      this.rect(x, y, w, h, on ? 'rgba(255,255,255,0.45)' : 'rgba(80,80,80,0.45)'); this.rect(x, y, w, 1, 'rgba(255,255,255,0.5)'); this.rect(x, y + h - 1, w, 1, 'rgba(0,0,0,0.5)')
      textC(X, label, x + w / 2, y + (h - 8) / 2, '#ffffff')
      this.touchRects.push({ k, x, y, w, h })
    }
    btn('fw', bx + s, by, s, s, '^'); btn('bk', bx + s, by + s * 2, s, s, 'v'); btn('lf', bx, by + s, s, s, '<'); btn('rt', bx + s * 2, by + s, s, s, '>'); btn('jump', bx + s, by + s, s, s, 'o')
    btn('jump2', W - 8 - s * 1.5, H - 8 - s * 2.4, s * 1.5, s * 1.5, 'Jump'); btn('sneak', W - 8 - s * 1.5, H - 4 - s * 0.85, s * 1.5, s * 0.8, 'Sneak')
    btn('inv', W / 2 + 94, H - 22, 18, 22, '...'); btn('pause', W - 24, 4, 20, 16, 'II'); btn('chat', W - 48, 4, 20, 16, 'T'); btn('drop', W / 2 - 112, H - 22, 18, 22, 'Q')
  }

  // ------------------------------------------------------------------------ input
  mouse(type, x, y, btn = 0, shift = false) {
    this.mx = x / this.s; this.my = y / this.s
    if (type === 'move') { if (this.drag) this.drag.fn(); return }
    if (type === 'up') { this.drag = null; return }
    if (type === 'wheel') { for (let i = this.hits.length - 1; i >= 0; i--) { const h = this.hits[i]; if (h.wheel && this.over(h.x, h.y, h.w, h.h)) { h.wheel(btn); return true } } return false }
    if (type === 'down') {
      for (let i = this.hits.length - 1; i >= 0; i--) {
        const h = this.hits[i]
        if (h.back || h.wheel) continue                          // (a scroll area takes the wheel, not clicks)
        if (this.over(h.x, h.y, h.w, h.h)) { if (h.drag) this.drag = h; h.fn(btn, shift); return true }
      }
      const b = this.hits.find(h => h.back); if (b) { b.fn(btn, shift); return true }
    }
    return false
  }
}
