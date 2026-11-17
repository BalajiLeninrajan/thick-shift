# Render previews of an exported model, optionally posed, to check it the
# way the game will show it.
#
#   tools/models/bl tools/models/rhino/look.py -- rhino_0 [light=studio]
#       [views=front,side] [focus=x,y,z,r] [pose=head:0,30,0;arm_L:40,0,0]
#       [tag=_posed] [res=640]
#
# focus and pose use Blender axes (z up, front at -y). pose turns the named
# nodes by XYZ euler degrees, to test that joints hold when the game moves them.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import common
from mathutils import Euler

args = sys.argv[sys.argv.index('--') + 1:]
name = args[0]
opt = dict(a.split('=', 1) for a in args[1:])
kw = dict(light=opt.get('light', 'flashlight'), tag=opt.get('tag', ''), res=int(opt.get('res', 640)))
if 'views' in opt: kw['views'] = opt['views'].split(',')
if 'focus' in opt:
    f = [float(v) for v in opt['focus'].split(',')]
    kw['focus'] = (tuple(f[:3]), f[3])
if 'pose' in opt:
    pose = {k: [math.radians(float(v)) for v in rot.split(',')] for k, rot in (p.split(':') for p in opt['pose'].split(';'))}
    load = common.load_glb
    def posed(path):
        objs = load(path)
        for o in objs:
            if o.name in pose:
                o.rotation_mode = 'XYZ'
                o.rotation_euler = Euler(pose[o.name])
        common.bpy.context.view_layer.update()
        return objs
    common.load_glb = posed
common.preview(name, **kw)
