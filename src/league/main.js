// Rune League: Rocket League in the Lumbridge cabbage patch. RL's arena, physics and rules to the unit (match.js,
// pure, tested headless by test/league.js), shrunk into the real cabbage patch so the karts are toys and the ball is a
// giant cabbage; Lumbridge's cows and farmers watch over the walls. 1v1 / 2v2 / 3v3 against bots (rookie, pro,
// all-star), or free play; ball cam, boost pads, demos, goal replays, quick chat, the scoreboard on TAB.
import * as THREE from 'three';
import { Match, C, MODES, basis, TICK } from './match.js';
import { botInput, DIFFS } from './bots.js';
import { D, N, L, GH } from './arena.js';
import { buildArena, Pads, buildCabbage, TEAM, SUN, floorShape } from './scenery.js';
import { CarVis, HATS } from './cars.js';
import { LeagueHud, QUICK, clock } from './hud.js';
import { LeagueInput, TOUCH } from './input.js';
import { loadPack } from '../cart/scenery.js';
import { THEMES, BODIES } from '../cart/models.js';
import { loadRSModel } from '../model.js';
import { loadModels } from './rsmodels.js';
import { LeagueNet } from './netclient.js';
import { Post, buildSky, Scaler } from './gfx.js';
import { Puffs, puffTex, glowTex } from '../cod/wrathfx.js';
import { Sfx } from '../cod/sfx.js';
import { RSFont } from '../hud.js';

THREE.ColorManagement.enabled = false;
const $ = id => document.getElementById(id);
const status = t => { const e = $('status'); if (e) e.textContent = t; };
const SETUP_KEY = 'runeleague.setup', REC_KEY = 'runeleague.record';
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const FOG = 0xc4d4e6;
export const BOOMS = { party: 'PARTY ROOM', dragon: 'DRAGONFIRE', barrage: 'ICE BARRAGE', guthix: 'CLAWS OF GUTHIX', cannon: 'DWARF CANNON' };
const BOT_NAMES = ['Bob', 'Fred', 'Hans', 'Doric', 'Aggie', 'Ned', 'Zezima', 'Sir Amik', 'Wise Old Man', 'Bartender', 'Duke Horacio', 'Wizard Mizgog', 'Gertrude', 'Father Aereck', 'Cook', 'Romeo'];

// ---------------------------------------------------------------- sounds (Web Audio, made on the spot)
class LeagueSfx extends Sfx {
  engineOn() {
    if (!this.ok || this.eng) return;
    const c = this.ctx, o1 = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o1.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 500; g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g).connect(this.out); o1.start(); o2.start();
    const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true; const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 0.8;
    const ng = c.createGain(); ng.gain.value = 0; n.connect(nf).connect(ng).connect(this.out); n.start();
    this.eng = { o1, o2, f, g, ng, nf };
  }
  engine(v, boost, on, sonic) {
    if (!this.eng) return;
    const t = this.ctx.currentTime, f = 52 + v * 0.07;
    this.eng.o1.frequency.setTargetAtTime(f, t, 0.05); this.eng.o2.frequency.setTargetAtTime(f * 0.502, t, 0.05);
    this.eng.f.frequency.setTargetAtTime(420 + v * 0.5, t, 0.08);
    this.eng.g.gain.setTargetAtTime(on ? 0.045 + Math.min(0.04, v * 0.00002) : 0, t, 0.12);
    this.eng.ng.gain.setTargetAtTime(on && boost ? 0.09 : on && sonic ? 0.03 : 0, t, 0.06);
    this.eng.nf.frequency.setTargetAtTime(boost ? 700 + v * 0.3 : 3000, t, 0.06);
  }
  beep(go) { this.tone(go ? 880 : 440, go ? 880 : 440, go ? 0.5 : 0.22, 0.2, 'square'); }
  hit(v, near = 1) { const k = Math.min(1, v / 3000) * near; this.burst(300 + v * 0.2, 0.18, 0.25 + k * 0.5, 'lowpass', 1); this.tone(180 + v * 0.05, 70, 0.15, 0.25 * k + 0.05, 'triangle'); }
  jump(v = 0.2) { this.burst(1400, 0.16, v, 'bandpass', 1.5); }
  flip() { this.burst(2200, 0.3, 0.22, 'bandpass', 1.2); }
  pad(big) { if (big) { this.tone(420, 840, 0.25, 0.16, 'triangle'); this.tone(630, 1260, 0.25, 0.1, 'sine', 0, 0.05); } else this.tone(700, 1000, 0.08, 0.1, 'triangle'); }
  thud(v = 0.5) { this.burst(300, 0.14, v, 'lowpass', 1); }
  crowd(v = 1) { this.burst(1100, 2.6, 0.32 * v, 'bandpass', 0.4, 0, 0.6); this.burst(2400, 2.2, 0.16 * v, 'bandpass', 0.6, 0, 0.6, 0.1); }
  moo() { this.tone(170, 130, 0.9, 0.18, 'sawtooth', -0.4, 0.4); }
  cluck() { this.tone(700, 1100, 0.07, 0.1, 'square', 0.4, 0.7); this.tone(900, 1300, 0.09, 0.1, 'square', 0.4, 0.8); }
  /** the RS level-up fanfare, more or less */
  fanfare(good) {
    const N = good ? [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36], [988, 0.62], [1047, 0.74], [1319, 0.86]] : [[392, 0], [370, 0.18], [349, 0.36], [262, 0.6]];
    for (const [f, at] of N) { this.tone(f, f, good ? 0.22 : 0.3, 0.15, 'square', 0, at); this.tone(f / 2, f / 2, 0.22, 0.08, 'triangle', 0, at); }
  }
  chat() { this.tone(1200, 1500, 0.05, 0.08, 'square'); }
}

// ---------------------------------------------------------------- particles (world units)
class Fx {
  constructor(scene, lite) {
    this.add = new Puffs(scene, lite ? 600 : 1500, true, glowTex());
    this.smoke = new Puffs(scene, lite ? 300 : 800, false, puffTex());
    this.v = new THREE.Vector3();
  }
  trail(p, d, col, sonic) {
    const k = SCALE;
    this.add.emit(p.x, p.y, p.z, d.x * 2.2 * k + (Math.random() - 0.5) * 0.4 * k, d.y * 2.2 * k + (Math.random() - 0.5) * 0.4 * k, d.z * 2.2 * k + (Math.random() - 0.5) * 0.4 * k, (sonic ? 0.5 : 0.38) * k, 0.22, { c0: col.c0, c1: col.c1, grow: 0.3, drag: 4 });
  }
  streak(p) { this.add.emit(p.x, p.y, p.z, 0, 0, 0, 0.12 * SCALE, 0.25, { c0: [1, 1, 1], c1: [0.7, 0.85, 1], grow: 0.2, a: 0.5 }); }
  dust(p, n = 6, col = [0.5, 0.45, 0.35]) { for (let i = 0; i < n; i++) this.smoke.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 2 * SCALE, Math.random() * 1.5 * SCALE, (Math.random() - 0.5) * 2 * SCALE, 0.5 * SCALE, 0.7, { c0: col, a: 0.5, grow: 2.2, drag: 2 }); }
  sparks(p, col, n = 12, sp = 3) { for (let i = 0; i < n; i++) this.add.emit(p.x, p.y, p.z, (Math.random() - 0.5) * sp * SCALE, Math.random() * sp * SCALE, (Math.random() - 0.5) * sp * SCALE, 0.18 * SCALE, 0.4 + Math.random() * 0.3, { c0: [1, 1, 1], c1: col, g: 3 * SCALE, drag: 1.5, grow: 0.4 }); }
  boom(p, big = 1) {
    const k = SCALE * big;
    for (let i = 0; i < 40; i++) { const a = Math.random() * 6.283, u = Math.random(); this.add.emit(p.x, p.y, p.z, Math.cos(a) * (2 + u * 6) * k, (1 + Math.random() * 5) * k, Math.sin(a) * (2 + u * 6) * k, (0.6 + Math.random() * 0.8) * k, 0.5 + Math.random() * 0.4, { c0: [1, 0.95, 0.75], c1: [1, 0.3, 0.05], grow: 1.8, drag: 3, g: -1 * k }); }
    for (let i = 0; i < 18; i++) this.smoke.emit(p.x + (Math.random() - 0.5) * k, p.y, p.z + (Math.random() - 0.5) * k, (Math.random() - 0.5) * 2 * k, (1 + Math.random() * 2) * k, (Math.random() - 0.5) * 2 * k, 1.4 * k, 1.6 + Math.random(), { c0: [0.25, 0.22, 0.2], a: 0.7, grow: 2.4, drag: 1.2, g: -0.4 * k });
  }
  update(dt, cam) { this.add.update(dt, cam); this.smoke.update(dt, cam); }
}
const _bt = new THREE.Vector3();
let SCALE = 1;                                                   // world units per "effect unit" (set from the site: effects are scaled to the toys)

// ---------------------------------------------------------------- goal explosions, RS style
class Booms {
  constructor(scene, fx) { this.scene = scene; this.fx = fx; this.live = []; }
  go(kind, p, team) {
    const fx = this.fx, k = SCALE, tc = new THREE.Color(TEAM[team].col), tcol = [tc.r, tc.g, tc.b];
    if (kind === 'party') {
      // the Falador Party Room: balloons up, confetti down
      const cols = [0xe23a3a, 0x3a6ae2, 0xf2d23a, 0x3ac24a, 0xb84ad8, 0xf0f0f0];
      for (let i = 0; i < 26; i++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.42 * k, 10, 8), new THREE.MeshLambertMaterial({ color: cols[i % cols.length] }));
        b.scale.set(1, 1.2, 1); b.position.set(p.x + (Math.random() - 0.5) * 4 * k, p.y + Math.random() * k, p.z + (Math.random() - 0.5) * 4 * k);
        const str = new THREE.Mesh(new THREE.CylinderGeometry(0.01 * k, 0.01 * k, 0.8 * k, 3), new THREE.MeshBasicMaterial({ color: 0xdddddd })); str.position.y = -0.8 * k; b.add(str);
        this.scene.add(b); this.live.push({ m: b, vy: (1.5 + Math.random() * 2) * k, t: 0, life: 4 + Math.random() * 2, sway: Math.random() * 6 });
      }
      for (let i = 0; i < 90; i++) fx.add.emit(p.x, p.y + 2 * k, p.z, (Math.random() - 0.5) * 9 * k, (2 + Math.random() * 6) * k, (Math.random() - 0.5) * 9 * k, 0.16 * k, 1.8 + Math.random(), { c0: [Math.random(), Math.random(), Math.random()], g: 3 * k, drag: 1.4, grow: 1 });
    } else if (kind === 'dragon') {
      for (let i = 0; i < 120; i++) { const a = Math.random() * 6.283, u = Math.random(); fx.add.emit(p.x, p.y, p.z, Math.cos(a) * u * 10 * k, (2 + Math.random() * 9) * k, Math.sin(a) * u * 10 * k, (1 + Math.random()) * k, 0.8 + Math.random() * 0.6, { c0: [1, 0.9, 0.5], c1: [0.9, 0.15, 0.02], grow: 2, drag: 2, g: -1 * k }); }
      fx.boom(p, 2.2);
    } else if (kind === 'barrage') {
      for (let i = 0; i < 70; i++) { const a = Math.random() * 6.283, u = Math.random(); fx.add.emit(p.x, p.y, p.z, Math.cos(a) * (3 + u * 8) * k, (Math.random() * 6) * k, Math.sin(a) * (3 + u * 8) * k, 0.4 * k, 1.2, { c0: [1, 1, 1], c1: [0.4, 0.8, 1], g: 4 * k, drag: 1.5, grow: 0.6 }); }
      for (let i = 0; i < 30; i++) fx.smoke.emit(p.x + (Math.random() - 0.5) * 6 * k, p.y, p.z + (Math.random() - 0.5) * 6 * k, 0, 0.6 * k, 0, 2 * k, 2.2, { c0: [0.75, 0.9, 1], a: 0.6, grow: 2 });
      const ice = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4 * k, 0), new THREE.MeshLambertMaterial({ color: 0xa8e8ff, transparent: true, opacity: 0.6, emissive: 0x204858, flatShading: true }));
      ice.position.copy(p); this.scene.add(ice); this.live.push({ m: ice, vy: 0, t: 0, life: 2.4, grow: true });
    } else if (kind === 'guthix') {
      // Claws of Guthix: green bolts down round the goal, leaves thrown up
      for (let j = 0; j < 7; j++) {
        const x = p.x + (Math.random() - 0.5) * 7 * k, z = p.z + (Math.random() - 0.5) * 7 * k;
        for (let i = 0; i < 16; i++) fx.add.emit(x + (Math.random() - 0.5) * 0.4 * k, p.y + i * 0.6 * k, z + (Math.random() - 0.5) * 0.4 * k, 0, 0, 0, 0.5 * k, 0.35 + j * 0.05, { c0: [0.9, 1, 0.8], c1: [0.2, 0.9, 0.2], grow: 0.4 });
      }
      for (let i = 0; i < 60; i++) fx.smoke.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 8 * k, (2 + Math.random() * 6) * k, (Math.random() - 0.5) * 8 * k, 0.3 * k, 2, { c0: [0.3, 0.6, 0.15], a: 0.95, g: 3 * k, drag: 1, grow: 1 });
    } else {
      // a dwarf multicannon's salute: cannonballs bursting overhead
      for (let j = 0; j < 6; j++) setTimeout(() => { const q = { x: p.x + (Math.random() - 0.5) * 8 * k, y: p.y + (3 + Math.random() * 4) * k, z: p.z + (Math.random() - 0.5) * 8 * k }; fx.boom(q, 0.9); fx.sparks(q, tcol, 30, 8); }, j * 180);
    }
    fx.sparks(p, tcol, 40, 9);
  }
  update(dt) {
    this.live = this.live.filter(b => {
      b.t += dt; if (b.t > b.life) { b.m.removeFromParent(); return false; }
      if (b.grow) { const s = Math.min(1, b.t * 4); b.m.scale.setScalar(s); b.m.material.opacity = 0.6 * (1 - b.t / b.life); }
      else { b.m.position.y += b.vy * dt; b.m.position.x += Math.sin(b.t * 2 + b.sway) * 0.3 * SCALE * dt; }
      return true;
    });
  }
}

// ---------------------------------------------------------------- the game
async function main() {
  status('loading the cabbage patch...');
  const pSite = fetch('assets/league_patch.site.json').then(r => r.json());
  const pPack = loadPack('league_patch', status);
  const pModels = loadModels();
  const pFonts = Promise.all([RSFont.load('b12'), RSFont.load('p12')]);
  const canvas = $('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance', logarithmicDepthBuffer: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, TOUCH ? 1.25 : 1.75));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.setClearColor(FOG, 1);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG, 60, 260);
  scene.add(new THREE.HemisphereLight(0xe4ecff, 0x5a5040, 1.15));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.3); sun.position.set(-40, 80, 30); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.02, 420);

  const site = await pSite; SCALE = 400 * site.K * 0.25;          // (effects sized for a car about 0.3 units long)
  // the arena group: RL's uu, scaled into the world at the cabbage patch, the pitch run east
  const arena = new THREE.Group(); arena.position.set(site.x, site.y, -site.z); arena.rotation.y = site.rot; arena.scale.setScalar(site.K); scene.add(arena);
  const toWorld = (p, out = new THREE.Vector3()) => out.set(p[0], p[1], p[2]).applyMatrix4(arena.matrixWorld);
  arena.updateMatrixWorld();
  // the sun: where the stadium's baked light comes from, casting real shadows (cars, ball, fence, rafters) on the pitch
  const sunW = SUN.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), site.rot), mid = toWorld([0, 0, 0]);
  sun.position.copy(mid).addScaledVector(sunW, 60); sun.target.position.copy(mid); scene.add(sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(TOUCH ? 1024 : 2048, TOUCH ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -19, right: 19, top: 19, bottom: -19, near: 20, far: 110 }); sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 3;
  const sky = buildSky(sunW, FOG); scene.add(sky);
  const pack = await pPack; scene.add(pack.group);
  status('building the stadium...'); await pModels;
  const stadium = buildArena(TOUCH); arena.add(stadium.group);
  stadium.group.traverse(o => { if (o.isMesh && !o.material.transparent && !o.userData.noShadow) o.castShadow = true; });
  { const rec = new THREE.Mesh(floorShape(), new THREE.ShadowMaterial({ opacity: 0.34, color: 0x10200a })); rec.position.y = 3; rec.receiveShadow = true; arena.add(rec); }   // (just over the chalk)
  const pads = new Pads(arena);
  const ballM = buildCabbage(C.ballR); arena.add(ballM); ballM.traverse(o => { if (o.isMesh && o.material.side !== THREE.BackSide) o.castShadow = true; });
  const ballQ = new THREE.Quaternion();
  const ballSh = new THREE.Mesh(new THREE.CircleGeometry(C.ballR, 20), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  ballSh.rotation.x = -Math.PI / 2; arena.add(ballSh);
  // the crowd: Lumbridge's own, outside the walls (real size: they tower over the toys)
  const crowd = [];
  const spots = [['npc_cow', -5600, -2200], ['npc_cow', 5900, 1600], ['npc_chicken', -5000, 3600], ['npc_chicken', -4700, 3900], ['npc_chicken', 5200, -3500], ['npc_man', 0, -7200], ['npc_man', 2400, 6900], ['npc_guard', -2600, 6900], ['npc_dwarf', 5400, 3300], ['npc_cow', -1800, -7400], ['npc_chicken', 3300, -6900], ['npc_man', -5600, 900]];
  // ...and a full house: rows of townsfolk round the patch (a fixed scatter: the same crowd every game), lighter on phones
  { let sd = 7; const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647, folk = ['npc_man', 'npc_man', 'npc_guard', 'npc_dwarf', 'npc_barbarian', 'npc_whiteknight', 'npc_darkwizard', 'npc_goblin', 'npc_imp', 'npc_man', 'npc_guard', 'npc_skeleton'];
    for (let i = 0; i < (TOUCH ? 14 : 36); i++) { const side = i % 4, u = r() * 2 - 1, d = r();
      const [x, z] = side < 2 ? [(side ? 1 : -1) * (5200 + d * 1300), u * 5200] : [u * 3600, (side === 2 ? 1 : -1) * (7000 + d * 900)];
      if (spots.some(([, sx, sz]) => Math.hypot(sx - x, sz - z) < 500)) continue;
      spots.push([folk[(r() * folk.length) | 0], x, z]); } }
  for (const [n, x, z] of spots) loadRSModel(n).then(md => {
    const p = toWorld([x, 0, z]); md.group.position.copy(p); md.play('ready'); md.clipT = Math.random() * 2;
    const c = toWorld([0, 0, 0]); md.group.rotation.y = Math.atan2(c.x - p.x, c.z - p.z) + Math.PI;   // (facing in at the pitch)
    md.y0 = p.y; md.hop = 0; md.ph = Math.random() * 6.28;
    md.group.traverse(o => { if (o.isMesh) o.castShadow = false; });
    scene.add(md.group); crowd.push(md);
  }).catch(() => {});
  const cheer = () => { for (const md of crowd) md.hop = 1.6 + Math.random() * 0.8; };   // (a goal: everyone's up and jumping)
  const [b12, p12] = await pFonts;
  const hud = new LeagueHud($('hud'), { b12, p12 });
  const fx = new Fx(scene, TOUCH), booms = new Booms(scene, fx);
  const sfx = new LeagueSfx();
  const input = new LeagueInput(canvas); input.bindTouch($('touch'), $('stick'), $('knob'));
  // the finish (gfx.js): HDR + MSAA, bloom, FXAA, filmic grade; the resolution follows the frame rate
  const post = new Post(renderer, TOUCH), baseDpr = renderer.getPixelRatio(), scaler = new Scaler(baseDpr, TOUCH ? 0.72 : 0.6);
  post.sun.copy(sunW);
  const draw = () => post.render(scene, camera);
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); hud.resize();
    const pr = renderer.getPixelRatio(); post.setSize(Math.round(innerWidth * pr), Math.round(innerHeight * pr));
  };
  addEventListener('resize', resize); resize();

  // ---------------- the setup
  const setup = Object.assign({ name: '', size: 2, diff: 'pro', team: 0, body: 'kart', theme: 'sara', hat: 'god', boom: 'party', ballcam: true, gfx: TOUCH ? 'low' : 'high' }, load(SETUP_KEY, {}));
  // the graphics level: HIGH has the sun's shadows, MSAA and light shafts; LOW drops them (bloom, grade and FXAA stay)
  const applyGfx = q => { const hi = q === 'high'; sun.castShadow = hi; post.shafts = hi; const sm = hi && !TOUCH ? 4 : 0; if (post.rt.samples !== sm) { post.rt.samples = sm; post.rt.dispose(); } };
  applyGfx(setup.gfx);
  if (!setup.name) setup.name = 'Player' + (100 + Math.floor(Math.random() * 900));
  let net = null, netMsg = '', netEv = [], m = null, vis = [], me = null, mode = 'menu', paused = false, endShown = false, preview = null, previewKey = '', ballcam = setup.ballcam;
  const cam = { p: null, yaw: 0, init: false };
  const rec = []; let replay = null;

  function seg(label, opts, cur) { return `<div class="row"><div class="lab">${label}</div><div class="seg">${opts.map(([k, n, sw]) => `<button data-v="${k}" class="${String(k) === String(cur) ? 'sel' : ''}">${sw ? `<i style="background:${sw}"></i>` : ''}${n}</button>`).join('')}</div></div>`; }
  function showPreview() {
    const key = setup.body + setup.theme + setup.hat + setup.team; if (key === previewKey) return; previewKey = key;
    preview?.dispose();
    preview = new CarVis(arena, { team: setup.team, theme: setup.theme, body: setup.body, hat: setup.hat });
    preview.s = { p: [0, C.ride, 0], q: [0, 0, 0, 1], fwd: 0, steer: 0 };
  }
  function menu() {
    mode = 'menu'; document.body.classList.remove('playing'); for (const id of ['touch', 'endbox', 'pause']) $(id).style.display = 'none';
    clear(); showPreview();
    const recd = load(REC_KEY, { w: 0, l: 0 });
    $('menubox').innerHTML = `<div class="title">RUNE LEAGUE</div><div class="sub">Rocket League in the Lumbridge cabbage patch. Hit the cabbage in their goal. Record ${recd.w}W ${recd.l}L</div>
      <div class="col top"><button id="m-go">PLAY vs BOTS</button><button id="m-online">PLAY ONLINE</button><button id="m-free" class="small">FREE PLAY</button><a class="small" href="index.html?pick">&laquo; OTHER GAMES</a></div>
      <div class="row name"><div class="lab">NAME</div><input id="m-name" maxlength="12" value="${setup.name.replace(/"/g, '')}"></div>
      <div id="m-size">${seg('MODE', Object.entries(MODES).map(([k, n]) => [k, n]), setup.size)}</div>
      <div id="m-diff">${seg('BOTS', Object.entries(DIFFS).map(([k, d]) => [k, d.name]), setup.diff)}</div>
      <div id="m-team">${seg('TEAM', TEAM.map((t, i) => [i, t.name, t.css]), setup.team)}</div>
      <div id="m-body">${seg('KART', Object.entries(BODIES).map(([k, n]) => [k, n]), setup.body)}</div>
      <div id="m-theme">${seg('GOD', Object.entries(THEMES).map(([k, t]) => [k, t.name, '#' + t.acc.toString(16).padStart(6, '0')]), setup.theme)}</div>
      <div id="m-hat">${seg('HAT', Object.entries(HATS).map(([k, h]) => [k, h[0]]), setup.hat)}</div>
      <div id="m-boom">${seg('GOAL FX', Object.entries(BOOMS).map(([k, n]) => [k, n]), setup.boom)}</div>
      <div id="m-gfx">${seg('GRAPHICS', [['high', 'HIGH'], ['low', 'LOW']], setup.gfx)}</div>
      <div class="keys">${TOUCH ? 'The gas is on for you. <b>Stick</b> steers (and tips the nose in the air; pull it right back to reverse). <b>JUMP</b> twice to double jump, or with the stick pushed to flip. <b>BOOST</b>, <b>SLIDE</b> powerslides / air rolls, <b>CAM</b> ball cam.'
        : '<b>W S</b> drive (nose down / up in the air) &nbsp; <b>A D</b> steer &nbsp; <b>RIGHT MOUSE</b> jump (again to double jump, with a direction to flip) &nbsp; <b>LEFT MOUSE</b> boost &nbsp; <b>SHIFT</b> powerslide + air roll &nbsp; <b>Q E</b> air roll &nbsp; <b>SPACE</b> ball cam on / off &nbsp; (no mouse: <b>J</b> jump, <b>K</b> boost) &nbsp; <b>TAB</b> scores &nbsp; <b>1-4</b> quick chat &nbsp; <b>ESC</b> pause. A pad plays like RL.'}</div>`;
    const wire = (id, key, after, num) => { for (const b of $(id).querySelectorAll('button')) b.onclick = () => { setup[key] = num ? +b.dataset.v : b.dataset.v; save(SETUP_KEY, setup); for (const o of $(id).querySelectorAll('button')) o.classList.toggle('sel', o === b); after?.(); }; };
    wire('m-size', 'size', null, true); wire('m-diff', 'diff'); wire('m-team', 'team', showPreview, true); wire('m-body', 'body', showPreview); wire('m-theme', 'theme', showPreview); wire('m-hat', 'hat', showPreview); wire('m-boom', 'boom'); wire('m-gfx', 'gfx', () => applyGfx(setup.gfx));
    $('m-name').oninput = e => { setup.name = e.target.value.trim().slice(0, 12) || setup.name; save(SETUP_KEY, setup); };
    $('m-go').onclick = () => start(false); $('m-free').onclick = () => start(true); $('m-online').onclick = () => startOnline();
    $('menu').style.display = '';
  }
  function clear() { for (const v of vis) v.dispose(); vis = []; m = null; me = null; replay = null; rec.length = 0; net?.close(); net = null; netEv = []; }
  // ---------------- online: the server's 3v3 (netserver.js); we take a bot's seat
  function startOnline() {
    sfx.start(); sfx.engineOn();
    clear(); preview?.dispose(); preview = null; previewKey = '';
    mode = 'game'; paused = false; endShown = false; cam.init = false; hud.feedL = []; hud.pops = []; hud.chat = []; netMsg = 'connecting...';
    for (const id of ['menu', 'endbox', 'pause']) $(id).style.display = 'none';
    document.body.classList.add('playing'); $('touch').style.display = TOUCH ? '' : 'none';
    const seatIn = (mm, mine) => {
      for (const v of vis) v.dispose(); m = mm; me = mine; vis = m.cars.map(c => new CarVis(arena, c));
      for (const c of m.cars) if (c.bot) c.name = c.name;
    };
    net = new LeagueNet(setup, {
      welcome: (mm, mine) => { seatIn(mm, mine); netMsg = ''; endShown = false; $('endbox').style.display = 'none'; $('touch').style.display = TOUCH ? '' : 'none'; cam.init = false; rec.length = 0; replay = null; hud.feed(`You joined the ${TEAM[mine.team].name} team`, TEAM[mine.team].css); },
      roster: (mm, mine) => { seatIn(mm, mine); },
      event: e => netEv.push(e),
      chat: (id, a, b) => { const c = m?.cars.find(o => o.id === id); if (c) { hud.say(c.name, QUICK[a - 1][1][b - 1], TEAM[c.team].css); sfx.chat(); } },
      status: t => { netMsg = t; },
      full: () => { netMsg = 'the match is full: try again in a bit'; },
    });
    lastBeep = 9;
  }
  function start(free) {
    sfx.start(); sfx.engineOn();
    clear(); preview?.dispose(); preview = null; previewKey = '';
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5), gods = Object.keys(THEMES).sort(() => Math.random() - 0.5), bodies = Object.keys(BODIES), booms = Object.keys(BOOMS);
    const players = [{ id: 'me', name: setup.name, team: setup.team, body: setup.body, theme: setup.theme, hat: setup.hat, boom: setup.boom }];
    if (!free) for (let t = 0; t < 2; t++) for (let i = players.filter(p => p.team === t).length; i < setup.size; i++)
      players.push({ id: 'bot' + players.length, name: names[players.length % names.length], team: t, bot: true, diff: setup.diff, body: bodies[(players.length * 5) % 3], theme: gods[players.length % gods.length], boom: booms[players.length % booms.length] });
    m = new Match({ players, seed: (Math.random() * 1e9) | 0, replayT: free ? 0 : 6, freeplay: free });
    if (free) { m.state = 'play'; m.ball.p = [0, 400, 0]; }
    me = m.cars.find(c => c.id === 'me');
    vis = m.cars.map(c => new CarVis(arena, c));
    mode = 'game'; paused = false; endShown = false; cam.init = false; replay = null; hud.feedL = []; hud.pops = []; hud.chat = [];
    for (const id of ['menu', 'endbox', 'pause']) $(id).style.display = 'none';
    document.body.classList.add('playing'); $('touch').style.display = TOUCH ? '' : 'none';
    lastBeep = 9;
  }
  function setPaused(p) { if (mode !== 'game' || endShown) return; paused = p && !net; if (net) { $('pause').style.display = p ? 'flex' : 'none'; return; } $('pause').style.display = p ? 'flex' : 'none'; sfx.engine(0, false, false); }
  $('p-resume').onclick = () => setPaused(false); $('p-restart').onclick = () => net ? startOnline() : start(m?.freeplay); $('p-quit').onclick = () => menu();
  $('e-again').onclick = () => net ? ($('endbox').style.display = 'none') : start(false); $('e-menu').onclick = () => menu(); $('pausebtn').onclick = () => setPaused(!paused);

  function showEnd(win) {
    endShown = true;
    const recd = load(REC_KEY, { w: 0, l: 0 }); if (win === me.team) recd.w++; else recd.l++; save(REC_KEY, recd);
    const mvp = m.mvp(win), rows = team => m.cars.filter(c => c.team === team).sort((a, b) => b.st.score - a.st.score).map(c => `<tr style="color:${c === me ? '#0f0' : '#ff0'}"><td>${c === mvp ? '&#9733; ' : ''}${c.name}</td><td>${c.st.score}</td><td>${c.st.goals}</td><td>${c.st.assists}</td><td>${c.st.saves}</td><td>${c.st.shots}</td></tr>`).join('');
    const head = t => `<tr style="background:${TEAM[t].css}55"><td>${TEAM[t].name} ${m.score[t]}</td><td>SCORE</td><td>G</td><td>A</td><td>SV</td><td>SH</td></tr>`;
    $('endbox').querySelector('.title').textContent = win === me.team ? 'VICTORY!' : 'DEFEAT';
    $('endbox').querySelector('.stats').innerHTML = `<div class="sub">${TEAM[win].name} WINS ${m.score[win]} - ${m.score[1 - win]}${m.ot ? ' in overtime' : ''} &middot; MVP: ${mvp?.name || '-'}</div>
      <table class="res sb">${head(0)}${rows(0)}${head(1)}${rows(1)}</table>`;
    $('endbox').style.display = 'flex'; $('touch').style.display = 'none';
    sfx.fanfare(win === me.team);
  }

  // ---------------- what happens -> sound, shouts, effects
  const carBy = id => m.cars.find(c => c.id === id);
  const near = p => { const d = Math.hypot(p[0] - me.p[0], p[1] - me.p[1], p[2] - me.p[2]); return 1 / (1 + d / 1500); };
  const botSay = (c, line) => { if (!c || !c.bot) return; hud.say(c.name, line, TEAM[c.team].css); };
  function events() {
    for (const e of m.events) {
      const c = e.id ? carBy(e.id) : null, mine = e.id === 'me';
      switch (e.t) {
        case 'go': sfx.beep(true); hud.big('GO!', '', '#0f0', 0.8); break;
        case 'kickoff': rec.length = 0; break;
        case 'touch': sfx.hit(e.v, near(m.ball.p)); fx.sparks(toWorld(m.ball.p), [1, 1, 0.7], 4, 2); break;
        case 'bounce': if (e.v > 500) sfx.thud(Math.min(0.5, e.v / 4000) * near(e.p)); break;
        case 'jump': if (mine) sfx.jump(e.dbl ? 0.25 : 0.18); break;
        case 'flip': if (mine) sfx.flip(); break;
        case 'land': if (mine && e.v > 300) sfx.thud(Math.min(0.4, e.v / 2000)); if (c && e.v > 500) fx.dust(toWorld(c.p), 5); break;
        case 'wall': if (mine) sfx.thud(Math.min(0.5, e.v / 2000)); break;
        case 'pad': if (mine) sfx.pad(e.big); break;
        case 'sonic': if (mine) sfx.burst(2600, 0.5, 0.15, 'highpass', 0.5); break;
        case 'bump': if (e.a === 'me' || e.b === 'me') sfx.thud(0.5); break;
        case 'demo': {
          const a = carBy(e.a), b = carBy(e.b); fx.boom(toWorld(e.p), 1.1); sfx.boom(Math.hypot(e.p[0] - me.p[0], e.p[2] - me.p[2]) / 800);
          hud.feed(`${a.name} demolished ${b.name}`, TEAM[a.team].css);
          if (e.a === 'me') hud.pop('DEMOLITION +25', '#ff981f'); if (e.b === 'me') hud.big('DEMOLISHED', 'respawning...', '#f44', 2.5);
          break;
        }
        case 'shot': if (mine) hud.pop('SHOT ON GOAL +20'); break;
        case 'save': hud.feed(`${c.name}: ${e.epic ? 'EPIC SAVE!' : 'SAVE!'}`, TEAM[c.team].css); if (mine) hud.pop(e.epic ? 'EPIC SAVE +75' : 'SAVE +50', '#7ad8ff'); else if (c.team === me.team && Math.random() < 0.5) botSay(c, 'Tanking...'); else if (c.team !== me.team) { const mate = m.cars.find(o => o.bot && o.team === c.team && o !== c); botSay(mate, 'Nice prayer flick!'); } break;
        case 'goal': {
          const sc = e.id ? carBy(e.id) : null, as = e.assist ? carBy(e.assist) : null, good = e.team === me.team;
          booms.go(sc?.boom || 'party', toWorld(e.p), e.team);
          if (!m.freeplay) { hud.big('GOAL!', `${sc ? sc.name : TEAM[e.team].name}${as ? ' (assist ' + as.name + ')' : ''} · ${e.v.toFixed(0)} KM/H`, TEAM[e.team].css, 3); hud.feed(`${sc?.name || '?'} scored!`, TEAM[e.team].css); }
          else hud.big('GOAL!', `${e.v.toFixed(0)} KM/H`, '#ff981f', 1.5);
          if (e.id === 'me') hud.pop('GOAL +100', '#0f0'); if (e.assist === 'me') hud.pop('ASSIST +50', '#0f0');
          cheer(); sfx.fanfare(good || m.freeplay); sfx.crowd(); if (Math.random() < 0.6) sfx.moo(); else sfx.cluck();
          if (!m.freeplay) {
            const mate = m.cars.find(o => o.bot && o.team === e.team && o.id !== e.id); if (mate && Math.random() < 0.7) setTimeout(() => botSay(mate, ['Gz!', 'Gz on the pass!', 'Woah!'][Math.random() * 3 | 0]), 700);
            const foe = m.cars.find(o => o.bot && o.team !== e.team); if (foe && Math.random() < 0.4) setTimeout(() => botSay(foe, ['Noooo!', 'Sry, lag...', 'Close one!'][Math.random() * 3 | 0]), 1300);
            if (rec.length > 40) replay = { at: m.t, from: Math.max(rec[0].t, m.t - 5.2), to: m.t + 0.3, t: 0, wait: 3, end: Math.sign(e.p[2]) };
          }
          break;
        }
        case 'zero': hud.big('0:00', 'the ball has to touch the ground!', '#f44', 2.2); break;
        case 'ot': hud.big('OVERTIME', 'next goal wins', '#ff981f', 3); sfx.fanfare(true); break;
        case 'end': setTimeout(() => showEnd(e.win), 1500); hud.big(`${TEAM[e.win].name} WINS!`, '', TEAM[e.win].css, 3); break;
        case 'respawn': break;
      }
    }
    m.events.length = 0;
  }

  // ---------------- replays: the last few seconds, kept at 30 frames a second
  let recT = 0;
  function record(dt) {
    recT += dt; if (recT < 1 / 30) return; recT = 0;
    rec.push({ t: m.t, b: [...m.ball.p, ballQ.x, ballQ.y, ballQ.z, ballQ.w], c: m.cars.map(c => ({ p: c.p.slice(), q: c.q.slice(), boosting: c.boosting, demo: c.demoT > 0, sonic: c.sonic, steer: c.ground ? c.in.steer : 0, fwd: c.ground ? c.v[0] * basis(c.q).f[0] + c.v[1] * basis(c.q).f[1] + c.v[2] * basis(c.q).f[2] : 0 })) });
    while (rec.length && rec[0].t < m.t - 12) rec.shift();
  }
  const frameAt = t => { let i = rec.findIndex(f => f.t >= t); if (i < 0) i = rec.length - 1; return rec[Math.max(0, i)]; };

  // ---------------- the camera: RL's (110 wide, 270 back, 100 up, -3 degrees), ball cam or car cam
  const v3 = (a, b, c) => [a, b, c];
  function camLook(pos, at) {
    const p = toWorld(pos), a = toWorld(at);
    camera.position.copy(p); camera.lookAt(a);
  }
  function fovFor(h = 110) { const a = camera.aspect; camera.fov = Math.min(100, 2 * Math.atan(Math.tan(h * Math.PI / 360) / Math.max(a, 1)) * 180 / Math.PI * (a < 1 ? 1.25 : 1)); camera.updateProjectionMatrix(); }
  function chase(dt) {
    const c = me, b = basis(c.q), bp = net ? net.drawn('ball', m.ball.p) : m.ball.p, cp = net ? net.drawn(me.id, me.p) : me.p;
    let dir;
    if (ballcam && m.state !== 'goal' || (m.state === 'count')) { dir = [bp[0] - cp[0], 0, bp[2] - cp[2]]; if (m.state === 'count' && !ballcam) dir = [b.f[0], 0, b.f[2]]; }
    else { dir = [b.f[0], 0, b.f[2]]; if (Math.hypot(dir[0], dir[2]) < 0.3) { const hv = Math.hypot(c.v[0], c.v[2]); dir = hv > 200 ? [c.v[0], 0, c.v[2]] : [Math.sin(cam.yaw), 0, Math.cos(cam.yaw)]; } }
    let yaw = Math.atan2(dir[0], dir[2]);
    if (!cam.init) { cam.yaw = yaw; cam.init = true; cam.pp = null; }
    let dy = yaw - cam.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    cam.yaw += dy * Math.min(1, dt * (ballcam ? 9 : 6));
    const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw), dist = 270, hgt = 100;
    let pos = [cp[0] - fx * dist, cp[1] + hgt, cp[2] - fz * dist];
    // keep it inside the arena (RL's camera doesn't go through the walls)
    const d = D(pos[0], pos[1], pos[2]); if (d < 40) { const n = N(pos[0], pos[1], pos[2]); for (let i = 0; i < 3; i++) pos[i] += n[i] * (40 - d); }
    if (cam.pp) for (let i = 0; i < 3; i++) cam.pp[i] += (pos[i] - cam.pp[i]) * Math.min(1, dt * 14); else cam.pp = pos.slice();
    pos = cam.pp;
    let look;
    if (ballcam && m.state === 'play') {
      // aim between straight ahead and the ball: the car stays low on screen, the ball's always in view
      const hd = Math.hypot(bp[0] - pos[0], bp[2] - pos[2]), pitch = Math.max(-0.35, Math.min(0.85, Math.atan2(bp[1] - pos[1], hd))) * 0.7 - 0.05;
      look = [pos[0] + fx * 500, pos[1] + Math.tan(pitch) * 500, pos[2] + fz * 500];
    } else look = [pos[0] + fx * 500, pos[1] - 26, pos[2] + fz * 500];
    camLook(pos, look);
  }
  function replayCam(f, dt) {
    // from the pitch side of the ball, off to one side and up, swinging slowly round as it goes in
    const b = f.b, e = replay.end, ang = 0.5 + replay.t * 0.12, r = 1500;
    const p = [b[0] * 0.6 + Math.sin(ang) * r, Math.max(300, b[1] + 420), b[2] - e * Math.cos(ang) * r];
    const d = D(p[0], p[1], p[2]); if (d < 80) { const n = N(p[0], p[1], p[2]); for (let i = 0; i < 3; i++) p[i] += n[i] * (80 - d); }
    if (!replay.pp) replay.pp = p.slice(); for (let i = 0; i < 3; i++) replay.pp[i] += (p[i] - replay.pp[i]) * Math.min(1, dt * 4);
    camLook(replay.pp, [b[0], b[1], b[2]]); fovFor(90);
  }
  function orbit(t) {
    const a = t * 0.3, r = 340; camLook([Math.sin(a) * r, 140, Math.cos(a) * r], [0, 40, 0]); fovFor(70);
  }

  // ---------------- the loop
  let last = performance.now(), tt = 0, lastBeep = 9, qcT = 0;
  const tmpV = new THREE.Vector3();
  status(''); $('loading').style.display = 'none';
  menu();
  function frame(now) {
    requestAnimationFrame(frame);
    const rawDt = Math.min(0.25, (now - last) / 1000), dt = Math.min(0.05, rawDt); last = now; tt += dt;
    { const pr = scaler.tick(rawDt * 1000, rawDt); if (pr) { renderer.setPixelRatio(pr); resize(); } }
    for (const md of crowd) { md.update(dt); if (md.hop > 0) { md.hop -= dt; md.ph += dt * 9; md.group.position.y = md.y0 + Math.abs(Math.sin(md.ph)) * 0.35 * Math.min(1, md.hop); } }
    pads.update(m || { pads: [] }, tt, dt);
    if (input.take('pause') && mode === 'game' && !endShown) setPaused(!paused);
    if (mode === 'game' && net && !m) { orbit(tt); fx.update(dt, camera); hud.draw(dt, { score: [0, 0] }, null, { hidden: true }); hud.T(netMsg || 'connecting...', hud.c.width / 2, hud.c.height * 0.45, '#ff0', 'c', hud.k * 2); sky.position.copy(camera.position); draw(); return; }
    if (mode === 'game' && m) {
      const inp = input.read(dt, TOUCH, me.ground);
      if (input.take('ballcam')) { ballcam = !ballcam; setup.ballcam = ballcam; save(SETUP_KEY, setup); }
      // quick chat: a number opens a category, a second picks the line
      const qn = input.take('chat');
      if (qn) { if (!hud.qc) { hud.qc = qn; qcT = 2.5; } else { if (net) net.chat(hud.qc, qn); else { hud.say(me.name, QUICK[hud.qc - 1][1][qn - 1], TEAM[me.team].css); sfx.chat(); } hud.qc = 0; } }
      if (hud.qc && (qcT -= dt) <= 0) hud.qc = 0;
      const inReplay = replay && replay.wait <= 0;
      if (!paused) {
        if (net) {
          const mine = inReplay || endShown ? { ...inp, throttle: 0, jump: false, boost: false } : window.LEAGUE.auto ? botInput(m, me, dt) : inp;
          net.update(rawDt, mine);   // (real time: the server's clock doesn't slow down for a slow frame) m.events.push(...netEv); netEv = [];
        } else {
          if (!inReplay) me.in = window.LEAGUE.auto ? botInput(m, me, dt) : inp;
          for (const c of m.cars) if (c.bot) c.in = botInput(m, c, dt);
          m.step(dt, null);
        }
        events();
        if (m.state === 'count') { const n = Math.ceil(m.stateT); if (n < lastBeep && n <= 3 && n >= 1) { sfx.beep(false); lastBeep = n; } } else lastBeep = 9;
        if (m.state !== 'goal' && !replay) record(dt);
        if (replay && net && m.state === 'count') replay = null;      // (online the kickoff won't wait for it)
        if (replay) { if (replay.wait > 0) replay.wait -= dt; else { replay.t += dt; if (replay.t > replay.to - replay.from || (inp.jump && !replay.jumpHeld && replay.t > 0.4)) { replay = null; m.stateT = Math.min(m.stateT, 0.01); } else replay.jumpHeld = inp.jump; } }
      }
      const pdt = paused ? 0 : dt;
      // the ball's spin (for show)
      const w = m.ball.w, wl = Math.hypot(...w); if (wl > 1e-4) ballQ.premultiply(new THREE.Quaternion().setFromAxisAngle(tmpV.set(w[0] / wl, w[1] / wl, w[2] / wl), wl * pdt));
      if (replay && replay.wait <= 0) {
        const f = frameAt(replay.from + replay.t);
        if (f) {
          ballM.visible = true; ballM.position.set(f.b[0], f.b[1], f.b[2]); ballM.quaternion.set(f.b[3], f.b[4], f.b[5], f.b[6]);
          ballSh.position.set(f.b[0], 3, f.b[2]); ballSh.visible = f.b[1] < 1500;
          vis.forEach((v, i) => v.update(pdt, f.c[i], paused ? null : fx, toWorld));
          replayCam(f, pdt);
        }
      } else {
        ballM.visible = m.state !== 'goal'; ballSh.visible = ballM.visible && m.ball.p[1] < 1500;
        const bp = net ? net.drawn('ball', m.ball.p) : m.ball.p;
        ballM.position.set(...bp); ballM.quaternion.copy(ballQ); ballSh.position.set(bp[0], 3, bp[2]); ballSh.material.opacity = 0.4 / (1 + Math.max(0, m.ball.p[1] - C.ballR) / 500);
        // a hard-hit ball trails light in the colour of whoever hit it last (RL's ball trail), thicker the faster it goes
        { const bs = Math.hypot(...m.ball.v); if (ballM.visible && bs > 1700 && !paused) { const last = m.touches[m.touches.length - 1], k = Math.min(1, (bs - 1700) / 1800), wp = toWorld(bp, _bt), tc = TEAM[last ? last.team : 0].col;
          const col = [(tc >> 16 & 255) / 255, (tc >> 8 & 255) / 255, (tc & 255) / 255]; for (let i = 0; i < 2; i++) fx.add.emit(wp.x + (Math.random() - 0.5) * 0.25 * SCALE, wp.y + (Math.random() - 0.5) * 0.25 * SCALE, wp.z + (Math.random() - 0.5) * 0.25 * SCALE, 0, 0, 0, (0.18 + 0.3 * k) * SCALE, 0.3 + 0.25 * k, { c0: [1, 1, 1], c1: col, grow: 0.2, a: 0.35 + 0.45 * k }); } }
        for (const v of vis) { const c = v.c, b = basis(c.q); v.update(pdt, { p: net ? net.drawn(c.id, c.p) : c.p, q: c.q, boosting: c.boosting, demo: c.demoT > 0, sonic: c.sonic, steer: c.ground ? c.in.steer : 0, fwd: c.v[0] * b.f[0] + c.v[1] * b.f[1] + c.v[2] * b.f[2] }, paused ? null : fx, toWorld); }
        fovFor(110); chase(Math.max(pdt, 1e-3));
      }
      booms.update(pdt); fx.update(pdt, camera);
      sfx.engine(me.speed, me.boosting, !paused && !endShown && !(replay && replay.wait <= 0), me.sonic);
      // names over the cars
      const names = [];
      if (!(replay && replay.wait <= 0)) for (const c of m.cars) { if (c.demoT > 0) continue; const p = net ? net.drawn(c.id, c.p) : c.p; toWorld([p[0], p[1] + 130, p[2]], tmpV); tmpV.project(camera); if (tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1) names.push({ x: (tmpV.x + 1) / 2 * hud.c.width, y: (1 - tmpV.y) / 2 * hud.c.height, name: c.name, team: c.team, boost: c.boost, me: c === me, mate: c.team === me.team }); }
      hud.draw(dt, m, me, { touch: TOUCH, ballcam, board: inp.board || m.state === 'end' && !endShown, names, replay: replay && replay.wait <= 0, freeplay: m.freeplay, hidden: endShown });
    } else {
      if (preview) { preview.s.q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tt * 0.5).toArray(); preview.update(dt, preview.s, null, toWorld); }
      ballM.position.set(0, C.ballR + Math.sin(tt * 1.5) * 20 + 180, 260); ballM.rotation.y = tt * 0.6; ballM.visible = true; ballSh.position.set(0, 3, 260);
      orbit(tt); fx.update(dt, camera);
      hud.draw(dt, { score: [0, 0] }, null, { hidden: true });
    }
    { const fast = mode === 'game' && me && !me.demoT && !(replay && replay.wait <= 0) ? (me.sonic ? 0.55 : me.boosting ? 0.22 : 0) : 0; post.speed += (fast - post.speed) * Math.min(1, dt * 5); if (post.speed < 0.01) post.speed = 0; }   // (the speed smear)
    sky.position.copy(camera.position); sky.material.uniforms.time.value = tt;
    stadium.floorU.camL.value.copy(camera.position); arena.worldToLocal(stadium.floorU.camL.value);
    draw();
  }
  requestAnimationFrame(frame);
  window.LEAGUE = { auto: false, botInput, renderer, post, setGfx: q => { setup.gfx = q; applyGfx(q); }, get m() { return m; }, get me() { return me; }, start, menu, scene, camera, arena, get replay() { return replay; } };
}

main().catch(e => { console.error(e); status('failed to load: ' + e.message); });
