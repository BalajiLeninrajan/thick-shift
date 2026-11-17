# Procedural materials for the rhino, and the bake that turns them into the
# three textures the GLB carries (colour with AO folded in, normal, roughness).
#
# Shader nodes do not survive glTF export, so every material here exists only
# long enough to be baked. They read the vertex attribute 'rest' (see
# sculpt.stamp_rest) instead of the real position.
#
# The small expression layer (V, math, noise, mix, ...) is there so a
# material reads as arithmetic and not as forty lines of node wiring.
import bpy, math
import numpy as np

NT = None   # node tree of the material being built


def lin(hexcol):
    """'#rrggbb' -> linear RGBA."""
    h = hexcol.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in c) + (1.0,)


def blend(a, b, t):
    """Mix two '#rrggbb' colours in sRGB, like the 2D art does."""
    pa, pb = [[int(h.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4)] for h in (a, b)]
    return '#' + ''.join(f'{round(x + (y - x) * t):02x}' for x, y in zip(pa, pb))


class V:
    """A node output, with arithmetic."""

    def __init__(self, sock): self.s = sock
    def __add__(self, o): return math_('ADD', self, o)
    def __radd__(self, o): return math_('ADD', o, self)
    def __sub__(self, o): return math_('SUBTRACT', self, o)
    def __rsub__(self, o): return math_('SUBTRACT', o, self)
    def __mul__(self, o): return math_('MULTIPLY', self, o)
    def __rmul__(self, o): return math_('MULTIPLY', o, self)
    def __truediv__(self, o): return math_('DIVIDE', self, o)
    def __neg__(self): return math_('MULTIPLY', self, -1.0)


def _set(inp, v):
    if isinstance(v, V): NT.links.new(v.s, inp)
    else: inp.default_value = v


def node(kind, **props):
    n = NT.nodes.new(kind)
    for k, v in props.items(): setattr(n, k, v)
    return n


def math_(op, a, b=None, c=None, clamp=False):
    n = node('ShaderNodeMath', operation=op, use_clamp=clamp)
    _set(n.inputs[0], a)
    if b is not None: _set(n.inputs[1], b)
    if c is not None: _set(n.inputs[2], c)
    return V(n.outputs[0])


def absf(a): return math_('ABSOLUTE', a)
def maxf(a, b): return math_('MAXIMUM', a, b)
def minf(a, b): return math_('MINIMUM', a, b)
def sinf(a): return math_('SINE', a)
def sat(a): return math_('ADD', a, 0.0, clamp=True)


def smooth(x, a, b):
    """0 at a, 1 at b, smoothstep between. a may be greater than b."""
    n = node('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP')
    _set(n.inputs[0], x); n.inputs[1].default_value = a; n.inputs[2].default_value = b
    n.inputs[3].default_value = 0; n.inputs[4].default_value = 1
    return V(n.outputs[0])


def P():
    return V(node('ShaderNodeAttribute', attribute_name='rest').outputs['Vector'])


def xyz(v):
    n = node('ShaderNodeSeparateXYZ'); _set(n.inputs[0], v)
    return V(n.outputs[0]), V(n.outputs[1]), V(n.outputs[2])


def vec(x, y, z):
    n = node('ShaderNodeCombineXYZ')
    for i, c in enumerate((x, y, z)): _set(n.inputs[i], c)
    return V(n.outputs[0])


def vop(op, a, b):
    n = node('ShaderNodeVectorMath', operation=op)
    _set(n.inputs[0], a); _set(n.inputs[1], b)
    return n


def vscale(v, s): return V(vop('MULTIPLY', v, tuple(s)).outputs[0])
def vadd(v, t): return V(vop('ADD', v, t if isinstance(t, V) else tuple(t)).outputs[0])


def length(v):
    n = node('ShaderNodeVectorMath', operation='LENGTH'); _set(n.inputs[0], v)
    return V(n.outputs['Value'])


def noise(v, scale, detail=2.0, rough=.5, off=0.0):
    """Fractal noise, about 0..1."""
    if off: v = vadd(v, (off, off * 1.7, off * .31))
    n = node('ShaderNodeTexNoise')
    _set(n.inputs['Vector'], v)
    n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail; n.inputs['Roughness'].default_value = rough
    return V(n.outputs[0])


def voronoi(v, scale, off=0.0):
    """Distance to the nearest cell centre: 0 in the middle of a clump."""
    if off: v = vadd(v, (off, off * 1.7, off * .31))
    n = node('ShaderNodeTexVoronoi')
    _set(n.inputs['Vector'], v); n.inputs['Scale'].default_value = scale
    return V(n.outputs['Distance'])


def mix(f, a, b):
    """Colour mix. a, b: V or '#hex' or RGBA tuple."""
    n = node('ShaderNodeMix', data_type='RGBA')
    _set(n.inputs[0], f)
    for i, c in ((6, a), (7, b)): _set(n.inputs[i], lin(c) if isinstance(c, str) else c)
    return V(n.outputs[2])


def tint(c, k):
    """Multiply a colour by a scalar (V or float)."""
    n = node('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY')
    n.inputs[0].default_value = 1.0
    _set(n.inputs[6], lin(c) if isinstance(c, str) else c)
    if isinstance(k, V):
        g = node('ShaderNodeCombineColor')
        for i in range(3): _set(g.inputs[i], k)
        NT.links.new(g.outputs[0], n.inputs[7])
    else: n.inputs[7].default_value = (k, k, k, 1)
    return V(n.outputs[2])


def region(p, centre, radii, wobble=None, amount=0.0):
    """Distance in an ellipsoid's own units: below 1 is inside."""
    d = length(vscale(vadd(p, tuple(-c for c in centre)), tuple(1 / r for r in radii)))
    return d + (wobble - .5) * amount if wobble is not None else d


def begin(name):
    global NT
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    NT = m.node_tree
    NT.nodes.clear()
    return m


def finish(m, color, rough, height=None, ao=.75):
    """Close the material: a Principled surface for the normal and roughness
    bakes, and an emission of colour times AO for the colour bake. ao is how
    much of the occlusion goes into the colour."""
    bsdf = node('ShaderNodeBsdfPrincipled'); bsdf.name = 'BSDF'
    _set(bsdf.inputs['Base Color'], lin(color) if isinstance(color, str) else color)
    _set(bsdf.inputs['Roughness'], rough)
    if height is not None:
        b = node('ShaderNodeBump'); b.inputs['Strength'].default_value = 1.0; b.inputs['Distance'].default_value = 1.0
        _set(b.inputs['Height'], height)
        NT.links.new(b.outputs[0], bsdf.inputs['Normal'])
    occ = node('ShaderNodeAmbientOcclusion', samples=8, only_local=True)
    occ.inputs['Distance'].default_value = .12
    shade = math_('ADD', math_('MULTIPLY', math_('POWER', V(occ.outputs['AO']), 1.5), ao), 1 - ao)
    em = node('ShaderNodeEmission'); em.name = 'EMIT'
    _set(em.inputs[0], tint(color, shade))
    out = node('ShaderNodeOutputMaterial'); out.name = 'OUT'
    NT.links.new(bsdf.outputs[0], out.inputs[0])
    return m


# ---------- palette ----------

HIDE, BELLY = '#7d8299', '#a6adc8'
INK, SURFACE0, SURFACE1 = '#08080e', '#313244', '#45475a'
CREAM, PEACH = '#f5e0dc', '#fab387'
DRIED, WETBLOOD = '#3a0b10', '#74101a'
WORM = blend('#f2cdcd', SURFACE1, .45)   # the 2D art's worm skin
SICK = blend('#f9e2af', '#585b70', .55)


# ---------- materials ----------

def _blood(p, mid, big, stains, off=0.0):
    """Mask for soaked-in blood: blotches with ragged edges, and runs below them."""
    x, y, z = xyz(p)
    runs = smooth(noise(vscale(p, (48, 48, 1.1)), 1, 2, .5, off=3 + off), .6, .67)
    total = None
    for (c, r) in stains:
        d = region(p, c, (r, r, r), mid, .9) + (big - .5) * .5
        blot = smooth(d, 1.0, .7)
        horiz = smooth(length(vscale(vadd(p, (-c[0], -c[1], -c[2])), (1 / r, 1 / r, 0))), 1.1, .5)
        below = smooth(z, c[2], c[2] - r * .4) * smooth(z, c[2] - r * 4.5, c[2] - r * 1.5)
        m = maxf(blot, runs * horiz * below)
        total = m if total is None else maxf(total, m)
    return total


def hide(name, stage, pale=(), blood=(), meat=(), seam_x=True, bald=None):
    """The costume's plush. stage 0: clean short pile. 1 and 2: dull, matted
    into clumps, bald where the pile has worn off the backing cloth.
    pale: [(centre, radii)] ellipsoids that are belly-coloured, with a sewn edge.
    blood: [(centre, radius)] stains. meat: [(centre, radii)] raw openings."""
    m = begin(name)
    p = P()
    x, y, z = xyz(p)
    big, mid = noise(p, 2.5, 3), noise(p, 13, 4)
    streak = noise(vscale(p, (70, 70, 9)), 1, 2)          # the lay of the pile, running down
    fine = noise(p, 260, 2, .7)
    grain = smooth(streak * .45 + fine * .35 + mid * .2, .32, .68)
    dull = [.02, .22, .34][stage]
    base = blend(HIDE, SURFACE0, dull)
    col = mix(grain, blend(base, INK, .42), blend(base, '#c9cee4', .22))
    height = fine * .0012 + streak * .0015
    rough = .93
    seam = None
    for (c, r) in pale:
        d = region(p, c, r, mid, .05)
        inside = smooth(d, 1.0, .97)
        pb = blend(BELLY, SURFACE0, dull)
        col = mix(inside, col, mix(grain, blend(pb, INK, .3), blend(pb, '#ffffff', .15)))
        s = 1 - smooth(absf(d - 1.0), .0, .03)
        seam = s if seam is None else maxf(seam, s)
    if seam_x:   # centre seam, front and back
        s = 1 - smooth(absf(x), .001, .007)
        seam = s if seam is None else maxf(seam, s)
    if stage == 0:
        pile = voronoi(p, 150)
        height = height + (1 - pile) * .0009
    else:
        clump = voronoi(p, [0, 42, 34][stage])
        col = tint(col, smooth(clump, .62, .2) * .45 + .55)       # dark between the clumps
        height = height + (1 - clump) * [0, .004, .0055][stage]
        grease = smooth(big, .5, .75)
        col = mix(grease * .55, col, '#23242c')
        rough = rough - grease * .25
        bare = smooth(noise(p, 4.5, 4, .55, off=7), bald or [0, .66, .61][stage], (bald or [0, .66, .61][stage]) + .04)
        wx, wy, wz = xyz(vscale(p, (700, 700, 700)))
        weave = smooth(sinf(wx) * sinf(wz) + sinf(wy) * .5, -.3, .3)
        col = mix(bare, col, mix(weave, '#2b2826', '#5d554c'))
        height = height - bare * .004 + bare * weave * .0006
    if seam is not None:
        col = tint(col, 1 - seam * .55)
        height = height - seam * .003
    grime = smooth(z, [.5, .9, 1.0][stage], 0.0) * (mid * .6 + .4) * [.35, .7, .8][stage]
    col = mix(grime, col, '#17140f')
    if blood:
        b = _blood(p, mid, big, blood)
        wet = stage == 2
        col = mix(b, col, mix(fine, DRIED, WETBLOOD if wet else '#4f1016'))
        rough = rough - b * (.62 if wet else .35)
        height = height - b * .0012
    for (c, r) in meat:
        d = region(p, c, r, mid, .3)
        halo = smooth(d, 1.7, 1.0)
        col = mix(halo, col, DRIED)
        rough = rough - halo * .5
        raw = smooth(d, 1.0, .86)
        flesh = mix(noise(p, 30, 3), '#22050a', '#8a1f24')
        flesh = mix(smooth(noise(vscale(p, (20, 90, 20)), 1, 2), .6, .7), flesh, '#b9987f')   # strings of fat
        col = mix(raw, col, flesh)
        height = height + raw * noise(p, 70, 2) * .006
        rough = rough - raw * .25
    return finish(m, col, sat(rough), height, ao=.8)


def flat(name, c1, c2, scale=40, rough=.5, bump=0.0, bscale=None, ao=.6, grime=0.0, streak=None):
    """A two-tone noisy surface for small things: thread, nails, zip, plastic."""
    m = begin(name)
    p = P()
    n = noise(vscale(p, streak) if streak else p, scale, 3)
    col = mix(smooth(n, .3, .7), c1, c2)
    if grime: col = mix(smooth(noise(p, 9, 3, off=4), .45, .7) * grime, col, '#14110d')
    h = noise(p, bscale or scale * 2, 2) * bump if bump else None
    return finish(m, col, rough, h, ao=ao)


def plastic(name, colour, stage, yellow='#b9a36b'):
    """Hard glossy plastic for the googly eyes: scratched, and yellowed later."""
    m = begin(name)
    p = P()
    scratch = smooth(absf(noise(vscale(p, (300, 40, 300)), 1, 2) - .5), .012, .0) + smooth(absf(noise(vscale(p, (40, 300, 60)), 1, 2, off=5) - .5), .01, .0)
    age = smooth(noise(p, 14, 3, off=2), .35, .75) * [.12, .6, .8][stage]
    col = mix(age, colour, yellow)
    col = tint(col, 1 - sat(scratch) * .35)
    return finish(m, col, sat(.12 + scratch * .5 + age * .25), ao=.35)


def horn(name, stage):
    """Vinyl horn. rest z runs along the horn from its base. Clean cream at
    stage 0; later it is bone-coloured, ringed, and split by dark cracks."""
    m = begin(name)
    p = P()
    x, y, z = xyz(p)
    n = noise(p, 22, 3)
    if stage == 0:
        col = mix(smooth(n, .3, .7), CREAM, blend(CREAM, '#c9a98f', .35))
        col = mix(smooth(z, .07, .0) * .5, col, '#8f7f77')      # scuffed where it meets the plush
        return finish(m, col, .38 + n * .1, noise(p, 120, 2) * .0006, ao=.6)
    rings = sinf(z * 170 + n * 5)
    col = mix(smooth(n + rings * .12, .3, .75), blend(CREAM, '#8d7446', .55), blend(CREAM, '#d8c59a', .5))
    col = mix(smooth(z, .16, .0) * .8, col, '#3a2a1c')
    crack = smooth(absf(noise(vscale(p, (26, 26, 2.2)), 1, 3, .6, off=1) - .5), .02 if stage == 1 else .028, .0)
    crack = maxf(crack, smooth(absf(noise(vscale(p, (9, 9, 30)), 1, 2, off=9) - .5), .008, .0) * .7)
    col = mix(crack, col, '#0c0706')
    if stage == 2: col = mix(smooth(noise(p, 7, 3, off=6), .5, .62) * .8, col, DRIED)
    h = rings * .0012 - crack * .005 + noise(p, 90, 2) * .0015
    return finish(m, col, sat(.5 + n * .2 - crack * .1), h, ao=.7)


def terry(name, stage):
    """The orange sweatband: looped towelling in ribs, sweat-dark and grimy later."""
    m = begin(name)
    p = P()
    x, y, z = xyz(p)
    loops = voronoi(p, 330)
    rib = sinf(z * 330) * .5 + .5
    base = blend(PEACH, SURFACE1, [.0, .3, .42][stage])
    col = mix(smooth(loops, .1, .5), blend(base, '#ffffff', .12), blend(base, INK, .35))
    col = tint(col, rib * .25 + .75)
    if stage:
        stain = smooth(noise(p, 8, 4, off=3), .42, .6)
        col = mix(stain * .75, col, '#2b1b14' if stage == 1 else DRIED)
    return finish(m, col, .95, (1 - loops) * .0016 + rib * .0012, ao=.7)


def eyeball(name):
    """Stage 2 eye: a wet black ball with a red haze of burst vessels."""
    m = begin(name)
    p = P()
    col = mix(smooth(noise(p, 60, 3), .55, .8) * .5, '#050305', '#3a0a10')
    return finish(m, col, .06, ao=.3)


def meat(name, wet=.16):
    """Raw flesh for wound rims, eye sockets and torn edges."""
    m = begin(name)
    p = P()
    n = noise(p, 34, 3)
    col = mix(smooth(n, .3, .7), '#2a060b', '#8f2026')
    col = mix(smooth(noise(vscale(p, (25, 25, 110)), 1, 2, off=2), .6, .72), col, '#c2a58c')
    col = mix(smooth(noise(p, 8, 2, off=5), .5, .7) * .7, col, '#12030a')
    return finish(m, col, sat(wet + n * .25), noise(p, 80, 3) * .005 + n * .003, ao=.85)


def worm_skin(name, hue, seed):
    """One worm segment. rest is the segment straightened out: z runs along
    the body, so rings and wrinkles can be drawn around it. hue 0..1 slides
    the base colour between raw red and a sick yellow; no two are alike."""
    m = begin(name)
    p = P()
    x, y, z = xyz(p)
    mid = noise(p, 16, 4, off=seed)
    big = noise(p, 5, 3, off=seed * 2.3)
    base = blend(blend(WORM, '#b5475a', .45), blend(WORM, SICK, .6), hue)
    col = mix(smooth(mid, .25, .75), blend(base, '#3a1420', .45), blend(base, '#f3d9d2', .3))
    wrinkle = sinf(z * 190 + mid * 9)
    col = tint(col, wrinkle * .1 + .9)
    under = smooth(noise(vscale(p, (4, 4, 14)), 1, 2, off=seed + 4), .5, .7)
    col = mix(under * .5, col, '#d9b7a8')                 # pale stretched patches
    vein = smooth(absf(noise(p, 7, 3, .6, off=seed + 1) - .5), .022, .0)
    vein2 = smooth(absf(noise(p, 19, 2, .5, off=seed + 2) - .5), .018, .0)
    col = mix(vein * .9, col, '#3b0d24')
    col = mix(vein2 * .55, col, '#3d2a55')
    bruise = smooth(big, .58, .72)
    col = mix(bruise * .7, col, '#451430')
    spots = smooth(voronoi(p, 55, off=seed), .12, .06) * smooth(noise(p, 6, 2, off=seed + 8), .5, .6)
    col = mix(spots, col, '#1a0a10')                      # pores
    slick = smooth(noise(p, 9, 3, off=seed + 5), .4, .65)
    rough = sat(.34 - slick * .26 + mid * .1)
    h = wrinkle * .0025 + vein * .003 + vein2 * .0012 + noise(p, 60, 3) * .003 - spots * .002
    return finish(m, col, rough, h, ao=.9)


def boil(name):
    """A boil on the worm: a yellow head in a dark, angry ring. rest is the
    boil's own space with the head toward +z."""
    m = begin(name)
    p = P()
    x, y, z = xyz(p)
    col = mix(smooth(z, .2, .85), '#4a1226', blend(SICK, '#f6e7a8', .5))
    col = mix(smooth(z, .0, .3) * smooth(z, .6, .3), col, '#a3323f')
    col = mix(smooth(noise(p, 6, 2), .55, .7) * .5, col, '#2a0914')
    return finish(m, col, sat(.1 + noise(p, 4, 2) * .2), noise(p, 9, 2) * .002, ao=.8)


def mouth(name):
    """The worm's head. rest: the mouth faces -y, the lip plane is y = 0, the
    throat runs toward +y. Outside it is worm skin gone red; the lips are raw
    and wrinkled; inside, wet folds spiral down into the dark."""
    m = begin(name)
    p = P()
    x, y, z = xyz(p)
    r = length(vscale(p, (1, 0, 1)))
    ang = math_('ARCTAN2', z, x)
    mid = noise(p, 18, 4)
    inside = smooth(r + y * .55, .245, .2)                # 1 on the throat side of the lips
    skin = mix(smooth(mid, .25, .75), blend(WORM, '#40141f', .5), blend(WORM, '#c9566a', .5))
    vein = smooth(absf(noise(p, 9, 3, .6, off=3) - .5), .022, .0)
    skin = mix(vein * .9, skin, '#3b0d24')
    lipw = sinf(ang * 60 + mid * 6)
    lips = mix(smooth(mid, .3, .7), '#6d1f2c', '#c86a74')
    lips = tint(lips, lipw * .16 + .84)
    lipzone = smooth(y, .13, .03) * smooth(r, .2, .26)
    col = mix(lipzone, skin, lips)
    fold = sinf(ang * 22 + y * 34 + mid * 3)
    depth = smooth(y, .0, .34)
    gullet = mix(depth, mix(smooth(mid, .3, .7), '#8e2430', '#c9606a'), '#070103')
    gullet = tint(gullet, fold * .28 + .72)
    gullet = mix(smooth(noise(p, 40, 2, off=2), .6, .7) * .6, gullet, '#d7b9a6')   # flecks of something pale
    col = mix(inside, col, gullet)
    rough = sat(.3 - inside * .22 - lipzone * .12 + mid * .08)
    h = fold * inside * .004 + lipw * lipzone * .003 + vein * .003 + noise(p, 70, 3) * .003
    return finish(m, col, rough, h, ao=.9)


def tooth(name):
    """Hooked teeth. rest z runs from the root (0) to the tip (about 0.1):
    brown and bloody at the gum, yellow bone, a paler glassy point."""
    m = begin(name)
    p = P()
    x, y, z = xyz(p)
    n = noise(p, 50, 3)
    col = mix(smooth(z, .0, .09), blend('#e8d9a8', '#7a5a2a', .55), '#efe6c8')
    col = mix(smooth(z, .03, .0), col, '#3b100f')
    col = mix(smooth(absf(noise(vscale(p, (160, 160, 9)), 1, 2) - .5), .02, .0) * .6, col, '#4a3317')   # lengthwise cracks
    col = mix(smooth(n, .55, .7) * .55, col, WETBLOOD)
    return finish(m, col, sat(.22 + n * .2), noise(p, 200, 2) * .0005, ao=.7)


def slime(name):
    """Hanging mucus: there is no transparency in the game's material, so it
    is a pale, very glossy green-grey that picks up the flashlight."""
    m = begin(name)
    p = P()
    col = mix(smooth(noise(p, 30, 2), .3, .7), blend('#94e2d5', '#45475a', .5), '#cfe6d6')
    col = mix(smooth(noise(p, 12, 2, off=3), .55, .7) * .5, col, '#6d1a22')
    return finish(m, col, .05, ao=.3)


# ---------- unwrap and bake ----------

def _edit(objs, fn):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    fn()
    bpy.ops.object.mode_set(mode='OBJECT')


def unwrap(objs, boost=None):
    """One shared atlas for every part. Islands get the same texel density,
    except objects named in boost {name: factor}, which get more: the faces
    the player ends up nose to nose with."""
    for o in objs:
        _edit([o], lambda: bpy.ops.uv.smart_project(angle_limit=math.radians(72), island_margin=0.0))
    def avg():
        bpy.ops.uv.select_all(action='SELECT')
        bpy.ops.uv.average_islands_scale()
    _edit(objs, avg)
    for o in objs:
        k = (boost or {}).get(o.name)
        if not k: continue
        uv = o.data.uv_layers.active.data
        a = np.empty(len(uv) * 2); uv.foreach_get('uv', a); uv.foreach_set('uv', a * k)
    def pack():
        bpy.ops.uv.select_all(action='SELECT')
        bpy.ops.uv.pack_islands(margin=.0015, rotate=True, shape_method='AABB')
    _edit(objs, pack)


def bake(objs, key, size=2048, small=1024, samples=12):
    """Bake colour (with AO), normal and roughness for all objs into three
    images and return the one material that replaces everything."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.render.bake.margin = 6
    sc.render.bake.use_clear = False
    sc.render.bake.use_selected_to_active = False
    imgs = {}
    for kind, s, space in (('col', size, 'sRGB'), ('nrm', small, 'Non-Color'), ('orm', small, 'Non-Color')):
        im = bpy.data.images.new(f'{key}_{kind}', s, s, alpha=False)
        im.colorspace_settings.name = space
        fill = {'col': (.05, .05, .05, 1), 'nrm': (.5, .5, 1, 1), 'orm': (.8, .8, .8, 1)}[kind]
        im.pixels.foreach_set(np.tile(np.array(fill, 'f'), s * s))
        imgs[kind] = im
    mats = {s.material for o in objs for s in o.material_slots if s.material}
    for mt in mats:
        tn = mt.node_tree.nodes.new('ShaderNodeTexImage'); tn.name = 'TARGET'
        mt.node_tree.nodes.active = tn
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]

    def run(kind, pass_, emit):
        for mt in mats:
            nt = mt.node_tree
            nt.nodes['TARGET'].image = imgs[kind]
            nt.links.new(nt.nodes['EMIT' if emit else 'BSDF'].outputs[0], nt.nodes['OUT'].inputs[0])
        bpy.ops.object.bake(type=pass_)

    run('col', 'EMIT', True)
    sc.cycles.samples = 2
    run('nrm', 'NORMAL', False)
    run('orm', 'ROUGHNESS', False)
    # glTF reads roughness from green and metalness from blue of one image
    im = imgs['orm']
    px = np.empty(im.size[0] * im.size[1] * 4, 'f'); im.pixels.foreach_get(px)
    px = px.reshape(-1, 4); px[:, 1] = px[:, 0]; px[:, 0] = 1; px[:, 2] = 0
    im.pixels.foreach_set(px.ravel())
    for im in imgs.values(): im.pack()

    global NT
    m = bpy.data.materials.new(f'{key}_skin'); m.use_nodes = True
    NT = m.node_tree; NT.nodes.clear()
    bsdf = node('ShaderNodeBsdfPrincipled')
    out = node('ShaderNodeOutputMaterial'); NT.links.new(bsdf.outputs[0], out.inputs[0])
    tc = node('ShaderNodeTexImage'); tc.image = imgs['col']; NT.links.new(tc.outputs[0], bsdf.inputs['Base Color'])
    tn = node('ShaderNodeTexImage'); tn.image = imgs['nrm']
    nm = node('ShaderNodeNormalMap'); NT.links.new(tn.outputs[0], nm.inputs['Color']); NT.links.new(nm.outputs[0], bsdf.inputs['Normal'])
    to = node('ShaderNodeTexImage'); to.image = imgs['orm']
    sp = node('ShaderNodeSeparateColor'); NT.links.new(to.outputs[0], sp.inputs[0])
    NT.links.new(sp.outputs[1], bsdf.inputs['Roughness']); NT.links.new(sp.outputs[2], bsdf.inputs['Metallic'])
    for o in objs:
        o.data.materials.clear(); o.data.materials.append(m)
        o.data.polygons.foreach_set('material_index', [0] * len(o.data.polygons))
    return m


def glow(colour='#f1e6e0'):
    """The one material the game draws unlit: pinpricks in the eyes."""
    m = bpy.data.materials.get('eye_glow')
    if m: return m
    m = bpy.data.materials.new('eye_glow'); m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    c = lin(colour)
    b.inputs['Base Color'].default_value = c
    b.inputs['Emission Color'].default_value = c
    b.inputs['Emission Strength'].default_value = 1.0
    return m
