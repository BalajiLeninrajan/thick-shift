// The mutable objects every module shares.

// game: the session. S is the authoritative state the host simulates and
// broadcasts; guests only ever read it.
export const game = {
  S: null,
  isHost: false,
  players: {}, // host only: peer id -> that guard's record in S.players
  code: '',
  myName: '',
  myId: '', // this player's id in S.players: 'host', or the guest's peer id
  netNote: '', // status line shown in the lobby
  joining: false,
  error: null, // { title, detail } when the session cannot continue
};

// client: what this browser is looking at. Never sent over the network.
export const client = {
  lastEv: 0, // id of the last event we reacted to
  holdUntil: 0, // performance.now() before which the end card waits, for the catch and a look at what sat on you
};

// platform: what changes when an app runs the game inside something else, such as a Discord Activity
// (apps/discord). Set by that app's src/boot.js before start(). The web game leaves it as it is.
export const platform = {
  fixedRoom: false, // the room comes from outside: everyone tries to host it, and whoever finds it taken joins (net.js)
  title: null, // () => screen ({ key, html, wire }), shown in place of the title screen (ui.js)
  invite: null, // () => { html, wire }, shown in the lobby in place of the room code and link (ui.js)
};

export const rnd = (a, b) => a + Math.random() * (b - a);
