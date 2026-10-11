// CODScape headless checks: the guns' numbers, the gunner's timelines, and whole bot matches in the real
// Castle Wars arena (no browser).   bun test/cod.js
import { readFileSync } from 'fs';
import { Arena } from '../src/cod/arena.js';
import { Game, MODES } from '../src/cod/game.js';
import { WEAPONS, ttk, damageAt } from '../src/cod/weapons.js';
import { Gunner } from '../src/cod/gunner.js';

let fails = 0;
const check = (ok, name, info = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; };

// ---- the guns: COD-shaped time-to-kill
const t = id => ttk(WEAPONS[id], 8);
check(t('intervention').shots === 1, 'sniper: one shot to the chest');
check(ttk(WEAPONS.intervention, 30, 'limb').shots === 2, 'sniper: a leg shot does not kill');
check(t('m4a1').shots === 4 && t('ak47').shots === 3, 'AR: M4 4 shots, AK 3 up close', `m4 ${t('m4a1').shots} ak ${t('ak47').shots}`);
check(ttk(WEAPONS.mp5, 40).shots > ttk(WEAPONS.m4a1, 40).shots, 'SMG loses to an AR at range', `mp5 ${ttk(WEAPONS.mp5, 40).shots} m4 ${ttk(WEAPONS.m4a1, 40).shots}`);
check(ttk(WEAPONS.mp7, 5).time < ttk(WEAPONS.m4a1, 5).time, 'SMG beats an AR up close', `mp7 ${ttk(WEAPONS.mp7, 5).time.toFixed(3)} m4 ${ttk(WEAPONS.m4a1, 5).time.toFixed(3)}`);
check(ttk(WEAPONS.r870, 4).shots === 1 && ttk(WEAPONS.r870, 20).shots > 2, 'shotgun: one pump close, useless far');
check(damageAt(WEAPONS.m4a1, 5, 'head') > damageAt(WEAPONS.m4a1, 5, 'chest'), 'headshots hurt more');

// ---- the gunner
{
  const g = new Gunner({ primary: 'm4a1', secondary: 'm1911', lethal: 'frag' });
  let shots = 0, tm = 0;
  for (; tm < 3; tm += 1 / 120) for (const e of g.update(1 / 120, { fire: true })) if (e.t === 'shot') shots++;
  check(shots === 30, 'M4: a mag empties then the reload starts', `${shots} shots, phase ${g.phase}`);
  for (let i = 0; i < 400; i++) g.update(1 / 120, {});
  check(g.g.ammo === 30 && g.g.reserve === 120, 'reload refills from reserve', `${g.g.ammo}/${g.g.reserve}`);
  const b = new Gunner({ primary: 'intervention', secondary: 'm1911', lethal: 'frag' });
  let n = 0; for (let i = 0; i < 120; i++) for (const e of b.update(1 / 120, { fire: i % 2 === 0 })) if (e.t === 'shot') n++;
  check(n === 1, 'bolt action: one shot per cycle', `${n} in 1 s`);
  const s = new Gunner({ primary: 'r870', secondary: 'm1911', lethal: 'frag' });
  for (let i = 0; i < 60; i++) s.update(1 / 60, {});
  s.g.ammo = 2; s.update(1 / 60, { reload: true }); let shells = 0;
  for (let i = 0; i < 600; i++) for (const e of s.update(1 / 60, {})) if (e === 'shell') shells++;
  check(shells === 4 && s.g.ammo === 6, 'shotgun loads a shell at a time', `${shells} shells -> ${s.g.ammo}`);
  const f = new Gunner({ primary: 'famas', secondary: 'm1911', lethal: 'frag' });
  for (let i = 0; i < 60; i++) f.update(1 / 120, {});
  let fs = 0; for (let i = 0; i < 60; i++) for (const e of f.update(1 / 120, { fire: i === 0 })) if (e.t === 'shot') fs++;
  check(fs === 3, 'FAMAS: one pull, three rounds', `${fs}`);
}

// ---- whole matches, bots only
const R = new URL('../assets/', import.meta.url).pathname;
const arena = new Arena(JSON.parse(readFileSync(R + 'cw_arena.json', 'utf8')), readFileSync(R + 'cw_arena.bin').buffer);
let t0 = performance.now(); arena.buildNav();
check(arena.nav.nodes.filter(n => n.ok).length > 10000, 'nav: the arena is walkable', `${arena.nav.nodes.filter(n => n.ok).length} nodes, ${(performance.now() - t0) | 0} ms`);
for (const [mode, secs, diff] of [['tdm', 150, 'veteran'], ['ctf', 240, 'hardened'], ['ffa', 90, 'regular']]) {
  const g = new Game(arena, { mode, difficulty: diff, perTeam: 5, spectate: true });
  const dt = 1 / 30; t0 = performance.now();
  let kills = 0, caps = 0, taken = 0, nan = false, outside = 0;
  for (let i = 0; i < secs / dt && !g.over; i++) {
    g.step(dt);
    for (const e of g.events) { if (e.t === 'kill') kills++; if (e.t === 'flag' && e.what === 'captured') caps++; if (e.t === 'flag' && e.what === 'taken') taken++; }
    g.events.length = 0;
    for (const f of g.fighters) { if (!Number.isFinite(f.body.pos.x + f.body.pos.y + f.body.pos.z)) nan = true; if (f.alive && !arena.inBounds(f.body.pos.x, f.body.pos.z, -0.5)) outside++; }
  }
  const ms = performance.now() - t0;
  check(!nan && outside === 0, `${mode}: everyone stays in the arena`, outside ? `${outside} frames outside` : '');
  check(kills >= (mode === 'ctf' ? 5 : 10), `${mode} (${diff}): the bots fight`, `${kills} kills in ${g.t.toFixed(0)} s, ${(ms / (g.t / dt)).toFixed(2)} ms/frame, score ${JSON.stringify(g.score)}`);
  if (mode === 'ctf') check(taken > 0, 'ctf: the bots go for the flag', `${taken} taken, ${caps} captured`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
