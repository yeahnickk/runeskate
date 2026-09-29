// RuneSkate — skate Lumbridge. World + models are 1:1 exports from the game cache; collision is the
// server's own tile flags, so every wall, gate, door, tree and river bank blocks you like it does in-game.
import * as THREE from 'three';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { World } from './world.js';
import { Skater, P, TRICK_KEYS } from './skater.js';
import { loadRSModel, buildBoard, TOP_Z, DECK_Z } from './model.js';
import { RSFont, loadHitsplat, HUD } from './hud.js';
import { SkateAudio } from './audio.js';
import { Net } from './net.js';
import { levelFor } from './levels.js';
import { buildOutfitModel, loadKit } from './rsanim.js';
import { Designer } from './designer.js';
import { Goals } from './goals.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const FOG = 0xbcd1ea;
const status = t => { const el = document.getElementById('status'); if (el) el.textContent = t; };

// three coords: x = east, y = up, z = -north
const T = (x, y, z) => new THREE.Vector3(x, y, -z);

async function main() {
  status('loading world...');
  // start EVERY download now, in parallel: the world, the player/NPC models, fonts, hitsplats and the
  // outfit kit all stream together instead of queueing behind each other
  const pJson = fetch('assets/world.json').then(r => r.json());
  const pBin = fetch('assets/world.bin').then(r => r.arrayBuffer());
  const NPC_KINDS = ['goblin', 'cow', 'chicken', 'rat', 'imp', 'man', 'darkwizard'];
  const pModels = Promise.all([loadRSModel('nickai3'), ...NPC_KINDS.map(k => loadRSModel('npc_' + k))]);
  const pFonts = Promise.all([RSFont.load('b12'), RSFont.load('p12')]);
  const pHit = loadHitsplat();
  loadKit(0).catch(() => {});
  const wjson = await pJson;
  const world = new World(wjson);
  const bin = await pBin;
  status('building Lumbridge...');

  // resource friendly: no MSAA on hi-dpi screens, pixel ratio capped, ~60 fps cap, nothing drawn while hidden
  const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gl'), antialias: devicePixelRatio < 1.5, alpha: true, powerPreference: 'low-power' });
  const BASE_DPR = Math.min(devicePixelRatio, 1.25);
  renderer.setPixelRatio(BASE_DPR);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;     // RS colours are baked, show them 1:1
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG, 24, 62);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 110);

  // the world comes in CH x CH tile chunks (int16 RS units relative to the chunk corner); far chunks are
  // hidden each frame so a 256x256-tile map costs about what the old 104x104 one did
  const occluders = [], chunkMeshes = [], CH = wjson.index.chunk;
  const mats = {
    opaque: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    alpha: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.4, depthWrite: false }),
  };
  // skate lanes through the forests (tools/lanes.py): the trees on them lost their collision, so paint the
  // ground under them worn dirt so they read as "go this way"
  const laneS = new Float32Array(world.N * world.N);
  for (const [x, z, s] of wjson.lanes || []) laneS[z * world.N + x] = s;
  const laneAt = (x, z) => {                                 // bilinear over tile centres, smooth edges
    x -= 0.5; z -= 0.5;
    const x0 = Math.floor(x), z0 = Math.floor(z), u = x - x0, v = z - z0, N = world.N;
    const g = (a, b) => (a < 0 || b < 0 || a >= N || b >= N) ? 0 : laneS[b * N + a];
    return (g(x0, z0) * (1 - u) + g(x0 + 1, z0) * u) * (1 - v) + (g(x0, z0 + 1) * (1 - u) + g(x0 + 1, z0 + 1) * u) * v;
  };
  const DIRT = [118, 94, 62];
  function paintLanes(pos, col, ch) {
    for (let i = 0; i < pos.length / 3; i++) {
      const x = ch.cx * CH + pos[i * 3] / 128, z = ch.cz * CH + pos[i * 3 + 2] / 128;
      const s = laneAt(x, z); if (s <= 0.02) continue;
      const k = Math.min(1, s) * 0.75, n = ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1) * 14;
      for (let c = 0; c < 3; c++) col[i * 3 + c] = Math.max(0, Math.min(255, col[i * 3 + c] * (1 - k) + (DIRT[c] + n) * k));
    }
  }
  for (const ch of wjson.index.chunks) {
    for (const k of ['terrain', 'locs', 'locs_alpha']) {
      const part = ch[k]; if (!part || !part.n) continue;
      if (k === 'terrain' && wjson.lanes) paintLanes(new Int16Array(bin, part.posOff, part.n * 3), new Uint8Array(bin, part.colOff, part.n * 3), ch);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Int16Array(bin, part.posOff, part.n * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(bin, part.colOff, part.n * 3), 3, true));
      const alpha = k === 'locs_alpha';
      const m = new THREE.Mesh(g, alpha ? mats.alpha : mats.opaque);
      m.position.set(ch.cx * CH, 0, -ch.cz * CH); m.scale.set(1 / 128, -1 / 128, -1 / 128);
      m.updateMatrix(); m.matrixAutoUpdate = false;
      m.userData.c = [(ch.cx + 0.5) * CH, (ch.cz + 0.5) * CH];
      if (alpha) m.renderOrder = 1;
      scene.add(m); chunkMeshes.push(m);
      if (!alpha) occluders.push(m);             // BVH built lazily, only for chunks the camera gets near
    }
  }
  const nearOccluders = [], bvhQueue = [];
  function cullChunks(x, z) {
    nearOccluders.length = 0;
    for (const m of chunkMeshes) {
      const d = Math.max(Math.abs(m.userData.c[0] - x), Math.abs(m.userData.c[1] - z)) - CH / 2;
      // round, not square: anything past the fog is invisible anyway (the camera trails the skater ~5 tiles)
      const ex = Math.max(0, Math.abs(m.userData.c[0] - x) - CH / 2), ez = Math.max(0, Math.abs(m.userData.c[1] - z) - CH / 2);
      m.visible = Math.hypot(ex, ez) < scene.fog.far + 6;
      if (d < 12 && m.material === mats.opaque) {
        if (!m.geometry.boundsTree) m.geometry.computeBoundsTree();
        nearOccluders.push(m);
      } else if (d < 24 && m.material === mats.opaque && !m.geometry.boundsTree && !bvhQueue.includes(m)) bvhQueue.push(m);
    }
    // warm the next ring of chunks one per frame so crossing into them never hitches
    if (bvhQueue.length) { const m = bvhQueue.shift(); if (!m.geometry.boundsTree) m.geometry.computeBoundsTree(); }
  }

  // ---------------- minimap: the whole map rendered ONCE from straight above (north up), 2 px per tile
  status('drawing the map...');
  const miniMap = (() => {
    const N = world.N, PX = 2, S = N * PX;
    const rtm = new THREE.WebGLRenderTarget(S, S);
    const cam = new THREE.OrthographicCamera(0, N, 0, -N, 1, 600);
    cam.position.set(0, 400, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0);
    // after lookAt the view's +x is east and +y is north (-z): frame x 0..N, z 0..-N
    cam.left = 0; cam.right = N; cam.top = N; cam.bottom = 0; cam.updateProjectionMatrix();
    const fog = scene.fog; scene.fog = null;
    for (const m of chunkMeshes) m.visible = true;
    renderer.setRenderTarget(rtm); renderer.setClearColor(0x000000, 1); renderer.render(scene, cam);
    const px = new Uint8Array(S * S * 4); renderer.readRenderTargetPixels(rtm, 0, 0, S, S, px);
    renderer.setRenderTarget(null); renderer.setClearColor(0x000000, 0); scene.fog = fog; rtm.dispose();
    const c = document.createElement('canvas'); c.width = c.height = S;
    const im = c.getContext('2d').createImageData(S, S);
    for (let y = 0; y < S; y++) im.data.set(px.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);   // GL rows are bottom-up
    c.getContext('2d').putImageData(im, 0, 0);
    return { canvas: c, PX, N };
  })();
  status('loading skaters...');
  await pModels;
  let player = await loadRSModel('nickai3');
  scene.add(player.group);
  const board = buildBoard();
  scene.add(board.root);
  const [b12, p12] = await pFonts;
  const fonts = { b12, p12 };
  const hud = new HUD(document.getElementById('hud'), fonts, await pHit);
  const audio = new SkateAudio();

  // ---------------- NPCs you can take out: land on them from the air (STOMP, and you bounce) or ram them
  // at speed (SMACK). Real spawn spots from the game's map files; a slow touch just nudges them aside.
  const NPC_KIND = {
    goblin: { xp: 240, hp: 5, r: 0.55, h: 1.3 }, cow: { xp: 180, hp: 8, r: 0.9, h: 1.4 }, chicken: { xp: 60, hp: 3, r: 0.4, h: 0.6 },
    rat: { xp: 60, hp: 2, r: 0.4, h: 0.4 }, imp: { xp: 300, hp: 8, r: 0.5, h: 1.0 }, man: { xp: 250, hp: 7, r: 0.5, h: 1.8 },
    darkwizard: { xp: 400, hp: 12, r: 0.5, h: 1.8 },
  };
  const NPC_SPAWNS = {
    goblin: [[3141, 3258], [3142, 3230], [3145, 3229], [3183, 3244], [3187, 3246], [3244, 3245], [3247, 3247], [3250, 3238], [3252, 3228], [3255, 3222], [3258, 3245], [3260, 3233]],
    cow: [[3254, 3258], [3258, 3260], [3261, 3259], [3243, 3295], [3247, 3284], [3255, 3278], [3160, 3318], [3182, 3329]],
    chicken: [[3185, 3277], [3187, 3278], [3191, 3277], [3228, 3297], [3230, 3299], [3232, 3299], [3196, 3352], [3198, 3354]],
    rat: [[3100, 3273], [3229, 3223], [3232, 3229], [3236, 3222], [3319, 3250]],
    imp: [[3214, 3281], [3240, 3307], [3205, 3355], [3299, 3273]],
    man: [[3223, 3240], [3231, 3207], [3100, 3279], [3294, 3196]],
    // the stone circle south of Varrock, and the pair by Draynor
    darkwizard: [[3223, 3367], [3223, 3372], [3224, 3370], [3225, 3365], [3225, 3374], [3228, 3373], [3230, 3363], [3230, 3365], [3230, 3374], [3232, 3367], [3232, 3372], [3084, 3236], [3085, 3238]],
  };
  const npcs = [];
  for (const [kind, spots] of Object.entries(NPC_SPAWNS)) for (const [gx, gz] of spots) {
    const m = await loadRSModel('npc_' + kind);          // cached: already downloaded above
    scene.add(m.group);
    const x = gx - world.base[0] + 0.5, z = gz - world.base[1] + 0.5;
    npcs.push({ kind, ...NPC_KIND[kind], m, x, z, home: [x, z], dir: Math.random() * 6.28, walkT: 0, state: 'idle', t: 0 });
  }
  const goblins = npcs;                                     // (test hooks still say goblins)

  // ---------------- collision debug overlay (F3)
  const dbg = new THREE.Group(); dbg.visible = false; scene.add(dbg);
  {
    const colors = { wall: 0xff2020, rail: 0xffa000, fence: 0x40ffc0, door: 0xffff00, block: 0xb040ff, water: 0x2080ff, edge: 0xffffff };
    const byKind = {};
    for (const s of world.segs) {
      const arr = byKind[s.kind] ||= [];
      const hA = world.height(s.ax + 0.001, s.az + 0.001) + 0.04, hB = world.height(s.bx - 0.001, s.bz - 0.001) + 0.04;
      const tA = s.top ? s.top[0] : hA + 1.2, tB = s.top ? s.top[2] : hB + 1.2;
      arr.push(s.ax, hA, -s.az, s.bx, hB, -s.bz, s.ax, tA, -s.az, s.bx, tB, -s.bz, s.ax, hA, -s.az, s.ax, tA, -s.az);
    }
    for (const [k, arr] of Object.entries(byKind)) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      dbg.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: colors[k], depthTest: false, transparent: true, opacity: 0.85 })));
    }
  }

  // ---------------- fisheye (VX1000) post pass
  const rt = new THREE.WebGLRenderTarget(4, 4, { samples: 4 });
  const post = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: rt.texture }, aspect: { value: 1 }, k: { value: 0.32 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float aspect, k; varying vec2 vUv;
      void main(){
        vec2 p = (vUv - 0.5) * vec2(aspect, 1.0) * 2.0;
        float r2 = dot(p, p);
        float norm = 1.0 + k * aspect * aspect;
        vec2 q = p * (1.0 + k * r2) / norm;
        vec2 uv = q / vec2(aspect, 1.0) * 0.5 + 0.5;
        float edge = 1.0 - smoothstep(1.28, 1.42, length(p) / sqrt(aspect * aspect + 1.0) * 1.414);
        vec4 c = (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) ? vec4(0.0) : texture2D(tDiffuse, uv);
        if (c.a < 0.01) c = vec4(0.74, 0.82, 0.92, 1.0);
        gl_FragColor = vec4(c.rgb * edge * (1.0 - 0.25 * r2 / (aspect*aspect+1.0)), 1.0);
      }`,
    depthTest: false, depthWrite: false,
  }));
  const postScene = new THREE.Scene(); postScene.add(post);
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    rt.setSize(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    post.material.uniforms.aspect.value = w / h;
    hud.resize();
  }
  let needResize = false;                                  // applied at the next frame start, never between frames
  addEventListener('resize', () => { needResize = true; }); resize();

  // ---------------- input
  const keys = new Set(); let jumpEdge = false, pendingTrick = null, trickTimer = 0, anyEdge = false;
  const cfg = { help: false, cam: 0, camName: 'CHASE', debug: false };
  const CAMS = ['CHASE', 'VX FISHEYE', 'FILMER'];
  addEventListener('keydown', e => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (designer?.open) return;
    if (e.key === 'Enter' && net.online) { e.preventDefault(); openChat(); return; }
    if (e.key === 'Tab') { e.preventDefault(); if (!e.repeat) { hud.board = topNow(); refreshTop(); } }
    if (e.repeat) return;
    audio.start();
    const k = e.key.toLowerCase();
    keys.add(k); anyEdge = true;
    if (k === ' ') jumpEdge = true;
    const tricks = TRICK_KEYS;
    if (tricks[k]) { pendingTrick = tricks[k]; trickTimer = 0.18; }
    if (k === 'c') { cfg.cam = (cfg.cam + 1) % 3; cfg.camName = CAMS[cfg.cam]; filmer = null; }
    if (k === 'h') cfg.help = !cfg.help;
    if (k === 'o') { keys.clear(); designer.show(me.outfit, false); return; }
    if (k === 'e' && !sk.toggleWalk()) hud.pop('slow down to step off', '#f80');
    if (k === 'r') { sk.reset(world.spawn[0], world.spawn[1], Math.PI / 2); sk.score = 0; }
    if (k === 'f3' || k === 'g') { cfg.debug = !cfg.debug; dbg.visible = cfg.debug; }
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  });
  addEventListener('keyup', e => { keys.delete(e.key.toLowerCase()); if (e.key === 'Tab') hud.board = null; });
  addEventListener('blur', () => keys.clear());
  const down = (...ks) => ks.some(k => keys.has(k));
  function readInput(first) {
    if (first) pollPad();
    let steer = (down('a', 'arrowleft') ? 1 : 0) - (down('d', 'arrowright') ? 1 : 0);
    if (!steer && pad.on) steer = pad.steer;
    const inp = {
      steer, fwd: Math.cos(sk.heading) * camDir.x + Math.sin(sk.heading) * camDir.y >= 0 ? 1 : -1, push: down('w', 'arrowup') || (pad.on && pad.push), brake: down('s', 'arrowdown') || (pad.on && pad.brake), jump: down(' '),
      jumpPressed: first && jumpEdge, slide: down('shift') || (pad.on && pad.slide), manual: down('q') || (pad.on && pad.manual), trick: null, anyKey: first && anyEdge,
    };
    if (first && flick) { if (sk.mode === 'ground' && sk.charge < 0) inp.flickPop = flick.power; if (flick.trick) { pendingTrick = flick.trick; trickTimer = 0.3; } flick = null; }
    if (pendingTrick && sk.mode === 'air') { inp.trick = pendingTrick; pendingTrick = null; }
    return inp;
  }

  // ---------------- flick-it (Skate style): hold the left mouse button, pull DOWN to wind up, flick UP to pop.
  // Straight up = ollie, up-left = kickflip, up-right = heelflip, flick sideways = shove-it; a second flick
  // in the air throws a trick. Double-length flicks do the double / 360 versions.
  let flick = null, gest = null;
  const gl = document.getElementById('gl');
  gl.addEventListener('pointerdown', e => { if (e.button !== 0 || designer?.open) return; audio.start(); gest = { low: e.clientY, lowX: e.clientX, x0: e.clientX, y0: e.clientY }; });
  addEventListener('pointermove', e => { if (gest && e.clientY > gest.low) { gest.low = e.clientY; gest.lowX = e.clientX; } });
  addEventListener('pointerup', e => {
    if (!gest) return;
    const g = gest; gest = null;
    const s = Math.min(innerWidth, innerHeight) / 100;             // gesture units: % of the short screen side
    const up = (g.low - e.clientY) / s, dx = (e.clientX - g.lowX) / s, wind = (g.low - g.y0) / s;
    const res = classifyFlick(up, dx, (e.clientX - g.x0) / s, wind);
    if (res) flick = res;
  });
  function classifyFlick(up, dx, side, wind) {
    let trick = null;
    if (up < 6) {                                                  // no real upward flick: sideways = shove-it
      if (Math.abs(side) > 12) trick = Math.abs(side) > 30 ? 'shove360' : 'shove'; else return null;
    } else if (Math.abs(dx) > up * 0.45) {
      const big = Math.hypot(dx, up) > 38;
      trick = dx < 0 ? (big ? 'double' : 'kickflip') : (big ? 'doubleheel' : 'heelflip');
      if (Math.abs(dx) > up * 1.6) trick = dx < 0 ? (big ? 'tre' : 'varial') : 'hardflip';
    }
    return { power: Math.max(0.2, Math.min(1, (wind + up) / 40)), trick };
  }

  // ---------------- gamepad (standard mapping): left stick steer, A push, B brake, X powerslide, Y walk/ride,
  // LT/RT manual (ground) or grab (air), BACK camera; right stick = flick-it exactly like the mouse
  const pad = { steer: 0, push: false, brake: false, slide: false, manual: false, prev: [], rs: null };
  function pollPad() {
    const gp = [...(navigator.getGamepads?.() || [])].find(g => g && g.connected);
    if (!gp) { pad.on = false; return; }
    pad.on = true;
    const b = i => !!gp.buttons[i]?.pressed, edge = i => b(i) && !pad.prev[i];
    const lx = gp.axes[0] || 0, rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
    pad.steer = Math.abs(lx) > 0.2 ? -lx : 0;
    pad.push = b(0); pad.brake = b(1); pad.slide = b(2); pad.manual = b(6) || b(7) || b(4) || b(5);
    if (edge(3) && !sk.toggleWalk()) hud.pop('slow down to step off', '#f80');
    if (edge(8)) { cfg.cam = (cfg.cam + 1) % 3; cfg.camName = CAMS[cfg.cam]; filmer = null; }
    if (b(0) || b(1) || Math.hypot(rx, ry) > 0.5) { audio.start(); anyEdge = true; }
    // right stick: wind down, flick up (units ~ the mouse's % of screen: full throw = 50)
    const r = pad.rs;
    if (!r && ry > 0.55) pad.rs = { low: ry, x0: rx, lowX: rx, t: 0 };
    else if (r) {
      r.t++;
      if (ry > r.low) { r.low = ry; r.lowX = rx; }
      if (ry < -0.55) { const res = classifyFlick((r.low - ry) * 25, (rx - r.lowX) * 40, 0, r.low * 20); if (res) flick = res; pad.rs = null; }
      else if (Math.hypot(rx, ry) < 0.25 || r.t > 60) pad.rs = null;
    }
    // in the air a sideways flick from centre throws a trick without the wind-up
    if (sk.mode === 'air' && !pad.rs && Math.abs(rx) > 0.8 && !pad.airFlick) { pad.airFlick = true; pendingTrick = rx < 0 ? 'kickflip' : 'heelflip'; trickTimer = 0.3; }
    if (Math.hypot(rx, ry) < 0.3) pad.airFlick = false;
    pad.prev = gp.buttons.map(x => x.pressed);
  }

  // ---------------- skater
  const sk = new Skater(world);
  window.RS = { sk, world, keys, cfg, camera, THREE, scene, P, goblins };
  window.RS.remotes = () => remotes; window.RS.hud = () => hud;
  // ---------------- login + multiplayer
  const net = new Net();
  const me = { name: 'offline', xp: 0 };
  window.RS.net = net; window.RS.me = me;
  // leaderboard: kept warm in the background so holding TAB shows it instantly (a fetch per press went out
  // through the tunnel and back, which read as TAB being slow); your own row always shows your live XP
  let top = [], topAt = 0;
  function refreshTop() {
    if (performance.now() - topAt < 3000) return;
    topAt = performance.now();
    fetch('/api/top').then(r => r.json()).then(t => { top = t; if (keys.has('tab')) hud.board = topNow(); }).catch(() => {});
  }
  function topNow() {
    const rows = top.map(r => ({ ...r }));
    if (me.name !== 'offline') {
      const mine = rows.find(r => r.name === me.name);
      if (mine) { mine.xp = Math.max(mine.xp, me.xp); mine.on = true; } else rows.push({ name: me.name, xp: me.xp, runes: window.RS.goals?.found?.size || 0, spots: window.RS.goals?.done?.size || 0, on: true });
    }
    return rows.sort((a, b) => b.xp - a.xp).slice(0, 15);
  }
  setInterval(() => { if (net.online) refreshTop(); }, 20000);
  const qs = new URLSearchParams(location.search);
  const $ = id => document.getElementById(id);
  if (qs.get('name')) $('lname').value = qs.get('name');
  if (qs.get('password')) $('lpass').value = qs.get('password');
  async function login(offline) {
    audio.start();
    const name = $('lname').value.trim(), pass = $('lpass').value;
    if (!offline) {
      if (!name) { $('lerr').textContent = 'pick a name (or skate solo)'; return; }
      $('lerr').textContent = 'connecting...';
      try {
        const w = await net.connect(name, pass);
        me.name = w.name; me.xp = w.xp; me.outfit = w.outfit; me.prog = w.prog; me.isNew = w.isNew || !w.outfit;
        const q = new URLSearchParams(location.search); q.set('name', w.name); q.delete('password');
        history.replaceState(null, '', '?' + q.toString() + location.hash);
      } catch (err) { $('lerr').textContent = err.message; return; }
    }
    $('start').style.display = 'none';
    if (!offline) { store.set('rs_name', me.name); if (pass) store.set('rs_pass', pass); }
    await window.RS.onLogin?.(me);
  }
  $('skate').onclick = () => login(false);
  $('solo').onclick = () => login(true);
  for (const id of ['lname', 'lpass']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') login(false); });
  // just visiting the URL logs you in: a random skater name is made up once and remembered in this browser
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const rnd = (n, abc) => Array.from(crypto.getRandomValues(new Uint32Array(n)), x => abc[x % abc.length]).join('');
  function freshIdentity() {
    const who = ['Skater', 'Grinder', 'Ollie', 'Kickflip', 'Shredder', 'Rider', 'Deck'][Math.floor(Math.random() * 7)];
    const name = (who + rnd(4, '0123456789')).slice(0, 12), pass = rnd(14, 'abcdefghjkmnpqrstuvwxyz23456789');
    store.set('rs_name', name); store.set('rs_pass', pass); return [name, pass];
  }
  async function autoLogin() {
    if (qs.get('name') && qs.get('password')) return login(false);
    let name = store.get('rs_name'), pass = store.get('rs_pass');
    if (!name || !pass) [name, pass] = freshIdentity();
    $('lname').value = name; $('lpass').value = pass;
    await login(false);
    if ($('start').style.display !== 'none' && /wrong password/.test($('lerr').textContent)) {   // name got taken: roll a new one
      [name, pass] = freshIdentity(); $('lname').value = name; $('lpass').value = pass; await login(false);
    }
  }
  window.RS.autoLogin = autoLogin;

  // ---------------- outfits: any armour from the game on your own skater (see designer.js / rsanim.js)
  window.RS.modelFor = o => (o && o.items) ? buildOutfitModel(o) : loadRSModel('nickai3');
  let wearing = 0;
  async function wearOutfit(o) {
    const n = ++wearing, m = await window.RS.modelFor(o);
    if (n !== wearing) return;                              // a newer preview already won
    scene.remove(player.group); player = m; scene.add(m.group);
  }
  var designer = new Designer({
    onPreview: o => wearOutfit(o),
    onSave: o => { me.outfit = o; wearOutfit(o); net.setOutfit(o); hud.pop('LOOKING SHARP', '#0f0'); },
  });
  window.RS.designer = designer;

  // ---------------- XP (points = total XP) and the things-to-do layer
  function addXP(n) {
    const before = levelFor(me.xp); me.xp += n; if (me.name !== 'offline') net.addXP(n);
    const after = levelFor(me.xp);
    if (after > before) { hud.pop(`LEVEL ${after}!`, '#0f0'); audio.event({ type: 'levelup' }); }
  }
  const localProg = () => { try { return JSON.parse(localStorage.getItem('rs_prog') || 'null'); } catch { return null; } };
  const goals = new Goals({ scene, world, sk, hud, audio, reward: addXP, save: p => {
    if (me.name !== 'offline') net.prog(p);
    try { localStorage.setItem('rs_prog', JSON.stringify({ found: [...goals.found], done: [...goals.done] })); } catch {}
  } });
  goals.load(localProg());
  window.RS.goals = goals;
  window.RS.onLogin = async who => {
    if (who.prog) goals.load(who.prog);
    refreshTop();
    if (who.outfit) await wearOutfit(who.outfit);
    if (who.isNew && net.online) { keys.clear(); designer.show(who.outfit, true); }
  };

  // remote skaters: interpolate toward the last relayed state
  const remotes = new Map();
  const say = new Map();                                   // id -> {text, t}
  const chatLog = [];
  async function addRemote(p) {
    if (remotes.has(p.id)) return;
    const r = { id: p.id, name: p.name, xp: p.xp, outfit: p.outfit, s: null, tgt: p.st, m: null, board: buildBoard() };
    remotes.set(p.id, r);
    r.m = await (window.RS.modelFor ? window.RS.modelFor(p.outfit) : loadRSModel('nickai3'));
    if (!remotes.has(p.id)) return;
    scene.add(r.m.group); scene.add(r.board.root);
  }
  function dropRemote(id) { const r = remotes.get(id); if (!r) return; remotes.delete(id); if (r.m) scene.remove(r.m.group); scene.remove(r.board.root); if (r.shadow) scene.remove(r.shadow); }
  async function reskin(id, outfit) {
    const r = remotes.get(id); if (!r || !window.RS.modelFor) return;
    const m = await window.RS.modelFor(outfit);
    if (!remotes.has(id)) return;
    if (r.m) scene.remove(r.m.group);
    r.m = m; scene.add(m.group);
  }
  net.on('join', p => { addRemote(p); chatLog.push({ text: p.name + ' rolled in.', col: '#0ff', t: 0 }); })
     .on('leave', m => { const r = remotes.get(m.id); if (r) chatLog.push({ text: r.name + ' left.', col: '#0ff', t: 0 }); dropRemote(m.id); })
     .on('st', m => { const r = remotes.get(m.id); if (r) r.tgt = m.s; })
     .on('xp', m => { const r = remotes.get(m.id); if (r) r.xp = m.xp; })
     .on('outfit', m => reskin(m.id, m.outfit))
     .on('say', m => { say.set(m.id, { text: m.text, t: 0 }); chatLog.push({ text: m.name + ': ' + m.text, col: '#ff0', t: 0 }); })
     .on('kicked', () => { chatLog.push({ text: 'Logged in somewhere else - disconnected.', col: '#f00', t: 0 }); })
     .on('closed', () => { chatLog.push({ text: 'Connection lost - reconnecting...', col: '#f00', t: 0 }); for (const id of [...remotes.keys()]) dropRemote(id); })
     .on('rejoined', w => { me.xp = Math.max(me.xp, w.xp); chatLog.push({ text: 'Reconnected.', col: '#0f0', t: 0 }); });
  const SNAP = ['x', 'y', 'z', 'heading', 'body', 'boardYaw', 'boardRoll', 'charge', 'airTime', 'pushing', 'tumble', 'tumbleAxis', 'speed'];
  function snapshot() {
    const o = { mode: sk.mode, gk: sk.grindKind, sl: sk.slide ? 1 : 0, w: sk.inWater ? 1 : 0 };
    for (const k of SNAP) o[k] = Math.round((sk[k] || 0) * 1000) / 1000;
    if (sk.mode === 'bail' && sk.board) o.b = [sk.board.x, sk.board.y, sk.board.z, sk.board.yaw, sk.board.roll].map(v => Math.round(v * 1000) / 1000);
    return o;
  }
  const wrapA = a => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  function updateRemotes(dt) {
    const k = 1 - Math.exp(-dt * 12);
    for (const r of remotes.values()) {
      const t = r.tgt; if (!t || !r.m) continue;
      if (!r.s || Math.hypot(t.x - r.s.x, t.z - r.s.z) > 6) r.s = { ...t, board: { x: t.x, y: t.y, z: t.z, yaw: 0, roll: 0 } };
      const s = r.s;
      for (const f of ['x', 'y', 'z', 'charge', 'airTime', 'pushing', 'tumble', 'speed']) s[f] += (t[f] - s[f]) * k;
      for (const f of ['heading', 'body', 'boardYaw', 'boardRoll', 'tumbleAxis']) s[f] = wrapA(s[f] + wrapA(t[f] - s[f]) * k);
      s.mode = t.mode; s.grindKind = t.gk; s.slide = !!t.sl; s.inWater = !!t.w;
      if (t.b) s.board = { x: t.b[0], y: t.b[1], z: t.b[2], yaw: t.b[3], roll: t.b[4] };
      drawRider(dt, s, r.m, r.board);
      r.shadow ||= makeShadow(); placeShadow(r.shadow, s.x, s.y, s.z, true);
    }
  }
  // chat: Enter opens a one-line box
  function openChat() {
    const box = $('chatbox'); if (box.style.display === 'block') return;
    box.style.display = 'block'; box.value = ''; box.focus(); keys.clear();
  }
  $('chatbox').addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { const t = e.target.value.trim(); if (t) net.send({ t: 'say', text: t }); }
    if (e.key === 'Enter' || e.key === 'Escape') { e.target.style.display = 'none'; e.target.blur(); }
  });


  // ---------------- camera rig
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  let camDir = new THREE.Vector2(0, 1), filmer = null, shake = 0; const lastCam = [0, 0];
  const ray = new THREE.Raycaster(); ray.firstHitOnly = true;
  function unblock(from, to, pad = 0.35) {
    const d = to.clone().sub(from), L = d.length();
    ray.set(from, d.normalize()); ray.far = L;
    const hit = ray.intersectObjects(nearOccluders, false)[0];
    return hit ? from.clone().addScaledVector(d, Math.max(0.3, hit.distance - pad)) : to;
  }
  function updateCamera(dt, first) {
    cullChunks(sk.x, sk.z);
    if (Math.hypot(sk.x - lastCam[0], sk.z - lastCam[1]) > 3) { camDir.set(Math.cos(sk.heading), Math.sin(sk.heading)); first = true; }   // respawn/teleport: snap in behind the board
    lastCam[0] = sk.x; lastCam[1] = sk.z;
    const tgt = T(sk.x, sk.y + 1.15, sk.z);
    const v = new THREE.Vector2(sk.vx, sk.vz);
    if (sk.mode === 'walk') camDir.lerp(new THREE.Vector2(Math.cos(sk.heading), Math.sin(sk.heading)), 1 - Math.exp(-dt * 4)).normalize();   // on foot: camera behind where you face
    else if (sk.mode !== 'bail' && v.length() > 0.8) camDir.lerp(v.normalize(), 1 - Math.exp(-dt * 3.2)).normalize();
    else if (sk.mode !== 'bail' && sk.speed < 0.3) {
      // stopped: settle onto the board's axis but never swing round to the other end (that flipped the controls)
      const hx = Math.cos(sk.heading), hz = Math.sin(sk.heading), sg = hx * camDir.x + hz * camDir.y >= 0 ? 1 : -1;
      camDir.lerp(new THREE.Vector2(hx * sg, hz * sg), 1 - Math.exp(-dt * 1.5)).normalize();
    }
    let want, look = tgt.clone(), fov = 62;
    if (designer.open) {
      // slow orbit; aim a little to the skater's side so they stand in the open right half of the screen
      const a = performance.now() / 1000 * 0.35, wide = innerWidth > 600 ? 0.9 : 0;
      want = T(sk.x + Math.cos(a) * 3.4, sk.y + 1.4, sk.z + Math.sin(a) * 3.4);
      look = T(sk.x + Math.sin(a) * wide, sk.y + 0.95, sk.z - Math.cos(a) * wide); fov = 50;
    } else if (cfg.cam === 0) {
      want = T(sk.x - camDir.x * 4.6, sk.y + 2.2, sk.z - camDir.y * 4.6);
      look = T(sk.x + camDir.x * 1.5, sk.y + 0.9, sk.z + camDir.y * 1.5);
    } else if (cfg.cam === 1) {
      want = T(sk.x - camDir.x * 1.7, sk.y + 0.55, sk.z - camDir.y * 1.7);
      look = T(sk.x, sk.y + 0.7, sk.z); fov = 100;
    } else {
      const far = filmer && Math.hypot(filmer.x - sk.x, filmer.z - sk.z);
      if (!filmer || far > 13 || far < 1.5) {
        const side = Math.random() < 0.5 ? 1 : -1;
        const fx = sk.x + camDir.x * 7 - camDir.y * 3.5 * side, fz = sk.z + camDir.y * 7 + camDir.x * 3.5 * side;
        filmer = { x: fx, z: fz, y: world.height(fx, fz) + 1.3 };
      }
      want = T(filmer.x, filmer.y, filmer.z); fov = 42;
    }
    want = unblock(tgt, want);
    const k = first ? 1 : 1 - Math.exp(-dt * (cfg.cam === 2 ? 30 : 7));
    camPos.lerp(want, k); camLook.lerp(look, first ? 1 : 1 - Math.exp(-dt * 10));
    // never let the lens dip under the ground
    const gh = world.height(camPos.x, -camPos.z) + 0.25;
    if (camPos.y < gh) camPos.y = gh;
    camera.position.copy(camPos);
    if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; shake *= Math.exp(-dt * 9); }
    camera.lookAt(camLook);
    if (camera.fov !== fov) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix(); }
  }

  // ---------------- blob shadows (read the height of a jump) + grind sparks
  const shadowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  function makeShadow() { const m = new THREE.Mesh(shadowGeo, shadowMat); m.renderOrder = 2; scene.add(m); return m; }
  const myShadow = makeShadow();
  function placeShadow(m, x, y, z, visible) {
    const g = world.height(x, z), h = Math.max(0, y - g);
    m.visible = visible; if (!visible) return;
    const s = 0.9 * Math.max(0.45, 1 - h * 0.25);
    m.position.set(x, g + 0.02, -z); m.scale.set(s, 1, s);
    m.material.opacity = 1;
  }
  const sparks = [], sparkMat = new THREE.SpriteMaterial({ color: 0xffd060, fog: true });
  function spark(x, y, z, vx, vz) {
    let s = sparks.find(p => !p.s.visible);
    if (!s) { if (sparks.length > 60) return; s = { s: new THREE.Sprite(sparkMat) }; s.s.scale.set(0.07, 0.07, 1); scene.add(s.s); sparks.push(s); }
    s.s.visible = true; s.t = 0.35; s.x = x; s.y = y; s.z = z;
    s.vx = -vx * 0.3 + (Math.random() - 0.5) * 2; s.vz = -vz * 0.3 + (Math.random() - 0.5) * 2; s.vy = 1 + Math.random() * 2;
  }
  function updateSparks(dt) {
    if (sk.mode === 'grind' && Math.random() < dt * 40) spark(sk.x, sk.y + 0.05, sk.z, sk.vx, sk.vz);
    for (const p of sparks) if (p.s.visible) {
      p.t -= dt; if (p.t <= 0) { p.s.visible = false; continue; }
      p.vy -= 12 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.s.position.set(p.x, p.y, -p.z);
    }
  }

  // ---------------- draw the skater + board from the physics state
  const up = new THREE.Vector3(0, 1, 0);
  let airClipDone = false;
  function drawSkater(dt) { drawRider(dt, sk, player, board); }
  function drawRider(dt, sk, m, board) {
    let clip = 'sidestep', yawOff = -Math.PI / 2, loop = true;
    if (sk.mode === 'walk') { clip = sk.walking === 2 ? 'run' : sk.walking ? 'walk' : 'ready'; yawOff = Math.PI / 2; }
    else if (sk.mode === 'air') { clip = 'spot_jump'; loop = false; yawOff = Math.PI; }   // spot_jump's rest pose faces +z; π puts it side-on like the sidestep stance (screenshot-verified)
    else if (sk.mode === 'grind') { clip = 'balance'; yawOff = sk.grindKind === 'Boardslide' ? -Math.PI / 2 : 0; }
    else if (sk.mode === 'bail') { clip = sk.inWater ? 'falling' : 'falling'; loop = false; }
    m.play(clip, loop);
    m.update(dt);
    const [fx, fz] = m.footOffset(m.cur);
    // board transform
    let by = sk.y, byaw = sk.heading + sk.boardYaw, broll = sk.boardRoll, bpitch = 0;
    if (sk.mode === 'air' && sk.airTime < 0.18) bpitch = 0.45 * (1 - sk.airTime / 0.18);
    if (sk.mode === 'ground' && sk.manual) bpitch = 0.22 * sk.manual;                  // tail (or nose) down
    if (sk.mode === 'air' && sk.grab) { bpitch = 0.3; broll = (sk.grab === 'Melon' || sk.grab === 'Stalefish' ? -0.35 : 0.35); }
    if (sk.mode === 'grind') by = sk.grindKind === 'Boardslide' ? sk.y - DECK_Z + 0.01 : sk.y - 0.035;
    if (sk.mode === 'ground' && sk.slide) byaw = sk.body;
    if (sk.mode === 'bail') {
      const b = sk.board; board.root.position.copy(T(b.x, b.y, b.z));
      board.root.rotation.set(0, b.yaw, 0); board.roll.rotation.x = b.roll; board.pitch.rotation.z = 0;
    } else {
      board.root.position.copy(T(sk.x, by, sk.z));
      board.root.rotation.set(0, byaw, 0); board.roll.rotation.x = broll; board.pitch.rotation.z = bpitch;
    }
    // player transform: feet on the deck
    const yaw = sk.body + yawOff;
    const crouch = sk.charge >= 0 && sk.mode === 'ground' ? 0.12 * sk.charge : (sk.mode === 'air' && sk.grab ? 0.22 : 0);
    const bob = sk.pushing > 0 ? Math.sin((0.35 - sk.pushing) / 0.35 * Math.PI) * 0.05 : 0;
    let py = sk.mode === 'bail' ? sk.y : by + TOP_Z - crouch - bob;
    if (sk.mode === 'air') py = sk.y + TOP_Z + Math.max(0, Math.sin(Math.min(1, sk.airTime / 0.5) * Math.PI)) * 0.05;
    board.root.visible = sk.mode !== 'walk';               // board tucked away while walking
    const g = m.group;
    g.rotation.set(0, yaw, 0);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const ox = fx * c + fz * s, oz = -fx * s + fz * c;       // rotate the foot offset by the model yaw
    g.position.set(sk.x - ox, py, -sk.z - oz);
    g.scale.set(1, 1 - crouch * 0.9, 1);
    if (sk.mode === 'bail' && !sk.inWater) {
      // tumble: tip over along the travel direction
      const ax = new THREE.Vector3(Math.sin(sk.tumbleAxis), 0, Math.cos(sk.tumbleAxis));
      g.quaternion.setFromAxisAngle(ax, -sk.tumble * Math.PI / 2 * 0.95).multiply(new THREE.Quaternion().setFromAxisAngle(up, yaw));
      g.position.y = sk.y + 0.15 * sk.tumble;
    }
    if (sk.mode === 'bail' && sk.inWater) g.position.y = sk.y;
  }

  // ---------------- NPC wander + contact
  function npcBlocked(nx, nz, home, r) {
    if (world.tileKind(nx, nz) !== 0 || Math.hypot(nx - home[0], nz - home[1]) > 4) return true;
    for (const sg of world.segsNear(nx, nz, 1)) { const t = Math.max(0, Math.min(1, ((nx - sg.ax) * sg.dx + (nz - sg.az) * sg.dz) / (sg.len * sg.len))); if (Math.hypot(nx - sg.ax - sg.dx * t, nz - sg.az - sg.dz * t) < Math.min(0.45, r)) return true; }
    return false;
  }
  function killNpc(n, how) {
    n.state = 'dead'; n.t = 0; n.m.play('death', false, true);
    const stomp = how === 'stomp';
    const pts = Math.round(n.xp * (stomp ? 1.5 : 1));
    hud.splats.push({ gob: n, t: 0, n: n.hp });
    const label = n.kind === 'darkwizard' ? 'DARK WIZARD' : n.kind.toUpperCase();
    sk.addCombo(label + (stomp ? ' STOMP' : ' SMACK'), pts);
    shake = stomp ? 0.15 : 0.25; audio.event({ type: stomp ? 'stomp' : 'smack' });
    if (stomp) { sk.vy = Math.max(sk.vy, 6.5); sk.airTime = 0.2; }          // bounce off them
    goals.event({ type: 'kill', npc: n.kind, how });
  }
  function updateGoblins(dt) {
    for (const n of npcs) {
      n.t += dt;
      const d2 = Math.hypot(sk.x - n.x, sk.z - n.z);
      n.m.group.visible = d2 < 70 && !(n.state === 'dead' && n.t > 2.5);
      if (n.state === 'dead') {
        if (d2 < 70) n.m.update(dt);
        if (n.t > 20) { n.state = 'idle'; n.t = 0; n.x = n.home[0]; n.z = n.home[1]; }  // respawn
        continue;
      }
      if (d2 > 70) continue;                                // far away: frozen and hidden
      n.walkT -= dt;
      if (n.walkT <= 0) { n.walkT = 1.5 + Math.random() * 3; n.moving = Math.random() < 0.6; n.dir += (Math.random() - 0.5) * 2.5; }
      if (n.moving) {
        const nx = n.x + Math.cos(n.dir) * dt * 0.9, nz = n.z + Math.sin(n.dir) * dt * 0.9;
        if (!npcBlocked(nx, nz, n.home, n.r)) { n.x = nx; n.z = nz; } else n.dir += Math.PI * (0.5 + Math.random());
      }
      n.m.play(n.moving ? 'walk' : 'ready');
      n.m.update(dt);
      // contact with the skater
      const gy = world.height(n.x, n.z);
      if (sk.mode !== 'bail' && d2 < n.r + 0.3) {
        const above = sk.y - gy;
        if (sk.mode === 'air' && sk.vy < 1 && above > n.h * 0.35 && above < n.h + 0.9) killNpc(n, 'stomp');
        else if (sk.mode !== 'walk' && sk.speed > 2.4 && above < n.h) killNpc(n, 'ram');
        else if (above < n.h) {                            // slow bump: shove them aside, no harm done
          const ux = (n.x - sk.x) / (d2 || 1), uz = (n.z - sk.z) / (d2 || 1);
          const nx = sk.x + ux * (n.r + 0.31), nz = sk.z + uz * (n.r + 0.31);
          if (!npcBlocked(nx, nz, n.home, n.r)) { n.x = nx; n.z = nz; }
        }
      }
    }
    for (const n of npcs) {
      if (!n.m.group.visible) continue;
      n.m.group.position.set(n.x, world.height(n.x, n.z), -n.z);
      const face = n.state === 'dead' ? Math.atan2(sk.z - n.z, sk.x - n.x) : n.dir;
      n.m.group.rotation.set(0, face + Math.PI / 2, 0);
    }
  }

  // ---------------- events -> hud / audio / camera
  const BAIL_TEXT = {
    wall: ['Oh dear, you are dead!', 'Hit a wall'], water: ['Glug glug...', 'You swam with the fishes'],
    rocks: ['Crunch!', 'You ate the rocks'],
    flip: ['Oh dear, you are dead!', 'Over-rotated the flip'], sketchy: ['Oh dear, you are dead!', 'Landed sideways'],
    slam: ['Oh dear, you are dead!', 'Hard slam'], balance: ['Oh dear, you are dead!', 'Fell off the rail'],
    goblin: ['Oh dear, you are dead!', 'Tripped over a goblin'],
  };
  function handleEvents() {
    for (const e of sk.events) {
      window.RS.eventsLog.push(e.type + (e.why ? ':' + e.why : '') + (e.name ? ':' + e.name : '') + (e.kind ? ':' + e.kind : ''));
      if (window.RS.eventsLog.length > 200) window.RS.eventsLog.shift();
      audio.event(e); goals.event(e);
      if (e.type === 'trick') hud.pop(e.name + '  ' + e.pts, '#fff');
      if (e.type === 'grind') hud.pop(e.kind, '#ff981f');
      if (e.type === 'grab') hud.pop(e.kind + ' Grab', '#0ff');
      if (e.type === 'manual') hud.pop(sk.manual < 0 ? 'Nose Manual' : 'Manual', '#0ff');
      if (e.type === 'bail') {
        const [a, b] = BAIL_TEXT[e.why] || BAIL_TEXT.wall;
        hud.big(a, '#ff0000', b + (sk.lostCombo ? `  (lost ${Math.round(sk.lostCombo)})` : ''), 2.6);
        shake = e.why === 'water' ? 0.1 : 0.35;
      }
      if (e.type === 'banked' && e.total > 0) {
        hud.big(`+${e.total.toLocaleString()}`, '#ffff00', `${e.n} trick combo`, 1.5);
        addXP(e.total);
      }
      if (e.type === 'land' && e.impact > 7) shake = Math.max(shake, 0.06);
    }
    sk.events.length = 0;
  }

  // ---------------- loop
  status('');
  document.getElementById('loading').style.display = 'none';
  if (!location.hash.includes('nostart')) {
    document.getElementById('start').style.display = 'flex';
    window.RS.autoLogin();              // straight in; the panel only stays up if the server can't be reached
  }
  let last = performance.now(), acc = 0, first = true;
  const DT = 1 / 240;
  const v = new THREE.Vector3();
  window.RS.eventsLog = [];
  function tick(dt) {
    if (trickTimer > 0 && (trickTimer -= dt) <= 0 && sk.mode !== 'air') pendingTrick = null;
    acc += dt;
    let firstStep = true;
    while (acc >= DT) {
      sk.step(DT, readInput(firstStep)); sk.tickCombo(DT);
      if (firstStep) { jumpEdge = false; anyEdge = false; }
      firstStep = false; acc -= DT;
    }
    handleEvents();
    updateGoblins(dt);
    placeShadow(myShadow, sk.x, sk.y, sk.z, sk.mode !== 'bail' || !sk.inWater);
    updateSparks(dt);
    goals.update(dt, camera);
    drawSkater(dt);
    updateRemotes(dt);
    net.state(snapshot(), performance.now());
    updateCamera(dt, first); first = false;
    audio.update(sk);
    for (const s of hud.splats) {
      v.set(s.gob.x, world.height(s.gob.x, s.gob.z) + 1.3, -s.gob.z).project(camera);
      s.screen = v.z < 1 ? [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight] : null;
    }
    if (cfg.cam === 1) {
      renderer.setRenderTarget(rt); renderer.setClearColor(FOG, 1); renderer.render(scene, camera);
      renderer.setRenderTarget(null); renderer.setClearColor(0, 1); renderer.render(postScene, postCam);
      renderer.setClearColor(0, 0);
    } else renderer.render(scene, camera);
    hud.tags.length = 0;
    const tag = (x, y, z, text, col, sub) => { v.set(x, y, -z).project(camera); if (v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2) hud.tags.push({ text, col, sub, screen: [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight] }); };
    for (const r of remotes.values()) if (r.s && Math.hypot(r.s.x - sk.x, r.s.z - sk.z) < 14) {   // tags only for skaters near you
      const said = say.get(r.id);
      tag(r.s.x, r.s.y + 2.35, r.s.z, `${r.name} (level-${levelFor(r.xp)})`, '#fff', said ? said.text : null);
    }
    for (const [id, m] of say) { m.t += dt; if (m.t > 5) say.delete(id); }
    const mine = net.me && say.get(net.me.id);
    if (mine) tag(sk.x, sk.y + 2.35, sk.z, '', '#fff', mine.text);
    hud.chat = chatLog; hud.me = me; hud.online = null; hud.mini = miniMap;
    hud.miniDots.length = 0;
    hud.miniDots.push(...goals.dots());
    for (const r of remotes.values()) if (r.s) hud.miniDots.push({ x: r.s.x, z: r.s.z, col: '#fff', r: 2 });
    hud.goal = goals.status();
    hud.draw(dt, sk, cfg);
  }
  // adaptive resolution: if frames run long for a second, render fewer pixels (down to 55%); step back up
  // once there's headroom. Keeps slower laptops smooth without making fast machines look worse.
  // A canvas resize blanks the drawing buffer, so the change is only APPLIED at the start of a frame, right
  // before it is drawn (applying it after the render showed one empty frame = a white flicker). Changes
  // are also rare: down after 2 slow seconds in a row, up only after 10 good ones.
  let resScale = 1, perfT = 0, perfN = 0, perfSum = 0, goodT = 0, badT = 0, pendingRes = 0;
  function adaptResolution(frameMs, dt) {
    perfT += dt; perfN++; perfSum += frameMs;
    if (perfT < 1) return;
    const avg = perfSum / perfN; perfT = perfN = perfSum = 0;
    let next = resScale;
    if (avg > 22) { goodT = 0; if (++badT >= 2 && resScale > 0.56) { next = Math.max(0.55, resScale * 0.85); badT = 0; } }
    else if (avg < 17.5 && resScale < 1) { badT = 0; if (++goodT >= 10) { next = Math.min(1, resScale / 0.85); goodT = 0; } }
    else { goodT = 0; badT = 0; }
    if (next !== resScale) pendingRes = next;
  }
  window.RS.res = () => resScale;
  function frame(now) {
    requestAnimationFrame(frame);
    if (now - last < 15.5 || document.hidden) return;       // ~60 fps cap (high-refresh screens would double the work)
    const gap = now - last;
    const dt = Math.min(0.1, gap / 1000); last = now;
    if (pendingRes) { resScale = pendingRes; pendingRes = 0; renderer.setPixelRatio(BASE_DPR * resScale); needResize = true; }
    if (needResize) { needResize = false; resize(); }
    if (!window.RS.paused) { tick(dt); if (gap < 250) adaptResolution(gap, dt); }
  }
  // test hook: step the game synchronously with scripted keys, e.g.
  //   RS.advance(1.5, t => t < 1 ? ['w'] : ['w', ' '])
  window.RS.advance = (secs, keysAt = () => [], fps = 60) => {
    window.RS.paused = true;
    const log = [];
    for (let i = 0; i < secs * fps; i++) {
      const want = new Set(keysAt(i / fps));
      for (const k of want) if (!keys.has(k)) { keys.add(k); anyEdge = true; if (k === ' ') jumpEdge = true; const tr = TRICK_KEYS[k]; if (tr) { pendingTrick = tr; trickTimer = 0.18; } }
      for (const k of [...keys]) if (!want.has(k)) keys.delete(k);
      const n0 = sk.events.length;
      tick(1 / fps);
      void n0;
      log.push(sk.mode);
    }
    keys.clear();
    const s = sk;
    return { x: +(s.x + world.base[0]).toFixed(2), z: +(s.z + world.base[1]).toFixed(2), y: +s.y.toFixed(2), mode: s.mode, speed: +s.speed.toFixed(2), score: s.score, combo: s.combo.slice(), modes: [...new Set(log)] };
  };
  // test hook: composite the GL frame + HUD right after a tick and POST it to serve.ts (test/shots/<name>.png)
  window.RS.shot = async (name) => {
    tick(0);
    const c = document.createElement('canvas'); c.width = renderer.domElement.width; c.height = renderer.domElement.height;
    const x = c.getContext('2d');
    const sky = x.createLinearGradient(0, 0, 0, c.height); sky.addColorStop(0, '#2a5cc8'); sky.addColorStop(0.38, '#6f9be0'); sky.addColorStop(0.62, '#bcd1ea');
    x.fillStyle = sky; x.fillRect(0, 0, c.width, c.height); x.drawImage(renderer.domElement, 0, 0); x.drawImage(hud.c, 0, 0, c.width, c.height);
    await fetch('/__shot/' + name, { method: 'POST', body: c.toDataURL('image/png') });
    return name;
  };
  requestAnimationFrame(frame);
}

main().catch(e => { console.error(e); status('error: ' + e.message); });
