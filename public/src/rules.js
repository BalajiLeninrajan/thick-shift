// Read-only questions about a game state. Host and guests both use these.
import { MASC, DOORKEY, DOORS, HOUR, ZONES, W } from './config.js';

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
// The feed tears below .6, its light starts cutting out below .4 and stays
// out below CAM_DARK.
//
// Both numbers below get worse through the night. `late` is hours since
// midnight, with each later night counting as two hours further on.
//   camCap    the best the signal can be. From 4 AM a feed is already tearing
//             the moment you open it.
//   camLife   seconds of watching before the light goes out for good:
//             a minute at midnight, 10 seconds at 4 AM, 6 at the end.
const CAM_DARK = .15;
const late = S => Math.min(6, decay(S));
export const camCap = S => { const h = late(S); return h < 2 ? 1 : h < 4 ? 1 - (h - 2) * .2 : .6 - (h - 4) * .05; };
const camLife = S => { const h = late(S); return h < 4 ? 60 - h * 12.5 : 10 - (h - 4) * 2; };
// Signal lost per second of watching.
export const camDrain = S => (camCap(S) - CAM_DARK) / camLife(S);
export const CAM_RECOVER = 1.5;   // back to full in under a second off the cameras

/* ---------- sanity and the lights ---------- */
// Each guard has a sanity level, 1 down to 0, kept by the host in the player
// record (see updateSanity in sim.js). It falls in the dark, while looking at
// a rotten mascot, and while something stands at an open door. It comes back
// in the booth with the lights on and nothing at the doors.
//
// Low sanity does two things. Shutting a door can fail, because your hands
// will not do it: doorFailChance. And you start hearing and seeing things
// that are not there (audio.js, cams.js).
export const me = (S, id) => S.players.find(p => p.id === id);
export const sanityOf = (S, id) => me(S, id)?.sanity ?? 1;
// Chance that pressing "shut" does nothing. 0 at full sanity, about a quarter
// at half, 70% at zero. Opening a door never fails.
export const doorFailChance = sanity => .7 * (1 - sanity) ** 1.5;
// The booth lights are on unless someone switched them off or the power is out.
export const lightsOn = S => S.power > 0 && S.lights !== false;

/* ---------- what the booth lets you know ---------- */
// A creak says something has reached one of your doors, but not which one.
// It then hangs back in the dark, unseen, until REVEAL of its wait has gone; then it steps into
// the doorway. You only see it, and only feel it, if that doorway is on your
// screen. So the booth alone gives you the last 40% of the wait to react, and
// only for the door you happen to be looking at. The cameras are how you find
// out earlier which door to watch.
export const REVEAL = .6;
export const shownAtDoor = (S, k) => atDoor(S, k).filter(m => leanOf(S, m) >= REVEAL);
const onScreen = (k, pan) => ZONES[k].x + ZONES[k].w > pan && ZONES[k].x < pan + W;
// threatOf, but only for what this guard can see from where they are panned.
export const seenThreat = (S, pan) => Math.max(0, ...DOORS.flatMap(k => S.doors[k] || !onScreen(k, pan) ? [] : shownAtDoor(S, k).map(m => .35 + leanOf(S, m) * .65)));

/* ---------- breakers, the handle, and a crowd ---------- */
// The three ways in are held shut by motors on one old breaker. A motor that
// is holding gets hot (S.heat, 0 to 1) and cools once the door is open. One
// door alone can hold for DOOR_HEAT.hold seconds from cold. Each other door
// shut at the same time adds DOOR_HEAT.share of that rate to all of them, and
// a mascot hitting a shut door adds DOOR_HEAT.bang in one go. At 1 the breaker
// trips: the door drops open and will not shut again until it has cooled to
// DOOR_HEAT.reset.
//   doors shut together:     1      2      3
//   seconds from cold:       25     16.7   12.5
//   locked open after:       20 s
// This is what stops a crew from shutting everything and waiting for 6 AM.
// Shutting a door on what is behind it costs a few seconds of heat. Holding
// one shut costs all of it.
export const DOOR_HEAT = { hold: 25, share: .5, cool: 40, bang: .15, reset: .5 };
// Heat gained per second by each shut door, given how many are shut.
export const heatRate = closed => (1 + DOOR_HEAT.share * (closed - 1)) / DOOR_HEAT.hold;
// Seconds until a tripped door works again. 0 when it has not tripped.
export const tripLeft = (S, k) => S.trip?.[k] ? Math.max(0, (S.heat[k] - DOOR_HEAT.reset) * DOOR_HEAT.cool) : 0;

// The generator has one handle and it runs hot too (S.gen, 0 to 1): GEN_HEAT.run
// seconds of turning from cold seizes it, and it cools four times slower than
// it heats, so nobody gets more than a fifth of the night out of it. A second
// guard at the generator adds nothing.
export const GEN_HEAT = { run: 15, cool: 60, reset: .5 };
// Seconds until a seized generator turns again. 0 when it is not seized.
export const genLeft = S => S.seized ? Math.max(0, (S.gen - GEN_HEAT.reset) * GEN_HEAT.cool) : 0;
// The guard holding the handle, and whether it is going round.
export const crankerOf = S => S.players.find(p => p.id === S.cranker);
export const turning = S => !!crankerOf(S) && !S.seized;

// More guards draw more visits. Every number below is the old fixed one for
// one guard, so playing alone is unchanged.
//   guards:              1    2    3    4    6
//   attacks per night:   7    10   13   16   22
//   quiet between them:  1x   .7x  .54x .44x .32x
//   pairs from night:    4    3    2    2    2
//   chance of a pair:    35%  47%  59%  71%  80%
// With three attacks per extra guard, each of a trio's two door guards sees
// about what one guard sees alone.
export const CROWD_MAX = 5;
export const crowdOf = S => Math.min(CROWD_MAX, Math.max(0, (S.players?.length || 1) - 1));
export const SOLO_ATTACKS = 7, CROWD_ATTACKS = 3;
export const maxAttacks = S => SOLO_ATTACKS + CROWD_ATTACKS * crowdOf(S);
export const pairFromNight = S => 4 - Math.min(2, crowdOf(S));
export const pairChance = S => Math.min(.8, .35 + .12 * crowdOf(S));
