// Teleports: TAB (or the TELEPORT button, which works with a tap) opens a menu of every town, members' land
// included. Pick one with a click/tap, its number key, or the arrows + Enter, and you fade out and back in
// there. A destination that is not streamed in yet is fetched first. The menu also shows the leaderboard
// (TAB used to be the leaderboard on its own). TAB or Esc closes it.
import { PORTAL_HOME as HOME, PORTAL_DESTS as DESTS } from './mapdata.js';
import { levelFor } from './levels.js';

const COOL = 1;                                            // seconds between teleports
const PLACES = [{ ...HOME, sub: 'home', at: HOME.at }, ...DESTS];
const HOTKEYS = '1234567890-=';

const CSS = `
#tpbtn { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 6; display: none; align-items: center; gap: 8px;
  padding: 7px 16px 7px 8px; font: bold 15px monospace; color: #ff0; background: rgba(60,40,90,.85); border: 2px solid #c9f;
  border-radius: 6px; box-shadow: 0 0 14px rgba(190,140,255,.55), 3px 3px 0 #000; cursor: pointer; user-select: none; -webkit-user-select: none;
  touch-action: manipulation; animation: tpglow 2.4s ease-in-out infinite; }
#tpbtn:hover { background: rgba(85,55,125,.95); }
#tpbtn kbd { font: bold 12px monospace; color: #000; background: #ff0; border-radius: 3px; padding: 2px 6px; box-shadow: 0 2px 0 #880; }
#tpbtn.touch kbd { display: none; }
@keyframes tpglow { 50% { box-shadow: 0 0 24px rgba(200,150,255,.9), 3px 3px 0 #000; } }
#tpmenu { position: fixed; inset: 0; z-index: 9; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,.55);
  font-family: monospace; padding: 12px; box-sizing: border-box; }
#tpmenu .box { display: flex; gap: 14px; max-width: 980px; width: 100%; max-height: 100%; background: rgba(30,24,16,.94);
  border: 3px solid #5a4a2a; box-shadow: 4px 4px 0 #000; padding: 14px; box-sizing: border-box; overflow: auto; }
#tpmenu h2 { margin: 0 0 8px; font: bold 22px monospace; color: #ff981f; text-shadow: 2px 2px 0 #000; letter-spacing: 2px; }
#tpmenu .hint { color: #a0927a; font-size: 12px; margin-bottom: 10px; }
#tpmenu .dests { flex: 1.4; min-width: 0; }
#tpmenu .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; }
#tpmenu .d { display: flex; align-items: center; gap: 10px; text-align: left; padding: 9px 10px; font: bold 15px monospace; color: #fff;
  background: #3a3020; border: 2px solid #2e2412; box-shadow: 2px 2px 0 #000; cursor: pointer; touch-action: manipulation; }
#tpmenu .d:hover, #tpmenu .d.sel { background: #5a4a2a; border-color: #ff0; }
#tpmenu .d .n { flex: none; width: 22px; height: 22px; display: grid; place-items: center; font-size: 12px; color: #000; border-radius: 50%; }
#tpmenu .d small { display: block; font: 11px monospace; color: #ff0; opacity: .85; }
#tpmenu .d.here { opacity: .55; }
#tpmenu .top { flex: 1; min-width: 220px; border-left: 2px solid #5a4a2a; padding-left: 14px; }
#tpmenu table { width: 100%; border-collapse: collapse; font-size: 13px; }
#tpmenu td { padding: 2px 4px; white-space: nowrap; } #tpmenu td.r { text-align: right; }
#tpmenu .x { position: absolute; top: 10px; right: 12px; }
@media (max-width: 700px) { #tpmenu .box { flex-direction: column; } #tpmenu .top { border-left: 0; padding-left: 0; border-top: 2px solid #5a4a2a; padding-top: 10px; }
  #tpmenu .grid { grid-template-columns: repeat(2, 1fr); } #tpmenu .d { font-size: 13px; padding: 8px; } }
`;

export class Teleports {
  constructor({ world, sk, hud, audio, ensureAt, getTop, me, touch }) {
    Object.assign(this, { world, sk, hud, audio, ensureAt, getTop, me });
    this.busy = false; this.cool = 0; this.open = false; this.sel = 0;
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
    this.fade = Object.assign(document.createElement('div'), { id: 'tpfade' });
    Object.assign(this.fade.style, { position: 'fixed', inset: '0', background: '#000', opacity: '0', pointerEvents: 'none', transition: 'opacity 0.35s ease', zIndex: '10' });
    document.body.appendChild(this.fade);
    // the always-on button: says TAB on a keyboard, just TELEPORT on a touch screen
    const b = this.btn = document.createElement('div');
    b.id = 'tpbtn'; b.innerHTML = '<kbd>TAB</kbd><span>TELEPORT</span>';
    if (touch) b.classList.add('touch');
    const stop = e => e.stopPropagation();
    for (const ev of ['pointerdown', 'touchstart', 'mousedown']) b.addEventListener(ev, stop, { passive: true });
    b.addEventListener('click', e => { e.stopPropagation(); this.toggle(); });
    document.body.appendChild(b);
    // the menu
    const m = this.el = document.createElement('div');
    m.id = 'tpmenu';
    m.innerHTML = `<div class="box" style="position:relative">
      <div class="dests"><h2>TELEPORT</h2><div class="hint">click / tap a place · or its key · or arrows + ENTER · TAB / ESC closes</div><div class="grid"></div></div>
      <div class="top"><h2>TOP SKATERS</h2><table></table></div>
      <button class="small x">X</button></div>`;
    for (const ev of ['pointerdown', 'touchstart', 'mousedown', 'wheel']) m.addEventListener(ev, stop, { passive: true });
    m.addEventListener('click', e => { if (e.target === m) this.show(false); });
    m.querySelector('.x').addEventListener('click', () => this.show(false));
    const grid = m.querySelector('.grid');
    this.cards = PLACES.map((p, i) => {
      const d = document.createElement('button');
      d.className = 'd';
      d.innerHTML = `<span class="n" style="background:${p.col}">${HOTKEYS[i] || ''}</span><span>${p.name}<small>${p.sub || ''}</small></span>`;
      d.addEventListener('click', e => { e.stopPropagation(); this.pick(i); });
      d.addEventListener('pointerenter', () => { this.sel = i; this.mark(); });
      grid.appendChild(d);
      return d;
    });
    document.body.appendChild(m);
  }

  /** show the TELEPORT button (once the game is running) */
  ready(on = true) { this.btn.style.display = on ? 'flex' : 'none'; }

  toggle() { this.show(!this.open); }
  show(on) {
    if (on && this.busy) return;
    this.open = on;
    this.el.style.display = on ? 'flex' : 'none';
    if (!on) { document.activeElement?.blur?.(); return; }
    this.audio.start?.();
    // the place you're at (or nearest to) is dimmed; selection starts on the next one
    const near = this.nearest();
    this.cards.forEach((c, i) => c.classList.toggle('here', i === near));
    if (this.sel === near) this.sel = (near + 1) % PLACES.length;
    this.mark(); this.drawTop();
  }
  mark() { this.cards.forEach((c, i) => c.classList.toggle('sel', i === this.sel)); }
  nearest() {
    const B = this.world.base, sk = this.sk;
    let best = -1, bd = 40;
    PLACES.forEach((p, i) => { const d = Math.hypot(p.at[0] - B[0] + 0.5 - sk.x, p.at[1] - B[1] + 0.5 - sk.z); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  drawTop() {
    const rows = this.getTop?.() || [], t = this.el.querySelector('table');
    if (!rows.length) { t.innerHTML = '<tr><td style="color:#a0927a">offline / nobody yet</td></tr>'; return; }
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    t.innerHTML = '<tr style="color:#a0927a"><td>#</td><td>NAME</td><td>LVL</td><td class="r">XP</td><td class="r">RUNES</td></tr>' + rows.map((r, i) => {
      const me = this.me && r.name === this.me.name, col = r.own ? '#ffc933' : me ? '#0f0' : i < 3 ? '#ff0' : '#fff';
      return `<tr style="color:${col}"><td>${i + 1}</td><td>${esc(r.name)}${r.on ? ' *' : ''}${r.own ? ' &#9813;' : ''}</td><td>${levelFor(r.xp)}</td><td class="r">${Math.floor(r.xp).toLocaleString()}</td><td class="r" style="color:#0cf">${r.runes || 0}/${r.runeTotal || 100}</td></tr>`;
    }).join('');
  }

  /** a key while the menu is open (k = lowercased key); true = handled */
  key(k) {
    if (!this.open) return false;
    const cols = Math.max(1, Math.round(this.el.querySelector('.grid').clientWidth / (this.cards[0].offsetWidth + 8)) || 1);
    const n = PLACES.length;
    if (k === 'escape' || k === 'tab') this.show(false);
    else if (k === 'enter' || k === ' ') this.pick(this.sel);
    else if (k === 'arrowright' || k === 'd') this.sel = (this.sel + 1) % n;
    else if (k === 'arrowleft' || k === 'a') this.sel = (this.sel - 1 + n) % n;
    else if (k === 'arrowdown' || k === 's') this.sel = Math.min(n - 1, this.sel + cols);
    else if (k === 'arrowup' || k === 'w') this.sel = Math.max(0, this.sel - cols);
    else if (HOTKEYS.includes(k) && HOTKEYS.indexOf(k) < n) this.pick(HOTKEYS.indexOf(k));
    this.mark();
    return true;
  }

  pick(i) {
    this.show(false);
    this.pending = PLACES[i];                              // goes as soon as it can (cooldown, getting up off the floor)
  }

  update(dt) {
    if (this.cool > 0) this.cool -= dt;
    if (this.pending && !this.busy && this.cool <= 0 && this.sk.mode !== 'bail') { const p = this.pending; this.pending = null; this.go(p); }
    if (this.open && (this._tt = (this._tt || 0) - dt) <= 0) { this._tt = 2; this.drawTop(); }
  }

  async go(to) {
    const sk = this.sk, B = this.world.base;
    const x = to.at[0] - B[0] + 0.5, z = to.at[1] - B[1] + 0.5;
    this.busy = true; this.audio.event({ type: 'levelup' }); this.fade.style.opacity = '1';
    const wait = ms => new Promise(r => setTimeout(r, ms));
    await wait(360);
    try { await this.ensureAt(Math.floor(x), Math.floor(z)); }
    catch { this.fade.style.opacity = '0'; this.hud.big('TELEPORT FAILED', '#f00', 'try again in a moment', 2); this.busy = false; this.cool = 3; return; }
    // face away from where the old home portal stood (the open side of every arrival point)
    const back = to.back ? [to.back[0] - B[0] + 0.5, to.back[1] - B[1] + 0.5] : null;
    const heading = back ? Math.atan2(z - back[1], x - back[0]) : Math.PI / 2;
    sk.reset(x, z, heading); await wait(120); this.fade.style.opacity = '0';
    this.hud.big(to.name.toUpperCase(), to.col, to.sub || 'TAB to teleport again', 2.2, true);
    this.busy = false; this.cool = COOL;
  }
}
