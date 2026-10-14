// MineScape 2b2t: one anarchy world that never resets, run by serve.ts (/mine-ws). No rules, no admins, no bots: the
// server keeps the blocks everyone changed (data/2b2t.json, the chunk-map format world.js saves), the chests, the day,
// and relays the rest. Browsers run their own game (game.js, survival) and send the cells they changed; a hit on
// someone goes to them as a hurt, a lit TNT and its blast go to everyone near as a ghost fuse and a shockwave (the blocks
// it broke come as edits from whoever lit it). Trust is the client's: it only guards against junk and floods.
import { readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { BLOCKS, ITEMS } from './blocks.js';

const WH = 128, MAX = 50, CELLS = 2_000_000, SAVE_MS = 30000;
const FX = new Set(['prime', 'boom']);
const okId = (id) => Number.isInteger(id) && id >= 0 && id < 256 && !!BLOCKS[id];
const okItem = (s) => s && Number.isInteger(s.id) && (ITEMS[s.id] || BLOCKS[s.id]) && Number.isInteger(s.n) && s.n > 0 && s.n <= 64;
const num = (v, lo, hi) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;

export class MineServer {
  constructor(dir, clean = s => s) {     // (dir: serve.ts's data folder)
    this.clean = clean; this.file = join(dir, '2b2t.json');
    this.clients = new Set(); this.n = 0; this.edits = new Map(); this.chests = new Map(); this.cells = 0;
    this.t0 = Date.now(); this.dirty = false; this.hello = null;
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8'));
      this.t0 = s.t0 || this.t0;
      for (const k in s.edits || {}) { const a = s.edits[k], e = new Map(); for (let i = 0; i < a.length; i += 2) e.set(a[i], a[i + 1]); this.edits.set(k, e); this.cells += e.size; }
      for (const k in s.chests || {}) this.chests.set(k, s.chests[k]);
    } catch (e) {}
    setInterval(() => this.states(), 100);
    setInterval(() => this.save(), SAVE_MS);
    setInterval(() => this.sendAll({ t: 'tm', v: this.time() }), 60000);
  }
  time() { return 1000 + Math.floor((Date.now() - this.t0) / 50); }    // (MC's 20 ticks a second, since the world began)
  info() { return { n: [...this.clients].filter(c => c.name).length, max: MAX, cells: this.cells, days: Math.floor(this.time() / 24000) + 1 }; }
  save() {
    if (!this.dirty) return; this.dirty = false;
    const o = { v: 1, t0: this.t0, edits: this.editsObj(), chests: Object.fromEntries(this.chests) };
    try { writeFileSync(this.file + '.tmp', JSON.stringify(o)); renameSync(this.file + '.tmp', this.file); }
    catch (e) { console.warn('2b2t save failed', e?.message || e); }
  }
  editsObj() { const o = {}; for (const [k, e] of this.edits) o[k] = [...e].flat(); return o; }
  /** the whole world for someone joining, gzipped (it only grows; cached until the next change) */
  world() {
    if (!this.hello) this.hello = Bun.gzipSync(new TextEncoder().encode(JSON.stringify({ edits: this.editsObj(), chests: Object.fromEntries(this.chests) })));
    return this.hello;
  }
  send(c, o) { try { c.ws.send(JSON.stringify(o)); } catch (e) {} }
  sendAll(o, but) { const s = JSON.stringify(o); for (const c of this.clients) if (c !== but && c.name) try { c.ws.send(s); } catch (e) {} }
  // everyone's state ten times a second, one message: [id, x, y, z, yaw, pitch, flags, held, helm, body, legs, boots]...
  states() {
    const on = [...this.clients].filter(c => c.st); if (!on.length) return;
    const p = []; for (const c of on) p.push(c.id, ...c.st);
    const s = JSON.stringify({ t: 'ps', p });
    for (const c of this.clients) if (c.name) try { c.ws.send(s); } catch (e) {}
  }

  // ------------------------------------------------------------------ sockets (serve.ts forwards /mine-ws here)
  open(ws) {
    const c = { ws, id: ++this.n, name: null, st: null, bucket: 50000, fx: 60, chatAt: 0, hitAt: 0, at: Date.now() };
    ws.data.c = c; this.clients.add(c);
  }
  close(ws) {
    const c = ws.data.c; if (!c) return; this.clients.delete(c);
    if (c.name) { this.sendAll({ t: 'bye', id: c.id }); this.sendAll({ t: 'c', m: '§e' + c.name + ' left the game' }); }
  }
  message(ws, raw) {
    const c = ws.data.c; if (!c) return;
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    if (!m || typeof m !== 'object') return;
    const now = Date.now(), el = (now - c.at) / 1000; c.at = now;
    c.bucket = Math.min(50000, c.bucket + el * 10000); c.fx = Math.min(60, c.fx + el * 30);
    if (!c.name) {
      if (m.t !== 'hi') return;
      if ([...this.clients].filter(o => o.name).length >= MAX) { this.send(c, { t: 'full', max: MAX }); return ws.close(); }
      let name = this.clean(String(m.name || '').replace(/[^\w \-]/g, '').trim().slice(0, 16)) || 'Steve';
      const taken = new Set([...this.clients].map(o => o.name && o.name.toLowerCase()));
      for (let i = 2; taken.has(name.toLowerCase()); i++) name = name.slice(0, 13) + i;
      c.name = name;
      this.send(c, { t: 'hi', id: c.id, name, time: this.time(), ps: [...this.clients].filter(o => o.name && o !== c).map(o => ({ id: o.id, name: o.name })) });
      try { ws.send(this.world()); } catch (e) {}
      this.sendAll({ t: 'join', id: c.id, name }, c);
      this.sendAll({ t: 'c', m: '§e' + name + ' joined the game' });
      return;
    }
    switch (m.t) {
      case 'p': {     // where they are and what they look like
        const s = m.s; if (!Array.isArray(s) || s.length !== 11 || !s.every(v => typeof v === 'number' && isFinite(v))) return;
        if (!num(s[0], -1e5, 1e5) || !num(s[1], -256, 512) || !num(s[2], -1e5, 1e5)) return;
        c.st = s.map(v => Math.round(v * 100) / 100); return;
      }
      case 'ed': {    // cells they changed: [x, y, z, id | meta << 8, ...]
        const e = m.e; if (!Array.isArray(e) || e.length % 4 || e.length > 4096 * 4) return;
        if (c.bucket < e.length / 4) return; c.bucket -= e.length / 4;
        const ok = [];
        for (let i = 0; i < e.length; i += 4) {
          const x = e[i], y = e[i + 1], z = e[i + 2], v = e[i + 3];
          if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z) || !Number.isInteger(v) || y < 0 || y >= WH || Math.abs(x) > 1e5 || Math.abs(z) > 1e5 || v < 0 || v > 0xffff || !okId(v & 255)) continue;
          const k = (x >> 4) + ',' + (z >> 4), ci = (((z & 15) << 4) | (x & 15)) * WH + y;
          let ch = this.edits.get(k); if (!ch) this.edits.set(k, ch = new Map());
          if (!ch.has(ci)) { if (this.cells >= CELLS) continue; this.cells++; }
          ch.set(ci, v); ok.push(x, y, z, v);
        }
        if (!ok.length) return;
        this.dirty = true; this.hello = null;
        this.sendAll({ t: 'ed', e: ok }, c); return;
      }
      case 'chest': {  // a chest's slots (null: it's gone)
        const k = String(m.k || ''); if (!/^-?\d+,\d+,-?\d+$/.test(k)) return;
        if (m.s === null) { if (this.chests.delete(k)) { this.dirty = true; this.hello = null; this.sendAll({ t: 'chest', k, s: null }, c); } return; }
        if (!Array.isArray(m.s) || m.s.length !== 27 || this.chests.size > 20000) return;
        const s = m.s.map(it => okItem(it) ? { id: it.id, n: it.n, d: Number.isInteger(it.d) ? it.d : 0 } : null);
        this.chests.set(k, s); this.dirty = true; this.hello = null;
        this.sendAll({ t: 'chest', k, s }, c); return;
      }
      case 'c': {      // chat
        const s = this.clean(String(m.m || '').replace(/§.?/g, '').slice(0, 120).trim()); if (!s || now - c.chatAt < 800) return;
        c.chatAt = now; this.sendAll({ t: 'c', m: '<' + c.name + '> ' + s }); return;
      }
      case 'die': {    // their death message, for everyone else
        const s = this.clean(String(m.m || '').replace(/§.?/g, '').slice(0, 120)); if (s && now - c.chatAt > 300) { c.chatAt = now; this.sendAll({ t: 'c', m: s }, c); } return;
      }
      case 'hit': {    // a hit on someone (a sword in reach, an arrow further)
        const o = [...this.clients].find(q => q.id === m.id); if (!o || !o.st || !c.st || o === c) return;
        if (now - c.hitAt < 200 || !num(m.d, 0, 20) || Math.hypot(o.st[0] - c.st[0], o.st[1] - c.st[1], o.st[2] - c.st[2]) > 64) return;
        c.hitAt = now;
        this.send(o, { t: 'hurt', d: m.d, kb: num(m.kb, 0, 2) ? m.kb : 0.5, by: c.name, bid: c.id, x: c.st[0], z: c.st[2] }); return;
      }
      case 'loot': {   // what someone they killed was carrying
        const o = [...this.clients].find(q => q.id === m.to); if (!o || o === c || !Array.isArray(m.s) || m.s.length > 41) return;
        const s = m.s.filter(okItem).map(it => ({ id: it.id, n: it.n, d: Number.isInteger(it.d) ? it.d : 0 }));
        if (s.length && num(m.x, -1e5, 1e5) && num(m.y, -256, 512) && num(m.z, -1e5, 1e5)) this.send(o, { t: 'loot', s, x: m.x, y: m.y, z: m.z }); return;
      }
      case 'fx': {     // a lit TNT or a blast, for the others to see and feel
        if (!FX.has(m.k) || c.fx < 1 || !num(m.x, -1e5, 1e5) || !num(m.y, -256, 512) || !num(m.z, -1e5, 1e5)) return;
        c.fx--;
        this.sendAll({ t: 'fx', k: m.k, x: m.x, y: m.y, z: m.z, r: num(m.r, 0, 8) ? m.r : 4, f: num(m.f, 0, 200) ? m.f | 0 : 80 }, c); return;
      }
    }
  }
}
