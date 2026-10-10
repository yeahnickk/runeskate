// RuneSkate server: static files + accounts + multiplayer relay.   bun runeskate/serve.ts [port]
//
// Sign up / log in straight from the URL like rs-sdk:  http://host:8123/?name=Zezima&password=hunter2
// (an unknown name is registered on the spot). Accounts live in runeskate/data/accounts.json:
// hashed password, outfit, points (= total XP). Everything else is relayed peer state.
import { join, normalize } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'fs';
import { cleanChat } from './profanity.ts';
import { PORTAL_HOME, PORTAL_DESTS, CORE_SPAWNS } from './src/mapdata.js';
import { EXTRA_SPAWNS } from './src/npc-spawns.js';
import { SPOTS_ALL } from './src/spots.js';
import { cleanPark, footprint, PARK_PER, PARK_MAX } from './src/park-shape.js';
const ROOT = import.meta.dir;
const port = Number(process.argv[2] || process.env.PORT || 8123);

// ------------------------------------------------------------------ accounts
const DATA = process.env.RUNESKATE_DATA || join(ROOT, 'data'); mkdirSync(DATA, { recursive: true });   // (tests point it at a temp dir)
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
// highscores have no ceiling. What stops a hacked client from posting billions is the rate: one banked combo is
// at most XP_PER_MSG and a session earns at most XP_PER_MIN (a token bucket), far above any real run.
const XP_PER_MSG = 250_000, XP_PER_MIN = 900_000;
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
// ------------------------------------------------------------------ Create-a-Park + own-the-spot
// Parks: rails, ledges and kickers players drop into the world for everyone (src/park-shape.js), PARK_PER each.
// Spots: the best combo banked at each challenge spot owns it (name on the spot for everyone to see).
const PARKS = join(DATA, 'parks.json'), SPOTS_F = join(DATA, 'spots.json');
type ParkObj = { id: number; k: string; by: string; kind: string; x: number; z: number; dir: number; len: number; t: number };
const parks: ParkObj[] = loadJson(PARKS, []);
const spotBest: Record<string, { name: string; score: number; t: number }> = loadJson(SPOTS_F, {});
const SPOT_IDS = new Set(SPOTS_ALL.map((s: any) => s.id));
let parkId = parks.reduce((m, o) => Math.max(m, o.id), 0) + 1, parksDirty = false, spotsDirty = false;
const pubPark = ({ id, by, kind, x, z, dir, len }: ParkObj) => ({ id, by, kind, x, z, dir, len });
const saveParks = () => { if (parksDirty) { parksDirty = false; writeJson(PARKS, parks); } if (spotsDirty) { spotsDirty = false; writeJson(SPOTS_F, spotBest); } };
setInterval(saveParks, 3000);
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.prependListener(sig, () => { try { saveParks(); } catch {} });
const STATS_HTML = readFileSync(join(ROOT, 'stats.html'), 'utf8');
const MAP_HTML = readFileSync(join(ROOT, 'map.html'), 'utf8');
// the /map page: everything that never moves, sent once (world tiles)
const CORE_JSON = (({ name, title, x0, z0, w, h, baseX, baseZ, regions }) => ({ name, title, x0, z0, w, h, baseX, baseZ, regions }))(JSON.parse(readFileSync(join(ROOT, 'assets', 'world.json'), 'utf8')));
const BASE = [CORE_JSON.baseX, CORE_JSON.baseZ];
const MAP_STATIC = (() => {
  const npcs: Record<string, number[][]> = {};
  for (const src of [CORE_SPAWNS, EXTRA_SPAWNS]) for (const [k, v] of Object.entries(src as Record<string, number[][]>)) (npcs[k] ||= []).push(...v);
  return {
    img: { src: '/assets/map.png', x0: 2048, z1: 4032, px: 2 },             // tools/mapimg.py
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
type Sess = { id: number; name: string; k: string; own?: number; st: any; ws: any; xp: number; outfit: any; lastHit?: number; bucket?: number; bucketAt?: number; lastPark?: number; lastBank?: number; lastBankAt?: number };
const sessions = new Map<number, Sess>();
let nextId = 1;
const pub = (s: Sess) => ({ id: s.id, name: s.name, own: s.own, xp: s.xp, outfit: s.outfit, st: s.st });
const broadcast = (msg: any, except?: number) => { const m = JSON.stringify(msg); for (const s of sessions.values()) if (s.id !== except) s.ws.send(m); };

// ------------------------------------------------------------------ Game of S.K.A.T.E.
// Two skaters take turns: the setter lands a trick (it counts once the combo banks, so you have to ride it
// away), the other has to land the same one. Miss a match and you take a letter; miss a set and the turn
// passes. Five letters spells S.K.A.T.E. and loses. Tricks are judged by the clients' banked trick names; the
// server keeps the turns, the letters and the clock. The winner gets SKATE_WIN XP (once per pair per 10 min).
type Game = { p: [Sess, Sess]; letters: [number, number]; setter: number; phase: 'set' | 'match'; trick: string | null; until: number };
const games = new Map<number, Game>(), invites = new Map<number, { from: number; at: number }>(), paid = new Map<string, number>();
const SK_TURN = 25_000, SKATE_WIN = 10_000;
const gView = (g: Game) => ({ names: g.p.map(s => s.name), ids: g.p.map(s => s.id), letters: g.letters, setter: g.p[g.setter].id, phase: g.phase, trick: g.trick, left: Math.max(0, g.until - Date.now()) });
const gSend = (g: Game, msg: any) => { const m = JSON.stringify({ t: 'skate', ...msg, g: gView(g) }); for (const s of g.p) s.ws.send(m); };
const letters = (n: number) => 'SKATE'.slice(0, n).split('').join('.') + (n ? '.' : '');
function gTurn(g: Game, setter: number, msg: string) { g.setter = setter; g.phase = 'set'; g.trick = null; g.until = Date.now() + SK_TURN; gSend(g, { op: 'turn', msg }); }
function gEnd(g: Game, winner: Sess | null, why: string, reward = true) {
  for (const s of g.p) games.delete(s.id);
  const pair = g.p.map(s => s.k).sort().join('|');
  let xp = 0;
  if (winner && reward && Date.now() - (paid.get(pair) || 0) > 600_000) {
    paid.set(pair, Date.now()); xp = SKATE_WIN;
    winner.xp += xp; accounts[winner.k].xp = winner.xp; dirty = true; broadcast({ t: 'xp', id: winner.id, xp: winner.xp });
  }
  const m = JSON.stringify({ t: 'skate', op: 'end', winner: winner?.name || null, why, xp, g: gView(g) });
  for (const s of g.p) if (sessions.get(s.id) === s) s.ws.send(m);
}
function gResult(g: Game, s: Sess, ok: boolean, trick: string | null) {
  const me = g.p[0] === s ? 0 : 1, other = g.p[1 - me];
  if (g.phase === 'set') {
    if (me !== g.setter) return;
    if (ok && trick) { g.phase = 'match'; g.trick = trick; g.until = Date.now() + SK_TURN; gSend(g, { op: 'turn', msg: `${s.name} set a ${trick}. ${other.name}: match it!` }); }
    else gTurn(g, 1 - me, `${s.name} missed the set. ${other.name} sets.`);
  } else {
    if (me === g.setter) return;
    if (ok && trick === g.trick) return gTurn(g, g.setter, `${s.name} matched the ${trick}! ${other.name} sets again.`);
    g.letters[me]++;
    if (g.letters[me] >= 5) return gEnd(g, other, `${s.name} spelled S.K.A.T.E.`);
    gTurn(g, g.setter, `${s.name} missed the ${g.trick}: ${letters(g.letters[me])}`);
  }
}
setInterval(() => {
  for (const g of new Set(games.values())) if (Date.now() > g.until) gResult(g, g.phase === 'set' ? g.p[g.setter] : g.p[1 - g.setter], false, null);
}, 500);
function skateMsg(s: Sess, m: any) {
  const info = (text: string) => s.ws.send(JSON.stringify({ t: 'skate', op: 'info', msg: text }));
  if (m.op === 'challenge') {
    const tgt = [...sessions.values()].find(o => o.k === key(String(m.name || '')));
    if (!tgt) return info('Nobody called that is online.');
    if (tgt === s) return info("You can't play yourself.");
    if (games.has(s.id) || games.has(tgt.id)) return info('One of you is already in a game (::quit to leave yours).');
    invites.set(tgt.id, { from: s.id, at: Date.now() });
    tgt.ws.send(JSON.stringify({ t: 'skate', op: 'invite', from: s.name }));
    info(`Challenge sent to ${tgt.name}.`);
  } else if (m.op === 'accept') {
    const inv = invites.get(s.id); invites.delete(s.id);
    const from = inv && Date.now() - inv.at < 60_000 ? sessions.get(inv.from) : null;
    if (!from) return info('No challenge to accept (they expire after a minute).');
    if (games.has(s.id) || games.has(from.id)) return info('One of you is already in a game.');
    const g: Game = { p: [from, s], letters: [0, 0], setter: 0, phase: 'set', trick: null, until: 0 };
    games.set(from.id, g); games.set(s.id, g);
    gTurn(g, 0, `S.K.A.T.E.: ${from.name} vs ${s.name}. ${from.name} sets first.`);
  } else if (m.op === 'land' || m.op === 'miss') {
    const g = games.get(s.id); if (!g) return;
    gResult(g, s, m.op === 'land', m.op === 'land' ? String(m.trick || '').slice(0, 60) : null);
  } else if (m.op === 'quit') {
    const g = games.get(s.id); if (g) gEnd(g, g.p[g.p[0] === s ? 1 : 0], `${s.name} forfeited`);
  }
}

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
        .sort((a, b) => b[1].xp - a[1].xp || runesOf(b[1]) - runesOf(a[1])).slice(0, 15)
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
          ws.send(JSON.stringify({ t: 'welcome', id: sess.id, name: a.name, login: a.login || a.name, own: sess.own, xp: a.xp, outfit: a.outfit, isNew, prog: a.prog || { found: [], done: [] }, recent: chatLog.slice(-20).map(c => ({ n: c.n, m: c.m, o: c.o })), parks: parks.map(pubPark), spots: spotBest, players: [...sessions.values()].filter(o => o !== sess).map(pub) }));
          broadcast({ t: 'join', ...pub(sess) }, sess.id);
        } finally { ws.data.busy = false; }
        return;
      }
      if (m.t === 'st') {                                       // ~15 Hz skater state, relayed verbatim (small)
        s.st = m.s; broadcast({ t: 'st', id: s.id, s: m.s }, s.id);
      } else if (m.t === 'xp') {                                 // banked combo points
        const now = Date.now();
        s.bucket = Math.min(XP_PER_MIN, (s.bucket ?? XP_PER_MIN) + (now - (s.bucketAt || now)) / 60_000 * XP_PER_MIN); s.bucketAt = now;
        const add = Math.max(0, Math.min(XP_PER_MSG, s.bucket, Math.floor(+m.add || 0)));
        s.bucket -= add;
        s.xp += add; accounts[s.k].xp = s.xp; dirty = true;
        s.lastBank = add; s.lastBankAt = now;                    // own-the-spot: only a combo just banked can claim a spot
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
        if (m.kind === 'kill' && /^[a-z]{1,20}$/.test(id)) {           // the bestiary: kills per monster kind
          const kills = (a.prog as any).kills ||= {};
          if (id in kills || Object.keys(kills).length < 60) { kills[id] = Math.min(1e7, (kills[id] || 0) + 1); dirty = true; }
        }
      } else if (m.t === 'hit') {                                // owner's scimitar: knock another skater down
        if (!isOwner(s.k)) return;
        const now = Date.now(); if (now - (s.lastHit || 0) < 400) return; s.lastHit = now;
        const tgt = sessions.get(Math.floor(+m.id)); if (!tgt || tgt === s) return;
        const dx = +m.dx || 0, dz = +m.dz || 0, L = Math.hypot(dx, dz) || 1;
        tgt.ws.send(JSON.stringify({ t: 'hit', by: s.id, name: s.name, dx: dx / L, dz: dz / L }));
      } else if (m.t === 'park') {                               // Create-a-Park: place / remove an object
        const err = (why: string) => s.ws.send(JSON.stringify({ t: 'park', op: 'err', why }));
        if (m.op === 'add') {
          const now = Date.now(); if (now - (s.lastPark || 0) < 700) return; s.lastPark = now;
          const o = cleanPark(m.o); if (!o) return err("can't build there");
          if (!s.own && parks.filter(p => p.k === s.k).length >= PARK_PER) return err(`you have ${PARK_PER} pieces out - remove one first (Backspace near it)`);
          if (parks.length >= PARK_MAX) return err('the park is full - remove one of yours first');
          const taken = new Set(parks.flatMap(p => footprint(p).map(t => t.join(','))));
          if (footprint(o).some(t => taken.has(t.join(',')))) return err('something is already built there');
          const po: ParkObj = { ...o, id: parkId++, k: s.k, by: s.name, t: now };
          parks.push(po); parksDirty = true; broadcast({ t: 'park', op: 'add', o: pubPark(po) });
        } else if (m.op === 'del') {
          const i = parks.findIndex(p => p.id === Math.floor(+m.id) && (p.k === s.k || s.own));
          if (i < 0) return err('not yours to remove');
          const [o] = parks.splice(i, 1); parksDirty = true; broadcast({ t: 'park', op: 'del', id: o.id });
        }
      } else if (m.t === 'spot') {                               // own-the-spot: a banked combo at a challenge spot
        const id = String(m.id || ''), score = Math.floor(+m.score || 0);
        if (!SPOT_IDS.has(id) || !(score > 0) || !s.lastBank || Date.now() - (s.lastBankAt || 0) > 10_000 || score > s.lastBank) return;
        s.lastBank = 0;
        const cur = spotBest[id]; if (cur && cur.score >= score) return;
        spotBest[id] = { name: s.name, score, t: Date.now() }; spotsDirty = true;
        broadcast({ t: 'spot', id, name: s.name, score, prev: cur && cur.name !== s.name ? cur.name : null });
      } else if (m.t === 'skate') {                              // Game of S.K.A.T.E.
        skateMsg(s, m);
      } else if (m.t === 'say') {
        const text = cleanChat(String(m.text || '').slice(0, 80).trim()).slice(0, 80);
        if (text) { broadcast({ t: 'say', id: s.id, name: s.name, own: s.own, text }); chatLog.push({ t: Date.now(), n: s.name, m: text, ...(s.own ? { o: 1 } : {}) }); statsDirty = true; }
      }
    },
    close(ws: any) {
      const s: Sess | null = ws.data.sess;
      if (s && sessions.get(s.id) === s) {
        sessions.delete(s.id); broadcast({ t: 'leave', id: s.id });
        const g = games.get(s.id); if (g) gEnd(g, g.p[g.p[0] === s ? 1 : 0], `${s.name} left`, false);
        invites.delete(s.id);
      }
    },
  },
});
console.log(`RuneSkate on http://localhost:${port}`);
