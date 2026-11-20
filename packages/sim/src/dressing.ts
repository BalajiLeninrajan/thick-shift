// Where the furniture stands. Plain data with no three.js in it: map.ts
// reads it at load to learn what is solid (the host walks mascots round it),
// and the game's props.ts reads it to put the models there.
//
// DRESSING[room] is a list of [prop, x, z, yaw in degrees, options].
// yaw 0 leaves the prop's front facing south (+z), 90 east. Options:
//   y      height of its origin: the middle of a wall prop, the top of a hung one. Floor props stand on the floor
//   hang   its origin goes on the ceiling
//   dead   its lamps are out
//   soft   walk through it even though FOOT gives it a footprint
//   s      scale
// Every locker outside the booth is also a place to hide (HIDES in map.ts), so a locker
// wants a metre of clear floor in front of its doors.
// A prop is solid when FOOT has its footprint and it is not marked soft.
import { defined } from './check.ts';
import type { Rect } from './types.ts';

export interface PropOptions {
  y?: number;
  hang?: boolean;
  dead?: boolean;
  soft?: boolean;
  s?: number;
}
export type Placed = [prop: string, x: number, z: number, yaw: number, options?: PropOptions];
// [width, depth], and where the middle sits from the prop's origin when it is not on it.
export type Foot = [w: number, d: number, x?: number, z?: number];

// [width, depth] of each solid prop's footprint in metres, before it is turned,
// and where the middle of it sits from the prop's origin if not on it: [w, d, x, z],
// z toward the prop's front. It covers what a body cannot pass through, so a
// prop's walk-through litter (skee-ball tickets, the soda machine's lead and
// puddle) and anything overhead (the top spare head) are left out.
// Anything not listed here is never solid: chairs, boxes, bags, things on walls and ceilings.
export const FOOT: Record<string, Foot> = {
  generator: [1.5, 1.05],
  desk: [2.4, 1],
  locker: [0.9, 0.6],
  crate: [1.05, 1.05],
  barrel: [0.6, 0.6],
  speaker: [0.84, 0.78, 0, -0.14],
  costume_rack: [1.8, 0.6],
  spare_heads: [2, 0.6],
  mannequin: [0.6, 0.6],
  vanity: [1.2, 0.57, 0, 0.035],
  trunk: [1.12, 0.85, 0, 0.025],
  arcade_cabinet: [0.75, 0.85],
  claw_machine: [1.05, 1.07, 0.065, 0.025],
  skee_ball: [0.8, 2.8],
  prize_counter: [2, 0.65],
  table_round: [1.48, 1.48],
  table_long: [2.4, 0.75],
  standee: [1.8, 0.4],
  counter_steel: [2, 0.7],
  fridge: [1.21, 0.98, 0, 0.12],
  range: [1, 0.83],
  sink_unit: [1.5, 0.77, 0, 0.035],
  wire_shelf: [1.2, 0.5],
  snack_counter: [3, 0.8],
  soda_machine: [1, 0.76],
  popcorn_cart: [1.06, 0.68, 0.14, 0],
};
// Round props cover the same floor whichever way they are turned.
const ROUND = new Set(['table_round', 'barrel']);
// The generator stands this far behind the point guards crank it from (GENERATOR in map.ts).
export const GEN_BACK = 1.05;

const HANG = { hang: true };
const wall = (y: number): PropOptions => ({ y }); // a wall prop, with the height of its middle
export const DRESSING: Placed[][] = [
  // 0 Storage Stage. The mascots stand on their marks in front of a torn drape;
  // crates and flight cases crowd the wings. The platform is everything north of z 8.2.
  [
    ['curtain', 14.6, 0.45, 0, { y: 3.9 }],
    ['curtain', 17.2, 0.45, 0, { y: 3.9 }],
    ['curtain', 22.6, 0.45, 0, { y: 3.9 }],
    ['curtain', 11.1, 8.2, 0, { y: 4 }],
    ['curtain', 25.9, 8.2, 0, { y: 4 }],
    ...[13, 16.4, 21.2, 24.2].map((x): Placed => ['stage_light', x, 6.2, 180, { y: 4.47, dead: true }]),
    ['stage_light', 18.6, 2.6, 0, { y: 4.47, dead: true }],
    ['crate', 10.7, 0.7, 0],
    ['crate', 11.8, 0.75, 90],
    ['crate', 26.3, 0.7, 0],
    ['crate', 14.6, 6.4, 20],
    ['cardboard_box', 12.7, 1.2, 30],
    ['cardboard_box', 26.2, 1.7, -15],
    ['cardboard_box', 15.5, 6.9, 60],
    ['pallet', 23.6, 1.1, 10],
    ['speaker', 26.3, 9.7, 200],
    ['speaker', 10.7, 9.9, 150],
    ['trunk', 22.4, 10.4, 180],
    ['balloons', 24.6, 6.2, 0],
    ['chair_fallen', 16.8, 9.4, 40],
  ],
  // 1 Backstage. The costume store: racks of empty suits, the shelf of spare
  // heads facing the kitchen door, a dress form by the mirror, and the generator.
  [
    ['costume_rack', 37.2, 6, 90],
    ['costume_rack', 30.5, 1.2, 0],
    ['spare_heads', 35.3, 0.45, 0],
    ['mannequin', 32.6, 8.6, 80],
    ['vanity', 31, 10.55, 180],
    ['stool', 31.1, 9.8, 0],
    ['trunk', 28.3, 10.3, 0],
    ['locker', 27.85, 1.5, 90],
    ['locker', 27.85, 2.45, 90],
    ['crate', 38.3, 0.7, 0],
    ['barrel', 41.4, 10.3, 0],
    ['barrel', 40.7, 10.45, 40],
    ['cardboard_box', 39.9, 9.9, 20],
    ['cardboard_box', 29.2, 2.2, 70],
    ['fuse_box', 38.9, 0, 0, wall(1.5)],
    ['wall_fan', 42, 4.6, 270, wall(2.9)],
    ['fire_extinguisher', 27.5, 7.4, 90, wall(1.2)],
    ['trash_bag', 41.3, 6.4, 0],
  ],
  // 2 Arcade. Cabinets along the west wall, two back to back as an island,
  // skee-ball at the north end, the prize counter and the claw machine by the east door.
  [
    ...[15.7, 16.6, 19.7, 20.6, 21.5].map((z): Placed => ['arcade_cabinet', 0.5, z, 90]),
    ['arcade_cabinet', 7.3, 21.6, 270],
    ['arcade_cabinet', 8.15, 21.6, 90],
    ['arcade_cabinet', 7, 11.95, 0],
    ['skee_ball', 4, 12.9, 0],
    ['skee_ball', 5, 12.9, 0],
    ['prize_counter', 10.9, 21.4, 270],
    ['claw_machine', 10.6, 24, 315],
    ['locker', 11.15, 13.2, 270],
    ['stool', 1.35, 15.7, 0],
    ['stool', 1.35, 20.6, 0],
    ['stool', 6.4, 21.6, 0],
    ['trash_can', 11, 16.4, 0],
    ['balloons', 2.2, 24.2, 0],
    ['chair_fallen', 9, 15.4, 100],
  ],
  // 3 Main Hall. A party that was never cleared away: four laid tables, chairs
  // pushed back or on their sides, presents on a trestle, and the photo board by the snack bar door.
  [
    ['table_round', 17.2, 16, 0],
    ['table_round', 21.8, 16.2, 40],
    ['table_round', 17.2, 20.4, 70],
    ['table_round', 21.8, 20.3, 15],
    ['chair', 16.2, 15.3, 60],
    ['chair', 18.1, 15.5, -50],
    ['chair_fallen', 17.6, 17.1, 10],
    ['chair', 22.8, 15.8, -80],
    ['chair', 21.2, 17.1, 160],
    ['chair', 21.4, 15.3, 30],
    ['chair', 16.3, 20.9, 110],
    ['chair_fallen', 18.3, 21, 200],
    ['chair', 17.5, 19.4, -10],
    ['chair', 22.7, 20.9, -120],
    ['chair', 21, 19.6, 40],
    ['chair_fallen', 23, 19.3, 280],
    ['table_long', 12.6, 22.5, 90],
    ['gift_pile', 13.5, 21.3, 0],
    ['table_long', 26.4, 13.6, 90],
    ['standee', 16.3, 24.2, 180],
    ['high_chair', 20.5, 15.4, 200],
    ['balloons', 25.9, 24.2, 0],
    ['balloons', 13, 12.4, 0],
    ['trash_can', 26.4, 24.4, 0],
    ['banner', 19.5, 14.6, 0, { y: 4.3 }],
    ['banner', 19.5, 21.8, 0, { y: 4.3 }],
    ['banner', 14, 18.3, 90, { y: 4.3 }],
    ['banner', 25, 18.3, 90, { y: 4.3 }],
  ],
  // 4 Kitchen. Range and sinks on the north wall under the extract duct, two
  // prep counters down the middle, the fridge standing open, something hanging from the rail.
  [
    ['counter_steel', 30.2, 11.9, 0],
    ['range', 31.9, 12, 0],
    ['locker', 27.85, 14, 90],
    ['sink_unit', 38.6, 11.9, 0],
    ['barrel', 41.4, 12.2, 0],
    ['counter_steel', 32.2, 16.2, 90],
    ['counter_steel', 32.2, 20.6, 90],
    ['pot_rack', 32.2, 16.2, 90, HANG],
    ['fridge', 41.55, 16.5, 270],
    ['wire_shelf', 33.5, 24.6, 180],
    ['wire_shelf', 34.8, 24.6, 180],
    ['meat_rail', 40, 18.8, 90, { y: 2.15 }],
    ['mop_bucket', 28.2, 24.2, 30],
    ['wet_floor_sign', 30.6, 22, 20],
    ['trash_bag', 41.3, 24.2, 0],
    ['trash_bag', 40.5, 24.4, 120],
    ['wall_fan', 42, 13.6, 270, wall(2.8)],
    ['fire_extinguisher', 27.5, 20.4, 90, wall(1.2)],
    ['cardboard_box', 36.4, 24.5, 10],
  ],
  // 5 West Hall. Service corridor: things left against the walls, a lane down the middle.
  [
    ['crate', 5.45, 29.5, 0],
    ['locker', 5.65, 31.5, 270],
    ['locker', 5.65, 32.45, 270],
    ['barrel', 2.4, 37.5, 0],
    ['crate', 9.5, 39.05, 0],
    ['barrel', 12, 42.1, 0],
    ['pallet', 5.3, 36, 5],
    ['cardboard_box', 5.2, 35.8, 20],
    ['cardboard_box', 5.55, 36.4, 80],
    ['wet_floor_sign', 3.1, 31.3, 70],
    ['mop_bucket', 2.5, 27.2, 0],
    ['trash_bag', 5.4, 41.9, 0],
    ['trash_bag', 2.5, 41.8, 200],
    ['fire_extinguisher', 6, 34, 270, wall(1.2)],
    ['vent_cover', 2, 35.2, 90, wall(0.5)],
    ['fuse_box', 6, 37.6, 270, wall(1.5)],
    ...[27, 29, 31].map((z): Placed => ['pipe_run', 5.55, z, 0, HANG]),
    ...[7.5, 9.5, 11.5, 13.5].map((x): Placed => ['duct_run', x, 39.1, 90, HANG]),
  ],
  // 6 Snack Bar. Counter and menu on the north wall, the popcorn cart between
  // the hall door and where Squish waits, the soda machine still lit.
  [
    ['snack_counter', 24.2, 26.6, 0],
    ['menu_board', 24.2, 25.5, 0, wall(2.45)],
    ['popcorn_cart', 17.6, 26.6, 0],
    ['soda_machine', 30.5, 29, 270],
    ['bar_stool', 23.2, 27.5, 0],
    ['bar_stool', 24.3, 27.55, 30],
    ['bar_stool', 25.3, 27.5, 0],
    ['table_round', 25.5, 31, 0],
    ['table_round', 19.5, 31.2, 50],
    ['chair', 26.5, 31.3, -90],
    ['chair', 25, 30, 20],
    ['chair_fallen', 24.4, 31.6, 0],
    ['chair', 20.3, 30.4, -40],
    ['chair', 18.6, 31.8, 120],
    ['locker', 13.35, 29, 90],
    ['trash_can', 13.5, 26, 0],
    ['high_chair', 20.4, 32.2, 170],
    ['trash_bag', 30.4, 32.4, 0],
    ['balloons', 13.6, 32.3, 0],
  ],
  // 7 East Hall. The delivery side: crates, drums, and a coat left on a stand at the corner.
  [
    ['crate', 36.55, 30, 0],
    ['crate', 36.55, 31.05, 0],
    ['barrel', 39.6, 28.4, 0],
    ['barrel', 39.6, 29.1, 0],
    ['crate', 31, 39.05, 0],
    ['barrel', 34.6, 42.1, 0],
    ['cardboard_box', 36.5, 35, 0],
    ['cardboard_box', 36.4, 35.6, 60],
    ['locker', 39.65, 36.8, 270],
    ['pallet', 39.3, 38, 0],
    ['coat_rack', 39.4, 41.9, 225],
    ['wet_floor_sign', 36.9, 37.2, 100],
    ['trash_bag', 36.4, 41.9, 0],
    ['trash_bag', 37.1, 42.1, 90],
    ['fire_extinguisher', 36, 33.5, 90, wall(1.2)],
    ['vent_cover', 40, 35.2, 270, wall(0.5)],
    ...[27, 29].map((z): Placed => ['pipe_run', 36.45, z, 0, HANG]),
    ...[28.5, 30.5, 32.5, 34.5].map((x): Placed => ['duct_run', x, 39.1, 90, HANG]),
  ],
  // 8 Ducts. Nothing but a fan turning at the far end.
  [
    ['wall_fan', 26, 34.75, 270, wall(1.15)],
    ['trash_bag', 25.4, 35.6, 0],
    ['cardboard_box', 18.2, 35.6, 30],
  ],
  // 9 Security Booth. The desk under the wall map, lockers, a coat in the corner.
  [
    ['desk', 20.35, 37.15, 0],
    ['monitor_bank', 20.35, 36.95, 0, { y: 0.75 }],
    ['office_chair', 20.5, 38.3, 20],
    ['locker', 15.6, 36.85, 0],
    ['locker', 16.55, 36.85, 0],
    ['coat_rack', 26.4, 43.4, 200],
    ['cardboard_box', 25.7, 43.5, 15],
    ['fire_extinguisher', 24.9, 44, 180, wall(1.2)],
    ['fuse_box', 22.6, 44, 180, wall(1.5)],
  ],
];

// The floor a prop covers as [x0, z0, x1, z1]. Turned by anything but a
// quarter turn, it is the box round the turned footprint.
export function footprint(name: string, x: number, z: number, yaw = 0, s = 1): Rect {
  // Its callers only ask about the generator and props they found in FOOT.
  const [w, d, ox = 0, oz = 0] = defined(FOOT[name], `the footprint of ${name}`),
    a = ROUND.has(name) ? 0 : (yaw * Math.PI) / 180,
    c = Math.cos(a),
    sn = Math.sin(a);
  const hx = ((w * Math.abs(c) + d * Math.abs(sn)) / 2) * s,
    hz = ((w * Math.abs(sn) + d * Math.abs(c)) / 2) * s;
  x += (ox * c + oz * sn) * s;
  z += (oz * c - ox * sn) * s;
  return [x - hx, z - hz, x + hx, z + hz];
}
// Every solid thing in the building. generator: GENERATOR from map.ts.
export function obstacles(generator: { x: number; z: number; face: number }): Rect[] {
  const out = [
    footprint(
      'generator',
      generator.x - Math.sin(generator.face) * GEN_BACK,
      generator.z - Math.cos(generator.face) * GEN_BACK,
      (generator.face * 180) / Math.PI
    ),
  ];
  for (const rows of DRESSING) for (const [name, x, z, yaw, opt] of rows) if (FOOT[name] && !opt?.soft) out.push(footprint(name, x, z, yaw, opt?.s));
  return out;
}
