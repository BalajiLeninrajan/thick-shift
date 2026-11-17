# Writes public/models/hippo.json from the three exported stages:
#
#   tools/models/bl tools/models/hippo/meta.py
#
# Height, footprint and node names are measured from the GLBs. The face
# centres and the notes for the animator are written here by hand, and must
# be kept in step with build.py.
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import *

# Face centres in Blender axes (x, y with the front at -y, z). Converted below.
FACE = [(0, -.66, 1.86), (0, -.80, 2.0), (0, -1.0, 2.2)]

COMMON = ('Rest pose is standing, facing +Z. Every joint is a ball buried in the next part and is safe to 40 degrees about any axis unless noted. '
          'The hips are the character: keep the walk a slow, wide waddle that rolls the body 4 to 6 degrees side to side with each step. '
          'Kill line is "Big Biggs sat on you": the attack ends with it turning round and dropping the rear on the camera, or looming and falling forward. ')

NOTES = [
    COMMON +
    'Stage 0, the costume. No neck: head turns inside the collar, yaw 40, pitch 20 down or 25 up, roll 15. '
    'jaw hinges at the back of the head and opens to 30 degrees (positive X); the mouth behind it is a dark mesh panel, the two buck teeth stay with the head. '
    'eye_L and eye_R are googly plastic balls and can turn to any angle; let them drift separately and never blink. Each has an eye_glow catchlight on the pupil. '
    'arm_L and arm_R are stubby, one piece, mitten at the end; swing 40 forward or back, lift 35 sideways. leg_L and leg_R are tree trunks: swing 25 at the hip, more and the foot clips the other leg or the belly. '
    'The party hat, teeth and zip are part of head and body. Walk: short flat-footed steps, arms held a little out, head bobbing. Idle: still, with a slow head tilt and the eyes wandering. '
    'Jumpscare: head lunges forward and tips back 20, jaw drops to 30, arms come up 40.',

    COMMON +
    'Stage 1, off. The head is posed on its node with a built-in loll (about 9 degrees down and 7 to one side), so rotations add to that. '
    'neck pivots at the collar: pitch 20 either way, yaw 25. head on the neck: yaw 40, pitch 25, roll 20; it should twitch and hang, not bob. '
    'jaw opens to 35 degrees; both rows of teeth are human-sized, the upper row is on head and the lower on jaw. '
    'sway_1 is the black hair hanging out over the lower lip, a child of jaw, pivot at the lip: swing it up to 30 degrees and lag it behind head movement. '
    'eye_L has swollen and slipped; it points down and out with a huge pupil, eye_R has a pinprick pupil and points up. Turn them independently and slowly, and let only one of them track the player. '
    'arm_* are the upper arms, forearm_* the too-long forearms with split mittens and three dark fingers hanging out; elbows bend 40 forward (negative X), fingers reach to about 0.15 m off the floor so keep the forearm from swinging below rest. '
    'Legs as stage 0. Walk: the same waddle but hunched, arms dangling and swinging late. Idle: weight shifts, head jerks. '
    'Jumpscare: neck and head snap up 25, jaw to 35, forearms reach forward.',

    COMMON +
    'Stage 2, what is underneath. Hunched: about 2.9 m to the hat as posed. It could stand to 3.3 m if neck and head pitch back, which the game can do before an attack. '
    'neck pivots at the shoulders, head at the top of the neck: yaw 35, pitch 25, roll 20. jaw is the lower rim of the mouth hole, hinge inside the head; opening it 25 to 30 degrees (positive X) makes the hole a third taller for the scare. '
    'extra_1 is the mask, the small pale face that lives in the mouth hole, on a dark stalk, child of head, pivot at the back of the hole. Bob it by a few degrees of pitch and yaw all the time; to lean it out, translate it up to 0.25 m forward (+Z in three.js) and tip it 15 degrees, more than that and the stalk root shows. Its two eye pinpricks are eye_glow. '
    'eye_L and eye_R are black balls deep in sockets on the dome, each with one eye_glow pinprick; turn them up to 25 degrees to track the player, beyond that the point slides behind the socket rim. '
    'sway_1 is the black hair and ropes of blood over the lower lip, child of jaw. sway_2, sway_3 and sway_4 are three loops of gut hanging from the chest wound to the knees, children of body, pivot at the bottom of the wound: swing each up to 20 degrees with a different phase, and lag them behind body roll. '
    'arm_* and forearm_* reach the floor: four long fingers rest on it. Elbows bend 40 (negative X lifts the hand forward). Walk it like a gorilla, knuckles down, one arm planted while the hips swing past; lift forearms a few degrees before swinging an arm so fingers do not drag through the floor. '
    'leg_* and shin_* are thin and bow outward; hip swing 25, knee bend 35 (positive X on shin folds it back). '
    'The ribs across the wound, the teeth, the crushed hat and the fringe are part of body and head. '
    'Jumpscare: head pitches up 20 so the hole faces the camera, jaw to 30, the mask leans out and its mouth cannot open, so sell it with speed; forearms come up and fingers spread on either side of the frame.',
]

stages = []
for i in range(3):
    info = report(f'hippo_{i}')
    lo, hi = info['min'], info['max']
    fx, fy, fz = FACE[i]
    stages.append(dict(file=info['file'], height=round(hi[2], 2), radius=round(max(-lo[0], hi[0], -lo[1], hi[1]), 2),
                       face=[fx, fz, -fy], floats=False, nodes=info['nodes'], notes=NOTES[i]))
    print('[meta]', info['file'], info['tris'], 'tris', info['mb'], 'MB', 'size', info['size'])
with open(os.path.join(MODELS, 'hippo.json'), 'w') as f:
    json.dump(dict(key='hippo', stages=stages), f, indent=1)
print('[meta] wrote hippo.json')
