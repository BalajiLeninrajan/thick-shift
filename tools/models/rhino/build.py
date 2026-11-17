# Tank, the rhino mascot: three GLBs, one per rot stage, and rhino.json.
#
#   tools/models/bl tools/models/rhino/build.py            all three stages
#   tools/models/bl tools/models/rhino/build.py -- 2       one stage
#   tools/models/bl tools/models/rhino/build.py -- 2 fast  skip the preview renders
#
# Stage 0 is the costume as built. Stage 1 is the same costume on something
# starved, folded into a crouch. Stage 2 stands again because a worm that
# came out of its belly is holding it up. The hips and rear stay enormous
# throughout: wider than tall, a shelf.
#
# sculpt.py makes the meshes, shade.py the materials and the bake, parts.py
# the head, hands, feet and worm. This file lays each stage out and exports.
# look.py renders previews of the result.
import sys, os, json, math, time, traceback
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from mathutils import Vector
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
        wetblood=f('wetblood', shade.DRIED, shade.WETBLOOD, 40, .14),
        horn=shade.horn('horn', stage),
        terry=shade.terry('terry', stage),
        white=shade.plastic('eye_white', '#f3ede6', stage),
        black=shade.plastic('eye_black', '#08080b', stage, yellow='#1c1a16'),
        eyeball=shade.eyeball('eyeball'),
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
    surf = Surface(body)
    crack = surf.drape([(0, 2.0, zz) for zz in np.linspace(z + .24, z - .5, 14)], (0, -1, 0))
    groove(body, crack, .05, .07)
    for sx in (-1, 1):   # the fold under each cheek
        fold = surf.drape([(sx * xx, 2.0, z - .36 - .08 * (xx - .45) ** 2) for xx in np.linspace(.12, .8, 9)], (0, -.6, 1))
        groove(body, fold, .04, .02)


def ribs(body, centre, radii, pitch, depth=.016, spacing=.085):
    """Press ribs into the chest: chevrons that drop toward the breastbone,
    a gutter down the breastbone and another down the spine."""
    cen, rad = np.asarray(centre, float), np.asarray(radii, float)
    cs, sn = math.cos(pitch), math.sin(pitch)

    def fn(p, n):
        q = p - cen
        y = q[:, 1] * cs + q[:, 2] * sn          # undo the lean of the ribcage
        z = -q[:, 1] * sn + q[:, 2] * cs
        x = q[:, 0]
        inside = np.clip(1.25 - np.sqrt((x / rad[0]) ** 2 + (y / rad[1]) ** 2 + (z / rad[2]) ** 2), 0, 1) * 2
        inside = np.clip(inside, 0, 1)
        front = y < 0
        slope = np.where(front, .5, -.25)
        wave = np.cos((z + slope * np.abs(x)) / spacing * math.tau)
        gutter = np.exp(-(x / .035) ** 2)
        return inside * (depth * wave * (1 - gutter) - gutter * depth * 1.2) - inside * .01

    displace(body, fn)


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
    fit = zipper(rig, body, M, 1.7, 1.24, 0)
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
    PY, PZ = .24, .60
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
    ribs(body, rc, rr, lean)
    surf = Surface(body)
    for z in np.linspace(.84, 1.2, 7):                              # spine showing through the back
        hit, _ = surf.ray((0, 2, z), (0, -1, 0))
        dent(body, hit, .032, -.026)
    roughen(body, .006, 8, seed=4)
    chest, _ = Surface(body).ray((.06, -2, 1.0), (0, 1, 0))
    M = materials(1, body=dict(pale=[((0, -.3, .98), (.26, .34, .34))], blood=[(tuple(chest), .13)]),
                  limb=dict(blood=[((.2, -.75, .05), .12)]),
                  head=dict(pale=[((0, -.46, .17), (.34, .32, .22))], blood=[((.12, -.66, .08), .07)]))
    fit = zipper(rig, body, M, 1.12, .78, 1)
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
        sh, el, wr = np.array([sx * .43, .0, 1.1]), np.array([sx * .58, -.34, .62]), np.array([sx * .2, -.56, .085])
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

def stage2(rig, rng):
    LINKS = 12
    PY, PZ = .1, 1.04
    c = Clay()
    rear(c, PY, PZ)
    c.limb([(0, PY, 1.3), (0, .14, 1.52)], [.25, .23])
    c.ell((0, -.1, 1.31), (.3, .26, .25))                           # the belly it came out of
    rc, rr, lean = (0, .17, 1.74), (.37, .29, .38), -.12
    c.ell(rc, rr, rot=(lean, 0, 0), sub=4)
    c.ell((.0, .22, 2.0), (.47, .15, .1), rot=(0, .1, 0))           # shoulders, one dropped
    for sx in (-1, 1): c.limb([(sx * .05, .06, 1.98), (sx * .42, .16, 2.0 - sx * .04)], [.035, .04])
    c.ell((0, .2, 2.04), (.14, .13, .09))
    body = c.build('body', .014, 5)
    rear_detail(body, PZ)
    ribs(body, rc, rr, lean)
    surf = Surface(body)
    for z in np.linspace(1.36, 2.0, 10):
        hit, _ = surf.ray((0, 2, z), (0, -1, 0))
        dent(body, hit, .032, -.028)
    roughen(body, .007, 8, seed=6)
    wound, _ = surf.ray((0, -2, 1.3), (0, 1, 0))
    dent(body, wound, .19, .13)                                     # the hole
    wc = wound + np.array([0, .08, 0])
    M = materials(2, body=dict(pale=[((0, -.2, 1.7), (.24, .3, .34))], blood=[((0, -.12, 1.78), .2), ((-.5, -.3, 1.0), .22), ((.45, -.35, .95), .18), (tuple(wound + (0, 0, -.3)), .3)],
                               meat=[(tuple(wc), (.23, .2, .29))]),
                  limb=dict(blood=[((-.42, -.1, .4), .22), ((.42, -.1, .38), .25), ((.58, 0, .6), .12)]),
                  head=dict(pale=[((0, -.46, .17), (.34, .32, .22))], blood=[((.05, -.62, .1), .12), ((-.2, -.25, .72), .14)]),
                  links=LINKS, rng=rng)
    fit = zipper(rig, body, M, 1.98, 1.3, 2)
    tail(rig, body, M, PZ + .22, 2, rng)
    tf = tufts(body, 330, .085, rng, lambda p, n: ~((p[:, 1] < -.1) & (np.abs(p[:, 0]) < .35) & (p[:, 2] > 1.0) & (p[:, 2] < 1.65)), width=.017, droop=1.0)
    decimate(body, 9500)
    pieces = mat([body, tf], M['body']) + fit

    # torn edges round the wound: meat and costume, curling outward
    bsurf = Surface(body)
    hanging = []
    for i in range(11):
        a = i / 11 * math.tau + rng.uniform(-.15, .15)
        out = np.array([math.cos(a), 0, math.sin(a)])
        rim, _ = bsurf.ray(wound + out * np.array([.2, 0, .26]) + (0, -1, 0), (0, 1, 0))
        if rim is None: rim, _ = bsurf.near(wound + out * np.array([.2, 0, .26]))
        Lf = rng.uniform(.07, .14) * (1.6 if out[2] < -.5 else 1)
        droop = np.array([0, 0, -1.0]) * Lf * (.9 if out[2] < .3 else .3)
        pts = [rim + (0, .02, 0) - out * .02, rim + out * Lf * .4 + (0, -.05, 0), rim + out * Lf * .7 + (0, -.07, 0) + droop * .5, rim + out * Lf * .8 + (0, -.06, 0) + droop]
        fl = tube(pts, [rng.uniform(.04, .065), .045, .03, .004], n=7, name='flap', squash=.22, phase=a)
        roughen(fl, .006, 30, seed=i)
        mat(fl, M['meat'] if i % 3 else M['limb'])
        (hanging if out[2] < -.5 else pieces).append((fl, rim) if out[2] < -.5 else fl)
    rig.add('body', 'root', (0, PY, PZ), pieces)
    drips = []
    for i in range(7):
        top, _ = bsurf.ray(wound + ((i - 3) * .05 + rng.uniform(-.02, .02), -1, -.22 - rng.uniform(0, .05)), (0, 1, 0))
        if top is None: top = wound + ((i - 3) * .05, 0, -.24)
        drips.append(mat(strand(top + (0, -.01, .02), rng.uniform(.2, .75), rng.uniform(.006, .011), rng, wave=.02, blob=.013), M['wetblood']))
    rig.sway('body', wound + (0, 0, -.24), [f for f, _ in hanging] + drips, 'torn flaps of belly and ropes of blood hanging from the bottom of the wound, under the worm')

    for side, sx in (('L', 1), ('R', -1)):
        hip = np.array([sx * .4, PY, .94])
        knee = np.array([.36, -.04, .5]) if sx > 0 else np.array([-.47, .0, .52])     # knock-kneed, uneven
        ankle = np.array([sx * .43, .14, .14])
        rig.add('leg_' + side, 'body', hip, thin_limb(M, rng, [hip, hip + (knee - hip) * .4, knee], [.19, .12, .09], [(knee, .105)], 1000, 'thigh', tuft=24))
        rig.add('shin_' + side, 'leg_' + side, knee, thin_limb(M, rng, [knee, ankle], [.088, .07], [(knee, .1)], 2100, 'shin', foot_at=(ankle, sx, .9), tuft=20, voxel=.01))
        sh = np.array([sx * .46, .22, 1.98 - sx * .04])
        el = np.array([.58, .2, 1.36]) if sx > 0 else np.array([-.56, .1, 1.4])
        wr = np.array([.6, .1, .8]) if sx > 0 else np.array([-.5, -.1, .86])
        rig.add('arm_' + side, 'body', sh, thin_limb(M, rng, [sh, el], [.085, .058], [(sh, .1), (el, .07)], 800, 'upper', tuft=22))
        hand_at = (wr, (0, -.2, -1), (0, -1, .1), dict(size=1.15, curl=(-sx * .5, .2, 0), spread=.12))
        rig.add('forearm_' + side, 'arm_' + side, el, thin_limb(M, rng, [el, wr], [.062, .046], [(el, .068), (wr, .05)], 2400, 'fore', hand_at=hand_at, tuft=14, voxel=.006))

    # the broken neck, and the head hanging off it
    nb = np.array([0, .2, 2.02])
    hp = np.array([-.13, .13, 2.17])
    c = Clay()
    c.limb([nb, (-.01, .18, 2.13), hp], [.12, .1, .12])
    c.ell((.06, .2, 2.14), (.05, .05, .05))                         # the vertebra that went the wrong way
    neck = c.build('neck', .009, 3)
    roughen(neck, .005, 16, seed=8)
    rig.add('neck', 'body', nb, mat([decimate(neck, 700)], M['limb']))
    head(rig, M, 2, place(at=hp, rot=(.22, -.72, .12)), 'neck', rng, 7500)

    # the worm: out of the belly, down, forward, up past the head, mouth to the front
    tip = np.array([.28, -.64, 2.62])
    ctrl = [wound + (0, .22, 0), wound + (.01, -.12, -.14), (.05, -.72, .9), (.12, -.87, 1.22), (.2, -.8, 1.66), (.27, -.56, 2.1), (.29, -.45, 2.4), tip + (0, .1, -.045), tip, tip + (0, -.3, 0)]
    segs, end = worm(rig, M, ctrl[:-1], LINKS, rng)
    last = segs[-1]
    worm_mouth(rig, M, f'extra_1_{LINKS + 1}', last[0], tip, .8 * last[3], rng)
    for name in ['extra_1'] + [f'extra_1_{i}' for i in range(2, LINKS + 1)]:
        rig.notes[name] = 'worm link'
    for idx, count in ((3, 4), (6, 3), (9, 3)):                     # slime off the underside
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
        boost={'head': 1.25, f'extra_1_{LINKS + 1}': 2.2, 'extra_2': 2.0, 'extra_3': 2.0, 'extra_4': 2.0, 'extra_5': 2.0},
        notes='It stands, slack, hung from the worm that came out of its belly; the costume is a puppet now. The head lolls on a broken neck '
              '(the 40 degree tilt is baked into neck and head) and should only swing loosely, never look at anything. The dead eyes each '
              f'carry one pinprick of eye_glow. The worm is the chain extra_1 (at the belly) to extra_1_{LINKS} with its head, the mouth, '
              f'as extra_1_{LINKS + 1}; each link turns about its joint with the one before. Idle: a slow travelling sway, 4 to 8 degrees per '
              'link about x and z with a phase lag down the chain, and a swallowing pulse (scale links 1.0 to 1.08 in sequence). The mouth '
              'faces forward and holds its gaze on the player while the body under it drifts. extra_2, extra_3, extra_4 are the three '
              'tooth rings (outer to inner): spin each about its local z, alternate directions. extra_5 is the second mouth down the '
              'throat: slide it out along +z by up to 0.22 m and back. Walk: the worm leads and the body is dragged: lean the first links '
              'forward, then let the legs catch up in short stiff steps (leg 15 degrees, shin 10), feet scraping, arms swinging dead from '
              'the shoulders a beat late. Attack: the worm rears back (links 8 to 12 pitch back 10 degrees each) then whips forward. '
              'Jumpscare: straighten the upper links toward the camera so the mouth fills the view, spin the rings fast, push extra_5 out. '
              'The inside of the mouth is modelled and textured to hold at close range. Limits: 25 degrees per worm link on any axis '
              'before the joints open; link 1 (extra_1) 15 degrees, it sits in the wound. Leg 30, shin 35, arm 50, forearm 45, neck 20, '
              'head 30.',
    )


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
    print('[tris]', {k: ntris(o) for k, o in obs.items()}, 'total', sum(ntris(o) for o in obs.values()))
    clock('joined')
    shade.unwrap(list(obs.values()), info['boost'])
    clock('unwrapped')
    shade.bake(list(obs.values()), name)
    clock('baked')
    for p in rig.parts:
        if p['glow']: obs[p['name']] = join([obs[p['name']]] + p['glow'], p['name'])
    root = empty('root')
    done, todo = {'root': root}, list(rig.parts)
    while todo:
        for p in list(todo):
            if p['parent'] in done:
                done[p['name']] = part(obs[p['name']], p['name'], done[p['parent']], p['pivot'])
                todo.remove(p)
    export_glb(name, [root])
    clock('exported')


def describe(rig, stage, info):
    """One stage's entry in rhino.json, measured from the exported file."""
    rep = report(f'{KEY}_{stage}')
    extras = '; '.join(f'{k}: {v}' for k, v in sorted(rig.notes.items()) if v != 'worm link')
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


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    which = [int(a) for a in args if a.isdigit()] or [0, 1, 2]
    path = os.path.join(MODELS, KEY + '.json')
    doc = json.load(open(path)) if os.path.exists(path) else dict(key=KEY, stages=[None, None, None])
    failed = []
    for stage in which:
        try:   # one stage failing should not cost the others their turn in the Blender queue
            reset()
            rig = Rig()
            clock('start')
            info = STAGES[stage](rig, np.random.default_rng(100 + stage))
            clock('sculpted')
            finalize(rig, stage, info)
            doc['stages'][stage] = describe(rig, stage, info)
            json.dump(doc, open(path, 'w'), indent=1)
            if 'fast' not in args: looks(stage, info)
            clock('previews')
        except Exception:
            traceback.print_exc()
            failed.append(stage)
    print('[done]', which, 'failed', failed, flush=True)
    if failed: sys.exit(1)


main()
