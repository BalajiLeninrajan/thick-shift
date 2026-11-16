// Read-only questions about a game state. Host and guests both use these.
import { MASC, DOORKEY, DOORS, HOUR } from './config.js';

export const hourOf = S => Math.min(6, Math.floor(S.t / HOUR));
export const clock = S => (hourOf(S) || 12) + ' AM';

export const isActive = (S, m) => !!S.dev?.wake || (S.night - 1) * 6 + S.t / HOUR >= MASC[m.i].from;
export const roomOf = m => MASC[m.i].paths[m.side][m.pos];
export const inRoom = (S, room) => S.m.filter(m => isActive(S, m) && roomOf(m) === room);
// How long a mascot stands at a door before trying it, in seconds.
export const doorWait = night => Math.max(3, 8.5 - night * .8);
// 0 when a mascot has just reached a door, 1 when it is about to come through.
export const leanOf = (S, m) => Math.max(0, Math.min(1, 1 - m.wait / doorWait(S.night)));
export const atDoor = (S, k) => S.m.filter(m => isActive(S, m) && DOORKEY[roomOf(m)] === k);

// How much danger the booth is in right now, 0 to 1: something is at an open
// door, and the number climbs as it gets ready to come through.
export const threatOf = S => Math.max(0, ...DOORS.flatMap(k => S.doors[k] ? [] : atDoor(S, k).map(m => .35 + leanOf(S, m) * .65)));

// Mascots start the night as the costumes they were and come apart as it goes on.
// Slamming a door on one speeds it up. 0 = cute, 1 = off, 2 = what is underneath.
const decay = S => S.t / HOUR + (S.night - 1) * 2;
export const rotOf = (S, m) => { if (S.dev?.rot >= 0) return S.dev.rot; const r = decay(S) / 8 + (m.bangs || 0) * .25; return r < .34 ? 0 : r < .67 ? 1 : 2; };
// The same idea for the building: 0 is a dull night shift, 1 is not.
export const dreadOf = S => S.dev?.dread >= 0 ? S.dev.dread : Math.min(1, decay(S) / 7 + S.m.reduce((n, m) => n + (m.bangs || 0), 0) * .06);

// Camera feeds wear out while you watch them and come back when you look
// away. Each player has their own signal level, 1 down to 0 (client.signal).
// These are its rates per second. Early in the night a feed lasts about a
// minute; at full dread, about eleven seconds.
export const camDrain = S => 1 / 60 + (1 / 11 - 1 / 60) * dreadOf(S);
export const CAM_RECOVER = 1.5;   // back to full in under a second off the cameras
