// This guard: walking, looking, the torch, and using things. The browser
// owns its own position and tells the host about twelve times a second
// (a 'p' action); everything else about the guard comes back in S.
// Keyboard (WASD to walk, and arrow keys to look for anyone without a mouse), mouse and gamepad are read here. Touch is in touch.js, which
// drives the same guard through pad, look(), toggleTorch(), togglePhone(), toggleZoom() and throwToy().
import * as THREE from 'three';
import { game } from '../state';
import { send } from '../net';
import { unlockAudio } from '../audio';
import { PLAYER_R, EYE, BOXES, GENERATOR, CHARGER, PANELS, BATTERY_SPOTS, HIDES, slide, walkable } from '@thick-shift/sim/map';
import { F, TOY } from '@thick-shift/sim';
import { FAULT_NAME } from './task';
import type { DoorKey, GuardAct, NightState, Player, State, UseWhat } from '@thick-shift/sim/types';
import type { Me, Prefs, Target, Task } from '../types';

// What drives the guard besides the keys: touch.js (pad) and the gamepad (gp, which also keeps the stick's last
// direction for a breaker box). fwd and strafe: -1 to 1.
interface Pad {
  fwd: number;
  strafe: number;
  sprint: boolean;
  use: boolean;
  stick?: number[];
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

// Look settings, kept between visits. sens multiplies SENS. outline: a gold edge round usable things (outline.js).
// third: a flat guard watches teammates from behind them, not through their eyes (app.js spectate).
export const prefs: Prefs = { sens: 1, invert: false, outline: true, third: false };
try {
  const saved = JSON.parse(localStorage.tsFloor || '{}');
  if (saved.sens > 0) prefs.sens = Math.min(2.5, Math.max(0.3, +saved.sens));
  prefs.invert = !!saved.invert;
  if (saved.outline === false) prefs.outline = false;
  prefs.third = !!saved.third;
} catch {
  /* storage blocked */
}
export function savePrefs(): void {
  try {
    localStorage.tsFloor = JSON.stringify(prefs);
  } catch {
    /* storage blocked */
  }
}
const typing = (e: Event): boolean => !!(e.target as Element).closest?.('input, textarea, select, [contenteditable]');
const STAMINA = { drain: 1 / 4.5, gain: 1 / 7, rest: 1 }; // per second, and seconds before it starts coming back
const DOOR_NAME = { L: 'left door', R: 'right door', V: 'vent' };
// In a locker: how far the view turns either side of straight out through the doors, and up or down (radians),
// and how far in front of the locker's middle the eye is: just past the doors, so their insides are behind it.
const LOCKER_LOOK = { yaw: 0.85, pitch: 0.5, eye: 0.34 };
const THROW_MS = 1000; // a second throw is not sent before the host has had time to take the first
const angDiff = (a: number, b: number): number => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export function createPlayer(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement) {
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
    paused: false, // the pause panel is up: nothing here moves the guard
    touch: false, // a finger is driving (set by touch.js), so there is no pointer to lock
    watch: null, // id of the teammate a flat guard is watching through, or null
    ph: false, // the phone is up, showing the minimap
    task: null, // hands in a breaker box: { i } of the box, while the minigame panel (task.js) is up
    zoom: true, // the minimap shows the whole building, not what is round the guard. The phone starts on this.
    threw: 0, // performance.now() of the last Mini Biggs thrown, of the last try without the battery for it (dry),
    dry: 0, // and of the last try with empty hands (empty)
    empty: 0,
    hid: -1,
  }; // the locker (HIDES index) this guard is standing in, as the host has it, or -1
  const keys = new Set<string>();
  // Touch and gamepad code can drive the guard through these instead of keys.
  const pad: Pad = { fwd: 0, strafe: 0, sprint: false, use: false };
  const gp: Pad = { fwd: 0, strafe: 0, sprint: false, use: false };
  let lastThrow = -1e9,
    sinceSprint = 0,
    lastSend = 0,
    usedTap = false,
    lastCall = -1e9,
    drop = 0;
  let mouseLocked = false,
    gpLive = false,
    gpWas: boolean[] = [];
  let keysLive = false,
    arrowHeld = 0; // keysLive: playing on the keyboard alone, so there is no pointer to lock
  let task: Task | null = null; // the minigame panel (task.js), handed over by app.js once the HUD exists
  function letGo(): void {
    if (me.task) {
      me.task = null;
      task?.close();
    }
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
  const charged = (): boolean => (game.S.players.find(p => p.id === game.myId)?.bat ?? 1) > 0;
  function togglePhone(): void {
    if (playing() && !me.flat && !me.paused && (me.ph || charged())) me.ph = !me.ph;
  }
  // The minimap between what is round the guard and the whole building. Only with the phone up.
  function toggleZoom(): void {
    if (me.ph) me.zoom = !me.zoom;
  }
  // The guard's Mini Biggs, thrown where they are looking: as far as the floor the view meets, or as far as one goes
  // when looking level or up. It sings on a bar of the torch's battery, so it needs that much, and it has to be picked
  // up again before the next throw. The host works out where it comes down (landing in sim.ts) and takes the
  // battery. Not from a locker, and not with both hands in a breaker box.
  function throwToy(): void {
    if (!playing() || me.flat || me.paused || me.hid >= 0 || me.task) return;
    const now = performance.now(),
      mine = game.S.players.find(p => p.id === game.myId);
    if (!mine?.toy) {
      me.empty = now;
      return;
    }
    if (mine.bat < TOY.cost) {
      me.dry = now;
      return;
    }
    if (now - lastThrow < THROW_MS) return; // the host has not said it has gone yet
    lastThrow = me.threw = now;
    const d = me.pitch < -0.05 ? Math.min(TOY.range, (EYE - 0.2) / Math.tan(-me.pitch)) : TOY.range;
    send({ t: 'throw', yaw: me.yaw, d });
  }

  // Turn the view by a mouse's worth of pixels.
  function look(dx: number, dy: number): void {
    if (me.paused) return;
    const k = SENS * prefs.sens;
    me.yaw -= dx * k;
    me.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, me.pitch - dy * k * (prefs.invert ? -1 : 1)));
  }
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
  // A flat guard shouts. The host rate-limits it too.
  function call(): void {
    if (!playing() || !me.flat || performance.now() - lastCall < F.CALL_GAP * 1000) return;
    lastCall = performance.now();
    send({ t: 'call' });
  }
  // A flat guard steps through the standing teammates' views, then back to their own.
  function watchNext(): void {
    if (!playing() || !me.flat) return;
    const ids = game.S.players.filter(p => !p.flat && p.id !== game.myId && p.x != null).map(p => p.id);
    me.watch = ids[ids.indexOf(me.watch) + 1] ?? null;
  }

  addEventListener('keydown', e => {
    if (typing(e) || !playing()) return;
    // Without a locked pointer the browser does not turn Esc into a pause, so do it here; Enter comes back.
    if (me.paused) {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        keysLive = true;
        resume();
      }
      return;
    }
    if (e.code === 'Escape' && !mouseLocked) {
      pause();
      return;
    }
    if (GAME_KEYS.test(e.code)) keysLive = true;
    if (!e.repeat) ({ KeyF: toggleTorch, KeyQ: call, Space: watchNext, KeyC: togglePhone, KeyR: toggleZoom, KeyG: throwToy })[e.code]?.();
    if (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault();
    keys.add(e.code);
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
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
    if (mouseLocked) gpLive = false;
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
    const turn = (keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0),
      tilt = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);
    if (!turn && !tilt) {
      arrowHeld = 0;
      return;
    }
    arrowHeld += dt;
    const k = (Math.min(1, 0.3 + (0.7 * arrowHeld) / ARROW_RAMP) * dt) / SENS;
    look(-turn * ARROW.turn * k, -tilt * ARROW.tilt * k);
  }

  function pollPad(dt: number): void {
    const g = [...(navigator.getGamepads?.() || [])].find(g => g?.connected && g.mapping === 'standard');
    Object.assign(gp, { fwd: 0, strafe: 0, sprint: false, use: false });
    if (!g) return;
    const axis = (i: number): number => (Math.abs(g.axes[i]) > GP.dead ? g.axes[i] : 0),
      down = (i: number): boolean => !!g.buttons[i]?.pressed,
      hit = (i: number): boolean => down(i) && !gpWas[i];
    if (hit(GP.pause)) {
      if (me.paused || !me.locked) {
        gpLive = true;
        me.paused = false;
      } else pause();
    } else if (!me.paused && g.buttons.some((b, i) => b.pressed && !gpWas[i])) gpLive = true; // any button takes over from the mouse
    if (gpLive && !me.paused && me.task) {
      // Hands in a box: the stick and d-pad choose, A works it, B lets go.
      const fresh = (i: number): boolean => hit(i),
        sx = axis(0),
        sy = axis(1),
        was = gp.stick || [0, 0];
      const stick = [Math.abs(sx) > 0.6 ? Math.sign(sx) : 0, Math.abs(sy) > 0.6 ? Math.sign(sy) : 0];
      const dir: [number, number] | null = fresh(14)
        ? [-1, 0]
        : fresh(15)
          ? [1, 0]
          : fresh(12)
            ? [0, -1]
            : fresh(13)
              ? [0, 1]
              : stick[0] !== was[0] && stick[0]
                ? [stick[0], 0]
                : stick[1] !== was[1] && stick[1]
                  ? [0, stick[1]]
                  : null;
      gp.stick = stick;
      look((axis(2) * GP.look * dt) / SENS, (axis(3) * GP.look * dt) / SENS);
      task?.pad(dir, down(GP.use), !!gpWas[GP.use], fresh(GP.phone));
    } else if (gpLive && !me.paused) {
      Object.assign(gp, { fwd: -axis(1), strafe: axis(0), sprint: down(GP.sprint), use: down(GP.use) });
      look((axis(2) * GP.look * dt) / SENS, (axis(3) * GP.look * dt) / SENS);
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
  function findTarget(S: NightState, mine: Player): Target | null {
    const list: Target[] = [];
    S.faults?.forEach((f, i) => {
      if (f) list.push({ what: 'fix', i, at: BOXES[i], label: FAULT_NAME[f.k], hold: 0 });
    });
    if (S.power > 0)
      for (const k in PANELS)
        list.push({ what: 'door', k: k as DoorKey, at: PANELS[k], label: `${S.doors[k] ? 'Open' : 'Shut'} the ${DOOR_NAME[k]}`, hold: 0 });
    if (mine.bat < 1) for (const i of S.bats || []) list.push({ what: 'bat', i, at: BATTERY_SPOTS[i], label: 'Take the battery', hold: 0 });
    for (const p of S.players)
      if (p.flat && p.id !== game.myId) list.push({ what: 'peel', id: p.id, at: p, label: `Peel ${p.name} off the floor`, hold: F.PEEL_HOLD });
    list.push({ what: 'crank', at: GENERATOR, label: S.power >= 100 ? 'The generator is full' : 'Crank the generator', hold: S.power >= 100 ? 0 : -1 });
    if (S.power > 0 && mine.bat < 1) list.push({ what: 'charge', at: CHARGER, label: 'Charge the torch', hold: -1 });
    // In a locker the one thing in reach is the way out.
    if (mine.hid >= 0) return { what: 'hide', i: mine.hid, at: HIDES[mine.hid].at, label: 'Step out of the locker', hold: 0 };
    // Any Mini Biggs on the floor, into empty hands.
    if (!mine.toy) for (const t of S.toys || []) if (S.t >= t.land) list.push({ what: 'toy', id: t.id, at: t, label: 'Pick up the Mini Biggs', hold: 0 });
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

  function use(S: State, dt: number): void {
    const t = me.target,
      held = keys.has('KeyE') || pad.use || gp.use;
    me.act = '';
    if (me.task) {
      // Hands in the box until the job is done or let go. Fixed by someone else, or out of reach: let go.
      const f = S.faults?.[me.task.i];
      if (!f || f.at !== me.task.at || Math.hypot(BOXES[me.task.i].x - me.x, BOXES[me.task.i].z - me.z) > F.REACH) letGo();
      else {
        me.act = 'fix';
        return;
      }
    }
    if (!held) usedTap = false;
    if (t?.what === 'fix' && held && !usedTap && task) {
      // A fault is a minigame, not a hold: open the panel.
      usedTap = true;
      me.hold = 0;
      const f = S.faults[t.i];
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
    if (t.hold < 0) {
      me.act = t.what as GuardAct;
      return;
    }
    if (usedTap) return;
    me.hold += dt;
    if (me.hold >= t.hold) {
      send({ t: 'use', what: t.what as UseWhat, i: t.i, k: t.k, id: t.id });
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
    } else {
      sinceSprint += dt;
      if (sinceSprint > STAMINA.rest) me.stam = Math.min(1, me.stam + STAMINA.gain * dt);
    }
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
    letGo,
    setTask(t: Task): void {
      task = t;
    },
    toggleTorch,
    togglePhone,
    toggleZoom,
    throwToy,
    look,
    pause,
    resume,
    call,
    watchNext,
    // Put the guard where the host says they are: the start of a night, or after joining.
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
      const mine = S.players.find(p => p.id === game.myId);
      if (!mine || mine.x == null) return;
      // Peeled up: stand looking ahead, not at the ceiling the catch left the camera facing.
      if (me.flat && !mine.flat) me.pitch = 0;
      me.flat = !!mine.flat;
      // Into a locker, or out of one: the host has moved us to the floor in front of its doors.
      const hid = mine.hid ?? -1,
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
      if (S.phase === 'play') {
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
          // A door shut on top of us, or the host put us somewhere else.
          if (!walkable(me.x, me.z, PLAYER_R * 0.5, S.doors)) {
            me.x = mine.x;
            me.z = mine.z;
          }
          if (!me.task) me.target = findTarget(S as NightState, mine);
          use(S, dt);
          if (locker) {
            // Standing still in the dark: the torch is off and the breath comes back.
            me.on = me.sp = false;
            me.act = '';
            me.moving = 0;
            me.x = locker.at.x;
            me.z = locker.at.z;
            if ((sinceSprint += dt) > STAMINA.rest) me.stam = Math.min(1, me.stam + STAMINA.gain * dt);
          } else walk(S, dt);
          if (me.task) task?.tick(dt);
          if (mine.bat <= 0) me.on = me.ph = false;
        }
        if (now - lastSend > SEND_MS) {
          lastSend = now;
          send({ t: 'p', x: me.x, z: me.z, yaw: me.yaw, pitch: me.pitch, on: me.on, ph: me.ph, sp: me.sp, act: me.act });
        }
      }
      // Low battery: the beam dims and stutters.
      const bat = mine.bat ?? 1,
        weak = bat < 0.15 ? (Math.sin(now * 0.05) > -0.2 ? 0.5 : 0.1) : 1;
      torch.intensity = me.on && bat > 0 ? 60 * weak * (0.55 + 0.45 * Math.min(1, bat * 3)) : 0;
      // With the phone up, or hands in a box, the torch hangs, lighting the floor a step ahead (and holding nothing: sim.ts beamOn).
      drop += ((me.ph || me.task ? 1 : 0) - drop) * Math.min(1, dt * 8);
      torch.target.position.set(0.05, -0.05 - 2.4 * drop, -3 + 1.2 * drop);
      const y = me.flat ? 0.22 : EYE + Math.sin(me.bob) * 0.045;
      if (locker && !me.flat)
        camera.position.set(locker.x + Math.sin(locker.face) * LOCKER_LOOK.eye, EYE - 0.05, locker.z + Math.cos(locker.face) * LOCKER_LOOK.eye);
      else camera.position.set(me.x, y, me.z);
      camera.rotation.set(me.flat ? Math.max(0.3, me.pitch) : me.pitch, me.yaw + Math.PI, 0, 'YXZ');
    },
  };
}
