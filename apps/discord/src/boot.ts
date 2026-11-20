// The Discord app's entry module (index.html). Discord adds frame_id to an Activity's URL, and only then does the
// page fetch the SDK and play as an Activity. Opened anywhere else, it plays as the web game does.
import '@thick-shift/game/styles.css';
import { start } from '@thick-shift/game';
import { game } from '@thick-shift/game/state';

if (new URLSearchParams(location.search).has('frame_id')) {
  try {
    await import('./activity');
  } catch (err) {
    game.error = { title: 'Could not reach Discord', detail: String(err.message || err) };
  }
}
start();
