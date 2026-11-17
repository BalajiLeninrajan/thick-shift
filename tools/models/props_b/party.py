# Party hall props. Front is -Y, sizes in metres.
import math
from mathutils import Vector, noise
from kit import prop, mixc, fill2d, spline, D
from stage import FUR, faded
import atlas

BLACK = (.1, .1, .11)
CHROME = dict(t='steel', c=(.78, .78, .8))
PARTY = [(.85, .3, .3), (.3, .55, .8), (.9, .78, .3), (.4, .7, .45), (.8, .45, .7), (.9, .55, .25)]
PASTEL = [faded(c, .45) for c in PARTY]


def cup(p, at, c, rot=(0, 0, 0)):
    p.lathe([(.0, .002), (.026, 0), (.036, .09), (.038, .092), (.034, .09), (.025, .006)], at, rot, segs=9, t='paper', c=c, ts=.3)


def plate(p, at, c=(.95, .93, .88), rot=(0, 0, 0), food=None):
    p.lathe([(0, .004), (.06, .004), (.085, .014), (.092, .014)], at, rot, segs=12, t='paper', c=c, ts=.4)
    if food: p.ball((.045, .04, .014), (at[0] + .01, at[1], at[2] + .012), segs=7, rings=4, bump=(.006, 40), t='gunk', c=food, ts=.2)


def hat(p, at, c, rot=(0, 0, 0)):
    """A cone party hat with a tinsel pompom."""
    with p.place(at, rot):
        p.lathe([(.06, 0), (.03, .09), (.004, .17)], segs=10, t='gift', c=c, ts=.12)
        p.tufts([((0, 0, .17), (math.cos(i * 1.3), math.sin(i * 1.3), .6)) for i in range(8)], length=.03, width=.004, droop=.2, t='paper', c=(.9, .85, .5))


@prop('table_round', notes='Round table, 1.5 m across, laid for a party that was not cleared away. The cloth hangs to about 0.45 m off the floor.')
def table_round(p):
    R, H = .75, .74
    p.cyl(R - .01, .03, (0, 0, H - .03), segs=24, t='wood', c=(.7, .65, .6))
    p.cyl(.04, H - .06, (0, 0, .03), segs=8, **CHROME)
    for i in range(4):
        a = D(45 + i * 90)
        p.tube([(0, 0, .1), (math.cos(a) * .2, math.sin(a) * .2, .05), (math.cos(a) * .42, math.sin(a) * .42, .02)], [.025, .022, .018], segs=6, **CHROME)
        p.ball((.03, .03, .015), (math.cos(a) * .42, math.sin(a) * .42, .012), segs=6, rings=3, t='vinyl', c=BLACK)

    def cloth(u, v):
        a = u * 2 * math.pi
        if v < .7:
            r = R * v / .7
            return (math.cos(a) * r, math.sin(a) * r, H + .003)
        t = (v - .7) / .3
        rip = math.sin(a * 13 + 2 * math.sin(a * 3)) * .5 + .5
        r = R + .012 + (.02 + .07 * rip) * t ** .7
        drop = .3 * t * (.85 + .15 * math.sin(a * 5 + 1))
        return (math.cos(a) * r, math.sin(a) * r, H + .003 - drop)

    def tint(w):
        k = max(0, min(1, (H - w.z) / .3))
        return mixc((.8, .86, .95), (.5, .5, .42), k * .6)
    p.sheet(cloth, 56, 9, size=(4.7, 1.05), keep=lambda u, v: not (v > .78 and .30 < u < .36), t='paper', c=tint, ts=1.2)
    T = H + .006
    r = p.rng
    for i in range(6):   # six places
        a = D(i * 60 + 12)
        x, y = math.cos(a) * .52, math.sin(a) * .52
        food = [(.6, .45, .3), None, (.75, .7, .5), (.4, .3, .25), None, (.7, .5, .45)][i]
        plate(p, (x, y, T), food=food, rot=(0, 0, i * 40))
        ca = a + .45
        if i == 2: cup(p, (math.cos(ca) * .5, math.sin(ca) * .5, T + .036), PASTEL[i], rot=(90, 0, i * 70))   # knocked over
        else: cup(p, (math.cos(ca) * .5, math.sin(ca) * .5, T), PASTEL[i])
        if i in (0, 3, 4):
            ha = a - .5
            hat(p, (math.cos(ha) * .45, math.sin(ha) * .45, T + (.055 if i == 3 else 0)), PASTEL[(i + 2) % 6], rot=(0, 0, 0) if i != 3 else (95, 0, i * 50))
        p.box((.012, .14, .003), (math.cos(a - .25) * .5, math.sin(a - .25) * .5, T + .002), rot=(0, 0, math.degrees(a) + 80 + i * 13), t='plastic', c=(.9, .9, .88))   # a fork
    p.sheet(lambda u, v: (-.1 + u * .35 + .04 * math.sin(v * 7), .28 + v * .2 + .03 * math.sin(u * 9), T + .001), 5, 4, size=(.35, .2), t='gunk', c=(.35, .12, .15), ts=.5)   # juice, dried sticky
    # the cake: sagged, furred over, the candles burnt to stubs
    p.cyl(.2, .008, (0, 0, T), segs=16, t='cardboard', c=(.9, .85, .6))
    p.lathe([(.17, 0), (.18, .03), (.165, .065), (.12, .08), (.05, .06), (0, .05)], (0, 0, T + .008), segs=16, bump=(.02, 14), t='gunk', c=(.85, .7, .75), ts=.35)
    p.ball((.09, .07, .03), (.19, -.04, T + .02), segs=8, rings=4, bump=(.01, 30), t='gunk', c=(.75, .6, .65), ts=.2)      # a slice slumped off the side
    for i in range(7):
        a = i * .9
        x, y = math.cos(a) * .09, math.sin(a) * .09
        hgt = .01 + .03 * ((i * 7) % 4) / 3
        p.cyl(.004, hgt, (x, y, T + .07), rot=(8 * math.sin(i), 8 * math.cos(i * 2), 0), segs=5, t='plastic', c=PARTY[i % 6], ts=.1)
    p.box((.02, .22, .002), (.06, -.1, T + .11), rot=(-28, 0, 20), t='steel', c=(.8, .8, .8))          # the knife is still in it
    p.box((.022, .1, .014), (.1, -.21, T + .185), rot=(-28, 0, 20), bevel=.004, t='plastic', c=(.15, .1, .1))
    for i in range(5):   # napkins and scraps
        a = i * 1.9
        p.ball((.05, .04, .02), (math.cos(a) * .3, math.sin(a) * .32, T + .015), rot=(0, 0, i * 50), segs=6, rings=4, bump=(.012, 35), t='paper', c=PASTEL[(i * 2) % 6], ts=.2)


def chair_geo(p, c):
    """A one-piece stacking shell on a tube frame. Seat at 0.45, back to 0.84."""
    prof = [(-.215, .405), (-.195, .44), (-.12, .452), (0, .442), (.1, .434), (.165, .445), (.2, .49), (.215, .56), (.235, .7), (.25, .8), (.262, .84)]

    def shell(u, v):
        y, z = spline(prof, v)
        s = 2 * u - 1
        back = max(0, min(1, (v - .6) / .2))
        w = .215 - .012 * back
        round_ = max(0, (abs(2 * v - 1) - .9) / .1)                # round the front and top corners
        x = s * w * (1 - .12 * round_ * s * s)
        z += .028 * s * s * (1 - back) - .0 * s
        y += -.035 * s * s * back + .03 * round_ * s * s * (1 if v < .5 else 0)
        return (x, y, z)
    p.sheet(shell, 12, 26, size=(.43, .95), keep=lambda u, v: not (.84 < v < .92 and .32 < u < .68), t='plastic', c=c)
    for s in (-1, 1):
        path = [(s * .22, -.24, .006), (s * .205, -.18, .2), (s * .185, -.15, .415), (s * .18, 0, .425), (s * .185, .13, .41), (s * .205, .2, .2), (s * .225, .27, .006)]
        p.tube(path, .0095, segs=6, **CHROME)
        for q in (path[0], path[-1]): p.ball((.014, .014, .01), (q[0], q[1], .007), segs=6, rings=3, t='vinyl', c=BLACK)
    for y, z in ((-.15, .413), (.13, .408)):
        p.tube([(-.185, y, z), (.185, y, z)], .008, segs=5, **CHROME)
    p.ball((.03, .02, .004), (.06, -.05, .447), segs=6, rings=3, t='gunk', c=(.4, .35, .25), ts=.1)   # gum, or cake


@prop('chair', notes='Stacking plastic chair, 0.45 m seat.')
def chair(p):
    chair_geo(p, faded(PARTY[5], .3))


@prop('chair_fallen', notes='The same chair on its left side, turned a little. Origin is still the centre of its footprint.')
def chair_fallen(p):
    with p.place((.1, 0, .222), rot=(0, 0, 25)):
        with p.place(rot=(0, -93, 0)):
            with p.place((0, 0, -.42)):
                chair_geo(p, faded(PARTY[1], .35))


@prop('table_long', notes='Folding trestle table, bare. 0.75 m high.')
def table_long(p):
    L, W, H = 2.4, .75, .75
    sag = lambda x: -.012 * (1 - (2 * x / L) ** 2)      # years of stacked chairs
    p.sheet(lambda u, v: ((u - .5) * L, (v - .5) * W, H + sag((u - .5) * L)), 12, 3, size=(L, W), t='laminate', c=(.9, .86, .8), ts=1.1)
    p.sheet(lambda u, v: ((u - .5) * L, (.5 - v) * W, H - .025 + sag((u - .5) * L)), 12, 1, size=(L, W), t='wood', c=(.6, .55, .5))
    for s in (-1, 1):
        p.sheet(lambda u, v: ((u - .5) * L, s * W / 2, H - .027 + v * .028 + sag((u - .5) * L)), 12, 1, size=(L, .03), t='plastic', c=(.25, .22, .2), ts=.3)
        p.box((.008, W, .028), (s * L / 2, 0, H - .014), t='plastic', c=(.25, .22, .2))
        p.tube([(-L / 2 + .1, s * (W / 2 - .06), H - .04), (0, s * (W / 2 - .06), H - .052), (L / 2 - .1, s * (W / 2 - .06), H - .04)], (.012, .015), segs=4, t='steel', c=(.5, .5, .52))   # apron rail
    for s in (-1, 1):   # the two folding leg frames
        x = s * (L / 2 - .32)
        legs = [(x, -W / 2 + .1, .008), (x, -W / 2 + .1, H - .06), (x, W / 2 - .1, H - .06), (x, W / 2 - .1, .008)]
        p.tube(legs, .014, segs=6, **CHROME)
        p.tube([(x, -W / 2 + .1, .2), (x, W / 2 - .1, .2)], .011, segs=5, **CHROME)
        for y in (-W / 2 + .1, W / 2 - .1):
            p.ball((.02, .02, .012), (x, y, .008), segs=6, rings=3, t='vinyl', c=BLACK)
            p.box((.03, .05, .03), (x, y, H - .045), t='steel', c=(.45, .45, .46))
        # the locking stay, from the leg up to the middle of the top
        p.tube([(x, 0, .3), (x - s * .25, 0, H - .25), (x - s * .5, 0, H - .04)], (.01, .003), segs=4, up=(0, 1, 0), **CHROME)
        p.ring(.016, .004, (x - s * .25, 0, H - .25), rot=(90, 0, 0), n=8, segs=3, **CHROME)
    p.ball((.025, .02, .008), (.4, -.2, H - .032), segs=6, rings=3, t='gunk', c=(.8, .5, .6), ts=.1)     # gum under the edge
    p.ball((.02, .022, .008), (-.7, .28, H - .034), segs=6, rings=3, t='gunk', c=(.5, .7, .6), ts=.1)


def balloon(p, at, r, c, tilt=(0, 0, 0), flat=0., face=False):
    """A balloon, knot at the origin of `at`, body above. flat: 0 full, 1 a wrinkled skin."""
    k = 1 - flat
    prof = [(0, 0), (.012, .004), (.01, .014), (.03 + .05 * k, .05), (r * (.55 + .2 * k), r * .5), (r * (.8 + .2 * k), r * 1.05), (r * (.86 + .14 * k), r * 1.55), (r * .62, r * 2.0), (r * .25, r * 2.2), (0, r * 2.24)]
    with p.place(at, tilt):
        p.lathe(prof, segs=12, bump=(.006 + .03 * flat, 14 + 20 * flat), t='plastic', c=c, ts=.5)
        if face:
            p.lathe([(0, .008), (r * .3, .005), (r * .52, 0)], (0, -r * .97, r * 1.3), rot=(84, 0, 0), segs=10, disc=True, rect='plush', c=mixc(c, (1, 1, 1), .35))


@prop('balloons', notes='A bunch on strings from a floor weight, drooping to head height and below, with dead ones on the floor. The yellow one has a printed face and hangs at about 1.6 m.')
def balloons(p):
    p.lathe([(0, 0), (.07, 0), (.08, .02), (.06, .07), (.02, .1), (.012, .13)], segs=10, bump=(.004, 30), t='gift', c=(.5, .55, .7), ts=.2)
    p.ring(.014, .003, (0, 0, .14), rot=(90, 0, 0), n=6, segs=3, t='paper', c=(.9, .9, .85))
    ups = [((-.18, -.1, 1.52), .13, 2, 0., True, (6, 4, 0)), ((.2, .08, 1.32), .125, 0, .15, False, (-12, 8, 0)), ((.05, .25, 1.1), .11, 1, .3, False, (20, -10, 0)),
           ((-.3, .15, .9), .1, 3, .45, False, (-25, -30, 0)), ((.33, -.2, .78), .1, 4, .55, False, (35, 20, 0)), ((.0, -.3, 1.0), .11, 5, .35, False, (-30, 5, 0))]
    for (x, y, z), r, ci, flat, face, tilt in ups:
        balloon(p, (x, y, z), r, PASTEL[ci], tilt, flat, face)
        s = [(0, 0, .14), (x * .25 + .04, y * .25, z * .4), (x * .8, y * .8 - .03, z * .8), (x, y, z)]
        p.tube([spline(s, t / 9) for t in range(10)], .0025, segs=3, caps=False, t='paper', c=(.85, .85, .8))
    # the ones that gave up
    downs = [((.42, .3, .035), .1, 0, .8, (80, 0, 30)), ((-.45, -.25, .03), .09, 3, .9, (85, 0, 200)), ((.15, -.5, .045), .11, 4, .7, (75, 0, 110))]
    for (x, y, z), r, ci, flat, tilt in downs:
        with p.place((x, y, z), scale=(1, 1, 1)):
            with p.place(rot=tilt, scale=(1, .45, 1)):
                balloon(p, (0, 0, 0), r, mixc(PASTEL[ci], (.4, .4, .4), .3), (0, 0, 0), flat)
        s = [(0, 0, .13), (x * .5, y * .5 + .05, .01), (x * .9, y * .9, .008), (x, y, z)]
        p.tube([spline(s, t / 7) for t in range(8)], .0025, segs=3, caps=False, t='paper', c=(.85, .85, .8))
    p.sheet(lambda u, v: (-.2 + u * .12 + .03 * math.sin(v * 9), .45 + v * .1, .004 + .012 * abs(math.sin(u * 8 + v * 5))), 4, 4, size=(.12, .1), t='plastic', c=PASTEL[0], ts=.3)   # a burst one


@prop('banner', mount='ceiling', notes='Pennants on a string between two points 4 m apart; origin is midway between them. Sags 0.45 m. One flag is gone and two hang by a corner, so it reads HAPPY BIR HDAY.')
def banner(p):
    word = 'HAPPY BIRTHDAY'
    n = len(word)
    line = lambda x: -.42 * (1 - (x / 2) ** 2)
    p.tube([(x, 0, line(x)) for x in [i / 10 - 2 for i in range(41)]], .004, segs=4, t='paper', c=(.8, .78, .7))
    for s in (-1, 1): p.ring(.012, .003, (s * 2, 0, 0), rot=(90, 0, 0), n=6, segs=3, **CHROME)
    for i, ch in enumerate(word):
        if ch == ' ' or i == 9: continue          # the T went a long time ago
        x = -1.82 + i * 3.64 / (n - 1)
        slope = .42 * 2 * x / 4
        hang = {3: 62, 11: -48}.get(i, 0)         # held by one corner
        col = PASTEL[i % 6]
        with p.place((x, 0, line(x)), rot=(0, -math.degrees(math.atan(slope)), 0)):
            with p.place((-.11 if hang > 0 else .11 if hang < 0 else 0, 0, 0), rot=(0, hang, 0)):
                ox = .11 if hang > 0 else -.11 if hang < 0 else 0

                def flag(u, v, ox=ox, i=i):
                    wdt = .115 * (1 - v)
                    curl = .03 * v * math.sin(u * 3 + i) + .015 * math.sin(v * 5 + i * 2)
                    return (ox + (u - .5) * 2 * wdt, curl, -.012 - v * .3)
                p.sheet(flag, 4, 5, size=(.23, .3), t='paper', c=lambda w, col=col: mixc(col, (.45, .4, .3), max(0, min(1, noise.noise(w * 3) + .2))), ts=.5)
                p.text(ch, .13, (ox, -.012, -.17), depth=.0, c=(.95, .93, .85) if i % 2 else (.15, .12, .15))


@prop('standee', notes='Plywood photo board, cut to the outline of the two mascots, with two face holes at 1.47 and 1.33 m. It is 0.02 m thick on feet 0.4 m deep; seen from behind it is bare ply.')
def standee(p):
    S = atlas.STANDEE

    def top(x):
        z = S['top']
        for key in ('hippo', 'toad'):
            hx, hy, hr = S[key]['head']
            for cx, cy, cr in (S[key]['head'], *S[key]['ears']):
                if abs(x - cx) < cr: z = max(z, cy + math.sqrt(cr * cr - (x - cx) ** 2))
            z = max(z, hy + hr + .13 - 2.51 * abs(x - hx)) if abs(x - hx) < .1 else z      # the party hats
        return min(z, S['h'])
    outline = [(0, 0), (S['w'], 0)] + [(x, top(x)) for x in [S['w'] * (1 - i / 140) for i in range(141)]]
    holes = [[(cx + math.cos(a) * cr, cy + math.sin(a) * cr) for a in [i / 22 * 2 * math.pi for i in range(22)]] for cx, cy, cr in (S['hippo']['hole'], S['toad']['hole'])]
    pts, tris = fill2d(outline, holes)
    X = lambda a: a - S['w'] / 2
    p.add([(X(a), -.01, b) for a, b in pts], tris, uv=[(a / S['w'], b / S['h']) for a, b in pts], rect='standee')
    p.add([(X(a), .01, b) for a, b in pts], tris, t='wood', c=(.8, .75, .7), ts=1.0, flip=True)
    for loop in (outline, *[h[::-1] for h in holes]):
        vs, fs = [], []
        for i, (a, b) in enumerate(loop):
            vs += [(X(a), -.01, b), (X(a), .01, b)]
            j = (i + 1) % len(loop)
            fs.append([2 * i, 2 * j, 2 * j + 1, 2 * i + 1])
        p.add(vs, fs, t='wood', c=(.6, .5, .4), ts=.3)
    for x in (-.6, .6):   # feet and back braces
        p.box((.07, .4, .045), (x, .02, .0225), bevel=.005, t='wood', c=(.75, .7, .62))
        p.tube([(x, .2, .04), (x, .02, .7)], (.02, .012), segs=4, up=(1, 0, 0), t='wood', c=(.75, .7, .62))
    p.box((1.5, .02, .06), (0, .02, .9), t='wood', c=(.75, .7, .62))
    p.box((1.5, .02, .06), (0, .02, .3), t='wood', c=(.75, .7, .62))


@prop('high_chair', notes='Wooden high chair with a tray. Something was left in the bowl.')
def high_chair(p):
    wood = dict(t='wood', c=(.95, .88, .75))
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.tube([(sx * .25, sy * .27 + .02, .008), (sx * .17, sy * .16 + .02, .58)], [.02, .016], segs=6, **wood)
        p.tube([(sx * .232, -.225, .13), (sx * .232, .265, .13)], .012, segs=5, **wood)
        p.tube([(sx * .17, .18, .58), (sx * .16, .22, 1.0)], [.016, .014], segs=6, **wood)         # back posts
        p.tube([(sx * .18, .16, .74), (sx * .2, -.1, .76), (sx * .2, -.22, .75)], .013, segs=5, **wood)    # arms
        p.tube([(sx * .185, -.1, .58), (sx * .2, -.1, .76)], .012, segs=5, **wood)
    p.tube([(-.21, -.2, .3), (.21, -.2, .3)], .014, segs=5, **wood)
    p.box((.36, .1, .015), (0, -.2, .32), rot=(-10, 0, 0), **wood)                                  # footrest
    p.box((.36, .34, .03), (0, .02, .58), bevel=.008, **wood)
    p.sheet(lambda u, v: ((u - .5) * .32, .19 + .03 * (2 * u - 1) ** 2 * -1 + .04 * v, .62 + v * .38), 4, 4, size=(.32, .38), t='wood', c=(.95, .88, .75))
    p.sheet(lambda u, v: ((u - .5) * .3, -.12 + v * .28, .598 + .008 * math.sin(u * 3.14)), 3, 3, size=(.3, .28), t='vinyl', c=(.75, .8, .6))      # pad
    # tray
    p.box((.46, .26, .015), (0, -.2, .765), bevel=.005, t='plastic', c=(.92, .9, .85))
    for q in (((.46, .012, .03), (0, -.33, .785)), ((.012, .26, .03), (-.23, -.2, .785)), ((.012, .26, .03), (.23, -.2, .785))):
        p.box(q[0], q[1], t='plastic', c=(.92, .9, .85))
    p.lathe([(0, .004), (.04, .004), (.065, .04), (.068, .04)], (.05, -.2, .773), segs=10, t='plastic', c=(.5, .7, .85), ts=.3)
    p.ball((.05, .05, .018), (.05, -.2, .796), segs=8, rings=4, bump=(.008, 40), t='gunk', c=(.6, .6, .4), ts=.15)
    p.tube([(.07, -.2, .8), (.16, -.26, .835)], (.006, .002), segs=4, t='plastic', c=(.85, .4, .4))
    p.sheet(lambda u, v: (-.12 + u * .1 + .02 * math.sin(v * 6), -.28 + v * .12, .774), 3, 3, size=(.1, .12), t='gunk', c=(.5, .45, .3), ts=.3)
    # harness straps, hanging
    p.tube([(-.1, .17, .7), (-.11, .05, .62), (-.13, -.05, .6), (-.19, -.12, .5), (-.2, -.14, .4)], (.012, .002), segs=4, up=(0, 0, 1), t='velvet', c=(.2, .2, .35))
    p.tube([(.1, .17, .7), (.1, .03, .62), (.06, -.1, .605)], (.012, .002), segs=4, up=(0, 0, 1), t='velvet', c=(.2, .2, .35))
    p.box((.03, .012, .04), (-.2, -.14, .38), bevel=.003, t='plastic', c=BLACK)
    # a bib over the back post
    p.sheet(lambda u, v: (.16 + .012 * math.sin(v * 5) + (u - .5) * .03, .235 + .01 * u, 1.0 - v * .24 + (u - .5) ** 2 * -.1), 3, 5, size=(.18, .24), t='wrap', c=(.9, .85, .95), ts=.5)


@prop('trash_can', notes='Overflowing swing-top bin; its lid is on the floor beside it and litter spreads about 0.5 m round it.')
def trash_can(p):
    body = dict(t='paint', c=(.25, .35, .3))
    p.lathe([(0, .01), (.2, .01), (.21, 0), (.24, .72), (.25, .74), (.245, .75)], segs=16, bump=(.006, 5), **body)
    p.lathe([(.243, .75), (.26, .7), (.262, .56)], segs=16, bump=(.012, 16), t='plastic', c=(.06, .06, .07), ts=.3)     # the bag folded over the rim
    p.lathe([(.24, .7), (.18, .74), (0, .78)], segs=12, bump=(.02, 12), t='plastic', c=(.06, .06, .07), ts=.3)
    r = p.rng
    for i in range(14):   # the heap
        a, rr = i * 2.1, .05 + .14 * r.random()
        at = (math.cos(a) * rr, math.sin(a) * rr, .8 + r.random() * .13 - rr * .4)
        kind = i % 4
        if kind == 0: p.ball((.07, .06, .05), at, rot=(r.random() * 90, 0, r.random() * 180), segs=7, rings=4, bump=(.02, 30), t='paper', c=PASTEL[i % 6], ts=.2)
        elif kind == 1: cup(p, at, PASTEL[(i + 1) % 6], rot=(r.random() * 120 + 30, r.random() * 60, r.random() * 360))
        elif kind == 2: plate(p, at, rot=(r.random() * 70 - 35, r.random() * 70 - 35, 0), food=(.45, .4, .3))
        else: p.ball((.08, .07, .05), at, segs=7, rings=4, bump=(.025, 25), t='gunk', c=(.5, .45, .35), ts=.2)
    p.box((.34, .34, .035), (.06, .12, .86), rot=(50, 12, 20), t='cardboard', c=(1, .95, .9))                  # a pizza box jammed in
    hat(p, (-.1, -.12, .84), PASTEL[2], rot=(-50, 20, 0))
    # lid, off and leaning on the side
    with p.place((.36, .1, .14), rot=(0, 62, 15)):
        p.lathe([(.255, 0), (.25, .03), (.16, .12), (.1, .15), (0, .16)], segs=16, **body)
        p.box((.2, .16, .004), (0, 0, .14), rot=(0, 20, 0), t='paint', c=(.2, .28, .25))
    # what did not make it in
    cup(p, (-.38, -.2, .036), PASTEL[0], rot=(90, 0, 40))
    cup(p, (.1, -.42, .036), PASTEL[3], rot=(90, 0, 150))
    plate(p, (-.3, .3, .0), rot=(0, 0, 0), food=(.4, .35, .25))
    p.ball((.06, .05, .04), (-.42, .08, .035), segs=7, rings=4, bump=(.02, 30), t='paper', c=PASTEL[4], ts=.2)
    p.ball((.05, .05, .035), (.3, -.25, .03), segs=7, rings=4, bump=(.02, 30), t='paper', c=PASTEL[1], ts=.2)
    p.sheet(lambda u, v: (-.3 + u * .55 + .08 * math.sin(v * 5), -.36 + v * .35 + .06 * math.sin(u * 4), .003), 6, 5, size=(.55, .35), t='gunk', c=(.22, .18, .12), ts=.5)   # it leaked


def gift(p, size, c, ribbon, at, rot=(0, 0, 0), slump=0., bow=True):
    """A wrapped box. slump: how far the damp has let the top cave in."""
    w, d, h = size
    with p.place(at, rot):
        def top(u, v):
            dip = slump * math.sin(u * math.pi) * math.sin(v * math.pi)
            return ((u - .5) * w, (v - .5) * d, h - dip)
        p.sheet(top, 4, 4, size=(w, d), t='gift', c=c)
        vs = [(-w / 2, -d / 2, 0), (w / 2, -d / 2, 0), (w / 2, d / 2, 0), (-w / 2, d / 2, 0), (-w / 2, -d / 2, h), (w / 2, -d / 2, h), (w / 2, d / 2, h), (-w / 2, d / 2, h)]
        dark = lambda q: mixc(c, (.3, .25, .18), max(0, 1 - (p.M.inverted() @ q).z / (h * .6)) * .7)     # wet from the floor up
        p.add(vs, [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], t='gift', c=dark)
        e = .003
        p.box((.03, d + 2 * e, h + e), (0, 0, h / 2), t='velvet', c=ribbon, ts=.3)
        p.box((w + 2 * e, .03, h + e), (0, 0, h / 2), t='velvet', c=ribbon, ts=.3)
        if bow:
            for s in (-1, 1):
                loop = [(0, 0, h - slump), (s * .05, .01, h + .035 - slump), (s * .085, 0, h + .01 - slump), (s * .04, -.01, h - .005 - slump), (0, 0, h - slump)]
                p.tube(loop, (.013, .002), segs=4, caps=False, up=(0, 1, 0), t='velvet', c=ribbon, ts=.3)
                p.tube([(0, 0, h - slump), (s * .06, -.05, h - slump + .004), (s * .09, -.1, h * .8)], (.012, .002), segs=4, caps=False, up=(0, 0, 1), t='velvet', c=ribbon, ts=.3)


@prop('gift_pile', notes='Seven unopened presents, swollen with damp. One has split at a corner.')
def gift_pile(p):
    P = PASTEL
    gift(p, (.45, .35, .25), P[0], (.9, .85, .5), (-.12, .05, 0), (0, 0, 12), slump=.05)
    gift(p, (.3, .3, .3), P[1], (.85, .3, .35), (.3, .12, 0), (0, 0, -20), slump=.03)
    gift(p, (.25, .18, .12), P[3], (.9, .9, .85), (-.1, .03, .21), (0, 4, 40), slump=.02)
    gift(p, (.2, .2, .2), P[4], (.3, .5, .8), (.02, -.3, 0), (0, 0, 50), slump=.03)
    gift(p, (.5, .12, .1), P[2], (.8, .3, .3), (.33, -.22, 0), (0, 0, -65), slump=.015, bow=False)
    gift(p, (.16, .16, .1), P[5], (.5, .75, .5), (.3, .1, .28), (3, -5, 15), slump=.015)
    with p.place((-.42, -.24, .0), rot=(0, 0, 25)):    # this one fell off the pile and split
        gift(p, (.26, .2, .17), P[1], (.9, .85, .5), (0, 0, .13), (0, 100, 0), slump=.02, bow=False)
        p.ball((.07, .06, .05), (.07, -.1, .05), segs=8, rings=5, bump=(.02, 20), t='fur', c=faded(FUR[0], .3), ts=.2)
        p.tufts([((.07 + .05 * math.cos(i), -.12, .05 + .04 * math.sin(i)), (math.cos(i), -1, math.sin(i))) for i in range(9)], length=.05, width=.01, c=faded(FUR[0], .3))
    p.quad([(-.05, -.42, .1), (.01, -.44, .1), (.01, -.44, .16), (-.05, -.42, .16)], t='paper', c=(.95, .9, .8), ts=.2)    # a gift tag
    p.sheet(lambda u, v: (-.5 + u * 1.0 + .06 * math.sin(v * 5), -.45 + v * .8 + .05 * math.sin(u * 6), .003), 6, 5, size=(1, .8), t='gunk', c=(.3, .27, .2), ts=.9,
            keep=lambda u, v: (u - .5) ** 2 + (v - .5) ** 2 < .24)     # the tide mark they stand in
