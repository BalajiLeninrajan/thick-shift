// The night simulation, host side. Only the host calls stepFloor() and actFloor(); net.js
// sends the state S it keeps to every guest. S.phase is 'lobby' until the host
// starts night 1, then 'play', and a night ends in 'win', 'dead' or, after the
// last one, 'won'.
//
// Nothing here keeps a night's state at module level. The host's thinking (the guards in the room, the mascots'
// brains, the timers) lives on a Sim the caller makes with newSim() and passes in, beside S. Every random draw goes
// through sim.rng and the time comes in as `now`, so the balance harness can seed one and fake the other.
// packages/sim/CONTRACT.md says how to call it.
//
// The night in one paragraph: faults break out in the breaker boxes around the
// building, and a guard has to walk to each and fix it. An open fault leaks
// power, more the longer it is left, and darkens its room; left long enough it
// burns out some of what the building can hold. When the power goes the doors
// open, the lights go out
// and every mascot comes for whoever is left. The mascots walk the same rooms,
// in waves: they stir, then go back to where they stand. A torch beam holds one
// still, less so the more it has rotted, and the torch runs down. Touch a
// mascot and you are flattened, and stay on the floor until another guard
// peels you up. Everyone flat at once ends the night. A guard can step into a
// locker to get out of sight. A mascot that saw them go in pulls them out, one
// that lost them nearby checks the lockers, and one that lingers sniffs them out.
// A guard can also throw a Mini Biggs, a plush keyring with a voice box, which
// sings on a bar of the torch's battery where it lands, and a mascot wandering
// nearby goes to see whose birthday it is.
//
// The numbers here were tuned against scripted guards in tools/balance/floor.ts
// (`node tools/balance/floor.ts`), which plays every night with careless,
// competent and expert guards alone and in groups, and with the strategies that
// should not work. What each number was tuned against is noted beside it. The
// target: a competent crew of three survives night 1 every time and each later
// night about 22 points less often (78, 55, 33, then 10% of night 5s); a guard
// alone and crews of two, four and six fall the same way with no cliffs; and
// every strategy in the harness's second half loses. Since the clocks became
// faults a guard alone is near that and crews fall faster from night 3 (see the
// README's "Balance on the floor").
import { DOORS, FINAL_NIGHT, MASC } from './config.ts';
import {
  BATTERY_SPOTS,
  BOOTH,
  BOXES,
  CHARGER,
  clear,
  DOORWAYS,
  type Doorway,
  DUCTS,
  GENERATOR,
  HIDES,
  MASCOT_R,
  PANELS,
  PLAYER_R,
  REST,
  ROOMS3,
  reaches,
  roomAt,
  roomCentre,
  route,
  sees,
  slide,
  spawnPoint,
  walkable,
} from './map.ts';
import type {
  Action,
  Brain,
  DoorKey,
  Doors,
  EventData,
  EventType,
  Guard,
  LobbyState,
  Mascot,
  MascotState,
  NightState,
  Player,
  Point,
  Rng,
  SimEvent,
  State,
  Tally,
} from './types.ts';

// Tuning. Clients read some of these to draw bars and prompts.
export const F = {
  HOUR: 70, // seconds per in-game hour: a night is seven minutes
  WALK: 3,
  SPRINT: 5.2,
  // Seconds of light in a full torch, what a spare battery adds, and charge per second at the booth dock. The
  // battery numbers were tuned with a one-minute dock (a competent guard spent a quarter to a third of night 5
  // under a quarter of a torch); the dock is now four times faster at the same power per torch, untuned.
  BAT_LIFE: 65,
  // The phone's minimap is meant for a glance. It draws on the torch's battery at PHONE times the torch's rate:
  // a full battery lasts 16 seconds with only the phone up and 13 with the torch on too, so a two-second look
  // costs an eighth of a battery. While it is up the guard walks at PHONE_WALK of their pace and cannot run
  // (player.js), and the torch hangs at the floor and holds nothing (beamOn). Not tuned in the balance harness,
  // whose guards never use it.
  PHONE: 4,
  PHONE_WALK: 0.6,
  BAT_PICKUP: 0.5,
  CHARGE: 1 / 15, // a full torch in 15 s at the dock (it was a minute, which felt like standing still for nothing)
  REACH: 2.2, // how close you must be to use something
  PEEL_HOLD: 3,
  HIDE_HOLD: 0.5, // seconds of holding the use key (timed by the client)
  // Seconds a fault takes to fix, by kind: the length of its minigame for a steady hand (the client times it; the
  // balance harness's guards hold use this long).
  FIX: [1.8, 2.4, 2.2],
  BEAM_RANGE: 12,
  BEAM_HALF: 0.3, // how far and how wide (radians) a torch holds a mascot
  CATCH: 1.25, // a mascot this close has you
  GRAB: 2.6, // and one that cannot get closer than this reaches in for you, after GRAB_TIME
  CALL_GAP: 3, // seconds between a flat guard's calls for help
  RESTART: 14, // with the power out, the crank has to put this much back before anything works again
};
// Percent of building power per second, and per event. Tuned so a competent guard alone ends night 5 near half
// power and a crew of four near 15%, losing the power on half its nights and winning under half as often if
// nobody cranks, and so a crew that shuts the doors and stays in is dead soon after 2 AM.
const DRAIN = { base: 0.02, lights: 0.03, door: 0.18, charge: 0.48 }; // charge: four times the old rate, to match the dock's 4x speed, so a full torch still costs the same power
const WEAR = 0.07; // everything draws this much more for each night after the first
const CRANK = 0.7,
  BANG_COST = 2.5;
// Faults (breakOut, stepFaults, drainPower). A guard alone gets one every `every` seconds on night 1 at midnight, a
// little sooner each night and hour; each guard past the first adds `crew` of that again. An open one leaks leak[0]
// percent a second, rising to leak[1] over `ripen` seconds, and after `dark` seconds its room's lights go. Past
// `scar` seconds it burns `cap` points of ceiling a second, which the crank cannot put back. Leaks and burns are
// shared by the guards (crewShare), and both grow by `pile` for every fault open past what the crew can be expected
// to have on its hands (see drainPower). With the power out the open faults eat outLeak times their leak out of
// what the crank puts back. A bang on a booth door breaks one in the room outside it `bang` of the time.
// Tuned against the harness so that ignoring them, or leaving them to one guard while the rest stay in, loses.
const FAULT = { every: 50, crew: 0.75, first: 18, leak: [0.01, 0.06], ripen: 50, scar: 65, cap: 0.2, dark: 25, bang: 0.35, outLeak: 3, pile: 0.4 };
// How many points of ceiling count as an hour's worth of neglect, for the night's heat and the mascots' speed.
const CAP_SCALE = 25;
// The box nearest each booth door from outside, for the bang that breaks one.
const BANG_BOX: Record<DoorKey, number> = { L: 5, R: 7, V: 6 };
// Metres per second. Hunt speed is per mascot, by MASC index. Biggs is slower
// than a walking guard and never stops coming. Flan crawls while a guard is
// looking at her and runs when nobody is. Squish is quick, quicker in the
// ducts. Tank walks until it has a straight run, then charges. With the power
// out every one of them moves `out` times as fast, which outruns a sprinting
// guard: the crank is the only way out. (Untuned against the harness.)
const SPEED = { roam: 1.5, search: 2.3, hunt: [2.7, 2.4, 3.6, 2.6], unwatched: 4.2, ducts: 1.4, charge: 7, dark: 1.15, out: 2 };
const KEEN = [0.8, 0.04]; // the share of those speeds they manage on night 1, and what each later night adds (with ROT and heat, the night-5 targets)
// How much of its speed a mascot keeps in a torch beam, by rot stage.
const LIT_SPEED = [0, 0.2, 0.4];
const ROT = { night: 0.12, hour: 0.066, ire: 0.25 };
// What a bang on a shut door adds to m.ire, and the seconds in a torch beam that add 1. Tuned so torchlight is what
// rots them: on night 1, about 25 s of beam on one mascot brings out stage 1 and 35 to 50 s stage 2, so a guard who
// lights up everything sees two of them at stage 2 before 6 AM (and the torch holds those two less well).
const BANG_IRE = 0.1,
  GLARE_PER_IRE = 18;
const FLAT_BAT = 0.5; // what is left of a torch its guard was flattened on top of
// Seconds one sits on the guard it caught. It then looks round for whoever comes to peel them up rather than going
// home, so a catch is no breather for the rest of a crew: when it went home, four guards won most of night 5.
const FEAST = 3.5;
const GRAB_TIME = 1.2; // seconds a mascot stuck behind furniture takes to reach over it
const STARE = 5; // seconds one waiting its turn stands and stares before it goes back to what it was doing
const CHARGE_GAP = 10; // seconds before Tank can charge again
const WINDUP = { time: 1.5, commit: 0.5 }; // Tank's wind-up before a charge, and how much of it at the end is spent not turning
const SEARCH_MAX = 14; // seconds one spends looking for what it heard or lost before it gives that up
const NOTICE = 0.7; // seconds a mascot stands and stares after spotting a guard, before it moves
// How long a mascot keeps after a guard before it gives up and goes home: seconds on night 1, and more each night after.
// Biggs keeps on twice as long. With the power out nothing gives up.
const WIND = [8, 0.75];
const RELENT = 8; // seconds Biggs keeps knowing where its guard is after losing sight of them
// The mascots stir and settle in turns: seconds of each, before the night's heat stretches one and shrinks the other.
const STIR: [number, number] = [28, 42],
  CALM: [number, number] = [24, 38];
const SPENT: [number, number] = [18, 30]; // seconds one stays put after it has given up on a guard or a door
// How many nights' worth of wear each night has had, for rot, heat, speed and power drain. Night 5 counts for more
// than one step past night 4: with a plain 4, a crew of three won 18% of night 5s against a target of 10.
const RAMP = [0, 1, 2, 3.15, 4.3];
// Lockers (HIDES in map.ts). A mascot that saw a guard step in, or was hunting them and still knew where they were
// (the same few seconds it keeps after losing sight round a corner, eight for Biggs), opens that locker when it gets
// there. Any other that stands within SNIFF.near of an occupied locker for SNIFF.time seconds opens it anyway, so
// a locker is for getting out of sight, not for waiting out the night. The doors are heard: LOCKER_NOISE is
// [metres, chance], as for noise(). Not tuned: the balance harness's `hides`
// scenarios only show that a guard who uses lockers does about as well as one who does not, and sitting in one loses.
const SNIFF = { near: 1.6, time: 3 };
// One that loses the guard it was hunting checks the lockers near where it last knew they were: each within
// CHECK.near metres of that spot, nearest first, with CHECK.chance, at most CHECK.most of them. It walks to the
// doors and opens them, empty or not. The way to beat it is to get further than that, or to outlast its wind.
const CHECK = { near: 8, chance: 0.5, most: 2 };
const LOCKER_NOISE: [number, number] = [6, 0.5];
// Mini Biggs: a palm-sized plush of Big Biggs on a keyring, from the gift shop, with a voice box that sings "Happy
// Birthday from Big Biggs!". Each guard clocks in holding one (p.toy) and holds one at most. Its own cell died years
// ago, so a guard tops it up from the torch: a throw costs `cost` of the battery (one of the five bars on the HUD)
// and needs that much left. It is thrown along the guard's view, no further than `range` metres, and flies at `speed`
// metres a second over the furniture until a wall or a shut door stops it. Where it lands it sings for `sing`
// seconds, which is a noise() of `hear` metres at `chance`: whatever is wandering or searching nearby goes to look,
// and whatever is already after a guard does not, so it buys a way past, not a way out. Then it lies there (S.toys)
// until a guard with empty hands picks it up, which means walking to where the mascots were sent. The cost was set
// against the harness, whose competent and expert guards throw theirs at a wanderer in their way while they have the
// battery to spare and go back for it once things are quiet. Light spent on a song is light not holding a mascot off.
export const TOY = { cost: 0.2, range: 14, speed: 11, hear: 12, chance: 0.9, sing: 3 };

const OPEN = (): Doors => ({ L: false, V: false, R: false });
// Math.hypot is looked up on every call: tools/roblox/diff/rec.ts swaps it for the plain formula Luau uses.
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const angDiff = (a: number, b: number) => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
// The night's random numbers, all drawn from sim.rng in the order the night has always drawn them (CONTRACT.md).
const rnd = (sim: Sim, a: number, b: number) => a + sim.rng() * (b - a);
const pick = <T>(sim: Sim, list: T[]): T => list[(sim.rng() * list.length) | 0];
const hidden = (p: Guard) => p.hid >= 0;

export const hourF = (S: State): number => Math.min(6, Math.floor(S.t / F.HOUR));
export const clockF = (S: State): string => (hourF(S) || 12) + ' AM';
// The building has light, doors and a charging dock until the power runs out, and again once it has been cranked
// back to F.RESTART. S.power is 0 for exactly as long as S.out is set.
export const lightsF = (S: State): boolean => !S.out;
// How eerie the building is, 0 to 1: fog, colour drained from the picture, sagging lamps and the background
// sound (app.js, post.js, audio.js) all follow it. It fills over seven 45-second spans counted from midnight
// on night 1, with two more already counted for each later night: full at 4:30 on night 1, from midnight on night 5.
const DREAD_SPAN = 45,
  DREAD_FULL = 7;
// (`S.dev && S.dev.dread >= 0` is how `S.dev?.dread >= 0` reads with the types: the same answer for every S.)
export const dreadF = (S: State): number => (S.dev && S.dev.dread >= 0 ? S.dev.dread : Math.min(1, (S.t / DREAD_SPAN + (S.night - 1) * 2) / DREAD_FULL));
const late = (S: State) => (S.night <= RAMP.length ? RAMP[S.night - 1] : (RAMP.at(-1) as number) + S.night - RAMP.length);
// Mascots start the night as the costumes they were and come apart: 0 is cute, 1 is off, 2 is what is underneath. Left alone they are whole until 5 AM on
// night 1, so the torch stops them dead while a guard is learning what it is for, and fully rotten from
// 3 AM on night 5, when it only slows them. Torchlight and doors slammed on one (m.ire) bring it on sooner.
function rot(S: NightState, m: Mascot): number {
  if (S.dev && S.dev.rot >= 0) return S.dev.rot;
  const r = late(S) * ROT.night + (S.t / F.HOUR) * ROT.hour + (m.ire || 0) * ROT.ire;
  return r < 0.34 ? 0 : r < 0.67 ? 1 : 2;
}
// How bad the night is by now, 0 to 1: later nights, later hours, burnt-out ceiling and bigger crews all raise it.
// It shortens the calm between waves, lengthens the waves, and draws the mascots toward the guards. The crew term
// grows with the square of the extra guards: crews of two and three already carry each other's loss, and a linear
// term had them losing night 5 far more often than a guard alone while four and six won it twice as often.
const heat = (S: NightState) =>
  S.out ? 1 : Math.min(1, late(S) * 0.07 + (S.t / F.HOUR) * 0.03 + ((100 - S.cap) / CAP_SCALE) * 0.06 + (S.players.length - 1) ** 2 * 0.02);
// How many mascots may be after the guards at the same time.
const pack = (S: NightState) => (S.out ? 4 : 1 + Math.floor(heat(S) * 1.2 + (S.players.length - 1) * 0.45));
// How many may be out of their places at the same time. A guard alone meets two at once, and three from 5 AM on
// night 3, 3 AM on night 4 and 1 AM on night 5. A crew of three meets all four from 2 AM on night 1, four or more
// from the start.
const roster = (S: NightState) => (S.out ? 4 : 2 + Math.floor(heat(S) * 3.3 + (S.players.length - 1) * 0.75));
const COMING: MascotState[] = ['hunt', 'windup', 'charge'];
const inDucts = (p: Guard) => !p.flat && roomAt(p.x, p.z) === DUCTS;
// When each mascot first comes out, by MASC index: hours of the run (six to a night), and how many hours sooner
// for each guard past the first. Alone, Squish turns up at 3 AM on night 1. Tank turns up on night 2 for every
// crew: at 4 AM alone, 2:24 for three, midnight for six. When it waited for night 3 or 4, night 2 played like
// night 1 and the night it woke was a cliff. With the power out they are all up, and Squish is up for anyone in
// its ducts.
const WAKE = [
  [0, 2],
  [0, 2],
  [3, 2],
  [10, 0.8],
];
const isActive = (S: NightState, m: Mascot) =>
  !!S.dev?.wake || S.out || (S.night - 1) * 6 + S.t / F.HOUR + (S.players.length - 1) * WAKE[m.i][1] >= WAKE[m.i][0] || (m.i === 2 && S.players.some(inDucts));

// Events with nothing to say take no x, and the rest must give theirs. The entry always has the key x, as it always
// has, even when it is undefined.
function emit<K extends EventType>(S: LobbyState, type: K, ...[x]: EventData[K] extends undefined ? [] : [x: EventData[K]]): void {
  S.evs.push({ id: ++S.evId, type, x } as SimEvent);
  if (S.evs.length > 10) S.evs.shift();
}

/* ---------- the night ---------- */

// How the night's battery spots are shuffled. 'sort' is the game's: a sort with a random comparator. 'fisher-yates'
// is the Roblox port's, which the recorder for tools/roblox/diff asks for so the two draw alike.
export type Shuffle = 'sort' | 'fisher-yates';

export interface SimOptions {
  rng: Rng; // every random draw the night makes
  now: number; // milliseconds on the caller's clock, as performance.now() gives: the start of the first step
  shuffle?: Shuffle; // 'sort' unless given
}

// What only the host knows: the guards in the room and the mascots' thinking. The caller makes one with newSim() and
// passes it, with S, to every call below. Nothing else in the package keeps state about a night.
export interface Sim {
  rng: Rng; // the caller may swap it between calls
  shuffle: Shuffle;
  players: Record<string, Player>; // peer id -> that guard's record, the same object as their entry in S.players
  // What each mascot is thinking, by MASC index. Host only: guests get the result (m.st, m.x, m.z, m.yaw).
  brains: Brain[];
  batTimers: number[]; // seconds until a taken battery turns up somewhere else
  crankNoise: number; // seconds until the turning crank is heard again
  nextFault: number; // seconds until the next fault breaks out
  lastStep: number; // the `now` of the last stepFloor or adoptFloor, or of newSim
}

export function newSim(opts: SimOptions): Sim {
  return { rng: opts.rng, shuffle: opts.shuffle ?? 'sort', players: {}, brains: [], batTimers: [], crankNoise: 0, nextFault: 0, lastStep: opts.now };
}

// The balance harness reads what a mascot is after. Nothing in the game does.
export const brainOf = (sim: Sim, i: number): Brain => sim.brains[i];

// What the end screens count: faults fixed and faults left to burn as numbers, flats as [guard, mascot index], peels as the peeler's name.
// S.tally is this night's, S.total the whole run's.
const newTally = (): Tally => ({ fixed: 0, burnt: 0, flats: [], peels: [] });
const count = (S: NightState, key: 'fixed' | 'burnt', n: number) => {
  for (const t of [S.tally, S.total as Tally]) t[key] += n;
};
function record(S: NightState, key: 'flats', entry: [string, number]): void;
function record(S: NightState, key: 'peels', entry: string): void;
function record(S: NightState, key: 'flats' | 'peels', entry: [string, number] | string): void {
  for (const t of [S.tally, S.total as Tally]) (t[key] as unknown[]).push(entry);
}

const guards = (sim: Sim) => Object.values(sim.players);
const standing = (S: NightState) => S.players.filter(p => !p.flat);
// The guards a mascot could see, light, hear or walk into: standing and not in a locker.
const outside = (S: NightState) => S.players.filter(p => !p.flat && !hidden(p));

function placeGuard(p: Player, i: number) {
  Object.assign(p, spawnPoint(i), {
    pitch: 0,
    on: false,
    ph: false,
    bat: 1,
    flat: false,
    flatBy: -1,
    sp: false,
    act: '',
    safe: 0,
    callAt: 0,
    hid: -1,
    toy: true,
  });
}

// A room's state before its first night. evs is the event list (emit); deaths and slams count the whole run.
export function newState(code: string): State {
  return { phase: 'lobby', night: 1, t: 0, power: 100, doors: OPEN(), m: [], players: [], killer: -1, evs: [], evId: 0, deaths: 0, slams: 0, code };
}

// Start night n: the guards in sim.players on their spawn points, the mascots on their marks.
export function startFloorNight(sim: Sim, state: State, n: number): void {
  const S = state as NightState;
  Object.assign(S, {
    phase: 'play',
    night: n,
    t: 0,
    power: 100,
    cap: 100,
    out: false,
    restart: 0,
    stir: false,
    doors: OPEN(),
    killer: -1,
    crank: false,
    round: -1,
  });
  S.m = MASC.map((d, i) => ({ i, x: REST[i].x, z: REST[i].z, yaw: REST[i].yaw, st: 'rest', rot: 0, lit: false, ire: 0 }));
  // Nothing moves for the first half minute of night 1, and a quarter minute after that.
  // S.waveAt is when the mascots next stir or settle, on S.t, kept in S so a guest who takes over as host has it.
  const quiet = n === 1 ? 34 : Math.max(12, 26 - n * 3);
  S.waveAt = quiet + rnd(sim, 0, 6);
  sim.brains = MASC.map((d, i) => ({
    path: [],
    repath: 0,
    dest: null,
    tgt: null,
    last: null,
    lost: 0,
    timer: rnd(sim, 0, 8),
    bangs: 0,
    cool: 0,
    dir: null,
    stuck: 0,
    key: null,
    home: false,
    spent: false,
    woke: false,
    notice: 0,
    wind: 0,
    stared: 0,
    reach: null,
    knows: -1,
    sniff: 0,
    checks: [],
  }));
  // One entry per breaker box: null, or the fault in it: { k: kind (index into F.FIX), at: when it broke out, burnt:
  // whether it has started on the ceiling }. Any guard can fix any fault. (Faults given to one guard each were tried
  // in the balance harness: alone it made no difference, and crews of two to six won a third to half as often,
  // crossing the building past each other instead of each taking the nearest.)
  S.faults = BOXES.map(() => null);
  sim.nextFault = FAULT.first + (n === 1 ? 6 : 0) + rnd(sim, 0, 6);
  S.tally = newTally();
  S.total ||= newTally();
  const all = guards(sim);
  all.forEach(placeGuard);
  S.players = all as Guard[];
  // The game sorts with a random comparator, so V8 decides how many draws that takes. The Roblox port shuffles them
  // Fisher-Yates, and the recorder for tools/roblox/diff asks for that so the two draw alike.
  const spots = BATTERY_SPOTS.map((_, i) => i);
  if (sim.shuffle === 'sort') spots.sort(() => sim.rng() - 0.5);
  else
    for (let i = spots.length - 1; i > 0; i--) {
      const j = (sim.rng() * (i + 1)) | 0;
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
  S.batN = Math.min(spots.length, 3 + all.length); // the night's batteries, lying about or due back
  S.bats = spots.slice(0, S.batN);
  // The Mini Biggses thrown and not picked up again: { id, by, x0, z0: where it left the hand, x, z: where it lands,
  // at: when it was thrown, land: when it lands, heard: whether it has sung }.
  S.toys = [];
  S.toyId = 0;
  sim.batTimers = [];
  sim.crankNoise = 0;
}

// A guest taking over from a host who left has S but none of the host's thinking, so make it up from S.
// Each mascot keeps its place and state, except the ones that need what the old host knew (a charge's
// heading, a besieged door): those look round where they stand. One on a hunt goes after the nearest guard.
// What is lost errs toward the crew: Tank waits out a full gap before it charges, and one standing where it
// stands stays put as long as one that has given up would. now: as for stepFloor.
export function adoptFloor(sim: Sim, state: State, now: number): void {
  const S = state as NightState,
    up = standing(S),
    h = heat(S);
  sim.lastStep = now;
  sim.brains = S.m.map(m => {
    const b: Brain = {
      path: [],
      repath: 0,
      dest: null,
      tgt: null,
      last: { x: m.x, z: m.z },
      lost: 0,
      timer: rnd(sim, 0, 8),
      bangs: 0,
      cool: m.i === 3 ? CHARGE_GAP : 0,
      dir: null,
      stuck: 0,
      key: null,
      home: false,
      spent: false,
      woke: m.st !== 'rest',
      notice: 0,
      wind: 0,
      stared: 0,
      reach: null,
      knows: -1,
      sniff: 0,
      checks: [],
    };
    if (m.st === 'rest') b.timer = rnd(sim, ...SPENT) * (1 - 0.5 * h);
    const prey = up.reduce<Guard | null>((a, p) => (!a || dist(m, p) < dist(m, a) ? p : a), null);
    if (m.st === 'hunt' && prey) Object.assign(b, { tgt: prey.id, last: { x: prey.x, z: prey.z }, wind: (WIND[0] + WIND[1] * S.night) * (m.i ? 1 : 1.5) });
    else if (['hunt', 'windup', 'charge', 'siege'].includes(m.st)) {
      m.st = 'search';
      b.timer = rnd(sim, 3, 6);
    } else if (m.st === 'feast' || m.st === 'stun') b.timer = rnd(sim, 1, 3);
    return b;
  });
  // Batteries taken are back in 30 to 50 s. How long ago these went is lost, so they come back any time in that.
  // A host from before S.batN and S.waveAt existed did not send them, so guess those from the crew and the wave.
  const missing = (state.batN ?? Math.min(BATTERY_SPOTS.length, 3 + S.players.length)) - (state.bats || []).length;
  sim.batTimers = Array.from({ length: Math.max(0, missing) }, () => rnd(sim, 5, 50)).sort((a, b) => a - b);
  state.waveAt ??= S.t + rnd(sim, 0.2, 1) * (S.stir ? rnd(sim, ...STIR) * (1 + h) : rnd(sim, ...CALM) * (1 - 0.7 * h));
  // A host from before the toys sent none: everyone has theirs in hand.
  state.toys ||= [];
  state.toyId ||= 0;
  for (const p of state.players) p.toy ??= true;
  // When the next fault was due is lost too, so it comes any time in a usual gap.
  sim.nextFault = faultGap(S) * rnd(sim, 0.2, 1);
  sim.crankNoise = 0;
}

// Back to night 1 with the run's counts cleared.
export function restartFloor(sim: Sim, S: State): void {
  Object.assign(S, { deaths: 0, slams: 0, flats: 0, total: null });
  startFloorNight(sim, S, 1);
}

// Is a room dark: lights out with the power, or a fault in it left long enough.
export const darkRoom = (S: NightState, room: number): boolean => S.out || S.faults.some((f, i) => f && BOXES[i].room === room && S.t - f.at > FAULT.dark);
// Seconds left before a fault starts burning ceiling, and how much it leaks now (percent a second).
export const faultLeft = (S: NightState, f: { at: number }): number => FAULT.scar - (S.t - f.at);
const crewRate = (S: NightState) => 1 + FAULT.crew * (Math.max(1, S.players.length) - 1),
  crewShare = (S: NightState) => 1 / Math.max(1, S.players.length);
const leakOf = (S: NightState, f: { at: number }) => (FAULT.leak[0] + (FAULT.leak[1] - FAULT.leak[0]) * Math.min(1, (S.t - f.at) / FAULT.ripen)) * crewShare(S);

// A fault breaks out in a box nobody is standing at; or, from a bang, in the box by that door.
function breakOut(sim: Sim, S: NightState, at?: number) {
  let i = at;
  if (i == null || S.faults[i]) {
    const free = BOXES.map((_, j) => j).filter(j => !S.faults[j]);
    if (!free.length) return;
    const far = free.filter(j => !standing(S).some(p => dist(p, BOXES[j]) < 4));
    i = pick(sim, far.length ? far : free);
  }
  S.faults[i] = { k: (sim.rng() * F.FIX.length) | 0, at: S.t, burnt: false };
  emit(S, 'fault', { i, x: BOXES[i].x, z: BOXES[i].z });
}
// More faults later in the night and on later nights, and one stream for each guard.
const faultGap = (S: NightState) => FAULT.every / (1 + 0.04 * late(S) + (0.03 * S.t) / F.HOUR) / crewRate(S);
function stepFaults(sim: Sim, S: NightState, dt: number) {
  if ((sim.nextFault -= dt) <= 0) {
    breakOut(sim, S);
    sim.nextFault = faultGap(S) * rnd(sim, 0.7, 1.3);
  }
  for (const f of S.faults)
    if (f && !f.burnt && faultLeft(S, f) <= 0) {
      f.burnt = true;
      count(S, 'burnt', 1);
      emit(S, 'burn');
    }
}

function drainPower(S: NightState, dt: number) {
  const shut = DOORS.filter(k => S.doors[k]).length;
  const near = (p: Guard, thing: Point) => !p.flat && dist(p, thing) < F.REACH;
  const charging = S.out ? [] : S.players.filter(p => p.act === 'charge' && near(p, CHARGER) && p.bat < 1);
  // One handle: a second guard at the generator adds nothing.
  S.crank = S.players.some(p => p.act === 'crank' && near(p, GENERATOR));
  for (const p of charging) p.bat = Math.min(1, p.bat + F.CHARGE * dt);
  // Shorts compound: each open fault past one, and one more for every two guards past the first, makes all of them
  // leak and burn FAULT.pile more, so a crew that keeps on top of them pays little and one that lets them pile up
  // (one guard doing the rounds for three who stay in, say) pays a lot.
  const open = S.faults.filter(Boolean).length,
    pile = 1 + FAULT.pile * Math.max(0, open - 1 - Math.floor((S.players.length - 1) / 2));
  const leaks = S.faults.reduce((sum, f) => sum + (f ? leakOf(S, f) : 0), 0) * pile;
  // A fault left too long burns out ceiling, power or no power.
  const burning = S.faults.filter(f => f?.burnt).length;
  if (burning) {
    S.cap = Math.max(0, S.cap - FAULT.cap * burning * pile * crewShare(S) * dt);
    S.power = Math.min(S.power, S.cap);
  }
  if (S.dev?.power) {
    S.power = S.cap = 100;
    S.out = false;
  }
  if (S.out) {
    // Dead until the crank has put F.RESTART back in. S.power reads 0 the whole time; S.restart is how far along it is.
    // Open faults leak what the crank puts in, so a building full of them will not come back until they are fixed.
    S.power = 0;
    const net = (S.crank ? CRANK : 0) - leaks * FAULT.outLeak;
    S.restart = Math.max(0, S.restart + (net * dt) / F.RESTART);
    if (S.crank && S.cap >= F.RESTART && S.restart >= 1) {
      S.out = false;
      S.power = F.RESTART;
      emit(S, 'on');
    }
  } else {
    // A bigger crew has more torches to charge from the same supply, so each draws less: two guards' worth at most.
    const drain =
      (DRAIN.base + DRAIN.lights + DRAIN.door * shut + (DRAIN.charge * charging.length * 2) / (S.players.length + 1)) * (1 + WEAR * late(S)) + leaks;
    // A bang on a door can take the last of it between ticks, crank turning or not.
    if (S.power > 0) S.power = Math.max(0, Math.min(S.cap, S.power + ((S.crank ? CRANK : 0) - drain) * dt));
    if (S.power <= 0) {
      S.out = true;
      S.restart = 0;
      S.doors = OPEN();
      emit(S, 'out');
    }
  }
  for (const p of S.players) {
    const draw = (p.on ? 1 : 0) + (p.ph ? F.PHONE : 0);
    if (draw) {
      p.bat = Math.max(0, p.bat - (draw * dt) / F.BAT_LIFE);
      if (p.bat <= 0) p.on = p.ph = false;
    }
  }
}

function respawnBatteries(sim: Sim, S: NightState, dt: number) {
  sim.batTimers = sim.batTimers.map(t => t - dt);
  while (sim.batTimers.length && sim.batTimers[0] <= 0) {
    sim.batTimers.shift();
    const free = BATTERY_SPOTS.map((_, i) => i).filter(i => !S.bats.includes(i) && !S.players.some(p => dist(p, BATTERY_SPOTS[i]) < 8));
    if (free.length) S.bats.push(pick(sim, free));
    else sim.batTimers.push(5);
  }
}

// The mascots stir, then settle, then stir again. With the power out they do not settle.
function turnWave(sim: Sim, S: NightState) {
  if (S.out) {
    if (!S.stir) {
      S.stir = true;
      emit(S, 'stir');
    }
    S.waveAt = S.t;
    return;
  }
  if (S.t < S.waveAt) return;
  S.stir = !S.stir;
  const h = heat(S);
  S.waveAt = S.t + (S.stir ? rnd(sim, ...STIR) * (1 + h) : rnd(sim, ...CALM) * (1 - 0.7 * h));
  emit(S, S.stir ? 'stir' : 'calm');
}

/* ---------- mascots ---------- */

// Is this guard's torch on this mascot?
function beamOn(S: NightState, p: Guard, m: Mascot) {
  if (!p.on || p.bat <= 0 || p.flat || p.ph || p.act === 'fix' || Math.abs(p.pitch) > 0.7) return false;
  const d = dist(p, m);
  if (d > F.BEAM_RANGE) return false;
  // Close up the beam is wider than the thing in it.
  const half = F.BEAM_HALF + Math.atan2(0.6, Math.max(d, 0.5));
  return Math.abs(angDiff(Math.atan2(m.x - p.x, m.z - p.z), p.yaw)) < half && sees(p.x, p.z, m.x, m.z, S.doors);
}
// Is the guard looking its way at all? Madame Flan cares.
const watchedBy = (S: NightState, p: Guard, m: Mascot) =>
  !p.flat && Math.abs(angDiff(Math.atan2(m.x - p.x, m.z - p.z), p.yaw)) < 0.9 && dist(p, m) < 20 && sees(p.x, p.z, m.x, m.z, S.doors);

function canSee(S: NightState, m: Mascot, p: Guard) {
  const d = dist(m, p);
  // A lit torch shows from across a hall. With the building dark and yours off, it has to be close.
  const range = p.on ? 17 : !darkRoom(S, roomAt(p.x, p.z)) ? 12 : 5;
  if (d > range) return false;
  if (d > 2.5 && Math.abs(angDiff(Math.atan2(p.x - m.x, p.z - m.z), m.yaw)) > 1.2) return false;
  return sees(m.x, m.z, p.x, p.z, S.doors);
}

// Something made a sound here. Mascots that are out, not on their way home and not already after someone may come and look.
function noise(sim: Sim, S: NightState, x: number, z: number, radius: number, chance: number) {
  S.m.forEach((m, i) => {
    const b = sim.brains[i];
    if (!['roam', 'search'].includes(m.st) || b.home || Math.hypot(m.x - x, m.z - z) > radius || sim.rng() > chance) return;
    m.st = 'search';
    b.last = { x, z };
    b.timer = rnd(sim, 3, 6);
    b.repath = 0;
  });
}

// Where a thrown thing comes down: along `yaw` from (x, z), as far as d, but short of a wall or a shut door. It goes
// over the furniture, not onto it: one that would come down on a table drops back toward the thrower.
export function landing(S: State, x: number, z: number, yaw: number, d: number): Point {
  const sx = Math.sin(yaw),
    sz = Math.cos(yaw),
    step = 0.25;
  let k = 0;
  while (k + step <= d && walkable(x + sx * (k + step), z + sz * (k + step), 0.1, S.doors, true)) k += step;
  while (k > 0 && !walkable(x + sx * k, z + sz * k, 0.1, S.doors)) k -= step;
  return { x: x + sx * k, z: z + sz * k };
}

// A thrown Mini Biggs that has just come down sings where it lands, and whatever hears it comes to look.
function landToys(sim: Sim, S: NightState) {
  for (const s of S.toys)
    if (!s.heard && S.t >= s.land) {
      s.heard = true;
      emit(S, 'toy', { by: s.by, x: s.x, z: s.z });
      noise(sim, S, s.x, s.z, TOY.hear, TOY.chance);
    }
}

// Where to walk next.
function pickDest(sim: Sim, S: NightState, m: Mascot): Point {
  const up = outside(S);
  let room: number | undefined;
  // In the dark they do not wander. They come to where you are, and a locker does not hide that: they stand at its
  // doors until they open them (openLockers). Sitting out the night in one ends in the dark.
  if (S.out && standing(S).length) {
    const p = pick(sim, standing(S));
    return hidden(p) ? { ...HIDES[p.hid].at } : { x: p.x, z: p.z };
  }
  if (up.length) {
    // Squish goes for whoever is sitting in the booth, by the vent if it is open.
    if (m.i === 2 && up.some(p => roomAt(p.x, p.z) === BOOTH) && sim.rng() < 0.6) room = BOOTH;
    else if (S.crank && sim.rng() < 0.5) room = GENERATOR.room;
    else if (sim.rng() < 0.25 + 0.5 * heat(S)) {
      const p = pick(sim, up);
      room = roomAt(p.x, p.z);
    }
  }
  if (room == null || room < 0 || (room === DUCTS && m.i !== 2)) {
    const rooms = ROOMS3.map((_, i) => i).filter(i => i !== BOOTH && (i !== DUCTS || m.i === 2) && i !== roomAt(m.x, m.z));
    room = pick(sim, rooms);
  }
  const [x0, z0, x1, z1] = pick(sim, ROOMS3[room].rects);
  for (let tries = 0; tries < 8; tries++) {
    const x = rnd(sim, x0 + 1, x1 - 1),
      z = rnd(sim, z0 + 1, z1 - 1);
    if (walkable(x, z, MASCOT_R + 0.2)) return { x, z };
  }
  return roomCentre(room);
}

const turn = (m: Mascot, to: number, rate: number) => {
  m.yaw += Math.max(-rate, Math.min(rate, angDiff(to, m.yaw)));
};

// Walk toward a goal by the open route. Returns 'there', 'blocked' (a shut door
// is in the way), 'nowhere' (there is no way to it at all), 'jammed' (wedged on
// furniture short of it) or 'going'.
type Going = 'there' | 'blocked' | 'nowhere' | 'jammed' | 'going';
function goTo(S: NightState, m: Mascot, b: Brain, goal: Point, speed: number, dt: number, eager: boolean): Going {
  b.repath -= dt;
  // Close enough. (Asking for a route from here can lead away and back, when the goal is no place for a mascot.)
  if (dist(m, goal) < 0.6) {
    b.path = [];
    return 'there';
  }
  if (b.repath <= 0 || !b.path.length) {
    const r = route(m.x, m.z, goal.x, goal.z, { doors: S.doors, ducts: m.i === 2 });
    b.path = r.path;
    b.key = r.blocked || null;
    b.repath = eager ? 0.35 : 1.5;
    if (!r.path.length && !r.blocked) return 'nowhere';
    // The last few metres to a guard tucked somewhere a mascot does not fit: straight at them, not back to the
    // nearest waypoint every time it asks again. Whatever stops it short, it reaches over (see tucked). Not straight
    // after that line jammed it: a gap a guard fits through and it does not would hold it there for good.
    if (eager && r.path.length > 1 && !r.blocked && dist(m, goal) < 4 && !((b.noShort as number) > S.t) && clear(m.x, m.z, goal.x, goal.z, PLAYER_R, S.doors))
      b.path = [goal];
  }
  // Near enough a waypoint counts as there, but only if the way on is clear from here: a prop can stand close
  // beside the line between two waypoints. The last leg is to wherever the guard is, which may be no place for a
  // mascot, so it only has to be clear for a guard; and standing on the waypoint counts whatever is ahead.
  const onward = () => clear(m.x, m.z, b.path[1].x, b.path[1].z, b.path.length === 2 ? PLAYER_R : MASCOT_R, S.doors);
  while (b.path.length && dist(m, b.path[0]) < 0.6 && (b.path.length === 1 || dist(m, b.path[0]) < 0.1 || onward())) b.path.shift();
  const next = b.path[0];
  if (!next) return b.key ? 'blocked' : 'there';
  const dx = next.x - m.x,
    dz = next.z - m.z,
    d = Math.hypot(dx, dz),
    stepLen = Math.min(d, speed * dt);
  turn(m, Math.atan2(dx, dz), 7 * dt);
  // Getting nowhere is sliding along something without getting nearer, as well as not moving at all.
  if (stepLen > 0 && (slide(m, (dx / d) * stepLen, (dz / d) * stepLen, MASCOT_R, S.doors) < 0.3 || d - dist(m, next) < stepLen * 0.3)) {
    b.stuck += dt;
    // Wedged on a prop: this is as near as it gets to a goal it cannot stand on.
    if (b.stuck > 0.8) {
      b.stuck = 0;
      b.repath = 0;
      if (b.path.length === 1) b.noShort = S.t + 3;
      b.path = [];
      return 'jammed';
    }
  } else b.stuck = 0;
  return 'going';
}

function flatten(S: NightState, p: Guard, m: Mascot, b: Brain) {
  if (S.dev?.god) return;
  Object.assign(p, { flat: true, on: false, ph: false, flatBy: m.i, act: '', hid: -1 });
  S.flats = (S.flats || 0) + 1;
  record(S, 'flats', [p.name, m.i]);
  emit(S, 'flat', { id: p.id, by: m.i, x: p.x, z: p.z });
  p.bat *= FLAT_BAT;
  // It sits on what it caught, then stays and looks round for whoever comes to peel them up.
  m.st = 'feast';
  b.timer = FEAST;
  b.tgt = null;
  b.path = [];
  b.last = { x: p.x, z: p.z };
  if (!standing(S).length) endNight(S, m.i);
}
function endNight(S: NightState, by: number) {
  S.phase = 'dead';
  S.killer = by;
  S.deaths++;
  emit(S, 'scare');
}

// Touching is being within F.CATCH with no wall between: a table between does not save anyone.
function catchGuards(S: NightState, m: Mascot, b: Brain) {
  for (const p of outside(S))
    if (S.t >= p.safe && dist(m, p) < F.CATCH && reaches(m.x, m.z, p.x, p.z, S.doors)) {
      flatten(S, p, m, b);
      return true;
    }
  return false;
}

// It has seen this guard. The first time, it stops and stares before it comes.
function spot(S: NightState, m: Mascot, b: Brain, p: Guard) {
  if (m.st !== 'hunt') {
    emit(S, 'spot', { i: m.i, id: p.id, x: m.x, z: m.z });
    b.notice = NOTICE;
    b.repath = 0;
    b.home = false;
    b.wind = (WIND[0] + WIND[1] * S.night) * (m.i ? 1 : 1.5);
  }
  m.st = 'hunt';
  b.tgt = p.id;
  b.last = { x: p.x, z: p.z };
  b.lost = 0;
}

// It stands outside an occupied locker: one that knows who is in there opens it at once, any other after SNIFF.time.
function openLockers(S: NightState, m: Mascot, b: Brain, dt: number) {
  const p = standing(S).find(
    q => hidden(q) && S.t >= q.safe && dist(m, HIDES[q.hid].at) < SNIFF.near && reaches(m.x, m.z, HIDES[q.hid].at.x, HIDES[q.hid].at.z, S.doors)
  );
  if (!p) {
    b.sniff = Math.max(0, b.sniff - dt);
    return false;
  }
  const h = HIDES[p.hid];
  turn(m, Math.atan2(h.x - m.x, h.z - m.z), 4 * dt);
  if (b.knows !== p.hid && (b.sniff += dt) < SNIFF.time) return false;
  emit(S, 'found', { i: m.i, id: p.id, h: p.hid, x: h.x, z: h.z });
  b.knows = -1;
  b.sniff = 0;
  flatten(S, p, m, b);
  return true;
}

// The lockers a mascot looks in after losing a guard near here (CHECK).
function lockersNear(sim: Sim, at: Point | null) {
  if (!at) return [];
  return HIDES.map((h, i) => ({ i, d: dist(h.at, at) }))
    .filter(c => c.d < CHECK.near && sim.rng() < CHECK.chance)
    .sort((a, b) => a.d - b.d)
    .slice(0, CHECK.most)
    .map(c => c.i);
}

// A guard stepped into a locker. Whatever could see them do it knows where they are; whatever was hunting them and
// still knew where they were (b.lost under its keeping time) does too.
function seenHiding(sim: Sim, S: NightState, p: Guard) {
  S.m.forEach((m, i) => {
    const b = sim.brains[i];
    if (m.st === 'rest' || (b.spent && !S.out) || !b.woke) return;
    const after = COMING.includes(m.st) && b.tgt === p.id && b.lost < (m.i === 0 ? RELENT : 1.2);
    if (!after && !canSee(S, m, p)) return;
    b.knows = p.hid;
    if (m.st === 'roam' || m.st === 'search') {
      m.st = 'search';
      b.last = { ...HIDES[p.hid].at };
      b.timer = rnd(sim, 3, 6);
      b.repath = 0;
      b.since = S.t;
      b.was = 'search';
    }
  });
}

function runMascot(sim: Sim, S: NightState, m: Mascot, b: Brain, dt: number) {
  // Once one is up it is up for the night, even if what woke it (the power going out) is put right.
  if (!(b.woke ||= isActive(S, m))) return;
  m.rot = rot(S, m);
  const up = outside(S);
  // The guard it knew was in a locker has come out (or been pulled out).
  if (b.knows >= 0 && !S.players.some(p => p.hid === b.knows)) b.knows = -1;
  // One standing where it stands is switched off: a torch does nothing to it.
  const lighter = m.st === 'rest' ? null : up.find(p => beamOn(S, p, m));
  m.lit = !!lighter;
  if (lighter) m.ire += dt / GLARE_PER_IRE;
  b.cool -= dt;
  if (m.st !== b.was) {
    // It has just lost the guard it was after: which lockers it will look in.
    b.checks = m.st === 'search' && b.was === 'hunt' ? lockersNear(sim, b.last) : m.st === 'search' ? b.checks : [];
    b.was = m.st;
    b.since = S.t;
  }
  const ductGuest = m.i === 2 ? up.find(p => inDucts(p) && S.t >= p.safe) : null;

  // Standing where it stands. A wave gets it moving, or (Squish) someone in the ducts.
  if (m.st === 'rest') {
    b.timer -= dt;
    if (ductGuest) spot(S, m, b, ductGuest);
    else if (b.timer <= 0 && S.stir && S.m.filter(o => o.st !== 'rest').length < roster(S)) {
      m.st = 'roam';
      b.dest = null;
      b.home = false;
    }
    return;
  }
  // States that run on a timer and ignore everything else.
  if (m.st === 'feast' || m.st === 'stun') {
    b.timer -= dt;
    if (b.timer > 0) return;
    if (m.st === 'feast') {
      m.st = 'search';
      b.timer = rnd(sim, 4, 7);
      b.repath = 0;
    } else {
      m.st = 'roam';
      b.dest = null;
      b.home = false;
    }
    b.path = [];
    return;
  }
  if (m.st === 'windup') {
    // It lines up on its guard, then commits: for the last moment of the wind-up it has stopped turning.
    const tp = S.players.find(p => p.id === b.tgt);
    if (tp && b.timer > WINDUP.commit) turn(m, Math.atan2(tp.x - m.x, tp.z - m.z), 5 * dt);
    b.timer -= dt;
    if (b.timer <= 0) {
      m.st = 'charge';
      b.timer = 2.4;
      b.dir = { x: Math.sin(m.yaw), z: Math.cos(m.yaw) };
    }
    return;
  }
  if (m.st === 'charge') {
    // Tank does not steer and does not stop for a torch.
    const dir = b.dir as Point;
    const got = slide(m, dir.x * SPEED.charge * dt, dir.z * SPEED.charge * dt, MASCOT_R, S.doors);
    if (catchGuards(S, m, b)) return;
    b.timer -= dt;
    if (got < 0.5) {
      m.st = 'stun';
      b.timer = 4;
      b.cool = CHARGE_GAP;
      emit(S, 'crash', { x: m.x, z: m.z });
    } else if (b.timer <= 0) {
      m.st = 'hunt';
      b.cool = CHARGE_GAP;
    }
    return;
  }

  // Who can it see? One that has had its turn is on its way home and looks at nobody, though walking into it still counts.
  let seen: Guard | null = null,
    near = 1e9;
  const looking = !b.spent || S.out;
  if (looking)
    for (const p of up)
      if (S.t >= p.safe && canSee(S, m, p) && dist(m, p) < near) {
        near = dist(m, p);
        seen = p;
      }
  if (!seen && looking && lighter && S.t >= lighter.safe) seen = lighter; // a beam on it gives you away
  // Only so many come for the guards at once. The rest stop and stare, and wait their turn.
  // Squish does not wait for anyone in its ducts.
  let stare = false;
  if (seen && (m.st === 'hunt' || S.m.filter(o => COMING.includes(o.st)).length < pack(S))) {
    near = dist(m, seen);
    spot(S, m, b, seen);
  } else if (ductGuest && looking) {
    seen = ductGuest;
    near = dist(m, seen);
    spot(S, m, b, seen);
  } else if (seen) {
    b.stared += dt;
    if (b.stared < STARE) {
      turn(m, Math.atan2(seen.x - m.x, seen.z - m.z), 3 * dt);
      stare = true;
    }
    seen = null;
  } else b.stared = Math.max(0, b.stared - dt * 2);

  if (m.st === 'siege') {
    const key = b.key as DoorKey;
    const door = DOORWAYS.find(d => d.key === b.key);
    if (door) turn(m, Math.atan2((door.rect[0] + door.rect[2]) / 2 - m.x, (door.rect[1] + door.rect[3]) / 2 - m.z), 5 * dt);
    if (catchGuards(S, m, b)) return;
    if (!S.doors[key]) {
      m.st = b.tgt ? 'hunt' : 'roam';
      b.repath = 0;
      return;
    }
    b.timer -= dt;
    if (b.timer > 0) return;
    emit(S, 'bang', key);
    S.slams++;
    m.ire += BANG_IRE;
    b.bangs++;
    if (sim.rng() < FAULT.bang) breakOut(sim, S, BANG_BOX[key]);
    if (!S.dev?.power) S.power = Math.max(0, S.power - BANG_COST);
    b.timer = rnd(sim, 1.6, 3);
    if (b.bangs >= 3 + (S.night > 2 ? 1 : 0)) {
      m.st = 'roam';
      b.tgt = null;
      b.dest = null;
      b.path = [];
      b.bangs = 0;
      b.timer = 0;
      b.spent = true;
    }
    return;
  }

  // At the doors of a locker it meant to check: it opens them. Whoever is inside is found (openLockers, below).
  const check = m.st === 'search' && b.checks.length ? HIDES[b.checks[0]] : null;
  if (check && dist(m, check.at) < SNIFF.near) {
    const i = b.checks.shift() as number;
    if (S.players.some(p => p.hid === i && !p.flat)) b.knows = i;
    else {
      emit(S, 'check', { i: m.i, h: i, x: check.x, z: check.z });
      b.timer = Math.max(b.timer, 1.5);
    }
  }
  if (looking && openLockers(S, m, b, dt)) return;

  // Out of puff: it has had its turn.
  if (m.st === 'hunt' && !S.out && b.notice <= 0 && (b.wind -= dt) <= 0) {
    m.st = 'roam';
    b.tgt = null;
    b.dest = null;
    b.spent = true;
    emit(S, 'quit', { i: m.i, x: m.x, z: m.z });
  } else if (!seen && m.st === 'hunt') {
    const tp = S.players.find(p => p.id === b.tgt),
      keeps = m.i === 0 ? RELENT : 1.2;
    b.lost += dt;
    // It saw them get into a locker: straight to its doors.
    if (tp && hidden(tp) && b.knows === tp.hid) {
      b.last = { ...HIDES[tp.hid].at };
      b.lost = 0;
    } else if (tp && !tp.flat && !hidden(tp) && b.lost < keeps) b.last = { x: tp.x, z: tp.z }; // it knows which way you went round the corner
    if (!tp || tp.flat || b.lost > keeps + 3) {
      m.st = 'search';
      b.timer = rnd(sim, 4, 7);
    }
  } else if (!seen) {
    const loud = !b.home && up.find(p => p.sp && dist(m, p) < 9);
    if (loud) {
      m.st = 'search';
      b.last = { x: loud.x, z: loud.z };
      b.timer = rnd(sim, 3, 6);
    }
  }

  // They are slow on night 1 and quicker every night after, quicker the more ceiling neglected faults have burnt, and quickest in the dark.
  const angry = (KEEN[0] + KEEN[1] * late(S)) * (1 + 0.04 * Math.min(4, (100 - S.cap) / CAP_SCALE)) * (darkRoom(S, roomAt(m.x, m.z)) ? SPEED.dark : 1);
  let speed: number,
    goal: Point,
    eager = false;
  if (m.st === 'hunt') {
    goal = b.last as Point;
    eager = true;
    if (b.notice > 0) {
      b.notice -= dt;
      turn(m, Math.atan2(goal.x - m.x, goal.z - m.z), 5 * dt);
      speed = 0;
    }
    // Tank: with a clear run at you, it winds up and charges.
    else if (m.i === 3 && seen && b.cool <= 0 && near > 6 && near < 16 && clear(m.x, m.z, seen.x, seen.z, MASCOT_R, S.doors)) {
      m.st = 'windup';
      b.timer = WINDUP.time;
      emit(S, 'roar', { i: m.i, x: m.x, z: m.z });
      return;
    } else {
      speed = SPEED.hunt[m.i] * angry;
      if (m.i === 1 && !up.some(p => watchedBy(S, p, m))) speed = SPEED.unwatched * angry;
      if (m.i === 2 && roomAt(m.x, m.z) === DUCTS) speed *= SPEED.ducts;
    }
  } else if (m.st === 'search' && S.t - (b.since as number) > SEARCH_MAX) {
    m.st = 'roam';
    b.dest = null;
    return;
  } else if (m.st === 'search') {
    speed = SPEED.search * angry;
    goal = b.checks.length ? HIDES[b.checks[0]].at : (b.last as Point);
  } else {
    // Between waves they walk back to where they stand. So does one that has run out of puff or been
    // turned away at a door, and it stays there a while. With the power out nothing goes home.
    const settle = (!S.stir || b.spent) && !S.out;
    if (settle !== b.home) {
      b.home = settle;
      b.dest = settle ? REST[m.i] : null;
      b.repath = 0;
    }
    if (b.home && dist(m, REST[m.i]) < 1.5) {
      m.st = 'rest';
      b.timer = b.spent ? rnd(sim, ...SPENT) * (1 - 0.5 * heat(S)) : rnd(sim, 0, 8);
      b.spent = false;
      b.path = [];
      return;
    }
    if (!b.dest) {
      b.dest = pickDest(sim, S, m);
      b.repath = 0;
    }
    speed = SPEED.roam;
    goal = b.dest;
  }
  if (S.out) speed *= SPEED.out;
  if (m.lit) speed *= LIT_SPEED[m.rot];
  if (stare) speed = 0;
  if (m.lit && lighter) turn(m, Math.atan2(lighter.x - m.x, lighter.z - m.z), 4 * dt); // it turns to face the light

  const res = speed > 0 ? goTo(S, m, b, goal, speed, dt, eager) : 'going';
  if (catchGuards(S, m, b)) return;
  // Free to move, within arm's reach of a guard who is staying put, and getting no nearer however it tries: they
  // are tucked in behind the furniture. It reaches in. (A mascot wedged on a prop can rock back and forth a metre
  // looking for a way round, so this goes by the gap between them, not by whether it has moved.)
  const tucked = m.st === 'hunt' && speed > 0 && seen && near < F.GRAB && reaches(m.x, m.z, seen.x, seen.z, S.doors);
  const r = b.reach;
  // seen is set whenever tucked is.
  const them = seen as Guard;
  if (!tucked || !r || r.id !== them.id || near < r.d - 0.3 || dist(them, r) > 0.5)
    b.reach = tucked ? { id: them.id, d: near, x: them.x, z: them.z, t: S.t } : null;
  else if (S.t - r.t > GRAB_TIME) {
    flatten(S, them, m, b);
    return;
  }
  if (res === 'blocked') {
    m.st = 'siege';
    b.timer = 1.2;
    b.bangs = 0;
    emit(S, 'arrive', b.key as DoorKey);
    return;
  }
  if (res === 'nowhere') {
    m.st = 'roam';
    b.tgt = null;
    b.dest = b.home ? REST[m.i] : null;
    return;
  }
  // Wedged short of somewhere it was only looking: look somewhere else.
  if (res === 'jammed' && !seen) {
    if (m.st === 'hunt') {
      m.st = 'search';
      b.timer = rnd(sim, 3, 5);
      b.last = { x: m.x, z: m.z };
    } else if (m.st === 'search' && b.checks.length) b.checks.shift();
    else if (m.st === 'search') {
      m.st = 'roam';
      b.dest = null;
    } else if (!b.home) b.dest = null;
    return;
  }
  if (res === 'there') {
    if (m.st === 'roam') {
      b.timer -= dt;
      if (b.timer <= 0) {
        b.dest = null;
        b.timer = rnd(sim, 2, 7);
      }
    } else if (m.st === 'search') {
      m.yaw += dt * 1.5;
      b.timer -= dt;
      if (b.timer <= 0) {
        m.st = 'roam';
        b.dest = null;
        b.timer = rnd(sim, 1, 3);
      }
    } else if (m.st === 'hunt' && !seen) {
      m.st = 'search';
      b.timer = rnd(sim, 3, 5);
    }
  }
}

/* ---------- the tick ---------- */

// One tick, of however long it has been since the last (at most a quarter second). now: milliseconds on the
// caller's clock, as performance.now() gives.
export function stepFloor(sim: Sim, state: State, now: number): void {
  const S = state as NightState;
  const dt = Math.min(0.25, (now - sim.lastStep) / 1000) * (S.dev?.speed || 1);
  sim.lastStep = now;
  S.players = guards(sim) as Guard[];
  if (S.phase !== 'play') return;
  (S.players as Player[]).forEach((p, i) => {
    if (p.x == null) placeGuard(p, i);
  }); // joined after the night began
  // The last guard standing left the room: the ones on the floor are not getting up.
  if (S.players.length && !standing(S).length) {
    endNight(S, S.players[0].flatBy);
    return;
  }
  S.t += dt;
  const hour = Math.floor(S.t / F.HOUR);
  if (hour > S.round) {
    if (S.round >= 0) emit(S, 'hour');
    S.round = hour;
    if (hour >= 6) {
      S.phase = S.night >= FINAL_NIGHT ? 'won' : 'win';
      emit(S, 'win');
      return;
    }
  }
  stepFaults(sim, S, dt);
  drainPower(S, dt);
  respawnBatteries(sim, S, dt);
  turnWave(sim, S);
  if (S.crank && (sim.crankNoise -= dt) <= 0) {
    sim.crankNoise = 2;
    noise(sim, S, GENERATOR.x, GENERATOR.z, 24, 0.35);
  }
  landToys(sim, S);
  if (S.dev?.freeze) return;
  for (let i = 0; i < S.m.length && S.phase === 'play'; i++) runMascot(sim, S, S.m[i], sim.brains[i], dt);
}

// A field off the wire: a finite number, clamped, or the fallback.
const num = (v: unknown, lo: number, hi: number, fallback: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v as number)) : fallback);

// One guard's action, from their own browser or sent over the wire (net.js). a is someone else's JSON, so every field
// it reads is checked here; the casts below only tell TypeScript what those checks found.
export function actFloor(sim: Sim, state: State, pid: string, a: Action): void {
  const S = state as NightState,
    who = sim.players[pid];
  if (!who) return;
  if (a.t === 'name') {
    who.name = String(a.n || 'Guard').slice(0, 12);
    return;
  }
  if (S.phase !== 'play' || who.x == null) return;
  const p = who as Guard;
  if (a.t === 'p') {
    // The guard's own browser moves them; the host only refuses a position inside a wall or a shut door.
    // In a locker they stay where they stepped in, with the torch off.
    if (hidden(p)) {
      p.yaw = num(a.yaw, -1e3, 1e3, p.yaw);
      p.pitch = num(a.pitch, -1.6, 1.6, p.pitch);
      p.on = p.sp = false;
      p.act = '';
      p.ph = !!a.ph && p.bat > 0;
      return;
    }
    if (!p.flat && Number.isFinite(a.x) && Number.isFinite(a.z) && walkable(a.x, a.z, 0.2, S.doors)) {
      p.x = a.x;
      p.z = a.z;
    }
    p.yaw = num(a.yaw, -1e3, 1e3, p.yaw);
    p.pitch = num(a.pitch, -1.6, 1.6, p.pitch);
    p.on = !!a.on && p.bat > 0 && !p.flat;
    p.ph = !!a.ph && p.bat > 0 && !p.flat; // the phone up, reading the map
    p.sp = !!a.sp && !p.flat && !p.ph;
    p.act = p.flat ? '' : ['crank', 'charge', 'fix'].includes(a.act) ? a.act : ''; // fix: hands in a breaker box
    return;
  }
  if (a.t === 'call') {
    // A flat guard shouting for help: everyone gets a ping where they lie.
    if (p.flat && S.t >= (p.callAt || 0)) {
      p.callAt = S.t + F.CALL_GAP;
      emit(S, 'call', { id: p.id, x: p.x, z: p.z });
    }
    return;
  }
  if (a.t === 'throw') {
    // Their Mini Biggs, along the way the guard is looking (yaw) and as far as they aimed (d), sung on the torch's
    // battery. Not from a locker, and not on less than it costs.
    if (p.flat || hidden(p) || !p.toy || p.bat < TOY.cost) return;
    const to = landing(S, p.x, p.z, num(a.yaw, -1e3, 1e3, p.yaw), num(a.d, 0, TOY.range, TOY.range));
    p.bat = Math.max(0, p.bat - TOY.cost);
    p.toy = false;
    if (p.bat <= 0) p.on = p.ph = false;
    S.toys.push({ id: ++S.toyId, by: p.id, x0: p.x, z0: p.z, x: to.x, z: to.z, at: S.t, land: S.t + Math.max(0.3, dist(p, to) / TOY.speed), heard: false });
    return;
  }
  if (a.t !== 'use' || p.flat) return;
  // i and k come off the wire unchecked. One that indexes nothing does nothing, but a numeric string such as "0"
  // indexes like the number and is kept as a string (in p.hid and the event), as sim3d.js did. Checking them
  // changes behaviour, so it waits for a later PR.
  const i = a.i as number,
    k = a.k as DoorKey;
  const near = (thing: Point | undefined) => thing && dist(p, thing) < F.REACH;
  if (a.what === 'fix' && S.faults[i] && near(BOXES[i])) {
    S.faults[i] = null;
    count(S, 'fixed', 1);
    emit(S, 'fix', { i, by: p.id, x: BOXES[i].x, z: BOXES[i].z });
    noise(sim, S, p.x, p.z, 16, 0.5); // the clunk of the lights coming back
  } else if (a.what === 'door' && DOORS.includes(k) && lightsF(S) && near(PANELS[k])) {
    // A door will not shut on someone standing in it.
    const d = DOORWAYS.find(d => d.key === k) as Doorway,
      [x0, z0, x1, z1] = d.rect;
    const inWay = (q: Point, r: number) => q.x > x0 - r && q.x < x1 + r && q.z > z0 - r && q.z < z1 + r;
    if (!S.doors[k] && (S.players.some(q => inWay(q, PLAYER_R)) || S.m.some(m => inWay(m, MASCOT_R)))) {
      emit(S, 'fumble', { k, by: p.id });
      return;
    }
    S.doors[k] = !S.doors[k];
    emit(S, 'door', S.doors[k]);
  } else if (a.what === 'bat' && S.bats.includes(i) && near(BATTERY_SPOTS[i]) && p.bat < 1) {
    S.bats = S.bats.filter(j => j !== i);
    sim.batTimers.push(rnd(sim, 30, 50));
    p.bat = Math.min(1, p.bat + F.BAT_PICKUP);
    emit(S, 'bat', { by: p.id });
  } else if (a.what === 'toy' && !p.toy && !hidden(p)) {
    // A Mini Biggs on the floor, anyone's, into empty hands. Not one still in the air.
    const t = S.toys.find(t => t.id === a.id);
    if (!t || S.t < t.land || !near(t)) return;
    S.toys = S.toys.filter(o => o !== t);
    p.toy = true;
    emit(S, 'grab', { by: p.id, x: t.x, z: t.z });
  } else if (a.what === 'hide' && HIDES[i]) {
    const h = HIDES[i];
    if (p.hid === i) {
      p.hid = -1;
      emit(S, 'locker', { i, id: p.id, in: false, x: h.x, z: h.z });
      noise(sim, S, h.at.x, h.at.z, ...LOCKER_NOISE);
    } else if (!hidden(p) && near(h.at) && !S.players.some(q => q.hid === i)) {
      Object.assign(p, { hid: i, x: h.at.x, z: h.at.z, on: false, sp: false, act: '' });
      emit(S, 'locker', { i, id: p.id, in: true, x: h.x, z: h.z });
      seenHiding(sim, S, p);
      noise(sim, S, h.at.x, h.at.z, ...LOCKER_NOISE);
    }
  } else if (a.what === 'peel') {
    const other = S.players.find(q => q.id === a.id);
    if (other?.flat && near(other)) {
      Object.assign(other, { flat: false, flatBy: -1, safe: S.t + 4 });
      record(S, 'peels', p.name);
      emit(S, 'peel', { id: other.id, by: p.id, x: other.x, z: other.z });
    }
  }
}
