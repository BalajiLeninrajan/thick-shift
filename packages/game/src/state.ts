// The mutable objects every module shares.
import type { State } from '@thick-shift/sim/types';
import type { GameError, Invite, OverlayScreen } from './types';

export interface Game {
  S: State | null;
  code: string;
  myName: string;
  myId: string;
  netNote: string;
  joining: boolean;
  error: GameError | null;
}

// game: the session. S is the state the room runs and sends (net.ts), or that this page runs itself in a night
// played solo. Nothing outside net.ts and the sim changes it.
export const game: Game = {
  S: null,
  code: '',
  myName: '',
  myId: '', // this guard's id in S.players, made up by net.ts
  netNote: '', // status line shown in the lobby
  joining: false,
  error: null, // { title, detail } when the session cannot continue
};

// game.S, for code that runs only once a room exists: the floor's frame and the guard's own controls. Code that
// can run before then (the title screen, the overlay) checks game.S itself.
export function currentState(): State {
  if (!game.S) throw new Error('no room state yet');
  return game.S;
}

export interface Client {
  holdUntil: number;
}

// client: what this browser is looking at. Never sent over the network.
export const client: Client = {
  holdUntil: 0, // performance.now() before which the end card waits, for the catch and a look at what sat on you
};

// A catch, in seconds: how long it plays, and how long the caught guard then lies looking up at what sat on them
// before the night's end card.
export const CATCH_S = 1.5,
  LINGER_S = 1.5;

export interface Platform {
  fixedRoom: boolean;
  title: (() => OverlayScreen) | null;
  invite: (() => Invite) | null;
}

// platform: what changes when an app runs the game inside something else, such as a Discord Activity
// (apps/discord/src/activity.ts). Set by the app before start(). The web game leaves it as it is.
export const platform: Platform = {
  fixedRoom: false, // the room comes from outside, and everyone opens the same one (net.ts)
  title: null, // () => screen ({ key, html, wire }), shown in place of the title screen (ui.ts)
  invite: null, // () => { html, wire }, shown in the lobby in place of the room code and link (ui.ts)
};

export const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
