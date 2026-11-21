// The view out of a locker: dark slats across the picture and the edges
// closed in. It is drawn into the scene, after the rest of the world (glows
// and sprites included) but before the guard's own hands (holdInFront), so
// the phone and torch held inside the locker stay in front of its doors. A
// page element over the canvas could not do that: it covers the hands as well.

import type { State } from '@thick-shift/sim/types';
import * as THREE from 'three';
import type { Me } from '../types';
import { SCREEN_VERT, screenTri } from './post';

// Render orders, for the transparent pass: after everything else in the scene (guard.ts's name tags are 5, the rest
// 0), and the hands after the slats. The slats are drawn without a depth test, so whatever comes after them is on top.
const SLATS_ORDER = 100;
const HANDS_ORDER = 101;
const FADE = 8; // per second: about a third of a second to come up or go

const FRAG = `
uniform float uShow; varying vec2 vUv;
void main() {
  // Slats every 9% of the height from the top: a dark bar, a softer edge each side, and a gap.
  float p = mod( 1. - vUv.y, .09 );
  float slat = p < .036 ? .95 : p < .044 ? .55 : p < .084 ? 0. : .55;
  // Dark toward the edges, in an ellipse three quarters of the width and two thirds of the height across.
  float edge = clamp( ( length( ( vUv - .5 ) / vec2( .75, .65 ) ) - .45 ) / .5, 0., 1. );
  gl_FragColor = vec4( vec3( 0. ), ( edge + slat * ( 1. - edge ) ) * uShow );
}`;

export function createSlats(scene: THREE.Scene) {
  // Transparent, so it is drawn after the solid things, and its render order puts it after the glows (the wall
  // lights' halos, the batteries' pulse, the dust) too.
  const mat = new THREE.ShaderMaterial({
    uniforms: { uShow: { value: 0 } },
    vertexShader: SCREEN_VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  }) as THREE.ShaderMaterial & { uniforms: { uShow: THREE.IUniform<number> } };
  const slats = new THREE.Mesh(screenTri(), mat);
  slats.name = 'locker slats';
  slats.frustumCulled = false;
  slats.renderOrder = SLATS_ORDER;
  slats.visible = false;
  scene.add(slats);
  let show = 0;
  return {
    // me: player.ts's guard (hid, flat). busy: the catch has the camera.
    update(S: State, me: Me, dt: number, busy: boolean): void {
      const on = S.phase === 'play' && me.hid >= 0 && !me.flat && !busy;
      show += ((on ? 1 : 0) - show) * Math.min(1, dt * FADE);
      slats.visible = show > 0.01;
      mat.uniforms.uShow.value = show;
    },
  };
}

// Puts something held inside the locker (the phone, the torch) in front of the slats. Its meshes go in the
// transparent pass after them, but with blending off and the depth still written, so they look as solid as before.
// Each mesh gets its own copy of its material: a model's copies share theirs, and the props on the shelves and the
// other guards' torches stay solid.
export function holdInFront(o: THREE.Object3D): void {
  o.traverse(m => {
    if (!(m instanceof THREE.Mesh)) return;
    m.renderOrder = HANDS_ORDER;
    m.material = Array.isArray(m.material) ? m.material.map(drawnLast) : drawnLast(m.material);
  });
}
function drawnLast(mat: THREE.Material): THREE.Material {
  const own = mat.clone();
  own.transparent = true;
  own.blending = THREE.NoBlending;
  return own;
}
