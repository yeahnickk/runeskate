// CODScape: first-person Call of Duty in Castle Wars, against bots. The menus, the loop, the camera, aim assist,
// the effects. The match itself is src/cod/game.js; the arena src/cod/arena.js.
import * as THREE from 'three';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { loadArena, Arena } from './arena.js';
import { Game, MODES, STREAKS, wrathName, SUPPLY_R } from './game.js';
import { DIFFICULTY } from './bots.js';
import { WEAPONS, LETHALS, CLASSES, stats } from './weapons.js';
import { ViewModel } from './viewmodel.js';
import { gunEnvironment, withGunPass, buildGun } from './guns.js';
import { Avatar, preloadTeam } from './soldier.js';
import { CodHud } from './hud.js';
import { Sfx } from './sfx.js';
import { Input, TouchControls, TOUCH_CSS, loadSettings, saveSettings } from './input.js';
import { RSFont, loadHitsplat } from '../hud.js';
import { MOVE } from './body.js';
import { NetClient } from './netclient.js';

THREE.ColorManagement.enabled = false;                    // hex colours as written, like the RS world's baked ones
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const $ = id => document.getElementById(id);
const status = t => { const e = $('status'); if (e) e.textContent = t; };
const TOUCH = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);
const FOG = 0xb9cbe0;
const SETUP_KEY = 'codscape.setup';
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

async function main() {
  status('loading Castle Wars...');
  const settings = loadSettings();
  const pArena = loadArena(status);
  const pFonts = Promise.all([RSFont.load('b12'), RSFont.load('p12')]);
  const pSplat = loadHitsplat();
  const pKits = Promise.all([preloadTeam('sara'), preloadTeam('zam')]).catch(e => console.warn('outfits', e));

  // ---------------- renderer, scene
  const canvas = $('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !TOUCH && devicePixelRatio < 1.5, alpha: true, powerPreference: 'high-performance' });
  let dprBase = Math.min(devicePixelRatio, TOUCH ? 1.5 : 1.5), resScale = 1;
  renderer.setPixelRatio(dprBase);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG, 45, 150);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x4a4030, 1.1));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.3); sun.position.set(-30, 60, 40); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.15, 400);   // (near at 15 cm: you never get closer than the body radius, and the depth buffer gets 3x the precision)

  let gunEnv = gunEnvironment(renderer); scene.environment = gunEnv;   // (the world is unlit vertex colour: only the guns pick this up)
  const arena = await pArena;
  scene.add(arena.group);
  status('mapping the castle for the bots...');
  await new Promise(r => setTimeout(r, 10));
  arena.buildNav();
  const [b12, p12] = await pFonts;
  const hud = new CodHud($('hud'), { b12, p12 }, await pSplat);
  const sfx = new Sfx(); sfx.setVolume(settings.volume);
  const input = new Input(canvas, settings);
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: TOUCH_CSS }));
  if (TOUCH) { input.touch = new TouchControls(document.body, settings); input.device = 'touch'; }

  // ---------------- minimap: the arena from straight above, once
  {
    const [X0, Z0, X1, Z1] = Arena.BOUNDS, a = arena.at(X0, Z0), b = arena.at(X1, Z1), pad = 1;
    const x0 = Math.min(a.x, b.x) - pad, x1 = Math.max(a.x, b.x) + pad, z0 = Math.min(a.z, b.z) - pad, z1 = Math.max(a.z, b.z) + pad;
    const SZ = 256, rt = new THREE.WebGLRenderTarget(SZ, SZ), cam = new THREE.OrthographicCamera(x0, x1, -z0, -z1, 1, 500);
    cam.position.set(0, 300, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0);
    cam.left = x0; cam.right = x1; cam.top = -z0; cam.bottom = -z1; cam.updateProjectionMatrix();
    const fog = scene.fog; scene.fog = null; renderer.setRenderTarget(rt); renderer.setClearColor(0x203040, 1); renderer.clear(); renderer.render(scene, cam);
    const px = new Uint8Array(SZ * SZ * 4); renderer.readRenderTargetPixels(rt, 0, 0, SZ, SZ, px);
    renderer.setRenderTarget(null); renderer.setClearColor(0x000000, 0); scene.fog = fog; rt.dispose();
    const c = document.createElement('canvas'); c.width = c.height = SZ; const im = c.getContext('2d').createImageData(SZ, SZ);
    for (let y = 0; y < SZ; y++) im.data.set(px.subarray((SZ - 1 - y) * SZ * 4, (SZ - y) * SZ * 4), y * SZ * 4);
    c.getContext('2d').putImageData(im, 0, 0);
    hud.mini = { canvas: c, x0, x1, z0, z1 };
  }

  // ---------------- the Castle Wars standards on the towers
  const flagMeshes = {};
  for (const [k, T] of Object.entries(Arena.TEAMS)) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 2.6, 6), new THREE.MeshLambertMaterial({ color: 0x5a4020 })); pole.position.y = 1.3; g.add(pole);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), new THREE.MeshLambertMaterial({ color: 0xd4af37 })); top.position.y = 2.62; g.add(top);
    const cg = new THREE.PlaneGeometry(1.1, 0.75, 8, 4); cg.translate(0.55, 0, 0);
    const cloth = new THREE.Mesh(cg, new THREE.MeshLambertMaterial({ color: T.hex, side: THREE.DoubleSide })); cloth.position.y = 2.15; g.add(cloth);
    // the god's mark on it: a pale star (Saradomin) or a dark Z-ish slash (Zamorak), low poly
    const mark = new THREE.Mesh(new THREE.CircleGeometry(0.16, k === 'sara' ? 5 : 3), new THREE.MeshBasicMaterial({ color: k === 'sara' ? 0xf4f0d0 : 0x200808, side: THREE.DoubleSide }));
    mark.position.set(0.55, 0, 0.01); cloth.add(mark);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.25, 8), new THREE.MeshLambertMaterial({ color: 0x777066 })); base.position.y = 0.12;
    const stand = new THREE.Group(); stand.add(base);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 60, 8, 1, true), new THREE.MeshBasicMaterial({ color: T.hex, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    beam.position.y = 30; g.add(beam);
    scene.add(g); scene.add(stand);
    flagMeshes[k] = { g, cloth, cg, base: cg.attributes.position.array.slice(), stand, beam };
  }

  // ---------------- effects: tracers, puffs, sparks, blasts
  const tracerGeo = new THREE.BufferGeometry(); const TR = 64;
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TR * 6), 3));
  const tracers = new THREE.LineSegments(tracerGeo, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.85, fog: false }));
  tracers.frustumCulled = false; scene.add(tracers);
  const fx = [];
  const puffGeo = new THREE.SphereGeometry(1, 6, 4);
  const nades = new Map();                                        // live grenade -> its model in the world
  const puff = (p, col, size, life, vel = new THREE.Vector3(), add = false) => {
    const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending }));
    m.position.copy(p); m.scale.setScalar(size); scene.add(m); fx.push({ m, t: 0, life, vel, size });
    if (fx.length > 160) { const o = fx.shift(); scene.remove(o.m); o.m.material.dispose(); }
  };
  let shake = 0;
  // Ice Barrage, the way RS draws it: a blue orb drops on the spot, and whoever's there is locked in a block of ice
  const iceFx = [], ICE_RING = new THREE.RingGeometry(4.6, 5.5, 40), ICE_ORB = new THREE.IcosahedronGeometry(0.45, 0), ICE_SHARD = new THREE.OctahedronGeometry(1, 0), ICE_BOX = new THREE.BoxGeometry(1, 1, 1), ICE_EDGES = new THREE.EdgesGeometry(ICE_BOX), ICE_FROST = new THREE.CircleGeometry(5, 28);
  ICE_RING.rotateX(-Math.PI / 2); ICE_FROST.rotateX(-Math.PI / 2);
  const orbMat = new THREE.MeshBasicMaterial({ color: 0xd8f4ff, fog: false }), glowMat = new THREE.MeshBasicMaterial({ color: 0x6fc8ff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  function iceMark(p, land, col = 0x8fdcff, withOrb = true) {
    const ring = new THREE.Mesh(ICE_RING, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.position.set(p.x, p.y + 0.08, p.z);
    if (!withOrb) ring.scale.setScalar(0.85);
    const orb = new THREE.Mesh(ICE_ORB, orbMat), glow = new THREE.Mesh(ICE_ORB, glowMat); glow.scale.setScalar(2.4); orb.visible = glow.visible = withOrb;
    scene.add(ring, orb, glow); iceFx.push({ kind: 'mark', p: p.clone(), land, t: 0, ring, orb, glow });
  }
  // the King Black Dragon, low-poly like his RS model: black hide, three heads, red-black wings; flies the line, breathing fire
  let wrathFx = null;
  const dragons = [];
  const DRAGON_MAT = new THREE.MeshLambertMaterial({ color: 0x1c1a1e }), WING_MAT = new THREE.MeshLambertMaterial({ color: 0x3a1210, side: THREE.DoubleSide });
  function makeDragon() {
    const g = new THREE.Group(), box = (sx, sy, sz, x, y, z, m = DRAGON_MAT) => { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); b.position.set(x, y, z); g.add(b); return b; };
    box(1.8, 1.6, 4.2, 0, 0, 0); box(1.1, 1.0, 2.4, 0, -0.1, 2.9).rotation.x = 0.25;                       // body, haunch
    for (let i = 0; i < 4; i++) box(0.5, 0.45, 1.0, 0, 0.1 - i * 0.12, 4.4 + i * 0.9).rotation.x = 0.1 * i;   // tail
    for (const s of [-1, 0, 1]) {                                                                              // three heads on three necks
      const n = box(0.45, 0.45, 1.8, s * 0.55, 0.5, -2.7); n.rotation.set(-0.35, s * 0.3, 0);
      box(0.6, 0.5, 0.9, s * 0.85, 0.9, -3.7).rotation.y = s * 0.3;
      box(0.12, 0.3, 0.12, s * 0.85 - 0.18, 1.25, -3.5); box(0.12, 0.3, 0.12, s * 0.85 + 0.18, 1.25, -3.5);  // horns
    }
    const wing = side => { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -1.2, 0, 0, 1.4, side * 6.5, 0, 2.2, 0, 0, -1.2, side * 6.5, 0, 2.2, side * 4.2, 0, -1.4], 3)); geo.computeVertexNormals();
      const w = new THREE.Mesh(geo, WING_MAT), pivot = new THREE.Group(); pivot.position.set(side * 0.8, 0.5, -0.4); pivot.add(w); g.add(pivot); return pivot; };
    g.userData.wings = [wing(-1), wing(1)];
    g.scale.setScalar(1.3);
    return g;
  }
  function flyDragon(a, b, lead, dur) {
    const g = makeDragon(); g.visible = false; scene.add(g);
    dragons.push({ g, a: a.clone(), b: b.clone(), lead, dur, t: 0, breath: 0 });
    sfx.burst?.(220, 1.2, 0.5);
  }
  // God's Wrath set pieces: pillars of the god's light (Saradomin) or fire (Zamorak) hammering down with a blast each,
  // and a shockwave ring tearing out across the arena when it lands. Only looks: the server/match does the killing
  const BEAM = new THREE.CylinderGeometry(0.9, 1.6, 70, 10, 1, true), SHOCK = new THREE.RingGeometry(0.85, 1, 64); SHOCK.rotateX(-Math.PI / 2);
  const strikes = [], strikeQ = [];
  const godCol = team => team === 'zam' ? 0xff4a1a : team === 'sara' ? 0xfff0a0 : 0x80ff80;
  function godStrike(p, team, big = false) {
    const col = godCol(team), m = new THREE.Mesh(BEAM, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    m.position.set(p.x, p.y + 35, p.z); m.scale.setScalar(big ? 1.6 : 1); scene.add(m); strikes.push({ m, t: 0, life: big ? 0.9 : 0.5 });
    handle({ t: 'boom', p: p.clone().setY(p.y + 0.4), r: big ? 7 : 4.5, ice: false });
    puff(p.clone().setY(p.y + 1), col, big ? 3.5 : 2, 0.5, new THREE.Vector3(0, 2, 0), true);
  }
  function shockwave(p, team) {
    const m = new THREE.Mesh(SHOCK, new THREE.MeshBasicMaterial({ color: godCol(team), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.position.set(p.x, p.y + 0.6, p.z); scene.add(m); strikes.push({ m, t: 0, life: 2.6, wave: true });
  }
  const arenaSpot = () => { const [X0, Z0, X1, Z1] = Arena.BOUNDS, q = arena.at(X0 + Math.random() * (X1 - X0), Z0 + Math.random() * (Z1 - Z0)); q.y = arena.floor(q.x, 40, q.z, 0, 60); return isFinite(q.y) ? q : null; };
  function stepStrikes(dt) {
    for (let i = strikeQ.length - 1; i >= 0; i--) if ((strikeQ[i].t -= dt) <= 0) { const s = strikeQ.splice(i, 1)[0]; godStrike(s.p, s.team, s.big); }
    for (let i = strikes.length - 1; i >= 0; i--) {
      const s = strikes[i]; s.t += dt; const u = s.t / s.life;
      if (u >= 1) { scene.remove(s.m); s.m.material.dispose(); strikes.splice(i, 1); continue; }
      if (s.wave) { s.m.scale.setScalar(2 + u * 90); s.m.material.opacity = 0.85 * (1 - u); }
      else { s.m.material.opacity = 0.9 * (1 - u); s.m.scale.x = s.m.scale.z = (1 - u * 0.7) * (s.m.scale.y); }
    }
  }

  // the supply tables: a plank crate stacked with ammo cans and frags, a ring in the side's colour round it
  const supplyMeshes = [];
  function supplyCrate(col) {
    const g = new THREE.Group(), wood = new THREE.MeshLambertMaterial({ color: 0x7a5530 }), dark = new THREE.MeshLambertMaterial({ color: 0x4a3218 }), can = new THREE.MeshLambertMaterial({ color: 0x4b5320 });
    const box = (sx, sy, sz, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); b.position.set(x, y, z); g.add(b); return b; };
    box(1.3, 0.8, 0.85, 0, 0.4, 0, wood);
    for (const y of [0.15, 0.45, 0.75]) box(1.34, 0.06, 0.89, 0, y, 0, dark);                                   // planks
    for (const x of [-0.62, 0.62]) box(0.08, 0.82, 0.9, x, 0.41, 0, dark);
    box(0.42, 0.26, 0.24, -0.3, 0.93, 0.12, can); box(0.42, 0.26, 0.24, -0.3, 0.93, -0.16, can); box(0.42, 0.26, 0.24, -0.3, 1.19, -0.02, can);   // ammo cans
    for (let i = 0; i < 3; i++) { const n = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), can); n.scale.y = 1.2; n.position.set(0.2 + i * 0.16, 0.88, 0.1); g.add(n); }   // frags
    const ring = new THREE.Mesh(new THREE.RingGeometry(SUPPLY_R - 0.12, SUPPLY_R, 32), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; g.add(ring);
    return g;
  }
  function iceBlock(p) {
    const g = new THREE.Group(), mats = [];
    const mat = (col, o) => { const m = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: o, depthWrite: false }); m.userData.o = o; mats.push(m); return m; };
    const cube = new THREE.Mesh(ICE_BOX, mat(0xbfeaff, 0.5)); cube.scale.set(1.7, 2.3, 1.7); cube.position.y = 1.15; cube.rotation.y = Math.random() * Math.PI; g.add(cube);   // (the RS freeze: a block round you)
    const edge = new THREE.LineSegments(ICE_EDGES, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })); edge.material.userData.o = 0.8; mats.push(edge.material);
    edge.scale.copy(cube.scale); edge.position.copy(cube.position); edge.rotation.copy(cube.rotation); g.add(edge);
    const sm = mat(0x7fd0ff, 0.75);
    for (let i = 0; i < 11; i++) {                                   // shards bursting out of the ground round it
      const s = new THREE.Mesh(ICE_SHARD, sm), a = i / 11 * Math.PI * 2 + Math.random() * 0.4, r = 1.2 + Math.random() * 2.6;
      s.scale.set(0.25 + Math.random() * 0.2, 0.9 + Math.random() * 1.3, 0.25 + Math.random() * 0.2);
      s.position.set(Math.cos(a) * r, 0.4, Math.sin(a) * r); s.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); g.add(s);
    }
    const frost = new THREE.Mesh(ICE_FROST, mat(0xe8f8ff, 0.35)); frost.position.y = 0.06; g.add(frost);
    g.position.copy(p); g.position.y -= 0.35; scene.add(g);
    iceFx.push({ kind: 'block', p: g.position.clone(), g, mats, t: 0, life: 1.8 });
  }

  // ---------------- the match
  let game = null, vm = null, me = null, paused = false, inMatch = false, aimedAt = null, deathCam = 0, net = null, respawnAsk = 0;
  const avatars = new Map();
  const classes = CLASSES;
  let setup = { mode: 'tdm', difficulty: 'regular', perTeam: 6, team: 'sara', cls: 0, ...load(SETUP_KEY, {}) };

  async function startMatch() {
    net?.close(); net = null;
    $('menu').style.display = 'none'; $('loading').style.display = 'flex'; status('summoning soldiers...');
    await pKits;
    const cls = classes[setup.cls] || classes[0];
    await enterMatch(new Game(arena, { mode: setup.mode, difficulty: setup.difficulty, perTeam: setup.perTeam, playerTeam: setup.team, loadout: { primary: cls.primary, secondary: cls.secondary, lethal: cls.lethal }, name: localStorage.getItem('codscape.name') || 'You' }));
  }
  /** online: the always-on CTF match on the server */
  async function startOnline() {
    net?.close();
    $('menu').style.display = 'none'; $('loading').style.display = 'flex'; status('joining the online match...');
    await pKits;
    const n = net = new NetClient(arena, {
      welcome: g => { if (net === n) enterMatch(g, true); },
      roster: (added, removed) => { if (net !== n) return; for (const f of removed) dropAvatar(f); for (const f of added) addAvatar(f); },
      chat: (name, team, text) => hud.say(name, text, team === 'sara' ? '#7fb0ff' : team === 'zam' ? '#ff7a6a' : '#ff0'),
      closed: why => { if (net !== n) return; net = null; if (inMatch) endMatch(); $('loading').style.display = 'none'; showMenu('main'); hud.message('OFFLINE', '#f55', why, 4); $('menubox').insertAdjacentHTML('afterbegin', `<div class="sub" style="color:#f88">${why}</div>`); },
    });
    n.connect(localStorage.getItem('codscape.name') || '', setup.cls);
  }
  let vi = 0;
  async function addAvatar(f) {
    const team = f.team === 'zam' || f.team === 'sara' ? f.team : (f.id % 2 ? 'zam' : 'sara');
    const a = await Avatar.create(team, vi++);
    if (!game || !game.fighters.includes(f)) { a.dispose(); return; }                 // (gone while it loaded)
    f.avatar = a; avatars.set(f, a); scene.add(a.group); a.setGun(f.gunner.g.id);
    if (!f.alive) a.group.visible = false;
  }
  function dropAvatar(f) { const a = avatars.get(f); if (a) { scene.remove(a.group); a.dispose(); avatars.delete(f); } }
  async function enterMatch(g, online = false) {
    $('endbox').style.display = 'none';
    for (const m of nades.values()) scene.remove(m); nades.clear();
    for (const a of avatars.values()) { scene.remove(a.group); a.dispose(); }   // (last match's bodies: free their GPU buffers)
    vm?.dispose();
    avatars.clear();
    game = g; me = game.player; pick = null; wrathFx = null; strikeQ.length = 0;
    for (const m of supplyMeshes.splice(0)) scene.remove(m);
    for (const s of game.supplies) { const m = supplyCrate(Arena.TEAMS[s.team]?.hex ?? 0xffd040); m.position.copy(s.p); scene.add(m); supplyMeshes.push(m); }
    for (const D of dragons.splice(0)) scene.remove(D.g);
    vm = new ViewModel(Arena.TEAMS[me.team]?.hex ?? 0x6a6a6a); vm.resize(innerWidth / innerHeight); vm.scene.environment = gunEnv;
    await Promise.all(game.fighters.map(addAvatar));
    if (game !== g) return;
    $('loading').style.display = 'none';
    if (online && inMatch) { hud.message('NEW MATCH', '#ff981f', `you're ${me.team === 'sara' ? 'Saradomin' : 'Zamorak'}`, 3); return; }
    inMatch = true; paused = false; deathCam = 0;
    input.enabled = true; sfx.start();
    if (input.device === 'kbm') input.lock();
    if (input.touch) input.touch.show(true);
    document.body.classList.add('playing');
    firstTips();
    hud.message(online ? 'ONLINE: CAPTURE THE FLAG' : game.mode.name, '#ff981f', online ? `you're ${me.team === 'sara' ? 'Saradomin' : 'Zamorak'} · ENTER to chat` : TOUCH ? 'left thumb: move · drag right: aim · FIRE' : (game.modeId === 'ctf' ? "Take their standard from their tower. Bring it home." : game.mode.desc), 3);   // once, at the start
  }

  function endMatch() {
    net?.close(); net = null; closeChat();
    inMatch = false; input.enabled = false; input.unlock(); if (input.touch) input.touch.show(false);
    document.body.classList.remove('playing');
    showMenu('main');
  }

  // ---------------- events -> sound, HUD, bodies
  const _v = new THREE.Vector3();
  const panOf = p => { if (!me) return 0; const d = _v.subVectors(p, me.body.pos), r = new THREE.Vector3(Math.cos(me.body.yaw), 0, -Math.sin(me.body.yaw)); return Math.max(-1, Math.min(1, d.normalize().dot(r))); };
  const distOf = p => me ? p.distanceTo(me.body.pos) : 20;
  function handle(e) {
    switch (e.t) {
      case 'shot': {
        const a = avatars.get(e.f); if (a && e.f !== me) a.shot();
        if (e.f === me) { vm.shot(e.w, me.gunner.ads); sfx.shot(e.w.sound, 0); shake = Math.max(shake, e.w.cls === 'SNIPER' ? 0.5 : 0.08); }
        else sfx.shot(e.w.sound, distOf(e.f.body.pos), panOf(e.f.body.pos));
        break;
      }
      case 'gun': if (e.f !== me) break;
        if (e.e === 'mag-out') sfx.magOut(); else if (e.e === 'mag-in') sfx.magIn(); else if (e.e === 'bolt') sfx.bolt(); else if (e.e === 'pump') sfx.pump();
        else if (e.e === 'shell') sfx.shell(); else if (e.e === 'dry') sfx.dry(); else if (e.e === 'swap') sfx.swap(); else if (e.e === 'knife') sfx.knife(); else if (e.e === 'pin') sfx.pin();
        break;
      case 'hit': {
        if (e.f === me && e.v !== me) { hud.hit(e.kill, e.zone === 'head'); sfx.hitmarker(e.kill); if (e.zone === 'head') sfx.headshot(); hud.splatAt(e.at || e.v.body.pos.clone().add(new THREE.Vector3(0, 1.4, 0)), e.dmg, e.kill); }
        if (e.v === me) { hud.hurt(e.dir.clone().negate()); sfx.hurt(); shake = Math.max(shake, 0.25); }
        if (e.at) puff(e.at, 0x8a0a0a, 0.1, 0.3, new THREE.Vector3(0, 0.3, 0));
        break;
      }
      case 'impact': puff(e.p, 0xb8a888, 0.08, 0.5, e.n.clone().multiplyScalar(0.6)); puff(e.p, 0xffe0a0, 0.03, 0.08, new THREE.Vector3(), true); break;
      case 'kill': {
        const a = avatars.get(e.v);
        if (a) { a.group.visible = true; a.die(e.dir || new THREE.Vector3(0, 0, -1), e.w?.cls === 'SNIPER' ? 7 : e.w?.cls === 'LETHAL' ? 9 : 3.5, (x, z) => arena.floor(x, e.v.body.pos.y + 1.2, z, 0, 40)); }
        if (e.f === me && e.v !== me) {
          const pts = 100 + (e.tags.includes('HEADSHOT') ? 50 : 0);
          hud.point(`+${pts}  ${e.v.name}`, '#ff0');
          for (const t of e.tags) hud.point(t === '360' ? '360 NOSCOPE!!' : t, t === '360' ? '#f0f' : '#ff981f');
          if (e.tags.includes('360')) { hud.message('360 NOSCOPE', '#f0f', 'absolute legend', 3.5); sfx.jingle(); }
        }
        if (e.v === me) { sfx.dead(); deathCam = 0; vm.flashT = 0; }
        break;
      }
      case 'assist': if (e.f === me) hud.point('+50  ASSIST', '#ccc'); break;
      case 'confirm': hud.hit(true, e.head); sfx.hitmarker(true); break;
      case 'spawn': { const a = avatars.get(e.f); if (a) { a.revive(); a.setGun(e.f.loadout.primary); } if (e.f === me) { hud.dmgDirs.length = 0; } break; }
      case 'streak': if (e.f === me) { hud.message(e.s.name + ' READY', '#5f5', e.s.desc, 3); sfx.jingle(); } else if (game.mode.teams && e.f.team !== me.team) hud.message(`ENEMY ${e.s.name}`, '#f55', '', 2.5); else if (game.mode.teams) hud.message(`FRIENDLY ${e.s.name}`, '#5af', '', 2); break;
      case 'boom': {
        if (e.ice) iceBlock(e.p);
        const s = e.ice ? 0x9fe0ff : 0xffb040;
        puff(e.p, s, e.r * 0.35, 0.35, new THREE.Vector3(), true); puff(e.p, 0x555048, e.r * 0.25, 1.2, new THREE.Vector3(0, 1.5, 0));
        for (let i = 0; i < 8; i++) puff(e.p, 0x3a3530, 0.25, 0.9, new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 7, (Math.random() - 0.5) * 8));
        const d = distOf(e.p); sfx.boom(d, panOf(e.p)); shake = Math.max(shake, Math.max(0, 1 - d / 25));
        break;
      }
      case 'bounce': if (distOf(e.p) < 20) sfx.bounce(); for (let i = 0; i < 3; i++) puff(e.p, 0x8a7a5a, 0.18, 0.6, new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.8 + Math.random(), (Math.random() - 0.5) * 1.5)); break;   // (a kick of dust where it lands)
      case 'dragon': {
        for (const b of e.blasts || []) iceMark(b.p, b.t, 0xff7a2a, false);
        flyDragon(e.a, e.b, e.lead, e.dur);
        if (e.f !== me) { const foe = game.mode.teams ? e.f.team !== me?.team : true; hud.message(foe ? 'ENEMY KING BLACK DRAGON' : 'FRIENDLY KING BLACK DRAGON', foe ? '#f55' : '#ff8a3a', 'get under cover', 2.5); }
        sfx.boom(60, 0); break;
      }
      case 'wrath': {
        wrathFx = { team: game.mode.teams ? e.f.team : null, left: e.left, on: true, mine: game.mode.teams ? e.f.team === me?.team : e.f === me, beep: Math.ceil(e.left) + 1, flash: 0 };
        hud.message(wrathName(wrathFx.team), wrathFx.team === 'zam' ? '#ff5040' : '#fff6c0', wrathFx.mine ? `${e.f === me ? 'You' : e.f.name} called down the end of the match` : 'run. it will not help', 4);
        sfx.jingle(); break;
      }
      case 'wrathhit': {
        const team = game.mode.teams ? e.f.team : null;
        if (wrathFx) { wrathFx.flash = 1; wrathFx.on = false; }
        shake = 1.4; sfx.boom(0, 0); sfx.boom(5, 0.5); sfx.boom(5, -0.5);
        for (const f of game.fighters) if (f.alive && f !== e.f && (!game.mode.teams || f.team !== e.f.team)) strikeQ.push({ p: f.body.pos.clone(), team, big: true, t: Math.random() * 0.25 });   // (one on every one of them)
        for (let i = 0; i < 40; i++) { const q = arenaSpot(); if (q) strikeQ.push({ p: q, team, big: Math.random() < 0.3, t: 0.15 + Math.random() * 3 }); }
        const c = arena.at(2400, 3104); c.y = arena.floor(c.x, 40, c.z, 0, 60) || 2; shockwave(c, team); setTimeout(() => shockwave(c, team), 350);
        break;
      }
      case 'barrage': for (const b of e.blasts || []) iceMark(b.p, b.t); if (e.f !== me) hud.message(game.mode.teams && e.f.team !== me?.team ? 'ENEMY ICE BARRAGE' : 'FRIENDLY ICE BARRAGE', game.mode.teams && e.f.team !== me?.team ? '#f55' : '#9fe0ff', 'take cover', 2.5); break;
      case 'resupply': if (e.f === me) { hud.message('RESUPPLIED', '#ffd040', 'ammo and grenades topped up', 1.6); sfx.magIn(); sfx.pin(); } break;
      case 'stuck': if (e.f === me) hud.point('STUCK!', '#ff0'); if (e.v === me) hud.message('STUCK!', '#f55', 'semtex on you', 1.5); break;
      case 'flag': {
        const ours = me && e.fl.team === me.team, by = e.f === me ? 'You' : e.f?.name || '';
        const txt = { taken: ours ? 'OUR FLAG TAKEN' : 'ENEMY FLAG TAKEN', dropped: ours ? 'OUR FLAG DROPPED' : 'ENEMY FLAG DROPPED', returned: ours ? 'OUR FLAG RETURNED' : 'ENEMY FLAG RETURNED', captured: ours ? 'ENEMY CAPTURED OUR FLAG' : 'WE CAPTURED THE FLAG' }[e.what];
        const good = (e.what === 'taken' || e.what === 'captured') ? !ours : ours;
        hud.message(txt, good ? '#5f5' : '#f55', by, 2.6); sfx.flag(good);
        if (e.f === me) hud.point({ taken: '+100 FLAG TAKEN', returned: '+100 FLAG RETURN', captured: '+500 CAPTURE' }[e.what] || '', '#ff0');
        break;
      }
      case 'move': if (e.f === me) { if (e.e === 'land') sfx.land(me.body.landed); if (e.e === 'slide') sfx.burst?.(800, 0.4, 0.2); } break;
      case 'end': hud.message(game.winner === 'draw' ? 'DRAW' : (game.mode.teams ? (game.winner === me.team ? 'VICTORY' : 'DEFEAT') : (game.winner === me ? 'VICTORY' : 'DEFEAT')), '#ff0', '', 6); input.unlock(); if (wrathFx) wrathFx.endAfter = true; else { const g0 = game; setTimeout(() => { if (game === g0 && game.over) showEnd(); }, 3500); } break;   // (after God's Wrath: once its storm has played out)
    }
  }

  // ---------------- aim assist (gamepad / touch): slow the turn near an enemy, follow them a little, snap on ADS
  let adsWas = 0, snapT = 0, snapTo = null;
  function assist(inp, dt) {
    if (!settings.assist || (inp.device !== 'pad' && inp.device !== 'touch') || !me.alive) return;
    const eye = me.eye(new THREE.Vector3()), look = me.body.look(new THREE.Vector3());
    let best = null, ba = 0.2;
    for (const f of game.enemies(me)) {
      const p = f.body.pos.clone().add(_v.set(0, f.body.height * 0.7, 0)), d = p.clone().sub(eye), L = d.length(); if (L > 70) continue;
      const a = Math.acos(Math.min(1, d.normalize().dot(look)));
      if (a < ba && game.canSee(eye, p)) { ba = a; best = { f, p, L, a }; }
    }
    const G = me.gunner;
    if (best) {
      const near = best.a < Math.atan(1.2 / best.L) * 1.6;
      if (near) { inp.look.dyaw *= 0.55; inp.look.dpitch *= 0.55; }              // slowdown
      // rotational: when the enemy moves across you, the aim drifts with them
      const ang = Math.atan2(-(best.p.x - eye.x), -(best.p.z - eye.z));
      if (best.lastAng !== undefined) void 0;
      const dy = ((ang - me.body.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      if (near && (Math.hypot(inp.move.x, inp.move.z) > 0.2 || Math.hypot(best.f.body.vel.x, best.f.body.vel.z) > 1)) inp.look.dyaw += dy * Math.min(1, dt * 4) * 0.5;
      if (G.ads > 0.1 && adsWas <= 0.1 && best.a < 0.2) { snapT = 0.14; snapTo = best; }          // the ADS snap
    }
    if (snapT > 0 && snapTo) {
      snapT -= dt;
      const d = snapTo.f.body.pos.clone().add(_v.set(0, snapTo.f.body.height * 0.72, 0)).sub(eye).normalize();
      const yaw = Math.atan2(-d.x, -d.z), pitch = Math.asin(d.y);
      const dy = ((yaw - me.body.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      inp.look.dyaw += dy * Math.min(1, dt * 14); inp.look.dpitch += (pitch - me.body.pitch) * Math.min(1, dt * 14);
    }
    adsWas = G.ads;
  }

  // ---------------- the loop
  let pauseFrame = false, last = performance.now(), fpsT = 0, frames = 0, swayT = 0, breath = 0, breathT = 0, prevYaw = 0, prevPitch = 0;
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); vm?.resize(w / h); hud.resize();
    pauseFrame = false;                                            // (a resize clears the canvas: the pause frame has to be redrawn)
  }
  addEventListener('resize', resize); resize();
  // the GPU can drop the context (driver reset, a Chrome popup on a weak GPU): keep the page alive and rebuild on restore
  let glLost = false;
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); glLost = true; });
  canvas.addEventListener('webglcontextrestored', () => { glLost = false; gunEnv = gunEnvironment(renderer); scene.environment = gunEnv; if (vm) vm.scene.environment = gunEnv; resize(); });

  function frame(now) {
    requestAnimationFrame(frame);
    const raw = (now - last) / 1000, dt = Math.min(0.05, raw); last = now;
    if (glLost) return;
    if (!inMatch || !game) { renderer.clear(); renderer.render(scene, camera); idleCam(dt); return; }

    const G = me.gunner, w = G.w;
    const zoom = w.zoom || 1;
    const inp = input.read(dt, zoom, G.ads);
    if (menu.style.display !== 'none') { if (inp.pause && !game.over) showMenu('paused'); }   // (ESC on the class/settings page backs out to PAUSED, never unpauses under it)
    else if (!game.over && (inp.pause || (inp.unlocked && !paused))) setPaused(inp.pause ? !paused : true);   // (ESC also drops the pointer lock: pause once, not twice)
    // paused: the menus sit over a frozen frame (drawn once); nothing renders behind them
    if (paused && !net) { if (!pauseFrame) { draw(0, inp); pauseFrame = true; } return; }
    if (net && (paused || chatOpen)) { const look = inp.look; Object.assign(inp, { move: { x: 0, z: 0 }, gun: { ...NO_GUN }, look: chatOpen ? look : { dyaw: 0, dpitch: 0 }, streak: false, respawn: false }); }   // (online the match goes on behind the menu)
    if (net && inp.chat && !paused && !chatOpen) openChat();
    // adaptive resolution: hold ~55 fps, timed on the real clock (not the clamped dt) and only while playing;
    // a single long frame (a popup, a tab switch) is a stall, not slowness: start the count again
    if (raw > 0.25) { fpsT = 0; frames = 0; } else { fpsT += raw; frames++; }
    if (fpsT > 1.5) {
      const fps = frames / fpsT; fpsT = 0; frames = 0;
      const want = fps < 45 ? Math.max(0.5, resScale * Math.max(0.6, Math.min(0.92, Math.sqrt(fps / 55)))) : fps > 58 && resScale < 1 ? Math.min(1, resScale + 0.05) : resScale;
      if (Math.abs(want - resScale) > 0.01) { resScale = want; renderer.setPixelRatio(dprBase * resScale); resize(); }
    }
    if (!me.alive && inp.respawn && me.respawnT <= 0) { inp.respawn = true; if (net && performance.now() - respawnAsk > 500) { respawnAsk = performance.now(); net.respawn(); } } else if (me.alive) inp.respawn = false;
    // hold breath while scoped (a few seconds, then you have to breathe)
    const scoped = w.scope && G.ads > 0.9;
    if (scoped && inp.breath && breathT < 4) { breath = 1; breathT += dt; } else { breath = 0; breathT = Math.max(0, breathT - dt * (scoped ? 0.5 : 2)); }
    if (scoped) inp.move.sprint = false;
    barragePick(inp);
    assist(inp, dt);
    net?.frame(dt);
    game.step(dt, inp);
    net?.sendState(dt);
    for (const e of game.events) handle(e);
    game.events.length = 0;
    draw(dt, inp);
  }

  // killstreaks: 4 calls in the newest one earned. The aimed ones (Ice Barrage, the King Black Dragon) bring up the
  // map: the look moves the reticle, FIRE calls it in, AIM (or 4 again) backs out
  let pick = null, holdFire = false;
  const NO_GUN = { fire: false, ads: false, reload: false, swap: false, knife: false, nade: false };
  const callIn = (id, x, z) => { if (game.role === 'client') { net?.streak(id, x, z); const i = me.ready.lastIndexOf(id); if (i >= 0) me.ready.splice(i, 1); } else game.callStreak(me, id, x, z); };
  function barragePick(inp) {
    if (holdFire) { if (inp.gun.fire) inp.gun = { ...NO_GUN }; else holdFire = false; }
    if (!pick) {
      const id = me.ready[me.ready.length - 1];
      if (!inp.streak || !me.alive || !id) return;
      if (STREAKS.find(s => s.id === id)?.pick) { pick = { kind: id, x: me.body.pos.x, z: me.body.pos.z, fireWas: true }; sfx.pin(); }
      else { callIn(id, 0, 0); sfx.jingle(); }                            // (God's Wrath: no aiming, it falls on all of them)
      return;
    }
    if (!me.alive || !me.ready.includes(pick.kind) || inp.streak || inp.gun.ads) { pick = null; inp.gun = { ...NO_GUN }; holdFire = true; return; }
    const [X0, Z0, X1, Z1] = Arena.BOUNDS, sw = arena.at(X0, Z0), ne = arena.at(X1, Z1);
    pick.x = Math.max(sw.x, Math.min(ne.x, pick.x - inp.look.dyaw * 45)); pick.z = Math.max(ne.z, Math.min(sw.z, pick.z - inp.look.dpitch * 45));
    const fire = inp.gun.fire && !pick.fireWas; pick.fireWas = inp.gun.fire;
    inp.look.dyaw = inp.look.dpitch = 0; inp.gun = { ...NO_GUN };
    if (fire) {
      callIn(pick.kind, pick.x, pick.z);
      hud.message(pick.kind === 'dragon' ? 'KING BLACK DRAGON INBOUND' : 'ICE BARRAGE INBOUND', pick.kind === 'dragon' ? '#ff8a3a' : '#9fe0ff', '', 2); sfx.jingle(); pick = null; holdFire = true;
    }
  }

  // God's Wrath: the countdown, the sky filling with the god's colour, then the flash
  function wrathHud(dt) {
    const W = wrathFx; if (!W) return null;
    if (W.on) W.left = Math.max(0, W.left - dt);                         // (game time, so it lands with the hit even on a slow frame rate)
    if (W.on) {                                                          // the god's patience runs out: the ground shakes, then it starts hitting things
      shake = Math.max(shake, (10 - W.left) / 10 * 0.35);
      if (W.left < 6 && (W.next = (W.next ?? 0) - dt) <= 0) { W.next = 0.12 + W.left / 6 * 0.5; const q = arenaSpot(); if (q) godStrike(q, W.team); }
    }
    const left = W.on ? W.left : 0;
    if (W.on && Math.ceil(left) < W.beep) { W.beep = Math.ceil(left); if (W.beep > 0) sfx.flag(W.mine); }
    if (!W.on) {                                                         // the flash burns off fast so you see the storm it leaves; 5 s of that before the scores
      W.after = (W.after || 0) + Math.max(dt, 1 / 60); W.flash = Math.max(0, 1 - W.after / 1.4); shake = Math.max(shake, 0.6 * Math.max(0, 1 - W.after / 4));
      if (W.after > 5) { wrathFx = null; if (W.endAfter && game?.over) showEnd(); return null; }
    }
    return { name: wrathName(W.team), left, team: W.team, tint: W.on ? Math.min(0.45, (10 - left) / 10 * 0.45) : 0, flash: W.flash };
  }

  function setPaused(p) {
    paused = p; pauseFrame = false; fpsT = 0; frames = 0;            // (the resolution scaler starts counting afresh)
    if (!p) menu.style.display = 'none';
    $('pause').style.display = p ? 'flex' : 'none';
    if (p) input.unlock(); else if (input.device === 'kbm') input.lock();
    if (input.touch) input.touch.show(!p);
  }

  function draw(dt, inp) {
    const G = me.gunner, w = G.w, b = me.body;
    // avatars
    for (const [f, a] of avatars) {
      if (!f.alive) { a.updateRag(dt); continue; }
      a.group.visible = f !== me;                              // (yours is posed too, unseen, so you fall as a ragdoll)
      if (a.gunId !== f.gunner.g.id) a.setGun(f.gunner.g.id);
      a.update(dt, { pos: f.body.wading ? _v.copy(f.body.pos).setY(f.body.pos.y - MOVE.wadeSink) : f.body.pos, yaw: f.body.yaw, pitch: f.body.pitch, vel: f.body.vel, crouch: f.body.crouch, onGround: f.body.onGround, sprinting: f.body.sprinting, reloading: f.gunner.reloading });
    }
    // flags
    const tt = performance.now() / 1000;
    for (const [k, fm] of Object.entries(flagMeshes)) {
      const fl = game.modeId === 'ctf' ? game.flags[k] : null;
      fm.g.visible = !!fl; fm.stand.visible = !!fl; if (!fl) continue;
      fm.stand.position.copy(fl.home);
      if (fl.state === 'carried' && fl.carrier) { fm.g.position.copy(fl.carrier.body.pos).add(_v.set(0, 0.2, 0)); fm.g.rotation.y = fl.carrier.body.yaw; fm.g.scale.setScalar(0.7); fm.g.visible = fl.carrier !== me || !me.alive; }
      else { fm.g.position.copy(fl.pos); fm.g.rotation.y = tt * 0.2; fm.g.scale.setScalar(1); }
      fm.beam.visible = fl.state !== 'carried';
      const P = fm.cg.attributes.position.array, B = fm.base;                     // the cloth ripples
      for (let i = 0; i < P.length; i += 3) P[i + 2] = Math.sin(B[i] * 5 - tt * 6 + B[i + 1] * 2) * 0.08 * B[i];
      fm.cg.attributes.position.needsUpdate = true;
    }
    // tracers
    const tp = tracerGeo.attributes.position.array; let n = 0;
    for (const t of game.tracers) {
      if (n >= TR) break;
      const from = t.f === me ? me.eye(new THREE.Vector3()).add(new THREE.Vector3(Math.cos(b.yaw) * 0.12, -0.14, -Math.sin(b.yaw) * 0.12)) : (t.from || t.o);
      const mid = from.clone().lerp(t.to, 0.35 + (0.06 - t.t) * 8);
      tp.set([mid.x, mid.y, mid.z, t.to.x, t.to.y, t.to.z], n * 6); n++;
    }
    tracerGeo.setDrawRange(0, n * 2); tracerGeo.attributes.position.needsUpdate = true;
    // grenades in the air: the model (3x so you can follow it), tumbling end over end, trailing a thin smoke line
    for (const g of game.grenades) {
      let m = nades.get(g);
      if (!m) { m = buildGun(g.L.sticky ? 'semtex' : 'frag').group; m.scale.setScalar(3); m.userData.trail = 0; scene.add(m); nades.set(g, m); }
      m.position.copy(g.p);
      if (!g.rest && !g.stuck && !g.stuckWall) { m.rotation.x += dt * 13; m.rotation.z += dt * 4; if ((m.userData.trail += dt) > 0.025 && (!g.f || g.p.distanceTo(g.f.eye(_v)) > 2.5)) { m.userData.trail = 0; puff(g.p, 0xcfcabb, 0.08, 0.6); } }   // (not in the thrower's face)
    }
    for (const [g, m] of nades) if (!game.grenades.includes(g)) { scene.remove(m); nades.delete(g); }
    stepStrikes(dt);
    // the King Black Dragon's run
    for (let i = dragons.length - 1; i >= 0; i--) {
      const D = dragons[i]; D.t += dt;
      const u = (D.t - D.lead) / D.dur;
      if (u > 1.15) { scene.remove(D.g); D.g.traverse(o => o.geometry?.dispose()); dragons.splice(i, 1); continue; }
      if (u < -0.15) continue;
      D.g.visible = true;
      const p = D.a.clone().lerp(D.b, u); p.y += Math.sin(u * Math.PI) * -3;          // (dips over the target)
      D.g.position.copy(p); D.g.lookAt(p.clone().add(D.a.clone().sub(D.b)));       // (heads lead: the model faces -z)
      const flap = Math.sin(D.t * 9) * 0.55; D.g.userData.wings[0].rotation.z = flap; D.g.userData.wings[1].rotation.z = -flap;
      if (u > 0.3 && u < 0.7 && (D.breath += dt) > 0.03) {                           // fire from the heads, down the line
        D.breath = 0;
        const head = p.clone().add(D.b.clone().sub(D.a).normalize().multiplyScalar(5)), down = new THREE.Vector3((Math.random() - 0.5) * 3, -16, (Math.random() - 0.5) * 3);
        puff(head, Math.random() < 0.5 ? 0xff7a1a : 0xffc040, 0.6 + Math.random() * 0.5, 0.7, down, true);
      }
    }
    // Ice Barrage: the warning rings and falling orbs, then the ice
    for (let i = iceFx.length - 1; i >= 0; i--) {
      const x = iceFx[i]; x.t += dt;
      if (x.kind === 'mark') {
        const u = Math.min(1, x.t / x.land);
        x.ring.material.opacity = 0.35 + 0.35 * Math.sin(x.t * 14) ** 2; x.ring.scale.setScalar(1.15 - 0.15 * u);
        x.orb.position.set(x.p.x, x.p.y + 0.6 + 34 * (1 - u) ** 1.6, x.p.z); x.orb.rotation.x += dt * 5; x.orb.rotation.y += dt * 3;
        x.glow.position.copy(x.orb.position);
        if (x.t >= x.land) { scene.remove(x.ring, x.orb, x.glow); x.ring.material.dispose(); iceFx.splice(i, 1); }
      } else {
        const u = x.t / x.life, grow = Math.min(1, x.t / 0.12);
        x.g.scale.setScalar(grow); x.g.position.y = x.p.y - (u > 0.75 ? (u - 0.75) * 4 * 1.6 : 0);
        for (const m of x.mats) m.opacity = m.userData.o * (u > 0.75 ? 1 - (u - 0.75) * 4 : 1);
        if (u >= 1) { scene.remove(x.g); for (const m of x.mats) m.dispose(); iceFx.splice(i, 1); }
      }
    }
    // puffs
    for (let i = fx.length - 1; i >= 0; i--) {
      const p = fx[i]; p.t += dt; const u = p.t / p.life;
      if (u >= 1) { scene.remove(p.m); p.m.material.dispose(); fx.splice(i, 1); continue; }
      p.m.position.addScaledVector(p.vel, dt); p.vel.y -= dt * 2; p.m.scale.setScalar(p.size * (1 + u * 1.5)); p.m.material.opacity = 0.8 * (1 - u);
    }

    // camera: your eyes, or the death cam over your body
    const scoped = w.scope && G.ads > 0.9;
    const hfov = settings.fov * Math.PI / 180, baseV = 2 * Math.atan(Math.tan(hfov / 2) / camera.aspect);
    const zoom = scoped ? w.zoom : 1 + (w.zoom - 1) * G.ads * (w.scope ? 0.3 : 1);
    let vfov = 2 * Math.atan(Math.tan(baseV / 2) / zoom);
    if (b.sprinting) vfov *= 1.06;
    swayT += dt;
    const sway = scoped ? { x: (Math.sin(swayT * 1.1) * 0.6 + Math.sin(swayT * 2.3) * 0.3) * (breath ? 0.12 : 1), y: (Math.sin(swayT * 1.7) * 0.5 + Math.cos(swayT * 0.9) * 0.3) * (breath ? 0.12 : 1) } : { x: 0, y: 0 };
    shake = Math.max(0, shake - dt * 2.5);
    if (me.alive) {
      me.eye(camera.position);
      if (b.sprinting && b.onGround) camera.position.y += Math.abs(Math.sin(b.stepT * 1.6)) * 0.04;
      camera.rotation.set(b.pitch + sway.y * 0.012 + (Math.random() - 0.5) * shake * 0.02, b.yaw + sway.x * 0.012 + (Math.random() - 0.5) * shake * 0.02, (b.slide > 0 ? 0.06 : 0) + (Math.random() - 0.5) * shake * 0.01, 'YXZ');
    } else {
      deathCam += dt;
      const a = avatars.get(me), J = a?.worldJoints(), pel = J ? J[2] : me.body.pos.clone().add(_v.set(0, 0.5, 0));
      const look = me.killer && me.killer.alive && deathCam > 1.2 ? me.killer.body.pos.clone().add(_v.set(0, 1.2, 0)) : pel;
      const ang = deathCam * 0.4 + me.body.yaw, r = 3.2 + Math.min(1.5, deathCam);
      const want = pel.clone().add(new THREE.Vector3(Math.sin(ang) * r, 1.8 + deathCam * 0.15, Math.cos(ang) * r));
      const hit = arena.ray(pel, want.clone().sub(pel).normalize(), want.distanceTo(pel));
      camera.position.copy(hit ? hit.point.clone().lerp(pel, 0.15) : want); camera.lookAt(look);
    }
    camera.fov = vfov * 180 / Math.PI; camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    // what's under the crosshair (for the name tag + the red dot)
    aimedAt = null;
    if (me.alive) {
      const o = me.eye(new THREE.Vector3()), d = b.look(new THREE.Vector3()), wall = arena.ray(o, d, 150);
      let bt = wall ? wall.distance : 150;
      for (const f of game.enemies(me)) { const h = f.hit(o, d, bt); if (h) { bt = h.t; aimedAt = f; } }
    }
    renderer.clear();
    renderer.render(scene, camera);
    // the gun and hands, over everything
    if (me.alive && !scoped) {
      const look = { dx: ((b.yaw - prevYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI, dy: b.pitch - prevPitch };
      vm.setGun(G.g.id, w.model);
      vm.update(dt, { gunner: G, ads: G.ads, scoped, sprint: b.sprinting, speed: Math.hypot(b.vel.x, b.vel.z) / MOVE.walk, onGround: b.onGround, look, slide: b.slide > 0, landed: b.landed, dead: false });
      b.landed = 0;
      vm.camera.fov = Math.max(40, 54 - G.ads * 8); vm.camera.updateProjectionMatrix();
      renderer.clearDepth(); withGunPass(renderer, () => renderer.render(vm.scene, vm.camera));
    } else if (me.alive) vm.update(dt, { gunner: G, ads: G.ads, sprint: false, speed: 0, onGround: true, look: { dx: 0, dy: 0 }, dead: false });
    prevYaw = b.yaw; prevPitch = b.pitch;
    // HUD
    const spreadDeg = G.spreadDeg(Math.hypot(b.vel.x, b.vel.z) / MOVE.walk, !b.onGround, b.crouch > 0.5);
    const spreadPx = Math.tan(spreadDeg * Math.PI / 180) / Math.tan(vfov / 2) * hud.c.height / 2;
    hud.draw(dt, game, me, camera, { spreadPx, ads: G.ads, scope: scoped, scopeSway: sway, breath: scoped ? breath : undefined, board: inp.board, sprint: b.sprinting, aimedAt, touch: input.device === 'touch', clickToAim: input.device === 'kbm' && !input.locked && !paused, pick: pick && me.alive ? pick : null, wrath: wrathHud(dt) });
  }

  // the menu backdrop: a slow flight round the arena
  let idleA = 0;
  function idleCam(dt) {
    idleA += dt * 0.05;
    const c = arena.at(2400, 3104);
    camera.position.set(c.x + Math.sin(idleA) * 55, 22, c.z + Math.cos(idleA) * 55); camera.lookAt(c.x, 4, c.z);
    camera.fov = 60; camera.updateProjectionMatrix();
  }

  // ---------------- menus
  const menu = $('menu');
  function showMenu(page) {
    menu.style.display = 'flex'; $('pause').style.display = 'none'; $('loading').style.display = 'none';
    const box = $('menubox');
    if (page === 'main') {
      box.innerHTML = `<div class="title">CODSCAPE</div><div class="sub">Castle Wars. Live rounds. Saradomin vs Zamorak.</div>
        <div class="col">
          <button id="m-online">PLAY ONLINE</button>
          <button id="m-play">PLAY VS BOTS</button>
          <button id="m-class">CLASSES</button>
          <button id="m-settings">SETTINGS</button>
          <button id="m-controls" class="small">CONTROLS</button>
          <a href="index.html" class="small back">ALL GAMES</a>
        </div>`;
      $('m-online').onclick = () => { sfx.start(); startOnline(); }; $('m-play').onclick = () => showMenu('play'); $('m-class').onclick = () => showMenu('class'); $('m-settings').onclick = () => showMenu('settings'); $('m-controls').onclick = () => showMenu('controls');
    } else if (page === 'play') {
      const opt = (name, cur, list) => `<div class="row"><span class="lab">${name}</span><div class="seg">${list.map(([v, l]) => `<button data-k="${name}" data-v="${v}" class="${String(cur) === String(v) ? 'sel' : ''}">${l}</button>`).join('')}</div></div>`;
      box.innerHTML = `<div class="title sm">PLAY</div>
        ${opt('MODE', setup.mode, Object.entries(MODES).map(([k, m]) => [k, m.short]))}
        <div class="desc">${MODES[setup.mode].desc}</div>
        ${opt('BOTS', setup.difficulty, Object.entries(DIFFICULTY).map(([k, d]) => [k, d.name]))}
        ${opt('SIZE', setup.perTeam, [[2, '2v2'], [4, '4v4'], [6, '6v6'], [8, '8v8']])}
        ${MODES[setup.mode].teams ? opt('SIDE', setup.team, [['sara', 'SARADOMIN'], ['zam', 'ZAMORAK']]) : ''}
        ${opt('CLASS', setup.cls, classes.map((c, i) => [i, c.name]))}
        <div class="desc">${(() => { const c = classes[setup.cls] || classes[0]; return `${WEAPONS[c.primary].name} · ${WEAPONS[c.secondary].name} · ${LETHALS[c.lethal].name}`; })()}</div>
        <div class="row name"><span class="lab">NAME</span><input id="m-name" maxlength="12" value="${(localStorage.getItem('codscape.name') || '').replace(/"/g, '')}" placeholder="You"></div>
        <div class="col"><button id="m-go">DEPLOY</button><button id="m-back" class="small">BACK</button></div>`;
      for (const b of box.querySelectorAll('.seg button')) b.onclick = () => {
        const k = { MODE: 'mode', BOTS: 'difficulty', SIZE: 'perTeam', SIDE: 'team', CLASS: 'cls' }[b.dataset.k];
        setup[k] = ['perTeam', 'cls'].includes(k) ? +b.dataset.v : b.dataset.v; save(SETUP_KEY, setup); showMenu('play');
      };
      $('m-name').oninput = e => { try { localStorage.setItem('codscape.name', e.target.value.replace(/[^\w -]/g, '').slice(0, 12)); } catch {} };
      $('m-go').onclick = () => { sfx.start(); startMatch(); };
      $('m-back').onclick = () => showMenu('main');
    } else if (page === 'class') {
      const ci = classes[setup.cls] ? setup.cls : 0, bars = id => { const s = stats(WEAPONS[id]); return `<div class="bars">${[['DAMAGE', s.dmg], ['RANGE', s.range], ['FIRE RATE', s.rate], ['MOBILITY', s.mob]].map(([n, v]) => `<div class="bar"><span>${n}</span><i style="width:${Math.round(v * 100)}%"></i></div>`).join('')}</div>`; };
      box.innerHTML = `<div class="title sm">SELECT CLASS</div>
        <div class="classes">${classes.map((c, i) => `<button data-cls="${i}" class="cls${i === ci ? ' sel' : ''}"><b>${c.name}</b><span>${WEAPONS[c.primary].name} · ${WEAPONS[c.secondary].name} · ${LETHALS[c.lethal].name}</span><em>${c.blurb}</em>${bars(c.primary)}</button>`).join('')}</div>
        <div class="col"><button id="m-back" class="small">BACK</button></div>`;
      const done = () => { if (!inMatch) return showMenu('main'); menu.style.display = 'none'; if (net) net.cls(setup.cls); else me.loadout = { ...classes[setup.cls] }; setPaused(true); };
      for (const b of box.querySelectorAll('[data-cls]')) b.onclick = () => { setup.cls = +b.dataset.cls; save(SETUP_KEY, setup); if (inMatch) { if (net) net.cls(setup.cls); else me.loadout = { ...classes[setup.cls] }; setPaused(false); hud.message(classes[setup.cls].name, '#ff0', 'next time you spawn', 2); } else showMenu('class'); };   // (picking a class drops you straight back in, like COD)
      $('m-back').onclick = done;
    } else if (page === 'settings') {
      const sl = (k, label, min, max, step) => `<div class="row"><span class="lab">${label}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${settings[k]}"><span class="val" id="v-${k}">${settings[k]}</span></div>`;
      const tg = (k, label) => `<div class="row"><span class="lab">${label}</span><div class="seg"><button data-t="${k}" class="${settings[k] ? 'sel' : ''}">ON</button><button data-t="${k}" data-off="1" class="${settings[k] ? '' : 'sel'}">OFF</button></div></div>`;
      box.innerHTML = `<div class="title sm">SETTINGS</div>
        ${sl('sens', 'MOUSE SENS', 0.2, 3, 0.05)}${sl('adsSens', 'ADS SENS', 0.3, 1.5, 0.05)}${sl('padSens', 'STICK SENS', 0.3, 2.5, 0.05)}${sl('touchSens', 'TOUCH SENS', 0.3, 2.5, 0.05)}
        ${sl('fov', 'FOV', 65, 110, 1)}${sl('volume', 'VOLUME', 0, 1, 0.05)}
        ${tg('assist', 'AIM ASSIST (PAD/TOUCH)')}${tg('invert', 'INVERT LOOK')}${tg('toggleAds', 'TOGGLE AIM')}
        <div class="col"><button id="m-back" class="small">BACK</button></div>`;
      for (const r of box.querySelectorAll('input[type=range]')) r.oninput = () => { settings[r.dataset.k] = +r.value; $('v-' + r.dataset.k).textContent = r.value; saveSettings(settings); sfx.setVolume(settings.volume); };
      for (const b of box.querySelectorAll('[data-t]')) b.onclick = () => { settings[b.dataset.t] = !b.dataset.off; saveSettings(settings); showMenu('settings'); };
      $('m-back').onclick = () => { if (!inMatch) return showMenu('main'); menu.style.display = 'none'; setPaused(true); };
    } else if (page === 'controls') {
      box.innerHTML = `<div class="title sm">CONTROLS</div>
        <div class="keys"><b>WASD</b> move · <b>SHIFT</b> sprint (hold breath when scoped) · <b>SPACE</b> jump · <b>C</b> crouch, slide out of a sprint<br>
        <b>LMB</b> fire · <b>RMB</b> aim down sights · <b>R</b> reload · <b>1 2 Q</b> / wheel swap · <b>V / F</b> knife · <b>G</b> grenade (hold to cook)<br>
        <b>TAB</b> scoreboard · <b>ESC</b> pause</div>
        <div class="keys"><b>CONTROLLER</b>: LS move (click to sprint) · RS look · LT aim · RT fire · A jump · B crouch/slide · X reload · Y swap · RB grenade · R3 / LB knife · START pause · BACK scores. Aim assist on by default.</div>
        <div class="keys"><b>TOUCH</b>: left thumb moves (push past the ring to sprint) · drag the right side to aim · FIRE (drag it to aim while shooting) · AIM toggles sights.</div>
        <div class="keys"><b>TIPS</b>: snipers drop anyone in the chest; quickscope it, or spin a full 360 before a noscope for the bonus. SMGs and the R870 own the castle corridors; the M249 holds a wall walk. 3 kills: UAV · 5: ICE BARRAGE · 7: VENGEANCE.</div>
        <div class="col"><button id="m-back" class="small">BACK</button></div>`;
      $('m-back').onclick = () => showMenu('main');
    } else if (page === 'paused') {
      menu.style.display = 'none'; $('pause').style.display = 'flex';
    }
  }
  $('p-resume').onclick = () => setPaused(false);
  $('p-class').onclick = () => { $('pause').style.display = 'none'; showMenu('class'); };
  $('p-settings').onclick = () => { $('pause').style.display = 'none'; showMenu('settings'); };
  $('p-quit').onclick = () => { paused = false; $('pause').style.display = 'none'; endMatch(); };
  function showEnd() {
    input.unlock(); if (input.touch) input.touch.show(false);
    const e = $('endbox'); e.style.display = 'flex';
    if (net) e.querySelector('#e-again').textContent = 'NEXT MATCH SOON - KEEP WATCHING';
    else e.querySelector('#e-again').textContent = 'PLAY AGAIN';
    const s = me; e.querySelector('.stats').textContent = `${s.kills} kills · ${s.deaths} deaths · ${s.assists} assists · ${s.score} score · accuracy ${Math.round(s.gunner.stats.hits / Math.max(1, s.gunner.stats.shots) * 100)}%`;
  }
  $('e-again').onclick = () => { $('endbox').style.display = 'none'; if (!net) startMatch(); else if (input.device === 'kbm') input.lock(); };
  $('e-menu').onclick = () => { $('endbox').style.display = 'none'; endMatch(); };

  $('loading').style.display = 'none';
  showMenu(new URLSearchParams(location.search).has('play') ? 'play' : 'main');
  requestAnimationFrame(frame);
  // test hook (headless screenshots)
  // ---------------- first match on this device: the controls, 10 s, once (phone and desktop each get their own)
  function firstTips() {
    const key = 'codscape.tips.' + (TOUCH ? 'touch' : 'kbm'); if (load(key, false)) return; save(key, true);
    const el = $('tips'), b = s => `<b style="color:#ff0">${s}</b>`;
    el.innerHTML = `<div style="color:#ff981f;font-weight:bold;margin-bottom:4px">CONTROLS</div>` + (TOUCH
      ? `${b('left thumb')} move (push past the ring to sprint) · ${b('drag right side')} aim<br>${b('FIRE')} shoot · ${b('AIM')} sights · ${b('DUCK')} crouch / slide<br>${b('ICE')} Ice Barrage (5 kill streak) · ${b('CHAT')} talk · ${b('II')} pause`
      : `${b('WASD')} move · ${b('SHIFT')} sprint · ${b('SPACE')} jump · ${b('C')} crouch / slide<br>${b('RMB')} aim · ${b('R')} reload · ${b('G')} grenade · ${b('V')} knife · ${b('1/2')} swap<br>${b('4')} Ice Barrage (5 kill streak) · ${b('ENTER')} chat · ${b('TAB')} scores · ${b('ESC')} pause`);
    el.style.opacity = 1; el.style.display = 'block';
    setTimeout(() => { el.style.opacity = 0; setTimeout(() => { el.style.display = 'none'; }, 700); }, 10000);
  }

  // ---------------- chat (online): ENTER opens it, ENTER sends, ESC drops it
  let chatOpen = false;
  const chatIn = $('chatin');
  function openChat() { chatOpen = true; input.enabled = false; input.keys.clear(); input.mouse.l = input.mouse.r = false; chatIn.style.display = 'block'; chatIn.value = ''; setTimeout(() => chatIn.focus(), 0); }
  function closeChat() { if (!chatOpen) return; chatOpen = false; chatIn.blur(); chatIn.style.display = 'none'; if (inMatch) input.enabled = true; }
  chatIn.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { const t = chatIn.value.trim(); if (t) net?.chat(t); closeChat(); if (input.device === 'kbm' && !paused) input.lock(); }
    else if (e.key === 'Escape') closeChat();
  });

  window.COD = { get net() { return net; }, startOnline, renderer, scene, get game() { return game; }, startMatch, setup, arena, camera, showMenu, settings, input, get me() { return me; }, get paused() { return paused; }, get vm() { return vm; }, get classes() { return classes; } };
  document.title = 'CODScape';
}

main().catch(e => { console.error(e); status('failed to load: ' + e.message); });
