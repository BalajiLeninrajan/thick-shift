// The renderer and the frame. main.ts imports this file while the lobby is up,
// or the first time a night is drawn, so the title screen never waits on three.js.

import { dreadF } from '@thick-shift/sim';
import { defined, isPlaced } from '@thick-shift/sim/check';
import { MASC } from '@thick-shift/sim/config';
import { angDiff, BOXES, dist, EYE, ROOMS3, reaches, roomAt } from '@thick-shift/sim/map';
import type { EventType, Player, State } from '@thick-shift/sim/types';
import * as THREE from 'three';
import { query } from '../dom';
import { client, currentState, game, LINGER_S, myPlayer } from '../state';
import type { EventOf } from '../types';
import { createActors } from './actors';
import { createPhone } from './actors/phone';
import { loadActor, loadJSON } from './assets';
import { createCams } from './cams';
import { createHud, where } from './hud';
import { createOutlines } from './outline';
import { createPlayer, prefs, TORCH_FULL } from './player';
import { createPost } from './post';
import { createSlats } from './slats';
import { createSound } from './sound';
import { createTask } from './task';
import { buildWorld } from './world';

let app: ReturnType<typeof create> | null = null;
const FOG = 0.037,
  FOG_DREAD = 0.03; // fog density on a quiet night, and what a bad one adds
const HUNTING: ReadonlySet<string> = new Set(['hunt', 'windup', 'charge', 'search']);

function create() {
  const stage = query(document, '.ts-stage', HTMLDivElement); // in each app's index.html
  const canvas = document.createElement('canvas');
  canvas.id = 'c3';
  // The HUD's element. The task panel goes in it first, because the guard needs the panel and the HUD needs the guard.
  const root = document.createElement('div');
  root.className = 'ts-fhud';
  stage.append(canvas, root);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030305);
  const fog = new THREE.FogExp2(0x030305, FOG);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.06, 90);
  scene.add(camera);

  const world = buildWorld(scene),
    actors = createActors(scene, camera, renderer),
    player = createPlayer(camera, canvas, createTask(root)),
    hud = createHud(root, player),
    sound = createSound();
  const outlines = createOutlines(world.parts, actors);
  // post.ts draws the frame and owns its resolution and the torch's shadow map; the torch gets a cheap torch's beam pattern.
  const post = createPost(renderer, player.torch);
  player.torch.map = world.torchCookie();
  const phone = createPhone(camera); // in the left hand, with the minimap on its screen
  const cams = createCams(scene, root, player); // the booth's cameras, and the frame while a guard watches them
  const slats = createSlats(scene); // the locker doors, drawn behind the hands
  let last = performance.now(),
    lastT = 1e9,
    lastNight = 0,
    lastEv = -1,
    fear = 0,
    shown = false,
    seat: { x: number; z: number; yaw: number; pitch: number; back: number } | null = null;

  function show(on: boolean): void {
    if (on === shown) return;
    shown = on;
    canvas.hidden = !on;
    root.hidden = !on;
    stage.classList.toggle('is-live', on); // the picture has its own grain (post.ts)
    if (!on && document.pointerLockElement === canvas) document.exitPointerLock();
    if (!on) sound.quiet();
  }

  // A flat guard can watch a standing teammate (player.me.watch is their id): through their eyes, or with
  // prefs.third from behind and above them. seat is that view, eased between the room's updates.
  const BACK = 3,
    ABOVE = 2.2,
    AIM = 1.4; // third person: metres behind, camera height, and the height looked at
  function spectate(S: State, dt: number): void {
    // watchNext only picks a guard the night has placed.
    const p = S.players.find(q => q.id === player.me.watch);
    if (!p || !isPlaced(p)) {
      seat = null;
      return;
    }
    const k = seat ? Math.min(1, dt * 10) : 1;
    seat ||= { x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch, back: BACK };
    seat.x += (p.x - seat.x) * k;
    seat.z += (p.z - seat.z) * k;
    seat.pitch += (p.pitch - seat.pitch) * k;
    seat.yaw += angDiff(p.yaw, seat.yaw) * k;
    if (!prefs.third) {
      camera.position.set(seat.x, EYE, seat.z);
      camera.rotation.set(seat.pitch, seat.yaw + Math.PI, 0, 'YXZ');
      return;
    }
    // Drawn in to stay this side of a wall or a shut door (furniture it looks over), quickly when one comes between
    // and slowly back out, and kept under the ceiling, which in the ducts is low.
    const fx = Math.sin(seat.yaw),
      fz = Math.cos(seat.yaw);
    let back = BACK;
    while (back > 0.5 && !reaches(seat.x, seat.z, seat.x - fx * (back + 0.3), seat.z - fz * (back + 0.3), S.doors)) back -= 0.25;
    seat.back += (back - seat.back) * Math.min(1, dt * (back < seat.back ? 20 : 3));
    const h = ROOMS3[roomAt(seat.x, seat.z)]?.h ?? 3;
    camera.position.set(seat.x - fx * seat.back, Math.min(ABOVE, h - 0.35), seat.z - fz * seat.back);
    camera.lookAt(seat.x, Math.min(AIM, h - 0.6), seat.z);
  }

  // What each new event means on this screen, beyond its sound (sound.ts plays
  // those). hud.say takes the line, its kind (which sets icon and colour) and seconds.
  // Everything below runs from tick, which main.ts calls only while there is a room. A fault or fix event comes
  // from a night, which has S.faults, and its i is a BOXES index.
  const guard = (id: string): Player | undefined => currentState().players.find(p => p.id === id),
    isMe = (id: string): boolean => id === game.myId,
    roomOfBox = (i: number): string | undefined => ROOMS3[defined(BOXES[i], `box ${i}`).room]?.name;
  type Sayings = { [K in EventType]?: (e: EventOf<K>) => void };
  const SAY = {
    // A fault broke out, and where.
    fault(e: EventOf<'fault'>): void {
      if (!currentState().faults?.[e.x.i]) return;
      hud.say(`Fault in the ${roomOfBox(e.x.i)}.`, 'fault', 4);
    },
    fix(e: EventOf<'fix'>): void {
      const left = defined(currentState().faults, "a night's faults").filter(Boolean).length,
        rest = left ? `${left} still open.` : 'All clear.';
      hud.say(isMe(e.x.by) ? `Fixed. ${rest}` : `${guard(e.x.by)?.name || 'Someone'} fixed the ${roomOfBox(e.x.i)}. ${rest}`, 'fixed', 3);
    },
    burn: (): void => hud.say('A fault is burning. Max power is dropping.', 'burnt', 6),
    out: (): void => hud.say('Power out. Every door is open.', 'out', 7),
    on: (): void => hud.say('Power back.', 'back', 3),
    flat(e: EventOf<'flat'>): void {
      const who = guard(e.x.id);
      if (!isMe(e.x.id) && who) {
        hud.say(`${MASC[e.x.by].name} flattened ${who.name} ${where(e.x)}.`, 'down', 6);
      }
    },
    peel(e: EventOf<'peel'>): void {
      if (isMe(e.x.id)) hud.say("Back up. They won't notice you for a few seconds.", 'up', 4);
      else hud.say(`${isMe(e.x.by) ? 'You' : guard(e.x.by)?.name || 'Someone'} peeled ${guard(e.x.id)?.name || 'someone'} up.`, 'up', 3);
    },
    // A flat guard calling out. sound.ts plays its two notes from where the guard lies.
    call(e: EventOf<'call'>): void {
      hud.ping(e.x.id);
      if (!isMe(e.x.id)) hud.say(`${guard(e.x.id)?.name || 'Someone'} is calling from the floor ${where(e.x)}.`, 'call', 4);
    },
    bat(e: EventOf<'bat'>): void {
      if (isMe(e.x.by)) hud.say('Fresh battery.', 'torch', 2.5);
    },
    found(e: EventOf<'found'>): void {
      if (isMe(e.x.id)) hud.say(`${MASC[e.x.i].name} opened the locker. Run!`, 'hide', 3);
      else hud.say(`${MASC[e.x.i].name} found ${guard(e.x.id)?.name || 'someone'} in a locker ${where(e.x)}.`, 'hide', 6);
    },
    // Caught with hands in a breaker box or at the camera desk: the room has broken it off, so the panel shuts, or they
    // are up from the desk.
    startle(e: EventOf<'startle'>): void {
      if (!isMe(e.x.id)) return;
      player.letGo();
      player.stand();
      hud.say(`${MASC[e.x.i].name} is on you. Run!`, 'hide', 3);
    },
    fumble(e: EventOf<'fumble'>): void {
      if (isMe(e.x.by)) hud.say('Something is blocking the door.', 'info', 3);
    },
    bonk(e: EventOf<'bonk'>): void {
      if (isMe(e.x.by)) hud.say(`Bonk! ${MASC[e.x.i].name} is stunned for a few seconds.`, 'toy', 3);
    },
    grab(e: EventOf<'grab'>): void {
      if (isMe(e.x.by)) hud.say('Mini Biggs in hand.', 'toy', 2.5);
    },
  } satisfies Sayings;
  // say is generic in the event type so that TS can match SAY's handler for that type to the event; indexing SAY
  // with a plain EventType could not.
  function say<K extends EventType>(type: K, e: EventOf<K>): void {
    const sayings: Sayings = SAY;
    sayings[type]?.(e);
  }

  // How scared this guard should be right now, 0 to 1: something hunting, close.
  function threat(): number {
    const S = currentState(),
      me = player.me;
    let worst = 0;
    for (const m of S.m) if (HUNTING.has(m.st)) worst = Math.max(worst, (m.st === 'search' ? 0.5 : 1) * Math.max(0, 1 - dist(m, me) / 16));
    return worst;
  }

  return {
    show,
    tick(now: number): void {
      const S = currentState(), // main.ts calls frame() only while there is a room
        dt = Math.min(0.1, (now - last) / 1000),
        t = now / 1000;
      last = now;
      show(true);
      post.fit(canvas, camera);
      const mine = myPlayer(S);
      // A night began: another night, or this one from the start. A room brought back from storage can rewind the
      // clock by the two seconds since its last save, which is not a new night.
      if ((S.night !== lastNight || S.t < lastT - 3) && mine?.x != null) {
        player.reset(mine);
        actors.reset();
        hud.reset();
      }
      if (mine?.x != null) {
        lastT = S.t;
        lastNight = S.night;
      }
      // Created part way through a night: what has happened has happened (sound.ts does the same).
      if (lastEv < 0) lastEv = S.evId;
      for (const e of S.evs)
        if (e.id > lastEv) {
          lastEv = e.id;
          say(e.type, e);
          actors.event(e, S, player.me);
        }
      player.update(S, dt, now);
      spectate(S, dt);
      // At the desk the frame is the camera being watched, until something catches them there.
      const watching = player.me.cam >= 0 && !actors.scare.active,
        eye = watching ? cams.camera : camera;
      cams.update(S, player.me, watching, now, camera.position, dt);
      const dread = dreadF(S);
      fear = threat();
      fog.density = FOG + FOG_DREAD * dread;
      world.update(S, t, dt, eye, watching ? 0 : player.torch.intensity / TORCH_FULL, dread, fear);
      actors.sync(S, dt, player.me, player.torch, eye); // also runs the catch, which takes the camera
      // The end card (ui.ts) waits until LINGER_S after the catch is over, however long a slow machine takes over it.
      if (actors.scare.active) client.holdUntil = Math.max(client.holdUntil, now + LINGER_S * 1000);
      phone.update(S, player.me, dt, now, actors.scare.active);
      slats.update(S, player.me, dt, actors.scare.active);
      sound.update(S, player.me, dt);
      hud.update(S, player.me, actors.scare.active);
      if (watching) cams.render(renderer, canvas, player.torch, now);
      else post.render(scene, camera, now, fear, dread, world.stop, outlines.pick(S, player.me, t));
      actors.after();
    },
    // The threat this frame's tick worked out, for the heartbeat (main.ts).
    threat: () => fear,
    player,
    actors,
    world,
    scene,
    camera,
    renderer,
    sound,
    post,
    phone,
  };
}

// The models a night opens with, asked for while the lobby is still up (main.ts): the guard and each mascot's first
// stage. assets.ts keeps every load that worked by name, so actors/guard.ts and actors/mascot.ts get these same loads
// when the night is made. One that failed here is not kept, and the night asks for it again. Nothing is drawn and no
// canvas is made.
// The two prop kits need no asking here, because world/props.ts loads them as soon as it is imported. It keeps that
// one load for good, so a kit that fails leaves its props out for the session. That was so before the lobby imported
// this file, only the import came later, at the first frame of a night.
export function preload(): void {
  loadActor('guard');
  for (const { k } of MASC) {
    loadActor(`${k}_0`);
    loadJSON(k);
  }
}

export function frame(now: number): ReturnType<typeof create> {
  app ??= create();
  app.tick(now);
  return app;
}
export function hide(): void {
  app?.show(false);
}
