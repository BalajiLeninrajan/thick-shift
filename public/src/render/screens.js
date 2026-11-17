// The smaller full-canvas scenes: generator, HUD, jumpscare, and the idle backdrop.
// Film grain is not drawn here. It is a CSS layer over the stage (see styles.css).
import { W, H, MASC, DOORS, P } from '../config.js';
import { clock, sanityOf, tripLeft, heatRate, GEN_HEAT, GEN_LOCK, genLeft, crankerOf, turning } from '../rules.js';
import { game, client } from '../state.js';
import { sanityCap } from '../sim.js';
import { c, cv, TAU, mix, rgba, hash, font, ell, rect, rrect, poly, vgrad, glow, vignette, text, pxScale, resetTransform } from './canvas.js';
import { drawMascot, drawFace } from './mascot.js';

/* ---------- generator ---------- */

// One handle (S.cranker), and it runs hot (S.gen): see GEN_HEAT in rules.js.
// The wheel only goes round while someone is turning it, so a guard who walks
// up to a seized or taken generator sees at once that nothing is happening.
let crankAngle = 0;
export function drawCrank(S, t) {
  const spin = turning(S), heat = S.gen || 0, by = crankerOf(S), mine = !by || by.id === game.myId;
  if (spin) crankAngle += .25;
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
  const tx = 480, ty = 222, ta = Math.PI * (1 + heat);                                    // temperature: it seizes at the end of the red
  ell(tx, ty, 32, 32, P.crust);
  c.lineWidth = 5; c.strokeStyle = P.teal; c.beginPath(); c.arc(tx, ty, 24, Math.PI, Math.PI * 1.5); c.stroke();
  c.strokeStyle = P.yellow; c.beginPath(); c.arc(tx, ty, 24, Math.PI * 1.5, Math.PI * 1.8); c.stroke();
  c.strokeStyle = P.red; c.beginPath(); c.arc(tx, ty, 24, Math.PI * 1.8, TAU); c.stroke();
  c.strokeStyle = S.seized ? P.red : P.text; c.lineWidth = 3; c.beginPath(); c.moveTo(tx, ty); c.lineTo(tx + Math.cos(ta) * 21, ty + Math.sin(ta) * 21); c.stroke();
  ell(tx, ty, 4, 4, P.text);
  text('HEAT', tx, ty + 18, { size: 9, weight: 700, col: heat > .8 ? P.red : P.subtext0, align: 'center' });
  const fx = 340, fy = 270;                                                               // flywheel
  ell(fx, fy, 66, 66, P.crust); ell(fx, fy, 56, 56, P.surface0);
  c.strokeStyle = P.overlay0; c.lineWidth = 6;
  for (let i = 0; i < 6; i++) { const s = crankAngle * .5 + i * TAU / 6; c.beginPath(); c.moveTo(fx, fy); c.lineTo(fx + Math.cos(s) * 54, fy + Math.sin(s) * 54); c.stroke(); }
  const hx = fx + Math.cos(crankAngle) * 92, hy = fy + Math.sin(crankAngle) * 92;
  c.strokeStyle = P.subtext0; c.lineWidth = 12; c.beginPath(); c.moveTo(fx, fy); c.lineTo(hx, hy); c.stroke();
  ell(fx, fy, 12, 12, P.overlay1); ell(hx, hy, 17, 17, P.red);
  if (spin) for (let i = 0; i < 14; i++) {                                                // sparks
    const life = (t * 2.4 + hash(i) * 3) % 1, sa = hash(i + 20) * TAU;
    ell(fx + Math.cos(sa) * (60 + life * 70), fy + Math.sin(sa) * (60 + life * 70) + life * life * 40, 2 * (1 - life), 2 * (1 - life), rgba(P.yellow, 1 - life));
  }
  glow(fx, fy, 170, S.seized ? P.red : P.yellow, spin ? .12 : S.seized ? .1 + .04 * Math.sin(t * 3) : 0);
  if (heat > .7) for (let i = 0; i < 8; i++) {                                            // smoke off the housing
    const life = (t * .45 + hash(i + 60)) % 1;
    ell(290 + hash(i + 70) * 220 + Math.sin(t + i) * 8, 152 - life * 80, 10 + life * 22, 8 + life * 16, rgba(P.overlay1, (1 - life) * .4 * Math.min(1, (heat - .7) / .2)));
  }
  // What the guard at the generator needs to know: is it mine, is it turning, and if not, when.
  // Letting go in the red costs nothing. Riding it into a seize locks it for GEN_LOCK, which is longer (GEN_HEAT.jam).
  const [title, note] = S.seized ? ['Generator seized', `Jammed. Ready in ${Math.ceil(genLeft(S))} s.`]
    : !mine ? [`${by.name} has the handle`, 'One handle. Go back to the doors or wait.']
    : heat > .7 ? ['Cranking the generator', `It is running hot. Let go before the red runs out, or it jams for ${Math.round(GEN_LOCK)} s.`]
    : ['Cranking the generator', 'Power is coming back. You can\'t see the doors from here, and they can hear you.'];
  text(title, W / 2, 90, { size: 22, weight: 700, col: S.seized ? P.red : P.text, align: 'center' });
  text(note, W / 2, 116, { size: 13, weight: 400, col: P.subtext0, align: 'center' });
}

/* ---------- HUD ---------- */

const VIEW_COL = { office: P.green, cams: P.blue, crank: P.yellow };
const DOOR_NAME = { L: 'Left door', V: 'Vent', R: 'Right door' };
// Sanity: a thin bar under the power meter, and what low sanity does to the frame.
function drawSanity(S) {
  const sanity = sanityOf(S, game.myId), col = sanity > .5 ? P.lavender : sanity > .25 ? P.yellow : P.red;
  rrect(W - 258, 46, 248, 18, 6, rgba(P.ink, .6));
  text('Sanity', W - 248, 59, { size: 10, weight: 600, col: P.subtext0 });
  rrect(W - 164, 52, 141, 6, 3, P.surface0);
  if (sanity > 0) rrect(W - 164, 52, Math.max(6, 141 * sanity), 6, 3, col);
  const cap = sanityCap(S.night, S.t);                                       // the part of the bar you no longer get back
  if (cap < 1) rect(W - 164 + 141 * cap, 50, 1.5, 10, P.overlay1);
  // Why the door you pressed is still open. A tripped breaker comes before
  // shaking hands: it is the one you can do nothing about.
  const wait = client.deadT > 0 ? Math.ceil(tripLeft(S, client.deadK)) : 0;
  const why = wait > 0 ? `${DOOR_NAME[client.deadK]} breaker is out. ${wait} s.` : client.fumbleT > 0 ? 'Your hands are shaking. The door did not shut.' : '';
  if (why) {
    rrect(W / 2 - 150, H - 32, 300, 26, 8, rgba(P.ink, .85));   // below the door plates, which end at H - 34
    text(why, W / 2, H - 15, { size: 12, weight: 600, col: P.red, align: 'center' });
  }
  if (sanity < .5) vignette((.5 - sanity) * (1 + .5 * Math.sin(Date.now() / 300)));   // the edges close in
}

// The generator's temperature, under the clock in every view, so the guards
// on the doors know who has the handle and when it will turn again. The tick
// on a seized bar is the heat it has to cool to. It sits on the left because
// a third strip on the right would hang over the vent for a guard panned left.
function drawGenerator(S) {
  const heat = S.gen || 0, by = crankerOf(S);
  rrect(10, 46, 206, 18, 6, rgba(P.ink, .6));
  text('Generator', 20, 59, { size: 10, weight: 600, col: P.subtext0 });
  rrect(78, 52, 50, 6, 3, P.surface0);
  if (heat > 0) rrect(78, 52, Math.max(6, 50 * heat), 6, 3, S.seized || heat > .8 ? P.red : heat > .5 ? P.yellow : P.teal);
  if (S.seized) rect(78 + 50 * GEN_HEAT.reset, 50, 1.5, 10, P.overlay1);
  const note = S.seized ? `seized ${Math.ceil(genLeft(S))}s` : turning(S) ? by.name : '';
  if (note) text(note, 208, 59, { size: 10, weight: 600, col: S.seized ? P.red : P.yellow, align: 'right' });
}

// Doors shut together share a breaker and heat each other (heatRate). Say so
// while it is happening, in every view: it is the reason a door is about to trip.
function drawBreakerLoad(S) {
  const shut = DOORS.filter(k => S.doors[k]).length;
  if (shut < 2) return;
  const str = `${shut} doors on one breaker: heating ${+(heatRate(shut) / heatRate(1)).toFixed(1)}x`;
  c.font = font(600, 12);
  const w = c.measureText(str).width + 24;
  rrect(W / 2 - w / 2, 8, w, 24, 8, rgba(P.ink, .8));
  text(str, W / 2, 24, { size: 12, weight: 600, col: shut > 2 ? P.red : P.yellow, align: 'center' });
}

export function drawHud(S, view) {
  drawSanity(S);
  drawGenerator(S);
  drawBreakerLoad(S);
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
  // Who is where, on a plate like the strips above so it reads as HUD and not
  // as part of the room. Past three guards it goes two to a row with shorter
  // names, so it never runs further down the left doorway than three do.
  const n = S.players.length, cols = n > 3 ? 2 : 1, rows = Math.ceil(n / cols);
  const labels = S.players.map(pl => (cols === 2 ? pl.name.slice(0, 8) : pl.name) + (pl.view === 'office' ? '' : ` (${pl.view})`));
  c.font = font(500, 11);
  const colW = Math.max(0, ...labels.map(s => c.measureText(s).width)) + 26;
  if (n) rrect(10, 68, cols * colW, rows * 16 + 4, 6, rgba(P.ink, .6));
  S.players.forEach((pl, i) => {
    const x = 10 + (i % cols) * colW, y = 78 + Math.floor(i / cols) * 16;
    ell(x + 8, y, 4, 4, VIEW_COL[pl.view] || P.green);
    text(labels[i], x + 18, y + 4, { size: 11, weight: 500, col: P.subtext1 });
  });
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

// Morning, after the last night. Everything is lit and everyone is cute again.
export function drawDawn(t) {
  rect(0, 0, W, H, vgrad(0, H, [[0, mix(P.peach, P.base, .45)], [.6, mix(P.yellow, P.base, .6)], [1, P.mantle]]));
  glow(W * .78, 60, 420, P.yellow, .35);
  c.save(); c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) poly([[W * .78, 40], [W * .78 + 40, 40], [140 + i * 190, H], [20 + i * 190, H]], vgrad(0, H, [[0, rgba(P.yellow, .08)], [1, rgba(P.yellow, .01)]]));   // light through the window
  c.restore();
  rect(0, 372, W, 78, vgrad(372, H, [[0, mix(P.peach, P.crust, .6)], [1, mix(P.peach, P.crust, .85)]]));
  MASC.forEach((d, i) => drawMascot(i, 110 + i * 193, 300, .5, { t, rot: 0 }));
  vignette(.35);
}

export function drawBackdrop(t) {
  rect(0, 0, W, H, vgrad(0, H, [[0, P.ink], [.8, P.crust], [1, P.ink]]));
  const sweep = W / 2 + Math.sin(t * .3) * 300;
  glow(sweep, 300, 190, P.overlay2, .16);
  MASC.forEach((d, i) => {
    const x = 110 + i * 193, lit = Math.abs(x - sweep) < 90;
    drawMascot(i, x, 300, .5, { t, dark: !lit, rot: 0 });   // always the costumes here: the title screen gives nothing away
  });
  rect(0, 330, W, 120, vgrad(330, H, [[0, rgba(P.overlay1, 0)], [1, rgba(P.overlay1, .16)]]));   // mist
  vignette(.9);
}
