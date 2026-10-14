"""MineScape's world, baked from the 2004 RS map.   python3 runeskate/tools/mine-bake.py

One block a tile (1:1), the ground's own height a block per 128 RS units (also 1:1). Per tile, from the terrain mesh:
the LOWEST ground there (upper floors don't count) and its colour, which picks the surface block (grass, sand, water,
dirt path, stone floor, snow...). From the locs mesh: roofs (flat-ish faces 2-7 tiles over the ground, away from tree
trunks), so buildings come out as roofed footprints with their roof's colour. From the region packs: walls, fences and
railings (segs) and tree trunks. From npc-spawns: where the villagers live.

Writes assets/mine_world.bin (gzip'd by compress.ts like the rest) + assets/mine_world.json:
  bin: W*H bytes each of: ground y (block), surface id, roof height over ground (0 = none), roof colour index,
       flags (1 wall, 2 fence, 4 tree, 8 water, 16 indoors), wall colour index (0 none, else 1 + json.walls),
       then the RS ground colour as three planes R, G, B, then edges (1 wall on the tile's west edge, 2 wall south,
       4 fence west, 8 fence south) and the water level (block y) under a bridge, then what fills under a bridge deck
       (bit k < 7: block water level + 1 + k is solid: the RS bridge's piers and spandrels, its arches left open;
       bit 7: it's wood, a hull or a jetty).
  v2 flags: 4 tree, 8 water, 16 indoors, 32 rock, 64 scenery (an RS object blocks the tile), 128 bridge deck
  json: { W, H, x0, z0 (world coords of tile 0,0), sea, spawn, trees: [[x,z]...], villagers: [[x,z,kind]...], roofs: [rgb...] }
"""
import os, json, glob, re
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tools', 'out')
meta = json.load(open(os.path.join(OUT, 'meta.json')))
N = meta['size']; BX, BZ = meta['baseX'], meta['baseZ']
# only the playable map (as map.png): local x 0..1600, z 0..1216
W, H = 1600, 4032 - BZ
BASE = 40                                            # ground y for RS height 0 (a deep world under it to dig)

# ---------------------------------------------------------------- the ground: lowest terrain per tile + its colour
pos = np.fromfile(os.path.join(OUT, 'world_terrain.pos.bin'), np.float32).reshape(-1, 3, 3)
col = np.fromfile(os.path.join(OUT, 'world_terrain.col.bin'), np.uint8).reshape(-1, 3, 3).astype(np.float32).mean(1)
cx = pos[:, :, 0].mean(1) / 128; cz = pos[:, :, 2].mean(1) / 128; ch = -pos[:, :, 1].mean(1) / 128
ix = np.floor(cx).astype(np.int64); iz = np.floor(cz).astype(np.int64)
ok = (ix >= 0) & (ix < W) & (iz >= 0) & (iz < H)
ix, iz, ch, col = ix[ok], iz[ok], ch[ok], col[ok]
cell = iz * W + ix
low = np.full(W * H, 1e9, np.float32); np.minimum.at(low, cell, ch)
near = ch < low[cell] + 0.35                         # (this tile's ground, not a floor above it)
csum = np.zeros((W * H, 3), np.float64); cnt = np.zeros(W * H, np.float64); hsum = np.zeros(W * H, np.float64)
np.add.at(csum, cell[near], col[near]); np.add.at(cnt, cell[near], 1); np.add.at(hsum, cell[near], ch[near])
has = cnt > 0
rgb = np.zeros((W * H, 3), np.float32); rgb[has] = csum[has] / cnt[has, None]
hgt = np.zeros(W * H, np.float32); hgt[has] = hsum[has] / cnt[has]
print('terrain tiles', has.sum(), 'of', W * H)

# ---------------------------------------------------------------- the surface block, from the colour
# ids match src/mine/blocks.js
B = dict(air=0, grass=1, dirt=2, stone=3, sand=6, water=8, path=20, cobble=4, bricks=21, snow=22, planks=11, gravel=7, mud=23)
r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
lum = (r + g + b) / 3; sat = np.max(rgb, 1) - np.min(rgb, 1)
surf = np.full(W * H, B['grass'], np.uint8)
surf[(r > g + 6) & (g > b) & (lum > 120)] = B['sand']
surf[(r > g + 6) & (g > b) & (lum <= 120)] = B['path']
surf[(sat < 18) & (lum > 60)] = B['bricks']               # (grey: roads and stone floors)
surf[(sat < 18) & (lum <= 60)] = B['stone']
surf[(lum > 200) & (sat < 30)] = B['snow']
surf[(g >= r) & (g > b + 4)] = B['grass']
surf[(r > g + 25) & (r > b + 25) & (lum < 110)] = B['mud']   # (dark red-brown: swamp mud / wooden floors)
water = (b > r + 15) & (b > g - 5)
surf[water] = B['water']
surf[~has] = B['water']                                      # (off the map: the sea)

# ---------------------------------------------------------------- roofs: up-facing loc faces well over the ground
roof_h = np.zeros(W * H, np.float32); roof_c = np.zeros((W * H, 3), np.float32)
wall_s = np.zeros((W * H, 3), np.float64); wall_n = np.zeros(W * H, np.float64)   # (upright faces near the ground: wall colour)
lpos = np.memmap(os.path.join(OUT, 'world_locs.pos.bin'), np.float32, 'r').reshape(-1, 3, 3)
lcol = np.memmap(os.path.join(OUT, 'world_locs.col.bin'), np.uint8, 'r').reshape(-1, 3, 3)
for a in range(0, len(lpos), 3_000_000):
    p = np.asarray(lpos[a:a + 3_000_000]); c = np.asarray(lcol[a:a + 3_000_000]).astype(np.float32).mean(1)
    x = p[:, :, 0].mean(1) / 128; z = p[:, :, 2].mean(1) / 128; y = -p[:, :, 1].mean(1) / 128
    e1 = p[:, 1] - p[:, 0]; e2 = p[:, 2] - p[:, 0]; nv = np.cross(e1, e2); nv /= np.linalg.norm(nv, axis=1, keepdims=True) + 1e-9
    i = np.floor(x).astype(np.int64); k = np.floor(z).astype(np.int64)
    inb = (i >= 0) & (i < W) & (k >= 0) & (k < H)
    mv = inb & (np.abs(nv[:, 1]) < 0.3)
    cc = c[mv]; cl = cc.mean(1)
    cv = k[mv] * W + i[mv]; uv = y[mv] - hgt[cv]; mv2 = (uv > 0.2) & (uv < 2.5) & (cl > 20) & ~(cc[:, 1] > cc[:, 0] + 8)   # (not shadow-black faces, not foliage)
    np.add.at(wall_s, cv[mv2], cc[mv2]); np.add.at(wall_n, cv[mv2], 1)
    m = inb & (np.abs(nv[:, 1]) > 0.3)
    i, k, y, c = i[m], k[m], y[m], c[m]; ce = k * W + i
    up = y - hgt[ce]; m2 = (up > 2.0) & (up < 7.5)
    ce, up, c = ce[m2], up[m2], c[m2]
    o = np.argsort(up, kind='stable'); ce, up, c = ce[o], up[o], c[o]
    hi = up > roof_h[ce]; roof_h[ce[hi]] = up[hi]; roof_c[ce[hi]] = c[hi]
    print('locs', a + len(p), '/', len(lpos))

# ---------------------------------------------------------------- the region packs: walls, fences, trunks
flags = np.zeros(W * H, np.uint8); trees = []
def mark(x, z, f):
    if 0 <= x < W and 0 <= z < H: flags[z * W + x] |= f
for fn in sorted(glob.glob(os.path.join(ROOT, 'assets', 'world*.json'))):
    if re.search(r'\.(near|far)\.', fn): continue
    try: d = json.load(open(fn))
    except Exception: continue
    for s in d.get('segs', []):
        x0, z0, x1, z1, kind = s[0], s[1], s[2], s[3], s[4]
        f = 1 if kind == 'wall' else 2 if kind in ('fence', 'rail') else 0
        if not f: continue
        n = int(max(abs(x1 - x0), abs(z1 - z0))) or 1
        for t in range(n):
            x = int(np.floor(x0 + (x1 - x0) * (t + 0.5) / n)); z = int(np.floor(z0 + (z1 - z0) * (t + 0.5) / n))
            # a wall on a tile edge: the tile on its low side (RS walls hug that edge)
            if x0 == x1 and x == x0: x -= 0
            mark(x, z, f)
    for t in d.get('trunks', []): trees.append((int(t[0]), int(t[1])))
trees = sorted(set(trees))
for x, z in trees: mark(x, z, 4)
print('trees', len(trees), 'wall tiles', int(((flags & 1) > 0).sum()), 'fence tiles', int(((flags & 2) > 0).sum()))

# roofs near a trunk are canopies, not roofs; a roof needs a few roofed tiles together
tmask = np.zeros((H, W), bool)
for x, z in trees: tmask[max(0, z - 3):z + 4, max(0, x - 3):x + 4] = True
rh = roof_h.reshape(H, W); rh[tmask & ((flags.reshape(H, W) & 1) == 0)] = 0
roofed = rh > 0
cntn = sum(np.roll(np.roll(roofed, dz, 0), dx, 1) for dz in (-1, 0, 1) for dx in (-1, 0, 1))
roofed &= cntn >= 5
# a roof stands on walls: drop roofed blobs with hardly a wall round them (big tree canopies, awnings)
wl = (flags.reshape(H, W) & 1) > 0
wl1 = wl.copy()
for dz in (-1, 0, 1):
    for dx in (-1, 0, 1): wl1 |= np.roll(np.roll(wl, dz, 0), dx, 1)
seen = np.zeros((H, W), bool); keep = np.zeros((H, W), bool)
for z0, x0 in zip(*np.nonzero(roofed)):
    if seen[z0, x0]: continue
    st = [(z0, x0)]; seen[z0, x0] = True; comp = []
    while st:
        z, x = st.pop(); comp.append((z, x))
        for z1, x1 in ((z + 1, x), (z - 1, x), (z, x + 1), (z, x - 1)):
            if 0 <= z1 < H and 0 <= x1 < W and roofed[z1, x1] and not seen[z1, x1]: seen[z1, x1] = True; st.append((z1, x1))
    cz, cx = np.array(comp).T
    if wl1[cz, cx].sum() >= max(3, len(comp) * 0.12): keep[cz, cx] = True
roofed &= keep
rh[~roofed] = 0
# the roof's colour, as a small palette (RS roofs: slate grey, red tile, thatch, dark wood)
rc = roof_c.reshape(H, W, 3)
PAL = np.array([[95, 95, 100], [150, 60, 45], [170, 140, 80], [90, 65, 45], [60, 70, 95]], np.float32)
dist = ((rc[..., None, :] - PAL[None, None]) ** 2).sum(-1); rci = np.argmin(dist, -1).astype(np.uint8)
# the walls' own colour (RS: grey castle stone, dark stone, cream plaster, timber, red brick, sandstone), 0 = unknown
# (the loc colours carry RS's baked light, so they're judged by hue and greyness, not matched as they are)
WPAL = np.array([[150, 145, 135], [92, 90, 88], [205, 195, 165], [112, 82, 52], [140, 72, 52], [190, 160, 110]], np.float32)
wc = np.zeros((W * H, 3), np.float32); hw = wall_n > 2; wc[hw] = wall_s[hw] / wall_n[hw, None]
wr, wg, wb = wc[:, 0], wc[:, 1], wc[:, 2]; wl = wc.mean(1); ws = (wc.max(1) - wc.min(1)) / np.maximum(wl, 1)
wci = np.where(ws < 0.16, np.where(wl >= 40, 1, 2), np.where(wr > wg * 1.4, 5, np.where(wl > 58, 3, np.where(wb > wg * 0.9, 1, 4)))).astype(np.uint8)
wci[~hw] = 0
print('wall colours', np.bincount(wci[(flags & 1) > 0], minlength=7).tolist())
flags_hw = flags.reshape(H, W); flags_hw[roofed] |= 16
flags_hw[surf.reshape(H, W) == B['water']] |= 8
sf = surf.reshape(H, W); sf[roofed & (sf != B['water'])] = B['planks']     # (indoors: a wooden floor)
print('roofed tiles', int(roofed.sum()))

# ---------------------------------------------------------------- heights in blocks (1:1), water beds
gy = np.clip(np.round(BASE + hgt.reshape(H, W)), 4, 120).astype(np.int32)
gy[~has.reshape(H, W)] = BASE - 1
# smooth single-tile spikes (bridges and jetties the terrain mesh has under them)
med = np.median(np.stack([np.roll(np.roll(gy, dz, 0), dx, 1) for dz in (-1, 0, 1) for dx in (-1, 0, 1)]), 0)
gy = np.where(np.abs(gy - med) > 2, med, gy).astype(np.int32)
roof_up = np.where(roofed, np.clip(np.round(rh), 3, 7), 0).astype(np.uint8)

# ---------------------------------------------------------------- v2: the skate game's own packs (assets/world*.json)
# The client draws the real RS meshes; the blocks underneath have to match them. So the walkable ground (bridge decks
# included), what blocks a tile (scenery, water, rocks, trees) and the walls + fences on tile edges come straight from
# the packs the skate game collides with. Lowest-terrain gy (above) stays as the water level under bridges.
wl_y = gy.copy()                                      # (lowest terrain: river surface under a bridge)
pg = np.full((H, W), np.nan, np.float32); kind = np.full((H, W), 255, np.uint8); edges = np.zeros((H, W), np.uint8)
for fn in sorted(glob.glob(os.path.join(ROOT, 'assets', 'world*.json'))):
    if re.search(r'\.(near|far)\.', fn): continue
    d = json.load(open(fn)); x0, z0, w, h = d['x0'], d['z0'], d['w'], d['h']
    g4 = np.array(d['ground'], np.float32).reshape(w, h, 4).mean(2).T            # [z, x] tile mean of the 4 corners
    bl = np.array(d['blocked'], np.uint8).reshape(h, w)
    zs, xs = slice(z0, min(H, z0 + h)), slice(x0, min(W, x0 + w)); hh, ww = zs.stop - z0, xs.stop - x0
    if hh <= 0 or ww <= 0: continue
    pg[zs, xs] = g4[:hh, :ww]; kind[zs, xs] = bl[:hh, :ww]
    for ax, az, bx, bz, k, top in d['segs']:
        bit = 1 if k == 'wall' else 4 if k in ('fence', 'rail') else 0
        if not bit: continue
        if ax == bx: tx, tz = ax, min(az, bz)                 # (an edge at x = ax: the west side of tile ax)
        else: tx, tz, bit = min(ax, bx), az, bit * 2          # (an edge at z = az: the south side of tile az)
        if 0 <= tx < W and 0 <= tz < H: edges[tz, tx] |= bit
    print('pack', os.path.basename(fn), w, h)
have = ~np.isnan(pg)
gy = np.where(have, np.clip(np.round(BASE + np.nan_to_num(pg)), 4, 120), gy).astype(np.int32)
hasT = has.reshape(H, W)                              # (the RS terrain exists here; off it is the sea)
kind = np.where(~hasT, 2, kind)
fl2 = (flags_hw & 16).copy()                          # indoors (under a roof) stays
fl2 |= np.where(kind == 2, 8, 0).astype(np.uint8)
fl2 |= np.where(kind == 4, 4, 0).astype(np.uint8)
fl2 |= np.where(kind == 3, 32, 0).astype(np.uint8)
fl2 |= np.where(kind == 1, 64, 0).astype(np.uint8)
oldw = (surf.reshape(H, W) == B['water'])
bridge = have & (kind == 0) & oldw & hasT & (gy > wl_y)  # (walkable over what the terrain says is water: a deck)
fl2 |= np.where(bridge, 128, 0).astype(np.uint8)
fl2 |= np.where(~have & oldw, 8, 0).astype(np.uint8)
sf = sf.copy(); sf[kind == 2] = B['water']; sf[bridge] = B['planks']; sf[(kind != 2) & ~bridge & (sf == B['water'])] = B['dirt']
for x, z in trees:
    if 0 <= x < W and 0 <= z < H: fl2[z, x] |= 4
flags_hw = fl2
wl_y = np.where(bridge, np.minimum(wl_y, gy - 1), gy).astype(np.int32)
print('bridge tiles', int(bridge.sum()), 'edge walls', int(((edges & 3) > 0).sum()), 'fences', int(((edges & 12) > 0).sum()))

# what fills under a bridge deck: the RS bridge seen side on (across its span), cell by cell between the water and the
# deck. A cell its model covers (a pier, the spandrel over an arch) is solid; one you see through (an arch) stays open.
# bit k of bs (k < 7) = block wl + 1 + k is solid; bit 7: it's wood (a ship's hull, a jetty), not stone
bs = np.zeros((H, W), np.uint8)
near_b = bridge.copy()
for dz in (-1, 0, 1):
    for dx in (-1, 0, 1): near_b |= np.roll(np.roll(bridge, dz, 0), dx, 1)
bt, btc = [], []
for a in range(0, len(lpos), 3_000_000):
    p = np.asarray(lpos[a:a + 3_000_000]); i = np.floor(p[:, :, 0].mean(1) / 128).astype(np.int64); k = np.floor(p[:, :, 2].mean(1) / 128).astype(np.int64)
    inb = (i >= 0) & (i < W) & (k >= 0) & (k < H); m = np.zeros(len(p), bool); m[inb] = near_b[k[inb], i[inb]]
    if m.any(): bt.append(p[m].copy()); btc.append(np.asarray(lcol[a:a + 3_000_000])[m].astype(np.float32).mean(1))
bt = np.concatenate(bt) if bt else np.zeros((0, 3, 3), np.float32); btc = np.concatenate(btc) if btc else np.zeros((0, 3), np.float32)
seen = np.zeros_like(bridge)
for z0, x0 in zip(*np.nonzero(bridge)):
    if seen[z0, x0]: continue
    comp, st = [], [(z0, x0)]; seen[z0, x0] = True          # (one bridge: its connected deck tiles)
    while st:
        z, x = st.pop(); comp.append((z, x))
        for dz, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q, r = z + dz, x + dx
            if 0 <= q < H and 0 <= r < W and bridge[q, r] and not seen[q, r]: seen[q, r] = True; st.append((q, r))
    zs_, xs_ = [c[0] for c in comp], [c[1] for c in comp]
    along_x = max(xs_) - min(xs_) >= max(zs_) - min(zs_)    # (the span runs east-west: look at it from the north)
    lo, hi = (min(zs_) - 0.5, max(zs_) + 1.5) if along_x else (min(xs_) - 0.5, max(xs_) + 1.5)
    tc = bt[:, :, 2 if along_x else 0].mean(1) / 128; sel = (tc >= lo) & (tc <= hi) & (np.abs(bt[:, :, 0].mean(1) / 128 - (min(xs_) + max(xs_) + 1) / 2) < (max(xs_) - min(xs_)) / 2 + 2) & (np.abs(bt[:, :, 2].mean(1) / 128 - (min(zs_) + max(zs_) + 1) / 2) < (max(zs_) - min(zs_)) / 2 + 2); T = bt[sel]
    U = T[:, :, 0 if along_x else 2] / 128; V = -T[:, :, 1] / 128   # (the side view: along the span, and up)
    A = np.stack([U[:, 0], V[:, 0]], 1); Bv = np.stack([U[:, 1], V[:, 1]], 1); C = np.stack([U[:, 2], V[:, 2]], 1)
    big = np.abs((Bv[:, 0] - A[:, 0]) * (C[:, 1] - A[:, 1]) - (Bv[:, 1] - A[:, 1]) * (C[:, 0] - A[:, 0])) > 1e-4
    A, Bv, C = A[big], Bv[big], C[big]
    cm = btc[sel][big].mean(0) if big.any() else np.zeros(3)
    wood = 128 if cm[0] > cm[2] + 25 and cm[0] >= cm[1] else 0     # (brown: a hull or a jetty's planks)
    def covered(u, v):
        e = lambda P, Q: (Q[:, 0] - P[:, 0]) * (v - P[:, 1]) - (Q[:, 1] - P[:, 1]) * (u - P[:, 0])
        d1, d2, d3 = e(A, Bv), e(Bv, C), e(C, A)
        return bool((((d1 >= 0) & (d2 >= 0) & (d3 >= 0)) | ((d1 <= 0) & (d2 <= 0) & (d3 <= 0))).any())
    for z, x in comp:
        for yb in range(int(wl_y[z, x]) + 1, int(gy[z, x])):
            if yb - wl_y[z, x] - 1 < 7 and covered((x if along_x else z) + 0.5, yb - BASE - 0.5): bs[z, x] |= 1 << (yb - wl_y[z, x] - 1)
        if bs[z, x]: bs[z, x] |= wood
print('bridges', int(seen.sum()), 'deck tiles,', int((bs > 0).sum()), 'with something under them,', int((bs >= 128).sum()), 'of it wood')

# npcs: every RS spawn the skate game knows (mapdata.CORE_SPAWNS + npc-spawns.EXTRA_SPAWNS), local tiles
npcs = []
for f in (os.path.join(ROOT, 'src', 'mapdata.js'), os.path.join(ROOT, 'src', 'npc-spawns.js')):
    t = open(f).read()
    for m in re.finditer(r'\n\s*([a-z]+)\s*:\s*\[((?:\s*\[\d+,\s*\d+\],?)+)\s*\]', t):
        for x, z in re.findall(r'\[(\d+),\s*(\d+)\]', m.group(2)):
            lx, lz = int(x) - BX, int(z) - BZ
            if 0 <= lx < W and 0 <= lz < H: npcs.append([lx, lz, m.group(1)])
print('npc spawns', len(npcs))

# villagers: the RS townsfolk spawns
vill = []
src = open(os.path.join(ROOT, 'src', 'npc-spawns.js')).read()
for kind in ('man', 'woman', 'guard', 'farmer', 'dwarf', 'shopkeeper', 'monk', 'barbarian'):
    mm = re.search(r'\b' + kind + r'\s*:\s*\[(.*?)\]\s*\]', src, re.S)
    if not mm: continue
    for x, z in re.findall(r'\[(\d+),\s*(\d+)\]', mm.group(1)):
        lx, lz = int(x) - BX, int(z) - BZ
        if 0 <= lx < W and 0 <= lz < H: vill.append([lx, lz, kind])
print('villagers', len(vill))

# the RS ground colour, for MC-style biome tinting of grass and leaves (smoothed over a 3x3 so tile seams soften)
gc = rgb.reshape(H, W, 3).copy(); hv = has.reshape(H, W).astype(np.float32)
num = sum(np.roll(np.roll(gc * hv[..., None], dz, 0), dx, 1) for dz in (-1, 0, 1) for dx in (-1, 0, 1))
den = sum(np.roll(np.roll(hv, dz, 0), dx, 1) for dz in (-1, 0, 1) for dx in (-1, 0, 1))
gc = np.where(den[..., None] > 0, num / np.maximum(den, 1)[..., None], [90, 120, 40]).clip(0, 255).astype(np.uint8)
blob = np.concatenate([gy.astype(np.uint8).ravel(), sf.ravel(), roof_up.ravel(), rci.ravel(), flags_hw.ravel(), wci.ravel(),
                       gc[..., 0].ravel(), gc[..., 1].ravel(), gc[..., 2].ravel(), edges.ravel(), wl_y.astype(np.uint8).ravel(), bs.ravel()])
blob.tofile(os.path.join(ROOT, 'assets', 'mine_world.bin'))
# the spawn: Lumbridge castle's courtyard (as the skate game)
spawn = [3222 - BX, 3218 - BZ]
json.dump({'W': W, 'H': H, 'x0': BX, 'z0': BZ, 'base': BASE, 'spawn': spawn, 'trees': trees, 'villagers': vill,
           'roofs': PAL.astype(int).tolist(), 'walls': WPAL.astype(int).tolist(), 'npcs': npcs, 'v': 2}, open(os.path.join(ROOT, 'assets', 'mine_world.json'), 'w'), separators=(',', ':'))
print('wrote assets/mine_world.bin', os.path.getsize(os.path.join(ROOT, 'assets', 'mine_world.bin')) // 1024, 'KB')
