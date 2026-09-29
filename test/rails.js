import { readFileSync } from 'fs';
import { World } from '../src/world.js';
const w = new World(JSON.parse(readFileSync(new URL('../assets/world.json', import.meta.url))));
const B = w.base;
const list = w.rails.map(r => ({ from: [r.ax + B[0], r.az + B[1]], to: [r.bx + B[0], r.bz + B[1]], len: r.len, top: r.prof.map(p => p[1]).filter((_, i) => i % 3 === 1).map(v => +v.toFixed(2)) }));
list.sort((a, b) => b.len - a.len);
for (const r of list.slice(0, 25)) console.log(JSON.stringify(r));
console.log('total rails', list.length, 'total length', list.reduce((a, r) => a + r.len, 0));
