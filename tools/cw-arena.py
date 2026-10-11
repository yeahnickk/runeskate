"""Cut the Castle Wars arena out of the world packs for CODScape.   python tools/cw-arena.py   (after split.py)

The arena (world 2368..2431 x 3072..3135, the two castles and everything between) is chunks cx 10-11, cz 8-9 of
assets/world_castlewars.*; a ring of chunks round it comes along as scenery past the arena wall (the south row is
the Feldip Hills pack's top edge). The pack is re-based so the first chunk sits at (0,0): positions in the .bin are
per chunk, so only cx/cz and the tile grids move. Out: assets/cw_arena.json + assets/cw_arena.bin (the same format
as a world pack, see tools/split.py).
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(ROOT, 'assets')
CX0, CX1, CZ0, CZ1 = 9, 13, 7, 11                            # chunks kept [cx0, cx1) x [cz0, cz1)

packs = []
for name in ('castlewars', 'feldip'):
    packs.append((json.load(open(os.path.join(A, f'world_{name}.json'))), open(os.path.join(A, f'world_{name}.bin'), 'rb').read()))
CH = packs[0][0]['index']['chunk']
ox, oz = CX0 * CH, CZ0 * CH                                   # new local origin, in the grid's local tiles
W, H = (CX1 - CX0) * CH, (CZ1 - CZ0) * CH

# ground: [x][z][4 corners] (columns of H); blocked: [z][x]. Each tile comes from whichever pack holds it.
ground, blocked = [0.0] * (W * H * 4), [1] * (W * H)
for p, _ in packs:
    px0, pz0, pw, ph = p['x0'], p['z0'], p['w'], p['h']
    for i in range(W):
        for j in range(H):
            x, z = ox + i, oz + j
            if not (px0 <= x < px0 + pw and pz0 <= z < pz0 + ph): continue
            c = ((x - px0) * ph + (z - pz0)) * 4
            ground[(i * H + j) * 4:(i * H + j) * 4 + 4] = p['ground'][c:c + 4]
            blocked[j * W + i] = p['blocked'][(z - pz0) * pw + (x - px0)]
inside = lambda x, z: ox <= x <= ox + W and oz <= z <= oz + H
segs, trunks = [], []
for p, _ in packs:
    segs += [[ax - ox, az - oz, bx - ox, bz - oz, k, t] for ax, az, bx, bz, k, t in p['segs'] if inside(ax, az) and inside(bx, bz)]
    trunks += [[x - ox, z - oz, r] for x, z, r in p['trunks'] if inside(x, z)]

out, chunks = bytearray(), []
for p, blob in packs:
    for ch in p['index']['chunks']:
        if not (CX0 <= ch['cx'] < CX1 and CZ0 <= ch['cz'] < CZ1): continue
        nc = {'cx': ch['cx'] - CX0, 'cz': ch['cz'] - CZ0}
        for k in ('terrain', 'locs', 'locs_alpha'):
            part = ch.get(k)
            if not part or not part['n']: continue
            n = part['n']
            while len(out) % 2: out.append(0)                # Int16Array views need even offsets
            po = len(out); out += blob[part['posOff']:part['posOff'] + n * 6]
            co = len(out); out += blob[part['colOff']:part['colOff'] + n * 3]
            nc[k] = {'n': n, 'posOff': po, 'colOff': co}
        chunks.append(nc)

# world tile (RS coords) of the new origin, so code can still talk in real Castle Wars tiles
BX, BZ = 2048 + ox, 2816 + oz
pack = {'name': 'cw_arena', 'title': 'Castle Wars', 'baseX': BX, 'baseZ': BZ, 'size': max(W, H), 'x0': 0, 'z0': 0, 'w': W, 'h': H,
        'spawn': [2400 - BX, 3103 - BZ], 'ground': ground, 'blocked': blocked, 'segs': segs, 'lanes': [], 'trunks': trunks,
        'index': {'chunk': CH, 'chunks': chunks}}
json.dump(pack, open(os.path.join(A, 'cw_arena.json'), 'w'), separators=(',', ':'))
open(os.path.join(A, 'cw_arena.bin'), 'wb').write(out)
print(f'cw_arena: {W}x{H} tiles from ({BX},{BZ}), {len(chunks)} chunks, {len(out) / 1e6:.1f} MB mesh, {len(segs)} segs')
