// Build a player model from an outfit the way the RS client does: combine the worn parts in appearance-
// slot order (Model.combineForAnim: identical points are merged, first label wins), group vertices by
// label (prepareAnim), then run every anim frame through a port of Model.animate/animate2 with the
// client's fixed-point sin/cos tables. Parts come pre-lit from tools/export-kit.ts.
import { RSModel } from './model.js';

const SIN = new Int32Array(2048), COS = new Int32Array(2048);
for (let i = 0; i < 2048; i++) { SIN[i] = (Math.sin(i * 0.0030679615757712823) * 65536) | 0; COS[i] = (Math.cos(i * 0.0030679615757712823) * 65536) | 0; }

export const KIT_SLOTS = [8, 11, 4, 6, 9, 7, 10];            // hair, jaw, torso, arms, hands, legs, feet
export const ITEM_SLOTS = [0, 1, 2, 4, 5, 7, 9, 10];         // helm, cape, neck, body, shield, legs, gloves, boots
export const SLOT_NAME = { 0: 'Helm', 1: 'Cape', 2: 'Neck', 4: 'Body', 5: 'Shield', 7: 'Legs', 9: 'Gloves', 10: 'Boots', 8: 'Hair', 11: 'Beard', 6: 'Arms' };

const kits = {}; let anim = null;
export async function loadKit(g) {
  if (!anim) anim = fetch('assets/kit_anim.json').then(r => r.json());
  if (!kits[g]) kits[g] = (async () => {
    const n = g ? 'f' : 'm';
    const [meta, bin] = await Promise.all([fetch(`assets/kit_${n}.json`).then(r => r.json()), fetch(`assets/kit_${n}.bin`).then(r => r.arrayBuffer())]);
    const pad = x => (x + 3) & ~3;
    for (const p of meta.parts) {
      let o = p.off;
      p.pos = new Int16Array(bin, o, p.nv * 3); o = pad(o + p.nv * 6);
      p.lab = new Uint8Array(bin, o, p.nv); o = pad(o + p.nv);
      p.tri = new Uint16Array(bin, o, p.nf * 3); o = pad(o + p.nf * 6);
      p.col = new Uint8Array(bin, o, p.nf * 9);
    }
    meta.byKey = new Map(meta.parts.map((p, i) => [p.kind + p.id, i]));
    return meta;
  })();
  return Promise.all([kits[g], anim]);
}

/** outfit = { g: 0|1, items: {slot: objId}, kits: {slot: idkId} } -> the parts actually worn, slot order */
export function resolve(kit, outfit) {
  const worn = {}, hidden = new Set();
  for (const [slot, id] of Object.entries(outfit.items || {})) {
    const i = kit.byKey.get('item' + id); if (i === undefined) continue;
    worn[slot] = kit.parts[i]; for (const h of kit.parts[i].hide) hidden.add(h);
  }
  for (const slot of KIT_SLOTS) {
    if (worn[slot] || hidden.has(slot)) continue;
    const want = outfit.kits?.[slot];
    let i = want !== undefined ? kit.byKey.get('kit' + want) : undefined;
    if (i === undefined || kit.parts[i].slot !== slot) i = kit.defaults[slot];
    if (i !== undefined) worn[slot] = kit.parts[i];
  }
  const out = [];
  for (let s = 0; s < 12; s++) if (worn[s] && !(hidden.has(s) && worn[s].kind === 'kit')) out.push(worn[s]);
  return out;
}

export async function buildOutfitModel(outfit) {
  const [kit, an] = await loadKit(outfit.g ? 1 : 0);
  const parts = resolve(kit, outfit);
  // combine (addPoint dedupe)
  const map = new Map(); const X = [], Y = [], Z = [], L = []; const faces = []; const cols = [];
  for (const p of parts) {
    const remap = new Int32Array(p.nv);
    for (let v = 0; v < p.nv; v++) {
      const x = p.pos[v * 3], y = p.pos[v * 3 + 1], z = p.pos[v * 3 + 2], k = x + ',' + y + ',' + z;
      let i = map.get(k);
      if (i === undefined) { i = X.length; map.set(k, i); X.push(x); Y.push(y); Z.push(z); L.push(p.lab[v]); }
      remap[v] = i;
    }
    for (let f = 0; f < p.tri.length; f++) faces.push(remap[p.tri[f]]);
    for (let c = 0; c < p.col.length; c++) cols.push(p.col[c]);
  }
  const nv = X.length;
  // prepareAnim: vertices per label
  const groups = [];
  for (let v = 0; v < nv; v++) (groups[L[v]] ||= []).push(v);
  // bake: frame 0 = bind pose, then every anim frame
  const all = [];
  const px = new Int32Array(nv), py = new Int32Array(nv), pz = new Int32Array(nv);
  const put = () => { for (let v = 0; v < nv; v++) all.push(px[v] / 128, -py[v] / 128, -pz[v] / 128); };
  px.set(X); py.set(Y); pz.set(Z); put();
  const anims = {}; let nf = 1;
  for (const [label, a] of Object.entries(an.anims)) {
    const fi = [];
    for (const idx of a.frames) {
      px.set(X); py.set(Y); pz.set(Z);
      animate(an.frames[idx], an.bases[an.frames[idx].b], groups, px, py, pz);
      put(); fi.push(nf++);
    }
    anims[label] = { frames: fi, delay: a.delay };
  }
  return new RSModel({ verts: nv, nframes: nf, anims }, new Float32Array(all), Uint32Array.from(faces), Uint8Array.from(cols));
}

function animate(fr, base, groups, px, py, pz) {
  let oX = 0, oY = 0, oZ = 0;
  for (let i = 0; i < fr.ti.length; i++) {
    const ti = fr.ti[i], type = base.type[ti], labels = base.labels[ti], x = fr.tx[i], y = fr.ty[i], z = fr.tz[i];
    if (type === 0) {                                        // ORIGIN
      let n = 0; oX = oY = oZ = 0;
      for (const l of labels) { const g = groups[l]; if (g) for (const v of g) { oX += px[v]; oY += py[v]; oZ += pz[v]; n++; } }
      if (n > 0) { oX = ((oX / n) | 0) + x; oY = ((oY / n) | 0) + y; oZ = ((oZ / n) | 0) + z; } else { oX = x; oY = y; oZ = z; }
    } else if (type === 1) {                                 // TRANSLATE
      for (const l of labels) { const g = groups[l]; if (g) for (const v of g) { px[v] += x; py[v] += y; pz[v] += z; } }
    } else if (type === 2) {                                 // ROTATE
      const pitch = (x & 0xff) * 8, yaw = (y & 0xff) * 8, roll = (z & 0xff) * 8;
      for (const l of labels) {
        const g = groups[l]; if (!g) continue;
        for (const v of g) {
          px[v] -= oX; py[v] -= oY; pz[v] -= oZ;
          if (roll) { const s = SIN[roll], c = COS[roll]; const x_ = (py[v] * s + px[v] * c) >> 16; py[v] = (py[v] * c - px[v] * s) >> 16; px[v] = x_; }
          if (pitch) { const s = SIN[pitch], c = COS[pitch]; const y_ = (py[v] * c - pz[v] * s) >> 16; pz[v] = (py[v] * s + pz[v] * c) >> 16; py[v] = y_; }
          if (yaw) { const s = SIN[yaw], c = COS[yaw]; const x_ = (pz[v] * s + px[v] * c) >> 16; pz[v] = (pz[v] * c - px[v] * s) >> 16; px[v] = x_; }
          px[v] += oX; py[v] += oY; pz[v] += oZ;
        }
      }
    } else if (type === 3) {                                 // SCALE
      for (const l of labels) {
        const g = groups[l]; if (!g) continue;
        for (const v of g) {
          px[v] = (((px[v] - oX) * x / 128) | 0) + oX; py[v] = (((py[v] - oY) * y / 128) | 0) + oY; pz[v] = (((pz[v] - oZ) * z / 128) | 0) + oZ;
        }
      }
    }
  }
}
