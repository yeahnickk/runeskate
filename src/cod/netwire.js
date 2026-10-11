// CODScape online, the wire both ends share: weapons travel as their key, vectors as rounded [x, y, z].
// Plain JS (serve.ts runs it too).
import { WEAPONS } from './weapons.js';

export const WKEY = new Map(Object.entries(WEAPONS).map(([k, w]) => [w, k]));
export const ZONES = ['head', 'chest', 'stomach', 'limb'];
const r = x => Math.round(x * 1000) / 1000;
export const R3 = v => [r(v.x), r(v.y), r(v.z)];
/** a weapon (or a blast / the knife: { name, cls }) -> the wire, and back */
export const wireW = w => !w ? null : WKEY.has(w) ? { k: WKEY.get(w) } : { n: w.name, c: w.cls };
export const unwireW = x => !x ? null : x.k ? WEAPONS[x.k] : { name: x.n, cls: x.c };
