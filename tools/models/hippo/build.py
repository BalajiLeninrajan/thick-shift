# Big Biggs, the purple hippo.
#
#   tools/models/bl tools/models/hippo/build.py               all three rot stages
#   tools/models/bl tools/models/hippo/build.py -- 2          one stage
#   tools/models/bl tools/models/hippo/build.py -- 1 2 quick sq face
#
# `quick` paints a 1024 px atlas, for iterating. Further words pick previews:
# sf sq ss sb (studio light: front, three quarter, side, back), df dl (the
# flashlight in the dark: front, low), face and sface (close on the face).
# With none named, all of them are rendered.
#
# Writes packages/game/public/models/hippo_<stage>.glb. meta.py writes hippo.json
# afterwards. look.py renders other previews and a posed check.
#
# Coordinates are Blender's: +x is the model's left, the front is -y, z is up,
# metres. The 2D source was COSTUME.hippo, HEAD.hippo and GORE.hippo in
# public/src/render/mascot.js, since removed (git log -- that path). The proportions follow it, with the hips pushed
# out to the limit of the doorway, because the hips are the joke. Stage 2 is
# the exception: the owner asked for wasted, bony hips there, so it reads as
# starved rather than comic.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
STAGES = [int(a) for a in ARGS if a.isdigit()] or [0, 1, 2]
QUICK = 'quick' in ARGS
SHOTS = [a for a in ARGS if a in ('sf', 'sq', 'ss', 'sb', 'df', 'dl', 'face', 'sface')] or ['sf', 'sq', 'ss', 'sb', 'df', 'dl', 'face', 'sface']

# Palette, from packages/game/src/config.js. Fur dulls with each stage as it does in 2D.
SURFACE0 = hexc('#313244')
STAGE = KEY = FUR_COL = BELLY_COL = HEAD_R = HEAD_T = None     # set per stage by begin()


def begin(stage):
    global STAGE, KEY, FUR_COL, BELLY_COL, HEAD_R, HEAD_T
    STAGE, KEY = stage, f'hippo_{stage}'
    FUR_COL = mixc(hexc('#9a7fc4'), SURFACE0, [.02, .18, .3][stage])
    BELLY_COL = mixc(hexc('#e6c8ee'), SURFACE0, [.0, .15, .3][stage])
    # Stage 1 wears the costume head on a neck: it hangs forward and lolls to one side.
    HEAD_R = rotm((9, 7, -5)) if stage == 1 else np.eye(3)
    HEAD_T = V(0, -.10, .18) if stage == 1 else V(0, 0, 0)
    fresh()


YELLOW, PINK, ROSE, RED = hexc('#f9e2af'), hexc('#f5c2e7'), hexc('#f5e0dc'), hexc('#f38ba8')
BONE_COL = mixc(ROSE, YELLOW, .35)
PALE = mixc(hexc('#cdd6f4'), ROSE, .5)
INK = np.array([.03, .03, .045], dtype=np.float32)
BLOOD_DRY = np.array([.2, .03, .035], dtype=np.float32)
BLOOD_WET = np.array([.45, .025, .035], dtype=np.float32)
# Stage 2's blood is old: dried brown-black. Saturated red on it read as cartoon trim.
DRIED = np.array([.075, .04, .03], dtype=np.float32)
SKIN_COL = np.array([.47, .40, .44], dtype=np.float32)      # what is under the fur: grey, a little violet
V = lambda *a: np.array(a, dtype=np.float64)
F = lambda *a: np.array(a, dtype=np.float32)


def rotm(deg):
    return np.array(Euler([math.radians(a) for a in deg]).to_matrix(), dtype=np.float64)


# ------------------------------------------------------------ the costume head
# Stages 0 and 1 share it. It is modelled where stage 0 wears it; stage 1
# moves it onto a neck with HEAD_R and HEAD_T. The painter lays the face out
# in the same stage 0 coordinates ("head space").

HEAD_PIVOT = V(0, 0, 1.62)
JAW_PIVOT = V(0, -.05, 1.66)
EYES = {'L': V(.225, -.455, 2.04), 'R': V(-.225, -.455, 2.04)}
EYE_R = .105


def wp(p):
    """A head space point in the world."""
    return HEAD_R @ (np.asarray(p, dtype=np.float64) - HEAD_PIVOT) + HEAD_PIVOT + HEAD_T


def pose_head(objs):
    M = Matrix.Translation(Vector(HEAD_PIVOT + HEAD_T)) @ Matrix(HEAD_R.tolist()).to_4x4() @ Matrix.Translation(-Vector(HEAD_PIVOT))
    for o in objs: o.data.transform(M); o.data.update()


def lip_top(x, w):      # the upper lip line: corners turn up, so it smiles
    return 1.70 + .07 * (x / w) ** 2


def lip_bottom(x, w, drop):   # the lower lip line, where the jaw's top is cut
    return 1.70 - drop + (drop + .03) * (x / w) ** 2


def costume_head(off):
    """off = stage 1: the same head after something moved into it."""
    w = .44 if off else .34          # half width of the mouth. Stage 1 smiles too far.
    drop = .16 if off else .115
    dome = [ell((0, -.05, 1.93), (.58, .52, .42), seg=32),
            ell((0, -.42, 1.83), (.47, .30, .18), seg=32),                    # upper muzzle
            ell((.15, -.585, 1.935), (.085, .085, .06)), ell((-.15, -.585, 1.935), (.085, .085, .06)),   # nostril mounds
            ell((.44, .02, 2.26), (.13, .075, .13), (0, 20, 0)), ell((-.44, .02, 2.26), (.13, .075, .13), (0, -20, 0)),   # ears
            ell((.36, -.33, 1.86), (.2, .2, .17)), ell((-.36, -.33, 1.86), (.2, .2, .17))]              # cheeks
    head = fuse(dome, .013, 5, HFUR, 'head')
    for sx in (1, -1):
        dent(head, (sx * .15, -.66, 1.955), (.04, .06, .035), .05, (0, .8, -.6))       # nostrils
        dent(head, (sx * .45, -.06, 2.27), (.07, .05, .07), .035, (0, 1, 0))           # ear hollows
    if off:
        shag(head, .022, 6, 5, mask=lambda P: sstep(-.3, -.1, P[:, 1]) * .85 + .15)   # matted, least on the face
    else:
        shag(head, .006, 4, 5, stretch=1)
    decimate(head, 13000)

    jaw = fuse([ell((0, -.36, 1.64), (.47 if off else .42, .29, .15), seg=32)], .012, 3, JFUR, 'jaw')
    P = co(jaw)
    # Cut the top of the jaw down to the lower lip line at the front. The corners stay high and tuck into the cheeks.
    front = sstep(-.3, -.42, P[:, 1])
    cutz = lip_bottom(np.clip(P[:, 0], -w, w), w, drop)
    P[:, 2] = np.where(P[:, 2] > cutz, P[:, 2] + (cutz - P[:, 2]) * front, P[:, 2])
    setco(jaw, P)
    decimate(jaw, 2400)

    upper, lower = [], []
    if not off:
        # two square buck teeth, felt over card, hanging from the lip
        for sx in (1, -1):
            upper.append(box((sx * .06, -.648, 1.652), (.105, .04, .135), (6, 0, sx * -3), TOOTH))
    else:
        # The buck teeth are gone. Two rows of flat teeth the size of a person's, far too many of them.
        rng = np.random.default_rng(7)
        n = 15
        for i in range(n):
            x = (i - (n - 1) / 2) / ((n - 1) / 2) * (w - .05)
            y = -.42 - .30 * math.sqrt(max(.05, 1 - (x / .47) ** 2)) * .92 + .012
            hgt = .08 * (.8 + rng.random() * .35)
            turn = -math.degrees(math.atan2(x, .45)) * .9
            upper.append(box((x, y, lip_top(x, w) - .02 - hgt * .35), (.05, .028, hgt), (4 + rng.random() * 8, 0, turn + (rng.random() - .5) * 8), TOOTH))
        n = 13
        for i in range(n):
            x = (i - (n - 1) / 2) / ((n - 1) / 2) * (w - .1)
            y = -.36 - .29 * math.sqrt(max(.05, 1 - (x / .47) ** 2)) + .04
            hgt = .065 * (.75 + rng.random() * .4)
            turn = -math.degrees(math.atan2(x, .45)) * .9
            lower.append(box((x, y, lip_bottom(x, w, drop) + hgt * .2), (.048, .026, hgt), (-6 - rng.random() * 8, 0, turn + (rng.random() - .5) * 10), TOOTH))
    return head, jaw, upper, lower, party_hat(off), w, drop


def party_hat(bent):
    """A card cone with a pom and a tinsel brim. Stage 1 has had it sat on."""
    if not bent:
        path, rad = [(0, -.05, 2.29), (.01, -.06, 2.45), (.02, -.07, 2.595)], [.2, .105, .012]
    else:
        path, rad = [(0, -.05, 2.29), (.02, -.05, 2.39), (.11, -.07, 2.465), (.25, -.10, 2.45)], [.2, .12, .065, .012]
    cone = tube(path, rad, seg=18, sub=5, cls=HAT, flat=((.3, 1, 0), .75) if bent else None)
    tip = V(*path[-1])
    pom = ell(tip + (V(.02, -.01, -.02) if bent else V(0, 0, .03)), .052, seg=14, cls=POM)
    shag(pom, .012, 40, 3, stretch=1, droop=0)
    ring = [(math.cos(a) * .195, -.05 + math.sin(a) * .195, 2.315 - .012 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 15)]
    frill = tube(ring, .024, seg=7, sub=3, cls=POM, caps=False)
    shag(frill, .012, 45, 4, stretch=1, droop=0)
    return join([cone, pom, frill], 'hat')


def pupil_dir(side, off):
    if not off:
        d = V(-.12, -1, -.05) if side == 'L' else V(.16, -1, .1)     # a little cross-eyed, like every googly eye
    else:
        d = V(.5, -1, -.55) if side == 'L' else V(.08, -1, .28)       # they no longer agree
    return d / np.linalg.norm(d)


def eye(side, off):
    """A plastic ball in head space. The game turns it, so the pupil is
    painted on a sphere. The catchlight is `eye_glow`: two points in the dark."""
    c = EYES[side].copy()
    r = EYE_R
    if off and side == 'L':
        r = .122                      # stage 1: this one has swollen and slipped down
        c = c + V(.015, -.012, -.04)
    ball = ell(c, r, seg=20, cls=EYE)
    d = pupil_dir(side, off)
    g = ell(c + d * r * .97 + V(.016, 0, .02), (.014, .008, .014), seg=8, cls=GLOW)
    return join([ball, g], 'eye_' + side), c, r


ARM0_EL = V(.68, -.045, 1.395)     # the stage 0 elbow, for x = +1
KNEE_Z = .38       # the costume knee: right at the hem of the hips, so the shin is nearly all the leg that shows


def costume_legs(dirty):
    """Thigh (leg_*) and shin with the foot (shin_*). Both ends at the knee are
    round, so the shin turns over the end of the thigh like a ball in a cup."""
    legs, shins = {}, {}
    for side, sx in (('L', 1), ('R', -1)):
        kn = (sx * .515, .045, KNEE_Z)
        th = fuse([tube([(sx * .50, .05, .66), kn], [.30, .288], seg=18)], .014, 4, FUR, 'leg')
        sh = fuse([tube([kn, (sx * .53, .02, .15)], [.286, .275], seg=18), ell((sx * .54, -.14, .115), (.29, .40, .13))], .014, 4, FUR, 'shin')
        floor_clip(sh)
        for o, s in ((th, 8), (sh, 9)):
            shag(o, .018 if dirty else .006, 5 if dirty else 4, s, stretch=3 if dirty else 1, droop=.3 if dirty else 0)
        floor_clip(sh)
        decimate(th, 1300)
        decimate(sh, 2300)
        toes = [ell((sx * .54 + dx, -.50 + abs(dx) * .22, .085), (.07, .05, .065), cls=NAIL, seg=12) for dx in (-.17, 0, .17)]
        legs[side] = join([th] + ([tufts(th, 30, .06, .014, 15, droop=.7)] if dirty else []), 'leg_' + side)
        shins[side] = join([sh] + toes + ([tufts(sh, 80, .06, .014, 16, droop=.7, where=lambda P, N: (P[:, 2] > .2).astype(float))] if dirty else []), 'shin_' + side)
    return legs, shins


def rear(z, sag=0.0):
    """The hips and the rear: the one part nobody slimmed down. 2.1 m across
    and under a metre tall, so it reads as a shelf, not a balloon."""
    return [ell((0, .10, z), (1.06, .68, .47), seg=40),
            ell((.47, .55, z - .05 - sag), (.5, .5, .47 + sag), seg=32), ell((-.47, .55, z - .05 - sag), (.5, .5, .47 + sag), seg=32)]


# ------------------------------------------------------------ stage 0: the costume as built

def stage0():
    S = dict(stage=0)
    body = fuse(rear(.78) + [ell((0, -.16, 1.07), (.60, .48, .48), seg=32),                        # belly
                             ell((0, -.02, 1.40), (.48, .40, .40), seg=32),                        # chest
                             ell((.40, 0, 1.56), (.19, .2, .17)), ell((-.40, 0, 1.56), (.19, .2, .17))], .017, 5, FUR, 'body')
    shag(body, .008, 3.2, 1, stretch=1, droop=0)      # stuffing lumps, not fur: the pile is in the normal map
    decimate(body, 15000)
    body = join([body, zipper(body, 1.70, 1.02), tufts(body, 300, .028, .01, 3, droop=.3)], 'body')

    arms, fore = {}, {}
    for side, sx in (('L', 1), ('R', -1)):
        # Upper arm and forearm with the mitten, split at a round elbow (see costume_legs).
        a = fuse([tube([(sx * .50, 0, 1.56), ARM0_EL * V(sx, 1, 1)], [.19, .174], seg=16)], .013, 4, FUR, 'arm')
        f = fuse([tube([ARM0_EL * V(sx, 1, 1), (sx * .76, -.09, 1.29), (sx * .80, -.12, 1.19)], [.172, .165, .155], seg=16),
                  ell((sx * .82, -.17, 1.06), (.165, .155, .18)), ell((sx * .73, -.29, 1.08), (.065, .075, .095), (20, 0, 0))], .013, 4, FUR, 'fore')
        for o, s in ((a, 7), (f, 8)): shag(o, .006, 4, s, stretch=1, droop=0)
        decimate(a, 1300)
        decimate(f, 2500)
        arms[side] = join([a, tufts(a, 30, .03, .011, 5, droop=.3)], 'arm_' + side)
        fore[side] = join([f, tufts(f, 45, .03, .011, 6, droop=.3)], 'forearm_' + side)
    legs, shins = costume_legs(False)

    head, jaw, upper, lower, hat, w, drop = costume_head(False)
    head = join([head, hat] + upper + [tufts(head, 120, .03, .01, 9, droop=.2, cls=HFUR, where=lambda P, N: (P[:, 1] > -.2).astype(float))], 'head')
    eyes = {s: eye(s, False) for s in 'LR'}
    S.update(mouth_w=w, mouth_drop=drop, eyes=[(eyes[s][1], eyes[s][2], pupil_dir(s, False), .5) for s in 'LR'])

    objs = [body, head, jaw, eyes['L'][0], eyes['R'][0]] + [d[s] for d in (arms, fore, legs, shins) for s in 'LR']
    finish(objs, S, dense=[(head, 1.5), (jaw, 1.5), (eyes['L'][0], 2), (eyes['R'][0], 2)])

    root = empty('root')
    part(body, 'body', root, (0, .05, .85))
    part(head, 'head', body, HEAD_PIVOT)
    part(jaw, 'jaw', head, JAW_PIVOT)
    for s in 'LR':
        sx = 1 if s == 'L' else -1
        part(eyes[s][0], 'eye_' + s, head, eyes[s][1])
        part(arms[s], 'arm_' + s, body, (sx * .48, 0, 1.56))
        part(fore[s], 'forearm_' + s, arms[s], ARM0_EL * V(sx, 1, 1))
        legs_part(body, legs, shins, s, sx)
    return root


def legs_part(body, legs, shins, s, sx):
    part(legs[s], 'leg_' + s, body, (sx * .50, .05, .64))
    part(shins[s], 'shin_' + s, legs[s], (sx * .515, .045, KNEE_Z))


def zipper(body, z0, z1):
    """The zip a wearer gets in by: a raised tape down the spine with a pull."""
    zp = []
    for z in np.linspace(z0, z1, 40):
        hit, loc, nrm, _ = body.ray_cast(Vector((0, 2, z)), Vector((0, -1, 0)))
        zp.append(V(*loc) + V(*nrm) * .004)
    tape = tube(zp, .017, seg=6, sub=1, cls=ZIP, flat=((0, 1, 0), .45))
    pull = join([box(zp[0] + V(0, .012, -.03), (.022, .008, .06), (10, 0, 0), ZIP), ell(zp[0] + V(0, .016, -.075), (.016, .006, .02), cls=ZIP, seg=8)])
    return join([tape, pull])


# ------------------------------------------------------------ stage 1: off

def stage1():
    S = dict(stage=1, belly_c=(0, -.58, 1.0), belly_r=(.42, .5, .46),
             stains=[((.03, -.5, 1.36), (.17, .22, .13), 1, .5)])     # the first bloodstain, under the chin
    # The same suit, but the thing inside no longer fills it the same way: the chest has dropped and
    # tipped forward, a hump has come up behind the shoulders, and the head rides on a neck.
    body = fuse(rear(.78, .03) + [ell((0, -.16, 1.0), (.62, .46, .44), seg=32),
                                  ell((0, -.12, 1.27), (.50, .40, .34), (-12, 0, 0), seg=32),
                                  ell((0, .14, 1.36), (.40, .28, .24)),
                                  ell((.42, -.14, 1.40), (.2, .2, .16)), ell((-.42, -.14, 1.40), (.2, .2, .16))], .017, 5, FUR, 'body')
    shag(body, .03, 5, 1, droop=.5)
    decimate(body, 14000)
    body = join([body, zipper(body, 1.52, 1.0), tufts(body, 640, .075, .016, 3, droop=.75)], 'body')

    neck = fuse([tube([(0, -.10, 1.40), (0, -.17, 1.62), (0, -.22, 1.86)], [.2, .15, .15], seg=14)], .012, 3, SKIN, 'neck')
    decimate(neck, 1200)
    neck = join([neck, tufts(neck, 90, .07, .014, 21, droop=.8)], 'neck')

    arms, fore = {}, {}
    for side, sx in (('L', 1), ('R', -1)):
        a = fuse([tube([(sx * .50, -.12, 1.40), (sx * .72, -.10, 1.20), (sx * .86, -.06, 1.00)], [.18, .15, .135], seg=14)], .013, 4, FUR, 'arm')
        shag(a, .02, 6, 7, droop=.4)
        decimate(a, 2000)
        arms[side] = join([a, tufts(a, 90, .07, .014, 5, droop=.8)], 'arm_' + side)
        # The forearm is too long for the sleeve. The mitten has split, and what was in it hangs out.
        f = fuse([tube([(sx * .86, -.06, 1.00), (sx * .90, -.14, .80), (sx * .90, -.22, .62)], [.14, .12, .115], seg=14),
                  ell((sx * .90, -.27, .47), (.15, .14, .2)), ell((sx * .80, -.37, .5), (.06, .07, .09), (20, 0, 0))], .012, 4, FUR, 'fore')
        shag(f, .018, 6, 8, droop=.4)
        decimate(f, 2600)
        rng = np.random.default_rng(31 + sx)
        fingers = []
        for k in range(3):
            x = sx * .90 + (k - 1) * .05
            p = [(x, -.29, .36), (x + (rng.random() - .5) * .03, -.31, .24), (x + (rng.random() - .5) * .04, -.335 - rng.random() * .03, .11 + rng.random() * .05)]
            fingers.append(tube(p, [.02, .016, .008], seg=6, sub=3, cls=SKIN))
        fore[side] = join([f, tufts(f, 80, .06, .013, 6, droop=.8)] + fingers, 'forearm_' + side)
    legs, shins = costume_legs(True)

    head, jaw, upper, lower, hat, w, drop = costume_head(True)
    head = join([head, hat] + upper + [tufts(head, 260, .06, .013, 9, droop=.6, cls=HFUR, where=lambda P, N: (P[:, 1] > -.3).astype(float))], 'head')
    jaw = join([jaw] + lower, 'jaw')
    eyes = {s: eye(s, True) for s in 'LR'}
    # black strands hang out over the lower lip
    rng = np.random.default_rng(4)
    locks = []
    for i in range(7):
        x = (i - 3) * .055 + (rng.random() - .5) * .03
        top = V(x, -.56, lip_bottom(x, w, drop) + .01)
        lipz = lip_bottom(x, w, drop) + .008
        L = .22 + rng.random() * .34
        pts = [top, V(x, -.645, lipz + .012), V(x + (rng.random() - .5) * .02, -.668, lipz - .06), V(x + (rng.random() - .5) * .04, -.672, lipz - L)]
        locks.append(tube(pts, [.008, .008, .007, .002], seg=4, sub=3, cls=STRAND, caps=False))
    sway = join(locks, 'sway_1')
    pose_head([head, jaw, eyes['L'][0], eyes['R'][0], sway])
    S.update(mouth_w=w, mouth_drop=drop, eyes=[(wp(eyes[s][1]), eyes[s][2], HEAD_R @ pupil_dir(s, True), .72 if s == 'L' else .24) for s in 'LR'])

    objs = [body, neck, head, jaw, sway, eyes['L'][0], eyes['R'][0]] + [d[s] for d in (arms, fore, legs, shins) for s in 'LR']
    finish(objs, S, dense=[(head, 1.5), (jaw, 1.5), (eyes['L'][0], 2), (eyes['R'][0], 2)])

    root = empty('root')
    part(body, 'body', root, (0, .05, .85))
    part(neck, 'neck', body, (0, -.10, 1.44))
    part(head, 'head', neck, HEAD_PIVOT + HEAD_T)
    part(jaw, 'jaw', head, wp(JAW_PIVOT))
    part(sway, 'sway_1', jaw, wp((0, -.645, 1.56)))
    for s in 'LR':
        sx = 1 if s == 'L' else -1
        part(eyes[s][0], 'eye_' + s, head, wp(eyes[s][1]))
        part(arms[s], 'arm_' + s, body, (sx * .50, -.12, 1.40))
        part(fore[s], 'forearm_' + s, arms[s], (sx * .86, -.06, 1.00))
        legs_part(body, legs, shins, s, sx)
    return root


# ------------------------------------------------------------ stage 2: what is underneath

HOLE_C, HOLE_R = V(0, -.98, 2.07), V(.2, .30, .30)        # the mouth: a tall hole in the front of the head
WOUND_C, WOUND_R = V(0, -.52, 1.45), V(.19, .17, .29)     # the chest, torn open
# The eyes are what is left of the costume's, and worse: big pale balls bulging out of the dome, with no
# lids. L has swollen and slipped down with its pupil blown; R is smaller, higher, with a pinprick pupil.
EYES2 = {'L': V(.29, -.915, 2.525), 'R': V(-.265, -.915, 2.6)}
EYE2_R = {'L': .148, 'R': .115}
EYE2_PUPIL = {'L': .64, 'R': .085}         # sine of the pupil's angular radius, as in paint_eye


def pupil_dir2(side):
    d = V(.3, -1, -.1) if side == 'L' else V(-.02, -1, -.16)     # L drifts out; R stares down at whoever is at its feet
    return d / np.linalg.norm(d)


def near_eyes2(P, k):
    """1 farther than k eye radii from both stage 2 eyes, 0 inside: keeps fur off them."""
    e = np.min([np.linalg.norm(np.asarray(P, dtype=np.float32) - F(*EYES2[s]), axis=1) / EYE2_R[s] for s in 'LR'], axis=0)
    return (e > k).astype(np.float32)
MASK_C = V(0, -.865, 1.99)                                # the small face that lives in the hole
RIB_C, RIB_R, RIB_TILT = V(0, -.18, 1.62), V(.38, .33, .46), -14
# The hips have wasted to bone: no wider than the shoulders. Two hip bones jut at the sides and the
# tailbone at the back; the fur hangs off them in mats. Every other stage keeps the big rear.
HIPBONES = [V(.38, -.04, 1.0), V(-.38, -.04, 1.0), V(0, .35, .99)]
HIP_Z = .84


def bony(P):
    """1 on the hip bones and tailbone, where the skin is stretched bare."""
    return np.max([ellmask(np.asarray(P, dtype=np.float32), c, (.13, .13, .11), .35) for c in HIPBONES], axis=0)


def stage2():
    S = dict(stage=2, stains=[((0, -.46, 1.5), (.3, .2, .36), 4, .8), ((.74, -.2, .5), (.2, .22, .2), 2, .6), ((-.74, -.2, .5), (.2, .22, .2), 3, .6),
                              ((0, -.6, 1.05), (.3, .25, .2), 5, .7)])
    tilt = rotm((RIB_TILT, 0, 0))
    # Hunched and starved. The ribcage is a keel hung forward off a thin waist over a bony pelvis.
    pelvis = [ell((0, .06, HIP_Z), (.46, .34, .27), seg=32),
              ell((.19, .25, HIP_Z - .07), (.2, .15, .24)), ell((-.19, .25, HIP_Z - .07), (.2, .15, .24))]      # what is left of the rear: two hanging flaps
    pelvis += [ell(c, (.085, .15, .075), (-12, 0, 0)) if c[0] else ell(c, (.06, .07, .08)) for c in HIPBONES]     # crests run front to back, the tailbone is a knob
    shapes = pelvis + [tube([(0, .12, 1.12), (0, .02, 1.3), (0, -.08, 1.45)], [.3, .23, .22], seg=16),
                       ell(RIB_C, RIB_R, (RIB_TILT, 0, 0), seg=32),
                       ell((.40, -.22, 1.98), (.17, .16, .13)), ell((-.40, -.22, 1.98), (.17, .16, .13)),     # shoulder knobs
                       ell((0, -.02, 2.0), (.3, .2, .16), (20, 0, 0))]                                          # the hump
    ribs = []
    for i in range(6):   # rib ridges, each a thin disc a little wider than the chest at its height
        d = -.26 + i * .105
        k = math.sqrt(max(.05, 1 - (d / RIB_R[2]) ** 2))
        shapes.append(ell(RIB_C + tilt @ V(0, 0, d), (RIB_R[0] * k + .028, RIB_R[1] * k + .028, .026), (RIB_TILT, 0, 0)))
        ribs.append((RIB_C + tilt @ V(0, 0, d), tilt @ V(0, 0, 1)))
    S['ribs'] = ribs
    body = fuse(shapes, .016, 4, FUR, 'body')
    for z in np.linspace(1.28, 2.02, 9):   # the spine stands out all the way up the back
        hit, loc, nrm, _ = body.ray_cast(Vector((0, 3, z)), Vector((0, -1, 0)))
        dent(body, tuple(loc), (.05, .05, .04), .035, tuple(nrm))      # a knob, pushed out along the normal
    wound = ell(WOUND_C, WOUND_R, seg=24, cls=MEAT)
    shag(wound, .03, 14, 9, stretch=1, droop=0)      # a ragged edge, not a neat oval
    shag(body, .04, 4.5, 1, droop=.6, mask=lambda P: .35 + .65 * sstep(1.3, 1.0, P[:, 2]) * (1 - .8 * bony(P)))   # shaggiest on the hips, bare on the bones
    decimate(body, 13500)
    cut(body, wound)
    bones = []
    for i in range(5):   # ribs across the opening
        z = WOUND_C[2] - .2 + i * .1
        bones.append(tube([(-.21, -.34, z + .03), (-.1, -.44, z), (0, -.465, z - .012), (.1, -.44, z), (.21, -.34, z + .03)], .021, seg=6, sub=3, cls=BONE))
    flaps = tufts(body, 60, .09, .03, 17, droop=.7, cls=FLESH, where=lambda P, N: ellmask(P, WOUND_C, WOUND_R * 1.25, .05) * (P[:, 1] < -.3))
    hipfur = tufts(body, 380, .24, .026, 3, droop=.92, segs=3, where=lambda P, N: (.25 + .75 * sstep(1.4, 1.0, P[:, 2])) * (1 - bony(P)))   # mats hanging off the hips
    body = join([body, hipfur, flaps] + bones, 'body')

    # guts: three loops out of the bottom of the wound, down to the knees
    rng = np.random.default_rng(6); guts = []
    top = V(0, -.47, 1.27)
    for i, (sx, drop_) in enumerate(((1, .78), (-1, .62), (1, .5))):
        wdt = .09 + rng.random() * .08; x0 = (i - 1) * .05
        pts = [top + V(x0, .05, .06), top + V(x0, -.02, -.02), top + V(x0 + sx * wdt * 1.3, -.05, -drop_ * .4), top + V(x0 + sx * wdt, -.07, -drop_ * .85),
               top + V(x0 - sx * .03, -.08, -drop_), top + V(x0 - sx * wdt * .8, -.06, -drop_ * .6), top + V(x0 - sx * .02, -.02, -drop_ * .15), top + V(x0 - sx * .03, .05, .05)]
        rad = [.04, .042, .046, .05, .048, .044, .04, .038]
        g = tube(pts, rad, seg=8, sub=5, cls=GUT)
        shag(g, .006, 30, 40 + i, stretch=1, droop=0)
        guts.append(g)

    neck = fuse([tube([(0, -.26, 1.96), (0, -.38, 2.1), (0, -.50, 2.24)], [.15, .12, .13], seg=12)], .012, 3, SKIN, 'neck')
    decimate(neck, 900)
    neck = join([neck, tufts(neck, 110, .12, .018, 21, droop=.85)], 'neck')

    arms, fore, legs, shins = {}, {}, {}, {}
    for side, sx in (('L', 1), ('R', -1)):
        sh, el, wr = V(sx * .50, -.22, 1.98), V(sx * .98, -.14, 1.20), V(sx * 1.04, -.40, .42)
        a = fuse([tube([sh, (sh + el) / 2 + V(sx * .03, 0, .02), el], [.12, .085, .07], seg=12), ell(el, (.085, .085, .085))], .011, 3, FUR, 'arm')
        shag(a, .02, 8, 7, droop=.5)
        decimate(a, 1500)
        arms[side] = join([a, tufts(a, 90, .13, .016, 5, droop=.9)], 'arm_' + side)
        # forearm and a hand with four long fingers that reach the floor
        hand = [tube([el, (el + wr) / 2 + V(0, -.03, 0), wr], [.075, .06, .05], seg=10, cls=SKIN), ell(wr + V(0, -.02, -.07), (.075, .045, .1), cls=SKIN)]
        for k in range(4):
            u = (k - 1.5)
            b = wr + V(sx * u * .034, -.03, -.14)
            m = b + V(sx * u * .03, -.05, -.15 + abs(u) * .012)
            t = V(m[0] + sx * u * .012, m[1] - .07, .022)
            hand.append(tube([b, m, t], [.026, .021, .01], seg=6, sub=3, cls=SKIN))
        f = fuse(hand, .008, 2, SKIN, 'fore')
        decimate(f, 2600)
        claws = [tube([(f_[0], f_[1], .025), (f_[0], f_[1] - .05, .012)], [.011, .003], seg=5, sub=1, cls=NAIL) for f_ in
                 [(wr[0] + sx * (k - 1.5) * .076, wr[1] - .15) for k in range(4)]]
        fore[side] = join([f, tufts(f, 80, .12, .014, 6, droop=.9, cls=FUR, where=lambda P, N: sstep(.6, .8, P[:, 2]))] + claws, 'forearm_' + side)

        hp, kn, an = V(sx * .40, 0, .74), V(sx * .80, -.24, .40), V(sx * .68, -.06, .08)
        l = fuse([tube([hp, (hp + kn) / 2, kn], [.17, .13, .1], seg=12), ell(kn, (.1, .1, .1))], .011, 3, FUR, 'leg')
        shag(l, .02, 8, 9, droop=.5)
        decimate(l, 1400)
        legs[side] = join([l, tufts(l, 80, .12, .016, 11, droop=.9)], 'leg_' + side)
        foot = [tube([kn, (kn + an) / 2 + V(0, .03, 0), an], [.085, .06, .05], seg=10, cls=SKIN), ell(an + V(0, -.1, -.03), (.085, .17, .05), cls=SKIN)]
        for k in (-1, 0, 1):
            foot.append(tube([an + V(k * .05, -.2, -.035), an + V(k * .085, -.36, -.055)], [.03, .012], seg=6, sub=1, cls=SKIN))
        s = fuse(foot, .009, 2, SKIN, 'shin')
        floor_clip(s)
        decimate(s, 1800)
        shins[side] = join([s, tufts(s, 40, .1, .013, 12, droop=.9, cls=FUR, where=lambda P, N: sstep(.15, .3, P[:, 2]))], 'shin_' + side)

    # The head: a shaggy dome with a hole in it. The lower rim of the hole is the jaw.
    hole = ell(HOLE_C, HOLE_R, seg=28, cls=DARK)
    dome = fuse([ell((0, -.56, 2.42), (.60, .50, .42), seg=32), ell((0, -.70, 2.14), (.34, .33, .34), seg=24),
                 ell((.47, -.5, 2.74), (.13, .075, .13), (0, 25, 0)), ell((-.47, -.5, 2.74), (.13, .075, .13), (0, -25, 0))], .013, 5, HFUR, 'head')
    for s in 'LR':   # shallow sockets the balls bulge out of
        c, r = EYES2[s], EYE2_R[s]
        dent(dome, c + V(0, -.04, 0), (r * 1.3, r * 1.1, r * 1.25), .05, (0, 1, .1))
    shag(dome, .035, 6, 5, droop=.6)
    decimate(dome, 8500)
    cut(dome, hole, keep=True)
    jaw = fuse([ell((0, -.70, 1.97), (.31, .31, .25), seg=24)], .012, 3, JFUR, 'jaw')
    shag(jaw, .03, 7, 6, droop=.6)
    decimate(jaw, 2000)
    cut(jaw, hole)
    rng = np.random.default_rng(8)
    teeth = []
    for i in range(7):   # a row of flat teeth along the top of the hole
        x = (i - 3) * .05
        zt = HOLE_C[2] + HOLE_R[2] * math.sqrt(1 - (x / HOLE_R[0]) ** 2 * .8) - .02
        hgt = .085 * (.8 + rng.random() * .35)
        teeth.append(box((x, -1.01 + abs(x) * .25, zt - hgt * .4), (.046, .028, hgt), (rng.random() * 8, 0, (rng.random() - .5) * 10 - x * 80), TOOTH))
    hat = tube([(-.1, -.56, 2.76), (-.04, -.56, 2.9), (.08, -.58, 3.0), (.26, -.62, 3.02)], [.2, .14, .075, .012], seg=14, sub=4, cls=HAT, flat=((.2, 1, .1), .6))
    shag(hat, .03, 9, 14, stretch=1, droop=0)      # crumpled card
    fringe = tufts(dome, 330, .3, .034, 9, droop=.95, cls=HFUR, segs=3, jitter=.2,
                   where=lambda P, N: sstep(2.5, 2.3, P[:, 2]) * (np.linalg.norm((P - F(*HOLE_C)) / F(*HOLE_R), axis=1) > 1.15) * near_eyes2(P, 1.5))
    crown = tufts(dome, 250, .12, .02, 10, droop=.7, cls=HFUR,
                  where=lambda P, N: (np.linalg.norm((P - F(*HOLE_C)) / F(*HOLE_R), axis=1) > 1.2) * near_eyes2(P, 1.7))
    head = join([dome, hat, fringe, crown] + teeth, 'head')
    jaw = join([jaw, tufts(jaw, 110, .16, .028, 13, droop=.95, cls=JFUR, segs=3, where=lambda P, N: (np.linalg.norm((P - F(*HOLE_C)) / F(*HOLE_R), axis=1) > 1.15) * (.25 + .75 * sstep(.08, .2, np.abs(P[:, 0]))))], 'jaw')

    eyes = {}
    for s in 'LR':   # wet plastic balls; the catchlight sits up and to one side of the pupil, as a wet eye's does
        c, r, d = EYES2[s], EYE2_R[s], pupil_dir2(s)
        g = c + (d + V(.18, 0, .2)) / np.linalg.norm(d + V(.18, 0, .2)) * r * .985
        eyes[s] = (join([ell(c, r, seg=24, cls=EYE), ell(g, (.012, .006, .012), seg=8, cls=GLOW)], 'eye_' + s), c, r)
    S['eyes'] = [(eyes[s][1], eyes[s][2], pupil_dir2(s), EYE2_PUPIL[s]) for s in 'LR']

    # The mask: a small pale face on a stalk, deep in the mouth. The game bobs it and leans it out.
    m = fuse([ell(MASK_C, (.105, .055, .135), seg=28)], .006, 3, MASK, 'mask')
    P = co(m); P[:, 1] = np.minimum(P[:, 1], MASK_C[1] + .012); setco(m, P)      # flat at the back: it is a mask, not a head
    for sx in (1, -1):
        dent(m, MASK_C + V(sx * .037, -.05, .028), (.03, .04, .036), .03, (0, 1, 0))     # hollow sockets
    dent(m, MASK_C + V(0, -.055, -.065), (.04, .03, .012), .012, (0, 1, 0))               # the thin mouth
    decimate(m, 1500)
    stalk = tube([MASK_C + V(0, .25, .03), MASK_C + V(0, .12, .0), MASK_C + V(0, .0, 0)], [.05, .04, .045], seg=7, sub=3, cls=DARK)
    pins = [ell(MASK_C + V(sx * .037, -.027, .028), .0075, seg=8, cls=GLOW) for sx in (1, -1)]
    mask = join([m, stalk] + pins, 'extra_1')

    rng = np.random.default_rng(4); locks = []
    for i in range(17):   # long black strands and ropes of blood over the lower rim of the hole
        bloody = i % 3 == 2
        x = (rng.random() - .5) * .34
        zr = HOLE_C[2] - HOLE_R[2] * math.sqrt(max(.1, 1 - (x / HOLE_R[0]) ** 2)) + .03
        # short in the middle, long at the corners of the mouth, so the open chest shows between them
        L = ((.2 if bloody else .25) + rng.random() * (.25 if bloody else .3)) * (1 + 1.6 * min(1, abs(x) / .15) ** 2)
        pts = [V(x, -.9, zr + .02), V(x, -1.0, zr + .035), V(x + (rng.random() - .5) * .03, -1.035, zr - .08), V(x + (rng.random() - .5) * .06, -1.04, zr - L)]
        locks.append(tube(pts, [.009, .009, .008, .002], seg=4, sub=3, cls=BSTRAND if bloody else STRAND, caps=False))
    sway = join(locks, 'sway_1')

    objs = [body, neck, head, jaw, mask, sway] + guts + [eyes['L'][0], eyes['R'][0]] + [d[s] for d in (arms, fore, legs, shins) for s in 'LR']
    finish(objs, S, dense=[(head, 1.4), (jaw, 1.4), (mask, 3), (eyes['L'][0], 2), (eyes['R'][0], 2)])

    root = empty('root')
    part(body, 'body', root, (0, .08, .95))
    part(neck, 'neck', body, (0, -.27, 1.98))
    part(head, 'head', neck, (0, -.48, 2.22))
    part(jaw, 'jaw', head, (0, -.52, 2.08))
    part(mask, 'extra_1', head, MASK_C + V(0, .25, .03))
    part(sway, 'sway_1', jaw, (0, -1.0, 1.82))
    for i, g in enumerate(guts): part(g, f'sway_{i + 2}', body, (0, -.44, 1.30))
    for s in 'LR':
        sx = 1 if s == 'L' else -1
        part(eyes[s][0], 'eye_' + s, head, eyes[s][1])
        part(arms[s], 'arm_' + s, body, (sx * .50, -.22, 1.98))
        part(fore[s], 'forearm_' + s, arms[s], (sx * .98, -.14, 1.20))
        part(legs[s], 'leg_' + s, body, (sx * .40, 0, .74))
        part(shins[s], 'shin_' + s, legs[s], (sx * .80, -.24, .40))
    return root


# ------------------------------------------------------------ painting
# paint() is called with slices of the atlas. It hands each class of texel to
# its own function as a sub-Tex, so noise is only ever computed where it is used.

def headspace(P, N):
    R = HEAD_R.astype(np.float32)
    return ((P - F(*(HEAD_PIVOT + HEAD_T))) @ R) + F(*HEAD_PIVOT), N @ R


def seam(T, m, f, g, thread):
    """A stitched seam where the field f (metres) crosses zero, on the texels
    in m. g runs along the seam and spaces the stitches."""
    line = np.exp(-(f / .0035) ** 2) * m
    T.put(line * .8, col=T.col * .35)
    T.h -= line * .004
    T.h += np.exp(-((np.abs(f) - .012) / .008) ** 2) * m * .002          # the cloth puckers either side
    st = (np.abs(f) < .011) * (np.mod(g / .016, 1) < .38) * m
    T.put(st * .85, col=thread)
    T.h += st * .0015


def skin(T, m):
    """What is under the fur: cold grey skin, blotched, with dark veins."""
    P = T.P
    mott = fbm(P * 9, 3, 61); vein = np.exp(-((fbm(P * F(16, 16, 9), 3, 62) - .5) / .012) ** 2)
    col = SKIN_COL[None] * (.7 + .5 * mott)[:, None]
    col = col + (F(.3, .2, .34) - col) * (vein * .5)[:, None]
    T.put(m, col=col, rough=.5)
    T.h = np.where(m > .5, vnoise(P * 60, 63) * .0012 - vein * .0006, T.h)


def stain(T, c, r, seed, wet):
    """Soaked-in blood: a ragged blotch and the runs under it."""
    P = T.P; c = F(*c); r = F(*r)
    blot = ellmask(P, c, r, .4, .9, seed, 9)
    cols = vnoise(np.stack([P[:, 0] * 50, P[:, 1] * 50, np.full(len(P), seed, dtype=np.float32)], axis=1), seed + 1)
    under = (P[:, 2] < c[2]) * sstep(c[2] - r[2] * 3.5, c[2] - r[2] * .5, P[:, 2]) * (np.hypot((P[:, 0] - c[0]) / r[0], (P[:, 1] - c[1]) / r[1]) < .95)
    k = np.clip(blot + sstep(.62, .7, cols) * under, 0, 1)
    shade = fbm(P * 26, 2, seed + 2)
    if STAGE == 2:   # old and dried: only the darkest part of the blotch stays, and it is brown-black
        k = k * sstep(.4, .6, shade)
        T.put(k * .85, col=DRIED[None] * (.7 + .6 * shade)[:, None], rough=.6)
        T.h *= (1 - .6 * k)
        return
    col = BLOOD_DRY[None] * (.55 + .7 * shade)[:, None]
    fresh_ = sstep(.45, .9, blot * (.6 + shade)) * wet
    col = col + (BLOOD_WET - col) * fresh_[:, None]
    T.put(k * .93, col=col, rough=.6)
    T.rough -= k * fresh_ * .4
    T.h *= (1 - .6 * k)        # soaked fur lies flat


def paint_fur(T, S):
    """Everything covered in fur, and what the fur has on it: the costume's
    patches and seams, the face, wear, and at stage 2 the skin showing through."""
    P, N, cls = T.P, T.N, T.cls
    st, n = S['stage'], len(T.P)
    Q, QN = headspace(P, N)
    is_head = np.isin(cls, (HFUR, JFUR))
    body = cls == FUR

    base = np.tile(FUR_COL, (n, 1)).astype(np.float32)
    def patch(m, c): base[:] = base + (np.asarray(c, dtype=np.float32) - base) * np.asarray(m, dtype=np.float32)[:, None]
    if st < 2:
        belly_c = F(*S.get('belly_c', (0, -.62, 1.06))); belly_r = F(*S.get('belly_r', (.43, .5, .52)))
        belly_e = np.linalg.norm((P - belly_c) / belly_r, axis=1)
        patch(body * (P[:, 1] < -.1) * (belly_e < 1), BELLY_COL)
        muz_e = np.linalg.norm((Q - F(0, -.50, 1.775)) / F(.50, .30, .235), axis=1)
        patch(is_head * (muz_e < 1), BELLY_COL)
        for sx in (1, -1):
            patch(is_head * ellmask(Q, (sx * .45, -.09, 2.265), (.075, .06, .075), .2) * (QN[:, 1] < 0), mixc(BELLY_COL, PINK, .4))   # inner ear
            if st == 0: patch(is_head * ellmask(Q, (sx * .40, -.42, 1.90), (.1, .12, .075), .35) * .75, RED)                         # blush
    else:
        base *= (.75 + .5 * fbm(P * 2.2, 2, 3))[:, None]

    # The pile. Stage 0 is short clean plush; later stages are long, streaked and clumped.
    a, k, hs = [((150, 150, 80), .13, .0012), ((120, 120, 20), .4, .003), ((95, 95, 11), .5, .004)][st]
    s = np.clip((fbm(P * F(*a), 3, 11) - .5) * 2.4 + .5, 0, 1)
    cl = fbm(P * F(7, 7, 3), 3, 23)
    T.col = base * (1 - k + 2 * k * s)[:, None] * (1 + (.12 if st == 0 else .4) * (cl - .5))[:, None]
    T.col += (sstep(.72, .95, s) * .1)[:, None]                            # catchlights on the tips
    T.rough[:] = .95
    T.h = s * hs + (cl - .5) * (.004 if st else .001)

    if st < 2:
        thread = mixc(FUR_COL, ROSE, .5)
        seam(T, body * (P[:, 1] < -.1), (belly_e - 1) * .45, np.arctan2(P[:, 2] - belly_c[2], P[:, 0]) * .45, thread)
        seam(T, is_head.astype(np.float32), (muz_e - 1) * .3, np.arctan2(Q[:, 2] - 1.775, Q[:, 0]) * .4, thread)
        seam(T, (cls == HFUR) * (Q[:, 1] > -.2) * (Q[:, 2] > 1.9), Q[:, 0], Q[:, 1], thread)                 # over the crown
        # panel seams down the back, either side of the zip, spreading over the rear
        seam(T, body * (P[:, 1] > .1) * (P[:, 2] > .25), np.abs(P[:, 0]) - (.2 + .55 * sstep(1.6, .6, P[:, 2])), P[:, 2], thread)
        if st == 0:   # mitten cuffs
            seam(T, body * (np.abs(P[:, 0]) > .62) * (P[:, 2] > .95) * (P[:, 2] < 1.4) * (P[:, 1] < .12), P[:, 2] - 1.2 - (np.abs(P[:, 0]) - .8) * .5, P[:, 0] + P[:, 1], thread)

    if st == 1:
        # Bald patches where the pile has rubbed off to the backing cloth, and grime from the floor up.
        bald = sstep(.64, .69, fbm(P * 3.6, 3, 51)) * (1 - is_head * sstep(-.2, -.35, Q[:, 1]))
        weave = ((np.mod(P[:, 0] * 260, 1) < .5) ^ (np.mod(P[:, 2] * 260, 1) < .5)).astype(np.float32)
        T.put(bald, col=mixc(FUR_COL, (.5, .47, .4), .7)[None] * (.75 + .25 * weave)[:, None], rough=.85)
        T.h = np.where(bald > .5, weave * .0005 - .004, T.h)
        grime = np.clip(sstep(.55, .75, fbm(P * 2.5, 3, 52)) * .6 + sstep(.7, .0, P[:, 2]) * .5, 0, 1)
        T.put(grime * .6, col=T.col * .45)
    if st == 2:
        # Fur worn through to the skin in patches and over every bone.
        thin = sstep(.52, .62, fbm(P * 4.2, 3, 53)) * .8
        rib = np.zeros(n, dtype=np.float32)
        near = np.linalg.norm((P - F(*RIB_C)) / F(*(RIB_R * 1.25)), axis=1) < 1
        for c, nn in S['ribs']: rib = np.maximum(rib, np.exp(-(((P - F(*c)) @ F(*nn)) / .02) ** 2))
        spine = np.exp(-(P[:, 0] / .035) ** 2) * (N[:, 1] > .2) * (P[:, 2] > 1.25) * (P[:, 2] < 2.1)
        skin(T, np.clip(np.maximum(np.maximum(thin, bony(P)), np.maximum(rib * near, spine)), 0, 1) * body)
        # Old blood dried black in clots round the mouth: patches, never a ring, or it reads as an outline.
        hole_e = np.linalg.norm((P - F(*HOLE_C)) / F(*HOLE_R), axis=1)
        T.put(is_head * sstep(1.4, 1.05, hole_e) * sstep(.48, .62, fbm(P * 11, 3, 70)) * .9, col=DRIED, rough=.55)
        hf = (cls == HFUR).astype(np.float32)
        for c, r, d, frac in S['eyes']:
            # No lids: the fur has pulled back off the ball, and the bare skin round it is bruised dark and
            # wet in the crease. The edge is ragged so nothing reads as a drawn ring.
            e = np.linalg.norm(P - F(*c), axis=1) / r + (fbm(P * 18, 3, 66) - .5) * .9
            skin(T, hf * sstep(1.75, 1.45, e))
            T.put(hf * sstep(1.25, 1.02, e) * .8, col=F(.06, .045, .055), rough=.15)
        wound_e = np.linalg.norm((P - F(*WOUND_C)) / F(*WOUND_R), axis=1)
        T.put(body * sstep(1.45, 1.0, wound_e) * (P[:, 1] < -.2) * sstep(.45, .6, fbm(P * 10, 3, 69)), col=DRIED, rough=.55)

    if st < 2:
        # The costume face, in head space. The mouth is a slot: its roof, back wall and the cut top of
        # the jaw are the mesh panel a wearer would see out through.
        w, drop = S['mouth_w'], S['mouth_drop']
        xq = np.clip(Q[:, 0], -w, w)
        inside = (np.abs(Q[:, 0]) < w + .01) & (Q[:, 1] < -.2)
        roof = (cls == HFUR) & inside & (Q[:, 2] < lip_top(xq, w)) & (Q[:, 2] > 1.38)
        floor = (cls == JFUR) & (np.abs(Q[:, 0]) < w + .03) & (Q[:, 2] > lip_bottom(xq, w, drop) - .012) & (QN[:, 2] > .35) & (Q[:, 1] < -.3)
        mesh = (roof | floor).astype(np.float32)
        grid = ((np.mod(Q[:, 0] / .012, 1) < .3) | (np.mod((Q[:, 2] + Q[:, 1] * .6) / .012, 1) < .3)).astype(np.float32)
        T.put(mesh, col=F(.06, .06, .075)[None] * (.4 + 1.2 * grid)[:, None], rough=.7)
        T.h = np.where(mesh > 0, grid * .0012, T.h)
        if st == 1:   # the lips have gone dark and wet where the cloth is splitting
            lipd = np.minimum(np.abs(Q[:, 2] - lip_top(xq, w)), np.abs(Q[:, 2] - lip_bottom(xq, w, drop)))
            T.put(is_head * inside * (Q[:, 1] < -.45) * sstep(.035, .0, lipd) * .85, col=BLOOD_DRY * .8, rough=.4)
        for sx in (1, -1):   # nostrils
            T.put(is_head * ellmask(Q, (sx * .15, -.655, 1.95), (.034, .05, .03), .3), col=INK * 1.5, rough=.8)
        for c, r, d, frac in S['eyes']:   # a ring of black felt round each eye
            dq = np.linalg.norm(P - F(*c), axis=1)
            T.put((cls == HFUR) * sstep(r * 1.4, r * 1.3, dq), col=INK * 1.3, rough=.9)


def paint_eye(T, S):
    """Costume eyes: scratched white plastic, a black pupil."""
    P, st = T.P, S['stage']
    scr = (np.abs(vnoise(P * F(420, 60, 90), 5) - .5) < .012) | (np.abs(vnoise(P * F(70, 80, 500), 6) - .5) < .008)
    for c, r, d, frac in S['eyes']:
        v = P - F(*c); dist = np.linalg.norm(v, axis=1)
        mine = dist < r * 1.3
        cosang = (v @ F(*d)) / (dist + 1e-9)
        if st < 2:
            T.put(mine, col=mixc(ROSE, (1, 1, .98), .6) if st == 0 else mixc(ROSE, YELLOW, .6) * .9, rough=.12 if st == 0 else .3)
        else:         # pale and glossy as a peeled egg, the only clean thing left on it
            T.put(mine, col=mixc(PALE, (1, .98, .92), .5) * (.9 + .12 * fbm(P * 25, 2, 82))[:, None], rough=.04)
        T.put(mine * scr * (.5 if st < 2 else .25), col=(.55, .55, .6), rough=.6)
        if st == 1:   # yellowed, with a brown tide mark creeping in from the rim
            T.put(mine * sstep(.6, .0, cosang) * np.clip(fbm(P * 40, 3, 8) * 1.5, 0, 1), col=(.42, .26, .14), rough=.5)
        ca = math.cos(math.asin(frac))
        if st == 2:
            # Thin dark veins creep in from where the ball meets the head, fading before the pupil.
            vein = np.exp(-((fbm(P * 55, 3, 83) - .5) / .022) ** 2) * sstep(.8, .15, cosang)
            T.put(mine * vein * .85, col=(.16, .08, .09), rough=.1)
            # a grey iris round the pupil, so it reads as a real eye staring, not a painted dot
            # (narrow round the blown pupil, wide and clouded round the pinprick).
            ci = math.cos(math.asin(frac + .08 + .2 * (1 - frac) ** 2))
            T.put(mine * sstep(ci - .01, ci + .01, cosang) * .8, col=(.5, .52, .5), rough=.05)
        T.put(mine * sstep(ca - .012, ca + .012, cosang), col=INK * .6, rough=.08 if st < 2 else .03)
    T.h[:] = 0


def paint_hat(T, S):
    P, st = T.P, S['stage']
    Q, _ = headspace(P, T.N)
    stripe = (np.mod((np.arctan2(Q[:, 1] + .05, Q[:, 0]) / 6.2832 * 3 + Q[:, 2] * 4.5), 1) < .3).astype(np.float32)
    gold = mixc(YELLOW, (1., .78, .2), .5)
    hc = gold[None] + (RED - gold)[None] * stripe[:, None] * .85
    if st: hc = mixc(hc, SURFACE0, .22 * st) * (.7 + .6 * fbm(P * 14, 3, 31))[:, None]
    T.col[:] = hc; T.rough[:] = .35 if st == 0 else .7
    crease = np.abs(vnoise(P * F(30, 30, 9), 12) - .5)
    T.h = -np.exp(-(crease / .02) ** 2) * (.0006 + .0015 * st)


def paint_pom(T, S):
    T.col[:] = mixc(PINK, RED, .35)[None] * (.6 + .7 * fbm(T.P * 160, 2, 33))[:, None] * (1 - .25 * S['stage'])
    T.rough[:] = .95
    T.h = vnoise(T.P * 200, 34) * .003


def paint_tooth(T, S):
    P, st = T.P, S['stage']
    if st == 0:   # felt over card
        T.col[:] = mixc(ROSE, (1, 1, 1), .5)[None] * (.9 + .2 * vnoise(P * 150, 35))[:, None]; T.rough[:] = .8
        T.h = vnoise(P * 220, 36) * .0008
    else:         # enamel: yellow, brown between the teeth
        dirt = fbm(P * F(60, 60, 25), 3, 37)
        T.col[:] = BONE_COL[None] * (1 - .5 * sstep(.4, .75, dirt))[:, None]; T.rough[:] = .3
        T.h[:] = 0
        if st == 2:   # it has been eating: old brown crust at the gums
            T.put(sstep(.5, .7, fbm(P * F(40, 40, 12), 2, 39)) * .85, col=DRIED, rough=.5)


def paint_nail(T, S):
    if S['stage'] < 2: T.col[:] = mixc(BELLY_COL, ROSE, .4)[None] * (.85 + .3 * vnoise(T.P * 120, 38))[:, None]; T.rough[:] = .85
    else: T.col[:] = F(.12, .1, .09); T.rough[:] = .25


def paint_zip(T, S):
    zt = ((np.mod(T.P[:, 2] / .011, 1) < .55) * (np.abs(T.P[:, 0]) < .007)).astype(np.float32)
    T.col[:] = FUR_COL * .55; T.rough[:] = .8
    T.put(zt, col=(.62, .6, .55), rough=.3)
    T.h = zt * .0015


def paint_skin(T, S):
    skin(T, np.ones(len(T.P), dtype=np.float32))
    if S['stage'] == 2:   # hands and feet are dark with it to the wrist
        T.put(sstep(.5, .12, T.P[:, 2]) * (.5 + .5 * fbm(T.P * 20, 2, 64)), col=DRIED, rough=.5)


def paint_strand(T, S):
    T.col[:] = F(.035, .03, .04)[None] * (.6 + .9 * vnoise(T.P * F(300, 300, 20), 65))[:, None]; T.rough[:] = .35
    T.h[:] = 0


def paint_bstrand(T, S):     # ropes of old blood and drool, nearly black
    T.col[:] = DRIED[None] * (.6 + .8 * vnoise(T.P * 60, 81))[:, None]; T.rough[:] = .2
    T.h[:] = 0


def paint_dark(T, S):
    """Inside the mouth hole."""
    P = T.P
    hole_e = np.linalg.norm((P - F(*HOLE_C)) / F(*HOLE_R), axis=1)
    T.col[:] = F(.035, .012, .018)[None] * (.5 + fbm(P * 30, 2, 71))[:, None]; T.rough[:] = .3
    T.put(sstep(.8, 1.05, hole_e) * .6, col=DRIED * .8, rough=.25)
    T.h = fbm(P * 50, 2, 72) * .002


def paint_mask(T, S):
    """The small face: pale, cracked, hollow sockets, black tear tracks, a thin mouth."""
    P = T.P
    v = P - F(*MASK_C)
    T.col[:] = np.tile(PALE, (len(P), 1)) * (.82 + .25 * fbm(P * 45, 3, 73))[:, None]; T.rough[:] = .38
    T.h[:] = 0
    crack = np.abs(fbm(P * F(38, 20, 30), 3, 74) - .5)
    T.put(np.exp(-(crack / .004) ** 2) * .55, col=F(.25, .22, .22))
    T.put(sstep(.6, 1.05, np.linalg.norm(v / F(.105, .2, .135), axis=1)) * .7, col=F(.3, .27, .3))          # grime at the edge
    for sx in (1, -1):
        sc = F(sx * .037, 0, .028)
        se = np.hypot((v[:, 0] - sc[0]) / .027, (v[:, 2] - sc[2]) / .033)
        T.put(sstep(1.08, .92, se), col=INK * .4, rough=.5)                                                  # sockets
        tear = (np.abs(v[:, 0] - sc[0] - .004 * np.sin(v[:, 2] * 70)) < .0048) * (v[:, 2] < sc[2]) * (v[:, 2] > sc[2] - (.1 if sx > 0 else .135))
        T.put(tear, col=INK * .5, rough=.3)                                                                    # tear tracks
    mouth = (np.abs(v[:, 2] + .065 - .012 * (v[:, 0] / .04) ** 2) < .0042) * (np.abs(v[:, 0]) < .04)
    T.put(mouth, col=INK * .4, rough=.5)


def paint_meat(T, S):
    fib = fbm(T.P * F(30, 30, 90), 3, 75)
    T.col[:] = F(.17, .055, .05)[None] * (.35 + 1.1 * fib)[:, None]; T.rough[:] = .22     # dark and going off, not fresh red
    T.h = fib * .004


def paint_flesh(T, S):
    T.col[:] = F(.2, .13, .13)[None] * (.5 + fbm(T.P * 40, 2, 76))[:, None]; T.rough[:] = .3     # torn skin, grey-brown


def paint_bone(T, S):
    T.col[:] = BONE_COL[None] * (.75 + .3 * vnoise(T.P * 50, 77))[:, None]; T.rough[:] = .4
    T.put(sstep(.5, .66, fbm(T.P * 22, 3, 78)) * .85, col=DRIED, rough=.5)
    T.h[:] = 0


def paint_gut(T, S):
    P = T.P
    lump = fbm(P * 24, 3, 79); vein = np.exp(-((fbm(P * 40, 3, 80) - .5) / .015) ** 2)
    col = F(.3, .2, .2)[None] * (.6 + .7 * lump)[:, None]      # grey, dead gut: bright red rings read as cartoon
    T.col[:] = col + (F(.12, .06, .08) - col) * vein[:, None] * .7; T.rough[:] = .18
    T.h = lump * .003


PAINTERS = {EYE: paint_eye, HAT: paint_hat, POM: paint_pom, TOOTH: paint_tooth, NAIL: paint_nail, ZIP: paint_zip, SKIN: paint_skin, STRAND: paint_strand,
            BSTRAND: paint_bstrand, DARK: paint_dark, MASK: paint_mask, MEAT: paint_meat, FLESH: paint_flesh, BONE: paint_bone, GUT: paint_gut}


def paint(T, S):
    t = T.sub(np.isin(T.cls, (FUR, HFUR, JFUR)))
    if len(t.P): paint_fur(t, S); T.merge(t)
    for cls, fn in PAINTERS.items():
        t = T.sub(T.cls == cls)
        if len(t.P): fn(t, S); T.merge(t)
    for c, r, seed, wet in S.get('stains', []):
        near = (np.hypot((T.P[:, 0] - c[0]) / r[0], (T.P[:, 1] - c[1]) / r[1]) < 1.6) & (T.P[:, 2] < c[2] + r[2] * 1.6) & (T.P[:, 2] > c[2] - r[2] * 3.6)
        t = T.sub(near & np.isin(T.cls, (FUR, HFUR, JFUR, SKIN)))
        if len(t.P): stain(t, c, r, seed, wet); T.merge(t)
    # Occlusion goes into the colour: the game has one light and no ambient. Not on the eyeballs:
    # the game turns them, and the shadowed half buried in the head would roll into view as a lid.
    ao = np.where(T.cls == EYE, 1, np.clip(T.ao, 0, 1))
    T.col *= (.3 + .7 * ao ** 1.2)[:, None]


def finish(objs, S, dense):
    log('built')
    texture(objs, KEY, lambda T: paint(T, S), W=1024 if QUICK else 2048, small=512 if QUICK else 1024, dense=dense,
            glow_colour=(1, .96, .85) if STAGE < 2 else tuple(PALE))


# ------------------------------------------------------------ run

FACE = {0: ((0, -.6, 1.9), .62), 1: ((0, -.75, 1.98), .68), 2: ((0, -1.0, 2.25), .75)}
for stage in STAGES:
    begin(stage)
    root = [stage0, stage1, stage2][stage]()
    log('export')
    export_glb(KEY, [root])
    info = report(KEY)
    whole = ((0, .1, info['max'][2] * .5), info['max'][2] * .62)
    for tag, view, light, focus in (('sf', 'front', 'studio', whole), ('sq', 'three_quarter', 'studio', whole), ('ss', 'side', 'studio', whole), ('sb', 'back', 'studio', whole),
                                    ('df', 'front', 'flashlight', whole), ('dl', 'low', 'flashlight', None), ('face', 'front', 'flashlight', FACE[stage]), ('sface', 'three_quarter', 'studio', FACE[stage])):
        if tag in SHOTS:
            log('preview', tag)
            preview(KEY, views=(view,), light=light, res=448, samples=10, focus=focus, tag='_' + tag)
    log('done', KEY)
