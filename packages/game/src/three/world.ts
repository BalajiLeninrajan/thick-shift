// The building: what it is made of, how it is lit, what stands in it and what
// a guard can use. The parts are in world/; this file puts them together.
//   surfaces.ts, tex.ts   painted textures for every floor, wall and ceiling
//   art.ts                posters, notices, stains, stencilled room names
//   shell.ts, geo.ts      geometry from the sim's map.ts: rooms, frames, pipes, the stage
//   light.ts              baked lamp light, flicker, torch spill, dust
//   props.ts              furniture from the prop kits, stood where the sim's dressing.ts says
//   usable.ts             breaker boxes, door buttons, generator, charger, batteries, doors, wall map
//   sight.ts              which rooms can be seen from which, so the rest are not drawn

import type { State } from '@thick-shift/sim/types';
import { type Camera, Mesh, type Scene } from 'three';
import { art } from './world/art';
import { Batch } from './world/geo';
import { createLight, lit, torchCookie } from './world/light';
import { createProps } from './world/props';
import { buildShell } from './world/shell';
import { roomsSeenFrom } from './world/sight';
import { surfaces } from './world/surfaces';
import { createUsables } from './world/usable';

export function buildWorld(scene: Scene) {
  const mats = surfaces(),
    pics = art(),
    trim = new Batch();
  buildShell(scene, mats, pics, trim);
  const light = createLight(scene, trim, pics.art); // adds the lamp housings to the trim
  const trimMesh = trim.mesh(mats.trim);
  trimMesh.castShadow = trimMesh.receiveShadow = true;
  scene.add(trimMesh);
  const props = createProps(scene),
    usables = createUsables(scene);
  props.ready.then(has => light.glows(has));
  scene.traverse(o => {
    if (o instanceof Mesh && !Array.isArray(o.material)) lit(o.material);
  });

  return {
    torchCookie,
    parts: usables.parts, // what outline.ts can put a gold edge round
    // How far to stop the picture down against torch glare this frame (light.ts).
    get stop(): number {
      return light.stop;
    },
    // torch: how bright the local guard's torch is, 0 to 1. dread, threat: 0 to 1.
    update(S: State, t: number, dt: number, camera: Camera, torch: number, dread: number, threat: number): void {
      const inView = roomsSeenFrom(camera.position.x, camera.position.z);
      light.update(S, t, dt, camera, torch, dread, threat);

      props.update(inView, light.level, dt);
      usables.update(S, t, dt, camera, inView);
    },
  };
}
