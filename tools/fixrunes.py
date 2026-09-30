"""Rune audit: every rune must be EASY to reach.   python runeskate/tools/fixrunes.py [--write]

A stricter flood than place.py's: walls, doors and water stop it; hedges/fences/low blocks only count as
passable if a comfortable ollie clears them FROM THE SIDE YOU ARE ON (top < ground + 1.0); and the wilderness
ends at x 2944 (west of that is mountain filler outside the F2P map). A rune that fails, or that has no open
ground around it, is MOVED to the nearest good tile in its region. Its id is kept, so everybody who already
collected it keeps it (serve.ts drops found ids that are not in runes.json - never change an id).
"""
import json, os, math, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
w = json.load(open(os.path.join(ROOT, 'tools', 'out', 'world.full.json')))
N, BX, BZ = w['size'], w['baseX'], w['baseZ']
blk = np.array(w['blocked'], np.uint8).reshape(N, N).T
ground = np.array(w['ground'], np.float32).reshape(N, N, 4)
src = open(os.path.join(ROOT, 'tools', 'split.py')).read()
REGIONS = eval(src[src.index('REGIONS = [') + 10: src.index(']\n', src.index('REGIONS = [')) + 1])
WILD_WEST = 2944
play = np.zeros((N, N), bool)
for name, title, x0, z0, x1, z1 in REGIONS: play[x0 - BX:x1 - BX, z0 - BZ:z1 - BZ] = True
play[:WILD_WEST - BX, 3520 - BZ:] = False
def region_of(wx, wz):
    for r in REGIONS:
        if r[2] <= wx < r[4] and r[3] <= wz < r[5]: return r
seg = {}
for ax, az, bx, bz, kind, top in w['segs']:
    seg[(min(ax, bx), min(az, bz), 'v' if ax == bx else 'h')] = (kind, top)
EASY = 1.0
def can(x, z, nx, nz):
    if not (0 <= nx < N and 0 <= nz < N) or blk[nx, nz] != 0 or not play[nx, nz]: return False
    k = (max(x, nx), z, 'v') if nx != x else (x, max(z, nz), 'h')
    s = seg.get(k)
    if not s: return True
    kind, top = s
    if kind in ('wall', 'water', 'edge'): return False
    if kind == 'door': return True                         # players DO get through gates (Taverley's runes are collected)
    return top is not None and max(top) - float(ground[x, z].min()) <= EASY
sx, sz = int(w['spawn'][0]), int(w['spawn'][1])
reach = np.zeros((N, N), bool); reach[sx, sz] = True; q = [(sx, sz)]
while q:
    x, z = q.pop()
    for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, nz = x + dx, z + dz
        if 0 <= nx < N and 0 <= nz < N and not reach[nx, nz] and can(x, z, nx, nz): reach[nx, nz] = True; q.append((nx, nz))
def roomy(x, z, r=2):
    """open, reachable ground all round, no segment through it"""
    for a in range(-r, r + 1):
        for b in range(-r, r + 1):
            if not (0 <= x + a < N and 0 <= z + b < N and reach[x + a, z + b]): return False
    return all(k not in seg for k in ((x, z, 'v'), (x + 1, z, 'v'), (x, z, 'h'), (x, z + 1, 'h')))

RP = os.path.join(ROOT, 'assets', 'runes.json')
runes = json.load(open(RP))['runes']
moved = 0
for i, r in enumerate(runes):
    x, z = r['x'] - BX, r['z'] - BZ
    # only unreachable runes move: a rune up on a rail is SUPPOSED to be awkward. The first 40 (the original
    # Lumbridge set) are all proven collected dozens of times and stay exactly where they are.
    near = any(0 <= x + a < N and 0 <= z + b < N and reach[x + a, z + b] for a in (-1, 0, 1) for b in (-1, 0, 1))
    if i < 40 or near: continue
    reg = region_of(r['x'], r['z'])
    best = None
    for rad in range(1, 60):
        for a in range(-rad, rad + 1):
            for b in (-rad, rad) if abs(a) != rad else range(-rad, rad + 1):
                nx, nz = x + a, z + b
                if not (0 <= nx < N and 0 <= nz < N) or region_of(nx + BX, nz + BZ) != reg or not roomy(nx, nz, 3): continue
                if any(o is not r and math.hypot(o['x'] - BX - nx, o['z'] - BZ - nz) < 12 for o in runes): continue
                d = math.hypot(a, b)
                if best is None or d < best[0]: best = (d, nx, nz)
        if best: break
    print(f'rune {i:3d} {r["id"]:18s} unreachable/cramped -> ({best[1] + BX},{best[2] + BZ}) moved {best[0]:.0f} tiles')
    r['x'], r['z'] = best[1] + BX, best[2] + BZ
    r['high'] = False                                      # it may have been up on a rail; the new spot is ground
    moved += 1
print(moved, 'runes moved;', len(runes), 'total; ids unchanged:', len({r['id'] for r in runes}))
if '--write' in sys.argv: json.dump({'runes': runes}, open(RP, 'w'), indent=0); print('wrote', RP)
