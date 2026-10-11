// Battle royale ("RuneRoyale"): the match itself, shared by serve.ts (online) and the browser (solo / offline).
// Pure: no three.js, no DOM. It needs the collision World (src/world.js) for loot spots, the storm's landing
// points, bots and building, and a send(to, msg, except) to talk to the players (to = an id or null = everyone).
//
// The flow: everybody rides the King Black Dragon across Lumbridge and jumps when they like, skydives, glides
// down, loots chests and the floor, builds (walls, floors, ramps, roofs from wood, stone and metal), breaks
// anything in the world, and the storm closes in until one is left standing. The match keeps the storm, the
// clock, health and shields, every chest, item, build piece and broken bit of the world, and runs the bots
// that fill the lobby. Players' own movement and aim stay on their own screens (they report hits, like the
// rest of the game trusts its clients); the match checks the numbers stay sane.

export const BR = {
  SIZE: 16,            // a match is topped up with bots to this many
  LOBBY: 20,           // seconds the lobby waits for more players
  BUS_T: 28,           // seconds the dragon takes to cross
  BUS_Y: 52,           // flying height
  G: 3,                // build grid cell (game units)
  H: 2.7,              // build piece height
  HP: 100, SH: 100,
  FALL_SAFE: 6,        // a drop (on foot) this far is free; more hurts
  GLIDE_AT: 16,        // gliders open this high above the ground at the latest
  PICK_R: 3.2,         // reach for chests and items
  END_WAIT: 9,         // seconds the result shows before everyone is back skating
};

export const RARITY = [
  { name: 'Common', col: '#b4b4b4', m: 1 }, { name: 'Uncommon', col: '#4c4', m: 1.06 }, { name: 'Rare', col: '#4af', m: 1.12 },
  { name: 'Epic', col: '#c6f', m: 1.18 }, { name: 'Legendary', col: '#fb3', m: 1.25 },
];
export const AMMO = { arrows: 'Arrows', bolts: 'Bolts', death: 'Death runes', dragon: 'Dragon arrows', fire: 'Fire runes' };
const AMMO_PACK = { arrows: 30, bolts: 20, death: 8, dragon: 4, fire: 2 };
// RuneScape gear standing in for the usual guns. dmg per hit (per pellet for the staff), rate = shots/s,
// spread = radians off aim from the hip (ads = aiming down sights), range = the damage falloff distance.
export const WEAPONS = {
  pick: { name: 'Rune pickaxe', melee: true, dmg: 20, rate: 1.9, range: 3, struct: 55, col: 0x55c8e8 },
  smg: { name: 'Magic shortbow', ammo: 'arrows', dmg: 15, rate: 10, mag: 30, reload: 2.1, spread: 0.055, ads: 0.03, range: 60, auto: true, struct: 13, col: 0x8a5a2a },
  ar: { name: 'Rune crossbow', ammo: 'bolts', dmg: 30, rate: 5.5, mag: 30, reload: 2.3, spread: 0.035, ads: 0.006, range: 130, auto: true, struct: 26, col: 0x3fb0d8 },
  shotgun: { name: 'Ancient staff', ammo: 'death', dmg: 9, pellets: 10, rate: 1.1, mag: 5, reload: 4.4, spread: 0.11, ads: 0.08, range: 24, struct: 9, col: 0x6a4a8a },
  sniper: { name: 'Dark bow', ammo: 'dragon', dmg: 105, rate: 0.45, mag: 1, reload: 2.6, spread: 0.12, ads: 0, range: 300, scope: true, struct: 100, col: 0x2a2a30 },
  rocket: { name: 'Fire wave staff', ammo: 'fire', dmg: 110, rate: 0.6, mag: 1, reload: 3, spread: 0.01, ads: 0, range: 200, proj: 34, splash: 4.5, struct: 650, col: 0xe04010 },
};
const W_RAR = { smg: [0, 1, 2, 3], ar: [0, 1, 2, 3, 4], shotgun: [0, 1, 2, 3, 4], sniper: [2, 3, 4], rocket: [3, 4] };
const W_PREF = { smg: 2.2, ar: 3, shotgun: 2.7, sniper: 2.3, rocket: 2.4 };      // how much a bot wants each
export const HEALS = {
  shrimp: { name: 'Shrimps', hp: 15, cap: 75, use: 1.6, stack: 15, col: '#f96' },
  shark: { name: 'Shark', hp: 100, cap: 100, use: 4.5, stack: 3, col: '#9bd' },
  brew: { name: 'Saradomin brew', sh: 25, cap: 50, use: 1.8, stack: 6, col: '#fe8' },
  superdef: { name: 'Super defence', sh: 50, cap: 100, use: 3.5, stack: 3, col: '#6cf' },
};
// gadgets: a launch pad throws whoever steps on it into the sky (then they glide); a spike trap hurts the
// next enemies to walk over it (3 goes, a couple of seconds apart)
export const GADGETS = { pad: { name: 'Launch pad', stack: 1, col: '#4cf' }, trap: { name: 'Spike trap', stack: 3, col: '#ccc', dmg: 75, uses: 3 } };
export const EDITS = { wall: ['', 'door', 'window', 'half'], floor: ['', 'hole'] };
export const CART = { MAX: 15, RAM: 7 };    // mine carts: top speed, and the speed a ram starts to hurt at
export const MATS = { wood: { name: 'Wood', hp: 150, col: 0x9a6a3a }, stone: { name: 'Stone', hp: 300, col: 0x8a8a8e }, metal: { name: 'Metal', hp: 500, col: 0x6a7a8e } };
export const MAT_ORDER = ['wood', 'stone', 'metal'];
export const BUILD_COST = 10, MAT_MAX = 999;
// breaking the world: hit points by what it is, and what harvesting it gives you
export const OBJ_HP = { wall: 260, door: 90, fence: 70, rail: 90, block: 120, tree: 160, tile: 140 };
export const OBJ_MAT = { wall: 'stone', door: 'wood', fence: 'wood', rail: 'metal', block: 'stone', tree: 'wood', tile: 'stone' };
export const BOT_NAMES = ['Hans', 'Duke Horacio', 'Father Aereck', 'Sir Prysin', 'Aggie', 'Thurgo', 'Doric', 'Hetty', 'Ned', 'Morgan', 'Reldo',
  'Zaff', 'Baraek', 'Lowe', 'Horvik', 'Aubury', 'Wydin', 'Romeo', 'Juliet', 'Gertrude', 'Bob', 'Cook', 'Shopkeeper', 'Wise Old Man', 'Gypsy Aris',
  'Sir Amik', 'Osman', 'Ali Morrisane', 'Fred', 'Seth', 'Veronica', 'Ernest'];
// armour sets the bots wear (item ids from the cache: helm, body, shield, legs)
export const BOT_SETS = [[1155, 1117, 1189, 1075], [1153, 1115, 1191, 1067], [1157, 1119, 1193, 1069], [1165, 1125, 1195, 1077], [1159, 1121, 1197, 1071],
  [1161, 1123, 1199, 1073], [1163, 1127, 1201, 1079], [2657, 2653, 2659, 2655], [2665, 2661, 2667, 2663], [2673, 2669, 2675, 2671], [1169, 1129, 1171, 1095], [579, 577, 1171, 1011]];

/** seeded random numbers (mulberry32): the same seed gives the same match everywhere */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const pickW = (r, list) => { let tot = 0; for (const [, w] of list) tot += w; let x = r() * tot; for (const [v, w] of list) if ((x -= w) < 0) return v; return list[list.length - 1][0]; };

/** where the match is played: the always-loaded core of the map (Lumbridge, Draynor, Al Kharid's edge) */
export function arenaOf(world) {
  const r = world.rects[0], S = world.S;
  return { x: (r.x0 + r.w / 2) * S, z: (r.z0 + r.h / 2) * S, r: Math.min(r.w, r.h) / 2 * S - 8 };
}

// ------------------------------------------------------------------ the storm
// [seconds before it moves, seconds it takes, next radius as a share of this one, damage per second outside]
const PHASES = [[64, 40, 0.58, 1], [40, 32, 0.5, 2], [30, 26, 0.5, 4], [24, 22, 0.45, 6], [18, 20, 0.4, 8], [14, 22, 0, 10]];
export function stormPlan(seed, arena, ok) {
  const r = rng(seed ^ 0x5eed); let t = 0, cur = { x: arena.x, z: arena.z, r: arena.r };
  const out = [];
  for (const [wait, shrink, f, dmg] of PHASES) {
    const nr = cur.r * f; let nx = cur.x, nz = cur.z;
    for (let i = 0; i < 24; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (cur.r - nr) * 0.92;
      nx = cur.x + Math.cos(a) * d; nz = cur.z + Math.sin(a) * d;
      if (!ok || ok(nx, nz)) break;
    }
    const to = { x: Math.round(nx * 10) / 10, z: Math.round(nz * 10) / 10, r: Math.round(nr * 10) / 10 };
    out.push({ t1: t + wait, t2: t + wait + shrink, from: cur, to, dmg });
    t += wait + shrink; cur = to;
  }
  return out;
}
/** the storm at match time t: the safe circle now, the next one, damage outside, when it moves next */
export function stormAt(plan, t) {
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    if (t < p.t1) return { x: p.from.x, z: p.from.z, r: p.from.r, dmg: p.dmg, next: p.to, phase: i, shrinking: false, until: p.t1 };
    if (t < p.t2) {
      const k = (t - p.t1) / (p.t2 - p.t1);
      return { x: p.from.x + (p.to.x - p.from.x) * k, z: p.from.z + (p.to.z - p.from.z) * k, r: p.from.r + (p.to.r - p.from.r) * k, dmg: p.dmg, next: p.to, phase: i, shrinking: true, until: p.t2 };
    }
  }
  const l = plan[plan.length - 1];
  return { x: l.to.x, z: l.to.z, r: l.to.r, dmg: l.dmg, next: l.to, phase: plan.length, shrinking: false, until: Infinity };
}

// ------------------------------------------------------------------ the dragon (battle bus)
export function busPath(seed, arena) {
  const r = rng(seed ^ 0xb05), a = r() * Math.PI * 2, off = (r() - 0.5) * arena.r * 0.7;
  const dx = Math.cos(a), dz = Math.sin(a), cx = arena.x - dz * off, cz = arena.z + dx * off, L = Math.sqrt(arena.r * arena.r - off * off) * 0.94;   // (all of it over the first circle)
  return { ax: cx - dx * L, az: cz - dz * L, bx: cx + dx * L, bz: cz + dz * L, y: BR.BUS_Y, T: BR.BUS_T };
}
export function busAt(b, t) {
  const k = Math.max(0, Math.min(1, t / b.T));
  return { x: b.ax + (b.bx - b.ax) * k, z: b.az + (b.bz - b.az) * k, y: b.y, k, heading: Math.atan2(b.bz - b.az, b.bx - b.ax) };
}

// ------------------------------------------------------------------ loot
export function rollWeapon(r, bonus = 0) {
  const w = pickW(r, [['smg', 30], ['ar', 30], ['shotgun', 28], ['sniper', 8], ['rocket', 4]]);
  const rars = W_RAR[w], weights = [44, 30, 17, 7, 2].map((x, i) => [i, i < bonus ? x * 0.2 : x * (1 + bonus * i * 0.35)]);
  const rar = pickW(r, weights.filter(([i]) => rars.includes(i)));
  return { t: 'w', w, r: rar, a: WEAPONS[w].mag };
}
export const ammoFor = (w, k = 1) => ({ t: 'a', a: WEAPONS[w].ammo, n: AMMO_PACK[WEAPONS[w].ammo] * k });
const rollHeal = r => { const h = pickW(r, [['shrimp', 34], ['shark', 14], ['brew', 34], ['superdef', 18]]); return { t: 'h', h, n: h === 'shrimp' ? 5 : h === 'brew' ? 3 : 1 }; };
const rollGadget = r => { const g = r() < 0.5 ? 'pad' : 'trap'; return { t: 'g', g, n: g === 'trap' ? 2 : 1 }; };
const rollAmmo = r => { const a = pickW(r, [['arrows', 30], ['bolts', 30], ['death', 24], ['dragon', 10], ['fire', 6]]); return { t: 'a', a, n: AMMO_PACK[a] }; };
/** what a chest / floor spot / ammo box / supply drop holds */
export function rollLoot(r, kind) {
  if (kind === 'chest') {
    const w = rollWeapon(r, 1), out = [w, ammoFor(w.w)];
    if (r() < 0.7) out.push(rollHeal(r));
    if (r() < 0.22) out.push(rollGadget(r));
    out.push({ t: 'm', m: 'wood', n: 30 });
    return out;
  }
  if (kind === 'ammo') return [rollAmmo(r), rollAmmo(r)];
  if (kind === 'supply') { const w = rollWeapon(r, 3); return [w, ammoFor(w.w, 2), { t: 'h', h: 'superdef', n: 2 }, { t: 'g', g: 'pad', n: 1 }, { t: 'm', m: 'stone', n: 60 }, { t: 'm', m: 'metal', n: 40 }]; }
  const x = r();
  if (x < 0.55) { const w = rollWeapon(r); return [w, ammoFor(w.w)]; }
  return [x < 0.8 ? rollHeal(r) : x < 0.93 ? rollAmmo(r) : rollGadget(r)];
}
/** a sane item from a client (drops), or null */
export function cleanItem(it) {
  if (!it || typeof it !== 'object') return null;
  if (it.t === 'w' && WEAPONS[it.w] && !WEAPONS[it.w].melee) return { t: 'w', w: it.w, r: Math.max(0, Math.min(4, it.r | 0)), a: Math.max(0, Math.min(WEAPONS[it.w].mag, it.a | 0)) };
  if (it.t === 'a' && AMMO[it.a]) return { t: 'a', a: it.a, n: Math.max(1, Math.min(999, it.n | 0)) };
  if (it.t === 'h' && HEALS[it.h]) return { t: 'h', h: it.h, n: Math.max(1, Math.min(HEALS[it.h].stack, it.n | 0)) };
  if (it.t === 'g' && GADGETS[it.g]) return { t: 'g', g: it.g, n: Math.max(1, Math.min(GADGETS[it.g].stack, it.n | 0)) };
  if (it.t === 'm' && MATS[it.m]) return { t: 'm', m: it.m, n: Math.max(1, Math.min(MAT_MAX, it.n | 0)) };
  return null;
}
export const itemName = it => it.t === 'w' ? `${RARITY[it.r].name} ${WEAPONS[it.w].name}` : it.t === 'a' ? `${AMMO[it.a]} x${it.n}` : it.t === 'h' ? `${HEALS[it.h].name}${it.n > 1 ? ' x' + it.n : ''}` : it.t === 'g' ? `${GADGETS[it.g].name}${it.n > 1 ? ' x' + it.n : ''}` : `${MATS[it.m].name} x${it.n}`;

/** chests (inside buildings, by walls), floor loot and ammo boxes, spread over the arena; deterministic */
export function lootSpots(world, seed, arena) {
  const r = rng(seed ^ 0x1007), S = world.S, N = world.N, rect = world.rects[0];
  const byWall = [], open = [];
  for (let tz = rect.z0 + 1; tz < rect.z0 + rect.h - 1; tz++) for (let tx = rect.x0 + 1; tx < rect.x0 + rect.w - 1; tx++) {
    if (world.blocked[tz * N + tx] !== 0) continue;
    const x = (tx + 0.5) * S, z = (tz + 0.5) * S;
    if (Math.hypot(x - arena.x, z - arena.z) > arena.r - 3) continue;
    let walls = 0, near = false;
    for (const s of world.segsNear(x, z, 1)) {
      const d = segDist(x, z, s);
      if (d < 0.35 * S) near = true;
      if (s.kind === 'wall' && d < 0.75 * S) walls++;
    }
    if (near && !walls) continue;                              // squeezed against a fence or a hedge: not a spot
    if (walls) byWall.push([x, z]); else if (r() < 0.12) open.push([x, z]);
  }
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  shuffle(byWall); shuffle(open);
  const taken = [], far = (x, z, d) => taken.every(([a, b]) => Math.hypot(a - x, b - z) >= d);
  const take = (list, n, gap, own = 0) => { const out = []; for (const [x, z] of list) { if (out.length >= n) break; if (!far(x, z, gap) || out.some(([a, b]) => Math.hypot(a - x, b - z) < own)) continue; taken.push([x, z]); out.push([x, z]); } return out; };
  const at = ([x, z]) => ({ x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, y: Math.round(world.height(x, z) * 100) / 100 });
  return {
    chests: take(byWall, 80, 11).map((p, i) => ({ k: 'c' + i, kind: 'chest', ...at(p) })),
    ammo: take([...open, ...byWall], 36, 9).map((p, i) => ({ k: 'a' + i, kind: 'ammo', ...at(p) })),
    floor: take([...byWall.slice(0, 600), ...open], 130, 7).map(p => at(p)),
    vend: take(byWall, 6, 6, 40).map((p, i) => ({ k: 'v' + i, kind: 'vend', ...at(p) })),    // vending machines
    carts: take(open, 8, 5, 30).map(p => at(p)),                                              // mine carts to drive
  };
}

// ------------------------------------------------------------------ building
// Pieces sit on a G x G grid. A wall stands on a cell edge (d 0 = the south edge, along x; d 1 = the west edge,
// along z), from y to y + H. Floors, ramps (rising toward d: 0 +x, 1 +z, 2 -x, 3 -z) and roofs (cones) fill a cell.
// They join the collision world: walls as segments (with a bottom and a top), the rest as walkable decks.
export const pieceKey = p => `${p.k === 'wall' ? 'w' + p.d : p.k[0]}:${p.i},${p.j},${Math.round(p.y * 4)}`;
export function pieceSeg(p) {
  const G = BR.G, x = p.i * G, z = p.j * G;
  return p.d === 0 ? { ax: x, az: z, bx: x + G, bz: z } : { ax: x, az: z, bx: x, bz: z + G };
}
export function addPiece(world, p) {
  if (p.k === 'wall') {
    const s = pieceSeg(p), seg = (bot, hi) => world.addSeg({ ...s, kind: 'wall', top: null, bot, hi, piece: p.id });
    if (p.e === 'window') { seg(p.y, p.y + 1.05); seg(p.y + 1.95, p.y + BR.H); }       // shoot through the gap, can't walk through
    else if (p.e === 'half') seg(p.y, p.y + 1.1);                                       // low enough to jump over
    else if (p.e !== 'door') seg(p.y, p.y + BR.H);
  } else if (!(p.k === 'floor' && p.e === 'hole')) world.addDeck({ id: p.id, k: p.k, i: p.i, j: p.j, y: p.y, d: p.d, G: BR.G, H: BR.H });
}
export function removePiece(world, p) {
  if (p.k === 'wall') world.removeSegs(s => s.piece === p.id);
  else world.removeDeck(p.id);
}
/** a piece is held up by the ground under it, or by a piece it touches that is */
function grounded(world, p) {
  const G = BR.G, x = (p.i + 0.5) * G, z = (p.j + 0.5) * G;
  if (p.k === 'wall') { const s = pieceSeg(p); return p.y <= Math.max(world.height(s.ax, s.az), world.height(s.bx, s.bz), world.height((s.ax + s.bx) / 2, (s.az + s.bz) / 2)) + 0.35; }
  let lo = Infinity; for (const [u, v] of [[0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85], [0.5, 0.5]]) lo = Math.min(lo, world.height((p.i + u) * G, (p.j + v) * G));
  void x; void z;
  return p.y <= lo + 0.35;
}
function touching(a, b) {
  const H = BR.H, yo = Math.min(a.y + H, b.y + H) - Math.max(a.y, b.y);
  if (yo < -0.05) return false;                                   // their heights must meet
  const box = p => p.k === 'wall' ? (p.d === 0 ? [p.i, p.j - 0.01, p.i + 1, p.j + 0.01] : [p.i - 0.01, p.j, p.i + 0.01, p.j + 1]) : [p.i, p.j, p.i + 1, p.j + 1];
  const A = box(a), B = box(b);
  return A[0] <= B[2] + 0.02 && B[0] <= A[2] + 0.02 && A[1] <= B[3] + 0.02 && B[1] <= A[3] + 0.02;
}
/** ids of the pieces left hanging in the air once `gone` came down */
export function unsupported(world, pieces) {
  const all = [...pieces.values()], ok = new Set(), q = [];
  for (const p of all) if (grounded(world, p)) { ok.add(p.id); q.push(p); }
  while (q.length) { const a = q.pop(); for (const b of all) if (!ok.has(b.id) && touching(a, b)) { ok.add(b.id); q.push(b); } }
  return all.filter(p => !ok.has(p.id)).map(p => p.id);
}

// ------------------------------------------------------------------ geometry helpers
export function segDist(x, z, s) {
  const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2));
  return Math.hypot(x - s.ax - dx * t, z - s.az - dz * t);
}
/** first thing between two points (the match's line of sight: walls, fences, build walls, tree trunks), or null */
export function lineBlock(world, ax, ay, az, bx, by, bz) {
  const L = Math.hypot(bx - ax, bz - az); if (L < 0.01) return null;
  const seen = new Set(); let best = null;
  const n = Math.ceil(L / 0.9);
  for (let i = 0; i <= n; i++) {
    const px = ax + (bx - ax) * i / n, pz = az + (bz - az) * i / n;
    for (const s of world.segsNear(px, pz, 0.6)) {
      if (seen.has(s)) continue; seen.add(s);
      if (s.kind === 'water' || s.kind === 'edge') continue;
      const t = crossT(ax, az, bx, bz, s); if (t === null || (best && t >= best.t)) continue;
      const y = ay + (by - ay) * t, cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
      let hit;
      if (s.hi !== undefined) hit = y >= s.bot && y <= s.hi;
      else if (s.top) hit = y < Math.max(s.top[0], s.top[1], s.top[2]);
      else hit = y < world.height(cx, cz) + 3.6;
      if (hit) best = { t, s, x: cx, y, z: cz };
    }
    for (const tr of world.trunksNear(px, pz, 0.6)) {
      if (seen.has(tr)) continue; seen.add(tr);
      const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((tr.x - ax) * dx + (tr.z - az) * dz) / (L * L)));
      if (Math.hypot(ax + dx * t - tr.x, az + dz * t - tr.z) > tr.r + 0.05 || (best && t >= best.t)) continue;
      const y = ay + (by - ay) * t;
      if (y < world.height(tr.x, tr.z) + 5) best = { t, tree: tr, x: ax + dx * t, y, z: az + dz * t };
    }
  }
  return best;
}
function crossT(ax, az, bx, bz, s) {
  const rx = bx - ax, rz = bz - az, sx = s.bx - s.ax, sz = s.bz - s.az, den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((s.ax - ax) * sz - (s.az - az) * sx) / den, u = ((s.ax - ax) * rz - (s.az - az) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}
/** the key a breakable thing in the world goes by (the same on every machine) */
export const segObjKey = s => `${s.kind === 'wall' ? 'wall' : s.kind === 'rail' ? 'rail' : s.kind === 'fence' ? 'fence' : s.kind === 'door' ? 'door' : 'block'}|${Math.round(s.ax * 10)},${Math.round(s.az * 10)},${Math.round(s.bx * 10)},${Math.round(s.bz * 10)}`;
export const treeKey = t => `tree|${Math.round(t.x * 10)},${Math.round(t.z * 10)}`;
export const tileKey = (tx, tz) => `tile|${tx},${tz}`;
export const objKind = k => k.slice(0, k.indexOf('|'));

/** take a broken thing out of a collision World. Returns what went, for the renderer to flatten
 *  ({ boxes: [[x0, z0, x1, z1], ...] in game units }) and an undo record for restoreWorld (the skate world
 *  comes back whole after a match), or null if there was nothing by that key. */
export function breakInWorld(world, key) {
  const kind = objKind(key), S = world.S;
  if (kind === 'tree') {
    const [x, z] = key.slice(5).split(',').map(v => +v / 10);
    let found = null;
    for (const t of world.trunksNear(x, z, 1)) if (Math.abs(t.x - x) < 0.06 && Math.abs(t.z - z) < 0.06) found = t;
    if (!found) return null;
    for (const [k, l] of world.trunkGrid) { const i = l.indexOf(found); if (i >= 0) { l.splice(i, 1); if (!l.length) world.trunkGrid.delete(k); } }
    const tx = Math.floor(x / S), tz = Math.floor(z / S), tiles = [];
    if (world.blocked[tz * world.N + tx] === 4) { tiles.push([tz * world.N + tx, 4]); world.blocked[tz * world.N + tx] = 0; }
    world._tall = null;
    return { boxes: [[x - 1.3 * S, z - 1.3 * S, x + 1.3 * S, z + 1.3 * S]], undo: { trunks: [found], tiles } };
  }
  if (kind === 'tile') {
    const [tx, tz] = key.slice(5).split(',').map(Number);
    if (tx < 0 || tz < 0 || tx >= world.N || tz >= world.N) return null;
    const old = world.blocked[tz * world.N + tx];
    world.blocked[tz * world.N + tx] = 0; world._tall = null;
    return { boxes: [[tx * S, tz * S, (tx + 1) * S, (tz + 1) * S]], undo: { tiles: [[tz * world.N + tx, old]] } };
  }
  const [ax, az, bx, bz] = key.slice(kind.length + 1).split(',').map(v => +v / 10);
  const near = [...world.segsNear((ax + bx) / 2, (az + bz) / 2, 1)];
  const s = near.find(q => q.piece === undefined && !q.frontier && Math.abs(q.ax - ax) < 0.06 && Math.abs(q.az - az) < 0.06 && Math.abs(q.bx - bx) < 0.06 && Math.abs(q.bz - bz) < 0.06);
  if (!s) return null;
  world.removeSegs(q => q === s);
  // a rail/fence/hedge line that ran along it is no longer grindable
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  const gone = new Set(world.rails.filter(r => r.park === undefined && segDist(mx, mz, r) < 0.05)), tiles = [];
  if (gone.size) {
    world.rails = world.rails.filter(r => !gone.has(r));
    for (const [k, l] of world.railGrid) { const f = l.filter(r => !gone.has(r)); if (f.length !== l.length) { if (f.length) world.railGrid.set(k, f); else world.railGrid.delete(k); } }
  }
  // the tiles either side of a blocked footprint open up
  const pad = 0.4 * S;
  for (const [px, pz] of [[mx + pad * 0.6, mz + pad * 0.6], [mx - pad * 0.6, mz - pad * 0.6], [mx + pad * 0.6, mz - pad * 0.6], [mx - pad * 0.6, mz + pad * 0.6]]) {
    const tx = Math.floor(px / S), tz = Math.floor(pz / S);
    if (tx >= 0 && tz >= 0 && tx < world.N && tz < world.N && world.blocked[tz * world.N + tx] === 1) { tiles.push([tz * world.N + tx, 1]); world.blocked[tz * world.N + tx] = 0; }
  }
  world._tall = null;
  return { boxes: [[Math.min(ax, bx) - pad, Math.min(az, bz) - pad, Math.max(ax, bx) + pad, Math.max(az, bz) + pad]], undo: { segs: [s], rails: [...gone], tiles } };
}

/** put back what breakInWorld took (undo records, any order) */
export function restoreWorld(world, undos) {
  for (const u of [...undos].reverse()) {
    for (const s of u.segs || []) world.addSeg(s);
    for (const r of u.rails || []) world.addRail(r);
    for (const t of u.trunks || []) world.addTrunk(t);
    for (const [i, v] of u.tiles || []) world.blocked[i] = v;
  }
  world._tall = null;
}

// ------------------------------------------------------------------ the match
const now0 = () => 0;
export class BRMatch {
  /** world: a collision World it may change (builds, breaks); send(to, msg, except): to = id | null (everyone) */
  constructor({ world, seed = (Math.random() * 2 ** 31) | 0, send, clock = now0 }) {
    this.w = world; this.seed = seed; this.send = send; this.clock = clock;
    this.arena = arenaOf(world);
    this.state = 'lobby'; this.t = 0;
    this.p = new Map();                     // id -> player (people and bots)
    this.pieces = new Map(); this.slots = new Map(); this.pid = 1;
    this.items = new Map(); this.iid = 1;
    this.chests = new Map();
    this.objHp = new Map(); this.broken = []; this.undos = [];
    this.drops = []; this.dropN = 0;
    this.carts = new Map(); this.gadgets = new Map(); this.gid = 1;
    this.stormTick = 0; this.botTick = 0; this.sendTick = 0; this.overT = 0;
  }
  get alive() { return [...this.p.values()].filter(p => p.alive); }
  join(id, name, { bot = false, outfit = null } = {}) {
    if (this.state !== 'lobby' || this.p.has(id) || this.p.size >= BR.SIZE) return false;
    this.p.set(id, { id, name, bot, outfit, hp: BR.HP, sh: 0, alive: true, kills: 0, x: 0, y: 0, z: 0, ph: 'bus', dealt: 0 });
    return true;
  }
  fillBots() {
    const r = rng(this.seed ^ 0xb075), names = [...BOT_NAMES];
    let n = 0;
    while (this.p.size < BR.SIZE) {
      const name = names.splice(Math.floor(r() * names.length), 1)[0] || 'Bot ' + n;
      const set = BOT_SETS[Math.floor(r() * BOT_SETS.length)];
      this.join('b' + n++, name, { bot: true, outfit: { g: r() < 0.3 ? 1 : 0, items: { 0: set[0], 4: set[1], 5: set[2], 7: set[3] }, kits: {} } });
    }
  }
  start() {
    const w = this.w, S = w.S, ok = (x, z) => w.tileKind(x, z) === 0 && w.isLive(Math.floor(x / S), Math.floor(z / S));
    this.plan = stormPlan(this.seed, this.arena, ok);
    this.bus = busPath(this.seed, this.arena);
    const spots = lootSpots(w, this.seed, this.arena), r = this.r = rng(this.seed ^ 0x17e5);
    for (const c of [...spots.chests, ...spots.ammo]) this.chests.set(c.k, { ...c, open: false });
    spots.vend.forEach((v, i) => { const it = rollWeapon(r, 3); it.r = Math.max(2, it.r); this.chests.set(v.k, { ...v, open: false, it, mat: MAT_ORDER[i % 3], cost: [100, 100, 150, 250, 400][it.r] }); });
    this.carts = new Map(spots.carts.map((c, i) => ['m' + i, { id: 'm' + i, ...c, h: Math.round(r() * 628) / 100, rider: null }]));
    this.gadgets = new Map(); this.gid = 1;
    for (const f of spots.floor) for (const it of rollLoot(r, 'floor')) this.addItem(it, f.x + (r() - 0.5) * 0.8, f.y, f.z + (r() - 0.5) * 0.8, false);
    // supply drops: one into each of the first circles, as it is announced
    this.drops = this.plan.slice(0, 4).map((p, i) => ({ at: (i ? this.plan[i - 1].t2 : 40) + 6, c: p.to }));
    const br = rng(this.seed ^ 0xd209);
    for (const p of this.p.values()) {
      p.hp = BR.HP; p.sh = 0; p.alive = true; p.kills = 0; p.ph = 'bus';
      if (p.bot) Object.assign(p, { jumpAt: 3 + br() * (BR.BUS_T - 6), inv: null, heals: [], mats: 60, think: 0, goal: null, enemy: null, react: 0, fireT: 0, mag: 0, reloadT: 0, strafe: 1, strafeT: 0, stuck: 0, lastX: 0, lastZ: 0, detour: 0, buildT: 0, calm: 0, useT: 0, h: 0, wk: 0 });
    }
    this.state = 'live'; this.t = 0;
    this.send(null, { op: 'start', seed: this.seed, arena: this.arena, plan: this.plan, bus: this.bus,
      chests: [...this.chests.values()], items: [...this.items.values()], carts: [...this.carts.values()], players: [...this.p.values()].map(p => ({ id: p.id, name: p.name, bot: p.bot ? 1 : 0, outfit: p.outfit })) });
  }
  addItem(it, x, y, z, announce = true) {
    const o = { id: 'i' + this.iid++, it, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, z: Math.round(z * 100) / 100 };
    this.items.set(o.id, o);
    if (announce) this.send(null, { op: 'items', list: [o] });
    return o;
  }
  /** the client of player `id` reports where it is (its skater snapshot) */
  pos(id, x, y, z) {
    const p = this.p.get(id); if (!p || p.bot || !Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(y)) return;
    p.x = x; p.y = y; p.z = z;
    if (p.ph === 'fall' && y - this.w.height(x, z) < 1.5) p.ph = 'ground';
  }

  // ---------------------------------------------------------------- damage
  damage(v, amt, by = null, w = '', hd = false) {
    if (!v || !v.alive || this.state !== 'live' || !(amt > 0)) return;
    amt = Math.round(amt);
    const toSh = Math.min(v.sh, amt); v.sh -= toSh; v.hp -= amt - toSh;
    const k = by != null ? this.p.get(by) : null; if (k && k !== v) k.dealt += amt;
    this.send(null, { op: 'hp', id: v.id, hp: Math.max(0, v.hp), sh: v.sh, by, d: amt, hd: hd ? 1 : 0, w });
    if (v.bot && by != null && by !== v.id) { v.hurtBy = by; v.calm = 0; }
    if (v.hp <= 0) this.eliminate(v, by, w);
  }
  eliminate(v, by, w) {
    if (!v.alive) return;
    v.alive = false; v.hp = 0;
    const left = this.alive.length, k = by != null && by !== v.id ? this.p.get(by) : null;
    if (k) { k.kills++; if (k.bot) { k.emSeq = ((k.emSeq || 0) + 1) % 100; k.em = 300 + k.emSeq; k.emT = 3; } }   // a bot that gets the elim dances
    v.place = left + 1;
    if (v.cart) { const c = this.carts.get(v.cart); if (c) { c.rider = null; this.send(null, { op: 'cart', c }); } v.cart = null; }
    this.send(null, { op: 'elim', id: v.id, name: v.name, by: k ? k.id : null, byName: k ? k.name : null, w: w || '', place: v.place, left });
    if (v.bot) {                                         // a bot's loot spills out where it fell
      const out = [];
      if (v.inv) out.push(v.inv, ammoFor(v.inv.w));
      for (const h of v.heals) out.push(h);
      if (v.mats >= 10) out.push({ t: 'm', m: 'wood', n: v.mats });
      out.forEach((it, i) => out[i] = this.addItem(it, v.x + Math.cos(i * 1.7) * 0.9, this.w.height(v.x, v.z), v.z + Math.sin(i * 1.7) * 0.9, false));
      if (out.length) this.send(null, { op: 'items', list: out });
    }
    if (left <= 1) this.finish();
  }
  finish() {
    if (this.state !== 'live') return;
    const win = this.alive[0] || null;
    if (win) win.place = 1;
    this.state = 'over'; this.overT = 0;
    this.send(null, { op: 'over', id: win ? win.id : null, name: win ? win.name : null, kills: win ? win.kills : 0,
      board: [...this.p.values()].sort((a, b) => (a.place || 99) - (b.place || 99)).map(p => ({ id: p.id, name: p.name, place: p.place || 1, kills: p.kills, bot: p.bot ? 1 : 0 })) });
  }
  explode(x, y, z, r, dmg, by, w = 'rocket') {
    for (const v of this.p.values()) {
      if (!v.alive) continue;
      const d = Math.hypot(v.x - x, v.y + 0.9 - y, v.z - z);
      if (d < r && !lineBlock(this.w, x, y + 0.3, z, v.x, v.y + 0.9, v.z)) this.damage(v, dmg * (1 - 0.7 * d / r) * (v.id === by ? 0.5 : 1), by, w);
    }
    for (const p of [...this.pieces.values()]) {
      const G = BR.G, px = (p.i + (p.k === 'wall' ? (p.d === 0 ? 0.5 : 0) : 0.5)) * G, pz = (p.j + (p.k === 'wall' ? (p.d === 1 ? 0.5 : 0) : 0.5)) * G;
      if (Math.hypot(px - x, p.y + BR.H / 2 - y, pz - z) < r + 1.2) this.hitPiece(p.id, WEAPONS.rocket.struct, by);
    }
    // the world: everything breakable in reach comes down
    const keys = new Set();
    for (const s of this.w.segsNear(x, z, r)) {
      if (s.piece !== undefined || s.frontier || s.kind === 'water' || s.kind === 'edge') continue;
      if (segDist(x, z, s) < r * 0.75 && (s.top ? y < Math.max(...s.top) + r : y < this.w.height(x, z) + 6)) keys.add(segObjKey(s));
    }
    for (const t of this.w.trunksNear(x, z, r)) if (Math.hypot(t.x - x, t.z - z) < r * 0.75) keys.add(treeKey(t));
    for (const k of keys) this.hitObj(k, WEAPONS.rocket.struct, by);
  }
  hitPiece(id, d, by) {
    const p = this.pieces.get(id); if (!p || !(d > 0)) return;
    p.hp -= Math.min(d, 2000);
    if (p.hp > 0) { this.send(null, { op: 'phit', id, hp: Math.round(p.hp) }); return; }
    this.dropPieces([id]);
    void by;
  }
  dropPieces(ids) {
    for (const id of ids) { const p = this.pieces.get(id); if (!p) continue; this.pieces.delete(id); this.slots.delete(pieceKey(p)); removePiece(this.w, p); }
    const more = unsupported(this.w, this.pieces);
    for (const id of more) { const p = this.pieces.get(id); this.pieces.delete(id); this.slots.delete(pieceKey(p)); removePiece(this.w, p); }
    this.send(null, { op: 'pgone', ids: [...ids, ...more] });
  }
  hitObj(k, d, by) {
    if (typeof k !== 'string' || k.length > 60 || !OBJ_HP[objKind(k)] || this.broken.includes(k)) return;
    const hp = (this.objHp.has(k) ? this.objHp.get(k) : OBJ_HP[objKind(k)]) - Math.min(d, 1000);
    if (hp > 0) { this.objHp.set(k, hp); return; }
    const r = breakInWorld(this.w, k); if (!r) return;
    this.objHp.delete(k); this.broken.push(k); this.undos.push(r.undo);
    this.send(null, { op: 'broken', k, boxes: r.boxes });
    void by;
  }
  build(by, q) {
    const k = String(q.k), m = MATS[q.m] ? q.m : 'wood';
    if (!['wall', 'floor', 'ramp', 'cone'].includes(k)) return null;
    const p = { k, i: q.i | 0, j: q.j | 0, y: Math.round(+q.y * 4) / 4, d: (q.d | 0) & 3, m, e: '' };
    if (!Number.isFinite(p.y) || Math.abs(p.y) > 200 || this.pieces.size > 3000) return null;
    if (k === 'wall') p.d &= 1;
    const key = pieceKey(p); if (this.slots.has(key)) return null;
    const G = BR.G; if (Math.hypot((p.i + 0.5) * G - this.arena.x, (p.j + 0.5) * G - this.arena.z) > this.arena.r + 30) return null;
    p.id = this.pid++; p.hp = MATS[m].hp; p.max = MATS[m].hp; p.by = by;
    this.pieces.set(p.id, p); this.slots.set(key, p.id); addPiece(this.w, p);
    this.send(null, { op: 'built', p });
    return p;
  }

  // ---------------------------------------------------------------- what players send
  msg(id, m) {
    const p = this.p.get(id); if (!p || !m || typeof m !== 'object') return;
    if (m.op === 'leave') { if (this.state === 'live' && p.alive) this.eliminate(p, null, 'left'); return; }
    if (this.state !== 'live') return;
    if (m.op === 'fx') { this.send(null, { op: 'fx', by: id, w: String(m.w || '').slice(0, 10), a: (m.a || []).slice(0, 6).map(Number), b: (m.b || []).slice(0, 36).map(Number) }, id); return; }
    if (m.op === 'jump') { p.ph = 'fall'; return; }
    if (!p.alive) return;
    if (m.op === 'open') {
      const c = this.chests.get(String(m.k));
      if (!c || c.open || c.kind === 'vend' || (c.land && this.t < c.land) || Math.hypot(c.x - p.x, c.z - p.z) > BR.PICK_R + 1.5) return;
      this.openChest(c, id);
    } else if (m.op === 'buy') {                       // a vending machine (the client paid the materials)
      const c = this.chests.get(String(m.k));
      if (!c || c.open || c.kind !== 'vend' || Math.hypot(c.x - p.x, c.z - p.z) > BR.PICK_R + 1.5) return;
      c.open = true;
      const out = [this.addItem({ ...c.it }, c.x + 0.8, c.y, c.z, false), this.addItem(ammoFor(c.it.w, 2), c.x - 0.8, c.y, c.z, false)];
      this.send(null, { op: 'opened', k: c.k, by: id }); this.send(null, { op: 'items', list: out });
    } else if (m.op === 'gadget') {
      const g = String(m.g), [x, y, z] = [+m.x, +m.y, +m.z];
      if (!GADGETS[g] || ![x, y, z].every(Number.isFinite) || Math.hypot(x - p.x, z - p.z) > 6 || this.gadgets.size > 400) return;
      const o = { id: 'g' + this.gid++, g, x: r2(x), y: r2(y), z: r2(z), by: id, cd: 0, uses: GADGETS[g].uses || 0 };
      this.gadgets.set(o.id, o); this.send(null, { op: 'gadget', o });
    } else if (m.op === 'ride') {
      const c = this.carts.get(String(m.id));
      if (!c || c.rider || p.cart || Math.hypot(c.x - p.x, c.z - p.z) > 4.5) return;
      c.rider = id; p.cart = c.id; this.send(null, { op: 'cart', c });
    } else if (m.op === 'unride' || m.op === 'drive') {
      const c = p.cart && this.carts.get(p.cart); if (!c) return;
      const [x, y, z, h] = [+m.x, +m.y, +m.z, +m.h];
      if ([x, y, z, h].every(Number.isFinite) && Math.hypot(x - c.x, z - c.z) < 12) { c.x = r2(x); c.y = r2(y); c.z = r2(z); c.h = r2(h); }
      if (m.op === 'unride') { c.rider = null; p.cart = null; this.send(null, { op: 'cart', c }); }
      else this.send(null, { op: 'cart', c }, id);
    } else if (m.op === 'pick') {
      const it = this.items.get(String(m.id));
      if (!it || Math.hypot(it.x - p.x, it.z - p.z) > BR.PICK_R + 1.5) return;
      this.items.delete(it.id); this.send(null, { op: 'gone', id: it.id, by: id });
    } else if (m.op === 'drop') {
      const it = cleanItem(m.it); if (!it) return;
      this.addItem(it, p.x + (Math.random() - 0.5), this.w.height(p.x, p.z), p.z + (Math.random() - 0.5));
    } else if (m.op === 'drops') {                     // eliminated: everything it carried, in one go
      const list = (Array.isArray(m.list) ? m.list : []).slice(0, 12).map(cleanItem).filter(Boolean);
      const out = list.map((it, i) => this.addItem(it, p.x + Math.cos(i * 1.7) * 0.9, this.w.height(p.x, p.z), p.z + Math.sin(i * 1.7) * 0.9, false));
      if (out.length) this.send(null, { op: 'items', list: out });
    } else if (m.op === 'hit') {
      const v = this.p.get(m.v); if (!v || v === p) return;
      const now = this.t; p.hitW = (p.hitW || []).filter(t => now - t < 1); if (p.hitW.length > 30) return; p.hitW.push(now);
      this.damage(v, Math.max(0, Math.min(230, +m.d || 0)), id, String(m.w || '').slice(0, 10), !!m.hd);
    } else if (m.op === 'boom') {
      const [x, y, z] = [+m.x, +m.y, +m.z]; if (![x, y, z].every(Number.isFinite) || Math.hypot(x - p.x, z - p.z) > 260) return;
      this.explode(x, y, z, WEAPONS.rocket.splash, WEAPONS.rocket.dmg, id);
    } else if (m.op === 'self') this.damage(p, Math.max(0, Math.min(100, +m.d || 0)), null, String(m.why || 'fall').slice(0, 10));
    else if (m.op === 'heal') {
      const h = HEALS[m.h]; if (!h) return;
      if (h.hp) p.hp = Math.max(p.hp, Math.min(h.cap, p.hp + h.hp)); else p.sh = Math.max(p.sh, Math.min(h.cap, p.sh + h.sh));
      this.send(null, { op: 'hp', id, hp: p.hp, sh: p.sh, by: null, d: 0 });
    } else if (m.op === 'build') this.build(id, m.p || {});
    else if (m.op === 'pdmg') this.hitPiece(m.id | 0, Math.max(0, Math.min(700, +m.d || 0)), id);
    else if (m.op === 'odmg') this.hitObj(String(m.k), Math.max(0, Math.min(700, +m.d || 0)), id);
    else if (m.op === 'edit') {                       // walls: door / window / half wall; floors: a hole; ramps: turn round
      const pc = this.pieces.get(m.id | 0); if (!pc || pc.k === 'cone') return;
      removePiece(this.w, pc);
      if (pc.k === 'ramp') pc.d = (pc.d + 2) % 4;
      else { const l = EDITS[pc.k]; pc.e = l[(l.indexOf(pc.e) + 1) % l.length]; }
      addPiece(this.w, pc);
      this.send(null, { op: 'edited', id: pc.id, e: pc.e, d: pc.d });
    }
  }
  /** put the world back the way it was (every break undone, every build gone), ready for the next match */
  reset() {
    restoreWorld(this.w, this.undos); this.undos = [];
    this.w.removeSegs(s => s.piece !== undefined); this.w.clearDecks();
  }
  openChest(c, by) {
    c.open = true;
    const r = rng(this.seed ^ hash(c.k)), list = rollLoot(r, c.sd ? 'supply' : c.kind);
    const out = list.map((it, i) => this.addItem(it, c.x + Math.cos(i * 2.1 + 0.4) * 1.1, c.y, c.z + Math.sin(i * 2.1 + 0.4) * 1.1, false));
    this.send(null, { op: 'opened', k: c.k, by });
    this.send(null, { op: 'items', list: out });
    return out;
  }

  // ---------------------------------------------------------------- the clock
  tick(dt) {
    if (this.state === 'over') { this.overT += dt; return; }
    if (this.state !== 'live') return;
    this.t += dt;
    const st = stormAt(this.plan, this.t);
    if ((this.stormTick += dt) >= 1) {
      this.stormTick -= 1;
      for (const p of this.p.values()) if (p.alive && p.ph !== 'bus' && Math.hypot(p.x - st.x, p.z - st.z) > st.r) this.damage(p, st.dmg, null, 'storm');
    }
    for (const d of this.drops) if (!d.done && this.t >= d.at) {
      d.done = true;
      const r = rng(this.seed ^ (0x5d + this.dropN));
      let x = d.c.x, z = d.c.z;
      for (let i = 0; i < 20; i++) { const a = r() * 6.283, q = Math.sqrt(r()) * d.c.r * 0.7; x = d.c.x + Math.cos(a) * q; z = d.c.z + Math.sin(a) * q; if (this.w.tileKind(x, z) === 0) break; }
      const c = { k: 'sd' + this.dropN++, kind: 'chest', sd: 1, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, y: Math.round(this.w.height(x, z) * 100) / 100, land: Math.round(this.t + 14), open: false };
      this.chests.set(c.k, c);
      this.send(null, { op: 'chest', c });
    }
    // gadgets: spike traps bite enemies on top of them, launch pads throw bots (people launch themselves)
    for (const g of this.gadgets.values()) {
      g.cd -= dt; if (g.cd > 0) continue;
      for (const p of this.p.values()) {
        if (p.padOn === g.id && Math.hypot(p.x - g.x, p.z - g.z) > 1.5) p.padOn = null;
        if (!p.alive || p.ph !== 'ground' || Math.hypot(p.x - g.x, p.z - g.z) > 1.1 || Math.abs(p.y - g.y) > 1.6) continue;
        if (g.g === 'pad') { if (p.bot && p.padOn !== g.id) { p.padOn = g.id; p.ph = 'fall'; p.launch = 26; p.useT = 0; p.using = null; p.goal = { x: p.x + Math.cos(p.h) * 30, z: p.z + Math.sin(p.h) * 30 }; this.send(null, { op: 'trap', id: g.id }); } continue; }
        if (p.id === g.by) continue;
        this.damage(p, GADGETS.trap.dmg, g.by, 'trap'); g.cd = 2; g.uses--;
        this.send(null, { op: 'trap', id: g.id });
        break;
      }
      if (g.g === 'trap' && g.uses <= 0) { this.gadgets.delete(g.id); this.send(null, { op: 'ggone', id: g.id }); }
    }
    // the bus: anyone still on board at the end of the line is thrown off
    if (this.t > BR.BUS_T) for (const p of this.p.values()) if (p.ph === 'bus') p.ph = 'fall';
    if ((this.botTick += dt) >= 0.1) { const s = this.botTick; this.botTick = 0; for (const b of this.p.values()) if (b.bot && b.alive) this.botStep(b, s, st); }
    if ((this.sendTick += dt) >= 0.1) {
      this.sendTick = 0;
      const b = [];
      for (const p of this.p.values()) if (p.bot && p.alive) b.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.h), p.ph === 'bus' ? 0 : p.ph === 'fall' ? (p.y - this.w.height(p.x, p.z) > BR.GLIDE_AT ? 1 : 2) : 3, p.wk, p.inv ? p.inv.w : '', p.emT > 0 ? p.em : 0]);
      this.send(null, { op: 'bots', mt: r2(this.t), b, n: this.alive.length });
    }
  }

  // ---------------------------------------------------------------- bots
  botStep(b, dt, st) {
    const w = this.w;
    if (b.ph === 'bus') {
      const at = busAt(this.bus, this.t); b.x = at.x; b.z = at.z; b.y = at.y; b.h = at.heading;
      if (this.t >= b.jumpAt) {
        b.ph = 'fall';
        // aim for a chest somewhere near (most drop close to the line, a few go far)
        const cs = [...this.chests.values()].filter(c => !c.sd && c.kind !== 'vend'), r = Math.random() * 70;
        const want = [b.x + (Math.random() - 0.5) * r * 2, b.z + (Math.random() - 0.5) * r * 2];
        let best = null, bd = Infinity; for (const c of cs) { const d = Math.hypot(c.x - want[0], c.z - want[1]); if (d < bd) { bd = d; best = c; } }
        b.goal = best ? { x: best.x, z: best.z, chest: best.k } : { x: this.arena.x, z: this.arena.z };
      }
      return;
    }
    if (b.ph === 'fall') {
      const g = w.height(b.x, b.z), glide = b.y - g < BR.GLIDE_AT;
      const dx = b.goal.x - b.x, dz = b.goal.z - b.z, d = Math.hypot(dx, dz), sp = glide ? 10 : 7;
      if (d > 0.5) { b.x += dx / d * Math.min(d, sp * dt); b.z += dz / d * Math.min(d, sp * dt); b.h = Math.atan2(dz, dx); }
      if (b.launch > 0) { b.y += b.launch * dt; b.launch -= 30 * dt; } else b.y -= (glide ? 5 : 22) * dt;
      if (b.y <= w.height(b.x, b.z)) { b.y = w.height(b.x, b.z); b.ph = 'ground'; b.lastX = b.x; b.lastZ = b.z; this.botUnstick(b); }
      return;
    }
    // ---- on the ground: think now and then
    b.react -= dt; b.fireT -= dt; b.reloadT -= dt; b.buildT -= dt; b.strafeT -= dt; b.calm += dt; b.detour -= dt;
    if ((b.think -= dt) <= 0) { b.think = 0.35 + Math.random() * 0.2; this.botThink(b, st); }
    if (b.emT > 0) { b.emT -= dt; if (!b.enemy) { b.wk = 0; return; } b.emT = 0; }      // the victory dance (cut short by a fight)
    // healing: stand still and eat
    if (b.useT > 0) {
      b.wk = 0; b.useT -= dt;
      if (b.useT <= 0 && b.using) { const h = HEALS[b.using.h]; if (h.hp) b.hp = Math.max(b.hp, Math.min(h.cap, b.hp + h.hp)); else b.sh = Math.max(b.sh, Math.min(h.cap, b.sh + h.sh)); if (--b.using.n <= 0) b.heals.splice(b.heals.indexOf(b.using), 1); b.using = null; this.send(null, { op: 'hp', id: b.id, hp: b.hp, sh: b.sh, by: null, d: 0 }); }
      if (b.enemy) { b.useT = 0; b.using = null; }
      else return;
    }
    // ---- move
    let mx = 0, mz = 0, run = true;
    const e = b.enemy && this.p.get(b.enemy);
    if (e && e.alive && b.inv) {
      const dx = e.x - b.x, dz = e.z - b.z, d = Math.hypot(dx, dz) || 1, want = { shotgun: 6, smg: 13, ar: 24, sniper: 55, rocket: 30 }[b.inv.w];
      if (b.strafeT <= 0) { b.strafeT = 0.8 + Math.random() * 1.2; b.strafe = Math.random() < 0.5 ? -1 : 1; }
      const toward = d > want + 4 ? 1 : d < want - 4 ? -0.8 : 0;
      mx = dx / d * toward - dz / d * b.strafe * 0.8; mz = dz / d * toward + dx / d * b.strafe * 0.8; run = false;
      b.h = Math.atan2(dz, dx);
    } else if (b.goal) {
      const dx = b.goal.x - b.x, dz = b.goal.z - b.z, d = Math.hypot(dx, dz);
      if (d > 0.8) { mx = dx / d; mz = dz / d; }
      else { mx = mz = 0; if (b.goal.chest) { const c = this.chests.get(b.goal.chest); if (c && !c.open && !(c.land && this.t < c.land)) this.botLoot(b, this.openChest(c, b.id)); } else if (b.goal.item) { const it = this.items.get(b.goal.item); if (it) this.botLoot(b, [it]); } b.goal = null; }
    }
    if (b.detour > 0) { mx = Math.cos(b.detourA); mz = Math.sin(b.detourA); }
    const L = Math.hypot(mx, mz);
    if (L > 0.05) {
      const sp = (run ? 5.4 : 4.2) * dt;
      this.botMove(b, mx / L * sp, mz / L * sp);
      if (!e) b.h = Math.atan2(mz, mx);
      b.wk = run ? 2 : 1;
    } else b.wk = 0;
    b.y = w.height(b.x, b.z);
    // stuck? take a detour for a moment
    if ((b.stuck += dt) > 1.4) {
      if (L > 0.05 && Math.hypot(b.x - b.lastX, b.z - b.lastZ) < 0.6) {
        // walled in: smash through whatever is in the way (like anyone with a pickaxe would), else go round
        const ax = b.x + mx / L * 0.6, az = b.z + mz / L * 0.6;
        let wall = null, wd = 0.75;
        for (const s of w.segsNear(ax, az, 1)) if (s.piece === undefined && !s.frontier && s.kind !== 'water' && s.kind !== 'edge' && segDist(ax, az, s) < wd) { wd = segDist(ax, az, s); wall = s; }
        if (wall && Math.random() < 0.75) { this.hitObj(segObjKey(wall), 150, b.id); b.wk = 0; }
        else { b.detour = 0.9 + Math.random(); b.detourA = Math.random() * 6.283; }
      }
      b.stuck = 0; b.lastX = b.x; b.lastZ = b.z;
    }
    // ---- fight
    if (e && e.alive && b.inv && b.react <= 0) this.botShoot(b, e);
  }
  botThink(b, st) {
    const w = this.w;
    // a target: the nearest player it can see (or whoever just shot it)
    let best = null, bd = 55;
    for (const p of this.p.values()) {
      if (p === b || !p.alive || p.ph !== 'ground') continue;
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (d < bd && (p.id === b.hurtBy && d < 70 || !lineBlock(w, b.x, b.y + 1.5, b.z, p.x, p.y + 1.2, p.z))) { bd = d; best = p; }
    }
    if (best && best.id !== b.enemy) b.react = (best.bot ? 0.45 : 0.9) + Math.random() * 0.7;
    b.enemy = best ? best.id : null;
    if (!best && b.calm > 4 && b.calm < 5) b.hurtBy = null;
    // heal up when it's quiet
    if (!best && b.calm > 2.5 && !b.useT) {
      const want = b.heals.find(h => HEALS[h.h].hp ? b.hp < HEALS[h.h].cap - 10 : b.sh < HEALS[h.h].cap - 10);
      if (want) { b.using = want; b.useT = HEALS[want.h].use; return; }
    }
    // where to go
    const dSafe = Math.hypot(b.x - st.x, b.z - st.z), next = st.next, soon = st.until - this.t < 20 || st.shrinking;
    if (dSafe > st.r - 4 || (soon && Math.hypot(b.x - next.x, b.z - next.z) > next.r - 3)) {
      const tx = next.x + (b.x - next.x) * 0.3, tz = next.z + (b.z - next.z) * 0.3;
      if (!b.goal || !b.goal.safe) b.goal = { x: tx + (Math.random() - 0.5) * next.r * 0.4, z: tz + (Math.random() - 0.5) * next.r * 0.4, safe: true };
      return;
    }
    if (best) return;
    if (b.goal && !b.goal.safe) return;
    // loot: a better weapon on the floor, an unopened chest, else wander inside the next circle
    let g = null, gd = 45;
    for (const it of this.items.values()) {
      if (it.it.t !== 'w' && !(it.it.t === 'h' && b.heals.length < 3)) continue;
      if (it.it.t === 'w' && b.inv && W_PREF[it.it.w] + it.it.r * 0.5 <= W_PREF[b.inv.w] + b.inv.r * 0.5) continue;
      const d = Math.hypot(it.x - b.x, it.z - b.z); if (d < gd) { gd = d; g = { x: it.x, z: it.z, item: it.id }; }
    }
    for (const c of this.chests.values()) {
      if (c.open || c.kind === 'vend' || (c.land && this.t < c.land)) continue;
      const d = Math.hypot(c.x - b.x, c.z - b.z) * (b.inv ? 1.4 : 1); if (d < gd) { gd = d; g = { x: c.x, z: c.z, chest: c.k }; }
    }
    if (!g) { const a = Math.random() * 6.283, q = Math.random() * next.r * 0.8; g = { x: next.x + Math.cos(a) * q, z: next.z + Math.sin(a) * q }; }
    b.goal = g;
  }
  botLoot(b, list) {
    for (const o of list) {
      if (!this.items.has(o.id)) continue;
      const it = o.it; let take = false;
      if (it.t === 'w' && (!b.inv || W_PREF[it.w] + it.r * 0.5 > W_PREF[b.inv.w] + b.inv.r * 0.5)) {
        if (b.inv) this.addItem(b.inv, b.x, b.y, b.z);
        b.inv = it; b.mag = WEAPONS[it.w].mag; take = true;
      } else if (it.t === 'h' && b.heals.length < 3) { b.heals.push({ ...it }); take = true; }
      else if (it.t === 'm') { b.mats = Math.min(MAT_MAX, b.mats + it.n); take = true; }
      else if (it.t === 'a') take = true;
      if (take) { this.items.delete(o.id); this.send(null, { op: 'gone', id: o.id, by: b.id }); }
    }
  }
  botMove(b, dx, dz) {
    const w = this.w, R = 0.32, nx = b.x + dx, nz = b.z + dz;
    const free = (x, z) => {
      if (w.tileKind(x, z) !== 0 && w.tileKind(x, z) !== 4) return false;
      if (Math.abs(w.height(x, z) - b.y) > 1.1) return false;
      for (const s of w.segsNear(x, z, 1)) {
        if (s.frontier ? false : s.hi !== undefined ? (b.y + 1.6 < s.bot || b.y > s.hi - 0.1) : false) continue;
        if (segDist(x, z, s) < R) return false;
      }
      for (const t of w.trunksNear(x, z, 1)) if (Math.hypot(t.x - x, t.z - z) < t.r + R) return false;
      return true;
    };
    if (free(nx, nz)) { b.x = nx; b.z = nz; }
    else if (free(nx, b.z)) b.x = nx;
    else if (free(b.x, nz)) b.z = nz;
    const a = this.arena; if (Math.hypot(b.x - a.x, b.z - a.z) > a.r + 25) { b.x -= dx; b.z -= dz; }
  }
  botUnstick(b) {
    const w = this.w;
    if (w.tileKind(b.x, b.z) === 0) return;
    for (let r = 1; r < 12; r++) for (let k = 0; k < 8; k++) {
      const x = b.x + Math.cos(k * 0.785) * r * 0.75, z = b.z + Math.sin(k * 0.785) * r * 0.75;
      if (w.tileKind(x, z) === 0) { b.x = x; b.z = z; b.y = w.height(x, z); return; }
    }
  }
  botShoot(b, e) {
    const W = WEAPONS[b.inv.w];
    if (b.reloadT > 0) return;
    if (b.mag <= 0) { b.reloadT = W.reload; b.mag = W.mag; return; }
    if (b.fireT > 0) return;
    b.fireT = 1 / W.rate * (W.auto ? 1.6 : 1.15) * (e.bot ? 1 : 1.4); b.mag--;
    const d = Math.hypot(e.x - b.x, e.z - b.z), fromY = b.y + 1.5, toY = e.y + 1.1;
    const block = lineBlock(this.w, b.x, fromY, b.z, e.x, toY, e.z);
    const pieceHit = block && block.s && block.s.piece;
    let tx = e.x, ty = toY, tz = e.z, hit = false;
    if (block) { tx = block.x; ty = block.y; tz = block.z; }
    else {
      const acc = Math.max(0.08, Math.min(0.7, 0.75 - d / W.range * 0.5)) * (e.bot ? 1 : 0.45);   // (go easy on people: they can't see every bot coming)
      hit = Math.random() < acc;
      if (!hit) { tx += (Math.random() - 0.5) * 2.5; ty += (Math.random() - 0.3) * 1.5; tz += (Math.random() - 0.5) * 2.5; }
    }
    this.send(null, { op: 'fx', by: b.id, w: b.inv.w, a: [r2(b.x), r2(fromY), r2(b.z)], b: [r2(tx), r2(ty), r2(tz)] });
    if (W.splash) { if (block || hit) this.explode(tx, ty, tz, W.splash, W.dmg * RARITY[b.inv.r].m, b.id); return; }
    const per = W.dmg * RARITY[b.inv.r].m * Math.max(0.35, 1 - Math.max(0, d - W.range * 0.4) / W.range) * (W.pellets ? W.pellets * 0.6 : 1);
    if (pieceHit) this.hitPiece(block.s.piece, W.struct * (W.pellets ? 5 : 1), b.id);
    else if (hit) {
      const hd = Math.random() < 0.08;
      this.damage(e, per * (hd ? 1.6 : 1), b.id, b.inv.w, hd);
      // under fire and losing: wall off
    }
    if (b.hurtBy === e.id && b.mats >= BUILD_COST && b.buildT <= 0 && b.hp + b.sh < 110 && d > 5) this.botWall(b, e);
  }
  botWall(b, e) {
    b.buildT = 3 + Math.random() * 2;
    const G = BR.G, dx = e.x - b.x, dz = e.z - b.z, i = Math.floor(b.x / G), j = Math.floor(b.z / G);
    const q = Math.abs(dx) > Math.abs(dz) ? { k: 'wall', d: 1, i: dx > 0 ? i + 1 : i, j } : { k: 'wall', d: 0, i, j: dz > 0 ? j + 1 : j };
    if (this.build(b.id, { ...q, y: b.y, m: b.mats > 200 ? 'stone' : 'wood' })) b.mats -= BUILD_COST;
  }
}
const r2 = v => Math.round(v * 100) / 100;
