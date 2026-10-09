// Offline glitch-spot check over the whole map (run after tools/split.py):
//   bun tools/pocket-check.ts
// Splits open ground into connected areas (a step is refused when it crosses a wall / fence / door / block /
// water segment), then checks every place the game drops a skater (spawn, portal exits, portal homes) is in
// the main area, so nobody lands somewhere they can't skate out of.
import { readFileSync } from 'fs';
import { World } from '../src/world.js';
import { PORTAL_HOME, PORTAL_DESTS } from '../src/mapdata.js';

const w = new World(JSON.parse(readFileSync(new URL('./out/world.full.json', import.meta.url), 'utf8')));
const N = w.N, SOLID = new Set(['wall', 'fence', 'door', 'block', 'water']);
const d = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
const cross = (ax: number, az: number, bx: number, bz: number, s: any) =>
  d(ax, az, bx, bz, s.ax, s.az) * d(ax, az, bx, bz, s.bx, s.bz) < 0 && d(s.ax, s.az, s.bx, s.bz, ax, az) * d(s.ax, s.az, s.bx, s.bz, bx, bz) < 0;
const blocked = (ax: number, az: number, bx: number, bz: number) => {
  for (const s of w.segsNear((ax + bx) / 2, (az + bz) / 2, 1)) if (SOLID.has(s.kind) && cross(ax, az, bx, bz, s)) return true;
  return false;
};
const comp = new Int32Array(N * N).fill(-1), sizes: number[] = [];
for (let i = 0; i < N * N; i++) {
  if (comp[i] >= 0 || w.tileKind((i % N) + 0.5, ((i / N) | 0) + 0.5) !== 0) continue;
  const id = sizes.length, q = [i]; comp[i] = id; let n = 0;
  while (q.length) {
    const j = q.pop()!, x = j % N, z = (j / N) | 0; n++;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, k = nz * N + nx;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N || comp[k] >= 0) continue;
      if (w.tileKind(nx + 0.5, nz + 0.5) !== 0 || blocked(x + 0.5, z + 0.5, nx + 0.5, nz + 0.5)) continue;
      comp[k] = id; q.push(k);
    }
  }
  sizes.push(n);
}
const at = (t: number[]) => comp[(t[1] - w.base[1]) * N + (t[0] - w.base[0])];
const areaOf = (t: number[]) => { const c = at(t); return c >= 0 ? sizes[c] : 0; };
const drops: [string, number[]][] = [['spawn', [Math.floor(w.spawn[0]) + w.base[0], Math.floor(w.spawn[1]) + w.base[1]]], ['home', PORTAL_HOME.at]];
for (const p of PORTAL_DESTS) drops.push([p.name + ' exit', p.at], [p.name + ' home portal', p.back]);
let bad = 0;
for (const [nm, t] of drops) {
  const a = areaOf(t), ok = a >= 2000;
  if (!ok) bad++;
  console.log(`${ok ? 'OK ' : 'BAD'} ${nm.padEnd(28)} ${t}  area ${a} tiles`);
}
const big = sizes.filter(s => s >= 2000).length, small = sizes.filter(s => s < 2000);
console.log(`${sizes.length} areas: ${big} big, ${small.length} small (largest small ${Math.max(0, ...small)} tiles)`);
process.exit(bad ? 1 : 0);
