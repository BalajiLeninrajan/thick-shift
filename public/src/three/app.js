// The 3D mode's renderer and frame. main.js imports this file the first time
// a night on the floor is drawn, so the booth game never downloads three.js.
import * as THREE from 'three';
import { MASC } from '../config.js';
import { game, client } from '../state.js';
import { buildWorld } from './world.js';
import { createPlayer } from './player.js';
import { createActors } from './actors.js';
import { createHud, where } from './hud.js';
import { EYE } from './map.js';
import { hourF } from './sim3d.js';
import { createSound } from './sound.js';
import { createPost } from './post.js';
import { createPhone } from './actors/phone.js';
import { dreadOf } from '../rules.js';

let app = null;
const FOG = .037, FOG_DREAD = .03;   // fog density on a quiet night, and what a bad one adds
const TORCH_FULL = 60;                // the torch's intensity on a full battery (player.js)

function create() {
  const stage = document.querySelector('.ts-stage'), flat2d = document.getElementById('c'), bar = document.getElementById('hud');
  const canvas = document.createElement('canvas'); canvas.id = 'c3'; stage.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030305);
  scene.fog = new THREE.FogExp2(0x030305, FOG);
  const camera = new THREE.PerspectiveCamera(72, 16 / 9, .06, 90);
  scene.add(camera);

  const world = buildWorld(scene), actors = createActors(scene, camera, renderer), player = createPlayer(camera, canvas), hud = createHud(stage, player), sound = createSound();
  // post.js draws the frame and owns its resolution and the torch's shadow map; the torch gets a cheap torch's beam pattern.
  const post = createPost(renderer, player.torch);
  player.torch.map = world.torchCookie();
  const phone = createPhone(camera);   // in the left hand, with the minimap on its screen
  let last = performance.now(), lastT = 1e9, lastEv = 0, shown = false, seat = null;

  function show(on) {
    if (on === shown) return;
    shown = on;
    canvas.hidden = !on; hud.root.hidden = !on; flat2d.hidden = on; bar.hidden = on;
    stage.classList.toggle('is-floor', on);   // the 3D picture has its own grain
    if (!on && document.pointerLockElement === canvas) document.exitPointerLock();
    if (!on) sound.quiet();
  }

  // A flat guard can watch through a standing teammate's eyes (player.me.watch
  // is their id). seat is that view, eased between the host's updates.
  function spectate(S, dt) {
    const p = S.players.find(q => q.id === player.me.watch);
    if (!p) { seat = null; return; }
    const k = seat ? Math.min(1, dt * 10) : 1;
    seat ||= { x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch };
    seat.x += (p.x - seat.x) * k; seat.z += (p.z - seat.z) * k; seat.pitch += (p.pitch - seat.pitch) * k;
    seat.yaw += Math.atan2(Math.sin(p.yaw - seat.yaw), Math.cos(p.yaw - seat.yaw)) * k;
    camera.position.set(seat.x, EYE, seat.z);
    camera.rotation.set(seat.pitch, seat.yaw + Math.PI, 0, 'YXZ');
  }

  // What each new event means on this screen, beyond its sound (sound.js plays
  // those). hud.say takes the line, its kind (which sets icon and colour) and seconds.
  const guard = id => game.S.players.find(p => p.id === id), isMe = id => id === game.myId;
  const SAY = {
    round(e) {
      hud.say(`${e.x} clocks are due before ${hourF(game.S) + 1} AM.`, 'clock', 5);
      hud.tip('round', 'The yellow marks on the compass lead to the clocks that are due. Hold {use} at each one.');
    },
    punch(e) {
      const left = game.S.clocks.filter(c => c === 1).length, rest = left ? `${left} to go.` : 'That is all of them this hour.';
      hud.say(isMe(e.x.by) ? `Punched. ${rest}` : `${guard(e.x.by)?.name || 'Someone'} punched one. ${rest}`, 'clock', 3);
    },
    miss: e => hud.say(`${e.x > 1 ? e.x + ' clocks were' : 'A clock was'} missed. The power takes the hit.`, 'missed', 6),
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
      const dread = dreadOf(S), fear = threat();
      scene.fog.density = FOG + FOG_DREAD * dread;
      world.update(S, t, dt, camera, player.torch.intensity / TORCH_FULL, dread, fear);
      actors.sync(S, dt, player.me, player.torch);   // also runs the catch, which takes the camera
      phone.update(S, player.me, dt, now, actors.scare.active);
      sound.update(S, player.me, dt);
      hud.update(S, player.me, actors.scare.active);
      post.render(scene, camera, now, fear, dread, world.stop);
      actors.after();
    },
    threat, player, actors, world, scene, camera, renderer, sound, post, phone,
  };
}

export function frame(now) { (app ||= create()).tick(now); return app; }
export function hide() { app?.show(false); }
