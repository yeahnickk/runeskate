"""Split the built world into packs the client streams in.   python runeskate/tools/split.py   (after lanes.py)

The export covers a 384x384-tile square from the same corner as before (local coords unchanged), but only two
parts of it are playable:
  core     x 0-255, z 0-255   Lumbridge, Draynor, Al Kharid's edge  -> assets/world.json + world.bin (first load)
  varrock  x 0-255, z 256-383 Varrock, Barbarian Village, Edgeville -> assets/world_varrock.json + .bin
The varrock pack is only fetched when a skater gets near its edge (src/main.js), so the first load stays the
same size. Everything east of x=255 is dropped; a permanent edge keeps you out of it.

Each pack carries its own rectangle of collision (ground corners, tile kinds), its segments, lane tiles and
mesh chunks (offsets into its own .bin). The full, unsplit build is kept in tools/out/world.full.json for the
offline tools (runes.py).
"""
import json, os, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(ROOT, 'assets')
OUT = os.path.join(ROOT, 'tools', 'out')
w = json.load(open(os.path.join(A, 'world.json')))
if 'regions' in w: raise SystemExit('assets/world.json is already split - re-run build.py + lanes.py first')
blob = open(os.path.join(A, 'world.bin'), 'rb').read()
shutil.copy(os.path.join(A, 'world.json'), os.path.join(OUT, 'world.full.json'))
N, CH = w['size'], w['index']['chunk']
PLAY_W = 256
REGIONS = [
    {'name': 'core', 'x0': 0, 'z0': 0, 'w': PLAY_W, 'h': 256},
    {'name': 'varrock', 'x0': 0, 'z0': 256, 'w': PLAY_W, 'h': N - 256},
]

# segments: drop the build's own map-edge ring (it was drawn round the whole 384 square), then add the playable
# outline: west x=1, south z=1, north z=N-1 and the east cut at x=PLAY_W-1 - the same lines the old 256 map had
segs = [s for s in w['segs'] if s[4] != 'edge']
for i in range(1, N - 1):
    if i < PLAY_W - 1: segs += [[i, 1, i + 1, 1, 'edge', None], [i, N - 1, i + 1, N - 1, 'edge', None]]
    segs += [[1, i, 1, i + 1, 'edge', None], [PLAY_W - 1, i, PLAY_W - 1, i + 1, 'edge', None]]

def inside(r, x, z): return r['x0'] <= x < r['x0'] + r['w'] and r['z0'] <= z < r['z0'] + r['h']

for r in REGIONS:
    x0, z0, rw, rh = r['x0'], r['z0'], r['w'], r['h']
    ground, blocked = [], []
    for tx in range(x0, x0 + rw):                          # ground: [x][z][corner], like the full grid
        o = (tx * N + z0) * 4
        ground += w['ground'][o:o + rh * 4]
    for tz in range(z0, z0 + rh):                          # blocked: [z][x]
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
        pack.update({'baseX': w['baseX'], 'baseZ': w['baseZ'], 'size': N, 'spawn': w['spawn'],
                     'regions': [{k: v for k, v in q.items()} for q in REGIONS[1:]]})
        jf, bf = 'world.json', 'world.bin'
    else:
        jf, bf = f"world_{r['name']}.json", f"world_{r['name']}.bin"
    json.dump(pack, open(os.path.join(A, jf), 'w'), separators=(',', ':'))
    open(os.path.join(A, bf), 'wb').write(rb)
    print(f"{r['name']:8s} {rw}x{rh} tiles  segs {len(rsegs)}  chunks {len(chunks)}  bin {len(rb) // 1024} KB")
for f in ('world.bin.gz',):                                  # build.py's stale full-map gzip
    p = os.path.join(A, f)
    if os.path.exists(p): os.remove(p)
