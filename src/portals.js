// Teleport portals: set flat against the side walls of the Lumbridge castle courtyard (the keep's wall on the
// west, the gatehouse on the east), facing in - out of the line from spawn to the gate so nobody rolls in by accident, one per destination, and a portal back to
// Lumbridge beside every arrival point. Stop on a portal's pad and stay put for a moment to go (CHANNEL seconds): riding
// through at speed never teleports you by accident. The jump itself is a fade out / fade in. A destination that is not streamed in yet is
// fetched first ("TELEPORTING..."), so the portals double as the quick way to open the rest of the map.
// All tiles are world coords, checked open and reachable with tools/place.py's flood fill.
import * as THREE from 'three';

import { PORTAL_HOME as HOME, PORTAL_DESTS as DESTS } from './mapdata.js';

const CHANNEL = 1.1;              // seconds standing on a pad before it takes you
const SLOW = 2.2;                 // tiles/s: faster than this and you're just riding past

/** soft radial glow for the portal's face: bright rim fading to a clear centre */
function swirlTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 6, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(0.55, 'rgba(255,255,255,0.35)'); g.addColorStop(0.92, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  x.globalCompositeOperation = 'destination-out';                     // spiral arms cut into the glow
  for (let a = 0; a < 3; a++) { x.beginPath(); for (let t = 0; t < 1; t += 0.02) { const r = 8 + t * 54, th = a * 2.09 + t * 4.2; x.lineTo(64 + Math.cos(th) * r, 64 + Math.sin(th) * r); } x.lineWidth = 7; x.strokeStyle = 'rgba(0,0,0,0.55)'; x.stroke(); }
  const t = new THREE.CanvasTexture(c); return t;
}
let SWIRL = null;

function labelTexture(text, sub, col) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
  const line = (t, y, size, fill) => {
    x.font = `bold ${size}px "RuneScape Bold", Arial Black, sans-serif`;
    x.lineWidth = size / 5; x.strokeStyle = '#000'; x.strokeText(t, 256, y);
    x.fillStyle = fill; x.fillText(t, 256, y);
  };
  line(text.toUpperCase(), sub ? 46 : 64, text.length > 12 ? 44 : 56, col);
  if (sub) line(sub, 100, 30, '#ff0');
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
}

export class Portals {
  constructor({ scene, world, sk, hud, audio, ensureAt }) {
    Object.assign(this, { scene, world, sk, hud, audio, ensureAt });
    this.list = []; this.busy = false; this.cool = 0;
    // full-screen fade for the jump (smoother than a cut)
    this.fade = Object.assign(document.createElement('div'), { id: 'tpfade' });
    Object.assign(this.fade.style, { position: 'fixed', inset: '0', background: '#000', opacity: '0', pointerEvents: 'none', transition: 'opacity 0.35s ease', zIndex: '4' });
    document.body.appendChild(this.fade);
    const W = world, B = W.base;
    const COURT = [3222 - B[0] + 0.5, 3218 - B[1] + 0.5];   // courtyard centre (spawn): home pads face it
    const add = (at, to, label, sub, col, face) => {
      const x = at[0] - B[0] + 0.5, z = at[1] - B[1] + 0.5;
      const g = new THREE.Group();
      const c = new THREE.Color(col);
      SWIRL ||= swirlTexture();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.05, 8, 48), new THREE.MeshBasicMaterial({ color: c }));
      ring.position.y = 1.1;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.82, 48), new THREE.MeshBasicMaterial({ color: c, map: SWIRL, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      disc.position.y = 1.1;
      // the pad: a thin ring on the ground, and a progress arc that fills while you channel
      const pad = new THREE.Mesh(new THREE.RingGeometry(0.78, 0.86, 48), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
      pad.rotation.x = -Math.PI / 2; pad.position.y = 0.04;
      const fill = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.76, 48, 1, 0, 0.001), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
      fill.rotation.x = -Math.PI / 2; fill.position.y = 0.05; fill.visible = false;
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(label, sub, col), depthTest: false, transparent: true }));
      sign.scale.set(2.2, 0.55, 1); sign.position.y = 2.3; sign.renderOrder = 5;
      g.add(fill);
      g.add(ring, disc, pad, sign);
      g.position.set(x, 0, -z);
      if (face) ring.rotation.y = disc.rotation.y = face[0] > x ? Math.PI / 2 : -Math.PI / 2;   // square to its wall, facing into the courtyard
      g.visible = false; scene.add(g);
      this.list.push({ x, z, to, label, g, ring, disc, fill, col, fixed: !!face, ch: 0 });
    };
    for (const d of DESTS) add(d.pad, d, d.name, d.sub, d.col, d.inner ? null : COURT);   // inner (members) portals turn slowly
    for (const d of DESTS) add(d.back, HOME, 'Lumbridge', null, HOME.col);
    // one big header over the Lumbridge cluster so it reads as "teleports" from the courtyard
    const hx = 3222 - B[0] + 0.5, hz = 3219 - B[1] + 0.5;
    this.header = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture('Teleports', 'roll into a portal', '#c4f'), depthTest: false, transparent: true }));
    this.header.scale.set(6, 1.5, 1); this.header.renderOrder = 5;
    this.header.position.set(hx, W.height(hx, hz) + 5.2, -hz); this.header.userData.at = [hx, hz];
    scene.add(this.header);
  }

  update(dt) {
    const sk = this.sk, W = this.world, now = performance.now() / 1000;
    if (this.cool > 0) this.cool -= dt;
    this.header.visible = Math.hypot(sk.x - this.header.userData.at[0], sk.z - this.header.userData.at[1]) < 45;
    for (const p of this.list) {
      const d = Math.hypot(sk.x - p.x, sk.z - p.z);
      const live = W.isLive(Math.floor(p.x), Math.floor(p.z));
      p.g.visible = live && d < 45;
      if (!p.g.visible) continue;
      p.g.position.y = W.height(p.x, p.z);
      if (!p.fixed) p.g.rotation.y = now * 0.6;                    // return portals out in the open slowly spin
      p.disc.rotation.z = -now * 1.2;                               // the face swirls
      p.disc.material.opacity = 0.7 + Math.sin(now * 3 + p.x) * 0.1;
      p.ring.scale.setScalar(1 + Math.sin(now * 2 + p.z) * 0.03);
      // channel: stand (or roll slowly) on the pad and it fills; ride off or speed up and it drains
      const on = !this.busy && this.cool <= 0 && d < 0.95 && sk.mode !== 'bail' && sk.speed < SLOW && sk.y < p.g.position.y + 2;
      p.ch = on ? p.ch + dt : Math.max(0, p.ch - dt * 3);
      if (on && p.ch === dt) this.hud.pop(`HOLD STILL: ${p.label.toUpperCase()}`, p.col);
      p.fill.visible = p.ch > 0;
      if (p.ch > 0) { p.fill.geometry.dispose(); p.fill.geometry = new THREE.RingGeometry(0.6, 0.76, 48, 1, Math.PI / 2, -Math.PI * 2 * Math.min(1, p.ch / CHANNEL)); }
      if (p.ch >= CHANNEL) { p.ch = 0; p.fill.visible = false; this.go(p); }
    }
  }

  async go(p) {
    const sk = this.sk, B = this.world.base, to = p.to;
    const x = to.at[0] - B[0] + 0.5, z = to.at[1] - B[1] + 0.5;
    this.busy = true;
    this.audio.event({ type: 'levelup' });
    this.fade.style.opacity = '1';
    const wait = ms => new Promise(r => setTimeout(r, ms));
    await wait(360);
    try { await this.ensureAt(Math.floor(x), Math.floor(z)); }
    catch { this.fade.style.opacity = '0'; this.hud.big('TELEPORT FAILED', '#f00', 'try again in a moment', 2); this.busy = false; this.cool = 3; return; }
    // face away from the portal you arrive beside, so you don't roll straight back in
    const back = to.back ? [to.back[0] - B[0] + 0.5, to.back[1] - B[1] + 0.5] : null;
    const heading = back ? Math.atan2(z - back[1], x - back[0]) : Math.PI / 2;
    sk.reset(x, z, heading);
    await wait(120);
    this.fade.style.opacity = '0';
    this.hud.big(to.name.toUpperCase(), to.col, to.sub || 'stop on the Lumbridge portal behind you to go back', 2.5);
    this.busy = false; this.cool = 2.5;
  }

  /** minimap markers */
  dots() { return this.list.map(p => ({ x: p.x, z: p.z, col: '#c4f', r: 2.5 })); }
}
