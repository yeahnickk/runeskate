// Near-first loading: the first pack's meshes are split into the chunks around spawn (world.near.bin, a few
// MB, enough to start skating) and everything else (world.far.bin, fetched straight after, in the background).
// serve.ts writes both files from world.bin when they are missing or stale; the client and the server get the
// same layout from this one function, so no extra index file is needed. Pure data: no three.js, no DOM.

export const NEAR_TILES = 40;          // a chunk whose square comes this close to spawn is in the near file
const PARTS = ['terrain', 'locs', 'locs_alpha'];

/** { files: [near, far] }, each { chunks (an index with offsets into that file), copy: [[src, dst, bytes]], size } */
export function nearFarPlan(index, spawn) {
  const CH = index.chunk, files = [{ chunks: [], copy: [], size: 0 }, { chunks: [], copy: [], size: 0 }];
  for (const ch of index.chunks) {
    const ex = Math.max(0, Math.abs((ch.cx + 0.5) * CH - spawn[0]) - CH / 2), ez = Math.max(0, Math.abs((ch.cz + 0.5) * CH - spawn[1]) - CH / 2);
    const f = files[Math.hypot(ex, ez) <= NEAR_TILES ? 0 : 1], out = { ...ch };
    for (const k of PARTS) {
      const p = ch[k]; if (!p || !p.n) continue;
      const pos = f.size, posB = p.n * 6;                  // Int16 x3
      f.copy.push([p.posOff, pos, posB]); f.size += posB;
      const col = f.size, colB = p.n * 3;                  // Uint8 x3
      f.copy.push([p.colOff, col, colB]); f.size += colB;
      f.size += f.size & 1;                                // keep the next Int16 array 2-byte aligned
      out[k] = { ...p, posOff: pos, colOff: col };
    }
    f.chunks.push(out);
  }
  return { files };
}
