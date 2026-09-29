import { readFileSync } from 'fs';
import { World } from '../src/world.js';
import { Skater } from '../src/skater.js';
const w = new World(JSON.parse(readFileSync(new URL('../assets/world.json', import.meta.url))));
const L = (x, z) => [x - w.base[0], z - w.base[1]];
const blank = () => ({ steer: 0, push: false, brake: false, jump: false, jumpPressed: false, slide: false, trick: null, anyKey: false });
// ASCII map of the graveyard: '#' blocked tile, '.' open
if (0) for (let z = 3218; z >= 3186; z--) { let r = String(z).padEnd(5); for (let x = 3230; x <= 3256; x++) { const [a, b] = L(x + 0.5, z + 0.5); r += w.tileKind(a, b) ? '#' : '.'; } console.log(r); }
let out = 0;
for (let k = 0; k < 16; k++) {
  const sk = new Skater(w); const [x, z] = L(3242.5, 3197.5); const h = k / 16 * Math.PI * 2; sk.reset(x, z, h);
  let fwd = 1;
  const ollie = process.argv[2] === 'ollie';
  for (let i = 0; i < 8 * 240; i++) { const t = i / 240; const ph = t % 1.6; sk.step(1 / 240, Object.assign(blank(), { push: true, fwd, jump: ollie && ph > 0.6 && ph < 1.0 })); sk.events.length = 0; }
  const X = sk.x + w.base[0], Z = sk.z + w.base[1];
  const esc = X < 3237.5 || X > 3252.5 || Z > 3204.5 || Z < 3190.5;
  if (esc) out++;
  console.log(k, (h * 180 / Math.PI).toFixed(0), X.toFixed(1), Z.toFixed(1), sk.mode, esc ? 'ESCAPED' : '');
}
console.log('escaped', out, '/16');
