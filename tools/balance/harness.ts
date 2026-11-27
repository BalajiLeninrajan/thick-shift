// The balance harness's guards and the nights they play, without the command line (that is floor.ts). The tests in
// packages/sim/test play nights through this too.
//
// The guards only know what a person could: what is in front of them and lit,
// what is close enough to hear, the HUD, the booth's cameras while they stand at
// its desk, and what a flat teammate shouts. They walk with the same route() and
// slide() the game uses, at the game's speeds, and react late.
import {
  actFloor,
  angDiff,
  assert,
  brainOf,
  COMING,
  DOORS,
  darkRoom,
  defined,
  dist,
  F,
  faultLeft,
  isPlaced,
  KEEP,
  landing,
  lightsF,
  MASC,
  MASCOTS,
  newSim,
  newState,
  RELENT,
  STAMINA,
  seeded,
  startFloorNight,
  stepFloor,
  TOY,
} from '../../packages/sim/src/index.ts';
import type { NavLink, NavNode } from '../../packages/sim/src/map.ts';
import * as M from '../../packages/sim/src/map.ts';
import type { Dev, DoorKey, Fault, Guard, GuardAct, MascotIndex, MascotState, NightState, Point, UseWhat } from '../../packages/sim/src/types.ts';

// The sim's clock, in milliseconds: each tick moves it on by DT. It runs on from one night to the next.
let now = 0;
// Every random draw of a night, the guards' and the sim's, comes from this one stream, which seedRandom() seeds at
// the start of each night. The sim reads it through a closure, so it draws from whatever stream is current.
let random = Math.random;
// One sim per thread, made once: like the module state it replaces, it carries the last step's time between nights.
const sim = newSim({ rng: () => random(), now: 0 });

/* ---------- the shapes ---------- */

type Sense = 'see' | 'hear' | 'cams';
// What a guard remembers of a mascot: where it was and what it was doing at t, since when they have known of it
// without a break, and how they knew.
interface Memory extends Point {
  i: MascotIndex;
  st: MascotState;
  rot: number;
  lit: boolean;
  t: number;
  since: number;
  how: Sense;
}
// A place to keep clear of, r metres round.
interface Berth extends Point {
  r: number;
}
// A plan for getting somewhere: the points to walk through, whether every way passes close to something, whether
// anything was known about when it was made, the shut door in the way if there was no other, and when it was made.
interface Way {
  path: Point[];
  risk: boolean;
  calm: boolean;
  blocked: DoorKey | null;
  at: number;
}
// Something to use, and how. at: the thing. stand: where to stand to use it, if not in front of it. hold: seconds to
// hold the key, or -1 for the crank and the dock, which are held for as long as they are wanted. key: tells one use
// from another, so a new one starts its hold again. reach: how close counts, if not F.REACH - 0.3. A door's use
// says which door (k) and which way it should end up (shut); the others say which box, spot or locker (i) or which
// guard or toy (id).
interface UseBase {
  at: Point & { face?: number };
  key: string;
  stand?: Point;
  face?: number;
  reach?: number;
}
type Use = UseBase &
  (
    | { what: 'crank'; hold: -1 }
    | { what: 'charge'; hold: -1 }
    | { what: 'door'; hold: number; k: DoorKey; shut: boolean; i?: never; id?: never }
    | { what: Exclude<UseWhat, 'door'>; hold: number; i?: number; id?: string | number; k?: never; shut?: never }
  );
// What a guard wants to do this tick. dash: a heading to run along without thinking about a route. keep: the booth
// doors that should stay shut.
interface Want {
  on?: boolean;
  goal?: Point | null | undefined;
  face?: number | null;
  use?: Use | null | undefined;
  dash?: number;
  sprint?: boolean;
  keep?: DoorKey[];
  ducts?: boolean;
}
// Where everyone could be and when (race()).
interface Race {
  mine: Float64Array;
  theirs: Float64Array;
  at: number;
}
// What a guard keeps in mind from one tick to the next. Every field starts out missing.
type DoorTimes = { [K in `stuck${DoorKey}`]?: number } & { [K in `clear${DoorKey}`]?: number | null };
interface BotState extends DoorTimes {
  ways?: Map<string, Way>;
  retreat?: number;
  stirred?: boolean;
  stirAt?: number;
  chased?: number | null;
  dodge?: { side: 1 | -1; at: number }; // the side stepped to out of Greg's way, and when
  holed?: number;
  seenAt?: number;
  hideCool?: number;
  race?: Race;
  waitRace?: Race; // the same for the one thing being waited out (honest.think)
  fleeNode?: number;
  drift?: { until: number; to: Point }; // a careless guard wandering off

  cranking?: boolean;
  topUp?: boolean;
  lureAt?: number;
  threwAt?: Each<number>; // when this guard last threw a Mini Biggs at or for each mascot
  hidFor?: number;
  leg?: number;
}
// react: seconds before something perceived is acted on. fov: half-angle of what counts as in front.
// torch: 'always' on outside the booth, 'thrifty' the same but keeps the last of it (reserve) for holding something off.
// toy: throws their Mini Biggs where its song will draw a wanderer or a hunter off their way, while the torch has
// the battery to spare (spare: what has to be left in it after the throw), and straight at one coming that is far
// enough off for a hit to stun it (BONK), or at Greg winding up or charging, on whatever battery is left. Goes back
// to pick it up once nothing is about.
// alert: how near something coming has to be before they do anything about it. beam: seconds away it is when the torch goes on it.
// topsUp: picks up a battery they pass whenever the torch is not full, not only once it is low. crankEarly: how much
// sooner (in power) they start cranking between waves.
interface SkillBase {
  react: number;
  fov: number;
  torch: 'always' | 'thrifty';
  cams: boolean;
  plans: boolean;
  doors: boolean;
  cranks: boolean;
  peelRange: number;
  dodges: boolean;
  alert: number;
  beam: number;
  reserve: number;
  topsUp: boolean;
  crankEarly: number;
}
type Skill = SkillBase & ({ toy: false } | { toy: true; spare: number });
// How a guard plays: their skill, how they think each tick, and what an honest guard leaves out (peels, cranks,
// faults: false), does instead (stays: true, in the booth; hides: true, in lockers) or does less of (share: of the
// faults, as a weight on how far they are).
export interface Policy {
  skill: Skill;
  think(S: NightState, bot: Bot, team: Team): void;
  peels?: boolean;
  cranks?: boolean;
  faults?: boolean;
  stays?: boolean;
  hides?: boolean;
  share?: number;
}
type PolicyOptions = Omit<Policy, 'skill' | 'think'>;
// A guard as the harness plays them: their body, what they know and what they want.
export interface Bot extends Point {
  id: string;
  i: number;
  policy: Policy;
  skill: Skill;
  yaw: number;
  on: boolean;
  sp: boolean;
  act: GuardAct;
  stam: number;
  rested: number;
  hold: number;
  holding: string | null;
  mem: (Memory | undefined)[]; // by MascotIndex
  want: Want;
  state: BotState;
  still: number;
  bat: number;
  flat: boolean;
  pressed?: number;
  called?: number;
  wasDry?: boolean;
  dryAt?: number;
  // For the table: when the guard last could have perceived each mascot, and when that stretch began (null: never).
  firstSeen: Each<number | null>;
  lastSeen: Each<number>;
}
// The guards of one night, and the faults each has (by id).
export interface Team {
  bots: Bot[];
  fault: Map<string, number[]>;
}
// One count or time per mascot, by MascotIndex, that the harness writes to as the night goes.
type Each<T> = [T, T, T, T];
// What an honest guard wants to be doing (objectiveOf). urgent: a teammate on the floor. fault: the fault being gone
// to. home: nothing to do but be in the booth.
interface Objective {
  use?: Use;
  goal?: Point | undefined;
  urgent?: boolean;
  fault?: Fault;
  crank?: boolean;
  home?: boolean;
}

const DT = 0.1;
const ang = (a: Point, b: Point) => Math.atan2(b.x - a.x, b.z - a.z);
// The one of list nearest to p, by where at() puts each, or undefined from an empty list. The first of equals.
const nearestBy = <T>(p: Point, list: readonly T[], at: (v: T) => Point) =>
  list.reduce<T | undefined>((best, v) => (best !== undefined && dist(p, at(best)) <= dist(p, at(v)) ? best : v), undefined);
const nearest = <T extends Point>(p: Point, list: readonly T[]) => nearestBy(p, list, v => v);
const pick = <T>(list: readonly T[]): T => defined(list[(random() * list.length) | 0], 'a pick from an empty list');
const MOVING: MascotState[] = ['roam', 'search', 'hunt', 'charge'];
const BOOTH_MID = { x: 21, z: 40.5 };
// In front of the camera desk, and how long a guard there watches each camera before flipping to the next.
const DESK_STAND = { x: M.DESK.x + Math.sin(M.DESK.face) * 0.9, z: M.DESK.z + Math.cos(M.DESK.face) * 0.9 },
  CAM_DWELL = 1.5;
// A guard's guess at whether a resting mascot wakes this night. Rougher than the sim's rule (WAKE in sim.ts), on
// purpose: Squish sleeps through a solo night 1, and Greg through any night 1.
const mayWake = (S: NightState, i: MascotIndex) => (i === 3 ? S.night > 1 : i !== 2 || S.night + S.players.length > 2);
// How fast a mascot comes with a torch on it, as a share of its pace, by its rot.
const LIT_PACE = [0.05, 0.3, 0.5];
const inBooth = (p: Point) => M.roomAt(p.x, p.z) === M.BOOTH;
const doorMid = (k: DoorKey) => M.rectMid(M.doorwayOf(k).rect);
// Where to stand to work a door's button from outside the booth: the wall is thin enough to reach through.
const OUTSIDE: Record<DoorKey, Point> = { L: { x: 13.9, z: 39.7 }, R: { x: 28.1, z: 39.7 }, V: { x: 23.3, z: 35.5 } };
const front = (t: Point & { face?: number }): Point => (t.face == null ? t : { x: t.x + Math.sin(t.face) * 0.9, z: t.z + Math.cos(t.face) * 0.9 });
// Where a guard stands to work door k's button: in front of it in the booth, or at the wall outside.
const doorStand = (bot: Bot, k: DoorKey) => (inBooth(bot) ? front(M.PANELS[k]) : OUTSIDE[k]);
// Where to stand to use something, and where an objective takes a guard.
const standOf = (u: Use) => u.stand ?? front(u.at);
const targetOf = (o: Objective) => (o.use ? standOf(o.use) : o.goal);
const CHARGE: Use = { what: 'charge', at: M.CHARGER, hold: -1, key: 'charge' };
const CRANK: Use = { what: 'crank', at: M.GENERATOR, hold: -1, key: 'crank' };
// The booth's carton of Mini Biggses, a tap from in front of it.
const CARTON: Use = { what: 'carton', at: M.TOY_BOX, hold: 0.2, key: 'carton' };
const hideUse = (i: number, at: Point): Use => ({ what: 'hide', i, at, stand: at, hold: F.HIDE_HOLD, key: `hide${i}` });
// Breaker box i: S.faults, team.fault and the 'fix' uses all name boxes by their place in M.BOXES.
const box = (i: number) => defined(M.BOXES[i], `box ${i}`);
// A bot's guard as the sim has them. The night places every guard in sim.players when it starts.
function guardOf(bot: Bot): Guard {
  const p = defined(sim.players[bot.id], `guard ${bot.id}`);
  assert(isPlaced(p), `guard ${bot.id} has not been placed`);
  return p;
}

function seedRandom(seed: number): void {
  random = seeded(seed);
}

/* ---------- what a guard can know ---------- */

// 'see', 'hear' or null. Seeing needs it in front of you, in line of sight and lit: by the building, or by your torch.
function sense(S: NightState, bot: Bot, m: Point & { st: MascotState }): Sense | null {
  const d = dist(bot, m),
    off = Math.abs(angDiff(ang(bot, m), bot.yaw));
  const range = !darkRoom(S, M.roomAt(m.x, m.z)) ? 18 : bot.on && off < 0.5 ? 13 : 4;
  if (d < range && off < bot.skill.fov && M.sees(bot.x, bot.z, m.x, m.z, S.doors)) return 'see';
  if (MOVING.includes(m.st) && d < (COMING.includes(m.st) ? 9 : 6)) return 'hear';
  return null;
}
// Could a person in this guard's shoes have known it was there, whichever way they were facing?
const perceivable = (S: NightState, p: Point, m: Point & { st: MascotState }) => {
  const d = dist(p, m);
  return (MOVING.includes(m.st) && d < 6) || (d < 14 && M.sees(p.x, p.z, m.x, m.z, S.doors));
};

function perceive(S: NightState, bot: Bot): void {
  // At the desk with the power on: what the camera they are on shows. They flip to the next one every CAM_DWELL seconds.
  // In the booth with the power on, the wall map shows when something is in the ducts.
  const cam = bot.skill.cams && lightsF(S) && dist(bot, DESK_STAND) < 1 ? M.CAMS[Math.floor(S.t / CAM_DWELL) % M.CAMS.length] : undefined,
    sensor = bot.skill.cams && lightsF(S) && inBooth(bot);
  for (const m of S.m) {
    const screen = (cam && M.camSees(cam, m, M.MASCOT_R, S.doors)) || (sensor && M.roomAt(m.x, m.z) === M.DUCTS),
      how = sense(S, bot, m) || (screen && m.st !== 'rest' ? 'cams' : null);
    if (!how) continue;
    const old = bot.mem[m.i];
    bot.mem[m.i] = { i: m.i, x: m.x, z: m.z, st: m.st, rot: m.rot, lit: m.lit, t: S.t, since: old && S.t - old.t < 1.5 ? old.since : S.t, how };
  }
}
// The mascots this guard knows about and has had time to react to.
const known = (S: NightState, bot: Bot, age = 2.5) =>
  bot.mem.filter((k): k is Memory => !!k && S.t - k.t < age && k.st !== 'rest' && (S.t - k.since >= bot.skill.react || k.how === 'cams'));

/* ---------- a guard's body ---------- */

function makeBot(id: string, i: number, policy: Policy): Bot {
  return {
    id,
    i,
    policy,
    skill: policy.skill,
    x: 0,
    z: 0,
    yaw: Math.PI,
    on: false,
    sp: false,
    act: '',
    stam: 1,
    rested: 9,
    hold: 0,
    holding: null,
    mem: [],
    want: {},
    state: {},
    still: 0,
    firstSeen: [null, null, null, null],
    lastSeen: [-9, -9, -9, -9],
    bat: 1,
    flat: false,
  };
}

const segDist = (a: Point, b: Point, h: Point) => {
  const len = dist(a, b) || 1e-6,
    t = Math.max(0, Math.min(1, ((h.x - a.x) * (b.x - a.x) + (h.z - a.z) * (b.z - a.z)) / (len * len)));
  return Math.hypot(a.x + (b.x - a.x) * t - h.x, a.z + (b.z - a.z) * t - h.z);
};
// How wide a berth a guard who knows better gives each mascot they know about: more for one that is coming, less for one frozen in a beam.
const berths = (S: NightState, bot: Bot): Berth[] =>
  known(S, bot, 4)
    .filter(h => MOVING.includes(h.st) || h.st === 'windup')
    .map(h => ({ x: h.x, z: h.z, r: h.lit ? (h.rot ? 3.2 : 2.5) : COMING.includes(h.st) ? 5 : 4 }));

// What a stretch of floor costs to walk: its length, and a great deal more if it goes closer to a mascot than its
// berth. A stretch that starts inside a berth and only leads away from it costs nothing extra.
const RISK = 70;
type Cost = (a: Point, b: Point, d: number) => number;
const costOf = (avoid?: Berth[]): Cost =>
  avoid?.length
    ? (a, b, d) => {
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        for (const h of avoid) {
          const ah = Math.hypot(a.x - h.x, a.z - h.z);
          if (ah - len < h.r && segDist(a, b, h) < Math.min(h.r, ah - 0.3)) return d + RISK; // the first test is a quick no
        }
        return d;
      }
    : (_a, _b, d) => d;

// Cheapest costs over the waypoints, from those already priced in best. step(u, link) prices a link, or returns -1
// for one that cannot be used. visit(u, cost) is told each waypoint as it is settled and returns false to stop.
function spread(
  best: Float64Array,
  prev: Int16Array | null,
  step: (u: number, l: NavLink) => number,
  visit?: (u: number, d: number) => boolean | undefined
): void {
  const { links } = M.nav(),
    done = new Uint8Array(best.length),
    heap: [d: number, i: number][] = [];
  // A binary heap on d. Each entry moves up or down by shifting the ones in its way into its place, then lands.
  const push = (d: number, i: number) => {
    const entry: [number, number] = [d, i];
    let k = heap.length;
    heap.push(entry);
    while (k > 0) {
      const up = (k - 1) >> 1,
        parent = defined(heap[up], 'a heap entry');
      if (parent[0] <= d) break;
      heap[k] = parent;
      k = up;
    }
    heap[k] = entry;
  };
  const pop = () => {
    // Undefined from an empty heap. Otherwise the last entry moves down from the top into the gap.
    const top = heap[0],
      last = heap.pop();
    if (!last || !heap.length) return top;
    let k = 0;
    for (;;) {
      let m = k,
        low = last;
      for (const c of [2 * k + 1, 2 * k + 2]) {
        const child = heap[c];
        if (child && child[0] < low[0]) {
          m = c;
          low = child;
        }
      }
      if (m === k) break;
      heap[k] = low;
      k = m;
    }
    heap[k] = last;
    return top;
  };
  for (const [i, d] of best.entries()) if (d < 1e9) push(d, i);
  for (let next = pop(); next; next = pop()) {
    const [d, u] = next;
    // u, l.to: waypoint indices, and best has one entry per waypoint.
    if (done[u] || d > defined(best[u], "a waypoint's cost")) continue;
    done[u] = 1;
    if (visit && visit(u, d) === false) return;
    for (const l of defined(links[u], "a waypoint's links")) {
      if (done[l.to]) continue;
      const c = step(u, l);
      if (c >= 0 && d + c < defined(best[l.to], "a waypoint's cost")) {
        best[l.to] = d + c;
        if (prev) prev[l.to] = u;
        push(d + c, l.to);
      }
    }
  }
}
// Waypoint i of the nav graph: the graph's indices, and the arrays priced over it, all have one entry per waypoint.
const node = (nodes: NavNode[], i: number) => defined(nodes[i], 'a waypoint');
const costAt = (f: Float64Array, i: number) => defined(f[i], "a waypoint's cost");
// Can a point in room, d metres from waypoint nd, walk straight to it?
const entry = (S: NightState, p: Point, room: number, nd: NavNode, d: number) =>
  (nd.room === room || d < 5) && M.clear(p.x, p.z, nd.x, nd.z, M.PLAYER_R, S.doors);
// spread()'s step over the links a guard can walk: none through a shut door, or through the ducts unless ducts is set.
const stepper = (S: NightState, cost: Cost, ducts?: boolean) => {
  const { nodes } = M.nav();
  return (u: number, l: NavLink) => ((l.duct && !ducts) || (l.key && S.doors[l.key]) ? -1 : cost(node(nodes, u), node(nodes, l.to), l.d));
};

// The way a person who knows the building would go: the shortest way that keeps clear of the mascots they know about.
// Returns { path, risk }: risk is true when every way passes close to one. Null when a shut door is in every way.
function plan(S: NightState, bot: Bot, goal: Point, ducts?: boolean): { path: Point[]; risk: boolean; calm: boolean } | null {
  const { nodes } = M.nav(),
    avoid = berths(S, bot),
    n = nodes.length;
  const cost = costOf(avoid);
  if (M.clear(bot.x, bot.z, goal.x, goal.z, M.PLAYER_R, S.doors) && cost(bot, goal, 0) < RISK) return { path: [goal], risk: false, calm: !avoid.length };
  const best = new Float64Array(n).fill(1e9),
    end = new Float64Array(n).fill(1e9),
    prev = new Int16Array(n).fill(-1);
  const room = M.roomAt(bot.x, bot.z),
    goalRoom = M.roomAt(goal.x, goal.z);
  for (const [i, nd] of nodes.entries()) {
    if (!ducts && nd.room === M.DUCTS) continue;
    const d = dist(nd, bot),
      g = dist(nd, goal);
    if (entry(S, bot, room, nd, d)) best[i] = cost(bot, nd, d);
    if (entry(S, goal, goalRoom, nd, g)) end[i] = cost(nd, goal, g);
  }
  let last = -1,
    total = 1e9;
  spread(best, prev, stepper(S, cost, ducts), (u, d) => {
    if (d >= total) return false;
    const via = d + costAt(end, u);
    if (via < total) {
      total = via;
      last = u;
    }
  });
  if (last < 0) return null;
  const path: Point[] = [goal];
  // prev leads back from the last waypoint to the first, whose prev is -1.
  for (let i = last; i >= 0; i = defined(prev[i], "a waypoint's way back")) path.unshift(node(nodes, i));
  // Skip the first waypoints while the next one can be walked to straight.
  for (let next = path[1]; next && cost(bot, next, 0) < RISK && M.clear(bot.x, bot.z, next.x, next.z, M.PLAYER_R, S.doors); next = path[1]) path.shift();
  return { path, risk: total >= RISK, calm: !avoid.length };
}
// The plan for getting to a point. Thought about again every second, or sooner with a mascot about.
function wayTo(S: NightState, bot: Bot, goal: Point, ducts?: boolean): Way {
  const st = bot.state,
    key = `${Math.round(goal.x * 2)},${Math.round(goal.z * 2)}${ducts ? 'd' : ''}`;
  st.ways ??= new Map();
  const had = st.ways.get(key);
  if (had && S.t - had.at < (had.calm ? 1.2 : 0.4)) return had;
  if (st.ways.size > 6) st.ways.clear();
  const p = bot.skill.plans && plan(S, bot, goal, ducts);
  let way: Way;
  if (p) way = { path: p.path.slice(), risk: p.risk, calm: p.calm, blocked: null, at: S.t };
  else {
    const r = M.route(bot.x, bot.z, goal.x, goal.z, { doors: S.doors, ducts, r: M.PLAYER_R });
    way = { path: r.path, risk: false, calm: true, blocked: r.blocked || null, at: S.t };
  }
  st.ways.set(key, way);
  return way;
}

// Walk toward a point. Returns the key of a shut door in the way, if there is one.
function walk(S: NightState, bot: Bot, goal: Point, sprint?: boolean, face?: number | null, ducts?: boolean): DoorKey | null {
  const way = wayTo(S, bot, goal, ducts),
    path = way.path;
  let next = path[0];
  while (next && dist(bot, next) < (path.length > 1 ? 0.5 : 0.15)) {
    path.shift();
    next = path[0];
  }
  if (!next) return way.blocked;
  const dir = ang(bot, next);
  bot.yaw = face ?? dir;
  bot.sp = !!sprint && bot.stam > 0 && Math.abs(angDiff(dir, bot.yaw)) < 1;
  const step = Math.min(dist(bot, next), (bot.sp ? F.SPRINT : F.WALK) * DT);
  // Nobody walks into one they can see: no step that ends nearer to it than two metres.
  const to = { x: bot.x + Math.sin(dir) * step, z: bot.z + Math.cos(dir) * step };
  if (known(S, bot, 1).some(h => h.how !== 'cams' && dist(to, h) < 2 && dist(to, h) < dist(bot, h))) {
    bot.state.retreat = S.t + 2;
    return null;
  }
  // Wedged in a corner the route has no node for (the line to its first waypoint runs into a prop): back out
  // sideways or the way we came, as a person would, and ask for the way again.
  if (M.slide(bot, Math.sin(dir) * step, Math.cos(dir) * step, M.PLAYER_R, S.doors) < 0.05) {
    for (const turn of [1.57, -1.57, Math.PI])
      if (M.slide(bot, Math.sin(dir + turn) * step, Math.cos(dir + turn) * step, M.PLAYER_R, S.doors) > 0.5) {
        bot.state.ways?.clear();
        break;
      }
  }
  return null;
}

// Do what bot.want says for one tick, then tell the sim, as player.ts does.
function act(S: NightState, bot: Bot): void {
  const w = bot.want,
    before = { x: bot.x, z: bot.z };
  // Caught at a breaker box and let run: the sim broke the fix off, and its minigame starts over.
  if (bot.act === 'fix' && guardOf(bot).act !== 'fix') bot.holding = null;
  bot.sp = false;
  bot.act = '';
  let goal = w.goal,
    face = w.face;
  const u = w.use;
  if (u) {
    const d = dist(bot, u.at);
    if (d < (u.reach || F.REACH - 0.3)) {
      // In reach: face it and hold the key. Holding the crank roots you; the rest do not, but hands in a breaker box are not walking.
      face = w.face ?? u.face ?? ang(bot, u.at);
      if (u.what === 'crank' || u.what === 'charge') {
        // Only the crank and the dock are held for as long as they are wanted (hold -1).
        bot.act = u.what;
        if (u.what === 'crank' || !w.goal) goal = null;
      } else {
        goal = null;
        if (bot.holding !== u.key) {
          bot.holding = u.key;
          bot.hold = 0;
        }
        bot.hold += DT;
        if (u.what === 'fix') bot.act = 'fix'; // hands in the box: the torch hangs and holds nothing
        if (bot.hold >= u.hold + 0.05) {
          actFloor(sim, S, bot.id, { t: 'use', what: u.what, i: u.i, k: u.k, id: u.id });
          bot.hold = 0;
          bot.holding = null;
          if (u.what === 'door' && S.doors[u.k] !== u.shut) bot.state[`stuck${u.k}`] = S.t + 2;
        }
      }
    } else {
      goal = standOf(u);
      bot.holding = null;
    }
  } else bot.holding = null;
  if (w.dash != null) {
    // No time to think about a route: straight that way, flat out.
    bot.yaw = w.dash;
    bot.sp = bot.stam > 0;
    const step = (bot.sp ? F.SPRINT : F.WALK) * DT;
    M.slide(bot, Math.sin(w.dash) * step, Math.cos(w.dash) * step, M.PLAYER_R, S.doors);
  } else if (goal && dist(bot, goal) > 0.15) {
    const shut = walk(S, bot, goal, w.sprint, face, w.ducts);
    // A shut booth door in the way: go and press its button, from whichever side we are on.
    if (shut && lightsF(S) && !w.keep?.includes(shut)) {
      if (dist(bot, M.PANELS[shut]) < F.REACH - 0.3) {
        if (S.t - (bot.pressed || -9) > 0.6) {
          bot.pressed = S.t;
          actFloor(sim, S, bot.id, { t: 'use', what: 'door', k: shut });
        }
      } else walk(S, bot, doorStand(bot, shut), w.sprint, face, w.ducts);
    }
  } else if (face != null) bot.yaw = face;
  if (bot.sp) {
    bot.stam = Math.max(0, bot.stam - STAMINA.drain * DT);
    bot.rested = 0;
  } else {
    bot.rested += DT;
    if (bot.rested > STAMINA.rest) bot.stam = Math.min(1, bot.stam + STAMINA.gain * DT);
  }
  bot.on = !!w.on && bot.bat > 0;
  // Standing at the desk with nothing else to do is watching the cameras, which the room gives a start for, as at a box.
  if (!bot.act && !u && bot.skill.cams && lightsF(S) && dist(bot, DESK_STAND) < 1) bot.act = 'cams';
  bot.still = dist(bot, before) < 0.01 && goal && dist(bot, goal) > 3 ? bot.still + DT : 0;
  actFloor(sim, S, bot.id, { t: 'p', x: bot.x, z: bot.z, yaw: bot.yaw, pitch: 0, on: bot.on, sp: bot.sp, act: bot.act });
}

// Press a booth door's button if it is not already the way we want it.
function setDoor(S: NightState, bot: Bot, k: DoorKey, shut: boolean): boolean {
  if (!!S.doors[k] === shut || !lightsF(S)) return false;
  const stand = doorStand(bot, k);
  bot.want.use = { what: 'door', k, at: stand, face: ang(stand, M.PANELS[k]), stand, hold: 0.2, key: `door${k}`, reach: 0.6, shut };
  return true;
}

/* ---------- playing properly ---------- */

const competent: Skill = {
  react: 0.5,
  fov: 1.5,
  torch: 'thrifty',
  cams: true,
  plans: true,
  doors: true,
  cranks: true,
  peelRange: 99,
  dodges: true,
  alert: 15,
  beam: 2.5,
  reserve: 0.15,
  topsUp: true,
  crankEarly: 0,
  toy: true,
  spare: 0.4,
};
const SKILL = {
  careless: {
    react: 0.9,
    fov: 0.9,
    torch: 'always',
    cams: false,
    plans: false,
    doors: false,
    cranks: false,
    peelRange: 12,
    dodges: false,
    alert: 7,
    beam: 1.2,
    reserve: 0,
    topsUp: false,
    crankEarly: 0,
    toy: false,
  },
  competent,
  expert: { ...competent, react: 0.25, fov: 2.2, reserve: 0.2, crankEarly: 15 },
} satisfies Record<string, Skill>;

// How far it is by foot from a point to every waypoint. avoid: berths to keep clear of, as in plan().
function field(S: NightState, from: Point, avoid?: Berth[]): Float64Array {
  const { nodes } = M.nav(),
    n = nodes.length,
    best = new Float64Array(n).fill(1e9);
  const cost = costOf(avoid),
    room = M.roomAt(from.x, from.z);
  for (const [i, nd] of nodes.entries()) {
    const d = dist(nd, from);
    if (nd.room !== M.DUCTS && entry(S, from, room, nd, d)) best[i] = cost(from, nd, d);
  }
  spread(best, null, stepper(S, cost));
  return best;
}
// The same distance to a point that is not a waypoint.
function fieldAt(S: NightState, f: Float64Array, p: Point): number {
  const { nodes } = M.nav(),
    room = M.roomAt(p.x, p.z);
  let best = 1e9;
  // f comes from field(), one entry per waypoint.
  for (const [i, nd] of nodes.entries()) {
    const d = dist(nd, p),
      via = costAt(f, i) + d;
    if (via < best && entry(S, p, room, nd, d)) best = via;
  }
  return best;
}

// Where everyone could be and when: seconds for this guard to walk to each waypoint keeping clear of what it knows
// about, and seconds for the nearest of the things after it to get there. Worked out twice a second, and kept under
// slot: the callers ask about different mascots at different paces, so each keeps its own.
function race(S: NightState, bot: Bot, hs: Memory[], pace: (h: Memory) => number, slot: 'race' | 'waitRace' = 'race'): Race {
  const st = bot.state,
    had = st[slot];
  if (had && S.t - had.at < 0.5) return had;
  const mine = field(S, bot, berths(S, bot)).map(d => d / F.WALK),
    theirs = new Float64Array(mine.length).fill(1e9);
  for (const h of hs) for (const [i, d] of field(S, h).entries()) theirs[i] = Math.min(costAt(theirs, i), d / pace(h));
  const r = { mine, theirs, at: S.t };
  st[slot] = r;
  return r;
}
// Where to run: the waypoint furthest (in their time) from everything after this guard, out of those the guard
// can reach first. Kept to unless another is clearly better.
function fleeTo(bot: Bot, r: Race): Point {
  // A doorway beats the far corner of a room, and the next room beats both: a corner is where it ends.
  const { nodes } = M.nav(),
    st = bot.state,
    room = M.roomAt(bot.x, bot.z);
  // nd: waypoint i, and r has one entry per waypoint.
  const worth = (i: number, nd: NavNode) => {
    const mine = costAt(r.mine, i),
      theirs = costAt(r.theirs, i);
    return mine + 1 < theirs && mine < 14 ? Math.min(theirs, 25) - mine * 0.2 + (nd.room !== room ? 7 : nd.door ? 4 : 0) : -1;
  };
  let best: { i: number; nd: NavNode; worth: number } | null = null;
  for (const [i, nd] of nodes.entries()) {
    if (nd.room === M.DUCTS) continue;
    const w = worth(i, nd);
    if (w > 0 && (!best || w > best.worth)) best = { i, nd, worth: w };
  }
  if (!best) return bot;
  if (st.fleeNode !== undefined) {
    const i = st.fleeNode,
      nd = node(nodes, i);
    if (dist(bot, nd) > 1.5 && worth(i, nd) > best.worth - 3) best = { i, nd, worth: worth(i, nd) };
  }
  st.fleeNode = best.i;
  return best.nd;
}

// Whose job the generator is: the last guard standing who cranks at all.
const cranker = (team: Team) => team.bots.filter(b => !b.flat && b.skill.cranks && b.policy.cranks !== false).at(-1);
const fixable = (S: NightState) => S.faults.map((f, i) => (f ? i : -1)).filter(i => i >= 0);
// A guard's share: the faults they have (the same list as in team.fault), where they will be after them, how far
// they walk to get there, and what a metre of walking weighs for them (w).
interface Share {
  b: Bot;
  list: number[];
  x: number;
  z: number;
  len: number;
  w: number;
}
// Share out the open faults: each to whoever would get there soonest after what they already have. The one a guard
// is on the way to stays theirs (a person who has set off for one does not turn back because another broke out
// somewhere else) unless they go down; the rest are shared out again. In a crew with the power getting low, the
// cranker takes fewer so there is time to crank.
function assignFaults(S: NightState, team: Team): void {
  const spare = team.bots.length > 1 && S.power < 60 ? cranker(team) : null;
  const up = team.bots.filter(b => !b.flat && b.policy.faults !== false);
  const open = new Set(fixable(S));
  const kept = up.map(b => ({ b, list: (team.fault.get(b.id) || []).filter(i => open.has(i)).slice(0, 1) }));
  for (const { list } of kept) for (const i of list) open.delete(i);
  team.fault = new Map(kept.map(({ b, list }) => [b.id, list]));
  const shares = kept.map(({ b, list }): Share => {
    const w = (b.policy.share ?? 1) * (b === spare ? 3 : 1);
    let x = b.x,
      z = b.z,
      len = 0;
    // Fault i is the one in box i.
    for (const i of list) {
      const c = box(i);
      len += Math.hypot(c.x - x, c.z - z);
      x = c.x;
      z = c.z;
    }
    return { b, list, x, z, len: len * w, w };
  });
  while (open.size && shares.length) {
    let best: { share: Share; i: number; cost: number } | null = null;
    for (const share of shares)
      for (const i of open) {
        const cost = share.len + dist(share, box(i)) * share.w;
        if (!best || cost < best.cost) best = { share, i, cost };
      }
    // shares and open are not empty, so the loop above found one.
    const { share, i, cost } = defined(best, 'a guard for a fault');
    open.delete(i);
    share.list.push(i);
    const c = box(i);
    share.x = c.x;
    share.z = c.z;
    share.len = cost;
  }
}

// In the booth: the doors that should stay shut, because something is close to them. Notes since when each of the
// others has been clear.
function keepShut(S: NightState, bot: Bot): DoorKey[] {
  const st = bot.state,
    keep: DoorKey[] = [];
  for (const k of DOORS) {
    const mid = doorMid(k);
    const close = known(S, bot, 4).some(h => !inBooth(h) && dist(h, mid) < (COMING.includes(h.st) ? 12 : 7));
    if (close) {
      st[`clear${k}`] = null;
      keep.push(k);
    } else st[`clear${k}`] ??= S.t;
  }
  return keep;
}
// In the booth: shut whichever door in keep (keepShut) something is coming to, and open the others again once they
// have been clear long enough. Returns true while the guard is busy with a button.
function mindDoors(S: NightState, bot: Bot, team: Team, keep: DoorKey[], leaving: boolean): boolean {
  const st = bot.state;
  // One guard to a button: whoever in the booth is nearest it.
  const mine = (k: DoorKey) => !team.bots.some(b => b !== bot && !b.flat && inBooth(b) && b.skill.doors && dist(b, M.PANELS[k]) < dist(bot, M.PANELS[k]));
  // The door something is coming to first. One that will not shut (something is in it) is left for a moment.
  const urgency = (k: DoorKey) =>
    Math.min(
      ...known(S, bot, 4)
        .filter(h => !inBooth(h))
        .map(h => dist(h, doorMid(k)) - (COMING.includes(h.st) ? 20 : 0)),
      99
    );
  for (const k of [...keep].sort((a, b) => urgency(a) - urgency(b))) {
    const stuck = st[`stuck${k}`];
    if (!S.doors[k] && mine(k) && (stuck === undefined || stuck <= S.t) && setDoor(S, bot, k, true)) return true;
  }
  for (const k of DOORS) {
    // keepShut set the clear time of every door not in keep, so clear is a number for every door this looks at.
    const clear = st[`clear${k}`];
    if (S.doors[k] && mine(k) && !keep.includes(k) && clear != null && S.t - clear > (leaving ? 2 : 5) && setDoor(S, bot, k, false)) return true;
  }
  return false;
}

// Something is coming for this guard. Sets bot.want and returns true if that is all it can think about.
function defend(S: NightState, bot: Bot, objective: Objective): boolean {
  const sk = bot.skill,
    w = bot.want,
    st = bot.state;
  // The building has just stirred (everyone hears it): anything seen standing nearby is about to move.
  if (S.stir && !st.stirred) st.stirAt = S.t;
  st.stirred = S.stir;
  const waking =
    sk.plans && S.stir && st.stirAt !== undefined && S.t - st.stirAt < 8
      ? bot.mem.filter((k): k is Memory => !!k && k.st === 'rest' && S.t - k.t < 30 && dist(bot, k) < 10 && mayWake(S, k.i))
      : [];
  const hs = known(S, bot)
    .filter(h => (COMING.includes(h.st) && dist(bot, h) < sk.alert) || ((MOVING.includes(h.st) || h.st === 'stun') && h.how !== 'cams' && dist(bot, h) < 6))
    .concat(waking)
    .sort((a, b) => dist(bot, a) - dist(bot, b));
  const [h] = hs;
  if (!h) {
    st.chased = null;
    return false;
  }
  st.chased ??= S.t;
  const d = dist(bot, h),
    sight = M.sees(bot.x, bot.z, h.x, h.z, S.doors);
  const booth = inBooth(bot),
    canHole = sk.doors && lightsF(S),
    holing = booth && canHole && !hs.some(inBooth);
  // Something coming that is close but still far enough off to hit (bonk() says no to one nearer), or Greg lining
  // up: a Mini Biggs straight at it stuns it. Not from the booth at one outside, which a door will stop: stunned in
  // the doorway, it would keep the door from shutting. Anything else coming or wandering close, or already too near
  // to hit: one thrown away from here may take it off.
  const close = d < BONK.max || h.st === 'windup' || h.st === 'charge';
  if (!(COMING.includes(h.st) && close && !holing && bonk(S, bot, h, 0))) lure(S, bot, targetOf(objective) || bot);
  // Greg winding up or already coming: get out of its line.
  const greg =
    sk.dodges &&
    known(S, bot, 1.5).find(
      k => k.i === 3 && (k.st === 'windup' || k.st === 'charge') && ((st.dodge && S.t - st.dodge.at < 3) || M.sees(bot.x, bot.z, k.x, k.z, S.doors))
    );
  if (greg) {
    // Sideways, to whichever side has more room, and the same side until it has gone past.
    const line = ang(greg, bot),
      room = (s: number) => {
        let d = 0;
        while (d < 4 && M.walkable(bot.x + Math.sin(line + s * 1.57) * (d + 0.5), bot.z + Math.cos(line + s * 1.57) * (d + 0.5), M.PLAYER_R, S.doors)) d += 0.5;
        return d;
      };
    let dodge = st.dodge;
    if (!dodge || S.t - dodge.at >= 3) {
      dodge = { side: room(1) >= room(-1) ? 1 : -1, at: S.t };
      st.dodge = dodge;
    }
    w.dash = line + dodge.side * 1.57;
    w.use = null;
    w.goal = null;
    return true;
  }
  // How fast it comes with the torch on it and without. Light on it once it is close enough to matter (every second
  // of light rots it), eyes on it either way: Flan slows for that alone.
  // The paces are a guard's guess, a little over each one's SPEED.hunt and not scaled by KEEN: the bots expect them
  // quicker than they come on a lit floor, so slowing the mascots does not also sharpen the bots' timing. They are
  // top paces too: a guard cannot tell a winded one (TIRE) from a fresh one, so they plan for the fresh one.
  const speed = (k: Memory) => {
    const base = k.i === 0 ? 2.8 : k.i === 1 ? 2.6 : 3.8;
    return bot.bat > 0 && k === h ? Math.max(0.3, base * defined(LIT_PACE[k.rot], 'the pace for a rot')) : base;
  };
  const unlit = h.i === 0 ? 2.8 : h.i === 1 && sight ? 2.6 : 3.8;
  const beam = bot.bat > 0 && sight && COMING.includes(h.st) && d < F.BEAM_RANGE - 0.5 && (d - F.CATCH) / unlit < sk.beam;
  if (beam) w.on = true;
  if (sight && d < 16) w.face = ang(bot, h);
  const eta = (d - F.CATCH) / (beam ? speed(h) : unlit);
  // In the booth with it outside: the doors are the answer. With it inside: out by another door.
  if (holing) {
    st.holed = S.t + 3;
    return false;
  }
  const r = race(S, bot, hs, speed);
  // Out of sight of everything it knows about for long enough that nothing still knows where it is (RELENT for Biggs,
  // KEEP for the rest, and a little over), with a free locker close by and the lights on: in, if this guard hides at
  // all.
  if (known(S, bot, 4).some(k => k.st !== 'rest' && M.sees(k.x, k.z, bot.x, bot.z, S.doors))) st.seenAt = S.t;
  const lostThem = S.t - (st.seenAt ?? -99) > (hs.some(k => k.i === 0) ? RELENT + 0.5 : KEEP + 0.8);
  const locker = bot.policy.hides && lightsF(S) && (st.hideCool === undefined || st.hideCool <= S.t) && lostThem && freeLocker(S, bot, 5);
  if (locker) {
    w.use = locker;
    w.goal = null;
    w.sprint = true;
    return true;
  }
  // Carry on with the job if we can get there and do it before anything gets there. Once running, keep running a while.
  const pressed = hs.length > 1 || (bot.bat <= 0 && h.i !== 0) || S.t - st.chased > 10;
  const u = objective.use,
    target = targetOf(objective);
  if (target && S.t > (st.retreat || 0) && !pressed) {
    const need = fieldAt(S, r.mine, target) + (u ? Math.max(0, u.hold) + 0.8 : 0),
      have = Math.min(...hs.map(k => dist(k, target) / speed(k)));
    if (need < have) {
      w.goal = objective.goal;
      w.use = objective.use;
      w.sprint = eta < 2.5 && !beam;
      return true;
    }
    st.retreat = S.t + 2;
  }
  // Otherwise the booth, if we can be in it with time to shut a door, or wherever gives the longest lead.
  const home = canHole && !booth ? fieldAt(S, r.mine, BOOTH_MID) : 1e9;
  const goal = home + 2.5 < Math.min(...hs.map(k => dist(k, BOOTH_MID) / speed(k))) ? BOOTH_MID : fleeTo(bot, r);
  w.goal = goal;
  w.use = null;
  w.sprint = eta < 3 && (!beam || speed(h) > 2.4);
  if (w.sprint && bot.stam > 0.1) w.face = null; // running means turning your back on it
  return true;
}

// What an honest guard wants to be doing when nothing is after them.
function objectiveOf(S: NightState, bot: Bot, team: Team): Objective {
  const sk = bot.skill,
    pol = bot.policy,
    st = bot.state;
  // 1. A teammate on the floor.
  const flat = team.bots.filter(b => b.flat && b !== bot && pol.peels !== false);
  for (const f of flat) {
    const helpers = team.bots.filter(b => !b.flat && b.policy.peels !== false && dist(b, f) < b.skill.peelRange);
    if (nearest(f, helpers) === bot)
      return { use: { what: 'peel', id: f.id, at: { x: f.x, z: f.z }, stand: { x: f.x, z: f.z }, hold: F.PEEL_HOLD, key: `peel${f.id}` }, urgent: true };
  }
  // 2. The faults that are ours.
  const mine = pol.faults === false ? [] : sk.plans ? (team.fault.get(bot.id) || []).filter(i => S.faults[i]) : fixable(S);
  const i = nearestBy(bot, mine, box);
  if (i !== undefined) {
    // A careless guard drifts off between jobs.
    if (!sk.plans && st.drift && st.drift.until > S.t) return { goal: st.drift.to };
    const f = defined(S.faults[i], `the fault in box ${i}`); // mine holds only open faults
    return { use: { what: 'fix', i, at: box(i), hold: defined(F.FIX[f.k], `fault kind ${f.k}`), key: `fix${i}@${f.at}` }, fault: f };
  } else if (!sk.plans && !(st.drift && st.drift.until > S.t) && random() < 0.02) {
    st.drift = { until: S.t + 6 + random() * 10, to: pick(M.nav().nodes.filter(n => n.room !== M.DUCTS)) };
  }
  // 3. Light.
  if ((bot.bat < 1 && sk.topsUp) || bot.bat < 0.3) {
    const seen = S.bats
      .map(i => ({ i, at: defined(M.BATTERY_SPOTS[i], `battery spot ${i}`) })) // S.bats holds spot indices
      .filter(({ at }) => dist(bot, at) < (bot.bat < sk.reserve ? 14 : 5) && M.sees(bot.x, bot.z, at.x, at.z, S.doors));
    const b = nearestBy(bot, seen, s => s.at);
    if (b && bot.bat <= 1 - F.BAT_PICKUP * 0.6) return { use: { what: 'bat', i: b.i, at: b.at, stand: b.at, hold: 0.2, key: 'bat' } };
  }
  // 4. The generator, if it is our job and the power needs it.
  const genJob = cranker(team) === bot;
  // A crew has the building's whole supply to keep up and more hands, so it starts sooner. An expert cranks between waves.
  const low = (team.bots.length > 1 ? 60 : 45) + (S.stir ? 0 : sk.crankEarly);
  if (genJob && (S.power < Math.min(S.cap - 3, st.cranking ? 80 : low) || (S.out && S.cap >= F.RESTART))) {
    st.cranking = true;
    return { use: CRANK, crank: true };
  }
  st.cranking = false;
  // 4b. Hands empty: the nearest Mini Biggs on the floor, once it has had a few seconds to send what it drew on its way
  // and nothing known is moving near it. On the way to anything else, the plan keeps clear of the mascots as usual.
  if (sk.toy && !guardOf(bot).toy) {
    const left = S.toys.filter(t => S.t > t.land + 6 && !known(S, bot, 4).some(h => MOVING.includes(h.st) && dist(h, t) < 8));
    const t = nearest(bot, left);
    if (t) return { use: { what: 'toy', id: t.id, at: t, stand: t, hold: 0.2, key: `toy${t.id}` } };
    // None worth the walk: a fresh one from the booth's carton, while it has any.
    if (S.toyBox > 0) return { use: CARTON };
  }
  // 5. Nothing to do: the booth, and the charger if the torch wants it. A careless guard wanders.
  if (!sk.plans && pol.stays !== true && !(bot.bat < 0.05 && lightsF(S)) && !st.topUp) return st.drift && st.drift.until > S.t ? { goal: st.drift.to } : {};
  st.topUp = !sk.plans && bot.bat < 0.6; // a careless guard charges only once the torch has died, and not for long
  if (bot.bat < 0.95 && lightsF(S)) return { use: CHARGE, home: true };
  // A guard who uses the cameras waits at the desk, watching them, unless a teammate is already there.
  const watcher = team.bots.find(b => b !== bot && !b.flat && dist(b, DESK_STAND) < 1.5);
  return { goal: sk.cams && lightsF(S) && !watcher ? DESK_STAND : BOOTH_MID, home: true };
}

const honest = (skill: keyof typeof SKILL, opts: PolicyOptions = {}): Policy => ({
  skill: SKILL[skill],
  ...opts,
  think(S, bot, team) {
    const sk = bot.skill,
      w = bot.want,
      st = bot.state,
      booth = inBooth(bot);
    if (stayHidden(S, bot)) return;
    const obj = objectiveOf(S, bot, team);
    const dark = !lightsF(S);
    w.on = sk.torch === 'always' ? !booth || dark : (!booth && bot.bat > sk.reserve) || (dark && bot.bat > sk.reserve / 2);
    if (defend(S, bot, obj)) return;
    // In the booth: the doors come before anything else, and nobody walks out past something waiting at one.
    if (sk.doors && booth && !dark) {
      const leaving = !obj.home;
      const keep = keepShut(S, bot);
      w.keep = keep;
      if (mindDoors(S, bot, team, keep, leaving)) return;
      if (
        (st.holed !== undefined && st.holed > S.t) ||
        (leaving && keep.length === 3) ||
        (leaving && keep.length > 0 && !obj.urgent && !(obj.fault && faultLeft(S, obj.fault) < 15))
      ) {
        w.goal = BOOTH_MID;
        if (bot.bat < 0.95) w.use = CHARGE;
        return;
      }
    }
    w.goal = obj.goal;
    w.use = obj.use;
    // Something known is on every way there: wait for it to move on, unless the fault is about to burn.
    const to = targetOf(obj);
    const deadline = obj.fault ? faultLeft(S, obj.fault) : 1e9;
    if (sk.plans && to && dist(bot, to) > 2 && wayTo(S, bot, to).risk && !obj.urgent && deadline > (dist(bot, to) / F.WALK) * 1.4 + 8) {
      lure(S, bot, to); // and wait all the same while it goes
      const moving = known(S, bot, 4).filter(h => MOVING.includes(h.st));
      const h = nearest(bot, moving);
      w.goal = booth
        ? BOOTH_MID
        : h && dist(bot, h) < 8
          ? fleeTo(
              bot,
              race(S, bot, [h], () => 3, 'waitRace')
            )
          : null;
      w.use = null;
      return;
    }
    // Running late for a friend, or for a fault: seconds of walking that is too many.
    const late = obj.urgent ? 3 : obj.fault && faultLeft(S, obj.fault) - 6;
    if (obj.use && late !== undefined && dist(bot, obj.use.at) / F.WALK > late) w.sprint = true;
  },
});

// A guard does not see which mascots are wise to a Mini Biggs (TOY.wise), only what they threw themselves: no second
// one at or for the same mascot until the first has worn off.
const fresh = (S: NightState, bot: Bot, h: Memory) => S.t - (bot.state.threwAt?.[h.i] ?? -99) > TOY.wise;
function threw(S: NightState, bot: Bot, h: Memory, gap: number): void {
  const st = bot.state;
  st.threwAt ??= [-99, -99, -99, -99];
  st.threwAt[h.i] = S.t;
  st.lureAt = S.t + gap;
}
// How far off something coming has to be for a guard to throw a Mini Biggs straight at it, in metres. A toy stuns
// only what it first touches TOY.armed metres or more from the hand, and it touches a mascot at the mascot's edge
// plus TOY.hit, so `min` is that and 1.2 m more for the ground the mascot covers while the toy is in the air. Nearer
// than `min` a straight throw sails past, and the guard throws for the song. Past `max` an honest guard does not
// bother: the torch and the song do more for the battery, since a hit buys TOY.stun seconds and the mascot wakes
// still facing them.
const BONK = { min: TOY.armed + M.MASCOT_R + TOY.hit + 1.2, max: TOY.armed + M.MASCOT_R + TOY.hit + 4 };
// Mini Biggs, straight at a mascot this guard can see, to stun it. Only with `floor` of the battery left after it,
// and only at one at least BONK.min away. Returns whether one was thrown.
function bonk(S: NightState, bot: Bot, h: Memory, floor: number): boolean {
  const me = guardOf(bot);
  if (!bot.skill.toy || !me.toy || me.bat - TOY.cost < floor || S.t < (bot.state.lureAt || 0) || !fresh(S, bot, h)) return false;
  if (h.how === 'cams' || h.st === 'stun' || dist(me, h) < BONK.min || dist(me, h) > TOY.range - 2 || !M.sees(me.x, me.z, h.x, h.z, S.doors)) return false;
  const yaw = ang(me, h);
  // Nothing may stop it short of the mascot.
  if (dist(me, landing(S, me.x, me.z, yaw, TOY.range)) < dist(me, h) - 0.5) return false;
  threw(S, bot, h, 2);
  actFloor(sim, S, bot.id, { t: 'throw', yaw, d: TOY.range });
  return true;
}

// Mini Biggs. The nearest thing this guard can see wandering, searching or (with the lights on) hunting: throw one
// where it will hear it sing, and where walking to it takes it away from the guard and from where the guard is going
// (to). Sixteen ways round are tried. Only with skill.spare of the battery left after it.
function lure(S: NightState, bot: Bot, to: Point): void {
  const me = guardOf(bot),
    st = bot.state;
  if (!bot.skill.toy || !me.toy || me.bat - TOY.cost < bot.skill.spare || S.t < (st.lureAt || 0)) return;
  const listening = known(S, bot, 1.5).filter(
    k => k.how !== 'cams' && (k.st === 'roam' || k.st === 'search' || (k.st === 'hunt' && lightsF(S))) && dist(bot, k) < 14 && fresh(S, bot, k)
  );
  const h = nearest(bot, listening);
  if (!h) return;
  let best: { yaw: number; d: number; score: number } | null = null;
  for (let k = 0; k < 16; k++) {
    const yaw = (k * Math.PI) / 8,
      at = landing(S, me.x, me.z, yaw, TOY.range); // from where the sim has them
    if ([M.DUCTS, M.BOOTH].includes(M.roomAt(at.x, at.z)) || dist(at, h) > TOY.hear - 2 || dist(at, bot) < 6 || dist(at, to) < 6 || segDist(h, at, bot) < 4)
      continue;
    const score = dist(at, bot) + dist(at, to) - dist(at, h);
    if (!best || score > best.score) best = { yaw, d: dist(me, at) + 0.05, score }; // a hair over, so the sim's own steps reach the same spot
  }
  if (!best) return;
  threw(S, bot, h, 6); // and give that one time to work before throwing another
  actFloor(sim, S, bot.id, { t: 'throw', yaw: best.yaw, d: best.d });
}

// Lockers (M.HIDES). The nearest one nobody is in, within `within` metres, as something to use.
function freeLocker(S: NightState, bot: Bot, within: number): Use | undefined {
  const free = M.HIDES.map((h, i) => ({ h, i })).filter(
    ({ h, i }) => !S.players.some(p => p.hid === i) && dist(bot, h.at) < within && M.clear(bot.x, bot.z, h.at.x, h.at.z, M.PLAYER_R, S.doors)
  );
  const best = nearestBy(bot, free, f => f.h.at);
  return best && hideUse(best.i, best.h.at);
}
// In a locker: stay while anything known is moving nearby, then out after a few seconds of quiet (or 25 s at most,
// since the faults do not wait). Returns true while in one.
function stayHidden(S: NightState, bot: Bot): boolean {
  const me = guardOf(bot),
    st = bot.state,
    w = bot.want;
  if (me.hid < 0) {
    st.hidFor = 0;
    return false;
  }
  st.hidFor = (st.hidFor || 0) + DT;
  w.on = false;
  const near = known(S, bot, 4).some(h => MOVING.includes(h.st) && dist(bot, h) < 9);
  if ((!near && st.hidFor > 4) || st.hidFor > 25) {
    w.use = { what: 'hide', i: me.hid, at: bot, stand: bot, hold: 0, key: 'out' };
    st.hideCool = S.t + 8;
  }
  return true;
}

/* ---------- playing to break it ---------- */

const DEGENERATE = {
  // Everyone in the booth, every door shut, nobody goes anywhere. toys: and throw a Mini Biggs at whatever wanders
  // near, to keep it off the doors.
  turtle: (toys?: boolean): Policy => ({
    skill: SKILL.competent,
    think(S, bot) {
      const w = bot.want;
      w.on = !lightsF(S);
      if (toys) {
        lure(S, bot, BOOTH_MID);
        if (!guardOf(bot).toy && S.toyBox > 0) {
          w.use = CARTON;
          return;
        }
      }
      for (const [j, k] of DOORS.entries()) if (((bot.i + j) % 3 === 0 || S.t > 4) && setDoor(S, bot, k, true)) return;
      const h = nearest(bot, known(S, bot));
      if (h && dist(bot, h) < 12) {
        w.face = ang(bot, h);
        w.on = true;
      }
      if (bot.bat < 0.9) w.use = CHARGE;
      else w.goal = BOOTH_MID;
    },
  }),
  // Toy spam. Everyone stays in the booth by the carton with the doors open and throws a Mini Biggs at whatever
  // comes near: straight at it when it is far enough off to stun, for it to follow when it is not. Empty hands take
  // the nearest one off the floor or the next out of the carton, and the dock pays for the throws. Nobody fixes
  // anything.
  spam: (): Policy => ({
    skill: SKILL.competent,
    think(S, bot) {
      const w = bot.want,
        me = guardOf(bot);
      w.on = !lightsF(S);
      const about = known(S, bot).filter(k => k.st !== 'stun');
      const h = nearest(bot, about);
      if (h && dist(bot, h) < TOY.range) {
        w.face = ang(bot, h);
        w.on = true;
        if (!bonk(S, bot, h, 0)) lure(S, bot, BOOTH_MID);
      }
      if (!me.toy) {
        const t = nearest(
          bot,
          S.toys.filter(t => S.t > t.land && dist(bot, t) < 8 && !about.some(k => dist(k, t) < 4))
        );
        if (t) w.use = { what: 'toy', id: t.id, at: t, stand: t, hold: 0.2, key: `toy${t.id}` };
        else if (S.toyBox > 0) w.use = CARTON;
        if (w.use) return;
      }
      if (bot.bat < 0.9 && lightsF(S)) w.use = CHARGE;
      else w.goal = front(M.TOY_BOX);
    },
  }),
  // Stand at the dock with the torch on and the charge lead in, and shine at whatever comes in.
  dock: (): Policy => ({
    skill: SKILL.competent,
    think(S, bot) {
      const w = bot.want,
        h = nearest(bot, known(S, bot));
      w.on = true;
      w.use = CHARGE;
      w.face = h ? ang(bot, h) : Math.PI + (bot.i - 1) * 0.8;
    },
  }),
  // Everyone backs into one corner and pins whatever comes with their torches.
  corner: (spot: Point & { look: number }): Policy => ({
    skill: SKILL.competent,
    think(S, bot) {
      const w = bot.want,
        at = { x: spot.x + (bot.i % 2) * 0.8, z: spot.z + (bot.i >> 1) * 0.8 };
      const hs = known(S, bot).sort((a, b) => dist(bot, a) - dist(bot, b));
      // Share the mascots out so two torches are not on the same one.
      const h = hs[bot.i % Math.max(1, hs.length)];
      if (dist(bot, at) > 0.4) w.goal = at;
      w.face = h ? ang(bot, h) : spot.look;
      w.on = !!h && dist(bot, h) < F.BEAM_RANGE;
    },
  }),
  // Walk a loop of rooms and never stop, so whatever follows never arrives.
  kite: (): Policy => ({
    skill: SKILL.competent,
    think(S, bot) {
      const loop = [
          { x: 19, z: 8 },
          { x: 31, z: 5 },
          { x: 35, z: 14 },
          { x: 31, z: 18 },
          { x: 22, z: 18 },
        ],
        st = bot.state;
      const leg = (i: number) => defined(loop[i], `leg ${i} of the loop`); // st.leg is kept to the loop's length
      st.leg ??= 0;
      if (dist(bot, leg(st.leg)) < 1.5) st.leg = (st.leg + 1) % loop.length;
      const h = nearest(bot, known(S, bot));
      bot.want.goal = leg(st.leg);
      bot.want.sprint = !!h && dist(bot, h) < 5;
      bot.want.on = false;
    },
  }),
  // Stand somewhere the mascots cannot walk to.
  hole: (spot: Point & { dx: number; dz?: number }): Policy => ({
    skill: SKILL.competent,
    think(S, bot) {
      const w = bot.want,
        at = { x: spot.x + ((bot.i % 3) - 1) * spot.dx, z: spot.z + ((bot.i % 3) - 1) * (spot.dz || 0) };
      const h = nearest(bot, known(S, bot));
      w.ducts = true;
      if (dist(bot, at) > 0.3) w.goal = at;
      if (h && dist(bot, h) < F.BEAM_RANGE) {
        w.face = ang(bot, h);
        w.on = true;
      }
    },
  }),
  // Into a locker at the start of the night, a different one each, and stay there.
  locker: (): Policy => ({
    skill: SKILL.competent,
    think(_S, bot) {
      if (guardOf(bot).hid >= 0) return;
      const spawn = M.spawnPoint(0),
        order = M.HIDES.map((h, i) => ({ h, i })).sort((a, b) => dist(spawn, a.h.at) - dist(spawn, b.h.at));
      const { h, i } = defined(order[bot.i % order.length], 'a locker');
      bot.want.use = hideUse(i, h.at);
    },
  }),
  // Hands in the nearest box with an open fault, never finishing and never leaving, for the start a mascot gives a
  // guard it catches there.
  box: (): Policy => ({
    skill: SKILL.competent,
    think(S, bot) {
      const at = nearest(
          bot,
          M.BOXES.filter((_, i) => S.faults[i])
        ),
        i = at ? M.BOXES.indexOf(at) : -1;
      if (at) bot.want.use = { what: 'fix', i, at, hold: Infinity, key: `fix${i}` };
    },
  }),
  // Crank the generator and nothing else, torch on whatever turns up.
  cranker: (): Policy => ({
    skill: SKILL.competent,
    think(S, bot) {
      const w = bot.want,
        seen = known(S, bot).filter(k => k.how !== 'cams'),
        h = nearest(bot, seen);
      w.use = CRANK;
      if (h && dist(bot, h) < F.BEAM_RANGE) {
        w.face = ang(bot, h);
        w.on = true;
      }
    },
  }),
};

/* ---------- the things that must never happen ---------- */

const inside = (x: number, z: number) => x >= 0 && z >= 0 && x < M.SIZE_X && z < M.SIZE_Z;
// Flood the floor a mascot can stand on, from where the mascots start.
function flood(ducts: boolean): { has: (x: number, z: number) => boolean } {
  const step = 0.25,
    W = Math.ceil(M.SIZE_X / step),
    H = Math.ceil(M.SIZE_Z / step),
    seen = new Uint8Array(W * H),
    cell = (x: number, z: number) => Math.round(z / step) * W + Math.round(x / step);
  const ok = (x: number, z: number) => M.walkable(x, z, M.MASCOT_R) && (ducts || M.roomAt(x, z) !== M.DUCTS);
  const queue = (ducts ? [M.REST[2]] : [M.REST[0], M.REST[3]]).map((r): [number, number] => [Math.round(r.x / step) * step, Math.round(r.z / step) * step]);
  for (const [x, z] of queue) seen[cell(x, z)] = 1;
  for (let next = queue.pop(); next; next = queue.pop()) {
    const [x, z] = next;
    for (const [dx, dz] of [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
    ] as const) {
      const nx = x + dx,
        nz = z + dz;
      if (inside(nx, nz) && !seen[cell(nx, nz)] && ok(nx, nz)) {
        seen[cell(nx, nz)] = 1;
        queue.push([nx, nz]);
      }
    }
  }
  return { has: (x, z) => inside(x, z) && !!seen[cell(x, z)] };
}

// Things about the building that hold before anyone plays.
export function checkBuilding(): string[] {
  const failures: string[] = [];
  const bad = (what: string) => failures.push(`the building: ${what}`);
  const start = M.spawnPoint(0),
    reach = F.REACH - 0.3;
  const reachable = (label: string, at: Point, stand: Point) => {
    if (!M.walkable(stand.x, stand.z, M.PLAYER_R)) return bad(`${label}: nowhere to stand at ${stand.x.toFixed(1)}, ${stand.z.toFixed(1)}`);
    if (dist(stand, at) > reach) return bad(`${label}: its standing spot is out of reach`);
    const r = M.route(start.x, start.z, stand.x, stand.z, { r: M.PLAYER_R });
    if (!r.path.length) bad(`${label}: no route from the booth`);
  };
  M.BOXES.forEach((c, i) => {
    reachable(`box ${i}`, c, front(c));
  });
  reachable('generator', M.GENERATOR, front(M.GENERATOR));
  reachable('charger', M.CHARGER, front(M.CHARGER));
  reachable('Mini Biggs carton', M.TOY_BOX, front(M.TOY_BOX));
  M.BATTERY_SPOTS.forEach((b, i) => {
    reachable(`battery ${i}`, b, b);
  });
  // Every door has a button a guard can press from inside and from outside, so nobody is shut out for good.
  for (const k of DOORS) {
    const panel = M.PANELS[k],
      outside = OUTSIDE[k];
    reachable(`door ${k} inside`, panel, front(panel));
    if (!M.walkable(outside.x, outside.z, M.PLAYER_R) || dist(outside, panel) > reach) bad(`door ${k}: cannot be worked from outside`);
  }
  for (const i of MASCOTS) {
    const r = M.REST[i];
    if (!M.walkable(r.x, r.z, M.MASCOT_R)) bad(`${MASC[i].name} rests inside something`);
  }
  // Nowhere a guard can stand is out of every mascot's reach: the walkers everywhere but the ducts, Squish there.
  // A mascot that cannot get nearer reaches F.GRAB across furniture, so that is the distance that counts.
  const walkers = flood(false),
    squish = flood(true),
    R = F.GRAB - 0.25;
  let safe = 0,
    where = '';
  for (let x = 0.25; x < M.SIZE_X; x += 0.25)
    for (let z = 0.25; z < M.SIZE_Z; z += 0.25) {
      if (!M.walkable(x, z, 0.2)) continue;
      const f = M.roomAt(x, z) === M.DUCTS ? squish : walkers;
      let caught = false;
      for (let dx = -R; dx <= R && !caught; dx += 0.25)
        for (let dz = -R; dz <= R && !caught; dz += 0.25) caught = Math.hypot(dx, dz) < R && f.has(x + dx, z + dz) && M.reaches(x + dx, z + dz, x, z);
      if (!caught) {
        safe++;
        where ||= `${x}, ${z}`;
      }
    }
  if (safe) bad(`${safe} standing spots no mascot can reach, first at ${where}`);
  return failures;
}

/* ---------- one night ---------- */

// What one night came to, for the table. Times are seconds; firstFlat is 1e9 if nobody was flattened. failures
// says what went wrong in it, as "<scenario>: seed <n>: <what>": a softlock, or a night that broke its own rules.
export interface Outcome {
  failures: string[];
  win: boolean;
  t: number;
  flats: number;
  peels: number;
  by: Each<number>; // flattenings by each mascot
  warn: number[];
  firstFlat: number;
  notes: string[];
  hunted: number;
  calms: number;
  stood: number;
  lit: number;
  dead: number;
  low: number;
  dry: number;
  dryFlat: number;
  darkFlat: number;
  power: number;
  burnt: number;
  fixed: number;
  outs: number;
  cranked: number;
  shut: number;
  bangs: number;
  charging: number;
  toys: number;
  lured: number;
  hits: number;
}
// How play() reports: trace 1 prints the night's events, 2 also where everyone is each second (brains: and what each
// mascot is thinking). onStep is called with the state after every step, for the tests.
export interface PlayOptions {
  trace?: 0 | 1 | 2;
  brains?: boolean;
  onStep?: (S: NightState) => void;
}

// One guard's tick: a flat one calls for help, the rest look, think and act.
function tick(S: NightState, bot: Bot, team: Team, tickNo: number): void {
  const me = guardOf(bot);
  bot.bat = me.bat;
  if (me.flat) {
    if (!bot.flat) {
      bot.flat = true;
      bot.x = me.x;
      bot.z = me.z;
    }
    if (S.t - (bot.called || -9) > F.CALL_GAP) {
      bot.called = S.t;
      actFloor(sim, S, bot.id, { t: 'call' });
    }
    return;
  }
  bot.flat = false;
  if (me.hid >= 0) {
    bot.x = me.x;
    bot.z = me.z;
  }
  bot.want = { on: false };
  if ((tickNo + bot.i) % 3 === 0) perceive(S, bot);
  bot.policy.think(S, bot, team);
  act(S, bot);
}
// The --steps line: the time, where each guard is and what they want, then each mascot (brains: and its brain).
function traceLine(S: NightState, team: Team, brains: boolean): string {
  const guards = team.bots.map(b => {
    const doing = b.want.use?.key || (b.want.goal ? `go ${b.want.goal.x.toFixed(1)},${b.want.goal.z.toFixed(1)}` : '-');
    return `${b.flat ? 'FLAT' : ''}(${b.x.toFixed(1)},${b.z.toFixed(1)}) bat ${b.bat.toFixed(2)}${b.on ? '*' : ''} ${doing}`;
  });
  const mascots = S.m.map(m => {
    const brain = brains ? JSON.stringify({ ...brainOf(sim, m.i), path: brainOf(sim, m.i).path.length }) : '';
    return `${m.st}${m.lit ? '*' : ''}(${m.x.toFixed(0)},${m.z.toFixed(0)})${brain}`;
  });
  return `${S.t.toFixed(0).padStart(6)}  ${guards.join(' ')}  |  ${mascots.join(' ')}${S.stir ? '  STIR' : ''}`;
}

export function play(sc: Scenario, seed: number, { trace = 0, brains = false, onStep }: PlayOptions = {}): Outcome {
  seedRandom(seed);
  const S = newState('TEST');
  sim.players = {};
  const team: Team = { bots: [], fault: new Map() };
  for (let i = 0; i < sc.n; i++) {
    const id = `g${i}`;
    sim.players[id] = { id, name: `G${i}` };
    team.bots.push(makeBot(id, i, sc.guard(i, sc.n)));
  }
  startFloorNight(sim, S, sc.night);
  if (sc.dev) S.dev = sc.dev; // the sim reads only the cheats that are there
  for (const b of team.bots) {
    const { x, z } = guardOf(b);
    Object.assign(b, { x, z });
  }
  const out: Outcome = {
    failures: [],
    win: false,
    t: 0,
    flats: 0,
    peels: 0,
    by: [0, 0, 0, 0],
    warn: [],
    firstFlat: 1e9,
    notes: [],
    hunted: 0,
    calms: 0,
    stood: 0,
    lit: 0,
    dead: 0,
    low: 0,
    dry: 0,
    dryFlat: 0,
    darkFlat: 0,
    power: 0,
    burnt: 0,
    fixed: 0,
    outs: 0,
    cranked: 0,
    shut: 0,
    bangs: 0,
    charging: 0,
    toys: 0,
    lured: 0,
    hits: 0,
  };
  const fail = (what: string) => {
    if (out.failures.length < 60) out.failures.push(`${sc.name}: seed ${seed}: ${what}`);
  };
  const parked = S.m.map(m => ({ x: m.x, z: m.z, t: 0 }));
  let seenEv = 0,
    faultKey = '',
    calm = 0,
    flatKey = '',
    tickNo = 0;
  while (S.phase === 'play') {
    now += DT * 1000;
    tickNo++;
    const fk = S.faults.map(f => (f ? 1 : 0)).join('');
    if (fk !== faultKey || team.bots.map(b => +b.flat).join('') !== flatKey) {
      faultKey = fk;
      flatKey = team.bots.map(b => +b.flat).join('');
      assignFaults(S, team);
    }
    for (const bot of team.bots) {
      tick(S, bot, team, tickNo);
      if (bot.still > 45) {
        fail(`guard ${bot.i} could not move at ${bot.x.toFixed(1)}, ${bot.z.toFixed(1)} for 45 s`);
        bot.still = 0;
      }
    }
    stepFloor(sim, S, now);
    onStep?.(S);
    if (trace === 2 && tickNo % 10 === 0) console.log(traceLine(S, team, brains));

    // Measure.
    let anyHunted = false;
    S.players.forEach((p, gi) => {
      if (p.flat) return;
      out.stood += DT;
      if (p.on) out.lit += DT;
      if (p.bat <= 0) out.dead += DT;
      if (p.bat < 0.25) out.low += DT;
      const bot = defined(team.bots[gi], `bot ${gi}`); // S.players and team.bots are in the same order
      if (p.bat <= 0 && !bot.wasDry) {
        out.dry++;
        bot.dryAt = S.t;
      }
      bot.wasDry = p.bat <= 0;
      if (S.m.some(m => COMING.includes(m.st) && brainOf(sim, m.i).tgt === p.id)) {
        out.hunted += DT;
        anyHunted = true;
      }
      if (tickNo % 5 === gi % 5)
        for (const m of S.m)
          if (perceivable(S, p, m)) {
            if (S.t - bot.lastSeen[m.i] > 1.5) bot.firstSeen[m.i] = S.t;
            bot.lastSeen[m.i] = S.t;
          }
    });
    if (S.crank) out.cranked += DT;
    out.shut += DT * Object.values(S.doors).filter(Boolean).length;
    out.charging += DT * S.players.filter(p => p.act === 'charge' && !p.flat && p.bat < 1 && !S.out).length;
    if (anyHunted) {
      if (calm >= 20) out.calms++;
      calm = 0;
    } else calm += DT;
    for (const e of S.evs)
      if (e.id > seenEv) {
        seenEv = e.id;
        if (trace && !['bang', 'hour'].includes(e.type))
          console.log(`${S.t.toFixed(1).padStart(6)}  ${e.type} ${e.x == null ? '' : JSON.stringify(e.x)}  power ${S.power.toFixed(0)}`);
        if (e.type === 'flat') {
          const { by } = e.x,
            gi = S.players.findIndex(p => p.id === e.x.id),
            bot = team.bots[gi];
          if (!bot) {
            fail(`${e.x.id}, who is not playing, was flattened`);
            continue;
          }
          const m = defined(S.m[by], `mascot ${by}`),
            first = bot.firstSeen[by];
          out.flats++;
          out.by[by]++;
          out.firstFlat = Math.min(out.firstFlat, S.t);
          // firstSeen is null only before it was seen, and then lastSeen is too long ago.
          out.warn.push(first !== null && S.t - bot.lastSeen[by] < 1.5 ? S.t - first : 0);
          if (bot.bat <= 0) {
            out.darkFlat++;
            if (bot.dryAt !== undefined && S.t - bot.dryAt < 20) out.dryFlat++;
          }
          out.notes.push(
            `seed ${seed} ${S.t.toFixed(0)}s ${MASC[e.x.by].name.split(' ').pop()} got g${gi} in ${M.ROOMS3[M.roomAt(e.x.x, e.x.z)]?.name}; was ${bot.want.use?.key || (bot.want.goal ? 'walking' : 'standing')}, torch ${bot.bat.toFixed(2)}${bot.on ? ' on' : ''}, knew of ${known(S, bot).length}, ${S.m.filter(o => COMING.includes(o.st)).length} hunting, it was rot ${m.rot}${m.lit ? ' lit' : ''}, power ${S.power.toFixed(0)}${S.stir ? ', stir' : ''}`
          );
        } else if (e.type === 'peel') out.peels++;
        else if (e.type === 'bang') out.bangs++;
        else if (e.type === 'toy') {
          out.toys++;
          out.lured += S.m.filter(m => m.st === 'search' && brainOf(sim, m.i).last?.x === e.x.x && brainOf(sim, m.i).last?.z === e.x.z).length;
        } else if (e.type === 'bonk') out.hits++;
        else if (e.type === 'out') out.outs++;
      }

    // Softlocks.
    if (S.players.every(p => p.flat) && S.phase === 'play') {
      fail(`everyone is flat and the night goes on`);
      break;
    }
    if (S.t > 6 * F.HOUR + 1) {
      fail(`past 6 AM and still playing`);
      break;
    }
    S.m.forEach((m, i) => {
      const p = defined(parked[i], `where mascot ${i} stood`); // one per mascot
      if (!Number.isFinite(m.x + m.z + m.yaw)) fail(`${MASC[m.i].name} is nowhere`);
      if (!['roam', 'search', 'hunt'].includes(m.st) || m.lit || dist(m, p) > 0.5) Object.assign(p, { x: m.x, z: m.z, t: S.t });
      else if (S.t - p.t > 30) {
        fail(`${MASC[m.i].name} stood ${m.st}ing at ${m.x.toFixed(1)}, ${m.z.toFixed(1)} for 30 s`);
        p.t = S.t;
      }
    });
  }
  if (calm >= 20) out.calms++;
  Object.assign(out, { win: S.phase === 'win' || S.phase === 'won', t: S.t, power: S.power, burnt: S.tally.burnt, fixed: S.tally.fixed });
  if (S.phase === 'play') fail(`the night did not end`);
  return out;
}

/* ---------- the scenarios ---------- */

// One way of playing one night. n: guards. guard(i, n): how guard i plays. dev: cheats for the night. noMiss: no
// fault may burn. worse: the scenario this one, a strategy that should not work, has to do clearly worse than.
export interface Scenario {
  name: string;
  n: number;
  night: number;
  guard: (i: number, n: number) => Policy;
  dev?: Partial<Dev>;
  noMiss?: boolean;
  worse?: string;
}

const all = (policy: Policy) => () => policy;
export const scenarios: Scenario[] = [];
const add = (name: string, n: number, night: number, guard: Scenario['guard'], expect: Pick<Scenario, 'dev' | 'noMiss' | 'worse'> = {}) =>
  scenarios.push({ name: `${name} n${night}`, n, night, guard, ...expect });

// The building with nothing moving in it: every fault can be fixed before it burns.
for (const n of [1, 2, 4, 6]) add(`empty building x${n}`, n, 1, all(honest('competent')), { dev: { freeze: true }, noMiss: true });
for (const night of [1, 3, 5]) add('solo careless', 1, night, all(honest('careless')));
for (const night of [1, 2, 3, 4, 5]) add('solo competent', 1, night, all(honest('competent')));
for (const night of [1, 3, 5]) add('solo expert', 1, night, all(honest('expert')));
for (const n of [2, 3, 4, 6]) for (const night of [1, 2, 3, 4, 5]) add(`crew of ${n} competent`, n, night, all(honest('competent')));
for (const night of [1, 5]) add('crew of 4 careless', 4, night, all(honest('careless')));
for (const night of [3, 5]) add('crew of 4 expert', 4, night, all(honest('expert')));
// A crew that splits up but leaves each other on the floor, and one that never cranks: what coordination is worth.
add('crew of 4, no peels', 4, 5, all(honest('competent', { peels: false })));
add('crew of 4, no crank', 4, 5, all(honest('competent', { cranks: false })));
// Ducking into a locker when something is after you and cannot see you: what the lockers are worth.
for (const night of [1, 3, 5]) add('solo competent, hides', 1, night, all(honest('competent', { hides: true })));
for (const night of [3, 5]) add('crew of 3 competent, hides', 3, night, all(honest('competent', { hides: true })));

// The ones that must not work. worse: the proper scenario each has to do clearly worse than.
const sitter = honest('competent', { faults: false, stays: true, peels: false, cranks: false });
const bad = (name: string, n: number, guard: Scenario['guard']) => {
  for (const night of [1, 3]) add(name, n, night, guard, { worse: `${n === 1 ? 'solo' : `crew of ${n}`} competent n${night}` });
};
bad('x4 turtle: doors shut, nobody moves', 4, all(DEGENERATE.turtle()));
bad('x1 turtle', 1, all(DEGENERATE.turtle()));
bad('x4 turtle, toys at the doors', 4, all(DEGENERATE.turtle(true)));
bad('x4 toy spam from the booth', 4, all(DEGENERATE.spam()));
bad('x1 toy spam from the booth', 1, all(DEGENERATE.spam()));
bad('x4 one cranks, three hide', 4, i => (i ? DEGENERATE.turtle() : DEGENERATE.cranker()));
bad('x4 corner with torches', 4, all(DEGENERATE.corner({ x: 1, z: 12.5, look: Math.PI / 4 })));
bad('x4 booth corner with torches', 4, all(DEGENERATE.corner({ x: 15.8, z: 42.6, look: Math.PI * 0.75 })));
bad('x4 ignore the faults, mind the doors', 4, i => honest('competent', { faults: false, stays: true, cranks: i === 3 }));
bad('x1 ignore the faults, mind the doors', 1, all(honest('competent', { faults: false, stays: true })));
bad('x4 one runner, three never leave', 4, i => (i ? sitter : honest('competent', { share: 0.01 })));
bad('x4 camp the charger', 4, all(DEGENERATE.dock()));
bad('x1 kite round the loop', 1, all(DEGENERATE.kite()));
bad('x4 sit in the ducts', 4, all(DEGENERATE.hole({ x: 20, z: 34.75, dx: 1.2 })));
bad('x2 stand in the vent doorway', 2, all(DEGENERATE.hole({ x: 22.9, z: 36.25, dx: 0, dz: 0.2 })));
bad('x1 sit in a locker all night', 1, all(DEGENERATE.locker()));
bad('x4 sit in lockers all night', 4, all(DEGENERATE.locker()));
bad('x1 stand at a box, hands in', 1, all(DEGENERATE.box()));
bad('x4 stand at a box, hands in', 4, all(DEGENERATE.box()));
bad('x2 stand in the duct mouth', 2, all(DEGENERATE.hole({ x: 15.9, z: 33.25, dx: 0, dz: 0.2 })));
