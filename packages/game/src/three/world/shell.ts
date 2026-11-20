// The building itself, built from the same data the collision uses (walls(),
// slabs() and DOORWAYS in the sim's map.ts), so what you see is what you bump into.
// Floors, walls and ceilings go into one mesh per material; skirting, door
// frames, pipes and the stage's arch go into the trim batch; posters, stains
// and the stencilled room names go into two decal meshes.

// The stage's platform (STAGE) is plain data in @thick-shift/sim, so tools/roblox/gen-data.mjs can read it too.
import { STAGE } from '@thick-shift/sim/data';
import type { Doorway } from '@thick-shift/sim/map';
import { DOOR_H, DOORWAYS, REST, ROOMS3, roomAt, slabs, walls } from '@thick-shift/sim/map';
import * as THREE from 'three';
import type { Pics } from './art';
import { ART, NAME_CELL, uvOf } from './art';
import type { UV, Vec3 } from './geo';
import { Batch, rgbOf } from './geo';
import type { Materials } from './surfaces';
import { LOOK, SPAN } from './surfaces';

export const floorY = (x: number, z: number): number => (roomAt(x, z) === STAGE.room && z < STAGE.edge ? STAGE.rise : 0);

const FRAME_W = 0.11,
  FRAME_T = 0.045; // door frames: how wide, and how far proud of the wall
const OFF = 0.012; // how far a decal sits off its surface

// Things on the walls: [art, x, z, nx, nz, y of its middle, width]. (x, z) is on the wall, (nx, nz) the way it faces.
const ON_WALLS: [art: string, x: number, z: number, nx: number, nz: number, y: number, w: number][] = [
  ['mural', 23.9, 25, 0, -1, 1.95, 5.6],
  ['poster0', 14.6, 11.5, 0, 1, 2.1, 0.84],
  ['poster1', 15.7, 11.5, 0, 1, 2.05, 0.84],
  ['note0', 21.3, 11.5, 0, 1, 1.6, 0.3],
  ['height', 12, 14.6, 1, 0, 1.15, 0.48],
  ['scrawl', 27, 22.6, -1, 0, 1.55, 1.5],
  ['damp', 12, 22, 1, 0, 3.4, 2.2],
  ['poster2', 11.5, 14, -1, 0, 2, 0.84],
  ['poster3', 11.5, 22, -1, 0, 2.05, 0.84],
  ['note7', 6.2, 25, 0, -1, 1.6, 0.3],
  ['hand', 8.3, 25, 0, -1, 1.25, 0.7],
  ['damp', 0, 20, 1, 0, 3, 2.4],
  ['poster0', 13, 11, 0, -1, 2.3, 0.84],
  ['poster1', 24.2, 11, 0, -1, 2.25, 0.84],
  ['tally', 10, 7, 1, 0, 1.45, 0.7],
  ['note2', 27, 7.5, -1, 0, 1.6, 0.3],
  ['damp', 22, 0, 0, 1, 4.2, 3],
  ['note2', 27.5, 8, 1, 0, 1.6, 0.3],
  ['note4', 27.5, 8.45, 1, 0, 1.55, 0.3],
  ['note1', 38.6, 0, 0, 1, 1.6, 0.3],
  ['hand', 42, 5, -1, 0, 1.1, 0.7],
  ['damp', 30, 0, 0, 1, 2.9, 2.4],
  ['poster3', 42, 6.4, -1, 0, 2, 0.84],
  ['note5', 33, 11.5, 0, 1, 1.6, 0.3],
  ['scrawl', 33.4, 25, 0, -1, 1.7, 1.5],
  ['hand', 27.5, 22.5, 1, 0, 1.2, 0.7],
  ['damp', 42, 17, -1, 0, 2.9, 2.2],
  ['note1', 6, 30, -1, 0, 1.6, 0.3],
  ['note6', 2, 40.6, 1, 0, 1.6, 0.34],
  ['tally', 6, 35, -1, 0, 1.4, 0.7],
  ['damp', 2, 33, 1, 0, 2.4, 2.4],
  ['damp', 8, 38.5, 0, 1, 2.5, 2],
  ['hand', 12, 42.5, 0, -1, 1.2, 0.7],
  ['note3', 36, 30, 1, 0, 1.6, 0.3],
  ['poster1', 40, 34.2, -1, 0, 1.9, 0.84],
  ['damp', 40, 31, -1, 0, 2.4, 2.4],
  ['damp', 31, 38.5, 0, 1, 2.5, 2],
  ['tally', 36, 36, 1, 0, 1.4, 0.6],
  ['poster2', 22.6, 33, 0, -1, 2, 0.84],
  ['note0', 24.5, 25.5, 0, 1, 1.6, 0.3],
  ['hand', 13, 30.5, 1, 0, 1.1, 0.7],
  ['damp', 26, 33, 0, -1, 2.8, 2.4],
  ['note6', 23.6, 44, 0, -1, 1.65, 0.36],
  ['note1', 19.7, 44, 0, -1, 1.6, 0.3],
  ['note7', 19.3, 44, 0, -1, 1.58, 0.3],
  ['poster0', 27, 43, -1, 0, 1.9, 0.7],
  ['note4', 15, 37.4, 1, 0, 1.6, 0.3],
  ['hand', 19, 36, 0, -1, 0.9, 0.6],
  ['hand', 21.5, 33.5, 0, 1, 1.3, 0.6],
];
// Holes in the tiled ceilings, and wet patches on the floors: [x, z, size].
const HOLES = [
  [20, 20.2, 1.3],
  [14.2, 23, 1.2],
  [3, 14.4, 1.3],
  [35, 17, 1.3],
  [27, 29.2, 1.2],
  [25.4, 42.6, 1.1],
  [9, 20, 1.2],
];
const PUDDLES = [
  [4, 31, 2.6],
  [38, 38, 2.6],
  [10, 40.6, 2.2],
  [34, 3, 2.4],
  [20, 34.8, 1.8],
  [40, 18.8, 1.6],
  [30.4, 22, 2],
];
// Overhead runs: [from, to, radius, colour]. Each differs along one axis.
const RUST = '#5a3a22',
  GALV = '#7d8388',
  BLACK = '#101012';
type Pipe = [from: Vec3, to: Vec3, r: number, col: string];
const PIPES: Pipe[] = [
  [[2.3, 2.95, 25.6], [2.3, 2.95, 42.4], 0.06, RUST],
  [[2.48, 3.05, 25.6], [2.48, 3.05, 42.4], 0.03, GALV],
  [[2.6, 3, 42.2], [14.4, 3, 42.2], 0.06, RUST],
  [[39.7, 2.95, 25.6], [39.7, 2.95, 42.4], 0.06, RUST],
  [[39.52, 3.05, 25.6], [39.52, 3.05, 42.4], 0.03, GALV],
  [[27.6, 3, 42.2], [39.4, 3, 42.2], 0.06, RUST],
  [[27.6, 3.45, 0.3], [41.9, 3.45, 0.3], 0.07, RUST],
  [[27.6, 3.6, 0.5], [41.9, 3.6, 0.5], 0.03, GALV],
  [[41.7, 0, 0.3], [41.7, 3.45, 0.3], 0.07, RUST],
  [[41.7, 3.3, 11.6], [41.7, 3.3, 24.9], 0.05, GALV],
  [[13.1, 3.4, 25.75], [30.9, 3.4, 25.75], 0.03, GALV],
  [[10.6, 4.5, 2.6], [26.4, 4.5, 2.6], 0.03, BLACK],
  [[10.6, 4.5, 6.2], [26.4, 4.5, 6.2], 0.03, BLACK],
  ...[12, 18.5, 25].flatMap(x => [2.6, 6.2].map((z): Pipe => [[x, 4.5, z], [x, 5.2, z], 0.012, BLACK])),
];
// Boxes: [x0, y0, z0, x1, y1, z1, colour]. The kitchen's extract duct, and the stage's arch with its gilt edge.
const BURGUNDY = '#4a1216',
  GILT = '#a8862a';
type Solid = [x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: string];
const BOXES: Solid[] = [
  [29, 3.05, 11.7, 41, 3.5, 12.5, GALV],
  [30.9, 2.45, 11.7, 33, 3.05, 12.6, GALV],
  [10, 0, STAGE.edge - 0.2, 10.32, 5.2, STAGE.edge + 0.2, BURGUNDY],
  [26.68, 0, STAGE.edge - 0.2, 27, 5.2, STAGE.edge + 0.2, BURGUNDY],
  [10.32, 4.05, STAGE.edge - 0.16, 26.68, 5.2, STAGE.edge + 0.16, BURGUNDY],
  [10.32, 4, STAGE.edge - 0.19, 26.68, 4.05, STAGE.edge + 0.19, GILT],
  ...[10.32, 26.6].map((x): Solid => [x, 0, STAGE.edge - 0.23, x + 0.08, 4, STAGE.edge + 0.23, GILT]),
];

// The room on one side of a doorway. low: the side with the smaller coordinate.
function sideOf(d: Doorway, low: boolean): number {
  const [x0, z0, x1, z1] = d.rect,
    cx = (x0 + x1) / 2,
    cz = (z0 + z1) / 2;
  const at = d.axis === 'x' ? [low ? x0 - 0.2 : x1 + 0.2, cz] : [cx, low ? z0 - 0.2 : z1 + 0.2];
  return ROOMS3.findIndex(r => r.rects.some(([a0, b0, a1, b1]) => at[0] >= a0 && at[0] <= a1 && at[1] >= b0 && at[1] <= b1));
}

// mats: from surfaces(). pics: from art(). trim: the batch for small solid parts, which the caller turns into a mesh.
export function buildShell(scene: THREE.Scene, mats: Materials, pics: Pics, trim: Batch): void {
  const batches = new Map<THREE.MeshStandardMaterial, Batch>(),
    on = (mat: THREE.MeshStandardMaterial): Batch => {
      if (!batches.has(mat)) batches.set(mat, new Batch());
      return batches.get(mat);
    };
  const decals = new Batch(),
    names = new Batch();

  for (const s of slabs()) {
    const room = s.room < 0 ? s.door.a : s.room,
      m = mats.rooms[room],
      uv = (x0: number, z0: number, x1: number, z1: number): UV => [x0 / SPAN, -z1 / SPAN, x1 / SPAN, -z0 / SPAN];
    // the stage platform is the part of that room north of its edge
    const split = s.room === STAGE.room && s.z0 < STAGE.edge && s.z1 > STAGE.edge;
    for (const [z0, z1] of split
      ? [
          [s.z0, STAGE.edge],
          [STAGE.edge, s.z1],
        ]
      : [[s.z0, s.z1]])
      on(m.floor).flat(s.x0, z0, s.x1, z1, floorY((s.x0 + s.x1) / 2, (z0 + z1) / 2), true, uv(s.x0, z0, s.x1, z1));
    on(s.room < 0 ? m.wall : m.ceil).flat(s.x0, s.z0, s.x1, s.z1, s.h, false, uv(s.x0, s.z0, s.x1, s.z1));
  }
  const [sx0, , sx1] = ROOMS3[STAGE.room].rects[0],
    lip = rgbOf('#2a1a0e');
  trim.wall(sx0, STAGE.edge, sx1, STAGE.edge, 0, STAGE.rise, 0, 1, [0, 0, sx1 - sx0, 0.2], lip);
  for (const d of DOORWAYS)
    if ((d.a === STAGE.room || d.b === STAGE.room) && d.rect[1] < STAGE.edge)
      trim.wall(d.rect[0], d.rect[1], d.rect[0], d.rect[3], 0, STAGE.rise, 1, 0, [0, 0, 2.6, 0.2], lip);

  for (const w of walls()) {
    const m = mats.rooms[w.room],
      H = ROOMS3[w.room].h,
      look = LOOK[w.room],
      along = w.nz ? [w.x0, w.x1] : [w.z0, w.z1];
    on(m.wall).wall(w.x0, w.z0, w.x1, w.z1, w.y0, w.y0 + w.h, w.nx, w.nz, [along[0] / SPAN, w.y0 / H, along[1] / SPAN, (w.y0 + w.h) / H]);
    if (w.y0 === 0 && look.skirt) {
      const t = 0.02,
        h = w.room === STAGE.room ? 0.1 + STAGE.rise : 0.1,
        col = rgbOf(look.skirt),
        ox = w.nx * t,
        oz = w.nz * t;
      trim.wall(w.x0 + ox, w.z0 + oz, w.x1 + ox, w.z1 + oz, 0, h, w.nx, w.nz, [0, 0, along[1] - along[0], 0.1], col);
      trim.flat(Math.min(w.x0, w.x0 + ox), Math.min(w.z0, w.z0 + oz), Math.max(w.x1, w.x1 + ox), Math.max(w.z1, w.z1 + oz), h, true, [0, 0, 0.02, 1], col);
    }
  }

  for (const d of DOORWAYS) {
    const [x0, z0, x1, z1] = d.rect,
      h = d.h || DOOR_H,
      cx = (x0 + x1) / 2,
      cz = (z0 + z1) / 2,
      wide = d.axis === 'x' ? z1 - z0 : x1 - x0;
    // the sides of the hole through the wall, in the wall of the room on the a side
    const reveal = on(mats.rooms[d.a].wall),
      H = ROOMS3[d.a].h;
    if (d.axis === 'x') {
      reveal.wall(x0, z0, x1, z0, 0, h, 0, 1, [0, 0, 0.125, h / H]);
      reveal.wall(x0, z1, x1, z1, 0, h, 0, -1, [0, 0, 0.125, h / H]);
    } else {
      reveal.wall(x0, z0, x0, z1, 0, h, 1, 0, [0, 0, 0.125, h / H]);
      reveal.wall(x1, z0, x1, z1, 0, h, -1, 0, [0, 0, 0.125, h / H]);
    }
    trim.flat(x0, z0, x1, z1, 0.004, true, [0, 0, 1, 1], rgbOf(d.key ? '#3a3a3e' : '#2a2622')); // threshold

    for (const low of [true, false]) {
      const here = sideOf(d, low),
        there = sideOf(d, !low),
        roomH = ROOMS3[here].h,
        n = low ? -1 : 1;
      const nx = d.axis === 'x' ? n : 0,
        nz = d.axis === 'x' ? 0 : n,
        face = d.axis === 'x' ? (low ? x0 : x1) : low ? z0 : z1;
      // a point on this face: `a` metres along the wall from the middle of the door, `out` metres off it
      const pt = (a: number, out: number): [number, number] => (d.axis === 'x' ? [face + n * out, cz + a] : [cx + a, face + n * out]);
      const col = rgbOf(d.key ? LOOK[9].frame : LOOK[here].frame),
        top = Math.min(roomH, h + FRAME_W);
      const post = (a0: number, a1: number, y0: number, y1: number): void => {
        const [px0, pz0] = pt(a0, 0),
          [px1, pz1] = pt(a1, FRAME_T);
        trim.box(Math.min(px0, px1), y0, Math.min(pz0, pz1), Math.max(px0, px1), y1, Math.max(pz0, pz1), col, 0.5);
      };
      post(-wide / 2 - FRAME_W, -wide / 2, 0, top);
      post(wide / 2, wide / 2 + FRAME_W, 0, top);
      if (top - h > 0.04) post(-wide / 2, wide / 2, h, top);

      // The name of the room through the door: over it where there is wall to
      // paint on, beside it in a low room, and on the floor where the door fills the wall.
      const uv = uvOf(
        [(there % 2) * NAME_CELL[0] + (NAME_CELL[0] - pics.nameWidth[there]) / 2, (there >> 1) * NAME_CELL[1], pics.nameWidth[there], NAME_CELL[1]],
        1024,
        512
      );
      const size = (hgt: number): [number, number] => [(pics.nameWidth[there] / NAME_CELL[1]) * hgt, hgt];
      const rect = ROOMS3[here].rects.find(([a0, b0, a1, b1]) =>
        d.axis === 'x' ? Math.abs((low ? a1 : a0) - face) < 0.01 && b0 <= cz && b1 >= cz : Math.abs((low ? b1 : b0) - face) < 0.01 && a0 <= cx && a1 >= cx
      );
      const before = d.axis === 'x' ? z0 - rect[1] : x0 - rect[0],
        after = d.axis === 'x' ? rect[3] - z1 : rect[2] - x1;
      if (roomH - h >= 0.5) {
        const [w, hh] = size(0.36),
          [px, pz] = pt(0, OFF);
        names.sign(px, h + 0.31, pz, w, hh, nx, nz, uv);
      } else if (Math.max(before, after) >= 2.1) {
        const [w, hh] = size(0.24),
          a = (wide / 2 + FRAME_W + 0.25 + w / 2) * (before > after ? -1 : 1),
          [px, pz] = pt(a, OFF);
        names.sign(px, Math.min(2.35, roomH - 0.3), pz, w, hh, nx, nz, uv);
      } else {
        const [w, hh] = size(0.4),
          [px, pz] = pt(0, 1.5);
        names.decal(px, OFF, pz, w, hh, Math.atan2(-nx, -nz), true, uv);
      }
      if (d.key && here === 9) {
        const [px, pz] = pt(0, 0.25);
        decals.decal(px, OFF, pz, wide, wide / 8, Math.atan2(-nx, -nz), true, uvOf(ART.hazard));
      }
    }
  }

  for (const [a, b, r, col] of PIPES) trim.bar(a, b, r, rgbOf(col));
  for (const [x0, y0, z0, x1, y1, z1, col] of BOXES) trim.box(x0, y0, z0, x1, y1, z1, rgbOf(col));
  // The ducts are sheet metal boxes bolted end to end; a rib at every joint.
  {
    const [x0, z0, x1, z1] = ROOMS3[8].rects[0],
      H = ROOMS3[8].h,
      c = rgbOf('#4a4e52');
    for (let x = x0 + 2; x < x1; x += 2) {
      trim.box(x - 0.04, 0, z0, x + 0.04, 0.03, z1, c);
      trim.box(x - 0.04, H - 0.03, z0, x + 0.04, H, z1, c);
      trim.box(x - 0.04, 0, z0, x + 0.04, H, z0 + 0.03, c);
      trim.box(x - 0.04, 0, z1 - 0.03, x + 0.04, H, z1, c);
    }
  }
  // The valance under the arch, front and back.
  for (let i = 0; i < 4; i++) for (const n of [1, -1]) decals.sign(12.37 + i * 4.09, 3.76, STAGE.edge + n * 0.2, 4.09, 0.51, 0, n, uvOf(ART.scallop));

  const aspect = (key: string): number => ART[key][3] / ART[key][2];
  for (const [key, x, z, nx, nz, y, w] of ON_WALLS) decals.sign(x + nx * OFF, y, z + nz * OFF, w, w * aspect(key), nx, nz, uvOf(ART[key]));
  for (const [x, z, size] of HOLES) {
    const y = ROOMS3[roomAt(x, z)].h;
    decals.decal(x, y - OFF, z, size, size, 0, false, uvOf(ART.hole));
    // the tile that came out of it, hanging by one edge
    trim.quad(
      [x - 0.3, y - 0.02, z + 0.5],
      [x + 0.3, y - 0.02, z + 0.5],
      [x + 0.34, y - 0.5, z + 0.82],
      [x - 0.26, y - 0.5, z + 0.82],
      [0, -0.5, -0.8],
      [0, 0, 0.6, 0.6],
      [0.5, 0.48, 0.42]
    );
  }
  for (const [x, z, size] of PUDDLES) decals.decal(x, floorY(x, z) + OFF, z, size, size, x, true, uvOf(ART.damp));
  // The marks the mascots are stood on when they are put away.
  for (const r of REST) decals.decal(r.x, floorY(r.x, r.z) + OFF, r.z, 1.5, 1.5, r.yaw, true, uvOf(ART.mark));

  for (const [mat, batch] of batches) {
    const m = batch.mesh(mat);
    m.receiveShadow = true;
    m.castShadow = true;
    scene.add(m);
  }
  const stuck = (map: THREE.Texture): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({
      map,
      transparent: true,
      depthWrite: false,
      roughness: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  for (const [batch, map] of [
    [decals, pics.art],
    [names, pics.names],
  ] satisfies [Batch, THREE.Texture][]) {
    const m = batch.mesh(stuck(map));
    m.receiveShadow = true;
    scene.add(m);
  }
}
