// CartScape: Mario Kart round Lumbridge. Eight karts (three bodies, seven god trims, real RS drivers sat in them) race
// three laps of a road laid through the 2004 world: over the bridge, through the desert edge, a jump over the River
// Lum, cows and chickens wandering over, blades swinging, boulders rolling across. Drift for mini-turbos, hit ? boxes
// for RS items (energy potions, wind strikes, fire bolts, bananas, an overload, ice barrage, dragonfire). The race is
// src/cart/race.js (pure, tested headless by test/cart.js); the road and props src/cart/scenery.js; the karts models.js.
import * as THREE from 'three';
import { Track, TRACKS, angd } from './track.js';
import { Race, CC, ITEMS, NAMES, DIFF } from './race.js';
import { buildKart, buildDriver, THEMES, BODIES } from './models.js';
import { loadPack, buildCourse } from './scenery.js';
import { CartHud, clock } from './hud.js';
import { CartInput, TOUCH } from './input.js';
import { Puffs, puffTex, glowTex } from '../cod/wrathfx.js';
import { Sfx } from '../cod/sfx.js';
import { RSFont } from '../hud.js';

THREE.ColorManagement.enabled = false;                    // hex colours as written, like the RS world's baked ones
const $ = id => document.getElementById(id);
const status = t => { const e = $('status'); if (e) e.textContent = t; };
const SETUP_KEY = 'cartscape.setup', BEST_KEY = 'cartscape.best';
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const FOG = 0xc4d4e6;
const TIER_COL = [[0.45, 0.75, 1], [1, 0.6, 0.15], [0.85, 0.4, 1]];   // mini-turbo sparks: blue, orange, purple
const outfitOf = th => ({ 0: THEMES[th].outfit[0], 4: THEMES[th].outfit[1], 7: THEMES[th].outfit[2] });

// ---------------------------------------------------------------- sounds (Web Audio, made on the spot)
class CartSfx extends Sfx {
  engineOn() {
    if (!this.ok || this.eng) return;
    const c = this.ctx, o1 = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o1.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 500; g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g).connect(this.out); o1.start(); o2.start();
    const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true; const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 2600; nf.Q.value = 3;
    const ng = c.createGain(); ng.gain.value = 0; n.connect(nf).connect(ng).connect(this.out); n.start();
    this.eng = { o1, o2, f, g, ng, nf };
  }
  engine(v, boost, on, drift, grass) {
    if (!this.eng) return;
    const t = this.ctx.currentTime, f = 48 + Math.abs(v) * 5.2 + (boost ? 30 : 0);
    this.eng.o1.frequency.setTargetAtTime(f, t, 0.05); this.eng.o2.frequency.setTargetAtTime(f * 0.502, t, 0.05);
    this.eng.f.frequency.setTargetAtTime(380 + Math.abs(v) * 38 + (boost ? 900 : 0), t, 0.08);
    this.eng.g.gain.setTargetAtTime(on ? 0.06 + Math.min(0.05, Math.abs(v) * 0.002) : 0, t, 0.12);
    this.eng.ng.gain.setTargetAtTime(on && (drift || grass) ? (drift ? 0.05 : 0.03) : 0, t, 0.05);
    this.eng.nf.frequency.setTargetAtTime(grass && !drift ? 700 : 2400 + Math.abs(v) * 20, t, 0.05);
  }
  beep(go) { this.tone(go ? 880 : 440, go ? 880 : 440, go ? 0.5 : 0.22, 0.2, 'square'); }
  whoosh(v = 0.35) { this.burst(1600, 0.5, v, 'highpass', 0.6, 0, 0.2); this.tone(200, 600, 0.35, v * 0.4, 'sawtooth'); }
  pop() { this.tone(500, 1400, 0.1, 0.18, 'square'); }
  ding() { [988, 1319].forEach((f, i) => this.tone(f, f, 0.12, 0.15, 'square', 0, i * 0.07)); }
  crash(v = 1) { this.burst(700, 0.35, 0.6 * v, 'lowpass', 0.8, 0, 0.3); this.tone(180, 60, 0.3, 0.4 * v, 'triangle'); }
  thud(v = 0.5) { this.burst(300, 0.14, v, 'lowpass', 1); }
  splash() { this.burst(900, 0.7, 0.5, 'lowpass', 0.6, 0, 0.4); this.burst(3000, 0.4, 0.2, 'highpass', 0.5, 0, 0.3, 0.05); }
  cluck() { this.tone(700, 1100, 0.07, 0.12, 'square'); this.tone(900, 1300, 0.09, 0.12, 'square', 0, 0.09); }
  moo() { this.tone(170, 130, 0.7, 0.2, 'sawtooth'); }
  use(it) {
    if (it === 'wind') { this.burst(2400, 0.5, 0.35, 'bandpass', 1.5, 0, 0.3); }
    else if (it === 'fire') { this.burst(500, 0.6, 0.45, 'lowpass', 0.7, 0, 0.3); this.tone(300, 120, 0.4, 0.2, 'sawtooth'); }
    else if (it === 'banana') this.tone(300, 160, 0.12, 0.2, 'triangle');
    else if (it === 'energy' || it === 'energy3') { this.tone(220, 330, 0.12, 0.2, 'sine'); this.whoosh(0.3); }
    else if (it === 'overload') this.jingle();
    else if (it === 'barrage') { this.tone(1800, 2600, 0.6, 0.12, 'sine'); this.burst(5000, 0.6, 0.25, 'highpass', 0.5, 0, 0.5); }
    else if (it === 'dragon') { this.burst(250, 1.2, 0.6, 'lowpass', 0.6, 0, 0.5); this.tone(140, 50, 1.0, 0.4, 'sawtooth'); }
  }
  finish(place) { (place <= 3 ? [523, 659, 784, 1047, 1319] : [392, 349, 330, 294]).forEach((f, i) => this.tone(f, f, 0.2, 0.17, 'square', 0, i * 0.12)); }
}

// ---------------------------------------------------------------- particles: sparks and flames (additive), dust and smoke
class Fx {
  constructor(scene, lite) {
    this.add = new Puffs(scene, lite ? 350 : 900, true, glowTex());
    this.smoke = new Puffs(scene, lite ? 220 : 600, false, puffTex());
    this.v = new THREE.Vector3();
  }
  spark(p, col, n = 2, spread = 3) { for (let i = 0; i < n; i++) this.add.emit(p.x, p.y, p.z, (Math.random() - 0.5) * spread, 1 + Math.random() * 2.5, (Math.random() - 0.5) * spread, 0.22 + Math.random() * 0.15, 0.25 + Math.random() * 0.2, { g: 9, c0: [1, 1, 1], c1: col, grow: 0.4, drag: 2 }); }
  flame(p, dir, big) { this.add.emit(p.x, p.y, p.z, dir.x * 4 + (Math.random() - 0.5), dir.y * 4 + 0.6, dir.z * 4 + (Math.random() - 0.5), big ? 0.75 : 0.5, 0.18, { c0: [1, 0.95, 0.7], c1: [1, 0.35, 0.05], grow: 0.4, drag: 3 }); }
  dust(p, col = [0.55, 0.48, 0.36], a = 0.45) { this.smoke.emit(p.x + (Math.random() - 0.5) * 0.6, p.y + 0.2, p.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 1.5, 0.8 + Math.random(), (Math.random() - 0.5) * 1.5, 0.7, 0.7 + Math.random() * 0.4, { c0: col, a, grow: 2.6, drag: 1.5, g: -0.4 }); }
  boom(x, y, z, big) {
    const n = big ? 40 : 18, k = big ? 2 : 1;
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, u = Math.random(); this.add.emit(x, y + 0.6, z, Math.cos(a) * (3 + u * 9) * k, (2 + Math.random() * 7) * k, Math.sin(a) * (3 + u * 9) * k, (0.8 + Math.random()) * k, 0.4 + Math.random() * 0.4, { c0: [1, 0.95, 0.75], c1: [1, 0.3, 0.05], grow: 1.8, drag: 3, g: -2 }); }
    for (let i = 0; i < n / 2; i++) this.smoke.emit(x + (Math.random() - 0.5) * 2 * k, y + 0.8, z + (Math.random() - 0.5) * 2 * k, (Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3, 1.6 * k, 1.4 + Math.random(), { c0: [0.25, 0.22, 0.2], a: 0.75, grow: 2.4, drag: 1.2, g: -0.6 });
  }
  splash(x, y, z) {
    for (let i = 0; i < 40; i++) { const a = Math.random() * 6.283, r = Math.random() * 4; this.smoke.emit(x, y, z, Math.cos(a) * r, 5 + Math.random() * 7, Math.sin(a) * r, 0.7, 0.9 + Math.random() * 0.4, { c0: [0.85, 0.92, 1], a: 0.85, grow: 1.6, g: 14, drag: 0.6 }); }
  }
  /** a shot in flight: a wind strike's white swirl, a fire bolt's flame, the dragon's breath */
  shot(s, x, y, z) {
    if (s.k === 'wind') { const a = performance.now() / 60; this.smoke.emit(x + Math.cos(a) * 0.5, y + Math.sin(a) * 0.5, z, 0, 0.3, 0, 0.6, 0.35, { c0: [0.95, 0.97, 1], a: 0.7, grow: 2 }); }
    else if (s.k === 'fire') { this.add.emit(x, y, z, (Math.random() - 0.5), Math.random(), (Math.random() - 0.5), 1.1, 0.3, { c0: [1, 0.9, 0.5], c1: [1, 0.25, 0.02], grow: 0.3 }); this.smoke.emit(x, y, z, 0, 1, 0, 0.6, 0.6, { c0: [0.2, 0.18, 0.16], a: 0.4, grow: 2.5 }); }
    else if (s.k === 'dragon') { this.add.emit(x, y - 1, z, (Math.random() - 0.5) * 3, -2, (Math.random() - 0.5) * 3, 1.0, 0.4, { c0: [1, 0.8, 0.4], c1: [1, 0.2, 0], grow: 1.5 }); }
  }
  update(dt, cam) { this.add.update(dt, cam); this.smoke.update(dt, cam); }
}

// the Protect from Missiles overhead: a silver kite shield, a green arrow down it
function prayerTex() {
  const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), x = c.getContext('2d');
  x.lineJoin = 'round'; x.lineWidth = 3; x.strokeStyle = '#111';
  x.fillStyle = '#c8ccd4'; x.beginPath(); x.moveTo(32, 4); x.lineTo(58, 14); x.lineTo(52, 40); x.lineTo(32, 60); x.lineTo(12, 40); x.lineTo(6, 14); x.closePath(); x.fill(); x.stroke();
  x.fillStyle = '#e8ecf0'; x.beginPath(); x.moveTo(32, 9); x.lineTo(52, 17); x.lineTo(32, 22); x.lineTo(12, 17); x.closePath(); x.fill();
  x.strokeStyle = '#2a8a2a'; x.lineWidth = 5; x.beginPath(); x.moveTo(32, 16); x.lineTo(32, 48); x.stroke();
  x.fillStyle = '#2a8a2a'; x.beginPath(); x.moveTo(22, 40); x.lineTo(32, 54); x.lineTo(42, 40); x.closePath(); x.fill();
  x.strokeStyle = '#6a4a28'; x.lineWidth = 3; for (const s of [-1, 1]) { x.beginPath(); x.moveTo(32, 18); x.lineTo(32 + s * 7, 12); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------- a kart on screen
class KartVis {
  constructor(scene, k) {
    this.k = k; this.kart = buildKart(k.body, k.theme); this.g = this.kart.group; this.g.rotation.order = 'YZX';
    for (const w of this.kart.wheels) w.g.rotation.order = 'YZX';
    scene.add(this.g);
    buildDriver(outfitOf(k.theme), this.kart).then(d => { if (this.g.parent) { this.kart.body.add(d.group); this.driver = d; } }).catch(e => console.warn('driver', e));
    // Protect from Missiles: the prayer's glow round the kart and its icon over the driver's head, as in RS
    const aura = new THREE.Mesh(new THREE.SphereGeometry(1.9, 16, 10), new THREE.MeshBasicMaterial({ color: 0x7ad8ff, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }));
    aura.position.y = 0.8; aura.scale.set(1.1, 0.75, 0.85); aura.visible = false; this.kart.body.add(aura); this.aura = aura;
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: prayerTex(), depthWrite: false })); icon.scale.setScalar(0.75); icon.position.y = 2.45; icon.visible = false; this.kart.body.add(icon); this.icon = icon;
    this.st = 0;
    this.mat = this.kart.body.children.find(m => m.isMesh && m.material.vertexColors)?.material;
    const sh = new THREE.Mesh(new THREE.CircleGeometry(1.35, 16), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    sh.rotation.x = -Math.PI / 2; sh.scale.set(1.15, 0.75, 1); scene.add(sh); this.shadow = sh;
    const ice = new THREE.Mesh(new THREE.BoxGeometry(3, 2.3, 2.1), new THREE.MeshLambertMaterial({ color: 0xa8e8ff, transparent: true, opacity: 0.55, emissive: 0x204858 })); ice.position.y = 0.9; ice.visible = false; this.kart.body.add(ice); this.ice = ice;
    this.pitch = 0; this.lean = 0; this.prevA = k.a; this.vis = 0; this.spin = 0; this.ex = new THREE.Vector3(); this.wpos = new THREE.Vector3();
  }
  dispose() { this.g.removeFromParent(); this.shadow.removeFromParent(); }
  update(dt, T, fx, t) {
    const k = this.k, g = this.g, v = Math.hypot(k.vx, k.vz), fwd = k.vx * Math.cos(k.a) + k.vz * Math.sin(k.a);
    const dA = angd(this.prevA, k.a); this.prevA = k.a;
    const want = k.inSteer ?? Math.max(-1, Math.min(1, dA / Math.max(1e-3, dt) / 2.2));   // (yours from the stick; a CPU's read off how it's turning)
    this.st += (want - this.st) * Math.min(1, dt * 12); const steer = this.st;
    // tip with the road (front and back on the slope), lean into the turn, nose up off a lip, swing out in a drift
    const at = T.at(k.s), along = Math.cos(k.a) * at.tx + Math.sin(k.a) * at.tz, slope = (T.h(k.s + 1.2) - T.h(k.s - 1.2)) / 2.4;
    const pitchT = k.air ? Math.max(-0.5, Math.min(0.45, Math.atan2(k.vy, Math.max(8, v)) * 0.8)) : Math.atan(slope * along);
    this.pitch += (pitchT - this.pitch) * Math.min(1, dt * (k.air ? 4 : 14));
    this.lean += ((k.drift ? -k.drift * 0.16 : -steer * 0.07 * Math.min(1, v / 15)) - this.lean) * Math.min(1, dt * 8);
    this.vis += ((k.drift ? k.drift * 0.38 : 0) - this.vis) * Math.min(1, dt * 7);
    this.spin = k.spinT > 0 ? k.roll : this.spin * Math.exp(-dt * 10);
    const trick = k.trickT > 0 ? (0.5 - k.trickT) / 0.5 * Math.PI * 2 : 0;          // a trick off a lip: one barrel roll
    g.position.set(k.x, k.y + (k.yHop || 0), -k.z);
    g.rotation.set(this.lean + trick, k.a + this.vis + this.spin, this.pitch);
    g.scale.setScalar(k.smallT > 0 ? 0.62 : 1);
    g.visible = !(k.swimT > 0) || k.swimT > 1.0;                    // (sinks, then gone till the Guide fishes you out)
    for (const w of this.kart.wheels) { w.g.rotation.z -= fwd * dt / w.r; if (w.front) w.g.rotation.y = steer * 0.45; }
    this.kart.steer.rotation.x = -steer * 1.2; this.driver?.steer(steer);   // (the hands go round with the wheel)
    this.aura.visible = this.icon.visible = k.protT > 0; if (k.protT > 0) this.aura.material.opacity = 0.14 + Math.sin(t * 6) * 0.05;
    this.ice.visible = k.frozenT > 0;
    if (this.mat) {
      if (k.starT > 0) { this.mat.emissive.setHSL((t * 2.2) % 1, 1, 0.35); } else if (k.invT > 0 && k.spinT <= 0) { this.mat.emissive.setRGB(0.25 * (Math.sin(t * 40) > 0), 0.25 * (Math.sin(t * 40) > 0), 0.25 * (Math.sin(t * 40) > 0)); } else this.mat.emissive.setHex(k.theme === 'zaros' ? 0x1a0628 : 0);
    }
    // the shadow on the road (none over the river gap)
    const gap = T.flag(k.s) & 2; this.shadow.visible = !gap && g.visible;
    if (!gap) { this.shadow.position.set(k.x, T.h(k.s) + 0.06, -k.z); this.shadow.rotation.z = k.a; const hgt = Math.max(0, k.y - T.h(k.s)); this.shadow.material.opacity = 0.32 / (1 + hgt * 0.3); }
    // particles: drift sparks by tier, boost flames, dust off the grass, the overload's glitter
    if (!fx || !g.visible) return;
    g.updateMatrixWorld();
    if (k.drift && !k.air) {
      const tier = k.charge >= 2.5 ? 2 : k.charge >= 1.6 ? 1 : k.charge >= 0.75 ? 0 : -1;
      for (const w of this.kart.wheels) if (!w.front) { this.wpos.set(w.x - 0.1, 0.05, w.z).applyMatrix4(g.matrixWorld); if (tier >= 0) fx.spark(this.wpos, TIER_COL[tier], tier + 1); else if (Math.random() < 0.5) fx.dust(this.wpos, [0.6, 0.6, 0.6], 0.3); }
    }
    if (k.boostT > 0 || k.starT > 0) for (const e of this.kart.exhaust) { this.ex.copy(e).applyMatrix4(this.kart.body.matrixWorld); fx.flame(this.ex, { x: -Math.cos(k.a), y: 0, z: Math.sin(k.a) }, k.boostT > 0.6); }
    if (k.grass && v > 5 && Math.random() < 0.6) fx.dust(g.position, [0.42, 0.5, 0.28], 0.4);
    if (k.smokeT > 0 && Math.random() < 0.5) fx.dust({ x: g.position.x, y: g.position.y + 1.2, z: g.position.z }, [0.16, 0.15, 0.17], 0.7);   // (in the smoke barrage's cloud)
    if (k.starT > 0 && Math.random() < 0.7) fx.spark({ x: g.position.x + (Math.random() - 0.5) * 2, y: g.position.y + Math.random() * 1.8, z: g.position.z + (Math.random() - 0.5) * 2 }, [Math.random(), Math.random(), 1], 1, 1);
  }
}

// ---------------------------------------------------------------- the game
async function main() {
  const def = TRACKS.lumbridge;
  status('loading the track...');
  const pTrack = fetch(`assets/${def.pack}.track.json`).then(r => r.json());
  const pPack = loadPack(def.pack, status);
  const pFonts = Promise.all([RSFont.load('b12'), RSFont.load('p12')]);

  const canvas = $('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !TOUCH && devicePixelRatio < 1.5, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, TOUCH ? 1.25 : 1.5));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.setClearColor(0, 0);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG, TOUCH ? 50 : 70, TOUCH ? 190 : 290);
  scene.add(new THREE.HemisphereLight(0xe4ecff, 0x5a5040, 1.15));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.4); sun.position.set(-40, 80, 30); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(68, 1, 0.2, 520);

  const T = new Track(await pTrack);
  const pack = await pPack; scene.add(pack.group);
  status('building the course...');
  const proto = new Race(T, { karts: [], laps: T.laps });
  const course = buildCourse(T, proto); scene.add(course.group);
  const [b12, p12] = await pFonts;
  const hud = new CartHud($('hud'), { b12, p12 }); hud.buildMini(T);
  const fx = new Fx(scene, TOUCH);
  const sfx = new CartSfx();
  const input = new CartInput(); input.bindTouch($('touch'));

  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); hud.resize(); };
  addEventListener('resize', resize); resize();

  // ---------------- the setup: name, body, god, class
  const setup = Object.assign({ name: '', body: 'kart', theme: 'sara', cc: 'rune', diff: 'normal' }, load(SETUP_KEY, {}));
  if (!setup.name) setup.name = 'Racer' + (100 + Math.floor(Math.random() * 900));
  let race = null, vis = [], me = null, mode = 'menu', paused = false, endShown = false, preview = null, previewKey = '';
  const camS = { p: new THREE.Vector3(), look: new THREE.Vector3(), a: 0, init: false };

  function showPreview() {
    const key = setup.body + setup.theme; if (key === previewKey) return; previewKey = key;
    preview?.dispose();
    const k = { id: 'p', body: setup.body, theme: setup.theme, x: 0, z: 0, y: 0, a: 0, vx: 0, vz: 0, s: 0, d: 0, roll: 0 };
    const p = T.pos(T.finish - 6, 0); Object.assign(k, { x: p.x, z: p.z, y: p.y, a: Math.atan2(p.tz, p.tx), s: T.finish - 6 });
    preview = new KartVis(scene, k);
  }
  function seg(label, opts, cur, pick) {
    return `<div class="row"><div class="lab">${label}</div><div class="seg">${opts.map(([k, n, sw]) => `<button data-v="${k}" class="${k === cur ? 'sel' : ''}">${sw ? `<i style="background:${sw}"></i>` : ''}${n}</button>`).join('')}</div></div>`;
  }
  function menu() {
    mode = 'menu'; document.body.classList.remove('playing'); $('touch').style.display = 'none'; $('endbox').style.display = 'none'; $('pause').style.display = 'none';
    clearRace(); showPreview();
    const best = load(BEST_KEY, {});
    const box = $('menubox');
    box.innerHTML = `<div class="title">CARTSCAPE</div><div class="sub">Kart racing round Lumbridge. 3 laps, 8 karts, the River Lum in the way.</div>
      <div class="row name"><div class="lab">NAME</div><input id="m-name" maxlength="12" value="${setup.name.replace(/"/g, '')}"></div>
      <div id="m-body">${seg('KART', Object.entries(BODIES).map(([k, n]) => [k, n]), setup.body)}</div>
      <div id="m-theme">${seg('GOD', Object.entries(THEMES).map(([k, t]) => [k, t.name, '#' + t.body.toString(16).padStart(6, '0')]), setup.theme)}</div>
      <div id="m-cc">${seg('CLASS', Object.entries(CC).map(([k, c]) => [k, c.name + (best[k] ? ' ' + clock(best[k]) : '')]), setup.cc)}</div>
      <div id="m-diff">${seg('CPU', Object.entries(DIFF).map(([k, d]) => [k, d.name]), setup.diff)}</div>
      <div class="col"><button id="m-go">RACE!</button><a class="small" href="index.html?pick">&laquo; OTHER GAMES</a></div>
      <div class="lab2">HIGHSCORES &middot; <span id="m-hscc"></span></div><div id="m-hs" class="hs">loading...</div>
      <div class="keys">${TOUCH ? 'The gas is on for you. <b>&#9664; &#9654;</b> steer, <b>DRIFT</b> hold through corners for a mini-turbo, <b>ITEM</b> fires, <b>BRAKE</b> to slow or reverse.'
        : '<b>W / &uarr;</b> gas &nbsp; <b>S / &darr;</b> brake &nbsp; <b>A D / &larr; &rarr;</b> steer &nbsp; <b>SPACE / SHIFT</b> hop + drift (hold it through the corner, let go for a turbo; tap it off a ramp for a trick) &nbsp; <b>E / CTRL</b> use item &nbsp; <b>C</b> look back &nbsp; <b>ESC</b> pause. Hold the gas just as the 2 goes out for a rocket start.'}</div>`;
    const wire = (id, key, after) => { for (const b of $(id).querySelectorAll('button')) b.onclick = () => { setup[key] = b.dataset.v; save(SETUP_KEY, setup); for (const o of $(id).querySelectorAll('button')) o.classList.toggle('sel', o === b); after?.(); }; };
    wire('m-body', 'body', showPreview); wire('m-theme', 'theme', showPreview); wire('m-cc', 'cc', drawBoard); wire('m-diff', 'diff');
    drawBoard(); fetchBoard().then(drawBoard);
    $('m-name').oninput = e => { setup.name = e.target.value.trim().slice(0, 12) || setup.name; save(SETUP_KEY, setup); };
    $('m-go').onclick = () => startRace();
    $('menu').style.display = '';
  }
  // ---------------- highscores: the server's boards (fastest three laps per class), your own best if it can't be reached
  let board = null;
  const fetchBoard = () => fetch('api/cart').then(r => r.ok ? r.json() : null).then(b => { if (b) board = b; }).catch(() => {});
  const boardRows = (rows, mark) => rows.length ? `<table class="res">${rows.map((r, i) => `<tr style="color:${mark && r.name.toLowerCase() === mark.toLowerCase() ? '#0f0' : '#ff0'}"><td>${i + 1}</td><td>${r.name}</td><td style="color:#ccc;font-size:12px">${(DIFF[r.diff] || DIFF.normal).name}</td><td>${clock(r.t)}</td></tr>`).join('')}</table>` : '<div class="sub">no times yet: set the first!</div>';
  function drawBoard() {
    const el = $('m-hs'); if (!el) return; $('m-hscc').textContent = CC[setup.cc].name + ' CLASS';
    if (board) el.innerHTML = boardRows(board[setup.cc] || [], setup.name);
    else { const b = load(BEST_KEY, {})[setup.cc]; el.innerHTML = b ? `<div class="sub">your best: ${clock(b)} (the online board isn't reachable)</div>` : '<div class="sub">offline: your best times are kept here</div>'; }
  }
  function clearRace() { for (const v of vis) v.dispose(); vis = []; race = null; me = null; }
  function startRace() {
    sfx.start(); sfx.engineOn();
    clearRace(); preview?.dispose(); preview = null; previewKey = '';
    const names = [...NAMES].sort(() => Math.random() - 0.5), themes = Object.keys(THEMES).filter(t => t !== setup.theme).sort(() => Math.random() - 0.5), bodies = Object.keys(BODIES);
    const karts = [];
    for (let i = 0; i < 8; i++) {
      if (i === 4) karts.push({ id: 'me', name: setup.name, theme: setup.theme, body: setup.body, human: true });
      else karts.push({ id: 'cpu' + i, name: names[i], theme: themes[karts.length % themes.length], body: bodies[(i * 7 + 1) % 3] });
    }
    race = new Race(T, { karts, laps: T.laps, cc: setup.cc, diff: setup.diff, seed: (Math.random() * 1e9) | 0 });
    posted = null;
    me = race.karts.find(k => k.human);
    vis = race.karts.map(k => new KartVis(scene, k));
    mode = 'race'; paused = false; endShown = false; camS.init = camS.init2 = false; hud.msgs = [];
    $('menu').style.display = 'none'; $('endbox').style.display = 'none'; $('pause').style.display = 'none';
    document.body.classList.add('playing'); $('touch').style.display = TOUCH ? '' : 'none';
    lastBeep = 9;
  }
  function setPaused(p) { if (mode !== 'race' || endShown) return; paused = p; $('pause').style.display = p ? 'flex' : 'none'; sfx.engine(0, false, false); }
  $('p-resume').onclick = () => setPaused(false);
  $('p-restart').onclick = () => startRace();
  $('p-quit').onclick = () => menu();
  $('e-again').onclick = () => startRace();
  $('e-menu').onclick = () => menu();
  $('pausebtn').onclick = () => setPaused(!paused);

  let rec = '', posted = null;
  function showResults() {
    if (!endShown) {
      endShown = true; rec = '';
      const best = load(BEST_KEY, {});
      if (me.finished && (!best[setup.cc] || me.finished < best[setup.cc])) { best[setup.cc] = me.finished; save(BEST_KEY, best); rec = ' <b style="color:#0f0">NEW BEST!</b>'; }
      // on the board: the three lap times go with it (the server checks they add up and are drivable)
      posted = { wait: true };
      fetch('api/cart', { method: 'POST', body: JSON.stringify({ name: setup.name, cc: setup.cc, diff: setup.diff, t: me.finished, laps: me.splits, kart: setup.body, theme: setup.theme }) })
        .then(r => r.json()).then(r => { posted = r; if (r.top) board = r.top; }).catch(() => { posted = { ok: false, why: 'offline' }; });
    }
    const rows = race.order.map((q, i) => `<tr style="color:${q === me ? '#0f0' : '#ff0'}"><td>${i + 1}</td><td><i style="background:#${THEMES[q.theme].acc.toString(16).padStart(6, '0')}"></i>${q.name}</td><td>${q.finished ? clock(q.finished) : '...'}</td></tr>`).join('');
    const lapsTxt = (me.splits || []).map((l, i) => `L${i + 1} ${clock(l)}`).join(' &middot; ');
    const hs = posted?.wait ? 'posting your time...' : posted?.ok ? (posted.kept ? `your best stays ${clock(posted.best)} (#${posted.rank})` : posted.rank && posted.rank <= 10 ? `<b style="color:#0f0">#${posted.rank} on the ${CC[setup.cc].name} board!</b>` : `#${posted.rank || '-'} on the ${CC[setup.cc].name} board`) : posted?.why === 'slow down' ? 'one post every few seconds: race again to post' : posted?.why === 'offline' ? 'the online board is out of reach (your best is kept here)' : posted ? `time not taken (${posted.why})` : '';
    $('endbox').querySelector('.stats').innerHTML = `<div class="sub">${CC[setup.cc].name} CLASS &middot; ${DIFF[setup.diff].name} CPU &middot; you came <b>${me.place}${['ST', 'ND', 'RD'][me.place - 1] || 'TH'}</b> in ${clock(me.finished)}${rec}</div>
      <div class="sub" style="color:#ccc">${lapsTxt}</div><table class="res">${rows}</table>
      <div class="lab2" style="margin-top:10px">HIGHSCORES &middot; ${hs}</div>${board ? boardRows(board[setup.cc] || [], setup.name) : ''}`;
    $('endbox').style.display = 'flex'; $('touch').style.display = 'none';
  }

  // ---------------- the race's events -> sound, shouts, effects
  const kartBy = id => race.karts.find(k => k.id === id);
  const near = k => k ? 1 / (1 + Math.hypot(k.x - me.x, k.z - me.z) * 0.08) : 0;
  const ITEM_SHOUT = { wind: 'WIND STRIKE!', fire: 'FIRE BOLT!', barrage: 'ICE BARRAGE!', dragon: 'DRAGONFIRE!', overload: 'OVERLOAD!', chin: 'CHINCHOMPA!', smoke: 'SMOKE BARRAGE!' };
  const USE_SAY = { energy: 'You drink the energy potion. You feel refreshed!', energy3: 'You drink a dose of super energy.', banana: 'You drop the banana.', wind: 'You cast Wind Strike!',
    fire: 'You cast Fire Bolt!', chin: 'You throw the chinchompa!', protect: 'You activate Protect from Missiles.', smoke: 'You cast Smoke Barrage!',
    overload: 'You drink the overload. You feel invincible!', barrage: 'You cast Ice Barrage!', dragon: 'You breathe dragonfire! It hunts down the leader...' };
  function events() {
    for (const e of race.events) {
      const k = kartBy(e.id), mine = e.id === 'me', v = mine ? 1 : near(k);
      switch (e.t) {
        case 'go': sfx.beep(true); break;
        case 'rocket': if (mine) { hud.message('ROCKET START!', '#0f0'); sfx.whoosh(0.45); } break;
        case 'stall': if (mine) { hud.message('TOO EARLY!', '#f44'); sfx.crash(0.4); } break;
        case 'hop': if (v > 0.3) sfx.click(900, 0.12 * v); break;
        case 'turbo': if (mine) { sfx.whoosh(0.2 + e.tier * 0.1); if (e.tier >= 2) hud.message(e.tier === 3 ? 'ULTRA MINI-TURBO!' : 'SUPER MINI-TURBO!', e.tier === 3 ? '#d6f' : '#ff981f', 1); } break;
        case 'trick': if (mine) sfx.pop(); break;
        case 'land': if (v > 0.2 && e.v > 4) sfx.land(Math.min(1, e.v / 12) * v); if (k && e.v > 6) for (let i = 0; i < 6; i++) fx.dust({ x: k.x, y: k.y, z: -k.z }); break;
        case 'launch': if (mine) { sfx.whoosh(0.4); hud.message('BIG AIR!', '#7ad8ff', 1); } break;
        case 'splash': if (k) fx.splash(k.x, k.y, -k.z); if (v > 0.2) sfx.splash(); if (mine) hud.message('SPLASH! The Lumbridge Guide fishes you out...', '#7ad8ff', 1.4); break;
        case 'respawn': break;
        case 'lap': if (mine) { if (e.lap === race.laps) { hud.message('FINAL LAP!', '#ff981f', 2.2, true); sfx.jingle(); } else { hud.message(`LAP ${e.lap}`, '#ff0', 1.4, true); sfx.ding(); } } break;
        case 'finish': if (mine) { hud.message('FINISH!', '#fff', 3, true); sfx.finish(e.place); finishedAt = performance.now(); } break;
        case 'pad': if (mine) sfx.whoosh(0.3); break;
        case 'box': { const p = T.pos(e.s, e.d); fx.spark({ x: p.x, y: T.h(e.s) + 1.1, z: -p.z }, [1, 0.8, 0.2], 10, 6); if (mine) sfx.pop(); break; }
        case 'got': if (mine) { sfx.ding(); hud.say(`You open the chest and find: ${ITEMS[e.item].name.toLowerCase().replace(/^./, c => c.toUpperCase())}!`, '#000080'); } break;
        case 'block': { if (k) fx.spark({ x: k.x, y: k.y + 1, z: -k.z }, [0.5, 0.85, 1], 16, 6); if (v > 0.2) sfx.tone(1400, 700, 0.25, 0.2 * v, 'triangle'); if (mine) { hud.message('PROTECTED!', '#7ad8ff', 1.2); hud.say('Your prayer protects you from the missile.', '#000080'); } break; }
        case 'smoked': if (mine) { hud.message('SMOKE BARRAGE!', '#b8a8c8', 1.4); hud.say("You can't see a thing!", '#800000'); sfx.burst(400, 1.2, 0.4, 'lowpass', 0.6, 0, 0.5); } break;
        case 'use': if (v > 0.25 || e.item === 'barrage' || e.item === 'dragon') sfx.use(e.item); if (!mine && ITEM_SHOUT[e.item] && (e.item === 'barrage' || e.item === 'dragon')) hud.message(`${k.name}: ${ITEM_SHOUT[e.item]}`, '#f88', 1.6); if (mine && ITEM_SHOUT[e.item]) hud.message(ITEM_SHOUT[e.item], '#ff0', 1); if (mine && USE_SAY[e.item]) hud.say(USE_SAY[e.item], '#000080'); break;
        case 'hit': if (v > 0.15) sfx.crash(v); if (e.why === 'cow' && v > 0.2) sfx.moo(); if (mine) hud.message({ chin: 'BLOWN UP!', banana: 'SLIPPED ON A BANANA!', cow: 'MOO!', boulder: 'FLATTENED!', blade: 'CHOPPED!', fire: 'BURNT!', wind: 'BLOWN AWAY!', dragon: 'TORCHED!', overload: 'RAMMED!' }[e.why] || 'OUCH!', '#f44', 1.2); break;
        case 'boom': { const p = T.pos(e.s, e.d); fx.boom(p.x, T.h(e.s), -p.z, e.big); const dd = Math.hypot(p.x - me.x, p.z - me.z); sfx.boom(dd * 0.6); break; }
        case 'bump': if (e.a === 'me' || e.b === 'me') sfx.thud(0.4); break;
        case 'wall': if (mine) sfx.thud(Math.min(0.6, e.v * 0.05)); break;
        case 'cluck': if (v > 0.3) sfx.cluck(); if (k) for (let i = 0; i < 8; i++) fx.smoke.emit(k.x, k.y + 1, -k.z, (Math.random() - 0.5) * 5, 2 + Math.random() * 3, (Math.random() - 0.5) * 5, 0.25, 0.9, { c0: [1, 1, 1], a: 0.9, grow: 1, g: 4, drag: 1 }); break;
        case 'smash': if (mine) sfx.thud(0.5); break;
      }
    }
    race.events.length = 0;
  }

  // ---------------- the camera: a chase cam that swings round into place over the countdown
  function chase(dt) {
    const k = me, back = input.lastBack, v = Math.hypot(k.vx, k.vz);
    const wantA = k.a + (k.drift ? k.drift * 0.22 : 0);
    if (!camS.init) { camS.a = wantA; camS.init = true; }
    camS.a += angd(camS.a, wantA) * Math.min(1, dt * (k.spinT > 0 ? 1.5 : 5));
    let a = camS.a + (back ? Math.PI : 0);
    let dist = 6.2 + Math.min(1.6, v * 0.04), hgt = 2.7 + Math.min(0.6, v * 0.015);
    if (race.state === 'count') { const u = Math.min(1, Math.max(0, (race.t + 3.6) / 3.2)), e = u * u * (3 - 2 * u); a = camS.a + Math.PI * (1 - e); dist = 13 - e * (13 - dist); hgt = 9 - e * (9 - hgt); }   // (a swoop from high out front round to behind)
    const kx = k.x, ky = k.y, kz = k.z, cx = kx - Math.cos(a) * dist, cz = kz - Math.sin(a) * dist;
    const at = T.locate(cx, cz, k.s), ground = Math.abs(at.d) < T.hw + 6 && !(T.flag(at.s) & 2) ? T.h(at.s) : ky - 3;
    // sat rigidly behind on the smoothed heading (no lag at speed: the kart stays put on screen); only the height eases
    const cy = Math.max(ky + hgt, ground + 1.2);
    if (back || race.state === 'count' || !camS.init2) { camS.y = cy; camS.init2 = true; } else camS.y += (cy - camS.y) * (1 - Math.exp(-dt * 7));
    camS.p.set(cx, camS.y, -cz); camS.look.set(kx + Math.cos(a) * 3.5, ky + 1.2, -(kz + Math.sin(a) * 3.5));
    camera.position.copy(camS.p); camera.lookAt(camS.look);
    const fovT = 66 + (k.boostT > 0 ? 9 : 0) + Math.min(6, v * 0.15);
    camera.fov += (fovT - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix();
  }
  function orbit(t) {
    const k = preview?.k; if (!k) return;
    const a = t * 0.25, p = new THREE.Vector3(k.x + Math.cos(a) * 6.5, k.y + 2.4, -(k.z + Math.sin(a) * 6.5));
    camera.position.copy(p); camera.lookAt(k.x, k.y + 0.7, -k.z); camera.fov = 50; camera.updateProjectionMatrix();
  }

  // ---------------- the loop
  let last = performance.now(), lastBeep = 9, finishedAt = 0, tt = 0;
  status('');
  $('loading').style.display = 'none';
  menu();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; tt += dt;
    if (input.takePause()) { if (mode === 'race' && !endShown) setPaused(!paused); }
    if (mode === 'race' && race) {
      const inp = input.read(dt, TOUCH); input.lastBack = inp.back; me.inSteer = me.spinT > 0 || me.frozenT > 0 ? 0 : inp.steer;
      if (!paused) {
        race.step(dt, new Map([['me', inp]]));
        events();
        if (race.state === 'count') { const n = Math.ceil(-race.t); if (n < lastBeep && n <= 3 && n >= 1) { sfx.beep(false); lastBeep = n; } }
      }
      const pdt = paused ? 0 : dt;
      for (const v of vis) v.update(pdt, T, paused ? null : fx, tt);
      course.update(race.t, pdt, race, paused ? null : fx);
      fx.update(pdt, camera);
      chase(Math.max(pdt, 1e-3));
      sfx.engine(Math.hypot(me.vx, me.vz), me.boostT > 0, !paused && !endShown, !!me.drift, me.grass);
      if (me.finished && !endShown && performance.now() - finishedAt > 3500) showResults();
      if (endShown && (tt * 2 | 0) !== ((tt - dt) * 2 | 0)) showResults();
      hud.draw(dt, race, me, { touch: TOUCH, hidden: endShown });
    } else {
      proto.t = tt - 3.6; course.update(tt, dt, proto, fx);       // (the menu: the course carries on behind it)
      preview?.update(0, T, null, tt);
      fx.update(dt, camera);
      orbit(tt);
      hud.draw(dt, proto, null, { hidden: true });
    }
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
  window.CART = { get race() { return race; }, get me() { return me; }, startRace, menu, scene, camera };
}

main().catch(e => { console.error(e); status('failed to load: ' + e.message); });
