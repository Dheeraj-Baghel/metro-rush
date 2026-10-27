"""Re-palette the shared Kenney colormap atlases toward the METRO RUSH
station direction (cream / terracotta architecture, teal-blue structures,
yellow safety accents), and soften the saturated purples/magentas that read
as 'random rainbow buildings'.

The Kenney kits share one 512x512 gradient atlas; each 32x64 cell is a
vertical gradient swatch. Recoloring the atlas cell-by-cell restyles every
building that samples it while keeping each swatch's light->dark shading.
Originals are preserved in asset-inbox/ and public/assets/b/.

Run: designer python3 qa/repalette.py
"""
import os, colorsys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGETS = [
    'public/assets/c/city/Textures/colormap.png',
    'public/assets/c/props/ind/Textures/colormap.png',
]

# source swatch hex (top color of the gradient cell) -> target hue/sat/val shift
# Hues are degrees. Each rule maps a family of swatches.
RULES = [
    # magenta/pink + violet facades (incl. dark gradient ends) -> terracotta
    (lambda h, s, v: 240 < h <= 335 and s > 0.2, lambda h, s, v: (14 + (h - 240) * 0.06, min(s, 0.55), v * 0.95)),
    # saturated green facades -> station teal
    (lambda h, s, v: 120 <= h <= 160 and s > 0.3, lambda h, s, v: (178, s * 0.75, v * 0.92)),
    # bright blue facades -> calmer transit blue
    (lambda h, s, v: 205 <= h <= 240 and s > 0.35, lambda h, s, v: (203, s * 0.75, v)),
    # cold grey-blue concrete -> warm cream stone
    (lambda h, s, v: 220 <= h <= 240 and 0.08 < s <= 0.35 and v > 0.5, lambda h, s, v: (34, 0.22, min(1, v * 1.08))),
    # dark slate -> warm charcoal (window frames / roofs keep contrast)
    (lambda h, s, v: 220 <= h <= 240 and 0.08 < s <= 0.35 and v <= 0.5, lambda h, s, v: (24, 0.16, v)),
]


def remap(rgb):
    r, g, b = [c / 255 for c in rgb]
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    hd = h * 360
    for test, fn in RULES:
        if test(hd, s, v):
            nh, ns, nv = fn(hd, s, v)
            nr, ng, nb = colorsys.hsv_to_rgb((nh % 360) / 360, max(0, min(1, ns)), max(0, min(1, nv)))
            return (round(nr * 255), round(ng * 255), round(nb * 255))
    return rgb


for rel in TARGETS:
    p = os.path.join(ROOT, rel)
    src = p.replace('/c/', '/c/') + '.orig.png'
    if not os.path.exists(src):
        Image.open(p).save(src)  # keep the untouched atlas beside it
    im = Image.open(src).convert('RGBA')
    px = im.load()
    W, H = im.size
    cache = {}
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            k = (r, g, b)
            if k not in cache: cache[k] = remap(k)
            px[x, y] = (*cache[k], a)
    im.save(p)
    print('repaletted', rel)
    im.resize((256, 256), Image.NEAREST).save(os.path.join(ROOT, 'artifacts', 'colormap-' + rel.split('/')[3] + '-new.png'))
