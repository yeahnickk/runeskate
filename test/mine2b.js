// MineScape 2b2t online: serve.ts on a spare port, two players join; edits, chests, chat, hits, loot and TNT go across,
// junk is dropped, and the world is still there after a restart.   bun test/mine2b.js
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let fails = 0;
const check = (n, ok, more = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + n + (more ? '  ' + more : '')); if (!ok) fails++; };
const dir = mkdtempSync(join(tmpdir(), 'rs-2b2t-')), port = 24000 + Math.floor(Math.random() * 2000);
const boot = async () => {
  const srv = Bun.spawn(['bun', 'serve.ts', String(port)], { cwd: join(import.meta.dir, '..'), env: { ...process.env, RUNESKATE_DATA: dir }, stdout: 'ignore', stderr: 'ignore' });
  for (let i = 0; i < 150; i++) { try { const j = await (await fetch(`http://localhost:${port}/api/2b2t`)).json(); if (!j.off) break; } catch {} await Bun.sleep(100); }
  return srv;
};
const join2b = (name) => new Promise((res, rej) => {
  const ws = new WebSocket(`ws://localhost:${port}/mine-ws`), P = { ws, got: [], world: null };
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hi', name }));
  ws.onerror = rej;
  ws.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) { P.world = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(e.data)))); res(P); return; }
    const o = JSON.parse(e.data); if (o.t === 'hi') P.hi = o; else P.got.push(o);
  };
});
const send = (P, o) => P.ws.send(JSON.stringify(o));
const wait = () => Bun.sleep(250);
const last = (P, t) => P.got.filter(o => o.t === t).pop();

let srv = await boot();
try {
  const info = await (await fetch(`http://localhost:${port}/api/2b2t`)).json();
  check('the server says how many are on', info.n === 0 && info.max === 50, JSON.stringify(info));
  const A = await join2b('Alice'), B = await join2b('Alice');
  check('a second Alice gets a name of her own', A.hi.name === 'Alice' && B.hi.name === 'Alice2', B.hi.name);
  check('and is told who is already on', B.hi.ps.some(p => p.name === 'Alice'));
  await wait();
  check('everyone hears who joined', A.got.some(o => o.t === 'c' && /Alice2 joined/.test(o.m)));
  // edits: A breaks a block and places TNT; B gets them, junk never goes through
  send(A, { t: 'ed', e: [1170, 40, -403, 0, 1171, 41, -403, 60, 1, 999, 1, 1, 2, 2, 2, 250] });
  await wait();
  const ed = last(B, 'ed');
  check('edits go to the others', ed && ed.e.join() === '1170,40,-403,0,1171,41,-403,60', ed && ed.e.join());
  check('and not back to who made them', !last(A, 'ed'));
  // positions: ten a second, everyone's in one message
  send(A, { t: 'p', s: [1170.5, 41, -402.5, 0.5, 0, 1, 276, 0, 0, 0, 0] }); send(B, { t: 'p', s: [1172.5, 41, -402.5, 0, 0, 1, 0, 0, 0, 0, 0] });
  await wait();
  const ps = last(B, 'ps');
  check('states come round', ps && ps.p.length === 24 && ps.p.includes(276));
  // chat (filtered, rate-limited)
  send(A, { t: 'c', m: 'hello §cspawn' }); send(A, { t: 'c', m: 'spam' });
  await wait();
  const ch = B.got.filter(o => o.t === 'c' && o.m.startsWith('<Alice>'));
  check('chat goes to everyone, colour codes stripped, one a beat', ch.length === 1 && ch[0].m === '<Alice> hello spawn', JSON.stringify(ch));
  // PvP: A hits B, B is told by whom; out of reach is refused
  send(A, { t: 'hit', id: B.hi.id, d: 7, kb: 1 });
  await wait();
  const h = last(B, 'hurt');
  check('a hit reaches who was hit, with who did it', h && h.d === 7 && h.by === 'Alice' && h.bid === A.hi.id && h.x === 1170.5);
  send(A, { t: 'p', s: [2000, 41, -402.5, 0, 0, 1, 0, 0, 0, 0, 0] }); await wait(); B.got.length = 0;
  send(A, { t: 'hit', id: B.hi.id, d: 7 }); await wait();
  check('a hit from across the map is not', !last(B, 'hurt'));
  // loot: B dies to A, A gets B's things (junk dropped)
  send(B, { t: 'loot', to: A.hi.id, s: [{ id: 276, n: 1, d: 3 }, { id: 9999, n: 1 }, { id: 4, n: 64 }], x: 1172, y: 42, z: -402 });
  await wait();
  const lt = last(A, 'loot');
  check('the killer gets the loot', lt && lt.s.length === 2 && lt.s[0].id === 276);
  // chests
  const slots = Array(27).fill(null); slots[0] = { id: 264, n: 3, d: 0 };
  send(A, { t: 'chest', k: '1170,41,-404', s: slots }); await wait();
  check('chests are shared', last(B, 'chest') && last(B, 'chest').s[0].id === 264);
  // TNT
  send(A, { t: 'fx', k: 'prime', x: 1171.5, y: 41, z: -402.5, f: 80 }); send(A, { t: 'fx', k: 'nuke', x: 0, y: 0, z: 0 }); await wait();
  check('a lit TNT shows up for the others', B.got.filter(o => o.t === 'fx').length === 1 && last(B, 'fx').k === 'prime');
  // a flood is cut off
  const big = []; for (let i = 0; i < 4096; i++) big.push(1000 + (i & 63), 50, -500 - (i >> 6), 1);
  for (let i = 0; i < 20; i++) send(A, { t: 'ed', e: big });
  await wait();
  check('a flood of edits is cut off', B.got.filter(o => o.t === 'ed').length < 20);
  B.ws.close(); await wait();
  check('who left is said', A.got.some(o => o.t === 'bye' && o.id === B.hi.id) && A.got.some(o => o.t === 'c' && /Alice2 left/.test(o.m)));
  A.ws.close();
} finally { srv.kill('SIGTERM'); await srv.exited; }

// the world survives a restart
srv = await boot();
try {
  const C = await join2b('Carol');
  const e = C.world.edits, ck = (1171 >> 4) + ',' + (-403 >> 4), ci = (((-403 & 15) << 4) | (1171 & 15)) * 128 + 41;
  const a = e[ck] || [], k = a.findIndex((v, i) => i % 2 === 0 && v === ci);
  check('the world is still there after a restart', k >= 0 && a[k + 1] === 60);
  check('and the chests', C.world.chests['1170,41,-404'] && C.world.chests['1170,41,-404'][0].id === 264);
  C.ws.close();
} finally { srv.kill('SIGTERM'); await srv.exited; rmSync(dir, { recursive: true, force: true }); }
console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
