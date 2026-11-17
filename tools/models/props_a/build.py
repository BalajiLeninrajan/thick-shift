# Builds the guard and prop kit A.
#
#   tools/models/bl tools/models/props_a/build.py                 everything, with previews
#   tools/models/bl tools/models/props_a/build.py -- guard        only guard.glb
#   tools/models/bl tools/models/props_a/build.py -- props        only props_a.glb and props_a.json
#   tools/models/bl tools/models/props_a/build.py -- only=desk,crate studio noprev
#
#   tools/models/bl tools/models/props_a/build.py -- props prev=desk,crate
#
# `only=` rebuilds a few props for a quick look; it overwrites props_a.glb
# with just those, so finish with a full build. `prev=` builds everything but
# renders previews of the named props only. `studio` lights the previews
# evenly instead of by flashlight, `noprev` skips them. `pose` also renders
# the guard with every joint turned, to show that no gap opens.
# `spot=desk:0.5,-0.3,0.8,0.3,20` adds a close-up of a prop: a point in the
# prop's own Blender axes, a radius and a camera azimuth (props_a_desk_close.png).
#
# Files here: textures.py draws the textures (run automatically when ./tex is
# missing), kit.py is the mesh and material toolkit, gameplay.py, booth.py
# and service.py hold the props, guard.py the guard.
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE)); sys.path.insert(0, HERE)
from common import *
import kit

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ONLY = next((a[5:].split(',') for a in ARGS if a.startswith('only=')), None)
PREV = next((a[5:].split(',') for a in ARGS if a.startswith('prev=')), None)
SPOTS = [a[5:].split(':') for a in ARGS if a.startswith('spot=')]
LIGHT = 'studio' if 'studio' in ARGS else 'flashlight'
PREVIEW = 'noprev' not in ARGS
DO_GUARD = 'guard' in ARGS or not (ONLY or 'props' in ARGS)
DO_PROPS = 'props' in ARGS or ONLY or 'guard' not in ARGS

# Where each mount type sits in the preview layout. The game ignores it.
MOUNT_Z = {'floor': 0, 'held': 1.2, 'wall': 1.4, 'ceiling': 2.6}
CELL = 3.6


def fresh():
    reset()
    kit._images.clear()


def assemble(name, spec, at):
    """Run a prop builder and turn its meshes into the node tree the game
    expects: one top-level node, named children with their own pivots."""
    res = spec['fn']()
    mesh, kids = res if isinstance(res, tuple) else (res, {})
    ob = mesh.object(name, **spec['grime']); ob.location = at
    part(ob, name, None, pivot=at)
    objs = [ob]
    for k, (km, pivot) in kids.items():
        o = km.object(k, **spec['grime']); o.location = at
        part(o, k, ob, pivot=Vector(at) + Vector(pivot))
        objs.append(o)
    lo, hi = bounds(objs)
    return ob, lo - Vector(at), hi - Vector(at), sorted(kids)


def shots(name, spots, res=400, samples=12, pose=None):
    """Render tools/models/previews/<name>_<key>.png for each entry of
    spots = {key: (centre, radius, azimuth in degrees)}.

    common.preview() re-opens the GLB and denoises for every picture, which
    takes minutes per frame when the machine is short of memory. This calls
    it once with no views (so the scene, floor, camera and lamp are set up
    exactly as it does it), then moves the camera from spot to spot with the
    scene kept in memory and the denoiser off. `pose` = {node: (x, y, z)
    degrees} turns parts first, for checking joints."""
    preview(name, views=(), res=res, samples=samples, light=LIGHT)
    sc = bpy.context.scene
    sc.render.use_persistent_data = True
    sc.cycles.use_denoising = False
    for node, r in (pose or {}).items():
        o = bpy.data.objects[node]; o.rotation_mode = 'XYZ'; o.rotation_euler = [math.radians(v) for v in r]
    cam = sc.camera; lamp = next(o for o in sc.objects if o.type == 'LIGHT')
    for key, (c, r, az) in spots.items():
        a = math.radians(az); c = Vector(c)
        eye = Vector((c.x + math.sin(a) * r * 2.6, c.y - math.cos(a) * r * 2.6, c.z + r * .5))
        cam.location = eye; cam.rotation_euler = (c - eye).to_track_quat('-Z', 'Y').to_euler()
        if lamp.data.type == 'SPOT':
            lamp.data.energy = 180 * max(1, r) ** 2
            k = min(1, r * 2)                                         # hold the torch closer in for small things, and above the floor
            lamp.location = eye + Vector((math.cos(a), math.sin(a), 0)) * .35 * k + Vector((0, 0, -.3 * k))
            lamp.location.z = max(lamp.location.z, .05)
            lamp.rotation_euler = (c - lamp.location).to_track_quat('-Z', 'Y').to_euler()
        else:
            lamp.rotation_euler = (math.radians(50), 0, a + math.radians(30))
        sc.render.filepath = os.path.join(PREVIEWS, f'{name}_{key}.png')
        bpy.ops.render.render(write_still=True)
        print('[preview]', sc.render.filepath)


def build_props():
    import gameplay, booth, service                                    # each registers its props with kit.prop
    fresh()
    names = [n for n in kit.PROPS if not ONLY or n in ONLY]
    info = {}; spots = {}; origins = {}; roots = []
    for i, name in enumerate(names):
        spec = kit.PROPS[name]
        at = ((i % 6) * CELL, (i // 6) * CELL, MOUNT_Z[spec['mount']])
        ob, lo, hi, kids = assemble(name, spec, at)
        roots.append(ob); origins[name] = at
        size = hi - lo
        info[name] = dict(size=[round(size.x, 2), round(size.z, 2), round(size.y, 2)], mount=spec['mount'], children=kids, notes=spec['notes'])
        spots[name] = ((Vector(at) + (lo + hi) / 2), max(size.length / 2 * 1.05, .12), tris([ob] + list(ob.children)))
        print(f'[prop] {name}: {spots[name][2]} tris, size {info[name]["size"]}')
    export_glb('props_a', roots)
    rep = report('props_a')
    shown = [n for n in names if not PREV or n in PREV]
    views = {n: (*spots[n][:2], 35) for n in shown}
    for n, v in SPOTS:
        x, y, z, r, az = map(float, v.split(','))
        views[n + '_close'] = (Vector(origins[n]) + Vector((x, y, z)), r, az)
    if PREVIEW and views: shots('props_a', views)
    return info, rep


def build_guard():
    import guard
    fresh()
    root = guard.build()
    export_glb('guard', [root])
    rep = report('guard')
    if PREVIEW:
        whole = ((0, 0, .95), 1.0)
        shots('guard', {'front': (*whole, 0), 'three_quarter': (*whole, 35), 'side': (*whole, 90), 'back': (*whole, 180),
                        'face': ((0, -.1, 1.6), .2, 0), 'face_side': ((0, -.1, 1.6), .2, 60), 'hand': ((-.25, -.35, 1.12), .2, -50)})
        if 'pose' in ARGS:
            shots('guard', {'pose_front': (*whole, 20), 'pose_side': (*whole, 100), 'pose_back': (*whole, 200)},
                  pose={'head': (20, 0, 40), 'arm_L': (-40, 0, 0), 'arm_R': (35, 0, -25), 'leg_L': (-38, 0, 0), 'leg_R': (38, 0, 0)})
    return rep


def main():
    if not os.path.exists(os.path.join(kit.TEX, 'atlas.json')):
        subprocess.run(['python3', os.path.join(HERE, 'textures.py')], check=True)
    out = os.path.join(MODELS, 'props_a.json')
    data = json.load(open(out)) if os.path.exists(out) else {}
    if DO_GUARD:
        rep = build_guard()
        data['guard'] = dict(file='guard.glb', height=rep['size'][2], nodes=rep['nodes'])
    if DO_PROPS:
        info, rep = build_props()
        if not ONLY: data['props'] = info
    if not ONLY:
        with open(out, 'w') as f: json.dump(data, f, indent=1)
        print('[json]', out)


main()
