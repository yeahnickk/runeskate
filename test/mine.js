// MineScape headless: the RS map comes out as blocks (ground, castle walls, roofs, trees, ores, caves, bedrock), MC's
// movement numbers, dig times + drops, recipes, the furnace, inventory clicks, hunger, mobs (zombies bite, creepers
// blow, cows drop beef), villagers trade, water and sand, light and meshing, advancements, saving.   bun test/mine.js
import { readFileSync } from 'fs';
import { World, WH } from '../src/mine/world.js';
import { Game } from '../src/mine/game.js';
import { BLOCKS, ITEMS, craft, digInfo, toolId, RECIPES } from '../src/mine/blocks.js';
import { meshChunk, lightRegion } from '../src/mine/mesh.js';
import { tickMove } from '../src/mine/phys.js';
import { screenFor, click, give, count } from '../src/mine/inv.js';
import { makeMob } from '../src/mine/mobs.js';
let fails = 0; const check = (name, ok, info = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; };
const json = JSON.parse(readFileSync(new URL('../assets/mine_world.json', import.meta.url), 'utf8'));
const bin = new Uint8Array(readFileSync(new URL('../assets/mine_world.bin', import.meta.url)));
const MAP = { json, bin };
const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
const fresh = (mode = 'survival') => { const w = new World(MAP, 1); const g = new Game(w, { mode, rng: seeded(7) }); return { w, g, P: g.player }; };
// a flat stone test pad high in the sky (y 100, two thick so a dug block leaves a floor), far from everything
const pad = (w, x0, z0, n = 12, y = 100, id = 3) => { for (let x = x0 - n; x <= x0 + n; x++) for (let z = z0 - n; z <= z0 + n; z++) { w.set(x, y, z, id); w.set(x, y - 1, z, id); for (let k = 1; k < 6; k++) w.set(x, y + k, z, 0) } };

// ---------------------------------------------------------------- the world
{
  const { w, g } = fresh();
  const [sx, sz] = json.spawn, X = sx, Z = -sz - 1, gy = w.groundY(X, Z);
  check('spawn is on dry ground in Lumbridge', BLOCKS[w.get(X, gy, Z)].solid && w.get(X, gy + 1, Z) !== 8 && w.placeName(X, Z) === 'Lumbridge', `ground y ${gy}, block ${BLOCKS[w.get(X, gy, Z)].n}`);
  check('bedrock floors the world', w.get(X, 0, Z) === 5);
  let walls = 0, ores = {}, caves = 0, trees = 0
  for (let x = X - 40; x < X + 40; x++) for (let z = Z - 40; z < Z + 40; z++) for (let y = 1; y < 80; y++) {
    const b = w.get(x, y, z)
    if (b >= 72 && b <= 77) walls++
    if ([14, 15, 16, 17, 18, 19].includes(b)) ores[BLOCKS[b].n] = (ores[BLOCKS[b].n] || 0) + 1
    if (b === 0 && y < w.groundY(x, z) - 6) caves++
    if (b === 79) trees++
  }
  check('Lumbridge castle has its RS walls (thin, on the tile edges)', walls > 500, `wall blocks ${walls}`);
  check('the RS trees stand where RS has them', trees > 30, `tree blocks ${trees}`);
  // a big RS tree stands on 2x2 tiles (1174..1175, -429..-428): one chop fells the lot, not a column
  const tc = w.trunk(1175, 43, -428).length; g.breakBlock(1175, 44, -428, true)
  let left = 0; for (let a = 1173; a <= 1176; a++) for (let c = -430; c <= -427; c++) for (let y = 42; y < 48; y++) if (w.get(a, y, c) === 79) left++
  check('felling a big RS tree takes its whole 2x2 trunk', tc === 12 && left === 0, `trunk ${tc}, left ${left}`);
  // the Lumbridge bridge (RS 3240, 3226 -> tiles 1192..1200, 409..410): a plank deck over the River Lum
  const bz = -409 - 1, deck = w.groundY(1196, bz)
  check('the Lumbridge bridge is a deck over the river', w.get(1196, deck, bz) === 11 && [0, 8].includes(w.get(1196, deck - 1, bz)) && w.get(1196, deck - 3, bz) === 8, `deck y ${deck}, under ${w.get(1196, deck - 1, bz)} / ${w.get(1196, deck - 3, bz)}`);
  // RS spawns: goblins east of the river, cows in the cow field, chickens at the farm
  const near = (kind, x0, x1) => json.npcs.filter(n => n[2] === kind && n[0] >= x0 && n[0] < x1).length
  check('goblins spawn over the bridge, cows in the field (RS spawns)', near('goblin', 1196, 1220) >= 5 && near('cow', 1195, 1220) >= 3 && json.npcs.some(n => n[2] === 'chicken'), `goblins ${near('goblin', 1196, 1220)}, cows ${near('cow', 1195, 1220)}`);
  check('ores under the ground (coal, iron, gold, redstone, diamond)', ores['Coal Ore'] > 200 && ores['Iron Ore'] > 100 && ores['Gold Ore'] > 5 && ores['Redstone Ore'] > 10 && ores['Diamond Ore'] > 0, JSON.stringify(ores));
  check('caves wind under the ground', caves > 2000, `cave air ${caves}`);
  // the river Lum: water east of the castle
  let water = 0; for (let x = X; x < X + 40; x++) if (w.get(x, w.groundY(x, Z), Z) === 8) water++
  check('the River Lum is water', water >= 3, `water columns ${water}`);
  check('a villager or more lives in the RS towns', json.villagers.length > 20, `${json.villagers.length} from the RS spawns`);
  const t0 = performance.now(); for (let i = 0; i < 9; i++) meshChunk(w, (X >> 4) + (i % 3), (Z >> 4) + ((i / 3) | 0)); const ms = (performance.now() - t0) / 9;
  check('a chunk meshes in good time', ms < 60, ms.toFixed(1) + ' ms a chunk');
}

// ---------------------------------------------------------------- MC movement
{
  const { w, g, P } = fresh('survival'); pad(w, 5000, -5000, 30);
  Object.assign(P, { x: 5000.5, y: 101, z: -5000.5, vx: 0, vy: 0, vz: 0 });
  for (let i = 0; i < 5; i++) g.tick({});
  const z0 = P.z; for (let i = 0; i < 60; i++) g.tick({ fw: 1 }); const walk = (z0 - P.z) / 3;
  check('walking speed is MC\'s ~4.3 blocks/s', Math.abs(walk - 4.3) < 0.25, walk.toFixed(2));
  P.z = -5000.5; P.x = 5000.5; for (let i = 0; i < 10; i++) g.tick({});
  const z1 = P.z; for (let i = 0; i < 60; i++) g.tick({ fw: 1, sprint: true }); const sprint = (z1 - P.z) / 3;
  check('sprinting is MC\'s ~5.6 blocks/s', Math.abs(sprint - 5.6) < 0.3, sprint.toFixed(2));
  P.z = -5000.5; for (let i = 0; i < 10; i++) g.tick({});
  let top = P.y, y0 = P.y; for (let i = 0; i < 20; i++) { g.tick({ jump: i === 0 }); top = Math.max(top, P.y) }
  check('a jump clears 1.25 blocks', Math.abs(top - y0 - 1.25) < 0.05, (top - y0).toFixed(3));
  // MC's auto-jump: one block steps up as you walk (RS ground rises a tile at a time), two stop you
  for (let z = -5003; z >= -5009; z--) w.set(5000, 101, z, 3); P.x = 5000.5; P.z = -5000.5
  for (let i = 0; i < 12; i++) g.tick({ fw: 1 })
  check('walking steps up one block (auto-jump)', P.y > 101.9, P.y.toFixed(2));
  w.set(5000, 102, -5006, 3); w.set(5000, 103, -5006, 3)
  for (let i = 0; i < 40; i++) g.tick({ fw: 1 })
  check('a two-block wall stops you', P.z > -5005.4, P.z.toFixed(2));
  // a thin RS wall on a tile edge stops you right at the edge
  Object.assign(P, { x: 5003.5, y: 102, z: -5003.5, vx: 0, vy: 0, vz: 0 }); w.set(5003, 102, -5006, 72, 2); w.set(5003, 103, -5006, 72, 2)
  for (let i = 0; i < 40; i++) g.tick({ fw: 1 })
  check('a thin RS wall stops you at the tile edge', P.z > -5005.2 && P.z < -5004.4, P.z.toFixed(2));
  // fall damage: 10 blocks = 7 damage
  pad(w, 6000, -6000, 4); Object.assign(P, { x: 6000.5, y: 111, z: -6000.5, vx: 0, vy: 0, vz: 0, hp: 20, food: 17, fall: 0, invul: 0 }); // food under 18: no regen muddying the count
  for (let i = 0; i < 60; i++) g.tick({});
  check('falling 10 blocks costs 7 hearts-halves', P.hp === 13, `hp ${P.hp}`);
  // sneaking stops you walking off an edge
  pad(w, 7000, -7000, 1); Object.assign(P, { x: 7000.5, y: 101, z: -7000.5, vx: 0, vy: 0, vz: 0 }); for (let i = 0; i < 5; i++) g.tick({})
  for (let i = 0; i < 80; i++) g.tick({ fw: 1, sneak: true })
  check('sneaking won\'t walk off a ledge', P.y > 100.9, `y ${P.y.toFixed(2)} z ${P.z.toFixed(2)}`);
}

// ---------------------------------------------------------------- digging + tools
{
  const t = (b, h) => digInfo(b, h).ticks
  check('dirt by hand: 0.75 s', t(2, 0) === 15, t(2, 0));
  check('stone by hand: 7.5 s, and drops nothing', t(3, 0) === 150 && !digInfo(3, 0).harvest, t(3, 0));
  check('stone with a wooden pickaxe: 1.15 s', t(3, toolId(0, 'pick')) === 23, t(3, toolId(0, 'pick')));
  check('iron ore needs a stone pickaxe', !digInfo(15, toolId(0, 'pick')).harvest && digInfo(15, toolId(1, 'pick')).harvest);
  check('diamond ore needs an iron pickaxe', !digInfo(17, toolId(1, 'pick')).harvest && digInfo(17, toolId(2, 'pick')).harvest);
  check('runite ore needs diamond or better', !digInfo(67, toolId(2, 'pick')).harvest && digInfo(67, toolId(4, 'pick')).harvest);
  check('logs chop faster with an axe', t(10, toolId(1, 'axe')) < t(10, 0) / 3, `${t(10, 0)} -> ${t(10, toolId(1, 'axe'))}`);
  check('bedrock can\'t be broken', t(5, toolId(4, 'pick')) === Infinity);
  // digging in the game: break grass by hand, get dirt
  const { w, g, P } = fresh(); pad(w, 5000, -5000, 4); w.set(5000, 101, -5002, 1)
  Object.assign(P, { x: 5000.5, y: 101, z: -5000.5 }); for (let i = 0; i < 5; i++) g.tick({})
  const pitch = -Math.atan2(1.62 - 0.5, 1.5)
  let n = 0; while (w.get(5000, 101, -5002) && n < 200) { g.tick({ yaw: 0, pitch, attack: true, attackPress: n === 0 }); n++ }
  for (let i = 0; i < 30; i++) g.tick({ yaw: 0, pitch })
  check('digging grass by hand takes MC\'s time and the dirt comes to you', n >= 18 && n <= 20 && count(P.inv, 2) === 1, `${n} ticks, dirt ${count(P.inv, 2)}`);
  // a pick wears out
  P.inv[0] = { id: toolId(0, 'pick'), n: 1, d: 0 }; P.sel = 0
  for (let k = 0; k < 3; k++) { w.set(5000, 101, -5002, 3); let m = 0; while (w.get(5000, 101, -5002) && m < 100) { g.tick({ yaw: 0, pitch, attack: true, attackPress: m === 0 }); m++ } for (let i = 0; i < 6; i++) g.tick({}) }
  check('tools wear one point a block', P.inv[0] && P.inv[0].d === 3, `damage ${P.inv[0] && P.inv[0].d}`);
}

// ---------------------------------------------------------------- crafting
{
  const c = (grid, w = 3) => { const r = craft(grid, w); return r ? r.out + 'x' + r.n : null }
  check('a log makes 4 planks (2x2 grid)', c([10, 0, 0, 0], 2) === '11x4');
  check('2 planks make 4 sticks', c([0, 11, 0, 11], 2) === '256x4');
  check('4 planks make a crafting table', c([11, 11, 11, 11], 2) === '24x1');
  check('wooden / stone / iron / diamond pickaxes', c([11, 11, 11, 0, 256, 0, 0, 256, 0]) === toolId(0, 'pick') + 'x1' && c([4, 4, 4, 0, 256, 0, 0, 256, 0]) === toolId(1, 'pick') + 'x1' && c([258, 258, 258, 0, 256, 0, 0, 256, 0]) === toolId(2, 'pick') + 'x1' && c([260, 260, 260, 0, 256, 0, 0, 256, 0]) === toolId(4, 'pick') + 'x1');
  check('an axe crafts either way round (mirrored)', c([4, 4, 0, 4, 256, 0, 0, 256, 0]) === toolId(1, 'axe') + 'x1' && c([0, 4, 4, 0, 256, 4, 0, 256, 0]) === toolId(1, 'axe') + 'x1');
  check('a shovel fits anywhere in the grid', c([0, 0, 4, 0, 0, 256, 0, 0, 256]) === toolId(1, 'shovel') + 'x1');
  check('furnace, chest, torches, bread, bed', c([4, 4, 4, 4, 0, 4, 4, 4, 4]) === '25x1' && c([11, 11, 11, 11, 0, 11, 11, 11, 11]) === '27x1' && c([257, 0, 256, 0], 2) === '28x4' && c([266, 266, 266, 0, 0, 0, 0, 0, 0]) === '265x1' && c([39, 39, 39, 11, 11, 11, 0, 0, 0]) === '40x1');
  check('iron armour: helmet, chestplate, leggings, boots', c([258, 258, 258, 258, 0, 258, 0, 0, 0]) === '334x1' && c([258, 0, 258, 258, 258, 258, 258, 258, 258]) === '335x1' && c([258, 258, 258, 258, 0, 258, 258, 0, 258]) === '336x1' && c([258, 0, 258, 258, 0, 258, 0, 0, 0]) === '337x1');
  check('a wrong pattern makes nothing', c([4, 0, 4, 0, 256, 0, 0, 256, 0]) === null && c([3, 3, 3, 0, 0, 0, 0, 0, 0]) === null);
  check('every recipe output is a real block or item', RECIPES.every(r => BLOCKS[r.out] || ITEMS[r.out]), RECIPES.length + ' recipes');
}

// ---------------------------------------------------------------- inventory clicks, crafting through the screen, furnace
{
  const { g, P } = fresh()
  give(P.inv, { id: 10, n: 3, d: 0 })
  const scr = screenFor('inv', g)
  const si = (sec, i) => scr.slots.findIndex(s => s.sec === sec && (i === undefined || s.i === i))
  click(g, scr, si('hot', 0), 0, false)
  check('left click picks up the stack', P.cursor && P.cursor.n === 3 && !P.inv[0]);
  click(g, scr, si('grid', 0), 1, false)
  check('right click drops one', P.cursor.n === 2 && P.craft2[0].n === 1);
  click(g, scr, si('res'), 0, true)
  check('shift-clicking the result crafts all it can (1 log -> 4 planks)', count(P.inv, 11) === 4 && !P.craft2[0], `planks ${count(P.inv, 11)}`);
  click(g, scr, si('main', 9), 0, false)
  check('dropping the held stack into an empty slot', !P.cursor && P.inv[9] && P.inv[9].n === 2);
  click(g, scr, si('main', 9), 1, false)
  check('right click on a stack picks up half', P.cursor && P.cursor.n === 1 && P.inv[9].n === 1);
  click(g, scr, si('main', 9), 0, false)
  click(g, scr, si('main', 9), 0, true)
  check('shift-click moves a stack from the inventory to the hotbar', !P.inv[9] && P.inv.slice(0, 9).some(s => s && s.id === 10 && s.n === 2));
  give(P.inv, { id: 335, n: 1, d: 0 }); const ai = P.inv.findIndex(s => s && s.id === 335)
  click(g, scr, scr.slots.findIndex(s => s.arr === P.inv && s.i === ai), 0, true)
  check('shift-clicking armour puts it on', P.armor[1] && P.armor[1].id === 335);
  // the furnace: 2 iron ore + coal -> 2 ingots in 20 s, lights up while burning
  g.world.set(5000, 100, -5000, 25)
  const f = g.furnace('5000,100,-5000'); f.s[0] = { id: 15, n: 2, d: 0 }; f.s[1] = { id: 257, n: 1, d: 0 }
  g.tick({}); const lit = g.world.get(5000, 100, -5000) === 26
  for (let i = 0; i < 405; i++) g.tick({})
  check('the furnace smelts iron ore to ingots (10 s each) and lights up', lit && f.s[2] && f.s[2].id === 258 && f.s[2].n === 2, JSON.stringify(f.s[2]));
  const fs2 = screenFor('furnace', g, '5000,100,-5000'), lv = P.lvl + P.xp
  click(g, fs2, fs2.slots.findIndex(s => s.sec === 'fout'), 0, true)
  check('taking the ingots gives XP', count(P.inv, 258) === 2 && P.lvl + P.xp > lv);
}

// ---------------------------------------------------------------- hunger, health
{
  const { w, g, P } = fresh(); pad(w, 5000, -5000, 60)
  Object.assign(P, { x: 5000.5, y: 101, z: -4960.5 })
  const f0 = P.food + P.sat
  for (let i = 0; i < 20 * 60; i++) { g.tick({ fw: 1, sprint: true, yaw: i % 200 < 100 ? 0 : Math.PI }) }
  check('sprinting burns saturation and hunger (at half the MC rate: a minute costs ~3)', P.food + P.sat < f0 - 2, `${f0} -> ${(P.food + P.sat).toFixed(1)}`);
  Object.assign(P, { hp: 10, food: 20, sat: 20 })
  for (let i = 0; i < 100; i++) g.tick({})
  check('full hunger heals fast (MC 1.11 saturation regen)', P.hp >= 14, `hp ${P.hp.toFixed(1)}`);
  P.inv[0] = { id: 265, n: 1, d: 0 }; P.sel = 0; Object.assign(P, { hp: 20, food: 10, sat: 0, exh: 0 })
  for (let i = 0; i < 40; i++) g.tick({ use: true, usePress: i === 0, pitch: 1.5 })
  check('eating bread takes 1.6 s and fills 5 hunger', P.food === 15 && !P.inv[0], `food ${P.food}`);
}

// ---------------------------------------------------------------- mobs
{
  const { w, g, P } = fresh(); pad(w, 5000, -5000, 20)
  Object.assign(P, { x: 5000.5, y: 101, z: -5000.5, hp: 20 }); g.time = 18000
  g.ents.push(makeMob('zombie', 5000.5, 101, -5006.5, seeded(3)))
  let t = 0; while (P.hp === 20 && t < 400) { g.tick({}); t++ }
  check('a zombie walks up and bites at night', P.hp < 20, `hit after ${(t / 20).toFixed(1)} s, hp ${P.hp}`);
  // kill a cow with a sword: beef + leather maybe, XP
  g.ents.length = 0; g.time = 6000; Object.assign(P, { hp: 20, x: 5000.5, y: 101, z: -5000.5, vx: 0, vy: 0, vz: 0, atkT: 100 }) // back where we were (the zombie knocked us)
  const cow = makeMob('cow', 5000.5, 101, -5002.5, seeded(4)); cow.ai.t = 1e9; g.ents.push(cow)
  P.inv[0] = { id: toolId(4, 'sword'), n: 1, d: 0 }; P.sel = 0
  for (let i = 0; i < 200 && !cow.death; i++) { cow.x = 5000.5; cow.z = -5002.5; g.tick({ yaw: 0, pitch: -0.25, attackPress: i % 15 === 0, attack: i % 15 === 0 }) }
  for (let i = 0; i < 60; i++) g.tick({ yaw: 0, pitch: -0.25, fw: i < 10 ? 1 : 0 }) // walk over the drops
  check('a cow killed drops raw beef (and XP)', count(P.inv, 268) >= 1, `beef ${count(P.inv, 268)}, level ${P.lvl} + ${P.xp.toFixed(2)}`);
  // a creeper blows a crater
  g.ents.length = 0; g.time = 18000; P.hp = 20; P.invul = 0
  const cr = makeMob('creeper', 5000.5, 101, -5004.5, seeded(5)); g.ents.push(cr)
  for (let i = 0; i < 200 && !cr.gone; i++) g.tick({})
  let holes = 0; for (let x = 4994; x < 5007; x++) for (let z = -5011; z < -4998; z++) if (!w.get(x, 100, z)) holes++
  check('a creeper creeps up, hisses and blows a hole', cr.gone && holes > 4 && P.hp < 20, `holes ${holes}, hp ${P.hp.toFixed(1)}`);
  // skeletons shoot
  pad(w, 5100, -5000, 12) // away from the crater
  g.ents.length = 0; P.hp = 20; P.invul = 0; P.dead = false; Object.assign(P, { x: 5100.5, y: 101, z: -5000.5, vx: 0, vy: 0, vz: 0 })
  g.ents.push(makeMob('skeleton', 5100.5, 101, -5010.5, seeded(6)))
  let shot = 0; for (let i = 0; i < 300 && P.hp === 20; i++) { g.tick({}); if (g.ents.some(e => e.e === 'arrow')) shot = 1 }
  check('a skeleton shoots arrows that hurt', shot && P.hp < 20, `hp ${P.hp.toFixed(1)}`);
  // spawning: monsters come out in the dark
  const s2 = fresh(); s2.g.time = 18000; s2.P.x = json.spawn[0] + 60; s2.P.z = -json.spawn[1] - 1 - 60
  for (let a = -4; a <= 4; a++) for (let c = -4; c <= 4; c++) s2.w.chunk((Math.floor(s2.P.x) >> 4) + a, (Math.floor(s2.P.z) >> 4) + c)
  for (let i = 0; i < 20 * 30; i++) s2.g.spawnTick()
  const hostile = s2.g.ents.filter(e => e.e === 'mob' && ['zombie', 'skeleton', 'creeper', 'spider'].includes(e.type)).length
  const animals = s2.g.ents.filter(e => e.e === 'mob' && ['cow', 'pig', 'sheep', 'chicken'].includes(e.type)).length
  check('monsters spawn at night, animals live in the fields', hostile > 3 && animals > 0, `hostile ${hostile}, animals ${animals}, villagers ${s2.g.ents.filter(e => e.type === 'villager').length}`);
}

// ---------------------------------------------------------------- villagers
{
  const { g, P } = fresh()
  const v = makeMob('villager', P.x, P.y, P.z - 2, seeded(1), { kind: 'dwarf' })
  check('villagers are RS folk with MC trades', v.name && v.trades.length >= 4, `${v.name}: ${v.trades.map(t => t.buy[1] + ' ' + ITEMS[t.buy[0]]?.n + ' -> ' + (ITEMS[t.sell[0]] || BLOCKS[t.sell[0]]).n).join(', ')}`);
  give(P.inv, { id: 257, n: 20, d: 0 })
  const scr = screenFor('trade', g, v)
  scr.grid[0] = { id: 257, n: 15, d: 0 }; P.inv[0].n -= 15
  click(g, scr, scr.slots.findIndex(s => s.sec === 'tres'), 0, false)
  check('trading 15 coal for an emerald', P.cursor && P.cursor.id === 261 && v.trades[0].uses === 1);
}

// ---------------------------------------------------------------- water, sand, light, plants
{
  const { w, g, P } = fresh(); pad(w, 5000, -5000, 6)
  Object.assign(P, { x: 4998.5, y: 101, z: -4998.5 }) // entities only tick near the player
  w.set(5000, 100, -5000, 8); w.set(5001, 100, -5000, 0); g.wake(5001, 100, -5000)
  for (let i = 0; i < 10; i++) g.tick({})
  check('water runs into a hole beside it', w.get(5001, 100, -5000) === 8);
  w.set(5003, 104, -5003, 6); g.checkFall(5003, 104, -5003)
  for (let i = 0; i < 60; i++) g.tick({})
  check('sand falls to the ground', w.get(5003, 101, -5003) === 6 && !w.get(5003, 104, -5003));
  // a torch lights a sealed room
  for (let x = 4997; x <= 5003; x++) for (let z = -5003; z <= -4997; z++) for (let y = 101; y <= 105; y++) w.set(x, y, z, x === 4997 || x === 5003 || z === -5003 || z === -4997 || y === 105 ? 3 : 0)
  w.set(5000, 101, -5000, 28)
  const R = lightRegion(w, 5000 >> 4, -5000 >> 4), Rr = 46, at = (x, y, z) => ((z - ((-5000 >> 4) * 16 - 15)) * Rr + (x - ((5000 >> 4) * 16 - 15))) * R.Hr + y
  check('a torch lights its room (14 at the torch, 12 two blocks away), no sky gets in', R.bl[at(5000, 101, -5000)] === 14 && R.bl[at(5002, 101, -5000)] === 12 && R.sky[at(5001, 102, -5001)] === 0, `${R.bl[at(5000, 101, -5000)]} ${R.bl[at(5002, 101, -5000)]} sky ${R.sky[at(5001, 102, -5001)]}`);
  // farming: hoe, seeds, growth
  w.set(5010, 100, -5010, 1); w.set(5010, 101, -5010, 0)
  Object.assign(P, { x: 5010.5, y: 101, z: -5008.5 })
  pad(w, 5010, -5008, 1); w.set(5010, 100, -5010, 1); w.set(5011, 100, -5010, 8)
  P.inv[0] = { id: toolId(0, 'hoe'), n: 1, d: 0 }; P.inv[1] = { id: 267, n: 3, d: 0 }; P.sel = 0
  const pit = -Math.atan2(1.62, 1.0) // the middle of the grass block's top
  g.tick({ yaw: 0, pitch: pit, use: true, usePress: true }); for (let i = 0; i < 5; i++) g.tick({ yaw: 0, pitch: pit })
  P.sel = 1; g.tick({ yaw: 0, pitch: pit, use: true, usePress: true, sel: 1 })
  check('a hoe tills grass to farmland, seeds plant on it', w.get(5010, 100, -5010) === 45 && w.get(5010, 101, -5010) === 41, `${w.get(5010, 100, -5010)} ${w.get(5010, 101, -5010)}`);
}

// ---------------------------------------------------------------- advancements + saving
{
  const { w, g, P } = fresh()
  give(P.inv, { id: 10, n: 1, d: 0 })
  for (let i = 0; i < 12; i++) g.tick({})
  const ev = g.drainEvents()
  check('getting a log awards "Getting Wood"', !!g.adv.wood && ev.some(e => e.t === 'toast' && e.a.id === 'wood'));
  w.set(P.x | 0, 90, P.z | 0, 50); give(P.inv, { id: 260, n: 7, d: 0 }); P.lvl = 5; g.time = 30000
  const s = JSON.parse(JSON.stringify(g.save()))
  const { w: w2, g: g2 } = fresh(); g2.load(s)
  check('saving and loading keeps edits, inventory, level, time, advancements', w2.get(P.x | 0, 90, P.z | 0) === 50 && count(g2.player.inv, 260) === 7 && g2.player.lvl === 5 && g2.time === 30000 && g2.adv.wood);
}


{ // RS fights: a goblin goes down in three good punches, a man in four (RS hitpoints, not MC's 20)
  const { g, P } = fresh()
  const gob = makeMob('goblin', 0, 0, 0), man = makeMob('villager', 0, 0, 0, Math.random, { kind: 'man' })
  const hits = (m) => { let n = 0; while (m.hp > 0 && n < 50) { m.hurt = 0; P.atkT = 100; g.attackMob(m); n++ } return n }
  const a = hits(gob), b = hits(man)
  check('a goblin takes three punches, a man four', a === 3 && b === 4, `goblin ${a}, man ${b}`)
}
{ // the RS ground stays as the map has it: MC's grass/dirt ticks leave natural cells alone when the client says so
  const { w, g, P } = fresh(); P.x = 1170.5; P.z = -402.5
  w.keep = (x, y, z) => w.natural(x, y, z)
  let flips = 0; w.listeners.push((x, y, z, id, was) => { if ((id === 1 || id === 2) && (was === 1 || was === 2)) flips++ })
  for (let i = 0; i < 3000; i++) g.tick({})
  check('no grass <-> dirt flips on the map\'s own ground', flips === 0, `${flips} flips`)
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
