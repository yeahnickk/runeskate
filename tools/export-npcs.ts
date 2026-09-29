// RuneSkate NPC exporter: the few NPCs you can stomp or ram, with their real ready/walk/death anims,
// written straight into runeskate/assets in the RSModel format (three coords, tiles).
//
//   bun --preload ./runeskate/tools/preload.ts runeskate/tools/export-npcs.ts
import Packet from '#/io/Packet.js';
import JagFile from '#/io/JagFile.js';
import Model from '#/dash3d/Model.js';
import AnimFrame from '#/dash3d/AnimFrame.js';
import Pix3D from '#/dash3d/Pix3D.js';
import NpcType from '#/config/NpcType.js';
import SeqType from '#/config/SeqType.js';
import LocType from '#/config/LocType.js';
import ObjType from '#/config/ObjType.js';
import IdkType from '#/config/IdkType.js';
import FloType from '#/config/FloType.js';
import { unzipSync, gunzipSync } from 'fflate';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const CACHE = join(import.meta.dir, '..', '..', 'showreel3', 'export', 'cache');
const ASSETS = join(import.meta.dir, '..', 'assets');
const rd = (n: string) => new Uint8Array(readFileSync(join(CACHE, n)));
const crcPkt = new Packet(rd('crc'));
const crc: number[] = []; for (let i = 0; i < 9; i++) crc[i] = crcPkt.g4();
const config = new JagFile(rd(`config${crc[2]}`)), textures = new JagFile(rd(`textures${crc[6]}`));
SeqType.init(config); LocType.init(config); ObjType.init(config, true); NpcType.init(config); IdkType.init(config); FloType.init(config);
Pix3D.unpackTextures(textures); Pix3D.initColourTable(0.8);
const zip = unzipSync(rd('ondemand.zip'));
const od = (archive: number, file: number): Uint8Array | null => {
  const e = zip[`${archive + 1}.${file}`]; if (!e) return null;
  try { return gunzipSync(e.slice(0, e.length - 2)); } catch { try { return gunzipSync(e); } catch { return null; } }
};
const ids = (a: number) => Object.keys(zip).filter(k => k.startsWith(`${a + 1}.`)).map(k => +k.split('.')[1]);
const modelIds = ids(0);
Model.init(Math.max(...modelIds) + 1, { requestModel() {} } as any);
for (const id of modelIds) Model.unpack(id, od(0, id));
AnimFrame.init(65535);
for (const id of ids(1)) { const d = od(1, id); if (d) try { AnimFrame.unpack(d); } catch {} }
const hslRgb = (hsl: number) => Pix3D.colourTable[hsl & 0xffff];

// name -> [npc id, death seq]
const NPCS: Record<string, [number, number]> = {
  goblin: [100, 313], cow: [81, 62], chicken: [41, 57], rat: [47, 243], imp: [708, 172], man: [1, 836], darkwizard: [174, 836],
};
for (const [name, [npcId, death]] of Object.entries(NPCS)) {
  const t: any = NpcType.list(npcId);
  const base = t.getTempModel(-1, -1, null);
  const faces: number[] = [], col: number[] = [];
  for (let f = 0; f < base.numFaces; f++) {
    const type = base.faceRenderType ? base.faceRenderType[f] & 3 : 0;
    const A = base.faceColourA[f], B = base.faceColourB[f], C = base.faceColourC[f];
    if (C === -2) continue;
    let ca = hslRgb(A), cb = hslRgb(B), cc = hslRgb(C);
    if (type === 1 || C === -1) cb = cc = ca;
    faces.push(base.faceVertexA[f], base.faceVertexB[f], base.faceVertexC[f]);
    for (const c of [ca, cb, cc]) col.push((c >> 16) & 255, (c >> 8) & 255, c & 255);
  }
  const nv = base.numPoints;
  const frames: number[] = [];
  const grab = (m: any) => { for (let v = 0; v < nv; v++) frames.push(m.pointX[v] / 128, -m.pointY[v] / 128, -m.pointZ[v] / 128); };
  grab(base);
  let nframes = 1; const anims: any = {};
  for (const [label, seqId] of [['ready', t.readyanim], ['walk', t.walkanim], ['death', death]] as [string, number][]) {
    const seq: any = SeqType.list[seqId];
    if (!seq?.frames) { console.log(`  ${name}: ${label} seq ${seqId} missing`); continue; }
    const fi: number[] = [], delay: number[] = [];
    for (let i = 0; i < seq.numFrames; i++) {
      const m = t.getTempModel(seq.frames[i], -1, null);
      if (!m || m.numPoints !== nv) continue;
      fi.push(nframes++); grab(m);
      let d = seq.delay?.[i] ?? 0; if (d === 0) d = AnimFrame.list[seq.frames[i]]?.delay ?? 1; delay.push(d);
    }
    anims[label] = { seq: seqId, frames: fi, delay };
  }
  writeFileSync(join(ASSETS, `npc_${name}.frames.bin`), new Float32Array(frames));
  writeFileSync(join(ASSETS, `npc_${name}.faces.bin`), new Uint32Array(faces));
  writeFileSync(join(ASSETS, `npc_${name}.fcol.bin`), new Uint8Array(col));
  writeFileSync(join(ASSETS, `npc_${name}.json`), JSON.stringify({ verts: nv, faces: faces.length / 3, nframes, anims, npc: npcId, name: t.name, level: t.vislevel ?? 0, size: t.size ?? 1 }));
  console.log(`${name} (${t.name}, npc ${npcId}): ${nv} verts, ${faces.length / 3} faces, ${nframes} frames, anims ${Object.keys(anims).join('/')}`);
}
