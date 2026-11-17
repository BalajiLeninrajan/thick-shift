# Stage and backstage props. Front is -Y, sizes in metres.
import math
from mathutils import Vector, noise
from kit import prop, hexc, mixc, xf, D
import atlas

BLACK = (.1, .1, .11)
STEEL = (.8, .8, .82)
# The four mascots' fur, faded: hippo, walrus, toad, rhino. Then two that never made it on stage.
FUR = [hexc('#9a7fc4'), hexc('#b98a6e'), hexc('#5f8f66'), hexc('#7d8299'), (.78, .66, .3), (.8, .52, .6)]
BELLY = [hexc('#e6c8ee'), hexc('#f5e0dc'), hexc('#cfe2a8'), hexc('#a6adc8'), (.9, .85, .6), (.93, .8, .85)]


def faded(c, k=.35):
    g = sum(c) / 3
    return tuple(v * (1 - k) + (g * .7 + .25) * k for v in c)


@prop('curtain', mount='ceiling', notes='Origin is the centre of the top edge; hangs 3.4 m. One skin, drawn double sided. Tile several side by side for a wider drape.')
def curtain(p):
    W, H = 3.0, 3.4

    def fold(u):   # irregular pleats, deep enough to hide a hand in
        return .13 * math.sin(u * 56 + 1.4 * math.sin(u * 7)) + .045 * math.sin(u * 143 + 2)

    def hem(u):    # the moths took the bottom unevenly
        return .16 * abs(noise.noise(Vector((u * 7, 0, 3)))) + .07 * abs(noise.noise(Vector((u * 41, 1, 0))))

    def f(u, v):
        zb = -H + hem(u)
        spread = .5 + .5 * (1 - v) ** .6   # gathered tight on the tape, opening toward the floor
        return ((u - .5) * W + .03 * noise.noise(Vector((u * 3, v * 2, 5))) * (1 - v), fold(u) * spread + .05 * noise.noise(Vector((u * 4, v * 3, 0))), zb * (1 - v) - .06 * v)

    def holes(u, v):
        return not (v < .2 and noise.noise(Vector((u * 34, v * 22, 8))) > .32 + v * 1.6)

    def col(w):
        depth = (w.y + .15) / .3            # 0 at the front of a pleat, 1 at the back
        k = 1.05 - .5 * max(0, min(1, depth))
        low = max(0, min(1, (-w.z - 2.6) / .8))
        dust = max(0, min(1, (w.z + .9) / .9)) * (1 - .6 * max(0, min(1, depth)))   # grey on the folds near the rail
        return mixc(mixc((.62 * k, .07 * k, .08 * k), (.2, .09, .06), low * .6), (.42, .38, .36), dust * .4)

    p.sheet(f, 100, 22, size=(4.6, H), keep=holes, t='velvet', c=col)
    p.box((W, .012, .07), (0, 0, -.045), t='velvet', c=(.5, .4, .2), ts=.2)      # the heading tape
    for i in range(13):
        x = (i - 6) * W / 12.4
        p.ring(.022, .004, (x, 0, -.012), rot=(90, 0, 70), n=8, segs=3, t='steel', c=(.6, .55, .4))


@prop('stage_light', mount='ceiling', notes='Origin is the top of the clamp, which hooks a 48 mm bar. The can points forward and 35 degrees down. Lens is lamp_glow.')
def stage_light(p):
    dark = dict(t='paint', c=(.14, .14, .15), ts=.3)
    # hook clamp, open toward +Y
    hook = [(0, .0 + .034 * math.sin(a), -.034 + .034 * math.cos(a)) for a in [D(d) for d in range(-150, 100, 25)]]
    p.tube(hook, (.02, .007), segs=6, up=(1, 0, 0), **dark)
    p.cyl(.006, .06, (0, .05, -.05), rot=(90, 0, 0), segs=6, t='steel', c=STEEL)          # the clamp screw
    p.ring(.018, .005, (0, .058, -.05), rot=(90, 0, 0), n=6, segs=3, t='steel', c=STEEL)
    p.cyl(.012, .07, (0, 0, -.14), segs=8, t='steel', c=(.5, .5, .5))
    # yoke
    yoke = [(-.135, 0, -.33), (-.135, 0, -.17), (-.11, 0, -.14), (.11, 0, -.14), (.135, 0, -.17), (.135, 0, -.33)]
    p.tube(yoke, (.004, .02), segs=4, up=(0, 1, 0), **dark)
    for s in (-1, 1):
        p.cyl(.022, .02, (s * .15, 0, -.31), rot=(0, s * 90, 0), segs=8, t='plastic', c=BLACK)   # tilt knobs
    with p.place((0, 0, -.31), rot=(35, 0, 0)):
        # the can lies along local -Y (front); built along z and laid over
        prof = [(0, .2), (.06, .195), (.1, .16), (.115, .1), (.12, -.16), (.128, -.165), (.128, -.2), (.112, -.2), (.108, -.17)]
        p.lathe(prof, rot=(-90, 0, 0), segs=20, **dark)
        p.lathe([(0, -.168), (.07, -.17), (.108, -.176)], rot=(-90, 0, 0), segs=16, m='lamp_glow')   # lens, set back in the rim
        for i in range(6):   # cooling slots at the back
            a = D(i * 60)
            p.box((.012, .05, .004), (.1 * math.cos(a), .17, .1 * math.sin(a)), rot=(0, -math.degrees(a) + 90, 0), t='plastic', c=(.02, .02, .02))
        # gel frame, bent, with a scrap of gel left in it
        for q in (((.25, .006, .012), (0, -.21, .125)), ((.25, .006, .012), (0, -.21, -.125)), ((.012, .006, .25), (.125, -.21, 0)), ((.012, .006, .25), (-.125, -.21, 0))):
            p.box(q[0], q[1], rot=(4, 0, 2), **dark)
        p.add([(-.12, -.212, -.12), (.03, -.212, -.12), (-.02, -.214, .02), (-.12, -.212, .06)], [[0, 1, 2, 3]], m='glass')
        cable = [(0, .2, -.02), (0, .27, -.04), (.02, .31, -.12), (.05, .3, -.3), (.03, .27, -.42)]
        p.tube(cable, .008, segs=5, t='plastic', c=BLACK)
    p.tube([(0, .02, -.1), (.05, .05, -.2), (.02, .1, -.26), (0, .03, -.12)], .003, segs=3, t='steel', c=STEEL)   # safety wire


@prop('speaker', notes='PA speaker on a tripod. The legs reach 0.45 m from the pole, so the feet span 0.9 m. Keep it off the walls.')
def speaker(p):
    dark = dict(t='plastic', c=(.12, .12, .13))
    for i in range(3):
        a = D(90 + i * 120)
        foot = (math.cos(a) * .45, math.sin(a) * .45, .015)
        p.tube([foot, (math.cos(a) * .03, math.sin(a) * .03, .5)], .013, segs=6, t='paint', c=(.13, .13, .14))
        p.tube([(math.cos(a) * .24, math.sin(a) * .24, .245), (math.cos(a) * .03, math.sin(a) * .03, .2)], .008, segs=4, t='paint', c=(.13, .13, .14))
        p.ball((.03, .03, .018), foot, segs=8, rings=4, t='vinyl', c=BLACK)
    p.cyl(.02, 1.0, (0, 0, .15), segs=8, t='steel', c=(.55, .55, .56))
    p.cyl(.03, .08, (0, 0, .46), segs=8, **dark)
    p.cyl(.03, .06, (0, 0, .2), segs=8, **dark)
    p.ball((.022, .022, .022), (.045, 0, .5), segs=6, rings=4, **dark)        # the height knob
    # cabinet: a wedge, narrower at the back, leaning a little because the knob slipped
    with p.place((0, 0, 1.08), rot=(-4, 3, 6)):
        w, d, h, wb = .36, .3, .52, .24
        vs = [(-w / 2, -d / 2, 0), (w / 2, -d / 2, 0), (wb / 2, d / 2, 0), (-wb / 2, d / 2, 0),
              (-w / 2, -d / 2, h), (w / 2, -d / 2, h), (wb / 2, d / 2, h), (-wb / 2, d / 2, h)]
        p.add(vs, [[0, 3, 2, 1], [4, 5, 6, 7], [1, 2, 6, 5], [3, 0, 4, 7], [2, 3, 7, 6]], t='plastic', c=(.15, .15, .16), ts=.35)
        p.add(vs, [[0, 1, 5, 4]], t='plastic', c=(.05, .05, .05))
        # baffle: a woofer cone and a horn, behind a dented grille
        p.lathe([(.04, .05), (.06, .02), (.125, 0), (.14, -.008)], (0, -d / 2 + .03, .17), rot=(-90, 0, 0), segs=14, t='paper', c=(.12, .12, .12))
        p.ball((.04, .04, .025), (0, -d / 2 + .06, .17), rot=(90, 0, 0), segs=8, rings=4, t='plastic', c=(.06, .06, .06))
        with p.place((0, -d / 2 + .02, .4), rot=(-90, 0, 0), scale=(1, .6, 1)):     # the horn: a flared rectangle
            p.lathe([(.03, .06), (.05, .02), (.12, 0)], rot=(0, 0, 45), segs=4, **dark)

        def grille(u, v):
            dent = .035 * math.exp(-((u - .62) ** 2 + (v - .3) ** 2) / .02)
            return ((u - .5) * (w - .03), -d / 2 - .012 + dent - .01 * math.sin(u * math.pi), .015 + v * (h - .03))
        p.sheet(grille, 10, 12, size=(w, h), t='grille', c=(.3, .3, .32), ts=.12)
        for x in (-1, 1):
            for z in (0, 1):
                p.ball((.03, .03, .03), (x * (w / 2 - .01), -d / 2, z * h), segs=6, rings=4, **dark)
        p.tube([(-wb / 2 - .02, .05, .2), (-wb / 2 - .06, .05, .23), (-wb / 2 - .06, .05, .33), (-wb / 2 - .02, .05, .36)], .012, segs=5, **dark)   # carry handle
        cab = [(0, d / 2, .1), (0, d / 2 + .06, .08), (.02, d / 2 + .09, -.1)]
        p.tube(cab, .007, segs=5, caps=False, **dark)
    # the lead runs down and lies coiled on the floor
    lead = [(.02, .24, .98), (.03, .2, .6), (.1, .22, .2), (.2, .3, .012)]
    for i in range(22):
        a = i * .7
        lead.append((.2 + .09 * math.sin(a) + i * .003, .42 + .1 * math.cos(a), .012 + (i % 5) * .003))
    p.tube(lead, .007, segs=5, **dark)


# ---------------------------------------------------------------- costumes

def suit(p, kind, fat=1., full=False, slip=0., tall=1.):
    """An empty fur suit on a hanger. Local origin is the rail (the hanger
    hooks over it), front toward -Y. full: it hangs the way a filled suit
    would, round, with the feet on the floor."""
    fur, belly = faded(FUR[kind], .2), faded(BELLY[kind], .25)
    inv = p.M.inverted()
    ry = (1.75 if full else 1.) * fat

    def col(w):
        q = inv @ w
        on_belly = q.y < 0 and ((q.x / .15) ** 2 + ((q.z + .68) / .27) ** 2) < 1 and abs(q.x) < .2
        c = belly if on_belly else fur
        k = .8 + .2 * min(1, max(0, -q.y / .08 + .5))      # the side that faced the room is paler
        # long damp stains run down from the collar and pool at the seat and knees
        streak = noise.noise(Vector((q.x * 9, q.y * 9, q.z * 1.4)) + Vector((kind * 3.7, 0, 0)))
        pool = max(0, min(1, (-q.z - .7) / .25)) * max(0, min(1, 1 - abs(-q.z - 1.0) / .3))
        wet = max(0, min(1, (streak - .15) * 3)) * .55 + pool * .25
        k *= 1 - wet
        return (c[0] * k * (1 - .1 * wet), c[1] * k * (1 - .25 * wet), c[2] * k * (1 - .4 * wet))

    st = dict(t='fur', c=col)
    wire = dict(t='steel', c=(.7, .7, .72))
    p.tube([(0, 0, -.15), (0, 0, -.03), (0, .012, .022), (0, .03, .03), (0, .044, .012)], .0035, segs=4, **wire)
    p.tube([(-.25, 0, -.215), (-.1, 0, -.17), (0, 0, -.15), (.1, 0, -.17), (.25, 0, -.215)], (.012, .016), segs=5, t='wood', c=(.9, .85, .75))
    with p.place(rot=(0, slip, 0)):
        z = lambda v: v * tall
        spine = [(0, 0, -.15), (0, 0, -.2), (0, -.01, z(-.33)), (0, -.025 * ry, z(-.5)), (0, -.045 * ry, z(-.68)), (0, -.03 * ry, z(-.84)), (0, -.01, z(-.95)), (0, 0, z(-1.0))]
        rad = [(.085, .06), (.24, .07 * ry), (.25, .095 * ry), (.25, .105 * ry), (.275, .125 * ry), (.265, .11 * ry), (.22, .085 * ry), (.12, .06 * ry)]
        p.tube(spine, rad, segs=14, caps=(False, True), bump=(.022, 7), **st)
        p.ball((.08, .055, .02), (0, 0, -.2), segs=8, rings=3, t='velvet', c=(.02, .02, .02))     # nobody in the collar
        tuft = []
        for i in range(26):   # shag round the collar and over the shoulders
            a = i / 26 * 2 * math.pi
            tuft.append(((math.cos(a) * .1, math.sin(a) * .065, -.15), (math.cos(a), math.sin(a), .6)))
            tuft.append(((math.cos(a) * .22, math.sin(a) * .06 * ry, -.2), (math.cos(a) * .3, math.sin(a), .8)))
        for s in (-1, 1):
            out = .02 if not full else .07
            arm = [(s * .2, 0, -.21), (s * (.3 + out), -.005, -.3), (s * (.33 + out * 1.3), -.015, z(-.5)), (s * (.335 + out * 1.4), -.03, z(-.72)), (s * (.33 + out), -.04, z(-.9))]
            ar = [(.07, .07 * ry), (.08, .055 * ry), (.075, .05 * ry), (.07, .048 * ry), (.066, .045 * ry)]
            p.tube(arm, ar, segs=9, bump=(.014, 9), **st)
            hx, hz = arm[-1][0], arm[-1][2]
            mitt = dict(t='fur', c=mixc(belly, (.5, .45, .4), .3), ts=.3)
            p.ball((.075, .045 * ry, .09), (hx, -.045, hz - .06), segs=9, rings=6, bump=(.008, 14), **mitt)
            for k in range(4):   # stubby cartoon fingers, limp
                p.tube([(hx + (k - 1.5) * .034, -.05, hz - .1), (hx + (k - 1.5) * .04, -.055 - .01 * k, hz - .19 + abs(k - 1.5) * .02)], [.022, .017], segs=6, **mitt)
            for i in range(7):
                a = i / 7 * 2 * math.pi
                tuft.append(((hx + math.cos(a) * .07, -.04 + math.sin(a) * .05, hz), (math.cos(a), math.sin(a), -.4)))
            leg_x = s * .125
            if full:
                leg = [(leg_x, -.01, z(-.92)), (leg_x * 1.05, -.02, z(-1.2)), (leg_x * 1.1, -.01, z(-1.5)), (leg_x * 1.1, 0, -1.78)]
                lr = [(.13, .12), (.125, .12), (.11, .105), (.1, .095)]
                p.tube(leg, lr, segs=10, bump=(.012, 8), **st)
                p.ball((.105, .17, .07), (leg_x * 1.15, -.09, -1.79), rot=(0, 0, s * 12), segs=10, rings=6, bump=(.008, 9), **mitt)
            else:
                leg = [(leg_x, -.01, z(-.9)), (leg_x * 1.05, -.025, z(-1.15)), (leg_x * 1.1, -.02, z(-1.4)), (leg_x * 1.1, -.03, z(-1.56))]
                lr = [(.125, .07), (.12, .06), (.105, .055), (.09, .05)]
                p.tube(leg, lr, segs=10, bump=(.016, 8), **st)
                # feet hang toes down
                p.ball((.1, .065, .16), (leg_x * 1.1, -.045, z(-1.56) - .1), rot=(12, 0, s * 8), segs=10, rings=6, bump=(.008, 9), **mitt)
        p.tufts(tuft, length=.07, width=.014, c=fur)


@prop('costume_rack', notes='Four headless suits on a rolling rail, 1.8 m long; the sleeves reach about 0.05 m past each end. The third from the left hangs full and has its feet on the floor; the others are empty. Put it side on to a doorway so the row is seen from across the room.')
def costume_rack(p):
    chrome = dict(t='steel', c=(.75, .75, .78))
    for s in (-1, 1):
        x = s * .86
        p.tube([(x, -.28, .09), (x, .28, .09)], .016, segs=6, **chrome)
        p.tube([(x, 0, .09), (x, 0, 1.86)], .016, segs=6, **chrome)
        p.ball(.024, (x, 0, 1.87), segs=6, rings=4, **chrome)
        for y in (-.27, .27):
            p.cyl(.008, .04, (x, y, .055), segs=5, **chrome)
            p.cyl(.035, .026, (x - .013, y, .036), rot=(0, 90, 0), segs=10, t='vinyl', c=(.12, .12, .12))
    p.tube([(-.86, 0, 1.82), (0, 0, 1.812), (.86, 0, 1.82)], .014, segs=8, **chrome)      # the rail bows under the weight
    p.tube([(-.86, 0, .12), (.86, 0, .12)], .012, segs=6, **chrome)
    # packed close, as on a real rail, so the sleeves stay within the 1.8 m frame
    spots = [(-.5, 0, 6, 1., False, 5, 1.), (-.17, 1, -9, 1.08, False, -3, .96), (.18, 2, 4, 1., True, 0, 1.), (.5, 3, 9, .95, False, 6, 1.02)]
    for x, kind, yaw, fat, full, slip, tall in spots:
        with p.place((x, 0, 1.812 + .004 * abs(x)), rot=(0, 0, yaw)):
            suit(p, kind, fat, full, slip, tall)
    # two bare hangers and a paper tag
    for x in (-.4, .42):
        with p.place((x, 0, 1.815), rot=(0, 8, 30 if x > 0 else -20)):
            p.tube([(0, 0, -.12), (0, 0, -.03), (0, .012, .022), (0, .03, .03), (0, .044, .012)], .0035, segs=4, **chrome)
            p.tube([(-.2, 0, -.19), (0, 0, -.12), (.2, 0, -.19), (-.2, 0, -.19)], .0035, segs=4, **chrome)
    p.tube([(-.86, 0, 1.5), (-.9, -.02, 1.4)], .0015, segs=3, t='paper', c=(.8, .8, .7))
    p.quad([(-.94, -.02, 1.3), (-.86, -.03, 1.3), (-.86, -.03, 1.4), (-.94, -.02, 1.4)], t='paper', c=(.9, .85, .7), ts=.2)


# -------------------------------------------------------------------- heads

def eye(p, r, at, bad=False, missing=False, yaw=0., pitch=0., glass=True):
    """A moulded plastic costume eye, far too big, under a clear dome so it
    throws the torch back."""
    with p.place(at, rot=(90 + pitch, 0, yaw)):
        if missing:   # a socket, with the foam it was glued to
            p.lathe([(0, -r * .45), (r * .7, -r * .3), (r * 1.02, 0)], segs=10, t='vinyl', c=(.25, .2, .12), ts=.2)
            return
        dome = [(0, r * .5), (r * .5, r * .43), (r * .87, r * .25), (r, 0)]
        p.lathe(dome, segs=10, disc=True, rect='eye_bad' if bad else 'eye')
        if glass: p.lathe([(q[0] * 1.04, q[1] * 1.08) for q in dome], segs=10, m='glass')
        p.lathe([(r, 0), (r * 1.12, -.002), (r * 1.1, -r * .2)], segs=10, t='plastic', c=(.05, .05, .05))   # the rim


def smile(p, w, y, z, bend=.06, lift=.05, r=.014, teeth=0, c=(.12, .02, .03)):
    """A fixed grin: a dark welt along the front of the muzzle, from -w to w."""
    pts = [(w * t, y + bend * t * t, z + lift * t * t) for t in [i / 8 - 1 for i in range(17)]]
    p.tube(pts, [(r * (1.15 - .6 * abs(i / 8 - 1)), r * .6) for i in range(17)], segs=5, up=(0, -1, 0), t='vinyl', c=c, ts=.2)
    for i in range(teeth):   # human teeth, a neat row of them
        t = (i + .5) / teeth * 1.2 - .6
        p.box((w * 1.1 / teeth, .012, .03), (w * t, y + bend * t * t - .006, z + lift * t * t - .012), rot=(0, 0, -t * 25), bevel=.004, t='plastic', c=(.85, .8, .6), ts=.1)


def head(p, kind, damage=''):
    """A spare mascot head, sitting on its neck hole, facing -Y. About 0.5 m."""
    fur, belly = faded(FUR[kind], .2), faded(BELLY[kind], .2)
    st = dict(t='fur', c=fur, ts=.35)
    lite = dict(t='fur', c=belly, ts=.35)
    bad = 'eye_bad' in damage
    tuft = []

    def crown(n, rx, ry, z):
        for i in range(n):
            a = i / n * 2 * math.pi
            tuft.append(((math.cos(a) * rx, math.sin(a) * ry, z), (math.cos(a), math.sin(a), 1.5)))

    if kind == 0:     # hippo: a barrel of a muzzle and two peg teeth
        p.ball((.25, .24, .23), (0, 0, .25), segs=12, rings=8, bump=(.012, 6), **st)
        p.ball((.25, .17, .15), (0, -.2, .15), segs=12, rings=7, bump=(.008, 7), **lite)
        for s in (-1, 1):
            p.ball((.055, .03, .06), (s * .17, .02, .47), segs=8, rings=5, **st)
            p.ball((.028, .02, .02), (s * .07, -.33, .22), segs=6, rings=4, t='vinyl', c=(.1, .05, .08))
            p.box((.045, .03, .06), (s * .1, -.3, .03), rot=(8, 0, s * 6), bevel=.008, t='plastic', c=(.85, .8, .62))
            eye(p, .075, (s * .1, -.19, .36), bad=bad and s > 0, yaw=s * 10, pitch=-12)
        smile(p, .2, -.365, .1, bend=.1, lift=.06)
        crown(10, .12, .1, .46)
    elif kind == 1:   # walrus: whisker pads and tusks, one snapped
        p.ball((.24, .23, .25), (0, 0, .26), segs=12, rings=8, bump=(.012, 6), **st)
        for s in (-1, 1):
            p.ball((.12, .11, .1), (s * .09, -.2, .17), segs=10, rings=6, bump=(.006, 9), **lite)
            long = s < 0 or 'tusk' not in damage
            p.lathe([(.03, 0), (.026, -.1), (.02, -.1) if not long else (.018, -.2), (.0, -.105) if not long else (.004, -.3)], (s * .09, -.24, .1), rot=(6, s * 5, 0), segs=7, t='plastic', c=(.85, .8, .6), ts=.2)
            eye(p, .05, (s * .1, -.205, .35), bad=bad and s > 0, yaw=s * 8, pitch=-8)
            for k in range(7):
                tuft.append(((s * (.1 + .012 * k), -.3, .15 + .01 * (k % 3)), (s * .8, -.6, -.2)))
        p.ball((.05, .035, .035), (0, -.25, .25), segs=8, rings=5, t='vinyl', c=(.12, .06, .06))
        smile(p, .1, -.27, .1, bend=.04, lift=.03, r=.01)
        crown(8, .1, .1, .5)
    elif kind == 2:   # toad: wide, flat, eyes on top, and a mouth that goes round the sides
        p.ball((.31, .25, .17), (0, 0, .18), segs=14, rings=8, bump=(.012, 5), **st)
        p.ball((.3, .22, .1), (0, -.04, .1), segs=14, rings=6, **lite)
        for s in (-1, 1):
            p.ball((.115, .11, .1), (s * .16, -.04, .33), segs=10, rings=6, **st)
            eye(p, .095, (s * .16, -.125, .35), bad=bad and s > 0, missing='eye_missing' in damage and s < 0, yaw=s * 14, pitch=-14)
        smile(p, .3, -.285, .14, bend=.22, lift=.05, r=.018)
    elif kind == 3:   # rhino: long face, horn broken off short
        p.ball((.22, .25, .23), (0, 0, .25), segs=12, rings=8, bump=(.012, 6), **st)
        p.ball((.17, .21, .15), (0, -.22, .17), segs=12, rings=7, bump=(.008, 7), **st)
        stub = 'horn' in damage
        p.lathe([(.07, 0), (.055, .06), (.045, .07) if stub else (.03, .16), (0, .06) if stub else (0, .26)], (0, -.33, .28), rot=(-25, 0, 0), segs=8, bump=(.006, 30), t='plastic', c=(.8, .76, .62), ts=.2)
        for s in (-1, 1):
            p.lathe([(.05, 0), (.035, .07), (0, .13)], (s * .15, .06, .42), rot=(10, s * 20, 0), scale=(1, .5, 1), segs=7, **st)
            eye(p, .055, (s * .13, -.2, .34), bad=bad and s > 0, yaw=s * 20, pitch=-10)
            p.ball((.02, .015, .015), (s * .06, -.42, .2), segs=6, rings=4, t='vinyl', c=(.1, .06, .08))
        smile(p, .14, -.41, .1, bend=.14, lift=.04, r=.011)
    elif kind == 4:   # bear: the friendly one, with a row of teeth that are the wrong sort
        p.ball((.25, .24, .24), (0, 0, .25), segs=12, rings=8, bump=(.012, 6), **st)
        p.ball((.13, .1, .1), (0, -.2, .17), segs=10, rings=6, **lite)
        for s in (-1, 1):
            p.ball((.09, .04, .09), (s * .19, 0, .45), segs=9, rings=6, **st)
            p.ball((.05, .02, .05), (s * .19, -.03, .45), segs=7, rings=4, **lite)
            eye(p, .068, (s * .1, -.2, .33), bad=bad and s > 0, missing='eye_missing' in damage and s < 0, yaw=s * 8, pitch=-8)
        p.ball((.04, .03, .028), (0, -.3, .2), segs=8, rings=5, t='vinyl', c=(.1, .05, .05))
        smile(p, .11, -.29, .12, bend=.05, lift=.04, r=.024, teeth=8)
        crown(8, .1, .1, .48)
    else:             # rabbit: one ear folded over
        p.ball((.22, .22, .25), (0, 0, .25), segs=12, rings=8, bump=(.012, 6), **st)
        p.ball((.12, .09, .09), (0, -.18, .16), segs=10, rings=6, **lite)
        p.tube([(-.08, .02, .46), (-.1, .03, .65), (-.11, .03, .85)], [(.055, .025), (.07, .025), (.03, .015)], segs=8, bump=(.006, 9), **st)
        p.tube([(.08, .02, .46), (.11, .02, .62), (.2, -.04, .66), (.27, -.1, .52)], [(.055, .025), (.065, .025), (.06, .025), (.03, .015)], segs=8, bump=(.006, 9), **st)
        for s in (-1, 1):
            eye(p, .072, (s * .095, -.185, .33), bad=bad and s > 0, yaw=s * 10, pitch=-8)
            p.box((.03, .012, .05), (s * .017, -.265, .09), bevel=.004, t='plastic', c=(.88, .84, .68), ts=.1)
        p.ball((.03, .02, .02), (0, -.27, .19), segs=6, rings=4, t='vinyl', c=(.5, .2, .25))
        smile(p, .09, -.265, .13, bend=.04, lift=.035, r=.01)
        crown(8, .08, .08, .48)
    if 'torn' in damage:   # the cheek split and the foam came out
        p.ball((.07, .03, .09), (-.17, -.15, .2), rot=(0, 0, -40), segs=8, rings=5, bump=(.01, 20), t='vinyl', c=(.75, .6, .3), ts=.15)
        for i in range(10):
            a = i / 10 * 2 * math.pi
            tuft.append(((-.17 + math.cos(a) * .06, -.16, .2 + math.sin(a) * .09), (math.cos(a), -.6, math.sin(a))))
    p.tufts(tuft, length=.06, width=.013, c=fur)
    p.lathe([(.14, .0), (.16, .03)], segs=12, t='velvet', c=(.03, .03, .03))    # the neck hole's lining


def steel_shelf(p, w, d, h, levels, c=(.75, .75, .78), lip=.03):
    """Bolted angle-iron shelving: four slotted posts and sheet shelves."""
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (w / 2 - .02), sy * (d / 2 - .02)
            p.box((.04, .004, h), (x, y + sy * .018, h / 2), t='paint', c=c)
            p.box((.004, .04, h), (x + sx * .018, y, h / 2), t='paint', c=c)
    for z in levels:
        p.box((w - .01, d - .01, .004), (0, 0, z), t='paint', c=c)
        for sy in (-1, 1): p.box((w - .01, .004, lip), (0, sy * (d / 2 - .004), z - lip / 2), t='paint', c=c)
        for sx in (-1, 1): p.box((.004, d - .01, lip), (sx * (w / 2 - .004), 0, z - lip / 2), t='paint', c=c)
    # a cross brace on the back
    p.tube([(-w / 2 + .02, d / 2, .15), (w / 2 - .02, d / 2, h - .15)], (.012, .002), segs=4, up=(0, 1, 0), t='paint', c=c)
    p.tube([(w / 2 - .02, d / 2 + .004, .15), (-w / 2 + .02, d / 2 + .004, h - .15)], (.012, .002), segs=4, up=(0, 1, 0), t='paint', c=c)


@prop('spare_heads', notes='Six heads on steel shelving and a seventh on top, tipped forward to look down at the room, all facing the front (-Y in Blender, +Z in three.js). Stand it against a wall facing a door.')
def spare_heads(p):
    steel_shelf(p, 2.0, .6, 2.0, (.28, .9, 1.52, 1.99), c=(.55, .6, .62))
    lay = [(0, -.66, 1.52, 4, ''), (4, 0, 1.52, -3, 'eye_missing'), (5, .64, 1.52, 7, 'eye_bad'),
           (2, -.6, .9, -5, 'eye_bad,torn'), (3, .08, .9, 3, 'horn'), (1, .7, .9, 9, 'tusk')]
    for kind, x, z, yaw, dmg in lay:
        with p.place((x, .0, z + .003), rot=(0, 0, yaw)):
            head(p, kind, dmg)
    # one more left on top of the shelving, tipped forward so it looks down at
    # whoever comes in, with its chin over the edge
    with p.place((.3, -.08, 2.03), rot=(24, 0, -12)):
        head(p, 0, 'eye_bad,torn')
    # the bottom shelf: a box of eyes, a jaw, off-cuts
    p.box((.5, .38, .26), (-.6, 0, .28 + .13), rot=(0, 0, 6), t='cardboard', c=(1, 1, 1))
    p.box((.42, .3, .006), (-.6, 0, .28 + .262), rot=(0, 0, 6), t='cardboard', c=(.25, .2, .15))
    for i in range(4):
        a = i * 2.4
        with p.place((-.6 + .13 * math.cos(a) * (i % 3) / 2, .1 * math.sin(a), .56 + .01 * (i % 2)), rot=(-90 + 40 * math.sin(a * 3), 30 * math.cos(a * 2), i * 50)):
            eye(p, .05 + .01 * (i % 3), (0, 0, 0), bad=i == 2, glass=False)
    p.ball((.2, .14, .1), (.1, 0, .38), rot=(0, 0, 20), segs=10, rings=6, bump=(.02, 9), t='fur', c=faded(FUR[0], .4))
    p.ball((.16, .12, .08), (.42, .05, .36), rot=(0, 0, -30), segs=10, rings=6, bump=(.02, 9), t='fur', c=faded(FUR[2], .4))
    p.tube([(.7, -.1, .3), (.72, 0, .34), (.8, .1, .3)], [(.05, .04), (.06, .05), (.04, .03)], segs=7, bump=(.01, 12), t='vinyl', c=(.75, .6, .3), ts=.2)
    p.tufts([((.1 + .15 * math.cos(i), .1 * math.sin(i), .45), (math.cos(i), math.sin(i), 1)) for i in range(12)], length=.07, c=faded(FUR[0], .4))


# ---------------------------------------------------------------- the rest

@prop('mannequin', notes='Dress form on a castor stand, 2.0 m to the top of the spare bear head someone jammed on it askew, with a fur suit half pinned on and one empty sleeve. Reads as a person in the dark.')
def mannequin(p):
    # stand
    for i in range(4):
        a = D(45 + i * 90)
        p.tube([(0, 0, .12), (math.cos(a) * .15, math.sin(a) * .15, .07), (math.cos(a) * .28, math.sin(a) * .28, .05)], [.018, .016, .012], segs=5, t='wood', c=(.5, .4, .35))
        p.ball(.022, (math.cos(a) * .28, math.sin(a) * .28, .024), segs=6, rings=4, t='vinyl', c=(.1, .1, .1))
    p.cyl(.017, .78, (0, 0, .1), segs=8, t='steel', c=(.6, .58, .5))
    p.cyl(.028, .1, (0, 0, .7), segs=8, t='wood', c=(.5, .4, .35))

    # the form: hips at 0.85, shoulders at 1.42, a neck cap at 1.56
    zs = [.84, .88, .98, 1.1, 1.2, 1.3, 1.38, 1.44, 1.48, 1.52, 1.56]
    rs = [(.1, .07), (.175, .12), (.185, .125), (.145, .1), (.15, .105), (.175, .115), (.19, .11), (.17, .095), (.09, .07), (.06, .055), (.058, .054)]

    def R(z, a):
        """Radius of the form at height z toward angle a."""
        for i in range(len(zs) - 1):
            if zs[i] <= z <= zs[i + 1]:
                t = (z - zs[i]) / (zs[i + 1] - zs[i])
                rx, ry = rs[i][0] + (rs[i + 1][0] - rs[i][0]) * t, rs[i][1] + (rs[i + 1][1] - rs[i][1]) * t
                return 1 / math.sqrt((math.cos(a) / rx) ** 2 + (math.sin(a) / ry) ** 2)
        return .1
    linen = dict(t='wrap', c=(.8, .74, .62), ts=1.6)   # big repeat, so the form is mostly clean canvas with one old stain
    p.tube([(0, 0, z) for z in zs], rs, segs=16, **linen)
    p.cyl(.062, .012, (0, 0, 1.56), segs=12, t='wood', c=(.45, .33, .25))
    p.lathe([(.012, 0), (.02, .015), (.012, .035), (.0, .04)], (0, 0, 1.572), segs=8, t='wood', c=(.45, .33, .25))
    for s in (-1, 1):   # arm plates
        p.cyl(.05, .008, (s * .187, 0, 1.385), rot=(0, s * 90, 0), segs=10, t='wood', c=(.45, .33, .25))
    p.tube([(0, -R(z, -math.pi / 2) - .002, z) for z in zs[1:8]], .003, segs=3, caps=False, t='velvet', c=(.2, .15, .1))   # the centre seam

    # the suit: fur wrapped round the form's left and back, raw edge down the front
    fur = (.52, .44, .66)
    a0, a1 = D(-75), D(200)

    def skin(u, v):
        a = a0 + (a1 - a0) * u
        z = .62 + (1.47 - .62) * v + .03 * noise.noise(Vector((u * 9, 0, 2))) * (1 - v)
        zz = max(z, .885)
        r = R(min(zz, 1.5), a) + .016 + .012 * noise.noise(Vector((u * 14, v * 9, 0)))
        if z < .885: r *= 1 + (.885 - z) * .5      # the skirt of it hangs free below the hips
        edge = min(u, 1 - u)
        r += .03 * max(0, 1 - edge * 12) * abs(noise.noise(Vector((v * 12, u, 4))))   # the unpinned edge curls away
        return (math.cos(a) * r, math.sin(a) * r, z)
    p.sheet(skin, 30, 22, size=(.9, .85), keep=lambda u, v: not (v > .93 and noise.noise(Vector((u * 15, 0, 0))) > .1), t='fur', c=lambda w: mixc(fur, (.3, .26, .3), max(0, min(1, (.95 - w.z) * 1.5))))
    # one finished sleeve, hanging empty from the left shoulder
    arm = [(.17, .01, 1.42), (.25, .01, 1.36), (.3, 0, 1.15), (.31, -.02, .92), (.3, -.04, .76)]
    p.tube(arm, [(.085, .08), (.08, .07), (.07, .045), (.065, .04), (.06, .04)], segs=10, bump=(.014, 9), t='fur', c=fur)
    p.ball((.07, .045, .09), (.3, -.045, .7), segs=9, rings=6, bump=(.008, 14), t='fur', c=(.75, .68, .78), ts=.3)
    for k in range(4):
        p.tube([(.3 + (k - 1.5) * .032, -.05, .66), (.3 + (k - 1.5) * .038, -.06, .57 + abs(k - 1.5) * .02)], [.021, .016], segs=6, t='fur', c=(.75, .68, .78), ts=.3)
    tuft = []
    for i in range(40):
        v = i / 40
        for u in (0, 1):
            q = Vector(skin(u, v))
            tuft.append((q, (q.x, q.y, 0)))
    for i in range(24):
        q = Vector(skin(i / 24, 0)); tuft.append((q, (q.x, q.y, -1)))
    p.tufts(tuft, length=.06, width=.012, c=fur)
    # dressmaker's pins along the edges, and a tape measure round the neck
    for i in range(14):
        v = .2 + i / 14 * .75
        q = Vector(skin(.03 if i % 2 else .97, v))
        n = Vector((q.x, q.y, 0)).normalized()
        p.tube([q - n * .01, q + n * .028], .0012, segs=3, t='steel', c=(.9, .9, .9))
        p.ball(.0045, q + n * .03, segs=5, rings=3, t='plastic', c=((.9, .2, .2), (.95, .85, .3), (.9, .9, .9))[i % 3])
    tape = []
    for i in range(17):
        a = D(-200 + i * 14)
        tape.append((math.cos(a) * .075, math.sin(a) * .068, 1.5 - .012 * math.sin(a)))
    tape = [(-.08, -.11, 1.02), (-.09, -.115, 1.2), (-.085, -.1, 1.38), (-.075, -.03, 1.49)] + tape[4:13] + [(.06, -.09, 1.4), (.07, -.11, 1.25)]
    p.tube(tape, (.008, .0008), segs=4, caps=False, up=(0, 0, 1), t='paper', c=(.95, .8, .25), ts=.3)
    # a spare head pushed down onto the neck, turned and tipped as if it were listening
    with p.place((.0, .015, 1.5), rot=(-6, 10, -16)):
        head(p, 4, 'eye_missing')


@prop('vanity', notes='Make-up table with a bulb mirror. Ten bulbs in lamp_glow, three more dead or missing. A foam wig head stands on the top.')
def vanity(p):
    wood = dict(t='wood', c=(.75, .6, .55))
    white = dict(t='paint', c=(.85, .78, .72))
    p.box((1.2, .5, .035), (0, 0, .745), bevel=.006, **wood)
    for sx in (-1, 1):
        p.box((.34, .46, .56), (sx * .42, .01, .45), **white)                     # drawer pedestals
        for k in range(3):
            z = .26 + k * .185
            dz = -.06 if (sx > 0 and k == 1) else 0                                # one drawer left open
            p.box((.31, .02, .16), (sx * .42, -.235 + dz, z), bevel=.004, **white)
            p.ball((.018, .012, .018), (sx * .42, -.25 + dz, z), segs=6, rings=4, t='steel', c=(.8, .7, .4))
        for sy in (-1, 1):
            p.cyl(.02, .17, (sx * .42 + .13 * sy, sy * .19, 0), r2=.028, segs=6, **wood)
    # mirror: frame from 0.78 to 1.8, bulbs round three sides
    p.box((1.1, .03, 1.02), (0, .215, 1.28), **white)
    p.quad([(-.42, .198, .88), (.42, .198, .88), (.42, .198, 1.68), (-.42, .198, 1.68)], t='mirror', c=(1, 1, 1), ts=1.0)
    for q in (((.9, .02, .03), (0, .195, .87)), ((.9, .02, .03), (0, .195, 1.69)), ((.03, .02, .85), (-.435, .195, 1.28)), ((.03, .02, .85), (.435, .195, 1.28))):
        p.box(q[0], q[1], bevel=.004, t='paint', c=(.7, .6, .35))
    spots = [(-.5, .93 + i * .2) for i in range(4)] + [(.5, .93 + i * .2) for i in range(4)] + [(-.36 + i * .18, 1.745) for i in range(5)]
    for i, (x, z) in enumerate(spots):
        p.cyl(.022, .012, (x, .2, z), rot=(90, 0, 0), segs=8, t='steel', c=(.7, .6, .4))
        if i in (2, 9):      # an empty socket
            p.cyl(.012, .004, (x, .19, z), rot=(90, 0, 0), segs=6, t='plastic', c=(.02, .02, .02)); continue
        bulb = [(.014, 0), (.02, .012), (.03, .035), (.027, .055), (.014, .068), (0, .072)]
        if i == 6: p.lathe(bulb, (x, .188, z), rot=(90, 0, 0), segs=8, t='plastic', c=(.25, .2, .15), ts=.2)    # blown, blackened
        else: p.lathe(bulb, (x, .188, z), rot=(90, 0, 0), segs=8, m='lamp_glow')
    # clutter
    top = .763
    with p.place((.33, .02, top)):   # a foam wig head with one ear still pinned on
        p.lathe([(.07, 0), (.075, .01), (.04, .03), (.035, .1), (.05, .13), (.085, .2), (.092, .27), (.075, .34), (.04, .375), (0, .38)], segs=12, scale=(1, 1.12, 1), t='plastic', c=(.92, .9, .84), ts=.5)
        p.ball((.012, .02, .03), (0, -.105, .24), segs=6, rings=4, t='plastic', c=(.92, .9, .84))     # a nose, and nothing else
        p.tube([(-.09, 0, .3), (-.07, 0, .36), (0, 0, .39), (.07, 0, .36), (.09, 0, .3)], (.012, .006), segs=4, up=(0, 1, 0), t='plastic', c=(.1, .1, .1))
        p.ball((.045, .015, .05), (-.06, 0, .41), segs=8, rings=5, t='fur', c=faded(FUR[5], .3), ts=.2)
        p.tufts([((-.06 + .04 * math.cos(i), 0, .41 + .045 * math.sin(i)), (math.cos(i), 0, math.sin(i))) for i in range(8)], length=.03, width=.008, c=faded(FUR[5], .3))
    for i, (x, y, r, h, c) in enumerate([(-.45, -.1, .03, .05, (.85, .4, .5)), (-.36, -.14, .022, .035, (.9, .9, .85)), (-.3, .0, .035, .025, (.2, .2, .22)),
                                         (-.15, -.12, .028, .06, (.5, .65, .8)), (0, -.05, .04, .1, (.75, .7, .6)), (.12, -.16, .02, .07, (.7, .1, .15)), (-.5, .08, .045, .09, (.9, .85, .8))]):
        p.cyl(r, h, (x, y, top), segs=10, t='plastic', c=c, ts=.2)
        p.cyl(r * 1.06, h * .25, (x, y, top + h), segs=10, t='plastic', c=mixc(c, (.1, .1, .1), .5), ts=.2)
    for i in range(5):   # brushes in the tall pot
        a = i * 1.3
        tip = (.0 + .03 * math.cos(a), -.05 + .03 * math.sin(a), top + .24 + .02 * (i % 2))
        p.tube([(.01 * math.cos(a), -.05 + .01 * math.sin(a), top + .08), tip], .004, segs=4, t='wood', c=(.3, .2, .2))
        p.ball((.012, .012, .022), tip, segs=5, rings=3, t='fur', c=(.3, .22, .2), ts=.1)
    p.box((.22, .12, .07), (-.12, .1, top + .035), rot=(0, 0, -12), bevel=.006, t='cardboard', c=(.8, .9, 1))          # tissues
    p.sheet(lambda u, v: (-.12 + (u - .5) * .09, .1 + (v - .5) * .04, top + .07 + .06 * math.sin(u * 3.1) * (.6 + .4 * v)), 5, 3, size=(.1, .1), t='paper', c=(.95, .95, .95))
    p.cyl(.05, .012, (.15, .08, top), segs=12, t='plastic', c=(.15, .1, .12))                                    # an open compact
    p.cyl(.05, .006, (.15, .135, top + .045), rot=(-70, 0, 0), segs=12, t='mirror', c=(1, 1, 1), ts=.3)
    p.cyl(.042, .003, (.15, .08, top + .012), segs=12, t='gunk', c=(.9, .65, .6), ts=.15)
    p.sheet(lambda u, v: (-.3 + u * .25, -.2 + v * .1 + .02 * math.sin(u * 5), top + .002), 6, 2, size=(.25, .1), t='gunk', c=(.9, .7, .65), ts=.4)   # spilt powder
    p.tube([(.48, -.18, top + .012), (.56, -.1, top + .012)], .011, segs=6, t='plastic', c=(.75, .1, .15))      # a lipstick, on its side


@prop('trunk', notes='Wardrobe trunk, lid ajar, fur and one sleeve spilling over the front. The lid does not move.')
def trunk(p):
    W, Dp, H = 1.0, .58, .42
    skin = dict(t='vinyl', c=(.16, .24, .2))
    brass = dict(t='steel', c=(.75, .6, .3))
    # body: four walls and a floor, so the dark inside shows under the lid
    for q in (((W, .025, H), (0, -Dp / 2 + .0125, H / 2)), ((W, .025, H), (0, Dp / 2 - .0125, H / 2)), ((.025, Dp, H), (-W / 2 + .0125, 0, H / 2)), ((.025, Dp, H), (W / 2 - .0125, 0, H / 2)), ((W, Dp, .025), (0, 0, .0125))):
        p.box(q[0], q[1], **skin)
    p.box((W - .06, Dp - .06, .01), (0, 0, .03), t='gift', c=(.5, .3, .3))                # paper lining
    for x in (-.3, .3):                                                                   # wooden slats
        for q in (((.05, .012, H), (x, -Dp / 2 - .006, H / 2)), ((.05, .012, H), (x, Dp / 2 + .006, H / 2))):
            p.box(q[0], q[1], bevel=.004, t='wood', c=(.6, .5, .4))
    for sx in (-1, 1):
        for sy in (-1, 1):
            for z in (.03, H - .03):
                p.ball((.04, .04, .04), (sx * (W / 2 - .01), sy * (Dp / 2 - .01), z), segs=6, rings=4, **brass)
        p.tube([(sx * (W / 2 + .005), -.1, H * .55), (sx * (W / 2 + .05), -.08, H * .45), (sx * (W / 2 + .05), .08, H * .45), (sx * (W / 2 + .005), .1, H * .55)], .012, segs=5, t='vinyl', c=(.3, .2, .12))
    p.box((.08, .012, .1), (0, -Dp / 2 - .008, H - .07), bevel=.004, **brass)
    # lid, hinged along the top back edge, open about 35 degrees
    with p.place((0, Dp / 2, H), rot=(-35, 0, 0)):
        LH = .16
        for q in (((W, .025, LH), (0, -Dp + .0125, LH / 2)), ((W, .025, LH), (0, -.0125, LH / 2)), ((.025, Dp, LH), (-W / 2 + .0125, -Dp / 2, LH / 2)), ((.025, Dp, LH), (W / 2 - .0125, -Dp / 2, LH / 2)), ((W, Dp, .025), (0, -Dp / 2, LH - .0125))):
            p.box(q[0], q[1], **skin)
        for x in (-.3, .3):
            p.box((.05, Dp + .02, .012), (x, -Dp / 2, LH + .006), bevel=.004, t='wood', c=(.6, .5, .4))
        for sx in (-1, 1):
            for sy in (0, 1):
                p.ball((.04, .04, .04), (sx * (W / 2 - .01), -sy * (Dp - .02) - .01, LH - .02), segs=6, rings=4, **brass)
        p.box((.07, .012, .06), (0, -Dp - .008, .03), bevel=.004, **brass)
        p.box((W - .06, Dp - .06, .01), (0, -Dp / 2, LH - .03), t='gift', c=(.5, .3, .3))
    for sx in (-1, 1):   # the stays holding it open
        p.tube([(sx * (W / 2 - .04), Dp / 2 - .2, H - .02), (sx * (W / 2 - .04), Dp / 2 - .29, H + .2)], (.008, .002), segs=4, **brass)
    # what is in it
    fur_a, fur_b = faded(FUR[0], .35), faded(FUR[2], .4)
    p.ball((.44, .24, .16), (0, 0, H - .08), segs=14, rings=7, bump=(.04, 6), t='fur', c=fur_a)
    p.ball((.25, .2, .14), (.18, .05, H - .02), segs=10, rings=6, bump=(.03, 8), t='fur', c=fur_b)

    def spill(u, v):   # a pelt hanging over the front wall
        x = -.36 + u * .5
        fall = v * .47
        y = -Dp / 2 + .1 - min(fall, .13) - .02 * math.sin(v * 3) - .012 * abs(noise.noise(Vector((u * 6, v * 4, 0))))
        z = H + .02 - max(0, fall - .1) * (.9 + .25 * noise.noise(Vector((u * 5, 0, 1)))) + .03 * math.sin(u * 9) * (1 - v)
        return (x, y - .012, z)
    p.sheet(spill, 14, 12, size=(.5, .47), t='fur', c=fur_a)
    tuft = [(spill(i / 20, 1), (0, -.3, -1)) for i in range(21)] + [(spill(u, i / 8), (-1 if u == 0 else 1, -.3, 0)) for i in range(4, 9) for u in (0, 1)]
    # a sleeve over the right corner, with its mitt nearly on the floor
    arm = [(.25, -.05, H - .02), (.38, -.22, H + .04), (.41, -.33, H - .06), (.4, -.345, .22), (.39, -.35, .12)]
    p.tube(arm, [(.09, .06), (.085, .05), (.075, .045), (.07, .04), (.065, .04)], segs=9, bump=(.012, 9), t='fur', c=fur_b)
    mitt = dict(t='fur', c=faded(BELLY[2], .4), ts=.3)
    p.ball((.07, .045, .085), (.39, -.355, .07), segs=9, rings=6, bump=(.008, 14), **mitt)
    for k in range(4):
        p.tube([(.39 + (k - 1.5) * .032, -.36, .04), (.39 + (k - 1.5) * .04, -.4 - .015 * k, .018)], [.021, .016], segs=6, **mitt)
    p.tufts(tuft, length=.07, width=.014, c=fur_a)
