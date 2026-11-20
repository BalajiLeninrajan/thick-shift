// Everything that is stuck, painted or sprayed onto the building: posters and
// a mural of the mascots in their friendly days, staff notices, stains, the
// room names stencilled by the doors. Two canvases, cut up by the rectangles
// in ART and NAMES; shell.ts puts the pieces on the walls.
import * as THREE from 'three';
import { MASC } from '@thick-shift/sim/config';
import { ROOMS3 } from '@thick-shift/sim/map';
import { canvas, rand, mixc, fbm, FIELD } from './tex';
import type { UV } from './geo';

// A rectangle of a canvas, [x, y, w, h] in pixels.
export type Px = [x: number, y: number, w: number, h: number];
// What art() paints: the art and room-name canvases as textures, and how wide each room's name came out, in pixels.
export interface Pics {
  art: THREE.CanvasTexture;
  names: THREE.CanvasTexture;
  nameWidth: number[];
}

// [x, y, w, h] in pixels of the 1024 square art canvas.
export const ART = {
  poster0: [0, 0, 224, 320],
  poster1: [224, 0, 224, 320],
  poster2: [448, 0, 224, 320],
  poster3: [672, 0, 224, 320],
  height: [896, 0, 128, 320],
  mural: [0, 320, 1024, 320],
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`note${i}`, [i * 128, 640, 128, 160]])),
  damp: [0, 800, 224, 224],
  hand: [224, 800, 160, 160],
  hole: [384, 800, 160, 160],
  mark: [544, 800, 128, 128],
  tally: [672, 800, 160, 128],
  exit: [832, 800, 128, 64],
  scrawl: [832, 864, 192, 96],
  scallop: [224, 960, 512, 64],
  hazard: [736, 960, 256, 32],
} satisfies Record<string, Px>;
const POSTER_LINE = ['THERE IS ALWAYS ROOM\nFOR ONE MORE', 'HUGS ARE FREE', 'HE FITS ANYWHERE', 'NO RUNNING\n(EXCEPT TANK)'];
const NOTES = [
  ['NOTICE', 'CLOSED until further notice. Do not let anyone tell you it is a party.'],
  ['NIGHT STAFF', 'Sparks mean a fault. Fix it before it fixes you. The wiring does not care how you feel.'],
  ['COSTUME CARE', 'Heads on the shelf. Bodies on the rack. Count both. Count again.'],
  ['LOST CHILD?', 'Bring them to the booth. Do not hand them to a mascot.'],
  ['REMINDER', 'Nobody is inside the suits. Please stop asking.'],
  ['HYGIENE', 'Wash your hands after handling Madame Flan.'],
  ['DAYS SINCE LAST FLATTENING', '0'],
  ['TORCHES', 'Charge yours at the booth. Spare batteries are where you left them. Probably.'],
];
const FONT = "'Arial Narrow', 'Liberation Sans Narrow', 'Helvetica Neue', Arial, sans-serif";
const INK = '#1a1210';

// One mascot as the venue drew it for children: round, waving, in a party hat.
// (x, y) is the ground between its feet; k = 1 makes it about 230 px tall.
function friend(c: CanvasRenderingContext2D, i: number, x: number, y: number, k: number): void {
  const m = MASC[i],
    shade = mixc(m.col, '#000000', 0.4);
  c.save();
  c.translate(x, y);
  c.scale(k, k);
  c.lineWidth = 5;
  c.strokeStyle = INK;
  c.lineJoin = c.lineCap = 'round';
  const ell = (ex: number, ey: number, rx: number, ry: number, fill: string, rot = 0, stroke = true): void => {
    c.beginPath();
    c.ellipse(ex, ey, rx, ry, rot, 0, 7);
    c.fillStyle = fill;
    c.fill();
    if (stroke) c.stroke();
  };
  const eye = (ex: number, ey: number, r: number): void => {
    ell(ex, ey, r, r * 1.15, '#fffdf5');
    ell(ex + r * 0.15, ey + r * 0.2, r * 0.5, r * 0.55, INK, 0, false);
    ell(ex - r * 0.05, ey - r * 0.1, r * 0.18, r * 0.18, '#ffffff', 0, false);
  };
  ell(-36, -8, 24, 12, shade);
  ell(36, -8, 24, 12, shade);
  ell(-64, -82, 15, 32, m.col, 0.45);
  ell(70, -124, 15, 34, m.col, -0.75);
  ell(0, -72, 64, 68, m.col);
  ell(0, -60, 41, 44, m.belly);
  const hy = -158;
  if (m.k === 'toad') {
    ell(-30, hy - 30, 19, 19, m.col);
    ell(30, hy - 30, 19, 19, m.col);
    ell(0, hy, 60, 38, m.col);
    eye(-30, hy - 32, 12);
    eye(30, hy - 32, 12);
    for (const [sx, sy] of [
      [-40, 6],
      [44, -2],
      [-12, -18],
    ])
      ell(sx, hy + sy, 6, 5, shade, 0, false);
    c.beginPath();
    c.arc(0, hy - 6, 40, 0.25, Math.PI - 0.25);
    c.stroke();
  } else {
    ell(-34, hy - 36, 13, 15, m.col);
    ell(34, hy - 36, 13, 15, m.col);
    ell(0, hy, 48, 44, m.col);
    eye(-18, hy - 12, 11);
    eye(18, hy - 12, 11);
    if (m.k === 'hippo') {
      ell(0, hy + 22, 40, 24, mixc(m.col, '#ffffff', 0.25));
      ell(-12, hy + 12, 4, 3, INK, 0, false);
      ell(12, hy + 12, 4, 3, INK, 0, false);
      c.fillStyle = '#fffdf5';
      for (const tx of [-18, 8]) {
        c.fillRect(tx, hy + 34, 10, 11);
        c.strokeRect(tx, hy + 34, 10, 11);
      }
    }
    if (m.k === 'walrus') {
      c.fillStyle = '#fffdf5';
      for (const tx of [-16, 8]) {
        c.beginPath();
        c.moveTo(tx, hy + 24);
        c.lineTo(tx + 8, hy + 24);
        c.lineTo(tx + 4, hy + 62);
        c.closePath();
        c.fill();
        c.stroke();
      }
      ell(-16, hy + 18, 19, 14, m.belly);
      ell(16, hy + 18, 19, 14, m.belly);
      ell(0, hy + 8, 7, 5, INK, 0, false);
    }
    if (m.k === 'rhino') {
      ell(0, hy + 20, 34, 22, mixc(m.col, '#ffffff', 0.2));
      c.fillStyle = '#fffdf5';
      c.beginPath();
      c.moveTo(-10, hy + 8);
      c.lineTo(10, hy + 8);
      c.lineTo(3, hy - 34);
      c.closePath();
      c.fill();
      c.stroke();
      c.beginPath();
      c.arc(0, hy + 20, 18, 0.3, Math.PI - 0.3);
      c.stroke();
    }
  }
  // the hat
  c.fillStyle = ['#e8c832', '#d4418e', '#2ec4c6', '#e86a2a'][i];
  c.beginPath();
  c.moveTo(-20, hy - 40);
  c.lineTo(20, hy - 40);
  c.lineTo(4, hy - 92);
  c.closePath();
  c.fill();
  c.stroke();
  ell(4, hy - 94, 7, 7, '#fffdf5');
  c.restore();
}

// Age a printed thing in place: yellowing, creases, damp, and bites out of the edge.
function age(c: CanvasRenderingContext2D, [x, y, w, h]: Px, rnd: () => number, torn = 1): void {
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  c.globalCompositeOperation = 'multiply';
  c.fillStyle = '#c9b58a';
  c.fillRect(x, y, w, h);
  c.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 6; i++) {
    const g = c.createRadialGradient(x + rnd() * w, y + rnd() * h, 2, x + rnd() * w, y + rnd() * h, w * (0.2 + rnd() * 0.4));
    g.addColorStop(0, '#3a2a1055');
    g.addColorStop(1, '#3a2a1000');
    c.fillStyle = g;
    c.fillRect(x, y, w, h);
  }
  c.strokeStyle = '#00000030';
  c.lineWidth = 1.5;
  for (const f of [0.33, 0.66]) {
    c.beginPath();
    c.moveTo(x, y + h * f + rnd() * 4);
    c.lineTo(x + w, y + h * f + rnd() * 4);
    c.stroke();
  }
  c.globalCompositeOperation = 'destination-out';
  c.fillStyle = '#000';
  for (let i = 0; i < 9 * torn; i++) {
    const side = (rnd() * 4) | 0,
      t = rnd(),
      r = (6 + rnd() * 22) * torn;
    c.beginPath();
    c.arc(x + (side === 0 ? 0 : side === 1 ? w : t * w), y + (side === 2 ? 0 : side === 3 ? h : t * h), r, 0, 7);
    c.fill();
  }
  c.restore();
}
function lines(c: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number): void {
  let line = '',
    n = 0;
  for (const word of text.split(' ')) {
    if (c.measureText(line + word).width > maxW && line) {
      c.fillText(line.trim(), x, y + n++ * lh);
      line = '';
    }
    line += `${word} `;
  }
  c.fillText(line.trim(), x, y + n * lh);
}

function drawArt(): CanvasRenderingContext2D {
  const c = canvas(1024),
    rnd = rand(77);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  MASC.forEach((m, i) => {
    const r = ART[`poster${i}`],
      [x, y, w, h] = r,
      bg = ['#e8c832', '#2ec4c6', '#e86a2a', '#d4418e'][i];
    c.save();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
    c.fillStyle = bg;
    c.fillRect(x, y, w, h);
    c.fillStyle = mixc(bg, '#ffffff', 0.35);
    for (let k = 0; k < 12; k += 2) {
      c.beginPath();
      c.moveTo(x + w / 2, y + 190);
      c.arc(x + w / 2, y + 190, 400, (k * Math.PI) / 6, ((k + 1) * Math.PI) / 6);
      c.fill();
    }
    friend(c, i, x + w / 2, y + 252, 0.78);
    c.fillStyle = '#7a1f1c';
    c.fillRect(x, y, w, 50);
    c.fillRect(x, y + 262, w, 58);
    c.fillStyle = '#fffdf5';
    c.font = `bold 34px ${FONT}`;
    c.fillText(m.name.toUpperCase(), x + w / 2, y + 27, w - 24);
    c.font = `bold 17px ${FONT}`;
    POSTER_LINE[i].split('\n').forEach((l, k, all) => c.fillText(l, x + w / 2, y + 291 + (k - (all.length - 1) / 2) * 20));
    c.restore();
    age(c, r, rnd);
  });
  {
    // the height chart every venue had, with the wrong question on it
    const r = ART.height,
      [x, y, w, h] = r;
    c.fillStyle = '#f0e8d0';
    c.fillRect(x, y, w, h);
    c.fillStyle = INK;
    for (let k = 0; k < 10; k++) c.fillRect(x + 8, y + 20 + k * 30, k % 2 ? 22 : 40, 3);
    c.save();
    c.translate(x + 92, y + h / 2);
    c.rotate(-Math.PI / 2);
    c.font = `bold 22px ${FONT}`;
    c.fillStyle = '#7a1f1c';
    c.fillText('ARE YOU TALLER THAN SQUISH?', 0, 0);
    c.restore();
    friend(c, 2, x + 62, y + 300, 0.3);
    age(c, r, rnd, 0.6);
  }
  {
    // the mural
    const r = ART.mural,
      [x, y, w, h] = r;
    c.save();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
    const sky = c.createLinearGradient(0, y, 0, y + h);
    sky.addColorStop(0, '#6ab0d8');
    sky.addColorStop(1, '#bfe0c8');
    c.fillStyle = sky;
    c.fillRect(x, y, w, h);
    c.fillStyle = '#5a9a4a';
    c.beginPath();
    c.ellipse(x + w / 2, y + h + 60, w * 0.7, 130, 0, 0, 7);
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(x, y + 20);
    c.quadraticCurveTo(x + w / 2, y + 90, x + w, y + 20);
    c.stroke();
    for (let k = 0; k < 20; k++) {
      const t = (k + 0.5) / 20,
        bx = x + t * w,
        by = y + 20 + 70 * 2 * t * (1 - t);
      c.fillStyle = ['#d4418e', '#e8c832', '#2ec4c6', '#e86a2a'][k % 4];
      c.beginPath();
      c.moveTo(bx - 16, by);
      c.lineTo(bx + 16, by);
      c.lineTo(bx, by + 34);
      c.fill();
    }
    [1, 0, 3, 2].forEach((mi, k) => friend(c, mi, x + 150 + k * 240, y + 300, [0.82, 1, 0.9, 0.7][k]));
    for (const [bx, col] of [
      [40, '#d4418e'],
      [520, '#e8c832'],
      [985, '#2ec4c6'],
    ] as [number, string][]) {
      c.strokeStyle = INK;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x + bx, y + 150);
      c.lineTo(x + bx + 6, y + 290);
      c.stroke();
      c.fillStyle = col;
      c.beginPath();
      c.ellipse(x + bx, y + 120, 26, 32, 0, 0, 7);
      c.fill();
      c.stroke();
    }
    c.font = `bold 44px ${FONT}`;
    c.lineWidth = 8;
    c.strokeStyle = '#fffdf5';
    c.fillStyle = '#7a1f1c';
    c.strokeText('EVERY DAY IS YOUR BIRTHDAY', x + w / 2, y + 122);
    c.fillText('EVERY DAY IS YOUR BIRTHDAY', x + w / 2, y + 122);
    c.restore();
    // painted straight on the wall, so it flakes instead of tearing
    const flake = fbm(FIELD, 9, 3, 5),
      img = c.getImageData(x, y, w, h),
      d = img.data;
    for (let py = 0; py < h; py++)
      for (let px = 0; px < w; px++) {
        const f = flake[(((py * FIELD) / h) | 0) * FIELD + ((((px * FIELD) / w) | 0) % FIELD)],
          i = (py * w + px) * 4;
        d[i] *= 0.62;
        d[i + 1] *= 0.6;
        d[i + 2] *= 0.55;
        if (f > 0.6) d[i + 3] = 0;
        else if (f > 0.57) {
          d[i] *= 0.5;
          d[i + 1] *= 0.5;
          d[i + 2] *= 0.5;
        }
      }
    c.putImageData(img, x, y);
    // and somebody has been at the eyes
    c.fillStyle = '#050505';
    for (const [ex, ey] of [
      [374, 128],
      [404, 130],
    ]) {
      c.beginPath();
      c.arc(x + ex, y + ey, 13, 0, 7);
      c.fill();
      c.fillRect(x + ex - 2, y + ey, 4, 40 + rnd() * 30);
    }
  }
  NOTES.forEach(([title, body], i) => {
    const r = ART[`note${i}`],
      [x, y, w, h] = r;
    c.fillStyle = i % 3 === 1 ? '#e8e0a8' : '#eeeade';
    c.fillRect(x + 4, y + 6, w - 8, h - 10);
    c.fillStyle = INK;
    c.font = `bold ${title.length > 14 ? 11 : 15}px ${FONT}`;
    lines(c, title, x + w / 2, y + 26, w - 24, 13);
    c.fillRect(x + 16, y + (title.length > 14 ? 48 : 38), w - 32, 2);
    if (body === '0') {
      c.font = `bold 84px ${FONT}`;
      c.fillStyle = '#a01818';
      c.fillText('0', x + w / 2, y + 104);
    } else {
      c.font = `bold 12px ${FONT}`;
      lines(c, body, x + w / 2, y + 62, w - 26, 15);
    }
    age(c, [x + 4, y + 6, w - 8, h - 10], rnd, 0.35);
    c.fillStyle = '#c8c0a0cc';
    for (const [tx, ty] of [
      [x + 2, y + 2],
      [x + w - 30, y + 2],
    ])
      c.fillRect(tx, ty, 28, 12); // tape
  });
  {
    // stains and marks
    let [x, y, w] = ART.damp;
    for (let i = 0; i < 14; i++) {
      const bx = x + w / 2 + (rnd() - 0.5) * w * 0.5,
        by = y + w / 2 + (rnd() - 0.5) * w * 0.5,
        r = w * (0.12 + rnd() * 0.14);
      const g = c.createRadialGradient(bx, by, r * 0.5, bx, by, r);
      g.addColorStop(0, '#1a140a50');
      g.addColorStop(0.85, '#2a1c0a70');
      g.addColorStop(1, '#2a1c0a00');
      c.fillStyle = g;
      c.fillRect(bx - r, by - r, r * 2, r * 2);
    }
    [x, y, w] = ART.hand;
    c.fillStyle = '#2a0a08c0';
    for (const [hx, hy, a] of [
      [50, 60, -0.2],
      [108, 84, 0.25],
    ]) {
      c.save();
      c.translate(x + hx, y + hy);
      c.rotate(a);
      c.beginPath();
      c.ellipse(0, 0, 17, 21, 0, 0, 7);
      c.fill();
      for (let f = 0; f < 5; f++) {
        c.beginPath();
        c.ellipse(-22 + f * 11, -30 - (f === 0 || f === 4 ? -8 : 6), 4.5, 15, (f - 2) * 0.18, 0, 7);
        c.fill();
      }
      c.fillRect(-9, 12, 18, 60);
      c.restore();
    }
    [x, y, w] = ART.hole;
    c.fillStyle = '#020202';
    c.beginPath();
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * 6.283,
        r = w * (0.38 + rnd() * 0.1);
      c.lineTo(x + w / 2 + Math.cos(a) * r, y + w / 2 + Math.sin(a) * r);
    }
    c.fill();
    c.strokeStyle = '#3a2a1a';
    c.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      c.moveTo(x + w * (0.3 + rnd() * 0.4), y + w * 0.2);
      c.quadraticCurveTo(x + w * rnd(), y + w * 0.6, x + w * (0.3 + rnd() * 0.4), y + w * 0.8);
      c.stroke();
    }
    [x, y, w] = ART.mark;
    c.strokeStyle = '#d8c81ee0';
    c.lineWidth = 9;
    c.lineCap = 'butt';
    c.beginPath();
    c.moveTo(x + 24, y + 24);
    c.lineTo(x + w - 24, y + w - 24);
    c.moveTo(x + w - 24, y + 24);
    c.lineTo(x + 24, y + w - 24);
    c.stroke();
    c.lineWidth = 3;
    c.setLineDash([10, 7]);
    c.beginPath();
    c.arc(x + w / 2, y + w / 2, w / 2 - 8, 0, 7);
    c.stroke();
    c.setLineDash([]);
    [x, y] = ART.tally;
    c.strokeStyle = '#d8d0c0c0';
    c.lineWidth = 2.5;
    c.lineCap = 'round';
    for (let g = 0; g < 7; g++) {
      const gx = x + 14 + (g % 4) * 38,
        gy = y + 14 + ((g / 4) | 0) * 56;
      for (let k = 0; k < 4; k++) {
        c.beginPath();
        c.moveTo(gx + k * 6 + rnd() * 2, gy);
        c.lineTo(gx + k * 6 + rnd() * 2, gy + 40);
        c.stroke();
      }
      c.beginPath();
      c.moveTo(gx - 4, gy + 32);
      c.lineTo(gx + 24, gy + 8);
      c.stroke();
    }
    [x, y, w] = ART.exit;
    c.fillStyle = '#04140a';
    c.fillRect(x, y, w, 64);
    c.fillStyle = '#5dff9a';
    c.font = `bold 44px ${FONT}`;
    c.fillText('EXIT', x + w / 2, y + 34);
    [x, y, w] = ART.scrawl;
    c.fillStyle = '#b01c14d0';
    c.font = `italic bold 30px ${FONT}`;
    c.save();
    c.translate(x + w / 2, y + 48);
    c.rotate(-0.06);
    c.fillText('IT WAVED BACK', 0, 0);
    c.restore();
    let hgt: number;
    [x, y, w, hgt] = ART.scallop;
    c.fillStyle = '#5a1418';
    c.fillRect(x, y, w, hgt * 0.45);
    for (let i = 0; i < 8; i++) {
      c.beginPath();
      c.arc(x + ((i + 0.5) * w) / 8, y + hgt * 0.42, w / 16, 0, Math.PI);
      c.fill();
    }
    c.strokeStyle = '#b89a2a';
    c.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      c.beginPath();
      c.arc(x + ((i + 0.5) * w) / 8, y + hgt * 0.42, w / 16 - 3, 0, Math.PI);
      c.stroke();
    }
    [x, y, w, hgt] = ART.hazard;
    c.save();
    c.beginPath();
    c.rect(x, y, w, hgt);
    c.clip();
    c.fillStyle = '#c9a81e';
    c.fillRect(x, y, w, hgt);
    c.fillStyle = '#101010';
    for (let i = -1; i < 9; i++) {
      c.beginPath();
      c.moveTo(x + i * 32, y + hgt);
      c.lineTo(x + i * 32 + 16, y + hgt);
      c.lineTo(x + i * 32 + 48, y);
      c.lineTo(x + i * 32 + 32, y);
      c.fill();
    }
    c.restore();
  }
  return c;
}

// Room names in stencil capitals, two columns of five. Each cell is 512 by 100.
export const NAME_CELL: [number, number] = [512, 100];
function drawNames(): { c: CanvasRenderingContext2D; widths: number[] } {
  const c = canvas(1024, 512),
    rnd = rand(5),
    widths: number[] = [];
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = '#e6dcc0';
  ROOMS3.forEach((room, i) => {
    const x = (i % 2) * 512 + 256,
      y = (i >> 1) * 100 + 52;
    c.font = `bold 78px ${FONT}`;
    const text = room.name.toUpperCase(),
      w = c.measureText(text).width,
      k = Math.min(1, 490 / w);
    c.font = `bold ${(78 * k) | 0}px ${FONT}`;
    c.fillText(text, x, y);
    widths.push(Math.min(490, w) + 12);
  });
  // stencil bridges and paint that did not take
  c.globalCompositeOperation = 'destination-out';
  for (let x = 9; x < 1024; x += 19) c.fillRect(x, 0, 2.5, 512);
  for (let i = 0; i < 2600; i++) {
    c.globalAlpha = rnd();
    c.fillRect(rnd() * 1024, rnd() * 512, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  return { c, widths };
}

export function art(): Pics {
  const tex = (ctx: CanvasRenderingContext2D): THREE.CanvasTexture => {
    const t = new THREE.CanvasTexture(ctx.canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const names = drawNames();
  return { art: tex(drawArt()), names: tex(names.c), nameWidth: names.widths };
}
// A rectangle of a canvas as [u0, v0, u1, v1].
export const uvOf = ([x, y, w, h]: Px, W = 1024, H = 1024): UV => [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H];
