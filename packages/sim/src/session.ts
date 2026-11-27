// What whoever runs a night does with the guards' browsers: let them in and out of the room (joinFloor, leaveFloor)
// and act on what they send (commandFloor): an action for actFloor, 'go' or 'wait' for the next night, or a dev cheat.
// Every message is someone else's JSON, so like actFloor this checks every field it reads.

import { isPlaced } from './check.ts';
import { DEFAULT_NAME, FINAL_NIGHT } from './config.ts';
import { REST } from './map.ts';
import { actFloor, F, hourF, restartFloor, type Sim, startFloorNight } from './sim.ts';
import type { Command, Dev, DevCommand, DevDo, Player, State } from './types.ts';

// Every cheat off. A missing field in S.dev reads as this.
export const DEV_OFF: Dev = { god: false, power: false, freeze: false, wake: false, speed: 1, rot: -1, dread: -1 };

// A guard comes into the room. One coming back keeps their record, and with it their place on the floor: was, or the
// one S still has. Anyone else gets placed by the next step (stepFloor). Whoever comes in has yet to say they are
// ready, even one who had before they left.
export function joinFloor(sim: Sim, S: State, id: string, was?: Player): void {
  if (!Object.hasOwn(sim.players, id)) {
    const p = was ?? S.players.find(q => q.id === id) ?? { id, name: DEFAULT_NAME };
    // A record kept by a build that gave no start at a breaker box has no fixAt: now, as adoptFloor gives it.
    if (isPlaced(p)) p.fixAt ??= S.t ?? 0;
    delete p.ready;
    sim.players[id] = p;
  }
  S.players = Object.values(sim.players);
}

// A guard leaves the room. Between nights, the rest may all have been waiting on them: then the next night starts,
// and this returns true.
export function leaveFloor(sim: Sim, S: State, id: string): boolean {
  delete sim.players[id];
  S.players = Object.values(sim.players);
  return allReady(sim) && nextFloor(sim, S);
}

const allReady = (sim: Sim): boolean => {
  const all = Object.values(sim.players);
  return all.length > 0 && all.every(p => p.ready);
};

// The next night, once everyone is ready: night 1 from the lobby, the next one after a win, the same one again after
// everyone went flat, and night 1 of a new run after the last. True if it started one.
function nextFloor(sim: Sim, S: State): boolean {
  if (S.phase === 'play') return false;
  for (const p of Object.values(sim.players)) delete p.ready;
  if (S.phase === 'lobby') startFloorNight(sim, S, 1);
  else if (S.phase === 'win') startFloorNight(sim, S, S.night + 1);
  else if (S.phase === 'dead') startFloorNight(sim, S, S.night);
  else restartFloor(sim, S);
  return true;
}

// pid pressed for the next night (go) or took it back (wait). Only between nights. True if that started one.
function readyFloor(sim: Sim, S: State, pid: string, ready: boolean): boolean {
  const p = sim.players[pid];
  if (S.phase === 'play' || !p) return false;
  if (ready) p.ready = true;
  else delete p.ready;
  return allReady(sim) && nextFloor(sim, S);
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
// The one-off cheats that start a night.
const STARTS: readonly DevDo[] = ['next', 'final'];

const flag = (v: unknown, was: boolean): boolean => (typeof v === 'boolean' ? v : was);
const within = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && v >= lo && v <= hi;

// A dev cheat from pid's browser. Switches apply whenever there is a room; the rest only during a night. True if
// it started a night.
function devFloor(sim: Sim, S: State, pid: string, d: DevCommand): boolean {
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
    return false;
  }
  if (S.phase !== 'play') return false;
  if (d.do === 'near' || d.do === 'home') {
    const m = Number.isInteger(d.i) ? S.m[d.i] : undefined;
    if (!m) return false;
    if (d.do === 'home') {
      const rest = REST[m.i];
      Object.assign(m, { x: rest.x, z: rest.z, yaw: rest.yaw, st: 'rest' });
      return false;
    }
    // In front of the guard who asked, and every mascot awake.
    const me = sim.players[pid];
    if (!me || !isPlaced(me)) return false;
    Object.assign(m, { x: me.x + Math.sin(me.yaw) * 4, z: me.z + Math.cos(me.yaw) * 4, st: 'roam' });
    S.dev = { ...DEV_OFF, ...S.dev, wake: true };
    return false;
  }
  if (!isDo(d.do)) return false;
  DO[d.do](sim, S);
  return STARTS.includes(d.do);
}

/* ---------- a guard's message ---------- */

// Anything pid's browser sent. Someone not in the room is ignored, and so is a message that is not one of these.
// True if it started a night: the last guard's 'go' from a card between nights, or a dev skip to another night.
export function commandFloor(sim: Sim, S: State, pid: string, c: unknown): boolean {
  if (typeof c !== 'object' || c === null || !('t' in c) || !Object.hasOwn(sim.players, pid)) return false;
  const cmd = c as Command;
  if (cmd.t === 'go' || cmd.t === 'wait') return readyFloor(sim, S, pid, cmd.t === 'go');
  if (cmd.t === 'dev') return devFloor(sim, S, pid, cmd);
  actFloor(sim, S, pid, cmd);
  return false;
}
