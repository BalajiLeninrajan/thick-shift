# @thick-shift/sim: the contract

How the night simulation is called, and the rules its callers and its Luau port rely on. `src/sim.ts` is the night,
`src/session.ts` is what whoever runs a night does with the guards' browsers, and `src/types.ts` has the types.

## Layout

| Import | File | What |
|---|---|---|
| `@thick-shift/sim` | `src/index.ts` | everything below, the night and the session included |
| `@thick-shift/sim/check` | `src/check.ts` | `assert`, `defined`, `isNonEmpty`, `isPlaced`, `isNight` |
| `@thick-shift/sim/config` | `src/config.ts` | `FINAL_NIGHT`, `DOORS`, `MASC`, the mascots by name |
| `@thick-shift/sim/map` | `src/map.ts` | rooms, doorways, fixtures, `walkable`, `slide`, `clear`, `sees`, `reaches`, `glimpses`, `roomAt`, `route`, `nav`, `walls`, `slabs`, ... |
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
commandFloor(sim: Sim, S: State, pid: string, c: unknown): void

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

Every draw goes through `sim.rng()`. The Luau port (`apps/roblox/src/shared/Sim.luau`) makes the same draws at the
same points, and `tools/roblox/diff/run.sh` checks the two tick by tick, so a change to when or how the sim draws is
a change to both files:

- `rnd(a, b)` is `a + sim.rng() * (b - a)`.
- `pick(list)` is `list[(sim.rng() * list.length) | 0]`.
- The night's battery spots are shuffled Fisher-Yates:
  `for (let i = spots.length - 1; i > 0; i--) { const j = (sim.rng() * (i + 1)) | 0; swap(i, j); }`
- Fault kinds are `(sim.rng() * F.FIX.length) | 0`.
- A short-circuit that skips a draw skips it on both sides: `noise()` draws only after the state, home and distance
  tests pass; `lockersNear()` draws only for lockers within `CHECK.near`; `pickDest()` draws for Squish's booth
  chance only when a guard is in the booth, and for the crank chance only when `S.crank`.
- An expression with two draws takes them left to right.

Distances come from `hypot` in `map.ts`, the plain `Math.sqrt(x * x + z * z)`. `Math.hypot` rounds differently in the
last bits and Luau has no such function, so the sim and the map never call it.

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
such room, 4409 code taken, 4426 a page from an older build).

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

### The Roblox diff (tools/roblox/diff)

`run.sh` plays one harness night with `REC_OUT` set, then replays the recording through the Luau port:

```sh
tools/roblox/diff/run.sh "solo competent n1" 3
```

With `REC_OUT` set, `harness.ts` loads `rec.ts` and calls the night through `rec.wrapSim(night, sim)`. The recorder
wraps `sim.rng` and writes one JSON line per sim call: the call, the draws the sim made during it, and `S` after
starts and steps. It records draws only inside a sim call, so the guards' draws are left out. For a step it also
records `dt`, taken as `(now - sim.lastStep) / 1000` before the call. `apps/roblox/test/diff-sim.luau` feeds the
port the same calls and draws and stops at the first tick where its `S` differs.

### gen-data

`tools/roblox/gen-data.mjs` writes `apps/roblox/src/shared/Data.luau` from `config.ts`, `map.ts`, `dressing.ts` and
`data.ts`. Run it after changing any of them; CI fails if `Data.luau` is out of date.
