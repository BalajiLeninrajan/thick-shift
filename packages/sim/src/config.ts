// Static game data. Nothing in here changes at runtime. The building itself is map.ts.
import type { DoorKey } from './types.ts';

export const FINAL_NIGHT = 5; // survive this one and the game is won
export const DOORS: DoorKey[] = ['L', 'V', 'R']; // the booth's three ways in: left door, vent, right door

// One of the cast. k names the model files (packages/game/public/models/<k>_*.glb) and the tuning in
// packages/game/src/three/actors/styles.js; col colours its blip on the booth's wall map and its stand-in until the model loads.
export interface MascotKind {
  k: string;
  name: string;
  col: string;
  // The game's art.js paints a belly in this colour on the posters. No mascot has one yet, so it paints with none.
  belly?: string;
}

// The mascots, by index.
export const MASC: MascotKind[] = [
  { k: 'hippo', name: 'Big Biggs', col: '#9a7fc4' },
  { k: 'walrus', name: 'Madame Flan', col: '#b98a6e' },
  { k: 'toad', name: 'Squish', col: '#5f8f66' },
  { k: 'rhino', name: 'Tank', col: '#7d8299' },
];
