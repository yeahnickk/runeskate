// CODScape's controls, three ways in, one shape out: keyboard + mouse (pointer lock), a gamepad (Call of Duty's
// default layout, a response curve on the sticks; aim assist is applied by main.js, which knows where the enemy
// are) and touch (a floating move stick, a FIRE button you can also drag to aim, like COD Mobile).
// read() -> { move: {x, z, sprint, crouch, crouchEdge, jump}, gun: {fire, ads, reload, swap, knife, nade},
//             look: {dyaw, dpitch}, breath, board, pause, respawn, device: 'kbm' | 'pad' | 'touch', stick: {x, y} }

export const SETTINGS_KEY = 'codscape.settings';
export const DEFAULTS = { sens: 1.0, adsSens: 0.75, padSens: 1.0, invert: false, assist: true, toggleAds: false, fov: 80, volume: 0.8, touchSens: 1.0 };
export function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULTS }; } }
export function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} }

// mouse: radians per count at sensitivity 1. 0.0008 = a 360 in ~7850 counts, ~25 cm at 800 DPI: the middle of
// where COD players sit (the settings slider runs 0.2x..3x)
export const MOUSE_RAD = 0.0008;

const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const dz = (v, d = 0.14) => Math.abs(v) < d ? 0 : Math.sign(v) * (Math.abs(v) - d) / (1 - d);

export class Input {
  constructor(canvas, settings) {
    this.c = canvas; this.s = settings; this.base = MOUSE_RAD;
    this.keys = new Set(); this.edges = new Set(); this.mouse = { dx: 0, dy: 0, l: false, r: false }; this.locked = false;
    this.device = matchMedia('(pointer: coarse)').matches ? 'touch' : 'kbm';
    this.adsToggled = false; this.padPrev = []; this.wheel = 0; this.enabled = false;
    addEventListener('keydown', e => {
      if (!this.enabled) return;
      const k = e.code; if (!this.keys.has(k)) this.edges.add(k); this.keys.add(k); this.device = 'kbm';
      if (this.locked ? !/^F\d/.test(k) : ['Tab', 'Space', 'KeyC'].includes(k) || k.startsWith('Arrow')) e.preventDefault();   // (in play, swallow everything: a stray Ctrl+S / Ctrl+D would pop Chrome's save / bookmark dialogs over the game)
    });
    addEventListener('keyup', e => { this.keys.delete(e.code); });
    addEventListener('blur', () => { this.keys.clear(); this.mouse.l = this.mouse.r = false; });
    canvas.addEventListener('mousedown', e => {
      if (!this.enabled || this.device === 'touch') return;
      if (!this.locked) { this.lock(); this.edges.add('Click'); return; }
      if (e.button === 0) { this.mouse.l = true; this.edges.add('Mouse0'); }
      if (e.button === 2) { this.mouse.r = true; this.edges.add('Mouse2'); }
      this.device = 'kbm';
    });
    addEventListener('mouseup', e => { if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    // (Chrome reports a big bogus jump as the lock engages, and now and then on a busy frame: skip the first
    // instant after locking and ignore any single event that moved further than a hand can)
    addEventListener('mousemove', e => {
      if (!this.locked || performance.now() - this.lockAt < 150) return;
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
    });
    addEventListener('wheel', e => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked; this.locked = document.pointerLockElement === canvas;
      if (this.locked && !was) { this.lockAt = performance.now(); this.mouse.dx = this.mouse.dy = 0; }
      if (was && !this.locked && this.enabled) this.edges.add('Unlocked');
    });
    this.touch = null;
  }
  lock() { try { const p = this.c.requestPointerLock({ unadjustedMovement: true }); p?.catch?.(() => this.c.requestPointerLock()); } catch { try { this.c.requestPointerLock(); } catch {} } }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  edge(k) { return this.edges.has(k); }

  /** dt: the frame; zoom: the current FOV divisor (ADS slows the look in step with the zoom) */
  read(dt, zoom = 1, adsAmt = 0) {
    const K = this.keys, s = this.s, out = { move: { x: 0, z: 0, sprint: false, crouch: false, crouchEdge: false, jump: false }, gun: { fire: false, ads: false, reload: false, swap: false, knife: false, nade: false }, look: { dyaw: 0, dpitch: 0 }, breath: false, board: false, pause: false, unlocked: false, respawn: false, device: this.device, stick: { x: 0, y: 0 } };
    const m = out.move, g = out.gun;
    // ---- keyboard + mouse
    m.x = (K.has('KeyD') ? 1 : 0) - (K.has('KeyA') ? 1 : 0); m.z = (K.has('KeyW') ? 1 : 0) - (K.has('KeyS') ? 1 : 0);
    m.sprint = K.has('ShiftLeft') || K.has('ShiftRight'); out.breath = m.sprint;
    m.crouch = K.has('KeyC'); m.crouchEdge = this.edge('KeyC');   // (not Ctrl: Ctrl+W closes the tab, Ctrl+S opens Save, and no page can stop that)
    m.jump = this.edge('Space');
    g.fire = this.mouse.l; g.reload = this.edge('KeyR'); g.swap = this.edge('Digit1') || this.edge('Digit2') || this.edge('KeyQ') || this.wheel !== 0;
    g.knife = this.edge('KeyV') || this.edge('KeyF'); g.nade = K.has('KeyG');
    if (s.toggleAds) { if (this.edge('Mouse2')) this.adsToggled = !this.adsToggled; g.ads = this.adsToggled; } else g.ads = this.mouse.r;
    out.board = K.has('Tab'); out.pause = this.edge('Escape') || this.edge('KeyP'); out.unlocked = this.edge('Unlocked');
    out.respawn = this.edge('Space') || this.edge('Mouse0') || this.edge('Click');
    const msens = MOUSE_RAD * s.sens * (1 - adsAmt + adsAmt * s.adsSens / zoom);   // aimed: slower by the zoom, like COD's relative ADS
    out.look.dyaw -= this.mouse.dx * msens; out.look.dpitch -= this.mouse.dy * msens * (s.invert ? -1 : 1);
    this.mouse.dx = this.mouse.dy = 0; this.wheel = 0;
    // ---- gamepad
    const pad = [...(navigator.getGamepads?.() || [])].find(p => p && p.connected);
    if (pad) {
      const b = i => pad.buttons[i]?.pressed || (pad.buttons[i]?.value || 0) > 0.4, was = i => this.padPrev[i];
      const lx = dz(pad.axes[0] || 0), ly = dz(pad.axes[1] || 0), rx = dz(pad.axes[2] || 0, 0.12), ry = dz(pad.axes[3] || 0, 0.12);
      const any = lx || ly || rx || ry || pad.buttons.some(x => x.pressed);
      if (any) this.device = 'pad';
      if (this.device === 'pad') {
        if (lx || ly) { m.x = lx; m.z = -ly; }
        if (b(PAD.L3) && !was(PAD.L3)) this.padSprint = true;
        if (Math.hypot(lx, ly) < 0.3) this.padSprint = false;
        m.sprint = m.sprint || this.padSprint || b(PAD.L3); out.breath = b(PAD.L3);
        if (b(PAD.B)) m.crouch = true; if (b(PAD.B) && !was(PAD.B)) m.crouchEdge = true;
        if (b(PAD.A) && !was(PAD.A)) { m.jump = true; out.respawn = true; }
        g.fire = g.fire || b(PAD.RT); g.ads = g.ads || b(PAD.LT);
        if (b(PAD.X) && !was(PAD.X)) g.reload = true;
        if (b(PAD.Y) && !was(PAD.Y)) g.swap = true;
        if ((b(PAD.R3) && !was(PAD.R3)) || (b(PAD.LB) && !was(PAD.LB))) g.knife = true;
        g.nade = g.nade || b(PAD.RB);
        out.board = out.board || b(PAD.BACK);
        if (b(PAD.START) && !was(PAD.START)) out.pause = true;
        if (b(PAD.RT) && !was(PAD.RT)) out.respawn = true;
        // the right stick: a curve (fine aim near the middle, fast turns at the edge), slower aimed
        const mag = Math.hypot(rx, ry), curve = mag > 0 ? Math.pow(mag, 1.8) / mag : 0;
        const speed = 4.2 * s.padSens * (1 - adsAmt + adsAmt * 0.55 / Math.sqrt(zoom));
        out.look.dyaw -= rx * curve * speed * dt; out.look.dpitch -= ry * curve * speed * 0.75 * dt * (s.invert ? -1 : 1);
        out.stick = { x: rx, y: ry };
      }
      this.padPrev = pad.buttons.map(x => x.pressed || x.value > 0.4);
    }
    // ---- touch
    if (this.touch && this.device === 'touch') this.touch.apply(out, dt, zoom, adsAmt);
    this.edges.clear();
    return out;
  }
}

/** on-screen controls for phones and tablets */
export class TouchControls {
  constructor(root, settings) {
    this.s = settings; this.look = { dx: 0, dy: 0 }; this.stick = null; this.held = new Set(); this.taps = new Set(); this.adsOn = false;
    const el = this.el = document.createElement('div'); el.id = 'ctouch';
    el.innerHTML = `
      <div class="zone move"><div class="base"><div class="nub"></div></div></div>
      <div class="zone look"></div>
      <div class="b fire" data-h="fire">FIRE</div>
      <div class="b fire2" data-h="fire">FIRE</div>
      <div class="b ads" data-t="ads">AIM</div>
      <div class="b jump" data-t="jump">JUMP</div>
      <div class="b crouch" data-t="crouch">DUCK</div>
      <div class="b reload" data-t="reload">RELOAD</div>
      <div class="b swap" data-t="swap">SWAP</div>
      <div class="b nade" data-h="nade">NADE</div>
      <div class="b knife" data-t="knife">KNIFE</div>
      <div class="b small board" data-h="board">SCORE</div>
      <div class="b small pause" data-t="pause">II</div>`;
    root.appendChild(el);
    const cap = (n, e) => { try { n.setPointerCapture(e.pointerId); } catch {} };
    // move stick: appears under the thumb; past the rim = sprint
    const zone = el.querySelector('.move'), base = el.querySelector('.base'), nub = el.querySelector('.nub'), R = 56;
    zone.addEventListener('pointerdown', e => {
      e.preventDefault(); cap(zone, e); this.stick = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
      const r = zone.getBoundingClientRect(); base.style.left = (e.clientX - r.left) + 'px'; base.style.top = (e.clientY - r.top) + 'px'; base.style.display = 'block'; nub.style.transform = '';
      this.taps.add('respawn');
    });
    zone.addEventListener('pointermove', e => {
      const s = this.stick; if (!s || s.id !== e.pointerId) return;
      let dx = e.clientX - s.x, dy = e.clientY - s.y; const l = Math.hypot(dx, dy);
      s.over = l > R * 1.25;
      if (l > R) { dx *= R / l; dy *= R / l; }
      s.dx = dx / R; s.dy = dy / R; nub.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    const endStick = e => { if (this.stick && this.stick.id === e.pointerId) { this.stick = null; base.style.display = 'none'; } };
    zone.addEventListener('pointerup', endStick); zone.addEventListener('pointercancel', endStick);
    // look: drag anywhere on the right (and on FIRE)
    const drags = new Map();
    const lookDown = (n, e) => { cap(n, e); drags.set(e.pointerId, [e.clientX, e.clientY]); };
    const lookMove = e => { const p = drags.get(e.pointerId); if (!p) return; this.look.dx += e.clientX - p[0]; this.look.dy += e.clientY - p[1]; drags.set(e.pointerId, [e.clientX, e.clientY]); };
    const lookUp = e => drags.delete(e.pointerId);
    const lz = el.querySelector('.look');
    lz.addEventListener('pointerdown', e => { e.preventDefault(); lookDown(lz, e); this.taps.add('respawn'); });
    lz.addEventListener('pointermove', lookMove); lz.addEventListener('pointerup', lookUp); lz.addEventListener('pointercancel', lookUp);
    for (const b of el.querySelectorAll('.b')) {
      b.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation(); b.classList.add('on');
        if (b.dataset.h) { this.held.add(b.dataset.h); if (b.dataset.h === 'fire') lookDown(b, e); else cap(b, e); }
        if (b.dataset.t) { this.taps.add(b.dataset.t); cap(b, e); }
        this.taps.add('respawn');
      });
      b.addEventListener('pointermove', e => { if (b.dataset.h === 'fire') lookMove(e); });
      const up = e => { b.classList.remove('on'); if (b.dataset.h) this.held.delete(b.dataset.h); lookUp(e); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
    }
  }
  show(on) { this.el.style.display = on ? 'block' : 'none'; if (!on) { this.held.clear(); this.stick = null; } }
  apply(out, dt, zoom, adsAmt) {
    const m = out.move, g = out.gun;
    if (this.stick) { m.x = this.stick.dx; m.z = -this.stick.dy; m.sprint = this.stick.over || this.stick.dy < -0.92; }
    g.fire = g.fire || this.held.has('fire'); g.nade = g.nade || this.held.has('nade');
    if (this.taps.has('ads')) this.adsOn = !this.adsOn;
    g.ads = g.ads || this.adsOn;
    if (this.taps.has('jump')) m.jump = true;
    if (this.taps.has('crouch')) { this.crouchOn = !this.crouchOn; m.crouchEdge = true; }
    m.crouch = m.crouch || !!this.crouchOn;
    if (this.taps.has('reload')) g.reload = true;
    if (this.taps.has('swap')) { g.swap = true; this.adsOn = false; }
    if (this.taps.has('knife')) g.knife = true;
    if (this.taps.has('pause')) out.pause = true;
    if (this.taps.has('respawn')) out.respawn = true;
    out.board = out.board || this.held.has('board');
    const k = 0.0052 * this.s.touchSens * (1 - adsAmt + adsAmt * 0.6 / Math.sqrt(zoom));
    out.look.dyaw -= this.look.dx * k; out.look.dpitch -= this.look.dy * k * (this.s.invert ? -1 : 1);
    this.look.dx = this.look.dy = 0; this.taps.clear();
    if (m.jump || m.sprint) this.crouchOn = false;
  }
}

export const TOUCH_CSS = `
#ctouch { position: fixed; inset: 0; z-index: 3; display: none; pointer-events: none; -webkit-user-select: none; user-select: none; touch-action: none; }
#ctouch .zone { position: absolute; pointer-events: auto; touch-action: none; }
#ctouch .move { left: 0; top: 25%; bottom: 0; width: 40%; }
#ctouch .look { right: 0; top: 0; bottom: 0; width: 60%; }
#ctouch .base { position: absolute; width: 112px; height: 112px; margin: -56px 0 0 -56px; border-radius: 50%; border: 3px solid rgba(255,255,255,.35); background: rgba(0,0,0,.2); display: none; }
#ctouch .nub { position: absolute; left: 50%; top: 50%; width: 50px; height: 50px; margin: -25px 0 0 -25px; border-radius: 50%; background: rgba(255,152,31,.6); border: 2px solid #000; }
#ctouch .b { position: absolute; pointer-events: auto; touch-action: none; display: grid; place-items: center; border-radius: 50%; font: bold 11px monospace; color: #ff0;
  background: rgba(40,30,15,.62); border: 2px solid #5a4a2a; box-shadow: 2px 2px 0 rgba(0,0,0,.6); width: 58px; height: 58px; }
#ctouch .b.on { background: rgba(255,152,31,.8); color: #000; }
#ctouch .fire { right: calc(env(safe-area-inset-right) + 26px); bottom: calc(env(safe-area-inset-bottom) + 110px); width: 86px; height: 86px; font-size: 14px; background: rgba(120,20,10,.6); }
#ctouch .fire2 { left: calc(env(safe-area-inset-left) + 22px); top: 26%; width: 56px; height: 56px; background: rgba(120,20,10,.5); }
#ctouch .ads { right: calc(env(safe-area-inset-right) + 128px); bottom: calc(env(safe-area-inset-bottom) + 150px); width: 64px; height: 64px; }
#ctouch .jump { right: calc(env(safe-area-inset-right) + 30px); bottom: calc(env(safe-area-inset-bottom) + 18px); }
#ctouch .crouch { right: calc(env(safe-area-inset-right) + 100px); bottom: calc(env(safe-area-inset-bottom) + 14px); }
#ctouch .reload { right: calc(env(safe-area-inset-right) + 132px); bottom: calc(env(safe-area-inset-bottom) + 82px); width: 50px; height: 50px; font-size: 9px; }
#ctouch .swap { right: calc(env(safe-area-inset-right) + 128px); top: 120px; width: 50px; height: 50px; font-size: 10px; }
#ctouch .nade { right: calc(env(safe-area-inset-right) + 22px); top: 180px; width: 50px; height: 50px; font-size: 10px; }
#ctouch .knife { right: calc(env(safe-area-inset-right) + 80px); top: 180px; width: 50px; height: 50px; font-size: 10px; }
#ctouch .small { width: 44px; height: 44px; border-radius: 8px; font-size: 9px; }
#ctouch .board { left: calc(env(safe-area-inset-left) + 150px); top: 12px; }
#ctouch .pause { left: calc(env(safe-area-inset-left) + 200px); top: 12px; }
`;
