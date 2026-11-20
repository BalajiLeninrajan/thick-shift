#!/usr/bin/env node
// Plays the game thousands of times with scripted guards and
// prints what happened. The numbers in packages/sim/src/sim.ts were tuned
// against this table. The guards and the scenarios are in harness.ts.
//
//   node tools/balance/floor.ts                 every scenario, 40 seeds each
//   node tools/balance/floor.ts --seeds 200     more seeds
//   node tools/balance/floor.ts --only turtle,solo   scenarios whose name contains one of these
//   node tools/balance/floor.ts --workers 2     fewer worker threads, to spare memory
//   node tools/balance/floor.ts --deaths        also list how each guard was flattened
//   node tools/balance/floor.ts --trace "solo competent n1" --seed 3   one night's events (--steps adds where everyone is each second, --brains what each mascot is thinking)
//
// It exits non-zero if an assertion fails: a softlock (a mascot wedged on
// geometry, a breaker box nobody can reach, a night that does not end), a guard
// playing honestly flattened in the first 30 seconds of night 1, or a
// strategy that should lose doing as well as playing properly.
//
// Node runs it as it is by stripping the types, so it uses only TypeScript that stripping can erase.

import { cpus } from 'node:os';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import { defined, MASCOTS } from '../../packages/sim/src/index.ts';
import { checkBuilding, fail, failures, type Outcome, play, type Scenario, scenarios } from './harness.ts';

const argv = process.argv.slice(2),
  arg = <T>(k: string, d: T): string | T => {
    const i = argv.indexOf(`--${k}`);
    if (i < 0) return d;
    const v = argv[i + 1];
    if (v === undefined) {
      console.error(`--${k} needs a value`);
      process.exit(2);
    }
    return v;
  };
const SEEDS = +arg('seeds', 40),
  ONLY = arg('only', ''),
  TRACE = arg('trace', ''),
  WORKERS = +arg('workers', 12);

const CHUNK = 4; // seeds a worker plays before it reports back
// A worker's job: scenario i, seeds from to to. What it sends back: the nights and any failures.
interface Job {
  i: number;
  from: number;
  to: number;
}
interface Done {
  i: number;
  runs: Outcome[];
  failures: string[];
}

if (!isMainThread) {
  // A worker plays the scenarios it is handed and posts back the nights and any failures.
  const port = defined(parentPort, 'the parent port of a worker thread');
  port.on('message', ({ i, from, to }: Job) => {
    failures.length = 0;
    const sc = defined(scenarios[i], `scenario ${i}`), // jobs name scenarios by index
      runs = [];
    for (let seed = from; seed <= to; seed++) runs.push(play(sc, seed));
    port.postMessage({ i, runs, failures: [...failures] } satisfies Done);
  });
} else if (TRACE) {
  const sc = scenarios.find(s => s.name.includes(TRACE));
  if (!sc) {
    console.error('No scenario matches', TRACE);
    process.exit(2);
  }
  console.log(sc.name, 'seed', +arg('seed', 1));
  console.log(play(sc, +arg('seed', 1), { trace: argv.includes('--steps') ? 2 : 1, brains: argv.includes('--brains') }));
  console.log(failures.join('\n'));
} else {
  // The scenarios to play, with the nights each has played so far. i: its place in scenarios, which jobs name it by.
  interface Todo {
    i: number;
    sc: Scenario;
    runs: Outcome[];
  }
  const todo = scenarios.flatMap((sc, i): Todo[] => (ONLY.split(',').some(part => sc.name.includes(part)) ? [{ i, sc, runs: [] }] : []));
  const byIndex = new Map(todo.map(t => [t.i, t])),
    jobs: Job[] = [];
  for (const { i } of todo) for (let from = 1; from <= SEEDS; from += CHUNK) jobs.push({ i, from, to: Math.min(SEEDS, from + CHUNK - 1) });
  await new Promise<void>(done => {
    let next = 0,
      live = 0;
    const count = Math.max(1, Math.min(jobs.length, cpus().length, WORKERS));
    for (let k = 0; k < count; k++) {
      const w = new Worker(new URL(import.meta.url), { argv: process.argv.slice(2) });
      const give = () => {
        if (next < jobs.length) {
          live++;
          w.postMessage(jobs[next++]);
        } else {
          w.terminate();
          if (!live) done();
        }
      };
      w.on('message', (r: Done) => {
        live--;
        defined(byIndex.get(r.i), `scenario ${r.i}`).runs.push(...r.runs);
        failures.push(...r.failures);
        give();
      });
      w.on('error', e => {
        console.error(e);
        process.exit(2);
      });
      give();
    }
  });

  checkBuilding('the building');

  const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
  const sum = (runs: Outcome[], f: (r: Outcome) => number) => runs.reduce((s, r) => s + f(r), 0);
  const median = (list: number[]) => [...list].sort((a, b) => a - b)[list.length >> 1] ?? NaN; // NaN for none
  const rate = new Map<string, number>(); // win% by scenario name
  const head = [
    'scenario',
    'win%',
    'end',
    'flat/g',
    'peel',
    'B F S T %',
    'warn s',
    '<1.5s',
    'hunted',
    'calms',
    'torch',
    'low',
    'dead',
    'dry/g',
    'dry>flat',
    'flat dark',
    'burnt',
    'power',
    'out%',
    'crank s',
    'door s',
    'bangs',
    'dock s',
    'toys/g',
    'lured',
  ];
  const rows: (string | number)[][] = [];
  // Adds the scenario's row to the table and returns its win%.
  const row = (sc: Scenario, runs: Outcome[]) => {
    const n = runs.length,
      warn = runs.flatMap(r => r.warn),
      flats = sum(runs, r => r.flats),
      stood = sum(runs, r => r.stood),
      won = pct(
        sum(runs, r => +r.win),
        n
      );
    rate.set(sc.name, won);
    rows.push([
      sc.name,
      won,
      Math.round(sum(runs, r => r.t) / n),
      (flats / n / sc.n).toFixed(2),
      pct(
        sum(runs, r => r.peels),
        flats
      ),
      MASCOTS.map(i =>
        pct(
          sum(runs, r => r.by[i]),
          flats
        )
      ).join(' '),
      median(warn).toFixed(1),
      `${pct(warn.filter(x => x < 1.5).length, warn.length)}%`,
      `${pct(
        sum(runs, r => r.hunted),
        stood
      )}%`,
      (sum(runs, r => r.calms) / n).toFixed(1),
      `${pct(
        sum(runs, r => r.lit),
        stood
      )}%`,
      `${pct(
        sum(runs, r => r.low),
        stood
      )}%`,
      `${pct(
        sum(runs, r => r.dead),
        stood
      )}%`,
      (sum(runs, r => r.dry) / n / sc.n).toFixed(1),
      `${pct(
        sum(runs, r => r.dryFlat),
        sum(runs, r => r.dry)
      )}%`,
      `${pct(
        sum(runs, r => r.darkFlat),
        flats
      )}%`,
      `${pct(
        sum(runs, r => r.burnt),
        sum(runs, r => r.fixed + r.burnt)
      )}%`,
      Math.round(sum(runs, r => r.power) / n),
      pct(
        sum(runs, r => +(r.outs > 0)),
        n
      ),
      Math.round(sum(runs, r => r.cranked) / n),
      Math.round(sum(runs, r => r.shut) / n),
      (sum(runs, r => r.bangs) / n).toFixed(1),
      Math.round(sum(runs, r => r.charging) / n),
      (sum(runs, r => r.toys) / n / sc.n).toFixed(1),
      (
        sum(runs, r => r.lured) /
        Math.max(
          1,
          sum(runs, r => r.toys)
        )
      ).toFixed(2),
    ]);
    return won;
  };
  const wins = todo.map(({ sc, runs }) => {
    const won = row(sc, runs);
    if (sc.noMiss && sum(runs, r => r.burnt))
      fail(sc.name, `${sum(runs, r => r.burnt)} faults burnt with nothing in the way: they come faster than they can be walked to`);
    if (sc.night === 1 && !sc.worse && !sc.dev) {
      const early = Math.min(...runs.map(r => r.firstFlat));
      if (early < 30) fail(sc.name, `a guard was flattened ${early.toFixed(0)} s into night 1`);
    }
    return { sc, won };
  });
  // A strategy that should not work has to win under one night in ten, or under half as often as playing properly.
  for (const { sc, won } of wins) {
    const proper = sc.worse === undefined ? undefined : rate.get(sc.worse);
    if (proper !== undefined && won > Math.max(10, proper / 2)) fail(sc.name, `wins ${won}% of nights; playing properly wins ${proper}%`);
  }

  const width = head.map((h, c) => Math.max(h.length, ...rows.map(r => String(r[c]).length)));
  const line = (cells: (string | number)[]) =>
    cells
      .map((v, c) => {
        const w = defined(width[c], `the width of column ${c}`); // every row has a cell for each heading
        return c ? String(v).padStart(w) : String(v).padEnd(w);
      })
      .join('  ');
  console.log(`${SEEDS} seeds per scenario. n1 to n5 is the night.\n`);
  console.log(line(head));
  for (const r of rows) console.log(line(r));
  console.log(`
win%    nights survived to 6 AM            end     mean second the night ended (420 is 6 AM)
flat/g  flattenings per guard per night    peel    share of flattened guards who were peeled up
B F S T share of flattenings by Biggs, Flan, Squish, Tank
warn s  median seconds between a mascot being there to see or hear and it catching the guard; <1.5s is the share with less
hunted  share of standing time with something after you    calms   stretches of 20 s or more with nothing after anyone, per night
torch   share of standing time with the torch on           low, dead   share with it under a quarter, and flat; dry/g is how often it ran out per guard
dry>flat  share of torches running out that ended in a flattening within 20 s    flat dark  share of flattenings with the torch dead
burnt   share of faults left to burn    power   mean power at the end    out%    nights the power went out    crank s  seconds cranked    door s  seconds of shut door (two doors for ten seconds is 20)
bangs   bangs on shut doors    dock s  guard-seconds spent charging at the dock    toys/g  Mini Biggses thrown per guard per night
lured   mascots that went to look, per one thrown`);
  if (argv.includes('--deaths'))
    for (const { sc, runs } of todo)
      console.log(
        `\n${sc.name}\n` +
          runs
            .flatMap(r => r.notes)
            .slice(0, 30)
            .join('\n')
      );
  if (failures.length) {
    console.log(`\n${failures.length} FAILED\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log('\nNo softlocks, and nothing degenerate beats playing properly.');
}
