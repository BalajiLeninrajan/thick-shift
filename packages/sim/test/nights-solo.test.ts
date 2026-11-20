// Whole nights with one guard, on fixed seeds, against snapshots. A change to the sim that changes how any of these
// nights goes fails here; if the change is meant, `pnpm test -u` rewrites the snapshots and the diff shows what moved.
import { describe, expect, it } from 'vitest';
import { playNight } from './nights.ts';

const NIGHTS: [scenario: string, seed: number][] = [
  ['solo competent n1', 1],
  ['solo competent n3', 2],
  ['solo competent n5', 3],
  ['solo careless n3', 1],
  ['solo expert n5', 2],
  ['solo competent, hides n3', 5],
];

describe('solo nights', () => {
  for (const [scenario, seed] of NIGHTS)
    it(`${scenario}, seed ${seed}`, () => {
      const night = playNight(scenario, seed);
      expect(night.failures).toEqual([]);
      expect(night).toMatchSnapshot();
    });

  it('plays the same night the same way twice, and a different seed differently', () => {
    const a = playNight('solo expert n5', 2),
      b = playNight('solo expert n5', 2),
      c = playNight('solo expert n5', 3);
    expect(b).toEqual(a);
    expect(c.eventsDigest).not.toBe(a.eventsDigest);
  });
});
