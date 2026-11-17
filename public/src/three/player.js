// This guard: walking, looking, the torch, and using things. The browser
// owns its own position and tells the host about twelve times a second
// (a 'p' action); everything else about the guard comes back in S.
// Keyboard, mouse and gamepad are read here. Touch is in touch.js, which
// drives the same guard through pad, look() and toggleTorch().
import * as THREE from 'three';
import { game } from '../state.js';
import { send } from '../net.js';
import { unlockAudio } from '../audio.js';
import { PLAYER_R, EYE, CLOCKS, GENERATOR, CHARGER, PANELS, BATTERY_SPOTS, slide, walkable } from './map.js';
import { F } from './sim3d.js';

const SENS = .0022, SEND_MS = 80;   // radians per pixel of mouse travel at sensitivity 1
const PITCH_MAX = 1.45;
// A standard-mapping gamepad: left stick walks, right stick looks.
const GP = { use: 0, torch: 2, call: 3, sprint: 4, watch: 5, pause: 9, dead: .18, look: 2.8 };   // look: radians per second at full tilt

// Look settings, kept between visits. sens multiplies SENS.
export const prefs = { sens: 1, invert: false };
try { const saved = JSON.parse(localStorage.tsFloor || '{}'); if (saved.sens > 0) prefs.sens = Math.min(2.5, Math.max(.3, +saved.sens)); prefs.invert = !!saved.invert; } catch (e) { /* storage blocked */ }
export function savePrefs() { try { localStorage.tsFloor = JSON.stringify(prefs); } catch (e) { /* storage blocked */ } }
const typing = e => !!e.target.closest?.('input, textarea, select, [contenteditable]');
const STAMINA = { drain: 1 / 4.5, gain: 1 / 7, rest: 1 };   // per second, and seconds before it starts coming back
const DOOR_NAME = { L: 'left door', R: 'right door', V: 'vent' };

export function createPlayer(camera, canvas) {
  // Local view of this guard. yaw 0 faces south (+z); forward is (sin yaw, cos yaw).
  const me = { x: 0, z: 0, yaw: Math.PI, pitch: 0, on: false, stam: 1, sp: false, act: '', bob: 0, target: null, hold: 0, moving: 0, locked: false, flat: false,
    paused: false,   // the pause panel is up: nothing here moves the guard
    touch: false,    // a finger is driving (set by touch.js), so there is no pointer to lock
    watch: null };   // id of the teammate a flat guard is watching through, or null
  const keys = new Set();
  // Touch and gamepad code can drive the guard through these instead of keys.
  const pad = { fwd: 0, strafe: 0, sprint: false, use: false };
  const gp = { fwd: 0, strafe: 0, sprint: false, use: false };
  let sinceSprint = 0, lastSend = 0, usedTap = false, lastCall = -1e9;
  let mouseLocked = false, gpLive = false, gpWas = [];

  const torch = new THREE.SpotLight(0xfff0d0, 0, 26, .5, .55, 1.5);
  torch.position.set(.22, -.18, 0); torch.target.position.set(.05, -.05, -3);
  torch.castShadow = true; torch.shadow.mapSize.set(1024, 1024); torch.shadow.camera.near = .2; torch.shadow.camera.far = 26; torch.shadow.bias = -.002;
  camera.add(torch, torch.target);

  const playing = () => game.S?.phase === 'play';
  function toggleTorch() { if (playing() && !me.flat) { me.on = !me.on; unlockAudio(); } }

  // Turn the view by a mouse's worth of pixels.
  function look(dx, dy) {
    if (me.paused) return;
    const k = SENS * prefs.sens;
    me.yaw -= dx * k;
    me.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, me.pitch - dy * k * (prefs.invert ? -1 : 1)));
  }
  // Chrome refuses to lock again for a second after Esc. Then the click-to-play state is what shows.
  function resume() { me.paused = false; if (!me.touch && !mouseLocked) canvas.requestPointerLock?.()?.catch?.(() => {}); }
  function pause() { me.paused = true; keys.clear(); if (mouseLocked) document.exitPointerLock(); }
  // A flat guard shouts. The host rate-limits it too.
  function call() {
    if (!playing() || !me.flat || performance.now() - lastCall < F.CALL_GAP * 1000) return;
    lastCall = performance.now();
    send({ t: 'call' });
  }
  // A flat guard steps through the standing teammates' views, then back to their own.
  function watchNext() {
    if (!playing() || !me.flat) return;
    const ids = game.S.players.filter(p => !p.flat && p.id !== game.myId && p.x != null).map(p => p.id);
    me.watch = ids[ids.indexOf(me.watch) + 1] ?? null;
  }

  addEventListener('keydown', e => {
    if (typing(e) || !playing() || game.S.mode !== 'floor' || me.paused) return;
    if (!e.repeat) ({ KeyF: toggleTorch, KeyQ: call, Space: watchNext })[e.code]?.();
    if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  canvas.addEventListener('click', () => {
    unlockAudio();
    if (!mouseLocked) resume(); else toggleTorch();
  });
  document.addEventListener('pointerlockchange', () => {
    const was = mouseLocked;
    mouseLocked = document.pointerLockElement === canvas;
    if (mouseLocked) gpLive = false;
    // Esc, or the browser, took the mouse away in the middle of a night: that is a pause.
    if (was && !mouseLocked) { keys.clear(); if (playing()) me.paused = true; }
  });
  addEventListener('mousemove', e => { if (mouseLocked) look(e.movementX, e.movementY); });

  function pollPad(dt) {
    const g = [...(navigator.getGamepads?.() || [])].find(g => g?.connected && g.mapping === 'standard');
    Object.assign(gp, { fwd: 0, strafe: 0, sprint: false, use: false });
    if (!g) return;
    const axis = i => Math.abs(g.axes[i]) > GP.dead ? g.axes[i] : 0, down = i => !!g.buttons[i]?.pressed, hit = i => down(i) && !gpWas[i];
    if (hit(GP.pause)) { if (me.paused || !me.locked) { gpLive = true; me.paused = false; } else pause(); }
    else if (!me.paused && g.buttons.some((b, i) => b.pressed && !gpWas[i])) gpLive = true;   // any button takes over from the mouse
    if (gpLive && !me.paused) {
      Object.assign(gp, { fwd: -axis(1), strafe: axis(0), sprint: down(GP.sprint), use: down(GP.use) });
      look(axis(2) * GP.look * dt / SENS, axis(3) * GP.look * dt / SENS);
      if (hit(GP.torch)) toggleTorch();
      if (hit(GP.call)) call();
      if (hit(GP.watch)) watchNext();
    }
    gpWas = g.buttons.map(b => b.pressed);
  }

  // The nearest thing in reach and roughly in front. { what, label, hold, ... }
  // hold: seconds to hold the use key, 0 for a tap, -1 for as long as you hold it.
  function findTarget(S, mine) {
    const list = [];
    S.clocks?.forEach((c, i) => { if (c === 1) list.push({ what: 'clock', i, at: CLOCKS[i], label: 'Punch the clock', hold: F.PUNCH_HOLD }); });
    if (S.power > 0) for (const k in PANELS) list.push({ what: 'door', k, at: PANELS[k], label: `${S.doors[k] ? 'Open' : 'Shut'} the ${DOOR_NAME[k]}`, hold: 0 });
    if (mine.bat < 1) for (const i of S.bats || []) list.push({ what: 'bat', i, at: BATTERY_SPOTS[i], label: 'Take the battery', hold: 0 });
    for (const p of S.players) if (p.flat && p.id !== game.myId) list.push({ what: 'peel', id: p.id, at: p, label: `Peel ${p.name} off the floor`, hold: F.PEEL_HOLD });
    list.push({ what: 'crank', at: GENERATOR, label: S.power >= 100 ? 'The generator is full' : 'Crank the generator', hold: S.power >= 100 ? 0 : -1 });
    if (S.power > 0 && mine.bat < 1) list.push({ what: 'charge', at: CHARGER, label: 'Charge the torch', hold: -1 });
    let best = null, bd = F.REACH - .2;
    for (const t of list) {
      const dx = t.at.x - me.x, dz = t.at.z - me.z, d = Math.hypot(dx, dz);
      if (d < bd && (d < .9 || (dx * Math.sin(me.yaw) + dz * Math.cos(me.yaw)) / d > .45)) { bd = d; best = t; }
    }
    return best;
  }

  function use(S, dt) {
    const t = me.target, held = keys.has('KeyE') || pad.use || gp.use;
    me.act = '';
    if (!held) usedTap = false;
    if (!t || !held) { me.hold = 0; return; }
    if (t.hold < 0) { me.act = t.what; return; }
    if (usedTap) return;
    me.hold += dt;
    if (me.hold >= t.hold) { send({ t: 'use', what: t.what, i: t.i, k: t.k, id: t.id }); me.hold = 0; usedTap = true; }
  }

  function walk(S, dt) {
    const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + pad.fwd + gp.fwd;
    const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + pad.strafe + gp.strafe;
    const len = Math.hypot(f, s);
    const wantSprint = (keys.has('ShiftLeft') || keys.has('ShiftRight') || pad.sprint || gp.sprint) && f > 0 && me.act === '';
    me.sp = wantSprint && me.stam > 0 && len > 0;
    if (me.sp) { me.stam = Math.max(0, me.stam - STAMINA.drain * dt); sinceSprint = 0; }
    else { sinceSprint += dt; if (sinceSprint > STAMINA.rest) me.stam = Math.min(1, me.stam + STAMINA.gain * dt); }
    me.moving = 0;
    if (!len || me.act === 'crank') return;
    const speed = (me.sp ? F.SPRINT : F.WALK) * Math.min(1, len) * dt / len;
    const sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
    // right of forward (sin, cos) is (-cos, sin)
    me.moving = slide(me, (f * sin - s * cos) * speed, (f * cos + s * sin) * speed, PLAYER_R, S.doors);
    me.bob += dt * (me.sp ? 13 : 8.5) * me.moving;
  }

  return {
    me, pad, torch, toggleTorch, look, pause, resume, call, watchNext,
    // Put the guard where the host says they are: the start of a night, or after joining.
    reset(mine) { Object.assign(me, { x: mine.x, z: mine.z, yaw: mine.yaw ?? Math.PI, pitch: 0, on: false, stam: 1, bob: 0, hold: 0, paused: false, watch: null }); },
    update(S, dt, now) {
      const mine = S.players.find(p => p.id === game.myId);
      if (!mine || mine.x == null) return;
      me.flat = !!mine.flat;
      pollPad(dt);
      // The screens between nights need the mouse back.
      if (S.phase !== 'play') { me.paused = false; if (mouseLocked) document.exitPointerLock(); }
      me.locked = (mouseLocked || me.touch || gpLive) && !me.paused;
      if (!S.players.some(p => p.id === me.watch && !p.flat) || !me.flat) me.watch = null;
      if (S.phase === 'play') {
        if (me.flat || me.paused) { me.act = ''; me.target = null; me.sp = false; me.hold = 0; me.moving = 0; if (me.flat) me.on = false; }
        else {
          // A door shut on top of us, or the host put us somewhere else.
          if (!walkable(me.x, me.z, PLAYER_R * .5, S.doors)) { me.x = mine.x; me.z = mine.z; }
          me.target = findTarget(S, mine);
          use(S, dt); walk(S, dt);
          if (mine.bat <= 0) me.on = false;
        }
        if (now - lastSend > SEND_MS) { lastSend = now; send({ t: 'p', x: me.x, z: me.z, yaw: me.yaw, pitch: me.pitch, on: me.on, sp: me.sp, act: me.act }); }
      }
      // Low battery: the beam dims and stutters.
      const bat = mine.bat ?? 1, weak = bat < .15 ? (Math.sin(now * .05) > -.2 ? .5 : .1) : 1;
      torch.intensity = me.on && bat > 0 ? 60 * weak * (.55 + .45 * Math.min(1, bat * 3)) : 0;
      const y = me.flat ? .22 : EYE + Math.sin(me.bob) * .045;
      camera.position.set(me.x, y, me.z);
      camera.rotation.set(me.flat ? Math.max(.3, me.pitch) : me.pitch, me.yaw + Math.PI, 0, 'YXZ');
    },
  };
}
