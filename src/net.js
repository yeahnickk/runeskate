// Multiplayer client: one WebSocket to serve.ts. Login = the rs-sdk style URL (?name=..&password=..)
// or the start screen form; unknown names are registered on the spot.
//
// The socket WILL drop (Cloudflare tunnel hiccups, the server restarting on a deploy). It reconnects on its
// own, and anything that must reach your account (XP, outfit, runes found) is queued while offline and sent
// on reconnect, so nothing earned during a blip is lost on the next refresh.
export class Net {
  constructor() {
    this.ws = null; this.me = null; this.players = new Map(); this.handlers = {}; this.lastSend = 0;
    this.creds = null; this.retry = 0; this.stopped = false; this.everWelcomed = false;
    this.pendingXP = 0; this.pendingOutfit = null; this.pendingProg = [];
  }
  on(t, f) { this.handlers[t] = f; return this; }
  emit(t, m) { this.handlers[t]?.(m); }
  connect(name, password) {
    this.creds = [name, password]; this.stopped = false;
    return this.open();
  }
  open() {
    const [name, password] = this.creds;
    return new Promise((ok, bad) => {
      const ws = this.ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
      let done = false, welcomed = false;
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, password }));
      ws.onerror = () => { if (!done) { done = true; bad(new Error('server unreachable')); } };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        if (!done) { done = true; bad(new Error('connection closed')); }
        if (welcomed) { this.me = null; this.players.clear(); this.emit('closed', {}); }
        if (welcomed || this.retry > 0) this.reconnect();
      };
      ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.t === 'denied') { done = true; this.stopped = true; bad(new Error(m.why)); ws.close(); return; }
        if (m.t === 'kicked') { this.stopped = true; this.emit('kicked', m); return; }       // logged in elsewhere: don't fight it
        if (m.t === 'welcome') {
          const again = this.everWelcomed; this.everWelcomed = true;
          welcomed = true; this.retry = 0;
          this.me = m; this.players.clear(); for (const p of m.players) this.players.set(p.id, p);
          this.flush();
          done = true; ok(m);
          if (again) this.emit('rejoined', m);
          for (const p of m.players) this.emit('join', p);
          return;
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
  reconnect() {
    if (this.stopped || !this.creds) return;
    const wait = Math.min(15000, 1000 * 2 ** Math.min(this.retry, 4)) + Math.random() * 500;
    this.retry++;
    this.emit('reconnecting', { wait });
    setTimeout(() => this.open().catch(() => {}), wait);
  }
  get online() { return this.ws && this.ws.readyState === 1 && this.me; }
  send(m) { if (this.online) this.ws.send(JSON.stringify(m)); }
  /** things that must reach the account: sent now, or queued until the next (re)connect */
  addXP(n) { this.pendingXP += n; this.flush(); }
  setOutfit(o) { this.pendingOutfit = o; this.flush(); }
  prog(p) { this.pendingProg.push(p); this.flush(); }
  flush() {
    if (!this.online) return;
    while (this.pendingXP > 0) { const n = Math.min(this.pendingXP, 250000); this.send({ t: 'xp', add: n }); this.pendingXP -= n; }
    if (this.pendingOutfit) { this.send({ t: 'outfit', outfit: this.pendingOutfit }); this.pendingOutfit = null; }
    for (const p of this.pendingProg.splice(0)) this.send({ t: 'prog', ...p });
  }
  /** rate-limited skater state */
  state(s, now) { if (now - this.lastSend < 66) return; this.lastSend = now; this.send({ t: 'st', s }); }
}
