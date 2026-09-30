// Which blocking map objects are "tiny" (stumps, flowers, fungus, mushrooms...)? build.py lets you skate
// straight over the tiles they block.   bun --preload ./headless/preload.ts runeskate/tools/small-locs.ts [--stats]
import * as fs from 'fs';
import * as path from 'path';
import { loadConfigs } from '../../headless/src/ConfigLoader.js';
import LocType from '#/config/LocType.js';
await loadConfigs('https://rs-sdk-demo.fly.dev');
const X0 = 2880, Z0 = 3072, N = 896;
export const TINY = /stump|flower|fung|mushroom|daisies|daffodil|tulip|rose|weed|fern|thistle|grass|shoot|sapling|plant|root|toadstool|pot plant|lily|reeds?$|bullrush|dead tree/i;
const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'headless', 'static-locs.json'), 'utf8'));
const names = new Map<string, number>(), tiles: number[][] = [], hit = new Map<string, number>();
for (const [level, x, z, id, shape, rot] of raw.locs as number[][]) {
  if (level !== 0 || x < X0 || z < Z0 || x >= X0 + N || z >= Z0 + N) continue;
  if (shape !== 10 && shape !== 11 && shape !== 22) continue;
  let t: any; try { t = LocType.list(id); } catch { continue; }
  if (!t || !t.blockwalk) continue;
  const nm = t.name || `#${id}`; names.set(nm, (names.get(nm) || 0) + 1);
  if (!TINY.test(nm) || /^dead tree$|^huge/i.test(nm)) continue;   // dead trees and huge mushrooms are full height
  hit.set(nm, (hit.get(nm) || 0) + 1);
  const w = (rot & 1) ? t.length : t.width, l = (rot & 1) ? t.width : t.length;
  for (let a = 0; a < w; a++) for (let b = 0; b < l; b++) tiles.push([x + a - X0, z + b - Z0]);
}
if (process.argv.includes('--stats')) console.log([...names].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${c} ${n}`).join('\n'));
console.log('tiny:', [...hit].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(', '));
fs.writeFileSync(path.join(import.meta.dir, 'out', 'small-locs.json'), JSON.stringify({ tiles, names: [...hit.keys()] }));
console.log(tiles.length, 'tiles');
