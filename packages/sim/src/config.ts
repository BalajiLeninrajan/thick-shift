// Static game data. Nothing in here changes at runtime. The building itself is map.ts.
import type { DoorKey, MascotIndex, PerMascot } from './types.ts';

export const FINAL_NIGHT = 5; // survive this one and the game is won
export const DOORS: readonly DoorKey[] = ['L', 'V', 'R']; // the booth's three ways in: left door, vent, right door

// The cast's model names, one per MascotKind.k.
export type MascotKey = 'hippo' | 'walrus' | 'toad' | 'rhino';
// One of the cast. k names the model files (packages/game/public/models/<k>_*.glb) and the tuning in
// packages/game/src/three/actors/styles.ts; col colours its blip on the booth's wall map and its stand-in until the model loads.
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
  { k: 'rhino', name: 'Stompy', col: '#7d8299' },
];
// The cast by name, for the code that treats one of them differently.
export const BIGGS = 0,
  FLAN = 1,
  SQUISH = 2,
  STOMPY = 3;
// Every MascotIndex in order, to walk the cast or build a table per mascot with MASCOTS.map(i => ...), where i is
// a MascotIndex rather than the plain number MASC.map would give.
export const MASCOTS: PerMascot<MascotIndex> = [0, 1, 2, 3];
// A table with one entry per mascot, made in MascotIndex order. Unlike MASCOTS.map, the result is a PerMascot, so
// it can be read by m.i with no check.
export const perMascot = <T>(make: (i: MascotIndex) => T): PerMascot<T> => [make(0), make(1), make(2), make(3)];
