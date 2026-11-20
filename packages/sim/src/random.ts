// A seeded random source for runs that have to come out the same every time: the balance harness
// (tools/balance/floor.ts), the tests, and through the harness the Roblox diff, whose Luau copy of this is
// Util.seeded in apps/roblox/src/shared/Util.luau. The game itself passes Math.random.
import type { Rng } from './types.ts';

// mulberry32, from a seed spread over 32 bits by Knuth's multiplier. Numbers in [0, 1), as Math.random gives.
export function seeded(seed: number): Rng {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
