// Offline check that every challenge spot is on open ground reachable from spawn.
//   bun runeskate/tools/spot-check.ts
// Flood-fills open tiles from spawn; a step between two tile centres is refused when it crosses a
// wall / fence / door / block / water segment (rails and ledge edges can be ollied, so they pass).
import { readFileSync } from 'fs';
import { World } from '../src/world.js';
import { SPOTS_ALL as SPOTS } from '../src/spots.js';

const w = new World(JSON.parse(readFileSync(new URL('../assets/world.json', import.meta.url), 'utf8')));
const N = w.N, SOLID = new Set(['wall', 'fence', 'door', 'block', 'water']);
const cross = (ax: number, az: number, bx: number, bz: number, s: any) => {
  const d = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = d(ax, az, bx, bz, s.ax, s.az), d2 = d(ax, az, bx, bz, s.bx, s.bz), d3 = d(s.ax, s.az, s.bx, s.bz, ax, az), d4 = d(s.ax, s.az, s.bx, s.bz, bx, bz);
  return d1 * d2 < 0 && d3 * d4 < 0;
};
const blocked = (ax: number, az: number, bx: number, bz: number) => {
  for (const s of w.segsNear((ax + bx) / 2, (az + bz) / 2, 1)) if (SOLID.has(s.kind) && cross(ax, az, bx, bz, s)) return true;
  return false;
};
const seen = new Uint8Array(N * N);
const sx = Math.floor(w.spawn[0]), sz = Math.floor(w.spawn[1]);
const q = [[sx, sz]]; seen[sz * N + sx] = 1;
while (q.length) {
  const [x, z] = q.pop()!;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, nz = z + dz;
    if (nx < 0 || nz < 0 || nx >= N || nz >= N || seen[nz * N + nx]) continue;
    if (w.tileKind(nx + 0.5, nz + 0.5) !== 0 || blocked(x + 0.5, z + 0.5, nx + 0.5, nz + 0.5)) continue;
    seen[nz * N + nx] = 1; q.push([nx, nz]);
  }
}
export const reachable = (x: number, z: number) => x >= 0 && z >= 0 && x < N && z < N && !!seen[Math.floor(z) * N + Math.floor(x)];
let bad = 0;
const ids = new Set<string>();
for (const sp of SPOTS) {
  if (ids.has(sp.id)) { console.log('DUPLICATE id', sp.id); bad++; }
  ids.add(sp.id);
  const x = sp.at[0] - w.base[0] + 0.5, z = sp.at[1] - w.base[1] + 0.5;
  // nearest reachable tile within 7
  let best: number[] | null = null;
  for (let r = 0; r <= 7 && !best; r++) for (let dx = -r; dx <= r && !best; dx++) for (let dz = -r; dz <= r; dz++)
    if (reachable(x + dx, z + dz)) { best = [dx, dz]; break; }
  const rails = [...w.railsNear(x, z, 12)].length;
  const ok = !!best;
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'BAD '} ${sp.id.padEnd(12)} ${sp.kind.padEnd(8)} at ${sp.at}  snap ${best ? best.join(',') : '-'}  rails<12: ${rails}`);
}
console.log(`${SPOTS.length} spots, ${bad} bad`);
process.exit(bad ? 1 : 0);
