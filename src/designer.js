// Startup outfit screen: one row per slot (< name >), Random, and a big SKATE button — Tutorial Island
// style, fast and easy. Rows are FASHIONSCAPE only (user, 2026-09-29): rares, holiday items, trimmed and
// god armour, dragon, dragonhide, costumes. No plain metal armour. Items are picked by their obj.sym name
// (the exported part's `key`), so every colour of a partyhat / mask / cape is its own entry.
import { loadKit } from './rsanim.js';

const C = (k, n) => [k, n];                                   // [obj.sym key, label]
const colours = (fmt, name, list) => list.map(c => C(fmt.replace('*', c), `${name} (${c})`));
const TRIM = (piece, name) => [
  C(`rune_${piece}_trim`, `Rune ${name} (t)`), C(`rune_${piece}_gold`, `Rune ${name} (g)`),
  C(`adamant_${piece}_trim`, `Adamant ${name} (t)`), C(`adamant_${piece}_gold`, `Adamant ${name} (g)`),
  C(`black_${piece}_trim`, `Black ${name} (t)`), C(`black_${piece}_gold`, `Black ${name} (g)`),
];
const GOD = (piece, name) => [C(`rune_${piece}_zamorak`, `Zamorak ${name}`), C(`rune_${piece}_saradomin`, `Saradomin ${name}`), C(`rune_${piece}_guthix`, `Guthix ${name}`)];
const DHIDE = [['black', 'black_'], ['red', 'red_'], ['blue', 'blue_'], ['green', '']];

// RARES ONLY (user, 2026-09-29): no plain metal, no everyday clothes. Holiday rares, trimmed/gilded and god
// armour, dragon, dragonhide, Treasure Trail hats, the Mime set, pirate gear, rare capes/boots/necks.
const ROWS = [
  [0, 'Head', [
    ...['red', 'yellow', 'blue', 'green', 'purple', 'white'].map(c => C(`${c}_partyhat`, `Partyhat (${c})`)),
    C('santa_hat', 'Santa hat'), ...colours('halloweenmask_*', 'Halloween mask', ['red', 'green', 'blue']), C('bunnyears', 'Bunny ears'),
    ...TRIM('full_helm', 'full helm'), ...GOD('full_helm', 'full helm'), C('dragon_med_helm', 'Dragon med helm'),
    C('highwaymanmask', 'Highwayman mask'), C('robinhoodhat', 'Robin hood hat'), ...colours('cavalier_*', 'Cavalier', ['black', 'dark', 'brown']),
    ...colours('berret_*', 'Beret', ['black', 'white', 'blue']), C('piratehat', 'Pirate hat'), C('eye_patch', 'Eye patch'), C('macro_mime_mask', 'Mime mask'),
  ]],
  [4, 'Body', [
    ...TRIM('platebody', 'platebody'), ...GOD('platebody', 'platebody'), C('dragon_chainbody', 'Dragon chainbody'),
    ...DHIDE.map(([c, p]) => C(`${p}dragonhide_body`, `${c[0].toUpperCase() + c.slice(1)} dhide body`)),
    C('zamrobetop', 'Robe of Zamorak'), C('macro_mime_top', 'Mime top'),
  ]],
  [7, 'Legs', [
    ...TRIM('platelegs', 'platelegs'), ...GOD('platelegs', 'platelegs'),
    ...DHIDE.map(([c, p]) => C(`${p}dragonhide_chaps`, `${c[0].toUpperCase() + c.slice(1)} dhide chaps`)),
    C('zamrobebottom', 'Robe of Zamorak'), C('macro_mime_legs', 'Mime legs'),
  ]],
  [5, 'Off-hand', [
    ...TRIM('kiteshield', 'kiteshield'), ...GOD('kiteshield', 'kiteshield'),
    C('dragon_sq_shield', 'Dragon sq shield'), C('antidragonbreathshield', 'Anti-dragon shield'),
  ]],
  [1, 'Cape', [
    C('cape_of_legends', 'Cape of legends'), C('zamorak_cape', 'Zamorak cape'), C('saradomin_cape', 'Saradomin cape'), C('guthix_cape', 'Guthix cape'),
  ]],
  [2, 'Neck', [
    C('strung_dragonstone_amulet', 'Dragonstone amulet'), C('dragonstone_necklace', 'Dragon necklace'),
    C('zqdeadbeads', 'Beads of the dead'), C('ikov_pendantoflucien', 'Pendant of Lucien'),
  ]],
  [9, 'Hands', [
    ...DHIDE.map(([c, p]) => C(`${p}dragon_vambraces`, `${c[0].toUpperCase() + c.slice(1)} dhide vambs`)),
    C('piratehook', 'Pirate hook'), C('macro_mime_gloves', 'Mime gloves'),
  ]],
  [10, 'Feet', [
    C('ikov_bootsoflightness', 'Boots of lightness'), C('boots_ranger', 'Ranger boots'), C('boots_wizard', 'Wizard boots'),
    C('macro_mime_boots', 'Mime boots'), C('death_spikedboots', 'Spiked boots'),
  ]],
];

// Random: often a matching set, otherwise a free mix. Keys missing for the current gender are skipped.
const SETS = [
  ...['rune', 'adamant', 'black'].flatMap(m => ['trim', 'gold'].map(t => [`${m}_full_helm_${t}`, `${m}_platebody_${t}`, `${m}_platelegs_${t}`, `${m}_kiteshield_${t}`])),
  ...['zamorak', 'saradomin', 'guthix'].map(g => [`rune_full_helm_${g}`, `rune_platebody_${g}`, `rune_platelegs_${g}`, `rune_kiteshield_${g}`, `${g}_cape`]),
  ...['black', 'red', 'blue'].map(c => [`${c}_dragonhide_body`, `${c}_dragonhide_chaps`, `${c}_dragon_vambraces`, 'boots_ranger']),
  ['macro_mime_mask', 'macro_mime_top', 'macro_mime_legs', 'macro_mime_gloves', 'macro_mime_boots'],
  ['piratehat', 'eye_patch', 'piratehook'],
  ['dragon_med_helm', 'dragon_chainbody', 'dragon_sq_shield', 'dragonstone_necklace'],
];

const css = `
#designer { position: fixed; inset: 0; z-index: 7; display: none; align-items: center; pointer-events: none;
  background: linear-gradient(90deg, rgba(0,0,0,.78) 0%, rgba(0,0,0,.55) 38%, rgba(0,0,0,0) 62%); font: 14px monospace; }
#designer .card { pointer-events: auto; margin-left: max(16px, 7vw); width: 300px; max-width: calc(100% - 32px); box-sizing: border-box;
  padding: 14px 16px 16px; background: #3e3529; border: 3px solid #1e1a13; box-shadow: inset 0 0 0 2px #5d5242, 4px 4px 0 #000; user-select: none; }
#designer .ttl { text-align: center; font: 900 40px Impact, 'Arial Black', sans-serif; color: #ff981f; letter-spacing: 3px; text-shadow: 3px 3px 0 #000; }
#designer .sub { text-align: center; color: #ff0; margin: 2px 0 12px; text-shadow: 1px 1px 0 #000; }
#designer .row { display: grid; grid-template-columns: 34px 1fr 34px; align-items: center; margin: 6px 0; }
#designer .arr { height: 34px; cursor: pointer; touch-action: manipulation; background: #2b251d; border: 2px solid #1e1a13; color: #ff0; font: bold 18px monospace;
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
  #designer .card { margin: 0 auto 12px; } #designer .ttl { font-size: 28px; } }
/* phones on their side (and other short screens): two columns, the buttons up top, scrolls if it still doesn't fit */
@media (max-height: 620px) {
  #designer { align-items: center; background: linear-gradient(90deg, rgba(0,0,0,.78) 0%, rgba(0,0,0,.5) 45%, rgba(0,0,0,0) 65%); }
  #designer .card { margin: 0 0 0 max(8px, env(safe-area-inset-left)); width: min(520px, 58vw); max-height: calc(100% - 16px); overflow-y: auto;
    -webkit-overflow-scrolling: touch; padding: 8px 10px; display: grid; grid-template-columns: 1fr 1fr; column-gap: 10px; align-content: start; }
  #designer .ttl { grid-column: 1 / -1; order: -2; font-size: 22px; letter-spacing: 2px; }
  #designer .sub, #designer .hint { display: none; }
  #designer .btns { grid-column: 1 / -1; order: -1; margin: 4px 0 4px; }
  #designer .btn { padding: 8px 0; } #designer .btn.go { font-size: 15px; }
  #designer .row { margin: 3px 0; grid-template-columns: 30px 1fr 30px; } #designer .arr { height: 30px; }
  #designer .mid span { font-size: 12px; }
}`;

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
    this.byKey = new Map(this.kit.parts.filter(p => p.kind === 'item' && p.key).map(p => [p.key, p]));
    this.lists = ROWS.map(([slot, label, entries]) => {
      const opts = [{ v: null, name: 'Nothing' }];
      for (const [k, name] of entries) { const p = this.byKey.get(k); if (p && p.slot === slot) opts.push({ v: p.id, name }); }
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
    this.o.items = {};
    const set = Math.random() < 0.6 ? SETS[Math.floor(Math.random() * SETS.length)] : [];
    for (const { slot, opts } of this.lists) {
      const fromSet = set.map(k => this.byKey.get(k)).find(p => p && p.slot === slot);
      const pick = fromSet ? { v: fromSet.id } : (Math.random() < 0.8 ? opts[1 + Math.floor(Math.random() * (opts.length - 1))] : opts[0]);
      if (pick && pick.v !== null) this.o.items[slot] = pick.v;
    }
    this.render(); this.preview();
  }

  preview() {
    clearTimeout(this.t);
    this.t = setTimeout(() => this.onPreview(structuredClone(this.o)), 40);
  }
}
