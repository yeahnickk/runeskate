// Teleport portals: set flat against the side walls of the Lumbridge castle courtyard (the keep's wall on the
// west, the gatehouse on the east), facing in - out of the line from spawn to the gate so nobody rolls in by accident, one per destination, and a portal back to
// Lumbridge beside every arrival point. Roll into one to go. A destination that is not streamed in yet is
// fetched first ("TELEPORTING..."), so the portals double as the quick way to open the rest of the map.
// All tiles are world coords, checked open and reachable with tools/place.py's flood fill.
import * as THREE from 'three';

import { PORTAL_HOME as HOME, PORTAL_DESTS as DESTS } from './mapdata.js';

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
    const W = world, B = W.base;
    const COURT = [3222 - B[0] + 0.5, 3218 - B[1] + 0.5];   // courtyard centre (spawn): home pads face it
    const add = (at, to, label, sub, col, face) => {
      const x = at[0] - B[0] + 0.5, z = at[1] - B[1] + 0.5;
      const g = new THREE.Group();
      const c = new THREE.Color(col);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.12, 8, 32), new THREE.MeshBasicMaterial({ color: c }));
      ring.position.y = 1.1;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.8, 32), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
      disc.position.y = 1.1;
      const pad = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.0, 32), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
      pad.rotation.x = -Math.PI / 2; pad.position.y = 0.04;
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(label, sub, col), depthTest: false, transparent: true }));
      sign.scale.set(2.6, 0.65, 1); sign.position.y = 2.45; sign.renderOrder = 5;
      g.add(ring, disc, pad, sign);
      g.position.set(x, 0, -z);
      if (face) ring.rotation.y = disc.rotation.y = face[0] > x ? Math.PI / 2 : -Math.PI / 2;   // square to its wall, facing into the courtyard
      g.visible = false; scene.add(g);
      this.list.push({ x, z, to, label, g, ring, disc, col, fixed: !!face });
    };
    for (const d of DESTS) add(d.pad, d, d.name, d.sub, d.col, COURT);
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
      p.disc.material.opacity = 0.35 + Math.sin(now * 3 + p.x) * 0.12;
      p.ring.scale.setScalar(1 + Math.sin(now * 2 + p.z) * 0.04);
      if (!this.busy && this.cool <= 0 && d < 0.95 && sk.mode !== 'bail' && sk.y < p.g.position.y + 2) this.go(p);
    }
  }

  async go(p) {
    const sk = this.sk, B = this.world.base, to = p.to;
    const x = to.at[0] - B[0] + 0.5, z = to.at[1] - B[1] + 0.5;
    this.busy = true;
    this.hud.big('TELEPORTING...', p.col, to.name, 2);
    this.audio.event({ type: 'levelup' });
    try { await this.ensureAt(Math.floor(x), Math.floor(z)); }
    catch { this.hud.big('TELEPORT FAILED', '#f00', 'try again in a moment', 2); this.busy = false; this.cool = 3; return; }
    // face away from the portal you arrive beside, so you don't roll straight back in
    const back = to.back ? [to.back[0] - B[0] + 0.5, to.back[1] - B[1] + 0.5] : null;
    const heading = back ? Math.atan2(z - back[1], x - back[0]) : Math.PI / 2;
    sk.reset(x, z, heading);
    this.hud.big(to.name.toUpperCase(), to.col, to.sub || 'the Lumbridge portal is right behind you', 2.5);
    this.busy = false; this.cool = 2.5;
  }

  /** minimap markers */
  dots() { return this.list.map(p => ({ x: p.x, z: p.z, col: '#c4f', r: 2.5 })); }
}
