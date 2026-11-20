// Entry point: the per-frame loop that ties state, sound, UI and drawing together.
import { game, client } from './state.js';
import { SFX, ambience } from './audio.js';
import { dreadF } from '@thick-shift/sim';
import { syncOverlay } from './ui.js';

// window.ts, the ?debug handle for poking at the game from the console.
const debugWindow = /** @type {Window & { ts?: { game: object, client: object, floor?: object } }} */ (window);
const FLOOR_HOLD_MS = 3000; // the catch is 1.5 s (CUES.end in three/actors/scare.js); the rest is lying there

// Every sound with a place is played there by three/sound.js. The win jingle has none, so it plays here.
// The catch takes 1.5 s, and then you lie looking up at it for a while before the end card comes. Timed in
// milliseconds, since frames come at whatever rate the screen runs; three/app.js pushes holdUntil on while
// its catch is still playing.
function reactToEvents(S) {
  for (const e of S.evs) {
    if (e.id <= client.lastEv) continue;
    client.lastEv = e.id;
    if (e.type === 'win') SFX.win();
    if (e.type === 'scare') client.holdUntil = performance.now() + FLOOR_HOLD_MS;
  }
}

// three/app.js is fetched the first time a night is drawn. Until it arrives the stage stays dark.
let floor = null,
  floorLoading = false,
  floorThreat = 0;
function drawFloor() {
  if (!floor) {
    if (!floorLoading) {
      floorLoading = true;
      import('./three/app.js').then(
        m => {
          floor = m;
        },
        err => {
          game.error = { title: 'The game failed to load', detail: String(err.message || err) };
        }
      );
    }
    return;
  }
  const app = floor.frame(performance.now());
  floorThreat = app.threat();
  if (debugWindow.ts) debugWindow.ts.floor = app; // ?debug
}

function frame() {
  requestAnimationFrame(frame);
  const S = game.S;
  if (S) reactToEvents(S);
  syncOverlay();
  if (S && S.phase !== 'lobby' && S.phase !== 'won') drawFloor();
  else floor?.hide();
  if (S && S.phase === 'play') ambience(floorThreat, dreadF(S));
  else ambience(-1);
}

// Starts the frame loop. Called once, by each app's src/boot.js.
export function start() {
  frame();
  // ?debug exposes state on window for poking at scenes from the console.
  // ?dev adds the dev menu.
  const params = new URLSearchParams(location.search);
  if (params.has('debug')) debugWindow.ts = { game, client };
  if (params.has('dev')) import('./dev.js').then(m => m.mountDev());
}
