// The camera map: a floor plan in the corner of the feed. Tap a room to switch
// to its camera. It shows where the cameras are and which of your doors are
// shut. It does not show where anything is.
import { W, H, P } from '../config.js';
import { c, rect, rrect, rgba, text } from './canvas.js';

// Everything below is relative to the map's top-left corner.
const MAP = { x: W - 316, y: H - 232, w: 300, h: 208 };
const COL = [10, 108, 206], ROW = [6, 44, 82, 120], BW = 84, BH = 28;
// One entry per camera, in camera order (ROOMS in config.js).
const ROOM = [
  { col: 1, row: 0, tag: 'STAGE' },
  { col: 2, row: 0, tag: 'BACK' },
  { col: 0, row: 1, tag: 'ARCADE' },
  { col: 1, row: 1, tag: 'MAIN' },
  { col: 2, row: 1, tag: 'KITCH' },
  { col: 0, row: 2, tag: 'WEST' },
  { col: 1, row: 2, tag: 'SNACK' },
  { col: 2, row: 2, tag: 'EAST' },
  { col: 1, row: 3, tag: 'DUCTS' },
].map(r => ({ ...r, x: COL[r.col], y: ROW[r.row], w: BW, h: BH }));
const BOOTH = { x: 118, y: 162, w: 64, h: 36 };
// Corridors, as point lists.
const HALLS = [
  [[192, 20], [206, 20]],                     // stage to backstage
  [[150, 34], [150, 44]],                     // stage to main hall
  [[248, 34], [248, 44]],                     // backstage to kitchen
  [[94, 58], [108, 58]],                      // arcade to main hall
  [[192, 58], [206, 58]],                     // main hall to kitchen
  [[199, 58], [199, 96], [192, 96]],          // that corridor, down to the snack bar
  [[52, 72], [52, 82]],                       // arcade to west hall
  [[248, 72], [248, 82]],                     // kitchen to east hall
  [[150, 110], [150, 120]],                   // snack bar to the ducts
  [[52, 110], [52, 180], [118, 180]],         // west hall to your left door
  [[248, 110], [248, 180], [182, 180]],       // east hall to your right door
];
const VENT = [[150, 148], [150, 162]];        // the ducts to the vent above you
// Where each of your doors sits on the booth.
const DOOR_AT = { L: [118, 180], R: [182, 180], V: [150, 162] };

// Which camera a tap at canvas point (x, y) picks, or -1 if it missed the map.
// The nearest room wins, so the targets are far bigger than the boxes drawn.
export function camAt(x, y) {
  const mx = x - MAP.x, my = y - MAP.y;
  if (mx < -8 || my < -8 || mx > MAP.w + 8 || my > BOOTH.y - 6) return -1;
  let best = -1, bestD = Infinity;
  ROOM.forEach((r, i) => { const d = Math.hypot(mx - (r.x + r.w / 2), my - (r.y + r.h / 2)); if (d < bestD) { bestD = d; best = i; } });
  return best;
}

function line(pts, col, dash) {
  c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(MAP.x + x, MAP.y + y) : c.moveTo(MAP.x + x, MAP.y + y));
  c.setLineDash(dash || []); c.strokeStyle = col; c.lineWidth = 2; c.stroke(); c.setLineDash([]);
}

export function drawCamMap(S, cam) {
  rrect(MAP.x - 6, MAP.y - 6, MAP.w + 12, MAP.h + 12, 8, rgba(P.ink, .55));
  const wire = rgba(P.text, .55);
  for (const hall of HALLS) line(hall, wire);
  line(VENT, wire, [4, 4]);
  ROOM.forEach((r, i) => {
    const on = i === cam, x = MAP.x + r.x, y = MAP.y + r.y;
    // The camera you are on blinks, like a recording light.
    rrect(x, y, r.w, r.h, 4, on ? rgba(P.green, Date.now() % 1000 < 650 ? .9 : .6) : rgba(P.ink, .75));
    c.lineWidth = 1.5; c.strokeStyle = on ? P.green : wire; c.beginPath(); c.roundRect(x, y, r.w, r.h, 4); c.stroke();
    text(String(i + 1), x + 10, y + 19, { size: 13, weight: 800, col: on ? P.crust : P.text });
    text(r.tag, x + r.w - 8, y + 18, { size: 9, weight: 700, col: on ? P.crust : P.subtext0, align: 'right' });
  });
  const bx = MAP.x + BOOTH.x, by = MAP.y + BOOTH.y;
  rrect(bx, by, BOOTH.w, BOOTH.h, 4, rgba(P.surface0, .9));
  text('YOU', bx + BOOTH.w / 2, by + 23, { size: 11, weight: 800, col: P.text, align: 'center' });
  for (const k in DOOR_AT) {                                          // your doors: red shut, green open
    const [x, y] = DOOR_AT[k];
    rect(MAP.x + x - 4, MAP.y + y - 4, 8, 8, S.doors[k] ? P.red : P.green);
  }
}
