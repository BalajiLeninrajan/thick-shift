// The shapes of everything the simulation shares: the state S the room keeps and sends to every guard's browser ten
// times a second, the thinking that never leaves whoever runs the night, and every message that goes over the room's
// socket
// (packages/game/src/net.ts and packages/game/worker/room.ts). Types only: nothing here exists at runtime.

/* ---------- small things ---------- */

// A random number in [0, 1), as Math.random gives. The caller supplies it (see Sim in sim.ts).
export type Rng = () => number;

export interface Point {
  x: number;
  z: number;
}
// [x0, z0, x1, z1] in metres.
export type Rect = [number, number, number, number];

// A list known to hold at least one entry, so [0] reads the entry rather than possibly undefined. isNonEmpty
// (check.ts) narrows a plain array to one.
export type NonEmpty<T> = readonly [T, ...T[]];

// The booth's three ways in: left door, vent, right door.
export type DoorKey = 'L' | 'V' | 'R';
// Which booth doors are shut.
export type Doors = Record<DoorKey, boolean>;

/* ---------- the state S ---------- */

// 'lobby' until a guard starts night 1, then 'play'. A night ends in 'win', 'dead' or, after the last one, 'won'.
export type Phase = 'lobby' | 'play' | 'win' | 'dead' | 'won';

// What a guard's hands are on while they hold the use key: the generator's crank, the charging dock, or a breaker box.
export type GuardAct = '' | 'crank' | 'charge' | 'fix';

// A guard as they join the room (joinFloor), before their first night places them.
export interface Joined {
  id: string; // made up by the guard's own page (newId in packages/game/src/net.ts)
  name: string;
}
// A guard on the floor. The same object sits in S.players and in Sim.players, so a change to one is a change to the
// other.
export interface Guard extends Joined {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  on: boolean; // torch on
  ph: boolean; // phone up, reading the minimap
  bat: number; // torch battery, 0 to 1
  flat: boolean;
  flatBy: MascotIndex | -1; // the mascot that flattened them, or -1
  sp: boolean; // sprinting
  act: GuardAct;
  // S.t before which no mascot can see or flatten them: just after a peel, a mascot opening their locker, or one
  // catching them at a breaker box
  safe: number;
  callAt: number; // S.t before which their next call for help is ignored
  hid: number; // the locker (HIDES index) they are in, or -1
  // S.t before which their hands shake: just after a mascot pulled them out of a locker or caught them at a breaker
  // box. Getting into a locker is loud, and a mascot that reaches them at either gives no second start.
  shaky: number;
  inAt: number; // S.t they got into the locker they are in
  fixAt: number; // S.t they last put their hands in a breaker box
  toy: boolean; // holding their Mini Biggs
}
// A guard in S.players at any time: a guard who joined after the night began has only their id and name until the
// next step places them (stepFloor).
export type Player = Joined & Partial<Omit<Guard, keyof Joined>>;

// What a mascot is doing. rest: standing on its mark, switched off. roam: walking somewhere. search: going to look at
// something it heard or lost. hunt: after a guard. windup and charge: Stompy's run. stun: Stompy after hitting a wall,
// or any of them hit by a thrown Mini Biggs. feast: sitting on a guard it flattened. siege: banging on a shut booth
// door.
export type MascotState = 'rest' | 'roam' | 'search' | 'hunt' | 'windup' | 'charge' | 'stun' | 'feast' | 'siege';

// The cast, by their place in MASC (config.ts): Big Biggs, Madame Flan, Squish, Stompy. Every table kept per mascot
// is a PerMascot, so reading one by a MascotIndex always finds an entry.
export type MascotIndex = 0 | 1 | 2 | 3;
export type PerMascot<T> = readonly [T, T, T, T];

// A mascot as every guard's browser sees it. i: its MASC index. rot: how far it has come apart, 0 to 2. lit: a torch is on it.
// ire: what torchlight and slammed doors have added to its rot.
export interface Mascot {
  i: MascotIndex;
  x: number;
  z: number;
  yaw: number;
  st: MascotState;
  rot: number;
  lit: boolean;
  ire: number;
}

// An open fault in a breaker box. k: its kind (an index into F.FIX). at: S.t when it broke out. burnt: it has started
// on the ceiling.
export interface Fault {
  k: number;
  at: number;
  burnt: boolean;
}

// A thrown Mini Biggs that nobody has picked up. by: the thrower's id. x0, z0: where it left the hand. x, z: where
// it lands. at: S.t when it was thrown. land: S.t when it lands. heard: it has sung. One that hits a mascot on the way
// comes down at its feet there and then: x, z and land change to that.
export interface Toy {
  id: number;
  by: string;
  x0: number;
  z0: number;
  x: number;
  z: number;
  at: number;
  land: number;
  heard: boolean;
}

// What the end screens count. flats: [guard's name, mascot index]. peels: the peeler's name.
export interface Tally {
  fixed: number;
  burnt: number;
  flats: [name: string, by: MascotIndex][];
  peels: string[];
}

// The dev menu's cheats (packages/game/src/dev.ts). Any guard in the room sets them with a dev command (devFloor in
// session.ts), and the sim reads them.
// rot and dread: -1 leaves them to the night. The dev menu sets all of them; the balance harness sets only some
// (`{ freeze: true }`), so S.dev is a Partial<Dev>, and a missing field reads as off everywhere the sim looks at it.
export interface Dev {
  god: boolean;
  power: boolean;
  freeze: boolean;
  wake: boolean;
  speed: number;
  rot: number;
  dread: number;
}

// What each event carries in its x, by type. undefined: nothing.
export interface EventData {
  fault: { i: number; x: number; z: number }; // i: the box
  burn: undefined;
  on: undefined; // the power is back
  out: undefined; // the power is gone
  stir: undefined;
  calm: undefined;
  hour: undefined;
  win: undefined;
  scare: undefined; // the last guard standing was flattened
  toy: { by: string; x: number; z: number };
  flat: { id: string; by: MascotIndex; x: number; z: number };
  spot: { i: MascotIndex; id: string; x: number; z: number };
  found: { i: MascotIndex; id: string; h: number; x: number; z: number }; // h: the locker
  startle: { i: MascotIndex; id: string; x: number; z: number }; // caught at a breaker box, and let run
  check: { i: MascotIndex; h: number; x: number; z: number };
  crash: { x: number; z: number };
  bonk: { i: MascotIndex; by: string; x: number; z: number }; // a thrown Mini Biggs hit mascot i
  bang: DoorKey;
  arrive: DoorKey;
  roar: { i: MascotIndex; x: number; z: number };
  call: { id: string; x: number; z: number };
  fix: { i: number; by: string; x: number; z: number };
  fumble: { k: DoorKey; by: string };
  door: boolean; // the door is now shut
  bat: { by: string };
  grab: { by: string; x: number; z: number };
  locker: { i: number; id: string; in: boolean; loud: boolean; x: number; z: number }; // loud: banged shut by shaking hands
  peel: { id: string; by: string; x: number; z: number };
}
export type EventType = keyof EventData;
// One entry in S.evs. id counts up through the night (S.evId), so a client reacts to each once.
export type SimEvent = {
  [K in EventType]: EventData[K] extends undefined ? { id: number; type: K; x?: undefined } : { id: number; type: K; x: EventData[K] };
}[EventType];

// A room's state before its first night (newState). deaths counts the whole run.
export interface LobbyState {
  phase: Phase;
  night: number;
  t: number; // seconds into the night
  power: number; // percent
  doors: Doors;
  m: Mascot[];
  players: Player[];
  killer: MascotIndex | -1; // the mascot that ended the night, or -1
  evs: SimEvent[]; // the last ten events
  evId: number;
  deaths: number;
  code: string;
  dev?: Partial<Dev>;
}
// The state once a night has started (startFloorNight).
export interface NightState extends LobbyState {
  players: Guard[];
  cap: number; // percent of power the building can still hold
  out: boolean; // the power is out; S.power is 0 for exactly as long as this is set
  restart: number; // with the power out, how far the crank is to bringing it back, 0 to 1
  stir: boolean; // the mascots are in a wave
  crank: boolean; // someone is turning the crank
  round: number; // the last hour the night has counted, or -1
  waveAt: number; // S.t when the mascots next stir or settle
  faults: (Fault | null)[]; // one per breaker box (BOXES)
  tally: Tally; // this night's
  total: Tally; // the whole run's
  batN: number; // the night's batteries, lying about or due back
  bats: number[]; // the BATTERY_SPOTS that have one lying there
  toys: Toy[];
  toyId: number;
  toyBox: number; // Mini Biggses left in the booth's carton (TOY_BOX)
}
// S as it is sent and received: a lobby state, or a night's.
export type State = LobbyState & Partial<Omit<NightState, keyof LobbyState>>;

/* ---------- the mascots' thinking ---------- */

// Where a mascot reaching over furniture for a guard started: who, how far, where they stood, and when.
export interface Reach {
  id: string;
  d: number;
  x: number;
  z: number;
  t: number;
}
// What one mascot is thinking. It is never sent. Browsers get the result (m.st, m.x, m.z, m.yaw).
export interface Brain {
  path: Point[];
  repath: number;
  dest: Point | null;
  tgt: string | null; // the guard it is after
  last: Point | null; // where it last knew they were, or what it heard
  lost: number;
  timer: number;
  bangs: number;
  cool: number;
  dir: Point | null; // a charge's heading
  stuck: number;
  key: DoorKey | null; // the shut door in its way
  home: boolean;
  spent: boolean;
  woke: boolean;
  notice: number;
  stared: number;
  reach: Reach | null;
  knows: number; // the locker it saw a guard step into, or -1
  sniff: number;
  checks: number[]; // the lockers it means to look in
  since: number; // S.t when it took up what it is doing now
  was: MascotState | null; // what that is, as of its last think; null before the first
  noShort: number; // S.t before which it will not cut straight across to its guard again
  near: number; // how close it has come to where it last saw its guard since it lost them
  nearAt: number; // and when it last got closer
  song: Point | null; // where the last Mini Biggs it went to was singing (lured in sim.ts)
  wise: number; // S.t before which a Mini Biggs does nothing to it
}

/* ---------- the wire ---------- */

// A guard's action, sent by their own browser (packages/game/src/three/player.ts) to the room, or in a night played
// solo handed straight to commandFloor. It comes off the wire as JSON from someone else's browser, so actFloor checks
// every field.
export type UseWhat = 'fix' | 'door' | 'bat' | 'toy' | 'carton' | 'hide' | 'peel';
export type Action =
  | { t: 'name'; n: string }
  // Where the guard's own browser has moved them, and what they are doing.
  | { t: 'p'; x: number; z: number; yaw: number; pitch: number; on: boolean; ph?: boolean; sp: boolean; act: GuardAct }
  // A flat guard calling for help.
  | { t: 'call' }
  // A Mini Biggs thrown along yaw, d metres.
  | { t: 'throw'; yaw: number; d: number }
  // i: a box, battery spot or locker. k: a door. id: a toy (number) or a flat guard (string). A solo night hands
  // actFloor the object player.ts built, which can carry a field set to undefined (copied from its Target); JSON drops
  // those on the way to a room.
  | { t: 'use'; what: UseWhat; i?: number | undefined; k?: DoorKey | undefined; id?: string | number | undefined };

// The dev menu's cheats (packages/game/src/dev.ts), which devFloor runs: switch cheats on or off (set), a one-off
// change to the night (do), or one for a mascot (i, its MASC index). Like an action, it comes off the wire.
export type DevDo = 'hour' | 'late' | 'win' | 'next' | 'final' | 'low' | 'out' | 'bat' | 'peel';
export type DevCommand = { t: 'dev'; set: Partial<Dev> } | { t: 'dev'; do: DevDo } | { t: 'dev'; do: 'near' | 'home'; i: number };
// Anything a guard's browser sends whoever runs the night (commandFloor): an action, 'go' to start the next night
// from the card between nights, or a dev cheat.
export type Command = Action | { t: 'go' } | DevCommand;

// Why a room turned a socket away (worker/room.ts): an id or mode it will not use (1008, policy violation), nobody playing
// under the code someone tried to join, a code taken when someone tried to start a room, or a page from an older build.
export type CloseCode = 1008 | 4404 | 4409 | 4426;

// Room to every guard in it: the whole state, ten times a second during a night and whenever it changes between nights.
export interface StateMessage {
  t: 's';
  s: State;
}
