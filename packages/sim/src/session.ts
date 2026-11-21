// What whoever runs a night does with the guards' browsers: let them in and out of the room (joinFloor, leaveFloor)
// and act on what they send (commandFloor): an action for actFloor, 'go' for the next night, or a dev cheat. Every
// message is someone else's JSON, so like actFloor this checks every field it reads.

import { isPlaced } from './check.ts';
import { FINAL_NIGHT } from './config.ts';
import { REST } from './map.ts';
import { actFloor, F, hourF, restartFloor, type Sim, startFloorNight } from './sim.ts';
import type { Command, Dev, DevCommand, DevDo, Player, State } from './types.ts';

// Every cheat off. A missing field in S.dev reads as this.
export const DEV_OFF: Dev = { god: false, power: false, freeze: false, wake: false, speed: 1, rot: -1, dread: -1 };

// A guard comes into the room. One coming back keeps their record, and with it their place on the floor: was, or the
// one S still has. Anyone else gets placed by the next step (stepFloor).
export function joinFloor(sim: Sim, S: State, id: string, was?: Player): void {
  if (!Object.hasOwn(sim.players, id)) sim.players[id] = was ?? S.players.find(p => p.id === id) ?? { id, name: 'Guard' };
  S.players = Object.values(sim.players);
}

export function leaveFloor(sim: Sim, S: State, id: string): void {
  delete sim.players[id];
  S.players = Object.values(sim.players);
}

// The next night, from the card between nights: night 1 from the lobby, the next one after a win, the same one again
// after everyone went flat, and night 1 of a new run after the last.
function goFloor(sim: Sim, S: State): void {
  if (S.phase === 'lobby') startFloorNight(sim, S, 1);
  else if (S.phase === 'win') startFloorNight(sim, S, S.night + 1);
  else if (S.phase === 'dead') startFloorNight(sim, S, S.night);
  else if (S.phase === 'won') restartFloor(sim, S);
}

/* ---------- the dev menu ---------- */

const DO: Record<DevDo, (sim: Sim, S: State) => void> = {
  hour(_sim, S) {
    S.t = Math.min(6 * F.HOUR - 1, (hourF(S) + 1) * F.HOUR);
  },
  late(_sim, S) {
    S.t = 6 * F.HOUR - F.HOUR / 6;
  },
  win(_sim, S) {
    S.t = 6 * F.HOUR;
  },
  next(sim, S) {
    startFloorNight(sim, S, S.night + 1);
  },
  final(sim, S) {
    startFloorNight(sim, S, FINAL_NIGHT);
  },
  low(_sim, S) {
    S.power = 5;
  },
  out(_sim, S) {
    S.power = 0.01;
  },
  bat(_sim, S) {
    for (const p of S.players) p.bat = 1;
  },
  peel(_sim, S) {
    for (const p of S.players) p.flat = false;
  },
};
const isDo = (v: unknown): v is DevDo => typeof v === 'string' && Object.hasOwn(DO, v);

const flag = (v: unknown, was: boolean): boolean => (typeof v === 'boolean' ? v : was);
const within = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && v >= lo && v <= hi;

// A dev cheat from pid's browser. Switches apply whenever there is a room; the rest only during a night.
function devFloor(sim: Sim, S: State, pid: string, d: DevCommand): void {
  if ('set' in d) {
    const set: Partial<Record<keyof Dev, unknown>> = typeof d.set === 'object' && d.set ? d.set : {},
      dev: Dev = { ...DEV_OFF, ...S.dev };
    dev.god = flag(set.god, dev.god);
    dev.power = flag(set.power, dev.power);
    dev.freeze = flag(set.freeze, dev.freeze);
    dev.wake = flag(set.wake, dev.wake);
    if (within(set.speed, 1, 12)) dev.speed = Math.round(set.speed);
    if (set.rot === -1 || set.rot === 0 || set.rot === 1 || set.rot === 2) dev.rot = set.rot;
    if (set.dread === -1 || within(set.dread, 0, 1)) dev.dread = set.dread;
    S.dev = dev;
    return;
  }
  if (S.phase !== 'play') return;
  if (d.do === 'near' || d.do === 'home') {
    const m = Number.isInteger(d.i) ? S.m[d.i] : undefined;
    if (!m) return;
    if (d.do === 'home') {
      const rest = REST[m.i];
      Object.assign(m, { x: rest.x, z: rest.z, yaw: rest.yaw, st: 'rest' });
      return;
    }
    // In front of the guard who asked, and every mascot awake.
    const me = sim.players[pid];
    if (!me || !isPlaced(me)) return;
    Object.assign(m, { x: me.x + Math.sin(me.yaw) * 4, z: me.z + Math.cos(me.yaw) * 4, st: 'roam' });
    S.dev = { ...DEV_OFF, ...S.dev, wake: true };
    return;
  }
  if (isDo(d.do)) DO[d.do](sim, S);
}

/* ---------- a guard's message ---------- */

// Anything pid's browser sent. Someone not in the room is ignored, and so is a message that is not one of these.
export function commandFloor(sim: Sim, S: State, pid: string, c: unknown): void {
  if (typeof c !== 'object' || c === null || !('t' in c) || !Object.hasOwn(sim.players, pid)) return;
  const cmd = c as Command;
  if (cmd.t === 'go') goFloor(sim, S);
  else if (cmd.t === 'dev') devFloor(sim, S, pid, cmd);
  else actFloor(sim, S, pid, cmd);
}
