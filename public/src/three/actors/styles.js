// What makes each mascot itself: how it walks, how far its head turns, the
// pose it takes in each state, and the parts only it has. mascot.js runs the
// machinery; this file is the tuning, written from the notes each model
// carries in public/models/<key>.json and from the 2D art in render/mascot.js.
import * as THREE from 'three';
import { EYE_PALE } from '../assets.js';
import { lag } from './rig.js';

/* ---------- pose channels ---------- */
// A pose is one number per channel. Every state has a pose, and a mascot's
// channels spring toward the pose of the state it is in, so no change of state
// can pop. Angles are radians; a negative arm angle is forward and up.
export const CH = ['lean', 'drop', 'headX', 'headY', 'headZ', 'jaw', 'armL', 'armR', 'out', 'fore', 'track', 'sweep', 'shake', 'breath', 'sway', 'sit', 'rear', 'reach', 'slack', 'legs'];
export const C = Object.fromEntries(CH.map((k, i) => [k, i])), NCH = CH.length;
// How fast each channel follows its target, per second. Shaking and tracking
// start at once; weight (lean, sit, drop) takes its time.
const RATES = { lean: 6, drop: 7, headX: 8, headY: 8, headZ: 6, jaw: 12, armL: 7, armR: 7, out: 6, fore: 8, track: 9, sweep: 4, shake: 16, breath: 2, sway: 2, sit: 10, rear: 9, reach: 6, slack: 5, legs: 6 };
export const RATE = Float32Array.from(CH, k => RATES[k]);

const BASE = { breath: 1, sway: 1, legs: 1 };
const LIT_STATES = ['roam', 'search', 'hunt'];   // the states a torch beam can interrupt

// Poses every mascot shares, by rot stage. `lit` is laid over roam, search and hunt while a beam holds it.
const COMMON = {
  siege: { lean: -.14, armL: -2.3, armR: -2.3, fore: -.5, jaw: .5, headX: -.1 },                    // drawn back for the next hit
  windup: { lean: .42, drop: .14, headX: .4, armL: .7, armR: .7, track: 1, shake: .4, rear: 1, jaw: .4 },
  charge: { lean: .55, headX: .35, armL: .9, armR: .9, jaw: 1, track: .4, rear: -1 },
  stun: { lean: -.16, slack: 1, headZ: .5, headX: .3, drop: .08, sway: 3, breath: 2.5 },
  feast: { sit: 1, headX: .5, lean: -.1, armL: -.35, armR: -.35, out: .4, jaw: .35, track: .6, breath: 2 },
  scare: { track: 1, lean: .3, jaw: 1, armL: -1.5, armR: -1.5, out: .5, fore: -.3, shake: .5, reach: 1 },
};
const STAGE = [
  // 0: someone in a heavy costume, being friendly
  {
    rest: { breath: 0, sway: 0, headX: .1 },
    roam: {},
    search: { sweep: 1, lean: .04 },
    hunt: { track: 1, lean: .08, headZ: .26, armL: -.25, armR: -.25, out: .12 },
    lit: { track: 1, breath: 0, sway: 0, shake: .1, lean: -.05, out: .22 },                         // caught mid-step, and it stays that way
  },
  // 1: wrong. Head held at an angle, jaw working, everything in jerks
  {
    rest: { breath: 0, sway: 0, headX: .1 },
    roam: { headZ: .38, jaw: .15, sway: 1.5 },
    search: { sweep: 1, headZ: .38, lean: .12, jaw: .3 },
    hunt: { track: 1, lean: .25, headZ: .42, jaw: .55, armL: -.9, armR: -.5, fore: -.5 },
    lit: { track: .25, headY: .75, headX: .3, lean: .34, shake: .7, armR: -1.9, fore: -1.1, jaw: .8, drop: .06 },   // leaning into the beam like a wind, face turned from it
  },
  // 2: the thing itself
  {
    rest: { breath: 0, sway: 0, headX: .1 },
    roam: { jaw: .2, sway: 1.5 },
    search: { sweep: 1, lean: .15, jaw: .35 },
    hunt: { track: 1, lean: .3, jaw: .75, armL: -1.1, armR: -1.1, fore: -.4, reach: 1 },
    lit: { track: 1, lean: .44, shake: 1, jaw: 1, armL: -1.4, armR: -1.4, fore: -.6, drop: .1, reach: 1 },
  },
];

const GAIT = { mode: 'walk', min: .14, max: .5, fast: 4, knee: .6, hipYaw: .2, hipRoll: .07, shift: .05, arm: .3 };
const HEAD = { yaw: .6, pitch: .3, rate: 4, step: 0, eye: .5, twitch: 0, neck: .35 };
// How far a joint may turn before the mesh opens, from each model's notes. The poses ask for what they want and are held to this.
const LIMIT = { arm: 2.6, out: 1, fore: 1.3 };

/* ---------- the four ---------- */
// Each returns what differs from the defaults at that stage. `states` are laid
// over the stage's poses; `hook` runs after the shared layers each frame.

const FIT = {
  // Madame Flan. Notes: head joint is hidden by the pearls, so the head barely pitches.
  walrus: [
    () => ({ gait: { max: .5, knee: .65, hipRoll: .07, hipYaw: .24 }, head: { yaw: .65, pitch: .24 }, limit: { arm: .75, out: .7, fore: .7 }, gestures: ['tilt', 'hug'], sit: .5 }),
    () => ({ gait: { max: .5, knee: .65 }, head: { yaw: .65, pitch: .2, step: 7, twitch: .1 }, limit: { arm: .75, out: .7, fore: .7 }, jaw: .75, sit: .5 }),
    rig => ({
      // The drape hangs dead still and the head stays level and on you; all the movement is the four legs behind.
      gait: { mode: 'glide' }, head: { yaw: 1, pitch: .9, rate: 11, twitch: .12, neck: .45 }, jaw: 1.3, swayMax: .16, sit: .35,
      states: { roam: { jaw: 0, sway: 0, breath: 0 }, search: { lean: 0, jaw: 0, sweep: 1 }, hunt: { lean: 0, jaw: .15, track: 1, reach: .4 }, lit: { lean: 0, drop: 0, shake: .35, jaw: .5, track: 1, reach: 1 }, scare: { lean: 0, headX: .2, reach: 1 } },
      chains: { 1: harvestman, 2: harvestman, 3: deadLeg, 4: harvestman },
      hook(a, rig, ch) { rig.neck.rx += ch[C.track] * .1 + a.scareW * .6 + ch[C.sit] * .5; },   // the neck brings the face down to you
    }),
  ],
  // Squish.
  toad: [
    () => ({ gait: { max: .35, hipRoll: .1, hipYaw: .2, arm: .08 }, head: { yaw: .42, pitch: .3 }, limit: { arm: 1.4, out: .5 }, gestures: ['tilt', 'wave'], sit: .45, states: { scare: { headX: .3, armL: -1.2, armR: -1.2 } } }),
    () => ({
      gait: { mode: 'crawl', arm: .5, max: .42 }, head: { yaw: .35, pitch: .3, step: 6, twitch: .12 }, limit: { arm: 1.05, fore: 1.2 }, jaw: .6, sit: .2,
      states: { hunt: { lean: 0, armL: 0, armR: 0, fore: 0, jaw: .7 }, lit: { lean: .1, armR: -1, fore: -.9 }, siege: { lean: -.1, armL: -1, armR: -1, fore: -.8 }, scare: { lean: .1, armL: -1.4, armR: -1.4, fore: -.85, headX: .35 }, feast: { armL: 0, armR: 0 } },
    }),
    () => ({
      // It hangs in the air. Nothing steps; the jaw is the animation.
      gait: { mode: 'float' }, head: { yaw: .5, pitch: .33, rate: 12, twitch: .14, eye: .6 }, jaw: 1.1, sit: .6,
      states: { roam: { jaw: .12 }, search: { jaw: .3, lean: .1 }, hunt: { lean: .2, jaw: .5, track: 1 }, lit: { lean: .1, jaw: .75, shake: 1, drop: 0 }, siege: { lean: -.2, jaw: .6 }, scare: { lean: 0, headX: -.25, jaw: 1 }, feast: { jaw: .5, lean: 0 } },
      chains: { 1: spine },
    }),
  ],
  // Tank.
  rhino: [
    () => ({ gait: { max: .44, knee: .25, hipRoll: .065, hipYaw: .2, arm: .35 }, head: { yaw: .7, pitch: .4 }, limit: { arm: 1.05, out: .5, fore: .87 }, gestures: ['wave', 'tilt'], sit: .5, states: { windup: { headX: .35, armL: .9, armR: .9 }, scare: { headX: .3, lean: .35 } } }),
    () => ({
      // Folded up on the floor. It hops.
      gait: { mode: 'hop', max: .5 }, head: { yaw: .6, pitch: .5, step: 6, twitch: .12 }, limit: { arm: .78, fore: .7 }, sit: .05,
      states: { roam: { headZ: .2 }, hunt: { lean: .12, armL: -.2, armR: -.2, fore: 0, headZ: .3 }, lit: { lean: .2, armR: -.75, fore: -.6, drop: 0 }, siege: { lean: -.1, armL: -.75, armR: -.75, fore: -.5 }, windup: { lean: .3, drop: 0, armL: -.4, armR: -.4, legs: 0 }, charge: { lean: .6, armL: -.7, armR: -.7, legs: 0 }, feast: { armL: 0, armR: 0, lean: 0 }, scare: { lean: .55, armL: -.75, armR: -.75, fore: -.5, legs: 0 } },
      hook(a, rig, ch) {   // the spring: legs straighten as it goes
        const k = Math.max(0, 1 - ch[C.legs]);
        rig.leg_L.rx += .65 * k; rig.leg_R.rx += .65 * k; rig.shin_L.rx -= .8 * k; rig.shin_R.rx -= .8 * k; rig.root.py += .35 * k;
      },
    }),
    rig => ({
      // A puppet hung from the worm in its belly. The worm does the looking.
      gait: { min: .1, max: .26, knee: .17, hipRoll: .03, hipYaw: .08, arm: 0, shift: .02 }, head: { yaw: .3, pitch: .2, rate: 3, neck: 0 }, sit: .4, looker: 1, slackArms: true, swayMax: .5,
      states: { roam: { slack: 1 }, search: { slack: 1, sweep: 1, lean: -.04 }, hunt: { slack: 1, lean: -.1, track: 1, armL: 0, armR: 0, fore: 0, reach: 1 }, lit: { slack: 1, lean: -.16, shake: 1, armL: 0, armR: 0, fore: 0, track: 1, drop: 0 }, siege: { slack: 1, lean: -.15, armL: 0, armR: 0, fore: 0, rear: 1 }, windup: { slack: 1, lean: -.22, drop: 0, armL: 0, armR: 0, rear: 1, headX: 0 }, charge: { slack: 1, lean: -.3, armL: 0, armR: 0, rear: -1, headX: 0 }, feast: { slack: 1, armL: 0, armR: 0 }, scare: { slack: 1, lean: -.15, armL: 0, armR: 0, fore: 0, rear: -1, jaw: 1 } },
      chains: { 1: worm, 2: ring(1.6), 3: ring(-2.3), 4: ring(3.1), 5: gullet },
    }),
  ],
  // Big Biggs.
  hippo: [
    () => ({ gait: { max: .42, hipRoll: .08, hipYaw: .26, shift: .07 }, head: { yaw: .55, pitch: .3 }, gestures: ['wave', 'tilt'], sit: .5 }),
    () => ({ gait: { max: .45, hipRoll: .09, hipYaw: .26, shift: .07 }, head: { yaw: .5, pitch: .3, step: 7, twitch: .1 }, jaw: .6, sit: .5 }),
    () => ({
      // Hunched, knuckles on the floor. The mask in its mouth leans out to look.
      gait: { max: .4, hipRoll: .1, hipYaw: .3, shift: .08, arm: .55 }, head: { yaw: .5, pitch: .3, rate: 7, twitch: .12 }, jaw: .7, sit: .45,
      states: { roam: { jaw: .25 }, hunt: { lean: .16, jaw: .8, armL: 0, armR: 0, fore: 0, reach: 1 }, lit: { lean: .25, armL: -.6, armR: -.6, fore: -.4, jaw: 1, reach: 1, drop: .05 }, scare: { lean: .2, jaw: 1, reach: 1, armL: -1.1, armR: -1.1 } },
      chains: { 1: mask },
    }),
  ],
};

/* ---------- parts only one of them has ---------- */
// Each is (a, links, ch, dt): a the mascot (a.t its clock, a.i its index,
// a.track its motion, a.aimY/aimP where its target is), links the chain.

const hash = n => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
export { hash };

// Anything unclaimed hangs and trails: each link lags the one above it.
function dangle(a, links, ch, dt) {
  const tr = a.track;
  for (const l of links) lag(l, tr.vf * .05 + Math.sin(a.t * .9 - l.depth * .7 + l.seed * 20) * .05, -tr.vs * .05 - tr.spin * .03 + Math.cos(a.t * .7 - l.depth * .6 + l.seed * 30) * .05, dt, 30, 5, .4);
}

// Flan's legs move like a machine with a fault: each holds still, then goes
// through a burst of hard steps, fourteen a second, and holds again.
function harvestman(a, links, ch, dt) {
  const n = links[0].seed * 97, slotT = a.t / 1.3 + n * .37, slot = Math.floor(slotT), into = slotT - slot, tick = Math.floor(a.t * 14);
  // Walking, or held in a beam, there is hardly a slot without a spasm.
  const busy = Math.min(1, a.track.speed * .4 + ch[C.shake] + a.scareW), spasm = hash(slot * 5 + n) > .6 - busy * .5 && into < .45 + busy * .3;
  const reach = ch[C.reach] * (links[0].at.y > 1.2 ? 1 : .3);   // the upper pair come forward for you
  for (let k = 0; k < links.length; k++) {
    const l = links[k], j1 = spasm ? hash(tick + n * 13 + k * 5) - .5 : 0, j2 = spasm ? hash(tick + n * 29 + k * 3) - .5 : 0;
    l.rx += j1 * (.5 - k * .1) - (k === 0 ? reach * .55 : k === 1 ? reach * .3 : 0); l.rz += j2 * .4; if (k === 0) l.ry += j2 * .5 - Math.sign(l.at.x) * reach * .5;
  }
}
// The one that no longer works: curled, and it only trembles.
function deadLeg(a, links) { const tick = Math.floor(a.t * 14); for (let k = 0; k < links.length; k++) { links[k].rx += (hash(tick + 77 + k) - .5) * .05; links[k].rz += (hash(tick + 91 + k) - .5) * .04; } }

// Squish's bare spine trails under it, each link later than the last.
function spine(a, links, ch, dt) {
  const tr = a.track;
  for (const l of links) {
    const k = l.depth + 1;
    lag(l, tr.vf * .07 + Math.sin(a.t * 1.1 - k * .8) * .09 + ch[C.shake] * (hash(Math.floor(a.t * 14) + k) - .5) * .2, -tr.vs * .07 - tr.spin * .05 + Math.cos(a.t * .8 - k * .7) * .07, dt, 22 - k * 2, 3.5, .3);
  }
}

// Tank's worm. A slow travelling sway and a swallowing pulse; the upper links
// turn the mouth to whoever it is looking at; `rear` curls it back before a
// charge (and at a door), and below zero throws it forward, mouth first.
function worm(a, links, ch, dt) {
  const n = links.length, rear = ch[C.rear], tk = ch[C.track], lunge = a.kLunge + a.scareBite;
  for (let k = 0; k < n; k++) {
    const l = links[k], u = k / (n - 1), upper = Math.max(0, u - .45) / .55;
    l.rx += Math.sin(a.t * .8 - k * .55) * .07 + ch[C.shake] * (hash(Math.floor(a.t * 14) + k) - .5) * .12;
    l.rz += Math.cos(a.t * .6 - k * .5) * .07;
    l.s *= 1 + .08 * Math.max(0, Math.sin(a.t * 3.5 - k * .8));
    // The mouth: share the turn toward the target along the upper links.
    l.ry += a.aimY * tk * upper * 2.4 / n; l.rx += (a.aimP * tk * 2.4 / n + .05 * tk) * upper;
    l.rx += -rear * .17 * upper + lunge * .16 * upper;
  }
}
// The tooth rings turn against each other, faster when it has someone.
function ring(rate) { return (a, links, ch, dt) => { links[0].rzSpin = (links[0].rzSpin || 0) + rate * dt * (.4 + ch[C.track] + a.scareW * 4); links[0].rz += links[0].rzSpin; }; }
// The second mouth, down the throat: it comes up when the worm has you.
function gullet(a, links, ch) { links[0].pz += .22 * Math.max(0, Math.min(1, .5 * ch[C.reach] * (.5 + .5 * Math.sin(a.t * 2.3)) + a.scareBite)); }

// The small pale face in Biggs's mouth. It leans out to look at you, and
// keeps looking when the head turns away.
function mask(a, links, ch) {
  const out = Math.max(ch[C.reach], a.scareW), l = links[0];
  l.pz += .12 * out + Math.sin(a.t * .7) * .015; l.px += Math.sin(a.t * .4) * .01;
  l.ry += a.eyeY * .9; l.rx += a.eyeP * .9 + Math.sin(a.t * .9) * .04;
  for (let k = 1; k < links.length; k++) { links[k].ry += a.eyeY * .4; }
}

/* ---------- assembly ---------- */

function poseOf(...layers) {
  const p = new Float32Array(NCH);
  for (const l of layers) if (l) for (const k in l) p[C[k]] = l[k];
  return p;
}

// Everything the animator needs for one mascot at one stage. info is that
// stage's entry in the manifest, or nothing if the manifest has not loaded.
export function styleOf(key, stage, rig, info) {
  const fit = FIT[key][stage](rig, info), own = fit.states || {}, st = STAGE[stage];
  const style = {
    gait: { ...GAIT, ...fit.gait }, head: { ...HEAD, twitch: stage ? .1 : 0, rate: [4, 4, 12][stage], ...fit.head },
    jaw: fit.jaw ?? .5, sit: fit.sit ?? .5, swayMax: fit.swayMax ?? .35, gestures: fit.gestures || [], hook: fit.hook || null,
    limit: { ...LIMIT, ...fit.limit }, looker: fit.looker ?? 0, slackArms: !!fit.slackArms, floats: !!info?.floats || fit.gait?.mode === 'float', stage,
    chains: [], poses: { lit: {} },
  };
  for (const n in rig.chains) style.chains.push({ links: rig.chains[n], run: fit.chains?.[n] || dangle });
  for (const name of ['rest', 'roam', 'search', 'hunt', 'siege', 'windup', 'charge', 'stun', 'feast', 'scare']) style.poses[name] = poseOf(BASE, st[name] || COMMON[name], own[name]);
  for (const name of LIT_STATES) style.poses.lit[name] = poseOf(BASE, st[name], own[name], st.lit, own.lit);
  return style;
}

/* ---------- the stand-in ---------- */
// Shown until a mascot's model has loaded, and for good if it never does: the
// same named parts as a real one, so it moves by the same rules.

const GEO = {
  hips: new THREE.SphereGeometry(.55, 16, 12).scale(1.75, .85, 1.3), chest: new THREE.CapsuleGeometry(.5, .5, 6, 14), head: new THREE.SphereGeometry(.42, 16, 12),
  jaw: new THREE.BoxGeometry(.5, .1, .4).translate(0, -.05, .2), eye: new THREE.SphereGeometry(.075, 10, 8), glint: new THREE.SphereGeometry(.03, 6, 4).translate(0, 0, .06),
  limb: new THREE.CapsuleGeometry(.13, .3, 4, 8).translate(0, -.22, 0), thigh: new THREE.CapsuleGeometry(.2, .2, 4, 8).translate(0, -.2, 0), foot: new THREE.BoxGeometry(.3, .12, .5).translate(0, -.39, .1),
};
const GLINT = new THREE.MeshBasicMaterial({ color: EYE_PALE, fog: false });

export function standIn(def) {
  const mat = new THREE.MeshStandardMaterial({ color: def.col, roughness: 1 }), dark = new THREE.MeshStandardMaterial({ color: 0x08080e, roughness: 1 });
  const node = (name, parent, x, y, z, ...meshes) => {
    const o = new THREE.Object3D(); o.name = name;
    if (parent) { parent.updateWorldMatrix(true, false); o.position.set(x, y, z).sub(new THREE.Vector3().setFromMatrixPosition(parent.matrixWorld)); parent.add(o); }
    for (const [geo, m, mx = 0, my = 0, mz = 0] of meshes) { const mesh = new THREE.Mesh(geo, m); mesh.position.set(mx, my, mz); mesh.castShadow = m !== GLINT; mesh.userData.glow = m === GLINT; o.add(mesh); }
    return o;
  };
  const root = node('root'), body = node('body', root, 0, .95, 0, [GEO.hips, mat, 0, 0, -.1], [GEO.chest, mat, 0, .55, 0]);
  const head = node('head', body, 0, 1.85, 0, [GEO.head, mat, 0, .25, .05]);
  node('jaw', head, 0, 1.95, .1, [GEO.jaw, dark]);
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    node('eye_' + s, head, sx * .17, 2.2, .4, [GEO.eye, dark], [GEO.glint, GLINT]);
    node('forearm_' + s, node('arm_' + s, body, sx * .62, 1.65, 0, [GEO.limb, mat]), sx * .62, 1.2, 0, [GEO.limb, mat]);
    node('shin_' + s, node('leg_' + s, body, sx * .4, .85, 0, [GEO.thigh, mat]), sx * .4, .45, 0, [GEO.limb, mat], [GEO.foot, mat]);
  }
  return root;
}
