# Writes public/models/hippo.json from the three exported stages:
#
#   tools/models/bl tools/models/hippo/meta.py
#
# Height, footprint and node names are measured from the GLBs. The face
# centres and the notes for the animator are written here by hand and must be
# kept in step with build.py. Angles in the notes are degrees about the part's
# own axes in three.js terms: x pitches (positive tips a forward-pointing part
# down and swings a hanging part back), y yaws, z rolls.
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import *

# Face centres in Blender axes (x, y with the front at -y, z), converted below.
# Stage 1's is stage 0's carried through the head's built-in loll (HEAD_R, HEAD_T in build.py).
FACE = [(0, -.62, 1.90), (-.035, -.76, 1.98), (0, -.96, 2.30)]

JOINTS = 'Rest pose stands facing +Z. Joints are round ends buried in the next part. '
COMMON = (JOINTS +
          'The hips are the character: walk a slow, wide waddle that rolls body 4 to 6 degrees onto the standing leg each step, short steps, the rear swinging a beat late. '
          'The kill is "Big Biggs sat on you": for the attack it turns its back and drops the rear onto the camera, or looms and falls forward onto it. ')

NOTES = [
    COMMON +
    'Stage 0, the costume as built: cheerful, plush, a party hat. '
    'No neck: head turns inside the collar, yaw 40, pitch 20 down or 25 up, roll 15. '
    'jaw hinges at the back of the head and opens to 30 (positive x); the mouth behind it is a dark mesh panel a wearer would see out through. The two felt buck teeth belong to head, so they stay up when the jaw drops. '
    'eye_L and eye_R are googly plastic balls set deep in black felt rings. Turn them at most 20 degrees from rest on any axis: past that the pupil slides under the felt rim, and at 30 it is half hidden. Let them drift a little apart and never blink. The catchlight on each pupil is eye_glow. '
    'arm_* is the short upper arm, forearm_* the forearm with the mitten, elbow pivot at the seam halfway down; the elbow bends 40 forward (negative x lifts the mitten) and not backward. Arm swing 40 forward or back, 35 out to the side. '
    'leg_* is the thigh, nearly all inside the hips; shin_* is the visible leg and foot, knee at the hem of the hips (0.38 m up). Hip swing 25, more and the foot hits the other leg or the belly; knee bend 30 backward (positive x), not forward. '
    'The hat, the buck teeth and the zip are part of head and body. There are no extra_ or sway_ parts at this stage. '
    'Walk: flat-footed short steps, arms held a little out and swinging opposite the legs, head bobbing. Idle: still, a slow head tilt, the eyes wandering. '
    'Jumpscare: head lunges forward and tips back 20, jaw drops to 30, both arms come up 40 with forearms bent 40 so the mittens frame the face.',

    COMMON +
    'Stage 1, off: the same suit, but what is inside no longer fits it. The chest has dropped, a hump stands behind the shoulders, and the head rides on a neck with a built-in loll (about 9 degrees down and 7 to one side), so rotations add to that. '
    'neck pivots at the collar: pitch 20 either way, yaw 25. head on the neck: yaw 40, pitch 25, roll 20; it should twitch and hang, not bob. '
    'jaw opens to 35; the mouth is a smile far too wide with two rows of human teeth, the upper row on head and the lower on jaw. '
    'sway_1 is the black hair hanging out over the lower lip, a child of jaw, pivot at the lip: swing it up to 30 and lag it behind head movement. '
    'eye_L has swollen and slipped, points down and out and has a huge pupil; eye_R has a pinprick pupil and points up. Turn each at most 20 degrees from rest (past that the pupil slides under the felt rim); turn them separately and slowly, and let only one of them track the player. '
    'arm_* are the upper arms, forearm_* the too-long forearms with split mittens and three dark fingers hanging out to 0.15 m off the floor; elbows bend 40 forward (negative x), so never swing a forearm back past rest or the fingers dig into the floor. '
    'leg_* and shin_* as stage 0: hip 25, knee 30 backward. '
    'Walk: the same waddle but hunched, arms dangling and swinging late. Idle: weight shifts, head jerks. '
    'Jumpscare: neck and head snap up 25, jaw to 35, forearms reach forward 40.',

    JOINTS +
    'Stage 2, what is underneath: starved and hunched. The big rear is gone: the hips have wasted to a bony pelvis no wider than the shoulders, two hip bones and the tailbone showing through bare skin, matted fur hanging off them in long mats. '
    'Nothing comic is left, so no waddle and no sitting on anyone: the attack is a lunge, head first, with both hands. '
    'About 3.07 m to the bent hat tip as posed, so duck the head 10 degrees (pitch) under 3 m doorways; it can stand to 3.3 m if neck and head pitch back, which the game can do before an attack. '
    'neck pivots at the shoulders, head at the top of the neck: yaw 35, pitch 25, roll 20. jaw is the lower rim of the mouth hole, hinge inside the head; opening it 25 to 30 (positive x) makes the hole a third taller for the scare. '
    'extra_1 is the mask: a small pale face with hollow eyes on a dark stalk, living in the mouth hole, child of head, pivot at the back of the hole. Bob it a few degrees of pitch and yaw all the time; to lean it out, slide it up to 0.25 m forward (+Z) and tip it 15, more than that and the root of the stalk shows. Its two eye pinpricks are eye_glow. '
    'eye_L and eye_R are big pale lidless balls bulging out of bare bruised skin on the dome, the stage 1 eyes gone further: eye_L has swollen and slipped down, its pupil blown wide, and drifts outward; eye_R is higher with a pinprick pupil in a clouded grey iris and stares down at whoever is at its feet. Each has a small eye_glow catchlight beside the pupil. '
    'Turn each at most 25 degrees from rest; turn them separately and slowly, let only eye_R track the player while eye_L wanders, and never blink. '
    'sway_1 is the black hair and ropes of blood hanging over the lower lip, child of jaw. sway_2, sway_3 and sway_4 are three loops of gut hanging from the chest wound to the knees, children of body, pivot at the bottom of the wound: swing each up to 20 with a different phase and lag them behind body roll. '
    'arm_* and forearm_* reach the floor: four long fingers rest on it. Elbows bend 40 (negative x lifts the hand forward). Walk it like a gorilla, knuckles down, one arm planted while the hips swing past; lift a forearm a few degrees before swinging that arm so the fingers do not drag through the floor. '
    'leg_* and shin_* are thin and bow outward from the narrow pelvis; hip swing 25, knee bend 35 (positive x on shin folds it back). Walk with a slight body roll (2 to 3 degrees), stiff and quick, not a waddle. '
    'The ribs across the wound, the teeth, the crushed hat and the fringe are part of body and head. '
    'Jumpscare: head pitches up 20 so the hole faces the camera, jaw to 30, the mask leans out (its mouth cannot open, so sell it with speed), forearms come up and the fingers spread either side of the frame.',
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
