// The two mutable objects every module shares.

// game: the session. S is the authoritative state the host simulates and
// broadcasts; guests only ever read it.
export const game = {
  S: null,
  isHost: false,
  players: {},      // host only: peer id -> { name, view }
  code: '',
  myName: '',
  myId: '',         // this player's id in S.players: 'host', or the guest's peer id
  netNote: '',      // status line shown in the lobby
  joining: false,
  error: null,      // { title, detail } when the session cannot continue
};

// client: what this browser is looking at. Never sent over the network.
export const client = {
  view: 'office',   // 'office' | 'cams' | 'crank'
  cam: 0,
  signal: 1,        // camera feed quality, 1 to 0. Drops while watching (see camDrain)
  pan: 400,
  panT: 400,        // pan eases toward this
  tilt: false,
  lastEv: 0,        // id of the last event we reacted to
  shake: 0,
  glitch: 0,
  scareT: 0,        // frames of jumpscare left
  fumbleT: 0,       // frames left to show that a door did not shut
  deadT: 0,         // frames left to show that a door's breaker is out
  deadK: null,      // which door that was
  door: { L: 0, V: 0, R: 0 },   // animated door positions, 0 open to 1 shut
};

export const rnd = (a, b) => a + Math.random() * (b - a);
