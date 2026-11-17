# Kitchen props. Front is -Y, sizes in metres.
import math
from mathutils import Vector, noise
from kit import prop, mixc, spline, D

BLACK = (.1, .1, .11)
SS = dict(t='steel', c=(.82, .83, .85))        # stainless
DULL = dict(t='steel', c=(.5, .5, .52))
IRON = dict(t='rust', c=(.72, .68, .66))


def legs(p, w, d, h, r=.02, inset=.04):
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (w / 2 - inset), sy * (d / 2 - inset)
            p.box((r * 2, r * 2, h - .04), (x, y, .04 + (h - .04) / 2), **SS)
            p.lathe([(0, 0), (.028, 0), (.028, .012), (.012, .04)], (x, y, 0), segs=8, **DULL)


def pot(p, r, h, at=(0, 0, 0), rot=(0, 0, 0), handles=True, c=(.7, .7, .72), fill=None):
    with p.place(at, rot):
        p.lathe([(0, .004), (r * .96, 0), (r, .01), (r, h), (r * 1.04, h), (r * .97, h - .003), (r * .97, .012), (0, .014)], segs=14, t='steel', c=c)
        if handles:
            for s in (-1, 1):
                p.tube([(s * r, -.035, h - .03), (s * (r + .035), -.03, h - .025), (s * (r + .035), .03, h - .025), (s * r, .035, h - .03)], .006, segs=4, t='steel', c=c)
        if fill: p.cyl(r * .96, .003, (0, 0, h * .6), segs=14, t='gunk', c=fill, ts=.25)


def pan(p, r, at=(0, 0, 0), rot=(0, 0, 0), c=(.2, .2, .21)):
    """A frying pan lying flat, handle toward +X."""
    with p.place(at, rot):
        p.lathe([(0, .004), (r * .8, 0), (r, .04), (r * 1.03, .042), (r * .97, .036), (r * .8, .008), (0, .01)], segs=14, t='rust', c=c)
        p.tube([(r, 0, .035), (r + .07, 0, .05), (r + .2, 0, .055)], [(.008, .012), (.012, .008), (.014, .009)], segs=5, up=(0, 0, 1), t='plastic', c=BLACK)


@prop('counter_steel', notes='Stainless prep counter with an upstand along the back (+Y in Blender) and a lower shelf.')
def counter_steel(p):
    W, Dp, H = 2.0, .7, .9
    p.box((W, Dp, .04), (0, 0, H - .02), bevel=.006, **SS)
    p.box((W, .02, .1), (0, Dp / 2 - .01, H + .05), bevel=.004, **SS)
    p.box((W - .1, .02, .08), (0, -Dp / 2 + .05, H - .08), **DULL)
    p.box((W - .1, .02, .08), (0, Dp / 2 - .05, H - .08), **DULL)
    legs(p, W, Dp, H - .04)
    p.box((W - .06, Dp - .06, .025), (0, 0, .2), bevel=.005, **SS)
    # on top: a board, a cleaver left in it, a tray
    p.box((.45, .3, .03), (-.5, -.05, H + .015), rot=(0, 0, 7), bevel=.005, t='wood', c=(.9, .8, .7))
    p.sheet(lambda u, v: (-.62 + u * .26 + .02 * math.sin(v * 7), -.14 + v * .2, H + .031), 4, 4, size=(.26, .2), t='gunk', c=(.3, .08, .07), ts=.5)
    with p.place((-.42, -.02, H + .03), rot=(0, -68, 25)):
        p.box((.2, .003, .09), (.1, 0, .045), t='steel', c=(.75, .75, .76))
        p.box((.12, .022, .03), (-.06, 0, .065), bevel=.006, t='wood', c=(.4, .3, .25))
    p.box((.5, .35, .006), (.45, 0, H + .003), t='steel', c=(.65, .65, .66))
    for q in (((.5, .008, .03), (.45, -.175, H + .015)), ((.5, .008, .03), (.45, .175, H + .015)), ((.008, .35, .03), (.2, 0, H + .015)), ((.008, .35, .03), (.7, 0, H + .015))):
        p.box(q[0], q[1], t='steel', c=(.65, .65, .66))
    p.sheet(lambda u, v: (.23 + u * .44, -.15 + v * .3, H + .01 + .012 * abs(noise.noise(Vector((u * 6, v * 5, 0))))), 8, 6, size=(.44, .3), t='gunk', c=(.5, .45, .35), ts=.35)
    # below: a stock pot, a stack of trays, a bucket
    pot(p, .17, .3, (-.55, 0, .213), fill=None)
    p.lathe([(.172, 0), (.175, .012), (.03, .03), (.02, .05), (0, .05)], (-.55, 0, .513), rot=(6, 0, 0), segs=14, t='steel', c=(.7, .7, .72))
    for i in range(5):
        p.box((.5, .36, .012), (.15, .0, .22 + i * .017), rot=(0, 0, (i * 37) % 9 - 4), t='steel', c=(.6 + .03 * i, .6, .6))
    p.lathe([(0, .004), (.11, 0), (.14, .24), (.146, .245), (.136, .24), (.107, .008), (0, .01)], (.7, .02, .213), segs=12, t='plastic', c=(.85, .85, .8))
    p.tube([(.56, .02, .43), (.6, -.12, .36), (.7, -.16, .33), (.8, -.12, .36), (.84, .02, .43)], .004, segs=4, **DULL)


@prop('fridge', notes='Two-door commercial fridge. The right door is the child node "door", hinged on its right edge (vertical axis). Its rest pose is already 14 degrees open: turn it -0.244 rad about Y in three.js to shut it, positive to open further. The left door is fixed. With the door at rest the front corner stands 0.15 m proud of the 0.8 m depth. The cabinet is dark inside, with something on the floor of it.')
def fridge(p):
    W, Dp, H = 1.2, .74, 2.1          # the doors and handle bring the depth to 0.8
    y0 = -Dp / 2                      # front plane of the carcass
    t = .04
    for q in (((t, Dp, H - .1), (-W / 2 + t / 2, 0, .1 + (H - .1) / 2)), ((t, Dp, H - .1), (W / 2 - t / 2, 0, .1 + (H - .1) / 2)), ((W, t, H - .1), (0, Dp / 2 - t / 2, .1 + (H - .1) / 2)),
              ((W, Dp, t), (0, 0, .12)), ((W, Dp, t), (0, 0, 1.82)), ((t, Dp - .05, 1.7), (0, .02, .97))):
        p.box(q[0], q[1], **SS)
    p.box((W, Dp, .26), (0, 0, H - .13), bevel=.006, **SS)                         # the compressor housing
    p.quad([(-.5, y0 - .002, 1.88), (.5, y0 - .002, 1.88), (.5, y0 - .002, 2.06), (-.5, y0 - .002, 2.06)], t='grille', c=(.3, .3, .32), ts=.14)
    p.box((.1, .01, .05), (.42, y0 - .006, 1.97), t='plastic', c=(.05, .05, .05))   # thermostat readout, dead
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.lathe([(0, 0), (.03, 0), (.03, .1), (.02, .1)], (sx * (W / 2 - .07), sy * (Dp / 2 - .07), 0), segs=8, **DULL)
    inside = dict(t='plastic', c=(.6, .62, .6))
    p.quad([(.02, Dp / 2 - t - .001, .14), (W / 2 - t, Dp / 2 - t - .001, .14), (W / 2 - t, Dp / 2 - t - .001, 1.8), (.02, Dp / 2 - t - .001, 1.8)], **inside)
    for z in (.55, .95, 1.35):     # wire shelves in the right-hand cabinet
        for i in range(7):
            x = .05 + i * .08
            p.tube([(x, y0 + .04, z), (x, Dp / 2 - t, z)], .003, segs=3, caps=False, **DULL)
        p.tube([(.03, y0 + .04, z), (W / 2 - t, y0 + .04, z)], .005, segs=4, **DULL)
    # what was left in it
    p.lathe([(0, .004), (.1, 0), (.12, .16), (.125, .16)], (.3, 0, .953), segs=10, t='plastic', c=(.8, .8, .75))
    p.ball((.1, .1, .04), (.3, 0, 1.1), segs=8, rings=4, bump=(.015, 30), t='gunk', c=(.5, .55, .4), ts=.2)
    p.box((.3, .22, .1), (.3, .05, 1.4), t='cardboard', c=(1, 1, 1))
    p.ball((.16, .13, .1), (.3, .0, .64), segs=10, rings=6, bump=(.03, 14), t='wrap', c=(.9, .85, .8), ts=.4)     # a parcel in butcher's cloth
    p.tube([(.16, -.05, .16), (.3, .02, .19), (.44, -.03, .17)], [(.1, .08), (.13, .1), (.09, .07)], segs=9, bump=(.03, 12), t='wrap', c=(.85, .78, .7), ts=.45)   # and a bigger one on the floor
    p.sheet(lambda u, v: (.08 + u * .44, y0 + .03 + v * .5, .141), 4, 4, size=(.44, .5), t='gunk', c=(.25, .07, .06), ts=.6)
    # the fixed left door
    def door_geo(q, x0, x1):
        """A door slab spanning x0..x1 with its outer face at y=-.06 (local to the front plane)."""
        w, cx = x1 - x0, (x0 + x1) / 2
        q.box((w - .01, .06, 1.68), (cx, -.03, .98), bevel=.008, **SS)
        q.box((w - .05, .012, 1.62), (cx, .006, .98), t='vinyl', c=(.12, .12, .12))          # gasket
        q.box((w - .1, .02, 1.5), (cx, .012, .98), t='plastic', c=(.7, .72, .7))             # liner
    with p.place((0, y0, 0)):
        door_geo(p, -W / 2, 0)
        p.tube([(-.07, -.06, .85), (-.07, -.1, .88), (-.07, -.1, 1.22), (-.07, -.06, 1.25)], .012, segs=6, **DULL)
        for z in (.3, 1.66): p.box((.05, .02, .08), (-W / 2 + .03, -.065, z), bevel=.004, **DULL)
        # a notice taped to it, and a child's drawing
        p.quad([(-.48, -.062, 1.25), (-.28, -.062, 1.24), (-.27, -.062, 1.53), (-.47, -.062, 1.54)], rect='poster')
        p.quad([(-.4, -.062, .95), (-.2, -.063, .97), (-.21, -.063, 1.15), (-.41, -.062, 1.13)], t='paper', c=(.95, .93, .85), ts=.5)
    door = p.child('door', (W / 2, y0, 0))
    with door.place((W / 2, y0, 0), rot=(0, 0, 14)):
        door_geo(door, -W / 2, 0)
        door.tube([(-W / 2 + .07, -.06, .85), (-W / 2 + .07, -.1, .88), (-W / 2 + .07, -.1, 1.22), (-W / 2 + .07, -.06, 1.25)], .012, segs=6, **DULL)
        for z in (.3, 1.66): door.box((.05, .02, .08), (-.03, -.065, z), bevel=.004, **DULL)
        for z in (.5, .9, 1.3):     # door racks
            door.box((.46, .08, .006), (-.3, .06, z), t='plastic', c=(.7, .72, .7))
            door.tube([(-.53, .1, z + .07), (-.07, .1, z + .07)], .004, segs=3, **DULL)
        door.lathe([(0, 0), (.035, 0), (.035, .14), (.015, .17), (.015, .21), (0, .21)], (-.2, .06, .503), segs=8, t='plastic', c=(.75, .2, .15))
        door.lathe([(0, 0), (.04, 0), (.04, .2), (0, .2)], (-.38, .06, .903), segs=8, t='plastic', c=(.85, .85, .7))
        # smears below the handle, where it has been pulled at
        door.sheet(lambda u, v: (-W / 2 + .03 + u * .14, -.0615, .55 + v * .5), 2, 5, size=(.14, .5), t='gunk', c=(.3, .1, .08), ts=.7,
                   keep=lambda u, v: noise.noise(Vector((u * 3, v * 5, 2))) > -.15)


@prop('range', notes='Six-burner range with an oven and a stub of extraction hood on a riser at the back.')
def range_(p):
    W, Dp, H = 1.0, .8, .9
    p.box((W, Dp - .04, H - .12), (0, .02, .12 + (H - .12) / 2), **SS)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.lathe([(0, 0), (.03, 0), (.025, .12)], (sx * (W / 2 - .07), sy * (Dp / 2 - .09) + .02, 0), segs=8, **DULL)
    # oven door, handle, window
    p.box((W - .08, .03, .5), (0, -Dp / 2 + .035, .43), bevel=.008, **SS)
    p.quad([(-.3, -Dp / 2 + .018, .35), (.3, -Dp / 2 + .018, .35), (.3, -Dp / 2 + .018, .55), (-.3, -Dp / 2 + .018, .55)], t='mirror', c=(.08, .07, .06), ts=.6)
    p.tube([(-.38, -Dp / 2 + .02, .64), (-.38, -Dp / 2 - .02, .64), (.38, -Dp / 2 - .02, .64), (.38, -Dp / 2 + .02, .64)], .012, segs=6, **DULL)
    p.box((W, .03, .1), (0, -Dp / 2 + .035, .76), rot=(-12, 0, 0), **SS)                   # the knob rail
    for i in range(7):
        x = -.39 + i * .13
        with p.place((x, -Dp / 2 + .016, .76), rot=(78, 0, 0)):
            if i == 4: p.cyl(.006, .02, (0, 0, 0), segs=5, **DULL); continue                # a knob gone, just the spindle
            p.lathe([(.026, 0), (.024, .02), (.012, .03), (0, .03)], segs=10, t='plastic', c=BLACK)
            p.box((.006, .03, .012), (0, 0, .03), rot=(0, 0, i * 53), t='plastic', c=(.7, .1, .1))
    p.box((W, Dp, .04), (0, 0, H - .02), bevel=.005, **SS)
    for i in range(6):       # burners under cast iron grates
        x, y = (i % 3 - 1) * .32, (i // 3 - .5) * .34 - .02
        p.cyl(.1, .006, (x, y, H), segs=12, t='rust', c=(.25, .22, .22))
        p.lathe([(.02, 0), (.045, 0), (.04, .018), (.02, .02)], (x, y, H + .004), segs=10, **IRON)
        for a in range(4):
            with p.place((x, y, H), rot=(0, 0, a * 90)):
                p.tube([(.03, 0, .03), (.14, 0, .03), (.14, 0, .0)], .007, segs=4, **IRON)
        p.ring(.14, .007, (x, y, H + .01), n=4, segs=4, rot=(0, 0, 45), **IRON)
    pot(p, .13, .16, (-.32, .15, H + .038), fill=(.3, .25, .15))
    p.tube([(-.36, .1, H + .13), (-.28, .22, H + .18), (-.18, .32, H + .26)], .005, segs=4, **DULL)       # a ladle standing in it
    pan(p, .13, (.32, -.19, H + .038), rot=(0, 0, 200))
    p.ball((.08, .07, .012), (.32, -.19, H + .05), segs=8, rings=3, bump=(.004, 40), t='gunk', c=(.25, .2, .12), ts=.2)
    # riser and hood stub
    p.box((W, .05, .42), (0, Dp / 2 - .025, H + .21), **SS)
    p.box((W - .1, .12, .012), (0, Dp / 2 - .1, H + .2), **SS)                              # salamander shelf
    hood = [(-W / 2, Dp / 2, 1.3), (W / 2, Dp / 2, 1.3), (W / 2, Dp / 2 - .36, 1.3), (-W / 2, Dp / 2 - .36, 1.3),
            (-W / 2, Dp / 2, 1.16), (W / 2, Dp / 2, 1.16), (W / 2, Dp / 2 - .36, 1.24), (-W / 2, Dp / 2 - .36, 1.24)]
    p.add(hood, [[3, 2, 1, 0], [4, 5, 1, 0][::-1], [6, 7, 3, 2][::-1], [5, 6, 2, 1][::-1], [7, 4, 0, 3][::-1]], **SS)
    p.add([hood[4], hood[5], hood[6], hood[7]], [[0, 1, 2, 3]], t='grille', c=(.5, .45, .35), ts=.18, flip=True)    # grease filter
    for i in range(6):   # grease, run down the riser and set
        x = -.4 + i * .16 + .03 * math.sin(i * 5)
        ln = .1 + .08 * ((i * 7) % 4)
        p.tube([(x, Dp / 2 - .052, 1.17), (x + .005, Dp / 2 - .053, 1.17 - ln * .6), (x, Dp / 2 - .054, 1.17 - ln)], [(.008, .003), (.006, .003), (.009, .005)], segs=4, up=(0, -1, 0), t='gunk', c=(.35, .25, .1), ts=.2)


@prop('sink_unit', notes='Double bowl sink with two taps on the upstand. A rubber glove hangs over the edge of the left bowl.')
def sink_unit(p):
    W, Dp, H = 1.5, .7, .9
    # top with two bowl openings: strips round the holes
    bx = [(-.66, -.08), (.08, .66)]; by = (-.24, .2)
    strips = [(-W / 2, -Dp / 2, W / 2, by[0]), (-W / 2, by[1], W / 2, Dp / 2), (-W / 2, by[0], bx[0][0], by[1]), (bx[0][1], by[0], bx[1][0], by[1]), (bx[1][1], by[0], W / 2, by[1])]
    for x0, y_0, x1, y_1 in strips:
        p.quad([(x0, y_0, H), (x1, y_0, H), (x1, y_1, H), (x0, y_1, H)], **SS)
    p.box((W, .02, .06), (0, -Dp / 2 + .01, H - .03), **SS)
    for sx in (-1, 1): p.box((.02, Dp, .06), (sx * (W / 2 - .01), 0, H - .03), **SS)
    p.box((W, .02, .22), (0, Dp / 2 - .01, H + .05), bevel=.004, **SS)
    for i, (x0, x1) in enumerate(bx):
        dz = .3
        v = [(x0, by[0], H), (x1, by[0], H), (x1, by[1], H), (x0, by[1], H), (x0 + .03, by[0] + .03, H - dz), (x1 - .03, by[0] + .03, H - dz), (x1 - .03, by[1] - .03, H - dz), (x0 + .03, by[1] - .03, H - dz)]
        p.add(v, [[0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0], [4, 7, 6, 5]], t='steel', c=(.6, .6, .6))
        cx = (x0 + x1) / 2
        p.cyl(.03, .004, (cx, -.02, H - dz + .001), segs=10, t='rust', c=(.3, .3, .3))
        p.lathe([(.025, 0), (.022, -.1), (.022, -.16)], (cx, -.02, H - dz), segs=8, t='plastic', c=(.8, .8, .78))      # waste
        # tap: swan neck off the upstand
        neck = [(cx, Dp / 2 - .03, H + .12), (cx, Dp / 2 - .08, H + .13), (cx, Dp / 2 - .13, H + .26), (cx, Dp / 2 - .22, H + .3), (cx, Dp / 2 - .3, H + .24), (cx, Dp / 2 - .31, H + .17)]
        p.tube([spline(neck, k / 12) for k in range(13)], .013, segs=7, **SS)
        p.cyl(.03, .03, (cx, Dp / 2 - .02, H + .12), rot=(90, 0, 0), segs=10, **SS)
        for s in (-1, 1):
            p.cyl(.016, .04, (cx + s * .09, Dp / 2 - .02, H + .1), rot=(90, 0, 0), segs=8, **SS)
            p.tube([(cx + s * .09, Dp / 2 - .06, H + .1), (cx + s * .13, Dp / 2 - .1, H + .12 + (.03 if i else 0))], (.012, .005), segs=5, t='plastic', c=(.7, .15, .15) if s < 0 else (.15, .3, .7))
    # the left bowl is still full
    x0, x1 = bx[0]
    p.quad([(x0 + .01, by[0] + .01, H - .07), (x1 - .01, by[0] + .01, H - .07), (x1 - .01, by[1] - .01, H - .07), (x0 + .01, by[1] - .01, H - .07)], t='mirror', c=(.1, .12, .07), ts=.8)
    p.ball((.12, .09, .006), (-.3, .05, H - .068), segs=8, rings=3, bump=(.02, 20), t='gunk', c=(.5, .55, .4), ts=.3)
    plate_stack = [(.37, .0, H - .29 + i * .012) for i in range(5)]
    for i, q in enumerate(plate_stack):
        p.lathe([(0, .004), (.08, .004), (.115, .018), (.12, .018)], q, rot=((i * 5) % 7, 0, 0), segs=12, t='plastic', c=(.9, .9, .88))
    # a rubber glove over the front edge, fingers hanging
    g = dict(t='plastic', c=(.85, .75, .2), ts=.3)
    p.tube([(-.45, by[0] + .1, H - .06), (-.44, by[0] + .02, H + .012), (-.44, -Dp / 2 + .03, H + .014), (-.44, -Dp / 2 - .014, H - .05), (-.44, -Dp / 2 - .016, H - .13)],
           [(.045, .02), (.045, .012), (.045, .012), (.05, .014), (.055, .016)], segs=8, up=(1, 0, 0), **g)
    for k in range(4):
        x = -.44 + (k - 1.5) * .027
        p.tube([(x, -Dp / 2 - .016, H - .12), (x + (k - 1.5) * .006, -Dp / 2 - .02, H - .18), (x + (k - 1.5) * .009, -Dp / 2 - .018 - .008 * k, H - .215 + abs(k - 1.5) * .012)], [.014, .012, .009], segs=6, **g)
    p.tube([(-.5, -Dp / 2 - .016, H - .1), (-.53, -Dp / 2 - .02, H - .13), (-.535, -Dp / 2 - .02, H - .165)], [.014, .012, .009], segs=6, **g)
    legs(p, W, Dp, H - .06)
    p.box((W - .06, Dp - .06, .02), (0, 0, .2), bevel=.005, **SS)
    # traps and a bottle of something under it
    for x0, x1 in bx:
        cx = (x0 + x1) / 2
        p.tube([(cx, -.02, H - .46), (cx, -.02, H - .56), (cx + .05, -.02, H - .6), (cx + .1, -.02, H - .56), (cx + .1, .1, H - .52), (cx + .1, Dp / 2 - .03, H - .52)], .02, segs=6, t='plastic', c=(.8, .8, .78))
    p.lathe([(0, 0), (.05, 0), (.05, .18), (.02, .22), (.02, .26), (0, .26)], (.5, -.1, .21), segs=10, t='plastic', c=(.2, .4, .7))
    p.lathe([(0, 0), (.06, 0), (.06, .2), (.025, .24), (.025, .28), (0, .28)], (.33, .05, .21), segs=10, t='plastic', c=(.85, .8, .3))
    p.ball((.12, .1, .05), (-.3, 0, .24), segs=8, rings=4, bump=(.03, 15), t='wrap', c=(.6, .6, .55), ts=.5)        # a rag


@prop('pot_rack', mount='ceiling', notes='Hangs on four rods from the ceiling; origin is the centre of the top. Pots, pans and ladles hang to 0.9 m below it, so over a counter it clears heads; in open floor it does not.')
def pot_rack(p):
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.tube([(sx * .74, sy * .24, 0), (sx * .74, sy * .24, -.3)], .006, segs=4, **DULL)
            p.cyl(.03, .008, (sx * .74, sy * .24, -.008), segs=8, **DULL)
    for sy in (-1, 1): p.tube([(-.8, sy * .28, -.3), (.8, sy * .28, -.3)], (.006, .02), segs=4, up=(0, 0, 1), **IRON)
    for x in (-.8, -.4, 0, .4, .8): p.tube([(x, -.28, -.3), (x, .28, -.3)], (.006, .016), segs=4, up=(0, 0, 1), **IRON)

    def hook(x, y, ln=.07):
        p.tube([(x, y, -.285), (x, y - .012, -.3), (x, y, -.32), (x, y, -.3 - ln), (x, y + .014, -.32 - ln), (x, y + .02, -.3 - ln)], .003, segs=3, **DULL)
        return -.325 - ln
    items = [(-.7, -.28, 'pot', .11), (-.42, -.28, 'pan', .13), (-.12, -.28, 'ladle', 0), (.1, -.28, 'pan', .11), (.4, -.28, 'pot', .09), (.68, -.28, 'ladle', 0),
             (-.6, .28, 'pan', .1), (-.25, .28, 'colander', .12), (.15, .28, 'ladle', 0), (.5, .28, 'pot', .13)]
    for i, (x, y, kind, r) in enumerate(items):
        z = hook(x, y, .05 + .03 * (i % 3))
        sw = ((i * 53) % 9 - 4) * 2.5                       # none of them hang quite straight
        with p.place((x, y + .016, z), rot=(sw * .4, sw, (i * 37) % 30 - 15)):
            if kind == 'pan':       # hangs by the hole in its handle, face to the side
                with p.place((0, 0, -.2 - r), rot=(90, -90, 0)):
                    pan(p, r, (0, 0, -.02))
            elif kind == 'pot':     # hangs by one handle, tipped
                with p.place((0, 0, -r - .04), rot=(0, 90, 0)):
                    pot(p, r, r * 1.2, (0, 0, -r * .6), c=(.6, .6, .62))
            elif kind == 'colander':
                with p.place((0, 0, -r - .03), rot=(0, 90, 0)):
                    p.lathe([(.03, 0), (r * .8, .02), (r, .09), (r * 1.06, .095)], (0, 0, -.05), segs=12, t='grille', c=(.7, .7, .72), ts=.12)
            else:
                p.tube([(0, 0, 0), (0, 0, -.3), (0, -.02, -.34)], (.006, .003), segs=4, **DULL)
                p.lathe([(0, -.03), (.03, -.02), (.042, .012), (.044, .012)], (0, -.045, -.36), rot=(70, 0, 0), segs=9, **DULL)


def can(p, at, i, r=.05, h=.115, rot=(0, 0, 0), swollen=False):
    """A catering tin with a paper label."""
    with p.place(at, rot):
        b = .012 if swollen else 0
        p.lathe([(r, .008), (r + b * .4, h * .5), (r, h - .008)], segs=10, wrap=True, rect=f'label{i % 4}')
        p.lathe([(0, .004 + b), (r * .9, .004), (r, 0), (r, .008)], segs=10, t='steel', c=(.7, .7, .7))
        p.lathe([(r, h - .008), (r, h), (r * .9, h - .004), (0, h - .004 + b)], segs=10, t='rust' if swollen else 'steel', c=(.7, .7, .7))


@prop('wire_shelf', notes='Chrome wire shelving with tins, tubs and boxes. One tin has blown.')
def wire_shelf(p):
    W, Dp, H = 1.2, .5, 1.9
    chrome = dict(t='steel', c=(.8, .8, .82))
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.tube([(sx * (W / 2 - .015), sy * (Dp / 2 - .015), .0), (sx * (W / 2 - .015), sy * (Dp / 2 - .015), H)], .0125, segs=6, **chrome)
    levels = [.15, .58, 1.0, 1.42, 1.84]
    for z in levels:
        loop = [(-W / 2 + .015, -Dp / 2 + .015, z), (W / 2 - .015, -Dp / 2 + .015, z), (W / 2 - .015, Dp / 2 - .015, z), (-W / 2 + .015, Dp / 2 - .015, z), (-W / 2 + .015, -Dp / 2 + .015, z)]
        p.tube(loop, .005, segs=4, caps=False, **chrome)
        p.tube([(q[0], q[1], z - .03) for q in loop], .004, segs=3, caps=False, **chrome)
        for i in range(11):
            y = -Dp / 2 + .04 + i * (Dp - .08) / 10
            p.tube([(-W / 2 + .015, y, z), (W / 2 - .015, y, z)], .0025, segs=3, caps=False, **chrome)
        for x in (-.3, 0, .3): p.tube([(x, -Dp / 2 + .015, z - .008), (x, Dp / 2 - .015, z - .008)], .004, segs=3, caps=False, **chrome)
    T = lambda k: levels[k] + .004
    r = p.rng
    for i in range(7):   # tins
        can(p, (-.5 + i * .115, -.12 + .02 * (i % 2), T(2)), i, rot=(0, 0, r.random() * 360), swollen=i == 3)
    for i in range(3): can(p, (-.44 + i * .115, -.12, T(2) + .116), i + 1, rot=(0, 0, r.random() * 360))
    can(p, (.25, -.05, T(2) + .05), 2, rot=(90, 0, 70))                                                   # one on its side
    for i in range(4): can(p, (-.5 + i * .16, .05, T(3)), i + 2, r=.075, h=.17, rot=(0, 0, r.random() * 360))
    # tubs
    for i, (x, c) in enumerate([(-.42, (.9, .9, .85)), (-.12, (.85, .85, .9)), (.2, (.9, .88, .8))]):
        p.lathe([(0, .004), (.12, 0), (.135, .22), (.14, .22), (.14, .24), (0, .245)], (x, 0, T(1)), segs=12, t='plastic', c=c)
        p.tube([(x - .135, 0, T(1) + .2), (x - .1, -.13, T(1) + .1), (x, -.16, T(1) + .07), (x + .1, -.13, T(1) + .1), (x + .135, 0, T(1) + .2)], .004, segs=3, **chrome)
        p.quad([(x - .06, -.133, T(1) + .08), (x + .06, -.133, T(1) + .08), (x + .06, -.137, T(1) + .17), (x - .06, -.137, T(1) + .17)], t='paper', c=(.95, .9, .75), ts=.3)
    p.lathe([(0, .004), (.1, 0), (.115, .18), (.12, .18)], (.45, .02, T(1)), segs=12, t='plastic', c=(.85, .85, .8))          # one with its lid off
    p.ball((.1, .1, .03), (.45, .02, T(1) + .15), segs=8, rings=4, bump=(.01, 30), t='gunk', c=(.6, .6, .5), ts=.2)
    # boxes, sacks
    for i, (x, w, h, k) in enumerate([(.3, .3, .26, 3), (.42, .22, .2, 4)]):
        p.box((w, .3, h), (x - (i * .0), 0, T(k) + h / 2), rot=(0, 0, 5 - i * 12), t='cardboard', c=(1, 1, 1))
    for i in range(4):
        x = .12 + i * .1
        p.box((.09, .22, .26), (x, .03, T(3) + .13), rot=(0, 0, (i * 5) % 7 - 3), t='cardboard', c=(.85, .85, .85))
        p.quad([(x - .04, -.082, T(3) + .01), (x + .04, -.082, T(3) + .01), (x + .04, -.082, T(3) + .25), (x - .04, -.082, T(3) + .25)], rect=f'box{i}')
    p.tube([(-.5, 0, T(0) + .1), (-.25, .0, T(0) + .12), (0, 0, T(0) + .1)], [(.08, .1), (.17, .11), (.08, .1)], segs=10, up=(0, 0, 1), bump=(.02, 9), t='paper', c=(.8, .75, .65), ts=.5)   # flour sacks
    p.tube([(.05, 0, T(0) + .1), (.3, .02, T(0) + .12), (.52, 0, T(0) + .09)], [(.08, .1), (.17, .11), (.08, .1)], segs=10, up=(0, 0, 1), bump=(.02, 9), t='paper', c=(.75, .72, .6), ts=.5)
    p.tube([(-.4, 0, T(0) + .28), (-.15, .02, T(0) + .32), (.08, 0, T(0) + .3)], [(.08, .1), (.16, .1), (.08, .1)], segs=10, up=(0, 0, 1), bump=(.02, 9), t='paper', c=(.8, .75, .65), ts=.5)
    p.sheet(lambda u, v: (.2 + u * .25, -.2 + v * .3, T(0) + .001 + .015 * math.sin(u * 3.1) * math.sin(v * 3.1)), 4, 4, size=(.25, .3), t='gunk', c=(.9, .88, .8), ts=.4)   # spilt flour
    # a big jar on the top shelf
    p.lathe([(0, .004), (.09, 0), (.1, .03), (.1, .22), (.07, .26), (.07, .28)], (-.35, 0, T(4)), segs=12, m='glass')
    p.lathe([(0, .003), (.088, .003), (.095, .03), (.095, .17), (0, .17)], (-.35, 0, T(4) + .003), segs=10, t='gunk', c=(.45, .5, .3), ts=.3)
    p.cyl(.075, .02, (-.35, 0, T(4) + .28), segs=12, t='rust', c=(.8, .8, .8))
    p.box((.4, .3, .22), (.2, 0, T(4) + .11), rot=(0, 0, -6), t='cardboard', c=(.9, .9, .9))


@prop('meat_rail', mount='ceiling', notes='Overhead rail with four sliding hooks; origin is the centre of the top. The second hook from the right holds a bundle in stained cloth, 1.1 m long, whose lowest point is 1.85 m below the origin: hang the rail so that clears the floor by a little. A stain on the floor under it would help.')
def meat_rail(p):
    for x in (-.8, .8):
        p.box((.12, .12, .01), (x, 0, -.005), **DULL)
        p.tube([(x, 0, -.01), (x, 0, -.2)], (.006, .025), segs=4, up=(1, 0, 0), **IRON)
    p.box((2.0, .05, .012), (0, 0, -.2), **IRON)            # an I section: flange, web, flange
    p.box((2.0, .008, .07), (0, 0, -.24), **IRON)
    p.box((2.0, .05, .012), (0, 0, -.28), **IRON)

    def trolley(x, swing=0.):
        for sy in (-1, 1):
            p.cyl(.022, .012, (x, sy * .018 - .006, -.262), rot=(90, 0, 0), segs=8, **DULL)
            p.box((.03, .004, .1), (x, sy * .03, -.3), **IRON)
        p.cyl(.006, .07, (x, -.035, -.345), rot=(-90, 0, 0), segs=5, **DULL)
        with p.place((x, 0, -.345), rot=(0, swing, 0)):
            pts = [(0, 0, 0), (0, 0, -.16), (.0, 0, -.2)] + [(-.045 + .045 * math.cos(a), 0, -.2 - .055 * math.sin(a)) for a in [D(d) for d in range(20, 230, 30)]]
            rad = [.008] * (len(pts) - 2) + [.005, .0015]
            p.tube(pts, rad, segs=6, t='steel', c=(.6, .58, .55))
        return x
    trolley(-.75, 4); trolley(-.3, -6); trolley(.72, 3)
    x = trolley(.3, 0)
    # the bundle: it hangs from the hook by the cloth knotted over its top
    top = -.56
    with p.place((x - .045, 0, top), rot=(2, 3, 20)):
        zs = [.02, -.03, -.09, -.17, -.25, -.31, -.37, -.5, -.66, -.8, -.93, -1.03, -1.1, -1.14]
        rs = [(.02, .02), (.04, .035), (.085, .08), (.105, .1), (.095, .095), (.075, .07), (.15, .1), (.165, .115), (.15, .11), (.125, .1), (.1, .085), (.075, .065), (.085, .075), (.02, .02)]
        ys = [0, 0, -.01, -.02, -.02, 0, .01, 0, -.01, -.02, 0, .01, -.02, -.02]
        inv = p.M.inverted()

        def soak(w):   # it has drained downward
            q = inv @ w
            k = max(0, min(1, (-q.z - .55) / .6)) ** 1.5
            return mixc((.9, .86, .78), (.42, .16, .1), k * .8)
        p.tube([(0, y, z) for y, z in zip(ys, zs)], rs, segs=14, bump=(.014, 11), t='wrap', c=soak)
        for z, r, tilt in ((-.31, .078, 8), (-.58, .158, -6), (-.9, .108, 5), (-1.03, .078, -8)):    # bound with cord
            p.ring(r, .006, (0, 0, z), rot=(tilt, tilt * .6, 0), n=12, segs=4, t='cardboard', c=(.7, .6, .45))
        # the knot of cloth over the hook, and a loose tail at the foot
        p.tube([(0, 0, 0), (.02, 0, .05), (.045, .0, .07), (.07, 0, .04)], [(.02, .02), (.016, .012), (.014, .01), (.02, .014)], segs=6, t='wrap', c=(.85, .8, .7))
        p.sheet(lambda u, v: ((u - .5) * .1 * (1 - v * .5) + .02 * math.sin(v * 5), -.02 + .02 * math.sin(u * 3 + v * 4), -1.12 - v * .2), 3, 5, size=(.1, .2), t='wrap', c=(.45, .2, .13), ts=.3)
        # a drip, about to go
        p.tube([(.0, -.02, -1.14), (.0, -.02, -1.22)], [.004, .002], segs=4, t='gunk', c=(.3, .05, .04), ts=.2)
        p.ball((.007, .007, .011), (0, -.02, -1.235), segs=6, rings=4, t='gunk', c=(.3, .05, .04), ts=.2)
    p.tube([(-.3 - .045, 0, -.6), (-.36, 0, -.7), (-.35, .01, -.85)], .004, segs=3, **IRON)       # a length of chain left on one
    for i in range(5): p.ring(.012, .003, (-.352, .003, -.62 - i * .05), rot=(90, 0, i * 90), n=6, segs=3, **IRON)
