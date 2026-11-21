// The night's entry points called directly, without the harness's guards: the clock, starting a night, picking a
// night up from S alone (adoptFloor), starting the run again (restartFloor) and a guard's actions (actFloor).
import { describe, expect, it } from 'vitest';
import { assert, defined } from '../src/check.ts';
import { BATTERY_SPOTS, BOXES, HIDES, PANELS, REST, spawnPoint } from '../src/map.ts';
import { seeded } from '../src/random.ts';
import { DEV_OFF } from '../src/session.ts';
import { actFloor, adoptFloor, brainOf, newSim, newState, restartFloor, type Sim, startFloorNight, stepFloor } from '../src/sim.ts';
import type { Guard, NightState, SimEvent, State } from '../src/types.ts';
import { countEvents, digest, eventsSince } from './nights.ts';

// A night started for n guards who have only joined, with the sim drawing from seed.
function start(seed: number, n: number, night: number, now = 0): { sim: Sim; S: NightState } {
  const sim = newSim({ rng: seeded(seed), now });
  const S = newState('TEST');
  for (let i = 0; i < n; i++) sim.players[`g${i}`] = { id: `g${i}`, name: `G${i}` };
  startFloorNight(sim, S, night);
  return { sim, S };
}

// Step a night on with nobody doing anything, a tenth of a second at a time from `now`, and sum it up.
function idle(sim: Sim, S: NightState, now: number, ticks: number) {
  const events: SimEvent[] = [];
  let seen = S.evId;
  for (let k = 1; k <= ticks && S.phase === 'play'; k++) {
    stepFloor(sim, S, now + k * 100);
    seen = eventsSince(S, seen, events);
  }
  return { phase: S.phase, t: S.t.toFixed(3), power: S.power.toFixed(3), events: countEvents(events), state: digest(S) };
}

describe('seeded', () => {
  it('gives the same numbers for the same seed, in [0, 1)', () => {
    const a = seeded(42),
      b = seeded(42),
      c = seeded(43);
    const xs = Array.from({ length: 1000 }, a);
    expect(Array.from({ length: 1000 }, b)).toEqual(xs);
    expect(Array.from({ length: 1000 }, c)).not.toEqual(xs);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    // The stream the balance harness and the snapshots depend on.
    expect(Array.from({ length: 4 }, seeded(1))).toMatchSnapshot();
  });
});

describe('the clock', () => {
  it('steps by the time since the last step, at most a quarter second, times the dev speed', () => {
    const { sim, S } = start(1, 1, 1, 1000);
    stepFloor(sim, S, 1100);
    expect(S.t).toBeCloseTo(0.1, 12);
    stepFloor(sim, S, 11_100); // ten seconds later: capped
    expect(S.t).toBeCloseTo(0.35, 12);
    expect(sim.lastStep).toBe(11_100);
    S.dev = { ...DEV_OFF, speed: 2 };
    stepFloor(sim, S, 11_200);
    expect(S.t).toBeCloseTo(0.55, 12);
  });

  it('keeps time but moves nothing once the night is over', () => {
    const { sim, S } = start(1, 1, 1);
    S.phase = 'win';
    stepFloor(sim, S, 500);
    expect(S.t).toBe(0);
    expect(sim.lastStep).toBe(500);
  });
});

describe('startFloorNight', () => {
  it('puts the guards on their spawn points and the mascots on their marks', () => {
    const { sim, S } = start(2, 3, 4);
    expect(S.phase).toBe('play');
    expect(S.night).toBe(4);
    expect([S.t, S.power, S.cap]).toEqual([0, 100, 100]);
    expect(S.doors).toEqual({ L: false, V: false, R: false });
    expect(S.players.map(p => p.id)).toEqual(['g0', 'g1', 'g2']);
    S.players.forEach((p, i) => {
      expect(p).toBe(sim.players[p.id]);
      expect(p).toMatchObject({ ...spawnPoint(i), bat: 1, flat: false, hid: -1, toy: true });
    });
    expect(S.m.map(m => [m.x, m.z, m.st])).toEqual(REST.map(r => [r.x, r.z, 'rest']));
    expect(S.faults.every(f => f === null)).toBe(true);
    // Three batteries and one per guard, on different spots.
    expect(S.batN).toBe(6);
    expect(new Set(S.bats).size).toBe(6);
    for (const i of S.bats) expect(BATTERY_SPOTS[i]).toBeDefined();
    expect(sim.brains).toHaveLength(4);
  });
});

describe('adoptFloor', () => {
  // A saved night, part way in: one mascot hunting, one charging, one feasting and one at rest, and one battery left
  // lying about.
  function savedState() {
    const { S } = start(5, 2, 3);
    const T = JSON.parse(JSON.stringify(S)) as State;
    const [biggs, flan, squish, stompy] = T.m;
    assert(biggs && flan && squish && stompy, 'the night has all four mascots');
    biggs.st = 'hunt';
    flan.st = 'charge';
    squish.st = 'feast';
    stompy.st = 'rest';
    T.bats = (T.bats as number[]).slice(0, 1);
    return T;
  }
  function adopt(seed: number, T = savedState()) {
    const sim = newSim({ rng: seeded(seed), now: 0 });
    for (const p of T.players) sim.players[p.id] = p;
    adoptFloor(sim, T, 5000);
    return { sim, T: T as NightState };
  }

  it("makes up the mascots' thinking from S", () => {
    const { sim, T } = adopt(7);
    expect(sim.lastStep).toBe(5000);
    expect(sim.brains).toHaveLength(4);
    // The hunt goes on after the nearest guard (g0 stands 1.6 m nearer Biggs' mark); a charge has lost its heading
    // and looks round instead; a feast and a rest stay as they are.
    expect(T.m.map(m => m.st)).toEqual(['hunt', 'search', 'feast', 'rest']);
    expect(sim.brains[0]).toMatchObject({ tgt: 'g0', last: { x: 18.5, z: 41.5 }, woke: true });
    expect(sim.brains[1]).toMatchObject({ tgt: null, last: { x: REST[1].x, z: REST[1].z }, woke: true });
    expect(sim.brains[2]?.woke).toBe(true);
    expect(sim.brains[3]?.woke).toBe(false);
    expect(sim.brains[3]?.cool).toBeGreaterThan(0); // Stompy waits a full gap before it charges
    // Five batteries for two guards, one lying about: four due back, in 5 to 50 s, soonest first.
    expect(sim.batTimers).toHaveLength(4);
    expect([...sim.batTimers].sort((a, b) => a - b)).toEqual(sim.batTimers);
    for (const s of sim.batTimers) {
      expect(s).toBeGreaterThanOrEqual(5);
      expect(s).toBeLessThan(50);
    }
    expect(sim.nextFault).toBeGreaterThan(0);
    expect(sim.crankNoise).toBe(0);
  });

  it('gives each mascot the timers a seeded stream says', () => {
    // The idle night below ends before most of these timers play out, so pin them here: the search timer for the
    // lost charge, the feast timer, the rest timer and Stompy's full charge gap (CHARGE_GAP, 10 s).
    const { sim, T } = adopt(7);
    const r = (v: number) => Math.round(v * 1000) / 1000;
    expect(sim.brains[3]?.cool).toBe(10);
    expect(sim.brains.map((b, i) => ({ st: T.m[i]?.st, tgt: b.tgt, timer: r(b.timer), cool: b.cool }))).toMatchSnapshot();
    expect({ batTimers: sim.batTimers.map(r), nextFault: r(sim.nextFault) }).toMatchSnapshot();
  });

  it('walks a searching mascot to where it lost the guard when it means to check a locker that is not there', () => {
    // adoptFloor turns mascot 1's lost charge into a search. Point its next check past the end of HIDES: it skips
    // the check and heads for b.last, as it would with no checks left.
    const { sim, T } = adopt(7);
    const b = brainOf(sim, 1);
    expect(T.m[1]?.st).toBe('search');
    b.checks = [HIDES.length];
    expect(() => idle(sim, T, 5000, 20)).not.toThrow();
    expect(b.checks).toEqual([HIDES.length]);
  });

  it('carries the night on from there the same way every time', () => {
    const a = adopt(7),
      b = adopt(7);
    const night = idle(a.sim, a.T, 5000, 600);
    expect(idle(b.sim, b.T, 5000, 600)).toEqual(night);
    expect(night).toMatchSnapshot();
  });
});

describe('restartFloor', () => {
  it('clears the run and starts night 1 as a fresh room would, apart from the event log', () => {
    const { sim, S } = start(9, 2, 4);
    idle(sim, S, 0, 900);
    S.deaths = 2;
    S.total = { fixed: 4, burnt: 1, flats: [['G0', 1]], peels: ['G1'] };
    sim.rng = seeded(11);
    restartFloor(sim, S);

    expect(S.deaths).toBe(0);
    expect(S.total).toEqual({ fixed: 0, burnt: 0, flats: [], peels: [] });
    expect(S.total).not.toBe(S.tally);
    expect([S.phase, S.night, S.t, S.power]).toEqual(['play', 1, 0, 100]);
    S.players.forEach((p: Guard, i) => {
      expect(p).toMatchObject({ ...spawnPoint(i), bat: 1, flat: false });
    });

    const fresh = start(11, 2, 1);
    const { evs, evId, ...restarted } = S;
    const { evs: _evs, evId: _evId, ...started } = fresh.S;
    expect(restarted).toEqual(started);
    expect(sim.brains).toEqual(fresh.sim.brains);
    expect([sim.nextFault, sim.batTimers, sim.crankNoise]).toEqual([fresh.sim.nextFault, fresh.sim.batTimers, fresh.sim.crankNoise]);
  });
});

describe('actFloor', () => {
  // Each kind of use: a night set up so that the action does something for g0, the field it reads, and wrong values
  // for that field, as JSON from a guard's browser can carry.
  const box = defined(BOXES[0], 'box 0'),
    spot = defined(BATTERY_SPOTS[0], 'battery spot 0'),
    locker = defined(HIDES[0], 'locker 0');
  const USES: { what: string; set: (S: NightState, p: Guard) => void; good: string; bad: string[] }[] = [
    {
      what: 'fix',
      set: (S, p) => {
        Object.assign(p, { x: box.x, z: box.z });
        S.faults[0] = { k: 0, at: 0, burnt: false };
      },
      good: '"i":0',
      bad: ['"i":"0"', '"i":0.5', '"i":-1', '"i":[0]', '"i":null', `"i":${BOXES.length}`],
    },
    {
      what: 'bat',
      set: (S, p) => {
        Object.assign(p, { x: spot.x, z: spot.z, bat: 0.5 });
        S.bats = [0];
      },
      good: '"i":0',
      bad: ['"i":"0"', '"i":0.5', '"i":true'],
    },
    {
      what: 'hide',
      set: (_S, p) => Object.assign(p, { x: locker.at.x, z: locker.at.z }),
      good: '"i":0',
      bad: ['"i":"0"', '"i":0.5', '"i":-1', '"i":{}', `"i":${HIDES.length}`],
    },
    {
      what: 'door',
      set: (_S, p) => Object.assign(p, { x: PANELS.L.x, z: PANELS.L.z }),
      good: '"k":"L"',
      bad: ['"k":"l"', '"k":"toString"', '"k":0', '"k":["L"]'],
    },
    {
      what: 'toy',
      set: (S, p) => {
        p.toy = false;
        S.toys = [{ id: 1, by: 'g1', x0: p.x, z0: p.z, x: p.x, z: p.z, at: 0, land: 0, heard: true }];
      },
      good: '"id":1',
      bad: ['"id":"1"', '"id":[1]'],
    },
    {
      what: 'peel',
      set: (S, p) => Object.assign(defined(S.players[1], 'g1'), { x: p.x, z: p.z, flat: true }),
      good: '"id":"g1"',
      bad: ['"id":["g1"]', '"id":1'],
    },
  ];
  // g0 sends {"t":"use","what":what,field} to a two-guard night set up by set. What changed, and what was there before.
  function use(what: string, set: (S: NightState, p: Guard) => void, field: string) {
    const { sim, S } = start(1, 2, 1);
    set(S, defined(S.players[0], 'g0'));
    const before = structuredClone({ S, batTimers: sim.batTimers });
    actFloor(sim, S, 'g0', JSON.parse(`{"t":"use","what":"${what}",${field}}`));
    return { after: { S, batTimers: sim.batTimers }, before };
  }

  for (const { what, set, good, bad } of USES) {
    it(`does a ${what} with ${good}`, () => {
      const { after, before } = use(what, set, good);
      expect(after).not.toEqual(before);
    });

    it(`ignores a ${what} with ${bad.join(' or ')}`, () => {
      for (const field of bad) {
        const { after, before } = use(what, set, field);
        expect(after, field).toEqual(before);
      }
    });
  }

  it('steps into a locker named by a number, and keeps p.hid a number', () => {
    const hide = defined(
      USES.find(u => u.what === 'hide'),
      'the hide use'
    );
    const { S } = use('hide', hide.set, '"i":0').after;
    expect(S.players[0]?.hid).toBe(0);
    expect(S.evs.at(-1)).toMatchObject({ type: 'locker', x: { i: 0, in: true } });
  });
});

describe('a hunt', () => {
  // A night-1 guard in the Main Hall and Madame Flan coming for them from six metres south, the rest kept on their
  // marks, rot held at stage 0 so a torch stops her dead.
  function chase() {
    const { sim, S } = start(1, 1, 1);
    S.dev = { god: false, power: false, freeze: false, wake: false, speed: 1, rot: 0, dread: -1 };
    S.stir = false;
    S.waveAt = 1e9;
    const p = defined(S.players[0], 'g0'),
      m = defined(S.m[1], 'Madame Flan'),
      b = brainOf(sim, 1);
    Object.assign(p, { x: 19.5, z: 18, yaw: 0, pitch: 0, on: true });
    Object.assign(m, { x: 19.5, z: 24, yaw: Math.PI, st: 'hunt' });
    Object.assign(b, { woke: true, tgt: p.id, last: { x: p.x, z: p.z } });
    return { sim, S, p, m };
  }

  it('does not give up on a guard it can see, however long a torch holds it', () => {
    const { sim, S, p, m } = chase();
    for (let k = 1; k <= 400; k++) stepFloor(sim, S, k * 100);
    expect(S.t).toBeCloseTo(40, 6);
    expect(m.st).toBe('hunt');
    expect(Math.hypot(m.x - 19.5, m.z - 24)).toBeLessThan(0.5); // held where it stood
    expect(p.flat).toBe(false);
  });

  // A guard hidden in locker 0, and Madame Flan right outside its doors, close enough to touch them, knowing they are in.
  function hiding() {
    const { sim, S } = start(1, 1, 1);
    S.stir = false;
    S.waveAt = 1e9;
    const h = defined(HIDES[0], 'locker 0'),
      p = defined(S.players[0], 'g0'),
      m = defined(S.m[1], 'Madame Flan'),
      b = brainOf(sim, 1);
    Object.assign(p, { hid: 0, x: h.at.x, z: h.at.z, on: false });
    // Right outside the doors, close enough to touch them, and it saw them get in.
    Object.assign(m, { x: h.at.x + Math.sin(h.face) * 0.6, z: h.at.z + Math.cos(h.face) * 0.6, st: 'search' });
    Object.assign(b, { woke: true, knows: 0, last: { ...h.at }, timer: 5, since: 0, was: 'search' });
    return { sim, S, p, m };
  }

  it('pulls a guard out of a locker and gives them a split second before it can touch them', () => {
    const { sim, S, p, m } = hiding();
    stepFloor(sim, S, 100);
    expect(S.evs.some(e => e.type === 'found')).toBe(true);
    expect(p).toMatchObject({ hid: -1, flat: false });
    expect(m.st).toBe('hunt');
    for (let k = 2; k <= 6; k++) stepFloor(sim, S, k * 100);
    expect(p.flat).toBe(false); // 0.6 s on, standing still within reach
    for (let k = 7; k <= 20 && !p.flat; k++) stepFloor(sim, S, k * 100);
    expect(p.flat).toBe(true); // and then it has them
  });

  it('hears a guard bang straight back into a locker, and has them at once when it opens it', () => {
    const { sim, S, p } = hiding();
    stepFloor(sim, S, 100);
    expect(p.hid).toBe(-1);
    actFloor(sim, S, 'g0', { t: 'use', what: 'hide', i: 0 });
    expect(p.hid).toBe(0);
    expect(S.evs.at(-1)).toMatchObject({ type: 'locker', x: { in: true, loud: true } });
    for (let k = 2; k <= 20 && !p.flat; k++) stepFloor(sim, S, k * 100);
    expect(p.flat).toBe(true);
    expect(S.t).toBeLessThan(1.5); // as soon as it may touch them, not after another start
  });
});
