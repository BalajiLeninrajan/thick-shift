// Seeded nights for the snapshot tests: one scenario of the balance harness (tools/balance/harness.ts) played on one
// seed, with the harness's fake clock and its scripted guards, boiled down to a summary small enough to read in a
// snapshot diff. The digests change with any change to what happened in the night; the rest says roughly how.
import { createHash } from 'node:crypto';
import { play, scenarios } from '../../../tools/balance/harness.ts';
import { defined } from '../src/check.ts';
import type { NightState, SimEvent } from '../src/types.ts';

export interface NightSummary {
  outcome: NightState['phase'];
  ticks: number; // steps the night took, a tenth of a second each
  t: string; // S.t at the end
  power: string;
  flats: number;
  peels: number;
  fixed: number;
  burnt: number;
  events: string; // how many of each type, by type
  eventsDigest: string; // every event in order, with what it carried
  stateDigest: string; // the whole of S at the end
  failures: string[]; // the harness's softlock checks
}

// The first 16 hex digits of the SHA-256 of a value's JSON.
export const digest = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

// Every event in S.evs not seen yet. S.evs keeps the last ten, so call it after every step.
export function eventsSince(S: NightState, seen: number, into: SimEvent[]): number {
  for (const e of S.evs)
    if (e.id > seen) {
      into.push(e);
      seen = e.id;
    }
  return seen;
}

// How many events of each type, as "type n" in alphabetical order.
export const countEvents = (events: SimEvent[]): string => {
  const n = new Map<string, number>();
  for (const e of events) n.set(e.type, (n.get(e.type) ?? 0) + 1);
  return [...n]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, k]) => `${type} ${k}`)
    .join(', ');
};

export const scenario = (name: string) =>
  defined(
    scenarios.find(s => s.name === name),
    `the harness scenario ${name}`
  );

export function playNight(name: string, seed: number): NightSummary {
  const sc = scenario(name);
  const events: SimEvent[] = [];
  let seen = 0,
    ticks = 0,
    last: NightState | null = null;
  const out = play(sc, seed, {
    onStep: S => {
      ticks++;
      seen = eventsSince(S, seen, events);
      last = S;
    },
  });
  const S = defined(last as NightState | null, `a step of ${name}`);
  return {
    outcome: S.phase,
    ticks,
    t: S.t.toFixed(3),
    power: S.power.toFixed(3),
    flats: out.flats,
    peels: out.peels,
    fixed: out.fixed,
    burnt: out.burnt,
    events: countEvents(events),
    eventsDigest: digest(events),
    stateDigest: digest(S),
    failures: out.failures,
  };
}
