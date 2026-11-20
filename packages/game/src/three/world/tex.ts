// Painting textures with the 2D canvas. A surface is three canvases painted
// side by side: colour, height (turned into a normal map) and roughness.
// Colour is 512 px and the other two 256, which is what an integrated GPU can
// hold for twenty-odd surfaces.
import { defined } from '@thick-shift/sim/check';
import * as THREE from 'three';
import { context2d } from '../../dom';

// What paint() is given. look: { col, rough, bump (normal strength), seed, tall }.
export interface Look {
  col: string;
  rough: number;
  bump: number;
  seed: number;
  tall?: boolean;
}
// What a painter draws with (paint's p). Each helper takes a colour, a height and a roughness; null leaves that canvas alone.
export interface Painter {
  s: number;
  c: CanvasRenderingContext2D;
  h: CanvasRenderingContext2D;
  r: CanvasRenderingContext2D;
  rnd: () => number;
  fill(x: number, y: number, w: number, hh: number, col: string | null, hv: number | null, rv: number | null): void;
  line(pts: [number, number][], w: number, col: string | null, hv: number | null, rv: number | null, alpha?: number): void;
  blob(x: number, y: number, rad: number, col: string | null, alpha: number, hv: number | null, rv: number | null): void;
  wash(field: Float32Array, lo: number, hi: number, col: string | null, alpha: number, hv: number | null, rv: number | null): void;
  speck(n: number, cols: string[], size: number, alpha: number): void;
}
// paint's result: the maps as MeshStandardMaterial parameters.
export interface Maps {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

// A seeded random number generator, so the building looks the same every night.
export const rand = (seed: number) => (): number => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rgb = (hex: string): [number, number, number] => {
  const byte = (at: number): number => parseInt(hex.slice(at, at + 2), 16);
  return [byte(1), byte(3), byte(5)];
};
// Entry i of a list that repeats: list[i % list.length].
export const cycle = <T>(list: readonly T[], i: number): T => defined(list[i % list.length], 'an entry of an empty list');
export const grey = (v: number): string => {
  const g = Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${g},${g},${g})`;
};
export const mixc = (a: string, b: string, t: number): string => {
  const [r0, g0, b0] = rgb(a),
    [r1, g1, b1] = rgb(b),
    hex = (u: number, v: number): string =>
      Math.round(u + (v - u) * t)
        .toString(16)
        .padStart(2, '0');
  return `#${hex(r0, r1)}${hex(g0, g1)}${hex(b0, b1)}`;
};

// Fractal noise that tiles, n by n, values 0 to 1. cells: lumps across the tile at the coarsest octave.
export function fbm(n: number, cells: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(n * n),
    r = rand(seed);
  let amp = 1,
    total = 0;
  for (let o = 0; o < octaves; o++, cells *= 2, amp *= 0.5) {
    const g = Float32Array.from({ length: cells * cells }, r),
      k = cells / n,
      // x0, x1 < cells and y0, y1 < cells, so every lattice point asked for is inside g
      at = (x: number, y: number): number => defined(g[y * cells + x], 'a noise lattice point');
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const fx = x * k,
          fy = y * k,
          x0 = fx | 0,
          y0 = fy | 0,
          x1 = (x0 + 1) % cells,
          y1 = (y0 + 1) % cells;
        const tx = fx - x0,
          ty = fy - y0,
          sx = tx * tx * (3 - 2 * tx),
          sy = ty * ty * (3 - 2 * ty);
        const a = at(x0, y0),
          b = at(x1, y0),
          c = at(x0, y1),
          d = at(x1, y1),
          i = y * n + x;
        out[i] = defined(out[i], 'a noise texel') + amp * (a + (b - a) * sx + (c + (d - c) * sx - a - (b - a) * sx) * sy);
      }
    total += amp;
  }
  for (const [i, v] of out.entries()) out[i] = v / total;
  return out;
}
export const FIELD = 256; // the size every noise field is made at

export function canvas(w: number, h = w): CanvasRenderingContext2D {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return context2d(cv, { willReadFrequently: true });
}

// Lay a colour over a canvas wherever a noise field is between lo and hi,
// fading in across that range. The stains, wear and peeling all come from this.
const scratch = canvas(FIELD);
// roll: how far to slide the field first, so two surfaces do not wear in the same places.
function wash(ctx: CanvasRenderingContext2D, field: Float32Array, lo: number, hi: number, col: string, alpha: number, roll: number): void {
  const img = scratch.createImageData(FIELD, FIELD),
    d = img.data,
    [r, g, b] = rgb(col);
  for (let i = 0; i < field.length; i++) {
    const t = Math.max(0, Math.min(1, (defined(field[(i + roll) % field.length], 'a noise texel') - lo) / (hi - lo)));
    d[i * 4] = r;
    d[i * 4 + 1] = g;
    d[i * 4 + 2] = b;
    d[i * 4 + 3] = t * t * (3 - 2 * t) * 255;
  }
  scratch.putImageData(img, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.drawImage(scratch.canvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}
const hexGrey = (v: number): string => {
  const g = Math.round(Math.max(0, Math.min(1, v)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${g}${g}${g}`;
};

function texOf(ctx: CanvasRenderingContext2D, srgb: boolean, wrapT: THREE.Wrapping): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(ctx.canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = wrapT;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The slope of a height canvas as a normal map. The canvas tiles, so the edges wrap.
function normalFrom(h: CanvasRenderingContext2D, strength: number, wrapT: THREE.Wrapping): THREE.CanvasTexture {
  const n = h.canvas.width,
    src = h.getImageData(0, 0, n, n).data,
    out = canvas(n),
    img = out.createImageData(n, n),
    d = img.data;
  const at = (x: number, y: number): number => defined(src[(((y + n) % n) * n + ((x + n) % n)) * 4], 'a height pixel');
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      // canvas y runs down and texture v runs up, hence the sign of the second term
      const dx = ((at(x - 1, y) - at(x + 1, y)) / 255) * strength,
        dy = ((at(x, y + 1) - at(x, y - 1)) / 255) * strength,
        k = 1 / Math.hypot(dx, dy, 1),
        i = (y * n + x) * 4;
      d[i] = (dx * k * 0.5 + 0.5) * 255;
      d[i + 1] = (dy * k * 0.5 + 0.5) * 255;
      d[i + 2] = (k * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  out.putImageData(img, 0, 0);
  return texOf(out, false, wrapT);
}

// Paint a surface. look: { col, rough, bump (normal strength), seed, tall }.
// tall: a wall texture, which repeats along the wall but not up it.
// draw gets p: { s, c, h, r, rnd } and the helpers below. Heights and
// roughness are 0 to 1; a height of .5 is the untouched surface.
// Returns the maps as MeshStandardMaterial parameters.
export function paint(look: Look, draw: (p: Painter) => void): Maps {
  const s = 512,
    c = canvas(s),
    h = canvas(s / 2),
    r = canvas(s / 2),
    wrapT = look.tall ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  h.scale(0.5, 0.5);
  r.scale(0.5, 0.5);
  c.fillStyle = look.col;
  h.fillStyle = grey(0.5);
  r.fillStyle = grey(look.rough);
  for (const ctx of [c, h, r]) ctx.fillRect(0, 0, s, s);
  const roll = (look.seed * 7919) % (FIELD * FIELD);
  const on = (col: string | null, hv: number | null, rv: number | null, fn: (ctx: CanvasRenderingContext2D) => void): void => {
    for (const [ctx, v] of [
      [c, col],
      [h, hv == null ? null : grey(hv)],
      [r, rv == null ? null : grey(rv)],
    ] satisfies [CanvasRenderingContext2D, string | null][])
      if (v != null) {
        ctx.fillStyle = ctx.strokeStyle = v;
        fn(ctx);
      }
  };
  const p: Painter = {
    s,
    c,
    h,
    r,
    rnd: rand(look.seed),
    // Each helper takes a colour, a height and a roughness; pass null to leave that canvas alone.
    fill(x, y, w, hh, col, hv, rv) {
      on(col, hv, rv, ctx => ctx.fillRect(x, y, w, hh));
    },
    line(pts, w, col, hv, rv, alpha = 1) {
      on(col, hv, rv, ctx => {
        ctx.globalAlpha = alpha;
        ctx.lineWidth = w;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        pts.forEach(([x, y], i) => {
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
    },
    // A soft round mark, repeated across the edges so the texture still tiles.
    blob(x, y, rad, col, alpha, hv, rv) {
      for (const [ctx, v] of [
        [c, col],
        [h, hv == null ? null : hexGrey(hv)],
        [r, rv == null ? null : hexGrey(rv)],
      ] satisfies [CanvasRenderingContext2D, string | null][])
        if (v != null)
          for (const ox of [-s, 0, s])
            for (const oy of look.tall ? [0] : [-s, 0, s]) {
              if (x + ox + rad < 0 || x + ox - rad > s || y + oy + rad < 0 || y + oy - rad > s) continue;
              const g = ctx.createRadialGradient(x + ox, y + oy, rad * 0.15, x + ox, y + oy, rad);
              g.addColorStop(0, v);
              g.addColorStop(1, `${v}00`);
              ctx.globalAlpha = alpha;
              ctx.fillStyle = g;
              ctx.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
              ctx.globalAlpha = 1;
            }
    },
    wash(field, lo, hi, col, alpha, hv, rv) {
      if (col != null) wash(c, field, lo, hi, col, alpha, roll);
      if (hv != null) wash(h, field, lo, hi, hexGrey(hv), alpha, roll);
      if (rv != null) wash(r, field, lo, hi, hexGrey(rv), alpha, roll);
    },
    // Small flecks of the given colours.
    speck(n, cols, size, alpha) {
      for (let i = 0; i < n; i++) {
        c.globalAlpha = alpha * (0.4 + p.rnd() * 0.6);
        c.fillStyle = cycle(cols, i);
        const d = size * (0.4 + p.rnd());
        c.fillRect(p.rnd() * s, p.rnd() * s, d, d);
      }
      c.globalAlpha = 1;
    },
  };
  draw(p);
  return { map: texOf(c, true, wrapT), normalMap: normalFrom(h, look.bump, wrapT), roughnessMap: texOf(r, false, wrapT) };
}
