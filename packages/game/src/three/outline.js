// The gold edge round things a guard can use, like the highlight in some
// games' accessibility modes: so a breaker box, a battery or a friend on the
// floor reads as something to walk to, even in the dark. post.js draws it:
// the marked objects go into a mask, which is edged and laid over the
// finished picture, hidden where a wall is in front.
//
// What gets an edge, and how strongly (alpha: post.js draws a wider edge the
// higher it is, and the widest, at 1, is kept for what the use key would act on):
//   open faults          gold, pulsing, red in their last seconds; in any room that can be seen
//   what you are aiming at  brighter and thicker, whatever it is
//   batteries, the crank, the charger, door buttons, a Mini Biggs on the floor (with empty hands)  a faint gold, within NEAR metres
//   flat teammates       red, wherever they can be seen
// The switch is in the pause panel (prefs.outline in player.js), on by default.
import { game } from '../state.js';
import { GENERATOR, CHARGER, PANELS, BATTERY_SPOTS } from './map.js';
import { faultLeft } from './sim3d.js';
import { prefs } from './player.js';

const NEAR = 6,
  HURRY = 15;
const GOLD = [1, 0.78, 0.28],
  RED = [1, 0.32, 0.28];

export function createOutlines(parts, actors) {
  const marks = [];
  const add = (obj, col, a) => {
    if (obj) marks.push({ obj, col, a });
  };
  return {
    // The marks for this frame: [{ obj, col, a }]. Empty with the switch off or nobody standing.
    pick(S, me, t) {
      marks.length = 0;
      if (!prefs.outline || S.phase !== 'play' || me.flat) return marks;
      const near = at => Math.hypot(at.x - me.x, at.z - me.z) < NEAR;
      const aim = me.target,
        aimed = new Set();
      // The thing the use key would act on.
      if (aim && !me.task) {
        const obj =
          aim.what === 'fix'
            ? parts.boxes[aim.i]
            : aim.what === 'bat'
              ? parts.bats[aim.i]
              : aim.what === 'crank'
                ? parts.gen
                : aim.what === 'charge'
                  ? parts.dock
                  : aim.what === 'door'
                    ? parts.panels[aim.k]
                    : aim.what === 'peel'
                      ? actors.guards.get(aim.id)?.group
                      : aim.what === 'toy'
                        ? actors.plush.group(aim.id)
                        : null;
        add(obj, aim.what === 'peel' ? RED : GOLD, 1);
        aimed.add(obj);
      }
      const pulse = 0.62 + 0.22 * Math.sin(t * 4);
      S.faults?.forEach((f, i) => {
        if (f && !aimed.has(parts.boxes[i])) add(parts.boxes[i], faultLeft(S, f) < HURRY ? RED : GOLD, pulse);
      });
      for (const p of S.players)
        if (p.flat && p.id !== game.myId) {
          const g = actors.guards.get(p.id)?.group;
          if (!aimed.has(g)) add(g, RED, 0.8);
        }
      const faint = (obj, at) => {
        if (!aimed.has(obj) && near(at)) add(obj, GOLD, 0.45);
      };
      for (const i of S.bats || []) faint(parts.bats[i], BATTERY_SPOTS[i]);
      faint(parts.gen, GENERATOR);
      if (!S.players.find(p => p.id === game.myId)?.toy) for (const toy of S.toys || []) if (S.t >= toy.land) faint(actors.plush.group(toy.id), toy);
      if (S.power > 0) {
        faint(parts.dock, CHARGER);
        for (const k in PANELS) faint(parts.panels[k], PANELS[k]);
      }
      return marks;
    },
  };
}
