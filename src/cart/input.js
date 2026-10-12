// CartScape's controls, three ways in, one shape out ({ gas, brake, steer (+ left), drift, item, back }):
// keys (WASD / arrows, SPACE or SHIFT to hop and drift, E / CTRL / X to fire, C looks back), a gamepad (A or RT gas,
// B or LT brake, a bumper drifts, X fires, Y looks back), or the touch buttons (the gas is on for you: steer, drift, fire).
export const TOUCH = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);

export class CartInput {
  constructor() {
    this.keys = new Set(); this.itemQ = false; this.pause = false; this.touch = { l: 0, r: 0, drift: 0, brake: 0 }; this.padPrev = {};
    this.steer = 0;
    addEventListener('keydown', e => {
      if (e.target?.tagName === 'INPUT') return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      if (!e.repeat && ['KeyE', 'ControlLeft', 'ControlRight', 'KeyX'].includes(e.code)) this.itemQ = true;
      if (!e.repeat && (e.code === 'Escape' || e.code === 'KeyP')) this.pause = true;
      this.keys.add(e.code);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }
  /** wire the on-screen buttons: el.dataset.k = l | r | drift | brake | item */
  bindTouch(root) {
    for (const el of root.querySelectorAll('[data-k]')) {
      const k = el.dataset.k, on = e => { e.preventDefault(); if (k === 'item') this.itemQ = true; else this.touch[k] = 1; el.classList.add('on'); }, off = e => { e.preventDefault(); if (k !== 'item') this.touch[k] = 0; el.classList.remove('on'); };
      el.addEventListener('touchstart', on, { passive: false }); el.addEventListener('touchend', off, { passive: false }); el.addEventListener('touchcancel', off, { passive: false });
      el.addEventListener('mousedown', on); el.addEventListener('mouseup', off); el.addEventListener('mouseleave', off);
    }
  }
  read(dt, touchOn) {
    const K = c => this.keys.has(c);
    let gas = K('KeyW') || K('ArrowUp') ? 1 : 0, brake = K('KeyS') || K('ArrowDown') ? 1 : 0;
    let steer = (K('KeyA') || K('ArrowLeft') ? 1 : 0) - (K('KeyD') || K('ArrowRight') ? 1 : 0);
    let drift = K('Space') || K('ShiftLeft') || K('ShiftRight'), back = K('KeyC');
    // a gamepad, if one's awake
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const b = i => p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0, ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.15) steer = -Math.sign(ax) * (Math.abs(ax) - 0.15) / 0.85;
      if (b(14)) steer = 1; if (b(15)) steer = -1;
      gas = Math.max(gas, b(0), b(7)); brake = Math.max(brake, b(1), b(6) > 0.3 ? b(6) : 0);
      if (b(4) || b(5)) drift = true; if (b(3) > 0.5) back = true;
      const it = b(2) > 0.5; if (it && !this.padPrev.it) this.itemQ = true; this.padPrev.it = it;
      const st = b(9) > 0.5; if (st && !this.padPrev.st) this.pause = true; this.padPrev.st = st;
      break;
    }
    if (touchOn) { steer += this.touch.l - this.touch.r; brake = Math.max(brake, this.touch.brake); gas = this.touch.brake ? 0 : 1; if (this.touch.drift) drift = true; }
    // keys snap to full lock: ease the wheel over a few frames instead, so a tap is a nudge (the pad's stick is already analogue)
    const want = Math.max(-1, Math.min(1, steer)), r = Math.abs(want) > Math.abs(this.steer) ? 9 : 14;
    this.steer += (want - this.steer) * Math.min(1, dt * r);
    const item = this.itemQ; this.itemQ = false;
    return { gas, brake, steer: this.steer, drift, item, back };
  }
  takePause() { const p = this.pause; this.pause = false; return p; }
}
