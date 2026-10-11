// The first-person gun and arms, drawn in their own scene over the world (they never clip into a wall).
// Animated like Call of Duty's: sway that lags the look, a walk bob, the sprint carry, aim down sights lining
// the real sights up with the eye, a kick per shot that springs back, and reloads keyframed per weapon type
// against the gunner's timeline (src/cod/gunner.js: mag out ~30%, mag in ~66%, the empty action ~82%):
//  rifle tactical: tilt to the left hand, strip the mag, stow it, a fresh one up, seat it (slap), back
//  rifle empty:    the mag drops free and falls, fresh one in, then the gun's own empty action: the M4's bolt
//                  release slap, a charging handle racked (AK, SCAR, FAMAS, UMP, MP7, Barrett), the MP5's HK
//                  slap, the Intervention's bolt worked by the right hand
//  pistol:         mag out of the grip, a new one pushed up into it, the slide pulled off the lock on empty
//  LMG:            feed cover up, the box swapped, belt laid on the tray, cover slammed, charged on empty
//  shotgun:        rolled over, shells thumbed into the loading port one at a time, racked if it was dry
// Between shots a bolt-action is cycled by the right hand, a pump racked by the left.
import * as THREE from 'three';
import { buildGun, gunMat } from './guns.js';

const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const VS = 0.64;                                            // viewmodels are drawn smaller than life, like COD's

/** a keyframe track: [[f, value], ...] (numbers or Vector3s), eased between keys */
function track(keys, f) {
  if (f <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (f <= keys[i][0]) {
    const [f0, a] = keys[i - 1], [f1, b] = keys[i], t = ease((f - f0) / Math.max(1e-6, f1 - f0));
    return typeof a === 'number' ? a + (b - a) * t : a.clone().lerp(b, t);
  }
  return keys[keys.length - 1][1];
}

export class ViewModel {
  constructor(teamHex = 0x2f7fe0) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(54, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xe8eeff, 0x4a4030, 1.7));
    const sun = new THREE.DirectionalLight(0xfff2d8, 2.0); sun.position.set(-0.4, 1, 0.6); this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x9ab8ff, 0.8); rim.position.set(0.8, 0.3, -0.6); this.scene.add(rim);
    this.gunHolder = new THREE.Group(); this.gunHolder.scale.setScalar(VS); this.scene.add(this.gunHolder);
    this.models = new Map(); this.cur = null; this.curId = null;
    // arms: sleeve (team colour) + glove, from an elbow off screen to each hand
    const sleeve = camo(teamHex), glove = gunMat(0x26262a), skin = gunMat(0xc89a74);
    const arm = () => {
      const g = new THREE.Group(), fore = new THREE.Mesh(BOX, sleeve), cuff = new THREE.Mesh(BOX, skin), hand = new THREE.Group();
      fore.scale.set(0.042, 0.042, 1); cuff.scale.set(0.034, 0.034, 0.018);
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.024, 0.055), glove); hand.add(palm);
      const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.02, 0.028), glove); fingers.position.set(0, -0.017, -0.02); hand.add(fingers);
      const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.014, 0.034), glove); thumb.position.set(-0.02, 0.007, -0.02); hand.add(thumb);
      g.add(fore, cuff, hand); this.scene.add(g);
      return { g, fore, cuff, hand };
    };
    this.armR = arm(); this.armL = arm();
    this.knife = buildGun('knife'); this.knife.group.visible = false; this.scene.add(this.knife.group);
    this.nade = buildGun('frag'); this.nade.group.visible = false; this.scene.add(this.nade.group);
    // a 12 gauge shell for the shotgun's left hand
    this.shellM = new THREE.Group();
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.05, 8), gunMat(0xa81818)); sh.rotation.x = Math.PI / 2; this.shellM.add(sh);
    const sb = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.014, 8), gunMat(0xd8b050, 1.1)); sb.rotation.x = Math.PI / 2; sb.position.z = 0.025; this.shellM.add(sb);
    this.shellM.visible = false; this.gunHolder.add(this.shellM);
    // muzzle flash: a star and crossed spikes, additive
    const fm = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const star = new THREE.Shape(); for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, r = i % 2 ? 0.25 : 1; star[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
    this.flash = new THREE.Group();
    const f1 = new THREE.Mesh(new THREE.ShapeGeometry(star), fm); f1.scale.setScalar(0.045); this.flash.add(f1);
    const f2 = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.16), fm); f2.position.z = -0.06; f2.rotation.x = Math.PI / 2; this.flash.add(f2);
    const f3 = f2.clone(); f3.rotation.set(Math.PI / 2, 0, Math.PI / 2); this.flash.add(f3);
    this.flash.visible = false; this.scene.add(this.flash); this.flashT = 0;
    this.debris = [];                                        // brass, dropped mags
    this.casingGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.018, 5); this.casingMat = gunMat(0xd8b050, 1.15);
    this.kick = { z: 0, rx: 0, ry: 0, vz: 0, vrx: 0, vry: 0 };
    this.sway = { x: 0, y: 0 }; this.swayV = { x: 0, y: 0 }; this.bobT = 0; this.sprint = 0; this.land = 0; this.t = 0;
    this.dropped = false; this.ejected = 0;
  }

  dispose() { this.armR.fore.material.map?.dispose(); this.armR.fore.material.dispose(); }
  resize(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  setGun(id, model) {
    if (this.curId === id) return;
    if (this.cur) this.gunHolder.remove(this.cur.group);
    if (!this.models.has(id)) this.models.set(id, buildGun(model));
    this.cur = this.models.get(id); this.curId = id;
    this.gunHolder.add(this.cur.group);
  }

  shot(w, adsK) {
    const k = this.kick, r = w.recoil[0];
    k.vz += (0.9 + r * 0.6) * (1 - adsK * 0.5); k.vrx += (2 + r * 2.5) * (1 - adsK * 0.6); k.vry += (Math.random() - 0.5) * w.recoil[1] * 4;
    this.flashT = 0.045; this.flash.rotation.z = Math.random() * 6;
    if (w.kind !== 'bolt' && w.kind !== 'pump') this.eject();
  }
  eject() {
    const m = new THREE.Mesh(this.casingGeo, this.casingMat);
    m.position.copy(this.cur.eject).applyMatrix4(this.cur.group.matrixWorld); m.rotation.set(Math.random() * 3, 0, Math.PI / 2);
    this.scene.add(m);
    this.debris.push({ m, v: V(0.9 + Math.random() * 0.5, 0.9 + Math.random() * 0.4, 0.3 * (Math.random() - 0.2)), s: V(Math.random() * 20, Math.random() * 20, 0), t: 0, life: 0.7 });
  }
  /** the empty mag falls out of the gun and away (a copy, in view space) */
  dropMag() {
    const mag = this.cur.parts.mag; if (!mag) return;
    const c = mag.clone(true); mag.updateMatrixWorld(true);
    mag.matrixWorld.decompose(c.position, c.quaternion, c.scale);
    this.scene.add(c);
    this.debris.push({ m: c, v: V(-0.05, -0.4, 0.05), s: V(1.5, 0, 2), t: 0, life: 0.9 });
  }

  /**
   * st: { gunner, ads (0..1), sprint, speed (0..1 of walk), onGround, look: {dx, dy} (this frame's turn,
   * radians), slide, landed, dead }
   */
  update(dt, st) {
    this.t += dt;
    const G = st.gunner, w = G.w, m = this.cur; if (!m) return;
    const ads = ease(st.ads), K = this.kick;
    for (const [p, v, kk, d] of [['z', 'vz', 260, 22], ['rx', 'vrx', 200, 18], ['ry', 'vry', 160, 16]]) { K[v] += (-K[p] * kk - K[v] * d) * dt; K[p] += K[v] * dt; }
    this.swayV.x += (-st.look.dx * 2.2 - this.swayV.x) * Math.min(1, dt * 10); this.swayV.y += (st.look.dy * 2.2 - this.swayV.y) * Math.min(1, dt * 10);
    this.sway.x += (Math.max(-0.06, Math.min(0.06, this.swayV.x)) - this.sway.x) * Math.min(1, dt * 8);
    this.sway.y += (Math.max(-0.05, Math.min(0.05, this.swayV.y)) - this.sway.y) * Math.min(1, dt * 8);
    this.sprint += ((st.sprint ? 1 : 0) - this.sprint) * Math.min(1, dt * 9);
    if (st.onGround) this.bobT += dt * (4.5 + this.sprint * 4) * Math.min(1, st.speed);
    const bob = Math.min(1, st.speed) * (st.onGround ? 1 : 0.2) * (1 - ads * 0.85), sb = 1 + this.sprint * 1.6;
    this.land += ((st.landed || 0) - this.land) * Math.min(1, dt * 10);

    // ---- base pose: hip <-> sights
    const pistol = m.len < 0.3;
    const long = Math.max(0, m.len - 0.9) * 0.4;
    const hip = pistol ? V(0.085, -0.07, -0.3) : V(0.085 + long * 0.1, -0.088, -0.22 - long), aim = V(0, -m.sightY * VS, pistol ? -0.26 : -(m.rearZ * VS) - (m.scope ? 0.05 : 0.075));
    const pos = hip.clone().lerp(aim, ads);
    let rx = 0, ry = 0.07 * (1 - ads), rz = 0;                 // hip: turned in toward the crosshair (you see its flank)
    pos.x += this.sprint * 0.02; pos.y -= this.sprint * 0.05; pos.z += this.sprint * 0.05;
    rx -= this.sprint * 0.25; ry += this.sprint * 0.75; rz += this.sprint * 0.35;
    if (st.slide) { rz += 0.25; pos.y -= 0.02; }
    pos.x += Math.sin(this.bobT) * 0.012 * bob * sb + this.sway.x * (1 - ads * 0.8);
    pos.y += -Math.abs(Math.cos(this.bobT)) * 0.012 * bob * sb + this.sway.y * (1 - ads * 0.8) - this.land * 0.04 + Math.sin(this.t * 1.6) * 0.002 * (1 - ads);
    pos.z += K.z * 0.04;
    rx += K.rx * 0.05 * (1 - ads * 0.5) + this.sway.y * 1.5; ry += K.ry * 0.05 + this.sway.x * 2; rz += Math.sin(this.bobT) * 0.02 * bob;

    // ---- the timelines
    const ph = G.phase, f = G.dur > 0 ? Math.min(1, G.t / G.dur) : 1, parts = m.parts, rl = m.rl;
    for (const p of Object.values(parts)) { p.position.copy(p.userData.home); p.rotation.copy(p.userData.rot); p.visible = true; }
    const fore = m.fore.clone();
    let L = fore.clone(), R = V(0, -0.005, 0.02);                 // left / right hand targets, gun space
    this.shellM.visible = false;
    if (ph !== 'reload') this.dropped = false;
    if (ph === 'raise') { pos.y -= (1 - ease(f)) * 0.22; rx -= (1 - ease(f)) * 0.6; rz += (1 - ease(f)) * 0.3; }
    if (ph === 'swap') { pos.y -= ease(f) * 0.22; rx -= ease(f) * 0.6; rz += ease(f) * 0.3; }
    if (ph === 'reload') {
      const o = this.reload(m, rl, G, f);
      pos.x += o.dx; pos.y += o.dy; pos.z += o.dz; rx += o.rx; ry += o.ry; rz += o.rz; L = o.L; if (o.R) R = o.R;
    }
    if (ph === 'cycle') {
      if (w.kind === 'bolt' && parts.bolt) this.boltCycle(parts.bolt, f, o => { R = o; }, (a, b, c) => { rz += a; pos.y += b; rx += c; });
      else if (w.kind === 'pump' && parts.pump) {
        const u = track([[0, 0], [0.12, 0], [0.45, 1], [0.85, 0], [1, 0]], f);
        parts.pump.position.z += u * 0.085; L = fore.clone().add(V(0, 0, u * 0.085)); rx += Math.sin(f * Math.PI) * 0.06;
        if (u > 0.95 && !this.ejected) { this.ejected = 1; this.eject(); } if (f < 0.1) this.ejected = 0;
      }
    }
    // a pistol's slide rides back on each shot and locks open on empty
    if (parts.slide && ph !== 'reload') parts.slide.position.z += Math.max(0, K.z) * 0.02 + (G.g.ammo === 0 ? rl.pull || 0.04 : 0);
    let knifeOn = false, nadeOn = false, leftFree = false;
    if (ph === 'knife') { const out = Math.sin(Math.min(1, f * 1.25) * Math.PI); pos.y -= out * 0.18; pos.x -= out * 0.12; rz += out * 0.6; knifeOn = true; leftFree = true; }
    if (ph === 'throw' || G.cook >= 0) { nadeOn = true; leftFree = true; pos.y -= 0.06; rz += 0.1; }

    this.gunHolder.position.copy(pos); this.gunHolder.rotation.set(rx, ry, rz, 'YXZ');
    this.gunHolder.visible = !st.dead && !st.scoped;
    this.gunHolder.updateMatrixWorld(true);
    const toWorld = v => v.clone().applyMatrix4(m.group.matrixWorld);
    this.pose(this.armR, toWorld(R), V(0.2, -0.3, 0.12), 1, this.gunHolder.quaternion);
    if (!leftFree) this.pose(this.armL, toWorld(L), V(-0.12, -0.32, 0.0), -1, this.gunHolder.quaternion);
    this.armR.g.visible = this.armL.g.visible = this.gunHolder.visible;

    this.knife.group.visible = knifeOn && !st.dead;
    if (knifeOn) {
      const s = ease(Math.min(1, f * 1.6)), a = 0.9 - 1.8 * s;
      const kp = V(0.18 * Math.cos(a) - 0.02, -0.12 + Math.sin(s * Math.PI) * 0.04, -0.3 - Math.sin(s * Math.PI) * 0.12);
      this.knife.group.position.copy(kp); this.knife.group.rotation.set(-0.1, a * 0.9, -1.2 + s * 0.6);
      this.pose(this.armL, kp.clone().add(V(0, -0.02, 0.06)), V(0.2, -0.42, 0.15), 1, this.knife.group.quaternion); this.armL.g.visible = true;
    }
    this.nade.group.visible = nadeOn && !st.dead;
    if (nadeOn) {
      const back = G.cook >= 0 ? Math.min(1, G.cook * 4) : 0, thr = ph === 'throw' ? ease(Math.min(1, f * 2)) : 0;
      const np = V(-0.16 + thr * 0.1, -0.12 + back * 0.08 + thr * 0.1, -0.24 + back * 0.12 - thr * 0.35);
      this.nade.group.position.copy(np); this.nade.group.rotation.set(back, 0, 0); this.nade.group.visible = thr < 0.6;
      this.pose(this.armL, np.clone().add(V(0, -0.03, 0.02)), V(-0.24, -0.42, 0.15), -1, this.nade.group.quaternion); this.armL.g.visible = true;
    }
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0 && this.gunHolder.visible;
    if (this.flash.visible) { m.muzzle.getWorldPosition(this.flash.position); this.flash.quaternion.copy(this.gunHolder.quaternion); this.flash.scale.setScalar(0.7 + Math.random() * 0.6); }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const c = this.debris[i]; c.t += dt; c.v.y -= 6 * dt;
      c.m.position.addScaledVector(c.v, dt); c.m.rotation.x += c.s.x * dt; c.m.rotation.y += c.s.y * dt; c.m.rotation.z += (c.s.z || 0) * dt;
      if (c.t > c.life) { this.scene.remove(c.m); this.debris.splice(i, 1); }
    }
  }

  /** the reload, keyframed by type: returns the gun's offset and the hand targets (gun space) */
  reload(m, rl, G, f) {
    const parts = m.parts, mag = parts.mag, fore = m.fore.clone(), empty = G.empty;
    const out = { dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0, L: fore, R: null };
    const mp = m.magPos.clone(), grab = mp.clone().add(V(0, -0.06, 0.005)), below = mp.clone().add(V(0.0, -0.2, 0.04)), off = mp.clone().add(V(-0.1, -0.5, 0.2));
    const hold = V(0, 0.06, -0.005);                         // the mag's top from the hand
    const style = rl.style;
    if (style === 'shells') {
      const st = G.stage, port = m.port || V(0, -0.035, -0.06);
      const tilt = st === 'start' ? ease(f) : st === 'end' ? 1 - ease(f) : 1;
      out.rz = -0.7 * tilt; out.ry = 0.25 * tilt; out.rx = 0.16 * tilt; out.dy = 0.08 * tilt; out.dx = -0.06 * tilt; out.dz = -0.2 * tilt;   // rolled over: the loading port to the left hand
      const pouch = port.clone().add(V(-0.06, -0.2, 0.08));
      if (st === 'start') out.L = fore.clone().lerp(pouch, ease(f));
      else if (st === 'shell') {
        out.L = track([[0, pouch], [0.45, port.clone().add(V(0, -0.03, 0.04))], [0.62, port.clone().add(V(0, -0.012, 0.0))], [0.75, port.clone().add(V(0, -0.012, 0.0))], [1, pouch]], f);
        if (f < 0.68) { this.shellM.visible = true; this.shellM.position.copy(out.L).add(V(0, 0.015, -0.01)); this.shellM.rotation.set(-0.2, 0, 0); }
        out.dy += f > 0.6 && f < 0.72 ? 0.004 : 0;
      } else {                                               // done: back to the pump, rack it if it was dry
        out.L = pouch.clone().lerp(fore, ease(Math.min(1, f * 2.2)));
        if (empty && parts.pump) { const u = track([[0, 0], [0.45, 0], [0.65, 1], [0.85, 0], [1, 0]], f); parts.pump.position.z += u * 0.085; out.L.z += u * 0.085; }
      }
      return out;
    }
    if (style === 'pistol') {
      // tilt toward the off hand, mag out of the grip, new mag up into it, slide off the lock if dry
      out.rz = track([[0, 0], [0.12, -0.4], [0.74, -0.4], [0.9, 0], [1, 0]], f);
      out.rx = track([[0, 0], [0.12, 0.45], [0.62, 0.45], [0.66, 0.55], [0.7, 0.45], [0.9, 0], [1, 0]], f);
      out.dy = track([[0, 0], [0.12, 0.08], [0.85, 0.08], [1, 0]], f); out.dx = track([[0, 0], [0.12, -0.05], [0.85, -0.05], [1, 0]], f); out.ry = track([[0, 0], [0.12, 0.3], [0.85, 0.3], [1, 0]], f);
      const mb = mp.clone().add(V(0, -0.11, 0.025)), gripBot = mp.clone().add(V(0, -0.08, 0.02)), hand = mp.clone().add(V(-0.01, -0.12, 0.03));
      out.L = track(empty ? [[0, fore], [0.12, fore], [0.3, off], [0.48, off], [0.6, mb], [0.66, hand], [0.7, hand], [0.76, m.rl.at], [0.8, m.rl.at.clone().add(V(0, 0, m.rl.pull))], [0.86, fore], [1, fore]]
        : [[0, fore], [0.12, fore], [0.28, off], [0.46, off], [0.6, mb], [0.66, hand], [0.72, hand], [0.88, fore], [1, fore]], f);
      if (mag) {
        if (f >= 0.18 && f < 0.3) { const u = ease((f - 0.18) / 0.12); mag.position.add(V(0, -0.14 * u, 0.03 * u)); if (empty && !this.dropped && u > 0.6) { this.dropMag(); this.dropped = true; } }
        else if (f >= 0.3 && f < 0.55) mag.visible = false;
        else if (f >= 0.55 && f < 0.66) mag.position.add(V(0, -0.14 * (1 - ease((f - 0.55) / 0.11)), 0.03 * (1 - ease((f - 0.55) / 0.11))));
      }
      if (empty && parts.slide) {
        const lock = rl.pull || 0.04;
        parts.slide.position.z += f < 0.78 ? lock : track([[0.78, lock], [0.8, lock + 0.01], [0.84, 0], [1, 0]], f);
        if (f > 0.8 && f < 0.86) out.dz += 0.006;
      }
      return out;
    }
    const lmg = style === 'lmg';
    // rifles (and the LMG's box): the gun rolls toward the left hand, magwell up for it
    // the gun yaws and cants to show its left side, magwell toward the left hand, up and in so you see the swap
    const roll = lmg ? -0.45 : -0.55, yaw = lmg ? 0.45 : 0.5;
    out.rz = track([[0, 0], [0.14, roll], [0.66, roll], [0.69, roll * 1.12], [0.74, roll], [0.9, 0.0], [1, 0]], f);
    out.ry = track([[0, 0], [0.14, yaw], [0.74, yaw], [0.9, 0.05], [1, 0]], f);
    out.rx = track([[0, 0], [0.14, 0.12], [0.66, 0.12], [0.69, 0.19], [0.73, 0.1], [0.9, 0.0], [1, 0]], f);
    out.dy = track([[0, 0], [0.14, 0.11], [0.66, 0.11], [0.69, 0.124], [0.74, 0.106], [0.92, 0.0], [1, 0]], f);
    out.dx = track([[0, 0], [0.14, -0.09], [0.9, -0.04], [1, 0]], f);
    out.dz = track([[0, 0], [0.14, -0.09 - Math.max(0, m.len - 0.9) * 0.3], [0.9, 0], [1, 0]], f);
    if (lmg && parts.cover) parts.cover.rotation.x = -1.15 * track([[0, 0], [0.08, 0], [0.2, 1], [0.74, 1], [0.78, 0], [1, 0]], f);
    const ea = rl.empty, actAt = ea === 'release' ? rl.at.clone() : rl.part && parts[rl.part] ? parts[rl.part].position.clone().add(rl.at || V(0, 0, 0)) : null;
    const tray = V(0, 0.08, -0.02);
    // the left hand
    const keysL = empty
      ? [[0, fore], [0.1, fore], [0.3, off], [0.5, off], [0.6, below], [0.67, grab], [0.71, grab]]
      : [[0, fore], [0.12, fore], [0.24, grab], [0.28, grab], [0.42, off], [0.54, off], [0.62, below], [0.68, grab], [0.71, grab]];
    if (lmg) keysL.push([0.73, tray], [0.76, tray.clone().add(V(0, 0.02, 0))]);
    if (empty && actAt && ea !== 'bolt') {
      const pulled = actAt.clone().add(V(0, ea === 'hk' ? -0.02 : 0, rl.pull || 0.07));
      keysL.push([0.77, actAt], [0.8, actAt], [0.83, ea === 'release' ? actAt.clone().add(V(0.004, 0.01, 0)) : pulled], [0.86, ea === 'release' ? actAt : actAt.clone().add(V(0, ea === 'hk' ? -0.03 : 0, 0))], [0.95, fore], [1, fore]);
    } else keysL.push([0.86, fore], [1, fore]);
    out.L = track(keysL, f);
    // the magazine: rides the hand out (tactical) or drops free (empty); the new one rides it in
    if (mag) {
      const inHand = p => p.clone().add(hold).sub(m.magPos).add(mag.userData.home);
      if (!empty) {
        if (f >= 0.27 && f < 0.42) mag.position.copy(inHand(out.L));
        else if (f >= 0.42 && f < 0.55) mag.visible = false;
      } else if (f >= 0.14 && f < 0.55) {
        if (!this.dropped) { this.dropMag(); this.dropped = true; }
        mag.visible = false;
      }
      if (f >= 0.55 && f < 0.68) { mag.position.copy(inHand(out.L)); mag.rotation.x += (1 - ease((f - 0.55) / 0.13)) * 0.5; }
    }
    // the empty action
    if (empty && f > 0.76) {
      if (ea === 'handle' || ea === 'hk') {
        const p = parts[rl.part]; if (p) {
          const u = track([[0.76, 0], [0.8, 0], [0.83, 1], [0.86, 0], [1, 0]], f); p.position.z += u * (rl.pull || 0.07);
          if (ea === 'hk') p.position.y -= track([[0.76, 0], [0.83, 0], [0.85, 0.02], [0.88, 0], [1, 0]], f);
        }
        if (f > 0.84 && f < 0.88) out.dz += 0.008;
      } else if (ea === 'release') { if (f > 0.81 && f < 0.85) { out.dy += 0.006; out.rz += 0.04; } }
      else if (ea === 'bolt' && parts.bolt) {
        const u = (f - 0.74) / 0.24;
        this.boltCycle(parts.bolt, Math.min(1, u), o => { out.R = o; }, (a, b, c) => { out.rz += a; out.dy += b; out.rx += c; });
      }
    }
    return out;
  }

  /** the right hand works a bolt: lift, draw back, push home, turn down (f 0..1) */
  boltCycle(bolt, f, setR, nudge) {
    const up = track([[0, 0], [0.14, 0], [0.28, 1], [0.72, 1], [0.86, 0], [1, 0]], f), back = track([[0, 0], [0.3, 0], [0.48, 1], [0.54, 1], [0.7, 0], [1, 0]], f);
    bolt.rotation.z = -up * 1.15; bolt.position.z += back * 0.1;
    const h = bolt.position.clone().add(V(0.045 * Math.cos(up * 1.15), 0.045 * Math.sin(up * 1.15), 0.02));
    setR(V(0, -0.005, 0.02).lerp(h, track([[0, 0], [0.12, 1], [0.88, 1], [1, 0]], f)));
    nudge(-0.16 * Math.sin(f * Math.PI), -0.01 * Math.sin(f * Math.PI), 0.05 * Math.sin(f * Math.PI));
    if (back > 0.9 && !this.ejected) { this.ejected = 1; this.eject(); }
    if (f < 0.2) this.ejected = 0;
  }

  /** a forearm from an elbow (view space) to the hand at p; the hand turned with the gun */
  pose(a, p, elbow, side, q) {
    const d = p.clone().sub(elbow), L = d.length();
    a.fore.position.copy(elbow).addScaledVector(d, 0.5 * (L - 0.04) / L);
    a.fore.scale.z = Math.max(0.01, L - 0.04);
    a.fore.lookAt(p); a.cuff.position.copy(p).addScaledVector(d, -0.045 / L); a.cuff.quaternion.copy(a.fore.quaternion);
    a.hand.position.copy(p); a.hand.quaternion.copy(q); a.hand.rotateZ(side * 0.2);
  }
}
const BOX = new THREE.BoxGeometry(1, 1, 1);

/** a woodland camo sleeve in the side's tint (canvas texture) */
function camo(teamHex) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const t = new THREE.Color(teamHex), base = [[0.32, 0.3, 0.22], [0.2, 0.22, 0.14], [0.14, 0.12, 0.09], [0.42, 0.38, 0.28]];
  const css = ([r, g, b]) => `rgb(${Math.round((r * 0.75 + t.r * 0.25) * 255)},${Math.round((g * 0.75 + t.g * 0.25) * 255)},${Math.round((b * 0.75 + t.b * 0.25) * 255)})`;
  x.fillStyle = css(base[0]); x.fillRect(0, 0, 128, 128);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 46; i++) { x.fillStyle = css(base[1 + (i % 3)]); x.beginPath(); const cx = rnd() * 128, cy = rnd() * 128; for (let a = 0; a < 7; a++) { const r = 6 + rnd() * 12; x[a ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r * 1.6, cy + Math.sin(a) * r); } x.fill(); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 3);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
}
