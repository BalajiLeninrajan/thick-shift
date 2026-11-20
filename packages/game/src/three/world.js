// The building: what it is made of, how it is lit, what stands in it and what
// a guard can use. The parts are in world/; this file puts them together.
//   surfaces.js, tex.js   painted textures for every floor, wall and ceiling
//   art.js                posters, notices, stains, stencilled room names
//   shell.js, geo.js      geometry from map.js: rooms, frames, pipes, the stage
//   light.js              baked lamp light, flicker, torch spill, dust
//   props.js, dressing.js furniture from the prop kits, and where it stands
//   usable.js             breaker boxes, door buttons, generator, charger, batteries, doors, wall map
//   sight.js              which rooms can be seen from which, so the rest are not drawn
import { surfaces } from './world/surfaces.js';
import { art } from './world/art.js';
import { Batch } from './world/geo.js';
import { buildShell } from './world/shell.js';
import { createLight, lit, torchCookie } from './world/light.js';
import { createProps } from './world/props.js';
import { createUsables } from './world/usable.js';
import { roomsSeenFrom } from './world/sight.js';

export function buildWorld(scene) {
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
    if (o.isMesh) lit(o.material);
  });

  return {
    torchCookie,
    parts: usables.parts, // what outline.js can put a gold edge round
    stop: 1, // how far to stop the picture down against torch glare this frame (light.js)
    // torch: how bright the local guard's torch is, 0 to 1. dread, threat: 0 to 1.
    update(S, t, dt, camera, torch, dread, threat) {
      const inView = roomsSeenFrom(camera.position.x, camera.position.z);
      light.update(S, t, dt, camera, torch, dread, threat);
      this.stop = light.stop;
      props.update(inView, light.level, dt);
      usables.update(S, t, dt, camera, inView);
    },
  };
}
