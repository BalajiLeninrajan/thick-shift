// This guard: walking, looking, the torch, and using things. The browser
// owns its own position and tells the room about twelve times a second
// (a 'p' action); everything else about the guard comes back in S.
// Keyboard (WASD to walk, and arrow keys to look for anyone without a mouse), mouse and gamepad are read here. Touch is in touch.ts, which
// drives the same guard through pad, look(), toggleTorch(), togglePhone(), toggleZoom() and throwToy().

import { F, TOY } from '@thick-shift/sim';
import { assert, defined, isNight, isPlaced } from '@thick-shift/sim/check';
import { DOORS, STAMINA } from '@thick-shift/sim/config';
import { angDiff, BATTERY_SPOTS, BOXES, CHARGER, dist, EYE, GENERATOR, HIDES, PANELS, PLAYER_R, slide, TOY_BOX, walkable } from '@thick-shift/sim/map';
import type { DoorKey, Guard, NightState, Player, State } from '@thick-shift/sim/types';
import * as THREE from 'three';
import { unlockAudio } from '../audio';
import { typing } from '../dom';
import { send } from '../net';
import { currentState, FLAT_EYE, game, myPlayer } from '../state';
import type { Me, Prefs, Target, Task } from '../types';
import { faultName } from './task';

// What drives the guard besides the keys: touch.ts (pad) and the gamepad (gp, which also keeps the stick's last
// direction for a breaker box). fwd and strafe: -1 to 1.
interface Pad {
  fwd: number;
  strafe: number;
  sprint: boolean;
  use: boolean;
  stick?: [number, number];
}

const SENS = 0.0022,
  SEND_MS = 80; // radians per pixel of mouse travel at sensitivity 1
const PITCH_MAX = 1.45;
// The arrow keys look: radians per second at sensitivity 1, reached after ARROW_RAMP seconds of holding (a tap nudges).
const ARROW = { turn: 2.2, tilt: 1.4 },
  ARROW_RAMP = 0.35;
const GAME_KEYS = /^(Key[WASDEFQCRG]|Arrow|Shift|Space)/;
// A standard-mapping gamepad: left stick walks, right stick looks.
const GP = { use: 0, phone: 1, torch: 2, call: 3, sprint: 4, watch: 5, toss: 7, pause: 9, zoom: 12, dead: 0.18, look: 2.8 }; // look: radians per second at full tilt
// The d-pad at a breaker box: its buttons (left, right, up, down), and the [dx, dy] each chooses by.
const DPAD: [button: number, dir: [number, number]][] = [
  [14, [-1, 0]],
  [15, [1, 0]],
  [12, [0, -1]],
  [13, [0, 1]],
];
export const TORCH_FULL = 60; // the torch's intensity on a full battery

// Look settings, kept between visits. sens multiplies SENS. outline: a gold edge round usable things (outline.ts).
// third: a flat guard watches teammates from behind them, not through their eyes (app.ts spectate).
export const prefs: Prefs = { sens: 1, invert: false, outline: true, third: false };
try {
  // Whatever an earlier visit saved, read field by field.
  const saved = JSON.parse(localStorage.getItem('tsFloor') || '{}') as Partial<Prefs>;
  // Number(undefined) is NaN, and NaN > 0 is false, so a missing sens keeps the default.
  const sens = Number(saved.sens);
  if (sens > 0) prefs.sens = Math.min(2.5, Math.max(0.3, sens));
  prefs.invert = !!saved.invert;
  if (saved.outline === false) prefs.outline = false;
  prefs.third = !!saved.third;
} catch {
  /* storage blocked */
}
export function savePrefs(): void {
  try {
    localStorage.setItem('tsFloor', JSON.stringify(prefs));
  } catch {
    /* storage blocked */
  }
}
const DOOR_NAME: Record<DoorKey, string> = { L: 'left door', R: 'right door', V: 'vent' };
// In a locker: how far the view turns either side of straight out through the doors, and up or down (radians),
// and how far in front of the locker's middle the eye is: just past the doors, so their insides are behind it.
const LOCKER_LOOK = { yaw: 0.85, pitch: 0.5, eye: 0.34 };
const THROW_MS = 1000; // a second throw is not sent before the room has had time to take the first

// task: the minigame panel (task.ts).
export function createPlayer(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement, task: Task) {
  // Local view of this guard. yaw 0 faces south (+z); forward is (sin yaw, cos yaw).
  const me: Me = {
    x: 0,
    z: 0,
    yaw: Math.PI,
    pitch: 0,
    on: false,
    stam: 1,
    sp: false,
    act: '',
    bob: 0,
    target: null,
    hold: 0,
    moving: 0,
    locked: false,
    flat: false,
    paused: false,
    touch: false,
    pad: false,
    watch: null,
    ph: false,
    task: null,
    zoom: true, // the phone starts on the whole building
    threw: 0,
    dry: 0,
    empty: 0,
    hid: -1,
  };
  const keys = new Set<string>();
  // Keys a breaker box took, each until it comes up. Their repeats never reach keys, even once the box has shut.
  const boxKeys = new Set<string>();
  // Touch and gamepad code can drive the guard through these instead of keys.
  const pad: Pad = { fwd: 0, strafe: 0, sprint: false, use: false };
  const gp: Pad = { fwd: 0, strafe: 0, sprint: false, use: false };
  let lastThrow = -1e9,
    sinceSprint = 0,
    lastSend = 0,
    usedTap = false,
    lastCall = -1e9,
    drop = 0;
  // me.pad goes up with gpLive and comes down sooner: a game key clears it as well as a locked pointer. gpLive has to
  // outlast a key press, because it is what lets the sticks through and only a button sets it again.
  let mouseLocked = false,
    gpLive = false,
    gpWas: boolean[] = [];
  let keysLive = false,
    arrowHeld = 0; // keysLive: playing on the keyboard alone, so there is no pointer to lock
  function letGo(): void {
    if (me.task) {
      me.task = null;
      task.close();
    }
  }
  // Not running: after STAMINA.rest seconds the breath comes back.
  function rest(dt: number): void {
    sinceSprint += dt;
    if (sinceSprint > STAMINA.rest) me.stam = Math.min(1, me.stam + STAMINA.gain * dt);
  }

  const torch = new THREE.SpotLight(0xfff0d0, 0, 26, 0.5, 0.55, 1.5);
  torch.position.set(0.22, -0.18, 0);
  torch.target.position.set(0.05, -0.05, -3);
  torch.castShadow = true;
  torch.shadow.mapSize.set(1024, 1024);
  torch.shadow.camera.near = 0.2;
  torch.shadow.camera.far = 26;
  torch.shadow.bias = -0.002;
  camera.add(torch, torch.target);

  const playing = (): boolean => game.S?.phase === 'play';
  function toggleTorch(): void {
    if (playing() && !me.flat && me.hid < 0) {
      me.on = !me.on;
      unlockAudio();
    }
  }
  // The phone runs on the torch's battery, so a dead battery will not raise it.
  const charged = (): boolean => (myPlayer(currentState())?.bat ?? 1) > 0; // only after playing()
  function togglePhone(): void {
    if (playing() && !me.flat && !me.paused && (me.ph || charged())) me.ph = !me.ph;
  }
  // The minimap between what is round the guard and the whole building. Only with the phone up.
  function toggleZoom(): void {
    if (me.ph) me.zoom = !me.zoom;
  }
  // The guard's Mini Biggs, thrown where they are looking: as far as the floor the view meets, or as far as one goes
  // when looking level or up. It sings on a bar of the torch's battery, so it needs that much, and it has to be picked
  // up again before the next throw. The room works out where it comes down (landing in sim.ts) and takes the
  // battery. Not from a locker, and not with both hands in a breaker box.
  function throwToy(): void {
    if (!playing() || me.flat || me.paused || me.hid >= 0 || me.task) return;
    const now = performance.now(),
      mine = myPlayer(currentState()); // playing() checked game.S
    if (!mine?.toy) {
      me.empty = now;
      return;
    }
    assert(isPlaced(mine), 'a guard holding a Mini Biggs has no place on the floor');
    if (mine.bat < TOY.cost) {
      me.dry = now;
      return;
    }
    if (now - lastThrow < THROW_MS) return; // the room has not said it has gone yet
    lastThrow = me.threw = now;
    const d = me.pitch < -0.05 ? Math.min(TOY.range, (EYE - 0.2) / Math.tan(-me.pitch)) : TOY.range;
    send({ t: 'throw', yaw: me.yaw, d });
  }

  // Turn the view right and down by this many radians at sensitivity 1.
  function turn(right: number, down: number): void {
    if (me.paused) return;
    me.yaw -= right * prefs.sens;
    me.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, me.pitch - down * prefs.sens * (prefs.invert ? -1 : 1)));
  }
  // The same by a mouse's worth of pixels.
  const look = (dx: number, dy: number): void => turn(dx * SENS, dy * SENS);
  // Chrome refuses to lock again for a second after Esc. Then the click-to-play state is what shows.
  function resume(): void {
    me.paused = false;
    if (!me.touch && !mouseLocked) canvas.requestPointerLock?.()?.catch?.(() => {});
  }
  function pause(): void {
    me.paused = true;
    keys.clear();
    if (mouseLocked) document.exitPointerLock();
  }
  // A flat guard shouts. The room rate-limits it too.
  function call(): void {
    if (!playing() || !me.flat || performance.now() - lastCall < F.CALL_GAP * 1000) return;
    lastCall = performance.now();
    send({ t: 'call' });
  }
  // A flat guard steps through the standing teammates' views, then back to their own.
  function watchNext(): void {
    if (!playing() || !me.flat) return;
    const ids = currentState()
      .players.filter(p => !p.flat && p.id !== game.myId && isPlaced(p))
      .map(p => p.id);
    // Watching nobody starts at the first teammate, and after the last comes their own view again.
    const at = me.watch === null ? -1 : ids.indexOf(me.watch);
    me.watch = ids[at + 1] ?? null;
  }

  // Keys that do one thing when pressed, by KeyboardEvent.code.
  const PRESS: Record<string, () => void> = { KeyF: toggleTorch, KeyQ: call, Space: watchNext, KeyC: togglePhone, KeyR: toggleZoom, KeyG: throwToy };
  addEventListener('keydown', e => {
    if (typing(e) || !playing()) return;
    // Without a locked pointer the browser does not turn Esc into a pause, so do it here; Enter comes back.
    if (me.paused) {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        keysLive = true;
        me.pad = false;
        resume();
      }
      return;
    }
    // Hands in a box: the box gets first go at the key, and what it takes goes no further. So W A S D choose and do
    // not walk, Space is not a flat guard's key, and Esc or X lets go of the box and does not pause. With the pointer
    // locked Esc is the browser's: it gives the mouse back, and pointerlockchange lets go of the box.
    // The box keeps a key it took until the key comes up. Otherwise the repeats of a held W would walk the guard off
    // when the box shut, and those of E would open the box again before the room had cleared the fault.
    const taken = boxKeys.has(e.code);
    if (taken || (me.task && !(e.code === 'Escape' && mouseLocked) && task.key(e.code, e.repeat))) {
      boxKeys.add(e.code);
      e.preventDefault();
      me.pad = false;
      return;
    }
    if (e.code === 'Escape' && !mouseLocked) {
      pause();
      return;
    }
    if (GAME_KEYS.test(e.code)) {
      keysLive = true;
      me.pad = false;
    }
    if (!e.repeat) PRESS[e.code]?.();
    if (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault();
    keys.add(e.code);
  });
  addEventListener('keyup', e => {
    if (me.task) task.keyUp(e.code); // the valve is held open only as long as its key
    boxKeys.delete(e.code);
    keys.delete(e.code);
  });
  // No keyup arrives for a key let go while the window is away.
  addEventListener('blur', () => {
    keys.clear();
    boxKeys.clear();
  });
  canvas.addEventListener('click', () => {
    unlockAudio();
    if (!mouseLocked) resume();
    else toggleTorch();
  });
  // The right button throws a Mini Biggs, and must not open the browser's menu.
  canvas.addEventListener('mousedown', e => {
    if (e.button === 2 && mouseLocked) throwToy();
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    const was = mouseLocked;
    mouseLocked = document.pointerLockElement === canvas;
    if (mouseLocked) gpLive = me.pad = false;
    // Esc, or the browser, took the mouse away in the middle of a night: that is a pause.
    // Esc with hands in a box lets go of the box, not the night.
    if (was && !mouseLocked) {
      keys.clear();
      if (me.task) letGo();
      else if (playing()) me.paused = true;
    }
  });
  addEventListener('mousemove', e => {
    if (mouseLocked) look(e.movementX, e.movementY);
  });

  // Arrow keys: left and right turn, up and down look up and down, easing in so a tap is a small nudge.
  function arrowLook(dt: number): void {
    const right = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0),
      down = (keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0);
    if (!right && !down) {
      arrowHeld = 0;
      return;
    }
    arrowHeld += dt;
    const k = Math.min(1, 0.3 + (0.7 * arrowHeld) / ARROW_RAMP) * dt;
    turn(right * ARROW.turn * k, down * ARROW.tilt * k);
  }

  function pollPad(dt: number): void {
    const g = [...(navigator.getGamepads?.() || [])].find(g => g?.connected && g.mapping === 'standard');
    Object.assign(gp, { fwd: 0, strafe: 0, sprint: false, use: false });
    if (!g) return;
    // The standard mapping has four axes, and axis() is only asked for 0 to 3. One that is not there is centred.
    const axis = (i: number): number => {
        const v = g.axes[i] ?? 0;
        return Math.abs(v) > GP.dead ? v : 0;
      },
      down = (i: number): boolean => !!g.buttons[i]?.pressed,
      hit = (i: number): boolean => down(i) && !gpWas[i];
    if (hit(GP.pause)) {
      if (me.paused || !me.locked) {
        gpLive = me.pad = true;
        me.paused = false;
      } else pause();
    } else if (!me.paused && g.buttons.some((b, i) => b.pressed && !gpWas[i])) gpLive = me.pad = true; // any button takes over from the mouse
    if (gpLive && !me.paused && me.task) {
      // Hands in a box: the stick and d-pad choose, A works it, B lets go.
      const sx = axis(0),
        sy = axis(1),
        was = gp.stick || [0, 0];
      const stick: [number, number] = [Math.abs(sx) > 0.6 ? Math.sign(sx) : 0, Math.abs(sy) > 0.6 ? Math.sign(sy) : 0];
      const flick: [number, number] | null = stick[0] !== was[0] && stick[0] ? [stick[0], 0] : stick[1] !== was[1] && stick[1] ? [0, stick[1]] : null;
      gp.stick = stick;
      turn(axis(2) * GP.look * dt, axis(3) * GP.look * dt);
      task.pad(DPAD.find(([b]) => hit(b))?.[1] ?? flick, down(GP.use), !!gpWas[GP.use], hit(GP.phone));
    } else if (gpLive && !me.paused) {
      Object.assign(gp, { fwd: -axis(1), strafe: axis(0), sprint: down(GP.sprint), use: down(GP.use) });
      turn(axis(2) * GP.look * dt, axis(3) * GP.look * dt);
      if (hit(GP.torch)) toggleTorch();
      if (hit(GP.call)) call();
      if (hit(GP.watch)) watchNext();
      if (hit(GP.phone)) togglePhone();
      if (hit(GP.zoom)) toggleZoom();
      if (hit(GP.toss)) throwToy();
    }
    gpWas = g.buttons.map(b => b.pressed);
  }

  // The nearest thing in reach and roughly in front. { what, label, hold, ... }
  // hold: seconds to hold the use key, 0 for a tap, -1 for as long as you hold it.
  function findTarget(S: NightState, mine: Guard): Target | null {
    // In a locker the one thing in reach is the way out.
    if (mine.hid >= 0) return { what: 'hide', i: mine.hid, at: defined(HIDES[mine.hid], `locker ${mine.hid}`).at, label: 'Step out of the locker', hold: 0 };
    const list: Target[] = [];
    // S.faults has one entry per box.
    for (const [i, at] of BOXES.entries()) {
      const f = S.faults[i];
      if (f) list.push({ what: 'fix', i, at, label: faultName(f.k), hold: 0 });
    }
    if (S.power > 0)
      for (const k of DOORS) list.push({ what: 'door', k, at: PANELS[k], label: `${S.doors[k] ? 'Open' : 'Shut'} the ${DOOR_NAME[k]}`, hold: 0 });
    // S.bats holds BATTERY_SPOTS indices.
    if (mine.bat < 1)
      for (const i of S.bats) list.push({ what: 'bat', i, at: defined(BATTERY_SPOTS[i], `battery spot ${i}`), label: 'Take the battery', hold: 0 });
    for (const p of S.players)
      if (p.flat && p.id !== game.myId) list.push({ what: 'peel', id: p.id, at: p, label: `Peel ${p.name} off the floor`, hold: F.PEEL_HOLD });
    list.push({ what: 'crank', at: GENERATOR, label: S.power >= 100 ? 'The generator is full' : 'Crank the generator', hold: S.power >= 100 ? 0 : -1 });
    if (S.power > 0 && mine.bat < 1) list.push({ what: 'charge', at: CHARGER, label: 'Charge the torch', hold: -1 });
    // Any Mini Biggs on the floor, into empty hands.
    if (!mine.toy) for (const t of S.toys) if (S.t >= t.land) list.push({ what: 'toy', id: t.id, at: t, label: 'Pick up the Mini Biggs', hold: 0 });
    // The booth's carton, while it has any left.
    if (!mine.toy && S.toyBox > 0) list.push({ what: 'carton', at: TOY_BOX, label: `Take a Mini Biggs from the box (${S.toyBox} left)`, hold: 0 });
    HIDES.forEach((h, i) => {
      if (!S.players.some(p => p.hid === i)) list.push({ what: 'hide', i, at: h.at, label: 'Hide in the locker', hold: F.HIDE_HOLD });
    });
    let best: Target | null = null,
      bd = F.REACH - 0.2;
    for (const t of list) {
      const dx = t.at.x - me.x,
        dz = t.at.z - me.z,
        d = Math.hypot(dx, dz);
      if (d < bd && (d < 0.9 || (dx * Math.sin(me.yaw) + dz * Math.cos(me.yaw)) / d > 0.45)) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  function use(S: NightState, dt: number): void {
    const t = me.target,
      held = keys.has('KeyE') || pad.use || gp.use;
    me.act = '';
    if (me.task) {
      // Hands in the box until the job is done or let go. Fixed by someone else, or out of reach: let go.
      const f = S.faults[me.task.i],
        box = defined(BOXES[me.task.i], `box ${me.task.i}`);
      if (!f || f.at !== me.task.at || dist(box, me) > F.REACH) letGo();
      else {
        me.act = 'fix';
        return;
      }
    }
    if (!held) usedTap = false;
    if (t?.what === 'fix' && held && !usedTap) {
      // A fault is a minigame, not a hold: open the panel.
      usedTap = true;
      me.hold = 0;
      // findTarget built t this frame (with hands in a box it is stale, but then usedTap is still set from opening
      // the box and this branch is skipped), and it makes a fix target only from an open fault in S.faults.
      const f = defined(S.faults[t.i], `fault ${t.i}`);
      me.task = { i: t.i, at: f.at };
      task.open(
        t.i,
        f.k,
        () => {
          send({ t: 'use', what: 'fix', i: t.i });
          me.task = null;
        },
        () => {
          me.task = null;
        }
      );
      me.act = 'fix';
      return;
    }
    if (!t || !held) {
      me.hold = 0;
      return;
    }
    // Held for as long as the key is down: the crank and the charger, the only targets with hold -1.
    if (t.hold < 0) {
      if (t.what === 'crank' || t.what === 'charge') me.act = t.what;
      return;
    }
    if (usedTap) return;
    me.hold += dt;
    if (me.hold >= t.hold) {
      // A full generator is a tap target that does nothing, so it sends nothing.
      if (t.what !== 'crank' && t.what !== 'charge') send({ t: 'use', what: t.what, i: t.i, k: t.k, id: t.id });
      me.hold = 0;
      usedTap = true;
    }
  }

  function walk(S: State, dt: number): void {
    const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) + pad.fwd + gp.fwd;
    const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + pad.strafe + gp.strafe;
    const len = Math.hypot(f, s);
    // With the phone up: no running, and a slower walk (F.PHONE_WALK).
    const wantSprint = (keys.has('ShiftLeft') || keys.has('ShiftRight') || pad.sprint || gp.sprint) && f > 0 && me.act === '' && !me.ph;
    me.sp = wantSprint && me.stam > 0 && len > 0;
    if (me.sp) {
      me.stam = Math.max(0, me.stam - STAMINA.drain * dt);
      sinceSprint = 0;
    } else rest(dt);
    me.moving = 0;
    if (!len || me.act === 'crank' || me.task) return;
    const speed = ((me.sp ? F.SPRINT : F.WALK * (me.ph ? F.PHONE_WALK : 1)) * Math.min(1, len) * dt) / len;
    const sin = Math.sin(me.yaw),
      cos = Math.cos(me.yaw);
    // right of forward (sin, cos) is (-cos, sin)
    me.moving = slide(me, (f * sin - s * cos) * speed, (f * cos + s * sin) * speed, PLAYER_R, S.doors);
    me.bob += dt * (me.sp ? 13 : 8.5) * me.moving;
  }

  return {
    me,
    pad,
    torch,
    toggleTorch,
    togglePhone,
    toggleZoom,
    throwToy,
    look,
    pause,
    resume,
    call,
    watchNext,
    letGo,
    // Put the guard where the room says they are: the start of a night, or after joining.
    reset(mine: Player): void {
      letGo();
      Object.assign(me, {
        x: mine.x,
        z: mine.z,
        yaw: mine.yaw ?? Math.PI,
        pitch: 0,
        on: false,
        ph: false,
        stam: 1,
        bob: 0,
        hold: 0,
        paused: false,
        watch: null,
        hid: -1,
      });
    },
    update(S: State, dt: number, now: number): void {
      const mine = myPlayer(S);
      if (!mine || !isPlaced(mine)) return;
      // Peeled up: stand looking ahead, not at the ceiling the catch left the camera facing.
      if (me.flat && !mine.flat) me.pitch = 0;
      me.flat = mine.flat;
      // Into a locker, or out of one: the room has moved us to the floor in front of its doors.
      const hid = mine.hid,
        locker = HIDES[hid];
      if (hid !== me.hid) {
        me.hid = hid;
        if (locker) Object.assign(me, { x: locker.at.x, z: locker.at.z, yaw: locker.face, pitch: 0, on: false, sp: false, moving: 0 });
        else if (!me.flat) {
          me.x = mine.x;
          me.z = mine.z;
        }
      }
      pollPad(dt);
      arrowLook(dt);
      if (locker) {
        // Looking out through the slats: only so far round, up or down.
        me.yaw = locker.face + Math.max(-LOCKER_LOOK.yaw, Math.min(LOCKER_LOOK.yaw, angDiff(me.yaw, locker.face)));
        me.pitch = Math.max(-LOCKER_LOOK.pitch, Math.min(LOCKER_LOOK.pitch, me.pitch));
      }
      // The screens between nights need the mouse back.
      if (S.phase !== 'play') {
        me.paused = false;
        letGo();
        if (mouseLocked) document.exitPointerLock();
      }
      me.locked = (mouseLocked || me.touch || gpLive || keysLive) && !me.paused;
      if (!S.players.some(p => p.id === me.watch && !p.flat) || !me.flat) me.watch = null;
      if (S.phase === 'play' && isNight(S)) {
        if (me.flat || me.paused) {
          me.act = '';
          me.target = null;
          me.sp = false;
          me.hold = 0;
          me.moving = 0;
          if (me.flat) {
            me.on = me.ph = false;
            letGo();
          }
        } else {
          // A door shut on top of us, or the room put us somewhere else.
          if (!walkable(me.x, me.z, PLAYER_R * 0.5, S.doors)) {
            me.x = mine.x;
            me.z = mine.z;
          }
          if (!me.task) me.target = findTarget(S, mine);
          use(S, dt);
          if (locker) {
            // Standing still in the dark: the torch is off and the breath comes back.
            me.on = me.sp = false;
            me.act = '';
            me.moving = 0;
            me.x = locker.at.x;
            me.z = locker.at.z;
            rest(dt);
          } else walk(S, dt);
          if (me.task) task.tick(dt);
          if (mine.bat <= 0) me.on = me.ph = false;
        }
        if (now - lastSend > SEND_MS) {
          lastSend = now;
          send({ t: 'p', x: me.x, z: me.z, yaw: me.yaw, pitch: me.pitch, on: me.on, ph: me.ph, sp: me.sp, act: me.act });
        }
      }
      // Low battery: the beam dims and stutters.
      const bat = mine.bat,
        weak = bat < 0.15 ? (Math.sin(now * 0.05) > -0.2 ? 0.5 : 0.1) : 1;
      torch.intensity = me.on && bat > 0 ? TORCH_FULL * weak * (0.55 + 0.45 * Math.min(1, bat * 3)) : 0;
      // With the phone up, or hands in a box, the torch hangs, lighting the floor a step ahead (and holding nothing: sim.ts beamOn).
      drop += ((me.ph || me.task ? 1 : 0) - drop) * Math.min(1, dt * 8);
      torch.target.position.set(0.05, -0.05 - 2.4 * drop, -3 + 1.2 * drop);
      const y = me.flat ? FLAT_EYE : EYE + Math.sin(me.bob) * 0.045;
      if (locker && !me.flat)
        camera.position.set(locker.x + Math.sin(locker.face) * LOCKER_LOOK.eye, EYE - 0.05, locker.z + Math.cos(locker.face) * LOCKER_LOOK.eye);
      else camera.position.set(me.x, y, me.z);
      camera.rotation.set(me.flat ? Math.max(0.3, me.pitch) : me.pitch, me.yaw + Math.PI, 0, 'YXZ');
    },
  };
}
