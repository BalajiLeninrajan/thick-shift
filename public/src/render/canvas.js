// The canvas, its high-DPI scaling, and the small drawing helpers every scene uses.
import { W, H, P } from '../config.js';

export const cv = document.getElementById('c');
const screen = cv.getContext('2d');
// The context every helper draws into. bake() points it at an offscreen
// canvas for a moment; importers see the swap through the live binding.
export let c = screen;
export const TAU = Math.PI * 2;

// Draw something expensive once into a w x h sprite (logical units, res pixels
// per unit) and get the canvas back. Draw it later with c.drawImage(sprite, x, y, w, h).
export function bake(w, h, res, draw) {
  const off = document.createElement('canvas');
  off.width = Math.ceil(w * res); off.height = Math.ceil(h * res);
  withTarget(off.getContext('2d'), () => { c.scale(res, res); draw(); });
  return off;
}

// Run draw() with every helper pointed at another 2D context.
export function withTarget(ctx, draw) {
  const prev = c;
  c = ctx;
  try { draw(); } finally { c = prev; }
}

let scale = 1;
// Match the backing store to the displayed size so art stays sharp.
export function fitCanvas() {
  const shown = cv.getBoundingClientRect().width || W;
  scale = Math.max(1, Math.min(2, shown * (devicePixelRatio || 1) / W));
  const w = Math.round(W * scale), h = Math.round(H * scale);
  if (cv.width !== w) { cv.width = w; cv.height = h; }
}
export const pxScale = () => scale;
export const resetTransform = () => c.setTransform(scale, 0, 0, scale, 0, 0);

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const mixCache = new Map();
// Blend two hex colors. t = 0 gives a, t = 1 gives b.
export function mix(a, b, t) {
  const key = a + b + t;
  let v = mixCache.get(key);
  if (!v) {
    const A = rgb(a), B = rgb(b);
    v = '#' + A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, '0')).join('');
    mixCache.set(key, v);
  }
  return v;
}
export const rgba = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };

// Stable pseudo-random number in [0, 1) for a given seed.
export const hash = n => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
export const lerp = (a, b, t) => a + (b - a) * t;
export const font = (weight, size) => `${weight} ${size}px Inter, system-ui, sans-serif`;

export function ell(x, y, rx, ry, fill, rot = 0) {
  c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, TAU); c.fillStyle = fill; c.fill();
}
export function rect(x, y, w, h, fill) { c.fillStyle = fill; c.fillRect(x, y, w, h); }
export function rrect(x, y, w, h, r, fill) {
  c.beginPath(); c.roundRect(x, y, w, h, r); c.fillStyle = fill; c.fill();
}
export function poly(pts, fill) {
  c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); c.fillStyle = fill; c.fill();
}
export function vgrad(y0, y1, stops) {
  const g = c.createLinearGradient(0, y0, 0, y1);
  stops.forEach(([t, col]) => g.addColorStop(t, col));
  return g;
}
// Additive light blob. One small sprite per color, stretched to size.
const glowSprites = new Map();
export function glow(x, y, r, col, a) {
  let s = glowSprites.get(col);
  if (!s) {
    s = bake(128, 128, 1, () => {
      const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, rgba(col, 1)); g.addColorStop(1, rgba(col, 0));
      c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    });
    glowSprites.set(col, s);
  }
  c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = Math.max(0, Math.min(1, a));
  c.drawImage(s, x - r, y - r, r * 2, r * 2); c.restore();
}

// Darkened corners over the whole frame. a is the darkness at the corners.
let vignetteSprite = null;
export function vignette(a) {
  vignetteSprite ||= bake(160, 90, 1, () => {
    const g = c.createRadialGradient(80, 45, 28, 80, 45, 104);
    g.addColorStop(0, rgba(P.ink, 0)); g.addColorStop(1, rgba(P.ink, 1));
    c.fillStyle = g; c.fillRect(0, 0, 160, 90);
  });
  c.save(); c.globalAlpha = a; c.drawImage(vignetteSprite, 0, 0, W, H); c.restore();
}
export function text(str, x, y, { size = 12, weight = 600, col = P.text, align = 'left' } = {}) {
  c.font = font(weight, size); c.textAlign = align; c.fillStyle = col; c.fillText(str, x, y);
}
export const clear = col => rect(0, 0, W, H, col);
