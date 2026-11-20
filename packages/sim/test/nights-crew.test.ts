// Whole nights with crews, on fixed seeds, against snapshots (see nights-solo.test.ts). Crews exercise what a guard
// alone never does: peeling a flat teammate up, sharing the faults, one guard cranking while the rest work.
import { describe, expect, it } from 'vitest';
import { playNight } from './nights.ts';

const NIGHTS: [scenario: string, seed: number][] = [
  ['crew of 2 competent n2', 1],
  ['crew of 3 competent n4', 1],
  ['crew of 4 competent n5', 2],
  ['crew of 4 careless n1', 1],
  ['crew of 6 competent n1', 3],
];

describe('crew nights', () => {
  for (const [scenario, seed] of NIGHTS)
    it(`${scenario}, seed ${seed}`, () => {
      const night = playNight(scenario, seed);
      expect(night.failures).toEqual([]);
      expect(night).toMatchSnapshot();
    });
});
