# Shared by every model script in this directory. Run scripts through ./bl.
#
#   import sys, os; sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
#   from common import *
#
# The game loads GLB files from packages/game/public/models. A model is a tree of rigid,
# named parts (no armature); the game animates the parts in code. See
# README.md here for the naming contract.
import bpy, json, math, os, sys
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS = os.path.join(ROOT, 'packages', 'game', 'public', 'models')
PREVIEWS = os.path.join(ROOT, 'tools', 'models', 'previews')


def reset():
    """Empty scene, metric units."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'


def part(obj, name, parent=None, pivot=None):
    """Name a mesh object as a model part, move its origin to `pivot` (world
    space, default: where it is) without moving the mesh, apply rotation and
    scale, and parent it keeping its place."""
    obj.name = name
    if obj.data: obj.data.name = name
    bpy.context.view_layer.update()
    if obj.type == 'MESH':
        mw = obj.matrix_world.copy()
        obj.data.transform(mw)
        obj.matrix_world.identity()
        if pivot is not None:
            p = Vector(pivot)
            obj.data.transform(__import__('mathutils').Matrix.Translation(-p))
            obj.location = p
    elif pivot is not None:
        obj.location = Vector(pivot)
    bpy.context.view_layer.update()
    if parent is not None:
        w = obj.matrix_world.copy()
        obj.parent = parent
        obj.matrix_parent_inverse.identity()
        obj.matrix_world = w
        bpy.context.view_layer.update()
        obj.location = parent.matrix_world.inverted() @ w.translation
    return obj


def empty(name, parent=None, at=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.location = at
    bpy.context.view_layer.update()
    if parent is not None: part(e, name, parent)
    return e


def tris(objs=None):
    dg = bpy.context.evaluated_depsgraph_get()
    n = 0
    for o in (objs or bpy.context.scene.objects):
        if o.type != 'MESH': continue
        me = o.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        n += len(me.loop_triangles)
    return n


def export_glb(name, objs=None, draco=True, jpeg_quality=88):
    """Write packages/game/public/models/<name>.glb. `objs`: the root objects to export
    (with their children); default is the whole scene. Blender's -Y is the
    model's front; it comes out facing +Z in three.js, with +Y up."""
    os.makedirs(MODELS, exist_ok=True)
    path = os.path.join(MODELS, name + '.glb')
    bpy.ops.object.select_all(action='DESELECT')
    if objs:
        def walk(o):
            o.select_set(True)
            for ch in o.children: walk(ch)
        for o in objs: walk(o)
    kw = dict(filepath=path, export_format='GLB', use_selection=bool(objs), export_apply=True, export_yup=True,
              export_image_format='JPEG', export_jpeg_quality=jpeg_quality, export_animations=False, export_skins=False,
              export_extras=True, export_cameras=False, export_lights=False,
              export_draco_mesh_compression_enable=draco)
    if draco: kw.update(export_draco_mesh_compression_level=6, export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12, export_draco_color_quantization=10)
    bpy.ops.export_scene.gltf(**kw)
    print(f'[export] {path} {os.path.getsize(path) / 1e6:.2f} MB')
    return path


def load_glb(path):
    """Open a GLB in an empty scene. Returns the imported objects."""
    reset()
    bpy.ops.import_scene.gltf(filepath=path)
    return list(bpy.context.scene.objects)


def bounds(objs):
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for o in objs:
        if o.type != 'MESH': continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return lo, hi


def report(name):
    """Re-open packages/game/public/models/<name>.glb and print what the game will see:
    the node tree, triangle count, size and bounding box. Returns a dict."""
    path = os.path.join(MODELS, name + '.glb')
    objs = load_glb(path)
    lo, hi = bounds(objs)
    def tree(o, d=0):
        kind = o.type if o.type != 'EMPTY' else 'node'
        print('  ' * d + f'- {o.name} [{kind}] at {tuple(round(v, 2) for v in o.matrix_world.translation)}')
        for ch in sorted(o.children, key=lambda c: c.name): tree(ch, d + 1)
    for o in objs:
        if o.parent is None: tree(o)
    info = dict(file=name + '.glb', mb=round(os.path.getsize(path) / 1e6, 2), tris=tris(objs),
                size=[round(hi[i] - lo[i], 2) for i in range(3)], min=[round(v, 2) for v in lo], max=[round(v, 2) for v in hi],
                nodes=sorted(o.name for o in objs))
    print('[report]', json.dumps({k: v for k, v in info.items() if k != 'nodes'}))
    print('  (Blender axes: x = width, y = depth with the front at -y, z = height)')
    return info


# Camera stations for preview(): name -> (azimuth in degrees, 0 = from the front; height factor; distance factor)
VIEWS = {'front': (0, .55, 1), 'three_quarter': (35, .6, 1), 'side': (90, .55, 1), 'back': (180, .55, 1), 'low': (15, .12, .8)}


def preview(name, views=('front', 'three_quarter', 'side', 'back'), res=640, samples=24, light='flashlight', focus=None, tag=''):
    """Render packages/game/public/models/<name>.glb as the game will load it, to
    tools/models/previews/<name>_<view><tag>.png. Always look at the result.

    light: 'flashlight' is a dark room with one warm spot from beside the
           camera, close to what a player sees. 'studio' is even light, for
           checking shape and texture.
    focus: (x, y, z) in Blender axes and a radius, e.g. ((0, -.4, 2.1), .6),
           to frame a detail such as the face. Default frames the whole model.
    """
    path = os.path.join(MODELS, name + '.glb')
    objs = load_glb(path)
    lo, hi = bounds(objs)
    centre, radius = ((lo + hi) / 2, max((hi - lo).length / 2, .2)) if focus is None else (Vector(focus[0]), focus[1])
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 3
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('w'); sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    amb = .004 if light == 'flashlight' else .5
    if bg: bg.inputs[0].default_value = (amb, amb, amb * 1.2, 1); bg.inputs[1].default_value = 1
    # a floor to catch the light
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, min(lo.z, 0)))
    floor = bpy.context.object
    fm = bpy.data.materials.new('floor'); fm.diffuse_color = (.1, .1, .11, 1); floor.data.materials.append(fm)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.lens = 35
    ldata = bpy.data.lights.new('l', 'SPOT' if light == 'flashlight' else 'SUN')
    lamp = bpy.data.objects.new('l', ldata); sc.collection.objects.link(lamp)
    if light == 'flashlight':
        ldata.energy = 180 * max(1, radius) ** 2; ldata.spot_size = math.radians(55); ldata.spot_blend = .5; ldata.color = (1, .93, .8); ldata.shadow_soft_size = .03
    else:
        ldata.energy = 3
    os.makedirs(PREVIEWS, exist_ok=True)
    out = []
    for v in views:
        az, hf, df = VIEWS[v]
        a = math.radians(az)
        dist = radius * 2.6 * df
        eye = Vector((centre.x + math.sin(a) * dist, centre.y - math.cos(a) * dist, lo.z + (hi.z - lo.z) * hf if focus is None else centre.z))
        look = centre if focus is not None or v != 'low' else centre + Vector((0, 0, radius * .3))
        cam.location = eye
        cam.rotation_euler = (look - eye).to_track_quat('-Z', 'Y').to_euler()
        if light == 'flashlight':
            side = Vector((math.cos(a), math.sin(a), 0)) * .35
            lamp.location = eye + side + Vector((0, 0, -.3))
            lamp.rotation_euler = (look - lamp.location).to_track_quat('-Z', 'Y').to_euler()
        else:
            lamp.rotation_euler = (math.radians(50), 0, a + math.radians(30))
        sc.render.filepath = os.path.join(PREVIEWS, f'{name}_{v}{tag}.png')
        bpy.ops.render.render(write_still=True)
        out.append(sc.render.filepath)
        print('[preview]', sc.render.filepath)
    return out
