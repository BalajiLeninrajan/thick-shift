// Plain-data tables for the lamps and the stage, which the game's light.ts and shell.ts draw. They live here, away
// from three.js, so Node can import them.

// A colour as [r, g, b], 0 to 1.
export type RGB = [number, number, number];

export const TUBE: RGB = [0.8, 0.95, 0.74],
  GREEN: RGB = [0.2, 1, 0.45];
const COLD: RGB = [0.62, 0.82, 1],
  WARM: RGB = [1, 0.66, 0.36],
  RED: RGB = [1, 0.06, 0.04];

// Every lamp has a place, a colour, pow (how bright the floor right under it gets) and reach (metres before it has
// faded to nothing). The rest depends on its kind, so each kind says what it has.
interface LampBase {
  x: number;
  z: number;
  col: RGB;
  pow: number;
  reach: number;
}
// g: the group a fitted lamp belongs to. 'on' is steady; fa, fb and fc flicker in their own ways; 'exit' has a
// battery and outlives the power.
export type LampGroup = 'on' | 'fa' | 'fb' | 'fc' | 'exit';
// The fields a kind of lamp does not have read as undefined, so code that treats every lamp alike can still ask
// (`l.y ?? ceiling`), and code that has checked l.kind gets the fields that kind always has.
type Without<K extends 'g' | 'dir' | 'y' | 'n' | 'by'> = { [F in K]?: never };
export type Lamp = LampBase &
  (
    | ({ kind: 'tube'; g: LampGroup; dir: 'x' | 'z' } & Without<'y' | 'n' | 'by'>) // a ceiling fitting, running along dir
    | ({ kind: 'bulb'; g: LampGroup; y: number } & Without<'dir' | 'n' | 'by'>) // bare, hanging at y
    | ({ kind: 'red'; g: LampGroup; n: [number, number] } & Without<'dir' | 'y' | 'by'>) // an emergency bulkhead on a wall facing n
    | ({ kind: 'exit'; g: LampGroup; y: number; n: [number, number] } & Without<'dir' | 'by'>) // a sign on a wall facing n
    // No fitting: the light of a prop with a lit screen or bulbs, named by `by`, and only there once that prop has
    // loaded.
    | ({ kind: 'glow'; by: string; y: number } & Without<'g' | 'dir' | 'n'>)
  );

export const LAMPS: Lamp[] = [
  { kind: 'bulb', g: 'on', x: 18.5, z: 7.6, y: 2.7, col: WARM, pow: 0.9, reach: 10 }, // the stage's ghost light
  { kind: 'tube', g: 'fc', x: 13.5, z: 2.2, dir: 'x', col: TUBE, pow: 0.8, reach: 9 },
  { kind: 'tube', g: 'fa', x: 37.5, z: 2.8, dir: 'x', col: TUBE, pow: 0.7, reach: 8 }, // over the generator
  { kind: 'glow', by: 'vanity', x: 31, z: 9.6, y: 1.6, col: WARM, pow: 0.28, reach: 4.5 },
  { kind: 'glow', by: 'arcade_cabinet', x: 1.4, z: 15.5, y: 1.4, col: [0.2, 0.8, 1], pow: 0.4, reach: 5.5 },
  { kind: 'glow', by: 'arcade_cabinet', x: 1.4, z: 20.5, y: 1.4, col: [1, 0.25, 0.8], pow: 0.34, reach: 5.5 },
  { kind: 'glow', by: 'claw_machine', x: 10.1, z: 23.4, y: 1.5, col: [1, 0.85, 0.4], pow: 0.26, reach: 4.5 },
  { kind: 'tube', g: 'fb', x: 6, z: 17.5, dir: 'z', col: TUBE, pow: 0.4, reach: 7 },
  { kind: 'tube', g: 'on', x: 15.5, z: 15, dir: 'x', col: TUBE, pow: 0.42, reach: 9 },
  { kind: 'tube', g: 'fa', x: 23.5, z: 21.5, dir: 'x', col: TUBE, pow: 0.45, reach: 9 },
  { kind: 'tube', g: 'on', x: 31, z: 20.5, dir: 'z', col: COLD, pow: 0.42, reach: 8 },
  { kind: 'tube', g: 'fb', x: 38.5, z: 14.5, dir: 'z', col: COLD, pow: 0.42, reach: 7 },
  { kind: 'red', g: 'on', x: 2, z: 29.5, n: [1, 0], col: RED, pow: 0.36, reach: 6.5 },
  { kind: 'red', g: 'on', x: 2, z: 36.5, n: [1, 0], col: RED, pow: 0.36, reach: 6.5 },
  { kind: 'red', g: 'on', x: 10, z: 42.5, n: [0, -1], col: RED, pow: 0.36, reach: 6.5 },
  { kind: 'tube', g: 'fc', x: 4, z: 33, dir: 'z', col: TUBE, pow: 0.6, reach: 7 },
  { kind: 'red', g: 'on', x: 40, z: 29.5, n: [-1, 0], col: RED, pow: 0.36, reach: 6.5 },
  { kind: 'red', g: 'on', x: 40, z: 36.5, n: [-1, 0], col: RED, pow: 0.36, reach: 6.5 },
  { kind: 'red', g: 'on', x: 32, z: 42.5, n: [0, -1], col: RED, pow: 0.36, reach: 6.5 },
  { kind: 'tube', g: 'fa', x: 38, z: 33, dir: 'z', col: TUBE, pow: 0.5, reach: 7 },
  { kind: 'tube', g: 'fa', x: 24.5, z: 30, dir: 'x', col: TUBE, pow: 0.6, reach: 8 },
  { kind: 'glow', by: 'soda_machine', x: 29.8, z: 29, y: 1.4, col: COLD, pow: 0.4, reach: 5 },
  { kind: 'glow', by: 'popcorn_cart', x: 17.6, z: 27.1, y: 1.6, col: WARM, pow: 0.2, reach: 4 },
  { kind: 'tube', g: 'on', x: 21, z: 40.4, dir: 'x', col: [1, 0.82, 0.58], pow: 1.7, reach: 9 }, // the booth, the one warm room
  { kind: 'glow', by: 'monitor_bank', x: 21, z: 37.4, y: 1.3, col: [0.4, 1, 0.7], pow: 0.22, reach: 3.5 },
  { kind: 'exit', g: 'exit', x: 19.3, z: 11, y: 3.85, n: [0, -1], col: GREEN, pow: 0.2, reach: 5 },
  { kind: 'exit', g: 'exit', x: 19.3, z: 25, y: 3.85, n: [0, -1], col: GREEN, pow: 0.2, reach: 5 },
  { kind: 'exit', g: 'exit', x: 4, z: 25, y: 3.62, n: [0, -1], col: GREEN, pow: 0.2, reach: 5 },
  { kind: 'exit', g: 'exit', x: 35.3, z: 11, y: 3.62, n: [0, -1], col: GREEN, pow: 0.2, reach: 5 },
  { kind: 'exit', g: 'exit', x: 6, z: 27, y: 2.75, n: [-1, 0], col: GREEN, pow: 0.2, reach: 5 },
  { kind: 'exit', g: 'exit', x: 36, z: 27, y: 2.75, n: [1, 0], col: GREEN, pow: 0.2, reach: 5 },
];
// Fittings with nothing in them, so the lit ones read as the last survivors. [x, z, the way the tube runs]
export const DEAD_TUBES: [number, number, 'x' | 'z'][] = [
  [23.5, 15, 'x'],
  [15.5, 21.5, 'x'],
  [19.5, 18.2, 'x'],
  [38.5, 20.5, 'z'],
  [31, 14.5, 'z'],
  [4, 27, 'z'],
  [8, 40.5, 'x'],
  [38, 27, 'z'],
  [34, 40.5, 'x'],
  [16.5, 29, 'x'],
  [33, 6, 'x'],
  [22, 4, 'x'],
  [5, 22.5, 'z'],
];

// The north end of the stage room is a low platform. Mascots and guards do
// not climb it (the game is flat), so it is only as high as a foot can hide.
export const STAGE = { room: 0, edge: 8.2, rise: 0.12 };
