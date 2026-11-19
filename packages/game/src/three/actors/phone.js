// This guard's phone, held in the left hand at the bottom left of the view:
// a late-90s candybar with a stub aerial, a green-lit keypad and a small
// screen showing the map (minimap.js). It comes up while me.ph is on and
// drops out of view when it is not. Built here from boxes; there is no
// model for it.
import * as THREE from 'three';
import { game } from '../../state.js';
import { canvas } from '../world/tex.js';
import { createMinimap } from '../minimap.js';
import { HANDS_ORDER } from '../slats.js';

const HELD = { x: -.15, y: -.088, z: -.235 }, DROP = .2;   // metres from the eye, and how far below that it sits when put away
const TURN = { x: .14, y: .24, z: .07 };                    // radians: tipped back and turned in, toward the eye
const BODY = { w: .074, h: .16, d: .026 };
const SCREEN = { w: .062, h: .048, y: .03 };               // the glass, the minimap's shape, centred this far above the middle
const GLOW = .62;                                          // how bright the glass is, before post.js's exposure

// The keypad: two soft keys and a rocker, then twelve keys with the old letters.
function keypad() {
  const W = 140, H = 150, c = canvas(W, H);
  c.fillStyle = '#16181b'; c.fillRect(0, 0, W, H);
  const key = (x, y, w, h, label, small) => {
    c.fillStyle = '#3a3e44'; c.beginPath(); c.roundRect(x, y, w, h, 7); c.fill();
    c.fillStyle = '#9ff5b0'; c.font = `bold ${small ? 11 : 15}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, x + w / 2, y + h / 2);
  };
  key(6, 4, 36, 16, '–', true); key(98, 4, 36, 16, '–', true);
  c.fillStyle = '#4a4f56'; c.beginPath(); c.ellipse(70, 14, 20, 11, 0, 0, 7); c.fill();
  ['1', '2 abc', '3 def', '4 ghi', '5 jkl', '6 mno', '7 pqrs', '8 tuv', '9 wxyz', '*', '0', '#'].forEach((k, i) => key(6 + (i % 3) * 44, 30 + Math.floor(i / 3) * 30, 40, 25, k.split(' ')[0]));
  const t = new THREE.CanvasTexture(c.canvas); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createPhone(camera) {
  const map = createMinimap();
  const phone = new THREE.Group(), hold = new THREE.Group(); phone.name = 'phone';
  const plastic = new THREE.MeshStandardMaterial({ color: 0x34373c, roughness: .55, emissive: 0x0a120c });
  const face = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: .4, emissive: 0x081009 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc99a7c, roughness: .8, emissive: 0x1a2a1c });
  const mesh = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = false; hold.add(m); return m; };
  mesh(new THREE.BoxGeometry(BODY.w, BODY.h, BODY.d), plastic, 0, 0, 0);
  mesh(new THREE.BoxGeometry(BODY.w - .008, BODY.h - .01, .002), face, 0, 0, BODY.d / 2 + .001);
  mesh(new THREE.BoxGeometry(.016, .003, .002), plastic, 0, BODY.h / 2 - .008, BODY.d / 2 + .002);   // the earpiece
  mesh(new THREE.CylinderGeometry(.005, .006, .03, 8), plastic, .022, BODY.h / 2 + .013, -.004);       // the stub aerial
  mesh(new THREE.SphereGeometry(.0065, 8, 6), plastic, .022, BODY.h / 2 + .028, -.004);
  // The glass, sunk a little into a dark surround.
  mesh(new THREE.BoxGeometry(SCREEN.w + .008, SCREEN.h + .008, .002), new THREE.MeshBasicMaterial({ color: 0x050605 }), 0, SCREEN.y, BODY.d / 2 + .002);
  mesh(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h), new THREE.MeshBasicMaterial({ map: map.texture, color: new THREE.Color().setScalar(GLOW), fog: false }), 0, SCREEN.y, BODY.d / 2 + .0032);
  const keys = new THREE.MeshBasicMaterial({ map: keypad(), color: 0x6a7a6c });
  mesh(new THREE.PlaneGeometry(.058, .062), keys, 0, -.042, BODY.d / 2 + .0025);
  // The hand: fingers round the left edge, the thumb across the keys, the palm behind.
  mesh(new THREE.BoxGeometry(.075, .085, .03), skin, -.006, -.05, -BODY.d / 2 - .015).rotation.z = .15;
  for (let i = 0; i < 3; i++) mesh(new THREE.CapsuleGeometry(.0085, .016, 3, 6), skin, -BODY.w / 2 + .002, -.022 - i * .02, .006).rotation.set(0, .5, Math.PI / 2 - .15);
  const thumb = mesh(new THREE.CapsuleGeometry(.009, .036, 3, 6), skin, .034, -.07, BODY.d / 2 + .006); thumb.rotation.set(.1, 0, .9);
  phone.add(hold); hold.rotation.set(TURN.x, TURN.y, TURN.z);
  hold.traverse(o => { o.renderOrder = HANDS_ORDER; });   // in a locker it is held inside the doors, so in front of their slats
  phone.position.set(HELD.x, HELD.y - DROP, HELD.z); phone.visible = false;
  camera.add(phone);

  let up = 0, away = 0;
  return {
    // me: player.js's guard (ph, zoom, x, z, yaw, bob, flat). busy: the catch has the camera. now: milliseconds.
    update(S, me, dt, now, busy) {
      up += ((me.ph ? 1 : 0) - up) * Math.min(1, dt * 9);
      away += ((me.flat || busy ? 1 : 0) - away) * Math.min(1, dt * 8);
      const shown = up * (1 - away);
      phone.visible = shown > .02;
      if (!phone.visible) return;
      map.draw(S, me, game.myId, me.zoom, now);
      const sway = Math.sin(me.bob + 1.3) * .01, dip = Math.abs(Math.cos(me.bob + 1.3)) * .01, ease = 1 - (1 - shown) ** 2;
      phone.position.set(HELD.x + sway - (1 - ease) * .04, HELD.y - DROP * (1 - ease) - dip, HELD.z);
      phone.rotation.set(-.6 * (1 - ease) + sway * 2, sway * 2, 0);
    },
  };
}
