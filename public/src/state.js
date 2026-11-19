// The two mutable objects every module shares.

// game: the session. S is the authoritative state the host simulates and
// broadcasts; guests only ever read it.
export const game = {
  S: null,
  isHost: false,
  players: {},      // host only: peer id -> that guard's record in S.players
  code: '',
  myName: '',
  myId: '',         // this player's id in S.players: 'host', or the guest's peer id
  netNote: '',      // status line shown in the lobby
  joining: false,
  error: null,      // { title, detail } when the session cannot continue
  discord: null,    // inside a Discord Activity: { room, name }, both '' until Discord answers (discord.js)
};

// client: what this browser is looking at. Never sent over the network.
export const client = {
  lastEv: 0,        // id of the last event we reacted to
  holdUntil: 0,     // performance.now() before which the end card waits, for the catch and a look at what sat on you
};

export const rnd = (a, b) => a + Math.random() * (b - a);
