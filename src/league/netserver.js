// Rune League online: one 3v3 match that never stops, run by serve.ts (/league-ws). Bots hold each side at 3; a person
// who joins takes a bot's place (the bot's car, score and all). The server runs the real match at RL's 120 Hz (the sim
// is pure and cheap) and owns everything; browsers send their inputs and get the whole state 30 times a second, then
// run ahead of it on their own inputs (rollback, as RL does), so their own car answers at once. Idle when nobody's on.
import { Match, packIn, unpackIn, TICK } from './match.js';
import { botInput } from './bots.js';

const SIDE = 3, SNAP = 4, DIFF = 'pro';                    // 3 a side; a snapshot every 4 ticks (30 Hz); the bots' level
const NAMES = ['Bob', 'Hans', 'Duke Horacio', 'Fred', 'Aggie', 'Ned', 'Wizard Mizgog', 'Father Aereck', 'Gillie', 'Seth', 'Doric', 'Bartender'];
const BOOMS = ['party', 'dragon', 'barrage', 'guthix', 'cannon'];
const GODS = ['sara', 'zam', 'guthix', 'arma', 'bandos', 'zaros', 'seren'], BODIES = ['kart', 'mine', 'dragon'];   // (cart/models.js's keys: that file needs three.js)
const RULE = new Set(['kickoff', 'go', 'goal', 'shot', 'save', 'demo', 'zero', 'ot', 'end', 'respawn']);

export class LeagueServer {
  constructor(clean = s => s) {
    this.clean = clean; this.clients = new Set(); this.n = 0; this.endAt = 0; this.ev = [];
    this.newMatch();
    this.last = performance.now();
    setInterval(() => this.loop(), 8);
  }
  newMatch(keep) {
    const players = [];
    for (let t = 0; t < 2; t++) for (let i = 0; i < SIDE; i++) players.push(this.botSpec(t, players.length));
    this.m = new Match({ players, seed: (Math.random() * 1e9) | 0, replayT: 4 });
    this.endAt = 0;
    for (const c of keep || []) { c.car = null; this.seat(c); }
    this.sendAll({ t: 'new', ...this.roster(), s: this.m.save() });
  }
  botSpec(team, i) {
    const gods = GODS, bodies = BODIES;
    return { id: 'bot' + (++this.n), name: NAMES[(i + this.n) % NAMES.length], team, bot: true, diff: DIFF, body: bodies[(i * 5 + this.n) % bodies.length], theme: gods[(i * 3 + this.n) % gods.length], boom: BOOMS[(i + this.n) % BOOMS.length] };
  }
  roster() { return { cars: this.m.cars.map(c => ({ id: c.id, name: c.name, team: c.team, bot: c.bot, body: c.body, theme: c.theme, hat: c.hat, boom: c.boom })) }; }
  people(team) { return [...this.clients].filter(c => c.car && c.car.team === team).length; }
  /** take a bot's seat on the side with fewer people (the car keeps its place on the pitch and its score) */
  seat(c) {
    const team = this.people(0) < this.people(1) ? 0 : this.people(1) < this.people(0) ? 1 : (Math.random() < 0.5 ? 0 : 1);
    const t = this.m.cars.some(o => o.team === team && o.bot) ? team : 1 - team;
    const car = this.m.cars.find(o => o.team === t && o.bot);
    if (!car) { c.ws.send(JSON.stringify({ t: 'full' })); return false; }
    Object.assign(car, { bot: false, name: c.name, body: c.body, theme: c.theme, hat: c.hat, boom: c.boom, ai: null });
    car.in = unpackIn(null); c.car = car; c.q = []; c.ack = 0;
    return true;
  }
  unseat(c) {
    const car = c.car; if (!car) return; c.car = null;
    const b = this.botSpec(car.team, this.m.cars.indexOf(car));
    Object.assign(car, { bot: true, diff: DIFF, name: b.name, body: b.body, theme: b.theme, hat: 'god', boom: b.boom, ai: null });
  }

  // ------------------------------------------------------------------ the loop: 120 Hz, catching up on real time
  loop() {
    const now = performance.now(), dt = Math.min(0.25, (now - this.last) / 1000); this.last = now;
    if (![...this.clients].some(c => c.car)) return;                 // (nobody on: hold still)
    const m = this.m;
    if (m.state === 'end') { if (!this.endAt) this.endAt = now + 12000; else if (now > this.endAt) this.newMatch([...this.clients].filter(c => c.car)); return; }
    this.acc = Math.min((this.acc || 0) + dt, 0.25);
    while (this.acc >= TICK) {
      this.acc -= TICK;
      for (const c of this.clients) {
        if (!c.car) continue;
        // their inputs, one per 2 ticks in the order sent (a backlog is trimmed so they never fall far behind)
        if (m.tick % 2 === 0) { if (c.q.length > 6) c.q.splice(0, c.q.length - 3); const i = c.q.shift(); if (i) { c.car.in = i.in; c.ack = i.s; } }
      }
      for (const car of m.cars) if (car.bot) car.in = botInput(m, car, TICK);
      m.tickOnce();
      for (const e of m.events) if (RULE.has(e.t)) this.ev.push(e);
      m.events.length = 0;
      if (m.tick % SNAP === 0) this.snap();
      if (m.state === 'end') break;
    }
  }
  snap() {
    const s = JSON.stringify({ t: 's', s: this.m.save(), ev: this.ev.length ? this.ev : undefined });
    this.ev = [];
    for (const c of this.clients) if (c.car || c.watch) c.ws.send(`{"ack":${c.ack},` + s.slice(1));
  }
  sendAll(o) { const s = JSON.stringify(o); for (const c of this.clients) c.ws.send(s); }

  // ------------------------------------------------------------------ sockets (serve.ts forwards /league-ws here)
  open(ws) { const c = { ws, car: null, name: 'Player', q: [], ack: 0, chatT: 0 }; ws.data.c = c; this.clients.add(c); }
  close(ws) { const c = ws.data.c; if (!c) return; this.clients.delete(c); const had = c.car; this.unseat(c); if (had) this.sendAll({ t: 'r', ...this.roster() }); }
  message(ws, raw) {
    const c = ws.data.c; if (!c) return;
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    switch (m.t) {
      case 'hello': {
        if (c.car) return;
        c.name = this.clean(String(m.name || '').replace(/[^\w -]/g, '').trim().slice(0, 12)) || 'Player' + (this.n % 1000);
        c.body = BODIES.includes(m.body) ? m.body : 'kart'; c.theme = GODS.includes(m.theme) ? m.theme : 'sara'; c.hat = typeof m.hat === 'string' ? m.hat.slice(0, 12) : 'god'; c.boom = BOOMS.includes(m.boom) ? m.boom : 'party';
        if (!this.seat(c)) return;
        c.ws.send(JSON.stringify({ t: 'w', you: c.car.id, ...this.roster(), s: this.m.save() }));
        for (const o of this.clients) if (o !== c) o.ws.send(JSON.stringify({ t: 'r', ...this.roster() }));
        return;
      }
      case 'i': {                                                   // inputs: [[seq, packed], ...] (resent until acked)
        if (!c.car || !Array.isArray(m.i)) return;
        for (const [s, p] of m.i.slice(-8)) if (Number.isInteger(s) && s > (c.q.length ? c.q[c.q.length - 1].s : c.ack)) c.q.push({ s, in: unpackIn(p) });
        return;
      }
      case 'qc': {                                                  // quick chat (only the four lines a category has)
        const now = Date.now(); if (!c.car || now - c.chatT < 1500) return; c.chatT = now;
        const a = m.a | 0, b = m.b | 0; if (a < 1 || a > 4 || b < 1 || b > 4) return;
        this.sendAll({ t: 'qc', id: c.car.id, a, b });
        return;
      }
    }
  }
}
export { packIn };
