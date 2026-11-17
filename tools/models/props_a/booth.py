# The security booth: desk, chair, monitors, wall map, locker, coat rack.
# Coordinates are metres in the prop's own space: x right, -y toward the
# viewer, z up, origin at the centre of the footprint unless noted.
import math
from kit import Mesh, prop, atlas, peaked_cap

DESK = '#6c776d'
BEIGE = '#c8bfa2'
BLACK = '#26272a'
NAVY = '#2a3142'


def mug(m, at, turn, tint, art=False, pens=False):
    with m.at(at, r=(0, 0, turn)):
        m.lathe([(.034, 0), (.04, .004), (.041, .095), (.037, .095), (.035, .012), (.0001, .01)], 'plastic', tint, n=16, caps=(True, False))
        m.tube([(.04, 0, .078), (.062, 0, .072), (.068, 0, .048), (.058, 0, .026), (.04, 0, .022)], .0055, 'plastic', tint, n=6, steps=3)
        if art: m.wrap('mug', .041, .02, .085, -160, -20, n=8)
        if pens:
            for i, (dx, dy, c) in enumerate(((.012, .01, '#2a4a8a'), (-.015, .005, '#8a2a22'), (.0, -.016, '#d0c040'))):
                m.cyl((dx * .5, dy * .5, .015), (dx * 2.2, dy * 2.2, .16 + i * .012), .0045, 'plastic', c, n=6)
        else:
            m.cyl((0, 0, .07), (0, 0, .074), .0365, 'glass', '#1a0f08', n=16, caps=(False, True))   # cold coffee


@prop('floor', 'Security desk, 2.4 x 0.9, top at 0.75 m. The guard sits on the three.js +Z side (drawers and kneehole face that way). Clutter is modelled on the front 0.4 m of the top and both ends; the rear middle 1.8 x 0.5 is left clear for monitor_bank.', dist=.3, ground=.2)
def desk():
    m = Mesh(21)
    m.box((0, 0, .73), (2.4, .9, .04), 'wood', '#94806a', bevel=.006, grain='x')
    m.box((0, 0, .7), (2.34, .84, .02), 'steel', '#4c4f52')
    for sx in (-1, 1):
        m.box((sx * .9, .0, .385), (.5, .8, .61), 'paint', DESK, bevel=.01, cell=.2)
        m.box((sx * .9, 0, .04), (.46, .76, .08), 'steel', '#36393c')
        for k, (z, h) in enumerate(((.6, .15), (.44, .15), (.22, .27))):
            out = .11 if (sx == 1 and k == 1) else .0
            m.box((sx * .9, -.408 - out, z), (.45, .02, h - .014), 'paint', '#7a857b', bevel=.005, cell=.15)
            m.box((sx * .9, -.424 - out, z + .02), (.13, .014, .016), 'chrome', bevel=.004, cell=1)
            if out:                                                    # the drawer left open, with a torch battery and a rag in it
                for s2 in (-1, 1): m.box((sx * .9 + s2 * .215, -.4 - out / 2, z - .005), (.01, out, h - .04), 'steel', '#5a5d60', cell=1)
                m.box((sx * .9, -.4 - out / 2, z - .06), (.43, out, .01), 'steel', '#5a5d60', cell=1)
                m.box((sx * .9 - .1, -.46, z - .03), (.07, .07, .05), 'plastic', '#d9b21a', bevel=.004, cell=1)
    m.box((0, .39, .43), (1.32, .02, .5), 'paint', DESK, cell=.2)
    m.dent((-.9, -.42, .25), .2, .02)
    top = .75
    # keyboard
    with m.at((-.08, -.27, top), r=(0, 0, -5)):
        m.box((0, 0, .013), (.46, .17, .026), 'plastic', BEIGE, bevel=.005, cell=1)
        m.decal('keyboard', (0, -.003, .026), .44, .15, n=(0, 0, 1), up=(0, 1, 0), off=.0008)
        m.tube([(.15, .085, .012), (.2, .16, .006), (.12, .26, .006), (.2, .34, .006)], .004, 'rubber', '#b9b09a', n=5)
    # logbook, open, with a pen in the gutter
    with m.at((.5, -.27, top), r=(0, 0, 7)):
        m.box((0, 0, .005), (.42, .28, .01), 'plastic', '#5a1f1c', bevel=.003, cell=1)
        for sx in (-1, 1): m.box((sx * .1, 0, .016), (.195, .26, .014), 'plastic', '#e4dcc4', bevel=.004, cell=1)
        m.decal('logbook', (0, 0, .023), .39, .26, n=(0, 0, 1), up=(0, 1, 0), off=.0008)
        with m.at((.03, -.02, .03), r=(0, 0, 35)): m.cyl((-.07, 0, 0), (.07, 0, 0), .005, 'plastic', '#22408a', n=6)
    # paperwork
    m.decal('form', (-.62, -.27, top), .21, .28, n=(0, 0, 1), up=(0, 1, 0), spin=11, off=.0012)
    m.decal('memo', (-.76, -.22, top), .21, .28, n=(0, 0, 1), up=(0, 1, 0), spin=-19, off=.0022)
    m.decal('note', (.2, -.38, top), .075, .075, n=(0, 0, 1), up=(0, 1, 0), spin=-8, off=.0012)
    mug(m, (.93, -.22, top), 30, '#e0dccf', art=True)
    mug(m, (-1.04, -.2, top), 200, '#4f6a58', pens=True)
    with m.at((.82, -.33, top + .001)): m.torus(.036, .0012, 'glass', '#3a2412', n=16, m=4)   # a ring where a mug stood
    # desk fan on the far left corner
    with m.at((-1.04, .2, top), r=(0, 0, 24)):
        m.lathe([(.085, 0), (.095, .008), (.095, .022), (.035, .04), (.02, .05)], 'plastic', '#3c5a66', n=18)
        m.cyl((0, 0, .04), (0, .01, .2), .014, 'chrome', n=8)
        with m.at((0, .0, .23), r=(98, 0, 0)):                         # head, tipped a little upward; local +z is where it blows
            m.lathe([(.02, -.11), (.045, -.1), (.05, -.03), (.035, -.02)], 'plastic', '#3c5a66', n=14)
            m.cyl((0, 0, -.02), (0, 0, .025), .012, 'chrome', n=8)
            for k in range(3):
                with m.at((0, 0, .01), r=(0, 0, k * 120 + 15)):
                    with m.at((.062, 0, 0), r=(24, 0, 0)): m.ball((0, 0, 0), (.055, .034, .003), 'plastic', '#9fb3b8', n=10, m=2)
            for z, R in ((-.035, .08), (-.01, .132), (.03, .132), (.06, .09), (.068, .035)):
                with m.at((0, 0, z)): m.torus(R, .0022, 'chrome', n=20, m=3)
            for k in range(12):                                        # cage wires, front and back
                a = k * math.tau / 12; cx, sy = math.cos(a), math.sin(a)
                m.tube([(cx * .035, sy * .035, .068), (cx * .09, sy * .09, .06), (cx * .132, sy * .132, .03), (cx * .132, sy * .132, -.01), (cx * .08, sy * .08, -.035), (cx * .045, sy * .045, -.04)], .0016, 'chrome', n=3, steps=2)
    return m


@prop('floor', 'Swivel chair. Seat at 0.48 m, faces three.js +Z, turned a few degrees as if someone just left.', dist=.2, ground=.12)
def office_chair():
    m = Mesh(22); m.density = 1.3
    for k in range(5):
        a = math.radians(k * 72 + 18); cx, sy = math.cos(a), math.sin(a)
        m.loft([((cx * .03, sy * .03, .1), .028, .02), ((cx * .29, sy * .29, .075), .02, .014)], 'steel', '#2a2b2e', n=6, steps=1, hint=(-sy, cx, 0))
        with m.at((cx * .3, sy * .3, 0), r=(0, 0, math.degrees(a) + 40 * ((k * 7) % 3 - 1))):
            m.box((0, 0, .062), (.03, .04, .02), 'plastic', BLACK, cell=1)
            for s in (-1, 1): m.cyl((s * .006, .012, .028), (s * .02, .012, .028), .028, 'rubber', '#1a1a1c', n=10)
    m.lathe([(.04, .08), (.045, .1), (.036, .26), (.03, .27)], 'plastic', BLACK, n=12)
    m.cyl((0, 0, .26), (0, 0, .4), .022, 'chrome', n=10)
    with m.at(r=(0, 0, 14)):
        m.box((0, .02, .405), (.24, .26, .03), 'steel', '#2a2b2e', bevel=.006, cell=1)
        m.tube([(.1, 0, .4), (.2, -.02, .39), (.27, -.03, .385)], .007, 'chrome', n=6)             # height lever
        m.ball((.28, -.03, .385), .014, 'plastic', BLACK, n=8, m=4)
        n0 = len(m.bm.verts)
        m.loft([((0, 0, .425), .2, .2), ((0, 0, .45), .245, .235), ((0, 0, .485), .235, .225)], 'fabric', '#5d322c', n=24, steps=2, power=3.4)
        m.dent((.05, -.02, .53), .2, .028, d=(0, 0, -1))               # years of the same guard
        m.box((-.1, -.14, .498), (.12, .06, .002), 'plastic', '#8d9093', cell=1)                   # tape over a split
        m.ball((.16, -.19, .47), (.035, .025, .02), 'fabric', '#c8b056', n=8, m=4)                 # foam coming out of the corner
        m.loft([((0, .2, .4), .03, .007), ((0, .29, .42), .03, .007), ((0, .31, .6), .03, .007), ((0, .29, .78), .03, .007)], 'steel', '#2a2b2e', n=8, steps=3, ends=(False, False), hint=(1, 0, 0))
        with m.at((0, .26, .82), r=(-9, 0, 0)):
            m.loft([((0, -.035, 0), .19, .13), ((0, 0, 0), .215, .155), ((0, .03, 0), .2, .14)], 'fabric', '#5d322c', n=24, steps=2, power=3.4, hint=(1, 0, 0))
            m.box((0, .047, 0), (.3, .012, .2), 'plastic', BLACK, bevel=.004, cell=1)
        m.crumple(.004, .08, 2, since=n0)
        for s in (-1, 1):
            m.tube([(s * .1, .02, .4), (s * .24, .02, .41), (s * .285, .02, .46), (s * .285, .03, .62)], .012, 'steel', '#2a2b2e', n=6, steps=3)
            m.box((s * .285, -.01, .635), (.055, .25, .03), 'plastic', BLACK if s < 0 else '#8d9093', bevel=.01, cell=.1)
    return m


def crt(m, x, yaw, pic, tint):
    """One CRT monitor, 0.54 wide, standing on z = 0 of the current frame."""
    u0, v0, u1, v1 = atlas()['decals'][pic]
    with m.at((x, 0, 0), r=(0, 0, yaw)):
        m.box((0, -.2, .21), (.53, .06, .42), 'plastic', tint, bevel=.014, cell=.2)
        m.loft([((0, -.17, .215), .25, .195), ((0, -.02, .215), .24, .19), ((0, .14, .2), .17, .14), ((0, .21, .19), .13, .1)], 'plastic', tint, n=16, steps=2, power=5, ends=(False, False), hint=(1, 0, 0))
        for i in range(6): m.box((-.15 + i * .06, .02, .398), (.035, .16, .004), 'flat', '#040404', cell=1)          # top vents
        # screen: a bulging grid in a dark surround
        W, H, y = .4, .3, -.231
        m.box((0, y + .004, .235), (W + .04, .01, H + .04), 'plastic', '#2e2b26', bevel=.004, cell=1)
        nx, nz = 6, 4
        P = lambda i, j: (-W / 2 + W * i / nx, y - .004 - .014 * (1 - (2 * i / nx - 1) ** 2) * (1 - (2 * j / nz - 1) ** 2), .235 - H / 2 + H * j / nz)
        U = lambda i, j: (u0 + (u1 - u0) * i / nx, v0 + (v1 - v0) * j / nz)
        for i in range(nx):
            for j in range(nz):
                q = ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))
                m.poly([P(*k) for k in q], 'screen_glow', uvs=[U(*k) for k in q], smooth=True)
        for k, kx in enumerate((.12, .17, .215)):
            m.cyl((kx, -.23, .04), (kx, -.243, .04), .012, 'plastic', '#3a372f', n=8)
        m.box((-.2, -.2305, .04), (.06, .002, .018), 'plastic', '#e8e2c8', cell=1)                # a strip of tape for a label
        m.cyl((.065, -.23, .04), (.065, -.234, .04), .005, 'flat', '#b02a1a', n=6)


@prop('floor', 'Three CRT monitors on a rack, made to sit on the desk top (origin at the centre of its footprint). Screens are screen_glow and carry a dead-channel picture as base colour and emissive map; from the viewer\'s left to right they map to atlas pictures screen_0, screen_1, screen_2.', dist=.25)
def monitor_bank():
    m = Mesh(23)
    m.box((0, 0, .06), (1.8, .46, .02), 'steel', '#55595c', cell=.25)
    for sx in (-1, 1):
        for sy in (-1, 1): m.box((sx * .885, sy * .215, .26), (.03, .03, .52), 'steel', '#4a4e51', cell=.2)
        m.box((sx * .885, 0, .02), (.03, .46, .04), 'steel', '#4a4e51', cell=.2)
    m.box((0, 0, .53), (1.8, .46, .016), 'steel', '#55595c', cell=.25)
    with m.at((0, .0, .07)):
        crt(m, -.57, -7, 'screen_0', '#c5bc9e')
        crt(m, 0, 0, 'screen_1', '#b9b196')
        crt(m, .57, 6, 'screen_2', '#cbc3a8')
    # a time-lapse recorder and a stack of tapes on the top shelf
    m.box((.35, 0, .574), (.44, .3, .07), 'paint', '#3b3d40', bevel=.006, cell=.2)
    m.box((.3, -.151, .58), (.2, .002, .02), 'flat', '#030303', cell=1)
    m.cyl((.52, -.15, .575), (.52, -.156, .575), .006, 'flat', '#b02a1a', n=6)
    for i in range(3):
        with m.at((-.45, .02, .549 + i * .027), r=(0, 0, (-8, 5, -14)[i])):
            m.box((0, 0, 0), (.19, .105, .025), 'plastic', ('#2a2a2c', '#35302a', '#2a2a2c')[i], bevel=.003, cell=1)
            m.box((0, -.053, 0), (.14, .001, .015), 'plastic', '#e4dec6', cell=1)
    for i, x in enumerate((-.6, -.05, .5)):                            # cables sagging down the back
        m.tube([(x, .2, .28), (x + .05, .26, .2), (x + .12, .25, .09), (x + .3, .24, .075)], .008, 'rubber', '#1d1d1f', n=5)
    return m


@prop('wall', 'Framed pin board. Origin at the centre of the back. Child `map_face` is a flat 1.64 x 0.76 plane (material `map`, UVs 0..1, U to the viewer\'s right, V up) for the live floor plan. The strip below it holds a title plate, a calendar and a note.')
def wall_map():
    m = Mesh(24)
    m.box((0, -.015, 0), (1.8, .03, 1.1), 'cardboard', '#9a7a4e', cell=.25)
    W = '#5b4632'
    for sz in (-1, 1): m.box((0, -.035, sz * .52), (1.8, .05, .06), 'wood', W, bevel=.008, grain='x')
    for sx in (-1, 1): m.box((sx * .87, -.035, 0), (.06, .05, .98), 'wood', W, bevel=.008, grain='z')
    m.box((0, -.0305, .095), (1.67, .002, .79), 'plastic', '#e6dfc6', cell=.3)             # the sheet the map is printed on
    m.decal('plate_map', (0, -.03, -.4), .66, .106)
    m.decal('calendar', (-.68, -.03, -.395), .15, .17, spin=3)
    m.decal('note', (.66, -.03, -.39), .1, .1, spin=-7)
    m.decal('memo', (.45, -.03, -.4), .12, .16, spin=4)
    for x, z, c in ((-.8, .47, '#b02a1a'), (.8, .47, '#b02a1a'), (-.8, -.28, '#2a4a8a'), (.8, -.28, '#b02a1a'), (-.68, -.32, '#d0c040'), (.66, -.345, '#2a8a4a'), (.45, -.33, '#b02a1a')):
        m.ball((x, -.04, z), .009, 'plastic', c, n=8, m=4)
        m.cyl((x, -.03, z), (x, -.04, z), .002, 'chrome', n=4)
    f = Mesh(241)
    f.poly([(-.82, -.034, -.285), (.82, -.034, -.285), (.82, -.034, .475), (-.82, -.034, .475)], 'map', uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
    return m, {'map_face': (f, (0, -.034, .095))}


@prop('floor', 'Two-door steel locker, 0.9 x 0.5 x 1.9. Doors face three.js +Z. The left door stands a few degrees open on a dark interior.', dist=.25, ground=.3)
def locker():
    m = Mesh(25)
    C = '#5c6c7a'
    m.box((0, .01, .98), (.9, .48, 1.8), 'paint', C, bevel=.008, cell=.2)
    for sx in (-1, 1):
        for sy in (-1, 1): m.box((sx * .41, sy * .2 + .01, .04), (.05, .05, .08), 'steel', '#3a3d40', cell=1)
    m.poly([(-.43, -.2315, .1), (.43, -.2315, .1), (.43, -.2315, 1.86), (-.43, -.2315, 1.86)], 'flat', '#030303')
    m.box((0, -.235, .98), (.02, .012, 1.78), 'paint', C, cell=.3)                           # centre post

    def door():
        m.box((.2175, -.008, 0), (.43, .016, 1.76), 'paint', C, bevel=.004, seg=[5, 1, 16])
        for i in range(5):                                             # louvres at head height, slots at the foot
            z = .62 + i * .04
            m.box((.2175, -.0165, z), (.24, .002, .014), 'flat', '#030303', cell=1)
            with m.at((.2175, -.02, z + .012), r=(35, 0, 0)): m.box((0, 0, 0), (.25, .016, .003), 'paint', C, cell=1)
            m.box((.2175, -.0165, z - 1.4), (.24, .002, .014), 'flat', '#030303', cell=1)
        for z in (-.7, 0, .7): m.cyl((.0, -.02, z - .035), (.0, -.02, z + .035), .008, 'steel', '#4a4d50', n=6)
        m.box((.39, -.026, 0), (.03, .02, .13), 'chrome', bevel=.004, cell=1)

    with m.at((-.44, -.238, .98), r=(0, 0, -13)):                      # left door, ajar
        door()
        m.decal('st_12', (.2175, -.016, .47), .1, .075, cut=True, off=.001)
    with m.at((.44, -.238, .98), scale=(-1, 1, 1)): door()             # right door is its mirror
    m.decal('st_13', (.2225, -.255, 1.45), .1, .075, cut=True, off=.001)
    # padlock on the right door
    with m.at((.06, -.275, .93)):
        m.box((0, 0, 0), (.045, .02, .04), 'steel', '#b59a55', bevel=.004, cell=1)
        with m.at((0, 0, .02), r=(90, 0, 0)): m.torus(.014, .004, 'chrome', n=12, m=5)
    m.decal('note', (.3, -.2555, 1.2), .07, .07, spin=9)
    m.decal('claws_b', (.22, -.256, .62), .34, .13, cut=True, spin=-58, off=.001, seg=(4, 2))
    m.dent((.2, -.25, .6), .28, .035)
    m.dent((.3, -.25, 1.25), .16, .018)
    m.dent((-.45, .0, 1.4), .2, .02, d=(1, 0, 0))
    return m


@prop('floor', 'Coat stand with a guard jacket and a cap. The jacket hangs on the right-hand hook, so it reads like a figure standing in the corner.', dist=.2, ground=.1)
def coat_rack():
    m = Mesh(26)
    S = '#3a3632'
    m.lathe([(.2, 0), (.21, .012), (.2, .024), (.05, .045), (.03, .07)], 'steel', S, n=20)
    m.cyl((0, 0, .06), (0, 0, 1.74), .017, 'steel', S, n=10)
    m.ball((0, 0, 1.75), .03, 'steel', S, n=10, m=6)
    for k in range(4):
        a = k * math.tau / 4; cx, sy = math.cos(a), math.sin(a)
        m.tube([(cx * .01, sy * .01, 1.56), (cx * .07, sy * .07, 1.57), (cx * .11, sy * .11, 1.6), (cx * .115, sy * .115, 1.65)], .007, 'steel', S, n=6, steps=3)
        m.ball((cx * .115, sy * .115, 1.655), .012, 'steel', S, n=6, m=4)
    with m.at((-.005, -.01, 1.765), r=(8, -10, 20)): peaked_cap(m)
    # the jacket, hung by its collar on the +x hook
    n0 = len(m.bm.verts)
    X = .13
    m.loft([((X, 0, 1.63), .05, .035), ((X, 0, 1.58), .15, .06), ((X, .0, 1.52), .23, .085), ((X, 0, 1.3), .215, .1), ((X, 0, 1.05), .205, .105), ((X, 0, .86), .215, .11)],
           'fabric', NAVY, n=20, steps=3, ends=(True, False), caps=(False, False), power=2.6)
    for s in (-1, 1):
        m.loft([((X + s * .2, 0, 1.54), .06, .055), ((X + s * .27, .01, 1.4), .058, .05), ((X + s * .285, .0, 1.15), .052, .046), ((X + s * .28, -.02, .93), .05, .042)],
               'fabric', NAVY, n=10, steps=3, ends=(True, False), caps=(False, False))
    m.crumple(.014, .11, 5, since=n0)
    m.loft([((X - .06, -.07, 1.6), .012, .03), ((X - .03, -.1, 1.5), .012, .04), ((X - .005, -.105, 1.36), .008, .02)], 'fabric', '#232a3a', n=6, steps=2)   # lapels
    m.loft([((X + .06, -.07, 1.6), .012, .03), ((X + .03, -.1, 1.5), .012, .04), ((X + .005, -.105, 1.36), .008, .02)], 'fabric', '#232a3a', n=6, steps=2)
    m.box((X, -.112, 1.1), (.012, .006, .5), 'chrome', '#8a8d90', cell=.1)                    # zip
    m.decal('patch', (X + .345, -.0, 1.38), .085, .085, n=(1, -.15, 0), off=.004)
    m.decal('badge', (X + .1, -.108, 1.36), .05, .05, n=(.25, -1, 0), off=.006)
    return m
