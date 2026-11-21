# Mesh and material toolkit for the guard and the prop kit.
#
# How a prop gets its look, and why:
# - Geometry is built from a few generators (chamfered boxes, lathes, tubes,
#   lofts) straight into one bmesh per part, so a prop is a short, readable
#   list of calls.
# - Surfaces use tiling textures drawn by textures.py. Props are seen from
#   arm's length by flashlight, and a tiling texture keeps about 1000 px per
#   metre on a 3 m door as well as on a mug. A baked atlas shared by every
#   prop could not.
# - What a tiling texture cannot do (one colour per object, shadow in the
#   corners, dirt near the floor) goes into vertex colour, which glTF
#   multiplies into the base colour. Mesh.grime() bakes it with ray casts.
# - One-off artwork (labels, dials, stencils, claw marks) comes from two
#   atlases and is placed with Mesh.decal().
import bpy, bmesh, json, math, os, random
from contextlib import contextmanager
from mathutils import Vector, Matrix, Euler, noise
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, 'tex')
_atlas = None


def atlas():
    global _atlas
    if _atlas is None:
        with open(os.path.join(TEX, 'atlas.json')) as f: _atlas = json.load(f)
    return _atlas


def lin(c):
    """'#rrggbb' (sRGB) or a linear tuple to a linear RGB tuple."""
    if isinstance(c, str):
        v = [int(c[i:i + 2], 16) / 255 for i in (1, 3, 5)]
        return tuple(x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in v)
    return tuple(c[:3])


# Tiling surfaces: name -> (texture set, metres per repeat, default tint)
SURF = {
    'paint': ('paint', .6, '#8a9a8a'),
    'steel': ('steel', .6, '#ffffff'),
    'rust': ('rust', .5, '#ffffff'),
    'wood': ('wood', .5, '#ffffff'),
    'cardboard': ('cardboard', .5, '#ffffff'),
    'fabric': ('fabric', .25, '#ffffff'),
    'plastic': ('plastic', .3, '#ffffff'),
    'rubber': ('rubber', .2, '#555555'),
    'knurl': ('knurl', .03, '#ffffff'),
    'bag': ('bag', .35, '#1c1c1f'),               # bin-liner film
}
# Untextured: name -> (roughness, metallic, default tint)
PLAIN = {'flat': (.7, 0, '#ffffff'), 'skin': (.62, 0, '#d9a688'), 'glass': (.08, 0, '#20262a'), 'chrome': (.25, .6, '#c8c8cc'),
         'map': (.8, 0, '#c9c2a4')}
# Drawn emissive by the game: name -> (base colour, emissive colour, decal-atlas picture?)
GLOW = {'lamp_glow': ('#fff2d0', '#ffe9b8', False), 'status_glow': ('#ff7a1a', '#ff5a10', False),
        'exit_glow': ('#ffffff', '#ffffff', True), 'screen_glow': ('#ffffff', '#ffffff', True)}

_images = {}


def image(file, colour):
    if file not in _images:
        im = bpy.data.images.load(os.path.join(TEX, file))
        if not colour: im.colorspace_settings.name = 'Non-Color'
        _images[file] = im
    return _images[file]


def material(name):
    """Get or build the material called `name`. Node trees stick to what the
    glTF exporter understands: image x vertex colour into base colour, a
    normal map, roughness and metal from the G and B of one image."""
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree; N = nt.nodes; L = nt.links
    bsdf = next(n for n in N if n.type == 'BSDF_PRINCIPLED')

    def tex(file, colour=True):
        t = N.new('ShaderNodeTexImage'); t.image = image(file, colour); return t

    def tinted(colour_socket=None):
        vc = N.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
        if colour_socket is None:
            L.new(vc.outputs['Color'], bsdf.inputs['Base Color']); return
        mx = N.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs[0].default_value = 1
        L.new(colour_socket, mx.inputs[6]); L.new(vc.outputs['Color'], mx.inputs[7])
        L.new(mx.outputs[2], bsdf.inputs['Base Color'])

    if name in SURF:
        ts = SURF[name][0]
        tinted(tex(ts + '_c.png').outputs['Color'])
        nm = N.new('ShaderNodeNormalMap'); L.new(tex(ts + '_n.png', False).outputs['Color'], nm.inputs['Color']); L.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
        sep = N.new('ShaderNodeSeparateColor'); L.new(tex(ts + '_orm.png', False).outputs['Color'], sep.inputs[0])
        L.new(sep.outputs[1], bsdf.inputs['Roughness']); L.new(sep.outputs[2], bsdf.inputs['Metallic'])
    elif name == 'decal':
        tinted(tex('decals.png').outputs['Color']); bsdf.inputs['Roughness'].default_value = .62
    elif name == 'cutout':
        t = tex('cutouts.png'); L.new(t.outputs['Color'], bsdf.inputs['Base Color'])
        gt = N.new('ShaderNodeMath'); gt.operation = 'GREATER_THAN'; gt.inputs[1].default_value = .5   # exports as alphaMode MASK
        L.new(t.outputs['Alpha'], gt.inputs[0]); L.new(gt.outputs[0], bsdf.inputs['Alpha'])
        bsdf.inputs['Roughness'].default_value = .7
    elif name == 'map':                                                # the game paints on this one, so no vertex colour
        bsdf.inputs['Base Color'].default_value = (*lin(PLAIN[name][2]), 1); bsdf.inputs['Roughness'].default_value = .8
    elif name in PLAIN:
        r, mt, _ = PLAIN[name]
        tinted(); bsdf.inputs['Roughness'].default_value = r; bsdf.inputs['Metallic'].default_value = mt
    elif name in GLOW:
        base, emit, pic = GLOW[name]
        bsdf.inputs['Roughness'].default_value = .3
        if pic:
            t = tex('decals.png'); L.new(t.outputs['Color'], bsdf.inputs['Base Color']); L.new(t.outputs['Color'], bsdf.inputs['Emission Color'])
        else:
            bsdf.inputs['Base Color'].default_value = (*lin(base), 1); bsdf.inputs['Emission Color'].default_value = (*lin(emit), 1)
        bsdf.inputs['Emission Strength'].default_value = 1
    else:
        raise KeyError(name)
    return m


def default_tint(mat):
    if mat in SURF: return SURF[mat][2]
    if mat in PLAIN: return PLAIN[mat][2]
    return '#ffffff'


def rot(rx=0, ry=0, rz=0):
    """Rotation matrix from degrees about X, then Y, then Z."""
    return Euler((math.radians(rx), math.radians(ry), math.radians(rz)), 'XYZ').to_matrix().to_4x4()


def catmull(pts, steps):
    """Smooth a polyline of n-tuples by Catmull-Rom, `steps` pieces per span."""
    if steps <= 1 or len(pts) < 3: return [tuple(p) for p in pts]
    P = [Vector(p) for p in pts]
    P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    out = []
    for i in range(1, len(P) - 2):
        for s in range(steps):
            t = s / steps
            out.append(tuple(.5 * ((2 * P[i]) + (-P[i - 1] + P[i + 1]) * t + (2 * P[i - 1] - 5 * P[i] + 4 * P[i + 1] - P[i + 2]) * t * t
                                   + (-P[i - 1] + 3 * P[i] - 3 * P[i + 1] + P[i + 2]) * t ** 3)))
    out.append(tuple(P[-2]))
    return out


# Twelve fixed directions over a hemisphere (z up) for the ambient occlusion rays.
_HEMI = [Vector((0, 0, 1))] + [Vector((math.cos(a) * math.sin(e), math.sin(a) * math.sin(e), math.cos(e)))
                              for e, k, ph in ((math.radians(45), 5, .3), (math.radians(75), 6, .9)) for a in [ph + i * math.tau / k for i in range(k)]]


class Mesh:
    """One mesh part under construction. Coordinates are the part's own
    (x right, -y front, z up, metres); at() nests placements."""

    def __init__(self, seed=1):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.col = self.bm.loops.layers.float_color.new('Col')
        self.mats = []
        self.M = Matrix.Identity(4)
        self.flip = False
        self.rng = random.Random(seed)
        self.density = 1          # texture repeats per metre, relative to the surface's default (small props want more)

    # ---- placement

    @contextmanager
    def at(self, loc=(0, 0, 0), r=(0, 0, 0), scale=(1, 1, 1)):
        """Everything built inside is moved, turned (degrees) and scaled. A
        negative scale mirrors; face winding is corrected for it."""
        old = self.M, self.flip
        s = scale if hasattr(scale, '__len__') else (scale,) * 3
        self.M = self.M @ Matrix.Translation(loc) @ rot(*r) @ Matrix.Diagonal((*s, 1))
        self.flip = self.M.to_3x3().determinant() < 0
        try: yield
        finally: self.M, self.flip = old

    # ---- low level

    def _mi(self, mat):
        if mat not in self.mats: self.mats.append(mat)
        return self.mats.index(mat)

    def _v(self, p):
        return self.bm.verts.new(self.M @ Vector(p))

    def _f(self, verts, uvs, mat, tint, smooth=False):
        if self.flip: verts, uvs = verts[::-1], uvs[::-1]
        try: f = self.bm.faces.new(verts)
        except ValueError: return None
        f.material_index = self._mi(mat); f.smooth = smooth
        c = (*lin(tint if tint is not None else default_tint(mat)), 1)
        for l, uv in zip(f.loops, uvs): l[self.uv].uv = uv; l[self.col] = c
        return f

    def _tile(self, mat):
        return (SURF[mat][1] if mat in SURF else .5) / self.density

    def _planar(self, pts, mat, n=None, grain=None, off=(0, 0)):
        """Box-projection UVs for a flat polygon (local coordinates): project
        along the axis its normal is closest to. `grain` names the local axis
        that U should run along where it can (board direction)."""
        P = [Vector(p) for p in pts]
        if n is None:
            n = Vector((0, 0, 0))
            for i in range(len(P)): n += (P[i] - P[0]).cross(P[(i + 1) % len(P)] - P[0])
        a = max(range(3), key=lambda i: abs(n[i]))
        ua, va = ((1, 2), (0, 2), (0, 1))[a]
        if grain is not None and 'xyz'.index(grain) == va: ua, va = va, ua
        t = self._tile(mat)
        return [(p[ua] / t + off[0], p[va] / t + off[1]) for p in P]

    def poly(self, pts, mat, tint=None, out=None, smooth=False, uvs=None):
        """A flat polygon. `out`: a point the face must look away from, used to
        fix the winding (handy when it is easier than thinking about order)."""
        P = [Vector(p) for p in pts]
        if out is not None:
            n = Vector((0, 0, 0))
            for i in range(1, len(P) - 1): n += (P[i] - P[0]).cross(P[i + 1] - P[0])
            if n.dot(sum(P, Vector()) / len(P) - Vector(out)) < 0:
                P.reverse()
                if uvs: uvs = uvs[::-1]
        return self._f([self._v(p) for p in P], uvs or self._planar(P, mat, off=self._off), mat, tint, smooth)

    @property
    def _off(self):
        return (self.rng.random(), self.rng.random())

    # ---- generators

    def box(self, c, size, mat, tint=None, bevel=0, seg=None, grain=None, cell=.3):
        """A box centred at c. With `bevel`, the edges are chamfered: the flat
        facet catches the flashlight the way a real folded or sawn edge does.
        Faces are split into cells of about `cell` metres so baked shadow and
        dirt have vertices to live on."""
        c = Vector(c); h = [s / 2 for s in size]
        b = min(bevel, min(h) * .9)
        seg = seg or [max(1, min(12, round(size[i] / cell))) for i in range(3)]
        off = self._off

        def quad(pts, out):
            if (pts[1] - pts[0]).cross(pts[3] - pts[0]).dot(out) < 0: pts = pts[::-1]
            w = [c + p for p in pts]
            self._f([self._v(p) for p in w], self._planar(w, mat, n=out, grain=grain, off=off), mat, tint)

        def axis(i, v):
            p = Vector((0, 0, 0)); p[i] = v; return p

        for a in range(3):
            u, v = (a + 1) % 3, (a + 2) % 3
            for s in (-1, 1):
                for i in range(seg[u]):
                    for j in range(seg[v]):
                        cu = [-(h[u] - b) + 2 * (h[u] - b) * k / seg[u] for k in (i, i + 1)]
                        cv = [-(h[v] - b) + 2 * (h[v] - b) * k / seg[v] for k in (j, j + 1)]
                        quad([axis(a, s * h[a]) + axis(u, cu[x]) + axis(v, cv[y]) for x, y in ((0, 0), (1, 0), (1, 1), (0, 1))], axis(a, s))
        if b:
            for e in range(3):                                         # the 12 chamfers
                p, q = (e + 1) % 3, (e + 2) % 3
                for s1 in (-1, 1):
                    for s2 in (-1, 1):
                        for k in range(seg[e]):
                            t = [-(h[e] - b) + 2 * (h[e] - b) * x / seg[e] for x in (k, k + 1)]
                            A = lambda tt: axis(e, tt) + axis(p, s1 * h[p]) + axis(q, s2 * (h[q] - b))
                            B = lambda tt: axis(e, tt) + axis(p, s1 * (h[p] - b)) + axis(q, s2 * h[q])
                            quad([A(t[0]), A(t[1]), B(t[1]), B(t[0])], axis(p, s1) + axis(q, s2 * .99))
            for sx in (-1, 1):                                         # the 8 corners
                for sy in (-1, 1):
                    for sz in (-1, 1):
                        s = (sx, sy, sz)
                        pts = [Vector([s[i] * (h[i] - (0 if i == k else b)) for i in range(3)]) for k in range(3)]
                        n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
                        if n.dot(Vector(s)) < 0: pts.reverse()
                        w = [c + p for p in pts]
                        self._f([self._v(p) for p in w], self._planar(w, mat, off=off), mat, tint)

    def skin(self, rings, mat, tint=None, caps=(True, True), smooth=True, closed=True):
        """Join rings of points into a tube. Rings run counter-clockwise seen
        from the far end looking back. U wraps around, V runs along."""
        n = len(rings[0]); t = self._tile(mat)
        R = [[Vector(p) for p in r] for r in rings]
        per = max(sum((r[(j + 1) % n] - r[j]).length for j in range(n if closed else n - 1)) for r in R)
        reps = max(1, round(per / t)) if closed else per / t          # whole repeats, so the seam matches
        u0, v0 = self._off
        vs = [v0]
        for i in range(1, len(R)):
            vs.append(vs[-1] + sum((R[i][j] - R[i - 1][j]).length for j in range(n)) / n / t)
        V = [[self._v(p) for p in r] for r in R]
        cols = n if closed else n - 1
        for i in range(len(R) - 1):
            for j in range(cols):
                k = (j + 1) % n
                ua, ub = u0 + reps * j / cols, u0 + reps * (j + 1) / cols
                self._f([V[i][j], V[i][k], V[i + 1][k], V[i + 1][j]], [(ua, vs[i]), (ub, vs[i]), (ub, vs[i + 1]), (ua, vs[i + 1])], mat, tint, smooth)
        if closed:
            for end, on in ((0, caps[0]), (-1, caps[1])):
                if not on: continue
                pts = R[end] if end == -1 else R[end][::-1]
                if (pts[0] - pts[n // 2]).length < 1e-5: continue
                self._f([self._v(p) for p in pts], self._planar(pts, mat, off=(u0, v0)), mat, tint)
        return V

    @staticmethod
    def _frame(t, hint=None):
        """Two unit vectors a, b with a x b = t. a leans toward `hint` (default
        +X), so an upright loft has rx as its width and ry as its depth."""
        t = t.normalized()
        hint = Vector(hint or (1, 0, 0))
        a = hint - t * hint.dot(t)
        if a.length < 1e-4: a = Vector((0, 1, 0)) - t * t.y
        a.normalize()
        return a, t.cross(a)

    def cyl(self, p0, p1, r, mat, tint=None, n=16, caps=(True, True), bevel=0):
        """A cylinder between two points."""
        p0, p1 = Vector(p0), Vector(p1)
        a, b = self._frame(p1 - p0); ax = (p1 - p0).normalized()
        ring = lambda p, rr: [p + (a * math.cos(i * math.tau / n) + b * math.sin(i * math.tau / n)) * rr for i in range(n)]
        rings = [ring(p0, r), ring(p1, r)]
        if bevel:
            rings = [ring(p0, r - bevel), ring(p0 + ax * bevel, r), ring(p1 - ax * bevel, r), ring(p1, r - bevel)]
        return self.skin(rings, mat, tint, caps)

    def lathe(self, profile, mat, tint=None, n=20, at=(0, 0, 0), caps=(True, True), arc=None):
        """Spin a profile [(radius, z), ...] about local Z. `arc` = (from, to)
        in degrees for a partial sweep (an open shell)."""
        at = Vector(at)
        if arc:
            a0, a1 = math.radians(arc[0]), math.radians(arc[1])
            angs = [a0 + (a1 - a0) * i / n for i in range(n + 1)]
        else:
            angs = [i * math.tau / n for i in range(n)]
        rings = [[at + Vector((math.cos(a) * max(r, 1e-4), math.sin(a) * max(r, 1e-4), z)) for a in angs] for r, z in profile]
        return self.skin(rings, mat, tint, caps, closed=not arc)

    def ball(self, c, r, mat, tint=None, n=16, m=9, zrange=(-1, 1)):
        """A sphere or ellipsoid (r may be three radii). zrange trims it, e.g.
        (0, 1) is a dome."""
        r = r if hasattr(r, '__len__') else (r, r, r); c = Vector(c)
        rings = []
        for i in range(m + 1):
            ph = math.asin(zrange[0]) + (math.asin(zrange[1]) - math.asin(zrange[0])) * i / m
            rr = max(math.cos(ph), 1e-3)
            rings.append([c + Vector((math.cos(j * math.tau / n) * rr * r[0], math.sin(j * math.tau / n) * rr * r[1], math.sin(ph) * r[2])) for j in range(n)])
        return self.skin(rings, mat, tint)

    def loft(self, sections, mat, tint=None, n=14, steps=3, ends=(True, True), hint=None, power=2, caps=(True, True), bulge=1):
        """A smooth organic tube through sections [(centre, rx, ry), ...]:
        limbs, torsos, cables with changing girth. `ends` rounds off each end
        instead of leaving a flat cap; `bulge` < 1 flattens that rounding (a
        cushion, not a sausage). `power` > 2 squares the cross-section."""
        S = catmull([(*c, rx, ry) for c, rx, ry in sections], steps)
        C = [Vector(s[:3]) for s in S]
        rings = []; a = None
        for i, s in enumerate(S):
            t = (C[min(i + 1, len(C) - 1)] - C[max(i - 1, 0)])
            if a is None: a, b = self._frame(t, hint)
            else:
                t = t.normalized(); a = (a - t * a.dot(t)).normalized(); b = t.cross(a)   # carry the frame along, no twist
            rings.append((C[i], a.copy(), b.copy(), s[3], s[4], t.normalized()))

        def ring(c, a, b, rx, ry):
            out = []
            for j in range(n):
                th = j * math.tau / n; cs, sn = math.cos(th), math.sin(th)
                e = 2 / power
                out.append(c + a * rx * math.copysign(abs(cs) ** e, cs) + b * ry * math.copysign(abs(sn) ** e, sn))
            return out

        R = []
        if ends[0]:
            c, a, b, rx, ry, t = rings[0]
            for ph in (80, 55, 28):
                k = math.cos(math.radians(ph)); d = math.sin(math.radians(ph)) * min(rx, ry) * bulge
                R.append(ring(c - t * d, a, b, rx * k, ry * k))
        R += [ring(c, a, b, rx, ry) for c, a, b, rx, ry, t in rings]
        if ends[1]:
            c, a, b, rx, ry, t = rings[-1]
            for ph in (28, 55, 80):
                k = math.cos(math.radians(ph)); d = math.sin(math.radians(ph)) * min(rx, ry) * bulge
                R.append(ring(c + t * d, a, b, rx * k, ry * k))
        return self.skin(R, mat, tint, caps)

    def tube(self, pts, r, mat, tint=None, n=8, steps=4):
        """A pipe, cable or cord of constant radius along a path."""
        return self.loft([(p, r, r) for p in pts], mat, tint, n=n, steps=steps, ends=(False, False))

    def decal(self, name, c, w, h, n=(0, -1, 0), up=(0, 0, 1), cut=False, off=.0015, tint=None, urep=None, usub=None, mat=None, spin=0, seg=(1, 1)):
        """A rectangle of artwork from an atlas, centred at c, facing n. `cut`
        takes it from the alpha-tested cutout sheet (stencils, scratches).
        `urep` repeats a full-width strip (the hazard stripes) that many times,
        or True for as many as keep it undistorted;
        `usub` = (from, to) uses part of the picture's width; `seg` splits the
        quad so it can follow a surface that is dented afterwards."""
        u0, v0, u1, v1 = atlas()['cutouts' if cut else 'decals'][name]
        if urep is True: urep = w / h * (v1 - v0) / (u1 - u0)        # keep the strip's own proportions
        if urep: u0, u1 = 0, urep
        if usub: u0, u1 = u0 + (u1 - u0) * usub[0], u0 + (u1 - u0) * usub[1]
        n = Vector(n).normalized(); up = Vector(up).normalized()
        right = (-n).cross(up).normalized(); up = right.cross(-n)
        if spin:
            q = Matrix.Rotation(math.radians(spin), 3, n); right, up = q @ right, q @ up
        c = Vector(c) + n * off
        mat = mat or ('cutout' if cut else 'decal')
        for i in range(seg[0]):
            for j in range(seg[1]):
                a, b, e, g = i / seg[0], (i + 1) / seg[0], j / seg[1], (j + 1) / seg[1]
                pts = [c + right * w * (x - .5) + up * h * (y - .5) for x, y in ((a, e), (b, e), (b, g), (a, g))]
                uvs = [(u0 + (u1 - u0) * x, v0 + (v1 - v0) * y) for x, y in ((a, e), (b, e), (b, g), (a, g))]
                self._f([self._v(p) for p in pts], uvs, mat, tint)

    def disc(self, name, c, r, n=(0, -1, 0), segs=24, off=.0015):
        """Round artwork (a dial, a gauge): the circle inscribed in the picture."""
        u0, v0, u1, v1 = atlas()['decals'][name]
        n = Vector(n).normalized()
        right = (-n).cross(Vector((0, 0, 1))).normalized(); up = right.cross(-n)
        c = Vector(c) + n * off
        A = [i * math.tau / segs for i in range(segs)]
        self._f([self._v(c + (right * math.cos(a) + up * math.sin(a)) * r) for a in A],
                [((u0 + u1) / 2 + math.cos(a) * (u1 - u0) / 2, (v0 + v1) / 2 + math.sin(a) * (v1 - v0) / 2) for a in A], 'decal', None)

    def shape(self, name, c, w, h, outline, n=(0, -1, 0), off=.0015):
        """Artwork cut to an outline [(x, y), ...] given in 0..1 of the picture
        (a shield badge, a rounded patch)."""
        u0, v0, u1, v1 = atlas()['decals'][name]
        n = Vector(n).normalized()
        right = (-n).cross(Vector((0, 0, 1))).normalized(); up = right.cross(-n)
        c = Vector(c) + n * off
        self._f([self._v(c + right * w * (x - .5) + up * h * (y - .5)) for x, y in outline],
                [(u0 + (u1 - u0) * x, v0 + (v1 - v0) * y) for x, y in outline], 'decal', None)

    def torus(self, R, r, mat, tint=None, n=24, m=8):
        """A ring about local Z."""
        prof = [(R + r * math.cos(a), r * math.sin(a)) for a in [-math.pi / 2 + i * math.tau / m for i in range(m + 1)]]
        self.lathe(prof, mat, tint, n=n, caps=(False, False))

    def screw(self, p, n=(0, -1, 0), r=.006, tint='#8d8d88'):
        """A screw or bolt head."""
        p = Vector(p); n = Vector(n).normalized()
        self.cyl(p - n * .002, p + n * r * .6, r, 'steel', tint, n=6)

    def wrap(self, name, r, z0, z1, a0, a1, n=10, cut=False, off=.0012):
        """Artwork wrapped round a cylinder about local Z, from angle a0 to a1
        (degrees, counter-clockwise from +X seen from above; -90 is the front)."""
        u0, v0, u1, v1 = atlas()['cutouts' if cut else 'decals'][name]
        r += off; mat = 'cutout' if cut else 'decal'
        for i in range(n):
            A = [math.radians(a0 + (a1 - a0) * k / n) for k in (i, i + 1)]
            pts = [Vector((math.cos(A[x]) * r, math.sin(A[x]) * r, z)) for x, z in ((0, z0), (1, z0), (1, z1), (0, z1))]
            ua, ub = u0 + (u1 - u0) * i / n, u0 + (u1 - u0) * (i + 1) / n
            self._f([self._v(p) for p in pts], [(ua, v0), (ub, v0), (ub, v1), (ua, v1)], mat, None, True)

    def dent(self, c, radius, depth, d=(0, 1, 0)):
        """Push every vertex near c along d, fading out with distance."""
        c = self.M @ Vector(c); d = (self.M.to_3x3() @ Vector(d)).normalized()
        for v in self.bm.verts:
            k = (v.co - c).length / radius
            if k < 1: v.co += d * depth * (1 - k * k) ** 2

    def crumple(self, amount, scale, seed=0, since=0):
        """Displace vertices (from index `since` on) by smooth noise: sagging
        card, slumped bags, bent sheet."""
        self.bm.verts.ensure_lookup_table()
        o = Vector((seed * 13.1, seed * 7.7, seed * 3.3))
        for v in self.bm.verts[since:]:
            v.co += Vector(noise.noise_vector(v.co / scale + o)) * amount

    # ---- finishing

    def grime(self, ao=.62, dist=.22, dirt=.22, ground=0):
        """Bake shadow and dirt into the vertex colours. For each face corner,
        rays over the hemisphere measure how boxed-in it is; boxed-in corners
        go dark and brown. Blotchy noise breaks up flat tints, and `ground`
        metres of the bottom get a dusty skirt."""
        bm = self.bm
        bm.normal_update()
        bvh = BVHTree.FromBMesh(bm)
        zs = [v.co.z for v in bm.verts] or [0]
        z0 = min(zs)
        skip = {i for i, m in enumerate(self.mats) if m in GLOW or m == 'cutout'}
        cache = {}
        for f in bm.faces:
            if f.material_index in skip: continue
            fc = f.calc_center_median()
            decal = self.mats[f.material_index] == 'decal'
            for l in f.loops:
                nrm = l.vert.normal if f.smooth else f.normal
                p = l.vert.co.lerp(fc, .15) + nrm * .004
                key = (round(p.x, 3), round(p.y, 3), round(p.z, 3), round(nrm.x, 1), round(nrm.y, 1), round(nrm.z, 1))
                a = cache.get(key)
                if a is None:
                    ta = nrm.orthogonal().normalized(); tb = nrm.cross(ta)
                    occ = 0
                    for h in _HEMI:
                        hit = bvh.ray_cast(p, ta * h.x + tb * h.y + nrm * h.z, dist)
                        if hit[0] is not None: occ += 1 - hit[3] / dist
                    a = cache[key] = occ / len(_HEMI)
                k = 1 - ao * min(1, a * 1.5)
                blot = .5 + .5 * noise.noise(l.vert.co * 2.3 + Vector((7.1, 3.3, 1.7)))
                k *= 1 - dirt * blot * (.4 if decal else 1)
                g = 0
                if ground: g = max(0, 1 - (l.vert.co.z - z0) / ground) * (.5 + .5 * blot)
                c = l[self.col]
                # shadowed and low corners drift toward dust brown as well as getting darker
                warm = min(1, a * 1.2 + g * .8)
                l[self.col] = (c[0] * k * (1 - .35 * g), c[1] * k * (1 - .08 * warm) * (1 - .4 * g), c[2] * k * (1 - .2 * warm) * (1 - .5 * g), 1)

    def object(self, name, grime=True, **kw):
        """Finish the mesh and link it as an object at the world origin."""
        if grime: self.grime(**kw)
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me); self.bm.free()
        for m in self.mats: me.materials.append(material(m))
        me.set_sharp_from_angle(angle=math.radians(42))
        me.color_attributes.active_color = me.color_attributes['Col']
        me.color_attributes.render_color_index = 0
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


# ---------------------------------------------------------------- the prop registry

PROPS = {}


def prop(mount, notes='', **grime):
    """Register a prop builder. The function is named after the prop and
    returns a Mesh, or (Mesh, {child name: (Mesh, pivot)}). Everything is in
    the prop's own coordinates, origin as the brief gives it. `grime` is
    passed to Mesh.grime()."""
    def deco(fn):
        PROPS[fn.__name__] = dict(fn=fn, mount=mount, notes=notes, grime=grime)
        return fn
    return deco


# ---------------------------------------------------------------- shapes shared by the guard and the props

def peaked_cap(m, tint='#262d3d', badge=True):
    """A baseball-style uniform cap. Origin is the centre of the head band's
    bottom edge; the peak points to -Y. The guard wears one and a spare hangs
    on the coat rack."""
    with m.at(scale=(1, 1.13, 1)):
        m.lathe([(.104, -.005), (.107, .0), (.106, .03)], 'fabric', tint, n=20, caps=(False, False))
        m.ball((0, 0, .03), (.106, .106, .092), 'fabric', tint, n=20, m=6, zrange=(0, 1))
    m.ball((0, 0, .122), (.012, .012, .006), 'fabric', tint, n=8, m=3)                    # the button on top
    A = [math.radians(-90 + d) for d in range(-75, 76, 15)]
    inner = [(math.cos(a) * .104, math.sin(a) * .104 * 1.13, .004) for a in A]
    reach = lambda a: max(0, math.cos((a + math.pi / 2) * 1.2))            # 1 straight ahead, 0 where the peak meets the band
    outer = [(math.cos(a) * .104 * (1 + .12 * reach(a)), math.sin(a) * .104 * 1.13 - .085 * reach(a) ** .8, -.012 - .012 * (1 - reach(a))) for a in A]
    for i in range(len(A) - 1):
        for dz, flip in ((0, False), (-.005, True)):                   # top and underside of the peak
            pts = [inner[i], inner[i + 1], outer[i + 1], outer[i]]
            pts = [(p[0], p[1], p[2] + dz) for p in pts]
            m.poly(pts[::-1] if flip else pts, 'plastic', '#1b1c20', smooth=True)
    if badge: m.decal('badge', (0, -.1195, .04), .045, .045, n=(0, -1, .12), off=.002)


def torch(m, n=24):
    """The guard's torch, 0.24 m, pointing to -Y with the origin at the middle
    of the grip. The flashlight prop and the one in the guard's hand are the
    same shape; the guard's uses fewer segments."""
    old, m.density = m.density, 5
    body = '#44474d'
    with m.at(r=(90, 0, 0)):                                           # built standing on its tail, then laid down: local +z is the beam
        m.lathe([(.011, -.118), (.0185, -.115), (.0195, -.112), (.0195, -.098), (.0178, -.095)], 'steel', body, n=n)
        with m.at((0, 0, -.124), r=(90, 0, 0)): m.torus(.008, .0016, 'chrome', n=12, m=5)                 # lanyard ring
        m.lathe([(.0178, -.095), (.0178, .028)], 'knurl', '#9a9da3', n=n, caps=(False, False))
        m.lathe([(.0178, .028), (.0192, .031), (.0192, .06), (.022, .068), (.031, .082), (.0335, .086), (.0335, .09)], 'steel', body, n=n, caps=(False, False))
        for i in range(4):                                             # cooling fins round the head
            z = .09 + i * .0065
            m.lathe([(.0335, z), (.036, z + .001), (.036, z + .0045), (.0335, z + .0055), (.0335, z + .0065)], 'steel', body, n=n, caps=(False, False))
        m.lathe([(.0335, .116), (.0352, .117), (.0352, .1225), (.031, .124), (.0295, .1195)], 'steel', '#6a6d72', n=n, caps=(False, False))
        m.lathe([(.004, .102), (.012, .104), (.0295, .1195)][::-1], 'chrome', n=n, caps=(False, False))   # reflector
        m.ball((0, 0, .106), .006, 'lamp_glow', n=8, m=4)                                                 # bulb
        m.cyl((0, 0, .1185), (0, 0, .1195), .0296, 'lamp_glow', n=n, caps=(False, True))                  # lens
        m.box((0, .0195, .046), (.013, .006, .03), 'steel', body, bevel=.002, cell=1)                     # switch, on top once laid down
        m.box((0, .0235, .05), (.008, .005, .012), 'rubber', '#b33a2a', bevel=.0015, cell=1)
        m.lathe([(.0182, -.045), (.0188, -.0445), (.0188, -.012), (.0182, -.0115)], 'plastic', '#cfc8ae', n=n, caps=(False, False))   # a wrap of masking tape
        m.lathe([(.0196, .034), (.0201, .0345), (.0201, .044), (.0196, .0445)], 'plastic', '#2a2a2c', n=n, caps=(False, False))
    m.density = old
