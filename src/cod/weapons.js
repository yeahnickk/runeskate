// CODScape's armoury: real-world guns with Call of Duty style numbers. Pure data + maths (no three.js), so
// test/cod.js checks the time-to-kill and falloff headless.
// Units: health 100; distances in game units (~1 m; the arena is Castle Wars at WORLD_SCALE, ~96 units across);
// times in seconds; angles in degrees unless named *Rad.
//  dmg: [close, far] per bullet, falling linearly from range[0] to range[1]   mult: head / chest / stomach / limbs
//  rpm: rounds a minute ('semi' guns cap at it too)   mag/reserve: rounds   reload / reloadEmpty: tactical / empty
//  ads: seconds to aim down sights   sprintOut: sprint-to-fire   move: speed scale carried   zoom: FOV divisor ADS
//  spread: hipfire cone (deg) still -> moving, ads: cone aimed   recoil: [vertical, horizontal jitter] deg a shot
//  kind: how it cycles (auto / burst / semi / bolt / pump)  and how it reloads (mag / shells)

export const HP = 100, REGEN_DELAY = 4.5, REGEN_RATE = 40;      // COD: health comes back after a few seconds out of fire

export const WEAPONS = {
  // ---------------------------------------------------------------- assault rifles
  m4a1: { name: 'M4A1', cls: 'AR', kind: 'auto', dmg: [30, 22], range: [28, 55], mult: { head: 1.4, chest: 1.1, stomach: 1, limb: 1 },
    rpm: 800, mag: 30, reserve: 150, reload: 2.05, reloadEmpty: 2.55, ads: 0.25, sprintOut: 0.22, move: 0.96, zoom: 1.35,
    spread: [3.2, 5.5], adsSpread: 0.15, recoil: [0.42, 0.22], vel: 900, model: 'm4', sound: 'rifle', color: 0x2a2a2a },
  ak47: { name: 'AK-47', cls: 'AR', kind: 'auto', dmg: [40, 30], range: [26, 50], mult: { head: 1.4, chest: 1.1, stomach: 1, limb: 1 },
    rpm: 600, mag: 30, reserve: 150, reload: 2.3, reloadEmpty: 2.85, ads: 0.28, sprintOut: 0.25, move: 0.95, zoom: 1.35,
    spread: [3.6, 6], adsSpread: 0.2, recoil: [0.62, 0.36], vel: 715, model: 'ak', sound: 'rifleHeavy', color: 0x6b3d1e },
  scar: { name: 'SCAR-H', cls: 'AR', kind: 'auto', dmg: [49, 34], range: [30, 60], mult: { head: 1.35, chest: 1.05, stomach: 1, limb: 1 },
    rpm: 550, mag: 20, reserve: 120, reload: 2.2, reloadEmpty: 2.7, ads: 0.29, sprintOut: 0.26, move: 0.94, zoom: 1.4,
    spread: [3.6, 6], adsSpread: 0.18, recoil: [0.7, 0.3], vel: 800, model: 'scar', sound: 'rifleHeavy', color: 0xb59a6d },
  famas: { name: 'FAMAS', cls: 'AR', kind: 'burst', burst: 3, burstRpm: 1100, dmg: [40, 30], range: [30, 55], mult: { head: 1.4, chest: 1.1, stomach: 1, limb: 1 },
    rpm: 450, mag: 30, reserve: 150, reload: 2.4, reloadEmpty: 2.9, ads: 0.26, sprintOut: 0.23, move: 0.96, zoom: 1.4,
    spread: [3.2, 5.5], adsSpread: 0.12, recoil: [0.35, 0.15], vel: 925, model: 'famas', sound: 'rifle', color: 0x2a2a2a },
  // ---------------------------------------------------------------- submachine guns
  mp5: { name: 'MP5', cls: 'SMG', kind: 'auto', dmg: [30, 18], range: [11, 26], mult: { head: 1.3, chest: 1, stomach: 1, limb: 1 },
    rpm: 800, mag: 30, reserve: 180, reload: 1.9, reloadEmpty: 2.4, ads: 0.2, sprintOut: 0.16, move: 1.0, zoom: 1.25,
    spread: [2.4, 3.6], adsSpread: 0.35, recoil: [0.3, 0.25], vel: 400, model: 'mp5', sound: 'smg', color: 0x1c1c1c },
  mp7: { name: 'MP7', cls: 'SMG', kind: 'auto', dmg: [25, 16], range: [10, 24], mult: { head: 1.3, chest: 1, stomach: 1, limb: 1 },
    rpm: 950, mag: 40, reserve: 200, reload: 1.8, reloadEmpty: 2.2, ads: 0.19, sprintOut: 0.15, move: 1.02, zoom: 1.25,
    spread: [2.2, 3.4], adsSpread: 0.38, recoil: [0.26, 0.28], vel: 735, model: 'mp7', sound: 'smg', color: 0x232323 },
  ump45: { name: 'UMP45', cls: 'SMG', kind: 'auto', dmg: [35, 24], range: [12, 28], mult: { head: 1.3, chest: 1, stomach: 1, limb: 1 },
    rpm: 600, mag: 25, reserve: 175, reload: 2.0, reloadEmpty: 2.5, ads: 0.21, sprintOut: 0.17, move: 1.0, zoom: 1.25,
    spread: [2.4, 3.6], adsSpread: 0.3, recoil: [0.36, 0.22], vel: 285, model: 'ump', sound: 'smgHeavy', color: 0x262626 },
  // ---------------------------------------------------------------- light machine gun
  m249: { name: 'M249 SAW', cls: 'LMG', kind: 'auto', dmg: [35, 26], range: [32, 60], mult: { head: 1.3, chest: 1.05, stomach: 1, limb: 1 },
    rpm: 750, mag: 100, reserve: 200, reload: 5.2, reloadEmpty: 5.6, ads: 0.42, sprintOut: 0.38, move: 0.86, zoom: 1.4,
    spread: [4.4, 7], adsSpread: 0.25, recoil: [0.4, 0.35], vel: 915, model: 'm249', sound: 'rifleHeavy', color: 0x2e2e26 },
  // ---------------------------------------------------------------- snipers: one shot to the upper body
  intervention: { name: 'Intervention', cls: 'SNIPER', kind: 'bolt', bolt: 1.05, dmg: [98, 98], range: [999, 999], mult: { head: 3, chest: 1.6, stomach: 1.1, limb: 1 },
    rpm: 45, mag: 5, reserve: 30, reload: 3.0, reloadEmpty: 3.6, ads: 0.38, sprintOut: 0.35, move: 0.9, zoom: 6, scope: true,
    spread: [7, 10], adsSpread: 0, recoil: [3.2, 0.6], vel: 936, model: 'intervention', sound: 'sniper', color: 0x3b3d2c, noscope: 0.55 },
  barrett: { name: 'Barrett .50cal', cls: 'SNIPER', kind: 'semi', dmg: [100, 100], range: [999, 999], mult: { head: 3, chest: 1.5, stomach: 1.05, limb: 0.9 },
    rpm: 160, mag: 10, reserve: 30, reload: 3.4, reloadEmpty: 3.9, ads: 0.45, sprintOut: 0.4, move: 0.88, zoom: 7, scope: true,
    spread: [8, 11], adsSpread: 0, recoil: [3.8, 1.0], vel: 853, model: 'barrett', sound: 'sniper', color: 0x2b2b2b, noscope: 0.5 },
  // ---------------------------------------------------------------- shotgun: 8 pellets, brutal up close, nothing at range
  r870: { name: 'R870 MCS', cls: 'SHOTGUN', kind: 'pump', pump: 0.6, pellets: 8, dmg: [24, 6], range: [6, 16], mult: { head: 1, chest: 1, stomach: 1, limb: 1 },
    rpm: 70, mag: 6, reserve: 36, shells: true, reloadStart: 0.45, reloadShell: 0.48, reloadEnd: 0.4, ads: 0.26, sprintOut: 0.2, move: 0.97, zoom: 1.2,
    spread: [6, 6.5], adsSpread: 4.2, recoil: [2.4, 0.6], vel: 400, model: 'r870', sound: 'shotgun', color: 0x262626 },
  // ---------------------------------------------------------------- secondaries
  m1911: { name: 'M1911 .45', cls: 'PISTOL', kind: 'semi', dmg: [40, 25], range: [9, 20], mult: { head: 1.4, chest: 1, stomach: 1, limb: 1 },
    rpm: 450, mag: 8, reserve: 48, reload: 1.5, reloadEmpty: 1.85, ads: 0.15, sprintOut: 0.12, move: 1.05, zoom: 1.2,
    spread: [1.6, 2.6], adsSpread: 0.3, recoil: [0.9, 0.3], vel: 250, model: 'm1911', sound: 'pistol', color: 0x2a2a2a, secondary: true },
  deagle: { name: 'Desert Eagle', cls: 'PISTOL', kind: 'semi', dmg: [55, 35], range: [10, 22], mult: { head: 1.5, chest: 1, stomach: 1, limb: 1 },
    rpm: 240, mag: 7, reserve: 35, reload: 1.7, reloadEmpty: 2.1, ads: 0.17, sprintOut: 0.14, move: 1.04, zoom: 1.2,
    spread: [2, 3], adsSpread: 0.35, recoil: [2.2, 0.5], vel: 470, model: 'deagle', sound: 'magnum', color: 0x8d8d8d, secondary: true },
  g18: { name: 'G18', cls: 'PISTOL', kind: 'auto', dmg: [24, 15], range: [7, 16], mult: { head: 1.3, chest: 1, stomach: 1, limb: 1 },
    rpm: 1100, mag: 20, reserve: 100, reload: 1.5, reloadEmpty: 1.8, ads: 0.15, sprintOut: 0.12, move: 1.05, zoom: 1.15,
    spread: [2.4, 3.4], adsSpread: 0.6, recoil: [0.4, 0.4], vel: 375, model: 'g18', sound: 'pistol', color: 0x222222, secondary: true },
};
export const PRIMARIES = ['m4a1', 'ak47', 'scar', 'famas', 'mp5', 'mp7', 'ump45', 'm249', 'intervention', 'barrett', 'r870'];
export const SECONDARIES = ['m1911', 'deagle', 'g18'];
export const LETHALS = { frag: { name: 'Frag', fuse: 3.5, radius: 9, dmg: 150, count: 2 }, semtex: { name: 'Semtex', fuse: 2.2, radius: 8, dmg: 140, count: 2, sticky: true } };
// melee: the knife takes anyone in reach out in one hit (a lunge closes the last couple of units)
export const KNIFE = { dmg: 150, reach: 2.2, lunge: 3.2, time: 0.6 };

// a thrown grenade: a COD overarm throw (~22 m/s, lofted) under a lighter-than-real gravity so it carries ~20 m
// thrown flat and the length of the arena lobbed high; the client draws the same arc
export const NADE = { speed: 22, lift: 4.5, g: 12 };
/** the pitch to lob a grenade a horizontal distance D to a point dy above the hand (bots) */
export function lobPitch(D, dy) {
  let best = 0.2, err = 1e9;
  for (let th = -0.5; th <= 1.1; th += 0.01) {
    const vx = Math.cos(th) * NADE.speed, vy = Math.sin(th) * NADE.speed + NADE.lift, q = vy * vy - 2 * NADE.g * dy;
    if (q < 0) continue;
    const e = Math.abs(vx * (vy + Math.sqrt(q)) / NADE.g - D);
    if (e < err) { err = e; best = th; }
  }
  return best;
}

/** the five fixed classes the player picks from (no create-a-class: one clear role each) */
export const CLASSES = [
  { name: 'ASSAULT', primary: 'm4a1', secondary: 'm1911', lethal: 'frag', blurb: 'all-rounder, good at every range' },
  { name: 'SMG', primary: 'mp5', secondary: 'm1911', lethal: 'semtex', blurb: 'fast and mobile, wins up close' },
  { name: 'SNIPER', primary: 'intervention', secondary: 'deagle', lethal: 'frag', blurb: 'one-shot chest kills at range' },
  { name: 'LMG', primary: 'm249', secondary: 'm1911', lethal: 'frag', blurb: 'big mag, holds lanes, slow' },
  { name: 'SHOTGUN', primary: 'r870', secondary: 'deagle', lethal: 'semtex', blurb: 'one-shot up close, useless far' },
];

/** damage of one bullet/pellet at distance d hitting body zone z */
export function damageAt(w, d, zone = 'chest') {
  const [r0, r1] = w.range, [d0, d1] = w.dmg;
  const t = d <= r0 ? 0 : d >= r1 ? 1 : (d - r0) / (r1 - r0);
  return (d0 + (d1 - d0) * t) * (w.mult[zone] ?? 1);
}

/** seconds between shots (a burst's own cadence inside a burst) */
export const shotGap = (w, inBurst = false) => 60 / (inBurst && w.burstRpm ? w.burstRpm : w.rpm);

/** bullets to kill / time to kill against full health, every shot to zone at distance d (test/cod.js, the class menu's bars) */
export function ttk(w, d = 10, zone = 'chest') {
  const per = damageAt(w, d, zone) * (w.pellets || 1) * (w.pellets ? 0.75 : 1);   // (a shotgun lands ~3/4 of its pellets)
  const n = Math.ceil(HP / Math.max(1e-6, per));
  return { shots: n, time: (n - 1) * (w.kind === 'bolt' ? w.bolt : w.kind === 'pump' ? w.pump : shotGap(w)) };
}

/** a fresh weapon state for a loadout slot */
export const arm = id => ({ id, w: WEAPONS[id], ammo: WEAPONS[id].mag, reserve: WEAPONS[id].reserve, cool: 0, burst: 0, reload: 0, reloadT: 0, cycle: 0, chambered: true, shells: 0 });

/** the class menu's bars (0..1): damage, range, fire rate, mobility, handling */
export function stats(w) {
  const dmg = Math.min(1, damageAt(w, 0) * (w.pellets ? w.pellets * 0.6 : 1) / 110);
  const range = Math.min(1, (w.range[1] >= 999 ? 100 : w.range[1]) / 100);
  const rate = Math.min(1, w.rpm / 1100), mob = Math.min(1, (w.move - 0.8) / 0.25), hand = Math.min(1, Math.max(0, 1 - (w.ads - 0.14) / 0.35));
  return { dmg, range, rate, mob, hand };
}
