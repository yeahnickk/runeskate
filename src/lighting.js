// Lighting: a sun that casts real shadows around the rider, a sky/ambient light, and a day/night cycle shared
// by everyone (it runs off the clock). The RS colours are pre-lit, so the sun adds direction and shadow on top
// rather than lighting from black: flat shading from screen derivatives (no normals to store).
// "low" graphics = the old look (unlit RS colours, no shadows); slow machines drop to it on their own.
import * as THREE from 'three';
import { modelHooks } from './model.js';

const DAY_MS = 40 * 60 * 1000;           // one full day/night = 40 real minutes
const lerpC = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);

export class Lighting {
  constructor({ scene, renderer, mats, fog, setSky, quality = 'high' }) {
    Object.assign(this, { scene, renderer, mats, fog, setSky });
    this.basic = { opaque: mats.opaque, alpha: mats.alpha };
    this.lit = {
      opaque: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true }),
      alpha: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true, transparent: true, opacity: 0.4, depthWrite: false }),
    };
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a8070, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    const sh = this.sun.shadow; sh.mapSize.set(2048, 2048);
    Object.assign(sh.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 140 });
    sh.bias = -0.0006; sh.normalBias = 0.03;
    scene.add(this.hemi, this.sun, this.sun.target);
    this.meshes = new Set();
    let q = quality; try { q = localStorage.getItem('rs_gfx') || quality; } catch {}
    this.quality = null; this.set(q);
    modelHooks.created = mesh => this.add(mesh, 'actor');
    this.slowT = 0; this.override = null;           // override: fixed time of day (0..1), e.g. for screenshots
  }

  /** register a mesh: world chunks (kind terrain / locs / locs_alpha), riders, NPCs */
  add(mesh, kind) {
    mesh.userData.lk = kind; this.meshes.add(mesh); this.apply(mesh);
  }
  /** register a rider/NPC/board mesh made before the lights existed */
  ensure(mesh) { if (!this.meshes.has(mesh)) this.add(mesh, 'actor'); }
  apply(m) {
    const hi = this.quality === 'high', k = m.userData.lk;
    if (k === 'terrain' || k === 'locs' || k === 'locs_alpha') {
      m.material = (hi ? this.lit : this.basic)[k === 'locs_alpha' ? 'alpha' : 'opaque'];
      m.receiveShadow = hi; m.castShadow = hi && k === 'locs';
    } else if (k === 'solid') {                                         // plain-coloured meshes (Create-a-Park pieces)
      m.userData.litMat ||= m.material;
      m.userData.flatMat ||= new THREE.MeshBasicMaterial({ color: m.material.color, side: m.material.side, fog: true });
      m.material = hi ? m.userData.litMat : m.userData.flatMat;
      m.castShadow = m.receiveShadow = hi;
    } else {                                                            // riders, NPCs, boards
      m.userData.basicMat ||= m.material;
      if (hi && !m.userData.litMat) { const b = m.userData.basicMat; m.userData.litMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: b.side, flatShading: true, fog: true }); }
      m.material = hi ? m.userData.litMat : m.userData.basicMat;
      m.castShadow = hi; m.receiveShadow = false;
    }
  }
  set(q) {
    if (q === this.quality) return;
    this.quality = q; try { localStorage.setItem('rs_gfx', q); } catch {}
    const hi = q === 'high';
    this.renderer.shadowMap.enabled = hi; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.sun.castShadow = hi; this.sun.visible = this.hemi.visible = hi;
    for (const m of this.meshes) this.apply(m);
    this.mats.opaque = hi ? this.lit.opaque : this.basic.opaque; this.mats.alpha = hi ? this.lit.alpha : this.basic.alpha;
    this.renderer.shadowMap.needsUpdate = true;
  }
  toggle() { this.set(this.quality === 'high' ? 'low' : 'high'); return this.quality; }

  /** time of day 0..1 (0.25 = sunrise, 0.5 = noon, 0.75 = sunset) */
  get time() { return this.override ?? ((Date.now() % DAY_MS) / DAY_MS); }

  /** per frame: follow the rider (x, y, z three.js), move the sun, colour the sky. ft = last frame time (s) */
  update(focus, ft) {
    // too slow for shadows: after ~4 s under 24 fps, drop to low and say so (once)
    if (this.quality === 'high' && ft > 1 / 24) { this.slowT += ft; if (this.slowT > 4 && !this.autoLow) { this.autoLow = true; this.set('low'); this.onAutoLow?.(); } }
    else this.slowT = Math.max(0, this.slowT - ft * 0.5);
    const t = this.time, a = (t - 0.25) * Math.PI * 2;                     // sun angle: 0 at sunrise
    const el = Math.sin(a), day = THREE.MathUtils.smoothstep(el, -0.12, 0.25);   // 0 night .. 1 day
    const dusk = Math.max(0, 1 - Math.abs(el) / 0.3) * (el > -0.15 ? 1 : 0);    // warm light near the horizon
    // sun by day, moon by night (same light, opposite side, cool and dim)
    const s = el >= -0.05 ? 1 : -1, ang = s > 0 ? a : a + Math.PI, h = Math.max(0.18, Math.abs(Math.sin(ang)));
    const dir = new THREE.Vector3(Math.cos(ang) * 0.8, h, 0.45).normalize();
    this.sun.position.set(focus.x + dir.x * 60, focus.y + dir.y * 60, focus.z + dir.z * 60);
    this.sun.target.position.copy(focus);
    const sunCol = s > 0 ? lerpC(0xfff4e0, 0xffa060, dusk) : new THREE.Color(0x8fa8ff);
    // the RS colours already carry their own shading, so the fill is flat (same from every side: no double-
    // darkened walls) and the sun only adds a lift on the faces it reaches; shadowed ground sits at the fill
    this.sun.color.copy(sunCol); this.sun.intensity = Math.PI * (s > 0 ? 0.42 * (0.3 + 0.7 * day) : 0.2);
    const fill = lerpC(0x9aa6dc, 0xf4f6ff, day);
    this.hemi.color.copy(fill); this.hemi.groundColor.copy(fill);
    this.hemi.intensity = Math.PI * (0.6 + 0.14 * day);
    // fog and sky follow
    const fogC = lerpC(0x34406a, 0xbcd1ea, day).lerp(new THREE.Color(0xe0a080), dusk * 0.35);
    this.scene.fog.color.copy(fogC);
    const top = lerpC(0x0c1430, 0x2a64c8, day), hor = fogC;
    this.setSky?.('#' + top.getHexString(), '#' + hor.getHexString(), day);
    this.night = 1 - day; this.skyTop = top; this.skyHor = hor;   // (the replay's video needs the sky drawn in)
    // low graphics has no lights: dim the unlit colours instead
    const lv = 0.6 + 0.4 * day;
    if (this.quality !== 'high') { this.basic.opaque.color.setScalar(lv); this.basic.alpha.color.setScalar(lv); for (const m of this.meshes) if (m.userData.basicMat) m.userData.basicMat.color.setScalar(lv); }
    else { this.basic.opaque.color.setScalar(1); this.basic.alpha.color.setScalar(1); for (const m of this.meshes) if (m.userData.basicMat) m.userData.basicMat.color.setScalar(1); }
  }
}
