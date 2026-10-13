// Rune League's pitch: Rocket League's soccar arena to the unit (uu), as a distance field the cars drive on. Pure (the
// match runs headless and on the server). Axes are three.js's: x across, y up, z down the pitch; blue defends -z.
// The arena is a rounded octagonal prism (walls curve into the floor and ceiling at R, so you can drive up them and
// along them; the corners are cut at 45 degrees), with a goal box let into each end wall.
export const W = 4096, L = 5120, H = 2044;                       // half width, half length, height
export const R = 256;                                            // the quarter pipes: floor/wall, wall/ceiling, corner
export const CH = 8064;                                          // the corners: |x| + |z| <= CH
export const GW = 892.755, GH = 642.775, GD = 880;               // goal mouth half width, height, depth behind the line
const GR = 40, S2 = Math.SQRT2;

// the playable volume shrunk by R (a prism: the octagon across x/z, R..H-R up): the arena is that grown by R
const kx = W - R, kz = L - R, kc = CH - R * S2, ky0 = R, ky1 = H - R;
/** distance from (x, z) to the octagon (0 inside) */
function oct2(x, z) {
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax <= kx && az <= kz && ax + az <= kc) return 0;
  // the closest point on the boundary: clamp to the box, then to the cut (the octagon is convex: try each edge)
  let best = Infinity;
  const seg = (x0, z0, x1, z1) => { const dx = x1 - x0, dz = z1 - z0, t = Math.max(0, Math.min(1, ((ax - x0) * dx + (az - z0) * dz) / (dx * dx + dz * dz))); best = Math.min(best, Math.hypot(ax - x0 - dx * t, az - z0 - dz * t)); };
  seg(0, kz, kc - kz, kz); seg(kc - kz, kz, kx, kc - kx); seg(kx, kc - kx, kx, 0);
  return best;
}
/** room (uu) from a point to the arena's skin: + inside, - inside the walls (without the goals) */
function arenaD(x, y, z) {
  const ax = Math.abs(x), az = Math.abs(z);
  const inK = Math.min(kx - ax, kz - az, (kc - ax - az) / S2, y - ky0, ky1 - y);
  if (inK >= 0) return R + inK;
  const o = oct2(x, z), oy = y < ky0 ? ky0 - y : y > ky1 ? y - ky1 : 0;
  return R - Math.hypot(o, oy);
}
// a goal: a rounded box from well inside the pitch to the back of the net (union with the arena fills the quarter pipe
// across the mouth, so the floor runs flat into the goal)
const gx = GW - GR, gy0 = GR, gy1 = GH - GR, gz0 = L - 1200, gz1 = L + GD - GR;
function goalD(x, y, z) {
  const ax = Math.abs(x), az = Math.abs(z);
  const dx = ax - gx, dy = y < gy0 ? gy0 - y : y > gy1 ? y - gy1 : -Math.min(y - gy0, gy1 - y), dz = az > gz1 ? az - gz1 : az < gz0 ? gz0 - az : -Math.min(az - gz0, gz1 - az);
  const ox = Math.max(dx, 0), oy = Math.max(dy, 0), oz = Math.max(dz, 0);
  return GR - (Math.hypot(ox, oy, oz) + Math.min(Math.max(dx, dy, dz), 0));
}
/** room from a point to the nearest surface (+ inside the playable space) */
export function D(x, y, z) { return Math.max(arenaD(x, y, z), goalD(x, y, z)); }
/** the surface normal there (pointing into the playable space), by central differences */
export function N(x, y, z, out = [0, 0, 0]) {
  const e = 2;
  const nx = D(x + e, y, z) - D(x - e, y, z), ny = D(x, y + e, z) - D(x, y - e, z), nz = D(x, y, z + e) - D(x, y, z - e), l = Math.hypot(nx, ny, nz) || 1;
  out[0] = nx / l; out[1] = ny / l; out[2] = nz / l; return out;
}
/** is the ball (centre, radius) over a goal line? -1 blue's goal (orange scored), 1 orange's, 0 neither */
export const inGoal = (x, y, z, r) => z < -(L + r) ? -1 : z > L + r ? 1 : 0;

// ---------------------------------------------------------------- the boost: 6 big (100, 10 s) and 28 small (12, 4 s)
export const PADS = [
  ...[[-3584, 0], [3584, 0], [-3072, 4096], [3072, 4096], [-3072, -4096], [3072, -4096]].map(([x, z]) => ({ x, z, big: true })),
  ...[[0, -4240], [-1792, -4184], [1792, -4184], [-940, -3308], [940, -3308], [0, -2816], [-3584, -2484], [3584, -2484], [-1788, -2300], [1788, -2300],
    [-2048, -1036], [0, -1024], [2048, -1036], [-1024, 0], [1024, 0], [-2048, 1036], [0, 1024], [2048, 1036], [-1788, 2300], [1788, 2300],
    [-3584, 2484], [3584, 2484], [0, 2816], [-940, 3310], [940, 3308], [-1792, 4184], [1792, 4184], [0, 4240]].map(([x, z]) => ({ x, z, big: false })),
];
export const PAD = { big: { r: 208, h: 168, amt: 100, t: 10 }, small: { r: 144, h: 165, amt: 12, t: 4 } };

// ---------------------------------------------------------------- where the cars start (blue's: orange's are mirrored)
// RL kickoffs: two diagonals, two off-centres, one back centre; a = heading (0 = facing +z, up the pitch)
export const KICKOFF = [[-2048, -2560, Math.PI / 4], [2048, -2560, -Math.PI / 4], [-256, -3840, 0], [256, -3840, 0], [0, -4608, 0]];
export const RESPAWN = [[-2304, -4608], [-2688, -4608], [2304, -4608], [2688, -4608]];
/** the kickoff spots for a team size: which of KICKOFF each car takes (one set is drawn each kickoff) */
export const KICK_SETS = { 1: [[0], [1], [2], [3], [4]], 2: [[0, 1], [2, 3], [0, 4], [1, 4]], 3: [[0, 1, 4], [0, 1, 2], [0, 1, 3]] };
