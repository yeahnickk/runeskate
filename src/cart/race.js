// CartScape's race: karts, drifting, items, the obstacles, CPU drivers, laps and places. Pure JS (no DOM / Three):
// the browser runs it for a race against the CPU, test/cart.js runs whole races headless.
// Karts move in the world (x, z, heading a: forward = (cos a, sin a), + turns left) and are kept to the road through
// track space (s along, d sideways): grass past the kerb slows you, a barrier past that bounces you back.
import { Track, angd } from './track.js';

export const CC = { mithril: { name: 'MITHRIL', v: 21, ai: 0.9 }, rune: { name: 'RUNE', v: 24, ai: 0.95 }, dragon: { name: 'DRAGON', v: 28, ai: 0.985 } };
export const K = {
  acc: 13, brake: 30, drag: 0.35, rev: 7, turn: 2.15, grip: 9, driftGrip: 2.6, grass: 0.55, wall: 3.6, G: 26, r: 1.15,
  boost: 1.38, tiers: [0.75, 1.6, 2.5], tierBoost: [0.55, 1.0, 1.5], spin: 1.05, hop: 3.2,
};
// the chests' loot, each an RS thing doing a Mario Kart thing: energy potion = mushroom, a banana is a banana, wind
// strike = green shell (straight), fire bolt = red shell (homes in), chinchompa = bob-omb (thrown, a fuse, a blast),
// Protect from Missiles = a shell held behind you (blocks the next thing thrown at you), smoke barrage = blooper (everyone
// ahead goes blind), overload = star, ice barrage = lightning (everyone else frozen and small), dragonfire = blue shell
export const ITEMS = {
  energy: { name: 'ENERGY POTION' }, energy3: { name: 'SUPER ENERGY x3' }, banana: { name: 'BANANA' }, wind: { name: 'WIND STRIKE' },
  fire: { name: 'FIRE BOLT' }, chin: { name: 'CHINCHOMPA' }, protect: { name: 'PROTECT FROM MISSILES' }, smoke: { name: 'SMOKE BARRAGE' },
  overload: { name: 'OVERLOAD' }, barrage: { name: 'ICE BARRAGE' }, dragon: { name: 'DRAGONFIRE' },
};
// CPU drivers: skill scales their top speed (yours is 1), the rubber band's range, how keen they are with items
export const DIFF = {
  easy: { name: 'EASY', skill: [0.86, 0.92], band: [0.88, 1.03], itemT: 1.6 },
  normal: { name: 'NORMAL', skill: [0.94, 1.0], band: [0.93, 1.08], itemT: 0.8 },
  hard: { name: 'HARD', skill: [0.985, 1.025], band: [0.97, 1.12], itemT: 0.4 },
};
const MISSILES = new Set(['wind', 'fire', 'chin', 'banana']);       // what Protect from Missiles stops
// what the box gives by how far back you are (0 = leading, 1 = last): the back of the pack gets the big guns
const TABLE = [
  [0.0, { banana: 4, wind: 3, energy: 2, protect: 2, chin: 1 }],
  [0.3, { banana: 2, wind: 3, fire: 2, energy: 3, chin: 2, protect: 1, smoke: 1 }],
  [0.6, { fire: 3, energy: 2, energy3: 3, wind: 1, overload: 1, chin: 1, smoke: 2 }],
  [0.85, { energy3: 3, fire: 2, overload: 2, barrage: 1, dragon: 1, smoke: 1 }],
];
export const NAMES = ['Zezima', 'Bob', 'Hans', 'Duke Horacio', 'Doric', 'Gertrude', 'Wise Old Man', 'Sir Amik', 'Aggie', 'Fred', 'Lumbridge Guide', 'Bartender', 'Wizard Mizgog', 'Brian', 'Ned', 'Gillie'];

let seedR = 1;
const rnd = () => ((seedR = (seedR * 16807) % 2147483647) / 2147483647);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Race {
  /** track: baked track data (or a Track); karts: [{ id, name, theme, body, human }]; cc: CC key */
  constructor(track, { karts, laps, cc = 'rune', seed = 1, diff = 'normal' }) {
    this.T = track instanceof Track ? track : new Track(track);
    seedR = seed || 1; this.cc = CC[cc] || CC.rune; this.diff = DIFF[diff] || DIFF.normal; const D = this.diff; this.laps = laps || this.T.laps;
    this.t = -3.6; this.state = 'count'; this.events = []; this.hazards = []; this.shots = []; this.done = 0;
    this.feats = this.T.feats;
    // item rows: five boxes across, back 2.5 s after you take one
    this.boxes = [];
    for (const f of this.feats) if (f.k === 'items') for (const u of [-0.62, -0.31, 0, 0.31, 0.62]) this.boxes.push({ s: f.s, d: u * this.T.hw, gone: 0 });
    this.pads = this.feats.filter(f => f.k === 'boost').map(f => ({ s: f.s, d: (f.d || 0) * this.T.hw, len: 7, w: 3.4 }));
    this.mobs = this.makeMobs();
    // the grid: two by two behind the line, staggered like Mario Kart's
    this.karts = karts.map((k, i) => {
      const s = this.T.wrap(this.T.finish - 6 - i * 4.2), d = (i % 2 ? -1 : 1) * this.T.hw * 0.32, p = this.T.pos(s, d);
      return { ...k, i, x: p.x, z: p.z, y: p.y, vy: 0, a: Math.atan2(p.tz, p.tx), vx: 0, vz: 0, s, d, air: false, lap: 0, prog: 0, place: i + 1, finished: 0,
        drift: 0, charge: 0, boostT: 0, spinT: 0, invT: 0, frozenT: 0, smallT: 0, starT: 0, item: null, uses: 0, roll: 0, trick: false, trickT: 0, lipT: 9, hopT: 0,
        grass: false, gas0: null, rocket: 0, safeS: s, swimT: 0, skill: k.human ? 1 : D.skill[0] + rnd() * (D.skill[1] - D.skill[0]), cp: this.T.wrap(s - this.T.finish), protT: 0, smokeT: 0, aiT: 0, line: (rnd() - 0.5) * 0.5, lastHit: -9, coins: 0 };
    });
  }
  emit(e) { this.events.push(e); }

  // ------------------------------------------------------------------ obstacles (all off the race clock, the same on every screen)
  makeMobs() {
    const T = this.T, m = [];
    for (const f of this.feats) {
      if (f.k === 'cows') for (let i = 0; i < 6; i++) m.push({ k: 'cow', s0: f.s + i * (f.span || 50) / 6 + 3, w: 0.18 + i * 0.03, ph: i * 1.7, r: 1.5 });
      if (f.k === 'chickens') for (let i = 0; i < 9; i++) m.push({ k: 'chicken', s0: f.s + (i % 3) * 5 - 5, w: 0.9 + (i * 0.37) % 0.6, ph: i * 2.1, r: 0.55, lane: (i / 3 | 0) - 1 });
      if (f.k === 'blades') for (let i = 0; i < 3; i++) m.push({ k: 'blade', s0: f.s + i * 9, w: 1.4, ph: i * 2.1, r: 0.9 });
      if (f.k === 'boulders') for (let i = 0; i < 2; i++) m.push({ k: 'boulder', s0: f.s + i * 16, w: 0.16, ph: i * 0.5, r: 1.6, dir: i ? -1 : 1 });
    }
    return m;
  }
  /** where an obstacle is at time t: { s, d, y (lift over the road), a (its facing / swing) } */
  mobAt(o, t = this.t, out = {}) {
    const hw = this.T.hw, tt = Math.max(0, t + 3.6);
    if (o.k === 'cow') { const u = Math.sin(tt * o.w + o.ph); out.s = o.s0; out.d = u * (hw + 5); out.y = 0; out.a = Math.cos(tt * o.w + o.ph) > 0 ? 1 : -1; }
    else if (o.k === 'chicken') { const u = Math.sin(tt * o.w + o.ph); out.s = o.s0 + Math.sin(tt * 1.3 + o.ph) * 2; out.d = u * (hw + 2) * 0.7 + o.lane * 2; out.y = Math.abs(Math.sin(tt * 9 + o.ph)) * 0.35; out.a = u; }
    else if (o.k === 'blade') { const sw = Math.sin(tt * o.w + o.ph); out.s = o.s0; out.d = sw * hw * 0.82; out.y = 0; out.a = sw; }
    else if (o.k === 'boulder') { const u = ((tt * o.w + o.ph) % 1); out.s = o.s0; out.d = o.dir * (-hw - 8 + u * (2 * hw + 16)); out.y = 0; out.a = u * 40 * o.dir; }
    return out;
  }

  // ------------------------------------------------------------------ the step
  /** dt seconds; input: id -> { gas, brake, steer (-1..1, + left), drift (held), item (pressed this step) } */
  step(dt, input = new Map()) {
    const h = 1 / 120; let n = Math.min(12, Math.ceil(dt / h));
    while (n-- > 0) this.tick(Math.min(h, dt / Math.ceil(dt / h)), input);
    for (const v of input.values()) v.item = false;
  }
  tick(dt, input) {
    this.t += dt;
    if (this.state === 'count' && this.t >= 0) { this.state = 'go'; this.emit({ t: 'go' }); for (const k of this.karts) this.launch(k); }
    for (const k of this.karts) {
      const inp = k.human ? (input.get(k.id) || {}) : this.ai(k, dt);
      if (this.state === 'count') { this.countIn(k, inp); continue; }
      this.drive(k, inp, dt);
    }
    if (this.state === 'count') return;
    this.bump(dt);
    this.stepShots(dt);
    for (const b of this.boxes) if (b.gone > 0) b.gone -= dt;
    this.rank();
  }
  /** before GO: hold the gas at the right moment for a rocket start (too early and you bog down) */
  countIn(k, inp) {
    if (inp.gas && k.gas0 == null) k.gas0 = this.t;
    if (!inp.gas) k.gas0 = null;
  }
  launch(k) {
    if (k.gas0 == null) return;
    const early = -k.gas0;                                       // how long before GO you went down on it
    if (early > 0.15 && early < 1.05) { k.boostT = 1.3; this.emit({ t: 'rocket', id: k.id }); }
    else if (early > 2.2) { k.spinT = 0.7; this.emit({ t: 'stall', id: k.id }); }
  }

  drive(k, inp, dt) {
    const T = this.T, hw = T.hw;
    if (k.swimT > 0) {                                           // fell in the river: the Lumbridge Guide fishes you out
      k.swimT -= dt; if (k.swimT <= 0) this.respawn(k); return;
    }
    if (k.finished && !k.human) inp = { gas: 0.6, steer: 0 };
    const fx = Math.cos(k.a), fz = Math.sin(k.a), lx = -fz, lz = fx;
    let fwd = k.vx * fx + k.vz * fz, side = k.vx * lx + k.vz * lz;
    const stunned = k.spinT > 0 || k.frozenT > 0;
    let vmax = this.cc.v * (k.human ? 1 : k.skill * this.band(k) * (k.smokeT > 0 ? 0.9 : 1)) * (k.smallT > 0 ? 0.72 : 1);   // (in the smoke a CPU can't see: it lifts)
    if (k.grass && k.boostT <= 0 && k.starT <= 0) vmax *= K.grass;
    if (k.boostT > 0) vmax *= K.boost; if (k.starT > 0) vmax *= 1.18;
    const gas = stunned ? 0 : clamp(inp.gas ?? 0, 0, 1), brk = stunned ? 0 : clamp(inp.brake ?? 0, 0, 1);
    let steer = stunned ? 0 : clamp(inp.steer ?? 0, -1, 1);
    // ---- drift: hop into it while turning, hold it through the corner, sparks charge a mini-turbo
    if (!k.air && inp.drift && !k.drift && Math.abs(steer) > 0.3 && fwd > 9 && !stunned) { k.drift = Math.sign(steer); k.charge = 0; k.hopT = 0.18; this.emit({ t: 'hop', id: k.id }); }
    if (k.drift && (!inp.drift || fwd < 6 || stunned)) {
      const tier = K.tiers.filter(x => k.charge >= x).length;
      if (tier && !stunned) { k.boostT = Math.max(k.boostT, K.tierBoost[tier - 1]); this.emit({ t: 'turbo', id: k.id, tier }); }
      k.drift = 0; k.charge = 0;
    }
    if (k.drift) { steer = k.drift * (0.62 + 0.5 * steer * k.drift); k.charge += dt * (0.7 + 0.5 * Math.abs(steer)); }
    // ---- speed along the nose
    if (k.boostT > 0 && !stunned) fwd += (K.acc * 2.2) * dt;
    else if (gas > 0) fwd += K.acc * gas * (1 - Math.max(0, fwd) / vmax * 0.55) * dt;
    if (brk > 0) fwd -= (fwd > 0.5 ? K.brake : K.rev) * brk * dt;
    if (fwd > vmax) fwd = Math.max(vmax, fwd - 22 * dt);       // (over the limit: ease back down, a boost wears off smoothly)
    fwd -= fwd * K.drag * dt * (gas ? 0.3 : 1);
    if (fwd < -K.rev) fwd = -K.rev;
    if (stunned) fwd -= fwd * 2.2 * dt;
    // ---- turning: needs speed; reverse steers backwards; a drift turns harder
    const sp = Math.abs(fwd), turnK = Math.max(gas || brk ? 0.35 : 0, Math.min(1, sp / 7)) * (1 - Math.min(0.35, sp / vmax * 0.25));   // (on the gas you can pivot even from a standstill: nose in a wall, you can get out)
    if (!k.air || k.drift) k.a += steer * K.turn * (k.drift ? 1.18 : 1) * turnK * Math.sign(fwd || 1) * dt;
    if (k.spinT > 0) { k.spinT -= dt; k.roll += dt * 14; } else k.roll = 0;
    if (k.frozenT > 0) k.frozenT -= dt;
    // ---- sideways grip (a drift slides)
    side *= Math.exp(-(k.drift ? K.driftGrip : K.grip) * dt);
    const nfx = Math.cos(k.a), nfz = Math.sin(k.a);
    k.vx = nfx * fwd + -nfz * side; k.vz = nfz * fwd + nfx * side;
    for (const key of ['boostT', 'starT', 'smallT', 'hopT', 'trickT', 'invT', 'cluckT', 'protT', 'smokeT']) if (k[key] > 0) k[key] -= dt;
    k.lipT += dt;
    // ---- move, then keep it to the road
    k.x += k.vx * dt; k.z += k.vz * dt;
    const loc = T.locate(k.x, k.z, k.s);
    const ds = T.wrap(loc.s - k.s + T.L / 2) - T.L / 2;          // (signed, through the wrap)
    k.s = loc.s; k.d = loc.d;
    const flags = T.flag(k.s), lim = hw + K.wall;
    k.grass = Math.abs(k.d) > hw + 0.4 && !k.air;
    if (Math.abs(k.d) > lim) {                                   // the barrier: back onto the road, the push out of it scrubbed off
      const f = T.at(k.s), nx = -f.tz * Math.sign(k.d), nz = f.tx * Math.sign(k.d), into = k.vx * nx + k.vz * nz;
      const p = T.pos(k.s, Math.sign(k.d) * lim); k.x = p.x; k.z = p.z; k.d = Math.sign(k.d) * lim;
      if (into > 0) { k.vx -= nx * into * 1.5; k.vz -= nz * into * 1.5; k.vx *= 0.9; k.vz *= 0.9; if (into > 6) this.emit({ t: 'wall', id: k.id, v: into }); }
      // nose into it: the barrier turns you to glance along it (you're never pinned there with the gas down)
      const ta = Math.atan2(f.tz, f.tx), along = Math.abs(angd(k.a, ta)) < Math.PI / 2 ? ta : ta + Math.PI, nose = Math.cos(k.a) * nx + Math.sin(k.a) * nz;
      if (nose > 0 && !k.air) k.a += angd(k.a, along) * Math.min(1, dt * 5 * (0.3 + nose));
    }
    // ---- up and down: glued to the road, launched off a lip, a gap is a hole all the way to the water
    const gap = flags & 2, ground = gap ? -Infinity : T.h(k.s);
    if (k.air) {
      k.vy -= K.G * dt; k.y += k.vy * dt;
      if (inp.drift && !k.trick && k.lipT < 0.35) { k.trick = true; k.trickT = 0.5; this.emit({ t: 'trick', id: k.id }); }
      if (k.y <= ground) {
        k.air = false; k.y = ground; this.emit({ t: 'land', id: k.id, v: -k.vy });
        if (k.trick && !k.spinT) { k.boostT = Math.max(k.boostT, 0.8); this.emit({ t: 'turbo', id: k.id, tier: 1 }); }
        k.trick = false; k.vy = 0;
      } else if (gap && k.y < this.waterAt(k.s)) { k.swimT = 1.3; this.emit({ t: 'splash', id: k.id }); }
    } else {
      if (ground < k.y - 0.35 || gap) {
        k.air = true; k.lipT = 0; if (flags & 8 || T.flag(k.s - 2) & 8) k.vy = Math.max(k.vy, 1.5);
        if ((T.flag(k.s - 1.5) | T.flag(k.s - 3)) & 16) {          // off the river ramp: it throws you clear (the far bank, every time you drive off it straight)
          const f = T.at(k.s), along = k.vx * f.tx + k.vz * f.tz; if (along > 4) { const add = Math.max(0, 31 - along); k.vx += f.tx * add; k.vz += f.tz * add; k.vy = Math.max(k.vy, 9); this.emit({ t: 'launch', id: k.id }); }
        }
      }
      else { k.vy = Math.abs(ds) > 1e-4 ? (ground - k.y) / dt : 0; k.vy = clamp(k.vy, -12, 14); k.y = ground; }
      if (!gap && !(flags & 6) && Math.abs(k.d) < hw) k.safeS = k.s;
    }
    if (k.hopT > 0 && !k.air) k.yHop = Math.sin((0.18 - k.hopT) / 0.18 * Math.PI) * 0.35; else k.yHop = 0;
    // ---- laps
    // (a lap only counts once you've been all the way round: cp is how far round you've got, and it only creeps forward
    // a bit at a time, so nothing that jumps you along the track, backwards over the line and back, or a cut, earns one)
    const rel = T.wrap(k.s - T.finish), prevRel = T.wrap(k.s - ds - T.finish);
    if (rel > k.cp && rel < k.cp + 25) k.cp = rel;
    if (prevRel > T.L - 40 && rel < 40 && ds > 0) { if (k.cp > T.L - 50) { this.lapUp(k); k.cp = rel; } }
    else if (prevRel < 40 && rel > T.L - 40 && ds < 0 && k.cp < 40) { k.lap--; k.cp = rel; }
    k.prog = (k.lap - 1) * T.L + rel;
    // ---- what's on the road
    if (!k.air) {
      if (flags & 16 && !k.air) k.boostT = Math.max(k.boostT, 0.45);   // (the river ramp is a dash ramp: you always have the speed to clear it)
    for (const p of this.pads) if (Math.abs(T.wrap(k.s - p.s + T.L / 2) - T.L / 2) < p.len / 2 && Math.abs(k.d - p.d) < p.w) { if (k.boostT < 0.6) this.emit({ t: 'pad', id: k.id }); k.boostT = Math.max(k.boostT, 1.0); }
    }
    for (const b of this.boxes) if (b.gone <= 0 && Math.abs(T.wrap(k.s - b.s + T.L / 2) - T.L / 2) < 1.6 && Math.abs(k.d - b.d) < 1.6 && k.y < T.h(b.s) + 3) {
      b.gone = 2.5; this.emit({ t: 'box', id: k.id, s: b.s, d: b.d });
      if (!k.item) { k.item = 'roll'; k.rollT = k.human ? 1.6 : 0.6; }
    }
    if (k.item === 'roll' && (k.rollT -= dt) <= 0) { k.item = this.roll(k); k.uses = k.item === 'energy3' ? 3 : 1; this.emit({ t: 'got', id: k.id, item: k.item }); }
    if (inp.item && k.item && k.item !== 'roll' && !stunned) this.use(k);
    for (const o of this.mobs) {
      const m = this.mobAt(o); if (Math.abs(T.wrap(k.s - m.s + T.L / 2) - T.L / 2) > o.r + K.r || Math.abs(k.d - m.d) > o.r + K.r || k.y > T.h(m.s) + 2.2 + m.y) continue;
      if (k.starT > 0) { if (this.t - (o.hitT || -9) > 1) { o.hitT = this.t; this.emit({ t: 'smash', id: k.id, mob: o.k }); } continue; }
      if (k.invT > 0) continue;
      if (o.k === 'chicken') { if (!(k.cluckT > 0)) { k.vx *= 0.82; k.vz *= 0.82; k.cluckT = 0.6; this.emit({ t: 'cluck', id: k.id }); } }   // (a flap of feathers, not a crash)
      else this.hit(k, o.k);
    }
  }
  waterAt(s) { for (const f of this.feats) if (f.k === 'jump' && this.T.wrap(s - f.s) < this.T.wrap(f.land - f.s)) return f.water; return -1e9; }
  respawn(k) {
    const T = this.T; let s = k.safeS;
    for (const f of this.feats) if (f.k === 'jump' && T.wrap(k.s - f.s) < T.wrap(f.land - f.s) + 2) s = T.wrap(f.s - 70);   // (a run-up at the jump again)
    const p = T.pos(s, 0); Object.assign(k, { x: p.x, z: p.z, y: p.y, vy: 0, vx: p.tx * 6, vz: p.tz * 6, a: Math.atan2(p.tz, p.tx), s, d: 0, air: false, drift: 0, spinT: 0, frozenT: 0, boostT: 0.6 });
    this.emit({ t: 'respawn', id: k.id });
  }
  lapUp(k) {
    k.lap++;
    if (k.lap > 1 && k.lap <= this.laps + 1) (k.splits ||= []).push(this.t - (k.splits || []).reduce((a, b) => a + b, 0));   // (the lap times: they add up to the race time)
    if (k.lap > this.laps && !k.finished) { k.finished = this.t; k.place = 1 + this.karts.filter(q => q.finished && q !== k).length; this.emit({ t: 'finish', id: k.id, place: k.place, time: this.t }); if (this.karts.every(q => q.finished || !q.human)) this.done = this.done || this.t; }
    else if (k.lap > 1 && k.lap <= this.laps) this.emit({ t: 'lap', id: k.id, lap: k.lap });
  }
  /** rubber band for the CPU: the back of the pack a touch quicker, a runaway leader a touch slower */
  band(k) {
    const me = this.karts.find(q => q.human); if (!me) return 1;
    const gap = (me.prog - k.prog) / this.T.L;                   // + = the human is ahead of this kart
    return clamp(1 + gap * 0.35, this.diff.band[0], this.diff.band[1]);
  }
  hit(k, why) {
    if (k.starT > 0 || k.swimT > 0 || k.invT > 0) return;
    if (k.protT > 0 && MISSILES.has(why)) { k.protT = 0; k.invT = 0.5; this.emit({ t: 'block', id: k.id, why }); return; }   // the prayer takes it
    k.spinT = K.spin; k.invT = K.spin + 1.3;                       // (then a moment's grace: you get going before the next one can catch you) k.drift = 0; k.charge = 0; k.boostT = 0; k.lastHit = this.t;
    if (why === 'boulder' || why === 'dragon' || why === 'cow') { k.vy = Math.max(k.vy, why === 'cow' ? 4 : 7); k.air = true; k.lipT = 9; }
    this.emit({ t: 'hit', id: k.id, why });
  }
  bump(dt) {
    const ks = this.karts;
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const a = ks[i], b = ks[j]; if (a.swimT > 0 || b.swimT > 0 || Math.abs(a.y - b.y) > 1.5) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz); if (d > K.r * 2 || d < 1e-4) continue;
      const nx = dx / d, nz = dz / d, push = (K.r * 2 - d) / 2;
      a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
      const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rel < 0) { const j2 = -rel * 0.6; a.vx -= nx * j2; a.vz -= nz * j2; b.vx += nx * j2; b.vz += nz * j2; if (-rel > 4) this.emit({ t: 'bump', a: a.id, b: b.id }); }
      if (a.starT > 0 && b.starT <= 0) this.hit(b, 'overload'); if (b.starT > 0 && a.starT <= 0) this.hit(a, 'overload');
    }
  }
  rank() {
    const order = [...this.karts].sort((a, b) => (a.finished && b.finished) ? a.finished - b.finished : a.finished ? -1 : b.finished ? 1 : b.prog - a.prog);
    order.forEach((k, i) => { if (!k.finished) k.place = i + 1; });
    this.order = order;
    // a human done and the rest well behind: the CPU finish in place
    if (this.done && this.t - this.done > 12) for (const k of this.karts) if (!k.finished) { k.finished = this.t + k.place * 0.01; this.emit({ t: 'finish', id: k.id, place: k.place, time: k.finished }); }
  }

  // ------------------------------------------------------------------ items
  roll(k) {
    const back = (k.place - 1) / Math.max(1, this.karts.length - 1);
    let tab = TABLE[0][1]; for (const [at, t] of TABLE) if (back >= at) tab = t;
    let sum = 0; for (const v of Object.values(tab)) sum += v; let r = rnd() * sum;
    for (const [it, v] of Object.entries(tab)) if ((r -= v) <= 0) return it;
    return 'energy';
  }
  use(k) {
    const it = k.item, T = this.T;
    if (--k.uses <= 0) k.item = null;
    this.emit({ t: 'use', id: k.id, item: it });
    if (it === 'energy' || it === 'energy3') k.boostT = Math.max(k.boostT, 1.25);
    else if (it === 'overload') { k.starT = 7; k.spinT = 0; k.frozenT = 0; k.smallT = 0; }
    else if (it === 'banana') { this.hazards.push({ k: 'banana', s: T.wrap(k.s - 3.2), d: k.d, t: this.t, id: this.hid = (this.hid || 0) + 1 }); }
    else if (it === 'wind') this.shots.push({ k: 'wind', s: T.wrap(k.s + 2.5), d: k.d, v: Math.max(48, this.cc.v * 2.1), life: 4, by: k.id, id: this.hid = (this.hid || 0) + 1 });
    else if (it === 'fire') {
      const ahead = this.order.filter(q => q.place < k.place && !q.finished).pop();
      this.shots.push({ k: 'fire', s: T.wrap(k.s + 2.5), d: k.d, v: Math.max(44, this.cc.v * 1.9), life: 9, by: k.id, target: ahead?.id, id: this.hid = (this.hid || 0) + 1 });
    }
    else if (it === 'barrage') { for (const q of this.karts) if (q !== k && q.starT <= 0 && !q.finished) { q.frozenT = 1.1; q.smallT = 3.2; q.drift = 0; q.item = q.item === 'roll' ? null : q.item; } }
    else if (it === 'chin') this.shots.push({ k: 'chin', s: T.wrap(k.s + 2), d: k.d, v: Math.max(24, Math.hypot(k.vx, k.vz) + 10), life: 2.4, age: 0, by: k.id, id: this.hid = (this.hid || 0) + 1 });
    else if (it === 'protect') k.protT = 14;
    else if (it === 'smoke') { for (const q of this.karts) if (q !== k && q.place < k.place && q.starT <= 0 && !q.finished) { q.smokeT = 4; this.emit({ t: 'smoked', id: q.id }); } }
    else if (it === 'dragon') { const lead = this.order.find(q => !q.finished); if (lead) this.shots.push({ k: 'dragon', s: T.wrap(k.s + 2), d: 0, v: 70, life: 20, by: k.id, target: lead.id, id: this.hid = (this.hid || 0) + 1, y: 6 }); }
  }
  stepShots(dt) {
    const T = this.T;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const p = this.shots[i]; p.life -= dt;
      const tg = p.target != null ? this.karts.find(q => q.id === p.target) : null;
      if (p.k === 'dragon' && tg) {                               // flies the track to the leader, then dives on them
        const gap = T.wrap(tg.s - p.s); p.s = T.wrap(p.s + Math.min(gap, p.v * dt)); p.d += (tg.d - p.d) * Math.min(1, dt * 3);
        if (gap < 2) { this.shots.splice(i, 1); this.emit({ t: 'boom', s: tg.s, d: tg.d, big: true }); for (const q of this.karts) if (Math.hypot(T.wrap(q.s - tg.s + T.L / 2) - T.L / 2, q.d - tg.d) < 7) this.hit(q, 'dragon'); continue; }
      } else if (p.k === 'chin') {                              // thrown in an arc, lands, a fuse, then the bang (or sooner, if someone drives into it)
        p.age += dt; const fly = p.age < 0.75;
        if (fly) p.s = T.wrap(p.s + p.v * dt); p.y = fly ? Math.sin(p.age / 0.75 * Math.PI) * 2.6 : 0;
        const touch = !fly && this.karts.some(q => q.swimT <= 0 && Math.abs(T.wrap(q.s - p.s + T.L / 2) - T.L / 2) < 1.7 && Math.abs(q.d - p.d) < 1.5);
        if (p.life <= 0 || touch) {
          this.shots.splice(i, 1); this.emit({ t: 'boom', s: p.s, d: p.d, big: true, chin: true });
          for (const q of this.karts) if (Math.hypot(T.wrap(q.s - p.s + T.L / 2) - T.L / 2, q.d - p.d) < 5.5 && q.y < T.h(p.s) + 3) this.hit(q, 'chin');
        }
        continue;
      } else {
        p.s = T.wrap(p.s + p.v * dt);
        if (p.k === 'fire' && tg && T.wrap(tg.s - p.s) < 60) p.d += clamp(tg.d - p.d, -18 * dt, 18 * dt);
        if (Math.abs(p.d) > T.hw + 2) { p.d = Math.sign(p.d) * (T.hw + 2); if (p.k === 'wind') p.d *= 0.9; }
      }
      let gone = p.life <= 0;
      for (const q of this.karts) {
        if (gone || q.swimT > 0 || (q.id === p.by && p.life > (p.k === 'wind' ? 3.6 : 8.6))) continue;
        if (Math.abs(T.wrap(q.s - p.s + T.L / 2) - T.L / 2) < 1.8 && Math.abs(q.d - p.d) < 1.6 && p.k !== 'dragon') { this.hit(q, p.k); gone = true; this.emit({ t: 'boom', s: p.s, d: p.d }); }
      }
      for (let j = this.hazards.length - 1; j >= 0 && !gone; j--) { const hz = this.hazards[j]; if (Math.abs(T.wrap(hz.s - p.s + T.L / 2) - T.L / 2) < 1.6 && Math.abs(hz.d - p.d) < 1.4) { this.hazards.splice(j, 1); gone = true; this.emit({ t: 'boom', s: p.s, d: p.d }); } }
      if (gone) this.shots.splice(i, 1);
    }
    for (let j = this.hazards.length - 1; j >= 0; j--) {
      const hz = this.hazards[j];
      for (const q of this.karts) if (!q.air && Math.abs(T.wrap(q.s - hz.s + T.L / 2) - T.L / 2) < 1.3 && Math.abs(q.d - hz.d) < 1.2) { this.hazards.splice(j, 1); this.hit(q, 'banana'); break; }
    }
  }

  // ------------------------------------------------------------------ CPU drivers
  ai(k, dt) {
    const T = this.T, hw = T.hw;
    if (this.state === 'count') return { gas: this.t > -0.8 && k.skill > 0.97 ? 1 : 0 };
    const v = Math.hypot(k.vx, k.vz), look = 7 + v * 0.42;
    // the racing line: the inside of what's coming, plus this driver's own habit; away from bananas and beasts ahead
    const c = T.curve(k.s + look, 8);
    let want = clamp(c * 2.4, -0.62, 0.62) * hw + k.line * hw;
    for (const hz of this.hazards) { const ah = T.wrap(hz.s - k.s); if (ah < 30 && Math.abs(hz.d - want) < 2.4) want = hz.d + (hz.d > 0 ? -3 : 3); }
    for (const o of this.mobs) {                                  // where it'll be when we get there
      const ah = T.wrap(o.s0 - k.s); if (ah > 30) continue;
      const m = this.mobAt(o, this.t + ah / Math.max(8, v)); if (Math.abs(m.d - want) < o.r + 2) want = clamp(m.d + (m.d > 0 ? -1 : 1) * (o.r + 2.6), -hw * 0.85, hw * 0.85);
    }
    for (const b of this.boxes) { const ah = T.wrap(b.s - k.s); if (!k.item && b.gone <= 0 && ah < 25 && ah > 4) { want = b.d; break; } }
    for (const p of this.pads) { const ah = T.wrap(p.s - k.s); if (ah < 30 && ah > 3) { want = p.d; break; } }
    const tp = T.pos(k.s + look, clamp(want, -hw * 0.9, hw * 0.9));
    const steerAng = angd(k.a, Math.atan2(tp.z - k.z, tp.x - k.x));
    let steer = clamp(steerAng * 2.6 + (k.smokeT > 0 ? Math.sin(this.t * 3.1 + k.i) * 0.35 : 0), -1, 1);
    const sharp = Math.abs(T.curve(k.s + look * 0.6, 10));
    if (k.drift) { if (sharp < 0.18 || Math.sign(c) !== k.drift) k.wantDrift = false; }
    else k.wantDrift = sharp > 0.34 && v > 15 && k.skill > 0.955;
    let brake = Math.abs(steerAng) > 0.9 && v > 10 ? 0.6 : 0, gas = 1;
    // stuck (spun round into a wall): back out, wheel the other way, then go again
    if (v < 2.5 && this.state === 'go' && !k.finished) k.stuckT = (k.stuckT || 0) + dt; else k.stuckT = 0;
    if (k.stuckT > 0.7) {                                         // backing out only helps nose-first into the barrier; tail to it, the pivot gets you out going forwards
      k.stuckT = 0; const f = T.at(k.s), out = Math.sign(k.d || 1), into = Math.cos(k.a) * -f.tz * out + Math.sin(k.a) * f.tx * out;
      if (Math.abs(k.d) > hw + 1 ? into > 0.2 : Math.abs(steerAng) > 1.6) k.backT = 0.9;
    }
    if (k.backT > 0) { k.backT -= dt; return { gas: 0, brake: 1, steer: -clamp(steerAng * 3, -1, 1), drift: false, item: false }; }
    // items: a boost on a straight, things thrown at whoever's close ahead, bananas for whoever's close behind
    let item = false;
    if (k.item && k.item !== 'roll' && (k.aiT -= dt) <= 0) {
      k.aiT = (0.4 + rnd() * 0.6) * this.diff.itemT;
      const near = (dir, r) => this.karts.some(q => q !== k && Math.abs(T.wrap((q.s - k.s) * dir)) < r && T.wrap((q.s - k.s) * dir) > 0 && Math.abs(q.d - k.d) < 4);
      if ((k.item === 'energy' || k.item === 'energy3') && sharp < 0.15) item = true;
      else if (k.item === 'banana' && (near(-1, 14) || rnd() < 0.2)) item = true;
      else if (k.item === 'wind' && near(1, 35)) item = true;
      else if (k.item === 'chin' && near(1, 28)) item = true;
      else if (k.item === 'protect' && k.protT <= 0) item = true;
      else if (['fire', 'overload', 'barrage', 'dragon', 'smoke'].includes(k.item)) item = (k.item !== 'barrage' && k.item !== 'smoke') || k.place > 2;
    }
    return { gas, brake, steer, drift: k.drift ? k.wantDrift !== false : k.wantDrift, item };
  }
}
