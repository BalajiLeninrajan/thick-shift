# Stompy at rot stage 2, a second take: the costume bent over backwards into
# a bridge, belly to the ceiling, hands and feet flat on the floor, with the
# worm standing straight up out of the belly and the head hanging off a
# snapped neck underneath. A candidate to replace the stage 2 in
# tools/models/rhino/, which stands the costume up like a puppet.
#
#   tools/models/bl tools/models/rhino_crab/build.py           build, export, previews
#   tools/models/bl tools/models/rhino_crab/build.py -- fast   skip the previews
#   tools/models/bl tools/models/rhino_crab/build.py -- sketch skip the bake too (grey shapes, for blocking out)
#
# Writes packages/game/public/models/rhino_2.glb and the stage 2 entry of
# rhino.json. Everything that makes the rhino look like the rhino (the
# Clay sculpting, the hide and worm materials, the head, hands, worm and its
# mouth, the bake) comes from tools/models/rhino/; this file only lays the
# parts out in the new pose.
import sys, os, json, math
HERE = os.path.dirname(os.path.abspath(__file__))
RHINO = os.path.join(os.path.dirname(HERE), 'rhino')
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, RHINO)
import numpy as np
from mathutils import Vector, Matrix
from common import *
from sculpt import *
from parts import *
import shade


def _rhino_build():
    """The helpers in rhino/build.py (materials, thin_limb, finalize,
    describe, looks), without running its main(). That file is a script, not
    a module, and it is not ours to edit."""
    path = os.path.join(RHINO, 'build.py')
    src = open(path).read().rstrip()
    assert src.endswith('\nmain()'), 'rhino/build.py no longer ends in main(); update _rhino_build'
    ns = dict(__file__=path, __name__='rhino_build')
    exec(compile(src[:-len('main()')], path, 'exec'), ns)
    return ns


RB = _rhino_build()
STAGE, LINKS = 2, 12


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def rot_between(a, b):
    return Vector(unit(a)).rotation_difference(Vector(unit(b))).to_matrix().to_4x4()


def about(c, m4):
    """Matrix m4 applied about the point c."""
    return Matrix.Translation(Vector(c)) @ m4 @ Matrix.Translation(-Vector(c))


def ribs_bridge(body, centre, radii, frame, depth=.016, spacing=.085):
    """rhino/build.py's ribs() for a ribcage that is not upright. frame is
    the ribcage's own axes as world vectors, columns (x, y, z) with -y the
    breastbone side and +z toward the neck, as in the upright one."""
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


# ---------- the pose ----------
# Blender axes: z up, the front (where the worm's mouth and the hanging head
# face) at -y. The head end of the bridge is at the front.

KINK = np.array([-.02, -.74, .95])        # where the neck broke
PY, PZ = .42, .92                      # the pelvis, the body's pivot
TILT = .75                              # the ribcage dips toward the head end


def crab(rig, rng):
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
    ribs_bridge(body, rc, rr, frame)
    surf = Surface(body)
    for y in np.linspace(-.5, .4, 12):                              # the spine, along the underside of the arch
        hit, _ = surf.ray((0, y, -1), (0, 0, 1))
        if hit is not None: dent(body, hit, .032, -.028)
    roughen(body, .007, 8, seed=6)
    wound, _ = Surface(body).ray((0, .08, 3), (0, 0, -1))
    dent(body, wound, .19, .13)                                     # the hole, open to the ceiling
    wc = wound + np.array([0, 0, -.08])
    M = RB['materials'](STAGE,
                        body=dict(pale=[((0, -.2, 1.45), (.25, .42, .3))],
                                  blood=[(tuple(wound + (.2, .05, -.06)), .12), (tuple(wound + (-.16, -.2, -.04)), .1), ((.1, -.42, 1.08), .09)],
                                  meat=[(tuple(wc), (.23, .29, .2))]),
                        limb=dict(blood=[((-.5, -.62, .4), .1), ((.42, .6, .7), .12), (KINK, .08)], meat=[(KINK, (.07, .06, .08))]),
                        head=dict(pale=[((0, -.46, .17), (.34, .32, .22))], blood=[((.05, -.62, .1), .07)],
                                  tears=[((sx * EYE_X + sx * .01, -.42, EYE_Z - .08), .3 if sx > 0 else .38) for sx in (1, -1)],
                                  sockets=[((sx * EYE_X, -.45, EYE_Z), .15) for sx in (1, -1)]),
                        links=LINKS, rng=rng)
    fit = zipper_under(body, M, -.48, .4)
    RB['tail'](rig, body, M, PZ - .08, 2, rng)
    keep_bare = lambda p, n: ~((np.abs(p[:, 0]) < .34) & (p[:, 2] > 1.25) & (p[:, 1] > -.45) & (p[:, 1] < .45))
    tf = tufts(body, 200, .085, rng, keep_bare, width=.017, droop=1.0)
    decimate(body, 8500)
    pieces = mat([body, tf], M['body']) + fit

    # The plush that held the big hips, hanging off the pelvis in slack folds
    # toward the floor (rhino/build.py's stage 2 has the same, for a standing body).
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
        rig.add('arm_' + side, 'body', sh, RB['thin_limb'](M, rng, [sh, el], [.085, .06], [(sh, .1), (el, .072)], 800, 'upper', tuft=22))
        hand_at = (wr, (sx * .3, 1, .25), (-sx, 0, .1), dict(size=1.15, curl=(0, 0, -.55), spread=.22))
        rig.add('forearm_' + side, 'arm_' + side, el,
                RB['thin_limb'](M, rng, [el, wr], [.062, .046], [(el, .068), (wr, .05)], 2000, 'fore', hand_at=hand_at, tuft=14, voxel=.006))
        # Legs: thighs drop from the pelvis to knees a little lower and further
        # back, shins stand on the feet. Knock-kneed and uneven, one foot
        # turned right out.
        hip = np.array([sx * .2, PY + .06, PZ - .05])
        knee = np.array([.56, .74, .74]) if sx > 0 else np.array([-.46, .8, .8])
        ankle = np.array([sx * .6, .76, .14])
        toes = (.6, 1) if sx > 0 else (-1, .3)
        rig.add('leg_' + side, 'body', hip, RB['thin_limb'](M, rng, [hip, hip + (knee - hip) * .4, knee], [.15, .11, .085], [(knee, .1)], 1000, 'thigh', tuft=24))
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
    head(rig, M, STAGE, Th, "neck", rng, 6500)
    aim_eyes(rig, Th, n0)
    for p in rig.parts[n0:]:   # head() writes these for a head the right way up
        if p['name'].startswith('sway_'):
            rig.notes[p['name']] = 'black strands hanging off the upside-down face toward the floor, some clotted with blood'

    # ---------- the worm ----------
    # Straight up out of the belly, a little back, then over in a hook so the
    # mouth comes to face forward at a standing player's head height.
    tip = np.array([.02, -.46, 2.55])
    ctrl = [wound - (0, 0, .22), wound + (0, 0, .1), (-.05, .15, 1.9), (-.03, .24, 2.2), (.02, .17, 2.48), (.03, -.04, 2.66), (.03, -.27, 2.64), tip, tip + (0, -.3, 0)]
    segs, end = worm(rig, M, ctrl[:-1], LINKS, rng, r0=.23, r1=.15)
    worm_mouth(rig, M, f'extra_1_{LINKS + 1}', segs[-1][0], tip, .8 * segs[-1][3], rng)
    for name in ['extra_1'] + [f'extra_1_{i}' for i in range(2, LINKS + 1)]:
        rig.notes[name] = 'worm link'
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
        notes=NOTES,
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


NOTES = (
    'Bent over backwards into a bridge, the yoga wheel: belly to the ceiling, hands and feet flat on the floor. The hands are at the '
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
    'neck 20, head 35.'
)


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if 'sketch' in args:   # blocking out: no atlas, no bake, grey clay
        def clay(objs, key, **kw):
            m = bpy.data.materials.new('clay'); m.use_nodes = True
            m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (.18, .17, .16, 1)
            for o in objs: o.data.materials.clear(); o.data.materials.append(m)
        shade.unwrap = lambda objs, boost=None: None
        shade.bake = clay
    reset()
    rig = Rig()
    RB['clock']('start')
    info = crab(rig, np.random.default_rng(102))
    RB['clock']('sculpted')
    RB['finalize'](rig, STAGE, info)
    path = os.path.join(MODELS, 'rhino.json')
    doc = json.load(open(path))
    doc['stages'][STAGE] = RB['describe'](rig, STAGE, info)
    json.dump(doc, open(path, 'w'), indent=1)
    if not ({'fast', 'sketch'} & set(args)): RB['looks'](STAGE, info)
    elif 'sketch' in args:
        preview(f'rhino_{STAGE}', views=('front', 'three_quarter', 'side', 'low'), res=448, samples=8, light='studio')
    RB['clock']('done')


main()
