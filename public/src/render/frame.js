// Picks the scene for the current state and draws one frame.
import { game, client, rnd } from '../state.js';
import { c, fitCanvas, resetTransform } from './canvas.js';
import { drawOffice } from './office.js';
import { drawCams } from './cams.js';
import { drawCrank, drawHud, drawScare, drawBackdrop } from './screens.js';

export function render(t) {
  const S = game.S;
  fitCanvas(); resetTransform();
  if (!S || S.phase === 'lobby') { drawBackdrop(t); return; }
  c.save();
  if (client.shake > 0) c.translate(rnd(-client.shake, client.shake), rnd(-client.shake, client.shake));
  const playing = S.phase === 'play';
  if (playing && client.view === 'cams') drawCams(S, client.cam, client.glitch, t);
  else if (playing && client.view === 'crank') drawCrank(S, t);
  else drawOffice(S, client.pan, client.door, t);
  drawHud(S, client.view);
  if (S.phase === 'dead' && client.scareT > 0) drawScare(S.killer, client.scareT, t);
  c.restore();
}
