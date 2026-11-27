// The security cameras, watched from the booth's desk (player.ts sits the guard
// down). While a guard watches, the frame is one camera's picture instead of
// their own view: the scene drawn small from high in a corner of a room, then
// blown up with grain, scan lines, a rolling bar and a burst of static on
// every change of camera. With the power out every feed is static.
//
// The feed is the only place a mascot far off shows: the wall map and the
// phone leave them out, but for the phone's few metres (minimap.ts). Over
// the feed go the camera's name and a plan of the building with a button
// for each camera, to click or tap. Each camera is a small housing in its
// corner with a red light, so a guard walking past can see it.

import { CAMS, DESK, dist, ROOMS3, SIZE_X, SIZE_Z } from '@thick-shift/sim/map';
import type { State } from '@thick-shift/sim/types';
import * as THREE from 'three';
import { noise, tone } from '../audio';
import { query } from '../dom';
import type { Me, PlayerHandle } from '../types';
import { SCREEN_VERT, screenTri } from './post';
import { roomsSeenFrom } from './world/sight';

const FEED_H = 240; // the picture's height in pixels: a camera from the nineties
const FEED_MS = 66; // a new picture this often, about fifteen a second
const FOV = 60; // degrees, top to bottom; CAM_HALF in map.ts is about half its width on a wide screen
const PAN = { angle: 0.12, period: 14 }; // each camera sweeps this many radians either way, this many seconds a sweep
const STATIC_MS = 260; // how long a change of camera is snow
const EXPOSURE = 7; // the camera's gain: far brighter than the eye in the dark, and noisier for it
const AIM_Y = 0.9; // the height each camera points at
const BUTTON_IN = 3.5; // metres from a camera toward what it looks at, where its button goes on the plan

const FRAG = `
uniform sampler2D tFeed; uniform float uTime, uStatic, uDead, uExposure; varying vec2 vUv;
float hash( vec2 p ) { vec3 q = fract( vec3( p.xyx ) * .1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
void main() {
  vec2 c = vUv - .5; float r2 = dot( c, c );
  vec2 uv = .5 + c * ( 1. + .1 * r2 );   // the bulge of the tube
  // the bar that rolls up the picture, and the lines it drags sideways
  float roll = fract( -uTime * .09 ), bar = 1. - smoothstep( 0., .05, abs( uv.y - roll ) );
  uv.x += bar * ( hash( vec2( floor( uv.y * 240. ), floor( uTime * 24. ) ) ) - .5 ) * .02;
  vec3 col = texture2D( tFeed, uv ).rgb * uExposure;
  col = clamp( ( col * ( 2.51 * col + .03 ) ) / ( col * ( 2.43 * col + .59 ) + .14 ), 0., 1. );   // ACES, as post.ts
  col = pow( col, vec3( 1. / 2.6 ) );   // a little lift in the shadows on top of the display curve
  float l = dot( col, vec3( .3, .59, .11 ) );
  col = mix( vec3( l ), col, .2 ) * vec3( .82, 1., .88 ) + bar * .04;   // nearly grey, a little green
  col *= .88 + .12 * step( .5, fract( gl_FragCoord.y * .5 ) );          // scan lines, every other pair of pixels
  float n = hash( floor( gl_FragCoord.xy / 2. ) + fract( uTime ) * vec2( 113., 71. ) );
  col += ( n - .5 ) * .07;
  col = mix( col, vec3( n * .8 ), clamp( max( uStatic, uDead ), 0., 1. ) );
  col *= smoothstep( .62, .12, r2 * 1.6 );                              // the dark round the edge of the tube
  if ( uv.x < 0. || uv.x > 1. || uv.y < 0. || uv.y > 1. ) col = vec3( 0. );
  gl_FragColor = vec4( col, 1. );
}`;

type FeedMaterial = THREE.ShaderMaterial & {
  uniforms: {
    tFeed: THREE.IUniform<THREE.Texture>;
    uTime: THREE.IUniform<number>;
    uStatic: THREE.IUniform<number>;
    uDead: THREE.IUniform<number>;
    uExposure: THREE.IUniform<number>;
  };
};

// "CAM 04", for camera i of CAMS.
const camNo = (i: number): string => `CAM ${String(i + 1).padStart(2, '0')}`;

// The housing on the wall: a box with a lens, on a short arm, and the light that says it is recording.
function housing(scene: THREE.Scene, led: THREE.MeshBasicMaterial): THREE.Group[] {
  const body = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.6 }),
    glass = new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.15, metalness: 0.4 });
  const box = new THREE.BoxGeometry(0.16, 0.13, 0.32),
    lens = new THREE.CylinderGeometry(0.045, 0.05, 0.06, 14),
    arm = new THREE.BoxGeometry(0.04, 0.18, 0.04),
    dot = new THREE.SphereGeometry(0.014, 8, 6);
  return CAMS.map(c => {
    const g = new THREE.Group();
    g.name = `camera ${c.name}`;
    g.position.set(c.x, c.y, c.z);
    g.lookAt(c.look.x, AIM_Y, c.look.z);
    const shell = new THREE.Mesh(box, body),
      eye = new THREE.Mesh(lens, glass),
      stem = new THREE.Mesh(arm, body),
      light = new THREE.Mesh(dot, led);
    eye.rotation.x = Math.PI / 2;
    eye.position.z = 0.18;
    stem.position.set(0, 0.12, -0.08);
    light.position.set(0.05, 0.07, 0.12);
    g.add(shell, eye, stem, light);
    scene.add(g);
    return g;
  });
}

export function createCams(scene: THREE.Scene, root: HTMLElement, player: PlayerHandle) {
  const camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 40);
  scene.add(camera);
  const feed = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const mat = new THREE.ShaderMaterial({
    uniforms: { tFeed: { value: feed.texture }, uTime: { value: 0 }, uStatic: { value: 0 }, uDead: { value: 0 }, uExposure: { value: EXPOSURE } },
    vertexShader: SCREEN_VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
  }) as FeedMaterial;
  const screen = new THREE.Mesh(screenTri(), mat),
    flat = new THREE.Camera();
  screen.frustumCulled = false;
  const led = new THREE.MeshBasicMaterial({ color: 0x000000 }),
    housings = housing(scene, led);

  // The plan with a dot for the desk and a button for each camera. A button sits a few metres along the camera's view
  // into its room rather than on the camera, so the three that share the corner by the Main Hall stay apart.
  const rooms = ROOMS3.flatMap(r => r.rects.map(([x0, z0, x1, z1]) => `<rect x="${x0}" y="${z0}" width="${x1 - x0}" height="${z1 - z0}"/>`)).join('');
  const buttons = CAMS.map((c, i) => {
    const d = Math.max(0.01, dist(c, c.look)),
      x = c.x + ((c.look.x - c.x) / d) * BUTTON_IN,
      z = c.z + ((c.look.z - c.z) / d) * BUTTON_IN;
    return `<button class="ts-f-cam" data-cam="${i}" style="left:${(x / SIZE_X) * 100}%;top:${(z / SIZE_Z) * 100}%" aria-label="${camNo(i)}, ${c.name}">${(i + 1) % 10}</button>`;
  }).join('');
  const panel = document.createElement('div');
  panel.className = 'ts-f-cams';
  panel.hidden = true;
  panel.innerHTML = `<div class="ts-f-cams-dead">No signal</div>
    <div class="ts-f-cams-box">
      <div class="ts-f-cams-head"><i class="ts-f-rec"></i><b></b><span></span></div>
      <div class="ts-f-cams-map"><svg viewBox="0 0 ${SIZE_X} ${SIZE_Z}" aria-hidden="true">${rooms}<circle cx="${DESK.x}" cy="${DESK.z}" r="0.9"/></svg>${buttons}</div>
      <div class="ts-f-cams-foot"><span class="ts-f-cams-keys"><kbd class="ts-key">1–0</kbd><kbd class="ts-key">A D</kbd> camera</span><button class="btn btn-ghost is-sm" data-cams="up"><kbd class="ts-key">E</kbd><span>Get up</span></button></div>
    </div>`;
  root.append(panel);
  const label = query(panel, '.ts-f-cams-head b'),
    place = query(panel, '.ts-f-cams-head span'),
    dead = query(panel, '.ts-f-cams-dead'),
    btns = [...panel.querySelectorAll<HTMLElement>('.ts-f-cam')];
  panel.addEventListener('pointerdown', e => {
    if (!(e.target instanceof Element)) return;
    const b = e.target.closest<HTMLElement>('[data-cam], [data-cams]');
    if (!b) return;
    e.stopPropagation();
    e.preventDefault();
    if (b.dataset.cams === 'up') player.stand();
    else player.pickCam(Number(b.dataset.cam));
  });

  let shown = -1,
    drawn = 0,
    w = 0,
    h = 0;
  // Fit the feed to the canvas's shape, FEED_H pixels tall.
  function fit(canvas: HTMLCanvasElement): void {
    const aspect = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight),
      fw = Math.round(FEED_H * aspect);
    if (fw === w && FEED_H === h) return;
    w = fw;
    h = FEED_H;
    feed.setSize(w, h);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }

  return {
    camera,
    // Once a frame, before the world and the actors are brought up to date. on: the guard is watching (and not being
    // caught). Puts the camera where me.cam is, sweeping, and keeps the overlay and the wall lights in step.
    update(S: State, me: Me, on: boolean, now: number, eye: THREE.Vector3): void {
      const t = now / 1000,
        power = S.power > 0;
      led.color.setHex(power && t % 2 < 1.4 ? 0xff2a1a : 0x1a0505);
      const inView = roomsSeenFrom(eye.x, eye.z);
      for (const [i, g] of housings.entries()) g.visible = !on && inView.has(CAMS[i]?.room ?? -1);
      panel.hidden = !on;
      if (!on) {
        shown = -1;
        return;
      }
      const c = CAMS[me.cam];
      if (!c) return;
      const sweep = Math.sin(((t + me.cam * 3.1) / PAN.period) * Math.PI * 2) * PAN.angle,
        dx = c.look.x - c.x,
        dz = c.look.z - c.z,
        cos = Math.cos(sweep),
        sin = Math.sin(sweep);
      camera.position.set(c.x, c.y, c.z);
      camera.lookAt(c.x + dx * cos + dz * sin, AIM_Y, c.z - dx * sin + dz * cos);
      camera.updateMatrixWorld();
      if (shown !== me.cam) {
        // A click and a hiss on every change but the first picture after sitting down.
        if (shown >= 0) {
          tone(1900, 0.03, 'square', 0.03);
          noise(0.18, 0.08, { band: 3200 });
        }
        shown = me.cam;
        drawn = 0;
        label.textContent = camNo(me.cam);
        place.textContent = c.name;
        for (const [i, b] of btns.entries()) b.classList.toggle('is-on', i === me.cam);
      }
      dead.hidden = power;
      mat.uniforms.uDead.value = power ? 0 : 1;
      mat.uniforms.uStatic.value = Math.max(0.03, 1 - (now - me.camAt) / STATIC_MS);
      mat.uniforms.uTime.value = t % 600;
    },
    // Draw the frame: a new picture when one is due, then the picture through the tube.
    render(renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement, torch: THREE.SpotLight, now: number): void {
      fit(canvas);
      renderer.info.reset();
      if (now - drawn >= FEED_MS && mat.uniforms.uDead.value < 1) {
        drawn = now;
        torch.shadow.autoUpdate = false; // the guard's torch is off at the desk
        renderer.setRenderTarget(feed);
        renderer.render(scene, camera);
      }
      renderer.setRenderTarget(null);
      renderer.render(screen, flat);
    },
  };
}
