// The smaller full-canvas scenes: generator, HUD, jumpscare, and the idle backdrop.
// Film grain is not drawn here. It is a CSS layer over the stage (see styles.css).
import { W, H, MASC, P } from '../config.js';
import { atDoor, clock } from '../rules.js';
import { c, cv, TAU, mix, rgba, hash, ell, rect, rrect, poly, vgrad, glow, vignette, text, pxScale, resetTransform } from './canvas.js';
import { drawMascot, drawFace } from './mascot.js';

/* ---------- generator ---------- */

let crankAngle = 0;
export function drawCrank(S, t) {
  crankAngle += .25;
  rect(0, 0, W, H, vgrad(0, H, [[0, P.mantle], [1, P.crust]]));
  for (let i = 0; i < 6; i++) rect(0, 40 + i * 74, W, 2, rgba(P.surface0, .35));
  c.strokeStyle = P.surface0; c.lineWidth = 10; c.lineCap = 'round';                 // cables
  c.beginPath(); c.moveTo(250, 320); c.bezierCurveTo(140, 380, 90, 300, 0, 360); c.stroke();
  c.beginPath(); c.moveTo(550, 320); c.bezierCurveTo(660, 400, 720, 310, W, 380); c.stroke();
  rrect(240, 150, 320, 220, 14, vgrad(150, 370, [[0, P.surface1], [1, P.surface0]]));     // housing
  c.save(); c.beginPath(); c.roundRect(240, 150, 320, 26, [14, 14, 0, 0]); c.clip();
  rect(240, 150, 320, 26, P.yellow);
  for (let i = -1; i < 14; i++) poly([[240 + i * 28, 176], [254 + i * 28, 176], [272 + i * 28, 150], [258 + i * 28, 150]], P.crust);
  c.restore();
  for (const [x, y] of [[256, 192], [544, 192], [256, 354], [544, 354]]) ell(x, y, 5, 5, P.overlay0);
  const gx = 480, gy = 300, a = Math.PI * (1 + S.power / 100);                            // gauge
  ell(gx, gy, 44, 44, P.crust);
  c.lineWidth = 6; c.strokeStyle = P.red; c.beginPath(); c.arc(gx, gy, 34, Math.PI, Math.PI * 1.25); c.stroke();
  c.strokeStyle = P.yellow; c.beginPath(); c.arc(gx, gy, 34, Math.PI * 1.25, Math.PI * 1.5); c.stroke();
  c.strokeStyle = P.green; c.beginPath(); c.arc(gx, gy, 34, Math.PI * 1.5, TAU); c.stroke();
  c.strokeStyle = P.text; c.lineWidth = 3; c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx + Math.cos(a) * 30, gy + Math.sin(a) * 30); c.stroke();
  ell(gx, gy, 5, 5, P.text);
  text(Math.ceil(S.power) + '%', gx, gy + 26, { size: 13, weight: 700, col: P.text, align: 'center' });
  const fx = 340, fy = 270;                                                               // flywheel
  ell(fx, fy, 66, 66, P.crust); ell(fx, fy, 56, 56, P.surface0);
  c.strokeStyle = P.overlay0; c.lineWidth = 6;
  for (let i = 0; i < 6; i++) { const s = crankAngle * .5 + i * TAU / 6; c.beginPath(); c.moveTo(fx, fy); c.lineTo(fx + Math.cos(s) * 54, fy + Math.sin(s) * 54); c.stroke(); }
  const hx = fx + Math.cos(crankAngle) * 92, hy = fy + Math.sin(crankAngle) * 92;
  c.strokeStyle = P.subtext0; c.lineWidth = 12; c.beginPath(); c.moveTo(fx, fy); c.lineTo(hx, hy); c.stroke();
  ell(fx, fy, 12, 12, P.overlay1); ell(hx, hy, 17, 17, P.red);
  for (let i = 0; i < 14; i++) {                                                          // sparks
    const life = (t * 2.4 + hash(i) * 3) % 1, sa = hash(i + 20) * TAU;
    ell(fx + Math.cos(sa) * (60 + life * 70), fy + Math.sin(sa) * (60 + life * 70) + life * life * 40, 2 * (1 - life), 2 * (1 - life), rgba(P.yellow, 1 - life));
  }
  glow(fx, fy, 170, P.yellow, .12);
  text('Cranking the generator', W / 2, 90, { size: 22, weight: 700, col: P.text, align: 'center' });
  text('Power is coming back. You can\'t see the doors from here, and they can hear you.', W / 2, 116, { size: 13, weight: 400, col: P.subtext0, align: 'center' });
}

/* ---------- HUD ---------- */

const VIEW_COL = { office: P.green, cams: P.blue, crank: P.yellow };
export function drawHud(S, view) {
  rrect(10, 8, 150, 34, 8, rgba(P.ink, .6));
  text(clock(S), 22, 32, { size: 20, weight: 700, col: P.text });
  text('Night ' + S.night, 150, 31, { size: 12, weight: 500, col: P.subtext0, align: 'right' });
  const p = S.power, col = p > 40 ? P.green : p > 15 ? P.yellow : P.red, segs = 16;
  rrect(W - 258, 8, 248, 34, 8, rgba(P.ink, .6));
  text(`Power ${Math.ceil(p)}%`, W - 248, 30, { size: 12, weight: 600, col: P.text });
  for (let i = 0; i < segs; i++) {
    const lit = i < Math.ceil(p / 100 * segs);
    rrect(W - 164 + i * 9, 16, 6, 18, 2, lit ? col : P.surface0);
  }
  if (p > 0) glow(W - 92, 25, 80, col, .1);
  S.players.forEach((pl, i) => {
    ell(18, 56 + i * 16, 4, 4, VIEW_COL[pl.view] || P.green);
    text(pl.name + (pl.view === 'office' ? '' : ` (${pl.view})`), 28, 60 + i * 16, { size: 11, weight: 500, col: P.subtext1 });
  });
  const threat = ['L', 'V', 'R'].some(k => atDoor(S, k).length && !S.doors[k]);
  if (threat && view !== 'office' && Date.now() % 600 < 380) {
    rrect(W / 2 - 92, 8, 184, 30, 8, rgba(P.red, .92));
    text('Thumping nearby', W / 2, 28, { size: 13, weight: 700, col: P.crust, align: 'center' });
  }
  if (p > 0 && p < 15) {
    const v = c.createRadialGradient(W / 2, H / 2, 200, W / 2, H / 2, 520);
    v.addColorStop(0, rgba(P.red, 0)); v.addColorStop(1, rgba(P.red, .1 + .08 * Math.sin(Date.now() / 160)));
    rect(0, 0, W, H, v);
  }
}

/* ---------- jumpscare ---------- */

const SCARE_FRAMES = 95;
// How far to zoom so each head fills the frame without losing its eyes.
const SCARE_ZOOM = { hippo: 2.9, walrus: 3.6, toad: 2.1, rhino: 3.1 };
export { SCARE_FRAMES };
export function drawScare(killer, framesLeft, t) {
  const age = SCARE_FRAMES - framesLeft, zoom = Math.min(SCARE_ZOOM[MASC[killer].k], .8 + age * .2), j = 14;   // lunge, then hold on the face
  rect(0, 0, W, H, P.ink);
  drawFace(killer, W / 2 + (Math.random() - .5) * j * 2, H / 2 + (Math.random() - .5) * j * 2, zoom, { t: t * 6, scare: true });
  vignette(.8);
  if (framesLeft % 9 < 2) rect(0, 0, W, H, rgba(P.ink, .85));   // strobe
  const s = pxScale();                                                  // tear the frame
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  for (let i = 0; i < 5; i++) { const y = Math.random() * cv.height, h = (8 + Math.random() * 40) * s; c.drawImage(cv, 0, y, cv.width, h, (Math.random() - .5) * 120 * s, y, cv.width, h); }
  c.restore(); resetTransform();
}

/* ---------- idle backdrop (title, lobby, between nights) ---------- */

export function drawBackdrop(t) {
  rect(0, 0, W, H, vgrad(0, H, [[0, P.ink], [.8, P.crust], [1, P.ink]]));
  const sweep = W / 2 + Math.sin(t * .3) * 300;
  glow(sweep, 300, 190, P.overlay2, .16);
  MASC.forEach((d, i) => {
    const x = 110 + i * 193, lit = Math.abs(x - sweep) < 90;
    drawMascot(i, x, 300, .5, { t, dark: !lit, rot: lit ? 0 : 2 });   // cute where the light is
  });
  rect(0, 330, W, 120, vgrad(330, H, [[0, rgba(P.overlay1, 0)], [1, rgba(P.overlay1, .16)]]));   // mist
  vignette(.9);
}
