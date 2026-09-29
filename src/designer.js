// Startup outfit screen: five armour rows (< name >), Random, and a big SKATE button — Tutorial Island
// style, fast and easy. Each row cycles a short curated list (the metal tiers + a few specials), resolved
// by name from the exported kit. Party hats are never exported, so they can never be offered.
import { loadKit } from './rsanim.js';

const TIERS = ['Bronze', 'Iron', 'Steel', 'Black', 'Mithril', 'Adamant', 'Rune'];
const ROWS = [
  [0, 'Helm', [...TIERS.map(t => `${t} full helm`), 'Dragon med helm', 'Rune full helm (g)', 'Zamorak full helm', 'Guthix full helm', 'Saradomin full']],
  [4, 'Body', [...TIERS.map(t => `${t} platebody`), 'Dragon chainbody', 'Rune platebody (g)', 'Zamorak platebody', 'Guthix platebody', 'Saradomin plate']],
  [7, 'Legs', [...TIERS.map(t => `${t} platelegs`), 'Rune platelegs (g)', 'Zamorak platelegs', 'Guthix platelegs', 'Saradomin legs']],
  [5, 'Shield', [...TIERS.map(t => `${t} kiteshield`), 'Dragon sq shield', 'Rune kiteshield (g)', 'Zamorak kiteshield', 'Guthix kiteshield', 'Saradomin kite']],
  [1, 'Cape', ['Cape', 'Cape of legends', 'Cape of zamorak', 'Cape of guthix', 'Cape of saradomin']],
];

const css = `
#designer { position: fixed; inset: 0; z-index: 7; display: none; align-items: center; pointer-events: none;
  background: linear-gradient(90deg, rgba(0,0,0,.78) 0%, rgba(0,0,0,.55) 38%, rgba(0,0,0,0) 62%); font: 14px monospace; }
#designer .card { pointer-events: auto; margin-left: max(16px, 7vw); width: 300px; max-width: calc(100% - 32px); box-sizing: border-box;
  padding: 14px 16px 16px; background: #3e3529; border: 3px solid #1e1a13; box-shadow: inset 0 0 0 2px #5d5242, 4px 4px 0 #000; user-select: none; }
#designer .ttl { text-align: center; font: 900 40px Impact, 'Arial Black', sans-serif; color: #ff981f; letter-spacing: 3px; text-shadow: 3px 3px 0 #000; }
#designer .sub { text-align: center; color: #ff0; margin: 2px 0 12px; text-shadow: 1px 1px 0 #000; }
#designer .row { display: grid; grid-template-columns: 34px 1fr 34px; align-items: center; margin: 6px 0; }
#designer .arr { height: 34px; cursor: pointer; background: #2b251d; border: 2px solid #1e1a13; color: #ff0; font: bold 18px monospace;
  display: flex; align-items: center; justify-content: center; }
#designer .arr:hover { background: #5d5242; }
#designer .mid { text-align: center; line-height: 1.2; }
#designer .mid b { display: block; color: #ff981f; font-weight: normal; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
#designer .mid span { color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
#designer .btns { display: flex; gap: 8px; margin-top: 14px; }
#designer .btn { flex: 1; text-align: center; padding: 10px 0; cursor: pointer; background: #2b251d; border: 2px solid #1e1a13; color: #ff0; font-weight: bold; }
#designer .btn.go { flex: 2; background: #5a7a22; color: #fff; font-size: 17px; letter-spacing: 2px; }
#designer .btn:hover { filter: brightness(1.25); }
#designer .hint { color: #a99; font-size: 11px; text-align: center; margin-top: 8px; }
@media (max-width: 600px) { #designer { align-items: flex-end; background: linear-gradient(0deg, rgba(0,0,0,.8), rgba(0,0,0,0) 70%); }
  #designer .card { margin: 0 auto 12px; } #designer .ttl { font-size: 28px; } }`;

export class Designer {
  constructor({ onPreview, onSave }) {
    this.onPreview = onPreview; this.onSave = onSave; this.open = false;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    this.el = document.createElement('div'); this.el.id = 'designer';
    this.el.addEventListener('keydown', e => e.stopPropagation());
    document.body.appendChild(this.el);
  }

  async show(outfit, first) {
    this.first = first;
    this.saved = outfit ? structuredClone(outfit) : null;
    this.o = structuredClone(outfit || { g: 0, items: {}, kits: {} });
    this.o.items ||= {}; this.o.kits ||= {};
    [this.kit] = await loadKit(this.o.g ? 1 : 0);
    this.lists = ROWS.map(([slot, label, names]) => {
      const opts = [{ v: null, name: 'Nothing' }];
      const seen = {};
      for (const n of names) for (const p of this.kit.parts) {
        if (p.kind !== 'item' || p.slot !== slot || p.name !== n) continue;
        seen[n] = (seen[n] || 0) + 1;                       // plain "Cape" comes in several colours
        opts.push({ v: p.id, name: n === 'Cape' ? `Cape ${seen[n]}` : n });
        if (n !== 'Cape') break;
      }
      return { slot, label, opts };
    });
    this.open = true; this.el.style.display = 'flex'; this.hud(false);
    this.render(); this.preview();
  }

  hide() { this.open = false; this.el.style.display = 'none'; this.hud(true); }
  hud(on) { const h = document.getElementById('hud'); if (h) h.style.visibility = on ? '' : 'hidden'; }

  render() {
    const el = this.el; el.innerHTML = '';
    const add = (tag, cls, parent, text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = text; parent.appendChild(e); return e; };
    const card = add('div', 'card', el);
    add('div', 'ttl', card, 'RUNESKATE');
    add('div', 'sub', card, this.first ? 'Suit up, then hit the streets.' : 'Change your armour');
    for (const { slot, label, opts } of this.lists) {
      const r = add('div', 'row', card);
      const L = add('div', 'arr', r, '<'), mid = add('div', 'mid', r), R = add('div', 'arr', r, '>');
      add('b', '', mid, label); const val = add('span', '', mid);
      const idx = () => Math.max(0, opts.findIndex(c => c.v === (this.o.items[slot] ?? null)));
      const draw = () => { val.textContent = opts[idx()].name; };
      const step = d => {
        const c = opts[(idx() + d + opts.length) % opts.length];
        if (c.v === null) delete this.o.items[slot]; else this.o.items[slot] = c.v;
        draw(); this.preview();
      };
      L.onclick = () => step(-1); R.onclick = () => step(1);
      r.addEventListener('wheel', e => { e.preventDefault(); step(e.deltaY > 0 ? 1 : -1); }, { passive: false });
      draw();
    }
    const b = add('div', 'btns', card);
    add('div', 'btn', b, 'Random').onclick = () => this.random();
    if (!this.first) add('div', 'btn', b, 'Cancel').onclick = () => { this.hide(); this.onPreview(this.saved); };
    add('div', 'btn go', b, 'SKATE!').onclick = () => { this.hide(); this.onSave(structuredClone(this.o)); };
    add('div', 'hint', card, this.first ? 'Press O in game to change it later.' : 'Click the arrows or scroll a row.');
  }

  random() {
    const tier = Math.floor(Math.random() * 12);            // mostly one matching set, sometimes a mix
    for (const { slot, opts } of this.lists) {
      const c = Math.random() < 0.7 && opts[1 + tier] ? opts[1 + tier] : opts[Math.floor(Math.random() * opts.length)];
      if (c.v === null) delete this.o.items[slot]; else this.o.items[slot] = c.v;
    }
    this.render(); this.preview();
  }

  preview() {
    clearTimeout(this.t);
    this.t = setTimeout(() => this.onPreview(structuredClone(this.o)), 40);
  }
}
