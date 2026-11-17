# Madame Flan, the walrus mascot. One run builds one rot stage:
#
#   tools/models/bl tools/models/walrus/build.py -- 0
#   tools/models/bl tools/models/walrus/build.py -- 2 front:flashlight face:studio
#
# After the stage number come optional previews, `view[:light[:focus]]`, where
# view is one from common.VIEWS, light is flashlight or studio, and focus is
# a key of the stage's FOCUS table below (face, hips, ...). `--only` skips
# the build and renders the GLB already on disk. `--pose` writes a second,
# throwaway GLB with the joints turned, to check that no seam opens.
#
# Stage 0 is the costume as built, 1 is the costume going wrong, 2 is what is
# underneath. All three stand on the same enormous hips: the rear is wider
# than tall at every stage, which is the joke of the game.
import sys, os, json, math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.dirname(HERE))
from common import *
from lib import *
import numpy as np
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['0']
ST = int(ARGS[0])
V = Vector

# ---------------------------------------------------------------- palette
FUR0 = srgb('#b98a6e'); BELLY0 = srgb('#f5e0dc')
def dull(c, grey, k): return (c * (1 - grey) + c.mean() * grey) * k
FUR = [FUR0, dull(FUR0, .35, .7), dull(FUR0, .5, .42)][ST]           # the pile dulls and darkens as it rots
BELLY = [BELLY0, dull(BELLY0, .2, .75), dull(BELLY0, .3, .5)][ST]
PINK = [srgb('#ee7fa8'), srgb('#c9728f'), srgb('#8d6f78')][ST]       # the bow fades
PEARL = [srgb('#f7ebe6'), srgb('#e3d6c8'), srgb('#cfc3ae')][ST]
BONE = [srgb('#f3ead8'), srgb('#d6bf7c'), srgb('#c9b78a')][ST]       # tusks yellow
TOOTH = srgb('#d9cfa6')
INK = np.array([.012, .011, .013])
LINING = np.array([.06, .008, .01])                                  # inside of the mouth
P_FUR, P_CLOTH, P_SATIN = (1, .92, 0), (.5, .8, 0), (.5, .42, 0)
P_PLASTIC, P_BONE, P_PEARL, P_WET = (0, .22, 0), (0, .38, 0), (0, .14, 0), (0, .25, 0)

# What the shared material adds on top of the paint, per stage.
SURFACE = [dict(matting=0, bald=0, grime=0), dict(matting=.8, bald=.22, grime=.25), dict(matting=1, bald=.5, grime=.45)][ST]

# ---------------------------------------------------------------- layout (metres, Blender axes: front is -y)
PELVIS = V((0, 0, .95))
HEAD_C = [V((0, -.05, 2.12)), V((0, -.07, 2.23)), V((0, -.12, 2.47))][ST]   # centre of the skull
HEAD_S = [1, .97, .70][ST]                                                # the head is smaller on the long neck
HEAD_PIVOT = [V((0, 0, 1.86)), V((0, -.02, 2.0)), V((0, -.06, 2.30))][ST]
NECK_PIVOT = [None, V((0, 0, 1.80)), V((0, .02, 1.64))][ST]
def hd(x, y, z): return HEAD_C + V((x, y, z)) * HEAD_S    # a point given in stage 0 head coordinates

parts = {}   # name -> dict(parent, pivot, tex=[], fib=[], glow=[])
def P(name, parent, pivot):
    parts[name] = dict(parent=parent, pivot=V(pivot), tex=[], fib=[], glow=[])
    return parts[name]


# ---------------------------------------------------------------- body
DRAPE_TOP = 1.74
def hem_base(th):
    """Where the drape ends. It hangs low in front of the belly and lies on
    the hip shelf at the sides and back."""
    return 1.34 - .58 * max(0, math.cos(th)) ** 1.2
def hem_z(th):
    tat = .1 * abs(math.sin(11 * th + 1)) + .07 * abs(math.sin(23 * th + 2.2)) - .06
    for a, d in ((.5, .2), (-.9, .16), (2.4, .12), (-.25, .1)):     # a few long rips
        tat += d * math.exp(-((math.atan2(math.sin(th - a), math.cos(th - a))) / .07) ** 2)
    return hem_base(th) + tat
def lerp_tab(tab, s):
    for (a, va), (b, vb) in zip(tab, tab[1:]):
        if s <= b: return va + (vb - va) * (s - a) / (b - a)
    return tab[-1][1]
def drape_xy(s, th):
    """Cross-section of the drape at s (0 at the collar, 1 at the hem)."""
    rx = lerp_tab([(0, .085), (.1, .2), (.22, .27), (1, .62)], s)
    ry = lerp_tab([(0, .085), (.1, .15), (.22, .24), (1, .68 if math.cos(th) > 0 else .56)], s)
    fold = (math.cos(9 * th + .4) + .6 * math.cos(14 * th + 2) + .4 * math.cos(5 * th + 1)) * .09 * s ** 1.3
    return rx * math.sin(th) * (1 + fold), -ry * math.cos(th) * (1 + fold)


def make_drape():
    """Stage 2: the costume skin hangs off the neck as a cloak. Folds deepen
    toward a torn hem. It has thickness so the tatters have a back."""
    nth, nr = 96, 22
    verts, faces = [], []
    for j in range(nr + 1):
        s = j / nr
        for i in range(nth):
            th = math.tau * i / nth
            x, y = drape_xy(s, th)
            verts.append((x, y, DRAPE_TOP + (hem_z(th) - DRAPE_TOP) * s))
    for j in range(nr):
        for i in range(nth):
            a, b = j * nth + i, j * nth + (i + 1) % nth
            faces.append((a, b, b + nth, a + nth))
    o = mesh_obj('drape', verts, faces)
    bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(o.data); bm.free()
    mod(o, 'SOLIDIFY', thickness=.014, offset=-1)
    displace(o, [(.014, 8, .3), (.005, 26, .3)], 31)
    smooth_shade(o)

    def fn(Pt, N):
        th = np.arctan2(Pt[:, 0], -Pt[:, 1])
        hb = np.array([hem_base(t) for t in th])
        rad = np.stack([np.sin(th), -np.cos(th), np.zeros(len(th))], 1)
        inner = (N * rad).sum(1) < -.15
        col = np.tile(FUR * .8 + .02, (len(Pt), 1)) * (.8 + .4 * fbm(Pt * [1, 1, .2], 9, 3))[:, None]
        # soaked from the hem up, and a stain under the collar
        blood = (1 - sstep(.0, .5, Pt[:, 2] - hb + .1 * (fbm(Pt, 6, 5) - .5))) * .95
        chest = 1 - sstep(.08, .3, np.hypot(Pt[:, 0], Pt[:, 2] - 1.52))
        blood = np.maximum(blood, chest * (Pt[:, 1] < 0) * .8)
        prm = np.stack([np.ones(len(Pt)), np.full(len(Pt), .9), blood], 1)
        col[inner] = INK * .6; prm[inner] = (0, .9, 0)
        return col, prm
    return paint(o, fn)


def hip_forms():
    """The shelf. Wider than tall, with the rear standing out behind."""
    f = [ell((0, .05, .95), (.8, .55, .42)), ell((0, .45, 1.1), (.62, .4, .22)), ell((0, -.15, .85), (.6, .42, .35))]
    for sx in (-1, 1):
        f += [ell((sx * .6, .1, .92), (.45, .5, .4)), ell((sx * .36, .52, .9), (.42, .4, .41))]
    return f


def make_body():
    body = P('body', 'root', PELVIS)
    f = hip_forms()
    if ST == 0:
        f += [ell((0, -.02, 1.5), (.52, .45, .5)), ell((0, -.22, 1.3), (.46, .38, .42)), ell((0, 0, 1.8), (.42, .36, .24))]
        lumps = [(.012, 7, .5), (.004, 26, .4)]
    elif ST == 1:   # the torso is caving in under the skin, which sags onto the hips
        f += [ell((0, -.02, 1.48), (.41, .37, .5)), ell((0, -.25, 1.2), (.44, .34, .34)), ell((0, 0, 1.74), (.31, .27, .22)),
              tube([(0, 0, 1.7), (0, 0, 1.9)], [.19, .17], 12)]
        lumps = [(.03, 5, .3), (.012, 14, .3)]
    else:           # nothing but a post for the drape to hang on
        f += [tube([(0, 0, 1.0), (0, 0, 1.68)], [.13, .09], 10)]
        lumps = [(.03, 5, .35), (.012, 14, .3)]
    o = sculpt(f, voxel=.017, smooth=7, lumps=lumps, seed=1)
    if ST == 1:     # hanging folds down the torso
        Pt = coords(o.data); N = normals(o.data)
        th = np.arctan2(Pt[:, 0], -Pt[:, 1])
        w = sstep(1.15, 1.35, Pt[:, 2]) * (1 - sstep(1.6, 1.8, Pt[:, 2]))
        Pt += N * (w * .022 * (np.cos(11 * th + 1) + .5 * np.cos(17 * th)))[:, None]
        o.data.vertices.foreach_set('co', Pt.ravel()); o.data.update()

    def fn(Pt, N):
        n = len(Pt)
        col = np.tile(FUR, (n, 1)); prm = np.tile(np.array(P_FUR, float), (n, 1))
        if ST < 2:   # the pale belly panel
            e = (Pt[:, 0] / .33) ** 2 + ((Pt[:, 2] - 1.36) / .45) ** 2 + (fbm(Pt, 9, 2) - .5) * .12
            wb = (1 - sstep(.94, 1.03, e)) * sstep(.05, .3, -N[:, 1]) * (Pt[:, 1] < 0)
            col = col * (1 - wb[:, None]) + BELLY * wb[:, None]
        if ST == 1:  # first blood, at the collar, running down the front
            d = np.hypot(Pt[:, 0] + .05, Pt[:, 2] - 1.74)
            b = (1 - sstep(.1, .3, d)) * (Pt[:, 1] < .05)
            for xi, zl in ((-.13, 1.36), (-.02, 1.2), (.07, 1.44), (.16, 1.52)):
                b = np.maximum(b, (1 - sstep(.012, .035, np.abs(Pt[:, 0] - xi))) * sstep(zl, zl + .06, Pt[:, 2]) * (Pt[:, 2] < 1.74) * (Pt[:, 1] < 0) * .75)
            prm[:, 2] = b * .9
        if ST == 2:  # where the soaked hem lies on the hips, and what ran down from it
            rho = np.hypot(Pt[:, 0] / .75, Pt[:, 1] / .7)
            b = (1 - sstep(.75, 1.15, rho + (fbm(Pt, 5, 8) - .5) * .5)) * sstep(.55, .95, Pt[:, 2])
            run = sstep(.62, .75, fbm(Pt * [1, 1, .12], 14, 4)) * sstep(.45, .8, Pt[:, 2]) * (rho < 1.5)
            prm[:, 2] = np.maximum(b * .8, run * .6)
        return col, prm
    paint(o, fn)
    decimate(o, [15000, 15000, 11000][ST])
    body['tex'].append(o)
    lap(' bodypaint')
    body['fib'].append(tufts(o, [2200, 2400, 1700][ST], 11, length=[(.03, .055), (.05, .12), (.06, .16)][ST],
                             width=[.02, .024, .026][ST], droop=[.5, 1.0, 1.2][ST], shade=[1.05, .9, .8][ST]))
    tree = bvh(o); lap(' tufts')

    if ST < 2:
        # zip down the back: tape, chunky teeth, a pull. By stage 1 it has started to open.
        pts = [hit(tree, (0, 3, z), (0, -1, 0)) for z in np.linspace(1.84, 1.26, 40)]
        verts, faces = [], []
        for i, (p, nn) in enumerate(pts):
            for dx in (-.03, .03): verts.append(p + nn * .006 + V((dx, 0, 0)))
        for i in range(len(pts) - 1): faces.append((2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2))
        strip = tint(mesh_obj('tape', verts, faces), (.05, .045, .05), P_CLOTH)
        mod(strip, 'SOLIDIFY', thickness=.006)
        body['tex'].append(strip)
        for i, (p, nn) in enumerate(pts):
            for k in (0, 1):
                c = p + nn * .012 + V(((k - .5) * .012, 0, -k * .007))
                body['tex'].append(tint(ell(c, (.011, .006, .0045), seg=6), (.55, .5, .38), (0, .3, 0)))
        ip = [2, 15][ST]
        p, nn = pts[ip]
        body['tex'].append(tint(ell(p + nn * .022, (.024, .012, .02), seg=8), (.6, .55, .4), (0, .3, 0)))
        body['tex'].append(tint(ell(p + nn * .03 + V((0, 0, -.06)), (.02, .006, .045), seg=8), (.6, .55, .4), (0, .3, 0)))
        if ST == 1:  # above the pull the zip gapes: a dark slot with nothing in it
            g = [pts[i][0] + pts[i][1] * .016 for i in range(0, ip + 1)]
            body['tex'].append(tint(tube(g, [.012 + .03 * math.sin(math.pi * i / ip) for i in range(ip + 1)], 6, flat=.25), INK * .4, (0, 1, 0)))

        # the seam round the belly panel, in fat pale thread
        for i in range(84):
            a0, a1 = math.tau * i / 84, math.tau * (i + .55) / 84
            q = [hit(tree, (.335 * math.cos(a), -3, 1.36 + .455 * math.sin(a)), (0, 1, 0)) for a in (a0, a1)]
            if q[0][0] is None or q[1][0] is None: continue
            body['tex'].append(tint(tube([q[0][0] + q[0][1] * .004, q[1][0] + q[1][1] * .004], .0045, 4), BELLY * .8, P_CLOTH))

        # pearls resting on the shoulders. In stage 1 the string has stretched
        # with the neck and three are gone.
        n = 22; rx, ry, zc = [(.36, .33, 1.88), (.25, .24, 1.83)][ST]
        ring = []
        for i in range(n + 1):
            a = math.tau * i / n
            f = max(0, math.cos(a))
            x, y = rx * math.sin(a), -.03 - ry * math.cos(a) - .05 * f
            z = zc - [.12, .2][ST] * f ** 2
            h = hit(tree, (x * 3, y * 3, z + .5), (-x * 3, -y * 3, -.5 - .2))
            c = V((x, y, z))
            if h[0] is not None and (h[0] - V((0, 0, z))).length > c.length - .02 and ST == 0: c = h[0] + h[1] * .04
            ring.append(c)
        gone = {4, 9, 10} if ST == 1 else set()
        for i in range(n):
            if i not in gone: body['tex'].append(tint(ell(ring[i], .052, seg=12), PEARL, P_PEARL))
        body['tex'].append(tint(tube(ring, .006, 4), PEARL * .5, P_CLOTH))
    else:
        d = make_drape()
        body['tex'].append(d)
        hemmy = lambda M: sstep(.5, .0, M[:, 2] - np.array([hem_base(t) for t in np.arctan2(M[:, 0], -M[:, 1])])) + .12
        body['fib'].append(tufts(d, 520, 12, length=(.1, .3), width=.03, droop=2.5, where=hemmy, shade=.75, lift=.2))
    return tree


def make_legs():
    """Thick short legs under the hips, the same at every stage."""
    k = [1, 1, .86][ST]
    for sx, side in ((1, 'L'), (-1, 'R')):
        H, K, A = V((sx * .42, .05, .8)), V((sx * .45, -.02, .42)), V((sx * .45, 0, .14))
        leg = P('leg_' + side, 'body', H); shin = P('shin_' + side, 'leg_' + side, K)
        o = sculpt([ell(H, .3 * k), tube([H, K], [.28 * k, .22 * k], 12), ell(K, .22 * k)], .016, 5, [(.01, 9, .5)], 3)
        s = sculpt([ell(K, .21 * k), tube([K, A], [.21 * k, .17 * k], 12), ell(A, .17 * k),
                    ell((sx * .46, -.13, .085), (.21, .31, .085))], .014, 5, [(.008, 10, .5)], 4)
        def fn(Pt, N):
            n = len(Pt)
            col = np.tile(FUR, (n, 1)); prm = np.tile(np.array(P_FUR, float), (n, 1))
            sole = Pt[:, 2] < .035
            col[sole] = INK * 3; prm[sole] = (.5, .9, 0)
            if ST == 2: prm[:, 2] = sstep(.6, .78, fbm(Pt * [1, 1, .15], 12, 6)) * .7 * ~sole
            return col, prm
        for x, nt, part_ in ((o, 1700, leg), (s, 2200, shin)):
            paint(x, fn); decimate(x, nt)
            part_['tex'].append(x)
            part_['fib'].append(tufts(x, [260, 320, 320][ST], 20 + sx, length=[(.03, .05), (.05, .1), (.05, .12)][ST],
                                      width=.02, droop=[.5, 1, 1.2][ST], shade=[1.05, .9, .8][ST], where=lambda M: M[:, 2] > .06))


def make_arms():
    """Stubby flipper arms. Stages 0 and 1 only: by stage 2 they are gone
    into the drape."""
    for sx, side in ((1, 'L'), (-1, 'R')):
        if ST == 0: S, E, W, k = V((sx * .47, 0, 1.72)), V((sx * .7, -.04, 1.38)), V((sx * .74, -.16, 1.08)), 1
        else:       S, E, W, k = V((sx * .37, 0, 1.68)), V((sx * .56, -.02, 1.3)), V((sx * .6, -.1, .96)), .78   # thinner, hanging
        arm = P('arm_' + side, 'body', S); fore = P('forearm_' + side, 'arm_' + side, E)
        o = sculpt([ell(S, .18 * k), tube([S, E], [.165 * k, .135 * k], 12), ell(E, .135 * k)], .013, 5, [(.008, 10, .5)], 5)
        f = sculpt([ell(E, .13 * k), tube([E, W], [.13 * k, .1 * k], 12),
                    ell(W + V((0, -.03, -.1)), (.065 * k, .15, .2))], .012, 5, [(.006, 11, .5)], 6)
        def fn(Pt, N):
            return np.tile(FUR, (len(Pt), 1)), np.tile(np.array(P_FUR, float), (len(Pt), 1))
        for x, nt, part_ in ((o, 1400, arm), (f, 1700, fore)):
            paint(x, fn); decimate(x, nt)
            part_['tex'].append(x)
            part_['fib'].append(tufts(x, [200, 260][ST], 30 + sx, length=[(.03, .05), (.05, .11)][ST], width=.018,
                                      droop=[.5, 1][ST], shade=[1.05, .9][ST]))


def make_neck():
    neck = P('neck', 'body', NECK_PIVOT)
    if ST == 1:   # the costume neck pulled out of the collar, rings of slack fur
        o = sculpt([ell(NECK_PIVOT, (.2, .19, .12)), tube([NECK_PIVOT, HEAD_PIVOT + V((0, 0, .05))], [.19, .165], 14)], .012, 4, [(.006, 12, .6)], 7)
        ringf, amp, fur = 60, .012, P_FUR
    else:         # a long thin stalk with a spine down the back
        path = curve_pts([NECK_PIVOT, (0, -.05, 1.86), (0, .03, 2.1), HEAD_PIVOT + V((0, 0, .03))], 8)
        f = [tube(path, [.085 - .03 * min(1, i / 8) + .012 * (i / len(path)) for i in range(len(path))], 12), ell(NECK_PIVOT, .1)]
        for i in range(2, len(path) - 1, 2):   # vertebrae
            f.append(ell(path[i] + V((0, .05, 0)), (.022, .03, .024), seg=8))
        for sx in (-1, 1):                     # cords at the front
            f.append(tube([p + V((sx * .028, -.045, 0)) for p in path[1:-1]], .014, 6))
        o = sculpt(f, .0075, 3, [(.003, 30, .6)], 8)
        ringf, amp, fur = 95, .0035, (1, .8, 0)
    Pt = coords(o.data); N = normals(o.data)
    Pt += N * (amp * np.sin(Pt[:, 2] * ringf + 3 * fbm(Pt, 6, 2)))[:, None]   # stretch rings
    o.data.vertices.foreach_set('co', Pt.ravel()); o.data.update()
    def fn(Pt, N):
        n = len(Pt)
        col = np.tile(FUR * (.9 if ST == 1 else .75), (n, 1)); prm = np.tile(np.array(fur, float), (n, 1))
        if ST == 2:   # the pile is worn off the stretched skin, most at the front
            thin = sstep(.4, .65, fbm(Pt * [1, 1, .4], 16, 9) + .15 * (N[:, 1] < 0))
            col = col * (1 - thin[:, None]) + (BELLY * .55) * thin[:, None]
            prm[:, 0] = 1 - thin; prm[:, 1] = .9 - .4 * thin
            prm[:, 2] = (1 - sstep(.0, .22, Pt[:, 2] - 1.72)) * .8 + (1 - sstep(.0, .1, HEAD_PIVOT.z - Pt[:, 2])) * .5
        else:
            prm[:, 2] = (1 - sstep(.0, .1, Pt[:, 2] - 1.78)) * (Pt[:, 1] < 0) * .7
        return col, prm
    paint(o, fn); decimate(o, [0, 1800, 3000][ST])
    neck['tex'].append(o)
    neck['fib'].append(tufts(o, [0, 80, 90][ST], 14, length=(.04, .1), width=.014, droop=1.4, shade=.8))


# ---------------------------------------------------------------- head
def block(x0, x1, y0, y1, zf, zb, nx=16):
    """A closed slab between x0..x1 and y0..y1 whose top follows zf(x): the
    cutter that separates jaw from head along a smile."""
    verts = []
    for i in range(nx + 1):
        x = x0 + (x1 - x0) * i / nx
        verts += [(x, y0, zf(x)), (x, y1, zf(x)), (x, y0, zb), (x, y1, zb)]
    faces = []
    for i in range(nx):
        a, b = 4 * i, 4 * i + 4
        faces += [(a, a + 1, b + 1, b), (a + 2, b + 2, b + 3, a + 3), (a, b, b + 2, a + 2), (a + 1, a + 3, b + 3, b + 1)]
    faces += [(0, 2, 3, 1), (4 * nx, 4 * nx + 1, 4 * nx + 3, 4 * nx + 2)]
    o = mesh_obj('block', verts, faces)
    bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(o.data); bm.free()
    return o


def tooth(c, w, h, t, rng, lower=False):
    """A flat human incisor: a squared-off blob, yellow, dark at the gum."""
    o = ell((0, 0, 0), 1, seg=8)
    Pt = coords(o.data)
    Pt = np.sign(Pt) * np.abs(Pt) ** .5 * np.array([w, t, h]) / 2
    Pt[:, 0] *= 1 + .12 * Pt[:, 2] / h * (1 if lower else -1)       # wider at the biting edge
    a = rng.normal(0, .07)
    Pt = Pt @ np.array([[math.cos(a), 0, math.sin(a)], [0, 1, 0], [-math.sin(a), 0, math.cos(a)]])
    Pt += np.array(c)
    o.data.vertices.foreach_set('co', Pt.ravel()); o.data.update()
    root = sstep(-h * .1, h * .45, (Pt[:, 2] - c[2]) * (1 if lower else -1))   # 1 toward the gum
    shade = rng.uniform(.75, 1.05)
    set_attr(o.data, 'Col', (TOOTH * shade)[None, :] * (1 - root[:, None]) + np.array([.13, .07, .03])[None, :] * root[:, None])
    set_attr(o.data, 'Prm', np.array(P_BONE)[None, :])
    smooth_shade(o)
    return o


def make_head(collide):
    s = HEAD_S
    head = P('head', 'neck' if ST else 'body', HEAD_PIVOT)
    R = np.array([.36, .34, .33]) * s
    f = [ell(HEAD_C, R), ell(hd(0, -.2, -.2), np.array([.2, .16, .12]) * s)]
    for sx in (-1, 1):
        f += [ell(hd(sx * .17, -.12, -.1), np.array([.2, .2, .18]) * s),          # cheek
              ell(hd(sx * .125, -.3, -.09), np.array([.15, .13, .115]) * s)]      # whisker pad
    if ST == 0: f.append(ell(hd(0, .03, -.3), (.27, .25, .2)))
    elif ST == 1: f.append(tube([HEAD_C, HEAD_PIVOT + V((0, 0, -.04))], [.2, .16], 12))
    else: f.append(tube([HEAD_C, HEAD_PIVOT + V((0, 0, -.03))], [.12, .075], 10))
    lumps = [[(.006, 10, .5), (.003, 30, .5)], [(.014, 8, .4), (.006, 22, .4)], [(.011, 12, .4), (.004, 30, .4)]][ST]
    solid = sculpt(f, .011 * s ** .6, 5, lumps, 21)

    # eyes: where, how big, and how far the socket sinks
    if ST == 0: eyes = {'L': (hd(.14, -.275, .1), .082), 'R': (hd(-.14, -.275, .1), .082)}
    elif ST == 1: eyes = {'L': (hd(.15, -.27, .12), .07), 'R': (hd(-.135, -.285, .065), .097)}   # one shrunk, one swollen and slipping
    else: eyes = {'L': (hd(.15, -.25, .11), .046), 'R': (hd(-.14, -.255, .08), .052)}
    if ST == 2:
        for c, r in eyes.values(): dent(solid, c + V((0, -.03, 0)), r * 2.6, .045, (0, 1, 0))
    tree = bvh(solid)

    # mouth: cut the jaw off along a smile and hollow both halves
    jaw_obj = None
    if ST:
        W = [0, .4, .5][ST] * s; z0 = hd(0, 0, -.225).z; gap = [0, .05, .014][ST] * s
        yh = hd(0, [0, 0, .06][ST], 0).y
        S = lambda x: z0 + (.055 * s) * (x / (W / 2)) ** 2
        jaw_obj = solid.copy(); jaw_obj.data = solid.data.copy(); bpy.context.scene.collection.objects.link(jaw_obj)
        bj = block(-W / 2, W / 2, -2, yh, S, 0)
        bh = block(-W / 2 - .004, W / 2 + .004, -2, yh + .003, lambda x: S(x) + gap, 0)
        boolean(jaw_obj, bj, 'INTERSECT'); boolean(solid, bh, 'DIFFERENCE')
        cav_r = [0, (.165, .15, .07), (.2, .17, .1)][ST]
        for o in (jaw_obj, solid):
            cav = ell(hd(0, -.15, -.2), np.array(cav_r) * s)
            boolean(o, cav, 'DIFFERENCE'); bpy.data.objects.remove(cav)
        bpy.data.objects.remove(bj); bpy.data.objects.remove(bh)
        jaw = P('jaw', 'head', (0, yh, z0 + .03 * s))

    pad_c = [np.array(hd(sx * .125, -.3, -.09)) for sx in (-1, 1)]
    def fn(o):
        def inner(Pt, N):
            n = len(Pt)
            col = np.tile(FUR, (n, 1)); prm = np.tile(np.array(P_FUR, float), (n, 1))
            for c in pad_c:   # the pale pads; shorter pile
                e = np.linalg.norm((Pt - c) / (np.array([.15, .13, .115]) * s), axis=1) + (fbm(Pt, 14, 4) - .5) * .1
                w = (1 - sstep(.98, 1.1, e))[:, None]
                col = col * (1 - w) + BELLY * w
            if ST == 2:
                for c, r in eyes.values():   # raw rims
                    d = np.linalg.norm(Pt - np.array(c), axis=1)
                    w = (1 - sstep(r * 1.15, r * 1.9, d))
                    col = col * (1 - w[:, None]) + np.array([.25, .02, .02]) * w[:, None]
                    prm[:, 0] *= 1 - w; prm[:, 1] = prm[:, 1] * (1 - w) + .25 * w; prm[:, 2] = np.maximum(prm[:, 2], w * .9)
                # the tusks tore out through the cheeks
                for sx in (-1, 1):
                    d = np.linalg.norm(Pt - np.array(hd(sx * .2, -.3, -.12)), axis=1)
                    prm[:, 2] = np.maximum(prm[:, 2], (1 - sstep(.03, .09, d)) * .9)
            if ST:   # blood round the mouth
                d = np.abs(Pt[:, 2] - z0 - gap / 2) / (.06 * s) + np.abs(Pt[:, 0]) / (W * .6)
                prm[:, 2] = np.maximum(prm[:, 2], (1 - sstep(.7, 1.5, d)) * (Pt[:, 1] < HEAD_C.y - .1 * s) * [0, .55, .8][ST])
                m = lining_mask(o) > 0
                col[m] = LINING; prm[m] = P_WET
            return col, prm
        return inner
    paint(solid, fn(solid)); decimate(solid, [9000, 9500, 8500][ST])
    head['tex'].append(solid)
    head['fib'].append(tufts(solid, [800, 900, 800][ST], 40, length=[(.025, .045), (.04, .1), (.03, .09)][ST],
                             width=[.018, .02, .014][ST], droop=[.4, 1, 1.2][ST], shade=[1.05, .9, .8][ST]))
    if jaw_obj:
        paint(jaw_obj, fn(jaw_obj)); decimate(jaw_obj, 2600)
        jaw['tex'].append(jaw_obj)
        rng = np.random.RandomState(5)
        nt = [0, 9, 11][ST]; Wt = W - .05 * s
        tw = Wt / nt
        for row in range(2 if ST == 2 else 1):   # stage 2 has a second row behind the first
            for i in range(nt):
                x = -Wt / 2 + tw * (i + .5)
                mid = 1.25 - .5 * abs(i - (nt - 1) / 2) / (nt / 2)   # the front ones are bigger
                hu, hl = .042 * s * mid, .034 * s * mid
                if ST == 2: hu, hl = hu * 1.3, hl * 1.3
                for lower in (False, True):
                    z = (S(x) - .012 * s) if lower else (S(x) + gap + .012 * s)
                    h = hit(tree, (x, -3, z), (0, 1, 0))
                    if h[0] is None: continue
                    zc = S(x) + hl / 2 - .008 * s if lower else S(x) + gap - hu / 2 + .008 * s
                    c = (x + rng.normal(0, .002), h[0].y + .016 * s + row * .04 * s, zc + rng.normal(0, .003) - row * (.0 if lower else -.004))
                    (jaw if lower else head)['tex'].append(tooth(c, tw * .93 * (1 - .2 * row), (hl if lower else hu) * (1 - .25 * row), .017 * s, rng, lower))

    # nose, whisker dots, whiskers
    head['tex'].append(tint(ell(hd(0, -.405, -.02), np.array([.058, .045, .044]) * s, seg=12), INK, P_PLASTIC))
    rng = np.random.RandomState(8)
    for sx in (-1, 1):
        for i in range(7):
            u, v = sx * (.07 + .05 * (i % 3) + rng.uniform(-.01, .01)), -.05 - .045 * (i // 3) + rng.uniform(-.008, .008)
            h = hit(tree, hd(u, -1, v), (0, 1, 0))
            if h[0] is None: continue
            head['tex'].append(tint(ell(h[0], .011 * s, seg=6), INK * 2, P_PLASTIC))
            if i % 3 == 0 and ST == 2: continue   # some have fallen out
            d = (h[1] + V((sx * .9, -.15, -.25 - .3 * (ST > 0)))).normalized()
            L = (.13 + rng.uniform(0, .06)) * s ** .5
            pts = [h[0] + d * L * t + V((0, 0, -.05 * (1 + ST) * s * t * t)) for t in (0, .35, .7, 1)]
            head['fib'].append(strand(pts, .0035, .001, (.8, .78, .7) if ST == 0 else (.45, .42, .36)))

    # tusks
    def horn(ctrl, r0, r1, n=6, blood0=0.0):
        pts = curve_pts(ctrl, n)
        m = len(pts)
        o = tube(pts, [r0 + (r1 - r0) * (i / (m - 1)) ** 1.4 for i in range(m)], 8)
        if ST: displace(o, [(.0025, 35, 1)], 3)   # growth knots
        Pt = coords(o.data)
        t = np.repeat(np.linspace(0, 1, m), 8)[:len(Pt)]
        grain = fbm(Pt * [1, 1, .25], 60, 2)
        col = BONE[None, :] * (1 - [.0, .45, .5][ST] * (1 - t[:, None]) * np.array([.4, .7, 1.2])[None, :])   # yellow-brown toward the root
        col = col * (.75 + .5 * grain[:, None]) if ST else col
        prm = np.tile(np.array(P_BONE, float), (len(Pt), 1))
        prm[:, 2] = blood0 * (1 - sstep(.0, .22, t))
        set_attr(o.data, 'Col', col); set_attr(o.data, 'Prm', prm); smooth_shade(o)
        return o
    for sx in (-1, 1):
        base = hd(sx * .115, -.33, -.17)
        if ST == 0:
            head['tex'].append(horn([base, hd(sx * .125, -.4, -.3), hd(sx * .12, -.39, -.43)], .042, .012))
        elif ST == 1:   # twice as long, and no longer a pair
            k = 1 if sx > 0 else .88
            head['tex'].append(horn([base, hd(sx * .13, -.44, -.36 * k), hd(sx * .17, -.47, -.6 * k), hd(sx * (.13 if sx > 0 else .2), -.44, -.74 * k)], .045, .008, blood0=.5))
        else:
            # the wrong way: out through the cheek, up, and branching. These are
            # in metres from the head centre, not scaled with the head.
            c = HEAD_C; a = 1 if sx > 0 else .92
            def q(x, y, z): return c + V((sx * x, y, z * a))
            root = [hd(sx * .13, -.3, -.15), q(.25, -.3, -.05), q(.3, -.22, .2), q(.25, -.13, .47)]
            head['tex'].append(horn(root, .036, .022, blood0=1))
            head['tex'].append(horn([q(.25, -.13, .47), q(.27, -.08, .64), q(.32, -.1, .8)], .022, .003))
            head['tex'].append(horn([q(.25, -.13, .47), q(.18, -.17, .62), q(.12, -.14, .77)], .019, .003))
            head['tex'].append(horn([q(.3, -.22, .2), q(.4, -.27, .3), q(.47, -.25, .45), q(.46, -.18, .7)], .02, .003))
            head['tex'].append(horn([q(.25, -.3, -.05), q(.34, -.38, -.02), q(.39, -.45, .06)], .017, .003))
            head['tex'].append(horn([q(.47, -.25, .45), q(.53, -.3, .5), q(.56, -.31, .58)], .012, .003, n=4))

    # the bow
    bs = s ** .6
    bc = hd(0, -.04, .33) + V(([0, .03, .02][ST], 0, 0))
    tilt = [0, 24, -14][ST]
    def bpt(x, y, z):
        a = math.radians(tilt)
        return bc + V((x * math.cos(a) + z * math.sin(a), y, -x * math.sin(a) + z * math.cos(a))) * bs
    f = [ell(bpt(0, 0, .02), np.array([.048, .055, .05]) * bs)]
    for sx in (-1, 1):
        droop = [0, .0, .05][ST] * (1 if sx > 0 else 2)   # a loop has gone slack
        f.append(ell(bpt(sx * .125, 0, .04 - droop), np.array([.12, .045, .085 - droop * .4]) * bs, rot=(0, -sx * 14 + tilt, 0)))
        f.append(tube([bpt(sx * .02, -.03, 0), bpt(sx * .07, -.07, -.1), bpt(sx * .09, -.1, -.19)], [.03 * bs, .035 * bs, .03 * bs], 8, flat=.25))
    bow = sculpt(f, .007, 2, [(.006, 22, 1)], 5)
    Pt = coords(bow.data)   # pinch the loops toward the knot so it reads as tied cloth
    loc = (Pt - np.array(bc)) / bs
    pin = 1 - .55 * np.exp(-(loc[:, 0] / .06) ** 2)
    Pt[:, 2] = bc.z + (Pt[:, 2] - bc.z - .03 * bs) * np.where(np.abs(loc[:, 0]) > .04, pin, 1) + .03 * bs
    bow.data.vertices.foreach_set('co', Pt.ravel()); bow.data.update()
    paint(bow, lambda Pt, N: (np.tile(PINK, (len(Pt), 1)) * (.8 + .4 * fbm(Pt, 30, 2))[:, None],
                              np.tile(np.array((.5, .42, .3 * (ST == 2) ), float), (len(Pt), 1))))
    decimate(bow, 1500)
    head['tex'].append(bow)

    # eyes
    for side, (c, r) in eyes.items():
        eye = P('eye_' + side, 'head', c)
        if ST < 2:
            # googly: a white plastic ball in a black rim, and a pupil that sits proud of it
            head['tex'].append(tint(ell(c + V((0, .035, 0)), (r * 1.22, r * .7, r * 1.22), seg=16), INK, P_PLASTIC))
            eye['tex'].append(tint(ell(c, r, seg=16), srgb('#f5f1e6') * ([1, .8][ST]), P_PLASTIC))
            pr = r * (.5 if ST == 0 else (.26 if side == 'L' else .62))   # in stage 1 one pinned, one blown
            eye['tex'].append(tint(ell(c + V((0, -r * .88, -r * .12)), (pr, r * .2, pr), seg=12), INK, P_PLASTIC))
            eye['glow'].append(ell(c + V((-pr * .3, -r * 1.06, -r * .12 + pr * .3)), r * .11, seg=8))
        else:
            # dead: a black ball sunk in a raw socket, one pale point fixed on you
            eye['tex'].append(tint(ell(c, r, seg=14), INK * .5, (0, .08, 0)))
            eye['glow'].append(ell(c + V((0, -r * .97, 0)), r * .2, seg=8))

    # pearls stay with the head once the neck is long
    if ST == 2:
        n = 13; ring = []
        for i in range(n + 1):
            a = math.tau * i / n; fr = max(0, math.cos(a))
            ring.append(HEAD_PIVOT + V((.105 * math.sin(a), .01 - .1 * math.cos(a) - .03 * fr, -.02 - .07 * fr ** 2)))
        for i in range(n):
            if i not in (3, 8): head['tex'].append(tint(ell(ring[i], .027, seg=10), PEARL, P_PEARL))
        head['tex'].append(tint(tube(ring, .004, 4), PEARL * .4, P_CLOTH))

    # black strands. Each one hangs straight down but is pushed outside
    # whatever it would pass through, so it lies on the drape and the hips.
    def hang(start, length, seed, col=INK, r=.006):
        rng = np.random.RandomState(seed)
        n = max(4, int(length / .12))
        pts = [V(start)]
        ph = rng.uniform(0, 6)
        for i in range(1, n + 1):
            t = i / n
            p = V(start) + V((.03 * math.sin(ph + t * 5) * t, .03 * math.cos(ph * 2 + t * 4) * t, -length * t))
            rad = V((p.x, p.y, 0))
            if collide is not None and rad.length > 1e-4:
                h = collide.ray_cast(V((0, 0, p.z)) + rad.normalized() * 3, -rad.normalized())
                if h[0] is not None:
                    need = math.hypot(h[0].x, h[0].y) + .02
                    if rad.length < need: p = V((0, 0, p.z)) + rad.normalized() * need
            pts.append(p)
        return strand(pts, r * rng.uniform(.7, 1.3), .0015, col, sides=3)

    if ST == 1:   # out of the mouth
        for k, side in enumerate((1, -1)):
            sw = P('sway_%d' % (k + 1), 'head', hd(side * .08, -.36, -.2))
            for i in range(4):
                x = side * (.02 + .045 * i)
                h = hit(tree, (x, -3, z0 + gap * .4), (0, 1, 0))
                y = h[0].y if h[0] is not None else hd(0, -.36, 0).y
                sw['fib'].append(hang((x, y - .005, z0 + gap * .5), .3 + .5 * ((i * 7 + k * 3) % 5) / 4, 60 + i + 10 * k, r=.005))
    if ST == 2:   # from under the scalp all round, two metres of it, and red ones from the mouth
        groups = [(-150, -95), (-95, -40), (40, 95), (95, 150), (150, 210), (-22, 22)]   # degrees round the head, 0 = front
        for k, (a0, a1) in enumerate(groups):
            mid = math.radians((a0 + a1) / 2)
            mouth = k == 5
            sw = P('sway_%d' % (k + 1), 'head', hd(0, -.36, -.2) if mouth else HEAD_C + V((.2 * math.sin(mid), -.2 * math.cos(mid), -.08)))
            for i in range(5 if mouth else 6):
                a = math.radians(a0 + (a1 - a0) * (i + .5) / (5 if mouth else 6))
                if mouth:
                    st_ = hd(.19 * math.sin(a) * 2.2, -.37, -.225)
                    sw['fib'].append(hang(st_, .4 + .7 * ((i * 3) % 5) / 4, 80 + i, col=np.array([.11, .008, .008]), r=.0045))
                else:
                    h = hit(tree, HEAD_C + V((math.sin(a), -math.cos(a), -.25)) * 2, V((-math.sin(a), math.cos(a), .2)))
                    st_ = h[0] if h[0] is not None else HEAD_C + V((.2 * math.sin(a), -.2 * math.cos(a), -.1))
                    sw['fib'].append(hang(st_, 1.0 + 1.0 * ((i * 5 + k * 3) % 7) / 6, 70 + i + 10 * k, r=.0075))


def make_extras():
    """Stage 2: four thin jointed legs out of the drape, two a side, like a
    harvestman's. Each is three stiff segments with a knuckle at every joint.
    extra_3 is dead and stays curled above the hip."""
    dark = FUR * .55
    legs = {1: [(-.2, 0, 1.47), (-.8, -.26, 2.2), (-1.12, -.44, 1.15), (-1.2, -.52, .0)],       # upper right
            2: [(.2, 0, 1.47), (.76, -.22, 2.12), (1.1, -.4, 1.1), (1.19, -.5, .0)],            # upper left
            3: [(-.24, .1, 1.3), (-.72, .38, 1.72), (-.97, .56, 1.46), (-.74, .5, 1.27)],       # lower right, dead
            4: [(.24, .1, 1.3), (.84, .46, 1.82), (1.13, .62, .95), (1.2, .72, .0)]}            # lower left
    for n, pts in legs.items():
        pts = [V(p) for p in pts]
        for j in range(3):
            name = 'extra_%d' % n if j == 0 else 'extra_%d_%d' % (n, j + 1)
            parent = 'body' if j == 0 else ('extra_%d' % n if j == 1 else 'extra_%d_%d' % (n, j))
            pt = P(name, parent, pts[j])
            a, b = pts[j], pts[j + 1]
            d = (b - a)
            r0, r1 = [.036, .028, .022][j], [.028, .022, .006][j]
            path = [a + d * t for t in (0, .12, .5, .88, 1)]
            f = [tube(path, [r0 * 1.3, r0, (r0 + r1) / 2 * .85, r1, r1 * (1.5 if j < 2 else 1)], 8),
                 ell(a, [.07, .058, .05][j], seg=12)]
            if j < 2: f.append(ell(b, [.05, .042][j], seg=12))    # the far knuckle; the next segment's own ball covers it
            else: f.append(tube([b - d.normalized() * .04, b + V((0, -.05, .0)) if n != 3 else b + d.normalized() * .03], [.012, .002], 6))   # a hooked tip
            o = sculpt(f, .0065, 2, [(.004, 28, 1)], 50 + n * 3 + j)
            def fn(Pt, N, a=a, b=b):
                da = np.linalg.norm(Pt - np.array(a), axis=1); db = np.linalg.norm(Pt - np.array(b), axis=1)
                near = np.minimum(da, db)
                furry = sstep(.1, .22, near) * (fbm(Pt, 9, n) > .35)      # ragged sleeves of pile between bare joints
                col = np.tile(dark, (len(Pt), 1)) * (.45 + .55 * furry[:, None]) + (1 - furry[:, None]) * np.array([.02, .012, .01])
                prm = np.stack([furry, .35 + .5 * furry, sstep(.72, .85, fbm(Pt, 10, 3 + n)) * .8], 1)
                return col, prm
            paint(o, fn); decimate(o, 620)
            pt['tex'].append(o)
            pt['fib'].append(tufts(o, 26, 90 + n * 3 + j, length=(.03, .09), width=.007, droop=.6, lift=1, shade=.6))


# ---------------------------------------------------------------- assemble
FOCUS = {'face': ((HEAD_C.x, HEAD_C.y - .25 * HEAD_S, HEAD_C.z - .03), .55 * HEAD_S ** .5),
         'head': ((0, HEAD_C.y, HEAD_C.z + (.2 if ST == 2 else 0)), .9),
         'hips': ((0, 0, .9), 1.3), 'back': ((0, .3, 1.4), 1.0), 'hem': ((0, -.4, 1.0), .7),
         'leg': ((1.0, -.3, 1.2), 1.1), 'chest': ((0, -.4, 1.6), .6)}


def assemble(name, pose=None):
    fibre = fibre_material()
    glow = glow_material((.85, .82, .7) if ST < 2 else (1, .93, .8))
    tex = {}
    for k, p in parts.items():
        if p['tex']: tex[k] = join(p['tex'])
    lap('join')
    unwrap(list(tex.values())); lap('unwrap')
    bake(list(tex.values()), bake_material(**SURFACE)); lap('bake')
    root = empty('root')
    objs = {'root': root}
    for k, p in parts.items():
        pieces = []
        if k in tex:
            for a in ('Col', 'Prm'): tex[k].data.color_attributes.remove(tex[k].data.color_attributes[a])
            pieces.append(tex[k])
        fib = [o for o in p['fib'] if o is not None]
        if fib:
            fo = join(fib); fo.data.materials.append(fibre); pieces.append(fo)
        if p['glow']:
            go = join(p['glow']); go.data.materials.append(glow); smooth_shade(go); pieces.append(go)
        o = join(pieces)
        if 'Col' in o.data.color_attributes:
            o.data.color_attributes.active_color = o.data.color_attributes['Col']
            o.data.color_attributes.render_color_index = o.data.color_attributes.find('Col')
        objs[k] = part(o, k, objs[p['parent']], p['pivot'])
    if pose:
        for k, rot in pose.items():
            if k in objs: objs[k].rotation_euler = [math.radians(a) for a in rot]
    export_glb(name, [root]); lap('export')


def notes():
    common = ('Walk: a slow heavy waddle, hips rolling side to side (roll body about 4 degrees), legs short-stepping; swing leg_* at the hip up to 30 degrees and bend shin_* back up to 40. '
              'The leg and arm joints are balls buried in fur, safe to 40 degrees about any axis. ')
    if ST == 0:
        return (common + 'Idle: dead still, then a small head tilt (head roll or yaw 10 to 15 degrees). Head joint is hidden in the shoulders and by the pearls, which belong to body: keep head pitch within 15 degrees down, 25 up, yaw 40, or the tusks and chin meet the pearls. '
                'Arms hang; arm_* can lift 40 forward for the hug, forearm_* bend up to 40. No jaw at this stage. Eyes are googly balls, any angle. Attack: arms open wide then close, head tips back.')
    if ST == 1:
        return (common + 'neck is a short stretched stump between collar and head; neck pitch or roll 15, head on top of it another 25, yaw 40. Tusks are long and hang in front of the chest: head plus neck pitch down more than about 12 degrees puts them into the fur. '
                'jaw is a ventriloquist block under the whisker pads with human teeth; it opens downward (positive x) up to 45 degrees, do not turn it negative. sway_1 (its left) and sway_2 (its right) are black strands hanging from the mouth, pivots at the lip; swing them a few degrees, more when the head moves. '
                'The eyes do not match (left pinned, right swollen and low); letting them track at different speeds suits it. Idle: head lolling to one side, jaw dropping open slowly and snapping shut. Attack: jaw 45, neck stretched forward, arms up to 40.')
    return (common + 'Arms are gone. The drape is part of body and does not move. neck is a long stalk (pivot at the collar inside the drape): pitch and roll up to 25, yaw 30; head on top of it another 35 any way. The antlers are part of head and reach 3.27 m, so tip the neck forward to pass a 3 m doorway. '
            'jaw is the whole underside of the face; open it 70 to 80 degrees for the jumpscare (positive x), there are two rows of teeth and a black cavity behind. '
            'sway_1..sway_5 are bundles of black hair hanging up to two metres from the scalp: 1 right-back, 2 right, 3 left, 4 left-back, 5 back. sway_6 is the red strands from the mouth. They are stiff rods hinged at the head, so keep swings under 10 degrees or they pass through the drape. '
            'extra_1 (upper right), extra_2 (upper left), extra_4 (lower left) are live harvestman legs, each a chain extra_N > extra_N_2 > extra_N_3 with ball knuckles: hip, knee, ankle. Any joint can turn 40 degrees; spasm them in held steps. Feet rest on the floor at rest. '
            'extra_3 (lower right) is the dead one: it is modelled curled above the hip and should only tremble, 2 or 3 degrees. Walk: the body glides on the hidden legs while the three live extras tap ahead of it out of time. Idle: perfectly still, then one extra leg jerks. '
            'Attack: neck swings the head down to face height, jaw drops to 75, the upper extras reach forward (rotate extra_1 and extra_2 about z toward the front).')


def write_json(info):
    path = os.path.join(MODELS, 'walrus.json')
    data = json.load(open(path)) if os.path.exists(path) else {'key': 'walrus', 'stages': [None, None, None]}
    lo, hi = info['min'], info['max']
    data['stages'][ST] = {
        'file': info['file'], 'height': round(hi[2], 2),
        'radius': round(max(abs(lo[0]), abs(hi[0]), abs(lo[1]), abs(hi[1])), 2),
        'face': [0, round(HEAD_C.z - .03, 2), round(-(HEAD_C.y - .33 * HEAD_S), 2)],   # three.js axes
        'floats': False, 'nodes': info['nodes'], 'notes': notes()}
    json.dump(data, open(path, 'w'), indent=1)


POSE = {'head': (25, 30, 10), 'neck': (20, 0, 15), 'jaw': ([0, 40, 75][ST], 0, 0), 'arm_L': (-40, 0, 0), 'arm_R': (35, 0, 30), 'forearm_L': (-40, 0, 0),
        'leg_L': (-35, 0, 0), 'shin_L': (40, 0, 0), 'leg_R': (30, 0, 0), 'extra_1': (0, 0, 35), 'extra_1_2': (0, 35, 0), 'extra_2_2': (30, 0, 0),
        'extra_4': (0, 0, -30), 'extra_4_3': (0, -35, 0), 'sway_1': (10, 0, 0), 'eye_L': (0, 0, 35), 'eye_R': (20, 0, -35)}

name = 'walrus_%d' % ST
if '--only' not in ARGS:
    reset()
    collide = make_body(); lap('body')
    make_legs(); lap('legs')
    if ST < 2: make_arms()
    if ST: make_neck()
    if ST == 2:
        make_extras()
        parts['body']['tex'] = [join(parts['body']['tex'])]
        collide = bvh(parts['body']['tex'][0])   # body and drape as one, for the hair to lie on
    make_head(collide); lap('head')
    if '--pose' in ARGS:
        name += '_pose'
        assemble(name, POSE)
    else:
        assemble(name)
        write_json(report(name))
for spec in ARGS[1:]:
    if spec.startswith('--'): continue
    v, light, focus = (spec.split(':') + ['', ''])[:3]
    light = light or 'flashlight'
    preview(name, views=(v,), res=560, samples=20, light=light, focus=FOCUS.get(focus), tag=('_' + focus if focus else '') + ('_studio' if light == 'studio' else '') + ('_pose' if '--pose' in ARGS else ''))
