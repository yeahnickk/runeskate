// Rune League's finish, the parts that make it look like a modern game while the world stays RS: an HDR target
// (multisampled), bloom (bright pass, blurred down to a quarter and an eighth of the screen), FXAA, a filmic curve,
// a little grade, vignette and dither; a sky dome (gradient, the sun and its glare, drifting clouds, horizon haze);
// the sun's shadows; and a resolution that follows the frame rate so a slow machine stays smooth.
import * as THREE from 'three';

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const quad = new THREE.PlaneGeometry(2, 2), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export class Post {
  constructor(renderer, lite) {
    this.r = renderer; this.lite = lite;
    const gl = renderer.getContext(), hdr = renderer.capabilities.isWebGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
    const type = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType; this.hdr = hdr;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { samples: lite ? 0 : 4, type });
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
    this.copy = pass(`uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(t, vUv).rgb, 1.0); }`, { t: { value: null } });
    // the composite: FXAA on the scene, the bloom on top, the filmic curve, grade, vignette, dither
    this.final = pass(`uniform sampler2D t, b1, b2; uniform vec2 px; uniform float bloom, time; varying vec2 vUv;
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
        c += (texture2D(b1, vUv).rgb * 0.6 + texture2D(b2, vUv).rgb * 0.9) * bloom;
        // filmic shoulder: 1 stays ~1, highlights roll off instead of clipping
        c = c * (1.0 + c * 0.08) / (1.0 + c * 0.42) * 1.34;
        float l = lum(c); c = mix(vec3(l), c, 1.12);                                      // (richer)
        c = mix(c, c * vec3(1.03, 1.0, 0.96), smoothstep(0.3, 0.9, l));                  // (warm highlights)
        c = mix(c, c * vec3(0.96, 1.0, 1.05), 1.0 - smoothstep(0.05, 0.35, l));          // (cool shadows)
        vec2 v = vUv - 0.5; c *= 1.0 - 0.3 * dot(v, v);
        c += (fract(sin(dot(gl_FragCoord.xy + time, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;   // (dither: no banding in the sky)
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`, { t: { value: this.rt.texture }, b1: { value: this.q[0].texture }, b2: { value: this.e[0].texture }, px: { value: new THREE.Vector2() }, bloom: { value: 0.55 }, time: { value: 0 } });
  }
  setSize(w, h) {
    this.w = w; this.h = h; this.rt.setSize(w, h);
    const qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2), ew = Math.max(1, w >> 3), eh = Math.max(1, h >> 3);
    for (const t of this.q) t.setSize(qw, qh); for (const t of this.e) t.setSize(ew, eh);
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
    this.final.u.time.value = (this.final.u.time.value + 1) % 1000; this.run(this.final, null);
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
