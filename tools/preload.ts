// export-only shims: the showreel preload + relative fetches (the webclient's soundfont) answer 404
import '../../showreel3/export/preload.ts';
const realFetch = globalThis.fetch;
(globalThis as any).fetch = (u: any, o?: any) => (typeof u === 'string' && u.startsWith('/')) ? Promise.resolve(new Response(null, { status: 404 })) : realFetch(u, o);
