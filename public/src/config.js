// Static game data. Nothing in here changes at runtime.

export const W = 800;          // canvas logical width
export const H = 450;          // canvas logical height
export const WORLD = 1600;     // width of the pannable office
export const HOUR = 45;        // seconds per in-game hour
export const FINAL_NIGHT = 5;  // survive this one and the game is won
export const PREFIX = 'thick-shift-v1-';   // PeerJS id namespace

// The building. Rooms 0 to 8 have cameras; 9 to 11 are the three ways into the booth.
//
//   Stage ----- Backstage
//     |             |
//   Main Hall --- Kitchen          Arcade is west of the Main Hall.
//    |    \         |             Snack Bar hangs off the Main Hall/Kitchen corridor.
//   Arcade  Snack  East Hall
//     |       |       |
//   West Hall Ducts   |
//     |       |       |
//   LEFT    VENT    RIGHT
// Numbered the way the camera map reads: left to right, top to bottom.
export const ROOMS = ['Storage Stage', 'Backstage', 'Arcade', 'Main Hall', 'Kitchen', 'West Hall', 'Snack Bar', 'East Hall', 'Ducts', 'LEFT DOOR', 'RIGHT DOOR', 'VENT'];
export const CAM_ROOMS = 9;
export const DOORKEY = { 9: 'L', 10: 'R', 11: 'V' };
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

// paths: the routes a mascot can take, as room indices from where it rests to
// the door it ends up at. It picks one each time it sets off. Routes differ in
// length and in which door they reach, so where a mascot is on the cameras
// tells you how long you have and which way it is coming.
export const MASC = [
  { k: 'hippo', name: 'Big Biggs', col: '#9a7fc4', belly: '#e6c8ee', paths: [[0, 3, 2, 5, 9], [0, 3, 4, 7, 10]], from: 0, ag: 1, how: 'sat on you' },
  { k: 'walrus', name: 'Madame Flan', col: '#b98a6e', belly: '#f5e0dc', paths: [[0, 1, 4, 7, 10], [0, 3, 2, 5, 9]], from: 0, ag: 1, how: 'hugged you a bit too hard' },
  { k: 'toad', name: 'Squish', col: '#5f8f66', belly: '#cfe2a8', paths: [[6, 8, 11], [6, 4, 7, 10]], from: 2, ag: .7, how: 'found a way in' },
  { k: 'rhino', name: 'Tank', col: '#7d8299', belly: '#a6adc8', paths: [[1, 0, 3, 2, 5, 9], [1, 4, 7, 10]], from: 9, ag: .8, how: 'did not slow down' },
];
