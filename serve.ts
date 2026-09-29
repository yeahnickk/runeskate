// RuneSkate server: static files + accounts + multiplayer relay.   bun runeskate/serve.ts [port]
//
// Sign up / log in straight from the URL like rs-sdk:  http://host:8123/?name=Zezima&password=hunter2
// (an unknown name is registered on the spot). Accounts live in runeskate/data/accounts.json:
// hashed password, outfit, points (= total XP). Everything else is relayed peer state.
import { join, normalize } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
const ROOT = import.meta.dir;
const port = Number(process.argv[2] || process.env.PORT || 8123);

// ------------------------------------------------------------------ accounts
const DATA = join(ROOT, 'data'); mkdirSync(DATA, { recursive: true });
const ACC = join(DATA, 'accounts.json');
type Account = { name: string; hash: string; outfit: any | null; xp: number; created: number; seen: number; prog?: { found: string[]; done: string[] } };
const accounts: Record<string, Account> = existsSync(ACC) ? JSON.parse(readFileSync(ACC, 'utf8')) : {};
let dirty = false;
setInterval(() => { if (!dirty) return; dirty = false; writeFileSync(ACC + '.tmp', JSON.stringify(accounts)); renameSync(ACC + '.tmp', ACC); }, 2000);
const key = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, '');
const cleanName = (n: string) => String(n || '').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 12);
const MAX_XP = 6_488_304 * 4;                                  // headroom past level 126

// outfits: {g, items: {slot: objId}, kits: {slot: idkId}} and nothing else. Party hats (obj 1038-1049)
// are refused outright; the client never offers them either.
const PHAT = new Set([1038, 1039, 1040, 1041, 1042, 1043, 1044, 1045, 1046, 1047, 1048, 1049]);
function cleanOutfit(o: any) {
  if (!o || typeof o !== 'object') return null;
  const map = (src: any, ban?: Set<number>) => {
    const out: Record<number, number> = {};
    for (const [k, v] of Object.entries(src || {}).slice(0, 12)) {
      const slot = +k, id = Math.floor(+(v as any));
      if (slot >= 0 && slot < 12 && id >= 0 && id < 65536 && !ban?.has(id)) out[slot] = id;
    }
    return out;
  };
  return { g: o.g ? 1 : 0, items: map(o.items, PHAT), kits: map(o.kits) };
}

// ------------------------------------------------------------------ sessions
type Sess = { id: number; name: string; k: string; st: any; ws: any; xp: number; outfit: any };
const sessions = new Map<number, Sess>();
let nextId = 1;
const pub = (s: Sess) => ({ id: s.id, name: s.name, xp: s.xp, outfit: s.outfit, st: s.st });
const broadcast = (msg: any, except?: number) => { const m = JSON.stringify(msg); for (const s of sessions.values()) if (s.id !== except) s.ws.send(m); };

Bun.serve({
  port,
  async fetch(req, server) {
    const url = new URL(req.url);
    let p = decodeURIComponent(url.pathname);
    if (p === '/ws') return server.upgrade(req, { data: { sess: null } }) ? undefined : new Response('upgrade failed', { status: 400 });
    if (p === '/api/top') {                                         // leaderboard: all accounts by XP
      const online = new Set([...sessions.values()].map(s => s.k));
      return Response.json(Object.entries(accounts).sort((a, b) => b[1].xp - a[1].xp).slice(0, 15)
        .map(([k, a]) => ({ name: a.name, xp: a.xp, runes: a.prog?.found.length || 0, spots: a.prog?.done.length || 0, on: online.has(k) })));
    }
    if (p === '/api/players') return Response.json([...sessions.values()].map(s => ({ name: s.name, xp: s.xp })));
    // dev hook: the page POSTs rendered frames here (RS.shot) so they can be inspected offline
    if (req.method === 'POST' && p.startsWith('/__shot/')) {
      const name = p.slice(8).replace(/[^\w.-]/g, '');
      const data = (await req.text()).replace(/^data:image\/png;base64,/, '');
      await Bun.write(join(ROOT, 'test', 'shots', name + '.png'), Buffer.from(data, 'base64'));
      return new Response('ok');
    }
    if (p === '/' || p === '') p = '/index.html';
    const full = normalize(join(ROOT, p));
    if (!full.startsWith(normalize(ROOT)) || full.startsWith(normalize(DATA))) return new Response('no', { status: 403 });
    const gz = Bun.file(full + '.gz');
    if ((req.headers.get('accept-encoding') || '').includes('gzip') && await gz.exists())
      return new Response(gz, { headers: { 'Cache-Control': 'no-cache', 'Content-Encoding': 'gzip', 'Content-Type': 'application/octet-stream' } });
    const f = Bun.file(full);
    if (!(await f.exists())) return new Response('not found', { status: 404 });
    return new Response(f, { headers: { 'Cache-Control': 'no-cache' } });
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
          if (!a) {
            a = accounts[k] = { name, hash: await Bun.password.hash(pw), outfit: null, xp: 0, created: Date.now(), seen: Date.now() };
            isNew = true; dirty = true;
          } else if (!(await Bun.password.verify(pw, a.hash))) return ws.send(JSON.stringify({ t: 'denied', why: 'wrong password for ' + a.name }));
          for (const o of sessions.values()) if (o.k === k) { o.ws.send(JSON.stringify({ t: 'kicked', why: 'logged in elsewhere' })); o.ws.close(); sessions.delete(o.id); broadcast({ t: 'leave', id: o.id }); }
          const sess: Sess = { id: nextId++, name: a.name, k, st: null, ws, xp: a.xp, outfit: a.outfit };
          ws.data.sess = sess; sessions.set(sess.id, sess);
          a.seen = Date.now(); dirty = true;
          ws.send(JSON.stringify({ t: 'welcome', id: sess.id, name: a.name, xp: a.xp, outfit: a.outfit, isNew, prog: a.prog || { found: [], done: [] }, players: [...sessions.values()].filter(o => o !== sess).map(pub) }));
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
        m.outfit = cleanOutfit(m.outfit); if (!m.outfit) return;
        s.outfit = m.outfit; accounts[s.k].outfit = m.outfit; dirty = true;
        broadcast({ t: 'outfit', id: s.id, outfit: m.outfit }, s.id);
      } else if (m.t === 'prog') {                               // a rune found / a challenge beaten
        const a = accounts[s.k]; a.prog ||= { found: [], done: [] };
        const id = String(m.id || '').slice(0, 40), list = m.kind === 'spot' ? a.prog.done : m.kind === 'rune' ? a.prog.found : null;
        if (list && id && !list.includes(id) && list.length < 500) { list.push(id); dirty = true; }
      } else if (m.t === 'say') {
        const text = String(m.text || '').slice(0, 80).trim();
        if (text) broadcast({ t: 'say', id: s.id, name: s.name, text });
      }
    },
    close(ws: any) {
      const s: Sess | null = ws.data.sess;
      if (s && sessions.get(s.id) === s) { sessions.delete(s.id); broadcast({ t: 'leave', id: s.id }); }
    },
  },
});
console.log(`RuneSkate on http://localhost:${port}`);
