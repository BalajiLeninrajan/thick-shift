# Look at what build.py exported. Renders go to tools/models/previews.
#
#   tools/models/bl tools/models/toad/check.py -- 0                       four flashlight views
#   tools/models/bl tools/models/toad/check.py -- 2 front low --studio    chosen views, even light
#   tools/models/bl tools/models/toad/check.py -- 1 front --focus 0,-.6,1.2,.6 --tag _face
#   tools/models/bl tools/models/toad/check.py -- 2 front side --pose     joints turned, to find seams that open
import bpy, os, sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import common
from common import preview

# Every joint the game may turn, by a third of a right angle or more.
POSE = {'head': (.35, .3, 0), 'jaw': (.9, 0, 0), 'arm_L': (-.7, 0, .3), 'arm_R': (.5, 0, -.2), 'forearm_L': (-.6, 0, 0), 'forearm_R': (.5, 0, 0),
        'leg_L': (.6, 0, 0), 'leg_R': (-.6, 0, 0), 'shin_L': (.5, 0, 0), 'shin_R': (-.4, 0, 0), 'eye_L': (.3, 0, .5), 'eye_R': (-.2, 0, -.4)}


def posed(path, plain=common.load_glb):
    objs = plain(path)
    for o in objs:
        r = POSE.get(o.name)
        if r is None and o.name.startswith('extra_'): r = (.3, 0, .25)
        if r is None and o.name.startswith('sway_'): r = (.4, 0, .3)
        if r:
            o.rotation_mode = 'XYZ'
            o.rotation_euler = r
    bpy.context.view_layer.update()
    return objs


args = sys.argv[sys.argv.index('--') + 1:]
stage, rest = args[0], args[1:]
kw, views, tag = {}, [], ''
i = 0
while i < len(rest):
    a = rest[i]
    if a == '--studio': kw['light'] = 'studio'; tag += '_studio'
    elif a == '--pose': common.load_glb = posed; tag += '_pose'
    elif a == '--focus':
        i += 1
        x, y, z, r = map(float, rest[i].split(','))
        kw['focus'] = ((x, y, z), r)
    elif a == '--tag':
        i += 1; tag += rest[i]
    else: views.append(a)
    i += 1
preview(f'toad_{stage}', views=views or ('front', 'three_quarter', 'side', 'back'), tag=tag, res=600, **kw)
