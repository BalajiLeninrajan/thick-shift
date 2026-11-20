// What every floor, wall and ceiling in the Depot is made of. Each room gets
// its own so a guard can tell where they are from one torch-lit patch of it.
// Every texture covers SPAN metres across; a wall texture covers the whole
// height of its room, so the dado and the damp sit at real heights.
import * as THREE from 'three';
import { paint, fbm, mixc } from './tex.js';
import { ROOMS3 } from '../map.js';

export const SPAN = 4;
const M = 512 / SPAN;   // pixels per metre across

// Noise fields shared by all the painters: broad, medium, patchy and fine.
const BROAD = fbm(256, 3, 5, 11), MID = fbm(256, 7, 4, 23), PATCH = fbm(256, 2, 3, 37), FINE = fbm(256, 110, 1, 51);
// Flaking: small chips that gather where the broad field is high, so wear comes in clusters and not evenly.
const FLAKE = fbm(256, 16, 3, 71).map((v, i) => v * .55 + BROAD[i] * .45);

// The dirt every surface has: ground-in grime in patches and a fine speckle.
function dirt(p, k = 1) {
  p.wash(BROAD, .5, .85, '#0d0a07', .4 * k, null, .95);
  p.wash(FLAKE, .5, .7, '#0a0806', .3 * k, null, null);
  p.wash(FINE, .5, .9, '#000000', .13 * k, .44, null);
  p.wash(FINE, .1, .5, '#ffffff', .04 * k, null, null);
}
// Short curved scrapes, the kind chair legs and trolleys leave.
const scuffs = (p, n, col, len = 40) => { for (let i = 0; i < n; i++) { const x = p.rnd() * p.s, y = p.rnd() * p.s, a = p.rnd() * 7, l = len * (.3 + p.rnd() * .7), b = a + (p.rnd() - .5); p.line([[x, y], [x + Math.cos(a) * l * .5, y + Math.sin(a) * l * .5], [x + Math.cos(a) * l * .5 + Math.cos(b) * l * .5, y + Math.sin(a) * l * .5 + Math.sin(b) * l * .5]], .5 + p.rnd() * 1.2, col, null, .9, .1 + p.rnd() * .2); } };
function cracks(p, n, col = '#07070a') {
  for (let i = 0; i < n; i++) {
    let x = p.rnd() * p.s, y = p.rnd() * p.s, a = p.rnd() * 7; const pts = [[x, y]];
    for (let k = 0; k < 9; k++) { a += (p.rnd() - .5) * 1.3; x += Math.cos(a) * 16; y += Math.sin(a) * 16; pts.push([x, y]); }
    p.line(pts, 1.4, col, .1, .95, .8);
  }
}

const FLOOR = {
  // Stage: dark varnished boards, worn pale where people stood.
  boards: () => paint({ col: '#5a3d22', rough: .6, bump: 2.4, seed: 1 }, p => {
    const { s, c, rnd } = p, pw = s / 16;
    for (let i = 0; i < 16; i++) {
      const y = i * pw, t = rnd();
      p.fill(0, y, s, pw, mixc('#4a3018', '#7a5632', t), .5 + t * .1, .45 + t * .3);
      c.globalAlpha = .16; c.strokeStyle = '#120a05'; c.lineWidth = 1;
      for (let k = 0; k < 6; k++) { const gy = y + 3 + rnd() * (pw - 6); c.beginPath(); c.moveTo(0, gy); c.bezierCurveTo(s * .3, gy + rnd() * 6 - 3, s * .7, gy + rnd() * 6 - 3, s, gy); c.stroke(); }
      c.globalAlpha = 1;
      p.fill(0, y, s, 2, '#0a0603', .1, .95);
      const jx = rnd() * s; p.fill(jx, y, 2, pw, '#0a0603', .15, .95);
      for (const nx of [jx - 6, jx + 7]) { p.fill(nx, y + pw * .3, 2, 2, '#15100c', .3, .4); p.fill(nx, y + pw * .7, 2, 2, '#15100c', .3, .4); }
    }
    p.wash(MID, .52, .78, '#a58a62', .38, .56, .92);
    p.wash(PATCH, .55, .8, '#080503', .55, null, .28);
    scuffs(p, 30, '#c9b08a'); dirt(p, .7);
  }),
  // Backstage: plywood painted black, chipped back to the wood.
  ply: () => paint({ col: '#2a2a2e', rough: .8, bump: 1.6, seed: 2 }, p => {
    const { s } = p;
    p.wash(BROAD, .3, .7, '#3a3a40', .7, null, .7);
    p.wash(FLAKE, .6, .63, '#7a6242', .9, .38, .95);
    for (const x of [0, s / 2]) p.fill(x, 0, 2, s, '#050505', .1, 1);
    p.fill(0, s * .3, s, 2, '#050505', .1, 1);
    for (let i = 0; i < 10; i++) p.blob(p.rnd() * s, p.rnd() * s, 2 + p.rnd() * 6, ['#d8d0c0', '#b03a30', '#3d6fa8', '#d6b23c'][i % 4], .8, null, .5);   // paint drips from years of scenery
    scuffs(p, 50, '#4a4a52', 70); dirt(p, .6);
  }),
  // Arcade: the loud carpet every arcade had, faded and trodden flat.
  carpet: () => paint({ col: '#2a2658', rough: 1, bump: 1.2, seed: 3 }, p => {
    const { s, c, rnd } = p, cols = ['#d4418e', '#2ec4c6', '#e8c832', '#7a4fd0', '#e86a2a'];
    p.wash(BROAD, .3, .7, '#3a2a66', .8, null, null);
    for (let i = 0; i < 70; i++) {
      const x = rnd() * s, y = rnd() * s, a = rnd() * 7, k = 10 + rnd() * 16;
      for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) {
        c.save(); c.translate(x + ox, y + oy); c.rotate(a); c.globalAlpha = .75; c.fillStyle = c.strokeStyle = cols[i % 5]; c.lineWidth = 4; c.lineCap = 'round';
        const kind = i % 4;
        if (kind === 0) { c.beginPath(); c.moveTo(-k, k * .6); c.lineTo(k, k * .6); c.lineTo(0, -k); c.fill(); }
        else if (kind === 1) { c.beginPath(); c.moveTo(-k, 0); c.bezierCurveTo(-k / 2, -k, k / 2, k, k, 0); c.stroke(); }
        else if (kind === 2) { c.beginPath(); c.arc(0, 0, k * .45, 0, 7); c.stroke(); }
        else for (let d = 0; d < 3; d++) c.fillRect(d * 9 - 12, -2, 5, 5);
        c.restore();
      }
    }
    p.wash(FINE, .2, .8, '#000000', .2, .38, null);
    p.wash(MID, .5, .8, '#3a3540', .55, .44, null);            // trodden grey
    p.wash(PATCH, .6, .85, '#0a0808', .6, null, .7);          // something spilled
    for (let i = 0; i < 9; i++) p.blob(rnd() * s, rnd() * s, 8 + rnd() * 14, '#0c0a0a', .8, null, .6);   // gum
    dirt(p, .8);
  }),
  // Main hall: checkered vinyl, yellowed and scuffed by chair legs.
  check: () => paint({ col: '#b7ad92', rough: .4, bump: 1, seed: 4 }, p => {
    const { s, rnd } = p, t = s / 8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const dark = (x + y) % 2, v = rnd();
      p.fill(x * t, y * t, t, t, dark ? mixc('#1c1b20', '#2a2830', v) : mixc('#978e76', '#aea48a', v), .5 + v * .04, .3 + v * .2);
      p.fill(x * t, y * t, t, 1.5, '#0b0a09', .3, .9); p.fill(x * t, y * t, 1.5, t, '#0b0a09', .3, .9);
    }
    const lifted = [[2, 5], [6, 1]];     // tiles that came up, leaving the black glue
    for (const [x, y] of lifted) { p.fill(x * t + 2, y * t + 2, t - 3, t - 3, '#1a1510', .3, .95); }
    p.wash(MID, .55, .8, '#5a4a2a', .3, null, .7);
    p.wash(PATCH, .6, .8, '#000000', .35, null, .15);          // a wet-looking patch
    scuffs(p, 70, '#0c0c0c', 30); scuffs(p, 20, '#d8d2c4', 20);
    p.speck(160, ['#d4418e', '#2ec4c6', '#e8c832', '#e86a2a'], 3, .5);   // confetti nobody swept
    dirt(p, .75);
  }),
  // Kitchen: small quarry tiles under a film of grease.
  tile: () => paint({ col: '#6d4a3a', rough: .5, bump: 2.6, seed: 5 }, p => {
    const { s, rnd } = p, t = s / 20;
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
      const v = rnd();
      p.fill(x * t, y * t, t, t, mixc('#5e3d30', '#84594a', v), .55 + v * .05, .35 + v * .25);
      if (rnd() < .04) p.fill(x * t + 3, y * t + 3, t - 6, t - 6, '#3a2620', .45, .8);   // chipped
    }
    for (let i = 0; i <= 20; i++) { p.fill(i * t - 1.5, 0, 3, s, '#15110f', .25, .95); p.fill(0, i * t - 1.5, s, 3, '#15110f', .25, .95); }
    p.wash(BROAD, .5, .75, '#1a1206', .6, null, .08);          // grease, shiny in a torch
    p.wash(PATCH, .5, .8, '#0a0805', .5, null, .12);
    p.wash(MID, .7, .8, '#8a8a80', .35, null, .9);             // dried scale
    dirt(p, .5);
  }),
  // Corridors: bare concrete with damp coming through.
  concrete: () => paint({ col: '#55575a', rough: .85, bump: 2, seed: 6 }, p => {
    const { s } = p;
    p.wash(BROAD, .2, .8, '#6a6c6e', .7, .55, null);
    p.wash(MID, .3, .7, '#3e4042', .5, .45, null);
    p.wash(FINE, .55, .8, '#2a2a2a', .25, .4, null);
    p.fill(0, 0, s, 3, '#1a1a1a', .15, 1); p.fill(s / 2, 0, 3, s, '#1a1a1a', .15, 1);   // expansion joints
    cracks(p, 5);
    p.wash(PATCH, .55, .75, '#15171a', .7, null, .12);         // standing damp
    for (const y of [s * .4, s * .46]) p.line([[0, y], [s, y]], 5, '#141414', null, .7, .3);   // trolley wheels
    dirt(p, .6);
  }),
  // Snack bar: oxblood lino with pale flecks, sticky by the counter.
  lino: () => paint({ col: '#5a1f1f', rough: .45, bump: .9, seed: 7 }, p => {
    const { s } = p;
    p.wash(BROAD, .3, .7, '#6e2626', .7, null, null);
    p.speck(1400, ['#c9b8a0', '#2a0c0c', '#8a4a3a'], 2.4, .7);
    for (const x of [0, s / 2]) p.fill(x, 0, 1.5, s, '#200808', .35, .9);
    p.fill(0, 0, s, 1.5, '#200808', .35, .9);
    p.wash(PATCH, .55, .8, '#1a0a05', .65, null, .1);          // old cola
    for (let i = 0; i < 12; i++) { const x = p.rnd() * s, y = p.rnd() * s, r = 9 + p.rnd() * 8; p.blob(x, y, r, '#120604', .7, null, .15); }   // cup rings
    scuffs(p, 70, '#1a0808', 35); dirt(p, .7);
  }),
  // Booth: grey-blue carpet tiles, worn through under the chair.
  carpetTile: () => paint({ col: '#2f3a48', rough: 1, bump: 1.4, seed: 8 }, p => {
    const { s, c, rnd } = p, t = s / 8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const v = rnd(), across = (x + y) % 2;
      p.fill(x * t, y * t, t, t, mixc('#3a4656', '#4c5a6c', v), .5, null);
      c.globalAlpha = .13; c.strokeStyle = '#0c1014'; c.lineWidth = 1; c.beginPath();
      for (let k = 2; k < t; k += 3) { if (across) { c.moveTo(x * t, y * t + k); c.lineTo(x * t + t, y * t + k); } else { c.moveTo(x * t + k, y * t); c.lineTo(x * t + k, y * t + t); } }
      c.stroke(); c.globalAlpha = 1;
      p.fill(x * t, y * t, t, 1.5, '#0c0f13', .3, null); p.fill(x * t, y * t, 1.5, t, '#0c0f13', .3, null);
    }
    p.wash(FINE, .3, .8, '#000000', .16, .4, null);
    p.wash(FLAKE, .55, .75, '#5a5a56', .3, .44, null);
    for (let i = 0; i < 5; i++) p.blob(rnd() * s, rnd() * s, 10 + rnd() * 20, '#1a120a', .7, null, .8);   // coffee
    dirt(p, .35);
  }),
};

// Sheet metal: the ducts are made of it on every side.
const metal = () => paint({ col: '#7c8288', rough: .5, bump: 2.2, seed: 9 }, p => {
  const { s, rnd } = p;
  p.wash(BROAD, .2, .8, '#9aa0a4', .5, null, .35);
  p.wash(MID, .3, .7, '#5c6268', .5, null, .6);
  for (const x of [0, s / 2]) { p.fill(x, 0, 5, s, '#3a3e42', .3, .7); p.fill(x + 5, 0, 2, s, '#b0b6ba', .7, .3); for (let y = 12; y < s; y += 32) p.blob(x + 14, y, 4, '#c8ccd0', 1, .9, .3); }
  p.fill(0, 0, s, 4, '#3a3e42', .3, .7);
  p.wash(PATCH, .58, .78, '#6a3a1c', .75, .55, .95);           // rust
  for (let i = 0; i < 14; i++) { const x = rnd() * s, y = rnd() * s; p.line([[x, y], [x + rnd() * 6 - 3, y + 30 + rnd() * 90]], 2 + rnd() * 3, '#5a3018', null, .9, .4); }
  p.wash(FINE, .5, .9, '#2a2a2a', .3, .4, .9);                 // dust
  scuffs(p, 35, '#d0d4d8', 60);
});

/* ---------- walls ---------- */

// A wall painter gets Y(metres up the wall) -> pixels down the canvas.
const wall = (look, H, draw) => paint({ ...look, tall: true }, p => draw(p, m => p.s * (1 - m / H)));
// Dirt that every wall has: a dark band kicked up from the floor, damp coming
// down from the ceiling, and runs below it.
function wallDirt(p, Y, H, k = 1) {
  const { s, c, rnd } = p;
  let g = c.createLinearGradient(0, Y(.5), 0, Y(0)); g.addColorStop(0, '#0a080600'); g.addColorStop(1, '#0a0806cc');
  c.fillStyle = g; c.fillRect(0, Y(.5), s, Y(0) - Y(.5));
  g = c.createLinearGradient(0, 0, 0, Y(H - .9)); g.addColorStop(0, '#120e08bb'); g.addColorStop(1, '#120e0800');
  c.fillStyle = g; c.fillRect(0, 0, s, Y(H - .9));
  for (let i = 0; i < 16 * k; i++) {
    const x = rnd() * s, top = rnd() < .6 ? 0 : Y(H * (.4 + rnd() * .5)), len = (40 + rnd() * 200) * (4 / H);
    const run = c.createLinearGradient(0, top, 0, top + len); run.addColorStop(0, '#1a140c99'); run.addColorStop(1, '#1a140c00');
    c.fillStyle = run; c.fillRect(x, top, 2 + rnd() * 7, len);
  }
  p.wash(PATCH, .55, .8, '#1c1810', .45 * k, null, .4);
  p.wash(FINE, .5, .9, '#000000', .1, .46, null);
}
// Paint coming away from the plaster underneath.
function peel(p, lo = .62, under = '#8f887a') {
  p.wash(FLAKE, lo, lo + .015, under, 1, .3, .95);
  p.wash(FLAKE, lo - .02, lo, '#ffffff', .22, .62, null);   // the lifted edge catches the light
}
// A band of colour from height a to b (metres), with a darker line where it meets the next.
const band = (p, Y, a, b, col, rough) => { p.fill(0, Y(b), p.s, Y(a) - Y(b), col, null, rough); };

const WALL = {
  // Stage: a painted night sky over timber panelling.
  stage: H => wall({ col: '#2a4470', rough: .9, bump: 1.8, seed: 21 }, H, (p, Y) => {
    const { s, c, rnd } = p;
    p.wash(BROAD, .3, .7, '#35558a', .7, null, null);
    c.fillStyle = '#e8d890';
    for (let i = 0; i < 22; i++) {   // stars somebody stencilled when the place opened
      const x = rnd() * s, y = Y(1.6 + rnd() * (H - 2)), r = (5 + rnd() * 9), sy = SPAN / H;
      c.globalAlpha = .35 + rnd() * .4; c.beginPath();
      for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5, q = k % 2 ? r * .42 : r; c.lineTo(x + Math.sin(a) * q, y - Math.cos(a) * q * sy); }
      c.fill();
    }
    c.globalAlpha = 1;
    peel(p, .63, '#77705f');
    band(p, Y, 0, 1.25, '#3a2616', .6);
    for (let x = 0; x < s; x += M * .5) { p.fill(x, Y(1.25), 3, Y(0) - Y(1.25), '#1a0f08', .2, .9); p.fill(x + 3, Y(1.25), 2, Y(0) - Y(1.25), '#5a3d24', .65, null); }
    p.fill(0, Y(1.33), s, Y(1.25) - Y(1.33), '#4a3220', .8, .5); p.fill(0, Y(1.25), s, 2, '#120a05', .2, null);
    wallDirt(p, Y, H);
  }),
  // Backstage: painted blockwork.
  block: H => wall({ col: '#8a8a82', rough: .95, bump: 2.6, seed: 22 }, H, (p, Y) => {
    const { s, rnd } = p, bh = .2, rows = Math.ceil(H / bh);
    for (let j = 0; j < rows; j++) for (let i = -1; i < 9; i++) {
      const w = s / 9, x = (i + (j % 2) * .5) * w, v = rnd();
      p.fill(x, Y((j + 1) * bh), w, Y(0) - Y(bh), mixc('#77776f', '#9a9a90', v), .5 + v * .08, null);
      p.fill(x, Y((j + 1) * bh), 2.5, Y(0) - Y(bh), '#3a3a36', .2, null);
    }
    for (let j = 0; j <= rows; j++) p.fill(0, Y(j * bh) - 1.5, s, 3, '#3a3a36', .2, null);
    p.wash(FINE, .3, .8, '#55554e', .22, .42, null);
    band(p, Y, 0, 1.1, '#2c3a34', null); p.wash(FLAKE, .67, .69, '#8a8a82', .9, .4, null);
    wallDirt(p, Y, H, 1.4);
  }),
  // Arcade: purple, with a zigzag in colours that were bright once.
  arcade: H => wall({ col: '#3c2860', rough: .9, bump: 1.6, seed: 23 }, H, (p, Y) => {
    const { s, c } = p;
    p.wash(BROAD, .3, .7, '#4c3478', .7, null, null);
    const zig = (y0, amp, col, w) => { c.strokeStyle = col; c.lineWidth = w; c.lineJoin = 'miter'; c.beginPath(); for (let i = 0; i <= 16; i++) c.lineTo(i * s / 16, Y(y0 + (i % 2 ? amp : 0))); c.stroke(); };
    c.globalAlpha = .8; zig(1.35, .3, '#c93c84', 12); zig(1.6, .3, '#2aa9ab', 9); zig(1.82, .3, '#d9b82e', 6); c.globalAlpha = 1;
    band(p, Y, 0, .9, '#151019', .8); p.fill(0, Y(.9), s, 3, '#d9b82e', .6, null);
    peel(p, .64, '#6f6a70');
    wallDirt(p, Y, H);
  }),
  // Main hall: circus stripes below a cream wall gone the colour of tea.
  hall: H => wall({ col: '#a39676', rough: .9, bump: 1.6, seed: 24 }, H, (p, Y) => {
    const { s } = p;
    p.wash(BROAD, .3, .7, '#b5a888', .6, null, null);
    for (let i = 0; i < 16; i++) p.fill(i * s / 16, Y(1.4), s / 16, Y(0) - Y(1.4), i % 2 ? '#7a1f1c' : '#b3a583', null, .75);
    p.fill(0, Y(1.5), s, Y(1.4) - Y(1.5), '#5a4028', .8, .5); p.fill(0, Y(1.4), s, 2, '#1a120a', .2, null);
    peel(p, .62);
    wallDirt(p, Y, H, 1.2);
  }),
  // Kitchen: white tiles to above head height, greasy paint over them.
  kitchen: H => wall({ col: '#9a9478', rough: .7, bump: 2.2, seed: 25 }, H, (p, Y) => {
    const { s, rnd } = p, th = .15, rows = Math.round(2.1 / th), tw = s / 24;
    for (let j = 0; j < rows; j++) for (let i = 0; i < 24; i++) {
      const v = rnd(), gone = rnd() < .025;
      p.fill(i * tw, Y((j + 1) * th), tw, Y(0) - Y(th), gone ? '#4a443a' : mixc('#b8b6a6', '#d2d0c2', v), gone ? .35 : .56, gone ? .95 : .12 + v * .15);
    }
    for (let j = 0; j <= rows; j++) p.fill(0, Y(j * th) - 1, s, 2.5, '#3a362c', .3, .9);
    for (let i = 0; i < 24; i++) p.fill(i * tw - 1, Y(2.1), 2.5, Y(0) - Y(2.1), '#3a362c', .3, .9);
    p.wash(BROAD, .5, .8, '#4a3a10', .5, null, .1);            // grease that ran
    p.wash(MID, .62, .75, '#1a1408', .5, null, null);
    wallDirt(p, Y, H, 1.5);
  }),
  // The service corridors: two-tone institutional paint. dado: the lower colour, which differs east and west.
  corridor: (H, dado) => wall({ col: '#99917a', rough: .85, bump: 1.8, seed: 26 }, H, (p, Y) => {
    const { s } = p;
    p.wash(BROAD, .3, .7, '#a8a088', .6, null, null);
    band(p, Y, 0, 1.45, dado, .6); p.wash(BROAD, .4, .8, '#000000', .25, null, null);
    p.fill(0, Y(1.5), s, Y(1.45) - Y(1.5), '#15140f', null, .5);
    peel(p, .6, '#7c7868');
    p.wash(PATCH, .5, .75, '#2a3018', .5, null, .3);           // mould
    wallDirt(p, Y, H, 1.6);
  }),
  // Snack bar: mustard and brown stripes from another decade.
  snack: H => wall({ col: '#a8822c', rough: .8, bump: 1.4, seed: 27 }, H, (p, Y) => {
    const { s } = p;
    p.wash(BROAD, .3, .7, '#b89238', .6, null, null);
    band(p, Y, 1.7, 2.0, '#5a2e14', .6); band(p, Y, 2.08, 2.2, '#c8501e', .6); band(p, Y, 1.5, 1.62, '#e0cfa0', .6);
    band(p, Y, 0, 1, '#3a2414', .5);
    for (let x = 0; x < s; x += s / 8) p.fill(x, Y(1), 2.5, Y(0) - Y(1), '#1a0e06', .2, .9);
    p.fill(0, Y(1.04), s, Y(1) - Y(1.04), '#6a4a2a', .8, .4);
    peel(p, .66, '#9a8c6c');
    wallDirt(p, Y, H, 1.2);
  }),
  // Booth: dark timber-effect panelling, the one room that was ever cosy.
  booth: H => wall({ col: '#6b4a2e', rough: .65, bump: 2, seed: 28 }, H, (p, Y) => {
    const { s, c, rnd } = p;
    p.wash(BROAD, .2, .8, '#86603a', .7, null, null);
    c.globalAlpha = .2; c.strokeStyle = '#1a0f07'; c.lineWidth = 1;
    for (let i = 0; i < 140; i++) { const x = rnd() * s; c.beginPath(); c.moveTo(x, 0); c.bezierCurveTo(x + rnd() * 8 - 4, s * .3, x + rnd() * 8 - 4, s * .6, x + rnd() * 6 - 3, s); c.stroke(); }
    c.globalAlpha = 1;
    for (let x = 0; x < s; x += s / 16) { p.fill(x, 0, 3, s, '#150c06', .15, .9); p.fill(x + 3, 0, 1.5, s, '#6e5034', .65, null); }
    wallDirt(p, Y, H, .6);
  }),
};

/* ---------- ceilings ---------- */

const CEIL = {
  // Suspended tiles in a metal grid: sagging, water-stained.
  tiles: () => paint({ col: '#8f8c80', rough: .95, bump: 2, seed: 41 }, p => {
    const { s, rnd } = p, t = s / 6;   // 67 cm tiles
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) { const v = rnd(); p.fill(x * t, y * t, t, t, mixc('#7f7c70', '#9c998c', v), .46 + v * .1, null); }
    p.wash(FINE, .5, .75, '#55524a', .22, .4, null);   // the pinholes these tiles have
    for (let i = 0; i < 4; i++) { const x = rnd() * s, y = rnd() * s, r = 30 + rnd() * 60; p.blob(x, y, r, '#5a4520', .5, .42, null); p.blob(x, y, r * .6, '#8f8c80', .5, null, null); }   // tide marks
    for (let i = 0; i <= 6; i++) { p.fill(i * t - 2.5, 0, 5, s, '#b9b9b4', .8, .4); p.fill(0, i * t - 2.5, s, 5, '#b9b9b4', .8, .4); p.fill(i * t + 2.5, 0, 1.5, s, '#2a2a28', .3, null); p.fill(0, i * t + 2.5, s, 1.5, '#2a2a28', .3, null); }
    dirt(p, .25);
  }),
  // Bare slab with shutter marks.
  slab: () => paint({ col: '#4c4c4a', rough: .95, bump: 1.8, seed: 42 }, p => {
    const { s } = p;
    p.wash(BROAD, .2, .8, '#5c5c58', .6, .55, null);
    for (let i = 0; i < 8; i++) p.fill(0, i * s / 8, s, 2, '#2a2a28', .3, null);
    p.wash(PATCH, .5, .75, '#2a2a20', .7, null, null);
    cracks(p, 3); dirt(p, .8);
  }),
  // The stage's roof: black boards.
  black: () => paint({ col: '#0f0f11', rough: .95, bump: 1.6, seed: 43 }, p => {
    const { s } = p;
    for (let i = 0; i < 12; i++) p.fill(0, i * s / 12, s, 2, '#000000', .2, null);
    p.wash(BROAD, .4, .8, '#1c1c20', .7, null, null); p.wash(FINE, .6, .9, '#2a2a2a', .3, null, null);
  }),
};

// Small parts (skirting, door frames, pipes, fittings) share one worn-paint
// texture and take their colour from the mesh.
const trim = () => paint({ col: '#c8c8c8', rough: .6, bump: 1.4, seed: 61 }, p => {
  p.wash(BROAD, .3, .8, '#8e8e8e', .6, null, .8);
  p.wash(MID, .62, .7, '#4a4038', .8, .35, .95);
  scuffs(p, 80, '#3a3a3a', 50); dirt(p, .5);
});

// Which surfaces each room wears, by room index. skirt and frame are trim colours.
const WEST_DADO = '#3f6a54', EAST_DADO = '#8a6a2a';
export const LOOK = [
  { floor: 'boards', wall: 'stage', ceil: 'black', skirt: '#2a1a0e', frame: '#5a1a1a' },
  { floor: 'ply', wall: 'block', ceil: 'slab', skirt: '#1a1a1c', frame: '#2c3a34' },
  { floor: 'carpet', wall: 'arcade', ceil: 'tiles', skirt: '#0c0a10', frame: '#d9b82e' },
  { floor: 'check', wall: 'hall', ceil: 'tiles', skirt: '#3a2818', frame: '#7a1f1c' },
  { floor: 'tile', wall: 'kitchen', ceil: 'tiles', skirt: '#8a8f94', frame: '#8a8f94' },
  { floor: 'concrete', wall: 'corridor', dado: WEST_DADO, ceil: 'slab', skirt: '#1c2a22', frame: WEST_DADO },
  { floor: 'lino', wall: 'snack', ceil: 'tiles', skirt: '#2a1a0e', frame: '#c8501e' },
  { floor: 'concrete', wall: 'corridor', dado: EAST_DADO, ceil: 'slab', skirt: '#2a2010', frame: EAST_DADO },
  { floor: 'metal', wall: 'metal', ceil: 'metal', skirt: null, frame: '#5c6268' },
  { floor: 'carpetTile', wall: 'booth', ceil: 'tiles', skirt: '#1a0f07', frame: '#b89a2a' },
];

// Materials for the whole building: { floor, wall, ceil } by room index, and trim.
export function surfaces() {
  const std = (maps, metalness = 0) => new THREE.MeshStandardMaterial({ ...maps, roughness: 1, metalness });
  const sheet = std(metal(), .55), made = new Map();
  const once = (key, make) => { if (!made.has(key)) made.set(key, make()); return made.get(key); };
  const rooms = LOOK.map((look, i) => {
    const H = ROOMS3[i].h;
    if (look.floor === 'metal') return { floor: sheet, wall: sheet, ceil: sheet };
    return {
      floor: once('f' + look.floor, () => std(FLOOR[look.floor]())),
      wall: once('w' + look.wall + H + (look.dado || ''), () => std(WALL[look.wall](H, look.dado))),
      ceil: once('c' + look.ceil, () => std(CEIL[look.ceil]())),
    };
  });
  return { rooms, trim: new THREE.MeshStandardMaterial({ ...trim(), roughness: 1, vertexColors: true }) };
}
