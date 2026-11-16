// Entry point: the per-frame loop that ties state, sound, UI and drawing together.
import { DOORS } from './config.js';
import { game, client } from './state.js';
import { SFX, ambience } from './audio.js';
import { threatOf, dreadOf, camDrain, CAM_RECOVER } from './rules.js';
import { syncOverlay, syncControls } from './ui.js';
import { bindInput } from './input.js';
import { render } from './render/frame.js';
import { SCARE_FRAMES } from './render/screens.js';

// What each simulation event does on this client, besides its sound.
const ON_EVENT = {
  bang() { client.shake = 14; },
  step() { client.glitch = 40; },
  arrive() { client.glitch = 40; },
  scare() { client.scareT = SCARE_FRAMES; },
  out() { client.view = 'office'; },
};

function reactToEvents(S) {
  for (const e of S.evs) {
    if (e.id <= client.lastEv) continue;
    client.lastEv = e.id;
    SFX[e.type]?.(e);
    ON_EVENT[e.type]?.();
  }
}

function animate(S) {
  if (S.phase === 'play' && S.t < .3) { client.view = 'office'; client.scareT = 0; client.signal = 1; }   // a new night just began
  client.pan += (client.panT - client.pan) * .18;
  for (const k of DOORS) client.door[k] += ((S.doors[k] ? 1 : 0) - client.door[k]) * .3;
  if (client.shake > 0) { client.shake *= .85; if (client.shake < .5) client.shake = 0; }
  if (client.glitch > 0) client.glitch--;
  if (client.scareT > 0) client.scareT--;
  const wear = client.view === 'cams' ? -camDrain(S) : CAM_RECOVER;
  client.signal = Math.max(0, Math.min(1, client.signal + wear / 60));
}

function frame() {
  requestAnimationFrame(frame);
  const S = game.S;
  if (S) reactToEvents(S);
  syncOverlay();
  render(performance.now() / 1000);
  if (S) animate(S);
  if (S && S.phase === 'play') ambience(threatOf(S), dreadOf(S)); else ambience(-1);
  syncControls();
}

bindInput();
frame();

// ?debug exposes state on window for poking at scenes from the console.
// ?dev adds the dev menu.
const params = new URLSearchParams(location.search);
if (params.has('debug')) window.ts = { game, client };
if (params.has('dev')) import('./dev.js').then(m => m.mountDev());
