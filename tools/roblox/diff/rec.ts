// Loaded by tools/balance/harness.ts when REC_OUT is set (run.sh sets it). Writes one JSON line per sim call to
// $REC_OUT: the call, the random draws the sim made during it, and after starts and steps the whole state S.
import { writeFileSync, appendFileSync } from 'node:fs';
import type { Sim, actFloor, startFloorNight, stepFloor } from '../../../packages/sim/src/sim.ts';
import type { State } from '../../../packages/sim/src/types.ts';

// The night's entry points, as the harness calls them.
export interface Night {
  startFloorNight: typeof startFloorNight;
  stepFloor: typeof stepFloor;
  actFloor: typeof actFloor;
}

// Luau has no hypot; both sides use the plain formula so their arithmetic matches. Nothing calls Math.hypot before
// the first night, and the sim and the map look it up when they call it, so replacing it here reaches them.
Math.hypot = (a, b) => Math.sqrt(a * a + b * b);

const out = process.env.REC_OUT as string; // set, or the harness would not have loaded this
writeFileSync(out, '');
const REC = { on: false, rands: [] as number[] };
const snap = (S: State): unknown => JSON.parse(JSON.stringify(S, (k, v) => (v === null ? false : v)));

// The night's entry points, recording each call. Draws are recorded only inside a sim call, so the harness's own
// draws, which share the stream, are left out.
export function wrapSim(night: Night, sim: Sim): Night {
  const inner = sim.rng;
  sim.rng = () => {
    const v = inner();
    if (REC.on) REC.rands.push(v);
    return v;
  };
  // extra: fields that follow the draws, as the lines have always been laid out. S: the state to record after.
  const run = (f: () => void, entry: Record<string, unknown>, extra: Record<string, unknown>, S: State | null) => {
    REC.rands = [];
    REC.on = true;
    try {
      f();
    } finally {
      REC.on = false;
    }
    entry.rands = REC.rands;
    Object.assign(entry, extra);
    if (S) entry.S = snap(S);
    // Numbers go out as "#<shortest form>": Lune's JSON reader misreads about one double in ten by a bit, and
    // Luau's tonumber reads this form back exactly.
    appendFileSync(out, `${JSON.stringify(entry, (k, v) => (typeof v === 'number' ? `#${String(v)}` : v))}\n`);
  };
  return {
    startFloorNight(sim, S, n) {
      const players = Object.values(sim.players).map(p => ({ id: p.id, name: p.name }));
      run(() => night.startFloorNight(sim, S, n), { op: 'start', n, players }, {}, S);
    },
    stepFloor(sim, S, now) {
      // The step's real elapsed time, before the sim caps it, so the replay steps by the same amount.
      const dt = (now - sim.lastStep) / 1000;
      run(() => night.stepFloor(sim, S, now), { op: 'step' }, { dt }, S);
    },
    actFloor(sim, S, id, a) {
      run(() => night.actFloor(sim, S, id, a), { op: 'act', id, a: JSON.parse(JSON.stringify(a)) }, {}, null);
    },
  };
}
