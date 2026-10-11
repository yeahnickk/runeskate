// Bake out RuneScape's coplanar face stacks in the Castle Wars arena (assets/cw_arena.bin, in place). Run it after
// tools/cw-arena.py:   bun tools/cw-decals.ts
// The skate camera never sees them; CODScape's first-person one does (striped shimmer on floors and walls).
import { readFileSync, writeFileSync } from 'fs';
import { WORLD_SCALE as S } from '../src/mapdata.js';
const A = new URL('../assets/', import.meta.url).pathname;
const pack = JSON.parse(readFileSync(A + 'cw_arena.json', 'utf8')), file = readFileSync(A + 'cw_arena.bin');
const bin = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);

/**
 * RS stacks coplanar faces (rugs, floor patches, wall trim, a terrain tile under a floor model) in different
 * colours; from a skate camera that's invisible, from first person the depth buffer can't split them and they
 * shimmer in stripes. Find each such overlap and lift the smaller face a couple of int16 steps proud of the
 * bigger one, along the axis it faces (in place, before the meshes and the collider are built).
 */
function liftDecals(pack, bin) {
  const CH = pack.index.chunk, U = 1 / 128, need = 0.016;               // (16 mm clear: the depth buffer splits that at any range we fight at)
  const parts = [];
  for (const ch of pack.index.chunks) for (const k of ['terrain', 'locs']) { const pt = ch[k]; if (pt?.n) parts.push({ pos: new Int16Array(bin, pt.posOff, pt.n * 3), col: new Uint8Array(bin, pt.colOff, pt.n * 3), ox: ch.cx * CH * S, oz: -ch.cz * CH * S }); }
  let nt = 0; for (const p of parts) nt += p.pos.length / 9;
  const P = new Float32Array(nt * 9), Nn = new Float32Array(nt * 3), D = new Float32Array(nt), Ar = new Float32Array(nt), C = new Float32Array(nt * 3), ref = [];
  let t = 0;
  for (const p of parts) for (let i = 0; i < p.pos.length; i += 9, t++) {
    for (let j = 0; j < 3; j++) { P[t * 9 + j * 3] = p.ox + p.pos[i + j * 3] * S * U; P[t * 9 + j * 3 + 1] = -p.pos[i + j * 3 + 1] * U; P[t * 9 + j * 3 + 2] = p.oz - p.pos[i + j * 3 + 2] * S * U; }
    const o = t * 9, ax = P[o + 3] - P[o], ay = P[o + 4] - P[o + 1], az = P[o + 5] - P[o + 2], bx = P[o + 6] - P[o], by = P[o + 7] - P[o + 1], bz = P[o + 8] - P[o + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz);
    Ar[t] = l / 2; if (l > 1e-9) { nx /= l; ny /= l; nz /= l; }
    Nn[t * 3] = nx; Nn[t * 3 + 1] = ny; Nn[t * 3 + 2] = nz; D[t] = nx * P[o] + ny * P[o + 1] + nz * P[o + 2];
    for (let c = 0; c < 3; c++) C[t * 3 + c] = (p.col[i + c] + p.col[i + 3 + c] + p.col[i + 6 + c]) / 3;
    ref.push(p, i);
  }
  // bucket by plane (canonical normal, offset) and a coarse cell, so only near-coplanar neighbours are compared
  const canon = t => { const x = Nn[t * 3], y = Nn[t * 3 + 1], z = Nn[t * 3 + 2]; return (y > 1e-4 || (Math.abs(y) <= 1e-4 && (x > 1e-4 || (Math.abs(x) <= 1e-4 && z > 0)))) ? 1 : -1; };
  const B = new Map(), CELL = 3;
  for (let t = 0; t < nt; t++) {
    if (Ar[t] < 1e-6) continue;
    const sg = canon(t), q = [Math.round(Nn[t * 3] * sg * 24), Math.round(Nn[t * 3 + 1] * sg * 24), Math.round(Nn[t * 3 + 2] * sg * 24)], dk = Math.floor(D[t] * sg * 50);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let j = 0; j < 3; j++) { const x = P[t * 9 + j * 3], y = P[t * 9 + j * 3 + 1], z = P[t * 9 + j * 3 + 2]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
      for (const d of [dk, dk + 1]) { const key = `${q}|${d}|${cx},${cy},${cz}`; let a = B.get(key); if (!a) B.set(key, a = []); a.push(t); }   // (two bins: faces either side of a bin edge still meet)
    }
  }
  // 2D overlap on the plane's dominant axes: a vertex or the centroid of one strictly inside the other
  const axes = t => { const x = Math.abs(Nn[t * 3]), y = Math.abs(Nn[t * 3 + 1]), z = Math.abs(Nn[t * 3 + 2]); return x >= y && x >= z ? [1, 2] : y >= z ? [0, 2] : [0, 1]; };
  const inside = (t, px, py, [u, w]) => {
    const o = t * 9, e = 1e-4; let pos = false, neg = false;
    for (let j = 0; j < 3; j++) { const a = (j + 1) % 3, ax = P[o + j * 3 + u], ay = P[o + j * 3 + w], bx = P[o + a * 3 + u], by = P[o + a * 3 + w]; const c = (bx - ax) * (py - ay) - (by - ay) * (px - ax); if (c > e) pos = true; else if (c < -e) neg = true; else return false; }
    return !(pos && neg);
  };
  const overlap = (a, b) => {
    const ab = axes(a);
    for (const [s, o] of [[a, b], [b, a]]) {
      let cx = 0, cy = 0; for (let j = 0; j < 3; j++) { const px = P[s * 9 + j * 3 + ab[0]], py = P[s * 9 + j * 3 + ab[1]]; cx += px / 3; cy += py / 3; if (inside(o, px, py, ab)) return true; }
      if (inside(o, cx, cy, ab)) return true;
    }
    return false;
  };
  const lift = new Float32Array(nt), seen = new Set(), pairs = [];
  for (const list of B.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      let a = list[i], b = list[j]; if (Ar[a] > Ar[b]) [a, b] = [b, a];            // a: the smaller face, the decal
      const k = a * nt + b; if (seen.has(k)) continue; seen.add(k);
      const sa = canon(a), sb = canon(b); if (Math.abs(D[a] * sa - D[b] * sb) > need) continue;
      if (Math.max(Math.abs(C[a * 3] - C[b * 3]), Math.abs(C[a * 3 + 1] - C[b * 3 + 1]), Math.abs(C[a * 3 + 2] - C[b * 3 + 2])) < 10) continue;   // (same colour: a fight nobody can see)
      if (!overlap(a, b)) continue;
      const ahead = (D[a] - (Nn[a * 3] * P[b * 9] + Nn[a * 3 + 1] * P[b * 9 + 1] + Nn[a * 3 + 2] * P[b * 9 + 2]));   // how far a already sits in front of b's plane, along a's normal
      pairs.push(a, b, ahead);
    }
  }
  // biggest faces first, so a decal on a decal stacks over the one it sits on (lift accumulates up the stack)
  const ord = []; for (let i = 0; i < pairs.length; i += 3) ord.push(i);
  ord.sort((i, j) => Ar[pairs[j + 1]] - Ar[pairs[i + 1]]);
  for (const i of ord) { const a = pairs[i], b = pairs[i + 1]; lift[a] = Math.max(lift[a], lift[b] + need - pairs[i + 2]); }
  // move each lifted face along its dominant axis (int16 steps), toward the side it faces
  let n = 0;
  for (let t = 0; t < nt; t++) {
    if (!(lift[t] > 0.002)) continue;                                  // (already clear enough)
    const x = Nn[t * 3], y = Nn[t * 3 + 1], z = Nn[t * 3 + 2], ax = Math.abs(x) >= Math.abs(y) && Math.abs(x) >= Math.abs(z) ? 0 : Math.abs(y) >= Math.abs(z) ? 1 : 2;
    const comp = [x, y, z][ax], unit = (ax === 1 ? U : S * U) * Math.abs(comp), steps = Math.min(8, Math.ceil(lift[t] / unit));
    const dirW = Math.sign(comp), dirI = ax === 0 ? dirW : -dirW;                    // (int y and z run opposite to world up / three z)
    const p = ref[t * 2], i = ref[t * 2 + 1];
    for (let j = 0; j < 3; j++) p.pos[i + j * 3 + ax] += dirI * steps;
    n++;
  }
  return n;
}


// a lift can bring a face within reach of another layer: repeat until it settles
for (let pass = 1; pass <= 6; pass++) { const n = liftDecals(pack, bin); console.log(`pass ${pass}: lifted ${n} faces`); if (n < 10) break; }
writeFileSync(A + 'cw_arena.bin', new Uint8Array(bin));
