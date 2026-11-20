# @thick-shift/sim: the contract

This is how the night simulation is called once it has moved out of `packages/game/src/three/sim3d.js` (PR 3 of
issue #7). It was written before the port, so it speaks of the old files as "today"; `src/sim.ts` now holds the port
behind these signatures, `src/types.ts` has the types, and `config.ts`, `map.ts`, `dressing.ts` and `data.ts` are in
use by the game and the tools.

## Layout

| Import | File | What |
|---|---|---|
| `@thick-shift/sim` | `src/index.ts` | everything below |
| `@thick-shift/sim/config` | `src/config.ts` | `FINAL_NIGHT`, `DOORS`, `MASC` |
| `@thick-shift/sim/map` | `src/map.ts` | rooms, doorways, fixtures, `walkable`, `slide`, `clear`, `sees`, `reaches`, `glimpses`, `roomAt`, `route`, `nav`, `walls`, `slabs`, ... |
| `@thick-shift/sim/dressing` | `src/dressing.ts` | `FOOT`, `GEN_BACK`, `DRESSING`, `footprint`, `obstacles` |
| `@thick-shift/sim/data` | `src/data.ts` | `LAMPS`, `DEAD_TUBES`, the tube colours, `STAGE` (moved out of `light.ts` and `shell.ts`) |
| `@thick-shift/sim/random` | `src/random.ts` | `seeded(seed)`, the seeded `Rng` the balance harness and the tests play with |
| `@thick-shift/sim/types` | `src/types.ts` | `State`, `NightState`, `Guard`, `Mascot`, `SimEvent`, `Brain`, `Action`, the relay messages, `Rng` |
| `@thick-shift/sim/sim` | `src/sim.ts` | the night: `newSim`, `newState`, `startFloorNight`, `stepFloor`, `actFloor`, `adoptFloor`, ... |

The package is TypeScript that Node 22 runs by stripping the types, so relative imports name the `.ts` file and the
code uses nothing stripping cannot erase (no enums, no parameter properties, no namespaces). Its tsconfig is strict
with no DOM. Code in the game imports it by package name (`packages/game` depends on it, `workspace:*`). Node tools
import the source by relative path (`../packages/sim/src/map.ts`), because `tools/` is not a package.

`map.ts` keeps three module-level caches: the obstacle buckets, the waypoint graph (`nav()`) and the last rect
`walkable()` matched. They depend only on the building and never change an answer, so they stay in the module rather
than on the caller. `addObstacle()` still mutates `OBSTACLES` for every caller in the process; nothing calls it today.

## The night

```ts
type Rng = () => number; // [0, 1), like Math.random

interface SimOptions { rng: Rng; now: number; shuffle?: 'sort' | 'fisher-yates' }

interface Sim {
  rng: Rng;                        // every random draw the night makes; the caller may swap it between calls
  shuffle: 'sort' | 'fisher-yates';
  players: Record<string, Player>; // was game.players: peer id -> that guard's record
  brains: Brain[];                 // was the module's `brains`
  batTimers: number[];             // was `batTimers`
  crankNoise: number;              // was `crankNoise`
  nextFault: number;               // was `nextFault`
  lastStep: number;                // was `lastStep`, in ms
}

newSim(opts: SimOptions): Sim
newState(code: string): State
startFloorNight(sim: Sim, S: State, n: number): void
restartFloor(sim: Sim, S: State): void
adoptFloor(sim: Sim, S: State, now: number): void
stepFloor(sim: Sim, S: State, now: number): void
actFloor(sim: Sim, S: State, pid: string, a: Action): void
brainOf(sim: Sim, i: number): Brain

// Pure, unchanged except for types. Clients call them with any S.
F, TOY
hourF(S), clockF(S), lightsF(S), dreadF(S)
darkRoom(S, room), faultLeft(S, f), landing(S, x, z, yaw, d)
```

### (a) No singleton

The sim no longer imports `state.ts`. Everything sim3d.js kept at module level, and `game.players`, lives on the
`Sim` record the caller makes with `newSim()` and passes in. `S` is passed beside it, never stored on it, because
guests hold an `S` and no `Sim`.

- A `Sim` lives as long as sim3d.js's module state did: one per host page in the game, one per worker (or per
  process in `--trace`) in the balance harness. `startFloorNight` resets `brains`, `nextFault`, `batTimers` and
  `crankNoise` as it does today. It does not touch `lastStep` or `players`.
- `sim.players[id]` and that guard's entry in `S.players` are the same object. `stepFloor` sets
  `S.players = Object.values(sim.players)` on every call, as `guards()` does today, and `startFloorNight` does the
  same after placing them. Callers add and remove guards in `sim.players` (net.ts on `join` and `leave`, the harness
  when it sets up a night) and never in `S.players`.
- `brainOf(sim, i)` returns `sim.brains[i]`. A brain's keys keep today's order: `since`, `was` and `noShort` are
  added when first set, after the rest, as today. This shows only in `floor.ts --brains`.

### (b) The random numbers

Every draw goes through `sim.rng()`, at the same point and in the same order as today's `Math.random()`, `rnd()`,
`pick()` and random sort. The port keeps these forms exactly:

- `rnd(a, b)` is `a + sim.rng() * (b - a)`, and `rnd(...SPENT)` stays a spread of the two-element table.
- `pick(list)` is `list[(sim.rng() * list.length) | 0]`.
- The night's battery spots stay `BATTERY_SPOTS.map((_, i) => i).sort(() => sim.rng() - 0.5)` when
  `sim.shuffle` is `'sort'`, so V8 calls the comparator, and so draws, exactly as today. With `'fisher-yates'` they
  are shuffled the Roblox port's way, which is what tools/roblox/diff/patch.mjs swaps in today:
  `for (let i = spots.length - 1; i > 0; i--) { const j = (sim.rng() * (i + 1)) | 0; [spots[i], spots[j]] = [spots[j], spots[i]]; }`
- Fault kinds stay `(sim.rng() * F.FIX.length) | 0`.
- Short-circuits that skip a draw keep their order: `noise()` draws only after the state, home and distance tests
  pass; `lockersNear()` draws only for lockers within `CHECK.near`; `pickDest()` draws for Squish's booth chance only
  when a guard is in the booth, and for the crank chance only when `S.crank`.
- Expressions with two draws keep their left-to-right order, such as
  `S.t + rnd(0.2, 1) * (S.stir ? rnd(...STIR) * (1 + h) : rnd(...CALM) * (1 - 0.7 * h))` in `adoptFloor`.
- `Array.from({ length }, () => rnd(5, 50)).sort((a, b) => a - b)` in `adoptFloor` stays as it is (the sort draws
  nothing).

The game passes `rng: Math.random`. `state.ts` keeps `rnd()` for the client's own use (sound.ts), and the sim stops
importing it.

Draws outside the sim share one stream with it today, because the harness replaces `Math.random` for the whole
process: `floor.mjs`'s own `pick()` and its drift (`Math.random() < 0.02`, `Math.random() * 10`) fall between the sim's
draws. They must stay on the same stream (see "The balance harness" below). In the game, net.ts's `newCode()` and
`join()`'s id, `sound.ts` and `state.ts`'s `rnd()` also use `Math.random`; they are not part of any seeded run, and
stay on `Math.random`.

### (c) Time

The sim never reads `performance.now()`. The caller passes `now` in milliseconds on its own clock:

- `newSim({ now })` sets `sim.lastStep`, as sim3d.js's `let lastStep = performance.now()` did at import.
- `stepFloor(sim, S, now)` computes `dt = Math.min(0.25, (now - sim.lastStep) / 1000) * (S.dev?.speed || 1)`, then
  sets `sim.lastStep = now`, before it returns for a phase other than `'play'`, exactly as today.
- `adoptFloor(sim, S, now)` sets `sim.lastStep = now`.

### (d) What stays the same

`F`, `TOY`, `hourF`, `clockF`, `lightsF`, `dreadF`, `darkRoom`, `faultLeft` and `landing` keep their names, arguments
and results. `brainOf`, `startFloorNight`, `restartFloor`, `adoptFloor`, `stepFloor` and `actFloor` keep their
behaviour and gain `sim` (and `S`, and `now` where they read the time) as leading arguments. The tuning constants
and their comments move from sim3d.js into sim.ts unchanged (sim.ts already holds `F` and `TOY`). `actFloor` still
treats `a` as untrusted JSON: every field it reads is checked as today (`num()`, `includes`, `Number.isFinite`).

### Types

`State` is what goes over the wire: a `LobbyState` (what `newState` returns) with the night's fields optional, because
the lobby has none of them and a host from before some fields existed may not send them. `NightState` is the state
once `startFloorNight` has run, with every field present and `players: Guard[]`. Inside a night the sim narrows
`State` to `NightState`. `Player` is a guard as net.ts adds them (`{ id, name }`) with the body's fields optional;
`stepFloor` places one whose `x` is missing. `SimEvent` is a union keyed on `type`, with each event's `x` typed. The
wire messages are `Action` (guest to host, and the host's own actions), `StateMessage` (`{ t: 's', s }`, host to
guests), `RelayToGuest` (`{ t: 'host', guests }`, `{ t: 'rehost' }`), `HostInbox` (`{ from, d }`, where `d` is an
`Action` or `{ t: 'join' | 'leave' }`), `Visibility` (the plain-text `'hidden'` and `'shown'`) and `CloseCode`
(4404 no host, 4409 code taken).

## (e) Keeping the tools' output byte-identical

PR 4 has since moved the harness to TypeScript: `tools/balance/floor.mjs` is now `floor.ts` (the command line) and
`harness.ts` (the guards, the scenarios and `play()`), `rec.mjs` is `rec.ts`, and the mulberry32 below is `seeded()`
in `src/random.ts`, which `seedRandom(seed)` calls. Node runs them by stripping the types. Everything below still
holds with those names, and `node tools/balance/floor.ts` prints the same bytes `floor.mjs` did. The tests in
`test/` play seeded nights through `harness.ts` the same way.

### The balance harness (tools/balance/floor.mjs)

Today it fakes `globalThis.performance` with a counter `now` that starts at 0 and replaces `Math.random` with a
seeded mulberry32 at the start of each night (`seedRandom`). The sim and the harness's guards draw from that one
stream. After the port:

1. It imports the sim from `../../packages/sim/src/index.ts` (and the map from there), not from packages/game, and
   no longer imports `state.ts` or fakes `performance`.
2. It keeps `let now = 0` and a module-level `let random = Math.random`. `seedRandom(seed)` sets `random` to the same
   mulberry32 function instead of assigning `Math.random`. Its own `pick()` and drift call `random()`.
3. It makes one sim at module level, after the imports and before any night:
   `const sim = newSim({ rng: () => random(), now: 0 })`. The indirection matters: the sim keeps drawing from
   whatever `random` is when it draws, so a reseed reaches it, and the harness's own draws and the sim's interleave
   on one stream exactly as they do through the shared `Math.random` today. Each worker thread evaluates the module,
   so each gets its own sim with `lastStep` 0, as each got its own sim3d.js with `performance.now()` 0.
4. `play()` sets `sim.players = {}` and `const S = newState('TEST')` where it set `game.players` and `game.S`, adds
   guards to `sim.players`, and calls `startFloorNight(sim, S, n)`, `stepFloor(sim, S, now)` and
   `actFloor(sim, S, id, a)`. It reads guards from `sim.players` where it read `game.players`, and
   `brainOf(sim, i)` where it read `sim.brainOf(i)`.
5. The sim is never remade between nights in a worker: `lastStep` carries from one night to the next as it does
   today, so the first step of a night has the same `dt`.

With those, both reference commands print the same bytes as on `balaji/vite` and `5aed1bd`:
`node tools/balance/floor.mjs --seeds 4` and `node tools/balance/floor.mjs --trace "solo competent n1" --seed 3 --steps`.

### The Roblox diff (tools/roblox/diff)

`patch.mjs` text-patches scratch copies of sim3d.js and floor.mjs today, for three things. Each becomes a supported
hook, and `patch.mjs` and the scratch copy go away:

- The battery shuffle: `newSim({ ..., shuffle: 'fisher-yates' })`.
- The draws: `rec.mjs` wraps `sim.rng` once, after `newSim`:
  `const inner = sim.rng; sim.rng = () => { const v = inner(); if (REC.on) REC.rands.push(v); return v; }`.
  It records only while it is inside a sim call, as today, so the harness's own draws are not recorded (they never
  fall inside one).
- The step's `dt`: the recorder computes `(now - sim.lastStep) / 1000` before it calls `stepFloor(sim, S, now)`, the
  same expression patch.mjs inserts today, so no hook in `stepFloor` is needed.

`floor.mjs` loads the recorder only when `REC_OUT` is set: before making its sim it does
`const rec = process.env.REC_OUT ? await import('../roblox/diff/rec.mjs') : null`, makes the sim with
`shuffle: rec ? 'fisher-yates' : 'sort'`, and calls the night through `const api = rec ? rec.wrapSim(night, sim) : night`,
where `night` is `{ startFloorNight, stepFloor, actFloor }`. The wrapped functions keep the night's own arguments and
record the `S` they are passed, since `floor.mjs` makes a new `S` for each night inside `play()`. `rec.mjs` records `players` from `sim.players` at a
start, `S` after starts and steps, and `dt` for steps, in the same JSON lines as today. It still replaces
`Math.hypot` when it loads; nothing calls `Math.hypot` before the first night, and the sim and the map look it up at
call time, never through a saved reference. `run.sh` becomes
`REC_OUT="$work/rec.jsonl" node "$root/tools/balance/floor.mjs" --trace "$scenario" --seed "$seed" > "$work/trace.txt"`
followed by the same `tail` and `lune run`, with `$work` holding only the recording. The `biome-ignore format`
comments that exist for patch.mjs (in sim3d.js and floor.mjs) go with it. ci.yml runs the same commands and needs
no change.

### gen-data

It already imports the sim's `config.ts`, `map.ts`, `dressing.ts` and `data.ts` directly. It no longer reads
`light.ts` or `shell.ts` as text, and `Data.luau` comes out byte-identical. The floor-plan checks, which import them
the same way, are now `test/floor-plan.test.ts`.

## (f) What has to change

### Game (packages/game, still JS in PR 3; ported to TS in PR 5)

- `src/three/sim3d.js`: moves into `packages/sim/src/sim.ts` behind the signatures above, then is deleted.
- `src/net.ts`:
  - module level: `export const sim = newSim({ rng: Math.random, now: performance.now() })`, created at import as
    sim3d.js's `lastStep` was; imports from `@thick-shift/sim` instead of `./three/sim3d.js`.
  - `run`: `stepFloor(sim, game.S, performance.now())`.
  - `broadcast`: count `sim.players`.
  - `hostRoom` (`onmessage`): `join` and `leave` change `sim.players`; actions go to `actFloor(sim, game.S, id, d)`.
  - `hostRoom` (`onclose`): drop guests from `sim.players`.
  - `host`: `sim.players = { host: guard('host', game.myName) }`.
  - `becomeGuest`: `sim.players = {}`.
  - `takeOver`: build `sim.players`, then `game.S.players = Object.values(sim.players)` and
    `adoptFloor(sim, game.S, performance.now())`.
  - `send`: `actFloor(sim, game.S, game.myId, a)`.
- `src/state.ts`: `game.players` goes (it is `sim.players`). `rnd` stays for sound.ts.
- `src/ui.ts` (`next`, in the end-of-night screen): `restartFloor(sim, S)` and `startFloorNight(sim, S, n)` with
  `sim` from net.ts; `clockF` from `@thick-shift/sim`.
- `src/dev.ts` (`ACTIONS['dv-next']`, `ACTIONS['dv-final']`): `startFloorNight(sim, S, n)` with `sim` from net.ts;
  `F`, `hourF`, `clockF`, `dreadF` from `@thick-shift/sim`; `REST` from `@thick-shift/sim/map`.
- Imports from `sim3d.js` that become imports from `@thick-shift/sim`, with no other change: `src/main.ts` (dreadF),
  `three/app.ts` (dreadF), `three/hud.ts` (F, TOY, clockF, faultLeft), `three/outline.ts` (faultLeft),
  `three/player.ts` (F, TOY), `three/sound.ts` (lightsF, TOY), `three/touch.ts` (TOY), `three/actors/guard.ts` (F),
  `three/actors/mascot.ts` (lightsF), `three/actors/plush.ts` (TOY), `three/world/light.ts` (darkRoom),
  `three/world/usable.ts` (lightsF).
- The shims `src/config.js`, `three/map.js` and `three/world/dressing.js` only re-export the sim now. Point their
  importers at `@thick-shift/sim/config`, `/map` and `/dressing` and delete them:
  - config.js: `dev.ts`, `ui.ts`, `three/actors.ts`, `three/app.ts`, `three/hud.ts`, `three/sound.ts`,
    `three/actors/mascot.ts`, `three/actors/plush.ts`, `three/world/art.ts`, `three/world/usable.ts`.
  - map.js: `dev.ts`, `three/actors.ts`, `three/app.ts`, `three/hud.ts`, `three/minimap.ts`, `three/outline.ts`,
    `three/player.ts`, `three/sound.ts`, `three/task.ts`, `three/actors/guard.ts`, `three/actors/mascot.ts`,
    `three/world/art.ts`, `three/world/light.ts`, `three/world/props.ts`, `three/world/shell.ts`,
    `three/world/sight.ts`, `three/world/surfaces.ts`, `three/world/usable.ts`.
  - dressing.js: `three/world/props.ts`, `three/world/usable.ts`.
- `light.ts` and `shell.ts` already import `LAMPS`, `DEAD_TUBES`, `TUBE`, `GREEN` and `STAGE` from
  `@thick-shift/sim/data`.

### Tools

- `tools/balance/floor.mjs`: as in (e). Its header comment points at `packages/sim/src/sim.ts` for the numbers.
- `tools/roblox/diff/rec.mjs`: `wrapSim(night, sim)` as in (e), wrapping `sim.rng` and computing `dt`.
- `tools/roblox/diff/patch.mjs`: deleted.
- `tools/roblox/diff/run.sh`: no scratch copy, as in (e).
- `tools/roblox/gen-data.mjs`: done. (The floor-plan checks are now `test/floor-plan.test.ts`.)
- `tools/tsconfig.json`: nothing, as long as the tools import the sim by relative `.ts` path
  (`allowImportingTsExtensions` is on in tsconfig.base.json).
- `apps/roblox/test/diff-sim.luau`: nothing; the recording's format does not change.
