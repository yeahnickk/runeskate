// Browser shims so the real webclient render/config classes (third_party/webclient) load under Bun.
// Any browser API they touch at import time becomes a harmless no-op. Used by every tools/export-*.ts:
//   bun --preload ./tools/preload.ts tools/export-world.ts
const g: any = globalThis;
const stub: any = new Proxy(function () {}, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : stub),
  apply: () => stub,
  construct: () => stub,
  set: () => true,
});
g.window ??= g;
g.document = stub;
g.navigator = { userAgent: 'bun', platform: 'bun', maxTouchPoints: 0 };
g.AudioContext = stub; g.webkitAudioContext = stub; g.audioContext = stub;
g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
g.addEventListener = () => {}; g.removeEventListener = () => {};
g.requestAnimationFrame = (f: any) => setTimeout(f, 16);
g.Image = stub; g.Worker = stub;
g.HTMLCanvasElement ??= class {}; g.HTMLImageElement ??= class {}; g.CanvasRenderingContext2D ??= class {};
g.ImageData ??= class { data: Uint8ClampedArray; width: number; height: number;
  constructor(w: number, h: number) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } };
// relative fetches (the webclient's soundfont) answer 404
const realFetch = globalThis.fetch;
(globalThis as any).fetch = (u: any, o?: any) => (typeof u === 'string' && u.startsWith('/')) ? Promise.resolve(new Response(null, { status: 404 })) : realFetch(u, o);
