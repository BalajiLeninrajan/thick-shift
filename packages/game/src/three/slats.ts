// The view out of a locker: dark slats across the picture and the edges
// closed in. It is drawn into the scene, after everything solid but before
// the guard's own hands (HANDS_ORDER), so the phone and torch held inside the
// locker stay in front of its doors. A page element over the canvas could
// not do that: it covers the hands as well.
import * as THREE from 'three';
import type { State } from '@thick-shift/sim/types';
import type { Me } from '../types';

// Render orders. Everything else is 0. The slats are drawn without a depth test, so whatever comes after them is on top.
const SLATS_ORDER = 1;
export const HANDS_ORDER = 2;
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
  // One triangle that covers the screen, as in post.js.
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  // Not marked transparent, so three.js draws it with the solid things and their render orders apply: a transparent
  // material would go after all of them, hands included. Custom blending, because three.js turns normal blending off
  // for a material that is not transparent.
  const mat = new THREE.ShaderMaterial({
    uniforms: { uShow: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0., 1. ); }',
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  }) as THREE.ShaderMaterial & { uniforms: { uShow: THREE.IUniform<number> } };
  const slats = new THREE.Mesh(tri, mat);
  slats.name = 'locker slats';
  slats.frustumCulled = false;
  slats.renderOrder = SLATS_ORDER;
  slats.visible = false;
  scene.add(slats);
  let show = 0;
  return {
    // me: player.js's guard (hid, flat). busy: the catch has the camera.
    update(S: State, me: Me, dt: number, busy: boolean): void {
      const on = S.phase === 'play' && me.hid >= 0 && !me.flat && !busy;
      show += ((on ? 1 : 0) - show) * Math.min(1, dt * FADE);
      slats.visible = show > 0.01;
      mat.uniforms.uShow.value = show;
    },
  };
}
