"""Build the METRO RUSH runner asset from the CC0 Quaternius packs.

Inputs (asset-inbox/quaternius/x, extracted from the free [Standard] zips):
  - Universal Base Characters: Superhero_Male_FullBody.gltf (+.bin, textures)
  - Universal Animation Library 1 + 2: UAL1_Standard.glb, UAL2_Standard.glb

The base character and both libraries share the identical 65-joint skeleton
(verified by qa: same joint names; rest deltas are tiny), so clips bind
without retargeting.

Outputs (public/assets/c/runner/):
  - runner.glb       skinned body only, textures embedded and downsized,
                     with an original METRO RUSH outfit painted into the
                     body albedo (hoodie / joggers / sneakers by UV region)
  - runner-anims.glb only the 11 clips the game uses, extracted from both
                     libraries; skeleton nodes only (no mesh), so it is small

Run: designer python3 qa/build-runner.py
"""
import json, struct, io, os, sys, base64
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
X = os.path.join(ROOT, 'asset-inbox', 'quaternius', 'x')
BODY = os.path.join(X, 'Universal Base Characters[Standard]', 'Base Characters', 'Godot - UE')
UAL1 = os.path.join(X, 'Universal Animation Library[Standard]', 'Unreal-Godot', 'UAL1_Standard.glb')
UAL2 = os.path.join(X, 'Universal Animation Library 2[Standard]', 'Unreal-Godot', 'UAL2_Standard.glb')
OUT = os.path.join(ROOT, 'public', 'assets', 'c', 'runner')
os.makedirs(OUT, exist_ok=True)

# clip name in library -> name used in-game
CLIPS = {
    'UAL1': {'Idle_Loop': 'idle', 'Sprint_Loop': 'run', 'Jump_Start': 'jumpStart', 'Jump_Loop': 'jumpLoop',
             'Jump_Land': 'jumpLand', 'Hit_Chest': 'hit', 'Death01': 'death', 'Dance_Loop': 'celebrate'},
    'UAL2': {'Slide_Start': 'slideStart', 'Slide_Loop': 'slideLoop', 'Slide_Exit': 'slideExit',
             'Hit_Knockback': 'knockback'},
}


def read_glb(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'glTF'
    off = 12
    js = binc = None
    while off < len(b):
        ln, typ = struct.unpack('<II', b[off:off + 8])
        chunk = b[off + 8:off + 8 + ln]
        if typ == 0x4E4F534A: js = json.loads(chunk)
        elif typ == 0x004E4942: binc = chunk
        off += 8 + ln
    return js, binc


def write_glb(path, js, binbuf):
    pad = lambda x, c: x + c * ((4 - len(x) % 4) % 4)
    jb = pad(json.dumps(js, separators=(',', ':')).encode(), b' ')
    bb = pad(bytes(binbuf), b'\0')
    js['buffers'] = [{'byteLength': len(bb)}]
    jb = pad(json.dumps(js, separators=(',', ':')).encode(), b' ')
    total = 12 + 8 + len(jb) + 8 + len(bb)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A)); f.write(jb)
        f.write(struct.pack('<II', len(bb), 0x004E4942)); f.write(bb)
    return total


class Packer:
    """Re-packs selected bufferViews/accessors from a source into one new bin."""
    def __init__(self):
        self.bin = bytearray(); self.views = []; self.accessors = []

    def add_view(self, data, target=None):
        while len(self.bin) % 4: self.bin.append(0)
        v = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)}
        if target: v['target'] = target
        self.bin += data
        self.views.append(v)
        return len(self.views) - 1

    def copy_accessor(self, src_js, src_bin, ai):
        a = dict(src_js['accessors'][ai])
        bv = src_js['bufferViews'][a['bufferView']]
        comp = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}[a['componentType']]
        ncomp = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
        elem = comp * ncomp
        stride = bv.get('byteStride', elem)
        start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        if stride == elem:
            data = src_bin[start:start + elem * a['count']]
        else:
            data = b''.join(src_bin[start + i * stride:start + i * stride + elem] for i in range(a['count']))
        a['bufferView'] = self.add_view(data, bv.get('target'))
        a.pop('byteOffset', None)
        self.accessors.append(a)
        return len(self.accessors) - 1


def png_bytes(img, fmt='PNG', q=None):
    buf = io.BytesIO()
    if fmt == 'JPEG': img.convert('RGB').save(buf, 'JPEG', quality=q or 88)
    else: img.save(buf, 'PNG', optimize=True)
    return buf.getvalue()


def build_body():
    js = json.load(open(os.path.join(BODY, 'Superhero_Male_FullBody.gltf')))
    srcbin = open(os.path.join(BODY, 'Superhero_Male_FullBody.bin'), 'rb').read()
    P = Packer()
    out = {'asset': {'version': '2.0', 'generator': 'metro-rush build-runner.py (from Quaternius CC0)'},
           'scene': 0, 'scenes': js['scenes'], 'nodes': js['nodes'], 'skins': [], 'meshes': [],
           'materials': [], 'textures': [], 'images': [], 'samplers': [{'magFilter': 9729, 'minFilter': 9987}]}
    # skins
    for s in js['skins']:
        s = dict(s)
        if 'inverseBindMatrices' in s: s['inverseBindMatrices'] = P.copy_accessor(js, srcbin, s['inverseBindMatrices'])
        out['skins'].append(s)
    # meshes: keep only attributes three needs (POSITION, NORMAL, TEXCOORD_0, JOINTS_0, WEIGHTS_0)
    keep = ('POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0')
    for m in js['meshes']:
        prims = []
        for p in m['primitives']:
            np_ = {'attributes': {k: P.copy_accessor(js, srcbin, v) for k, v in p['attributes'].items() if k in keep},
                   'indices': P.copy_accessor(js, srcbin, p['indices']), 'material': p['material']}
            prims.append(np_)
        out['meshes'].append({'name': m['name'], 'primitives': prims})

    # textures: load originals referenced by images
    # the gltf references some normals as '*_png.png' while the pack ships
    # them as '*.png' — resolve by trying the referenced name, then the stem
    def resolve(uri):
        p = os.path.join(BODY, uri)
        if os.path.exists(p): return p
        alt = os.path.join(BODY, uri.replace('_png.png', '.png'))
        if os.path.exists(alt): return alt
        raise FileNotFoundError(f'runner texture missing: {uri} (also tried {os.path.basename(alt)})')
    imgs = {i: Image.open(resolve(im['uri'])) for i, im in enumerate(js['images'])}

    def add_image(img, fmt):
        data = png_bytes(img, fmt, 86)
        bv = P.add_view(data)
        out['images'].append({'bufferView': bv, 'mimeType': 'image/png' if fmt == 'PNG' else 'image/jpeg'})
        out['textures'].append({'sampler': 0, 'source': len(out['images']) - 1})
        return len(out['textures']) - 1

    tex_src = {t_i: t['source'] for t_i, t in enumerate(js['textures'])}
    for mat in js['materials']:
        m = json.loads(json.dumps(mat))
        pbr = m.get('pbrMetallicRoughness', {})
        if mat['name'] == 'MI_Superhero_Male':
            albedo = imgs[tex_src[pbr['baseColorTexture']['index']]].convert('RGB').resize((1024, 1024), Image.LANCZOS)
            albedo = paint_outfit(albedo)
            pbr['baseColorTexture'] = {'index': add_image(albedo, 'JPEG')}
            if 'metallicRoughnessTexture' in pbr:
                mr = imgs[tex_src[pbr['metallicRoughnessTexture']['index']]].convert('RGB').resize((512, 512), Image.LANCZOS)
                pbr['metallicRoughnessTexture'] = {'index': add_image(mr, 'JPEG')}
            if 'normalTexture' in m:
                n = imgs[tex_src[m['normalTexture']['index']]].convert('RGB').resize((1024, 1024), Image.LANCZOS)
                m['normalTexture'] = {'index': add_image(n, 'JPEG'), 'scale': m['normalTexture'].get('scale', 1)}
        else:
            if 'baseColorTexture' in pbr:
                img = imgs[tex_src[pbr['baseColorTexture']['index']]]
                img = img.convert('RGBA').resize((256, 256), Image.LANCZOS)
                pbr['baseColorTexture'] = {'index': add_image(img, 'PNG')}
            m.pop('normalTexture', None)
        pbr.pop('metallicRoughnessTexture', None) if mat['name'] != 'MI_Superhero_Male' else None
        m['pbrMetallicRoughness'] = pbr
        out['materials'].append(m)
    out['bufferViews'] = P.views
    out['accessors'] = P.accessors
    out['buffers'] = [{'byteLength': len(P.bin)}]
    size = write_glb(os.path.join(OUT, 'runner.glb'), out, P.bin)
    print('runner.glb', size, 'bytes')


def paint_outfit(img):
    """Paint an original METRO RUSH outfit over the base body albedo.

    UV islands were identified from the albedo itself: the base texture has a
    distinct dark 'underwear' tone (~RGB 60,65,72) marking the pelvis region.
    Clothing is applied by masking skin-toned texels per vertical UV band of
    the islands, keeping the face/hands/neck as skin. The masks are derived
    from the per-island layout measured by qa/uv-islands.py (see report).
    """
    from uvmasks import outfit_masks  # generated by qa/uv-islands.py
    W, H = img.size
    masks = outfit_masks(W, H)
    base = img.copy()
    # violet hoodie is chosen for contrast: the station palette is warm
    # cream/terracotta (hue 15-50) + teal/blue (175-205); violet (~258) is far
    # from both. Lime soles add a second readable accent at track level.
    colors = {'hoodie': (112, 72, 232), 'pants': (34, 38, 56),
              'shoes': (246, 246, 242), 'soles': (182, 240, 58)}
    for key, mask in masks.items():
        col = Image.new('RGB', (W, H), colors[key])
        # keep the original texture's shading (luminance) under the fabric tint
        lum = base.convert('L').point(lambda v: min(255, int(v * 1.35)))
        shaded = Image.composite(col, Image.new('RGB', (W, H), (0, 0, 0)), lum)
        tint = Image.blend(col, shaded, 0.35)
        img = Image.composite(tint, img, mask.filter(ImageFilter.GaussianBlur(1.2)))
    return img


def build_anims():
    P = Packer()
    out = {'asset': {'version': '2.0', 'generator': 'metro-rush build-runner.py (UAL1+UAL2 CC0 clips)'},
           'scene': 0, 'scenes': None, 'nodes': None, 'animations': []}
    for lib, path in (('UAL1', UAL1), ('UAL2', UAL2)):
        js, b = read_glb(path)
        if out['nodes'] is None:
            # keep skeleton node hierarchy only (strip mesh/skin refs)
            nodes = []
            for n in js['nodes']:
                n = {k: v for k, v in n.items() if k in ('name', 'children', 'translation', 'rotation', 'scale')}
                nodes.append(n)
            out['nodes'] = nodes
            out['scenes'] = [{'nodes': js['scenes'][0]['nodes']}]
            names1 = [n['name'] for n in js['nodes']]
        else:
            names2 = [n['name'] for n in js['nodes']]
            remap = {i: names1.index(nm) for i, nm in enumerate(names2) if nm in names1}
        for a in js['animations']:
            if a['name'] not in CLIPS[lib]: continue
            samplers = []
            for s in a['samplers']:
                samplers.append({'input': P.copy_accessor(js, b, s['input']), 'output': P.copy_accessor(js, b, s['output']),
                                 'interpolation': s.get('interpolation', 'LINEAR')})
            chans = []
            for c in a['channels']:
                node = c['target']['node']
                if lib == 'UAL2':
                    if node not in remap: continue
                    node = remap[node]
                # gameplay owns root motion: drop root translation
                if out['nodes'][node]['name'] == 'root' and c['target']['path'] == 'translation':
                    continue
                chans.append({'sampler': c['sampler'], 'target': {'node': node, 'path': c['target']['path']}})
            out['animations'].append({'name': CLIPS[lib][a['name']], 'samplers': samplers, 'channels': chans})
    out['bufferViews'] = P.views
    out['accessors'] = P.accessors
    size = write_glb(os.path.join(OUT, 'runner-anims.glb'), out, P.bin)
    print('runner-anims.glb', size, 'bytes', [a['name'] for a in out['animations']])


if __name__ == '__main__':
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    if 'anims' in sys.argv or len(sys.argv) == 1: build_anims()
    if 'body' in sys.argv or len(sys.argv) == 1: build_body()
