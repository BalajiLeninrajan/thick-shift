# The pieces Stompy is made of. Each function builds meshes with procedural
# materials and registers them on a Rig as named parts with pivots; build.py
# decides where they go at each stage and runs the bake and export.
import math
import numpy as np
from mathutils import Vector, Matrix
from sculpt import *
import shade


class Rig:
    """The list of parts to export: name, parent, pivot, the meshes that get
    baked, and the eye_glow meshes that are joined on after the bake."""

    def __init__(self):
        self.parts, self.notes, self.nsway = [], {}, 0

    def add(self, name, parent, pivot, pieces, glow=(), note=None):
        self.parts.append(dict(name=name, parent=parent, pivot=tuple(float(v) for v in pivot),
                               pieces=[p for p in pieces if p is not None], glow=list(glow)))
        if note: self.notes[name] = note
        return name

    def sway(self, parent, pivot, pieces, note):
        self.nsway += 1
        return self.add(f'sway_{self.nsway}', parent, pivot, pieces, note=note)


def mat(obs, m):
    for o in (obs if isinstance(obs, (list, tuple)) else [obs]):
        if o is not None: setmat(o, m)
    return obs


def pt(T, p):
    return np.array(T @ Vector(p))


# ---------- head ----------

EYE_X, EYE_Z = .2, .455


def head(rig, M, stage, T, parent, rng, tris):
    """The costume head, built upright around its neck joint at the origin
    and facing -y, then moved by T. The same foam blocks at every stage; what
    changes is what has been done to them."""
    c = Clay()
    c.ell((0, -.02, .36), (.43, .40, .37), e=3.2, sub=4)            # skull block
    c.ell((0, -.31, .56), (.36, .13, .08), e=2.4)                   # brow
    c.ell((0, -.42, .20), (.30, .30, .19), e=3.0, sub=4)            # muzzle block
    c.ell((0, -.55, .31), (.15, .14, .08))                          # boss the horn sits on
    c.ell((0, -.36, .07), (.24, .26, .10), e=2.5)                   # chin
    for sx in (-1, 1):
        c.ell((sx * .30, -.12, .15), (.17, .22, .16))               # jowls
        c.ell((sx * .27, .12, .78), (.085, .05, .13), rot=(-.2, sx * .3, 0))   # ears
    if stage: c.ell((.2, -.36, .57), (.13, .08, .05), rot=(0, .25, 0))         # one brow has slumped over its eye
    skull = c.build('skull', .011, 4)
    for sx in (-1, 1):
        dent(skull, (sx * .27, .06, .80), .055, .028)               # cup the ears
        dent(skull, (sx * .09, -.72, .27), .035, .03)               # nostrils
    if stage:
        for sx in (-1, 1):                                          # the foam has collapsed at the temples and cheeks
            dent(skull, (sx * .41, -.05, .42), .16, .045)
            dent(skull, (sx * .36, -.3, .2), .12, .03)
        roughen(skull, .007, 7, seed=3 + stage)
        if stage == 2: dent(skull, (-.1, .1, .74), .2, .05)         # caved in on top

    surf = Surface(skull)
    eyes = {}
    for side, sx in (('L', 1), ('R', -1)):
        hit, _ = surf.ray((sx * EYE_X, -1.2, EYE_Z), (0, 1, 0))
        eyes[side] = hit
        dent(skull, hit, .1, [.03, .035, .075][stage])

    # mouth: a printed smile, later a slit pulled shut with thread
    pieces = []
    if stage == 0:
        xs = np.linspace(-.17, .17, 17)
        line = [(x, -1.2, .105 + .075 * (x / .17) ** 2) for x in xs]
        groove(skull, Surface(skull).drape(line, (0, 1, 0)), .014, .008)
    else:
        xs = np.linspace(-.25, .25, 25)
        line = [(x, -1.2, .125 + .018 * math.sin(x * 14) - .03 * (x / .25) ** 2) for x in xs]
        groove(skull, Surface(skull).drape(line, (0, 1, 0)), .016, .016)
    surf = Surface(skull)
    lip = surf.drape(line, (0, 1, 0), lift=-.002)
    if stage == 0:
        r = .012 * np.sin(np.linspace(.25, math.pi - .25, len(lip))) ** .5
        pieces.append(mat(tube(lip, r, n=6, name='smile'), M['felt']))
        for end in (lip[0], lip[-1]):                               # dimples
            pieces.append(mat(solid(end, (.017, .012, .017)), M['felt']))
    else:
        pieces.append(mat(tube(lip, .007, n=5, name='slit'), M['felt']))
        k = 0
        for i in range(2, len(line) - 2, 2):                        # the stitches
            x, _, z = line[i]
            lean = rng.uniform(-.02, .02)
            a = (x - lean, -1.2, z + rng.uniform(.03, .05))
            b = (x + lean + (.012 if k % 3 == 0 else 0), -1.2, z - rng.uniform(.03, .05))
            ends = surf.drape([a, b], (0, 1, 0))
            for e in ends: dent(skull, e, .016, .007)               # the thread pulls the cloth in
            mid = np.linspace(ends[0], ends[1], 6)
            arch = np.sin(np.linspace(0, math.pi, 6)) * .012 + .003
            mid[:, 1] -= arch
            mid[0, 1] += .012; mid[-1, 1] += .012                   # ends sink into the holes
            pieces.append(mat(tube(mid, .0075, n=6, name='stitch'), M['thread']))
            k += 1
        # the loose end of the thread
        tail = [lip[-3] + (0, -.004, 0), lip[-3] + (.02, -.02, -.05), lip[-3] + (.03, -.015, -.13)]
        pieces.append(mat(tube(tail, [.006, .005, .002], n=5, name='tail'), M['thread']))

    # horn: longer at every stage, and from stage 1 split and chipped
    L = [.42, .6, .72][stage]
    t = np.linspace(0, 1, 15)
    base = np.array([0, -.565, .31])
    hp = base + np.stack([t * 0 + (stage and .02 * np.sin(t * 5)), -.07 * t + .13 * t * t, L * t], 1)
    n = 16
    hr = np.repeat((.108 * (1 - t) ** .75 + .008)[:, None], n, 1)
    if stage:
        ang = np.arange(n) / n * math.tau
        hr = hr * (1 + .08 * np.sin(ang * 3 + t[:, None] * 7) * t[:, None])           # gone lumpy
        for a0, depth in ((1.2, .028), (4.1, .018)):                                 # cracks you can see in outline
            w = np.exp(-((np.angle(np.exp(1j * (ang - a0 - t[:, None] * 1.5)))) / .22) ** 2)
            hr = hr - w * depth * np.sin(t[:, None] * math.pi) ** .5 * (hr / .1)
        hr[-1] = hr[-1] * 1.8; hr[-2] = hr[-2] * 1.25                                # the point has snapped off
    pieces.append(mat(tube_rest(hp, hr, n=n, name='horn', length=L), M['horn']))

    # sweatband, wrapped on the skull by casting rays in toward its axis
    tilt = [0, .05, .16][stage]
    axis = np.array([math.sin(tilt), 0, math.cos(tilt)])
    centre = np.array([0, -.03, .625 - .02 * stage])
    u = np.cross(axis, [0, 1.0, 0]); u /= np.linalg.norm(u); v = np.cross(axis, u)
    rows, nb = [], 56
    for i in range(nb):
        a = i / nb * math.tau
        d = math.cos(a) * u + math.sin(a) * v
        sect = []
        for hgt, lift in ((-.04, .004), (-.03, .016), (0, .02), (.03, .016), (.04, .004)):
            hit, nn = surf.ray(centre + axis * hgt + d * 1.5, -d)
            if hit is None: hit, nn = surf.near(centre + axis * hgt + d * .45)
            sect.append(hit + d * lift)
        rows.append(sect)
    bv = [p for sect in rows for p in sect]
    bf = [(i * 5 + j, ((i + 1) % nb) * 5 + j, ((i + 1) % nb) * 5 + j + 1, i * 5 + j + 1) for i in range(nb) for j in range(4)]
    pieces.append(mat(fix_normals(mesh_obj('band', bv, bf)), M['terry']))

    # eye rims (they stay with the head; the balls are their own parts)
    eye_parts = []
    for side, sx in (('L', 1), ('R', -1)):
        hit = eyes[side]
        if stage < 2:
            r = .085
            cen = hit + np.array([0, r * .3, 0])
            if stage == 1 and side == 'R': cen = cen + np.array([-.008, -.03, -.022])   # this one has come loose
            pieces.append(mat(loop(hit + (0, .012, 0), r * 1.02, .014, name='rim'), M['black']))
            ball = mat(solid(cen, (r, r, r), sub=3, name='ball'), M['white'])
            if stage == 0: d, rp = np.array([sx * -.06, -1, -.12]), .04                  # both a little cross-eyed and down: friendly
            elif side == 'L': d, rp = np.array([.45, -1, .35]), .056
            else: d, rp = np.array([.22, -1, -.5]), .021
            d = d / np.linalg.norm(d)
            off = math.sqrt(r * r - rp * rp)
            pupil = mat(solid(cen + d * off, (rp, rp, r - off + .004), rot=aim(d), sub=3, name='pupil'), M['black'])
            dot = setmat(solid(cen + d * (r + .004) + np.array([sx * .0, 0, 0]), (.011, .011, .003), rot=aim(d), sub=1, name='dot'), shade.glow())
            eye_parts.append((side, cen, [ball, pupil], [dot]))
        else:
            # The plastic eyes are gone and something's own eyes fill the
            # sockets: bigger than the costume's, bulging, wet, lidless. They
            # do not match. The left is blown, all pupil, and aimed off to the
            # side; the right is a pinprick and looks down at whoever is
            # holding the torch. The gazes are given in the world, past the
            # lolled head, so the right one meets the player in the rest pose.
            # The iris and pupil are painted (shade.stare) in the ball's own
            # space, gaze along +z, so the ball turns as one.
            r, dw = ((.104, (.55, -1, .3)) if side == 'L' else (.094, (.02, -1, -.38)))
            d = np.array(T.to_3x3().inverted() @ Vector(dw))
            d = d / np.linalg.norm(d)
            cen = hit + np.array([0, r * .42, 0])
            ball = solid((0, 0, 0), (1, 1, 1), sub=4, name='ball')
            v = co(ball)
            rho = np.hypot(v[:, 0], v[:, 1])
            v *= (1 + .07 * np.exp(-(rho / .45) ** 2) * (v[:, 2] > 0))[:, None]   # the cornea, proud of the ball
            setco(ball, v)
            stamp_rest(ball)
            R = aim(d).to_matrix()
            xform(ball, Matrix.Translation(Vector(cen)) @ R.to_4x4() @ Matrix.Scale(r, 4))
            mat(ball, M['stare_' + side])
            # a catchlight, the same way up on both, so it sits somewhere
            # different on each iris: the one point that shows in the dark
            cl = d + np.array([-.22, 0, .3]); cl /= np.linalg.norm(cl)
            dot = setmat(solid(cen + cl * (r * 1.06 + .002), (.0105, .0105, .003), rot=aim(cl), sub=1, name='dot'), shade.glow())
            eye_parts.append((side, cen, [ball], [dot]))

    # fur that breaks the outline
    def furry(p, nrm):
        front = (p[:, 1] < -.3) & (p[:, 2] < .6)                    # keep the face clear
        return ~front & (p[:, 2] > .05)
    if stage == 0:
        tf = tufts(skull, 70, .035, rng, lambda p, nn: (p[:, 2] > .78) | ((np.abs(p[:, 0]) > .36) & (p[:, 2] < .3)), width=.012, droop=.3)
    else:
        tf = tufts(skull, 230 if stage == 1 else 170, .075, rng, furry, width=.022, droop=1.0)
    mat(skull, M['head']); decimate(skull, tris)
    if tf is not None: pieces.append(mat(tf, M['head']))
    pieces.insert(0, skull)

    for p in pieces: xform(p, T)
    for side, cen, ps, gl in eye_parts:
        for p in ps + gl: xform(p, T)
        rig.add('eye_' + side, 'head', pt(T, cen), ps, gl)
    rig.add('head', parent, pt(T, (0, 0, 0)), pieces)

    # black strands from under the muzzle; they hang by gravity whatever the head is doing
    if stage:
        wsurf = Surface(skull)
        groups = 3 if stage == 1 else 4
        count = 11 if stage == 1 else 17
        maxlen = .5 if stage == 1 else 1.0
        tops = []
        for i in range(count):
            lx = (i + rng.uniform(.1, .9)) / count * .44 - .22
            start = pt(T, (lx, rng.uniform(-.63, -.38), .02))
            hit, _ = wsurf.ray(start - np.array([0, 0, 1.0]), (0, 0, 1))
            if hit is None: hit = start
            tops.append((lx, hit + np.array([0, 0, .01])))
        for g in range(groups):
            sel = [tp for lx, tp in tops if int((lx + .22) / .44 * groups * .999) == g]
            if not sel: continue
            ss = []
            for j, tp in enumerate(sel):
                bloody = stage == 2 and (j + g) % 3 == 0
                Ls = maxlen * rng.uniform(.3, 1.0) * (.75 if bloody else 1)
                s = strand(tp, Ls, rng.uniform(.006, .01), rng, wave=.035, segs=8, n=5, blob=.011 if bloody else 0)
                ss.append(mat(s, M['crust'] if bloody else M['hair']))
            piv = np.mean([tp for tp in sel], axis=0)
            rig.sway('head', piv, ss, 'black strands hanging from under the muzzle' + (', some clotted with blood' if stage == 2 else ''))


# ---------- limbs ----------

def hand(c, wrist, fwd, side, rng, size=1.0, curl=(0, 0, 0), spread=.16):
    """Add a long-fingered hand to a Clay. Returns the fingertips as
    (position, direction) so nails can go on."""
    wrist, fwd, side = (np.asarray(v, float) for v in (wrist, fwd, side))
    fwd /= np.linalg.norm(fwd); side /= np.linalg.norm(side)
    curl = np.asarray(curl, float)
    c.limb([wrist, wrist + fwd * .09 * size], [.045 * size, .058 * size])
    c.ell(wrist + fwd * .09 * size, np.array([.062, .062, .04]) * size)
    tips = []
    for k in range(4):
        o = (k - 1.5)
        d = fwd + side * o * spread + curl * .15
        d /= np.linalg.norm(d)
        p = wrist + fwd * .12 * size + side * o * .03 * size
        pts, rad = [p], [.023 * size]
        for j, seg in enumerate((.105, .09, .07)):
            seg *= size * (1 - abs(o) * .09) * rng.uniform(.9, 1.1)
            d = d + curl * (.3 + .25 * j); d /= np.linalg.norm(d)
            p = p + d * seg
            pts.append(p); rad.append((.021, .018, .013)[j] * size)
        c.limb(pts, rad)
        for q in pts[1:3]: c.ell(q, (.024 * size,) * 3, sub=2)     # knuckles
        tips.append((p, d))
    d = fwd * .5 + side * 1.0 + curl * .3; d /= np.linalg.norm(d)   # thumb
    p = wrist + fwd * .04 * size + side * .04 * size
    c.limb([p, p + d * .08 * size, p + (d + fwd * .6) * .13 * size], [.024 * size, .019 * size, .013 * size])
    tips.append((p + (d + fwd * .6) * .13 * size, (d + fwd) / np.linalg.norm(d + fwd)))
    return tips


def nails(tips, M, length=.045, r=.012):
    out = []
    for p, d in tips:
        pts = [p - d * .012, p + d * length * .5, p + d * length + np.array([0, 0, -.006])]
        out.append(mat(tube(pts, [r, r * .75, .001], n=5, name='nail'), M['claw']))
    return out


def foot(c, ankle, M, sx, size=1.0):
    """Costume foot: a squared-off pad. Returns the three toenails."""
    ax, ay, az = ankle
    cen = np.array([ax + sx * .01, ay - .1 * size, .095 * size])
    c.ell(cen, (.24 * size, .34 * size, .095 * size), e=3.0, sub=3)
    c.limb([ankle, cen + (0, .08, .02)], [.15 * size, .17 * size])
    out = []
    for k in (-1, 0, 1):
        p = cen + np.array([k * .14 * size, -.3 * size + abs(k) * .035, -.005])
        out.append(mat(solid(p, (.062 * size, .045 * size, .06 * size), e=2.6, name='toenail'), M['nail']))
    return out


# ---------- small costume fittings ----------

def zipper(rig, body, M, z0, z1, stage):
    """The zip down the back: tape, teeth and a pull tab, laid on the body."""
    surf = Surface(body)
    zs = np.linspace(z0, z1, 26)
    line = surf.drape([(0, 2.0, z) for z in zs], (0, -1, 0), lift=.004)
    wob = 0 if stage == 0 else .006
    line[:, 0] += np.sin(zs * 23) * wob
    tape = mat(tube(line, .03, n=6, name='tape', squash=.16), M['tape'])
    teeth = mat(tube(line + (0, .004, 0), .0095, n=6, name='zipteeth', squash=.6), M['zip'])
    top = line[0] + np.array([0, .01, 0])
    tab = mat(solid(top + (0, .004, -.03), (.014, .005, .03), e=3, name='tab'), M['zip'])
    slider = mat(solid(top, (.017, .009, .017), e=3, name='slider'), M['zip'])
    return [tape, teeth, tab, slider]


def tail(rig, body, M, z, stage, rng, parent='body'):
    surf = Surface(body)
    root, _ = surf.ray((0, 2.0, z), (0, -1, 0))
    c = Clay()
    L = .2 if stage == 0 else .26
    pts = [root + (0, -.04, 0), root + (0, .05, -.02), root + (.01, .09, -L * .55), root + (0, .075, -L)]
    c.limb(pts, [.04, .035, .028, .024])
    c.ell(pts[-1] + (0, 0, -.03), (.045, .045, .06))
    t = c.build('tail', .008, 2)
    tf = tufts(t, 60, .07 if stage == 0 else .11, rng, lambda p, nn: p[:, 2] < pts[-1][2] + .03, width=.012, droop=1.0)
    decimate(t, 500)
    rig.sway(parent, root, mat([t, tf], M['limb']), 'the tail: a short rope with a tuft, hangs over the rear')


# ---------- the worm ----------

def worm(rig, M, ctrl, links, rng, r0=.2, r1=.135):
    """A chain of rigid beads along the spline through ctrl. Each link's
    origin is its joint with the one before. Neighbours end in matching
    half-spheres centred on the shared joint, so a joint can bend about 25
    degrees before the skin opens. Returns [(name, parent, start, end, R)]."""
    path, total = spline(ctrl, 600)
    s = np.linspace(0, total, 600)
    at = lambda u: np.array([np.interp(u, s, path[:, k]) for k in range(3)])
    lens = rng.uniform(.75, 1.3, links); lens = lens / lens.sum() * total
    cuts = np.concatenate([[0], np.cumsum(lens)])
    R = np.array([(r0 + (r1 - r0) * i / (links - 1)) * rng.uniform(.84, 1.2) for i in range(links)])
    R[0] = max(R[0], .19)                                           # it has to fill the wound
    RJ = np.array([R[0] * .85] + [.8 * min(R[i - 1], R[i]) for i in range(1, links)] + [.8 * R[-1]])
    out, n = [], 22
    ang = np.arange(n) / n * math.tau
    for i in range(links):
        a, b, ln = cuts[i], cuts[i + 1], lens[i]
        ja, jb = RJ[i], RJ[i + 1]
        us, rs = [], []
        for k in range(1, 4):                                       # the hidden half-sphere at the near joint
            th = (1 - k / 4) * math.pi / 2
            us.append(a - ja * math.sin(th)); rs.append(ja * math.cos(th))
        rings = 9
        folds = rng.integers(2, 4)
        for k in range(rings + 1):
            t = k / rings
            bulge = (R[i] - (ja + (jb - ja) * t)) * math.sin(math.pi * t) ** .7
            wr = .014 * math.sin(t * math.pi * 2 * folds) * math.sin(math.pi * t)
            us.append(a + ln * t); rs.append(ja + (jb - ja) * t + bulge + wr)
        for k in range(1, 4):
            th = k / 4 * math.pi / 2
            us.append(b + jb * math.sin(th)); rs.append(jb * math.cos(th))
        # past either end of the path, carry straight on, so the end caps stay round
        d0 = (path[1] - path[0]) / np.linalg.norm(path[1] - path[0])
        d1 = (path[-1] - path[-2]) / np.linalg.norm(path[-1] - path[-2])
        us = np.array(us)
        pts = np.array([path[0] + d0 * u if u < 0 else at(u) if u <= total else path[-1] + d1 * (u - total) for u in us])
        lump = fbm(np.stack([np.cos(ang)[None, :] * 3 + i * 9.1 + 0 * us[:, None], np.sin(ang)[None, :] * 3 + 0 * us[:, None], us[:, None] * 9 + 0 * ang[None, :]], -1).reshape(-1, 3), 3, seed=i).reshape(len(us), n)
        sag = 1 + .06 * np.cos(ang - math.pi)[None, :]             # heavier underneath
        rad = np.array(rs)[:, None] * (1 + .1 * lump) * sag
        seg = tube_rest(pts, rad, n=n, name='seg', origin=(0, 0, i * 1.7))
        pieces = [mat(seg, M['worm'][i])]
        T, N, B = frames(pts)
        # boils
        for _ in range(rng.integers(1, 4)):
            k = rng.integers(4, 3 + rings); j = rng.integers(0, n)
            d = math.cos(ang[j]) * N[k] + math.sin(ang[j]) * B[k]
            br = rng.uniform(.018, .036)
            bo = solid((0, 0, 0), (br, br, br * .8), sub=2, name='boil')
            a_ = co(bo)                                             # rest: the boil's own space, 0 at its root to 1 at its head
            at_ = bo.data.attributes.new('rest', 'FLOAT_VECTOR', 'POINT')
            at_.data.foreach_set('vector', np.stack([a_[:, 0] / br, a_[:, 1] / br, a_[:, 2] / (br * .8) * .5 + .5], 1).ravel())
            xform(bo, Matrix.Translation(Vector(pts[k] + d * (rad[k, j] - br * .25))) @ aim(d).to_matrix().to_4x4())
            pieces.append(mat(bo, M['boil']))
        # bristles, in tufts, on alternate links
        if i % 2:
            for _ in range(4):
                k = rng.integers(5, 2 + rings); j = rng.integers(0, n)
                for _ in range(3):
                    jj = (j + rng.integers(-1, 2)) % n
                    d = math.cos(ang[jj]) * N[k] + math.sin(ang[jj]) * B[k] + T[k] * rng.uniform(-.4, .4)
                    p0 = pts[k] + (math.cos(ang[jj]) * N[k] + math.sin(ang[jj]) * B[k]) * (rad[k, jj] - .005)
                    Lb = rng.uniform(.05, .11)
                    pieces.append(mat(tube([p0, p0 + d * Lb * .6 + (0, 0, -.01), p0 + d * Lb + (0, 0, -.035)], [.0045, .003, .0006], n=4, name='bristle'), M['hair']))
        name = 'extra_1' if i == 0 else f'extra_1_{i + 1}'
        parent = 'body' if i == 0 else ('extra_1' if i == 1 else f'extra_1_{i}')
        rig.add(name, parent, at(a), pieces)
        out.append((name, at(a), at(b), R[i], pts, rad, N, B))
    return out, at(total)


def worm_mouth(rig, M, name, parent, tip, rj, rng, first_ring=2):
    """The worm's head, built facing -y with the centre of its lips at the
    origin, then moved so its neck joint lands on `tip`. Three tooth rings
    and the second mouth are child parts, each with its origin on the axis so
    the game can spin them about it (in three.js that axis is z)."""
    LEN = .36
    prof = [(LEN + rj * math.sin(th), rj * math.cos(th)) for th in (1.35, .95, .5)]   # ball that sits in the last link
    prof += [(LEN, rj), (.29, rj * 1.02), (.2, .17), (.12, .215), (.05, .262), (.0, .283), (-.035, .268), (-.05, .24), (-.035, .215), (.0, .2),
             (.035, .193), (.07, .176), (.11, .158), (.15, .136), (.19, .113), (.23, .09), (.27, .07), (.31, .052), (.34, .03), (.345, .001)]
    lipw = np.array([0, 0, 0, 0, 0, 0, .15, .5, 1, 1, 1, .7, .3] + [0] * 20)[:len(prof)]
    inner = np.array([0] * 12 + [1] * 20)[:len(prof)]
    ph = rng.uniform(0, 6.28, 15)

    def mod(i, a):
        lobe = .5 + .5 * np.cos(a * 15)
        lobe = lobe ** .6                                           # full lobes, tight creases between them
        size = 1 + .25 * np.sin(np.floor((a + math.pi / 15) / (math.tau / 15)) * 2.4 + 1)
        y = prof[i][0]
        fold = np.sin(a * 22 + y * 34)
        dr = lipw[i] * (.03 * lobe * size - .012) + inner[i] * (-.01 * (.5 + .5 * fold) * min(1, prof[i][1] / .1))
        dy = -lipw[i] * .03 * lobe * size
        return dy, dr

    bell = fix_normals(revolve(prof, n=105, name='bell', mod=mod))
    roughen(bell, .004, 30, seed=2, mask=lambda p: (p[:, 1] > .06) * 1.0)
    pieces, glow = [mat(bell, M['mouth'])], []
    # bead eyes round the rim, each with its own pinprick
    for i in range(9):
        a = i / 9 * math.tau + rng.uniform(0, .4)
        er = rng.uniform(.015, .026)
        p = np.array([math.cos(a) * .285, .03 + rng.uniform(-.01, .02), math.sin(a) * .285])
        pieces.append(mat(solid(p, (er,) * 3, sub=2, name='bead'), M['eyeball']))
        pieces.append(mat(loop(p + (0, -er * .2, 0), er * 1.05, er * .32, n=10, m=5, name='lid'), M['meat']))
        glow.append(setmat(solid(p + (0, -er - .001, 0), (er * .3, er * .3, .002), rot=aim((0, -1, 0)), sub=1, name='dot'), shade.glow()))
    # slime strung across the mouth
    for (a0, a1) in ((.4, 3.3), (2.2, 5.3), (4.6, 1.2)):
        p0 = np.array([math.cos(a0) * .2, .0, math.sin(a0) * .2]); p1 = np.array([math.cos(a1) * .19, .04, math.sin(a1) * .19])
        tt = np.linspace(0, 1, 9)
        pts = p0 + (p1 - p0) * tt[:, None] + np.outer(np.sin(tt * math.pi), (0, .02, -.09))
        pieces.append(mat(tube(pts, .0018 + .006 * np.abs(np.cos(tt * math.pi)) ** 4, n=5, name='string'), M['slime']))

    Tm = Matrix.Translation(Vector(tip) - Vector((0, LEN, 0)))
    made = [(name, parent, (0, LEN, 0), pieces, glow, None)]

    def ring_teeth(y, r, count, length, direction, base_r):
        ps = [mat(loop((0, y, 0), r + .004, .013, n=40, m=6, name='gum'), M['meat'])]
        for i in range(count):
            a = i / count * math.tau + rng.uniform(-.04, .04)
            rho = np.array([math.cos(a), 0, math.sin(a)]); tan = np.array([-math.sin(a), 0, math.cos(a)]) * direction
            Lt = length * rng.uniform(.75, 1.25)
            tt = np.linspace(0, 1, 5)
            pts = np.array([math.cos(a) * r, y, math.sin(a) * r]) + np.outer(tt, -rho * Lt * .8) + np.outer(tt, (0, -Lt * .45, 0)) + np.outer(tt ** 2, tan * Lt * .45 + np.array([0, Lt * .25, 0]))
            rad = base_r * (1 - tt) ** .8 + .0008
            ps.append(mat(tube_rest(pts, rad, n=5, name='tooth', length=.1, origin=(i * .3, 0, 0), squash=.75), M['tooth']))
        return ps

    rings = [(.03, .193, 19, .068, 1, .017), (.105, .158, 14, .058, -1, .015), (.18, .118, 10, .05, 1, .013)]
    for k, (y, r, count, length, direction, br) in enumerate(rings):
        made.append((f'extra_{first_ring + k}', name, (0, y, 0), ring_teeth(y, r, count, length, direction, br), [],
                     f'tooth ring {k + 1} of 3 in the worm mouth ({count} hooked teeth, {"outer" if k == 0 else "middle" if k == 1 else "inner"}). Spin it about its own z; turn neighbouring rings opposite ways'))
    # the second mouth: a stalk that can be pushed up the throat
    y0, y1 = .335, .215
    sp = [(y0, .03), (.3, .034), (.25, .04), (y1 + .01, .056), (y1 - .012, .06), (y1 - .02, .05), (y1 - .012, .038), (y1 + .02, .03), (y1 + .06, .012), (y1 + .07, .001)]
    stalk = fix_normals(revolve(sp, n=28, name='stalk', mod=lambda i, a: (0, (.006 * np.cos(a * 7) if 2 < i < 6 else 0))))
    stamp_rest(stalk)
    ps = [mat(stalk, M['mouth'])]
    for i in range(7):
        a = i / 7 * math.tau
        rho = np.array([math.cos(a), 0, math.sin(a)])
        b = np.array([math.cos(a) * .044, y1 - .012, math.sin(a) * .044])
        pts = [b, b - rho * .014 + (0, -.014, 0), b - rho * .034 + (0, -.02, 0)]
        ps.append(mat(tube_rest(pts, [.008, .0055, .0006], n=5, name='tooth', length=.1, origin=(9 + i * .3, 0, 0)), M['tooth']))
    made.append((f'extra_{first_ring + 3}', name, (0, y0, 0), ps, [],
                 'the second, smaller mouth deep in the throat. Slide it toward +z (out of the mouth, up to 0.22 m) and spin it'))
    for nm, par, piv, ps, gl, note in made:
        for p in ps + gl:
            stamp_rest(p); xform(p, Tm)
        rig.add(nm, par, pt(Tm, piv), ps, gl, note)
    return Tm
