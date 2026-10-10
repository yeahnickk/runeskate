// RuneSkate world exporter: terrain + locs for a (much) bigger area than the showreel export,
// rebuilt with the webclient's own ClientBuild/World code, plus a list of the graveyard-style
// metal railings (loc "railing" 997 and its diagonals) so the game can render them see-through
// and let you ollie them.
//
//   bun --preload ./runeskate/tools/preload.ts runeskate/tools/export-world.ts [baseX baseZ size]
//
// Reads the cached game files in showreel3/export/cache (nothing live is touched after the first
// download), writes runeskate/tools/out/world_*.bin + meta.json for tools/build.py.
import Packet from '#/io/Packet.js';
import JagFile from '#/io/JagFile.js';
import Model from '#/dash3d/Model.js';
import Pix3D from '#/dash3d/Pix3D.js';
import World from '#/dash3d/World.js';
import CollisionMap from '#/dash3d/CollisionMap.js';
import ClientBuild from '#/client/ClientBuild.js';
import LocType from '#/config/LocType.js';
import FloType from '#/config/FloType.js';
import SeqType from '#/config/SeqType.js';
import ObjType from '#/config/ObjType.js';
import NpcType from '#/config/NpcType.js';
import IdkType from '#/config/IdkType.js';
import { unzipSync, gunzipSync } from 'fflate';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { opens } from './doors.ts';
import { thinnedTrees } from './thin-trees.ts';

const BASE = 'https://rs-sdk-demo.fly.dev';
const OUT = join(import.meta.dir, 'out');
const CACHE = join(import.meta.dir, 'cache')          // tools/cache: the 2004 game cache;
mkdirSync(OUT, { recursive: true });
const baseX = +(process.argv[2] || 3072), baseZ = +(process.argv[3] || 3136), SIZE = +(process.argv[4] || 256), LEVELS = 4;

async function fetchCached(name: string, url: string): Promise<Uint8Array> {
  const p = join(CACHE, name);
  if (existsSync(p)) return new Uint8Array(readFileSync(p));
  const b = new Uint8Array(await (await fetch(url)).arrayBuffer());
  writeFileSync(p, b); return b;
}
const crcPkt = new Packet(await fetchCached('crc', `${BASE}/crc`));
const crc: number[] = []; for (let i = 0; i < 9; i++) crc[i] = crcPkt.g4();
const JAG = ['', 'title', 'config', 'interface', 'media', 'versionlist', 'textures', 'wordenc', 'sounds'];
const jag = async (i: number) => new JagFile(await fetchCached(`${JAG[i]}${crc[i]}`, `${BASE}/${JAG[i]}${crc[i]}`));
const config = await jag(2), textures = await jag(6), versionlist = await jag(5);
SeqType.init(config); LocType.init(config); ObjType.init(config, true); NpcType.init(config); IdkType.init(config); FloType.init(config);
Pix3D.unpackTextures(textures);
Pix3D.initColourTable(0.8);
ClientBuild.hueOff = 0; ClientBuild.ligOff = 0;
ClientBuild.lowMem = false; World.lowMem = false;

const zip = unzipSync(await fetchCached('ondemand.zip', `${BASE}/ondemand.zip`));
const od = (archive: number, file: number): Uint8Array | null => {
  const e = zip[`${archive + 1}.${file}`];
  if (!e) return null;
  try { return gunzipSync(e.slice(0, e.length - 2)); } catch { try { return gunzipSync(e); } catch { return null; } }
};
const modelIds = Object.keys(zip).filter(k => k.startsWith('1.')).map(k => +k.split('.')[1]);
Model.init(Math.max(...modelIds) + 1, { requestModel() {} } as any);
for (const id of modelIds) Model.unpack(id, od(0, id));

const TEX_AVG = new Map<number, number>();
const texRgb = (t: number) => { if (!TEX_AVG.has(t)) { let v = 0x505050; try { v = Pix3D.getTextureAverage(t); } catch {} TEX_AVG.set(t, v); } return TEX_AVG.get(t)!; };
const TEX_CUT = new Map<number, boolean>();
const texCutout = (t: number) => {                          // texture has transparent (palette 0) texels
  if (!TEX_CUT.has(t)) {
    const P: any = Pix3D, tex = P.textures?.[t], pal = P.texPal?.[t];
    let cut = false; if (tex && pal) for (let i = 0; i < tex.data.length; i++) if ((pal[tex.data[i]] & 0xf8f8ff) === 0) { cut = true; break; }
    TEX_CUT.set(t, cut);
  }
  return TEX_CUT.get(t)!;
};
const hslRgb = (hsl: number) => Pix3D.colourTable[hsl & 0xffff];
// a cut-out texture (hedge/bush/flower/fern leaves, grilles): how much of it is solid, and the average colour of
// just the solid texels (the plain average mixes in the see-through black and comes out a dark slab)
const TEX_SOLID = new Map<number, { cov: number; rgb: number }>();
const texSolid = (t: number) => {
  if (!TEX_SOLID.has(t)) {
    const P: any = Pix3D, tex = P.textures?.[t], pal = P.texPal?.[t];
    let r = 0, g = 0, b = 0, n = 0, all = 0;
    if (tex && pal) for (let i = 0; i < tex.data.length; i++) {
      const c = pal[tex.data[i]]; all++;
      if ((c & 0xf8f8ff) === 0) continue;
      r += (c >> 16) & 255; g += (c >> 8) & 255; b += c & 255; n++;
    }
    // (the palette is already brightness-corrected: averaging it as-is keeps leaves their real green)
    const rgb = n ? (((r / n) | 0) << 16) | (((g / n) | 0) << 8) | ((b / n) | 0) : 0x305020;
    TEX_SOLID.set(t, { cov: all ? n / all : 1, rgb });
  }
  return TEX_SOLID.get(t)!;
};
const FOLIAGE_ALPHA = 110;                                   // sparse cut-outs (grilles, thin cards) go see-through

// see-through railings: every metal railing variant in the loc configs
const RAILING = new Set<number>();
for (let id = 0; id < LocType.numDefinitions; id++) {
  try { void id; } catch {}
}
if (!RAILING.size) for (const id of [997, 998, 999]) RAILING.add(id);
const locIdOf = (typecode: number) => (typecode >> 14) & 0x7fff;
const HOPPABLE = new Set([...RAILING, 980, 981]);            // + wooden fencing / garden fencing (cow pens): ollie-able, stays opaque
const SEE_THROUGH = 120;
const OPEN_GATES = new Set([2882, 2883]);
// every door and gate stands open (tools/doors.ts): their models are left out, build.py leaves their edges open
for (let id = 0; id < LocType.numDefinitions; id++) { let t: any; try { t = LocType.list(id); } catch { continue; } if (opens(t, 0)) OPEN_GATES.add(id); }
console.log('doors and gates left open:', OPEN_GATES.size, 'loc ids');                   // the Al Kharid toll gate: no toll in RuneSkate, the gateway stands open                                    // face alpha tag -> build.py puts it in locs_alpha
const THIN = thinnedTrees(LocType);
console.log('trees thinned out of dense clumps:', THIN.size);

class Soup {
  // growable typed buffers: the whole members map is tens of millions of triangles, too many for JS arrays
  n = 0; P = new Float32Array(9 << 16); C = new Uint8Array(9 << 16); A = new Uint8Array(1 << 16);
  get alpha() { return { length: this.n }; }
  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, ca: number, cb: number, cc: number, a = 0) {
    if (this.n === this.A.length) {
      const grow = <T extends Float32Array | Uint8Array>(o: T): T => { const b = new (o.constructor as any)(Math.floor(o.length * 1.5)) as T; b.set(o); return b; };
      this.P = grow(this.P); this.C = grow(this.C); this.A = grow(this.A);
    }
    const i = this.n * 9, P = this.P, C = this.C;
    P[i] = ax; P[i + 1] = ay; P[i + 2] = az; P[i + 3] = bx; P[i + 4] = by; P[i + 5] = bz; P[i + 6] = cx; P[i + 7] = cy; P[i + 8] = cz;
    C[i] = (ca >> 16) & 255; C[i + 1] = (ca >> 8) & 255; C[i + 2] = ca & 255;
    C[i + 3] = (cb >> 16) & 255; C[i + 4] = (cb >> 8) & 255; C[i + 5] = cb & 255;
    C[i + 6] = (cc >> 16) & 255; C[i + 7] = (cc >> 8) & 255; C[i + 8] = cc & 255;
    this.A[this.n++] = a;
  }
  // yaw: the rotation the client applies at draw time (Model.worldRender) � wall decorations (windows,
  // torches, banners) and sprites are stored unrotated and turned by their angle when drawn
  model(m: any, ox: number, oy: number, oz: number, forceAlpha = 0, yaw = 0) {
    if (!m || !m.pointX) return;
    const P: any = Pix3D, sy = yaw ? P.sinTable[yaw & 0x7ff] : 0, cy = yaw ? P.cosTable[yaw & 0x7ff] : 0;
    const rx = (v: number) => yaw ? ((m.pointZ[v] * sy + m.pointX[v] * cy) >> 16) : m.pointX[v];
    const rz = (v: number) => yaw ? ((m.pointZ[v] * cy - m.pointX[v] * sy) >> 16) : m.pointZ[v];
    for (let f = 0; f < m.numFaces; f++) {
      const type = m.faceRenderType ? m.faceRenderType[f] & 3 : 0;
      const A = m.faceColourA?.[f] ?? 0, Bc = m.faceColourB?.[f] ?? 0, C = m.faceColourC?.[f] ?? 0;
      if (C === -2) continue;
      let cutAlpha = 0;
      let ca: number, cb: number, cc: number;
      if (type === 0) { ca = hslRgb(A); cb = hslRgb(Bc); cc = C === -1 ? ca : hslRgb(C); if (C === -1) cb = ca; }
      else if (type === 1) { ca = cb = cc = hslRgb(A); }
      else {
        const t = m.faceColour?.[f] ?? 0;
        let rgb = texRgb(t);
        // cut-out foliage/grille cards (hedges, bushes, flowers, ferns...): coloured by their SOLID texels so they
        // show instead of vanishing; mostly-solid ones (leafy hedges) stay opaque, sparse ones go see-through.
        // See-through railings (forceAlpha) keep the translucent plain average: that IS the railing (Al Kharid border)
        if (texCutout(t) && !forceAlpha) { const so = texSolid(t); rgb = so.rgb; if (so.cov < 0.45) cutAlpha = FOLIAGE_ALPHA; }
        const sh = (v: number) => { const k = Math.max(0, Math.min(1, (127 - v) / 100)); return (((rgb >> 16 & 255) * k) << 16) | (((rgb >> 8 & 255) * k) << 8) | ((rgb & 255) * k); };
        ca = sh(A); cb = sh(type === 3 ? A : Bc); cc = sh(type === 3 ? A : C);
      }
      const a = m.faceVertexA[f], b = m.faceVertexB[f], c = m.faceVertexC[f];
      // The software renderer settles coplanar faces (rugs on floors, trim on rugs) by draw order: face
      // priority. A depth buffer z-fights them into black shards, so lift flat-ish faces a hair per
      // priority level (RS units, y is down): at most ~0.05 tile, invisible, but enough for the depth test.
      let lift = 0;
      {
        const ux = rx(b) - rx(a), uy = m.pointY[b] - m.pointY[a], uz = rz(b) - rz(a);
        const vx = rx(c) - rx(a), vy = m.pointY[c] - m.pointY[a], vz = rz(c) - rz(a);
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (Math.abs(ny) > 0.9 * Math.hypot(nx, ny, nz)) lift = 1 + (m.facePriority?.[f] ?? 0) * 0.5;
      }
      this.tri(rx(a) + ox, m.pointY[a] + oy - lift, rz(a) + oz, rx(b) + ox, m.pointY[b] + oy - lift, rz(b) + oz, rx(c) + ox, m.pointY[c] + oy - lift, rz(c) + oz, ca, cb, cc,
        forceAlpha || cutAlpha || (m.faceAlpha ? m.faceAlpha[f] : 0));
    }
  }
  save(name: string) {
    writeFileSync(join(OUT, `${name}.pos.bin`), this.P.subarray(0, this.n * 9));
    writeFileSync(join(OUT, `${name}.col.bin`), this.C.subarray(0, this.n * 9));
    writeFileSync(join(OUT, `${name}.alpha.bin`), this.A.subarray(0, this.n));
    console.log(`${name}: ${this.alpha.length} tris`);
  }
}

// The client's ClientBuild is hard-wired to a 104x104 build area (BuildArea.SIZE), so the big map is
// built as a grid of overlapping 104-tile blocks: each contributes only its 88x88 core, and the 8-tile
// margins give every core tile the same neighbours (lighting, blending, multi-tile locs) as in-game.
const B = 104, CORE = 88, MARGIN = 8;
const raw = versionlist.read('map_index')!, mi = new Packet(raw);
const squares: { mx: number; mz: number; land: number; loc: number }[] = [];
for (let i = 0; i < raw.length / 7; i++) { const sq = mi.g2(), land = mi.g2(), loc = mi.g2(); mi.g1(); squares.push({ mx: (sq >> 8) & 255, mz: sq & 255, land, loc }); }

const terrain = new Soup(), locs = new Soup();
const heights = Array.from({ length: LEVELS }, () => Array.from({ length: SIZE + 1 }, () => new Array(SIZE + 1).fill(0)));
const fences: number[][] = [];                             // [x, z, locId] local tiles holding a see-through railing (level 0)
const modelOf = (src: any) => (src && src.pointX) ? src : (src?.getModel ? src.getModel() : null);

for (let cz = 0; cz < SIZE; cz += CORE) for (let cx = 0; cx < SIZE; cx += CORE) {
  const ox = baseX + cx - MARGIN, oz = baseZ + cz - MARGIN;          // world origin of this build block
  const dx = (cx - MARGIN) * 128, dz = (cz - MARGIN) * 128;           // block -> export coords (RS units)
  const groundh: Int32Array[][] = Array.from({ length: LEVELS }, () => Array.from({ length: B + 1 }, () => new Int32Array(B + 1)));
  const mapl: Uint8Array[][] = Array.from({ length: LEVELS }, () => Array.from({ length: B }, () => new Uint8Array(B)));
  const world = new World(groundh, B, LEVELS, B);
  const collision = Array.from({ length: LEVELS }, () => new CollisionMap(B, B));
  const build = new ClientBuild(B, B, groundh, mapl);
  world.fillBaseLevel(0);
  const use = squares.filter(s => s.mx * 64 < ox + B && s.mx * 64 + 64 > ox && s.mz * 64 < oz + B && s.mz * 64 + 64 > oz);
  for (const s of use) { const d = od(3, s.land); if (d) build.loadGround(d, ox, oz, s.mx * 64 - ox, s.mz * 64 - oz); }
  for (const s of use) { const d = od(3, s.loc); if (d) build.loadLocations(d, s.mx * 64 - ox, s.mz * 64 - oz, world, collision); }
  build.finishBuild(world, collision);
  const W: any = world;
  const inCore = (x: number, z: number) => x >= MARGIN && z >= MARGIN && x < MARGIN + CORE && z < MARGIN + CORE && cx + x - MARGIN < SIZE && cz + z - MARGIN < SIZE;
  const gx = (x: number) => cx + x - MARGIN, gz = (z: number) => cz + z - MARGIN;
  for (let l = 0; l < LEVELS; l++) for (let x = MARGIN; x <= MARGIN + CORE; x++) for (let z = MARGIN; z <= MARGIN + CORE; z++)
    if (gx(x) <= SIZE && gz(z) <= SIZE) heights[l][gx(x)][gz(z)] = groundh[l][x][z];
  const seenSprite = new Set<any>();
  const wallModels = (w: any, level: number, x: number, z: number) => {
    if (OPEN_GATES.has(locIdOf(w.typecode))) return;
    const see = RAILING.has(locIdOf(w.typecode)) ? SEE_THROUGH : 0;
    if (HOPPABLE.has(locIdOf(w.typecode)) && level === 0) fences.push([gx(x), gz(z), locIdOf(w.typecode)]);
    locs.model(modelOf(w.model1), w.x + dx, w.y, w.z + dz, see); locs.model(modelOf(w.model2), w.x + dx, w.y, w.z + dz, see);
  };
  const spriteModel = (sp: any, level: number) => {
    if (!inCore(sp.minTileX, sp.minTileZ)) return;                   // anchored in another block
    if (OPEN_GATES.has(locIdOf(sp.typecode))) return;
    if (level === 0 && THIN.has(`${ox + sp.minTileX},${oz + sp.minTileZ},${locIdOf(sp.typecode)}`)) return;   // thinned out of a clump
    const see = RAILING.has(locIdOf(sp.typecode)) ? SEE_THROUGH : 0;
    if (HOPPABLE.has(locIdOf(sp.typecode)) && level === 0) for (let x = sp.minTileX; x <= sp.maxTileX; x++) for (let z = sp.minTileZ; z <= sp.maxTileZ; z++) fences.push([gx(x), gz(z), locIdOf(sp.typecode)]);
    locs.model(modelOf(sp.model), sp.x + dx, sp.y, sp.z + dz, see, sp.yaw || 0);
  };
  for (let level = 0; level < LEVELS; level++) {
    for (let x = 0; x < B; x++) for (let z = 0; z < B; z++) {
      const sq = W.squares[level][x][z];
      if (!sq) continue;
      const core = inCore(x, z);
      const quick = (qg: any, hl: number) => {
        if (!qg || qg.colourNE === 12345678) return;
        const X0 = x * 128 + dx, Z0 = z * 128 + dz, X1 = X0 + 128, Z1 = Z0 + 128;
        const y0 = groundh[hl][x][z], y1 = groundh[hl][x + 1][z], y2 = groundh[hl][x + 1][z + 1], y3 = groundh[hl][x][z + 1];
        const t = qg.texture >= 0 ? texRgb(qg.texture) : -1;
        const c = (hsl: number) => t >= 0 ? t : hslRgb(hsl);
        terrain.tri(X1, y2, Z1, X0, y3, Z1, X1, y1, Z0, c(qg.colourNE), c(qg.colourNW), c(qg.colourSE));
        terrain.tri(X0, y0, Z0, X1, y1, Z0, X0, y3, Z1, c(qg.colourSW), c(qg.colourSE), c(qg.colourNW));
      };
      const ground = (g: any) => {
        if (g) for (let f = 0; f < g.faceVertexA.length; f++) {
          if (g.faceColourA[f] === 12345678) continue;
          const a = g.faceVertexA[f], b = g.faceVertexB[f], c3 = g.faceVertexC[f];
          const tex = g.faceTexture ? g.faceTexture[f] : -1;
          const col = (hsl: number) => tex >= 0 ? texRgb(tex) : hslRgb(hsl);
          terrain.tri(g.vertexX[a] + dx, g.vertexY[a], g.vertexZ[a] + dz, g.vertexX[b] + dx, g.vertexY[b], g.vertexZ[b] + dz, g.vertexX[c3] + dx, g.vertexY[c3], g.vertexZ[c3] + dz, col(g.faceColourA[f]), col(g.faceColourB[f]), col(g.faceColourC[f]));
        }
      };
      const ln = sq.linkedSquare;
      if (core) {
        quick(sq.quickGround, sq.originalLevel ?? level);
        if (ln) { quick(ln.quickGround, 0); ground(ln.ground); if (ln.wall) wallModels(ln.wall, 0, x, z); }
        ground(sq.ground);
        if (sq.wall) wallModels(sq.wall, level, x, z);
        if (sq.decor) {
          const d = sq.decor;
          if ((d.wshape & 0x300) !== 0) {                 // decoration on a diagonal wall: World draws it offset + turned
            const DX = [53, -53, -53, 53], DZ = [-53, -53, 53, 53];
            locs.model(modelOf(d.model), d.x + dx + DX[d.angle & 3], d.y, d.z + dz + DZ[d.angle & 3], 0, d.angle * 512 + 256);
          } else locs.model(modelOf(d.model), d.x + dx, d.y, d.z + dz, 0, d.angle);
        }
        if (sq.groundDecor) locs.model(modelOf(sq.groundDecor.model), sq.groundDecor.x + dx, sq.groundDecor.y, sq.groundDecor.z + dz);
      }
      if (ln) for (let i = 0; i < ln.spriteCount; i++) { const sp = ln.sprites[i]; if (sp && !seenSprite.has(sp)) { seenSprite.add(sp); spriteModel(sp, 0); } }
      for (let i = 0; i < sq.spriteCount; i++) { const sp = sq.sprites[i]; if (sp && !seenSprite.has(sp)) { seenSprite.add(sp); spriteModel(sp, level); } }
    }
  }
  console.log(`block ${ox + MARGIN},${oz + MARGIN}: terrain ${terrain.alpha.length} locs ${locs.alpha.length}`);
}
terrain.save('world_terrain');
locs.save('world_locs');
console.log('railing loc ids', [...RAILING].join(','), 'see-through railing tiles', fences.length);
writeFileSync(join(OUT, 'meta.json'), JSON.stringify({ baseX, baseZ, size: SIZE, fences, heights }));
console.log('done');
