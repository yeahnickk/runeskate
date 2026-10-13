// Bake Rune League's ground: the Lumbridge cabbage patch (north-west of the castle, by Fred's farm), cut out of the
// core world pack with the stadium let into it.   bun tools/league-arena.ts
// Out: assets/league_patch.json/.bin (the chunks round the patch, the world pack's format, cx/cz kept so game units
// line up) and assets/league_patch.site.json (where the pitch sits: centre, floor height, the scale from RL's uu).
// The ground under the stadium is levelled to the pitch and eased back out to the fields; every scenery triangle
// inside the stadium's footprint (the cabbages, the patch's fence) comes out, so nothing pokes through the pitch.
import { readFileSync, writeFileSync } from 'fs';
import { World } from '../src/world.js';
import { SITE, footprint } from '../src/league/site.js';

const A = new URL('../assets/', import.meta.url).pathname, S = SITE.S;
const pack = JSON.parse(readFileSync(A + 'world.json', 'utf8')), bin = readFileSync(A + 'world.bin');
const world = new World(pack, { scale: S });
// the pitch's floor: the ground's middle height over the footprint
const hs: number[] = []; for (let x = -1; x <= 1; x += 0.1) for (let z = -1; z <= 1; z += 0.1) { const [gx, gz] = footprint(x, z); hs.push(world.height(gx, gz)); }
hs.sort((a, b) => a - b); const y0 = hs[hs.length >> 1];
console.log('ground over the footprint', hs[0].toFixed(2), '..', hs[hs.length - 1].toFixed(2), 'floor at', y0.toFixed(2));
// how far a point is outside the stadium's walls (game units; <0 inside), in the stadium's own frame
const outside = (gx: number, gz: number) => Math.max(Math.abs(gx - SITE.x) - SITE.halfX, Math.abs(gz - SITE.z) - SITE.halfZ);
const CH = pack.index.chunk, KEEP = 150, LOCS = 95, EASE = 16;
const out: Buffer[] = []; let off = 0; const chunks: any[] = []; let cut = 0, kept = 0, dug = 0;
for (const ch of pack.index.chunks) {
  const x0 = ch.cx * CH * S, z0 = ch.cz * CH * S, x1 = x0 + CH * S, z1 = z0 + CH * S;
  const dx = Math.max(x0 - SITE.x, 0, SITE.x - x1), dz = Math.max(z0 - SITE.z, 0, SITE.z - z1);
  if (Math.hypot(dx, dz) > KEEP) continue;
  const c: any = { cx: ch.cx, cz: ch.cz };
  for (const k of ['terrain', 'locs', 'locs_alpha']) {
    const part = ch[k]; if (!part || !part.n) continue;
    const pos = new Int16Array(bin.buffer.slice(bin.byteOffset + part.posOff, bin.byteOffset + part.posOff + part.n * 6));
    const col = new Uint8Array(bin.buffer.slice(bin.byteOffset + part.colOff, bin.byteOffset + part.colOff + part.n * 3));
    const gx = (i: number) => x0 + pos[i * 3] * S / 128, gz = (i: number) => z0 + pos[i * 3 + 2] * S / 128, gy = (i: number) => -pos[i * 3 + 1] / 128;
    let P = pos, C = col, n = part.n;
    if (k === 'terrain') {
      for (let i = 0; i < n; i++) {
        const o = outside(gx(i), gz(i)); if (o > EASE) continue;
        const u = Math.max(0, o) / EASE, e = u * u * (3 - 2 * u), want = y0 - 0.02 + (gy(i) - y0 + 0.02) * e;
        P[i * 3 + 1] = -Math.round(want * 128); dug++;
      }
    } else {
      const keep: number[] = [];
      for (let t = 0; t < n; t += 3) {
        let hit = false; for (let v = t; v < t + 3 && !hit; v++) if (outside(gx(v), gz(v)) < 0.8) hit = true;
        const cx = (gx(t) + gx(t + 1) + gx(t + 2)) / 3, cz = (gz(t) + gz(t + 1) + gz(t + 2)) / 3;
        if (hit || Math.hypot(cx - SITE.x, cz - SITE.z) > LOCS) { cut++; continue; }
        keep.push(t);
      }
      P = new Int16Array(keep.length * 9); C = new Uint8Array(keep.length * 9);
      keep.forEach((t, j) => { P.set(pos.subarray(t * 3, t * 3 + 9), j * 9); C.set(col.subarray(t * 3, t * 3 + 9), j * 9); });
      n = keep.length * 3; kept += keep.length; if (!n) continue;
    }
    const pb = Buffer.from(P.buffer, P.byteOffset, n * 6), cb = Buffer.from(C.buffer, C.byteOffset, n * 3);
    c[k] = { n, posOff: off, colOff: off + pb.length }; out.push(pb, cb); off += pb.length + cb.length;
    const pad = (4 - off % 4) % 4; if (pad) { out.push(Buffer.alloc(pad)); off += pad; }
  }
  chunks.push(c);
}
writeFileSync(A + 'league_patch.json', JSON.stringify({ name: 'league_patch', title: 'The Lumbridge cabbage patch', baseX: pack.baseX, baseZ: pack.baseZ, index: { chunk: CH, chunks } }));
writeFileSync(A + 'league_patch.bin', Buffer.concat(out));
writeFileSync(A + 'league_patch.site.json', JSON.stringify({ x: SITE.x, z: SITE.z, y: +y0.toFixed(3), K: SITE.K, rot: SITE.rot }));
console.log(`${chunks.length} chunks, ${(off / 1e6).toFixed(1)} MB; ${cut} scenery triangles cut, ${kept} kept; ${dug} ground vertices levelled`);
