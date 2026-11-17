# The two textures every prop in the kit shares, painted with numpy.
#
# Atlas A is a 4 x 4 grid of tileable surface swatches (fur, velvet, steel...).
# Each has colour, a normal map and a roughness/metal map. The swatches are
# close to neutral grey so a prop tints them with vertex colour; that is how
# sixteen swatches cover a whole building. Each 512 px cell holds 448 px of
# content and a 32 px gutter filled with the wrapped content, so mip levels do
# not bleed a neighbour in where a mesh was cut at a tile edge.
#
# Atlas B is painted art that maps one to one onto a face: the standee, the
# arcade side art, the game screen, labels. Colour only.
#
# Arrays are indexed [v, u] with row 0 at the bottom, which is how Blender
# stores pixels, so "down" for a drip is toward row 0.
import numpy as np

SIZE, CELL, N, GUT = 2048, 512, 448, 32
TILES = ['fur', 'velvet', 'steel', 'paint', 'plastic', 'wood', 'paper', 'grille',
         'gift', 'gunk', 'wrap', 'laminate', 'mirror', 'rust', 'cardboard', 'vinyl']
# Metres of surface one repeat of each swatch covers by default.
SCALE = dict(fur=.45, velvet=.6, steel=.7, paint=.8, plastic=.6, wood=.7, paper=.6, grille=.25,
             gift=.3, gunk=.3, wrap=.55, laminate=.7, mirror=.9, rust=.4, cardboard=.6, vinyl=.45)

Y, X = np.mgrid[0:N, 0:N].astype(np.float32)


def up(grid, n=N):
    """Smooth, periodic upsample of a small random grid to n x n."""
    gh, gw = grid.shape
    ys, xs = np.arange(n) * gh / n, np.arange(n) * gw / n
    y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
    fy, fx = ys - y0, xs - x0
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a, b = grid[np.ix_(y0 % gh, x0 % gw)], grid[np.ix_(y0 % gh, (x0 + 1) % gw)]
    c, d = grid[np.ix_((y0 + 1) % gh, x0 % gw)], grid[np.ix_((y0 + 1) % gh, (x0 + 1) % gw)]
    return ((a * (1 - fx) + b * fx) * (1 - fy)[:, None] + (c * (1 - fx) + d * fx) * fy[:, None]).astype(np.float32)


def fbm(r, gx, gy=None, octs=4, gain=.5):
    """Tileable fractal noise in 0..1. gx, gy: cells across and up at the lowest octave."""
    gy = gy or gx
    out, amp, tot = 0, 1., 0.
    for _ in range(octs):
        out = out + amp * up(r.random((min(gy, N), min(gx, N))))
        tot += amp; amp *= gain; gx *= 2; gy *= 2
    return out / tot


def ss(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def warp(img, dx, dy):
    return img[(Y + dy).astype(int) % N, (X + dx).astype(int) % N]


def rgb(v, c):
    """A grey field times a colour -> (N, N, 3)."""
    return v[..., None] * np.array(c, np.float32)


def mix(a, b, t):
    return a * (1 - t[..., None]) + b * t[..., None]


def scratches(r, n, length, bend=.15):
    """Thin random strokes, wrapped. Returns a 0..1 mask."""
    m = np.zeros((N, N), np.float32)
    for _ in range(n):
        x, y, a = r.random() * N, r.random() * N, r.random() * 6.283
        ln = int(length * (.3 + r.random()))
        t = np.arange(ln)
        a2 = a + (r.random() - .5) * bend * t / max(ln, 1)
        m[(y + np.sin(a2) * t).astype(int) % N, (x + np.cos(a2) * t).astype(int) % N] = .4 + .6 * r.random()
    return m


def rings(s, level, width=.012):
    """The dark tide line a dried puddle leaves, from a noise field."""
    return np.exp(-((s - level) / width) ** 2)


def drip(m, steps=70, keep=.965):
    """Smear a mask downward, as rust or damp runs."""
    s = m.copy()
    for _ in range(steps): s = np.maximum(s, np.roll(s, -1, axis=0) * keep)
    return s


def tile_fur(r):
    # Matted pile: strands that lean, clumps, and bald patches down to the backing.
    wx = (fbm(r, 4) - .5) * 70
    strand = warp(fbm(r, 150, 9, octs=2), wx, 0)
    fine = warp(fbm(r, 224, 20, octs=1), wx, 0)
    clump = fbm(r, 9, octs=3)
    bald = ss(fbm(r, 5, octs=4), .63, .69)
    weave = (np.sin(X * 1.57) * np.sin(Y * 1.57)) * .5 + .5
    pile = (.45 + .4 * strand + .15 * fine) * (.7 + .3 * clump)
    col = mix(rgb(pile, (1, 1, 1)), rgb(.34 + .12 * weave, (1, .93, .82)), bald)
    grime = ss(fbm(r, 6, octs=4), .52, .78)
    col *= (1 - .45 * grime)[..., None] * np.array((1, .96, .88), np.float32)
    h = (strand * .7 + clump * .5 + fine * .2) * (1 - bald) + bald * weave * .08
    return col, h * 1.6, np.full((N, N), .95, np.float32) - bald * .1, 0


def tile_velvet(r):
    nap = fbm(r, 224, 28, octs=2)
    crush = ss(fbm(r, 6, octs=4), .5, .8)
    dust = ss(fbm(r, 7, octs=3), .35, .75) * (r.random((N, N)) > .82)
    v = .5 + .22 * nap + .28 * crush
    col = rgb(v, (1, 1, 1)) + rgb(dust.astype(np.float32) * .45, (.9, .9, .8))
    damp = ss(fbm(r, 4, octs=4), .58, .72)
    col *= (1 - .4 * damp)[..., None]
    return col, nap * .35 + crush * .5, .85 - .25 * crush, 0


def tile_steel(r):
    brush = fbm(r, 3, 320, octs=2)
    smudge = fbm(r, 7, octs=4)
    sc = scratches(r, 90, 160)
    rust = ss(fbm(r, 48, octs=2), .66, .74) * ss(fbm(r, 5, octs=3), .5, .65)
    lime = rings(fbm(r, 5, octs=4), .6, .02)
    col = rgb(.58 + .18 * brush + .2 * sc - .12 * ss(smudge, .5, .8), (1, 1, 1.02))
    col = mix(col, rgb(.6 + .3 * lime, (.8, .8, .74)), lime * .5)
    col = mix(col, rgb(.5 + .5 * brush, (.42, .2, .08)), rust)
    rough = .26 + .32 * smudge + .1 * brush + .3 * lime + .5 * rust
    return col, brush * .12 - sc * .5 + rust * .5, rough, 1 - rust * .9


def tile_paint(r):
    # Enamel over steel: chips to rust, and the rust runs.
    chips = ss(fbm(r, 26, octs=4) * .55 + fbm(r, 5, octs=3) * .45, .6, .625)
    run = drip(chips) * (1 - chips)
    peel = fbm(r, 180, octs=1)
    col = rgb(.88 - .1 * ss(fbm(r, 6, octs=4), .4, .8), (1, 1, 1))
    col = mix(col, np.broadcast_to(np.array((.5, .27, .1), np.float32), (N, N, 3)), run * .55)
    col = mix(col, rgb(.5 + .5 * fbm(r, 60, octs=2), (.36, .17, .07)), chips)
    return col, peel * .08 - chips * .7, .42 + .5 * chips + .2 * run, chips * .5


def tile_plastic(r):
    grime = ss(fbm(r, 5, octs=5), .48, .8)
    sc = scratches(r, 60, 90, bend=.6)
    col = rgb(.9 - .34 * grime + .08 * sc, (1, 1, 1)) * np.array((1, .98, .93), np.float32)
    return col, fbm(r, 200, octs=1) * .06 - sc * .35, .36 + .35 * grime + .2 * sc, 0


def tile_wood(r):
    g = fbm(r, 36, 3, octs=3)
    grain = np.sin(g * 46) * .5 + .5
    fine = fbm(r, 224, 12, octs=1)
    col = mix(np.broadcast_to(np.array((.66, .48, .28), np.float32), (N, N, 3)),
              np.broadcast_to(np.array((.4, .26, .13), np.float32), (N, N, 3)), grain * .8)
    damp = fbm(r, 4, octs=4)
    col *= (.82 + .18 * fine - .3 * ss(damp, .55, .7) - .3 * rings(damp, .55, .015))[..., None]
    return col, grain * .3 + fine * .15, .72 + 0 * g, 0


def tile_paper(r):
    s = fbm(r, 4, octs=5)
    wet = ss(s, .55, .57)
    col = np.broadcast_to(np.array((.93, .9, .82), np.float32), (N, N, 3)) * (.92 + .08 * fbm(r, 150, octs=2))[..., None]
    col = mix(col, col * np.array((.86, .74, .52), np.float32), wet * (.45 + .4 * fbm(r, 9, octs=3)))
    col *= (1 - .45 * rings(s, .55))[..., None]
    crease = scratches(r, 14, 380, bend=.02)
    return col * (1 - .2 * crease)[..., None], fbm(r, 9, octs=3) * .5 + crease * .5, .9 + 0 * s, 0


def tile_grille(r):
    # Perforated sheet, 16 holes across, rows staggered.
    p = N / 16
    row = np.floor(Y / p)
    dx, dy = (X + (row % 2) * p / 2) % p - p / 2, Y % p - p / 2
    hole = ss(np.hypot(dx, dy), p * .36, p * .28)
    dust = fbm(r, 8, octs=4)
    col = rgb((.62 + .2 * dust) * (1 - hole * .93), (1, 1, 1))
    return col, -hole * 1.2, .55 + .3 * dust, (1 - hole) * .7


def tile_gift(r):
    # Wrapping paper: stripes and dots, cockled and tide-marked by damp.
    stripe = ((X + Y) % 56 < 28).astype(np.float32)
    dots = ss(np.hypot((X - Y) % 56 - 28, (X + Y) % 56 - 14), 9, 7)
    s = fbm(r, 4, octs=5)
    wet = ss(s, .5, .53)
    v = .52 + .4 * stripe + .25 * dots * (1 - stripe)
    col = rgb(v, (1, 1, 1))
    col = mix(col, col * np.array((.6, .5, .36), np.float32), wet * .75)
    col *= (1 - .4 * rings(s, .5))[..., None]
    cockle = 1 - np.abs(2 * fbm(r, 10, octs=3) - 1)
    return col, cockle * .9 * (.3 + wet), .5 + .4 * wet, 0


def tile_gunk(r):
    lump = 1 - np.abs(2 * fbm(r, 18, octs=4) - 1)
    mould = ss(fbm(r, 9, octs=4), .56, .68)
    fuzz = ss(fbm(r, 30, octs=2), .6, .75) * mould
    wetm = ss(fbm(r, 6, octs=3), .55, .7)
    col = rgb(.55 + .45 * lump, (.9, .8, .6))
    col = mix(col, rgb(.5 + .5 * fbm(r, 80, octs=1), (.2, .27, .16)), mould * .9)
    col = mix(col, np.broadcast_to(np.array((.75, .8, .74), np.float32), (N, N, 3)), fuzz * .7)
    return col, lump * 1.2 + fuzz * .5, .8 - .5 * wetm * (1 - mould), 0


def tile_wrap(r):
    # A winding sheet: coarse weave, bands where it was wound, and what soaked through.
    weave = (np.sin(X * 1.57) * .5 + .5) * .5 + (np.sin(Y * 1.57) * .5 + .5) * .5
    fold = 1 - np.abs(2 * fbm(r, 2, 14, octs=3) - 1)
    s = fbm(r, 3, octs=5)
    blood = ss(s, .5, .6)
    seep = ss(s, .42, .5) * (1 - blood)
    col = rgb(.78 + .14 * weave - .25 * ss(fold, .8, .97), (1, .96, .86))
    col = mix(col, col * np.array((.8, .66, .36), np.float32), seep * .8)
    col = mix(col, rgb(.55 + .45 * fbm(r, 20, octs=3), (.36, .09, .06)), blood * .92)
    col *= (1 - .5 * rings(s, .5, .01))[..., None]
    col *= (1 - .3 * drip(blood, 50, .95) * (1 - blood))[..., None]
    return col, weave * .2 + fold * .9, .92 - .45 * ss(s, .58, .7), 0


def tile_laminate(r):
    speck = r.random((N, N))
    wear = ss(fbm(r, 4, octs=4), .5, .75)
    v = .84 - .3 * (speck > .93) + .1 * (speck < .04) - .12 * ss(fbm(r, 6, octs=4), .5, .8)
    col = rgb(v.astype(np.float32), (1, 1, .97))
    ring = np.zeros((N, N), np.float32)
    for _ in range(5):   # cup rings
        cx, cy, rad = r.random() * N, r.random() * N, 26 + r.random() * 10
        d = np.hypot((X - cx + N / 2) % N - N / 2, (Y - cy + N / 2) % N - N / 2)
        ring = np.maximum(ring, np.exp(-((d - rad) / 2.2) ** 2) * (.4 + .6 * r.random()))
    col = mix(col, col * np.array((.6, .42, .25), np.float32), ring * .7)
    sc = scratches(r, 40, 120)
    return col, -sc * .3 + ring * .1, .3 + .4 * wear + .25 * ring + .2 * sc, 0


def tile_mirror(r):
    smudge = fbm(r, 6, octs=4)
    rot = ss(fbm(r, 30, octs=3) * .5 + fbm(r, 4, octs=3) * .5, .58, .63)   # desilvering
    wipe = scratches(r, 25, 300, bend=1.5)
    col = mix(rgb(.86 - .1 * smudge, (1, 1, 1)), rgb(.06 + 0 * smudge, (1, .9, .8)), rot)
    return col, 0 * smudge, .05 + .3 * ss(smudge, .45, .8) + .2 * wipe + .5 * rot, 1 - rot


def tile_rust(r):
    a, pit = fbm(r, 8, octs=5), fbm(r, 60, octs=3)
    col = mix(rgb(.5 + .5 * pit, (.42, .2, .08)), rgb(.4 + .6 * pit, (.16, .09, .06)), ss(a, .4, .65))
    col = mix(col, np.broadcast_to(np.array((.62, .34, .1), np.float32), (N, N, 3)), ss(pit, .68, .8) * .7)
    return col, pit * 1.3 + a * .5, .9 + 0 * a, .25 + 0 * a


def tile_cardboard(r):
    s = fbm(r, 4, octs=5)
    flute = np.sin(Y * 6.283 / 8) * .5 + .5
    col = np.broadcast_to(np.array((.64, .49, .32), np.float32), (N, N, 3)) * (.86 + .1 * fbm(r, 120, 30, octs=2) + .04 * flute)[..., None]
    col *= (1 - .42 * ss(s, .55, .58) - .3 * rings(s, .55))[..., None]
    return col, flute * .15 + ss(s, .55, .6) * .3, .9 + 0 * s, 0


def tile_vinyl(r):
    # Seat vinyl, cracked through to the foam.
    crack = ss(1 - np.abs(2 * fbm(r, 9, octs=3) - 1), .95, .985)
    grain = fbm(r, 110, octs=2)
    grime = ss(fbm(r, 5, octs=4), .5, .8)
    col = rgb(.82 - .3 * grime + .1 * grain, (1, 1, 1))
    col = mix(col, np.broadcast_to(np.array((.5, .38, .16), np.float32), (N, N, 3)), crack)
    return col, grain * .25 - crack * 1.2, .4 + .3 * grime + .5 * crack, 0


def build_a():
    """Returns colour, normal and occlusion/roughness/metal arrays, (2048, 2048, 3) in 0..1."""
    col = np.zeros((SIZE, SIZE, 3), np.float32)
    nrm = np.zeros((SIZE, SIZE, 3), np.float32); nrm[...] = (.5, .5, 1)
    orm = np.ones((SIZE, SIZE, 3), np.float32)
    for i, name in enumerate(TILES):
        c, h, rough, metal = globals()['tile_' + name](np.random.default_rng(100 + i))
        h = np.asarray(h, np.float32) * 3.0
        nx = -(np.roll(h, -1, 1) - np.roll(h, 1, 1)) * .5
        ny = -(np.roll(h, -1, 0) - np.roll(h, 1, 0)) * .5
        ln = np.sqrt(nx * nx + ny * ny + 1)
        n3 = np.stack([nx / ln, ny / ln, 1 / ln], -1) * .5 + .5
        o3 = np.stack([np.ones((N, N), np.float32), np.broadcast_to(np.asarray(rough, np.float32), (N, N)),
                       np.broadcast_to(np.asarray(metal, np.float32), (N, N))], -1)
        y0, x0 = (i // 4) * CELL, (i % 4) * CELL
        for dst, src in ((col, c), (nrm, n3), (orm, o3)):
            dst[y0:y0 + CELL, x0:x0 + CELL] = np.pad(np.clip(src, 0, 1), ((GUT, GUT), (GUT, GUT), (0, 0)), mode='wrap')
    return col, nrm, orm


def tile_rect(name):
    """The content rectangle of a swatch in atlas A, as (u0, v0, du, dv)."""
    i = TILES.index(name)
    return ((i % 4) * CELL + GUT) / SIZE, ((i // 4) * CELL + GUT) / SIZE, N / SIZE, N / SIZE


# ---------------------------------------------------------------- atlas B

# name -> (x, y, w, h) in pixels, y from the bottom.
ART = dict(standee=(0, 0, 1024, 1024), sideart=(1024, 0, 512, 1024), soda=(1536, 0, 512, 1024),
           screen=(0, 1024, 512, 384), marquee=(512, 1024, 512, 128), panel=(512, 1152, 512, 128),
           menu=(1024, 1024, 1024, 384), label0=(0, 1408, 128, 128), label1=(128, 1408, 128, 128),
           label2=(256, 1408, 128, 128), label3=(384, 1408, 128, 128), eye=(512, 1280, 128, 128),
           eye_bad=(640, 1280, 128, 128), plush=(768, 1280, 128, 128), keys=(896, 1280, 128, 128),
           stripes=(512, 1408, 256, 128), ticket=(768, 1408, 256, 128),
           box0=(0, 1536, 128, 256), box1=(128, 1536, 128, 256), box2=(256, 1536, 128, 256), box3=(384, 1536, 128, 256),
           poster=(512, 1536, 256, 384), white=(1024, 1408, 64, 64))


def art_rect(name, inset=3):
    x, y, w, h = ART[name]
    return (x + inset) / SIZE, (y + inset) / SIZE, (w - 2 * inset) / SIZE, (h - 2 * inset) / SIZE


class Canvas:
    """A small painter: soft-edged shapes from distance fields. Coordinates
    run 0..w across and 0..h up, in whatever units the caller picks."""

    def __init__(self, px_w, px_h, w, h, bg):
        self.pw, self.ph, self.w, self.h = px_w, px_h, w, h
        self.y, self.x = np.mgrid[0:px_h, 0:px_w].astype(np.float32)
        self.x = (self.x + .5) * w / px_w; self.y = (self.y + .5) * h / px_h
        self.px = w / px_w
        self.img = np.zeros((px_h, px_w, 3), np.float32); self.img[...] = bg

    def paint(self, d, c, a=1.):
        """Fill where the signed distance d is negative."""
        m = np.clip(.5 - d / self.px, 0, 1) * a
        self.img = self.img * (1 - m[..., None]) + np.array(c, np.float32) * m[..., None]

    def ell(self, cx, cy, rx, ry, rot=0.):
        c, s = np.cos(rot), np.sin(rot)
        dx, dy = self.x - cx, self.y - cy
        u, v = dx * c + dy * s, -dx * s + dy * c
        return (np.hypot(u / rx, v / ry) - 1) * min(rx, ry)

    def box(self, x0, y0, x1, y1, r=0.):
        dx = np.abs(self.x - (x0 + x1) / 2) - (x1 - x0) / 2 + r
        dy = np.abs(self.y - (y0 + y1) / 2) - (y1 - y0) / 2 + r
        return np.hypot(np.maximum(dx, 0), np.maximum(dy, 0)) + np.minimum(np.maximum(dx, dy), 0) - r

    def seg(self, x0, y0, x1, y1, r):
        px, py, bx, by = self.x - x0, self.y - y0, x1 - x0, y1 - y0
        t = np.clip((px * bx + py * by) / (bx * bx + by * by), 0, 1)
        return np.hypot(px - bx * t, py - by * t) - r

    def blob(self, d, c, edge, ink=(.08, .06, .08)):
        """A shape with a cartoon outline."""
        self.paint(d - edge, ink); self.paint(d, c)

    def noise(self, r, gx, octs=4, gy=None):
        n = fbm(r, gx, gy, octs)
        ys, xs = np.arange(self.ph) * N // self.ph, np.arange(self.pw) * N // self.pw
        return n[np.ix_(ys, xs)]

    def age(self, r, fade=.35, grime=.4, peel=None, streak=.3, peel_at=.6):
        """Sun fade toward grey, damp streaks from the top, grime, and paint
        peeled off to `peel` (the colour of what is underneath)."""
        g = self.img.mean(-1, keepdims=True)
        self.img = self.img * (1 - fade) + (g * .6 + .3) * fade
        n = self.noise(r, 5)
        self.img *= (1 - grime * ss(n, .45, .8))[..., None]
        col = self.noise(r, 60, 2, gy=2)
        self.img *= (1 - streak * ss(col, .55, .8) * (.4 + .6 * self.noise(r, 3)))[..., None]
        if peel is not None:
            p = ss(self.noise(r, 30) * .5 + self.noise(r, 4) * .5, peel_at, peel_at + .02)
            self.img = self.img * (1 - p[..., None]) + np.array(peel, np.float32) * p[..., None] * (.7 + .3 * col[..., None])


FONT = {  # 3 x 5 pixel glyphs, enough for an arcade screen
    'G': '111100101101111', 'A': '010101111101101', 'M': '101111111101101', 'E': '111100110100111',
    'O': '111101101101111', 'V': '101101101101010', 'R': '110101110101101', 'I': '111010010010111',
    'N': '111101101101101', 'S': '111100111001111', 'T': '111010010010010', 'C': '111100100100111',
    'H': '101101111101101', ' ': '000000000000000', '0': '111101101101111', '1': '010110010010111',
    '9': '111101111001111', '2': '111001111100111', '5': '111100111001111',
}


def pix_text(cv, s, x, y, cell, c):
    """Blocky text, top-left at (x, y) in canvas units."""
    for i, ch in enumerate(s):
        g = FONT.get(ch, FONT[' '])
        for k, bit in enumerate(g):
            if bit == '1':
                gx, gy = x + (i * 4 + k % 3) * cell, y - (k // 3) * cell
                cv.paint(cv.box(gx, gy - cell, gx + cell, gy), c)


HIPPO, HIPPO_BELLY = (.60, .50, .77), (.90, .78, .93)
TOAD, TOAD_BELLY = (.37, .56, .40), (.81, .89, .66)
WALRUS, RHINO = (.73, .54, .43), (.49, .51, .60)

# Standee geometry, shared with the mesh: the board is 1.8 x 2.0 m, two heads
# stand proud of the top edge and each has a hole where a child's face goes.
STANDEE = dict(w=1.8, h=2.0, top=1.22,
               hippo=dict(head=(.47, 1.50, .37), hole=(.47, 1.47, .135), ears=((.20, 1.80, .11), (.74, 1.80, .11))),
               toad=dict(head=(1.31, 1.38, .36), hole=(1.31, 1.33, .135), ears=((1.10, 1.70, .15), (1.52, 1.70, .15))))


def art_standee(r):
    S = STANDEE
    cv = Canvas(1024, 1024, S['w'], S['h'], (.93, .72, .25))
    ang = np.arctan2(cv.y - .9, cv.x - .9)
    cv.paint(np.sin(ang * 14) * .1, (.9, .45, .18))                      # sunburst
    cv.paint(cv.box(-1, -1, 3, .16), (.72, .16, .16))                     # floor band
    for i in range(9): cv.paint(cv.ell(.1 + i * .2, .16, .09, .05), (.72, .16, .16))
    E = .014
    for key, body, belly, bx in (('hippo', HIPPO, HIPPO_BELLY, .47), ('toad', TOAD, TOAD_BELLY, 1.31)):
        hx, hy, hr = S[key]['head']
        s = 1 if key == 'hippo' else -1
        cv.blob(cv.seg(bx - .32, .95, bx - .55, 1.3 if key == 'hippo' else .62, .1), body, E)      # arms
        cv.blob(cv.seg(bx + .32, .95, bx + .5, .6 if key == 'hippo' else 1.28, .1), body, E)
        cv.blob(cv.ell(bx - .2, .2, .17, .1), body, E); cv.blob(cv.ell(bx + .2, .2, .17, .1), body, E)  # feet
        cv.blob(cv.ell(bx, .68, .4, .52), body, E)
        cv.paint(cv.ell(bx, .6, .27, .36), belly)
        for ex, ey, er in S[key]['ears']:
            cv.blob(cv.ell(ex, ey, er, er), body, E)
            if key == 'toad':
                cv.paint(cv.ell(ex, ey, er * .7, er * .7), (.95, .95, .9)); cv.paint(cv.ell(ex + .02 * s, ey - .02, er * .3, er * .3), (.05, .05, .05))
            else:
                cv.paint(cv.ell(ex, ey, er * .55, er * .55), belly)
        cv.blob(cv.ell(hx, hy, hr, hr * (.95 if key == 'hippo' else .8)), body, E)
        ox, oy, orad = S[key]['hole']
        cv.paint(cv.ell(ox, oy, orad + .035, orad + .035), belly)             # painted rim round the face hole
        cv.paint(cv.ell(ox, oy, orad + .008, orad + .008), (.08, .06, .08))
        # a party hat on each
        d = np.maximum.reduce([(cv.y - (hy + hr * .75)) * -1, (cv.x - hx) * .93 + (cv.y - (hy + hr + .13)) * .37, -(cv.x - hx) * .93 + (cv.y - (hy + hr + .13)) * .37])
        cv.blob(d, (.85, .2, .3) if key == 'hippo' else (.2, .45, .8), E)
    cv.age(r, fade=.42, grime=.5, peel=(.5, .36, .2), streak=.35, peel_at=.66)
    mould = ss(cv.noise(r, 14) * (1.3 - cv.y / 2), .62, .75)                  # damp creeps up from the floor
    cv.img = cv.img * (1 - mould[..., None] * .8)
    return cv.img


def art_sideart(r):
    cv = Canvas(512, 1024, .8, 1.8, (.12, .1, .3))
    for i in range(7):
        y = .15 + i * .26
        d = np.abs((cv.y - y) - np.abs((cv.x * 5) % 1 - .5) * .22) - .045
        cv.paint(d, ((.95, .75, .15), (.9, .25, .3), (.2, .7, .75))[i % 3])
    cv.blob(cv.ell(.4, 1.1, .3, .3), HIPPO, .012)
    cv.blob(cv.ell(.4, 1.02, .2, .13), HIPPO_BELLY, .008)
    for s in (-1, 1):
        cv.blob(cv.ell(.4 + s * .22, 1.37, .07, .07), HIPPO, .01)
        cv.paint(cv.ell(.4 + s * .12, 1.2, .07, .08), (.97, .97, .93)); cv.paint(cv.ell(.4 + s * .11, 1.19, .03, .035), (.03, .03, .03))
    cv.paint(np.maximum(cv.ell(.4, 1.04, .15, .09), cv.y - 1.04), (.08, .03, .05))         # the grin
    for i in range(5): cv.paint(cv.box(.275 + i * .052, 1.0, .315 + i * .052, 1.04, .008), (.93, .9, .75))
    for i in range(6):                                                                   # stars
        sx, sy = (.12, .68, .2, .62, .1, .7)[i], (.3, .45, .62, 1.55, 1.62, .75)[i]
        a = np.arctan2(cv.y - sy, cv.x - sx)
        cv.paint(np.hypot(cv.x - sx, cv.y - sy) - .05 - .025 * np.cos(a * 5), (1, .9, .3))
    cv.age(r, fade=.3, grime=.5, peel=(.2, .17, .14), streak=.25)
    sc = cv.noise(r, 200, 1, gy=6)
    cv.img *= (1 - .3 * ss(sc, .7, .8))[..., None]
    return cv.img


def art_soda(r):
    cv = Canvas(512, 1024, 1., 1.9, (.1, .25, .6))
    cv.img *= (.55 + .45 * cv.y / 1.9)[..., None]
    for i in range(26):                                                   # bubbles
        bx, by, br = r.random(), r.random() * 1.9, .02 + r.random() * .05
        cv.paint(np.abs(cv.ell(bx, by, br, br)) - .004, (.6, .8, .95), .7)
    cv.blob(cv.box(.2, .35, .58, 1.25, .03) + (1.25 - cv.y) * .06, (.85, .15, .15), .012)   # the cup
    cv.paint(cv.box(.2, .7, .6, .9), (.95, .93, .85))
    cv.blob(cv.ell(.39, 1.27, .23, .05), (.93, .93, .9), .01)
    cv.blob(cv.seg(.43, 1.28, .56, 1.68, .018), (.95, .85, .2), .008)
    cv.paint(cv.box(.68, .25, .95, 1.6, .02), (.05, .07, .15))             # dark column behind the buttons
    cv.paint(cv.box(.1, .05, .9, .22, .02), (.03, .03, .05))               # delivery slot
    cv.age(r, fade=.25, grime=.35, streak=.3)
    dead = (cv.noise(r, 3, 2) > .62)                                        # tubes that have gone
    cv.img *= (1 - .6 * dead)[..., None]
    return cv.img


def art_screen(r):
    cv = Canvas(512, 384, 64, 48, (.01, .02, .03))
    for i in range(7):                                                    # a maze of platforms
        y, x0 = 6 + i * 6, (i * 13) % 20
        cv.paint(cv.box(x0, y, x0 + 30 + (i * 7) % 14, y + 1), (.1, .3, .7))
    cv.paint(cv.box(22, 14, 42, 34), (.6, .5, .77))                       # the hippo, in big pixels
    cv.paint(cv.box(20, 30, 24, 36), (.6, .5, .77)); cv.paint(cv.box(40, 30, 44, 36), (.6, .5, .77))
    cv.paint(cv.box(25, 26, 29, 30), (1, 1, 1)); cv.paint(cv.box(35, 26, 39, 30), (1, 1, 1))
    cv.paint(cv.box(27, 26, 29, 28), (0, 0, 0)); cv.paint(cv.box(35, 28, 37, 30), (0, 0, 0))
    cv.paint(cv.box(25, 17, 39, 22), (.5, .02, .05))
    for i in range(4): cv.paint(cv.box(26 + i * 3.4, 20, 28 + i * 3.4, 22), (.95, .92, .7))
    pix_text(cv, 'GAME OVER', 14.5, 45, 1, (.95, .2, .2))
    pix_text(cv, 'INSERT COIN', 10.5, 5.5, 1, (.9, .9, .3))
    pix_text(cv, 'HI 99500', 1, 47, .5, (.7, .7, .7))
    img = cv.img
    img *= (.72 + .28 * (np.arange(384) % 4 < 2))[:, None, None]             # scanlines
    img[:, 300:306] = img[:, 300:306] * .2 + np.array((.1, .5, .1), np.float32) * .5   # a dead column
    tear = (np.arange(384) > 250) & (np.arange(384) < 262)
    img[tear] = np.roll(img[tear], 40, axis=1)                             # a torn band of signal
    vig = 1 - .5 * ((cv.x / 64 - .5) ** 2 + (cv.y / 48 - .5) ** 2) * 2
    return img * vig[..., None] * (.9 + .1 * cv.noise(r, 100, 1)[..., None]) + .015


def art_marquee(r):
    cv = Canvas(512, 128, 4, 1, (.85, .2, .25))
    cv.paint(np.abs(cv.y - .5) - .32 + .08 * np.sin(cv.x * 12), (.98, .8, .25))
    for i in range(9): cv.paint(cv.ell(.25 + i * .44, .12, .06, .06), (.2, .6, .8)); cv.paint(cv.ell(.25 + i * .44, .88, .06, .06), (.2, .6, .8))
    cv.age(r, fade=.15, grime=.25, streak=.2)
    return cv.img


def art_panel(r):
    cv = Canvas(512, 128, 4, 1, (.1, .1, .12))
    for i in range(12): cv.paint(cv.seg(i * .4 - .2, -.1, i * .4 + .3, 1.1, .05), (.8, .2, .25) if i % 2 else (.95, .75, .2))
    cv.paint(cv.box(.3, .15, 3.7, .85, .1), (.08, .08, .1))
    cv.age(r, fade=.2, grime=.45, streak=0)
    wear = ss(np.hypot(cv.x - 1.2, (cv.y - .5) * 1.6), .55, .15) + ss(np.hypot(cv.x - 2.8, (cv.y - .5) * 1.6), .5, .15)
    cv.img = cv.img * (1 - .5 * wear[..., None]) + .25 * wear[..., None]        # palms wore the print off
    return cv.img


def art_menu(r):
    # A felt letter board: grooved black felt with a painted header.
    cv = Canvas(1024, 384, 2., .75, (.05, .055, .05))
    cv.img *= (.6 + .4 * ((cv.y * 1000) % 25 > 5))[..., None]
    cv.paint(cv.box(0, .61, 2, .75), (.7, .14, .14))
    cv.paint(np.abs(cv.y - .68 - .02 * np.sin(cv.x * 40)) - .006, (.95, .8, .3))
    cv.paint(np.abs(cv.x - 1.0) - .004, (.3, .3, .28))
    dust = cv.noise(r, 6)
    cv.img += (.1 * ss(dust, .4, .8))[..., None]
    return cv.img


def art_label(r, i):
    base = ((.75, .12, .1), (.15, .4, .2), (.85, .65, .1), (.2, .3, .6))[i]
    cv = Canvas(128, 128, 1, 1, base)
    cv.paint(cv.box(-1, .78, 2, .88), (.95, .9, .75)); cv.paint(cv.box(-1, .1, 2, .16), (.95, .9, .75))
    cv.blob(cv.ell(.5, .47, .3, .22), (.95, .92, .8), .02)
    if i == 0: cv.blob(cv.ell(.5, .47, .15, .14), (.8, .15, .1), .015)
    elif i == 1:
        for k in range(5): cv.blob(cv.ell(.34 + k * .08, .47 + .04 * (k % 2), .05, .08, .5), (.3, .55, .2), .01)
    elif i == 2:
        for k in range(12): cv.paint(cv.ell(.36 + (k % 4) * .09, .4 + (k // 4) * .07, .035, .03), (.95, .75, .15))
    else: cv.blob(cv.ell(.5, .47, .2, .09), (.6, .65, .75), .012); cv.paint(cv.ell(.62, .5, .02, .02), (0, 0, 0))
    cv.age(r, fade=.3, grime=.5, peel=(.55, .56, .58), streak=.3)
    return cv.img


def art_eye(r, bad):
    # A moulded plastic costume eye: a dome, far too big, with a painted pupil.
    cv = Canvas(128, 128, 1, 1, (.93, .91, .82))
    cv.paint(cv.ell(.5 + (.06 if bad else 0), .48, .27, .29), (.02, .02, .02))
    cv.paint(cv.ell(.4, .6, .07, .07), (.95, .95, .95))
    yel = ss(np.hypot(cv.x - .5, cv.y - .5), .3, .52)
    cv.img *= 1 - yel[..., None] * np.array((.1, .2, .45), np.float32)
    sc = cv.noise(r, 180, 1, gy=8)
    cv.img = cv.img * (1 - .25 * ss(sc, .68, .8)[..., None]) + .2 * ss(sc, .68, .8)[..., None]
    if bad:   # the paint has been scraped and something has run from it
        scrape = ss(cv.noise(r, 16), .5, .56) * ss(np.hypot(cv.x - .56, cv.y - .48), .3, .1)
        cv.img = cv.img * (1 - scrape[..., None]) + np.array((.8, .76, .6), np.float32) * scrape[..., None]
        cv.paint(cv.seg(.6, .3, .63, -.1, .035), (.25, .06, .04), .8)
        cv.paint(cv.seg(.44, .26, .43, -.1, .02), (.25, .06, .04), .7)
    return cv.img


def art_plush(r):
    cv = Canvas(128, 128, 1, 1, (.85, .85, .85))
    cv.paint(cv.ell(.3, .6, .09, .1), (.03, .03, .03)); cv.paint(cv.ell(.7, .6, .09, .1), (.03, .03, .03))
    cv.paint(cv.ell(.27, .64, .03, .03), (.9, .9, .9)); cv.paint(cv.ell(.67, .64, .03, .03), (.9, .9, .9))
    cv.paint(np.maximum(np.abs(cv.ell(.5, .42, .2, .14)) - .018, cv.y - .4), (.1, .05, .05))
    cv.paint(cv.ell(.5, .47, .05, .035), (.25, .1, .1))
    cv.img *= (.7 + .3 * cv.noise(r, 40, 2))[..., None]
    return cv.img


def art_keys(r):
    cv = Canvas(128, 128, 4, 4, (.12, .12, .13))
    for i in range(16):
        x, y = i % 4, i // 4
        c = (.75, .73, .65) if x < 3 else ((.7, .2, .15), (.2, .5, .25), (.8, .65, .2), (.3, .35, .6))[y]
        cv.paint(cv.box(x + .12, y + .12, x + .88, y + .88, .1), c)
        cv.paint(cv.box(x + .4, y + .35, x + .6, y + .65), (.15, .15, .15), .7)
    cv.age(r, fade=.2, grime=.55, streak=0)
    return cv.img


def art_stripes(r):
    cv = Canvas(256, 128, 2, 1, (.92, .9, .82))
    cv.paint(np.abs((cv.x * 6) % 1 - .5) - .25, (.78, .13, .12))
    cv.age(r, fade=.2, grime=.5, streak=.5)
    return cv.img


def art_ticket(r):
    # A strip of prize tickets, yellowed.
    cv = Canvas(256, 128, 4, 2, (.9, .78, .35))
    for i in range(4):
        cv.paint(np.abs(cv.box(i + .12, .25, i + .88, 1.75, .08)) - .03, (.6, .2, .15))
        cv.paint(cv.ell(i + .5, 1., .2, .3), (.6, .2, .15))
        cv.paint(np.abs(cv.x - i) - .015 * (np.sin(cv.y * 40) > 0), (.3, .25, .2))
    cv.age(r, fade=.3, grime=.4, streak=.2)
    return cv.img


def art_box(r, i):
    base = ((.85, .55, .1), (.2, .45, .7), (.75, .2, .35), (.3, .6, .35))[i]
    cv = Canvas(128, 256, 1, 2, base)
    a = np.arctan2(cv.y - 1.3, cv.x - .5)
    cv.blob(np.hypot(cv.x - .5, cv.y - 1.3) - .3 - .06 * np.cos(a * 9), (.98, .9, .3), .02)
    body = (HIPPO, TOAD, WALRUS, RHINO)[i]
    cv.blob(cv.ell(.5, 1.3, .19, .18), body, .02)
    cv.paint(cv.ell(.43, 1.36, .045, .05), (1, 1, 1)); cv.paint(cv.ell(.57, 1.36, .045, .05), (1, 1, 1))
    cv.paint(cv.ell(.44, 1.35, .02, .02), (0, 0, 0)); cv.paint(cv.ell(.58, 1.35, .02, .02), (0, 0, 0))
    cv.paint(np.maximum(cv.ell(.5, 1.27, .1, .06), cv.y - 1.27), (.1, .03, .05))
    cv.blob(cv.ell(.5, .45, .33, .22), (.9, .88, .8), .02)
    for k in range(14): cv.paint(cv.ell(.25 + r.random() * .5, .33 + r.random() * .22, .04, .03, r.random() * 3), (.8, .6, .3))
    cv.paint(cv.box(.1, 1.72, .9, 1.9, .03), (.95, .93, .85))
    cv.age(r, fade=.35, grime=.5, peel=(.6, .5, .38), streak=.35)
    return cv.img


def art_poster(r):
    # "Party rules" style notice: a header, lines of text that are just bars, a mascot waving.
    cv = Canvas(256, 384, 1, 1.5, (.92, .88, .75))
    cv.paint(cv.box(.05, 1.25, .95, 1.44, .03), (.75, .15, .2))
    for i in range(7): cv.paint(cv.box(.12, 1.1 - i * .09, .5 + .35 * ((i * 37) % 10) / 10, 1.13 - i * .09), (.2, .2, .22))
    cv.blob(cv.ell(.68, .28, .2, .22), TOAD, .012)
    cv.paint(cv.ell(.6, .36, .05, .05), (1, 1, 1)); cv.paint(cv.ell(.76, .36, .05, .05), (1, 1, 1))
    cv.paint(cv.ell(.6, .35, .02, .02), (0, 0, 0)); cv.paint(cv.ell(.76, .35, .02, .02), (0, 0, 0))
    cv.paint(np.maximum(cv.ell(.68, .25, .12, .07), cv.y - .25), (.1, .03, .05))
    cv.age(r, fade=.35, grime=.45, streak=.4)
    return cv.img


def build_b():
    img = np.zeros((SIZE, SIZE, 3), np.float32)
    makers = dict(standee=art_standee, sideart=art_sideart, soda=art_soda, screen=art_screen, marquee=art_marquee,
                  panel=art_panel, menu=art_menu, plush=art_plush, keys=art_keys, stripes=art_stripes,
                  ticket=art_ticket, poster=art_poster,
                  eye=lambda r: art_eye(r, False), eye_bad=lambda r: art_eye(r, True),
                  white=lambda r: np.ones((64, 64, 3), np.float32))
    for i in range(4):
        makers[f'label{i}'] = lambda r, i=i: art_label(r, i)
        makers[f'box{i}'] = lambda r, i=i: art_box(r, i)
    for k, name in enumerate(sorted(ART)):
        x, y, w, h = ART[name]
        img[y:y + h, x:x + w] = np.clip(makers[name](np.random.default_rng(500 + k)), 0, 1)
    return img
