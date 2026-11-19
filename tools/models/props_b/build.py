# Builds the room prop kit: packages/game/public/models/props_b.glb and props_b.json.
#
#   tools/models/bl tools/models/props_b/build.py
#   tools/models/bl tools/models/props_b/build.py -- --only fridge,trunk --prev all
#   tools/models/bl tools/models/props_b/build.py -- --shots --prev fridge --az 0,35 --spot fridge:.3,-.4,1.2,.4,20
#
# --only builds a subset to tools/models/previews/props_b_wip.glb and leaves
# the real files alone. --prev renders the named props (or 'all') from each
# azimuth in --az, into tools/models/previews/props_b_<name>_<az>.png.
# --spot adds a close-up: a point in the prop's own Blender axes, a radius and
# an azimuth. --shots skips the build and renders the GLB already on disk.
# --sheet also tiles the renders nine to a sheet.
#
# The props themselves are in stage.py, arcade.py, party.py, kitchen.py and
# snack.py; the primitives are in kit.py and the two shared textures are
# painted in atlas.py.
import argparse, json, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.dirname(HERE))
import bpy, bmesh, traceback
import numpy as np
from mathutils import Vector
import common, kit
from kit import Prop, BUILDERS
import stage, arcade, party, kitchen, snack   # noqa: F401  (they register their props on import)

ap = argparse.ArgumentParser()
ap.add_argument('--only', default='')
ap.add_argument('--prev', default='')
ap.add_argument('--az', default='35')
ap.add_argument('--light', default='flashlight')
ap.add_argument('--res', type=int, default=400)
ap.add_argument('--samples', type=int, default=16)
ap.add_argument('--spot', action='append', default=[])
ap.add_argument('--shots', action='store_true')
ap.add_argument('--sheet', action='store_true')
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
only = [s for s in args.only.split(',') if s]
OUT = 'props_b' if not only else os.path.relpath(os.path.join(common.PREVIEWS, 'props_b_wip'), common.MODELS)
NAMES = [b[0] for b in BUILDERS]

# The contact sheet the kit is laid out on. The game ignores where each prop
# sits; hung props are raised so that everything stands on one floor for the
# previews and for the AO bake.
SPACING, COLS = 4.5, 7


def bake_ao(objs):
    """Cycles ambient occlusion into the vertex colours, so shelves are dark
    inside and things sit on what they rest on. Short range, because glass
    cases would otherwise black out what is in them."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 24
    world = bpy.data.worlds.new('ao'); sc.world = world
    world.light_settings.distance = .35
    def flip(me):
        if hasattr(me, 'flip_normals'): me.flip_normals(); return
        bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.reverse_faces(bm, faces=list(bm.faces)); bm.to_mesh(me); bm.free()

    for ob in objs:
        me = ob.data
        n = len(me.loops)
        # Baked from both sides and the lighter kept: the primitives do not all
        # wind their faces outward, and a face baked from inside a solid is black.
        sides = []
        for side in (0, 1):
            if side: flip(me)
            ao = me.color_attributes.new(f'ao{side}', 'FLOAT_COLOR', 'CORNER')
            me.color_attributes.active_color = ao
            bpy.ops.object.select_all(action='DESELECT')
            ob.select_set(True); bpy.context.view_layer.objects.active = ob
            bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
            if side: flip(me)
        for side in (0, 1):
            a = np.zeros(n * 4, np.float32); me.color_attributes[f'ao{side}'].data.foreach_get('color', a)
            sides.append(a.reshape(n, 4)); me.color_attributes.remove(me.color_attributes[f'ao{side}'])
        a = np.maximum(*sides)
        c = np.zeros(n * 4, np.float32); me.color_attributes['Color'].data.foreach_get('color', c)
        c = c.reshape(n, 4)
        print(f'[ao] {ob.name:16s} front {sides[0][:, 0].mean():.2f} back {sides[1][:, 0].mean():.2f} colour {c[:, :3].mean():.2f}')
        # glow faces stay as painted
        glow = np.array([m.name in kit.GLOW for m in me.materials])
        pm = np.zeros(len(me.polygons), np.int32); me.polygons.foreach_get('material_index', pm)
        lt = np.zeros(len(me.polygons), np.int32); me.polygons.foreach_get('loop_total', lt)
        keep = np.repeat(glow[pm], lt)
        k = np.where(keep, 1, .3 + .7 * a[:, 0] ** 1.3)
        c[:, :3] *= k[:, None]
        me.color_attributes['Color'].data.foreach_set('color', c.ravel())
        me.color_attributes.active_color = me.color_attributes['Color']


def build():
    common.reset()
    mats = kit.make_materials()
    props, failed = [], []
    for name, mount, notes, grime, fn in BUILDERS:
        if only and name not in only: continue
        p = Prop(name, mount, notes, grime=grime)
        try: fn(p)
        except Exception:   # keep going, so one run shows every broken prop
            traceback.print_exc(); failed.append(name); continue
        props.append(p)
    tops, everything, meta = [], [], {}
    for i, p in enumerate(props):
        ob = p.finish(mats)
        tops.append(ob)
        everything += [ob, *ob.children_recursive]
        bpy.context.view_layer.update()
        lo, hi = common.bounds([ob, *ob.children_recursive])
        meta[p.name] = dict(size=[round(hi.x - lo.x, 2), round(hi.z - lo.z, 2), round(hi.y - lo.y, 2)], mount=p.mount,
                            children=[k.name for k in p.kids], notes=p.notes)
        ob.location = ((i % COLS) * SPACING, (i // COLS) * SPACING, max(0, -lo.z))
    bake_ao(everything)
    common.export_glb(OUT, objs=tops)
    if not only:
        with open(os.path.join(common.MODELS, 'props_b.json'), 'w') as f:
            json.dump(dict(props=meta), f, indent=1)
    common.report(OUT)
    total = 0
    for o in sorted(bpy.context.scene.objects, key=lambda o: o.name):
        if o.parent is None:
            n = common.tris([o, *o.children_recursive]); total += n
            print(f'[tris] {o.name:16s} {n:6d}  size {meta[o.name]["size"]}')
    print(f'[tris] total {total}')
    return failed


def shots(names, azs, spots):
    """Render each named prop alone from each azimuth, plus the close-ups.

    common.preview() re-opens the GLB and denoises for every picture, which is
    slow for 36 props. This calls it once with no views (so the floor, camera
    and lamp are set up as it does it), then hides every other prop and moves
    the camera, with the scene kept in memory and the denoiser off."""
    common.preview(OUT, views=(), res=args.res, samples=args.samples, light=args.light)
    sc = bpy.context.scene
    sc.render.use_persistent_data = True
    sc.cycles.use_denoising = False
    cam = sc.camera
    lamp = next(o for o in sc.objects if o.type == 'LIGHT')
    tops = {o.name: o for o in sc.objects if o.parent is None and o.name in NAMES}
    for o in sc.objects:   # a hung prop stands on the floor here, whatever file it came from
        if o.type == 'MESH' and o.name not in tops and o.parent is None:
            o.location = (SPACING * (COLS - 1) / 2, SPACING * 2.5, 0); o.scale = (2, 2, 1)   # under the whole sheet
    for o in tops.values():
        lo, hi = common.bounds([o, *o.children_recursive])
        if lo.z < -.01: o.location.z -= lo.z
    bpy.context.view_layer.update()
    tag ='_s' if args.light == 'studio' else ''
    jobs = []
    for n in names:
        if n not in tops: continue
        lo, hi = common.bounds([tops[n], *tops[n].children_recursive])
        for az in azs: jobs.append((n, f'{n}_{az}{tag}', (lo + hi) / 2, max((hi - lo).length / 2, .25), az))
    for k, s in enumerate(spots):
        n, v = s.split(':')
        x, y, z, r, az = map(float, v.split(','))
        jobs.append((n, f'{n}_close{k}{tag}', tops[n].location + Vector((x, y, z)), r, az))
    out = {}
    for n, key, c, r, az in jobs:
        for name, o in tops.items():
            for q in (o, *o.children_recursive): q.hide_render = name != n
        a = math.radians(az)
        eye = Vector((c.x + math.sin(a) * r * 2.6, c.y - math.cos(a) * r * 2.6, c.z + r * .5))
        cam.location = eye
        cam.rotation_euler = (c - eye).to_track_quat('-Z', 'Y').to_euler()
        if lamp.data.type == 'SPOT':
            lamp.data.energy = 180 * max(1, r) ** 2
            k = min(1, r * 2)   # the torch closer in for small things, and above the floor
            lamp.location = eye + Vector((math.cos(a), math.sin(a), 0)) * .35 * k + Vector((0, 0, -.3 * k))
            lamp.location.z = max(lamp.location.z, .05)
            lamp.rotation_euler = (c - lamp.location).to_track_quat('-Z', 'Y').to_euler()
        else:
            lamp.rotation_euler = (math.radians(50), 0, a + math.radians(30))
        sc.render.filepath = os.path.join(common.PREVIEWS, f'props_b_{key}.png')
        bpy.ops.render.render(write_still=True)
        print('[preview]', sc.render.filepath)
        out.setdefault(az if not key.count('_close') else 'close', []).append(sc.render.filepath)
    return out


def sheet(paths, label):
    cell, k = 400, 3
    for s in range(0, len(paths), k * k):
        img_all = np.zeros((cell * k, cell * k, 4), np.float32)
        for j, path in enumerate(paths[s:s + k * k]):
            img = bpy.data.images.load(path); img.scale(cell, cell)
            px = np.zeros(cell * cell * 4, np.float32); img.pixels.foreach_get(px)
            r, c = k - 1 - j // k, j % k
            img_all[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell] = px.reshape(cell, cell, 4)
        out = bpy.data.images.new('sheet', cell * k, cell * k)
        out.pixels.foreach_set(img_all.ravel())
        out.filepath_raw = os.path.join(common.PREVIEWS, f'props_b_sheet_{label}_{s // (k * k)}.png')
        out.file_format = 'PNG'; out.save()
        print('[sheet]', out.filepath_raw)


failed = [] if args.shots else build()
want = [] if not args.prev else (only or NAMES) if args.prev == 'all' else args.prev.split(',')
for light in args.light.split(','):   # e.g. --light flashlight,studio for both passes
    if not (want or args.spot): break
    args.light = light
    done = shots(want, [float(a) if '.' in a else int(a) for a in args.az.split(',')], args.spot)
    if args.sheet:
        for az, paths in done.items(): sheet(paths, f'{az}_{light}')
if failed: sys.exit('[failed] ' + ', '.join(failed))
