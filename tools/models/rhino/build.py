# Greg, the rhino mascot: three GLBs, one per rot stage, and rhino.json.
#
#   tools/models/bl tools/models/rhino/build.py            all three stages
#   tools/models/bl tools/models/rhino/build.py -- 2       one stage
#   tools/models/bl tools/models/rhino/build.py -- 2 fast  skip the preview renders
#
# Stage 0 is the costume as built. Stage 1 is the same costume on something
# starved, folded into a crouch. Stage 2 is bent over backwards into a
# bridge, belly to the ceiling, hands and feet flat on the floor, with the
# worm standing straight up out of the belly and the head hanging off a
# snapped neck underneath. The hips and rear are enormous at stages 0 and 1,
# wider than tall, a shelf. At stage 2 they are emptied out (the owner's
# call): a starved pelvis narrower than the shoulders, so the worm is the
# biggest thing on it.
#
# sculpt.py makes the meshes, shade.py the materials and the bake, parts.py
# the head, hands, feet and worm. This file lays each stage out and exports.
# ../look.py renders previews of the result.
import sys, os, math, time, traceback
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from mathutils import Matrix, Vector
from common import *
from sculpt import *
from parts import *
import shade

KEY = 'rhino'
_t = [time.time()]


def clock(what):
    print(f'[clock] {what}: {time.time() - _t[0]:.0f} s', flush=True)
    _t[0] = time.time()


def materials(stage, body=None, limb=None, head=None, links=0, rng=None):
    f = shade.flat
    rust = stage > 0
    M = dict(
        body=shade.hide('hide_body', stage, **(body or {})),
        limb=shade.hide('hide_limb', stage, seam_x=False, **(limb or {})),
        head=shade.hide('hide_head', stage, **(head or {})),
        felt=f('felt', '#07070a', '#1b1b22', 300, .95, .0006),
        thread=f('thread', '#060607', '#2a2530', 1, .75, .0012, streak=(500, 500, 500), bscale=1.5),
        hair=f('hair', '#040405', '#1d1a1c', 60, .42),
        claw=f('claw', '#120d0b', '#4d3d30', 1, .32, .0006, streak=(200, 200, 30)),
        nail=f('nail', shade.CREAM, '#b9a488', 30, .42, .0005, grime=[.25, .8, .9][stage]),
        zip=f('zip', '#3b2a1c' if rust else '#6b5a2e', '#8a5a34' if rust else '#c2aa63', 1, .6 if rust else .32, .0025, streak=(30, 30, 1300), bscale=1),
        tape=f('tape', '#1f2029', '#383a48', 400, .9, .0005),
        crust=f('crust', shade.CRUST, shade.CRUST_HI, 40, .6),      # stage 2's dried blood: drips and clotted strands
        horn=shade.horn('horn', stage),
        terry=shade.terry('terry', stage),
        white=shade.plastic('eye_white', '#f3ede6', stage),
        black=shade.plastic('eye_black', '#08080b', stage, yellow='#1c1a16'),
        eyeball=shade.eyeball('eyeball'),
        stare_L=shade.stare('stare_L', pupil=.6, iris=.68, seed=1),    # blown
        stare_R=shade.stare('stare_R', pupil=.06, iris=.52, seed=2),   # a pinprick
        meat=shade.meat('meat'),
    )
    if links:
        M['worm'] = [shade.worm_skin(f'worm_{i}', float(rng.uniform(0, 1)) ** 1.5, i * 3.7 + 1) for i in range(links)]
        M.update(boil=shade.boil('boil'), mouth=shade.mouth('mouth'), tooth=shade.tooth('tooth'), slime=shade.slime('slime'))
    return M


def rear(c, y, z, hips_y=None):
    """The hips and the rear, the same at every stage: about 2.2 m across
    and under a metre tall. y, z: centre of the pelvis."""
    c.ell((0, y, z), (1.03, .56, .44), e=2.4, sub=4)
    for sx in (-1, 1):
        c.ell((sx * .42, y + .3, z - .07), (.5, .43, .46), sub=4)   # buttocks
        c.ell((sx * .66, y + .02, z - .05), (.44, .48, .40), sub=4)  # the shelf over each leg


def rear_detail(body, z):
    """The crack and the fold under each cheek."""
    surf = Surface(body)
    crack = surf.drape([(0, 2.0, zz) for zz in np.linspace(z + .24, z - .5, 14)], (0, -1, 0))
    groove(body, crack, .05, .07)
    for sx in (-1, 1):   # the fold under each cheek
        fold = surf.drape([(sx * xx, 2.0, z - (.36 + .08 * (xx - .45) ** 2)) for xx in np.linspace(.12, .8, 9)], (0, -.6, 1))
        groove(body, fold, .04, .02)


def ribs(body, centre, radii, frame, depth=.016, spacing=.085):
    """Press ribs into the chest: chevrons that drop toward the breastbone,
    a gutter down the breastbone and another down the spine. frame is the
    ribcage's own axes as world vectors, columns (x, y, z), with -y the
    breastbone side and +z toward the neck."""
    cen, rad, F = np.asarray(centre, float), np.asarray(radii, float), np.asarray(frame, float)

    def fn(p, n):
        q = (p - cen) @ F                                           # into the ribcage's own axes
        x, y, z = q[:, 0], q[:, 1], q[:, 2]
        inside = np.clip((1.25 - np.sqrt((x / rad[0]) ** 2 + (y / rad[1]) ** 2 + (z / rad[2]) ** 2)) * 2, 0, 1)
        slope = np.where(y < 0, .5, -.25)
        wave = np.cos((z + slope * np.abs(x)) / spacing * math.tau)
        gutter = np.exp(-(x / .035) ** 2)
        return inside * (depth * wave * (1 - gutter) - gutter * depth * 1.2) - inside * .01

    displace(body, fn)


def leaning(pitch):
    """A frame for ribs(): an upright ribcage tipped forward by `pitch`."""
    cs, sn = math.cos(pitch), math.sin(pitch)
    return np.array([[1, 0, 0], [0, cs, -sn], [0, sn, cs]])


def floor_clamp(ob):
    a = co(ob)
    a[:, 2] = np.maximum(a[:, 2], .003)
    setco(ob, a)


def thin_limb(M, rng, pts, radii, knobs, tris, name, hand_at=None, foot_at=None, tuft=0, voxel=.008):
    """One rigid segment of a starved limb: a chain with bony knobs at the
    joints, and a hand or the costume foot on the end if asked."""
    c = Clay()
    c.limb(pts, radii)
    for p, r in knobs: c.ell(p, (r, r, r))
    extra, tips = [], None
    if hand_at: tips = hand(c, *hand_at[:3], rng, **hand_at[3])
    if foot_at: extra += foot(c, foot_at[0], M, foot_at[1], foot_at[2])
    ob = c.build(name, voxel, 3)
    roughen(ob, .004, 14, seed=int(rng.integers(99)))
    tf = tufts(ob, tuft, .06, rng, width=.013, droop=1.0) if tuft else None
    decimate(ob, tris)
    if tips: extra += nails(tips, M)
    return mat([ob, tf], M['limb']) + extra


# ---------- stage 0 ----------

def stage0(rig, rng):
    c = Clay()
    rear(c, .05, .98)
    c.ell((0, -.08, 1.30), (.62, .50, .40), sub=4)                  # belly
    c.ell((0, -.02, 1.52), (.56, .48, .36), e=2.3, sub=4)           # barrel chest
    c.ell((0, .02, 1.66), (.55, .36, .18))                          # shoulders
    c.ell((0, 0, 1.74), (.26, .24, .12))
    body = c.build('body', .016, 6)
    rear_detail(body, .98)
    M = materials(0, body=dict(pale=[((0, -.62, 1.24), (.46, .5, .5))]), head=dict(pale=[((0, -.46, .17), (.34, .32, .22))]))
    fit = zipper(body, M, 1.7, 1.24, 0)
    tail(rig, body, M, 1.22, 0, rng)
    tf = tufts(body, 90, .035, rng, lambda p, n: (p[:, 2] > 1.6) | (p[:, 1] > .85), width=.012, droop=.5)
    decimate(body, 13000)
    rig.add('body', 'root', (0, .05, 1.0), mat([body, tf], M['body']) + fit)

    for side, sx in (('L', 1), ('R', -1)):
        hip, knee, ankle = np.array([sx * .45, .08, .82]), np.array([sx * .47, .05, .42]), np.array([sx * .47, .05, .16])
        c = Clay(); c.limb([hip + (0, 0, .06), knee], [.30, .25])
        thigh = decimate(c.build('thigh', .014, 4), 1100)
        rig.add('leg_' + side, 'body', hip, mat([thigh], M['limb']))
        c = Clay(); c.limb([knee, ankle], [.245, .21])
        toes = foot(c, ankle, M, sx)
        shin = decimate(c.build('shin', .012, 4), 2200)
        rig.add('shin_' + side, 'leg_' + side, knee, mat([shin], M['limb']) + toes)

        # arms bent, fists carried in front above the hips, so the shelf of the hips shows past them
        sh, el, wr = np.array([sx * .57, 0, 1.62]), np.array([sx * .77, -.06, 1.4]), np.array([sx * .75, -.27, 1.3])
        c = Clay(); c.limb([sh, el], [.2, .17]); c.ell(sh + (sx * .02, 0, .02), (.22, .22, .2))
        upper = decimate(c.build('upper', .014, 4), 1100)
        rig.add('arm_' + side, 'body', sh, mat([upper], M['limb']))
        c = Clay(); c.limb([el, wr], [.165, .15])
        fist = wr + np.array([0, -.11, -.05])
        c.ell(fist, (.17, .19, .18), e=2.6, sub=4)
        c.ell(fist + (-sx * .13, -.06, .06), (.07, .09, .09))          # thumb of the mitten
        fore = c.build('fore', .012, 4)
        groove(fore, [fist + (sx * .19, 0, .06), fist + (0, -.2, .06), fist + (-sx * .19, 0, .06)], .025, .012)   # mitten seam
        rig.add('forearm_' + side, 'arm_' + side, el, mat([decimate(fore, 2000)], M['limb']))

    head(rig, M, 0, place(at=(0, -.03, 1.72)), 'body', rng, 11000)
    return dict(
        face=(0, -.5, 2.15),
        boost={'head': 1.5, 'eye_L': 1.6, 'eye_R': 1.6},
        notes='The costume as built: heavy, upright, cheerful. Walk: a slow waddle, swing leg_L/leg_R about x by up to 25 degrees with the '
              'shin following 10 to 15 more, body rolling 3 to 4 degrees about z onto the standing leg; the hips are 2 m wide so keep the '
              'stride short. Arms swing opposite the legs, 20 degrees at the shoulder. Idle: breathe by scaling body a little, turn head up to '
              '35 degrees about y, tilt 15 about z. The eyes never blink; let eye_L and eye_R track the player (up to 30 degrees) while the '
              'head stays still. Attack: it charges, body pitched forward 15 degrees, head down 20 so the horn leads, arms back. Jumpscare: '
              'push the head at the camera, horn first. Limits: leg 35, shin 40 (bend backward only, positive x), arm 60 forward and back and 30 '
              'out to the side (the fists pass the hips), forearm 50, head 40 about y and 25 about x before the neck opens. No jaw: the smile is sewn on.',
    )


# ---------- stage 1 ----------

def stage1(rig, rng):
    PY, PZ = .19, .60                                               # rear as far forward as the 1.9 m deep box needs
    c = Clay()
    rear(c, PY, PZ)
    c.limb([(0, PY - .02, .82), (0, .14, .98)], [.24, .22])          # what is left of the waist
    rc, rr, lean = (0, .08, .98), (.33, .29, .31), .4
    c.ell(rc, rr, rot=(lean, 0, 0), sub=4)                          # ribcage, tipped forward
    c.ell((0, .0, 1.12), (.46, .15, .1))                            # shoulder girdle
    for sx in (-1, 1): c.limb([(sx * .05, -.14, 1.1), (sx * .4, -.04, 1.13)], [.035, .04])   # collarbones
    c.limb([(0, .02, 1.1), (0, -.06, 1.22)], [.13, .12])
    body = c.build('body', .014, 5)
    rear_detail(body, PZ)
    ribs(body, rc, rr, leaning(lean))
    surf = Surface(body)
    for z in np.linspace(.84, 1.2, 7):                              # spine showing through the back
        hit, _ = surf.ray((0, 2, z), (0, -1, 0))
        dent(body, hit, .032, -.026)
    roughen(body, .006, 8, seed=4)
    chest, _ = Surface(body).ray((.06, -2, 1.0), (0, 1, 0))
    M = materials(1, body=dict(pale=[((0, -.3, .98), (.26, .34, .34))], blood=[(tuple(chest), .13)]),
                  limb=dict(blood=[((.2, -.65, .05), .12)]),
                  head=dict(pale=[((0, -.46, .17), (.34, .32, .22))], blood=[((.12, -.66, .08), .07)]))
    fit = zipper(body, M, 1.12, .78, 1)
    tail(rig, body, M, PZ + .22, 1, rng)
    tf = tufts(body, 330, .08, rng, lambda p, n: (p[:, 2] > .5) & ~((p[:, 1] < -.1) & (np.abs(p[:, 0]) < .25)), width=.017, droop=1.0)
    decimate(body, 14000)
    rig.add('body', 'root', (0, PY, PZ), mat([body, tf], M['body']) + fit)

    for side, sx in (('L', 1), ('R', -1)):
        hip, knee, ankle = np.array([sx * .44, PY - .04, PZ + .02]), np.array([sx * .76, -.12, 1.72 - (sx < 0) * .06]), np.array([sx * .72, -.26, .14])
        mid = hip + (knee - hip) * .35 + np.array([sx * .05, 0, 0])
        rig.add('leg_' + side, 'body', hip, thin_limb(M, rng, [hip, mid, knee], [.22, .14, .1], [(knee, .12)], 1400, 'thigh', tuft=30))
        rig.add('shin_' + side, 'leg_' + side, knee,
                thin_limb(M, rng, [knee, ankle], [.1, .075], [(knee, .115), (knee + (0, -.06, .03), .07)], 2400, 'shin', foot_at=(ankle, sx, .9), tuft=24, voxel=.01))
        sh, el, wr = np.array([sx * .43, .0, 1.1]), np.array([sx * .58, -.29, .62]), np.array([sx * .2, -.45, .085])
        rig.add('arm_' + side, 'body', sh, thin_limb(M, rng, [sh, el], [.085, .06], [(sh, .1), (el, .072)], 900, 'upper', tuft=24))
        hand_at = (wr, (sx * .12, -1, .3), (-sx, 0, .1), dict(size=1.15, curl=(0, 0, -.55), spread=.2))
        rig.add('forearm_' + side, 'arm_' + side, el,
                thin_limb(M, rng, [el, wr], [.066, .048], [(el, .07), (wr, .052)], 3000, 'fore', hand_at=hand_at, tuft=16, voxel=.006))

    head(rig, M, 1, place(at=(0, -.08, 1.2), rot=(.3, .07, .04)), 'body', rng, 11000)
    return dict(
        face=(0, -.55, 1.5),
        boost={'head': 1.5, 'eye_L': 1.6, 'eye_R': 1.6},
        notes='Folded into a deep crouch: rear on the floor, knees up beside the ears, long arms planted between them. The rest pose is the '
              'idle. Idle: almost still, then small wrong movements: rock body 3 degrees about x, let the head drop and snap back, twitch one '
              'forearm. The eyes do not agree (the pupils are baked off-axis), so turning eye_L and eye_R to the player still leaves them '
              'looking two ways. Walk: it does not stand. Move it as a crawl or a frog hop: both arms reach forward (arm about x by -30, '
              'forearm +20), body pitches forward 15, then the legs fold shut (leg about x by -15, shin +25) as the rear drags up behind. Or '
              'just slide it between hops; the hop is what sells it. Attack: the spring. Body pitches forward 30 to 40 degrees and rises, '
              'legs straighten (leg +40, shin -50), arms come up and out. Jumpscare: head and stitched mouth into the camera, arms either '
              'side. Limits: leg 40, shin 50, arm 45, forearm 40, head 35 any axis. The shoulders are thin; past 45 degrees the arm leaves '
              'its socket. The hands are part of the forearm and do not articulate.',
    )


# ---------- stage 2 ----------

def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def rot_between(a, b):
    return Vector(unit(a)).rotation_difference(Vector(unit(b))).to_matrix().to_4x4()


def about(c, m4):
    """Matrix m4 applied about the point c."""
    return Matrix.Translation(Vector(c)) @ m4 @ Matrix.Translation(-Vector(c))


def flat_foot(c, ankle, M, toes, size=.85):
    """parts.foot(), turned to point its toes along `toes` (a direction on
    the floor). In a bridge the toes point away from the head, toward +y."""
    d = unit((toes[0], toes[1], 0)); s = np.array([d[1], -d[0], 0])
    ang = math.atan2(-d[0], d[1])                                   # turns the pad's long axis (+y) onto d
    ax, ay, az = ankle
    cen = np.array([ax, ay, 0]) + d * .1 * size + np.array([0, 0, .095 * size])
    c.ell(cen, (.24 * size, .34 * size, .095 * size), rot=(0, 0, ang), e=3.0, sub=3)
    c.limb([ankle, cen - d * .08 + (0, 0, .02)], [.15 * size, .17 * size])
    out = []
    for k in (-1, 0, 1):
        p = cen + d * (.3 * size - abs(k) * .035) + s * k * .14 * size + np.array([0, 0, -.005])
        out.append(mat(solid(p, (.062 * size, .045 * size, .06 * size), rot=(0, 0, ang), e=2.6, name='toenail'), M['nail']))
    return out


def shin_and_foot(M, rng, knee, ankle, toes, tris=1800):
    """A starved shin with the costume foot on the end, planted flat."""
    c = Clay()
    c.limb([knee, ankle], [.088, .07])
    c.ell(knee, (.1, .1, .1))
    nails = flat_foot(c, ankle, M, toes)
    ob = c.build('shin', .01, 3)
    roughen(ob, .004, 14, seed=int(rng.integers(99)))
    tf = tufts(ob, 20, .06, rng, lambda p, n: p[:, 2] > .25, width=.013, droop=1.0)
    decimate(ob, tris)
    return mat([ob, tf], M['limb']) + nails


def zipper_under(body, M, y0, y1):
    """parts.zipper() for a back that faces the floor: the zip runs along
    the underside of the arch, from the neck end toward the rear."""
    surf = Surface(body)
    ys = np.linspace(y0, y1, 26)
    line = surf.drape([(0, y, -1.0) for y in ys], (0, 0, 1), lift=.004)
    line[:, 0] += np.sin(ys * 23) * .006
    tape = mat(tube(line, .03, n=6, name='tape', squash=.16), M['tape'])
    teeth = mat(tube(line + (0, 0, -.004), .0095, n=6, name='zipteeth', squash=.6), M['zip'])
    top = line[0] + np.array([0, 0, -.01])
    tab = mat(solid(top + (0, -.004, -.03), (.014, .03, .005), e=3, name='tab'), M['zip'])
    slider = mat(solid(top, (.017, .017, .009), e=3, name='slider'), M['zip'])
    return [tape, teeth, tab, slider]


def stage2(rig, rng):
    # The head end of the bridge is at the front (-y), where the worm's mouth and the hanging head face.
    LINKS = 12
    PY, PZ = .42, .92                                               # the pelvis, the body's pivot
    TILT = .75                                                      # the ribcage dips toward the head end
    KINK = np.array([-.02, -.74, .95])                              # where the neck broke
    c = Clay()
    # The pelvis, emptied out as at the old stage 2, but lying on its back:
    # what is left of the rear hangs underneath, the hip bones push up.
    c.ell((0, PY, PZ), (.31, .22, .2), e=2.2, sub=4)
    for sx in (-1, 1):
        c.ell((sx * .15, PY + .07, PZ - .1), (.15, .16, .13), sub=3)        # what is left of each buttock, sagging
        c.ell((sx * .28, PY - .08, PZ + .09), (.075, .06, .09))             # hip bone through the cloth
    c.limb([(0, PY - .04, PZ + .08), (0, .24, 1.3), (0, -.02, 1.42)], [.2, .22, .23])   # the arched waist
    c.ell((0, .1, 1.4), (.29, .27, .25))                          # the belly it came out of, the top of the arch
    # ribcage, its breastbone to the ceiling, its neck end tipped down
    h = np.array([0, -math.cos(TILT), -math.sin(TILT)])             # toward the neck
    f = np.array([0, -math.sin(TILT), math.cos(TILT)])              # out of the breastbone
    frame = np.stack([np.cross(-f, h), -f, h], 1)                    # columns: the ribcage's own x, y, z
    rc, rr = np.array([0, -.26, 1.18]), (.36, .28, .36)
    c.ell(rc, rr, rot=(-math.pi / 2 - TILT, 0, 0), sub=4)
    c.ell((0, -.52, .94), (.47, .11, .15), rot=(.6, .12, 0))        # shoulder girdle, one side dropped
    for sx in (-1, 1): c.limb([(sx * .05, -.62, 1.02), (sx * .42, -.54, .96 + sx * .03)], [.035, .04])   # collarbones
    c.ell((0, -.62, .9), (.14, .12, .1))
    body = c.build('body', .014, 5)
    ribs(body, rc, rr, frame)
    surf = Surface(body)
    for y in np.linspace(-.5, .4, 12):                              # the spine, along the underside of the arch
        hit, _ = surf.ray((0, y, -1), (0, 0, 1))
        if hit is not None: dent(body, hit, .032, -.028)
    roughen(body, .007, 8, seed=6)
    wound, _ = Surface(body).ray((0, .08, 3), (0, 0, -1))
    dent(body, wound, .19, .13)                                     # the hole, open to the ceiling
    wc = wound + np.array([0, 0, -.08])
    M = materials(2,
                  body=dict(pale=[((0, -.2, 1.45), (.25, .42, .3))],
                                  blood=[(tuple(wound + (.2, .05, -.06)), .12), (tuple(wound + (-.16, -.2, -.04)), .1), ((.1, -.42, 1.08), .09)],
                                  meat=[(tuple(wc), (.23, .29, .2))]),
                  limb=dict(blood=[((-.5, -.62, .4), .1), ((.42, .6, .7), .12), (KINK, .08)], meat=[(KINK, (.07, .06, .08))]),
                  head=dict(pale=[((0, -.46, .17), (.34, .32, .22))], blood=[((.05, -.62, .1), .07)],
                                  tears=[((sx * EYE_X + sx * .01, -.42, EYE_Z - .08), .3 if sx > 0 else .38) for sx in (1, -1)],
                                  sockets=[((sx * EYE_X, -.45, EYE_Z), .15) for sx in (1, -1)]),
                  links=LINKS, rng=rng)
    fit = zipper_under(body, M, -.48, .4)
    tail(rig, body, M, PZ - .08, 2, rng)
    keep_bare = lambda p, n: ~((np.abs(p[:, 0]) < .34) & (p[:, 2] > 1.25) & (p[:, 1] > -.45) & (p[:, 1] < .45))
    tf = tufts(body, 200, .085, rng, keep_bare, width=.017, droop=1.0)
    decimate(body, 8500)
    pieces = mat([body, tf], M['body']) + fit

    # The plush that held the big hips, emptied and hanging off the pelvis in
    # slack folds toward the floor. Each fold is built facing -y and turned to
    # face out, so its flat side lies against the body.
    hs = Surface(body)
    for k, (ox, oy) in enumerate(((1, -.2), (.9, .5), (.35, 1), (-.35, 1), (-.9, .45), (-1, -.15))):
        out = unit((ox, oy, 0))
        top, _ = hs.ray(np.array([0, PY, PZ - .04]) + out * 1.5, -out)
        if top is None: continue
        L = rng.uniform(.26, .42)
        fl = tube([(0, .03, .03), (0, -.03, -.05), (0, -.05, -L * .55), (0, -.03, -L)], [.075, .085, .07, .03], n=10, name='sag', squash=.22)
        roughen(fl, .008, 18, seed=20 + k)
        fl.data.transform(place(at=top, rot=(0, 0, math.atan2(out[0], -out[1]))))
        pieces.append(mat(fl, M['body']))

    # torn edges round the wound, meat and costume, peeled back and lying on the belly
    bsurf = Surface(body)
    for i in range(12):
        a = i / 12 * math.tau + rng.uniform(-.15, .15)
        out = np.array([math.cos(a), math.sin(a), 0])
        rim, _ = bsurf.ray(wound + out * np.array([.21, .27, 0]) + (0, 0, 1), (0, 0, -1))
        if rim is None: rim, _ = bsurf.near(wound + out * np.array([.21, .27, 0]))
        Lf = rng.uniform(.12, .22)
        # laid over the curve of the belly: each point dropped onto the
        # surface from above, then lifted off it, most where it curls at the rim
        pts = [rim - out * .03 - (0, 0, .02)]
        for t, lift in ((.3, .05), (.6, .035), (.85, .02), (1, .008)):
            q, _ = bsurf.ray(rim + out * Lf * t + (0, 0, 1), (0, 0, -1))
            pts.append((q if q is not None else rim + out * Lf * t) + (0, 0, lift))
        fl = tube(pts, [rng.uniform(.05, .08), .065, .05, .03, .004], n=7, name='flap', squash=.22, phase=a + math.pi / 2)
        roughen(fl, .006, 30, seed=i)
        pieces.append(mat(fl, M['meat'] if i % 3 else M['limb']))
    rig.add('body', 'root', (0, PY, PZ), pieces)

    # Old blood ran down the sides of the belly and dried in ropes that hang
    # off the underside of the arch, where a player at its feet sees them.
    drips, tops = [], []
    for i in range(8):
        x = (i - 3.5) * .085 + rng.uniform(-.02, .02)
        top, _ = bsurf.ray((x, -.05 + rng.uniform(-.12, .12), -1), (0, 0, 1))
        if top is None: continue
        tops.append(top)
        drips.append(mat(strand(top + (0, 0, -.01), rng.uniform(.25, .7), rng.uniform(.006, .011), rng, wave=.02, blob=.013), M['crust']))
    rig.sway('body', np.mean(tops, axis=0), drips, 'ropes of dried blood hanging from the underside of the arch, under the wound')

    # ---------- limbs ----------
    # Hands by the head end, fingers pointing back toward the feet, as in a
    # wheel pose. The left elbow sticks out to the side; the right one has
    # gone the wrong way, bent forward against the joint.
    for side, sx in (('L', 1), ('R', -1)):
        sh = np.array([sx * .44, -.52, .96 + sx * .03])
        el = np.array([.84, -.44, .58]) if sx > 0 else np.array([-.62, -.92, .52])
        wr = np.array([sx * .74, -.55, .1])
        rig.add('arm_' + side, 'body', sh, thin_limb(M, rng, [sh, el], [.085, .06], [(sh, .1), (el, .072)], 800, 'upper', tuft=22))
        hand_at = (wr, (sx * .3, 1, .25), (-sx, 0, .1), dict(size=1.15, curl=(0, 0, -.55), spread=.22))
        rig.add('forearm_' + side, 'arm_' + side, el,
                thin_limb(M, rng, [el, wr], [.062, .046], [(el, .068), (wr, .05)], 2000, 'fore', hand_at=hand_at, tuft=14, voxel=.006))
        # Legs: thighs drop from the pelvis to knees a little lower and further
        # back, shins stand on the feet. Knock-kneed and uneven, one foot
        # turned right out.
        hip = np.array([sx * .2, PY + .06, PZ - .05])
        knee = np.array([.56, .74, .74]) if sx > 0 else np.array([-.46, .8, .8])
        ankle = np.array([sx * .6, .76, .14])
        toes = (.6, 1) if sx > 0 else (-1, .3)
        rig.add('leg_' + side, 'body', hip, thin_limb(M, rng, [hip, hip + (knee - hip) * .4, knee], [.15, .11, .085], [(knee, .1)], 1000, 'thigh', tuft=24))
        rig.add('shin_' + side, 'leg_' + side, knee, shin_and_foot(M, rng, knee, ankle, toes))

    # ---------- the snapped neck and the head ----------
    # The neck carries on past the chest, then folds back under it on
    # itself. The head hangs off the end upside down between the hands,
    # crown nearly on the floor, lolled over to one side and twisted a little,
    # so the face is upside down and looking at you.
    nb = np.array([0, -.62, .92])
    hp = np.array([-.04, -.46, .94])
    c = Clay()
    c.limb([nb, (-.02, -.74, .92), (-.05, -.64, .88), hp], [.12, .1, .095, .11])
    c.ell((.04, -.75, .97), (.05, .05, .05))                       # the vertebra that went the wrong way
    c.ell((-.07, -.7, .86), (.045, .04, .04))
    neck = c.build('neck', .009, 3)
    roughen(neck, .005, 16, seed=8)
    # where it snapped the cloth has split, and a broken end of bone sticks out
    bone = tube([KINK + (.01, .03, -.02), KINK + (.04, -.04, .03), KINK + (.07, -.07, .09)], [.022, .016, .004], n=6, name='bone')
    rig.add('neck', 'body', nb, mat([decimate(neck, 700)], M['limb']) + [mat(bone, M['nail'])])
    YAW, ROLL, PITCH = .3, .6, -.3
    Th = (Matrix.Translation(Vector(hp)) @ Matrix.Rotation(YAW, 4, 'Z') @ Matrix.Rotation(PITCH, 4, 'X')
          @ Matrix.Rotation(math.pi + ROLL, 4, 'Y'))
    n0 = len(rig.parts)
    head(rig, M, 2, Th, 'neck', rng, 6500)
    aim_eyes(rig, Th, n0)
    for p in rig.parts[n0:]:   # head() writes these for a head the right way up
        if p['name'].startswith('sway_'):
            rig.notes[p['name']] = 'black strands hanging off the upside-down face toward the floor, some clotted with blood'

    # ---------- the worm ----------
    # Straight up out of the belly, a little back, then over in a hook so the
    # mouth comes to face forward at a standing player's head height.
    tip = np.array([.02, -.46, 2.55])
    ctrl = [wound - (0, 0, .22), wound + (0, 0, .1), (-.05, .15, 1.9), (-.03, .24, 2.2), (.02, .17, 2.48), (.03, -.04, 2.66), (.03, -.27, 2.64), tip, tip + (0, -.3, 0)]
    segs = worm(rig, M, ctrl[:-1], LINKS, rng, r0=.23, r1=.15)
    worm_mouth(rig, M, f'extra_1_{LINKS + 1}', segs[-1][0], tip, .8 * segs[-1][3], rng)
    for idx, count in ((7, 3), (9, 3), (11, 3)):                    # slime off the underside of the hook
        nm, a, b, R, pts, rad, N, B = segs[idx]
        ss, tops = [], []
        for j in range(count):
            k = int(rng.integers(5, len(pts) - 5))
            top = pts[k] + np.array([rng.uniform(-.05, .05), rng.uniform(-.03, .03), 0])
            top[2] = pts[k][2] - rad[k].mean() * .9
            tops.append(top)
            ss.append(mat(strand(top, rng.uniform(.18, .6), rng.uniform(.007, .012), rng, wave=.015, blob=rng.uniform(.012, .02), segs=9), M['slime']))
        rig.sway(nm, np.mean(tops, axis=0), ss, f'slime strands hanging under worm link {idx + 1}')
    ss, tops = [], []
    for j in range(4):                                              # and off the lower lip
        a = -math.pi / 2 + (j - 1.5) * .28
        top = tip + np.array([math.cos(a) * .27, -.36 - .02, math.sin(a) * .27])
        tops.append(top)
        ss.append(mat(strand(top, rng.uniform(.15, .5), rng.uniform(.006, .011), rng, wave=.012, blob=rng.uniform(.011, .018), segs=9), M['slime']))
    rig.sway(f'extra_1_{LINKS + 1}', np.mean(tops, axis=0), ss, 'drool hanging from the lower lip of the worm mouth')

    return dict(
        face=tuple(tip + np.array([0, -.36, 0])),
        eyes=tuple(pt(Th, (0, -.45, EYE_Z))),
        boost={'head': 1.25, 'eye_L': 3.5, 'eye_R': 3.5, f'extra_1_{LINKS + 1}': 2.2, 'extra_2': 2.0, 'extra_3': 2.0, 'extra_4': 2.0, 'extra_5': 2.0},
        notes='Bent over backwards into a bridge, the yoga wheel: belly to the ceiling, hands and feet flat on the floor. The hands are at the '
              'front with the fingers pointing back toward the feet; the feet are behind, toes pointing away. The worm stands straight up out of '
              'a hole in the top of the arch, leans back a little, then hooks over so the mouth faces forward at 2.55 m. The head hangs upside '
              'down off a snapped neck, under the chest between the hands: crown nearly on the floor, horn pointing down at it, rolled 35 '
              'degrees onto one side and turned 17, so the face is upside down and looking at you. A broken end of bone sticks out of the '
              'split in the neck. The pelvis is the starved one of the old stage 2, lying on its back, with the emptied plush hanging off it '
              'toward the floor. Sides: arm_L, forearm_L, leg_L and shin_L are on +x, the side they are on as it walks (the costume, lying on '
              'its back, would call that its right). eye_L and eye_R keep the head\'s own sides, so with the head upside down eye_L is on -x. '
              'The rest pose is the idle: it holds the bridge and trembles, a fast jitter of 1 to 2 degrees on the arms and legs, and the body '
              'sinks and lifts 2 to 3 cm as if the arms might give. The head swings loose on the neck (neck 10 degrees, head 15, lagging the '
              'body) and never aims at anything. The eyes are what is alive in the head: eye_R, the pinprick, holds on the player (at rest it '
              'is already turned up toward a standing player in front, as far as the socket lets it); eye_L, all pupil, aims off to the side and arrives late or not '
              'at all. Each carries one catchlight of eye_glow. Eyes: 25 degrees any axis from rest before the iris turns under the socket. '
              f'The worm is the chain extra_1 (in the wound) to extra_1_{LINKS}, with the mouth as extra_1_{LINKS + 1}; each link turns about '
              'its joint with the one before. Links 1 to 8 rise out of the belly, 9 to 12 curl over into the hook. A positive turn about x '
              'leans the upright links forward and pitches the hook down. Idle: a slow travelling sway, 4 to 8 degrees per link about x and z '
              'with a phase lag up the chain, and a swallowing pulse (scale links 1.0 to 1.08 in sequence). The mouth holds on the player while '
              'the body under it drifts. extra_2, extra_3, extra_4 are the three tooth rings (outer to inner): spin each about its local z, '
              'alternate directions. extra_5 is the second mouth down the throat: slide it out along +z by up to 0.22 m and back. Walk: a '
              'scuttling crab walk, head end first. Move the limbs in diagonal pairs (arm_L with leg_R, then arm_R with leg_L), quick, 3 to 4 '
              'steps a second, with a dead stop every few steps. The pair in the air swings forward and out: arm about x by -20 to -25, about '
              'z by 10 outward (arm_L positive, arm_R negative), forearm by -15 more so the hand lifts; leg about x by -20 and 10 outward about z, shin +15. The '
              'pair on the floor sweeps back by as much. The body rolls 4 degrees about z toward the planted pair and bobs 3 cm. To turn, sweep '
              'both arms the same way about y by up to 20. The worm lags the body: links 1 to 6 lean back 3 degrees each as it speeds up, while '
              'the mouth keeps facing where it is going. Attack: it drops (root down 0.12 m, elbows and knees bending 20 degrees) as the worm '
              'rears back (links 7 to 12 by -10 each about x, which lifts the hook and tips the mouth up), then whips forward (links 1 to 6 by '
              '+8 each, 7 to 12 by +12) so the mouth comes down to chest height in front of it, while the limbs straighten and the root lunges '
              'forward. Jumpscare: straighten the upper links toward the camera so the mouth fills the view, spin the rings fast, push extra_5 '
              'out. Under it the upside-down face swings up into the bottom of the frame on the broken neck (neck by -20 about x, head by -25), '
              'eye_R on the camera. The inside of the mouth is modelled and textured to hold at close range. Limits: 25 degrees per worm link on '
              'any axis before the joints open; link 1 (extra_1) 15, it sits in the wound. Arm 40 any axis, forearm 45, leg 35, shin 40, '
              'neck 20, head 35.',
    )


# Where a standing player's eyes are, in front of it: what the pinprick eye
# looks at in the rest pose.
PLAYER = np.array([0, -3.0, 1.6])


def aim_eyes(rig, Th, n0):
    """parts.head() aims the stage 2 eyes along fixed world directions that
    suit a head on its neck: the right one down at the player, the left off to
    the side. Upside down under the chest, the right one would stare at the
    floor. Turn each ball about its centre: the right one up toward the
    player, as far as its socket lets it (30 degrees off the socket's axis),
    the left one out past the socket's axis, away from the player."""
    old = {'L': (.55, -1, .3), 'R': (.02, -1, -.38)}                # parts.head()'s stage 2 gazes
    axis = unit(np.array(Th.to_3x3() @ Vector((0, -1, 0))))         # straight out of the sockets
    for p in rig.parts[n0:]:
        if p['name'] not in ('eye_L', 'eye_R'): continue
        side, c = p['name'][-1], np.array(p['pivot'])
        want = unit(PLAYER - c) if side == 'R' else unit(axis + np.array([0, 0, -.5]) + np.cross(axis, (0, 0, 1)) * .6)
        # no more than 30 degrees off the socket's axis
        ang = math.acos(max(-1, min(1, want @ axis)))
        if ang > math.radians(30):
            want = unit(np.array(Vector(axis).slerp(Vector(want), math.radians(30) / ang)))
        m = about(c, rot_between(old[side], want))
        for ob in p['pieces'] + p['glow']: xform(ob, m)


STAGES = [stage0, stage1, stage2]


def finalize(rig, stage, info):
    """Join each part's meshes, unwrap everything into one atlas, bake, add
    the unlit eye points, build the node tree and export."""
    name = f'{KEY}_{stage}'
    obs = {}
    for p in rig.parts:
        ob = join(p['pieces'], p['name'])
        floor_clamp(ob)
        obs[p['name']] = ob
    print('[tris]', {k: tris([o]) for k, o in obs.items()}, 'total', tris(obs.values()))
    ext = {k: (co(o).min(0), co(o).max(0)) for k, o in obs.items()}   # which parts set the box, for the size limits
    for ax, nm in ((0, 'x'), (1, 'y'), (2, 'z')):
        lo = min(ext, key=lambda k: ext[k][0][ax]); hi = max(ext, key=lambda k: ext[k][1][ax])
        print(f'[extent] {nm} {ext[lo][0][ax]:.2f} ({lo}) to {ext[hi][1][ax]:.2f} ({hi})')
    clock('joined')
    shade.unwrap(list(obs.values()), info['boost'])
    clock('unwrapped')
    shade.bake(list(obs.values()), name)
    clock('baked')
    for p in rig.parts:
        if p['glow']: obs[p['name']] = join([obs[p['name']]] + p['glow'], p['name'])
    root = empty('root')
    done, todo = {'root': root}, list(rig.parts)
    while todo:   # parts.head() registers the eyes before the head, so one pass is not enough
        left = len(todo)
        for p in list(todo):
            if p['parent'] in done:
                done[p['name']] = part(obs[p['name']], p['name'], done[p['parent']], p['pivot'])
                todo.remove(p)
        if len(todo) == left: raise ValueError(f"no such parent for {[(p['name'], p['parent']) for p in todo]}")
    export_glb(name, [root])
    clock('exported')


def describe(rig, stage, info):
    """One stage's entry in rhino.json, measured from the exported file."""
    rep = report(f'{KEY}_{stage}')
    extras = '; '.join(f'{k}: {v}' for k, v in sorted(rig.notes.items()))
    fx, fy, fz = info['face']
    return dict(file=rep['file'], height=rep['max'][2], radius=round(max(abs(rep['min'][0]), rep['max'][0], abs(rep['min'][1]), rep['max'][1]), 2),
                face=[round(float(fx), 2), round(float(fz), 2), round(float(-fy), 2)], floats=False, nodes=rep['nodes'],
                notes=info['notes'] + (' Parts: ' + extras + '.' if extras else ''))


def looks(stage, info):
    """The standard set of previews, rendered in the same Blender run so a
    build and a look cost one turn in the queue."""
    name = f'{KEY}_{stage}'
    face = (tuple(float(v) for v in info['face']), .55)
    preview(name, views=('front', 'side', 'back'), res=448, samples=12, light='studio')
    preview(name, views=('three_quarter', 'low'), res=448, samples=12, tag='_fl')
    preview(name, views=('front',), res=448, samples=12, light='studio', focus=face, tag='_face')
    preview(name, views=('three_quarter',), res=448, samples=12, focus=face, tag='_facefl')
    if 'eyes' in info:   # stage 2's face is the worm mouth; look at the rhino's own eyes as well
        eyes = (tuple(float(v) for v in info['eyes']), .4)
        preview(name, views=('front',), res=448, samples=12, light='studio', focus=eyes, tag='_eyes')
        preview(name, views=('front', 'low'), res=448, samples=12, focus=eyes, tag='_eyesfl')


def main():
    args = script_args()
    which = [int(a) for a in args if a.isdigit()] or [0, 1, 2]
    failed = []
    for stage in which:
        try:   # one stage failing should not cost the others their turn in the Blender queue
            reset()
            rig = Rig()
            clock('start')
            info = STAGES[stage](rig, np.random.default_rng(100 + stage))
            clock('sculpted')
            finalize(rig, stage, info)
            write_stage(KEY, stage, describe(rig, stage, info))
            if 'fast' not in args: looks(stage, info)
            clock('previews')
        except Exception:
            traceback.print_exc()
            failed.append(stage)
    print('[done]', which, 'failed', failed, flush=True)
    if failed: sys.exit(1)


main()
