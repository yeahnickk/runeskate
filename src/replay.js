// Replay editor: the last 30 seconds of your skating (and the skaters near you) are always being kept. X opens
// it: the game pauses and the clip plays back through the same renderer (rig, ragdoll, board), with
//   Space play/pause · ←/→ scrub (Shift = faster) · ↑/↓ speed (1/8x .. 1x) · C camera (follow, tripod,
//   fisheye, orbit) · [ / ] mark in and out · V save the in..out clip as a .webm video · X or Esc back to skating
// The video is recorded in the browser (MediaRecorder on the canvas) and downloaded: nothing leaves the machine.
import * as THREE from 'three';

const KEEP = 30, HZ = 30;
const ANGLES = new Set(['heading', 'body', 'boardYaw', 'boardRoll', 'tumbleAxis', 'yaw', 'roll', 'pitch']);
const SPEEDS = [0.125, 0.25, 0.5, 1];
const CAMS = ['FOLLOW', 'TRIPOD', 'FISHEYE', 'ORBIT'];
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

/** a flat copy of the numbers/strings/booleans on an object (the skater's state, ready to draw) */
function flat(o) {
  const f = {};
  for (const k in o) { const v = o[k]; if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' || v === null) f[k] = v; }
  return f;
}
function mix(a, b, u) {
  if (!b || u <= 0) return a;
  const f = { ...a };
  for (const k in a) {
    const x = a[k], y = b[k];
    if (typeof x === 'number' && typeof y === 'number') f[k] = ANGLES.has(k) ? x + wrap(y - x) * u : x + (y - x) * u;
  }
  return f;
}

export class Replay {
  constructor() {
    this.buf = []; this.acc = 0; this.clock = 0;
    this.open = false; this.t = 0; this.play = true; this.speed = 3; this.cam = 0;
    this.inT = 0; this.outT = 0; this.rec = null;
    this.el = null;
  }

  /** every live frame: keep a snapshot of you (and remotes: id -> state) at HZ */
  record(sk, remotes, dt) {
    this.clock += dt; this.acc += dt;
    if (this.acc < 1 / HZ) return;
    this.acc %= 1 / HZ;
    const me = flat(sk);
    me.board = flat(sk.board);
    if (sk.mode === 'bail' && sk.rag) me.rag = sk.rag.p.map(p => p.slice());
    const others = [];
    for (const [id, r] of remotes) if (r.s && Math.hypot(r.s.x - sk.x, r.s.z - sk.z) < 40) others.push([id, { ...flat(r.s), board: r.s.board ? flat(r.s.board) : null }]);
    this.buf.push({ T: this.clock, me, others });
    while (this.buf.length && this.buf[0].T < this.clock - KEEP) this.buf.shift();
  }

  get t0() { return this.buf.length ? this.buf[0].T : 0; }
  get t1() { return this.buf.length ? this.buf[this.buf.length - 1].T : 0; }

  /** the interpolated frame at time t */
  at(t) {
    const B = this.buf; if (!B.length) return null;
    let lo = 0, hi = B.length - 1;
    const one = f => ({ me: { ...f.me, rag: f.me.rag ? { p: f.me.rag } : undefined }, others: f.others });
    if (t <= B[0].T) return one(B[0]); if (t >= B[hi].T) return one(B[hi]);
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (B[m].T <= t) lo = m; else hi = m; }
    const a = B[lo], b = B[hi], u = (t - a.T) / (b.T - a.T || 1);
    const me = mix(a.me, b.me, u);
    me.board = mix(a.me.board, b.me.board, u);
    if (a.me.rag) me.rag = { p: b.me.rag && a.me.mode === b.me.mode ? a.me.rag.map((p, i) => p.map((v, k) => v + (b.me.rag[i][k] - v) * u)) : a.me.rag };
    const bo = new Map(b.others);
    const others = a.others.map(([id, s]) => { const o = mix(s, bo.get(id), u); o.board = s.board && bo.get(id)?.board ? mix(s.board, bo.get(id).board, u) : s.board; return [id, o]; });
    return { me, others };
  }

  show(on) {
    if (on && this.buf.length < HZ) return false;
    this.open = on;
    if (on) { this.t = this.t0; this.inT = this.t0; this.outT = this.t1; this.play = true; this.tripod = null; }
    this.ui();
    return true;
  }

  /** a key while the editor is open (k = lowercased key) */
  key(k, shift) {
    const step = shift ? 2 : 0.5;
    if (k === ' ') this.play = !this.play;
    else if (k === 'arrowleft') { this.t = Math.max(this.t0, this.t - step); this.play = false; }
    else if (k === 'arrowright') { this.t = Math.min(this.t1, this.t + step); this.play = false; }
    else if (k === 'arrowup') this.speed = Math.min(SPEEDS.length - 1, this.speed + 1);
    else if (k === 'arrowdown') this.speed = Math.max(0, this.speed - 1);
    else if (k === 'c') { this.cam = (this.cam + 1) % CAMS.length; this.tripod = null; }
    else if (k === '[') this.inT = Math.min(this.t, this.outT - 0.5);
    else if (k === ']') this.outT = Math.max(this.t, this.inT + 0.5);
    else if (k === 'v') return 'record';
    this.ui();
    return null;
  }

  /** advance the playhead; returns the frame to draw */
  advance(dt) {
    if (this.play) {
      this.t += dt * SPEEDS[this.speed];
      const end = this.rec ? this.outT : this.t1;
      if (this.t >= end) {
        if (this.rec) this.stopRec();
        else this.t = this.inT;                          // loop the marked part
      }
    }
    this.ui(true);
    return this.at(this.t);
  }

  /** place the camera for frame f (game coords: x, y, z; three.js z is -z) */
  camera(camera, f, dt) {
    const s = f.me, tgt = new THREE.Vector3(s.x, s.y + 0.9, -s.z);
    const mode = CAMS[this.cam];
    let fov = 62;
    if (mode === 'FOLLOW') {
      const sp = Math.hypot(s.vx || 0, s.vz || 0), hx = sp > 0.5 ? s.vx / sp : Math.cos(s.heading), hz = sp > 0.5 ? s.vz / sp : Math.sin(s.heading);
      const want = new THREE.Vector3(s.x - hx * 4, s.y + 1.7, -(s.z - hz * 4));
      if (!this._cp) this._cp = want.clone(); this._cp.lerp(want, 1 - Math.exp(-dt * 5));
      camera.position.copy(this._cp);
    } else if (mode === 'TRIPOD' || mode === 'FISHEYE') {
      if (!this.tripod) {
        // set the tripod beside the line the rider takes over the next couple of seconds
        const ahead = this.at(Math.min(this.t1, this.t + 1.5))?.me || s;
        const mx = (s.x + ahead.x) / 2, mz = (s.z + ahead.z) / 2, dx = ahead.x - s.x, dz = ahead.z - s.z, l = Math.hypot(dx, dz) || 1;
        const side = mode === 'FISHEYE' ? 1.8 : 6, h = mode === 'FISHEYE' ? 0.35 : 2.2;
        this.tripod = new THREE.Vector3(mx - dz / l * side, (s.y + ahead.y) / 2 + h, -(mz + dx / l * side));
      }
      camera.position.copy(this.tripod);
      if (mode === 'FISHEYE') fov = 100;
    } else {
      const a = this.t * 0.6;
      camera.position.set(s.x + Math.cos(a) * 3.6, s.y + 1.4, -(s.z + Math.sin(a) * 3.6));
    }
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.lookAt(tgt);
  }

  // ---- saving a clip: play in..out at the chosen speed while the canvas is recorded
  startRec(canvas) {
    if (this.rec) return 'already recording';
    if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) return 'this browser cannot record video';
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
    if (!type) return 'this browser cannot record webm';
    const chunks = [], mr = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 6e6 });
    mr.ondataavailable = e => e.data.size && chunks.push(e.data);
    mr.onstop = () => {
      const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })), a = document.createElement('a');
      a.href = url; a.download = `runeskate-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
      this.onSaved?.();
    };
    this.rec = mr; this.t = this.inT; this.play = true; this.tripod = null;
    mr.start(250);
    this.ui();
    return null;
  }
  stopRec() { const r = this.rec; this.rec = null; this.play = false; if (r && r.state !== 'inactive') r.stop(); this.ui(); }

  // ---- the strip along the bottom
  ui(fast) {
    if (!this.el) {
      const d = this.el = document.createElement('div');
      d.id = 'replay';
      d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;padding:10px 16px 14px;background:linear-gradient(transparent,rgba(0,0,0,.75));color:#fff;font:13px monospace;z-index:20;display:none;user-select:none';
      d.innerHTML = `<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><b id="rp-title" style="color:#ff0">REPLAY</b><span id="rp-info"></span></div>
        <div id="rp-bar" style="position:relative;height:14px;margin:8px 0;background:rgba(255,255,255,.18);cursor:pointer;touch-action:none">
          <div id="rp-mark" style="position:absolute;top:0;bottom:0;background:rgba(80,200,255,.35)"></div>
          <div id="rp-head" style="position:absolute;top:-3px;bottom:-3px;width:3px;background:#ff0"></div></div>
        <div style="opacity:.85">SPACE play · ←/→ scrub · ↑/↓ speed · C camera · [ ] mark in/out · V save video · X back to skating</div>`;
      document.body.appendChild(d);
      const bar = d.querySelector('#rp-bar');
      const seek = e => { const r = bar.getBoundingClientRect(); this.t = this.t0 + (this.t1 - this.t0) * Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); this.play = false; this.ui(true); };
      bar.addEventListener('pointerdown', e => { e.stopPropagation(); bar.setPointerCapture(e.pointerId); seek(e); bar.onpointermove = seek; });
      bar.addEventListener('pointerup', () => { bar.onpointermove = null; });
    }
    this.el.style.display = this.open ? 'block' : 'none';
    if (!this.open) return;
    const span = Math.max(0.001, this.t1 - this.t0), pc = t => ((t - this.t0) / span * 100) + '%';
    this.el.querySelector('#rp-head').style.left = pc(this.t);
    const mk = this.el.querySelector('#rp-mark'); mk.style.left = pc(this.inT); mk.style.width = ((this.outT - this.inT) / span * 100) + '%';
    if (fast) return;
    const sp = SPEEDS[this.speed];
    this.el.querySelector('#rp-title').textContent = this.rec ? '● RECORDING' : 'REPLAY';
    this.el.querySelector('#rp-title').style.color = this.rec ? '#f44' : '#ff0';
    this.el.querySelector('#rp-info').textContent = `${this.play ? '▶' : '❚❚'}  ${sp === 1 ? '1x' : '1/' + (1 / sp) + 'x'}  ·  ${CAMS[this.cam]}  ·  clip ${(this.outT - this.inT).toFixed(1)}s`;
  }
}
