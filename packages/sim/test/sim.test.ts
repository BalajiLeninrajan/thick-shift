// The night's entry points called directly, without the harness's guards: the clock, starting a night, picking a
// night up from S alone (adoptFloor), starting the run again (restartFloor) and a guard's actions (actFloor).
import { describe, expect, it } from 'vitest';
import { assert, defined } from '../src/check.ts';
import { BATTERY_SPOTS, BOXES, HIDES, PANELS, REST, spawnPoint } from '../src/map.ts';
import { seeded } from '../src/random.ts';
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
  let seen = Math.max(0, ...S.evs.map(e => e.id));
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
    S.dev = { god: false, power: false, freeze: false, wake: false, speed: 2, rot: -1, dread: -1 };
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
  // A night saved by a build from before batN, waveAt and the toys, part way in: one mascot hunting, one charging, one
  // feasting and one at rest.
  function savedState() {
    const { S } = start(5, 2, 3);
    const T = JSON.parse(JSON.stringify(S)) as State;
    const [biggs, flan, squish, stompy] = T.m;
    assert(biggs && flan && squish && stompy, 'the night has all four mascots');
    biggs.st = 'hunt';
    flan.st = 'charge';
    squish.st = 'feast';
    stompy.st = 'rest';
    delete T.batN;
    delete T.waveAt;
    delete T.toys;
    delete T.toyId;
    for (const p of T.players) delete p.toy;
    T.bats = (T.bats as number[]).slice(0, 1);
    return T;
  }
  function adopt(seed: number) {
    const T = savedState();
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
    // What the old build did not save is filled in.
    expect(T.waveAt).toBeGreaterThan(T.t);
    expect(T.toys).toEqual([]);
    expect(T.toyId).toBe(0);
    expect(T.players.every(p => p.toy === true)).toBe(true);
    expect(sim.nextFault).toBeGreaterThan(0);
    expect(sim.crankNoise).toBe(0);
  });

  it('gives a hunting Biggs half as much wind again as any other hunter', () => {
    const T = savedState();
    defined(T.m[1], 'Madame Flan').st = 'hunt';
    const sim = newSim({ rng: seeded(7), now: 0 });
    for (const p of T.players) sim.players[p.id] = p;
    adoptFloor(sim, T, 5000);
    const [biggs, other] = sim.brains;
    assert(biggs && other, 'Biggs and Flan have brains');
    expect(other.wind).toBeGreaterThan(0);
    expect(biggs.wind).toBeCloseTo(1.5 * other.wind, 9);
    expect(other.wind).toMatchSnapshot();
  });

  it('gives each mascot the timers and wind a seeded stream says', () => {
    // The idle night below ends before most of these timers play out, so pin them here: the search timer for the
    // lost charge, the feast timer, the rest timer, Stompy's full charge gap (CHARGE_GAP, 10 s) and the hunt's wind.
    const { sim, T } = adopt(7);
    const r = (v: number) => Math.round(v * 1000) / 1000;
    expect(sim.brains[3]?.cool).toBe(10);
    expect(sim.brains.map((b, i) => ({ st: T.m[i]?.st, tgt: b.tgt, timer: r(b.timer), cool: b.cool, wind: r(b.wind) }))).toMatchSnapshot();
    expect({ batTimers: sim.batTimers.map(r), nextFault: r(sim.nextFault), waveAt: r(T.waveAt) }).toMatchSnapshot();
  });

  it('starts an empty S.bats for a state from before it, so batteries can be dropped and picked up', () => {
    const T = savedState();
    delete T.bats;
    const sim = newSim({ rng: seeded(7), now: 0 });
    for (const p of T.players) sim.players[p.id] = p;
    adoptFloor(sim, T, 5000);
    const S = T as NightState;
    expect(S.bats).toEqual([]);
    // Every battery of the night is due back: five for two guards, as batN is guessed too.
    expect(sim.batTimers).toHaveLength(5);
    const g = defined(S.players[0], 'g0'),
      spot = defined(BATTERY_SPOTS[0], 'battery spot 0');
    Object.assign(g, { x: spot.x, z: spot.z, bat: 0.5 });
    expect(() => actFloor(sim, S, g.id, { t: 'use', what: 'bat', i: 0 })).not.toThrow();
    // The first one back lands within 50 s.
    idle(sim, S, 5000, 500);
    expect(S.bats.length).toBeGreaterThan(0);
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
