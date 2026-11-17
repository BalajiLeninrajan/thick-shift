# Corridors and service areas: lights, signs, pipes, ducts, the big fan, and
# the junk that fills a warehouse. Coordinates are metres in the prop's own
# space: x right, -y toward the viewer, z up, origin as the brief gives it.
import math
from mathutils import Vector
from kit import Mesh, prop

RED = '#a3271c'
BLACK = '#26272a'
OX = '#7c3327'


@prop('ceiling', 'Twin-tube fluorescent batten, 1.2 m, hangs below the origin (centre of its top). Both tubes are lamp_glow.', dist=.1)
def ceiling_light():
    m = Mesh(31); m.density = 1.3
    C = '#c6c5b6'
    m.box((0, 0, -.025), (1.2, .3, .05), 'paint', C, bevel=.006, cell=.15)
    m.box((0, 0, -.065), (1.14, .075, .035), 'paint', C, bevel=.005, cell=.15)             # ballast cover
    for sy in (-1, 1):
        with m.at((0, sy * .095, -.06), r=(sy * 28, 0, 0)): m.box((0, 0, 0), (1.14, .09, .003), 'paint', '#d8d6c8', cell=.15)   # reflector wing
        m.cyl((-.55, sy * .095, -.082), (.55, sy * .095, -.082), .0165, 'lamp_glow', n=10, caps=(False, False))
        for sx in (-1, 1):
            m.box((sx * .565, sy * .095, -.07), (.03, .045, .05), 'plastic', '#d9d5c4', bevel=.004, cell=1)
            m.cyl((sx * .55, sy * .095, -.082), (sx * .515, sy * .095, -.082), .0172, 'chrome', '#3a3632', n=10, caps=(False, False))   # burnt tube ends
    for sx in (-1, 1): m.screw((sx * .4, 0, -.0825), n=(0, 0, -1))
    return m


@prop('ceiling', 'Bare bulb on a 0.8 m flex. Origin at the top of the cord; the bulb (lamp_glow) is centred about 0.91 m below it. The game may swing the whole prop about its origin.', dist=.05, dirt=.1)
def hanging_bulb():
    m = Mesh(32); m.density = 3
    m.lathe([(.012, -.04), (.036, -.034), (.048, -.014), (.05, 0)], 'plastic', '#d8d2bc', n=16)
    m.tube([(0, 0, -.035), (.006, .002, -.25), (-.007, .004, -.5), (.003, -.002, -.7), (0, 0, -.81)], .0038, 'rubber', '#3a2f26', n=6, steps=5)
    m.lathe([(.011, -.862), (.02, -.856), (.021, -.815), (.012, -.8)], 'plastic', '#2a2520', n=14)
    m.lathe([(.0165, -.874), (.018, -.87), (.018, -.862)], 'chrome', '#b59a55', n=14, caps=(False, False))
    m.lathe([(.0001, -.958), (.014, -.953), (.026, -.94), (.031, -.922), (.03, -.905), (.022, -.888), (.016, -.876), (.015, -.866)], 'lamp_glow', n=16, caps=(False, False))
    return m


@prop('wall', 'Emergency exit box. Origin at the centre of the back. The lettered face is exit_glow, with the picture as both base colour and emissive map.', dist=.08)
def exit_sign():
    m = Mesh(33); m.density = 2
    m.box((0, -.04, 0), (.4, .078, .2), 'plastic', '#2b2c2e', bevel=.008, cell=.1)
    m.box((0, -.079, 0), (.385, .004, .185), 'plastic', '#1b1c1e', cell=1)
    m.decal('exit', (0, -.081, 0), .37, .17, mat='exit_glow', off=.0005)
    m.cyl((.15, -.04, .1), (.15, -.04, .135), .012, 'steel', '#8a8d8c', n=8)               # conduit
    m.cyl((.17, -.05, -.1), (.17, -.05, -.106), .008, 'plastic', '#8a8d8c', n=8)           # test button
    m.cyl((.145, -.05, -.1), (.145, -.05, -.104), .004, 'flat', '#30a040', n=6)
    for sx in (-1, 1): m.screw((sx * .188, -.079, 0), r=.005)
    return m


@prop('ceiling', 'Three pipes on two trapeze hangers, a 2 m module running along three.js Z; modules butt end to end. Origin at the centre of the top (the ceiling). About 0.6 wide and 0.5 deep including the valve wheel that hangs below.', dist=.2)
def pipe_run():
    m = Mesh(34)
    for y in (-.65, .65):
        for sx in (-1, 1):
            m.cyl((sx * .26, y, 0), (sx * .26, y, -.345), .006, 'steel', '#7a7d7c', n=6)
            m.box((sx * .26, y, -.004), (.06, .06, .008), 'steel', '#7a7d7c', cell=1)
            m.cyl((sx * .26, y, -.345), (sx * .26, y, -.357), .012, 'steel', '#5a5d5c', n=6)
        m.box((0, y, -.325), (.6, .04, .04), 'steel', '#8a8d8c', bevel=.004, cell=.2)
    top = -.305
    # a: lagged pipe, the cloth split open in one place
    xa, ra = -.16, .075
    for y0, y1 in ((-1, .22), (.42, 1)):
        m.cyl((xa, y0, top + ra), (xa, y1, top + ra), ra, 'fabric', '#c4bda6', n=14, caps=(True, True))
    m.cyl((xa, .2, top + ra), (xa, .44, top + ra), .05, 'rust', n=10, caps=(False, False))
    for i, yy in enumerate((.2, .25, .43)):                            # torn lagging hanging down
        m.loft([((xa + .02 * (i - 1), yy, top + .01), .03, .004), ((xa + .03 * (i - 1), yy + .01, top - .05 - .03 * i), .02, .003)], 'fabric', '#b0a890', n=6, steps=2)
    for y in (-.9, -.45, 0, .62, .95):
        with m.at((xa, y, top + ra), r=(90, 0, 0)): m.lathe([(ra + .003, -.012), (ra + .003, .012)], 'steel', '#9a9d9c', n=14, caps=(False, False))
    # b: process pipe with a flange and the valve
    xb, rb = .05, .045
    zb = top + rb
    m.cyl((xb, -1, zb), (xb, 1, zb), rb, 'paint', OX, n=12)
    with m.at((xb, -.3, zb), r=(90, 0, 0)):
        for z in (-.012, .012):
            m.cyl((0, 0, z - .009), (0, 0, z + .009), .08, 'paint', OX, n=14)
        for k in range(6):
            a = k * math.tau / 6
            m.cyl((math.cos(a) * .064, math.sin(a) * .064, -.032), (math.cos(a) * .064, math.sin(a) * .064, .032), .009, 'steel', '#5a5d5c', n=6)
    with m.at((xb, .35, zb)):
        m.ball((0, 0, 0), (.065, .085, .07), 'paint', OX, n=12, m=7)
        m.lathe([(.035, -.15), (.045, -.14), (.03, -.06)], 'paint', OX, n=10)
        m.cyl((0, 0, -.15), (0, 0, -.2), .008, 'chrome', n=6)
        with m.at((0, 0, -.19)):
            m.torus(.075, .009, 'paint', RED, n=18, m=6)
            for k in range(3):
                a = k * math.tau / 3
                m.cyl((0, 0, 0), (math.cos(a) * .075, math.sin(a) * .075, 0), .006, 'paint', RED, n=5)
        m.loft([((0, 0, -.2), .006, .006), ((0, .003, -.24), .004, .004)], 'glass', '#3a2a18', n=5, steps=1)    # a drip that never falls
    # c: small copper line, sagging between clips
    xc = .2
    m.tube([(xc, -1, top + .022), (xc, -.65, top + .024), (xc + .004, 0, top + .008), (xc, .65, top + .024), (xc, 1, top + .022)], .016, 'chrome', '#a8663a', n=8, steps=4)
    for y in (-.65, .65):
        with m.at((xb, y, zb), r=(90, 0, 0)): m.lathe([(rb + .004, -.01), (rb + .004, .01)], 'steel', '#5a5d5c', n=12, caps=(False, False))
        with m.at((xc, y, top + .024), r=(90, 0, 0)): m.lathe([(.02, -.01), (.02, .01)], 'steel', '#5a5d5c', n=8, caps=(False, False))
    return m


@prop('ceiling', 'Sheet-metal duct, a 2 m module running along three.js Z; modules butt end to end (the ends are dark, as if open). Origin at the centre of the top; the duct hangs 0.08 m below it on straps. A grille faces down near one end.', dist=.25, dirt=.28)
def duct_run():
    m = Mesh(35)
    S = '#b9bdbd'
    m.box((0, 0, -.29), (.6, 2.0, .42), 'steel', S, seg=[3, 8, 3])
    m.dent((.3, -.5, -.29), .32, .014, d=(-1, 0, 0)); m.dent((-.3, .45, -.29), .32, .014, d=(1, 0, 0)); m.dent((0, -.4, -.5), .3, .02, d=(0, 0, 1))
    for y in (-.985, 0, .985):                                         # flanged joints
        for sz in (-1, 1): m.box((0, y, -.29 + sz * .225), (.66, .03, .03), 'steel', '#9a9e9e', cell=.3)
        for sx in (-1, 1):
            m.box((sx * .315, y, -.29), (.03, .03, .42), 'steel', '#9a9e9e', cell=.3)
            for sz in (-1, 1): m.screw((sx * .315, y - .015, -.29 + sz * .225), n=(0, -1, 0), r=.008)
    for sy in (-1, 1): m.poly([(-.28, sy * 1.0006, -.48), (.28, sy * 1.0006, -.48), (.28, sy * 1.0006, -.1), (-.28, sy * 1.0006, -.1)], 'flat', '#030303')
    for y in (-.6, .6):                                                # hanger straps
        for sx in (-1, 1):
            m.box((sx * .304, y, -.25), (.004, .04, .5), 'steel', '#8a8d8c', cell=.3)
            m.box((sx * .285, y, -.002), (.04, .04, .004), 'steel', '#8a8d8c', cell=1)
        m.box((0, y, -.502), (.612, .04, .004), 'steel', '#8a8d8c', cell=.3)
    m.box((.303, -.45, -.29), (.006, .34, .24), 'steel', '#c9cccc', bevel=.002, cell=.2)       # access hatch
    for y in (-.58, -.32): m.box((.309, y, -.19), (.008, .03, .04), 'steel', '#5a5d5c', cell=1)
    with m.at((0, .5, -.5)):                                           # ceiling register
        m.box((0, 0, -.008), (.44, .34, .016), 'paint', '#c9c8ba', bevel=.004, cell=.2)
        m.poly([(-.19, -.14, -.0165), (.19, -.14, -.0165), (.19, .14, -.0165), (-.19, .14, -.0165)], 'flat', '#030303')
        for i in range(7):
            with m.at((0, -.12 + i * .04, -.022), r=(40, 0, 0)): m.box((0, 0, 0), (.38, .03, .003), 'paint', '#c9c8ba', cell=.2)
    return m


@prop('wall', 'Extractor fan in a 1.2 m square frame, 0.3 deep. Origin at the centre of the back. Child `blades` spins about the depth axis (three.js Z) at the hub. A wire guard covers the front.', dist=.3, dirt=.3)
def wall_fan():
    m = Mesh(36)
    C = '#6d787d'
    for sz in (-1, 1): m.box((0, -.15, sz * .57), (1.2, .3, .06), 'paint', C, bevel=.008)
    for sx in (-1, 1): m.box((sx * .57, -.15, 0), (.06, .3, 1.08), 'paint', C, bevel=.008)
    N = 32; R = .5
    sq = lambda a: Vector((math.cos(a), 0, math.sin(a))) * (.545 / max(abs(math.cos(a)), abs(math.sin(a))))
    ci = lambda a: Vector((math.cos(a) * R, 0, math.sin(a) * R))
    for k in range(N):                                                 # the plate the shroud is cut into
        a0, a1 = k * math.tau / N, (k + 1) * math.tau / N
        for y in (-.26, -.03):
            m.poly([ci(a0) + Vector((0, y, 0)), ci(a1) + Vector((0, y, 0)), sq(a1) + Vector((0, y, 0)), sq(a0) + Vector((0, y, 0))], 'paint', C, out=(0, -.15, 0))
    with m.at((0, -.03, 0), r=(90, 0, 0)):
        m.lathe([(R, 0), (R, .23)], 'steel', '#8a8f8f', n=N, caps=(False, False))
    m.poly([(-.54, -.004, -.54), (.54, -.004, -.54), (.54, -.004, .54), (-.54, -.004, .54)], 'flat', '#020203')
    for k in range(3):                                                 # motor on three struts
        a = k * math.tau / 3 + math.pi / 2
        m.loft([((math.cos(a) * .08, -.07, math.sin(a) * .08), .012, .02), ((math.cos(a) * R, -.07, math.sin(a) * R), .012, .02)], 'steel', '#4a4d50', n=4, steps=1, ends=(False, False))
    with m.at((0, -.03, 0), r=(90, 0, 0)):
        m.lathe([(.05, 0), (.095, .01), (.1, .09), (.07, .11)], 'paint', '#3f4a4f', n=16)
    # wire guard
    with m.at((0, -.272, 0), r=(90, 0, 0)):
        for RR in (.1, .2, .3, .4, .5):
            m.torus(RR, .004, 'chrome', '#8d9090', n=32, m=4)
        for k in range(8):
            a = k * math.tau / 8 + .2
            m.cyl((math.cos(a) * .06, math.sin(a) * .06, .004), (math.cos(a) * .535, math.sin(a) * .535, .004), .0045, 'chrome', '#8d9090', n=4)
        m.cyl((0, 0, -.004), (0, 0, .01), .07, 'paint', '#b8962e', n=16)
    m.decal('plate_fan', (0, -.283, 0), .1, .05, off=.0008)
    m.box((.45, -.31, -.57), (.12, .04, .05), 'plastic', BLACK, bevel=.005, cell=1)            # junction box
    m.tube([(.45, -.3, -.55), (.42, -.2, -.5), (.2, -.09, -.2), (.05, -.08, -.06)], .008, 'rubber', '#1d1d1f', n=5)

    b = Mesh(361)
    with b.at((0, -.16, 0), r=(90, 0, 0)):
        b.lathe([(.06, -.03), (.075, -.02), (.075, .03), (.05, .05), (.0001, .055)], 'paint', '#3f4a4f', n=16)
        for k in range(5):
            with b.at(r=(0, 0, k * 72)):
                nr, ns = 5, 3

                def P(i, j):
                    t = i / nr; s = j / ns - .5
                    rr = .06 + .41 * t; ch = .14 + .2 * math.sin(math.pi * (t * .8 + .1)); p = math.radians(38 - 20 * t)
                    return (rr, s * ch * math.cos(p) + .04 * t * t, s * ch * math.sin(p))
                for i in range(nr):
                    for j in range(ns):
                        b.poly([P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)], 'steel', '#7d8280', smooth=True)
    return m, {'blades': (b, (0, -.16, 0))}


@prop('floor', 'Wooden shipping crate, 1 m cube, lid slightly lifted. Stencils and a shipping label on the three.js +Z face.', dist=.25, ground=.2)
def crate():
    m = Mesh(37)
    P = '#d6c6a6'; Bt = '#b9a684'
    m.box((0, 0, .49), (.94, .94, .94), 'wood', P, grain='x', cell=.3)
    for k in range(4):
        with m.at(r=(0, 0, k * 90)):
            for z in (.045, .93): m.box((0, -.485, z), (1.0, .03, .09), 'wood', Bt, bevel=.004, grain='x')
            for sx in (-1, 1): m.box((sx * .455, -.485, .49), (.09, .03, .8), 'wood', Bt, bevel=.004, grain='z')
            if k:
                with m.at((0, -.483, .49), r=(0, 45 if k % 2 else -45, 0)): m.box((0, 0, 0), (1.12, .026, .085), 'wood', Bt, bevel=.004, grain='x')
            for sx in (-1, 1):
                for z in (.045, .93):
                    for dx in (.43, .48): m.screw((sx * dx, -.5, z + .02 * (1 if dx > .45 else -1)), r=.006, tint='#3a3530')
    with m.at((0, 0, .975), r=(2.2, -1.6, 3)):                         # someone has had a bar under the lid
        m.box((0, 0, 0), (1.0, 1.0, .028), 'wood', P, bevel=.004, grain='x')
        for y in (-.36, .36): m.box((0, y, .026), (1.0, .09, .026), 'wood', Bt, bevel=.004, grain='x')
        m.decal('st_fragile', (0, 0, .014), .5, .125, n=(0, 0, 1), up=(0, 1, 0), cut=True, off=.001)
    m.decal('st_depot', (0, -.47, .7), .72, .128, cut=True, off=.001)
    m.decal('st_up', (-.08, -.47, .26), .55, .115, cut=True, off=.001, spin=2)
    m.decal('shipping', (.14, -.47, .48), .3, .175, spin=-3)
    return m


@prop('floor', 'Cardboard box, 0.5 m, sagging and taped, damp at the bottom. Printing on the three.js +Z face.', dist=.15, ground=.18, dirt=.3)
def cardboard_box():
    m = Mesh(38)
    m.box((0, 0, .24), (.5, .5, .48), 'cardboard', '#c9b594', seg=[6, 6, 6])
    for sx in (-1, 1):
        with m.at((sx * .125, 0, .482), r=(0, sx * 5, 0)): m.box((0, 0, 0), (.25, .5, .005), 'cardboard', '#c2ad8c', seg=[3, 6, 1])
    m.box((0, 0, .489), (.06, .5, .002), 'bag', '#b0905a', seg=[1, 6, 1])                     # packing tape
    for sy in (-1, 1): m.box((0, sy * .251, .43), (.06, .002, .12), 'bag', '#b0905a', seg=[1, 1, 2])
    m.decal('print', (0, -.25, .25), .4, .15, cut=True, off=.003, seg=(5, 2))
    for v in m.bm.verts:                                               # settle: belly out, top dips, the whole box leans
        x, y, z = v.co
        bulge = 1 + .07 * math.sin(math.pi * min(1, z / .48))
        dip = .035 * max(0, 1 - (x / .25) ** 2) * max(0, 1 - (y / .25) ** 2) * max(0, (z - .3) / .18)
        v.co = Vector((x * bulge + .06 * z, y * bulge - .025 * z, z - dip - .03 * max(0, z - .2) * (x + .25)))
    m.dent((.3, -.27, .45), .22, .07, d=(-1, 1, -.6))
    m.crumple(.008, .13, 4)
    return m


@prop('floor', 'Oil drum, 0.58 across, 0.88 tall, dented. Label and stencil face three.js +Z.', dist=.2, ground=.25, dirt=.3)
def barrel():
    m = Mesh(39)
    C = '#2e4f69'
    prof = [(.27, 0), (.286, .004), (.292, .02), (.285, .034), (.285, .28), (.297, .29), (.297, .31), (.285, .32), (.285, .57), (.297, .58), (.297, .6), (.285, .61),
            (.285, .846), (.292, .86), (.292, .877), (.284, .88), (.279, .864), (.0001, .86)]
    m.lathe(prof, 'paint', C, n=32, caps=(True, False))
    m.cyl((.15, .02, .86), (.15, .02, .874), .032, 'steel', '#8a8d8c', n=10, bevel=.004)
    m.cyl((-.17, .06, .86), (-.17, .06, .87), .016, 'steel', '#8a8d8c', n=8)
    m.cyl((-.04, -.07, .8605), (-.04, -.07, .8612), .11, 'glass', '#0b0907', n=14, caps=(False, True))    # standing oil on the lid
    m.wrap('flammable', .285, .345, .545, -110, -70, n=6)
    m.wrap('st_oil', .285, .665, .765, -119, -61, n=8, cut=True)
    m.dent((.22, -.26, .45), .24, .04, d=(-.6, .8, 0))
    m.dent((-.3, .0, .72), .16, .025, d=(1, 0, 0))
    return m


@prop('floor', 'Timber pallet, 1.2 x 1.0 x 0.15, one deck board broken.', dist=.12, ground=.1, dirt=.3)
def pallet():
    m = Mesh(40)
    tones = ('#cdbb9a', '#b5a282', '#d8c8a8', '#a8967a')
    for i, y in enumerate((-.45, 0, .45)):
        m.box((0, y, .01), (1.2, .1, .02), 'wood', tones[i % 4], grain='x', cell=.4)
        m.box((0, y, .12), (1.2, .1, .02), 'wood', tones[(i + 1) % 4], grain='x', cell=.4)
        for j, x in enumerate((-.53, 0, .53)): m.box((x, y, .065), (.14, .1, .09), 'wood', tones[(i + j) % 4], grain='y', cell=1)
    for i in range(7):
        x = -.54 + i * .18
        with m.at((x, 0, .14), r=(0, 0, (0, .8, -.6, 0, 1.1, -.9, .4)[i])):
            if i == 4:                                                 # snapped under a load, the stub sprung up
                m.box((0, -.24, 0), (.12, .5, .02), 'wood', tones[i % 4], grain='y', cell=.4)
                with m.at((0, .26, .012), r=(-7, 0, 5)): m.box((0, .11, 0), (.11, .24, .02), 'wood', tones[i % 4], grain='y', cell=.4)
            else:
                m.box((0, 0, 0), (.12, 1.0, .02), 'wood', tones[i % 4], bevel=.003, grain='y', cell=.4)
            for y in (-.45, 0, .45):
                if i == 4 and y > -.4: continue
                for dx in (-.03, .03): m.screw((dx, y + dx * .5, .0105), n=(0, 0, 1), r=.005, tint='#3a3530')
    return m


@prop('floor', 'Folding wet-floor sign, 0.62 tall; the two printed faces look along three.js +Z and -Z.', dist=.1, ground=.08)
def wet_floor_sign():
    m = Mesh(41); m.density = 2
    Y = '#dcae16'
    for s in (-1, 1):
        with m.at((0, 0, .625), r=(s * 16, 0, 0)):
            m.box((0, 0, -.31), (.3, .012, .62), 'plastic', Y, bevel=.004, seg=[2, 1, 4])
            m.decal('wetfloor', (0, s * .006, -.3), .25, .39, n=(0, s, 0), off=.0008)
            for sx in (-1, 1): m.box((sx * .12, 0, -.63), (.05, .014, .03), 'rubber', '#1c1c1e', cell=1)
    m.box((0, 0, .632), (.14, .05, .03), 'plastic', Y, bevel=.008, cell=1)
    m.cyl((-.16, 0, .622), (.16, 0, .622), .008, 'plastic', BLACK, n=6)
    m.box((0, 0, .26), (.02, .21, .003), 'plastic', BLACK, cell=.1)
    return m


@prop('floor', 'Mop bucket on castors with a wringer and a mop standing in it; the mop handle leans to 1.35 m.', dist=.15, ground=.1)
def mop_bucket():
    m = Mesh(42); m.density = 1.3
    Y = '#c9a21a'
    with m.at((0, 0, .07), scale=(1.3, 1, 1)):
        m.lathe([(.125, 0), (.135, .008), (.165, .29), (.176, .29), (.176, .303), (.166, .303), (.156, .29), (.128, .016), (.0001, .014)], 'plastic', Y, n=22, caps=(True, False))
        m.cyl((0, 0, .2), (0, 0, .201), .147, 'glass', '#191c14', n=22, caps=(False, True))      # grey water
    for sx in (-1, 1):
        for sy in (-1, 1):
            with m.at((sx * .15, sy * .1, 0), r=(0, 0, 30 * sx * sy)):
                m.box((0, 0, .062), (.03, .04, .018), 'steel', '#55585c', cell=1)
                for s in (-1, 1): m.cyl((s * .006, .01, .028), (s * .02, .01, .028), .028, 'rubber', '#1a1a1c', n=10)
    # wringer hooked on the +x end
    for sy in (-1, 1): m.box((.17, sy * .11, .41), (.17, .012, .16), 'plastic', Y, bevel=.003, cell=.1)
    m.box((.17, 0, .345), (.16, .21, .012), 'plastic', '#2a2a2c', cell=.1)
    m.box((.25, 0, .41), (.012, .22, .16), 'plastic', Y, cell=.1)
    with m.at((.11, 0, .43), r=(0, -14, 0)): m.box((0, 0, 0), (.012, .2, .14), 'plastic', '#2a2a2c', cell=.1)   # the press plate
    m.tube([(.2, .125, .42), (.24, .135, .56), (.3, .135, .74)], .011, 'steel', '#6a6d70', n=6)
    m.cyl((.3, .135, .74), (.33, .135, .84), .016, 'rubber', '#1c1c1e', n=8)
    # the mop
    foot, tip = Vector((-.07, .0, .33)), Vector((-.38, -.12, 1.35))
    m.cyl(foot, tip, .0125, 'wood', '#a58a62', n=8)
    m.box(foot, (.11, .05, .05), 'plastic', '#3a5a8a', bevel=.008, cell=1)
    for i in range(24):                                                # strings: some in the water, some over the rim
        a = i * 2.4; out = i % 3 != 0
        dx, dy = math.cos(a), math.sin(a)
        p0 = foot + Vector((dx * .04, dy * .02, -.02))
        if out:
            rim = Vector((dx * .22, dy * .17, .385 + .01 * math.sin(i)))
            pts = [p0, (p0 + rim) / 2 + Vector((0, 0, .02)), rim, rim + Vector((dx * .035, dy * .035, -.1 - .04 * math.sin(i * 1.7))), rim + Vector((dx * .03, dy * .03, -.2 - .06 * math.cos(i * 2.3)))]
        else:
            pts = [p0, p0 + Vector((dx * .05, dy * .04, -.03)), p0 + Vector((dx * .09, dy * .07, -.07))]
        m.loft([(p, .009, .007) for p in pts], 'fabric', ('#8f8a76', '#7d7866', '#9a9480')[i % 3], n=4, steps=3, ends=(False, True))
    return m


@prop('floor', 'A full bin bag slumped on the floor with a smaller one against it; a party hat has poked through the small one.', dist=.25, ao=.7, ground=.1, dirt=.15)
def trash_bag():
    m = Mesh(43)
    m.ball((0, 0, .3), (.34, .31, .33), 'bag', n=40, m=22)
    m.ball((.4, -.12, .17), (.21, .19, .2), 'bag', n=26, m=14)
    m.crumple(.045, .28, 1); m.crumple(.018, .09, 2); m.crumple(.007, .035, 3)
    for v in m.bm.verts:                                               # the floor flattens the bottom and the weight spreads it
        if v.co.z < .05:
            k = (.05 - v.co.z) / .1
            v.co = Vector((v.co.x * (1 + .12 * k), v.co.y * (1 + .12 * k), max(0, v.co.z * .3)))
    n0 = len(m.bm.verts)
    m.loft([((.0, 0, .58), .12, .1), ((.02, 0, .64), .04, .035), ((.03, .0, .68), .03, .028), ((.05, .01, .73), .06, .02), ((.08, .02, .78), .08, .012)], 'bag', n=12, steps=3)
    m.loft([((.4, -.12, .33), .08, .07), ((.41, -.13, .37), .03, .025), ((.43, -.15, .42), .05, .012)], 'bag', n=10, steps=3)
    m.crumple(.01, .04, 5, since=n0)
    with m.at((.02, 0, .665)): m.torus(.036, .007, 'bag', n=10, m=5)
    with m.at((.52, -.24, .26), r=(60, 0, 40)):
        m.lathe([(.055, 0), (.03, .08), (.0001, .17)], 'cardboard', '#c8324e', n=12, caps=(False, False))
        m.ball((0, 0, .172), .012, 'fabric', '#e8d24a', n=6, m=4)
    return m


@prop('wall', 'Dry-powder extinguisher on a wall bracket. Origin at the centre of the back of the bracket; the cylinder hangs 0.09 m in front of the wall.', dist=.1)
def fire_extinguisher():
    m = Mesh(44); m.density = 1.6
    m.box((0, -.005, 0), (.07, .01, .46), 'steel', '#55585c', bevel=.002, cell=.15)
    m.box((0, -.05, -.252), (.11, .1, .008), 'steel', '#55585c', cell=1)
    with m.at((0, -.088, 0)):
        m.lathe([(.05, -.248), (.066, -.242), (.071, -.225), (.071, .1), (.062, .15), (.04, .178), (.026, .188), (.026, .2)], 'paint', RED, n=22)
        m.lathe([(.0735, -.1), (.075, -.1), (.075, -.075), (.0735, -.075)], 'steel', '#55585c', n=22, caps=(False, False))   # bracket strap
        m.wrap('extinguisher', .071, -.2, .04, -162, -18, n=12, off=.0008)
        m.box((0, 0, .215), (.04, .05, .034), 'steel', '#6a6d70', bevel=.004, cell=1)
        with m.at((0, -.02, .236), r=(-14, 0, 0)): m.box((0, -.06, 0), (.024, .13, .005), 'paint', RED, cell=1)          # squeeze lever
        m.box((0, -.075, .205), (.024, .12, .005), 'steel', '#2a2a2c', cell=1)                                             # carry handle
        with m.at((.024, -.01, .236), r=(0, 90, 0)): m.torus(.012, .002, 'chrome', n=10, m=4)                              # the pin
        m.cyl((0, -.025, .215), (0, -.046, .215), .017, 'steel', '#2a2a2c', n=10)
        m.disc('gauge', (0, -.046, .215), .015, segs=10, off=.0006)
        m.tube([(.02, 0, .215), (.06, -.005, .21), (.086, -.01, .16), (.084, -.012, .0), (.082, -.012, -.1)], .009, 'rubber', '#1b1b1d', n=6, steps=4)
        m.lathe([(.008, 0), (.014, .045)], 'plastic', '#1b1b1d', n=8, at=(.082, -.012, -.15))
    return m
