"""Place the extra 60 runes and the NPCs of the rest of F2P.   python runeskate/tools/place.py  (after split.py)

Runes: the 40 in assets/runes.json are KEPT exactly (their ids are what players have collected); 60 more are
appended with per-region quotas so Falador, Varrock, Port Sarim and the wilderness all get their share. Ids are
world coords, so re-running with the file at 100 does nothing - only a deliberate edit re-rolls anything.

NPCs: real spawn tiles from tools/data/spawn-index.json (the server's own map files), kept only where a skater can
actually get to them, thinned so no kind crowds one spot, written to src/npc-spawns.js. The KBD really lives
underground; here it gets a surface lair deep in the wilderness instead.

Reachable = flood fill from spawn across the playable regions (split.py's REGIONS); walls, doors, water and
unplayable land stop it, anything low enough to ollie does not.
"""
import json, os, math, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
w = json.load(open(os.path.join(ROOT, 'tools', 'out', 'world.full.json')))
N, BX, BZ = w['size'], w['baseX'], w['baseZ']
blk = np.array(w['blocked'], np.uint8).reshape(N, N).T                  # [x][z]
ground = np.array(w['ground'], np.float32).reshape(N, N, 4)
HOP = 1.2

src = open(os.path.join(ROOT, 'tools', 'split.py')).read()
REGIONS = eval(src[src.index('REGIONS = [') + 10: src.index(']\n', src.index('REGIONS = [')) + 1])
play = np.zeros((N, N), bool)
def region_of(wx, wz):
    for name, title, x0, z0, x1, z1 in REGIONS:
        if x0 <= wx < x1 and z0 <= wz < z1: return name
    return None
for name, title, x0, z0, x1, z1 in REGIONS: play[x0 - BX:x1 - BX, z0 - BZ:z1 - BZ] = True

stop = set(); rail_mid = []
for ax, az, bx, bz, kind, top in w['segs']:
    key = (min(ax, bx), min(az, bz), 'v' if ax == bx else 'h')
    g = float(ground[min(max(min(ax, bx), 0), N - 1), min(max(min(az, bz), 0), N - 1)].min())
    low = top is not None and max(top) - g <= HOP
    if kind in ('wall', 'door', 'water') or (kind in ('fence', 'rail', 'block') and not low): stop.add(key)
    if kind == 'rail' and top: rail_mid.append(((ax + bx) / 2, (az + bz) / 2))

def can(x, z, nx, nz):
    if not (0 <= nx < N and 0 <= nz < N) or blk[nx, nz] != 0 or not play[nx, nz]: return False
    if nx != x: return (max(x, nx), z, 'v') not in stop
    return (x, max(z, nz), 'h') not in stop

sx, sz = int(w['spawn'][0]), int(w['spawn'][1])
reach = np.zeros((N, N), bool); reach[sx, sz] = True
q = [(sx, sz)]
while q:
    x, z = q.pop()
    for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, nz = x + dx, z + dz
        if 0 <= nx < N and 0 <= nz < N and not reach[nx, nz] and can(x, z, nx, nz): reach[nx, nz] = True; q.append((nx, nz))
print('reachable tiles', int(reach.sum()))
for name, title, x0, z0, x1, z1 in REGIONS:
    print(f'  {name:10s} {int(reach[x0 - BX:x1 - BX, z0 - BZ:z1 - BZ].sum()):6d} reachable')

def roomy(x, z):
    if not all(0 <= x + a < N and 0 <= z + b < N and reach[x + a, z + b] for a in (-1, 0, 1) for b in (-1, 0, 1)): return False
    return all(k not in stop for k in ((x, z, 'v'), (x + 1, z, 'v'), (x, z, 'h'), (x, z + 1, 'h')))

# ---------------------------------------------------------------- runes
RP = os.path.join(ROOT, 'assets', 'runes.json')
runes = json.load(open(RP))['runes']
assert len(runes) >= 40
QUOTA = {'core': 8, 'varrock': 10, 'falador': 14, 'portsarim': 7, 'south': 1,
         'wild-sw': 6, 'wild-se': 6, 'wild-nw': 4, 'wild-ne': 4}
assert sum(QUOTA.values()) == 60
KINDS = ['air', 'water', 'earth', 'fire']
rng = np.random.default_rng(0xfa1ad0)
rails = [(int(x), int(z)) for x, z in rail_mid]
have = {k: sum(region_of(r['x'], r['z']) == k for r in runes[40:]) for k in QUOTA}
for reg, want in QUOTA.items():
    name, title, x0, z0, x1, z1 = next(r for r in REGIONS if r[0] == reg)
    rrails = [(x, z) for x, z in rails if x0 <= x + BX < x1 and z0 <= z + BZ < z1]
    tries = 0
    while have[reg] < want and tries < 200000:
        tries += 1
        kind = KINDS[len(runes) % 4]
        high = kind == 'air' and len(rrails) > 0 and rng.random() < 0.7
        if high:
            rx, rz = rrails[rng.integers(len(rrails))]
            x, z = rx + int(rng.integers(-1, 2)), rz + int(rng.integers(-1, 2))
        else:
            x, z = int(rng.integers(x0 - BX + 3, x1 - BX - 3)), int(rng.integers(z0 - BZ + 3, z1 - BZ - 3))
        if not (0 <= x < N and 0 <= z < N) or region_of(x + BX, z + BZ) != reg or not roomy(x, z): continue
        if any(math.hypot(r['x'] - BX - x, r['z'] - BZ - z) < 14 for r in runes): continue
        runes.append({'id': f'{kind}-{x + BX}-{z + BZ}', 'kind': kind, 'high': high, 'x': x + BX, 'z': z + BZ})
        have[reg] += 1
    print(f'  runes {reg:10s} {have[reg]}/{want}')
assert len(runes) == 100 and len({r['id'] for r in runes}) == 100
json.dump({'runes': runes}, open(RP, 'w'), indent=0)
print(len(runes), 'runes written')

# ---------------------------------------------------------------- NPCs
idx = json.load(open(os.path.join(ROOT, 'tools', 'data', 'spawn-index.json')))
KIND_IDS = {  # kind -> (npc ids, max spawns)
    'guard': ([9], 22), 'whiteknight': ([19], 8), 'blackknight': ([179, 178], 6), 'barbarian': ([12, 17], 10),
    'dwarf': ([206, 118], 8), 'darkwarrior': ([192], 7), 'bear': ([105], 6), 'unicorn': ([89], 5),
    'giantspider': ([60], 6), 'scorpion': ([107], 8), 'skeleton': ([92, 91, 90], 16), 'zombie': ([74, 73, 75], 12),
    'ghost': ([103], 10), 'icewarrior': ([125], 10), 'giant': ([117], 6), 'mossgiant': ([112], 6),
    'icegiant': ([111], 5), 'blackunicorn': ([133], 5), 'lesserdemon': ([82], 6), 'greaterdemon': ([83], 4),
    'greendragon': ([941], 5),
}
CORE = next(r for r in REGIONS if r[0] == 'core')
def near_reach(x, z):
    for a in range(-2, 3):
        for b in range(-2, 3):
            if 0 <= x + a < N and 0 <= z + b < N and reach[x + a, z + b]: return (x + a, z + b)
    return None
spawns = {}
for kind, (ids, cap) in KIND_IDS.items():
    got = []
    cand = [e for e in idx if e['kind'] == 'npc' and e['id'] in ids and e['level'] == 0 and region_of(e['x'], e['z'])]
    rng.shuffle(cand)
    for e in cand:
        t = near_reach(e['x'] - BX, e['z'] - BZ)
        if not t: continue
        wx, wz = t[0] + BX, t[1] + BZ
        if any(math.hypot(wx - a, wz - b) < 5 for a, b in got): continue
        got.append((wx, wz))
        if len(got) >= cap: break
    spawns[kind] = sorted(got)
    print(f'  npc {kind:13s} {len(got):2d} (of {len(cand)} spawns)')

# the KBD: a surface lair deep in the wilderness - the most open reachable spot north of z 3850
best = None
for x in range(N):
    wx = x + BX
    if not (2950 <= wx <= 3320): continue
    for z in range(N):
        wz = z + BZ
        if wz < 3850 or not reach[x, z]: continue
        if x < 5 or z < 5 or x >= N - 5 or z >= N - 5: continue
        score = int(reach[x - 5:x + 6, z - 5:z + 6].sum())
        if best is None or score > best[0]: best = (score, wx, wz)
print('  KBD lair', best)
spawns['kbd'] = [(best[1], best[2])]

out = os.path.join(ROOT, 'src', 'npc-spawns.js')
with open(out, 'w') as f:
    f.write('// Generated by tools/place.py: real spawn tiles (world coords) for the rest of F2P, reachable from spawn.\n')
    f.write('export const EXTRA_SPAWNS = {\n')
    for k, v in spawns.items(): f.write(f'  {k}: {json.dumps([list(p) for p in v])},\n')
    f.write('};\n')
print('wrote', out)
