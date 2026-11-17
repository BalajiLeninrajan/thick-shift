# Mesh tools for the rhino. Everything works on plain mesh objects that sit
# at the identity transform, with their vertices in world space, until
# common.part() gives them a pivot at the very end.
#
# Two ways of making form:
#   Clay   overlapping ellipsoids and limbs, fused by a voxel remesh and
#          smoothed, so masses flow into each other. Used for flesh and plush.
#   tube / revolve / raw meshes for things that need crisp edges or exact
#          rings: horn, stitches, strands, teeth, the worm.
import bpy, bmesh, math
import numpy as np
from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree


# ---------- noise (numpy, deterministic, no dependence on Blender's) ----------

def _hash(ix, iy, iz, seed):
    n = ix * 374761393 + iy * 668265263 + iz * 1274126177 + seed * 144665
    n = (n ^ (n >> 13)) * 1103515245
    n = n ^ (n >> 16)
    return (n & 0xffff) / 32767.5 - 1.0


def vnoise(p, seed=0):
    """Value noise in [-1, 1] at points p (n, 3)."""
    p = np.asarray(p, float)
    i = np.floor(p).astype(np.int64)
    f = p - i
    u = f * f * (3 - 2 * f)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (u[:, 0] if dx else 1 - u[:, 0]) * (u[:, 1] if dy else 1 - u[:, 1]) * (u[:, 2] if dz else 1 - u[:, 2])
                out = out + w * _hash(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out


def fbm(p, octaves=3, seed=0):
    p = np.asarray(p, float)
    out, amp, tot = 0, 1.0, 0
    for o in range(octaves):
        out = out + amp * vnoise(p * 2 ** o, seed + o * 17)
        tot += amp
        amp *= .5
    return out / tot


# ---------- raw mesh access ----------

def mesh_obj(name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in verts], [], [tuple(map(int, f)) for f in faces])
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    shade_smooth(ob)
    return ob


def shade_smooth(ob):
    ob.data.polygons.foreach_set('use_smooth', [True] * len(ob.data.polygons))
    ob.data.update()


def co(ob):
    a = np.empty(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


def setco(ob, a):
    ob.data.vertices.foreach_set('co', np.asarray(a, float).ravel())
    ob.data.update()


def normals(ob):
    a = np.empty(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get('normal', a)
    return a.reshape(-1, 3)


def ntris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def activate(ob):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def modifier(ob, kind, **props):
    """Add a modifier, set its properties, apply it."""
    m = ob.modifiers.new(kind, kind)
    for k, v in props.items(): setattr(m, k, v)
    activate(ob)
    bpy.ops.object.modifier_apply(modifier=m.name)
    return ob


def decimate(ob, tris):
    n = ntris(ob)
    if n > tris: modifier(ob, 'DECIMATE', ratio=tris / n)
    shade_smooth(ob)
    return ob


def fix_normals(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data); bm.free(); ob.data.update()
    return ob


def stamp_rest(ob, force=False):
    """Store the current vertex positions in the attribute 'rest'. The
    materials read it instead of the real position, so a part can be built in
    a convenient pose, textured there, and moved into place afterwards."""
    at = ob.data.attributes.get('rest')
    if at is not None and not force: return ob
    if at is None: at = ob.data.attributes.new('rest', 'FLOAT_VECTOR', 'POINT')
    at.data.foreach_set('vector', co(ob).ravel())
    return ob


def xform(ob, m):
    stamp_rest(ob)
    ob.data.transform(m)
    ob.data.update()
    return ob


def place(at=(0, 0, 0), rot=(0, 0, 0), about=(0, 0, 0)):
    """Matrix: rotate (XYZ euler, radians) about a point, then move that point to `at`."""
    return Matrix.Translation(Vector(at)) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Translation(-Vector(about))


def mirror_x(ob, name=None):
    """A mirrored copy across x = 0, with normals fixed."""
    new = ob.copy(); new.data = ob.data.copy()
    if name: new.name = name
    bpy.context.scene.collection.objects.link(new)
    a = co(new); a[:, 0] *= -1; setco(new, a)
    at = new.data.attributes.get('rest')
    if at is not None:
        r = np.empty(len(a) * 3); at.data.foreach_get('vector', r); r = r.reshape(-1, 3); r[:, 0] *= -1
        at.data.foreach_set('vector', r.ravel())
    new.data.flip_normals()
    return new


def join(objs, name):
    """Join mesh objects into one. Every piece gets a 'rest' stamp first so
    the attribute survives the join."""
    objs = [o for o in objs if o is not None]
    for o in objs: stamp_rest(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    return ob


def setmat(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return ob


# ---------- clay ----------

_ICO = {}


def _ico(sub):
    if sub not in _ICO:
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
        v = np.array([x.co[:] for x in bm.verts])
        f = np.array([[x.index for x in fc.verts] for fc in bm.faces])
        bm.free()
        _ICO[sub] = (v, f)
    return _ICO[sub]


class Clay:
    """Collects overlapping solids, then fuses them into one skin."""

    def __init__(self):
        self.v, self.f, self.n = [], [], 0

    def ell(self, c, r, rot=None, e=2.0, sub=3):
        """Ellipsoid at c with radii r. e > 2 squares it off (a superellipsoid),
        which is what makes a costume head read as foam blocks, not a ball."""
        v, f = _ico(sub)
        v = v.copy()
        if e != 2.0: v = v * ((np.abs(v) ** e).sum(1) ** (-1 / e))[:, None]
        v = v * np.broadcast_to(np.asarray(r, float), (3,))
        if rot is not None: v = v @ np.array(Euler(rot).to_matrix()).T
        self.v.append(v + np.asarray(c, float)); self.f.append(f + self.n); self.n += len(v)
        return self

    def limb(self, pts, radii, flat=1.0):
        """A chain of balls through pts, radius interpolated. flat < 1
        squashes the balls front to back."""
        pts = np.asarray(pts, float)
        for i in range(len(pts) - 1):
            a, b, ra, rb = pts[i], pts[i + 1], radii[i], radii[i + 1]
            steps = max(2, int(np.linalg.norm(b - a) / (.4 * min(ra, rb))) + 1)
            for k in range(steps + (i == len(pts) - 2)):
                t = k / steps
                r = ra + (rb - ra) * t
                self.ell(a + (b - a) * t, (r, r * flat, r), sub=2)
        return self

    def build(self, name, voxel=.014, smooth=5):
        ob = mesh_obj(name, np.concatenate(self.v), np.concatenate(self.f))
        modifier(ob, 'REMESH', mode='VOXEL', voxel_size=voxel, adaptivity=0)
        if smooth: modifier(ob, 'SMOOTH', factor=.5, iterations=smooth)
        shade_smooth(ob)
        return ob


# ---------- sculpting on a built mesh ----------

def push(ob, c, rad, vec):
    """Move the surface near c by vec, with a gaussian falloff."""
    a = co(ob)
    w = np.exp(-(np.linalg.norm(a - np.asarray(c, float), axis=1) / rad) ** 2)
    setco(ob, a + w[:, None] * np.asarray(vec, float))


def dent(ob, c, rad, depth):
    """Press the surface in along its own normals (negative depth raises it)."""
    a, n = co(ob), normals(ob)
    w = np.exp(-(np.linalg.norm(a - np.asarray(c, float), axis=1) / rad) ** 2)
    setco(ob, a - n * (w * depth)[:, None])


def groove(ob, pts, rad, depth):
    """A dent along a polyline."""
    a, n = co(ob), normals(ob)
    pts = np.asarray(pts, float)
    d = np.full(len(a), 1e9)
    for i in range(len(pts) - 1):
        p, q = pts[i], pts[i + 1]
        t = np.clip(((a - p) @ (q - p)) / max((q - p) @ (q - p), 1e-12), 0, 1)
        d = np.minimum(d, np.linalg.norm(a - (p + t[:, None] * (q - p)), axis=1))
    setco(ob, a - n * (np.exp(-(d / rad) ** 2) * depth)[:, None])


def roughen(ob, amp, scale, seed=0, octaves=3, mask=None):
    """Noise displacement along the normals."""
    a, n = co(ob), normals(ob)
    d = fbm(a * scale, octaves, seed) * amp
    if mask is not None: d = d * mask(a)
    setco(ob, a + n * d[:, None])


def displace(ob, fn):
    """fn(positions, normals) -> offset along the normal per vertex."""
    a, n = co(ob), normals(ob)
    setco(ob, a + n * fn(a, n)[:, None])


class Surface:
    """Ray and nearest-point queries against a mesh, for laying seams,
    stitches and bands on top of it."""

    def __init__(self, ob):
        dg = bpy.context.evaluated_depsgraph_get()
        self.tree = BVHTree.FromObject(ob, dg)

    def ray(self, origin, direction):
        hit, n, _, _ = self.tree.ray_cast(Vector(origin), Vector(direction).normalized())
        return (np.array(hit), np.array(n)) if hit is not None else (None, None)

    def near(self, p):
        hit, n, _, _ = self.tree.find_nearest(Vector(p))
        return np.array(hit), np.array(n)

    def drape(self, pts, direction=None, lift=0.0):
        """Project a polyline onto the surface: along `direction` if given,
        else to the nearest point. lift moves it off along the normal."""
        out = []
        for p in pts:
            h, n = self.ray(p, direction) if direction is not None else self.near(p)
            if h is None: h, n = self.near(p)
            out.append(h + n * lift)
        return np.array(out)


# ---------- swept and turned shapes ----------

def frames(pts):
    """Tangent, normal, binormal along a polyline, without twist."""
    pts = np.asarray(pts, float)
    T = np.gradient(pts, axis=0)
    L = np.linalg.norm(T, axis=1)
    ok = np.nonzero(L > 1e-9)[0]
    # Repeated points give no direction: borrow the nearest real one, or the
    # first normal below turns into NaN and takes the whole atlas with it.
    near = ok[np.clip(np.searchsorted(ok, np.arange(len(pts))), 0, len(ok) - 1)]
    T = T[near] / L[near][:, None]
    up = np.array([0, 0, 1.0]) if abs(T[0][2]) < .9 else np.array([1.0, 0, 0])
    N = [np.cross(T[0], np.cross(up, T[0]))]
    N[0] /= np.linalg.norm(N[0])
    for i in range(1, len(pts)):
        n = N[-1] - T[i] * (N[-1] @ T[i])
        N.append(n / (np.linalg.norm(n) + 1e-12))
    N = np.array(N)
    return T, N, np.cross(T, N)


def tube(pts, radii, n=8, name='tube', caps=True, squash=1.0, phase=0.0):
    """Sweep a circle along a polyline. radii: one per point, or an array
    (points, n) to shape every ring. squash flattens the section."""
    pts = np.asarray(pts, float)
    m = len(pts)
    radii = np.asarray(radii, float)
    if radii.ndim == 0: radii = np.full(m, float(radii))
    if radii.ndim == 1: radii = np.repeat(radii[:, None], n, 1)
    T, N, B = frames(pts)
    ang = np.arange(n) / n * math.tau + phase
    verts = (pts[:, None, :] + radii[:, :, None] * (np.cos(ang)[None, :, None] * N[:, None, :] + squash * np.sin(ang)[None, :, None] * B[:, None, :])).reshape(-1, 3)
    faces = []
    for i in range(m - 1):
        for j in range(n):
            k = (j + 1) % n
            faces.append((i * n + j, i * n + k, (i + 1) * n + k, (i + 1) * n + j))
    if caps:
        verts = np.vstack([verts, pts[0], pts[-1]])
        a, b = m * n, m * n + 1
        for j in range(n):
            k = (j + 1) % n
            faces.append((a, k, j))
            faces.append((b, (m - 1) * n + j, (m - 1) * n + k))
    return mesh_obj(name, verts, faces)


def revolve(profile, n=48, name='lathe', mod=None, closed=False):
    """Turn a profile [(y, r), ...] about the Y axis. mod(i, angle) -> (dy, dr)
    reshapes ring i at each angle, for lobes and folds."""
    ang = np.arange(n) / n * math.tau
    verts, m = [], len(profile)
    for i, (y, r) in enumerate(profile):
        dy, dr = mod(i, ang) if mod else (0, 0)
        rr = r + dr
        verts.append(np.stack([rr * np.cos(ang), y + dy + ang * 0, rr * np.sin(ang)], 1))
    verts = np.concatenate(verts)
    faces = []
    for i in range(m - (0 if closed else 1)):
        i2 = (i + 1) % m
        for j in range(n):
            k = (j + 1) % n
            faces.append((i * n + j, i2 * n + j, i2 * n + k, i * n + k))
    ob = mesh_obj(name, verts, faces)
    return ob


def spline(ctrl, n=200):
    """Catmull-Rom through the control points, resampled to n points evenly
    spaced along its length. Returns (points, total length)."""
    c = np.asarray(ctrl, float)
    c = np.vstack([2 * c[0] - c[1], c, 2 * c[-1] - c[-2]])
    fine = []
    for i in range(1, len(c) - 2):
        p0, p1, p2, p3 = c[i - 1], c[i], c[i + 1], c[i + 2]
        for t in np.linspace(0, 1, 40, endpoint=False):
            fine.append(.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    fine.append(c[-2])
    fine = np.array(fine)
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(fine, axis=0), axis=1))])
    u = np.linspace(0, s[-1], n)
    return np.stack([np.interp(u, s, fine[:, k]) for k in range(3)], 1), s[-1]


def strand(top, length, r0, rng, wave=.03, drift=(0, 0, 0), n=5, segs=7, blob=0.0, name='strand'):
    """A hanging strand: a thin tapering tube from `top`, straight down with
    a little wander. blob > 0 ends it in a drop of that radius."""
    top = np.asarray(top, float)
    length = max(.03, min(length, top[2] - .03))    # stop short of the floor: a strand flattened onto it has no area to texture
    t = np.linspace(0, 1, segs)
    ph, ph2 = rng.uniform(0, 6.28, 2)
    pts = top[None, :] + np.stack([np.sin(t * 5 + ph) * wave * t, np.sin(t * 4 + ph2) * wave * t, -t * length], 1) + np.outer(t ** 1.5, drift)
    rad = r0 * (1 - .75 * t)
    if blob: rad[-2:] = [blob * .8, blob]
    return tube(pts, rad, n=n, name=name)


def tufts(surf_ob, n, length, rng, where=None, width=.012, droop=.6, name='tufts'):
    """Scatter small pointed locks of fur over a mesh: three-sided spikes
    that leave along the normal and bend toward the floor. where(p, n) -> bool
    picks the region. They break the outline so the hide stops reading as a
    smooth balloon."""
    me = surf_ob.data
    me.calc_loop_triangles()
    P = co(surf_ob)
    tri = np.array([t.vertices[:] for t in me.loop_triangles])
    nor = np.array([t.normal[:] for t in me.loop_triangles])
    cen = P[tri].mean(1)
    ok = np.ones(len(tri), bool) if where is None else where(cen, nor)
    idx = np.nonzero(ok)[0]
    if len(idx) == 0: return None
    pick = rng.choice(idx, size=min(n, len(idx)), replace=False)
    verts, faces = [], []
    for i in pick:
        base, nn = cen[i], nor[i]
        L = length * rng.uniform(.5, 1.3)
        w = width * rng.uniform(.7, 1.4)
        side = np.cross(nn, [0, 0, 1.0]); side = side / (np.linalg.norm(side) + 1e-9)
        up = np.cross(side, nn)
        mid = base + nn * L * .5 + np.array([0, 0, -1.0]) * L * droop * .25
        tip = base + nn * L * (1 - droop * .4) + np.array([0, 0, -1.0]) * L * droop + side * rng.uniform(-.3, .3) * L
        k = len(verts)
        ring = lambda c, r: [c + side * r, c - side * r * .5 + up * r * .87, c - side * r * .5 - up * r * .87]
        verts += ring(base - nn * .01, w) + ring(mid, w * .6) + [tip]
        for a in range(3):
            b = (a + 1) % 3
            faces += [(k + a, k + b, k + 3 + b, k + 3 + a), (k + 3 + a, k + 3 + b, k + 6)]
    return fix_normals(mesh_obj(name, verts, faces))


def solid(c, r, rot=None, e=2.0, sub=2, name='solid'):
    """One ellipsoid as its own mesh, not fused into anything."""
    k = Clay().ell(c, r, rot, e, sub)
    return mesh_obj(name, k.v[0], k.f[0])


def aim(d):
    """Euler that turns +z onto direction d."""
    return Vector((0, 0, 1)).rotation_difference(Vector(d).normalized()).to_euler()


def tube_rest(pts, radii, n=8, name='tube', length=None, origin=(0, 0, 0), **kw):
    """A tube whose 'rest' attribute is the same tube pulled straight along
    +z from `origin`. Materials can then draw rings and lengthwise cracks
    without caring how the real thing bends."""
    pts = np.asarray(pts, float)
    ob = tube(pts, radii, n, name, **kw)
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    if length: s = s / s[-1] * length
    straight = np.stack([np.zeros_like(s), np.zeros_like(s), s], 1) + np.asarray(origin, float)
    twin = tube(straight, radii, n, 'twin', **kw)
    at = ob.data.attributes.new('rest', 'FLOAT_VECTOR', 'POINT')
    at.data.foreach_set('vector', co(twin).ravel())
    bpy.data.objects.remove(twin)
    return ob


def loop(centre, R, r, normal=(0, -1, 0), n=28, m=6, name='loop', wobble=0.0, rng=None):
    """A torus-like ring: a tube bent round a circle of radius R facing `normal`."""
    nrm = np.asarray(normal, float); nrm /= np.linalg.norm(nrm)
    a = np.cross(nrm, [0, 0, 1.0]) if abs(nrm[2]) < .9 else np.cross(nrm, [1.0, 0, 0])
    a /= np.linalg.norm(a); b = np.cross(nrm, a)
    t = np.linspace(0, math.tau, n + 1)
    RR = R * (1 + (rng.uniform(-wobble, wobble, n + 1) if rng is not None else 0))
    if rng is not None: RR[-1] = RR[0]
    pts = np.asarray(centre, float) + (np.cos(t) * RR)[:, None] * a + (np.sin(t) * RR)[:, None] * b
    return tube(pts, r, n=m, name=name, caps=False)
