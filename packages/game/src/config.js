// Static game data. Nothing in here changes at runtime. The building itself is three/map.js.

export const FINAL_NIGHT = 5; // survive this one and the game is won
export const DOORS = ['L', 'V', 'R']; // the booth's three ways in: left door, vent, right door

// The mascots, by index. k names the model files (packages/game/public/models/<k>_*.glb) and the tuning in
// three/actors/styles.js; col colours its blip on the booth's wall map and its stand-in until the model loads.
export const MASC = [
  { k: 'hippo', name: 'Big Biggs', col: '#9a7fc4' },
  { k: 'walrus', name: 'Madame Flan', col: '#b98a6e' },
  { k: 'toad', name: 'Squish', col: '#5f8f66' },
  { k: 'rhino', name: 'Tank', col: '#7d8299' },
];
