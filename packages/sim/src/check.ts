// Checks that tell the type checker what the code knows, at the few places where the types alone cannot: a value
// that is there by the game's rules but not by its type (an index read, a lookup, a field a placed guard has).
// Each throws a plain Error naming what was missing, so a broken rule fails where it broke instead of passing
// undefined along. They cost a comparison when the value is there, which it always is unless something is wrong.
import { MASC } from './config.ts';
import type { Guard, MascotIndex, NightState, NonEmpty, Player, State } from './types.ts';

// Narrows on cond, as `if (!cond) throw` would. message says what should have held.
export function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

// value, or a thrown Error when it is null or undefined. what names it for the message: defined(BOXES[i], `box ${i}`).
export function defined<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`${what} is missing`);
  return value;
}

// The list has at least one entry, so [0] reads it.
export const isNonEmpty = <T>(list: readonly T[]): list is NonEmpty<T> => list.length > 0;

// For a number that comes from outside the sim's own tables (a data-* attribute, a message): is it one of MASC?
export const isMascotIndex = (n: number): n is MascotIndex => Number.isInteger(n) && n >= 0 && n < MASC.length;

// A guard who joined after the night began has only an id and a name until the next step places them (stepFloor),
// and placing sets every Guard field at once, so a guard with an x has them all.
export const isPlaced = (p: Player): p is Guard => p.x != null;

// A night has begun on S. startFloorNight sets every NightState field at once, the faults among them, and nothing
// clears them, so a state with faults has the rest.
export const isNight = (S: State): S is NightState => S.faults !== undefined;
