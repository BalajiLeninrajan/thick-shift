# Helpers for the Big Biggs build: shape making, fur, UVs, baking and texture
# painting. build.py holds the design; this file holds the method.
#
# The method, in order:
#   1. Shapes are overlapping ellipsoids and tubes, fused by a voxel remesh and
#      smoothed, so masses flow into each other the way stuffed cloth does.
#   2. Fur clumps are pushed into the dense mesh with noise, then the mesh is
#      decimated to budget. Tufts and strands are added as real geometry
#      afterwards so they survive in the silhouette.
#   3. Every face carries a class (fur, tooth, gut ...) as a material slot.
#   4. All parts share one UV atlas. Position, normal and class are drawn
#      into it from the triangles; Cycles bakes ambient occlusion.
#   5. The textures are painted with numpy from those four images: each texel
#      knows where it is in the world, so stains, seams and patches are placed
#      in metres on the model, not in UV space. The normal map is derived from
#      the painted height.
import bpy, bmesh, math, os, sys, tempfile, time
import numpy as np
from mathutils import Vector, Matrix, Euler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import *

# Face classes. The painter picks colour, roughness and relief by class.
# HFUR and JFUR are fur on the head and jaw: same fur, but the painter also
# applies the face (muzzle, mouth, blush), which is laid out in head space.
FUR, HAT, POM, TOOTH, EYE, DARK, GUM, SKIN, BONE, MEAT, GUT, STRAND, MASK, ZIP, GLOW, NAIL, BSTRAND, BALL, FLESH, HFUR, JFUR = range(1, 22)
_CLS = {}


_TUFTS = [0]      # tufts made so far in this scene: each gets its own cell in the atlas


def fresh():
    """Empty the scene and forget the class materials that went with it."""
    reset()
    _CLS.clear()
    _TUFTS[0] = 0


def cmat(cls):
    """The placeholder material that marks faces as class `cls`."""
    if cls not in _CLS:
        _CLS[cls] = bpy.data.materials.new(f'cls_{cls}')
    return _CLS[cls]


def setcls(ob, cls):
    ob.data.materials.clear()
    ob.data.materials.append(cmat(cls))
    return ob


def hexc(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)


def mixc(a, b, t):
    return np.asarray(a, dtype=np.float32) * (1 - t) + np.asarray(b, dtype=np.float32) * t


_T0 = time.time()


def log(*a):
    """Progress with a clock, flushed, so a slow step shows while it runs."""
    print(f'[{time.time() - _T0:6.1f}s]', *a, flush=True)


# ---------------------------------------------------------------- shapes

def mesh_obj(name, verts, faces, cls=FUR):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return setcls(ob, cls)


def ell(c, r, rot=(0, 0, 0), seg=24, cls=FUR):
    """Ellipsoid at c with radii r, rotated by rot (degrees, XYZ euler)."""
    if isinstance(r, (int, float)): r = (r, r, r)
    c, r = [float(v) for v in c], [float(v) for v in r]
    rings = seg // 2
    vs = [(0, 0, 1)]
    for i in range(1, rings):
        th = math.pi * i / rings
        for j in range(seg):
            ph = 2 * math.pi * j / seg
            vs.append((math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th)))
    vs.append((0, 0, -1))
    fs = []
    for j in range(seg): fs.append((0, 1 + j, 1 + (j + 1) % seg))
    for i in range(rings - 2):
        a, b = 1 + i * seg, 1 + (i + 1) * seg
        for j in range(seg): fs.append((a + j, b + j, b + (j + 1) % seg, a + (j + 1) % seg))
    last = len(vs) - 1; a = 1 + (rings - 2) * seg
    for j in range(seg): fs.append((last, a + (j + 1) % seg, a + j))
    M = Matrix.Translation(c) @ Euler([math.radians(a) for a in rot]).to_matrix().to_4x4() @ Matrix.Diagonal((*r, 1))
    return mesh_obj('ell', [M @ Vector(v) for v in vs], fs, cls)


def spline(pts, sub):
    """Catmull-Rom through pts, `sub` steps per span. Returns an (n, 3) array."""
    p = np.asarray(pts, dtype=np.float64)
    if sub <= 1 or len(p) < 3: return p
    q = np.vstack([2 * p[0] - p[1], p, 2 * p[-1] - p[-2]])
    out = []
    for i in range(len(p) - 1):
        p0, p1, p2, p3 = q[i], q[i + 1], q[i + 2], q[i + 3]
        for s in range(sub):
            t = s / sub
            out.append(.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(p[-1])
    return np.array(out)


def tube(pts, radii, seg=10, sub=4, cls=FUR, caps=True, flat=None):
    """A round tube through pts with a radius per point (or one number),
    smoothed with a spline, with rounded ends. flat=(axis vector, factor)
    squashes the cross-section along an axis."""
    pts = np.asarray(pts, dtype=np.float64)
    if isinstance(radii, (int, float)): radii = [radii] * len(pts)
    P = spline(pts, sub)
    R = spline(np.asarray(radii, dtype=np.float64).reshape(-1, 1), sub)[:, 0]
    T = np.gradient(P, axis=0); T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-12
    if caps:   # two extra rings at each end round it off
        P = np.vstack([P[0] - T[0] * R[0] * .9, P[0] - T[0] * R[0] * .55, P, P[-1] + T[-1] * R[-1] * .55, P[-1] + T[-1] * R[-1] * .9])
        R = np.concatenate([[R[0] * .35, R[0] * .8], R, [R[-1] * .8, R[-1] * .35]])
        T = np.vstack([T[0], T[0], T, T[-1], T[-1]])
    # parallel transport a frame along the path so the tube does not twist
    n = np.cross(T[0], (0, 0, 1) if abs(T[0][2]) < .9 else (1, 0, 0)); n /= np.linalg.norm(n)
    vs, fs = [], []
    for i in range(len(P)):
        n = n - T[i] * np.dot(n, T[i]); n /= np.linalg.norm(n) + 1e-12
        b = np.cross(T[i], n)
        for j in range(seg):
            a = 2 * math.pi * j / seg
            off = (n * math.cos(a) + b * math.sin(a)) * R[i]
            if flat is not None:
                ax = np.asarray(flat[0], dtype=np.float64); ax /= np.linalg.norm(ax)
                off = off - ax * np.dot(off, ax) * (1 - flat[1])
            vs.append(P[i] + off)
    for i in range(len(P) - 1):
        for j in range(seg):
            a, b2 = i * seg + j, i * seg + (j + 1) % seg
            fs.append((a, b2, b2 + seg, a + seg))
    vs.append(P[0]); vs.append(P[-1])
    e0, e1 = len(vs) - 2, len(vs) - 1
    for j in range(seg):
        fs.append((e0, (j + 1) % seg, j))
        fs.append((e1, (len(P) - 1) * seg + j, (len(P) - 1) * seg + (j + 1) % seg))
    return mesh_obj('tube', vs, fs, cls)


def box(c, size, rot=(0, 0, 0), cls=TOOTH, bevel=.3, segs=2):
    """A rounded box: used for teeth."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=min(size) * bevel, segments=segs, affect='EDGES', profile=.5)
    me = bpy.data.meshes.new('box'); bm.to_mesh(me); bm.free()
    me.transform(Matrix.Translation([float(v) for v in c]) @ Euler([math.radians(a) for a in rot]).to_matrix().to_4x4() @ Matrix.Diagonal((*[float(v) for v in size], 1)))
    ob = bpy.data.objects.new('box', me); bpy.context.scene.collection.objects.link(ob)
    return setcls(ob, cls)


def select(objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def join(objs, name='joined'):
    objs = [o for o in objs if o is not None]
    if len(objs) > 1:
        select(objs)
        bpy.ops.object.join()
    ob = objs[0]
    ob.name = name
    return ob


def freeze(ob):
    """Apply the modifier stack."""
    dg = bpy.context.evaluated_depsgraph_get(); dg.update()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.modifiers.clear(); ob.data = me
    bpy.data.meshes.remove(old)
    return ob


def fuse(objs, voxel=.02, smooth=6, cls=FUR, name='mass'):
    """Join closed shapes and melt them into one skin."""
    ob = join(objs, name)
    m = ob.modifiers.new('r', 'REMESH'); m.mode = 'VOXEL'; m.voxel_size = voxel; m.adaptivity = 0
    if smooth:
        s = ob.modifiers.new('s', 'SMOOTH'); s.factor = .5; s.iterations = smooth
    freeze(ob)
    return setcls(ob, cls)


def cut(ob, cutter, keep=False):
    """Boolean difference. The cut faces take the cutter's class."""
    m = ob.modifiers.new('b', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = cutter; m.solver = 'EXACT'; m.material_mode = 'TRANSFER'
    freeze(ob)
    if not keep: bpy.data.objects.remove(cutter)
    return ob


def decimate(ob, tris_target):
    n = tris([ob])
    if n > tris_target:
        m = ob.modifiers.new('d', 'DECIMATE'); m.ratio = tris_target / n
        freeze(ob)
    return ob


def co(ob):
    a = np.empty(len(ob.data.vertices) * 3, dtype=np.float32)
    ob.data.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


def setco(ob, a):
    ob.data.vertices.foreach_set('co', np.ascontiguousarray(a, dtype=np.float32).ravel())
    ob.data.update()


def vnormals(ob):
    a = np.empty(len(ob.data.vertices) * 3, dtype=np.float32)
    ob.data.vertices.foreach_get('normal', a)
    return a.reshape(-1, 3)


def smooth_shade(ob):
    ob.data.polygons.foreach_set('use_smooth', np.ones(len(ob.data.polygons), dtype=bool))
    ob.data.update()


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a + 1e-12), 0, 1)
    return t * t * (3 - 2 * t)


def dent(ob, c, r, depth, axis=(0, 1, 0)):
    """Push the surface in around c: sockets, nostrils, navels. r may be a
    triple for an oval dent."""
    P = co(ob); r = np.broadcast_to(np.asarray(r, dtype=np.float32), (3,))
    d = np.linalg.norm((P - np.asarray(c, dtype=np.float32)) / r, axis=1)
    P += np.asarray(axis, dtype=np.float32) * (depth * sstep(1, 0, d))[:, None]
    setco(ob, P)


def shag(ob, amp, scale=7, seed=1, mask=None, droop=.5, stretch=3.0):
    """Clumped fur as real relief: noise stretched down the body so the lumps
    hang like matted locks, pushed out along the normal and pulled a little
    toward the floor."""
    P, N = co(ob), vnormals(ob)
    f = fbm(P * np.array([scale, scale, scale / stretch], dtype=np.float32), 4, seed)
    f = np.clip((f - .42) * 2.2, -.6, 1.2)
    w = amp * f * (1 if mask is None else mask(P))
    P = P + N * w[:, None]
    P[:, 2] -= np.abs(w) * droop
    setco(ob, P)


def floor_clip(ob, z=0.0):
    P = co(ob); P[:, 2] = np.maximum(P[:, 2], z); setco(ob, P)


def surface_points(ob, n, rng, where=None):
    """n random points on the surface with their normals, area weighted."""
    me = ob.data; me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    vi = np.empty(nt * 3, dtype=np.int32); me.loop_triangles.foreach_get('vertices', vi); vi = vi.reshape(-1, 3)
    ar = np.empty(nt, dtype=np.float32); me.loop_triangles.foreach_get('area', ar)
    P, N = co(ob), vnormals(ob)
    pick = rng.choice(nt, size=n * 4, p=ar / ar.sum())
    u, v = rng.random(n * 4), rng.random(n * 4)
    flip = u + v > 1; u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    w = np.stack([1 - u - v, u, v], axis=1)[:, :, None]
    pts = (P[vi[pick]] * w).sum(axis=1); nrm = (N[vi[pick]] * w).sum(axis=1)
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9
    if where is not None:
        keep = rng.random(len(pts)) < where(pts, nrm)
        pts, nrm = pts[keep], nrm[keep]
    return pts[:n], nrm[:n]


def tufts(ob, n, length, width, seed, where=None, droop=.55, cls=FUR, jitter=.35, segs=2):
    """Fur tufts as geometry: three-sided curved spikes rooted just under the
    surface, leaning from the normal toward the floor. These are what break
    up the silhouette. Returns a new object to join into the part."""
    rng = np.random.default_rng(seed)
    pts, nrm = surface_points(ob, n, rng, where)
    vs, fs, tuv = [], [], []
    for p, nn in zip(pts, nrm):
        L = length * (.45 + rng.random() * .9); w = width * (.6 + rng.random() * .8)
        d = nn * (1 - droop) + np.array([0, 0, -1.0]) * droop + (rng.random(3) - .5) * jitter
        d /= np.linalg.norm(d)
        side = np.cross(d, nn + (rng.random(3) - .5) * .2)
        side = side / (np.linalg.norm(side) + 1e-9); up = np.cross(side, d)
        base = len(vs)
        for s in range(segs):
            t = s / segs
            # each ring sags further: hair hangs
            centre = p - nn * .012 + d * L * t + np.array([0, 0, -1.0]) * L * .35 * t * t
            rr = w * (1 - t * .55)
            for k in range(3):
                a = k * 2.094 + s * .5
                vs.append(centre + (side * math.cos(a) * 1.6 + up * math.sin(a) * .6) * rr)
                tuv.append((.15 + .35 * k, t))
        vs.append(p + d * L + np.array([0, 0, -1.0]) * L * .35)
        tuv.append((.5, 1))
        tip = len(vs) - 1
        for s in range(segs - 1):
            for k in range(3):
                a0, a1 = base + s * 3 + k, base + s * 3 + (k + 1) % 3
                fs.append((a0, a1, a1 + 3, a0 + 3))
        top = base + (segs - 1) * 3
        for k in range(3): fs.append((top + k, top + (k + 1) % 3, tip))
    ob = mesh_obj('tufts', vs, fs, cls)
    # Thousands of spikes would shred the atlas into islands that are mostly margin. Each tuft
    # instead carries its own number and a root-to-tip UV, and unwrap() gives it one small cell.
    me = ob.data
    per = (segs - 1) * 3 + 3                                   # faces per tuft
    ids = _TUFTS[0] + 1 + np.arange(len(me.polygons)) // per
    _TUFTS[0] += len(pts)
    me.attributes.new('tuft_id', 'INT', 'FACE').data.foreach_set('value', ids.astype(np.int32))
    lv = np.empty(len(me.loops), dtype=np.int32); me.loops.foreach_get('vertex_index', lv)
    # a 3-vector, not FLOAT2: Blender treats every FLOAT2 corner attribute as a UV map, and unwrap() clears those
    t3 = np.zeros((len(lv), 3), dtype=np.float32); t3[:, :2] = np.array(tuv, dtype=np.float32).reshape(-1, 2)[lv]
    me.attributes.new('tuft_uv', 'FLOAT_VECTOR', 'CORNER').data.foreach_set('vector', t3.ravel())
    return ob


# ---------------------------------------------------------------- noise

_LATTICE = np.random.default_rng(20261116).random(64 ** 3, dtype=np.float32)


def vnoise(p, seed=0):
    """3D value noise in 0..1 at the points p (n, 3). Random values on a
    64-cell lattice that repeats; the seed shifts the lattice. A table lookup
    is several times faster here than hashing, and the painter calls this for
    millions of texels."""
    p = np.asarray(p, dtype=np.float32)
    fl = np.floor(p)
    f = p - fl
    u = f * f * (3 - 2 * f)
    i0 = (fl.astype(np.int32) + np.array([seed * 73 + 11, seed * 151 + 29, seed * 199 + 5], dtype=np.int32)) & 63
    i1 = (i0 + 1) & 63
    x0, x1, y0, y1, z0, z1 = i0[:, 0] << 12, i1[:, 0] << 12, i0[:, 1] << 6, i1[:, 1] << 6, i0[:, 2], i1[:, 2]
    L = _LATTICE
    uz = u[:, 2]
    a = L[x0 + y0 + z0]; a += (L[x0 + y0 + z1] - a) * uz
    b = L[x0 + y1 + z0]; b += (L[x0 + y1 + z1] - b) * uz
    c = L[x1 + y0 + z0]; c += (L[x1 + y0 + z1] - c) * uz
    d = L[x1 + y1 + z0]; d += (L[x1 + y1 + z1] - d) * uz
    a += (b - a) * u[:, 1]; c += (d - c) * u[:, 1]
    a += (c - a) * u[:, 0]
    return a


def fbm(p, octaves=4, seed=0, gain=.5):
    p = np.asarray(p, dtype=np.float32)
    out = np.zeros(len(p), dtype=np.float32); a = 1.0; tot = 0.0
    for o in range(octaves):
        out += a * vnoise(p * (2 ** o) + o * 17.3, seed + o * 101)
        tot += a; a *= gain
    return out / tot


def ellmask(P, c, r, soft=.15, wob=0, seed=0, freq=8):
    """1 inside the ellipsoid, 0 outside, with a soft edge that noise can make ragged."""
    e = np.linalg.norm((P - np.asarray(c, dtype=np.float32)) / np.asarray(r, dtype=np.float32), axis=1)
    if wob: e = e + (fbm(P * freq, 3, seed) - .5) * wob
    return sstep(1 + soft, 1 - soft, e)


# ---------------------------------------------------------------- atlas, bake, paint

class Tex:
    """What the painter knows about each covered texel, and what it writes.
    P position, N normal (both Blender world axes, metres), cls class id,
    ao occlusion. Outputs: col (sRGB 0..1), rough, h (relief in metres)."""
    def __init__(self, P, N, cls, ao):
        self.P, self.N, self.cls, self.ao = P, N, cls, ao
        n = len(P)
        self.col = np.full((n, 3), .5, dtype=np.float32)
        self.rough = np.full(n, .9, dtype=np.float32)
        self.h = np.zeros(n, dtype=np.float32)

    def sub(self, m):
        """The texels where m is set, as their own Tex. Paint it, then merge() it back."""
        idx = np.nonzero(m)[0]
        t = Tex(self.P[idx], self.N[idx], self.cls[idx], self.ao[idx])
        t.col, t.rough, t.h, t.idx = self.col[idx], self.rough[idx], self.h[idx], idx
        return t

    def merge(self, t):
        self.col[t.idx], self.rough[t.idx], self.h[t.idx] = t.col, t.rough, t.h

    def put(self, m, col=None, rough=None, h=None):
        """Blend values in where the mask m (0..1 or bool, full length) is set."""
        m = np.asarray(m, dtype=np.float32)
        if col is not None: self.col += (np.asarray(col, dtype=np.float32) - self.col) * m[:, None]
        if rough is not None: self.rough += (rough - self.rough) * m
        if h is not None: self.h += h * m


TUFT_COLS, TUFT_ROW = 256, 24 / 2048      # tuft cells: 8 x 24 texels of a 2048 atlas


def _tuft_ids(o):
    a = o.data.attributes.get('tuft_id')
    ids = np.zeros(len(o.data.polygons), dtype=np.int32)
    if a is not None: a.data.foreach_get('value', ids)
    return ids


def unwrap(objs, dense=()):
    """One atlas for every part. Objects in `dense` get more texels per
    metre (pairs of object, factor): faces deserve it, soles do not. Tufts
    are kept out of the packing and laid in a strip of cells along the bottom."""
    for o in objs:
        while o.data.uv_layers: o.data.uv_layers.remove(o.data.uv_layers[0])
        o.data.uv_layers.new(name='uv')
        o.data.polygons.foreach_set('hide', _tuft_ids(o) > 0)       # hidden faces are left alone by the UV operators
    select(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(70), island_margin=0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for o, k in dense:
        uv = o.data.uv_layers.active.data
        a = np.empty(len(uv) * 2, dtype=np.float32); uv.foreach_get('uv', a); uv.foreach_set('uv', a * k)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, margin=.002, scale=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    strip = math.ceil(_TUFTS[0] / TUFT_COLS) * TUFT_ROW
    for o in objs:
        me = o.data
        ids = _tuft_ids(o)
        me.polygons.foreach_set('hide', np.zeros(len(ids), dtype=bool))
        lt = np.empty(len(ids), dtype=np.int32); me.polygons.foreach_get('loop_total', lt)
        lid = np.repeat(ids, lt)                                    # tuft number of every corner
        uv = np.empty(len(me.loops) * 2, dtype=np.float32); me.uv_layers.active.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
        uv[:, 1] = strip + uv[:, 1] * (1 - strip)                   # everything else moves up above the strip
        if (lid > 0).any():
            t = np.empty(len(me.loops) * 3, dtype=np.float32); me.attributes['tuft_uv'].data.foreach_get('vector', t); t = t.reshape(-1, 3)
            cell = lid - 1
            tu = ((cell % TUFT_COLS) + .125 + t[:, 0] * .75) / TUFT_COLS
            tv = ((cell // TUFT_COLS) + .06 + t[:, 1] * .88) * TUFT_ROW
            uv[lid > 0] = np.stack([tu, tv], axis=1)[lid > 0]
        me.uv_layers.active.data.foreach_set('uv', uv.ravel())


def raster(uv, attrs, W):
    """Fill a W x W image from triangles: uv (t, 3, 2) in 0..1, attrs
    (t, 3, k) values at the corners, interpolated. Returns the image and its
    coverage. Row 0 is v = 0, as Blender stores images. Triangles are handled
    in batches by size so the work stays in numpy."""
    px = uv.astype(np.float64) * W - .5                       # texel centres sit on whole numbers
    lo = np.floor(px.min(axis=1)).astype(np.int64); hi = np.ceil(px.max(axis=1)).astype(np.int64)
    span = (hi - lo + 1).max(axis=1)
    k = attrs.shape[2]
    out = np.zeros((W, W, k), dtype=np.float32); cov = np.zeros((W, W), dtype=bool)
    x, y = px[:, :, 0], px[:, :, 1]
    den = (y[:, 1] - y[:, 2]) * (x[:, 0] - x[:, 2]) + (x[:, 2] - x[:, 1]) * (y[:, 0] - y[:, 2])
    S, prev = 2, 0
    while prev < span.max():
        pick = np.nonzero((span > prev) & (span <= S) & (np.abs(den) > 1e-12))[0]
        step = max(1, 1500000 // (S * S))
        ar = np.arange(S)
        for i in range(0, len(pick), step):
            t = pick[i:i + step]
            gx = lo[t, 0][:, None, None] + ar[None, None, :]; gy = lo[t, 1][:, None, None] + ar[None, :, None]
            x2, y2 = x[t, 2][:, None, None], y[t, 2][:, None, None]
            w0 = ((y[t, 1] - y[t, 2])[:, None, None] * (gx - x2) + (x[t, 2] - x[t, 1])[:, None, None] * (gy - y2)) / den[t][:, None, None]
            w1 = ((y[t, 2] - y[t, 0])[:, None, None] * (gx - x2) + (x[t, 0] - x[t, 2])[:, None, None] * (gy - y2)) / den[t][:, None, None]
            w2 = 1 - w0 - w1
            e = -1e-3
            ti, yi, xi = np.nonzero((w0 >= e) & (w1 >= e) & (w2 >= e) & (gx >= 0) & (gx < W) & (gy >= 0) & (gy < W))
            ax, ay = lo[t[ti], 0] + xi, lo[t[ti], 1] + yi
            a = attrs[t[ti]]
            out[ay, ax] = (a[:, 0] * w0[ti, yi, xi][:, None] + a[:, 1] * w1[ti, yi, xi][:, None] + a[:, 2] * w2[ti, yi, xi][:, None]).astype(np.float32)
            cov[ay, ax] = True
        prev, S = S, S * 2
    return out, cov


def dilate(img, cov, rounds):
    """Copy covered texels outward into the gaps, one texel per round. This is
    the margin round each UV island that filtering and mip-maps read from."""
    img, cov = img.copy(), cov.copy()
    for _ in range(rounds):
        for ax in (0, 1):
            for s in (-1, 1):
                src = np.roll(cov, s, ax)
                new = src & ~cov
                if new.any():
                    img[new] = np.roll(img, s, ax)[new]; cov |= new
    return img, cov


def bake_maps(objs, W=2048, ao_samples=10):
    """What the painter needs to know about every texel of the shared atlas:
    position, normal and class, drawn straight from the triangles, and
    ambient occlusion, which is the one thing Cycles is asked for.
    Arrays are (W, W, ...) with row 0 at v = 0."""
    uvs, attrs, restore = [], [], []
    for o in objs:
        me = o.data; me.calc_loop_triangles()
        nt = len(me.loop_triangles)
        loops = np.empty(nt * 3, dtype=np.int32); me.loop_triangles.foreach_get('loops', loops)
        verts = np.empty(nt * 3, dtype=np.int32); me.loop_triangles.foreach_get('vertices', verts)
        poly = np.empty(nt, dtype=np.int32); me.loop_triangles.foreach_get('polygon_index', poly)
        uv = np.empty(len(me.loops) * 2, dtype=np.float32); me.uv_layers.active.data.foreach_get('uv', uv)
        ids = np.array([int(m.name.split('_')[1].split('.')[0]) for m in me.materials], dtype=np.int32)
        mi = np.empty(len(me.polygons), dtype=np.int32); me.polygons.foreach_get('material_index', mi)
        cls = ids[mi]
        a = np.concatenate([co(o)[verts], vnormals(o)[verts], np.repeat(cls[poly], 3)[:, None].astype(np.float32)], axis=1)
        uvs.append(uv.reshape(-1, 2)[loops].reshape(nt, 3, 2)); attrs.append(a.reshape(nt, 3, 7))
        restore.append((o, cls))
    img, cov = raster(np.concatenate(uvs), np.concatenate(attrs), W)
    img, grown = dilate(img, cov, 10)
    log('rastered', int(cov.sum()), 'texels')

    # AO: bake onto one joined copy with a plain material. A bake job per object costs far more than the pixels do.
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.use_denoising = False; sc.cycles.samples = ao_samples
    if sc.world is None: sc.world = bpy.data.worlds.new('w')
    sc.world.light_settings.distance = .45   # AO reach: creases and armpits, not the whole room
    bm = bpy.data.materials.new('bake')
    tex = bm.node_tree.nodes.new('ShaderNodeTexImage')
    aoimg = bpy.data.images.new('bake_ao', W, W, alpha=False, float_buffer=True, is_data=True)
    aoimg.pixels.foreach_set(np.ones(W * W * 4, dtype=np.float32))
    tex.image = aoimg; bm.node_tree.nodes.active = tex
    copies = []
    for o in objs:
        c = o.copy(); c.data = o.data.copy(); sc.collection.objects.link(c); copies.append(c)
        c.data.materials.clear(); c.data.materials.append(bm)
        c.data.polygons.foreach_set('material_index', np.zeros(len(c.data.polygons), dtype=np.int32))
    target = join(copies, 'bake_target')
    select([target])
    bpy.ops.object.bake(type='AO', margin=10, use_clear=False)
    ao = np.empty(W * W * 4, dtype=np.float32); aoimg.pixels.foreach_get(ao)
    bpy.data.objects.remove(target); bpy.data.images.remove(aoimg)
    log('baked ao')
    return dict(P=img[..., :3], N=img[..., 3:6], cls=np.where(grown, np.rint(img[..., 6]), 0).astype(np.int32), ao=ao.reshape(W, W, 4)[..., 0], restore=restore)


def normal_from_height(H, P, valid, strength=1.0):
    """Tangent-space normal map from a height image, both in metres.
    Slopes are height differences over the real distance between neighbouring
    texels, which the position image gives us, so relief has the same depth
    everywhere on the model whatever the island's scale. Differences across
    island borders are dropped."""
    def grad(axis):
        dh = np.roll(H, -1, axis) - np.roll(H, 1, axis)
        dp = np.linalg.norm(np.roll(P, -1, axis) - np.roll(P, 1, axis), axis=2)
        ok = valid & np.roll(valid, -1, axis) & np.roll(valid, 1, axis) & (dp > 1e-5) & (dp < .03)
        return np.where(ok, dh / np.maximum(dp, 1e-5), 0)
    gu, gv = np.clip(grad(1) * strength, -3, 3), np.clip(grad(0) * strength, -3, 3)
    n = np.stack([-gu, -gv, np.ones_like(gu)], axis=2)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * .5 + .5


def _save(name, arr, tmp, srgb):
    h, w = arr.shape[:2]
    if arr.ndim == 2: arr = np.repeat(arr[:, :, None], 3, axis=2)
    rgba = np.concatenate([np.clip(arr, 0, 1), np.ones((h, w, 1), dtype=np.float32)], axis=2).astype(np.float32)
    img = bpy.data.images.new(name, w, h, alpha=False)
    if not srgb: img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = os.path.join(tmp, name + '.png'); img.file_format = 'PNG'; img.save()
    return img


def _fill(img2d, valid, rounds=6):
    """Spread colour from covered texels into the gaps so mip-maps do not
    pull grey in at island edges."""
    out, ok = img2d.copy(), valid.copy()
    for _ in range(rounds):
        acc = np.zeros_like(out); cnt = np.zeros(ok.shape, dtype=np.float32)
        for ax in (0, 1):
            for s in (-1, 1):
                acc += np.roll(out * ok[..., None], s, ax); cnt += np.roll(ok, s, ax)
        new = (~ok) & (cnt > 0)
        out[new] = acc[new] / cnt[new][:, None]; ok = ok | new
    return out


def texture(objs, key, paint, W=2048, dense=(), glow_colour=(.9, .88, .8), normal_strength=1.0, small=1024):
    """Unwrap, bake, paint and assign the final materials. `paint(T)` fills a
    Tex. After this every object has the baked material (and `eye_glow` on
    its GLOW faces) and is ready for part() and export."""
    log('unwrap', tris(objs), 'triangles')
    unwrap(objs, dense)
    log('bake')
    maps = bake_maps(objs, W)
    valid = maps['cls'] > 0
    idx = np.nonzero(valid)
    N = maps['N'][idx]; N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-9
    Pa, Na, Ca, Aa = maps['P'][idx].astype(np.float32), N.astype(np.float32), maps['cls'][idx], np.clip(maps['ao'][idx], 0, 1)
    log(f'paint {len(Pa)} texels, {100 * len(Pa) / W / W:.0f}% of the atlas')
    # The painter is a pure function of each texel, so it runs in slices to keep memory flat.
    T = Tex(Pa[:0], Na[:0], Ca[:0], Aa[:0]); outs = []
    step = 300000
    for i in range(0, len(Pa), step):
        t = Tex(Pa[i:i + step], Na[i:i + step], Ca[i:i + step], Aa[i:i + step])
        paint(t); outs.append((t.col, t.rough, t.h))
    T.col, T.rough, T.h = (np.concatenate([o[k] for o in outs]) for k in range(3))
    log('painted')
    col = np.full((W, W, 3), .3, dtype=np.float32); col[idx] = T.col
    rough = np.full((W, W, 1), .9, dtype=np.float32); rough[idx] = T.rough[:, None]
    H = np.zeros((W, W), dtype=np.float32); H[idx] = T.h
    nrm = normal_from_height(H, maps['P'], valid, normal_strength)
    col = _fill(col, valid); rough = _fill(rough, valid)
    k = W // small
    def down(a): return a.reshape(small, k, small, k, -1).mean(axis=(1, 3))
    tmp = tempfile.mkdtemp(prefix='hippo_tex_')
    i_col = _save(key + '_col', col, tmp, True)
    i_nrm = _save(key + '_nrm', nrm, tmp, False)
    i_rgh = _save(key + '_orm', down(rough)[..., 0], tmp, False)

    mat = bpy.data.materials.new(key)
    nt = mat.node_tree; bsdf = next(n for n in nt.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled')
    tc = nt.nodes.new('ShaderNodeTexImage'); tc.image = i_col
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = i_nrm
    tr = nt.nodes.new('ShaderNodeTexImage'); tr.image = i_rgh
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tr.outputs['Color'], bsdf.inputs['Roughness'])
    nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Metallic'].default_value = 0

    glow = bpy.data.materials.new('eye_glow')
    gt = glow.node_tree; gb = next(n for n in gt.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled')
    gb.inputs['Base Color'].default_value = (*glow_colour, 1)
    gb.inputs['Emission Color'].default_value = (*glow_colour, 1); gb.inputs['Emission Strength'].default_value = 4

    for o, cls in maps['restore']:
        me = o.data
        me.materials.clear(); me.materials.append(mat)
        if (cls == GLOW).any():
            me.materials.append(glow)
            me.polygons.foreach_set('material_index', (cls == GLOW).astype(np.int32))
        smooth_shade(o)
    return mat
