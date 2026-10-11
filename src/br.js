// RuneRoyale: the battle royale mode on the client. V (or the BATTLE ROYALE button, or ::br in chat) queues you;
// online the server runs the match (src/br-core.js in serve.ts), offline the same match runs right here in the
// browser with bots. You ride the King Black Dragon over Lumbridge, jump, skydive and surf down on your board,
// loot chests, shoot, build, smash anything in the world, and outlast the storm.
//
// Controls (keyboard + mouse): WASD move (relative to the camera), mouse aim (click to lock it), left click
// fire / use / place, right click aim down sights, SPACE jump (and jump off the dragon / open the glider),
// SHIFT sprint, 1-6 hotbar (1 = pickaxe), wheel cycles, R reload (rotates a ramp in build mode), E open /
// pick up, Q wall, F floor, C ramp, V roof (again or 1-6 = back to weapons), T material, G edit a wall
// (door), B board on / off, M map, TAB scores, ESC menu (leave). Phones get their own buttons.
import {
  BR, WEAPONS, RARITY, HEALS, MATS, MAT_ORDER, BUILD_COST, MAT_MAX, OBJ_MAT, BRMatch, stormAt, busAt, pieceKey, addPiece, removePiece,
  breakInWorld, restoreWorld, segObjKey, treeKey, tileKey, segDist, lineBlock, itemName,
} from './br-core.js';

const SLOTS = 6;                         // 0 = the pickaxe, 1-5 = what you carry
const BUILD_KEYS = { q: 'wall', f: 'floor', c: 'ramp', v: 'cone' };
const PIECE_NAME = { wall: 'WALL', floor: 'FLOOR', ramp: 'RAMP', cone: 'ROOF' };
const W_HEAD = { smg: 1.5, ar: 1.6, shotgun: 1.5, sniper: 2.5, rocket: 1, pick: 1 };
const BOT_SNAP = { x: 0, y: 0, z: 0, heading: 0, body: 0, boardYaw: 0, boardRoll: 0, charge: -1, airTime: 1, pushing: 0, tumble: 0, tumbleAxis: 0, speed: 0, manual: 0, lean: 0, balance: 0, vy: -5, grabT: 0, mode: 'walk', gk: '', gr: '', sl: 0, w: 0, wk: 0, fa: 0, fk: 0, em: 0 };
const fmtT = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
body.inbr #social { display: none !important; }
#brbtn { position: fixed; left: 50%; bottom: 58px; transform: translateX(-50%); z-index: 6; display: none; align-items: center; gap: 8px;
  padding: 6px 14px 6px 8px; font: bold 14px monospace; color: #fff; background: rgba(120,30,140,.85); border: 2px solid #f6c;
  border-radius: 6px; box-shadow: 0 0 14px rgba(255,90,220,.5), 3px 3px 0 #000; cursor: pointer; user-select: none; -webkit-user-select: none; touch-action: manipulation; }
#brbtn kbd { font: bold 12px monospace; color: #000; background: #f6c; border-radius: 3px; padding: 2px 6px; }
#brbtn.touch kbd { display: none; }
#brlobby { position: fixed; left: 50%; top: 12px; transform: translateX(-50%); z-index: 7; display: none; padding: 10px 16px; font: 14px monospace; color: #fff;
  background: rgba(40,10,50,.9); border: 2px solid #f6c; box-shadow: 3px 3px 0 #000; text-align: center; max-width: calc(100vw - 32px); }
#brlobby b { color: #f6c; font-size: 16px; } #brlobby button { margin-top: 8px; }
#brtint { position: fixed; inset: 0; z-index: 2; pointer-events: none; background: radial-gradient(ellipse at center, rgba(120,40,200,.15), rgba(110,20,190,.55)); opacity: 0; transition: opacity .4s; }
#brhurt { position: fixed; inset: 0; z-index: 2; pointer-events: none; box-shadow: inset 0 0 120px 30px rgba(220,0,0,.8); opacity: 0; }
#brscope { position: fixed; inset: 0; z-index: 2; pointer-events: none; display: none; background: radial-gradient(circle at center, transparent 0, transparent 30vmin, #000 30.5vmin); }
#brscope:before, #brscope:after { content: ''; position: absolute; background: #000; }
#brscope:before { left: 50%; top: 20vh; bottom: 20vh; width: 2px; } #brscope:after { top: 50%; left: 30vw; right: 30vw; height: 2px; }
#brmenu, #brover { position: fixed; inset: 0; z-index: 9; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,.55); font-family: monospace; }
#brmenu .box, #brover .box { background: rgba(30,24,16,.95); border: 3px solid #5a4a2a; box-shadow: 4px 4px 0 #000; padding: 18px 22px; text-align: center; color: #fff; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); overflow: auto; }
#brmenu button { display: block; width: 100%; margin: 8px 0; font-size: 15px; padding: 10px; }
#brover h1 { margin: 0 0 4px; font: bold 34px monospace; color: #ffd23a; text-shadow: 3px 3px 0 #000; letter-spacing: 2px; }
#brover h2 { margin: 0 0 12px; font: bold 18px monospace; color: #fff; }
#brover table { margin: 0 auto 12px; border-collapse: collapse; font-size: 13px; } #brover td { padding: 2px 8px; text-align: left; }
#brtouch { position: fixed; inset: 0; z-index: 3; pointer-events: none; display: none; -webkit-user-select: none; user-select: none; }
#brtouch .zone { position: absolute; pointer-events: auto; touch-action: none; }
#brtouch .stick { left: 0; top: 30%; bottom: 0; width: 40%; } #brtouch .look { right: 0; top: 0; bottom: 0; width: 60%; }
#brtouch .base { position: absolute; width: 110px; height: 110px; margin: -55px 0 0 -55px; border-radius: 50%; border: 3px solid rgba(255,255,255,.35); background: rgba(0,0,0,.18); display: none; }
#brtouch .nub { position: absolute; left: 50%; top: 50%; width: 50px; height: 50px; margin: -25px 0 0 -25px; border-radius: 50%; background: rgba(255,120,240,.6); border: 2px solid #000; }
#brtouch .b { position: absolute; pointer-events: auto; touch-action: none; display: grid; place-items: center; text-align: center; border-radius: 50%;
  font: bold 11px monospace; color: #fff; background: rgba(60,20,70,.6); border: 2px solid #c6f; }
#brtouch .b.on { background: rgba(255,120,240,.8); color: #000; }
`;

export class BattleRoyale {
  constructor(c) {
    this.c = c;
    const { THREE } = c;
    this.T = (x, y, z) => new THREE.Vector3(x, y, -z);
    this.state = 'idle';                  // idle | queue | live | over
    this.keys = new Set();
    this.yaw = 0; this.pitch = 0; this.firing = false; this.fireEdge = false; this.ads = false;
    this.group = new THREE.Group(); this.group.visible = false; c.scene.add(this.group);
    this.buildGroup = new THREE.Group(); this.group.add(this.buildGroup);
    this.ray = new THREE.Raycaster(); this.ray.firstHitOnly = true;
    this.fx = []; this.proj = []; this.undos = []; this.flat = new Map();
    this.players = new Map();
    this.mkAssets();
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
    const el = (id, html = '', tag = 'div') => { const e = document.createElement(tag); e.id = id; e.innerHTML = html; document.body.appendChild(e); return e; };
    this.btn = el('brbtn', '<kbd>V</kbd><span>BATTLE ROYALE</span>');
    if (c.TOUCH) this.btn.classList.add('touch');
    const stop = e => e.stopPropagation();
    for (const ev of ['pointerdown', 'touchstart', 'mousedown']) this.btn.addEventListener(ev, stop, { passive: true });
    this.btn.addEventListener('click', e => { e.stopPropagation(); this.queue(); });
    this.lobbyEl = el('brlobby');
    this.tint = el('brtint'); this.hurtEl = el('brhurt'); this.scopeEl = el('brscope');
    this.menuEl = el('brmenu', '<div class="box"><h2 style="color:#f6c;margin:0 0 8px">RUNEROYALE</h2><button data-a="back">Back to the match</button><button data-a="leave">Leave the match</button></div>');
    this.menuEl.addEventListener('click', e => { const a = e.target.dataset?.a; if (a === 'back') this.showMenu(false); if (a === 'leave') { this.showMenu(false); this.exit(true); } });
    this.overEl = el('brover');
    this.overEl.addEventListener('click', e => { if (e.target.dataset?.a === 'done') this.exit(); });
    for (const x of [this.lobbyEl, this.menuEl, this.overEl]) for (const ev of ['pointerdown', 'touchstart', 'mousedown']) x.addEventListener(ev, stop, { passive: true });
    if (c.TOUCH) this.mkTouch();
    // mouse: aim, fire, sights
    const gl = c.renderer.domElement;
    gl.addEventListener('mousedown', e => {
      if (!this.live || c.TOUCH) return;
      if (document.pointerLockElement !== gl) { try { gl.requestPointerLock(); } catch {} if (e.button === 0) return; }
      if (e.button === 0) { this.firing = true; this.fireEdge = true; }
      if (e.button === 2) this.ads = true;
    });
    addEventListener('mouseup', e => { if (e.button === 0) this.firing = false; if (e.button === 2) this.ads = false; });
    addEventListener('mousemove', e => {
      if (!this.live || document.pointerLockElement !== gl) return;
      const k = (this.ads ? 0.0011 : 0.0022) * (this.scoped ? 0.35 : 1);
      this.yaw -= e.movementX * k; this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - e.movementY * k));
    });
    gl.addEventListener('contextmenu', e => { if (this.active) e.preventDefault(); });
    addEventListener('wheel', e => { if (!this.live || this.c.hud.chatOpen) return; this.cycle(e.deltaY > 0 ? 1 : -1); }, { passive: true });
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) { this.firing = false; this.ads = false; } });
  }
  get active() { return this.state === 'live' || this.state === 'over'; }
  get live() { return this.state === 'live'; }
  get alive() { return this.live && this.ph !== 'dead'; }

  // ================================================================== assets
  mkAssets() {
    const { THREE } = this.c;
    const tex = draw => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; draw(cv.getContext('2d')); const t = new THREE.CanvasTexture(cv); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t; };
    const look = {
      wood: x => { x.fillStyle = '#9a6a3a'; x.fillRect(0, 0, 64, 64); for (let i = 0; i < 4; i++) { x.fillStyle = i % 2 ? '#8a5c30' : '#a87444'; x.fillRect(0, i * 16 + 1, 64, 14); x.fillStyle = '#5a3a1a'; x.fillRect(0, i * 16, 64, 1); x.fillRect((i * 23) % 64, i * 16, 1, 16); } },
      stone: x => { x.fillStyle = '#8a8a8e'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#5e5e64'; for (let r = 0; r < 4; r++) { x.fillRect(0, r * 16, 64, 2); for (let c = 0; c < 3; c++) x.fillRect(((c * 24) + (r % 2) * 12) % 64, r * 16, 2, 16); } },
      metal: x => { x.fillStyle = '#6a7a8e'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#4a5666'; x.fillRect(0, 31, 64, 2); x.fillRect(31, 0, 2, 64); x.fillStyle = '#c8d4e0'; for (const [a, b] of [[6, 6], [56, 6], [6, 56], [56, 56], [26, 26], [36, 36]]) x.fillRect(a, b, 3, 3); },
    };
    this.pieceMats = {};
    for (const m of MAT_ORDER) {
      const t = tex(look[m]);
      this.pieceMats[m] = [1, 0.75, 0.5].map(k => new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(k, k, k), side: THREE.DoubleSide }));
    }
    this.ghostOk = new THREE.MeshBasicMaterial({ color: 0x55aaff, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide });
    this.ghostBad = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide });
    const basic = (col, o = {}) => new THREE.MeshBasicMaterial({ color: col, ...o });
    this.mat = {
      chest: basic(0x7a4a1c), band: basic(0xd8b040), open: basic(0x3a2410), ammo: basic(0x4a6a2a), crate: basic(0x2a5ab0), balloon: basic(0xe03030),
      stone: basic(0x777777), beam: RARITY.map(r => new THREE.MeshBasicMaterial({ color: r.col, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending })),
      storm: new THREE.MeshBasicMaterial({ color: 0x9a3ae0, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, fog: false }),
      tracer: { def: new THREE.LineBasicMaterial({ color: 0xfff2a0, transparent: true, opacity: 0.9 }), shotgun: new THREE.LineBasicMaterial({ color: 0xc080ff, transparent: true, opacity: 0.9 }) },
      fire: basic(0xff7020, { transparent: true, opacity: 0.9 }), boom: basic(0xffa040, { transparent: true, opacity: 0.8, depthWrite: false }),
      dust: basic(0x9a8a70), heal: Object.fromEntries(Object.entries(HEALS).map(([k, h]) => [k, basic(new THREE.Color(h.col))])),
      ammoBox: basic(0x8a8a6a), matBox: Object.fromEntries(MAT_ORDER.map(m => [m, basic(MATS[m].col)])),
    };
    this.geo = { box: new THREE.BoxGeometry(1, 1, 1), sphere: new THREE.SphereGeometry(1, 12, 8), beam: new THREE.CylinderGeometry(0.06, 0.06, 1, 6, 1, true) };
    this.storm = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 96, 1, true), this.mat.storm);
    this.storm.renderOrder = 3; this.group.add(this.storm);
    this.held = new THREE.Group(); this.group.add(this.held);
  }
  box(w, h, d, mat, x = 0, y = 0, z = 0) { const m = new this.c.THREE.Mesh(this.geo.box, mat); m.scale.set(w, h, d); m.position.set(x, y, z); return m; }
  /** a held / dropped weapon: forward is +x */
  weaponMesh(w) {
    const { THREE } = this.c, g = new THREE.Group(), col = new THREE.MeshBasicMaterial({ color: WEAPONS[w].col }), wood = new THREE.MeshBasicMaterial({ color: 0x6a4420 });
    if (w === 'pick') { g.add(this.box(0.7, 0.05, 0.05, wood, 0.1, 0, 0), this.box(0.06, 0.45, 0.07, col, 0.42, 0, 0)); }
    else if (w === 'smg' || w === 'sniper') {
      const L = w === 'sniper' ? 1 : 0.75;
      for (const s of [1, -1]) { const b = this.box(0.05, L / 2, 0.05, col, 0.06, s * L / 4, 0); b.rotation.z = s * 0.35; g.add(b); }
      const str = this.box(0.01, L * 0.95, 0.01, new THREE.MeshBasicMaterial({ color: 0xeeeeee }), -0.06, 0, 0); g.add(str);
    } else if (w === 'ar') { g.add(this.box(0.6, 0.08, 0.08, wood, 0, 0, 0), this.box(0.06, 0.05, 0.6, col, 0.25, 0.02, 0), this.box(0.2, 0.05, 0.05, col, 0.32, 0.06, 0)); }
    else { g.add(this.box(1.1, 0.05, 0.05, w === 'rocket' ? wood : col, 0.15, 0, 0)); const o = new THREE.Mesh(this.geo.sphere, w === 'rocket' ? this.mat.fire : new THREE.MeshBasicMaterial({ color: 0xb070ff })); o.scale.setScalar(0.09); o.position.x = 0.72; g.add(o); }
    return g;
  }

  // ================================================================== lobby
  showBtn(on) { this.btn.style.display = on && this.state !== 'live' && this.state !== 'over' ? 'flex' : 'none'; }
  queue() {
    const c = this.c;
    if (this.active) return;
    if (this.state === 'queue') { c.net.send({ t: 'br', op: 'unjoin' }); this.state = 'idle'; this.lobbyEl.style.display = 'none'; c.say('Left the RuneRoyale queue.', '#f6c'); return; }
    c.audio.start?.();
    if (c.net.online) {
      c.net.send({ t: 'br', op: 'join' }); this.state = 'queue';
      this.lobby = { n: 1, secs: BR.LOBBY };
      this.drawLobby();
      c.say('Queued for RuneRoyale. Keep skating, the match starts shortly (bots fill the empty spots).', '#f6c');
    } else this.startLocal();
  }
  drawLobby() {
    const l = this.lobby; if (!l) return;
    this.lobbyEl.style.display = this.state === 'queue' ? 'block' : 'none';
    this.lobbyEl.innerHTML = `<b>RUNEROYALE</b><br>${l.n} player${l.n === 1 ? '' : 's'} queued &middot; ${l.running ? 'a match is on, you are in the next one' : `starts in ${Math.max(0, Math.ceil(l.secs))}s`}<br><small>bots fill the lobby to ${BR.SIZE}</small><br><button class="small">LEAVE QUEUE</button>`;
    this.lobbyEl.querySelector('button').onclick = () => this.queue();
  }
  /** offline / solo: the whole match runs here */
  startLocal() {
    const c = this.c;
    c.say('Starting a solo RuneRoyale against bots...', '#f6c');
    // the match shares this page's collision world: it builds and breaks it, this side only draws the result
    this.inbox = []; this.shared = true;
    this.local = new BRMatch({ world: c.world, send: (to, msg, except) => { if ((to == null || to === 'me') && except !== 'me') this.inbox.push(msg); } });
    this.local.join('me', c.me.name === 'offline' ? 'You' : c.me.name, { outfit: c.me.outfit || null });
    this.local.fillBots(); this.local.start();
    this.drain();
  }
  drain() { if (!this.inbox) return; while (this.inbox.length) this.rx(this.inbox.shift()); }
  tx(m) { if (this.local) this.local.msg('me', m); else this.c.net.send({ t: 'br', ...m }); }

  // ================================================================== messages from the match
  rx(m) {
    const c = this.c;
    switch (m.op) {
      case 'lobby': if (this.state === 'queue') { this.lobby = m; this.drawLobby(); } break;
      case 'start': this.begin(m); break;
      case 'bots': this.onBots(m); break;
      case 'hp': this.onHp(m); break;
      case 'elim': this.onElim(m); break;
      case 'items': for (const o of m.list) this.addItem(o); break;
      case 'gone': this.onGone(m); break;
      case 'opened': { const ch = this.chests?.get(m.k); if (ch) { ch.open = true; this.chestLook(ch); if (Math.hypot(ch.x - c.sk.x, ch.z - c.sk.z) < 25) c.audio.event({ type: 'chest' }); } break; }
      case 'chest': this.addChest(m.c); if (this.live) { c.hud.big('SUPPLY DROP', '#4af', 'a crate is coming down inside the circle', 2.2); } break;
      case 'built': this.onBuilt(m.p); break;
      case 'phit': { const p = this.pieces?.get(m.id); if (p) { p.hp = m.hp; this.pieceLook(p); } break; }
      case 'pgone': for (const id of m.ids) this.dropPiece(id); break;
      case 'edited': { const p = this.pieces?.get(m.id); if (p) { if (!this.shared) removePiece(c.world, p); p.e = m.e; if (!this.shared) addPiece(c.world, p); this.pieceLook(p, true); } break; }
      case 'broken': this.onBroken(m); break;
      case 'fx': this.onFx(m); break;
      case 'over': this.onOver(m); break;
      case 'left': if (this.state === 'queue') { this.state = 'idle'; this.lobbyEl.style.display = 'none'; } break;
    }
  }

  begin(m) {
    const c = this.c, { THREE } = c, sk = c.sk;
    if (this.active && !this.local) this.cleanup();
    this.state = 'live'; this.lobbyEl.style.display = 'none';
    this.t = 0; this.plan = m.plan; this.bus = m.bus; this.arena = m.arena;
    this.myId = this.local ? 'me' : c.net.me?.id;
    this.players = new Map(m.players.map(p => [p.id, { ...p, hp: BR.HP, sh: 0, alive: true, kills: 0 }]));
    this.hp = BR.HP; this.sh = 0; this.kills = 0; this.ph = 'bus'; this.myPlace = 0;
    this.slots = [{ t: 'w', w: 'pick' }, null, null, null, null, null]; this.sel = 0;
    this.ammo = {}; this.mats = { wood: 0, stone: 0, metal: 0 }; this.matSel = 'wood';
    this.buildMode = null; this.rampRot = 0; this.reloadT = 0; this.fireT = 0; this.useT = 0; this.using = null; this.recoil = 0;
    this.pending = new Set(); this.feed = []; this.hurtT = 0; this.hitT = 0; this.dmgDir = [];
    this.pieces = new Map(); this.slotIds = new Map(); this.items = new Map(); this.chests = new Map();
    this.undos = []; this.flat = new Map(); this.spec = null; this.showMap = false; this.boardOn = false;
    this.group.visible = true;
    for (const ch of m.chests) this.addChest(ch);
    for (const o of m.items) this.addItem(o);
    // bots show up like any other skater
    for (const p of this.players.values()) if (p.bot) c.addRemote({ id: p.id, name: p.name, outfit: p.outfit, st: { ...BOT_SNAP, hide: 1 } });
    // the dragon
    this.kbd = null;
    c.loadRSModel('npc_kbd').then(md => { if (!this.active) return; this.kbd = md; md.group.scale.setScalar(2.6); c.scene.add(md.group); }).catch(() => {});
    const at = busAt(this.bus, 0);
    sk.reset(at.x, at.z, at.heading); sk.mode = 'walk'; sk.y = at.y;
    this.yaw = at.heading; this.pitch = -0.25; this.vx = this.vz = this.vy = 0; this.air = false;
    c.teleports.show?.(false);
    if (c.touch) { c.touch.on = false; c.touch.show(false); }
    if (this.touchEl) this.touchEl.style.display = 'block';
    c.hud.big('RUNEROYALE', '#f6c', c.TOUCH ? 'tap JUMP to leave the dragon' : 'SPACE: jump off the dragon · click to aim', 3, true);
    c.say(`RuneRoyale: ${this.players.size} in the match. Last one standing wins. ${c.TOUCH ? '' : 'Q/F/C/V build, E loot, B board, M map, ESC menu.'}`, '#f6c');
    c.audio.event({ type: 'levelup' });
  }

  addChest(ch) {
    const { THREE } = this.c, g = new THREE.Group();
    if (ch.kind === 'ammo') g.add(this.box(0.8, 0.45, 0.45, this.mat.ammo, 0, 0.22, 0), this.box(0.82, 0.08, 0.47, this.mat.band, 0, 0.36, 0));
    else if (ch.sd) {
      g.add(this.box(1.3, 1.1, 1.3, this.mat.crate, 0, 0.55, 0), this.box(1.32, 0.12, 1.32, this.mat.band, 0, 0.8, 0));
      const b = new THREE.Mesh(this.geo.sphere, this.mat.balloon); b.scale.set(1.1, 1.4, 1.1); b.position.y = 4.2; b.name = 'balloon'; g.add(b);
      const beam = new THREE.Mesh(this.geo.beam, this.mat.beam[2]); beam.scale.set(2.5, 30, 2.5); beam.position.y = 15; beam.name = 'beam'; g.add(beam);
    } else {
      g.add(this.box(0.95, 0.5, 0.6, this.mat.chest, 0, 0.25, 0));
      const lid = new THREE.Group(); lid.position.set(0, 0.5, 0.3); lid.add(this.box(0.97, 0.22, 0.62, this.mat.chest, 0, 0.11, -0.31), this.box(0.99, 0.06, 0.64, this.mat.band, 0, 0.1, -0.31)); lid.name = 'lid'; g.add(lid);
    }
    g.position.copy(this.T(ch.x, ch.y, ch.z));
    g.rotation.y = (ch.x * 7.3 + ch.z * 3.1) % 6.283;
    this.group.add(g);
    const o = { ...ch, g };
    this.chests.set(ch.k, o);
    if (ch.open) this.chestLook(o);
  }
  chestLook(ch) {
    const lid = ch.g.getObjectByName('lid'); if (lid) lid.rotation.x = -1.6;
    ch.g.traverse(m => { if (m.isMesh && m.material === this.mat.chest) m.material = this.mat.open; });
    const b = ch.g.getObjectByName('beam'); if (b) b.visible = false;
  }
  addItem(o) {
    const { THREE } = this.c, g = new THREE.Group(), it = o.it;
    let m;
    if (it.t === 'w') { m = this.weaponMesh(it.w); m.scale.setScalar(1.2); if (it.r >= 1) { const b = new THREE.Mesh(this.geo.beam, this.mat.beam[it.r]); b.scale.set(1, 2.2 + it.r * 0.5, 1); b.position.y = 1; g.add(b); } }
    else if (it.t === 'h') m = this.box(0.35, 0.25, 0.25, this.mat.heal[it.h]);
    else if (it.t === 'a') m = this.box(0.3, 0.2, 0.2, this.mat.ammoBox);
    else m = this.box(0.4, 0.25, 0.4, this.mat.matBox[it.m]);
    m.position.y = 0.35; m.name = 'spin'; g.add(m);
    g.position.copy(this.T(o.x, o.y, o.z));
    this.group.add(g);
    this.items.set(o.id, { ...o, g });
  }
  onGone(m) {
    const o = this.items.get(m.id); if (!o) return;
    this.group.remove(o.g); this.items.delete(m.id); this.pending.delete(m.id);
    if (m.by === this.myId && this.alive) this.take(o.it);
  }
  /** an item is yours: into the right pocket (a full hotbar swaps out what you're holding) */
  take(it) {
    const c = this.c; c.audio.event({ type: 'pickup' });
    if (it.t === 'a') { this.ammo[it.a] = Math.min(999, (this.ammo[it.a] || 0) + it.n); return; }
    if (it.t === 'm') { this.mats[it.m] = Math.min(MAT_MAX, this.mats[it.m] + it.n); return; }
    if (it.t === 'h') {
      const same = this.slots.find(s => s && s.t === 'h' && s.h === it.h && s.n < HEALS[it.h].stack);
      if (same) { const add = Math.min(it.n, HEALS[it.h].stack - same.n); same.n += add; if (it.n > add) this.tx({ op: 'drop', it: { ...it, n: it.n - add } }); return; }
    }
    let i = this.slots.findIndex((s, k) => k > 0 && !s);
    if (i < 0) { i = this.sel > 0 ? this.sel : 1; this.tx({ op: 'drop', it: this.slots[i] }); }
    this.slots[i] = { ...it };
    if (it.t === 'w' && (this.sel === 0 || !this.slots[this.sel])) this.select(i);
    c.hud.pop(itemName(it).toUpperCase(), it.t === 'w' ? RARITY[it.r].col : '#fff');
  }

  onBots(m) {
    const c = this.c;
    if (Math.abs(m.mt - this.t) > 0.6) this.t = m.mt; else this.t += (m.mt - this.t) * 0.2;
    this.aliveN = m.n;
    for (const [id, x, y, z, h, md, wk, w] of m.b) {
      const r = c.remotes.get(id); if (!r) continue;
      r.tgt = { ...BOT_SNAP, x, y, z, heading: h, body: h, mode: md === 2 ? 'air' : 'walk', wk, fa: md === 1 ? 1 : 0, hide: md === 0 ? 1 : 0, bw: w, br: 1 };
    }
  }
  /** where a player is right now (you, a bot, a person) */
  posOf(id) {
    if (id === this.myId) return this.c.sk;
    const r = this.c.remotes.get(id); return r?.s || r?.tgt || null;
  }
  onHp(m) {
    const c = this.c, p = this.players.get(m.id);
    if (p) { p.hp = m.hp; p.sh = m.sh; }
    if (m.id === this.myId) {
      const was = this.hp + this.sh; this.hp = m.hp; this.sh = m.sh;
      if (m.d > 0) {
        this.hurtT = Math.min(1, this.hurtT + 0.25 + m.d / 80);
        c.audio.event({ type: this.sh > 0 ? 'shieldhit' : 'hurt' });
        const a = m.by != null && this.posOf(m.by);
        if (a) this.dmgDir.push({ a: Math.atan2(a.z - c.sk.z, a.x - c.sk.x), t: 1.2 });
        if (m.w === 'storm' && was > this.hp + this.sh) c.hud.pop('THE STORM HURTS', '#c6f');
        if (this.useT > 0) { this.useT = 0; this.using = null; }
      }
    } else if (m.by === this.myId && m.d > 0) {
      const at = this.posOf(m.id);
      if (at) c.hud.splats.push({ gob: { x: at.x, z: at.z }, t: 0, n: m.d });
      this.hitT = 0.25; this.hitHd = !!m.hd; c.audio.event({ type: 'hitmark', hd: m.hd });
    }
  }
  onElim(m) {
    const c = this.c, p = this.players.get(m.id);
    if (p) { p.alive = false; p.deadAt = performance.now(); p.place = m.place; }
    const k = m.by != null ? this.players.get(m.by) : null; if (k) k.kills = (k.kills || 0) + 1;
    this.aliveN = m.left;
    const wn = WEAPONS[m.w]?.name;
    const line = m.byName ? `${m.byName} eliminated ${m.name}${wn ? ' with a ' + wn.toLowerCase() : ''}` : m.w === 'storm' ? `${m.name} was lost to the storm` : m.w === 'left' ? `${m.name} left the match` : `${m.name} took too big a fall`;
    c.say(line, m.id === this.myId ? '#f44' : m.by === this.myId ? '#ff0' : '#f6c');
    // a gravestone where they fell (it's RuneScape)
    const at = this.posOf(m.id);
    if (at && this.group.visible) { const gs = this.box(0.6, 0.8, 0.18, this.mat.stone); gs.position.copy(this.T(at.x, this.c.world.height(at.x, at.z) + 0.4, at.z)); this.group.add(gs); }
    if (m.by === this.myId) { this.kills++; c.hud.big(`ELIMINATED ${m.name.toUpperCase()}`, '#ff0', `${m.left} left`, 1.6, true); c.audio.event({ type: 'elim' }); }
    if (m.id === this.myId) {
      this.ph = 'dead'; this.myPlace = m.place; this.buildMode = null;
      const drops = [...this.slots.slice(1).filter(Boolean)];
      for (const [a, n] of Object.entries(this.ammo)) if (n > 0) drops.push({ t: 'a', a, n });
      for (const mt of MAT_ORDER) if (this.mats[mt] >= 10) drops.push({ t: 'm', m: mt, n: this.mats[mt] });
      if (drops.length) this.tx({ op: 'drops', list: drops });
      this.spec = m.by != null && m.by !== this.myId ? m.by : null;
      c.hud.big('ELIMINATED', '#f00', `${m.byName ? 'by ' + m.byName + ' · ' : ''}#${m.place}`, 3, true);
      if (c.sk.mode !== 'walk') c.sk.mode = 'walk';
    }
    if (this.spec === m.id) this.spec = null;
  }
  onOver(m) {
    const c = this.c;
    this.state = 'over'; this.overT = 0; this.firing = false;
    const won = m.id === this.myId, me = m.board.find(r => r.id === this.myId);
    try { document.exitPointerLock(); } catch {}
    this.overEl.innerHTML = `<div class="box"><h1>${won ? '#1 VICTORY ROYALE' : `#${me ? me.place : '?'}`}</h1>
      <h2>${won ? 'Last one standing!' : m.name ? esc(m.name) + ' won the match' : 'Match over'} &middot; ${this.kills} elimination${this.kills === 1 ? '' : 's'}</h2>
      <table>${m.board.slice(0, 10).map(r => `<tr style="color:${r.id === this.myId ? '#0f0' : r.place === 1 ? '#ffd23a' : '#fff'}"><td>#${r.place}</td><td>${esc(r.name)}${r.bot ? ' <span style="color:#a0927a">(bot)</span>' : ''}</td><td>${r.kills} kill${r.kills === 1 ? '' : 's'}</td></tr>`).join('')}</table>
      <button data-a="done">BACK TO SKATING</button><div style="color:#a0927a;font-size:12px;margin-top:6px">(or wait a few seconds)</div></div>`;
    this.overEl.style.display = 'flex';
    // XP: placement + eliminations (modest: a match against bots must not out-earn skating)
    const humans = [...this.players.values()].filter(p => !p.bot).length;
    this.reward = Math.round(((won ? 1500 : 0) + Math.max(0, BR.SIZE - (me?.place || BR.SIZE)) * 40 + this.kills * 150) * (humans > 1 ? 1.5 : 1));
    if (won) c.audio.event({ type: 'victory' });
    if (this.reward) { c.addXP?.(this.reward); c.say(`RuneRoyale: +${this.reward.toLocaleString()} XP (${won ? 'victory, ' : ''}${this.kills} kills)`, '#0f0'); }
  }

  // ================================================================== building
  onBuilt(p) {
    const c = this.c;
    if (this.pieces.has(p.id)) return;
    this.pieces.set(p.id, { ...p }); this.slotIds.set(pieceKey(p), p.id);
    if (!this.shared) addPiece(c.world, p);
    this.pieceLook(this.pieces.get(p.id), true);
    if (Math.hypot((p.i + 0.5) * BR.G - c.sk.x, (p.j + 0.5) * BR.G - c.sk.z) < 30) c.audio.event({ type: 'build' });
  }
  dropPiece(id) {
    const p = this.pieces.get(id); if (!p) return;
    this.pieces.delete(id); this.slotIds.delete(pieceKey(p));
    if (!this.shared) removePiece(this.c.world, p);
    if (p.g) { this.buildGroup.remove(p.g); const at = p.g.position; this.dust(at.x, at.y, -at.z, 10, MATS[p.m].col); }
  }
  pieceGroup(p, mat) {
    const { THREE } = this.c, G = BR.G, H = BR.H, Tk = 0.16, g = new THREE.Group();
    if (p.k === 'wall') {
      if (p.e === 'door') g.add(this.box(G * 0.32, H, Tk, mat, -G * 0.34, 0, 0), this.box(G * 0.32, H, Tk, mat, G * 0.34, 0, 0), this.box(G * 0.36, H * 0.25, Tk, mat, 0, H * 0.375, 0));
      else g.add(this.box(G, H, Tk, mat));
      if (p.d === 0) g.position.copy(this.T(p.i * G + G / 2, p.y + H / 2, p.j * G));
      else { g.position.copy(this.T(p.i * G, p.y + H / 2, p.j * G + G / 2)); g.rotation.y = Math.PI / 2; }
    } else if (p.k === 'floor') { g.add(this.box(G, Tk, G, mat)); g.position.copy(this.T((p.i + 0.5) * G, p.y, (p.j + 0.5) * G)); }
    else if (p.k === 'ramp') {
      const L = Math.hypot(G, H), r = this.box(L, Tk, G, mat); r.rotation.z = Math.atan2(H, G); g.add(r);
      g.position.copy(this.T((p.i + 0.5) * G, p.y + H / 2, (p.j + 0.5) * G)); g.rotation.y = [0, Math.PI / 2, Math.PI, -Math.PI / 2][p.d];
    } else {
      const cn = new THREE.Mesh(new THREE.ConeGeometry(G * 0.7071, H * 0.5, 4, 1), mat); cn.rotation.y = Math.PI / 4; g.add(cn);
      g.position.copy(this.T((p.i + 0.5) * G, p.y + H * 0.25, (p.j + 0.5) * G));
    }
    return g;
  }
  pieceLook(p, rebuild = false) {
    const lvl = p.hp > p.max * 0.66 ? 0 : p.hp > p.max * 0.33 ? 1 : 2, mat = this.pieceMats[p.m][lvl];
    if (rebuild || !p.g) {
      if (p.g) this.buildGroup.remove(p.g);
      p.g = this.pieceGroup(p, mat); p.g.traverse(o => { o.userData.pid = p.id; }); this.buildGroup.add(p.g);
    } else p.g.traverse(o => { if (o.isMesh) o.material = mat; });
  }
  /** the level to build at: snapped to the build levels around you, else your feet */
  baseLevel() {
    const sk = this.c.sk, G = BR.G, H = BR.H, i0 = Math.floor(sk.x / G), j0 = Math.floor(sk.z / G);
    let best = null, bd = H * 0.5;
    for (const p of this.pieces.values()) {
      if (Math.abs(p.i - i0) > 2 || Math.abs(p.j - j0) > 2) continue;
      for (let k = -2; k <= 3; k++) { const L = p.y + k * H, d = Math.abs(sk.y - L); if (d < bd) { bd = d; best = L; } }
    }
    return best ?? Math.round(sk.y * 4) / 4;
  }
  buildTarget(kind) {
    const sk = this.c.sk, G = BR.G, H = BR.H;
    const c4 = ((Math.round(this.yaw / (Math.PI / 2)) % 4) + 4) % 4, [di, dj] = [[1, 0], [0, 1], [-1, 0], [0, -1]][c4];
    const i0 = Math.floor(sk.x / G), j0 = Math.floor(sk.z / G), y = this.baseLevel(), up = this.pitch > 0.5, down = this.pitch < -0.45;
    if (kind === 'wall') {
      const e = [{ d: 1, i: i0 + 1, j: j0 }, { d: 0, i: i0, j: j0 + 1 }, { d: 1, i: i0, j: j0 }, { d: 0, i: i0, j: j0 }][c4];
      return { k: 'wall', ...e, y: y + (up ? H : 0) };
    }
    if (kind === 'floor') return down ? { k: 'floor', i: i0, j: j0, y, d: 0 } : { k: 'floor', i: i0 + di, j: j0 + dj, y: y + (up ? H : 0), d: 0 };
    if (kind === 'ramp') return { k: 'ramp', i: i0 + di, j: j0 + dj, y, d: (c4 + this.rampRot) % 4 };
    return down ? { k: 'cone', i: i0 + di, j: j0 + dj, y, d: 0 } : { k: 'cone', i: i0, j: j0, y: y + H, d: 0 };
  }
  place() {
    const c = this.c, q = this.buildTarget(this.buildMode);
    q.y = Math.round(q.y * 4) / 4;
    if (this.slotIds.has(pieceKey(q))) return;
    if (this.mats[this.matSel] < BUILD_COST) { c.hud.pop(`NOT ENOUGH ${this.matSel.toUpperCase()} (PICKAXE SOMETHING)`, '#f80'); this.fireT = 0.6; return; }
    this.mats[this.matSel] -= BUILD_COST;
    this.tx({ op: 'build', p: { ...q, m: this.matSel } });
  }
  updateGhost() {
    const show = this.alive && this.buildMode && this.ph === 'ground';
    if (!show) { if (this.ghost) this.ghost.visible = false; return; }
    const q = this.buildTarget(this.buildMode); q.y = Math.round(q.y * 4) / 4;
    const ok = !this.slotIds.has(pieceKey(q)) && this.mats[this.matSel] >= BUILD_COST, key = pieceKey(q) + ok + q.d;
    if (key !== this.ghostKey) {
      if (this.ghost) this.group.remove(this.ghost);
      this.ghost = this.pieceGroup({ ...q, e: '' }, ok ? this.ghostOk : this.ghostBad); this.group.add(this.ghost); this.ghostKey = key;
    }
    this.ghost.visible = true;
  }

  // ================================================================== breaking the world
  onBroken(m) {
    const c = this.c, k = m.k;
    let r = null;
    if (this.shared) r = m.boxes ? { boxes: m.boxes } : null;      // (the local match already took it out of the world)
    else { r = breakInWorld(c.world, k); if (r) this.undos.push(r.undo); }
    if (!r) return;
    for (const b of r.boxes) this.crumble(b);
    const [x0, z0, x1, z1] = r.boxes[0], x = (x0 + x1) / 2, z = (z0 + z1) / 2;
    const d = Math.hypot(x - c.sk.x, z - c.sk.z);
    if (d < 40) { c.audio.event({ type: 'crumble' }); this.dust(x, c.world.height(x, z) + 1, z, 16, k.startsWith('tree') ? 0x3a6a2a : 0x8a8070); }
  }
  /** flatten the drawn world (walls, fences, trees, anything on the map) inside a box down to the ground */
  crumble([x0, z0, x1, z1]) {
    const c = this.c, S = c.world.S, half = c.CH * S / 2, py = c.world.probeY; c.world.probeY = -Infinity;
    for (const m of c.chunkMeshes) {
      if (m.userData.kind === 'terrain') continue;
      const [cx, cz] = m.userData.c;
      if (cx + half < x0 || cx - half > x1 || cz + half < z0 || cz - half > z1) continue;
      const a = m.geometry.attributes.position, arr = a.array, ox = m.position.x, oz = -m.position.z, k = S / 128;
      let hit = false;
      // whole triangles (the chunks are triangle soup): one corner inside and the triangle comes down, so a
      // roof caves in instead of stretching into spikes
      for (let t = 0; t < arr.length; t += 9) {
        let inside = false;
        for (let v = t; v < t + 9; v += 3) { const gx = ox + arr[v] * k, gz = oz + arr[v + 2] * k; if (gx >= x0 && gx <= x1 && gz >= z0 && gz <= z1) { inside = true; break; } }
        if (!inside) continue;
        if (!hit) { hit = true; if (!this.flat.has(a)) this.flat.set(a, { arr: arr.slice(), geo: m.geometry }); }
        for (let v = t; v < t + 9; v += 3) arr[v + 1] = -Math.round((c.world.height(ox + arr[v] * k, oz + arr[v + 2] * k) - 0.06) * 128);   // (y is stored as -y * 128)
      }
      if (hit) { a.needsUpdate = true; m.geometry.computeBoundingSphere(); if (m.geometry.boundsTree?.refit) m.geometry.boundsTree.refit(); }
    }
    c.world.probeY = py;
  }
  /** what in the world sits at a hit point: { key, kind } (a wall, a fence, a tree, a blocked tile), or null */
  objAt(x, y, z, block) {
    const w = this.c.world;
    if (block?.s && block.s.piece === undefined) return segObjKey(block.s);
    if (block?.tree) return treeKey(block.tree);
    let best = null, bd = 0.55;
    for (const s of w.segsNear(x, z, 1)) {
      if (s.piece !== undefined || s.frontier || s.kind === 'water' || s.kind === 'edge') continue;
      const d = segDist(x, z, s); if (d < bd) { bd = d; best = segObjKey(s); }
    }
    if (best) return best;
    for (const t of w.trunksNear(x, z, 1)) if (Math.hypot(t.x - x, t.z - z) < t.r + 0.7) return treeKey(t);
    const k = w.tileKind(x, z), [tx, tz] = w.tileOf(x, z);
    if ((k === 1 || k === 3) && y > w.height(x, z) + 0.15) return tileKey(tx, tz);
    return null;
  }

  // ================================================================== shooting
  /** what a ray from the camera hits first: a player, a build piece, the world, or nothing */
  trace(o, d, maxD) {
    const c = this.c, w = c.world, { THREE } = c;
    let best = { dist: maxD, kind: 'none' };
    // the drawn world, close by (BVH meshes)
    this.ray.set(o, d); this.ray.far = Math.min(maxD, 45);
    const h = this.ray.intersectObjects(c.nearOccluders, false)[0];
    if (h && h.distance < best.dist) best = { dist: h.distance, kind: 'world' };
    // builds
    this.ray.far = maxD;
    const hb = this.ray.intersectObjects(this.buildGroup.children, true)[0];
    if (hb && hb.distance < best.dist) best = { dist: hb.distance, kind: 'piece', id: hb.object.userData.pid };
    // walls / fences / trees, all the way out (the collision world)
    const e = o.clone().addScaledVector(d, best.dist);
    const lb = lineBlock(w, o.x, o.y, -o.z, e.x, e.y, -e.z);
    if (lb) { const dist = lb.t * best.dist; if (dist < best.dist - 0.05 && best.kind !== 'piece') best = { dist, kind: 'world', block: lb }; }
    // players: upright capsules
    for (const p of this.players.values()) {
      if (!p.alive || p.id === this.myId) continue;
      const s = this.posOf(p.id); if (!s) continue;
      const r = c.remotes.get(p.id); if (r?.tgt?.hide) continue;
      const px = s.x, pz = -s.z, dx = d.x, dz = d.z, L2 = dx * dx + dz * dz || 1e-9;
      const t = ((px - o.x) * dx + (pz - o.z) * dz) / L2; if (t < 0 || t > best.dist) continue;
      const qx = o.x + dx * t, qz = o.z + dz * t, qy = o.y + d.y * t;
      if (Math.hypot(qx - px, qz - pz) > 0.45 || qy < s.y + 0.1 || qy > s.y + 1.95) continue;
      best = { dist: t, kind: 'player', id: p.id, head: qy > s.y + 1.5 };
    }
    best.point = o.clone().addScaledVector(d, best.dist);
    void THREE;
    return best;
  }
  aimRay() {
    const { THREE } = this.c, cam = this.c.camera, d = new THREE.Vector3();
    cam.getWorldDirection(d);
    return { o: cam.position.clone().addScaledVector(d, 0.5), d };
  }
  muzzle() { const sk = this.c.sk, f = [Math.cos(this.yaw), Math.sin(this.yaw)], r = [Math.sin(this.yaw), -Math.cos(this.yaw)]; return [sk.x + f[0] * 0.6 + r[0] * 0.3, sk.y + 1.3, sk.z + f[1] * 0.6 + r[1] * 0.3]; }
  fire(it) {
    const c = this.c, W = WEAPONS[it.w], { THREE } = c;
    const { o, d } = this.aimRay();
    if (W.melee) {
      c.emote?.(6); this.fireT = 1 / W.rate;
      const h = this.trace(o, d, 4.2);
      const sk = c.sk; if (h.kind === 'none' || h.point.distanceTo(this.T(sk.x, sk.y + 1.2, sk.z)) > W.range + 0.6) { c.audio.event({ type: 'shot', w: 'pick', v: 0.4 }); return; }
      if (h.kind === 'player') this.tx({ op: 'hit', v: h.id, d: W.dmg, hd: 0, w: 'pick' });
      else if (h.kind === 'piece') this.tx({ op: 'pdmg', id: h.id, d: W.struct });
      else {
        const key = this.objAt(h.point.x, h.point.y, -h.point.z, h.block);
        if (key) {
          const kind = key.slice(0, key.indexOf('|')), mat = OBJ_MAT[kind] || 'wood';
          this.tx({ op: 'odmg', k: key, d: W.struct });
          this.mats[mat] = Math.min(MAT_MAX, this.mats[mat] + (kind === 'tree' ? 8 : 6));
          c.hud.pop(`+${kind === 'tree' ? 8 : 6} ${mat.toUpperCase()}`, '#' + new THREE.Color(MATS[mat].col).getHexString());
          c.audio.event({ type: 'chop', mat });
        }
      }
      this.dust(h.point.x, h.point.y, -h.point.z, 4, 0xbbaa88);
      return;
    }
    const spread = (this.ads ? W.ads : W.spread) * (Math.hypot(this.vx, this.vz) > 2 ? 1.35 : 1) * (this.air ? 1.8 : 1) + this.recoil * 0.02;
    const n = W.pellets || 1, hurt = new Map(), pdm = new Map(), odm = new Map(), ends = [];
    const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize(), upv = new THREE.Vector3().crossVectors(right, d);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.sqrt(Math.random()) * spread;
      const dir = d.clone().addScaledVector(right, Math.cos(a) * s).addScaledVector(upv, Math.sin(a) * s).normalize();
      const h = this.trace(o, dir, W.range * (W.proj ? 1 : 2.5));
      ends.push(h.point);
      if (W.proj) { this.launch(this.muzzle(), [h.point.x, h.point.y, -h.point.z], true); break; }
      const fall = Math.max(0.55, 1 - Math.max(0, h.dist - W.range * 0.5) / W.range);
      const dmg = W.dmg * RARITY[it.r].m * fall;
      if (h.kind === 'player') { const v = hurt.get(h.id) || { d: 0, hd: false }; v.d += dmg * (h.head ? W_HEAD[it.w] : 1); v.hd ||= h.head; hurt.set(h.id, v); }
      else if (h.kind === 'piece') pdm.set(h.id, (pdm.get(h.id) || 0) + W.struct);
      else if (h.kind === 'world') { const key = this.objAt(h.point.x, h.point.y, -h.point.z, h.block); if (key) odm.set(key, (odm.get(key) || 0) + W.struct); this.dust(h.point.x, h.point.y, -h.point.z, 2, 0xbbaa88); }
    }
    for (const [v, x] of hurt) this.tx({ op: 'hit', v, d: Math.round(x.d), hd: x.hd ? 1 : 0, w: it.w });
    for (const [id, x] of pdm) this.tx({ op: 'pdmg', id, d: x });
    for (const [k, x] of odm) this.tx({ op: 'odmg', k, d: x });
    const mz = this.muzzle();
    if (!W.proj) for (const e of ends.slice(0, 4)) this.tracer(mz, [e.x, e.y, -e.z], it.w);
    this.tx({ op: 'fx', w: it.w, a: mz.map(v => Math.round(v * 100) / 100), b: ends.slice(0, 4).flatMap(e => [e.x, e.y, -e.z].map(v => Math.round(v * 100) / 100)) });
    this.recoil = Math.min(3, this.recoil + (it.w === 'sniper' ? 2.5 : it.w === 'shotgun' ? 2 : 0.6));
    this.pitch = Math.min(1.35, this.pitch + (it.w === 'sniper' ? 0.06 : it.w === 'shotgun' ? 0.05 : 0.012));
    c.audio.event({ type: 'shot', w: it.w });
    c.shake?.(it.w === 'shotgun' || it.w === 'sniper' ? 0.08 : 0.02);
  }
  reload() {
    const it = this.slots[this.sel]; if (!it || it.t !== 'w' || WEAPONS[it.w].melee) return;
    const W = WEAPONS[it.w];
    if (it.a >= W.mag || this.reloadT > 0) return;
    if (!(this.ammo[W.ammo] > 0)) { this.c.hud.pop(`NO ${W.ammo === 'death' ? 'DEATH RUNES' : W.ammo === 'fire' ? 'FIRE RUNES' : W.ammo.toUpperCase()}`, '#f80'); return; }
    this.reloadT = W.reload; this.reloadOf = it; this.c.audio.event({ type: 'reload' });
  }
  tracer(a, b, w) {
    const { THREE } = this.c, g = new THREE.BufferGeometry().setFromPoints([this.T(...a), this.T(...b)]);
    const l = new THREE.Line(g, w === 'shotgun' ? this.mat.tracer.shotgun : this.mat.tracer.def); this.group.add(l);
    this.fx.push({ o: l, t: 0.07, dispose: () => g.dispose() });
  }
  launch(a, b, mine) {
    const { THREE } = this.c, m = new THREE.Mesh(this.geo.sphere, this.mat.fire); m.scale.setScalar(0.28); this.group.add(m);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    this.proj.push({ m, a, b, t: 0, T: Math.max(0.05, L / WEAPONS.rocket.proj), mine });
  }
  boom(x, y, z) {
    const c = this.c, { THREE } = c, m = new THREE.Mesh(this.geo.sphere, this.mat.boom.clone()); m.position.copy(this.T(x, y, z)); this.group.add(m);
    this.fx.push({ o: m, t: 0.5, T: 0.5, grow: WEAPONS.rocket.splash, dispose: () => m.material.dispose() });
    const d = Math.hypot(x - c.sk.x, z - c.sk.z);
    c.audio.event({ type: 'boom', v: Math.max(0.15, 1 - d / 80) }); if (d < 25) c.shake?.(0.4 * (1 - d / 25));
    this.dust(x, y, z, 14, 0x553322);
  }
  dust(x, y, z, n, col) {
    const { THREE } = this.c, mat = new THREE.MeshBasicMaterial({ color: col });
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.geo.box, mat); m.scale.setScalar(0.08 + Math.random() * 0.12); m.position.copy(this.T(x, y, z)); this.group.add(m);
      this.fx.push({ o: m, t: 0.6 + Math.random() * 0.4, v: [(Math.random() - 0.5) * 5, 2 + Math.random() * 4, (Math.random() - 0.5) * 5] });
    }
  }
  onFx(m) {
    const c = this.c, [ax, ay, az] = m.a;
    const d = Math.hypot(ax - c.sk.x, az - c.sk.z);
    if (d < 110) c.audio.event({ type: 'shot', w: m.w, v: Math.max(0.08, 1 - d / 110) });
    for (let i = 0; i + 2 < m.b.length; i += 3) {
      if (m.w === 'rocket') { this.launch(m.a, m.b.slice(i, i + 3), false); break; }
      this.tracer(m.a, m.b.slice(i, i + 3), m.w);
    }
  }

  // ================================================================== input
  /** a key went down while the mode is on; true = it is handled here */
  key(e) {
    if (!this.active) return false;
    const k = e.key.toLowerCase(), c = this.c;
    if (e.key === 'Tab') { e.preventDefault(); this.board = true; return true; }
    if (this.state === 'over') { if (k === 'escape' || k === 'enter') this.exit(); return true; }
    if (k === 'escape') { if (this.ph === 'dead') this.exit(true); else this.showMenu(this.menuEl.style.display !== 'flex'); return true; }
    if (e.repeat) return true;
    this.keys.add(k);
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    if (this.boardOn && ['w', 'a', 's', 'd', ' ', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) c.skKey(k, true);
    if (k === 'm') this.showMap = !this.showMap;
    if (!this.alive) return true;
    if (k === ' ') this.jumpEdge = true;
    if (k >= '1' && k <= '6') this.select(+k - 1);
    else if (BUILD_KEYS[k] && this.ph === 'ground') { const b = BUILD_KEYS[k]; this.buildMode = this.buildMode === b ? null : b; this.useT = 0; this.using = null; }
    else if (k === 'r') { if (this.buildMode === 'ramp') this.rampRot = (this.rampRot + 1) % 4; else this.reload(); }
    else if (k === 't') { this.matSel = MAT_ORDER[(MAT_ORDER.indexOf(this.matSel) + 1) % 3]; c.hud.pop('BUILDING WITH ' + this.matSel.toUpperCase(), '#fff'); }
    else if (k === 'e') this.interact();
    else if (k === 'g') this.edit();
    else if (k === 'b') this.toggleBoard();
    else if (k === 'z') { const it = this.slots[this.sel]; if (this.sel > 0 && it) { this.tx({ op: 'drop', it }); this.slots[this.sel] = null; } }
    return true;
  }
  keyup(e) {
    const k = e.key.toLowerCase();
    if (e.key === 'Tab') this.board = false;
    this.keys.delete(k);
    if (this.c.keys.has(k)) this.c.skKey(k, false);
  }
  showMenu(on) { this.menuEl.style.display = on ? 'flex' : 'none'; if (on) { try { document.exitPointerLock(); } catch {} } }
  select(i) {
    if (i < 0 || i >= SLOTS) return;
    if (i > 0 && !this.slots[i]) return;
    this.sel = i; this.buildMode = null; this.useT = 0; this.using = null; this.reloadT = 0;
  }
  cycle(dir) {
    if (this.buildMode) { this.buildMode = ['wall', 'floor', 'ramp', 'cone'][(['wall', 'floor', 'ramp', 'cone'].indexOf(this.buildMode) + dir + 4) % 4]; return; }
    for (let n = 1; n <= SLOTS; n++) { const i = (this.sel + dir * n + SLOTS * 2) % SLOTS; if (i === 0 || this.slots[i]) { this.select(i); return; } }
  }
  /** E: the chest / item you're looking at, closest first */
  target() {
    const sk = this.c.sk, f = [Math.cos(this.yaw), Math.sin(this.yaw)];
    let best = null, bd = BR.PICK_R;
    const score = (x, z) => { const dx = x - sk.x, dz = z - sk.z, d = Math.hypot(dx, dz); return d - (d > 0.3 ? (dx * f[0] + dz * f[1]) / d : 1) * 0.8; };
    for (const ch of this.chests.values()) {
      if (ch.open || (ch.land && this.t < ch.land) || Math.abs(ch.y - sk.y) > 2.5) continue;
      const s = score(ch.x, ch.z); if (Math.hypot(ch.x - sk.x, ch.z - sk.z) < BR.PICK_R && s < bd) { bd = s; best = { ch }; }
    }
    for (const o of this.items.values()) {
      if (this.pending.has(o.id) || Math.abs(o.y - sk.y) > 2.5) continue;
      const s = score(o.x, o.z); if (Math.hypot(o.x - sk.x, o.z - sk.z) < BR.PICK_R && s < bd) { bd = s; best = { o }; }
    }
    return best;
  }
  interact() {
    const t = this.target(); if (!t) return;
    if (t.ch) this.tx({ op: 'open', k: t.ch.k });
    else { this.pending.add(t.o.id); this.tx({ op: 'pick', id: t.o.id }); setTimeout(() => this.pending.delete(t.o.id), 1500); }
  }
  edit() {
    const { o, d } = this.aimRay(); this.ray.set(o, d); this.ray.far = 8;
    const h = this.ray.intersectObjects(this.buildGroup.children, true)[0];
    const p = h && this.pieces.get(h.object.userData.pid);
    if (!p || p.k !== 'wall') { this.c.hud.pop('AIM AT A WALL TO EDIT IT', '#f80'); return; }
    this.tx({ op: 'edit', id: p.id });
  }
  toggleBoard() {
    const sk = this.c.sk;
    if (this.ph !== 'ground') return;
    if (this.boardOn) { this.boardOn = false; for (const k of [...this.c.keys]) this.c.skKey(k, false); if (sk.mode !== 'bail') { sk.mode = 'walk'; sk.vx = sk.vz = 0; } this.vx = this.vz = 0; return; }
    if (this.air) return;
    this.boardOn = true; this.buildMode = null; sk.mode = 'ground'; sk.charge = -1; sk.heading = this.yaw;
    const sp = Math.hypot(this.vx, this.vz); sk.vx = Math.cos(this.yaw) * sp; sk.vz = Math.sin(this.yaw) * sp;
    for (const k of this.keys) if (['w', 'a', 's', 'd', ' ', 'shift'].includes(k)) this.c.skKey(k, true);
    this.c.hud.pop('BOARD ON (B TO WALK)', '#fff');
  }

  // ================================================================== the frame
  tick(dt) {
    const c = this.c, sk = c.sk, w = c.world;
    if (this.local) { if (this.alive) this.local.pos('me', sk.x, sk.y, sk.z); this.local.tick(dt); this.drain(); }
    if (this.state === 'over') {
      this.overT += dt; if (this.overT > BR.END_WAIT + 4) this.exit();
      this.spectate(dt); this.visuals(dt); return;
    }
    this.t += dt;
    this.st = stormAt(this.plan, this.t);
    this.hurtT = Math.max(0, this.hurtT - dt * 1.5); this.hitT -= dt; this.recoil = Math.max(0, this.recoil - dt * 6);
    for (const d of this.dmgDir) d.t -= dt; this.dmgDir = this.dmgDir.filter(d => d.t > 0);
    const jump = this.jumpEdge; this.jumpEdge = false;
    if (this.ph === 'bus') {
      const at = busAt(this.bus, this.t);
      sk.x = at.x; sk.z = at.z; sk.y = at.y; sk.mode = 'walk'; sk.walking = 0; sk.footAir = false;
      if (jump || this.t >= BR.BUS_T - 0.2) this.leaveBus();
    } else if (this.ph === 'fall') this.stepFall(dt, jump);
    else if (this.ph === 'ground') {
      if (this.boardOn) {
        c.skateStep(dt);
        this.vx = sk.vx; this.vz = sk.vz;
        if (sk.mode === 'walk') this.boardOn = false;           // (E-style dismount from the skate code)
      } else this.stepFoot(dt, jump);
      this.combat(dt);
    } else if (this.ph === 'dead') this.spectate(dt);
    this.visuals(dt);
  }
  leaveBus() {
    const sk = this.c.sk, at = busAt(this.bus, this.t);
    this.ph = 'fall'; this.glide = false; this.vy = -2;
    this.vx = Math.cos(at.heading) * 6; this.vz = Math.sin(at.heading) * 6;
    sk.mode = 'walk'; sk.footAir = true;
    this.tx({ op: 'jump' }); this.c.audio.event({ type: 'glide' });
    this.c.hud.pop(this.c.TOUCH ? 'STEER WITH THE STICK' : 'WASD TO STEER · LOOK DOWN TO DIVE', '#fff');
  }
  /** WASD relative to where the camera looks */
  wish() {
    const k = this.keys, ts = this.touchMove;
    let f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    let r = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    if (ts) { f += ts.f; r += ts.r; }
    const L = Math.hypot(f, r); if (L > 1) { f /= L; r /= L; }
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    return { x: cy * f + sy * r, z: sy * f - cy * r, f, L: Math.min(1, L) };
  }
  stepFall(dt, jump) {
    const c = this.c, sk = c.sk, w = c.world, g = (w.probeY = -Infinity, w.height(sk.x, sk.z)), above = sk.y - g;
    if (!this.glide && (above < BR.GLIDE_AT || (jump && above < 70))) { this.glide = true; c.audio.event({ type: 'glide' }); }
    const m = this.wish(), sp = this.glide ? 12 : 9, k = Math.min(1, dt * 2.5);
    this.vx += (m.x * sp - this.vx) * k; this.vz += (m.z * sp - this.vz) * k;
    const dive = this.glide ? -5.5 : -18 - Math.max(0, -this.pitch) * 14 * m.L;
    this.vy += (dive - this.vy) * Math.min(1, dt * 3);
    sk.x += this.vx * dt; sk.z += this.vz * dt; sk.y += this.vy * dt;
    // stay over the arena
    const a = this.arena, d = Math.hypot(sk.x - a.x, sk.z - a.z); if (d > a.r + 20) { sk.x = a.x + (sk.x - a.x) * (a.r + 20) / d; sk.z = a.z + (sk.z - a.z) * (a.r + 20) / d; }
    const sp2 = Math.hypot(this.vx, this.vz);
    if (sp2 > 0.5) sk.heading = sk.body = Math.atan2(this.vz, this.vx);
    if (this.glide) { sk.mode = 'air'; sk.airTime = 1; sk.vy = -5; sk.grab = null; sk.charge = -1; sk.boardYaw = 0; sk.boardRoll = 0; sk.lean = 0; }
    else { sk.mode = 'walk'; sk.footAir = true; sk.walking = 0; }
    w.probeY = sk.y;
    const gg = w.height(sk.x, sk.z);
    if (sk.y <= gg) {
      sk.y = gg; this.ph = 'ground'; this.air = false; this.vy = 0;
      sk.mode = 'walk'; sk.footAir = false; sk.vx = sk.vz = 0;
      const sx = sk.x, sz = sk.z; sk.unstick?.(0.2); if (sk.unstickTo) { sk.x = sk.unstickTo.x; sk.z = sk.unstickTo.z; sk.unstickTo = null; } void sx; void sz;
      c.audio.event({ type: 'land', impact: 6 }); c.hud.pop('LANDED: FIND A CHEST (E)', '#ff0');
    }
    w.probeY = -Infinity;
  }
  stepFoot(dt, jump) {
    const c = this.c, sk = c.sk, w = c.world;
    const m = this.wish(), sprint = this.keys.has('shift') && !this.ads && m.f > 0.2;
    const sp = (this.ads ? 2.8 : sprint ? 6.8 : 4.8) * (this.useT > 0 ? 0.5 : 1);
    const k = Math.min(1, dt * (this.air ? 3 : 14));
    this.vx += (m.x * sp * m.L - this.vx) * k; this.vz += (m.z * sp * m.L - this.vz) * k;
    sk.mode = 'walk'; sk.vx = this.vx; sk.vz = this.vz;
    sk.x += this.vx * dt; sk.z += this.vz * dt;
    w.probeY = sk.y;
    sk.collide(dt, this.air);
    this.vx = sk.vx; this.vz = sk.vz;
    const g = w.height(sk.x, sk.z);
    if (!this.air) {
      if (jump) { this.air = true; this.vy = 7.4; this.peak = sk.y; c.audio.event({ type: 'pop' }); }
      else if (g < sk.y - 0.45) { this.air = true; this.vy = 0; this.peak = sk.y; }
      else sk.y = g;
    }
    if (this.air) {
      this.vy -= 21 * dt; sk.y += this.vy * dt; this.peak = Math.max(this.peak, sk.y);
      const g2 = w.height(sk.x, sk.z);
      if (sk.y <= g2) {
        const drop = this.peak - g2;
        sk.y = g2; this.air = false; this.vy = 0;
        if (drop > BR.FALL_SAFE) this.tx({ op: 'self', d: Math.round((drop - BR.FALL_SAFE) * 9), why: 'fall' });
      }
    }
    // never sink into a blocked tile on the ground (but standing on your own floors is fine)
    w.probeY = -Infinity;
    if (!this.air && sk.y - w.height(sk.x, sk.z) < 0.3) sk.unstick(dt);
    sk.heading = sk.body = this.yaw;
    sk.walking = Math.hypot(this.vx, this.vz) > 0.4 ? (sprint ? 2 : 1) : 0;
    sk.footAir = this.air;
    // the edge of the map
    sk.x = Math.max(0.6, Math.min(w.W - 0.6, sk.x)); sk.z = Math.max(0.6, Math.min(w.W - 0.6, sk.z));
  }
  combat(dt) {
    const c = this.c, sk = c.sk;
    this.fireT -= dt;
    // auto-pickup: ammo and materials you walk over, and weapons / food while there's an empty slot
    if ((this.apT = (this.apT || 0) - dt) <= 0) {
      this.apT = 0.15;
      const free = this.slots.some((s, i) => i > 0 && !s);
      for (const o of this.items.values()) {
        if (this.pending.has(o.id) || Math.hypot(o.x - sk.x, o.z - sk.z) > 1.3 || Math.abs(o.y - sk.y) > 1.5) continue;
        if (o.it.t === 'a' || o.it.t === 'm' || (free && (o.it.t === 'w' || o.it.t === 'h'))) { this.pending.add(o.id); this.tx({ op: 'pick', id: o.id }); const id = o.id; setTimeout(() => this.pending.delete(id), 1500); break; }
      }
    }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { const it = this.reloadOf, W = WEAPONS[it.w], n = Math.min(W.mag - it.a, this.ammo[W.ammo] || 0); it.a += n; this.ammo[W.ammo] -= n; }
    }
    if (this.buildMode) { if (this.firing && this.fireT <= 0) { this.place(); this.fireT = Math.max(this.fireT, 0.14); } this.fireEdge = false; return; }
    const it = this.slots[this.sel];
    if (!it) { this.sel = 0; return; }
    if (it.t === 'h') {
      const h = HEALS[it.h];
      if (this.fireEdge && !this.useT) {
        const full = h.hp ? this.hp >= h.cap : this.sh >= h.cap;
        if (full) c.hud.pop(h.hp ? 'HEALTH IS FULL ENOUGH' : 'SHIELD IS FULL ENOUGH', '#f80');
        else { this.useT = h.use; this.using = it; c.audio.event({ type: 'eat' }); }
      }
      this.fireEdge = false;
      if (this.useT > 0 && this.using === it) {
        this.useT -= dt;
        if (this.useT <= 0) { this.useT = 0; this.tx({ op: 'heal', h: it.h }); if (--it.n <= 0) { this.slots[this.sel] = null; this.sel = 0; } this.using = null; }
      }
      return;
    }
    if (it.t !== 'w') return;
    const W = WEAPONS[it.w];
    if (this.reloadT > 0 || !this.firing || this.fireT > 0) return;
    if (!W.auto && !this.fireEdge) return;
    this.fireEdge = false;
    if (W.melee) { this.fire(it); return; }
    if (it.a <= 0) { this.reload(); return; }
    it.a--; this.fireT = 1 / W.rate;
    this.fire(it);
    if (it.a <= 0) this.reload();
  }
  spectate(dt) {
    const c = this.c;
    if (this.spec == null || !this.players.get(this.spec)?.alive) {
      const alive = [...this.players.values()].filter(p => p.alive && p.id !== this.myId);
      this.spec = alive.length ? alive[0].id : null;
    }
    void dt; void c;
  }

  // ================================================================== drawing
  visuals(dt) {
    const c = this.c, sk = c.sk, { THREE } = c, now = performance.now() / 1000;
    const st = this.st || stormAt(this.plan, this.t);
    this.storm.position.set(st.x, -20, -st.z); this.storm.scale.set(Math.max(0.5, st.r), 260, Math.max(0.5, st.r));
    const out = this.alive && this.ph !== 'bus' && Math.hypot(sk.x - st.x, sk.z - st.z) > st.r;
    this.tint.style.opacity = out ? '1' : '0';
    this.hurtEl.style.opacity = String(Math.min(0.85, this.hurtT));
    this.scoped = this.alive && this.ads && !this.buildMode && this.slots[this.sel]?.t === 'w' && WEAPONS[this.slots[this.sel].w].scope;
    this.scopeEl.style.display = this.scoped ? 'block' : 'none';
    // the dragon
    if (this.kbd) {
      const at = busAt(this.bus, this.t), on = this.t < BR.BUS_T + 4;
      this.kbd.group.visible = on && this.live;
      if (on) { this.kbd.group.position.copy(this.T(at.x + Math.cos(at.heading) * this.t * 0, at.y - 4, at.z)); this.kbd.group.rotation.set(0, at.heading + Math.PI / 2, 0); this.kbd.play('walk'); this.kbd.update(dt); c.lighting.ensure?.(this.kbd.mesh); }
    }
    // chests (supply drops float down), items bob
    for (const ch of this.chests.values()) {
      if (!ch.land) continue;
      const left = ch.land - this.t, y = ch.y + Math.max(0, left) * 3;
      ch.g.position.y = y;
      const b = ch.g.getObjectByName('balloon'); if (b) b.visible = left > 0;
    }
    for (const o of this.items.values()) { const s = o.g.getObjectByName('spin'); if (s) { s.rotation.y = now * 1.6; s.position.y = 0.35 + Math.sin(now * 2 + o.x) * 0.06; } }
    // projectiles
    for (const p of this.proj) {
      p.t += dt; const k = Math.min(1, p.t / p.T);
      p.m.position.copy(this.T(p.a[0] + (p.b[0] - p.a[0]) * k, p.a[1] + (p.b[1] - p.a[1]) * k, p.a[2] + (p.b[2] - p.a[2]) * k));
      if (k >= 1) { this.group.remove(p.m); this.boom(...p.b); if (p.mine) this.tx({ op: 'boom', x: p.b[0], y: p.b[1], z: p.b[2] }); }
    }
    this.proj = this.proj.filter(p => p.t < p.T);
    for (const f of this.fx) {
      f.t -= dt;
      if (f.v) { f.v[1] -= 14 * dt; f.o.position.x += f.v[0] * dt; f.o.position.y += f.v[1] * dt; f.o.position.z -= f.v[2] * dt; }
      if (f.grow) { const k = 1 - f.t / f.T; f.o.scale.setScalar(0.3 + f.grow * k); f.o.material.opacity = 0.8 * (1 - k); }
      if (f.t <= 0) { this.group.remove(f.o); f.dispose?.(); }
    }
    this.fx = this.fx.filter(f => f.t > 0);
    this.updateGhost();
    // what you hold
    const it = this.alive && this.ph === 'ground' && !this.buildMode ? this.slots[this.sel] : null, hw = it?.t === 'w' ? it.w : '';
    if (hw !== this.heldW) { this.held.clear(); if (hw) this.held.add(this.weaponMesh(hw)); this.heldW = hw; }
    if (hw) {
      const f = [Math.cos(this.yaw), Math.sin(this.yaw)], r = [Math.sin(this.yaw), -Math.cos(this.yaw)];
      this.held.position.copy(this.T(sk.x + f[0] * 0.35 + r[0] * 0.32, sk.y + 1.2, sk.z + f[1] * 0.35 + r[1] * 0.32));
      this.held.rotation.set(0, this.yaw, hw === 'pick' && this.fireT > 0.2 ? -1 : this.pitch);
      this.held.visible = !this.scoped;
    }
    this.lastW = hw;
  }
  /** after the skaters are drawn: hide who shouldn't show, weapons in bots' hands */
  postDraw() {
    const c = this.c;
    for (const r of c.remotes.values()) {
      const p = this.active ? this.players.get(r.id) : null;
      let show = this.active ? !!p : !(r.tgt && r.tgt.br);
      if (show && p) { if (r.tgt?.hide || (!p.alive && performance.now() - p.deadAt > 1200)) show = false; }
      if (!show) { if (r.m) r.m.group.visible = false; r.board.root.visible = false; if (r.shadow) r.shadow.visible = false; }
      else if (r.m) r.m.group.visible = true;
      // their weapon
      const want = show && this.active && r.tgt?.bw && r.s?.mode === 'walk' ? r.tgt.bw : '';
      if (want !== (r.bwName || '')) { if (r.bwMesh) this.group.remove(r.bwMesh); r.bwMesh = want ? this.weaponMesh(want) : null; if (r.bwMesh) this.group.add(r.bwMesh); r.bwName = want; }
      if (r.bwMesh && r.s) {
        const h = r.s.heading, f = [Math.cos(h), Math.sin(h)], rr = [Math.sin(h), -Math.cos(h)];
        r.bwMesh.position.copy(this.T(r.s.x + f[0] * 0.35 + rr[0] * 0.32, r.s.y + 1.2, r.s.z + f[1] * 0.35 + rr[1] * 0.32)); r.bwMesh.rotation.set(0, h, 0);
      }
    }
    if (!this.active) return;
    const hide = this.ph === 'bus' || this.ph === 'dead';
    if (hide) { c.player().group.visible = false; c.board().root.visible = false; c.myShadow.visible = false; }
    else c.player().group.visible = true;
  }
  /** extra fields in your state snapshot while you're in a match */
  snap(o) {
    if (!this.active) return;
    o.br = 1; o.hide = this.ph === 'bus' || this.ph === 'dead' ? 1 : 0;
    const it = this.slots?.[this.sel]; o.bw = this.alive && !this.buildMode && it?.t === 'w' ? it.w : '';
  }
  camera(dt, first) {
    const c = this.c, cam = c.camera, { THREE } = c, sk = c.sk;
    let fx = sk.x, fy = sk.y, fz = sk.z, dist = 3.6, sh = 0.7, h = 1.7;
    if (this.ph === 'bus' && this.live) { dist = 16; sh = 0; h = 2; }
    else if (this.ph === 'fall') { dist = 6.5; sh = 0; }
    else if (this.ph === 'dead' || this.state === 'over') {
      const s = this.spec != null && this.posOf(this.spec);
      if (s) { fx = s.x; fy = s.y; fz = s.z; }
      if (this.state === 'over') this.yaw += dt * 0.3;
    } else if (this.ads) { dist = 1.9; sh = 0.55; }
    else if (this.buildMode) dist = 4.4;
    c.cullChunks(fx, fz);
    const cp = Math.cos(this.pitch), f = new THREE.Vector3(Math.cos(this.yaw) * cp, Math.sin(this.pitch), Math.sin(this.yaw) * cp);
    const r = [Math.sin(this.yaw), -Math.cos(this.yaw)];
    const pivot = this.T(fx + r[0] * sh, fy + h, fz + r[1] * sh);
    let want = this.T(fx + r[0] * sh - f.x * dist, fy + h - f.y * dist, fz + r[1] * sh - f.z * dist);
    want = c.unblock(this.T(fx, fy + h, fz), want, 0.25);
    cam.position.lerp(want, first ? 1 : 1 - Math.exp(-dt * 30));
    const gh = c.world.height(cam.position.x, -cam.position.z) + 0.25; if (cam.position.y < gh) cam.position.y = gh;
    cam.lookAt(pivot.clone().add(new THREE.Vector3(f.x, f.y, -f.z).multiplyScalar(30)));
    const fov = this.scoped ? 16 : this.ads ? 50 : this.ph === 'bus' ? 75 : 70;
    if (Math.abs(cam.fov - fov) > 0.1) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 12); cam.updateProjectionMatrix(); }
  }

  // ================================================================== the HUD (drawn on the game's HUD canvas, RS fonts)
  drawHud(hud, x, W, H, K) {
    if (!this.active || !this.players.size) return;
    const c = this.c, sk = c.sk, k1 = Math.max(1, K - 1), st = this.st || stormAt(this.plan, this.t);
    // the minimap: storm rings, supply drops, the dragon's line
    const rings = [{ x: st.x, z: st.z, r: st.r, col: '#c6f', w: 3 }];
    if (st.next && st.next.r > 0.5) rings.push({ x: st.next.x, z: st.next.z, r: st.next.r, col: '#fff', w: 2 });
    hud.miniRings = rings; hud.miniSpan = 70;
    hud.miniDots.length = 0;
    for (const ch of this.chests.values()) if (ch.sd && !ch.open) hud.miniDots.push({ x: ch.x, z: ch.z, col: '#4af', r: 3 });
    const R = Math.round(34 * Math.max(2, K));
    if (hud.mini) hud.drawMini(W - 16, 14, K, sk);
    // phones: the right side belongs to the buttons, so the storm text goes top left
    let ty = c.TOUCH ? 14 : 14 + R * 2 + 18; const tx = c.TOUCH ? 16 : W - 16, ta = c.TOUCH ? 'l' : 'r';
    const stormTxt = st.until === Infinity ? 'FINAL CIRCLE' : st.shrinking ? `STORM CLOSING ${fmtT(st.until - this.t)}` : `STORM MOVES IN ${fmtT(st.until - this.t)}`;
    hud.text(stormTxt, tx, ty, st.shrinking ? '#c6f' : '#fff', k1, ta, 'p12'); ty += k1 * 12;
    hud.text(`ALIVE ${this.aliveN ?? [...this.players.values()].filter(p => p.alive).length}   ELIMS ${this.kills}`, tx, ty, '#ff0', k1, ta, 'p12'); ty += k1 * 12;
    if (this.ph === 'bus') hud.text(`DRAGON DROPS YOU IN ${fmtT(BR.BUS_T - this.t)}`, tx, ty, '#f80', k1, ta, 'p12');
    // health + shield
    if (this.alive) {
      const bw = Math.min(W * 0.32, 260 * k1 / 1.5), bx = 16, by = H - 18 - K * 10 - 46;
      x.fillStyle = 'rgba(0,0,0,0.6)'; x.fillRect(bx - 2, by - 2, bw + 4, 30);
      x.fillStyle = '#2a7cff'; x.fillRect(bx, by, bw * this.sh / 100, 10);
      x.fillStyle = '#2ec23a'; x.fillRect(bx, by + 14, bw * Math.max(0, this.hp) / 100, 12);
      hud.text(`${Math.round(this.sh)}`, bx + bw + 8, by - 3, '#8cf', k1, 'l', 'p12');
      hud.text(`${Math.max(0, Math.round(this.hp))}`, bx + bw + 8, by + 11, '#8f8', k1, 'l', 'p12');
      if (this.useT > 0 && this.using) {
        const u = 1 - this.useT / HEALS[this.using.h].use;
        x.fillStyle = 'rgba(0,0,0,0.6)'; x.fillRect(W / 2 - 60, H * 0.62, 120, 8); x.fillStyle = '#fd4'; x.fillRect(W / 2 - 58, H * 0.62 + 2, 116 * u, 4);
        hud.text(`EATING ${HEALS[this.using.h].name.toUpperCase()}`, W / 2, H * 0.62 + 12, '#fd4', k1, 'c', 'p12');
      }
      if (this.reloadT > 0) hud.text('RELOADING', W / 2, H * 0.62 + 12, '#fff', k1, 'c', 'p12');
      // the hotbar (top centre on phones, clear of the buttons)
      const sw = Math.round(34 * k1 / 1.5 + 10), gap = 4, hx = c.TOUCH ? Math.round(W / 2 - SLOTS * (sw + gap) / 2) : W - 16 - SLOTS * (sw + gap), hy = c.TOUCH ? 12 : H - 18 - sw;
      const wx = c.TOUCH ? W / 2 : W - 16, wa = c.TOUCH ? 'c' : 'r', wy = c.TOUCH ? hy + sw + 6 + k1 * 11 : hy - k1 * 11, wy2 = c.TOUCH ? hy + sw + 6 : hy - k1 * 22;
      for (let i = 0; i < SLOTS; i++) {
        const s = this.slots[i], sx = hx + i * (sw + gap), on = i === this.sel && !this.buildMode;
        x.fillStyle = on ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.55)'; x.fillRect(sx, hy, sw, sw);
        x.strokeStyle = s?.t === 'w' && !WEAPONS[s.w].melee ? RARITY[s.r].col : on ? '#fff' : '#5a4a2a'; x.lineWidth = on ? 3 : 2; x.strokeRect(sx, hy, sw, sw);
        hud.text(String(i + 1), sx + 3, hy + 2, '#fff', 1, 'l', 'p12', 0.7);
        if (!s) continue;
        const name = s.t === 'w' ? { pick: 'PICK', smg: 'SBOW', ar: 'XBOW', shotgun: 'STAFF', sniper: 'DARK', rocket: 'FIRE' }[s.w] : { shrimp: 'SHRMP', shark: 'SHARK', brew: 'BREW', superdef: 'S.DEF' }[s.h];
        hud.text(name, sx + sw / 2, hy + sw / 2 - 5, s.t === 'h' ? HEALS[s.h].col : '#fff', 1, 'c', 'p12');
        if (s.t === 'w' && !WEAPONS[s.w].melee) hud.text(String(s.a), sx + sw - 3, hy + sw - 12, '#ff0', 1, 'r', 'p12');
        if (s.t === 'h') hud.text('x' + s.n, sx + sw - 3, hy + sw - 12, '#ff0', 1, 'r', 'p12');
      }
      // ammo for what you hold + materials
      const cur = this.slots[this.sel];
      if (cur?.t === 'w' && !WEAPONS[cur.w].melee) { const W2 = WEAPONS[cur.w]; hud.text(`${cur.a} / ${this.ammo[W2.ammo] || 0}  ${W2.ammo === 'death' ? 'DEATH RUNES' : W2.ammo === 'fire' ? 'FIRE RUNES' : W2.ammo.toUpperCase()}`, wx, wy2, '#fff', k1, wa, 'p12'); }
      if (cur) hud.text(cur.t === 'w' ? `${RARITY[cur.r ?? 0].name.toUpperCase()} ${WEAPONS[cur.w].name.toUpperCase()}` : itemName(cur).toUpperCase(), wx, wy, cur.t === 'w' && cur.w !== 'pick' ? RARITY[cur.r].col : '#fff', k1, wa, 'p12');
      MAT_ORDER.forEach((m, i) => hud.text(`${MATS[m].name.toUpperCase()} ${this.mats[m]}`, hx - 12, hy + i * k1 * 11, m === this.matSel ? '#ff0' : '#bbb', k1, 'r', 'p12', m === this.matSel ? 1 : 0.8));
      if (this.buildMode) hud.text(c.TOUCH ? `BUILD ${PIECE_NAME[this.buildMode]} · ${this.matSel.toUpperCase()}` : `BUILD: ${PIECE_NAME[this.buildMode]} (${this.matSel.toUpperCase()})   CLICK place · Q/F/C/V piece · T material · R rotate · G edit · 1-6 weapons`, W / 2, H - 18 - K * 10 - (c.TOUCH ? 170 : 70), '#5af', k1, 'c', 'p12');
      // crosshair + hit marker + damage direction
      const cx = W / 2, cy = H / 2;
      if (!this.scoped && this.ph === 'ground') {
        const sp = 6 + (this.ads ? 0 : 6) + this.recoil * 3;
        x.fillStyle = '#fff'; for (const [a, b, w2, h2] of [[cx - sp - 6, cy - 1, 6, 2], [cx + sp, cy - 1, 6, 2], [cx - 1, cy - sp - 6, 2, 6], [cx - 1, cy + sp, 2, 6]]) x.fillRect(a, b, w2, h2);
      }
      if (this.hitT > 0) { x.strokeStyle = this.hitHd ? '#ff0' : '#fff'; x.lineWidth = 2; x.beginPath(); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { x.moveTo(cx + a * 5, cy + b * 5); x.lineTo(cx + a * 12, cy + b * 12); } x.stroke(); }
      for (const d of this.dmgDir) {
        const rel = d.a - this.yaw, ang = -rel - Math.PI / 2;
        x.strokeStyle = `rgba(255,30,30,${Math.min(1, d.t)})`; x.lineWidth = 6; x.beginPath(); x.arc(cx, cy, 90, ang - 0.3, ang + 0.3); x.stroke();
      }
      // what E does
      if (this.ph === 'ground') {
        const t = this.target();
        if (t) hud.text(`${c.TOUCH ? 'USE' : 'E'}: ${t.ch ? (t.ch.sd ? 'OPEN THE SUPPLY DROP' : t.ch.kind === 'ammo' ? 'OPEN AMMO BOX' : 'OPEN CHEST') : 'PICK UP ' + itemName(t.o.it).toUpperCase()}`, cx, cy + 40, t.o?.it.t === 'w' ? RARITY[t.o.it.r].col : '#ff0', k1, 'c', 'p12');
      }
      if (this.ph === 'fall') hud.text(`${Math.round(sk.y - c.world.height(sk.x, sk.z))} UP   ${this.glide ? 'GLIDING ON YOUR BOARD' : (c.TOUCH ? 'JUMP: open glider' : 'SPACE: open glider')}`, cx, H * 0.7, '#fff', K, 'c', 'p12');
      if (this.ph === 'bus') hud.text(c.TOUCH ? 'TAP JUMP TO DROP' : 'SPACE TO JUMP OFF THE DRAGON', cx, H * 0.7, '#ff0', K, 'c', 'b12');
    } else if (this.ph === 'dead' && this.state === 'live') {
      const s = this.spec != null ? this.players.get(this.spec) : null;
      hud.text(`#${this.myPlace}   ${s ? 'SPECTATING ' + s.name.toUpperCase() : ''}`, W / 2, H * 0.18, '#fff', K, 'c', 'b12');
      hud.text(c.TOUCH ? 'MENU: back to skating' : 'ESC: back to skating', W / 2, H * 0.18 + K * 14, '#ff981f', k1, 'c', 'p12');
    }
    if (this.showMap) this.drawMap(hud, x, W, H, K, st);
    if (this.board) this.drawScores(hud, x, W, H, K);
  }
  drawMap(hud, x, W, H, K, st) {
    const m = hud.mini; if (!m) return;
    const size = Math.min(W, H) * 0.8, ox = (W - size) / 2, oy = (H - size) / 2, a = this.arena, S = m.S, span = a.r + 12;
    const sc = size / (span * 2), mx = gx => ox + (gx - (a.x - span)) * sc, mz = gz => oy + ((a.z + span) - gz) * sc;
    x.fillStyle = 'rgba(0,0,0,0.75)'; x.fillRect(ox - 6, oy - 6, size + 12, size + 12);
    x.drawImage(m.canvas, (a.x - span) / S * m.PX, (m.N - (a.z + span) / S) * m.PX, span * 2 / S * m.PX, span * 2 / S * m.PX, ox, oy, size, size);
    x.save(); x.beginPath(); x.rect(ox, oy, size, size); x.clip();
    const ring = (cx, cz, r, col, w) => { x.strokeStyle = col; x.lineWidth = w; x.beginPath(); x.arc(mx(cx), mz(cz), r * sc, 0, Math.PI * 2); x.stroke(); };
    ring(st.x, st.z, st.r, '#c6f', 3); if (st.next) ring(st.next.x, st.next.z, st.next.r, '#fff', 2);
    if (this.ph === 'bus') { x.strokeStyle = '#ff0'; x.setLineDash([6, 6]); x.lineWidth = 2; x.beginPath(); x.moveTo(mx(this.bus.ax), mz(this.bus.az)); x.lineTo(mx(this.bus.bx), mz(this.bus.bz)); x.stroke(); x.setLineDash([]); }
    for (const ch of this.chests.values()) if (ch.sd && !ch.open) { x.fillStyle = '#4af'; x.fillRect(mx(ch.x) - 4, mz(ch.z) - 4, 8, 8); }
    const sk = this.c.sk; x.fillStyle = '#ff0'; x.strokeStyle = '#000'; x.beginPath(); x.arc(mx(sk.x), mz(sk.z), 6, 0, Math.PI * 2); x.fill(); x.stroke();
    x.restore();
    hud.text('MAP (M)', W / 2, oy - 6 - K * 12, '#fff', K, 'c', 'b12');
  }
  drawScores(hud, x, W, H, K) {
    const k1 = Math.max(1, K - 1), rows = [...this.players.values()].sort((a, b) => (b.alive - a.alive) || (b.kills || 0) - (a.kills || 0));
    const pw = 320 * k1 / 1.5, ph = 30 + rows.length * k1 * 11, px = (W - pw) / 2, py = H * 0.12;
    x.fillStyle = 'rgba(30,24,16,0.92)'; x.fillRect(px, py, pw, ph); x.strokeStyle = '#5a4a2a'; x.lineWidth = 3; x.strokeRect(px, py, pw, ph);
    hud.text('RUNEROYALE', px + pw / 2, py + 6, '#f6c', k1, 'c', 'b12');
    rows.forEach((p, i) => {
      const y = py + 24 + i * k1 * 11, col = p.id === this.myId ? '#0f0' : p.alive ? '#fff' : '#777';
      hud.text(p.name + (p.bot ? ' (bot)' : ''), px + 10, y, col, k1, 'l', 'p12');
      hud.text(`${p.kills || 0} kills${p.alive ? '' : '  #' + (p.place || '?')}`, px + pw - 10, y, col, k1, 'r', 'p12');
    });
  }

  // ================================================================== phones
  mkTouch() {
    const el = this.touchEl = document.createElement('div'); el.id = 'brtouch';
    el.innerHTML = `<div class="zone look"></div><div class="zone stick"><div class="base"><div class="nub"></div></div></div>
      <div class="b" data-b="fire" style="right:20px;bottom:110px;width:84px;height:84px;font-size:14px">FIRE</div>
      <div class="b" data-b="ads" style="right:112px;bottom:150px;width:52px;height:52px">AIM</div>
      <div class="b" data-b="jump" style="right:20px;bottom:20px;width:70px;height:70px">JUMP</div>
      <div class="b" data-b="use" style="right:100px;bottom:20px;width:56px;height:56px">USE</div>
      <div class="b" data-b="reload" style="right:112px;bottom:88px;width:48px;height:48px">RELOAD</div>
      <div class="b" data-b="build" style="right:170px;bottom:20px;width:56px;height:56px">BUILD</div>
      <div class="b" data-b="piece" style="right:170px;bottom:84px;width:52px;height:52px">PIECE</div>
      <div class="b" data-b="next" style="right:176px;bottom:150px;width:52px;height:52px">NEXT</div>
      <div class="b" data-b="board" style="left:12px;top:150px;width:46px;height:46px;border-radius:10px">BOARD</div>
      <div class="b" data-b="map" style="left:64px;top:150px;width:46px;height:46px;border-radius:10px">MAP</div>
      <div class="b" data-b="menu" style="left:116px;top:150px;width:46px;height:46px;border-radius:10px">MENU</div>`;
    document.body.appendChild(el);
    const cap = (t, e) => { try { t.setPointerCapture(e.pointerId); } catch {} };
    for (const b of el.querySelectorAll('.b')) {
      const a = b.dataset.b;
      b.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation(); cap(b, e); b.classList.add('on'); this.c.audio.start?.();
        if (a === 'fire') { this.firing = true; this.fireEdge = true; }
        else if (a === 'ads') this.ads = !this.ads;
        else if (a === 'jump') this.jumpEdge = true;
        else if (a === 'use') this.interact();
        else if (a === 'reload') this.reload();
        else if (a === 'build') this.buildMode = this.buildMode ? null : 'wall';
        else if (a === 'piece') this.cycle(1);
        else if (a === 'next') this.cycle(1);
        else if (a === 'board') this.toggleBoard();
        else if (a === 'map') this.showMap = !this.showMap;
        else if (a === 'menu') { if (this.ph === 'dead' || this.state === 'over') this.exit(true); else this.showMenu(true); }
      });
      const up = () => { b.classList.remove('on'); if (a === 'fire') this.firing = false; };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    }
    const stick = el.querySelector('.stick'), base = el.querySelector('.base'), nub = el.querySelector('.nub'), R = 46;
    let sid = null, sx = 0, sy = 0;
    stick.addEventListener('pointerdown', e => { if (sid !== null) return; e.preventDefault(); cap(stick, e); sid = e.pointerId; sx = e.clientX; sy = e.clientY; const r = stick.getBoundingClientRect(); base.style.left = (sx - r.left) + 'px'; base.style.top = (sy - r.top) + 'px'; base.style.display = 'block'; nub.style.transform = ''; });
    stick.addEventListener('pointermove', e => {
      if (e.pointerId !== sid) return;
      let dx = e.clientX - sx, dy = e.clientY - sy; const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
      nub.style.transform = `translate(${dx}px, ${dy}px)`;
      this.touchMove = { f: -dy / R, r: dx / R };
      if (this.boardOn) { this.c.skKey('w', dy < -R * 0.4); this.c.skKey('s', dy > R * 0.5); this.c.skKey('a', dx < -R * 0.3); this.c.skKey('d', dx > R * 0.3); }
      if (Math.hypot(dx, dy) > R * 0.95 && dy < -R * 0.8) this.keys.add('shift'); else this.keys.delete('shift');
    });
    const sEnd = e => { if (e.pointerId !== sid) return; sid = null; base.style.display = 'none'; this.touchMove = null; this.keys.delete('shift'); if (this.boardOn) for (const k of 'wasd') this.c.skKey(k, false); };
    stick.addEventListener('pointerup', sEnd); stick.addEventListener('pointercancel', sEnd);
    const look = el.querySelector('.look'); const lk = new Map();
    look.addEventListener('pointerdown', e => { e.preventDefault(); cap(look, e); lk.set(e.pointerId, [e.clientX, e.clientY]); });
    look.addEventListener('pointermove', e => {
      const p = lk.get(e.pointerId); if (!p) return;
      const k = (this.ads ? 0.0035 : 0.0065) * (this.scoped ? 0.4 : 1);
      this.yaw -= (e.clientX - p[0]) * k; this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - (e.clientY - p[1]) * k));
      lk.set(e.pointerId, [e.clientX, e.clientY]);
    });
    const lEnd = e => lk.delete(e.pointerId);
    look.addEventListener('pointerup', lEnd); look.addEventListener('pointercancel', lEnd);
  }

  // ================================================================== back to skating
  cleanup() {
    const c = this.c, w = c.world;
    if (this.local) this.local.reset();
    restoreWorld(w, this.undos); this.undos = [];
    w.removeSegs(s => s.piece !== undefined); w.clearDecks();
    for (const [a, f] of this.flat) { a.array.set(f.arr); a.needsUpdate = true; f.geo.computeBoundingSphere(); if (f.geo.boundsTree?.refit) f.geo.boundsTree.refit(); }
    this.flat.clear();
    for (const o of [...this.group.children]) if (o !== this.storm && o !== this.buildGroup && o !== this.held) this.group.remove(o);
    this.buildGroup.clear(); this.held.clear(); this.heldW = ''; this.ghost = null; this.ghostKey = '';
    if (this.kbd) { c.scene.remove(this.kbd.group); this.kbd = null; }
    for (const p of this.players.values()) if (p.bot) c.dropRemote(p.id);
    for (const r of c.remotes.values()) if (r.bwMesh) { this.group.remove(r.bwMesh); r.bwMesh = null; r.bwName = ''; }
    this.players = new Map(); this.pieces?.clear(); this.items?.clear(); this.chests?.clear();
    this.group.visible = false;
  }
  exit(quit = false) {
    const c = this.c, sk = c.sk;
    if (!this.active) return;
    if (quit && this.live) this.tx({ op: 'leave' });
    if (!this.local) c.net.send({ t: 'br', op: 'done' });
    this.cleanup();
    this.local = null; this.inbox = null; this.shared = false;
    this.state = 'idle'; this.boardOn = false; this.buildMode = null; this.firing = false; this.ads = false; this.keys.clear();
    for (const k of [...c.keys]) c.skKey(k, false);
    this.overEl.style.display = 'none'; this.menuEl.style.display = 'none'; this.tint.style.opacity = '0'; this.hurtEl.style.opacity = '0'; this.scopeEl.style.display = 'none';
    if (this.touchEl) this.touchEl.style.display = 'none';
    try { document.exitPointerLock(); } catch {}
    c.hud.miniRings = null; c.hud.miniSpan = null; c.hud.br = null;
    c.world.probeY = -Infinity;
    sk.reset(c.world.spawn[0], c.world.spawn[1], Math.PI / 2);
    c.player().group.visible = true;
    c.camera.fov = 62; c.camera.updateProjectionMatrix();
    c.say('Back in Lumbridge. V for another RuneRoyale.', '#f6c');
  }
}
