// MineScape headless: the RS map comes out as blocks (ground, castle walls, roofs, trees, ores, caves, bedrock), MC's
// movement numbers, dig times + drops, recipes, the furnace, inventory clicks, hunger, mobs (zombies bite, creepers
// blow, cows drop beef), villagers trade, water and sand, light and meshing, advancements, saving.   bun test/mine.js
import { readFileSync } from 'fs';
import { World, WH } from '../src/mine/world.js';
import { Game } from '../src/mine/game.js';
import { BLOCKS, ITEMS, craft, digInfo, toolId, RECIPES, placeOf, nameOf } from '../src/mine/blocks.js';
import { meshChunk, lightRegion } from '../src/mine/mesh.js';
import { tickMove } from '../src/mine/phys.js';
import { screenFor, click, give, count, closeScreen } from '../src/mine/inv.js';
import { makeMob, MOBS } from '../src/mine/mobs.js';
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
  // out of the water: swim to a bank level with the water, and to one a block higher (jump + forward, as in MC)
  for (const [d, name] of [[0, 'level'], [1, 'a block up']]) {
    const X = 9000 + d * 20
    for (let x = X - 6; x <= X + 6; x++) for (let z = -9012; z <= -8990; z++) { for (let y = 90; y <= 110; y++) w.set(x, y, z, 0); w.set(x, 96, z, 3)
      for (let y = 97; y <= 99 + (z <= -9006 ? d : 0); y++) w.set(x, y, z, z <= -9006 || x === X - 6 || x === X + 6 || z === -8990 ? 3 : 8) }
    Object.assign(P, { x: X + 0.5, y: 98.2, z: -8998.5, vx: 0, vy: 0, vz: 0, flying: false })
    let t = 0; for (; t < 200 && !(P.onGround && P.y >= 100 + d - 0.01); t++) g.tick({ fw: 1, jump: true })
    check(`swimming out onto a bank ${name}`, P.y >= 100 + d - 0.01 && P.onGround, `${(t / 20).toFixed(1)} s, y ${P.y.toFixed(2)}`)
  }
}

// ---------------------------------------------------------------- every block: breaks, drops, places
{
  const { w, g, P } = fresh('survival'), X = 9500, Z = -9500
  for (let x = X - 3; x <= X + 3; x++) for (let z = Z - 3; z <= Z + 3; z++) { for (let y = 95; y < 110; y++) w.set(x, y, z, 0); w.set(x, 99, z, 3) }
  Object.assign(P, { x: X + 2.5, y: 100, z: Z + 0.5 })
  const NONE = new Set([12, 13, 29, 47, 52, 57, 81]), bad = []   // (as MC: leaves, glass, grass need shears / silk touch; a dead bush 0-2 sticks; a door drops from its bottom)
  for (const id of Object.keys(BLOCKS).map(Number)) {
    if (!id || id === 5 || BLOCKS[id].liquid) continue
    w.set(X, 100, Z, id)
    const b = BLOCKS[id], tool = b.tool ? toolId(4, b.tool) : 0, info = digInfo(id, tool), n0 = g.ents.length
    g.breakBlock(X, 100, Z, info.harvest)
    const drops = g.ents.slice(n0).filter(e => e.e === 'item')
    if (w.get(X, 100, Z) || !isFinite(info.ticks) || (!drops.length && !NONE.has(id))) bad.push(id + ' ' + b.n)
    g.ents = g.ents.filter(e => e.e !== 'item'); for (let y = 100; y < 106; y++) w.set(X, y, Z, 0)
  }
  check('every block breaks with its tool and drops what MC drops', !bad.length, bad.join(', ') || 'all')
  // and every block or item that places, places: held, looking down at the pad
  const nop = []
  for (const id of [...Object.keys(BLOCKS), ...Object.keys(ITEMS)].map(Number)) {
    const pl = placeOf(id); if (!pl || id === 5 || id === 81) continue          // (fire is lit, not placed)
    for (let y = 100; y < 106; y++) { w.set(X, y, Z, 0); w.set(X, y, Z + 1, 0) } w.set(X, 99, Z, BLOCKS[pl].crop !== undefined || id === 267 ? 45 : BLOCKS[pl].sapling || [29, 30, 31, 52].includes(pl) ? 1 : BLOCKS[pl].cactus ? 6 : 3)
    const wall = !!BLOCKS[pl].climb, pitch = wall ? 0 : -1.0          // (a ladder goes on a wall)
    if (wall) { w.set(X, 100, Z - 1, 3); w.set(X, 101, Z - 1, 3) }
    Object.assign(P, { x: X + 0.5, y: wall ? 99.6 : 101.6, z: Z + (wall ? 1.2 : 2.2), vx: 0, vy: 0, vz: 0, yaw: 0, pitch, flying: true, sneak: false }); P.inv[P.sel] = { id, n: 4, d: 0 }; P.useCd = 0
    g.tick({ use: true, usePress: true, yaw: 0, pitch })
    if (wall) { w.set(X, 100, Z - 1, 0); w.set(X, 101, Z - 1, 0) }
    if (![100, 101].some(y => w.get(X, y, Z) || w.get(X, y, Z + 1))) nop.push(id + ' ' + nameOf(id))
  }
  check('every block and placeable item places', !nop.length, nop.join(', ') || 'all')
}

// ---------------------------------------------------------------- aiming at the RS-drawn ground never reaches under it
{
  const { w, g, P } = fresh()
  // main.js's rule with every tile RS-drawn: the ground's two blocks are drawn by RS, their faces hidden
  const cell = (x, y, z) => { const t = w.tile(x, z); return t >= 0 && y >= w.gy[t] - 1 && y <= w.gy[t] && w.natural(x, y, z) }
  g.hidden = (x, y, z, f) => cell(x, y, z) && (!f || (y + f[1] >= w.gy[w.tile(x + f[0], z + f[2])] && w.natural(x + f[0], y + f[1], z + f[2])))
  let deep = 0, n = 0
  for (let tx = 2; tx < w.W - 2; tx += 9) for (let tz = 2; tz < w.H - 2; tz += 9) for (const [yaw, pitch] of [[0, -1.3], [Math.PI / 2, -1.0], [Math.PI, -0.8], [-Math.PI / 2, -1.1]]) {
    const X = tx, Z = -tz - 1, gy = w.gy[w.tile(X, Z)]; if (w.get(X, gy + 1, Z) || w.get(X, gy + 2, Z)) continue
    Object.assign(P, { x: X + 0.5, y: gy + 1, z: Z + 0.5, yaw, pitch })
    const t = g.target(); if (!t) continue
    n++; if (t.y < w.gy[w.tile(t.x, t.z)] - 1 && !w.get(t.x, t.y + 1, t.z)) deep++     // (a riverbed seen through its water is fine)
  }
  check('looking at the ground anywhere on the map hits the ground, never a block hidden under it', n > 10000 && !deep, `${deep} of ${n} too deep`)
}

// ---------------------------------------------------------------- tunnels anywhere on the map are watertight: dig a shaft down and a tunnel along,
// and every solid face the tunnel opens up (walls, floor, ceiling, ore, cave edges) is drawn, so nothing shows through to the void
{
  const { w } = fresh(), vx = new Uint8Array(w.W * w.H), cover = new Uint8Array(w.W * w.H).fill(1)
  const rs = { vx, cover, h: (x, z) => w.gy[w.tile(x, z)] + 1.43 }; let n = 0, faces = 0; const bad = []
  const D6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
  for (let tx = 30; tx < w.W - 40 && n < 120; tx += 23) for (let tz = 30; tz < w.H - 40 && n < 120; tz += 19) {
    const X = tx, Z = -tz - 1, g0 = w.gy[w.tile(X, Z)]; if (g0 < 12 || w.get(X, g0, Z) === 8) continue
    let low = g0; for (let i = 0; i < 9; i++) low = Math.min(low, w.gy[w.tile(X + i, Z)]); const y0 = low - 5; if (y0 < 6) continue
    const was = [], dig = (x, y, z) => { was.push([x, y, z, w.get(x, y, z)]); w.set(x, y, z, 0) }
    for (let y = g0 + 1; y >= y0; y--) dig(X, y, Z); vx[X + tz * w.W] = 1                       // the shaft (its tile dug: the RS ground goes)
    for (let i = 1; i < 9; i++) { dig(X + i, y0, Z); dig(X + i, y0 + 1, Z) }                       // the tunnel, 1 x 2
    dig(X + 8, y0 + 1, Z + 1); dig(X + 8, y0 + 1, Z - 1); dig(X + 4, y0 + 2, Z)                    // a turn each way and a step up
    n++
    const got = new Set()
    for (const cx of new Set([(X - 1) >> 4, (X + 9) >> 4])) for (const cz of new Set([(Z - 2) >> 4, (Z + 2) >> 4])) {
      const m = meshChunk(w, cx, cz, { rs }).s
      for (let q = 0; q < m.n; q++) {
        const p = m.pos.subarray(q * 12, q * 12 + 12), v = [0, 1, 2, 3].map(i => [p[i * 3] + cx * 16, p[i * 3 + 1], p[i * 3 + 2] + cz * 16])
        for (let a = 0; a < 3; a++) { if (!v.every(c => Math.abs(c[a] - v[0][a]) < 1e-4) || Math.abs(v[0][a] - Math.round(v[0][a])) > 1e-4) continue
          const [b, c] = [0, 1, 2].filter(k => k !== a), lo = k => Math.min(...v.map(e => e[k])), hi = k => Math.max(...v.map(e => e[k]))
          for (let i = Math.floor(lo(b) + 1e-4); i < hi(b) - 1e-4; i++) for (let j = Math.floor(lo(c) + 1e-4); j < hi(c) - 1e-4; j++) got.add(a + ':' + Math.round(v[0][a]) + ':' + i + ':' + j) }
      }
    }
    for (const [x, y, z] of was) for (const d of D6) {
      const nx = x + d[0], ny = y + d[1], nz = z + d[2], id = w.get(nx, ny, nz), B = BLOCKS[id]
      const slab = Array.isArray(B.shape) && B.shape[3] - B.shape[0] === 16 && B.shape[5] - B.shape[2] === 16 && B.shape[4] >= 14   // (paths and farmland: the tunnel's wall too)
      if (!id || !((B.op && B.shape === 'cube') || slab) || ny > w.gy[w.tile(nx, nz)] || (d[1] > 0 && ny === w.gy[w.tile(nx, nz)]) || (ny === w.gy[w.tile(nx, nz)] && w.gy[w.tile(x, z)] <= ny)) continue   // (the ground's top block counts where the tunnel beside it is under its own ground: no seeing out under the RS ground)
      const a = d[0] ? 0 : d[1] ? 1 : 2, pl = [x, y, z][a] + (d[a] > 0 ? 1 : 0), o = [nx, ny, nz].filter((_, k) => k !== a); faces++
      if (!got.has(a + ':' + pl + ':' + o[0] + ':' + o[1])) bad.push(`${nx},${ny},${nz} ${B.n} ${'xyz'[a]}${d[a] > 0 ? '+' : '-'}`)
    }
    for (const [x, y, z, id] of was.reverse()) w.set(x, y, z, id); vx[X + tz * w.W] = 0
  }
  check('tunnels dug all over the map are watertight (every face they open is drawn)', n >= 60 && !bad.length, `${n} tunnels, ${faces} faces ${bad.length} missing ${bad.slice(0, 5).join(', ')}`)
}

// ---------------------------------------------------------------- a tunnel into a hill beside an RS path: the path block (the RS ground draws its top) still walls the tunnel
{
  const { w } = fresh(), vx = new Uint8Array(w.W * w.H), cover = new Uint8Array(w.W * w.H).fill(1)
  const rs = { vx, cover, h: (x, z) => w.gy[w.tile(x, z)] + 1.43 }; let n = 0; const bad = []
  for (let tz = 20; tz < w.H - 20 && n < 80; tz += 3) for (let tx = 20; tx < w.W - 20 && n < 80; tx += 3) {
    const X = tx, Z = -tz - 1, g = w.gy[w.tile(X, Z)], id = w.get(X, g, Z); if (id !== 20 && id !== 45) continue
    const O = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([a, c]) => w.gy[w.tile(X + a, Z + c)] >= g + 2 && w.get(X + a, g, Z + c)); if (!O) continue
    const ox = X + O[0], oz = Z + O[1], was = w.get(ox, g, oz); w.set(ox, g, oz, 0); n++
    const m = meshChunk(w, ox >> 4, oz >> 4, { rs }).s, m2 = (X >> 4) !== (ox >> 4) || (Z >> 4) !== (oz >> 4) ? meshChunk(w, X >> 4, Z >> 4, { rs }).s : null
    const has = (mm, cx, cz) => { for (let q = 0; q < mm.n; q++) { const p = mm.pos.subarray(q * 12, q * 12 + 12), v = [0, 1, 2, 3].map(i => [p[i * 3] + cx * 16, p[i * 3 + 1], p[i * 3 + 2] + cz * 16])
      const a = O[0] ? 0 : 2, pl = O[0] ? Math.max(X, ox) : Math.max(Z, oz), b = O[0] ? 2 : 0, cell = O[0] ? Z : X
      if (v.every(e => Math.abs(e[a] - pl) < 1e-4) && v.every(e => e[b] > cell - 0.01 && e[b] < cell + 1.01) && Math.min(...v.map(e => e[1])) <= g + 0.01 && Math.max(...v.map(e => e[1])) >= g + 0.9) return true } return false }
    if (!has(m, ox >> 4, oz >> 4) && !(m2 && has(m2, X >> 4, Z >> 4))) bad.push(`${X},${g},${Z} ${BLOCKS[id].n}`)
    w.set(ox, g, oz, was)
  }
  check('a tunnel into a hill beside an RS path or field is walled by it (no seeing out under the RS ground)', n >= 20 && !bad.length, `${n} spots ${bad.length} open ${bad.slice(0, 4).join(', ')}`)
}

// ---------------------------------------------------------------- a pit beside a tree, wall or rock: its wall meets the RS ground (no sliver of sky)
{
  const { w } = fresh(), vx = new Uint8Array(w.W * w.H), cover = new Uint8Array(w.W * w.H).fill(1)
  const rs = { vx, cover, h: (x, z) => H0 }; let H0 = 0, n = 0; const bad = []
  for (let tx = 40; tx < w.W - 40 && n < 60; tx += 7) for (let tz = 40; tz < w.H - 40 && n < 60; tz += 7) {
    const X = tx, Z = -tz - 1, g = w.gy[w.tile(X, Z)]
    if (w.get(X, g + 1, Z) || w.get(X, g, Z) === 8 || !w.get(X + 1, g + 1, Z) || w.gy[w.tile(X + 1, Z)] !== g || BLOCKS[w.get(X + 1, g + 1, Z)].liquid) continue
    for (let y = g + 3; y > g - 3; y--) w.set(X, y, Z, 0); vx[X + tz * w.W] = 1; H0 = g + 1.43; n++
    const cx = X >> 4, cz = Z >> 4, m = meshChunk(w, cx, cz, { rs }).s
    let top = -1
    for (let q = 0; q < m.n; q++) { const p = m.pos.subarray(q * 12, q * 12 + 12); if ([0, 3, 6, 9].every(i => Math.abs(p[i] + cx * 16 - (X + 1)) < 0.01) && [2, 5, 8, 11].every(i => p[i] + cz * 16 > Z - 0.01 && p[i] + cz * 16 < Z + 1.01)) top = Math.max(top, ...[1, 4, 7, 10].map(i => p[i])) }
    if (top < H0 - 0.02) bad.push(`${X},${Z} ${BLOCKS[w.get(X + 1, g + 1, Z)].n} ${top.toFixed(2)}<${H0.toFixed(2)}`)
    w.set(X, g, Z, 1); vx[X + tz * w.W] = 0
  }
  check('a pit beside a tree, wall or rock: its wall reaches the RS ground', n >= 30 && !bad.length, `${n} pits ${bad.slice(0, 4).join(', ')}`)
}

// ---------------------------------------------------------------- water + lava run as MC's, fire burns, TNT goes off every way
{
  const run = (g, n) => { for (let i = 0; i < n; i++) g.tick({}) }
  const lvl = (w, x, y, z) => w.meta(x, y, z) & 15
  // water from a bucket on a flat floor runs 7 out and stops; take the source and it all dries up
  let { w, g, P } = fresh('creative'); const X = 7000, Z = -7000
  pad(w, X, Z, 14); Object.assign(P, { x: X + 0.5, y: 112, z: Z + 12.5, flying: true })
  w.set(X, 101, Z, 8); g.wake(X, 101, Z); run(g, 120)
  const lv = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(k => w.get(X + k, 101, Z) === 8 ? lvl(w, X + k, 101, Z) : -1)
  check('water runs 7 blocks across a floor, a level a block, and no further', lv.join() === '0,1,2,3,4,5,6,7,-1', lv.join())
  w.set(X, 101, Z, 0); g.wake(X, 101, Z); run(g, 120)
  let wet = 0; for (let a = -9; a <= 9; a++) for (let c = -9; c <= 9; c++) if (w.get(X + a, 101, Z + c) === 8) wet++
  check('take the source and the flow dries up', wet === 0, `${wet} wet`)
  // it falls off an edge, and two sources make a third (MC's infinite water)
  w.set(X + 5, 100, Z, 0); w.set(X + 5, 99, Z, 0); w.set(X + 5, 98, Z, 3); w.set(X + 3, 101, Z, 8); g.wake(X + 3, 101, Z); run(g, 120)
  check('water pours down a hole beside it', w.get(X + 5, 100, Z) === 8 && w.get(X + 5, 99, Z) === 8, `${w.get(X + 5, 100, Z)} ${w.get(X + 5, 99, Z)}`)
  for (let a = -9; a <= 9; a++) for (let c = -9; c <= 9; c++) for (let y = 98; y <= 102; y++) if (BLOCKS[w.get(X + a, y, Z + c)].liquid) w.set(X + a, y, Z + c, 0)
  w.set(X + 5, 100, Z, 3); w.set(X + 5, 99, Z, 3)
  for (let a = -1; a <= 3; a++) for (let c = -1; c <= 1; c++) w.set(X + a, 101, Z + c, a < 0 || a > 2 || c ? 3 : 0)   // (a 3 long trench)
  w.set(X, 101, Z, 8); w.set(X + 2, 101, Z, 8); g.wake(X, 101, Z); g.wake(X + 2, 101, Z); run(g, 40)
  check('two water sources make the block between a source', w.get(X + 1, 101, Z) === 8 && lvl(w, X + 1, 101, Z) === 0)
  pad(w, X, Z, 14)
  // a torch in the way washes off and drops
  w.set(X + 2, 101, Z, 28); const n0 = g.ents.length
  w.set(X, 101, Z, 8); g.wake(X, 101, Z); run(g, 60)
  check('running water washes a torch off (it drops)', w.get(X + 2, 101, Z) === 8 && g.ents.slice(n0).some(e => e.e === 'item' && e.st.id === 28))
  // the current carries a dropped item along
  const it = { e: 'item', st: { id: 3, n: 1, d: 0 }, x: X + 3.5, y: 101.1, z: Z + 0.5, vx: 0, vy: 0, vz: 0, w: 0.25, h: 0.25, age: 0, delay: 99 }; g.ents.push(it)
  run(g, 40)
  check('the current carries an item downstream', it.x > X + 4, `x ${(it.x - X).toFixed(2)}`)
  w.set(X, 101, Z, 0); g.wake(X, 101, Z); run(g, 120); pad(w, X, Z, 14)
  // lava runs 3 and slower; lava meets water: a source turns to obsidian, flowing lava to cobblestone
  w.set(X, 101, Z, 9); g.wake(X, 101, Z); run(g, 100)
  const ll = [0, 1, 2, 3, 4].map(k => w.get(X + k, 101, Z) === 9 ? lvl(w, X + k, 101, Z) : -1)
  check('lava runs 3 blocks across a floor (2 a level), no further', ll.join() === '0,2,4,6,-1', ll.join())
  w.set(X, 102, Z, 8); g.wake(X, 102, Z); run(g, 160)        // (water poured on the source)
  const ob = []; for (let a = -4; a <= 4; a++) for (let c = -4; c <= 4; c++) { const b = w.get(X + a, 101, Z + c); if (b === 55 || b === 4) ob.push(b) }
  check('water meeting lava makes obsidian (the source) and cobblestone (its flow)', w.get(X, 101, Z) === 55 && ob.includes(4), `source ${w.get(X, 101, Z)}, ${ob.length} turned`)
  for (let a = -9; a <= 9; a++) for (let c = -9; c <= 9; c++) for (let y = 98; y <= 102; y++) if (BLOCKS[w.get(X + a, y, Z + c)].liquid) w.set(X + a, y, Z + c, 0)
  run(g, 60); pad(w, X, Z, 14)
  // fire: flint and steel lights it on stone, it goes out with nothing to burn; a wooden hut burns down
  ;({ w, g, P } = fresh('survival')); pad(w, X, Z, 14); Object.assign(P, { x: X + 0.5, y: 101, z: Z + 2.5, yaw: 0, pitch: -0.6, flying: false })
  P.inv[P.sel] = { id: 293, n: 1, d: 0 }; g.tick({ use: true, usePress: true, yaw: 0, pitch: -0.6 })
  check('flint and steel lights a fire on the block you click', w.get(X, 101, Z + 1) === 81 || w.get(X, 101, Z) === 81, `${w.get(X, 101, Z + 1)} ${w.get(X, 101, Z)}`)
  run(g, 1200)
  let fires = 0; for (let a = -3; a <= 3; a++) for (let c = -3; c <= 3; c++) if (w.get(X + a, 101, Z + c) === 81) fires++
  check('a fire on bare stone burns out', fires === 0)
  Object.assign(P, { x: X + 12.5, z: Z + 12.5 })
  for (let a = 0; a < 4; a++) for (let c = 0; c < 4; c++) for (let y = 101; y <= 103; y++) if (a === 0 || a === 3 || c === 0 || c === 3 || y === 103) w.set(X + a, y, Z + c, 11)
  g.setFire(X + 1, 101, Z + 1)
  run(g, 3000)
  let planks = 0; for (let a = 0; a < 4; a++) for (let c = 0; c < 4; c++) for (let y = 101; y <= 103; y++) if (w.get(X + a, y, Z + c) === 11) planks++
  check('a fire inside a plank hut burns most of it away', planks < 12, `${planks} of 40 planks left`)
  pad(w, X, Z, 14)
  // standing in fire burns you
  P.hp = 20; P.fire = 0; Object.assign(P, { x: X + 5.5, y: 101, z: Z + 5.5, vx: 0, vz: 0 }); w.set(X + 5, 100, Z + 5, 3); g.setFire(X + 5, 101, Z + 5); run(g, 30)
  check('standing in fire hurts and sets you alight', P.hp < 20 && P.fire > 0, `hp ${P.hp}, alight ${P.fire}`)
  w.set(X + 5, 101, Z + 5, 0); P.fire = 0; P.hp = 20
  // every way to light TNT: flint and steel, a redstone torch beside it, fire beside it, lava beside it
  const lit = (how) => {
    const r = fresh('creative'); pad(r.w, X, Z, 14); Object.assign(r.P, { x: X + 0.5, y: 101, z: Z + 3.5, yaw: 0, pitch: -0.35, flying: true })
    r.w.set(X, 101, Z, 60); how(r); let n = 0
    for (; n < 400 && !r.g.ents.some(e => e.e === 'tnt'); n++) r.g.tick({})
    return n < 400
  }
  check('flint and steel lights TNT', lit(({ g, P }) => { P.inv[P.sel] = { id: 293, n: 1, d: 0 }; g.tick({ use: true, usePress: true, yaw: 0, pitch: -0.35 }) }))
  check('a redstone torch placed beside TNT lights it', lit(({ g, P, w }) => { w.set(X, 100, Z + 1, 3); P.inv[P.sel] = { id: 82, n: 1, d: 0 }; Object.assign(P, { x: X + 0.5, y: 103.5, z: Z + 1.5, pitch: -1.55 }); g.tick({ use: true, usePress: true, yaw: 0, pitch: -1.55 }) }))
  check('fire beside TNT lights it', lit(({ g }) => { g.setFire(X + 1, 101, Z) }))
  check('lava beside TNT lights it', lit(({ g, w }) => { w.set(X + 1, 101, Z, 9); g.wake(X + 1, 101, Z) }))
  // the blast: a crater in dirt, not in obsidian, nothing broken under water, a chain of TNT all goes, it throws and hurts
  const boom = (setup) => { const r = fresh('survival'); pad(r.w, X, Z, 14, 100, 2); for (let y = 92; y < 99; y++) for (let a = -8; a <= 8; a++) for (let c = -8; c <= 8; c++) r.w.set(X + a, y, Z + c, 2)
    Object.assign(r.P, { x: X + 0.5, y: 101, z: Z + 6.5, invul: 0 }); setup(r); r.g.prime(X, 101, Z, 40); r.low = 20; for (let i = 0; i < 300; i++) { r.g.tick({}); r.low = Math.min(r.low, r.P.hp) } return r }
  let r = boom(() => {}), gone = 0; for (let a = -5; a <= 5; a++) for (let c = -5; c <= 5; c++) for (let y = 95; y <= 100; y++) if (!r.w.get(X + a, y, Z + c)) gone++
  check('TNT blows a crater in the ground and hurts you 6 blocks off', gone > 20 && r.low < 16, `${gone} blocks, hp down to ${r.low.toFixed(1)}`)
  r = boom(({ w }) => { for (let a = -3; a <= 3; a++) for (let c = -3; c <= 3; c++) for (let y = 98; y <= 102; y++) if (a || c || y !== 101) w.set(X + a, y, Z + c, 55) })
  gone = 0; for (let a = -3; a <= 3; a++) for (let c = -3; c <= 3; c++) for (let y = 98; y <= 102; y++) if ((a || c || y !== 101) && r.w.get(X + a, y, Z + c) !== 55) gone++
  check('obsidian stands up to a blast', gone === 0, `${gone} broken`)
  r = boom(({ w }) => { for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) for (let y = 101; y <= 102; y++) if (a || c || y !== 101) w.set(X + a, y, Z + c, 8); w.set(X, 102, Z, 8) })
  gone = 0; for (let a = -5; a <= 5; a++) for (let c = -5; c <= 5; c++) for (let y = 95; y <= 100; y++) if (!r.w.get(X + a, y, Z + c)) gone++
  check('TNT under water breaks nothing', gone === 0, `${gone} broken`)
  r = boom(({ w }) => { for (let k = 2; k <= 10; k += 2) w.set(X + k, 101, Z, 60) })
  let left = 0; for (let k = 2; k <= 10; k += 2) if (r.w.get(X + k, 101, Z) === 60) left++
  check('a row of TNT goes off one after another', left === 0, `${left} left`)
  r = boom(({ g }) => { g.ents.push({ e: 'tnt', x: X + 2.5, y: 101, z: Z + 0.5, vx: 0, vy: 0, vz: 0, w: 0.98, h: 0.98, fuse: 9999, tag: 1 }) })
  const t2 = r.g.ents.find(e => e.tag)
  check('a blast throws lit TNT beside it', t2 && Math.hypot(t2.x - X - 2.5, t2.z - Z - 0.5) > 1, t2 ? `moved ${Math.hypot(t2.x - X - 2.5, t2.z - Z - 0.5).toFixed(2)}` : 'gone')
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
{ // RS folk fight back: punch a man and he swings at RS speed (0 or 1 a hit) till you get away; he won't trade meanwhile
  const { w, g, P } = fresh(); pad(w, 4000, -4000); P.x = 4000.5; P.y = 101; P.z = -4000.5; P.hunger = 0; P.sat = 0
  const m = makeMob('villager', 4000.5, 101, -4002.5, seeded(3), { kind: 'man', home: [4000.5, -4002.5] }); g.ents.push(m)
  for (let i = 0; i < 5; i++) g.tick({})
  P.atkT = 100; g.attackMob(m); let hits = 0, low = P.hp
  for (let i = 0; i < 400 && P.hp > 0; i++) { const h = P.hp; g.tick({}); if (P.hp < h) hits++; low = Math.min(low, P.hp) }
  const angry = m.angry
  P.x = 4040.5; P.z = -4040.5; for (let i = 0; i < 5; i++) g.tick({})
  check('a man you punch hits back, then calms down when you leave', angry && hits >= 2 && hits <= 9 && low >= 10 && !m.angry, `${hits} hits, hp down to ${low}, angry after leaving ${m.angry}`)
}
{ // every mob: hostiles come for you and hurt you (melee, arrows, spells, a creeper's blast), and everything dies to your hits and drops its loot
  const out = [], bad = []
  for (const type of Object.keys(MOBS)) {
    if (type === 'villager') continue
    const M = MOBS[type]
    if (M.hostile) {
      const { w, g, P } = fresh(); pad(w, 6000, -6000, 16); Object.assign(P, { x: 6000.5, y: 101, z: -6000.5, hunger: 20 }); g.time = 18000; g.ents = []
      const m = makeMob(type, 6000.5, 101, -6006.5, seeded(5)); g.ents.push(m)
      let took = 0, t = 0
      for (; t < 600 && !took; t++) { const h = P.hp; g.tick({}); if (P.hp < h) took = h - P.hp; P.hp = 20; P.dead = false }
      out.push(type + ' ' + (took ? t + 't' : 'never')); if (!took) bad.push(type + ' never hurt you')
    }
    const { w, g, P } = fresh(); pad(w, 6000, -6000, 16); Object.assign(P, { x: 6000.5, y: 101, z: -6000.5 }); g.time = 6000; g.ents = []
    const m = makeMob(type, 6000.5, 101, -6002.5, seeded(5)); g.ents.push(m)
    P.inv[P.sel] = { id: toolId(3, 'sword'), n: 1, d: 0 }   // (a diamond sword)
    let n = 0; while (!m.death && n < 300) { m.hurt = 0; P.atkT = 100; g.attackMob(m); n++ }
    for (let i = 0; i < 25; i++) { g.tick({}); P.hp = 20 }
    const loot = g.ents.filter(e => e.e === 'item').length, needs = M.drops.some(([, a]) => a > 0)
    if (!m.death) bad.push(type + ' would not die'); else if (needs && !loot) bad.push(type + ' dropped nothing')
  }
  check('every hostile mob comes for you and hurts you; every mob dies and drops its loot', !bad.length, bad.join(', ') || out.join(', '))
}
{ // a fair fight, played: survival at night in iron armour with an iron sword, aiming and swinging on the cooldown like
  // a player (walk in, hit when charged, back off a creeper), no healing; you win and live against each of these
  const res = [], bad = []
  for (const type of ['zombie', 'skeleton', 'spider', 'creeper', 'goblin', 'rat', 'imp', 'darkwizard', 'darkwarrior', 'scorpion', 'giant']) {
    const { w, g, P } = fresh(), X = 8000, Z = -8000; pad(w, X, Z, 20)
    Object.assign(P, { x: X + 0.5, y: 101, z: Z + 0.5, food: 20, sat: 5 }); g.time = 18000; g.ents = []
    Object.values(ITEMS).filter(i => i && i.armor !== undefined && i.n.startsWith('Iron')).forEach(i => P.armor[i.armor] = { id: i.id, n: 1, d: 0 })
    P.inv[0] = { id: toolId(2, 'sword'), n: 1, d: 0 }; P.sel = 0
    const m = makeMob(type, X + 0.5, 101, Z - 9.5, seeded(3)); g.ents.push(m)
    let t = 0, low = 20
    for (; t < 2400 && !m.death && !P.dead; t++) {
      const dx = m.x - P.x, dz = m.z - P.z, d = Math.hypot(dx, dz), dy = m.y + m.h * 0.5 - (P.y + 1.62)
      const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, d), reach = d - (m.w || 0.6) / 2 < 2.6
      const fuse = m.type === 'creeper' && m.fuse > 0
      g.time = 18000; g.tick({ yaw, pitch, fw: fuse ? -1 : reach ? 0 : 1, attack: reach && P.atkT >= 13, attackPress: reach && P.atkT >= 13 })
      low = Math.min(low, P.hp)
    }
    for (let i = 0; i < 30; i++) g.tick({})
    res.push(`${type} ${t}t hp ${low.toFixed(0)}`)
    if (!m.death) bad.push(type + (P.dead ? ' killed you' : ' never died'))
    else if (P.dead) bad.push(type + ' killed you too')
    else if (MOBS[type].hostile && type !== 'goblin' && !g.adv.hunter) bad.push(type + ': no Monster Hunter')
  }
  check('fair fights, played: in iron gear you beat zombie, skeleton, spider, creeper, goblin, rat, imp, dark wizard, dark warrior, scorpion and hill giant and live', !bad.length, bad.join(', ') + ' | ' + res.join(', '))
}
{ // the big ones, played: rune armour, a runite sword and steaks; swing on the cooldown, back off and eat when low.
  // Every one falls but the King Black Dragon (RS's endgame boss: melee in rune and food isn't enough); the heavy ones
  // stand their ground against your knockback (kbr) and land hits
  const res = [], bad = []
  for (const type of ['blackknight', 'bear', 'unicorn', 'blackunicorn', 'ghost', 'icewarrior', 'mossgiant', 'icegiant', 'lesserdemon', 'greaterdemon', 'greendragon', 'kbd']) {
    const { w, g, P } = fresh(), X = 8000, Z = -8000; pad(w, X, Z, 30)
    Object.assign(P, { x: X + 0.5, y: 101, z: Z + 0.5, food: 20, sat: 5 }); g.time = 18000; g.ents = []
    Object.values(ITEMS).filter(i => i && i.armor !== undefined && i.n.startsWith('Rune')).forEach(i => P.armor[i.armor] = { id: i.id, n: 1, d: 0 })
    P.inv[0] = { id: toolId(5, 'sword'), n: 1, d: 0 }; P.inv[1] = { id: 269, n: 32, d: 0 }; P.sel = 0
    const m = makeMob(type, X + 0.5, 101, Z - 12.5, seeded(3)); g.ents.push(m)
    let t = 0, low = 20
    for (; t < 8000 && !m.death && !P.dead; t++) {
      const dx = m.x - P.x, dz = m.z - P.z, d = Math.hypot(dx, dz), dy = m.y + m.h * 0.5 - (P.y + 1.62)
      const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, d), reach = d - (m.w || 0.6) / 2 < 2.8
      const eating = (P.hp <= 10 || P.food < 18) && count(P.inv, 269) > 0
      if (eating) { g.tick({ yaw: yaw + Math.PI, pitch: 0, fw: 1, sprint: true, sel: 1, use: true, usePress: !P.eat }) }
      else g.tick({ yaw, pitch, sel: 0, fw: reach ? 0 : 1, attack: reach && P.atkT >= 10, attackPress: reach && P.atkT >= 10 })
      g.time = 18000; low = Math.min(low, P.hp)
    }
    res.push(`${type} ${t}t low ${low.toFixed(0)} steaks ${32 - count(P.inv, 269)}`)
    if (type === 'kbd') { if (m.death || !P.dead || t < 400) bad.push('the KBD went down too easily') }
    else if (!m.death || P.dead) bad.push(type + (P.dead ? ' killed you' : ' never died'))
    else if (['lesserdemon', 'greaterdemon', 'greendragon'].includes(type) && low >= 20) bad.push(type + ' never touched you')
  }
  check('the big ones, played in rune with steaks: black knight to green dragon fall (the heavy ones land hits), the King Black Dragon wins', !bad.length, bad.join(', ') + ' | ' + res.join(', '))
}
{ // ...but it falls the MC way: two blocks up a pillar it can't reach (a melee mob needs you within 1.5 of its feet), a bow and arrows
  const { w, g, P } = fresh(), X = 8000, Z = -8000; pad(w, X, Z, 30); w.set(X, 101, Z, 3); w.set(X, 102, Z, 3)
  Object.assign(P, { x: X + 0.5, y: 103, z: Z + 0.5 }); g.time = 6000; g.ents = []
  P.inv[0] = { id: 281, n: 1, d: 0 }; P.inv[1] = { id: 280, n: 64, d: 0 }; P.inv[2] = { id: 280, n: 64, d: 0 }; P.sel = 0
  const m = makeMob('kbd', X + 0.5, 101, Z - 12.5, seeded(3)); g.ents.push(m)
  let t = 0, hold = 0, shots = 0
  for (; t < 6000 && !m.death && !P.dead; t++) {
    const dx = m.x - P.x, dz = m.z - P.z, d = Math.hypot(dx, dz), rel = ++hold > 22
    if (rel) { hold = 0; shots++ }
    g.tick({ yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(m.y + m.h * 0.5 - (P.y + 1.62), d) + d * 0.01, sel: 0, use: !rel, usePress: hold === 1 }); g.time = 6000
  }
  check('...but the King Black Dragon falls to a bow from a two-block pillar, untouched', m.death && !P.dead && P.hp === 20, `${t} ticks, ${shots} arrows, hp ${P.hp}`)
}
{ // more of MC: a bed skips the night and is where you wake after dying (your things drop where you fell); your own bow
  // shoots a cow dead; iron armour takes the edge off a zombie; bone meal grows a sapling to a tree; a chest keeps what
  // you put in it through a save and spills it when broken
  const X = 7000, Z = -7000
  { const { w, g, P } = fresh(); pad(w, X, Z); Object.assign(P, { x: X + 0.5, y: 101, z: Z + 0.5 }); w.set(X + 1, 101, Z, 40)
    g.time = 18000; const d0 = Math.floor(g.time / 24000); g.sleep({ x: X + 1, y: 101, z: Z })
    const morning = g.dayTime < 1000 && Math.floor(g.time / 24000) === d0 + 1
    P.inv[0] = { id: 3, n: 10, d: 0 }; Object.assign(P, { x: X + 6.5, z: Z - 5.5 }); g.die({ why: 'fall' })
    const dropped = g.ents.filter(e => e.e === 'item').length; g.respawn()
    check('a bed skips the night; you wake in it after dying and your things drop where you fell', morning && dropped >= 1 && Math.abs(P.x - (X + 1.5)) < 0.01 && Math.abs(P.z - (Z + 0.5)) < 0.01 && P.hp === 20, `morning ${morning}, dropped ${dropped}, woke at ${P.x},${P.z}`) }
  { const { w, g, P } = fresh(); pad(w, X, Z); Object.assign(P, { x: X + 0.5, y: 101, z: Z + 0.5, yaw: 0, pitch: 0 }); g.ents = []
    const cow = makeMob('cow', X + 0.5, 101, Z - 6.5, seeded(2)); cow.ai.t = 1e9; g.ents.push(cow)
    P.inv[P.sel] = { id: 281, n: 1, d: 0 }; P.inv[5] = { id: 280, n: 16, d: 0 }; g.time = 6000
    let shots = 0
    for (let k = 0; k < 8 && !cow.death; k++) {
      Object.assign(cow, { x: X + 0.5, z: Z - 6.5, vx: 0, vz: 0 }); const pitch = Math.atan2(cow.y + 0.7 - (P.y + 1.62), 6) + 0.06
      for (let i = 0; i < 22; i++) g.tick({ use: true, usePress: i === 0, yaw: 0, pitch }); g.tick({ yaw: 0, pitch }); shots++
      for (let i = 0; i < 30; i++) { cow.ai.t = 1e9; g.tick({ yaw: 0, pitch }) }
    }
    check('your own bow shoots a cow dead (arrows used up, bow worn)', cow.death && count(P.inv, 280) === 16 - shots && P.inv[P.sel].d >= shots, `${shots} arrows, cow hp ${cow.hp}`) }
  { const { g, P } = fresh(); const z = makeMob('zombie', P.x, P.y, P.z), hit = () => { P.hp = 20; P.invul = 0; g.hurtPlayer(MOBS.zombie.dmg, z); return 20 - P.hp }
    const bare = hit(); Object.values(ITEMS).filter(i => i && i.armor !== undefined && i.n.startsWith('Iron')).forEach(i => P.armor[i.armor] = { id: i.id, n: 1, d: 0 })
    const iron = hit(); check('iron armour takes the edge off a zombie (MC armour points)', iron < bare * 0.5 && iron > 0, `${bare} -> ${iron.toFixed(2)}`) }
  { const { w, g, P } = fresh('survival'); pad(w, X, Z); w.set(X, 100, Z - 2, 2); w.set(X, 101, Z - 2, 65); Object.assign(P, { x: X + 0.5, y: 101, z: Z + 0.5 })
    P.inv[P.sel] = { id: 288, n: 2, d: 0 }; const pitch = -Math.atan2(1.62 - 0.4, 2)
    g.tick({ use: true, usePress: true, yaw: 0, pitch })
    let logs = 0, leaves = 0; for (let y = 101; y < 110; y++) for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) { const id = w.get(X + a, y, Z - 2 + c); if (id === 10) logs++; if (id === 12) leaves++ }
    check('bone meal on a sapling grows it into an oak', logs >= 4 && leaves > 10 && count(P.inv, 288) === 1, `logs ${logs}, leaves ${leaves}`) }
  { const { w, g, P } = fresh('survival'); pad(w, X, Z); w.set(X, 101, Z - 2, 27); const c = g.chest(X + ',101,' + (Z - 2)); c[0] = { id: 264, n: 3, d: 0 }; c[26] = { id: 4, n: 64, d: 0 }
    const s = JSON.parse(JSON.stringify(g.save())), r = fresh('survival'); r.g.load(s); const c2 = r.g.chest(X + ',101,' + (Z - 2))
    const kept = c2[0] && c2[0].id === 264 && c2[0].n === 3 && c2[26].n === 64
    r.g.breakBlock(X, 101, Z - 2, true); const spill = r.g.ents.filter(e => e.e === 'item').map(e => e.it ? e.it.id : e.id)
    check('a chest keeps its things through a save, and spills them when broken', kept && r.g.ents.filter(e => e.e === 'item').length >= 3, `kept ${!!kept}, items out ${spill.length}`) }
}
{ // the RS ground stays as the map has it: MC's grass/dirt ticks leave natural cells alone when the client says so
  const { w, g, P } = fresh(); P.x = 1170.5; P.z = -402.5
  w.keep = (x, y, z) => w.natural(x, y, z)
  let flips = 0; w.listeners.push((x, y, z, id, was) => { if ((id === 1 || id === 2) && (was === 1 || was === 2)) flips++ })
  for (let i = 0; i < 3000; i++) g.tick({})
  check('no grass <-> dirt flips on the map\'s own ground', flips === 0, `${flips} flips`)
}

// ---------------------------------------------------------------- survival from spawn to diamonds, played with nothing but inputs and the screens:
// walk to trees and fell them, craft, dig a staircase down, strip-mine (the cheapest pick that harvests each block, so
// the iron one lasts for diamonds), place a furnace in the tunnel, fight what comes (seen and in reach), step out of lava
{
  const { w, g, P } = fresh()
  let fights = 0, kills = 0, T = 0
  const fl = Math.floor, cell = () => [fl(P.x), fl(P.y + 0.01), fl(P.z)]
  const solid = (x, y, z) => BLOCKS[w.get(x, y, z)].solid
  const wet = (x, y, z) => { for (const [a, b, c] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) if (BLOCKS[w.get(x + a, y + b, z + c)].liquid) return true; return false }
  const best = (kind) => { for (const t of [5, 4, 2, 1, 0]) { const i = P.inv.findIndex(s => s && s.id === toolId(t, kind)); if (i >= 0) return i } return -1 }
  const toHot = (i) => { if (i < 0) return -1; if (i < 9) return i; const k = 8, t = P.inv[k]; P.inv[k] = P.inv[i]; P.inv[i] = t; return k }
  const aimAt = (x, y, z) => { const dx = x - P.x, dy = y - (P.y + 1.62), dz = z - P.z; return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) } }
  const bout = new Map()
  const seen = (m) => { const ex = P.x, ey = P.y + 1.62, ez = P.z, tx = m.x, ty = m.y + m.h * 0.6, tz = m.z, L = Math.hypot(tx - ex, ty - ey, tz - ez), n = Math.ceil(L * 6); for (let i = 1; i < n; i++) { const k = i / n; if (solid(fl(ex + (tx - ex) * k), fl(ey + (ty - ey) * k), fl(ez + (tz - ez) * k))) return false } return true }
  // every tick goes through here: a monster close by gets fought first (aim, swing on the cooldown), like a player would
  function step(inp) {
    T++
    const foe = g.ents.filter(m => m.e === 'mob' && !m.death && MOBS[m.type].hostile && Math.hypot(m.x - P.x, m.z - P.z) < (MOBS[m.type].ranged ? 16 : 5) && Math.abs(m.y - P.y) < 3 && seen(m) && (bout.get(m) || 0) < 600).sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0]
    if (foe) { fights++; bout.set(foe, (bout.get(foe) || 0) + 1); const s = toHot(best('sword')), a = aimAt(foe.x, foe.y + foe.h * 0.5, foe.z), d = Math.hypot(foe.x - P.x, foe.z - P.z) - foe.w / 2
      const fuse = foe.type === 'creeper' && foe.fuse > 0
      const nx = fl(P.x - Math.sin(a.yaw) * 0.9), nz = fl(P.z - Math.cos(a.yaw) * 0.9), cy = fl(P.y + 0.01), safe = !wet(nx, cy, nz) && solid(nx, cy - 1, nz) && w.get(nx, cy - 1, nz) !== 9   // (never charge into lava or off a drop)
    g.tick({ ...a, sel: s >= 0 ? s : P.sel, fw: fuse ? -1 : d > 2.5 && safe ? 1 : 0, attack: d < 2.8 && P.atkT >= 12, attackPress: d < 2.8 && P.atkT >= 12 }); if (foe.death) kills++; return }
    const sniper = g.ents.find(m => m.e === 'mob' && !m.death && MOBS[m.type].ranged && Math.hypot(m.x - P.x, m.z - P.z) < 16 && Math.abs(m.y - P.y) >= 3 && seen(m))   // (a skeleton up on a ledge: out of its sight)
  if (sniper && P.hurtT > 0 && typeof turns === 'number') { const a = Math.atan2(-(P.x - sniper.x), -(P.z - sniper.z)); for (let i = 0; i < 30; i++) g.tick({ yaw: a, pitch: 0, fw: 1, sprint: true, jump: i % 10 === 0 }); dir = DIRS[(DIRS.indexOf(dir) + 1) % 4]; return }
  if (P.hp < 14 && P.food < 18) { const f = P.inv.findIndex((s, i) => i < 9 && s && [264, 265, 269, 271, 273].includes(s.id)); if (f >= 0) { g.tick({ sel: f, use: true, usePress: !P.eat }); return } }
    if (P.inLava || P.fire > 0 && wet(...cell())) { const back = [-dir[0], -dir[1]]; g.tick({ yaw: Math.atan2(-back[0], -back[1]), pitch: 0, fw: 1, jump: true, sprint: true }); return }
    g.tick(inp)
  }
  // dig one block from where you stand (it must be in reach); whatever's in the way goes first
  const pickFor = (id) => { for (const t of [0, 1, 2, 4, 5]) { const i = P.inv.findIndex(s => s && s.id === toolId(t, 'pick')); if (i >= 0 && digInfo(id, toolId(t, 'pick')).harvest) return i } return best('pick') }   // (the cheapest pick that harvests it: the iron one is for diamonds)
  function dig(x, y, z, kind = 'pick') {
    const s = toHot(kind === 'pick' ? pickFor(w.get(x, y, z)) : best(kind)); let n = 0
    while (w.get(x, y, z) && !BLOCKS[w.get(x, y, z)].liquid && n++ < 900) {
      const a = aimAt(x + 0.5, y + 0.5, z + 0.5); P.yaw = a.yaw; P.pitch = a.pitch
      const t = g.target(); if (!t) { step({ ...a }); continue }
      step({ ...a, sel: s >= 0 ? s : 0, attack: true, attackPress: !P.dig })
    }
    return !w.get(x, y, z)
  }
  function walkTo(x, z, tol = 0.35, max = 400) {
    let n = 0, stuck = 0, lx = P.x, lz = P.z
    while (Math.hypot(x - P.x, z - P.z) > tol && n++ < max) {
      const a = aimAt(x, P.y + 1.62, z), moved = Math.hypot(P.x - lx, P.z - lz); lx = P.x; lz = P.z
      stuck = moved < 0.02 ? stuck + 1 : 0
      step({ yaw: a.yaw, pitch: 0, fw: Math.min(1, Math.hypot(x - P.x, z - P.z) * 2), jump: stuck > 3 })
    }
    return Math.hypot(x - P.x, z - P.z) <= tol + 0.2
  }
  function collect(r = 7) { for (let k = 0; k < 6; k++) { const it = g.ents.filter(e => e.e === 'item' && Math.hypot(e.x - P.x, e.z - P.z) < r && Math.abs(e.y - P.y) < 3).sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0]; if (!it) return; walkTo(it.x, it.z, 0.3, 150); for (let i = 0; i < 12; i++) step({}) } }
  const sticks = (n) => { for (let k = 0; k < 6 && count(P.inv, 256) < n; k++) { if (count(P.inv, 11) < 2 && count(P.inv, 10)) craftIt('inv', [10, 0, 0, 0]); if (count(P.inv, 11) >= 2) craftIt('inv', [0, 11, 0, 11]); else return false } return count(P.inv, 256) >= n }
  const craftIt = (type, grid) => {
    const need = grid.filter(v => v === 256).length; if (need && type === 'craft' && count(P.inv, 256) < need && !sticks(need)) return false
    const scr = screenFor(type, g), si = (sec, i) => scr.slots.findIndex(s => s.sec === sec && (i === undefined || s.i === i))
    for (let i = 0; i < grid.length; i++) { const id = grid[i]; if (!id) continue
      const from = scr.slots.findIndex(s => (s.sec === 'main' || s.sec === 'hot') && s.arr[s.i] && s.arr[s.i].id === id); if (from < 0) { closeScreen(g, scr); return false }
      click(g, scr, from, 0, false); click(g, scr, si('grid', i), 1, false); click(g, scr, from, 0, false) }
    const b = JSON.stringify(P.inv); click(g, scr, si('res'), 0, false); const got = !!P.cursor; if (P.cursor) { const e = P.inv.findIndex(s => !s); P.inv[e] = P.cursor; P.cursor = null } closeScreen(g, scr); return got && b !== JSON.stringify(P.inv)
  }
  for (let i = 0; i < 20; i++) step({})
  const [sx, sy, sz] = cell()
  // 1. walk to trees and fell them
  const trees = []; for (let x = sx - 25; x <= sx + 25; x++) for (let z = sz - 25; z <= sz + 25; z++) { const y = w.gy[w.tile(x, z)] + 1; if (w.get(x, y, z) === 79) trees.push([x, y, z]) }
  trees.sort((a, b) => Math.hypot(a[0] - sx, a[2] - sz) - Math.hypot(b[0] - sx, b[2] - sz))
  for (const [x, y, z] of trees) { if (count(P.inv, 10) >= 6) break; if (w.get(x, y, z) !== 79) continue
    const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, c]) => [x + a, z + c]).filter(([a, c]) => !solid(a, y, c) && !solid(a, y + 1, c)).sort((p, q) => Math.hypot(p[0] - P.x, p[1] - P.z) - Math.hypot(q[0] - P.x, q[1] - P.z))[0]
    if (!side || !walkTo(side[0] + 0.5, side[1] + 0.5, 0.4, 500)) continue
    dig(x, y, z, 'axe'); collect() }
  check('played, no shortcuts: walked to trees from spawn and felled them by hand', count(P.inv, 10) >= 6 && g.adv.wood, `${count(P.inv, 10)} logs, ${T} ticks`)
  for (let i = 0; i < 4; i++) craftIt('inv', [10, 0, 0, 0])
  craftIt('inv', [11, 11, 11, 11]); craftIt('inv', [0, 11, 0, 11]); craftIt('inv', [0, 11, 0, 11])
  craftIt('craft', [11, 11, 11, 0, 256, 0, 0, 256, 0]); craftIt('craft', [0, 11, 0, 0, 11, 0, 0, 256, 0])
  check('played, no shortcuts: crafted a table, sticks, a wooden pickaxe and sword', count(P.inv, toolId(0, 'pick')) === 1 && count(P.inv, toolId(0, 'sword')) === 1, `table ${count(P.inv, 24)} planks ${count(P.inv, 11)} sticks ${count(P.inv, 256)} logs ${count(P.inv, 10)}`)
  // 2. a staircase down: dig the three cells ahead (head, feet, the step below), step down; turn away from water/lava
  let dir = [1, 0], turns = 0
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]
  function stairDown(toY) {
    let n = 0
    while (cell()[1] > toY && n++ < 400 && !P.dead) {
      const [x, y, z] = cell(), fx = x + dir[0], fz = z + dir[1]
      if (wet(fx, y + 1, fz) || wet(fx, y, fz) || wet(fx, y - 1, fz) || wet(fx, y - 2, fz) || w.get(fx, y - 2, fz) === 0) { dir = DIRS[(DIRS.indexOf(dir) + 1) % 4]; if (++turns > 40) return false; continue }
      dig(fx, y + 1, fz); dig(fx, y, fz); dig(fx, y - 1, fz)
      walkTo(fx + 0.5, fz + 0.5, 0.3, 120); for (let i = 0; i < 8; i++) step({}); collect(3)
      if (count(P.inv, 4) >= 3 && !count(P.inv, toolId(1, 'pick'))) craftIt('craft', [4, 4, 4, 0, 256, 0, 0, 256, 0])
      if (count(P.inv, 4) >= 2 && !count(P.inv, toolId(1, 'sword')) && count(P.inv, 256)) craftIt('craft', [0, 4, 0, 0, 4, 0, 0, 256, 0])
    }
    return cell()[1] <= toY
  }
  // a full inventory: throw out the dirt, gravel and stone past two stacks of cobblestone, as a player would (Q)
  function junk() {
    let keep = 2
    for (let i = 0; i < 36; i++) { const st = P.inv[i]; if (!st || ![2, 13, 3, 4, 1, 12].includes(st.id)) continue; if (st.id === 4 && keep-- > 0) continue
      const h = toHot(i); step({ sel: h, drop: true, dropAll: true }) }
    for (let i = 0; i < 20; i++) step({ yaw: P.yaw + Math.PI, fw: 0 })
  }
  // a gap ahead (a cave): bridge it with cobblestone against the side of the block you stand on, as in MC
  function bridge(x, y, z, fx, fz) {
    const ci = toHot(P.inv.findIndex(s => s && s.id === 4)), a = aimAt(x + 0.5 + (fx - x) * 0.5, y - 0.5, z + 0.5 + (fz - z) * 0.5)
    for (let i = 0; i < 6 && !solid(fx, y - 1, fz); i++) { P.yaw = a.yaw; P.pitch = a.pitch; step({ ...a, sel: ci, sneak: true, use: true, usePress: true }); step({ ...a, sneak: true }) }
  }
  // 3. strip mine: a 1x2 tunnel ahead; any ore beside, above or below it comes out too
  const ORES = new Set([14, 15, 17])
  function tunnel(len, want) {
    let moved = 0, turned = 0; const vis = new Set()
    for (let k = 0; moved < len && turned < len && !P.dead && !want(); k++) {
      if (P.inv.filter(Boolean).length >= 30) junk()
      { const [x, y, z] = cell(); if (!solid(x, y - 1, z)) { const o = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].find(([a, c]) => solid(x + a, y - 1, z + c) && w.get(x + a, y - 1, z + c) !== 9 && !solid(x + a, y, z + c) && !solid(x + a, y + 1, z + c) && !wet(x + a, y, z + c)); if (o) walkTo(x + o[0] + 0.5, z + o[1] + 0.5, 0.25, 60) } }   // (stood on a block's edge over a cave: onto the block)
      let [x, y, z] = cell(), fx = x + dir[0], fz = z + dir[1]; vis.add(x + ',' + z)
      if (vis.has(fx + ',' + fz)) { const d = DIRS.find(([a, c]) => !vis.has((x + a) + ',' + (z + c)) && !wet(x + a, y, z + c) && !wet(x + a, y + 1, z + c) && solid(x + a, y - 1, z + c)); if (d) { dir = d; fx = x + d[0]; fz = z + d[1] } }   // (new ground, not round the same loop)
      if (!wet(fx, y - 1, fz) && !solid(fx, y - 1, fz) && solid(x, y - 1, z) && count(P.inv, 4)) bridge(x, y, z, fx, fz)
      if (wet(fx, y, fz) || wet(fx, y + 1, fz) || !solid(fx, y - 1, fz) || w.get(fx, y - 1, fz) === 9) { dir = DIRS[(DIRS.indexOf(dir) + (turned % 7 === 3 ? 3 : 1)) % 4]; turned++; continue }
      moved++
      dig(fx, y + 1, fz); dig(fx, y, fz); walkTo(fx + 0.5, fz + 0.5, 0.3, 120); collect(3)
      const [cx, cy, cz] = cell()
      for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1], [0, 2, 0]]) if (ORES.has(w.get(cx + a, cy + b, cz + c)) && !wet(cx + a, cy + b, cz + c)) { dig(cx + a, cy + b, cz + c); collect(3) }
      if (count(P.inv, 4) >= 3 && !count(P.inv, toolId(1, 'pick'))) craftIt('craft', [4, 4, 4, 0, 256, 0, 0, 256, 0])
    }
  }
  stairDown(sy - 8); for (let k = 0; k < 30 && count(P.inv, 4) < 3 && !count(P.inv, toolId(1, 'pick')); k++) { turns = 0; if (!stairDown(cell()[1] - 1)) tunnel(4, () => false) }
  if (!count(P.inv, toolId(1, 'pick'))) craftIt('craft', [4, 4, 4, 0, 256, 0, 0, 256, 0])
  for (let i = 0; i < 12; i++) step({})
  check('played, no shortcuts: dug a staircase down: cobblestone, a stone pickaxe ("Stone Age", "Getting an Upgrade")', count(P.inv, toolId(1, 'pick')) >= 1 && g.adv.stone && g.adv.upgrade, `y ${cell()[1]}, cobble ${count(P.inv, 4)}, ${T} ticks`)
  for (let k = 0; k < 20 && !stairDown(16); k++) { turns = 0; tunnel(6, () => false) }
  tunnel(600, () => count(P.inv, 15) >= 3 && count(P.inv, 257) >= 2)
  check('played, no shortcuts: strip-mined coal and iron ore', count(P.inv, 15) >= 3 && count(P.inv, 257) >= 2, `iron ${count(P.inv, 15)}, coal ${count(P.inv, 257)}, y ${cell()[1]}, ${T} ticks`)
  // 4. a furnace in the tunnel: place it on the floor ahead, smelt the ore
  for (let k = 0; count(P.inv, 4) < 8 && k < 40; k++) { const [x, y, z] = cell(); dig(x + dir[0], y + 1, z + dir[1]); dig(x + dir[0], y, z + dir[1]); walkTo(x + dir[0] + 0.5, z + dir[1] + 0.5, 0.3, 100); collect(3) }
  craftIt('craft', [4, 4, 4, 4, 0, 4, 4, 4, 4])
  { const [x, y, z] = cell(), [bx, bz] = DIRS.map(([a, c]) => [x + a, z + c]).find(([a, c]) => !w.get(a, y, c) && !w.get(a, y + 1, c) && solid(a, y - 1, c)) || [x - dir[0], z - dir[1]]; walkTo(x + 0.5 - (bx - x) * 0.2, z + 0.5 - (bz - z) * 0.2, 0.2, 60)
    const fi = toHot(P.inv.findIndex(s => s && s.id === 25)), a = aimAt(bx + 0.5, y + 0.02, bz + 0.5)
    for (let i = 0; i < 40 && w.get(bx, y, bz) !== 25; i++) { P.yaw = a.yaw; P.pitch = a.pitch; step({ ...a, sel: fi, use: true, usePress: true }); step(a) }
    const ok = w.get(bx, y, bz) === 25
    const fs = screenFor('furnace', g, bx + ',' + y + ',' + bz)
    click(g, fs, fs.slots.findIndex(s => (s.sec === 'main' || s.sec === 'hot') && s.arr[s.i] && s.arr[s.i].id === 15), 0, true)
    click(g, fs, fs.slots.findIndex(s => (s.sec === 'main' || s.sec === 'hot') && s.arr[s.i] && s.arr[s.i].id === 257), 0, true)
    closeScreen(g, fs)
    for (let i = 0; i < 700; i++) step({})
    const fs2 = screenFor('furnace', g, bx + ',' + y + ',' + bz); click(g, fs2, fs2.slots.findIndex(s => s.sec === 'fout'), 0, true); closeScreen(g, fs2); for (let i = 0; i < 12; i++) step({})
    check('played, no shortcuts: placed a furnace in the tunnel and smelted iron ("Acquire Hardware")', ok && count(P.inv, 258) >= 3 && g.adv.iron, `placed ${ok}, ingots ${count(P.inv, 258)}`) }
  craftIt('craft', [258, 258, 258, 0, 256, 0, 0, 256, 0]); for (let i = 0; i < 12; i++) step({})
  check('played, no shortcuts: an iron pickaxe ("Isn\'t It Iron Pick")', count(P.inv, toolId(2, 'pick')) >= 1 && g.adv.ironpick)
  for (let k = 0; k < 60 && !stairDown(11) && cell()[1] > 14; k++) { turns = 0; tunnel(6, () => false) }   // (water under the floor: y 14 is diamond depth already)
  tunnel(3000, () => count(P.inv, 260) >= 1)
  for (let i = 0; i < 12; i++) step({})
  check('played, no shortcuts: strip-mined for diamonds ("Diamonds!")', count(P.inv, 260) >= 1 && g.adv.diamonds, `diamonds ${count(P.inv, 260)}, y ${cell()[1]}`)
  check('played, no shortcuts: lived through it, fighting what came', !P.dead, `${T} ticks (${(T / 20 / 60).toFixed(1)} min), ${fights} fight ticks, ${kills} kills, hp ${P.hp.toFixed(1)}, food ${P.food}, adv ${Object.keys(g.adv).join(',')}`)
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
