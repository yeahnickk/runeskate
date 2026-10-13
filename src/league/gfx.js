// Rune League's finish, the parts that make it look like a modern game while the world stays RS: an HDR target
// (multisampled), bloom (bright pass, blurred down to a quarter and an eighth of the screen), FXAA, a filmic curve,
// a little grade, vignette and dither; a sky dome (gradient, the sun and its glare, drifting clouds, horizon haze);
// the sun's shadows; and a resolution that follows the frame rate so a slow machine stays smooth.
import * as THREE from 'three';

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const _v = new THREE.Vector3(), quad = new THREE.PlaneGeometry(2, 2), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export class Post {
  constructor(renderer, lite) {
    this.r = renderer; this.lite = lite;
    const gl = renderer.getContext(), hdr = renderer.capabilities.isWebGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
    const type = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType; this.hdr = hdr;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { samples: lite ? 0 : 4, type });
    this.rt.depthTexture = new THREE.DepthTexture(4, 4); this.rt.depthTexture.type = THREE.UnsignedIntType;   // (the sky is where depth is ~1: light shafts come through the gaps)
    this.sun = new THREE.Vector3(0, 1, 0); this.sunS = new THREE.Vector3(); this.shafts = !lite; this.speed = 0; this.flK = 0;
    const mk = () => new THREE.WebGLRenderTarget(4, 4, { type, depthBuffer: false });
    this.q = [mk(), mk()]; this.e = [mk(), mk()];
    const pass = (fs, uniforms) => { const m = new THREE.Mesh(quad, new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false })); const s = new THREE.Scene(); s.add(m); return { s, u: m.material.uniforms }; };
    // bright: what's over the threshold, soft-kneed, from the full-size image down to a quarter
    this.bright = pass(`uniform sampler2D t; uniform vec2 px; uniform float th; varying vec2 vUv;
      vec3 S(vec2 o) { return texture2D(t, vUv + o * px).rgb; }
      void main(){ vec3 c = (S(vec2(-1.0)) + S(vec2(1.0, -1.0)) + S(vec2(-1.0, 1.0)) + S(vec2(1.0))) * 0.25;
        float l = max(c.r, max(c.g, c.b)), k = clamp((l - th) / 0.35, 0.0, 1.0); gl_FragColor = vec4(c * k * k, 1.0); }`, { t: { value: null }, px: { value: new THREE.Vector2() }, th: { value: hdr ? 0.92 : 0.82 } });
    // blur: 9 taps in 5 fetches (linear sampling), one direction at a time
    this.blur = pass(`uniform sampler2D t; uniform vec2 d; varying vec2 vUv;
      void main(){ vec3 c = texture2D(t, vUv).rgb * 0.2270270270;
        c += (texture2D(t, vUv + d * 1.3846153846).rgb + texture2D(t, vUv - d * 1.3846153846).rgb) * 0.3162162162;
        c += (texture2D(t, vUv + d * 3.2307692308).rgb + texture2D(t, vUv - d * 3.2307692308).rgb) * 0.0702702703;
        gl_FragColor = vec4(c, 1.0); }`, { t: { value: null }, d: { value: new THREE.Vector2() } });
    // light shafts: the open sky round the sun (from depth), then smeared toward the sun twice (16 taps each: 256 in all)
    this.mask = pass(`uniform sampler2D t, dep; uniform vec2 sun, asp; varying vec2 vUv;
      void main(){ float sky = step(0.99995, texture2D(dep, vUv).r); vec2 d = (vUv - sun) * asp; float f = max(0.0, 1.0 - length(d) * 1.6);
        vec3 c = min(texture2D(t, vUv).rgb, vec3(2.0)); gl_FragColor = vec4(c * sky * f * f, 1.0); }`, { t: { value: null }, dep: { value: null }, sun: { value: new THREE.Vector2() }, asp: { value: new THREE.Vector2(1, 1) } });
    this.rad = pass(`uniform sampler2D t; uniform vec2 sun; uniform float step; varying vec2 vUv;
      void main(){ vec2 d = (sun - vUv) * step; vec2 uv = vUv; vec3 c = vec3(0.0); float w = 1.0, ws = 0.0;
        for (int i = 0; i < 16; i++) { c += texture2D(t, uv).rgb * w; ws += w; w *= 0.94; uv += d; }
        gl_FragColor = vec4(c / ws, 1.0); }`, { t: { value: null }, sun: { value: new THREE.Vector2() }, step: { value: 0.06 } });
    // ambient occlusion (HIGH): view-space positions from depth, normals from neighbours, 12 taps round a disc whose
    // size is fixed in the world; occluders must sit above the surface's own plane, so flat ground never darkens itself
    this.ssao = pass(`uniform sampler2D dep; uniform vec2 nf, tanF, px; uniform float rad; varying vec2 vUv;
      float ld(vec2 uv) { float d = texture2D(dep, uv).r; return nf.x * nf.y / (nf.y - d * (nf.y - nf.x)); }
      vec3 P(vec2 uv) { float z = ld(uv); return vec3((uv * 2.0 - 1.0) * tanF * z, -z); }
      void main(){
        if (texture2D(dep, vUv).r > 0.99995) { gl_FragColor = vec4(1.0); return; }
        vec3 p = P(vUv), px1 = P(vUv + vec2(px.x, 0.0)) - p, py1 = P(vUv + vec2(0.0, px.y)) - p, px2 = p - P(vUv - vec2(px.x, 0.0)), py2 = p - P(vUv - vec2(0.0, px.y));
        vec3 n = normalize(cross(dot(px1, px1) < dot(px2, px2) ? px1 : px2, dot(py1, py1) < dot(py2, py2) ? py1 : py2));
        float sr = rad / (-p.z * tanF.y * 2.0), a0 = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.283, occ = 0.0;
        for (int i = 0; i < 12; i++) { float r = (float(i) + 0.5) / 12.0, a = a0 + float(i) * 2.39996;
          vec3 v = P(vUv + vec2(cos(a), sin(a)) * r * sr) - p; float vv = dot(v, v);
          occ += max(0.0, dot(v, n) - 0.01 * -p.z) / (vv + 0.02 * rad * rad) * (1.0 - smoothstep(rad * 0.5, rad * 1.5, sqrt(vv))); }
        gl_FragColor = vec4(vec3(clamp(1.0 - occ / 12.0 * rad * 1.6, 0.0, 1.0)), 1.0); }`, { dep: { value: null }, nf: { value: new THREE.Vector2() }, tanF: { value: new THREE.Vector2() }, px: { value: new THREE.Vector2() }, rad: { value: 0.5 } });
    this.ao = !lite;
    this.copy = pass(`uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(t, vUv).rgb, 1.0); }`, { t: { value: null } });
    // the composite: FXAA on the scene, the bloom on top, the filmic curve, grade, vignette, dither
    this.final = pass(`uniform sampler2D t, b1, b2, sh, ao; uniform float aoK; uniform vec2 px, sun, asp; uniform float bloom, time, shK, flK, speed; varying vec2 vUv;
      vec3 S(vec2 uv) { return texture2D(t, uv).rgb; }
      float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
      void main(){
        vec3 m = S(vUv), nw = S(vUv + vec2(-1.0, 1.0) * px), ne = S(vUv + vec2(1.0, 1.0) * px), sw = S(vUv + vec2(-1.0, -1.0) * px), se = S(vUv + vec2(1.0, -1.0) * px);
        float lm = lum(m), lnw = lum(nw), lne = lum(ne), lsw = lum(sw), lse = lum(se);
        float lo = min(lm, min(min(lnw, lne), min(lsw, lse))), hi = max(lm, max(max(lnw, lne), max(lsw, lse)));
        vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
        float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + max((lnw + lne + lsw + lse) * 0.03125, 0.0078125));
        dir = clamp(dir * rcp, -8.0, 8.0) * px;
        vec3 a = 0.5 * (S(vUv + dir * (1.0 / 3.0 - 0.5)) + S(vUv + dir * (2.0 / 3.0 - 0.5)));
        vec3 b = a * 0.5 + 0.25 * (S(vUv - dir * 0.5) + S(vUv + dir * 0.5));
        float lb = lum(b); vec3 c = (lb < lo || lb > hi) ? a : b;
        if (aoK > 0.0) c *= mix(1.0, texture2D(ao, vUv).r, aoK);
        c += (texture2D(b1, vUv).rgb * 0.6 + texture2D(b2, vUv).rgb * 0.9) * bloom;
        // speed: at supersonic the edges streak toward the middle (a radial smear of the bloom-free image, cheap: 6 taps)
        if (speed > 0.0) { vec2 dc = vUv - 0.5; float e = smoothstep(0.15, 0.7, length(dc)) * speed; vec3 r = vec3(0.0);
          for (int i = 1; i <= 6; i++) r += S(vUv - dc * float(i) * 0.012 * e); c = mix(c, r / 6.0, e * 0.85); }
        // the sun: shafts through the rafters, and a faint flare of ghosts across the lens when it's in view
        if (shK > 0.0) { c += texture2D(sh, vUv).rgb * shK * vec3(1.0, 0.9, 0.72);
          vec2 sd = sun - 0.5; float vis = flK * clamp(dot(texture2D(sh, sun).rgb, vec3(0.33)) * 2.0, 0.0, 1.0);   // (hidden behind a beam: no flare)
          for (int i = 1; i <= 4; i++) { vec2 g = 0.5 - sd * (float(i) * 0.55 - 0.3); float r = 0.018 + float(i) * 0.014, dd = length((vUv - g) * asp);
            c += vec3(0.9 + 0.1 * float(i), 0.75, 0.5 + 0.12 * float(i)) * smoothstep(r, r * 0.6, dd) * 0.035 * vis; }
          c += vec3(1.0, 0.85, 0.6) * pow(max(0.0, 1.0 - length((vUv - sun) * asp) * 3.0), 3.0) * 0.12 * vis; }
        // filmic shoulder: 1 stays ~1, highlights roll off instead of clipping
        c = c * (1.0 + c * 0.08) / (1.0 + c * 0.42) * 1.34;
        float l = lum(c); c = mix(vec3(l), c, 1.12);                                      // (richer)
        c = mix(c, c * vec3(1.03, 1.0, 0.96), smoothstep(0.3, 0.9, l));                  // (warm highlights)
        c = mix(c, c * vec3(0.96, 1.0, 1.05), 1.0 - smoothstep(0.05, 0.35, l));          // (cool shadows)
        vec2 v = vUv - 0.5; c *= 1.0 - 0.3 * dot(v, v);
        c += (fract(sin(dot(gl_FragCoord.xy + time, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;   // (dither: no banding in the sky)
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`, { t: { value: this.rt.texture }, b1: { value: this.q[0].texture }, b2: { value: this.e[0].texture }, px: { value: new THREE.Vector2() }, bloom: { value: 0.55 }, time: { value: 0 },
      sh: { value: null }, sun: { value: new THREE.Vector2() }, asp: { value: new THREE.Vector2(1, 1) }, shK: { value: 0 }, flK: { value: 0 }, speed: { value: 0 }, ao: { value: null }, aoK: { value: 0 } });
    this.s = [mk(), mk()]; this.a = [mk(), mk()];
  }
  setSize(w, h) {
    this.w = w; this.h = h; this.rt.setSize(w, h);
    const qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2), ew = Math.max(1, w >> 3), eh = Math.max(1, h >> 3);
    for (const t of this.q) t.setSize(qw, qh); for (const t of this.e) t.setSize(ew, eh); for (const t of this.s) t.setSize(qw, qh); for (const t of this.a) t.setSize(w >> 1, h >> 1);
    const asp = new THREE.Vector2(w / h, 1); this.final.u.asp.value.copy(asp); this.mask.u.asp.value.copy(asp);
    this.final.u.px.value.set(1 / w, 1 / h); this.bright.u.px.value.set(1 / w, 1 / h);
  }
  run(p, target) { this.r.setRenderTarget(target); this.r.render(p.s, cam); }
  render(scene, camera) {
    const r = this.r; r.setRenderTarget(this.rt); r.clear(); r.render(scene, camera);
    // bloom: bright pass to a quarter, blur it, copy down to an eighth, blur that wider
    this.bright.u.t.value = this.rt.texture; this.run(this.bright, this.q[0]);
    const B = this.blur.u, qx = 1 / this.q[0].width, qy = 1 / this.q[0].height, ex = 1 / this.e[0].width, ey = 1 / this.e[0].height;
    B.t.value = this.q[0].texture; B.d.value.set(qx, 0); this.run(this.blur, this.q[1]); B.t.value = this.q[1].texture; B.d.value.set(0, qy); this.run(this.blur, this.q[0]);
    this.copy.u.t.value = this.q[0].texture; this.run(this.copy, this.e[0]);
    B.t.value = this.e[0].texture; B.d.value.set(ex * 1.5, 0); this.run(this.blur, this.e[1]); B.t.value = this.e[1].texture; B.d.value.set(0, ey * 1.5); this.run(this.blur, this.e[0]);
    // the sun on screen (it may be off the edge and still throw shafts in; behind us, none)
    const F = this.final.u, ss = this.sunS.copy(camera.position).addScaledVector(this.sun, 1000).project(camera), front = camera.getWorldDirection(_v).dot(this.sun);
    F.shK.value = 0; F.flK.value = 0;
    if (this.shafts && front > 0.05) {
      const su = [ss.x * 0.5 + 0.5, ss.y * 0.5 + 0.5];
      this.mask.u.t.value = this.rt.texture; this.mask.u.dep.value = this.rt.depthTexture; this.mask.u.sun.value.set(su[0], su[1]); this.run(this.mask, this.s[0]);
      const R = this.rad.u; R.sun.value.set(su[0], su[1]);
      R.t.value = this.s[0].texture; R.step.value = 0.055; this.run(this.rad, this.s[1]); R.t.value = this.s[1].texture; R.step.value = 0.016; this.run(this.rad, this.s[0]);
      F.sh.value = this.s[0].texture; F.sun.value.set(su[0], su[1]);
      F.shK.value = 0.5 * Math.min(1, front * 2.5);
      const on = Math.abs(ss.x) < 1 && Math.abs(ss.y) < 1 ? 1 : 0; this.flK += (on * Math.min(1, front * 2) - this.flK) * 0.15; F.flK.value = this.flK || 0;
    }
    F.speed.value = this.speed; F.aoK.value = 0;
    if (this.ao && camera.isPerspectiveCamera) {
      const A = this.ssao.u, ty = Math.tan(camera.fov * Math.PI / 360); A.dep.value = this.rt.depthTexture; A.nf.value.set(camera.near, camera.far); A.tanF.value.set(ty * camera.aspect, ty);
      A.px.value.set(1 / this.w, 1 / this.h); this.run(this.ssao, this.a[0]);
      const B = this.blur.u; B.t.value = this.a[0].texture; B.d.value.set(1 / this.a[0].width, 0); this.run(this.blur, this.a[1]); B.t.value = this.a[1].texture; B.d.value.set(0, 1 / this.a[0].height); this.run(this.blur, this.a[0]);
      F.ao.value = this.a[0].texture; F.aoK.value = 0.85;
    }
    F.time.value = (F.time.value + 1) % 1000; this.run(this.final, null);
  }
}

// ---------------------------------------------------------------- the sky: a dome that follows the camera
export function buildSky(sunDir, fogCol) {
  const fog = new THREE.Color(fogCol);
  const m = new THREE.ShaderMaterial({
    uniforms: { sun: { value: sunDir.clone().normalize() }, time: { value: 0 }, haze: { value: new THREE.Vector3(fog.r, fog.g, fog.b) } },
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.99999; }',
    fragmentShader: `uniform vec3 sun, haze; uniform float time; varying vec3 vD;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
      void main(){
        vec3 d = normalize(vD); float y = d.y;
        vec3 zen = vec3(0.16, 0.36, 0.72), mid = vec3(0.36, 0.56, 0.86);
        vec3 c = mix(mid, zen, smoothstep(0.08, 0.75, y));
        c = mix(haze, c, smoothstep(-0.02, 0.22, y));
        float sd = max(dot(d, sun), 0.0);
        c += vec3(1.0, 0.86, 0.62) * (pow(sd, 8.0) * 0.25 + pow(sd, 90.0) * 0.6);             // (the glare round the sun)
        // clouds: two layers of fbm on a flat sky plane, drifting; lit on the sun's side
        if (y > 0.0) {
          vec2 uv = d.xz / (y + 0.12) * 1.6 + vec2(time * 0.012, time * 0.004);
          float cl = smoothstep(0.52, 0.85, fbm(uv)) * 0.85 + smoothstep(0.6, 0.9, fbm(uv * 2.7 + 3.0)) * 0.25;
          cl *= smoothstep(0.0, 0.25, y);
          vec3 cc = mix(vec3(0.82, 0.86, 0.92), vec3(1.0, 0.98, 0.94), pow(sd, 3.0)) * (0.95 + 0.1 * fbm(uv * 4.0));
          c = mix(c, cc, clamp(cl, 0.0, 0.9));
        }
        c += vec3(1.4, 1.25, 1.0) * smoothstep(0.9993, 0.9997, sd) * 3.0;                     // (the sun's disc: bright enough to bloom)
        gl_FragColor = vec4(c, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), m); mesh.renderOrder = -10; mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------- the frame rate: the resolution follows it
export class Scaler {
  constructor(base, min = 0.6) { this.base = base; this.min = min; this.k = 1; this.ema = 16; this.n = 0; this.wait = 2; }
  /** feed a frame's ms; returns a new pixel ratio when it should change, else 0 */
  tick(ms, dt) {
    this.ema += (Math.min(ms, 100) - this.ema) * 0.05; this.wait -= dt; if (this.wait > 0) return 0;
    let k = this.k;
    if (this.ema > 21) k = Math.max(this.min, k - 0.1); else if (this.ema < 13 && k < 1) k = Math.min(1, k + 0.05);
    if (k === this.k) return 0;
    this.k = k; this.wait = 1.5; return this.base * k;
  }
}
