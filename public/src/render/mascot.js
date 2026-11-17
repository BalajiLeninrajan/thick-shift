// Mascot art, in three stages of rot (opts.rot):
//   0  the costume as built: bright, round, friendly
//   1  off: dull fur, too many teeth, things starting to hang out of it
//   2  shaggy, starved and too tall, with too many limbs
// The rear is drawn by rear(); its size is the one knob people keep asking about.
// Local space: feet at y = 150, hips around y = 60, heads between -60 and -200.
import { MASC, P } from '../config.js';
import { c, TAU, mix, rgba, hash, lerp, bake, glow } from './canvas.js';

const PALE = mix(P.text, P.rosewater, .5), BONE = mix(P.rosewater, P.yellow, .35);
const BLOOD = mix(P.red, P.ink, .58), WET = mix(P.red, P.ink, .3), GUT = mix(P.red, P.ink, .42);
let o;   // options of the mascot being drawn

/* ---------- primitives ---------- */

// Outlines are a darker shape underneath, not a stroke: stroking curves every
// frame is the slowest thing a 2D canvas does. Strokes are fine inside bake().
const EDGE = 1.3;

function blob(x, y, rx, ry, col, rot = 0) {
  c.save(); c.translate(x, y); c.rotate(rot);
  if (o.dark) { c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, TAU); c.fillStyle = P.ink; c.fill(); c.restore(); return; }
  c.beginPath(); c.ellipse(0, 0, rx + EDGE, ry + EDGE, 0, 0, TAU); c.fillStyle = P.ink; c.fill();
  const g = c.createRadialGradient(-rx * .4, -ry * .5, Math.min(rx, ry) * .1, 0, 0, Math.max(rx, ry) * 1.05);
  g.addColorStop(0, mix(col, P.overlay2, .45)); g.addColorStop(.5, col); g.addColorStop(1, mix(col, P.ink, .75));
  c.beginPath(); c.ellipse(0, 0, Math.max(.5, rx - EDGE), Math.max(.5, ry - EDGE), 0, 0, TAU); c.fillStyle = g; c.fill();
  c.restore();
}
function oval(x, y, rx, ry, fill, rot = 0) { c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, TAU); c.fillStyle = fill; c.fill(); }
function shape(fill, pts) {
  c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); c.fillStyle = fill; c.fill();
}
// Straight line segments, all in one stroke call. segs: [[x0, y0, x1, y1], ...]
function lines(col, w, segs) {
  c.beginPath(); for (const [x0, y0, x1, y1] of segs) { c.moveTo(x0, y0); c.lineTo(x1, y1); }
  c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.stroke();
}
// A tapered limb through the given joints, as filled quads.
function limb(pts, w0, w1, col) {
  const n = pts.length - 1;
  c.fillStyle = o.dark ? P.ink : col;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], a = lerp(w0, w1, i / n) / 2, b = lerp(w0, w1, (i + 1) / n) / 2;
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    c.beginPath(); c.moveTo(x0 + nx * a, y0 + ny * a); c.lineTo(x1 + nx * b, y1 + ny * b); c.lineTo(x1 - nx * b, y1 - ny * b); c.lineTo(x0 - nx * a, y0 - ny * a); c.fill();
    c.beginPath(); c.arc(x1, y1, b, 0, TAU); c.fill();
  }
}
function hand(x, y, sx, col, len = 46) {
  for (let f = 0; f < 4; f++) limb([[x, y], [x + sx * (f * 7 - 12), y + len * .55], [x + sx * (f * 6 - 6), y + len - f * 4]], 4, 1.5, col);
}
// Ink hatching inside an ellipse: short diagonal marks, denser toward the lower right.
function hatch(x, y, rx, ry, n, seed, col = rgba(P.ink, .5)) {
  if (o.dark) return;
  const segs = [];
  for (let i = 0; i < n; i++) {
    const a = hash(seed + i) * TAU, r = Math.sqrt(hash(seed + i + .5)), px = x + Math.cos(a) * rx * r, py = y + Math.sin(a) * ry * r;
    if (hash(seed + i + .25) > .35 + (px - x) / rx * .4 + (py - y) / ry * .3) continue;
    const len = 4 + hash(seed + i + .75) * 9;
    segs.push([px, py, px + len * .7, py + len]);
  }
  lines(col, .8, segs);
}
// Twitchy gaze: mostly locked on you, sometimes somewhere else.
function stare(seed) {
  const beat = Math.floor(o.t * 1.3 + seed * 9);
  return hash(beat + seed * 31) > .82 ? [hash(beat) * 2 - 1, hash(beat + 7) * 2 - 1] : [0, 0];
}

/* ---------- faces ---------- */

// A small pale mask: hollow sockets, a pinprick of light in each, a thin mouth.
// It stays faintly visible in the dark, which is the point.
function maskFace(x, y, r, seed = 1) {
  const scream = o.scare, [lx, ly] = stare(seed);
  c.save(); c.translate(x, y);
  oval(0, 0, r * .8 + 1.2, r + 1.2, P.ink);
  const g = c.createRadialGradient(-r * .2, -r * .4, r * .1, 0, 0, r * 1.1);
  g.addColorStop(0, PALE); g.addColorStop(1, mix(PALE, P.surface1, .6));
  c.globalAlpha = o.dark ? .5 : 1; oval(0, 0, r * .8, r, g); c.globalAlpha = 1;
  const sw = r * (scream ? .27 : .2), sh = r * (scream ? .36 : .25);
  for (const sx of [-1, 1]) {
    oval(sx * r * .32, -r * .18, sw, sh, P.ink, sx * .2);
    c.fillStyle = P.ink; c.fillRect(sx * r * .32 - r * .035, -r * .1, r * .07, r * (.7 + hash(seed + sx) * .5));   // tear track
    oval(sx * r * .32 + lx * sw * .4, -r * .18 + ly * sh * .4, r * .05, r * .05, PALE);
  }
  if (scream) oval(0, r * .5, r * .24, r * .44, P.ink);
  else { c.beginPath(); c.moveTo(-r * .34, r * .42); c.quadraticCurveTo(0, r * .78, r * .34, r * .42); c.quadraticCurveTo(0, r * .58, -r * .34, r * .42); c.fillStyle = P.ink; c.fill(); }
  c.restore();
}

// The eyes the costume came with. They wander separately and never blink.
function googly(x, y, r, seed) {
  const a = o.t * (.3 + hash(seed) * .3) + seed * 2, px = x + Math.cos(a) * r * .4, py = y + Math.abs(Math.sin(a * .7)) * r * .45;
  oval(x, y, r + 1.4, r + 1.4, P.ink);
  oval(x, y, r, r, o.dark ? rgba(PALE, .6) : P.rosewater);
  oval(px, py, r * (o.scare ? .22 : .42), r * (o.scare ? .22 : .42), P.ink);
  if (!o.dark) oval(px - r * .14, py - r * .16, r * .1, r * .1, P.rosewater);
}

// Stage 2 eyes: a black ball sunk in its socket with one pale point for a
// pupil, fixed on you. In the dark only the point shows.
function deadEye(x, y, r, seed) {
  const [lx, ly] = stare(seed), px = x + lx * r * .35, py = y + r * .1 + ly * r * .25;
  if (o.dark) { glow(x, y, r * 2.2, PALE, .35); oval(px, py, r * .34, r * .34, PALE); return; }
  const open = o.scare ? 1.25 : 1;
  oval(x, y, r * 2.1, r * 1.9, rgba(P.ink, .55));                      // socket
  oval(x, y, r * 1.22 * open, r * 1.08 * open, mix(P.red, P.ink, .5));   // raw rim
  oval(x, y, r * open, r * .86 * open, P.ink);
  glow(px, py, r * 1.1, PALE, .3);
  oval(px, py, r * (o.scare ? .14 : .26), r * (o.scare ? .14 : .26), PALE);
}

// Black strands hanging from a line, swaying. They show in every silhouette too.
function strands(x0, x1, y, n, len, seed, col = P.ink) {
  const segs = [];
  for (let i = 0; i < n; i++) {
    const x = lerp(x0, x1, (i + hash(seed + i)) / n), l = len * (.35 + hash(seed + i + .5) * .65), sway = Math.sin(o.t * .7 + i + seed) * 4;
    segs.push([x, y, x + sway * .5, y + l * .5], [x + sway * .5, y + l * .5, x + sway, y + l]);
  }
  lines(o.dark ? P.ink : col, 2.2, segs);
}

// A row of flat human teeth; the gaps between them do the outlining.
function teeth(x0, x1, y, h, n) {
  const w = (x1 - x0) / n;
  c.beginPath();
  for (let i = 0; i < n; i++) c.roundRect(x0 + i * w + .8, y, w - 1.6, h * (.8 + hash(i + n) * .35), [0, 0, 2.5, 2.5]);
  c.fillStyle = o.dark ? rgba(BONE, .35) : BONE; c.fill();
  if (o.rot < 2 || o.dark) return;
  c.beginPath();                                                        // it has been eating
  for (let i = 0; i < n; i++) if (hash(i * 3 + n) > .35) c.rect(x0 + i * w + .8, y + h * (.3 + hash(i) * .3), w - 1.6, h);
  c.fillStyle = rgba(WET, .8); c.fill();
}

/* ---------- bodies ---------- */
// Drawn once per mascot/pose/lighting into a sprite, so curves and strokes are fine here.

// Costume fur: the mascot's colour, duller with each stage.
const furCol = d => mix(d.col, P.surface0, [.02, .2, .32][o.rot]);

// The one part nobody slimmed down. HIPS is the knob: [width, height] scale
// about the hip line. Wider than tall, so it reads as a shelf, not a balloon.
const HIPS = [1.6, 1.38], HIP_Y = 74;
function rear(B, back) {
  c.save(); c.translate(0, HIP_Y); c.scale(HIPS[0], HIPS[1]); c.translate(0, -HIP_Y);
  if (!back) { blob(-24, 72, 24, 25, B); blob(24, 72, 24, 25, B); blob(0, 64, 36, 30, B); c.restore(); return; }
  blob(-20, 76, 26, 28, B); blob(20, 76, 26, 28, B);
  if (!o.dark) {
    c.beginPath(); c.moveTo(0, 50); c.quadraticCurveTo(-2, 80, 0, 104); c.strokeStyle = P.ink; c.lineWidth = 2; c.stroke();
    for (const sx of [-1, 1]) {
      c.beginPath(); c.arc(sx * 20, 76, 20, sx > 0 ? Math.PI - 2.2 : .5, sx > 0 ? Math.PI - .5 : 2.2); c.strokeStyle = rgba(P.ink, .45); c.lineWidth = 2; c.stroke();
      c.beginPath(); c.arc(sx * 21, 78, 23, sx > 0 ? .5 : Math.PI - 1.5, sx > 0 ? 1.5 : Math.PI - .5); c.strokeStyle = rgba(P.ink, .55); c.lineWidth = 1.8; c.stroke();   // the fold underneath
    }
  }
  c.restore();
}
function legs(B, kneeX = 60, kneeY = 118) {
  for (const sx of [-1, 1]) { limb([[sx * 36, 86], [sx * kneeX, kneeY], [sx * 44, 148]], 30, 10, B); blob(sx * 52, 151, 22, 7, B); }
}
function arms(B, elbow = [72, -18], wrist = [90, 72]) {
  for (const sx of [-1, 1]) { limb([[sx * 30, -92], [sx * elbow[0], elbow[1]], [sx * wrist[0], wrist[1]]], 14, 7, B); hand(sx * wrist[0], wrist[1], sx, B); }
}
function ribcage(B, back) {
  blob(0, -34, 38, 72, B);
  if (o.dark) return;
  c.strokeStyle = rgba(P.ink, .5); c.lineWidth = 1.6;
  if (back) for (let i = 0; i < 9; i++) oval(0, -92 + i * 13, 5, 4, mix(B, P.overlay2, .35));   // spine
  else for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) { c.beginPath(); c.moveTo(sx * 3, -78 + i * 13); c.quadraticCurveTo(sx * 22, -74 + i * 13, sx * 32, -64 + i * 13); c.stroke(); }
}
// Shag: a few thousand short strokes that follow gravity, light over dark.
function fur(B) {
  if (o.dark) return;
  c.save(); c.globalCompositeOperation = 'source-atop';
  const g = c.createLinearGradient(-200, -120, 200, 170);
  g.addColorStop(0, rgba(P.ink, 0)); g.addColorStop(1, rgba(P.ink, .55));
  c.fillStyle = g; c.fillRect(-220, -130, 440, 300);
  for (const [n, seed, col, w] of [[1500, 11, rgba(P.ink, .4), 1.3], [1100, 53, rgba(mix(B, P.yellow, .35), .5), 1.1]]) {
    const segs = [];
    for (let i = 0; i < n; i++) {
      const x = hash(seed + i) * 440 - 220, y = hash(seed + i + .5) * 300 - 130, len = 6 + hash(seed + i + .25) * 12;
      segs.push([x, y, x + (hash(seed + i + .75) - .5) * 5 + x * .012, y + len]);
    }
    lines(col, w, segs);
  }
  c.restore();
}

/* ---------- gore ---------- */
// Baked into the stage 1 and 2 body sprites, over the fur.

// Soaked-in blood: blotches and runs that stay inside the body's outline.
function stain(x, y, r, seed) {
  c.save(); c.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 18; i++) {
    const bx = x + (hash(seed + i) - .5) * r * 1.8, by = y + (hash(seed + i + .5) - .5) * r * 1.6, br = r * (.12 + hash(seed + i + .25) * .38);
    oval(bx, by, br, br * .9, rgba(i % 3 ? BLOOD : WET, .8));
    if (i % 2) { c.fillStyle = rgba(BLOOD, .75); c.fillRect(bx - 1.2, by, 2.4, 14 + hash(seed + i + .75) * 46); }
  }
  c.restore();
}

// A torn-open chest: dark meat, ribs showing.
function wound(x, y, w, h) {
  const edge = [];
  for (let i = 0; i < 16; i++) { const a = i / 16 * TAU, r = 1 + (i % 2 ? .16 : -.08) + hash(i + x) * .14; edge.push([x + Math.cos(a) * w * r, y + Math.sin(a) * h * r]); }
  shape(P.ink, edge.map(([px, py]) => [x + (px - x) * 1.12, y + (py - y) * 1.08]));
  shape(mix(P.red, P.ink, .72), edge);
  c.save(); c.clip();
  c.strokeStyle = BONE; c.lineWidth = 3.5; c.lineCap = 'round';
  for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(x - w, y - h * .7 + i * h * .34); c.quadraticCurveTo(x, y - h * .5 + i * h * .34, x + w, y - h * .7 + i * h * .34); c.stroke(); }
  c.restore();
}

// Loops of intestine hanging from (x, y) to about (x, y + drop).
function guts(x, y, drop, seed) {
  const loops = [];
  for (let i = 0; i < 4; i++) {
    const sx = i % 2 ? 1 : -1, d = drop * (.5 + hash(seed + i) * .5), wdt = 14 + hash(seed + i + .5) * 18;
    loops.push([x + sx * i * 3, y, x + sx * wdt * 1.6, y + d * .35, x + sx * wdt, y + d, x - sx * 4, y + d * .82, x - sx * wdt * .7, y + d * .5, x + sx * 3, y + d * .3]);
  }
  for (const [col, w] of [[P.ink, 11], [GUT, 8], [rgba(P.rosewater, .28), 2.2]]) {
    c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath();
    for (const [x0, y0, c1x, c1y, x1, y1, c2x, c2y, x2, y2, x3, y3] of loops) { c.moveTo(x0, y0); c.quadraticCurveTo(c1x, c1y, x1, y1); c.quadraticCurveTo(c2x, c2y, x2, y2); c.lineTo(x3, y3); }
    c.stroke();
  }
}

// What each mascot has all over it at stage 2. Stage 1 gets only the first hints.
const GORE = {
  hippo(back) {
    if (o.rot < 2) return stain(0, -70, 22, 1);
    stain(-78, 100, 26, 2); stain(78, 100, 26, 3); stain(0, -60, 34, 4);
    if (back) return;
    wound(0, -22, 20, 44); guts(0, 14, 128, 6);
  },
  walrus(back) {
    if (o.rot < 2) return stain(0, -100, 16, 7);
    stain(-34, 30, 40, 8); stain(34, 30, 40, 9); stain(0, -90, 26, 10);   // a soaked hem
  },
  toad(back) {
    if (o.rot < 2) return stain(0, 40, 20, 12);
    stain(0, 58, 15, 15);   // just where it joins, so the rear still reads
  },
  rhino(back) {
    if (o.rot < 2) return stain(0, -60, 20, 17);
    stain(-34, 112, 24, 18); stain(34, 112, 24, 19); stain(0, -50, 30, 20);
    if (!back) wound(0, -8, 27, 40);   // where the worm comes out
  },
};

// Stage 0: an ordinary mascot costume from the waist up.
function costume(d, back) {
  const B = furCol(d);
  if (!back) rear(B, false);
  for (const sx of [-1, 1]) { limb([[sx * 36, 90], [sx * 42, 146]], 34, 20, B); blob(sx * 44, 151, 24, 8, B); }
  blob(0, -30, 46, 62, B);
  if (!back) blob(0, -18, 30, 44, d.belly);
  for (const sx of [-1, 1]) { limb([[sx * 38, -70], [sx * 66, 4]], 20, 15, B); blob(sx * 68, 10, 13, 12, B); }
  if (back) rear(B, true);
}

const BODY = {
  // Big Biggs: hunched, arms to the floor.
  hippo(d, back) { const B = furCol(d); rear(B, back); legs(B); if (back) ribcage(B, back); arms(B, [84, -6], [78, 96]); if (!back) ribcage(B, back); },
  // Madame Flan: a tall drape with nothing visible under it.
  walrus(d, back) {
    const B = furCol(d);
    rear(B, back); legs(B, 46, 120);
    const cloak = [[-22, -128], [22, -128], [44, -30], [58, 44], [44, 36], [30, 58], [14, 40], [0, 64], [-14, 40], [-30, 58], [-44, 36], [-58, 44], [-44, -30]];
    shape(P.ink, cloak.map(([x, y]) => [x * 1.05, y + 2])); shape(o.dark ? P.ink : mix(B, P.surface1, .2), cloak);
    if (!o.dark) for (let i = -3; i <= 3; i++) lines(rgba(P.ink, .5), 1.4, [[i * 6, -120, i * 15, 34]]);
    if (back) rear(B, true);
  },
  // Squish: almost no body. At stage 2, no body: a severed head, its torn
  // neck, and the rear, which came with it.
  toad(d, back) {
    const B = furCol(d);
    if (o.rot === 2) {
      const tear = [[-72, 14], [72, 14]];
      for (let i = 0; i <= 12; i++) tear.push([72 - i * 12, i % 2 ? 52 + hash(i) * 34 : 34 + hash(i + 9) * 10]);
      shape(P.ink, tear.map(([x, y]) => [x * 1.04, y + 3])); shape(o.dark ? P.ink : mix(P.red, P.ink, .68), tear);
      return rear(B, back);
    }
    rear(B, back);
    for (const sx of [-1, 1]) { limb([[sx * 40, 96], [sx * 104, 104], [sx * 84, 148]], 16, 8, B); blob(sx * 92, 151, 24, 7, B); }
    for (const sx of [-1, 1]) { limb([[sx * 60, -30], [sx * 128, 20], [sx * 120, 96]], 11, 6, B); hand(sx * 120, 96, sx, B, 52); }
  },
  // Tank: starved and folded up, knees by its ears. At stage 2 it stands,
  // slack, because something else is holding it up (see WORM below).
  rhino(d, back) {
    const B = furCol(d);
    if (o.rot === 2) { rear(B, back); legs(B, 50, 118); if (back) ribcage(B, back); arms(B, [52, -10], [62, 84]); if (!back) ribcage(B, back); return; }
    rear(B, back);
    for (const sx of [-1, 1]) { limb([[sx * 30, 80], [sx * 104, -40], [sx * 76, 148]], 18, 9, B); blob(sx * 84, 151, 24, 7, B); }
    if (back) ribcage(B, back);
    arms(B, [60, 10], [34, 110]);
    if (!back) ribcage(B, back);
  },
};

const BOX = { x: -220, y: -130, w: 440, h: 300 }, RES = 2.5, FEET_Y = 150;
const sprites = new Map();
function drawBody(i, back) {
  const key = `${i}|${back}|${o.dark}|${o.rot}`;
  let sprite = sprites.get(key);
  if (!sprite) {
    sprite = bake(BOX.w, BOX.h, RES, () => { c.translate(-BOX.x, -BOX.y); (o.rot ? BODY[MASC[i].k] : costume)(MASC[i], back); if (o.rot) fur(furCol(MASC[i])); if (o.rot && !o.dark) GORE[MASC[i].k](back); });
    sprites.set(key, sprite);
  }
  c.save(); c.translate(0, FEET_Y); c.scale(1 + o.breath * .006, 1 - o.breath * .01); c.translate(0, -FEET_Y);   // breathing
  c.drawImage(sprite, BOX.x, BOX.y, BOX.w, BOX.h);
  c.restore();
}

/* ---------- heads ---------- */
// Drawn live around (0, 0) so they can twitch. None of them turn with the body.

// A friendly mouth. Toothy when the costume has started to go.
function smile(w, y, toothy) {
  const depth = toothy ? w * .55 : w * .3;
  c.beginPath(); c.moveTo(-w, y); c.quadraticCurveTo(0, y + (toothy ? w * .16 : depth * .7), w, y); c.quadraticCurveTo(0, y + depth * 1.5, -w, y);
  c.fillStyle = P.ink; c.fill();
  if (toothy) { c.save(); c.clip(); teeth(-w * .92, w * .92, y + 1, depth * .5, Math.max(6, Math.round(w / 4))); c.restore(); }
}

// Stages 0 and 1: the costume heads. off = stage 1.
const COSTUME = {
  hippo(d) {
    const B = furCol(d), off = o.rot === 1;
    blob(-36, -38, 12, 12, B); blob(36, -38, 12, 12, B);
    blob(0, -6, 50, 44, B); blob(0, 14, 42, 24, d.belly);
    if (off) hatch(0, -6, 49, 43, 70, 3);
    if (!o.dark) {
      shape(off ? mix(P.yellow, P.surface1, .3) : P.yellow, off ? [[-16, -46], [6, -88], [20, -42]] : [[-16, -46], [0, -92], [16, -46]]);
      oval(off ? 6 : 0, off ? -88 : -92, 5, 5, P.pink); oval(-13, 8, 3.5, 3.5, rgba(P.ink, .55)); oval(13, 8, 3.5, 3.5, rgba(P.ink, .55));
      if (!off) for (const sx of [-1, 1]) oval(sx * 36, 0, 8, 6, rgba(P.red, .35));
    }
    googly(-20, -20, 9, 1); googly(20, -20, 9, 2);
    smile(off ? 30 : 22, 20, off);
    if (!off && !o.dark) { c.fillStyle = P.rosewater; c.fillRect(-14, 22, 9, 10); c.fillRect(5, 22, 9, 10); }
    if (off) strands(-18, 18, 34, 5, 60, 4);
  },
  walrus(d) {
    const B = furCol(d), off = o.rot === 1, tusk = off ? 84 : 44;
    blob(0, 0, 36, 36, B);
    if (off) hatch(0, 0, 35, 35, 50, 9);
    if (!o.dark) for (const sx of [-1, 1]) shape(off ? mix(BONE, P.surface1, .2) : P.rosewater, [[sx * 15, 14], [sx * 6, 14], [sx * (off ? 13 : 10), 14 + tusk]]);
    blob(-12, 12, 15, 11, d.belly); blob(12, 12, 15, 11, d.belly);
    googly(-13, -10, 8, 3); googly(13, -10, 8, 4);
    if (off) smile(20, 20, true);
    if (o.dark) return;
    oval(0, 4, 5.5, 4, P.ink);
    shape(P.pink, [[0, -34], [-18, -46], [-16, -24]]); shape(P.pink, [[0, -34], [18, -46], [16, -24]]); oval(0, -34, 5, 5, mix(P.pink, P.red, .4));
    for (let i = 0; i < 9; i++) { const a = Math.PI * (.12 + .76 * i / 8); oval(Math.cos(a) * 32, 30 + Math.sin(a) * 12, 3.6, 3.6, P.rosewater); }
    if (off) strands(-14, 14, 22, 5, 90, 6);
  },
  toad(d) {
    const B = furCol(d), off = o.rot === 1;
    blob(0, 0, 70, 46, B);
    for (const sx of [-1, 1]) blob(sx * 34, -40, 21, 21, B);
    if (off) hatch(0, 0, 69, 45, 110, 5);
    googly(-34, -42, 13, 5); googly(34, -42, 13, 6);
    smile(off ? 58 : 44, 6, off);
    if (!off && !o.dark) for (const sx of [-1, 1]) oval(sx * 52, 4, 8, 6, rgba(P.red, .3));
    if (off) strands(-40, 40, 20, 8, 60, 8);
  },
  rhino(d) {
    const B = furCol(d), off = o.rot === 1;
    blob(-30, -40, 9, 15, B); blob(30, -40, 9, 15, B);
    blob(0, 0, 48, 44, B); blob(0, 20, 30, 17, d.belly);
    if (off) hatch(0, 0, 47, 43, 80, 7);
    shape(o.dark ? P.ink : P.rosewater, [[-11, -8], [2, off ? -74 : -56], [13, -8]]);
    if (!o.dark) { c.fillStyle = off ? mix(P.peach, P.surface1, .25) : P.peach; c.fillRect(-46, -34, 92, 8); }
    googly(-20, -12, 9, 7); googly(20, -12, 9, 8);
    if (off) { if (!o.dark) lines(P.ink, 1.8, [[-18, 22, -6, 27], [-6, 27, 6, 27], [6, 27, 18, 21], [-12, 21, -10, 29], [-4, 23, -3, 31], [4, 23, 5, 31], [12, 20, 13, 28]]); strands(-14, 14, 34, 4, 60, 10); }
    else smile(16, 22, false);
  },
};

// Stage 2.
const HEAD = {
  // A shaggy dome with a hole in it. Something small lives in the hole.
  hippo(d) {
    const B = furCol(d), gape = o.scare ? 1.3 : 1;
    blob(-40, -36, 12, 13, B); blob(40, -36, 12, 13, B);
    blob(0, -4, 60, 50, B);
    shape(o.dark ? P.ink : mix(B, P.ink, .25), Array.from({ length: 19 }, (_, i) => [-60 + i * 6.7, i % 2 ? 58 + hash(i) * 26 : 22]));   // matted fringe
    hatch(0, -4, 58, 48, 160, 3);
    if (!o.dark) shape(mix(P.yellow, P.surface1, .4), [[-16, -48], [8, -92], [22, -44]]);   // party hat, crushed
    deadEye(-30, -18, 5.5, 1); deadEye(32, -22, 5, 2);
    oval(0, 34, 27 * gape + 2, 44 * gape + 2, P.ink);
    c.save(); c.beginPath(); c.ellipse(0, 34, 27 * gape, 44 * gape, 0, 0, TAU); c.clip();
    teeth(-26, 26, -12, 12, 7);
    maskFace(Math.sin(o.t * .4) * 3, 44 + Math.sin(o.t * .7) * 5, 17, 1);
    c.restore();
    strands(-24, 24, 60, 11, 150, 4); strands(-20, 20, 60, 6, 110, 41, BLOOD);
  },

  // A small friendly face on a very long neck, and tusks that grew the wrong way.
  walrus(d) {
    const B = furCol(d), horn = o.dark ? P.ink : mix(BONE, P.surface1, .3), segs = [];
    for (const sx of [-1, 1]) {                                         // tusks, branching upward
      segs.push([sx * 10, -10, sx * 26, -54], [sx * 26, -54, sx * 18, -104], [sx * 26, -54, sx * 52, -80], [sx * 52, -80, sx * 50, -118], [sx * 18, -104, sx * 30, -134], [sx * 18, -104, sx * 4, -128]);
    }
    lines(horn, 4, segs);
    blob(0, 0, 30, 32, B);
    hatch(0, 0, 29, 31, 60, 9);
    deadEye(-12, -8, 4.5, 3); deadEye(13, -10, 5, 4);
    if (o.scare) { oval(0, 22, 15, 20, P.ink); c.save(); c.beginPath(); c.ellipse(0, 22, 14, 19, 0, 0, TAU); c.clip(); teeth(-13, 13, 3, 8, 6); c.restore(); }
    else { blob(-10, 12, 12, 9, mix(B, PALE, .4)); blob(10, 12, 12, 9, mix(B, PALE, .4)); oval(0, 5, 5, 3.5, P.ink); }
    strands(-22, 22, 16, 13, 210, 6); strands(-16, 16, 16, 5, 120, 61, BLOOD);
    if (o.dark) return;
    shape(mix(P.pink, P.surface1, .35), [[0, -32], [-17, -43], [-15, -23]]); shape(mix(P.pink, P.surface1, .35), [[0, -32], [17, -43], [15, -23]]);
    for (let i = 0; i < 9; i++) { const a = Math.PI * (.12 + .76 * i / 8); oval(Math.cos(a) * 27, 26 + Math.sin(a) * 12, 3.2, 3.2, PALE); }   // pearls
  },

  // Mostly mouth.
  toad(d) {
    const B = furCol(d), gape = o.scare ? 2.1 : 1;
    blob(0, 0, 96, 84, B);
    for (const sx of [-1, 1]) blob(sx * 46, -80, 26, 25, B);
    hatch(0, 0, 94, 82, 240, 5);
    deadEye(-46, -84, 8, 5); deadEye(46, -84, 7, 6);
    c.beginPath(); c.moveTo(-84, 0); c.quadraticCurveTo(0, 14, 84, 0); c.quadraticCurveTo(0, 14 + 46 * gape, -84, 0);
    c.fillStyle = P.ink; c.fill();
    c.save(); c.clip(); teeth(-78, 78, 2, 15, 17); c.restore();
    strands(-66, 66, 18, 20, 120, 8); strands(-60, 60, 18, 10, 90, 81, BLOOD);
  },

  // The costume head hangs to one side and does nothing, until the jumpscare,
  // when its stitches go and the worm's mouth turns out to be its mouth.
  rhino(d) {
    const B = furCol(d);
    blob(-30, -40, 9, 15, B); blob(30, -40, 9, 15, B);
    blob(0, 0, 50, 46, B);
    hatch(0, 0, 49, 45, 130, 7);
    shape(o.dark ? P.ink : mix(BONE, P.surface1, .3), [[-10, -30], [6, -96], [14, -30]]);   // horn
    if (!o.dark) { lines(rgba(P.ink, .6), 1.4, [[5, -84, 2, -70], [2, -70, 8, -58], [8, -58, 4, -44]]); c.fillStyle = mix(P.peach, P.surface1, .35); c.fillRect(-48, -34, 96, 7); }
    if (o.scare) {
      deadEye(-21, -22, 6, 7); deadEye(22, -20, 5.5, 8);
      wormMouth(0, 26, 33 + Math.sin(o.t * 3) * 1.5);
      const thread = [];                                                // the stitches that were holding it shut
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + .3, r0 = 40, r1 = 50 + hash(i + 70) * 12; thread.push([Math.cos(a) * r0, 26 + Math.sin(a) * r0, Math.cos(a + .25) * r1, 26 + Math.sin(a + .25) * r1]); }
      lines(P.ink, 1.6, thread);
      for (let i = 0; i < 7; i++) { const x = (hash(i + 60) - .5) * 90, len = 20 + hash(i + 61) * 50; c.fillStyle = rgba(i % 2 ? WET : BLOOD, .8); c.fillRect(x, 50, 2 + hash(i) * 2, len); oval(x + 1.5, 50 + len, 2.4, 3.6, rgba(WET, .85)); }
      return;
    }
    deadEye(-18, -8, 6, 7); deadEye(20, -6, 5, 8);
    blob(0, 20, 28, 15, mix(B, PALE, .35));
    if (!o.dark) lines(P.ink, 1.8, [[-18, 22, -6, 27], [-6, 27, 6, 27], [6, 27, 18, 21], [-12, 21, -10, 29], [-4, 23, -3, 31], [4, 23, 5, 31], [12, 20, 13, 28]]);   // stitched shut
    strands(-20, 20, 34, 9, 130, 10); strands(-16, 16, 34, 5, 90, 101, BLOOD);
  },
};

/* ---------- stage 2 extras ---------- */
// The one thing each mascot has that the others do not, when it moves and
// so cannot be baked into the body.

// The end of Tank's worm: puckered lips, three rings of hooked teeth turning
// against each other, a second mouth down the throat, and eyes around the rim.
function wormMouth(x, y, r) {
  const t = o.t, skin = mix(P.flamingo, P.surface1, .45), pulse = 1 + Math.sin(t * 5) * .06;
  const lobes = 15;
  for (let i = 0; i < lobes; i++) { const a = i / lobes * TAU; oval(x + Math.cos(a) * r, y + Math.sin(a) * r, r * .24, r * .24, P.ink); }
  oval(x, y, r * 1.02, r * 1.02, P.ink);
  if (!o.dark) {
    for (let i = 0; i < lobes; i++) { const a = i / lobes * TAU, lr = r * (.19 + hash(i) * .04); oval(x + Math.cos(a) * r, y + Math.sin(a) * r, lr, lr, i % 2 ? skin : mix(skin, P.red, .25)); }
    const g = c.createRadialGradient(x, y, r * .1, x, y, r);
    g.addColorStop(0, P.ink); g.addColorStop(.55, mix(P.red, P.ink, .7)); g.addColorStop(1, mix(P.red, P.ink, .35));
    oval(x, y, r * .94, r * .94, g);
    const folds = [];                                                   // wet folds running down the throat
    for (let i = 0; i < 22; i++) { const a = i / 22 * TAU + .1; folds.push([x + Math.cos(a) * r * .9, y + Math.sin(a) * r * .9, x + Math.cos(a + .25) * r * .3, y + Math.sin(a + .25) * r * .3]); }
    lines(rgba(P.ink, .35), r * .03, folds);
  }
  // teeth: each a hooked sliver, rings turning opposite ways
  for (const [ring, n, len, dir] of [[.9, 19, .24, 1], [.66, 14, .2, -1], [.46, 10, .17, 1]]) {
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU + dir * t * .5, w = Math.PI / n * .55, rr = r * ring, tip = rr - r * len * (.75 + hash(i + n) * .5);
      c.moveTo(x + Math.cos(a - w) * rr, y + Math.sin(a - w) * rr); c.lineTo(x + Math.cos(a + w) * rr, y + Math.sin(a + w) * rr);
      c.lineTo(x + Math.cos(a + dir * .16) * tip, y + Math.sin(a + dir * .16) * tip);
    }
    c.fillStyle = o.dark ? rgba(BONE, .3) : mix(BONE, P.yellow, ring < .5 ? .3 : 0); c.fill();
  }
  // the second mouth, coming up the throat
  const ir = r * .2 * pulse;
  oval(x, y, ir * 1.15, ir * 1.15, P.ink);
  if (!o.dark) oval(x, y, ir, ir, mix(skin, P.red, .45));
  c.beginPath();
  for (let i = 0; i < 7; i++) { const a = i / 7 * TAU - t; c.moveTo(x + Math.cos(a - .3) * ir, y + Math.sin(a - .3) * ir); c.lineTo(x + Math.cos(a + .3) * ir, y + Math.sin(a + .3) * ir); c.lineTo(x + Math.cos(a) * ir * .35, y + Math.sin(a) * ir * .35); }
  c.fillStyle = o.dark ? rgba(BONE, .3) : BONE; c.fill();
  oval(x, y, ir * .3, ir * .3, P.ink);
  if (!o.dark) lines(rgba(P.teal, .4), r * .02, [[x - r * .7, y - r * .5, x + r * .5, y + r * .72], [x - r * .2, y - r * .85, x - r * .5, y + r * .7], [x + r * .75, y - r * .4, x + r * .1, y + r * .88]]);   // slime strung across
  // bead eyes around the rim, every one of them on you
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * TAU + hash(i + 3) * .4, ex = x + Math.cos(a) * r * 1.14, ey = y + Math.sin(a) * r * 1.14, er = r * (.05 + hash(i) * .035);
    oval(ex, ey, er * 1.3, er * 1.3, P.ink); oval(ex, ey, er * .36, er * .36, PALE);
  }
}

// Extras that sit behind the body, in both poses.
const UNDER = {
  // Flan: four jointed legs that move like a machine with a fault. Each one
  // holds still, then spasms in hard steps, and one of them no longer works.
  walrus() {
    const col = mix(furCol(o.d), P.ink, .35), tick = Math.floor(o.t * 14);
    let leg = 0;
    for (let k = 0; k < 2; k++) for (const sx of [-1, 1]) {
      const n = leg++, y0 = -70 + k * 34, reach = 150 + k * 22, dead = n === 2;
      const slot = Math.floor(o.t / 1.3 + n * .37), into = (o.t / 1.3 + n * .37) % 1;
      const spasm = !dead && hash(slot * 5 + n) > .4 && into < .45;
      // jitter changes 14 times a second and is held in between, so it steps
      const j1 = spasm ? hash(tick + n * 13) - .5 : 0, j2 = spasm ? hash(tick + n * 29) - .5 : 0;
      const tremble = dead ? (hash(tick + 77) - .5) * .12 : 0, curl = dead ? .8 : 0;
      const knee = [sx * (reach * .62 + j1 * 34), y0 - 62 + k * 14 + j2 * 30 + curl * 50];
      const shin = [sx * (reach * (1 - curl * .45) + j2 * 26), y0 + 30 + k * 30 - Math.abs(j1) * 50 + curl * 20];
      const foot = [sx * (reach * (1 - curl * .62) + 12 + j1 * 22 + tremble * 60), 146 - Math.abs(j2) * 60 - curl * 46 + tremble * 40];
      limb([[sx * 26, y0], knee, shin, foot], 9, 3.5, col);
      if (!o.dark) for (const [jx, jy] of [knee, shin]) oval(jx, jy, 3, 3, P.ink);   // joints
    }
  },
};

const EXTRA = {
  // Tank: a fat, wet, segmented worm out of the belly, up past the head, mouth toward you.
  rhino(back) {
    const t = o.t, sway = Math.sin(t * .8), sway2 = Math.cos(t * .6);
    const P0 = [0, -8], P1 = [70 + sway2 * 14, 120], P2 = [200 + sway * 18, -20], P3 = [74 + sway * 26, -176 + sway2 * 12];
    const at = u => { const v = 1 - u; return [0, 1].map(k => v * v * v * P0[k] + 3 * v * v * u * P1[k] + 3 * v * u * u * P2[k] + u * u * u * P3[k]); };
    const N = 26, skin = mix(P.flamingo, P.surface1, .45), sick = mix(P.yellow, P.surface2, .55);
    // A swallowing motion runs along it, and no two segments are the same size.
    const seg = Array.from({ length: N + 1 }, (_, i) => { const [x, y] = at(i / N); return { x, y, r: lerp(22, 14, i / N) * (1 + .2 * Math.sin(i * .8 - t * 3.5) + (hash(i) - .5) * .25) }; });
    for (const g of seg) oval(g.x, g.y, g.r + 1.8, g.r + 1.8, P.ink);
    if (!o.dark) {
      seg.forEach((g, i) => oval(g.x, g.y, g.r, g.r, mix(skin, i % 3 ? P.red : sick, i % 2 ? .12 : .3)));
      seg.forEach((g, i) => {
        oval(g.x + g.r * .3, g.y + g.r * .35, g.r * .55, g.r * .4, rgba(P.ink, .28));                      // each ring shades the next
        oval(g.x - g.r * .35, g.y - g.r * .4, g.r * .28, g.r * .16, rgba(P.rosewater, .4));                // wet shine
        if (hash(i + 5) > .55) { oval(g.x + (hash(i) - .5) * g.r, g.y + (hash(i + 1) - .5) * g.r, g.r * .2, g.r * .2, P.ink); oval(g.x + (hash(i) - .5) * g.r, g.y + (hash(i + 1) - .5) * g.r, g.r * .13, g.r * .13, sick); }   // boils
        if (hash(i + 9) > .6) oval(g.x + (hash(i + 2) - .5) * g.r * 1.2, g.y + (hash(i + 3) - .5) * g.r * 1.2, g.r * .3, g.r * .22, rgba(BLOOD, .6));   // bruising
      });
      const veins = [], bristles = [];
      for (let i = 0; i < N; i++) {
        const a = seg[i], b = seg[i + 1], wob = (hash(i + 20) - .5) * a.r;
        veins.push([a.x + wob, a.y - a.r * .2, b.x + (hash(i + 21) - .5) * b.r, b.y - b.r * .2]);
        if (i % 2) for (let k = 0; k < 3; k++) { const an = hash(i * 3 + k) * TAU; bristles.push([a.x + Math.cos(an) * a.r, a.y + Math.sin(an) * a.r, a.x + Math.cos(an) * (a.r + 7 + hash(i + k) * 6), a.y + Math.sin(an) * (a.r + 7) + 3]); }
      }
      lines(rgba(mix(P.red, P.ink, .45), .8), 1.6, veins);
      lines(P.ink, 1, bristles);
      for (let i = 0; i < 7; i++) { const a = i / 7 * TAU; oval(Math.cos(a) * 24, -8 + Math.sin(a) * 30, 9, 9, i % 2 ? WET : BLOOD); }   // torn flesh where it comes out
    }
    const m = seg[Math.round(N * .5)];
    if (!back) { strands(m.x - 60, m.x + 30, m.y + 14, 9, 80, 31, rgba(P.teal, .5)); strands(-22, 22, 20, 7, 110, 33, BLOOD); }
    const tip = seg[N];
    wormMouth(tip.x, tip.y, 30);
  },
  // Squish: a length of spine still attached, and what drips off it.
  toad() {
    const sway = Math.sin(o.t * 1.1) * 5;
    strands(-62, -30, 44, 6, 90, 71, BLOOD); strands(30, 62, 44, 6, 90, 72, BLOOD);
    for (let i = 0; i < 7; i++) {
      const x = sway * i * .3, y = 58 + i * 12, r = 8 - i * .7;
      oval(x, y, r + 1.4, r * .7 + 1.4, P.ink); oval(x, y, r, r * .7, o.dark ? P.ink : BONE);
    }
    if (o.dark) return;
    for (let i = 0; i < 4; i++) { const fall = (o.t * .7 + i * .27) % 1; oval(-30 + i * 22, 100 + fall * fall * 190, 2.2, 3.4 + fall * 3, rgba(WET, 1 - fall * .5)); }   // drops, on their way down
  },
};

// Where each head sits at each stage, and how wide the visible neck is.
const NECK = {
  hippo: [[0, -122, 0], [0, -128, 24], [0, -138, 26]],
  walrus: [[0, -118, 0], [0, -150, 15], [0, -196, 13]],
  toad: [[0, -104, 0], [0, -96, 0], [0, -62, 0]],
  rhino: [[0, -122, 0], [0, -116, 22], [-40, -108, 18, -.75]],   // 4th value: a fixed tilt. Its neck is broken.
};

function drawHead(d, i) {
  const [hx, hy, neckW, lean = 0] = NECK[d.k][o.rot];
  const beat = Math.floor(o.t * .9 + i * 3), jerk = o.rot && hash(beat + i * 17) > 1 - o.rot * .05 ? (hash(beat) - .5) * .7 : 0;   // sudden twitch
  const tilt = lean + Math.sin(o.t * .5 + i) * .05 + (lean ? 0 : jerk);
  if (neckW) limb([[0, -92], [hx + (tilt - lean) * 30, hy + 10]], neckW, neckW * .8, furCol(d));
  c.save(); c.translate(hx, hy); c.rotate(tilt);
  (o.rot === 2 ? HEAD : COSTUME)[d.k](d);
  c.restore();
}

/* ---------- entry points ---------- */

// opts.rot: 0, 1 or 2 (see top of file). opts.pose: 'front' | 'back'.
// opts.dark: ink silhouette, eyes still visible.
// opts.scare: jumpscare face. opts.t: seconds, drives breathing and twitching.
export function drawMascot(i, x, y, s, opts = {}) {
  const d = MASC[i], t = opts.t || 0;
  o = { pose: 'front', dark: false, scare: false, rot: 2, ...opts, t, d, breath: Math.sin(t * 1.6 + i * 1.7) };
  c.save(); c.translate(x, y); c.scale(s, s);
  if (!o.dark) oval(0, 154, 90, 10, rgba(P.ink, .5));
  if (!o.dark && o.rot === 2) {                                         // standing in it
    oval(6, 155, 104, 9, rgba(BLOOD, .85)); oval(-58, 158, 30, 5, rgba(BLOOD, .85)); oval(84, 150, 16, 4, rgba(BLOOD, .8));
    oval(-10, 154, 46, 3.5, rgba(WET, .5));
  }
  const back = o.pose === 'back', extra = o.rot === 2 && EXTRA[d.k];
  // Squish at stage 2 has nothing to stand on. It hangs in the air and bobs.
  if (extra && d.k === 'toad') c.translate(0, -30 + Math.sin(t * 1.2) * 7);
  if (o.rot === 2 && UNDER[d.k]) UNDER[d.k]();
  if (extra && back) extra(back);    // seen from behind, the extras are on the far side
  drawBody(i, back);
  drawHead(d, i);
  if (extra && !back) extra(back);
  c.restore();
}

// Just the head, centred on (x, y). For the jumpscare and for faces pressed to a camera.
export function drawFace(i, x, y, s, opts = {}) {
  const d = MASC[i], t = opts.t || 0;
  o = { dark: false, scare: false, rot: 2, ...opts, t, d, breath: 0 };
  c.save(); c.translate(x, y); c.scale(s, s);
  (o.rot === 2 ? HEAD : COSTUME)[d.k](d);
  c.restore();
}
