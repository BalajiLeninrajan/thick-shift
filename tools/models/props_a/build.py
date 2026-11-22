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
import json, os, subprocess, sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE)); sys.path.insert(0, HERE)
from common import MODELS, bounds, export_glb, part, preview, report, reset, script_args, shot, tris, turned
import kit

ARGS = script_args()
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


def shots(name, spots, pose=None):
    """Render tools/models/previews/<name>_<key>.png for each entry of
    spots = {key: (centre, radius, azimuth in degrees)}, the fast way (see
    common.shot). `pose` = {node: (x, y, z) degrees} turns parts first, for
    checking joints."""
    preview(name, views=(), res=400, samples=12, light=LIGHT)
    if pose: turned(pose)(bpy.data.objects)
    for key, (c, r, az) in spots.items(): shot(f'{name}_{key}', c, r, az)


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
