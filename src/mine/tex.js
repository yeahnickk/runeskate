// MineScape's textures, painted pixel by pixel in Minecraft's 16x16 style: the block atlas (16 a row, nearest
// filtered), item sprites (tools, armour, food, ingots...) and the inventory icons (blocks as little isometric cubes,
// items flat), as MC's GUI shows them.
import { TILES, TI, BLOCKS, ITEMS, TIERS, KINDS, ARMOR_MATS } from './blocks.js'

const rngFor = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); let a = h >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const cl = (v) => Math.max(0, Math.min(255, v | 0))

// a 16x16 RGBA pixel buffer with helpers
class Px {
  constructor(name) { this.d = new Uint8ClampedArray(16 * 16 * 4); this.R = rngFor(name) }
  set(x, y, c, a = 255) { if (x < 0 || y < 0 || x > 15 || y > 15) return; const o = (y * 16 + x) * 4; this.d[o] = c[0]; this.d[o + 1] = c[1]; this.d[o + 2] = c[2]; this.d[o + 3] = a }
  get(x, y) { const o = (((y & 15) * 16) + (x & 15)) * 4; return [this.d[o], this.d[o + 1], this.d[o + 2], this.d[o + 3]] }
  mul(x, y, k) { const o = (y * 16 + x) * 4; this.d[o] = cl(this.d[o] * k); this.d[o + 1] = cl(this.d[o + 1] * k); this.d[o + 2] = cl(this.d[o + 2] * k) }
  // MC-ish noise: each pixel the base colour scaled by a random factor from a spread
  noise(base, spread = 0.12, pal) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (pal && this.R() < 0.35) { const c = pal[(this.R() * pal.length) | 0]; this.set(x, y, c); continue }
      const k = 1 + (this.R() * 2 - 1) * spread; this.set(x, y, base.map(v => cl(v * k)))
    }
    return this
  }
  fill(c, a = 255) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) this.set(x, y, c, a); return this }
  clear() { this.d.fill(0); return this }
  rect(x0, y0, x1, y1, c, a = 255) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c, a) }
  // blobs (ore spots): a few clusters of the ore colour with a light pixel and a dark edge
  spots(n, col, lite, dark, size = 2) {
    for (let i = 0; i < n; i++) {
      const cx = 1 + (this.R() * 13) | 0, cy = 1 + (this.R() * 13) | 0
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [0, 2], [-1, 1], [1, -1]].slice(0, 3 + size + (this.R() * 3 | 0))
      for (const [dx, dy] of pts) { this.set(cx + dx, cy + dy + 1, dark); }
      for (const [dx, dy] of pts) this.set(cx + dx, cy + dy, col)
      this.set(cx, cy, lite)
    }
  }
  // a pattern from text rows with a palette ('.' = clear)
  art(rows, pal, ox = 0, oy = 0) {
    rows.forEach((r, y) => [...r].forEach((ch, x) => { if (pal[ch]) this.set(x + ox, y + oy, pal[ch].slice(0, 3), pal[ch][3] ?? 255) }))
    return this
  }
}

const STONE = [118, 113, 105], DIRT = [114, 85, 56]   // (OSRS's warmer, browner stone and earth)
const painters = {
  grass_top(p) { p.noise([116, 182, 74], 0.08); for (let i = 0; i < 22; i++) p.mul(p.R() * 16 | 0, p.R() * 16 | 0, 0.86) },   // (green: tinted by the RS ground colour)
  dirt(p) { p.noise(DIRT, 0.07, [[106, 78, 52], [126, 95, 63], [98, 72, 47]]); for (let i = 0; i < 5; i++) p.set(p.R() * 16 | 0, p.R() * 16 | 0, [146, 112, 76]) },
  grass_side(p) { painters.dirt(p); for (let x = 0; x < 16; x++) { const h = 2 + (p.R() * 3 | 0) + (p.R() < 0.2 ? 1 : 0); for (let y = 0; y < h; y++) p.set(x, y, [106 + (p.R() * 30 | 0), 170 + (p.R() * 25 | 0), 66 + (p.R() * 20 | 0)]) } },
  stone(p) {
    p.noise(STONE, 0.05, [[110, 105, 98], [126, 121, 113], [104, 99, 92]])
    for (let i = 0; i < 6; i++) { const x = p.R() * 14 | 0, y = p.R() * 16 | 0, l = 2 + (p.R() * 4 | 0); for (let k = 0; k < l; k++) p.set(x + k, y, [94, 89, 83]); if (p.R() < 0.5) p.set(x, y - 1, [136, 131, 122]) }
  },
  cobble(p) { cells(p, 9, (k) => { const v = 98 + (k * 37 % 50); return [v + 4, v, v - 6] }, [66, 62, 58], [150, 145, 136]) },
  mossy_cobble(p) { painters.cobble(p); for (let i = 0; i < 60; i++) { const x = p.R() * 16 | 0, y = p.R() * 16 | 0; if (p.get(x, y)[0] > 80) p.set(x, y, [70 + (p.R() * 30 | 0), 110 + (p.R() * 30 | 0), 50]) } },
  bedrock(p) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const v = [40, 60, 85, 110, 140][(p.R() * 5) | 0]; p.set(x, y, [v, v, v]) } },
  sand(p) { p.noise([204, 186, 132], 0.04, [[194, 176, 122], [214, 198, 146], [186, 168, 114]]) },   // (RS desert sand: warmer)
  gravel(p) { cells(p, 14, (k) => [[130, 124, 122], [110, 104, 104], [150, 142, 140], [126, 108, 100], [96, 92, 92]][k % 5], [80, 74, 74], [175, 168, 165]) },
  water(p) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const w = Math.sin((x * 0.7 + y * 0.35) * 1.1 + p.R() * 0.4) * 0.05; p.set(x, y, [cl(46 * (1 + w)), cl(82 * (1 + w)), cl(150 * (1 + w))], 205) } for (let i = 0; i < 7; i++) { const x = p.R() * 12 | 0, y = p.R() * 16 | 0; for (let k = 0; k < 4; k++) p.set(x + k, y, [78, 118, 176], 210) } },   // (OSRS water: deep blue, pale streaks)
  lava(p) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const n = Math.sin(x * 0.8 + p.R() * 0.6) * Math.cos(y * 0.7 + x * 0.2) + p.R() * 0.5; p.set(x, y, n > 0.6 ? [255, 210, 70] : n > 0.1 ? [236, 132, 22] : [205, 82, 12]) } },
  log_side(p) {
    const cols = [[98, 74, 46], [86, 64, 40], [110, 84, 52], [78, 58, 36]]
    for (let x = 0; x < 16; x++) { const c = cols[(p.R() * 4) | 0]; for (let y = 0; y < 16; y++) p.set(x, y, c.map(v => cl(v * (0.94 + p.R() * 0.12)))) }
    for (let i = 0; i < 7; i++) { const x = p.R() * 16 | 0, y = p.R() * 12 | 0, l = 2 + (p.R() * 5 | 0); for (let k = 0; k < l; k++) p.set(x, y + k, [60, 44, 28]) }
  },
  log_top(p) { rings(p, [176, 143, 91], [152, 121, 74], [109, 85, 50]) },
  planks(p) { boards(p, [146, 104, 62], [98, 68, 40]) },   // (RS timber: warmer, redder than MC oak)
  dark_planks(p) { boards(p, [74, 50, 25], [54, 36, 18]) },
  leaves(p) { leaves(p, [52, 112, 34], 0.12) },   // (darker than MC: RS trees are a deep olive)
  birch_leaves(p) { leaves(p, [80, 132, 52], 0.12) },
  glass(p) {
    p.clear()
    for (let i = 0; i < 16; i++) { p.set(i, 0, [218, 240, 244]); p.set(i, 15, [160, 196, 204]); p.set(0, i, [218, 240, 244]); p.set(15, i, [160, 196, 204]) }
    for (const [x, y] of [[3, 3], [4, 2], [2, 4], [5, 5], [12, 10], [11, 11], [10, 12], [13, 9]]) p.set(x, y, [240, 250, 252], 230)
  },
  coal_ore(p) { painters.stone(p); p.spots(5, [45, 45, 45], [70, 70, 70], [30, 30, 30]) },
  iron_ore(p) { painters.stone(p); p.spots(5, [216, 175, 147], [236, 200, 175], [170, 125, 100]) },
  gold_ore(p) { painters.stone(p); p.spots(5, [252, 238, 75], [255, 255, 180], [204, 150, 20]) },
  diamond_ore(p) { painters.stone(p); p.spots(5, [93, 236, 245], [210, 255, 255], [30, 160, 170]) },
  redstone_ore(p) { painters.stone(p); p.spots(6, [255, 0, 0], [255, 120, 120], [150, 0, 0], 1) },
  emerald_ore(p) { painters.stone(p); p.spots(3, [23, 221, 98], [160, 255, 190], [0, 120, 40], 1) },
  rune_ore(p) { painters.stone(p); p.spots(5, [80, 170, 200], [180, 235, 250], [30, 90, 120]) },
  path_top(p) { p.noise([132, 104, 64], 0.06, [[122, 95, 58], [142, 114, 72], [116, 90, 54]]) },   // (an RS dirt road)
  path_side(p) { painters.dirt(p); const t = new Px('path_top'); painters.path_top(t); for (let x = 0; x < 16; x++) for (let y = 1; y < 3; y++) p.set(x, y, t.get(x, y)) },
  stone_bricks(p) {                                     // (RS castle wall: courses of big pale blocks, dark mortar)
    for (let row = 0; row < 4; row++) for (let b = -1; b < 3; b++) {
      const x0 = b * 8 + (row & 1 ? 4 : 0), v = 138 + (p.R() * 22 | 0), c = [v + 6, v + 2, v - 6]
      for (let y = row * 4; y < row * 4 + 4; y++) for (let x = Math.max(0, x0); x < Math.min(16, x0 + 8); x++) {
        const top = y === row * 4, edge = y === row * 4 + 3 || x === x0 + 7
        p.set(x, y, edge ? [88, 84, 78] : top ? c.map(q => cl(q * 1.08)) : c.map(q => cl(q * (0.95 + p.R() * 0.08))))
      }
    }
  },
  bricks(p) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const row = y >> 2, off = row & 1 ? 4 : 0, mortar = (y & 3) === 3 || ((x + off) & 7) === 7
      p.set(x, y, mortar ? [172, 164, 156] : [150 + (p.R() * 20 | 0), 72 + (p.R() * 14 | 0), 56 + (p.R() * 10 | 0)])
    }
  },
  snow(p) { p.noise([240, 251, 251], 0.02, [[226, 238, 240], [250, 255, 255]]) },
  mud(p) { p.noise([66, 56, 50], 0.09, [[58, 49, 44], [78, 66, 58], [52, 44, 40]]) },
  clay(p) { p.noise([160, 166, 179], 0.04, [[150, 156, 170], [170, 176, 188]]) },
  table_top(p) {
    boards(p, [162, 130, 78], [124, 99, 59])
    for (let i = 0; i < 16; i++) { p.set(i, 0, [90, 62, 34]); p.set(i, 15, [90, 62, 34]); p.set(0, i, [90, 62, 34]); p.set(15, i, [90, 62, 34]) }
    for (let i = 2; i < 14; i++) { p.set(i, 5, [102, 74, 40]); p.set(i, 10, [102, 74, 40]); p.set(5, i, [102, 74, 40]); p.set(10, i, [102, 74, 40]) }
  },
  table_side(p) {
    boards(p, [162, 130, 78], [124, 99, 59]); p.rect(0, 0, 15, 2, [104, 76, 44]); for (let x = 0; x < 16; x++) p.set(x, 1, [130, 100, 60])
    p.art(['..........', '.....kk...', '....kgk...', '...kgk....', '..kgk.....', '.kk.......'], { k: [60, 60, 60], g: [180, 180, 180] }, 1, 4)
    p.art(['..k...', '.kgk..', '..k...', '..b...', '..b...', '..b...'], { k: [60, 60, 60], g: [150, 150, 150], b: [110, 80, 40] }, 9, 5)
  },
  table_front(p) {
    boards(p, [162, 130, 78], [124, 99, 59]); p.rect(0, 0, 15, 2, [104, 76, 44]); for (let x = 0; x < 16; x++) p.set(x, 1, [130, 100, 60])
    p.art(['kkkk', 'kggk', '.b..', '.b..', '.b..', '.b..'], { k: [60, 60, 60], g: [170, 170, 170], b: [110, 80, 40] }, 3, 5)
    p.art(['.kk.', 'kggk', 'kggk', '.kk.', '..b.', '..b.'], { k: [60, 60, 60], g: [200, 200, 200], b: [110, 80, 40] }, 10, 5)
  },
  furnace_side(p) { p.noise([116, 116, 116], 0.06); for (let x = 0; x < 16; x++) { p.set(x, 0, [86, 86, 86]); p.set(x, 15, [86, 86, 86]); p.set(x, 1, [140, 140, 140]) } },
  furnace_top(p) { p.noise([128, 128, 128], 0.05); for (let i = 0; i < 16; i++) { p.set(i, 0, [92, 92, 92]); p.set(i, 15, [92, 92, 92]); p.set(0, i, [92, 92, 92]); p.set(15, i, [92, 92, 92]) } },
  furnace_front(p) { painters.furnace_side(p); p.rect(3, 8, 12, 13, [26, 26, 26]); p.rect(4, 9, 11, 12, [44, 44, 44]); for (let x = 4; x < 12; x += 2) p.rect(x, 9, x, 12, [20, 20, 20]); p.rect(3, 4, 12, 5, [90, 90, 90]) },
  furnace_lit(p) {
    painters.furnace_front(p)
    for (let y = 9; y < 13; y++) for (let x = 4; x < 12; x++) p.set(x, y, p.R() < 0.4 ? [255, 220, 90] : p.R() < 0.6 ? [250, 140, 30] : [200, 70, 10])
  },
  chest_side(p) { chest(p, false) },
  chest_front(p) { chest(p, true) },
  chest_top(p) { boards(p, [168, 112, 48], [122, 78, 30]); for (let i = 0; i < 16; i++) { p.set(i, 0, [70, 46, 20]); p.set(i, 15, [70, 46, 20]); p.set(0, i, [70, 46, 20]); p.set(15, i, [70, 46, 20]) } },
  torch(p) {
    p.clear()
    for (let y = 8; y < 16; y++) { p.set(7, y, [137, 103, 39]); p.set(8, y, [104, 78, 30]) }
    p.set(7, 6, [255, 255, 160]); p.set(8, 6, [255, 230, 80]); p.set(7, 7, [255, 200, 50]); p.set(8, 7, [240, 150, 30])
  },
  redstone_torch(p) {
    p.clear()
    for (let y = 8; y < 16; y++) { p.set(7, y, [137, 103, 39]); p.set(8, y, [104, 78, 30]) }
    p.set(7, 6, [255, 90, 70]); p.set(8, 6, [230, 30, 20]); p.set(7, 7, [200, 20, 10]); p.set(8, 7, [150, 10, 5])
  },
  fire(p) {     // (MC's fire: tongues of flame, yellow at the root, orange to red at the tips; the rest see-through)
    p.clear()
    for (let x = 0; x < 16; x++) {
      const h = 6 + (p.R() * 9 | 0) + (x % 4 === 1 ? 2 : 0)
      for (let y = 15; y > 15 - h; y--) { const k = (15 - y) / h; if (k > 0.85 && p.R() < 0.5) continue; p.set(x, y, k < 0.3 ? [255, 236, 120] : k < 0.6 ? [252, 170, 40] : k < 0.85 ? [236, 100, 20] : [190, 50, 10]) }
    }
  },
  tall_grass(p) {
    p.clear()
    for (let i = 0; i < 9; i++) { const x = 1 + (p.R() * 14 | 0), h = 6 + (p.R() * 9 | 0); let xx = x; for (let y = 15; y > 15 - h; y--) { p.set(xx, y, [70 + (p.R() * 40 | 0), 140 + (p.R() * 40 | 0), 50]); if (p.R() < 0.2) xx += p.R() < 0.5 ? -1 : 1 } }
  },
  dandelion(p) { p.clear(); for (let y = 9; y < 16; y++) p.set(7, y, [70, 140, 40]); p.set(8, 12, [70, 140, 40]); p.set(9, 11, [70, 140, 40]); p.rect(6, 6, 9, 8, [255, 236, 60]); p.set(7, 7, [250, 180, 20]); p.set(5, 7, [255, 236, 60]); p.set(10, 7, [255, 236, 60]); p.set(7, 5, [255, 236, 60]) },
  poppy(p) { p.clear(); for (let y = 9; y < 16; y++) p.set(7, y, [70, 140, 40]); p.set(6, 12, [70, 140, 40]); p.set(5, 11, [70, 140, 40]); p.rect(5, 5, 9, 8, [220, 20, 20]); p.set(7, 6, [30, 30, 30]); p.set(4, 6, [180, 10, 10]); p.set(10, 7, [180, 10, 10]) },
  slate(p) { shingles(p, [80, 82, 94]) },
  red_tiles(p) { shingles(p, [146, 60, 42]) },
  blue_slate(p) { shingles(p, [70, 82, 112]) },
  thatch_top(p) { p.noise([196, 164, 58], 0.08); rings(p, [205, 172, 62], [176, 142, 44], [150, 116, 36], true) },
  thatch_side(p) { for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) p.set(x, y, [cl(196 + (x % 3) * 8 + p.R() * 20), cl(160 + p.R() * 20), 56]); for (const y of [2, 3, 12, 13]) for (let x = 0; x < 16; x++) p.set(x, y, [126, 96, 34]) },
  wool(p) { p.noise([233, 236, 236], 0.03, [[220, 222, 222], [245, 245, 245]]) },
  bed_foot(p) { p.noise([170, 32, 32], 0.06); for (let x = 0; x < 16; x++) p.set(x, 15, [130, 20, 20]) },
  bed_head(p) { p.noise([170, 32, 32], 0.06); p.rect(1, 1, 14, 6, [240, 240, 240]); for (let x = 1; x < 15; x++) p.set(x, 6, [200, 200, 200]) },
  bed_side_foot(p) { p.clear(); p.rect(0, 7, 15, 10, [170, 32, 32]); p.rect(0, 11, 15, 12, [235, 235, 235]); p.rect(0, 13, 1, 15, [124, 99, 59]); p.rect(14, 13, 15, 15, [124, 99, 59]) },
  bed_side_head(p) { painters.bed_side_foot(p); p.rect(10, 7, 15, 10, [240, 240, 240]) },
  bed_end(p) { p.clear(); p.rect(0, 7, 15, 10, [170, 32, 32]); p.rect(0, 11, 15, 12, [235, 235, 235]); p.rect(0, 13, 1, 15, [124, 99, 59]); p.rect(14, 13, 15, 15, [124, 99, 59]) },
  wheat0(p) { crop(p, 4, [60, 160, 40]) },
  wheat1(p) { crop(p, 7, [70, 165, 40]) },
  wheat2(p) { crop(p, 11, [120, 160, 50]) },
  wheat3(p) { crop(p, 14, [190, 160, 60], true) },
  farmland(p) { p.noise([84, 56, 36], 0.08); for (let y = 1; y < 16; y += 4) for (let x = 0; x < 16; x++) p.set(x, y, [58, 38, 24]); for (let i = 0; i < 16; i++) { p.set(i, 0, [110, 78, 50]); p.set(0, i, [110, 78, 50]) } },
  birch_side(p) { p.noise([216, 215, 210], 0.03); for (let i = 0; i < 9; i++) { const x = p.R() * 14 | 0, y = p.R() * 16 | 0, l = 1 + (p.R() * 4 | 0); for (let k = 0; k < l; k++) p.set(x + k, y, [44, 44, 40]) } },
  birch_top(p) { rings(p, [200, 180, 130], [176, 156, 110], [216, 215, 210]) },
  iron_block(p) { metal(p, [220, 220, 220]) },
  gold_block(p) { metal(p, [250, 222, 60]) },
  diamond_block(p) { metal(p, [98, 232, 222]) },
  emerald_block(p) { metal(p, [64, 206, 112]) },
  rune_block(p) { metal(p, [84, 164, 196]) },
  plaster(p) {                                          // (RS house wall: cream plaster between dark timber)
    p.noise([206, 194, 160], 0.035, [[198, 186, 152], [212, 202, 170]])
    const T = [92, 64, 38]
    for (let i = 0; i < 16; i++) { p.set(i, 0, T); p.set(i, 15, T); p.set(0, i, T); p.set(15, i, [78, 54, 32]); p.set(i, 1, [110, 78, 46]) }
    for (let i = 2; i < 15; i++) { p.set(i, 15 - i, T); p.set(i + 1, 15 - i, [110, 78, 46]) }
  },
  coal_block(p) { p.noise([24, 24, 24], 0.2) },
  obsidian(p) { p.noise([22, 16, 34], 0.25, [[50, 30, 70], [10, 8, 18]]) },
  cactus_side(p) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, x % 4 === 1 ? [22, 92, 30] : [30 + (p.R() * 14 | 0), 126 + (p.R() * 14 | 0), 40]); for (let i = 0; i < 10; i++) p.set(1 + (p.R() * 14 | 0), p.R() * 16 | 0, [220, 220, 180]) },
  cactus_top(p) { p.noise([40, 130, 46], 0.06); p.rect(5, 5, 10, 10, [86, 160, 70]); p.rect(7, 7, 8, 8, [120, 190, 90]) },
  dead_bush(p) { p.clear(); const br = (x, y, dx, n) => { for (let k = 0; k < n; k++) { p.set(x, y, [120, 80, 40]); y--; if (k % 2) x += dx } }; br(7, 15, 0, 6); br(7, 11, -1, 6); br(8, 12, 1, 7); br(7, 9, 1, 4); br(6, 12, -1, 3) },
  sandstone_side(p) { p.noise([216, 203, 155], 0.04); for (let x = 0; x < 16; x++) { p.set(x, 3, [196, 182, 134]); p.set(x, 11, [196, 182, 134]); p.set(x, 0, [228, 216, 172]) } },
  sandstone_top(p) { p.noise([220, 209, 162], 0.03) },
  sapling(p) { p.clear(); for (let y = 9; y < 16; y++) { p.set(7, y, [100, 74, 40]); p.set(8, y, [90, 66, 34]) } for (let i = 0; i < 30; i++) { const x = 3 + (p.R() * 10 | 0), y = 2 + (p.R() * 8 | 0); p.set(x, y, [60 + (p.R() * 40 | 0), 130 + (p.R() * 40 | 0), 40]) } },
  door_top(p) { boards(p, [162, 130, 78], [124, 99, 59], true); p.rect(3, 3, 6, 7, [190, 220, 230]); p.rect(9, 3, 12, 7, [190, 220, 230]); p.rect(3, 9, 6, 13, [190, 220, 230]); p.rect(9, 9, 12, 13, [190, 220, 230]); frame(p, [104, 76, 44]) },
  door_bot(p) { boards(p, [162, 130, 78], [124, 99, 59], true); p.rect(3, 2, 12, 6, [140, 110, 64]); p.rect(3, 9, 12, 13, [140, 110, 64]); p.set(12, 1, [60, 60, 60]); frame(p, [104, 76, 44]) },
  ladder(p) { p.clear(); for (let y = 0; y < 16; y++) { p.set(2, y, [124, 96, 56]); p.set(3, y, [100, 76, 44]); p.set(12, y, [124, 96, 56]); p.set(13, y, [100, 76, 44]) } for (const y of [2, 6, 10, 14]) for (let x = 4; x < 12; x++) p.set(x, y, [150, 118, 70]) },
  bookshelf(p) {
    boards(p, [162, 130, 78], [124, 99, 59])
    const C = [[160, 40, 40], [40, 80, 160], [40, 130, 60], [190, 150, 60], [110, 40, 120], [70, 70, 70]]
    for (const y0 of [1, 9]) for (let x = 1; x < 15; x++) { const c = C[(p.R() * C.length) | 0], h = 5 + (p.R() * 2 | 0); for (let y = y0 + 6 - h; y < y0 + 6; y++) p.set(x, y, c) }
  },
  tnt_side(p) { p.noise([200, 50, 40], 0.06); p.rect(0, 5, 15, 10, [235, 235, 235]); p.art(['kkk.k..k.kkk', '.k..kk.k..k.', '.k..k.kk..k.', '.k..k..k..k.'], { k: [30, 30, 30] }, 2, 6) },
  tnt_top(p) { p.noise([200, 50, 40], 0.06); p.rect(5, 5, 10, 10, [120, 120, 120]); p.rect(7, 7, 8, 8, [40, 40, 40]) },
  tnt_bot(p) { p.noise([180, 44, 36], 0.06) },
  pumpkin_side(p) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, x % 4 === 0 ? [190, 106, 16] : [cl(227 + p.R() * 10 - 5), 140, 25]) },
  pumpkin_top(p) { p.noise([214, 128, 22], 0.05); p.rect(6, 6, 9, 9, [110, 84, 30]); p.rect(7, 7, 8, 8, [80, 60, 20]) },
  pumpkin_face(p) { painters.pumpkin_side(p); face(p, [50, 30, 10]) },
  jack_face(p) { painters.pumpkin_side(p); face(p, [255, 220, 90]) },
  flowing(p) { painters.water(p) },
  dirt_dark(p) { p.noise([90, 64, 44], 0.1) },
}
for (let i = 0; i < 10; i++) painters['destroy' + i] = (p) => cracks(p, i)

function cells(p, n, colOf, edge, lite) {
  const pts = []; for (let i = 0; i < n; i++) pts.push([p.R() * 16, p.R() * 16])
  const near = (x, y) => { let b = 0, bd = 1e9; pts.forEach(([a, c], k) => { for (const ox of [-16, 0, 16]) for (const oy of [-16, 0, 16]) { const d = (x - a - ox) ** 2 + (y - c - oy) ** 2; if (d < bd) { bd = d; b = k } } }); return b }
  const id = []; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) id[y * 16 + x] = near(x + 0.5, y + 0.5)
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const k = id[y * 16 + x], r = id[y * 16 + ((x + 1) & 15)], d = id[((y + 1) & 15) * 16 + x], l = id[y * 16 + ((x + 15) & 15)], u = id[((y + 15) & 15) * 16 + x]
    let c = colOf(k).map(v => cl(v * (0.94 + p.R() * 0.12)))
    if (k !== r || k !== d) c = edge; else if (k !== l || k !== u) c = lite
    p.set(x, y, c)
  }
}
function rings(p, a, b, bark, noBark) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5))
    let c = d > 6.5 && !noBark ? bark : (Math.floor(d) % 2 ? a : b)
    p.set(x, y, c.map(v => cl(v * (0.95 + p.R() * 0.1))))
  }
}
function boards(p, base, seam, vertical) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const [u, v] = vertical ? [y, x] : [x, y]
    const row = v >> 2, joint = (u + row * 5) % 16 === 0 && row !== 2
    let c = (v & 3) === 3 || joint ? seam : base.map(q => cl(q * (0.93 + p.R() * 0.1)))
    if ((v & 3) === 0 && !joint) c = c.map(q => cl(q * 1.06))
    p.set(x, y, c)
  }
}
function leaves(p, base, holes = 0.2) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (p.R() < holes) { p.set(x, y, [0, 0, 0], 0); continue }
    const k = 0.7 + p.R() * 0.45
    p.set(x, y, base.map(v => cl(v * k)))
  }
}
function shingles(p, base) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const row = y >> 2, off = row & 1 ? 2 : 0
    let c = base.map(v => cl(v * (0.9 + p.R() * 0.16)))
    if ((y & 3) === 3) c = base.map(v => cl(v * 0.62))
    else if (((x + off) & 3) === 0) c = base.map(v => cl(v * 0.78))
    else if ((y & 3) === 0) c = base.map(v => cl(v * 1.12))
    p.set(x, y, c)
  }
}
function chest(p, front) {
  boards(p, [168, 112, 48], [122, 78, 30])
  for (let i = 0; i < 16; i++) { p.set(i, 0, [70, 46, 20]); p.set(i, 15, [70, 46, 20]); p.set(0, i, [70, 46, 20]); p.set(15, i, [70, 46, 20]); p.set(i, 5, [70, 46, 20]) }
  if (front) { p.rect(7, 3, 8, 7, [200, 200, 200]); p.set(7, 7, [120, 120, 120]); p.set(8, 7, [120, 120, 120]) }
}
function metal(p, base) {
  p.noise(base, 0.03)
  for (let i = 0; i < 16; i++) { p.set(i, 0, base.map(v => cl(v * 1.15))); p.set(0, i, base.map(v => cl(v * 1.15))); p.set(i, 15, base.map(v => cl(v * 0.7))); p.set(15, i, base.map(v => cl(v * 0.7))) }
  for (let i = 2; i < 14; i++) { p.set(i, 2, base.map(v => cl(v * 0.85))); p.set(2, i, base.map(v => cl(v * 0.85))) }
}
function crop(p, h, col, ripe) {
  p.clear()
  for (const x of [2, 5, 7, 10, 13]) { for (let y = 15; y > 15 - h; y--) p.set(x + ((y >> 2) & 1), y, col.map(v => cl(v * (0.85 + p.R() * 0.3)))); if (ripe) { p.rect(x, 15 - h, x + 1, 18 - h, [150, 120, 40]) } }
}
function frame(p, c) { for (let i = 0; i < 16; i++) { p.set(i, 0, c); p.set(i, 15, c); p.set(0, i, c); p.set(15, i, c) } }
function face(p, c) { p.rect(3, 4, 5, 5, c); p.rect(10, 4, 12, 5, c); p.set(4, 3, c); p.set(11, 3, c); p.rect(3, 9, 12, 11, c); p.set(5, 12, c); p.set(9, 12, c); for (const x of [5, 9]) p.set(x, 9, [190, 106, 16]) }
function cracks(p, stage) {
  p.clear()
  const R = rngFor('cracks')
  const segs = []
  for (let b = 0; b < 10; b++) { let x = 8, y = 8, a = R() * 6.28; for (let k = 0; k < 7; k++) { a += (R() - 0.5) * 1.2; x += Math.cos(a) * 1.1; y += Math.sin(a) * 1.1; segs.push([x | 0, y | 0]) } }
  const n = Math.floor(segs.length * (stage + 1) / 10)
  for (let i = 0; i < n; i++) p.set(segs[i][0], segs[i][1], [20, 20, 20], 200)
}

// ---------------------------------------------------------------------------- the atlas
export function buildAtlas() {
  const C = document.createElement('canvas'); C.width = C.height = 256
  const x = C.getContext('2d')
  const tiles = {}
  TILES.forEach((n, i) => {
    const p = new Px(n)
    if (painters[n]) painters[n](p); else p.noise([255, 0, 255], 0)
    const id = new ImageData(p.d, 16, 16)
    x.putImageData(id, (i & 15) * 16, (i >> 4) * 16)
    const t = document.createElement('canvas'); t.width = t.height = 16; t.getContext('2d').putImageData(id, 0, 0); tiles[n] = t
  })
  return { canvas: C, tiles }
}

// ---------------------------------------------------------------------------- item sprites
const TOOL_ART = {
  pick: ['................', '.....hhhhh......', '...hhLLLLHhh....', '..hLHHHHHHHLh...', '..hhhh...sSHLh..', '........sS..hLh.', '.......sS....hLh', '......sS......hh', '.....sS.........', '....sS..........', '...sS...........', '..sS............', '.sS.............', '.s..............', '................', '................'],
  axe: ['................', '........hh......', '.......hLHh.....', '......hLHHHh....', '......hLHHHsS...', '.......hHHsS....', '........hsS.....', '.......sS.......', '......sS........', '.....sS.........', '....sS..........', '...sS...........', '..sS............', '.sS.............', '.s..............', '................'],
  shovel: ['................', '...........hhh..', '..........hLHHh.', '.........hLHHHh.', '.........hHHHh..', '..........sHh...', '.........sS.....', '........sS......', '.......sS.......', '......sS........', '.....sS.........', '....sS..........', '...sS...........', '..sS............', '..s.............', '................'],
  sword: ['.............hhh', '............hLHh', '...........hLHh.', '..........hLHh..', '.........hLHh...', '........hLHh....', '.......hLHh.....', '..hh..hLHh......', '..hHhhLHh.......', '...hHHHh........', '....hHh.........', '...sShHh........', '..sS..hh........', '.sS.............', '.s..............', '................'],
  hoe: ['................', '.......hhhhh....', '......hLHHHHh...', '.......hhhsSh...', '.........sS.....', '........sS......', '.......sS.......', '......sS........', '.....sS.........', '....sS..........', '...sS...........', '..sS............', '.sS.............', '.s..............', '................', '................'],
}
const TIER_COL = [['#9c7f4e', '#bc9862', '#5c4426'], ['#8f8f8f', '#b0b0b0', '#4f4f4f'], ['#d8d8d8', '#ffffff', '#6f6f6f'], ['#fcee4b', '#ffffb5', '#a07c00'], ['#33ebcb', '#a1fbe8', '#13806e'], ['#4fb0c6', '#b6eef9', '#1d5d74']]
const ARMOR_ART = [
  ['................', '................', '....hhhhhhhh....', '...hLLLLLLLLh...', '..hLHHHHHHHHHh..', '..hLHhhhhhhHHh..', '..hHh......hHh..', '..hHh......hHh..', '..hhh......hhh..'],
  ['................', '..hhh......hhh..', '.hLHHh....hHHHh.', '.hLHHHhhhhHHHHh.', '.hhHHHHHHHHHHhh.', '..hhLHHHHHHHhh..', '...hLHHHHHHHh...', '...hLHHHHHHHh...', '...hLHHHHHHHh...', '...hLHHHHHHHh...', '...hLHHHHHHHh...', '...hhhhhhhhhh...'],
  ['...hhhhhhhhhh...', '...hLHHHHHHHh...', '...hLHHhhHHHh...', '...hLHh..hHHh...', '...hLHh..hHHh...', '...hLHh..hHHh...', '...hLHh..hHHh...', '...hLHh..hHHh...', '...hLHh..hHHh...', '...hhhh..hhhh...'],
  ['................', '...hhh....hhh...', '...hLh....hLh...', '...hLh....hLh...', '..hLHh...hLHh...', '.hLHHh..hLHHh...', '.hhhhh..hhhhh...'],
]
const ARMOR_COL = [['#a06540', '#c68a5f', '#5e3a22'], ['#d8d8d8', '#ffffff', '#6f6f6f'], ['#fcee4b', '#ffffb5', '#a07c00'], ['#33ebcb', '#a1fbe8', '#13806e'], ['#4fb0c6', '#b6eef9', '#1d5d74']]
const STICK = { s: hex('#493615'), S: hex('#896727') }
const pal3 = (c) => ({ H: hex(c[0]), L: hex(c[1]), h: hex(c[2]), ...STICK })
const INGOT = ['................', '................', '................', '................', '.........hhh....', '......hhhLLLh...', '...hhhLLLLHHh...', '..hLLLLHHHHh....', '..hHHHHHHhh.....', '..hhHHHhh.......', '....hhh.........']
const GEM = ['................', '................', '.....hhhhhh.....', '....hLLLHHHh....', '...hLLHHHHHHh...', '..hLHHHHHHHHHh..', '..hhHHHHHHHHhh..', '...hhHHHHHHhh...', '....hhHHHHhh....', '.....hhHHhh.....', '......hhhh......', '.......hh.......']
const BALL = ['................', '................', '................', '.....hhhhh......', '....hLLHHHh.....', '...hLLHHHHHh....', '...hLHHHHHHh....', '...hHHHHHHHh....', '...hHHHHHHHh....', '....hHHHHHh.....', '.....hhhhh......']
const MEAT = ['................', '................', '................', '......hhhhh.....', '....hhHHHHHhh...', '...hHHLHHHHHHh..', '..hHHLHLHHHHHh..', '..hHHHHLHHHHHh..', '..hHHHHHHHHHh...', '...hHHHHHHhh....', '...bbhhhhh......', '..bwb...........', '..bb............']
const PILE = ['................', '................', '................', '................', '................', '................', '.......h........', '......hLh.......', '.....hLHHh......', '....hLHHHHh.....', '...hLHHHHHHh....', '..hhHHHHHHHHh...', '..hhhhhhhhhhh...']
const ITEM_ART = {
  256: [STICK_ART(), STICK],
  257: [BALL, { H: hex('#2e2e2e'), L: hex('#555555'), h: hex('#151515') }],
  263: [BALL, { H: hex('#3a2e24'), L: hex('#5f4c3a'), h: hex('#1a140f') }],
  258: [INGOT, pal3(['#d8d8d8', '#ffffff', '#6f6f6f'])],
  259: [INGOT, pal3(['#fcee4b', '#ffffb5', '#a07c00'])],
  299: [INGOT, pal3(['#4fb0c6', '#b6eef9', '#1d5d74'])],
  327: [INGOT, pal3(['#b0563c', '#d2795c', '#6a2c1c'])],
  260: [GEM, pal3(['#5decf5', '#d8ffff', '#1f9aa4'])],
  261: [GEM, pal3(['#17dd62', '#a6ffc6', '#007a2e'])],
  262: [PILE, pal3(['#ff0000', '#ff7070', '#7a0000'])],
  288: [PILE, pal3(['#f0f0e6', '#ffffff', '#a8a89c'])],
  289: [PILE, pal3(['#ffffff', '#ffffff', '#c8c8c8'])],
  277: [PILE, pal3(['#5a5a5a', '#8a8a8a', '#2a2a2a'])],
  264: [['................', '........ggg.....', '.......bgg......', '.......b........', '....hhhbhhh.....', '...hLLHHHHHh....', '..hLHHHHHHHHh...', '..hLHHHHHHHHh...', '..hHHHHHHHHHh...', '..hHHHHHHHHHh...', '...hHHHHHHHh....', '....hhh.hhh.....'], { ...pal3(['#d81c1c', '#ff7474', '#7e0a0a']), g: hex('#3f9a2c'), b: hex('#5a3d1c') }],
  265: [['................', '................', '................', '................', '.......hhhhh....', '....hhhLLLLHhh..', '..hhLLHLHLHHHHh.', '.hLHLHHLHHLHHHh.', '.hHHHHHHHHHHHh..', '..hhHHHHHHHhh...', '....hhhhhhh.....'], pal3(['#b47a2c', '#e0a858', '#6a4416'])],
  266: [['................', '...........hL...', '.........hLLh...', '........hLLh.h..', '......hhLLh.hLh.', '.....hLLHh..hLh.', '....hLHHh..hLh..', '....hHHh.hhLh...', '...hHHhhHHLh....', '..hHhHHHHhh.....', '..hhHHHhh.......', '.hHhhhh.........', '.hh.............'], pal3(['#c8a03c', '#f0d070', '#7e6018'])],
  267: [['................', '................', '................', '................', '......g.........', '....g....g......', '.......g...g....', '...g..g.........', '......g..g..g...', '.g..g....g......', '....g..g...g....', '..........g.....'], { g: hex('#4e8a2a') }],
  268: [MEAT, { ...pal3(['#c22828', '#ff8a8a', '#701010']), b: hex('#e6d6c0'), w: hex('#ffffff') }],
  269: [MEAT, { ...pal3(['#7a4422', '#a8693c', '#3c2010']), b: hex('#e6d6c0'), w: hex('#ffffff') }],
  270: [MEAT, { ...pal3(['#f0a0a0', '#ffd0d0', '#b05a5a']), b: hex('#e6d6c0'), w: hex('#ffffff') }],
  271: [MEAT, { ...pal3(['#c88a5a', '#e8b080', '#7a4a28']), b: hex('#e6d6c0'), w: hex('#ffffff') }],
  272: [MEAT, { ...pal3(['#f2c0b0', '#ffe0d6', '#b08070']), b: hex('#ffffff'), w: hex('#ffffff') }],
  273: [MEAT, { ...pal3(['#c88a40', '#eab060', '#7a4a18']), b: hex('#ffffff'), w: hex('#ffffff') }],
  285: [MEAT, { ...pal3(['#c84040', '#ff9090', '#701818']), b: hex('#ffffff'), w: hex('#ffffff') }],
  286: [MEAT, { ...pal3(['#9a5a34', '#c88a58', '#4c2810']), b: hex('#ffffff'), w: hex('#ffffff') }],
  274: [MEAT, { ...pal3(['#8a6a3c', '#6a8a3c', '#3c2c10']), b: hex('#6a8a3c'), w: hex('#ffffff') }],
  275: [['................', '..............hh', '.............hLh', '............hLh.', '...........hLh..', '..........hLh...', '.........hLh....', '........hLh.....', '.......hLh......', '......hLh.......', '.....hLh........', '....hLh.........', '..hLLh..........', '.hLh............', '.hh.............'], pal3(['#e6e2d0', '#ffffff', '#9a968a'])],
  276: [['................', '..........hh....', '.........h..h...', '.........h......', '..........h.....', '...........h....', '..........h.....', '........hh......', '.......h........', '......h.........', '.....h..........', '....h...h.......', '.....hhh........'], { h: hex('#f0f0f0') }],
  278: [['................', '.............ww.', '...........wwww.', '.........wwwwg..', '........wwwwg...', '.......wwwwg....', '......wwwwg.....', '.....wwwwg......', '....wwwwg.......', '....wwwg........', '...wwgg.........', '...gg...........', '..g.............', '.g..............'], { w: hex('#f6f6f6'), g: hex('#9a9a9a') }],
  279: [['................', '................', '...hhh....hhh...', '..hLLHhhhhHHHh..', '..hLHHHHHHHHHh..', '...hHHHHHHHHh...', '...hHHHHHHHHh...', '..hHHHHHHHHHHh..', '..hHHHhhhHHHHh..', '..hhhh...hhhh...'], pal3(['#a06540', '#c68a5f', '#5e3a22'])],
  280: [['................', '...........ggg..', '...........ggg..', '..........gg.g..', '.........s......', '........s.......', '.......s........', '......s.........', '.....s..........', '..w.s...........', '..ws............', '.wwww...........', '..w.............'], { g: hex('#c8c8c8'), s: hex('#896727'), w: hex('#f0f0f0') }],
  281: [['................', '...hhhh.........', '.....hHhh.......', '......h.Hh....t.', '.......h..Hh.t..', '........h..Hh...', '.........h..ht..', '..........h.Ht..', '...........hHt..', '..........thHt..', '.........t..Ht..', '........t...Ht..', '.......t....Ht..', '......t......t..'], { h: hex('#6a4c22'), H: hex('#896727'), t: hex('#dddddd') }],
  282: [['................', '................', '................', '...hhhhhhhhhh...', '...hLLLLLLLLh...', '...hHHHHHHHHh...', '....hLHHHHHh....', '....hLHHHHHh....', '....hHHHHHHh....', '.....hHHHHh.....', '.....hhhhhh.....'], pal3(['#a8a8a8', '#e0e0e0', '#4a4a4a'])],
  283: [['................', '................', '................', '...hhhhhhhhhh...', '...hwwwwwwwwh...', '...hHHHHHHHHh...', '....hLHHHHHh....', '....hLHHHHHh....', '....hHHHHHHh....', '.....hHHHHh.....', '.....hhhhhh.....'], { ...pal3(['#a8a8a8', '#e0e0e0', '#4a4a4a']), w: hex('#2f5bd9') }],
  287: [['................', '................', '................', '...hhhhhhhhhh...', '...hwwwwwwwwh...', '...hHHHHHHHHh...', '....hLHHHHHh....', '....hLHHHHHh....', '....hHHHHHHh....', '.....hHHHHh.....', '.....hhhhhh.....'], { ...pal3(['#a8a8a8', '#e0e0e0', '#4a4a4a']), w: hex('#f07a14') }],
  284: [['................', '................', '.......hh.......', '......hLHh......', '.....hLHHHh.....', '.....hLHHHHh....', '....hLHHHHHh....', '....hHHHHHHh....', '.....hHHHHh.....', '......hhhh......'], pal3(['#4a4a4a', '#7a7a7a', '#202020'])],
  290: [['....hhhhhhh.....', '....hLHHHHh.....', '....hLwwwwh.....', '....hLwwwwh.....', '....hLHHHHh.....', '....hLHHHHh.....', '....hLHHHHh.....', '....hLHHHkh.....', '....hLHHHHh.....', '....hLHHHHh.....', '....hLHHHHh.....', '....hLHHHHh.....', '....hhhhhhh.....'], { ...pal3(['#9c7f4e', '#bc9862', '#5c4426']), w: hex('#c8e4ee'), k: hex('#3a3a3a') }],
  291: [['................', '................', '...hhhhhhhh.....', '...hLLLLLLHh....', '...hLHHHHHHh....', '...hLHHHHHHh....', '...hLHHHHHHh....', '...hLHHHHHHh....', '...hLHHHHHHh....', '...hHHHHHHHh....', '...hhhhhhhhh....'], pal3(['#ebebdf', '#ffffff', '#a8a89a'])],
  292: [['................', '................', '...hhhhhhhhh....', '...hLLLLLLLh....', '...hLHHHHHHhw...', '...hLHHHHHHhw...', '...hLHHHHHHhw...', '...hLHHHHHHhw...', '...hLHHHHHHhw...', '...hHHHHHHHhw...', '...hhhhhhhhh....'], { ...pal3(['#7a3a1e', '#a85a34', '#40180a']), w: hex('#f0f0e0') }],
  293: [['................', '...hhhh.........', '..hLLLLh........', '..hL..Lh........', '..hL..Lh........', '...hLLh.........', '....hh..........', '..........ffff..', '.........fFFFFf.', '.........fFFFf..', '..........fff...'], { h: hex('#5a5a5a'), L: hex('#c8c8c8'), f: hex('#2a2a2a'), F: hex('#5a5a5a') }],
  294: [['................', '................', '................', '...........hh...', '..hhhhhhh.hLh...', '.hLLHHHHHhHh....', 'hLHkHHHHHHHh....', '.hHHHHHHHhHh....', '..hhhhhhh.hHh...', '...........hh...'], { ...pal3(['#c8946a', '#e8b890', '#6a4422']), k: hex('#202020') }],
  295: [['................', '................', '................', '................', '......hhhhh.....', '....hhLLLLHh....', '...hLHHHHHHHh...', '..hkHHHHHHHHh...', '...hhHHHHHhh....', '.....hhhhhHh....', '..........hHh...', '...........hh...'], { ...pal3(['#e8a0a0', '#ffd0d0', '#a05050']), k: hex('#202020') }],
  326: [['................', '................', '................', '................', '......hhhhh.....', '....hhLLLLHh....', '...hLHHHHHHHh...', '..hkHHHHHHHHh...', '...hhHHHHHhh....', '.....hhhhhHh....', '..........hHh...', '...........hh...'], { ...pal3(['#e06a3a', '#ff9a6a', '#8a2a10']), k: hex('#202020') }],
  296: [BALL, pal3(['#4fb0c6', '#b6eef9', '#1d5d74'])],
  297: [BALL, pal3(['#a0a6b3', '#c8ccd6', '#6a6e7a'])],
  298: [BALL, pal3(['#f4fafa', '#ffffff', '#b0c0c8'])],
  328: [['................', '................', '................', '................', '......hhhh......', '.....hLLHHh.....', '....hhLHHHhh....', '...hLLhhhhHHh...', '..hLLHHHHHHHHh..', '..hhLHHHHHHHhh..', '..hLhhhhhhhhHh..', '..hLLHHHHHHHHh..', '...hhhhhhhhhh...'], pal3(['#e8c430', '#fff2a0', '#8a6a08'])],
  360: [['.........f......', '........f.......', '.......kk.......', '.....hhkkhh.....', '....hRRRRRRh....', '...hRrRRRRRRh...', '..hRrRRRRRRRRh..', '..hwwwwwwwwwwh..', '..hwkkkwkwkkkh..', '..hwwkwwkwwkwh..', '..hRRRRRRRRRRh..', '...hRRRRRRRRh...', '....hRRRRRRh....', '.....hhhhhh.....'], { h: hex('#4a0e0a'), R: hex('#d0362a'), r: hex('#ff8a70'), w: hex('#f0f0f0'), k: hex('#202020'), f: hex('#ffd040') }],
  329: [['................', '................', '................', '................', '...wwwwwwwwww...', '..wrwwwwwrwwww..', '..wwwwrwwwwwrw..', '..wwwwwwwwwwww..', '..hhhhhhhhhhhh..', '..hHHHHHHHHHHh..', '..hHHHHHHHHHHh..', '..hhhhhhhhhhhh..'], { w: hex('#f6f6f6'), r: hex('#d02020'), h: hex('#7a4a24'), H: hex('#b07840') }],
}
function STICK_ART() { const r = []; for (let y = 0; y < 16; y++) { let s = ''; for (let x = 0; x < 16; x++) s += (x === 14 - y && y > 1 && y < 14) ? 'S' : (x === 13 - y && y > 1 && y < 14) ? 's' : '.'; r.push(s) } return r }

const SPR = new Map(), ICON = new Map()
let TILESC = null
export function setTiles(t) { TILESC = t }
// a 16x16 sprite canvas for an item (or a block's flat look: plants, torches, doors)
export function sprite(id) {
  if (SPR.has(id)) return SPR.get(id)
  const c = document.createElement('canvas'); c.width = c.height = 16
  const x = c.getContext('2d')
  const it = ITEMS[id]
  if (id < 256) { const b = BLOCKS[id]; if (b && b.t) x.drawImage(TILESC[id === 32 ? 'planks' : b.t.side], 0, 0) }
  else if (it && it.tool) {
    const p = new Px('t' + id); p.art(TOOL_ART[it.tool], { ...pal3(TIER_COL[it.tier]), ...(it.tier === 0 ? {} : {}) }); x.putImageData(new ImageData(p.d, 16, 16), 0, 0)
  } else if (it && it.armor !== undefined) {
    const p = new Px('a' + id), art = ARMOR_ART[it.armor], oy = (16 - art.length) >> 1
    p.art(art, pal3(ARMOR_COL[it.mat]), 0, oy); x.putImageData(new ImageData(p.d, 16, 16), 0, 0)
  } else if (ITEM_ART[id]) {
    const [art, pal] = ITEM_ART[id], p = new Px('i' + id), oy = Math.max(0, (16 - art.length) >> 1) + (art.length < 13 ? 2 : 0)
    p.art(art, pal, 0, art.length >= 14 ? 0 : oy); x.putImageData(new ImageData(p.d, 16, 16), 0, 0)
  } else { x.fillStyle = '#f0f'; x.fillRect(4, 4, 8, 8) }
  SPR.set(id, c)
  return c
}
const FLAT = (b) => !b || b.shape === 'cross' || b.shape === 'torch' || b.shape === 'door' || b.shape === 'ladder' || b.shape === 'liquid'
export const isFlat = (id) => id >= 256 || FLAT(BLOCKS[id]) || id === 32
// the GUI icon: a block as MC draws it in a slot (an isometric cube, 48 px for crisp edges), or the flat sprite
const ICON_TINT = [0.95, 0.68, 0.66]
// an item as OSRS draws it in the inventory: a 1px black outline round the shape, a dark drop shadow down-right
function osrsIcon(src) {
  const c = document.createElement('canvas'); c.width = c.height = 16
  const x = c.getContext('2d'), d = src.getContext('2d').getImageData(0, 0, 16, 16).data, o = x.createImageData(16, 16), q = o.data
  const A = (i, j) => i >= 0 && j >= 0 && i < 16 && j < 16 && d[(j * 16 + i) * 4 + 3] > 100
  for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
    const k = (j * 16 + i) * 4
    if (A(i, j)) { q[k] = d[k]; q[k + 1] = d[k + 1]; q[k + 2] = d[k + 2]; q[k + 3] = 255 }
    else if (A(i - 1, j) || A(i + 1, j) || A(i, j - 1) || A(i, j + 1)) { q[k + 3] = 255 }
    else if (A(i - 1, j - 1) || A(i - 2, j - 1)) { q[k] = 48; q[k + 1] = 32; q[k + 2] = 32; q[k + 3] = 200 }
  }
  x.putImageData(o, 0, 0)
  return c
}
export function icon(id) {
  if (ICON.has(id)) return ICON.get(id)
  const b = BLOCKS[id]
  if (isFlat(id)) { const s = osrsIcon(id === 32 ? fenceSprite() : sprite(id)); ICON.set(id, s); return s }
  const S = 48, c = document.createElement('canvas'); c.width = c.height = S
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false
  const h = Array.isArray(b.shape) ? b.shape[4] / 16 : 1
  const T = [24, 2 + (1 - h) * 22], L = [3, 13 + (1 - h) * 22], R = [45, 13 + (1 - h) * 22], C = [24, 24 + (1 - h) * 22], BL = [3, 35], BR = [45, 35], B = [24, 46]
  const facePic = (tile, shade) => {
    const t = document.createElement('canvas'); t.width = t.height = 16; const tx = t.getContext('2d'); tx.drawImage(TILESC[tile], 0, 0)
    if (b.tint) {                                     // (grass + leaves in the GUI: a typical RS field's olive, as the world tints them)
      const im = tx.getImageData(0, 0, 16, 16), d = im.data
      for (let i = 0; i < d.length; i += 4) { const w = Math.max(0, Math.min(1, (d[i + 1] - Math.max(d[i], d[i + 2])) / 255 * 6)); for (let j = 0; j < 3; j++) d[i + j] *= 1 + (ICON_TINT[j] - 1) * w }
      tx.putImageData(im, 0, 0)
    }
    tx.globalCompositeOperation = 'source-atop'; tx.fillStyle = `rgba(0,0,0,${1 - shade})`; tx.fillRect(0, 0, 16, 16); return t
  }
  const draw = (tile, shade, o, u, v) => { x.setTransform((u[0] - o[0]) / 16, (u[1] - o[1]) / 16, (v[0] - o[0]) / 16, (v[1] - o[1]) / 16, o[0], o[1]); x.drawImage(facePic(tile, shade), 0, 0) }
  const t = b.t, front = t.front || t.side
  // top: T is the far corner; left face shows the front (MC shows furnaces/tables face-on to the left)
  draw(t.top, 1, L, T, C)
  draw(front, 0.8, L, C, BL)
  draw(t.side, 0.6, C, R, B)
  x.setTransform(1, 0, 0, 1, 0, 0)
  ICON.set(id, c)
  return c
}
function fenceSprite() {
  const p = new Px('fence'), P = TILESC.planks.getContext('2d').getImageData(0, 0, 16, 16).data
  const c = (x, y) => [P[(y * 16 + x) * 4], P[(y * 16 + x) * 4 + 1], P[(y * 16 + x) * 4 + 2]]
  for (const x0 of [2, 11]) for (let y = 1; y < 16; y++) for (let x = x0; x < x0 + 3; x++) p.set(x, y, c(x, y))
  for (const y0 of [4, 9]) for (let x = 0; x < 16; x++) for (let y = y0; y < y0 + 2; y++) p.set(x, y, c(x, y).map(v => v * 0.85))
  const cv = document.createElement('canvas'); cv.width = cv.height = 16; cv.getContext('2d').putImageData(new ImageData(p.d, 16, 16), 0, 0)
  return cv
}
// the GUI art: hearts, hunger, armour, bubbles (9x9), as MC's icons.png
const K = [0, 0, 0]
export const HUD_ICONS = {
  heart: [['.kk...kk.', 'kwrk.krrk', 'kwrrkrrrk', 'krrrrrrrk', '.krrrrrk.', '..krrrk..', '...krk...', '....k....'], { k: K, w: [255, 200, 200], r: [220, 20, 20] }],
  heartHalf: [['.kk...kk.', 'kwrk.kddk', 'kwrrkdddk', 'krrrrdddk', '.krrrddk.', '..krrdk..', '...krk...', '....k....'], { k: K, w: [255, 200, 200], r: [220, 20, 20], d: [40, 10, 10] }],
  heartEmpty: [['.kk...kk.', 'kddk.kddk', 'kdddkdddk', 'kdddddddk', '.kdddddk.', '..kdddk..', '...kdk...', '....k....'], { k: K, d: [40, 10, 10] }],
  heartHurt: [['.ww...ww.', 'wddw.wddw', 'wdddwdddw', 'wdddddddw', '.wdddddw.', '..wdddw..', '...wdw...', '....w....'], { w: [255, 255, 255], d: [40, 10, 10] }],
  food: [['.....kkk.', '....kmmmk', '...kmmmmk', '..kmmmmk.', '.kbkmmk..', 'kbbkkk...', 'kwk......', '.k.......'], { k: K, m: [180, 110, 50], b: [230, 220, 200], w: [255, 255, 255] }],
  foodHalf: [['.....kkk.', '....kmmmk', '...kmmmmk', '..kmmmmk.', '.kdkmmk..', 'kddkkk...', 'kdk......', '.k.......'], { k: K, m: [180, 110, 50], d: [50, 30, 20] }],
  foodEmpty: [['.....kkk.', '....kdddk', '...kddddk', '..kddddk.', '.kdkddk..', 'kddkkk...', 'kdk......', '.k.......'], { k: K, d: [50, 30, 20] }],
  armor: [['.kkk.kkk.', 'kwwwkwwwk', 'kwwwwwwwk', '.kwwwwwk.', '.kwwwwwk.', '.kwwwwwk.', '.kwwwwwk.', '.kkkkkkk.'], { k: K, w: [210, 210, 210] }],
  armorHalf: [['.kkk.kkk.', 'kwwwkdddk', 'kwwwwdddk', '.kwwwddk.', '.kwwwddk.', '.kwwwddk.', '.kwwwddk.', '.kkkkkkk.'], { k: K, w: [210, 210, 210], d: [40, 40, 40] }],
  armorEmpty: [['.kkk.kkk.', 'kdddkdddk', 'kdddddddk', '.kdddddk.', '.kdddddk.', '.kdddddk.', '.kdddddk.', '.kkkkkkk.'], { k: K, d: [40, 40, 40] }],
  bubble: [['..kkkk...', '.kwbbbk..', 'kwbbbbbk.', 'kbbbbbbk.', 'kbbbbbbk.', 'kbbbbbbk.', '.kbbbbk..', '..kkkk...'], { k: [20, 40, 120], w: [255, 255, 255], b: [80, 140, 255] }],
}
const HI = new Map()
export function hudIcon(n) {
  if (HI.has(n)) return HI.get(n)
  const [rows, pal] = HUD_ICONS[n], c = document.createElement('canvas'); c.width = c.height = 9
  const p = new Px(n); p.art(rows, pal); const im = new ImageData(16, 16); im.data.set(p.d)
  const t = document.createElement('canvas'); t.width = t.height = 16; t.getContext('2d').putImageData(im, 0, 0)
  c.getContext('2d').drawImage(t, 0, 0)
  HI.set(n, c)
  return c
}
// the pixels of a sprite (for the extruded held/dropped item mesh)
export function spritePixels(id) { const c = id < 256 && isFlat(id) ? (id === 32 ? fenceSprite() : sprite(id)) : sprite(id); return c.getContext('2d').getImageData(0, 0, 16, 16).data }
