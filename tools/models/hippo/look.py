# Extra previews of an exported stage, without rebuilding it.
#
#   tools/models/bl tools/models/hippo/look.py -- 2 dark front,low
#   tools/models/bl tools/models/hippo/look.py -- 2 studio front focus=0,-1,2.2,0.5 tag=_mask
#   tools/models/bl tools/models/hippo/look.py -- 2 pose
#
# `pose` turns every joint the way the game will (head, jaw, arms, legs and
# the rest by 30 to 40 degrees) and renders that as <key>_<view>_posecheck.png,
# to check that no seam opens. Focus is in Blender axes: x, y (front is -y), z,
# then the radius to frame.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import *

args = sys.argv[sys.argv.index('--') + 1:]
key = f'hippo_{args[0]}'
opt = {a.split('=')[0]: a.split('=')[1] for a in args if '=' in a}
focus = None
if 'focus' in opt:
    f = [float(v) for v in opt['focus'].split(',')]
    focus = (tuple(f[:3]), f[3])
views = next((tuple(a.split(',')) for a in args[1:] if a.split(',')[0] in VIEWS), ('front',))
light = 'studio' if 'studio' in args else 'flashlight'
res, samples = int(opt.get('res', 448)), int(opt.get('samples', 12))

if 'pose' in args:
    POSE = {'head': (15, 0, 35), 'neck': (10, 0, 10), 'jaw': (32, 0, 0), 'arm_L': (-40, 0, 0), 'arm_R': (35, 0, 20), 'forearm_L': (-40, 0, 0), 'forearm_R': (-30, 0, 0),
            'leg_L': (-35, 0, 0), 'leg_R': (30, 0, 0), 'shin_L': (35, 0, 0), 'shin_R': (20, 0, 0), 'extra_1': (-25, 0, 20), 'eye_L': (0, 0, 30), 'eye_R': (0, 0, 30),
            'sway_1': (-20, 0, 0), 'sway_2': (25, 0, 0), 'sway_3': (-20, 0, 15), 'sway_4': (15, 0, -15)}
    def posed(objs):
        for o in objs:
            if o.name in POSE:
                o.rotation_mode = 'XYZ'
                o.rotation_euler = [math.radians(a) for a in POSE[o.name]]
    preview(key, views=views if len(views) > 1 else ('front', 'three_quarter', 'back'), light='studio', res=res, samples=samples, focus=focus, tag='_posecheck' + opt.get('tag', ''), pose=posed)
else:
    preview(key, views=views, light=light, res=res, samples=samples, focus=focus, tag=opt.get('tag', '_' + light if focus is None else '_focus'))
