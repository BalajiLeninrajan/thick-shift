# Helpers for the Squish (toad) build. Everything here is generic sculpting,
# painting and baking; the shapes themselves are in build.py.
#
# The pipeline for one stage:
#   1. Forms: overlapping balls and tubes are fused by a voxel remesh, smoothed
#      so the masses flow into each other, displaced with noise and decimated.
#   2. paint(): colour, roughness, fuzz, blood, seams and weave are written per
#      vertex with numpy. The vertex grid is coarse (2 to 3 cm), so the one
#      shared material adds everything finer: velour grain, stitches, the sharp
#      edge of a blood stain.
#   3. finish(): unwrap every part into one atlas, bake that material to
#      colour (with AO folded in), normal and roughness images, swap in a plain
#      image material that glTF can carry, export.
import bpy, bmesh, math, os, random, sys, tempfile
import numpy as np
from mathutils import Vector, Matrix, Euler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import *


_t0 = __import__('time').time()


def log(msg):
    """Progress with elapsed seconds, so a slow step is easy to find."""
    print(f'[toad {__import__("time").time() - _t0:6.1f}s] {msg}', flush=True)


# ---------- colour ----------

def lin(c):
    """'#rrggbb' or an sRGB triple -> linear RGB as a numpy array."""
    if isinstance(c, str): c = [int(c[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = np.asarray(c, dtype=float)
    return np.where(c <= .04045, c / 12.92, ((c + .055) / 1.055) ** 2.4)


def mixc(a, b, t):
    """Blend two colours (hex or linear arrays). t may be a per-vertex array."""
    a = lin(a) if isinstance(a, str) else np.asarray(a)
    b = lin(b) if isinstance(b, str) else np.asarray(b)
    t = np.asarray(t, dtype=float)
    if t.ndim: t = t[:, None]
    return a * (1 - t) + b * t


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ---------- noise (numpy, so painting 40k vertices is instant) ----------

def _hash(ix, iy, iz, seed):
    x = np.sin(ix * 127.1 + iy * 311.7 + iz * 74.7 + seed * 13.37) * 43758.5453
    return x - np.floor(x)


def vnoise(P, scale, seed=0):
    Q = P * scale
    I = np.floor(Q)
    F = Q - I
    F = F * F * (3 - 2 * F)
    acc = np.zeros(len(P))
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (F[:, 0] if dx else 1 - F[:, 0]) * (F[:, 1] if dy else 1 - F[:, 1]) * (F[:, 2] if dz else 1 - F[:, 2])
                acc += w * _hash(I[:, 0] + dx, I[:, 1] + dy, I[:, 2] + dz, seed)
    return acc


def fbm(P, scale, seed=0, octaves=4):
    acc, amp, tot = np.zeros(len(P)), 1., 0.
    for i in range(octaves):
        acc += vnoise(P, scale * 2 ** i, seed + i * 7) * amp
        tot += amp
        amp *= .5
    return acc / tot


# ---------- forms ----------

class Forms:
    """A pile of overlapping balls and tubes, to be fused by remesh()."""

    def __init__(self):
        self.bm = bmesh.new()

    def ball(self, c, r, rot=(0, 0, 0), sub=3):
        r3 = (r, r, r) if isinstance(r, (int, float)) else r
        m = Matrix.Translation(c) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((*r3, 1))
        bmesh.ops.create_icosphere(self.bm, subdivisions=sub, radius=1, matrix=m)
        return self

    def tube(self, pts, radii, sub=2):
        """Balls strung along a polyline, close enough to fuse into a limb."""
        for i in range(len(pts) - 1):
            a, b = Vector(pts[i]), Vector(pts[i + 1])
            r0, r1 = radii[i], radii[i + 1]
            n = max(2, int((b - a).length / (min(r0, r1) * .45)))
            for k in range(n + 1):
                t = k / n
                self.ball(a.lerp(b, t), r0 + (r1 - r0) * t, sub=sub)
        return self

    def obj(self, name):
        return bm_obj(self.bm, name)


def bm_obj(bm, name):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def apply_mods(o, kind=None):
    """Replace the mesh with its evaluated result. No operators, so no context trouble."""
    kind = kind or o.modifiers[-1].type.lower()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    old = o.data
    o.modifiers.clear()
    o.data = me
    bpy.data.meshes.remove(old)
    bpy.context.view_layer.update()
    log(f'  {o.name}: {kind} -> {len(me.polygons)} faces')


def remesh(o, voxel):
    m = o.modifiers.new('r', 'REMESH')
    m.mode = 'VOXEL'; m.voxel_size = voxel; m.adaptivity = 0
    apply_mods(o)


def smooth(o, iterations, factor=.5):
    m = o.modifiers.new('s', 'SMOOTH')
    m.factor = factor; m.iterations = iterations
    apply_mods(o)


def displace(o, scale, strength, depth=2):
    """Lumps: push the surface along its normal by a cloud texture in world space."""
    tex = bpy.data.textures.new('lumps', 'CLOUDS')
    tex.noise_scale = scale; tex.noise_depth = depth
    m = o.modifiers.new('d', 'DISPLACE')
    m.texture = tex; m.texture_coords = 'GLOBAL'; m.strength = strength; m.mid_level = .5
    apply_mods(o)
    bpy.data.textures.remove(tex)


def decimate(o, target):
    n = tris([o])
    if n <= target: return
    m = o.modifiers.new('dec', 'DECIMATE')
    m.ratio = target / n
    apply_mods(o)


def boolean(o, cutter, op='DIFFERENCE'):
    m = o.modifiers.new('b', 'BOOLEAN')
    m.operation = op; m.object = cutter
    # every mesh here is closed, so the fast solver is safe
    m.solver = 'MANIFOLD' if 'MANIFOLD' in m.bl_rna.properties['solver'].enum_items else 'EXACT'
    apply_mods(o)


def sculpt(forms, name, voxel=.02, soften=8, lumps=(), detail=None, detail_soften=2):
    """Fuse a Forms pile into one skin. `detail` is a second pile (warts,
    knuckles) added after the main smoothing so it stays crisp."""
    o = forms.obj(name)
    remesh(o, voxel)
    smooth(o, soften)
    if detail is not None:
        d = detail.obj('detail')
        join(o, [d])
        remesh(o, voxel)
        smooth(o, detail_soften)
    for scale, strength in lumps: displace(o, scale, strength)
    return o


def prism(poly_yz, half_width, name='cutter'):
    """A polygon in the y-z plane, extruded across x. Used to cut mouths."""
    bm = bmesh.new()
    a = [bm.verts.new((-half_width, y, z)) for y, z in poly_yz]
    b = [bm.verts.new((half_width, y, z)) for y, z in poly_yz]
    n = len(a)
    bm.faces.new(a); bm.faces.new(b[::-1])
    for i in range(n): bm.faces.new((a[i], b[i], b[(i + 1) % n], a[(i + 1) % n]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm_obj(bm, name)


def box(size, at=(0, 0, 0), rot=(0, 0, 0), bevel=0., segments=1, name='box'):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    if bevel: bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segments, affect='EDGES', profile=.5)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(at) @ Euler(rot).to_matrix().to_4x4(), verts=bm.verts)
    return bm_obj(bm, name)


def ball(c, r, rot=(0, 0, 0), sub=3, name='ball'):
    f = Forms(); f.ball(c, r, rot, sub)
    return f.obj(name)


def tube_mesh(pts, radii, sides=5, name='tube'):
    """A thin tapered tube through pts, closed at both ends. For strands, where
    a remesh would cost far too many triangles."""
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        p = Vector(p)
        d = (Vector(pts[min(i + 1, len(pts) - 1)]) - Vector(pts[max(i - 1, 0)])).normalized()
        u = d.cross(Vector((0, 1, 0)))
        if u.length < .1: u = d.cross(Vector((1, 0, 0)))
        u.normalize(); v = d.cross(u)
        rings.append([bm.verts.new(p + (u * math.cos(a) + v * math.sin(a)) * radii[i]) for a in (k * math.tau / sides for k in range(sides))])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(sides): bm.faces.new((r0[k], r0[(k + 1) % sides], r1[(k + 1) % sides], r1[k]))
    bm.faces.new(rings[0][::-1]); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm_obj(bm, name)


def join(a, others):
    """Join `others` into `a`. Painted attributes with the same name merge."""
    others = [o for o in others if o is not None]
    if not others: return a
    with bpy.context.temp_override(active_object=a, object=a, selected_objects=[a] + others, selected_editable_objects=[a] + others):
        bpy.ops.object.join()
    bpy.context.view_layer.update()
    return a


def delete(*objs):
    for o in objs:
        me = o.data
        bpy.data.objects.remove(o)
        if me and me.users == 0: bpy.data.meshes.remove(me)


def hit(o, origin, direction):
    """Where a ray meets the sculpted surface (world space; parts sit at identity until part())."""
    bpy.context.view_layer.update()
    ok, loc, nor, _ = o.ray_cast(Vector(origin), Vector(direction).normalized())
    return (loc.copy(), nor.copy()) if ok else (None, None)


def flatten_floor(o, z=0.):
    """Feet are soft, the floor is not: nothing goes below it."""
    for v in o.data.vertices:
        if v.co.z < z: v.co.z = z


# ---------- painting ----------

def coords(o):
    me = o.data
    n = len(me.vertices)
    P = np.empty(n * 3); me.vertices.foreach_get('co', P)
    N = np.empty(n * 3); me.vertices.foreach_get('normal', N)
    return P.reshape(n, 3), N.reshape(n, 3)


def paint(o, fn):
    """fn(P, N) -> dict of per-vertex values (scalars broadcast):
         rgb    linear colour (use lin() / mixc())
         rough  roughness
         fuzz   1 = velour (grain, speckle), 0 = hard and smooth
         blood  0..1; the shader gives it a ragged edge and makes it wet
         dry    0..1; 1 turns that blood old: brown-black and crusted, not red
         seam   distance in metres to the nearest stitched seam (default: far)
         seam_u distance along that seam, to space the stitches
         weave  1 = see-through costume mesh"""
    for p in o.data.polygons: p.use_smooth = True
    P, N = coords(o)
    n = len(P)
    d = fn(P, N)
    full = lambda v, k=1: np.broadcast_to(np.asarray(v, dtype=float).reshape((-1, k) if k > 1 else (-1,)), (n, k) if k > 1 else (n,))
    one = np.ones(n)
    layers = {
        'paint': np.column_stack([full(d['rgb'], 3), one]),
        'props': np.column_stack([full(d.get('rough', .9)), full(d.get('fuzz', 1)), full(d.get('blood', 0)), one]),
        'aux': np.column_stack([full(d.get('seam', 1)), full(d.get('seam_u', 0)), full(d.get('weave', 0)), full(d.get('dry', 0))]),
    }
    for name, arr in layers.items():
        a = o.data.color_attributes.get(name) or o.data.color_attributes.new(name, 'FLOAT_COLOR', 'POINT')
        a.data.foreach_set('color', np.ascontiguousarray(arr, dtype=np.float32).ravel())
    return o


def nearest_seam(*seams):
    """Each seam is (distance, along). Keep, per vertex, the closest one."""
    d = np.stack([s[0] for s in seams]); u = np.stack([np.broadcast_to(s[1], s[0].shape) for s in seams])
    k = np.argmin(d, axis=0)
    idx = np.arange(d.shape[1])
    return d[k, idx], u[k, idx]


# ---------- the one material, and the bake ----------

def sculpt_material():
    """Turns the painted vertex data into a surface. Baked, never exported."""
    m = bpy.data.materials.new('sculpt')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()

    def node(kind, **kw):
        n = nt.nodes.new(kind)
        for k, v in kw.items(): setattr(n, k, v)
        return n

    def feed(sock, x):
        if isinstance(x, (int, float)): sock.default_value = x
        elif isinstance(x, tuple): sock.default_value = x
        else: nt.links.new(x, sock)

    def math_(op, a, b=None, c=None):
        n = node('ShaderNodeMath', operation=op)
        for i, x in enumerate((a, b, c)):
            if x is not None: feed(n.inputs[i], x)
        return n.outputs[0]

    def vmul(a, b):   # colour * colour
        n = node('ShaderNodeVectorMath', operation='MULTIPLY'); feed(n.inputs[0], a); feed(n.inputs[1], b); return n.outputs[0]

    def vscale(a, s):  # colour * scalar
        n = node('ShaderNodeVectorMath', operation='SCALE'); feed(n.inputs[0], a); feed(n.inputs['Scale'], s); return n.outputs[0]

    def vmix(t, a, b):
        n = node('ShaderNodeMix', data_type='VECTOR')
        ins = [s for s in n.inputs if s.type == 'VECTOR']
        feed(n.inputs[0], t); feed(ins[-2], a); feed(ins[-1], b)
        return [s for s in n.outputs if s.type == 'VECTOR'][0]

    def smoothstep(a, b, x):
        n = node('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP')
        feed(n.inputs[0], x); feed(n.inputs[1], a); feed(n.inputs[2], b); feed(n.inputs[3], 0.); feed(n.inputs[4], 1.)
        return n.outputs[0]

    def attr(name):
        a = node('ShaderNodeAttribute', attribute_name=name)
        s = node('ShaderNodeSeparateXYZ'); nt.links.new(a.outputs['Vector'], s.inputs[0])
        return a.outputs['Vector'], s.outputs[0], s.outputs[1], s.outputs[2], a.outputs['Alpha']

    def noise(scale, detail):
        n = node('ShaderNodeTexNoise'); nt.links.new(pos, n.inputs['Vector'])
        n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail
        return n.outputs[0]

    pos = node('ShaderNodeNewGeometry').outputs['Position']
    psep = node('ShaderNodeSeparateXYZ'); nt.links.new(pos, psep.inputs[0])
    col = attr('paint')[0]
    _, rough, fuzz, blood, _ = attr('props')
    _, seam, seam_u, weave, dry = attr('aux')
    grain, mottle, clot, crease = noise(140, 2), noise(9, 4), noise(22, 3), noise(38, 3)

    # velour: fine speckle and slow mottling, only where the surface is fuzzy
    shade = math_('ADD', 1, math_('MULTIPLY', fuzz, math_('ADD', math_('MULTIPLY', math_('SUBTRACT', grain, .5), .5), math_('MULTIPLY', math_('SUBTRACT', mottle, .5), .45))))
    base = vscale(col, shade)
    # costume mesh: a grid of holes, darker where you look through
    holes = math_('GREATER_THAN', math_('MULTIPLY', math_('SINE', math_('MULTIPLY', psep.outputs[0], 420)), math_('SINE', math_('MULTIPLY', psep.outputs[2], 420))), 0)
    base = vscale(base, math_('SUBTRACT', 1, math_('MULTIPLY', weave, math_('MULTIPLY', holes, .75))))
    # seams: a dark groove with pale stitches crossing it
    groove = math_('SUBTRACT', 1, smoothstep(.0015, .006, seam))
    near = math_('MULTIPLY', math_('LESS_THAN', seam, .016), math_('GREATER_THAN', seam, .004))
    stitch = math_('MULTIPLY', near, math_('LESS_THAN', math_('FRACT', math_('MULTIPLY', seam_u, 55)), .4))
    base = vscale(base, math_('SUBTRACT', 1, math_('MULTIPLY', groove, .65)))
    base = vmix(math_('MULTIPLY', stitch, .6), base, (.55, .5, .36))
    # blood: the painted amount plus noise, thresholded, so stains get a torn edge
    wet = smoothstep(.42, .56, math_('ADD', blood, math_('MULTIPLY', math_('SUBTRACT', clot, .5), .7)))
    # fresh is a wet red; dried is brown-black with a dull crust
    clump = math_('ADD', .35, math_('MULTIPLY', mottle, 1.3))
    gore = vmix(dry, vscale((.11, .006, .008), clump), vscale((.026, .012, .007), clump))
    base = vmix(wet, base, gore)
    gore_rough = math_('ADD', math_('ADD', .1, math_('MULTIPLY', dry, .38)), math_('MULTIPLY', clot, .25))
    rough_out = math_('ADD', math_('MULTIPLY', rough, math_('SUBTRACT', 1, wet)), math_('MULTIPLY', wet, gore_rough))
    rough_out = math_('ADD', rough_out, math_('MULTIPLY', math_('SUBTRACT', grain, .5), math_('MULTIPLY', fuzz, .15)))

    # height in metres: grain and creases on fuzz, a little pitting on hard things, the seam groove
    h = math_('MULTIPLY', fuzz, math_('ADD', math_('MULTIPLY', grain, .0012), math_('ADD', math_('MULTIPLY', mottle, .006), math_('MULTIPLY', crease, .0025))))
    h = math_('ADD', h, math_('MULTIPLY', math_('SUBTRACT', 1, fuzz), math_('MULTIPLY', crease, .0012)))
    h = math_('ADD', h, math_('MULTIPLY', groove, -.004))
    h = math_('ADD', h, math_('MULTIPLY', stitch, .0025))
    h = math_('ADD', h, math_('MULTIPLY', weave, math_('MULTIPLY', holes, -.002)))
    h = math_('ADD', h, math_('MULTIPLY', wet, math_('MULTIPLY', clot, .002)))
    bump = node('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 1; bump.inputs['Distance'].default_value = 1
    nt.links.new(h, bump.inputs['Height'])

    ao = node('ShaderNodeAmbientOcclusion', samples=4)
    ao.inputs['Distance'].default_value = .3
    lit = vscale(base, math_('ADD', .3, math_('MULTIPLY', ao.outputs['AO'], .7)))
    emit = node('ShaderNodeEmission'); nt.links.new(lit, emit.inputs['Color'])
    bsdf = node('ShaderNodeBsdfPrincipled')
    nt.links.new(base, bsdf.inputs['Base Color']); nt.links.new(rough_out, bsdf.inputs['Roughness']); nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    out = node('ShaderNodeOutputMaterial')
    img = node('ShaderNodeTexImage')
    return m, dict(nt=nt, out=out, emit=emit, bsdf=bsdf, img=img)


def glow_material():
    """Named eye_glow: the game draws it emissive and unlit."""
    m = bpy.data.materials.get('eye_glow')
    if m: return m
    m = bpy.data.materials.new('eye_glow')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    pale = (*lin('#f3e6d8'), 1)
    b.inputs['Base Color'].default_value = pale
    b.inputs['Emission Color'].default_value = pale
    b.inputs['Emission Strength'].default_value = 4
    return m


def unwrap(objs):
    """Smart-project each part, then pack all of them into one square at an even texel density."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        m = o.modifiers.new('t', 'TRIANGULATE'); apply_mods(o)
        for p in o.data.polygons: p.use_smooth = True
        o.data.uv_layers.new(name='uv')
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(72), island_margin=0)
        bpy.ops.object.mode_set(mode='OBJECT')
        o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(margin=.003, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    log('unwrapped')


def bake(objs, name, size=2048, samples=5):
    """Bake the sculpt material on `objs` to three images and give the parts a
    plain image material instead. Returns that material."""
    unwrap(objs)
    mat, n = sculpt_material()
    for o in objs:
        o.data.materials.clear(); o.data.materials.append(mat)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'; sc.cycles.use_denoising = False
    sc.render.bake.margin = 8; sc.render.bake.use_clear = True
    tmp = tempfile.mkdtemp(prefix='toad_bake_')
    images = {}
    nt = n['nt']
    for kind, sz, btype, shader in (('col', size, 'EMIT', n['emit'].outputs[0]), ('nrm', size, 'NORMAL', n['bsdf'].outputs[0]), ('orm', size // 2, 'ROUGHNESS', n['bsdf'].outputs[0])):
        img = bpy.data.images.new(f'{name}_{kind}', sz, sz, alpha=False)
        if kind != 'col': img.colorspace_settings.name = 'Non-Color'
        for l in list(n['out'].inputs['Surface'].links): nt.links.remove(l)
        nt.links.new(shader, n['out'].inputs['Surface'])
        sc.cycles.samples = samples if kind == 'col' else 1     # only the AO in the colour pass is noisy
        n['img'].image = img
        nt.nodes.active = n['img']
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs: o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.bake(type=btype)
        img.filepath_raw = os.path.join(tmp, f'{name}_{kind}.png'); img.file_format = 'PNG'; img.save()
        images[kind] = img
        log(f'baked {kind} {sz}px')
    # the material the game gets
    out = bpy.data.materials.new(name)
    out.use_nodes = True
    nt2 = out.node_tree
    b = nt2.nodes['Principled BSDF']
    tex = lambda img: (lambda t: (setattr(t, 'image', img), t)[1])(nt2.nodes.new('ShaderNodeTexImage'))
    nt2.links.new(tex(images['col']).outputs['Color'], b.inputs['Base Color'])
    nm = nt2.nodes.new('ShaderNodeNormalMap')
    nt2.links.new(tex(images['nrm']).outputs['Color'], nm.inputs['Color']); nt2.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    sep = nt2.nodes.new('ShaderNodeSeparateColor')   # glTF keeps roughness in G
    nt2.links.new(tex(images['orm']).outputs['Color'], sep.inputs[0]); nt2.links.new(sep.outputs[1], b.inputs['Roughness'])
    b.inputs['Metallic'].default_value = 0
    for o in objs:
        o.data.materials.clear(); o.data.materials.append(out)
        for a in list(o.data.color_attributes): o.data.color_attributes.remove(a)
    bpy.data.materials.remove(mat)
    return out, images
