# Thick Shift

Midnight at the Mascot Depot. A co-op night-shift survival game: keep the very large retired mascots out of the security booth until 6 AM.

## Run it

There is no build step. The game is plain ES modules in `public/`, served by a Cloudflare Worker that also relays multiplayer.

```sh
pnpm install
pnpm dev        # local server through Wrangler
pnpm deploy     # publish to Cloudflare Workers
```

Any static server pointed at `public/` runs the game solo. Rooms need the Worker.

Add `?dev` to the URL for the dev menu (the Dev button, or the backtick key): god mode, infinite power, freeze, cold motors (nothing overheats), game speed, forced rot stage and dread, time skips, buttons to heat or trip a door and seize the generator, and per-mascot controls. Only the host's changes reach the simulation. Add `?debug` to get `window.ts` (the live `game` and `client` state) in the console.

## Layout

```
wrangler.jsonc      Cloudflare Workers config
worker/index.js     the room relay: one Durable Object per room code
public/
index.html          markup and the control bar
styles.css          stage layout; everything else comes from catppuccin-neu
sfx/                recorded sound effects (CC0, see Sound below)
src/
  config.js         constants, rooms, hit zones, palette, mascot roster
  state.js          the two shared mutable objects: game (session) and client (this browser's view)
  rules.js          read-only questions about a state: who is at which door, what time it is
  sim.js            host-only simulation: power, mascot movement, player actions
  net.js            hosting and joining rooms; the host broadcasts the whole state
  audio.js          recorded and synthesised sound
  ui.js             overlay screens and control-bar state
  input.js          buttons, keyboard, pointer panning, tilt
  dev.js            dev menu, loaded only with ?dev
  main.js           the frame loop
  render/
    canvas.js       canvas setup, color helpers, sprite baking
    mascot.js       mascot art
    office.js       the booth
    cams.js         camera rooms and the CCTV treatment
    cammap.js       the floor plan you tap to switch cameras
    screens.js      generator, HUD, jumpscare, title backdrop
    frame.js        picks the scene for the current state
tools/
  balance/run.mjs   scripted guards played through sim.js, and the targets the booth is tuned to
```

## How the pieces talk

The host runs `sim.js` ten times a second and sends the full state `S` to every guest. Both sides hold a WebSocket to `/room/CODE` on the same origin, and the `Room` Durable Object in `worker/index.js` passes messages between them. Nothing is peer to peer, so it works on any network that allows WebSockets. The relay keeps no game state, and a room ends when its host disconnects. Guests never change `S`. They send actions (`door`, `view`, `name`) to the host through `net.send`. Rendering reads `S` plus `client` and nothing else, so any scene can be reproduced by setting those two objects.

## Winning

A run is five nights (`FINAL_NIGHT` in `config.js`). Surviving a night sets `S.phase` to `'win'` and offers the next one; surviving the last sets it to `'won'`, which shows the morning scene and the run's tallies (`S.slams`, `S.deaths`). Dying retries the same night, so the tallies carry across attempts.

## Rot and dread

Mascots start each night as the costumes they were and come apart as it goes on. `rotOf(S, m)` in `rules.js` returns a stage: 0 is the cute costume, 1 is off (dull fur, too many teeth), 2 is the tall shaggy thing with extra limbs. Time moves every mascot along, and each door slammed on a mascot (`m.bangs`) moves that one faster. Later nights start further along.

`dreadOf(S)` is the same idea for the building, from 0 to 1. The office gloom, lamp flicker, fog, camera colour drain, poster glitches and background sound all scale with it. `threatOf(S)` is separate and short-lived: it rises while something stands at an open door, and drives the heartbeat and the red at the edges of the screen.

## The building

Nine rooms with cameras and three ways into the booth (`ROOMS` and the diagram above it in `config.js`). Each mascot has two routes of different lengths, some to different doors (`paths` in `MASC`), and picks one each time it sets off:

- Big Biggs: Stage, Main Hall, then west through the Arcade to the left door, or east through the Kitchen to the right.
- Madame Flan: Stage, then the short way through Backstage and the Kitchen to the right door, or the long way round to the left.
- Squish: Snack Bar into the Ducts and out of the vent, or through the Kitchen to the right door.
- Tank: Backstage, then the long way through the Stage and Arcade to the left door, or straight through the Kitchen to the right.

A mascot turned away at a door goes back to where it rests. The camera map (`render/cammap.js`) is a floor plan of this.

## What the booth tells you

A creak says something has reached one of the doors, but not which one. The mascot then hangs back in the dark, unseen, until 60% of its wait has gone (`REVEAL` in `rules.js`), then steps into the doorway. The heartbeat and the red at the edges of the screen only happen for an open doorway that is on the guard's screen (`seenThreat`). From the booth alone a guard gets the last 40% of the wait, and only for the door they are panned to. The cameras are how they learn earlier which door to watch: a mascot held back by a lull waits one room from its door, and each hall leads to one door.

## Sanity and the lights

Each guard has a sanity level, kept by the host in their player record (`updateSanity` in `sim.js`, rates in `SANITY`). It falls in the dark and while something stands at an open door. Watching an off or rotten mascot on camera also costs a little, very slowly. It recovers in the booth with the lights on and nothing at the doors.

It gets worse each night and each hour (`wear` and `sanityCap` in `sim.js`): the ceiling starts lower every night and sinks as the night goes on, down to 29% at 6 AM on night 5. Power follows the same idea (`powerWear`): everything draws its listed rate on night 1 and 140% of it by night 5. The crank returns less power the lower the cranking guard's sanity, down to 40% of its rate.

The tuning target is night 5: a guard who never checks cameras and shuts each door at the last safe moment should end it near 13% power without cranking, and anyone less exact should need the crank. Sanity should end just into the red. For a group the target is the same night: two guards on the doors and one working the handle between attacks should end it near 60%, which is about one guard's worth of camera time. A group that seals the booth should be dead before 2 AM on any night. `node tools/balance/run.mjs` plays scripted guards through `sim.js` and checks these (see Balance below).

Low sanity does three things:

- Pressing to shut a door can do nothing (`doorFailChance` in `rules.js`: about a quarter of presses at half sanity, 70% at zero). Opening never fails, and neither does shutting a door in the last quarter of a mascot's wait behind it (`LAST_MOMENT` in `sim.js`). The guard who fumbled is told; everyone hears the click.
- Below 60% the game plays real event sounds when nothing happened (`FALSE_ALARMS` in `audio.js`).
- Below 50% an empty camera room sometimes shows a silhouette that is not in the game state (`phantom` in `cams.js`).

The booth lights are a shared switch (`S.lights`, the Lights button or L). Off saves about two thirds of the idle power drain (`DRAIN` in `sim.js`), shows doorways as silhouettes, and drains everyone's sanity.

Attacks are paced by lulls. After a mascot is turned away, `S.calmUntil` keeps every mascot from arriving at a door for a random stretch (see `lull` in `sim.js`): usually 20 to 45 seconds, sometimes twice that, and on later nights occasionally almost none. A mascot that wants to arrive during a lull waits one room away. No night has more than `maxAttacks(S)` attacks, seven for one guard, and whatever is left of that budget is spread over the time remaining so the last hours are never safe. Later nights get shorter door timers, some attacks that are two mascots at once from night 4 for one guard, earlier for a crowd, and a weaker guard (see Sanity).

Camera feeds wear out while a player watches them. Each player has a `client.signal` level that drains while they are on the cameras and recovers in under a second once they leave. A worn feed tears and fills with static; below about 40% its light starts cutting out and everything in the room is drawn as a silhouette. It gets worse through the night: a feed lasts a minute at midnight and 10 seconds at 4 AM, and from 4 AM it is already tearing when you open it (`camCap` and `camLife` in `rules.js`). This is per player and not synced, so two guards can see different feeds.

To add a mascot, add an entry to `MASC` in `config.js`, then give `COSTUME` (stages 0 and 1), `HEAD` (stage 2), `BODY` and `NECK` in `render/mascot.js` an entry with the same key.

## Breakers, the handle and a crowd

These three rules exist because a group used to win by shutting every door and cranking all night. Now that loses, and a bigger crew gets more to do.

The three doors are held shut by motors on one breaker. A motor heats while it holds and cools while the door is open (`S.heat`, `DOOR_HEAT` in `rules.js`). One door can hold for 25 seconds from cold. Each other door shut at the same time makes all of them heat half as fast again, and a mascot hitting a shut door adds a lump of heat. At the top the breaker trips: the door drops open and will not shut for 20 seconds (`S.trip`, `tripLeft`). The door buttons and the plates under the doors show the heat.

The generator has one handle (`S.cranker`). Whoever gets there first holds it, and a second guard adds nothing. Turning it heats it: 15 seconds from cold seizes it, and it cools four times slower than it heats (`S.gen`, `GEN_HEAT`), so a night has about a minute of cranking in it at most. A seized generator stays locked for 30 seconds (`S.seized`, `genLeft`). The mascots hear the handle only while it turns.

More guards draw more visits (`crowdOf`, `maxAttacks`, `pairFromNight`, `pairChance` in `rules.js`). One guard gets the same seven attacks as before. Each extra guard adds three, shortens the lulls to fit them, and brings pairs a night earlier and more often. The count is read from `S.players` as the night runs, so a guest who joins or leaves changes it at once.

| Guards | Attacks a night | Lull length | Pairs from night | Chance of a pair |
| --- | --- | --- | --- | --- |
| 1 | 7 | 1x | 4 | 35% |
| 2 | 10 | 0.7x | 3 | 47% |
| 3 | 13 | 0.54x | 2 | 59% |
| 4 | 16 | 0.44x | 2 | 71% |
| 6 | 22 | 0.32x | 2 | 80% |

What a guard sees and hears of this:

- Each door button has a bar along its bottom edge that fills as the motor heats, yellow then red for the last fifth. The plate under each door in the booth has the same bar, the door frame goes from grey through orange to red, and the plate's light blinks before a trip.
- With two or three doors shut, a line at the top of every view says so: "2 doors on one breaker: heating 1.5x".
- A trip is a pop, a thud and the door dropping, with sparks at the frame for two seconds. The plate reads "TRIPPED 14s" and the button "out 14s", both counting down. Pressing the button does nothing (`dead` event): the guard who pressed hears a dull clunk and is told "Left door breaker is out. 14 s." A relay tick says it is back.
- If a mascot came through a tripped door, the death card says so.
- A Generator strip under the clock is in every view. It shows the generator's heat, the name of whoever is turning it, and "seized 24s" while it is locked. At the generator there is a temperature dial, smoke above 70%, and a wheel that only moves while someone is turning it. The heading says whether you have the handle, someone else has it, or it has seized.
- The lobby and the card between nights tell a crew of two or more how many visits to expect.

The sim tells clients about these through events: `trip` and `reset` (with the door), `dead` (the door and who pressed), `seize` and `unseize`.

## Balance

`tools/balance/run.mjs` plays whole nights through the real `sim.js` with a stubbed clock and a seeded `Math.random`, 200 nights per row, and prints a table and a list of targets met or missed. It needs Node 22.7 or later and nothing else.

```sh
node tools/balance/run.mjs                   # every scenario on nights 1, 3 and 5
node tools/balance/run.mjs --only S1,T2,G4   # some of them
node tools/balance/run.mjs --src /tmp/old    # the same guards through another copy of the four sim files
```

The guards are scripts: an exact one that shuts each door at the last safe moment (the solo tuning target), a human one that reacts in .3 to .7 seconds and has to sweep the room when alone, a sloppy one, a cranker, a turtle that holds doors shut, and one that slams every door on the creak. The rows are solo play (S), turtles (T), slamming everything in a group (C) and playing properly in a group (G). The header of the file describes each guard and each column.

Run it after changing anything in `sim.js` or the constants in `rules.js`. `--src` is for comparing against the rules before a change: save the old `sim.js`, `rules.js`, `config.js` and `state.js` to a folder with `git show`, add a `package.json` holding `{"type":"module"}`, and point `--src` at it.

## The floor

### HUD, input and the screens around a night

`three/hud.js` draws the HUD as HTML over the canvas, styled by the "3D mode" block at the end of `styles.css`. It stays at the edges:

- Top left: the hour, the night, and building power. The bar turns yellow under 25% and red under 10%, and reads "Power out" at zero.
- Top centre: a compass. Each clock due this hour is a yellow mark with its walking distance, and the nearest one is filled. A mark points at the next corner of the route there (`route` in `map.js`), not through the walls, because nobody knows the building on their first night. Flat teammates are red marks with a name, and a blue mark leads to the booth charger once the torch is under 25%. A mark past the end of the strip sits at that end with an arrow.
- Under the compass: one pip per clock in this hour's round, filled green once punched, and the time left. It turns red for the last 15 seconds. Toasts for events appear under that. Each kind has its own icon and colour (`TOAST_ICON` in `hud.js`, the `.ts-f-toast.is-*` rules in the stylesheet), and the lines are in the `SAY` table in `app.js`.
- Top right: the other guards and the room each is in. A flat one is red and tagged.
- Bottom left: the torch as a five-bar battery. Grey is off, yellow is on, red and blinking with a red glow in the corner is under 25%. Stamina is a thin bar above it that shows only while it is not full.
- Centre: the prompt for whatever is in reach, with a bar for the ones that need holding.

A flattened guard gets a panel saying who did it and how far the nearest standing guard is, and two things to do. Q (or the button) sends a `call` action. The host emits a `call` event at most every `F.CALL_GAP` seconds, and everyone else hears two notes, reads a toast and sees that guard's compass mark pulse. Space steps through the standing guards' views (`player.me.watch`, drawn by `spectate` in `app.js`) and back to your own.

Input is in `three/player.js`. The mouse is captured on the first click. Esc releases it and opens a pause panel with the controls, look sensitivity and invert-Y (kept in `localStorage.tsFloor`), and a fullscreen button. The night does not stop. The mouse is released for the screens between nights so their buttons can be clicked. A standard gamepad works: left stick walks, right stick looks, A uses, X is the torch, LB runs, Y calls, RB watches, Start pauses.

`three/touch.js` adds touch controls once a finger touches the screen, or from the start on a device with no fine pointer. A touch on the left 45% of the screen puts a stick under that thumb. A drag anywhere else looks. Use is held, the torch button toggles, and Run stays on until the stick is released. Pause and fullscreen sit in the top right corner. The layout is landscape, and a phone held upright is asked to turn. In this mode the stage fills the window (up to 21:9) instead of the 16:9 box.

Teaching the game is split in two. The lobby lists the five rules under the mode picker, where every guard reads them while the others join. In the night, a tip appears the first time each of these happens on a browser: the first round of clocks, the torch dropping under half, a mascot spotting you, a teammate going flat (`hud.tip`, remembered in `localStorage.tsFloorTips`).

The end screens for this mode are in `ui.js`. They read `S.tally` (this night) and `S.total` (the run), which `sim3d.js` fills: clocks punched and missed, who was flattened and by which mascot, and who peeled someone up.

### Sound on the floor

`three/sound.js` gives every sound a place. The listener is this guard's head. A mascot, another guard, the generator, the charger and each one-off event (a punched clock, a bang on a door) plays into an emitter: a low-pass filter, a panner with distance rolloff, and a send to the reverb that falls off more slowly than the sound, so far things are more echo than source. It builds no second audio graph. The recipes are `sample()`, `tone()`, `noise()` and `boom()` from `audio.js`, run inside `into(node, fn)` so they land in an emitter and not straight on the limiter. `main.js` skips `SFX` for this mode, apart from the win jingle.

Walls dull sound. Every 0.13 seconds an emitter asks `sees()` whether the listener has a line to it. If not, `doorwaysBetween()` counts doorways along the shortest way, a shut door counting double, and the `OCC` table turns that into a gain and a low-pass frequency. The panning is plain left-right (`equalpower`), because HRTF measured about twenty times the cost per source. Left-right panning cannot say "behind", so sounds behind the listener lose their top end.

What you can tell by ear:

- Which mascot. Footsteps fire by distance covered (`STRIDE`), so they keep time with its real speed. Big Biggs is a low boom and a slow heavy foot. Madame Flan is a dragging hem and pearls clicking, quiet, and quicker when nobody is watching her. Squish is a wet slap, or sheet metal while it is in the ducts, and it gulps. Tank is hooves, five a second at a charge. Rot makes all of them lower and wetter.
- What it is doing. Breath (`BREATH`) speeds up when it hunts. `spot` has a sound per mascot (`SPOT`) and a short hit if it is you it saw. A mascot held in a beam growls in short pulls and its costume creaks. `quit` is a long breath out when it gives up a chase. `roar` and `crash` are Tank winding up and hitting a wall. `bang` and `arrive` come from the door they happen at. A feeding mascot chews.
- What the mascots as a group are doing. `stir` is a groan through the reverb alone and `calm` a long creak. Nothing on screen marks either.
- The other guards: footsteps, torch clicks, the punch clock's ratchet and bell, a battery picked up, the two notes of a flat guard's `call`, all from where they are.
- The building: a room tone that is lower and louder in bigger rooms (`SIZE`), a mains hum that sags and stops on `out` and comes back on `on`, the generator's ratchet and dynamo, the charger's hum, the door motors (found by comparing `S.doors` between frames, since the `door` event does not say which), a bell for the hour, a buzzer for `miss`, and one ring per clock due on `round`.

Your own body is not placed: footsteps on the camera's bob, panting under 40% stamina, the torch switch, a buzz on each dip of a dying torch, and ticks while a use is held.

Being flattened plays a stinger hung on the catch's timings (`CUES` in `actors/scare.js`): a hit at the grab, the mascot's growl at the face (pitched per mascot, `GROWL_RATE`), lower at the bite, then the floor. From then `muffle()` in `audio.js` closes a low-pass over the whole mix, heartbeat included, until you are peeled. Another guard going flat is a splat, a falling whistle and three bubbles, from where it happened.

The heartbeat, the dread drone, the wind and the far-off oddities are still `ambience()` in `audio.js`, driven from `main.js` by `app.threat()` and `dreadOf(S)`. `sound.js` plays no heartbeat or drone of its own.

One-shots are counted (`voices()` in `audio.js`) and cut from the graph when they end. Past 32 new ones are dropped, and past 18 footsteps and other texture are skipped first. With `?debug`, `ts.floor.sound.stats()` returns the live voices, the always-running sources and the emitters. Nothing is built until the audio context is running, and events that arrive before that are dropped, not queued.

### The building, its light and the picture

`three/world.js` puts the Depot together from the files in `three/world/`:

- `surfaces.js` and `tex.js` paint every floor, wall and ceiling with the 2D canvas when the mode loads: a colour map, a normal map from a height canvas, and a roughness map. Each room has its own set (`LOOK`), so one torch-lit patch of floor says which room you are in. A wall texture covers the full height of its room, so dados and damp sit at real heights.
- `art.js` draws what is stuck on the walls: the posters and the mural of the mascots in their friendly days, staff notices, stains, and the room names. `shell.js` stencils the name of the next room over each doorway, beside it in a low room, or on the floor where the door fills the wall.
- `shell.js` builds the geometry from `walls()`, `slabs()` and `DOORWAYS` in `map.js`, so the picture cannot drift from the collision. Skirting, door frames, pipes, the stage's arch and the lamp housings go into one mesh (`geo.js`). The stage platform is 12 cm high and nobody climbs it. The game is flat.
- `props.js` stands the two prop kits (`models/props_a.glb`, `props_b.glb`) where `dressing.js` says. Static props in a room that share a material are merged into one mesh. A kit that has not been built leaves its props out.
- `usable.js` is the clocks, door buttons, generator, charger, batteries, booth doors and wall map. Each is a plain stand-in until its kit model loads.
- `sight.js` works out which rooms can be seen from the 2 m square of floor the camera is in, by casting a fan of rays over a grid of the walls, and keeps the answer. Props and usable things in every other room are hidden. three.js culls what is outside the view, not what is behind a wall, and without this the booth draws the kitchen.

`dressing.js` is plain data. `map.js` imports it to fill `OBSTACLES`, which is how the host walks mascots round furniture without loading a model. After moving a prop or a waypoint, run `node tools/check-floor.mjs`. It fails if a doorway, a waypoint, a clock, a button, a battery spot, a resting mark or a spawn point is blocked or cut off.

The building's lamps are not three.js lights. `light.js` bakes them at load into two 168 by 176 floor-plan textures, one texel per 25 cm, with the walls casting soft shadows and each room getting some of its own light back as bounce. Every `MeshStandardMaterial` in the scene is patched (`lit`) to look its light up by world position, so mascots, guards and props get it too. The steady lamps are one texture in colour. The other holds four groups, one per channel: two kinds of flicker, a tube that is mostly dead, and the exit signs, which have batteries. A group flickers by changing one uniform. With the power out the steady and flickering groups go to zero and the exit signs, the clocks' due lamps and the torches are all there is. To add a lamp, add a row to `LAMPS`.

The same patch adds two terms no spotlight gives. One is a little spill round the torch, so a mascot standing beside the beam is a shape. The other is a trace of night vision within a couple of metres, so the dark is not one flat value. The torch itself (`player.js`) gets a cookie texture with a hot centre and the reflector's rings, and dust that shows only inside the beam. Held close to a wall the beam would bleach it, so the exposure stops down as the lit surface comes nearer than five metres (`GLARE_FROM`). That is what makes a notice readable at arm's length.

Real lights in the scene: the local torch (the only shadow caster, and its shadow pass is skipped while it is off), two point lights that move to the nearest clocks that are due, and whatever `actors.js` gives other guards' torches.

`three/post.js` draws the scene into a half-float buffer and finishes it in one full-screen pass: exposure, ACES tone mapping, a vignette, grain, and colour fringing at the edges. Dread (`dreadOf`) drains colour, tightens the vignette, thickens the fog and makes the lamps sag. Threat (`app.threat()`) adds grain, fringing and bands of the picture slipping sideways. The grain goes on after tone mapping with a small lift under it, which keeps black areas from being one flat value on a laptop screen. The CSS grain on `.ts-stage` is off in this mode.

Quality is `high` or `low` (`QUALITY` in `post.js`). High draws at up to 1280 pixels across with a 1024 shadow map, low at 854 with a 512 map and no fringing. The mode starts on high, times sixty frames once the shaders have compiled, and drops to low if they average over 26 ms. `?q=low` or `?q=high` in the URL fixes it.

### Mascots, other guards and the catch

`three/actors.js` owns everything that moves and is not you. The work is in `three/actors/`.

The host sends positions ten times a second. `track.js` keeps each actor's last eight snapshots, stamped with `S.t`, and draws the actor one and a half send intervals in the past, between two of them. Easing toward the latest snapshot would lag by an amount that depends on speed. The track also reports the distance covered each frame, and the walk runs on that.

The models are trees of rigid named parts with no armature (`tools/models/README.md` is the contract). `rig.js` finds the parts by the name the file gave them and holds an offset from rest for each. Nothing is keyframed. Each frame `mascot.js` adds layers to those offsets and writes them once:

- The gait. A foot is on the ground for half the cycle and goes back at ground speed, so it stays where it landed. The length of a step is the leg's swing plus the turn of the hips, and with hips a metre across the turn is about a third of it. That is the waddle. Squish at stage 2 floats, Flan at stage 2 glides, and the stage 1 crouchers crawl or hop (`gait.mode` in `styles.js`).
- The pose of the state. A pose is one number per channel (`CH` in `styles.js`: lean, jaw, each arm, how hard it shudders, how far it sits). Every state has one, and the channels spring toward the pose of the current state, so a change of state cannot pop. A torch beam lays the `lit` pose over roam, search and hunt.
- Head and eyes. The head turns to the nearest standing guard within its limits, the eyes make up the rest, and every beat or so there is a chance it looks somewhere else. At stage 1 the head moves in held steps.
- Kicks: short moves set off by events. The hit on a door lands with `bang`, the lunge comes when a beam leaves a hunting mascot, the recoil with `crash`.
- What only one of them has (`chains` in `styles.js`: Flan's legs, Tank's worm, Squish's spine, the mask in Biggs's mouth), then anything named `sway_`, on a damped spring.
- Feet planted: the legs take back whatever the body did above them.

`styles.js` is the tuning: per mascot and stage, the gait, the limits from the model's notes in `public/models/<key>.json`, and the poses. To change how a mascot stands in a state, change its pose there.

A mascot with no model yet is a stand-in built from the same named parts, so it moves by the same rules. The next rot stage is loaded as soon as the current one shows. When `m.rot` changes the swap happens at once if the camera cannot see the mascot or it is dark; otherwise it waits five seconds for that, then folds the mascot down in a lurch and swaps at the bottom.

Materials named `eye_glow` are drawn unlit and without fog (`loadActor` in `assets.js`), and each gets a soft point drawn over it that never shrinks below a few pixels, so an unlit mascot is a black shape with two pale points at any distance. Mascots the camera has no line of sight to are hidden and not animated.

`guard.js` is another guard: `guard.glb`, walking on the same rule, head and torch arm following their pitch, flattened by a spring that overshoots and peeled with a pop. A name shows within 7 m and in sight, or within 25 m when the guard is flat. Only the two nearest lit torches are real spotlights; the rest are a glowing lens. `hands.js` holds the `flashlight` from `props_a.glb` in front of the camera.

`scare.js` is the catch, from the `flat` event for this guard. For a second and a half the camera is taken to the mascot's face (`face` in the manifest; the worm's mouth for Tank at stage 2) while the mascot plays its `scare` pose, then dropped to the floor as it sits. A 2D canvas over the 3D one strobes and tears the frame, and does neither under `prefers-reduced-motion`. The cues are `CUES` in that file: `grab` 0, `face` 0.12, `bite` 0.62, `drop` 1.05, `floor` 1.3, `end` 1.5 seconds. `app.actors.scare.listen((cue, by, seconds) => ...)` calls back as each passes, and `app.actors.scare.now` is `{ by, t, cue }` during a catch.

## Sound

Doors, bangs, footsteps, creaks, wind and growls are recordings in `public/sfx`. The hum, heartbeat, chimes and UI clicks are synthesised in `audio.js`, because they change with dread and threat as you play. Each recording has a synthesised stand-in that plays if the file has not loaded.

All recordings are CC0, converted to mono MP3:

- `door_*`, `slam*`, `sheet*`, `thud`, `knock*`: [100 CC0 metal and wood SFX](https://opengameart.org/content/100-cc0-metal-and-wood-sfx) (OpenGameArt)
- `hit_low`, `hit_long`: [Horror hit soundpack 1](https://opengameart.org/content/horror-hit-soundpack-1) (OpenGameArt)
- `steps*`, `creak*`, `wind`, `scare_growl`, `far_growl*`: [Free horror SFX](https://liminal-space-dev.itch.io/free-horror-sfx-sounds) by Liminal Games (itch.io)

A bang on a shut door is one of four layered recipes in `BANGS`, picked at random. Recordings pass through a generated room reverb (`room()`), with more of it for sounds that are further away.

## Performance notes

Stroking curves is the slowest thing the 2D canvas does here, so outlines are darker shapes drawn underneath. Art that never changes (the room, mascot bodies, glows) is baked into offscreen sprites with `bake()` in `render/canvas.js`.
