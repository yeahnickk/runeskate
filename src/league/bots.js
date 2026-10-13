// Rune League's bots: they read the ball's path (match.ballPath), pick a role in the rotation (first man goes for it,
// second backs up, third sits in goal; whoever's low grabs a big boost), and drive it with the same controls a person
// has: steer, throttle, boost, powerslide, jump, dodge, aerial. Pure, so they play headless and on the server.
// Rookie: slow to react, no aerials, sloppy angles. Pro: boosts, flips into hits, low aerials. All-Star: aerials,
// power flips, tidy rotations.
import { C, basis, NO_INPUT } from './match.js';
import { L, PADS, D } from './arena.js';

export const DIFFS = {
  rookie: { name: 'ROOKIE', think: 0.4, aerial: 0, flip: 0.15, boost: 0.35, err: 260, speed: 0.82 },
  pro: { name: 'PRO', think: 0.16, aerial: 650, flip: 0.7, boost: 0.85, err: 110, speed: 0.95 },
  allstar: { name: 'ALL-STAR', think: 0.05, aerial: 1700, flip: 1, boost: 1, err: 30, speed: 1 },
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp = (x, a = -1, b = 1) => Math.max(a, Math.min(b, x));
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
/** a point in the car's frame: [forward, up, right] */
const local = (c, b, p) => { const d = [p[0] - c.p[0], p[1] - c.p[1], p[2] - c.p[2]]; return [dot(d, b.f), dot(d, b.u), dot(d, b.r)]; };

/** about how long the car needs to get to p (on the ground, turning, boosting if it can) */
export function eta(c, p, b = basis(c.q)) {
  const l = local(c, b, p), d = Math.hypot(l[0], l[2]), ang = Math.abs(Math.atan2(l[2], l[0]));
  const v0 = Math.max(0, Math.min(C.maxV, Math.hypot(c.v[0], c.v[2]) * Math.cos(Math.min(ang, Math.PI / 2))));
  const top = c.boost > 15 ? 2100 : 1400, avg = Math.min(top, (v0 + top) / 2 + d * 0.15);
  return d / Math.max(400, avg) + ang * 0.42 + (c.ground ? 0 : 0.35);
}

// ---------------------------------------------------------------- the brain
export function botInput(m, c, dt) {
  if (c.demoT > 0 || m.state === 'end') return NO_INPUT;
  const k = DIFFS[c.diff] || DIFFS.pro, ai = c.ai ??= { t: 0, plan: null, jumpT: -1, aerial: null, flipT: -1, seed: c.id.length * 7 + c.team };
  const b = basis(c.q), inp = { ...NO_INPUT, throttle: 1 };
  const dir = c.team === 0 ? 1 : -1;                             // the way we attack (+z for blue)
  const ownGoal = [0, 0, -dir * L], theirGoal = [0, 0, dir * (L + 300)];
  if (m.state === 'count') { ai.plan = null; ai.flipT = -1; ai.jumpT = -1; ai.back = false; return { ...NO_INPUT }; }
  ai.kick = m.state === 'play' && !m.firstTouch;
  ai.t -= dt;
  // ---- a move in progress: a jump, a dodge, an aerial
  if (ai.jumpT >= 0) return jumpMove(c, b, ai, dt, k);
  if (ai.aerial) { const r = aerialMove(m, c, b, ai, dt); if (r) return r; }
  if (!c.ground) return recover(c, b);
  // ---- where to go: re-plan every few tenths (slower bots react later)
  if (ai.t <= 0 || !ai.plan) { ai.t = k.think; ai.plan = plan(m, c, b, k, dir, ownGoal, theirGoal); }
  const P = ai.plan, tgt = P.target;
  // ---- drive there
  const l = local(c, b, tgt), ang = Math.atan2(l[2], l[0]), dist = Math.hypot(l[0], l[2]), sp = Math.hypot(c.v[0], c.v[1], c.v[2]), fwd = dot(c.v, b.f);
  inp.steer = clamp(ang * 3.2 + (P.wobble || 0));
  // speed: flat out, unless the ball's still on its way to the spot (then just early enough); always strike through it
  let want = C.maxV * k.speed;
  if (P.arrive && dist > 900) want = Math.max(900, Math.min(want, dist / Math.max(0.05, P.arrive - m.t) * 1.15));
  if (P.stop) want = Math.min(want, dist * 2.2);
  inp.throttle = fwd < want ? 1 : fwd > want + 200 ? -0.4 : 0;
  if (Math.abs(ang) > 2.4 && dist < 600 && fwd < 400) { inp.throttle = -1; inp.steer = -clamp(Math.sign(ang)); }   // (back out of a tight spot)
  inp.handbrake = Math.abs(ang) > 1.5 && sp > 600 && dist > 250;
  inp.boost = c.boost > 0 && Math.abs(ang) < 0.32 && fwd < Math.min(want, 2280) - 50 && (P.urgent || c.boost > 30 * (1 - k.boost) + 10) && k.boost > 0.3 && b.u[1] > 0.6;
  // ---- the hit: jump up to it, dodge into it, or go up and get it
  const ball = m.ball, lb = local(c, b, ball.p), bd = Math.hypot(lb[0], lb[2]), bh = ball.p[1] - c.p[1], bfront = lb[0] > 0 && Math.abs(Math.atan2(lb[2], lb[0])) < 0.5;
  const closing = (dot(c.v, b.f) - dot(ball.v, b.f));
  if (P.hit && c.ground && b.u[1] > 0.8) {
    const tHit = bd / Math.max(300, closing);
    if (ai.kick && bd < 480 + sp * 0.13 && bfront && k.flip > 0.3) { startJump(ai, 'flip', Math.atan2(lb[2], lb[0])); return jumpMove(c, b, ai, dt, k); }
    if (bh > 190 && bh < 480 && tHit < 0.45 && bfront) { startJump(ai, bh > 300 ? 'double' : 'jump', 0); return jumpMove(c, b, ai, dt, k); }
    if (bh < 170 && bd < 330 + closing * 0.08 && bd > 200 && bfront && closing > 500 && P.power && ai.flipOK) { ai.flipOK = false; startJump(ai, 'flip', Math.atan2(lb[2], lb[0])); return jumpMove(c, b, ai, dt, k); }
    if (bd > 900) ai.flipOK = m.rand() < k.flip;                  // (decided once per run at it: does this one get a power flip?)
    if (P.aerial && c.boost > 25 && Math.abs(Math.atan2(local(c, b, P.ballP)[2], local(c, b, P.ballP)[0])) < 0.35) { ai.aerial = { at: P.at, p: P.ballP, t0: m.t }; ai.jumpT = -1; return { ...inp, jump: true, boost: false }; }
  }
  return inp;
}

/** what to do: the role (first man / support / keeper / boost) and the point to drive to */
function plan(m, c, b, k, dir, ownGoal, theirGoal) {
  const path = m.ballPath(), mates = m.cars.filter(o => o.team === c.team && !o.demoT);
  // when each of us gets to the ball (its first point we can reach in time)
  const reach = o => {
    const ob = basis(o.q), aer = o.boost > 30 ? k.aerial : 0;
    for (const s of path) {
      const h = s.p[1], jumpy = h > 190 && h <= 470;             // (a jump or a double jump gets there: no boost needed)
      if (h > 260 + aer && !jumpy) continue;
      if (h > 470 && (!airy(s.p) || rise(h) > s.t)) continue;     // (up there: only out in the open, and only if we can climb to it in time)
      if (eta(o, s.p, ob) + (h > 190 ? 0.3 : 0) <= s.t) return s;
    }
    return path[path.length - 1] || { t: 4, p: m.ball.p, v: m.ball.v };
  };
  const mine = reach(c), myT = mine.t + (onWrongSide(c, mine.p, dir) ? 0.8 : 0);
  // first man: the one who gets there soonest (on the right side of it); ties go to the one nearer their own goal
  const order = mates.map(o => { const s = o === c ? mine : reach(o); return { o, t: s.t + (onWrongSide(o, s.p, dir) ? 0.8 : 0) + (o.p[2] * dir) * 0.00005 }; }).sort((a, b2) => a.t - b2.t);
  const rank = order.findIndex(e => e.o === c);
  const danger = path.goal === -dir, kick = m.state === 'play' && !m.firstTouch;
  const err = (m.rand() - 0.5) * k.err;
  if (kick) {
    // the kickoff: the nearest goes; the others hang back (and grab boost on the way)
    if (rank === 0) return { target: [err * 0.2, 0, 0], hit: true, urgent: true };
    return rank === 1 && mates.length === 3 ? boostPlan(c, dir, true) || { target: [0, 0, -dir * 2500] } : { target: [ownGoal[0], 0, ownGoal[2] + dir * 900], stop: true };
  }
  if (rank === 0 || danger && rank === 1) {
    const s = rank === 0 ? mine : reach(c), B = s.p;
    // aim: through the ball at their goal (or clear it wide out of our own if we're defending)
    let aimAt = theirGoal; if (danger || B[2] * dir < -L + 1800) aimAt = [Math.sign(B[0] || 1) * 3800, 0, B[2] + dir * 1200];
    let sx = aimAt[0] - B[0], sz = aimAt[2] - B[2]; const sl = Math.hypot(sx, sz) || 1; sx /= sl; sz /= sl;
    const dist = flat(c.p, B), off = Math.min(900, dist * 0.42) + C.ballR + 40;
    let target = [B[0] - sx * off + err, 0, B[2] - sz * off];
    // caught the wrong side of it: rotate back to the far post (wide of the ball), then come again once goal side
    const ai = c.ai, ahead = (c.p[2] - B[2]) * dir;
    if (ahead > 350) ai.back = true; else if (ahead < -500) ai.back = false;
    if (ai.back && !danger) { const fp = -Math.sign(B[0] || c.p[0] || 1) * 1100; target = [fp, 0, ownGoal[2] + dir * Math.max(700, Math.min(3500, (B[2] - ownGoal[2]) * dir - 1800))]; return { target, urgent: true, back: true }; }
    if (ai.back && danger) { target = [B[0] * 0.5, 0, ownGoal[2] + dir * 400]; return { target, urgent: true, back: true }; }
    if (dist < 500) target = [B[0] - sx * (C.ballR + 20), 0, B[2] - sz * (C.ballR + 20)];
    const aerial = B[1] > 300 && k.aerial > 0 && B[1] < 300 + k.aerial && airy(B) && dist < 600 + B[1] * 1.8 && s.t < rise(B[1]) + 0.5;
    return { target, hit: true, urgent: danger || s.t < 1.6 || dist < 1500, power: !danger || dist < 1200, aerial, at: m.t + s.t, ballP: B, arrive: m.t + s.t };
  }
  // backing up: low on boost, go and get a big one; else hold a spot between the ball and our goal
  if (c.boost < 35 && !danger) { const bp = boostPlan(c, dir, false); if (bp) return bp; }
  const B = m.ball.p, back = rank === 1 ? 2600 : 4400;
  const z = Math.max(-L + 500, Math.min(L - 500, (B[2] - dir * back) * dir)) * dir;
  const x = rank === 1 ? B[0] * 0.5 : B[0] * 0.15;
  return { target: [x, 0, z * (rank === 2 ? 1 : 1)], stop: true, wobble: 0 };
}
/** about how long an aerial takes to climb to height h (a jump, then boosting up against gravity) */
const rise = h => 0.3 + Math.sqrt(2 * Math.max(0, h - 230) / 420);
const airy = p => D(p[0], p[1], p[2]) > 420;                     // out in the open (not a wall or ceiling read)
const onWrongSide = (c, B, dir) => (c.p[2] - B[2]) * dir > 250;   // past the ball, facing their goal
function boostPlan(c, dir, ahead) {
  let best = null, bd = Infinity;
  for (const p of PADS) { if (!p.big) continue; if (!ahead && p.z * dir > 500) continue; const d = Math.hypot(p.x - c.p[0], p.z - c.p[2]); if (d < bd) { bd = d; best = p; } }
  return best && { target: [best.x, 0, best.z], urgent: false };
}

// ---------------------------------------------------------------- jumps and dodges
function startJump(ai, kind, ang) { ai.jumpT = 0; ai.kind = kind; ai.ang = ang; }
function jumpMove(c, b, ai, dt, k) {
  const t = ai.jumpT; ai.jumpT += dt;
  const inp = { ...NO_INPUT, throttle: 1, boost: ai.kind === 'flip' && c.boost > 0 && t < 0.08 };
  if (ai.kind === 'jump') { inp.jump = t < 0.2; if (t > 0.6) ai.jumpT = -1; return inp; }
  if (ai.kind === 'double') { inp.jump = t < 0.18 || (t > 0.22 && t < 0.27); if (t > 0.8) ai.jumpT = -1; return inp; }
  // a dodge: a short hop, then flip towards ang (0 = straight on)
  inp.jump = t < 0.06 || (t > 0.11 && t < 0.16);
  if (t > 0.1) { inp.pitch = -Math.cos(ai.ang); inp.yaw = Math.sin(ai.ang); }
  if (t > 1.0 || (t > 0.3 && c.ground)) ai.jumpT = -1;
  return inp;
}

// ---------------------------------------------------------------- in the air: point the nose and fly to the ball
function aim(c, b, d, inp, gain = 1) {
  const lf = dot(d, b.f), lu = dot(d, b.u), lr = dot(d, b.r);
  const wp = dot(c.w, b.r), wy = -dot(c.w, b.u), wr = dot(c.w, b.f);
  inp.pitch = clamp((Math.atan2(lu, lf) * 3.2 - wp * 0.55) * gain);
  inp.yaw = clamp((Math.atan2(lr, lf) * 3.2 - wy * 0.55) * gain);
  inp.roll = clamp(b.r[1] * 2.2 - wr * 0.4);                    // (keep the roof up)
  return Math.acos(clamp(lf / (Math.hypot(lf, lu, lr) || 1)));
}
function aerialMove(m, c, b, ai, dt) {
  const A = ai.aerial, T = A.at - m.t;
  if (T < -0.3 || m.t - A.t0 > 3 || (c.ground && m.t - A.t0 > 0.3)) { ai.aerial = null; return null; }
  const inp = { ...NO_INPUT };
  if (m.t - A.t0 < 0.22) inp.jump = true;                         // the first jump, held
  // where to point: at the ball's spot, allowing for gravity pulling us down on the way
  const tt = Math.max(0.05, T), need = [(A.p[0] - c.p[0] - c.v[0] * tt) / (tt * tt), (A.p[1] - c.p[1] - c.v[1] * tt) / (tt * tt) + C.g / 2, (A.p[2] - c.p[2] - c.v[2] * tt) / (tt * tt)];
  const nl = Math.hypot(...need) || 1, d = need.map(x => x / nl);
  const off = aim(c, b, d, inp);
  inp.boost = c.boost > 0 && off < 0.5 && nl > 120;
  if (!c.ground && m.t - A.t0 > 0.25 && m.t - A.t0 < 0.32 && A.p[1] - c.p[1] > 600) inp.jump = true;   // (a second jump for the high ones)
  return inp;
}
/** falling: wheels down, nose the way we're going */
function recover(c, b) {
  const inp = { ...NO_INPUT, throttle: 1 };
  const hv = Math.hypot(c.v[0], c.v[2]), d = hv > 200 ? [c.v[0] / hv, -0.15, c.v[2] / hv] : [b.f[0], 0, b.f[2]];
  aim(c, b, d, inp, 0.8);
  if (c.hull && b.u[1] < 0.3) inp.jump = !c.jumpHeld;             // (on its roof: the auto-flip)
  return inp;
}
