#!/usr/bin/env python3
# Draws every texture the guard and the prop kit use, into ./tex.
#
#   python3 tools/models/props_a/textures.py [name ...]     (needs numpy and Pillow)
#
# With names (paint, bag, atlas, ...) only those are redrawn.
#
# build.py runs this by itself when ./tex is missing. Two kinds of texture:
#
# 1. Tiling surfaces (paint, steel, rust, wood, ...): colour, normal and a
#    packed occlusion/roughness/metal map each. They repeat, so a prop gets
#    about 1000 px per metre however big it is, which is what a flashlight at
#    arm's length needs. They are drawn pale; the mesh's vertex colour tints
#    them (green locker, red extinguisher) and carries the baked shadowing.
# 2. Two atlases of one-off artwork: decals.png (opaque labels, dials,
#    screens) and cutouts.png (stencils and scratches with alpha, drawn as
#    alpha-tested quads floating just above a surface). atlas.json maps each
#    name to its UV rectangle.
#
# Every random draw is seeded, so the output is the same on every run.
import json, math, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'tex')


# ---------------------------------------------------------------- noise

def fnoise(n, beta, seed, aniso=(1, 1)):
    """Periodic 1/f noise in 0..1, made in the frequency domain so it tiles.
    aniso > 1 on an axis damps detail along that axis (streaks run along it)."""
    r = np.random.default_rng(seed)
    fx = np.fft.fftfreq(n)[None, :] * aniso[0]
    fy = np.fft.fftfreq(n)[:, None] * aniso[1]
    f = np.sqrt(fx ** 2 + fy ** 2); f[0, 0] = 1
    spec = (r.normal(size=(n, n)) + 1j * r.normal(size=(n, n))) / f ** (beta / 2)
    spec[0, 0] = 0
    x = np.fft.ifft2(spec).real
    lo, hi = np.percentile(x, 1), np.percentile(x, 99)
    return np.clip((x - lo) / (hi - lo), 0, 1)


def blur(x, sigma):
    """Periodic gaussian blur."""
    n = x.shape[0]
    fx = np.fft.fftfreq(n)[None, :]; fy = np.fft.fftfreq(x.shape[0])[:, None]
    k = np.exp(-2 * (math.pi * sigma) ** 2 * (fx ** 2 + fy ** 2))
    return np.fft.ifft2(np.fft.fft2(x) * k).real


def smear_down(x, length):
    """Drag a mask downward (rust and dirt run down a wall), periodically."""
    n = x.shape[0]
    k = np.zeros(n); k[:length] = np.exp(-np.arange(length) / (length / 3)); k /= k.sum()
    return np.fft.ifft(np.fft.fft(x, axis=0) * np.fft.fft(k)[:, None], axis=0).real


def step(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def scratches(n, count, seed, length=(.05, .4), width=1, soft=.6):
    """A tiling mask of thin random lines."""
    r = np.random.default_rng(seed)
    im = Image.new('L', (n, n), 0); d = ImageDraw.Draw(im)
    for _ in range(count):
        x, y = r.uniform(0, n, 2); a = r.uniform(0, math.tau); l = r.uniform(*length) * n
        v = int(r.uniform(90, 255))
        for ox in (-n, 0, n):
            for oy in (-n, 0, n):
                d.line([x + ox, y + oy, x + ox + math.cos(a) * l, y + oy + math.sin(a) * l], fill=v, width=width)
    return blur(np.asarray(im, float) / 255, soft)


def normal_map(h, strength):
    """Height (0..1) to a tangent-space normal map, green up as glTF wants."""
    n = h.shape[0]
    du = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / 2 * n
    dv = (np.roll(h, 1, 0) - np.roll(h, -1, 0)) / 2 * n   # image rows run down, V runs up
    nx, ny, nz = -du * strength, -dv * strength, np.ones_like(h)
    l = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    return np.stack([nx / l, ny / l, nz / l], -1) * .5 + .5


def save(name, rgb):
    a = (np.clip(rgb, 0, 1) * 255 + .5).astype(np.uint8)
    Image.fromarray(a).save(os.path.join(OUT, name + '.png'))


def save_set(name, colour, height, strength, rough, metal):
    """Write <name>_c, <name>_n and <name>_orm."""
    save(name + '_c', colour)
    save(name + '_n', normal_map(height, strength))
    one = np.ones_like(height)
    save(name + '_orm', np.stack([one, one * rough, one * metal], -1))


def mix(a, b, t):
    t = t[..., None] if np.ndim(t) == 2 and np.ndim(a) != np.ndim(t) else t
    return a * (1 - t) + b * t


def col(*c):
    return np.array(c, float)


# ---------------------------------------------------------------- tiling surfaces

def tex_paint():
    """Old enamel on steel: orange peel, runs, scuffs, and chips down to rust.
    The most used surface in the kit, so it gets twice the resolution."""
    n = 1024
    big = fnoise(n, 2.6, 1); fine = fnoise(n, 1.2, 2); runs = fnoise(n, 2.2, 3, (6, 1))
    chips = step(fnoise(n, 1.9, 4) * .75 + fnoise(n, 2.8, 5) * .35, .77, .8)
    halo = np.clip(smear_down(blur(chips, 10), 180) * 3.2, 0, 1)
    scr = scratches(n, 110, 6, width=2, soft=.9)
    c = np.ones((n, n, 3)) * .8
    c *= (.86 + .14 * big)[..., None] * (.94 + .06 * fine)[..., None] * (.93 + .07 * runs)[..., None]
    c = mix(c, c * col(.86, .66, .46), halo * .75)                     # rust weeping below each chip
    c = mix(c, c * .7, np.clip(scr * 1.3, 0, 1))
    rust = mix(col(.2, .1, .06), col(.42, .2, .08), fnoise(n, 1.5, 7)[..., None])
    c = mix(c, rust, chips)
    h = (1 - chips) * .55 + fine * .1 + runs * .1 - scr * .22
    save_set('paint', c, h, .008, mix(.5 + .15 * big, .9, chips) + scr * .2, chips * .25)


def tex_steel():
    """Bare galvanised sheet: spangle, brushing, scratches, rust spots that run."""
    n = 512
    brush = fnoise(n, 1.4, 11, (14, 1)); spangle = fnoise(n, 2.3, 12); fine = fnoise(n, .8, 13)
    spots = step(fnoise(n, 1.6, 14), .86, .9)
    run = np.clip(smear_down(spots, 110) * 2.2 + spots, 0, 1)
    scr = scratches(n, 110, 15, (.03, .3))
    c = np.ones((n, n, 3)) * col(.66, .68, .7)
    c *= (.8 + .2 * spangle)[..., None] * (.9 + .1 * brush)[..., None] * (.95 + .05 * fine)[..., None]
    c = mix(c, c * 1.25, np.clip(scr, 0, 1) * .6)
    c = mix(c, col(.4, .21, .1) * (.7 + .5 * fine)[..., None], run * .85)
    h = brush * .12 + fine * .08 - scr * .3 + spots * .25
    save_set('steel', c, h, .01, mix(.42 + .2 * spangle, .9, run), .45 * (1 - run))


def tex_rust():
    """Steel that has been wet for years: scale, pits, orange bloom."""
    n = 512
    a = fnoise(n, 2.2, 21); b = fnoise(n, 1.4, 22); fine = fnoise(n, .7, 23)
    c = mix(col(.2, .1, .07), col(.52, .25, .1), a[..., None])
    c = mix(c, col(.7, .42, .16), step(b, .62, .8)[..., None] * .7)
    c = mix(c, col(.12, .09, .08), step(1 - b, .7, .85)[..., None] * .8)
    c *= (.82 + .18 * fine)[..., None]
    h = a * .5 + b * .35 + fine * .25
    save_set('rust', c, h, .022, .85 + .1 * fine, .15 * step(1 - b, .7, .85))


def tex_wood():
    """Rough-sawn softwood boards, four to a tile, grain along U."""
    n = 512
    rows = 4; ph = n // rows
    y = np.arange(n)[:, None] * np.ones((1, n)); plank = (y // ph).astype(int)
    grain = fnoise(n, 1.6, 31, (30, 1)); broad = fnoise(n, 2.4, 32, (5, 1)); fine = fnoise(n, .9, 33, (4, 1))
    r = np.random.default_rng(34)
    c = np.zeros((n, n, 3)); h = np.zeros((n, n))
    for p in range(rows):
        m = plank == p
        sh = int(r.integers(0, n))                                     # each board is a different piece of the grain
        g = np.roll(grain, sh, 1); bb = np.roll(broad, sh, 1)
        tone = col(.74, .6, .43) * r.uniform(.8, 1.05) * col(1, r.uniform(.95, 1.03), r.uniform(.88, 1.05))
        cc = tone[None, None] * (.72 + .28 * g)[..., None] * (.85 + .15 * bb)[..., None]
        c[m] = cc[m]; h[m] = (g * .5 + bb * .2)[m]
    for _ in range(5):                                                 # knots
        kx, ky = r.uniform(0, n), (r.integers(0, rows) + r.uniform(.3, .7)) * ph
        dx = (np.arange(n)[None, :] - kx + n / 2) % n - n / 2; dy = y - ky
        d = np.sqrt((dx / 1.6) ** 2 + dy ** 2); k = np.exp(-(d / r.uniform(5, 10)) ** 2)
        c = mix(c, col(.2, .12, .07), k * .9); h -= k * .3
    edge = np.minimum(y % ph, ph - 1 - y % ph)
    gap = 1 - step(edge, .5, 3.5)
    c = mix(c, col(.05, .04, .03), gap); c *= (.9 + .1 * fine)[..., None]
    c = mix(c, c * col(.55, .52, .5), step(fnoise(n, 2.6, 35), .35, .95) * .5)   # grey weathering and damp
    h = h * .6 + fine * .15 - gap * 1.2
    save_set('wood', c, h, .016, .78 + .15 * grain, np.zeros((n, n)))


def tex_cardboard():
    n = 512
    y = np.arange(n)[:, None] * np.ones((1, n))
    flute = .5 + .5 * np.sin(y / n * math.tau * 64)
    fibre = fnoise(n, 1.3, 41, (8, 1)); big = fnoise(n, 2.6, 42); fine = fnoise(n, .7, 43)
    stain = step(fnoise(n, 2.8, 44), .5, .95); crease = scratches(n, 9, 45, (.2, .6), 2, 1.2)
    c = np.ones((n, n, 3)) * col(.74, .58, .4)
    c *= (.85 + .15 * big)[..., None] * (.9 + .1 * fibre)[..., None] * (.96 + .04 * flute)[..., None] * (.95 + .05 * fine)[..., None]
    c = mix(c, c * col(.62, .54, .44), stain * .7)
    c = mix(c, c * 1.15, np.clip(crease, 0, 1) * .5)
    h = flute * .1 + fibre * .2 + fine * .1 - crease * .5 + big * .3
    save_set('cardboard', c, h, .01, .88 + .08 * fibre, np.zeros((n, n)))


def tex_fabric():
    """A coarse twill, pale so the uniform, the jacket and the mop can tint it."""
    n = 512
    x = np.arange(n)[None, :] * np.ones((n, 1)); y = np.arange(n)[:, None] * np.ones((1, n))
    k = math.tau * 64 / n
    weave = .5 + .25 * np.sin((x + y) * k) + .25 * np.sin(x * k * 2) * np.sin(y * k * 2)
    fuzz = fnoise(n, 1.0, 51); big = fnoise(n, 2.5, 52); pill = step(fnoise(n, 1.4, 53), .8, .9)
    c = np.ones((n, n, 3)) * .82
    c *= (.78 + .22 * weave)[..., None] * (.9 + .1 * fuzz)[..., None] * (.85 + .15 * big)[..., None]
    c = mix(c, c * 1.12, pill * .5)
    h = weave * .6 + fuzz * .25 + pill * .3
    save_set('fabric', c, h, .012, .9 + .08 * fuzz, np.zeros((n, n)))


def tex_plastic():
    """Moulded plastic gone yellow: speckle, scuffs, a greasy sheen."""
    n = 256
    fine = fnoise(n, .5, 61); big = fnoise(n, 2.6, 62); scr = scratches(n, 60, 63, (.05, .35))
    c = np.ones((n, n, 3)) * .84
    c *= (.94 + .06 * fine)[..., None]
    c = mix(c, c * col(.95, .88, .7), big * .6)
    c = mix(c, c * .72, np.clip(scr, 0, 1) * .7)
    h = fine * .35 - scr * .4
    save_set('plastic', c, h, .012, .42 + .25 * big + scr * .3, np.zeros((n, n)))


def tex_rubber():
    n = 256
    fine = fnoise(n, .9, 71); big = fnoise(n, 2.4, 72); dust = step(fnoise(n, 1.8, 73), .55, .8)
    c = np.ones((n, n, 3)) * .62
    c *= (.8 + .2 * fine)[..., None] * (.85 + .15 * big)[..., None]
    c = mix(c, col(.72, .7, .66), dust * .25)
    save_set('rubber', c, fine * .7 + big * .3, .03, .8 + .15 * dust, np.zeros((n, n)))


def tex_bag():
    """Bin-liner film: sharp creases running every way, shiny between them."""
    n = 512
    ridge = lambda seed, beta: 1 - np.abs(fnoise(n, beta, seed) * 2 - 1)
    crease = ridge(91, 3.6) ** 10 * .8 + ridge(92, 3.0) ** 14 * .6 + ridge(93, 2.6) ** 18 * .4
    soft = fnoise(n, 2.4, 94)
    c = np.ones((n, n, 3)) * .7
    c *= (.8 + .2 * soft)[..., None]
    c = mix(c, np.ones(3), np.clip(crease, 0, 1) * .5)                  # the film stretches pale along a crease
    save_set('bag', c, crease * .6 + soft * .4, .02, .3 + .25 * soft + .3 * np.clip(crease, 0, 1), np.zeros((n, n)))


def tex_knurl():
    """Diamond knurling for the torch grip, with dirt packed into the cuts."""
    n = 256
    x = np.arange(n)[None, :] * np.ones((n, 1)); y = np.arange(n)[:, None] * np.ones((1, n))
    tri = lambda t: 1 - np.abs((t % 1) * 2 - 1)
    hgt = np.minimum(tri((x + y) / n * 16), tri((x - y) / n * 16))
    wear = fnoise(n, 2.4, 81); fine = fnoise(n, .8, 82)
    c = np.ones((n, n, 3)) * col(.62, .63, .65)
    c = mix(c * .32, c, step(hgt, .1, .55)[..., None])
    c = mix(c, c * 1.3, (step(hgt, .6, .9) * step(wear, .4, .7))[..., None])   # peaks polished by a hand
    c *= (.92 + .08 * fine)[..., None]
    save_set('knurl', c, hgt, .05, .6 - .25 * step(hgt, .6, .9) * wear, .5 * step(hgt, .2, .6))


# ---------------------------------------------------------------- artwork helpers

def font_path(pattern):
    try:
        return subprocess.run(['fc-match', '-f', '%{file}', pattern], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return None


FONTS = {'bold': font_path('DejaVu Sans:bold'), 'cond': font_path('DejaVu Sans Condensed:bold'),
         'mono': font_path('Liberation Mono:bold'), 'serif': font_path('Liberation Serif:bold'),
         'hand': font_path('DejaVu Sans:oblique')}


def font(kind, size):
    p = FONTS.get(kind)
    return ImageFont.truetype(p, size) if p else ImageFont.load_default(size)


def text(d, xy, s, kind='bold', size=20, fill=(0, 0, 0), anchor='mm', maxw=None):
    """Draw a line of text; with maxw, shrink it until it fits that width."""
    f = font(kind, size)
    while maxw and size > 6 and d.textlength(s, font=f) > maxw:
        size -= 1; f = font(kind, size)
    d.text(xy, s, font=f, fill=fill, anchor=anchor)


def age(im, seed, dirt=.35, yellow=.25, edge=.35, scr=14):
    """Make a clean drawing look handled: blotches, yellowing, grime that
    gathers at the border, a few scratches."""
    dirt *= .6
    w, h = im.size
    n = 1 << (max(w, h) - 1).bit_length()
    a = np.asarray(im.convert('RGB'), float) / 255
    blot = fnoise(n, 2.4, seed)[:h, :w]; fine = fnoise(n, 1.0, seed + 1)[:h, :w]
    a *= (1 - dirt * step(blot, .2, 1))[..., None] * (.93 + .07 * fine)[..., None]
    a = mix(a, a * col(1, .9, .68), yellow * blot)
    yy, xx = np.mgrid[0:h, 0:w]
    e = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy)) / (min(w, h) * .12)
    a *= (1 - edge * (1 - step(e, 0, 1)) * (.5 + .5 * fine))[..., None]
    s = scratches(n, scr, seed + 2, (.03, .25))[:h, :w]
    a = mix(a, a * .55 + .12, np.clip(s, 0, 1) * .7)
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))


def stencil_mask(s, size, w, h, seed, kind='cond'):
    """Sprayed stencil lettering as an alpha mask: bridges cut through each
    letter, and the paint breaks up where the spray was thin."""
    im = Image.new('L', (w, h), 0); d = ImageDraw.Draw(im)
    f = font(kind, size)
    while d.textlength(s, font=f) > w - 12: size -= 2; f = font(kind, size)
    tw = d.textlength(s, font=f); x = (w - tw) / 2
    d.text((x, h / 2), s, font=f, fill=255, anchor='lm')
    for i, ch in enumerate(s):                                         # a bridge through the middle of every glyph
        if ch == ' ': continue
        cx = x + d.textlength(s[:i], font=f) + d.textlength(ch, font=f) / 2
        b = max(2, size // 14)
        d.rectangle([cx - b / 2, 0, cx + b / 2, h], fill=0)
    n = 1 << (max(w, h) - 1).bit_length()
    a = np.asarray(im, float) / 255
    a = a * step(fnoise(n, 1.3, seed)[:h, :w] * .6 + fnoise(n, 2.5, seed + 1)[:h, :w] * .5, .2, .3)
    return a


# ---------------------------------------------------------------- opaque decals
# Each draws on its own PIL image; pack() lays them out and records the rectangles.

def d_hazard(w, h):
    """Yellow and black chevrons that tile along U (the stripe period divides the width)."""
    yy, xx = np.mgrid[0:h, 0:w]
    s = ((xx + yy) // 64) % 2
    a = mix(col(.92, .72, .08), col(.07, .07, .07), s.astype(float)[..., None])
    n = 2048
    chip = step(fnoise(n, 1.8, 101)[:h, :w] * .7 + fnoise(n, 2.8, 102)[:h, :w] * .4, .68, .72)
    grime = fnoise(n, 2.2, 103, (1, 5))[:h, :w]
    a = mix(a, col(.24, .13, .08) * (.6 + .6 * fnoise(n, 1.2, 104)[:h, :w])[..., None], chip)
    a *= (1 - .55 * step(yy / h, .45, 1) * (.4 + .6 * grime))[..., None]      # boot scuffs and mop water at the bottom
    a *= (.8 + .2 * grime)[..., None]
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))


def d_battery(w, h):
    im = Image.new('RGB', (w, h), (240, 196, 20)); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w, h * .2], fill=(190, 30, 24)); d.rectangle([0, h * .82, w, h], fill=(20, 20, 22))
    for k in range(2):                                                 # the label wraps the cell, so draw the face twice
        ox = k * w / 2
        text(d, (ox + w * .25, h * .1), 'VOLTZ', 'bold', int(h * .15), (255, 240, 200))
        bolt = [(.3, .26), (.2, .52), (.26, .52), (.2, .78), (.33, .46), (.27, .46)]
        d.polygon([(ox + x * w * .5, y * h) for x, y in bolt], fill=(20, 20, 22))
        text(d, (ox + w * .31, h * .4), 'HEAVY', 'cond', int(h * .15), (20, 20, 22))
        text(d, (ox + w * .31, h * .56), 'DUTY', 'cond', int(h * .15), (20, 20, 22))
        text(d, (ox + w * .31, h * .71), '6V LANTERN', 'cond', int(h * .075), (150, 20, 20))
        text(d, (ox + w * .25, h * .91), 'DO NOT RECHARGE', 'cond', int(h * .06), (230, 200, 60))
    return age(im, 110, .3, .15, .3, 30)


def d_dial(w, h):
    im = Image.new('RGB', (w, h), (58, 54, 48)); d = ImageDraw.Draw(im)
    cx, cy, r = w / 2, h / 2, w * .47
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(232, 222, 190), outline=(30, 28, 26), width=5)
    for i in range(60):
        a = i / 60 * math.tau; l = .86 if i % 5 == 0 else .93
        d.line([cx + math.sin(a) * r * l, cy - math.cos(a) * r * l, cx + math.sin(a) * r * .98, cy - math.cos(a) * r * .98],
               fill=(25, 25, 25), width=4 if i % 5 == 0 else 2)
    for i in range(1, 13):
        a = i / 12 * math.tau
        text(d, (cx + math.sin(a) * r * .72, cy - math.cos(a) * r * .72), str(i), 'serif', int(r * .2), (25, 25, 25))
    text(d, (cx, cy - r * .36), 'VIGIL', 'serif', int(r * .13), (120, 20, 20))
    text(d, (cx, cy + r * .34), 'WATCHCLOCK CO.', 'cond', int(r * .075), (40, 40, 40))
    for a, l, wd in ((math.radians(97), .5, 9), (math.radians(318), .78, 6)):   # hands stuck at ten to three
        d.line([cx - math.sin(a) * r * .1, cy + math.cos(a) * r * .1, cx + math.sin(a) * r * l, cy - math.cos(a) * r * l], fill=(15, 15, 15), width=wd)
    d.ellipse([cx - 9, cy - 9, cx + 9, cy + 9], fill=(15, 15, 15))
    return age(im, 120, .3, .5, .25, 10)


def d_card(w, h):
    im = Image.new('RGB', (w, h), (214, 196, 150)); d = ImageDraw.Draw(im)
    text(d, (w / 2, 16), 'NIGHT WATCH', 'cond', 15, (120, 30, 30))
    r = np.random.default_rng(130)
    for i in range(11):
        y = 34 + i * 19
        d.line([6, y, w - 6, y], fill=(120, 110, 90), width=1)
        if i < 7: text(d, (w * .5, y + 10), f'{int(r.integers(1, 5))}:{int(r.integers(10, 59))} AM', 'mono', 11, (60, 40, 110))
    d.line([w * .3, 26, w * .3, h - 8], fill=(120, 110, 90), width=1)
    return age(im, 131, .3, .3, .3, 4)


def d_gauge(w, h):
    im = Image.new('RGB', (w, h), (30, 30, 30)); d = ImageDraw.Draw(im)
    cx, cy, r = w / 2, h / 2, w * .46
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(226, 220, 196))
    arc = lambda t: math.radians(-130 + 260 * t)
    d.arc([cx - r * .8, cy - r * .8, cx + r * .8, cy + r * .8], -90 - 130 + 260 * .75, -90 + 130, fill=(190, 30, 25), width=int(r * .12))
    d.arc([cx - r * .8, cy - r * .8, cx + r * .8, cy + r * .8], -90 - 130, -90 - 130 + 260 * .2, fill=(210, 150, 20), width=int(r * .12))
    for i in range(21):
        a = arc(i / 20); l = .62 if i % 5 == 0 else .7
        d.line([cx + math.sin(a) * r * l, cy - math.cos(a) * r * l, cx + math.sin(a) * r * .86, cy - math.cos(a) * r * .86], fill=(20, 20, 20), width=3 if i % 5 == 0 else 1)
    for i, s in enumerate(('0', '25', '50', '75', '100')):
        a = arc(i / 4); text(d, (cx + math.sin(a) * r * .47, cy - math.cos(a) * r * .47), s, 'cond', int(r * .15), (20, 20, 20))
    text(d, (cx, cy + r * .45), 'CHARGE %', 'cond', int(r * .14), (20, 20, 20))
    a = arc(.12)
    d.line([cx, cy, cx + math.sin(a) * r * .78, cy - math.cos(a) * r * .78], fill=(170, 20, 20), width=5)
    d.ellipse([cx - 10, cy - 10, cx + 10, cy + 10], fill=(20, 20, 20))
    return age(im, 140, .35, .4, .3, 12)


def d_exit(w, h):
    im = Image.new('RGB', (w, h), (16, 120, 50)); d = ImageDraw.Draw(im)
    d.rectangle([8, 8, w - 9, h - 9], outline=(225, 245, 225), width=5)
    text(d, (w * .5, h * .5), 'EXIT', 'bold', int(h * .58), (235, 250, 235))
    return age(im, 150, .25, .1, .3, 6)


def d_screen(w, h, seed=0, label='CAM 1'):
    """A dead-channel CRT picture: a ghost of a corridor under snow and scan lines."""
    n = 512
    a = fnoise(n, .3, 160 + seed)[:h, :w] * .35 + fnoise(n, 2.2, 170 + seed)[:h, :w] * .25
    im = Image.fromarray((a * 255).astype(np.uint8)); d = ImageDraw.Draw(im)
    vx, vy = w * (.4 + .1 * seed), h * .45                              # one-point corridor
    for x0, y0 in ((0, 0), (w, 0), (0, h), (w, h)):
        d.line([x0, y0, vx + (x0 - vx) * .25, vy + (y0 - vy) * .25], fill=150, width=2)
    d.rectangle([vx - w * .12, vy - h * .14, vx + w * .13, vy + h * .14], outline=150, width=2)
    if seed == 1: d.ellipse([vx - 9, vy - 5, vx + 9, vy + 22], fill=20)          # something stood in the doorway
    a = np.asarray(im.filter(ImageFilter.GaussianBlur(1.2)), float) / 255
    yy = np.mgrid[0:h, 0:w][0]
    a = a * (.72 + .28 * (yy % 3 > 0)) + .1 * fnoise(n, .2, 180 + seed)[:h, :w]
    band = np.exp(-((yy - h * (.3 + .25 * seed)) / 9.0) ** 2)
    a = a * (1 - .5 * band) + .3 * band
    im = Image.fromarray((np.clip(np.stack([a * .78, a, a * .86], -1), 0, 1) * 255).astype(np.uint8)); d = ImageDraw.Draw(im)
    text(d, (10, 8), label, 'mono', 16, (210, 235, 215), 'la')
    text(d, (w - 10, h - 8), '03:1%d:4%d' % (seed + 2, seed * 3), 'mono', 14, (210, 235, 215), 'rd')
    if seed == 2: text(d, (w / 2, h / 2), 'NO SIGNAL', 'mono', 24, (225, 240, 225))
    return im


def d_danger(w, h):
    im = Image.new('RGB', (w, h), (236, 190, 20)); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w, h * .36], fill=(15, 15, 15)); text(d, (w / 2, h * .18), 'DANGER', 'bold', int(h * .26), (236, 190, 20))
    text(d, (w * .6, h * .56), 'HIGH VOLTAGE', 'cond', int(h * .17), (15, 15, 15), maxw=w * .7)
    text(d, (w * .6, h * .8), 'ISOLATE BEFORE OPENING', 'cond', int(h * .1), (15, 15, 15), maxw=w * .7)
    bolt = [(.13, .42), (.06, .7), (.11, .7), (.07, .95), (.18, .62), (.13, .62), (.19, .42)]
    d.polygon([(x * w, y * h) for x, y in bolt], fill=(15, 15, 15))
    return age(im, 190, .35, .2, .35, 20)


def plate(w, h, lines, bg=(196, 190, 170), fg=(20, 20, 20), seed=200, sizes=None, rivets=True):
    """A stamped instruction plate."""
    im = Image.new('RGB', (w, h), bg); d = ImageDraw.Draw(im)
    d.rectangle([3, 3, w - 4, h - 4], outline=fg, width=2)
    for i, s in enumerate(lines):
        sz = sizes[i] if sizes else int(h / (len(lines) + .6) * .62)
        text(d, (w / 2, h * (i + 1) / (len(lines) + 1)), s, 'cond', sz, fg, maxw=w - 26)
    if rivets:
        for x, y in ((9, 9), (w - 10, 9), (9, h - 10), (w - 10, h - 10)):
            d.ellipse([x - 4, y - 4, x + 4, y + 4], fill=(110, 105, 95), outline=(40, 40, 40))
    return age(im, seed, .35, .3, .3, 10)


def d_extinguisher(w, h):
    im = Image.new('RGB', (w, h), (232, 226, 205)); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w, h * .24], fill=(180, 26, 22)); text(d, (w / 2, h * .12), 'FIRE', 'bold', int(h * .17), (245, 235, 215))
    text(d, (w / 2, h * .32), 'DRY POWDER  ABC', 'cond', int(h * .075), (20, 20, 20))
    for i, s in enumerate(('1  PULL PIN', '2  AIM AT BASE', '3  SQUEEZE', '4  SWEEP')):
        text(d, (w * .1, h * (.44 + i * .1)), s, 'cond', int(h * .07), (20, 20, 20), 'lm')
    d.rectangle([w * .08, h * .84, w * .92, h * .96], outline=(20, 20, 20), width=2)
    text(d, (w / 2, h * .9), 'LAST CHECKED 03/1994', 'mono', int(h * .05), (150, 20, 20))
    return age(im, 210, .35, .35, .35, 16)


def d_flammable(w, h):
    im = Image.new('RGB', (w, h), (225, 220, 200)); d = ImageDraw.Draw(im)
    c = w / 2
    d.polygon([(c, h * .04), (w * .96, h * .5), (c, h * .96), (w * .04, h * .5)], fill=(200, 40, 25), outline=(20, 20, 20))
    flame = [(.5, .2), (.6, .36), (.57, .28), (.66, .46), (.6, .6), (.4, .6), (.34, .46), (.44, .34), (.45, .42)]
    d.polygon([(x * w, y * h) for x, y in flame], fill=(20, 20, 20))
    text(d, (c, h * .7), 'FLAMMABLE', 'cond', int(h * .085), (20, 20, 20))
    text(d, (c, h * .8), '3', 'bold', int(h * .09), (20, 20, 20))
    return age(im, 220, .4, .3, .35, 18)


def d_wetfloor(w, h):
    im = Image.new('RGB', (w, h), (240, 196, 16)); d = ImageDraw.Draw(im)
    text(d, (w / 2, h * .1), 'CAUTION', 'bold', int(h * .1), (20, 20, 20))
    tri = [(w * .5, h * .2), (w * .9, h * .68), (w * .1, h * .68)]
    d.polygon(tri, fill=(20, 20, 20)); d.polygon([(w * .5, h * .26), (w * .82, h * .65), (w * .18, h * .65)], fill=(240, 196, 16))
    # the falling figure: head, a bent body, flung limbs
    d.ellipse([w * .56, h * .36, w * .64, h * .42], fill=(20, 20, 20))
    for a, b in (((.57, .43), (.46, .52)), ((.46, .52), (.36, .47)), ((.46, .52), (.5, .61)), ((.54, .45), (.66, .5)), ((.54, .45), (.44, .4))):
        d.line([a[0] * w, a[1] * h, b[0] * w, b[1] * h], fill=(20, 20, 20), width=int(w * .04))
    d.line([w * .3, h * .63, w * .7, h * .63], fill=(20, 20, 20), width=3)
    text(d, (w / 2, h * .78), 'WET', 'bold', int(h * .11), (20, 20, 20)); text(d, (w / 2, h * .9), 'FLOOR', 'bold', int(h * .11), (20, 20, 20))
    return age(im, 230, .4, .1, .4, 30)


def d_paper(w, h, kind):
    """Desk paperwork: 0 the logbook spread, 1 an incident form, 2 a memo with a mug ring."""
    im = Image.new('RGB', (w, h), (228, 222, 204)); d = ImageDraw.Draw(im)
    r = np.random.default_rng(240 + kind)
    scrawl = lambda x0, x1, y, c: d.line([(x, y + math.sin(x * .9 + y) * 2.2 + r.uniform(-1.5, 1.5)) for x in np.arange(x0, x1, 3)], fill=c, width=1)
    if kind == 0:
        d.line([w / 2, 0, w / 2, h], fill=(120, 110, 95), width=3)
        for side in (0, 1):
            x0 = side * w / 2 + 10
            text(d, (x0, 8), ('NIGHT LOG' if side == 0 else 'ROUNDS'), 'cond', 13, (60, 60, 60), 'la')
            for i in range(int((h - 34) / 13)):
                y = 30 + i * 13
                d.line([x0, y, x0 + w / 2 - 20, y], fill=(150, 170, 200), width=1)
                if r.random() < (.8 if side == 0 else .45): scrawl(x0 + 4, x0 + r.uniform(.2, .45) * w, y - 4, (30, 40, 110))
        text(d, (w * .75, h * .78), 'IT MOVED', 'hand', 19, (150, 20, 20))
        d.line([w * .6, h * .83, w * .9, h * .835], fill=(150, 20, 20), width=2)
    elif kind == 1:
        text(d, (w / 2, 16), 'INCIDENT REPORT', 'bold', 15, (30, 30, 30))
        d.rectangle([10, 30, w - 10, h - 12], outline=(60, 60, 60))
        for i in range(12):
            y = 48 + i * 17
            if y > h - 20: break
            d.line([16, y, w - 16, y], fill=(110, 110, 110), width=1)
            if i < 8: scrawl(20, r.uniform(.4, .9) * w, y - 5, (25, 25, 35))
    else:
        text(d, (14, 18), 'MEMO', 'bold', 18, (30, 30, 30), 'lm')
        for i, s in enumerate(('TO: NIGHT STAFF', 'DO NOT RETURN THE', 'COSTUMES TO BAY 4.', 'THEY ARE TO STAY', 'WHERE THEY ARE.', '', '  - MGMT')):
            text(d, (14, 46 + i * 19), s, 'mono', 13, (30, 30, 30), 'lm')
        d.ellipse([w * .45, h * .62, w * .95, h * .62 + w * .5], outline=(120, 80, 40), width=5)   # coffee ring
    return age(im, 250 + kind, .3, .35, .3, 3)


def d_keyboard(w, h):
    im = Image.new('RGB', (w, h), (200, 192, 168)); d = ImageDraw.Draw(im)
    rows = ['`1234567890-=', 'QWERTYUIOP[]', "ASDFGHJKL;'", 'ZXCVBNM,./']
    kw = w / 15.5; kh = h / 5.6
    r = np.random.default_rng(260)
    for j, row in enumerate(rows):
        x = kw * (.4 + .45 * j)
        for i, ch in enumerate(row):
            x0, y0 = x + i * kw, kh * (.35 + j)
            g = int(r.uniform(205, 228)); wear = r.random() < .2
            d.rounded_rectangle([x0 + 2, y0 + 2, x0 + kw - 2, y0 + kh - 2], 4, fill=(88, 84, 74))
            d.rounded_rectangle([x0 + 3, y0 + 2, x0 + kw - 4, y0 + kh - 6], 4, fill=(g, g - 6, g - 26))
            if not wear: text(d, (x0 + kw * .38, y0 + kh * .36), ch, 'cond', int(kh * .34), (50, 50, 50))
    d.rounded_rectangle([kw * 3.6, kh * 4.4, kw * 10.6, kh * 5.3], 4, fill=(88, 84, 74))
    d.rounded_rectangle([kw * 3.6 + 1, kh * 4.4, kw * 10.6 - 2, kh * 5.3 - 4], 4, fill=(214, 208, 184))
    return age(im, 261, .4, .5, .3, 8)


def d_badge(w, h):
    """Gold shield. The mesh cuts the shield shape, so the art fills the square."""
    a = np.ones((h, w, 3)) * col(.78, .6, .2)
    yy, xx = np.mgrid[0:h, 0:w]
    a *= (.75 + .35 * np.sin((xx + yy) / w * 9) ** 2)[..., None]
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)); d = ImageDraw.Draw(im)
    d.ellipse([w * .25, h * .25, w * .75, h * .75], outline=(90, 60, 15), width=4)
    star = [(w / 2 + math.sin(i * math.tau / 10) * w * (.2 if i % 2 == 0 else .09), h / 2 - math.cos(i * math.tau / 10) * h * (.2 if i % 2 == 0 else .09)) for i in range(10)]
    d.polygon(star, fill=(110, 75, 20))
    text(d, (w / 2, h * .14), 'SECURITY', 'cond', int(h * .12), (70, 45, 10))
    text(d, (w / 2, h * .86), 'No. 0413', 'cond', int(h * .1), (70, 45, 10))
    return age(im, 270, .3, .1, .3, 16)


def d_patch(w, h):
    im = Image.new('RGB', (w, h), (28, 36, 60)); d = ImageDraw.Draw(im)
    d.rounded_rectangle([5, 5, w - 6, h - 6], 16, outline=(210, 170, 50), width=6)
    text(d, (w / 2, h * .26), 'MASCOT', 'cond', int(h * .17), (225, 215, 190))
    text(d, (w / 2, h * .45), 'DEPOT', 'cond', int(h * .17), (225, 215, 190))
    text(d, (w / 2, h * .74), 'NIGHT', 'bold', int(h * .13), (210, 170, 50))
    a = np.asarray(im, float) / 255
    yy, xx = np.mgrid[0:h, 0:w]
    a *= (.82 + .18 * np.sin((xx - yy) * 1.6) ** 2)[..., None]            # embroidery thread
    return age(Image.fromarray((a * 255).astype(np.uint8)), 280, .3, .1, .2, 2)


def d_mug(w, h):
    im = Image.new('RGB', (w, h), (226, 222, 210)); d = ImageDraw.Draw(im)
    text(d, (w * .5, h * .3), "WORLD'S", 'cond', int(h * .2), (150, 30, 30))
    text(d, (w * .5, h * .52), 'OKAYEST', 'bold', int(h * .22), (30, 30, 30))
    text(d, (w * .5, h * .76), 'GUARD', 'cond', int(h * .2), (150, 30, 30))
    a = np.asarray(im, float) / 255
    a = mix(a, a * col(.62, .45, .3), step(fnoise(256, 2.2, 291, (5, 1))[:h, :w], .55, .8) * .55)
    return age(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)), 292, .25, .2, .2, 6)


def d_radio(w, h):
    """Front of a handheld radio (and reused as a speaker grille)."""
    im = Image.new('RGB', (w, h), (30, 31, 33)); d = ImageDraw.Draw(im)
    for j in range(9):
        for i in range(6):
            x, y = w * (.2 + i * .12), h * (.34 + j * .055)
            d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(8, 8, 8))
    d.rectangle([w * .18, h * .08, w * .82, h * .26], fill=(60, 80, 50), outline=(10, 10, 10), width=2)
    text(d, (w * .5, h * .17), 'CH 4', 'mono', int(h * .09), (20, 30, 15))
    for i in range(3):
        d.rounded_rectangle([w * (.18 + i * .23), h * .86, w * (.36 + i * .23), h * .95], 3, fill=(70, 70, 72))
    return age(im, 300, .25, .1, .3, 14)


def d_shipping(w, h):
    im = Image.new('RGB', (w, h), (232, 226, 206)); d = ImageDraw.Draw(im)
    d.rectangle([4, 4, w - 5, h - 5], outline=(30, 30, 30), width=2)
    text(d, (12, h * .16), 'FUNLAND PARKS LTD', 'bold', int(h * .11), (30, 30, 30), 'lm')
    d.line([8, h * .27, w - 8, h * .27], fill=(30, 30, 30), width=2)
    text(d, (12, h * .4), 'CONTENTS:  HEADS (LARGE) x4', 'mono', int(h * .085), (30, 30, 30), 'lm')
    text(d, (12, h * .54), 'DEST:  DEPOT - LONG STORAGE', 'mono', int(h * .085), (30, 30, 30), 'lm')
    for i in range(36):                                                # a barcode nobody will scan
        if (i * 7919) % 5 < 3: d.rectangle([14 + i * 5, h * .68, 14 + i * 5 + ((i * 31) % 3), h * .92], fill=(20, 20, 20))
    text(d, (w * .82, h * .8), 'DO NOT', 'bold', int(h * .1), (170, 25, 25)); text(d, (w * .82, h * .91), 'OPEN', 'bold', int(h * .1), (170, 25, 25))
    return age(im, 310, .4, .35, .35, 10)


def d_calendar(w, h):
    im = Image.new('RGB', (w, h), (230, 226, 212)); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w, h * .2], fill=(150, 30, 30)); text(d, (w / 2, h * .1), 'OCTOBER', 'bold', int(h * .11), (240, 230, 215))
    for i in range(31):
        x, y = w * (.1 + (i % 7) * .135), h * (.3 + (i // 7) * .14)
        text(d, (x, y), str(i + 1), 'cond', int(h * .07), (40, 40, 40))
        if i < 22: d.line([x - 7, y - 7, x + 7, y + 7], fill=(170, 30, 30), width=2)
    d.ellipse([w * .1 + .135 * w - 13, h * .3 + 3 * .14 * h - 12, w * .1 + .135 * w + 13, h * .3 + 3 * .14 * h + 12], outline=(170, 30, 30), width=3)
    return age(im, 320, .3, .35, .3, 3)


def d_breakers(w, h):
    """A row of fuse carriers with hand-written circuit labels."""
    im = Image.new('RGB', (w, h), (48, 48, 46)); d = ImageDraw.Draw(im)
    names = ('BAY 1', 'BAY 2', 'BOOTH', 'CAMS', 'FRZR', 'SIGN')
    for i, s in enumerate(names):
        x0 = w * (i + .08) / len(names); x1 = w * (i + .92) / len(names)
        d.rectangle([x0, h * .08, x1, h * .7], fill=(214, 206, 180), outline=(15, 15, 15), width=2)
        d.rectangle([x0 + 6, h * .2, x1 - 6, h * .46], fill=(26, 26, 26))
        d.rectangle([x0 + 9, h * (.22 if i != 3 else .34), x1 - 9, h * (.33 if i != 3 else .44)], fill=(170, 40, 30) if i == 3 else (200, 200, 195))
        d.rectangle([x0, h * .76, x1, h * .96], fill=(226, 222, 200))
        text(d, ((x0 + x1) / 2, h * .86), s, 'hand', int(h * .11), (30, 30, 120))
    return age(im, 330, .4, .4, .3, 12)


DECALS = [  # name, width, height, draw
    ('hazard', 2048, 192, d_hazard),
    ('battery', 512, 256, d_battery),
    ('dial', 384, 384, d_dial),
    ('gauge', 256, 256, d_gauge),
    ('exit', 512, 256, d_exit),
    ('screen_0', 320, 240, lambda w, h: d_screen(w, h, 0, 'CAM 1  LOADING')),
    ('screen_1', 320, 240, lambda w, h: d_screen(w, h, 1, 'CAM 4  BAY')),
    ('screen_2', 320, 240, lambda w, h: d_screen(w, h, 2, 'CAM 7')),
    ('danger', 320, 200, d_danger),
    ('extinguisher', 256, 320, d_extinguisher),
    ('flammable', 256, 256, d_flammable),
    ('wetfloor', 256, 400, d_wetfloor),
    ('logbook', 384, 256, lambda w, h: d_paper(w, h, 0)),
    ('form', 224, 300, lambda w, h: d_paper(w, h, 1)),
    ('memo', 224, 300, lambda w, h: d_paper(w, h, 2)),
    ('keyboard', 512, 192, d_keyboard),
    ('card', 128, 256, d_card),
    ('badge', 128, 128, d_badge),
    ('patch', 128, 128, d_patch),
    ('mug', 256, 128, d_mug),
    ('radio', 128, 224, d_radio),
    ('shipping', 384, 224, d_shipping),
    ('calendar', 224, 256, d_calendar),
    ('breakers', 448, 160, d_breakers),
    ('plate_crank', 320, 128, lambda w, h: plate(w, h, ['EMERGENCY DYNAMO', 'TURN HANDLE CLOCKWISE', 'DO NOT STOP'], seed=340)),
    ('plate_door', 256, 112, lambda w, h: plate(w, h, ['SHUTTER', 'PUSH TO CLOSE'], (200, 40, 30), (240, 230, 210), 350)),
    ('plate_punch', 256, 96, lambda w, h: plate(w, h, ['PUNCH EVERY ROUND', 'NO CARD  NO PAY'], seed=360)),
    ('plate_charge', 320, 80, lambda w, h: plate(w, h, ['TORCH CHARGING  -  RETURN AFTER USE'], (30, 60, 110), (235, 230, 215), 370, [22])),
    ('plate_fan', 192, 96, lambda w, h: plate(w, h, ['AIRFLO 900', 'KEEP HANDS CLEAR'], (190, 150, 30), (20, 20, 20), 380)),
    ('plate_map', 448, 72, lambda w, h: plate(w, h, ['MASCOT DEPOT  -  FLOOR PLAN  -  YOU ARE HERE'], (40, 44, 48), (220, 214, 190), 390, [20])),
    ('note', 128, 128, lambda w, h: age((lambda im: (ImageDraw.Draw(im).text((w / 2, h / 2), 'CHECK\nBAY 4\n!!', font=font('hand', 24), fill=(40, 40, 120), anchor='mm', align='center'), im)[1])(Image.new('RGB', (w, h), (238, 220, 90))), 400, .25, .2, .3, 2)),
]


# ---------------------------------------------------------------- cutouts (RGBA)

def c_stencil(s, size, w, h, seed, ink=(.9, .88, .8)):
    a = stencil_mask(s, size, w, h, seed)
    rgb = np.ones((h, w, 3)) * col(*ink) * (.8 + .2 * fnoise(512, 1.2, seed + 5)[:h, :w])[..., None]
    return np.dstack([rgb, a])


def c_claws(w, h, seed, n=4):
    """Parallel gouges: bright torn metal down the middle, a dark burr either side."""
    im = Image.new('L', (w, h), 0); core = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(im); dc = ImageDraw.Draw(core)
    r = np.random.default_rng(seed)
    for i in range(n):
        y0 = h * (.14 + .72 * i / max(1, n - 1)) + r.uniform(-4, 4)
        x0, x1 = w * r.uniform(.03, .14), w * r.uniform(.84, .97)
        pts = []
        for t in np.linspace(0, 1, 40):
            pts.append((x0 + (x1 - x0) * t, y0 + math.sin(t * 2.6 + i) * h * .05 + (t - .5) * h * .12))
        for k in range(len(pts) - 1):
            t = k / (len(pts) - 1); wd = max(1, int((math.sin(t * math.pi) ** .6) * r.uniform(7, 11)))
            d.line([pts[k], pts[k + 1]], fill=255, width=wd + 4); dc.line([pts[k], pts[k + 1]], fill=255, width=max(1, wd - 2))
    a = np.asarray(im, float) / 255; c = np.asarray(core.filter(ImageFilter.GaussianBlur(.8)), float) / 255
    a = a * step(fnoise(512, 1.4, seed + 1)[:h, :w], .12, .3)
    rgb = mix(col(.1, .07, .06), col(.82, .82, .84), c[..., None]) * (.8 + .2 * fnoise(512, .8, seed + 2)[:h, :w])[..., None]
    return np.dstack([rgb, a])


def c_print(w, h):
    """Flexo print on the cardboard box: arrows, a wine glass, a line of text."""
    im = Image.new('L', (w, h), 0); d = ImageDraw.Draw(im)
    for cx in (w * .14, w * .3):
        d.polygon([(cx, h * .1), (cx + w * .06, h * .4), (cx + w * .02, h * .4), (cx + w * .02, h * .74), (cx - w * .02, h * .74), (cx - w * .02, h * .4), (cx - w * .06, h * .4)], fill=255)
    d.rectangle([w * .07, h * .78, w * .37, h * .84], fill=255)
    gx = w * .52
    d.polygon([(gx - w * .06, h * .1), (gx + w * .06, h * .1), (gx + w * .012, h * .42), (gx + w * .012, h * .72), (gx + w * .05, h * .78), (gx - w * .05, h * .78), (gx - w * .012, h * .72), (gx - w * .012, h * .42)], fill=255)
    text(d, (w * .8, h * .3), 'FRAGILE', 'bold', int(h * .2), 255)
    text(d, (w * .8, h * .58), 'PARTY SUPPLIES', 'cond', int(h * .12), 255)
    text(d, (w * .8, h * .76), 'BALLOONS  HATS  CANDLES', 'cond', int(h * .075), 255)
    a = np.asarray(im, float) / 255 * step(fnoise(512, 1.4, 500)[:h, :w], .1, .3)
    return np.dstack([np.ones((h, w, 3)) * col(.3, .1, .08), a])


def c_handprint(w, h):
    """A greasy four-fingered smear, far too big, for the shutter."""
    im = Image.new('L', (w, h), 0); d = ImageDraw.Draw(im)
    d.ellipse([w * .25, h * .5, w * .75, h * .95], fill=255)
    for i, (x, l) in enumerate(((.2, .5), (.4, .62), (.6, .6), (.8, .46))):
        d.line([w * (.3 + i * .13), h * .6, w * x, h * (.55 - l * .9)], fill=255, width=int(w * .13))
    a = np.asarray(im.filter(ImageFilter.GaussianBlur(3)), float) / 255
    a = a * step(fnoise(512, 1.6, 510, (1, 4))[:h, :w], .3, .55)
    return np.dstack([np.ones((h, w, 3)) * col(.07, .06, .05), a])


CUTOUTS = [
    ('st_fragile', 384, 96, lambda w, h: c_stencil('FRAGILE', 78, w, h, 520, (.06, .05, .05))),
    ('st_depot', 448, 80, lambda w, h: c_stencil('MASCOT DEPOT', 62, w, h, 530, (.06, .05, .05))),
    ('st_up', 384, 80, lambda w, h: c_stencil('THIS WAY UP', 62, w, h, 540, (.6, .06, .05))),
    ('st_oil', 320, 112, lambda w, h: c_stencil('OIL 55', 92, w, h, 550, (.92, .9, .82))),
    ('st_booth', 448, 144, lambda w, h: c_stencil('BOOTH', 124, w, h, 560, (.9, .86, .7))),
    ('st_keep', 448, 64, lambda w, h: c_stencil('KEEP SHUT AFTER DARK', 44, w, h, 570, (.9, .86, .7))),
    ('st_12', 128, 96, lambda w, h: c_stencil('12', 78, w, h, 580, (.9, .88, .8))),
    ('st_13', 128, 96, lambda w, h: c_stencil('13', 78, w, h, 590, (.9, .88, .8))),
    ('claws_a', 512, 224, lambda w, h: c_claws(w, h, 600, 4)),
    ('claws_b', 448, 160, lambda w, h: c_claws(w, h, 610, 3)),
    ('print', 512, 192, c_print),
    ('hand', 256, 288, c_handprint),
]


# ---------------------------------------------------------------- packing

def pack(items, size, rgba):
    """Shelf-pack the drawings into one square sheet. Returns the sheet and
    {name: [u0, v0, u1, v1]} with V measured up from the bottom, inset by half
    a pixel so neighbours do not bleed in."""
    sheet = np.zeros((size, size, 4 if rgba else 3))
    x = y = shelf = 0; rects = {}
    for name, w, h, fn in sorted(items, key=lambda i: -i[2]):
        if x + w > size: x = 0; y += shelf + 4; shelf = 0
        assert y + h <= size, f'{name} does not fit the {size} px sheet'
        art = fn(w, h)
        a = art if isinstance(art, np.ndarray) else np.asarray(art.convert('RGB'), float) / 255
        sheet[y:y + h, x:x + w] = a
        rects[name] = [(x + .5) / size, 1 - (y + h - .5) / size, (x + w - .5) / size, 1 - (y + .5) / size]
        x += w + 4; shelf = max(shelf, h)
    return sheet, rects


def main():
    os.makedirs(OUT, exist_ok=True)
    only = sys.argv[1:]
    for f in (tex_paint, tex_steel, tex_rust, tex_wood, tex_cardboard, tex_fabric, tex_plastic, tex_rubber, tex_bag, tex_knurl):
        if not only or f.__name__[4:] in only: f()
    if only and 'atlas' not in only: return
    dec, r1 = pack(DECALS, 2048, False)
    save('decals', dec)
    cut, r2 = pack(CUTOUTS, 1024, True)
    Image.fromarray((np.clip(cut, 0, 1) * 255 + .5).astype(np.uint8), 'RGBA').save(os.path.join(OUT, 'cutouts.png'))
    with open(os.path.join(OUT, 'atlas.json'), 'w') as f: json.dump({'decals': r1, 'cutouts': r2}, f, indent=1)
    print('wrote', OUT)


if __name__ == '__main__':
    main()
