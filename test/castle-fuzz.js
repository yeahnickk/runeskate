// Bodies wandering the castles (random steering, sprint, crouch, slides, jumps): a frame that pops a body up or down
// more than a step while it stays on the ground, carries it through solid geometry, or leaves it boxed in, is a glitch.   bun test/castle-fuzz.js
import { readFileSync } from 'fs';
import * as THREE from 'three';
import { Arena } from '../src/cod/arena.js';
import { Body, MOVE } from '../src/cod/body.js';
const R = new URL('../assets/', import.meta.url).pathname;
const a = new Arena(JSON.parse(readFileSync(R + 'cw_arena.json', 'utf8')), readFileSync(R + 'cw_arena.bin').buffer);
a.buildNav();
const N = a.nav.nodes, inCastle = n => n.ok && (a.inBounds && ((n.x / 1.5 + a.base[0] > 2410 && -n.z / 1.5 + a.base[1] < 3092) || (n.x / 1.5 + a.base[0] < 2390 && -n.z / 1.5 + a.base[1] > 3116)));
const starts = N.map((n, i) => i).filter(i => inCastle(N[i]));
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
let pops = 0, walls = 0, boxed = 0, frames = 0; const where = [];
const T = p => `${(p.x / 1.5 + a.base[0] - 0.5).toFixed(1)},${(-p.z / 1.5 + a.base[1] - 0.5).toFixed(1)} y${p.y.toFixed(2)}`;
const dir = new THREE.Vector3();
for (let run = 0; run < 160; run++) {
  const s = N[starts[Math.floor(rnd() * starts.length)]], b = new Body(new THREE.Vector3(s.x, s.y, s.z));
  let inp = {};
  for (let f = 0; f < 600; f++) {
    if (f % 40 === 0) { b.yaw = rnd() * Math.PI * 2; inp = { x: rnd() < 0.3 ? (rnd() - 0.5) * 2 : 0, z: rnd() < 0.85 ? 1 : -1, sprint: rnd() < 0.5, crouch: rnd() < 0.15 }; }
    const one = { ...inp, jump: rnd() < 0.03, crouchEdge: rnd() < 0.01 };   // (plenty of jumps: a jump into a crate stack used to land you inside it)
    const p0 = b.pos.clone(), g0 = b.onGround;
    b.update(1 / 60, one, a); frames++;
    const dy = b.pos.y - p0.y;
    // boxed in: something just over your head and walls all round at knee height (inside a crate)
    if (b.onGround && f % 10 === 0) {
      let walls = 0; for (let k = 0; k < 8; k++) { const t = k / 8 * Math.PI * 2; if (a.ray(new THREE.Vector3(b.pos.x, b.pos.y + 0.4, b.pos.z), dir.set(Math.cos(t), 0, Math.sin(t)), 0.8)) walls++; }
      if (walls >= 7 && a.ray(new THREE.Vector3(b.pos.x, b.pos.y + 0.1, b.pos.z), dir.set(0, 1, 0), 1.3)) { boxed++; if (where.length < 12) where.push(`boxed in at ${T(b.pos)}`); }
    }
    if (g0 && b.onGround && Math.abs(dy) > MOVE.step + 0.05) { pops++; if (where.length < 12) where.push(`pop ${dy.toFixed(2)} at ${T(p0)}`); }
    // through a wall: the straight line at knee and chest height from the old spot to the new one is blocked
    const L = Math.hypot(b.pos.x - p0.x, b.pos.z - p0.z);
    if (L > 0.02) for (const h of [0.8, 1.0]) {                         // (over step height, under a crouch: a body steps over a low rail, and under a low ceiling it crouches)
      const o = new THREE.Vector3(p0.x, Math.max(p0.y, b.pos.y) + h, p0.z); dir.set(b.pos.x - p0.x, 0, b.pos.z - p0.z).normalize();
      const hit = a.ray(o, dir, L);
      if (hit && hit.normal.y < 0.5) { walls++;                  // (a ramp ahead is ground, not a wall)
        if (where.length < 12) where.push(`wall at ${T(p0)} -> ${T(b.pos)} (hit ${hit.distance.toFixed(2)} of ${L.toFixed(2)}, n ${hit.normal.x.toFixed(2)},${hit.normal.y.toFixed(2)},${hit.normal.z.toFixed(2)})`); break; }
    }
  }
}
console.log(`${frames} frames: ${pops} pops, ${walls} through-wall moves, ${boxed} boxed in`); for (const w of where) console.log('  ' + w);
process.exit(pops + walls + boxed ? 1 : 0);
