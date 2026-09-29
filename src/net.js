// Multiplayer client: one WebSocket to serve.ts. Login = the rs-sdk style URL (?name=..&password=..)
// or the start screen form; unknown names are registered on the spot.
export class Net {
  constructor() { this.ws = null; this.me = null; this.players = new Map(); this.handlers = {}; this.lastSend = 0; }
  on(t, f) { this.handlers[t] = f; return this; }
  emit(t, m) { this.handlers[t]?.(m); }
  connect(name, password) {
    return new Promise((ok, bad) => {
      const ws = this.ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
      let done = false;
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, password }));
      ws.onerror = () => { if (!done) { done = true; bad(new Error('server unreachable')); } };
      ws.onclose = () => { if (!done) { done = true; bad(new Error('connection closed')); } else this.emit('closed', {}); };
      ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.t === 'denied') { done = true; bad(new Error(m.why)); ws.close(); return; }
        if (m.t === 'welcome') {
          this.me = m; for (const p of m.players) this.players.set(p.id, p);
          done = true; ok(m); for (const p of m.players) this.emit('join', p); return;
        }
        if (m.t === 'join') { this.players.set(m.id, m); }
        const p = this.players.get(m.id);
        if (m.t === 'st' && p) p.st = m.s;
        if (m.t === 'xp' && p) p.xp = m.xp;
        if (m.t === 'outfit' && p) p.outfit = m.outfit;
        if (m.t === 'leave') this.players.delete(m.id);
        this.emit(m.t, m);
      };
    });
  }
  get online() { return this.ws && this.ws.readyState === 1 && this.me; }
  send(m) { if (this.online) this.ws.send(JSON.stringify(m)); }
  /** rate-limited skater state */
  state(s, now) { if (now - this.lastSend < 66) return; this.lastSend = now; this.send({ t: 'st', s }); }
}
