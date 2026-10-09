// Points ARE total XP. Level curve = this server's own XP table (Player.ts: level + 2^(level/10) * 300,
// the one that puts 99 at 998,458) carried on to a 126 cap: early levels come in minutes, 99 is a real
// grind and 126 (6,488,304) is for the dedicated.
export const MAX_LEVEL = 126;
export const XP_AT = [0, 0];                               // XP_AT[L] = xp needed for level L
{ let t = 0; for (let l = 1; l < MAX_LEVEL; l++) { t += Math.floor(l + 300 * Math.pow(2, l / 10)); XP_AT[l + 1] = Math.floor(t / 4); } }
export function levelFor(xp) {
  let L = 1; while (L < MAX_LEVEL && xp >= XP_AT[L + 1]) L++;
  return L;
}
/** XP still needed for the next level (0 at the max level) */
export function xpToNext(xp) {
  const L = levelFor(xp); return L >= MAX_LEVEL ? 0 : XP_AT[L + 1] - xp;
}
/** 0..1 progress through the current level */
export function levelProgress(xp) {
  const L = levelFor(xp); if (L >= MAX_LEVEL) return 1;
  return (xp - XP_AT[L]) / (XP_AT[L + 1] - XP_AT[L]);
}
