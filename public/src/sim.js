// Host-side simulation. Only the host calls step() and act().
import { MASC, DOORKEY, DOORS, HOUR } from './config.js';
import { game, rnd } from './state.js';
import { isActive, doorWait, leanOf, rotOf, inRoom, atDoor, lightsOn, doorFailChance } from './rules.js';

const OPEN = () => ({ L: false, V: false, R: false });

export function newState(code) {
  return { phase: 'lobby', night: 1, t: 0, power: 100, doors: OPEN(), m: [], players: [], killer: -1, evs: [], evId: 0, calmUntil: 0, pair: false, attacks: 0, lights: true, code };
}

// Events are how the host tells clients to play a sound or shake the screen.
function emit(type, x) {
  const S = game.S;
  S.evs.push({ id: ++S.evId, type, x });
  if (S.evs.length > 8) S.evs.shift();
}

export function startNight(n) {
  const S = game.S;
  Object.assign(S, { phase: 'play', night: n, t: 0, power: 100, doors: OPEN(), killer: -1, calmUntil: rnd(15, 30), pair: false, attacks: 0, lights: true });
  S.m = MASC.map((d, i) => ({ i, pos: 0, side: 0, timer: rnd(6, 12), wait: 0, bangs: 0 }));
  for (const id in game.players) Object.assign(game.players[id], { view: 'office', cam: 0, sanity: sanityCap(n) });
}

const LOW_HALF = 50, LAST_SLIVER = 2;   // percent

function drainPower(S, dt) {
  const closed = DOORS.filter(k => S.doors[k]).length;
  const count = v => S.players.filter(p => p.view === v).length;
  const was = S.power;
  // The second half of the battery goes faster than the first, and the last
  // sliver hangs on far longer than it should, so running out is drawn out.
  const stage = S.power > LOW_HALF ? 1 : S.power > LAST_SLIVER ? 1.6 : .2;
  // Leaving the booth lights on costs about as much as holding a third of a door shut.
  const drain = (.07 + (S.lights ? .06 : 0) + .2 * closed + .07 * count('cams')) * stage;
  S.power = Math.max(0, Math.min(100, S.power - drain * dt + .5 * count('crank') * dt));
  if (S.dev?.power) S.power = 100;
  if (S.power <= 0) {
    if (was > 0) emit('out');
    S.doors = OPEN();
  }
}

/* ---------- sanity ---------- */
// Per second, for one guard. See the notes above sanityOf in rules.js.
const SANITY = { dark: -.012, powerOut: -.03, camsBase: -.004, seenOff: -.01, seenRotten: -.03, atDoor: -.02, atDoorRotten: -.04, rest: .02 };

function sanityRate(S, p) {
  const worst = list => Math.max(-1, ...list.map(m => rotOf(S, m)));
  let rate = 0;
  if (S.power <= 0) rate += SANITY.powerOut; else if (!S.lights) rate += SANITY.dark;
  if (p.view === 'cams') {
    const rot = worst(inRoom(S, p.cam || 0));
    rate += SANITY.camsBase + (rot === 2 ? SANITY.seenRotten : rot === 1 ? SANITY.seenOff : 0);
  }
  if (p.view === 'office') {
    const rot = worst(DOORS.flatMap(k => S.doors[k] ? [] : atDoor(S, k)));
    if (rot >= 0) rate += rot === 2 ? SANITY.atDoorRotten : SANITY.atDoor;
  }
  // Nothing wrong, lights on, sitting in the booth: you get it back.
  if (rate === 0 && p.view === 'office' && lightsOn(S)) return SANITY.rest / wear(S.night);
  return rate * wear(S.night);
}

// Each night on the job costs you. By night n you lose sanity `wear` times
// faster, get it back that much slower, and can never get above sanityCap.
//   night:      1     2     3     4     5     6
//   wear:       1x    1.3x  1.6x  1.9x  2.2x  2.5x
//   sanityCap:  100%  92%   84%   76%   68%   60%
const wear = night => Math.min(2.5, 1 + (night - 1) * .3);
export const sanityCap = night => Math.max(.6, 1 - (night - 1) * .08);

function updateSanity(S, dt) {
  const cap = sanityCap(S.night);
  for (const p of S.players) p.sanity = Math.max(0, Math.min(cap, (p.sanity ?? cap) + sanityRate(S, p) * dt));
}

/* ---------- pacing ---------- */
// Attacks come one at a time with long gaps, because the waiting is the scary
// part. Later nights are harder through shorter door timers, the occasional
// pair of mascots at two doors, and everything else that degrades. They are not
// harder through more frequent attacks: no night has more than MAX_ATTACKS,
// and it is the guard who gets weaker (see sanity above).
//
// S.calmUntil is the night time before which nothing may arrive at a door.
// A mascot that wants to arrive during a lull waits one room away instead.

// How long the building stays quiet after an attack is turned away, in seconds.
// Usually LULL, shrinking a little each night. Sometimes much longer, and on
// later nights occasionally almost no gap at all, so it cannot be timed.
const MAX_ATTACKS = 7;

function lull(night) {
  night = Math.min(night, 4);   // the gaps stop shrinking after night 4
  const base = rnd(Math.max(16, 24 - night), Math.max(34, 48 - night * 2));
  const roll = Math.random();
  if (roll < .18) return base * 2;                                     // a silence long enough to doubt
  if (roll > 1 - Math.min(.12, (night - 1) * .03)) return rnd(3, 7);    // straight back at you
  return base;
}
// From night 4, some attacks are two mascots at two doors. S.pair is rolled
// once per lull, so most attacks are still one at a time.
const PAIR_FROM_NIGHT = 4, PAIR_CHANCE = .35;
const maxAtDoors = S => S.pair ? 2 : 1;
const atDoors = S => S.m.filter(m => isActive(S, m) && m.pos === MASC[m.i].paths[m.side].length - 1).length;

// Returns false when the mascot got in and the night is over.
function moveMascot(S, m, dt, hour) {
  const d = MASC[m.i], path = d.paths[m.side], last = path.length - 1;
  if (m.pos === last) {
    m.wait -= dt;
    if (m.wait > 0) return true;
    const k = DOORKEY[path[m.pos]];
    // In god mode an open door turns it away like a shut one.
    if (!S.doors[k] && !S.dev?.god) { S.phase = 'dead'; S.killer = m.i; emit('scare'); return false; }
    emit('bang', k);
    m.bangs++;   // being shut out makes it worse (see rotOf)
    m.pos = 0;   // all the way back, so the next approach takes time
    m.timer = rnd(10, 20);
    // Spread whatever is left of the night's attacks over the time remaining,
    // so the limit is never used up early and the last hours are never safe.
    const left = MAX_ATTACKS - S.attacks;
    S.calmUntil = left <= 0 ? 1e9 : S.t + Math.max(lull(S.night), (6 * HOUR - S.t) / (left + 1) * .5);
    S.pair = S.night >= PAIR_FROM_NIGHT && Math.random() < PAIR_CHANCE;
    return true;
  }
  m.timer -= dt;
  if (m.timer > 0) return true;
  m.timer = rnd(4, 9);
  const guards = S.players.length || 1;
  const cranking = S.players.some(p => p.view === 'crank');
  const chance = Math.min(.75, (.3 + .03 * S.night + .02 * hour) * d.ag * (1 + .15 * (guards - 1)) * (cranking ? 1.25 : 1));
  if (Math.random() >= chance) return true;
  if (m.pos + 1 === last && (S.t < S.calmUntil || S.attacks >= MAX_ATTACKS || atDoors(S) >= maxAtDoors(S))) { m.timer = rnd(2, 4); return true; }   // not yet
  if (m.pos === 0 && d.paths.length > 1) m.side = Math.random() < .5 ? 0 : 1;
  m.pos++;
  if (m.pos === d.paths[m.side].length - 1) { m.wait = doorWait(S.night); S.attacks++; emit('arrive'); }
  else emit('step');
  return true;
}

let lastStep = performance.now();
export function step() {
  const S = game.S, now = performance.now();
  const dt = Math.min(1.5, (now - lastStep) / 1000) * (S.dev?.speed || 1);   // S.dev: cheats from the dev menu (dev.js)
  lastStep = now;
  S.players = Object.values(game.players);
  if (S.phase !== 'play') return;
  const hourBefore = Math.floor(S.t / HOUR);
  S.t += dt;
  const hour = Math.floor(S.t / HOUR);
  if (hour > hourBefore) emit('hour');
  if (hour >= 6) { S.phase = 'win'; emit('win'); return; }
  drainPower(S, dt);
  updateSanity(S, dt);
  if (S.dev?.freeze) return;
  for (const m of S.m) if (isActive(S, m) && !moveMascot(S, m, dt, hour)) return;
}

// Apply one player's action. Guests send these to the host over the wire.
// The final quarter of a mascot's wait at a door (see leanOf).
const LAST_MOMENT = .75;

export function act(pid, a) {
  const S = game.S, p = game.players[pid];
  if (a.t === 'view') { if (p) { p.view = a.v; p.cam = a.cam | 0; } return; }
  if (a.t === 'lights' && S.phase === 'play' && S.power > 0) { S.lights = !S.lights; emit('lights', S.lights); return; }
  if (a.t === 'name') { if (p) p.name = String(a.n || 'Guard').slice(0, 12); return; }
  if (a.t === 'door' && S.phase === 'play' && S.power > 0 && DOORS.includes(a.k)) {
    // With your nerves gone, shutting a door does not always work. Opening one
    // always does, and so does shutting one in the last moment before whatever
    // is behind it comes through: a death should be your mistake, not a dice roll.
    const lastMoment = atDoor(S, a.k).some(m => leanOf(S, m) >= LAST_MOMENT);
    if (!S.doors[a.k] && !lastMoment && p && Math.random() < doorFailChance(p.sanity ?? 1)) { emit('fumble', { k: a.k, by: p.id }); return; }
    S.doors[a.k] = !S.doors[a.k];
    emit('door', S.doors[a.k]);
  }
}
