// Rune League headless: RL's numbers (throttle, boost, jumps, flips, walls, the ball), the rules (goals, kickoff,
// pads, demos, the clock and overtime), the state round-trips for the wire, the bots (in order, no NaN, nobody in
// the walls, aerials connect), then the online match end to end on a spare port.   bun test/league.js
import { Match, C, basis, NO_INPUT, qheading, packIn, unpackIn } from '../src/league/match.js';
import { botInput } from '../src/league/bots.js';
import { D, PADS, L } from '../src/league/arena.js';
let fails = 0; const check = (name, ok, info = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; };
const I = o => ({ ...NO_INPUT, ...o });
const solo = () => { const m = new Match({ players: [{ id: 'a', team: 0 }] }); m.state = 'play'; m.ball.p = [0, -9000, 0]; m.ball.step = () => 0; return m; };
const run = (m, secs, inp, every) => { const c = m.cars[0]; for (let i = 0; i < secs * 120; i++) { c.in = typeof inp === 'function' ? inp(i / 120, c) : inp; m.tickOnce(); every?.(i / 120, c); } return c; };

// ---- the car: RL's numbers
{
  let m = solo(), c = m.cars[0]; c.place([0, 17, -4000], 0); run(m, 4, I({ throttle: 1 }));
  check('throttle tops out at 1410', Math.abs(c.speed - 1410) < 15, c.speed.toFixed(0));
  m = solo(); c = m.cars[0]; c.place([0, 17, -4500], 0); c.boost = 100; let ts = 0;
  run(m, 3, I({ throttle: 1, boost: true }), (t, c) => { if (!ts && c.speed >= 2200) ts = t; });
  check('boost: supersonic from rest in ~1.6 s, top speed 2300', ts > 1.3 && ts < 1.9 && c.speed <= 2300.5, `${ts.toFixed(2)} s, ${c.speed.toFixed(0)}`);
  m = solo(); c = m.cars[0]; let top = 0; run(m, 1.5, t => I({ jump: t < 0.25 }), (t, c) => top = Math.max(top, c.p[1]));
  check('a full jump rises ~230', top - C.ride > 200 && top - C.ride < 260, (top - C.ride).toFixed(0));
  m = solo(); c = m.cars[0]; top = 0; run(m, 2, t => I({ jump: t < 0.2 || (t > 0.25 && t < 0.3) }), (t, c) => top = Math.max(top, c.p[1]));
  check('a double jump rises ~470', top - C.ride > 420 && top - C.ride < 530, (top - C.ride).toFixed(0));
  m = solo(); c = m.cars[0]; c.place([0, 17, -4000], 0); run(m, 2, I({ throttle: 1 })); let maxV = 0, landT = 0;
  run(m, 2, t => I({ throttle: 1, jump: t < 0.05 || (t > 0.1 && t < 0.15), pitch: t > 0.09 ? -1 : 0 }), (t, c) => { maxV = Math.max(maxV, c.speed); if (!landT && t > 0.2 && c.ground) landT = t; });
  check('a front flip speeds you up and lands wheels down', maxV > 1650 && landT > 0 && basis(c.q).u[1] > 0.9, `max ${maxV.toFixed(0)}, landed ${landT.toFixed(2)} s`);
  m = solo(); c = m.cars[0]; c.place([2000, 17, 0], Math.PI / 2); c.boost = 100; let maxY = 0;
  run(m, 4, t => I({ throttle: 1, boost: t < 1.6 }), (t, c) => maxY = Math.max(maxY, c.p[1]));
  check('you can drive up the wall', maxY > 1000, `got to ${maxY.toFixed(0)}`);
  m = solo(); c = m.cars[0]; c.place([0, 17, 0], 0); c.p = [0, 600, 0]; c.ground = false; c.q = qheading(0); c.w = [3, 1, 2];
  run(m, 3, (t, c) => { const b = basis(c.q), i = I({}); i.roll = Math.max(-1, Math.min(1, b.r[1] * 2.2)); i.pitch = Math.max(-1, Math.min(1, -b.f[1] * 2)); return i; });
  check('air control rights the car before it lands', c.ground && basis(c.q).u[1] > 0.9, `up.y ${basis(c.q).u[1].toFixed(2)}`);
}
// ---- the ball
{ // a straight hit: RL's extra (Psyonix) impulse scales with the closing speed before contact, so the ball leaves well
  // ahead of the car (~1900 off a 1410 drive, ~3000 off a supersonic one), not stuck to the bumper
  const out = [1410, 2300].map(sp => { const m = new Match({ players: [{ id: 'a', team: 0 }], freeplay: true }); m.state = 'play'; const c = m.cars[0]; c.place([0, C.ride, -700], 0); c.v = [0, 0, sp];
    for (let i = 0; i < 240 && Math.hypot(m.ball.v[0], m.ball.v[2]) < 1; i++) { c.in = I({ throttle: 1, boost: sp > 1410 }); m.tickOnce(); } for (let i = 0; i < 10; i++) m.tickOnce(); return Math.hypot(...m.ball.v); });
  check('a straight hit sends the ball off like RL', out[0] > 1750 && out[0] < 2200 && out[1] > 2800 && out[1] < 3400, out.map(v => v.toFixed(0)).join(' / '));
}
{
  const m = new Match({ players: [] }); m.state = 'play'; m.ball.p = [0, 1000, 0]; let peak = 0, up = false, last = 1000, peaks = [];
  for (let i = 0; i < 600; i++) { m.ball.step(1 / 120); const y = m.ball.p[1]; if (y < last && up) peaks.push(last); up = y > last; last = y; }
  peak = peaks[0];
  check('the ball bounces back ~40% as high (0.6 restitution)', peak > 300 && peak < 460, peaks.map(x => x.toFixed(0)).join(' '));
}
// ---- the rules
{
  const players = [{ id: 'b', team: 0 }, { id: 'o', team: 1 }];
  let m = new Match({ players });
  const blue = m.cars[0], orange = m.cars[1];
  check('kickoff: mirrored spots, facing the ball', Math.abs(blue.p[0] + orange.p[0]) < 1e-6 && Math.abs(blue.p[2] + orange.p[2]) < 1e-6 && blue.p[2] < 0, `${blue.p.map(Math.round)} / ${orange.p.map(Math.round)}`);
  check('kickoff: 33 boost, the countdown first', Math.abs(blue.boost - 100 / 3) < 0.01 && m.state === 'count');
  for (let i = 0; i < 400; i++) m.tickOnce();
  check('then GO', m.state === 'play' && m.events.some(e => e.t === 'go'));
  // a goal: blue knocks it into orange's net
  m.events.length = 0; m.ball.p = [0, 200, L - 300]; m.ball.v = [0, 0, 1500]; m.touches.push({ id: 'b', team: 0, t: m.t });
  for (let i = 0; i < 120 && m.state === 'play'; i++) m.tickOnce();
  const g = m.events.find(e => e.t === 'goal');
  check('a goal counts for the right team and scorer', g && g.team === 0 && g.id === 'b' && m.score[0] === 1 && blue.st.goals === 1, JSON.stringify(g || {}));
  for (let i = 0; i < 120 * 4 && m.state !== 'count'; i++) m.tickOnce();
  check('after a goal, the next kickoff', m.state === 'count' && Math.hypot(...m.ball.p.map((v, i) => v - [0, C.ballR, 0][i])) < 1);
  // pads
  m = new Match({ players }); m.state = 'play'; const big = PADS.find(p => p.big); m.cars[0].place([big.x, C.ride, big.z], 0); m.cars[0].boost = 10;
  m.tickOnce();
  const pi = PADS.indexOf(big);
  check('a big pad fills you to 100, then is gone for 10 s', m.cars[0].boost === 100 && Math.abs(m.pads[pi].t - 10) < 0.05, `boost ${m.cars[0].boost}, pad ${m.pads[pi].t.toFixed(2)}`);
  // a demolition: supersonic, nose first into the other team
  m = new Match({ players }); m.state = 'play'; m.ball.p = [0, -9000, 0]; m.ball.step = () => 0;
  m.cars[0].place([0, C.ride, -1200], 0); m.cars[1].place([0, C.ride, 200], Math.PI / 2); m.cars[0].v = [0, 0, 2250]; m.cars[0].sonic = true; m.cars[0].boost = 100;
  for (let i = 0; i < 120; i++) { m.cars[0].in = I({ throttle: 1, boost: true }); m.tickOnce(); if (m.cars[1].demoT > 0) break; }
  check('supersonic into an enemy demolishes it', m.cars[1].demoT > 0 && m.events.some(e => e.t === 'demo'), '');
  for (let i = 0; i < 120 * 3.2; i++) m.tickOnce();
  check('and it respawns 3 s later', m.cars[1].demoT <= 0 && m.events.some(e => e.t === 'respawn'));
  // the clock: at 0:00 tied, overtime; then the next goal ends it
  m = new Match({ players, time: 2 }); for (let i = 0; i < 120 * 3.2; i++) m.tickOnce();
  for (let i = 0; i < 120 * 4 && !m.ot; i++) m.tickOnce();
  check('0:00 tied goes to overtime', m.ot && m.events.some(e => e.t === 'ot'));
  for (let i = 0; i < 400; i++) m.tickOnce();
  m.ball.p = [0, 200, -L + 300]; m.ball.v = [0, 0, -1500]; m.touches.push({ id: 'o', team: 1, t: m.t });
  for (let i = 0; i < 120 * 10 && m.state !== 'end'; i++) m.tickOnce();
  check('a goal in overtime wins it', m.state === 'end' && m.score[1] === 1 && m.events.some(e => e.t === 'end' && e.win === 1));
}
// ---- the wire: inputs and the whole state round-trip, and a loaded match runs on the same as the original
{
  const i = { throttle: 0.5, steer: -1, pitch: 0.25, yaw: 0, roll: 1, jump: true, boost: false, handbrake: true };
  check('inputs pack and unpack', JSON.stringify(unpackIn(packIn(i))) === JSON.stringify(i));
  const players = []; for (let k = 0; k < 3; k++) { players.push({ id: 'b' + k, team: 0, bot: true, diff: 'allstar' }); players.push({ id: 'o' + k, team: 1, bot: true, diff: 'pro' }); }
  const a = new Match({ players, seed: 5 }), b = new Match({ players, seed: 5 });
  for (let k = 0; k < 120 * 40; k++) { for (const c of a.cars) c.in = botInput(a, c, 1 / 120); a.tickOnce(); a.events.length = 0; }
  const s = JSON.stringify(a.save()); b.load(JSON.parse(s));
  for (let k = 0; k < 24; k++) { for (const c of a.cars) c.in = botInput(a, c, 1 / 120); for (const c of b.cars) c.in = a.cars.find(o => o.id === c.id).in; a.tickOnce(); b.tickOnce(); }
  let drift = 0; for (const c of a.cars) { const o = b.cars.find(x => x.id === c.id); drift = Math.max(drift, Math.hypot(...c.p.map((v, k) => v - o.p[k]))); }
  check('a loaded state runs on as the original (within rounding)', drift < 1, `drift ${drift.toFixed(3)} uu after 24 ticks, ${s.length} bytes`);
}
// ---- the bots: matches play out clean; the levels come in order; aerials connect
const match = (n, dA, dB, seed) => {
  const players = []; for (let k = 0; k < n; k++) { players.push({ id: 'b' + k, team: 0, bot: true, diff: dA }); players.push({ id: 'o' + k, team: 1, bot: true, diff: dB }); }
  const m = new Match({ players, seed }); let nan = 0, out = 0; const ev = {};
  while (m.state !== 'end' && m.t < 900) { for (const c of m.cars) c.in = botInput(m, c, 1 / 120); m.tickOnce(); for (const e of m.events) ev[e.t] = (ev[e.t] || 0) + 1; m.events.length = 0; for (const c of m.cars) { if (c.p.some(Number.isNaN)) nan++; if (!c.demoT && D(c.p[0], c.p[1], c.p[2]) < -20) out++; } if (m.ball.p.some(Number.isNaN)) nan++; }
  return { m, nan, out, ev };
};
{
  let wins = 0, games = 0, clean = true, info = [];
  for (const [n, seed] of [[3, 1], [3, 2], [2, 3]]) { const r = match(n, 'allstar', 'rookie', seed); games++; if (r.m.score[0] > r.m.score[1]) wins++; if (r.nan || r.out > 30 || r.m.state !== 'end') clean = false; info.push(`${n}v${n} ${r.m.score.join('-')}${r.out ? ' out ' + r.out : ''}`); }
  check('All-Star beats Rookie', wins >= 3, info.join(', '));
  check('bot matches finish clean (no NaN, nobody in the walls)', clean);
  const r = match(3, 'pro', 'pro', 9);
  check('Pro vs Pro: a real game (goals, saves, demos, flips)', r.m.score[0] + r.m.score[1] >= 2 && (r.ev.flip || 0) > 20 && (r.ev.touch || 0) > 60, `${r.m.score.join('-')} ${JSON.stringify(r.ev)}`);
  // aerials: balls up in the air out in the open, an All-Star goes up and gets them
  let hits = 0;
  for (const [h, dz] of [[600, 1200], [900, 1500], [1200, 1600], [800, 1800]]) {
    const m = new Match({ players: [{ id: 'b0', team: 0, bot: true, diff: 'allstar' }], seed: 1, freeplay: true });
    while (m.state !== 'play') { m.cars[0].in = botInput(m, m.cars[0], 1 / 120); m.tickOnce(); }
    const c = m.cars[0]; c.p = [0, 17, 0]; c.v = [0, 0, 0]; c.q = qheading(0); c.boost = 100; c.ground = true; m.firstTouch = true;
    m.ball.p = [0, h - 300, dz]; m.ball.v = [0, 700, 0]; m.ball.w = [0, 0, 0];
    let hit = false; for (let i = 0; i < 120 * 4 && !hit; i++) { c.in = botInput(m, c, 1 / 120); m.tickOnce(); hit = m.events.some(e => e.t === 'touch') && m.ball.p[1] > 300; m.events.length = 0; }
    if (hit) hits++;
  }
  check('All-Star aerials connect', hits >= 3, `${hits}/4`);
}

// ---- online: serve.ts on a spare port, two players join, inputs go in, the state comes back 30 times a second
{
  const { mkdtempSync, rmSync } = await import('fs'), { tmpdir } = await import('os'), { join } = await import('path');
  const dir = mkdtempSync(join(tmpdir(), 'rs-league-')), port = 22000 + Math.floor(Math.random() * 2000);
  const srv = Bun.spawn(['bun', 'serve.ts', String(port)], { cwd: join(import.meta.dir, '..'), env: { ...process.env, RUNESKATE_DATA: dir }, stdout: 'ignore', stderr: 'ignore' });
  try {
    for (let i = 0; i < 150; i++) { try { await fetch(`http://localhost:${port}/league.html`); break; } catch { await Bun.sleep(100); } }
    await Bun.sleep(500);
    const join2 = name => new Promise((res, rej) => {
      const ws = new WebSocket(`ws://localhost:${port}/league-ws`), P = { ws, snaps: 0, acks: [], chat: [], seq: 0 };
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, body: 'mine', theme: 'zam', hat: 'red', boom: 'dragon' }));
      ws.onmessage = e => { const o = JSON.parse(e.data); if (o.t === 'w') { P.you = o.you; P.m = new Match({ players: o.cars, seed: 1 }); P.m.load(o.s); P.team = o.cars.find(c => c.id === o.you).team; res(P); } if (o.t === 's') { P.snaps++; P.acks.push(o.ack); P.m?.load(o.s); P.last = o.s; } if (o.t === 'qc') P.chat.push(o); if (o.t === 'r') P.roster = o.cars; };
      ws.onerror = rej; setTimeout(() => rej(new Error('no welcome')), 5000);
    });
    const a = await join2('Alice'), b = await join2('Bob');
    check('two players get seats on opposite teams', a.you !== b.you && a.team !== b.team, `${a.you} (${a.team}) ${b.you} (${b.team})`);
    const seat = a.m.cars.find(c => c.id === a.you);
    check('a seat takes a bot\'s place, with your name and kart', !seat.bot && seat.name === 'Alice' && seat.body === 'mine');
    const t0 = Date.now(), z0 = a.last?.c.find(c => c[0] === a.you)[3];
    await new Promise(res => { const iv = setInterval(() => { for (const P of [a, b]) { const me = P.m.cars.find(c => c.id === P.you); P.ws.send(JSON.stringify({ t: 'i', i: [[++P.seq, packIn(botInput(P.m, me, 1 / 60))]] })); } if (Date.now() - t0 > 6000) { clearInterval(iv); res(); } }, 1000 / 60); });
    a.ws.send(JSON.stringify({ t: 'qc', a: 2, b: 1 })); await Bun.sleep(300);
    const rate = a.snaps / 6, me = a.last.c.find(c => c[0] === a.you);
    check('snapshots at ~30 a second', rate > 25 && rate < 35, rate.toFixed(1));
    check('our inputs are taken and acked', a.acks.at(-1) > a.seq - 10 && a.acks.at(-1) > 100, `ack ${a.acks.at(-1)} of ${a.seq}`);
    check('our car moves on our inputs', Math.hypot(me[1], me[3] - z0) > 300 || a.last.st === 'play', `at ${me.slice(1, 4).map(Math.round)}`);
    check('the clock runs on the server', a.last.cl < 300 && a.last.st !== 'count', `${a.last.cl.toFixed(1)} ${a.last.st}`);
    check('quick chat goes round', b.chat.some(o => o.id === a.you && o.a === 2 && o.b === 1));
    b.ws.close(); await Bun.sleep(400);
    check('a player who leaves hands their car back to a bot', a.roster?.find(c => c.id === b.you)?.bot === true);
    a.ws.close();
  } catch (e) { check('online', false, e.message); }
  finally { srv.kill(); rmSync(dir, { recursive: true, force: true }); }
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
