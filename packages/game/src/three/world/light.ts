// The building's own light. None of it is a live three.js light: with a
// dozen lamps on every material an integrated GPU would spend the frame on
// them. Instead the lamps are baked at load into small floor-plan
// textures (what each lamp group throws on the ground, with the walls
// casting shadows), and every material is patched to look its own spot up
// by world position. Groups can then flicker or die for the cost of a uniform.
//
// The same patch adds the two things a torch needs that a spotlight cannot
// give: a little spill round the beam, so a mascot standing beside it is a
// shape, and a trace of night vision, so the dark is not one flat black.
import * as THREE from 'three';
import { ROOMS3, BOXES } from '@thick-shift/sim/map';
import { darkRoom } from '@thick-shift/sim';
import type { NightState, State } from '@thick-shift/sim/types';
import { roomOf, open, sees, reach } from './sight';
import { Batch } from './geo';
import type { UV, Vec3 } from './geo';
import { ART, uvOf } from './art';
import { canvas } from './tex';
// The lamps and the dead fittings are plain data in @thick-shift/sim, so tools/roblox/gen-data.mjs can read them too.
import { TUBE, GREEN, LAMPS, DEAD_TUBES } from '@thick-shift/sim/data';
import type { Lamp, RGB } from '@thick-shift/sim/data';

// How bright each lamp group is this frame, 0 to 1 (createLight's level): the props' glow materials follow these too.
export interface Levels {
  on: number;
  fa: number;
  fb: number;
  fc: number;
  exit: number;
  screen: number;
}

/* ---------- the bake ---------- */

const PER_M = 4,
  LW = 42 * PER_M,
  LH = 44 * PER_M; // lightmap texels per metre, and its size
const GROUPS = ['fa', 'fb', 'exit', 'fc']; // the channels of the second texture
const BOUNCE = 0.14; // how much of a room's light comes back off its walls
// A torch held up to a wall bleaches it. The picture stops down as the lit
// surface gets nearer than GLARE_FROM metres, to no less than GLARE_MIN.
const GLARE_FROM = 5,
  GLARE_MIN = 0.3;

const ceilingAt = (x: number, z: number): number => ROOMS3[Math.max(0, roomOf(x, z))].h;

// lamps: the ones to bake. Returns two textures: the steady lamps in colour, and the four groups of GROUPS, one per channel.
function bake(lamps: Lamp[]): [THREE.DataTexture, THREE.DataTexture] {
  const a = new Float32Array(LW * LH * 4),
    b = new Float32Array(LW * LH * 4),
    room = new Int8Array(LW * LH);
  for (let j = 0; j < LH; j++)
    for (let i = 0; i < LW; i++) {
      const x = (i + 0.5) / PER_M,
        z = (j + 0.5) / PER_M,
        at = j * LW + i;
      room[at] = open(x, z) ? roomOf(x, z) : -2;
      if (room[at] === -2) continue;
      for (const l of lamps) {
        // a wall lamp shines from just in front of its wall
        const lx = l.x + (l.n?.[0] || 0) * 0.3,
          lz = l.z + (l.n?.[1] || 0) * 0.3,
          d = Math.hypot(x - lx, z - lz);
        if (d >= l.reach) continue;
        // four points round the lamp, so shadows have soft edges
        let lit = 0;
        for (const [ox, oz] of [
          [0.35, 0],
          [-0.35, 0],
          [0, 0.35],
          [0, -0.35],
        ])
          if (open(lx + ox, lz + oz) && sees(x, z, lx + ox, lz + oz)) lit += 0.25;
        if (!lit) continue;
        const h = l.y ?? ceilingAt(lx, lz) - 0.2,
          fade = 1 - (d / l.reach) ** 2;
        const v = l.pow * lit * ((h * h) / (d * d + h * h)) ** 1.5 * fade * fade;
        if (!GROUPS.includes(l.g)) for (let k = 0; k < 3; k++) a[at * 4 + k] += v * l.col[k];
        else b[at * 4 + GROUPS.indexOf(l.g)] += v;
      }
    }
  // Each room gets back a share of its own light from everywhere at once.
  for (const map of [a, b]) {
    const sum = ROOMS3.map(() => [0, 0, 0, 0, 0]);
    for (let at = 0; at < room.length; at++)
      if (room[at] >= 0) {
        const s = sum[room[at]];
        s[4]++;
        for (let k = 0; k < 4; k++) s[k] += map[at * 4 + k];
      }
    for (let at = 0; at < room.length; at++)
      if (room[at] >= 0) {
        const s = sum[room[at]];
        for (let k = 0; k < 4; k++) map[at * 4 + k] += (s[k] / s[4]) * BOUNCE;
      }
  }
  // A wall's surface sits on the edge between a lit texel and one inside the
  // wall. Copy the light one texel into the walls so that edge is not half dark.
  for (const map of [a, b]) {
    const src = map.slice();
    for (let j = 0; j < LH; j++)
      for (let i = 0; i < LW; i++) {
        const at = j * LW + i;
        if (room[at] !== -2) continue;
        let n = 0;
        const acc = [0, 0, 0, 0];
        for (const [di, dj] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const q = (j + dj) * LW + i + di;
          if (i + di >= 0 && i + di < LW && j + dj >= 0 && j + dj < LH && room[q] !== -2) {
            n++;
            for (let k = 0; k < 4; k++) acc[k] += src[q * 4 + k];
          }
        }
        if (n) for (let k = 0; k < 4; k++) map[at * 4 + k] = acc[k] / n;
      }
  }
  const tex = (f: Float32Array): THREE.DataTexture => {
    const t = new THREE.DataTexture(Uint16Array.from(f, THREE.DataUtils.toHalfFloat), LW, LH, THREE.RGBAFormat, THREE.HalfFloatType);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  return [tex(a), tex(b)];
}

/* ---------- rooms with a fault ---------- */

// A floor-plan mask, two texels a metre, of how much of its lamps' light each room is getting: 1 normally, flickering
// while a fault in it is open, and nearly nothing once the fault has had its room's lights (sim.ts darkRoom).
const MASK_PER_M = 2,
  MW = 42 * MASK_PER_M,
  MH = 44 * MASK_PER_M;
function roomMask(): { tex: THREE.DataTexture; update(S: State, t: number, dt: number): void } {
  const ids = new Int8Array(MW * MH),
    data = new Uint8Array(MW * MH * 4).fill(255);
  for (let j = 0; j < MH; j++)
    for (let i = 0; i < MW; i++) {
      const x = (i + 0.5) / MASK_PER_M,
        z = (j + 0.5) / MASK_PER_M;
      let r = roomOf(x, z);
      // Inside a wall: whichever room is nearest, so a wall's face takes its own room's light.
      for (let d = 0.5; r < 0 && d <= 1.5; d += 0.5)
        for (const [dx, dz] of [
          [d, 0],
          [-d, 0],
          [0, d],
          [0, -d],
        ])
          if (r < 0) r = roomOf(x + dx, z + dz);
      ids[j * MW + i] = r;
    }
  const tex = new THREE.DataTexture(data, MW, MH);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const level = ROOMS3.map(() => 1);
  return {
    tex,
    update(S: State, t: number, dt: number): void {
      let changed = false;
      ROOMS3.forEach((_, r) => {
        const open = S.faults?.some((f, i) => f && BOXES[i].room === r),
          dark = !S.out && darkRoom(S as NightState, r);
        // Open: the room's tubes stutter. Dark: they have given up, with the odd attempt to strike.
        const want = dark ? (jump(t, 3, r) > 0.93 ? 0.35 : 0.04) : open ? (jump(t, 11, r + 20) > 0.8 ? 0.3 : 1) : 1;
        const v = level[r] + (want - level[r]) * Math.min(1, dt * 14);
        if (Math.abs(v - level[r]) > 0.004) {
          level[r] = v;
          changed = true;
        }
      });
      if (!changed) return;
      for (let k = 0; k < ids.length; k++) if (ids[k] >= 0) data[k * 4] = 255 * level[ids[k]];
      tex.needsUpdate = true;
    },
  };
}
const mask = roomMask();

/* ---------- the patch ---------- */

// The uniforms the patch adds to every lit material, shared by all of them (and the torch dust's uEye and uTorch).
interface DepotUniforms {
  uLmA: THREE.IUniform<THREE.DataTexture | null>;
  uLmB: THREE.IUniform<THREE.DataTexture | null>;
  uLmC: THREE.IUniform<THREE.DataTexture>;
  uGlow: THREE.IUniform<number>;
  uLmInv: THREE.IUniform<THREE.Vector2>;
  uSteady: THREE.IUniform<number>;
  uCa: THREE.IUniform<THREE.Color>;
  uCb: THREE.IUniform<THREE.Color>;
  uCe: THREE.IUniform<THREE.Color>;
  uCc: THREE.IUniform<THREE.Color>;
  uEye: THREE.IUniform<THREE.Vector3>;
  uTorch: THREE.IUniform<THREE.Vector4>;
  uAdapt: THREE.IUniform<THREE.Color>;
  uRoomLit: THREE.IUniform<THREE.DataTexture>;
}
const U: DepotUniforms = {
  uLmA: { value: null },
  uLmB: { value: null },
  uLmC: { value: new THREE.DataTexture(new Uint8Array(4), 1, 1) },
  uGlow: { value: 0 },
  uLmInv: { value: new THREE.Vector2(1 / 42, 1 / 44) },
  uSteady: { value: 1 },
  uCa: { value: new THREE.Color() },
  uCb: { value: new THREE.Color() },
  uCe: { value: new THREE.Color() },
  uCc: { value: new THREE.Color() },
  uEye: { value: new THREE.Vector3() },
  uTorch: { value: new THREE.Vector4() },
  uAdapt: { value: new THREE.Color() },
  uRoomLit: { value: mask.tex },
};
const VERT_PARS = 'varying vec3 vDepotPos;\n',
  VERT = `
  vec4 depotP = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    depotP = instanceMatrix * depotP;
  #endif
  vDepotPos = ( modelMatrix * depotP ).xyz;`;
const FRAG_PARS = `varying vec3 vDepotPos;
uniform sampler2D uLmA, uLmB, uLmC, uRoomLit; uniform vec2 uLmInv; uniform float uSteady, uGlow; uniform vec3 uCa, uCb, uCe, uCc, uEye, uAdapt; uniform vec4 uTorch;
`,
  FRAG = `{
  vec2 luv = vDepotPos.xz * uLmInv;
  vec4 lb = texture2D( uLmB, luv );
  vec3 dl = ( texture2D( uLmA, luv ).rgb * uSteady + texture2D( uLmC, luv ).rgb * uGlow + lb.r * uCa + lb.g * uCb + lb.a * uCc ) * texture2D( uRoomLit, luv ).r + lb.b * uCe;
  // the lamps are overhead: tops catch more than sides, undersides little
  dl *= ( .72 + .28 * dot( normal, ( viewMatrix * vec4( 0., 1., 0., 0. ) ).xyz ) ) * ( 1. - .4 * smoothstep( 2.4, 4.4, vDepotPos.y ) );
  vec3 toP = vDepotPos - uEye; float d2 = dot( toP, toP ), ahead = max( 0., dot( toP * inversesqrt( d2 + 1e-4 ), uTorch.xyz ) );
  dl += uAdapt / ( 1. + d2 * .3 ) + vec3( 1., .9, .75 ) * uTorch.w * ( .2 + .8 * ahead * ahead ) / ( 1. + d2 * .05 );
  reflectedLight.indirectDiffuse += dl * diffuseColor.rgb;
}
`;
// Make a standard material take the building's light. Safe to call twice.
const patched = new WeakSet<THREE.Material>();
export function lit<M extends THREE.Material>(material: M): M {
  if (patched.has(material) || !(material as THREE.Material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return material;
  patched.add(material);
  const before = material.onBeforeCompile,
    key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    Object.assign(shader.uniforms, U);
    shader.vertexShader = VERT_PARS + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>${VERT}`);
    shader.fragmentShader = FRAG_PARS + shader.fragmentShader.replace('#include <aomap_fragment>', `${FRAG}#include <aomap_fragment>`);
  };
  material.customProgramCacheKey = () => `depot${key}`;
  material.needsUpdate = true;
  return material;
}

/* ---------- fittings ---------- */

// A soft round glow for halos. Tubes and bulbs use its white centre.
// The tail eases out to nothing well inside the rim. A straight fade reads as
// a flat disc with a hard edge once tone mapped, and on a dark ceiling (the
// stage's) that disc is all you see of the lamp.
function glowTexture(): THREE.CanvasTexture {
  const c = canvas(64),
    g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, '#fff');
  for (let i = 0; i <= 10; i++) {
    const r = 0.12 + i * 0.088,
      s = Math.min(1, (r - 0.12) / 0.7),
      v = Math.round(170 * (1 - s * s * (3 - 2 * s)) ** 3.5);
    g.addColorStop(Math.min(1, r), `rgb(${v},${v},${v})`);
  }
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c.canvas);
}
const CORE: UV = [0.5, 0.5, 0.5, 0.5],
  HALO: UV = [0, 0, 1, 1],
  HOUSING: RGB = [0.5, 0.5, 0.48],
  dim = (c: RGB, k: number): RGB => c.map(v => v * k) as RGB;

// trim: the batch that housings go into. Returns the meshes that glow, by group.
function fittings(scene: THREE.Scene, trim: Batch, artTex: THREE.Texture): Record<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>> {
  const glow = Object.fromEntries(['on', ...GROUPS].map(g => [g, new Batch()])),
    face = new Batch();
  const tube = (x: number, z: number, dir: 'x' | 'z', col?: RGB, into?: Batch): void => {
    const y = ceilingAt(x, z),
      dx = dir === 'x' ? 0.65 : 0.09,
      dz = dir === 'x' ? 0.09 : 0.65;
    trim.box(x - dx, y - 0.07, z - dz, x + dx, y, z + dz, HOUSING);
    for (const s of [-1, 1]) {
      const o = s * 0.045,
        a: Vec3 = dir === 'x' ? [x - 0.6, y - 0.09, z + o] : [x + o, y - 0.09, z - 0.6],
        b: Vec3 = dir === 'x' ? [x + 0.6, y - 0.09, z + o] : [x + o, y - 0.09, z + 0.6];
      if (into) into.bar(a, b, 0.018, col, 6, CORE);
      else trim.bar(a, b, 0.018, [0.3, 0.3, 0.28], 6);
    }
    if (into) into.decal(x, y - 0.012, z, dir === 'x' ? 3.2 : 1.8, dir === 'x' ? 1.8 : 3.2, 0, false, HALO, dim(col, 0.3));
  };
  for (const l of LAMPS) {
    const into = glow[l.g];
    if (l.kind === 'tube') tube(l.x, l.z, l.dir, l.col, into);
    if (l.kind === 'bulb') {
      trim.bar([l.x, l.y, l.z], [l.x, ceilingAt(l.x, l.z), l.z], 0.008, [0.05, 0.05, 0.05], 4);
      trim.box(l.x - 0.02, l.y - 0.06, l.z - 0.02, l.x + 0.02, l.y, l.z + 0.02, [0.3, 0.25, 0.15]);
      into.box(l.x - 0.03, l.y - 0.15, l.z - 0.03, l.x + 0.03, l.y - 0.06, l.z + 0.03, l.col, 1, CORE);
      for (const [nx, nz] of [
        [1, 0],
        [0, 1],
      ])
        for (const s of [-1, 1]) into.sign(l.x, l.y - 0.1, l.z, 0.9, 0.9, nx * s, nz * s, HALO, dim(l.col, 0.35));
    }
    if (l.kind === 'red') {
      const [nx, nz] = l.n,
        x = l.x + nx * 0.05,
        z = l.z + nz * 0.05,
        y = 2.45;
      const hx = nx ? 0.05 : 0.13,
        hz = nz ? 0.05 : 0.13;
      trim.box(x - hx, y - 0.08, z - hz, x + hx, y + 0.08, z + hz, [0.2, 0.2, 0.2]);
      into.sign(l.x + nx * 0.11, y, l.z + nz * 0.11, 0.2, 0.1, nx, nz, CORE, l.col);
      into.sign(l.x + nx * 0.02, y, l.z + nz * 0.02, 2, 1.6, nx, nz, HALO, dim(l.col, 0.28));
      into.sign(l.x + nx * 0.12, y, l.z + nz * 0.12, 0.6, 0.5, nx, nz, HALO, dim(l.col, 0.6));
    }
    if (l.kind === 'exit') {
      const [nx, nz] = l.n,
        x = l.x + nx * 0.04,
        z = l.z + nz * 0.04,
        w = 0.56,
        h = 0.26;
      trim.box(
        x - (nz ? w / 2 : 0.04),
        l.y - h / 2,
        z - (nx ? w / 2 : 0.04),
        x + (nz ? w / 2 : 0.04),
        l.y + h / 2,
        z + (nx ? w / 2 : 0.04),
        [0.12, 0.12, 0.12]
      );
      face.sign(l.x + nx * 0.085, l.y, l.z + nz * 0.085, w - 0.04, h - 0.04, nx, nz, uvOf(ART.exit));
      into.sign(l.x + nx * 0.02, l.y, l.z + nz * 0.02, 2.2, 1.5, nx, nz, HALO, dim(l.col, 0.16));
    }
  }
  for (const [x, z, dir] of DEAD_TUBES) tube(x, z, dir);
  const map = glowTexture(),
    out: Record<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>> = {};
  for (const g in glow)
    if (!glow[g].empty) {
      out[g] = glow[g].mesh(new THREE.MeshBasicMaterial({ map, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      scene.add(out[g]);
    }
  out.face = face.mesh(new THREE.MeshBasicMaterial({ map: artTex }));
  scene.add(out.face);
  return out;
}

/* ---------- the torch ---------- */

// What a cheap torch throws on a wall: a hot centre, the reflector's rings,
// and a shadow where the bulb holder sits.
export function torchCookie(): THREE.CanvasTexture {
  const s = 256,
    c = canvas(s),
    g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [at, v] of [
    [0, 230],
    [0.22, 224],
    [0.34, 185],
    [0.4, 162],
    [0.46, 180],
    [0.56, 135],
    [0.66, 143],
    [0.74, 106],
    [0.9, 63],
    [1, 36],
  ])
    g.addColorStop(at, `rgb(${v},${v},${v})`);
  c.fillStyle = g;
  c.fillRect(0, 0, s, s);
  c.globalCompositeOperation = 'multiply';
  const dent = c.createRadialGradient(s * 0.56, s * 0.47, 0, s * 0.56, s * 0.47, s * 0.1);
  dent.addColorStop(0, '#666');
  dent.addColorStop(1, '#fff');
  c.fillStyle = dent;
  c.fillRect(0, 0, s, s);
  c.strokeStyle = '#ddd';
  c.lineWidth = 2;
  c.beginPath();
  c.arc(s / 2, s / 2, s * 0.27, 0.3, 2.2);
  c.stroke();
  const t = new THREE.CanvasTexture(c.canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Dust that only shows where the beam passes through it.
function dust(scene: THREE.Scene, count: number): THREE.ShaderMaterial {
  const g = new THREE.BufferGeometry(),
    seed = new Float32Array(count * 3);
  for (let i = 0; i < seed.length; i++) seed[i] = Math.random() * 8;
  g.setAttribute('position', new THREE.BufferAttribute(seed, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uEye: U.uEye, uTorch: U.uTorch, uTime: { value: 0 }, uBeam: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `uniform vec3 uEye; uniform vec4 uTorch; uniform float uTime, uBeam; varying float vA;
      void main() {
        vec3 drift = vec3( sin( uTime * .21 + position.y * 3. ), uTime * .03, cos( uTime * .17 + position.x * 3. ) ) * .25;
        vec3 p = uEye + mod( position + drift - uEye, 8. ) - 4.;   // a box of motes that follows the guard
        vec3 to = p - uEye; float d = length( to );
        float cone = smoothstep( .86, .97, dot( to / d, uTorch.xyz ) );
        vA = uBeam * cone * smoothstep( 4., 2.5, d ) * smoothstep( .3, .9, d );
        vec4 mv = viewMatrix * vec4( p, 1. );
        gl_Position = projectionMatrix * mv; gl_PointSize = clamp( 9. / -mv.z, 1.5, 7. ) * ( .6 + fract( position.x * 7.3 ) );
      }`,
    fragmentShader:
      'varying float vA; void main() { float r = length( gl_PointCoord - .5 ); gl_FragColor = vec4( vec3( 1., .92, .8 ) * vA * smoothstep( .5, 0., r ) * .22, 1. ); }',
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return mat;
}

/* ---------- the night ---------- */

// A number that holds for 1/rate seconds, then jumps: 0 to 1.
const jump = (t: number, rate: number, seed: number): number => {
  const v = Math.sin((Math.floor(t * rate) + seed) * 127.1) * 43758.5453;
  return v - Math.floor(v);
};

export function createLight(scene: THREE.Scene, trim: Batch, artTex: THREE.Texture) {
  [U.uLmA.value, U.uLmB.value] = bake(LAMPS.filter(l => l.kind !== 'glow'));
  const glow = fittings(scene, trim, artTex),
    motes = dust(scene, 360);
  const tubeCol = new THREE.Color(...TUBE),
    exitCol = new THREE.Color(...GREEN),
    dir = new THREE.Vector3();
  let swept = 0;
  return {
    level: { on: 1, fa: 1, fb: 1, fc: 1, exit: 1, screen: 1 }, // how bright each lamp group is this frame
    stop: 1, // how far the picture is stopped down against torch glare, GLARE_MIN to 1
    // The props have loaded: light the floor round the ones that glow. has(name): is that prop there.
    glows(has: (name: string) => boolean): void {
      [U.uLmC.value] = bake(LAMPS.filter(l => l.kind === 'glow' && has(l.by)));
    },
    // dread and threat: 0 to 1. torch: the local guard's torch brightness, 0 to 1.
    update(S: State, t: number, dt: number, camera: THREE.Camera, torch: number, dread: number, threat: number): void {
      // the lamps give less every night, and less again when the power is nearly gone
      const power = S.power <= 0 ? 0 : (S.power < 20 ? 0.6 : 1) * Math.max(0.6, 1 - (S.night - 1) * 0.1),
        worse = Math.max(dread, threat);
      // brown-outs: the whole building dips now and then, more as the night goes wrong
      const sag = jump(t, 7, 1) > 0.97 - worse * 0.12 ? 0.45 : 1;
      const on = power * sag;
      const fa = on * (jump(t, 14, 2) > 0.84 - worse * 0.2 ? 0.12 : 1) * (jump(t, 0.7, 3) > 0.82 ? 0.5 + 0.5 * jump(t, 30, 4) : 1);
      const fb = on * (0.72 + 0.28 * Math.sin(t * 61)) * (jump(t, 9, 5) > 0.7 ? 0.35 : 1);
      // mostly dead, with a few seconds of trying to strike
      const fc = on * (jump(t, 0.45, 6) > 0.7 - worse * 0.25 ? (jump(t, 22, 7) > 0.45 ? 1 : 0.15) : 0.03);
      const exit = power ? 1 : 0.55 + 0.1 * Math.sin(t * 2.3);
      U.uSteady.value = on;
      mask.update(S, t, dt);
      U.uGlow.value = on * (0.85 + 0.15 * Math.sin(t * 9 + Math.sin(t * 2.3) * 4)); // screens that have been on for years
      U.uCa.value.copy(tubeCol).multiplyScalar(fa);
      U.uCb.value.copy(tubeCol).multiplyScalar(fb);
      U.uCc.value.copy(tubeCol).multiplyScalar(fc);
      U.uCe.value.copy(exitCol).multiplyScalar(exit);
      const level: Levels = { on, fa, fb, fc, exit, screen: U.uGlow.value };
      for (const g in level) glow[g]?.material.color.setScalar(level[g]);
      this.level = level;
      glow.face.material.color.setScalar(0.35 + exit * 0.65);
      camera.getWorldDirection(dir);
      // What the beam lands on: the wall ahead, or the floor or ceiling if that comes first.
      const flat = Math.hypot(dir.x, dir.z),
        eye = camera.position;
      const hit = Math.min(
        flat > 0.01 ? reach(eye.x, eye.z, dir.x / flat, dir.z / flat, GLARE_FROM) / flat : GLARE_FROM,
        dir.y < 0 ? eye.y / -dir.y : (ceilingAt(eye.x, eye.z) - eye.y) / Math.max(0.01, dir.y)
      );
      const want = torch > 0 ? Math.max(GLARE_MIN, Math.min(1, hit / GLARE_FROM)) : 1;
      this.stop += (want - this.stop) * Math.min(1, dt * 5);
      U.uEye.value.copy(camera.position);
      U.uTorch.value.set(dir.x, dir.y, dir.z, torch * 0.05);
      U.uAdapt.value.setRGB(0.012, 0.015, 0.022);
      motes.uniforms.uTime.value = t;
      motes.uniforms.uBeam.value = torch;
      // Models arrive late and belong to other files; give anything new the building's light.
      if (t - swept > 1) {
        swept = t;
        scene.traverse(o => {
          if ((o as THREE.Mesh).isMesh) for (const m of [].concat((o as THREE.Mesh).material)) lit(m);
        });
      }
    },
  };
}
