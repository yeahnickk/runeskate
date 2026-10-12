// RuneRoyale locker: the cosmetics side of the mode. Matches pay out GP (gold, earned in game only; nothing here
// costs real money) and pass XP. The RuneRoyale Pass has 20 tiers that unlock pickaxe skins, skydive trails and
// weapon wraps as you play; the item shop sells a different few each day for GP. All of it lives in this
// browser (localStorage), and only changes how things look on your own screen.

export const COSMETICS = {
  pick_rune: { k: 'pick', name: 'Rune pickaxe', col: 0x55c8e8, tier: 0 },
  pick_bronze: { k: 'pick', name: 'Bronze pickaxe', col: 0xa86a3a, tier: 0 },
  pick_iron: { k: 'pick', name: 'Iron pickaxe', col: 0x8a8a8a, tier: 2 },
  pick_steel: { k: 'pick', name: 'Steel pickaxe', col: 0xb8c0c8, shop: 300 },
  pick_mithril: { k: 'pick', name: 'Mithril pickaxe', col: 0x4a5aa8, tier: 6 },
  pick_adamant: { k: 'pick', name: 'Adamant pickaxe', col: 0x3a7a4a, shop: 500 },
  pick_dragon: { k: 'pick', name: 'Dragon pickaxe', col: 0xc02020, tier: 12 },
  pick_crystal: { k: 'pick', name: 'Crystal pickaxe', col: 0xc8f0ff, shop: 900 },
  pick_gilded: { k: 'pick', name: 'Gilded pickaxe', col: 0xffc830, tier: 20 },
  trail_none: { k: 'trail', name: 'No trail', col: 0, tier: 0 },
  trail_smoke: { k: 'trail', name: 'Smoke trail', col: 0xb0b0b0, tier: 1 },
  trail_fire: { k: 'trail', name: 'Fire wave trail', col: 0xff7020, tier: 5 },
  trail_ice: { k: 'trail', name: 'Ice barrage trail', col: 0x9ad8ff, shop: 400 },
  trail_nature: { k: 'trail', name: 'Nature rune trail', col: 0x5ad040, tier: 9 },
  trail_shadow: { k: 'trail', name: 'Shadow trail', col: 0x8040c0, shop: 600 },
  trail_party: { k: 'trail', name: 'Party hat trail', col: -1, tier: 16 },        // (-1: every colour)
  wrap_none: { k: 'wrap', name: 'No wrap', col: 0, tier: 0 },
  wrap_gold: { k: 'wrap', name: 'Gold trim wrap', col: 0xd4a020, tier: 4 },
  wrap_obsidian: { k: 'wrap', name: 'Obsidian wrap', col: 0x26262e, shop: 450 },
  wrap_crimson: { k: 'wrap', name: 'Bloodveld wrap', col: 0xa01818, tier: 14 },
  wrap_frost: { k: 'wrap', name: 'Frost wrap', col: 0xa0d8ff, shop: 650 },
  wrap_toxic: { k: 'wrap', name: 'Toxic blowpipe wrap', col: 0x60d020, tier: 18 },
};
export const PASS_TIERS = 20, TIER_XP = 400;
const GP_TIERS = [3, 7, 8, 10, 11, 13, 15, 17, 19];          // pass tiers that pay GP instead of an item
const KEY = 'rr_locker';
const fresh = () => ({ gp: 0, pxp: 0, owned: Object.keys(COSMETICS).filter(k => COSMETICS[k].tier === 0), eq: { pick: 'pick_rune', trail: 'trail_none', wrap: 'wrap_none' } });
const hex = c => '#' + c.toString(16).padStart(6, '0');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
#brlock { position: fixed; left: calc(50% + 118px); bottom: 58px; z-index: 6; display: none; padding: 6px 10px; font: bold 13px monospace; color: #fff; background: rgba(60,40,10,.85);
  border: 2px solid #ffc830; border-radius: 6px; box-shadow: 3px 3px 0 #000; cursor: pointer; user-select: none; -webkit-user-select: none; touch-action: manipulation; }
@media (pointer: coarse) { #brlock { left: 50%; transform: translateX(-50%); bottom: 104px; } }
#brlocker { position: fixed; inset: 0; z-index: 10; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,.6); font-family: monospace; }
#brlocker .box { background: rgba(30,24,16,.97); border: 3px solid #5a4a2a; box-shadow: 4px 4px 0 #000; padding: 14px 18px; color: #fff; width: min(760px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; box-sizing: border-box; }
#brlocker h2 { margin: 0 0 6px; color: #ffc830; font-size: 20px; } #brlocker h3 { margin: 12px 0 6px; color: #ff981f; font-size: 14px; }
#brlocker .bar { height: 12px; background: #1a140a; border: 1px solid #5a4a2a; } #brlocker .bar i { display: block; height: 100%; background: linear-gradient(90deg,#f6c,#ffc830); }
#brlocker .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
#brlocker .it { border: 2px solid #5a4a2a; padding: 6px; background: rgba(0,0,0,.3); font-size: 12px; }
#brlocker .it.on { border-color: #0f0; } #brlocker .sw { display: inline-block; width: 14px; height: 14px; border: 1px solid #000; vertical-align: middle; margin-right: 4px; }
#brlocker button { font-size: 12px; padding: 3px 8px; margin-top: 4px; } #brlocker .x { float: right; }
`;

export class Locker {
  constructor(onChange) {
    this.onChange = onChange || (() => {});
    this.s = fresh();
    try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); if (j && typeof j === 'object') this.s = { ...fresh(), ...j, eq: { ...fresh().eq, ...(j.eq || {}) } }; } catch {}
    this.s.owned = [...new Set([...fresh().owned, ...this.s.owned.filter(k => COSMETICS[k])])];
    if (typeof document === 'undefined') return;
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
    this.btn = Object.assign(document.createElement('div'), { id: 'brlock', textContent: 'LOCKER' }); document.body.appendChild(this.btn);
    this.el = Object.assign(document.createElement('div'), { id: 'brlocker' }); document.body.appendChild(this.el);
    const stop = e => e.stopPropagation();
    for (const x of [this.btn, this.el]) for (const ev of ['pointerdown', 'touchstart', 'mousedown', 'keydown']) x.addEventListener(ev, stop, { passive: true });
    this.btn.addEventListener('click', e => { e.stopPropagation(); this.open(); });
    addEventListener('keydown', e => { if (this.isOpen && e.key === 'Escape') { e.stopImmediatePropagation(); this.close(); } }, true);
    this.el.addEventListener('click', e => {
      const b = e.target.closest?.('button'); if (!b) { if (e.target === this.el) this.close(); return; }
      if (b.dataset.a === 'close') this.close();
      else if (b.dataset.buy) this.buy(b.dataset.buy);
      else if (b.dataset.eq) this.equip(b.dataset.eq);
    });
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch {} this.onChange(); }
  get tier() { return Math.min(PASS_TIERS, Math.floor(this.s.pxp / TIER_XP)); }
  col(k) { return COSMETICS[this.s.eq[k]]?.col ?? 0; }
  /** what the pass gives at a tier */
  reward(t) { if (GP_TIERS.includes(t)) return { gp: 150 }; const id = Object.keys(COSMETICS).find(k => COSMETICS[k].tier === t); return id ? { id } : { gp: 100 }; }
  /** today's shop: four of the shop items, the same for everyone on a given day */
  shop(day = Math.floor(Date.now() / 86400000)) {
    const list = Object.keys(COSMETICS).filter(k => COSMETICS[k].shop);
    let a = (day * 2654435761) >>> 0; const r = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    return list.slice(0, 4);
  }
  /** a match ended: GP and pass XP in, any tiers reached pay out. Returns a line for the results screen */
  award({ won, place, kills, size = 16 }) {
    const gp = 25 + kills * 20 + Math.max(0, size - place) * 4 + (won ? 150 : 0), px = 120 + kills * 60 + Math.max(0, size - place) * 10 + (won ? 400 : 0);
    const t0 = this.tier; this.s.gp += gp; this.s.pxp += px;
    const got = [];
    for (let t = t0 + 1; t <= this.tier; t++) { const rw = this.reward(t); if (rw.gp) { this.s.gp += rw.gp; got.push(`${rw.gp} GP`); } else if (!this.s.owned.includes(rw.id)) { this.s.owned.push(rw.id); got.push(COSMETICS[rw.id].name); } }
    this.save();
    return `+${gp} GP · +${px} pass XP${this.tier > t0 ? ` · PASS TIER ${this.tier}${got.length ? ': ' + got.join(', ') : ''}` : ''}`;
  }
  buy(id) {
    const c = COSMETICS[id]; if (!c?.shop || this.s.owned.includes(id) || this.s.gp < c.shop) return false;
    this.s.gp -= c.shop; this.s.owned.push(id); this.s.eq[c.k] = id; this.save(); this.draw(); return true;
  }
  equip(id) { const c = COSMETICS[id]; if (!c || !this.s.owned.includes(id)) return; this.s.eq[c.k] = id; this.save(); this.draw(); }
  showBtn(on) { if (this.btn) this.btn.style.display = on ? 'block' : 'none'; }
  open() { this.draw(); this.el.style.display = 'flex'; try { document.exitPointerLock(); } catch {} }
  close() { this.el.style.display = 'none'; }
  get isOpen() { return this.el?.style.display === 'flex'; }
  draw() {
    if (!this.el) return;
    const s = this.s, t = this.tier, into = s.pxp - t * TIER_XP, next = t < PASS_TIERS ? this.reward(t + 1) : null;
    const sw = c => c.col === -1 ? '<span class="sw" style="background:linear-gradient(90deg,red,orange,yellow,lime,cyan,violet)"></span>' : `<span class="sw" style="background:${c.col ? hex(c.col) : 'transparent'}"></span>`;
    const card = (id, extra) => { const c = COSMETICS[id], on = s.eq[c.k] === id; return `<div class="it${on ? ' on' : ''}">${sw(c)}${esc(c.name)}<br>${extra}</div>`; };
    const owned = k => Object.keys(COSMETICS).filter(id => COSMETICS[id].k === k && s.owned.includes(id)).map(id => card(id, s.eq[k] === id ? '<b style="color:#0f0">EQUIPPED</b>' : `<button data-eq="${id}">EQUIP</button>`)).join('');
    this.el.innerHTML = `<div class="box"><button class="x" data-a="close">CLOSE</button><h2>RUNEROYALE LOCKER</h2>
      <div>GP: <b style="color:#ffc830">${s.gp.toLocaleString()}</b> <span style="color:#a0927a">(earned in matches, there is nothing to buy with real money)</span></div>
      <h3>RUNEROYALE PASS: TIER ${t} / ${PASS_TIERS}</h3>
      <div class="bar"><i style="width:${t >= PASS_TIERS ? 100 : Math.round(into / TIER_XP * 100)}%"></i></div>
      <div style="font-size:12px;margin-top:3px">${t >= PASS_TIERS ? 'Pass complete!' : `${into} / ${TIER_XP} XP to tier ${t + 1}: ${next.gp ? next.gp + ' GP' : esc(COSMETICS[next.id].name)}`}</div>
      <h3>ITEM SHOP (NEW EVERY DAY)</h3><div class="grid">${this.shop().map(id => card(id, s.owned.includes(id) ? '<span style="color:#0f0">OWNED</span>' : `<button data-buy="${id}" ${s.gp < COSMETICS[id].shop ? 'disabled' : ''}>BUY ${COSMETICS[id].shop} GP</button>`)).join('')}</div>
      <h3>PICKAXES</h3><div class="grid">${owned('pick')}</div>
      <h3>SKYDIVE TRAILS</h3><div class="grid">${owned('trail')}</div>
      <h3>WEAPON WRAPS</h3><div class="grid">${owned('wrap')}</div></div>`;
  }
}
