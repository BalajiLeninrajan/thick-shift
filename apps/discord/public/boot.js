// The Discord app's entry module, in place of the game's own boot.js (packages/game/assemble.mjs). Discord adds
// frame_id to an Activity's URL, and only then does the page fetch the SDK and play as an Activity. Opened anywhere
// else, it plays as the web game does.
import { start } from './src/main.js';
import { game } from './src/state.js';

if (new URLSearchParams(location.search).has('frame_id')) {
  try {
    await import('./discord/activity.js');
  } catch (err) {
    game.error = { title: 'Could not reach Discord', detail: String(err.message || err) };
  }
}
start();
