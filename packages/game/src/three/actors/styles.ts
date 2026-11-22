// What makes each mascot itself: how it walks, how far its head turns, the
// pose it takes in each state, and the parts only it has. mascot.ts runs the
// machinery; this file is the tuning, written from the notes each model
// carries in packages/game/public/models/<key>.json.

import { WINDUP } from '@thick-shift/sim';
import type { MascotKey, MascotKind } from '@thick-shift/sim/config';
import type { MascotState, NonEmpty } from '@thick-shift/sim/types';
import * as THREE from 'three';
import { EYE_PALE } from '../assets';
import type { Mascot } from './mascot';
import type { Part, Rig } from './rig';
import { lag } from './rig';
import { TAU } from './track';

const { clamp } = THREE.MathUtils;

/* ---------- pose channels ---------- */
// A pose is one number per channel. Every state has a pose, and a mascot's
// channels spring toward the pose of the state it is in, so no change of state
// can pop. Angles are radians; a negative arm angle is forward and up.
export const CH = [
  'lean',
  'drop',
  'headX',
  'headY',
  'headZ',
  'jaw',
  'armL',
  'armR',
  'out',
  'fore',
  'track',
  'sweep',
  'shake',
  'breath',
  'sway',
  'sit',
  'rear',
  'reach',
  'slack',
  'legs',
  'coil',
  'lance',
  'swivel',
] as const;
type Channel = (typeof CH)[number];
// One number per channel: a mascot's ch, RATE, a pose.
export type Channels = Record<Channel, number>;
// Object.fromEntries types what it builds as a string record, hence the cast.
export const ZERO = Object.fromEntries(CH.map(k => [k, 0])) as Channels;
// One layer of a pose: the channels it sets, in radians (or as each channel reads it).
type PoseLayer = Partial<Channels>;
// A pose for every state, and for the catch.
type PoseName = MascotState | 'scare';
// The three rot stages, and a table with an entry for each.
export type Stage = 0 | 1 | 2;
export type PerStage<T> = readonly [T, T, T];
export const isStage = (n: number): n is Stage => n === 0 || n === 1 || n === 2;
// How fast each channel follows its target, per second. Shaking and tracking
// start at once; weight (lean, sit, drop) takes its time.
export const RATE: Channels = {
  lean: 6,
  drop: 7,
  headX: 8,
  headY: 8,
  headZ: 6,
  jaw: 12,
  armL: 7,
  armR: 7,
  out: 6,
  fore: 8,
  track: 9,
  sweep: 4,
  shake: 16,
  breath: 2,
  sway: 2,
  sit: 10,
  rear: 9,
  reach: 6,
  slack: 5,
  legs: 6,
  coil: 5,
  lance: 9,
  swivel: 4,
};

const BASE: PoseLayer = { breath: 1, sway: 1, legs: 1 };
// The states a torch beam can interrupt.
type LitState = 'roam' | 'search' | 'hunt';
export const isLitState = (st: MascotState): st is LitState => st === 'roam' || st === 'search' || st === 'hunt';

// Poses every mascot shares, by rot stage. `lit` is laid over roam, search and hunt while a beam holds it.
const COMMON: Partial<Record<PoseName, PoseLayer>> = {
  rest: { breath: 0, sway: 0, headX: 0.1 },
  siege: { lean: -0.14, armL: -2.3, armR: -2.3, fore: -0.5, jaw: 0.5, headX: -0.1 }, // drawn back for the next hit
  windup: { lean: 0.42, drop: 0.14, headX: 0.4, armL: 0.7, armR: 0.7, track: 1, shake: 0.4, rear: 1, jaw: 0.4 },
  charge: { lean: 0.55, headX: 0.35, armL: 0.9, armR: 0.9, jaw: 1, track: 0.4, rear: -1 },
  stun: { lean: -0.16, slack: 1, headZ: 0.5, headX: 0.3, drop: 0.08, sway: 3, breath: 2.5 },
  feast: { sit: 1, headX: 0.5, lean: -0.1, armL: -0.35, armR: -0.35, out: 0.4, jaw: 0.35, track: 0.6, breath: 2 },
  scare: { track: 1, lean: 0.3, jaw: 1, armL: -1.5, armR: -1.5, out: 0.5, fore: -0.3, shake: 0.5, reach: 1 },
};
const STAGE: PerStage<Partial<Record<PoseName | 'lit', PoseLayer>>> = [
  // 0: someone in a heavy costume, being friendly
  {
    roam: {},
    search: { sweep: 1, lean: 0.04 },
    hunt: { track: 1, lean: 0.08, headZ: 0.26, armL: -0.25, armR: -0.25, out: 0.12 },
    lit: { track: 1, breath: 0, sway: 0, shake: 0.1, lean: -0.05, out: 0.22 }, // caught mid-step, and it stays that way
  },
  // 1: wrong. Head held at an angle, jaw working, everything in jerks
  {
    roam: { headZ: 0.38, jaw: 0.15, sway: 1.5 },
    search: { sweep: 1, headZ: 0.38, lean: 0.12, jaw: 0.3 },
    hunt: { track: 1, lean: 0.25, headZ: 0.42, jaw: 0.55, armL: -0.9, armR: -0.5, fore: -0.5 },
    lit: { track: 0.25, headY: 0.75, headX: 0.3, lean: 0.34, shake: 0.7, armR: -1.9, fore: -1.1, jaw: 0.8, drop: 0.06 }, // leaning into the beam like a wind, face turned from it
  },
  // 2: the thing itself
  {
    roam: { jaw: 0.2, sway: 1.5 },
    search: { sweep: 1, lean: 0.15, jaw: 0.35 },
    hunt: { track: 1, lean: 0.3, jaw: 0.75, armL: -1.1, armR: -1.1, fore: -0.4, reach: 1 },
    lit: { track: 1, lean: 0.44, shake: 1, jaw: 1, armL: -1.4, armR: -1.4, fore: -0.6, drop: 0.1, reach: 1 },
  },
];
// For something whose hands and feet never leave the floor: no lean, crouch, sit or arm pose, whatever the state.
const PLANTED: PoseLayer = { lean: 0, drop: 0, sit: 0, armL: 0, armR: 0, fore: 0, out: 0, slack: 0 };

// How it gets about. mode: walk, float (nothing to stand on), crawl (on all fours), hop, glide (nothing steps), or
// scuttle (on hands and feet, belly up, in a panic; max is its stride).
// min, max: how far a leg swings, in radians, from standing to fast (metres a second). knee: how far a knee bends as
// the foot comes forward. hipYaw, hipRoll, shift: the hips turning, rolling onto the standing leg, and moving over
// it. arm: the arm swing.
export interface Gait {
  mode: 'walk' | 'float' | 'crawl' | 'hop' | 'glide' | 'scuttle';
  min: number;
  max: number;
  fast: number;
  knee: number;
  hipYaw: number;
  hipRoll: number;
  shift: number;
  arm: number;
}
// How its head moves: how far it turns (yaw, pitch, radians), how fast it follows (rate, per second), steps a second
// at stage 1 (step, 0 for smooth), how far the eyes turn (eye), how often it looks away (twitch, 0 to 1), and the
// neck's share of the turn (neck).
interface Head {
  yaw: number;
  pitch: number;
  rate: number;
  step: number;
  eye: number;
  twitch: number;
  neck: number;
}
interface Limit {
  arm: number;
  out: number;
  fore: number;
}
type Gesture = 'wave' | 'hug' | 'tilt';
// A part only one of them has, run on the links of an extra_N chain each frame: see below. A chain always has its
// first link (rig.ts starts each one with it).
type ChainRun = (a: Mascot, links: NonEmpty<Part>, ch: Channels, dt: number) => void;
type Hook = (a: Mascot, rig: Rig, ch: Channels) => void;
// What a mascot changes from the defaults at one stage.
interface Tuning {
  gait?: Partial<Gait>;
  head?: Partial<Head>;
  limit?: Partial<Limit>;
  gestures?: Gesture[];
  jaw?: number;
  sit?: number;
  swayMax?: number;
  looker?: number;
  states?: Partial<Record<PoseName | 'lit', PoseLayer>>;
  chains?: Record<string, ChainRun>;
  hook?: Hook;
  ahead?: number;
}

const GAIT: Gait = { mode: 'walk', min: 0.14, max: 0.5, fast: 4, knee: 0.6, hipYaw: 0.2, hipRoll: 0.07, shift: 0.05, arm: 0.3 };
const HEAD: Head = { yaw: 0.6, pitch: 0.3, rate: 4, step: 0, eye: 0.5, twitch: 0, neck: 0.35 };
// How far a joint may turn before the mesh opens, from each model's notes. The poses ask for what they want and are held to this.
const LIMIT: Limit = { arm: 2.6, out: 1, fore: 1.3 };

// How far in front of the body Stompy's worm gets (metres, the furthest of its links and lips), by the pivots worm()
// is fitted to: at rest, at lance and slump 0, 0.2, ... 1 (slump's is the most it has reached on the way down, so it
// only grows), and how much less per unit of coil. With a wall closer than that it is crushed back, lance and slump
// giving way first and coil taking up the rest, so as Stompy runs out of room the worm folds back off the wall
// instead of into it.
const REACH = {
  rest: 0.82,
  lance: [0.82, 1.07, 1.31, 1.52, 1.69, 1.81],
  slump: [0.82, 1.12, 1.31, 1.38, 1.38, 1.38],
  coil: 0.8,
  gap: 0.12, // between the mouth and the wall
} as const;
// Where it stops looking for a wall: a little past the furthest the worm gets.
const AHEAD = Math.max(...REACH.lance, ...REACH.slump) + REACH.gap + 0.1;

/* ---------- the four ---------- */
// What differs from the defaults at each stage. `states` are laid over the
// stage's poses; `hook` runs after the shared layers each frame.

const TUNING: Record<MascotKey, PerStage<Tuning>> = {
  // Madame Flan. Notes: head joint is hidden by the pearls, so the head barely pitches.
  walrus: [
    {
      gait: { max: 0.5, knee: 0.65, hipRoll: 0.07, hipYaw: 0.24 },
      head: { yaw: 0.65, pitch: 0.24 },
      limit: { arm: 0.75, out: 0.7, fore: 0.7 },
      gestures: ['tilt', 'hug'],
      sit: 0.5,
    },
    {
      gait: { max: 0.5, knee: 0.65 },
      head: { yaw: 0.65, pitch: 0.2, step: 7, twitch: 0.1 },
      limit: { arm: 0.75, out: 0.7, fore: 0.7 },
      jaw: 0.75,
      sit: 0.5,
    },
    {
      // The drape hangs dead still and the head stays level and on you; all the movement is the four legs behind.
      gait: { mode: 'glide' },
      head: { yaw: 1, pitch: 0.9, rate: 11, twitch: 0.12, neck: 0.45 },
      jaw: 1.3,
      swayMax: 0.16,
      sit: 0.35,
      states: {
        roam: { jaw: 0, sway: 0, breath: 0 },
        search: { lean: 0, jaw: 0, sweep: 1 },
        hunt: { lean: 0, jaw: 0.15, track: 1, reach: 0.4 },
        lit: { lean: 0, drop: 0, shake: 0.35, jaw: 0.5, track: 1, reach: 1 },
        scare: { lean: 0, headX: 0.2, reach: 1 },
      },
      chains: { 1: harvestman, 2: harvestman, 3: deadLeg, 4: harvestman },
      hook(a, rig, ch) {
        rig.neck.rx += ch.track * 0.1 + a.scareW * 0.6 + ch.sit * 0.5;
      }, // the neck brings the face down to you
    },
  ],
  // Squish.
  toad: [
    {
      gait: { max: 0.35, hipRoll: 0.1, hipYaw: 0.2, arm: 0.08 },
      head: { yaw: 0.42, pitch: 0.3 },
      limit: { arm: 1.4, out: 0.5 },
      gestures: ['tilt', 'wave'],
      sit: 0.45,
      states: { scare: { headX: 0.3, armL: -1.2, armR: -1.2 } },
    },
    {
      gait: { mode: 'crawl', arm: 0.5, max: 0.42 },
      head: { yaw: 0.35, pitch: 0.3, step: 6, twitch: 0.12 },
      limit: { arm: 1.05, fore: 1.2 },
      jaw: 0.6,
      sit: 0.2,
      states: {
        hunt: { lean: 0, armL: 0, armR: 0, fore: 0, jaw: 0.7 },
        lit: { lean: 0.1, armR: -1, fore: -0.9 },
        siege: { lean: -0.1, armL: -1, armR: -1, fore: -0.8 },
        scare: { lean: 0.1, armL: -1.4, armR: -1.4, fore: -0.85, headX: 0.35 },
        feast: { armL: 0, armR: 0 },
      },
    },
    {
      // It hangs in the air. Nothing steps; the jaw is the animation.
      gait: { mode: 'float' },
      head: { yaw: 0.5, pitch: 0.33, rate: 12, twitch: 0.14, eye: 0.6 },
      jaw: 1.1,
      sit: 0.6,
      states: {
        roam: { jaw: 0.12 },
        search: { jaw: 0.3, lean: 0.1 },
        hunt: { lean: 0.2, jaw: 0.5, track: 1 },
        lit: { lean: 0.1, jaw: 0.75, shake: 1, drop: 0 },
        siege: { lean: -0.2, jaw: 0.6 },
        scare: { lean: 0, headX: -0.25, jaw: 1 },
        feast: { jaw: 0.5, lean: 0 },
      },
      chains: { 1: spine },
    },
  ],
  // Stompy.
  rhino: [
    {
      gait: { max: 0.44, knee: 0.25, hipRoll: 0.065, hipYaw: 0.2, arm: 0.35 },
      head: { yaw: 0.7, pitch: 0.4 },
      limit: { arm: 1.05, out: 0.5, fore: 0.87 },
      gestures: ['wave', 'tilt'],
      sit: 0.5,
      states: { windup: { headX: 0.35, armL: 0.9, armR: 0.9 }, scare: { headX: 0.3, lean: 0.35 } },
    },
    {
      // Folded up on the floor. It hops.
      gait: { mode: 'hop', max: 0.5 },
      head: { yaw: 0.6, pitch: 0.5, step: 6, twitch: 0.12 },
      limit: { arm: 0.78, fore: 0.7 },
      sit: 0.05,
      states: {
        roam: { headZ: 0.2 },
        hunt: { lean: 0.12, armL: -0.2, armR: -0.2, fore: 0, headZ: 0.3 },
        lit: { lean: 0.2, armR: -0.75, fore: -0.6, drop: 0 },
        siege: { lean: -0.1, armL: -0.75, armR: -0.75, fore: -0.5 },
        windup: { lean: 0.3, drop: 0, armL: -0.4, armR: -0.4, legs: 0 },
        charge: { lean: 0.6, armL: -0.7, armR: -0.7, legs: 0 },
        feast: { armL: 0, armR: 0, lean: 0 },
        scare: { lean: 0.55, armL: -0.75, armR: -0.75, fore: -0.5, legs: 0 },
      },
      hook(_a, rig, ch) {
        // the spring: legs straighten as it goes
        const k = Math.max(0, 1 - ch.legs);
        rig.leg_L.rx += 0.65 * k;
        rig.leg_R.rx += 0.65 * k;
        rig.shin_L.rx -= 0.8 * k;
        rig.shin_R.rx -= 0.8 * k;
        rig.root.py += 0.35 * k;
      },
    },
    {
      // Bent over backwards into a bridge, hands and feet on the floor, with the worm standing out of its belly. It
      // scuttles (mascot.ts) and the worm does the looking. Its hands and feet stay on the floor, so every pose here
      // takes back what the shared ones do to the lean, the crouch and the arms.
      gait: { mode: 'scuttle', max: 0.42, fast: 2.6 },
      head: { yaw: 0.1, pitch: 0.1, rate: 3, neck: 0 },
      limit: { arm: 0.7, out: 0.5, fore: 0.78 },
      sit: 0,
      looker: 1,
      swayMax: 0.5,
      states: {
        roam: { ...PLANTED },
        search: { ...PLANTED, sweep: 1 },
        hunt: { ...PLANTED, track: 1, reach: 1, swivel: 1 },
        lit: { ...PLANTED, shake: 1, track: 1 },
        siege: { ...PLANTED, rear: 1 },
        // It goes still and coils, then runs at you flat out: the scuttle at its most frantic, the worm out in front.
        windup: { ...PLANTED, rear: 0, coil: 1, headX: 0, legs: 0 },
        charge: { ...PLANTED, rear: 0, lance: 1, headX: 0, track: 0, legs: 1 },
        stun: { ...PLANTED, track: 0, sway: 1, legs: 0 },
        feast: { ...PLANTED },
        scare: { ...PLANTED, rear: -1, jaw: 1 },
      },
      chains: { 1: worm, 2: ring(1.6), 3: ring(-2.3), 4: ring(3.1), 5: gullet },
      ahead: AHEAD,
    },
  ],
  // Big Biggs.
  hippo: [
    { gait: { max: 0.42, hipRoll: 0.08, hipYaw: 0.26, shift: 0.07 }, head: { yaw: 0.55, pitch: 0.3 }, gestures: ['wave', 'tilt'], sit: 0.5 },
    { gait: { max: 0.45, hipRoll: 0.09, hipYaw: 0.26, shift: 0.07 }, head: { yaw: 0.5, pitch: 0.3, step: 7, twitch: 0.1 }, jaw: 0.6, sit: 0.5 },
    {
      // Hunched, knuckles on the floor. The mask in its mouth leans out to look.
      gait: { max: 0.4, hipRoll: 0.1, hipYaw: 0.3, shift: 0.08, arm: 0.55 },
      head: { yaw: 0.5, pitch: 0.3, rate: 7, twitch: 0.12 },
      jaw: 0.7,
      sit: 0.45,
      states: {
        roam: { jaw: 0.25 },
        hunt: { lean: 0.16, jaw: 0.8, armL: 0, armR: 0, fore: 0, reach: 1 },
        lit: { lean: 0.25, armL: -0.6, armR: -0.6, fore: -0.4, jaw: 1, reach: 1, drop: 0.05 },
        scare: { lean: 0.2, jaw: 1, reach: 1, armL: -1.1, armR: -1.1 },
      },
      chains: { 1: mask },
    },
  ],
};

export const hash = (n: number): number => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

/* ---------- parts only one of them has ---------- */
// Each is (a, links, ch, dt): a the mascot (a.t its clock, a.i its index,
// a.track its motion, a.aimY/aimP where its target is), links the chain.

// Anything unclaimed hangs and trails: each link lags the one above it.
function dangle(a: Mascot, links: NonEmpty<Part>, _ch: Channels, dt: number): void {
  const tr = a.track;
  for (const l of links)
    lag(
      l,
      tr.vf * 0.05 + Math.sin(a.t * 0.9 - l.depth * 0.7 + l.seed * 20) * 0.05,
      -tr.vs * 0.05 - tr.spin * 0.03 + Math.cos(a.t * 0.7 - l.depth * 0.6 + l.seed * 30) * 0.05,
      dt,
      30,
      5,
      0.4
    );
}

// Flan's legs move like a machine with a fault: each holds still, then goes
// through a burst of hard steps, fourteen a second, and holds again.
function harvestman(a: Mascot, links: NonEmpty<Part>, ch: Channels, _dt: number): void {
  const n = links[0].seed * 97,
    slotT = a.t / 1.3 + n * 0.37,
    slot = Math.floor(slotT),
    into = slotT - slot,
    tick = Math.floor(a.t * 14);
  // Walking, or held in a beam, there is hardly a slot without a spasm.
  const busy = Math.min(1, a.track.speed * 0.4 + ch.shake + a.scareW),
    spasm = hash(slot * 5 + n) > 0.6 - busy * 0.5 && into < 0.45 + busy * 0.3;
  const reach = ch.reach * (links[0].at.y > 1.2 ? 1 : 0.3); // the upper pair come forward for you
  for (const [k, l] of links.entries()) {
    const j1 = spasm ? hash(tick + n * 13 + k * 5) - 0.5 : 0,
      j2 = spasm ? hash(tick + n * 29 + k * 3) - 0.5 : 0;
    l.rx += j1 * (0.5 - k * 0.1) - (k === 0 ? reach * 0.55 : k === 1 ? reach * 0.3 : 0);
    l.rz += j2 * 0.4;
    if (k === 0) l.ry += j2 * 0.5 - Math.sign(l.at.x) * reach * 0.5;
  }
}
// The one that no longer works: curled, and it only trembles.
function deadLeg(a: Mascot, links: NonEmpty<Part>): void {
  const tick = Math.floor(a.t * 14);
  for (const [k, l] of links.entries()) {
    l.rx += (hash(tick + 77 + k) - 0.5) * 0.05;
    l.rz += (hash(tick + 91 + k) - 0.5) * 0.04;
  }
}

// Squish's bare spine trails under it, each link later than the last.
function spine(a: Mascot, links: NonEmpty<Part>, ch: Channels, dt: number): void {
  const tr = a.track;
  for (const l of links) {
    const k = l.depth + 1;
    lag(
      l,
      tr.vf * 0.07 + Math.sin(a.t * 1.1 - k * 0.8) * 0.09 + ch.shake * (hash(Math.floor(a.t * 14) + k) - 0.5) * 0.2,
      -tr.vs * 0.07 - tr.spin * 0.05 + Math.cos(a.t * 0.8 - k * 0.7) * 0.07,
      dt,
      22 - k * 2,
      3.5,
      0.3
    );
  }
}

// Stompy's worm. A slow travelling sway and a swallowing pulse; the upper links
// turn the mouth to whoever it is looking at. Three shapes lay over that, each
// one angle per link from the belly (extra_1) to the mouth (extra_1_13), fitted
// to rhino_2's rest pivots (the worm stands up out of the arch and hooks over)
// so the mouth ends up where each one wants it:
//   COIL (the wind-up, `coil`): reared back 0.8 m over the arch and 0.15 m
//     higher, mouth level, like a cobra, swaying, then still and quivering for
//     the last of it, once the sim has stopped it turning (WINDUP.commit).
//   LANCE (the charge, `lance`): out 1 m in front, mouth level at 2 m, the way
//     the costume ran horn first.
//   SLUMP (a crash): it bounces back off the wall (BOUNCE) and folds forward,
//     the mouth hanging 0.7 m off the floor, and takes the rest of the stun to
//     lift itself back up.
// `rear` curls it back at a door, and below zero throws it at the camera for the scare.
// None of them may put the mouth through a wall: see REACH.
const COIL = [-0.15, -0.14, -0.13, -0.13, -0.13, -0.13, -0.1, -0.06, 0.01, 0.1, 0.2, 0.29, 0.34] as const,
  LANCE = [0.26, 0.42, 0.42, 0.4, 0.1, -0.17, -0.32, -0.39, -0.41, -0.4, -0.23, 0.04, 0.37] as const,
  SLUMP = [0.26, 0.42, 0.42, 0.42, 0.42, 0.26, -0.06, -0.29, -0.39, -0.39, -0.23, 0.02, 0.31] as const;
const along = (t: readonly number[], w: number): number => {
  const f = clamp(w, 0, 1) * (t.length - 1),
    i = Math.min(t.length - 2, Math.floor(f));
  return (t[i] ?? 0) + ((t[i + 1] ?? 0) - (t[i] ?? 0)) * (f - i);
};
// A crash throws the body back off the wall: this far (or as far as there is room behind it) over `time` seconds. Only
// the picture moves, the sim leaves Stompy where it hit, so once it moves off it closes the gap by `settle` of every
// metre it goes, which never has it going backwards. mascot.ts does this.
export const BOUNCE = { back: 0.9, time: 0.2, settle: 0.5 };
// The worm looking about on a hunt (`swivel`): how long it holds a look (seconds), how far it turns (radians, either
// way), pitches and cocks the mouth over, the odds a look is back on the guard, and how fast it snaps between them.
const SWIVEL = { hold: [0.25, 0.9], yaw: [0.5, 1.3], pitch: 0.3, roll: 0.5, back: 0.35, rate: 14 } as const;
// Seconds into a stun that it folds (once it has bounced) and that it starts back up, and how fast it goes down and comes up.
const FOLD = { snap: BOUNCE.time, end: 1.3, down: 10, up: 0.9 };
function worm(a: Mascot, links: NonEmpty<Part>, ch: Channels, dt: number): void {
  const n = links.length,
    rear = ch.rear,
    tk = ch.track,
    lunge = a.kLunge + a.scareBite,
    coil = ch.coil,
    lance = ch.lance;
  const down = a.st === 'stun' && a.stT > FOLD.snap && a.stT < FOLD.end ? 1 : 0;
  a.slump += (down - a.slump) * Math.min(1, dt * (down > a.slump ? FOLD.down : FOLD.up));
  const slump = a.slump;
  // Room in front: scale lance and slump back together until the worm fits, then rear it back for whatever is left.
  const room = a.room - REACH.gap,
    front = (s: number): number => along(REACH.lance, lance * s) + along(REACH.slump, slump * s) - REACH.rest - REACH.coil * coil;
  let fit = 1;
  while (fit > 0 && front(fit) > room) fit = Math.max(0, fit - 0.05);
  const lanceW = lance * fit,
    slumpW = slump * fit,
    brace = Math.min(1 - coil, Math.max(0, front(fit) - room) / REACH.coil);
  // Committed. It ramps in over a tenth of a second so the sway does not stop dead mid-swing.
  const held = a.st === 'windup' ? clamp((a.stT - (WINDUP.time - WINDUP.commit)) / 0.1, 0, 1) : 0,
    calm = Math.max(0, 1 - coil * 0.7 - lance - slump), // what is left of the idle sway and pulse
    hood = coil * (1 - held),
    tick = Math.floor(a.t * 30),
    run = a.cur.style.gait.mode === 'scuttle' ? a.walk * ch.legs : 0,
    lurch = Math.sin(TAU * a.phase);
  const sw = ch.swivel,
    look = a.look;
  if (sw > 0.01) {
    // Hunting, the worm looks about: it snaps to a new direction, holds it, and every so often snaps back to the guard.
    look.left -= dt;
    if (look.left <= 0) {
      const seed = ++look.n * 13 + a.i * 7,
        back = hash(seed) < SWIVEL.back;
      look.left = SWIVEL.hold[0] + (SWIVEL.hold[1] - SWIVEL.hold[0]) * hash(seed + 1);
      look.ty = back ? 0 : (hash(seed + 2) < 0.5 ? -1 : 1) * (SWIVEL.yaw[0] + (SWIVEL.yaw[1] - SWIVEL.yaw[0]) * hash(seed + 3));
      look.tp = back ? 0 : SWIVEL.pitch * (hash(seed + 4) * 2 - 1);
      look.tr = SWIVEL.roll * (hash(seed + 5) * 2 - 1);
    }
  }
  const snap = Math.min(1, dt * SWIVEL.rate);
  look.y += (look.ty * sw - look.y) * snap;
  look.p += (look.tp * sw - look.p) * snap;
  look.r += (look.tr * sw - look.r) * snap;
  for (const [k, l] of links.entries()) {
    const u = k / (n - 1),
      upper = Math.max(0, u - 0.45) / 0.55;
    l.rx += (Math.sin(a.t * 0.8 - k * 0.55) * 0.07 + ch.shake * (hash(Math.floor(a.t * 14) + k) - 0.5) * 0.12) * calm;
    l.rz += Math.cos(a.t * 0.6 - k * 0.5) * 0.07 * calm;
    l.s *= 1 + 0.08 * calm * Math.max(0, Math.sin(a.t * 3.5 - k * 0.8));
    // The mouth: share the turn toward the target along the upper links.
    l.ry += (a.aimY * tk * upper * 2.4) / n;
    l.rx += ((a.aimP * tk * 2.4) / n + 0.05 * tk) * upper;
    l.rx += -rear * 0.17 * upper + lunge * 0.16 * upper - a.kRecoil * 0.3 * upper;
    // The look: the upright links turn about themselves like a periscope and swing the hook round, the hook pitches,
    // and the last links cock the mouth over.
    if (k >= 2 && k <= 8) l.ry += look.y / 7;
    l.rx += look.p * upper * 0.5;
    if (k >= n - 3) l.rz += look.r / 3;
    l.rx += (COIL[k] ?? 0) * (coil + brace) + (LANCE[k] ?? 0) * lanceW + (SLUMP[k] ?? 0) * slumpW;
    // The hood sways side to side from the middle, and the top links take it back out so the mouth stays on you.
    l.rz += hood * Math.sin(a.t * 2.4 - k * 0.3) * (k >= 3 && k <= 8 ? 0.06 : k >= 10 ? -0.12 : 0);
    // Held: a fine quiver through all of it at once.
    l.rx += held * (hash(tick + k * 7) - 0.5) * 0.05;
    l.rz += held * (hash(tick + k * 11 + 3) - 0.5) * 0.05;
    // Folded: over to one side, and now and then a twitch runs through it.
    if (k >= 3 && k <= 8) l.rz += slump * 0.12 * a.side;
    if (slump > 0.3 && hash(Math.floor(a.t * 5) + a.i * 17) > 0.75) l.rx += (hash(tick + k * 5) - 0.5) * 0.12 * slump;
    // Scuttling under it: the lower links lean back into the run and the whole thing is thrown about by each step.
    if (run > 0.01) {
      if (k < 6) l.rx -= run * 0.05;
      l.rz += run * lurch * (k < 8 ? 0.05 : -0.04);
      l.rx += run * (hash(a.steps * 7 + k) - 0.5) * 0.06 * Math.sin(Math.PI * ((a.phase * 2) % 1));
    }
  }
}
// The tooth rings turn against each other, faster when it has someone. They
// spin up through the wind-up into the charge, and a crash stops them.
function ring(rate: number): ChainRun {
  return (a, links, ch, dt) => {
    const [l] = links,
      spin = 0.4 + ch.track + ch.coil * 1.5 + ch.lance * 3 + a.scareW * 4;
    l.rzSpin += rate * dt * spin * (1 - a.slump);
    l.rz += l.rzSpin;
  };
}
// The second mouth, down the throat: it comes up when the worm has you, and
// all the way out on a charge.
function gullet(a: Mascot, links: NonEmpty<Part>, ch: Channels): void {
  const out = 0.5 * ch.reach * (0.5 + 0.5 * Math.sin(a.t * 2.3)) + 0.7 * ch.lance;
  links[0].pz += 0.22 * clamp(out + a.scareBite, 0, 1);
}

// The small pale face in Biggs's mouth. It leans out to look at you, and
// keeps looking when the head turns away.
function mask(a: Mascot, links: NonEmpty<Part>, ch: Channels): void {
  const [l, ...rest] = links,
    out = Math.max(ch.reach, a.scareW);
  l.pz += 0.12 * out + Math.sin(a.t * 0.7) * 0.015;
  l.px += Math.sin(a.t * 0.4) * 0.01;
  l.ry += a.eyeY * 0.9;
  l.rx += a.eyeP * 0.9 + Math.sin(a.t * 0.9) * 0.04;
  for (const r of rest) r.ry += a.eyeY * 0.4;
}

/* ---------- assembly ---------- */

// Later layers win.
const poseOf = (...layers: (PoseLayer | undefined)[]): Channels => Object.assign({ ...ZERO }, ...layers);

// Everything mascot.ts needs to animate one mascot at one stage: see styleOf().
export interface Style {
  gait: Gait;
  head: Head;
  jaw: number;
  sit: number;
  swayMax: number;
  gestures: Gesture[];
  hook: Hook | null;
  limit: Limit;
  looker: number;
  stage: Stage;
  chains: { links: NonEmpty<Part>; run: ChainRun }[];
  ahead: number; // metres in front mascot.ts looks for a wall each frame (Mascot.room), 0 for none
  poses: Record<PoseName, Channels> & { lit: Record<LitState, Channels> };
}

export function styleOf(key: MascotKey, stage: Stage, rig: Rig): Style {
  const tuning = TUNING[key][stage],
    own = tuning.states || {},
    st = STAGE[stage];
  const pose = (name: PoseName): Channels => poseOf(BASE, st[name] || COMMON[name], own[name]),
    litPose = (name: LitState): Channels => poseOf(BASE, st[name], own[name], st.lit, own.lit);
  return {
    gait: { ...GAIT, ...tuning.gait },
    head: { ...HEAD, twitch: stage ? 0.1 : 0, ...tuning.head },
    jaw: tuning.jaw ?? 0.5,
    sit: tuning.sit ?? 0.5,
    swayMax: tuning.swayMax ?? 0.35,
    gestures: tuning.gestures || [],
    hook: tuning.hook || null,
    limit: { ...LIMIT, ...tuning.limit },
    looker: tuning.looker ?? 0,
    stage,
    chains: Object.entries(rig.chains).map(([n, links]) => ({ links, run: tuning.chains?.[n] || dangle })),
    ahead: tuning.ahead ?? 0,
    poses: {
      rest: pose('rest'),
      roam: pose('roam'),
      search: pose('search'),
      hunt: pose('hunt'),
      siege: pose('siege'),
      windup: pose('windup'),
      charge: pose('charge'),
      stun: pose('stun'),
      feast: pose('feast'),
      scare: pose('scare'),
      lit: { roam: litPose('roam'), search: litPose('search'), hunt: litPose('hunt') },
    },
  };
}

/* ---------- the stand-in ---------- */
// Shown until a mascot's model has loaded, and for good if it never does: the
// same named parts as a real one, so it moves by the same rules.

const GEO = {
  hips: new THREE.SphereGeometry(0.55, 16, 12).scale(1.75, 0.85, 1.3),
  chest: new THREE.CapsuleGeometry(0.5, 0.5, 6, 14),
  head: new THREE.SphereGeometry(0.42, 16, 12),
  jaw: new THREE.BoxGeometry(0.5, 0.1, 0.4).translate(0, -0.05, 0.2),
  eye: new THREE.SphereGeometry(0.075, 10, 8),
  glint: new THREE.SphereGeometry(0.03, 6, 4).translate(0, 0, 0.06),
  limb: new THREE.CapsuleGeometry(0.13, 0.3, 4, 8).translate(0, -0.22, 0),
  thigh: new THREE.CapsuleGeometry(0.2, 0.2, 4, 8).translate(0, -0.2, 0),
  foot: new THREE.BoxGeometry(0.3, 0.12, 0.5).translate(0, -0.39, 0.1),
};
const GLINT = new THREE.MeshBasicMaterial({ color: EYE_PALE, fog: false });

export function standIn(def: MascotKind): THREE.Object3D {
  const mat = new THREE.MeshStandardMaterial({ color: def.col, roughness: 1 }),
    dark = new THREE.MeshStandardMaterial({ color: 0x08080e, roughness: 1 });
  // x, y, z: where the part's pivot is in the model's space.
  const node = (
    name: string,
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    ...meshes: [geo: THREE.BufferGeometry, material: THREE.Material, x?: number, y?: number, z?: number][]
  ): THREE.Object3D => {
    const o = new THREE.Object3D();
    o.name = name;
    parent.updateWorldMatrix(true, false);
    o.position.set(x, y, z).sub(new THREE.Vector3().setFromMatrixPosition(parent.matrixWorld));
    parent.add(o);
    for (const [geo, m, mx = 0, my = 0, mz = 0] of meshes) {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(mx, my, mz);
      mesh.castShadow = m !== GLINT;
      mesh.userData.glow = m === GLINT;
      o.add(mesh);
    }
    return o;
  };
  const root = new THREE.Object3D();
  root.name = 'root';
  const body = node('body', root, 0, 0.95, 0, [GEO.hips, mat, 0, 0, -0.1], [GEO.chest, mat, 0, 0.55, 0]);
  const head = node('head', body, 0, 1.85, 0, [GEO.head, mat, 0, 0.25, 0.05]);
  node('jaw', head, 0, 1.95, 0.1, [GEO.jaw, dark]);
  for (const [s, sx] of [
    ['L', 1],
    ['R', -1],
  ] as const) {
    node(`eye_${s}`, head, sx * 0.17, 2.2, 0.4, [GEO.eye, dark], [GEO.glint, GLINT]);
    node(`forearm_${s}`, node(`arm_${s}`, body, sx * 0.62, 1.65, 0, [GEO.limb, mat]), sx * 0.62, 1.2, 0, [GEO.limb, mat]);
    node(`shin_${s}`, node(`leg_${s}`, body, sx * 0.4, 0.85, 0, [GEO.thigh, mat]), sx * 0.4, 0.45, 0, [GEO.limb, mat], [GEO.foot, mat]);
  }
  return root;
}
