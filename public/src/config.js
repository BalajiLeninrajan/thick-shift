// Static game data. Nothing in here changes at runtime.

export const W = 800;          // canvas logical width
export const H = 450;          // canvas logical height
export const WORLD = 1600;     // width of the pannable office
export const HOUR = 45;        // seconds per in-game hour
export const FINAL_NIGHT = 5;  // survive this one and the game is won
export const PREFIX = 'thick-shift-v1-';   // PeerJS id namespace

export const ROOMS = ['Storage Stage', 'Main Hall', 'West Hall', 'East Hall', 'Snack Bar', 'LEFT DOOR', 'RIGHT DOOR', 'VENT'];
export const CAM_ROOMS = 5;    // the first five rooms have cameras
export const DOORKEY = { 5: 'L', 6: 'R', 7: 'V' };
export const DOORS = ['L', 'V', 'R'];

// Office hit zones in world coordinates. Rendering and input both read these.
export const ZONES = {
  L: { x: 90, y: 70, w: 200, h: 300 },
  R: { x: 1310, y: 70, w: 200, h: 300 },
  V: { x: 700, y: 40, w: 200, h: 90 },
  monitor: { x: 730, y: 250, w: 140, h: 82 },
  crank: { x: 922, y: 292, w: 56, h: 40 },
};

// Mocha palette. Every canvas color is one of these or a mix of them.
export const P = {
  ink: '#08080e', crust: '#11111b', mantle: '#181825', base: '#1e1e2e',
  surface0: '#313244', surface1: '#45475a', surface2: '#585b70',
  overlay0: '#6c7086', overlay1: '#7f849c', overlay2: '#9399b2',
  subtext0: '#a6adc8', subtext1: '#bac2de', text: '#cdd6f4',
  rosewater: '#f5e0dc', flamingo: '#f2cdcd', pink: '#f5c2e7', mauve: '#cba6f7',
  red: '#f38ba8', maroon: '#eba0ac', peach: '#fab387', yellow: '#f9e2af',
  green: '#a6e3a1', teal: '#94e2d5', sky: '#89dceb', sapphire: '#74c7ec',
  blue: '#89b4fa', lavender: '#b4befe',
};

// paths: room indices from spawn to the door the mascot ends up at.
// from: in-game hours (across nights) before the mascot wakes up.
// ag: aggression multiplier. col: fur colour, belly: the costume's front patch.
export const MASC = [
  { k: 'hippo', name: 'Big Biggs', col: '#9a7fc4', belly: '#e6c8ee', paths: [[0, 1, 2, 5]], from: 0, ag: 1, how: 'sat on you' },
  { k: 'walrus', name: 'Madame Flan', col: '#b98a6e', belly: '#f5e0dc', paths: [[0, 1, 3, 6]], from: 0, ag: 1, how: 'hugged you a bit too hard' },
  { k: 'toad', name: 'Squish', col: '#5f8f66', belly: '#cfe2a8', paths: [[4, 7]], from: 2, ag: .55, how: 'somehow fit through the vent' },
  { k: 'rhino', name: 'Tank', col: '#7d8299', belly: '#a6adc8', paths: [[0, 1, 2, 5], [0, 1, 3, 6]], from: 9, ag: .8, how: 'did not slow down' },
];
