// A model as the animator sees it: named rigid parts (tools/models/README.md
// is the contract), each with offsets from its rest pose that the layers of
// animation add to during a frame and apply() writes once at the end.
import * as THREE from 'three';

const e = new THREE.Euler(0, 0, 0, 'YXZ'), q = new THREE.Quaternion(), v = new THREE.Vector3();

class Part {
  constructor(o, name) {
    this.o = o; this.name = name;
    this.restP = o.position.clone(); this.restQ = o.quaternion.clone(); this.restS = o.scale.clone();
    this.at = new THREE.Vector3();   // the pivot at rest, in the model's own space (y up from the floor, z forward)
    this.rx = this.ry = this.rz = 0;   // radians, about the part's own axes: yaw, then pitch, then roll
    this.px = this.py = this.pz = 0;   // metres, in its parent's space
    this.s = 1;
    // springs for parts that lag (see lag()): angle and velocity on x and z
    this.ax = this.az = this.vx = this.vz = 0;
    this.seed = 0; this.depth = 0;
  }
  apply() {
    const o = this.o;
    if (!o) { this.rx = this.ry = this.rz = this.px = this.py = this.pz = 0; this.s = 1; return; }
    o.quaternion.copy(this.restQ).multiply(q.setFromEuler(e.set(this.rx, this.ry, this.rz)));
    o.position.set(this.restP.x + this.px, this.restP.y + this.py, this.restP.z + this.pz);
    o.scale.copy(this.restS).multiplyScalar(this.s);
    this.rx = this.ry = this.rz = this.px = this.py = this.pz = 0; this.s = 1;
  }
}

// Stands in for a part the model does not have, so poses need no ifs.
const NONE = new Part(new THREE.Object3D(), '');
NONE.o = null;

const NAMED = ['root', 'body', 'neck', 'head', 'jaw', 'eye_L', 'eye_R', 'arm_L', 'arm_R', 'forearm_L', 'forearm_R', 'leg_L', 'leg_R', 'shin_L', 'shin_R'];
const hashStr = s => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973; return h / 9973; };

export function buildRig(model) {
  const all = new Map(), rig = { model, all, list: [], has: {}, chains: {}, sways: [] };
  model.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  model.traverse(o => {
    // GLTFLoader keeps the file's node name in userData.name and may rename the object itself.
    const name = o.userData.name || (o.isMesh && o.parent?.userData.name ? '' : o.name);
    if (!name || all.has(name)) return;
    const p = new Part(o, name);
    p.at.setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv); p.seed = hashStr(name);
    all.set(name, p); rig.list.push(p);
  });
  for (const n of NAMED) { rig[n] = all.get(n) || NONE; rig.has[n] = all.has(n); }
  // extra_3, extra_3_2, extra_3_3 ... is one chain, root first.
  for (const [name, p] of all) {
    const m = /^extra_(\d+)$/.exec(name);
    if (m) { const links = [p]; for (let k = 2; all.has(`${name}_${k}`); k++) links.push(all.get(`${name}_${k}`)); links.forEach((l, i) => { l.depth = i; }); rig.chains[m[1]] = links; }
    else if (name.startsWith('sway_')) rig.sways.push(p);
  }
  // What the gait needs to know to keep feet where they land.
  rig.hipH = rig.has.leg_L ? rig.leg_L.at.y : 1;
  rig.hipX = rig.has.leg_L ? Math.abs(rig.leg_L.at.x) : .3;
  rig.headH = rig.has.head ? rig.head.at.y : rig.hipH * 2;
  rig.part = name => all.get(name) || NONE;
  rig.chain = n => rig.chains[n] || [];
  rig.apply = () => { for (const p of rig.list) p.apply(); };
  return rig;
}

// The world position of a point given in a part's own space.
export function worldOf(part, local, out) { return part.o ? part.o.localToWorld(out.copy(local)) : out.set(0, 0, 0); }
// A point in the model's space, as a point in a part's own space at rest.
export function localAt(rig, part, modelPoint, out) { return out.copy(modelPoint).sub(part.at); }   // parts have no rest rotation

// A hanging part lags behind what it hangs from: a damped spring pulled by
// (tx, tz), the angles it would settle at. Cheap, and enough for hair and guts.
export function lag(p, tx, tz, dt, stiff, damp, limit) {
  p.vx += ((tx - p.ax) * stiff - p.vx * damp) * dt; p.vz += ((tz - p.az) * stiff - p.vz * damp) * dt;
  p.ax = Math.max(-limit, Math.min(limit, p.ax + p.vx * dt)); p.az = Math.max(-limit, Math.min(limit, p.az + p.vz * dt));
  p.rx += p.ax; p.rz += p.az;
}
