// God's Wrath, the match-ender, as a set piece. A comet of the god's fire you can watch come in from the edge of the
// sky, a cinematic camera for the last seconds, then the ground goes up: a white-out core, a fireball, a mushroom
// cloud rolling 60 m up on its stem, the condensation rings, the pressure dome, castle stone and timber thrown all
// over the arena (burning), sparks, a dust surge along the ground, the castles lit up by the blast, and a crater.
// Looks only: the match has already decided who dies. Puffs are camera-facing quads drawn instanced (two draw calls
// for a thousand of them, no point-size caps on phones), debris one InstancedMesh.
import * as THREE from 'three';

const VS = `attribute vec3 off; attribute float size; attribute float alpha; attribute float rot; attribute vec3 tint;
varying vec2 vUv; varying float vA; varying vec3 vC;
void main() { vUv = position.xy + 0.5; vA = alpha; vC = tint;
  vec4 mv = modelViewMatrix * vec4(off, 1.0); float c = cos(rot), s = sin(rot);
  mv.xy += mat2(c, s, -s, c) * position.xy * size; gl_Position = projectionMatrix * mv; }`;
const FS = `uniform sampler2D map; varying vec2 vUv; varying float vA; varying vec3 vC;
void main() { vec4 t = texture2D(map, vUv); float a = t.a * vA; if (a < 0.003) discard; gl_FragColor = vec4(vC * t.rgb, a); }`;

// a soft cauliflower puff: overlapping blobs under a round falloff (smoke reads as smoke, fire as flame licks)
export function puffTex() {
  const S = 128, cv = Object.assign(document.createElement('canvas'), { width: S, height: S }), x = cv.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * 6.283, r = Math.random() * S * 0.26, px = S / 2 + Math.cos(a) * r, py = S / 2 + Math.sin(a) * r, br = S * (0.12 + Math.random() * 0.16);
    const g = x.createRadialGradient(px, py, 0, px, py, br), l = 200 + Math.random() * 55 | 0;
    g.addColorStop(0, `rgba(${l},${l},${l},0.55)`); g.addColorStop(1, `rgba(${l},${l},${l},0)`); x.fillStyle = g; x.fillRect(0, 0, S, S);
  }
  x.globalCompositeOperation = 'destination-in';
  const g = x.createRadialGradient(S / 2, S / 2, S * 0.18, S / 2, S / 2, S / 2); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// a plain soft glow (comet halo, the core's flash)
export function glowTex() {
  const S = 128, cv = Object.assign(document.createElement('canvas'), { width: S, height: S }), x = cv.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,0.7)'); g.addColorStop(0.5, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S); return new THREE.CanvasTexture(cv);
}

export class Puffs {
  constructor(scene, n, add, tex) {
    this.n = n; this.L = []; this.add = add;
    const g = this.g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    const A = (k, w) => { const b = new THREE.InstancedBufferAttribute(new Float32Array(n * w), w); b.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, b); return b; };
    this.off = A('off', 3); this.size = A('size', 1); this.alpha = A('alpha', 1); this.rot = A('rot', 1); this.tint = A('tint', 3);
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({ uniforms: { map: { value: tex } }, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = add ? 6 : 5; scene.add(this.mesh);
  }
  /** o: grow (size multiple at the end), drag, g (gravity; < 0 rises), c0 -> c1 colour, a (peak alpha), fade (seconds in), spin, fn(p, dt) */
  emit(x, y, z, vx, vy, vz, size, life, o = {}) {
    if (this.L.length >= this.n) this.L[Math.random() * this.n | 0] = this.L.pop();   // (full: drop a random old one)
    this.L.push({ x, y, z, vx, vy, vz, size, life, t: 0, grow: o.grow ?? 1.5, drag: o.drag ?? 0, g: o.g ?? 0, c0: o.c0 ?? [1, 1, 1], c1: o.c1 ?? o.c0 ?? [1, 1, 1], a: o.a ?? 1, fade: o.fade ?? 0.06, r: Math.random() * 6.283, spin: o.spin ?? (Math.random() - 0.5) * 0.8, fn: o.fn, d: o.d });
  }
  update(dt, cam) {
    const L = this.L;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i]; p.t += dt; if (p.t >= p.life) { L[i] = L[L.length - 1]; L.pop(); continue; }
      const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy = p.vy * k - p.g * dt; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.r += p.spin * dt;
      if (p.fn) p.fn(p, dt);
    }
    if (!this.add) { const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z; for (const p of L) p.k = (p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2; L.sort((a, b) => b.k - a.k); }   // (smoke back to front)
    const O = this.off.array, S = this.size.array, Al = this.alpha.array, R = this.rot.array, C = this.tint.array;
    for (let i = 0; i < L.length; i++) {
      const p = L[i], u = p.t / p.life, w = Math.min(1, u * 1.4);
      O[i * 3] = p.x; O[i * 3 + 1] = p.y; O[i * 3 + 2] = p.z;
      S[i] = p.size * (1 + (p.grow - 1) * Math.sqrt(u)); R[i] = p.r;
      Al[i] = p.a * Math.min(1, p.t / p.fade) * (1 - u) ** 1.4;
      for (let j = 0; j < 3; j++) C[i * 3 + j] = p.c0[j] + (p.c1[j] - p.c0[j]) * w;
    }
    this.g.instanceCount = L.length;
    for (const b of [this.off, this.size, this.alpha, this.rot, this.tint]) b.needsUpdate = true;
  }
  dispose() { this.mesh.removeFromParent(); this.g.dispose(); this.mat.dispose(); }
}

const GOD = { zam: { core: [1, 0.85, 0.6], hot: [1, 0.45, 0.12], deep: [0.55, 0.06, 0.02], hex: 0xff5a1a, smoke: [0.2, 0.13, 0.12] },
  sara: { core: [1, 1, 0.92], hot: [1, 0.85, 0.4], deep: [0.75, 0.35, 0.08], hex: 0xfff0a0, smoke: [0.32, 0.3, 0.3] },
  null: { core: [0.9, 1, 0.85], hot: [0.5, 1, 0.4], deep: [0.1, 0.4, 0.05], hex: 0x80ff80, smoke: [0.22, 0.26, 0.2] } };
const rnd = (a, b) => a + Math.random() * (b - a);
const STONE = [0x7a7468, 0x6a645a, 0x8a8478, 0x5a5048, 0x4a4038, 0x7a5530, 0x3a3028];   // castle stone, earth, timber

export class Wrath {
  /** c: ground zero (three.js); eta: seconds to impact; floor(x, z): the floor there; arena: lit up by the blast */
  constructor(scene, c, eta, team, floor, arena) {
    Object.assign(this, { scene, c: c.clone(), eta, floor, arena, t: -eta, G: GOD[team] || GOD.null, hit: false });
    const tex = puffTex();
    this.fire = new Puffs(scene, 900, true, tex); this.smoke = new Puffs(scene, 1100, false, tex); this.tex = tex;
    this.objs = [];
    const add = (m, o = {}) => { scene.add(m); this.objs.push(m); return Object.assign(m, o); };
    const basic = (col, o = 1, ad = true) => new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: o, depthWrite: false, fog: false, blending: ad ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide });
    // the comet: a white-hot core in two glows of the god's colour, coming in low across the sky from far off
    const h = new THREE.Vector3(Math.cos(this.ang = Math.random() * 6.283), 0, Math.sin(this.ang));
    this.S = this.c.clone().addScaledVector(h, 520).setY(this.c.y + 300); this.h = h;
    this.comet = new THREE.Group(); add(this.comet);
    this.glow = glowTex();
    const spr = (col, s, o) => { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: col, transparent: true, opacity: o, depthWrite: false, fog: false, blending: THREE.AdditiveBlending })); m.scale.setScalar(s); return m; };
    this.spr = spr;
    this.comet.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 3), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false })), spr(0xffffff, 4, 1), spr(this.G.hex, 11, 0.8), spr(this.G.hex, 26, 0.35));
    this.comet.scale.setScalar(2.6);
    // where it will land: a ring closing in on the spot
    this.mark = add(new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2), basic(this.G.hex, 0.7)), { renderOrder: 4 });
    this.mark.position.copy(this.c).y += 0.3;
    // debris: the castle in pieces
    const N = this.ND = 320, geo = new THREE.BoxGeometry(1, 1, 1);
    this.deb = add(new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), N), { frustumCulled: false, visible: false });
    this.D = []; const col = new THREE.Color();
    for (let i = 0; i < N; i++) { this.deb.setColorAt(i, col.setHex(STONE[i % STONE.length]).multiplyScalar(rnd(1.5, 2.1))); }
    this.mtx = new THREE.Object3D();
    this.basic = basic;
    this.lit0 = arena?.mats.opaque.color.clone(); this.fog0 = scene.fog?.color.clone();
  }

  get cine() { return this.t > -2.6 && this.t < 10; }
  get cometPos() { const u = Math.max(0, 1 + this.t / this.eta); return this.S.clone().lerp(this.c, u ** 2.2); }

  detonate() {
    this.hit = true; this.comet.visible = false; this.mark.visible = false;
    const { c, G } = this, F = this.fire, Sm = this.smoke, add = (m, o) => { this.scene.add(m); this.objs.push(m); return Object.assign(m, o); };
    // the white-out core and the pressure dome
    this.core = add(this.spr(0xffffff, 1, 1), { renderOrder: 7 }); this.core.position.copy(c).y += 4;
    this.dome = add(new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, 6.283, 0, Math.PI / 2), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { o: { value: 0.5 } },
      vertexShader: 'varying float f; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vec3 n = normalize(normalMatrix * normal); f = 1.0 - abs(dot(n, normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float o; varying float f; void main() { gl_FragColor = vec4(vec3(1.0), pow(f, 3.0) * o); }' })), { renderOrder: 7 }); this.dome.position.copy(c);   // (the pressure wave: only its rim shows, like heat shimmer)
    // condensation rings round the stem, and the shock rings tearing out along the ground
    this.rings = []; this.wilson = [[14, 0.2], [26, 0.45], [38, 0.75]];   // (condensation rings: puffs of white cloud racing out round the stem)
    for (const d of [0, 0.3, 0.75]) { const m = add(new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 96).rotateX(-Math.PI / 2), this.basic(G.hex, 0)), { renderOrder: 7 }); m.position.copy(c).y += 0.5; this.rings.push({ m, d, life: 2.4, top: 160, op: 0.9 }); }
    // the crater: scorched earth and a ring of embers
    const scorch = add(new THREE.Mesh(new THREE.CircleGeometry(19, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x140e0a, transparent: true, opacity: 0.88, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 })), {}); scorch.position.copy(c).y += 0.12;
    this.embers = add(new THREE.Mesh(new THREE.RingGeometry(6, 19, 48).rotateX(-Math.PI / 2), this.basic(0xff6a18, 0.8)), {}); this.embers.position.copy(c).y += 0.18;   // (the ground still glowing: always fire-orange)
    // the fireball
    for (let i = 0; i < 110; i++) {
      const a = rnd(0, 6.283), e = rnd(-0.1, 1.2), s = rnd(10, 46), d = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
      F.emit(c.x + d[0] * 3, c.y + 2 + d[1] * 3, c.z + d[2] * 3, d[0] * s, d[1] * s, d[2] * s, rnd(9, 18), rnd(1.4, 3.4), { grow: 2.6, drag: 2.4, g: -5, c0: G.core, c1: G.deep, fade: 0.02 });
    }
    // sparks: fast and everywhere
    for (let i = 0; i < 260; i++) {
      const a = rnd(0, 6.283), e = rnd(0.05, 1.3), s = rnd(25, 85);
      F.emit(c.x, c.y + 2, c.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(a) * Math.cos(e) * s, rnd(0.6, 1.4), rnd(1, 3), { grow: 0.5, drag: 0.4, g: 22, c0: [1, 0.95, 0.7], c1: G.hot, fade: 0.01 });
    }
    // the surge: dust rolling out along the ground
    for (let i = 0; i < 90; i++) {
      const a = i / 90 * 6.283 + rnd(0, 0.07), s = rnd(28, 48);
      Sm.emit(c.x + Math.cos(a) * 6, c.y + rnd(0.5, 3), c.z + Math.sin(a) * 6, Math.cos(a) * s, rnd(0, 3), Math.sin(a) * s, rnd(6, 11), rnd(4, 7), { grow: 3.4, drag: 1.1, c0: [0.62, 0.52, 0.42], c1: [0.42, 0.39, 0.36], a: 0.75, fade: 0.1 });
    }
    // debris, launched; a quarter of it burning
    const D = this.D;
    for (let i = 0; i < this.ND; i++) {
      const a = rnd(0, 6.283), r = rnd(0, 11), s = rnd(10, 46), up = rnd(8, 40), rim = i < 50;
      const sx = rnd(0.3, 1.8), sy = rnd(0.25, 1.2), sz = rnd(0.3, 1.6);
      D.push(rim
        ? { p: new THREE.Vector3(c.x + Math.cos(a) * rnd(15, 21), 0, c.z + Math.sin(a) * rnd(15, 21)), v: new THREE.Vector3(), w: new THREE.Vector3(), e: new THREE.Euler(rnd(0, 3), rnd(0, 3), rnd(0, 3)), s: new THREE.Vector3(sx * 1.6, sy * 1.6, sz * 1.6), rest: true, burn: 0, rim: true }   // (the crater's rim, thrown up where it stands)
        : { p: new THREE.Vector3(c.x + Math.cos(a) * r, c.y + rnd(0.5, 3), c.z + Math.sin(a) * r), v: new THREE.Vector3(Math.cos(a) * s, up, Math.sin(a) * s), w: new THREE.Vector3(rnd(-9, 9), rnd(-9, 9), rnd(-9, 9)), e: new THREE.Euler(), s: new THREE.Vector3(sx, sy, sz), rest: false, burn: i < 130 ? rnd(2, 5) : 0, fT: 0, fy: -1e9, ft: 0 });
      if (rim) { const q = D[D.length - 1]; q.p.y = this.floor(q.p.x, q.p.z) - q.s.y * 0.25; }
    }
    this.deb.visible = true;
  }

  /** dt; cam: the camera (for sorting smoke). Returns false once it has all burnt out */
  update(dt, cam) {
    this.t += dt; const { t, c, G } = this, F = this.fire, Sm = this.smoke;
    if (t < 0) {                                                       // ---- incoming
      const p = this.cometPos, u = 1 + t / this.eta;
      this.comet.position.copy(p); this.comet.rotation.x += dt * 3; this.comet.rotation.y += dt * 2;
      this.comet.scale.setScalar(2.6 + u * 2);
      const n = 3 + (u * 4 | 0);
      for (let i = 0; i < n; i++) {                                    // its tail: fire, then a long smoke trail hanging in the sky
        const j = () => rnd(-1.5, 1.5);
        F.emit(p.x + j(), p.y + j(), p.z + j(), j() * 2, j() * 2, j() * 2, rnd(5, 10), rnd(0.5, 1.1), { grow: 2.4, drag: 1, c0: G.core, c1: G.deep, fade: 0.02 });
        if (i % 2 === 0) Sm.emit(p.x + j(), p.y + j(), p.z + j(), j(), j(), j(), rnd(5, 9), rnd(4, 7), { grow: 3.5, drag: 0.3, c0: G.hot, c1: G.smoke, a: 0.6, fade: 0.2 });
      }
      if (Math.random() < 0.6) { const a = rnd(0, 6.283); F.emit(p.x, p.y, p.z, Math.cos(a) * 12, rnd(-8, 8), Math.sin(a) * 12, rnd(0.8, 1.5), rnd(0.6, 1.4), { grow: 0.5, g: 15, c0: [1, 0.95, 0.7], c1: G.hot }); }
      const ring = Math.max(8, 60 * (-t / this.eta)); this.mark.scale.setScalar(ring); this.mark.material.opacity = 0.35 + 0.35 * Math.sin(t * 12) ** 2;
      this.light(Math.max(0, u - 0.6) * 0.8);
    } else {
      if (!this.hit) this.detonate();
      const e = Math.exp(-t * 0.9);
      // the core flashes out then burns down; the dome races out
      if (this.core) { const k = Math.min(1, t / 0.12); this.core.scale.setScalar(10 + 110 * k); this.core.material.opacity = Math.max(0, 1 - t / 1.4); this.core.visible = t < 1.4; }
      if (this.dome) { this.dome.scale.setScalar(10 + t * 150); this.dome.material.uniforms.o.value = Math.max(0, 0.6 * (1 - t / 1.3)); this.dome.visible = t < 1.3; }
      for (const w of this.wilson) if (t >= w[1] && !w[2]) { w[2] = 1;
        for (let i = 0; i < 70; i++) { const a = i / 70 * 6.283, s = rnd(26, 34); Sm.emit(c.x + Math.cos(a) * 8, c.y + w[0] + rnd(-1, 1), c.z + Math.sin(a) * 8, Math.cos(a) * s, rnd(-0.5, 1), Math.sin(a) * s, rnd(4, 6), rnd(2.2, 3.2), { grow: 2.8, drag: 1.3, c0: [1, 1, 1], c1: [0.9, 0.92, 0.95], a: 0.55, fade: 0.15 }); } }
      for (const r of this.rings) { const u = (t - r.d) / r.life; r.m.visible = u > 0 && u < 1; if (r.m.visible) { r.m.scale.setScalar(4 + r.top * Math.sqrt(u)); r.m.material.opacity = r.op * (1 - u); } }
      this.embers.material.opacity = 0.7 * Math.max(0, 1 - t / 8) * (0.75 + 0.25 * Math.sin(t * 7));
      // the mushroom: a cap rolling up and out on a stem of dust and fire
      const capY = c.y + 8 + 56 * (1 - Math.exp(-t / 2.4)), R = 7 + 15 * (1 - Math.exp(-t / 2.8));
      this.capY = capY;
      if (t < 7) {
        const n = t < 2 ? 9 : t < 4 ? 5 : 2;
        for (let i = 0; i < n; i++) {                                  // the cap: puffs riding a rolling ring (out over the top, in underneath)
          const th = rnd(0, 6.283), ph = rnd(0, 6.283), self = this;
          const fn = (p, dt) => { p.ph += dt * 0.9; const r = self.R, cy = self.capY, rr = r + r * 0.5 * Math.cos(p.ph); p.x = c.x + Math.cos(p.th) * rr; p.z = c.z + Math.sin(p.th) * rr; p.y = cy + r * 0.42 * Math.sin(p.ph); };
          const sh = rnd(0.7, 1.25);                                     // (each puff its own shade: a lumpy cloud, not a blob)
          Sm.emit(c.x, capY, c.z, 0, 0, 0, rnd(10, 17), rnd(6, 10), { grow: 1.7, c0: (t < 1.5 ? G.hot : [0.6, 0.45, 0.36]).map(v => v * sh), c1: G.smoke.map(v => v * sh * 1.3), a: 0.9, fade: 0.25, fn });
          Object.assign(Sm.L[Sm.L.length - 1], { th, ph });
          if (t < 3.5) { F.emit(c.x, capY, c.z, 0, 0, 0, rnd(8, 14), rnd(0.8, 1.6), { grow: 1.4, c0: G.hot, c1: G.deep, a: 0.8, fn }); Object.assign(F.L[F.L.length - 1], { th, ph: ph + 3.14 }); }
        }
        for (let i = 0; i < (t < 3 ? 4 : 2); i++) {                    // the stem: dust sucked in and up the middle
          const a = rnd(0, 6.283), r = rnd(1, 6), self = this;
          const fn = (p, dt) => { p.x += (c.x - p.x) * dt * 0.6; p.z += (c.z - p.z) * dt * 0.6; if (p.y > self.capY) { p.vy = 0; p.y = self.capY; } };
          Sm.emit(c.x + Math.cos(a) * r, c.y + 1, c.z + Math.sin(a) * r, 0, rnd(12, 22), 0, rnd(5, 9), rnd(3.5, 6), { grow: 1.8, c0: [0.58, 0.48, 0.38], c1: G.smoke, a: 0.85, fade: 0.2, fn });
          if (t < 2.5) F.emit(c.x + Math.cos(a) * r, c.y + 1, c.z + Math.sin(a) * r, 0, rnd(15, 26), 0, rnd(5, 9), rnd(0.8, 1.5), { grow: 1.6, c0: G.core, c1: G.deep, fn });
        }
      }
      this.R = R;
      // debris: flies, tumbles, burns, bounces, rests
      const m = this.mtx;
      for (let i = 0; i < this.D.length; i++) {
        const d = this.D[i];
        if (d.rim) { const u = Math.min(1, t / 0.25); m.position.copy(d.p); m.position.y += (u - 1) * d.s.y; }
        else {
          if (!d.rest) {
            d.v.y -= 24 * dt; d.p.addScaledVector(d.v, dt); d.e.x += d.w.x * dt; d.e.y += d.w.y * dt; d.e.z += d.w.z * dt;
            if (d.v.y < 0 && (d.ft -= dt) <= 0) { d.ft = 0.12; d.fy = this.floor(d.p.x, d.p.z); }
            if (d.p.y < d.fy + d.s.y * 0.4) { d.p.y = d.fy + d.s.y * 0.4; d.v.y *= -0.32; d.v.x *= 0.55; d.v.z *= 0.55; d.w.multiplyScalar(0.5);
              if (Math.abs(d.v.y) < 2.5) { d.rest = true; d.e.x = Math.round(d.e.x / 1.57) * 1.57; d.e.z = Math.round(d.e.z / 1.57) * 1.57; }   // (comes to rest on a face)
              else if (d.v.y > 6) Sm.emit(d.p.x, d.p.y, d.p.z, 0, 1, 0, rnd(2, 4), 1.8, { grow: 2.5, c0: [0.6, 0.52, 0.44], c1: [0.45, 0.42, 0.4], a: 0.6 }); }   // (a kick of dust where it hits)
          }
          if (d.burn > 0 && t < d.burn && (d.fT -= dt) <= 0) { d.fT = 0.05; F.emit(d.p.x, d.p.y, d.p.z, 0, 2, 0, rnd(1.4, 2.6), rnd(0.4, 0.8), { grow: 1.8, g: -3, c0: G.hot, c1: G.deep }); if (!d.rest && Math.random() < 0.5) Sm.emit(d.p.x, d.p.y, d.p.z, 0, 1, 0, rnd(1.5, 3), rnd(1.5, 2.5), { grow: 2.4, c0: [0.3, 0.27, 0.25], c1: [0.2, 0.19, 0.18], a: 0.6 }); }
          m.position.copy(d.p);
        }
        m.rotation.copy(d.e); m.scale.copy(d.s); m.updateMatrix(); this.deb.setMatrixAt(i, m.matrix);
      }
      this.deb.instanceMatrix.needsUpdate = true;
      this.light(t < 0.15 ? 3 : 2.4 * e + 0.5 * Math.exp(-t * 0.25));
    }
    this.fire.update(dt, cam); this.smoke.update(dt, cam);
    return t < 30;
  }

  /** the blast lighting the arena: the world's colours pushed up toward the god's fire, the fog toward smoke */
  light(k) {
    const A = this.arena?.mats; if (!A || !this.lit0) return;
    const h = this.G.hot;
    A.opaque.color.setRGB(this.lit0.r * (1 + k * h[0] * 0.9), this.lit0.g * (1 + k * h[1] * 0.9), this.lit0.b * (1 + k * h[2] * 0.9));
    A.alpha.color.copy(A.opaque.color);
    if (this.fog0 && this.scene.fog) { const s = this.G.smoke; this.scene.fog.color.setRGB(this.fog0.r + (s[0] * 2 - this.fog0.r) * Math.min(0.6, k * 0.35), this.fog0.g + (s[1] * 2 - this.fog0.g) * Math.min(0.6, k * 0.35), this.fog0.b + (s[2] * 2 - this.fog0.b) * Math.min(0.6, k * 0.35)); }
  }

  /** the cinematic: a high, wide shot from off to the side of the comet's path; the comet crossing in, then the cloud */
  cam(camera, dt, shake = 0) {
    const { c, h, t } = this, side = new THREE.Vector3(-h.z, 0, h.x);
    const back = 92 + Math.max(0, t) * 5, up = 24 + Math.max(0, t) * 3.5;
    camera.position.copy(c).addScaledVector(side, back).addScaledVector(h, -30).add(new THREE.Vector3(0, up, 0));
    let look;
    if (t < 0) { const p = this.cometPos; look = c.clone().lerp(p, 0.3); look.y = Math.min(look.y, c.y + 40); }
    else look = c.clone().setY(c.y + Math.min(32, 6 + t * 7));
    camera.lookAt(look);
    if (shake) camera.rotateX((Math.random() - 0.5) * shake * 0.03).rotateY((Math.random() - 0.5) * shake * 0.03);
    camera.fov = 68; camera.updateProjectionMatrix();
  }

  dispose() {
    for (const o of this.objs) { o.removeFromParent(); o.traverse?.(x => { x.geometry?.dispose(); x.material?.dispose?.(); }); }
    this.fire.dispose(); this.smoke.dispose(); this.tex.dispose(); this.glow.dispose();
    if (this.lit0) { this.arena.mats.opaque.color.copy(this.lit0); this.arena.mats.alpha.color.copy(this.lit0); }
    if (this.fog0 && this.scene.fog) this.scene.fog.color.copy(this.fog0);
  }
}
