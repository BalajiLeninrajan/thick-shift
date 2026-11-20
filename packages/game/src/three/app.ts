// The renderer and the frame. main.ts imports this file the first time a
// night is drawn, so the title screen and lobby never wait on three.js.
import * as THREE from 'three';
import { MASC } from '@thick-shift/sim/config';
import { game, client } from '../state';
import { buildWorld } from './world';
import { createPlayer, prefs } from './player';
import { createActors } from './actors';
import { createHud, where } from './hud';
import { createTask } from './task';
import { EYE, BOXES, ROOMS3, roomAt, reaches } from '@thick-shift/sim/map';
import { createSound } from './sound';
import { createPost } from './post';
import { createPhone } from './actors/phone';
import { createSlats } from './slats';
import { createOutlines } from './outline';
import { dreadF } from '@thick-shift/sim';
import type { Player, State } from '@thick-shift/sim/types';
import type { EventOf } from '../types';

let app: ReturnType<typeof create> | null = null;
const FOG = 0.037,
  FOG_DREAD = 0.03; // fog density on a quiet night, and what a bad one adds
const TORCH_FULL = 60; // the torch's intensity on a full battery (player.ts)

function create() {
  const stage = document.querySelector<HTMLDivElement>('.ts-stage');
  const canvas = document.createElement('canvas');
  canvas.id = 'c3';
  stage.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030305);
  scene.fog = new THREE.FogExp2(0x030305, FOG);
  const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.06, 90);
  scene.add(camera);

  const world = buildWorld(scene),
    actors = createActors(scene, camera, renderer),
    player = createPlayer(camera, canvas),
    hud = createHud(stage, player),
    sound = createSound();
  player.setTask(createTask(hud.root));
  const outlines = createOutlines(world.parts, actors);
  // post.ts draws the frame and owns its resolution and the torch's shadow map; the torch gets a cheap torch's beam pattern.
  const post = createPost(renderer, player.torch);
  player.torch.map = world.torchCookie();
  const phone = createPhone(camera); // in the left hand, with the minimap on its screen
  const slats = createSlats(scene); // the locker doors, drawn behind the hands
  let last = performance.now(),
    lastT = 1e9,
    lastEv = 0,
    shown = false,
    seat: { x: number; z: number; yaw: number; pitch: number; back: number } | null = null;

  function show(on: boolean): void {
    if (on === shown) return;
    shown = on;
    canvas.hidden = !on;
    hud.root.hidden = !on;
    stage.classList.toggle('is-live', on); // the picture has its own grain (post.ts)
    if (!on && document.pointerLockElement === canvas) document.exitPointerLock();
    if (!on) sound.quiet();
  }

  // A flat guard can watch a standing teammate (player.me.watch is their id): through their eyes, or with
  // prefs.third from behind and above them. seat is that view, eased between the host's updates.
  const LINGER = 1.5; // seconds a caught guard lies looking up at what sat on them before the night's end card
  const BACK = 3,
    ABOVE = 2.2,
    AIM = 1.4; // third person: metres behind, camera height, and the height looked at
  function spectate(S: State, dt: number): void {
    const p = S.players.find(q => q.id === player.me.watch);
    if (!p) {
      seat = null;
      return;
    }
    const k = seat ? Math.min(1, dt * 10) : 1;
    seat ||= { x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch, back: BACK };
    seat.x += (p.x - seat.x) * k;
    seat.z += (p.z - seat.z) * k;
    seat.pitch += (p.pitch - seat.pitch) * k;
    seat.yaw += Math.atan2(Math.sin(p.yaw - seat.yaw), Math.cos(p.yaw - seat.yaw)) * k;
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
  const guard = (id: string): Player => game.S.players.find(p => p.id === id),
    isMe = (id: string): boolean => id === game.myId;
  const SAY = {
    // A fault broke out, and where.
    fault(e: EventOf<'fault'>): void {
      const f = game.S.faults[e.x.i];
      if (!f) return;
      hud.say(`Fault in the ${ROOMS3[BOXES[e.x.i].room]?.name}.`, 'fault', 4);
    },
    fix(e: EventOf<'fix'>): void {
      const left = game.S.faults.filter(Boolean).length,
        rest = left ? `${left} still open.` : 'All clear.';
      hud.say(isMe(e.x.by) ? `Fixed. ${rest}` : `${guard(e.x.by)?.name || 'Someone'} fixed the ${ROOMS3[BOXES[e.x.i].room]?.name}. ${rest}`, 'fixed', 3);
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
      if (isMe(e.x.id)) hud.say(`${MASC[e.x.i].name} opened the locker.`, 'down', 4);
      else hud.say(`${MASC[e.x.i].name} pulled ${guard(e.x.id)?.name || 'someone'} out of a locker ${where(e.x)}.`, 'hide', 6);
    },
    fumble(e: EventOf<'fumble'>): void {
      if (isMe(e.x.by)) hud.say('Something is blocking the door.', 'info', 3);
    },
    grab(e: EventOf<'grab'>): void {
      if (isMe(e.x.by)) hud.say('Mini Biggs in hand.', 'toy', 2.5);
    },
  };

  // How scared this guard should be right now, 0 to 1: something hunting, close.
  function threat(): number {
    const S = game.S,
      me = player.me;
    let worst = 0;
    for (const m of S.m)
      if (['hunt', 'windup', 'charge', 'search'].includes(m.st))
        worst = Math.max(worst, (m.st === 'search' ? 0.5 : 1) * Math.max(0, 1 - Math.hypot(m.x - me.x, m.z - me.z) / 16));
    return worst;
  }

  return {
    show,
    tick(now: number): void {
      const S = game.S,
        dt = Math.min(0.1, (now - last) / 1000),
        t = now / 1000;
      last = now;
      show(true);
      post.fit(canvas, camera);
      const mine = S.players.find(p => p.id === game.myId);
      if (S.t < lastT && mine?.x != null) {
        player.reset(mine);
        actors.reset();
      } // a night began
      if (mine?.x != null) lastT = S.t;
      for (const e of S.evs)
        if (e.id > lastEv) {
          lastEv = e.id;
          SAY[e.type]?.(e);
          actors.event(e, S, player.me);
        }
      player.update(S, dt, now);
      spectate(S, dt);
      const dread = dreadF(S),
        fear = threat();
      (scene.fog as THREE.FogExp2).density = FOG + FOG_DREAD * dread;
      world.update(S, t, dt, camera, player.torch.intensity / TORCH_FULL, dread, fear);
      actors.sync(S, dt, player.me, player.torch); // also runs the catch, which takes the camera
      // The end card (ui.ts) waits until LINGER after the catch is over, however long a slow machine takes over it.
      if (actors.scare.active) client.holdUntil = Math.max(client.holdUntil, now + LINGER * 1000);
      phone.update(S, player.me, dt, now, actors.scare.active);
      slats.update(S, player.me, dt, actors.scare.active);
      sound.update(S, player.me, dt);
      hud.update(S, player.me, actors.scare.active);
      post.render(scene, camera, now, fear, dread, world.stop, outlines.pick(S, player.me, t));
      actors.after();
    },
    threat,
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

export function frame(now: number): ReturnType<typeof create> {
  (app ||= create()).tick(now);
  return app;
}
export function hide(): void {
  app?.show(false);
}
