// The security booth: a 1600-wide room you pan across.
// Everything that never moves is baked into one wide sprite (see roomSprite);
// each frame draws a slice of it and then the live parts on top.
import { W, H, WORLD, ZONES, P } from '../config.js';
import { atDoor, shownAtDoor, seenThreat, leanOf, rotOf, dreadOf, lightsOn, REVEAL, DOOR_HEAT, tripLeft } from '../rules.js';
import { c, mix, rgba, hash, lerp, ell, rect, rrect, poly, vgrad, glow, vignette, text, bake, pxScale } from './canvas.js';
import { drawMascot, drawFace } from './mascot.js';

const FLOOR_Y = 370;
const LAMPS = [470, 1130];          // world x of the ceiling lamps
// on: the booth lights are lit. powered: there is electricity at all.
// The lights can be off with the power still on, if a guard switched them off.
let S, pan, t, on, powered, dread;

// Lamp brightness, 0 to 1. Stutters when power is low.
function lampLevel() {
  if (!on) return 0;
  const hum = .9 + .1 * Math.sin(t * 13) * Math.sin(t * 7.3);
  if (hash(Math.floor(t * 2.5)) > 1 - dread * .03) return .04;                       // the lights cut out for a moment
  const dropChance = (S.power < 15 ? .3 : 0) + dread * .1;
  return hash(Math.floor(t * 12)) < dropChance ? hum * .35 : hum;
}

/* ---------- baked room ---------- */
// These draw in world coordinates across the full WORLD width.

function wall() {
  rect(0, 0, WORLD, FLOOR_Y, vgrad(0, FLOOR_Y, [[0, mix(P.base, P.mauve, .06)], [1, P.mantle]]));
  for (let x = 0; x < WORLD; x += 40) rect(x, 0, 14, 262, rgba(P.overlay0, .05));          // wallpaper stripes
  rect(0, 262, WORLD, 108, vgrad(262, FLOOR_Y, [[0, mix(P.surface0, P.crust, .5)], [1, P.crust]]));   // wainscot
  rect(0, 262, WORLD, 3, rgba(P.surface2, .6));
  c.strokeStyle = rgba(P.ink, .55); c.lineWidth = 2;
  for (let x = 0; x < WORLD; x += 100) c.strokeRect(x + 10, 276, 80, 74);
  rect(0, FLOOR_Y - 8, WORLD, 8, P.ink);
}

// Checkerboard with a cheap one-point perspective toward the middle of the room.
function floor() {
  const far = FLOOR_Y, mid = 398, near = H, spread = 1.2, mx = WORLD / 2;
  const bx = (x, y) => mx + (x - mx) * lerp(1, spread, (y - far) / (near - far));
  for (let k = -4; k < WORLD / 80 + 4; k++) {
    const x0 = k * 80, x1 = x0 + 80;
    [[far, mid], [mid, near]].forEach(([y0, y1], row) => {
      const dark = (k + row) % 2 === 0;
      poly([[bx(x0, y0), y0], [bx(x1, y0), y0], [bx(x1, y1), y1], [bx(x0, y1), y1]], dark ? mix(P.crust, P.surface0, .15) : mix(P.surface1, P.crust, .45));
    });
  }
  rect(0, far, WORLD, near - far, vgrad(far, near, [[0, rgba(P.ink, .55)], [1, rgba(P.ink, 0)]]));
}

function poster(wx, tilt, bg, mascotId, caption) {
  c.save(); c.translate(wx + 60, 196); c.rotate(tilt);
  rect(-63, -73, 126, 146, rgba(P.ink, .5));
  rect(-60, -76, 120, 146, bg);
  rect(-60, -76, 120, 146, vgrad(-76, 70, [[0, rgba(P.text, .1)], [1, rgba(P.ink, .35)]]));
  c.save(); c.beginPath(); c.rect(-60, -76, 120, 146); c.clip();
  glow(0, 0, 80, P.yellow, .18);
  drawMascot(mascotId, 0, 22, .3, { t: 0, rot: 0 });
  c.restore();
  text(caption, 0, -58, { size: 11, weight: 800, col: P.yellow, align: 'center' });
  c.lineWidth = 3; c.strokeStyle = P.crust; c.strokeRect(-60, -76, 120, 146);
  c.restore();
}

function furniture(lit) {
  const DX = 560, m = ZONES.monitor, k = ZONES.crank, wood = mix(P.peach, P.crust, .72);
  rrect(DX + 356, 176, 108, 50, 4, P.crust);                             // sign behind the desk
  text('SHIFTS SINCE', DX + 410, 193, { size: 8, weight: 700, col: P.subtext0, align: 'center' });
  text('LAST SQUISHING', DX + 410, 204, { size: 8, weight: 700, col: P.subtext0, align: 'center' });
  text('0', DX + 410, 222, { size: 16, weight: 800, col: P.red, align: 'center' });
  rect(m.x + m.w / 2 - 12, m.y + m.h - 4, 24, 14, P.crust);              // monitor
  rrect(m.x - 6, m.y - 6, m.w + 12, m.h + 6, 8, P.crust);
  rect(m.x, m.y, m.w, m.h - 10, lit ? mix(P.green, P.crust, .78) : P.ink);
  if (lit) {
    for (let y = m.y; y < m.y + m.h - 10; y += 3) rect(m.x, y, m.w, 1, rgba(P.ink, .3));
    text('CAMS', m.x + m.w / 2, m.y + 42, { size: 16, weight: 800, col: P.green, align: 'center' });
    glow(m.x + m.w / 2, m.y + 36, 150, P.green, .1);
  }
  rect(DX, 330, 480, 26, vgrad(330, 356, [[0, mix(wood, P.text, .12)], [1, wood]]));              // desk
  rect(DX + 20, 356, 440, 94, vgrad(356, 450, [[0, mix(wood, P.crust, .45)], [1, P.crust]]));
  c.strokeStyle = rgba(P.ink, .5); c.lineWidth = 2; c.strokeRect(DX + 40, 372, 180, 60); c.strokeRect(DX + 260, 372, 180, 60);
  ell(DX + 130, 400, 6, 6, P.overlay0); ell(DX + 350, 400, 6, 6, P.overlay0);
  rrect(DX + 62, 304, 26, 28, 4, P.mauve);                               // mug
  c.lineWidth = 4; c.strokeStyle = P.mauve; c.beginPath(); c.arc(DX + 90, 317, 7, -1.2, 1.2); c.stroke();
  rrect(k.x - 4, k.y - 4, k.w + 8, k.h + 8, 6, P.crust);                 // generator button
  rrect(k.x, k.y, k.w, k.h, 4, P.yellow);
  poly([[k.x + 31, k.y + 5], [k.x + 20, k.y + 22], [k.x + 28, k.y + 22], [k.x + 24, k.y + 35], [k.x + 37, k.y + 17], [k.x + 29, k.y + 17]], P.crust);
}

function lamps(lit) {
  for (const X of LAMPS) {
    rect(X - 1.5, 0, 3, 18, P.ink);
    poly([[X - 26, 34], [X - 14, 16], [X + 14, 16], [X + 26, 34]], P.surface0);
    ell(X, 35, 20, 5, lit ? P.yellow : P.crust);
    if (!lit) continue;
    const g = c.createLinearGradient(0, 34, 0, H);
    g.addColorStop(0, rgba(P.yellow, .13)); g.addColorStop(1, rgba(P.yellow, 0));
    c.save(); c.globalCompositeOperation = 'lighter';
    poly([[X - 22, 34], [X + 22, 34], [X + 260, H], [X - 260, H]], g);
    c.restore();
    glow(X, 60, 360, P.yellow, .13);
  }
}

// One sprite per lighting state, rebuilt if the canvas resolution changes.
// lit: lamps on. live: the monitor and other powered things are on.
const rooms = {};
function roomSprite(lit, live) {
  const res = pxScale(), key = `${lit}|${live}`, hit = rooms[key];
  if (hit && hit.res === res) return hit.sprite;
  const sprite = bake(WORLD, H, res, () => {
    wall(); floor();
    poster(360, -.03, mix(P.mauve, P.crust, .55), 0, 'BIGGS LAND');
    poster(1120, .04, mix(P.red, P.crust, .6), 1, 'EST. 1987');
    furniture(live); lamps(lit);
  });
  rooms[key] = { res, sprite };
  return sprite;
}

/* ---------- live parts ---------- */

// The plate under each way in: its state in words, and how hot its motor is
// (S.heat, see DOOR_HEAT in rules.js). The bar is the gauge to play by: green
// is fine, yellow is getting there, red is about to trip. The dot blinks for
// the last fifth before a trip. A tripped door counts down the seconds to its
// reset, and the tick on the bar is the heat it has to cool to.
function statusPlate(cx, y, label, k) {
  const shut = S.doors[k], heat = S.heat?.[k] || 0, tripped = !!S.trip?.[k], hot = heat > .8;
  const col = shut || tripped ? P.red : P.green, str = `${label}: ${tripped ? `TRIPPED ${Math.ceil(tripLeft(S, k))}s` : shut ? 'shut' : 'open'}`;
  c.font = '600 12px Inter, system-ui, sans-serif';
  const w = c.measureText(tripped ? `${label}: TRIPPED 00s` : str).width + 34, x = cx - w / 2;   // the countdown must not make the plate twitch
  rrect(x, y - 14, w, 30, 6, rgba(P.ink, .8));
  const lit = !(tripped || shut && hot) || Math.sin(t * 14) > 0;
  ell(x + 13, y - 3, 4.5, 4.5, lit ? col : mix(col, P.ink, .7));
  if (powered && lit) glow(x + 13, y - 3, 16, col, .5);
  text(str, x + 24, y + 1, { col: tripped ? P.red : P.text });
  rrect(x + 10, y + 7, w - 20, 4, 2, P.surface0);
  if (heat > 0) rrect(x + 10, y + 7, Math.max(4, (w - 20) * heat), 4, 2, tripped || hot ? P.red : heat >= .5 ? P.yellow : P.green);
  if (tripped) rect(x + 10 + (w - 20) * DOOR_HEAT.reset, y + 5, 1.5, 8, P.text);
}

// A door frame's colour: the plain frame cold, through peach, to red at the
// point of tripping. mix() caches by its arguments, so heat is rounded first.
function frameCol(k) {
  const plain = mix(P.surface0, P.crust, .35), heat = Math.round((S.heat?.[k] || 0) * 20) / 20;
  return heat <= .5 ? mix(plain, P.peach, heat * .9) : mix(mix(plain, P.peach, .45), P.red, (heat - .5) * 1.4);
}

// For two seconds after a breaker trips, sparks fall from the top of the
// frame. S.heat is the clock (it trips at 1 and has cooled to .95 two seconds
// later), so every guard sees them and nothing is kept on the client.
function tripSparks(k, X, y, w) {
  if (!S.trip?.[k] || S.heat[k] <= .95) return;
  const fade = (S.heat[k] - .95) / .05;
  for (let i = 0; i < 18; i++) {
    const life = (t * 2.2 + hash(i) * 3) % 1, sx = X + (i % 2 ? w : 0) + (hash(i + 20) - .5) * 70 * life;
    ell(sx, y + life * life * 110, 2.4 * (1 - life), 2.4 * (1 - life), rgba(i % 3 ? P.yellow : P.peach, (1 - life) * fade));
  }
  glow(X, y, 90, P.yellow, .3 * fade); glow(X + w, y, 90, P.yellow, .3 * fade);
}

function slab(X, y, w, h) {
  rect(X, y, w, h, vgrad(y, y + h, [[0, P.surface1], [1, mix(P.surface0, P.crust, .3)]]));
  for (let ry = y + h - 34; ry > y; ry -= 34) { rect(X, ry, w, 5, rgba(P.ink, .4)); rect(X, ry + 5, w, 1.5, rgba(P.surface2, .5)); }
  c.save(); c.beginPath(); c.rect(X, y + h - 18, w, 18); c.clip();
  rect(X, y + h - 18, w, 18, P.yellow);
  for (let i = -1; i < 9; i++) poly([[X + i * 28, y + h], [X + i * 28 + 14, y + h], [X + i * 28 + 30, y + h - 18], [X + i * 28 + 16, y + h - 18]], P.crust);
  c.restore();
}

// Where a mascot stands in a doorway. It grows as it leans in; its feet stay put.
function standing(m, cx, j) {
  const lean = leanOf(S, m), s = .62 + lean * .2;
  return { lean, s, x: cx + j * 40 + Math.sin(t * .4 + m.i) * 3, y: 366 - 150 * s };
}

// Now and then, two points of light at the far end of an empty corridor.
function farEyes(cx, cy, k) {
  const slot = Math.floor(t / 4), seed = slot * 7 + k.charCodeAt(0);
  if (hash(seed) < .78 || (t / 4) % 1 > .35) return;
  const x = cx + (hash(seed + 1) - .5) * 90, y = cy + (hash(seed + 2) - .5) * 60;
  ell(x - 4, y, 1.3, 1.3, rgba(P.text, .7)); ell(x + 4, y, 1.3, 1.3, rgba(P.text, .7));
}

// For a few frames, a poster shows something else.
const wrongPosters = {};
function posterGlitch(wx, tilt, id) {
  const slot = Math.floor(t * 1.5);
  if (hash(slot * 3 + id) < 1 - dread * .07) return;
  wrongPosters[id] ||= bake(120, 146, 2, () => {
    rect(0, 0, 120, 146, P.ink);
    drawFace(id, 60, id ? 80 : 66, id ? 1.9 : 1.05, { t: 3 });
    rect(0, 0, 120, 146, vgrad(0, 146, [[0, rgba(P.ink, .2)], [1, rgba(P.ink, .7)]]));
    text('IT IS IN THE BOOTH', 60, 136, { size: 8, weight: 800, col: P.red, align: 'center' });
  });
  c.save(); c.translate(wx - pan + 60, 196); c.rotate(tilt); c.drawImage(wrongPosters[id], -60, -76, 120, 146); c.restore();
}

// Fingers hooked around the door frame. More of them as it leans in.
function grip(X, z, lean) {
  c.strokeStyle = P.ink; c.lineWidth = 4; c.lineCap = 'round'; c.beginPath();
  for (const [side, y0] of [[0, 150], [1, 120], [0, 250], [1, 230]].slice(0, 2 + Math.round(lean * 2))) {
    const ex = side ? X + z.w : X, dir = side ? 1 : -1;
    for (let f = 0; f < 4; f++) { const y = y0 + f * 9 + Math.sin(t * 2 + f + y0) * 1.5; c.moveTo(ex - dir * 4, y); c.lineTo(ex + dir * 9, y - 2); c.lineTo(ex + dir * (13 + f % 2 * 3), y + 7); }
  }
  c.stroke();
  if (!on) return;
  c.fillStyle = rgba(mix(P.red, P.ink, .55), .8);                       // what its hands leave on the frame
  for (const [side, y0] of [[0, 150], [1, 120]]) {
    const ex = (side ? X + z.w : X) + (side ? 2 : -9);
    for (let f = 0; f < 4; f++) c.fillRect(ex + f * 2.2, y0 + f * 9, 2, 26 + hash(f + y0) * 44 * (.4 + lean));
  }
}

function doorway(k, label, doorPos) {
  const z = ZONES[k], X = z.x - pan;
  if (X < -260 || X > W + 60) return;
  // With the power out there is no dark for it to hang back in: you see its eyes at once.
  const here = powered ? shownAtDoor(S, k) : atDoor(S, k);
  rect(X, z.y, z.w, z.h, vgrad(z.y, z.y + z.h, [[0, P.ink], [1, mix(P.crust, P.blue, .08)]]));
  c.save(); c.beginPath(); c.rect(X, z.y, z.w, z.h); c.clip();
  if (on) rect(X, z.y + z.h * .55, z.w, z.h * .45, vgrad(z.y + z.h * .55, z.y + z.h, [[0, rgba(P.overlay1, 0)], [1, rgba(P.overlay1, dread * .2)]]));   // floor mist
  if (!here.length && on && dread > .3) farEyes(X + z.w / 2, z.y + 150, k);
  let lean = 0;
  here.forEach((m, j) => { const p = standing(m, X + z.w / 2, j); lean = Math.max(lean, p.lean); drawMascot(m.i, p.x, p.y, p.s, { t, dark: !on, rot: rotOf(S, m) }); });
  // It starts as a shape in the dark and comes into the light as it runs out of patience.
  if (here.length && powered) rect(X, z.y, z.w, z.h, rgba(P.ink, .96 * Math.max(0, 1 - (lean - REVEAL) / .08)));   // it steps out of the dark over a moment, not a frame
  if (here.length && on) { const a = (.35 + dread * .65) * (1 - lean * .75); rect(X, z.y, z.w, z.h, vgrad(z.y, z.y + z.h, [[0, rgba(P.ink, .82 * a)], [.5, rgba(P.ink, .6 * a)], [1, rgba(P.ink, .78 * a)]])); }
  if (doorPos > .01) slab(X, z.y - z.h * (1 - doorPos), z.w, z.h);
  c.restore();
  c.lineWidth = 14; c.strokeStyle = frameCol(k); c.strokeRect(X, z.y, z.w, z.h);
  c.lineWidth = 1.5; c.strokeStyle = rgba(P.surface2, .7); c.strokeRect(X - 7, z.y - 7, z.w + 14, z.h + 14);
  if (here.some(m => rotOf(S, m) === 2) && doorPos < .5) grip(X, z, lean);
  tripSparks(k, X, z.y, z.w);
  statusPlate(X + z.w / 2, z.y + z.h + 30, label, k);
}

// Eyes only, redrawn over the blackout so they still glow.
function doorwayEyes(k) {
  const z = ZONES[k], X = z.x - pan;
  c.save(); c.beginPath(); c.rect(X, z.y, z.w, z.h); c.clip();
  (powered ? shownAtDoor(S, k) : atDoor(S, k)).forEach((m, j) => { const p = standing(m, X + z.w / 2, j); drawMascot(m.i, p.x, p.y, p.s, { t, dark: true, rot: rotOf(S, m) }); });
  c.restore();
}

function ventEyes(X, y) {
  const big = [[70, 46, 10], [128, 46, 10]], small = [[40, 62, 4], [98, 26, 5], [158, 60, 4], [104, 70, 3.5], [24, 30, 3]];
  for (const [x, ey, r] of big) { glow(X + x, y + ey, r * 3, P.yellow, .7); ell(X + x, y + ey, r, r, P.yellow); ell(X + x, y + ey, 1.8, r * .8, P.ink); }
  small.forEach(([x, ey, r], i) => {
    if ((t * .6 + hash(i) * 5) % 4 < .2) return;
    glow(X + x, y + ey, r * 3.5, P.red, .7); ell(X + x, y + ey, r, r, P.red); ell(X + x, y + ey, r * .35, r * .35, P.ink);
  });
}

function vent(doorPos, eyesOnly) {
  const z = ZONES.V, X = z.x - pan, lurking = (powered ? shownAtDoor(S, 'V') : atDoor(S, 'V')).length > 0;
  if (eyesOnly) { if (lurking) ventEyes(X, z.y); return; }
  rect(X, z.y, z.w, z.h, P.ink);
  if (lurking && !S.doors.V) {
    ventEyes(X, z.y);
    const finger = mix(P.green, P.crust, .5);
    c.strokeStyle = finger; c.lineWidth = 6; c.lineCap = 'round';
    for (const fx of [34, 48, 62, 146, 160, 174]) {
      const curl = Math.sin(t * 1.4 + fx) * 3;
      c.beginPath(); c.moveTo(X + fx, z.y + z.h); c.quadraticCurveTo(X + fx + curl, z.y + z.h - 26, X + fx + curl * 2, z.y + z.h - 12 + curl); c.stroke();
    }
  }
  c.save(); c.beginPath(); c.rect(X, z.y, z.w, z.h); c.clip();
  if (doorPos > .01) rect(X - z.w * (1 - doorPos), z.y, z.w, z.h, vgrad(z.y, z.y + z.h, [[0, P.surface1], [1, P.surface0]]));
  c.strokeStyle = rgba(P.surface1, .9); c.lineWidth = 3;
  for (let y = z.y + 12; y < z.y + z.h; y += 13) { c.beginPath(); c.moveTo(X, y); c.lineTo(X + z.w, y); c.stroke(); }
  c.restore();
  c.lineWidth = 10; c.strokeStyle = frameCol('V'); c.strokeRect(X, z.y, z.w, z.h);
  for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) ell(X + sx * z.w, z.y + sy * z.h, 2.5, 2.5, P.overlay1);
  tripSparks('V', X, z.y + z.h, z.w);
  statusPlate(X + z.w / 2, z.y + z.h + 24, 'Vent', 'V');
}

// The bits of the desk that move: the monitor's scan bar and the mug's steam.
function deskLive() {
  const m = ZONES.monitor, MX = m.x - pan, DX = 560 - pan;
  if (powered) rect(MX, m.y + ((t * 30) % (m.h - 14)), m.w, 4, rgba(P.green, .18));
  c.strokeStyle = rgba(P.text, .18); c.lineWidth = 2;
  for (let i = 0; i < 2; i++) { const sx = DX + 70 + i * 10, w = Math.sin(t * 1.5 + i * 2) * 4; c.beginPath(); c.moveTo(sx, 300); c.bezierCurveTo(sx + w, 290, sx - w, 282, sx + w, 270); c.stroke(); }
}

function dust(level) {
  if (level <= 0) return;
  c.save(); c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 46; i++) {
    const wx = (hash(i) * 1600 + t * (4 + hash(i + 9) * 8)) % 1600, y = (hash(i + 3) * 400 + t * (3 + hash(i + 5) * 5)) % 380;
    ell(wx - pan, y, 1.2, 1.2, rgba(P.yellow, .1 + hash(i + 1) * .22 * level));
  }
  c.restore();
}

// door: animated door positions from the client, 0 open to 1 shut.
export function drawOffice(state, panX, door, time) {
  S = state; pan = panX; t = time; powered = S.power > 0; on = lightsOn(S); dread = dreadOf(S);
  const level = lampLevel(), res = pxScale();
  c.drawImage(roomSprite(on, powered), pan * res, 0, W * res, H * res, 0, 0, W, H);
  doorway('L', 'Left door', door.L); doorway('R', 'Right door', door.R);
  posterGlitch(360, -.03, 0); posterGlitch(1120, .04, 1);
  vent(door.V); deskLive(); dust(level);
  if (on) {
    rect(0, 0, W, H, rgba(P.ink, dread * .26 + (1 - level) * .7));   // gloom, and the lamp flicker
    vignette(.6 + dread * .35);
    // Something is in an open doorway you can see: the edges of your vision go red in time with your pulse.
    const threat = seenThreat(S, pan);
    if (threat > 0) { const beat = Math.pow(Math.max(0, Math.sin(t * (4 + threat * 5))), 6); glow(0, H / 2, 300, P.red, threat * .16 * (.4 + beat)); glow(W, H / 2, 300, P.red, threat * .16 * (.4 + beat)); }
  } else {
    // Lights switched off is dark. Power out is darker, with the emergency light.
    rect(0, 0, W, H, rgba(P.ink, powered ? .84 : .93));
    if (!powered) glow(W / 2, 0, 420, P.red, .06 + .05 * Math.sin(t * 3));
    doorwayEyes('L'); doorwayEyes('R'); vent(0, true);
  }
}
