// The shapes of everything the simulation shares: the state S the host keeps and sends to every guest ten times a
// second, the host's own thinking that never leaves it, and every message that goes over the room's socket
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

// 'lobby' until the host starts night 1, then 'play'. A night ends in 'win', 'dead' or, after the last one, 'won'.
export type Phase = 'lobby' | 'play' | 'win' | 'dead' | 'won';

// What a guard's hands are on while they hold the use key: the generator's crank, the charging dock, or a breaker box.
export type GuardAct = '' | 'crank' | 'charge' | 'fix';

// A guard as they join the room: what net.ts knows before their first night places them.
export interface Joined {
  id: string; // 'host' for the first host, or the guest's peer id
  name: string;
}
// A guard on the floor. The same object sits in S.players and in the host's Sim.players, so the host's changes to
// one are changes to the other.
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
  safe: number; // S.t before which no mascot can flatten them (after a peel)
  callAt: number; // S.t before which their next call for help is ignored
  hid: number; // the locker (HIDES index) they are in, or -1
  toy: boolean; // holding their Mini Biggs
}
// A guard in S.players at any time: a guard who joined after the night began has only their id and name until the
// next step places them (stepFloor), and a host from before the toys sent no toy.
export type Player = Joined & Partial<Omit<Guard, keyof Joined>>;

// What a mascot is doing. rest: standing on its mark, switched off. roam: walking somewhere. search: going to look at
// something it heard or lost. hunt: after a guard. windup and charge: Tank's run. stun: Tank after hitting a wall.
// feast: sitting on a guard it flattened. siege: banging on a shut booth door.
export type MascotState = 'rest' | 'roam' | 'search' | 'hunt' | 'windup' | 'charge' | 'stun' | 'feast' | 'siege';

// The cast, by their place in MASC (config.ts): Big Biggs, Madame Flan, Squish, Tank. Every table kept per mascot
// is a PerMascot, so reading one by a MascotIndex always finds an entry.
export type MascotIndex = 0 | 1 | 2 | 3;
export type PerMascot<T> = readonly [T, T, T, T];

// A mascot as every guest sees it. i: its MASC index. rot: how far it has come apart, 0 to 2. lit: a torch is on it.
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
// it lands. at: S.t when it was thrown. land: S.t when it lands. heard: it has sung.
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

// The dev menu's cheats (packages/game/src/dev.ts). Only the host sets them; the sim reads them.
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
  check: { i: MascotIndex; h: number; x: number; z: number };
  crash: { x: number; z: number };
  bang: DoorKey;
  arrive: DoorKey;
  quit: { i: MascotIndex; x: number; z: number };
  roar: { i: MascotIndex; x: number; z: number };
  call: { id: string; x: number; z: number };
  fix: { i: number; by: string; x: number; z: number };
  fumble: { k: DoorKey; by: string };
  door: boolean; // the door is now shut
  bat: { by: string };
  grab: { by: string; x: number; z: number };
  locker: { i: number; id: string; in: boolean; x: number; z: number };
  peel: { id: string; by: string; x: number; z: number };
}
export type EventType = keyof EventData;
// One entry in S.evs. id counts up through the night (S.evId), so a client reacts to each once.
export type SimEvent = {
  [K in EventType]: EventData[K] extends undefined ? { id: number; type: K; x?: undefined } : { id: number; type: K; x: EventData[K] };
}[EventType];

// A room's state before its first night (newState). deaths and slams count the whole run.
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
  slams: number;
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
  total: Tally | null; // the whole run's; null only between restartFloor and the night it starts
  flats?: number; // guards flattened over the run
  batN: number; // the night's batteries, lying about or due back
  bats: number[]; // the BATTERY_SPOTS that have one lying there
  toys: Toy[];
  toyId: number;
}
// S as it is sent and received: a lobby state, or a night's. A host from before some fields existed (batN, waveAt,
// toys) may not have sent them; adoptFloor fills them in.
export type State = LobbyState & Partial<Omit<NightState, keyof LobbyState>>;

/* ---------- the host's thinking ---------- */

// Where a mascot reaching over furniture for a guard started: who, how far, where they stood, and when.
export interface Reach {
  id: string;
  d: number;
  x: number;
  z: number;
  t: number;
}
// What one mascot is thinking. Host only: guests get the result (m.st, m.x, m.z, m.yaw). since, was and noShort are
// added the first time they are needed, after the rest, so a brain's keys keep today's order.
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
  wind: number;
  stared: number;
  reach: Reach | null;
  knows: number; // the locker it saw a guard step into, or -1
  sniff: number;
  checks: number[]; // the lockers it means to look in
  since?: number;
  was?: MascotState;
  noShort?: number;
}

/* ---------- the wire ---------- */

// A guard's action, sent by their own browser (packages/game/src/three/player.ts) or, for the host, handed straight
// to actFloor. It comes off the wire as JSON from someone else's browser, so actFloor checks every field.
export type UseWhat = 'fix' | 'door' | 'bat' | 'toy' | 'hide' | 'peel';
export type Action =
  | { t: 'name'; n: string }
  // Where the guard's own browser has moved them, and what they are doing.
  | { t: 'p'; x: number; z: number; yaw: number; pitch: number; on: boolean; ph?: boolean; sp: boolean; act: GuardAct }
  // A flat guard calling for help.
  | { t: 'call' }
  // A Mini Biggs thrown along yaw, d metres.
  | { t: 'throw'; yaw: number; d: number }
  // i: a box, battery spot or locker. k: a door. id: a toy (number) or a flat guard (string). The host's own browser
  // hands actFloor the object it built, which can carry a field set to undefined (player.ts copies them from its
  // Target); JSON drops those for a guest's.
  | { t: 'use'; what: UseWhat; i?: number | undefined; k?: DoorKey | undefined; id?: string | number | undefined };

// The relay's close codes (worker/room.ts): nobody is hosting this code, somebody already is, or a guest id it
// will not use (1008, policy violation).
export type CloseCode = 1008 | 4404 | 4409;

// Host to relay to every guest: the whole state, ten times a second.
export interface StateMessage {
  t: 's';
  s: State;
}
// Relay to a guest: you are the host now (guests: the others' ids), or a new host has taken over (say your name again).
export type RelayToGuest = { t: 'host'; guests: string[] } | { t: 'rehost' };
// What a guest's socket receives.
export type GuestInbox = StateMessage | RelayToGuest;
// Relay to host: a guest's message, wrapped with who sent it, or a guest coming or going.
export interface HostInbox {
  from: string;
  d: Action | { t: 'join' } | { t: 'leave' };
}
// Either end to relay, as plain text, not JSON: this tab has gone to the background or come back.
export type Visibility = 'hidden' | 'shown';
