"""Top-down picture of the whole playable map for the /map page.   python runeskate/tools/mapimg.py

Every terrain + loc triangle is binned by its centre into a 2 px/tile grid and the HIGHEST one wins (roofs over
floors, canopies over grass), shaded a little by its slope so hills read. Water/walls come out in their own
colours for free. Writes assets/map.png (north up, x east), world tile (x, z) -> pixel ((x-2880)*2, (3968-z)*2).
"""
import os, json
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tools', 'out')
meta = json.load(open(os.path.join(OUT, 'meta.json')))
N, PX = meta['size'], 2
S = N * PX
best_h = np.full(S * S, -1e9, np.float32); rgb = np.zeros((S * S, 3), np.float32)
for name in ('world_terrain', 'world_locs'):
    pos = np.fromfile(os.path.join(OUT, f'{name}.pos.bin'), np.float32).reshape(-1, 3, 3)
    col = np.fromfile(os.path.join(OUT, f'{name}.col.bin'), np.uint8).reshape(-1, 3, 3)
    for a in range(0, len(pos), 2_000_000):
        p = pos[a:a + 2_000_000]; c = col[a:a + 2_000_000].astype(np.float32).mean(1)
        x = p[:, :, 0].mean(1) / 128; n = p[:, :, 2].mean(1) / 128; h = -p[:, :, 1].max(1) / 128
        # slope shading: light from the north-west
        e1 = p[:, 1] - p[:, 0]; e2 = p[:, 2] - p[:, 0]; nv = np.cross(e1, e2)
        nv /= np.linalg.norm(nv, axis=1, keepdims=True) + 1e-9
        up = np.abs(nv[:, 1]); flat = up > 0.2
        shade = np.clip(0.85 + 0.35 * np.sign(-nv[:, 1:2]) * (-nv[:, 0:1] + nv[:, 2:3]) * 0.5, 0.55, 1.15)
        c = c * shade
        ix = np.floor(x * PX).astype(np.int64); iz = np.floor(n * PX).astype(np.int64)
        ok = flat & (ix >= 0) & (ix < S) & (iz >= 0) & (iz < S)
        ix, iz, h, c = ix[ok], iz[ok], h[ok], c[ok]
        cell = (S - 1 - iz) * S + ix
        o = np.argsort(h, kind='stable')                     # later (higher) writes win
        cell, h, c = cell[o], h[o], c[o]
        hi = h > best_h[cell]
        # np assignment with duplicates keeps the LAST occurrence -> the highest triangle in each cell
        best_h[cell[hi]] = h[hi]; rgb[cell[hi]] = c[hi]
    print(name, 'done')
img = rgb.reshape(S, S, 3)
# fill the cells no triangle centre landed in (the checkerboard) from their neighbours, then brighten
hole = best_h.reshape(S, S) < -1e8
for _ in range(2):
    nb = np.stack([np.roll(img, s, a) for a in (0, 1) for s in (-1, 1)]); nh = np.stack([np.roll(~hole, s, a) for a in (0, 1) for s in (-1, 1)])
    fill = (nb * nh[..., None]).sum(0) / np.maximum(nh.sum(0), 1)[..., None]
    img = np.where(hole[..., None], fill, img); hole = hole & (nh.sum(0) == 0)
img = 255 * (np.clip(img, 0, 255) / 255) ** 0.7 * 1.08
# only the playable map: x 2880-3392, z 3072-3968 (split.py's regions)
X1 = (3392 - meta['baseX']) * PX
img = np.clip(img[:, :X1], 0, 255).astype(np.uint8)
Image.fromarray(img).save(os.path.join(ROOT, 'assets', 'map.png'), optimize=True)
print('wrote assets/map.png', os.path.getsize(os.path.join(ROOT, 'assets', 'map.png')) // 1024, 'KB')
