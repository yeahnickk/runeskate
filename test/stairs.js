// Every staircase in the Castle Wars arena, walked up and down by the same body the player has (no jumping:
// stairs have to work by walking), plus the river: wading out, and the stepping stones.   bun test/stairs.js
import { readFileSync } from 'fs';
import * as THREE from 'three';
import { Arena } from '../src/cod/arena.js';
import { Body } from '../src/cod/body.js';
const R = new URL('../assets/', import.meta.url).pathname;
const a = new Arena(JSON.parse(readFileSync(R + 'cw_arena.json', 'utf8')), readFileSync(R + 'cw_arena.bin').buffer);
a.buildNav();
const N = a.nav.nodes;
const T = p => `${(p.x / 1.5 + a.base[0] - 0.5).toFixed(1)},${(-p.z / 1.5 + a.base[1] - 0.5).toFixed(1)} y${p.y.toFixed(2)}`;
let fails = 0; const check = (ok, name, info = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; };

/** walk a body from node s to node g along the nav path, steering only (optionally no jumps) */
export function walk(s, g, { jump = false, limit = 40 } = {}) {
  const b = new Body(new THREE.Vector3(N[s].x, N[s].y, N[s].z));
  let p = a.path(s, g), i = 0, t = 0, stuck = 0, best = Infinity, replans = 0;
  while (t < limit && p) {
    if (i >= p.length) break;
    const k = a.lookahead(p, i, b.pos);
    const n = N[p[k]];
    if (Math.hypot(n.x - b.pos.x, n.z - b.pos.z) < 0.6 && Math.abs(n.y - b.pos.y) < 0.45) i = k + 1;
    b.yaw = Math.atan2(-(n.x - b.pos.x), -(n.z - b.pos.z));
    b.update(1 / 60, { x: 0, z: 1, jump: jump && stuck > 0.5 && b.onGround }, a);
    t += 1 / 60;
    const left = p.length - i; if (left < best) { best = left; stuck = 0; } else stuck += 1 / 60;
    if (stuck > 1.5 || (b.onGround && Math.abs(n.y - b.pos.y) > 1.3)) { p = a.path(a.nearestNode(b.pos.x, b.pos.y, b.pos.z), g); i = 0; best = Infinity; stuck = 0; if (++replans > 12) break; }
  }
  const ok = !!p && Math.hypot(b.pos.x - N[g].x, b.pos.z - N[g].z) < 1.2 && Math.abs(b.pos.y - N[g].y) < 0.5;
  return { ok, t, replans, at: T(b.pos), b };
}

// ---- find the staircases: runs of connected nodes climbing at least 1.2 with step-sized rises
const climb = new Map();                      // node -> [lowest reachable below, highest above] along steep edges
const steep = (A, B) => Math.abs(N[A].y - N[B].y) > 0.12 && Math.abs(N[A].y - N[B].y) <= 0.6;
const seen = new Set(), stairs = [];
N.forEach((n, i) => {
  if (!n.ok || seen.has(i) || !n.n.some(j => steep(i, j))) return;
  const comp = [], q = [i]; seen.add(i);
  while (q.length) { const k = q.pop(); comp.push(k); for (const j of N[k].n) if (!seen.has(j) && N[j].ok && steep(k, j)) { seen.add(j); q.push(j); } }
  // the flight's ends: the lowest and highest step that open onto a real floor (room around it, not a merlon
  // top or a sliver of river bank)
  const floorish = k => !N[k].water && N[k].n.filter(j => Math.abs(N[j].y - N[k].y) < 0.1).length >= 4;
  const ends = comp.filter(floorish); if (ends.length < 2) return;
  let lo = ends[0], hi = ends[0]; for (const k of ends) { if (N[k].y < N[lo].y) lo = k; if (N[k].y > N[hi].y) hi = k; }
  if (N[hi].y - N[lo].y >= 1.2 && comp.length >= 4) stairs.push({ lo, hi, n: comp.length });
});
console.log(stairs.length, 'staircases');
for (const s of stairs) {
  // step a little off each end onto flat ground, so the walk covers the whole flight
  const off = (k, dir) => { let best = k; for (const j of N[k].n) if (N[j].ok && Math.abs(N[j].y - N[k].y) < 0.1) best = j; return best; };
  const lo = off(s.lo), hi = off(s.hi);
  const up = walk(lo, hi), down = walk(hi, lo);
  check(up.ok && down.ok, `stairs ${T(N[s.lo])} -> ${T(N[s.hi])}`, `up ${up.ok ? up.t.toFixed(1) + 's' : 'stuck at ' + up.at} (${up.replans} replans), down ${down.ok ? down.t.toFixed(1) + 's' : 'stuck at ' + down.at} (${down.replans})`);
}
// ---- the river: wade in and out (never stuck), and every stepping stone can be stood on
{
  const water = N.map((n, i) => i).filter(i => N[i].ok && N[i].water);
  check(water.length > 50, 'the river is wadeable', `${water.length} river nodes`);
  let out = 0, tried = 0;
  for (let k = 0; k < water.length && tried < 12; k += Math.max(1, Math.floor(water.length / 12))) {
    tried++; const s = water[k], b = new Body(new THREE.Vector3(N[s].x, N[s].y, N[s].z));
    // find the nearest dry node and walk there
    let g = -1, gd = Infinity; N.forEach((n, i) => { if (n.ok && !n.water) { const d = Math.hypot(n.x - N[s].x, n.z - N[s].z) + Math.abs(n.y - N[s].y) * 2; if (d < gd) { gd = d; g = i; } } });
    if (walk(s, g).ok) out++;
  }
  check(out === tried, 'out of the river from anywhere', `${out}/${tried}`);
  const b = new Body(a.at(2420, 3104, 1)); b.pos.y = a.floor(b.pos.x, 5, b.pos.z); b.update(1 / 60, {}, a);
}
// ---- stepping stones: the rocks standing up out of the river. Stand on one and you're up on it, dry; hop to
// the next and you land on it
{
  const stones = [];
  for (const n of N) {
    if (!n.ok || n.water) continue;
    const g = a.ground(n.x, n.z); if (a.tileKind(n.x, n.z) !== 2 || n.y < g + 0.15 || n.y > g + 1.2) continue;   // a rock in the river, not a bridge deck
    stones.push(n);
  }
  let dry = 0;
  for (const st of stones) {
    const b = new Body(new THREE.Vector3(st.x, st.y + 0.3, st.z)); b.onGround = false;
    for (let i = 0; i < 40; i++) b.update(1 / 60, {}, a);
    if (b.onGround && !b.wading && Math.abs(b.pos.y - st.y) < 0.2) dry++;
  }
  check(stones.length >= 10 && dry >= stones.length * 0.9, 'stepping stones hold you up out of the water', `${dry}/${stones.length} stones`);
  // hop between neighbouring stones 1-2.2 apart
  let hops = 0, tries = 0;
  for (const A of stones) {
    const B = stones.find(o => o !== A && Math.hypot(o.x - A.x, o.z - A.z) > 1.0 && Math.hypot(o.x - A.x, o.z - A.z) < 2.2 && Math.abs(o.y - A.y) < 0.3);
    if (!B || tries >= 12) continue; tries++;
    const b = new Body(new THREE.Vector3(A.x, A.y, A.z)); b.yaw = Math.atan2(-(B.x - A.x), -(B.z - A.z));
    const gap = Math.hypot(B.x - A.x, B.z - A.z), pace = Math.min(1, gap / (0.62 * 6.0));   // a player times a hop: walk speed so the jump lands on it
    for (let i = 0; i < 90; i++) {
      const d = Math.hypot(B.x - b.pos.x, B.z - b.pos.z);
      b.update(1 / 60, { x: 0, z: b.onGround && i > 10 ? 0 : pace, jump: i === 2 }, a);
      if (b.onGround && i > 10) break;
    }
    if (Math.hypot(B.x - b.pos.x, B.z - b.pos.z) < 0.7 && !b.wading) hops++;
  }
  check(tries > 0 && hops >= tries * 0.75, 'hop from stone to stone', `${hops}/${tries} hops land dry`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
