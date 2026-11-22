# Renders previews of an exported model without rebuilding it, into
# tools/models/previews.
#
#   tools/models/bl tools/models/look.py -- toad_0                          four flashlight views
#   tools/models/bl tools/models/look.py -- hippo_2 front,low studio        chosen views, even light
#   tools/models/bl tools/models/look.py -- hippo_2 front focus=0,-1,2.2,0.5 tag=_mask
#   tools/models/bl tools/models/look.py -- toad_2 front,side pose          joints turned, to find seams that open
#   tools/models/bl tools/models/look.py -- rhino_0 pose=head:0,30,0;arm_L:40,0,0
#
# The first word is the file in packages/game/public/models, without .glb.
# Views are names from common.VIEWS. focus is a point in Blender axes (x, y
# with the front at -y, z) and the radius to frame. A bare `pose` turns every
# joint the game may turn by 20 to 50 degrees; `pose=` turns the named nodes
# by XYZ euler degrees. res= and samples= set the render size and quality.
# The pictures are <name>_<view><tag>.png, and tag= replaces the tag that the
# options would otherwise make (_studio, _focus, _pose).
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import VIEWS, preview, script_args, turned

# What a bare `pose` turns. A key ending in _ covers every node that starts with it.
POSE = {'head': (15, 0, 35), 'neck': (10, 0, 10), 'jaw': (32, 0, 0), 'arm_L': (-40, 0, 0), 'arm_R': (35, 0, 20), 'forearm_L': (-40, 0, 0), 'forearm_R': (-30, 0, 0),
        'leg_L': (-35, 0, 0), 'leg_R': (30, 0, 0), 'shin_L': (35, 0, 0), 'shin_R': (20, 0, 0), 'extra_1': (-25, 0, 20), 'eye_L': (0, 0, 30), 'eye_R': (0, 0, 30),
        'sway_1': (-20, 0, 0), 'sway_2': (25, 0, 0), 'sway_3': (-20, 0, 15), 'sway_4': (15, 0, -15)}
# The toad's jaw opens wider and its tongue and spine are chains of extra_ parts.
POSES = {'toad': {'head': (20, 17, 0), 'jaw': (52, 0, 0), 'arm_L': (-40, 0, 17), 'arm_R': (29, 0, -11), 'forearm_L': (-34, 0, 0), 'forearm_R': (29, 0, 0),
                  'leg_L': (34, 0, 0), 'leg_R': (-34, 0, 0), 'shin_L': (29, 0, 0), 'shin_R': (-23, 0, 0), 'eye_L': (17, 0, 29), 'eye_R': (-11, 0, -23),
                  'extra_': (17, 0, 14), 'sway_': (23, 0, 17)}}

name, *args = script_args()
opt = dict(a.split('=', 1) for a in args if '=' in a)
words = [a for a in args if '=' not in a]
kw = {k: int(opt[k]) for k in ('res', 'samples') if k in opt}
tag = ''
for w in words:
    if w.split(',')[0] in VIEWS: kw['views'] = w.split(',')
if 'studio' in words: kw['light'] = 'studio'; tag += '_studio'
if 'focus' in opt:
    x, y, z, r = map(float, opt['focus'].split(','))
    kw['focus'] = ((x, y, z), r); tag += '_focus'
if 'pose' in opt:
    kw['pose'] = turned({k: [float(v) for v in rot.split(',')] for k, rot in (p.split(':') for p in opt['pose'].split(';'))})
elif 'pose' in words:
    table = POSES.get(name.split('_')[0], POSE)
    def find(node):
        return table.get(node) or next((r for k, r in table.items() if k.endswith('_') and node.startswith(k)), None)
    kw['pose'] = lambda objs: turned({o.name: find(o.name) for o in objs if find(o.name)})(objs)
if 'pose' in kw: tag += '_pose'
preview(name, tag=opt.get('tag', tag), **kw)
