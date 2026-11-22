# Helpers for the Madame Flan build: form building, sculpting, vertex paint,
# fur geometry, and the bake that turns the procedural material into the
# textures the GLB carries. build.py holds the design itself.
import bpy, bmesh, math, time
import numpy as np
from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree
from common import select, smooth_shade, tris


_t = [time.time()]
def lap(label):
    """Print how long the step that just ended took."""
    now = time.time(); print('[time] %s %.1fs' % (label, now - _t[0]), flush=True); _t[0] = now


def srgb(h):
    """'#rrggbb' to linear RGB, which is what colour attributes store."""
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return np.array([((v + .055) / 1.055) ** 2.4 if v > .04045 else v / 12.92 for v in c])


# ---------------------------------------------------------------- meshes

def mesh_obj(name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def fix_normals(o):
    """Turn every face of a closed mesh to point outward."""
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(o.data); bm.free()
    return o


def from_bm(bm, name='m'):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def ell(c, r, rot=None, seg=20):
    """Ellipsoid at c with radii r (a number or three), rot in degrees."""
    if not hasattr(r, '__len__'): r = (r, r, r)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(6, seg // 2), radius=1)
    # create_uvsphere lists its faces in a different order on every run, and everything built on it would differ too
    bm.faces.sort(key=lambda f: sum(i * 4096 ** k for k, i in enumerate(sorted(v.index for v in f.verts))))
    M = Matrix.Translation(Vector(c))
    if rot: M = M @ Euler([math.radians(a) for a in rot]).to_matrix().to_4x4()
    bm.transform(M @ Matrix.Diagonal((*r, 1)))
    return from_bm(bm, 'ell')


def tube(pts, radii, sides=8, flat=1.0):
    """A closed tube through pts. radii: one per point. flat squashes the
    cross-section along one axis (for flippers and locks of hair)."""
    pts = [Vector(p) for p in pts]
    if not hasattr(radii, '__len__'): radii = [radii] * len(pts)
    t = (pts[1] - pts[0]).normalized()
    n = t.orthogonal().normalized()
    verts, faces = [], []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        n = (n - t * n.dot(t)).normalized()   # parallel transport, so the tube does not twist
        b = t.cross(n)
        for k in range(sides):
            a = math.tau * k / sides
            verts.append(p + (n * math.cos(a) + b * math.sin(a) * flat) * max(radii[i], 1e-4))
    for i in range(len(pts) - 1):
        for k in range(sides):
            a, b2 = i * sides + k, i * sides + (k + 1) % sides
            faces.append((a, b2, b2 + sides, a + sides))
    faces.append(tuple(range(sides))[::-1])
    faces.append(tuple(range((len(pts) - 1) * sides, len(pts) * sides)))
    return fix_normals(mesh_obj('tube', verts, faces))


def curve_pts(ctrl, n):
    """Catmull-Rom through the control points, n samples per span."""
    c = [Vector(p) for p in ctrl]
    c = [c[0] * 2 - c[1]] + c + [c[-1] * 2 - c[-2]]
    out = []
    for i in range(1, len(c) - 2):
        for k in range(n):
            u = k / n
            out.append(.5 * ((2 * c[i]) + (-c[i - 1] + c[i + 1]) * u + (2 * c[i - 1] - 5 * c[i] + 4 * c[i + 1] - c[i + 2]) * u * u
                             + (-c[i - 1] + 3 * c[i] - 3 * c[i + 1] + c[i + 2]) * u ** 3))
    out.append(c[-2])
    return out


def join(objs):
    objs = [o for o in objs if o is not None]
    if len(objs) > 1:
        select(objs)
        bpy.ops.object.join()
    return objs[0]


def mod(o, kind, **kw):
    m = o.modifiers.new(kind, kind)
    for k, v in kw.items(): setattr(m, k, v)
    select([o])
    bpy.ops.object.modifier_apply(modifier=m.name)
    return o


def coords(me):
    a = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


def normals(me):
    a = np.empty(len(me.vertices) * 3)
    me.vertex_normals.foreach_get('vector', a)
    return a.reshape(-1, 3)


# ---------------------------------------------------------------- noise

def vnoise(P, freq, seed=0):
    """Value noise in 0..1 for an (n, 3) array. Deterministic."""
    Q = np.asarray(P, dtype=np.float64) * freq + seed * 17.13
    i = np.floor(Q).astype(np.int64); f = Q - i; f = f * f * (3 - 2 * f)

    def h(ix, iy, iz):
        n = ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 144665
        n = (n ^ (n >> 13)) * 1274126177
        return ((n ^ (n >> 16)) & 0xffff) / 65535.0
    x, y, z = i[:, 0], i[:, 1], i[:, 2]
    fx, fy, fz = f[:, 0], f[:, 1], f[:, 2]
    def lerp(a, b, t): return a + (b - a) * t
    return lerp(lerp(lerp(h(x, y, z), h(x + 1, y, z), fx), lerp(h(x, y + 1, z), h(x + 1, y + 1, z), fx), fy),
                lerp(lerp(h(x, y, z + 1), h(x + 1, y, z + 1), fx), lerp(h(x, y + 1, z + 1), h(x + 1, y + 1, z + 1), fx), fy), fz)


def fbm(P, freq, seed=0, octaves=3):
    return sum(vnoise(P, freq * 2 ** k, seed + k) / 2 ** k for k in range(octaves)) / (2 - 2 ** (1 - octaves))


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- sculpt

def displace(o, lumps, seed=0):
    """Push vertices along their normals by noise. lumps: (amplitude in m,
    frequency per m, z stretch). A stretch below 1 gives lumps that are
    longer than wide, like hanging clumps of fur."""
    me = o.data
    P, N = coords(me), normals(me)
    d = np.zeros(len(P))
    for k, (amp, freq, zs) in enumerate(lumps):
        d += amp * (fbm(P * np.array([1, 1, zs]), freq, seed + k * 7, 2) - .5) * 2
    P += N * d[:, None]
    me.vertices.foreach_set('co', P.ravel()); me.update()


def sculpt(forms, voxel=.02, smooth=6, lumps=(), seed=0):
    """Fuse overlapping closed forms into one skin: voxel remesh, relax so the
    masses flow into each other, then lump the surface."""
    o = join(forms); lap(' join')
    mod(o, 'REMESH', mode='VOXEL', voxel_size=voxel); lap(' remesh')
    if smooth: mod(o, 'SMOOTH', factor=.5, iterations=smooth)
    lap(' smooth')
    if lumps: displace(o, lumps, seed)
    lap(' displace %d' % len(o.data.vertices))
    smooth_shade(o)
    return o


def decimate(o, target):
    n = tris([o])
    if n > target: mod(o, 'DECIMATE', ratio=target / n)
    smooth_shade(o)
    return o


def dent(o, centre, radius, depth, direction):
    """Sink a soft pit into the surface (eye sockets)."""
    me = o.data; P = coords(me)
    d = np.linalg.norm(P - np.array(centre), axis=1)
    w = 1 - sstep(0, radius, d)
    P += np.array(direction)[None, :] * (w * depth)[:, None]
    me.vertices.foreach_set('co', P.ravel()); me.update()


def boolean(o, cutter, op):
    """Cut o with cutter. Faces that come from the cutter keep material
    index 1, which is how the mouth lining is found afterwards."""
    for x in (o, cutter):
        while len(x.data.materials) < 2: x.data.materials.append(None)
    cutter.data.polygons.foreach_set('material_index', [1] * len(cutter.data.polygons))
    m = o.modifiers.new('b', 'BOOLEAN')
    m.operation = op; m.object = cutter; m.solver = 'EXACT'; m.material_mode = 'INDEX'
    select([o]); bpy.ops.object.modifier_apply(modifier=m.name)
    return o


def lining_mask(o):
    """1 for vertices on faces a boolean cutter made, else 0."""
    me = o.data
    m = np.zeros(len(me.vertices))
    for p in me.polygons:
        if p.material_index == 1:
            for v in p.vertices: m[v] = 1
    return m


def bvh(o):
    return BVHTree.FromObject(o, bpy.context.evaluated_depsgraph_get())


def hit(tree, origin, direction):
    """First point where a ray meets the surface, and the normal there."""
    loc, nor, _, _ = tree.ray_cast(Vector(origin), Vector(direction).normalized())
    return loc, nor


# ---------------------------------------------------------------- paint

def set_attr(me, name, rgb):
    a = me.color_attributes.get(name) or me.color_attributes.new(name, 'FLOAT_COLOR', 'POINT')
    n = len(me.vertices)
    rgba = np.ones((n, 4)); rgba[:, :3] = rgb
    a.data.foreach_set('color', rgba.ravel())


def get_attr(me, name):
    a = np.empty(len(me.vertices) * 4)
    me.color_attributes[name].data.foreach_get('color', a)
    return a.reshape(-1, 4)[:, :3]


def tint(o, col, prm):
    """One colour and one surface kind for a whole piece.
    prm = (fur, roughness, blood): fur 1 is plush pile, .5 is woven cloth,
    0 is smooth plastic or bone. blood 0..1 is how soaked it is."""
    set_attr(o.data, 'Col', np.asarray(col)[None, :])
    set_attr(o.data, 'Prm', np.asarray(prm)[None, :])
    smooth_shade(o)
    return o


def paint(o, fn):
    """fn(P, N) -> (col (n,3), prm (n,3)) for a sculpted piece."""
    col, prm = fn(coords(o.data), normals(o.data))
    set_attr(o.data, 'Col', col); set_attr(o.data, 'Prm', prm)
    return o


# ---------------------------------------------------------------- fur geometry

def tufts(src, n, seed, length=(.04, .08), width=.02, droop=.7, where=None, shade=1.0, lift=.35, tip=1.12):
    """Locks of fur as real geometry, so the outline is shaggy under a
    flashlight. Each lock is a flat two-sided leaf of three triangles that
    leaves the skin along the normal and bends over to hang. tip: colour of
    the tip against the root; above 1 is clean pile, below 1 greasy and matted. Grown only where the skin is fur, and
    coloured from the skin under it. Returns a mesh for the fibre material."""
    me = src.data
    me.calc_loop_triangles()
    P = coords(me); N = normals(me)
    col = get_attr(me, 'Col'); prm = get_attr(me, 'Prm')
    T = np.empty(len(me.loop_triangles) * 3, dtype=np.int32)
    me.loop_triangles.foreach_get('vertices', T); T = T.reshape(-1, 3)
    A = np.empty(len(me.loop_triangles)); me.loop_triangles.foreach_get('area', A)
    mid = P[T].mean(axis=1)
    w = A * (prm[T][:, :, 0].mean(axis=1) > .8)
    if where is not None: w = w * where(mid)
    if w.sum() <= 0 or n <= 0: return None
    rng = np.random.RandomState(seed)
    pick = rng.choice(len(T), size=n, p=w / w.sum())
    verts, faces, cols = [], [], []
    down = np.array([0, 0, -1.0])
    for t in pick:
        b = rng.dirichlet((1, 1, 1))
        p = (P[T[t]] * b[:, None]).sum(axis=0); nn = N[T[t]].mean(axis=0); nn /= np.linalg.norm(nn) + 1e-9
        c = (col[T[t]] * b[:, None]).sum(axis=0) * shade
        if prm[T[t]][:, 2].mean() > .45: c = np.array([.06, .006, .005]) * (.5 + rng.rand())   # soaked: near black
        L = rng.uniform(*length); wd = width * rng.uniform(.7, 1.3)
        out = nn * lift + down * droop + rng.normal(0, .25, 3); out /= np.linalg.norm(out)
        side = np.cross(out, nn + rng.normal(0, .3, 3)); side /= np.linalg.norm(side) + 1e-9
        p0 = p - nn * .012
        p1 = p0 + out * L * .55 + nn * L * .12
        p2 = p1 + (out * .5 + down * .5) * L * .45
        i0 = len(verts)
        verts += [p0 - side * wd, p0 + side * wd, p1 - side * wd * .7, p1 + side * wd * .7, p2]
        k0 = rng.uniform(.8, 1.2)
        cols += [c * .8 * k0] * 2 + [c * k0] * 2 + [c * tip * k0]
        faces += [(i0, i0 + 1, i0 + 3, i0 + 2), (i0 + 2, i0 + 3, i0 + 4)]
    verts = np.array(verts); verts[:, 2] = np.maximum(verts[:, 2], .004)   # locks on the feet lie on the floor, not through it
    o = mesh_obj('tufts', verts, faces)
    set_attr(o.data, 'Col', np.array(cols))
    smooth_shade(o)
    return o


def strand(pts, r0, r1, col, sides=3):
    """One hair, whisker or thread: a thin tapering tube for the fibre material."""
    n = len(pts)
    o = tube(pts, [r0 + (r1 - r0) * (i / (n - 1)) for i in range(n)], sides=sides)
    set_attr(o.data, 'Col', col)
    smooth_shade(o)
    return o


# ---------------------------------------------------------------- materials

class Nodes:
    """Just enough wrapper to write the bake material as expressions."""
    def __init__(self, mat):
        self.t = mat.node_tree; self.t.nodes.clear()

    def new(self, kind, **kw):
        n = self.t.nodes.new(kind)
        for k, v in kw.items(): setattr(n, k, v)
        return n

    def put(self, sock, v):
        if isinstance(v, bpy.types.NodeSocket): self.t.links.new(v, sock)
        elif hasattr(sock.default_value, '__len__'):
            v = tuple(v) if hasattr(v, '__len__') else (v,) * 3
            sock.default_value = v + (1,) * (len(sock.default_value) - len(v))
        else: sock.default_value = v

    def math(self, op, a, b=0.0, c=0.0):
        n = self.new('ShaderNodeMath', operation=op)
        for s, v in zip(n.inputs, (a, b, c)): self.put(s, v)
        return n.outputs[0]

    def mul(self, a, b): return self.math('MULTIPLY', a, b)
    def add(self, a, b): return self.math('ADD', a, b)
    def sub(self, a, b): return self.math('SUBTRACT', a, b)

    def step(self, lo, hi, x):
        n = self.new('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP')
        for k, v in zip((0, 1, 2), (x, lo, hi)): self.put(n.inputs[k], v)
        return n.outputs[0]

    def mix(self, fac, a, b, blend='MIX'):
        n = self.new('ShaderNodeMix', data_type='RGBA', blend_type=blend)
        ins = {s.identifier: s for s in n.inputs}
        self.put(ins['Factor_Float'], fac); self.put(ins['A_Color'], a); self.put(ins['B_Color'], b)
        return {s.identifier: s for s in n.outputs}['Result_Color']

    def lerp(self, fac, a, b):
        n = self.new('ShaderNodeMix', data_type='FLOAT')
        ins = {s.identifier: s for s in n.inputs}
        self.put(ins['Factor_Float'], fac); self.put(ins['A_Float'], a); self.put(ins['B_Float'], b)
        return {s.identifier: s for s in n.outputs}['Result_Float']

    def noise(self, pos, scale, detail=2.0, offset=0.0):
        m = self.new('ShaderNodeVectorMath', operation='MULTIPLY_ADD')
        self.put(m.inputs[0], pos); self.put(m.inputs[1], scale); self.put(m.inputs[2], offset)
        n = self.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = 1; n.inputs['Detail'].default_value = detail
        self.t.links.new(m.outputs[0], n.inputs['Vector'])
        return n.outputs[0]


FRESH_BLOOD = dict(rim=(.25, .09, .07), dark=(.045, .003, .003), light=(.22, .012, .01), rough=.2)
DRIED_BLOOD = dict(rim=(.5, .4, .34), dark=(.018, .011, .008), light=(.06, .033, .022), rough=.6)


def bake_material(matting=0.0, bald=0.0, grime=0.0, blood_tone=FRESH_BLOOD):
    """The procedural surface every textured piece shares. It reads two
    vertex colour layers: Col (base colour) and Prm (fur, roughness, blood),
    and adds what vertices cannot carry: pile fibres, clumps, greasy matted
    patches, bald patches down to the backing cloth, and ragged blood.
    Noise is in world space, so it does not care about UV seams.
    blood_tone: FRESH_BLOOD (red, wet) or DRIED_BLOOD (brown-black, matte)."""
    mat = bpy.data.materials.new('bake'); mat.use_nodes = True
    g = Nodes(mat)
    pos = g.new('ShaderNodeNewGeometry').outputs['Position']
    col = g.new('ShaderNodeAttribute', attribute_name='Col').outputs['Color']
    sep = g.new('ShaderNodeSeparateColor')
    g.put(sep.inputs[0], g.new('ShaderNodeAttribute', attribute_name='Prm').outputs['Color'])
    fur, rough, blood = sep.outputs[0], sep.outputs[1], sep.outputs[2]
    furw = g.step(.6, .9, fur)
    clothw = g.math('SUBTRACT', 1, g.math('MINIMUM', 1, g.mul(g.math('ABSOLUTE', g.sub(fur, .5)), 4)))
    fib = g.noise(pos, (170, 170, 20), 2)        # pile: fine, and long in z so it hangs
    clump = g.noise(pos, (16, 16, 6), 3)
    big = g.noise(pos, (2.6, 2.6, 2.0), 4, 3.3)
    big2 = g.noise(pos, (3.4, 3.4, 2.2), 4, 9.1)
    weave = g.noise(pos, (420, 420, 420), 0)

    # pile and clump shading
    k = g.add(1, g.mul(furw, g.add(g.mul(g.sub(fib, .5), .55), g.mul(g.sub(clump, .5), .8))))
    k = g.add(k, g.mul(g.sub(big, .5), .25))
    k = g.add(k, g.mul(clothw, g.mul(g.sub(weave, .5), .25)))
    comb = g.new('ShaderNodeCombineColor')
    for s in comb.inputs: g.put(s, k)
    c = g.mix(1, col, comb.outputs[0], 'MULTIPLY')

    # matted: greasy dark patches where the pile has stuck down
    mm = g.mul(g.mul(g.step(.46, .6, g.add(big, g.mul(g.sub(clump, .5), .3))), furw), matting)
    c = g.mix(mm, c, g.mix(1, c, (.42, .36, .33), 'MULTIPLY'))
    rough = g.lerp(mm, rough, .42)
    # grime: an even film of dirt, heavier in the clumps
    gr = g.mul(grime, g.add(.55, g.mul(clump, .9)))
    c = g.mix(gr, c, g.mix(1, c, (.3, .26, .22), 'MULTIPLY'))

    # bald: the pile gone, backing cloth showing
    bm = g.mul(g.step(1 - bald * .5, 1.05 - bald * .5, g.add(big2, g.mul(g.sub(clump, .5), .12))), furw)
    backing = g.mix(weave, (.20, .16, .11), (.33, .28, .2))
    c = g.mix(bm, c, backing)
    rough = g.lerp(bm, rough, .85)

    # blood: a ragged wet core with a dried rim
    bn = g.add(blood, g.mul(g.mul(g.sub(big, .5), 1.1), g.math('MINIMUM', 1, g.mul(blood, 6))))
    bn = g.add(bn, g.mul(g.mul(g.sub(clump, .5), .5), g.math('MINIMUM', 1, g.mul(blood, 6))))
    rim = g.step(.3, .42, bn); wet = g.step(.44, .6, bn)
    bt = blood_tone
    c = g.mix(rim, c, g.mix(1, c, bt['rim'], 'MULTIPLY'))
    c = g.mix(wet, c, g.mix(g.mul(fib, clump), bt['dark'], bt['light']))
    rough = g.lerp(wet, rough, bt['rough'])

    h = g.mul(g.mul(furw, g.sub(1, bm)), g.add(g.mul(fib, .8), g.mul(clump, .9)))
    h = g.add(h, g.mul(g.add(g.mul(clothw, .12), g.mul(bm, .25)), weave))
    bump = g.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 1; bump.inputs['Distance'].default_value = .005
    g.put(bump.inputs['Height'], h)

    bsdf = g.new('ShaderNodeBsdfPrincipled')
    g.put(bsdf.inputs['Base Color'], c); g.put(bsdf.inputs['Roughness'], rough)
    g.t.links.new(bump.outputs[0], bsdf.inputs['Normal'])
    out = g.new('ShaderNodeOutputMaterial')
    g.t.links.new(bsdf.outputs[0], out.inputs[0])
    return mat


def fibre_material():
    """Tufts, hair and whiskers: vertex colour only, no texture."""
    mat = bpy.data.materials.new('fibre'); mat.use_nodes = True
    g = Nodes(mat)
    vc = g.new('ShaderNodeVertexColor', layer_name='Col')
    bsdf = g.new('ShaderNodeBsdfPrincipled')
    g.t.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = .7
    g.t.links.new(bsdf.outputs[0], g.new('ShaderNodeOutputMaterial').inputs[0])
    return mat


def glow_material(col):
    """The game draws `eye_glow` unlit. The emission here is so the previews
    show the same thing."""
    mat = bpy.data.materials.new('eye_glow'); mat.use_nodes = True
    g = Nodes(mat)
    bsdf = g.new('ShaderNodeBsdfPrincipled')
    g.put(bsdf.inputs['Base Color'], col); g.put(bsdf.inputs['Emission Color'], col)
    bsdf.inputs['Emission Strength'].default_value = 1
    g.t.links.new(bsdf.outputs[0], g.new('ShaderNodeOutputMaterial').inputs[0])
    return mat


def unwrap(objs):
    """One atlas for every textured piece."""
    for o in objs:
        if not o.data.uv_layers: o.data.uv_layers.new(name='UVMap')
    select(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=.0015)
    bpy.ops.object.mode_set(mode='OBJECT')


def bake(objs, mat, size=2048, small=1024, ao_samples=12):
    """Bake the procedural material of objs to three images and return the
    material that uses them: colour with ambient occlusion folded in,
    a tangent normal map, and roughness in the green channel as glTF wants."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'
    for o in objs:
        o.data.materials.clear(); o.data.materials.append(mat)
        o.data.polygons.foreach_set('material_index', [0] * len(o.data.polygons))
    # Bake one joined copy, not the pieces: Blender rebuilds the whole scene
    # for every object and every pass, which took a quarter of an hour.
    dup = []
    for o in objs:
        d = o.copy(); d.data = o.data.copy(); sc.collection.objects.link(d); dup.append(d)
        o.hide_render = True
    one = join(dup)
    tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
    mat.node_tree.nodes.active = tex
    sc.render.bake.margin = 6
    select([one])

    def run(kind, px, samples, **kw):
        img = bpy.data.images.new('bake_' + kind, px, px, alpha=False, float_buffer=True)
        img.colorspace_settings.name = 'Non-Color'
        tex.image = img
        sc.cycles.samples = samples
        bpy.ops.object.bake(type=kind, **kw)
        a = np.empty(px * px * 4, dtype=np.float32); img.pixels.foreach_get(a)
        bpy.data.images.remove(img)
        return a.reshape(px, px, 4)

    col = run('DIFFUSE', size, 1, pass_filter={'COLOR'})
    nor = run('NORMAL', small, 1)
    rgh = run('ROUGHNESS', small, 1)
    ao = run('AO', small, ao_samples)
    mat.node_tree.nodes.remove(tex)
    bpy.data.objects.remove(one)
    for o in objs: o.hide_render = False

    k = size // small
    aoc = np.clip(ao[:, :, :3], 0, 1) ** 1.3
    col[:, :, :3] *= .25 + .75 * np.repeat(np.repeat(aoc, k, axis=0), k, axis=1)   # occlusion darkens, never to black
    orm = np.zeros_like(rgh); orm[:, :, 0] = 1; orm[:, :, 1] = rgh[:, :, 0]; orm[:, :, 3] = 1

    def image(name, a, space):
        img = bpy.data.images.new(name, a.shape[1], a.shape[0], alpha=False)
        img.colorspace_settings.name = space
        a = a.copy(); a[:, :, 3] = 1
        if space == 'sRGB':   # byte images hold sRGB; the bake is linear
            c = np.clip(a[:, :, :3], 0, 1)
            a[:, :, :3] = np.where(c > .0031308, 1.055 * c ** (1 / 2.4) - .055, c * 12.92)
        img.pixels.foreach_set(a.ravel()); img.pack()
        return img

    fin = bpy.data.materials.new('skin'); fin.use_nodes = True
    g = Nodes(fin)
    bsdf = g.new('ShaderNodeBsdfPrincipled')
    tc = g.new('ShaderNodeTexImage', image=image('walrus_col', col, 'sRGB'))
    tn = g.new('ShaderNodeTexImage', image=image('walrus_nor', nor, 'Non-Color'))
    tr = g.new('ShaderNodeTexImage', image=image('walrus_orm', orm, 'Non-Color'))
    g.t.links.new(tc.outputs[0], bsdf.inputs['Base Color'])
    nm = g.new('ShaderNodeNormalMap'); g.t.links.new(tn.outputs[0], nm.inputs['Color'])
    g.t.links.new(nm.outputs[0], bsdf.inputs['Normal'])
    sp = g.new('ShaderNodeSeparateColor'); g.t.links.new(tr.outputs[0], sp.inputs[0])
    g.t.links.new(sp.outputs[1], bsdf.inputs['Roughness'])
    bsdf.inputs['Metallic'].default_value = 0
    g.t.links.new(bsdf.outputs[0], g.new('ShaderNodeOutputMaterial').inputs[0])
    for o in objs:
        o.data.materials.clear(); o.data.materials.append(fin)
    return fin
