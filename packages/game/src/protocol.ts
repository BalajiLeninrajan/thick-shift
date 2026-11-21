// What a page (net.ts) and a room (worker/room.ts) have to agree on, beside the messages themselves
// (@thick-shift/sim/types). No DOM and no Workers globals, since both sides import it.
import type { CloseCode } from '@thick-shift/sim/types';

export const TICK_MS = 100; // a night's step, in a room or solo
// A page from a build that speaks another protocol is told to reload.
export const PROTOCOL = 2;
// Why a room turns a socket away.
export const CLOSE = { BAD: 1008, NO_ROOM: 4404, CODE_TAKEN: 4409, OUTDATED: 4426 } satisfies Record<string, CloseCode>;

// How a page comes into a room (?mode=): make a new one under a code nobody is using, join one that has a night, or
// either, for a room an app fixes (everyone in a Discord channel opens the same one) and for a guard coming back after
// losing their connection.
export type Mode = 'make' | 'join' | 'either';

export const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
