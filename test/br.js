// RuneRoyale checks (the shared match core on the real world):  bun runeskate/test/br.js
import { readFileSync } from 'fs';
import { World } from '../src/world.js';
import { BR, BRMatch, benchCost, stormPlan, stormAt, busPath, busAt, arenaOf, unsupported, segObjKey, treeKey, objKind } from '../src/br-core.js';
import { WORLD_SCALE } from '../src/mapdata.js';
import { Locker, COSMETICS, PASS_TIERS } from '../src/br-locker.js';

const S = WORLD_SCALE;
const w = new World(JSON.parse(readFileSync(new URL('../assets/world.json', import.meta.url))), { scale: S });
let fails = 0;
function check(name, ok, info) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; }
const segCount = () => w.segs.length;
const trunkCount = () => { let n = 0; for (const l of w.trunkGrid.values()) n += l.length; return n; };
const before = { segs: segCount(), trunks: trunkCount(), rails: w.rails.length, blocked: Buffer.from(w.blocked).toString('base64') };

// 1. the storm closes in, each circle inside the last, and the dragon flies inside the first one
{
  const arena = arenaOf(w), plan = stormPlan(5, arena);
  let inside = true, shrinks = true, prev = stormAt(plan, 0);
  for (let t = 1; t < 900; t += 1) {
    const s = stormAt(plan, t);
    if (s.r > prev.r + 1e-6) shrinks = false;
    if (Math.hypot(s.x - prev.x, s.z - prev.z) > prev.r - s.r + 0.01 + 1e-6 && s.r < prev.r) inside = false;
    prev = s;
  }
  check('storm never grows', shrinks);
  check('each circle stays inside the last', inside);
  check('storm ends small', prev.r < 12, 'r=' + prev.r.toFixed(1));
  const bus = busPath(5, arena), s0 = stormAt(plan, 0);
  let out = 0; for (let t = 0; t <= BR.BUS_T; t += 0.5) { const b = busAt(bus, t); if (Math.hypot(b.x - s0.x, b.z - s0.z) > s0.r) out++; }
  check('dragon path inside the first circle', out === 0, out + ' points outside');
}

// 2. building: pieces stack, and pull the bottom one out and the rest comes down
{
  const m = new BRMatch({ world: w, seed: 9, send: () => {} });
  const a = m.arena, i = Math.floor(a.x / BR.G), j = Math.floor(a.z / BR.G), y0 = w.height((i + 0.5) * BR.G, j * BR.G);
  const wall = m.build('t', { k: 'wall', i, j, y: y0, d: 0, m: 'wood' });
  const floor = m.build('t', { k: 'floor', i, j, y: wall.y + BR.H, d: 0, m: 'stone' });
  const wall2 = m.build('t', { k: 'wall', i, j, y: wall.y + BR.H, d: 0, m: 'metal' });
  check('three pieces built', wall && floor && wall2 && m.pieces.size === 3);
  check('the same slot cannot be built twice', m.build('t', { k: 'wall', i, j, y: y0, d: 0 }) === null);
  check('a build wall blocks', w.segs.some(s => s.piece === wall.id));
  const fx = (i + 0.5) * BR.G, fz = (j + 0.5) * BR.G;
  w.probeY = floor.y; const hOn = w.height(fx, fz); w.probeY = -Infinity;
  check('stand on a floor', Math.abs(hOn - floor.y) < 0.05, 'h=' + hOn.toFixed(2) + ' floor=' + floor.y);
  check('all held up', unsupported(w, m.pieces).length === 0);
  m.hitPiece(wall.id, 99999, 't');
  check('knock out the base and it all falls', m.pieces.size === 0, m.pieces.size + ' left');
  check('no build walls left behind', !w.segs.some(s => s.piece !== undefined) && w.decks.size === 0);
}

// 3. breaking the world: a castle wall and a tree go, then come back
{
  const m = new BRMatch({ world: w, seed: 3, send: () => {} });
  const sg = w.segs.find(s => s.kind === 'wall' && s.piece === undefined && !s.frontier);
  const k = segObjKey(sg);
  m.hitObj(k, 99999, 't'); m.hitObj(k, 99999, 't'); m.hitObj(k, 99999, 't');
  check('a castle wall breaks', m.broken.includes(k) && !w.segs.includes(sg), objKind(k));
  const tr = w.trunkGrid.values().next().value[0], tk = treeKey(tr);
  for (let n = 0; n < 10 && !m.broken.includes(tk); n++) m.hitObj(tk, 400, 't');
  check('a tree chops down', m.broken.includes(tk));
  m.build('t', { k: 'wall', i: Math.floor(m.arena.x / BR.G), j: Math.floor(m.arena.z / BR.G), y: 0, d: 1 });
  m.reset();
  check('world restored after a match', segCount() === before.segs && trunkCount() === before.trunks && w.rails.length === before.rails && Buffer.from(w.blocked).toString('base64') === before.blocked && w.decks.size === 0,
    `segs ${segCount()}/${before.segs} trunks ${trunkCount()}/${before.trunks}`);
}

// 4. a whole bot match plays out to one winner, and the world comes back whole
for (const seed of [3, 11]) {
  const sent = {}; let winner = null;
  const m = new BRMatch({ world: w, seed, send: (to, msg) => { sent[msg.op] = (sent[msg.op] || 0) + 1; if (msg.op === 'over') winner = msg; } });
  m.fillBots(); m.start();
  check(`seed ${seed}: 16 in the match`, m.p.size === BR.SIZE);
  check(`seed ${seed}: loot on the map`, m.chests.size > 20 && m.items.size > 20, `${m.chests.size} chests ${m.items.size} items`);
  while (m.state === 'live' && m.t < 900) m.tick(1 / 20);
  check(`seed ${seed}: match ends with a winner`, m.state === 'over' && winner && m.alive.length === 1, `t=${m.t.toFixed(0)} elims=${sent.elim || 0}`);
  check(`seed ${seed}: bots built and broke things`, (sent.built || 0) > 0 && (sent.broken || 0) + (sent.pgone || 0) > 0, `built ${sent.built || 0} broken ${sent.broken || 0}`);
  check(`seed ${seed}: storm hurt somebody`, (sent.hp || 0) > 0);
  m.reset();
  check(`seed ${seed}: world whole again`, segCount() === before.segs && trunkCount() === before.trunks && w.decks.size === 0);
}

// 5. a player's messages are kept honest
{
  const m = new BRMatch({ world: w, seed: 4, send: () => {} });
  m.join('h', 'Human'); m.fillBots(); m.start();
  const me = m.p.get('h'), bot = [...m.p.values()].find(p => p.bot);
  me.ph = bot.ph = 'ground';
  bot.hp = 1000; const hp0 = bot.hp + bot.sh;
  m.msg('h', { op: 'hit', v: bot.id, d: 1e9, w: 'ar' });
  check('a hit is capped', bot.alive && hp0 - (bot.hp + bot.sh) <= 230);
  m.msg('h', { op: 'build', p: { k: 'tower', i: 0, j: 0, y: 0 } });
  m.msg('h', { op: 'odmg', k: 'x'.repeat(200), d: 700 });
  check('junk builds and keys ignored', m.pieces.size === 0 && m.broken.length === 0);
  m.msg('h', { op: 'leave' });
  check('leaving eliminates you', !me.alive);
  m.reset();
}

// 6. the rest of the kit: build edits, vending machines, gadgets, mine carts, victory dances
{
  const sent = [];
  const m = new BRMatch({ world: w, seed: 8, send: (to, msg) => sent.push(msg) });
  m.join('h', 'Human'); m.fillBots(); m.start();
  const me = m.p.get('h'); me.ph = 'ground';
  const i = Math.floor(m.arena.x / BR.G), j = Math.floor(m.arena.z / BR.G), y0 = w.height((i + 0.5) * BR.G, j * BR.G);
  me.x = (i + 0.5) * BR.G; me.z = (j + 0.5) * BR.G; me.y = y0;
  const wall = m.build('h', { k: 'wall', i, j, y: y0, d: 0 }), segs = () => w.segs.filter(s => s.piece === wall.id).map(s => +(s.hi - s.bot).toFixed(2));
  const seen = [];
  for (let n = 0; n < 4; n++) { m.msg('h', { op: 'edit', id: wall.id }); seen.push(wall.e + ':' + segs().join('+')); }
  check('wall edits: door, window, half, back', seen.join(' ') === 'door: window:1.05+0.75 half:1.1 :2.7', seen.join(' '));
  const fl = m.build('h', { k: 'floor', i: i + 1, j, y: y0 + BR.H, d: 0 }); m.msg('h', { op: 'edit', id: fl.id });
  check('floor edit: a hole you can drop through', fl.e === 'hole' && !w.deckById.has(fl.id));
  const rp = m.build('h', { k: 'ramp', i: i + 2, j, y: y0, d: 1 }); m.msg('h', { op: 'edit', id: rp.id });
  check('ramp edit turns it round', rp.d === 3);
  const vends = [...m.chests.values()].filter(c => c.kind === 'vend');
  check('vending machines stocked (rare or better)', vends.length >= 4 && vends.every(v => v.it.r >= 2 && v.cost > 0), vends.length + ' machines');
  const v = vends[0]; me.x = v.x; me.z = v.z; const n0 = m.items.size;
  m.msg('h', { op: 'open', k: v.k }); check('a vending machine does not open like a chest', !v.open);
  m.msg('h', { op: 'buy', k: v.k }); check('buying drops the weapon and its ammo', v.open && m.items.size === n0 + 2);
  me.x = (i + 0.5) * BR.G; me.z = (j - 2) * BR.G; me.y = w.height(me.x, me.z);
  m.msg('h', { op: 'gadget', g: 'trap', x: me.x + 1.5, y: me.y, z: me.z });
  m.msg('h', { op: 'gadget', g: 'pad', x: me.x - 1.5, y: me.y, z: me.z });
  m.msg('h', { op: 'gadget', g: 'nuke', x: me.x, y: me.y, z: me.z });
  check('gadgets placed (and junk refused)', m.gadgets.size === 2);
  const [trap, pad] = [...m.gadgets.values()], bots = [...m.p.values()].filter(p => p.bot);
  const b1 = bots[0], b2 = bots[1];
  Object.assign(b1, { ph: 'ground', x: trap.x, y: trap.y, z: trap.z, hp: 100, sh: 0 }); Object.assign(b2, { ph: 'ground', x: pad.x, y: pad.y, z: pad.z, h: 0 });
  m.tick(0.05);
  check('a spike trap hurts an enemy', b1.hp === 25 && trap.uses === 2, 'hp ' + b1.hp);
  check('a launch pad throws a bot up', b2.ph === 'fall' && b2.launch > 0);
  let top = b2.y, n = 0; while (b2.ph === 'fall' && n++ < 400) { m.botStep(b2, 0.1, stormAt(m.plan, m.t)); top = Math.max(top, b2.y); }
  check('...and it comes down again', top > pad.y + 8 && b2.ph === 'ground', 'peak ' + (top - pad.y).toFixed(1) + ' after ' + (n / 10) + ' s');
  Object.assign(me, { x: trap.x, z: trap.z }); const hpMe = me.hp; for (let k = 0; k < 50; k++) m.tick(0.05);
  check('your own trap leaves you alone', me.hp === hpMe);
  const cart = [...m.carts.values()][0];
  check('mine carts on the map', m.carts.size >= 4, m.carts.size + ' carts');
  Object.assign(me, { x: cart.x + 1, z: cart.z });
  m.msg('h', { op: 'ride', id: cart.id }); check('get in a cart', cart.rider === 'h' && me.cart === cart.id);
  m.msg(b2.id, { op: 'ride', id: cart.id }); check('one driver at a time', cart.rider === 'h');
  m.msg('h', { op: 'drive', x: cart.x + 5, y: cart.y, z: cart.z, h: 1 }); m.msg('h', { op: 'drive', x: cart.x + 500, y: 0, z: 0, h: 0 });
  check('driving moves it (not teleports)', Math.abs(cart.h - 1) < 0.01);
  m.msg('h', { op: 'unride', x: cart.x, y: cart.y, z: cart.z, h: 2 }); check('get out', cart.rider === null && !me.cart);
  m.eliminate(bots[3], bots[4].id, 'ar');
  check('a bot dances after an elim', bots[4].emT > 0 && bots[4].em > 300);
  m.reset();
}

// 7. duos / squads: teams, no friendly fire, knocks, revives, reboot cards and vans, team wins
for (const [mode, n] of [['duos', 2], ['squads', 4]]) {
  let over = null;
  const m = new BRMatch({ world: w, seed: 12, team: n, send: (to, msg) => { if (msg.op === 'over') over = msg; } });
  m.join('h', 'Human'); m.fillBots(); m.start();
  const me = m.p.get('h'), mates = m.mates(me), foe = [...m.p.values()].find(p => p.team !== me.team);
  check(`${mode}: teams of ${n}`, mates.length === n - 1 && new Set([...m.p.values()].map(p => p.team)).size === 16 / n);
  for (const p of m.p.values()) p.ph = 'ground';
  const hp0 = mates[0].hp; m.damage(mates[0], 50, 'h', 'ar'); check(`${mode}: no friendly fire`, mates[0].hp === hp0);
  Object.assign(me, { x: m.arena.x, z: m.arena.z, y: w.height(m.arena.x, m.arena.z) }); Object.assign(mates[0], { x: me.x + 1, z: me.z, y: me.y });
  m.damage(mates[0], 250, foe.id, 'ar');
  check(`${mode}: knocked, not out`, mates[0].alive && mates[0].down);
  m.msg(mates[0].id, { op: 'build', p: { k: 'wall', i: 0, j: 0, y: 0 } }); check(`${mode}: knocked players can't build`, m.pieces.size === 0);
  m.msg('h', { op: 'revive', id: mates[0].id }); check(`${mode}: a teammate picks them up`, !mates[0].down && mates[0].hp === 30);
  m.damage(mates[0], 250, foe.id, 'ar'); m.damage(mates[0], 200, foe.id, 'ar');
  check(`${mode}: finished off`, !mates[0].alive);
  const card = [...m.items.values()].find(o => o.it.t === 'c' && o.it.id === mates[0].id);
  check(`${mode}: drops a reboot card`, !!card);
  Object.assign(foe, { x: card.x, z: card.z }); m.msg(foe.id, { op: 'pick', id: card.id }); check(`${mode}: enemies can't take it`, m.items.has(card.id));
  Object.assign(me, { x: card.x, z: card.z }); m.msg('h', { op: 'pick', id: card.id }); check(`${mode}: a teammate carries it`, me.cards.includes(mates[0].id));
  const van = [...m.chests.values()].find(c => c.kind === 'reboot'); Object.assign(me, { x: van.x, z: van.z });
  m.msg('h', { op: 'reboot', k: van.k, id: mates[0].id });
  check(`${mode}: the van brings them back`, mates[0].alive && mates[0].ph === 'fall' && mates[0].y > van.y + 30 && van.cool > m.t);
  m.msg('h', { op: 'reboot', k: van.k, id: mates[0].id }); check(`${mode}: no card, no second go`, me.cards.length === 0);
  // a whole team down = a whole team out
  if (n === 2) {
    Object.assign(mates[0], { ph: 'ground', x: me.x + 1, z: me.z, y: me.y, sh: 0 });
    m.damage(mates[0], 250, foe.id, 'ar'); me.sh = 0; m.damage(me, 250, foe.id, 'ar');
    check(`${mode}: last one standing knocked = team wiped`, !me.alive && !mates[0].alive);
  }
  while (m.state === 'live' && m.t < 900) m.tick(1 / 20);
  check(`${mode}: a team wins`, m.state === 'over' && over && over.team != null && m.alive.every(p => p.team === over.team), over && over.names.join(', '));
  m.reset();
}

// 8. fishing, the upgrade bench price list, rifts and ziplines on the map
{
  const m = new BRMatch({ world: w, seed: 2, send: () => {} });
  m.join('h', 'Human'); m.fillBots(); m.start();
  const me = m.p.get('h'), f = [...m.chests.values()].find(c => c.kind === 'fish'); me.ph = 'ground';
  check('fishing spots by the water', [...m.chests.values()].filter(c => c.kind === 'fish').length >= 5 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => { const [tx, tz] = w.tileOf(f.x, f.z); return w.blocked[(tz + b) * w.N + tx + a] === 2; }));
  Object.assign(me, { x: f.x, z: f.z }); const n0 = m.items.size;
  m.msg('h', { op: 'fish', k: f.k }); m.msg('h', { op: 'fish', k: f.k });
  check('a cast lands a catch (and casts take time)', f.uses === 2 && m.items.size > n0);
  check('upgrade benches', [...m.chests.values()].filter(c => c.kind === 'bench').length >= 3 && benchCost(0).n < benchCost(3).n);
  check('rifts and ziplines', m.rifts.length >= 2 && m.zips.length >= 2 && m.zips.every(z => Math.hypot(z.b.x - z.a.x, z.b.z - z.a.z) >= 35), `${m.rifts.length} rifts ${m.zips.length} ziplines`);
  check('no reboot vans in solo', ![...m.chests.values()].some(c => c.kind === 'reboot'));
  m.reset();
}

// 9. the locker: GP and pass XP from matches, pass tiers unlock cosmetics, the shop sells for GP only
{
  const L = new Locker();
  const line = L.award({ won: true, place: 1, kills: 5 });
  check('a win pays GP and pass tiers', L.s.gp > 300 && L.tier >= 2 && /PASS TIER/.test(line), line);
  check('pass tiers unlock cosmetics', L.s.owned.includes('trail_smoke') && L.s.owned.includes('pick_iron'));
  const shop = L.shop(20000); check('the shop has four items a day, the same all day', shop.length === 4 && JSON.stringify(shop) === JSON.stringify(L.shop(20000)) && JSON.stringify(shop) !== JSON.stringify(L.shop(20001)));
  L.s.gp = 0; check('no GP, no sale', !L.buy(shop[0]));
  L.s.gp = 5000; const ok = L.buy(shop[0]); check('buying with GP equips it', ok && L.s.eq[COSMETICS[shop[0]].k] === shop[0] && L.s.gp === 5000 - COSMETICS[shop[0]].shop);
  for (let i = 0; i < 40; i++) L.award({ won: false, place: 8, kills: 1 });
  check('the pass tops out at 20', L.tier === PASS_TIERS && L.s.owned.includes('pick_gilded'));
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
