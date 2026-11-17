// Painting textures with the 2D canvas. A surface is three canvases painted
// side by side: colour, height (turned into a normal map) and roughness.
// Colour is 512 px and the other two 256, which is what an integrated GPU can
// hold for twenty-odd surfaces.
import * as THREE from 'three';

// A seeded random number generator, so the building looks the same every night.
export const rand = seed => () => {
  seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
export const grey = v => { const g = Math.round(Math.max(0, Math.min(1, v)) * 255); return `rgb(${g},${g},${g})`; };
export const mixc = (a, b, t) => { const p = rgb(a), q = rgb(b); return '#' + p.map((v, i) => Math.round(v + (q[i] - v) * t).toString(16).padStart(2, '0')).join(''); };

// Fractal noise that tiles, n by n, values 0 to 1. cells: lumps across the tile at the coarsest octave.
export function fbm(n, cells, octaves, seed) {
  const out = new Float32Array(n * n), r = rand(seed);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++, cells *= 2, amp *= .5) {
    const g = Float32Array.from({ length: cells * cells }, r), k = cells / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const fx = x * k, fy = y * k, x0 = fx | 0, y0 = fy | 0, x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
      const tx = fx - x0, ty = fy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = g[y0 * cells + x0], b = g[y0 * cells + x1], c = g[y1 * cells + x0], d = g[y1 * cells + x1];
      out[y * n + x] += amp * (a + (b - a) * sx + (c + (d - c) * sx - a - (b - a) * sx) * sy);
    }
    total += amp;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}
export const FIELD = 256;   // the size every noise field is made at

export function canvas(w, h = w) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  return cv.getContext('2d', { willReadFrequently: true });
}

// Lay a colour over a canvas wherever a noise field is between lo and hi,
// fading in across that range. The stains, wear and peeling all come from this.
const scratch = canvas(FIELD);
// roll: how far to slide the field first, so two surfaces do not wear in the same places.
function wash(ctx, field, lo, hi, col, alpha, roll) {
  const img = scratch.createImageData(FIELD, FIELD), d = img.data, [r, g, b] = rgb(col);
  for (let i = 0; i < field.length; i++) {
    const t = Math.max(0, Math.min(1, (field[(i + roll) % field.length] - lo) / (hi - lo)));
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = t * t * (3 - 2 * t) * 255;
  }
  scratch.putImageData(img, 0, 0);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha;
  ctx.drawImage(scratch.canvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}
const hexGrey = v => { const g = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0'); return '#' + g + g + g; };

function texOf(ctx, srgb, wrapT) {
  const t = new THREE.CanvasTexture(ctx.canvas);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = wrapT; t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The slope of a height canvas as a normal map. The canvas tiles, so the edges wrap.
function normalFrom(h, strength, wrapT) {
  const n = h.canvas.width, src = h.getImageData(0, 0, n, n).data, out = canvas(n), img = out.createImageData(n, n), d = img.data;
  const at = (x, y) => src[(((y + n) % n) * n + (x + n) % n) * 4];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    // canvas y runs down and texture v runs up, hence the sign of the second term
    const dx = (at(x - 1, y) - at(x + 1, y)) / 255 * strength, dy = (at(x, y + 1) - at(x, y - 1)) / 255 * strength, k = 1 / Math.hypot(dx, dy, 1), i = (y * n + x) * 4;
    d[i] = (dx * k * .5 + .5) * 255; d[i + 1] = (dy * k * .5 + .5) * 255; d[i + 2] = (k * .5 + .5) * 255; d[i + 3] = 255;
  }
  out.putImageData(img, 0, 0);
  return texOf(out, false, wrapT);
}

// Paint a surface. look: { col, rough, bump (normal strength), seed, tall }.
// tall: a wall texture, which repeats along the wall but not up it.
// draw gets p: { s, c, h, r, rnd } and the helpers below. Heights and
// roughness are 0 to 1; a height of .5 is the untouched surface.
// Returns the maps as MeshStandardMaterial parameters.
export function paint(look, draw) {
  const s = 512, c = canvas(s), h = canvas(s / 2), r = canvas(s / 2), wrapT = look.tall ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  h.scale(.5, .5); r.scale(.5, .5);
  c.fillStyle = look.col; h.fillStyle = grey(.5); r.fillStyle = grey(look.rough);
  for (const ctx of [c, h, r]) ctx.fillRect(0, 0, s, s);
  const roll = look.seed * 7919 % (FIELD * FIELD);
  const on = (col, hv, rv, fn) => { for (const [ctx, v] of [[c, col], [h, hv == null ? null : grey(hv)], [r, rv == null ? null : grey(rv)]]) if (v != null) { ctx.fillStyle = ctx.strokeStyle = v; fn(ctx); } };
  const p = {
    s, c, h, r, rnd: rand(look.seed),
    // Each helper takes a colour, a height and a roughness; pass null to leave that canvas alone.
    fill(x, y, w, hh, col, hv, rv) { on(col, hv, rv, ctx => ctx.fillRect(x, y, w, hh)); },
    line(pts, w, col, hv, rv, alpha = 1) {
      on(col, hv, rv, ctx => { ctx.globalAlpha = alpha; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); ctx.globalAlpha = 1; });
    },
    // A soft round mark, repeated across the edges so the texture still tiles.
    blob(x, y, rad, col, alpha, hv, rv) {
      for (const [ctx, v] of [[c, col], [h, hv == null ? null : hexGrey(hv)], [r, rv == null ? null : hexGrey(rv)]]) if (v != null) for (const ox of [-s, 0, s]) for (const oy of look.tall ? [0] : [-s, 0, s]) {
        if (x + ox + rad < 0 || x + ox - rad > s || y + oy + rad < 0 || y + oy - rad > s) continue;
        const g = ctx.createRadialGradient(x + ox, y + oy, rad * .15, x + ox, y + oy, rad);
        g.addColorStop(0, v); g.addColorStop(1, v + '00');
        ctx.globalAlpha = alpha; ctx.fillStyle = g; ctx.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2); ctx.globalAlpha = 1;
      }
    },
    wash(field, lo, hi, col, alpha, hv, rv) {
      if (col != null) wash(c, field, lo, hi, col, alpha, roll);
      if (hv != null) wash(h, field, lo, hi, hexGrey(hv), alpha, roll);
      if (rv != null) wash(r, field, lo, hi, hexGrey(rv), alpha, roll);
    },
    // Small flecks of the given colours.
    speck(n, cols, size, alpha) {
      for (let i = 0; i < n; i++) { c.globalAlpha = alpha * (.4 + p.rnd() * .6); c.fillStyle = cols[i % cols.length]; const d = size * (.4 + p.rnd()); c.fillRect(p.rnd() * s, p.rnd() * s, d, d); }
      c.globalAlpha = 1;
    },
  };
  draw(p);
  return { map: texOf(c, true, wrapT), normalMap: normalFrom(h, look.bump, wrapT), roughnessMap: texOf(r, false, wrapT) };
}
