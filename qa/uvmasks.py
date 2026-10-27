"""Outfit UV masks for the Quaternius Superhero_Male body, derived from the
mesh's own skin weights (no hand-drawn guessing).

Every body triangle is classified by the bone carrying the largest summed
weight across its three vertices, plus world height for the neck/wrist
boundaries. Triangles are then rasterized in UV space into masks:

  hoodie  : spine_01..03, clavicles, upper/lower arms (sleeves stop above hands)
  pants   : pelvis, thighs, calves
  shoes   : feet, balls
  soles   : lowest band of the foot geometry
  skin    : head/neck/hands (left untouched)
"""
import json, struct, os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
BODY = os.path.join(os.path.dirname(HERE), 'asset-inbox', 'quaternius', 'x',
                    'Universal Base Characters[Standard]', 'Base Characters', 'Godot - UE')

HOODIE = {'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r',
          'lowerarm_l', 'lowerarm_r', 'upperarm_twist_01_l', 'upperarm_twist_01_r', 'upperarm_twist_02_l',
          'upperarm_twist_02_r', 'lowerarm_twist_01_l', 'lowerarm_twist_01_r', 'lowerarm_twist_02_l', 'lowerarm_twist_02_r'}
PANTS = {'pelvis', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'thigh_twist_01_l', 'thigh_twist_01_r',
         'calf_twist_01_l', 'calf_twist_01_r', 'thigh_twist_02_l', 'thigh_twist_02_r', 'calf_twist_02_l', 'calf_twist_02_r'}
SHOES = {'foot_l', 'foot_r', 'ball_l', 'ball_r', 'ball_leaf_l', 'ball_leaf_r'}

_cache = None


def _acc(js, b, i):
    a = js['accessors'][i]; bv = js['bufferViews'][a['bufferView']]
    ct = {5121: 'B', 5123: 'H', 5125: 'I', 5126: 'f'}[a['componentType']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    sz = struct.calcsize(ct)
    stride = bv.get('byteStride', sz * n)
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    out = []
    for k in range(a['count']):
        s = off + k * stride
        out.append(struct.unpack('<' + ct * n, b[s:s + sz * n]))
    if a.get('normalized') and ct in 'BH':
        m = 255.0 if ct == 'B' else 65535.0
        out = [tuple(v / m for v in t) for t in out]
    return out


def classify():
    global _cache
    if _cache: return _cache
    js = json.load(open(os.path.join(BODY, 'Superhero_Male_FullBody.gltf')))
    b = open(os.path.join(BODY, 'Superhero_Male_FullBody.bin'), 'rb').read()
    joints = [js['nodes'][i]['name'] for i in js['skins'][0]['joints']]
    mesh = [m for m in js['meshes'] if m['name'].startswith('Sphere')][0]
    p = mesh['primitives'][0]
    pos = _acc(js, b, p['attributes']['POSITION'])
    uv = _acc(js, b, p['attributes']['TEXCOORD_0'])
    J = _acc(js, b, p['attributes']['JOINTS_0'])
    W = _acc(js, b, p['attributes']['WEIGHTS_0'])
    idx = _acc(js, b, p['indices'])
    idx = [i[0] for i in idx]
    tris = []
    for t in range(0, len(idx), 3):
        vs = idx[t:t + 3]
        score = {}
        for v in vs:
            for j, w in zip(J[v], W[v]):
                if w > 0: score[joints[j]] = score.get(joints[j], 0) + w
        bone = max(score, key=score.get)
        # mesh is in node-local space; the armature root rotates -90 about X,
        # so local z is world up (min z ~ -0.01 feet, max ~1.81 head)
        zs = [pos[v][2] for v in vs]
        zmean = sum(zs) / 3
        cls = 'skin'
        if bone in SHOES: cls = 'shoes'
        elif bone in PANTS: cls = 'pants'
        elif bone in HOODIE: cls = 'hoodie'
        if cls == 'shoes' and zmean < 0.018: cls = "soles"
        # hoodie stops a little below the jaw; sleeves stop at the wrist
        if cls == 'hoodie' and zmean > 1.52: cls = 'skin'
        tris.append((cls, [uv[v] for v in vs]))
    _cache = tris
    return tris


def outfit_masks(Wpx, Hpx):
    tris = classify()
    masks = {k: Image.new('L', (Wpx, Hpx), 0) for k in ('hoodie', 'pants', 'shoes', 'soles')}
    draws = {k: ImageDraw.Draw(m) for k, m in masks.items()}
    for cls, uvs in tris:
        if cls not in draws: continue
        pts = [(u * Wpx, v * Hpx) for u, v in uvs]
        draws[cls].polygon(pts, fill=255)
    # dilate slightly to cover UV seams (prevents skin-colored cracks)
    from PIL import ImageFilter
    for k in masks: masks[k] = masks[k].filter(ImageFilter.MaxFilter(5))
    return masks


if __name__ == '__main__':
    from collections import Counter
    tris = classify()
    print(Counter(c for c, _ in tris))
    m = outfit_masks(512, 512)
    prev = Image.new('RGB', (512, 512), (230, 190, 160))
    for k, col in (('hoodie', (232, 84, 52)), ('pants', (34, 58, 112)), ('shoes', (245, 245, 242)), ('soles', (44, 196, 180))):
        prev.paste(col, mask=m[k])
    prev.save(os.path.join(os.path.dirname(HERE), 'artifacts', 'uv-outfit-masks.png'))
