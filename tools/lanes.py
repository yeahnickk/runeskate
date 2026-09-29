"""Skate lanes through the forests + water/rock split.  Runs AFTER build.py, rewrites assets/world.json.

    python runeskate/tools/lanes.py            (add --map to print an ASCII check of every lane)

1. Lanes. Forests (Draynor Manor woods above all) are a maze at skating speed. Each lane is a few waypoints;
   a path search between them prefers open ground (so it follows the existing paths) but may pass through a
   tree at a cost; walls, fences, rails, doors and water stop it. The chosen line is widened to ~3 tiles and
   every tree on it loses its COLLISION (the tree itself still stands). The lane tiles are written to
   world.json 'lanes' so the client can paint them as worn dirt.
2. Rocks. The server flags river beds and rocky outcrops (Varrock east mine) the same way (floor-blocked), so
   both used to read as water ("you swam with the fishes"). A floor-blocked tile with no blue water within
   3 tiles becomes code 3 = rock.
"""
import json, os, sys, heapq, math
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WJ = os.path.join(ROOT, 'assets', 'world.json')
OUT = os.path.join(ROOT, 'tools', 'out')

# waypoints in world coords; each lane is searched leg by leg
LANES = {
    'draynor-manor': [(3104, 3290), (3109, 3352)],                     # Draynor road -> manor front door
    'manor-woods-west-east': [(3077, 3318), (3108, 3334), (3146, 3336)],
    'manor-woods-north': [(3109, 3352), (3086, 3372), (3078, 3386)],
    'lumbridge-draynor-woods': [(3106, 3250), (3130, 3226), (3162, 3214)],
    'draynor-woods-north-south': [(3138, 3256), (3136, 3206)],
    'varrock-sw-woods': [(3214, 3338), (3228, 3361), (3262, 3346)],     # past the dark wizards' circle
    'east-woods': [(3278, 3300), (3312, 3334)],
}
TREE_COST = 6.0
TURN_COST = 0.6
CLEAR_R = 1.5          # tiles either side of the line whose trees lose their collision
PAINT_R = 1.6

w = json.load(open(WJ))
PRE = os.path.join(OUT, 'world.prelanes.json')            # build.py's output, kept so this can be re-run
if 'lanes' in w: w = json.load(open(PRE))
else: json.dump(w, open(PRE, 'w'))
N, BX, BZ = w['size'], w['baseX'], w['baseZ']
blk = np.array(w['blocked'], np.uint8).reshape(N, N).T.copy()          # [x][z]

# ------------------------------------------------------------------ water vs rock
pos = np.fromfile(os.path.join(OUT, 'world_terrain.pos.bin'), np.float32).reshape(-1, 3, 3)
col = np.fromfile(os.path.join(OUT, 'world_terrain.col.bin'), np.uint8).reshape(-1, 3, 3).astype(np.float64)
tx = np.floor(pos[:, :, 0].mean(1) / 128).astype(int); tz = np.floor(pos[:, :, 2].mean(1) / 128).astype(int)
ok = (tx >= 0) & (tz >= 0) & (tx < N) & (tz < N)
acc = np.zeros((N, N, 3)); cnt = np.zeros((N, N))
np.add.at(acc, (tx[ok], tz[ok]), col[ok].mean(1)); np.add.at(cnt, (tx[ok], tz[ok]), 1)
mean = acc / np.maximum(cnt, 1)[..., None]
blue = ((mean[..., 2] - (mean[..., 0] + mean[..., 1]) / 2 >= 20)       # rivers, lakes
        | (mean[..., 1] - mean[..., 0] > 40)) & (blk >= 2)        # ...and the green bog of Lumbridge swamp
near = np.zeros_like(blue)
for dx in range(-3, 4):
    for dz in range(-3, 4):
        near |= np.roll(np.roll(blue, dx, 0), dz, 1)
rock = (blk == 2) & ~near
blk[rock] = 3
print('rock tiles', int(rock.sum()), 'water tiles', int((blk == 2).sum()))

# ------------------------------------------------------------------ edges that stop a lane
STOP = {'wall', 'door', 'fence', 'rail', 'edge'}
stop = set()
for ax, az, bx, bz, kind, top in w['segs']:
    if kind in STOP: stop.add((min(ax, bx), min(az, bz), 'v' if ax == bx else 'h'))
def edge_ok(x, z, nx, nz):
    """orthogonal step (x,z)->(nx,nz) crosses no stopping edge"""
    if nx != x: return (max(x, nx), z, 'v') not in stop
    return (x, max(z, nz), 'h') not in stop
def tile_ok(x, z): return 0 <= x < N and 0 <= z < N and blk[x, z] <= 1
DIRS = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]
def step_ok(x, z, dx, dz):
    nx, nz = x + dx, z + dz
    if not tile_ok(nx, nz): return False
    if dx and dz:                         # diagonal: both corner routes must be open
        return (tile_ok(x + dx, z) and tile_ok(x, z + dz) and edge_ok(x, z, x + dx, z) and edge_ok(x + dx, z, nx, nz)
                and edge_ok(x, z, x, z + dz) and edge_ok(x, z + dz, nx, nz))
    return edge_ok(x, z, nx, nz)

def search(a, b):
    (sx, sz), (gx, gz) = a, b
    h = lambda x, z: math.hypot(gx - x, gz - z)
    start = (sx, sz, -1)
    dist = {start: 0.0}; prev = {}
    q = [(h(sx, sz), 0.0, start)]
    while q:
        f, g, s = heapq.heappop(q)
        if g > dist.get(s, 1e18): continue
        x, z, d = s
        if (x, z) == (gx, gz):
            out = [(x, z)]
            while s in prev: s = prev[s]; out.append(s[:2])
            return out[::-1]
        for i, (dx, dz) in enumerate(DIRS):
            if not step_ok(x, z, dx, dz): continue
            nx, nz = x + dx, z + dz
            c = math.hypot(dx, dz) * (TREE_COST if blk[nx, nz] == 1 else 1.0)
            if d >= 0 and d != i: c += TURN_COST * min((i - d) % 8, (d - i) % 8)
            ns = (nx, nz, i); ng = g + c
            if ng < dist.get(ns, 1e18):
                dist[ns] = ng; prev[ns] = s; heapq.heappush(q, (ng + h(nx, nz), ng, ns))
    return None

paths = {}
for name, wps in LANES.items():
    pts = [(x - BX, z - BZ) for x, z in wps]
    full = []
    for a, b in zip(pts, pts[1:]):
        p = search(a, b)
        if not p: print('  NO ROUTE', name, (a[0] + BX, a[1] + BZ), '->', (b[0] + BX, b[1] + BZ)); full = None; break
        full += p if not full else p[1:]
    if full: paths[name] = full

# ------------------------------------------------------------------ widen, clear, paint
orig = np.array(w['blocked'], np.uint8).reshape(N, N).T
cleared = set(); paint = {}
for name, p in paths.items():
    ntree = 0
    for (x, z) in p:
        for dx in range(-2, 3):
            for dz in range(-2, 3):
                X, Z = x + dx, z + dz
                if not (0 <= X < N and 0 <= Z < N): continue
                d = math.hypot(dx, dz)
                if d <= CLEAR_R and blk[X, Z] == 1 and (X, Z) not in cleared: cleared.add((X, Z)); ntree += 1
                if d <= PAINT_R and blk[X, Z] <= 1:
                    s = 1.0 if d < 0.5 else 0.75 if d <= 1.0 else 0.45
                    paint[(X, Z)] = max(paint.get((X, Z), 0), s)
    print(f'  {name}: {len(p)} tiles, {ntree} trees cleared')
for (x, z) in cleared: blk[x, z] = 0

# block segments: drop the outline of cleared trees, outline the trees left standing against the new lane
top_of = {}
def owner(ax, az, bx, bz):
    """the blocked tile a block/water outline edge belongs to (the other side is open)"""
    if ax == bx: cands = [(ax - 1, min(az, bz)), (ax, min(az, bz))]
    else: cands = [(min(ax, bx), az - 1), (min(ax, bx), az)]
    for c in cands:
        if 0 <= c[0] < N and 0 <= c[1] < N and orig[c] >= 1: return c
    return None
segs = []
for s in w['segs']:
    ax, az, bx, bz, kind, top = s
    if kind == 'block':
        o = owner(ax, az, bx, bz)
        if o is not None:
            top_of.setdefault(o, top)
            if o in cleared: continue
    segs.append(s)
have = {(min(s[0], s[2]), min(s[1], s[3]), 'v' if s[0] == s[2] else 'h') for s in segs if s[4] in ('block', 'water')}
added = 0
for (x, z) in cleared:
    for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        X, Z = x + dx, z + dz
        if not (0 <= X < N and 0 <= Z < N) or blk[X, Z] == 0: continue
        if dx: ex, ez, key = max(x, X), z, (max(x, X), z, 'v'); a, b = (ex, ez), (ex, ez + 1)
        else: ex, ez, key = x, max(z, Z), (x, max(z, Z), 'h'); a, b = (ex, ez), (ex + 1, ez)
        if key in have: continue
        have.add(key); added += 1
        segs.append([a[0], a[1], b[0], b[1], 'water' if blk[X, Z] >= 2 else 'block', top_of.get((X, Z)) if blk[X, Z] == 1 else None])
print('cleared', len(cleared), 'tree tiles; outline edges added', added, '; painted', len(paint), 'tiles')

w['segs'] = segs
w['blocked'] = blk.T.reshape(-1).tolist()                    # [z][x]: 1 block, 2 water, 3 rock
w['lanes'] = [[x, z, round(s, 2)] for (x, z), s in sorted(paint.items())]
json.dump(w, open(WJ, 'w'))
print('wrote', WJ)

if '--map' in sys.argv:
    on = {t for p in paths.values() for t in p}
    for name, p in paths.items():
        xs = [t[0] for t in p]; zs = [t[1] for t in p]
        x0, x1, z0, z1 = min(xs) - 4, max(xs) + 4, min(zs) - 4, max(zs) + 4
        print(f'\n== {name}  x {x0 + BX}-{x1 + BX}  z {z0 + BZ}-{z1 + BZ}')
        for z in range(min(z1, N - 1), max(z0, 0) - 1, -1):
            row = ''
            for x in range(max(x0, 0), min(x1, N - 1) + 1):
                row += '@' if (x, z) in on else 'x' if (x, z) in cleared else '.' if blk[x, z] == 0 else 'T' if blk[x, z] == 1 else '~' if blk[x, z] == 2 else 'r'
            print(z + BZ, row)
