// Buttons, keyboard, pointer panning, and phone tilt.
import { W, H, WORLD, ZONES } from './config.js';
import { game, client } from './state.js';
import { send } from './net.js';
import { unlockAudio, click } from './audio.js';
import { buildCamBar } from './ui.js';
import { cv } from './render/canvas.js';

const $ = id => document.getElementById(id);
const playing = () => !!game.S && game.S.phase === 'play';
const clampPan = x => Math.max(0, Math.min(WORLD - W, x));
const inZone = (z, x, y) => x > z.x && x < z.x + z.w && y > z.y && y < z.y + z.h;

function toggleDoor(k) { unlockAudio(); if (playing()) send({ t: 'door', k }); }

function toggleView(v) {
  if (!playing()) return;
  unlockAudio();
  client.view = client.view === v ? 'office' : v;
  send({ t: 'view', v: client.view, cam: client.cam });
  click();
}

function pickCam(i) { client.cam = i; client.glitch = 6; click(700); send({ t: 'view', v: client.view, cam: i }); }   // the host needs to know what you are looking at

function toggleLights() { unlockAudio(); if (playing()) send({ t: 'lights' }); }

async function toggleTilt() {
  unlockAudio();
  // iOS asks for permission the first time.
  if (!client.tilt && window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) {
    try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') return; } catch (e) { return; }
  }
  client.tilt = !client.tilt;
}

function onTilt(e) {
  if (!client.tilt || e.gamma == null) return;
  const landscape = innerWidth > innerHeight, flipped = screen.orientation && screen.orientation.angle === 270;
  const angle = landscape ? e.beta * (flipped ? -1 : 1) : e.gamma;
  client.panT = clampPan(400 + angle / 30 * 400);
}

// Tapping the office art works the same as the buttons under it.
function tapOffice(x, y) {
  const wx = x + client.pan;
  for (const k of ['L', 'R', 'V']) if (inZone(ZONES[k], wx, y)) return toggleDoor(k);
  if (inZone(ZONES.monitor, wx, y)) return toggleView('cams');
  if (inZone(ZONES.crank, wx, y)) return toggleView('crank');
}

function bindPointer() {
  let drag = null;
  const at = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; };
  cv.addEventListener('pointerdown', e => { unlockAudio(); drag = { x: at(e).x, pan: client.panT, moved: false }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    const p = at(e);
    if (drag) { const dx = p.x - drag.x; if (Math.abs(dx) > 6) drag.moved = true; client.panT = clampPan(drag.pan - dx * 1.6); }
    else if (e.pointerType === 'mouse' && !client.tilt) client.panT = p.x / W * (WORLD - W);
  });
  cv.addEventListener('pointerup', e => {
    const p = at(e);
    if (drag && !drag.moved && playing() && client.view === 'office') tapOffice(p.x, p.y);
    drag = null;
  });
}

const KEYS = {
  a: () => toggleDoor('L'), q: () => toggleDoor('L'),
  d: () => toggleDoor('R'), e: () => toggleDoor('R'),
  w: () => toggleDoor('V'), v: () => toggleDoor('V'),
  s: () => toggleView('cams'), ' ': () => toggleView('cams'),
  g: () => toggleView('crank'),
  l: () => toggleLights(),
};

function onKey(e) {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (KEYS[k]) { if (k === ' ') e.preventDefault(); KEYS[k](); }
  if (client.view === 'cams' && k >= '1' && k <= '5') pickCam(+k - 1);
}

export function bindInput() {
  $('bL').onclick = () => toggleDoor('L');
  $('bV').onclick = () => toggleDoor('V');
  $('bR').onclick = () => toggleDoor('R');
  $('bCam').onclick = () => toggleView('cams');
  $('bGen').onclick = () => toggleView('crank');
  $('bTilt').onclick = toggleTilt;
  $('bLight').onclick = toggleLights;
  buildCamBar(pickCam);
  bindPointer();
  addEventListener('deviceorientation', onTilt);
  addEventListener('keydown', onKey);
}
