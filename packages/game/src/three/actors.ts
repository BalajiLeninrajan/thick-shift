// Everyone who moves and is not you: the four mascots and the other guards.
// This file owns them and passes events along; the work is in actors/:
//   track.ts   the room sends positions ten times a second; drawing between snapshots
//   rig.ts     a model's named parts, and the offsets animation adds to them
//   mascot.ts  one mascot: stages of rot, states, gait, head and eyes
//   styles.ts  what makes each of the four itself at each stage
//   guard.ts   another guard: walking, torch, name, being flattened and peeled
//   scare.ts   the catch, seen by the guard who was caught
//   hands.ts   your own torch, held in view
//   phone.ts   your own phone, held in view, with the minimap (app.ts makes it)
//   plush.ts   the Mini Biggs guards throw, in the air and singing on the floor

import { isPlaced } from '@thick-shift/sim/check';
import { perMascot, STOMPY } from '@thick-shift/sim/config';
import { dist, doorwayOf, rectMid } from '@thick-shift/sim/map';
import type { SimEvent, State } from '@thick-shift/sim/types';
import * as THREE from 'three';
import { game } from '../state';
import type { Me } from '../types';
import { Guard } from './actors/guard';
import { createHands } from './actors/hands';
import { Mascot } from './actors/mascot';
import { createPlush } from './actors/plush';
import { createScare } from './actors/scare';
import { nightClock } from './actors/track';
import { prefs } from './player';

// Other guards' torches are real lights, but every light costs every pixel, so
// there are only this many: the nearest lit torches get them and the rest make do with a glowing lens.
const TORCH_LIGHTS = 2,
  TORCH_POWER = 40;
const nearest = (a: Guard, b: Guard): number => a.dist - b.dist;

// What the actors are drawn for, set once a frame in sync(). x, y, z: the camera. id: the guard watching. flat: they
// are on the floor. watch: the guard a flat guard is watching through. third: they watch from behind (prefs.third).
// cam: the picture is a security camera's (cams.ts), not a guard's eyes.
// frustum: what this screen shows, so a mascot only changes model off it.
export interface View {
  x: number;
  y: number;
  z: number;
  id: string;
  flat: boolean;
  watch: string | null;
  third: boolean;
  cam: boolean;
  frustum: THREE.Frustum;
}

export function createActors(scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) {
  const mascots = perMascot(i => new Mascot(scene, i, renderer));
  const guards = new Map<string, Guard>(),
    scare = createScare(camera, renderer.domElement),
    hands = createHands(camera),
    plush = createPlush(scene);
  const view: View = { x: 0, y: 0, z: 0, id: '', flat: false, watch: null, third: false, cam: false, frustum: new THREE.Frustum() },
    viewProj = new THREE.Matrix4();
  let lights: THREE.SpotLight[] | null = null; // made when the first other guard turns up, so a guard alone pays for none
  const lit: Guard[] = [],
    list: Guard[] = []; // list: the guards in the scene, as an array to walk without garbage
  // list is always guards.values() in order, so it is made again whenever guards changes.
  function relist(): void {
    list.length = 0;
    list.push(...guards.values());
  }

  function lendLights(): void {
    lights ||= Array.from({ length: TORCH_LIGHTS }, () => {
      const l = new THREE.SpotLight(0xfff0d0, 0, 22, 0.5, 0.55, 1.5);
      scene.add(l, l.target);
      return l;
    });
    lit.length = 0;
    for (const g of list) if (g.on && g.seen) lit.push(g);
    lit.sort(nearest);
    for (const [i, l] of lights.entries()) {
      const g = lit[i];
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
    reset(): void {
      scare.stop();
      plush.reset();
      for (const m of mascots) m.reset();
    },
    // Every new event in S.evs comes through here.
    event(e: SimEvent, S: State, me: Me): void {
      if (e.type === 'flat') {
        const { id, by } = e.x;
        if (id === game.myId) scare.start(mascots[by], me);
      } else if (e.type === 'bang') {
        // The hit lands with the sound: whichever of them is at that door. A bang carries the key of a doorway that has one.
        const door = rectMid(doorwayOf(e.x).rect);
        for (const m of S.m) if (m.st === 'siege' && dist(m, door) < 4) mascots[m.i].bang();
      } else if (e.type === 'crash') {
        mascots[STOMPY].crash(); // only Stompy charges into walls; the others in 'stun' were hit by a toy (bonk)
      } else if (e.type === 'bonk')
        mascots[e.x.i].crash(); // a Mini Biggs in the face: the same recoil
      else if (e.type === 'spot') mascots[e.x.i].spotted();
      else if (e.type === 'check' || e.type === 'found') mascots[e.x.i].bang(); // the yank on the locker door
    },
    // me, torch: player.ts's guard and its light. eye: what the frame is drawn from, the guard's camera or the security
    // camera they are watching (cams.ts). Call after player.update, which has put the camera where the guard is.
    sync(S: State, dt: number, me: Me, torch: THREE.SpotLight, eye: THREE.PerspectiveCamera = camera): void {
      nightClock.see(S.t, performance.now() / 1000);
      eye.updateMatrixWorld();
      view.frustum.setFromProjectionMatrix(viewProj.multiplyMatrices(eye.projectionMatrix, eye.matrixWorldInverse));
      view.x = eye.position.x;
      view.y = eye.position.y;
      view.z = eye.position.z;
      view.id = game.myId;
      view.flat = me.flat;
      view.watch = me.watch;
      view.third = prefs.third;
      view.cam = eye !== camera;
      for (const m of S.m) mascots[m.i].sync(m, S, dt, view);
      for (const g of list) g.here = false;
      for (const p of S.players) {
        if (p.id === game.myId || !isPlaced(p)) continue;
        let g = guards.get(p.id);
        if (!g || g.name !== p.name) {
          g?.dispose(scene);
          g = new Guard(scene, p);
          guards.set(p.id, g);
          relist();
        }
        g.here = true;
        g.sync(p, S, dt, view);
      }
      // Gone from S.players.
      let gone = false;
      for (const g of list)
        if (!g.here) {
          g.dispose(scene);
          guards.delete(g.id);
          gone = true;
        }
      if (gone) relist();
      if (guards.size || lights) lendLights();
      plush.sync(S, view);
      scare.update(me, dt, torch);
      hands.update(me, dt, scare.active);
    },
    // After the frame is drawn.
    after(): void {
      scare.after();
    },
  };
}
