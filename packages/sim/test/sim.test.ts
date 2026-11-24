// The night's entry points called directly, without the harness's guards: the clock, starting a night, picking a
// night up from S alone (adoptFloor), starting the run again (restartFloor) and a guard's actions (actFloor).
import { describe, expect, it } from 'vitest';
import { assert, defined } from '../src/check.ts';
import { FLAN, MASCOTS, STOMPY } from '../src/config.ts';
import { BATTERY_SPOTS, BOXES, dist, HIDES, MASCOT_R, PANELS, PLAYER_R, REST, spawnPoint, TOY_BOX, walkable } from '../src/map.ts';
import { seeded } from '../src/random.ts';
import { DEV_OFF } from '../src/session.ts';
import { actFloor, adoptFloor, brainOf, F, landing, newSim, newState, restartFloor, type Sim, startFloorNight, stepFloor, TOY } from '../src/sim.ts';
import type { Guard, MascotIndex, NightState, Point, SimEvent, State } from '../src/types.ts';
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

  it('hands out the booth carton one at a time, to empty hands in reach, until it is empty', () => {
    const { sim, S } = start(1, 2, 1);
    const [p, q] = [defined(S.players[0], 'g0'), defined(S.players[1], 'g1')];
    const take = (g: Guard) => actFloor(sim, S, g.id, { t: 'use', what: 'carton' });
    expect(S.toyBox).toBe(TOY.box);
    Object.assign(p, { x: TOY_BOX.x, z: TOY_BOX.z - 0.9 });
    take(p);
    expect(S.toyBox).toBe(TOY.box); // their own still in hand
    p.toy = false;
    Object.assign(q, { x: TOY_BOX.x - 3, z: TOY_BOX.z - 3, toy: false });
    take(q);
    expect([S.toyBox, q.toy]).toEqual([TOY.box, false]); // out of reach
    for (let k = 1; k <= TOY.box; k++) {
      take(p);
      expect([S.toyBox, p.toy]).toEqual([TOY.box - k, true]);
      expect(S.evs.at(-1)).toMatchObject({ type: 'grab', x: { by: p.id, x: TOY_BOX.x, z: TOY_BOX.z } });
      p.toy = false;
    }
    take(p);
    expect([S.toyBox, p.toy]).toEqual([0, false]);
    restartFloor(sim, S);
    expect(S.toyBox).toBe(TOY.box);
  });

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
    S.dev = { ...DEV_OFF, rot: 0 };
    S.stir = false;
    S.waveAt = 1e9;
    const p = defined(S.players[0], 'g0'),
      m = defined(S.m[FLAN], 'Madame Flan'),
      b = brainOf(sim, FLAN);
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
    expect(dist(m, { x: 19.5, z: 24 })).toBeLessThan(0.5); // held where it stood
    expect(p.flat).toBe(false);
  });

  // A guard hidden in locker 0, and Madame Flan right outside its doors, close enough to touch them, knowing they are in.
  function hiding() {
    const { sim, S } = start(1, 1, 1);
    S.stir = false;
    S.waveAt = 1e9;
    const h = defined(HIDES[0], 'locker 0'),
      p = defined(S.players[0], 'g0'),
      m = defined(S.m[FLAN], 'Madame Flan'),
      b = brainOf(sim, FLAN);
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

  // A night-1 guard standing still with the torch off, and one mascot already hunting them from `from`, the rest
  // kept on their marks. Stompy never charges.
  function stalk(i: MascotIndex, guard: Point, from: Point) {
    const { sim, S } = start(1, 1, 1);
    S.stir = false;
    S.waveAt = 1e9;
    const p = defined(S.players[0], 'g0'),
      m = defined(S.m[i], 'the hunter'),
      b = brainOf(sim, i);
    Object.assign(p, guard, { on: false });
    Object.assign(m, from, { st: 'hunt' });
    Object.assign(b, { woke: true, tgt: p.id, last: { ...guard }, cool: 1e9 });
    return { sim, S, p, m, b };
  }
  // Step until the guard is flat or `seconds` have gone by. before: called ahead of each step with the step's number.
  function until(sim: Sim, S: NightState, p: Guard, seconds: number, before?: (k: number) => void) {
    for (let k = 1; k <= seconds * 10 && !p.flat; k++) {
      before?.(k);
      stepFloor(sim, S, k * 100);
    }
    return S.t;
  }

  it('walks to the nearest place it fits for a guard tucked in behind furniture, and reaches in', () => {
    // The Main Hall's north-east corner, past the end of the trestle table: a guard fits and a mascot does not.
    const guard = { x: 26.6, z: 11.86 };
    expect(walkable(guard.x, guard.z, PLAYER_R)).toBe(true);
    expect(walkable(guard.x, guard.z, MASCOT_R)).toBe(false);
    for (const i of MASCOTS) {
      const { sim, S, p, m } = stalk(i, guard, { x: 24.3, z: 13.8 });
      expect(until(sim, S, p, 10)).toBeLessThan(6);
      expect(p).toMatchObject({ flat: true, flatBy: i });
      expect(dist(m, p)).toBeGreaterThan(F.CATCH); // not by touching them
    }
  });

  it('does not turn back to a waypoint it has just passed', () => {
    // Backstage, the corner behind the crate. The way from the middle of the room brushes the costume rack, and a
    // mascot that asked again a step along it was sent back to the middle every time.
    const { sim, S, p } = stalk(STOMPY, { x: 39.62, z: 2.16 }, { x: 34, z: 6.5 });
    expect(until(sim, S, p, 20)).toBeLessThan(8);
    expect(p.flat).toBe(true);
  });

  // A guard with their hands in breaker box 0, which has a fault, and Madame Flan a step behind them, hunting.
  function busy() {
    const { sim, S } = start(1, 1, 1);
    S.stir = false;
    S.waveAt = 1e9;
    const box = defined(BOXES[0], 'box 0'),
      p = defined(S.players[0], 'g0'),
      m = defined(S.m[FLAN], 'Madame Flan'),
      b = brainOf(sim, FLAN);
    S.faults[0] = { k: 0, at: 0, burnt: false };
    // The box is set in a wall: the guard stands a metre in front of it, and Flan comes up behind them.
    Object.assign(p, { x: box.x, z: box.z - 1, on: false });
    const hands = (act: 'fix' | '') => actFloor(sim, S, 'g0', { t: 'p', x: p.x, z: p.z, yaw: 0, pitch: 0, on: false, sp: false, act });
    hands('fix');
    Object.assign(m, { x: p.x, z: p.z - 0.8, st: 'hunt' });
    Object.assign(b, { woke: true, tgt: p.id, last: { x: p.x, z: p.z } });
    return { sim, S, p, m, hands };
  }

  it('breaks off a fix when it reaches the guard, and gives them a split second before it can touch them', () => {
    const { sim, S, p, m } = busy();
    stepFloor(sim, S, 100);
    expect(S.evs.filter(e => e.type === 'startle')).toHaveLength(1);
    expect(p).toMatchObject({ act: '', flat: false });
    expect(S.faults[0]).toMatchObject({ burnt: false }); // the fault is as it was
    expect(m.st).toBe('hunt');
    for (let k = 2; k <= 6; k++) stepFloor(sim, S, k * 100);
    expect(p.flat).toBe(false); // 0.6 s on, standing still within reach
    for (let k = 7; k <= 20 && !p.flat; k++) stepFloor(sim, S, k * 100);
    expect(p.flat).toBe(true); // and then it has them
  });

  it('gives no second start to a guard who puts their hands straight back in the box', () => {
    const { sim, S, p, hands } = busy();
    stepFloor(sim, S, 100);
    hands('');
    hands('fix');
    for (let k = 2; k <= 20 && !p.flat; k++) stepFloor(sim, S, k * 100);
    expect(p.flat).toBe(true);
    expect(S.t).toBeLessThan(1.5);
    expect(S.evs.filter(e => e.type === 'startle')).toHaveLength(1);
  });

  it('gives no start to a guard who only says their hands are in a box', () => {
    const { sim, S, p } = busy();
    S.faults[0] = null;
    stepFloor(sim, S, 100);
    expect(p.flat).toBe(true);
  });

  it('gives the same start when it reaches over to a guard at a box it cannot get nearer to', () => {
    const { sim, S, p, m } = busy();
    // Two metres off, out of touch and inside its reach, and it has stood this far from them for two seconds.
    m.z = p.z - 2;
    brainOf(sim, FLAN).reach = { id: p.id, d: 2, x: p.x, z: p.z, t: S.t - 2 };
    stepFloor(sim, S, 100);
    expect(dist(m, p)).toBeGreaterThan(1.25); // not a touch: it reached over
    expect(S.evs.filter(e => e.type === 'startle')).toHaveLength(1);
    expect(p).toMatchObject({ act: '', flat: false });
  });

  it("spends Stompy's charge when the charge ends at a guard with their hands in a box", () => {
    const { sim, S, p } = busy();
    const flan = defined(S.m[FLAN], 'Madame Flan'),
      stompy = defined(S.m[STOMPY], 'Stompy'),
      b = brainOf(sim, STOMPY);
    Object.assign(flan, { ...REST[FLAN], st: 'rest' });
    brainOf(sim, FLAN).woke = false;
    // Mid-charge, straight at the guard's back from just out of touch, with nothing left on its charge gap.
    Object.assign(stompy, { x: p.x, z: p.z - 1.8, yaw: 0, st: 'charge' });
    Object.assign(b, { woke: true, tgt: p.id, last: { x: p.x, z: p.z }, timer: 2.4, cool: 0, dir: { x: 0, z: 1 } });
    stepFloor(sim, S, 100);
    expect(S.evs.filter(e => e.type === 'startle')).toHaveLength(1);
    expect(p.flat).toBe(false);
    expect(stompy.st).toBe('hunt');
    expect(b.cool).toBeGreaterThanOrEqual(9.5); // CHARGE_GAP, 10 s, less the ticks since
    expect(b.dir).toBeNull();
  });
});

describe('a thrown Mini Biggs', () => {
  // g0 on night 1 with the mascots frozen and awake, facing the longest clear throw from where they stand. to: where
  // a full throw that way comes down. step(): one tick. fly(): tick until the toy has sung (two seconds at most).
  function thrower() {
    const { sim, S } = start(1, 1, 1);
    sim.rng = () => 0; // every mascot in earshot hears a song
    S.dev = { freeze: true };
    const p = defined(S.players[0], 'g0');
    const throws = Array.from({ length: 16 }, (_, k) => {
      const yaw = (k * Math.PI) / 8;
      return { yaw, to: landing(S, p.x, p.z, yaw, TOY.range) };
    });
    const { yaw, to } = throws.reduce((a, b) => (dist(p, b.to) > dist(p, a.to) ? b : a));
    assert(dist(p, to) > 8, 'there is a clear throw from the spawn point');
    S.m.forEach((_, i) => {
      brainOf(sim, i).woke = true;
    });
    let now = 0;
    const step = () => {
      now += 100;
      stepFloor(sim, S, now);
    };
    const fly = () => {
      const toy = defined(S.toys.at(-1), 'the toy thrown');
      for (let k = 0; k < 20 && !toy.heard; k++) step();
      return toy;
    };
    const lob = () => {
      p.toy = true;
      actFloor(sim, S, 'g0', { t: 'throw', yaw, d: TOY.range });
      return fly();
    };
    // A point d metres along the throw and `side` metres to its left.
    const along = (d: number, side = 0) => ({ x: p.x + Math.sin(yaw) * d + Math.cos(yaw) * side, z: p.z + Math.cos(yaw) * d - Math.sin(yaw) * side });
    return { sim, S, p, to, step, lob, along };
  }

  it('stuns the mascot it hits and drops at its feet, and sails past the same one until that has worn off', () => {
    const { sim, S, p, to, step, lob, along } = thrower();
    const m = defined(S.m[0], 'Big Biggs'),
      b = brainOf(sim, 0);
    Object.assign(m, along(6, 0.5), { st: 'hunt' });
    Object.assign(b, { tgt: 'g0', last: { x: p.x, z: p.z } });
    const first = lob();
    expect(S.evs.slice(-2)).toMatchObject([
      { type: 'bonk', x: { i: 0, by: 'g0', x: m.x, z: m.z } },
      { type: 'toy', x: { x: m.x, z: m.z } },
    ]);
    expect(first).toMatchObject({ x: m.x, z: m.z });
    expect([m.st, b.tgt, b.timer]).toEqual(['stun', null, TOY.stun]);
    // Stunned, and for a while after it is back up, another one goes by.
    S.dev = {};
    const up = S.t + TOY.stun;
    while (S.t < up - 0.15) step();
    expect(m.st).toBe('stun');
    step();
    step();
    expect(m.st).not.toBe('stun');
    S.dev = { freeze: true };
    Object.assign(m, along(6, 0.5), { st: 'hunt' });
    expect(lob()).toMatchObject(to);
    expect(m.st).toBe('hunt');
    expect(S.evs.filter(e => e.type === 'bonk')).toHaveLength(1);
    // Once it has forgotten, it is hit again.
    S.t = b.wise;
    lob();
    expect(m.st).toBe('stun');
  });

  it('stuns nothing until it has flown TOY.armed metres', () => {
    const { sim, S, p, to, lob, along } = thrower();
    const m = defined(S.m[0], 'Big Biggs');
    Object.assign(brainOf(sim, 0), { tgt: 'g0', last: { x: p.x, z: p.z } });
    // Thrown a metre, at one standing a metre off: it lands and sings there, and that is all.
    Object.assign(m, along(1), { st: 'hunt' });
    actFloor(sim, S, 'g0', { t: 'throw', yaw: Math.atan2(to.x - p.x, to.z - p.z), d: 1 });
    for (let k = 1; k <= 5; k++) stepFloor(sim, S, k * 100);
    expect(defined(S.toys.at(-1), 'the toy thrown').heard).toBe(true);
    expect(m.st).not.toBe('stun');
    // Thrown as far as it goes, through one two metres off: it flies on to where it was thrown.
    brainOf(sim, 0).wise = 0;
    Object.assign(m, along(2), { st: 'hunt' });
    expect(lob()).toMatchObject(to);
    expect(m.st).not.toBe('stun');
    // One it reaches just short of TOY.armed metres out is passed too.
    brainOf(sim, 0).wise = 0;
    Object.assign(m, along(TOY.armed + 0.5), { st: 'hunt' });
    expect(lob()).toMatchObject(to);
    expect(S.evs.some(e => e.type === 'bonk')).toBe(false);
    // Six metres off, it is hit.
    brainOf(sim, 0).wise = 0;
    Object.assign(m, along(6), { st: 'hunt' });
    lob();
    expect(m.st).toBe('stun');
    expect(S.evs.filter(e => e.type === 'bonk')).toHaveLength(1);
  });

  it('with the power out, sails past one that is hunting', () => {
    const { sim, S, p, to, lob, along } = thrower();
    const m = defined(S.m[0], 'Big Biggs');
    Object.assign(S, { out: true, power: 0 });
    Object.assign(m, along(6), { st: 'hunt' });
    Object.assign(brainOf(sim, 0), { tgt: 'g0', last: { x: p.x, z: p.z } });
    expect(lob()).toMatchObject(to);
    expect(m.st).toBe('hunt');
    expect(S.evs.some(e => e.type === 'bonk')).toBe(false);
  });

  // Big Biggs wandering three metres in front of the guard, facing them, when a toy lands further on and takes him.
  function taken(out: boolean) {
    const { sim, S, p, lob, along, step } = thrower();
    const m = defined(S.m[0], 'Big Biggs');
    if (out) Object.assign(S, { out: true, power: 0 });
    Object.assign(m, along(3), { st: 'roam' });
    m.yaw = Math.atan2(p.x - m.x, p.z - m.z);
    lob();
    expect(m.st).toBe('search');
    S.dev = {};
    step();
    return { m, b: brainOf(sim, 0) };
  }

  it('takes all the attention of one that goes to its song', () => {
    const { m, b } = taken(false);
    expect([m.st, b.tgt]).toEqual(['search', null]); // the guard is three metres in front of it
  });

  it('with the power out, leaves one that goes to its song looking: it hunts the guard it sees', () => {
    const { m, b } = taken(true);
    expect([m.st, b.tgt]).toEqual(['hunt', 'g0']);
  });

  it('misses one switched off on its mark', () => {
    const { S, to, lob, along } = thrower();
    Object.assign(defined(S.m[0], 'Big Biggs'), along(6), { st: 'rest' });
    expect(lob()).toMatchObject(to);
    expect(S.evs.some(e => e.type === 'bonk')).toBe(false);
  });

  it('sings a hunting mascot off its guard, but not one charging, wise to it or hunting in the dark', () => {
    const { sim, S, p, to, lob } = thrower();
    const [biggs, flan, squish, stompy] = S.m;
    assert(biggs && flan && squish && stompy, 'the four mascots');
    // All within earshot of where it lands, clear of its flight.
    const beside = { x: to.x + (3 * (p.z - to.z)) / dist(p, to), z: to.z - (3 * (p.x - to.x)) / dist(p, to) };
    for (const m of [biggs, flan, squish]) Object.assign(m, beside, { st: 'hunt' });
    Object.assign(stompy, beside, { st: 'charge' });
    for (const i of [0, 1, 2]) Object.assign(brainOf(sim, i), { tgt: 'g0', last: { x: p.x, z: p.z } });
    brainOf(sim, 2).wise = 1e9;
    lob();
    expect(S.m.map(m => m.st)).toEqual(['search', 'search', 'hunt', 'charge']);
    expect(brainOf(sim, 0)).toMatchObject({ tgt: null, last: to, timer: TOY.linger, checks: [] });
    // With the power out a hunt goes on through the song.
    for (const m of [biggs, flan]) m.st = 'hunt';
    for (const i of [0, 1]) brainOf(sim, i).wise = 0;
    Object.assign(S, { out: true, power: 0 });
    lob();
    expect(S.m.map(m => m.st)).toEqual(['hunt', 'hunt', 'hunt', 'charge']);
  });
});
