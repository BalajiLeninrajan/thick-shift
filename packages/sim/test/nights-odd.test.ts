// Nights that should go badly, and the frozen building, on fixed seeds, against snapshots (see nights-solo.test.ts).
// They reach the doors, the lockers, the dock and the dev cheats more than an honest night does.
import { describe, expect, it } from 'vitest';
import { failures, play, scenarios } from '../../../tools/balance/harness.ts';
import { defined } from '../src/check.ts';
import { playNight } from './nights.ts';

const NIGHTS: [scenario: string, seed: number][] = [
  ['empty building x2 n1', 1],
  ['x4 turtle: doors shut, nobody moves n3', 1],
  ['x4 turtle, toys at the doors n1', 2],
  ['x1 sit in a locker all night n1', 2],
  ['x4 camp the charger n3', 1],
  ['x4 sit in the ducts n1', 3],
];

describe('odd nights', () => {
  for (const [scenario, seed] of NIGHTS)
    it(`${scenario}, seed ${seed}`, () => {
      expect(playNight(scenario, seed)).toMatchSnapshot();
    });

  it('fixes every fault in time when nothing moves', () => {
    const night = playNight('empty building x2 n1', 1);
    expect(night.outcome).toBe('win');
    expect(night.burnt).toBe(0);
    expect(night.flats).toBe(0);
    expect(night.fixed).toBeGreaterThan(0);
  });
});

describe('the harness', () => {
  it('fails the night, rather than throwing, when a guard who is not playing is flattened', () => {
    const sc = defined(
      scenarios.find(s => s.name === 'empty building x2 n1'),
      'the empty building'
    );
    failures.length = 0;
    let sent = false;
    const out = play(sc, 1, {
      onStep: S => {
        if (sent) return;
        sent = true;
        S.evs.push({ id: ++S.evId, type: 'flat', x: { id: 'nobody', by: 0, x: 0, z: 0 } });
      },
    });
    expect(out.flats).toBe(0);
    expect(failures).toEqual(['empty building x2 n1: seed 1: nobody, who is not playing, was flattened']);
    failures.length = 0;
  });
});
