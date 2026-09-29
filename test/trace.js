import { readFileSync } from 'fs';
import { World } from '../src/world.js';
import { Skater } from '../src/skater.js';
const w = new World(JSON.parse(readFileSync(new URL('../assets/world.json', import.meta.url))));
const sk = new Skater(w);
for (let i = 0; i < 720; i++) { sk.step(1/240, { steer:0, push:true }); if (i % 48 == 0) console.log((i/240).toFixed(2), (sk.x+3172).toFixed(2), (sk.z+3168).toFixed(2), sk.y.toFixed(2), sk.speed.toFixed(2), sk.events.map(e=>e.type).join(',')); sk.events.length=0; }
for (let z = 3217; z <= 3224; z += 0.5) console.log('h', z, w.height(50.5, z - 3168).toFixed(2), w.tileKind(50.5, z-3168));
for (const s of w.segsNear(50.72, 52.8, 1.5)) console.log('seg', s.ax+3172, s.az+3168, s.bx+3172, s.bz+3168, s.kind, s.top);
