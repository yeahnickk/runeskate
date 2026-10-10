// Headless physics checks:  bun runeskate/test/sim.js
import { readFileSync } from 'fs';
import { World, railTop } from '../src/world.js';
import { Skater, P, wheelContact } from '../src/skater.js';

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
  for (let i = 0; i < 400; i++) { run(sk, 0.05, (t) => ({ push: true, steer: Math.sin(i / 30) })); const k = w.tileKind(sk.x, sk.z); if (((k !== 0 && k !== 4) || w.trunkAt(sk.x, sk.z, -0.03)) && sk.mode !== 'bail') bad++; }
  check('never inside a blocked tile while riding', bad === 0, `bad=${bad} ` + where(sk));
}

// 2. slam the castle wall (front of the castle is x=3217; its doors at z 3218-3219 stand open): west at speed
{
  const sk = new Skater(w);
  const [x, z] = L(3221.5, 3222.5); sk.reset(x, z, Math.PI);
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

// 8. late flip -> bail (still flipping when the wheels touch). Start clear of the grindable run at x=3237.
{
  const sk = new Skater(w);
  const [x, z] = L(3235.5, 3216.0); sk.reset(x, z, Math.PI / 2);
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

// 10. every door and gate stands open (tools/doors.ts): nothing of kind 'door' is left in the collision
{
  const doors = w.segs.filter(s => s.kind === 'door');
  check('doors and gates all open', doors.length === 0, doors.slice(0, 4).map(s => [s.ax + w.base[0], s.az + w.base[1]].join(',')).join(' | '));
}

// 11. bail recovers onto the board
{
  const sk = new Skater(w);
  const [x, z] = L(3221.5, 3219.5); sk.reset(x, z, Math.PI);
  sk.vx = -13;
  const log = run(sk, 7);                              // the rider is always up by RD.maxTime (6 s)
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

// 15. trees: ride straight into a trunk -> glance off it, keep most of the speed, no bail. And the hitbox is the
// TRUNK: roll past one a hand's width off it and nothing happens at all (it used to be the whole 2x2 footprint)
const loneTrunk = (() => {
  for (const l of w.trunkGrid.values()) for (const t of l) {
    if (Math.abs(t.x + w.base[0] - 3230) > 40 || Math.abs(t.z + w.base[1] - 3230) > 40 || t.r > 0.3) continue;
    let ok = true;
    for (let dz = -4; dz <= -0.5 && ok; dz += 0.25) for (const dx of [-1, -0.5, 0, 0.5, 1]) {
      const k = w.tileKind(t.x + dx, t.z + dz), o = w.trunkAt(t.x + dx, t.z + dz, 0.6);
      if ((k !== 0 && k !== 4) || (o && o.t !== t)) ok = false;
      for (const s of w.segsNear(t.x + dx, t.z + dz, 1)) if (s.kind !== 'edge') { const px = t.x + dx, pz = t.z + dz; if (Math.hypot(px - (s.ax + s.bx) / 2, pz - (s.az + s.bz) / 2) < 1.2) ok = false; }
    }
    if (ok) return t;
  }
})();
{
  const t = loneTrunk, sk = new Skater(w);
  sk.reset(t.x + 0.04, t.z - 3, Math.PI / 2); sk.vz = 6;
  const av = P.treeAvoid; P.treeAvoid = 0;                // the contact itself (the look-ahead steer has its own test)
  const log = run(sk, 0.8);
  P.treeAvoid = av;
  check('tree trunk hit glances, keeps speed', !log.some(e => e.type === 'bail') && sk.speed > 3.5 && sk.z > t.z + 0.5, 'v=' + sk.speed.toFixed(2) + ' ' + where(sk) + ` trunk (${(t.x + w.base[0]).toFixed(2)},${(t.z + w.base[1]).toFixed(2)}) r=${t.r}`);
}
{
  const t = loneTrunk, sk = new Skater(w), off = t.r + P.trunkPad + 0.08;
  sk.reset(t.x + off, t.z - 3, Math.PI / 2); sk.vz = 6;
  const av = P.treeAvoid; P.treeAvoid = 0;
  const log = run(sk, 0.8);
  P.treeAvoid = av;
  check('tree hitbox is the trunk: pass within ' + off.toFixed(2) + ' tiles untouched', Math.abs(sk.x - (t.x + off)) < 0.06 && sk.speed > 5.25 && !log.some(e => e.type === 'bump'), where(sk) + ' v=' + sk.speed.toFixed(2) + ' ' + [...new Set(log.map(e => e.type))].join(','));
}

// 15b. riding switch (nose pointing back at the camera) and pushing where the camera looks: goes that way, and
// the rider turns round to regular so the next push/steer is normal again
{
  const sk = new Skater(w); sk.reset(w.spawn[0], w.spawn[1], Math.PI / 2 + Math.PI); sk.vz = 2;   // rolling north, board facing south
  const log = run(sk, 0.6, (t, s) => ({ push: true, fwd: Math.sin(s.heading) >= 0 ? 1 : -1 }));   // camera looks north, as in main.js
  const reg = Math.cos(sk.heading - Math.atan2(sk.vz, sk.vx));
  check('switch push goes toward the camera and reverts to regular', sk.vz > 3 && reg > 0.9 && log.some(e => e.type === 'revert'), 'vz=' + sk.vz.toFixed(2) + ' align=' + reg.toFixed(2));
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

// 18. the cow pen gate (3253,3267): ollie east over it into the pen, or (it stands open) just ride through
{
  const sk = new Skater(w);
  const [x, z] = L(3249.2, 3267.5); sk.reset(x, z, 0); sk.vx = 6;
  const log = run(sk, 1.8, (t) => ({ jump: t < 0.36 }));      // a full-charge ollie, released ~1.5 tiles out
  check('ollie over the cow pen gate', sk.x + w.base[0] > 3253.3 && !log.some(e => e.type === 'bail'), where(sk) + ' ' + log.map(e => e.type).join(','));
  const sk2 = new Skater(w); sk2.reset(x, z, 0); sk2.vx = 6;
  run(sk2, 1.2);
  check('...and it stands open: ride straight through it', sk2.x + w.base[0] > 3254, where(sk2));
}

// 19. a lone low obstacle (cactus/rock/crate: a 1-tile block with a measured top) can be ollied over
{
  const low = w.segs.filter(s => s.kind === 'block' && s.top && s.dx === 0 && Math.max(...s.top) - w.height(s.ax - 0.5, s.az + 0.5) < 0.8);
  let ok = false, tried = 0, info = '';
  for (const s of low) {
    // the obstacle tile is east of this west-facing edge; need open run-up to the west and open ground beyond it
    const zc = s.az + 0.5, tx = s.ax;
    if (w.tileKind(tx + 0.5, zc) !== 1 || w.tileKind(tx + 1.5, zc) !== 0 || w.tileKind(tx + 2.5, zc) !== 0) continue;
    if (![1, 2, 3].every(d => w.tileKind(tx - d + 0.5, zc) === 0)) continue;
    if (Math.abs(w.height(tx - 2.5, zc) - w.height(tx + 2.5, zc)) > 0.3) continue;
    const sk = new Skater(w); sk.reset(tx - 2.6, zc, 0); sk.vx = 6;
    const log = run(sk, 1.6, (t) => ({ jump: t < 0.18 }));
    tried++;
    if (sk.x > tx + 1.2 && !log.some(e => e.type === 'bail')) { ok = true; info = `over (${tx + w.base[0]},${Math.floor(zc) + w.base[1]}) h=${(Math.max(...s.top) - w.height(tx - 0.5, zc)).toFixed(2)}`; break; }
    if (tried > 20) break;
  }
  check('ollie over a small obstacle', ok, info || `tried ${tried}`);
}

// land on the Varrock east mine outcrop: rocks, not "swam with the fishes"
{
  let rx = -1, rz = -1;
  for (let z = 3360; z <= 3368 && rx < 0; z++) for (let x = 3281; x <= 3291; x++) { const [a, b] = L(x + 0.5, z + 0.5); if (w.tileKind(a, b) === 3) { rx = a; rz = b; break; } }
  const sk = new Skater(w);
  let log = [];
  if (rx >= 0) { sk.reset(rx, rz, 0); sk.mode = 'air'; sk.y = w.height(rx, rz) + 1.5; sk.vy = 0; sk.vx = sk.vz = 0; log = run(sk, 1.2); }
  check('landing on rocks says rocks', rx >= 0 && log.some(e => e.type === 'bail' && e.why === 'rocks') && !log.some(e => e.why === 'water'), log.map(e => e.type + (e.why || '')).join(','));
}

// Draynor Manor lane: the painted line has no tree on it any more
{
  const lanes = JSON.parse(readFileSync(new URL('../assets/world.json', import.meta.url))).lanes || [];
  const centre = lanes.filter(([, , s]) => s >= 1);
  const onManor = centre.filter(([x, z]) => x + w.base[0] >= 3100 && x + w.base[0] <= 3116 && z + w.base[1] >= 3290 && z + w.base[1] <= 3352);
  check('manor lane is clear', onManor.length > 40 && onManor.every(([x, z]) => w.tileKind(x + 0.5, z + 0.5) === 0), `${onManor.length} lane tiles`);
}

// the hidden rune: skate in through Lumbridge church's west doorway and reach it
{
  const sk = new Skater(w);
  const [x, z] = L(3236.5, 3210.5); sk.reset(x, z, 0); sk.vx = 5;
  const [rx, rz] = L(3246.5, 3207.5);
  let best = 99;
  run(sk, 6, (t, s) => { best = Math.min(best, Math.hypot(s.x - rx, s.z - rz)); const want = Math.atan2(rz - s.z, rx - s.x); let d = want - s.heading; d = Math.atan2(Math.sin(d), Math.cos(d)); return { push: false, brake: best < 1, steer: s.x > x + 4 ? Math.max(-1, Math.min(1, d * 2)) : 0 }; });
  check('church rune is reachable', best < 1.2, `closest ${best.toFixed(2)} ${where(sk)}`);
  const runes = JSON.parse(readFileSync(new URL('../assets/runes.json', import.meta.url))).runes;
  const wAll = new World(JSON.parse(readFileSync(new URL('../assets/world.json', import.meta.url))));
  for (const r of wAll.regions) wAll.addRegion(JSON.parse(readFileSync(new URL(`../assets/world_${r.name}.json`, import.meta.url))));
  const orig = runes.slice(0, 40).map(r => r.id).join();
  check('100 runes, unique ids, all on open ground (full map)', runes.length === 100 && new Set(runes.map(r => r.id)).size === 100 && runes.every(r => wAll.tileKind(r.x + 0.5 - wAll.base[0], r.z + 0.5 - wAll.base[1]) === 0),
    runes.filter(r => wAll.tileKind(r.x + 0.5 - wAll.base[0], r.z + 0.5 - wAll.base[1]) !== 0).map(r => r.id).join(' '));
  check('first 40 runes unchanged', orig.startsWith('fire-3246-3207,water-3095-3315,earth-3235-3308'));
  check('no rune past the wilderness edge (x < 2944, the unreachable mountains)', runes.every(r => !(r.z >= 3520 && r.x < 2944)), runes.filter(r => r.z >= 3520 && r.x < 2944).map(r => r.id).join(' '));
  check('moved runes keep their ids (players keep what they collected)', ['air-2919-3568', 'water-2903-3805', 'earth-2934-3850'].every(id => runes.some(r => r.id === id)));
  check('every region loaded: no frontier walls left inside the playable map', wAll.segs.filter(s => s.frontier).every(s => !(wAll.isLive(Math.floor(s.ax), Math.floor(s.az)) && wAll.isLive(Math.floor(s.ax) - (s.ax === s.bx ? 1 : 0), Math.floor(s.az) - (s.az === s.bz ? 1 : 0)))));
}

// tiny things (tree stumps, roots, fungus, flowers) no longer block: you skate straight over them
{
  const tiny = [[3194, 3247], [3198, 3249], [3188, 3253]];
  check('tree stumps / fungus / flowers are rideable', tiny.every(([x, z]) => w.tileKind(x + 0.5 - w.base[0], z + 0.5 - w.base[1]) === 0), tiny.map(([x, z]) => w.tileKind(x + 0.5 - w.base[0], z + 0.5 - w.base[1])).join());
}

// grinds carry on round fence corners and across small gaps onto the next rail (was: dropped off at every bend)
{
  const end = (r, t) => [r.horiz ? r.ax + t : r.ax, r.horiz ? r.az : r.az + t];
  const grindFrom = (r, dir) => {                       // start on r a few tiles before its end, riding toward that end
    const sk = new Skater(w), t0 = dir > 0 ? Math.max(0, r.len - 3) : Math.min(r.len, 3);
    const [x, z] = end(r, t0); sk.reset(x, z + (r.horiz ? 0 : 0), Math.atan2(r.dirz * dir, r.dirx * dir));
    Object.assign(sk, { mode: 'grind', rail: r, railT: t0, railDir: dir, railSpeed: 6, railSide: 1, grindKind: '50-50', grindHeading: sk.heading, balance: 0, grindTime: 0, y: railTop(r, t0) });
    const rails = new Set([r]); let ungrind = false;
    run(sk, 1.6, (t, s) => { if (s.mode === 'grind') rails.add(s.rail); else ungrind = true; return { steer: Math.max(-1, Math.min(1, (s.balance || 0) * 4)) }; });
    return { rails, ungrind, sk };
  };
  let corner = null, gap = null;
  for (const r of w.rails) for (const dir of [1, -1]) {
    if (r.len < 4) continue;
    const [ex, ez] = end(r, dir > 0 ? r.len : 0);
    for (const q of w.railsNear(ex, ez, 2)) for (const u of [0, q.len]) {
      if (q === r || q.len < 3) continue;
      const [qx, qz] = end(q, u), d = Math.hypot(qx - ex, qz - ez), dh = Math.abs(railTop(q, u) - railTop(r, dir > 0 ? r.len : 0));
      const out = u === 0 ? 1 : -1, dot = r.dirx * dir * q.dirx * out + r.dirz * dir * q.dirz * out;
      if (!corner && d === 0 && q.horiz !== r.horiz && dh < 0.3) corner = [r, dir, q];
      if (!gap && d > 0.4 && d < 1.4 && dot > 0.99 && dh < 0.3 && (qx - ex) * r.dirx * dir + (qz - ez) * r.dirz * dir > 0) gap = [r, dir, q];
    }
  }
  const c = grindFrom(corner[0], corner[1]);
  check('grind carries round a fence corner', c.rails.has(corner[2]), `rails ridden ${c.rails.size} ungrind=${c.ungrind} ` + where(c.sk));
  if (gap) { const g = grindFrom(gap[0], gap[1]); check('grind carries across a small gap', g.rails.has(gap[2]), `gap rails ${g.rails.size} ` + where(g.sk)); }
  else check('a gapped rail pair exists to test', false);
}

// jump the River Lum: its bed has invisible server walls, which used to stop you mid-air ("hit a wall")
{
  const sk = new Skater(w);
  const [x, z] = L(3229.3, 3243.5); sk.reset(x, z, 0); sk.vx = 12.5;
  let jumped = false;
  let landX = null, flew = false;
  const log = run(sk, 2, (t, s) => { const wx = s.x + w.base[0]; const j = !jumped && wx > 3233.7 && wx < 3234.6; if (wx >= 3234.6) jumped = true; if (s.mode === 'air') flew = true; if (landX === null && flew && s.mode === 'ground') landX = wx; return { jump: j }; });
  check('jump across the River Lum', !log.some(e => e.type === 'bail') && landX > 3241 && sk.mode === 'ground', `landed x=${landX?.toFixed(1)} ` + where(sk));
}

// Varrock is a streamed pack: walled off until it loads, then open (road north at x=3211)
{
  const vp = new URL('../assets/world_varrock.json', import.meta.url);
  let vj = null; try { vj = JSON.parse(readFileSync(vp)); } catch {}
  if (!vj) check('varrock pack present', false);
  else {
    const w2 = new World(JSON.parse(readFileSync(new URL('../assets/world.json', import.meta.url))));
    const go = () => { const sk = new Skater(w2); sk.reset(3211.5 - w2.base[0], 3380.5 - w2.base[1], Math.PI / 2); sk.vz = 7; run(sk, 3, () => ({ push: true })); return sk; };
    const before = go();
    check('varrock closed before it streams in', before.z + w2.base[1] < 3392, `z=${(before.z + w2.base[1]).toFixed(1)}`);
    w2.addRegion(vj);
    const after = go();
    check('varrock open once streamed in', after.z + w2.base[1] > 3395, `z=${(after.z + w2.base[1]).toFixed(1)} rails=${w2.rails.length}`);
  }
}

// Falador streams in west of Draynor: skate west along z=3240 (open fields), wall until it loads
{
  const fj = JSON.parse(readFileSync(new URL('../assets/world_falador.json', import.meta.url)));
  const pj = JSON.parse(readFileSync(new URL('../assets/world_portsarim.json', import.meta.url)));
  const w3 = new World(JSON.parse(readFileSync(new URL('../assets/world.json', import.meta.url))));
  const edge = w3.segs.filter(s => s.frontier && s.ax === 3072 - w3.base[0] && s.bx === s.ax).length;
  check('west frontier walled before Falador streams in', edge >= 250, `edge segs ${edge}`);
  w3.addRegion(fj); w3.addRegion(pj);
  const left = w3.segs.filter(s => s.frontier && s.ax === 3072 - w3.base[0] && s.bx === s.ax && s.az >= 3136 - w3.base[1] && s.az < 3392 - w3.base[1]).length;
  check('west frontier gone once Falador + Port Sarim load', left === 0, `left ${left}`);
}

// on foot: SPACE hops, and you land back on your feet
{
  const sk = new Skater(w); const [x, z] = L(3222.5, 3230.5); sk.reset(x, z, 0); sk.toggleWalk();
  let peak = 0; const g0 = w.height(sk.x, sk.z);
  run(sk, 1.2, (t, s) => { peak = Math.max(peak, s.y - g0); return { push: true, jumpPressed: t < 0.01 }; });
  check('hop on foot', peak > 0.7 && sk.mode === 'walk' && !sk.footAir, `peak ${peak.toFixed(2)} ${where(sk)}`);
}


// ---- scoring can't be farmed: repeats halve, the multiplier caps, held grinds fade
{
  const sk = new Skater(w);
  for (let i = 0; i < 4; i++) sk.addCombo('Kickflip', 200);
  check('repeated trick halves each time', sk.comboPts === 200 + 100 + 50 + 25, 'pts=' + sk.comboPts);
  for (let i = 0; i < 30; i++) sk.addCombo('Trick' + i, 100);
  sk.mode = 'ground'; sk.comboTimer = 0; const ev = []; sk.tickCombo(0.01); ev.push(...sk.events);
  const b = ev.find(e => e.type === 'banked');
  check('combo multiplier caps at ' + P.multCap, b && b.total === Math.round((375 + 3000) * P.multCap), b && `total=${b.total} n=${b.n}`);
}
{
  // grind a rail forever (rail links looping a pen): points per second fade out after holdFull
  const r = w.rails.find(q => q.len > 4);
  const sk = new Skater(w); sk.reset(r.ax, r.az, Math.atan2(r.dirz, r.dirx));
  Object.assign(sk, { mode: 'grind', rail: r, railT: 1, railDir: 1, railSpeed: 0.6, railSide: 1, grindKind: '50-50', grindHeading: sk.heading, balance: 0, grindTime: 0, grindHold: 30, y: railTop(r, 1) });
  const p0 = sk.comboPts; run(sk, 1, (t, s) => ({ steer: Math.max(-1, Math.min(1, (s.balance || 0) * 4)) }));
  check('a 30 s grind pays almost nothing per second', sk.mode !== 'grind' || sk.comboPts - p0 < 160 * 0.02, `+${(sk.comboPts - p0).toFixed(1)}/s`);
}
// ---- pop height grows with speed (Skate 3), landing down a slope keeps the speed
{
  const sk = new Skater(w);
  sk.vx = 0; sk.vz = 0; const slow = sk.popVel(1); sk.vx = 6; const fast = sk.popVel(1);
  check('standing ollie pops lower than a rolling one', slow < fast && fast ** 2 / (2 * P.gravity) > 1.4, `slow h=${(slow ** 2 / 42).toFixed(2)} fast h=${(fast ** 2 / 42).toFixed(2)}`);
}
{
  // touch down on a slope moving downhill: the tangent part of the fall carries on
  let best = null;
  for (let x = 30; x < w.N - 30 && !best; x += 3) for (let z = 30; z < w.N - 30; z += 3) {
    if (!w.isLive(x, z) || w.tileKind(x + 0.5, z + 0.5) !== 0) continue;
    const g = (w.height(x + 0.7, z + 0.5) - w.height(x + 0.3, z + 0.5)) / 0.4;
    if (g < -0.35 && g > -0.8) { best = [x + 0.5, z + 0.5]; break; }
  }
  if (!best) check('a downhill slope to land on exists', false);
  else {
    const sk = new Skater(w); sk.reset(best[0], best[1], 0); sk.vx = 4; sk.vy = -6; sk.mode = 'air'; sk.y = w.height(best[0], best[1]) - 0.01;
    sk.land(6);
    check('landing down a slope keeps (gains) speed', sk.speed > 4.3 && sk.mode === 'ground', 'v=' + sk.speed.toFixed(2));
  }
}
// ---- members' land streams in like the rest: Ardougne opens once loaded
{
  const aj = JSON.parse(readFileSync(new URL('../assets/world_ardougne.json', import.meta.url)));
  const w4 = new World(JSON.parse(readFileSync(new URL('../assets/world.json', import.meta.url))));
  const at = [2662 - w4.base[0], 3305 - w4.base[1]];
  check('Ardougne closed before it streams in', !w4.isLive(at[0], at[1]));
  w4.addRegion(aj);
  check('Ardougne live once streamed in', w4.isLive(at[0], at[1]) && w4.rails.length > 0, `rails=${w4.rails.length}`);
  check('no door segments anywhere in Ardougne', !aj.segs.some(s => s[4] === 'door'));
}
// ---- bails are a ragdoll: the rider falls, lies down, comes to rest, gets up; knees only bend forward
{
  const sk = new Skater(w);
  sk.reset(w.spawn[0], w.spawn[1], Math.PI / 2); sk.vx = 0; sk.vz = 7; sk.bail('sketchy');
  const r = sk.rag; let t = 0, low = Infinity, kneeBack = 0;
  while (sk.mode === 'bail' && t < 8) {
    sk.step(1 / 60, {}); t += 1 / 60;
    if (!sk.rag) break;
    const p = sk.rag.p; low = Math.min(low, p[0][1] - w.height(p[0][0], p[0][2]));
    // chest forward (game space, see ragdoll.js) vs the knee's bend
    const up = [p[1][0] - p[2][0], p[1][1] - p[2][1], p[1][2] - p[2][2]], rt = [p[6][0] - p[3][0], p[6][1] - p[3][1], p[6][2] - p[3][2]];
    const f = [up[1] * rt[2] - up[2] * rt[1], up[2] * rt[0] - up[0] * rt[2], up[0] * rt[1] - up[1] * rt[0]], fl = Math.hypot(...f) || 1;
    for (const [a, m, c] of [[9, 10, 11], [12, 13, 14]]) {
      const off = [0, 1, 2].reduce((s, k) => s + (p[m][k] - (p[a][k] + p[c][k]) / 2) * f[k] / fl, 0);
      kneeBack = Math.min(kneeBack, off);
    }
  }
  check('a bail ragdoll ends up lying on the ground', low < 0.3, `head ${low.toFixed(2)} above ground`);
  check('the rider gets up on their own once still', sk.mode !== 'bail' && t < 4, `${t.toFixed(2)} s`);
  check('knees never bend backwards', kneeBack > -0.05, `worst ${kneeBack.toFixed(3)}`);
  check('a plain fall breaks no bones', r.broken.size === 0, [...r.broken].join(','));
  const s2 = new Skater(w);
  s2.reset(w.spawn[0], w.spawn[1], Math.PI / 2); s2.mode = 'air'; s2.y += 6; s2.vy = -8; s2.vz = 4; s2.bail('flip');                 // thrown off high up
  for (let i = 0; i < 120 && s2.rag; i++) s2.step(1 / 60, {});
  check('a big drop breaks bones (Hall of Meat)', s2.rag && s2.rag.broken.size > 0, s2.rag && [...s2.rag.broken].join(','));
}
// ---- the board is its own object: once it lands wheels-down it rolls on along its length, grips sideways,
// and sits tipped to the ground under its four wheels
{
  const flat = { height: () => 0, tileKind: () => 0, segsNear: () => [] };
  const sk = new Skater(w); sk.reset(w.spawn[0], w.spawn[1], 0); sk.bail('sketchy');
  sk.w = flat; sk.rag = null; sk.x = sk.z = 0; sk.y = 0; sk.vx = sk.vz = sk.vy = 0;
  const b = sk.board; Object.assign(b, { x: 0, z: 0, y: 0, vx: 4, vz: 4, vy: 0, yaw: 0, roll: 0, pitch: 0, spinR: 0, spinY: 0, spinP: 0 });
  for (let i = 0; i < 60; i++) sk.stepBail(1 / 60, {});
  check('a loose board rolls on along its length', b.vx > 2.5 && Math.abs(b.vz) < 0.2, `along ${b.vx.toFixed(2)} across ${b.vz.toFixed(2)}`);
  const slope = { height: (x) => x * 0.25 };
  const wc = wheelContact(slope, 0, 0, 0), wc2 = wheelContact(slope, 0, 0, Math.PI / 2);
  check('four-wheel contact tips the board to the slope', Math.abs(wc.pitch - Math.atan(0.25)) < 0.01 && Math.abs(wc2.roll + Math.atan(0.25)) < 0.01, `pitch ${wc.pitch.toFixed(3)} roll ${wc2.roll.toFixed(3)}`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
