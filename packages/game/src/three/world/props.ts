// Furniture and clutter from the two prop kits (models/props_a.glb and
// props_b.glb), stood where the sim's dressing.ts says. Everything static in a room
// that shares a material is merged into one mesh, so a room full of chairs
// is a handful of draw calls, and rooms that cannot be seen from where the
// guard stands are not drawn at all.
// A kit that is missing leaves its props out and nothing else changes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadGLB } from '../assets';
import { ROOMS3 } from '@thick-shift/sim/map';
import { DRESSING } from '@thick-shift/sim/dressing';
import { floorY } from './shell';
import { lit } from './light';
import type { Levels } from './light';

// A node of a kit model as traverse() hands it over: a mesh when isMesh is set, wearing the kit's own material or, once
// dressed, the one dressMaterial gave it.
type KitMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial | THREE.MeshBasicMaterial>;

const KITS = ['props_a', 'props_b'];
// Materials the kits mean to be lit from inside, and which of the building's light levels drives each.
const GLOW: Record<string, keyof Levels> = { lamp_glow: 'on', screen_glow: 'screen', sign_glow: 'on', exit_glow: 'exit', status_glow: 'on' };
// Props with a part that keeps moving: [child node, radians per second about its z].
const SPIN: Record<string, [part: string, speed: number]> = { wall_fan: ['blades', 1.1] };

// Vertex colours as RGB. three.js builds a different program for RGBA ones, so a material drawn on both would have
// its program worked out again at every switch, many times a frame. The kits' alphas are all 1.
function rgb(g: THREE.BufferGeometry): void {
  const c = g.attributes.color;
  if (!c || c.itemSize === 3) return;
  const out = new Float32Array(c.count * 3);
  for (let i = 0; i < c.count; i++) out.set([c.getX(i), c.getY(i), c.getZ(i)], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(out, 3));
}

// Every prop of both kits by name. A node's own position is its place on the kit's contact sheet, not in the game.
const nodes: Promise<Map<string, THREE.Object3D>> = Promise.all(KITS.map(loadGLB)).then((scenes: (THREE.Group | null)[]) => {
  const byName = new Map<string, THREE.Object3D>();
  for (const scene of scenes)
    for (const node of scene?.children || []) {
      node.traverse(o => {
        if ((o as KitMesh).isMesh) rgb((o as KitMesh).geometry);
      });
      byName.set(node.name, node);
    }
  return byName;
});

const glowing = new Map<THREE.Material, { mat: THREE.MeshBasicMaterial; base: THREE.Color; level: keyof Levels }>(); // kit glow material -> { mat, level }
const DEAD = lit(new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.25 })); // a lamp with nothing behind the glass
// dead: its lamps are out, so its glow materials are just dark glass.
function dressMaterial(m: THREE.MeshStandardMaterial, dead?: boolean): THREE.MeshStandardMaterial | THREE.MeshBasicMaterial {
  const level = GLOW[m.name];
  if (!level) return lit(m);
  if (dead) return DEAD;
  if (!glowing.has(m)) {
    // a glow with a picture shows the picture; one without shows its colour
    const map = m.emissiveMap || m.map,
      base = map ? new THREE.Color(1, 1, 1) : m.emissive.getHex() ? m.emissive.clone() : m.color.clone();
    glowing.set(m, { mat: new THREE.MeshBasicMaterial({ map, name: m.name }), base, level });
  }
  return glowing.get(m).mat;
}

// A copy of one prop, standing at the origin, ready to add to the scene. Null if its kit has not been built.
export async function prop(name: string): Promise<THREE.Object3D | null> {
  const node = (await nodes).get(name);
  if (!node) return null;
  const copy = node.clone(true);
  copy.position.set(0, 0, 0);
  copy.traverse(o => {
    if ((o as KitMesh).isMesh) {
      (o as KitMesh).material = dressMaterial((o as KitMesh).material as THREE.MeshStandardMaterial);
      o.castShadow = !(o as KitMesh).material.transparent && !((o as KitMesh).material as THREE.MeshBasicMaterial).isMeshBasicMaterial;
      o.receiveShadow = true;
    }
  });
  return copy;
}

// Geometries from different props only merge if they carry the same attributes in the same form.
function plain(geo: THREE.BufferGeometry, names: string[]): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name];
    if (!names.includes(name)) {
      g.deleteAttribute(name);
      continue;
    }
    if (a.array instanceof Float32Array && !a.normalized && !(a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  const n = g.attributes.position.count;
  if (names.includes('color') && !g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  rgb(g);
  if (names.includes('uv') && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  g.morphAttributes = {};
  return g;
}

export function createProps(scene: THREE.Scene) {
  const rooms = ROOMS3.map(room => {
      const g = new THREE.Group();
      g.name = 'props: ' + room.name;
      scene.add(g);
      return g;
    }),
    spinning: [part: THREE.Object3D, speed: number][] = [];

  nodes.then(byName => {
    const m = new THREE.Matrix4(),
      q = new THREE.Quaternion(),
      up = new THREE.Vector3(0, 1, 0),
      one = new THREE.Vector3();
    DRESSING.forEach((rows, room) => {
      const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>(); // the material it will be drawn with -> geometries
      for (const [name, x, z, yaw = 0, opt = {}] of rows) {
        const node = byName.get(name);
        if (!node) continue;
        const y = opt.y ?? (opt.hang ? ROOMS3[room].h : floorY(x, z));
        m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, (yaw * Math.PI) / 180), one.setScalar(opt.s || 1));
        if (SPIN[name]) {
          const at = m.clone();
          prop(name).then(model => {
            model.applyMatrix4(at);
            rooms[room].add(model);
            const part = model.getObjectByName(SPIN[name][0]);
            if (part) spinning.push([part, SPIN[name][1]]);
          });
          continue;
        }
        const copy = node.clone(true);
        copy.position.set(0, 0, 0);
        copy.updateMatrixWorld(true);
        copy.traverse(o => {
          if (!(o as KitMesh).isMesh) return;
          const mat = dressMaterial((o as KitMesh).material as THREE.MeshStandardMaterial, opt.dead);
          if (!buckets.has(mat)) buckets.set(mat, []);
          buckets.get(mat).push((o as KitMesh).geometry.clone().applyMatrix4(m.clone().multiply(o.matrixWorld)));
        });
      }
      for (const [mat, geos] of buckets) {
        const names = ['position', 'normal', 'uv', ...(geos.some(g => g.attributes.color) ? ['color'] : [])];
        const mesh = new THREE.Mesh(mergeGeometries(geos.map(g => plain(g, names))), mat);
        mesh.castShadow = !mat.transparent && !(mat as THREE.MeshBasicMaterial).isMeshBasicMaterial;
        mesh.receiveShadow = true;
        rooms[room].add(mesh);
      }
    });
  });

  return {
    // Resolves, once the kits have loaded or failed to, with a test for whether a prop exists.
    ready: nodes.then(byName => name => byName.has(name)),
    // inView: the rooms that might be seen from the camera (sight.ts). level: the building's light levels from light.ts, by group.
    update(inView: Set<number>, level: Levels, dt: number): void {
      rooms.forEach((g, i) => {
        g.visible = inView.has(i);
      });
      for (const { mat, base, level: k } of glowing.values()) mat.color.copy(base).multiplyScalar(level[k]);
      for (const [part, speed] of spinning) part.rotation.z += speed * level.on * dt;
    },
  };
}
