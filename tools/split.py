"""Split the built world into packs the client streams in.   python runeskate/tools/split.py   (after lanes.py)

The export is one big square covering all of mainland F2P (tools/build.py docstring has the command). Only the
regions below are playable. `core` is the first load; every other pack is fetched by the client only when a
skater gets near it (src/main.js streamRegions), so the first download never grows. Anything outside the
regions (members land east of Varrock, the desert) is dropped. The client walls off whatever is not loaded
(World.frontier), so no map edge is baked in here.

Each pack carries its own rectangle of collision (ground corners, tile kinds), its segments, lane tiles and mesh
chunks (offsets into its own .bin), all in the grid's local coords. The unsplit build is kept in
tools/out/world.full.json for offline tools (runes.py).
"""
import json, os, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(ROOT, 'assets')
OUT = os.path.join(ROOT, 'tools', 'out')

# playable regions in WORLD coords [x0, z0, x1, z1) - 32-aligned so chunks never straddle two packs
REGIONS = [
    ('core',       'Lumbridge',       3072, 3136, 3328, 3392),   # first load: Lumbridge, Draynor, Al Kharid
    ('varrock',    'Varrock',         3072, 3392, 3328, 3520),   # + Barbarian Village, Edgeville
    ('falador',    'Falador',         2880, 3264, 3072, 3520),   # + Ice Mountain, Goblin Village
    ('portsarim',  'Port Sarim',      2880, 3072, 3072, 3264),   # + Rimmington, Mudskipper Point
    ('south',      'the south',       3072, 3072, 3328, 3136),   # Lumbridge swamp, Al Kharid's south end
    ('wild-sw',    'the Wilderness',  2880, 3520, 3136, 3744),
    ('wild-se',    'the Wilderness',  3136, 3520, 3392, 3744),
    ('wild-nw',    'the deep Wilderness', 2880, 3744, 3136, 3968),
    ('wild-ne',    'the deep Wilderness', 3136, 3744, 3392, 3968),
]

w = json.load(open(os.path.join(A, 'world.json')))
if 'regions' in w: raise SystemExit('assets/world.json is already split - re-run build.py + lanes.py first')
blob = open(os.path.join(A, 'world.bin'), 'rb').read()
shutil.copy(os.path.join(A, 'world.json'), os.path.join(OUT, 'world.full.json'))
N, CH, BX, BZ = w['size'], w['index']['chunk'], w['baseX'], w['baseZ']
segs = [s for s in w['segs'] if s[4] != 'edge']              # the export's own boundary ring

def rect(r):
    name, title, x0, z0, x1, z1 = r
    assert (x0 - BX) % CH == 0 and (z0 - BZ) % CH == 0 and (x1 - x0) % CH == 0 and (z1 - z0) % CH == 0, name
    return {'name': name, 'title': title, 'x0': x0 - BX, 'z0': z0 - BZ, 'w': x1 - x0, 'h': z1 - z0}
RECTS = [rect(r) for r in REGIONS]
def inside(r, x, z): return r['x0'] <= x < r['x0'] + r['w'] and r['z0'] <= z < r['z0'] + r['h']

for r in RECTS:
    x0, z0, rw, rh = r['x0'], r['z0'], r['w'], r['h']
    ground, blocked = [], []
    for tx in range(x0, x0 + rw):                            # ground: [x][z][corner], like the full grid
        o = (tx * N + z0) * 4
        ground += w['ground'][o:o + rh * 4]
    for tz in range(z0, z0 + rh):                            # blocked: [z][x]
        blocked += w['blocked'][tz * N + x0: tz * N + x0 + rw]
    rsegs = [s for s in segs if inside(r, (s[0] + s[2]) / 2, (s[1] + s[3]) / 2)]
    lanes = [l for l in w.get('lanes', []) if inside(r, l[0], l[1])]
    rb = bytearray(); chunks = []
    for ch in w['index']['chunks']:
        if not inside(r, ch['cx'] * CH, ch['cz'] * CH): continue
        ent = {'cx': ch['cx'], 'cz': ch['cz']}
        for k in ('terrain', 'locs', 'locs_alpha'):
            p = ch.get(k)
            if not p: continue
            n = p['n']; e = {'n': n, 'posOff': len(rb)}
            rb += blob[p['posOff']:p['posOff'] + n * 6]
            while len(rb) % 4: rb.append(0)
            e['colOff'] = len(rb); rb += blob[p['colOff']:p['colOff'] + n * 3]
            while len(rb) % 4: rb.append(0)
            ent[k] = e
        chunks.append(ent)
    pack = {**r, 'ground': ground, 'blocked': blocked, 'segs': rsegs, 'lanes': lanes, 'index': {'chunk': CH, 'chunks': chunks}}
    if r['name'] == 'core':
        pack.update({'baseX': BX, 'baseZ': BZ, 'size': N, 'spawn': w['spawn'], 'regions': RECTS[1:]})
        jf, bf = 'world.json', 'world.bin'
    else:
        jf, bf = f"world_{r['name']}.json", f"world_{r['name']}.bin"
    json.dump(pack, open(os.path.join(A, jf), 'w'), separators=(',', ':'))
    open(os.path.join(A, bf), 'wb').write(rb)
    print(f"{r['name']:10s} {rw}x{rh} tiles  segs {len(rsegs):6d}  chunks {len(chunks):3d}  bin {len(rb) // 1024:7d} KB")
p = os.path.join(A, 'world.bin.gz')                          # build.py's full-map gzip; compress.ts remakes it
if os.path.exists(p): os.remove(p)
