// CODScape: first-person Call of Duty in Castle Wars, against bots. The menus, the loop, the camera, aim assist,
// the effects. The match itself is src/cod/game.js; the arena src/cod/arena.js.
import * as THREE from 'three';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { loadArena, Arena } from './arena.js';
import { Game, MODES, STREAKS } from './game.js';
import { DIFFICULTY } from './bots.js';
import { WEAPONS, PRIMARIES, SECONDARIES, LETHALS, DEFAULT_CLASSES, stats } from './weapons.js';
import { ViewModel } from './viewmodel.js';
import { gunEnvironment, withGunPass } from './guns.js';
import { Avatar, preloadTeam } from './soldier.js';
import { CodHud } from './hud.js';
import { Sfx } from './sfx.js';
import { Input, TouchControls, TOUCH_CSS, loadSettings, saveSettings } from './input.js';
import { RSFont, loadHitsplat } from '../hud.js';
import { MOVE } from './body.js';

THREE.ColorManagement.enabled = false;                    // hex colours as written, like the RS world's baked ones
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const $ = id => document.getElementById(id);
const status = t => { const e = $('status'); if (e) e.textContent = t; };
const TOUCH = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);
const FOG = 0xb9cbe0;
const CLASS_KEY = 'codscape.classes', SETUP_KEY = 'codscape.setup';
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
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);

  const gunEnv = gunEnvironment(renderer); scene.environment = gunEnv;   // (the world is unlit vertex colour: only the guns pick this up)
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
  const puff = (p, col, size, life, vel = new THREE.Vector3(), add = false) => {
    const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending }));
    m.position.copy(p); m.scale.setScalar(size); scene.add(m); fx.push({ m, t: 0, life, vel, size });
    if (fx.length > 160) { const o = fx.shift(); scene.remove(o.m); o.m.material.dispose(); }
  };
  let shake = 0;

  // ---------------- the match
  let game = null, vm = null, me = null, paused = false, inMatch = false, aimedAt = null, deathCam = 0;
  const avatars = new Map();
  let classes = load(CLASS_KEY, null) || DEFAULT_CLASSES.map(c => ({ ...c }));
  let setup = { mode: 'tdm', difficulty: 'regular', perTeam: 6, team: 'sara', cls: 0, ...load(SETUP_KEY, {}) };

  async function startMatch() {
    $('menu').style.display = 'none'; $('loading').style.display = 'flex'; status('summoning soldiers...');
    await pKits;
    if (game) for (const a of avatars.values()) scene.remove(a.group);
    avatars.clear();
    const cls = classes[setup.cls] || classes[0];
    game = new Game(arena, { mode: setup.mode, difficulty: setup.difficulty, perTeam: setup.perTeam, playerTeam: setup.team, loadout: { primary: cls.primary, secondary: cls.secondary, lethal: cls.lethal }, name: localStorage.getItem('codscape.name') || 'You' });
    me = game.player;
    vm = new ViewModel(Arena.TEAMS[me.team]?.hex ?? 0x6a6a6a); vm.resize(innerWidth / innerHeight); vm.scene.environment = gunEnv;
    let vi = 0;
    for (const f of game.fighters) {
      const team = f.team === 'zam' || f.team === 'sara' ? f.team : (f.id % 2 ? 'zam' : 'sara');
      const a = await Avatar.create(team, vi++);
      f.avatar = a; avatars.set(f, a); scene.add(a.group); a.setGun(f.gunner.w === WEAPONS[f.loadout.primary] ? f.loadout.primary : f.loadout.primary);
    }
    $('loading').style.display = 'none';
    inMatch = true; paused = false; deathCam = 0;
    input.enabled = true; sfx.start();
    if (input.device === 'kbm') input.lock();
    if (input.touch) input.touch.show(true);
    document.body.classList.add('playing');
    hud.message(game.mode.name, '#ff981f', TOUCH ? 'left thumb: move · drag right: aim · FIRE' : (game.modeId === 'ctf' ? "Take their standard from their tower. Bring it home." : game.mode.desc), 2.5);   // once, at the start
  }

  function endMatch() {
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
        if (e.e === 'mag-out') sfx.magOut(); else if (e.e === 'mag-in') sfx.magIn(); else if (e.e === 'bolt') sfx.bolt(); else if (e.e === 'cycle' && e.w.kind === 'pump') sfx.pump();
        else if (e.e === 'shell') sfx.shell(); else if (e.e === 'dry') sfx.dry(); else if (e.e === 'swap') sfx.swap(); else if (e.e === 'knife') sfx.knife(); else if (e.e === 'pin') sfx.pin();
        else if (e.e === 'cycle' && e.w.kind === 'bolt') setTimeout(() => sfx.bolt(), e.w.bolt * 300);
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
      case 'spawn': { const a = avatars.get(e.f); if (a) { a.revive(); a.setGun(e.f.loadout.primary); } if (e.f === me) { hud.dmgDirs.length = 0; } break; }
      case 'streak': if (e.f === me) { hud.message(e.s.name + ' READY', '#5f5', e.s.desc, 3); sfx.jingle(); } else if (game.mode.teams && e.f.team !== me.team) hud.message(`ENEMY ${e.s.name}`, '#f55', '', 2.5); else if (game.mode.teams) hud.message(`FRIENDLY ${e.s.name}`, '#5af', '', 2); break;
      case 'boom': {
        const s = e.ice ? 0x9fe0ff : 0xffb040;
        puff(e.p, s, e.r * 0.35, 0.35, new THREE.Vector3(), true); puff(e.p, 0x555048, e.r * 0.25, 1.2, new THREE.Vector3(0, 1.5, 0));
        for (let i = 0; i < 8; i++) puff(e.p, 0x3a3530, 0.25, 0.9, new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 7, (Math.random() - 0.5) * 8));
        const d = distOf(e.p); sfx.boom(d, panOf(e.p)); shake = Math.max(shake, Math.max(0, 1 - d / 25));
        break;
      }
      case 'bounce': if (distOf(e.p) < 20) sfx.bounce(); break;
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
      case 'end': hud.message(game.winner === 'draw' ? 'DRAW' : (game.mode.teams ? (game.winner === me.team ? 'VICTORY' : 'DEFEAT') : (game.winner === me ? 'VICTORY' : 'DEFEAT')), '#ff0', '', 6); input.unlock(); setTimeout(() => { if (game?.over) showEnd(); }, 3500); break;
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
  let last = performance.now(), fpsT = 0, frames = 0, swayT = 0, breath = 0, breathT = 0, prevYaw = 0, prevPitch = 0;
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); vm?.resize(w / h); hud.resize();
  }
  addEventListener('resize', resize); resize();

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!inMatch || !game) { renderer.clear(); renderer.render(scene, camera); idleCam(dt); return; }
    // adaptive resolution: hold ~55 fps
    fpsT += dt; frames++;
    if (fpsT > 2) { const fps = frames / fpsT; fpsT = 0; frames = 0; const want = fps < 45 ? Math.max(0.55, resScale - 0.1) : fps > 58 && resScale < 1 ? Math.min(1, resScale + 0.05) : resScale; if (want !== resScale) { resScale = want; renderer.setPixelRatio(dprBase * resScale); resize(); } }

    const G = me.gunner, w = G.w;
    const zoom = w.zoom || 1;
    const inp = input.read(dt, zoom, G.ads);
    if (inp.pause && !game.over) { setPaused(!paused); }
    if (paused) { draw(0, inp); return; }
    if (!me.alive && inp.respawn && me.respawnT <= 0) inp.respawn = true; else if (me.alive) inp.respawn = false;
    // hold breath while scoped (a few seconds, then you have to breathe)
    const scoped = w.scope && G.ads > 0.9;
    if (scoped && inp.breath && breathT < 4) { breath = 1; breathT += dt; } else { breath = 0; breathT = Math.max(0, breathT - dt * (scoped ? 0.5 : 2)); }
    if (scoped) inp.move.sprint = false;
    assist(inp, dt);
    game.step(dt, inp);
    for (const e of game.events) handle(e);
    game.events.length = 0;
    draw(dt, inp);
  }

  function setPaused(p) {
    paused = p;
    $('pause').style.display = p ? 'flex' : 'none';
    if (p) input.unlock(); else if (input.device === 'kbm') input.lock();
    if (input.touch) input.touch.show(!p);
  }

  function draw(dt, inp) {
    const G = me.gunner, w = G.w, b = me.body;
    // avatars
    for (const [f, a] of avatars) {
      if (!f.alive) { a.updateRag(dt); continue; }
      a.group.visible = f !== me;
      if (f === me) continue;
      if (a.gunId !== G.w && a.gunId !== f.gunner.g.id) a.setGun(f.gunner.g.id);
      a.update(dt, { pos: f.body.pos, yaw: f.body.yaw, pitch: f.body.pitch, vel: f.body.vel, crouch: f.body.crouch, onGround: f.body.onGround, sprinting: f.body.sprinting, reloading: f.gunner.reloading });
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
    hud.draw(dt, game, me, camera, { spreadPx, ads: G.ads, scope: scoped, scopeSway: sway, breath: scoped ? breath : undefined, board: inp.board, sprint: b.sprinting, aimedAt, touch: input.device === 'touch' });
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
          <button id="m-play">PLAY</button>
          <button id="m-class">CREATE A CLASS</button>
          <button id="m-settings">SETTINGS</button>
          <button id="m-controls" class="small">CONTROLS</button>
          <a href="index.html" class="small back">BACK TO RUNESKATE</a>
        </div>`;
      $('m-play').onclick = () => showMenu('play'); $('m-class').onclick = () => showMenu('class'); $('m-settings').onclick = () => showMenu('settings'); $('m-controls').onclick = () => showMenu('controls');
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
      const ci = setup.cls, c = classes[ci] || classes[0];
      const bars = id => { const s = stats(WEAPONS[id]); return `<div class="bars">${[['DAMAGE', s.dmg], ['RANGE', s.range], ['FIRE RATE', s.rate], ['MOBILITY', s.mob], ['HANDLING', s.hand]].map(([n, v]) => `<div class="bar"><span>${n}</span><i style="width:${Math.round(v * 100)}%"></i></div>`).join('')}</div>`; };
      const pick = (slot, list) => `<div class="seg wrap">${list.map(id => `<button data-slot="${slot}" data-v="${id}" class="${c[slot] === id ? 'sel' : ''}">${slot === 'lethal' ? LETHALS[id].name : WEAPONS[id].name}</button>`).join('')}</div>`;
      box.innerHTML = `<div class="title sm">CREATE A CLASS</div>
        <div class="seg">${classes.map((x, i) => `<button data-cls="${i}" class="${i === ci ? 'sel' : ''}">${x.name}</button>`).join('')}</div>
        <div class="lab2">PRIMARY · ${WEAPONS[c.primary].cls}</div>${pick('primary', PRIMARIES)}${bars(c.primary)}
        <div class="lab2">SECONDARY</div>${pick('secondary', SECONDARIES)}
        <div class="lab2">LETHAL</div>${pick('lethal', Object.keys(LETHALS))}
        <div class="col"><button id="m-reset" class="small">RESET CLASSES</button><button id="m-back" class="small">BACK</button></div>`;
      for (const b of box.querySelectorAll('[data-cls]')) b.onclick = () => { setup.cls = +b.dataset.cls; save(SETUP_KEY, setup); showMenu('class'); };
      for (const b of box.querySelectorAll('[data-slot]')) b.onclick = () => { c[b.dataset.slot] = b.dataset.v; save(CLASS_KEY, classes); showMenu('class'); };
      $('m-reset').onclick = () => { classes = DEFAULT_CLASSES.map(x => ({ ...x })); save(CLASS_KEY, classes); showMenu('class'); };
      $('m-back').onclick = () => showMenu(inMatch ? 'paused' : 'main');
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
      $('m-back').onclick = () => showMenu(inMatch ? 'paused' : 'main');
    } else if (page === 'controls') {
      box.innerHTML = `<div class="title sm">CONTROLS</div>
        <div class="keys"><b>WASD</b> move · <b>SHIFT</b> sprint (hold breath when scoped) · <b>SPACE</b> jump · <b>CTRL / C</b> crouch, slide out of a sprint<br>
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
  $('p-class').onclick = () => { $('pause').style.display = 'none'; showMenu('class'); $('menubox').querySelector('#m-back').onclick = () => { menu.style.display = 'none'; me.loadout = { ...classes[setup.cls] }; setPaused(true); hud.message('CLASS SET', '#ff0', 'next time you spawn', 2); }; };
  $('p-settings').onclick = () => { $('pause').style.display = 'none'; showMenu('settings'); $('menubox').querySelector('#m-back').onclick = () => { menu.style.display = 'none'; setPaused(true); }; };
  $('p-quit').onclick = () => { setPaused(false); endMatch(); };
  function showEnd() {
    input.unlock(); if (input.touch) input.touch.show(false);
    const e = $('endbox'); e.style.display = 'flex';
    const s = me; e.querySelector('.stats').textContent = `${s.kills} kills · ${s.deaths} deaths · ${s.assists} assists · ${s.score} score · accuracy ${Math.round(s.gunner.stats.hits / Math.max(1, s.gunner.stats.shots) * 100)}%`;
  }
  $('e-again').onclick = () => { $('endbox').style.display = 'none'; startMatch(); };
  $('e-menu').onclick = () => { $('endbox').style.display = 'none'; endMatch(); };

  $('loading').style.display = 'none';
  showMenu(new URLSearchParams(location.search).has('play') ? 'play' : 'main');
  requestAnimationFrame(frame);
  // test hook (headless screenshots)
  window.COD = { get game() { return game; }, startMatch, setup, arena, camera, showMenu, settings, get me() { return me; } };
  document.title = 'CODScape';
}

main().catch(e => { console.error(e); status('failed to load: ' + e.message); });
