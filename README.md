# Thick Shift 3D

Midnight at the Mascot Depot. A co-op night-shift survival game in first person: walk the building with a torch, keep its wiring alive, and stay out from under the very large retired mascots until 6 AM.

## Run it

The repo is a pnpm workspace. The game is plain ES modules in `packages/game/public/`, with no build step, and each app in `apps/` runs it somewhere: the web, a Discord Activity, or Roblox.

```sh
pnpm install
pnpm dev                 # the web game through Wrangler
pnpm dev:discord         # the Discord Activity's Worker
pnpm run deploy          # publish the web game (plain `pnpm deploy` is a pnpm command)
pnpm run deploy:discord  # publish the Discord Activity
pnpm vendor              # copy three.js and the Discord SDK out of node_modules
```

Any static server pointed at `packages/game/public/` runs the game solo. Rooms need a Worker.

Add `?dev` to the URL for the dev menu (the backtick key, or the Dev button on the pause screen and in the touch menu): god mode, infinite power, freeze, wake every mascot, game speed, forced rot stage and dread, time skips, power and torch buttons, and per-mascot controls. Only the host's changes reach the simulation. Add `?debug` to get `window.ts` (the live `game` and `client` state) in the console.

## Layout

```
packages/game/          the game, shared by the web and Discord apps
  worker/room.js        the room relay (one Durable Object per room), which each app's Worker exports
  assemble.mjs          lays an app's public/ over the game's to build that app's static site
  vendor-three.sh       copies three.js into public/vendor (pnpm vendor)
  public/
    index.html          markup
    boot.js             the entry module: starts the game. An app can ship its own
    styles.css          stage layout and the HUD; everything else comes from catppuccin-neu
    sfx/                recorded sound effects (CC0, see Sound below)
    models/             the mascots, the guard and the prop kits (built by tools/models/)
    vendor/three/       three.js
    src/
      config.js         the mascot roster, the doors, the number of nights
      state.js          the shared mutable objects: game (session), client (this browser) and platform (app hooks)
      net.js            hosting and joining rooms; the host broadcasts the whole state
      audio.js          recorded and synthesised sound, and the ambience
      ui.js             overlay screens: title, lobby, and the cards between nights
      dev.js            dev menu, loaded only with ?dev
      main.js           the frame loop
      three/            the game: simulation, building, actors, HUD, input, sound and picture (below)
apps/
  web/                  the web game: a Worker that relays rooms and serves packages/game/public as it is
  discord/              the Discord Activity (below)
    worker.js           the relay, the Discord sign-in and the CDN pass-through
    public/             laid over the game's files into dist/
      boot.js           replaces the game's: loads discord/activity.js inside Discord
      discord/activity.js  the sign-in, the room and the Activity's title screen and invite
      vendor/discord-sdk/  the Discord SDK (pnpm vendor)
      terms.html, privacy.html
  roblox/               the Luau port, built with Rojo (apps/roblox/README.md)
tools/
  balance/floor.mjs     scripted guards played through three/sim3d.js
  check-floor.mjs       checks nothing in the building is blocked or cut off
  models/               the Blender scripts that build public/models
  roblox/               generates the port's data from the game, and checks its sim against the game's
```

An app changes how the game starts and what its title screen and lobby offer through `platform` in `state.js`, set by its own `boot.js` before `start()`. `fixedRoom` means the room comes from outside: everyone tries to host it, and whoever finds it taken joins instead (`becomeGuest` in `net.js`). `title` replaces the title screen, and `invite` replaces the room code and link in the lobby. The web game leaves all three alone.

## Discord Activity

`apps/discord` runs the game as a Discord Activity, deployed as its own Worker (`thick-shift-discord`). Its build lays `apps/discord/public` over the game's files into `dist/` (`packages/game/assemble.mjs`), and Wrangler runs it before dev and deploy. Discord adds `frame_id` to the page's URL, and the app's `boot.js` loads `discord/activity.js` when it sees it. Opened anywhere else, the page plays as the web game does. Everyone who opens the Activity in one channel shares Discord's `instanceId`, so that becomes the room (`d-` and the id) and nobody types a code. Each player presses Clock in, which tries to host. Whoever finds the room taken joins it instead. Names come from Discord through an OAuth sign-in. The Worker trades the code for a token at `/api/discord/token`, so the client secret stays on the server. A player who declines the sign-in plays as Guard.

Discord only lets the page reach its own origin. The SDK is copied into `apps/discord/public/vendor/` (`vendor-discord.sh`). The stylesheets and fonts stay on their pinned CDN links in `index.html`, and the Discord Worker rewrites those links to `/ext/...` as it serves the page, then fetches them from jsdelivr and Google Fonts itself. Only the catppuccin-neu stylesheets and Google's font files pass through it.

To set it up:

1. In the Discord Developer Portal, create an application. Under Activities > Settings, enable Activities (and iOS and Android if wanted). Under OAuth2, add a redirect such as `https://127.0.0.1`. The SDK needs one but never uses it.
2. Put the application ID in `vars.DISCORD_CLIENT_ID` in `apps/discord/wrangler.jsonc`. Then, in `apps/discord`, run `pnpm wrangler secret put DISCORD_CLIENT_SECRET`, and from the repo root run `pnpm run deploy:discord`.
3. Under Activities > URL Mappings, map `/` to the Worker's host with no protocol, for example `thick-shift-discord.<account>.workers.dev`.
4. Start the Activity from a voice channel. Until the app is published, only its owner and team members can launch it.
5. To verify the app, put `https://<worker host>/terms` and `https://<worker host>/privacy` in General Information as the Terms of Service and Privacy Policy URLs (`apps/discord/public/terms.html`, `privacy.html`). If the game starts collecting anything new, update `privacy.html`.

To test from your own machine, run `pnpm dev:discord` behind a tunnel such as `cloudflared tunnel --url localhost:8787`, and map `/` to the tunnel's host. Put `DISCORD_CLIENT_SECRET=...` in `apps/discord/.dev.vars`, which git ignores.

## How the pieces talk

The host runs `three/sim3d.js` ten times a second and sends the full state `S` to every guest. Both sides hold a WebSocket to `/room/CODE` on the same origin, and the `Room` Durable Object in `packages/game/worker/room.js` passes messages between them. Nothing is peer to peer, so it works on any network that allows WebSockets. The relay keeps no game state. If the host leaves, the relay hands the room to the guest who has been there longest, and `adoptFloor` rebuilds what the old host's mascots were thinking from `S`. Guests never change `S`. They send actions (`p` for where they are, `use`, `call`, `name`) to the host through `net.send`.

`main.js` loads `three/app.js`, and with it three.js, the first time a night is drawn, so the title screen and lobby come up without waiting for it.

## Winning

A run is five nights (`FINAL_NIGHT` in `config.js`). Surviving a night sets `S.phase` to `'win'` and offers the next one; surviving the last sets it to `'won'`, which shows the run's tallies (`S.total`, `S.deaths`). Everyone flat at once sets `'dead'` and retries the same night, so the tallies carry across attempts.

## The rules

Everything in this section is in `three/sim3d.js` unless it says otherwise. `three/map.js` is the building as data, and the host uses it too: rooms, doorways, where the breaker boxes and batteries are, what can be walked on and seen through, and how to get from one place to another.

A night is six hours of 70 seconds (`F.HOUR`). Faults break out in the twelve breaker boxes round the building (`BOXES` in `map.js`, `breakOut` and `stepFaults`, tuning in `FAULT`). A guard alone gets one about every 50 seconds, a little sooner each night and each hour; each extra guard adds 70% of that again (`FAULT.crew`). A fault never breaks out within 4 metres of a standing guard, and a mascot banging on a shut booth door shorts the box in the room outside that door a third of the time, so hiding in the booth makes work. `S.faults` has one entry per box: `null`, or `{ k, at, burnt }`. Any guard can fix any fault. (Giving each fault to one guard was tried in the harness: alone it made no difference, and crews of two to six won a third to half as often, because they crossed the building past each other instead of each taking the nearest.)

An open fault does three things, worse the longer it is left:

- It leaks power, from 0.02 to 0.1 points a second over 50 seconds (`FAULT.leak`, `ripen`), times `1 / guards` so a crew leaks what a guard alone does.
- After 25 seconds its room's lights go (`darkRoom`). Mascots in a dark room move 15% faster, see a guard with their torch off at 5 metres instead of 12, and the room's lamps in `light.js` drop to a stutter.
- After 65 seconds it burns (`faultLeft`, the `burn` event): 0.2 points of ceiling a second (times `1 / guards`) for as long as it stays open. The ceiling is `S.cap`: the most the building can hold for the rest of the night. The crank cannot lift power above it. That is what stops a crew ignoring the faults and cranking instead.

Fixing one is a minigame (`three/task.js`), opened by pressing use at the box: flip the tripped breakers in the order on their tags, join four wires to their colours, or hold a valve open with the needle in the green. `F.FIX` is how long each takes a steady hand (1.8, 2.4 and 2.2 seconds) and is what the harness's guards hold use for. The panel covers the bottom half of the screen. The room stays in view above it and the mouse still looks, but the guard cannot walk, and their torch hangs at the floor and holds nothing (`act: 'fix'`, `beamOn`). X or Esc lets go. The host is only told when the job is done (`{ t: 'use', what: 'fix', i }`), and checks the guard is in reach. A fix is loud: the clunk of the breaker and the lights coming back, and anything out and nearby may come to look.

Power also goes on standing still (3 points a minute, more each night, `DRAIN` and `WEAR`), on each shut booth door (11 a minute), on charging a torch, and 2.5 for every bang on a shut door. One guard at the generator, in the booth beside the charger, puts back 0.7 a second (`CRANK`). There is one handle, it roots whoever is on it, and it is loud: half the time a wandering mascot picks where to go next while the crank is turning, it heads for the booth.

At zero the power is out (`S.out`). The booth doors open, the lights and the charging dock go dead, every mascot gets up, and none of the limits below apply: all four hunt at once, faster, and do not give up or go home. `S.power` stays at 0 until someone has cranked `F.RESTART` back in, which is 20 seconds at the handle in the dark (`S.restart` is the progress, 0 to 1). If the ceiling has fallen under `F.RESTART` it never comes back.

The torch is the one thing a guard has. A full one is 65 seconds of light (`F.BAT_LIFE`). The dock in the booth fills it in 15 seconds and costs the building the same power per torch as it always did, a spare battery adds half, and a guard who is flattened loses half of what was in it. There are three batteries around the building plus one per guard, and a taken one turns up somewhere else half a minute later. A beam on a mascot within 12 metres holds it by how far it has rotted (`LIT_SPEED`): stage 0 stops dead, stage 1 keeps a fifth of its speed, stage 2 keeps two fifths. Rot follows the night and the hour (`rot`). Left alone they stay whole through night 1 and are fully rotten from 3 AM on night 5. Torchlight is what really rots them: every second of beam and every bang on a door adds to that mascot's rot (`m.ire`, `GLARE_PER_IRE`). On night 1 about 25 seconds of beam on one brings out stage 1 and 35 to 50 seconds stage 2, so a crew that lights up everything meets the worse forms early, and the more it leans on its torches the less they do. One standing in its place is switched off and a torch does nothing to it.

The phone is a map, held up with C (`player.me.ph`, sent as `ph` in the `p` action). It runs on the torch's battery at four times the torch's rate (`F.PHONE`), so a full battery lasts 16 seconds with only the phone up and 13 with the torch on too. While it is up the guard cannot run and walks at 60% (`F.PHONE_WALK`, in `player.js`), and the torch hangs at the floor and holds no mascot (`beamOn`). The host drops it when the battery runs dry or the guard goes flat. It is for a glance: two seconds cost an eighth of a battery. The balance harness's guards never use it.

The mascots come in waves (`turnWave`, `S.stir`). They stand where they stand, stir for half a minute to a minute, walk the rooms, then go back, and the building is quiet for 15 to 40 seconds. Nothing moves for the first 34 seconds of night 1. `heat` is how bad the night is, from 0 to 1. Later nights, later hours, ceiling burnt by faults and bigger crews raise it, and it stretches the waves, shrinks the calm between them and draws the wanderers toward the guards. Two more limits come from it: `roster` is how many may be out of their places at once, and `pack` is how many may be after the guards at once. A guard alone meets two at a time, three late on nights 3 to 5, and is hunted by one. A crew of four meets all four and is hunted by two, three from about 3 AM on night 5. The crew's share of `heat` grows with the square of the extra guards. One that sees a guard while the pack is full stops and stares for a few seconds and goes back to what it was doing.

A wandering mascot sees a guard inside 12 metres, 17 if their torch is on and 5 if the power is out and it is off, and only in front of itself. It stops and stares for 0.7 seconds (the `spot` event), then comes. A hunt ends in one of four ways. It touches the guard. It runs out of puff (`WIND`: 9 seconds on night 1, 12 on night 5, the `quit` event), walks home looking at nobody, and stays there 18 to 30 seconds. It loses sight of the guard for four seconds and searches where it last saw them. Or the guard gets into the booth and shuts the door, and it bangs on the door three times (four from night 3) and goes home. Walking into one always counts, hunting or not.

Each is a different problem:

- Big Biggs is slower than a walking guard, hunts half as long again as the others, and keeps knowing where his guard is for eight seconds after losing sight of them. He cannot be shaken round a corner, only outwalked.
- Madame Flan crawls while any guard is looking her way and runs when nobody is, faster than a guard can walk. The torch is not needed to slow her. Turning your back is the mistake.
- Squish is quicker than a walk and the only one that fits the ducts, where it is quicker still. It comes for whoever is sitting in the booth, by the vent if it is open, and it gets up for anyone who goes into the ducts, at any hour of any night.
- Tank walks slowly until it has six to sixteen clear metres to a guard. Then it roars, winds up for a second and a half, and charges in a straight line at more than twice a guard's walk. It does not steer and a torch does not stop it. If it hits a wall it is stunned for four seconds. Step out of the line, or do not be in a corridor.

Alone, Biggs and Flan are there from night 1, Squish from 3 AM that night and Tank from night 4 (`WAKE`). Each extra guard brings them two hours sooner. They are slowest on night 1 (`KEEN`).

A mascot within 1.25 metres with no wall between has you (`F.CATCH`). Furniture does not count as a wall, and one that is stuck behind furniture within 2.6 metres of the guard it is after reaches over after 1.2 seconds (`F.GRAB`), so there is nowhere in the building to stand that they cannot get to. The harness checks that against the furniture in `world/dressing.js`.

A flattened guard stays on the floor until another guard stands over them and holds use for three seconds, and then has four seconds in which nothing can touch them. The mascot that did it sits on them for three and a half seconds (`FEAST`), then stays and looks round for whoever comes to peel them up. Everyone flat at once ends the night, which for a guard alone is the first touch.

Lockers are the one place to hide. Every locker outside the booth is one (`HIDES` in `map.js`, read from the lockers in `dressing.js`): two backstage, two in the West Hall, and one each in the Arcade, the Kitchen, the Snack Bar and the East Hall. Holding use for half a second at one (`F.HIDE_HOLD`) steps a guard in, and a tap steps them out. One guard to a locker. Inside, the guard cannot move, the torch is off, the phone still works, and the view is out through the door slats, turned no more than about 50 degrees either way. Stamina comes back. Nothing sees, hears, lights or walks into a guard in a locker, and the wanderers do not head for one. A mascot does find them four ways (`openLockers`, `seenHiding` and `lockersNear` in `sim3d.js`):

- It saw them get in: one that could see the guard at that moment (`canSee`), or one hunting them that still knew where they were, which is the 1.2 seconds after losing sight that any of them keeps, and eight for Biggs (`RELENT`). It goes to the locker's doors and opens them as soon as it arrives.
- It checks. One that loses the guard it was hunting searches, and first looks in lockers within eight metres of where it last knew they were: each one at even odds, nearest first, two at most (`CHECK`). It walks to the doors and yanks them open, empty or not (the `check` event for an empty one). So hide further than that from where it lost you, or wait until it has run out of wind and gone home.
- It sniffs: it stands within 1.6 metres of the doors for three seconds (`SNIFF`), for any reason. A wanderer passing by is fine. One that stops there, or is searching there, is not.
- The doors are loud. Getting in or out is a noise of six metres at even odds (`LOCKER_NOISE`), so anything wandering nearby may come and search right outside.

A guard pulled out is flattened like any catch, and the `found` event comes first. With the power out the mascots come to where the guards are, as they always do in the dark, and a locker does not hide that: they walk to its doors and stand there until they open it. So a locker is for breaking a chase once round a corner, not for waiting out the night: the clocks keep coming due.

A Mini Biggs is the one thing a guard can throw (`TOY`). It is a palm-sized plush of Big Biggs on a keyring, from the gift shop, with a voice box that sings "Happy Birthday from Big Biggs!". Each guard clocks in holding one (`p.toy`) and can hold one at most. Its own cell died years ago, so it sings on the torch's battery: a throw costs 0.2 of a full battery, one of the five bars on the HUD, which is 13 seconds of torchlight or 3 seconds of phone, and it cannot be thrown on less. G, the right mouse button, RT or the Biggs button throws it where the guard is looking: as far as the floor the view meets, or 14 metres when looking level or up. It flies at 11 metres a second over the furniture and stops short of a wall or a shut door (`landing`). The guard's browser sends only the direction and the distance (`{ t: 'throw', yaw, d }`), and the host throws from where it has the guard and takes the battery, never from a locker and never with hands in a breaker box. Where it comes down it sings for three seconds, which is a `noise()` of 12 metres at 90% (`landToys`): the same hearing that picks up a fix or a locker door. A mascot that is wandering or searching nearby goes to look, and searches round it for a few seconds. One that is hunting, winding up, charging or banging on a door pays it no attention, and so does one on its way home or standing on its mark. Then it lies there (`S.toys`) until a guard with empty hands stands over it and presses use (`{ t: 'use', what: 'toy', id }`, decided by the host like everything else). Anyone's will do. So a Mini Biggs takes a wanderer off the way to a fault, or out of a corridor before it has seen you, but the next throw means walking to where you sent the mascots, and the bar it cost is light you will not have to hold the next one off. It does not end a chase. Every screen draws them in the air and on the floor (`actors/plush.js`).

The booth has three doors, and each button works from both sides of the wall, so nobody can be shut out. A door will not shut on anyone standing in it, guard or mascot. The wall map shows every mascot that is out of its place while the power is on.

## Balance

`node tools/balance/floor.mjs` plays every scenario 40 times through the real `sim3d.js` and `map.js` and prints a table (`--seeds`, `--only`, `--deaths` and `--trace` are explained at the top of the file). The guards walk with `route()` and `slide()` at the game's speeds, react a quarter to most of a second late, and only know what a person could: what is lit and in front of them, what is close enough to hear, the HUD, the wall map from the booth and a flat teammate's call. Careless, competent and expert guards play alone and in crews of 2, 3, 4 and 6. Then come the strategies that must lose: the booth sealed, one cranking while the rest hide, torches from a corner, ignoring the faults, one runner for three who stay in, camping the charger, kiting a loop, standing in the ducts or the vent doorway, and sitting in lockers all night. The `hides` scenarios are competent guards who also step into a free locker within five metres when something is after them and nothing they know of can see them, and come out after four quiet seconds. They show what the lockers are worth, and nothing asserts on them. It exits non-zero on a softlock (a mascot standing still for 30 seconds, a guard who cannot move, a night that does not end), a guard flattened in the first 30 seconds of night 1, or a bad strategy winning more than one night in ten and more than half as often as playing properly.

Where the rules stand, over 40 nights a row:

- A competent guard alone wins nights 1 to 5 about 73, 78, 55, 28 and 0 to 5% of the time. A careless guard wins a quarter of night 1s. The expert script wins 90% of night 1s, half of night 3s and a tenth of night 5s.
- Crews of 2, 3, 4 and 6 win nearly every night 1, 73 to 88% of night 2s, 33 to 53% of night 3s and 3 to 8% of night 5s. That is harder than the clocks were from night 3 on (a crew of four won 70% of night 3s and 28% of night 5s): a crew loses the power on 40 to 90% of its later nights. Open for tuning.
- Ignoring the faults loses every night. One guard fixing them while three stay in the booth wins about half of night 1s (the limit the harness allows) and none of night 3s.
- A third to two fifths of faults are left to burn on night 5, and under a tenth on night 1.
- A competent guard who is caught had a mascot in sight or earshot for a median 5 to 12 seconds first, and under 1.5 seconds one time in fourteen or less.
- The torch runs dry about once in three nights per guard on nights 3 to 5, and a tenth to a third of all flattenings happen with it dead.
- A competent guard who also ducks into lockers wins about as often as one who does not (85, 50 and 10% of nights 1, 3 and 5, against 90, 50 and 10%), and a crew of three that does wins less (45% of night 3s against 70). Sitting in lockers all night loses every night.
- Competent and expert guards throw their Mini Biggs at a wanderer in their way while the torch has two fifths left over after the bar it costs, and go back for it once it has had six seconds to work and nothing they know of is moving near it. They throw about one a night each, and about half a mascot goes to look per throw. They win as often as they did before it: over 200 nights, a guard alone won 54% of night 3s before and 55% with it, 7% and 5% of night 5s, a crew of three 22% and 22% of night 3s, and a crew of four 5% and 5% of night 5s. A crew that shuts itself in the booth with one each to throw at anything near the doors loses every night.
- The strategies that must lose lose every night 3. On night 1 one runner with three staying in wins under half (a crew playing properly wins them all), and the rest win one in ten or less.

## HUD, input and the screens around a night

`three/hud.js` draws the HUD as HTML over the canvas, styled by the "in the night" block of `styles.css`. It stays at the edges:

- Top left: the hour, the night, and building power. The bar turns yellow under 25% and red under 10%, and reads "Power out" at zero.
- Top left, under the power: the task list. One row per open fault, nearest first: the room, the job and the seconds before it burns. A row turns red for the last 15 seconds and says "burning" after that. The row of the box your hands are in has a green edge. With no faults open it says so.
- Top centre: a compass. Each open fault is a yellow mark with its walking distance, the nearest one filled, red and blinking in its last 15 seconds. A mark points at the next corner of the route there (`route` in `map.js`), not through the walls, because nobody knows the building on their first night. Flat teammates are red marks with a name, and a blue mark leads to the booth charger once the torch is under 25%. A mark past the end of the strip sits at that end with an arrow. Labels that would overlap are laid side by side under their marks (`spread` in `hud.js`).
- Under the compass: toasts for events. Each kind has its own icon and colour (`TOAST_ICON` in `hud.js`, the `.ts-f-toast.is-*` rules in the stylesheet), and the lines are in the `SAY` table in `app.js`.
- Top right: the other guards and the room each is in. A flat one is red and tagged, and one in a locker is tagged `locker`.
- Bottom left: the torch as a five-bar battery. Grey is off, yellow is on (the torch or the phone), red and blinking with a red glow in the corner is under 25%. Stamina is a thin bar above it that shows only while it is not full. Under the torch, whether your Mini Biggs is in hand, what a throw costs (a bar) and the key, greyed out with empty hands or less than a bar left.
- Centre: the prompt for whatever is in reach, with a bar for the ones that need holding.
- In a locker, the picture is seen between dark slats with the edges closed in, and the dot is gone. The slats are drawn in the scene (`three/slats.js`), after the world and before the held phone and torch, so the hands stay in front of the doors.

A flattened guard gets a panel saying who did it and how far the nearest standing guard is, and two things to do. Q (or the button) sends a `call` action. The host emits a `call` event at most every `F.CALL_GAP` seconds, and everyone else hears two notes, reads a toast and sees that guard's compass mark pulse. Space steps through the standing guards' views (`player.me.watch`, drawn by `spectate` in `app.js`) and back to your own. The watched guard's body, name tag and lens glow are not drawn while you look out through their eyes. With "Watch teammates from behind" on in the pause panel (`prefs.third`), the camera follows 3 m behind and above them instead, drawn in front of walls and shut doors and kept under the ceiling, and they are drawn as usual. A guard in a locker is not drawn on anyone's screen (`guard.js`), and their own camera stands just inside the doors (`LOCKER_LOOK` in `player.js`).

Input is in `three/player.js`. The mouse is captured on the first click. Esc releases it and opens the pause screen: the way back and a fullscreen button on the left, and tabs on the right for the controls, the settings (look sensitivity, invert-Y, "Highlight things you can use" and "Watch teammates from behind when you are flat", kept in `localStorage.tsFloor`) and the gamepad. Its size comes from the stage, not the window (a CSS size container), so it fits a Discord Activity's short frame. The night does not stop. The mouse is released for the screens between nights so their buttons can be clicked. A standard gamepad works: left stick walks, right stick looks, A uses, X is the torch, B is the phone and d-pad up zooms its map, RT throws a Mini Biggs, LB runs, Y calls, RB watches, Start pauses. On a keyboard it is G, or the right mouse button.

`three/touch.js` adds touch controls once a finger touches the screen, or from the start on a device with no fine pointer. A touch on the left 45% of the screen puts a stick under that thumb. A drag anywhere else looks. Use is held, the torch and phone buttons toggle, a Map button zooms the phone's map while it is up, the Biggs button throws a Mini Biggs where the view points (drag to look at the floor first for a short throw) and greys out with empty hands or without the battery for a throw, and Run stays on until the stick is released. Pause and fullscreen sit in the top right corner. The layout is landscape, and a phone held upright is asked to turn. The stage fills the window up to 21:9.

The lobby lists the rules, where every guard reads them while the others join. In the night there are no tutorial tips: the toasts only say what just happened, and the controls are on the click-to-play panel and the pause screen.

The end screens are in `ui.js`. They read `S.tally` (this night) and `S.total` (the run), which `sim3d.js` fills: faults fixed and faults left to burn, who was flattened and by which mascot, and who peeled someone up.

## Sound in the building

`three/sound.js` gives every sound a place. The listener is this guard's head. A mascot, another guard, the generator, the charger and each one-off event (a fault, a fix, a bang on a door) plays into an emitter: a low-pass filter, a panner with distance rolloff, and a send to the reverb that falls off more slowly than the sound, so far things are more echo than source. It builds no second audio graph. The recipes are `sample()`, `tone()`, `noise()` and `boom()` from `audio.js`, run inside `into(node, fn)` so they land in an emitter and not straight on the limiter. `main.js` plays only the win jingle, which has no place in the building.

Walls dull sound. Every 0.13 seconds an emitter asks `sees()` whether the listener has a line to it. If not, `doorwaysBetween()` counts doorways along the shortest way, a shut door counting double, and the `OCC` table turns that into a gain and a low-pass frequency. The panning is plain left-right (`equalpower`), because HRTF measured about twenty times the cost per source. Left-right panning cannot say "behind", so sounds behind the listener lose their top end.

What you can tell by ear:

- Which mascot. Footsteps fire by distance covered (`STRIDE`), so they keep time with its real speed. Big Biggs is a low boom and a slow heavy foot. Madame Flan is a dragging hem and pearls clicking, quiet, and quicker when nobody is watching her. Squish is a wet slap, or sheet metal while it is in the ducts, and it gulps. Tank is hooves, five a second at a charge. Rot makes all of them lower and wetter.
- What it is doing. Breath (`BREATH`) speeds up when it hunts. `spot` has a sound per mascot (`SPOT`) and a short hit if it is you it saw. A mascot held in a beam growls in short pulls and its costume creaks. `quit` is a long breath out when it gives up a chase. `roar` and `crash` are Tank winding up and hitting a wall. `bang` and `arrive` come from the door they happen at. A feeding mascot chews.
- What the mascots as a group are doing. `stir` is a groan through the reverb alone and `calm` a long creak. Nothing on screen marks either.
- Lockers: a sheet-metal clank and a latch from the locker when anyone gets in or out, a rattle when a mascot checks an empty one, and a wrench and a slam when it pulls someone out (`locker`, `check` and `found`).
- Mini Biggs: the squeak of its belly and a swish from whoever throws one, then a thump where it lands, a click, and two lines of Happy Birthday from a crushed three-bit voice box that drags and sags in pitch as the charge runs out, until the last note is a groan (`toy`, `song()` in `audio.js`, made once into a buffer so the whole song is one voice), and a squeak when someone picks it up (`grab`). The mascots hear the same thing you do, so you can follow one to it by ear.
- The other guards: footsteps, torch clicks, a fixed fault's clunk, relay and bell, a battery picked up, the two notes of a flat guard's `call`, all from where they are.
- The building: a room tone that is lower and louder in bigger rooms (`SIZE`), a mains hum that sags and stops on `out` and comes back on `on`, the generator's ratchet and dynamo, the charger's hum, the door motors (found by comparing `S.doors` between frames, since the `door` event does not say which), a bell for the hour, a pop and thud where a `fault` breaks out, a crackle from every open fault every two or three seconds so it can be found by ear, and a buzzer for `burn`.

Your own body is not placed: footsteps on the camera's bob, panting under 40% stamina, the torch switch, a buzz on each dip of a dying torch, and ticks while a use is held.

Being flattened plays a stinger hung on the catch's timings (`CUES` in `actors/scare.js`): a hit at the grab, the mascot's growl at the face (pitched per mascot, `GROWL_RATE`), lower at the bite, then the floor. From then `muffle()` in `audio.js` closes a low-pass over the whole mix, heartbeat included, until you are peeled. Inside a locker it closes part way (`IN_LOCKER`), so the building is heard through steel. Another guard going flat is a splat, a falling whistle and three bubbles, from where it happened.

The heartbeat, the dread drone, the wind and the far-off oddities are still `ambience()` in `audio.js`, driven from `main.js` by `app.threat()` and `dreadF(S)`. `sound.js` plays no heartbeat or drone of its own.

One-shots are counted (`voices()` in `audio.js`) and cut from the graph when they end. Past 32 new ones are dropped, and past 18 footsteps and other texture are skipped first. With `?debug`, `ts.floor.sound.stats()` returns the live voices, the always-running sources and the emitters. Nothing is built until the audio context is running, and events that arrive before that are dropped, not queued.

## The building, its light and the picture

`three/world.js` puts the Depot together from the files in `three/world/`:

- `surfaces.js` and `tex.js` paint every floor, wall and ceiling with the 2D canvas when the game loads: a colour map, a normal map from a height canvas, and a roughness map. Each room has its own set (`LOOK`), so one torch-lit patch of floor says which room you are in. A wall texture covers the full height of its room, so dados and damp sit at real heights.
- `art.js` draws what is stuck on the walls: the posters and the mural of the mascots in their friendly days, staff notices, stains, and the room names. `shell.js` stencils the name of the next room over each doorway, beside it in a low room, or on the floor where the door fills the wall.
- `shell.js` builds the geometry from `walls()`, `slabs()` and `DOORWAYS` in `map.js`, so the picture cannot drift from the collision. Skirting, door frames, pipes, the stage's arch and the lamp housings go into one mesh (`geo.js`). The stage platform is 12 cm high and nobody climbs it. The game is flat.
- `props.js` stands the two prop kits (`models/props_a.glb`, `props_b.glb`) where `dressing.js` says. Static props in a room that share a material are merged into one mesh. A kit that has not been built leaves its props out.
- `usable.js` is the breaker boxes (door hanging open, sparks and a red lamp while faulted, and an orange point light on the nearest three open faults), door buttons, generator, charger, batteries, booth doors and wall map. Each is a plain stand-in until its kit model loads.
- `sight.js` works out which rooms can be seen from the 2 m square of floor the camera is in, by casting a fan of rays over a grid of the walls, and keeps the answer. Props and usable things in every other room are hidden. three.js culls what is outside the view, not what is behind a wall, and without this the booth draws the kitchen.

`dressing.js` is plain data. `map.js` imports it to fill `OBSTACLES`, which is how the host walks mascots round furniture without loading a model. After moving a prop or a waypoint, run `node tools/check-floor.mjs`. It fails if a doorway, a waypoint, a breaker box, a button, a battery spot, a locker's doors, a resting mark or a spawn point is blocked or cut off. A locker placed anywhere but the booth is a hiding place, so give it a metre of clear floor in front.

The building's lamps are not three.js lights. `light.js` bakes them at load into 168 by 176 floor-plan textures, one texel per 25 cm, with the walls casting soft shadows and each room getting some of its own light back as bounce. Every `MeshStandardMaterial` in the scene is patched (`lit`) to look its light up by world position, so mascots, guards and props get it too. The steady lamps are one texture in colour. The second holds four groups, one per channel: two kinds of flicker, a tube that is mostly dead, and the exit signs, which have batteries. A third holds the glow of props with lit screens, baked once the kits have loaded and only for props that did. A group flickers by changing one uniform. With the power out the steady and flickering groups go to zero and the exit signs, the breaker boxes' lamps and the torches are all there is. A fourth texture, two texels a metre, is a mask of how much light each room is getting (`roomMask`): it stutters while a fault in the room is open and drops to almost nothing once `darkRoom` says the room is dark; the exit signs ignore it. To add a lamp, add a row to `LAMPS`.

The same patch adds two terms no spotlight gives. One is a little spill round the torch, so a mascot standing beside the beam is a shape. The other is a trace of night vision within a couple of metres, so the dark is not one flat value. The torch itself (`player.js`) gets a cookie texture with a hot centre and the reflector's rings, and dust that shows only inside the beam. Held close to a wall the beam would bleach it, so the exposure stops down as the lit surface comes nearer than five metres (`GLARE_FROM`). That is what makes a notice readable at arm's length.

Real lights in the scene: the local torch (the only shadow caster, and its shadow pass is skipped while it is off), three point lights that move to the nearest open faults, and whatever `actors.js` gives other guards' torches. With `?debug`, `ts.floor.renderer.info` counts a whole frame. With one prop kit loaded a frame is 70 to 140 draw calls with the torch off and up to about 300 with it on, because the shadow pass draws every caster in the beam a second time. About 30 of those are the building, up to 50 are props and usable things, and the rest are mascots and guards.

`three/post.js` draws the scene into a half-float buffer and finishes it in one full-screen pass: exposure, ACES tone mapping, a vignette, grain, and colour fringing at the edges. Dread (`dreadF`, which fills through each night and starts higher on later ones) drains colour, tightens the vignette, thickens the fog and makes the lamps sag. Threat (`app.threat()`) adds grain, fringing and bands of the picture slipping sideways. The grain goes on after tone mapping with a small lift under it, which keeps black areas from being one flat value on a laptop screen. The CSS grain on `.ts-stage` is off while a night is drawn.

Usable things get a gold outline, like the highlight in some games' accessibility modes, so they read as something to walk to in the dark (`three/outline.js`). Open faults pulse gold, red in their last 15 seconds, wherever they can be seen; flat teammates are red; batteries, the crank, the charger and door buttons are a faint gold within 6 metres; and whatever the use key would act on gets the widest, brightest edge. The pause panel's switch turns it off (`prefs.outline`, on by default). Only while something is marked, `post.js` draws those meshes again, flat, into a mask (they go on layer 7 under `scene.overrideMaterial`, each setting its colour as it is drawn), and drops any fragment the scene's depth texture puts behind a wall. The full-screen pass edges the mask with eight taps at up to three widths and lays the edge over the finished picture, after tone mapping, so it shows in the dark. The torch's shadow is not redrawn for the mask.

Quality is `high` or `low` (`QUALITY` in `post.js`). High draws at up to 1280 pixels across with a 1024 shadow map, low at 854 with a 512 map and no fringing. The game starts on high, times sixty frames once the shaders have compiled, and drops to low if they average over 26 ms. `?q=low` or `?q=high` in the URL fixes it.

## Mascots, other guards and the catch

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

A mascot with no model yet is a stand-in built from the same named parts, so it moves by the same rules. The next rot stage is loaded as soon as the current one shows. When `m.rot` changes, each screen swaps the model only while it cannot see the mascot: a wall is in the way, or it is off the edge of the picture. Dark does not count, since its eyes still show. One you keep looking at stays as it was until you look away.

Materials named `eye_glow` are drawn unlit and without fog (`loadActor` in `assets.js`), and each gets a soft point drawn over it that never shrinks below a few pixels, so an unlit mascot is a black shape with two pale points at any distance. Mascots the camera has no line of sight to are hidden and not animated.

`guard.js` is another guard: `guard.glb`, walking on the same rule, head and torch arm following their pitch, flattened by a spring that overshoots and peeled with a pop. A name shows within 7 m and in sight, or within 25 m when the guard is flat. Only the two nearest lit torches are real spotlights; the rest are a glowing lens. With the phone up a guard's left arm comes forward with a phone in the hand and a green glow on it, and their torch arm drops. `hands.js` holds the `flashlight` from `props_a.glb` in front of the camera.

`plush.js` draws every Mini Biggs in `S.toys`: a lob from the thrower's hand, tumbling, then on the floor sat up and rocking with the tune while a red light in its tummy blinks, slower as the cell gives out, then tipped over on its back until someone picks it up or the night ends. On the floor it gets the faint gold outline while your hands are empty. It is built from a few spheres and a cone with the colours in the vertices, one mesh and a light each.

`phone.js` is your own phone: a late-90s candybar built from boxes in code, with a stub aerial, a green-lit keypad and a hand round it, at the bottom left of the view. Its screen is a canvas from `three/minimap.js`, redrawn eight times a second like an old green LCD. Near, it is about 26 metres across, centred a little below the middle on you, and turns with you so that ahead is up, with an N at the edge. R zooms out to the whole building with north up. It shows the rooms and doorways, shut booth doors in red, other guards (a grey cross for a flat one), the open faults (blinking amber), the generator and the charger, spare batteries, and every mascot off its mark as a red blip, the same mascots the booth's wall map shows.

`scare.js` is the catch, from the `flat` event for this guard. For a second and a half the camera is taken to the mascot's face (`face` in the manifest; the worm's mouth for Tank at stage 2) while the mascot plays its `scare` pose, then dropped to the floor as it sits. A 2D canvas over the 3D one strobes and tears the frame, and does neither under `prefers-reduced-motion`. The cues are `CUES` in that file: `grab` 0, `face` 0.12, `bite` 0.62, `drop` 1.05, `floor` 1.3, `end` 1.5 seconds. `app.actors.scare.listen((cue, by, seconds) => ...)` calls back as each passes, and `app.actors.scare.now` is `{ by, t, cue }` during a catch.

## Recordings

Doors, bangs, footsteps, creaks, wind and growls are recordings in `public/sfx`. The hum, heartbeat and chimes are synthesised in `audio.js`, because they change with dread and threat as you play. Each recording has a synthesised stand-in that plays if the file has not loaded.

All recordings are CC0, converted to mono MP3:

- `door_*`, `slam*`, `sheet*`, `thud`, `knock*`: [100 CC0 metal and wood SFX](https://opengameart.org/content/100-cc0-metal-and-wood-sfx) (OpenGameArt)
- `hit_low`, `hit_long`: [Horror hit soundpack 1](https://opengameart.org/content/horror-hit-soundpack-1) (OpenGameArt)
- `steps*`, `creak*`, `wind`, `scare_growl`, `far_growl*`: [Free horror SFX](https://liminal-space-dev.itch.io/free-horror-sfx-sounds) by Liminal Games (itch.io)

A bang on a shut door is one of four layered recipes in `BANGS`, picked at random. Recordings pass through a generated room reverb (`room()`), with more of it for sounds that are further away.
