#!/usr/bin/env python3
# Shrinks every texture inside a GLB that is over 1024 px on its longer side, in place, except
# the few named in KEEP below.
#
#   python3 tools/models/cap_textures.py file.glb ...            (needs numpy and Pillow; written against Pillow 11.3)
#   python3 tools/models/cap_textures.py --check file.glb ...    changes nothing, exits 1 if it would shrink anything
#
# common.export_glb runs this on every file it writes, so a rebuild keeps the cap. Blender's own
# Python has no Pillow, which is why this is a separate script run by the system python3.
#
# A 2048 px map costs the GPU 21 MiB once decoded with its mips, and a 1024 px one a quarter of that.
# The cap is there for that memory, and it is not free. Most of the time the game draws these maps
# well below 1024 px, but the catch close-up puts a face across the whole 1280 px frame, and there a
# halved map is softer. KEEP below lists the maps where that showed.
#
# Only image bytes are rewritten. Every other bufferView, the Draco geometry among them, is copied
# byte for byte, so no vertex can move, and the JSON changes only in the offsets and lengths of the
# bufferViews and the buffer. A file with nothing over the cap is left untouched.
import argparse, io, json, os, struct, sys

import numpy as np
from PIL import Image, JpegImagePlugin

MAX = 1024
# Images left at their size, by file and image name. Each one costs 16 MiB more than it would capped.
#
# props_a's decal atlas packs the small print a player reads from arm's length: the memo and the form
# on the desk and the pin board, the logbook, the plates. Halved, the memo's body text is about 6 px
# tall and no longer reads. The guard carries the same atlas, but only its badge and patches, which
# look the same at 1024.
#
# The three colour maps are faces that lost detail in the catch close-up. Stompy's stage 1 horn fills
# a third of that frame and its dark streaks smeared, and the hippo's muzzle lost its fur grain at
# stages 0 and 1. Their normal maps are capped: the grain is in the colour.
KEEP = {
    'props_a.glb': {'decals'},
    'rhino_1.glb': {'rhino_1_col'},
    'hippo_0.glb': {'hippo_0_col'},
    'hippo_1.glb': {'hippo_1_col'},
}
JSON, BIN = 0x4E4F534A, 0x004E4942
FORMATS = {'image/jpeg': 'JPEG', 'image/png': 'PNG'}


class Unsupported(Exception):
    pass


def read_glb(path):
    """The glTF JSON as a dict and the binary chunk of a GLB."""
    with open(path, 'rb') as f: data = f.read()
    magic, version, length = struct.unpack_from('<4sII', data)
    if magic != b'glTF' or version != 2 or length != len(data): raise Unsupported('not a GLB 2 file')
    chunks, at = [], 12
    while at < length:
        size, kind = struct.unpack_from('<II', data, at)
        chunks.append((kind, data[at + 8:at + 8 + size]))
        at += 8 + size
    if [k for k, _ in chunks] != [JSON, BIN]: raise Unsupported('expected one JSON and one BIN chunk')
    # The JSON chunk is padded to four bytes with spaces. Blender writes it compact, so dumping it the
    # same way gives the same bytes back, and everything this script does not touch stays as it was.
    doc = json.loads(chunks[0][1])
    if dump(doc) != chunks[0][1].rstrip(b' '): raise Unsupported('the JSON would not be written back as it was read')
    if len(doc.get('buffers', [])) != 1 or 'uri' in doc['buffers'][0]: raise Unsupported('expected one embedded buffer')
    return doc, chunks[1][1]


def dump(doc):
    return json.dumps(doc, separators=(',', ':')).encode()


def write_glb(path, doc, binary):
    pad = lambda b, fill: b + fill * (-len(b) % 4)
    js, binary = pad(dump(doc), b' '), pad(binary, b'\0')
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(binary)))
        f.write(struct.pack('<II', len(js), JSON) + js)
        f.write(struct.pack('<II', len(binary), BIN) + binary)


def colour_images(doc):
    """The indices of the images that hold sRGB colour: the ones a material uses as base colour or
    emission. Normal and occlusion/roughness/metal maps are numbers, not colour. The ICC profile is
    no guide here, because Blender tags the data maps sRGB too."""
    found = set()
    for m in doc.get('materials', []):
        for slot in (m.get('pbrMetallicRoughness', {}).get('baseColorTexture'), m.get('emissiveTexture')):
            if slot: found.add(doc['textures'][slot['index']]['source'])
    return found


# The sRGB transfer curve as a table for bytes, and its inverse for floats.
TO_LINEAR = np.array([c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in (i / 255 for i in range(256))], dtype=np.float32)

def to_srgb(lin):
    lin = np.clip(lin, 0, 1)
    return np.where(lin <= .0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - .055)


def shrink(im, size, colour):
    """`im` box-averaged down to `size`. For an exact halving that is the mean of each 2x2 block,
    which is the mip the GPU was already drawing from wherever the old map was minified, and a box
    cannot ring on decal text or a normal map. The GPU averages colour in linear light, so colour is
    averaged that way here too. Averaging the sRGB bytes would darken fine bright-on-dark detail.
    Alpha and data maps are plain numbers and are averaged as they are."""
    if im.mode == 'P': im = im.convert('RGBA')
    if im.mode not in ('L', 'LA', 'RGB', 'RGBA'): raise Unsupported(f'image mode {im.mode}')
    px = np.asarray(im).reshape(im.height, im.width, -1)
    alpha = px.shape[2] in (2, 4)
    out = []
    for c in range(px.shape[2]):
        linear = colour and not (alpha and c == px.shape[2] - 1)
        ch = TO_LINEAR[px[..., c]] if linear else px[..., c].astype(np.float32) / 255
        ch = np.asarray(Image.fromarray(ch).resize(size, Image.BOX))
        out.append(np.rint((to_srgb(ch) if linear else np.clip(ch, 0, 1)) * 255).astype(np.uint8))
    return Image.fromarray(np.dstack(out).squeeze())


def encode(im, src):
    """`im` in the format of `src`, the image it was shrunk from. A JPEG reuses the source's own
    quantization tables and chroma subsampling, so each file keeps the quality it was exported at."""
    buf = io.BytesIO()
    kw = dict(icc_profile=src.info.get('icc_profile'))
    if src.format == 'JPEG': kw.update(qtables=src.quantization, subsampling=JpegImagePlugin.get_sampling(src))
    else: kw.update(optimize=True)
    im.save(buf, src.format, **kw)
    return buf.getvalue()


def cap(path, check=False):
    """Shrink the oversized images of one GLB. Returns how many were (or, with `check`, would be) shrunk."""
    doc, binary = read_glb(path)
    views = doc.get('bufferViews', [])
    blobs = [binary[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in views]
    colour, done, keep = colour_images(doc), {}, KEEP.get(os.path.basename(path), ())
    for i, image in enumerate(doc.get('images', [])):
        if 'bufferView' not in image: raise Unsupported(f'image {image.get("name", i)} is not embedded')
        src = Image.open(io.BytesIO(blobs[image['bufferView']]))
        if max(src.size) <= MAX or image.get('name') in keep: continue
        if src.format != FORMATS.get(image.get('mimeType')): raise Unsupported(f'image {image.get("name", i)} is {src.format}, declared {image.get("mimeType")}')
        if image['bufferView'] in done: raise Unsupported('two images share a bufferView')
        k = MAX / max(src.size)
        size = tuple(max(1, round(s * k)) for s in src.size)
        print(f'[cap] {path} {image.get("name", i)} {src.size[0]}x{src.size[1]} -> {size[0]}x{size[1]}' + (' (over the cap)' if check else ''))
        done[image['bufferView']] = None if check else encode(shrink(src, size, i in colour), src)
    if check or not done: return len(done)
    # Lay the views out again in the order they were in, each on a four-byte boundary.
    out = bytearray()
    for i in sorted(range(len(views)), key=lambda i: views[i].get('byteOffset', 0)):
        out += b'\0' * (-len(out) % 4)
        blob = done.get(i, blobs[i])
        views[i]['byteOffset'], views[i]['byteLength'] = len(out), len(blob)
        out += blob
    out += b'\0' * (-len(out) % 4)
    doc['buffers'][0]['byteLength'] = len(out)
    write_glb(path, doc, bytes(out))
    return len(done)


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=f'Shrink the textures of GLB files to at most {MAX} px.')
    ap.add_argument('--check', action='store_true', help="change nothing; exit 1 if anything would be shrunk")
    ap.add_argument('files', nargs='+')
    args = ap.parse_args()
    try:
        over = sum(cap(f, args.check) for f in args.files)
    except Unsupported as e:
        sys.exit(f'cap_textures: {e}')
    sys.exit(1 if args.check and over else 0)
