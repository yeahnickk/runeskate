// Bake a CartScape track out of the core world pack.   bun tools/cart-track.ts [track=lumbridge]
// Out: assets/<pack>.track.json (the baked road: centre line, heights, flags, features; read by the race sim and the
// client) and assets/<pack>.json/.bin (the chunks round the track, the same format as a world pack, cx/cz kept so
// game units line up). On the way the road is made perfect: every scenery triangle on it (fences, trees, a cart,
// the old bridge's railings) comes out, and the ground is dug down under it with a cut bank either side.
import { readFileSync, writeFileSync } from 'fs';
import { World } from '../src/world.js';
import { TRACKS, bakeTrack, Track, S } from '../src/cart/track.js';

const id = process.argv[2] || 'lumbridge', def = TRACKS[id];
const A = new URL('../assets/', import.meta.url).pathname;
const pack = JSON.parse(readFileSync(A + 'world.json', 'utf8')), bin = readFileSync(A + 'world.bin');
const world = new World(pack, { scale: S });
const water = (gx, gz) => { const tx = Math.floor(gx / S), tz = Math.floor(gz / S); return world.blocked[tz * world.N + tx] === 2; };
const baked = bakeTrack(def, (x, z) => world.height(x, z), water);
const T = new Track(baked), hw = T.hw, VERGE = hw + 5.8;   // (karts stop at hw + 3.6, their bodies reach hw + 4.8; the fence stands at hw + 4.95)
writeFileSync(A + def.pack + '.track.json', JSON.stringify(baked));
console.log(`${def.name}: lap ${baked.L.toFixed(0)} units, ${baked.N} samples, y ${Math.min(...baked.y).toFixed(1)}..${Math.max(...baked.y).toFixed(1)}`);
let maxSlope = 0; for (let i = 0; i < T.N; i++) if (!(T.flags[i] & 4)) maxSlope = Math.max(maxSlope, Math.abs(T.y[(i + 1) % T.N] - T.y[i]) / T.ds);
console.log('steepest grade (ramps aside)', (maxSlope * 100).toFixed(1) + '%', 'features', baked.feats.map(f => f.k + '@' + f.s.toFixed(0)).join(' '));

const CH = pack.index.chunk, KEEP = 110, LOCS = +(process.env.LOCS || 80);   // chunks with any of the road within KEEP units come along; scenery past LOCS from the road stays behind (the ground still comes: a far hill reads fine without its bushes)
const out: Buffer[] = []; let off = 0; const chunks = [];
let cut = 0, dug = 0, kept = 0;
for (const ch of pack.index.chunks) {
  const x0 = ch.cx * CH * S, z0 = ch.cz * CH * S, x1 = x0 + CH * S, z1 = z0 + CH * S;
  const near = [], wide = [];                                   // samples close enough to matter to this chunk (to dig / clear, to keep scenery)
  let dmin = Infinity;
  for (let i = 0; i < T.N; i++) {
    const dx = Math.max(x0 - T.x[i], 0, T.x[i] - x1), dz = Math.max(z0 - T.z[i], 0, T.z[i] - z1), d = Math.hypot(dx, dz);
    dmin = Math.min(dmin, d); if (d < hw + 30) near.push(i); if (d < LOCS + 4) wide.push(i);
  }
  if (dmin > KEEP) continue;
  // where a point sits relative to the road: { d: off the centre line, y: the road there, f: flags } (or null: far)
  const rel = (gx, gz) => {
    let best = -1, bd = Infinity;
    for (const i of near) { const q = (gx - T.x[i]) ** 2 + (gz - T.z[i]) ** 2; if (q < bd) { bd = q; best = i; } }
    if (best < 0 || bd > (hw + 26) ** 2) return null;
    const d = Math.abs((gx - T.x[best]) * -T.tz[best] + (gz - T.z[best]) * T.tx[best]);
    return { d, y: T.g[best], f: T.flags[best] };
  };
  const c: any = { cx: ch.cx, cz: ch.cz };
  for (const k of ['terrain', 'locs', 'locs_alpha']) {
    const part = ch[k]; if (!part || !part.n) continue;
    const pos = new Int16Array(bin.buffer.slice(bin.byteOffset + part.posOff, bin.byteOffset + part.posOff + part.n * 6));
    const col = new Uint8Array(bin.buffer.slice(bin.byteOffset + part.colOff, bin.byteOffset + part.colOff + part.n * 3));
    const gx = (i: number) => x0 + pos[i * 3] * S / 128, gz = (i: number) => z0 + pos[i * 3 + 2] * S / 128, gy = (i: number) => -pos[i * 3 + 1] / 128;
    let P = pos, C = col, n = part.n;
    if (k === 'terrain') {
      // level it: flat at the road out past the fence (the verge is drivable grass, not a bank to sink into), then a
      // cut bank up to higher ground or a fill bank down to lower; never the river (it's the water). Ramps stand on it
      for (let i = 0; i < n; i++) {
        const r = rel(gx(i), gz(i)); if (!r || (r.f & 3)) continue;
        const flat = r.y - 0.12, out = Math.max(0, r.d - VERGE) * 0.55, y = gy(i);
        const want = y > flat + out ? flat + out : y < flat - out ? flat - out : y;
        if (want !== y) { P[i * 3 + 1] = -Math.round(want * 128); dug++; }
      }
    } else {
      // take out every triangle on the road or its verge (or hanging over it, low): nothing stands in the way
      const keep: number[] = [];
      for (let t = 0; t < n; t += 3) {
        let hit = false;
        for (let v = t; v < t + 3 && !hit; v++) { const r = rel(gx(v), gz(v)); if (r && r.d < VERGE - 0.4 && gy(v) < r.y + 16) hit = true; }
        if (!hit) { const cx = (gx(t) + gx(t + 1) + gx(t + 2)) / 3, cz = (gz(t) + gz(t + 1) + gz(t + 2)) / 3; let far = true; for (const i of wide) if ((cx - T.x[i]) ** 2 + (cz - T.z[i]) ** 2 < LOCS * LOCS) { far = false; break; } if (far) { cut++; continue; } }
        if (!hit) keep.push(t); else cut++;
      }
      P = new Int16Array(keep.length * 9); C = new Uint8Array(keep.length * 9);
      keep.forEach((t, j) => { P.set(pos.subarray(t * 3, t * 3 + 9), j * 9); C.set(col.subarray(t * 3, t * 3 + 9), j * 9); });
      n = keep.length * 3; kept += keep.length;
      if (!n) continue;
    }
    const pb = Buffer.from(P.buffer, P.byteOffset, n * 6), cb = Buffer.from(C.buffer, C.byteOffset, n * 3);
    c[k] = { n, posOff: off, colOff: off + pb.length }; out.push(pb, cb); off += pb.length + cb.length;
    const pad = (4 - off % 4) % 4; if (pad) { out.push(Buffer.alloc(pad)); off += pad; }   // (int16 views need even offsets)
  }
  chunks.push(c);
}
const o = { name: def.pack, title: def.name, baseX: pack.baseX, baseZ: pack.baseZ, index: { chunk: CH, chunks } };
writeFileSync(A + def.pack + '.json', JSON.stringify(o));
writeFileSync(A + def.pack + '.bin', Buffer.concat(out));
console.log(`${chunks.length} chunks, ${(off / 1e6).toFixed(1)} MB; ${cut} triangles off the road, ${kept} kept; ${dug} ground vertices dug`);
