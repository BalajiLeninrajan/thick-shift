// A model as the animator sees it: named rigid parts (tools/models/README.md
// is the contract), each with offsets from its rest pose that the layers of
// animation add to during a frame and apply() writes once at the end.
import { defined } from '@thick-shift/sim/check';
import type { NonEmpty } from '@thick-shift/sim/types';
import * as THREE from 'three';
import { context2d } from '../../dom';

const e = new THREE.Euler(0, 0, 0, 'YXZ'),
  q = new THREE.Quaternion();

class Part {
  o: THREE.Object3D;
  restP: THREE.Vector3;
  restQ: THREE.Quaternion;
  restS: THREE.Vector3;
  at = new THREE.Vector3(); // the pivot at rest, in the model's own space (y up from the floor, z forward)
  // radians, about the part's own axes: yaw, then pitch, then roll
  rx = 0;
  ry = 0;
  rz = 0;
  // metres, in its parent's space
  px = 0;
  py = 0;
  pz = 0;
  s = 1;
  // springs for parts that lag (see lag()): angle and velocity on x and z
  ax = 0;
  az = 0;
  vx = 0;
  vz = 0;
  seed = 0;
  depth = 0;
  rzSpin = 0; // turned on and on by styles.ts's tooth rings
  constructor(o: THREE.Object3D) {
    this.o = o;
    this.restP = o.position.clone();
    this.restQ = o.quaternion.clone();
    this.restS = o.scale.clone();
  }
  apply(): void {
    const o = this.o;
    o.quaternion.copy(this.restQ).multiply(q.setFromEuler(e.set(this.rx, this.ry, this.rz)));
    o.position.set(this.restP.x + this.px, this.restP.y + this.py, this.restP.z + this.pz);
    o.scale.copy(this.restS).multiplyScalar(this.s);
    this.rx = this.ry = this.rz = this.px = this.py = this.pz = 0;
    this.s = 1;
  }
}

// Stands in for a part the model does not have, so poses need no ifs. It is in no rig's list, so nothing applies it.
const NONE = new Part(new THREE.Object3D());

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
  list: Part[];
  has: Record<Named, boolean>;
  chains: Record<string, NonEmpty<Part>>;
  sways: Part[];
  hipH: number;
  hipX: number;
  headH: number;
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

// A soft round point for a sprite: white in the middle, `rgb` at `alpha` a fraction `at` of the way out, nothing at the edge.
export function glowTexture(at: number, rgb: string, alpha: number): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const c = context2d(cv),
    g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, '#fff');
  g.addColorStop(at, `rgba(${rgb},${alpha})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g;
  c.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(cv);
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
    const p = new Part(o);
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
    // Object.fromEntries types what it builds as a string record, hence the cast.
    has = Object.fromEntries(NAMED.map(n => [n, all.has(n)])) as Record<Named, boolean>;
  // What the gait needs to know to keep feet where they land.
  const leg = part('leg_L'),
    hipH = has.leg_L ? leg.at.y : 1;
  return {
    list,
    has,
    chains,
    sways,
    hipH,
    hipX: has.leg_L ? Math.abs(leg.at.x) : 0.3,
    headH: has.head ? part('head').at.y : hipH * 2,
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
