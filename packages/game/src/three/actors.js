// Everyone who moves and is not you: the four mascots and the other guards.
// This file owns them and passes events along; the work is in actors/:
//   track.js   the host sends positions ten times a second; drawing between snapshots
//   rig.js     a model's named parts, and the offsets animation adds to them
//   mascot.js  one mascot: stages of rot, states, gait, head and eyes
//   styles.js  what makes each of the four itself at each stage
//   guard.js   another guard: walking, torch, name, being flattened and peeled
//   scare.js   the catch, seen by the guard who was caught
//   hands.js   your own torch, held in view
//   phone.js   your own phone, held in view, with the minimap (app.js makes it)
//   plush.js   the Mini Biggs guards throw, in the air and singing on the floor
import * as THREE from 'three';
import { MASC } from '../config.js';
import { game } from '../state.js';
import { DOORWAYS } from './map.js';
import { hostClock } from './actors/track.js';
import { prefs } from './player.js';
import { Mascot } from './actors/mascot.js';
import { Guard } from './actors/guard.js';
import { createScare } from './actors/scare.js';
import { createHands } from './actors/hands.js';
import { createPlush } from './actors/plush.js';

// Other guards' torches are real lights, but every light costs every pixel, so
// there are only this many: the nearest lit torches get them and the rest make do with a glowing lens.
const TORCH_LIGHTS = 2,
  TORCH_POWER = 40;
const nearest = (a, b) => a.dist - b.dist;

export function createActors(scene, camera, renderer) {
  const mascots = MASC.map((_, i) => new Mascot(scene, i, renderer));
  const guards = new Map(),
    scare = createScare(camera, renderer.domElement),
    hands = createHands(camera),
    plush = createPlush(scene);
  // watch: the guard a flat guard is watching through. frustum: what this screen shows, so a mascot only changes model off it.
  const view = { x: 0, y: 0, z: 0, id: '', flat: false, torch: false, watch: null, frustum: new THREE.Frustum() },
    viewProj = new THREE.Matrix4();
  let lights = null; // made when the first other guard turns up, so a guard alone pays for none
  const lit = [],
    list = []; // list: the guards in the scene, as an array to walk without garbage

  function lendLights() {
    lights ||= Array.from({ length: TORCH_LIGHTS }, () => {
      const l = new THREE.SpotLight(0xfff0d0, 0, 22, 0.5, 0.55, 1.5);
      scene.add(l, l.target);
      return l;
    });
    lit.length = 0;
    for (const g of list) if (g.on && g.seen) lit.push(g);
    lit.sort(nearest);
    for (let i = 0; i < TORCH_LIGHTS; i++) {
      const l = lights[i],
        g = lit[i];
      l.intensity = g ? TORCH_POWER : 0;
      if (g) {
        l.position.copy(g.hand);
        l.target.position.copy(g.hand).addScaledVector(g.aim, 4);
      }
    }
  }

  return {
    mascots,
    guards,
    scare,
    plush,
    // A night began: forget where everything was.
    reset() {
      scare.stop();
      plush.reset();
      for (const m of mascots) m.reset();
    },
    // Every new event from the host comes through here.
    event(e, S, me) {
      const x = e.x;
      if (e.type === 'flat') {
        if (x.id === game.myId) scare.start(mascots[x.by], me);
        else mascots[x.by].sitOn(x.x, x.z, false);
      } else if (e.type === 'bang') {
        // The hit lands with the sound: whichever of them is at that door.
        const d = DOORWAYS.find(d => d.key === x),
          cx = (d.rect[0] + d.rect[2]) / 2,
          cz = (d.rect[1] + d.rect[3]) / 2;
        for (const m of S.m) if (m.st === 'siege' && Math.hypot(m.x - cx, m.z - cz) < 4) mascots[m.i].bang();
      } else if (e.type === 'crash') {
        for (const m of S.m) if (m.st === 'stun') mascots[m.i].crash();
      } else if (e.type === 'spot') mascots[x.i].spotted();
      else if (e.type === 'check' || e.type === 'found') mascots[x.i].bang(); // the yank on the locker door
    },
    // me, torch: player.js's guard and its light. Call after player.update, which has put the camera where the guard is.
    sync(S, dt, me, torch) {
      hostClock.see(S.t, performance.now() / 1000);
      camera.updateMatrixWorld();
      view.frustum.setFromProjectionMatrix(viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      view.x = camera.position.x;
      view.y = camera.position.y;
      view.z = camera.position.z;
      view.id = game.myId;
      view.flat = me.flat;
      view.torch = me.on;
      view.watch = me.watch;
      view.third = prefs.third;
      for (const m of S.m) mascots[m.i].sync(m, S, dt, view);
      for (const g of list) g.here = false;
      for (const p of S.players) {
        if (p.id === game.myId || p.x == null) continue;
        let g = guards.get(p.id);
        if (!g || g.name !== p.name) {
          g?.dispose(scene);
          g = new Guard(scene, p);
          guards.set(p.id, g);
          list.length = 0;
          list.push(...guards.values());
        }
        g.here = true;
        g.sync(p, S, dt, view);
      }
      for (let i = list.length - 1; i >= 0; i--)
        if (!list[i].here) {
          list[i].dispose(scene);
          guards.delete(list[i].id);
          list.splice(i, 1);
        }
      if (guards.size || lights) lendLights();
      plush.sync(S, view);
      scare.update(me, dt, torch);
      hands.update(me, dt, scare.active);
    },
    // After the frame is drawn.
    after() {
      scare.after(renderer.domElement);
    },
  };
}
