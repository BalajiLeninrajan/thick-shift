# Thick Shift on Roblox

A port of the 3D floor mode to Roblox, built with [Rojo](https://rojo.space). The web game's simulation in `packages/sim/src/` is still the original: the Roblox sim is a line-for-line port of it, checked against it tick by tick, and the building's data is generated from it.

## Layout

```
default.project.json   where each folder goes in the place
src/shared/            ReplicatedStorage.Shared: what both sides need
  Data.luau            generated from the web game by tools/roblox/gen-data.mjs; do not edit
  Map.luau             packages/sim/src/map.ts: walking, sight lines, routes, walls and floors
  Sim.luau             packages/sim/src/sim.ts: the night. The server owns one
  Units.luau           metres to studs (3 to a metre) and yaw to CFrame
  Util.luau, Text.luau
src/server/Main.server.luau   steps the sim ten times a second and sends every client the state
src/client/            StarterPlayerScripts.Client
  Main.client.luau     the frame: events to HUD lines, the catch, watching a teammate
  World.luau           builds the Depot on the client: shell, furniture, lamps, usables, wall map
  Controller.luau      three/player.ts: walking, looking, the torch, using things
  Task.luau            three/task.ts: the three fault minigames
  Hud.luau             three/hud.ts and ui.ts: the HUD and the cards between nights
  Actors.luau          the mascots and the other guards
test/
  diff-sim.luau        replays a web-sim night through Sim.luau (run through tools/roblox/diff/run.sh)
  smoke.luau           runs the client modules against the sim under Lune
```

The server works like the web game's host. Clients own their own positions and send the same actions a guest's browser sends (`p`, `use`, `call`), plus `next` from the cards between nights. Nobody has a Roblox character: each client draws the building, the mascots and the other guards itself from the state, as each browser does.

## Tools

`rokit install` in this folder fetches Rojo, selene, StyLua and Lune at the versions in `rokit.toml`.

```sh
rojo build default.project.json -o build/ThickShift.rbxl   # the place file
rojo serve                                                  # live sync into Studio (with the Rojo plugin)
stylua src test && selene src                               # format and lint
(cd ../.. && lune run apps/roblox/test/smoke.luau)          # client code against the sim, no Studio (from the repo root)
../../tools/roblox/diff/run.sh "crew of 3 competent n4" 1   # web sim vs Luau sim, one night
node ../../tools/roblox/gen-data.mjs                        # after changing the sim's config.ts, map.ts, dressing.ts or data.ts
```

## How close it is

- The sim matches the web sim tick for tick. Across 20 recorded balance-harness nights, 19 match to 1e-6 all night. The only drift is `atan2` rounding differently in the last bit between V8 and the C library; in one crew-of-4 night that compounds until Tank's charge clips a table 99 s in. The tuning in the web game's balance harness holds for this sim.
- The world, the mascots and the props are stand-ins: blocks in the right places at the right sizes, the same lamps in the same places. The web game's Blender models (`packages/game/public/models`) still need uploading as Roblox meshes.
- Not ported yet: sound (the recordings in `packages/game/public/sfx` need uploading), the phone minimap, the post-processing look (film grain, the torch's beam pattern), gamepad and touch controls, the dev menu. The Mini Biggs is in `Sim.luau` (throwing, the battery it costs, landing, the noise, picking it up), but the client cannot throw or pick one up yet, and draws and plays nothing for it.
- Nothing has been played in Studio yet.
