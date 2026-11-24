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
import { parseArgs } from 'node:util';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import { defined, MASCOTS } from '../../packages/sim/src/index.ts';
import { checkBuilding, type Outcome, play, type Scenario, scenarios } from './harness.ts';

function usage(why: string): never {
  console.error(`${why}
usage: node tools/balance/floor.ts [--seeds N] [--only NAME,...] [--workers N] [--deaths]
       node tools/balance/floor.ts --trace NAME [--seed N] [--steps] [--brains]`);
  process.exit(2);
}
// The flags, or the usage when one is unknown or lacks its value.
function flags() {
  try {
    return parseArgs({
      options: {
        seeds: { type: 'string' },
        only: { type: 'string', default: '' },
        workers: { type: 'string' },
        deaths: { type: 'boolean', default: false },
        trace: { type: 'string' },
        seed: { type: 'string' },
        steps: { type: 'boolean', default: false },
        brains: { type: 'boolean', default: false },
      },
    }).values;
  } catch (e) {
    return usage(e instanceof Error ? e.message : String(e));
  }
}
// A flag's value as a whole number of at least min, or d when the flag is not given.
function whole(flag: string, v: string | undefined, d: number, min: number): number {
  if (v === undefined) return d;
  if (!/^\d+$/.test(v) || +v < min) usage(`--${flag} takes a whole number of at least ${min}, not "${v}"`);
  return +v;
}
const opts = flags();
const SEEDS = whole('seeds', opts.seeds, 40, 1),
  ONLY = opts.only,
  TRACE = opts.trace,
  WORKERS = whole('workers', opts.workers, 12, 1),
  SEED = whole('seed', opts.seed, 1, 0);
if (TRACE === '') usage('--trace takes the name of a scenario, or part of one');

const CHUNK = 4; // seeds a worker plays before it reports back
// A worker's job: scenario i, seeds from to to. What it sends back: the nights, each with its own failures.
interface Job {
  i: number;
  from: number;
  to: number;
}
interface Done {
  i: number;
  runs: Outcome[];
}

if (!isMainThread) {
  // A worker plays the scenarios it is handed and posts back the nights.
  const port = defined(parentPort, 'the parent port of a worker thread');
  port.on('message', ({ i, from, to }: Job) => {
    const sc = defined(scenarios[i], `scenario ${i}`), // jobs name scenarios by index
      runs = [];
    for (let seed = from; seed <= to; seed++) runs.push(play(sc, seed));
    port.postMessage({ i, runs } satisfies Done);
  });
} else if (TRACE !== undefined) {
  const sc = scenarios.find(s => s.name.includes(TRACE));
  if (!sc) {
    console.error('No scenario matches', TRACE);
    process.exit(2);
  }
  console.log(sc.name, 'seed', SEED);
  const { failures, ...out } = play(sc, SEED, { trace: opts.steps ? 2 : 1, brains: opts.brains });
  console.log(out);
  console.log(failures.join('\n'));
} else {
  // The scenarios to play, with the nights each has played so far. i: its place in scenarios, which jobs name it by.
  interface Todo {
    i: number;
    sc: Scenario;
    runs: Outcome[];
  }
  const todo = scenarios.flatMap((sc, i): Todo[] => (ONLY.split(',').some(part => sc.name.includes(part)) ? [{ i, sc, runs: [] }] : []));
  if (!todo.length) usage(`no scenario's name contains any of "${ONLY}"`);
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
        give();
      });
      w.on('error', e => {
        console.error(e);
        process.exit(2);
      });
      give();
    }
  });

  // What went wrong, as "<scenario>: <what>": in the building, in a night, or in how a scenario's nights add up.
  const failures = [...checkBuilding(), ...todo.flatMap(t => t.runs.flatMap(r => r.failures))];
  const fail = (name: string, what: string) => failures.push(`${name}: ${what}`);

  const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
  const sum = (runs: Outcome[], f: (r: Outcome) => number) => runs.reduce((s, r) => s + f(r), 0);
  const median = (list: number[]) => [...list].sort((a, b) => a - b)[list.length >> 1] ?? NaN; // NaN for none
  // A scenario's row of the table, each cell under its column's heading. The legend below explains the columns.
  const row = (sc: Scenario, runs: Outcome[]) => {
    const n = runs.length,
      mean = (f: (r: Outcome) => number) => sum(runs, f) / n,
      share = (f: (r: Outcome) => number, of: number) => pct(sum(runs, f), of),
      warn = runs.flatMap(r => r.warn),
      flats = sum(runs, r => r.flats),
      stood = sum(runs, r => r.stood);
    return {
      scenario: sc.name,
      'win%': share(r => +r.win, n),
      end: Math.round(mean(r => r.t)),
      'flat/g': (flats / n / sc.n).toFixed(2),
      peel: share(r => r.peels, flats),
      'B F S St %': MASCOTS.map(i => share(r => r.by[i], flats)).join(' '),
      'warn s': median(warn).toFixed(1),
      '<1.5s': `${pct(warn.filter(x => x < 1.5).length, warn.length)}%`,
      hunted: `${share(r => r.hunted, stood)}%`,
      calms: mean(r => r.calms).toFixed(1),
      torch: `${share(r => r.lit, stood)}%`,
      low: `${share(r => r.low, stood)}%`,
      dead: `${share(r => r.dead, stood)}%`,
      'dry/g': (mean(r => r.dry) / sc.n).toFixed(1),
      'dry>flat': `${share(
        r => r.dryFlat,
        sum(runs, r => r.dry)
      )}%`,
      'flat dark': `${share(r => r.darkFlat, flats)}%`,
      burnt: `${share(
        r => r.burnt,
        sum(runs, r => r.fixed + r.burnt)
      )}%`,
      power: Math.round(mean(r => r.power)),
      'out%': share(r => +(r.outs > 0), n),
      'crank s': Math.round(mean(r => r.cranked)),
      'door s': Math.round(mean(r => r.shut)),
      bangs: mean(r => r.bangs).toFixed(1),
      'dock s': Math.round(mean(r => r.charging)),
      'toys/g': (mean(r => r.toys) / sc.n).toFixed(1),
      lured: (
        sum(runs, r => r.lured) /
        Math.max(
          1,
          sum(runs, r => r.toys)
        )
      ).toFixed(2),
      hit: (
        sum(runs, r => r.hits) /
        Math.max(
          1,
          sum(runs, r => r.toys)
        )
      ).toFixed(2),
    };
  };
  const table = todo.map(({ sc, runs }) => ({ sc, runs, cells: row(sc, runs) }));
  const rate = new Map(table.map(({ sc, cells }) => [sc.name, cells['win%']])); // win% by scenario name
  for (const { sc, runs } of table) {
    if (sc.noMiss && sum(runs, r => r.burnt))
      fail(sc.name, `${sum(runs, r => r.burnt)} faults burnt with nothing in the way: they come faster than they can be walked to`);
    if (sc.night === 1 && !sc.worse && !sc.dev) {
      const early = Math.min(...runs.map(r => r.firstFlat));
      if (early < 30) fail(sc.name, `a guard was flattened ${early.toFixed(0)} s into night 1`);
    }
  }
  // A strategy that should not work has to win under one night in ten, or under half as often as playing properly.
  for (const { sc, cells } of table) {
    const won = cells['win%'],
      proper = sc.worse === undefined ? undefined : rate.get(sc.worse);
    if (proper !== undefined && won > Math.max(10, proper / 2)) fail(sc.name, `wins ${won}% of nights; playing properly wins ${proper}%`);
  }

  // The headings are the keys of a row, so a heading and its cell cannot drift apart.
  const rows = table.map(t => Object.values(t.cells)),
    head = Object.keys(defined(table[0], 'a scenario to play').cells);
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
B F S St share of flattenings by Biggs, Flan, Squish, Stompy
warn s  median seconds between a mascot being there to see or hear and it catching the guard; <1.5s is the share with less
hunted  share of standing time with something after you    calms   stretches of 20 s or more with nothing after anyone, per night
torch   share of standing time with the torch on           low, dead   share with it under a quarter, and flat; dry/g is how often it ran out per guard
dry>flat  share of torches running out that ended in a flattening within 20 s    flat dark  share of flattenings with the torch dead
burnt   share of faults left to burn    power   mean power at the end    out%    nights the power went out    crank s  seconds cranked    door s  seconds of shut door (two doors for ten seconds is 20)
bangs   bangs on shut doors    dock s  guard-seconds spent charging at the dock    toys/g  Mini Biggses thrown per guard per night
lured   mascots that went to look, per one thrown    hit     mascots stunned by a direct hit, per one thrown`);
  if (opts.deaths)
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
