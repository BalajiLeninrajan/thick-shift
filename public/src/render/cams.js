// The camera feed: one backdrop per room, then a CCTV treatment over the top.
import { W, H, ROOMS, MASC, P } from '../config.js';
import { inRoom, clock, rotOf, dreadOf } from '../rules.js';
import { c, cv, mix, rgba, hash, lerp, ell, rect, rrect, poly, vgrad, glow, vignette, text, pxScale, resetTransform } from './canvas.js';
import { drawMascot, drawFace } from './mascot.js';

let t, dread;

/* ---------- rooms ---------- */

function stage() {
  rect(0, 0, W, H, vgrad(0, H, [[0, P.crust], [1, P.mantle]]));
  rect(0, 330, W, 120, vgrad(330, H, [[0, mix(P.peach, P.crust, .7)], [1, mix(P.peach, P.crust, .88)]]));
  c.strokeStyle = rgba(P.ink, .45); c.lineWidth = 2;
  for (let i = -8; i <= 8; i++) { c.beginPath(); c.moveTo(W / 2 + i * 60, 330); c.lineTo(W / 2 + i * 130, H); c.stroke(); }
  for (const side of [0, 1]) for (let i = 0; i < 5; i++) {              // curtains
    const x = side ? W - 34 - i * 34 : i * 34, shade = .45 + (i % 2) * .15 + i * .04;
    rect(x, 0, 34, 340 - i * 6, vgrad(0, 340, [[0, mix(P.red, P.crust, shade)], [1, mix(P.red, P.crust, shade + .2)]]));
  }
  for (let i = 0; i < 9; i++) ell(45 + i * 89, 0, 52, 44, mix(P.red, P.crust, .5));    // valance
  rect(560, 262, 70, 70, P.surface0); rect(574, 200, 62, 62, P.surface1);             // crates
  c.strokeStyle = P.crust; c.lineWidth = 3; c.strokeRect(560, 262, 70, 70); c.strokeRect(574, 200, 62, 62);
  text('RETIRED', 605, 236, { size: 10, weight: 800, col: P.red, align: 'center' });
  c.save(); c.globalCompositeOperation = 'lighter';
  poly([[W / 2 - 20, 0], [W / 2 + 20, 0], [W / 2 + 230, 420], [W / 2 - 230, 420]], vgrad(0, 420, [[0, rgba(P.yellow, .2)], [1, rgba(P.yellow, .02)]]));
  c.restore();
}

// One-point-perspective hallway. decorate() adds what makes each hall different.
function hall(decorate) {
  const back = { x0: 300, x1: 500, y0: 140, y1: 300 };
  rect(0, 0, W, H, P.mantle);
  poly([[0, 0], [back.x0, back.y0], [back.x0, back.y1], [0, H]], mix(P.base, P.crust, .3));     // left wall
  poly([[W, 0], [back.x1, back.y0], [back.x1, back.y1], [W, H]], mix(P.base, P.crust, .5));     // right wall
  poly([[0, 0], [W, 0], [back.x1, back.y0], [back.x0, back.y0]], P.crust);                      // ceiling
  rect(back.x0, back.y0, 200, 160, mix(P.base, P.crust, .6));
  rect(370, 190, 60, 110, P.ink);
  const rows = 6, cols = 6;                                                                     // floor tiles
  for (let r = 0; r < rows; r++) {
    const z0 = (r / rows) ** 1.7, z1 = ((r + 1) / rows) ** 1.7;
    const edge = z => [lerp(back.x0, -200, z), lerp(back.x1, W + 200, z), lerp(back.y1, H, z)];
    const [l0, r0, y0] = edge(z0), [l1, r1, y1] = edge(z1);
    for (let k = 0; k < cols; k++) poly(
      [[lerp(l0, r0, k / cols), y0], [lerp(l0, r0, (k + 1) / cols), y0], [lerp(l1, r1, (k + 1) / cols), y1], [lerp(l1, r1, k / cols), y1]],
      (r + k) % 2 ? P.crust : mix(P.surface0, P.crust, .4));
  }
  for (let i = 0; i < 3; i++) {                                                                 // ceiling lights
    const z = i / 3, y = lerp(back.y0 - 4, 26, z), w = lerp(26, 110, z);
    const lit = hash(Math.floor(t * 9) + i * 13) > .08;
    rrect(W / 2 - w / 2, y - 4, w, lerp(4, 12, z), 2, lit ? P.yellow : P.surface1);
    if (lit) glow(W / 2, y, lerp(70, 220, z), P.yellow, .13);
  }
  decorate(back);
}

function mainHall() {
  hall(() => {
    for (let i = 0; i < 9; i++) {                                       // bunting
      const x = 40 + i * 90, y = 54 + Math.sin(i * .8) * 18;
      poly([[x - 22, y], [x + 22, y], [x, y + 40]], [P.red, P.yellow, P.blue, P.green, P.mauve][i % 5]);
    }
    rrect(320, 152, 160, 30, 4, P.crust);
    text('MASCOT DEPOT', 400, 172, { size: 14, weight: 800, col: P.yellow, align: 'center' });
  });
}
function westHall() {
  hall(() => {
    c.strokeStyle = P.surface1; c.lineWidth = 9;
    c.beginPath(); c.moveTo(0, 56); c.lineTo(292, 150); c.stroke();
    c.strokeStyle = P.surface0; c.lineWidth = 5;
    c.beginPath(); c.moveTo(0, 86); c.lineTo(292, 164); c.stroke();
    rrect(326, 152, 148, 30, 4, P.crust);
    text('← SECURITY', 400, 172, { size: 13, weight: 800, col: P.green, align: 'center' });
  });
}
function eastHall() {
  hall(() => {
    for (let i = 0; i < 4; i++) {                                       // lockers
      const x0 = 800 - i * 70, x1 = x0 - 62, top = z => lerp(140, 0, z) + 60, bot = z => lerp(300, 450, z);
      const z0 = (x0 - 500) / 300, z1 = (x1 - 500) / 300;
      poly([[x0, top(z0)], [x1, top(z1)], [x1, bot(z1)], [x0, bot(z0)]], mix(P.blue, P.crust, .7 + i * .04));
    }
    rrect(326, 152, 148, 30, 4, P.crust);
    text('SECURITY →', 400, 172, { size: 13, weight: 800, col: P.green, align: 'center' });
  });
}

function snackBar() {
  rect(0, 0, W, H, vgrad(0, H, [[0, mix(P.base, P.yellow, .06)], [1, P.mantle]]));
  c.strokeStyle = rgba(P.ink, .35); c.lineWidth = 1;
  for (let x = 0; x < W; x += 40) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 330); c.stroke(); }
  for (let y = 10; y < 330; y += 40) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  rrect(70, 60, 240, 130, 6, P.crust);                                  // menu board
  text('SNACKS', 190, 90, { size: 18, weight: 800, col: P.yellow, align: 'center' });
  for (let i = 0; i < 4; i++) { rect(92, 106 + i * 18, 110 + hash(i) * 50, 6, P.surface1); rect(266, 106 + i * 18, 24, 6, P.peach); }
  rect(560, 80, 150, 70, P.ink);                                        // the vent it leaves through
  c.strokeStyle = P.surface1; c.lineWidth = 3;
  for (let y = 90; y < 150; y += 12) { c.beginPath(); c.moveTo(560, y); c.lineTo(710, y); c.stroke(); }
  c.lineWidth = 8; c.strokeStyle = P.surface0; c.strokeRect(560, 80, 150, 70);
  for (let i = 0; i < 10; i++) rect(i * 80, 210, 80, 26, i % 2 ? P.red : P.rosewater);   // awning
  for (let i = 0; i < 10; i++) ell(i * 80 + 40, 236, 40, 12, i % 2 ? P.red : P.rosewater);
  rect(0, 300, W, 16, mix(P.peach, P.crust, .5));
  rect(0, 316, W, 70, vgrad(316, 386, [[0, mix(P.red, P.crust, .6)], [1, mix(P.red, P.crust, .8)]]));
  rect(0, 386, W, 64, P.crust);
  for (let i = 0; i < 20; i++) if (i % 2) rect(i * 40, 386, 40, 64, mix(P.surface0, P.crust, .5));
  rrect(380, 236, 60, 66, 4, mix(P.yellow, P.crust, .35)); glow(410, 268, 80, P.yellow, .22);   // popcorn machine
}

const ROOM_ART = [stage, mainHall, westHall, eastHall, snackBar];

/* ---------- CCTV treatment ---------- */

function tearSlices(n) {
  const s = pxScale();
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  for (let i = 0; i < n; i++) {
    const y = Math.random() * cv.height, h = (6 + Math.random() * 30) * s, dx = (Math.random() - .5) * 90 * s;
    c.drawImage(cv, 0, y, cv.width, h, dx, y, cv.width, h);
  }
  c.restore(); resetTransform();
}

function feedFx(glitch) {
  c.save(); c.globalCompositeOperation = 'color'; rect(0, 0, W, H, rgba(mix(P.overlay2, P.teal, .25), .3 + dread * .4)); c.restore();   // drain the color
  rect(0, 0, W, H, rgba(P.ink, .1 + dread * .26));
  const bar = (t * 70) % (H + 120) - 120;
  rect(0, bar, W, 120, vgrad(bar, bar + 120, [[0, rgba(P.text, 0)], [.5, rgba(P.text, .06)], [1, rgba(P.text, 0)]]));
  if (glitch > 0) tearSlices(glitch > 12 ? 9 : 4);
  for (let i = 0; i < (glitch > 0 ? 240 : 46); i++) rect(Math.random() * W, Math.random() * H, 2 + Math.random() * (glitch > 0 ? 190 : 50), 1.4, rgba(P.text, Math.random() * .22));
  for (let y = 0; y < H; y += 3) rect(0, y, W, 1, rgba(P.ink, .28));
  vignette(.9);
}

function overlayText(S, cam, glitch) {
  c.strokeStyle = rgba(P.text, .7); c.lineWidth = 2;
  for (const [x, y, sx, sy] of [[16, 44, 1, 1], [W - 16, 44, -1, 1], [16, H - 24, 1, -1], [W - 16, H - 24, -1, -1]]) {
    c.beginPath(); c.moveTo(x, y + sy * 18); c.lineTo(x, y); c.lineTo(x + sx * 18, y); c.stroke();
  }
  text(`CAM 0${cam + 1}  ${ROOMS[cam].toUpperCase()}`, 30, H - 64, { size: 17, weight: 700, col: P.text });
  const sec = String(Math.floor(S.t * 80 % 60)).padStart(2, '0');
  text(`${clock(S)} :${sec}`, W - 30, H - 44, { size: 12, weight: 500, col: P.subtext0, align: 'right' });
  if (Date.now() % 1000 < 600) { ell(W - 74, 67, 6, 6, P.red); glow(W - 74, 67, 20, P.red, .5); }
  text('REC', W - 30, 72, { size: 13, weight: 700, col: P.text, align: 'right' });
  if (glitch > 12) text('SIGNAL LOST', W / 2, H / 2, { size: 26, weight: 800, col: P.text, align: 'center' });
  text('Doors and vent are blind spots. Cameras drain power.', 30, H - 44, { size: 11, weight: 500, col: P.subtext0 });
}

// How a mascot shows up on camera depends on how close it is to you.
function subject(S, m, cam, x) {
  const path = MASC[m.i].paths[m.side], stepsLeft = path.length - 1 - m.pos, rot = rotOf(S, m);
  // One room from your door: its face is against the lens.
  if (stepsLeft === 1 && path.length > 2 && rot === 2) return drawFace(m.i, x + 70, H / 2 + 40, 3.1, { t });
  // Still in its starting room: back to the camera, looking over its shoulder.
  if (m.pos === 0 || rot < 2) return drawMascot(m.i, x, 268, .8, { t, rot, pose: Math.floor(S.t / 17 + m.i + m.pos) % 3 ? 'back' : 'front' });
  // In between: too big for the hall, most of it lost in the fog.
  drawMascot(m.i, x + (hash(m.i + cam) - .5) * 80, 236, 1.3, { t });
  fog(.62);
}

// Grey fog, thickest near the floor.
function fog(a) {
  rect(0, 0, W, H, vgrad(0, H, [[0, rgba(P.overlay1, a * .75)], [1, rgba(P.overlay2, a)]]));
  for (let i = 0; i < 5; i++) glow((i * 190 + t * (6 + i * 3)) % (W + 300) - 150, 300 + i * 24, 190, P.overlay2, a * .3);
}

export function drawCams(S, cam, glitch, time) {
  t = time; dread = dreadOf(S);
  ROOM_ART[cam]();
  // Movement is hidden behind the static, so you never see anyone walk.
  if (glitch <= 0) {
    const here = inRoom(S, cam);
    here.forEach((m, j) => subject(S, m, cam, W / 2 + (j - (here.length - 1) / 2) * 250));
    fog(dread * .22);
    if (!here.length) text('nobody here', W / 2, 236, { size: 13, weight: 500, col: rgba(P.text, .35), align: 'center' });
  }
  feedFx(glitch);
  overlayText(S, cam, glitch);
}
