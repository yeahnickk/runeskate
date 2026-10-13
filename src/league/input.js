// Rune League's controls, RL's layout three ways in, one shape out ({ throttle, steer, pitch, yaw, roll, jump, boost,
// handbrake } for the car, plus ballcam / board / chat for the client):
//  keys (RL's PC defaults): W S throttle (and nose down / up in the air), A D steer (yaw in the air), right mouse jump,
//    left mouse boost, SHIFT powerslide + air roll (A D roll while held), Q E air roll left / right, SPACE ball cam
//    on / off, TAB the scoreboard, 1-4 quick chat, ESC pause. No mouse? J jump, K boost, CTRL / C slide, F ball cam
//  a pad: RT / LT throttle / reverse, left stick steer + pitch, A jump, B boost, X powerslide + air roll, LB RB air
//    roll left / right, Y ball cam, BACK the scoreboard, d-pad quick chat, START pause
//  touch: a stick on the left (steer, pitch; pull it right back to reverse), JUMP / BOOST / SLIDE / BALL CAM buttons
export const TOUCH = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);

export class LeagueInput {
  constructor(canvas) {
    this.keys = new Set(); this.mouse = new Set(); this.q = { ballcam: false, pause: false, chat: 0 }; this.padPrev = {};
    this.touch = { x: 0, y: 0, jump: 0, boost: 0, slide: 0, id: null, ox: 0, oy: 0 }; this.steer = 0;
    addEventListener('keydown', e => {
      if (e.target?.tagName === 'INPUT') return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) {
        if (e.code === 'Space' || e.code === 'KeyF') this.q.ballcam = true;
        if (e.code === 'Escape' || e.code === 'KeyP') this.q.pause = true;
        const d = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code); if (d >= 0) this.q.chat = d + 1;
      }
      this.keys.add(e.code);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.clear(); });
    canvas.addEventListener('mousedown', e => { this.mouse.add(e.button); if (e.button === 1) { this.q.ballcam = true; e.preventDefault(); } });
    addEventListener('mouseup', e => this.mouse.delete(e.button));
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }
  /** the touch stick (the left of the screen) and buttons ([data-k] = jump | boost | slide | cam) */
  bindTouch(root, stickEl, knobEl) {
    for (const el of root.querySelectorAll('[data-k]')) {
      const k = el.dataset.k, on = e => { e.preventDefault(); if (k === 'cam') this.q.ballcam = true; else this.touch[k] = 1; el.classList.add('on'); }, off = e => { e.preventDefault(); if (k !== 'cam') this.touch[k] = 0; el.classList.remove('on'); };
      el.addEventListener('touchstart', on, { passive: false }); el.addEventListener('touchend', off, { passive: false }); el.addEventListener('touchcancel', off, { passive: false });
      el.addEventListener('mousedown', on); el.addEventListener('mouseup', off); el.addEventListener('mouseleave', off);
    }
    const T = this.touch, R = 60;
    const move = (x, y) => { let dx = x - T.ox, dy = y - T.oy; const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; } T.x = dx / R; T.y = dy / R; knobEl.style.transform = `translate(${dx}px, ${dy}px)`; };
    stickEl.addEventListener('touchstart', e => { e.preventDefault(); const t = e.changedTouches[0]; T.id = t.identifier; const r = stickEl.getBoundingClientRect(); T.ox = r.left + r.width / 2; T.oy = r.top + r.height / 2; move(t.clientX, t.clientY); }, { passive: false });
    stickEl.addEventListener('touchmove', e => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === T.id) move(t.clientX, t.clientY); }, { passive: false });
    const end = e => { for (const t of e.changedTouches) if (t.identifier === T.id) { T.id = null; T.x = T.y = 0; knobEl.style.transform = ''; } };
    stickEl.addEventListener('touchend', end); stickEl.addEventListener('touchcancel', end);
  }
  read(dt, touchOn, grounded) {
    const K = c => this.keys.has(c), M = b => this.mouse.has(b);
    const fwd = (K('KeyW') || K('ArrowUp') ? 1 : 0) - (K('KeyS') || K('ArrowDown') ? 1 : 0);
    let side = (K('KeyD') || K('ArrowRight') ? 1 : 0) - (K('KeyA') || K('ArrowLeft') ? 1 : 0);
    let throttle = fwd, pitch = -fwd, jump = M(2) || K('KeyJ'), boost = M(0) || K('KeyK');
    let slide = K('ShiftLeft') || K('ShiftRight') || K('ControlLeft') || K('ControlRight') || K('KeyC'), rollL = K('KeyQ'), rollR = K('KeyE'), board = K('Tab');
    let analog = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const b = i => p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0, ax = p.axes[0] || 0, ay = p.axes[1] || 0, dz = v => Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88;
      if (dz(ax) || dz(ay)) { side = dz(ax); pitch = dz(ay); analog = true; }
      const rt = b(7), lt = b(6); if (rt > 0.05 || lt > 0.05) throttle = rt - lt;
      if (b(0)) jump = true; if (b(1)) boost = true; if (b(2)) slide = true; if (b(4)) rollL = true; if (b(5)) rollR = true; if (b(8)) board = true;
      const edge = (i, k) => { const on = b(i) > 0.5; if (on && !this.padPrev[i]) k(); this.padPrev[i] = on; };
      edge(3, () => this.q.ballcam = true); edge(9, () => this.q.pause = true);
      edge(12, () => this.q.chat = 1); edge(15, () => this.q.chat = 2); edge(14, () => this.q.chat = 3); edge(13, () => this.q.chat = 4);
      break;
    }
    if (touchOn) {
      const T = this.touch; side = T.x; pitch = T.y; analog = true;
      throttle = T.y > 0.72 && Math.abs(T.x) < 0.5 ? -1 : 1;     // (the gas is on for you: pull the stick right back to reverse)
      if (T.jump) jump = true; if (T.boost) boost = true; if (T.slide) slide = true;
    }
    // keys snap to full lock: ease the steering a touch so a tap is a nudge (sticks are analogue already)
    if (!analog) { const r = Math.abs(side) > Math.abs(this.steer) ? 14 : 20; this.steer += (side - this.steer) * Math.min(1, dt * r); side = this.steer; } else this.steer = side;
    const roll = rollL || rollR ? (rollR ? 1 : 0) - (rollL ? 1 : 0) : slide && !grounded ? side : 0;
    const yaw = slide && !grounded ? 0 : side;
    return { throttle, steer: side, pitch, yaw, roll, jump, boost, handbrake: slide, board };
  }
  take(k) { const v = this.q[k]; this.q[k] = k === 'chat' ? 0 : false; return v; }
}
