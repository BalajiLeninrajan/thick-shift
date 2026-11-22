// The map on the phone's screen (actors/phone.ts): the building drawn like an
// old green LCD, a few times a second. Near, it is centred on the guard and
// turns with them, so what is ahead is up. Zoomed out it is the whole
// building with north up. It shows rooms and doorways, the booth doors that
// are shut, the guards (a cross for a flat one), the open faults,
// the generator and the charger, spare batteries, and every mascot that is
// off its mark, as the booth's wall map does.

import { defined, isPlaced } from '@thick-shift/sim/check';
import { BATTERY_SPOTS, BOXES, CHARGER, DOORWAYS, GENERATOR, ROOMS3, roomAt, SIZE_X, SIZE_Z } from '@thick-shift/sim/map';
import type { State } from '@thick-shift/sim/types';
import * as THREE from 'three';
import type { Me } from '../types';
import { canvas } from './world/tex';

const MAP_W = 288,
  MAP_H = 224; // canvas pixels: the 4:3-ish shape of the phone's glass
const NEAR = 11; // pixels per metre close up: 26 metres across
const EVERY = 125; // milliseconds between redraws
const INK = {
  bg: '#071108',
  room: '#123018',
  wall: '#5fd36f',
  shut: '#ff4a3a',
  me: '#ffffff',
  mate: '#a6f5b0',
  flat: '#7c8a7e',
  due: '#ffc23d',
  gen: '#ff9a3d',
  dock: '#5cc8ff',
  bat: '#fff07a',
  mascot: '#ff3b30',
  text: '#9df5a8',
};

export function createMinimap() {
  const c = canvas(MAP_W, MAP_H),
    texture = new THREE.CanvasTexture(c.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  let next = 0;

  const dot = (x: number, z: number, r: number, col: string): void => {
    c.fillStyle = col;
    c.beginPath();
    c.arc(x, z, r, 0, 7);
    c.fill();
  };
  const box = (x: number, z: number, r: number, col: string): void => {
    c.fillStyle = col;
    c.fillRect(x - r, z - r, r * 2, r * 2);
  };

  // The building and what is in it, in metres, under whatever transform is set. k: pixels per metre, for sizes.
  function plan(S: State, myId: string, k: number, t: number): void {
    const px = 1 / k; // one pixel, in metres
    c.fillStyle = INK.room;
    for (const room of ROOMS3) for (const [x0, z0, x1, z1] of room.rects) c.fillRect(x0, z0, x1 - x0, z1 - z0);
    c.strokeStyle = INK.wall;
    c.lineWidth = 3 * px;
    for (const room of ROOMS3) for (const [x0, z0, x1, z1] of room.rects) c.strokeRect(x0, z0, x1 - x0, z1 - z0);
    // Doorways cut through the walls; a shut booth door is a red bar across its gap.
    for (const d of DOORWAYS) {
      const [x0, z0, x1, z1] = d.rect,
        shut = d.key && S.doors[d.key],
        g = 2 * px;
      c.fillStyle = shut ? INK.shut : INK.room;
      if (d.axis === 'x') c.fillRect(x0 - g, z0, x1 - x0 + g * 2, z1 - z0);
      else c.fillRect(x0, z0 - g, x1 - x0, z1 - z0 + g * 2);
    }
    // Where to go: the crank and the charger, the open faults (blinking), spare batteries.
    box(GENERATOR.x, GENERATOR.z - 0.4, 4 * px, INK.gen);
    box(CHARGER.x, CHARGER.z - 0.4, 4 * px, INK.dock);
    const blink = t % 600 < 380;
    BOXES.forEach((cl, i) => {
      if (S.faults?.[i] && blink) dot(cl.x + Math.sin(cl.face) * 0.5, cl.z + Math.cos(cl.face) * 0.5, 5 * px, INK.due);
    });
    // S.bats holds BATTERY_SPOTS indices.
    for (const i of S.bats || []) {
      const spot = defined(BATTERY_SPOTS[i], `battery spot ${i}`);
      box(spot.x, spot.z, 3 * px, INK.bat);
    }
    // Mascots off their marks: a blip with a ring that grows.
    const ring = (t % 900) / 900;
    for (const m of S.m)
      if (m.st !== 'rest') {
        dot(m.x, m.z, 5 * px, INK.mascot);
        c.strokeStyle = INK.mascot;
        c.lineWidth = 1.5 * px;
        c.globalAlpha = 1 - ring;
        c.beginPath();
        c.arc(m.x, m.z, (5 + 9 * ring) * px, 0, 7);
        c.stroke();
        c.globalAlpha = 1;
      }
    // The other guards, and a cross for the flat ones.
    for (const p of S.players) {
      if (!isPlaced(p) || p.id === myId) continue;
      if (!p.flat) {
        box(p.x, p.z, 4 * px, INK.mate);
        continue;
      }
      c.strokeStyle = INK.flat;
      c.lineWidth = 3 * px;
      c.beginPath();
      c.moveTo(p.x - 5 * px, p.z - 5 * px);
      c.lineTo(p.x + 5 * px, p.z + 5 * px);
      c.moveTo(p.x + 5 * px, p.z - 5 * px);
      c.lineTo(p.x - 5 * px, p.z + 5 * px);
      c.stroke();
    }
  }

  // This guard: an arrow at (x, y) in pixels, pointing at angle a (radians, 0 is up the screen).
  function arrow(x: number, y: number, a: number): void {
    c.save();
    c.translate(x, y);
    c.rotate(a);
    c.fillStyle = INK.me;
    c.strokeStyle = INK.bg;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -9);
    c.lineTo(7, 7);
    c.lineTo(0, 3);
    c.lineTo(-7, 7);
    c.closePath();
    c.stroke();
    c.fill();
    c.restore();
  }

  return {
    texture,
    // me: player.ts's guard (x, z, yaw). myId: theirs, to leave out of the other guards. zoom: the whole building. now: milliseconds.
    draw(S: State, me: Me, myId: string, zoom: boolean, now: number): void {
      if (now < next) return;
      next = now + EVERY;
      c.fillStyle = INK.bg;
      c.fillRect(0, 0, MAP_W, MAP_H);
      const top = 26; // the status line
      c.save();
      if (zoom) {
        const k = Math.min(MAP_W / (SIZE_X + 1), (MAP_H - top - 4) / (SIZE_Z + 1)),
          ox = (MAP_W - SIZE_X * k) / 2,
          oy = top + 2;
        c.translate(ox, oy);
        c.scale(k, k);
        plan(S, myId, k, now);
        c.restore();
        // On the plan yaw 0 (south) is down the screen.
        arrow(ox + me.x * k, oy + me.z * k, Math.PI - me.yaw);
      } else {
        // Heading up: turn the plan so that the way the guard faces is up the screen, with them a little below the middle.
        const cx = MAP_W / 2,
          cy = top + (MAP_H - top) * 0.62;
        c.beginPath();
        c.rect(0, top, MAP_W, MAP_H - top);
        c.clip();
        c.translate(cx, cy);
        c.rotate(me.yaw - Math.PI);
        c.scale(NEAR, NEAR);
        c.translate(-me.x, -me.z);
        plan(S, myId, NEAR, now);
        c.restore();
        arrow(cx, cy, 0);
        // North (-z), turned the same way, at the edge of the picture.
        const n = me.yaw - Math.PI,
          r = cy - top - 12;
        c.fillStyle = INK.text;
        c.font = 'bold 15px monospace';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('N', cx + Math.sin(n) * r, cy - Math.cos(n) * r);
      }
      // The status line: where you are, and the zoom.
      c.fillStyle = INK.bg;
      c.fillRect(0, 0, MAP_W, top);
      c.fillStyle = INK.wall;
      c.fillRect(0, top - 2, MAP_W, 2);
      c.fillStyle = INK.text;
      c.font = 'bold 17px monospace';
      c.textBaseline = 'middle';
      c.textAlign = 'left';
      c.fillText((ROOMS3[roomAt(me.x, me.z)]?.name || 'Doorway').toUpperCase(), 8, top / 2);
      c.textAlign = 'right';
      c.fillText(zoom ? 'ALL' : 'NEAR', MAP_W - 8, top / 2);
      texture.needsUpdate = true;
    },
  };
}
