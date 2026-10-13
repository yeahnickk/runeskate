// Rune League online, the browser's half: talks to netserver.js over /league-ws. The server's match is the truth; ours
// runs ahead of it on our own inputs so the car answers at once. Each snapshot: load the server's state, then replay
// the inputs it hasn't had yet (2 ticks each, as it runs them); everyone else carries on with their last inputs. The
// jump that makes leaves a visual offset that eases away, so corrections never snap on screen.
import { Match, packIn, unpackIn, TICK } from './match.js';

const RULE = new Set(['kickoff', 'go', 'goal', 'shot', 'save', 'demo', 'zero', 'ot', 'end', 'respawn']);

export class LeagueNet {
  /** on: { welcome(match, meId), roster(match), event(e), chat(id, a, b), status(text), full() } */
  constructor(setup, on) {
    this.on = on; this.seq = 0; this.sent = []; this.m = null; this.me = null; this.acc = 0; this.ping = 0; this.off = new Map();
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/league-ws';
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.ws.send(JSON.stringify({ t: 'hello', name: setup.name, body: setup.body, theme: setup.theme, hat: setup.hat, boom: setup.boom }));
    this.ws.onclose = () => { this.closed = true; on.status?.('disconnected from the server'); };
    this.ws.onerror = () => on.status?.("can't reach the server");
    this.ws.onmessage = e => this.msg(JSON.parse(e.data));
  }
  close() { this.closed = true; try { this.ws.close(); } catch {} }
  build(cars, s) {
    const m = new Match({ players: cars, seed: 1, replayT: 4 }); m.load(s); this.m = m; this.me = m.cars.find(c => c.id === this.meId) || null;
    this.sent = []; this.off.clear(); return m;
  }
  msg(o) {
    if (o.t === 'w') { this.meId = o.you; this.build(o.cars, o.s); this.on.welcome?.(this.m, this.me); return; }
    if (o.t === 'new') { if (!this.meId) return; this.build(o.cars, o.s); this.on.welcome?.(this.m, this.me); return; }
    if (o.t === 'r') { if (!this.m) return; const s = this.m.save(); const keep = this.m.cars; this.build(o.cars, s); for (const c of this.m.cars) { const k = keep.find(x => x.id === c.id); if (k) c.st = k.st; } this.on.roster?.(this.m, this.me); return; }
    if (o.t === 'full') { this.on.full?.(); return; }
    if (o.t === 'qc') { this.on.chat?.(o.id, o.a, o.b); return; }
    if (o.t === 's' && this.m) this.snapshot(o);
  }
  snapshot(o) {
    const m = this.m, was = new Map(m.cars.map(c => [c.id, c.p.slice()])), wasB = m.ball.p.slice();
    m.load(o.s);
    // drop the inputs the server has had; replay the rest on top of its state
    this.sent = this.sent.filter(i => i.s > o.ack);
    if (this.me) for (const i of this.sent) { this.me.in = i.in; m.tickOnce(); m.tickOnce(); }
    m.events.length = 0;
    // the visual offset: where things were drawn minus where they are now (eases to nothing in render())
    for (const c of m.cars) { const p0 = was.get(c.id); if (!p0) continue; const d = [p0[0] - c.p[0], p0[1] - c.p[1], p0[2] - c.p[2]], o0 = this.off.get(c.id) || [0, 0, 0]; const n = d.map((v, i) => v + o0[i]); this.off.set(c.id, Math.hypot(...n) > 600 ? [0, 0, 0] : n); }
    const ob = this.off.get('ball') || [0, 0, 0], db = [wasB[0] + ob[0] - m.ball.p[0], wasB[1] + ob[1] - m.ball.p[1], wasB[2] + ob[2] - m.ball.p[2]]; this.off.set('ball', Math.hypot(...db) > 600 ? [0, 0, 0] : db);
    for (const e of o.ev || []) this.on.event?.(e);
  }
  /** each frame: our input in, the local match run ahead (2 ticks per input, sent 60 times a second) */
  update(dt, inp) {
    const m = this.m; if (!m) return;
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= TICK * 2) {
      this.acc -= TICK * 2;
      const s = ++this.seq, p = packIn(inp); this.sent.push({ s, in: unpackIn(p) }); if (this.sent.length > 120) this.sent.shift();
      if (this.me) this.me.in = unpackIn(p);
      m.tickOnce(); m.tickOnce();
      // (the rules are the server's: drop our own goals and kickoffs, keep the feel: touches, jumps, pads...)
      m.events = m.events.filter(e => !RULE.has(e.t));
      if (this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'i', i: this.sent.slice(-4).map(i => [i.s, packIn(i.in)]) }));
    }
    for (const [k, o] of this.off) { const f = Math.exp(-dt * 12); o[0] *= f; o[1] *= f; o[2] *= f; }
  }
  /** where to draw a car (or 'ball'): the predicted spot plus what's left of the last correction */
  drawn(id, p) { const o = this.off.get(id); return o ? [p[0] + o[0], p[1] + o[1], p[2] + o[2]] : p; }
  chat(a, b) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'qc', a, b })); }
}
