# The night guard, as other players see them: 1.8 m with the cap, soft in the
# middle, heavy-lidded, a torch held out in the right hand.
#
# Parts follow the mascot naming rules in ../README.md: root (empty) > body
# (pivot at the pelvis) > head (neck), arm_L and arm_R (shoulder), leg_L and
# leg_R (hip). _L is the guard's own left, +X. Each part runs well into its
# neighbour so a 40 degree turn opens no gap. The game flattens a caught guard
# by scaling root in height; every part is a closed rigid solid hanging off
# root, so that squashes cleanly.
import math
from mathutils import Matrix
from common import empty, part
from kit import Mesh, peaked_cap, torch

# The figure is laid out below at about 1.84 m, cap included. K brings every
# part and pivot down to the 1.8 m the game expects.
K = 1.8 / 1.842

SHIRT = '#34405c'
TROUSER = '#2e323c'
SKIN = '#d6a184'
SKIN_RED = '#c98670'
HAIR = '#5f5a54'
LEATHER = '#1a1a1c'

PELVIS = (0, 0, .95)
NECK = (0, .01, 1.5)
HIP = .105                      # half the distance between the hip joints
SHOULDER = (.235, .01, 1.42)

# The torso as (z, centre y, half width, half depth): a pot belly carried on
# tired hips, shoulders rolled forward.
TORSO = [(.97, -.01, .2, .155), (1.07, -.045, .218, .19), (1.18, -.04, .212, .178), (1.3, -.012, .215, .14), (1.4, .008, .205, .115), (1.47, .014, .13, .09)]


def new(seed):
    m = Mesh(seed)
    m.M = Matrix.Diagonal((K, K, K, 1))
    return m


def front_y(z):
    """Where the shirt front is at height z (for placing buttons and badge)."""
    for (z0, c0, _, d0), (z1, c1, _, d1) in zip(TORSO, TORSO[1:]):
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0)
            return (c0 - d0) * (1 - t) + (c1 - d1) * t
    return TORSO[-1][1] - TORSO[-1][3]


def body():
    m = new(51)
    m.loft([((0, 0, .86), .19, .135), ((0, -.005, .93), .21, .155), ((0, -.02, 1.02), .207, .167)], 'fabric', TROUSER, n=18, steps=3, power=2.3)
    n0 = len(m.bm.verts)
    m.loft([((0, c, z), w, d) for z, c, w, d in TORSO], 'fabric', SHIRT, n=20, steps=4, power=2.3)
    m.crumple(.006, .09, 6, since=n0)
    # belt, slung under the belly
    with m.at((0, -.018, 1.0), r=(9, 0, 0), scale=(1, .82, 1)):
        m.lathe([(.209, -.022), (.214, -.02), (.214, .02), (.209, .022)], 'rubber', LEATHER, n=24, caps=(False, False))
    m.box((0, -.205, .972), (.055, .012, .045), 'chrome', '#b0a070', bevel=.004, cell=1)
    # placket and buttons following the belly
    zs = [1.02 + i * .05 for i in range(10)]
    m.loft([((0, front_y(z) - .004, z), .016, .003) for z in zs], 'fabric', '#2c3650', n=6, steps=2, ends=(False, False))
    for z in zs[1:-1:2]: m.ball((0, front_y(z) - .01, z), .007, 'plastic', '#c8c4b4', n=6, m=3)
    # collar
    for s in (-1, 1):
        m.loft([((s * .02, -.062, 1.455), .012, .028), ((s * .075, -.045, 1.475), .012, .034), ((s * .1, .0, 1.485), .01, .03)], 'fabric', '#2c3650', n=6, steps=2)
        m.box((s * .135, .012, 1.456), (.07, .045, .008), 'fabric', '#2c3650', bevel=.003, cell=1)           # epaulettes
        m.ball((s * .11, .012, 1.462), .006, 'plastic', '#c8c4b4', n=6, m=3)
    # badge on the guard's left breast, name tape and a pocket flap on the right
    shield = [(.5, 0), (.92, .28), (1, 1), (.5, .9), (0, 1), (.08, .28)]
    m.shape('badge', (.105, -.137, 1.335), .062, .07, shield, n=(.3, -1, .12), off=.004)
    with m.at((-.105, -.137, 1.34), r=(-4, 0, -16)): m.box((0, 0, 0), (.08, .005, .02), 'plastic', '#d8d2c0', cell=1)
    with m.at((-.105, -.136, 1.295), r=(-6, 0, -16)): m.box((0, 0, 0), (.09, .006, .03), 'fabric', '#2c3650', bevel=.002, cell=1)
    # radio on the right hip, aerial up
    with m.at((-.222, -.03, 1.01), r=(0, -6, 8)):
        m.box((0, 0, 0), (.04, .065, .115), 'plastic', '#222326', bevel=.006, cell=1)
        m.decal('radio', (-.02, 0, 0), .058, .1, n=(-1, 0, 0), off=.0008)
        m.cyl((0, .018, .055), (0, .018, .15), .005, 'rubber', '#151516', n=6)
        m.cyl((0, -.016, .055), (0, -.016, .07), .008, 'plastic', '#151516', n=8)
    # keys on the left
    with m.at((.2, -.09, .955), r=(0, 90, 30)):
        m.torus(.016, .0018, 'chrome', n=10, m=4)
        for i in range(3):
            with m.at((0, -.016, 0), r=(0, 0, -25 + i * 25)): m.box((0, -.022, i * .002), (.008, .04, .0015), 'chrome', '#b8a060', cell=1)
    m.box((.11, -.185, .985), (.07, .03, .06), 'rubber', LEATHER, bevel=.006, cell=1)                       # belt pouch
    return m


def head():
    m = new(52); m.density = 2
    m.cyl((0, .015, 1.42), (0, .0, 1.57), .056, 'skin', '#c99578', n=14)
    # skull and jaw: wide at the jowls, narrowing to the crown
    m.loft([((0, -.012, 1.555), .078, .08), ((0, -.02, 1.6), .098, .104), ((0, -.016, 1.66), .1, .108), ((0, -.006, 1.715), .096, .104), ((0, 0, 1.745), .078, .084)], 'skin', SKIN, n=20, steps=4, power=2.2)
    m.ball((0, -.1, 1.558), (.045, .032, .03), 'skin', '#c79a82', n=12, m=6)                              # chin, blue with stubble
    for s in (-1, 1):
        m.ball((s * .05, -.066, 1.584), (.034, .042, .034), 'skin', SKIN, n=12, m=6)                   # jowls
        m.ball((s * .098, .004, 1.655), (.01, .02, .03), 'skin', '#cf977c', n=10, m=6)                     # ears
        # eyes: a tired white, a dark iris looking a little down, a heavy lid and a bag under it
        ex, ey, ez = s * .037, -.103, 1.683
        m.ball((ex, ey, ez), (.0175, .014, .014), 'skin', '#d8d2c0', n=12, m=6)
        m.ball((ex - s * .002, ey - .0105, ez - .003), (.0075, .005, .0075), 'flat', '#1c1410', n=8, m=4)
        m.ball((ex, ey - .001, ez + .0005), (.0195, .0155, .0155), 'skin', '#bd8a72', n=12, m=5, zrange=(.3, 1))
        m.loft([((ex - s * .018, ey - .004, ez - .012), .005, .005), ((ex, ey - .012, ez - .019), .007, .006), ((ex + s * .018, ey - .003, ez - .012), .005, .005)], 'skin', '#bb8a78', n=6, steps=3)
        # eyebrows, tilted up in the middle: permanently worried
        m.loft([((s * .064, -.098, 1.704), .005, .005), ((s * .04, -.114, 1.712), .007, .006), ((s * .014, -.118, 1.716), .005, .005)], 'fabric', '#3d3028', n=6, steps=3)
        # moustache
        m.loft([((s * .004, -.133, 1.617), .012, .011), ((s * .028, -.127, 1.608), .013, .011), ((s * .052, -.11, 1.59), .006, .006)], 'fabric', '#4a3a2c', n=8, steps=3)
        m.loft([((s * .085, -.03, 1.69), .008, .02), ((s * .092, -.035, 1.64), .007, .016)], 'fabric', HAIR, n=6, steps=2)   # sideburns
    m.loft([((0, -.118, 1.7), .012, .01), ((0, -.132, 1.665), .014, .012), ((0, -.142, 1.64), .02, .016)], 'skin', SKIN, n=8, steps=3)   # bridge
    m.ball((0, -.146, 1.632), (.026, .028, .024), 'skin', SKIN_RED, n=12, m=7)                             # the nose
    m.box((0, -.118, 1.586), (.05, .012, .006), 'flat', '#3a1c18', cell=1)                                 # mouth, mostly under the moustache
    with m.at((0, -.01, 1.66), scale=(1, 1.08, 1)):                                                        # what hair is left, round the back
        m.lathe([(.097, -.05), (.103, -.025), (.104, .02), (.101, .055)], 'fabric', HAIR, n=12, arc=(10, 170), caps=(False, False))
    with m.at((0, -.008, 1.716), r=(-7, 0, 3)): peaked_cap(m)
    return m


def hand(m, wrist, s):
    """An open hand hanging from `wrist`, palm to the thigh. s is the side."""
    x, y, z = wrist
    m.loft([((x, y, z + .02), .024, .032), ((x, y - .006, z - .03), .02, .043), ((x - s * .004, y - .01, z - .075), .016, .04)], 'skin', SKIN, n=10, steps=3)
    for i in range(4):
        fy = y - .01 + (i - 1.5) * .021
        m.loft([((x - s * .004, fy, z - .07), .009, .0095), ((x - s * .012, fy - .004, z - .11), .0085, .009), ((x - s * .026, fy - .006, z - .14 + abs(i - 1.5) * .008), .0075, .008)], 'skin', SKIN, n=6, steps=2)
    m.loft([((x - s * .006, y - .04, z - .02), .011, .012), ((x - s * .014, y - .06, z - .055), .01, .01), ((x - s * .02, y - .064, z - .085), .008, .008)], 'skin', SKIN, n=6, steps=2)


def arm_left():
    m = new(53)
    sx, sy, sz = SHOULDER
    m.loft([((sx - .03, sy, sz), .07, .07), ((sx + .035, sy, sz - .13), .058, .062), ((sx + .045, sy + .012, sz - .28), .05, .053), ((sx + .04, sy - .012, sz - .44), .043, .046), ((sx + .03, sy - .03, sz - .55), .037, .04)],
           'fabric', SHIRT, n=14, steps=4)
    m.lathe([(.04, -.012), (.043, -.01), (.043, .012), (.04, .014)], 'fabric', '#2c3650', n=12, at=(sx + .03, sy - .03, sz - .555), caps=(False, False))   # cuff
    m.crumple(.004, .06, 7)
    m.decal('patch', (sx + .095, sy, sz - .14), .075, .075, n=(1, 0, .22), off=.003)
    hand(m, (sx + .028, sy - .034, sz - .58), 1)
    return m


def arm_right():
    m = new(54)
    sx, sy, sz = -SHOULDER[0], SHOULDER[1], SHOULDER[2]
    grip = (sx - .012, -.36, 1.15)                                     # where the torch sits
    m.loft([((sx + .03, sy, sz), .07, .07), ((sx - .032, sy, sz - .13), .058, .062), ((sx - .04, sy - .0, sz - .255), .052, .054), ((sx - .034, sy - .1, sz - .285), .046, .046), ((sx - .018, sy - .26, sz - .272), .038, .038)],
           'fabric', SHIRT, n=14, steps=4)
    with m.at((sx - .017, sy - .268, sz - .272), r=(90, 0, 0)):
        m.lathe([(.041, -.012), (.044, -.01), (.044, .012), (.041, .014)], 'fabric', '#2c3650', n=12, caps=(False, False))
    m.crumple(.004, .06, 8)
    m.decal('patch', (sx - .095, sy, sz - .14), .075, .075, n=(-1, 0, .22), off=.003)
    # fist round the torch: the back of the hand, four fingers curling under, thumb over the top
    gx, gy, gz = grip
    m.loft([((gx, gy + .09, gz + .002), .03, .03), ((gx - .004, gy + .04, gz + .004), .036, .03), ((gx - .006, gy - .012, gz + .004), .034, .028)], 'skin', SKIN, n=10, steps=3)
    for i in range(4):
        fy = gy + .034 - i * .021
        pts = [(gx - .024 + math.cos(a) * .03, fy, gz - .002 + math.sin(a) * .03) for a in [math.radians(d) for d in (165, 215, 265, 315, 360)]]
        m.loft([(p, .0105, .01) for p in pts], 'skin', SKIN, n=6, steps=3)
    m.loft([((gx + .012, gy + .05, gz + .016), .012, .011), ((gx + .016, gy + .01, gz + .024), .011, .01), ((gx + .01, gy - .02, gz + .026), .009, .008)], 'skin', SKIN, n=6, steps=2)
    with m.at((gx, gy, gz)): torch(m, n=12)
    return m


def leg(s):
    m = new(55 + s)
    x = s * HIP
    m.loft([((x, 0, .97), .11, .12), ((x * 1.06, 0, .8), .108, .115), ((x * 1.08, -.014, .52), .084, .088), ((x * 1.1, .008, .3), .074, .078), ((x * 1.12, .012, .13), .08, .086)],
           'fabric', TROUSER, n=12, steps=4, ends=(True, False))
    m.crumple(.005, .07, 9 + s)
    bx = x * 1.12
    m.loft([((bx, .012, .2), .066, .072), ((bx, .01, .09), .064, .07)], 'rubber', LEATHER, n=12, steps=2, ends=(False, False))     # boot shaft
    m.loft([((bx, .075, .058), .058, .054), ((bx, -.02, .055), .064, .052), ((bx + s * .008, -.12, .048), .064, .044), ((bx + s * .01, -.165, .042), .052, .034)], 'rubber', LEATHER, n=12, steps=3, power=2.6)
    m.box((bx + s * .004, -.04, .013), (.122, .32, .026), 'rubber', '#101011', bevel=.008, cell=.1)                              # sole
    for i in range(3): m.cyl((bx - .02, -.07 - i * .025, .09 - i * .012), (bx + .02, -.07 - i * .025, .09 - i * .012), .003, 'fabric', '#6a6458', n=4)   # laces
    return m


def build():
    """Build the guard in the current scene and return the root."""
    g = dict(dist=.12, dirt=.18)
    root = empty('root')
    k = lambda p: tuple(v * K for v in p)
    b = part(body().object('body', **g), 'body', root, pivot=k(PELVIS))
    part(head().object('head', dist=.06, dirt=.08, ao=.5), 'head', b, pivot=k(NECK))
    part(arm_left().object('arm_L', **g), 'arm_L', b, pivot=k(SHOULDER))
    part(arm_right().object('arm_R', **g), 'arm_R', b, pivot=k((-SHOULDER[0], SHOULDER[1], SHOULDER[2])))
    for s, name in ((1, 'leg_L'), (-1, 'leg_R')):
        part(leg(s).object(name, ground=.25, **g), name, b, pivot=k((s * HIP, 0, .92)))
    return root
