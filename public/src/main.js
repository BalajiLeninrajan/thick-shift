// Entry point: the per-frame loop that ties state, sound, UI and drawing together.
import { DOORS } from './config.js';
import { game, client } from './state.js';
import { SFX, ambience } from './audio.js';
import { seenThreat, dreadOf, camDrain, camCap, CAM_RECOVER, sanityOf } from './rules.js';
import { syncOverlay, syncControls } from './ui.js';
import { bindInput } from './input.js';
import { render } from './render/frame.js';
import { SCARE_FRAMES } from './render/screens.js';

const FLOOR_HOLD_MS = 3000;   // the 3D catch is 1.5 s (CUES.end in three/actors/scare.js); the rest is lying there

// What each simulation event does on this client, besides its sound.
const ON_EVENT = {
  bang() { client.shake = 14; },
  step() { client.glitch = 40; },
  arrive() { client.glitch = 40; },
  // On the floor the catch (three/actors/scare.js) takes 1.5 s, and then you lie looking up at it for a while
  // before the end card comes. Timed in milliseconds there, since frames come at whatever rate the screen runs;
  // three/app.js pushes holdUntil on while its catch is still playing.
  scare() { client.scareT = SCARE_FRAMES; client.holdUntil = performance.now() + FLOOR_HOLD_MS; },
  out() { client.view = 'office'; },
  // Only the guard whose hands failed is told why the door is still open.
  fumble(e) { if (e.x.by === game.myId) { client.fumbleT = 110; client.shake = Math.max(client.shake, 5); } },
  // A breaker went and a door dropped open. Everyone feels that one.
  trip() { client.shake = Math.max(client.shake, 8); },
  // The guard who pressed a tripped door's button is told it is the breaker, not their hands.
  dead(e) { if (e.x.by === game.myId) { client.deadT = 110; client.deadK = e.x.k; } },
};

function reactToEvents(S) {
  for (const e of S.evs) {
    if (e.id <= client.lastEv) continue;
    client.lastEv = e.id;
    // On the floor every sound has a place, and three/sound.js plays it there. The win jingle has none.
    if (S.mode !== 'floor' || e.type === 'win') SFX[e.type]?.(e);
    ON_EVENT[e.type]?.(e);
  }
}

function animate(S) {
  if (S.phase === 'play' && S.t < .3) { client.view = 'office'; client.scareT = 0; client.signal = 1; }   // a new night just began
  client.pan += (client.panT - client.pan) * .18;
  for (const k of DOORS) client.door[k] += ((S.doors[k] ? 1 : 0) - client.door[k]) * .3;
  if (client.shake > 0) { client.shake *= .85; if (client.shake < .5) client.shake = 0; }
  if (client.glitch > 0) client.glitch--;
  if (client.scareT > 0) client.scareT--;
  if (client.fumbleT > 0) client.fumbleT--;
  if (client.deadT > 0) client.deadT--;
  const wear = client.view === 'cams' ? -camDrain(S) : CAM_RECOVER;
  client.signal = Math.max(0, Math.min(camCap(S), client.signal + wear / 60));
}

// The 3D mode (three/app.js) is fetched the first time a night on the floor
// is drawn. Until it arrives the 2D canvas keeps showing the backdrop.
let floor = null, floorLoading = false, floorThreat = 0;
function drawFloor() {
  if (!floor) {
    if (!floorLoading) { floorLoading = true; import('./three/app.js').then(m => { floor = m; }, err => { game.error = { title: 'The 3D mode failed to load', detail: String(err.message || err) }; }); }
    return;
  }
  const app = floor.frame(performance.now());
  floorThreat = app.threat();
  if (window.ts) window.ts.floor = app;   // ?debug
}

function frame() {
  requestAnimationFrame(frame);
  const S = game.S;
  if (S) reactToEvents(S);
  syncOverlay();
  const onFloor = S && S.mode === 'floor' && S.phase !== 'lobby' && S.phase !== 'won';
  if (onFloor) drawFloor(); else { floor?.hide(); render(performance.now() / 1000); }
  if (S) animate(S);
  // Your pulse only picks up for something you can see: an open doorway on your screen, in the booth.
  if (S && S.phase === 'play') ambience(onFloor ? floorThreat : client.view === 'office' ? seenThreat(S, client.pan) : 0, dreadOf(S), onFloor ? 1 : sanityOf(S, game.myId)); else ambience(-1);
  syncControls();
}

bindInput();
frame();

// ?debug exposes state on window for poking at scenes from the console.
// ?dev adds the dev menu.
const params = new URLSearchParams(location.search);
if (params.has('debug')) window.ts = { game, client };
if (params.has('dev')) import('./dev.js').then(m => m.mountDev());
