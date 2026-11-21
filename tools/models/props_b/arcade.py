# Arcade props. Front is -Y, sizes in metres.
import math
from mathutils import Vector, noise
from kit import prop, mixc, fill2d, D
from stage import FUR, faded

BLACK = (.1, .1, .11)
CHROME = dict(t='steel', c=(.8, .8, .82))


def plush(p, c, s=1., lod=0):
    """A cheap prize toy, sitting, about 0.22 m tall, facing -Y."""
    st = dict(t='fur', c=c, ts=.22)
    n = 8 - lod
    with p.place(scale=s):
        p.ball((.07, .06, .075), (0, 0, .07), segs=n, rings=5, **st)
        p.ball((.062, .056, .056), (0, -.012, .17), segs=n, rings=5, **st)
        for sx in (-1, 1):
            p.ball((.024, .012, .024), (sx * .046, 0, .217), segs=6, rings=3, **st)
            p.ball((.022, .022, .046), (sx * .072, -.02, .09), rot=(20, sx * 25, 0), segs=6, rings=4, **st)
            p.ball((.028, .05, .026), (sx * .042, -.062, .026), rot=(0, 0, sx * 20), segs=6, rings=4, **st)
        p.lathe([(0, .012), (.025, .009), (.042, 0)], (0, -.062, .168), rot=(90, 0, 0), segs=8, disc=True, rect='plush', c=mixc(c, (1, 1, 1), .5))


PLUSH_COLS = [faded(c, .3) for c in FUR] + [(.75, .72, .65), (.6, .35, .3)]


@prop('arcade_cabinet', notes='Upright cabinet. Screen is screen_glow, marquee is sign_glow; both take their picture from the art atlas, so tint the emissive rather than replacing the map.')
def arcade_cabinet(p):
    P = [(-.30, 0), (.40, 0), (.40, 1.80), (-.26, 1.80), (-.30, 1.57), (-.16, 1.52), (-.24, 1.05), (-.40, .96), (-.40, .88), (-.30, .82)]
    pts, tris = fill2d(P)
    for s in (-1, 1):
        p.add([(s * .35, a, b) for a, b in pts], tris, uv=[((a + .4) / .8 if s > 0 else 1 - (a + .4) / .8, b / 1.8) for a, b in pts], rect='sideart', flip=s < 0)
        p.add([(s * .33, a, b) for a, b in pts], tris, t='wood', c=(.15, .13, .12), flip=s > 0)
        edge, fs = [], []
        for i, (a, b) in enumerate(P):   # the plastic edging
            edge += [(s * .352, a, b), (s * .328, a, b)]
            j = (i + 1) % len(P)
            fs.append([2 * i, 2 * i + 1, 2 * j + 1, 2 * j])
        p.add(edge, fs, t='plastic', c=(.7, .55, .12), ts=.3)

    def panel(a0, b0, a1, b1, w=.33, **st):
        return p.quad([(-w, a0, b0), (w, a0, b0), (w, a1, b1), (-w, a1, b1)], **st)
    dark = dict(t='laminate', c=(.1, .1, .11))
    panel(-.285, 0, -.285, .82, **dark)
    panel(-.285, .82, -.395, .88, **dark)
    panel(-.395, .88, -.395, .96, t='steel', c=(.5, .5, .5))
    panel(-.395, .96, -.235, 1.05, rect='panel')
    panel(-.235, 1.05, -.155, 1.52, t='plastic', c=(.03, .03, .035))
    panel(-.155, 1.52, -.295, 1.57, t='grille', c=(.25, .25, .25), ts=.1)
    panel(-.295, 1.57, -.255, 1.80, m='sign_glow', rect='marquee')
    panel(.395, 1.80, .395, 0, **dark)
    p.quad([(-.33, -.255, 1.795), (.33, -.255, 1.795), (.33, .395, 1.795), (-.33, .395, 1.795)], **dark)
    # screen, a little proud of the bezel, leaning back with it
    sy = lambda z: -.235 + (z - 1.05) * (.08 / .47) - .004
    p.quad([(-.25, sy(1.1), 1.1), (.25, sy(1.1), 1.1), (.25, sy(1.47), 1.47), (-.25, sy(1.47), 1.47)], m='screen_glow', rect='screen')
    p.text('MASCOT MASH', .078, (0, -.287, 1.655), rot=(80, 0, 0), depth=.004, c=(.06, .03, .08))
    # controls
    with p.place((0, -.315, 1.005), rot=(29.4, 0, 0)):
        p.lathe([(.035, 0), (.03, .012), (.012, .02)], (-.16, 0, 0), segs=10, t='vinyl', c=BLACK)
        p.cyl(.006, .07, (-.16, 0, .015), rot=(8, -12, 0), segs=6, **CHROME)
        p.ball(.021, (-.175, -.01, .095), segs=10, rings=6, t='plastic', c=(.7, .1, .12))
        cols = [(.8, .15, .15), (.9, .75, .15), (.15, .4, .8), (.85, .85, .8), (.15, .6, .3), (.8, .15, .15)]
        for i in range(6):
            x, y = .0 + (i % 3) * .075 + (i // 3) * .02, -.03 + (i // 3) * .065
            p.cyl(.022, .006, (x, y, 0), segs=10, t='plastic', c=BLACK)
            if i == 4: continue                          # a button gone: just the hole
            p.lathe([(.017, 0), (.017, .01), (.012, .014), (0, .015)], (x, y, .004), segs=10, t='plastic', c=cols[i], ts=.2)
        p.lathe([(.014, 0), (.014, .008), (0, .01)], (.26, .03, 0), segs=8, t='plastic', c=(.85, .85, .8))   # start button
    # coin door
    p.box((.36, .018, .4), (0, -.29, .42), bevel=.006, t='paint', c=(.2, .2, .22), ts=.5)
    for x in (-.08, .08):
        p.box((.09, .012, .13), (x, -.303, .5), bevel=.004, t='paint', c=(.12, .12, .13))
        p.box((.05, .006, .06), (x, -.31, .52), t='plastic', c=(.75, .2, .12))
        p.box((.006, .008, .035), (x, -.314, .52), t='plastic', c=(.02, .02, .02))
        p.box((.05, .01, .03), (x, -.308, .455), t='plastic', c=(.02, .02, .02))
    p.cyl(.012, .01, (.13, -.3, .3), rot=(90, 0, 0), segs=8, **CHROME)
    p.box((.66, .02, .08), (0, -.28, .04), t='vinyl', c=BLACK)                # kick plate
    # a paper notice taped to the glass
    p.quad([(.05, sy(1.14) - .003, 1.14), (.22, sy(1.13) - .003, 1.13), (.23, sy(1.25) - .003, 1.25), (.06, sy(1.26) - .003, 1.26)], t='paper', c=(.95, .92, .8), ts=.4)
    p.text('OUT OF', .028, (.14, sy(1.21) - .005, 1.21), rot=(80, 0, -3), c=(.5, .08, .08))
    p.text('ORDER', .028, (.14, sy(1.165) - .005, 1.165), rot=(80, 0, -3), c=(.5, .08, .08))


@prop('claw_machine', notes='Glass on four sides (material glass, alpha blended). The strip under the roof of the glass box is lamp_glow. The claw has a toy by the head.')
def claw_machine(p):
    W = .9
    body = dict(t='paint', c=(.75, .35, .5))
    p.box((W, W, .78), (0, 0, .39), bevel=.01, **body)
    p.box((W + .01, W + .01, .06), (0, 0, .03), t='vinyl', c=BLACK)
    p.box((W + .012, .012, .12), (0, -W / 2, .55), t='paint', c=(.9, .85, .4))      # a stripe
    p.box((W, W, .3), (0, 0, 1.75), bevel=.01, **body)
    p.quad([(-.4, -.452, 1.63), (.4, -.452, 1.63), (.4, -.452, 1.87), (-.4, -.452, 1.87)], rect='stripes')
    p.text('GRAB-A-PAL', .1, (0, -.455, 1.71), depth=.006, c=(.9, .8, .3))
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((.04, .04, .84), (sx * (W / 2 - .02), sy * (W / 2 - .02), 1.19), **CHROME)
    g = W / 2 - .012
    for a in range(4):   # panes
        with p.place(rot=(0, 0, a * 90)):
            p.quad([(-g, -g, .78), (g, -g, .78), (g, -g, 1.6), (-g, -g, 1.6)], m='glass')
    p.box((.7, .7, .012), (0, 0, 1.592), m='lamp_glow')
    p.box((W - .05, W - .05, .01), (0, 0, .785), t='velvet', c=(.25, .1, .3))
    # control shelf and chute
    p.box((.5, .12, .05), (.12, -W / 2 - .05, .8), bevel=.008, t='plastic', c=BLACK)
    p.cyl(.005, .06, (.02, -W / 2 - .05, .825), rot=(-10, 6, 0), segs=6, **CHROME)
    p.ball(.02, (.026, -W / 2 - .06, .895), segs=8, rings=5, t='plastic', c=(.1, .1, .1))
    p.lathe([(.022, 0), (.022, .012), (0, .016)], (.22, -W / 2 - .05, .825), segs=10, t='plastic', c=(.8, .15, .15))
    p.box((.05, .01, .08), (.33, -W / 2 - .006, .68), t='steel', c=(.6, .6, .6))    # coin slot
    p.box((.006, .012, .04), (.33, -W / 2 - .008, .69), t='plastic', c=(.02, .02, .02))
    p.box((.26, .02, .2), (-.26, -W / 2 - .003, .3), t='plastic', c=(.02, .02, .02))  # prize door, pushed in
    p.box((.26, .008, .19), (-.26, -W / 2 + .02, .31), rot=(18, 0, 0), t='plastic', c=(.25, .25, .27))
    p.box((.2, .2, .25), (-.28, -.28, .9), t='plastic', c=(.3, .3, .32))            # chute walls inside
    # the heap
    def mound(u, v):
        x, y = (u - .5) * .84, (v - .5) * .84
        return (x, y, .8 + .2 * (1 - (2 * u - 1) ** 4) * (1 - (2 * v - 1) ** 4) * (.5 + .5 * abs(noise.noise(Vector((x * 5, y * 5, 0))))) + .05 * (x + .4))
    p.sheet(mound, 10, 10, size=(.84, .84), t='fur', c=lambda w: PLUSH_COLS[int(abs(noise.noise(w * 9)) * 40) % len(PLUSH_COLS)], ts=.3)
    r = p.rng
    for i in range(13):
        x, y = (.12 + i % 4 * .2 - .3 + r.random() * .08, i // 4 * .2 - .3 + r.random() * .1)
        if x < -.12 and y < -.12: x += .3
        z = mound((x / .84) + .5, (y / .84) + .5)[2] - .06
        with p.place((x, y, z), rot=(r.random() * 140 - 70, r.random() * 140 - 70, r.random() * 360)):
            plush(p, PLUSH_COLS[i % len(PLUSH_COLS)], 1 + r.random() * .25, lod=1)
    with p.place((.2, -.36, .99), rot=(-14, 6, 8)):   # one pressed up against the front glass, looking out
        plush(p, PLUSH_COLS[0], 1.3)
    # gantry and claw
    p.box((.8, .03, .03), (0, .1, 1.56), **CHROME)
    p.box((.08, .1, .06), (.1, .1, 1.54), t='plastic', c=BLACK)
    p.tube([(.1, .1, 1.52), (.1, .1, 1.36)], .003, segs=4, t='plastic', c=BLACK)
    p.cyl(.03, .05, (.1, .1, 1.31), segs=8, **CHROME)
    for i in range(3):
        a = D(90 + i * 120)
        cx, cy = math.cos(a), math.sin(a)
        p.tube([(.1 + cx * .02, .1 + cy * .02, 1.32), (.1 + cx * .09, .1 + cy * .09, 1.27), (.1 + cx * .095, .1 + cy * .095, 1.2), (.1 + cx * .05, .1 + cy * .05, 1.15)], (.007, .003), segs=4, up=(cx, cy, 0), **CHROME)
    with p.place((.1, .1, 1.0), rot=(0, 0, 200)):
        plush(p, PLUSH_COLS[2], 1.15)


@prop('skee_ball', notes='Lane runs back from the player along +Y in Blender (-Z in three.js); the origin is the centre of the 0.8 x 2.8 cabinet. Tickets and a stray ball lie on the floor up to 0.35 m in front of it. Wants a wall behind it.')
def skee_ball(p):
    side = dict(t='paint', c=(.3, .45, .7))
    wood = dict(t='wood', c=(.9, .8, .65))
    # lane cabinet: front at y=-1.4, lane top rises from 0.72 to 0.8
    y0, y1 = -1.4, .55
    lane = [(-.4, y0, 0), (.4, y0, 0), (.4, y1, 0), (-.4, y1, 0), (-.4, y0, .68), (.4, y0, .68), (.4, y1, .78), (-.4, y1, .78)]
    p.add(lane, [[0, 1, 5, 4], [1, 2, 6, 5], [3, 0, 4, 7]], **side)
    p.add([(-.28, y0, .72), (.28, y0, .72), (.28, y1, .8), (-.28, y1, .8)], [[0, 1, 2, 3]], t='laminate', c=(.5, .38, .3), ts=1.2)
    for s in (-1, 1):   # rails
        p.add([(s * .28, y0, .68), (s * .4, y0, .68), (s * .4, y1, .78), (s * .28, y1, .78), (s * .28, y0, .8), (s * .4, y0, .8), (s * .4, y1, .9), (s * .28, y1, .9)],
              [[4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [0, 1, 5, 4]], flip=s < 0, **wood)
    p.box((.56, .03, .1), (0, y0 + .015, .73), bevel=.008, **wood)
    # the hop at the end of the lane
    p.sheet(lambda u, v: ((u - .5) * .56, y1 - .22 + v * .22, .795 + .09 * v * v), 2, 5, size=(.56, .25), t='laminate', c=(.5, .38, .3))
    # target box behind, board sloping up from 0.8 to 1.4
    ya, yb = y1, 1.4
    hood = [(-.4, ya, 0), (.4, ya, 0), (.4, yb, 0), (-.4, yb, 0), (-.4, ya, .9), (.4, ya, .9), (.4, yb, 1.6), (-.4, yb, 1.6), (-.4, ya + .25, 1.6), (.4, ya + .25, 1.6)]
    p.add(hood, [[1, 2, 6, 9, 5], [3, 0, 4, 8, 7], [2, 3, 7, 6], [8, 9, 6, 7], [0, 1, 5, 4]], **side)
    board = lambda t: (ya + .02 + t * (yb - ya - .1), .82 + t * .58)
    p.quad([(-.39, *board(0)), (.39, *board(0)), (.39, *board(1)), (-.39, *board(1))], t='velvet', c=(.12, .25, .2))
    tilt = math.degrees(math.atan2(.58, yb - ya - .1))

    def cup(x, t, r, deep=False):
        y, z = board(t)
        with p.place((x, y, z), rot=(tilt, 0, 0)):
            p.ring(r, .016, (0, 0, .016), n=14, segs=5, t='plastic', c=(.85, .8, .7))
            if deep: p.cyl(r * .85, .004, (0, 0, .002), segs=12, t='plastic', c=(.01, .01, .01))
    cup(0, .42, .3); cup(0, .37, .19); cup(0, .33, .095, True); cup(0, .68, .085, True)
    cup(-.27, .86, .075, True); cup(.27, .86, .075, True); cup(0, .9, .075, True)
    for x, t, s in ((0, .19, '10'), (0, .52, '30'), (0, .78, '40'), (-.27, .97, '100'), (.27, .97, '100'), (-.19, .3, '20')):
        y, z = board(t)
        p.text(s, .05, (x, y - .004, z + .004), rot=(tilt, 0, 0), c=(.9, .85, .6))
    # wire cage over the board
    for i in range(5):
        x = -.36 + i * .18
        p.tube([(x, ya + .03, .93), (x, ya + .3, 1.5), (x, yb - .12, 1.58)], .004, segs=3, **CHROME)
    for t in (.3, .6, .9):
        y, z = ya + .03 + t * .27, .93 + t * .57
        p.tube([(-.38, y, z), (.38, y, z)], .004, segs=3, **CHROME)
    # score head
    p.box((.8, .2, .22), (0, yb - .1, 1.49), **side)
    p.quad([(-.3, yb - .202, 1.41), (.3, yb - .202, 1.41), (.3, yb - .202, 1.57), (-.3, yb - .202, 1.57)], t='plastic', c=(.03, .03, .03))
    p.text('0 4 0', .11, (0, yb - .206, 1.45), depth=.003, c=(.5, .12, .1))
    # ball return, coin box, and the tickets it never paid out
    p.box((.3, .02, .13), (-.2, y0 - .002, .5), t='plastic', c=(.02, .02, .02))
    p.box((.34, .1, .02), (-.2, y0 - .05, .43), bevel=.005, **wood)
    for i, x in enumerate((-.3, -.215, -.12)):
        p.ball(.04, (x, y0 - .05 + .01 * (i % 2), .48), segs=10, rings=6, t='wood', c=(.55, .4, .35), ts=.2)
    p.ball(.04, (.3, y0 - .32, .04), segs=10, rings=6, t='wood', c=(.55, .4, .35), ts=.2)         # one got away
    p.box((.16, .02, .22), (.24, y0 - .008, .45), bevel=.005, t='steel', c=(.6, .6, .62))
    p.box((.006, .01, .04), (.24, y0 - .02, .5), t='plastic', c=(.02, .02, .02))
    p.box((.1, .012, .02), (.24, y0 - .012, .26), t='plastic', c=(.02, .02, .02))

    def strip(u, v):   # tickets spooling out of the slot and folding on the floor
        s = v * 1.1
        if s < .24: return (.2 + u * .06, y0 - .02 - .04 * math.sin(s * 5), .26 - s)
        k = s - .24
        return (.2 + u * .06 + .1 * math.sin(k * 5), y0 - .06 - k * .25 + .05 * math.sin(k * 14), .012 + .01 * abs(math.sin(k * 14)))
    p.sheet(strip, 1, 40, size=(.06, 1.1), t='paper', c=(.95, .78, .3), ts=.3)


@prop('prize_counter', notes='Glass fronted and glass topped (material glass). The staff side is +Y in Blender.')
def prize_counter(p):
    W, Dp, H = 2.0, .6, 1.0
    p.box((W, Dp, .14), (0, 0, .07), t='vinyl', c=BLACK)
    p.box((W, .02, H - .14), (0, Dp / 2 - .01, .14 + (H - .14) / 2), t='wood', c=(.7, .6, .55))       # back, with sliding doors
    for x in (-.5, .5): p.box((.98, .012, H - .24), (x, Dp / 2 + .008 * (1 if x > 0 else -.3), .57), t='wood', c=(.6, .5, .45))
    p.box((W, Dp, .02), (0, 0, .15), t='laminate', c=(.8, .8, .85))
    for sx in (-1, 1): p.box((.02, Dp, H - .14), (sx * (W / 2 - .01), 0, .57), t='laminate', c=(.8, .8, .85))
    for sx in (-1, 0, 1):     # chrome frame
        p.box((.025, .025, H - .14), (sx * (W / 2 - .0125), -Dp / 2 + .0125, .57), **CHROME)
    for z in (.165, H - .0125): p.box((W, .025, .025), (0, -Dp / 2 + .0125, z), **CHROME)
    p.box((W, .025, .025), (0, Dp / 2 - .0125, H - .0125), **CHROME)
    for sx in (-1, 1): p.box((.025, Dp, .025), (sx * (W / 2 - .0125), 0, H - .0125), **CHROME)
    p.quad([(-W / 2, -Dp / 2 + .004, .16), (W / 2, -Dp / 2 + .004, .16), (W / 2, -Dp / 2 + .004, H - .01), (-W / 2, -Dp / 2 + .004, H - .01)], m='glass')
    p.quad([(-W / 2, -Dp / 2, H - .004), (W / 2, -Dp / 2, H - .004), (W / 2, Dp / 2, H - .004), (-W / 2, Dp / 2, H - .004)], m='glass')
    p.box((W - .04, Dp - .1, .008), (0, .03, .58), m='glass')
    for x in (-.6, .6): p.box((.02, .02, .42), (x, -.1, .37), **CHROME)
    # the prizes, such as they are
    lo, hi = .16, .585
    r = p.rng
    for i, (x, z, c) in enumerate([(-.82, hi, 4), (-.62, hi, 1), (.75, lo, 5), (.5, lo, 3)]):
        with p.place((x, .05, z), rot=(0, 0, r.random() * 50 - 25) if i != 1 else (-80, 0, 30)):
            plush(p, PLUSH_COLS[c], 1.1)
    for i in range(4):
        x = -.3 + i * .16
        p.quad([(x - .06, .12, hi + .004), (x + .06, .1, hi + .004), (x + .06, .2, hi + .24), (x - .06, .22, hi + .24)], rect=f'box{i}')
        p.box((.12, .035, .24), (x, .18, hi + .12), rot=(-22, 0, -9), t='cardboard', c=(.8, .8, .8))
    p.lathe([(.07, 0), (.085, .02), (.085, .14), (.06, .17), (.06, .19)], (.45, 0, hi + .004), segs=12, m='glass')          # a sweet jar
    for i in range(9):
        a = i * 2.4
        p.ball(.022, (.45 + .04 * math.cos(a), .04 * math.sin(a), hi + .03 + .012 * (i % 3)), segs=6, rings=4, t='plastic', c=((.8, .2, .2), (.2, .5, .8), (.9, .8, .2))[i % 3], ts=.2)
    p.lathe([(.05, 0), (.065, .005), (.065, .012), (0, .012)], (.45, 0, hi + .19), segs=12, t='plastic', c=(.7, .15, .15))
    for i in range(7):    # a row of little pots of slime
        p.cyl(.03, .035, (.68 + (i % 4) * .07, -.1 + (i // 4) * .08, hi + .004), segs=8, t='plastic', c=((.3, .7, .3), (.8, .3, .6), (.3, .5, .8))[i % 3], ts=.2)
    for i in range(10):   # plastic rings on a card
        p.ring(.012, .003, (-.75 + (i % 5) * .05, -.12 + (i // 5) * .06, lo + .012), n=6, segs=3, t='plastic', c=((.8, .2, .2), (.2, .2, .2), (.9, .8, .2))[i % 3])
    p.quad([(-.79, -.16, lo + .006), (-.5, -.16, lo + .006), (-.5, -.02, lo + .006), (-.79, -.02, lo + .006)], t='paper', c=(.9, .9, .85), ts=.3)
    for i in range(3):    # ticket rolls
        p.lathe([(.015, 0), (.05, 0), (.05, .03), (.015, .03)], (-.3 + i * .12, -.08, lo + .004 + (.03 if i == 1 else 0)), segs=10, t='paper', c=(.9, .75, .3), ts=.2)
    for i in range(5):    # bouncy balls in a tray
        p.ball(.028, (.05 + i * .06, -.12 + .03 * (i % 2), lo + .035), segs=7, rings=4, t='plastic', c=((.8, .3, .2), (.3, .6, .3), (.5, .3, .7), (.9, .8, .3))[i % 4], ts=.2)
    p.box((.36, .14, .02), (.17, -.1, lo + .012), t='plastic', c=(.2, .2, .22))
    for i, (x, z) in enumerate([(-.82, hi), (-.3, hi), (.45, hi), (.75, hi), (.6, lo), (-.6, lo), (.15, lo)]):   # price cards, curling
        p.quad([(x - .03, -.23, z + .004), (x + .03, -.23, z + .004), (x + .03, -.215, z + .05), (x - .03, -.215, z + .05)], t='paper', c=(.95, .9, .6), ts=.25)
    # on top: a bell and a ticket eater's worth of dust
    p.lathe([(.05, 0), (.048, .02), (.03, .04), (0, .045)], (-.7, .1, H), segs=12, **CHROME)
    p.cyl(.006, .012, (-.7, .1, H + .045), segs=6, t='plastic', c=BLACK)
    p.cyl(.055, .006, (-.7, .1, H), segs=12, t='plastic', c=BLACK)


@prop('stool', notes='Bolted to the floor on a flange; 0.62 m to the seat.')
def stool(p):
    p.lathe([(0, 0), (.15, 0), (.15, .008), (.05, .02), (.035, .05)], segs=16, **CHROME)
    for i in range(4):
        a = D(45 + i * 90)
        p.cyl(.012, .01, (math.cos(a) * .115, math.sin(a) * .115, .008), segs=6, t='rust', c=(1, 1, 1))
    p.cyl(.03, .5, (0, 0, .04), segs=10, **CHROME)
    p.ring(.14, .01, (0, 0, .2), n=16, segs=5, **CHROME)                          # foot ring
    for i in range(3):
        a = D(i * 120)
        p.tube([(math.cos(a) * .03, math.sin(a) * .03, .2), (math.cos(a) * .14, math.sin(a) * .14, .2)], .007, segs=4, **CHROME)
    p.lathe([(.03, .5), (.09, .54), (.165, .555)], segs=16, **CHROME)
    seat = [(.165, .555), (.185, .565), (.19, .59), (.175, .615), (.1, .625), (0, .62)]
    p.lathe(seat, segs=18, bump=(.004, 12), t='vinyl', c=(.6, .12, .12))
    p.ring(.188, .005, (0, 0, .575), n=18, segs=4, t='vinyl', c=(.85, .8, .7))      # piping
    # split seam with the foam coming through
    p.ball((.05, .025, .012), (.07, -.09, .618), rot=(0, 0, 35), segs=8, rings=4, bump=(.004, 30), t='gunk', c=(.9, .75, .4), ts=.15)
    p.ball((.03, .03, .004), (-.08, .04, .626), segs=8, rings=3, t='gunk', c=(.3, .25, .2), ts=.1)   # something dried on it
