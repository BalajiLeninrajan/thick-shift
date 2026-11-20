// Loading models from models/ (packages/game/public/models, served as-is). A model
// that is missing or fails to load resolves to null, and whoever asked draws a stand-in.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader, DRACO_GLTF_CONFIG } from 'three/addons/loaders/DRACOLoader.js';

// three's own glTF-only Draco decoder. DRACOLoader names its files with import.meta.url,
// so the bundler serves them in dev and copies them, hashed, into the build. Given these
// URLs it has only the WebAssembly decoder, with no pure-JS fallback, so a browser without
// WebAssembly draws stand-ins for every model. Every browser with WebGL 2 has WebAssembly.
const draco = new DRACOLoader().setDecoderPath(DRACO_GLTF_CONFIG);
const loader = new GLTFLoader().setDRACOLoader(draco);
const cache = new Map<string, Promise<unknown>>();

// models/<mascot>.json, one entry per stage of the mascot's model (actors/mascot.ts reads it).
export interface ModelStage {
  file: string;
  height: number;
  radius: number;
  face: [number, number, number];
  floats: boolean;
  nodes: string[];
  notes: string;
}
export interface ModelInfo {
  key: string;
  stages: ModelStage[];
}

// The scene of models/<name>.glb. Loaded once; clone it before adding it twice.
export function loadGLB(name: string): Promise<THREE.Group | null> {
  if (!cache.has(name))
    cache.set(
      name,
      loader.loadAsync(`models/${name}.glb`).then(
        g => g.scene,
        () => null
      )
    );
  return cache.get(name) as Promise<THREE.Group | null>;
}
export function loadJSON(name: string): Promise<ModelInfo | null> {
  if (!cache.has(`${name}.json`))
    cache.set(
      `${name}.json`,
      fetch(`models/${name}.json`)
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null)
    );
  return cache.get(`${name}.json`) as Promise<ModelInfo | null>;
}

// The colour eyes are in the dark: a warm off-white (Catppuccin rosewater).
export const EYE_PALE = 0xf5e0dc;

// A model made ready for the actors, once: materials named eye_glow become
// unlit and ignore fog, so two points show across a dark hall, and every mesh
// casts a shadow (only the local torch has a shadow map). Returns the source;
// take copies with instance().
export function loadActor(name: string): Promise<THREE.Group | null> {
  const key = `${name}|actor`;
  if (!cache.has(key))
    cache.set(
      key,
      loadGLB(name).then(src => {
        if (!src) return null;
        const glows = new Map<THREE.Material, THREE.MeshBasicMaterial>();
        src.traverse(o => {
          if (!(o as THREE.Mesh).isMesh) return;
          o.castShadow = o.receiveShadow = true;
          const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (!m.name?.startsWith('eye_glow')) return;
          if (!glows.has(m))
            glows.set(
              m,
              new THREE.MeshBasicMaterial({ name: 'eye_glow', color: m.emissive?.getHex() ? m.emissive : EYE_PALE, map: m.emissiveMap || null, fog: false })
            );
          (o as THREE.Mesh).material = glows.get(m);
          o.castShadow = false;
          o.userData.glow = true;
        });
        return src;
      })
    );
  return cache.get(key) as Promise<THREE.Group | null>;
}

// A copy of a loaded model that shares its geometry and materials with the
// source, so four mascots and eight guards cost the GPU one of each.
export const instance = <T extends THREE.Object3D>(src: T): T => src.clone(true);

// One part of a multi-part GLB, by node name (userData.name survives the
// loader's renaming). Null when the file or the node is missing.
export function loadPart(file: string, node: string): Promise<THREE.Object3D | null> {
  return loadGLB(file).then(src => {
    let found: THREE.Object3D | null = null;
    src?.traverse(o => {
      if (!found && (o.userData.name || o.name) === node) found = o;
    });
    return found ? found.clone(true) : null;
  });
}
