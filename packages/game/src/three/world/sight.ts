// Where light and sight can travel in the building, on a grid, and from that
// which rooms can be seen from where a guard stands. Nothing in three.js culls
// what is behind a wall, so without this a guard in the booth facing north
// would draw the furniture of every room north of it.

import { defined } from '@thick-shift/sim/check';
import type { Doorway, Room } from '@thick-shift/sim/map';
import { DOORWAYS, ROOMS3 } from '@thick-shift/sim/map';

const G = 4,
  W = 42 * G,
  H = 44 * G; // grid cells per metre (walls are two cells thick), and the building's size in cells
const FAR = 30; // fog and the torch's reach leave nothing to see past this many metres
const RAYS = 180; // directions looked in from each point: two degrees apart

// Room r of ROOMS3, for an index that names a room by the map's own rules (a fixture's room, a table kept per room).
export const roomData = (r: number): Room => defined(ROOMS3[r], `room ${r}`);

// The room a point is in, or -1 outside every room.
export const roomOf = (x: number, z: number): number => {
  for (const [i, room] of ROOMS3.entries()) for (const [x0, z0, x1, z1] of room.rects) if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return i;
  return -1;
};
const doorAt = (x: number, z: number, pad = 0): Doorway | undefined =>
  DOORWAYS.find(({ rect: [x0, z0, x1, z1] }) => x >= x0 - pad && x <= x1 + pad && z >= z0 - pad && z <= z1 + pad);
// Open floor: a room or a doorway, ignoring furniture and shut doors.
export const open = (x: number, z: number): boolean => roomOf(x, z) >= 0 || !!doorAt(x, z);

// Each cell: 0 for wall, 1 for a doorway, 2 + r for room r.
const grid = new Uint8Array(W * H);
for (let j = 0; j < H; j++)
  for (let i = 0; i < W; i++) {
    const x = (i + 0.5) / G,
      z = (j + 0.5) / G,
      r = roomOf(x, z);
    grid[j * W + i] = r >= 0 ? 2 + r : doorAt(x, z) ? 1 : 0;
  }
// Is the straight line between two points clear of walls?
export function sees(ax: number, az: number, bx: number, bz: number): boolean {
  const n = Math.ceil(Math.hypot(bx - ax, bz - az) * G);
  for (let k = 1; k < n; k++) {
    const t = k / n;
    if (!grid[(((az + (bz - az) * t) * G) | 0) * W + (((ax + (bx - ax) * t) * G) | 0)]) return false;
  }
  return true;
}

// How far it is from a point to the first wall in a direction (dx, dz, of unit length), up to max metres.
export function reach(x: number, z: number, dx: number, dz: number, max: number): number {
  for (let d = 0; d < max; d += 1 / G) {
    const px = (x + dx * d) * G,
      pz = (z + dz * d) * G;
    if (px < 0 || px >= W || pz < 0 || pz >= H || !grid[(pz | 0) * W + (px | 0)]) return d;
  }
  return max;
}

// The rooms that might be in view from a point: a Set of room indices.
// Worked out once for each CELL-metre square of floor, by looking all round
// from its corners and its middle, and kept. A room seen only through a gap
// narrower than the rays are apart can be missed, so something glimpsed
// through two doorways may appear a step late.
const CELL = 2,
  cells = new Map<number, Set<number>>();
export function roomsSeenFrom(x: number, z: number): Set<number> {
  const cx = Math.floor(x / CELL),
    cz = Math.floor(z / CELL),
    key = cx * 64 + cz;
  const known = cells.get(key);
  if (known) return known;
  let mask = 0;
  for (const [u, v] of [
    [0.5, 0.5],
    [0.1, 0.1],
    [0.9, 0.1],
    [0.1, 0.9],
    [0.9, 0.9],
  ] as const) {
    const ax = (cx + u) * CELL,
      az = (cz + v) * CELL,
      door = doorAt(ax, az, 0.4);
    if (!open(ax, az)) continue;
    if (door) mask |= (1 << door.a) | (1 << door.b);
    for (let k = 0; k < RAYS; k++) {
      const a = (k / RAYS) * Math.PI * 2,
        dx = Math.cos(a),
        dz = Math.sin(a); // one cell per step
      for (let px = ax * G, pz = az * G, n = 0; n < FAR * G && px >= 0 && px < W && pz >= 0 && pz < H; n++, px += dx, pz += dz) {
        const cell = grid[(pz | 0) * W + (px | 0)];
        if (!cell) break;
        if (cell > 1) mask |= 1 << (cell - 2);
      }
    }
  }
  const seen = new Set(ROOMS3.map((_, i) => i).filter(i => (mask >> i) & 1));
  cells.set(key, seen);
  return seen;
}
