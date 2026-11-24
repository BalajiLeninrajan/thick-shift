# @thick-shift/sim: the contract

How the night simulation is called, and the rules its callers rely on. `src/sim.ts` is the night,
`src/session.ts` is what whoever runs a night does with the guards' browsers, and `src/types.ts` has the types.

## Layout

| Import | File | What |
|---|---|---|
| `@thick-shift/sim` | `src/index.ts` | everything below, the night and the session included |
| `@thick-shift/sim/check` | `src/check.ts` | `assert`, `defined`, `isNonEmpty`, `isPlaced`, `isNight` |
| `@thick-shift/sim/config` | `src/config.ts` | `FINAL_NIGHT`, `DOORS`, `STAMINA`, `DEFAULT_NAME`, `NAME_MAX`, `MASC`, the mascots by name |
| `@thick-shift/sim/map` | `src/map.ts` | rooms, doorways, fixtures, the footprint (`SIZE_X`, `SIZE_Z`), `dist`, `angDiff`, `rectMid`, `doorwayOf`, `walkable`, `slide`, `clear`, `sees`, `reaches`, `glimpses`, `standNear`, `roomAt`, `route`, `nav`, `walls`, `slabs`, ... |
| `@thick-shift/sim/dressing` | `src/dressing.ts` | `FOOT`, `GEN_BACK`, `DRESSING`, `obstacles` |
| `@thick-shift/sim/data` | `src/data.ts` | `LAMPS`, `DEAD_TUBES`, `TUBE`, `GREEN`, `STAGE` |
| `@thick-shift/sim/types` | `src/types.ts` | `State`, `NightState`, `Guard`, `Mascot`, `SimEvent`, `Brain`, `Action`, the wire messages (`Command`, `StateMessage`, `CloseCode`), `Rng` |

The package is TypeScript that Node 22 runs by stripping the types, so relative imports name the `.ts` file and the
code uses nothing stripping cannot erase (no enums, no parameter properties, no namespaces). Its tsconfig is strict
with no DOM. Code in the game imports it by package name (`packages/game` depends on it, `workspace:*`). Node tools
import the source by relative path (`../packages/sim/src/map.ts`), because `tools/` is not a package.

`map.ts` keeps three module-level caches: the obstacle buckets, the waypoint graph (`nav()`) and the last rect
`walkable()` matched. They depend only on the building and never change an answer, so they stay in the module rather
than on the caller.

## The night

```ts
type Rng = () => number; // [0, 1), like Math.random

interface SimOptions { rng: Rng; now: number }

interface Sim {
  rng: Rng;                        // every random draw the night makes; the caller may swap it between calls
  players: Record<string, Player>; // guard id -> that guard's record
  brains: Brain[];                 // what each mascot is thinking, never sent
  batTimers: number[];
  crankNoise: number;
  nextFault: number;
  lastStep: number;                // ms on the caller's clock
}

newSim(opts: SimOptions): Sim
newState(code: string): State
startFloorNight(sim: Sim, S: State, n: number): asserts S is NightState
restartFloor(sim: Sim, S: State): void
adoptFloor(sim: Sim, S: State, now: number): void
stepFloor(sim: Sim, S: State, now: number): void
actFloor(sim: Sim, S: State, pid: string, a: Action): void
brainOf(sim: Sim, i: number): Brain

// session.ts: a guard in or out of the room, and anything their browser sends
joinFloor(sim: Sim, S: State, id: string, was?: Player): void
leaveFloor(sim: Sim, S: State, id: string): void
commandFloor(sim: Sim, S: State, pid: string, c: unknown): boolean   // true if it started a night

// Pure. Clients call them with any S.
F, TOY
hourF(S), clockF(S), lightsF(S), dreadF(S)
darkRoom(S, room), faultLeft(S, f), landing(S, x, z, yaw, d)
```

### No singleton

Nothing in the package keeps a night's state at module level. What only the runner of a night knows lives on the
`Sim` record the caller makes with `newSim()` and passes in. `S` is passed beside it, never stored on it, because
the pages in a room hold an `S` and no `Sim`.

- There is one `Sim` per room's Durable Object (`packages/game/worker/room.ts`), one per page playing solo
  (`packages/game/src/net.ts`), and one per worker thread in the balance harness. `startFloorNight` resets `brains`,
  `nextFault`, `batTimers` and `crankNoise`. It does not touch `lastStep` or `players`.
- `sim.players[id]` and that guard's entry in `S.players` are the same object. `stepFloor` sets
  `S.players = Object.values(sim.players)` on every call, and `startFloorNight` does the same after placing them.
  Guards come and go through `joinFloor` and `leaveFloor`, or by writing `sim.players` (the harness setting up a
  night, the room restoring one). Nothing adds or removes them in `S.players`.
- `adoptFloor` makes up a `Sim`'s thinking for a night it has only the `S` of: a room's object restarted after a
  deploy, or a page that lost its room and carries on solo.
- `brainOf(sim, i)` returns `sim.brains[i]`. Only the harness and the tests read it.

### The random numbers

Every draw goes through `sim.rng()`. A change to when or how the sim draws changes every seeded night after it, and
the test snapshots with it:

- `rnd(a, b)` is `a + sim.rng() * (b - a)`.
- `pick(list)` is `list[(sim.rng() * list.length) | 0]`.
- The night's battery spots are shuffled Fisher-Yates:
  `for (let i = spots.length - 1; i > 0; i--) { const j = (sim.rng() * (i + 1)) | 0; swap(i, j); }`
- Fault kinds are `(sim.rng() * F.FIX.length) | 0`.
- Some draws sit behind a short-circuit: `noise()` draws only after the state, home, charmed and distance
  tests pass (`charmed()`: taken up with a Mini Biggs, power on); `sing()` (a Mini Biggs's song) draws once per
  mascot, in `S.m` order, only after the state, home, `wise` and distance tests pass, and draws no timer;
  `flyToys()` (a direct hit) draws nothing; `lockersNear()` draws
  only for lockers within `CHECK.near`; `pickDest()` draws for Squish's booth
  chance only when a guard is in the booth and `b.barred` has passed (a guard's room drawn while it has not, when that
  room is the booth, is rejected and a room drawn as for any rejected room), and for the crank chance only when `S.crank`; `flatten()` draws
  through `pickDest()` only if a guard is still standing (and never under the dev god mode, which catches
  nobody); `pickDest()` with a body rejects a room within `AWAY` of it and draws another, and draws a point up
  to eight times until one is `AWAY` clear; its power-out pick is over the standing guards the mascot does not
  shun, and with none it falls through to the room draw.
- A mascot walking away from a guard it caught (`b.away`) passes the body to every `pickDest()` it makes until
  the walk is done, so a walk that jams redraws clear of the body too. In a calm it draws no rest timer until
  the walk is done and it has gone home. While a guard it flattened lies within `AWAY` of its `REST` mark it
  does not go home: it keeps drawing through `pickDest()` with that body, and the roam pause between walks,
  where a calm would have drawn one rest timer. It makes no draw of its own for this.
- An expression with two draws takes them left to right.

Distances come from `hypot` in `map.ts`, the plain `Math.sqrt(x * x + z * z)`, and `dist(a, b)` beside it. `Math.hypot` rounds differently in the
last bits, so switching to it would move the seeded snapshots.

The game passes `rng: Math.random`. Its other random numbers (a room's code, a guard's id, the sounds) are not part
of any seeded run and use `Math.random` directly.

### Time

The sim never reads a clock. The caller passes `now` in milliseconds on its own clock:

- `newSim({ now })` sets `sim.lastStep`.
- `stepFloor(sim, S, now)` computes `dt = Math.min(0.25, (now - sim.lastStep) / 1000) * (S.dev?.speed || 1)`, then
  sets `sim.lastStep = now`, before it returns for a phase other than `'play'`.
- `adoptFloor(sim, S, now)` sets `sim.lastStep = now`.

### Untrusted input

`actFloor` and `commandFloor` take JSON from someone else's browser. Every field they read is checked first
(`num()`, `includes`, `Number.isFinite`, `Number.isInteger`), and a message that is not what it claims does nothing.

### Types

`State` is what goes over the wire: a `LobbyState` (what `newState` returns) with the night's fields optional, because
the lobby has none of them. `NightState` is the state once `startFloorNight` has run, with every field present and
`players: Guard[]`. `startFloorNight` is an assertion function, so after the call the caller's `S` is a `NightState`.
Inside a night the sim narrows `State` to `NightState`. `Player` is a guard as `joinFloor` adds them (`{ id, name }`)
with the body's fields optional; `stepFloor` places one whose `x` is missing. `SimEvent` is a union keyed on `type`,
with each event's `x` typed. The wire messages are `Command` (page to room: an `Action`, `{ t: 'go' }` or a
`DevCommand`), `StateMessage` (`{ t: 's', s }`, room to every page) and `CloseCode` (1008 a bad id or mode, 4404 no
such room, 4409 code taken, 4426 a page from an older build). The codes by name, `PROTOCOL`, `TICK_MS` and `Mode` are in
`packages/game/src/protocol.ts`.

## The tools

### The balance harness (tools/balance)

`floor.ts` is the command line; `harness.ts` has the scripted guards, the scenarios and `play()`. The tests in
`test/` play seeded nights through `harness.ts` the same way. Seeded runs come out the same every time because of
three things:

- The harness makes one sim per thread, once: `newSim({ rng: () => random(), now: 0 })`. `seedRandom(seed)` swaps
  the module's `random` for a `seeded()` stream at the start of each night, and the closure means the sim draws from
  whichever stream is current.
- The guards' own draws (`pick()`, their drift) come from that same stream, between the sim's. Moving one moves
  every draw after it.
- The sim is never remade between nights in a worker, so `lastStep` carries from one night to the next and the
  first step of a night has the same `dt`. `play()` empties `sim.players` and makes a new `S` for each night.
