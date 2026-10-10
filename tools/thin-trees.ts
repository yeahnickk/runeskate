// Thins out the forests a little so they can be skated through: in a dense clump of common trees, a
// hash-picked share is left out, models and collision both (tools/export-world.ts skips the model,
// tools/small-locs.ts hands the tiles to build.py as open ground). Lone trees, landmark trees and the skill
// trees (yew, magic, maple, willow) all stay. Deterministic: the same cache always thins the same trees.
import * as fs from 'fs';
import * as path from 'path';
import { gunzipSync } from 'fflate';

const COMMON = /^(tree|dead tree|oak|evergreen|tropical tree|leafy tree|jungle tree|palm|palm tree)$/i;
const R = 3;                       // neighbourhood (tiles, square) a clump is counted in
// share removed by how crowded the spot is (other common trees within R)
const share = (n: number) => n >= 8 ? 0.55 : n >= 5 ? 0.45 : n >= 3 ? 0.3 : 0;
const hash = (x: number, z: number) => { let h = (x * 374761393 + z * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/** keys "x,z,id" (world tile of the loc's origin) of the trees left out. LocType must be initialised. */
export function thinnedTrees(LocType: any): Set<string> {
  const raw = JSON.parse(new TextDecoder().decode(gunzipSync(new Uint8Array(fs.readFileSync(path.join(import.meta.dir, 'data', 'static-locs.json.gz'))))));
  const trees: [number, number, number][] = [];
  for (const [level, x, z, id, shape] of raw.locs as number[][]) {
    if (level !== 0 || (shape !== 10 && shape !== 11)) continue;
    let t: any; try { t = LocType.list(id); } catch { continue; }
    if (t?.blockwalk && COMMON.test(t.name || '')) trees.push([x, z, id]);
  }
  const at = new Set(trees.map(([x, z]) => x + ',' + z));
  const out = new Set<string>();
  for (const [x, z, id] of trees) {
    let n = 0;
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) if ((a || b) && at.has((x + a) + ',' + (z + b))) n++;
    if (hash(x, z) < share(n)) out.add(`${x},${z},${id}`);
  }
  return out;
}
