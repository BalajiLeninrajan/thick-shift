# The props the player uses: torch, battery, punch clock, generator, charger,
# door button, shutter, vent, fuse box. Coordinates are metres in the prop's
# own space: x right, -y toward the viewer, z up, origin as the brief gives it.
import math
from kit import Mesh, prop, torch

GREEN = '#566f5e'      # institutional machine green
GREY = '#7b8686'
RED = '#a52a1e'
BLACK = '#26272a'
BRASS = '#b59a55'


def dome(m, c, r, mat='status_glow', n=(0, -1, 0)):
    """A pilot lamp: a glowing dome in a metal collar, facing -Y."""
    with m.at(c, r=(90, 0, 0)):
        m.lathe([(r * 1.35, 0), (r * 1.35, r * .35), (r * 1.05, r * .5)], 'chrome', n=14, caps=(False, False))
        m.ball((0, 0, r * .3), r, mat, n=14, m=5, zrange=(0, 1))


@prop('held', 'First-person torch, 0.24 m, built pointing at Blender -Y as the brief asks, so in three.js the beam leaves along +Z: turn it half a turn about Y to aim it down the camera. Origin is the middle of the grip. Lens and bulb are lamp_glow. Not a placed prop, so mount is "held".', dist=.03, dirt=.1)
def flashlight():
    m = Mesh(11)
    torch(m)
    return m


@prop('floor', 'Pickup: a 6 V lantern battery, 0.14 m tall. Yellow label on all four sides.', dist=.04, dirt=.1)
def battery():
    m = Mesh(12); m.density = 3
    m.box((0, 0, .055), (.09, .09, .11), 'plastic', '#2c2c30', bevel=.006, cell=1)
    for k, (n, c) in enumerate((((0, -1, 0), (0, -.045, .055)), ((1, 0, 0), (.045, 0, .055)), ((0, 1, 0), (0, .045, .055)), ((-1, 0, 0), (-.045, 0, .055)))):
        m.decal('battery', c, .078, .098, n=n, usub=(0, .5) if k % 2 == 0 else (.5, 1), off=.0008)
    m.box((0, 0, .1105), (.078, .078, .003), 'cardboard', '#d9cfae', cell=1)
    for sx in (-1, 1):                                                 # the two spring terminals
        pts = [(sx * .022 + math.cos(a) * .009 * (1 - t * .35), sx * .022 + math.sin(a) * .009 * (1 - t * .35), .112 + t * .026)
               for t, a in [(i / 40, i / 40 * math.tau * 4.5) for i in range(41)]]
        m.tube(pts, .0013, 'chrome', n=5, steps=1)
        m.cyl((sx * .022, sx * .022, .111), (sx * .022, sx * .022, .114), .011, 'steel', '#b9a15a', n=10)
    with m.at((0, 0, .03), r=(0, 0, 0)):                               # a turn of grey tape holding the base on
        m.box((0, 0, 0), (.0915, .0915, .022), 'plastic', '#8f9296', cell=1)
    return m


@prop('wall', "Watchman's punch clock. Origin at the centre of the back. The lever (child `lever`) is hinged on the right side and turns about X; pull it down to punch. The round lamp at lower right is status_glow.", dist=.12)
def time_clock():
    m = Mesh(13); m.density = 1.5
    m.box((0, -.065, 0), (.4, .13, .55), 'paint', GREEN, bevel=.012, cell=.1)
    m.box((0, -.132, .125), (.33, .01, .26), 'paint', '#3f5246', bevel=.004, cell=.1)       # raised dial panel
    with m.at((0, -.137, .125), r=(90, 0, 0)):
        m.lathe([(.128, 0), (.128, .014), (.12, .02), (.114, .02), (.112, .004)], 'chrome', BRASS, n=28, caps=(False, False))
    m.disc('dial', (0, -.139, .125), .113, segs=28)
    # card slot with a card left in it
    m.box((-.085, -.142, -.135), (.15, .03, .075), 'steel', '#5c6064', bevel=.005, cell=1)
    m.box((-.085, -.142, -.097), (.11, .008, .003), 'flat', '#050505', cell=1)
    with m.at((-.085, -.143, -.055), r=(-5, 0, 3)):
        m.decal('card', (0, 0, 0), .07, .13, off=0)
    m.decal('plate_punch', (.06, -.13, -.225), .2, .075)
    dome(m, (.1, -.13, -.115), .024)
    m.cyl((.1, -.13, -.165), (.1, -.136, -.165), .012, 'chrome', n=10)                       # key barrel
    m.box((.1, -.137, -.165), (.003, .002, .012), 'flat', '#050505', cell=1)
    for sx in (-1, 1):
        for sz in (-1, 1): m.screw((sx * .18, -.13, sz * .255))
    m.box((.207, -.07, -.1), (.02, .07, .07), 'steel', '#5c6064', bevel=.004, cell=1)        # lever boss
    lv = Mesh(131); lv.density = 2
    lv.cyl((.2, -.07, -.1), (.232, -.07, -.1), .02, 'steel', '#6f7378', n=14)
    lv.tube([(.226, -.07, -.1), (.228, -.13, -.07), (.228, -.19, -.045)], .008, 'chrome', n=8, steps=3)
    lv.ball((.228, -.2, -.041), .024, 'plastic', BLACK, n=12, m=7)
    return m, {'lever': (lv, (.2, -.07, -.1))}


@prop('floor', 'Hand-crank generator on a skid, 1.4 x 0.8 footprint. The crank wheel (child `crank`) is on the front, axle along the depth axis (three.js Z), and overhangs the skid by about 0.2 m toward the player.', dist=.3, ground=.25)
def generator():
    m = Mesh(14)
    OX = '#7c3327'                                                     # red oxide
    for sy in (-1, 1):
        m.box((0, sy * .33, .05), (1.4, .1, .1), 'rust', '#b0a8a0', bevel=.012)
    for x in (-.55, 0, .55): m.box((x, 0, .085), (.09, .7, .05), 'rust', '#a09890', bevel=.006)
    m.box((0, 0, .118), (1.3, .74, .016), 'steel', '#6e7274', cell=.2)
    # dynamo drum, lying along x
    m.box((-.2, 0, .2), (.56, .4, .15), 'paint', OX, bevel=.015)
    with m.at((-.2, 0, .5), r=(0, 90, 0)):
        prof = [(.12, -.36), (.2, -.35), (.235, -.31), (.235, -.26)]
        for i in range(9):                                             # cooling fins
            z = -.26 + i * .058
            prof += [(.235, z), (.262, z + .004), (.262, z + .022), (.235, z + .026)]
        prof += [(.235, .262), (.235, .31), (.2, .35), (.12, .36)]
        m.lathe(prof, 'paint', OX, n=22)
        for z, s in ((-.36, -1), (.36, 1)):
            m.cyl((0, 0, z), (0, 0, z + s * .05), .06, 'steel', '#55585c', n=14)
            for k in range(8):
                a = k * math.tau / 8
                m.screw((math.cos(a) * .17, math.sin(a) * .17, z - s * .012), n=(0, 0, s), r=.012)
    with m.at((-.2, 0, .77), r=(90, 0, 0)): m.torus(.035, .009, 'steel', '#55585c', n=14, m=6)   # lifting eye
    # gearbox the crank drives
    m.box((-.2, -.3, .5), (.26, .2, .26), 'paint', OX, bevel=.02)
    m.cyl((-.2, -.4, .5), (-.2, -.43, .5), .05, 'steel', '#55585c', n=14)
    # switchboard with the gauge, tank on top
    m.box((.43, -.02, .38), (.42, .52, .5), 'paint', GREY, bevel=.015)
    with m.at((.43, -.284, .5), r=(90, 0, 0)):
        m.lathe([(.098, 0), (.098, .018), (.088, .024), (.084, .024), (.082, .006)], 'chrome', '#8a8d90', n=24, caps=(False, False))
    m.disc('gauge', (.43, -.288, .5), .083)
    m.decal('plate_crank', (.43, -.28, .3), .3, .12)
    for i, x in enumerate((.3, .56)):                                  # terminal posts, with a cable each
        m.cyl((x, -.28, .19), (x, -.31, .19), .016, 'steel', BRASS, n=8)
        m.tube([(x, -.3, .19), (x + .02, -.36, .16), (x + .05, -.39, .13), (x + .1 - i * .3, -.45, .04), (x + .16 - i * .5, -.5, .012), (x + .5 - i * 1.2, -.52, .012)], .011, 'rubber', '#1d1d1f', n=6, steps=4)
    with m.at((.43, -.02, .78), r=(0, 90, 0)):
        m.lathe([(.04, -.2), (.1, -.19), (.13, -.16), (.13, .16), (.1, .19), (.04, .2)], 'paint', '#8f2a20', n=20)
        for z in (-.12, .12): m.lathe([(.131, z - .012), (.134, z - .012), (.134, z + .012), (.131, z + .012)], 'steel', '#5e6163', n=20, caps=(False, False))   # tank straps
    m.cyl((.5, -.02, .9), (.5, -.02, .935), .03, 'steel', '#8a8d90', n=12)                      # filler cap
    for x in (.3, .56): m.box((x, -.02, .64), (.03, .3, .03), 'steel', '#5e6163', cell=1)       # tank cradle
    m.tube([(.3, .05, .7), (.22, .08, .66), (.1, .1, .7), (.02, .08, .74)], .008, 'chrome', '#9a6a40', n=6)   # fuel line
    m.tube([(.22, .2, .36), (.12, .25, .3), (.02, .22, .42), (-.05, .2, .5)], .014, 'rubber', '#1d1d1f', n=6)   # drum to switchboard
    m.cyl((-.42, .12, .7), (-.42, .12, .97), .022, 'rust', n=10)                                # exhaust stub
    m.cyl((-.42, .12, .93), (-.42, .12, .99), .034, 'rust', n=10)

    c = Mesh(141)
    with c.at((-.2, -.43, .5), r=(90, 0, 0)):                          # wheel built flat, local +z toward the player
        c.cyl((0, 0, -.03), (0, 0, .06), .028, 'steel', '#6a6d70', n=12)
        c.cyl((0, 0, .02), (0, 0, .075), .06, 'paint', OX, n=16, bevel=.008)
        with c.at((0, 0, .05)): c.torus(.3, .02, 'steel', '#6f6058', n=36, m=8)
        for k in range(4):
            a = k * math.tau / 4 + .4
            c.loft([((math.cos(a) * .05, math.sin(a) * .05, .05), .022, .012), ((math.cos(a) * .29, math.sin(a) * .29, .05), .014, .01)], 'paint', OX, n=6, steps=1, ends=(False, False), hint=(-math.sin(a), math.cos(a), 0))
        c.cyl((.3, 0, .05), (.3, 0, .1), .012, 'steel', '#6a6d70', n=8)
        c.lathe([(.012, .09), (.021, .1), (.024, .16), (.022, .215), (.012, .225)], 'wood', '#6b4a30', n=12, at=(.3, 0, 0))   # the handle
    return m, {'crank': (c, (-.2, -.43, .5))}


@prop('wall', 'Charging rack for three torches. Origin at the centre of the back. The dome on the transformer box is status_glow.', dist=.1)
def charger_dock():
    m = Mesh(15); m.density = 1.5
    m.box((0, -.01, 0), (.6, .02, .4), 'paint', '#62707a', bevel=.005, cell=.1)
    m.box((0, -.08, -.165), (.57, .13, .03), 'paint', '#62707a', bevel=.006, cell=.1)
    for x in (-.19, -.02, .15):
        with m.at((x, -.085, -.15)):                                   # cup with a contact stud in the bottom
            m.lathe([(.046, 0), (.046, .07), (.04, .07), (.04, .012), (.0001, .012)], 'plastic', BLACK, n=16, caps=(True, False))
            m.cyl((0, 0, .012), (0, 0, .022), .008, 'steel', BRASS, n=8)
        with m.at((x, -.02, .03)):                                     # spring clip that grips the barrel
            m.lathe([(.028, 0), (.028, .022)], 'steel', '#9a9da0', n=14, arc=(-55, 235), caps=(False, False), at=(0, -.03, 0))
            m.box((0, .0, .011), (.02, .02, .022), 'steel', '#9a9da0', cell=1)
    m.box((0, -.025, .041), (.57, .012, .034), 'steel', '#565a5e', bevel=.003, cell=.1)
    m.decal('plate_charge', (-.09, -.02, .15), .36, .075)
    m.box((.21, -.05, .13), (.14, .07, .1), 'plastic', '#2b2c2f', bevel=.008, cell=1)       # transformer
    dome(m, (.24, -.085, .145), .014)
    for i in range(5): m.box((.185, -.0855, .1 + i * .013), (.05, .002, .005), 'flat', '#050505', cell=1)   # vent slots
    m.tube([(.25, -.05, .08), (.262, -.045, .0), (.25, -.03, -.1), (.262, -.022, -.2)], .007, 'rubber', '#1d1d1f', n=6)
    for sx in (-1, 1):
        for sz in (-1, 1): m.screw((sx * .28, -.02, sz * .18))
    return m


@prop('wall', 'Door control box. Origin at the centre of the back. Child `button` is the mushroom head: push it along three.js -Z (into the box) by up to 0.012 m. The lamp above it is status_glow.', dist=.1)
def door_panel():
    m = Mesh(16); m.density = 1.5
    m.box((0, -.04, 0), (.25, .08, .4), 'paint', '#b9982f', bevel=.01, cell=.08)
    m.decal('hazard', (0, -.08, .178), .22, .028, urep=True)
    m.decal('hazard', (0, -.08, -.178), .22, .028, urep=True)
    m.decal('plate_door', (0, -.08, -.115), .19, .083)
    with m.at((0, -.08, -.005), r=(90, 0, 0)):
        m.lathe([(.07, 0), (.07, .01), (.058, .018), (.04, .018), (.04, .004)], 'plastic', BLACK, n=24, caps=(False, False))
    dome(m, (0, -.08, .125), .022)
    m.cyl((.075, -.08, .125), (.075, -.09, .125), .014, 'chrome', n=10)                     # key switch
    m.box((.075, -.091, .125), (.003, .002, .014), 'flat', '#050505', cell=1)
    for sx in (-1, 1):
        for sz in (-1, 1): m.screw((sx * .105, -.08, sz * .15), r=.005)
    m.cyl((0, -.04, .2), (0, -.04, .225), .02, 'steel', '#6a6d70', n=10)                    # cable gland
    b = Mesh(161); b.density = 2
    with b.at((0, -.08, -.005), r=(90, 0, 0)):
        b.lathe([(.032, -.01), (.032, .024), (.06, .026), (.064, .034), (.058, .046), (.03, .056), (.0001, .058)], 'plastic', '#b3261c', n=24, caps=(False, False))
    return m, {'button': (b, (0, -.08, -.005))}


@prop('floor', 'Shutter slab that fills a 2.6 x 3.0 doorway. Origin at the bottom centre; slide it up by 3 m to open. The outside (clawed) face is three.js +Z.', dist=.25, ground=.5, dirt=.3)
def booth_door():
    m = Mesh(17)
    C = '#59666b'
    m.box((0, 0, 1.5), (2.42, .1, 2.98), 'paint', C, seg=[24, 1, 30])
    off = .004
    m.decal('st_booth', (0, -.05, 2.47), 1.25, .36, cut=True, off=off, seg=(8, 3))
    m.decal('st_keep', (0, -.05, 2.17), 1.5, .19, cut=True, off=off, seg=(10, 2))
    m.decal('claws_a', (-.45, -.05, 1.62), 1.1, .5, cut=True, off=off, spin=-24, seg=(8, 4))
    m.decal('claws_b', (.55, -.05, .92), .8, .3, cut=True, off=off, spin=14, seg=(6, 3))
    m.decal('claws_b', (-.7, -.05, .86), .6, .22, cut=True, off=off, spin=-70, seg=(5, 2))
    m.decal('hand', (.78, -.05, 1.62), .42, .47, cut=True, off=off, spin=-12, seg=(4, 4))
    # something big has been at this door: dents go in from the outside and show as bulges inside
    for c, r, d in (((-.4, -.05, 1.6), .55, .06), ((.6, -.05, 1.0), .4, .045), ((.75, -.05, 1.65), .3, .035), ((-.75, -.05, .85), .32, .03), ((.1, -.05, 2.3), .5, .02)):
        m.dent(c, r, d)
    m.crumple(.006, .35, 3)
    for sx in (-1, 1): m.box((sx * 1.25, 0, 1.5), (.1, .15, 3.0), 'paint', C, bevel=.012)
    m.box((0, 0, 2.93), (2.4, .15, .14), 'paint', C, bevel=.012)
    m.box((0, 0, .14), (2.4, .15, .28), 'paint', C, bevel=.012)
    for n in (-1, 1): m.decal('hazard', (0, n * .075, .14), 2.4, .255, n=(0, n, 0), urep=True, off=.001)
    for z in (.56, 1.3, 2.0, 2.72):                                    # stiffening ribs, both faces
        for sy in (-1, 1): m.box((0, sy * .06, z), (2.4, .03, .075), 'paint', C, bevel=.012)
    # inside face: grab handles and a bolt
    for x in (-.6, .6):
        m.tube([(x - .15, .075, 1.05), (x - .15, .13, 1.05), (x + .15, .13, 1.05), (x + .15, .075, 1.05)], .014, 'steel', '#7b7f83', n=8, steps=3)
    m.box((1.08, .085, 1.5), (.2, .04, .1), 'steel', '#6c7074', bevel=.006)
    m.cyl((.96, .1, 1.5), (1.28, .1, 1.5), .014, 'chrome', n=8)
    m.box((0, 0, .008), (2.4, .13, .016), 'rubber', '#1c1c1e')     # floor seal
    return m


@prop('wall', 'Louvred grate over a vent mouth. Origin at the centre of the back. The dark sheet behind the slats stands in for the duct; one slat is missing and one is bent.', dist=.15, dirt=.3)
def vent_cover():
    m = Mesh(18)
    C = '#7d8780'
    for sz in (-1, 1): m.box((0, -.03, sz * .37), (1.2, .06, .06), 'paint', C, bevel=.008)
    for sx in (-1, 1): m.box((sx * .57, -.03, 0), (.06, .06, .68), 'paint', C, bevel=.008)
    m.poly([(-.55, -.004, -.35), (.55, -.004, -.35), (.55, -.004, .35), (-.55, -.004, .35)], 'flat', '#030303')
    for i in range(12):
        if i == 4: continue
        z = -.31 + i * .0565
        bent = i == 7
        with m.at((0, -.03, z), r=(52 if bent else 36, 0, 2.5 if bent else 0)):
            m.box((0, 0, 0), (1.085, .058, .005), 'steel', '#8d9590' if i % 3 else '#7b8078', seg=[8, 1, 1])
    for x in (-.25, .25): m.box((x, -.03, 0), (.02, .012, .68), 'steel', '#6a6f6b', cell=.2)   # mullions the slats hang on
    for sx in (-1, 1):
        for sz in (-1, 1): m.screw((sx * .57, -.06, sz * .37), r=.009)
    return m


@prop('wall', 'Fuse box with its door hanging open. Origin at the centre of the back of the 0.5 x 0.7 box; the open door swings out to the left and reaches about 0.6 m in front of the wall, so leave that space clear.', dist=.15)
def fuse_box():
    m = Mesh(19); m.density = 1.3
    C = '#737c7b'
    m.box((0, -.005, 0), (.5, .01, .7), 'paint', C, cell=.12)
    for sx in (-1, 1): m.box((sx * .244, -.075, 0), (.012, .15, .7), 'paint', C, cell=.12)
    for sz in (-1, 1): m.box((0, -.075, sz * .344), (.5, .15, .012), 'paint', C, cell=.12)
    m.box((0, -.02, 0), (.45, .02, .65), 'plastic', '#3a2e26', cell=.12)                   # bakelite board
    m.decal('breakers', (0, -.03, .23), .42, .15)
    m.decal('breakers', (0, -.03, .07), .42, .15)
    # the big knife switch
    m.box((0, -.04, -.17), (.24, .024, .28), 'plastic', '#d6cfba', bevel=.006, cell=.1)
    for x in (-.06, .06):
        m.box((x, -.062, -.07), (.03, .03, .04), 'steel', '#b0703a', bevel=.004, cell=1)    # jaws
        m.box((x, -.062, -.275), (.03, .03, .035), 'steel', '#b0703a', bevel=.004, cell=1)  # hinge posts
        with m.at((x, -.07, -.275), r=(-24, 0, 0)):                                         # blades pulled part way out
            m.box((0, 0, .11), (.008, .022, .23), 'steel', '#c98a4a', cell=1)
    with m.at((0, -.07, -.275), r=(-24, 0, 0)):
        m.box((0, 0, .215), (.16, .026, .028), 'plastic', BLACK, bevel=.005, cell=1)
        m.cyl((0, -.012, .215), (0, -.085, .215), .013, 'plastic', BLACK, n=10)
        m.ball((0, -.09, .215), .02, 'plastic', BLACK, n=10, m=6)
    for i, x in enumerate((-.15, -.05, .06, .16)):                     # wiring up to the conduit
        m.tube([(x, -.035, .3), (x * .7, -.05, .315), (x * .25, -.06, .33), (x * .12 + .0, -.06, .345)], .007, 'rubber', ('#1d1d1f', '#7a2018', '#1d1d1f', '#2a4a7a')[i], n=5)
    m.cyl((0, -.06, .345), (0, -.06, .42), .03, 'steel', '#8a8d8c', n=12)
    m.cyl((0, -.06, .35), (0, -.06, .365), .04, 'steel', '#6f7372', n=6)
    with m.at((-.25, -.15, 0), r=(0, 0, -78)):                         # the door, hinged on the left
        m.box((.25, -.006, 0), (.5, .012, .7), 'paint', C, bevel=.003, cell=.1)
        m.decal('danger', (.25, -.012, .12), .3, .19)
        m.decal('form', (.25, 0, .05), .26, .35, n=(0, 1, 0))          # circuit schedule taped inside
        m.box((.47, -.02, 0), (.03, .02, .06), 'steel', '#55585c', bevel=.004, cell=1)
        for z in (-.25, .25): m.cyl((0, 0, z - .04), (0, 0, z + .04), .009, 'steel', '#55585c', n=8)
    m.dent((.0, -.3, -.1), .25, .012, d=(1, 0, 0))
    return m
