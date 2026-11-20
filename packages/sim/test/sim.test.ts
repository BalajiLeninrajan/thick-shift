// The night's entry points called directly, without the harness's guards: the clock, starting a night, a guest taking
// over as host (adoptFloor) and starting the run again (restartFloor).
import { describe, expect, it } from 'vitest';
import { assert, defined } from '../src/check.ts';
import { BATTERY_SPOTS, REST, spawnPoint } from '../src/map.ts';
import { seeded } from '../src/random.ts';
import { adoptFloor, newSim, newState, restartFloor, type Sim, startFloorNight, stepFloor } from '../src/sim.ts';
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
    // The stream the balance harness, the snapshots and the Roblox port's Util.seeded all depend on.
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
  // A night as a guest holds it after a host from before batN, waveAt and the toys has been sending it, part way in:
  // one mascot hunting, one charging, one feasting and one at rest.
  function guestState() {
    const { S } = start(5, 2, 3);
    const T = JSON.parse(JSON.stringify(S)) as State;
    const [biggs, flan, squish, tank] = T.m;
    assert(biggs && flan && squish && tank, 'the night has all four mascots');
    biggs.st = 'hunt';
    flan.st = 'charge';
    squish.st = 'feast';
    tank.st = 'rest';
    delete T.batN;
    delete T.waveAt;
    delete T.toys;
    delete T.toyId;
    for (const p of T.players) delete p.toy;
    T.bats = (T.bats as number[]).slice(0, 1);
    return T;
  }
  function adopt(seed: number) {
    const T = guestState();
    const sim = newSim({ rng: seeded(seed), now: 0 });
    for (const p of T.players) sim.players[p.id] = p;
    adoptFloor(sim, T, 5000);
    return { sim, T: T as NightState };
  }

  it('makes up the host thinking it does not have from S', () => {
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
    expect(sim.brains[3]?.cool).toBeGreaterThan(0); // Tank waits a full gap before it charges
    // Five batteries for two guards, one lying about: four due back, in 5 to 50 s, soonest first.
    expect(sim.batTimers).toHaveLength(4);
    expect([...sim.batTimers].sort((a, b) => a - b)).toEqual(sim.batTimers);
    for (const s of sim.batTimers) {
      expect(s).toBeGreaterThanOrEqual(5);
      expect(s).toBeLessThan(50);
    }
    // What the old host did not send is filled in.
    expect(T.waveAt).toBeGreaterThan(T.t);
    expect(T.toys).toEqual([]);
    expect(T.toyId).toBe(0);
    expect(T.players.every(p => p.toy === true)).toBe(true);
    expect(sim.nextFault).toBeGreaterThan(0);
    expect(sim.crankNoise).toBe(0);
  });

  it('gives a hunting Biggs half as much wind again as any other hunter', () => {
    const T = guestState();
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
    // lost charge, the feast timer, the rest timer, Tank's full charge gap (CHARGE_GAP, 10 s) and the hunt's wind.
    const { sim, T } = adopt(7);
    const r = (v: number) => Math.round(v * 1000) / 1000;
    expect(sim.brains[3]?.cool).toBe(10);
    expect(sim.brains.map((b, i) => ({ st: T.m[i]?.st, tgt: b.tgt, timer: r(b.timer), cool: b.cool, wind: r(b.wind) }))).toMatchSnapshot();
    expect({ batTimers: sim.batTimers.map(r), nextFault: r(sim.nextFault), waveAt: r(T.waveAt) }).toMatchSnapshot();
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
    Object.assign(S, { deaths: 2, slams: 5, flats: 3 });
    S.total = { fixed: 4, burnt: 1, flats: [['G0', 1]], peels: ['G1'] };
    sim.rng = seeded(11);
    restartFloor(sim, S);

    expect([S.deaths, S.slams, S.flats]).toEqual([0, 0, 0]);
    expect(S.total).toEqual({ fixed: 0, burnt: 0, flats: [], peels: [] });
    expect(S.total).not.toBe(S.tally);
    expect([S.phase, S.night, S.t, S.power]).toEqual(['play', 1, 0, 100]);
    S.players.forEach((p: Guard, i) => {
      expect(p).toMatchObject({ ...spawnPoint(i), bat: 1, flat: false });
    });

    const fresh = start(11, 2, 1);
    const { evs, evId, flats, ...restarted } = S;
    const { evs: _evs, evId: _evId, ...started } = fresh.S;
    expect(restarted).toEqual(started);
    expect(sim.brains).toEqual(fresh.sim.brains);
    expect([sim.nextFault, sim.batTimers, sim.crankNoise]).toEqual([fresh.sim.nextFault, fresh.sim.batTimers, fresh.sim.crankNoise]);
  });
});
