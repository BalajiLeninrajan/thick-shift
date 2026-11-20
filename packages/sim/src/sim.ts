// The night simulation's API, as packages/sim/CONTRACT.md lays it out. The night itself is still in
// packages/game/src/three/sim3d.js; it moves here behind these signatures, and until then every function throws.
// F and TOY already hold the real numbers, copied from sim3d.js, because the client reads them.
import type { Action, Brain, NightState, Player, Point, Rng, State } from './types.ts';

const notPorted = (name: string): never => {
  throw new Error(`@thick-shift/sim: ${name} is not ported yet (it is still in packages/game/src/three/sim3d.js)`);
};

// Tuning. Clients read some of these to draw bars and prompts.
export const F = {
  HOUR: 70, // seconds per in-game hour: a night is seven minutes
  WALK: 3,
  SPRINT: 5.2,
  // Seconds of light in a full torch, what a spare battery adds, and charge per second at the booth dock. The
  // battery numbers were tuned with a one-minute dock (a competent guard spent a quarter to a third of night 5
  // under a quarter of a torch); the dock is now four times faster at the same power per torch, untuned.
  BAT_LIFE: 65,
  // The phone's minimap is meant for a glance. It draws on the torch's battery at PHONE times the torch's rate:
  // a full battery lasts 16 seconds with only the phone up and 13 with the torch on too, so a two-second look
  // costs an eighth of a battery. While it is up the guard walks at PHONE_WALK of their pace and cannot run
  // (player.js), and the torch hangs at the floor and holds nothing (beamOn). Not tuned in the balance harness,
  // whose guards never use it.
  PHONE: 4,
  PHONE_WALK: 0.6,
  BAT_PICKUP: 0.5,
  CHARGE: 1 / 15, // a full torch in 15 s at the dock (it was a minute, which felt like standing still for nothing)
  REACH: 2.2, // how close you must be to use something
  PEEL_HOLD: 3,
  HIDE_HOLD: 0.5, // seconds of holding the use key (timed by the client)
  // Seconds a fault takes to fix, by kind: the length of its minigame for a steady hand (the client times it; the
  // balance harness's guards hold use this long).
  FIX: [1.8, 2.4, 2.2],
  BEAM_RANGE: 12,
  BEAM_HALF: 0.3, // how far and how wide (radians) a torch holds a mascot
  CATCH: 1.25, // a mascot this close has you
  GRAB: 2.6, // and one that cannot get closer than this reaches in for you, after GRAB_TIME
  CALL_GAP: 3, // seconds between a flat guard's calls for help
  RESTART: 14, // with the power out, the crank has to put this much back before anything works again
};

// Mini Biggs: a palm-sized plush of Big Biggs on a keyring, from the gift shop, with a voice box that sings "Happy
// Birthday from Big Biggs!". Each guard clocks in holding one (p.toy) and holds one at most. Its own cell died years
// ago, so a guard tops it up from the torch: a throw costs `cost` of the battery (one of the five bars on the HUD)
// and needs that much left. It is thrown along the guard's view, no further than `range` metres, and flies at `speed`
// metres a second over the furniture until a wall or a shut door stops it. Where it lands it sings for `sing`
// seconds, which is a noise() of `hear` metres at `chance`: whatever is wandering or searching nearby goes to look,
// and whatever is already after a guard does not, so it buys a way past, not a way out. Then it lies there (S.toys)
// until a guard with empty hands picks it up, which means walking to where the mascots were sent. The cost was set
// against the harness, whose competent and expert guards throw theirs at a wanderer in their way while they have the
// battery to spare and go back for it once things are quiet. Light spent on a song is light not holding a mascot off.
export const TOY = { cost: 0.2, range: 14, speed: 11, hear: 12, chance: 0.9, sing: 3 };

// How the night's battery spots are shuffled. 'sort' is the game's: a sort with a random comparator. 'fisher-yates'
// is the Roblox port's, which the recorder for tools/roblox/diff asks for so the two draw alike.
export type Shuffle = 'sort' | 'fisher-yates';

export interface SimOptions {
  rng: Rng; // every random draw the night makes
  now: number; // milliseconds on the caller's clock, as performance.now() gives: the start of the first step
  shuffle?: Shuffle; // 'sort' unless given
}

// What only the host knows: the guards in the room and the mascots' thinking. The caller makes one with newSim() and
// passes it, with S, to every call below. Nothing else in the package keeps state about a night.
export interface Sim {
  rng: Rng; // the caller may swap it between calls
  shuffle: Shuffle;
  players: Record<string, Player>; // peer id -> that guard's record, the same object as their entry in S.players
  brains: Brain[]; // by MASC index
  batTimers: number[]; // seconds until each taken battery turns up somewhere else, soonest first
  crankNoise: number; // seconds until the turning crank is heard again
  nextFault: number; // seconds until the next fault breaks out
  lastStep: number; // the `now` of the last stepFloor or adoptFloor, or of newSim
}

export function newSim(opts: SimOptions): Sim {
  return { rng: opts.rng, shuffle: opts.shuffle ?? 'sort', players: {}, brains: [], batTimers: [], crankNoise: 0, nextFault: 0, lastStep: opts.now };
}

// The balance harness reads what a mascot is after. Nothing in the game does.
export const brainOf = (sim: Sim, i: number): Brain => sim.brains[i];

// A room's state before its first night.
export function newState(code: string): State {
  return notPorted(`newState(${code})`);
}
// Start night n: the guards in sim.players on their spawn points, the mascots on their marks.
export function startFloorNight(sim: Sim, S: State, n: number): void {
  notPorted(`startFloorNight(${n})`);
}
// Back to night 1 with the run's counts cleared.
export function restartFloor(sim: Sim, S: State): void {
  notPorted('restartFloor');
}
// A guest taking over from a host who left: rebuild sim's thinking from S. now: as for stepFloor.
export function adoptFloor(sim: Sim, S: State, now: number): void {
  notPorted('adoptFloor');
}
// One tick, of however long it has been since the last (at most a quarter second). now: milliseconds.
export function stepFloor(sim: Sim, S: State, now: number): void {
  notPorted('stepFloor');
}
// One guard's action, from their own browser or off the wire.
export function actFloor(sim: Sim, S: State, pid: string, a: Action): void {
  notPorted(`actFloor(${pid}, ${a.t})`);
}

// Pure questions about S, for the clients.
export function hourF(S: State): number {
  return notPorted('hourF');
}
export function clockF(S: State): string {
  return notPorted('clockF');
}
export function lightsF(S: State): boolean {
  return notPorted('lightsF');
}
export function dreadF(S: State): number {
  return notPorted('dreadF');
}
export function darkRoom(S: NightState, room: number): boolean {
  return notPorted(`darkRoom(${room})`);
}
export function faultLeft(S: NightState, f: { at: number }): number {
  return notPorted('faultLeft');
}
export function landing(S: State, x: number, z: number, yaw: number, d: number): Point {
  return notPorted('landing');
}
