# The prop builder. A Prop collects geometry from a handful of primitives
# (box, lathe, tube, sheet...) into one bmesh, then finish() turns it into a
# mesh the game can load.
#
# Every face is one of two kinds:
#   - tiled: it carries UVs in "tile space" (surface metres divided by the
#     swatch's repeat) and names a swatch of atlas A. finish() cuts the face
#     along the integer UV lines and folds each piece into the swatch, which is
#     how a texture atlas gets to repeat across a three metre curtain.
#   - art: it maps straight onto a rectangle of atlas B (or a glow material).
# Colour comes from the swatch times a vertex colour, so pass the tint as `c`.
import bpy, bmesh, hashlib, math, os, sys, tempfile
import numpy as np
from contextlib import contextmanager
from mathutils import Vector, Matrix, Euler, noise

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.dirname(HERE))
import atlas

MATS = ['kit_a', 'kit_b', 'glass', 'lamp_glow', 'screen_glow', 'sign_glow']
GLOW = {'lamp_glow', 'screen_glow', 'sign_glow'}
D = math.radians


def lin(c):
    """sRGB triple -> linear, which is what glTF vertex colours are."""
    return tuple(((v + .055) / 1.055) ** 2.4 if v > .04045 else v / 12.92 for v in c[:3])


def hexc(s):
    s = s.lstrip('#')
    return tuple(int(s[i:i + 2], 16) / 255 for i in (0, 2, 4))


def mixc(a, b, t):
    return tuple(a[i] * (1 - t) + b[i] * t for i in range(3))


def xf(at=(0, 0, 0), rot=(0, 0, 0), scale=1):
    s = (scale,) * 3 if isinstance(scale, (int, float)) else scale
    return Matrix.Translation(Vector(at)) @ Euler([D(a) for a in rot], 'XYZ').to_matrix().to_4x4() @ Matrix.Diagonal((*s, 1))


# ------------------------------------------------------------ materials

TEXTURES = (('props_b_a', True, None), ('props_b_a_n', False, None), ('props_b_a_orm', False, 1024), ('props_b_art', True, None))


def _atlas_files():
    """The four atlas images as PNG files in the temp dir, named for the
    source of atlas.py, because painting them takes minutes. The exporter
    reads images from files: a generated image filled with pixels in memory
    and packed comes out black."""
    with open(os.path.join(HERE, 'atlas.py'), 'rb') as f: key = hashlib.md5(f.read()).hexdigest()[:12]
    paths = [os.path.join(tempfile.gettempdir(), f'{name}_{key}.png') for name, _, _ in TEXTURES]
    if all(os.path.exists(p) for p in paths): return paths
    arrs = [*atlas.build_a(), atlas.build_b()]
    for (name, colour, size), arr, path in zip(TEXTURES, arrs, paths):
        h, w = arr.shape[:2]
        img = bpy.data.images.new(name + '_paint', w, h, alpha=False)
        img.pixels.foreach_set(np.concatenate([arr, np.ones((h, w, 1), np.float32)], -1).ravel())
        if size and size != w: img.scale(size, size)
        img.filepath_raw = path; img.file_format = 'PNG'; img.save()
        bpy.data.images.remove(img)
    return paths


def make_materials():
    imgs = []
    for (name, colour, _), path in zip(TEXTURES, _atlas_files()):
        img = bpy.data.images.load(path); img.name = name
        img.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
        imgs.append(img)
    ia, ino, iorm, ib = imgs
    out = {}
    for name in MATS:
        m = bpy.data.materials.new(name); m.use_nodes = True
        nt = m.node_tree; N = nt.nodes; L = nt.links
        bsdf = next(n for n in N if n.type == 'BSDF_PRINCIPLED')
        m.use_backface_culling = False   # cloth, sheet metal and paper are single skins
        def tex(img):
            t = N.new('ShaderNodeTexImage'); t.image = img; return t
        def tinted(img):
            # texture x vertex colour, in the shape the glTF exporter recognises
            t, vc, mx = tex(img), N.new('ShaderNodeVertexColor'), N.new('ShaderNodeMix')
            vc.layer_name = 'Color'
            mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs[0].default_value = 1
            L.new(t.outputs['Color'], mx.inputs[6]); L.new(vc.outputs['Color'], mx.inputs[7])
            L.new(mx.outputs[2], bsdf.inputs['Base Color'])
            return t
        if name == 'kit_a':
            tinted(ia)
            nm = N.new('ShaderNodeNormalMap'); L.new(tex(ino).outputs['Color'], nm.inputs['Color'])
            L.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
            sep = N.new('ShaderNodeSeparateColor'); L.new(tex(iorm).outputs['Color'], sep.inputs[0])
            L.new(sep.outputs[1], bsdf.inputs['Roughness']); L.new(sep.outputs[2], bsdf.inputs['Metallic'])
        elif name == 'kit_b':
            tinted(ib); bsdf.inputs['Roughness'].default_value = .62
        elif name == 'glass':
            bsdf.inputs['Base Color'].default_value = (.62, .72, .68, 1)
            bsdf.inputs['Alpha'].default_value = .2; bsdf.inputs['Roughness'].default_value = .12
            m.surface_render_method = 'BLENDED'
        elif name == 'lamp_glow':
            bsdf.inputs['Base Color'].default_value = (1, .85, .6, 1)
            bsdf.inputs['Emission Color'].default_value = (1, .78, .45, 1); bsdf.inputs['Emission Strength'].default_value = 2.5
        else:   # the screen and the signs glow with their own picture
            t = tex(ib)
            L.new(t.outputs['Color'], bsdf.inputs['Base Color']); L.new(t.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = 1.4 if name == 'screen_glow' else 1.0
            bsdf.inputs['Roughness'].default_value = .25
        out[name] = m
    return out


# ------------------------------------------------------------ the builder

BUILDERS = []


def prop(name, mount='floor', notes='', grime=.3):
    """Register a function that builds one prop into the Prop it is handed."""
    def deco(fn):
        BUILDERS.append((name, mount, notes, grime, fn))
        return fn
    return deco


class Prop:
    registry = []

    def __init__(self, name, mount='floor', notes='', parent=None, pivot=(0, 0, 0), grime=.3):
        self.name, self.mount, self.notes, self.parent = name, mount, notes, parent
        self.pivot = Vector(pivot)
        self.grime = grime
        self.bm = bmesh.new()
        self.l_uv = self.bm.loops.layers.uv.new('UVMap')
        self.l_col = self.bm.loops.layers.float_color.new('Color')
        self.f_tile = self.bm.faces.layers.int.new('tile')
        self.stack = [Matrix.Identity(4)]
        self.kids = []
        self.rng = np.random.default_rng(abs(hash_name(name)))
        if parent is None: Prop.registry.append(self)
        else: parent.kids.append(self)

    def child(self, name, pivot):
        return Prop(name, parent=self, pivot=pivot, grime=self.grime)

    @property
    def M(self): return self.stack[-1]

    @contextmanager
    def place(self, at=(0, 0, 0), rot=(0, 0, 0), scale=1):
        """Everything built inside is moved by this transform."""
        self.stack.append(self.M @ xf(at, rot, scale))
        try: yield
        finally: self.stack.pop()

    # -- the one way geometry gets in --------------------------------------
    def add(self, vs, fs, t='plastic', c=(1, 1, 1), ts=None, uv=None, m=None, rect=None, M=None, flip=False):
        """vs: positions. fs: faces as index lists. uv: one (u, v) per vertex;
        for a tiled face in metres along the surface, for an art face 0..1
        across `rect`. With no uv, tiled faces are box projected and art faces
        are fitted flat to their bounds.
        t: swatch of atlas A. rect: a name in atlas.ART instead. c: tint, an
        sRGB triple or a function of the position. m: material override."""
        Mx = self.M @ M if M is not None else self.M
        ws = [Mx @ Vector(v) for v in vs]
        bv = [self.bm.verts.new(w) for w in ws]
        plain = rect is None and m in ('glass', 'lamp_glow')   # untextured
        idx = {v: i for i, v in enumerate(bv)}
        mat = MATS.index(m or ('kit_b' if rect else 'kit_a'))
        ts = ts or atlas.SCALE.get(t, .6)
        off = self.rng.random(2) * 7
        cols = [lin(c(w)) if callable(c) else None for w in ws]
        flat = None if callable(c) else lin(c)
        faces = []
        for f in fs:
            if len(set(f)) < 3: continue
            try: face = self.bm.faces.new([bv[i] for i in (reversed(f) if flip else f)])
            except ValueError: continue
            face.material_index = mat; face.smooth = True
            face[self.f_tile] = -1 if (plain or rect is not None) else atlas.TILES.index(t)
            faces.append(face)
        self.bm.normal_update()
        if rect is not None and uv is None: fit = _planar(faces)
        for face in faces:
            n = face.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for lp in face.loops:
                i = idx[lp.vert]
                if rect is not None:
                    u, v = uv[i] if uv is not None else fit(lp.vert.co)
                    r = atlas.art_rect(rect)
                    lp[self.l_uv].uv = (r[0] + u * r[2], r[1] + v * r[3])
                elif plain:
                    lp[self.l_uv].uv = (.5, .5)
                elif uv is not None:
                    lp[self.l_uv].uv = (uv[i][0] / ts + off[0], uv[i][1] / ts + off[1])
                else:
                    p = lp.vert.co
                    a, b = ((p.y, p.z), (p.x, p.z), (p.x, p.y))[ax]
                    lp[self.l_uv].uv = (a / ts + off[0], b / ts + off[1])
                lp[self.l_col] = (*(cols[i] or flat), 1)
        return faces

    # -- primitives ---------------------------------------------------------
    def box(self, size, at=(0, 0, 0), rot=(0, 0, 0), bevel=0, **st):
        """A box centred on `at`. bevel: metres off every edge, so the torch catches it."""
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1)
        bmesh.ops.scale(tmp, vec=Vector(size), verts=tmp.verts)
        if bevel: bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=bevel, segments=1, affect='EDGES', profile=.5)
        vs = [v.co.copy() for v in tmp.verts]; fs = [[v.index for v in f.verts] for f in tmp.faces]
        tmp.free()
        return self.add(vs, fs, M=xf(at, rot), **st)

    def lathe(self, prof, at=(0, 0, 0), rot=(0, 0, 0), scale=1, segs=12, bump=None, arc=360, disc=False, wrap=False, **st):
        """Spin a profile of (radius, z) points about z. bump: (metres, frequency)
        of lumpiness. disc: map art onto it looking down the axis (for eyes, dials).
        wrap: wind art once round it (for labels)."""
        vs, uv, fs = [], [], []
        # The profile is in its own units and `scale` stretches it (ball() spins
        # a unit circle), so tile UVs and bumps are measured after scaling:
        # otherwise a small ball gets a texture repeat per centimetre, and
        # finish() cuts it into hundreds of pieces.
        sx, sy, sz = (scale,) * 3 if isinstance(scale, (int, float)) else scale
        sr = (abs(sx) + abs(sy)) / 2
        rmax = max(r for r, z in prof) or 1
        length = [0]
        for (r0, z0), (r1, z1) in zip(prof, prof[1:]): length.append(length[-1] + math.hypot((r1 - r0) * sr, (z1 - z0) * sz))
        for j, (r, z) in enumerate(prof):
            for i in range(segs + 1):
                a = D(arc) * i / segs
                p = Vector((math.cos(a) * r, math.sin(a) * r, z))
                if bump and r > 0:
                    q = Vector((math.cos(D(arc) * (i % segs) / segs) * r * sx, math.sin(D(arc) * (i % segs) / segs) * r * sy, z * sz))
                    k = 1 + bump[0] * noise.noise(q * bump[1] + Vector((3.1, 7.7, 1.3) if len(bump) < 3 else bump[2])) / max(r * sr, 1e-3)
                    p.x *= k; p.y *= k
                vs.append(p); uv.append((.5 + p.x / (2 * rmax), .5 + p.y / (2 * rmax)) if disc else (i / segs, length[j] / length[-1]) if wrap else (D(arc) * rmax * sr * i / segs, length[j]))
        for j in range(len(prof) - 1):
            for i in range(segs):
                a, b = j * (segs + 1) + i, (j + 1) * (segs + 1) + i
                fs.append([a, a + 1, b + 1, b])
        return self.add(vs, fs, uv=uv, M=xf(at, rot, scale), **st)

    def cyl(self, r, h, at=(0, 0, 0), rot=(0, 0, 0), segs=12, r2=None, caps=True, **st):
        r2 = r if r2 is None else r2
        prof = [(0, 0), (r, 0), (r2, h), (0, h)] if caps else [(r, 0), (r2, h)]
        return self.lathe(prof, at, rot, segs=segs, **st)

    def ball(self, r, at=(0, 0, 0), rot=(0, 0, 0), segs=12, rings=7, bump=None, **st):
        """An ellipsoid; r is a radius or (rx, ry, rz)."""
        prof = [(math.sin(math.pi * k / rings), -math.cos(math.pi * k / rings)) for k in range(rings + 1)]
        prof[0] = (0, -1); prof[-1] = (0, 1)
        return self.lathe(prof, at, rot, scale=r, segs=segs, bump=bump, **st)

    def tube(self, pts, r, segs=6, up=(0, -1, 0), caps=True, bump=None, **st):
        """Sweep an ellipse along a polyline. r: one radius, one (rx, ry) tuple, or a
        list with either per point; ry lies toward `up`. bump: (metres, frequency)."""
        pts = [Vector(p) for p in pts]
        n = len(pts)
        one = isinstance(r, (int, float)) or (isinstance(r, tuple) and len(r) == 2 and isinstance(r[0], (int, float)))
        rad = [r] * n if one else list(r)
        rad = [(q, q) if isinstance(q, (int, float)) else q for q in rad]
        tan = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
        nrm = Vector(up) - tan[0] * tan[0].dot(Vector(up))
        if nrm.length < 1e-4: nrm = tan[0].orthogonal()
        nrm.normalize()
        vs, uv, fs, dist = [], [], [], 0
        rmean = sum(a + b for a, b in rad) / (2 * n)
        for j in range(n):
            if j:
                dist += (pts[j] - pts[j - 1]).length
                nrm = (nrm - tan[j] * tan[j].dot(nrm)).normalized()   # carry the frame along without twisting
            bi = tan[j].cross(nrm)
            for i in range(segs + 1):
                a = 2 * math.pi * (i % segs) / segs
                d = bi * math.cos(a) * rad[j][0] + nrm * math.sin(a) * rad[j][1]
                p = pts[j] + d
                if bump: p += d.normalized() * bump[0] * noise.noise(p * bump[1])
                vs.append(p); uv.append((2 * math.pi * rmean * i / segs, dist))
        for j in range(n - 1):
            for i in range(segs):
                a, b = j * (segs + 1) + i, (j + 1) * (segs + 1) + i
                fs.append([a, a + 1, b + 1, b])
        c0, c1 = caps if isinstance(caps, tuple) else (caps, caps)
        if c0 or c1:
            for j, rev in ((0, True), (n - 1, False)):
                if not (c1 if j else c0): continue
                vs.append(pts[j]); uv.append((0, dist if j else 0))
                for i in range(segs):
                    a = j * (segs + 1) + i
                    fs.append([len(vs) - 1, a + 1, a] if rev else [len(vs) - 1, a, a + 1])
        return self.add(vs, fs, uv=uv, **st)

    def ring(self, r, wire, at=(0, 0, 0), rot=(0, 0, 0), n=10, segs=4, **st):
        """A torus lying in the local XY plane."""
        m = xf(at, rot)
        pts = [m @ Vector((math.cos(2 * math.pi * i / n) * r, math.sin(2 * math.pi * i / n) * r, 0)) for i in range(n + 1)]
        return self.tube(pts, wire, segs=segs, caps=False, up=m.to_3x3() @ Vector((0, 0, 1)), **st)

    def sheet(self, f, nu, nv, size=(1, 1), keep=None, **st):
        """A surface from f(u, v) -> position, u and v in 0..1. size: its real
        extent in metres, for texturing. keep(u, v) -> False cuts a hole."""
        vs = [Vector(f(i / nu, j / nv)) for j in range(nv + 1) for i in range(nu + 1)]
        uv = [(i / nu * size[0], j / nv * size[1]) for j in range(nv + 1) for i in range(nu + 1)]
        fs = []
        for j in range(nv):
            for i in range(nu):
                if keep and not keep((i + .5) / nu, (j + .5) / nv): continue
                a = j * (nu + 1) + i
                fs.append([a, a + 1, a + nu + 2, a + nu + 1])
        return self.add(vs, fs, uv=uv, **st)

    def quad(self, pts, **st):
        """One four-sided face, corners counter-clockwise seen from the front,
        starting bottom left. With `rect` the art fills it exactly."""
        return self.add(pts, [[0, 1, 2, 3]], uv=[(0, 0), (1, 0), (1, 1), (0, 1)] if st.get('rect') else None, **st)

    def text(self, s, size, at=(0, 0, 0), rot=(90, 0, 0), depth=0, align='CENTER', **st):
        """Letters as geometry, in Blender's built in font. They lie in the
        local XY plane; the default rot stands them up facing -Y."""
        cu = bpy.data.curves.new('t', 'FONT')
        cu.body = s; cu.size = size; cu.align_x = align; cu.resolution_u = 2; cu.extrude = depth / 2
        ob = bpy.data.objects.new('t', cu); bpy.context.scene.collection.objects.link(ob)
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        vs = [v.co.copy() for v in me.vertices]; fs = [list(p.vertices) for p in me.polygons]
        bpy.data.objects.remove(ob); bpy.data.curves.remove(cu); bpy.data.meshes.remove(me)
        st.setdefault('t', 'plastic')
        return self.add(vs, fs, M=xf(at, rot), **st)

    def tufts(self, pts, length=.05, width=.012, droop=.5, **st):
        """Fur tufts where they show in silhouette: thin three-sided spikes at
        (position, normal) pairs, pulled toward the floor by `droop`."""
        vs, fs = [], []
        for p, nrm in pts:
            p, nrm = Vector(p), Vector(nrm).normalized()
            d = (nrm + Vector((0, 0, -droop)) + Vector(self.rng.random(3) - .5) * .6).normalized()
            side = d.orthogonal().normalized() * width * (.6 + self.rng.random())
            s2 = d.cross(side)
            k = len(vs)
            vs += [p + side, p - side * .5 + s2 * .87, p - side * .5 - s2 * .87, p + d * length * (.5 + self.rng.random())]
            fs += [[k, k + 1, k + 3], [k + 1, k + 2, k + 3], [k + 2, k, k + 3]]
        st.setdefault('t', 'fur')
        return self.add(vs, fs, **st)

    # -- finishing ----------------------------------------------------------
    def finish(self, mats):
        """Cut tiled faces at swatch edges, add grime, set shading, and make
        the object. Returns it."""
        bm = bmesh.new()
        l_uv, l_col = bm.loops.layers.uv.new('UVMap'), bm.loops.layers.float_color.new('Color')
        for f in self.bm.faces:
            tile = f[self.f_tile]
            poly = [(lp.vert.co - self.pivot, Vector(lp[self.l_uv].uv), Vector(lp[self.l_col])) for lp in f.loops]
            if tile < 0: pieces = [poly]
            else:
                pieces = [q for p in _split(poly, 0) for q in _split(p, 1)]
                r = atlas.tile_rect(atlas.TILES[tile])
            for pc in pieces:
                if len(pc) < 3: continue
                if tile >= 0:
                    cu, cv = sum(q[1].x for q in pc) / len(pc), sum(q[1].y for q in pc) / len(pc)
                    bu, bv_ = math.floor(cu), math.floor(cv)
                try: nf = bm.faces.new([bm.verts.new(q[0]) for q in pc])
                except ValueError: continue
                nf.material_index = f.material_index; nf.smooth = True
                for lp, q in zip(nf.loops, pc):
                    if tile >= 0:
                        u, v = min(max(q[1].x - bu, 0), 1), min(max(q[1].y - bv_, 0), 1)
                        lp[l_uv].uv = (r[0] + u * r[2], r[1] + v * r[3])
                    else: lp[l_uv].uv = q[1]
                    col = q[2]
                    if MATS[f.material_index] not in GLOW:
                        w = q[0] + self.pivot
                        k = 1 + .14 * noise.noise(w * 2.3) + .08 * noise.noise(w * 9)   # blotchy, never one flat tone
                        if self.mount == 'floor': k *= 1 - self.grime * max(0, 1 - w.z / .3) ** 2   # floor dirt wicks up
                        col = Vector((col[0] * k, col[1] * k, col[2] * k, 1))
                    lp[l_col] = col
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-5)
        bm.normal_update()
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0) > D(38): e.smooth = False
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me); bm.free(); self.bm.free()
        used = sorted({p.material_index for p in me.polygons})
        remap = {old: new for new, old in enumerate(used)}
        for old in used: me.materials.append(mats[MATS[old]])
        idx = np.zeros(len(me.polygons), np.int32); me.polygons.foreach_get('material_index', idx)
        me.polygons.foreach_set('material_index', np.array([remap[i] for i in idx], np.int32))
        me.color_attributes.active_color = me.color_attributes['Color']
        me.color_attributes.render_color_index = 0
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = self.pivot if self.parent is None else self.pivot - self.parent.pivot
        self.obj = ob
        for k in self.kids:
            k.finish(mats).parent = ob
        return ob


def spline(pts, t):
    """A smooth curve through the points (Catmull-Rom), t in 0..1."""
    n = len(pts) - 1
    x = min(max(t, 0), 1) * n
    i = min(int(x), n - 1); f = x - i
    p0, p1, p2, p3 = (Vector(pts[max(i - 1, 0)]), Vector(pts[i]), Vector(pts[i + 1]), Vector(pts[min(i + 2, n)]))
    return tuple(.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (3 * p1 - p0 - 3 * p2 + p3) * f ** 3))


def hash_name(s):
    return int(hashlib.md5(s.encode()).hexdigest()[:8], 16)


def _planar(faces):
    """A function fitting points flat onto 0..1 across the faces' bounds, seen
    from the side their average normal points to."""
    n = sum((f.normal * f.calc_area() for f in faces), Vector()).normalized()
    upv = Vector((0, 0, 1)) if abs(n.z) < .9 else Vector((0, 1, 0))
    right = upv.cross(n).normalized(); upv = n.cross(right)
    ps = [v.co for f in faces for v in f.verts]
    us, vs = [p.dot(right) for p in ps], [p.dot(upv) for p in ps]
    u0, v0, du, dv = min(us), min(vs), (max(us) - min(us)) or 1, (max(vs) - min(vs)) or 1
    return lambda p: ((p.dot(right) - u0) / du, (p.dot(upv) - v0) / dv)


def _split(poly, ax):
    """Cut a convex polygon of (position, uv, colour) corners along every
    integer line of uv[ax] it crosses."""
    vals = [q[1][ax] for q in poly]
    lo, hi = math.floor(min(vals) + 1e-5), math.ceil(max(vals) - 1e-5)
    if hi - lo <= 1: return [poly]
    out, rest = [], poly
    for k in range(lo + 1, hi):
        below, above = [], []
        for i, a in enumerate(rest):
            b = rest[(i + 1) % len(rest)]
            da, db = a[1][ax] - k, b[1][ax] - k
            (below if da <= 0 else above).append(a)
            if (da < 0 < db) or (db < 0 < da):
                t = da / (da - db)
                mid = (a[0].lerp(b[0], t), a[1].lerp(b[1], t), a[2].lerp(b[2], t))
                mid[1][ax] = k
                below.append(mid); above.append(mid)
            elif da == 0: above.append(a)
        if len(below) >= 3: out.append(below)
        rest = above
        if len(rest) < 3: break
    if len(rest) >= 3: out.append(rest)
    return out


def fill2d(outline, holes=()):
    """Triangulate a flat outline with holes. Returns (points, triangles)."""
    tmp = bmesh.new()
    for loop in (outline, *holes):
        vs = [tmp.verts.new((x, y, 0)) for x, y in loop]
        for a, b in zip(vs, vs[1:] + vs[:1]): tmp.edges.new((a, b))
    bmesh.ops.triangle_fill(tmp, use_beauty=True, edges=list(tmp.edges))
    tmp.normal_update()
    pts = [(v.co.x, v.co.y) for v in tmp.verts]
    tris = [[v.index for v in (f.verts if f.normal.z > 0 else reversed(f.verts))] for f in tmp.faces]
    tmp.free()
    return pts, tris
