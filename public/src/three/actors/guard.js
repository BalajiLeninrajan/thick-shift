// Another guard: guard.glb (or a stand-in with the same parts) walking where
// the host says they are, looking where they look, with their torch, their
// phone when they have it up, a name tag, and the two things that happen to
// guards: being flattened and being peeled back up.
import * as THREE from 'three';
import { loadActor, instance } from '../assets.js';
import { glimpses, PLAYER_R } from '../map.js';
import { F } from '../sim3d.js';
import { Track, hostClock } from './track.js';
import { buildRig } from './rig.js';

const TAU = Math.PI * 2, clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const TAG_NEAR = 7, TAG_FLAT = 25;    // metres a name shows from: standing (and in sight), and flat (so someone can find them)
const THIN = .035;                    // how much of a guard is left, front to back, once flat
// A leg's angle through the walk cycle: the first half on the ground, the foot going back at ground speed; the second half swinging forward.
const legAt = (q, A, S) => q < .5 ? Math.asin(S * (q * 4 - 1)) : A * Math.cos(Math.PI * (q * 2 - 1));
const LOWERED = .9;                   // radians the torch arm drops when the torch is off
const PHONE_UP = 1.15;                // radians the left arm comes forward to hold the phone up

const GEO = {
  body: new THREE.CapsuleGeometry(.24, .5, 4, 10).translate(0, .32, 0), head: new THREE.SphereGeometry(.15, 12, 10).translate(0, .14, 0), cap: new THREE.CylinderGeometry(.16, .16, .07, 12).translate(0, .27, 0),
  limb: new THREE.CapsuleGeometry(.075, .5, 4, 8).translate(0, -.3, 0), reach: new THREE.CapsuleGeometry(.075, .4, 4, 8).rotateX(Math.PI / 2).translate(0, 0, .25), leg: new THREE.CapsuleGeometry(.1, .65, 4, 8).translate(0, -.42, 0), torch: new THREE.CylinderGeometry(.03, .04, .22, 8).rotateX(Math.PI / 2).translate(0, .05, .5),
  phone: new THREE.BoxGeometry(.06, .13, .025),
};
const MAT = { cloth: new THREE.MeshStandardMaterial({ color: 0x2d3a5c, roughness: .9 }), skin: new THREE.MeshStandardMaterial({ color: 0xd9a98a, roughness: .8 }), dark: new THREE.MeshStandardMaterial({ color: 0x15151c, roughness: .6 }) };

// The contract's guard parts, built from capsules. Shown until guard.glb loads, and if it never does.
function standIn() {
  const node = (name, parent, x, y, z, ...meshes) => {
    const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); parent?.add(o);
    for (const [geo, mat] of meshes) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; o.add(m); }
    return o;
  };
  const root = node('root', null, 0, 0, 0), body = node('body', root, 0, .92, 0, [GEO.body, MAT.cloth]);
  node('head', body, 0, .62, 0, [GEO.head, MAT.skin], [GEO.cap, MAT.cloth]);
  node('arm_L', body, .31, .52, 0, [GEO.limb, MAT.cloth]); node('arm_R', body, -.31, .52, 0, [GEO.reach, MAT.cloth], [GEO.torch, MAT.dark]);   // held out, like the model's
  node('leg_L', body, .13, 0, 0, [GEO.leg, MAT.dark]); node('leg_R', body, -.13, 0, 0, [GEO.leg, MAT.dark]);
  return root;
}

// Where the left hand is: just above the lowest point of arm_L, where the phone goes.
function handOn(model) {
  const arm = model.getObjectByName('arm_L'), box = new THREE.Box3(), part = new THREE.Box3();
  if (!arm) return null;
  model.updateWorldMatrix(true, true);
  const back = arm.matrixWorld.clone().invert();
  arm.traverse(m => {
    if (!m.isMesh) return;
    m.geometry.computeBoundingBox();
    box.union(part.copy(m.geometry.boundingBox).applyMatrix4(back.clone().multiply(m.matrixWorld)));
  });
  const at = new THREE.Object3D();
  if (box.isEmpty()) at.position.set(0, -.55, .05);
  else { box.getCenter(at.position); at.position.y = box.min.y + .07; at.position.z = box.max.z + .02; }
  arm.add(at);
  return at;
}

// A point on arm_R at the front of the torch (the middle of guard.glb's
// lamp_glow face), so the lens glow and the lent light go where the torch is.
function lensOn(model) {
  const arm = model.getObjectByName('arm_R'), box = new THREE.Box3(), part = new THREE.Box3();
  if (!arm) return null;
  model.updateWorldMatrix(true, true);
  const back = arm.matrixWorld.clone().invert();
  arm.traverse(m => {
    if (!m.isMesh || m.material.name !== 'lamp_glow') return;
    m.geometry.computeBoundingBox();
    box.union(part.copy(m.geometry.boundingBox).applyMatrix4(back.clone().multiply(m.matrixWorld)));
  });
  const at = new THREE.Object3D();
  if (box.isEmpty()) at.position.set(0, .05, .61);   // the stand-in's torch
  else box.getCenter(at.position).setZ(box.max.z + .01);
  arm.add(at);
  return at;
}

let lensTex = null;
function lens() {
  if (lensTex) return lensTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 32;
  const c = cv.getContext('2d'), g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, '#fff'); g.addColorStop(.3, 'rgba(255,240,208,.6)'); g.addColorStop(1, 'rgba(255,240,208,0)');
  c.fillStyle = g; c.fillRect(0, 0, 32, 32);
  return lensTex = new THREE.CanvasTexture(cv);
}

function nameTag(name) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  c.font = '600 34px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = 6; c.strokeStyle = '#08080e'; c.strokeText(name, 128, 32, 240); c.fillStyle = '#cdd6f4'; c.fillText(name, 128, 32, 240);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false, depthWrite: false }));
  s.scale.set(.9, .225, 1); s.renderOrder = 5;
  return s;
}

export class Guard {
  constructor(scene, p) {
    this.id = p.id; this.name = p.name;
    this.group = new THREE.Group(); this.pivot = new THREE.Group(); this.group.add(this.pivot); scene.add(this.group);
    this.track = new Track();
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: lens(), blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); this.glow.scale.setScalar(.12);
    // The phone in the left hand, and the green of its screen, which shows across a room.
    this.phone = new THREE.Group(); this.phone.add(new THREE.Mesh(GEO.phone, MAT.dark)); this.phone.rotation.x = PHONE_UP - .25;
    this.screen = new THREE.Sprite(new THREE.SpriteMaterial({ map: lens(), color: 0x8cffb0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.screen.scale.setScalar(.16); this.screen.position.set(0, .02, -.03); this.phone.add(this.screen);   // on the side facing its guard
    this.wear(standIn());
    loadActor('guard').then(src => { if (src) { this.pivot.remove(this.model); this.wear(instance(src)); } });
    this.tag = nameTag(p.name); this.group.add(this.tag);
    this.phase = 0; this.walk = 0; this.t = 0; this.raise = 0; this.busy = 0;
    this.flat = 0; this.flatV = 0; this.isFlat = false; this.seen = true; this.lookT = 0;
    this.on = false; this.ph = false; this.phRaise = 0; this.dist = 0; this.aim = new THREE.Vector3(); this.hand = new THREE.Vector3();
  }
  wear(model) {
    this.model = model; this.rig = buildRig(model); this.pivot.add(model);
    this.lens = lensOn(model) || this.pivot; this.lens.add(this.glow);
    (handOn(model) || this.pivot).add(this.phone);
  }
  dispose(scene) { scene.remove(this.group); this.tag.material.map.dispose(); this.tag.material.dispose(); this.glow.material.dispose(); this.screen.material.dispose(); }

  sync(p, S, dt, view) {
    const tr = this.track, rig = this.rig, flat = !!p.flat;
    if (hostClock.fresh) tr.push(S.t, p.x, p.z, p.yaw, p.pitch || 0);
    tr.sample(hostClock.now, dt);
    this.t += dt;
    this.group.position.set(tr.x, 0, tr.z); this.group.rotation.y = tr.yaw;
    this.dist = Math.hypot(tr.x - view.x, tr.z - view.z);
    // Any of them in view past walls and shut doors (see mascot.js): a shoulder past a door jamb keeps them, and their torch.
    if ((this.lookT -= dt) <= 0) { this.lookT = .25; this.seen = this.dist < 2 || glimpses(view.x, view.z, tr.x, tr.z, PLAYER_R, S.doors); }
    this.on = !!p.on && p.bat > 0 && !flat;
    this.ph = !!p.ph && p.bat > 0 && !flat;

    // Flattened: over onto their back and squashed to a few centimetres, fast,
    // with a wobble as it settles. Peeled: the same spring the other way, and
    // a kick so they pop up past full height first.
    if (flat !== this.isFlat) { this.isFlat = flat; this.flatV += flat ? 0 : -9; }
    for (let n = Math.ceil(dt / .012), i = 0, d = dt / n; i < n; i++) { this.flatV += (((flat ? 1 : 0) - this.flat) * (flat ? 420 : 160) - this.flatV * (flat ? 16 : 11)) * d; this.flat += this.flatV * d; }
    const f = this.flat, lie = clamp(f * 1.6, 0, 1), thin = clamp(1 - f * (1 - THIN), THIN * .6, 1.3), spread = 1 + Math.max(0, f) * .22 + Math.max(0, 1 - Math.abs(1 - f) * 6) * Math.sin(this.t * 30) * .04;
    this.pivot.rotation.x = -lie * Math.PI / 2; this.pivot.position.y = lie * .02;
    this.pivot.scale.set(spread, f < 0 ? 1 - f * .12 : spread, thin);   // the pop on the way up is a stretch

    // Name: only where you could have read a badge, or when they are on the floor waiting for you.
    // A flat guard watching through this one's eyes (view.watch) is inside their head: draw none of them.
    // Watching from behind (view.third), they are drawn, all but the name tag, which the flat panel already gives.
    // In a locker there is nothing of them to see, whoever is looking.
    const inside = this.id === view.watch && !view.third, shut = p.hid >= 0 && !flat;
    const tag = this.tag; tag.visible = this.id !== view.watch && !shut && (flat ? this.dist < TAG_FLAT : this.seen && this.dist < TAG_NEAR);
    tag.material.depthTest = !flat; tag.position.y = flat ? .55 : 2.05;
    this.group.visible = (this.seen || flat) && !shut; this.pivot.visible = !inside;
    if (!this.group.visible) return;

    /* legs from the ground actually covered */
    const h = rig.hipH, run = clamp((tr.speed - F.WALK) / (F.SPRINT - F.WALK), 0, 1), A = clamp(.2 + tr.speed * .1, .2, .75), up = 1 - lie;
    this.walk += ((tr.speed > .15 ? 1 : 0) - this.walk) * Math.min(1, dt * 9);
    this.phase = (this.phase + tr.moved * Math.sign(tr.vf || 1) / (4 * h * Math.sin(A)) + 1) % 1;
    const p0 = this.phase, wk = this.walk * up, S1 = Math.sin(A);
    const lL = legAt(p0, A, S1) * wk, lR = legAt((p0 + .5) % 1, A, S1) * wk, lean = run * .22 * wk, body = rig.body, c2 = Math.cos(TAU * p0);
    body.rx += lean; body.py += h * (Math.cos(p0 < .5 ? lL : lR) - 1) + run * Math.abs(Math.sin(TAU * p0)) * .04 * wk; body.ry -= .12 * c2 * wk;
    rig.leg_L.rx += lL - lean; rig.leg_R.rx += lR - lean; rig.leg_L.ry += .12 * c2 * wk; rig.leg_R.ry += .12 * c2 * wk;
    this.phRaise += ((this.ph ? 1 : 0) - this.phRaise) * Math.min(1, dt * 8);
    rig.arm_L.rx += (.35 + run * .5) * c2 * wk * (1 - this.phRaise) - PHONE_UP * this.phRaise * up;
    this.phone.visible = this.phRaise > .05;
    this.screen.visible = this.ph && !inside;
    body.s *= 1 + .01 * Math.sin(this.t * 1.9);

    /* head and torch arm follow where they look */
    const pitch = clamp(tr.pitch, -1.1, 1.1), act = p.act || '';
    rig.head.rx -= pitch * .8 * up; body.rx -= pitch * .12 * up;
    this.raise += ((this.on && !this.ph ? 1 : 0) - this.raise) * Math.min(1, dt * 9);
    this.busy += ((act ? 1 : 0) - this.busy) * Math.min(1, dt * 8);
    const b = this.busy * up, idle = (1 - b) * up;
    rig.arm_R.rx += (-pitch * this.raise + (LOWERED - .3 * c2 * wk) * (1 - this.raise)) * idle;   // aimed when on, hanging and swinging when off
    if (act === 'crank') {
      // Both hands on the handle, going round, and the shoulders with it.
      const a = this.t * 7; body.rx += (.35 + Math.sin(a) * .08) * b; body.py -= .1 * b;
      rig.arm_L.rx += (-1.1 + Math.sin(a) * .4) * b; rig.arm_R.rx += (.45 + Math.sin(a) * .4) * b; rig.arm_L.rz -= (.25 + Math.cos(a) * .15) * b; rig.arm_R.rz += (.25 - Math.cos(a) * .15) * b;
      rig.head.rx += .25 * b;
    } else if (b > .01) {
      // Holding the torch into the dock, head down, watching the needle.
      rig.arm_R.rx += -.2 * b; rig.arm_L.rx += -.5 * b; rig.head.rx += .3 * b; body.rx += .12 * b;
    }
    // Flat, the limbs go out like a paper doll's.
    rig.arm_L.rz += lie * 1.1; rig.arm_R.rz -= lie * 1.1; rig.leg_L.rz += lie * .35; rig.leg_R.rz -= lie * .35;
    rig.apply();

    // Where the torch is and where it points, for the light (actors.js lends it one) and the lens glow.
    // With the phone up the torch hangs at the floor.
    const aimP = pitch + (-.9 - pitch) * this.phRaise, cp = Math.cos(aimP);
    this.lens.getWorldPosition(this.hand);
    this.aim.set(Math.sin(tr.yaw) * cp, Math.sin(aimP), Math.cos(tr.yaw) * cp);
    this.glow.visible = this.on && !inside;
  }
}
