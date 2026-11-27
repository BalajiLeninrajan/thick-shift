// Touch controls: a stick under the left thumb, look by
// dragging anywhere else, and buttons for the torch, the phone, its map's
// zoom, a Mini Biggs to throw, running and using things. They drive the guard
// through player.pad, player.look, player.toggleTorch, player.togglePhone,
// player.toggleZoom and player.throwToy, and show only while a finger is the pointer.

import { TOY } from '@thick-shift/sim';
import { isPlaced } from '@thick-shift/sim/check';
import { unlockAudio } from '../audio';
import { query } from '../dom';
import { game, myPlayer } from '../state';
import type { PlayerHandle } from '../types';
import { icon } from './icons';

const STICK_R = 48; // pixels the knob travels for full speed
const STICK_ZONE = 0.45; // the left part of the screen where a touch starts the stick
const LOOK = 2.6; // a thumb drags fewer pixels than a mouse travels

// A finger on the layer: its pointer id and where it was last.
interface Finger {
  id: number;
  x: number;
  y: number;
}

const POINTER_END = ['pointerup', 'pointercancel', 'lostpointercapture'] as const;

export const canFullscreen: boolean = !!document.documentElement.requestFullscreen;
// Phones that allow it are also turned to landscape, which is the only layout.
export function toggleFullscreen(): void {
  if (document.fullscreenElement) document.exitFullscreen();
  else
    document.documentElement
      .requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation?.lock?.('landscape'))
      .catch(() => {
        /* refused: play in the page */
      });
}

export function createTouch(root: HTMLElement, player: PlayerHandle) {
  const { me, pad } = player;
  const layer = document.createElement('div');
  layer.className = 'ts-t-layer';
  layer.innerHTML = `<div class="ts-t-stick"><i></i></div>
    <button class="ts-t-btn ts-t-run" aria-pressed="false">Run</button>
    <button class="ts-t-btn ts-t-torch" aria-label="Torch" aria-pressed="false">${icon('torch')}</button>
    <button class="ts-t-btn ts-t-use">Use</button>
    <button class="ts-t-btn ts-t-phone" aria-label="Phone" aria-pressed="false">${icon('phone')}</button>
    <button class="ts-t-btn ts-t-zoom" aria-label="Zoom the map" aria-pressed="false">Map</button>
    <button class="ts-t-btn ts-t-toy" aria-label="Throw a Mini Biggs">${icon('toy')}</button>`;
  root.append(layer);
  const stickEl = query(layer, '.ts-t-stick'),
    knob = query(stickEl, 'i'),
    runBtn = query(layer, '.ts-t-run'),
    torchBtn = query(layer, '.ts-t-torch'),
    useBtn = query(layer, '.ts-t-use'),
    phoneBtn = query(layer, '.ts-t-phone'),
    zoomBtn = query(layer, '.ts-t-zoom'),
    toyBtn = query(layer, '.ts-t-toy');
  let stick: Finger | null = null,
    drag: Finger | null = null; // the finger on the stick and the finger looking: { id, x, y }

  // Whichever kind of pointer was used last decides whether these controls show.
  const setTouch = (on: boolean): void => {
    me.touch = on;
    root.dataset.touch = String(on);
  };
  setTouch(matchMedia('(pointer: coarse)').matches);
  addEventListener(
    'pointerdown',
    e => {
      if (e.pointerType === 'touch' || e.pointerType === 'mouse') setTouch(e.pointerType === 'touch');
    },
    true
  );

  // The thumb is off the stick, which ends running too.
  function dropStick(): void {
    stick = null;
    pad.fwd = pad.strafe = 0;
    pad.sprint = false;
    stickEl.classList.remove('is-held');
    stickEl.style.left = stickEl.style.top = knob.style.transform = '';
  }
  function release(): void {
    dropStick();
    drag = null;
    pad.use = false;
    useBtn.classList.remove('is-held');
  }

  layer.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || e.target !== layer) return;
    unlockAudio();
    layer.setPointerCapture(e.pointerId);
    const r = layer.getBoundingClientRect(),
      at: Finger = { id: e.pointerId, x: e.clientX, y: e.clientY };
    if (!stick && e.clientX - r.left < r.width * STICK_ZONE) {
      stick = at;
      // The stick appears under the thumb, wherever that is.
      stickEl.classList.add('is-held');
      stickEl.style.left = `${e.clientX - r.left}px`;
      stickEl.style.top = `${e.clientY - r.top}px`;
    } else if (!drag) drag = at;
  });
  layer.addEventListener('pointermove', e => {
    if (stick?.id === e.pointerId) {
      const dx = e.clientX - stick.x,
        dy = e.clientY - stick.y,
        k = Math.min(1, STICK_R / Math.max(1, Math.hypot(dx, dy)));
      pad.strafe = (dx * k) / STICK_R;
      pad.fwd = (-dy * k) / STICK_R;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    } else if (drag?.id === e.pointerId) {
      player.look((e.clientX - drag.x) * LOOK, (e.clientY - drag.y) * LOOK);
      drag.x = e.clientX;
      drag.y = e.clientY;
    }
  });
  // lostpointercapture covers a finger the browser stopped reporting, so the guard never keeps walking on its own.
  for (const type of POINTER_END)
    layer.addEventListener(type, e => {
      if (stick?.id === e.pointerId) dropStick();
      else if (drag?.id === e.pointerId) drag = null;
    });
  // A long press must not open the browser's menu over the game.
  root.addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('blur', release);

  const press = (btn: HTMLElement, down: () => void, up?: () => void): void => {
    btn.addEventListener('pointerdown', e => {
      e.stopPropagation();
      unlockAudio();
      btn.setPointerCapture(e.pointerId);
      down();
    });
    if (up) for (const type of POINTER_END) btn.addEventListener(type, up);
  };
  press(
    useBtn,
    () => {
      pad.use = true;
      useBtn.classList.add('is-held');
    },
    () => {
      pad.use = false;
      useBtn.classList.remove('is-held');
    }
  );
  press(torchBtn, () => player.toggleTorch());
  press(phoneBtn, () => player.togglePhone());
  press(zoomBtn, () => player.toggleZoom());
  // Thrown where the view points, as with the key: drag to look down at a spot first to throw it short.
  press(toyBtn, () => player.throwToy());
  press(runBtn, () => {
    pad.sprint = !pad.sprint;
  });

  const flag = (e: Element, name: string, v: boolean): void => {
    if (e.getAttribute(name) !== String(v)) e.setAttribute(name, String(v));
  };
  return {
    // Once a frame: hide the controls when they do nothing, and show what the buttons would do.
    sync(): void {
      const show = me.touch && !me.flat && !me.paused && me.cam < 0; // at the desk, the camera panel has its own buttons
      if (layer.hidden === show) {
        layer.hidden = !show;
        release();
      }
      flag(torchBtn, 'aria-pressed', me.on);
      flag(phoneBtn, 'aria-pressed', me.ph);
      flag(zoomBtn, 'aria-pressed', me.zoom);
      if (zoomBtn.hidden === me.ph) zoomBtn.hidden = !me.ph;
      flag(runBtn, 'aria-pressed', pad.sprint);
      useBtn.classList.toggle('is-ready', !!me.target);
      layer.classList.toggle('is-busy', !!me.task);
      // Greyed out with empty hands, or while the battery has less than a throw costs.
      const mine = game.S && myPlayer(game.S);
      // Holding a toy means stepFloor has placed them, so isPlaced holds whenever toy is set.
      flag(toyBtn, 'aria-disabled', !mine?.toy || !isPlaced(mine) || mine.bat < TOY.cost);
    },
  };
}
