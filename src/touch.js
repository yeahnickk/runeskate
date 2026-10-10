// Touch controls (phones, tablets): a thumbstick that appears wherever the left thumb lands (up = push,
// down = brake, sideways = steer / spin / balance), an OLLIE button (hold to crouch, let go to pop), GRAB /
// MANUAL and SLIDE buttons, and a small column of extras (camera, walk, replay, chat, menu). The rest of the
// right side of the screen is the flick-it pad, same as the mouse: swipe down then up to ollie, up-left kickflip,
// up-right heelflip, sideways shove-it. Buttons press the same keys the keyboard does, so everything else
// in the game works unchanged.

const CSS = `
#touch { position: fixed; inset: 0; z-index: 3; pointer-events: none; display: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
#touch .stickzone { position: absolute; left: 0; top: 22%; bottom: 0; width: 42%; pointer-events: auto; touch-action: none; }
#touch .base { position: absolute; width: 124px; height: 124px; margin: -62px 0 0 -62px; border-radius: 50%; border: 3px solid rgba(255,255,255,.35);
  background: rgba(0,0,0,.18); display: none; }
#touch .nub { position: absolute; left: 50%; top: 50%; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%; background: rgba(255,255,0,.55); border: 2px solid #000; }
#touch .hintstick { position: absolute; left: calc(env(safe-area-inset-left) + 120px); bottom: calc(env(safe-area-inset-bottom) + 40px); width: 96px; height: 96px; border-radius: 50%;
  border: 2px dashed rgba(255,255,255,.35); display: grid; place-items: center; font: bold 11px monospace; color: rgba(255,255,255,.7); text-align: center; pointer-events: none; }
#touch .tb { position: absolute; pointer-events: auto; touch-action: none; display: grid; place-items: center; text-align: center; border-radius: 50%;
  font: bold 12px monospace; color: #ff0; background: rgba(40,30,15,.62); border: 2px solid #5a4a2a; box-shadow: 2px 2px 0 rgba(0,0,0,.6); }
#touch .tb.on { background: rgba(255,200,0,.75); color: #000; }
#touch .ollie { right: calc(env(safe-area-inset-right) + 22px); bottom: calc(env(safe-area-inset-bottom) + 24px); width: 96px; height: 96px; font-size: 15px; }
#touch .grab { right: calc(env(safe-area-inset-right) + 128px); bottom: calc(env(safe-area-inset-bottom) + 18px); width: 64px; height: 64px; }
#touch .slide { right: calc(env(safe-area-inset-right) + 132px); bottom: calc(env(safe-area-inset-bottom) + 92px); width: 56px; height: 56px; }
#touch .col { position: absolute; left: calc(env(safe-area-inset-left) + 8px); top: max(150px, 30%); display: grid; grid-template-columns: 42px 42px; gap: 6px; pointer-events: none; }
#touch .col .tb { position: static; width: 42px; height: 42px; border-radius: 10px; font-size: 9px; }
#touch .flickhint { position: absolute; right: calc(env(safe-area-inset-right) + 22px); bottom: calc(env(safe-area-inset-bottom) + 156px); font: 10px monospace;
  color: rgba(255,255,255,.75); text-shadow: 1px 1px 0 #000; text-align: right; pointer-events: none; transition: opacity 1s; }
#tmenu { position: fixed; inset: 0; z-index: 9; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,.55); }
#tmenu .box { display: grid; grid-template-columns: repeat(2, minmax(140px, 1fr)); gap: 10px; padding: 16px; background: rgba(30,24,16,.94); border: 3px solid #5a4a2a; }
#tmenu button { font-size: 15px; padding: 12px 10px; }
#rotate { position: fixed; left: 50%; top: 40%; transform: translate(-50%, -50%); z-index: 4; padding: 10px 16px; font: bold 14px monospace; color: #ff0;
  background: rgba(0,0,0,.7); border: 2px solid #5a4a2a; pointer-events: none; display: none; text-align: center; }
@media (orientation: portrait) { #touch.live ~ #rotate { display: block; } #touch .flickhint, #touch .hintstick { display: none; } #touch .ollie { width: 84px; height: 84px; } }
`;

const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch {} };   // keep a finger that slides off the button

export class Touch {
  /** press(key) / release(key): the same as a key going down / up. extra: { menu: [[label, fn], ...], chat } */
  constructor({ press, release, menu, chat }) {
    Object.assign(this, { press, release, menu, chat });
    this.steer = 0; this.push = false; this.brake = false; this.stick = null;
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
    const el = this.el = document.createElement('div');
    el.id = 'touch';
    el.innerHTML = `<div class="stickzone"><div class="base"><div class="nub"></div></div></div>
      <div class="hintstick">STEER<br>&amp; PUSH</div>
      <div class="flickhint">swipe here: down then up = ollie<br>up-left kickflip · up-right heelflip</div>
      <div class="tb ollie" data-k=" ">OLLIE</div>
      <div class="tb grab" data-k="q">GRAB<br>MANUAL</div>
      <div class="tb slide" data-k="shift">SLIDE</div>
      <div class="col">
        <div class="tb" data-tap="c">CAM</div>
        <div class="tb" data-tap="e">WALK</div>
        <div class="tb" data-tap="x">REPLAY</div>
        <div class="tb" data-act="chat">CHAT</div>
        <div class="tb" data-act="menu">MENU</div>
      </div>`;
    document.body.appendChild(el);
    document.body.appendChild(Object.assign(document.createElement('div'), { id: 'rotate', innerHTML: 'Turn your phone sideways<br>for the best view' }));
    // hold buttons: key down on touch, up on release
    for (const b of el.querySelectorAll('[data-k]')) {
      const k = b.dataset.k;
      b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); capture(b, e); b.classList.add('on'); this.press(k); });
      const up = e => { e.stopPropagation(); if (!b.classList.contains('on')) return; b.classList.remove('on'); this.release(k); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
    }
    // tap buttons
    for (const b of el.querySelectorAll('[data-tap],[data-act]')) {
      b.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        if (b.dataset.tap) { this.press(b.dataset.tap); this.release(b.dataset.tap); }
        else if (b.dataset.act === 'chat') this.chat();
        else this.showMenu(true);
      });
    }
    // the floating stick
    const zone = el.querySelector('.stickzone'), base = el.querySelector('.base'), nub = el.querySelector('.nub'), R = 52;
    zone.addEventListener('pointerdown', e => {
      if (this.stick) return;
      e.preventDefault(); capture(zone, e);
      this.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
      const r = zone.getBoundingClientRect();
      base.style.left = (e.clientX - r.left) + 'px'; base.style.top = (e.clientY - r.top) + 'px'; base.style.display = 'block';
      nub.style.transform = ''; el.querySelector('.hintstick').style.display = 'none';
      this.press(null);                                   // counts as input (audio unlock, idle timer)
    });
    zone.addEventListener('pointermove', e => {
      const s = this.stick; if (!s || e.pointerId !== s.id) return;
      let dx = e.clientX - s.x, dy = e.clientY - s.y; const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      nub.style.transform = `translate(${dx}px, ${dy}px)`;
      const nx = dx / R, ny = dy / R;
      this.steer = Math.abs(nx) > 0.18 ? -Math.sign(nx) * Math.min(1, (Math.abs(nx) - 0.18) / 0.62) : 0;
      this.push = ny < -0.45; this.brake = ny > 0.55;
    });
    const end = e => { const s = this.stick; if (!s || e.pointerId !== s.id) return; this.stick = null; base.style.display = 'none'; this.steer = 0; this.push = this.brake = false; };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end); zone.addEventListener('lostpointercapture', end);
    // the extras menu
    const m = this.menuEl = document.createElement('div');
    m.id = 'tmenu'; m.innerHTML = '<div class="box"></div>';
    const box = m.querySelector('.box');
    for (const [label, fn] of [...this.menu, ['Close', () => {}]]) {
      const b = Object.assign(document.createElement('button'), { textContent: label });
      b.addEventListener('click', e => { e.stopPropagation(); this.showMenu(false); fn(); });
      box.appendChild(b);
    }
    m.addEventListener('pointerdown', e => { e.stopPropagation(); if (e.target === m) this.showMenu(false); });
    document.body.appendChild(m);
  }
  showMenu(on) { this.menuEl.style.display = on ? 'flex' : 'none'; }
  /** on screen while skating; hidden on the start menu, in the replay editor, the outfit designer */
  show(on) {
    this.el.style.display = on ? 'block' : 'none'; this.el.classList.toggle('live', on);
    if (!on && this.stick) { this.stick = null; this.steer = 0; this.push = this.brake = false; }
    if (on && !this.hintT) this.hintT = setTimeout(() => { this.el.querySelector('.flickhint').style.opacity = '0'; }, 15000);
  }
}
