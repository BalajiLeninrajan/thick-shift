// What whoever runs a night does with the guards' browsers (src/session.ts): letting them in and out, the next night
// from the card between nights, the dev menu's cheats, and messages that are not what they claim to be.
import { describe, expect, it } from 'vitest';
import { assert, isNight } from '../src/check.ts';
import { FINAL_NIGHT } from '../src/config.ts';
import { REST } from '../src/map.ts';
import { seeded } from '../src/random.ts';
import { commandFloor, DEV_OFF, joinFloor, leaveFloor } from '../src/session.ts';
import { F, newSim, newState, type Sim, stepFloor } from '../src/sim.ts';
import type { NightState, State } from '../src/types.ts';

function room(...ids: string[]): { sim: Sim; S: State } {
  const sim = newSim({ rng: seeded(7), now: 0 });
  const S = newState('TEST');
  for (const id of ids) joinFloor(sim, S, id);
  return { sim, S };
}
function night(S: State): asserts S is NightState {
  assert(isNight(S), 'a night has started');
}

describe('joinFloor and leaveFloor', () => {
  it('keep S.players the same records as sim.players', () => {
    const { sim, S } = room('a', 'b');
    expect(S.players.map(p => p.id)).toEqual(['a', 'b']);
    expect(S.players[0]).toBe(sim.players.a);
    leaveFloor(sim, S, 'a');
    expect(S.players.map(p => p.id)).toEqual(['b']);
    expect(sim.players.a).toBeUndefined();
  });

  it('gives a guard S still has their record back, place and all', () => {
    const { sim, S } = room('a', 'b');
    commandFloor(sim, S, 'a', { t: 'go' });
    night(S);
    const was = S.players.find(p => p.id === 'b');
    assert(was, 'b is in the night');
    // A room brought back from storage has S and a fresh sim.
    const sim2 = newSim({ rng: seeded(8), now: 0 });
    joinFloor(sim2, S, 'b');
    expect(sim2.players.b).toBe(was);
    expect(S.players.map(p => p.id)).toEqual(['b']);
  });

  it('fills in what a record kept by an older build does not have', () => {
    // A guard who left mid-night before the start at a breaker box was added comes back with no fixAt.
    const { sim, S } = room('a', 'b');
    commandFloor(sim, S, 'a', { t: 'go' });
    night(S);
    const was = sim.players.b;
    assert(was, 'b is in the night');
    leaveFloor(sim, S, 'b');
    delete was.fixAt;
    S.t = 20;
    joinFloor(sim, S, 'b', was);
    expect(sim.players.b).toBe(was);
    expect(was.fixAt).toBe(20); // no start at a box they did not have: see adoptFloor
  });

  it('lets someone who joins mid-night in at a spawn point on the next step', () => {
    const { sim, S } = room('a');
    commandFloor(sim, S, 'a', { t: 'go' });
    joinFloor(sim, S, 'late');
    stepFloor(sim, S, 100);
    night(S);
    expect(S.players.find(p => p.id === 'late')).toMatchObject({ flat: false, bat: 1 });
  });
});

describe("commandFloor's go", () => {
  it('starts night 1 from the lobby, the next after a win and the same one after everyone went flat', () => {
    const { sim, S } = room('a');
    expect(commandFloor(sim, S, 'a', { t: 'go' })).toBe(true);
    expect([S.phase, S.night]).toEqual(['play', 1]);
    expect(commandFloor(sim, S, 'a', { t: 'go' })).toBe(false); // already playing
    S.phase = 'win';
    expect(commandFloor(sim, S, 'a', { t: 'go' })).toBe(true);
    expect([S.phase, S.night]).toEqual(['play', 2]);
    S.phase = 'dead';
    commandFloor(sim, S, 'a', { t: 'go' });
    expect([S.phase, S.night]).toEqual(['play', 2]);
  });

  it('starts a new run after the last night', () => {
    const { sim, S } = room('a');
    commandFloor(sim, S, 'a', { t: 'go' });
    night(S);
    Object.assign(S, { phase: 'won', night: FINAL_NIGHT, deaths: 3 });
    commandFloor(sim, S, 'a', { t: 'go' });
    expect([S.phase, S.night, S.deaths]).toEqual(['play', 1, 0]);
  });

  it('does nothing during a night, so two guards pressing at once start it once', () => {
    const { sim, S } = room('a', 'b');
    commandFloor(sim, S, 'a', { t: 'go' });
    S.t = 50;
    commandFloor(sim, S, 'b', { t: 'go' });
    expect([S.phase, S.night, S.t]).toEqual(['play', 1, 50]);
  });
});

describe("commandFloor's dev cheats", () => {
  it('sets the switches it is given and keeps the rest', () => {
    const { sim, S } = room('a');
    commandFloor(sim, S, 'a', { t: 'dev', set: { god: true, speed: 4 } });
    expect(S.dev).toEqual({ ...DEV_OFF, god: true, speed: 4 });
    commandFloor(sim, S, 'a', { t: 'dev', set: { freeze: true, dread: 0.5 } });
    expect(S.dev).toEqual({ ...DEV_OFF, god: true, speed: 4, freeze: true, dread: 0.5 });
  });

  it('turns down values off the wire that are out of range or the wrong type', () => {
    const { sim, S } = room('a');
    commandFloor(sim, S, 'a', { t: 'dev', set: { god: 'yes', speed: 99, rot: 7, dread: 2, power: 1 } });
    expect(S.dev).toEqual(DEV_OFF);
    commandFloor(sim, S, 'a', { t: 'dev', set: null });
    expect(S.dev).toEqual(DEV_OFF);
  });

  it('runs one-off cheats only during a night', () => {
    const { sim, S } = room('a');
    expect(commandFloor(sim, S, 'a', { t: 'dev', do: 'next' })).toBe(false);
    expect(S.phase).toBe('lobby');
    commandFloor(sim, S, 'a', { t: 'go' });
    expect(commandFloor(sim, S, 'a', { t: 'dev', do: 'hour' })).toBe(false);
    expect(S.t).toBe(F.HOUR);
    commandFloor(sim, S, 'a', { t: 'dev', do: 'low' });
    expect(S.power).toBe(5);
    expect(commandFloor(sim, S, 'a', { t: 'dev', do: 'final' })).toBe(true);
    expect([S.night, S.t]).toEqual([FINAL_NIGHT, 0]);
    commandFloor(sim, S, 'a', { t: 'dev', do: 'constructor' });
    commandFloor(sim, S, 'a', { t: 'dev', do: 'toString' });
    expect(S.night).toBe(FINAL_NIGHT);
  });

  it('brings a mascot in front of the guard who asked, and sends one home', () => {
    const { sim, S } = room('a');
    commandFloor(sim, S, 'a', { t: 'go' });
    night(S);
    const me = S.players[0];
    assert(me, 'a is placed');
    commandFloor(sim, S, 'a', { t: 'dev', do: 'near', i: 1 });
    expect(S.m[1]).toMatchObject({ x: me.x + Math.sin(me.yaw) * 4, z: me.z + Math.cos(me.yaw) * 4, st: 'roam' });
    expect(S.dev?.wake).toBe(true);
    commandFloor(sim, S, 'a', { t: 'dev', do: 'home', i: 1 });
    expect(S.m[1]).toMatchObject({ x: REST[1].x, z: REST[1].z, st: 'rest' });
    // An index that is not a whole number, or past the mascots, moves nobody.
    commandFloor(sim, S, 'a', { t: 'dev', do: 'near', i: 1 });
    const there = { ...S.m[1] };
    commandFloor(sim, S, 'a', { t: 'dev', do: 'home', i: '1' });
    commandFloor(sim, S, 'a', { t: 'dev', do: 'home', i: 1.5 });
    commandFloor(sim, S, 'a', { t: 'dev', do: 'home', i: 99 });
    expect(S.m[1]).toEqual(there);
  });
});

describe('commandFloor', () => {
  it('ignores anyone not in the room, and anything that is not a command', () => {
    const { sim, S } = room('a');
    commandFloor(sim, S, 'stranger', { t: 'go' });
    expect(S.phase).toBe('lobby');
    for (const junk of [null, 3, 'go', [], {}, { t: 'nope' }, { t: 'use', what: 'door' }]) commandFloor(sim, S, 'a', junk);
    expect(S.phase).toBe('lobby');
  });

  it('does not take an id named after an Object property as someone in the room', () => {
    const { sim, S } = room('a');
    for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      commandFloor(sim, S, id, { t: 'go' });
      commandFloor(sim, S, id, { t: 'name', n: 'sneaky' });
    }
    expect(S.phase).toBe('lobby');
    expect(({} as { name?: string }).name).toBeUndefined();
    joinFloor(sim, S, 'constructor');
    expect(S.players.map(p => p.id)).toEqual(['a', 'constructor']);
  });

  it('passes actions to actFloor', () => {
    const { sim, S } = room('a');
    commandFloor(sim, S, 'a', { t: 'name', n: 'Biggs fan' });
    expect(S.players[0]?.name).toBe('Biggs fan');
  });
});
