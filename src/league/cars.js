// Rune League's cars on screen: CartScape's karts (go-kart, mine cart, dragon racer) painted in the team's colour with
// their god's trim and symbol, the RS driver in the god's armour (or a party hat) at the wheel, hands turning it.
// They live in the arena group, in uu: the model is scaled up from kart units, sat so its wheels touch at ride height.
import * as THREE from 'three';
import { buildKart, buildDriver, THEMES } from '../cart/models.js';
import { TEAM } from './scenery.js';
import { C } from './match.js';

export const MS = 40;                                            // uu per kart unit (a 2.95-long kart is the Octane's 118)
export const HATS = { god: ['GOD HELM', 0], red: ['RED PARTYHAT', 1038], yellow: ['YELLOW PARTYHAT', 1040], blue: ['BLUE PARTYHAT', 1042], green: ['GREEN PARTYHAT', 1044], purple: ['PURPLE PARTYHAT', 1046], white: ['WHITE PARTYHAT', 1048], santa: ['SANTA HAT', 1050], hween: ["H'WEEN MASK", 1057] };
/** boost trails, one per god: the flame's colour from hot to cool */
export const TRAIL = {
  sara: { c0: [1, 1, 0.92], c1: [1, 0.78, 0.25] }, zam: { c0: [1, 0.85, 0.5], c1: [0.95, 0.12, 0.02] }, guthix: { c0: [0.85, 1, 0.6], c1: [0.2, 0.62, 0.12] },
  arma: { c0: [0.92, 1, 1], c1: [0.2, 0.7, 0.85] }, bandos: { c0: [1, 0.8, 0.5], c1: [0.62, 0.32, 0.08] }, zaros: { c0: [0.95, 0.7, 1], c1: [0.42, 0.06, 0.6] }, seren: { c0: [0.9, 1, 1], c1: [0.4, 0.85, 1] },
};
export const outfitOf = (th, hat) => { const o = THEMES[th].outfit, h = HATS[hat]?.[1]; return { 0: h || o[0], 4: o[1], 7: o[2] }; };

export class CarVis {
  constructor(parent, car) {
    this.c = car; this.root = new THREE.Group(); parent.add(this.root);
    const th = { ...THEMES[car.theme], body: TEAM[car.team].col, dark: TEAM[car.team].dark };
    this.kart = buildKart(car.body, th);
    const g = this.kart.group; g.scale.setScalar(MS); g.position.set(14, -C.ride, 0); this.root.add(g);
    for (const w of this.kart.wheels) w.g.rotation.order = 'YZX';
    buildDriver(outfitOf(car.theme, car.hat), this.kart).then(d => { if (this.root.parent) { this.kart.body.add(d.group); this.driver = d; } }).catch(e => console.warn('driver', e));
    // a shadow under it (on the floor only: walls get none)
    const sh = new THREE.Mesh(new THREE.CircleGeometry(52, 16), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    sh.rotation.x = -Math.PI / 2; sh.scale.set(1.2, 0.8, 1); parent.add(sh); this.shadow = sh;
    this.st = 0; this.ex = new THREE.Vector3(); this.tmp = new THREE.Vector3(); this.trail = TRAIL[car.theme] || TRAIL.sara;
  }
  dispose() { this.root.removeFromParent(); this.shadow.removeFromParent(); }
  /** pose it from the car (or a replay frame: { p, q, boosting, demo, sonic, steer }) */
  update(dt, s, fx, toWorld) {
    const r = this.root; r.visible = !s.demo; this.shadow.visible = !s.demo && s.p[1] < 1200;
    if (s.demo) return;
    r.position.set(s.p[0], s.p[1], s.p[2]); r.quaternion.set(s.q[0], s.q[1], s.q[2], s.q[3]);
    this.shadow.position.set(s.p[0], 4, s.p[2]); this.tmp.set(1, 0, 0).applyQuaternion(r.quaternion); this.shadow.rotation.z = Math.atan2(-this.tmp.z, this.tmp.x);
    this.shadow.material.opacity = 0.3 / (1 + Math.max(0, s.p[1] - 20) / 300);
    this.st += ((s.steer || 0) - this.st) * Math.min(1, dt * 14);
    const fwd = s.fwd || 0;
    for (const w of this.kart.wheels) { w.g.rotation.z -= fwd / MS * dt / w.r; if (w.front) w.g.rotation.y = -this.st * 0.45; }
    this.kart.steer.rotation.x = this.st * 1.2; this.driver?.steer(-this.st);
    if (!fx) return;
    // the boost: the god's flame out of the exhausts; supersonic, a white streak
    if (s.boosting) {
      r.updateMatrixWorld();
      for (const e of this.kart.exhaust) {
        this.ex.copy(e).applyMatrix4(this.kart.body.matrixWorld);
        this.tmp.set(-1, 0.1, 0).transformDirection(this.kart.body.matrixWorld);
        fx.trail(this.ex, this.tmp, this.trail, s.sonic);
      }
    }
    if (s.sonic && Math.random() < 0.6) { r.updateMatrixWorld(); this.ex.set(-0.6, 0.6, (Math.random() - 0.5) * 1.6).applyMatrix4(this.kart.body.matrixWorld); fx.streak(this.ex); }
  }
}
