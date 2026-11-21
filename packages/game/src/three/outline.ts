// The gold edge round things a guard can use, like the highlight in some
// games' accessibility modes: so a breaker box, a battery or a friend on the
// floor reads as something to walk to, even in the dark. post.ts draws it:
// the marked objects go into a mask, which is edged and laid over the
// finished picture, hidden where a wall is in front.
//
// What gets an edge, and how strongly (alpha: post.ts draws a wider edge the
// higher it is, and the widest, at 1, is kept for what the use key would act on):
//   open faults          gold, pulsing, red in their last seconds; in any room that can be seen
//   what you are aiming at  brighter and thicker, whatever it is
//   batteries, the crank, the charger, door buttons, a Mini Biggs on the floor (with empty hands)  a faint gold, within NEAR metres
//   flat teammates       red, wherever they can be seen
// The switch is in the pause panel (prefs.outline in player.ts), on by default.

import { faultLeft } from '@thick-shift/sim';
import { defined, isNight } from '@thick-shift/sim/check';
import { DOORS } from '@thick-shift/sim/config';
import { BATTERY_SPOTS, CHARGER, GENERATOR, PANELS } from '@thick-shift/sim/map';
import type { Point, State } from '@thick-shift/sim/types';
import type { Object3D } from 'three';
import { game } from '../state';
import type { Actors, Me, OutlineMark, Target, WorldParts } from '../types';
import { HURRY } from './hud';
import { myPlayer, prefs } from './player';

const NEAR = 6;
const GOLD: OutlineMark['col'] = [1, 0.78, 0.28],
  RED: OutlineMark['col'] = [1, 0.32, 0.28];

export function createOutlines(parts: WorldParts, actors: Actors) {
  const marks: OutlineMark[] = [];
  // obj is missing when a part or a guard's model has not been built; add skips it.
  const add = (obj: Object3D | null | undefined, col: OutlineMark['col'], a: number): void => {
    if (obj) marks.push({ obj, col, a });
  };
  // The thing the use key would act on. A locker has no part of its own to edge.
  const partFor = (aim: Target): Object3D | null | undefined => {
    switch (aim.what) {
      case 'fix':
        return parts.boxes[aim.i];
      case 'bat':
        return parts.bats[aim.i];
      case 'crank':
        return parts.gen;
      case 'charge':
        return parts.dock;
      case 'door':
        return parts.panels[aim.k];
      case 'peel':
        return actors.guards.get(aim.id)?.group;
      case 'toy':
        return actors.plush.group(aim.id);
      case 'hide':
        return null;
    }
  };
  return {
    // The marks for this frame: [{ obj, col, a }]. Empty with the switch off or nobody standing.
    pick(S: State, me: Me, t: number): OutlineMark[] {
      marks.length = 0;
      if (!prefs.outline || S.phase !== 'play' || me.flat) return marks;
      const near = (at: Point): boolean => Math.hypot(at.x - me.x, at.z - me.z) < NEAR;
      // The thing the use key would act on. findTarget (player.ts) sets i for a box or battery and k for a door.
      const aim = me.task ? null : me.target,
        aimed = aim && partFor(aim);
      if (aim) add(aimed, aim.what === 'peel' ? RED : GOLD, 1);
      const pulse = 0.62 + 0.22 * Math.sin(t * 4);
      if (isNight(S))
        S.faults.forEach((f, i) => {
          if (f && parts.boxes[i] !== aimed) add(parts.boxes[i], faultLeft(S, f) < HURRY ? RED : GOLD, pulse);
        });
      for (const p of S.players)
        if (p.flat && p.id !== game.myId) {
          const g = actors.guards.get(p.id)?.group;
          if (g !== aimed) add(g, RED, 0.8);
        }
      const faint = (obj: Object3D | undefined, at: Point): void => {
        if (obj !== aimed && near(at)) add(obj, GOLD, 0.45);
      };
      for (const i of S.bats || []) faint(parts.bats[i], defined(BATTERY_SPOTS[i], `battery spot ${i}`));
      faint(parts.gen, GENERATOR);
      if (!myPlayer(S)?.toy) for (const toy of S.toys || []) if (S.t >= toy.land) faint(actors.plush.group(toy.id), toy);
      if (S.power > 0) {
        faint(parts.dock, CHARGER);
        for (const k of DOORS) faint(parts.panels[k], PANELS[k]);
      }
      return marks;
    },
  };
}
