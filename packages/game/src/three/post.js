// The last step of every frame, and how much the frame is allowed to cost.
// The scene is drawn into a half-float buffer at the quality's resolution,
// then one full-screen pass turns it into the picture: exposure and tone
// mapping, vignette, grain, colour fringing at the edges, and tearing when
// something is close. One pass, because every extra one is a whole screen of
// pixels on a GPU that has none to spare.
//
// The one exception is the outline of usable things (outline.js). Only while
// something is marked, those objects are drawn again, flat, into a mask the
// size of the scene, each fragment dropped where the scene's depth says a
// wall is in front. The full-screen pass then edges the mask and lays the
// edge over the finished picture, so it shows in the dark.
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
const SLOW_MS = 26,
  WARMUP = 40,
  SAMPLE = 60;
const EXPOSURE = 1.5;
const OUTLINE_LAYER = 7; // marked meshes are put on this layer for the mask pass
const MASK_VERT = `
#include <common>
#include <skinning_pars_vertex>
void main() {
  #include <begin_vertex>
  #include <skinbase_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
}`;
const MASK_FRAG = `
#include <packing>
uniform sampler2D tDepth; uniform vec2 uSize; uniform float uNear, uFar; uniform vec4 uCol;
void main() {
  float scene = -perspectiveDepthToViewZ( texture2D( tDepth, gl_FragCoord.xy / uSize ).x, uNear, uFar );
  float self = -perspectiveDepthToViewZ( gl_FragCoord.z, uNear, uFar );
  if ( self > scene + .12 ) discard;   // a wall, or something else, is in front
  gl_FragColor = uCol;
}`;

const FRAG = `
uniform sampler2D tScene, tMask; uniform float uTime, uThreat, uDread, uExposure, uOutline; uniform vec2 uTexel; varying vec2 vUv;
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
  // The outline: the strongest mark next to this pixel, if this pixel is not itself marked. Stronger marks reach
  // further, for a thicker edge: faults and flat friends twice as far as the faint ones, and what the use key would
  // act on (alpha 1) three times.
  if ( uOutline > .5 ) {
    vec4 here = texture2D( tMask, vUv ), best = vec4( 0. );
    for ( int k = 0; k < 8; k++ ) {
      float a = float( k ) * .785398;
      vec2 d = vec2( cos( a ), sin( a ) ) * uTexel;
      vec4 s = texture2D( tMask, vUv + d * 1.5 );
      if ( s.a > best.a ) best = s;
      s = texture2D( tMask, vUv + d * 3. );
      if ( s.a > .55 && s.a > best.a ) best = s;
      s = texture2D( tMask, vUv + d * 4.5 );
      if ( s.a > .95 && s.a > best.a ) best = s;
    }
    float edge = best.a * ( 1. - step( .02, here.a ) );
    col = mix( col, best.rgb, edge );
    col += here.rgb * here.a * .06;   // a faint wash inside, so a small thing still reads
  }
  // Grain goes on last, in display space, so the dark has texture too. With
  // the small lift under it, black areas stay black but never one flat value.
  float grain = hash( gl_FragCoord.xy + fract( uTime ) * vec2( 113., 71. ) ) - .5;
  col += grain * ( .04 + .03 * uDread + .07 * uThreat ) + vec3( .008, .009, .012 );
  gl_FragColor = vec4( col, 1. );
}`;

// torch: the local guard's SpotLight, whose shadow map follows the quality.
export function createPost(renderer, torch) {
  const asked = new URLSearchParams(location.search).get('q');
  let name = QUALITY[asked] ? asked : 'high',
    frames = 0,
    spent = 0,
    last = 0;
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1) });
  const mask = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  // Each marked mesh gets a mask material of its own, sharing these uniforms and keeping its colour in uCol. One
  // shared override material would flip between skinned and plain meshes, and three.js re-derives a material's
  // program every time it does.
  const maskU = { tDepth: { value: target.depthTexture }, uSize: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.1 }, uFar: { value: 100 } };
  const maskMats = new WeakMap();
  const maskMatOf = o => {
    let m = maskMats.get(o);
    if (!m)
      maskMats.set(
        o,
        (m = new THREE.ShaderMaterial({
          uniforms: { ...maskU, uCol: { value: new THREE.Vector4() } },
          vertexShader: MASK_VERT,
          fragmentShader: MASK_FRAG,
          side: THREE.DoubleSide,
          blending: THREE.NoBlending,
          depthTest: false,
          depthWrite: false,
        }))
      );
    return m;
  };
  const swapped = [],
    black = new THREE.Color(0);
  function drawMask(scene, camera, marks) {
    for (const m of marks)
      m.obj.traverse(o => {
        if (!o.isMesh || o.layers.isEnabled(OUTLINE_LAYER)) return;
        const mm = maskMatOf(o);
        mm.uniforms.uCol.value.set(m.col[0], m.col[1], m.col[2], m.a);
        swapped.push(o, o.material);
        o.material = mm;
        o.layers.enable(OUTLINE_LAYER);
      });
    if (!swapped.length) return false;
    const bg = scene.background,
      layers = camera.layers.mask;
    maskU.uSize.value.set(target.width, target.height);
    maskU.uNear.value = camera.near;
    maskU.uFar.value = camera.far;
    // The lights go on the mask's layer too. three.js keeps one light setup per scene, and a pass that saw no lights
    // would make every lit material in the next frame's scene pass work out its program again (most of a frame's
    // JavaScript on an Iris 655).
    scene.traverse(o => {
      if (o.isLight) o.layers.enable(OUTLINE_LAYER);
    });
    // The torch's shadow and every matrix in the scene were brought up to date by the scene pass; not again.
    const shadows = renderer.shadowMap.autoUpdate,
      matrices = scene.matrixWorldAutoUpdate;
    scene.background = null;
    camera.layers.set(OUTLINE_LAYER);
    renderer.shadowMap.autoUpdate = false;
    scene.matrixWorldAutoUpdate = false;
    renderer.setRenderTarget(mask);
    renderer.setClearColor(black, 0);
    renderer.clear(true, false, false);
    renderer.render(scene, camera);
    scene.background = bg;
    camera.layers.mask = layers;
    renderer.shadowMap.autoUpdate = shadows;
    scene.matrixWorldAutoUpdate = matrices;
    for (let i = 0; i < swapped.length; i += 2) {
      swapped[i].material = swapped[i + 1];
      swapped[i].layers.disable(OUTLINE_LAYER);
    }
    swapped.length = 0;
    return true;
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: target.texture },
      tMask: { value: mask.texture },
      uTime: { value: 0 },
      uThreat: { value: 0 },
      uDread: { value: 0 },
      uExposure: { value: EXPOSURE },
      uOutline: { value: 0 },
      uTexel: { value: new THREE.Vector2() },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0., 1. ); }',
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
  });
  // one triangle that covers the screen
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const screen = new THREE.Mesh(tri, mat),
    flat = new THREE.Camera();
  screen.frustumCulled = false;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.info.autoReset = false; // so renderer.info counts the scene, not just the last pass

  function apply() {
    const q = QUALITY[name];
    mat.defines = q.fringe ? { FRINGE: 1 } : {};
    mat.needsUpdate = true;
    torch.shadow.mapSize.setScalar(q.shadow);
    torch.shadow.map?.dispose();
    torch.shadow.map = null;
  }
  apply();

  return {
    get quality() {
      return name;
    },
    // Match the drawing buffer to the canvas, within what the quality allows.
    fit(canvas, camera) {
      const w = canvas.clientWidth,
        h = canvas.clientHeight,
        q = QUALITY[name],
        ratio = Math.min(devicePixelRatio || 1, q.width / Math.max(1, w), q.ratio);
      const pw = Math.round(w * ratio),
        ph = Math.round(h * ratio);
      if (!w || (target.width === pw && target.height === ph)) return;
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h, false);
      target.setSize(pw, ph);
      mask.setSize(pw, ph);
      // Edge width in texels, so the outline is about as thick on any screen.
      const k = Math.max(1, ph / 720);
      mat.uniforms.uTexel.value.set(k / pw, k / ph);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    // threat, dread: 0 to 1. stop: exposure multiplier against torch glare. now: milliseconds, for timing frames.
    // marks: what to outline this frame (outline.js), or nothing.
    render(scene, camera, now, threat, dread, stop, marks = []) {
      if (!asked && name === 'high' && last) {
        if (++frames > WARMUP) spent += now - last;
        if (frames === WARMUP + SAMPLE) {
          if (spent / SAMPLE > SLOW_MS) {
            name = 'low';
            apply();
          }
        }
      }
      last = now;
      const u = mat.uniforms;
      u.uTime.value = (now / 1000) % 600;
      u.uThreat.value = threat;
      u.uDread.value = dread;
      u.uExposure.value = EXPOSURE * stop;
      renderer.info.reset();
      torch.shadow.autoUpdate = torch.intensity > 0; // no shadow pass for a torch that is off
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      u.uOutline.value = drawMask(scene, camera, marks) ? 1 : 0;
      renderer.setRenderTarget(null);
      renderer.render(screen, flat);
    },
  };
}
