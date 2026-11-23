// Shapes that cross from one part of the client to another: the overlay screens, this guard as player.ts keeps it,
// what it can reach, the look settings, the parts of the building outline.ts edges, and the handles other modules
// take. Types only: nothing here exists at runtime. The state that goes over the wire (S, its guards and
// mascots, events, actions) is in @thick-shift/sim/types.
//
// A handle (what a create...() function returns) is typed from the function itself, so it follows the code as it
// changes. The data shapes are written out, because two modules have to agree on them.

import type { DoorKey, EventType, GuardAct, Point, SimEvent } from '@thick-shift/sim/types';
import type { Object3D } from 'three';
import type { createActors } from './three/actors';
import type { createPlayer } from './three/player';
import type { createTask } from './three/task';

/* ---------- the overlay (ui.ts, and an app's platform hooks in state.ts) ---------- */

// One overlay screen. The overlay is redrawn only when key changes; wire() then hooks up its buttons.
export interface OverlayScreen {
  key: string;
  html: string;
  wire?: () => void;
}
// An app's lobby invite, shown in place of the room code and link.
export interface Invite {
  html: string;
  wire?: () => void;
}
// Why the session cannot go on (game.error): the message screen's heading and line.
export interface GameError {
  title: string;
  detail: string;
}

/* ---------- this guard (three/player.ts) ---------- */

// Look settings, kept in localStorage between visits. sens multiplies the mouse's radians per pixel. outline: a gold
// edge round usable things (outline.ts). third: a flat guard watches teammates from behind them (app.ts spectate).
export interface Prefs {
  sens: number;
  invert: boolean;
  outline: boolean;
  third: boolean;
}

// What a guard's use key would act on (player.ts findTarget): the field names follow the 'use' action it sends.
// what: also 'crank' and 'charge', which are held (hold -1) and so set Me.act instead of sending a 'use'.
// at: where it is, for distance and facing. hold: seconds to hold the use key, 0 for a tap, -1 for as long as it is
// held. Each kind carries the one handle it needs: i, a box, battery spot or locker; k, a door; id, a toy (number)
// or a flat guard (string). The others read as undefined, so the 'use' action can copy all three.
export type Target = { at: Point; label: string; hold: number } & (
  | { what: 'fix' | 'bat' | 'hide'; i: number; k?: never; id?: never }
  | { what: 'door'; k: DoorKey; i?: never; id?: never }
  | { what: 'toy'; id: number; i?: never; k?: never }
  | { what: 'peel'; id: string; i?: never; k?: never }
  | { what: 'crank' | 'charge' | 'carton'; i?: never; k?: never; id?: never }
);

// This guard as their own browser has them (player.me), ahead of what the room sends back. yaw 0 faces south (+z).
// Read by the HUD, touch, sound, outline, the actors, the phone and the slats; only player.ts writes it, apart from
// touch, which sets touch.
export interface Me {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  on: boolean; // torch on
  stam: number; // stamina, 0 to 1
  sp: boolean; // sprinting
  act: GuardAct;
  bob: number; // walking phase, radians
  target: Target | null;
  hold: number; // seconds the use key has been held on target
  moving: number; // how far the guard moved this frame, as slide() returns it
  locked: boolean; // there is a way to play: a locked pointer, touch, a gamepad or the keyboard, and no pause
  flat: boolean;
  paused: boolean; // the pause panel is up: nothing here moves the guard
  touch: boolean; // a finger is driving (set by touch.ts), so there is no pointer to lock
  pad: boolean; // a gamepad button was the last thing pressed, so the prompt names the pad's button
  watch: string | null; // id of the teammate a flat guard is watching through
  ph: boolean; // the phone is up, showing the minimap
  task: { i: number; at: number } | null; // hands in a breaker box: the box, and when its fault broke out (Fault.at)
  zoom: boolean; // the minimap shows the whole building
  threw: number; // performance.now() of the last Mini Biggs thrown,
  dry: number; // of the last try without the battery for one,
  empty: number; // and of the last try with empty hands
  hid: number; // the locker (HIDES index) this guard is in, as the room has it, or -1
}

/* ---------- the frame (three/app.ts and what it puts together) ---------- */

// The building's usable parts that outline.ts can put an edge round (world/usable.ts).
export interface WorldParts {
  boxes: Object3D[]; // by BOXES index
  bats: Object3D[]; // by BATTERY_SPOTS index
  gen: Object3D;
  dock: Object3D;
  panels: Record<DoorKey, Object3D>;
}

// One thing to outline this frame (outline.ts to post.ts). col: linear RGB, 0 to 1. a: how strongly, 0 to 1.
export interface OutlineMark {
  obj: Object3D;
  col: [number, number, number];
  a: number;
}

// One event from S.evs, narrowed to its type: EventOf<'flat'>['x'] is { id, by, x, z }.
export type EventOf<K extends EventType> = Extract<SimEvent, { type: K }>;

// three/app.ts, which main.ts imports the first time a night is drawn.
export type FloorModule = typeof import('./three/app');
export type Actors = ReturnType<typeof createActors>;
export type PlayerHandle = ReturnType<typeof createPlayer>;
export type Task = ReturnType<typeof createTask>;
