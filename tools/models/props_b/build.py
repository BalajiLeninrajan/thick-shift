# Builds the room prop kit: public/models/props_b.glb and props_b.json.
#
#   tools/models/bl tools/models/props_b/build.py
#   tools/models/bl tools/models/props_b/build.py -- --only fridge,trunk --preview
#
# --only builds a subset to tools/models/previews/props_b_wip.glb and leaves
# the real files alone. --preview renders each built prop (see --views,
# --light, --res). The props themselves are in stage.py, arcade.py, party.py,
# kitchen.py and snack.py; the primitives are in kit.py and the two shared
# textures are painted in atlas.py.
import argparse, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.dirname(HERE))
import bpy, traceback
import numpy as np
import common, kit
from kit import Prop, BUILDERS
import stage, arcade, party, kitchen, snack   # noqa: F401  (they register their props on import)

ap = argparse.ArgumentParser()
ap.add_argument('--only', default='')
ap.add_argument('--preview', action='store_true')
ap.add_argument('--views', default='three_quarter')
ap.add_argument('--light', default='flashlight')
ap.add_argument('--res', type=int, default=512)
ap.add_argument('--focus', default='')   # x,y,z,radius in the prop's own Blender axes
ap.add_argument('--sheet', action='store_true')   # also tile the previews nine to a sheet, for a quick look over the kit
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
only = [s for s in args.only.split(',') if s]
OUT = 'props_b' if not only else os.path.relpath(os.path.join(common.PREVIEWS, 'props_b_wip'), common.MODELS)

SPACING, COLS = 4.5, 7   # the preview grid; the game ignores where each prop sits


def bake_ao(objs):
    """Cycles ambient occlusion into the vertex colours, so shelves are dark
    inside and things sit on what they rest on. Short range, because glass
    cases would otherwise black out what is in them."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 24
    world = bpy.data.worlds.new('ao'); sc.world = world
    world.light_settings.distance = .35
    for ob in objs:
        me = ob.data
        ao = me.color_attributes.new('ao', 'FLOAT_COLOR', 'CORNER')
        me.color_attributes.active_color = ao
        bpy.ops.object.select_all(action='DESELECT')
        ob.select_set(True); bpy.context.view_layer.objects.active = ob
        bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
        n = len(me.loops)
        a, c = np.zeros(n * 4, np.float32), np.zeros(n * 4, np.float32)
        ao.data.foreach_get('color', a); me.color_attributes['Color'].data.foreach_get('color', c)
        a, c = a.reshape(n, 4), c.reshape(n, 4)
        # glow faces stay as painted
        glow = np.array([m.name in kit.GLOW for m in me.materials])
        pm = np.zeros(len(me.polygons), np.int32); me.polygons.foreach_get('material_index', pm)
        lt = np.zeros(len(me.polygons), np.int32); me.polygons.foreach_get('loop_total', lt)
        keep = np.repeat(glow[pm], lt)
        k = np.where(keep, 1, .22 + .78 * a[:, 0] ** 1.3)
        c[:, :3] *= k[:, None]
        me.color_attributes['Color'].data.foreach_set('color', c.ravel())
        me.color_attributes.remove(me.color_attributes['ao'])
        me.color_attributes.active_color = me.color_attributes['Color']


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
tops, everything = [], []
for i, p in enumerate(props):
    ob = p.finish(mats)
    tops.append(ob)
    everything += [ob, *ob.children_recursive]
bake_ao(everything)

meta = {}
bpy.context.view_layer.update()
for i, p in enumerate(props):
    lo, hi = common.bounds([p.obj, *p.obj.children_recursive])
    meta[p.name] = dict(size=[round(hi.x - lo.x, 2), round(hi.z - lo.z, 2), round(hi.y - lo.y, 2)], mount=p.mount,
                        children=[k.name for k in p.kids], notes=p.notes)
    p.obj.location.x += (i % COLS) * SPACING
    p.obj.location.y += (i // COLS) * SPACING
common.export_glb(OUT, objs=tops)
if not only:
    with open(os.path.join(common.MODELS, 'props_b.json'), 'w') as f:
        json.dump(dict(props=meta), f, indent=1)

info = common.report(OUT)
dg = bpy.context.evaluated_depsgraph_get()
for o in sorted(bpy.context.scene.objects, key=lambda o: o.name):
    if o.parent is None:
        print(f'[tris] {o.name:16s} {common.tris([o, *o.children_recursive]):6d}  size {meta[o.name]["size"]}')

if args.preview:
    # common.preview frames the whole file; show it one prop at a time instead
    load = common.load_glb
    shots = {}
    for p in props:
        def one(path, name=p.name):
            objs = load(path)
            top = bpy.data.objects[name]
            keepers = {top, *top.children_recursive}
            for o in objs:
                if o not in keepers: bpy.data.objects.remove(o)
            top.location = (0, 0, 0)
            bpy.context.view_layer.update()
            return list(keepers)
        common.load_glb = one
        focus = None
        if args.focus:
            v = [float(x) for x in args.focus.split(',')]
            focus = (tuple(v[:3]), v[3])
        for v, path in zip(args.views.split(','), common.preview(OUT, views=args.views.split(','), res=args.res, samples=20, light=args.light, focus=focus,
                                                                 tag='_' + p.name + ('_s' if args.light == 'studio' else ''))):
            shots.setdefault(v, []).append(path)
    common.load_glb = load
    if args.sheet:
        cell, k = 448, 3
        for v in args.views.split(','):
            for s in range(0, len(shots[v]), k * k):
                sheet = np.zeros((cell * k, cell * k, 4), np.float32)
                for j, path in enumerate(shots[v][s:s + k * k]):
                    img = bpy.data.images.load(path); img.scale(cell, cell)
                    px = np.zeros(cell * cell * 4, np.float32); img.pixels.foreach_get(px)
                    r, c = k - 1 - j // k, j % k
                    sheet[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell] = px.reshape(cell, cell, 4)
                out = bpy.data.images.new('sheet', cell * k, cell * k)
                out.pixels.foreach_set(sheet.ravel())
                out.filepath_raw = os.path.join(common.PREVIEWS, f'props_b_sheet_{v}_{args.light}_{s // (k * k)}.png')
                out.file_format = 'PNG'; out.save()
                print('[sheet]', out.filepath_raw)

if failed: sys.exit('[failed] ' + ', '.join(failed))
