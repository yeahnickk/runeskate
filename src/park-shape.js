// Create-a-Park objects, the part the server and the client share: what can be placed and which tiles it
// covers. Objects sit on the tile grid (world tiles), lined up with the four compass directions.
//   rail:   a round metal rail, 1 tile wide              ledge: a concrete box, both top edges grind
//   kicker: a wooden launch ramp, 2 tiles wide, rising along dir
import { PORTAL_HOME, PORTAL_DESTS } from './mapdata.js';

export const PARK_KINDS = {
  rail: { min: 2, max: 8, wide: 1, h: 0.38, label: 'Rail' },
  ledge: { min: 2, max: 8, wide: 1, h: 0.32, label: 'Ledge' },
  kicker: { min: 2, max: 3, wide: 2, h: 0.55, label: 'Kicker' },
};
export const PARK_PER = 12, PARK_MAX = 600;
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** the world tiles an object covers */
export function footprint(o) {
  const K = PARK_KINDS[o.kind], [dx, dz] = DIRS[o.dir], sx = -dz, sz = dx, out = [];
  for (let i = 0; i < o.len; i++) for (let j = 0; j < K.wide; j++) out.push([o.x + dx * i + sx * j, o.z + dz * i + sz * j]);
  return out;
}

/** a clean object from untrusted input, or null. Keeps portals and the spawn clear */
export function cleanPark(o) {
  if (!o || typeof o !== 'object' || !PARK_KINDS[o.kind]) return null;
  const K = PARK_KINDS[o.kind], x = Math.floor(+o.x), z = Math.floor(+o.z), dir = Math.floor(+o.dir), len = Math.floor(+o.len);
  if (!(x >= 1500 && x < 4500 && z >= 1500 && z < 5000) || !(dir >= 0 && dir < 4) || !(len >= K.min && len <= K.max)) return null;
  const c = { kind: o.kind, x, z, dir, len };
  const keep = [PORTAL_HOME.at, ...PORTAL_DESTS.flatMap(d => [d.pad, d.back])];
  for (const [tx, tz] of footprint(c)) if (keep.some(([px, pz]) => Math.abs(tx - px) <= 3 && Math.abs(tz - pz) <= 3)) return null;
  return c;
}
