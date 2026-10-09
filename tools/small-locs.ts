// Which blocking map objects are "tiny" (stumps, flowers, fungus, mushrooms...)? build.py lets you skate
// straight over the tiles they block. Also lists every TREE tile (build.py shrinks those to the trunk).
//   bun --preload ./tools/preload.ts tools/small-locs.ts [--stats]
import * as fs from 'fs';
import * as path from 'path';
import Packet from '#/io/Packet.js';
import JagFile from '#/io/JagFile.js';
import LocType from '#/config/LocType.js';
import { gunzipSync } from 'fflate';
import { opens } from './doors.ts';
const CACHE = path.join(import.meta.dir, 'cache');
const crcPkt = new Packet(new Uint8Array(fs.readFileSync(path.join(CACHE, 'crc'))));
const crc: number[] = []; for (let i = 0; i < 9; i++) crc[i] = crcPkt.g4();
LocType.init(new JagFile(new Uint8Array(fs.readFileSync(path.join(CACHE, `config${crc[2]}`)))));
// the exported square (tools/export-world.ts writes it to meta.json)
const META = JSON.parse(fs.readFileSync(path.join(import.meta.dir, 'out', 'meta.json'), 'utf8'));
const X0: number = META.baseX, Z0: number = META.baseZ, N: number = META.size;
export const TINY = /stump|flower|fung|mushroom|daisies|daffodil|tulip|rose|weed|fern|thistle|grass|shoot|sapling|plant|root|toadstool|pot plant|lily|reeds?$|bullrush|dead tree/i;
// every static map object (level, x, z, id, shape, rotation), decoded from the cache's map files
const raw = JSON.parse(new TextDecoder().decode(gunzipSync(new Uint8Array(fs.readFileSync(path.join(import.meta.dir, 'data', 'static-locs.json.gz'))))));
const names = new Map<string, number>(), tiles: number[][] = [], hit = new Map<string, number>();
// trees: build.py shrinks their collision to the measured trunk (only for these, never fences/walls/statues)
export const TREE = /tree|^oak$|willow|^yew$|maple|^magic|evergreen|palm|jungle|dead tree|^achey|^hollow/i;
const trees: number[][] = [], treeNames = new Map<string, number>();
// doors and gates (tools/doors.ts): the tile edges they close [x0, z0, x1, z1] and the tiles a shape-10 gate fills
const doorEdges: number[][] = [], doorTiles: number[][] = [];
// a straight wall on rotation 0..3 closes the tile's W, N, E, S edge; an L wall (shape 2) that edge and the next
const EDGE = (x: number, z: number, r: number) => [[x, z, x, z + 1], [x, z + 1, x + 1, z + 1], [x + 1, z, x + 1, z + 1], [x, z, x + 1, z]][r & 3];
for (const [level, x, z, id, shape, rot] of raw.locs as number[][]) {
  if (level !== 0 || x < X0 || z < Z0 || x >= X0 + N || z >= Z0 + N) continue;
  {
    let t: any; try { t = LocType.list(id); } catch { t = null; }
    if (t && opens(t, shape)) {
      const lx = x - X0, lz = z - Z0;
      if (shape === 0) doorEdges.push(EDGE(lx, lz, rot));
      else if (shape === 2) doorEdges.push(EDGE(lx, lz, rot), EDGE(lx, lz, rot + 1));
      else if (shape === 9) doorTiles.push([lx, lz]);
      else if (shape === 10 || shape === 11) {
        const w = (rot & 1) ? t.length : t.width, l = (rot & 1) ? t.width : t.length;
        for (let a = 0; a < w; a++) for (let b = 0; b < l; b++) doorTiles.push([lx + a, lz + b]);
      }
      continue;
    }
  }
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
fs.writeFileSync(path.join(import.meta.dir, 'out', 'small-locs.json'), JSON.stringify({ tiles, names: [...hit.keys()], trees, doorEdges, doorTiles }));
console.log('open doors/gates:', doorEdges.length, 'edges', doorTiles.length, 'tiles');
console.log(tiles.length, 'tiles;', trees.length, 'tree tiles:', [...treeNames].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(', '));
