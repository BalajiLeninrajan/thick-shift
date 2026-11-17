// The last step of every frame, and how much the frame is allowed to cost.
// The scene is drawn into a half-float buffer at the quality's resolution,
// then one full-screen pass turns it into the picture: exposure and tone
// mapping, vignette, grain, colour fringing at the edges, and tearing when
// something is close. One pass, because every extra one is a whole screen of
// pixels on a GPU that has none to spare.
import * as THREE from 'three';

// width: the most pixels across the scene is drawn at. ratio: the most
// device pixels per CSS pixel. shadow: the torch's shadow map size.
// fringe: colour fringing, which costs two more texture reads per pixel.
const QUALITY = {
  low: { width: 854, ratio: 1, shadow: 512, fringe: false },
  high: { width: 1280, ratio: 1.5, shadow: 1024, fringe: true },
};
// Start on high and drop to low if frames come slower than this, measured
// over SAMPLE frames once the first WARMUP (shader compiles) are out of the way.
const SLOW_MS = 26, WARMUP = 40, SAMPLE = 60;
const EXPOSURE = 1.5;

const FRAG = `
uniform sampler2D tScene; uniform float uTime, uThreat, uDread, uExposure; varying vec2 vUv;
float hash( vec2 p ) { vec3 q = fract( vec3( p.xyx ) * .1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
void main() {
  vec2 uv = vUv, c = uv - .5; float r2 = dot( c, c );
  // something is close: bands of the picture slip sideways
  float band = step( .99 - uThreat * .1, hash( vec2( floor( uv.y * 36. ), floor( uTime * 13. ) ) ) );
  uv.x += band * ( hash( vec2( uv.y * 90., uTime ) ) - .5 ) * .035 * uThreat;
  #ifdef FRINGE
    vec2 off = c * r2 * ( .004 + .06 * uThreat );
    vec3 col = vec3( texture2D( tScene, uv + off ).r, texture2D( tScene, uv ).g, texture2D( tScene, uv - off ).b );
  #else
    vec3 col = texture2D( tScene, uv ).rgb;
  #endif
  col *= uExposure;
  col = clamp( ( col * ( 2.51 * col + .03 ) ) / ( col * ( 2.43 * col + .59 ) + .14 ), 0., 1. );   // ACES, Narkowicz's fit
  col = pow( col, vec3( 1. / 2.2 ) );
  col = mix( vec3( dot( col, vec3( .3, .59, .11 ) ) ), col, 1. - .3 * uDread );                    // colour drains as the night goes wrong
  float vig = smoothstep( 1.05, .15, r2 * ( 2.3 + uDread * .9 + uThreat * ( 1.2 + .3 * sin( uTime * 9. ) ) ) );
  col *= mix( .2, 1., vig );
  col.r += ( 1. - vig ) * uThreat * .07;
  // Grain goes on last, in display space, so the dark has texture too. With
  // the small lift under it, black areas stay black but never one flat value.
  float grain = hash( gl_FragCoord.xy + fract( uTime ) * vec2( 113., 71. ) ) - .5;
  col += grain * ( .04 + .03 * uDread + .07 * uThreat ) + vec3( .008, .009, .012 );
  gl_FragColor = vec4( col, 1. );
}`;

// torch: the local guard's SpotLight, whose shadow map follows the quality.
export function createPost(renderer, torch) {
  const asked = new URLSearchParams(location.search).get('q');
  let name = QUALITY[asked] ? asked : 'high', frames = 0, spent = 0, last = 0;
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const mat = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: target.texture }, uTime: { value: 0 }, uThreat: { value: 0 }, uDread: { value: 0 }, uExposure: { value: EXPOSURE } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0., 1. ); }',
    fragmentShader: FRAG, depthTest: false, depthWrite: false,
  });
  // one triangle that covers the screen
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const screen = new THREE.Mesh(tri, mat), flat = new THREE.Camera();
  screen.frustumCulled = false;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.info.autoReset = false;   // so renderer.info counts the scene, not just the last pass

  function apply() {
    const q = QUALITY[name];
    mat.defines = q.fringe ? { FRINGE: 1 } : {}; mat.needsUpdate = true;
    torch.shadow.mapSize.setScalar(q.shadow); torch.shadow.map?.dispose(); torch.shadow.map = null;
  }
  apply();

  return {
    get quality() { return name; },
    // Match the drawing buffer to the canvas, within what the quality allows.
    fit(canvas, camera) {
      const w = canvas.clientWidth, h = canvas.clientHeight, q = QUALITY[name], ratio = Math.min(devicePixelRatio || 1, q.width / Math.max(1, w), q.ratio);
      const pw = Math.round(w * ratio), ph = Math.round(h * ratio);
      if (!w || (target.width === pw && target.height === ph)) return;
      renderer.setPixelRatio(ratio); renderer.setSize(w, h, false); target.setSize(pw, ph);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    },
    // threat, dread: 0 to 1. stop: exposure multiplier against torch glare. now: milliseconds, for timing frames.
    render(scene, camera, now, threat, dread, stop) {
      if (!asked && name === 'high' && last) {
        if (++frames > WARMUP) spent += now - last;
        if (frames === WARMUP + SAMPLE) { if (spent / SAMPLE > SLOW_MS) { name = 'low'; apply(); } }
      }
      last = now;
      const u = mat.uniforms; u.uTime.value = now / 1000 % 600; u.uThreat.value = threat; u.uDread.value = dread; u.uExposure.value = EXPOSURE * stop;
      renderer.info.reset();
      torch.shadow.autoUpdate = torch.intensity > 0;   // no shadow pass for a torch that is off
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      renderer.setRenderTarget(null); renderer.render(screen, flat);
    },
  };
}
