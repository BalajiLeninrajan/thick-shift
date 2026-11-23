// Entry point: the per-frame loop that ties state, sound, UI and drawing together.

import { dreadF } from '@thick-shift/sim';
import type { State } from '@thick-shift/sim/types';
import { ambience, win } from './audio';
import { errorText } from './dom';
import { CATCH_S, client, game, LINGER_S } from './state';
import type { FloorModule } from './types';
import { syncOverlay } from './ui';

// window.ts, the ?debug handle for poking at the game from the console.
const debugWindow = window as Window & { ts?: { game: object; client: object; floor?: object } };

// Every sound with a place is played there by three/sound.ts. The win jingle has none, so it plays here.
// The end card waits out the catch and the look up at it afterwards. three/app.ts pushes holdUntil on while its catch
// is still playing, however long a slow machine takes over it.
let lastEv = -1; // id of the last event we reacted to
function reactToEvents(S: State): void {
  // A page that arrives part way through has missed what already happened (three/app.ts and sound.ts do the same).
  if (lastEv < 0) lastEv = S.evId;
  for (const e of S.evs) {
    if (e.id <= lastEv) continue;
    lastEv = e.id;
    if (e.type === 'win') win();
    if (e.type === 'scare') client.holdUntil = performance.now() + (CATCH_S + LINGER_S) * 1000;
  }
}

// three/app.ts is fetched the first time a night is drawn. Until it arrives the stage stays dark.
let floor: FloorModule | null = null,
  floorLoading = false,
  floorThreat = 0;
function drawFloor(): void {
  if (!floor) {
    if (!floorLoading) {
      floorLoading = true;
      import('./three/app').then(
        m => {
          floor = m;
        },
        (err: unknown) => {
          game.error = { title: 'The game failed to load', detail: errorText(err) };
        }
      );
    }
    return;
  }
  const app = floor.frame(performance.now());
  floorThreat = app.threat();
  if (debugWindow.ts) debugWindow.ts.floor = app; // ?debug
}

function frame(): void {
  requestAnimationFrame(frame);
  const S = game.S;
  if (S) reactToEvents(S);
  syncOverlay();
  if (S && S.phase !== 'lobby' && S.phase !== 'won') drawFloor();
  else floor?.hide();
  if (S && S.phase === 'play') ambience(floorThreat, dreadF(S));
  else ambience(-1);
}

// Starts the frame loop. Called once, by each app's src/boot.ts.
export function start(): void {
  frame();
  // ?debug exposes state on window for poking at scenes from the console.
  // ?dev adds the dev menu.
  const params = new URLSearchParams(location.search);
  if (params.has('debug')) debugWindow.ts = { game, client };
  if (params.has('dev')) import('./dev').then(m => m.mountDev());
}
