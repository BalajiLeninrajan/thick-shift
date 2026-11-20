// The Depot as geometry: rooms, doorways, the things on the walls, and the
// questions both the host simulation and the renderer ask about them (can I
// stand here, can I see that, how do I walk there). No three.js in this file;
// the host runs it without a renderer.
//
// Metres. x runs east, z runs south, so the plan below reads like a map.
// The building:
//
//   z 0   +-----------Stage-----------+------Backstage------+
//         |                           |               (gen) |
//   z 11  +------+---------+----------+----------+----------+
//         |      |                    |                     |
//         |Arcade|      Main Hall     |       Kitchen       |
//         |      |                    |                     |
//   z 25  +-+--+-+---+----------------+--+-------+--+----+--+
//           |W |     |     Snack Bar     |          |E   |
//           |e |     +--+----------------+          |a   |
//           |s |        |   Ducts   |               |s   |
//           |t +--------+---+---V---+---+-----------+t   |
//           |  Hall     L     Booth     R       Hall     |
//   z 44    +-----------+---------------+----------------+
//
// The answers depend only on the building, so the caches below (the obstacle buckets, the waypoint graph and the
// last rect walkable() found a point in) are kept here rather than by the caller. None of them changes an answer.

import { DRESSING, obstacles } from './dressing.ts';
import type { DoorKey, Doors, Point, Rect } from './types.ts';

export const PLAYER_R = 0.35,
  MASCOT_R = 0.7;
export const EYE = 1.65,
  DOOR_H = 3;

// rects: [x0, z0, x1, z1]. A room with two overlaps them so you can walk from one into the other.
// h: ceiling height.
export interface Room {
  name: string;
  h: number;
  rects: Rect[];
}
// A doorway is the hole through the half-metre wall between two rooms.
// axis: the direction you walk through it. key: one of the booth's three
// doors, which can be shut. h: lintel height.
export interface Doorway {
  a: number;
  b: number;
  rect: Rect;
  axis: 'x' | 'z';
  h?: number;
  key?: DoorKey;
}
// A thing with a place. face: the way the thing looks out from its wall, as a yaw (0 faces south, +z).
export interface Fixture {
  room: number;
  x: number;
  z: number;
  face: number;
}
// A place to hide. x, z: the locker itself. at: where a guard stands to step in, in front of its doors.
export interface Hide extends Fixture {
  at: Point;
}
// A point and the way something there faces.
export interface Pose extends Point {
  yaw: number;
}
// A stretch of wall, as seen from inside its room. (nx, nz) points into the room; y0 is where it starts above the floor.
export interface Wall {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  nx: number;
  nz: number;
  y0: number;
  h: number;
  room: number;
}
// A piece of floor and ceiling. A doorway's has room -1 and the doorway in door.
export interface Slab {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  h: number;
  room: number;
  door?: Doorway;
}
// A waypoint. door: the doorway it stands beside, for the two either side of one.
export interface NavNode extends Point {
  room: number;
  door?: Doorway;
}
// A way from one waypoint to another: to, its index, and d, how far. key: the booth door it goes through. duct: it
// is inside the ducts, where only Squish goes.
export interface NavLink {
  to: number;
  d: number;
  key?: DoorKey;
  duct?: boolean;
}
export interface Nav {
  nodes: NavNode[];
  links: NavLink[][];
}
// What route() is asked. doors: shut doors block the way. ducts: may it use the ducts. r: the walker's radius.
export interface RouteOptions {
  doors?: Doors;
  ducts?: boolean;
  r?: number;
}
// What route() answers. blocked: the key of the shut door the route stops in front of.
export interface Route {
  path: Point[];
  blocked?: DoorKey;
}

// Room indices: 0 to 8 are the rooms outside, 9 is the booth.
export const BOOTH = 9,
  DUCTS = 8;
export const ROOMS3: Room[] = [
  { name: 'Storage Stage', h: 5.2, rects: [[10, 0, 27, 11]] },
  { name: 'Backstage', h: 3.8, rects: [[27.5, 0, 42, 11]] },
  { name: 'Arcade', h: 3.8, rects: [[0, 11.5, 11.5, 25]] },
  { name: 'Main Hall', h: 4.4, rects: [[12, 11.5, 27, 25]] },
  { name: 'Kitchen', h: 3.6, rects: [[27.5, 11.5, 42, 25]] },
  {
    name: 'West Hall',
    h: 3.2,
    rects: [
      [2, 25.5, 6, 42.5],
      [2, 38.5, 14.5, 42.5],
    ],
  },
  { name: 'Snack Bar', h: 3.6, rects: [[13, 25.5, 31, 33]] },
  {
    name: 'East Hall',
    h: 3.2,
    rects: [
      [36, 25.5, 40, 42.5],
      [27.5, 38.5, 40, 42.5],
    ],
  },
  { name: 'Ducts', h: 2.3, rects: [[14, 33.5, 26, 36]] },
  { name: 'Security Booth', h: 3.1, rects: [[15, 36.5, 27, 44]] },
];

export const DOORWAYS: Doorway[] = [
  { a: 0, b: 1, rect: [27, 4, 27.5, 6.6], axis: 'x' },
  { a: 0, b: 3, rect: [18, 11, 20.6, 11.5], axis: 'z' },
  { a: 1, b: 4, rect: [34, 11, 36.6, 11.5], axis: 'z' },
  { a: 2, b: 3, rect: [11.5, 17, 12, 19.6], axis: 'x' },
  { a: 3, b: 4, rect: [27, 17, 27.5, 19.6], axis: 'x' },
  { a: 2, b: 5, rect: [2.7, 25, 5.3, 25.5], axis: 'z' },
  { a: 3, b: 6, rect: [18, 25, 20.6, 25.5], axis: 'z' },
  { a: 4, b: 6, rect: [28, 25, 30.6, 25.5], axis: 'z' },
  { a: 4, b: 7, rect: [36.7, 25, 39.3, 25.5], axis: 'z' },
  { a: 6, b: 8, rect: [15, 33, 16.8, 33.5], axis: 'z', h: 2 },
  { a: 8, b: 9, rect: [22, 36, 23.8, 36.5], axis: 'z', h: 2, key: 'V' },
  { a: 5, b: 9, rect: [14.5, 39.2, 15, 41.8], axis: 'x', key: 'L' },
  { a: 9, b: 7, rect: [27, 39.2, 27.5, 41.8], axis: 'x', key: 'R' },
];

/* ---------- things with a place ---------- */

// Breaker boxes, where faults break out (sim.ts breakOut): one in each room outside the booth and the ducts, and
// a second in four of the big rooms.
export const BOXES: Fixture[] = [
  { room: 0, x: 14.5, z: 10.95, face: Math.PI }, // by the door, not in the corner beside where two of them stand
  { room: 1, x: 41.95, z: 8.5, face: -Math.PI / 2 },
  { room: 2, x: 0.05, z: 14, face: Math.PI / 2 },
  { room: 3, x: 23, z: 11.55, face: 0 },
  { room: 4, x: 41.95, z: 21, face: -Math.PI / 2 },
  { room: 5, x: 2.05, z: 33, face: Math.PI / 2 },
  { room: 6, x: 30.95, z: 31, face: -Math.PI / 2 },
  { room: 7, x: 39.95, z: 32, face: -Math.PI / 2 },
  { room: 0, x: 10.05, z: 5, face: Math.PI / 2 },
  { room: 2, x: 8, z: 24.95, face: Math.PI },
  { room: 3, x: 23.5, z: 24.95, face: Math.PI },
  { room: 4, x: 31.7, z: 24.95, face: Math.PI },
];
// The generator is the point a guard cranks it from; the machine stands behind that, in the booth's south-west corner beside the charger.
export const GENERATOR: Fixture = { room: 9, x: 16, z: 42.4, face: Math.PI };
export const CHARGER: Fixture = { room: 9, x: 21, z: 43.95, face: Math.PI };
export const WALL_MAP: Fixture = { room: 9, x: 18.5, z: 36.55, face: 0 };
// The button for each booth door, on the wall inside the booth beside it.
export const PANELS: Record<DoorKey, Point & { face: number }> = {
  L: { x: 15.05, z: 38.6, face: Math.PI / 2 },
  R: { x: 26.95, z: 38.6, face: -Math.PI / 2 },
  V: { x: 24.5, z: 36.55, face: 0 },
};
// Where a spare battery can turn up.
export const BATTERY_SPOTS: Point[] = [
  { x: 12, z: 9.5 },
  { x: 25, z: 1.5 },
  { x: 30, z: 9 },
  { x: 1.5, z: 23.5 },
  { x: 9.5, z: 13 },
  { x: 14, z: 13.5 },
  { x: 25.5, z: 23 },
  { x: 40.5, z: 13 },
  { x: 29.5, z: 23.5 },
  { x: 4, z: 30 },
  { x: 28, z: 27 },
  { x: 14.5, z: 31.5 },
  { x: 38, z: 36 },
  { x: 25, z: 34.8 },
  { x: 9, z: 41.5 },
  { x: 33, z: 41.5 },
];
// Places to hide: every locker in DRESSING outside the booth (the booth's hold coats). A guard steps in from `at`,
// in front of its doors, and is somewhere no mascot looks unless it saw them go in or stands outside long enough
// (sim.ts openLockers). x, z: the locker itself. face: the way its doors look out.
export const HIDES: Hide[] = DRESSING.flatMap((rows, room) =>
  room === BOOTH
    ? []
    : rows
        .filter(r => r[0] === 'locker')
        .map(([, x, z, yaw]) => {
          const face = (yaw * Math.PI) / 180;
          return { room, x, z, face, at: { x: x + Math.sin(face) * 0.85, z: z + Math.cos(face) * 0.85 } };
        })
);
// Where each mascot stands when it is not walking, by MASC index, and which way it faces.
export const REST: Pose[] = [
  { x: 16, z: 3, yaw: 0 },
  { x: 21, z: 3, yaw: 0 },
  { x: 16, z: 28, yaw: Math.PI / 2 },
  { x: 33, z: 3.5, yaw: 0 },
];
export const spawnPoint = (i: number): Pose => ({ x: 18.5 + (i % 4) * 1.6, z: 41.5 - Math.floor(i / 4) * 1.4, yaw: Math.PI });

// Solid things standing on the floor: [x0, z0, x1, z1]. Players and mascots
// walk round them. They come from the furniture table in dressing.ts,
// which is plain data, so the host knows them without loading a model.
export const OBSTACLES: Rect[] = obstacles(GENERATOR);
export function addObstacle(x0: number, z0: number, x1: number, z1: number): void {
  OBSTACLES.push([x0, z0, x1, z1]);
  resetNav();
}

/* ---------- standing and seeing ---------- */

const shutDoor = (d: Doorway, doors?: Doors | null) => d.key && doors && doors[d.key];

// The obstacles sorted into two-metre squares of floor, so walkable() only asks about the few near its point.
// Each is filed under every square within a metre of it, which covers any radius walkable() is asked about.
const CELL = 2,
  COLS = 24;
let buckets: Rect[][] | null = null;
function bucketObstacles(): Rect[][] {
  const out: Rect[][] = [];
  for (const o of OBSTACLES)
    for (let cz = ((o[1] - 1) / CELL) | 0; cz <= (((o[3] + 1) / CELL) | 0); cz++)
      for (let cx = ((o[0] - 1) / CELL) | 0; cx <= (((o[2] + 1) / CELL) | 0); cx++) (out[cz * COLS + cx] ||= []).push(o);
  return out;
}

let lastRect = ROOMS3[0].rects[0];
// Can a circle of radius r be centred here? doors: S.doors, or nothing to ignore shut doors.
// over: ignore the furniture, for questions about reaching across it.
export function walkable(x: number, z: number, r: number, doors?: Doors | null, over?: boolean): boolean {
  // Most questions are about a point next to the last one asked about, so try the rect that one was in first.
  let inside = x >= lastRect[0] + r && x <= lastRect[2] - r && z >= lastRect[1] + r && z <= lastRect[3] - r;
  for (let i = 0; i < ROOMS3.length && !inside; i++)
    for (const rect of ROOMS3[i].rects)
      if (x >= rect[0] + r && x <= rect[2] - r && z >= rect[1] + r && z <= rect[3] - r) {
        inside = true;
        lastRect = rect;
        break;
      }
  if (!inside)
    for (const d of DOORWAYS) {
      if (shutDoor(d, doors)) continue;
      const [x0, z0, x1, z1] = d.rect,
        along = r + 0.06;
      if (
        d.axis === 'x' ? x >= x0 - along && x <= x1 + along && z >= z0 + r && z <= z1 - r : z >= z0 - along && z <= z1 + along && x >= x0 + r && x <= x1 - r
      ) {
        inside = true;
        break;
      }
    }
  if (!inside) return false;
  if (over) return true;
  const near = (buckets ||= bucketObstacles())[((z / CELL) | 0) * COLS + ((x / CELL) | 0)];
  if (near) for (const o of near) if (x > o[0] - r && x < o[2] + r && z > o[1] - r && z < o[3] + r) return false;
  return true;
}

// Move a circle by (dx, dz), sliding along whatever it meets. Changes p.x and
// p.z and returns how far it got as a fraction of what was asked.
export function slide(p: Point, dx: number, dz: number, r: number, doors?: Doors | null): number {
  const len = Math.hypot(dx, dz);
  if (!len) return 1;
  const steps = Math.ceil(len / (r * 0.5)),
    sx = dx / steps,
    sz = dz / steps,
    x0 = p.x,
    z0 = p.z;
  for (let i = 0; i < steps; i++) {
    if (walkable(p.x + sx, p.z + sz, r, doors)) {
      p.x += sx;
      p.z += sz;
    } else if (sx && walkable(p.x + sx, p.z, r, doors)) p.x += sx;
    else if (sz && walkable(p.x, p.z + sz, r, doors)) p.z += sz;
    else break;
  }
  return Math.hypot(p.x - x0, p.z - z0) / len;
}

// Is the straight line between two points clear for something of radius r?
// With r near 0 this is line of sight: walls and shut doors block it.
export function clear(ax: number, az: number, bx: number, bz: number, r: number, doors?: Doors | null, over?: boolean): boolean {
  const len = Math.hypot(bx - ax, bz - az),
    steps = Math.max(1, Math.ceil(len / 0.35));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!walkable(ax + (bx - ax) * t, az + (bz - az) * t, r, doors, over)) return false;
  }
  return true;
}
export const sees = (ax: number, az: number, bx: number, bz: number, doors?: Doors | null): boolean => clear(ax, az, bx, bz, 0.04, doors);
// Could an arm get from here to there? Walls and shut doors stop it. Furniture does not.
export const reaches = (ax: number, az: number, bx: number, bz: number, doors?: Doors | null): boolean => clear(ax, az, bx, bz, 0.04, doors, true);
// Can any of a body of radius r standing at b be seen from a? Lines to its middle and out to its edges across the
// view, GLIMPSE apart, so a slice of it showing past a door jamb still counts. An edge point inside a wall is pulled
// back toward the middle until it is out: the part in the wall is hidden anyway, but the part just short of it may not be.
// Walls and shut doors block it, furniture does not: a table hides none of a body from the eye.
const GLIMPSE = 0.25; // metres: closer gave no fewer misses in testing
export function glimpses(ax: number, az: number, bx: number, bz: number, r: number, doors?: Doors | null): boolean {
  if (reaches(ax, az, bx, bz, doors)) return true;
  const d = Math.hypot(bx - ax, bz - az) || 1,
    ux = -(bz - az) / d,
    uz = (bx - ax) / d,
    n = Math.ceil(r / GLIMPSE);
  for (const side of [1, -1])
    for (let k = 1; k <= n; k++) {
      let o = Math.min(k * GLIMPSE, r) * side;
      const lo = (k - 1) * GLIMPSE;
      while (Math.abs(o) > lo && !walkable(bx + ux * o, bz + uz * o, 0.04, doors, true)) o -= 0.1 * side;
      if (Math.abs(o) <= lo) break; // the wall starts before this point: nothing further out on this side shows
      if (clear(ax, az, bx + ux * o, bz + uz * o, 0.04, doors, true)) return true;
    }
  return false;
}

// Which room a point is in, or -1. A doorway counts as the room on its `a` side.
export function roomAt(x: number, z: number): number {
  for (let i = 0; i < ROOMS3.length; i++) for (const r of ROOMS3[i].rects) if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]) return i;
  for (const d of DOORWAYS) {
    const [x0, z0, x1, z1] = d.rect;
    if (x >= x0 - 0.5 && x <= x1 + 0.5 && z >= z0 - 0.5 && z <= z1 + 0.5) return d.a;
  }
  return -1;
}
export const roomCentre = (i: number): Point => {
  const [x0, z0, x1, z1] = ROOMS3[i].rects[0];
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
};

/* ---------- walls, for the renderer ---------- */

// Cut the pieces [a, b] out of the interval [lo, hi].
function cut(lo: number, hi: number, holes: [number, number][]): [number, number][] {
  let out: [number, number][] = [[lo, hi]];
  for (const [a, b] of holes)
    out = out.flatMap(([l, h]): [number, number][] =>
      b <= l || a >= h
        ? [[l, h]]
        : (
            [
              [l, Math.min(h, a)],
              [Math.max(l, b), h],
            ] as [number, number][]
          ).filter(([p, q]) => q - p > 0.01)
    );
  return out;
}

// Every stretch of wall, as seen from inside its room:
// { x0, z0, x1, z1, nx, nz (pointing into the room), h, room, y0 }.
// Doorways leave holes; above each hole is a lintel from the door's height to the ceiling.
export function walls(): Wall[] {
  const out: Wall[] = [];
  ROOMS3.forEach((room, ri) => {
    room.rects.forEach((rect, k) => {
      const [x0, z0, x1, z1] = rect,
        others = room.rects.filter((_, j) => j !== k);
      // side: the fixed coordinate. horiz: the wall runs along x.
      const sides: [boolean, number, number, number, number][] = [
        [true, z0, x0, x1, 1],
        [true, z1, x0, x1, -1],
        [false, x0, z0, z1, 1],
        [false, x1, z0, z1, -1],
      ];
      for (const [horiz, side, lo, hi, n] of sides) {
        const doors = DOORWAYS.filter(
          d =>
            (d.a === ri || d.b === ri) &&
            (horiz ? d.axis === 'z' && (d.rect[1] === side || d.rect[3] === side) : d.axis === 'x' && (d.rect[0] === side || d.rect[2] === side))
        );
        const doorSpans = doors.map((d): [number, number] => (horiz ? [d.rect[0], d.rect[2]] : [d.rect[1], d.rect[3]])).filter(([a, b]) => b > lo && a < hi);
        // Where another rect of the same room covers this edge there is no wall.
        const open = others
          .filter(([a0, b0, a1, b1]) => (horiz ? side > b0 && side < b1 : side > a0 && side < a1))
          .map(([a0, b0, a1, b1]): [number, number] => (horiz ? [a0, a1] : [b0, b1]));
        const seg = (a: number, b: number, y0: number, h: number) =>
          out.push(
            horiz ? { x0: a, z0: side, x1: b, z1: side, nx: 0, nz: n, y0, h, room: ri } : { x0: side, z0: a, x1: side, z1: b, nx: n, nz: 0, y0, h, room: ri }
          );
        for (const [a, b] of cut(lo, hi, [...doorSpans, ...open])) seg(a, b, 0, room.h);
        doors.forEach((d, i) => {
          const [a, b] = doorSpans[i] || [];
          const dh = d.h || DOOR_H;
          if (a != null && room.h > dh) seg(a, b, dh, room.h - dh);
        });
      }
    });
  });
  return out;
}

// Floor and ceiling pieces that do not overlap: { x0, z0, x1, z1, h, room }.
// Doorways come last with room -1 and their lintel height.
export function slabs(): Slab[] {
  const out: Slab[] = [];
  ROOMS3.forEach((room, ri) => {
    const done: Rect[] = [];
    for (const rect of room.rects) {
      let pieces: Rect[] = [rect];
      for (const [a0, b0, a1, b1] of done)
        pieces = pieces.flatMap(([x0, z0, x1, z1]): Rect[] => {
          if (a1 <= x0 || a0 >= x1 || b1 <= z0 || b0 >= z1) return [[x0, z0, x1, z1]];
          const cx0 = Math.max(x0, a0),
            cx1 = Math.min(x1, a1);
          return (
            [
              [x0, z0, cx0, z1],
              [cx1, z0, x1, z1],
              [cx0, z0, cx1, Math.max(z0, b0)],
              [cx0, Math.min(z1, b1), cx1, z1],
            ] as Rect[]
          ).filter(([p, q, s, t]) => s - p > 0.01 && t - q > 0.01);
        });
      done.push(rect);
      for (const [x0, z0, x1, z1] of pieces) out.push({ x0, z0, x1, z1, h: room.h, room: ri });
    }
  });
  for (const d of DOORWAYS) out.push({ x0: d.rect[0], z0: d.rect[1], x1: d.rect[2], z1: d.rect[3], h: d.h || DOOR_H, room: -1, door: d });
  return out;
}

/* ---------- finding a way ---------- */
// Waypoints: a couple per room, one on each side of every doorway, and one off
// each corner of every obstacle, so a route can bend round whatever props are
// added. Two waypoints are joined when a mascot can walk straight between them.

// [room, x, z]
export const EXTRA_NODES: [number, number, number][] = [
  // beyond one in the middle of each rect
  [0, 13, 8],
  [0, 24, 8],
  [1, 31, 3],
  [1, 39, 8],
  [2, 3, 21],
  [2, 8, 14],
  [3, 15, 14],
  [3, 24, 22],
  [3, 24, 14],
  [3, 15, 22],
  [4, 31, 14],
  [4, 39, 22],
  [4, 39, 14],
  [5, 4, 28],
  [5, 4, 40.5],
  [6, 16, 31],
  [6, 29, 27.5],
  [7, 38, 28],
  [7, 38, 40.5],
  [9, 17, 38.5],
  [9, 25, 38.5],
  [9, 21, 42],
];
let NAV: Nav | null = null;
function buildNav(): Nav {
  const nodes: NavNode[] = [],
    gap = MASCOT_R + 0.2;
  const add = (x: number, z: number, room: number) => {
    if (room >= 0 && walkable(x, z, MASCOT_R)) nodes.push({ x, z, room });
  };
  ROOMS3.forEach((room, ri) => {
    room.rects.forEach(([x0, z0, x1, z1]) => {
      add((x0 + x1) / 2, (z0 + z1) / 2, ri);
    });
  });
  for (const [room, x, z] of EXTRA_NODES) add(x, z, room);
  for (const [x0, z0, x1, z1] of OBSTACLES)
    for (const [x, z] of [
      [x0 - gap, z0 - gap],
      [x1 + gap, z0 - gap],
      [x0 - gap, z1 + gap],
      [x1 + gap, z1 + gap],
    ])
      add(x, z, roomAt(x, z));
  const links: NavLink[][] = nodes.map(() => []);
  const join = (i: number, j: number, extra: { key?: DoorKey; duct: boolean }) => {
    const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z);
    links[i].push({ to: j, d, ...extra });
    links[j].push({ to: i, d, ...extra });
  };
  const sameRoom = nodes.length;
  for (const d of DOORWAYS) {
    const [x0, z0, x1, z1] = d.rect,
      cx = (x0 + x1) / 2,
      cz = (z0 + z1) / 2;
    const first = nodes.length;
    // How far each side's waypoint stands from the doorway: nearer if a prop is in the way.
    const at = (lo: number, sign: number) => {
      for (const out of [1.5, 1, 2.2, 0.75]) {
        const v = lo + sign * out;
        if (d.axis === 'x' ? clear(v, cz, cx, cz, MASCOT_R) : clear(cx, v, cx, cz, MASCOT_R)) return v;
      }
      return lo + sign * 1.5;
    };
    // the lower-coordinate side belongs to whichever room is on that side
    const lowIsA =
      d.axis === 'x'
        ? ROOMS3[d.a].rects.some(r => r[2] <= x0 + 0.01 && r[1] <= cz && r[3] >= cz)
        : ROOMS3[d.a].rects.some(r => r[3] <= z0 + 0.01 && r[0] <= cx && r[2] >= cx);
    const lowRoom = lowIsA ? d.a : d.b,
      highRoom = lowIsA ? d.b : d.a;
    if (d.axis === 'x') nodes.push({ x: at(x0, -1), z: cz, room: lowRoom, door: d }, { x: at(x1, 1), z: cz, room: highRoom, door: d });
    else nodes.push({ x: cx, z: at(z0, -1), room: lowRoom, door: d }, { x: cx, z: at(z1, 1), room: highRoom, door: d });
    links.push([], []);
    join(first, first + 1, { key: d.key, duct: d.a === DUCTS || d.b === DUCTS });
  }
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].room !== nodes[j].room || (i >= sameRoom && j >= sameRoom && nodes[i].door === nodes[j].door)) continue;
      if (clear(nodes[i].x, nodes[i].z, nodes[j].x, nodes[j].z, MASCOT_R)) join(i, j, { duct: nodes[i].room === DUCTS });
    }
  return { nodes, links };
}
export const nav = (): Nav => NAV || (NAV = buildNav());
// Props added after the first path was asked for change what is walkable.
export function resetNav(): void {
  NAV = null;
  buckets = null;
}

// The nearest waypoint that a walker of radius r can reach in a straight line: one of the dozen nearest, or failing that the nearest.
// ducts: false leaves out the waypoints inside the ducts, for a walker that cannot go in.
function nearestNode(x: number, z: number, doors: Doors | undefined, ducts: boolean | undefined, r: number): number {
  const { nodes } = nav(),
    tried: number[] = [];
  for (let k = 0; k < 12; k++) {
    let best = -1,
      bd = 1e9;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i],
        d = Math.hypot(n.x - x, n.z - z);
      if (d < bd && (ducts || n.room !== DUCTS) && !tried.includes(i)) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) break;
    if (clear(x, z, nodes[best].x, nodes[best].z, r, doors)) return best;
    tried.push(best);
  }
  return tried[0];
}

// A route from one point to another as a list of points to walk to, ending
// at the goal. opts.doors: shut doors block the way. opts.ducts: may it use
// the ducts. opts.r: the walker's radius, a mascot's unless given. Returns
// { path, blocked } where blocked is the key of the shut door the route stops
// in front of, when there is no open way. An empty path with nothing blocked
// means there is no way at all.
export function route(ax: number, az: number, bx: number, bz: number, opts: RouteOptions = {}): Route {
  const { nodes, links } = nav(),
    r = opts.r || MASCOT_R;
  if (clear(ax, az, bx, bz, r, opts.doors)) return { path: [{ x: bx, z: bz }] };
  const from = nearestNode(ax, az, opts.doors, opts.ducts, r),
    goal = nearestNode(bx, bz, opts.doors, opts.ducts, r);
  const search = (respectDoors: boolean) => {
    const n = nodes.length,
      dist = new Float64Array(n).fill(1e9),
      prev = new Int16Array(n).fill(-1),
      via: (NavLink | null)[] = new Array(n).fill(null),
      done = new Uint8Array(n);
    dist[from] = 0;
    for (;;) {
      let u = -1,
        ud = 1e9;
      for (let i = 0; i < n; i++)
        if (!done[i] && dist[i] < ud) {
          ud = dist[i];
          u = i;
        }
      if (u < 0 || u === goal) break;
      done[u] = 1;
      for (const l of links[u]) {
        if (l.duct && !opts.ducts) continue;
        if (respectDoors && l.key && opts.doors?.[l.key]) continue;
        if (ud + l.d < dist[l.to]) {
          dist[l.to] = ud + l.d;
          prev[l.to] = u;
          via[l.to] = l;
        }
      }
    }
    if (dist[goal] >= 1e9) return null;
    const ids: number[] = [];
    for (let i = goal; i >= 0; i = prev[i]) ids.unshift(i);
    return { ids, via };
  };
  let found = search(true),
    blocked: DoorKey | undefined;
  if (!found) {
    found = search(false);
    if (!found) return { path: [] };
    const { ids, via } = found;
    // Stop at the near side of the first shut door on the way.
    const stop = ids.findIndex((id, k) => {
      const key = via[id]?.key;
      return k > 0 && key && opts.doors?.[key];
    });
    blocked = via[ids[stop]]?.key;
    return { path: ids.slice(0, stop).map(i => ({ x: nodes[i].x, z: nodes[i].z })), blocked };
  }
  const path = found.ids.map(i => ({ x: nodes[i].x, z: nodes[i].z }));
  path.push({ x: bx, z: bz });
  // Skip the first waypoints if a later one is already in a straight clear line.
  while (path.length > 1 && clear(ax, az, path[1].x, path[1].z, r, opts.doors)) path.shift();
  return { path };
}
