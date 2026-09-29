// RuneSkate character-kit exporter: every body kit (IdkType) and every wearable helm / body / legs /
// skirt / robe / cape / amulet / shield / gloves / boots, as individually LIT RS models with their
// animation labels, plus the anim frames the skater uses. The browser (src/rsanim.js) combines any
// outfit and animates it with a port of the client's own Model.animate, so every combination looks
// exactly like it does in-game.
//
//   bun --preload ./runeskate/tools/preload.ts runeskate/tools/export-kit.ts
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
import { unzipSync, gunzipSync, gzipSync } from 'fflate';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

const ROOT = join(import.meta.dir, '..', '..');
const CACHE = join(ROOT, 'showreel3', 'export', 'cache');
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

// ---------------------------------------------------------------- wearpos from the server's obj configs
const SLOT: Record<string, number> = { hat: 0, back: 1, front: 2, righthand: 3, torso: 4, lefthand: 5, arms: 6, legs: 7, head: 8, hands: 9, feet: 10, jaw: 11 };
const cfg = new Map<string, { wearpos?: string; wearpos2?: string; wearpos3?: string }>();
function walk(dir: string) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.obj')) {
      let cur: any = null;
      for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\[(.+)\]$/);
        if (m) { cur = {}; cfg.set(m[1], cur); continue; }
        const kv = line.match(/^(wearpos2?|wearpos3)=(\w+)/);
        if (cur && kv) cur[kv[1]] = kv[2];
      }
    }
  }
}
walk(join(ROOT, 'server', 'content', 'scripts'));
const sym = new Map<number, string>();
for (const line of readFileSync(join(ROOT, 'server', 'engine', 'data', 'symbols', 'obj.sym'), 'utf8').split(/\r?\n/)) {
  const [id, name] = line.split('\t'); if (name) sym.set(+id, name);
}

// ---------------------------------------------------------------- part export
const WEAR_SLOTS = new Set(['hat', 'back', 'front', 'torso', 'lefthand', 'legs', 'hands', 'feet']);
const OWNER_WEAPONS = new Set(['rune_scimitar']);   // weapons are not in the designer; this one is the owner's (serve.ts)
const BANNED = /^null$|^dwarf remains/i;             // (party hats allowed again 2026-09-29, user rule)
type Part = { id: number; kind: 'kit' | 'item'; name: string; key?: string; slot: number; hide: number[]; nv: number; nf: number; off: number };
function packModel(m: any): Uint8Array | null {
  if (!m || !m.numPoints || !m.vertexLabel) return null;
  const labels = Uint8Array.from(m.vertexLabel);           // lighting drops the labels
  const px = Int32Array.from(m.pointX), py = Int32Array.from(m.pointY), pz = Int32Array.from(m.pointZ);
  m.calculateNormals(64, 850, -30, -50, -30, true);        // the client's player lighting
  const nv = m.numPoints;
  const faces: number[] = [], cols: number[] = [];
  for (let f = 0; f < m.numFaces; f++) {
    const type = m.faceRenderType ? m.faceRenderType[f] & 3 : 0;
    const A = m.faceColourA[f], B = m.faceColourB[f], C = m.faceColourC[f];
    if (C === -2) continue;
    let ca = hslRgb(A), cb = hslRgb(B), cc = hslRgb(C);
    if (type === 1 || C === -1) cb = cc = ca;
    faces.push(m.faceVertexA[f], m.faceVertexB[f], m.faceVertexC[f]);
    for (const c of [ca, cb, cc]) cols.push((c >> 16) & 255, (c >> 8) & 255, c & 255);
  }
  const nf = faces.length / 3;
  const pad = (n: number) => (n + 3) & ~3;
  const buf = new Uint8Array(pad(nv * 6) + pad(nv) + pad(nf * 6) + pad(nf * 9));
  const dv = new DataView(buf.buffer); let o = 0;
  for (let v = 0; v < nv; v++) { dv.setInt16(o, px[v], true); dv.setInt16(o + 2, py[v], true); dv.setInt16(o + 4, pz[v], true); o += 6; }
  o = pad(o); for (let v = 0; v < nv; v++) buf[o++] = labels[v];
  o = pad(o); for (const i of faces) { dv.setUint16(o, i, true); o += 2; }
  o = pad(o); for (const c of cols) buf[o++] = c;
  (buf as any).nv = nv; (buf as any).nf = nf;
  return buf;
}

const KIT_SLOT = [8, 11, 4, 6, 9, 7, 10];                   // idk part type % 7 -> appearance slot
// ANIM_ONLY=1 re-exports just kit_anim.json (new anims) and leaves the character parts untouched
for (const [g, gname] of (process.env.ANIM_ONLY ? [] : [[0, 'm'], [1, 'f']]) as [number, string][]) {
  const parts: Part[] = [], chunks: Uint8Array[] = [];
  let off = 0; const seen = new Set<string>();
  const add = (p: Omit<Part, 'nv' | 'nf' | 'off'>, buf: Uint8Array | null) => {
    if (!buf) return;
    const h = createHash('md5').update(buf).digest('hex') + p.slot;
    if (seen.has(h)) return; seen.add(h);
    parts.push({ ...p, nv: (buf as any).nv, nf: (buf as any).nf, off }); chunks.push(buf); off += buf.length;
  };
  const defaults: Record<number, number> = {};
  for (let i = 0; i < IdkType.numDefinitions; i++) {
    const k: any = IdkType.list[i];
    if (!k || k.disable || k.part < 0) continue;
    if ((g === 0 && k.part > 6) || (g === 1 && (k.part < 7 || k.part > 13))) continue;
    const slot = KIT_SLOT[k.part % 7];
    const before = parts.length;
    add({ id: i, kind: 'kit', name: 'kit ' + i, slot, hide: [] }, packModel(k.getModelNoCheck()));
    if (parts.length > before && defaults[slot] === undefined) defaults[slot] = parts.length - 1;
  }
  let items = 0;
  for (const [id, sname] of sym) {
    const c = cfg.get(sname); if (!c || !c.wearpos || !(WEAR_SLOTS.has(c.wearpos) || OWNER_WEAPONS.has(sname))) continue;
    const t: any = ObjType.list(id); if (!t || t.certtemplate >= 0) continue;
    const name = t.name || sname; if (BANNED.test(name) || BANNED.test(sname)) continue;
    let m: any = null; try { m = t.getWearModelNoCheck(g); } catch {}
    const hide = [c.wearpos2, c.wearpos3].filter(Boolean).map(w => SLOT[w!]).filter(s => s !== undefined);
    const n0 = parts.length;
    add({ id, kind: 'item', name, key: sname, slot: SLOT[c.wearpos], hide }, packModel(m));   // key: obj.sym name (carries the colour)
    if (parts.length > n0) items++;
  }
  const blob = new Uint8Array(off); let o = 0; for (const c of chunks) { blob.set(c, o); o += c.length; }
  writeFileSync(join(ASSETS, `kit_${gname}.bin`), blob);
  writeFileSync(join(ASSETS, `kit_${gname}.bin.gz`), gzipSync(blob, { level: 6 }));
  writeFileSync(join(ASSETS, `kit_${gname}.json`), JSON.stringify({ gender: g, defaults, parts }));
  console.log(`gender ${gname}: ${parts.length - items} kit parts, ${items} items, ${(off / 1024) | 0} KB`);
}

// ---------------------------------------------------------------- the skater's anims (frames + bases)
const SEQS: Record<string, number> = { ready: 808, walk: 819, run: 824, sidestep: 755, spot_jump: 741, balance: 763, falling: 766, cheer: 862,
  wave: 863, dance: 866, laugh: 861, clap: 865, slash: 390 };   // slash: the owner's scimitar swing   // emotes on keys 1-5 (with cheer)
const frames: any[] = [], bases: any[] = [], baseIdx = new Map<any, number>(), anims: any = {};
for (const [label, sid] of Object.entries(SEQS)) {
  const seq: any = SeqType.list[sid]; const fi: number[] = [], delay: number[] = [];
  for (let i = 0; i < seq.numFrames; i++) {
    const f: any = AnimFrame.list[seq.frames[i]]; if (!f) continue;
    if (!baseIdx.has(f.base)) { baseIdx.set(f.base, bases.length); bases.push({ type: Array.from(f.base.type), labels: f.base.labels.map((l: any) => l ? Array.from(l) : []) }); }
    fi.push(frames.length);
    frames.push({ b: baseIdx.get(f.base), ti: Array.from(f.ti.slice(0, f.size)), tx: Array.from(f.tx.slice(0, f.size)), ty: Array.from(f.ty.slice(0, f.size)), tz: Array.from(f.tz.slice(0, f.size)) });
    let d = seq.delay?.[i] ?? 0; if (d === 0) d = f.delay ?? 1; delay.push(d);
  }
  anims[label] = { seq: sid, frames: fi, delay };
}
writeFileSync(join(ASSETS, 'kit_anim.json'), JSON.stringify({ anims, frames, bases }));
console.log(`anims: ${Object.keys(anims).length} seqs, ${frames.length} frames, ${bases.length} bases`);
