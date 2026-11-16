# Thick Shift

Midnight at the Mascot Depot. A co-op night-shift survival game: keep the very large retired mascots out of the security booth until 6 AM.

## Run it

There is no build step. The game is plain ES modules in `public/`, so it needs a web server (opening `index.html` from disk will not load the modules).

```sh
pnpm install
pnpm dev        # local server through Wrangler
pnpm deploy     # publish to Cloudflare Workers
```

Any static server pointed at `public/` works too.

Add `?dev` to the URL for the dev menu (the Dev button, or the backtick key): god mode, infinite power, freeze, game speed, forced rot stage and dread, time skips, and per-mascot controls. Only the host's changes reach the simulation. Add `?debug` to get `window.ts` (the live `game` and `client` state) in the console.

## Layout

```
wrangler.jsonc      Cloudflare Workers config (static assets only)
public/
index.html          markup and the control bar
styles.css          stage layout; everything else comes from catppuccin-neu
peerjs.min.js       vendored PeerJS, used for rooms
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
    screens.js      generator, HUD, jumpscare, title backdrop
    frame.js        picks the scene for the current state
```

## How the pieces talk

The host runs `sim.js` ten times a second and sends the full state `S` to every guest. Guests never change `S`. They send actions (`door`, `view`, `name`) to the host through `net.send`. Rendering reads `S` plus `client` and nothing else, so any scene can be reproduced by setting those two objects.

## Winning

A run is five nights (`FINAL_NIGHT` in `config.js`). Surviving a night sets `S.phase` to `'win'` and offers the next one; surviving the last sets it to `'won'`, which shows the morning scene and the run's tallies (`S.slams`, `S.deaths`). Dying retries the same night, so the tallies carry across attempts.

## Rot and dread

Mascots start each night as the costumes they were and come apart as it goes on. `rotOf(S, m)` in `rules.js` returns a stage: 0 is the cute costume, 1 is off (dull fur, too many teeth), 2 is the tall shaggy thing with extra limbs. Time moves every mascot along, and each door slammed on a mascot (`m.bangs`) moves that one faster. Later nights start further along.

`dreadOf(S)` is the same idea for the building, from 0 to 1. The office gloom, lamp flicker, fog, camera colour drain, poster glitches and background sound all scale with it. `threatOf(S)` is separate and short-lived: it rises while something stands at an open door, and drives the heartbeat and the red at the edges of the screen.

## Sanity and the lights

Each guard has a sanity level, kept by the host in their player record (`updateSanity` in `sim.js`, rates in `SANITY`). It falls in the dark and while something stands at an open door. Watching an off or rotten mascot on camera also costs a little, very slowly. It recovers in the booth with the lights on and nothing at the doors.

It gets worse each night and each hour (`wear` and `sanityCap` in `sim.js`): the ceiling starts lower every night and sinks as the night goes on, down to 29% at 6 AM on night 5. Power follows the same idea (`powerWear`): everything draws 70% of its rate on night 1 and 105% by night 5. The crank returns less power the lower the cranking guard's sanity, down to a quarter of its rate.

The tuning target is night 5: a guard who makes a couple of mistakes should end it with under 10% power and sanity just into the red.

Low sanity does three things:

- Pressing to shut a door can do nothing (`doorFailChance` in `rules.js`: about a quarter of presses at half sanity, 70% at zero). Opening never fails, and neither does shutting a door in the last quarter of a mascot's wait behind it (`LAST_MOMENT` in `sim.js`). The guard who fumbled is told; everyone hears the click.
- Below 60% the game plays real event sounds when nothing happened (`FALSE_ALARMS` in `audio.js`).
- Below 50% an empty camera room sometimes shows a silhouette that is not in the game state (`phantom` in `cams.js`).

The booth lights are a shared switch (`S.lights`, the Lights button or L). Off saves about two thirds of the idle power drain (`DRAIN` in `sim.js`), shows doorways as silhouettes, and drains everyone's sanity.

Attacks are paced by lulls. After a mascot is turned away, `S.calmUntil` keeps every mascot from arriving at a door for a random stretch (see `lull` in `sim.js`): usually 20 to 45 seconds, sometimes twice that, and on later nights occasionally almost none. A mascot that wants to arrive during a lull waits one room away. No night has more than seven attacks (`MAX_ATTACKS`), and whatever is left of that budget is spread over the time remaining so the last hours are never safe. Later nights get shorter door timers, some attacks that are two mascots at once from night 4, and a weaker guard (see Sanity).

Camera feeds wear out while a player watches them. Each player has a `client.signal` level that drains while they are on the cameras and recovers in under a second once they leave. A worn feed tears and fills with static; below about 40% its light starts cutting out and everything in the room is drawn as a silhouette. It gets worse through the night: a feed lasts a minute at midnight and 10 seconds at 4 AM, and from 4 AM it is already tearing when you open it (`camCap` and `camLife` in `rules.js`). This is per player and not synced, so two guards can see different feeds.

To add a mascot, add an entry to `MASC` in `config.js`, then give `COSTUME` (stages 0 and 1), `HEAD` (stage 2), `BODY` and `NECK` in `render/mascot.js` an entry with the same key.

## Sound

Doors, bangs, footsteps, creaks, wind and growls are recordings in `public/sfx`. The hum, heartbeat, chimes and UI clicks are synthesised in `audio.js`, because they change with dread and threat as you play. Each recording has a synthesised stand-in that plays if the file has not loaded.

All recordings are CC0, converted to mono MP3:

- `door_*`, `slam*`, `sheet*`, `thud`, `knock*`: [100 CC0 metal and wood SFX](https://opengameart.org/content/100-cc0-metal-and-wood-sfx) (OpenGameArt)
- `hit_low`, `hit_long`: [Horror hit soundpack 1](https://opengameart.org/content/horror-hit-soundpack-1) (OpenGameArt)
- `steps*`, `creak*`, `wind`, `scare_growl`, `far_growl*`: [Free horror SFX](https://liminal-space-dev.itch.io/free-horror-sfx-sounds) by Liminal Games (itch.io)

A bang on a shut door is one of four layered recipes in `BANGS`, picked at random. Recordings pass through a generated room reverb (`room()`), with more of it for sounds that are further away.

## Performance notes

Stroking curves is the slowest thing the 2D canvas does here, so outlines are darker shapes drawn underneath. Art that never changes (the room, mascot bodies, glows) is baked into offscreen sprites with `bake()` in `render/canvas.js`.
