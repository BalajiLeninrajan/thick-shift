// One mascot: its models for the three rot stages, where it is, and the layers
// of procedural animation that pose its parts each frame. Nothing here is
// keyframed. In order: the gait (driven by the distance actually covered, so
// feet stay where they land), the pose of its state (styles.js), its head and
// eyes, the things particular to it, whatever hangs off it, then feet planted.
import * as THREE from 'three';
import { MASC } from '../../config.js';
import { loadActor, loadJSON, instance, EYE_PALE } from '../assets.js';
import { glimpses, MASCOT_R, EYE } from '../map.js';
import { lightsF } from '../sim3d.js';
import { Track, hostClock, wrap } from './track.js';
import { buildRig, lag } from './rig.js';
import { C, NCH, RATE, styleOf, standIn, hash } from './styles.js';

const TAU = Math.PI * 2, clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const smooth = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
// Rises over `up` of the span, holds, and falls over the last `down`.
const bump = (u, up, down) => smooth(u / up) * smooth((1 - u) / down);
// Where a foot is through the walk cycle, from -1 (as far ahead as it lands) to 1 (as far behind as it lifts): the
// first half on the ground going back at a steady rate, which is ground speed, the second half swinging forward.
const footAt = q => q < .5 ? q * 4 - 1 : Math.cos(Math.PI * (q * 2 - 1));

const SEEN_RANGE = 46;     // metres: past this the fog has it anyway
const LOOK_EVERY = .2;     // seconds between checks of whether the camera can see it
const STEP_HZ = 14;        // shudders and spasms change this often and hold in between, like the 2D art
const SEAT_LOCAL = .8, SEAT_OTHER = .3;   // metres from a flattened guard's middle to where it sits: on them, but in view of the one underneath

// One soft point, drawn over every eye_glow so the eyes still read as two
// pale points when the head is twenty metres away and three pixels wide.
let haloTex = null;
function haloTexture() {
  if (haloTex) return haloTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 32;
  const c = cv.getContext('2d'), g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, '#fff'); g.addColorStop(.25, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 32, 32);
  return haloTex = new THREE.CanvasTexture(cv);
}
const HALO_SIZE = [.1, .085, .05], HALO_FLOOR = .0035;   // metres across by stage (pinpricks at 2), and the least it may subtend, as a fraction of its distance
const MAX_HALOS = 12, HALO_NEAR = 2.5;   // metres: no points inside this, all of them by twice it

const v = new THREE.Vector3(), box = new THREE.Box3();

export class Mascot {
  constructor(scene, i, renderer) {
    this.i = i; this.def = MASC[i]; this.renderer = renderer;
    this.group = new THREE.Group(); this.pivot = new THREE.Group(); this.group.add(this.pivot); scene.add(this.group);
    this.track = new Track();
    this.ch = new Float32Array(NCH); this.cv = new Float32Array(NCH);
    this.fits = [null, null, null]; this.asked = [false, false, false];
    this.cur = this.fit(standIn(this.def), 0, null, false); this.pivot.add(this.cur.model);
    this.rot = 0; this.onScreen = new THREE.Sphere();
    this.t = i * 7.3; this.gt = i * 3.1;   // its own clock, and one that stops when a beam freezes it
    this.phase = i * .37; this.walk = 0; this.live = 1; this.hop = 0;
    this.st = 'rest'; this.lit = false; this.seen = true; this.lookT = i * .05; this.dist = 0;
    this.lookY = 0; this.lookP = 0; this.lookVY = 0; this.beat = -1; this.offY = 0; this.offP = 0; this.side = 1;
    this.aimY = 0; this.aimP = 0; this.eyeY = 0; this.eyeP = 0;
    // Kicks: set to 1 by an event, and they die away. Each adds a fast move on top of the pose.
    this.kLunge = 0; this.kSlam = 0; this.kLand = 0; this.kFlare = 0; this.kRecoil = 0; this.kSpot = 0;
    this.seat = { on: false, x: 0, z: 0, yaw: 0, w: 0, v: 0, turn: 0 };
    this.scareOn = false; this.scareW = 0; this.scareBite = 0;
    this.face = new THREE.Vector3();   // where its face is in the world, for the jumpscare
    this.load(0);
  }

  /* ---------- models ---------- */

  load(stage) {
    if (stage > 2 || this.asked[stage]) return;
    this.asked[stage] = true;
    Promise.all([loadActor(`${this.def.k}_${stage}`), loadJSON(this.def.k)]).then(([src, info]) => {
      if (!src) return;   // the stand-in, or the stage before, carries on
      const fit = this.fits[stage] = this.fit(instance(src), stage, info?.stages?.[stage], true);
      // Textures go to the GPU now, not in the frame the stage first shows.
      fit.model.traverse(o => { if (o.isMesh) for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap']) if (o.material[k]) this.renderer.initTexture(o.material[k]); });
    });
  }

  fit(model, stage, info, real) {
    const rig = buildRig(model), style = styleOf(this.def.k, stage, rig, info);
    const haloMat = new THREE.SpriteMaterial({ map: haloTexture(), color: EYE_PALE, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const halos = [];
    model.traverse(o => {
      if (!o.userData.glow || halos.length >= MAX_HALOS) return;
      // Sit the point just proud of the glint, on the side away from the eyeball's centre.
      o.geometry.computeBoundingBox(); o.geometry.boundingBox.getCenter(v).add(o.position);
      const len = v.length(), s = new THREE.Sprite(haloMat);
      if (len > .005) v.multiplyScalar(1 + .02 / len); else v.set(0, 0, .03);
      s.position.copy(v); o.parent.add(s); halos.push(s);
    });
    // The face: the manifest gives it in model space; keep it in the space of the part that carries it.
    const lookers = style.looker ? rig.chain(style.looker) : null, carrier = lookers?.length ? lookers[lookers.length - 1] : rig.has.head ? rig.head : rig.body;
    const facePoint = new THREE.Vector3(...(info?.face || [0, rig.headH + .25, .45]));
    model.updateWorldMatrix(true, true);
    if (carrier.o) carrier.o.worldToLocal(model.localToWorld(facePoint));
    box.setFromObject(model);
    return { model, rig, style, halos, haloMat, carrier, facePoint, stage, real, height: info?.height || box.max.y };
  }

  show(fit) {
    this.pivot.remove(this.cur.model); this.pivot.add(fit.model);
    for (const p of fit.rig.list) { p.ax = p.az = p.vx = p.vz = 0; }
    this.cur = fit;
    this.load(fit.stage + 1);
  }

  // Follow m.rot to the next model, but only while this screen cannot see it: it changes behind your back.
  stage(rot, hidden) {
    const want = this.fits[rot];
    if (want && want !== this.cur && (hidden || !this.cur.real)) this.show(want);
  }

  /* ---------- events ---------- */

  // The guard it caught is at (x, z): it turns to them and sits. mine: the guard is the one watching.
  sitOn(x, z, mine) {
    const s = this.seat, tr = this.track, dx = tr.x - x, dz = tr.z - z, d = Math.hypot(dx, dz) || 1, off = mine ? SEAT_LOCAL : SEAT_OTHER;
    s.on = true; s.x = x + dx / d * off; s.z = z + dz / d * off; s.yaw = Math.atan2(-dx, -dz);
  }
  bang() { this.kSlam = 1; }
  crash() { this.kRecoil = 1; }
  spotted() { this.kSpot = 1; }
  // lookT = 0: it may have jumped home, so ask again next frame whether it can be seen.
  reset() { this.track.n = 0; this.lookT = 0; this.seat.on = false; this.seat.w = this.seat.turn = 0; this.scareOn = false; this.scareW = 0; this.scareBite = 0; this.ch.fill(0); this.cv.fill(0); }

  /* ---------- the frame ---------- */

  // view: { x, y, z } of the camera, id of the guard watching, flat (they are on the floor), torch (their beam is on).
  sync(m, S, dt, view) {
    const tr = this.track, st = m.st;
    if (hostClock.fresh) tr.push(S.t, m.x, m.z, m.yaw);
    tr.sample(hostClock.now, dt);
    this.rot = m.rot || 0; this.load(this.rot);
    const lit = !!m.lit && (st === 'roam' || st === 'search' || st === 'hunt');

    // Can the camera see any of it? Only walls and shut doors count: sees() also stops at furniture, which is the
    // host's rule for hiding, but a table hides none of a mascot from the eye. Lines across its whole width, close
    // enough together that one half in view past a door jamb is not hidden with the rest.
    this.dist = Math.hypot(tr.x - view.x, tr.z - view.z);
    if ((this.lookT -= dt) <= 0) {
      this.lookT = LOOK_EVERY;
      const d = this.dist;
      this.seen = d < SEEN_RANGE && (d < 3 || this.scareOn || glimpses(view.x, view.z, tr.x, tr.z, MASCOT_R, S.doors));
    }
    // Hidden for a swap: a wall is in the way, or it is off the edge of the picture (a generous sphere round it, so
    // nothing changes at the edge of the screen). Dark does not count: its eyes still show.
    const sph = this.onScreen; sph.center.set(tr.x, this.cur.height / 2, tr.z); sph.radius = this.cur.height * .6 + .6;
    this.stage(this.rot, !this.seen || !view.frustum.intersectsSphere(sph));
    const fit = this.cur, rig = fit.rig, style = fit.style, ch = this.ch, cv = this.cv;

    // What changed since the last frame.
    if (this.lit && !lit && st === 'hunt') { this.kLunge = 1; this.kFlare = 1; }   // the light went off it
    if (st !== this.st) {
      if (st === 'feast') this.kLand = 1; else if (this.st === 'feast') this.seat.on = false;
      if (st === 'charge') this.kLunge = 1;
      this.st = st;
    }
    this.lit = lit;
    const decay = Math.exp(-dt * 5);
    this.kLunge *= Math.exp(-dt * 3); this.kSlam *= decay; this.kLand *= decay; this.kFlare *= Math.exp(-dt * 2); this.kRecoil *= Math.exp(-dt * 2.5); this.kSpot *= decay;

    // Channels spring toward the pose of the state (critically damped, so they neither pop nor ring).
    const pose = this.scareOn ? style.poses.scare : lit ? style.poses.lit[st] : style.poses[st] || style.poses.roam;
    for (let k = 0; k < NCH; k++) {
      const w = RATE[k], d = ch[k] - pose[k], tmp = (cv[k] + w * d) * dt, e = Math.exp(-w * dt);
      cv[k] = (cv[k] - w * tmp) * e; ch[k] = pose[k] + (d + tmp) * e;
    }
    // It turns to the guard it caught at once, and goes and sits on them when the catch lets go.
    const seat = this.seat, sw = seat.on && st === 'feast' && !this.scareOn ? 1 : 0;
    seat.turn += ((seat.on && (st === 'feast' || this.scareOn) ? 1 : 0) - seat.turn) * Math.min(1, dt * 10);
    { const w = 9, d = seat.w - sw, tmp = (seat.v + w * d) * dt, e = Math.exp(-w * dt); seat.v = (seat.v - w * tmp) * e; seat.w = sw + (d + tmp) * e; }
    this.scareW += ((this.scareOn ? 1 : 0) - this.scareW) * Math.min(1, dt * 12);

    // Clocks. A beam stops a stage 0 costume dead: mid-wave, if it was waving.
    const frozen = lit && style.stage === 0;
    this.t += dt; if (!frozen) this.gt += dt;
    // Stage 0 standing still is still. It goes on too long.
    this.live += ((style.stage > 0 || tr.speed > .05 ? 1 : 0) - this.live) * Math.min(1, dt * (tr.speed > .05 ? 4 : .6));

    // The gait's phase runs on distance whether or not anyone is looking.
    const g = style.gait, h = rig.hipH, moving = tr.speed > .08;
    this.walk += ((moving ? 1 : 0) - this.walk) * Math.min(1, dt * 7);
    // A step is as long as the leg swings plus as far as the hips turn: with hips this wide, the turn is a third of it.
    const pace = clamp(tr.speed / g.fast, 0, 1), A = g.min + (g.max - g.min) * pace, twistMax = g.mode === 'walk' ? g.hipYaw * (.75 + .5 * pace) : 0;
    const reach = h * Math.sin(A) + rig.hipX * Math.sin(twistMax);   // how far ahead of the body a foot lands, and how far behind it lifts
    this.phase = (this.phase + tr.moved * Math.sign(tr.vf || 1) / (4 * reach) + 1) % 1;

    const x = tr.x + (seat.x - tr.x) * seat.w, z = tr.z + (seat.z - tr.z) * seat.w, yaw = tr.yaw + wrap(seat.yaw - tr.yaw) * seat.turn;
    this.group.position.set(x, 0, z); this.group.rotation.y = yaw;
    this.group.visible = this.seen;
    if (!this.seen) return;

    /* gait */
    const p = this.phase, wk = this.walk * ch[C.legs], s2 = Math.sin(TAU * p), c2 = Math.cos(TAU * p), body = rig.body, root = rig.root;
    let footL = 0, footR = 0;   // how far behind the body's middle each foot is, over the leg's length
    if (g.mode === 'walk') {
      const qL = p, qR = (p + .5) % 1;
      footL = footAt(qL) * reach / h * wk; footR = footAt(qR) * reach / h * wk;
      rig.shin_L.rx += g.knee * Math.max(0, -Math.sin(TAU * qL)) * wk; rig.shin_R.rx += g.knee * Math.max(0, -Math.sin(TAU * qR)) * wk;
      // The joke is in the title. The hips roll onto the standing leg and swing the far side forward, and everything above goes with them.
      body.rz -= g.hipRoll * s2 * wk; body.ry -= twistMax * c2 * wk; body.px += g.shift * s2 * wk;
      const arm = g.arm * c2 * wk; rig.arm_L.rx += arm; rig.arm_R.rx -= arm; rig.forearm_L.rx -= Math.abs(arm) * .4; rig.forearm_R.rx -= Math.abs(arm) * .4;
    } else if (g.mode === 'float') {
      // Nothing to stand on. It bobs, drifts, and tips into its own movement.
      root.py += Math.sin(this.t * 1.2) * .07 + Math.sin(this.t * .53) * .03; root.px += Math.sin(this.t * .37) * .05;
      body.rx += clamp(tr.vf * .06, -.3, .3); body.rz += clamp(-tr.vs * .06 - tr.spin * .05, -.3, .3) + Math.sin(this.t * .8) * .03;
    } else if (g.mode === 'crawl') {
      // On all fours with the thighs out sideways: opposite hand and foot go together.
      const a1 = g.max * s2 * wk, lift = Math.max(0, c2) * wk, lift2 = Math.max(0, -c2) * wk;
      rig.leg_L.ry += a1 * .6; rig.leg_R.ry += a1 * .6; rig.shin_L.rx += lift * .5; rig.shin_R.rx += lift2 * .5;
      rig.arm_L.rx -= a1 * g.arm; rig.arm_R.rx += a1 * g.arm; rig.forearm_L.rx -= lift2 * .7; rig.forearm_R.rx -= lift * .7;
      body.rz += .05 * s2 * wk; body.ry += .1 * c2 * wk; body.py += Math.abs(s2) * .03 * wk; rig.head.rx += .06 * Math.sin(TAU * p * 2 - 1) * wk;
    } else if (g.mode === 'hop') {
      // Arms reach and plant, the body pitches over them, the legs snap shut behind. Twice a cycle.
      const q = (p * 2) % 1, reach = bump(q, .35, .4) * wk, pull = smooth((q - .45) / .3) * (1 - smooth((q - .8) / .2)) * wk;
      rig.arm_L.rx -= .5 * reach; rig.arm_R.rx -= .5 * reach; rig.forearm_L.rx += .35 * reach; rig.forearm_R.rx += .35 * reach;
      body.rx += .26 * reach; root.py += .16 * pull;
      rig.leg_L.rx -= .25 * pull; rig.leg_R.rx -= .25 * pull; rig.shin_L.rx += .4 * pull; rig.shin_R.rx += .4 * pull;
    }

    /* idle: breath and shifting weight */
    const alive = this.live, br = ch[C.breath] * alive, swy = ch[C.sway] * alive;
    body.s *= 1 + .012 * br * Math.sin(this.gt * 1.6);
    if (!style.floats && g.mode !== 'glide') { body.rz += .018 * swy * Math.sin(this.gt * .47); body.px += .02 * swy * Math.sin(this.gt * .47); body.rx += .01 * swy * Math.sin(this.gt * .31 + 1); }

    /* the pose */
    const slam = this.kSlam, recoil = this.kRecoil, land = this.kLand, lunge = this.kLunge;
    body.rx += ch[C.lean] + slam * .45 - recoil * .5 + lunge * .22;
    root.pz += slam * .3 - recoil * .25 + lunge * .25 + this.scareBite * .15;
    const jawMove = ch[C.jaw] + lunge * .6 + slam * .5;
    rig.jaw.rx += clamp(jawMove, 0, 1.15) * style.jaw;
    const armUp = slam * 1.3;   // the arms come down with the hit
    rig.arm_L.rx += ch[C.armL] + armUp; rig.arm_R.rx += ch[C.armR] + armUp; rig.arm_L.rz += ch[C.out]; rig.arm_R.rz -= ch[C.out];
    rig.forearm_L.rx += ch[C.fore]; rig.forearm_R.rx += ch[C.fore];
    // Sitting: the rear comes down hard and the legs go out in front.
    const sit = ch[C.sit];
    // It settles its weight, and bounces a little. A floater comes down to hover on them.
    const drop = style.floats ? sit * (fit.height * .3 + Math.sin(this.t * 2.2) * .04) : sit * (h * style.sit - Math.abs(Math.sin(this.t * 2.2)) * .04);
    // A crouch needs knees. Without shins the legs cannot shorten, so it stays up.
    const crouch = rig.has.shin_L ? clamp(ch[C.drop], 0, h * .4) : 0, bend = Math.acos(1 - crouch / h);
    root.py -= drop + crouch;
    // The shudder: stepped noise, held between steps.
    const tick = Math.floor(this.t * STEP_HZ) + this.i * 50, shake = ch[C.shake] + lunge * .6 + this.kSpot * .5;
    if (shake > .01) {
      body.rz += shake * .035 * (hash(tick) - .5); body.rx += shake * .03 * (hash(tick + .3) - .5); body.ry += shake * .04 * (hash(tick + .6) - .5);
      rig.arm_L.rx += shake * .16 * (hash(tick + 1) - .5); rig.arm_R.rx += shake * .16 * (hash(tick + 2) - .5); rig.head.rz += shake * .1 * (hash(tick + 3) - .5);
    }
    const slack = ch[C.slack];
    if (slack > .01) {
      // Hung, not standing: the head lolls and the arms swing a beat late.
      rig.head.rz += slack * .12 * Math.sin(this.t * 1.3); rig.head.rx += slack * .08 * Math.sin(this.t * .9 + 1);
      if (style.slackArms || st === 'stun') { lag(rig.arm_L, tr.vf * .12 + Math.sin(this.t * 1.1) * .04, -tr.spin * .08, dt, 18, 2.5, .7); lag(rig.arm_R, tr.vf * .12 + Math.sin(this.t * 1.1 + 2) * .04, -tr.spin * .08, dt, 16, 2.5, .7); }
    }

    /* gestures: the small things it does between everything else */
    const up = st === 'roam' || st === 'search' || st === 'hunt';
    if (style.stage === 0 && up && style.gestures.length) {
      const span = 5.5, gb = Math.floor(this.gt / span), u = this.gt / span - gb, r = hash(gb * 1.7 + this.i * 31);
      if (r > .45) {
        const kind = style.gestures[Math.floor(hash(gb + this.i) * style.gestures.length)];
        if (kind === 'wave') { const e = bump(clamp(u / .55, 0, 1), .2, .25); rig.arm_R.rx -= 2.5 * e; rig.arm_R.rz -= .35 * e; rig.forearm_R.rx -= .3 * e; rig.forearm_R.rz += Math.sin(this.gt * 8) * .4 * e; }
        else if (kind === 'hug') { const e = bump(clamp(u / .7, 0, 1), .25, .25); rig.arm_L.rx -= .7 * e; rig.arm_R.rx -= .7 * e; rig.arm_L.rz += .5 * e; rig.arm_R.rz -= .5 * e; rig.forearm_L.rx -= .5 * e; rig.forearm_R.rx -= .5 * e; }
        else rig.head.rz += .28 * bump(clamp(u / .8, 0, 1), .1, .1) * (r > .7 ? 1 : -1);   // a tilt, held
      }
    } else if (style.stage === 1 && st !== 'rest') {
      // The jaw works on nothing, in bursts.
      const jb = Math.floor(this.gt * .7 + this.i);
      if (hash(jb * 3.1) > .45) rig.jaw.rx += style.jaw * .5 * Math.max(0, Math.sin(this.gt * 12));
    }

    /* head and eyes */
    // Who it is looking at: whoever is closest and standing. From the floor, you see it looking at someone else.
    let tx = view.x, ty = view.y, tz = view.z, best = view.flat && !this.scareOn && !seat.w ? 1e9 : this.dist;
    for (const q of S.players) { if (q.flat || q.x == null || q.id === view.id) continue; const d = Math.hypot(q.x - x, q.z - z); if (d < best) { best = d; tx = q.x; ty = EYE; tz = q.z; } }
    const hs = style.head, dx = tx - x, dz = tz - z, sin = Math.sin(yaw), cos = Math.cos(yaw), lz = dx * sin + dz * cos, lx = dx * cos - dz * sin, flat = Math.hypot(lx, lz);
    const headY0 = (style.looker ? fit.height * .9 : rig.headH + .25) + root.py;
    const aimY = Math.atan2(lx, lz), aimP = Math.atan2(headY0 - ty, Math.max(flat, .3));
    this.aimY = clamp(aimY, -1.4, 1.4); this.aimP = clamp(aimP, -.8, 1);
    // Mostly locked on you. Sometimes, for a beat, somewhere else entirely.
    const lb = Math.floor(this.t * 1.3 + this.i * 9);
    if (lb !== this.beat) {
      this.beat = lb;
      const away = hash(lb + this.i * 31) > 1 - hs.twitch;
      this.offY = away ? (hash(lb) * 2 - 1) * .9 : 0; this.offP = away ? (hash(lb + 7) * 2 - 1) * .3 : 0;
      if (style.stage === 1 && hash(lb * 1.3) > .8) this.side = -this.side;   // the angle it holds its head at flips
    }
    const tk = ch[C.track], free = (1 - tk) * alive;
    const wantY = clamp((this.aimY + this.offY) * tk + ch[C.sweep] * Math.sin(this.gt * 1.15) * .85 + free * Math.sin(this.gt * .31 + this.i) * .3 + ch[C.headY] * this.side, -hs.yaw, hs.yaw);
    const wantP = clamp((this.aimP + this.offP) * tk + free * Math.sin(this.gt * .23 + this.i * 2) * .06, -hs.pitch, hs.pitch);
    // At stage 1 the head moves in steps, held between, like bad stop motion.
    const follow = hs.step && Math.floor(this.gt * hs.step) === Math.floor((this.gt - dt) * hs.step) ? 0 : Math.min(1, hs.step ? 1 : dt * hs.rate * (1 + this.kSpot * 4 + this.kFlare * 4));
    const before = this.lookY;
    this.lookY += (wantY - this.lookY) * follow; this.lookP += (wantP - this.lookP) * follow;
    this.lookVY = (this.lookY - before) / Math.max(dt, .001);
    // The body under the head is swinging; take that back out so the face stays put.
    const hy = this.lookY - body.ry, hp = this.lookP - body.rx * Math.max(tk, .5), neck = rig.has.neck ? hs.neck : 0;
    rig.neck.ry += hy * neck; rig.neck.rx += hp * neck; rig.neck.rz -= body.rz * .5;
    rig.head.ry += hy * (1 - neck); rig.head.rx += hp * (1 - neck) + ch[C.headX] + this.kSpot * -.15; rig.head.rz += ch[C.headZ] * this.side - body.rz * .5;
    // The eyes make up what the head could not turn, and never blink.
    this.eyeY = clamp(this.aimY - this.lookY, -hs.eye, hs.eye) * Math.max(tk, .3); this.eyeP = clamp(this.aimP - this.lookP - ch[C.headX], -hs.eye, hs.eye) * Math.max(tk, .3);
    if (style.stage === 0) {
      // Googly: unaware, they wander separately.
      rig.eye_L.ry += this.eyeY + free * Math.sin(this.gt * .41 + 1) * .35; rig.eye_L.rx += this.eyeP + free * Math.abs(Math.sin(this.gt * .29)) * .25;
      rig.eye_R.ry += this.eyeY + free * Math.sin(this.gt * .53 + 4) * .35; rig.eye_R.rx += this.eyeP + free * Math.abs(Math.sin(this.gt * .37 + 2)) * .25;
    } else {
      // They no longer agree: the right one is on you, the left arrives late or looks elsewhere.
      const late = hash(lb * 2.3 + this.i) > .6 ? .2 : 1;
      rig.eye_R.ry += this.eyeY; rig.eye_R.rx += this.eyeP; rig.eye_L.ry += this.eyeY * late + this.offY * .3; rig.eye_L.rx += this.eyeP * late;
    }

    /* what only it has, and what hangs off it */
    style.hook?.(this, rig, ch);
    for (const c of style.chains) c.run(this, c.links, ch, dt);
    const sx = tr.vf * .06, sz = -tr.vs * .06, jit = shake * .25;
    for (const sp of rig.sways) lag(sp, sx + Math.sin(this.t * .7 + sp.seed * 40) * .03 + jit * (hash(tick + sp.seed * 9) - .5), sz - this.lookVY * .04 + Math.cos(this.t * .6 + sp.seed * 50) * .03 + jit * (hash(tick + sp.seed * 7) - .5), dt, 26, 3.5, style.swayMax);

    /* feet planted: the legs take back whatever the body did above them */
    if (rig.has.leg_L && g.mode !== 'crawl' && g.mode !== 'hop') {
      const legsOut = sit * 1.35, lean = body.rx, tilt = body.rz + body.px / h, twist = body.ry;
      // The hips turned, so each hip joint moved forward or back; the leg swings only the rest of the way to its foot.
      const hipZ = rig.hipX * Math.sin(twist) / h, aL = Math.asin(clamp(footL - hipZ, -1, 1)), aR = Math.asin(clamp(footR + hipZ, -1, 1));
      body.py += rig.hipX * Math.abs(body.rz) + h * (Math.cos(p < .5 ? aL : aR) - 1) * this.walk;   // the hips ride over the standing leg
      rig.leg_L.rx += aL - lean - bend - legsOut; rig.leg_R.rx += aR - lean - bend - legsOut;
      rig.leg_L.rz -= tilt; rig.leg_R.rz -= tilt; rig.leg_L.ry -= twist; rig.leg_R.ry -= twist;
      rig.shin_L.rx += bend * 2; rig.shin_R.rx += bend * 2;
    }
    // Whatever the layers asked of the arms, the mesh only turns so far.
    const lim = style.limit;
    rig.arm_L.rx = clamp(rig.arm_L.rx, -lim.arm, lim.arm); rig.arm_R.rx = clamp(rig.arm_R.rx, -lim.arm, lim.arm); rig.arm_L.rz = clamp(rig.arm_L.rz, -lim.out, lim.out); rig.arm_R.rz = clamp(rig.arm_R.rz, -lim.out, lim.out);
    rig.forearm_L.rx = clamp(rig.forearm_L.rx, -lim.fore, lim.fore); rig.forearm_R.rx = clamp(rig.forearm_R.rx, -lim.fore, lim.fore);
    this.pivot.scale.set(1, 1 - land * .06, 1);
    rig.apply();

    /* eyes in the dark */
    const size = Math.max(HALO_SIZE[style.stage], this.dist * HALO_FLOOR) * (1 + this.kFlare * .8);
    // Under a torch or the room lights the model's own eyes are enough; the points are for the dark.
    // And for a distance: close up, a soft point hanging in front of an eyeball looks like what it is.
    const far = clamp((this.dist - HALO_NEAR) / HALO_NEAR, 0, 1);
    fit.haloMat.opacity += (((lit ? .2 : lightsF(S) ? .5 : 1) + this.kFlare) * far - fit.haloMat.opacity) * Math.min(1, dt * 8);
    for (const s of fit.halos) s.scale.set(size, size, 1);
    fit.carrier.o?.localToWorld(this.face.copy(fit.facePoint));
  }
}
