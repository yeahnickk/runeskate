// Rune League's stadium dressing, 1:1 from the 2004 cache: the cabbage (the ball), the patch's own wooden fence, the
// stone walls, hay, banners and flagpoles, benches, torches, the potions and essence floating over the boost pads.
// Each comes out lit the way the client lights it (its ambient/contrast), as plain triangles + colours, RS units
// (128 a tile, y up) into assets/league_models.json. Re-run only to change the list.
//   bun --preload ./tools/preload.ts tools/league-models.ts
import Packet from '#/io/Packet.js';
import JagFile from '#/io/JagFile.js';
import Model from '#/dash3d/Model.js';
import Pix3D from '#/dash3d/Pix3D.js';
import LocType from '#/config/LocType.js';
import ObjType from '#/config/ObjType.js';
import { unzipSync, gunzipSync } from 'fflate';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const CACHE = join(import.meta.dir, 'cache'), ASSETS = join(import.meta.dir, '..', 'assets');
const rd = (n: string) => new Uint8Array(readFileSync(join(CACHE, n)));
const crcPkt = new Packet(rd('crc')); const crc: number[] = []; for (let i = 0; i < 9; i++) crc[i] = crcPkt.g4();
const config = new JagFile(rd(`config${crc[2]}`)), textures = new JagFile(rd(`textures${crc[6]}`));
LocType.init(config); ObjType.init(config, true);
Pix3D.unpackTextures(textures); Pix3D.initColourTable(0.8);
const zip = unzipSync(rd('ondemand.zip'));
const od = (a: number, f: number): Uint8Array | null => { const e = zip[`${a + 1}.${f}`]; if (!e) return null; try { return gunzipSync(e.slice(0, e.length - 2)); } catch { try { return gunzipSync(e); } catch { return null; } } };
const modelIds = Object.keys(zip).filter(k => k.startsWith('1.')).map(k => +k.split('.')[1]);
Model.init(Math.max(...modelIds) + 1, { requestModel() {} } as any);
for (const id of modelIds) Model.unpack(id, od(0, id));
const hslRgb = (hsl: number) => Pix3D.colourTable[hsl & 0xffff];
const texRgb = (t: number) => { try { return Pix3D.getTextureAverage(t); } catch { return 0x505050; } };

// key: [loc id, shape] | ['obj', obj id]
const LIST: Record<string, [number | 'obj', number]> = {
  cabbage: [1161, 10], fence: [980, 0], fenceCorner: [980, 2], fenceDiag: [980, 9], gate: [1551, 0],
  wall: [1583, 0], wallCorner: [1583, 2], wallDiag: [1583, 9], wall2: [2629, 0], wall3: [2854, 0], wall4: [3626, 0],
  hay: [298, 10], haystack: [300, 10], bale: [304, 10], scarecrow: [297, 10],
  flag1: [860, 10], flag2: [861, 10], flag3: [862, 10], flag4: [869, 10], banner: [899, 4],
  std1: [851, 10], std2: [853, 10], std3: [854, 10], std4: [855, 10], std5: [856, 10], std6: [859, 10], std7: [863, 10], std8: [864, 10],
  bench: [1104, 10], bench2: [1106, 10], torch: [724, 10], barrel: [362, 10], crate: [0, 10], lamp: [200, 10], pillar: [2004, 10], pillar2: [2440, 10],
  energy: ['obj', 3008], essence: ['obj', 1436], cabbageItem: ['obj', 1965],
};

const out: Record<string, { p: number[]; c: number[] }> = {};
for (const [key, [src, shape]] of Object.entries(LIST)) {
  let m: any = null;
  try { m = src === 'obj' ? ObjType.list(shape).getModelLit(1) : LocType.list(src).getModel(shape, 0, 0, 0, 0, 0, -1); } catch (e) { console.warn(key, e); }
  if (!m?.pointX) { console.warn('no model', key); continue; }
  const p: number[] = [], c: number[] = [];
  for (let f = 0; f < m.numFaces; f++) {
    const type = m.faceRenderType ? m.faceRenderType[f] & 3 : 0;
    const A = m.faceColourA?.[f] ?? 0, B = m.faceColourB?.[f] ?? 0, C = m.faceColourC?.[f] ?? 0;
    if (C === -2 || (m.faceAlpha && m.faceAlpha[f] >= 254)) continue;
    let cols: number[];
    if (type === 0) cols = C === -1 ? [hslRgb(A), hslRgb(A), hslRgb(A)] : [hslRgb(A), hslRgb(B), hslRgb(C)];
    else if (type === 1) cols = [hslRgb(A), hslRgb(A), hslRgb(A)];
    else { const rgb = texRgb(m.faceColour?.[f] ?? 0), sh = (v: number) => { const k = Math.max(0, Math.min(1, (127 - v) / 100)); return (((rgb >> 16 & 255) * k) << 16) | (((rgb >> 8 & 255) * k) << 8) | ((rgb & 255) * k); }; cols = [sh(A), sh(type === 3 ? A : B), sh(type === 3 ? A : C)]; }
    for (const [i, v] of [m.faceVertexA[f], m.faceVertexB[f], m.faceVertexC[f]].entries()) {
      p.push(m.pointX[v], -m.pointY[v], -m.pointZ[v]);             // (RS y is down, z north: three.js has -z north)
      c.push((cols[i] >> 16) & 255, (cols[i] >> 8) & 255, cols[i] & 255);
    }
  }
  out[key] = { p, c };
  let y0 = Infinity, y1 = -Infinity; for (let i = 1; i < p.length; i += 3) { y0 = Math.min(y0, p[i]); y1 = Math.max(y1, p[i]); }
  console.log(key.padEnd(12), String(p.length / 9).padStart(5), 'tris, height', y0, '..', y1);
}
writeFileSync(join(ASSETS, 'league_models.json'), JSON.stringify(out));
console.log('league_models.json', (JSON.stringify(out).length / 1024) | 0, 'KB');
