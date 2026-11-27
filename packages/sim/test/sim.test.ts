// The night's entry points called directly, without the harness's guards: the clock, starting a night, picking a
// night up from S alone (adoptFloor), starting the run again (restartFloor) and a guard's actions (actFloor).
import { describe, expect, it } from 'vitest';
import { assert, defined } from '../src/check.ts';
import { BIGGS, FLAN, GREG, MASCOTS } from '../src/config.ts';
import {
  BATTERY_SPOTS,
  BOOTH,
  BOXES,
  DESK,
  DOORWAYS,
  DUCTS,
  dist,
  HIDES,
  MASCOT_R,
  PANELS,
  PLAYER_R,
  REST,
  ROOMS3,
  roomAt,
  roomCentre,
  sees,
  spawnPoint,
  TOY_BOX,
  walkable,
} from '../src/map.ts';
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
  // A saved night, part way in: one mascot hunting, one charging, one stunned and one at rest, and one battery left
  // lying about.
  function savedState() {
    const { S } = start(5, 2, 3);
    const T = JSON.parse(JSON.stringify(S)) as State;
    const [biggs, flan, squish, greg] = T.m;
    assert(biggs && flan && squish && greg, 'the night has all four mascots');
    biggs.st = 'hunt';
    flan.st = 'charge';
    squish.st = 'stun';
    greg.st = 'rest';
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
    // and looks round instead; a stun and a rest stay as they are.
    expect(T.m.map(m => m.st)).toEqual(['hunt', 'search', 'stun', 'rest']);
    expect(sim.brains[0]).toMatchObject({ tgt: 'g0', last: { x: 18.5, z: 41.5 }, woke: true });
    expect(sim.brains[1]).toMatchObject({ tgt: null, last: { x: REST[1].x, z: REST[1].z }, woke: true });
    expect(sim.brains[2]?.woke).toBe(true);
    expect(sim.brains[3]?.woke).toBe(false);
    expect(sim.brains[3]?.cool).toBeGreaterThan(0); // Greg waits a full gap before it charges
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
    // lost charge, the stun timer, the rest timer and Greg's full charge gap (CHARGE_GAP, 10 s).
    const { sim, T } = adopt(7);
    const r = (v: number) => Math.round(v * 1000) / 1000;
    expect(sim.brains[3]?.cool).toBe(10);
    expect(sim.brains.map((b, i) => ({ st: T.m[i]?.st, tgt: b.tgt, timer: r(b.timer), cool: b.cool }))).toMatchSnapshot();
    expect({ batTimers: sim.batTimers.map(r), nextFault: r(sim.nextFault) }).toMatchSnapshot();
  });

  it('sends a mascot wandering when the saved night has it in a state this build does not have', () => {
    // Builds before this one had the catcher sit on its guard ('feast'), and a room may have saved a night like that.
    const T = savedState();
    Object.assign(defined(T.m[2], 'Squish'), { st: 'feast' });
    const { sim } = adopt(7, T);
    expect(T.m.map(m => m.st)).toEqual(['hunt', 'search', 'roam', 'rest']);
    expect(sim.brains[2]).toMatchObject({ woke: true, dest: null, home: false });
    for (let k = 1; k <= 50; k++) stepFloor(sim, T, 5000 + k * 100); // and the night goes on
  });

  it('gives a guard saved by a build that kept no fixAt their start at a breaker box', () => {
    // Builds before the start at a box had no p.fixAt. g0 was mid-fix at box 3 when the night was saved, with Biggs
    // a step behind them.
    const T = savedState();
    const g = defined(T.players[0], 'g0'),
      box = defined(BOXES[3], 'box 3');
    defined(T.faults, "the night's faults")[3] = { k: 0, at: 0, burnt: false };
    Object.assign(g, { x: box.x, z: box.z + 1, act: 'fix' });
    delete g.fixAt;
    // Their hands shook from a locker pull earlier in the night and have stopped since.
    T.t = 20;
    g.shaky = 12;
    Object.assign(defined(T.m[BIGGS], 'Biggs'), { x: box.x, z: box.z + 1.9, yaw: Math.PI });
    const { sim } = adopt(7, T);
    expect(g.fixAt).toBe(20);
    const startles = () => T.evs.filter(e => e.type === 'startle').length;
    for (let k = 1; k <= 40 && !startles() && !g.flat; k++) stepFloor(sim, T, 5000 + k * 100);
    expect(startles()).toBe(1);
    expect(g).toMatchObject({ act: '', flat: false });
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
    return { sim, S, p, m, b };
  }

  it('runs out of breath, comes on slower, and gets it back in a torch beam', () => {
    const { sim, S, p, m, b } = chase();
    p.on = false;
    // How far she gets in one step of a tenth of a second.
    let now = 0;
    const step = () => {
      const from = { x: m.x, z: m.z };
      now += 100;
      stepFloor(sim, S, now);
      return dist(m, from);
    };
    step();
    const fresh = step();
    expect(fresh).toBeGreaterThan(0.1);
    expect(b.puff).toBeCloseTo(1 - 0.1 / 8, 6); // one step of running out of the eight seconds she has
    b.puff = 0;
    const winded = step();
    expect(b.winded).toBe(true);
    expect(winded / fresh).toBeCloseTo(0.6, 2);
    // Held in the beam she is not running: ten seconds of that would fill her, and six bring her round.
    p.on = true;
    for (let k = 0; k < 59; k++) step();
    expect(b.winded).toBe(true);
    for (let k = 0; k < 3; k++) step();
    expect(b.winded).toBe(false);
    expect(p.flat).toBe(false);
  });

  it('does not give up on a guard it can see, however long a torch holds it', () => {
    const { sim, S, p, m } = chase();
    for (let k = 1; k <= 400; k++) stepFloor(sim, S, k * 100);
    expect(S.t).toBeCloseTo(40, 6);
    expect(m.st).toBe('hunt');
    expect(dist(m, { x: 19.5, z: 24 })).toBeLessThan(0.5); // held where it stood
    expect(p.flat).toBe(false);
  });

  it('walks away from the guard it caught, to another room at least 8 m off, and does not come back to stand over them', () => {
    const { sim, S } = start(3, 2, 1);
    S.stir = true;
    S.waveAt = 1e9;
    const p = defined(S.players[0], 'g0'),
      m = defined(S.m[FLAN], 'Madame Flan'),
      b = brainOf(sim, FLAN);
    Object.assign(p, { x: 19.5, z: 18, yaw: 0, pitch: 0 });
    Object.assign(m, { x: 19.5, z: 19, yaw: Math.PI, st: 'hunt' });
    Object.assign(b, { woke: true, tgt: p.id, last: { x: p.x, z: p.z } });
    stepFloor(sim, S, 100);
    expect(p.flat).toBe(true);
    expect(S.phase).toBe('play'); // g1 is still up, in the booth
    expect(m.st).toBe('roam');
    const dest = defined(b.dest, 'where it means to go');
    expect(roomAt(dest.x, dest.z)).not.toBe(roomAt(p.x, p.z));
    expect(dist(dest, p)).toBeGreaterThanOrEqual(8);
    let near = 0;
    for (let k = 2; k <= 300; k++) {
      stepFloor(sim, S, k * 100);
      if (k > 80 && m.i === FLAN && dist(m, p) < 4) near++;
    }
    expect(near).toBe(0); // from 8 s on, for the rest of half a minute
  });

  it('walks away from the guard it caught before a calm sends it home', () => {
    // Nothing is stirring, so a roamer goes home. Flan catches g0 a step and a half from her mark. g1 sits in the
    // booth with its doors shut and the power paid for, so she has nobody else to come for.
    const { sim, S } = start(3, 2, 1);
    S.stir = false;
    S.waveAt = 1e9;
    S.doors = { L: true, V: true, R: true };
    S.dev = { ...DEV_OFF, power: true };
    const p = defined(S.players[0], 'g0'),
      m = defined(S.m[FLAN], 'Madame Flan'),
      b = brainOf(sim, FLAN);
    Object.assign(p, { x: REST[FLAN].x, z: REST[FLAN].z + 1.6, yaw: 0, pitch: 0 });
    Object.assign(m, { x: REST[FLAN].x, z: REST[FLAN].z + 0.7, yaw: 0, st: 'hunt' });
    Object.assign(b, { woke: true, tgt: p.id, last: { x: p.x, z: p.z } });
    stepFloor(sim, S, 100);
    expect(p.flat).toBe(true);
    expect(m.st).toBe('roam');
    // She is 8 m off and out of the room before she turns for home or stands still.
    let k = 2;
    const clear = () => dist(m, p) >= 8 && roomAt(m.x, m.z) !== roomAt(p.x, p.z);
    while (k <= 600 && !clear()) {
      stepFloor(sim, S, k++ * 100);
      expect([m.st, b.home], `at ${S.t.toFixed(1)} s, ${dist(m, p).toFixed(1)} m off`).toEqual(['roam', false]);
    }
    expect(clear()).toBe(true);
    // The calm does not have her yet. They lie within 8 m of her mark, so for as long as they do she wanders, and
    // every place she picks to walk to is 8 m from them.
    b.spent = true; // and one a door has turned away does not wander blind: it has no mark to wait on
    for (const end = k + 600; k < end; ) {
      stepFloor(sim, S, k++ * 100);
      expect([m.st, b.home, b.spent], `at ${S.t.toFixed(1)} s`).toEqual(['roam', false, false]);
      if (b.dest) expect(dist(b.dest, p)).toBeGreaterThanOrEqual(8);
    }
    // Peeled up and gone to the booth: now she walks back to her mark and stands there.
    const q = defined(S.players[1], 'g1');
    Object.assign(p, { flat: false, flatBy: -1, x: q.x, z: q.z });
    for (const end = k + 600; k < end && m.st !== 'rest'; ) stepFloor(sim, S, k++ * 100);
    expect(m.st).toBe('rest');
    expect(dist(m, REST[FLAN])).toBeLessThan(1.5);
  });

  it('cannot catch the guard standing beside the one it caught for 1.8 s, and can after that', () => {
    const { sim, S } = start(3, 3, 1);
    S.stir = true;
    S.waveAt = 1e9;
    const [p, q] = [defined(S.players[0], 'g0'), defined(S.players[1], 'g1')],
      m = defined(S.m[FLAN], 'Madame Flan'),
      b = brainOf(sim, FLAN);
    // Both within her reach, a metre from her. g2 is in the booth, so the night goes on.
    Object.assign(p, { x: 19.5, z: 18, yaw: 0, pitch: 0 });
    Object.assign(q, { x: 20.3, z: 18, yaw: 0, pitch: 0 });
    Object.assign(m, { x: 19.9, z: 18.9, yaw: Math.PI, st: 'hunt' });
    Object.assign(b, { woke: true, tgt: p.id, last: { x: p.x, z: p.z } });
    stepFloor(sim, S, 100);
    expect([p.flat, q.flat]).toEqual([true, false]);
    expect(b.noCatch).toBeCloseTo(S.t + 1.8, 12);
    expect(S.m.map(o => brainOf(sim, o.i).noCatch > 0)).toEqual(S.m.map(o => o.i === FLAN)); // hers alone
    const first = S.t;
    let second = 0;
    for (let k = 2; k <= 60 && !second; k++) {
      stepFloor(sim, S, k * 100);
      // Nothing else is about, so she is the one in reach of g1 the whole window.
      if (S.t < first + 1.8) expect([q.flat, dist(m, q) < 1.25], `at ${S.t.toFixed(1)} s`).toEqual([false, true]);
      if (q.flat) second = S.t;
    }
    expect(q.flatBy).toBe(FLAN);
    expect(second - first).toBeGreaterThanOrEqual(1.8);
    expect(second - first).toBeLessThan(2.5);
  });

  it('has somewhere to walk away to wherever a guard is caught', () => {
    // pickDest wants a room that is not the booth, the ducts, the body's or the one the mascot stands in, with its
    // middle 8 m or more from the body.
    for (let x = 0.5; x < 60; x++)
      for (let z = 0.5; z < 60; z++) {
        const at = roomAt(x, z);
        if (at < 0) continue;
        const rooms = ROOMS3.map((_, i) => i).filter(i => i !== BOOTH && i !== DUCTS && i !== at && dist(roomCentre(i), { x, z }) >= 8);
        expect(rooms.length, `rooms clear of (${x}, ${z})`).toBeGreaterThanOrEqual(2);
      }
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

  // Madame Flan awake in the West Hall on a quiet night 1, and a guard with their torch on. Locker 10 is round the
  // hall's corner from the top of its long leg.
  function spotted(mascot: { x: number; z: number; yaw: number }, guard: { x: number; z: number }) {
    const { sim, S } = start(1, 1, 1);
    S.stir = false;
    S.waveAt = 1e9;
    const p = defined(S.players[0], 'g0'),
      m = defined(S.m[FLAN], 'Madame Flan'),
      b = brainOf(sim, FLAN);
    Object.assign(p, { ...guard, on: true });
    Object.assign(m, { ...mascot, st: 'roam' });
    b.woke = true;
    stepFloor(sim, S, 100);
    expect(m.st).toBe('hunt');
    return { sim, S, p, m, b, h: defined(HIDES[10], 'locker 10') };
  }

  it('does not know the locker of a guard who got in round a corner from it', () => {
    const seenAt = { x: 4, z: 37 };
    const { sim, S, p, m, b, h } = spotted({ x: 4, z: 28, yaw: 0 }, seenAt);
    // Round the corner and up to the doors. For a moment it still knows which way they went.
    Object.assign(p, { x: 10.6, z: 40.6 });
    stepFloor(sim, S, 200);
    expect(m.st).toBe('hunt');
    expect(b.last).toEqual({ x: 10.6, z: 40.6 });
    actFloor(sim, S, 'g0', { t: 'use', what: 'hide', i: 10 });
    expect(p.hid).toBe(10);
    expect(b.knows).toBe(-1);
    // It goes on to where it last saw them, not to the doors.
    stepFloor(sim, S, 300);
    expect(b.knows).toBe(-1);
    expect(b.last).toEqual(seenAt);
    expect(dist(seenAt, h.at)).toBeGreaterThan(5);
  });

  it('knows the locker of a guard it watched get in, and pulls them out', () => {
    const { sim, S, p, b } = spotted({ x: 6.5, z: 40.5, yaw: Math.PI / 2 }, { x: 10.6, z: 40.6 });
    actFloor(sim, S, 'g0', { t: 'use', what: 'hide', i: 10 });
    expect(p.hid).toBe(10);
    expect(b.knows).toBe(10);
    for (let k = 2; k <= 100 && p.hid === 10; k++) stepFloor(sim, S, k * 100);
    expect(S.evs.some(e => e.type === 'found')).toBe(true);
    expect(p.hid).toBe(-1);
  });

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

  it('does not open a locker on a guard until 1.8 s after its last catch', () => {
    const { sim, S, p } = hiding();
    brainOf(sim, FLAN).noCatch = 1.8;
    const found = () => S.evs.some(e => e.type === 'found');
    let k = 1;
    while (S.t < 1.65) {
      stepFloor(sim, S, k++ * 100);
      expect([found(), p.hid], `at ${S.t.toFixed(1)} s`).toEqual([false, 0]);
    }
    for (const end = k + 3; k < end; k++) stepFloor(sim, S, k * 100);
    expect(found()).toBe(true);
    expect(p).toMatchObject({ hid: -1, flat: false });
  });

  // A night-1 guard standing still with the torch off, and one mascot already hunting them from `from`, the rest
  // kept on their marks. Greg never charges.
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
    const { sim, S, p } = stalk(GREG, { x: 39.62, z: 2.16 }, { x: 34, z: 6.5 });
    expect(until(sim, S, p, 20)).toBeLessThan(8);
    expect(p.flat).toBe(true);
  });

  it('keeps reaching for a guard a prop hides each time it rocks back', () => {
    // The Kitchen's south-east corner, behind the locker. Greg is put by turns where it can reach them and a step
    // back, out of reach and with the locker in the way of its eyes, as one wedged on the locker rocked.
    const guard = { x: 41.63, z: 24.02 },
      near = { x: 40.65, z: 22.22 },
      back = { x: 40.2, z: 21.45 };
    expect(dist(near, guard)).toBeLessThan(F.GRAB);
    expect(dist(back, guard)).toBeGreaterThan(F.GRAB);
    expect(sees(back.x, back.z, guard.x, guard.z)).toBe(false);
    const { sim, S, p, m } = stalk(GREG, guard, near);
    const t = until(sim, S, p, 20, k => Object.assign(m, k % 8 < 4 ? near : back));
    expect(p.flat).toBe(true);
    expect(t).toBeLessThan(4);
  });

  it('sees a guard within its reach over the furniture, and no further', () => {
    // Across the round table by the Snack Bar's soda machine, with its back to nobody: 2.2 m and 3.4 m away.
    for (const [x, found] of [
      [26.6, true],
      [27.8, false],
    ] as const) {
      const { sim, S, p, m, b } = stalk(BIGGS, { x, z: 31 }, { x: 24.4, z: 31 });
      Object.assign(m, { st: 'roam', yaw: Math.PI / 2 });
      Object.assign(b, { tgt: null, last: null, dest: { x: m.x, z: m.z }, timer: 1e9 });
      expect(sees(m.x, m.z, p.x, p.z)).toBe(false);
      until(sim, S, p, 5);
      expect(p.flat).toBe(found);
    }
  });

  it('gives up a hunt that is getting nowhere, and leaves that guard be for a while', () => {
    // Flan in the Main Hall with the guard in plain sight across it (9 m, inside SIGHT.lit), and something holding
    // her where she stands.
    const from = { x: 14, z: 18 };
    const { sim, S, p, m, b } = stalk(FLAN, { x: 23, z: 18 }, from);
    const step = (k: number) => {
      Object.assign(m, from);
      stepFloor(sim, S, k * 100);
    };
    for (let k = 1; k <= 70; k++) step(k);
    expect(m.st).toBe('hunt');
    for (let k = 71; k <= 100; k++) step(k);
    expect(m.st).toBe('roam'); // on its way back to its mark, the building being calm
    expect(b).toMatchObject({ tgt: null, shun: { id: 'g0' } });
    // The guard is still in plain sight, and it does not look at them again until it has been a while.
    const spots = () => S.evs.filter(e => e.type === 'spot').length;
    for (let k = 101; k <= 170; k++) step(k);
    expect(spots()).toBe(0);
    for (let k = 171; k <= 230; k++) step(k);
    expect(spots()).toBe(1);
    expect(p.flat).toBe(false);
  });

  it('bangs on the booth door shut on it, and does not go round to one that is open', () => {
    // Flan in the West Hall after a guard in the booth. Only the left door is shut: the right one is open, the long way round.
    const { sim, S, m, b } = stalk(FLAN, { x: 15.6, z: 37.2 }, { x: 11, z: 40.5 });
    S.doors.L = true;
    const from = S.evId;
    for (let k = 1; k <= 30 && m.st !== 'siege'; k++) stepFloor(sim, S, k * 100);
    expect([m.st, b.key]).toEqual(['siege', 'L']);
    for (let k = 31; k <= 60; k++) stepFloor(sim, S, k * 100);
    expect(S.evs.filter(e => e.id > from && e.type === 'bang').map(e => e.x)).toContain('L');
  });

  it('does not count the time it stood banging on a door as getting nowhere', () => {
    // Flan in the West Hall after a guard in the booth, who stands beside the left door where its wall hides them.
    // The booth's doors are shut.
    const { sim, S, p, m, b } = stalk(FLAN, { x: 15.6, z: 37.2 }, { x: 11, z: 40.5 });
    Object.assign(S.doors, { L: true, V: true, R: true });
    let k = 1;
    while (k <= 30 && m.st !== 'siege') stepFloor(sim, S, k++ * 100);
    expect([m.st, b.key]).toEqual(['siege', 'L']);
    // She is kept banging for ten seconds, longer than a hunt may get nowhere (STUCK.time, 8 s).
    for (const end = k + 100; k < end; k++) {
      b.bangs = 0;
      stepFloor(sim, S, k * 100);
    }
    expect(m.st).toBe('siege');
    // The door opens on nobody she can see. A step later the guard walks into the doorway with their torch on.
    S.doors.L = false;
    stepFloor(sim, S, k++ * 100);
    expect(m.st).toBe('hunt');
    Object.assign(p, { x: 18, z: 40.5, on: true });
    for (const end = k + 10; k < end; k++) {
      stepFloor(sim, S, k * 100);
      expect(m.st, `at ${S.t.toFixed(1)} s`).toBe('hunt');
      expect(b).toMatchObject({ tgt: 'g0', shun: null });
    }
    expect(p.flat).toBe(false);
  });

  // A hunt of `seconds` with the hunter put back at `from` before every step, the guard in plain sight 9 m off with
  // their torch on and pointed away. Returns how far each step took it.
  function onTheSpot(i: MascotIndex, seconds: number, set?: (S: NightState) => void) {
    const from = { x: 14, z: 18 };
    const { sim, S, p, m, b } = stalk(i, { x: 23, z: 18 }, from);
    p.on = true;
    set?.(S);
    const steps: number[] = [];
    for (let k = 1; k <= seconds * 10; k++) {
      Object.assign(m, from);
      b.park = null; // it is put back every step, and is not to be taken for a hunt going nowhere (STUCK)
      stepFloor(sim, S, k * 100);
      steps.push(dist(m, from));
    }
    expect(m.st).toBe('hunt');
    return { b, first: defined(steps[1], 'its second step'), last: defined(steps.at(-1), 'its last step') };
  }

  it('never tires Big Biggs, who does not run', () => {
    // Twelve seconds: half as long again as empties anyone else's breath (TIRE.run, 8 s).
    const flan = onTheSpot(FLAN, 12);
    expect(flan.b.winded).toBe(true);
    expect(flan.last / flan.first).toBeCloseTo(0.6, 2);
    const biggs = onTheSpot(BIGGS, 12);
    expect(biggs.b).toMatchObject({ puff: 1, winded: false });
    expect(biggs.last).toBeCloseTo(biggs.first, 9);
  });

  it('tires nothing with the power out', () => {
    const flan = onTheSpot(FLAN, 12, S => {
      S.dev = { ...DEV_OFF, god: true }; // all four come in the dark, and the night is to last the twelve seconds
      S.out = true;
      S.power = 0;
    });
    expect(flan.b).toMatchObject({ puff: 1, winded: false });
    expect(flan.last).toBeCloseTo(flan.first, 9);
  });

  it('costs Greg no breath to charge', () => {
    const from = { x: 19.5, z: 13 };
    const { sim, S, m, b } = stalk(GREG, { x: 19.5, z: 24 }, from);
    Object.assign(m, { st: 'charge', yaw: 0 });
    Object.assign(b, { timer: 2.4, dir: { x: 0, z: 1 }, puff: 0.5 });
    for (let k = 1; k <= 10; k++) stepFloor(sim, S, k * 100);
    expect(m.st).toBe('charge');
    expect(dist(m, from)).toBeGreaterThan(6); // a second at 7 m/s
    expect(b.puff).toBeCloseTo(0.6, 9); // and a second of the ten that fill it
    expect(b.winded).toBe(false);
  });

  it('does not reach over for a guard until 1.8 s after its last catch', () => {
    // The corner past the trestle table again. Flan has got as near as she can and begun to reach.
    const { sim, S, p, m, b } = stalk(FLAN, { x: 26.6, z: 11.86 }, { x: 24.3, z: 13.8 });
    let k = 1;
    while (k <= 60 && !b.reach) stepFloor(sim, S, k++ * 100);
    const reach = defined(b.reach, 'the reach she has begun');
    // She has been reaching long enough (GRAB_TIME, 1.2 s), and caught someone else this instant.
    reach.t = S.t - 2;
    const free = S.t + 1.8;
    b.noCatch = free;
    while (S.t < free - 0.15) {
      stepFloor(sim, S, k++ * 100);
      expect(p.flat, `at ${S.t.toFixed(1)} s`).toBe(false);
    }
    for (const end = k + 15; k < end && !p.flat; k++) stepFloor(sim, S, k * 100);
    expect(p).toMatchObject({ flat: true, flatBy: FLAN });
    expect(S.t).toBeGreaterThanOrEqual(free - 1e-9);
    expect(dist(m, p)).toBeGreaterThan(F.CATCH);
  });

  it('finds its way out of the ducts if it is not Squish', () => {
    // The east end of the ducts, where one that followed a guard in used to stand facing the wall.
    const { sim, S, m, b } = stalk(FLAN, spawnPoint(0), { x: 25.18, z: 34.26 });
    Object.assign(m, { st: 'roam' });
    Object.assign(b, { tgt: null, last: null });
    for (let k = 1; k <= 100; k++) stepFloor(sim, S, k * 100);
    expect(roomAt(m.x, m.z)).not.toBe(DUCTS); // on its way back to its mark
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
    // Two metres off, out of touch and inside its reach. It began reaching two seconds ago from as near as it has
    // got (1.5 m), so the step it takes this tick does not count as getting nearer.
    m.z = p.z - 2;
    brainOf(sim, FLAN).reach = { id: p.id, d: 1.5, x: p.x, z: p.z, t: S.t - 2 };
    stepFloor(sim, S, 100);
    expect(dist(m, p)).toBeGreaterThan(1.25); // not a touch: it reached over
    expect(S.evs.filter(e => e.type === 'startle')).toHaveLength(1);
    expect(p).toMatchObject({ act: '', flat: false });
  });

  // A guard sitting at the camera desk, and Madame Flan a step behind them, hunting. near: whether they are at the desk.
  function watching(near = true) {
    const { sim, S } = start(1, 1, 1);
    S.stir = false;
    S.waveAt = 1e9;
    const p = defined(S.players[0], 'g0'),
      m = defined(S.m[FLAN], 'Madame Flan'),
      b = brainOf(sim, FLAN);
    Object.assign(p, near ? { x: DESK.x, z: DESK.z + 0.9, on: false } : { x: 21, z: 42.5, on: false });
    actFloor(sim, S, 'g0', { t: 'p', x: p.x, z: p.z, yaw: Math.PI, pitch: 0, on: false, sp: false, act: 'cams' });
    Object.assign(m, { x: p.x, z: p.z + 0.8, st: 'hunt' });
    Object.assign(b, { woke: true, tgt: p.id, last: { x: p.x, z: p.z } });
    return { sim, S, p, m };
  }

  it('gives a guard caught at the camera desk the same split second as one at a box', () => {
    const { sim, S, p, m } = watching();
    stepFloor(sim, S, 100);
    expect(S.evs.filter(e => e.type === 'startle')).toHaveLength(1);
    expect(p).toMatchObject({ act: '', flat: false });
    expect(m.st).toBe('hunt');
    for (let k = 7; k <= 20 && !p.flat; k++) stepFloor(sim, S, k * 100);
    expect(p.flat).toBe(true);
  });

  it('gives no start to a guard who says they are at the cameras away from the desk', () => {
    const { sim, S, p } = watching(false);
    stepFloor(sim, S, 100);
    expect(p.flat).toBe(true);
  });

  it("spends Greg's charge when the charge ends at a guard with their hands in a box", () => {
    const { sim, S, p } = busy();
    const flan = defined(S.m[FLAN], 'Madame Flan'),
      greg = defined(S.m[GREG], 'Greg'),
      b = brainOf(sim, GREG);
    Object.assign(flan, { ...REST[FLAN], st: 'rest' });
    brainOf(sim, FLAN).woke = false;
    // Mid-charge, straight at the guard's back from just out of touch, with nothing left on its charge gap.
    Object.assign(greg, { x: p.x, z: p.z - 1.8, yaw: 0, st: 'charge' });
    Object.assign(b, { woke: true, tgt: p.id, last: { x: p.x, z: p.z }, timer: 2.4, cool: 0, dir: { x: 0, z: 1 } });
    stepFloor(sim, S, 100);
    expect(S.evs.filter(e => e.type === 'startle')).toHaveLength(1);
    expect(p.flat).toBe(false);
    expect(greg.st).toBe('hunt');
    expect(b.cool).toBeGreaterThanOrEqual(9.5); // CHARGE_GAP, 10 s, less the ticks since
    expect(b.dir).toBeNull();
  });

  it('lets Greg charge on through a guard nothing can catch (dev god mode)', () => {
    const { sim, S } = start(1, 1, 1);
    S.stir = false;
    S.waveAt = 1e9;
    S.dev = { ...DEV_OFF, god: true };
    const p = defined(S.players[0], 'g0'),
      greg = defined(S.m[GREG], 'Greg'),
      b = brainOf(sim, GREG);
    Object.assign(p, { x: 19.5, z: 14.8, on: false });
    Object.assign(greg, { x: 19.5, z: 13, yaw: 0, st: 'charge' });
    Object.assign(b, { woke: true, tgt: p.id, last: { x: p.x, z: p.z }, timer: 2.4, cool: 0, dir: { x: 0, z: 1 } });
    stepFloor(sim, S, 100);
    expect(p.flat).toBe(false);
    expect(greg.st).toBe('charge'); // still charging, and the next step needs the heading it had
    for (let k = 2; k <= 100; k++) stepFloor(sim, S, k * 100);
    expect([S.phase, p.flat]).toEqual(['play', false]);
    expect(S.t).toBeCloseTo(10, 6);
    expect(greg.st).not.toBe('charge'); // the charge ended as any other does
  });

  it("spends Greg's charge when the charge ends in a catch", () => {
    // Two guards in a line down the Main Hall, the far one with a torch on, and a third in the booth. Greg is
    // mid-charge at the near one's back with nothing left on its charge gap.
    const { sim, S } = start(1, 3, 1);
    S.stir = false;
    S.waveAt = 1e9;
    const [p, q] = [defined(S.players[0], 'g0'), defined(S.players[1], 'g1')],
      greg = defined(S.m[GREG], 'Greg'),
      b = brainOf(sim, GREG);
    Object.assign(p, { x: 19.5, z: 14.8, on: false });
    Object.assign(q, { x: 19.5, z: 24, yaw: Math.PI / 2, on: true });
    Object.assign(greg, { x: 19.5, z: 13, yaw: 0, st: 'charge' });
    Object.assign(b, { woke: true, tgt: p.id, last: { x: p.x, z: p.z }, timer: 2.4, cool: 0, dir: { x: 0, z: 1 } });
    stepFloor(sim, S, 100);
    expect([p.flat, p.flatBy, q.flat]).toEqual([true, GREG, false]);
    expect(b.cool).toBeGreaterThanOrEqual(9.5); // CHARGE_GAP, 10 s, less the ticks since
    expect(b.dir).toBeNull();
    // The other guard is 9 m off down a clear run. It comes for them on foot: no wind-up inside the gap.
    for (let k = 2; k <= 95; k++) {
      stepFloor(sim, S, k * 100);
      expect(greg.st, `at ${S.t.toFixed(1)} s`).not.toBe('windup');
    }
    expect(S.evs.filter(e => e.type === 'spot' && e.x.i === GREG).length).toBeGreaterThan(0);
    expect(S.evs.filter(e => e.type === 'roar')).toHaveLength(0);
  });
});

describe('a crew', () => {
  // Night 1 for n guards with nothing stirring and no fault due.
  function quiet(n: number) {
    const { sim, S } = start(1, n, 1);
    S.stir = false;
    S.waveAt = 1e9;
    sim.nextFault = 1e9;
    return { sim, S };
  }
  // What one step of a tenth of a second takes off the power, over what a night with nothing wrong takes (the
  // lights, 0.005).
  function spent(n: number, set: (sim: Sim, S: NightState) => void) {
    const { sim, S } = quiet(n);
    set(sim, S);
    stepFloor(sim, S, 100);
    return 100 - S.power - 0.005;
  }
  const faults = (k: number) => (_sim: Sim, S: NightState) => {
    for (let i = 0; i < k; i++) S.faults[i] = { k: 0, at: 0, burnt: false };
  };

  it('gets a fault half as often again for each guard past the first', () => {
    // With every draw 0.5 the gap to the next fault is the usual one: 50 s alone at midnight on night 1.
    const gap = (n: number) => {
      const { sim, S } = quiet(n);
      sim.rng = () => 0.5;
      sim.nextFault = 0;
      stepFloor(sim, S, 100);
      expect(S.faults.filter(Boolean)).toHaveLength(1);
      return sim.nextFault;
    };
    const alone = gap(1);
    expect(alone).toBeCloseTo(50, 1);
    expect(alone / gap(2)).toBeCloseTo(1.5, 9);
    expect(alone / gap(4)).toBeCloseTo(2.5, 9);
  });

  it('pays two thirds of a shut door as two and two fifths as four, and all of it alone', () => {
    const doors = (n: number) => spent(n, (_sim, S) => Object.assign(S.doors, { L: true, V: true, R: true }));
    expect(doors(1)).toBeCloseTo(3 * 0.18 * 0.1, 9); // DRAIN.door a second for each, as it always was
    expect(doors(2) / doors(1)).toBeCloseTo(2 / 3, 6);
    expect(doors(4) / doors(1)).toBeCloseTo(2 / 5, 6);
  });

  it('pays for a bang on a door the same way', () => {
    // Flan at the booth's left door, shut, with her next bang due. What the shut door itself draws is taken off.
    const bang = (n: number) => {
      const shut = (_sim: Sim, S: NightState) => {
        S.doors.L = true;
      };
      const all = spent(n, (sim, S) => {
        shut(sim, S);
        Object.assign(defined(S.m[FLAN], 'Madame Flan'), { x: 13.6, z: 40.5, yaw: Math.PI / 2, st: 'siege' });
        Object.assign(brainOf(sim, FLAN), { woke: true, key: 'L', timer: 0, was: 'siege' });
      });
      return all - spent(n, shut);
    };
    // BANG_COST is 2.5. A fault the bang breaks leaks a ten-thousandth of a point in the step.
    expect(bang(1)).toBeCloseTo(2.5, 2);
    expect(bang(2)).toBeCloseTo((2.5 * 2) / 3, 2);
    expect(bang(4)).toBeCloseTo((2.5 * 2) / 5, 2);
  });

  it("has two and a half open faults for a lone guard's one before they pile up", () => {
    const one = spent(1, faults(1));
    expect(one).toBeGreaterThan(0);
    // Alone, each open fault past the first makes all of them leak FAULT.pile (0.4) more, as it always did.
    expect(spent(1, faults(2))).toBeCloseTo(2 * 1.4 * one, 9);
    expect(spent(1, faults(3))).toBeCloseTo(3 * 1.8 * one, 9);
    // Four guards share a leak, and get two and a half faults for a lone guard's one. Two open are within that;
    // five are twice it, and pile like a lone guard's two.
    const each = spent(4, faults(1));
    expect(each).toBeCloseTo(one / 4, 9);
    expect(spent(4, faults(2))).toBeCloseTo(2 * each, 9);
    expect(spent(4, faults(5))).toBeCloseTo(5 * 1.4 * each, 9);
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

  it('misses one banging on a booth door', () => {
    const { sim, S, to, lob, along } = thrower();
    const m = defined(S.m[0], 'Big Biggs');
    Object.assign(m, along(6), { st: 'siege' });
    Object.assign(brainOf(sim, 0), { key: 'L', timer: 1 });
    expect(lob()).toMatchObject(to);
    expect(m.st).toBe('siege');
    expect(S.evs.some(e => e.type === 'bonk')).toBe(false);
  });

  it('does not hit a mascot through a shut door', () => {
    // Thrown west across the booth at the left door, from 4.6 m off, at Biggs standing right behind the door.
    const door = defined(
      DOORWAYS.find(d => d.key === 'L'),
      'the left door'
    );
    const [x0, z0, x1, z1] = door.rect,
      z = (z0 + z1) / 2;
    for (const shut of [true, false]) {
      const { sim, S, p } = thrower();
      const m = defined(S.m[0], 'Big Biggs');
      Object.assign(p, { x: x1 + 4.6, z });
      Object.assign(m, { x: x0 - 0.2, z, st: 'roam' });
      S.doors.L = shut;
      actFloor(sim, S, 'g0', { t: 'throw', yaw: -Math.PI / 2, d: TOY.range });
      for (let k = 1; k <= 20; k++) stepFloor(sim, S, k * 100);
      expect(defined(S.toys[0], 'the toy').heard).toBe(true);
      // It may still hear the song through the door, which is another matter.
      expect(
        S.evs.some(e => e.type === 'bonk'),
        shut ? 'door shut' : 'door open'
      ).toBe(!shut);
      expect(m.st === 'stun').toBe(!shut);
    }
  });

  it('sings a hunting mascot off its guard, but not one charging, wise to it or hunting in the dark', () => {
    const { sim, S, p, to, lob } = thrower();
    const [biggs, flan, squish, greg] = S.m;
    assert(biggs && flan && squish && greg, 'the four mascots');
    // All within earshot of where it lands, clear of its flight.
    const beside = { x: to.x + (3 * (p.z - to.z)) / dist(p, to), z: to.z - (3 * (p.x - to.x)) / dist(p, to) };
    for (const m of [biggs, flan, squish]) Object.assign(m, beside, { st: 'hunt' });
    Object.assign(greg, beside, { st: 'charge' });
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
