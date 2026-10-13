// Rune League's real RS models (tools/league-models.ts cut them from the 2004 cache, lit as the client lights them):
// the cabbage, the patch's fence, stone walls, hay, flags and standards, benches, torches, the potions and essence.
// meshOf(key) gives a Mesh in RS units (128 a tile, y up), flat-coloured like the world; tint swaps the model's
// strong colours (a flag's cloth) for a team's, keeping RS's shading.
import * as THREE from 'three';

let DATA = null;
export async function loadModels() { DATA ??= await fetch('assets/league_models.json').then(r => r.json()); return DATA; }
const GEO = new Map();
const hsl = { h: 0, s: 0, l: 0 }, tmp = new THREE.Color();
function geoOf(key, tint) {
  const id = key + (tint ?? ''); if (GEO.has(id)) return GEO.get(id);
  const d = DATA[key]; if (!d) throw new Error('no RS model ' + key);
  const c = new Float32Array(d.c.length), tc = tint != null ? new THREE.Color(tint).getHSL({}) : null;
  for (let i = 0; i < c.length; i += 3) {
    tmp.setRGB(d.c[i] / 255, d.c[i + 1] / 255, d.c[i + 2] / 255);
    if (tc) { tmp.getHSL(hsl); if (hsl.s > 0.3 && !(hsl.h > 0.03 && hsl.h < 0.17)) tmp.setHSL(tc.h, Math.max(hsl.s, tc.s * 0.85), hsl.l); }   // (cloth, not wood)
    c[i] = tmp.r; c[i + 1] = tmp.g; c[i + 2] = tmp.b;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(d.p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.computeBoundingSphere(); GEO.set(id, g); return g;
}
const MAT = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
export const rsMat = MAT;
/** a Mesh of RS model `key` (RS units); scale it to taste */
export function meshOf(key, tint) { return new THREE.Mesh(geoOf(key, tint), MAT); }
/** many copies merged into one mesh: list of [key, matrix] (fences round a whole stadium in one draw) */
export function merged(list, tint) {
  const P = [], C = []; const v = new THREE.Vector3();
  for (const [key, m] of list) { const g = geoOf(key, tint), p = g.attributes.position.array, c = g.attributes.color.array; for (let i = 0; i < p.length; i += 3) { v.set(p[i], p[i + 1], p[i + 2]).applyMatrix4(m); P.push(v.x, v.y, v.z); C.push(c[i], c[i + 1], c[i + 2]); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  return new THREE.Mesh(g, MAT);
}
export const modelKeys = () => Object.keys(DATA || {});
