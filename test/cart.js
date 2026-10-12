// CartScape headless: the baked track is a good road, whole races of CPU karts get round it, every item does its thing,
// the difficulties are in order, and the road can't be cut.   bun test/cart.js
import { readFileSync } from 'fs';
import { Track, TRACKS, angd } from '../src/cart/track.js';
import { Race, NAMES, DIFF, K } from '../src/cart/race.js';
import { addScore, topOf } from '../src/cart/scores.js';
let fails = 0; const check = (name, ok, info = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; };
const baked = JSON.parse(readFileSync(new URL(`../assets/${TRACKS.lumbridge.pack}.track.json`, import.meta.url), 'utf8'));
const T = new Track(baked);

// the road: no bumps, nothing steeper than a hill, every feature where it should be
{
  let worst = 0, bump = 0;
  for (let i = 0; i < T.N; i++) { if (T.flags[i] & 6) continue; const g = (T.y[(i + 1) % T.N] - T.y[i]) / T.ds, g0 = (T.y[i] - T.y[(i - 1 + T.N) % T.N]) / T.ds; worst = Math.max(worst, Math.abs(g)); if (!(T.flags[(i + 1) % T.N] & 6) && !(T.flags[(i - 1 + T.N) % T.N] & 6)) bump = Math.max(bump, Math.abs(g - g0)); }
  check('the road has no steep grades', worst < 0.12, (worst * 100).toFixed(1) + '%');
  check('the road has no bumps (grade changes smoothly)', bump < 0.02, bump.toFixed(4));
  const jump = T.feats.find(f => f.k === 'jump');
  check('the river jump has a gap over the water', jump && T.wrap(jump.land - jump.s) > 8, jump && `gap ${T.wrap(jump.land - jump.s).toFixed(1)}`);
  let tight = 0; for (let s = 0; s < T.L; s += 2) tight = Math.max(tight, Math.abs(T.curve(s, 6)) / 12);
  check('no corner tighter than a kart can take', tight < 0.11, `max ${tight.toFixed(3)} rad/unit (radius ${(1 / tight).toFixed(1)})`);
  let worstLoc = 0; for (let s = 0; s < T.L; s += 3.7) for (const d of [-5, 0, 5]) { const p = T.pos(s, d), l = T.locate(p.x, p.z, s); worstLoc = Math.max(worstLoc, Math.abs(T.wrap(l.s - s + T.L / 2) - T.L / 2) + Math.abs(l.d - d)); }
  check('track space round-trips', worstLoc < 0.5, worstLoc.toFixed(3));
}

// races: eight CPU karts, three laps; everyone gets round, nobody's stuck, the jump gets made
for (const cc of ['mithril', 'rune', 'dragon']) for (const seed of [1, 7]) {
  const karts = NAMES.slice(0, 8).map((n, i) => ({ id: 'k' + i, name: n }));
  const r = new Race(baked, { karts, cc, seed });
  const ev = {}, stuck = new Map(); let t = 0, worstStall = 0;
  while (t < 260 && !r.karts.every(k => k.finished)) {
    r.step(1 / 30); t += 1 / 30;
    for (const e of r.events) ev[e.t] = (ev[e.t] || 0) + 1; r.events.length = 0;
    if (Math.round(t * 30) % 30 === 0) for (const k of r.karts) { if (k.finished) continue; const p = stuck.get(k.id); if (p) worstStall = Math.max(worstStall, p.p === Math.round(k.prog) ? (p.n += 1) : (p.n = 0)); stuck.set(k.id, { p: Math.round(k.prog), n: p && p.p === Math.round(k.prog) ? p.n : 0 }); }
  }
  const fin = r.karts.filter(k => k.finished), win = Math.min(...fin.map(k => k.finished));
  check(`${cc} seed ${seed}: all 8 finish`, fin.length === 8, `winner ${win.toFixed(1)}s (lap ~${(win / 3).toFixed(1)}s), last ${Math.max(...fin.map(k => k.finished)).toFixed(1)}s`);
  check(`${cc} seed ${seed}: nobody stuck`, worstStall < 4, `longest stall ${worstStall}s`);
  check(`${cc} seed ${seed}: items, drifts and jumps happen`, (ev.use || 0) > 20 && (ev.turbo || 0) > 10 && (ev.land || 0) > 20, JSON.stringify(ev));
  check(`${cc} seed ${seed}: lap times recorded, adding up to the race time`, r.karts.every(k => !k.finished || k.splits?.length === 3 && Math.abs(k.splits.reduce((a, b) => a + b) - k.finished) < 1e-6), '');
  check(`${cc} seed ${seed}: the river mostly gets jumped`, (ev.splash || 0) <= 4, `splashes ${ev.splash || 0}`);
}

// ---- the items, one by one, on a straight with nothing else about (karts flagged human sit still unless driven)
let S0 = 0;                                                       // a stretch with no beasts, blades or boulders on it
for (let s = 0; s < T.L && !S0; s += 5) {                     // (and not over the line, which would shuffle the places)
  const r0 = new Race(baked, { karts: [] }); let ok = T.wrap(s - T.finish) + 90 < T.L;
  for (let u = -5; u < 85 && ok; u += 1) if (T.flag(s + u) & 6) ok = false;
  if (ok && r0.mobs.every(o => Math.abs(T.wrap(o.s0 - s + T.L / 2) - T.L / 2) > 90)) S0 = s;
}
check('found a quiet stretch for the item tests', S0 > 0, 's ' + S0);
function lab(n) {
  const r = new Race(baked, { karts: Array.from({ length: n }, (_, i) => ({ id: 't' + i, name: 'T' + i, human: true })), seed: 3 });
  for (let i = 0; i < 40; i++) r.step(0.1); r.events.length = 0; r.boxes.length = 0; return r;   // (step() takes 0.1 s at most a call)
}
const put = (k, s, d = 0, v = 0) => { const p = T.pos(s, d); Object.assign(k, { x: p.x, z: p.z, y: T.h(s), s, d, a: Math.atan2(p.tz, p.tx), vx: p.tx * v, vz: p.tz * v, vy: 0, air: false, spinT: 0, invT: 0, boostT: 0, cp: T.wrap(s - T.finish) }); };
const run = (r, sec, inp = new Map()) => { const ev = []; for (let i = 0; i < sec * 60; i++) { r.step(1 / 60, inp); ev.push(...r.events); r.events.length = 0; } return ev; };
const hitOn = (ev, id, why) => ev.some(e => e.t === 'hit' && e.id === id && (!why || e.why === why));
const give = (k, it, n = 1) => { k.item = it; k.uses = n; };
{ const r = lab(1), [a] = r.karts; put(a, S0); give(a, 'energy'); r.use(a); check('ENERGY POTION boosts', a.boostT > 1 && !a.item); }
{ const r = lab(1), [a] = r.karts; put(a, S0); give(a, 'energy3', 3); r.use(a); r.use(a); const mid = a.item; r.use(a); check('SUPER ENERGY x3 boosts three times', mid === 'energy3' && !a.item && a.boostT > 1); }
{ const r = lab(2), [a, b] = r.karts; put(a, S0 + 12); put(b, S0, 0, 10); give(a, 'banana'); r.use(a); const ev = run(r, 2, new Map([['t1', { gas: 1 }]])); check('BANANA dropped behind spins whoever drives into it', hitOn(ev, 't1', 'banana') && !r.hazards.length); }
{ const r = lab(2), [a, b] = r.karts; put(a, S0); put(b, S0 + 25); give(a, 'wind'); r.use(a); const ev = run(r, 1.5); check('WIND STRIKE flies straight and hits the kart ahead', hitOn(ev, 't1', 'wind')); }
{ const r = lab(2), [a, b] = r.karts; put(a, S0); put(b, S0 + 30, 4); run(r, 0.1); give(a, 'fire'); r.use(a); const ev = run(r, 2); check('FIRE BOLT homes in on the kart ahead, off to the side', hitOn(ev, 't1', 'fire')); }
{ const r = lab(3), [a, b, c] = r.karts; put(a, S0); put(b, S0 + 22, 1.5); put(c, S0 + 60); give(a, 'chin'); r.use(a); const ev = run(r, 3); check('CHINCHOMPA is thrown, blows up, catches whoever is close, not the far one', hitOn(ev, 't1', 'chin') && !hitOn(ev, 't2') && ev.some(e => e.t === 'boom' && e.chin)); }
{ const r = lab(2), [a, b] = r.karts; put(a, S0); put(b, S0 + 25); give(b, 'protect'); r.use(b); give(a, 'wind'); r.use(a); const ev = run(r, 1.5); check('PROTECT FROM MISSILES blocks the wind strike', ev.some(e => e.t === 'block' && e.id === 't1') && !hitOn(ev, 't1') && b.protT <= 0); }
{ const r = lab(2), [a, b] = r.karts; put(a, S0); put(b, S0 + 25); give(b, 'protect'); r.use(b); const sh = run(r, 0.1); give(a, 'barrage'); r.use(a); check('...but not an ice barrage', b.frozenT > 0); }
{ const r = lab(4), [a, b, c, d] = r.karts; put(a, S0 + 10); put(b, S0 + 30); put(c, S0 + 50); put(d, S0); run(r, 0.1); give(a, 'smoke'); r.use(a); check('SMOKE BARRAGE blinds everyone ahead, not behind', b.smokeT > 0 && c.smokeT > 0 && !(d.smokeT > 0) && !(a.smokeT > 0), r.karts.map(k => k.id + ' ' + k.place + ' ' + k.smokeT).join(', ')); }
{ const r = lab(2), [a, b] = r.karts; put(a, S0, 0, 20); put(b, S0 + 4); give(a, 'overload'); r.use(a); const ev = run(r, 1, new Map([['t0', { gas: 1 }]])); check('OVERLOAD: rams others out of the way', a.starT > 0 && hitOn(ev, 't1', 'overload') && !hitOn(ev, 't0')); }
{ const r = lab(3), [a, b, c] = r.karts; put(a, S0); put(b, S0 + 20); put(c, S0 + 40); give(a, 'barrage'); r.use(a); check('ICE BARRAGE freezes and shrinks everyone else', b.frozenT > 0 && c.smallT > 0 && !(a.frozenT > 0)); }
{ const r = lab(3), [a, b, c] = r.karts; put(a, S0); put(b, S0 + 30); put(c, S0 + 70); run(r, 0.1); give(a, 'dragon'); r.use(a); const ev = run(r, 4); check('DRAGONFIRE flies to the leader and torches them', hitOn(ev, 't2', 'dragon') && !hitOn(ev, 't0'), JSON.stringify(ev.filter(e => e.t === 'hit'))); }

// ---- the difficulties: the CPU field gets quicker easy -> normal -> hard (no human: no rubber band)
{
  const avg = {};
  for (const diff of Object.keys(DIFF)) {
    let sum = 0, n = 0;
    for (const seed of [2, 5]) {
      const r = new Race(baked, { karts: NAMES.slice(0, 8).map((n, i) => ({ id: 'k' + i, name: n })), cc: 'rune', seed, diff });
      for (let t = 0; t < 260 && !r.karts.every(k => k.finished); t += 1 / 30) { r.step(1 / 30); r.events.length = 0; }
      for (const k of r.karts) if (k.finished) { sum += k.finished; n++; }
    }
    avg[diff] = sum / n;
  }
  check('difficulties: easy CPUs slower than normal, normal slower than hard', avg.easy > avg.normal + 2 && avg.normal > avg.hard + 2, Object.entries(avg).map(([k, v]) => k + ' ' + v.toFixed(1) + 's').join(', '));
}

// ---- no cutting: a driver aiming straight at the road 30 units on (every corner cut as tight as it goes) gets nothing
// for it; the walls hold everywhere; backwards over the line and back again, or jumping round the track, earns no lap
{
  const karts = NAMES.slice(0, 8).map((n, i) => ({ id: 'k' + i, name: n, human: i === 0 }));
  const r = new Race(baked, { karts, cc: 'rune', seed: 4 }), me = r.karts[0], lim = T.hw + K.wall + 1e-6;
  let worstD = 0, laps = 0;
  for (let t = 0; t < 300 && !r.karts.every(k => k.finished); t += 1 / 30) {
    const tp = T.pos(me.s + 30, 0), inp = { gas: 1, steer: Math.max(-1, Math.min(1, angd(me.a, Math.atan2(tp.z - me.z, tp.x - me.x)) * 2.6)) };
    r.step(1 / 30, new Map([['k0', inp]])); worstD = Math.max(worstD, Math.abs(me.d));
    for (const e of r.events) if (e.t === 'lap' && e.id === 'k0') laps++; r.events.length = 0;
  }
  const cpu = r.karts.filter(k => !k.human && k.finished).map(k => k.finished).sort((a, b) => a - b), med = cpu[cpu.length >> 1];
  check('corner-cutter stays inside the walls', worstD <= lim, `max |d| ${worstD.toFixed(2)} (wall ${lim.toFixed(2)})`);
  check('corner-cutter gets no edge on the CPU (laps counted right)', me.finished && laps === 2 && me.finished > med * 0.95, `cutter ${me.finished?.toFixed(1)}s, CPU median ${med?.toFixed(1)}s, laps ${laps}`);
}
{
  const r = lab(1), [a] = r.karts; put(a, T.finish + 6); a.lap = 1; let maxLap = 1;
  for (let i = 0; i < 4 * 60; i++) { r.step(1 / 60, new Map([['t0', { brake: 1 }]])); maxLap = Math.max(maxLap, a.lap); }
  const back = a.lap;
  for (let i = 0; i < 4 * 60; i++) { r.step(1 / 60, new Map([['t0', { gas: 1 }]])); maxLap = Math.max(maxLap, a.lap); }
  check('reversing over the line and back earns nothing', back === 0 && maxLap === 1 && a.lap === 1, `after reversing lap ${back}, then ${a.lap}`);
  put(a, T.finish + 40); a.lap = 1; a.cp = 40; put(a, T.finish - 20, 0, 20); a.cp = 40; run(r, 2, new Map([['t0', { gas: 1 }]]));
  check('jumping round the track to the line earns no lap', a.lap === 1);
}
{
  let worst = 0, jump = 0;
  for (let s = 0; s < T.L; s += 23) for (const side of [-1, 1]) {
    const r = lab(1), [a] = r.karts; put(a, s); if (T.flag(s) & 6 || T.flag(s + 10) & 6) continue;
    a.a += side * Math.PI / 2 * 0.95; a.vx = Math.cos(a.a) * 24; a.vz = Math.sin(a.a) * 24;
    for (let i = 0; i < 2 * 60; i++) { r.step(1 / 60, new Map([['t0', { gas: 1 }]])); worst = Math.max(worst, Math.abs(a.d)); }
    jump = Math.max(jump, Math.abs(T.wrap(a.s - s + T.L / 2) - T.L / 2));
  }
  check('driving straight off the road anywhere: the wall holds, no hopping to another bit of track', worst <= T.hw + K.wall + 1e-6 && jump < 30, `max |d| ${worst.toFixed(2)}, max drift along ${jump.toFixed(1)}`);
}

// ---- highscores: the rules (src/cart/scores.js), then serve.ts's /api/cart end to end on a spare port
{
  const b = {}, laps = [31.2, 30.1, 30.4], t = laps.reduce((a, c) => a + c);
  check('scores: a believable race goes on the board', addScore(b, { name: 'Zezima', cc: 'rune', diff: 'hard', t, laps }).rank === 1);
  check('scores: a slower time under the same name keeps the best', addScore(b, { name: 'zezima', cc: 'rune', t: t + 5, laps: [laps[0] + 5, laps[1], laps[2]] }).best === Math.round(t * 100) / 100 && b.rune.length === 1);
  check('scores: impossible laps are refused', !addScore(b, { name: 'Cheat', cc: 'rune', t: 30, laps: [10, 10, 10] }).ok && !addScore(b, { name: 'Cheat', cc: 'rune', t: 50, laps }).ok && !addScore(b, { name: 'X', cc: 'gold', t, laps }).ok);
  addScore(b, { name: 'Bob', cc: 'rune', t: t - 2, laps: [laps[0] - 2, laps[1], laps[2]] });
  check('scores: sorted fastest first', b.rune[0].name === 'Bob' && topOf(b).rune.length === 2 && topOf(b).dragon.length === 0);
}
{
  const { mkdtempSync, rmSync } = await import('fs'), { tmpdir } = await import('os'), { join } = await import('path');
  const dir = mkdtempSync(join(tmpdir(), 'rs-cart-')), port = 20000 + Math.floor(Math.random() * 2000);
  const srv = Bun.spawn(['bun', 'serve.ts', String(port)], { cwd: join(import.meta.dir, '..'), env: { ...process.env, RUNESKATE_DATA: dir }, stdout: 'ignore', stderr: 'ignore' });
  try {
    for (let i = 0; i < 150; i++) { try { await fetch(`http://localhost:${port}/api/cart`); break; } catch { await Bun.sleep(100); } }
    const post = body => fetch(`http://localhost:${port}/api/cart`, { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());
    const r1 = await post({ name: 'NetRacer', cc: 'dragon', diff: 'normal', t: 75.5, laps: [26, 24.5, 25] });
    const r2 = await post({ name: 'Spam', cc: 'dragon', t: 80, laps: [27, 27, 26] });
    await Bun.sleep(4100); const r3 = await post({ name: 'Cheat', cc: 'dragon', t: 15, laps: [5, 5, 5] });
    const top = await fetch(`http://localhost:${port}/api/cart`).then(r => r.json());
    check('server: a race posted shows on the board', r1.ok && r1.rank === 1 && top.dragon[0]?.name === 'NetRacer', JSON.stringify(top.dragon));
    check('server: posting again straight away is slowed down', r2.ok === false && r2.why === 'slow down');
    check('server: an impossible time is refused', r3.ok === false && top.dragon.length === 1);
    const saved = JSON.parse(readFileSync(join(dir, 'cart.json'), 'utf8'));
    check('server: the board is saved to data/cart.json', saved.dragon?.[0]?.t === 75.5);
  } finally { srv.kill(); rmSync(dir, { recursive: true, force: true }); }
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0);
