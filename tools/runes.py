"""The 40 runes, placed ONCE and saved to assets/runes.json.   python runeskate/tools/runes.py

They used to be scattered at load time from the collision map, so every map change moved them, gave them new
ids and let players collect the "same" rune again (44/40). Now the list is fixed: stable ids (world coords)
the server checks, every rune on ground you can actually skate to from spawn, plus one hidden in Lumbridge
church. Re-running this re-rolls the runes and ORPHANS everyone's progress - only do it on purpose.

Reachable = flood fill from spawn across open tiles; walls, doors, water and the map edge stop it, anything
with a measured top low enough to ollie (fences, rails, hedges <= 1.2 tiles) does not.
"""
import json, os, math
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FULL = os.path.join(ROOT, 'tools', 'out', 'world.full.json')     # split.py's copy of the unsplit build
w = json.load(open(FULL if os.path.exists(FULL) else os.path.join(ROOT, 'assets', 'world.json')))
N, BX, BZ = w['size'], w['baseX'], w['baseZ']
blk = np.array(w['blocked'], np.uint8).reshape(N, N).T                  # [x][z]
ground = np.array(w['ground'], np.float32).reshape(N, N, 4)
HOP = 1.2

stop = set()                    # edges you cannot get across on a board
rail_mid = []
for ax, az, bx, bz, kind, top in w['segs']:
    key = (min(ax, bx), min(az, bz), 'v' if ax == bx else 'h')
    g = float(ground[min(max(min(ax, bx), 0), N - 1), min(max(min(az, bz), 0), N - 1)].min())
    low = top is not None and max(top) - g <= HOP
    if kind in ('wall', 'door', 'water', 'edge') or (kind in ('fence', 'rail', 'block') and not low): stop.add(key)
    if kind == 'rail' and top: rail_mid.append(((ax + bx) / 2, (az + bz) / 2))

def can(x, z, nx, nz):
    if not (0 <= nx < N and 0 <= nz < N) or blk[nx, nz] != 0: return False
    if nx != x: return (max(x, nx), z, 'v') not in stop
    return (x, max(z, nz), 'h') not in stop

sx, sz = int(w['spawn'][0]), int(w['spawn'][1])
reach = np.zeros((N, N), bool); reach[sx, sz] = True
q = [(sx, sz)]
while q:
    x, z = q.pop()
    for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, nz = x + dx, z + dz
        if not reach[nx if 0 <= nx < N else 0, nz if 0 <= nz < N else 0] and can(x, z, nx, nz): reach[nx, nz] = True; q.append((nx, nz))
print('reachable tiles', int(reach.sum()), 'of', int((blk == 0).sum()), 'open')

# a rune needs elbow room: every tile within 1 reachable, and no wall/fence on its own edges
def roomy(x, z):
    if not all(0 <= x + a < N and 0 <= z + b < N and reach[x + a, z + b] for a in (-1, 0, 1) for b in (-1, 0, 1)): return False
    return all(k not in stop for k in ((x, z, 'v'), (x + 1, z, 'v'), (x, z, 'h'), (x, z + 1, 'h')))

KINDS = ['air', 'water', 'earth', 'fire']
CHURCH = (3246, 3207)            # behind the pews, right of the altar - you have to go inside to find it
rng = np.random.default_rng(0x5ca7e)
runes = []
cx, cz = CHURCH[0] - BX, CHURCH[1] - BZ
assert reach[cx, cz], 'church rune tile is not reachable'
runes.append({'id': f'fire-{CHURCH[0]}-{CHURCH[1]}', 'kind': 'fire', 'high': False, 'x': CHURCH[0], 'z': CHURCH[1], 'hidden': True})

rails = [(int(x), int(z)) for x, z in rail_mid]
tries = 0
while len(runes) < 40 and tries < 200000:
    tries += 1
    kind = KINDS[len(runes) % 4]
    high = kind == 'air'
    if high:
        rx, rz = rails[rng.integers(len(rails))]
        x, z = rx + int(rng.integers(-1, 2)), rz + int(rng.integers(-1, 2))
    else:
        x, z = int(rng.integers(6, N - 6)), int(rng.integers(6, N - 6))
    if not (0 <= x < N and 0 <= z < N) or not roomy(x, z): continue
    if any(math.hypot(r['x'] - BX - x, r['z'] - BZ - z) < 14 for r in runes): continue
    runes.append({'id': f'{kind}-{x + BX}-{z + BZ}', 'kind': kind, 'high': high, 'x': x + BX, 'z': z + BZ})

json.dump({'runes': runes}, open(os.path.join(ROOT, 'assets', 'runes.json'), 'w'), indent=0)
print(len(runes), 'runes written;', sum(r['high'] for r in runes), 'high (air)')
