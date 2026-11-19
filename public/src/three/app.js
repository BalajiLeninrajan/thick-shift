// The renderer and the frame. main.js imports this file the first time a
// night is drawn, so the title screen and lobby never wait on three.js.
import * as THREE from 'three';
import { MASC } from '../config.js';
import { game, client } from '../state.js';
import { buildWorld } from './world.js';
import { createPlayer, prefs } from './player.js';
import { createActors } from './actors.js';
import { createHud, where } from './hud.js';
import { createTask, FAULT_NAME } from './task.js';
import { EYE, BOXES, ROOMS3, roomAt, reaches } from './map.js';
import { createSound } from './sound.js';
import { createPost } from './post.js';
import { createPhone } from './actors/phone.js';
import { createOutlines } from './outline.js';
import { dreadF } from './sim3d.js';

let app = null;
const FOG = .037, FOG_DREAD = .03;   // fog density on a quiet night, and what a bad one adds
const TORCH_FULL = 60;                // the torch's intensity on a full battery (player.js)

function create() {
  const stage = document.querySelector('.ts-stage');
  const canvas = document.createElement('canvas'); canvas.id = 'c3'; stage.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030305);
  scene.fog = new THREE.FogExp2(0x030305, FOG);
  const camera = new THREE.PerspectiveCamera(72, 16 / 9, .06, 90);
  scene.add(camera);

  const world = buildWorld(scene), actors = createActors(scene, camera, renderer), player = createPlayer(camera, canvas), hud = createHud(stage, player), sound = createSound();
  player.setTask(createTask(hud.root));
  const outlines = createOutlines(world.parts, actors);
  // post.js draws the frame and owns its resolution and the torch's shadow map; the torch gets a cheap torch's beam pattern.
  const post = createPost(renderer, player.torch);
  player.torch.map = world.torchCookie();
  const phone = createPhone(camera);   // in the left hand, with the minimap on its screen
  let last = performance.now(), lastT = 1e9, lastEv = 0, shown = false, seat = null;

  function show(on) {
    if (on === shown) return;
    shown = on;
    canvas.hidden = !on; hud.root.hidden = !on;
    stage.classList.toggle('is-live', on);   // the picture has its own grain (post.js)
    if (!on && document.pointerLockElement === canvas) document.exitPointerLock();
    if (!on) sound.quiet();
  }

  // A flat guard can watch a standing teammate (player.me.watch is their id): through their eyes, or with
  // prefs.third from behind and above them. seat is that view, eased between the host's updates.
  const LINGER = 1.5;   // seconds a caught guard lies looking up at what sat on them before the night's end card
  const BACK = 3, ABOVE = 2.2, AIM = 1.4;   // third person: metres behind, camera height, and the height looked at
  function spectate(S, dt) {
    const p = S.players.find(q => q.id === player.me.watch);
    if (!p) { seat = null; return; }
    const k = seat ? Math.min(1, dt * 10) : 1;
    seat ||= { x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch, back: BACK };
    seat.x += (p.x - seat.x) * k; seat.z += (p.z - seat.z) * k; seat.pitch += (p.pitch - seat.pitch) * k;
    seat.yaw += Math.atan2(Math.sin(p.yaw - seat.yaw), Math.cos(p.yaw - seat.yaw)) * k;
    if (!prefs.third) {
      camera.position.set(seat.x, EYE, seat.z);
      camera.rotation.set(seat.pitch, seat.yaw + Math.PI, 0, 'YXZ');
      return;
    }
    // Drawn in to stay this side of a wall or a shut door (furniture it looks over), quickly when one comes between
    // and slowly back out, and kept under the ceiling, which in the ducts is low.
    const fx = Math.sin(seat.yaw), fz = Math.cos(seat.yaw);
    let back = BACK;
    while (back > .5 && !reaches(seat.x, seat.z, seat.x - fx * (back + .3), seat.z - fz * (back + .3), S.doors)) back -= .25;
    seat.back += (back - seat.back) * Math.min(1, dt * (back < seat.back ? 20 : 3));
    const h = ROOMS3[roomAt(seat.x, seat.z)]?.h ?? 3;
    camera.position.set(seat.x - fx * seat.back, Math.min(ABOVE, h - .35), seat.z - fz * seat.back);
    camera.lookAt(seat.x, Math.min(AIM, h - .6), seat.z);
  }

  // What each new event means on this screen, beyond its sound (sound.js plays
  // those). hud.say takes the line, its kind (which sets icon and colour) and seconds.
  const guard = id => game.S.players.find(p => p.id === id), isMe = id => id === game.myId;
  const SAY = {
    // A fault broke out: where, and what it needs.
    fault(e) {
      const f = game.S.faults[e.x.i];
      if (!f) return;
      hud.say(`Fault in the ${ROOMS3[BOXES[e.x.i].room]?.name}: ${FAULT_NAME[f.k].toLowerCase()}.`, 'fault', 4);
      hud.tip('fault', 'Faults leak power until they are fixed, and darken their room. The list under the power, and the yellow marks on the compass, lead to them. Press {use} at the box.');
    },
    fix(e) {
      const left = game.S.faults.filter(Boolean).length, rest = left ? `${left} still open.` : 'All clear.';
      hud.say(isMe(e.x.by) ? `Fixed. ${rest}` : `${guard(e.x.by)?.name || 'Someone'} fixed the ${ROOMS3[BOXES[e.x.i].room]?.name}. ${rest}`, 'fixed', 3);
    },
    burn: () => hud.say('A fault is burning out the wiring. Fix it before the building cannot hold a charge.', 'burnt', 6),
    out: () => hud.say('The power is out. Every door is open.', 'out', 7),
    on: () => hud.say('The power is back.', 'back', 3),
    flat(e) {
      const who = guard(e.x.id);
      if (!isMe(e.x.id) && who) { hud.say(`${MASC[e.x.by].name} flattened ${who.name} ${where(e.x)}.`, 'down', 6); hud.tip('peel', 'A flat guard stays flat until someone stands over them and holds {use}.'); }
    },
    peel(e) {
      if (isMe(e.x.id)) hud.say('Peeled up. They will not notice you for a few seconds. Go.', 'up', 4);
      else hud.say(`${isMe(e.x.by) ? 'You' : guard(e.x.by)?.name || 'Someone'} peeled ${guard(e.x.id)?.name || 'someone'} up.`, 'up', 3);
    },
    // A flat guard calling out. sound.js plays its two notes from where the guard lies.
    call(e) {
      hud.ping(e.x.id);
      if (!isMe(e.x.id)) hud.say(`${guard(e.x.id)?.name || 'Someone'} is calling from the floor ${where(e.x)}.`, 'call', 4);
    },
    spot(e) { if (isMe(e.x.id)) hud.tip('spot', 'It has seen you. Keep the torch on it and back away. The beam holds it while the battery lasts.'); },
    bat(e) { if (isMe(e.x.by)) hud.say('Fresh battery.', 'torch', 2.5); },
    locker(e) { if (isMe(e.x.id) && e.x.in) hud.tip('hide', 'Nothing sees you in here. One that saw you get in will open the door. One that lost you nearby may check, and one that stands outside long enough will sniff you out. The doors are loud.'); },
    found(e) {
      if (isMe(e.x.id)) hud.say(`${MASC[e.x.i].name} opened the locker.`, 'down', 4);
      else hud.say(`${MASC[e.x.i].name} pulled ${guard(e.x.id)?.name || 'someone'} out of a locker ${where(e.x)}.`, 'hide', 6);
    },
    fumble(e) { if (isMe(e.x.by)) hud.say('The door will not shut. Something is standing in it.', 'info', 3); },
  };

  // How scared this guard should be right now, 0 to 1: something hunting, close.
  function threat() {
    const S = game.S, me = player.me;
    let worst = 0;
    for (const m of S.m) if (['hunt', 'windup', 'charge', 'search'].includes(m.st)) worst = Math.max(worst, (m.st === 'search' ? .5 : 1) * Math.max(0, 1 - Math.hypot(m.x - me.x, m.z - me.z) / 16));
    return worst;
  }

  return {
    show,
    tick(now) {
      const S = game.S, dt = Math.min(.1, (now - last) / 1000), t = now / 1000;
      last = now;
      show(true); post.fit(canvas, camera);
      const mine = S.players.find(p => p.id === game.myId);
      if (S.t < lastT && mine?.x != null) { player.reset(mine); actors.reset(); }   // a night began
      if (mine?.x != null) lastT = S.t;
      for (const e of S.evs) if (e.id > lastEv) { lastEv = e.id; SAY[e.type]?.(e); actors.event(e, S, player.me); }
      player.update(S, dt, now);
      spectate(S, dt);
      const dread = dreadF(S), fear = threat();
      scene.fog.density = FOG + FOG_DREAD * dread;
      world.update(S, t, dt, camera, player.torch.intensity / TORCH_FULL, dread, fear);
      actors.sync(S, dt, player.me, player.torch);   // also runs the catch, which takes the camera
      // The end card (ui.js) waits until LINGER after the catch is over, however long a slow machine takes over it.
      if (actors.scare.active) client.holdUntil = Math.max(client.holdUntil, now + LINGER * 1000);
      phone.update(S, player.me, dt, now, actors.scare.active);
      sound.update(S, player.me, dt);
      hud.update(S, player.me, actors.scare.active);
      post.render(scene, camera, now, fear, dread, world.stop, outlines.pick(S, player.me, t));
      actors.after();
    },
    threat, player, actors, world, scene, camera, renderer, sound, post, phone,
  };
}

export function frame(now) { (app ||= create()).tick(now); return app; }
export function hide() { app?.show(false); }
