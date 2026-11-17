// Loading models from public/models. A model that is missing or fails to load
// resolves to null, and whoever asked draws a stand-in.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const draco = new DRACOLoader().setDecoderPath('vendor/three/addons/libs/draco/gltf/');
const loader = new GLTFLoader().setDRACOLoader(draco);
const cache = new Map();

// The scene of models/<name>.glb. Loaded once; clone it before adding it twice.
export function loadGLB(name) {
  if (!cache.has(name)) cache.set(name, loader.loadAsync(`models/${name}.glb`).then(g => g.scene, () => null));
  return cache.get(name);
}
export function loadJSON(name) {
  if (!cache.has(name + '.json')) cache.set(name + '.json', fetch(`models/${name}.json`).then(r => r.ok ? r.json() : null).catch(() => null));
  return cache.get(name + '.json');
}

// The colour eyes are in the dark: the pale of the 2D art's eye points.
export const EYE_PALE = 0xf5e0dc;

// A model made ready for the actors, once: materials named eye_glow become
// unlit and ignore fog, so two points show across a dark hall, and every mesh
// casts a shadow (only the local torch has a shadow map). Returns the source;
// take copies with instance().
export function loadActor(name) {
  const key = name + '|actor';
  if (!cache.has(key)) cache.set(key, loadGLB(name).then(src => {
    if (!src) return null;
    const glows = new Map();
    src.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      const m = o.material;
      if (!m.name?.startsWith('eye_glow')) return;
      if (!glows.has(m)) glows.set(m, new THREE.MeshBasicMaterial({ name: 'eye_glow', color: m.emissive?.getHex() ? m.emissive : EYE_PALE, map: m.emissiveMap || null, fog: false }));
      o.material = glows.get(m); o.castShadow = false; o.userData.glow = true;
    });
    return src;
  }));
  return cache.get(key);
}

// A copy of a loaded model that shares its geometry and materials with the
// source, so four mascots and eight guards cost the GPU one of each.
export const instance = src => src.clone(true);

// One part of a multi-part GLB, by node name (userData.name survives the
// loader's renaming). Null when the file or the node is missing.
export function loadPart(file, node) {
  return loadGLB(file).then(src => {
    let found = null;
    src?.traverse(o => { if (!found && (o.userData.name || o.name) === node) found = o; });
    return found ? found.clone(true) : null;
  });
}
