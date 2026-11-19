// Loaded by the patched floor.mjs (see patch.mjs). Writes one JSON line per sim call to $REC_OUT: the call, the
// random draws the sim made during it, and after starts and steps the whole state S.
import { writeFileSync, appendFileSync } from 'node:fs';

// Luau has no hypot; both sides use the plain formula so their arithmetic matches.
Math.hypot = (a, b) => Math.sqrt(a * a + b * b);

const out = process.env.REC_OUT;
writeFileSync(out, '');
const REC = globalThis.__REC = { on: false, rands: [], dt: 0 };
const snap = S => JSON.parse(JSON.stringify(S, (k, v) => v === null ? false : v));

export function wrapSim(sim, game) {
  const run = (f, entry, withState) => {
    REC.rands = []; REC.on = true;
    try { f(); } finally { REC.on = false; }
    entry.rands = REC.rands;
    if (entry.op === 'step') entry.dt = REC.dt;
    if (withState) entry.S = snap(game.S);
    // Numbers go out as "#<shortest form>": Lune's JSON reader misreads about one double in ten by a bit, and
    // Luau's tonumber reads this form back exactly.
    appendFileSync(out, JSON.stringify(entry, (k, v) => typeof v === 'number' ? '#' + String(v) : v) + '\n');
  };
  return {
    ...sim,
    startFloorNight(n) {
      const players = Object.values(game.players).map(p => ({ id: p.id, name: p.name }));
      run(() => sim.startFloorNight(n), { op: 'start', n, players }, true);
    },
    stepFloor() { const e = { op: 'step' }; run(() => sim.stepFloor(), e, true); },
    actFloor(id, a) { run(() => sim.actFloor(id, a), { op: 'act', id, a: JSON.parse(JSON.stringify(a)) }, false); },
  };
}
