// RuneSkate rune exporter: the real rune item models (the ones you see lying on the ground in 2004) for the four
// elemental runes, with their recolours applied, written to assets/rune_<kind>.json (three coords, tiles).
//
//   bun --preload ./tools/preload.ts tools/export-runes.ts
import Packet from '#/io/Packet.js';
import JagFile from '#/io/JagFile.js';
import Model from '#/dash3d/Model.js';
import Pix3D from '#/dash3d/Pix3D.js';
import ObjType from '#/config/ObjType.js';
import { unzipSync, gunzipSync } from 'fflate';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const CACHE = join(import.meta.dir, 'cache');
const ASSETS = join(import.meta.dir, '..', 'assets');
const rd = (n: string) => new Uint8Array(readFileSync(join(CACHE, n)));
const crcPkt = new Packet(rd('crc'));
const crc: number[] = []; for (let i = 0; i < 9; i++) crc[i] = crcPkt.g4();
const config = new JagFile(rd(`config${crc[2]}`)), textures = new JagFile(rd(`textures${crc[6]}`));
ObjType.init(config, true);
Pix3D.unpackTextures(textures); Pix3D.initColourTable(0.8);
const zip = unzipSync(rd('ondemand.zip'));
const od = (archive: number, file: number): Uint8Array | null => {
  const e = zip[`${archive + 1}.${file}`]; if (!e) return null;
  try { return gunzipSync(e.slice(0, e.length - 2)); } catch { try { return gunzipSync(e); } catch { return null; } }
};
const modelIds = Object.keys(zip).filter(k => k.startsWith('1.')).map(k => +k.split('.')[1]);
Model.init(Math.max(...modelIds) + 1, { requestModel() {} } as any);
for (const id of modelIds) Model.unpack(id, od(0, id));
const hslRgb = (hsl: number) => Pix3D.colourTable[hsl & 0xffff];
const texRgb = (t: number) => { try { return Pix3D.getTextureAverage(t); } catch { return 0x808080; } };

const RUNES: Record<string, number> = { fire: 554, water: 555, air: 556, earth: 557 };
for (const [kind, id] of Object.entries(RUNES)) {
  const o: any = ObjType.list(id);
  const m: any = o.getModelUnlit(1);
  if (!m) { console.log(kind, 'no model'); continue; }
  const pos: number[] = [], col: number[] = [];
  for (let f = 0; f < m.numFaces; f++) {
    const type = m.faceRenderType ? m.faceRenderType[f] & 3 : 0;
    const A = m.faceColourA?.[f] ?? m.faceColour?.[f] ?? 0;
    let c: number;
    if (type >= 2) c = texRgb(m.faceColour[f]);
    else c = hslRgb(m.faceColour ? m.faceColour[f] : A);
    for (const v of [m.faceVertexA[f], m.faceVertexB[f], m.faceVertexC[f]]) {
      pos.push(m.pointX[v] / 128, -m.pointY[v] / 128, -m.pointZ[v] / 128);
      col.push((c >> 16) & 255, (c >> 8) & 255, c & 255);
    }
  }
  writeFileSync(join(ASSETS, `rune_${kind}.json`), JSON.stringify({ name: o.name, obj: id, pos: pos.map(v => Math.round(v * 1000) / 1000), col }));
  console.log(`${kind}: ${o.name} (obj ${id}, model ${o.model}) ${m.numFaces} faces`);
}
