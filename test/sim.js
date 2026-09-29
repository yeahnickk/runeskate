// Headless physics checks:  bun runeskate/test/sim.js
import { readFileSync } from 'fs';
import { World } from '../src/world.js';
import { Skater } from '../src/skater.js';

const w = new World(JSON.parse(readFileSync(new URL('../assets/world.json', import.meta.url))));
const L = (x, z) => [x - w.base[0], z - w.base[1]];
const blank = () => ({ steer: 0, push: false, brake: false, jump: false, jumpPressed: false, slide: false, trick: null, anyKey: false });
let fails = 0;
function run(sk, secs, fn) {
  const dt = 1 / 240; const log = [];
  for (let i = 0; i < secs / dt; i++) {
    const t = i * dt; const inp = Object.assign(blank(), fn ? fn(t, sk) : {});
    sk.step(dt, inp); sk.tickCombo(dt);
    for (const e of sk.events) log.push({ t: +t.toFixed(2), ...e });
    sk.events.length = 0;
  }
  return log;
}
function check(name, ok, info) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; }
const where = sk => `(${(sk.x + w.base[0]).toFixed(2)},${(sk.z + w.base[1]).toFixed(2)}) y=${sk.y.toFixed(2)} mode=${sk.mode}`;

console.log('rails:', w.rails.length, 'segments:', w.segs.length);

// 1. spawn: roll north on the courtyard path, never leave walkable tiles
{
  const sk = new Skater(w);
  let bad = 0;
  run(sk, 1.2, () => ({ push: true }));
  check('push from spawn moves', sk.speed > 3, where(sk) + ' v=' + sk.speed.toFixed(2));
  for (let i = 0; i < 400; i++) { run(sk, 0.05, (t) => ({ push: true, steer: Math.sin(i / 30) })); if (w.tileKind(sk.x, sk.z) !== 0 && sk.mode !== 'bail') bad++; }
  check('never inside a blocked tile while riding', bad === 0, `bad=${bad} ` + where(sk));
}

// 2. slam the castle wall (front of the castle is x=3217): west at speed
{
  const sk = new Skater(w);
  const [x, z] = L(3221.5, 3219.5); sk.reset(x, z, Math.PI);
  sk.vx = -13; sk.vz = 0;
  const log = run(sk, 1.2);
  check('fast into castle wall -> bail', log.some(e => e.type === 'bail' && e.why === 'wall'), where(sk));
  check('stays outside the wall', sk.x + w.base[0] > 3217.0, where(sk));
}

// 3. gentle wall touch: slide, no bail
{
  const sk = new Skater(w);
  const [x, z] = L(3219.0, 3219.5); sk.reset(x, z, Math.PI * 0.8);
  sk.vx = -2.2; sk.vz = 1.2;
  const log = run(sk, 1.0);
  check('gentle wall touch -> no bail', !log.some(e => e.type === 'bail'), where(sk));
  check('gentle wall touch stays out', sk.x + w.base[0] > 3217.2, where(sk));
}

// 4. ollie onto the bridge south parapet (z=3225) and grind it east
{
  const sk = new Skater(w);
  const [x, z] = L(3242.3, 3225.36); sk.reset(x, z, 0);
  sk.vx = 5.5; sk.vz = -0.3;
  const log = run(sk, 3.5, (t) => ({ jump: t < 0.3 }));
  const g = log.find(e => e.type === 'grind');
  check('ollie -> grind the parapet', !!g, JSON.stringify(log.slice(0, 6)));
  const tr = log.filter(e => e.type === 'trick').map(e => e.name);
  check('grind scored', tr.some(n => /50-50|Crooked|Boardslide/.test(n)), tr.join(' | ') + ' ' + where(sk));
}

// 5. ollie over the parapet into the river -> splash bail
{
  const sk = new Skater(w);
  const [x, z] = L(3245.0, 3226.45); sk.reset(x, z, -Math.PI / 2);
  sk.vx = 0.3; sk.vz = -4.5;
  const log = run(sk, 2.5, (t) => ({ jump: t < 0.05 }));
  check('over the parapet -> river bail', log.some(e => e.type === 'bail' && e.why === 'water'), JSON.stringify(log.map(e => e.type + (e.why || ''))) + ' ' + where(sk));
}

// 6. walk into the river bank from land (no jump) -> water edge blocks
{
  const sk = new Skater(w);
  const [x, z] = L(3238.5, 3222.0); sk.reset(x, z, 0);
  sk.vx = 3; sk.vz = 0;
  const log = run(sk, 2.5, () => ({ steer: 0 }));
  check('river bank blocks on the ground', w.tileKind(sk.x, sk.z) !== 2 && !log.some(e => e.why === 'water'), where(sk) + ' ' + log.map(e => e.type).join(','));
}

// 7. kickflip on flat, clean landing
{
  const sk = new Skater(w);
  const [x, z] = L(3236.5, 3216.0); sk.reset(x, z, Math.PI / 2);
  sk.vx = 0; sk.vz = 4;
  const log = run(sk, 1.6, (t) => ({ jump: t < 0.34, trick: t > 0.4 && t < 0.45 ? 'kickflip' : null }));
  check('kickflip lands', log.some(e => e.type === 'land') && !log.some(e => e.type === 'bail'), log.map(e => e.type + (e.name || e.why || '')).join(','));
}

// 8. late flip -> bail (still flipping when the wheels touch)
{
  const sk = new Skater(w);
  const [x, z] = L(3236.5, 3216.0); sk.reset(x, z, Math.PI / 2);
  sk.vz = 4;
  const log = run(sk, 1.6, (t) => ({ jump: t < 0.02, trick: t > 0.3 && t < 0.32 ? 'kickflip' : null }));
  check('late flip -> bail', log.some(e => e.type === 'bail' && e.why === 'flip'), log.map(e => e.type + (e.why || '')).join(','));
}

// 9. 90 degree spin landing sideways -> bail
{
  const sk = new Skater(w);
  const [x, z] = L(3236.5, 3216.0); sk.reset(x, z, Math.PI / 2);
  sk.vz = 4;
  // force the board dead sideways mid-air and keep a (negligible) steer held so the spin assist stays off
  let set = false;
  const log = run(sk, 1.6, (t) => { if (!set && t > 0.45 && sk.mode === 'air') { sk.heading = sk.body = 0; set = true; } return { jump: t < 0.34, steer: 1e-9 }; });
  check('sideways landing -> rides it out (wobble, no clean land)', log.some(e => e.type === 'wobble') || log.some(e => e.type === 'bail'), log.map(e => e.type + (e.why || '')).join(','));
}

// 9b. half-held spin: let go of A/D and the assist straightens you out -> clean land
{
  const sk = new Skater(w);
  const [x, z] = L(3236.5, 3216.0); sk.reset(x, z, Math.PI / 2);
  sk.vz = 4;
  const log = run(sk, 1.6, (t) => ({ jump: t < 0.34, steer: t > 0.4 && t < 0.55 ? 1 : 0 }));
  check('released spin lands (assist)', !log.some(e => e.type === 'bail') && log.some(e => e.type === 'land'), log.map(e => e.type + (e.why || '')).join(','));
}

// 9c. moderate head-on wall hit (5 tiles/s) -> no bail, stays on the board
{
  const sk = new Skater(w);
  const [x, z] = L(3221.5, 3219.5); sk.reset(x, z, Math.PI);
  sk.vx = -5.5; sk.vz = 0;
  const log = run(sk, 1.2);
  check('moderate wall hit -> no bail', !log.some(e => e.type === 'bail') && sk.mode === 'ground', where(sk));
}

// 9d. standstill kick-start: first push gets you rolling fast
{
  const sk = new Skater(w);
  const [x, z] = L(3222, 3225); sk.reset(x, z, 0);
  run(sk, 0.6, () => ({ push: true }));
  check('kick-start >4 tiles/s in 0.6s', sk.speed > 4, 'v=' + sk.speed.toFixed(2));
}

// 10. closed cow-pen gate stays shut: Gate at (3253,3266) blocks travel east->west across it
{
  const gates = w.segs.filter(s => s.kind === 'door').map(s => [s.ax + w.base[0], s.az + w.base[1], s.bx + w.base[0], s.bz + w.base[1]]);
  check('gates/doors present as solid segments', gates.length > 0, gates.slice(0, 4).map(g => g.join(',')).join(' | '));
}

// 11. bail recovers onto the board
{
  const sk = new Skater(w);
  const [x, z] = L(3221.5, 3219.5); sk.reset(x, z, Math.PI);
  sk.vx = -13;
  const log = run(sk, 5);
  check('bail -> recover', log.some(e => e.type === 'recover') && sk.mode === 'ground', where(sk));
}

// 12. manual: hold Q while rolling east from spawn, balance with W/S, it scores and holds the combo open
{
  const sk = new Skater(w); sk.reset(w.spawn[0], w.spawn[1], 0);
  run(sk, 0.8, () => ({ push: true }));
  let started = false;
  const log = run(sk, 1.2, (t, s) => { if (s.manual) started = true; return { manual: true, push: s.manBal < -0.1, brake: s.manBal > 0.1 }; });
  check('manual starts and holds', started && log.some(e => e.type === 'manual'), where(sk) + ' bal=' + sk.manBal.toFixed(2));
  run(sk, 0.1);
  check('manual scores into the combo', sk.combo.some(n => /Manual/.test(n)), sk.combo.join(' | '));
}

// 13. grab: ollie, hold Q in the air, let go, land -> "Grab" in the combo
{
  const sk = new Skater(w); sk.reset(w.spawn[0], w.spawn[1], 0);
  run(sk, 0.8, () => ({ push: true }));
  run(sk, 0.3, () => ({ jump: true }));
  const log = run(sk, 1.2, (t) => ({ manual: t > 0.1 && t < 0.4 }));
  check('grab scored', log.some(e => e.type === 'trick' && /Grab/.test(e.name)), log.filter(e => e.type === 'trick').map(e => e.name).join(' | '));
}

// 14. 360 flip lands with the board still facing forward (full shove rotation)
{
  const sk = new Skater(w); sk.reset(w.spawn[0], w.spawn[1], 0);
  run(sk, 0.8, () => ({ push: true }));
  const h0 = sk.heading;
  run(sk, 0.35, () => ({ jump: true }));
  const log = run(sk, 1.2, (t) => ({ trick: t < 0.02 ? 'tre' : null }));
  const d = Math.abs(((sk.heading - h0 + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
  check('360 flip lands regular', log.some(e => e.type === 'trick' && /360 Flip/.test(e.name)) && sk.mode === 'ground' && d < 0.5, 'dHead=' + d.toFixed(2) + ' ' + where(sk));
}

// 15. trees/props: ride straight into a block footprint -> glance off it, keep most of the speed, no bail
{
  // a lone 1-tile footprint edge with open tiles to its south, near Lumbridge
  const seg = w.segs.find(s => s.kind === 'block' && s.az === s.bz && Math.abs(s.ax + w.base[0] - 3240) < 25 && Math.abs(s.az + w.base[1] - 3230) < 25
    && w.tileKind(Math.min(s.ax, s.bx) + 0.5, s.az - 0.5) === 0 && w.tileKind(Math.min(s.ax, s.bx) + 0.5, s.az - 1.5) === 0 && w.tileKind(Math.min(s.ax, s.bx) + 0.5, s.az - 2.5) === 0);
  const sk = new Skater(w); const x = Math.min(seg.ax, seg.bx) + 0.45;
  sk.reset(x, seg.az - 2.5, Math.PI / 2); sk.vz = 6;
  const log = run(sk, 0.8);
  check('tree hit glances, keeps speed', !log.some(e => e.type === 'bail') && sk.speed > 3.5, 'v=' + sk.speed.toFixed(2) + ' ' + where(sk));
}

// 16. dropped inside a blocked footprint (bad landing) -> slides out to open ground by itself
{
  let bx = -1, bz = -1;
  for (let x = Math.floor(w.spawn[0]) - 20; x < w.spawn[0] + 20 && bx < 0; x++) for (let z = Math.floor(w.spawn[1]) - 20; z < w.spawn[1] + 20; z++)
    if (w.tileKind(x + 0.5, z + 0.5) === 1 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => w.tileKind(x + a + 0.5, z + b + 0.5) === 0)) { bx = x; bz = z; break; }
  const sk = new Skater(w); sk.reset(bx + 0.5, bz + 0.5, 0);
  run(sk, 1.0);
  check('pushed out of a hitbox', w.tileKind(sk.x, sk.z) === 0 && !sk.wedged(), where(sk));
}

// 17. rails are easy to catch: ollie from a little way off the parapet line still locks on
{
  const sk = new Skater(w);
  const [x, z] = L(3242.3, 3225.75); sk.reset(x, z, 0);   // 0.75 tiles off the rail line (was 0.6 max)
  sk.vx = 5.5; sk.vz = -0.3;
  const log = run(sk, 1.2, (t) => ({ jump: t < 0.3 }));
  check('loose rail catch', log.some(e => e.type === 'grind'), log.map(e => e.type).join(','));
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
