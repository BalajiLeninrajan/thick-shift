// Static game data. Nothing in here changes at runtime. The building itself is map.ts.
import type { DoorKey, MascotIndex, PerMascot } from './types.ts';

export const FINAL_NIGHT = 5; // survive this one and the game is won
export const DOORS: readonly DoorKey[] = ['L', 'V', 'R']; // the booth's three ways in: left door, vent, right door
// A guard's breath for running, from 0 to 1: what a second of sprinting costs, what a second of rest gives back, and
// the seconds without sprinting before it starts to come back. The sim only reads whether a guard is sprinting
// (Guard.sp), so each client spends the breath itself, and so do the balance harness's guards.
export const STAMINA = { drain: 1 / 4.5, gain: 1 / 7, rest: 1 };
// How near a mascot has to be, in metres, to show on a guard's phone: enough to see across a room from its doorway.
// Further off, only the booth's cameras show it.
export const PHONE_NEAR = 15;

// A guard's name: what one who gave none is called, and the most characters the sim keeps of one. 32 is Discord's
// limit for a display name, so a Discord name always fits whole.
export const DEFAULT_NAME = 'Guard',
  NAME_MAX = 32;

// The cast's model names, one per MascotKind.k.
export type MascotKey = 'hippo' | 'walrus' | 'toad' | 'rhino';
// One of the cast. k names the model files (packages/game/public/models/<k>_*.glb) and the tuning in
// packages/game/src/three/actors/styles.ts; col colours its stand-in until the model loads.
export interface MascotKind {
  k: MascotKey;
  name: string;
  col: string;
}

// The mascots, by MascotIndex.
export const MASC: PerMascot<MascotKind> = [
  { k: 'hippo', name: 'Big Biggs', col: '#9a7fc4' },
  { k: 'walrus', name: 'Madame Flan', col: '#b98a6e' },
  { k: 'toad', name: 'Squish', col: '#5f8f66' },
  { k: 'rhino', name: 'Greg', col: '#7d8299' },
];
// The cast by name, for the code that treats one of them differently.
export const BIGGS = 0,
  FLAN = 1,
  SQUISH = 2,
  GREG = 3;
// Every MascotIndex in order, to walk the cast or build a table per mascot with MASCOTS.map(i => ...), where i is
// a MascotIndex rather than the plain number MASC.map would give.
export const MASCOTS: PerMascot<MascotIndex> = [0, 1, 2, 3];
// A table with one entry per mascot, made in MascotIndex order. Unlike MASCOTS.map, the result is a PerMascot, so
// it can be read by m.i with no check.
export const perMascot = <T>(make: (i: MascotIndex) => T): PerMascot<T> => [make(0), make(1), make(2), make(3)];
