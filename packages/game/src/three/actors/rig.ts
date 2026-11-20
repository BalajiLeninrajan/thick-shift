// A model as the animator sees it: named rigid parts (tools/models/README.md
// is the contract), each with offsets from its rest pose that the layers of
// animation add to during a frame and apply() writes once at the end.
import { defined } from '@thick-shift/sim/check';
import type { NonEmpty } from '@thick-shift/sim/types';
import * as THREE from 'three';

const e = new THREE.Euler(0, 0, 0, 'YXZ'),
  q = new THREE.Quaternion();

class Part {
  declare o: THREE.Object3D | null; // null only on NONE
  declare name: string;
  declare restP: THREE.Vector3;
  declare restQ: THREE.Quaternion;
  declare restS: THREE.Vector3;
  declare at: THREE.Vector3;
  declare rx: number;
  declare ry: number;
  declare rz: number;
  declare px: number;
  declare py: number;
  declare pz: number;
  declare s: number;
  declare ax: number;
  declare az: number;
  declare vx: number;
  declare vz: number;
  declare seed: number;
  declare depth: number;
  declare rzSpin?: number; // set by styles.ts's tooth rings, which turn on and on
  constructor(o: THREE.Object3D, name: string) {
    this.o = o;
    this.name = name;
    this.restP = o.position.clone();
    this.restQ = o.quaternion.clone();
    this.restS = o.scale.clone();
    this.at = new THREE.Vector3(); // the pivot at rest, in the model's own space (y up from the floor, z forward)
    this.rx = this.ry = this.rz = 0; // radians, about the part's own axes: yaw, then pitch, then roll
    this.px = this.py = this.pz = 0; // metres, in its parent's space
    this.s = 1;
    // springs for parts that lag (see lag()): angle and velocity on x and z
    this.ax = this.az = this.vx = this.vz = 0;
    this.seed = 0;
    this.depth = 0;
  }
  apply(): void {
    const o = this.o;
    if (!o) {
      this.rx = this.ry = this.rz = this.px = this.py = this.pz = 0;
      this.s = 1;
      return;
    }
    o.quaternion.copy(this.restQ).multiply(q.setFromEuler(e.set(this.rx, this.ry, this.rz)));
    o.position.set(this.restP.x + this.px, this.restP.y + this.py, this.restP.z + this.pz);
    o.scale.copy(this.restS).multiplyScalar(this.s);
    this.rx = this.ry = this.rz = this.px = this.py = this.pz = 0;
    this.s = 1;
  }
}

// Stands in for a part the model does not have, so poses need no ifs.
const NONE = new Part(new THREE.Object3D(), '');
NONE.o = null;

const NAMED = [
  'root',
  'body',
  'neck',
  'head',
  'jaw',
  'eye_L',
  'eye_R',
  'arm_L',
  'arm_R',
  'forearm_L',
  'forearm_R',
  'leg_L',
  'leg_R',
  'shin_L',
  'shin_R',
] as const;
type Named = (typeof NAMED)[number];
const hashStr = (s: string): number => {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return h / 9973;
};

export type { Part };

// A model's parts by name, the contract's named ones as fields (NONE where the model has none), and what the gait
// needs. chains: extra_N chains, by N. sways: the sway_ parts.
export type Rig = Record<Named, Part> & {
  model: THREE.Object3D;
  all: Map<string, Part>;
  list: Part[];
  has: Record<string, boolean>;
  chains: Record<string, NonEmpty<Part>>;
  sways: Part[];
  hipH: number;
  hipX: number;
  headH: number;
  part: (name: string) => Part;
  chain: (n: number | string) => readonly Part[];
  apply: () => void;
};

// Calls fn on every mesh under root, root included.
export function eachMesh(root: THREE.Object3D, fn: (mesh: THREE.Mesh) => void): void {
  root.traverse(o => {
    if (o instanceof THREE.Mesh) fn(o);
  });
}

// A geometry's bounding box, worked out afresh.
export function bounds(geometry: THREE.BufferGeometry): THREE.Box3 {
  geometry.computeBoundingBox();
  return defined(geometry.boundingBox, 'the bounding box computeBoundingBox sets');
}

export function buildRig(model: THREE.Object3D): Rig {
  const all = new Map<string, Part>(),
    list: Part[] = [],
    chains: Record<string, NonEmpty<Part>> = {},
    sways: Part[] = [];
  model.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  model.traverse(o => {
    // GLTFLoader keeps the file's node name in userData.name and may rename the object itself.
    const name = o.userData.name || (o instanceof THREE.Mesh && o.parent?.userData.name ? '' : o.name);
    if (!name || all.has(name)) return;
    const p = new Part(o, name);
    p.at.setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv);
    p.seed = hashStr(name);
    all.set(name, p);
    list.push(p);
  });
  // extra_3, extra_3_2, extra_3_3 ... is one chain, root first.
  for (const [name, p] of all) {
    if (/^extra_\d+$/.test(name)) {
      const links: [Part, ...Part[]] = [p];
      for (let k = 2; ; k++) {
        const next = all.get(`${name}_${k}`);
        if (!next) break;
        links.push(next);
      }
      for (const [i, l] of links.entries()) l.depth = i;
      chains[name.slice('extra_'.length)] = links;
    } else if (name.startsWith('sway_')) sways.push(p);
  }
  const part = (name: string): Part => all.get(name) || NONE,
    has = Object.fromEntries(NAMED.map(n => [n, all.has(n)]));
  // What the gait needs to know to keep feet where they land.
  const leg = part('leg_L'),
    hipH = has.leg_L ? leg.at.y : 1;
  return {
    model,
    all,
    list,
    has,
    chains,
    sways,
    hipH,
    hipX: has.leg_L ? Math.abs(leg.at.x) : 0.3,
    headH: has.head ? part('head').at.y : hipH * 2,
    part,
    chain: n => chains[n] || [],
    apply: () => {
      for (const p of list) p.apply();
    },
    root: part('root'),
    body: part('body'),
    neck: part('neck'),
    head: part('head'),
    jaw: part('jaw'),
    eye_L: part('eye_L'),
    eye_R: part('eye_R'),
    arm_L: part('arm_L'),
    arm_R: part('arm_R'),
    forearm_L: part('forearm_L'),
    forearm_R: part('forearm_R'),
    leg_L: leg,
    leg_R: part('leg_R'),
    shin_L: part('shin_L'),
    shin_R: part('shin_R'),
  };
}

// A hanging part lags behind what it hangs from: a damped spring pulled by
// (tx, tz), the angles it would settle at. Cheap, and enough for hair and guts.
export function lag(p: Part, tx: number, tz: number, dt: number, stiff: number, damp: number, limit: number): void {
  p.vx += ((tx - p.ax) * stiff - p.vx * damp) * dt;
  p.vz += ((tz - p.az) * stiff - p.vz * damp) * dt;
  p.ax = Math.max(-limit, Math.min(limit, p.ax + p.vx * dt));
  p.az = Math.max(-limit, Math.min(limit, p.az + p.vz * dt));
  p.rx += p.ax;
  p.rz += p.az;
}
