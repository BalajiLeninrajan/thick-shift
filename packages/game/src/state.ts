// The mutable objects every module shares.
import type { State } from '@thick-shift/sim/types';
import type { GameError, Invite, OverlayScreen } from './types';

export interface Game {
  S: State | null;
  isHost: boolean;
  code: string;
  myName: string;
  myId: string;
  netNote: string;
  joining: boolean;
  error: GameError | null;
}

// game: the session. S is the authoritative state the host simulates and
// broadcasts; guests only ever read it.
export const game: Game = {
  S: null,
  isHost: false,
  code: '',
  myName: '',
  myId: '', // this player's id in S.players: 'host', or the guest's peer id
  netNote: '', // status line shown in the lobby
  joining: false,
  error: null, // { title, detail } when the session cannot continue
};

// game.S, for code that runs only once a room exists: the floor's frame, the host's step, the dev menu. Code that
// can run before then (the title screen, the overlay) checks game.S itself.
export function currentState(): State {
  if (!game.S) throw new Error('no room state yet');
  return game.S;
}

export interface Client {
  lastEv: number;
  holdUntil: number;
}

// client: what this browser is looking at. Never sent over the network.
export const client: Client = {
  lastEv: 0, // id of the last event we reacted to
  holdUntil: 0, // performance.now() before which the end card waits, for the catch and a look at what sat on you
};

export interface Platform {
  fixedRoom: boolean;
  title: (() => OverlayScreen) | null;
  invite: (() => Invite) | null;
}

// platform: what changes when an app runs the game inside something else, such as a Discord Activity
// (apps/discord). Set by that app's src/boot.ts before start(). The web game leaves it as it is.
export const platform: Platform = {
  fixedRoom: false, // the room comes from outside: everyone tries to host it, and whoever finds it taken joins (net.ts)
  title: null, // () => screen ({ key, html, wire }), shown in place of the title screen (ui.ts)
  invite: null, // () => { html, wire }, shown in the lobby in place of the room code and link (ui.ts)
};

export const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
