// One mascot: its models for the three rot stages, where it is, and the layers
// of procedural animation that pose its parts each frame. Nothing here is
// keyframed. In order: the gait (driven by the distance actually covered, so
// feet stay where they land), the pose of its state (styles.ts), its head and
// eyes, the things particular to it, whatever hangs off it, then feet planted.

import { lightsF } from '@thick-shift/sim';
import { isPlaced } from '@thick-shift/sim/check';
import type { MascotKind } from '@thick-shift/sim/config';
import { MASC } from '@thick-shift/sim/config';
import { angDiff, dist, EYE, glimpses, MASCOT_R, walkable } from '@thick-shift/sim/map';
import type { MascotIndex, MascotState, Mascot as SimMascot, State } from '@thick-shift/sim/types';
import * as THREE from 'three';
import type { View } from '../actors';
import type { ModelStage } from '../assets';
import { EYE_PALE, instance, loadActor, loadJSON } from '../assets';
import type { Part, Rig } from './rig';
import { bounds, buildRig, eachMesh, glowTexture, lag } from './rig';
import type { Gait, PerStage, Stage, Style } from './styles';
import { BOUNCE, CH, hash, isLitState, isStage, RATE, standIn, styleOf, ZERO } from './styles';
import { nightClock, TAU, Track } from './track';

const { clamp } = THREE.MathUtils,
  smooth = (u: number): number => THREE.MathUtils.smoothstep(u, 0, 1);
// Rises over `up` of the span, holds, and falls over the last `down`.
const bump = (u: number, up: number, down: number): number => smooth(u / up) * smooth((1 - u) / down);
// Where a foot is through the walk cycle, from -1 (as far ahead as it lands) to 1 (as far behind as it lifts): the
// first half on the ground going back at a steady rate, which is ground speed, the second half swinging forward.
const footAt = (q: number): number => (q < 0.5 ? q * 4 - 1 : Math.cos(Math.PI * (q * 2 - 1)));

// How far it is from (x, z) to a wall or shut door straight ahead, to the nearest ROOM_STEP and short of it, or
// Infinity if there is none within max. Furniture does not count: what reaches over it is above it.
const ROOM_STEP = 0.05;
function clearAhead(x: number, z: number, yaw: number, max: number, doors: State['doors']): number {
  const sx = Math.sin(yaw),
    sz = Math.cos(yaw);
  for (let d = ROOM_STEP; d <= max; d += ROOM_STEP) if (!walkable(x + sx * d, z + sz * d, 0.02, doors, true)) return d - ROOM_STEP;
  return Infinity;
}

// The scuttle, Stompy's bridge on hands and feet. rate: gait cycles a second at a standstill, more for each metre a
// second, and the most it manages (two steps a cycle, so a charge is some 14 steps a second). splay: how far a limb
// in the air swings out. jerk: the spasm through every limb as it goes, and the tremble when it stands. buckle: the
// share of steps on which a planted limb gives way under it.
const SCUTTLE = { rate: [1.6, 1.2, 7], splay: 0.3, jerk: [0.12, 0.025], buckle: 0.22 } as const;
// Diagonal pairs, arm_L with leg_R, then arm_R with leg_L: the pair in the air swings forward and out while the
// planted pair shoves back. No two steps are the same size, everything spasms, now and then a limb buckles and drops
// it onto that side, and the broken head is flung about on its neck. It is not in control of any of it.
function scuttle(a: Mascot, rig: Rig, g: Gait, wk: number, dt: number): void {
  const n = a.steps * 5 + a.i * 31,
    q = (a.phase * 2) % 1, // through this step
    env = Math.sin(Math.PI * q), // 0 at each footfall, so nothing below pops between steps
    first = a.phase < 0.5, // arm_L and leg_R are the pair in the air
    amp = g.max * (0.6 + 0.9 * hash(n)) * wk,
    air = amp * Math.cos(Math.PI * q), // from back (+) to front (-)
    lift = env * wk * (0.7 + 0.6 * hash(n + 1));
  const [aL, aR] = first ? [air, -air] : [-air, air], // arm_L with leg_R, arm_R with leg_L
    [upA, upB] = first ? [lift, 0] : [0, lift];
  rig.arm_L.rx += aL;
  rig.leg_R.rx += aL;
  rig.arm_R.rx += aR;
  rig.leg_L.rx += aR;
  rig.arm_L.rz += SCUTTLE.splay * upA;
  rig.leg_R.rz -= SCUTTLE.splay * upA;
  rig.arm_R.rz -= SCUTTLE.splay * upB;
  rig.leg_L.rz += SCUTTLE.splay * upB;
  rig.forearm_L.rx -= 0.45 * upA;
  rig.forearm_R.rx -= 0.45 * upB;
  rig.shin_R.rx += 0.45 * upA;
  rig.shin_L.rx += 0.45 * upB;
  // The body is thrown onto the planted pair, bobs, and lurches a different way every step.
  const body = rig.body;
  body.rz += 0.12 * Math.sin(TAU * a.phase) * wk * (0.6 + 0.8 * hash(n + 2));
  body.ry += (hash(n + 3) - 0.5) * 0.35 * env * wk;
  body.rx += (hash(n + 4) - 0.5) * 0.12 * env * wk;
  body.py += 0.05 * lift;
  // A planted limb gives way: its forearm or shin folds and the arch drops onto that side, then it scrambles up.
  if (hash(n + 5) < SCUTTLE.buckle * wk) {
    const left = hash(n + 6) < 0.5,
      give = env * wk;
    if (hash(n + 7) < 0.5) (left ? rig.forearm_L : rig.forearm_R).rx += 0.7 * give;
    else (left ? rig.shin_L : rig.shin_R).rx += 0.7 * give;
    body.rz += (left ? -0.16 : 0.16) * give;
    body.py -= 0.09 * give;
  }
  // The spasm, stepped like the shudder; standing, it only trembles, as if the arms might give.
  const tick = Math.floor(a.t * 18) + a.i * 50,
    jerk = SCUTTLE.jerk[0] * wk + SCUTTLE.jerk[1];
  for (const [j, l] of [rig.arm_L, rig.arm_R, rig.forearm_L, rig.forearm_R, rig.leg_L, rig.leg_R, rig.shin_L, rig.shin_R].entries()) {
    l.rx += (hash(tick * 1.3 + j * 7) - 0.5) * jerk;
    l.rz += (hash(tick * 1.7 + j * 11) - 0.5) * jerk * 0.5;
  }
  body.py += Math.sin(a.t * 1.7) * 0.012 * (1 - wk);
  // The head on its snapped neck: each step flings it somewhere new, and a loose spring overshoots getting there.
  const fling = 0.9 * wk;
  lag(rig.neck, (hash(n + 8) - 0.5) * fling * 0.5 + Math.sin(a.t * 1.1) * 0.05, (hash(n + 9) - 0.5) * fling * 0.5, dt, 70, 3, 0.35);
  lag(rig.head, (hash(n + 10) - 0.5) * fling + Math.sin(a.t * 1.3) * 0.08, (hash(n + 11) - 0.5) * fling, dt, 90, 3.5, 0.6);
}

const SEEN_RANGE = 46; // metres: past this the fog has it anyway
const LOOK_EVERY = 0.2; // seconds between checks of whether the camera can see it
const STEP_HZ = 14; // shudders and spasms change this often and hold in between, like stop motion
const SEAT_LOCAL = 0.8,
  SEAT_OTHER = 0.3; // metres from a flattened guard's middle to where it sits: on them, but in view of the one underneath

// One soft point, drawn over every eye_glow so the eyes still read as two
// pale points when the head is twenty metres away and three pixels wide.
let haloTex: THREE.CanvasTexture | undefined;
function haloTexture(): THREE.CanvasTexture {
  haloTex ??= glowTexture(0.25, '255,255,255', 0.55);
  return haloTex;
}
const HALO_SIZE: PerStage<number> = [0.1, 0.085, 0.05],
  HALO_FLOOR = 0.0035; // metres across by stage (pinpricks at 2), and the least it may subtend, as a fraction of its distance
const MAX_HALOS = 12,
  HALO_NEAR = 2.5; // metres: no points inside this, all of them by twice it

const v = new THREE.Vector3(),
  box = new THREE.Box3();

// One model, made ready to animate (Mascot.fit): its rig and style, the halo sprites over its eye_glows and their
// material, the part that carries the face and where the face is in that part's space, its rot stage, whether it is
// a real model (not the stand-in), and how tall it is.
interface Fitted {
  model: THREE.Object3D;
  rig: Rig;
  style: Style;
  halos: THREE.Sprite[];
  haloMat: THREE.SpriteMaterial;
  carrier: Part;
  facePoint: THREE.Vector3;
  stage: Stage;
  real: boolean;
  height: number;
}

export class Mascot {
  i: MascotIndex;
  def: MascotKind;
  renderer: THREE.WebGLRenderer;
  group = new THREE.Group();
  pivot = new THREE.Group();
  track = new Track();
  ch = { ...ZERO };
  cv = { ...ZERO };
  fits: [Fitted | null, Fitted | null, Fitted | null] = [null, null, null];
  asked = [false, false, false];
  cur: Fitted;
  onScreen = new THREE.Sphere();
  // Its own clock, and one that stops when a beam freezes it.
  t: number;
  gt: number;
  phase: number;
  steps = 0; // half-cycles of the gait so far, to seed what changes step to step
  walk = 0;
  live = 1;
  hop = 0;
  st: MascotState = 'rest';
  stT = 0; // seconds in st, since this client saw it change
  slump = 0; // Stompy's worm folded over after a crash, 0 to 1 (styles.ts's worm keeps it)
  knock = { x: 0, z: 0, far: 0, d: 0 }; // bounced back off a wall, see BOUNCE: which way, how far it goes, how far it is now
  look = { y: 0, p: 0, r: 0, ty: 0, tp: 0, tr: 0, left: 0, n: 0 }; // the worm looking about on a hunt (styles.ts)
  room = Infinity; // metres clear in front of it, out to style.ahead (Infinity past that), so the worm keeps out of walls
  lit = false;
  seen = true;
  lookT: number;
  dist = 0;
  lookY = 0;
  lookP = 0;
  lookVY = 0;
  beat = -1;
  offY = 0;
  offP = 0;
  side = 1;
  aimY = 0;
  aimP = 0;
  eyeY = 0;
  eyeP = 0;
  // Kicks: set to 1 by an event, and they die away. Each adds a fast move on top of the pose.
  kLunge = 0;
  kSlam = 0;
  kLand = 0;
  kFlare = 0;
  kRecoil = 0;
  kSpot = 0;
  seat = { on: false, x: 0, z: 0, yaw: 0, w: 0, v: 0, turn: 0 };
  scareOn = false;
  scareW = 0;
  scareBite = 0;
  face = new THREE.Vector3(); // where its face is in the world, for the jumpscare
  constructor(scene: THREE.Scene, i: MascotIndex, renderer: THREE.WebGLRenderer) {
    this.i = i;
    this.def = MASC[i];
    this.renderer = renderer;
    this.group.add(this.pivot);
    scene.add(this.group);
    this.cur = this.fit(standIn(this.def), 0, undefined, false);
    this.pivot.add(this.cur.model);
    this.t = i * 7.3;
    this.gt = i * 3.1;
    this.phase = i * 0.37;
    this.lookT = i * 0.05;
    this.load(0);
  }

  /* ---------- models ---------- */

  // stage: the rot stage wanted; past the last there is nothing to load.
  load(stage: number): void {
    if (!isStage(stage) || this.asked[stage]) return;
    this.asked[stage] = true;
    Promise.all([loadActor(`${this.def.k}_${stage}`), loadJSON(this.def.k)]).then(([src, info]) => {
      if (!src) return; // the stand-in, or the stage before, carries on
      const fit = this.fit(instance(src), stage, info?.stages?.[stage], true);
      this.fits[stage] = fit;
      // Textures go to the GPU now, not in the frame the stage first shows.
      // GLTFLoader gives standard (or physical) materials; the eye_glows have basic ones (assets.ts).
      eachMesh(fit.model, ({ material: m }) => {
        const maps =
          m instanceof THREE.MeshStandardMaterial ? [m.map, m.normalMap, m.roughnessMap, m.emissiveMap] : m instanceof THREE.MeshBasicMaterial ? [m.map] : [];
        for (const tex of maps) if (tex) this.renderer.initTexture(tex);
      });
    });
  }

  fit(model: THREE.Object3D, stage: Stage, info: ModelStage | undefined, real: boolean): Fitted {
    const rig = buildRig(model),
      style = styleOf(this.def.k, stage, rig);
    const haloMat = new THREE.SpriteMaterial({ map: haloTexture(), color: EYE_PALE, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const halos: THREE.Sprite[] = [];
    // Only the stand-in's glints and the eye_glow meshes carry userData.glow. The halo hangs from the glint's parent,
    // so a glint at the root (there are none) would get no halo.
    eachMesh(model, o => {
      const parent = o.parent;
      if (!o.userData.glow || !parent || halos.length >= MAX_HALOS) return;
      // Sit the point just proud of the glint, on the side away from the eyeball's centre.
      bounds(o.geometry).getCenter(v).add(o.position);
      const len = v.length(),
        s = new THREE.Sprite(haloMat);
      if (len > 0.005) v.multiplyScalar(1 + 0.02 / len);
      else v.set(0, 0, 0.03);
      s.position.copy(v);
      parent.add(s);
      halos.push(s);
    });
    // The face: the manifest gives it in model space; keep it in the space of the part that carries it.
    const carrier = rig.chains[style.looker]?.at(-1) ?? (rig.has.head ? rig.head : rig.body);
    const facePoint = new THREE.Vector3(...(info?.face || [0, rig.headH + 0.25, 0.45]));
    model.updateWorldMatrix(true, true);
    carrier.o.worldToLocal(model.localToWorld(facePoint));
    box.setFromObject(model);
    return { model, rig, style, halos, haloMat, carrier, facePoint, stage, real, height: info?.height || box.max.y };
  }

  show(fit: Fitted): void {
    this.pivot.remove(this.cur.model);
    this.pivot.add(fit.model);
    for (const p of fit.rig.list) {
      p.ax = p.az = p.vx = p.vz = 0;
    }
    this.cur = fit;
    this.load(fit.stage + 1);
  }

  // Follow m.rot to the next model, but only while this screen cannot see it: it changes behind your back.
  stage(rot: number, hidden: boolean): void {
    const want = isStage(rot) ? this.fits[rot] : null;
    if (want && want !== this.cur && (hidden || !this.cur.real)) this.show(want);
  }

  /* ---------- events ---------- */

  // The guard it caught is at (x, z): it turns to them and sits. mine: the guard is the one watching.
  sitOn(x: number, z: number, mine: boolean): void {
    const s = this.seat,
      tr = this.track,
      dx = tr.x - x,
      dz = tr.z - z,
      d = Math.hypot(dx, dz) || 1,
      off = mine ? SEAT_LOCAL : SEAT_OTHER;
    s.on = true;
    s.x = x + (dx / d) * off;
    s.z = z + (dz / d) * off;
    s.yaw = Math.atan2(-dx, -dz);
  }
  bang(): void {
    this.kSlam = 1;
  }
  crash(): void {
    this.kRecoil = 1;
  }
  spotted(): void {
    this.kSpot = 1;
  }
  // lookT = 0: it may have jumped home, so ask again next frame whether it can be seen.
  reset(): void {
    this.track.n = 0;
    this.lookT = 0;
    this.seat.on = false;
    this.seat.w = this.seat.turn = 0;
    this.scareOn = false;
    this.scareW = 0;
    this.scareBite = 0;
    this.slump = 0;
    this.knock.d = 0;
    Object.assign(this.ch, ZERO);
    Object.assign(this.cv, ZERO);
  }

  /* ---------- the frame ---------- */

  // view: { x, y, z } of the camera, id of the guard watching, flat (they are on the floor).
  sync(m: SimMascot, S: State, dt: number, view: View): void {
    const tr = this.track,
      st = m.st;
    if (nightClock.fresh) tr.push(S.t, m.x, m.z, m.yaw);
    tr.sample(nightClock.now, dt);
    this.load(m.rot);
    const litSt = m.lit && isLitState(st) ? st : null,
      lit = litSt !== null;

    // Can the camera see any of it? Only walls and shut doors count: sees() also stops at furniture, which is the
    // sim's rule for hiding, but a table hides none of a mascot from the eye. Lines across its whole width, close
    // enough together that one half in view past a door jamb is not hidden with the rest.
    this.dist = dist(tr, view);
    this.lookT -= dt;
    if (this.lookT <= 0) {
      this.lookT = LOOK_EVERY;
      const d = this.dist;
      this.seen = d < SEEN_RANGE && (d < 3 || this.scareOn || glimpses(view.x, view.z, tr.x, tr.z, MASCOT_R, S.doors));
    }
    // Hidden for a swap: a wall is in the way, or it is off the edge of the picture (a generous sphere round it, so
    // nothing changes at the edge of the screen). Dark does not count: its eyes still show.
    const sph = this.onScreen;
    sph.center.set(tr.x, this.cur.height / 2, tr.z);
    sph.radius = this.cur.height * 0.6 + 0.6;
    this.stage(m.rot, !this.seen || !view.frustum.intersectsSphere(sph));
    const fit = this.cur,
      rig = fit.rig,
      style = fit.style,
      ch = this.ch,
      cv = this.cv;

    // What changed since the last frame.
    if (this.lit && !lit && st === 'hunt') {
      this.kLunge = 1;
      this.kFlare = 1;
    } // the light went off it
    if (st !== this.st) {
      if (st === 'feast') this.kLand = 1;
      else if (this.st === 'feast') this.seat.on = false;
      if (st === 'charge') this.kLunge = 1;
      if (st === 'stun' && this.st === 'charge' && this.cur.style.ahead) {
        const k = this.knock,
          behind = clearAhead(tr.x, tr.z, tr.yaw + Math.PI, BOUNCE.back + MASCOT_R, S.doors);
        k.x = -Math.sin(tr.yaw);
        k.z = -Math.cos(tr.yaw);
        k.far = clamp(behind - MASCOT_R, 0, BOUNCE.back);
      }
      this.st = st;
      this.stT = 0;
    } else this.stT += dt;
    this.lit = lit;
    const decay = Math.exp(-dt * 5);
    this.kLunge *= Math.exp(-dt * 3);
    this.kSlam *= decay;
    this.kLand *= decay;
    this.kFlare *= Math.exp(-dt * 2);
    this.kRecoil *= Math.exp(-dt * 2.5);
    this.kSpot *= decay;

    // Channels spring toward the pose of the state (critically damped, so they neither pop nor ring).
    const pose = this.scareOn ? style.poses.scare : litSt ? style.poses.lit[litSt] : style.poses[st];
    for (const k of CH) {
      const w = RATE[k],
        d = ch[k] - pose[k],
        tmp = (cv[k] + w * d) * dt,
        e = Math.exp(-w * dt);
      cv[k] = (cv[k] - w * tmp) * e;
      ch[k] = pose[k] + (d + tmp) * e;
    }
    // It turns to the guard it caught at once, and goes and sits on them when the catch lets go.
    const seat = this.seat,
      sw = seat.on && st === 'feast' && !this.scareOn ? 1 : 0;
    seat.turn += ((seat.on && (st === 'feast' || this.scareOn) ? 1 : 0) - seat.turn) * Math.min(1, dt * 10);
    {
      const w = 9,
        d = seat.w - sw,
        tmp = (seat.v + w * d) * dt,
        e = Math.exp(-w * dt);
      seat.v = (seat.v - w * tmp) * e;
      seat.w = sw + (d + tmp) * e;
    }
    this.scareW += ((this.scareOn ? 1 : 0) - this.scareW) * Math.min(1, dt * 12);

    // Clocks. A beam stops a stage 0 costume dead: mid-wave, if it was waving.
    const frozen = lit && style.stage === 0;
    this.t += dt;
    if (!frozen) this.gt += dt;
    // Stage 0 standing still is still. It goes on too long.
    this.live += ((style.stage > 0 || tr.speed > 0.05 ? 1 : 0) - this.live) * Math.min(1, dt * (tr.speed > 0.05 ? 4 : 0.6));

    // The gait's phase runs on distance whether or not anyone is looking.
    const g = style.gait,
      h = rig.hipH,
      moving = tr.speed > 0.08;
    this.walk += ((moving ? 1 : 0) - this.walk) * Math.min(1, dt * 7);
    // A step is as long as the leg swings plus as far as the hips turn: with hips this wide, the turn is a third of it.
    const pace = clamp(tr.speed / g.fast, 0, 1),
      A = g.min + (g.max - g.min) * pace,
      twistMax = g.mode === 'walk' ? g.hipYaw * (0.75 + 0.5 * pace) : 0;
    const reach = h * Math.sin(A) + rig.hipX * Math.sin(twistMax); // how far ahead of the body a foot lands, and how far behind it lifts
    const was = this.phase;
    if (g.mode === 'scuttle') {
      // Its limbs run on their own clock, faster than the ground goes by, and no two steps take as long: it scrabbles.
      const rate = clamp(SCUTTLE.rate[0] + SCUTTLE.rate[1] * tr.speed, 0, SCUTTLE.rate[2]) * (0.6 + 0.8 * hash(this.steps * 3 + this.i));
      this.phase = (this.phase + dt * rate * this.walk) % 1;
    } else this.phase = (this.phase + (tr.moved * Math.sign(tr.vf || 1)) / (4 * reach) + 1) % 1;
    if (Math.floor(this.phase * 2) !== Math.floor(was * 2)) this.steps++;

    const k = this.knock;
    if (st === 'stun' && k.far) k.d = k.far * (1 - (1 - Math.min(1, this.stT / BOUNCE.time)) ** 2);
    else {
      k.far = 0;
      k.d = Math.max(0, k.d - tr.moved * BOUNCE.settle);
    }
    const x = tr.x + (seat.x - tr.x) * seat.w + k.x * k.d,
      z = tr.z + (seat.z - tr.z) * seat.w + k.z * k.d,
      yaw = tr.yaw + angDiff(seat.yaw, tr.yaw) * seat.turn;
    this.group.position.set(x, 0, z);
    this.group.rotation.y = yaw;
    this.group.visible = this.seen;
    if (!this.seen) return;
    this.room = style.ahead ? clearAhead(x, z, yaw, style.ahead, S.doors) : Infinity;

    /* gait */
    const p = this.phase,
      wk = this.walk * ch.legs,
      s2 = Math.sin(TAU * p),
      c2 = Math.cos(TAU * p),
      body = rig.body,
      root = rig.root;
    let footL = 0,
      footR = 0; // how far behind the body's middle each foot is, over the leg's length
    if (g.mode === 'walk') {
      const qL = p,
        qR = (p + 0.5) % 1;
      footL = ((footAt(qL) * reach) / h) * wk;
      footR = ((footAt(qR) * reach) / h) * wk;
      rig.shin_L.rx += g.knee * Math.max(0, -Math.sin(TAU * qL)) * wk;
      rig.shin_R.rx += g.knee * Math.max(0, -Math.sin(TAU * qR)) * wk;
      // The joke is in the title. The hips roll onto the standing leg and swing the far side forward, and everything above goes with them.
      body.rz -= g.hipRoll * s2 * wk;
      body.ry -= twistMax * c2 * wk;
      body.px += g.shift * s2 * wk;
      const arm = g.arm * c2 * wk;
      rig.arm_L.rx += arm;
      rig.arm_R.rx -= arm;
      rig.forearm_L.rx -= Math.abs(arm) * 0.4;
      rig.forearm_R.rx -= Math.abs(arm) * 0.4;
    } else if (g.mode === 'float') {
      // Nothing to stand on. It bobs, drifts, and tips into its own movement.
      root.py += Math.sin(this.t * 1.2) * 0.07 + Math.sin(this.t * 0.53) * 0.03;
      root.px += Math.sin(this.t * 0.37) * 0.05;
      body.rx += clamp(tr.vf * 0.06, -0.3, 0.3);
      body.rz += clamp(-tr.vs * 0.06 - tr.spin * 0.05, -0.3, 0.3) + Math.sin(this.t * 0.8) * 0.03;
    } else if (g.mode === 'crawl') {
      // On all fours with the thighs out sideways: opposite hand and foot go together.
      const a1 = g.max * s2 * wk,
        lift = Math.max(0, c2) * wk,
        lift2 = Math.max(0, -c2) * wk;
      rig.leg_L.ry += a1 * 0.6;
      rig.leg_R.ry += a1 * 0.6;
      rig.shin_L.rx += lift * 0.5;
      rig.shin_R.rx += lift2 * 0.5;
      rig.arm_L.rx -= a1 * g.arm;
      rig.arm_R.rx += a1 * g.arm;
      rig.forearm_L.rx -= lift2 * 0.7;
      rig.forearm_R.rx -= lift * 0.7;
      body.rz += 0.05 * s2 * wk;
      body.ry += 0.1 * c2 * wk;
      body.py += Math.abs(s2) * 0.03 * wk;
      rig.head.rx += 0.06 * Math.sin(TAU * p * 2 - 1) * wk;
    } else if (g.mode === 'hop') {
      // Arms reach and plant, the body pitches over them, the legs snap shut behind. Twice a cycle.
      const q = (p * 2) % 1,
        reach = bump(q, 0.35, 0.4) * wk,
        pull = smooth((q - 0.45) / 0.3) * (1 - smooth((q - 0.8) / 0.2)) * wk;
      rig.arm_L.rx -= 0.5 * reach;
      rig.arm_R.rx -= 0.5 * reach;
      rig.forearm_L.rx += 0.35 * reach;
      rig.forearm_R.rx += 0.35 * reach;
      body.rx += 0.26 * reach;
      root.py += 0.16 * pull;
      rig.leg_L.rx -= 0.25 * pull;
      rig.leg_R.rx -= 0.25 * pull;
      rig.shin_L.rx += 0.4 * pull;
      rig.shin_R.rx += 0.4 * pull;
    } else if (g.mode === 'scuttle') scuttle(this, rig, g, wk, dt);

    /* idle: breath and shifting weight */
    const alive = this.live,
      br = ch.breath * alive,
      swy = ch.sway * alive;
    body.s *= 1 + 0.012 * br * Math.sin(this.gt * 1.6);
    if (g.mode !== 'float' && g.mode !== 'glide') {
      body.rz += 0.018 * swy * Math.sin(this.gt * 0.47);
      body.px += 0.02 * swy * Math.sin(this.gt * 0.47);
      body.rx += 0.01 * swy * Math.sin(this.gt * 0.31 + 1);
    }

    /* the pose */
    const slam = this.kSlam,
      recoil = this.kRecoil,
      land = this.kLand,
      lunge = this.kLunge;
    body.rx += ch.lean + slam * 0.45 - recoil * 0.5 + lunge * 0.22;
    root.pz += slam * 0.3 - recoil * 0.25 + lunge * 0.25 + this.scareBite * 0.15;
    const jawMove = ch.jaw + lunge * 0.6 + slam * 0.5;
    rig.jaw.rx += clamp(jawMove, 0, 1.15) * style.jaw;
    const armUp = slam * 1.3; // the arms come down with the hit
    rig.arm_L.rx += ch.armL + armUp;
    rig.arm_R.rx += ch.armR + armUp;
    rig.arm_L.rz += ch.out;
    rig.arm_R.rz -= ch.out;
    rig.forearm_L.rx += ch.fore;
    rig.forearm_R.rx += ch.fore;
    // Sitting: the rear comes down hard and the legs go out in front.
    const sit = ch.sit;
    // It settles its weight, and bounces a little. A floater comes down to hover on them.
    const drop =
      g.mode === 'float' ? sit * (fit.height * 0.3 + Math.sin(this.t * 2.2) * 0.04) : sit * (h * style.sit - Math.abs(Math.sin(this.t * 2.2)) * 0.04);
    // A crouch needs knees. Without shins the legs cannot shorten, so it stays up.
    const crouch = rig.has.shin_L ? clamp(ch.drop, 0, h * 0.4) : 0,
      bend = Math.acos(1 - crouch / h);
    root.py -= drop + crouch;
    // The shudder: stepped noise, held between steps.
    const tick = Math.floor(this.t * STEP_HZ) + this.i * 50,
      shake = ch.shake + lunge * 0.6 + this.kSpot * 0.5;
    if (shake > 0.01) {
      body.rz += shake * 0.035 * (hash(tick) - 0.5);
      body.rx += shake * 0.03 * (hash(tick + 0.3) - 0.5);
      body.ry += shake * 0.04 * (hash(tick + 0.6) - 0.5);
      rig.arm_L.rx += shake * 0.16 * (hash(tick + 1) - 0.5);
      rig.arm_R.rx += shake * 0.16 * (hash(tick + 2) - 0.5);
      rig.head.rz += shake * 0.1 * (hash(tick + 3) - 0.5);
    }
    const slack = ch.slack;
    if (slack > 0.01) {
      // Hung, not standing: the head lolls and the arms swing a beat late.
      rig.head.rz += slack * 0.12 * Math.sin(this.t * 1.3);
      rig.head.rx += slack * 0.08 * Math.sin(this.t * 0.9 + 1);
      if (st === 'stun') {
        lag(rig.arm_L, tr.vf * 0.12 + Math.sin(this.t * 1.1) * 0.04, -tr.spin * 0.08, dt, 18, 2.5, 0.7);
        lag(rig.arm_R, tr.vf * 0.12 + Math.sin(this.t * 1.1 + 2) * 0.04, -tr.spin * 0.08, dt, 16, 2.5, 0.7);
      }
    }

    /* gestures: the small things it does between everything else */
    const up = st === 'roam' || st === 'search' || st === 'hunt';
    if (style.stage === 0 && up && style.gestures.length) {
      const span = 5.5,
        gb = Math.floor(this.gt / span),
        u = this.gt / span - gb,
        r = hash(gb * 1.7 + this.i * 31);
      if (r > 0.45) {
        const kind = style.gestures[Math.floor(hash(gb + this.i) * style.gestures.length)];
        if (kind === 'wave') {
          const e = bump(clamp(u / 0.55, 0, 1), 0.2, 0.25);
          rig.arm_R.rx -= 2.5 * e;
          rig.arm_R.rz -= 0.35 * e;
          rig.forearm_R.rx -= 0.3 * e;
          rig.forearm_R.rz += Math.sin(this.gt * 8) * 0.4 * e;
        } else if (kind === 'hug') {
          const e = bump(clamp(u / 0.7, 0, 1), 0.25, 0.25);
          rig.arm_L.rx -= 0.7 * e;
          rig.arm_R.rx -= 0.7 * e;
          rig.arm_L.rz += 0.5 * e;
          rig.arm_R.rz -= 0.5 * e;
          rig.forearm_L.rx -= 0.5 * e;
          rig.forearm_R.rx -= 0.5 * e;
        } else rig.head.rz += 0.28 * bump(clamp(u / 0.8, 0, 1), 0.1, 0.1) * (r > 0.7 ? 1 : -1); // a tilt, held
      }
    } else if (style.stage === 1 && st !== 'rest') {
      // The jaw works on nothing, in bursts.
      const jb = Math.floor(this.gt * 0.7 + this.i);
      if (hash(jb * 3.1) > 0.45) rig.jaw.rx += style.jaw * 0.5 * Math.max(0, Math.sin(this.gt * 12));
    }

    /* head and eyes */
    // Who it is looking at: whoever is closest and standing. From the floor, you see it looking at someone else.
    let tx = view.x,
      ty = view.y,
      tz = view.z,
      best = view.flat && !this.scareOn && !seat.w ? 1e9 : this.dist;
    for (const q of S.players) {
      if (!isPlaced(q) || q.flat || q.id === view.id) continue;
      const d = Math.hypot(q.x - x, q.z - z);
      if (d < best) {
        best = d;
        tx = q.x;
        ty = EYE;
        tz = q.z;
      }
    }
    const hs = style.head,
      dx = tx - x,
      dz = tz - z,
      sin = Math.sin(yaw),
      cos = Math.cos(yaw),
      lz = dx * sin + dz * cos,
      lx = dx * cos - dz * sin,
      flat = Math.hypot(lx, lz);
    const headY0 = (style.looker ? fit.height * 0.9 : rig.headH + 0.25) + root.py;
    const aimY = Math.atan2(lx, lz),
      aimP = Math.atan2(headY0 - ty, Math.max(flat, 0.3));
    this.aimY = clamp(aimY, -1.4, 1.4);
    this.aimP = clamp(aimP, -0.8, 1);
    // Mostly locked on you. Sometimes, for a beat, somewhere else entirely.
    const lb = Math.floor(this.t * 1.3 + this.i * 9);
    if (lb !== this.beat) {
      this.beat = lb;
      const away = hash(lb + this.i * 31) > 1 - hs.twitch;
      this.offY = away ? (hash(lb) * 2 - 1) * 0.9 : 0;
      this.offP = away ? (hash(lb + 7) * 2 - 1) * 0.3 : 0;
      if (style.stage === 1 && hash(lb * 1.3) > 0.8) this.side = -this.side; // the angle it holds its head at flips
    }
    const tk = ch.track,
      free = (1 - tk) * alive;
    const wantY = clamp(
      (this.aimY + this.offY) * tk + ch.sweep * Math.sin(this.gt * 1.15) * 0.85 + free * Math.sin(this.gt * 0.31 + this.i) * 0.3 + ch.headY * this.side,
      -hs.yaw,
      hs.yaw
    );
    const wantP = clamp((this.aimP + this.offP) * tk + free * Math.sin(this.gt * 0.23 + this.i * 2) * 0.06, -hs.pitch, hs.pitch);
    // At stage 1 the head moves in steps, held between, like bad stop motion.
    const follow =
      hs.step && Math.floor(this.gt * hs.step) === Math.floor((this.gt - dt) * hs.step)
        ? 0
        : Math.min(1, hs.step ? 1 : dt * hs.rate * (1 + this.kSpot * 4 + this.kFlare * 4));
    const before = this.lookY;
    this.lookY += (wantY - this.lookY) * follow;
    this.lookP += (wantP - this.lookP) * follow;
    this.lookVY = (this.lookY - before) / Math.max(dt, 0.001);
    // The body under the head is swinging; take that back out so the face stays put.
    const hy = this.lookY - body.ry,
      hp = this.lookP - body.rx * Math.max(tk, 0.5),
      neck = rig.has.neck ? hs.neck : 0;
    rig.neck.ry += hy * neck;
    rig.neck.rx += hp * neck;
    rig.neck.rz -= body.rz * 0.5;
    rig.head.ry += hy * (1 - neck);
    rig.head.rx += hp * (1 - neck) + ch.headX + this.kSpot * -0.15;
    rig.head.rz += ch.headZ * this.side - body.rz * 0.5;
    // The eyes make up what the head could not turn, and never blink.
    this.eyeY = clamp(this.aimY - this.lookY, -hs.eye, hs.eye) * Math.max(tk, 0.3);
    this.eyeP = clamp(this.aimP - this.lookP - ch.headX, -hs.eye, hs.eye) * Math.max(tk, 0.3);
    if (style.stage === 0) {
      // Googly: unaware, they wander separately.
      rig.eye_L.ry += this.eyeY + free * Math.sin(this.gt * 0.41 + 1) * 0.35;
      rig.eye_L.rx += this.eyeP + free * Math.abs(Math.sin(this.gt * 0.29)) * 0.25;
      rig.eye_R.ry += this.eyeY + free * Math.sin(this.gt * 0.53 + 4) * 0.35;
      rig.eye_R.rx += this.eyeP + free * Math.abs(Math.sin(this.gt * 0.37 + 2)) * 0.25;
    } else {
      // They no longer agree: the right one is on you, the left arrives late or looks elsewhere.
      const late = hash(lb * 2.3 + this.i) > 0.6 ? 0.2 : 1;
      rig.eye_R.ry += this.eyeY;
      rig.eye_R.rx += this.eyeP;
      rig.eye_L.ry += this.eyeY * late + this.offY * 0.3;
      rig.eye_L.rx += this.eyeP * late;
    }

    /* what only it has, and what hangs off it */
    style.hook?.(this, rig, ch);
    for (const c of style.chains) c.run(this, c.links, ch, dt);
    const sx = tr.vf * 0.06,
      sz = -tr.vs * 0.06,
      jit = shake * 0.25;
    for (const sp of rig.sways)
      lag(
        sp,
        sx + Math.sin(this.t * 0.7 + sp.seed * 40) * 0.03 + jit * (hash(tick + sp.seed * 9) - 0.5),
        sz - this.lookVY * 0.04 + Math.cos(this.t * 0.6 + sp.seed * 50) * 0.03 + jit * (hash(tick + sp.seed * 7) - 0.5),
        dt,
        26,
        3.5,
        style.swayMax
      );

    /* feet planted: the legs take back whatever the body did above them */
    if (rig.has.leg_L && g.mode !== 'crawl' && g.mode !== 'hop' && g.mode !== 'scuttle') {
      const legsOut = sit * 1.35,
        lean = body.rx,
        tilt = body.rz + body.px / h,
        twist = body.ry;
      // The hips turned, so each hip joint moved forward or back; the leg swings only the rest of the way to its foot.
      const hipZ = (rig.hipX * Math.sin(twist)) / h,
        aL = Math.asin(clamp(footL - hipZ, -1, 1)),
        aR = Math.asin(clamp(footR + hipZ, -1, 1));
      body.py += rig.hipX * Math.abs(body.rz) + h * (Math.cos(p < 0.5 ? aL : aR) - 1) * this.walk; // the hips ride over the standing leg
      rig.leg_L.rx += aL - lean - bend - legsOut;
      rig.leg_R.rx += aR - lean - bend - legsOut;
      rig.leg_L.rz -= tilt;
      rig.leg_R.rz -= tilt;
      rig.leg_L.ry -= twist;
      rig.leg_R.ry -= twist;
      rig.shin_L.rx += bend * 2;
      rig.shin_R.rx += bend * 2;
    }
    // Whatever the layers asked of the arms, the mesh only turns so far.
    const lim = style.limit;
    rig.arm_L.rx = clamp(rig.arm_L.rx, -lim.arm, lim.arm);
    rig.arm_R.rx = clamp(rig.arm_R.rx, -lim.arm, lim.arm);
    rig.arm_L.rz = clamp(rig.arm_L.rz, -lim.out, lim.out);
    rig.arm_R.rz = clamp(rig.arm_R.rz, -lim.out, lim.out);
    rig.forearm_L.rx = clamp(rig.forearm_L.rx, -lim.fore, lim.fore);
    rig.forearm_R.rx = clamp(rig.forearm_R.rx, -lim.fore, lim.fore);
    this.pivot.scale.set(1, 1 - land * 0.06, 1);
    rig.apply();

    /* eyes in the dark */
    const size = Math.max(HALO_SIZE[style.stage], this.dist * HALO_FLOOR) * (1 + this.kFlare * 0.8);
    // Under a torch or the room lights the model's own eyes are enough; the points are for the dark.
    // And for a distance: close up, a soft point hanging in front of an eyeball looks like what it is.
    const far = clamp((this.dist - HALO_NEAR) / HALO_NEAR, 0, 1);
    fit.haloMat.opacity += (((lit ? 0.2 : lightsF(S) ? 0.5 : 1) + this.kFlare) * far - fit.haloMat.opacity) * Math.min(1, dt * 8);
    for (const s of fit.halos) s.scale.set(size, size, 1);
    fit.carrier.o.localToWorld(this.face.copy(fit.facePoint));
  }
}
