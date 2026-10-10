// Server rules, end to end: starts serve.ts on a spare port with an empty data dir, then plays it with
// WebSocket clients. Game of S.K.A.T.E. turns and letters, Create-a-Park limits, own-the-spot claims.
//   bun test/net.js
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dir = mkdtempSync(join(tmpdir(), 'rs-net-')), port = 18000 + Math.floor(Math.random() * 2000);
const srv = Bun.spawn(['bun', 'serve.ts', String(port)], { cwd: join(import.meta.dir, '..'), env: { ...process.env, RUNESKATE_DATA: dir }, stdout: 'ignore', stderr: 'inherit' });
let fails = 0;
const check = (name, ok, info) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 100; i++) { try { await fetch(`http://localhost:${port}/api/players`); break; } catch { await sleep(100); } }

async function client(name) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`), got = [];
  await new Promise(ok => { ws.onopen = ok; });
  ws.onmessage = e => got.push(JSON.parse(e.data));
  ws.send(JSON.stringify({ t: 'hello', name, password: 'secret1' }));
  const c = { ws, got, send: m => ws.send(JSON.stringify(m)),
    /** wait for the next message matching f (after the ones already seen) */
    async next(f, ms = 3000) { const from = c.seen || 0; for (let t = 0; t < ms; t += 20) { const i = got.findIndex((m, j) => j >= from && f(m)); if (i >= 0) { c.seen = i + 1; return got[i]; } await sleep(20); } return null; } };
  c.me = await c.next(m => m.t === 'welcome');
  return c;
}
try {
  const A = await client('NetTestA'), B = await client('NetTestB');
  check('both log in', !!A.me && !!B.me);
  // ---- Game of S.K.A.T.E.
  A.send({ t: 'skate', op: 'challenge', name: 'nettestb' });
  check('challenge reaches the other skater', !!(await B.next(m => m.t === 'skate' && m.op === 'invite' && m.from === 'NetTestA')));
  B.send({ t: 'skate', op: 'accept' });
  let g = (await A.next(m => m.t === 'skate' && m.op === 'turn'))?.g;
  check('game starts, challenger sets', g && g.setter === A.me.id && g.phase === 'set');
  B.send({ t: 'skate', op: 'land', trick: 'Kickflip' });                 // not B's turn: ignored
  A.send({ t: 'skate', op: 'land', trick: 'Kickflip' });
  g = (await B.next(m => m.t === 'skate' && m.op === 'turn' && m.g.phase === 'match'))?.g;
  check('a landed set has to be matched', g && g.trick === 'Kickflip' && g.setter === A.me.id);
  B.send({ t: 'skate', op: 'land', trick: 'Heelflip' });                 // wrong trick = a letter
  g = (await A.next(m => m.t === 'skate' && m.op === 'turn' && m.g.phase === 'set'))?.g;
  check('missing the match gives a letter, setter keeps the set', g && g.letters[1] === 1 && g.setter === A.me.id, JSON.stringify(g?.letters));
  A.send({ t: 'skate', op: 'miss' });
  g = (await A.next(m => m.t === 'skate' && m.op === 'turn'))?.g;
  check('missing the set passes it over, no letter', g && g.setter === B.me.id && g.letters[0] === 0);
  B.send({ t: 'skate', op: 'land', trick: 'FS 180 Ollie' });
  await A.next(m => m.t === 'skate' && m.g?.phase === 'match');
  A.send({ t: 'skate', op: 'land', trick: 'FS 180 Ollie' });
  g = (await A.next(m => m.t === 'skate' && m.op === 'turn' && m.g.phase === 'set'))?.g;
  check('matching it: no letter, setter sets again', g && g.letters[0] === 0 && g.setter === B.me.id);
  // B sets, A misses four more times... play it out to S.K.A.T.E.
  for (let i = 0; i < 5; i++) {
    B.send({ t: 'skate', op: 'land', trick: 'Hardflip' });
    await A.next(m => m.t === 'skate' && m.g?.phase === 'match');
    A.send({ t: 'skate', op: 'miss' });
    if (i < 4) await A.next(m => m.t === 'skate' && m.g?.phase === 'set');
  }
  const end = await B.next(m => m.t === 'skate' && m.op === 'end');
  check('five letters spells S.K.A.T.E. and ends it', end && end.winner === 'NetTestB' && end.xp > 0, end?.why);
  // ---- Create-a-Park
  A.send({ t: 'park', op: 'add', o: { kind: 'rail', x: 3240, z: 3230, dir: 0, len: 4 } });
  const add = await B.next(m => m.t === 'park' && m.op === 'add');
  check('a placed rail reaches everyone', add && add.o.by === 'NetTestA' && add.o.kind === 'rail');
  await sleep(750);
  A.send({ t: 'park', op: 'add', o: { kind: 'ledge', x: 3241, z: 3230, dir: 1, len: 3 } });
  check('no building on top of another piece', !!(await A.next(m => m.t === 'park' && m.op === 'err' && /already built/.test(m.why))));
  await sleep(750);
  A.send({ t: 'park', op: 'add', o: { kind: 'kicker', x: 3226, z: 3222, dir: 0, len: 2 } });
  check('no building on a portal', !!(await A.next(m => m.t === 'park' && m.op === 'err')));
  await sleep(750);
  A.send({ t: 'park', op: 'add', o: { kind: 'rail', x: 3260, z: 3230, dir: 0, len: 40 } });
  check('no 40-tile rails', !!(await A.next(m => m.t === 'park' && m.op === 'err')));
  B.send({ t: 'park', op: 'del', id: add.o.id });
  check("can't remove someone else's piece", !!(await B.next(m => m.t === 'park' && m.op === 'err')));
  A.send({ t: 'park', op: 'del', id: add.o.id });
  check('the builder can remove it', !!(await B.next(m => m.t === 'park' && m.op === 'del' && m.id === add.o.id)));
  // ---- own-the-spot
  A.send({ t: 'spot', id: 'bridge', score: 5000 });
  check('a spot needs a combo that was really banked', !(await B.next(m => m.t === 'spot', 600)));
  A.send({ t: 'xp', add: 4000 }); A.send({ t: 'spot', id: 'bridge', score: 5000 });
  check('...and no more than was banked', !(await B.next(m => m.t === 'spot', 600)));
  A.send({ t: 'xp', add: 5000 }); A.send({ t: 'spot', id: 'bridge', score: 5000 });
  check('a banked combo owns the spot', (await B.next(m => m.t === 'spot'))?.name === 'NetTestA');
  await A.next(m => m.t === 'spot');                                    // (A hears its own claim too)
  B.send({ t: 'xp', add: 3000 }); B.send({ t: 'spot', id: 'bridge', score: 3000 });
  check('a smaller combo does not take it', !(await A.next(m => m.t === 'spot', 600)));
  B.send({ t: 'xp', add: 6000 }); B.send({ t: 'spot', id: 'bridge', score: 6000 });
  const took = await A.next(m => m.t === 'spot');
  check('a bigger one takes it', took?.name === 'NetTestB' && took.prev === 'NetTestA');
  A.ws.close(); B.ws.close();
} finally {
  srv.kill(); await srv.exited; rmSync(dir, { recursive: true, force: true });
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
