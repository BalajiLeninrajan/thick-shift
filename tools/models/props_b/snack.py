# Snack bar props. Front is -Y, sizes in metres.
import math
from mathutils import Vector, noise
from kit import prop, mixc, D
from party import cup, PASTEL

BLACK = (.1, .1, .11)
CHROME = dict(t='steel', c=(.8, .8, .82))
SS = dict(t='steel', c=(.82, .83, .85))
RED, CREAM = (.7, .15, .14), (.92, .88, .76)


def bottle(p, at, c):
    p.lathe([(0, 0), (.028, 0), (.03, .1), (.02, .14), (.008, .17), (.004, .2), (0, .2)], at, segs=8, t='plastic', c=c, ts=.3)


@prop('snack_counter', notes='Serving counter, customers on the -Y side in Blender (+Z in three.js). 1.1 m to the top; the till and sneeze guard stand above that. The staff side is open shelving.')
def snack_counter(p):
    W, Dp, H = 3.0, .8, 1.1
    # the front is tongue and groove boards, painted in candy stripes long ago
    n = 20
    for i in range(n):
        x = -W / 2 + (i + .5) * W / n
        p.box((W / n - .006, .025, H - .16), (x, -Dp / 2 + .08 + .003 * ((i * 7) % 3), .1 + (H - .16) / 2), bevel=.004, t='paint', c=RED if i % 2 else CREAM, ts=1.1)
    p.box((W, .03, .1), (0, -Dp / 2 + .09, .05), t='vinyl', c=BLACK)                      # kick plate
    p.box((W, .02, .04), (0, -Dp / 2 + .062, .32), bevel=.004, **CHROME)                   # foot rail mounts
    p.tube([(-W / 2 + .05, -Dp / 2 + .02, .22), (W / 2 - .05, -Dp / 2 + .02, .22)], .018, segs=8, **CHROME)
    for x in (-1.3, -.45, .45, 1.3): p.tube([(x, -Dp / 2 + .02, .22), (x, -Dp / 2 + .07, .26)], .012, segs=5, **CHROME)
    p.box((W, Dp, .045), (0, 0, H - .0225), bevel=.008, t='laminate', c=(.88, .85, .8), ts=1.0)
    p.box((W + .004, .01, .05), (0, -Dp / 2, H - .0225), **CHROME)
    for sx in (-1, 1): p.box((.03, Dp - .12, H - .045), (sx * (W / 2 - .015), .06, (H - .045) / 2), t='laminate', c=(.6, .58, .55))
    for x in (-.5, .5): p.box((.02, Dp - .14, H - .045), (x, .07, (H - .045) / 2), t='laminate', c=(.5, .48, .45))
    p.box((W - .04, .02, H - .1), (0, -Dp / 2 + .1, (H - .1) / 2 + .05), t='wood', c=(.3, .28, .26))    # the back of the boards
    for z in (.12, .6): p.box((W - .06, Dp - .16, .02), (0, .07, z), t='laminate', c=(.7, .68, .65))
    T = H + .001
    # the till
    with p.place((-.9, .05, T), rot=(0, 0, 8)):
        p.box((.4, .42, .1), (0, 0, .05), bevel=.008, t='plastic', c=(.75, .72, .65))
        p.box((.36, .3, .012), (0, -.19, .035), t='plastic', c=(.2, .2, .2))              # the drawer, out
        for i in range(4): p.box((.07, .2, .02), (-.13 + i * .087, -.24, .045), t='plastic', c=(.1, .1, .1))
        for i in range(3): p.cyl(.012, .002, (-.13 + i * .087, -.26 + .02 * i, .056), segs=6, t='steel', c=(.7, .6, .3))
        body = [(-.2, -.2, .1), (.2, -.2, .1), (.2, .2, .1), (-.2, .2, .1), (-.2, -.16, .14), (.2, -.16, .14), (.2, .2, .26), (-.2, .2, .26), (-.2, .06, .26), (.2, .06, .26)]
        p.add(body, [[0, 1, 5, 4], [1, 2, 6, 9, 5], [3, 0, 4, 8, 7], [2, 3, 7, 6], [8, 9, 6, 7]], t='plastic', c=(.75, .72, .65))
        p.add([body[4], body[5], body[9], body[8]], [[0, 1, 2, 3]], t='plastic', c=(.7, .68, .6))
        tilt = math.degrees(math.atan2(.12, .22))
        p.quad([(-.16, -.14, .152), (.06, -.14, .152), (.06, .04, .25), (-.16, .04, .25)], rect='keys')
        p.box((.09, .16, .012), (.13, -.05, .21), rot=(tilt, 0, 0), t='plastic', c=(.25, .25, .25))
        p.box((.24, .05, .09), (0, .12, .31), rot=(-15, 0, 0), bevel=.006, t='plastic', c=(.2, .2, .2))     # the display
        p.box((.2, .004, .05), (0, .093, .312), rot=(-15, 0, 0), t='mirror', c=(.12, .2, .12), ts=.4)
        p.sheet(lambda u, v: (.13 + (u - .5) * .06, v * .1, .262 + .1 * math.sin(v * 2.6) - .02 * v), 1, 6, size=(.06, .25), t='paper', c=(.95, .95, .9), ts=.3)   # receipt roll
    # napkin dispenser
    with p.place((.35, -.1, T), rot=(0, 0, -12)):
        p.box((.14, .1, .2), (0, 0, .1), bevel=.008, **SS)
        p.box((.1, .004, .14), (0, -.051, .1), t='plastic', c=(.02, .02, .02))
        p.sheet(lambda u, v: ((u - .5) * .09, -.052 - .035 * math.sin(v * 2.5), .1 + (v - .5) * .09 - .02 * v * v), 2, 4, size=(.09, .1), t='paper', c=(.93, .93, .9), ts=.3)
    # sneeze guard over a tray of what was for sale
    for x in (.75, 1.4):
        p.tube([(x, -.2, T), (x, -.2, T + .32), (x, -.05, T + .4)], .01, segs=5, **CHROME)
    p.quad([(.7, -.26, T + .08), (1.45, -.26, T + .08), (1.45, -.03, T + .4), (.7, -.03, T + .4)], m='glass')
    p.box((.6, .34, .03), (1.07, .05, T + .015), **SS)
    for i in range(6):   # hot dogs, furred
        x = .84 + i * .09
        p.tube([(x, -.06, T + .045), (x + .01, .05, T + .05), (x, .16, T + .045)], [.016, .02, .016], segs=6, bump=(.004, 40), t='gunk', c=(.55, .3, .25) if i % 3 else (.4, .45, .35), ts=.15)
    # bottles, cups, straws, a tip jar
    bottle(p, (.1, .12, T), (.7, .12, .1)); bottle(p, (.17, .15, T), (.85, .7, .15))
    for i in range(6): cup(p, (-.3, .1, T + i * .013), PASTEL[1])       # a stack of cups
    cup(p, (-.15, -.2, T + .036), PASTEL[4], rot=(90, 0, 30))
    p.lathe([(0, .004), (.045, 0), (.045, .13), (.047, .13)], (-.02, .15, T), segs=10, **SS)
    for i in range(9):
        a = i * 2.4
        p.tube([(-.02 + .02 * math.cos(a), .15 + .02 * math.sin(a), T + .01), (-.02 + .045 * math.cos(a), .15 + .045 * math.sin(a), T + .21)], .003, segs=3, t='plastic', c=((.85, .2, .2), (.9, .9, .9))[i % 2])
    p.lathe([(0, .004), (.05, 0), (.055, .12), (.045, .14), (.045, .15)], (-.55, -.2, T), segs=10, m='glass')
    p.cyl(.045, .012, (-.55, -.2, T + .004), segs=8, t='steel', c=(.6, .5, .3))
    p.quad([(-.6, -.251, T + .04), (-.5, -.251, T + .04), (-.5, -.251, T + .1), (-.6, -.251, T + .1)], t='paper', c=(.95, .9, .7), ts=.3)
    p.sheet(lambda u, v: (-1.35 + u * .4 + .05 * math.sin(v * 6), -.3 + v * .3, T + .001), 4, 3, size=(.4, .3), t='gunk', c=(.3, .15, .1), ts=.6)     # a spill that set
    # under the counter on the staff side
    p.box((.4, .3, .3), (-1.0, .1, .28), t='cardboard', c=(1, 1, 1))
    p.box((.35, .3, .25), (.0, .12, .255), rot=(0, 0, 6), t='cardboard', c=(.9, .9, .9))
    for i in range(3): p.lathe([(0, 0), (.1, 0), (.1, .3), (.04, .36), (.04, .4), (0, .4)], (1.0 + i * .22 - .22, .1, .13), segs=10, t='plastic', c=((.2, .3, .6), (.75, .75, .7), (.6, .2, .15))[i])


@prop('soda_machine', notes='Vending machine, 1.0 x 0.76 m. The whole lit front is sign_glow and takes its picture from the art atlas; parts of it are dead. A power lead trails 0.3 m out of the back and a dried puddle of syrup reaches 0.2 m out in front.')
def soda_machine(p):
    W, Dp, H = 1.0, .76, 1.9
    body = dict(t='paint', c=(.2, .25, .5))
    p.box((W, Dp, H - .06), (0, .02, .06 + (H - .06) / 2), bevel=.012, **body)
    for sx in (-1, 1):
        for sy in (-1, 1): p.cyl(.03, .06, (sx * .42, sy * .3 + .02, 0), segs=8, t='vinyl', c=BLACK)
    yf = -Dp / 2 + .02
    p.box((W - .04, .03, H - .12), (0, yf - .005, .06 + (H - .06) / 2), bevel=.008, t='plastic', c=(.07, .07, .09))      # the door frame
    p.quad([(-.44, yf - .022, .13), (.44, yf - .022, .13), (.44, yf - .022, 1.83), (-.44, yf - .022, 1.83)], m='sign_glow', rect='soda')
    p.text('FIZZ', .2, (-.12, yf - .026, 1.55), depth=.006, c=(.95, .93, .85))
    p.text('ICE COLD', .07, (-.12, yf - .026, 1.44), depth=.004, c=(.9, .8, .3))
    for i in range(6):    # selection buttons, each with a dead lamp
        z = 1.45 - i * .13
        p.box((.2, .014, .09), (.3, yf - .028, z), bevel=.006, t='plastic', c=(.2, .2, .22))
        p.box((.12, .006, .05), (.27, yf - .037, z), t='plastic', c=PASTEL[i])
        p.cyl(.008, .006, (.37, yf - .036, z), rot=(90, 0, 0), segs=6, t='plastic', c=(.5, .08, .05) if i != 2 else (.1, .1, .1))
    p.box((.2, .014, .18), (.3, yf - .028, .62), bevel=.006, **CHROME)                       # coins and notes
    p.box((.008, .01, .05), (.26, yf - .037, .66), t='plastic', c=(.02, .02, .02))
    p.box((.09, .01, .012), (.33, yf - .037, .66), t='plastic', c=(.02, .02, .02))
    p.box((.08, .014, .05), (.3, yf - .034, .57), t='plastic', c=(.05, .05, .05))
    # delivery bin: a recess, a flap hanging open, one can that never dropped clear
    p.box((.62, .1, .16), (-.08, yf + .03, .22), t='plastic', c=(.02, .02, .02))
    p.box((.62, .01, .15), (-.08, yf - .03, .27), rot=(40, 0, 0), t='plastic', c=(.35, .35, .38))
    p.lathe([(0, 0), (.033, 0), (.033, .12), (.028, .125), (0, .125)], (-.2, yf - .005, .18), rot=(0, 90, 12), segs=10, t='paint', c=(.75, .2, .15), ts=.2)
    # side louvres, a dent, the lead
    for s in (-1, 1):
        p.quad([(s * (W / 2 + .001), -.2 * s, .2), (s * (W / 2 + .001), .25 * s, .2), (s * (W / 2 + .001), .25 * s, .5), (s * (W / 2 + .001), -.2 * s, .5)], t='grille', c=(.3, .3, .35), ts=.15)
    p.ball((.16, .02, .2), (-.3, yf - .012, .9), segs=8, rings=5, t='plastic', c=(.03, .03, .04))    # where it was kicked, more than once
    p.tube([(.3, Dp / 2 + .02, .2), (.33, Dp / 2 + .1, .05), (.2, Dp / 2 + .2, .012), (-.1, Dp / 2 + .28, .012), (-.3, Dp / 2 + .2, .012)], .008, segs=5, t='plastic', c=BLACK)
    p.box((.3, .2, .004), (0, .1, H + .002), rot=(0, 0, 14), t='cardboard', c=(.9, .9, .9))           # a flattened box on top
    p.sheet(lambda u, v: (-.3 + u * .5, yf - .3 + v * .32, .003), 5, 4, size=(.5, .32), t='gunk', c=(.25, .15, .1), ts=.5,
            keep=lambda u, v: (u - .5) ** 2 + (v - .6) ** 2 < .22)                                      # syrup


@prop('popcorn_cart', notes='Popcorn machine on a two-wheeled cart. Glass case (material glass) with the kettle inside; the heat lamp under the roof is lamp_glow. Handle is on the +X side in Blender.')
def popcorn_cart(p):
    W, Dp = .7, .56
    red = dict(t='paint', c=RED)
    # cart
    p.box((W, Dp, .42), (0, 0, .7), bevel=.01, **red)
    p.box((W + .03, Dp + .03, .03), (0, 0, .925), bevel=.006, t='steel', c=(.75, .65, .35))
    p.box((W + .03, Dp + .03, .03), (0, 0, .49), bevel=.006, t='steel', c=(.75, .65, .35))
    p.text('POPCORN', .1, (0, -Dp / 2 - .006, .66), depth=.008, c=(.9, .8, .4))
    for s in (-1, 1):     # spoked wheels
        y = s * (Dp / 2 + .035)
        p.ring(.24, .016, (-.12, y, .255), rot=(90, 0, 0), n=18, segs=5, t='vinyl', c=BLACK)
        p.ring(.215, .012, (-.12, y, .255), rot=(90, 0, 0), n=18, segs=4, **red)
        p.cyl(.03, .05, (-.12, y - .025, .255), rot=(-90, 0, 0), segs=8, t='steel', c=(.75, .65, .35))
        for i in range(8):
            a = D(i * 45 + 10)
            p.tube([(-.12, y, .255), (-.12 + math.cos(a) * .215, y, .255 + math.sin(a) * .215)], .006, segs=4, caps=False, **red)
    p.tube([(-.12, -Dp / 2 - .03, .255), (-.12, Dp / 2 + .03, .255)], .012, segs=6, **CHROME)
    for s in (-1, 1):
        p.tube([(.28, s * .22, .49), (.3, s * .23, .0)], .016, segs=6, **red)                        # front legs
        p.tube([(W / 2, s * .2, .8), (W / 2 + .12, s * .2, .86)], .012, segs=5, **CHROME)
    p.tube([(W / 2 + .12, -.22, .86), (W / 2 + .12, .22, .86)], .016, segs=6, t='wood', c=(.7, .55, .4))
    # glass case
    z0, z1 = .94, 1.48
    for sx in (-1, 1):
        for sy in (-1, 1): p.box((.025, .025, z1 - z0), (sx * (W / 2 - .0125), sy * (Dp / 2 - .0125), (z0 + z1) / 2), t='steel', c=(.75, .65, .35))
    gx, gy = W / 2 - .008, Dp / 2 - .008
    p.quad([(-gx, -gy, z0), (gx, -gy, z0), (gx, -gy, z1), (-gx, -gy, z1)], m='glass')
    p.quad([(gx, gy, z0), (-gx, gy, z0), (-gx, gy, z1), (gx, gy, z1)], m='glass')
    p.quad([(-gx, gy, z0), (-gx, -gy, z0), (-gx, -gy, z1), (-gx, gy, z1)], m='glass')
    p.quad([(gx, -gy, z0), (gx, gy, z0), (gx, gy, z0 + .28), (gx, -gy, z0 + .28)], m='glass')      # the serving side is half open
    p.box((W - .02, Dp - .02, .008), (0, 0, z0 + .004), **SS)
    # roof: a striped canopy with a scalloped edge
    r0 = [(-W / 2 - .04, -Dp / 2 - .04), (W / 2 + .04, -Dp / 2 - .04), (W / 2 + .04, Dp / 2 + .04), (-W / 2 - .04, Dp / 2 + .04)]
    r1 = [(-.16, -.1), (.16, -.1), (.16, .1), (-.16, .1)]
    for i in range(4):
        a, b = r0[i], r0[(i + 1) % 4]
        c_, d_ = r1[(i + 1) % 4], r1[i]
        p.quad([(a[0], a[1], z1 + .03), (b[0], b[1], z1 + .03), (c_[0], c_[1], 1.66), (d_[0], d_[1], 1.66)], rect='stripes')
        p.quad([(a[0], a[1], z1 - .03), (b[0], b[1], z1 - .03), (b[0], b[1], z1 + .03), (a[0], a[1], z1 + .03)], t='paint', c=RED, ts=.4)
    p.quad([(q[0], q[1], 1.66) for q in r1], t='paint', c=RED, ts=.4)
    p.lathe([(.03, 0), (.035, .012), (.012, .025), (.018, .035), (0, .045)], (0, 0, 1.66), segs=8, t='steel', c=(.75, .65, .35))
    p.quad([(-W / 2 - .03, Dp / 2 + .03, z1 - .028), (W / 2 + .03, Dp / 2 + .03, z1 - .028), (W / 2 + .03, -Dp / 2 - .03, z1 - .028), (-W / 2 - .03, -Dp / 2 - .03, z1 - .028)], **SS)
    # kettle on its arm, the heat lamp, and what is left of the corn
    p.lathe([(.035, 0), (.07, -.01)], (.14, .0, z1 - .032), segs=10, t='steel', c=(.6, .6, .6))
    p.lathe([(0, -.035), (.03, -.03), (.04, 0)], (.14, .0, z1 - .042), segs=10, m='lamp_glow')
    p.tube([(-.15, 0, z1 - .03), (-.15, 0, z1 - .14)], .008, segs=5, **CHROME)
    with p.place((-.15, 0, z1 - .28), rot=(0, 24, 0)):
        p.lathe([(0, .004), (.1, 0), (.11, .13), (.115, .135), (.105, .13), (.097, .01), (0, .012)], segs=14, t='steel', c=(.7, .68, .6))
        p.tube([(-.11, 0, .12), (-.11, 0, .17), (0, 0, .2), (.11, 0, .17), (.11, 0, .12)], .005, segs=4, **CHROME)
        p.ball((.09, .09, .02), (0, 0, .07), segs=8, rings=3, bump=(.006, 40), t='gunk', c=(.25, .2, .12), ts=.2)

    def corn(u, v):
        x, y = (u - .5) * (W - .05), (v - .5) * (Dp - .05)
        return (x, y, z0 + .012 + .1 * max(0, 1 - ((x + .1) / .3) ** 2 - (y / .25) ** 2) + .025 * abs(noise.noise(Vector((x * 22, y * 22, 0)))))
    p.sheet(corn, 14, 11, size=(W, Dp), t='gunk', c=(.95, .88, .65), ts=.28)
    p.lathe([(0, 0), (.035, 0), (.05, .14)], (.2, -.12, z0 + .01), rot=(0, 15, 0), segs=4, wrap=True, rect='stripes')      # a bag, still standing
    p.box((.09, .05, .004), (.42, -.1, .945), rot=(0, 0, 30), t='steel', c=(.7, .7, .7))                       # the scoop
    p.sheet(lambda u, v: (W / 2 + .02 + u * .3, -.2 + v * .4, .004 + .012 * abs(noise.noise(Vector((u * 9, v * 9, 3))))), 6, 7, size=(.3, .4), t='gunk', c=(.9, .82, .6), ts=.25,
            keep=lambda u, v: noise.noise(Vector((u * 5, v * 5, 1))) > -.1)                                     # spilt on the floor


@prop('bar_stool', notes='Four-legged bar stool, 0.76 m to the seat, with a low back rail.')
def bar_stool(p):
    for i in range(4):
        a = D(45 + i * 90)
        cx, cy = math.cos(a), math.sin(a)
        p.tube([(cx * .25, cy * .25, .006), (cx * .16, cy * .16, .72)], .014, segs=6, **CHROME)
        p.ball((.02, .02, .012), (cx * .25, cy * .25, .008), segs=6, rings=3, t='vinyl', c=BLACK)
    p.ring(.218, .01, (0, 0, .28), n=16, segs=5, rot=(0, 0, 0), **CHROME)                     # foot ring, worn bright at the front
    p.ring(.175, .008, (0, 0, .62), n=12, segs=4, **CHROME)
    p.lathe([(.05, .71), (.17, .725), (.18, .735)], segs=16, t='wood', c=(.3, .25, .22))
    p.lathe([(.18, .735), (.195, .745), (.2, .775), (.185, .8), (.1, .81), (0, .805)], segs=18, bump=(.004, 12), t='vinyl', c=(.2, .35, .3))
    p.ring(.198, .005, (0, 0, .757), n=18, segs=4, t='vinyl', c=(.85, .8, .7))
    for i in range(12):
        a = D(i * 30)
        p.ball(.006, (math.cos(a) * .192, math.sin(a) * .192, .742), segs=5, rings=3, t='steel', c=(.8, .7, .4))     # upholstery tacks
    # back rail on two bent tubes
    for s in (-1, 1):
        p.tube([(s * .12, .15, .73), (s * .14, .22, .8), (s * .15, .23, 1.0)], .011, segs=5, **CHROME)
    p.tube([(-.17, .22, 1.0), (-.1, .245, 1.0), (.1, .245, 1.0), (.17, .22, 1.0)], [(.035, .014)] * 4, segs=6, up=(0, 0, 1), t='vinyl', c=(.2, .35, .3))
    p.ball((.06, .04, .012), (-.05, -.06, .806), rot=(0, 0, 20), segs=8, rings=4, bump=(.005, 30), t='gunk', c=(.9, .75, .4), ts=.15)   # foam through a split


@prop('menu_board', mount='wall', notes='Felt letter board. Origin is the centre of its back face; it stands 0.08 m off the wall. Letters are missing and a few lie in the bottom of the frame.')
def menu_board(p):
    W, H = 2.0, .8
    frame = dict(t='wood', c=(.45, .35, .3))
    p.box((W, .03, H), (0, -.015, 0), t='wood', c=(.5, .45, .4))
    for q in (((W, .08, .05), (0, -.04, H / 2 - .025)), ((W, .08, .05), (0, -.04, -H / 2 + .025)), ((.05, .08, H), (-W / 2 + .025, -.04, 0)), ((.05, .08, H), (W / 2 - .025, -.04, 0))):
        p.box(q[0], q[1], bevel=.008, **frame)
    p.quad([(-W / 2 + .05, -.032, -H / 2 + .05), (W / 2 - .05, -.032, -H / 2 + .05), (W / 2 - .05, -.032, H / 2 - .05), (-W / 2 + .05, -.032, H / 2 - .05)], rect='menu')
    white = (.93, .92, .85)
    p.text('SN CKS', .095, (-.45, -.036, .245), depth=.006, c=white)
    p.text('DRI KS', .095, (.5, -.036, .245), depth=.006, c=white)
    left = [('H T DOG', '2.50'), ('POP ORN', '1.75'), ('NAC OS', '3. 0'), ('PRE ZEL', '2.00'), ('CAN Y FL SS', '1.50')]
    right = [('S DA', '1.25'), ('SL SH', '1.75'), ('JUI E', '1.00'), ('COF EE', ' .50'), ('PAR Y BOX', '9.9 ')]
    for col, x0, x1 in ((left, -.88, -.1), (right, .1, .88)):
        for i, (name, price) in enumerate(col):
            z = .12 - i * .085
            p.text(name, .052, (x0, -.036, z), depth=.005, align='LEFT', c=white)
            p.text(price, .052, (x1, -.036, z), depth=.005, align='RIGHT', c=white)
    # a letter hanging by one peg, and the ones that dropped
    p.text('T', .052, (-.66, -.037, -.1), rot=(90, 55, 0), depth=.005, c=white)
    for i, (ch, x, a) in enumerate((('O', -.7, 70), ('C', -.3, 20), ('D', .35, -40), ('U', .6, 95), ('A', -.05, 10), ('N', .78, -15))):
        p.text(ch, .052, (x, -.05, -H / 2 + .052), rot=(8, 0, a), depth=.005, c=white)
    # the day's special, on a card clipped to the frame
    p.quad([(.62, -.082, .2), (.9, -.082, .22), (.89, -.082, .38), (.61, -.082, .36)], t='paper', c=(.95, .9, .6), ts=.4)
    p.text('TODAY', .04, (.755, -.084, .31), rot=(90, 4, 0), c=(.5, .1, .1))
    p.text('CAKE', .05, (.755, -.084, .245), rot=(90, 4, 0), c=(.5, .1, .1))
