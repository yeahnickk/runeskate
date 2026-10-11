// The gun in a soldier's hands, player or bot: what a trigger pull does this frame. Full auto, three-round
// burst, semi, bolt and pump actions; mag reloads (faster with one in the chamber), shell-by-shell shotgun
// reloads you can fire out of, the swap to your sidearm (Call of Duty's "faster than reloading"), the knife,
// the grenade (cook it), and the sprint-out delay. Pure logic: src/cod/viewmodel.js animates from `phase`,
// src/cod/game.js turns `shots` into bullets.
import { WEAPONS, LETHALS, KNIFE, shotGap, arm } from './weapons.js';

export const SWAP_TIME = 0.55;          // lower one gun + raise the other
const RAISE = 0.35;

export class Gunner {
  /** loadout: { primary, secondary, lethal } (weapon ids) */
  constructor(loadout) {
    this.slots = [arm(loadout.primary), arm(loadout.secondary)];
    this.cur = 0; this.lethal = loadout.lethal || 'frag'; this.nades = LETHALS[this.lethal].count;
    this.phase = 'raise'; this.t = 0; this.dur = RAISE;   // idle | raise | swap | reload | cycle | knife | throw
    this.sprintT = 1; this.spread = 0; this.ads = 0; this.cook = -1; this.trig = false; this.burstLeft = 0; this.cool = 0;
    this.stats = { shots: 0, hits: 0 };
  }
  get g() { return this.slots[this.cur]; }
  get w() { return this.g.w; }
  get busy() { return this.phase !== 'idle' && this.phase !== 'cycle'; }
  get reloading() { return this.phase === 'reload'; }

  /**
   * want: { fire (held), reload (edge), swap (edge), ads (held), knife (edge), nade (held: cook, release: throw),
   * sprinting, moving (0..1), air } -> events this frame: [{ t: 'shot', pellets, spread }, 'reload', 'empty',
   * 'swap', 'knife', 'throw', 'cycle', 'mag-out', 'mag-in', 'bolt', 'shell', 'dry']
   */
  update(dt, want) {
    const ev = [], w = this.w, g = this.g;
    this.cool = Math.max(0, this.cool - dt);
    // ADS: not while sprinting or mid swap/knife/throw (you CAN aim during a reload in this game: no, COD drops it)
    const canAds = !want.sprinting && !['swap', 'raise', 'knife', 'throw', 'reload'].includes(this.phase);
    const adsT = w.ads;
    this.ads = Math.max(0, Math.min(1, this.ads + (want.ads && canAds ? dt / adsT : -dt / (adsT * 0.8))));
    // sprint-out: you can't shoot until the gun is back up
    this.sprintT = want.sprinting ? 0 : this.sprintT + dt;
    // bloom: hipfire spread grows with movement, shrinks with ADS (see spreadDeg)
    this.spread = Math.max(0, this.spread - dt * 6);

    // phases that run out
    if (this.phase !== 'idle') {
      this.t += dt;
      if (this.phase === 'reload') this.stepReload(ev);
      else if (this.t >= this.dur) {
        if (this.phase === 'swap' && !this.swapped) { this.cur = 1 - this.cur; this.swapped = true; this.t = 0; this.dur = RAISE; this.phase = 'raise'; ev.push('raised'); }
        else if (this.phase === 'throw') { this.phase = 'idle'; }
        else if (this.phase === 'cycle') { g.chambered = true; this.phase = 'idle'; }
        else this.phase = 'idle';
      }
      if (this.phase === 'cycle' && this.t > this.dur * 0.35 && !this.ejected) { this.ejected = true; ev.push(w.kind === 'pump' ? 'pump' : 'bolt'); }
    }
    // grenade: hold to cook, let go to throw
    if (want.sprinting) this.burstLeft = 0;                 // (a burst never finishes itself later)
    if (want.nade && this.cook < 0 && this.nades > 0 && !['throw', 'knife', 'swap'].includes(this.phase)) { this.cook = 0; this.burstLeft = 0; this.abortReload(); ev.push('pin'); }
    if (this.cook >= 0) {
      this.cook += dt;
      if (!want.nade || this.cook >= LETHALS[this.lethal].fuse - 0.05) {
        ev.push({ t: 'throw', cook: this.cook }); this.nades--; this.cook = -1;
        this.phase = 'throw'; this.t = 0; this.dur = 0.55;
      }
      return ev;
    }
    if (want.knife && !['knife', 'throw'].includes(this.phase)) {
      this.abortReload(); this.burstLeft = 0; this.phase = 'knife'; this.t = 0; this.dur = KNIFE.time; ev.push('knife'); return ev;
    }
    if (want.swap && !['swap', 'knife', 'throw'].includes(this.phase) && this.slots[1 - this.cur]) {
      this.abortReload(); this.burstLeft = 0; this.phase = 'swap'; this.swapped = false; this.t = 0; this.dur = SWAP_TIME - RAISE; this.ads = 0; ev.push('swap'); return ev;
    }
    // reload: by hand, or by itself when you pull the trigger on an empty mag
    const canReload = g.ammo < w.mag && g.reserve > 0;
    if ((want.reload || g.ammo === 0) && canReload && (this.phase === 'idle' || this.phase === 'cycle') && this.cool <= 0) {   // (empty: it reloads itself, like COD)
      this.startReload(ev);
    } else if (want.fire && g.ammo === 0 && !this.trig && g.reserve === 0 && this.slots[1 - this.cur]?.ammo > 0 && this.phase === 'idle') {
      this.phase = 'swap'; this.swapped = false; this.t = 0; this.dur = SWAP_TIME - RAISE; ev.push('swap');   // out of everything: to the sidearm
    }

    // a bolt / pump left open (a swap, the knife or a grenade cut the cycle short): finish working the action
    if (this.phase === 'idle' && !g.chambered && g.ammo > 0 && (w.kind === 'bolt' || w.kind === 'pump')) {
      this.phase = 'cycle'; this.t = 0; this.dur = w.kind === 'bolt' ? w.bolt : w.pump; this.ejected = false; ev.push('cycle');
    }
    // the trigger
    const ready = (this.phase === 'idle' || (this.phase === 'reload' && w.shells && g.ammo > 0)) && this.sprintT >= w.sprintOut && this.cool <= 0;
    const pressed = want.fire && !this.trig;
    this.trig = want.fire;
    if (this.burstLeft > 0 && ready && g.ammo > 0) { this.fire(ev, true); this.burstLeft--; this.cool = this.burstLeft > 0 ? shotGap(w, true) : shotGap(w); return ev; }
    if (!want.fire || !ready) return ev;
    if (g.ammo === 0) { if (pressed) ev.push('dry'); return ev; }
    if (this.phase === 'reload') { this.abortReload(); if (!g.chambered) return ev; }      // shotgun: fire out of a reload
    if (w.kind === 'auto' || pressed) {
      if ((w.kind === 'bolt' || w.kind === 'pump') && !g.chambered) return ev;
      this.fire(ev, false);
      if (w.kind === 'burst') { this.burstLeft = w.burst - 1; this.cool = shotGap(w, true); }
    }
    return ev;
  }

  fire(ev, inBurst) {
    const w = this.w, g = this.g;
    g.ammo--; this.stats.shots++;
    this.cool = shotGap(w);
    ev.push({ t: 'shot', pellets: w.pellets || 1 });
    this.spread = Math.min(1, this.spread + (w.kind === 'auto' ? 0.12 : 0.3));
    if ((w.kind === 'bolt' || w.kind === 'pump') && g.ammo > 0) {
      g.chambered = false; this.phase = 'cycle'; this.t = 0; this.dur = w.kind === 'bolt' ? w.bolt : w.pump; this.ejected = false; ev.push('cycle');
    } else if (w.kind === 'bolt' || w.kind === 'pump') g.chambered = false;
    if (g.ammo === 0) ev.push('empty');
  }

  startReload(ev) {
    const w = this.w, g = this.g;
    this.phase = 'reload'; this.t = 0; this.empty = g.ammo === 0; this.marks = 0;
    if (w.shells) { this.stage = 'start'; this.dur = w.reloadStart; }
    else this.dur = this.empty ? w.reloadEmpty : w.reload;
    ev.push('reload');
  }
  abortReload() { if (this.phase === 'reload') { this.phase = 'idle'; if (this.w.shells && this.empty && this.g.ammo > 0) this.g.chambered = true; } }

  stepReload(ev) {
    const w = this.w, g = this.g, f = this.t / this.dur;
    if (w.shells) {                                         // start, a shell at a time, end (racks it if it was empty)
      if (this.t < this.dur) return;
      if (this.stage === 'start' || this.stage === 'shell') {
        if (this.stage === 'shell') { g.ammo++; g.reserve--; ev.push('shell'); }
        if (g.ammo < w.mag && g.reserve > 0) { this.stage = 'shell'; this.t = 0; this.dur = w.reloadShell; }
        else { this.stage = 'end'; this.t = 0; this.dur = w.reloadEnd + (this.empty ? w.pump * 0.7 : 0); if (this.empty) ev.push('pump'); }
      } else { g.chambered = true; this.phase = 'idle'; }
      return;
    }
    // a mag: out at ~30%, in at ~65%; the round count changes when the new mag seats
    if (this.marks < 1 && f > 0.3) { this.marks = 1; ev.push('mag-out'); }
    if (this.marks < 2 && f > 0.66) {
      this.marks = 2; ev.push('mag-in');
      const take = Math.min(w.mag - g.ammo, g.reserve);
      g.reserve -= take; g.ammo += take;
    }
    if (this.empty && this.marks < 3 && f > 0.82) { this.marks = 3; ev.push('bolt'); }
    if (this.t >= this.dur) { g.chambered = true; this.phase = 'idle'; ev.push('reloaded'); }
  }

  /** the hipfire/ADS cone this instant (degrees): moving and firing open it, aiming closes it */
  spreadDeg(moving, air, crouch) {
    const w = this.w, [still, move] = w.spread;
    const hip = (still + (move - still) * Math.min(1, moving)) * (1 + this.spread * 0.5) * (air ? 1.6 : 1) * (crouch ? 0.8 : 1);
    const ads = w.adsSpread * (1 + this.spread * (w.kind === 'auto' ? 1.5 : 0.5)) * (1 + Math.min(1, moving) * 0.8);
    const sc = w.scope ? (this.ads >= 0.9 ? ads : hip * (w.noscope || 1)) : hip + (ads - hip) * this.ads;   // a scope is either up or it's a noscope
    return sc;
  }

  refill() { for (const s of this.slots) { s.reserve = s.w.reserve; s.ammo = s.w.mag; s.chambered = true; } this.nades = LETHALS[this.lethal].count; }
}
export { WEAPONS };
