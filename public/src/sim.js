// Host-side simulation. Only the host calls step() and act().
import { MASC, DOORKEY, DOORS, HOUR, FINAL_NIGHT } from './config.js';
import { game, rnd } from './state.js';
import { isActive, doorWait, leanOf, rotOf, inRoom, atDoor, shownAtDoor, lightsOn, doorFailChance, DOOR_HEAT, heatRate, GEN_HEAT, turning, SOLO_ATTACKS, maxAttacks, pairFromNight, pairChance } from './rules.js';

const OPEN = () => ({ L: false, V: false, R: false });
const COLD = () => ({ L: 0, V: 0, R: 0 });
// Door motors and the generator at the start of a night: see heatDoors and crankHandle.
const FRESH = () => ({ heat: COLD(), trip: OPEN(), gen: 0, seized: false, cranker: null });

export function newState(code) {
  return { phase: 'lobby', night: 1, t: 0, power: 100, doors: OPEN(), m: [], players: [], killer: -1, evs: [], evId: 0, calmUntil: 0, pair: false, attacks: 0, lights: true, deaths: 0, slams: 0, code, ...FRESH() };
}

// Events are how the host tells clients to play a sound or shake the screen.
// The list holds enough for a bad tenth of a second: a bang, a trip and three
// guards pressing a dead button all land in one broadcast.
function emit(type, x) {
  const S = game.S;
  S.evs.push({ id: ++S.evId, type, x });
  if (S.evs.length > 16) S.evs.shift();
}

export function startNight(n) {
  const S = game.S;
  Object.assign(S, { phase: 'play', night: n, t: 0, power: 100, doors: OPEN(), killer: -1, calmUntil: rnd(15, 30), pair: false, attacks: 0, lights: true, ...FRESH() });
  S.m = MASC.map((d, i) => ({ i, pos: 0, side: 0, timer: rnd(6, 12), wait: 0, bangs: 0 }));
  for (const id in game.players) Object.assign(game.players[id], { view: 'office', cam: 0, sanity: sanityCap(n) });
}

// Begin again from night 1 with the run's tallies cleared.
export function restart() {
  Object.assign(game.S, { deaths: 0, slams: 0 });
  startNight(1);
}

const LOW_HALF = 50, LAST_SLIVER = 2;   // percent
const DRAIN = { base: .07, lights: .12, door: .2, cams: .07 };
// The building's wiring gets worse too: everything draws POWER_WEAR_MIN times
// this on night 1, rising to POWER_WEAR_MAX on night 5.
//
// Tuned against scripted guards played through this file (tools/balance/run.mjs,
// run it after changing anything here): one that never checks cameras and
// shuts each door at the last safe moment ends night 5 near 13% without
// cranking. Anyone less exact has to crank.
//
// For a group the target is the same night: two guards on the doors and one
// working the handle between attacks end it near 60%, which is about one
// guard's worth of camera time. A group that seals the booth is dead before
// 2 AM on any night (see heatDoors, crankHandle and the crowd rule in rules.js).
const powerWear = night => Math.min(POWER_WEAR_MAX, POWER_WEAR_MIN + (night - 1) * (POWER_WEAR_MAX - POWER_WEAR_MIN) / 4);
const POWER_WEAR_MIN = 1, POWER_WEAR_MAX = 1.4;
const CRANK = 1.4;

function drainPower(S, dt) {
  const closed = DOORS.filter(k => S.doors[k]).length;
  const count = v => S.players.filter(p => p.view === v).length;
  const was = S.power;
  // The second half of the battery goes faster than the first, and the last
  // sliver hangs on far longer than it should, so running out is drawn out.
  const stage = S.power > LOW_HALF ? 1 : S.power > LAST_SLIVER ? 1.6 : .2;
  // Percent per second. The lights cost more than half of what a shut door does.
  const drain = (DRAIN.base + (S.lights ? DRAIN.lights : 0) + DRAIN.door * closed + DRAIN.cams * count('cams')) * stage * powerWear(S.night);
  const cranked = crankHandle(S, dt);
  S.power = Math.max(0, Math.min(100, S.power - drain * dt + cranked * dt));
  if (S.dev?.power) S.power = 100;
  if (S.power <= 0) {
    if (was > 0) emit('out');
    S.doors = OPEN();
  }
}

// One handle. The first guard to reach the generator holds it until they
// leave, and anyone else there is only watching. Turning it heats it: see
// GEN_HEAT in rules.js. Returns the percent per second going into the battery.
//
// Cranking is hand work, and shaking hands are bad at it: a guard at full
// sanity returns CRANK percent a second, one at 40% or less returns 40% of that.
function crankHandle(S, dt) {
  const at = S.players.filter(p => p.view === 'crank');
  if (!at.some(p => p.id === S.cranker)) S.cranker = at[0]?.id ?? null;
  const hand = at.find(p => p.id === S.cranker), turns = !!hand && !S.seized;
  const hot = turns && !S.dev?.cold;   // S.dev.cold: nothing overheats (dev.js)
  S.gen = Math.max(0, Math.min(1, S.gen + (hot ? dt / GEN_HEAT.run : -dt / GEN_HEAT.cool)));
  if (S.gen >= 1 && !S.seized) { S.seized = true; emit('seize'); }
  else if (S.seized && S.gen <= GEN_HEAT.reset) { S.seized = false; emit('unseize'); }
  return turns ? CRANK * Math.max(.4, hand.sanity ?? 1) : 0;
}

// Door motors heat while they hold and cool while the door is open: see
// DOOR_HEAT in rules.js. A tripped door drops open whatever is behind it.
// This runs after drainPower, so a power cut, which opens every door, cools them.
function heatDoors(S, dt) {
  const closed = DOORS.filter(k => S.doors[k]).length;
  for (const k of DOORS) {
    const holding = S.doors[k] && !S.dev?.cold;
    S.heat[k] = holding ? S.heat[k] + heatRate(closed) * dt : Math.max(0, S.heat[k] - dt / DOOR_HEAT.cool);
    if (holding && S.heat[k] >= 1) { S.heat[k] = 1; S.doors[k] = false; S.trip[k] = true; emit('trip', k); }
    else if (S.trip[k] && S.heat[k] <= DOOR_HEAT.reset) { S.trip[k] = false; emit('reset', k); }
  }
}

/* ---------- sanity ---------- */
// Per second, for one guard. See the notes above sanityOf in rules.js.
// Watching the cameras costs very little: they are how you play, and the feed
// already punishes staring. The real drains are the dark and an open door.
const SANITY = { dark: -.012, powerOut: -.03, camsBase: 0, seenOff: -.002, seenRotten: -.004, atDoor: -.02, atDoorRotten: -.04, rest: .02 };

function sanityRate(S, p) {
  const worst = list => Math.max(-1, ...list.map(m => rotOf(S, m)));
  let rate = 0;
  if (S.power <= 0) rate += SANITY.powerOut; else if (!S.lights) rate += SANITY.dark;
  if (p.view === 'cams') {
    const rot = worst(inRoom(S, p.cam || 0));
    rate += SANITY.camsBase + (rot === 2 ? SANITY.seenRotten : rot === 1 ? SANITY.seenOff : 0);
  }
  if (p.view === 'office') {
    // Only once it has stepped into the doorway. Before that you do not know it is there,
    // and a falling sanity bar would tell you.
    const rot = worst(DOORS.flatMap(k => S.doors[k] ? [] : shownAtDoor(S, k)));
    if (rot >= 0) rate += rot === 2 ? SANITY.atDoorRotten : SANITY.atDoor;
  }
  // Nothing wrong, lights on, sitting in the booth: you get it back.
  if (rate === 0 && p.view === 'office' && lightsOn(S)) return SANITY.rest / wear(S.night);
  return rate * wear(S.night);
}

// Each night on the job costs you, and so does each hour of it. By night n
// you lose sanity `wear` times faster and get it back that much slower. You
// can never get above sanityCap, which starts lower each night and sinks as
// the night goes on, faster on later nights.
//   night:               1     2     3     4     5
//   wear:                1x    1.3x  1.6x  1.9x  2.2x
//   cap at midnight:     100%  92%   84%   76%   68%
//   cap at 6 AM:         92%   76%   61%   45%   29%
// The target is a guard who makes a couple of mistakes ending night 5 with
// sanity just into the red (under 25%), and a careful one just above it.
const wear = night => Math.min(2.5, 1 + (night - 1) * .3);
export const sanityCap = (night, t = 0) => Math.max(.2, 1 - (night - 1) * .08 - t / HOUR * CAP_SLIDE * night);
const CAP_SLIDE = .013;

function updateSanity(S, dt) {
  const cap = sanityCap(S.night, S.t);
  for (const p of S.players) p.sanity = Math.max(0, Math.min(cap, (p.sanity ?? cap) + sanityRate(S, p) * dt));
}

/* ---------- pacing ---------- */
// Attacks come one at a time with long gaps, because the waiting is the scary
// part. Later nights are harder through shorter door timers, the occasional
// pair of mascots at two doors, and everything else that degrades. They are not
// harder through more frequent attacks: no night has more than maxAttacks(S),
// seven for one guard, and it is the guard who gets weaker (see sanity above).
//
// A crowd is the exception. Each extra guard adds visits, shortens the lulls
// to fit them in, and brings pairs earlier and more often (crowdOf and the
// table under it in rules.js), so that every guard on the doors has about one
// guard's work to do.
//
// S.calmUntil is the night time before which nothing may arrive at a door.
// A mascot that wants to arrive during a lull waits one room away instead.

// How long the building stays quiet after an attack is turned away, in seconds,
// for one guard. Usually 20 to 45, shrinking a little each night. Sometimes
// much longer, and on later nights occasionally almost no gap at all, so it
// cannot be timed.
function lull(night) {
  night = Math.min(night, 4);   // the gaps stop shrinking after night 4
  const base = rnd(Math.max(16, 24 - night), Math.max(34, 48 - night * 2));
  const roll = Math.random();
  if (roll < .18) return base * 2;                                     // a silence long enough to doubt
  if (roll > 1 - Math.min(.12, (night - 1) * .03)) return rnd(3, 7);    // straight back at you
  return base;
}
// From night 4 (pairFromNight, earlier for a crowd), some attacks are two
// mascots at two doors. S.pair is rolled once per lull with pairChance, so for
// one guard most attacks are still one at a time.
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
    if (!S.doors[k] && !S.dev?.god) { S.phase = 'dead'; S.killer = m.i; S.killDoor = k; S.deaths++; emit('scare'); return false; }
    emit('bang', k);
    if (S.doors[k] && !S.dev?.cold) S.heat[k] = Math.min(1, S.heat[k] + DOOR_HEAT.bang);   // the motor takes the hit
    S.slams++;
    m.bangs++;   // being shut out makes it worse (see rotOf)
    m.pos = 0;   // all the way back, so the next approach takes time
    m.timer = rnd(10, 20);
    // Spread whatever is left of the night's attacks over the time remaining,
    // so the limit is never used up early and the last hours are never safe.
    const left = maxAttacks(S) - S.attacks;
    S.calmUntil = left <= 0 ? 1e9 : S.t + Math.max(lull(S.night) * SOLO_ATTACKS / maxAttacks(S), (6 * HOUR - S.t) / (left + 1) * .5);
    S.pair = S.night >= pairFromNight(S) && Math.random() < pairChance(S);
    return true;
  }
  m.timer -= dt;
  if (m.timer > 0) return true;
  m.timer = rnd(4, 9);
  const guards = S.players.length || 1;
  const cranking = turning(S);   // they hear the handle going round. A seized generator is quiet.
  const chance = Math.min(.75, (.3 + .03 * S.night + .02 * hour) * d.ag * (1 + .15 * (guards - 1)) * (cranking ? 1.25 : 1));
  if (Math.random() >= chance) return true;
  if (m.pos + 1 === last && (S.t < S.calmUntil || S.attacks >= maxAttacks(S) || atDoors(S) >= maxAtDoors(S))) { m.timer = rnd(2, 4); return true; }   // not yet
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
  // 'win' ends a night. 'won' ends the game, after the last one.
  if (hour >= 6) { S.phase = S.night >= FINAL_NIGHT ? 'won' : 'win'; emit('win'); return; }
  drainPower(S, dt);
  heatDoors(S, dt);
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
    // A tripped breaker comes first. It is hardware, not nerves: nothing shuts
    // that door until it resets, and the guard who pressed is told why.
    if (!S.doors[a.k] && S.trip[a.k]) { emit('dead', { k: a.k, by: p?.id }); return; }
    // With your nerves gone, shutting a door does not always work. Opening one
    // always does, and so does shutting one in the last moment before whatever
    // is behind it comes through: a death should be your mistake, not a dice roll.
    const lastMoment = atDoor(S, a.k).some(m => leanOf(S, m) >= LAST_MOMENT);
    if (!S.doors[a.k] && !lastMoment && p && Math.random() < doorFailChance(p.sanity ?? 1)) { emit('fumble', { k: a.k, by: p.id }); return; }
    S.doors[a.k] = !S.doors[a.k];
    emit('door', S.doors[a.k]);
  }
}
