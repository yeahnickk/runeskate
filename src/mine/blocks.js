// MineScape's blocks + items, recipes, smelting, fuel: Minecraft's own numbers (hardness, tool tiers and speeds, food,
// armour points, burn times). Pure data, shared by the client and the headless tests. Block ids < 256 (ids 0-23 are
// baked into assets/mine_world.bin by tools/mine-bake.py, never renumber them); items 256+.

// atlas tiles, 16 a row; tex.js paints each by name
export const TILES = ['grass_top', 'grass_side', 'dirt', 'stone', 'cobble', 'bedrock', 'sand', 'gravel', 'water', 'lava', 'log_side', 'log_top',
  'planks', 'leaves', 'glass', 'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'redstone_ore', 'emerald_ore', 'path_top', 'path_side',
  'stone_bricks', 'snow', 'mud', 'table_top', 'table_side', 'table_front', 'furnace_front', 'furnace_lit', 'furnace_side', 'furnace_top',
  'chest_front', 'chest_side', 'chest_top', 'torch', 'tall_grass', 'dandelion', 'poppy', 'slate', 'red_tiles', 'thatch_top', 'thatch_side',
  'dark_planks', 'blue_slate', 'wool', 'bed_head', 'bed_foot', 'bed_side_head', 'bed_side_foot', 'bed_end', 'wheat0', 'wheat1', 'wheat2', 'wheat3',
  'farmland', 'birch_side', 'birch_top', 'birch_leaves', 'iron_block', 'gold_block', 'diamond_block', 'cactus_side', 'cactus_top', 'dead_bush',
  'sandstone_side', 'sandstone_top', 'coal_block', 'obsidian', 'sapling', 'bricks', 'door_top', 'door_bot', 'ladder', 'bookshelf', 'tnt_side', 'tnt_top',
  'tnt_bot', 'pumpkin_side', 'pumpkin_top', 'pumpkin_face', 'jack_face', 'clay', 'mossy_cobble', 'flowing', 'dirt_dark', 'emerald_block', 'rune_ore',
  'rune_block', 'plaster', 'fire', 'redstone_torch', 'destroy0', 'destroy1', 'destroy2', 'destroy3', 'destroy4', 'destroy5', 'destroy6', 'destroy7', 'destroy8', 'destroy9']
export const TI = Object.fromEntries(TILES.map((n, i) => [n, i]))

// shapes: 'cube' (default), 'cross' (plants), 'torch', 'liquid', 'fence', 'door', 'ladder', or a box [x0,y0,z0,x1,y1,z1] in 16ths
// op: opaque full cube (culls neighbours, blocks light). tr: 'cut' (alpha tested), 'blend' (water). snd: step/dig sounds.
const B = []
function blk(id, n, o) {
  const d = { id, n, shape: 'cube', solid: true, op: true, h: 1, snd: 'stone', light: 0, opac: 15, ...o }
  if (typeof d.t === 'string') d.t = { top: d.t, bot: d.t, side: d.t }
  else if (d.t) d.t = { top: d.t.top || d.t.side, bot: d.t.bot || d.t.top || d.t.side, side: d.t.side || d.t.top, front: d.t.front }
  if (!d.op && d.opac === 15) d.opac = d.shape === 'cube' && d.tr === 'cut' ? 1 : 0
  if (d.drop === undefined) d.drop = id
  B[id] = d
  return d
}
const PICK = 'pick', AXE = 'axe', SHOVEL = 'shovel', HOE = 'hoe'
blk(0, 'Air', { solid: false, op: false, opac: 0, shape: 'none', drop: null, rep: true })
blk(1, 'Grass Block', { t: { top: 'grass_top', bot: 'dirt', side: 'grass_side' }, h: 0.6, tool: SHOVEL, drop: 2, snd: 'grass' })
blk(2, 'Dirt', { t: 'dirt', h: 0.5, tool: SHOVEL, snd: 'gravel' })
blk(3, 'Stone', { t: 'stone', h: 1.5, tool: PICK, tier: 0, drop: 4 })
blk(4, 'Cobblestone', { t: 'cobble', h: 2, tool: PICK, tier: 0 })
blk(5, 'Bedrock', { t: 'bedrock', h: -1, drop: null })
blk(6, 'Sand', { t: 'sand', h: 0.5, tool: SHOVEL, fall: true, snd: 'sand' })
blk(7, 'Gravel', { t: 'gravel', h: 0.6, tool: SHOVEL, fall: true, snd: 'gravel', drops: (r) => r() < 0.1 ? [[284, 1]] : [[7, 1]] })
blk(8, 'Water', { t: 'water', h: -2, solid: false, op: false, tr: 'blend', shape: 'liquid', opac: 2, drop: null, rep: true, liquid: 'water' })
blk(9, 'Lava', { t: 'lava', h: -2, solid: false, op: false, shape: 'liquid', opac: 0, light: 15, drop: null, rep: true, liquid: 'lava' })
blk(10, 'Oak Log', { t: { top: 'log_top', side: 'log_side' }, h: 2, tool: AXE, snd: 'wood', fuel: 300, log: true })
blk(11, 'Oak Planks', { t: 'planks', h: 2, tool: AXE, snd: 'wood', fuel: 300 })
blk(12, 'Oak Leaves', { t: 'leaves', h: 0.2, tool: HOE, op: false, tr: 'cut', snd: 'grass', leaves: true,
  drops: (r) => { const o = []; if (r() < 0.05) o.push([65, 1]); if (r() < 0.02) o.push([264, 1]); if (r() < 0.02) o.push([256, 1]); return o } })
blk(13, 'Glass', { t: 'glass', h: 0.3, op: false, tr: 'cut', snd: 'glass', drop: null, opac: 0 })
blk(14, 'Coal Ore', { t: 'coal_ore', h: 3, tool: PICK, tier: 0, drop: 257, xp: [0, 2] })
blk(15, 'Iron Ore', { t: 'iron_ore', h: 3, tool: PICK, tier: 1 })
blk(16, 'Gold Ore', { t: 'gold_ore', h: 3, tool: PICK, tier: 2 })
blk(17, 'Diamond Ore', { t: 'diamond_ore', h: 3, tool: PICK, tier: 2, drop: 260, xp: [3, 7] })
blk(18, 'Redstone Ore', { t: 'redstone_ore', h: 3, tool: PICK, tier: 2, drops: (r) => [[262, 4 + (r() * 2 | 0)]], xp: [1, 5] })
blk(19, 'Emerald Ore', { t: 'emerald_ore', h: 3, tool: PICK, tier: 2, drop: 261, xp: [3, 7] })
blk(20, 'Dirt Path', { t: { top: 'path_top', bot: 'dirt', side: 'path_side' }, shape: [0, 0, 0, 16, 15, 16], op: false, opac: 15, h: 0.65, tool: SHOVEL, drop: 2, snd: 'gravel' })
blk(21, 'Stone Bricks', { t: 'stone_bricks', h: 1.5, tool: PICK, tier: 0 })
blk(22, 'Snow Block', { t: 'snow', h: 0.2, tool: SHOVEL, snd: 'cloth' })
blk(23, 'Mud', { t: 'mud', h: 0.5, tool: SHOVEL, snd: 'gravel' })
blk(24, 'Crafting Table', { t: { top: 'table_top', bot: 'planks', side: 'table_side', front: 'table_front' }, h: 2.5, tool: AXE, snd: 'wood', fuel: 300, use: 'craft' })
blk(25, 'Furnace', { t: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front' }, h: 3.5, tool: PICK, tier: 0, use: 'furnace', facing: true })
blk(26, 'Furnace', { t: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_lit' }, h: 3.5, tool: PICK, tier: 0, use: 'furnace', drop: 25, light: 13, facing: true })
blk(27, 'Chest', { t: { top: 'chest_top', side: 'chest_side', front: 'chest_front' }, shape: [1, 0, 1, 15, 14, 15], op: false, opac: 0, h: 2.5, tool: AXE, snd: 'wood', use: 'chest', facing: true, fuel: 300 })
blk(28, 'Torch', { t: 'torch', h: 0, solid: false, op: false, shape: 'torch', light: 14, snd: 'wood', sup: true })
blk(29, 'Grass', { t: 'tall_grass', h: 0, solid: false, op: false, shape: 'cross', tr: 'cut', snd: 'grass', rep: true, sup: true, drops: (r) => r() < 0.125 ? [[267, 1]] : [] })
blk(30, 'Dandelion', { t: 'dandelion', h: 0, solid: false, op: false, shape: 'cross', tr: 'cut', snd: 'grass', sup: true })
blk(31, 'Poppy', { t: 'poppy', h: 0, solid: false, op: false, shape: 'cross', tr: 'cut', snd: 'grass', sup: true })
blk(32, 'Oak Fence', { t: 'planks', shape: 'fence', op: false, opac: 0, h: 2, tool: AXE, snd: 'wood', fuel: 300 })
blk(33, 'Slate Roof', { t: 'slate', h: 1.5, tool: PICK, tier: 0 })
blk(34, 'Red Roof Tiles', { t: 'red_tiles', h: 1.25, tool: PICK, tier: 0 })
blk(35, 'Hay Bale', { t: { top: 'thatch_top', side: 'thatch_side' }, h: 0.5, tool: HOE, snd: 'grass' })
blk(36, 'Dark Oak Planks', { t: 'dark_planks', h: 2, tool: AXE, snd: 'wood', fuel: 300 })
blk(37, 'Blue Slate Roof', { t: 'blue_slate', h: 1.5, tool: PICK, tier: 0 })
blk(38, 'Bricks', { t: 'bricks', h: 2, tool: PICK, tier: 0 })
blk(39, 'White Wool', { t: 'wool', h: 0.8, snd: 'cloth', fuel: 100 })
blk(40, 'Red Bed', { t: { top: 'bed_foot', side: 'bed_side_foot', bot: 'planks', front: 'bed_end' }, shape: [0, 0, 0, 16, 9, 16], op: false, opac: 0, h: 0.2, snd: 'cloth', use: 'bed', facing: true, bed: 1 })
blk(41, 'Wheat Crops', { t: 'wheat0', h: 0, solid: false, op: false, shape: 'cross', tr: 'cut', snd: 'grass', sup: true, crop: 0, drops: () => [[267, 1]] })
blk(42, 'Wheat Crops', { t: 'wheat1', h: 0, solid: false, op: false, shape: 'cross', tr: 'cut', snd: 'grass', sup: true, crop: 1, drops: () => [[267, 1]] })
blk(43, 'Wheat Crops', { t: 'wheat2', h: 0, solid: false, op: false, shape: 'cross', tr: 'cut', snd: 'grass', sup: true, crop: 2, drops: () => [[267, 1]] })
blk(44, 'Wheat Crops', { t: 'wheat3', h: 0, solid: false, op: false, shape: 'cross', tr: 'cut', snd: 'grass', sup: true, crop: 3, drops: (r) => [[266, 1], [267, 1 + (r() * 3 | 0)]] })
blk(45, 'Farmland', { t: { top: 'farmland', bot: 'dirt', side: 'dirt' }, shape: [0, 0, 0, 16, 15, 16], op: false, opac: 15, h: 0.6, tool: SHOVEL, drop: 2, snd: 'gravel' })
blk(46, 'Birch Log', { t: { top: 'birch_top', side: 'birch_side' }, h: 2, tool: AXE, snd: 'wood', fuel: 300, log: true })
blk(47, 'Birch Leaves', { t: 'birch_leaves', h: 0.2, tool: HOE, op: false, tr: 'cut', snd: 'grass', leaves: true,
  drops: (r) => { const o = []; if (r() < 0.05) o.push([66, 1]); if (r() < 0.02) o.push([256, 1]); return o } })
blk(48, 'Block of Iron', { t: 'iron_block', h: 5, tool: PICK, tier: 1 })
blk(49, 'Block of Gold', { t: 'gold_block', h: 3, tool: PICK, tier: 2 })
blk(50, 'Block of Diamond', { t: 'diamond_block', h: 5, tool: PICK, tier: 2 })
blk(51, 'Cactus', { t: { top: 'cactus_top', side: 'cactus_side' }, shape: [1, 0, 1, 15, 16, 15], op: false, opac: 0, h: 0.4, snd: 'cloth', cactus: true, sup: true })
blk(52, 'Dead Bush', { t: 'dead_bush', h: 0, solid: false, op: false, shape: 'cross', tr: 'cut', snd: 'grass', rep: true, sup: true, drops: (r) => [[256, r() * 3 | 0]] })
blk(53, 'Sandstone', { t: { top: 'sandstone_top', side: 'sandstone_side' }, h: 0.8, tool: PICK, tier: 0 })
blk(54, 'Block of Coal', { t: 'coal_block', h: 5, tool: PICK, tier: 0, fuel: 16000 })
blk(55, 'Obsidian', { t: 'obsidian', h: 50, tool: PICK, tier: 3 })
blk(56, 'Oak Door', { t: 'door_bot', shape: 'door', op: false, opac: 0, h: 3, tool: AXE, snd: 'wood', use: 'door', door: 1, drop: 290 })
blk(57, 'Oak Door', { t: 'door_top', shape: 'door', op: false, opac: 0, h: 3, tool: AXE, snd: 'wood', use: 'door', door: 2, drop: null })
blk(58, 'Ladder', { t: 'ladder', shape: 'ladder', op: false, opac: 0, solid: false, h: 0.4, tool: AXE, snd: 'wood', climb: true, tr: 'cut', fuel: 300 })
blk(59, 'Bookshelf', { t: { top: 'planks', side: 'bookshelf' }, h: 1.5, tool: AXE, snd: 'wood', fuel: 300 })
blk(60, 'TNT', { t: { top: 'tnt_top', bot: 'tnt_bot', side: 'tnt_side' }, h: 0, snd: 'grass', tnt: true })
blk(61, 'Pumpkin', { t: { top: 'pumpkin_top', side: 'pumpkin_side', front: 'pumpkin_face' }, h: 1, tool: AXE, snd: 'wood', facing: true })
blk(62, "Jack o'Lantern", { t: { top: 'pumpkin_top', side: 'pumpkin_side', front: 'jack_face' }, h: 1, tool: AXE, snd: 'wood', facing: true, light: 15 })
blk(63, 'Mossy Cobblestone', { t: 'mossy_cobble', h: 2, tool: PICK, tier: 0 })
blk(64, 'Block of Emerald', { t: 'emerald_block', h: 5, tool: PICK, tier: 2 })
blk(65, 'Oak Sapling', { t: 'sapling', h: 0, solid: false, op: false, shape: 'cross', tr: 'cut', snd: 'grass', sup: true, sapling: 10, fuel: 100 })
blk(66, 'Birch Sapling', { t: 'sapling', h: 0, solid: false, op: false, shape: 'cross', tr: 'cut', snd: 'grass', sup: true, sapling: 46, fuel: 100 })
blk(67, 'Runite Ore', { t: 'rune_ore', h: 30, tool: PICK, tier: 3, drop: 296, xp: [6, 12] })   // (MineScape's own: OSRS runite under the Wilderness)
blk(68, 'Block of Runite', { t: 'rune_block', h: 6, tool: PICK, tier: 3 })
blk(69, 'Clay', { t: 'clay', h: 0.6, tool: SHOVEL, snd: 'gravel', drops: () => [[297, 4]] })
blk(71, 'Plaster', { t: 'plaster', h: 1.2, tool: PICK, tier: 0, drop: 71 })   // (MineScape's own: RS houses' cream walls with timber)
blk(70, 'Snow', { t: 'snow', shape: [0, 0, 0, 16, 2, 16], op: false, opac: 0, solid: false, h: 0.1, tool: SHOVEL, snd: 'cloth', rep: true, sup: true, drops: () => [[298, 1]] })
// MineScape's own, from the RS map: walls and fences stand on tile edges as RS draws them (meta bits: 1 west, 2 south,
// 4 east, 8 north), trees fell whole like RS woodcutting, scenery is an RS object that blocks its tile. None of them
// float: dig out (or knock out) what holds one up and it comes down (sup)
const WALLB = (id, n, drop, h) => blk(id, n, { t: 'stone', shape: 'edge', op: false, opac: 0, h, tool: PICK, tier: 0, drop, wall: true, sup: true })
WALLB(72, 'Stone Wall', 21, 1.5); WALLB(73, 'Plaster Wall', 71, 1.2); WALLB(75, 'Brick Wall', 38, 2); WALLB(76, 'Dark Stone Wall', 4, 2); WALLB(77, 'Sandstone Wall', 53, 0.8)
blk(74, 'Timber Wall', { t: 'planks', shape: 'edge', op: false, opac: 0, h: 2, tool: AXE, snd: 'wood', drop: 11, wall: true, fuel: 300, sup: true })
blk(78, 'Fence', { t: 'planks', shape: 'edge', op: false, opac: 0, h: 2, tool: AXE, snd: 'wood', drop: 32, fence: true, fuel: 300, sup: true })
blk(79, 'Tree', { t: { top: 'log_top', side: 'log_side' }, h: 2, tool: AXE, snd: 'wood', tree: true, drop: null, sup: true })
blk(80, 'Scenery', { t: 'planks', h: 1.5, tool: AXE, snd: 'wood', drop: 11, scenery: true, sup: true })
blk(81, 'Fire', { t: 'fire', shape: 'cross', tr: 'cut', solid: false, op: false, h: 0, light: 15, drop: null, rep: true, fire: true, snd: 'cloth' })
blk(82, 'Redstone Torch', { t: 'redstone_torch', h: 0, solid: false, op: false, shape: 'torch', light: 7, snd: 'wood', sup: true, power: true })   // (lights TNT it touches)
// MC's fire: [encouragement (how readily fire spreads to the air beside it), flammability (how readily it burns away)]
for (const [ids, b] of [[[10, 46, 79], [5, 5]], [[11, 36, 32, 78, 74, 80], [5, 20]], [[12, 47, 39], [30, 60]], [[59], [30, 20]], [[60], [15, 100]], [[35], [60, 20]], [[29, 30, 31, 52], [60, 100]]]) for (const i of ids) B[i].burn = b
// MC's biome colouring: these take the RS ground colour (world.tintAt) over their green
for (const i of [1, 12, 29, 30, 31, 47, 65, 66]) B[i].tint = true
export const BLOCKS = B
// a liquid's surface in its block by its level (meta: 0 source, 1-7 flowing, 8 falling: MC's levels)
export const liquidTop = (m) => { const l = m & 15; return l === 0 || l >= 8 ? 14 / 16 : (8 - l) / 9 }

// ---------------------------------------------------------------------------- items
// tiers: wood 0, stone 1, iron 2, diamond 3, gold (harvests as wood), runite 4 (MineScape: past diamond)
export const TIERS = [
  { n: 'Wooden', mat: 11, speed: 2, dur: 59, lvl: 0, dmg: 0 },
  { n: 'Stone', mat: 4, speed: 4, dur: 131, lvl: 1, dmg: 1 },
  { n: 'Iron', mat: 258, speed: 6, dur: 250, lvl: 2, dmg: 2 },
  { n: 'Golden', mat: 259, speed: 12, dur: 32, lvl: 0, dmg: 0 },
  { n: 'Diamond', mat: 260, speed: 8, dur: 1561, lvl: 3, dmg: 3 },
  { n: 'Runite', mat: 299, speed: 10, dur: 2400, lvl: 4, dmg: 4 },
]
export const KINDS = ['sword', 'shovel', 'pick', 'axe', 'hoe']
const KN = { sword: 'Sword', shovel: 'Shovel', pick: 'Pickaxe', axe: 'Axe', hoe: 'Hoe' }
export const ARMOR_MATS = [
  { n: 'Leather', mat: 279, pts: [1, 3, 2, 1], dur: 5, col: '#a06540' },
  { n: 'Iron', mat: 258, pts: [2, 6, 5, 2], dur: 15, col: '#d8d8d8' },
  { n: 'Golden', mat: 259, pts: [2, 5, 3, 1], dur: 7, col: '#fcee4b' },
  { n: 'Diamond', mat: 260, pts: [3, 8, 6, 3], dur: 33, col: '#33ebcb' },
  { n: 'Rune', mat: 299, pts: [3, 8, 6, 3], dur: 40, col: '#4fb0c6', tough: 2 },
]
export const ARMOR_SLOTS = ['Helmet', 'Chestplate', 'Leggings', 'Boots']
const ARMOR_DUR = [11, 16, 15, 13]

const I = []
function itm(id, n, o = {}) { I[id] = { id, n, max: 64, ...o }; return I[id] }
itm(256, 'Stick', { fuel: 100 })
itm(257, 'Coal', { fuel: 1600 })
itm(258, 'Iron Ingot')
itm(259, 'Gold Ingot')
itm(260, 'Diamond')
itm(261, 'Emerald')
itm(262, 'Redstone Dust')
itm(263, 'Charcoal', { fuel: 1600 })
itm(264, 'Apple', { food: [4, 2.4] })
itm(265, 'Bread', { food: [5, 6] })
itm(266, 'Wheat')
itm(267, 'Wheat Seeds', { plant: 41 })
itm(268, 'Raw Beef', { food: [3, 1.8] })
itm(269, 'Steak', { food: [8, 12.8] })
itm(270, 'Raw Porkchop', { food: [3, 1.8] })
itm(271, 'Cooked Porkchop', { food: [8, 12.8] })
itm(272, 'Raw Chicken', { food: [2, 1.2], poison: 0.3 })
itm(273, 'Cooked Chicken', { food: [6, 7.2] })
itm(274, 'Rotten Flesh', { food: [4, 0.8], poison: 0.8 })
itm(275, 'Bone')
itm(276, 'String')
itm(277, 'Gunpowder')
itm(278, 'Feather')
itm(279, 'Leather')
itm(280, 'Arrow')
itm(281, 'Bow', { max: 1, dur: 384, bow: true })
itm(282, 'Bucket', { max: 16, bucket: 0 })
itm(283, 'Water Bucket', { max: 1, bucket: 8 })
itm(284, 'Flint')
itm(285, 'Raw Mutton', { food: [2, 1.2] })
itm(286, 'Cooked Mutton', { food: [6, 9.6] })
itm(287, 'Lava Bucket', { max: 1, bucket: 9, fuel: 20000 })
itm(288, 'Bone Meal', { meal: true })
itm(289, 'Sugar')
itm(290, 'Oak Door', { place: 56 })
itm(291, 'Paper')
itm(292, 'Book')
itm(293, 'Flint and Steel', { max: 1, dur: 64, fire: true })
itm(294, 'Cooked Cod', { food: [5, 6] })
itm(295, 'Raw Shrimps', { food: [1, 0.2] })    // (OSRS: the first fish; cooks to Shrimps)
itm(296, 'Runite Ore', {})
itm(297, 'Clay Ball')
itm(298, 'Snowball', { max: 16 })
itm(299, 'Runite Bar')
itm(326, 'Shrimps', { food: [3, 3.6] })
itm(327, 'Brick')
itm(328, 'Coins', {})                            // (what OSRS villagers pay in, alongside emeralds)
itm(329, 'Cake', { food: [14, 2.8] })
TIERS.forEach((t, ti) => KINDS.forEach((k, ki) => {
  const id = 300 + ti * 5 + ki
  if (ti === 5) return                          // (runite tools live at 350+)
  itm(id, t.n + ' ' + KN[k], { max: 1, tool: k, tier: ti, dur: t.dur, fuel: ti === 0 ? 200 : 0 })
}))
KINDS.forEach((k, ki) => itm(350 + ki, 'Runite ' + KN[k], { max: 1, tool: k, tier: 5, dur: TIERS[5].dur }))
ARMOR_MATS.forEach((m, mi) => ARMOR_SLOTS.forEach((s, si) => {
  const id = 330 + mi * 4 + si
  itm(id, m.n === 'Leather' ? ['Leather Cap', 'Leather Tunic', 'Leather Pants', 'Leather Boots'][si] : m.n + ' ' + s,
    { max: 1, armor: si, mat: mi, pts: m.pts[si], dur: m.dur * ARMOR_DUR[si], tough: m.tough || 0 })
}))
export const ITEMS = I
export const toolId = (tier, kind) => tier === 5 ? 350 + KINDS.indexOf(kind) : 300 + tier * 5 + KINDS.indexOf(kind)

// melee: MC 1.9+ damage + attack speed (per second)
const SWORD = [4, 5, 6, 4, 7, 8], AXE_D = [7, 9, 9, 7, 9, 10], AXE_S = [0.8, 0.8, 0.9, 1, 1, 1]
export function melee(id) {
  const it = I[id]
  if (!it || !it.tool) return { dmg: 2, speed: 4 }                 // (a punch: RS's 1-2, so a goblin takes three)
  const t = it.tier
  if (it.tool === 'sword') return { dmg: SWORD[t], speed: 1.6 }
  if (it.tool === 'axe') return { dmg: AXE_D[t], speed: AXE_S[t] }
  if (it.tool === 'pick') return { dmg: 2 + TIERS[t].dmg, speed: 1.2 }
  if (it.tool === 'shovel') return { dmg: 2.5 + TIERS[t].dmg, speed: 1 }
  return { dmg: 1, speed: [1, 2, 3, 1, 4, 4][t] }
}

export const def = (id) => id < 256 ? B[id] : I[id]
export const nameOf = (id) => (def(id) || { n: '?' }).n
export const maxStack = (id) => id < 256 ? (B[id] && B[id].max) || 64 : I[id] ? I[id].max : 64
export const isBlock = (id) => id > 0 && id < 256 && !!B[id]
export const fuelOf = (id) => { const d = def(id); return d && d.fuel || 0 }

// what placing an item puts in the world
export function placeOf(id) {
  if (id < 256) return B[id] && id !== 0 && !B[id].liquid && !B[id].door ? id : 0
  const it = I[id]
  return it && (it.place || it.plant) || 0
}

// MC's dig speed: ticks to break, or Infinity. holding: item id or 0. canHarvest says whether it drops.
export function digInfo(bid, holding, opts = {}) {
  const b = B[bid]
  if (!b || b.h < 0) return { ticks: Infinity, harvest: false }
  const it = I[holding], tool = it && it.tool, tier = it && it.tool ? it.tier : -1
  const lvl = tier >= 0 ? TIERS[tier].lvl : -1
  const right = tool && tool === b.tool
  const harvest = b.tier === undefined || (tool === 'pick' && lvl >= b.tier)
  let speed = right ? TIERS[tier].speed : 1
  if (tool === 'sword' && (b.leaves || bid === 29)) speed = 1.5
  if (opts.water) speed /= 5
  if (opts.air) speed /= 5
  if (b.h === 0) return { ticks: 0, harvest }
  const dmg = speed / b.h / (harvest ? 30 : 100)
  return { ticks: dmg >= 1 ? 0 : Math.ceil(1 / dmg), harvest }
}

export function dropsOf(bid, rng, harvest) {
  const b = B[bid]
  if (!b || !harvest) return []
  if (b.drops) return b.drops(rng).filter(d => d[1] > 0)
  return b.drop ? [[b.drop, 1]] : []
}

// ---------------------------------------------------------------------------- crafting
// shaped: rows of keys (any size up to 3x3, matched anywhere in the grid, mirrored too); shapeless: a list of ids
export const RECIPES = []
const shaped = (rows, keys, out, n = 1) => RECIPES.push({ rows, keys, out, n })
const shapeless = (ins, out, n = 1) => RECIPES.push({ ins, out, n })
const PLANKS = [11, 36]
shapeless([10], 11, 4); shapeless([46], 11, 4)
shaped(['P', 'P'], { P: PLANKS }, 256, 4)
shaped(['PP', 'PP'], { P: PLANKS }, 24)
shaped(['CCC', 'C C', 'CCC'], { C: [4, 63] }, 25)
shaped(['PPP', 'P P', 'PPP'], { P: PLANKS }, 27)
shaped(['C', 'S'], { C: [257, 263], S: 256 }, 28, 4)
TIERS.forEach((t, ti) => {
  const M = ti === 0 ? PLANKS : t.mat
  shaped(['M', 'M', 'S'], { M, S: 256 }, toolId(ti, 'sword'))
  shaped(['M', 'S', 'S'], { M, S: 256 }, toolId(ti, 'shovel'))
  shaped(['MMM', ' S ', ' S '], { M, S: 256 }, toolId(ti, 'pick'))
  shaped(['MM', 'MS', ' S'], { M, S: 256 }, toolId(ti, 'axe'))
  shaped(['MM', ' S', ' S'], { M, S: 256 }, toolId(ti, 'hoe'))
})
ARMOR_MATS.forEach((m, mi) => {
  shaped(['MMM', 'M M'], { M: m.mat }, 330 + mi * 4)
  shaped(['M M', 'MMM', 'MMM'], { M: m.mat }, 331 + mi * 4)
  shaped(['MMM', 'M M', 'M M'], { M: m.mat }, 332 + mi * 4)
  shaped(['M M', 'M M'], { M: m.mat }, 333 + mi * 4)
})
shaped(['WWW'], { W: 266 }, 265)
shaped(['WWW', 'PPP'], { W: 39, P: PLANKS }, 40)
shaped(['SS', 'SS'], { S: 276 }, 39)
shaped(['SS', 'SS'], { S: 3 }, 21, 4)
shaped(['SS', 'SS'], { S: 6 }, 53)
shaped(['SS', 'SS'], { S: 297 }, 69)
shaped(['BB', 'BB'], { B: 327 }, 38)
shaped(['I I', ' I '], { I: 258 }, 282)
shaped([' TS', 'T S', ' TS'], { T: 256, S: 276 }, 281)
shaped(['F', 'S', 'E'], { F: 284, S: 256, E: 278 }, 280, 4)
shaped(['PSP', 'PSP'], { P: PLANKS, S: 256 }, 32, 3)
shaped(['PP', 'PP', 'PP'], { P: PLANKS }, 290, 3)
shaped(['S S', 'SSS', 'S S'], { S: 256 }, 58, 3)
shaped(['PPP', 'BBB', 'PPP'], { P: PLANKS, B: 292 }, 59)
shaped(['SSS'], { S: 289 }, 291, 3)                    // (sugar cane would be MC's; here sugar from cane is skipped: paper from sugar)
shapeless([291, 291, 291, 279], 292)
shaped(['GSG', 'SGS', 'GSG'], { G: 277, S: [6] }, 60)
shaped(['P', 'T'], { P: 61, T: 28 }, 62)
shapeless([258, 284], 293)
shaped(['R', 'S'], { R: 262, S: 256 }, 82)
shapeless([275], 288, 3)
shaped(['MMM', 'SES', 'WWW'], { M: 283, S: 289, E: 290 /* (no eggs: a door's hinge stands in) */, W: 266 }, 329)
for (const [blkId, itemId] of [[48, 258], [49, 259], [50, 260], [64, 261], [54, 257], [68, 299]]) {
  shaped(['MMM', 'MMM', 'MMM'], { M: itemId }, blkId)
  shapeless([blkId], itemId, 9)
}
shapeless([4, 12], 63)

// match a crafting grid (array of ids or 0, size w*w); returns { out, n } or null
export function craft(grid, w) {
  let x0 = w, y0 = w, x1 = -1, y1 = -1
  for (let i = 0; i < grid.length; i++) if (grid[i]) { const x = i % w, y = i / w | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  if (x1 < 0) return null
  const gw = x1 - x0 + 1, gh = y1 - y0 + 1, at = (x, y) => grid[(y0 + y) * w + x0 + x]
  const fits = (want, id) => Array.isArray(want) ? want.includes(id) : want === id
  for (const r of RECIPES) {
    if (r.ins) {
      const have = grid.filter(Boolean)
      if (have.length !== r.ins.length) continue
      const need = [...r.ins]
      if (have.every(id => { const k = need.findIndex(n => fits(n, id)); if (k < 0) return false; need.splice(k, 1); return true })) return { out: r.out, n: r.n }
      continue
    }
    const rh = r.rows.length, rw = Math.max(...r.rows.map(s => s.length))
    if (rh !== gh || rw !== gw) continue
    for (const mir of [false, true]) {
      let ok = true
      for (let y = 0; y < rh && ok; y++) for (let x = 0; x < rw && ok; x++) {
        const ch = (r.rows[y][mir ? rw - 1 - x : x] || ' '), id = at(x, y)
        ok = ch === ' ' ? !id : !!id && fits(r.keys[ch], id)
      }
      if (ok) return { out: r.out, n: r.n }
    }
  }
  return null
}

// ---------------------------------------------------------------------------- furnace
export const SMELT = { 15: 258, 16: 259, 6: 13, 4: 3, 10: 263, 46: 263, 268: 269, 270: 271, 272: 273, 285: 286, 295: 326, 296: 299, 297: 327, 69: 38 }
export const SMELT_XP = { 15: 0.7, 16: 1, 6: 0.1, 4: 0.1, 10: 0.15, 46: 0.15, 268: 0.35, 270: 0.35, 272: 0.35, 285: 0.35, 295: 0.35, 296: 2, 297: 0.3, 69: 0.3 }
export const COOK_TICKS = 200
