# Squish, the toad. Builds packages/game/public/models/toad_<stage>.glb and toad.json.
#
#   tools/models/bl tools/models/toad/build.py -- 0        one stage
#   tools/models/bl tools/models/toad/build.py -- 0 1 2    all of them
#
# Blender axes while building: x is the model's left, -y is its front, z is up.
# Stage 0 is the costume, stage 1 has lost its torso, stage 2 is a head, a
# rear and a spine hanging in the air. See stage0(), stage1(), stage2().
import bpy, json, math, os, random, sys
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import *

SKIN, BELLY, GREY = '#5f8f66', '#cfe2a8', '#313244'
DULL = (.02, .2, .32)            # how far the skin has greyed at each stage (the 2D art's numbers)
TOOTH, TOOTH_ROOT = '#ddd0a4', '#9c7a42'
MOUTH, THROAT = '#4a1218', '#070203'
HAIR, BLOOD, BONE = '#060608', '#3d080b', '#cfc4a0'


# ---------- skin ----------

def skin(P, stage, seed=0):
    """Velour green. From stage 1 it goes blotchy: sick yellow patches, dark
    damp ones, and by stage 2 bruising."""
    rgb = mixc(SKIN, GREY, DULL[stage]) * (.82 + .36 * fbm(P, 2.2, seed))[:, None]
    if stage:
        rgb = mixc(rgb, lin('#8d8a58'), sstep(.52, .68, fbm(P, 3.1, seed + 3)) * (.45 + .2 * stage))
        rgb = mixc(rgb, lin('#1d2b23'), sstep(.55, .7, fbm(P, 4.3, seed + 11)) * (.5 + .15 * stage))
    if stage == 2:
        rgb = mixc(rgb, lin('#4b3048'), sstep(.6, .75, fbm(P, 5, seed + 23)) * .6)
    return rgb


def runs(P, seed, width=45):
    """Narrow vertical streaks, 0..1: where a liquid ran down."""
    Q = P.copy(); Q[:, 2] *= .06
    return sstep(.58, .8, vnoise(Q, width, seed))


def dried(objs):
    """Mark all the blood on objs as old (kit.paint's dry): brown-black, not red."""
    for o in objs:
        a = o.data.color_attributes.get('aux')
        arr = np.empty(len(a.data) * 4, dtype=np.float32); a.data.foreach_get('color', arr)
        arr[3::4] = 1; a.data.foreach_set('color', arr)


# ---------- head ----------

def lip(H, phi, slope, inset=0.):
    """A point on the mouth line. The mouth is a flat cut that rises from the
    front of the face to the hinge, so on the curve of the head it makes a
    smile. phi is the angle round the head from straight ahead."""
    (cx, cy, cz), (rx, ry, rz) = H['c'], H['r']
    z = H['zh']
    for _ in range(4):
        k = math.sqrt(max(0, 1 - ((z - cz) / rz) ** 2))
        x, y = (rx - inset) * k * math.sin(phi), cy - (ry - inset) * k * math.cos(phi)
        z = H['zh'] - slope * (H['yh'] - y)
    return Vector((x, y, z))


def make_head(H, stage):
    """Sculpt the head and cut the mouth. Returns (head, jaw or None, warts)."""
    rng = random.Random(10 + stage)
    c, r = Vector(H['c']), H['r']
    bx, by, bz, br = H['bump']
    f = Forms()
    f.ball(c, r, sub=4)
    for sx in (-1, 1):
        f.ball((sx * bx, by, bz), br)
        f.ball((sx * bx * .85, by + .03, bz - br * .7), (br * 1.25, br * 1.15, br * .8))   # so the bump grows out of the skull
    if 'forms' in H: H['forms'](f)
    d, warts = Forms(), []
    for _ in range(H['warts']):
        while True:
            v = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-.3, 1))).normalized()
            if v.y > -.3 or v.z > .8: break                     # keep them off the face
        p = c + Vector((v.x * r[0], v.y * r[1], v.z * r[2]))
        wr = rng.uniform(.024, .052)
        d.ball(p, wr, sub=2)
        warts.append((p, wr))
    head = sculpt(f, 'head', voxel=H['voxel'], soften=H['soften'], lumps=H['lumps'], detail=d)

    far = 3.
    front = lambda s: H['zh'] - s * (H['yh'] + far)
    jaw = None
    if H['split']:
        under = lambda s: prism([(H['yh'], H['zh']), (-far, front(s)), (-far, -5), (H['yh'], -5)], 3)
        cu, cl = under(H['su']), under(H['sl'])
        jaw = head.copy(); jaw.data = head.data.copy(); bpy.context.scene.collection.objects.link(jaw)
        boolean(jaw, cl, 'INTERSECT')
        boolean(head, cu)
        delete(cu, cl)
    else:
        wedge = prism([(H['yh'], H['zh']), (-far, front(H['su'])), (-far, front(H['sl']))], 3)
        boolean(head, wedge)
        delete(wedge)
    for cc, cr in H.get('carve', []):
        b = ball(cc, cr, sub=3)
        boolean(head, b)
        if jaw and H.get('cavity') and (cc, cr) in H['cavity']: boolean(jaw, b)
        delete(b)
    decimate(head, H['tris'])
    if jaw: decimate(jaw, H['jaw_tris'])
    # Split the sharp lip edge, so the flat faces the mouth cut has its own
    # vertices and can be painted dark without bleeding onto the lip.
    for o in (head, jaw):
        if o is None: continue
        m = o.modifiers.new('es', 'EDGE_SPLIT'); m.split_angle = math.radians(40); m.use_edge_sharp = False
        apply_mods(o)
    return head, jaw, warts


def paint_head(o, H, stage, warts):
    c, r = np.array(H['c']), np.array(H['r'])
    bx, by, bz, br = H['bump']

    def fn(P, N):
        q = (P - c) / r
        rho = np.linalg.norm(q, axis=1)
        inb = np.minimum(*[np.linalg.norm(P - np.array((sx * bx, by, bz)), axis=1) / br for sx in (-1, 1)])
        inward = np.einsum('ij,ij->i', N, q) < 0
        lipz = H['zh'] - H['sl'] * (H['yh'] - P[:, 1])
        lipu = H['zh'] - H['su'] * (H['yh'] - P[:, 1])
        # the flat faces the mouth cut left: they face up or down, not inward, so find them by the planes
        # the flat faces the mouth cut left: on one of the two planes and facing along its normal (the lip edge is split, see make_head)
        plane = lambda s_: np.abs(N @ (np.array((0, -s_, 1)) / math.hypot(1, s_))) > .9
        cut = (P[:, 1] < H['yh'] + .01) & (((np.abs(P[:, 2] - lipz) < .01) & plane(H['sl'])) | ((np.abs(P[:, 2] - lipu) < .01) & plane(H['su'])))
        inside = ((rho < .9) | (inward & (rho < .985))) & (inb > 1.02)
        mw = (inside | cut).astype(float)                                           # how much of the mouth's paint a vertex gets
        rgb = skin(P, stage)
        rgb = rgb * (1 - .3 * sstep(.1, .9, q[:, 2]))[:, None]                      # darker on top, like the animal
        throat = sstep(.0, .1, lipz - P[:, 2]) * sstep(.25, -.25, q[:, 1]) * (inb > 1.05)
        rgb = mixc(rgb, mixc(BELLY, GREY, DULL[stage] * 1.3), throat * (.9 - .15 * stage))
        rough, fuzz, blood = np.full(len(P), .93), np.ones(len(P)), np.zeros(len(P))
        seams = []
        if stage < 2: seams.append((np.abs(P[:, 0]) + (mw > .5) * 1, P[:, 2] - P[:, 1]))       # the costume's centre seam
        for p, wr in warts:                                                           # sewn-on warts, darker, each with its ring of stitches
            dist = np.linalg.norm(P - np.array(p), axis=1)
            rgb = mixc(rgb, mixc(SKIN, '#22331f', .55 + .1 * stage), sstep(wr * 1.15, wr * .7, dist) * .8)
            if stage < 2:
                near = dist < wr * 2.2
                ang = np.arctan2(P[:, 0] - p[0], P[:, 2] - p[2]) * wr
                seams.append((np.where(near, np.abs(dist - wr * 1.2), 1), ang))
        if stage == 0:
            for sx in (-1, 1):                                                        # blush
                bp = lip(H, sx * .72, H['su']) + Vector((0, 0, .13))          # on the cheeks, where the front view sees it
                rgb = mixc(rgb, lin('#e58a9c'), sstep(.17, .05, np.linalg.norm(P - np.array(bp), axis=1)) * .75)
        if stage == 1:
            # the first bloodstain: from the lower lip, down the chin, off centre
            below = lipz - P[:, 2]
            blood = np.exp(-((P[:, 0] + .22) / .3) ** 2) * sstep(.42, .0, below) * (below > -.03) * (q[:, 1] < 0) * (.45 + .5 * runs(P, 4))
        if stage == 2:
            # Old blood only, and little of it (all of it is dried, see stage2): a few runs down from
            # the lower lip, never a band along it, and the torn underside. A red line round the mouth
            # or the eyes reads as a cartoon outline, not as a wound.
            below = lipz - P[:, 2]
            drips = runs(P, 4) * sstep(.3, .0, below) * (below > 0) * (q[:, 1] < .2) * .9
            tear = sstep(-.6, -.95, q[:, 2]) * .7 + sstep(.3, .0, np.linalg.norm((P - np.array(H['tear_c'])) / np.array(H['tear_r']), axis=1) - 1) * .6
            blood = np.maximum(drips, tear)
            for sx in (-1, 1):
                # The costume's eyes are gone and the real ones sit in the holes: no lids, so the skin
                # round each one has shrunk back into a dark sunken hollow, wet at the edge.
                sc_, sr = H['socket'](sx)
                ds = np.linalg.norm(P - np.array(sc_), axis=1) / sr
                rgb = rgb * (1 - .5 * sstep(1.75, 1.1, ds))[:, None]
                rgb = mixc(rgb, lin('#211814'), sstep(1.32, 1.06, ds) * (.65 + .35 * fbm(P, 20, 7 + sx)))
                rgb = mixc(rgb, lin('#040303'), (ds < 1.04) * 1.)
                rough = np.where(ds < 1.3, .18, rough); fuzz = np.where(ds < 1.3, .1, fuzz)
            # one dried track down the cheek from the inner corner of the right eye, the one that stares
            sc_, sr = H['socket'](-1)
            wob = sc_[0] + sr * .45 + .025 * np.sin(P[:, 2] * 19)
            track = sstep(.03, .008, np.abs(P[:, 0] - wob)) * sstep(sc_[2] - sr * .85, sc_[2] - sr * 1.1, P[:, 2]) * sstep(H['zh'] - .08, H['zh'] + .1, P[:, 2]) * (N[:, 1] < -.2)
            blood = np.maximum(blood, track * .85)
        # inside the mouth
        deep = sstep(.85, .45, rho)
        mouth = mixc(MOUTH, '#160b09', .6) if stage == 2 else lin(MOUTH)          # by stage 2 the lining has dried dark, no red at the lip
        rgb = mixc(rgb, mixc(mouth, THROAT, deep), mw)
        rough = rough + (.28 - rough) * mw; fuzz = fuzz + (.25 - fuzz) * mw
        if stage: blood = blood + (.3 + .3 * fbm(P, 9, 2) - blood) * mw
        sd, su = nearest_seam(*seams) if seams else (1, 0)
        return dict(rgb=rgb, rough=rough, fuzz=fuzz, blood=blood, seam=sd, seam_u=su)
    return paint(o, fn)


def teeth(H, stage, upper, n, size, span, seed):
    """A row of flat human teeth set into the lip, slightly uneven. Returns one mesh."""
    rng = random.Random(seed)
    w, h, dpt = size
    out = []
    for i in range(n):
        phi = span * ((i + .5) / n * 2 - 1)
        p = lip(H, phi, H['su'] if upper else H['sl'], inset=.05 + rng.uniform(-.006, .006))
        nx, ny = math.sin(phi) / H['r'][0], -math.cos(phi) / H['r'][1]
        th = h * rng.uniform(.8, 1.12)
        tw = w * rng.uniform(.86, 1.0)
        sgn = -1 if upper else 1
        root = p.z - sgn * .03
        t = box((tw, dpt, th + .03), at=(p.x, p.y, root + sgn * (th + .03) / 2),
                rot=(rng.uniform(-.1, .1), rng.uniform(-.07, .07), math.atan2(nx, -ny) + rng.uniform(-.08, .08)), bevel=min(tw, dpt) * .3, segments=2)
        bloody = stage == 2 and rng.random() > .7
        cut = rng.uniform(.3, .6)

        def fn(P, N, root=root, sgn=sgn, th=th, bloody=bloody, cut=cut, i=i):
            along = (P[:, 2] - root) * sgn / th                                       # 0 at the gum, 1 at the edge
            rgb = mixc(TOOTH_ROOT, TOOTH, sstep(.05, .6, along)) * (.85 + .3 * vnoise(P, 60, i))[:, None]
            if stage: rgb = mixc(rgb, lin('#5a4424'), sstep(.5, .8, vnoise(P, 35, i + 40)) * .5)   # stained
            blood = (along > cut) * .75 if bloody else 0
            return dict(rgb=rgb, rough=.3, fuzz=.1, blood=blood)
        out.append(paint(t, fn))
    return join(out[0], out[1:])


def torus(c, R, r, axis='y', name='ring', major=28, minor=6):
    bm = bmesh.new()
    rings = []
    for i in range(major):
        a = i / major * math.tau
        ring = []
        for k in range(minor):
            b = k / minor * math.tau
            rad, off = R + r * math.cos(b), r * math.sin(b)
            ring.append(bm.verts.new(Vector(c) + (Vector((rad * math.cos(a), off, rad * math.sin(a))) if axis == 'y' else Vector((rad * math.cos(a), rad * math.sin(a), off)))))
        rings.append(ring)
    for i in range(major):
        a, b = rings[i], rings[(i + 1) % major]
        for k in range(minor): bm.faces.new((a[k], a[(k + 1) % minor], b[(k + 1) % minor], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm_obj(bm, name)


def googly(c, r, stage, sx):
    """A plastic costume eye: white ball, loose black pupil, a moulded rim.
    Returns (eye, glint, rim). The rim belongs to the head; the glint is the
    eye_glow point and is joined to the eye after the bake."""
    c = Vector(c)
    off = stage == 1 and sx > 0                    # by stage 1 the left pupil has slid and no longer points where the right one does
    yaw, pitch, pr = (.5, .42, r * .34) if off else (0, 0, r * .46)
    look = Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), -math.sin(pitch)))
    eye = ball(c, r, sub=3, name='eye')
    pupil = ball(c + look * r * .93, (pr, r * .13, pr), rot=(-pitch, 0, yaw), sub=3)
    white = mixc('#f1ece0', '#b9ab78', .45 * stage)

    def fe(P, N):
        rgb = np.tile(white, (len(P), 1)) * (.9 + .15 * fbm(P, 30, 3))[:, None]
        if stage: rgb = mixc(rgb, lin('#6b5a36'), sstep(.5, .75, fbm(P, 14, 8)) * .6)
        return dict(rgb=rgb, rough=.16 + .2 * stage, fuzz=.12)
    paint(eye, fe)
    paint(pupil, lambda P, N: dict(rgb=lin('#050506'), rough=.1, fuzz=.05))
    join(eye, [pupil])
    glint = ball(c + look * r * 1.02 + Vector((-.3 * pr, 0, .35 * pr)), pr * .2, sub=2, name='glint')
    glint.data.materials.append(glow_material())
    rim = torus(c + Vector((0, -.02, 0)), r * .99, r * .12)
    paint(rim, lambda P, N: dict(rgb=mixc('#1b2a1e', '#0b0b0d', .3), rough=.4, fuzz=.1))
    return eye, glint, rim


def stare(c, r, gaze, pupil, iris, iris_col, seed):
    """A real eyeball, wet and lidless, for stage 2: pale white, a domed cornea,
    an iris and a round pupil. pupil and iris are angular radii (radians) about
    gaze. The sphere is built with its pole on the gaze and rings placed on the
    pupil's and the iris's edges, so a pinprick stays a sharp dot through the
    bake instead of smearing over a 1 cm vertex grid. Returns (eye, glint)."""
    c, gz = Vector(c), Vector(gaze).normalized()
    M = gz.to_track_quat('Z', 'X').to_matrix()           # up on x: the gaze is close to -y, which would make 'Y' degenerate
    dome = lambda t: 1 + .045 * max(0, 1 - (t / iris) ** 2)                       # the cornea stands proud of the white
    fill = lambda a, b, step: [a + (b - a) * i / n for n in [max(1, math.ceil((b - a) / step))] for i in range(1, n)]
    e1, e2 = .01, .014
    th = [*fill(0, pupil - e1, .1), pupil - e1, pupil + e1, *fill(pupil + e1, iris - e2, .07), iris - e2, iris + e2, *fill(iris + e2, math.pi, .14)]
    seg = 48
    bm = bmesh.new()
    point = lambda t, a: c + M @ Vector((math.sin(t) * math.cos(a), math.sin(t) * math.sin(a), math.cos(t))) * r * dome(t)
    front, back = bm.verts.new(point(0, 0)), bm.verts.new(c - gz * r)
    rings = [[bm.verts.new(point(t, k / seg * math.tau)) for k in range(seg)] for t in th]
    for k in range(seg):
        k1 = (k + 1) % seg
        bm.faces.new((front, rings[0][k], rings[0][k1]))
        for a, b in zip(rings, rings[1:]): bm.faces.new((a[k], b[k], b[k1], a[k1]))
        bm.faces.new((rings[-1][k], back, rings[-1][k1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    eye = bm_obj(bm, 'eye')
    ax, ay = np.array(M.col[0]), np.array(M.col[1])

    def fe(P, N):
        v = P - np.array(c)
        u = v / np.linalg.norm(v, axis=1)[:, None]
        t = np.arccos(np.clip(u @ np.array(gz), -1, 1))
        phi = np.arctan2(u @ ay, u @ ax)
        # the white: a dead, bluish pale at the front, yellowing and veined toward the back
        rgb = mixc('#ebe8de', '#a3946c', sstep(.8, 1.7, t) * .7) * (.92 + .1 * fbm(P, 30, seed))[:, None]
        rgb = mixc(rgb, lin('#7a5048'), sstep(.62, .78, fbm(P, 26, seed + 1)) * sstep(.9, 1.5, t) * .55)
        # the iris: fibres running out from the pupil, a dark ring at its edge
        Q = np.column_stack([np.cos(phi) * 3, np.sin(phi) * 3, t * .4])
        ir = mixc(iris_col, lin(iris_col) * .45, sstep(.35, .75, vnoise(Q, 9, seed + 2)))
        ir = ir * (1 - .65 * sstep(iris - .1, iris - e2, t))[:, None]
        rgb = mixc(rgb, ir, sstep(iris + e2, iris - e2, t))
        rgb = mixc(rgb, lin('#010102'), sstep(pupil + e1, pupil - e1, t))
        return dict(rgb=rgb, rough=np.where(t < iris, .03, .07), fuzz=0)
    paint(eye, fe)
    # the catchlight: just up and to the model's right of the pupil, the same way on both eyes, as if from one lamp
    gl = (gz + Vector((-.1, 0, .22))).normalized()
    glint = ball(c + gl * r * dome(gl.angle(gz)) * .995, .011, sub=2, name='glint')
    glint.data.materials.append(glow_material())
    return eye, glint


def strands(name, roots, length, seed, col=HAIR, r0=.006, blood=0.):
    """A bundle of thin hanging strands, as geometry so it shows in silhouette.
    roots: where each one starts. The node's pivot is their average."""
    rng = random.Random(seed)
    out = []
    for p in roots:
        p = Vector(p)
        L = length * rng.uniform(.4, 1)
        n = 6
        pts, rad = [], []
        dx, dy = rng.uniform(-.03, .03), rng.uniform(-.03, .03)
        ph = rng.uniform(0, 6)
        for k in range(n + 1):
            t = k / n
            pts.append(p + Vector((dx * t + math.sin(ph + t * 5) * .008, dy * t + math.cos(ph + t * 4) * .008, -L * t)))
            rad.append(r0 * (1 - .7 * t) * (1.6 if k == 0 else 1))
        out.append(tube_mesh(pts, rad, sides=4))
        if rng.random() < .5:                                                     # a bead of something at the end
            out.append(ball(pts[-1], (r0 * 1.1, r0 * 1.1, r0 * 1.9), sub=1))
    o = join(out[0], out[1:])
    o.name = name
    paint(o, lambda P, N: dict(rgb=lin(col), rough=.22, fuzz=0, blood=blood))
    pivot = sum((Vector(p) for p in roots), Vector()) / len(roots)
    return o, pivot


def zip_down(o, zs, rng):
    """Zip teeth and a pull tab down the back, laid on the sculpted surface."""
    out = []
    for i, z in enumerate(zs):
        loc, nor = hit(o, (0, 3, z), (0, -1, 0))
        if loc is None: continue
        a = math.atan2(nor.z, nor.y)
        out.append(box((.017, .01, .008), at=loc + nor * .003 + Vector(((i % 2 - .5) * .008, 0, 0)), rot=(a, 0, 0)))
        if i == 0: out.append(box((.022, .008, .06), at=loc + nor * .012 + Vector((0, 0, -.03)), rot=(a + .25, 0, .1), bevel=.003))
    if not out: return None
    z = join(out[0], out[1:])
    return paint(z, lambda P, N: dict(rgb=lin('#8f8668') * (.7 + .5 * vnoise(P, 90, 1))[:, None], rough=.32, fuzz=0))


def body_seams(P, stage):
    """The zip's tape down the back, as a stitched seam."""
    back = P[:, 1] > 0
    return (np.where(back, np.abs(np.abs(P[:, 0]) - .018), 1), P[:, 2])


# ---------- stage 0: the costume as built ----------

def stage0():
    rng = random.Random(0)
    H = dict(c=(0, -.08, 1.62), r=(1.05, .68, .41), bump=(.5, -.02, 1.86, .27), yh=-.545, zh=1.6, su=1.0, sl=1.45, split=False,
             warts=46, voxel=.018, soften=10, lumps=[(.5, .03), (.12, .008)], tris=21000)
    # nostrils
    H['carve'] = [((sx * .07, -.75, 1.6), .022) for sx in (-1, 1)]
    H['forms'] = lambda f: [f.ball((sx * .72, -.42, 1.55), (.22, .2, .16)) for sx in (-1, 1)]     # cheeks
    head, _, warts = make_head(H, 0)
    paint_head(head, H, 0, warts)
    # the mesh panel a wearer sees out through: a dark shell just behind the smile
    panel = ball(H['c'], tuple(v - .045 for v in H['r']), sub=5, name='panel')
    bm = bmesh.new(); bm.from_mesh(panel.data)
    keep = lambda v: v.co.y < H['yh'] + .1 and abs(v.co.z - (H['zh'] - 1.2 * (H['yh'] - v.co.y))) < .12
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep(v)], context='VERTS')
    bm.to_mesh(panel.data); bm.free()
    paint(panel, lambda P, N: dict(rgb=lin('#0d0d12'), rough=.6, fuzz=.3, weave=1))
    eyes = {}
    rims = []
    for sx, side in ((1, 'L'), (-1, 'R')):
        bx, by, bz, br = H['bump']
        c = (sx * bx, by - .19, bz + .04)                                # big and forward on the bump, so they read from the floor
        eye, glint, rim = googly(c, .25, 0, sx)
        eyes[side] = (eye, glint, c)
        rims.append(rim)
    hz = zip_down(head, [1.93 - i * .016 for i in range(40)], rng)
    join(head, [panel, hz] + rims)

    # body: a short torso on very wide hips, and the rear
    f = Forms()
    f.ball((0, .05, .84), (.99, .62, .45), sub=4)                      # hips: wider than tall
    for sx in (-1, 1):
        f.ball((sx * .43, .45, .8), (.5, .47, .46))                    # the rear, one lobe a side
        f.ball((sx * .8, .1, .78), (.3, .42, .36))                     # saddle of the hip
    f.ball((0, 0, 1.22), (.72, .52, .42))                              # torso
    f.ball((0, -.3, 1.02), (.56, .36, .4))                             # belly
    body = sculpt(f, 'body', voxel=.02, soften=7, lumps=[(.45, .03), (.1, .006)])
    decimate(body, 15000)

    def fb(P, N):
        rgb = skin(P, 0, 5)
        e = np.sqrt((P[:, 0] / .5) ** 2 + ((P[:, 2] - 1.0) / .46) ** 2)
        belly = sstep(1.0, .93, e) * (N[:, 1] < .1) * (P[:, 1] < 0)
        rgb = mixc(rgb, lin(BELLY), belly)
        patch = (np.where(P[:, 1] < 0, np.abs(e - 1) * .45, 1), np.arctan2(P[:, 0], P[:, 2] - 1.0) * .45)
        sd, su = nearest_seam(patch, body_seams(P, 0))
        return dict(rgb=rgb, rough=.93, fuzz=1, seam=sd, seam_u=su)
    paint(body, fb)
    bz_ = zip_down(body, [1.2 - i * .016 for i in range(22)], rng)
    join(body, [bz_])

    limbs = {}
    for sx, side in ((1, 'L'), (-1, 'R')):
        sh, wr = (sx * .72, -.05, 1.26), (sx * .93, -.22, .86)
        f = Forms().tube([sh, wr], [.17, .125])
        f.ball((sx * .95, -.25, .78), (.16, .17, .18))                 # mitten
        f.ball((sx * .86, -.36, .8), (.07, .09, .08))                  # thumb
        arm = sculpt(f, 'arm', voxel=.014, soften=5, lumps=[(.2, .012)])
        decimate(arm, 2600)

        def fa(P, N, wr=wr, sx=sx):
            d = np.abs(P[:, 2] - (wr[2] + .03) + (P[:, 0] * sx - .93) * .5)
            return dict(rgb=skin(P, 0, 7 + sx), seam=d, seam_u=P[:, 1] + P[:, 0])
        limbs['arm_' + side] = (paint(arm, fa), sh)
        hip, ank = (sx * .46, .02, .62), (sx * .5, -.04, .16)
        f = Forms().tube([hip, ank], [.29, .22])
        f.ball((sx * .53, -.26, .1), (.27, .42, .115))                 # big flat foot
        for k in (-1, 0, 1): f.ball((sx * .53 + k * .17, -.6 + abs(k) * .05, .08), (.1, .13, .075))
        leg = sculpt(f, 'leg', voxel=.016, soften=5, lumps=[(.3, .015)])
        flatten_floor(leg)
        decimate(leg, 3800)

        def fl(P, N, sx=sx):
            rgb = skin(P, 0, 9 + sx)
            sole = sstep(.05, .0, P[:, 2])
            rgb = mixc(rgb, lin('#20241f'), sole * .7)                 # grubby soles
            d = np.abs(P[:, 2] - .2 - (P[:, 1] + .05) * .3) + (P[:, 1] < -.35)
            return dict(rgb=rgb, seam=d, seam_u=P[:, 0] + P[:, 1])
        limbs['leg_' + side] = (paint(leg, fl), hip)

    root = empty('root')
    body = part(body, 'body', root, (0, .05, .85))
    head = part(head, 'head', body, (0, 0, 1.32))
    baked, glows = [body, head], []
    for side, (eye, glint, c) in eyes.items():
        e = part(eye, 'eye_' + side, head, c)
        baked.append(e); glows.append((e, glint))
    for name, (o, pivot) in limbs.items(): baked.append(part(o, name, body, pivot))
    notes = ("The costume, intact. No jaw: the smile is a fixed slot with a mesh panel behind it. Walk: a slow, heavy waddle, "
             "body rolling side to side over the hips, legs swinging about +-20 degrees on x, arms barely moving. Idle: sway, and "
             "let eye_L and eye_R drift separately; they never blink. Attack or jumpscare: pitch head down 15 to 20 degrees so the "
             "smile fills the view, raise both arms (arm x to about -70). Limits: head +-25 on y (yaw) and +-20 on x before the "
             "torso shows under the rim; arms +-80 on x, +-30 on z; legs +-35 on x. The zip runs down the back of head and body, "
             "so a head yaw past 25 visibly breaks it.")
    return dict(root=root, baked=baked, glows=glows, face=(0, 1.62, .72), radius=1.1, floats=False, notes=notes)


# ---------- stage 1: off ----------

def stage1():
    rng = random.Random(1)
    H = dict(c=(0, -.05, 1.22), r=(.98, .64, .40), bump=(.47, 0, 1.45, .26), yh=-.38, zh=1.22, su=.3, sl=1.3, split=True,
             warts=40, voxel=.018, soften=9, lumps=[(.45, .05), (.14, .016)], tris=19000, jaw_tris=4500)
    cav = ((0, -.4, 1.06), (.76, .17, .15))
    H['cavity'] = [cav]
    H['carve'] = [cav] + [((sx * .07, -.7, 1.24), .022) for sx in (-1, 1)]
    # the face has started to slide: one cheek hangs, the brow sags over the right eye
    H['forms'] = lambda f: (f.ball((.7, -.4, 1.12), (.24, .2, .2)), f.ball((-.7, -.38, 1.2), (.2, .18, .15)), f.ball((-.42, -.3, 1.5), (.3, .2, .12)))
    head, jaw, warts = make_head(H, 1)
    paint_head(head, H, 1, warts)
    paint_head(jaw, H, 1, [])
    join(head, [teeth(H, 1, True, 15, (.07, .085, .028), 1.0, 21)])
    join(jaw, [teeth(H, 1, False, 13, (.068, .06, .026), .92, 22)])
    eyes, rims = {}, []
    for sx, side in ((1, 'L'), (-1, 'R')):
        bx, by, bz, br = H['bump']
        c = (sx * bx, by - .16, bz + .03 - (.04 if sx > 0 else 0))        # the left eye sits lower
        eye, glint, rim = googly(c, .21 if sx > 0 else .19, 1, sx)
        eyes[side] = (eye, glint, c)
        rims.append(rim)
    hz = zip_down(head, [1.52 - i * .016 for i in range(34)], rng)
    join(head, [hz] + rims)
    sways = []
    for i, (a, b, n) in enumerate(((-.75, -.3, 4), (-.15, .35, 4), (.5, .85, 3))):
        roots = [lip(H, a + (b - a) * (k + rng.random() * .6) / n, H['su'], inset=.03) + Vector((0, 0, .01)) for k in range(n)]
        sways.append(strands(f'sway_{i + 1}', roots, .55, 30 + i))

    # what is left of the body: the hips, the rear and a slack sack of belly
    f = Forms()
    f.ball((0, .12, .72), (.9, .6, .42), sub=4)
    for sx in (-1, 1):
        f.ball((sx * .4, .5, .69), (.48, .45, .45))
        f.ball((sx * .72, .15, .68), (.3, .42, .34))
        f.ball((sx * .6, -.1, .98), .17)                               # shoulders, straight out of the hips
    f.ball((0, .05, 1.0), (.5, .4, .28))
    f.ball((.05, -.24, .6), (.5, .34, .3))                             # belly, empty and hanging
    body = sculpt(f, 'body', voxel=.02, soften=6, lumps=[(.4, .05), (.12, .015)])
    decimate(body, 13000)

    def fb(P, N):
        rgb = skin(P, 1, 5)
        e = np.sqrt((P[:, 0] / .46) ** 2 + ((P[:, 2] - .62) / .3) ** 2)
        rgb = mixc(rgb, mixc(BELLY, GREY, .3), sstep(1.0, .9, e) * (P[:, 1] < -.1) * .8)
        sd, su = body_seams(P, 1)
        return dict(rgb=rgb, rough=.9, fuzz=1, seam=sd, seam_u=su, blood=sstep(.3, .0, np.linalg.norm(P - np.array((-.2, -.5, .8)), axis=1)) * .7 * (.5 + runs(P, 9)))
    paint(body, fb)

    limbs = {}
    for sx, side in ((1, 'L'), (-1, 'R')):
        # arms: long, thin, elbows out, fingers on the floor
        sh, el, wr = Vector((sx * .62, -.12, .98)), Vector((sx * 1.0, -.5, .72)), Vector((sx * .8, -.76, .27))
        upper = sculpt(Forms().tube([sh, el], [.085, .05]).ball(el, .062), 'arm', voxel=.011, soften=3, lumps=[(.15, .012)])
        decimate(upper, 1500)
        f = Forms().tube([el, wr], [.058, .034]).ball(el, .06).ball(wr + Vector((0, -.02, -.03)), (.06, .045, .07))
        for k in range(4):
            spread = (k - 1.5) * .05
            k0 = wr + Vector((spread * .6, -.03, -.07))
            k1 = wr + Vector((spread * 1.3 + sx * .01, -.1 - rng.uniform(0, .03), -.17))
            tip = Vector((wr.x + spread * 2.2, wr.y - .13 - rng.uniform(0, .05), .012))
            f.tube([k0, k1, tip], [.02, .016, .009])
            f.ball(k1, .021)
        f.tube([wr + Vector((-sx * .04, 0, -.03)), wr + Vector((-sx * .11, .02, -.12))], [.02, .011])       # thumb
        fore = sculpt(f, 'forearm', voxel=.0065, soften=2, lumps=[(.1, .006)])
        flatten_floor(fore)
        decimate(fore, 3200)

        def fa(P, N, sx=sx):
            rgb = skin(P, 1, 7 + sx)
            rgb = mixc(rgb, lin('#15140f'), sstep(.3, .0, P[:, 2]) * .75)          # hands black with floor dirt
            return dict(rgb=rgb, rough=.85, fuzz=.8)
        limbs['arm_' + side] = (paint(upper, fa), sh, 'body')
        limbs['forearm_' + side] = (paint(fore, fa), el, 'arm_' + side)
        # legs: thighs straight out sideways like a frog's, knees high
        hip, kn, an = Vector((sx * .6, .14, .64)), Vector((sx * 1.03, .08, 1.04)), Vector((sx * .97, -.2, .1))   # knees out past the hips and up by the head
        thigh = sculpt(Forms().tube([hip, kn], [.19, .11]).ball(kn, .12), 'leg', voxel=.014, soften=4, lumps=[(.2, .02)])
        decimate(thigh, 1800)
        f = Forms().tube([kn, an], [.1, .06]).ball(kn, .115)
        f.ball(an + Vector((sx * .01, -.12, -.05)), (.085, .2, .05))
        for k in (-1, 0, 1):
            f.tube([an + Vector((0, -.2, -.06)), Vector((an.x + k * .1 + sx * .03, -.62 + abs(k) * .06, .03))], [.045, .028])
            f.ball((an.x + k * .1 + sx * .03, -.62 + abs(k) * .06, .03), .036)
        shin = sculpt(f, 'shin', voxel=.012, soften=3, lumps=[(.15, .012)])
        flatten_floor(shin)
        decimate(shin, 2800)

        def fl(P, N, sx=sx):
            rgb = skin(P, 1, 9 + sx)
            rgb = mixc(rgb, lin('#15140f'), sstep(.14, .0, P[:, 2]) * .7)
            return dict(rgb=rgb, rough=.88, fuzz=.9)
        limbs['leg_' + side] = (paint(thigh, fl), hip, 'body')
        limbs['shin_' + side] = (paint(shin, fl), kn, 'leg_' + side)

    root = empty('root')
    body = part(body, 'body', root, (0, .12, .72))
    head = part(head, 'head', body, (0, .05, .95))
    jaw = part(jaw, 'jaw', head, (0, H['yh'], H['zh']))
    baked, glows, made = [body, head, jaw], [], {'body': body}
    for side, (eye, glint, c) in eyes.items():
        e = part(eye, 'eye_' + side, head, c)
        baked.append(e); glows.append((e, glint))
    for o, pivot in sways: baked.append(part(o, o.name, head, pivot))
    for name, (o, pivot, parent) in limbs.items():
        made[name] = part(o, name, made[parent], pivot)
        baked.append(made[name])
    notes = ("The torso is gone: the head sits on the hips and everything hangs from it. jaw is a chin flap hinged at the mouth "
             "corners; rest is a 12 cm grin, jaw x 0 to 0.6 opens it (past 0.6 the flap comes away from the cheeks). sway_1 to sway_3 "
             "are black strands on the upper lip, left to right as you face it; swing them a few degrees, more when it moves. The "
             "eyes no longer agree by construction: eye_L sits lower, has a smaller pupil and its pupil is off axis, so aim eye_R "
             "at the player and let eye_L follow late or not at all. Walk: a frog's crawl. Thighs stick out sideways, so step by "
             "turning leg on y (+-25) and shin on x (+-30); the hands walk on their fingertips, arm x +-30 with forearm x +-40. "
             "Body stays low and level, head bobs late. Idle: still, then one jerk of the head. Attack: arms up and forward (arm x "
             "-80, forearm x -50), jaw 0.6, head pitched 20 degrees down. Limits: head +-20 any axis; arm +-60; forearm +-70; leg "
             "+-35; shin +-45. The zip on the back of the head ends at the hips.")
    return dict(root=root, baked=baked, glows=glows, face=(0, 1.15, .68), radius=1.15, floats=False, notes=notes)


# ---------- stage 2: what is underneath ----------

def vertebra(c, s, seed):
    """One vertebra, sized so it reads as bone from across a room: a squat
    drum of a body, an arch behind it, a long spike pointing back and down,
    a wing each side, and a lump of torn disc underneath. A gap is left to
    the next one so the chain reads as separate links, not a screw thread."""
    f = Forms()
    c = Vector(c)
    f.ball(c, (.048 * s, .042 * s, .024 * s))                                                                        # the body
    for sx in (-1, 1):
        f.tube([c + Vector((sx * .03 * s, .03 * s, 0)), c + Vector((sx * .022 * s, .07 * s, .004 * s))], [.013 * s, .011 * s])   # the arch
        f.tube([c + Vector((sx * .03 * s, .045 * s, .004 * s)), c + Vector((sx * .105 * s, .06 * s, .012 * s))], [.014 * s, .007 * s])   # wings
    f.tube([c + Vector((0, .07 * s, .004 * s)), c + Vector((0, .135 * s, -.05 * s))], [.016 * s, .007 * s])          # spinous process
    f.ball(c + Vector((0, 0, -.03 * s)), (.036 * s, .032 * s, .011 * s))                                            # disc, what is left of it
    v = sculpt(f, 'vert', voxel=.0065, soften=2, lumps=[(.04, .004)])
    decimate(v, 500)

    def fn(P, N, c=c, s=s):
        rgb = mixc(BONE, '#7d6b45', sstep(.4, .7, fbm(P, 40, seed)))
        disc = sstep(-.02 * s, -.027 * s, P[:, 2] - c.z)
        rgb = mixc(rgb, lin('#47271e'), disc)
        return dict(rgb=rgb, rough=np.where(disc > .5, .25, .4), fuzz=.15, blood=disc * .55 + .3 * fbm(P, 25, seed + 2))
    return paint(v, fn)


def stage2():
    rng = random.Random(2)
    H = dict(c=(0, -.05, 1.93), r=(.75, .62, .52), bump=(.36, -.02, 2.36, .22), yh=.12, zh=1.96, su=.12, sl=.42, split=True,
             warts=34, voxel=.018, soften=8, lumps=[(.4, .07), (.13, .022)], tris=22000, jaw_tris=9000)
    look = lambda sx: Vector((sx * .3, -1, -.2)).normalized()
    bc = lambda sx: Vector((sx * H['bump'][0], H['bump'][1], H['bump'][2]))
    # The eyes, and they do not match. Left: bigger, sitting lower, its pupil blown open and turned out and
    # up, past you. Right: a pinprick in a washed-out iris, aimed down at whoever is under it. Both bulge
    # half out of the head, so the torch finds them before anything else.
    EYE = {1: dict(r=.17, drop=.035, gaze=(.45, -1, .06), pupil=.56, iris=.68, iris_col='#4c3a22'),
           -1: dict(r=.15, drop=0, gaze=(.1, -1, -.24), pupil=.065, iris=.46, iris_col='#a7aa94')}
    ec = lambda sx: bc(sx) + look(sx) * .1 - Vector((0, 0, EYE[sx]['drop']))
    H['socket'] = lambda sx: (tuple(ec(sx)), EYE[sx]['r'] * 1.07)     # concentric with the eye, so it turns freely
    cav, throat = ((0, -.07, 1.78), (.64, .5, .3)), ((0, .16, 1.72), .27)
    H['cavity'] = [cav, throat]
    H['carve'] = [cav, throat] + [H['socket'](sx) for sx in (-1, 1)]
    H['tear_c'], H['tear_r'] = (0, .3, 1.55), (.5, .3, .12)
    # brow ridges sag over the sockets, and the top lip has swollen
    H['forms'] = lambda f: [f.ball((sx * .5, -.46, 2.0), (.2, .12, .09)) for sx in (-1, 1)]
    head, jaw, warts = make_head(H, 2)
    paint_head(head, H, 2, warts)
    paint_head(jaw, H, 2, [])
    join(head, [teeth(H, 2, True, 17, (.074, .115, .032), 1.02, 31)])
    join(jaw, [teeth(H, 2, False, 13, (.07, .07, .03), .88, 32)])

    # the torn neck: a ragged skirt of skin under the back of the head
    bm = bmesh.new()
    seg, rows = 44, 4
    grid = []
    for i in range(seg):
        a = i / seg * math.tau
        drop = (.08 + rng.random() * .1) if i % 2 else (.18 + rng.random() * .18)   # short, so the shrunken rear shows below it
        ring = []
        for k in range(rows):
            t = k / (rows - 1)
            flare = 1 + .08 * t + (rng.random() - .5) * .08 * t
            # the top ring sits inside the head, so only the torn edge shows below it
            ring.append(bm.verts.new((math.sin(a) * .4 * flare, .2 - math.cos(a) * .2 * flare, 1.68 - t * drop - .14 * t)))
        grid.append(ring)
    for i in range(seg):
        a, b = grid[i], grid[(i + 1) % seg]
        for k in range(rows - 1): bm.faces.new((a[k], b[k], b[k + 1], a[k + 1]))
    skirt = bm_obj(bm, 'skirt')
    m = skirt.modifiers.new('so', 'SOLIDIFY'); m.thickness = .022; m.offset = 0
    m = skirt.modifiers.new('su', 'SUBSURF'); m.levels = 1
    apply_mods(skirt)

    def fs(P, N):
        out = np.einsum('ij,ij->i', N[:, :2], P[:, :2] - np.array((0, .2))) > 0
        rgb = np.where(out[:, None], skin(P, 2, 3), lin('#2a1511'))
        edge = sstep(1.5, 1.2, P[:, 2])
        return dict(rgb=rgb, rough=np.where(out, .85, .3), fuzz=np.where(out, .8, .2), blood=np.where(out, edge * .75 + .25 * runs(P, 6), .65))
    paint(skirt, fs)
    join(head, [skirt])

    eyes = {}
    for sx, side in ((1, 'L'), (-1, 'R')):
        e = EYE[sx]
        eye, glint = stare(ec(sx), e['r'], e['gaze'], e['pupil'], e['iris'], e['iris_col'], 40 + sx)
        eyes[side] = (eye, glint, tuple(ec(sx)))

    sways = []
    for i in range(5):                                                   # black strands across the mouth
        a = -.95 + i * .42
        roots = [lip(H, a + rng.uniform(0, .38), H['su'], inset=.02) + Vector((0, 0, .012)) for _ in range(4)]
        sways.append((strands(f'sway_{i + 1}', roots, .85, 50 + i), 'head'))
    for i in range(3):                                                   # and blood, thicker
        a = -.8 + i * .6
        roots = [lip(H, a + rng.uniform(0, .5), H['su'], inset=.03) + Vector((0, 0, .012)) for _ in range(3)]
        sways.append((strands(f'sway_{i + 6}', roots, .6, 60 + i, col=BLOOD, r0=.008, blood=1), 'head'))
    for i, sx in enumerate((-1, 1)):                                     # off the tear, either side
        roots = [(sx * (.16 + .2 * k / 4) + rng.uniform(-.02, .02), .2 - math.sqrt(max(0, 1 - ((.16 + .2 * k / 4) / .42) ** 2)) * .21, 1.46) for k in range(5)]
        sways.append((strands(f'sway_{i + 9}', roots, .6, 70 + i, col=BLOOD if i else HAIR, r0=.008, blood=i), 'head'))

    # The rear came with it, but it has emptied out: a small shrivelled lump,
    # lopsided and torn open on one side, hanging from a stump of neck. It is
    # kept small on purpose (owner's call for this stage) so the mouth and the
    # spine are what you see, not a joke.
    f = Forms()
    f.ball((0, .24, 1.08), (.3, .23, .19), sub=4)
    f.ball((.15, .33, 1.03), (.17, .15, .15))                          # two sagging lobes, not a matched pair
    f.ball((-.13, .35, 1.06), (.14, .13, .12))
    f.ball((0, .28, 1.32), (.17, .13, .2))                             # neck stump, up into the head
    f.ball((.04, .27, 1.48), (.13, .1, .1))
    body = sculpt(f, 'body', voxel=.014, soften=4, lumps=[(.2, .06), (.05, .028)])     # strong fine lumps read as wrinkles
    tears = [((-.27, .2, 1.04), .1), ((-.2, .1, .98), .07)]            # the torn side, opening into it
    for cc, cr in tears:
        b = ball(cc, cr, sub=3); boolean(body, b); delete(b)
    decimate(body, 9000)

    def fb(P, N):
        rgb = skin(P, 2, 5)
        # dried out and grey-brown all over, near black in the creases, so it reads as dead tissue and not as a soft cushion
        rgb = mixc(rgb, lin('#3b3a26'), .45 + .35 * sstep(.4, .65, fbm(P, 14, 12)))
        rgb = rgb * (.55 + .5 * sstep(.25, .6, fbm(P, 22, 13)))[:, None]
        raw = sstep(1.24, 1.34, P[:, 2])
        for cc, cr in tears: raw = np.maximum(raw, sstep(cr * 1.5, cr * 1.0, np.linalg.norm(P - np.array(cc), axis=1)))
        rgb = mixc(rgb, lin('#3b1c16'), raw)
        soak = sstep(1.0, 1.3, P[:, 2]) * (.25 + .6 * runs(P, 3)) + sstep(.98, .88, P[:, 2]) * .6 * runs(P, 8)
        under = sstep(.16, .0, np.linalg.norm(P - np.array((0, .2, .9)), axis=1)) * .9
        return dict(rgb=rgb, rough=np.where(raw > .5, .3, .9), fuzz=1 - raw * .7, blood=np.clip(np.maximum(soak, under) + raw * .6, 0, 1))
    paint(body, fb)

    # a length of bare spine out of the underside, in four links of two
    # vertebrae, bigger near the body and hanging in a slight curve
    links, pivots = [], []
    top, n, step = Vector((0, .2, .92)), 8, .07
    for i in range(n):
        s = 1.3 - i * .06
        c = top + Vector((math.sin(i * .9) * .01, -.016 * i + .0028 * i * i, -step * i))
        v = vertebra(c, s, 80 + i)
        if i % 2 == 0: links.append(v); pivots.append(tuple(c + Vector((0, 0, .03))))
        else: join(links[-1], [v])
    # drips off the spine, stopping short of its end
    drip = strands('sway_11', [tuple(top + Vector((rng.uniform(-.03, .03), -.016 * i + .0028 * i * i + rng.uniform(-.03, .05), -step * i))) for i in (3, 4, 5)], .1, 90, col=BLOOD, r0=.006, blood=1)

    root = empty('root')
    body = part(body, 'body', root, (0, .24, 1.1))
    head = part(head, 'head', body, (0, .3, 1.5))
    jaw = part(jaw, 'jaw', head, (0, H['yh'], H['zh']))
    baked, glows = [body, head, jaw], []
    for side, (eye, glint, c) in eyes.items():
        e = part(eye, 'eye_' + side, head, c)
        baked.append(e); glows.append((e, glint))
    for (o, pivot), parent in sways: baked.append(part(o, o.name, head, pivot))
    parent = body
    for i, (o, pivot) in enumerate(zip(links, pivots)):
        parent = part(o, 'extra_1' if i == 0 else f'extra_1_{i + 1}', parent, pivot)
        baked.append(parent)
        if i == 1: baked.append(part(drip[0], 'sway_11', parent, drip[1]))
    dried(baked)                         # every drop of blood on it is old
    notes = ("No legs: it hangs in the air, so bob root about 7 cm at 1.2 rad/s and let it drift, never step. head carries the "
             "ragged skirt of torn neck; body is what is left of the rear, a small shrivelled lump torn open on its right side, and "
             "the neck stump. jaw hinges behind the eyes at full head width: rest "
             "is a 20 cm grin showing 17 upper teeth, x 0.5 is a scream, and it goes on to 1.1 for the jumpscare, which is far "
             "more than a jaw should. Tested at 0.9 with the head pitched 0.35: no gaps; keep it at 1.1 or less. extra_1 > extra_1_2 > extra_1_3 > extra_1_4 is the bare "
             "spine under the rear, two vertebrae a link: swing each link 5 to 10 degrees on x and z with a lag down the chain, "
             "more when it turns. sway_1 to sway_5 are black strands on the upper lip (left to right as you face it), sway_6 to "
             "sway_8 blood strings on the lip, sway_9 (black) and sway_10 (blood) hang off the torn neck on either side, sway_11 "
             "drips off the spine (child of extra_1_2); all the blood is old and near black. The eyes are big, pale, lidless and "
             "never blink, and they disagree by construction: eye_R has a pinprick pupil aimed down at the player, eye_L is bigger, "
             "sits lower and has a blown pupil turned out and up, past them. So aim eye_R at the player and let eye_L lag or stay "
             "put. Each eye has one small eye_glow catchlight just above its pupil. Idle: bob, spine trailing, eye_R fixed on the "
             "player. Attack: tilt head back 15 degrees (head x -0.25) while the jaw drops, then lunge. Limits: head +-20 on x and "
             "z, +-30 on y (the skirt hides the join); each eye sits in a socket centred on it, so it can turn any amount without "
             "a gap, and its pupil stays in view to about 45 degrees.")
    return dict(root=root, baked=baked, glows=glows, face=(0, 1.85, .62), radius=.95, floats=True, notes=notes)


# ---------- finishing ----------

def finish(stage, S):
    name = f'toad_{stage}'
    log(f'parts built: {tris(S["baked"])} tris')
    bake(S['baked'], name)
    for eye, glint in S['glows']:
        join(eye, [glint])
    export_glb(name, [S['root']], jpeg_quality=S.get('jpeg', 82))
    info = report(name)
    return dict(file=name + '.glb', height=round(info['max'][2], 2), radius=S['radius'], face=list(S['face']), floats=S['floats'],
                nodes=info['nodes'], notes=S['notes'], _tris=info['tris'], _mb=info['mb'])


STAGES = {0: stage0, 1: stage1, 2: stage2}

# What to render after each build: (views, keyword arguments for preview()).
# Building and looking in one run matters, because Blender slots are scarce.
LOOKS = [(('front', 'low'), {}), (('three_quarter', 'back'), dict(light='studio', tag='_studio'))]

if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['0', '1', '2']
    looks = [] if '--no-preview' in args else LOOKS
    args = [a for a in args if not a.startswith('--')]
    failed = False
    path = os.path.join(MODELS, 'toad.json')
    doc = json.load(open(path)) if os.path.exists(path) else dict(key='toad', stages=[None, None, None])
    for a in args:
        i = int(a)
        reset()
        try:
            entry = finish(i, STAGES[i]())
        except Exception:                      # report it and go on, so one run tells us about every stage
            __import__('traceback').print_exc()
            failed = True
            continue
        print(f"[toad] stage {i}: {entry.pop('_tris')} tris, {entry.pop('_mb')} MB")
        doc['stages'][i] = entry
        json.dump(doc, open(path, 'w'), indent=1)
        for views, kw in looks: preview(f'toad_{i}', views=views, res=600, samples=16, **kw)
        log('previews done')
    if failed: sys.exit(1)
