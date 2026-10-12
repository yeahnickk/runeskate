// CartScape's highscores: the fastest three-lap times per class, one row per name (their best). Pure (serve.ts keeps
// the board in data/cart.json; test/cart.js checks the rules). The race runs in the browser, so a time is only taken
// if it's believable: three laps that add up to it, none quicker than a lap can be driven in that class.
export const CLASSES = ['mithril', 'rune', 'dragon'];
export const DIFFS = ['easy', 'normal', 'hard'];
export const LAP_FLOOR = { mithril: 23, rune: 20, dragon: 17 };   // (s: the lap at 1.5x the class's top speed the whole way, which boosts can't keep up; real best laps ~30 / 25 / 23)
const KEEP = 50;
const clean = n => String(n || '').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 12);

/** e: { name, cc, diff, t, laps: [3 lap times], kart, theme }. Returns { ok, why?, rank?, best? } and updates board */
export function addScore(board, e, now = Date.now()) {
  const name = clean(e?.name), cc = e?.cc, laps = e?.laps, t = +e?.t;
  if (!name) return { ok: false, why: 'name' };
  if (!CLASSES.includes(cc)) return { ok: false, why: 'class' };
  if (!Array.isArray(laps) || laps.length !== 3 || laps.some(l => !(+l >= LAP_FLOOR[cc] && +l < 400))) return { ok: false, why: 'laps' };
  if (!(t > 0) || Math.abs(laps.reduce((a, b) => a + +b, 0) - t) > 0.25) return { ok: false, why: 'time' };
  const row = { name, t: Math.round(t * 100) / 100, lap: Math.round(Math.min(...laps) * 100) / 100, diff: DIFFS.includes(e.diff) ? e.diff : 'normal',
    kart: String(e.kart || '').slice(0, 8), theme: String(e.theme || '').slice(0, 8), at: now };
  const list = board[cc] ||= [], key = name.toLowerCase(), old = list.find(r => r.name.toLowerCase() === key);
  if (old && old.t <= row.t) return { ok: true, rank: list.indexOf(old) + 1, best: old.t, kept: true };
  if (old) list.splice(list.indexOf(old), 1);
  list.push(row); list.sort((a, b) => a.t - b.t || a.at - b.at); list.length = Math.min(list.length, KEEP);
  const rank = list.indexOf(row) + 1;
  return rank ? { ok: true, rank, best: row.t } : { ok: true, rank: 0, best: row.t };
}

/** the boards as served: the top 10 a class */
export const topOf = board => Object.fromEntries(CLASSES.map(cc => [cc, (board[cc] || []).slice(0, 10)]));
