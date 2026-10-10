"""RuneSkate asset build.

Inputs (all inside this repo, nothing live is touched):
  tools/out/*                          the exported world (tools/export-world.ts, from tools/cache)
  tools/data/collision-data.json.gz    the server's own per-tile collision flags (walls, gates, doors, trees, water)
  tools/out/small-locs.json            tiny + tree objects (tools/small-locs.ts)

Outputs -> assets/
  world.bin / world.json               render meshes (three.js coords: x=east, y=up, z=-north, 1 unit = 1 tile)
                                       + wall segments (with measured heights -> rails), blocked tiles, trunks, ground

The player/goblin models, hitmarks and bitmap fonts in assets/ came from an earlier exporter and are kept as
they are (tools/export-kit.ts and tools/export-npcs.ts make the outfit kit and the NPCs).

Full rebuild, from the repo root (see README):
    bun --preload ./tools/preload.ts tools/export-world.ts 2048 2816 1600
    bun --preload ./tools/preload.ts tools/small-locs.ts
    python tools/build.py && python tools/lanes.py && python tools/fixrunes.py && python tools/split.py
"""
import json, os, shutil, math
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # the repo root
EXP = os.path.join(ROOT, 'tools', 'out', 'models')                   # optional: re-exported player/goblin models
WEXP = os.path.join(ROOT, 'tools', 'out')                            # the big world (tools/export-world.ts)
OUT = os.path.join(ROOT, 'assets')
os.makedirs(OUT, exist_ok=True)

meta = json.load(open(os.path.join(WEXP, 'meta.json')))
BX, BZ = meta['baseX'], meta['baseZ']
N = meta['size']
FENCE_TILES = {(x, z) for x, z, _ in meta['fences']}
HEIGHTS = np.array(meta['heights'], np.float64)          # [level][x][z] RS units, negative = up

# ------------------------------------------------------------------ render meshes
def soup(name):
    pos = np.fromfile(os.path.join(WEXP, f'{name}.pos.bin'), np.float32).reshape(-1, 3)
    col = np.fromfile(os.path.join(WEXP, f'{name}.col.bin'), np.uint8).reshape(-1, 3)
    alpha = np.fromfile(os.path.join(WEXP, f'{name}.alpha.bin'), np.uint8)
    # RS (x east, y down, z north) -> three (x, up, -north), in tiles
    p = np.stack([pos[:, 0] / 128, -pos[:, 1] / 128, -pos[:, 2] / 128], 1).astype(np.float32)
    return pos, p, col, alpha

traw, tp, tc, ta = soup('world_terrain')
lraw, lp, lc, la = soup('world_locs')

# ---- gentler hills: pull every height 45% toward a wide blur of the map (bumps shrink, the overall lie of
# the land and every river/bridge stays). The SAME per-corner delta moves terrain, locs and collision
# heights, so buildings and trees ride the new ground instead of floating or sinking.
SMOOTH = float(os.environ.get('SMOOTH', '0.45'))
if SMOOTH > 0:
    H0 = -HEIGHTS[0] / 128.0                               # tiles, +up, [x][z] corners
    def blur(a, sig=5.0):
        r = int(sig * 3); k = np.exp(-0.5 * (np.arange(-r, r + 1) / sig) ** 2); k /= k.sum()
        pad = np.pad(a, r, mode='edge')
        b = np.apply_along_axis(lambda v: np.convolve(v, k, 'valid'), 0, pad)
        return np.apply_along_axis(lambda v: np.convolve(v, k, 'valid'), 1, b)
    D = SMOOTH * (blur(H0) - H0)                           # tiles to add (up)
    def dAt(x, n):
        x = np.clip(x, 0, N - 1e-4); n = np.clip(n, 0, N - 1e-4)
        ix, iz = np.floor(x).astype(int), np.floor(n).astype(int); u, v = x - ix, n - iz
        return (D[ix, iz] * (1 - u) + D[ix + 1, iz] * u) * (1 - v) + (D[ix, iz + 1] * (1 - u) + D[ix + 1, iz + 1] * u) * v
    for raw, p3 in ((traw, tp), (lraw, lp)):
        d = dAt(raw[:, 0] / 128.0, raw[:, 2] / 128.0)
        raw[:, 1] -= (d * 128).astype(np.float32); p3[:, 1] += d.astype(np.float32)
    for l in range(len(HEIGHTS)): HEIGHTS[l] -= D * 128
    print('smoothed terrain by', SMOOTH, 'max shift', round(float(np.abs(D).max()), 2), 'tiles')

# render meshes, chunked CH x CH tiles so the game can skip far chunks. Positions stay in RS units
# (int16, relative to the chunk's corner): the client scales by (1/128, -1/128, -1/128) per mesh.
CH = 32
import gzip
blob = bytearray(); chunks = []
NC = (N + CH - 1) // CH
def groups(raw, col, sel=None):
    """triangles grouped by chunk (sorted once: the members map is tens of millions of triangles)"""
    t = raw.reshape(-1, 3, 3); c = col.reshape(-1, 3, 3)
    cxs = np.floor(t[:, :, 0].mean(1) / 128 / CH).astype(np.int64); czs = np.floor(t[:, :, 2].mean(1) / 128 / CH).astype(np.int64)
    ok = (cxs >= 0) & (czs >= 0) & (cxs < NC) & (czs < NC)
    if sel is not None: ok &= sel
    idx = np.flatnonzero(ok); cid = (czs * NC + cxs)[idx]
    o = np.argsort(cid, kind='stable'); idx, cid = idx[o], cid[o]
    starts = np.flatnonzero(np.r_[True, cid[1:] != cid[:-1]]); ends = np.r_[starts[1:], len(cid)]
    return t, c, {int(cid[a]): idx[a:b] for a, b in zip(starts, ends)}
G = (('terrain', groups(traw, tc)), ('locs', groups(lraw, lc, la == 0)), ('locs_alpha', groups(lraw, lc, la != 0)))
for cz in range(NC):
    for cx in range(NC):
        ent = {'cx': cx, 'cz': cz}
        for key, (t, c, by) in G:
            m = by.get(cz * NC + cx)
            if m is None: continue
            p = t[m].reshape(-1, 3).copy(); p[:, 0] -= cx * CH * 128; p[:, 2] -= cz * CH * 128
            p = np.clip(np.round(p), -32768, 32767).astype(np.int16)
            ent[key] = {'posOff': len(blob), 'n': int(len(p))}
            blob += p.tobytes()
            while len(blob) % 4: blob.append(0)
            ent[key]['colOff'] = len(blob)
            blob += c[m].reshape(-1, 3).astype(np.uint8).tobytes()
            while len(blob) % 4: blob.append(0)
        chunks.append(ent)
del G
open(os.path.join(OUT, 'world.bin'), 'wb').write(blob)
if os.path.exists(os.path.join(OUT, 'world.bin.gz')): os.remove(os.path.join(OUT, 'world.bin.gz'))   # split.py cuts world.bin up anyway
index = {'chunk': CH, 'chunks': chunks}
print('world.bin', len(blob) // 1024, 'KB', 'chunks', len(chunks), 'tris', len(traw) // 3, len(lraw) // 3)

# ------------------------------------------------------------------ models (only if re-exported; assets/ already has them)
for name in (('nickai3', 'goblin') if os.path.exists(os.path.join(EXP, 'goblin.json')) else ()):
    m = json.load(open(os.path.join(EXP, f'{name}.json')))
    fr = np.fromfile(os.path.join(EXP, f'{name}.frames.bin'), np.float32).reshape(m['nframes'], m['verts'], 3)
    fr = np.stack([fr[..., 0] / 128, -fr[..., 1] / 128, -fr[..., 2] / 128], -1).astype(np.float32)
    fr.tofile(os.path.join(OUT, f'{name}.frames.bin'))
    shutil.copy(os.path.join(EXP, f'{name}.faces.bin'), os.path.join(OUT, f'{name}.faces.bin'))
    shutil.copy(os.path.join(EXP, f'{name}.fcol.bin'), os.path.join(OUT, f'{name}.fcol.bin'))
    json.dump(m, open(os.path.join(OUT, f'{name}.json'), 'w'))
for i in range(4 if os.path.exists(os.path.join(EXP, 'hitmark_0.json')) else 0):
    shutil.copy(os.path.join(EXP, f'hitmark_{i}.json'), os.path.join(OUT, f'hitmark_{i}.json'))
for f in ('b12_full.png', 'p12_full.png', 'q8_full.png'):
    src = os.path.join(ROOT, 'server', 'content', 'fonts', f)
    if os.path.exists(src): shutil.copy(src, os.path.join(OUT, f))

# ------------------------------------------------------------------ collision (the server's own flags)
col = json.load(gzip.open(os.path.join(ROOT, 'tools', 'data', 'collision-data.json.gz'), 'rt'))
flags = {}                    # (level, lx, lz) -> flags
for lv, x, z, f in col['tiles']:
    lx, lz = x - BX, z - BZ
    if 0 <= lx < N and 0 <= lz < N and lv <= 1:
        flags[(lv, lx, lz)] = f & 0xffffffff
doors = [(x - BX, z - BZ) for lv, x, z, *_ in col['doors'] if lv <= 1 and 0 <= x - BX < N and 0 <= z - BZ < N]
door_walls = [(x - BX, z - BZ, sh, ang) for lv, x, z, sh, ang, *_ in col['doors'] if lv == 0 and 0 <= x - BX < N and 0 <= z - BZ < N]
del col

W_N, W_E, W_S, W_W = 0x2, 0x8, 0x20, 0x80
LOC, FLOOR = 0x100, 0x200000

def f0(x, z): return flags.get((0, x, z), 0)
def f1(x, z): return flags.get((1, x, z), 0)

# bridge tiles: the terrain holds a raised deck (level-1 heightmap) over a blue river bed.
# (the server already keeps bridge collision on level 0, so flags always come from level 0)
ttri = tp.reshape(-1, 3, 3); tcol = tc.reshape(-1, 3, 3).astype(np.int32)
t_e, t_u, t_n = ttri[..., 0], ttri[..., 1], -ttri[..., 2]
# per tile: the lowest terrain surface (and is it blue: a river bed?) and the highest. Vectorised: the map has
# millions of terrain triangles.
_cx = np.floor(t_e.mean(1)).astype(np.int64); _cz = np.floor(t_n.mean(1)).astype(np.int64)
_u = t_u.mean(1); _c = tcol.mean(1); _blue = (_c[:, 2] > _c[:, 0] + 25) & (_c[:, 2] > _c[:, 1])
_ok = (_cx >= 0) & (_cz >= 0) & (_cx < N) & (_cz < N)
_key = (_cx * N + _cz)[_ok]; _u = _u[_ok]; _blue = _blue[_ok]
_o = np.lexsort((_blue, _u, _key)); _key, _u, _blue = _key[_o], _u[_o], _blue[_o]
_start = np.flatnonzero(np.r_[True, _key[1:] != _key[:-1]])
lo_u = np.full(N * N, np.nan); lo_blue = np.zeros(N * N, bool); hi_u = np.full(N * N, np.nan)
lo_u[_key[_start]] = _u[_start]; lo_blue[_key[_start]] = _blue[_start]; hi_u[_key[_start]] = np.maximum.reduceat(_u, _start)
lo_u, lo_blue, hi_u = lo_u.reshape(N, N), lo_blue.reshape(N, N), hi_u.reshape(N, N)
del _cx, _cz, _u, _c, _blue, _ok, _key, _o, _start
bridge = np.zeros((N, N), bool)
for x, z in np.argwhere(lo_blue & (hi_u - lo_u > 0.8)):
    deck = -(HEIGHTS[1][x][z] + HEIGHTS[1][x + 1][z + 1]) / 256
    if abs(hi_u[x, z] - deck) < 0.35 and not (f0(x, z) & FLOOR):
        bridge[x, z] = True
def wet(cx, cz):
    return any(0 <= tx_ < N and 0 <= tz_ < N and (f0(tx_, tz_) & FLOOR) for tx_ in (cx - 1, cx) for tz_ in (cz - 1, cz))
def explicit(cx, cz):
    d = (HEIGHTS[0][cx][cz] - HEIGHTS[1][cx][cz]) / 128     # how far level 1 sits above level 0
    return d > 0.3 and abs(d - 1.875) > 0.01
CORN = ((0, 0), (1, 0), (1, 1), (0, 1))
for x in range(N):
    for z in range(N):
        if f0(x, z) & FLOOR: continue
        cs = [(x + a, z + b) for a, b in CORN]
        if any(explicit(*c) for c in cs) and any(wet(*c) for c in cs):
            bridge[x, z] = True
print('bridge tiles', int(bridge.sum()))
def tflags(x, z):
    if not (0 <= x < N and 0 <= z < N): return LOC
    return f0(x, z)
def tlevel(x, z):
    return 1 if (0 <= x < N and 0 <= z < N and bridge[x, z]) else 0

# ground heights at tile corners, per tile level (tiles, +up)
ground = np.zeros((N, N, 4), np.float32)                 # corners sw, se, ne, nw
for x in range(N):
    for z in range(N):
        H = HEIGHTS[tlevel(x, z)]
        c = [-H[x + a][z + b] / 128 for a, b in CORN]
        if not bridge[x, z] and not (f0(x, z) & FLOOR):
            # a walkable tile never dips into the river: lift wet corners to the dry ones
            dry = [c[i] for i, (a, b) in enumerate(CORN) if not wet(x + a, z + b)]
            if dry:
                for i, (a, b) in enumerate(CORN):
                    if wet(x + a, z + b) and c[i] < max(dry) - 0.5: c[i] = max(dry)
            # a corner pinned at the river bed under a walkable tile is a bridge approach
            hi = [v for v in c if v > max(c) - 1.2]
            c = [v if v > max(c) - 1.2 else min(hi) for v in c]
        ground[x, z] = c

# ---- measure loc heights around each wall edge -> rails vs walls
tri = lp.reshape(-1, 3, 3)                                # three coords: x, y(up), z=-north
tx, ty, tn = tri[..., 0], tri[..., 1], -tri[..., 2]      # east, up, north
bminx, bmaxx = tx.min(1), tx.max(1); bminn, bmaxn = tn.min(1), tn.max(1)
ymin, ymax = ty.min(1), ty.max(1)
# spatial index: tile -> the loc triangles within 0.3 tiles of it. Only triangles that start near the ground
# matter (walls, fences, trunks, low obstacles), so roofs, canopies and upper floors are left out.
class Cells:
    def __init__(self):
        x0 = np.floor(bminx - 0.3).astype(np.int64); x1 = np.floor(bmaxx + 0.3).astype(np.int64)
        z0 = np.floor(bminn - 0.3).astype(np.int64); z1 = np.floor(bmaxn + 0.3).astype(np.int64)
        gx = np.clip(np.floor(tx.mean(1)).astype(np.int64), 0, N); gz = np.clip(np.floor(tn.mean(1)).astype(np.int64), 0, N)
        g0 = -np.minimum(HEIGHTS[0][gx, gz], HEIGHTS[1][gx, gz]) / 128     # the higher of ground / bridge deck
        keep = np.flatnonzero((ymin < g0 + 2.5) & (x1 - x0 < 12) & (z1 - z0 < 12) & (x1 >= -1) & (z1 >= -1) & (x0 <= N) & (z0 <= N))
        nx = (x1 - x0 + 1)[keep]; nz = (z1 - z0 + 1)[keep]; cnt = nx * nz
        tri_i = np.repeat(keep, cnt)
        k = np.arange(cnt.sum()) - np.repeat(np.cumsum(cnt) - cnt, cnt)
        nzr = np.repeat(nz, cnt)
        cx = np.repeat(x0[keep], cnt) + k // nzr; cz = np.repeat(z0[keep], cnt) + k % nzr
        ok = (cx >= 0) & (cz >= 0) & (cx < N) & (cz < N)
        key = (cx * N + cz)[ok]; tri_i = tri_i[ok]
        o = np.argsort(key, kind='stable'); self.key = key[o]; self.tri = tri_i[o]
        print('loc triangles indexed', len(keep), 'of', len(tri), 'cell entries', len(self.key))
    def get(self, c, default=()):
        x, z = c
        if not (0 <= x < N and 0 <= z < N): return default
        k = x * N + z
        a = np.searchsorted(self.key, k, 'left'); b = np.searchsorted(self.key, k, 'right')
        return self.tri[a:b].tolist() if b > a else default
cells = Cells()

def seg_dist2d(px, pz, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az; L = dx * dx + dz * dz
    t = 0 if L < 1e-9 else max(0, min(1, ((px - ax) * dx + (pz - az) * dz) / L))
    return math.hypot(px - (ax + t * dx), pz - (az + t * dz))

def top_near(px, pz, gnd, r=0.2):
    """highest loc triangle rising from near ground level within r tiles of (px, pz)"""
    best = None
    for i in cells.get((int(math.floor(px)), int(math.floor(pz))), ()):
        if ymin[i] > gnd + 0.45 or ymax[i] < gnd + 0.05: continue
        d = min(seg_dist2d(px, pz, tx[i, a], tn[i, a], tx[i, b], tn[i, b]) for a, b in ((0, 1), (1, 2), (2, 0)))
        if d <= r and (best is None or ymax[i] > best): best = float(ymax[i])
    return best

def gh(px, pz):
    x, z = int(math.floor(px)), int(math.floor(pz))
    x, z = max(0, min(N - 1, x)), max(0, min(N - 1, z))
    u, v = px - x, pz - z
    sw, se, ne, nw = ground[x, z]
    return (sw * (1 - u) + se * u) * (1 - v) + (nw * (1 - u) + ne * u) * v

# unique wall edges: key = ((x0,z0),(x1,z1)) with the edge's line coords
edges = {}
def add_edge(a, b, kind):
    k = (min(a, b), max(a, b))
    if k not in edges or kind == 'wall': edges[k] = kind

for x in range(-1, N + 1):
    for z in range(-1, N + 1):
        f = tflags(x, z)
        if f & W_N: add_edge((x, z + 1), (x + 1, z + 1), 'wall')
        if f & W_S: add_edge((x, z), (x + 1, z), 'wall')
        if f & W_E: add_edge((x + 1, z), (x + 1, z + 1), 'wall')
        if f & W_W: add_edge((x, z), (x, z + 1), 'wall')
# blocked tiles (trees, statues, fountain, water): their outline against open neighbours
blocked = np.zeros((N, N), bool); water = np.zeros((N, N), bool)
for x in range(N):
    for z in range(N):
        f = tflags(x, z)
        if f & (LOC | FLOOR):
            blocked[x, z] = True
            if f & FLOOR: water[x, z] = True
# no map at all here (open sea / the void between members' areas): not ground you can ride on
void = np.isnan(lo_u)
blocked |= void
print('void tiles', int(void.sum()))
def isblk(x, z): return not (0 <= x < N and 0 <= z < N) or blocked[x, z]
block_tile = {}

# how tall is whatever blocks a tile? Hedges, small cacti, rocks and crates are low enough to ollie (and a
# row of them to grind); trees, statues and buildings are not. Only geometry rising from the tile's own
# ground counts (a tree canopy overhanging a neighbour tile is not an obstacle on that tile).
LOW_OBSTACLE = 1.1                                       # tiles; a full ollie peaks at ~1.5
_tile_top = {}
def tile_top(x, z):
    if (x, z) in _tile_top: return _tile_top[(x, z)]
    gs = ground[x, z]; gmax = float(max(gs))
    best = None
    for i in cells.get((x, z), ()):
        cx = (tx[i, 0] + tx[i, 1] + tx[i, 2]) / 3; cn = (tn[i, 0] + tn[i, 1] + tn[i, 2]) / 3
        if not (x <= cx <= x + 1 and z <= cn <= z + 1): continue
        if ymin[i] > gmax + 0.6: continue
        if best is None or ymax[i] > best: best = float(ymax[i])
    _tile_top[(x, z)] = best
    return best
# tiny things (tree stumps, roots, flowers, fungus, mushrooms, potted plants: tools/small-locs.ts picks them by
# name) and anything that barely rises off the ground are skated straight over, not ollied: the server still
# flags them as blocking, but on a board they are nothing
SMALL = os.path.join(WEXP, 'small-locs.json')
TINY_TILES = {tuple(t) for t in json.load(open(SMALL))['tiles']} if os.path.exists(SMALL) else set()
TREE_TILES = {tuple(t) for t in json.load(open(SMALL)).get('trees', [])} if os.path.exists(SMALL) else set()
FLAT_OBSTACLE = 0.3                                      # tiles: below this it is a bump, not an obstacle
nflat = 0
for x in range(N):
    for z in range(N):
        if not blocked[x, z] or water[x, z]: continue
        t = tile_top(x, z)
        if (x, z) in TINY_TILES or (t is not None and t - float(min(ground[x, z])) < FLAT_OBSTACLE):
            blocked[x, z] = False; nflat += 1
print('tiny/flat obstacles made rideable', nflat)
# doors/gates left open, and trees thinned out of dense clumps (tools/thin-trees.ts)
DOOR_TILES = {tuple(t) for k in ('doorTiles', 'clearTiles') for t in json.load(open(SMALL)).get(k, [])} if os.path.exists(SMALL) else set()
nd = 0
for (x, z) in DOOR_TILES:
    if 0 <= x < N and 0 <= z < N and blocked[x, z] and not water[x, z]: blocked[x, z] = False; nd += 1
print('door/gate/thinned-tree tiles opened', nd)
trunk_tile = np.zeros((N, N), bool)
# trees: a tall blocked tile used to collide as the WHOLE tile (a 2x2 tree = a 2x2 box), so you hit it a metre
# from the trunk. Measure the trunk instead: the loc geometry in the bottom ~0.7 tiles (the canopy is far above)
# clustered into trunks, each a circle. The tiles go to code 4 (a tree stands here: not a spawn/landing spot,
# but no outline) and the circles do the colliding. Boxy things (statues, crates, fountains) stay blocks.
TRUNK_LOW = 0.7; TRUNK_SLICE = 0.45; TRUNK_MAX_R = 0.62
def comp_tiles():
    seen = set()
    for x in range(N):
        for z in range(N):
            if (x, z) in seen or not blocked[x, z] or water[x, z]: continue
            t = tile_top(x, z)
            if t is None or t - float(min(ground[x, z])) < LOW_OBSTACLE: continue
            st = [(x, z)]; seen.add((x, z)); comp = []
            while st:
                a, b = st.pop(); comp.append((a, b))
                for c in ((a + 1, b), (a - 1, b), (a, b + 1), (a, b - 1)):
                    if c in seen or not (0 <= c[0] < N and 0 <= c[1] < N) or not blocked[c] or water[c]: continue
                    tt = tile_top(*c)
                    if tt is None or tt - float(min(ground[c])) < LOW_OBSTACLE: continue
                    seen.add(c); st.append(c)
            yield comp
trunks = []; tree_tiles = 0; kept_box = 0
for comp in comp_tiles():
    # only real trees (by loc name, tools/small-locs.ts): a diagonal fence or a statue would slice into
    # thin posts too, and you'd ride between them
    if sum(c in TREE_TILES for c in comp) < 0.75 * len(comp): kept_box += 1; continue
    cs = set(comp); pts = set()
    for (a, b) in comp:
        for i in cells.get((a, b), ()):
            if ymin[i] > float(max(ground[a, b])) + TRUNK_LOW: continue
            # slice the triangle at knee height: that ring of points IS the trunk (roots flare out lower down)
            cx0 = float(tx[i].mean()); cz0 = float(tn[i].mean()); h = gh(cx0, cz0) + TRUNK_SLICE
            if not (ymin[i] < h < ymax[i]): continue
            for k0, k1 in ((0, 1), (1, 2), (2, 0)):
                y0, y1 = float(ty[i, k0]), float(ty[i, k1])
                if (y0 - h) * (y1 - h) > 0 or y0 == y1: continue
                u = (h - y0) / (y1 - y0)
                vx = float(tx[i, k0] + (tx[i, k1] - tx[i, k0]) * u); vz = float(tn[i, k0] + (tn[i, k1] - tn[i, k0]) * u)
                if (int(math.floor(vx)), int(math.floor(vz))) in cs: pts.add((round(vx, 3), round(vz, 3)))
    pts = list(pts)
    if len(pts) < 3: kept_box += 1; continue
    # single-link clusters (0.5 tiles): one per trunk, even when trees stand shoulder to shoulder
    par = list(range(len(pts)))
    def f(i):
        while par[i] != i: par[i] = par[par[i]]; i = par[i]
        return i
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            if abs(pts[i][0] - pts[j][0]) < 0.5 and abs(pts[i][1] - pts[j][1]) < 0.5: par[f(i)] = f(j)
    groups = {}
    for i, p in enumerate(pts): groups.setdefault(f(i), []).append(p)
    circ = []
    for g_ in groups.values():
        if len(g_) < 3: continue
        xs = [p[0] for p in g_]; zs = [p[1] for p in g_]
        cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
        r = max(math.hypot(p[0] - cx, p[1] - cz) for p in g_) * 0.9
        circ.append((cx, cz, r))
    if not circ or max(c[2] for c in circ) > TRUNK_MAX_R: kept_box += 1; continue
    for cx, cz, r in circ: trunks.append([round(cx, 2), round(cz, 2), round(max(0.14, r), 2)])
    for c in comp: tree_tiles += 1
    for c in comp: blocked[c] = False; trunk_tile[c] = True
print('trunks', len(trunks), 'tree tiles', tree_tiles, 'kept as blocks', kept_box)
import collections; print('trunk r histogram', sorted(collections.Counter(round(t[2], 1) for t in trunks).items()))
for x in range(N):
    for z in range(N):
        if not blocked[x, z]: continue
        kind = 'water' if water[x, z] else 'block'
        for open_nb, a, b in ((not isblk(x, z + 1), (x, z + 1), (x + 1, z + 1)), (not isblk(x, z - 1), (x, z), (x + 1, z)),
                              (not isblk(x + 1, z), (x + 1, z), (x + 1, z + 1)), (not isblk(x - 1, z), (x, z), (x, z + 1))):
            if open_nb: add_edge(a, b, kind); block_tile[(min(a, b), max(a, b))] = (x, z)
# world boundary: keep the skater inside the exported square
for i in range(1, N - 1):
    for a, b in (((i, 1), (i + 1, 1)), ((i, N - 1), (i + 1, N - 1)), ((1, i), (1, i + 1)), ((N - 1, i), (N - 1, i + 1))):
        add_edge(a, b, 'edge')

door_set = set(doors)
# every door and gate stands open (tools/doors.ts): the edges they close and the tiles a gate fills are left open.
# The server's own door list (col['doors']: level, x, z, shape, angle) adds any the loc names miss.
OPEN_EDGES = set()
def open_edge(x0, z0, x1, z1): OPEN_EDGES.add(((x0, z0), (x1, z1)) if (x0, z0) <= (x1, z1) else ((x1, z1), (x0, z0)))
_EDGE = lambda x, z, r: [(x, z, x, z + 1), (x, z + 1, x + 1, z + 1), (x + 1, z, x + 1, z + 1), (x, z, x + 1, z)][r & 3]
for x, z, sh, ang in door_walls:
    if sh == 0: open_edge(*_EDGE(x, z, ang))
    elif sh == 2: open_edge(*_EDGE(x, z, ang)); open_edge(*_EDGE(x, z, ang + 1))
for e in (json.load(open(SMALL)).get('doorEdges', []) if os.path.exists(SMALL) else []): open_edge(*e)
nopen = 0
for k in OPEN_EDGES:
    if edges.get(k) == 'wall': del edges[k]; nopen += 1
print('doors and gates opened', nopen, 'edges')
segs = []
nr = 0; nlow = 0; ngate = 0
for (a, b), kind in edges.items():
    (ax, az), (bx, bz) = a, b
    top = None
    if kind == 'wall':
        # sample the wall top at both ends (bridge parapets arch) + middle
        mx, mz = (ax + bx) / 2, (az + bz) / 2
        # the wall sits on the edge; the ground either side may differ, use the higher
        tops = []
        for u in (0.15, 0.5, 0.85):
            px, pz = ax + (bx - ax) * u, az + (bz - az) * u
            g = max(gh(px + 0.01 * (bz - az), pz - 0.01 * (bx - ax)), gh(px - 0.01 * (bz - az), pz + 0.01 * (bx - ax)))
            t = top_near(px, pz, g)
            tops.append((t, g))
        hs = [t - g for t, g in tops if t is not None]
        if os.environ.get('DBG') and az == bz and az in (57, 59) and 66 <= ax <= 81: print('DBG', ax, az, [(None if t is None else round(t, 2), round(g, 2)) for t, g in tops])
        is_door = any((ax + dx, az + dz) in door_set for dx in (-1, 0) for dz in (-1, 0))
        is_fence = not is_door and any((ax + ddx, az + ddz) in FENCE_TILES for ddx in (-1, 0) for ddz in (-1, 0))
        if len(hs) == 3 and all(0.25 < h < 0.95 for h in hs) and not is_door:
            kind = 'rail'; nr += 1
            top = [round(tops[0][0], 3), round(tops[1][0], 3), round(tops[2][0], 3)]
        elif is_fence:
            # railings / wooden fencing too tall to grind: capped at ~1 tile so a solid ollie clears it
            kind = 'fence'
            top = [round(float(min(t if t is not None else g + 1.0, g + 1.0)), 3) for t, g in tops]
        # (every door/gate itself is open - OPEN_EDGES - so what is left by a doorway is its frame: plain wall)
        # the server flags invisible walls along river beds (bank edges, between two water tiles). Nothing
        # stands there, so they must not stop a jump across the river: treat them as a water edge (solid on
        # the ground, open in the air, and you land in the drink if you come up short). Real structures on
        # the water keep their kind: bridge parapets are rails, fences are fences, anything with a measured
        # top taller than a step stays a wall.
        if kind == 'wall':
            wet = [(ax - 1, min(az, bz)), (ax, min(az, bz))] if ax == bx else [(min(ax, bx), az - 1), (min(ax, bx), az)]
            if any(0 <= tx < N and 0 <= tz < N and water[tx, tz] for tx, tz in wet) and (not hs or max(hs) < 0.5):
                kind = 'water'; nriver = globals().get('nriver', 0) + 1; globals()['nriver'] = nriver
        # gates set in a hoppable fence (cow pens etc.) can be ollied like the fence around them
        if is_door and any((ax + ddx, az + ddz) in FENCE_TILES for ddx in (-2, -1, 0, 1) for ddz in (-2, -1, 0, 1)):
            kind = 'fence'; top = [round(float(g + 1.0), 3) for t, g in tops]
    # the Al Kharid toll gate: no toll in RuneSkate, skate straight through
    if kind == 'block' and (a, b) in block_tile:
        t = tile_top(*block_tile[(a, b)])
        g0 = float(min(ground[block_tile[(a, b)]]))
        if t is not None and t - g0 < LOW_OBSTACLE:
            top = [round(t, 3)] * 3; nlow += 1
    if kind in ('door', 'wall', 'fence') and ax == bx and ax + BX == 3268 and 3227 <= az + BZ <= 3229:
        continue
    segs.append([ax, az, bx, bz, kind, top])
# gates set in a hoppable fence line (the cow pen gate was missed by the FENCE_TILES test): a door edge
# with a fence or rail edge continuing its line on either side becomes fence at the neighbours' height
byline = {(s[0], s[1], s[2], s[3]): s for s in segs}
for s in segs:
    if s[4] != 'door': continue
    ax, az, bx, bz = s[:4]; dx, dz = bx - ax, bz - az
    nbs = [byline.get((ax - dx, az - dz, ax, az)), byline.get((bx, bz, bx + dx, bz + dz))]
    tops = [max(n[5]) for n in nbs if n and n[4] in ('fence', 'rail') and n[5]]
    if tops:
        s[4] = 'fence'; s[5] = [round(max(tops), 3)] * 3; ngate += 1
print('low obstacle edges', nlow, 'gates made hoppable', ngate, 'river-bed walls made jumpable', globals().get('nriver', 0))
print('segments', len(segs), 'rails', nr, {k: sum(1 for s in segs if s[4] == k) for k in ('wall', 'rail', 'fence', 'door', 'block', 'water', 'edge')})

json.dump({
    'baseX': BX, 'baseZ': BZ, 'size': N,
    'ground': np.round(ground, 3).reshape(-1).tolist(),     # [x][z][sw,se,ne,nw]
    'bridge': np.argwhere(bridge).tolist(),
    'blocked': (blocked.astype(np.uint8) + water.astype(np.uint8) + 4 * trunk_tile.astype(np.uint8)).T.reshape(-1).tolist(),   # [z][x]: 1 block, 2 water, 4 tree (trunks collide)
    'trunks': trunks,                                     # [x, z, r] tile coords: tree trunks as circles
    'segs': segs,
    'spawn': [3222.5 - BX, 3218.5 - BZ],
    'index': index,
}, open(os.path.join(OUT, 'world.json'), 'w'))
print('wrote', OUT)
