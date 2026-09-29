// Pre-compress the big static files so serve.ts can hand out .br / .gz siblings.
//   bun runeskate/tools/compress.ts
// Re-run after re-exporting any asset (a stale sibling is skipped by serve.ts: it checks mtimes).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { brotliCompressSync, gzipSync, constants as Z } from 'zlib';

const ROOT = join(import.meta.dir, '..');
const dirs = ['assets', 'vendor'];          // src/ is small and changes often: serve.ts gzips it on the fly
let saved = 0;
for (const d of dirs) {
  for (const f of readdirSync(join(ROOT, d))) {
    if (!/\.(json|bin|js)$/.test(f)) continue;
    const p = join(ROOT, d, f), st = statSync(p);
    if (st.size < 8 * 1024) continue;
    const raw = readFileSync(p);
    const t0 = performance.now();
    const br = brotliCompressSync(raw, { params: { [Z.BROTLI_PARAM_QUALITY]: raw.length > 8e6 ? 9 : 11, [Z.BROTLI_PARAM_LGWIN]: 24, [Z.BROTLI_PARAM_SIZE_HINT]: raw.length } });
    const gz = gzipSync(raw, { level: 9 });
    writeFileSync(p + '.br', br);
    // keep an existing, up-to-date .gz (the committed world.bin.gz is smaller than zlib -9 makes)
    if (!existsSync(p + '.gz') || statSync(p + '.gz').mtimeMs < st.mtimeMs) writeFileSync(p + '.gz', gz);
    saved += raw.length - br.length;
    console.log(`${d}/${f}`.padEnd(34), String(raw.length).padStart(10), 'br', String(br.length).padStart(10), 'gz', String(gz.length).padStart(10), `${((performance.now() - t0) / 1000).toFixed(1)}s`);
  }
}
console.log(`done, brotli saves ${(saved / 1e6).toFixed(1)} MB over raw`);
