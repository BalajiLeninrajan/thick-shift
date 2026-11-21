// Loading models from models/ (packages/game/public/models, served as-is). A model
// that is missing or fails to load resolves to null, and whoever asked draws a stand-in.
import * as THREE from 'three';
import { DRACO_GLTF_CONFIG, DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// three's own glTF-only Draco decoder. DRACOLoader names its files with import.meta.url,
// so the bundler serves them in dev and copies them, hashed, into the build. Given these
// URLs it has only the WebAssembly decoder, with no pure-JS fallback, so a browser without
// WebAssembly draws stand-ins for every model. Every browser with WebGL 2 has WebAssembly.
const draco = new DRACOLoader().setDecoderPath(DRACO_GLTF_CONFIG);
const loader = new GLTFLoader().setDRACOLoader(draco);

// Each load is made once, by name, and every later ask gets the same promise.
const glbs = new Map<string, Promise<THREE.Group | null>>(),
  infos = new Map<string, Promise<ModelInfo | null>>(),
  actors = new Map<string, Promise<THREE.Group | null>>();
function once<T>(cache: Map<string, T>, name: string, load: () => T): T {
  let made = cache.get(name);
  if (made === undefined) {
    made = load();
    cache.set(name, made);
  }
  return made;
}
// models/<mascot>.json, as far as actors/mascot.ts reads it: one entry per stage of the mascot's model. The file is
// written by the Blender scripts in tools/models and not checked here, so nothing in it is taken for granted.
// face: where the stage's face is, in model space.
export interface ModelStage {
  face?: [number, number, number];
  height?: number;
}
interface ModelInfo {
  stages?: ModelStage[];
}

// The scene of models/<name>.glb. Loaded once; clone it before adding it twice.
export function loadGLB(name: string): Promise<THREE.Group | null> {
  return once(glbs, name, () =>
    loader.loadAsync(`models/${name}.glb`).then(
      g => g.scene,
      () => null
    )
  );
}
export function loadJSON(name: string): Promise<ModelInfo | null> {
  return once(infos, name, () =>
    fetch(`models/${name}.json`)
      .then(r => (r.ok ? (r.json() as Promise<ModelInfo>) : null))
      .catch(() => null)
  );
}

// The colour eyes are in the dark: a warm off-white (Catppuccin rosewater).
export const EYE_PALE = 0xf5e0dc;

// A model made ready for the actors, once: materials named eye_glow become
// unlit and ignore fog, so two points show across a dark hall, and every mesh
// casts a shadow (only the local torch has a shadow map). Returns the source;
// take copies with instance().
export function loadActor(name: string): Promise<THREE.Group | null> {
  return once(actors, name, () =>
    loadGLB(name).then(src => {
      if (!src) return null;
      const glows = new Map<THREE.Material, THREE.MeshBasicMaterial>();
      src.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        o.castShadow = o.receiveShadow = true;
        // GLTFLoader makes a MeshStandardMaterial for every material the actor files have.
        const m = o.material;
        if (!(m instanceof THREE.MeshStandardMaterial) || !m.name.startsWith('eye_glow')) return;
        let glow = glows.get(m);
        if (!glow) {
          glow = new THREE.MeshBasicMaterial({ name: 'eye_glow', color: m.emissive.getHex() ? m.emissive : EYE_PALE, map: m.emissiveMap, fog: false });
          glows.set(m, glow);
        }
        o.material = glow;
        o.castShadow = false;
        o.userData.glow = true;
      });
      return src;
    })
  );
}

// A copy of a loaded model that shares its geometry and materials with the
// source, so four mascots and eight guards cost the GPU one of each.
export const instance = <T extends THREE.Object3D>(src: T): T => src.clone(true);

// One part of a multi-part GLB, by node name (userData.name survives the
// loader's renaming). Null when the file or the node is missing.
export function loadPart(file: string, node: string): Promise<THREE.Object3D | null> {
  return loadGLB(file).then(src => {
    const found = src && findNode(src, node);
    return found ? found.clone(true) : null;
  });
}
// The first object named node, in the order traverse() visits them: o itself, then each child's tree in turn.
function findNode(o: THREE.Object3D, node: string): THREE.Object3D | null {
  if ((o.userData.name || o.name) === node) return o;
  for (const child of o.children) {
    const found = findNode(child, node);
    if (found) return found;
  }
  return null;
}
