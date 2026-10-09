// Things to do: runes to collect (air runes float high: ollie or grind to them) and challenge spots
// (roll into the beam, beat the task before the timer runs out). Progress is saved to your account.
import * as THREE from 'three';
import { SPOTS } from './spots.js';
export { SPOTS };

const RUNES = [
  { kind: 'air', col: '#e8e8ff', sym: '#9bd', high: true },
  { kind: 'water', col: '#dde', sym: '#27f', high: false },
  { kind: 'earth', col: '#dde', sym: '#a60', high: false },
  { kind: 'fire', col: '#dde', sym: '#f40', high: false },
];
const RUNE_XP = 400, ALL_RUNES_XP = 25_000;


function runeTexture(r) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.beginPath(); x.ellipse(32, 34, 26, 24, 0, 0, 7); x.fill();
  x.fillStyle = '#8a8a90'; x.beginPath(); x.ellipse(32, 32, 24, 22, 0, 0, 7); x.fill();
  x.fillStyle = '#b8b8c0'; x.beginPath(); x.ellipse(28, 27, 14, 10, 0, 0, 7); x.fill();
  x.strokeStyle = r.sym; x.lineWidth = 6; x.lineCap = 'round';
  x.beginPath();
  if (r.kind === 'air') { x.arc(32, 32, 10, 0.5, 5.5); }
  else if (r.kind === 'water') { x.moveTo(20, 26); x.quadraticCurveTo(26, 18, 32, 26); x.quadraticCurveTo(38, 34, 44, 26); x.moveTo(20, 38); x.quadraticCurveTo(26, 30, 32, 38); x.quadraticCurveTo(38, 46, 44, 38); }
  else if (r.kind === 'earth') { x.moveTo(20, 42); x.lineTo(32, 20); x.lineTo(44, 42); x.closePath(); }
  else { x.moveTo(32, 18); x.quadraticCurveTo(46, 32, 32, 46); x.quadraticCurveTo(20, 34, 32, 18); }
  x.stroke();
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; return t;
}

/** the real rune item model (tools/export-runes.ts): grey rune stone + element symbol, flat-shaded from a fixed
 *  light so it reads as a solid object. Stood on edge and scaled up so you can spot it from a board. */
const RUNE_GEOS = {};
function runeGeometry(kind) {
  return RUNE_GEOS[kind] ||= fetch(`assets/rune_${kind}.json`).then(r => r.json()).then(d => {
    const p = new Float32Array(d.pos), c = new Float32Array(d.col.length);
    const L = new THREE.Vector3(0.4, 0.8, 0.45).normalize(), a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
    for (let f = 0; f < p.length / 9; f++) {
      a.set(p[f * 9 + 3] - p[f * 9], p[f * 9 + 4] - p[f * 9 + 1], p[f * 9 + 5] - p[f * 9 + 2]);
      b.set(p[f * 9 + 6] - p[f * 9], p[f * 9 + 7] - p[f * 9 + 1], p[f * 9 + 8] - p[f * 9 + 2]);
      n.crossVectors(a, b).normalize();
      const k = 0.55 + 0.6 * Math.abs(n.dot(L));                   // two-sided: the stone has no back to hide
      for (let i = 0; i < 9; i++) c[f * 9 + i] = Math.min(1, d.col[f * 9 + i] / 255 * k);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.translate(0, -0.0625, 0); g.rotateX(Math.PI / 2);                // stand the stone on edge, centred
    return g;
  });
}
const RUNE_MAT = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true });
const RUNE_SCALE = 2.6;

// big gold S-K-A-T-E letter, RS-style bold font with a black drop shadow
function letterTexture(ch) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 54px "RuneScape Bold", Arial Black, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#000'; x.fillText(ch, 35, 36);
  x.fillStyle = '#ffd11a'; x.fillText(ch, 32, 33);
  x.strokeStyle = '#7a4a00'; x.lineWidth = 2; x.strokeText(ch, 32, 33);
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; return t;
}
let LETTER_MATS = null;

// deterministic PRNG so every player sees the runes in the same places
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// monsters: the first of each kind and every milestone after it pay out on top of the kill itself
export const KILL_MILESTONES = [
  { n: 1, x: 10, label: 'FIRST KILL' }, { n: 10, x: 20, label: '10 KILLS' }, { n: 50, x: 50, label: '50 KILLS' },
  { n: 100, x: 100, label: '100 KILLS' }, { n: 500, x: 250, label: '500 KILLS' },
];

export class Goals {
  constructor({ scene, world, sk, hud, audio, reward, save, runeList }) {
    Object.assign(this, { scene, world, sk, hud, audio, reward, save });
    this.found = new Set(); this.done = new Set(); this.kills = new Map();   // kills: npc kind -> how many, ever
    this.active = null; this.t = 0;
    this.runes = []; this.spots = [];
    const W = world;
    const mats = RUNES.map(r => new THREE.SpriteMaterial({ map: runeTexture(r), fog: true }));
    // runes: a FIXED list (tools/runes.py -> assets/runes.json) with stable ids the server checks, so a map
    // change can't move them or let anyone collect the same rune twice. Air runes float high: ollie or grind.
    const byKind = Object.fromEntries(RUNES.map((r, i) => [r.kind, i]));
    for (const q of runeList || []) {
      const k = byKind[q.kind] ?? 0, x = q.x - W.base[0] + 0.5, z = q.z - W.base[1] + 0.5;
      // the real rune stone model, with the old flat icon standing in until it has loaded
      const s = new THREE.Group(), icon = new THREE.Sprite(mats[k]); icon.scale.set(0.7, 0.7, 1); s.add(icon);
      runeGeometry(q.kind).then(g => { const m = new THREE.Mesh(g, RUNE_MAT); m.scale.setScalar(RUNE_SCALE); s.remove(icon); s.add(m); }).catch(() => {});
      scene.add(s);
      this.runes.push({ id: q.id, kind: q.kind, high: !!q.high, x, z, y: W.height(x, z) + (q.high ? 1.35 : 0.6), s,
        live: W.isLive ? W.isLive(Math.floor(x), Math.floor(z)) : true });
    }
    // spot beams
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffcc33, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffee66, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    for (const sp of SPOTS) {
      let [x, z] = [sp.at[0] - W.base[0] + 0.5, sp.at[1] - W.base[1] + 0.5];
      for (let r = 0; r < 8 && (W.tileKind(x, z) !== 0 || this.nearWall(x, z)); r++) {       // snap onto open ground
        let best = null;
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (W.tileKind(x + dx, z + dz) === 0 && !this.nearWall(x + dx, z + dz)) { best = [x + dx, z + dz]; break; }
        if (best) [x, z] = best;
      }
      const g = new THREE.Group();
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 7, 16, 1, true), beamMat.clone()); beam.position.y = 3.5;
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.35, 32), ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
      g.add(beam, ring); g.position.set(x, W.height(x, z), -z); scene.add(g);
      this.spots.push({ ...sp, x, z, g, cool: 0 });
    }
  }

  /** a streamed region arrived: runes standing in it now have real ground under them */
  regionLoaded() {
    for (const r of this.runes) if (!r.live && this.world.isLive(Math.floor(r.x), Math.floor(r.z))) { r.live = true; r.y = this.world.height(r.x, r.z) + (r.high ? 1.35 : 0.6); }
  }

  nearWall(x, z) { for (const s of this.world.segsNear(x, z, 1)) if (s.kind !== 'water') { const L2 = s.dx * s.dx + s.dz * s.dz, t = Math.max(0, Math.min(1, ((x - s.ax) * s.dx + (z - s.az) * s.dz) / L2)); if (Math.hypot(x - s.ax - s.dx * t, z - s.az - s.dz * t) < 0.8) return true; } return false; }

  /** merge, never replace: a rune picked up offline stays picked up when the account's list arrives */
  load(p) {
    const valid = new Set(this.runes.map(r => r.id));
    for (const id of p?.found || []) if (valid.has(id)) this.found.add(id);
    for (const id of p?.done || []) this.done.add(id);
    for (const [k, n] of Object.entries(p?.kills || {})) this.kills.set(k, Math.max(this.kills.get(k) || 0, n | 0));
  }

  /** called for every skater event (trick, banked, grind...) and NPC kills */
  event(e) {
    const a = this.active; if (!a) return;
    const sp = a.sp;
    if (sp.kind === 'combo' && e.type === 'banked' && e.total >= sp.n) this.win();
    if (sp.kind === 'trick' && e.type === 'trick' && e.name.includes(sp.trick)) this.win();
    if (sp.kind === 'grabflip' && e.type === 'trick' && /Grab/.test(e.name) && /flip|Flip/.test(e.name)) this.win();
    if (sp.kind === 'chain' && e.type === 'banked' && e.n >= sp.n) this.win();
    if (sp.kind === 'chain' && e.type === 'banked') a.best = Math.max(a.best || 0, e.n);
    if ((sp.kind === 'stomp' || sp.kind === 'smack') && e.type === 'kill' && e.npc === sp.npc && e.how === (sp.kind === 'stomp' ? 'stomp' : 'ram')) { a.count++; if (a.count >= sp.n) this.win(); }
    if (e.type === 'bail' && sp.kind !== 'combo') a.bails++;
  }

  /** place five letters in a ring round the spot on open ground; E and one other float high (air/grind) */
  spawnLetters(sp) {
    LETTER_MATS ||= [...'SKATE'].map(ch => new THREE.SpriteMaterial({ map: letterTexture(ch), fog: true }));
    const W = this.world, r = sp.r || 9, rnd = mulberry(sp.id.length * 7919 + Math.floor(sp.x * 31 + sp.z));
    // tiles you can actually skate to from the beam: flood fill, refusing steps through solid walls
    const tiles = this.reachAround(sp.x, sp.z, r);
    const pool = tiles.filter(([x, z]) => Math.hypot(x - sp.x, z - sp.z) > r * 0.35);
    const out = [];
    for (let i = 0, tries = 0; i < 5 && tries < 400 && pool.length; tries++) {
      const [x, z] = pool[Math.floor(rnd() * pool.length)];
      const ang = Math.atan2(z - sp.z, x - sp.x), want = (i / 5) * Math.PI * 2;
      if (tries < 250 && Math.abs(((ang - want + 9.42) % 6.283) - 3.14) > 0.9) continue;      // spread round the ring
      if (out.some(l => Math.hypot(l.x - x, l.z - z) < 3)) continue;
      const high = i === 4 || (i === 2 && W.railsNear(x, z, 2).size > 0);
      const s = new THREE.Sprite(LETTER_MATS[i]); s.scale.set(0.9, 0.9, 1); this.scene.add(s);
      out.push({ ch: 'SKATE'[i], x, z, y: W.height(x, z) + (high ? 1.3 : 0.7), high, s, got: false });
      i++;
    }
    return out;
  }
  /** open tiles reachable from (x,z) within radius r without passing a wall, fence, door, block or water */
  reachAround(x0, z0, r) {
    const W = this.world, SOLID = new Set(['wall', 'fence', 'door', 'block', 'water']);
    const cross = (ax, az, bx, bz, s) => {
      const d = (px, pz, qx, qz, rx, rz) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
      return d(ax, az, bx, bz, s.ax, s.az) * d(ax, az, bx, bz, s.bx, s.bz) < 0 && d(s.ax, s.az, s.bx, s.bz, ax, az) * d(s.ax, s.az, s.bx, s.bz, bx, bz) < 0;
    };
    const start = [Math.floor(x0) + 0.5, Math.floor(z0) + 0.5], seen = new Set([start.join()]), q = [start], out = [];
    while (q.length) {
      const [x, z] = q.pop(); out.push([x, z]);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz, k = nx + ',' + nz;
        if (seen.has(k) || Math.hypot(nx - x0, nz - z0) > r || W.tileKind(nx, nz) !== 0) continue;
        let bad = false;
        for (const s of W.segsNear((x + nx) / 2, (z + nz) / 2, 1)) if (SOLID.has(s.kind) && cross(x, z, nx, nz, s)) { bad = true; break; }
        if (bad) continue;
        seen.add(k); q.push([nx, nz]);
      }
    }
    return out;
  }
  clearLetters() { for (const l of this.active?.letters || []) this.scene.remove(l.s); }

  win() {
    this.clearLetters();
    const a = this.active, sp = a.sp; this.active = null;
    const first = !this.done.has(sp.id);
    const xp = first ? sp.xp : Math.round(sp.xp / 5);
    this.done.add(sp.id); this.save({ kind: 'spot', id: sp.id });
    this.hud.big('CHALLENGE COMPLETE', '#0f0', `${sp.name}  +${xp.toLocaleString()} XP${first ? '' : ' (repeat)'}`, 3);
    this.audio.event({ type: 'levelup' }); this.reward(xp);
    sp.cool = 8;
  }

  /** a monster knocked out: counts toward the bestiary. Returns the bonus XP this kill earns (first kill, milestones) */
  killed(kind, xp) {
    const n = (this.kills.get(kind) || 0) + 1; this.kills.set(kind, n);
    this.save({ kind: 'kill', id: kind });
    const bonus = KILL_MILESTONES.find(m => m.n === n);
    return bonus ? { n, xp: Math.round(xp * bonus.x), label: bonus.label } : { n, xp: 0 };
  }

  update(dt, cam) {
    const sk = this.sk, now = performance.now() / 1000;
    // runes
    for (const r of this.runes) {
      const got = this.found.has(r.id), d = Math.hypot(sk.x - r.x, sk.z - r.z);
      r.s.visible = !got && d < 60 && r.live;
      if (!r.s.visible) continue;
      r.s.position.set(r.x, r.y + Math.sin(now * 2 + r.x) * 0.1, -r.z);
      r.s.rotation.y = now * 1.6 + r.x;                                // turns slowly, like a dropped item catching the light
      const feet = sk.y, body = sk.mode === 'walk' || sk.mode === 'ground' ? [feet, feet + 1.8] : [feet, feet + 1.9];
      if (d < 0.8 && r.y > body[0] - 0.2 && r.y < body[1] && (!r.high || sk.mode === 'air' || sk.mode === 'grind')) {
        this.found.add(r.id); this.save({ kind: 'rune', id: r.id });
        const n = this.runes.filter(q => this.found.has(q.id)).length;
        this.hud.pop(`${r.kind.toUpperCase()} RUNE  ${n}/${this.runes.length}  +${RUNE_XP}`, '#0ff');
        this.audio.event({ type: 'rune' }); this.reward(RUNE_XP);
        if (n === this.runes.length) { this.hud.big('ALL RUNES FOUND!', '#0ff', `+${ALL_RUNES_XP.toLocaleString()} XP  ·  ::noclip UNLOCKED`, 5); this.reward(ALL_RUNES_XP); this.onAllRunes?.(); }
      }
    }
    // spots
    for (const sp of this.spots) {
      if (sp.cool > 0) sp.cool -= dt;
      const d = Math.hypot(sk.x - sp.x, sk.z - sp.z);
      sp.g.visible = d < 90;
      if (sp.g.visible) {
        // fade the beam away when the CAMERA is near it too, or it becomes a pale wall across the screen
        const dc = cam ? Math.hypot(cam.position.x - sp.x, -cam.position.z - sp.z) : 99;
        const near = Math.min(1, Math.max(0, (dc - 1.2) / 4));
        sp.g.children[0].material.opacity = (this.done.has(sp.id) ? 0.1 : 0.35 + Math.sin(now * 3) * 0.08) * Math.min(1, Math.max(0.25, (d - 1) / 8)) * near;
        sp.g.children[0].visible = near > 0.02;
        sp.g.rotation.y = now * 0.5;
      }
      if (!this.active && sp.cool <= 0 && d < 1.3 && sk.mode !== 'bail' && sk.mode !== 'walk') {
        this.active = { sp, t: sp.time, count: 0, bails: 0, grind: 0, manual: 0, airT: 0, bestAir: 0 };
        if (sp.kind === 'letters') this.active.letters = this.spawnLetters(sp);
        this.hud.big(sp.name.toUpperCase(), '#ff981f', sp.task + `  (${sp.time}s)`, 2.6);
        this.audio.event({ type: 'rune' });
      }
    }
    const a = this.active;
    if (a) {
      a.t -= dt;
      const sp = a.sp;
      if (sp.kind === 'grind' && sk.mode === 'grind') { a.grind += dt; if (a.grind >= sp.n) return this.win(); }
      if (sp.kind === 'manual' && sk.manual) { a.manual += dt; if (a.manual >= sp.n) return this.win(); }
      if (sp.kind === 'speed' && sk.speed * 3.6 * 1.1 >= sp.n) return this.win();
      if (sp.kind === 'air') {
        if (sk.mode === 'air') { a.airT += dt; a.bestAir = Math.max(a.bestAir, a.airT); if (a.airT >= sp.n) return this.win(); }
        else a.airT = 0;
      }
      if (sp.kind === 'letters') {
        for (const l of a.letters) {
          if (l.got) continue;
          l.s.position.set(l.x, l.y + Math.sin(now * 3 + l.x) * 0.08, -l.z);
          const inAir = sk.mode === 'air' || sk.mode === 'grind';
          if (Math.hypot(sk.x - l.x, sk.z - l.z) < 0.9 && l.y > sk.y - 0.3 && l.y < sk.y + 1.9 && (!l.high || inAir)) {
            l.got = true; this.scene.remove(l.s);
            this.audio.event({ type: 'rune' });
            this.hud.pop(a.letters.map(q => q.got ? q.ch : '_').join(' '), '#ffd11a');
          }
        }
        if (a.letters.length && a.letters.every(l => l.got)) return this.win();
      }
      if (a.t <= 0) { this.clearLetters(); this.active = null; sp.cool = 5; this.hud.big('OUT OF TIME', '#f00', sp.task, 2); }
    }
  }

  /** HUD line for the running challenge + a progress summary */
  /** every rune collected: unlocks ::noclip */
  allRunes() { return this.runes.length > 0 && this.runes.every(r => this.found.has(r.id)); }

  status() {
    const a = this.active;
    const runes = this.runes.filter(r => this.found.has(r.id)).length;
    const base = { runes, runeTotal: this.runes.length, allRunes: this.allRunes(), spots: SPOTS.filter(s => this.done.has(s.id)).length, spotTotal: SPOTS.length };
    if (!a) return base;
    const sp = a.sp;
    let prog = '';
    if (sp.kind === 'grind') prog = `${a.grind.toFixed(1)}/${sp.n}s`;
    if (sp.kind === 'manual') prog = `${a.manual.toFixed(1)}/${sp.n}s`;
    if (sp.kind === 'stomp' || sp.kind === 'smack') prog = `${a.count}/${sp.n}`;
    if (sp.kind === 'air') prog = `best ${a.bestAir.toFixed(2)}/${sp.n}s`;
    if (sp.kind === 'chain') prog = `best ${a.best || 0}/${sp.n}`;
    if (sp.kind === 'letters') prog = a.letters.map(l => l.got ? l.ch : '_').join(' ');
    return { ...base, task: sp.task, prog, t: Math.max(0, a.t) };
  }

  /** minimap markers */
  dots() {
    const out = [];
    for (const sp of this.spots) out.push({ x: sp.x, z: sp.z, col: this.done.has(sp.id) ? '#886' : '#fc3', r: 3 });
    for (const r of this.runes) if (!this.found.has(r.id)) out.push({ x: r.x, z: r.z, col: '#0cf', r: 1.5 });
    return out;
  }
}
