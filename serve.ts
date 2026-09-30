// RuneSkate server: static files + accounts + multiplayer relay.   bun runeskate/serve.ts [port]
//
// Sign up / log in straight from the URL like rs-sdk:  http://host:8123/?name=Zezima&password=hunter2
// (an unknown name is registered on the spot). Accounts live in runeskate/data/accounts.json:
// hashed password, outfit, points (= total XP). Everything else is relayed peer state.
import { join, normalize } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'fs';
import { XP_AT, MAX_LEVEL } from './src/levels.js';
import { cleanChat } from './profanity.ts';
import { PORTAL_HOME, PORTAL_DESTS, CORE_SPAWNS } from './src/mapdata.js';
import { EXTRA_SPAWNS } from './src/npc-spawns.js';
const ROOT = import.meta.dir;
const port = Number(process.argv[2] || process.env.PORT || 8123);

// ------------------------------------------------------------------ accounts
const DATA = join(ROOT, 'data'); mkdirSync(DATA, { recursive: true });
const ACC = join(DATA, 'accounts.json');
type Account = { name: string; login?: string; hash: string; outfit: any | null; xp: number; created: number; seen: number; prog?: { found: string[]; done: string[] } };
const accounts: Record<string, Account> = existsSync(ACC) ? JSON.parse(readFileSync(ACC, 'utf8')) : {};
let dirty = false;
const saveAccounts = () => { if (!dirty) return; dirty = false; writeFileSync(ACC + '.tmp', JSON.stringify(accounts)); renameSync(ACC + '.tmp', ACC); };
setInterval(saveAccounts, 2000);
// a restart (every deploy) must not drop the last couple of seconds of XP
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => { try { saveAccounts(); saveStats(); } finally { process.exit(0); } });
const key = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, '');
const cleanName = (n: string) => String(n || '').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 12);
const MAX_XP = 6_488_304 * 4;                                  // headroom past level 126
const MAXED = XP_AT[MAX_LEVEL];                                // 6,488,304: past this, runes decide the rank
// the only runes that exist (tools/runes.py). Anything else in an account - ids from before the list was
// fixed, when a map change moved them - is dropped, so nobody keeps credit for collecting one twice.
const RUNE_IDS = new Set(JSON.parse(readFileSync(join(ROOT, 'assets', 'runes.json'), 'utf8')).runes.map((r: any) => r.id));
for (const a of Object.values(accounts)) if (a.prog) {
  const f = [...new Set(a.prog.found.filter(id => RUNE_IDS.has(id)))];
  if (f.length !== a.prog.found.length) { a.prog.found = f; dirty = true; }
}
const runesOf = (a: Account) => a.prog?.found.length || 0;

// ------------------------------------------------------------------ the owner (optional)
// RUNESKATE_OWNER=<login> makes that account the server owner: crown + [OWNER] tag, gilded armour, a gold board,
// the rune scimitar and ::noclip. RUNESKATE_OWNER_NAME=<display name> shows it under another name (tags, chat,
// highscores) while you still log in as RUNESKATE_OWNER. Unset = nobody is owner.
// The owner flag comes from the account key on the server, so nobody can claim it from a client.
const OWNER_KEY = key(process.env.RUNESKATE_OWNER || ''), OWNER_NAME = cleanName(process.env.RUNESKATE_OWNER_NAME || '');
const SCIMITAR = 1333;                // rune scimitar: the owner's weapon (slot 3), click to smack a skater down
const GILDED = { g: 0, gild: 1, kits: {}, items: { 0: 2619, 1: 1052, 2: 1702, 3: SCIMITAR, 4: 2615, 5: 2621, 7: 2617, 9: 2489, 10: 88 } };
// names nobody else may register: staff lookalikes, and the owner's display name (+ RUNESKATE_RESERVED=a,b,c)
const RESERVED = new Set(['owner', 'admin', 'administrator', 'mod', 'jmod', 'moderator', 'staff',
  ...(OWNER_NAME ? [key(OWNER_NAME)] : []), ...(process.env.RUNESKATE_RESERVED || '').split(',').map(key).filter(Boolean)]);
const isOwner = (k: string) => !!OWNER_KEY && k === OWNER_KEY;
{
  const a = OWNER_KEY ? accounts[OWNER_KEY] : undefined;
  if (a) {
    if (OWNER_NAME && a.name !== OWNER_NAME) { a.login ||= a.name; a.name = OWNER_NAME; dirty = true; }
    if (!a.outfit?.gild) { a.outfit = structuredClone(GILDED); dirty = true; }
    if (a.outfit.items?.[3] !== SCIMITAR) { a.outfit.items[3] = SCIMITAR; dirty = true; }
  }
}

// outfits: {g, items: {slot: objId}, kits: {slot: idkId}} and nothing else.
function cleanOutfit(o: any, owner = false) {
  if (!o || typeof o !== 'object') return null;
  const map = (src: any, ban?: Set<number>) => {
    const out: Record<number, number> = {};
    for (const [k, v] of Object.entries(src || {}).slice(0, 12)) {
      const slot = +k, id = Math.floor(+(v as any));
      if (slot >= 0 && slot < 12 && id >= 0 && id < 65536 && !ban?.has(id)) out[slot] = id;
    }
    return out;
  };
  const items = map(o.items);
  if (owner) items[3] = SCIMITAR; else delete items[3];         // weapons are the owner's alone
  return { g: o.g ? 1 : 0, items, kits: map(o.kits), ...(owner ? { gild: 1 } : {}) };   // party hats allowed since 2026-09-29
}

// ------------------------------------------------------------------ public stats (/stats)
// Player count: one sample every 5 minutes = [unix minutes, players now, peak in the window], kept 30 days
// (~8.6k tiny rows). Chat: every message for the last 7 days, older lines dropped automatically.
const STATS = join(DATA, 'stats.json'), CHAT = join(DATA, 'chat.json');
const SAMPLE_MS = 5 * 60_000, KEEP_SAMPLES_MS = 30 * 86_400_000, KEEP_CHAT_MS = 7 * 86_400_000, MAX_CHAT = 20_000;
const loadJson = (f: string, d: any) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const samples: [number, number, number][] = loadJson(STATS, []);
let chatLog: { t: number; n: string; m: string; o?: number }[] = loadJson(CHAT, []);
let peak = 0, statsDirty = false;
for (const c of chatLog) { const m = cleanChat(c.m); if (m !== c.m) { c.m = m; statsDirty = true; } }   // scrub history written before the filter
const writeJson = (f: string, v: any) => { writeFileSync(f + '.tmp', JSON.stringify(v)); renameSync(f + '.tmp', f); };
const saveStats = () => { if (!statsDirty) return; statsDirty = false; writeJson(STATS, samples); writeJson(CHAT, chatLog); };
function pruneChat() {
  const cut = Date.now() - KEEP_CHAT_MS; let i = 0;
  while (i < chatLog.length && chatLog[i].t < cut) i++;
  if (i) { chatLog = chatLog.slice(i); statsDirty = true; }
  if (chatLog.length > MAX_CHAT) { chatLog = chatLog.slice(-MAX_CHAT); statsDirty = true; }
}
setInterval(() => {
  samples.push([Math.floor(Date.now() / 60_000), sessions.size, Math.max(peak, sessions.size)]); peak = sessions.size;
  const cut = Math.floor((Date.now() - KEEP_SAMPLES_MS) / 60_000);
  while (samples.length && samples[0][0] < cut) samples.shift();
  pruneChat(); statsDirty = true; saveStats();
}, SAMPLE_MS);
setInterval(saveStats, 30_000);
const STATS_HTML = readFileSync(join(ROOT, 'stats.html'), 'utf8');
const MAP_HTML = readFileSync(join(ROOT, 'map.html'), 'utf8');
// the /map page: everything that never moves, sent once (world tiles)
const CORE_JSON = (({ name, title, x0, z0, w, h, baseX, baseZ, regions }) => ({ name, title, x0, z0, w, h, baseX, baseZ, regions }))(JSON.parse(readFileSync(join(ROOT, 'assets', 'world.json'), 'utf8')));
const BASE = [CORE_JSON.baseX, CORE_JSON.baseZ];
const MAP_STATIC = (() => {
  const npcs: Record<string, number[][]> = {};
  for (const src of [CORE_SPAWNS, EXTRA_SPAWNS]) for (const [k, v] of Object.entries(src as Record<string, number[][]>)) (npcs[k] ||= []).push(...v);
  return {
    img: { src: '/assets/map.png', x0: 2880, z1: 3968, px: 2 },             // tools/mapimg.py
    regions: [CORE_JSON, ...(CORE_JSON.regions || [])].map((r: any) => ({ title: r.title, x: r.x0 + BASE[0], z: r.z0 + BASE[1], w: r.w, h: r.h })),
    runes: JSON.parse(readFileSync(join(ROOT, 'assets', 'runes.json'), 'utf8')).runes.map((r: any) => ({ kind: r.kind, x: r.x, z: r.z, high: !!r.high })),
    portals: [...PORTAL_DESTS.map((d: any) => ({ name: d.name, x: d.pad[0], z: d.pad[1], col: d.col, home: 1 })),
      ...PORTAL_DESTS.map((d: any) => ({ name: 'to Lumbridge', x: d.back[0], z: d.back[1], col: PORTAL_HOME.col }))],
    npcs, spawn: [3222, 3218],
  };
})();

// ------------------------------------------------------------------ static files
// Fast public loading: pre-compressed .br/.gz siblings (tools/compress.ts), on-the-fly gzip for the small
// source files, and an ETag on everything so a returning player revalidates (a 304) instead of
// re-downloading the 12 MB world. vendor/ never changes, so the browser may keep it for a day.
const TYPES: Record<string, string> = { js: 'text/javascript; charset=utf-8', json: 'application/json', html: 'text/html; charset=utf-8', bin: 'application/octet-stream', png: 'image/png', css: 'text/css' };
const gzCache = new Map<string, { m: number; buf: Uint8Array }>();
async function sendFile(req: Request, full: string) {
  let st; try { st = statSync(full); } catch { return new Response('not found', { status: 404 }); }
  if (!st.isFile()) return new Response('not found', { status: 404 });
  const ext = full.slice(full.lastIndexOf('.') + 1).toLowerCase();
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const headers: Record<string, string> = {
    ETag: etag, Vary: 'Accept-Encoding', 'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': /[\\/]vendor[\\/]/.test(full) ? 'public, max-age=86400' : 'no-cache',
  };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  const ae = req.headers.get('accept-encoding') || '';
  for (const [enc, suf] of [['br', '.br'], ['gzip', '.gz']]) {
    if (!ae.includes(enc)) continue;
    try { if (statSync(full + suf).mtimeMs >= st.mtimeMs - 2000) return new Response(Bun.file(full + suf), { headers: { ...headers, 'Content-Encoding': enc } }); } catch {}
  }
  if (ae.includes('gzip') && st.size > 1024 && /^(js|json|html|css)$/.test(ext)) {
    let c = gzCache.get(full);
    if (!c || c.m !== st.mtimeMs) gzCache.set(full, c = { m: st.mtimeMs, buf: Bun.gzipSync(readFileSync(full)) });
    return new Response(c.buf, { headers: { ...headers, 'Content-Encoding': 'gzip' } });
  }
  return new Response(Bun.file(full), { headers });
}

// ------------------------------------------------------------------ sessions
type Sess = { id: number; name: string; k: string; own?: number; st: any; ws: any; xp: number; outfit: any; lastHit?: number };
const sessions = new Map<number, Sess>();
let nextId = 1;
const pub = (s: Sess) => ({ id: s.id, name: s.name, own: s.own, xp: s.xp, outfit: s.outfit, st: s.st });
const broadcast = (msg: any, except?: number) => { const m = JSON.stringify(msg); for (const s of sessions.values()) if (s.id !== except) s.ws.send(m); };

Bun.serve({
  port,
  async fetch(req, server) {
    const url = new URL(req.url);
    let p = decodeURIComponent(url.pathname);
    if (p === '/ws') return server.upgrade(req, { data: { sess: null } }) ? undefined : new Response('upgrade failed', { status: 400 });
    if (p === '/api/top') {                                         // leaderboard: all accounts by XP
      const online = new Set([...sessions.values()].map(s => s.k));
      // rank by XP up to max level, then runes found, then raw XP
      return Response.json(Object.entries(accounts)
        .sort((a, b) => Math.min(b[1].xp, MAXED) - Math.min(a[1].xp, MAXED) || runesOf(b[1]) - runesOf(a[1]) || b[1].xp - a[1].xp).slice(0, 15)
        .map(([k, a]) => ({ name: a.name, own: isOwner(k) ? 1 : undefined, xp: a.xp, runes: runesOf(a), runeTotal: RUNE_IDS.size, on: online.has(k) })));
    }
    if (p === '/map' || p === '/map/') return new Response(MAP_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
    if (p === '/api/map') return Response.json(MAP_STATIC, { headers: { 'Cache-Control': 'no-cache' } });
    if (p === '/api/live') {                                         // who is where right now (world tiles)
      return Response.json([...sessions.values()].filter(s => s.st && typeof s.st.x === 'number').map(s => {
        const a = accounts[s.k];
        return { name: s.name, own: s.own ? 1 : undefined, x: Math.round((s.st.x + BASE[0]) * 10) / 10, z: Math.round((s.st.z + BASE[1]) * 10) / 10,
          mode: s.st.mode, runes: a ? runesOf(a) : 0 };
      }), { headers: { 'Cache-Control': 'no-cache' } });
    }
    if (p === '/api/players') return Response.json([...sessions.values()].map(s => ({ name: s.name, xp: s.xp })));
    if (p === '/stats' || p === '/stats/') return new Response(STATS_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
    if (p === '/api/stats') {                                       // everything /stats draws, gzipped by the tunnel
      pruneChat();
      const days = Math.min(30, Math.max(1, +(url.searchParams.get('days') || 7)));
      const since = Math.floor(Date.now() / 60_000) - days * 1440;
      return Response.json({ now: sessions.size, accounts: Object.keys(accounts).length, every: SAMPLE_MS / 60_000,
        samples: samples.filter(s => s[0] >= since), chat: chatLog },
        { headers: { 'Cache-Control': 'no-cache' } });
    }
    // dev hook: the page POSTs rendered frames here (RS.shot) so they can be inspected offline
    if (req.method === 'POST' && p.startsWith('/__shot/') && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(url.host)) {
      const name = p.slice(8).replace(/[^\w.-]/g, '');
      const data = (await req.text()).replace(/^data:image\/png;base64,/, '');
      await Bun.write(join(ROOT, 'test', 'shots', name + '.png'), Buffer.from(data, 'base64'));
      return new Response('ok');
    }
    if (p === '/' || p === '') p = '/index.html';
    const full = normalize(join(ROOT, p));
    if (!full.startsWith(normalize(ROOT)) || full.startsWith(normalize(DATA))) return new Response('no', { status: 403 });
    return sendFile(req, full);
  },
  websocket: {
    async message(ws: any, raw) {
      let m: any; try { m = JSON.parse(String(raw)); } catch { return; }
      const s: Sess | null = ws.data.sess;
      if (!s) {
        if (m.t !== 'hello' || ws.data.busy) return;
        ws.data.busy = true;
        try {
          const name = cleanName(m.name), k = key(name), pw = String(m.password || '');
          if (!k || pw.length < 3) return ws.send(JSON.stringify({ t: 'denied', why: 'pick a name (letters/numbers) and a password of 3+ characters' }));
          let a = accounts[k], isNew = false;
          if (!a && RESERVED.has(k)) return ws.send(JSON.stringify({ t: 'denied', why: 'that name is reserved - pick another' }));
          if (!a) {
            a = accounts[k] = { name, hash: await Bun.password.hash(pw), outfit: null, xp: 0, created: Date.now(), seen: Date.now() };
            isNew = true; dirty = true;
          } else if (!(await Bun.password.verify(pw, a.hash))) return ws.send(JSON.stringify({ t: 'denied', why: 'wrong password for ' + a.name }));
          for (const o of sessions.values()) if (o.k === k) { o.ws.send(JSON.stringify({ t: 'kicked', why: 'logged in elsewhere' })); o.ws.close(); sessions.delete(o.id); broadcast({ t: 'leave', id: o.id }); }
          const sess: Sess = { id: nextId++, name: a.name, own: isOwner(k) ? 1 : undefined, k, st: null, ws, xp: a.xp, outfit: a.outfit };
          ws.data.sess = sess; sessions.set(sess.id, sess); peak = Math.max(peak, sessions.size);
          a.seen = Date.now(); dirty = true;
          ws.send(JSON.stringify({ t: 'welcome', id: sess.id, name: a.name, login: a.login || a.name, own: sess.own, xp: a.xp, outfit: a.outfit, isNew, prog: a.prog || { found: [], done: [] }, recent: chatLog.slice(-20).map(c => ({ n: c.n, m: c.m, o: c.o })), players: [...sessions.values()].filter(o => o !== sess).map(pub) }));
          broadcast({ t: 'join', ...pub(sess) }, sess.id);
        } finally { ws.data.busy = false; }
        return;
      }
      if (m.t === 'st') {                                       // ~15 Hz skater state, relayed verbatim (small)
        s.st = m.s; broadcast({ t: 'st', id: s.id, s: m.s }, s.id);
      } else if (m.t === 'xp') {                                 // banked combo points
        const add = Math.max(0, Math.min(250_000, Math.floor(+m.add || 0)));
        s.xp = Math.min(MAX_XP, s.xp + add); accounts[s.k].xp = s.xp; dirty = true;
        broadcast({ t: 'xp', id: s.id, xp: s.xp }, s.id);
      } else if (m.t === 'outfit') {
        m.outfit = cleanOutfit(m.outfit, isOwner(s.k)); if (!m.outfit) return;
        s.outfit = m.outfit; accounts[s.k].outfit = m.outfit; dirty = true;
        broadcast({ t: 'outfit', id: s.id, outfit: m.outfit }, s.id);
      } else if (m.t === 'prog') {                               // a rune found / a challenge beaten
        const a = accounts[s.k]; a.prog ||= { found: [], done: [] };
        const id = String(m.id || '').slice(0, 40), list = m.kind === 'spot' ? a.prog.done : m.kind === 'rune' ? a.prog.found : null;
        if (list === a.prog.found && !RUNE_IDS.has(id)) return;   // not a real rune
        if (list && id && !list.includes(id) && list.length < 500) { list.push(id); dirty = true; }
      } else if (m.t === 'hit') {                                // owner's scimitar: knock another skater down
        if (!isOwner(s.k)) return;
        const now = Date.now(); if (now - (s.lastHit || 0) < 400) return; s.lastHit = now;
        const tgt = sessions.get(Math.floor(+m.id)); if (!tgt || tgt === s) return;
        const dx = +m.dx || 0, dz = +m.dz || 0, L = Math.hypot(dx, dz) || 1;
        tgt.ws.send(JSON.stringify({ t: 'hit', by: s.id, name: s.name, dx: dx / L, dz: dz / L }));
      } else if (m.t === 'say') {
        const text = cleanChat(String(m.text || '').slice(0, 80).trim()).slice(0, 80);
        if (text) { broadcast({ t: 'say', id: s.id, name: s.name, own: s.own, text }); chatLog.push({ t: Date.now(), n: s.name, m: text, ...(s.own ? { o: 1 } : {}) }); statsDirty = true; }
      }
    },
    close(ws: any) {
      const s: Sess | null = ws.data.sess;
      if (s && sessions.get(s.id) === s) { sessions.delete(s.id); broadcast({ t: 'leave', id: s.id }); }
    },
  },
});
console.log(`RuneSkate on http://localhost:${port}`);
