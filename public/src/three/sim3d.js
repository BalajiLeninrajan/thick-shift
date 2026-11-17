// Host-side simulation of the 3D mode ("the floor"). Only the host calls
// stepFloor() and actFloor(). The booth game's rules are in ../sim.js; this
// file shares its state object S, its events and its phases, and nothing else.
//
// The night in one paragraph: every hour some of the watchman's clocks around
// the building come due, and a guard has to walk to each and punch it. A missed
// clock costs power, and when the power goes the doors open, the lights go out
// and every mascot comes for whoever is left. The mascots walk the same rooms,
// in waves: they stir, then go back to where they stand. A torch beam holds one
// still, less so the more it has rotted, and the torch runs down. Touch a
// mascot and you are flattened, and stay on the floor until another guard
// peels you up. Everyone flat at once ends the night.
//
// The numbers here were tuned against scripted guards in tools/balance/floor.mjs
// (`node tools/balance/floor.mjs`), which plays every night with careless,
// competent and expert guards alone and in groups, and with the strategies that
// should not work. What each number was tuned against is noted beside it.
import { MASC, FINAL_NIGHT, DOORS } from '../config.js';
import { game, rnd } from '../state.js';
import { CLOCKS, GENERATOR, CHARGER, PANELS, BATTERY_SPOTS, REST, BOOTH, DUCTS, MASCOT_R, PLAYER_R, DOORWAYS, ROOMS3, walkable, slide, clear, sees, reaches, roomAt, roomCentre, route, spawnPoint } from './map.js';

// Tuning. Clients read some of these to draw bars and prompts.
export const F = {
  HOUR: 70,            // seconds per in-game hour: a night is seven minutes
  WALK: 3, SPRINT: 5.2,
  BAT_LIFE: 80,        // seconds of light in a full torch
  BAT_PICKUP: .5,      // what a spare battery adds
  CHARGE: 1 / 20,      // torch charge per second at the booth dock
  REACH: 2.2,          // how close you must be to use something
  PUNCH_HOLD: 1.2, PEEL_HOLD: 3,   // seconds of holding the use key (timed by the client)
  BEAM_RANGE: 12, BEAM_HALF: .3,   // how far and how wide (radians) a torch holds a mascot
  CATCH: 1.25,         // a mascot this close has you
  GRAB: 2.6,           // and one that cannot get closer than this reaches in for you, after GRAB_TIME
  CALL_GAP: 3,         // seconds between a flat guard's calls for help
  RESTART: 6,          // after the power goes out, the generator has to get it back to this before anything works
};
// Percent of building power per second, and per event.
const DRAIN = { base: .02, lights: .03, door: .25, charge: .3 };
const WEAR = .1;   // everything draws this much more for each night after the first
const CRANK = 1, MISS_COST = 13, BANG_COST = 2.5;
// Metres per second. Hunt speed is per mascot, by MASC index. Biggs is slower
// than a walking guard and never stops coming. Flan crawls while a guard is
// looking at her and runs when nobody is. Squish is quick, quicker in the
// ducts. Tank walks until it has a straight run, then charges.
const SPEED = { roam: 1.5, search: 2.3, hunt: [2.7, 2.4, 3.6, 3.1], unwatched: 4.2, ducts: 1.4, charge: 8, dark: 1.15 };
const KEEN = [.85, .035];   // the share of those speeds they manage on night 1, and what each later night adds
// How much of its speed a mascot keeps in a torch beam, by rot stage.
const LIT_SPEED = [0, .3, .5];
const ROT = { night: .19, hour: .066, ire: .25 };
const BANG_IRE = .1, GLARE_PER_IRE = 40;   // what a bang on a shut door adds to m.ire, and the seconds in a torch beam that add 1
const FLAT_BAT = .5;         // what is left of a torch its guard was flattened on top of
const GRAB_TIME = 1.2;       // seconds a mascot stuck behind furniture takes to reach over it
const STARE = 5;             // seconds one waiting its turn stands and stares before it goes back to what it was doing
const WINDUP = { time: 1.2, commit: .4 };   // Tank's wind-up before a charge, and how much of it at the end is spent not turning
const NOTICE = .7;          // seconds a mascot stands and stares after spotting a guard, before it moves
// How long a mascot keeps after a guard before it gives up and goes home: seconds on night 1, and more each night after.
// Biggs keeps on twice as long. With the power out nothing gives up.
const WIND = [9, 1.5];
const RELENT = 8;           // seconds Biggs keeps knowing where its guard is after losing sight of them
// The mascots stir and settle in turns: seconds of each, before the night's heat stretches one and shrinks the other.
const STIR = [28, 42], CALM = [24, 38];
const SPENT = [14, 24];     // seconds one stays put after it has had a guard or given up on a door

const OPEN = () => ({ L: false, V: false, R: false });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const pick = list => list[Math.random() * list.length | 0];

export const hourF = S => Math.min(6, Math.floor(S.t / F.HOUR));
export const clockF = S => (hourF(S) || 12) + ' AM';
// The building has light, doors and a charging dock until the power runs out, and again once it is cranked back to F.RESTART.
export const lightsF = S => !S.out;
// The same three stages as rotOf in rules.js, on this mode's clock. Left alone they are whole until 5 AM on
// night 1, so the torch stops them dead while a guard is learning what it is for, and fully rotten from
// midnight on night 5, when it only slows them. Torchlight and doors slammed on one (m.ire) bring it on sooner.
function rot(S, m) {
  if (S.dev?.rot >= 0) return S.dev.rot;
  const r = (S.night - 1) * ROT.night + S.t / F.HOUR * ROT.hour + (m.ire || 0) * ROT.ire;
  return r < .34 ? 0 : r < .67 ? 1 : 2;
}
// How bad the night is by now, 0 to 1: later nights, later hours, missed clocks and bigger crews all raise it.
// It shortens the calm between waves, lengthens the waves, and draws the mascots toward the guards.
const heat = S => S.out ? 1 : Math.min(1, (S.night - 1) * .15 + S.t / F.HOUR * .04 + S.missed * .03 + (S.players.length - 1) * .05);
// How many mascots may be after the guards at the same time.
const pack = S => S.out ? 4 : 1 + Math.floor(heat(S) * 2 + (S.players.length - 1) / 2);
const COMING = ['hunt', 'windup', 'charge'];
const inDucts = p => !p.flat && roomAt(p.x, p.z) === DUCTS;
// More guards wake the mascots sooner: each one past the first counts as an hour and a half.
// With the power out they are all awake, and Squish wakes for anyone in its ducts.
const isActive = (S, m) => !!S.dev?.wake || S.out || (S.night - 1) * 6 + S.t / F.HOUR + (S.players.length - 1) * 1.5 >= MASC[m.i].from || (m.i === 2 && S.players.some(inDucts));

function emit(type, x) {
  const S = game.S;
  S.evs.push({ id: ++S.evId, type, x });
  if (S.evs.length > 10) S.evs.shift();
}

/* ---------- the night ---------- */

// What each mascot is thinking. Host only: guests get the result (m.st, m.x, m.z, m.yaw).
let brains = [];
let batTimers = [];   // seconds until a taken battery turns up somewhere else
let wave = 0;         // seconds until the mascots stir or settle
// The balance harness reads what a mascot is after. Nothing in the game does.
export const brainOf = i => brains[i];

// What the end screens count: clocks as numbers, flats as [guard, mascot index], peels as the peeler's name.
// S.tally is this night's, S.total the whole run's.
const newTally = () => ({ punched: 0, missed: 0, flats: [], peels: [] });
const count = (S, key, n) => { for (const t of [S.tally, S.total]) t[key] += n; };
const record = (S, key, entry) => { for (const t of [S.tally, S.total]) t[key].push(entry); };

const guards = () => Object.values(game.players);
const standing = S => S.players.filter(p => !p.flat);

function placeGuard(p, i) {
  Object.assign(p, spawnPoint(i), { pitch: 0, on: false, bat: 1, flat: false, flatBy: -1, sp: false, act: '', safe: 0, callAt: 0 });
}

export function startFloorNight(n) {
  const S = game.S;
  Object.assign(S, { mode: 'floor', phase: 'play', night: n, t: 0, power: 100, out: false, stir: false, doors: OPEN(), killer: -1, killDoor: null, missed: 0, crank: false, round: -1 });
  S.m = MASC.map((d, i) => ({ i, x: REST[i].x, z: REST[i].z, yaw: REST[i].yaw, st: 'rest', rot: 0, lit: false, ire: 0 }));
  // Nothing moves for the first half minute of night 1, and a quarter minute after that.
  const quiet = n === 1 ? 34 : Math.max(12, 26 - n * 3);
  wave = quiet + rnd(0, 6);
  brains = MASC.map((d, i) => ({ path: [], repath: 0, dest: null, tgt: null, last: null, lost: 0, timer: rnd(0, 8), bangs: 0, cool: 0, dir: null, stuck: 0, key: null, home: false, spent: false, notice: 0, wind: 0, stared: 0, reach: null }));
  S.clocks = CLOCKS.map(() => 0);   // 0 idle, 1 due, 2 punched this hour
  S.tally = newTally(); S.total ||= newTally();
  const all = guards();
  all.forEach(placeGuard);
  S.players = all;
  const spots = BATTERY_SPOTS.map((_, i) => i).sort(() => Math.random() - .5);
  S.bats = spots.slice(0, Math.min(spots.length, 3 + all.length));
  batTimers = [];
}

export function restartFloor() {
  Object.assign(game.S, { deaths: 0, slams: 0, flats: 0, total: null });
  startFloorNight(1);
}

// Each hour some clocks come due: one more than there are guards, so nobody gets to stay in.
function openRound(S) {
  const n = Math.min(CLOCKS.length - 2, 1 + S.players.length);
  const order = CLOCKS.map((_, i) => i).sort((a, b) => (S.clocks[a] ? 1 : 0) - (S.clocks[b] ? 1 : 0) + Math.random() - .5);   // not the same ones twice running
  const due = new Set(order.slice(0, n));
  S.clocks = CLOCKS.map((_, i) => due.has(i) ? 1 : 0);
  emit('round', n);
}
function closeRound(S) {
  const missed = S.clocks.filter(c => c === 1).length;
  if (!missed) return;
  S.missed += missed; count(S, 'missed', missed);
  if (!S.dev?.power) S.power = Math.max(0, S.power - MISS_COST * missed);
  emit('miss', missed);
}

function drainPower(S, dt) {
  const shut = DOORS.filter(k => S.doors[k]).length;
  const near = (p, thing) => !p.flat && dist(p, thing) < F.REACH;
  const charging = S.out ? [] : S.players.filter(p => p.act === 'charge' && near(p, CHARGER) && p.bat < 1);
  // One handle: a second guard at the generator adds nothing.
  S.crank = S.players.some(p => p.act === 'crank' && near(p, GENERATOR));
  for (const p of charging) p.bat = Math.min(1, p.bat + F.CHARGE * dt);
  const drain = S.out ? 0 : (DRAIN.base + DRAIN.lights + DRAIN.door * shut + DRAIN.charge * charging.length) * (1 + WEAR * (S.night - 1));
  S.power = Math.max(0, Math.min(100, S.power + ((S.crank ? CRANK : 0) - drain) * dt));
  if (S.dev?.power) S.power = 100;
  if (!S.out && S.power <= 0) { S.out = true; S.doors = OPEN(); emit('out'); }
  else if (S.out && S.power >= F.RESTART) { S.out = false; emit('on'); }
  for (const p of S.players) if (p.on) { p.bat = Math.max(0, p.bat - dt / F.BAT_LIFE); if (p.bat <= 0) p.on = false; }
}

function respawnBatteries(S, dt) {
  batTimers = batTimers.map(t => t - dt);
  while (batTimers.length && batTimers[0] <= 0) {
    batTimers.shift();
    const free = BATTERY_SPOTS.map((_, i) => i).filter(i => !S.bats.includes(i) && !S.players.some(p => dist(p, BATTERY_SPOTS[i]) < 8));
    if (free.length) S.bats.push(pick(free)); else batTimers.push(5);
  }
}

// The mascots stir, then settle, then stir again. With the power out they do not settle.
function turnWave(S, dt) {
  if (S.out) { if (!S.stir) { S.stir = true; emit('stir'); } wave = 0; return; }
  if ((wave -= dt) > 0) return;
  S.stir = !S.stir;
  const h = heat(S);
  wave = S.stir ? rnd(...STIR) * (1 + h) : rnd(...CALM) * (1 - .7 * h);
  emit(S.stir ? 'stir' : 'calm');
}

/* ---------- mascots ---------- */

// Is this guard's torch on this mascot?
function beamOn(S, p, m) {
  if (!p.on || p.bat <= 0 || p.flat || Math.abs(p.pitch) > .7) return false;
  const d = dist(p, m);
  if (d > F.BEAM_RANGE) return false;
  // Close up the beam is wider than the thing in it.
  const half = F.BEAM_HALF + Math.atan2(.6, Math.max(d, .5));
  return Math.abs(angDiff(Math.atan2(m.x - p.x, m.z - p.z), p.yaw)) < half && sees(p.x, p.z, m.x, m.z, S.doors);
}
// Is the guard looking its way at all? Madame Flan cares.
const watchedBy = (S, p, m) => !p.flat && Math.abs(angDiff(Math.atan2(m.x - p.x, m.z - p.z), p.yaw)) < .9 && dist(p, m) < 20 && sees(p.x, p.z, m.x, m.z, S.doors);

function canSee(S, m, p) {
  const d = dist(m, p);
  // A lit torch shows from across a hall. With the building dark and yours off, it has to be close.
  const range = p.on ? 17 : lightsF(S) ? 12 : 5;
  if (d > range) return false;
  if (d > 2.5 && Math.abs(angDiff(Math.atan2(p.x - m.x, p.z - m.z), m.yaw)) > 1.2) return false;
  return sees(m.x, m.z, p.x, p.z, S.doors);
}

// Something made a sound here. Mascots that are out, not on their way home and not already after someone may come and look.
function noise(S, x, z, radius, chance) {
  S.m.forEach((m, i) => {
    const b = brains[i];
    if (!isActive(S, m) || !['roam', 'search'].includes(m.st) || b.home || Math.hypot(m.x - x, m.z - z) > radius || Math.random() > chance) return;
    m.st = 'search'; b.last = { x, z }; b.timer = rnd(3, 6); b.repath = 0;
  });
}

// Where to walk next.
function pickDest(S, m) {
  const up = standing(S);
  let room;
  if (up.length) {
    // In the dark they do not wander. They come to where you are.
    if (S.out) { const p = pick(up); return { x: p.x, z: p.z }; }
    // Squish goes for whoever is sitting in the booth, by the vent if it is open.
    if (m.i === 2 && up.some(p => roomAt(p.x, p.z) === BOOTH) && Math.random() < .6) room = BOOTH;
    else if (S.crank && Math.random() < .5) room = GENERATOR.room;
    else if (Math.random() < .25 + .5 * heat(S)) { const p = pick(up); room = roomAt(p.x, p.z); }
  }
  if (room == null || room < 0 || (room === DUCTS && m.i !== 2)) {
    const rooms = ROOMS3.map((_, i) => i).filter(i => i !== BOOTH && (i !== DUCTS || m.i === 2) && i !== roomAt(m.x, m.z));
    room = pick(rooms);
  }
  const [x0, z0, x1, z1] = pick(ROOMS3[room].rects);
  for (let tries = 0; tries < 8; tries++) { const x = rnd(x0 + 1, x1 - 1), z = rnd(z0 + 1, z1 - 1); if (walkable(x, z, MASCOT_R + .2)) return { x, z }; }
  return roomCentre(room);
}

const turn = (m, to, rate) => { m.yaw += Math.max(-rate, Math.min(rate, angDiff(to, m.yaw))); };

// Walk toward a goal by the open route. Returns 'there', 'blocked' (a shut door
// is in the way), 'nowhere' (there is no way to it at all), 'jammed' (wedged on
// furniture short of it) or 'going'.
function goTo(S, m, b, goal, speed, dt, eager) {
  b.repath -= dt;
  if (b.repath <= 0 || !b.path.length) {
    const r = route(m.x, m.z, goal.x, goal.z, { doors: S.doors, ducts: m.i === 2 });
    b.path = r.path; b.key = r.blocked || null; b.repath = eager ? .35 : 1.5;
    if (!r.path.length && !r.blocked) return 'nowhere';
  }
  while (b.path.length && dist(m, b.path[0]) < .6) b.path.shift();
  const next = b.path[0];
  if (!next) return b.key ? 'blocked' : 'there';
  const dx = next.x - m.x, dz = next.z - m.z, d = Math.hypot(dx, dz), stepLen = Math.min(d, speed * dt);
  turn(m, Math.atan2(dx, dz), 7 * dt);
  // Getting nowhere is sliding along something without getting nearer, as well as not moving at all.
  if (stepLen > 0 && (slide(m, dx / d * stepLen, dz / d * stepLen, MASCOT_R, S.doors) < .3 || d - dist(m, next) < stepLen * .3)) {
    b.stuck += dt;
    // Wedged on a prop: this is as near as it gets to a goal it cannot stand on.
    if (b.stuck > .8) { b.stuck = 0; b.repath = 0; b.path = []; return 'jammed'; }
  } else b.stuck = 0;
  return 'going';
}

function flatten(S, p, m, b) {
  if (S.dev?.god) return;
  Object.assign(p, { flat: true, on: false, flatBy: m.i, act: '' });
  S.flats = (S.flats || 0) + 1; record(S, 'flats', [p.name, m.i]);
  emit('flat', { id: p.id, by: m.i, x: p.x, z: p.z });
  p.bat *= FLAT_BAT;
  m.st = 'feast'; b.timer = 3.5; b.tgt = null; b.path = []; b.spent = true;
  if (!standing(S).length) endNight(S, m.i);
}
function endNight(S, by) { S.phase = 'dead'; S.killer = by; S.killDoor = null; S.deaths++; emit('scare'); }

// Touching is being within F.CATCH with no wall between: a table between does not save anyone.
function catchGuards(S, m, b) {
  for (const p of standing(S)) if (S.t >= p.safe && dist(m, p) < F.CATCH && reaches(m.x, m.z, p.x, p.z, S.doors)) { flatten(S, p, m, b); return true; }
  return false;
}

// It has seen this guard. The first time, it stops and stares before it comes.
function spot(S, m, b, p) {
  if (m.st !== 'hunt') { emit('spot', { i: m.i, id: p.id, x: m.x, z: m.z }); b.notice = NOTICE; b.repath = 0; b.home = false; b.wind = (WIND[0] + WIND[1] * S.night) * (m.i ? 1 : 2); }
  m.st = 'hunt'; b.tgt = p.id; b.last = { x: p.x, z: p.z }; b.lost = 0;
}

function runMascot(S, m, b, dt) {
  if (!isActive(S, m)) return;
  m.rot = rot(S, m);
  const up = standing(S);
  // One standing where it stands is switched off: a torch does nothing to it.
  const lighter = m.st === 'rest' ? null : up.find(p => beamOn(S, p, m));
  m.lit = !!lighter;
  if (lighter) m.ire += dt / GLARE_PER_IRE;
  b.cool -= dt;
  const ductGuest = m.i === 2 ? up.find(p => inDucts(p) && S.t >= p.safe) : null;

  // Standing where it stands. A wave gets it moving, or (Squish) someone in the ducts.
  if (m.st === 'rest') {
    b.timer -= dt;
    if (ductGuest) spot(S, m, b, ductGuest);
    else if (b.timer <= 0 && S.stir) { m.st = 'roam'; b.dest = null; b.home = false; }
    return;
  }
  // States that run on a timer and ignore everything else.
  if (m.st === 'feast' || m.st === 'stun') {
    b.timer -= dt;
    if (b.timer <= 0) { m.st = 'roam'; b.dest = null; b.path = []; b.home = false; }
    return;
  }
  if (m.st === 'windup') {
    // It lines up on its guard, then commits: for the last moment of the wind-up it has stopped turning.
    const tp = S.players.find(p => p.id === b.tgt);
    if (tp && b.timer > WINDUP.commit) turn(m, Math.atan2(tp.x - m.x, tp.z - m.z), 5 * dt);
    b.timer -= dt;
    if (b.timer <= 0) { m.st = 'charge'; b.timer = 2.4; b.dir = { x: Math.sin(m.yaw), z: Math.cos(m.yaw) }; }
    return;
  }
  if (m.st === 'charge') {
    // Tank does not steer and does not stop for a torch.
    const got = slide(m, b.dir.x * SPEED.charge * dt, b.dir.z * SPEED.charge * dt, MASCOT_R, S.doors);
    if (catchGuards(S, m, b)) return;
    b.timer -= dt;
    if (got < .5) { m.st = 'stun'; b.timer = 2.6; b.cool = 7; emit('crash', { x: m.x, z: m.z }); }
    else if (b.timer <= 0) { m.st = 'hunt'; b.cool = 6; }
    return;
  }

  // Who can it see? One that has had its turn is on its way home and looks at nobody, though walking into it still counts.
  let seen = null, near = 1e9;
  const looking = !b.spent || S.out;
  if (looking) for (const p of up) if (S.t >= p.safe && canSee(S, m, p) && dist(m, p) < near) { near = dist(m, p); seen = p; }
  if (!seen && looking && lighter && S.t >= lighter.safe) seen = lighter;   // a beam on it gives you away
  // Only so many come for the guards at once. The rest stop and stare, and wait their turn.
  // Squish does not wait for anyone in its ducts.
  let stare = false;
  if (seen && (m.st === 'hunt' || S.m.filter(o => COMING.includes(o.st)).length < pack(S))) { near = dist(m, seen); spot(S, m, b, seen); }
  else if (ductGuest && looking) { seen = ductGuest; near = dist(m, seen); spot(S, m, b, seen); }
  else if (seen) { b.stared += dt; if (b.stared < STARE) { turn(m, Math.atan2(seen.x - m.x, seen.z - m.z), 3 * dt); stare = true; } seen = null; }
  else b.stared = Math.max(0, b.stared - dt * 2);

  if (m.st === 'siege') {
    const door = DOORWAYS.find(d => d.key === b.key);
    if (door) turn(m, Math.atan2((door.rect[0] + door.rect[2]) / 2 - m.x, (door.rect[1] + door.rect[3]) / 2 - m.z), 5 * dt);
    if (catchGuards(S, m, b)) return;
    if (!S.doors[b.key]) { m.st = b.tgt ? 'hunt' : 'roam'; b.repath = 0; return; }
    b.timer -= dt;
    if (b.timer > 0) return;
    emit('bang', b.key);
    S.slams++; m.ire += BANG_IRE; b.bangs++;
    if (!S.dev?.power) S.power = Math.max(0, S.power - BANG_COST);
    b.timer = rnd(1.6, 3);
    if (b.bangs >= 3 + (S.night > 2 ? 1 : 0)) { m.st = 'roam'; b.tgt = null; b.dest = null; b.path = []; b.bangs = 0; b.timer = 0; b.spent = true; }
    return;
  }

  // Out of puff: it has had its turn.
  if (m.st === 'hunt' && !S.out && b.notice <= 0 && (b.wind -= dt) <= 0) { m.st = 'roam'; b.tgt = null; b.dest = null; b.spent = true; emit('quit', { i: m.i, x: m.x, z: m.z }); }
  else if (!seen && m.st === 'hunt') {
    const tp = S.players.find(p => p.id === b.tgt), keeps = m.i === 0 ? RELENT : 1.2;
    b.lost += dt;
    if (tp && !tp.flat && b.lost < keeps) b.last = { x: tp.x, z: tp.z };   // it knows which way you went round the corner
    if (!tp || tp.flat || b.lost > keeps + 3) { m.st = 'search'; b.timer = rnd(4, 7); }
  } else if (!seen) {
    const loud = !b.home && up.find(p => p.sp && dist(m, p) < 9);
    if (loud) { m.st = 'search'; b.last = { x: loud.x, z: loud.z }; b.timer = rnd(3, 6); }
  }

  // They are slow on night 1 and quicker every night after, quicker for every missed clock, and quickest in the dark.
  const angry = (KEEN[0] + KEEN[1] * (S.night - 1)) * (1 + .02 * Math.min(8, S.missed)) * (S.out ? SPEED.dark : 1);
  let speed, goal, eager = false;
  if (m.st === 'hunt') {
    goal = b.last; eager = true;
    if (b.notice > 0) { b.notice -= dt; turn(m, Math.atan2(goal.x - m.x, goal.z - m.z), 5 * dt); speed = 0; }
    // Tank: with a clear run at you, it winds up and charges.
    else if (m.i === 3 && seen && b.cool <= 0 && near > 5 && near < 15 && clear(m.x, m.z, seen.x, seen.z, MASCOT_R, S.doors)) {
      m.st = 'windup'; b.timer = WINDUP.time; emit('roar', { i: m.i, x: m.x, z: m.z }); return;
    } else {
      speed = SPEED.hunt[m.i] * angry;
      if (m.i === 1 && !up.some(p => watchedBy(S, p, m))) speed = SPEED.unwatched * angry;
      if (m.i === 2 && roomAt(m.x, m.z) === DUCTS) speed *= SPEED.ducts;
    }
  } else if (m.st === 'search') { speed = SPEED.search * angry; goal = b.last; }
  else {
    // Between waves they walk back to where they stand. So does one that has flattened a guard
    // or been turned away at a door, and it stays there a while. With the power out nothing goes home.
    const settle = (!S.stir || b.spent) && !S.out;
    if (settle !== b.home) { b.home = settle; b.dest = settle ? REST[m.i] : null; b.repath = 0; }
    if (b.home && dist(m, REST[m.i]) < 1.5) { m.st = 'rest'; b.timer = b.spent ? rnd(...SPENT) * (1 - .5 * heat(S)) : rnd(0, 8); b.spent = false; b.path = []; return; }
    if (!b.dest) { b.dest = pickDest(S, m); b.repath = 0; }
    speed = SPEED.roam; goal = b.dest;
  }
  if (m.lit) speed *= LIT_SPEED[m.rot];
  if (stare) speed = 0;
  if (m.lit && lighter) turn(m, Math.atan2(lighter.x - m.x, lighter.z - m.z), 4 * dt);   // it turns to face the light

  const res = speed > 0 ? goTo(S, m, b, goal, speed, dt, eager) : 'going';
  if (catchGuards(S, m, b)) return;
  // Free to move, within arm's reach of a guard, and getting no nearer: they are tucked in behind the furniture. It reaches in.
  const tucked = m.st === 'hunt' && speed > 0 && seen && near < F.GRAB && b.reach && dist(m, b.reach) < .4 && reaches(m.x, m.z, seen.x, seen.z, S.doors);
  if (!tucked) b.reach = { x: m.x, z: m.z, t: S.t };
  else if (S.t - b.reach.t > GRAB_TIME) { flatten(S, seen, m, b); return; }
  if (res === 'blocked') { m.st = 'siege'; b.timer = 1.2; b.bangs = 0; emit('arrive', b.key); return; }
  if (res === 'nowhere') { m.st = 'roam'; b.tgt = null; b.dest = b.home ? REST[m.i] : null; return; }
  // Wedged short of somewhere it was only looking: look somewhere else.
  if (res === 'jammed' && !seen) { if (m.st === 'hunt') { m.st = 'search'; b.timer = rnd(3, 5); b.last = { x: m.x, z: m.z }; } else if (m.st === 'search') { m.st = 'roam'; b.dest = null; } else if (!b.home) b.dest = null; return; }
  if (res === 'there') {
    if (m.st === 'roam') { b.timer -= dt; if (b.timer <= 0) { b.dest = null; b.timer = rnd(2, 7); } }
    else if (m.st === 'search') { m.yaw += dt * 1.5; b.timer -= dt; if (b.timer <= 0) { m.st = 'roam'; b.dest = null; b.timer = rnd(1, 3); } }
    else if (m.st === 'hunt' && !seen) { m.st = 'search'; b.timer = rnd(3, 5); }
  }
}

/* ---------- the tick ---------- */

let lastStep = performance.now(), crankNoise = 0;
export function stepFloor() {
  const S = game.S, now = performance.now();
  const dt = Math.min(.25, (now - lastStep) / 1000) * (S.dev?.speed || 1);
  lastStep = now;
  S.players = guards();
  if (S.phase !== 'play') return;
  S.players.forEach((p, i) => { if (p.x == null) placeGuard(p, i); });   // joined after the night began
  // The last guard standing left the room: the ones on the floor are not getting up.
  if (S.players.length && !standing(S).length) { endNight(S, S.players[0].flatBy); return; }
  S.t += dt;
  const hour = Math.floor(S.t / F.HOUR);
  if (hour > S.round) {
    if (S.round >= 0) { closeRound(S); emit('hour'); }
    S.round = hour;
    if (hour >= 6) { S.phase = S.night >= FINAL_NIGHT ? 'won' : 'win'; emit('win'); return; }
    openRound(S);
  }
  drainPower(S, dt);
  respawnBatteries(S, dt);
  turnWave(S, dt);
  if (S.crank && (crankNoise -= dt) <= 0) { crankNoise = 2; noise(S, GENERATOR.x, GENERATOR.z, 24, .35); }
  if (S.dev?.freeze) return;
  for (let i = 0; i < S.m.length && S.phase === 'play'; i++) runMascot(S, S.m[i], brains[i], dt);
}

const num = (v, lo, hi, fallback) => Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;

// One guard's action. Returns false for an action this mode does not handle.
export function actFloor(pid, a) {
  const S = game.S, p = game.players[pid];
  if (!p || a.t === 'name') return false;
  if (S.phase !== 'play' || p.x == null) return true;
  if (a.t === 'p') {
    // The guard's own browser moves them; the host only refuses a position inside a wall or a shut door.
    if (!p.flat && Number.isFinite(a.x) && Number.isFinite(a.z) && walkable(a.x, a.z, .2, S.doors)) { p.x = a.x; p.z = a.z; }
    p.yaw = num(a.yaw, -1e3, 1e3, p.yaw); p.pitch = num(a.pitch, -1.6, 1.6, p.pitch);
    p.on = !!a.on && p.bat > 0 && !p.flat;
    p.sp = !!a.sp && !p.flat;
    p.act = p.flat ? '' : a.act === 'crank' || a.act === 'charge' ? a.act : '';
    return true;
  }
  if (a.t === 'call') {
    // A flat guard shouting for help: everyone gets a ping where they lie.
    if (p.flat && S.t >= (p.callAt || 0)) { p.callAt = S.t + F.CALL_GAP; emit('call', { id: p.id, x: p.x, z: p.z }); }
    return true;
  }
  if (a.t !== 'use' || p.flat) return true;
  const near = thing => thing && dist(p, thing) < F.REACH;
  if (a.what === 'clock' && S.clocks[a.i] === 1 && near(CLOCKS[a.i])) {
    S.clocks[a.i] = 2; count(S, 'punched', 1);
    emit('punch', { i: a.i, by: p.id, x: CLOCKS[a.i].x, z: CLOCKS[a.i].z });
    noise(S, p.x, p.z, 16, .5);
  } else if (a.what === 'door' && DOORS.includes(a.k) && lightsF(S) && near(PANELS[a.k])) {
    // A door will not shut on someone standing in it.
    const d = DOORWAYS.find(d => d.key === a.k), [x0, z0, x1, z1] = d.rect;
    const inWay = (q, r) => q.x > x0 - r && q.x < x1 + r && q.z > z0 - r && q.z < z1 + r;
    if (!S.doors[a.k] && (S.players.some(q => inWay(q, PLAYER_R)) || S.m.some(m => inWay(m, MASCOT_R)))) { emit('fumble', { k: a.k, by: p.id }); return true; }
    S.doors[a.k] = !S.doors[a.k];
    emit('door', S.doors[a.k]);
  } else if (a.what === 'bat' && S.bats.includes(a.i) && near(BATTERY_SPOTS[a.i]) && p.bat < 1) {
    S.bats = S.bats.filter(i => i !== a.i);
    batTimers.push(rnd(30, 50));
    p.bat = Math.min(1, p.bat + F.BAT_PICKUP);
    emit('bat', { by: p.id });
  } else if (a.what === 'peel') {
    const other = S.players.find(q => q.id === a.id);
    if (other?.flat && near(other)) {
      Object.assign(other, { flat: false, flatBy: -1, safe: S.t + 4 });
      record(S, 'peels', p.name);
      emit('peel', { id: other.id, by: p.id, x: other.x, z: other.z });
    }
  }
  return true;
}
