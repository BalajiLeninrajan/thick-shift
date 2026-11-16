# Thick Shift

Midnight at the Mascot Depot. A co-op night-shift survival game: keep the very large retired mascots out of the security booth until 6 AM.

## Run it

There is no build step. The game is plain ES modules in `public/`, so it needs a web server (opening `index.html` from disk will not load the modules).

```sh
pnpm install
pnpm dev        # local server through Wrangler
pnpm deploy     # publish to Cloudflare Workers
```

Any static server pointed at `public/` works too. Add `?debug` to the URL to get `window.ts` (the live `game` and `client` state) in the console.

## Layout

```
wrangler.jsonc      Cloudflare Workers config (static assets only)
public/
index.html          markup and the control bar
styles.css          stage layout; everything else comes from catppuccin-neu
peerjs.min.js       vendored PeerJS, used for rooms
src/
  config.js         constants, rooms, hit zones, palette, mascot roster
  state.js          the two shared mutable objects: game (session) and client (this browser's view)
  rules.js          read-only questions about a state: who is at which door, what time it is
  sim.js            host-only simulation: power, mascot movement, player actions
  net.js            hosting and joining rooms; the host broadcasts the whole state
  audio.js          synthesised sound effects
  ui.js             overlay screens and control-bar state
  input.js          buttons, keyboard, pointer panning, tilt
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

## Rot and dread

Mascots start each night as the costumes they were and come apart as it goes on. `rotOf(S, m)` in `rules.js` returns a stage: 0 is the cute costume, 1 is off (dull fur, too many teeth), 2 is the tall shaggy thing with extra limbs. Time moves every mascot along, and each door slammed on a mascot (`m.bangs`) moves that one faster. Later nights start further along.

`dreadOf(S)` is the same idea for the building, from 0 to 1. The office gloom, lamp flicker, fog, camera colour drain, poster glitches and background sound all scale with it. `threatOf(S)` is separate and short-lived: it rises while something stands at an open door, and drives the heartbeat and the red at the edges of the screen.

To add a mascot, add an entry to `MASC` in `config.js`, then give `COSTUME` (stages 0 and 1), `HEAD` (stage 2), `BODY` and `NECK` in `render/mascot.js` an entry with the same key.

## Performance notes

Stroking curves is the slowest thing the 2D canvas does here, so outlines are darker shapes drawn underneath. Art that never changes (the room, mascot bodies, glows) is baked into offscreen sprites with `bake()` in `render/canvas.js`.
