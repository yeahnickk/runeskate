// Which blocking map objects are "tiny" (stumps, flowers, fungus, mushrooms...)? build.py lets you skate
// straight over the tiles they block. Also lists every TREE tile (build.py shrinks those to the trunk).
//   bun --preload ./tools/preload.ts tools/small-locs.ts [--stats]
import * as fs from 'fs';
import * as path from 'path';
import Packet from '#/io/Packet.js';
import JagFile from '#/io/JagFile.js';
import LocType from '#/config/LocType.js';
import { gunzipSync } from 'fflate';
const CACHE = path.join(import.meta.dir, 'cache');
const crcPkt = new Packet(new Uint8Array(fs.readFileSync(path.join(CACHE, 'crc'))));
const crc: number[] = []; for (let i = 0; i < 9; i++) crc[i] = crcPkt.g4();
LocType.init(new JagFile(new Uint8Array(fs.readFileSync(path.join(CACHE, `config${crc[2]}`)))));
const X0 = 2880, Z0 = 3072, N = 896;
export const TINY = /stump|flower|fung|mushroom|daisies|daffodil|tulip|rose|weed|fern|thistle|grass|shoot|sapling|plant|root|toadstool|pot plant|lily|reeds?$|bullrush|dead tree/i;
// every static map object (level, x, z, id, shape, rotation), decoded from the cache's map files
const raw = JSON.parse(new TextDecoder().decode(gunzipSync(new Uint8Array(fs.readFileSync(path.join(import.meta.dir, 'data', 'static-locs.json.gz'))))));
const names = new Map<string, number>(), tiles: number[][] = [], hit = new Map<string, number>();
// trees: build.py shrinks their collision to the measured trunk (only for these, never fences/walls/statues)
export const TREE = /tree|^oak$|willow|^yew$|maple|^magic|evergreen|palm|jungle|dead tree|^achey|^hollow/i;
const trees: number[][] = [], treeNames = new Map<string, number>();
for (const [level, x, z, id, shape, rot] of raw.locs as number[][]) {
  if (level !== 0 || x < X0 || z < Z0 || x >= X0 + N || z >= Z0 + N) continue;
  if (shape !== 10 && shape !== 11 && shape !== 22) continue;
  let t: any; try { t = LocType.list(id); } catch { continue; }
  if (!t || !t.blockwalk) continue;
  const nm = t.name || `#${id}`; names.set(nm, (names.get(nm) || 0) + 1);
  const w0 = (rot & 1) ? t.length : t.width, l0 = (rot & 1) ? t.width : t.length;
  if (TREE.test(nm) && !/stump|fallen|log|plant|flower/i.test(nm)) { treeNames.set(nm, (treeNames.get(nm) || 0) + 1); for (let a = 0; a < w0; a++) for (let b = 0; b < l0; b++) trees.push([x + a - X0, z + b - Z0]); }
  if (!TINY.test(nm) || /^dead tree$|^huge/i.test(nm)) continue;   // dead trees and huge mushrooms are full height
  hit.set(nm, (hit.get(nm) || 0) + 1);
  const w = (rot & 1) ? t.length : t.width, l = (rot & 1) ? t.width : t.length;
  for (let a = 0; a < w; a++) for (let b = 0; b < l; b++) tiles.push([x + a - X0, z + b - Z0]);
}
if (process.argv.includes('--stats')) console.log([...names].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${c} ${n}`).join('\n'));
console.log('tiny:', [...hit].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(', '));
fs.writeFileSync(path.join(import.meta.dir, 'out', 'small-locs.json'), JSON.stringify({ tiles, names: [...hit.keys()], trees }));
console.log(tiles.length, 'tiles;', trees.length, 'tree tiles:', [...treeNames].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(', '));
