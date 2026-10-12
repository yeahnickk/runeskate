// Bodies scrambling round the supply tables (where everyone runs for ammo): random steering, jumps, crouches and
// slides in every direction. A body that wants to move but can't go ANY way for a second is stuck.   bun test/supply-fuzz.js
import { readFileSync } from 'fs';
import * as THREE from 'three';
import { Arena } from '../src/cod/arena.js';
import { Body } from '../src/cod/body.js';
import { Game } from '../src/cod/game.js';
const R = new URL('../assets/', import.meta.url).pathname;
const a = new Arena(JSON.parse(readFileSync(R + 'cw_arena.json', 'utf8')), readFileSync(R + 'cw_arena.bin').buffer);
a.buildNav();
const g = new Game(a, { mode: 'tdm', difficulty: 'recruit', perTeam: 1, playerTeam: 'sara', loadout: { primary: 'm4a1', secondary: 'm1911', lethal: 'frag' } });
const N = a.nav.nodes;
let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const T = p => `${(p.x / 1.5 + a.base[0] - 0.5).toFixed(1)},${(-p.z / 1.5 + a.base[1] - 0.5).toFixed(1)} y${p.y.toFixed(2)}`;
/** can it get anywhere at all? a short step each of 8 ways, from a copy */
const trapped = b => { for (let k = 0; k < 8; k++) { const c = new Body(b.pos.clone()); c.onGround = true; c.yaw = k / 8 * Math.PI * 2; for (let f = 0; f < 20; f++) c.update(1 / 60, { z: 1 }, a); if (Math.hypot(c.pos.x - b.pos.x, c.pos.z - b.pos.z) > 0.25) return false; } return true; };
let stuck = 0, runs = 0; const where = [];
for (const s of g.supplies) {
  const near = N.filter(n => n.ok && Math.abs(n.y - s.p.y) < 1.5 && Math.hypot(n.x - s.p.x, n.z - s.p.z) < 7);
  for (let run = 0; run < 60; run++) {
    runs++;
    const n = near[Math.floor(rnd() * near.length)], b = new Body(new THREE.Vector3(n.x, n.y, n.z));
    let inp = {}, still = 0;
    for (let f = 0; f < 720; f++) {
      if (f % 30 === 0) {
        // mostly at the table (that's where you go for ammo), sometimes anywhere
        const tx = s.p.x + (rnd() - 0.5) * 2, tz = s.p.z + (rnd() - 0.5) * 2;
        b.yaw = rnd() < 0.6 ? Math.atan2(-(tx - b.pos.x), -(tz - b.pos.z)) : rnd() * Math.PI * 2;
        inp = { x: rnd() < 0.3 ? (rnd() - 0.5) * 2 : 0, z: rnd() < 0.85 ? 1 : -1, sprint: rnd() < 0.5, crouch: rnd() < 0.15 };
      }
      const p0 = b.pos.clone();
      b.update(1 / 60, { ...inp, jump: rnd() < 0.04, crouchEdge: rnd() < 0.02 }, a);
      still = Math.hypot(b.pos.x - p0.x, b.pos.z - p0.z) < 0.002 ? still + 1 : 0;
      if (still === 60) { if (trapped(b)) { stuck++; if (where.length < 15) where.push(`stuck at ${T(b.pos)} (${s.team} table ${T(s.p)}) g${b.onGround} st${(b.stuckT || 0).toFixed(2)} tr${b.trapped(a)} c${b.crouch.toFixed(2)} in${JSON.stringify(inp)}`); break; } }
    }
  }
}
for (const w of where) console.log('  ' + w);
console.log(`${runs} runs round ${g.supplies.length} supply tables: ${stuck} stuck`);
console.log(stuck ? 'FAIL' : 'ALL PASS');
process.exit(stuck ? 1 : 0);
