// Touch controls: a stick under the left thumb, look by
// dragging anywhere else, and buttons for the torch, the phone, its map's
// zoom, a Mini Biggs to throw, running and using things. They drive the guard
// through player.pad, player.look, player.toggleTorch, player.togglePhone,
// player.toggleZoom and player.throwToy, and show only while a finger is the pointer.
import { game } from '../state.js';
import { TOY } from '@thick-shift/sim';
import { unlockAudio } from '../audio.js';

const STICK_R = 48; // pixels the knob travels for full speed
const STICK_ZONE = 0.45; // the left part of the screen where a touch starts the stick
const LOOK = 2.6; // a thumb drags fewer pixels than a mouse travels

const TORCH =
  '<svg class="cn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6c0 2-2 2-2 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4V2h12z"/><path d="M6 6h12M12 12v2"/></svg>';

const PHONE =
  '<svg class="cn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="5" width="10" height="17" rx="2"/><path d="M14 5V2M9.5 8.5h5v4h-5zM10 16h.01M14 16h.01M12 19h.01"/></svg>';

const PLUSH =
  '<svg class="cn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13.5" r="7"/><circle cx="6.5" cy="6.5" r="2.2"/><circle cx="17.5" cy="6.5" r="2.2"/><path d="M9.5 11v.01M14.5 11v.01M10 16.5h.01M14 16.5h.01"/></svg>';

export const canFullscreen = !!document.documentElement.requestFullscreen;
// Phones that allow it are also turned to landscape, which is the only layout.
export function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else
    document.documentElement
      .requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation?.lock?.('landscape'))
      .catch(() => {
        /* refused: play in the page */
      });
}

export function createTouch(root, player) {
  const { me, pad } = player;
  const layer = document.createElement('div');
  layer.className = 'ts-t-layer';
  layer.innerHTML = `<div class="ts-t-stick"><i></i></div>
    <button class="ts-t-btn ts-t-run" aria-pressed="false">Run</button>
    <button class="ts-t-btn ts-t-torch" aria-label="Torch" aria-pressed="false">${TORCH}</button>
    <button class="ts-t-btn ts-t-use">Use</button>
    <button class="ts-t-btn ts-t-phone" aria-label="Phone" aria-pressed="false">${PHONE}</button>
    <button class="ts-t-btn ts-t-zoom" aria-label="Zoom the map" aria-pressed="false">Map</button>
    <button class="ts-t-btn ts-t-toy" aria-label="Throw a Mini Biggs">${PLUSH}</button>`;
  root.append(layer);
  const [stickEl, runBtn, torchBtn, useBtn, phoneBtn, zoomBtn, toyBtn] = /** @type {HTMLCollectionOf<HTMLElement>} */ (layer.children),
    knob = /** @type {HTMLElement} */ (stickEl.firstChild);
  let stick = null,
    drag = null; // the finger on the stick and the finger looking: { id, x, y }

  // Whichever kind of pointer was used last decides whether these controls show.
  const setTouch = on => {
    me.touch = on;
    root.dataset.touch = on;
  };
  setTouch(matchMedia('(pointer: coarse)').matches);
  addEventListener(
    'pointerdown',
    e => {
      if (e.pointerType === 'touch' || e.pointerType === 'mouse') setTouch(e.pointerType === 'touch');
    },
    true
  );

  function release() {
    stick = drag = null;
    Object.assign(pad, { fwd: 0, strafe: 0, sprint: false, use: false });
    stickEl.classList.remove('is-held');
    stickEl.style.left = stickEl.style.top = knob.style.transform = '';
    useBtn.classList.remove('is-held');
  }

  layer.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || e.target !== layer) return;
    unlockAudio();
    layer.setPointerCapture(e.pointerId);
    const r = layer.getBoundingClientRect(),
      at = { id: e.pointerId, x: e.clientX, y: e.clientY };
    if (!stick && e.clientX - r.left < r.width * STICK_ZONE) {
      stick = at;
      // The stick appears under the thumb, wherever that is.
      stickEl.classList.add('is-held');
      stickEl.style.left = e.clientX - r.left + 'px';
      stickEl.style.top = e.clientY - r.top + 'px';
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
  for (const type of /** @type {const} */ (['pointerup', 'pointercancel', 'lostpointercapture']))
    layer.addEventListener(type, e => {
      if (stick?.id === e.pointerId) {
        stick = null;
        pad.fwd = pad.strafe = 0;
        pad.sprint = false; // running ends when the thumb lifts
        stickEl.classList.remove('is-held');
        stickEl.style.left = stickEl.style.top = knob.style.transform = '';
      } else if (drag?.id === e.pointerId) drag = null;
    });
  // A long press must not open the browser's menu over the game.
  root.addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('blur', release);

  const press = (btn, down, up) => {
    btn.addEventListener('pointerdown', e => {
      e.stopPropagation();
      unlockAudio();
      btn.setPointerCapture(e.pointerId);
      down();
    });
    if (up) for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(type, up);
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

  const flag = (e, name, v) => {
    if (e.getAttribute(name) !== String(v)) e.setAttribute(name, v);
  };
  return {
    // Once a frame: hide the controls when they do nothing, and show what the buttons would do.
    sync() {
      const show = me.touch && !me.flat && !me.paused;
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
      const mine = game.S?.players.find(p => p.id === game.myId);
      flag(toyBtn, 'aria-disabled', !mine?.toy || mine.bat < TOY.cost);
    },
  };
}
