// RuneRoyale checks (the shared match core on the real world):  bun runeskate/test/br.js
import { readFileSync } from 'fs';
import { World } from '../src/world.js';
import { BR, BRMatch, stormPlan, stormAt, busPath, busAt, arenaOf, unsupported, segObjKey, treeKey, objKind } from '../src/br-core.js';
import { WORLD_SCALE } from '../src/mapdata.js';

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

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
