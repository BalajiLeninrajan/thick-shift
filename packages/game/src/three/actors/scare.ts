// The catch, as the guard who was caught sees it. About a second and a half:
// the camera is taken from them and dragged to the mascot's face (or, for
// Stompy at the end, the worm's mouth), the mascot plays its scare pose and
// lunges, then the camera is dropped to the floor and left looking up at it
// as it sits down. After that player.ts has the camera back, where we left it.
import { angDiff } from '@thick-shift/sim/map';
import type { PerMascot } from '@thick-shift/sim/types';
import * as THREE from 'three';
import { context2d } from '../../dom';
import type { Me } from '../../types';
import type { Mascot } from './mascot';
import type { PerStage } from './styles';

// The cues of a catch in the order they come, and the seconds from the catch at which each comes. The sound hangs its
// stinger on these.
export const CUES = { grab: 0, face: 0.12, bite: 0.62, drop: 1.05, floor: 1.3, end: 1.5 };
// How close the camera is held to the face, by mascot (Big Biggs, Madame Flan, Squish, Stompy) and stage: near enough
// that the face (or the mouth) is all there is. Stompy's worm mouth is small.
const FILL: PerMascot<PerStage<number>> = [
  [0.95, 0.95, 0.8],
  [0.8, 0.8, 0.6],
  [1.05, 1, 1.1],
  [0.9, 0.8, 0.62],
];
const BITE = 0.72; // at the bite it comes this much closer again
const GLARE = 45; // the torch is forced on through the catch, stuttering, or in a dark building there would be nothing to see
const FLOOR_Y = 0.22; // where player.ts holds the camera of a flat guard
const FOV_IN = 86; // the lens goes wide as the face arrives
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const smooth = (u: number): number => THREE.MathUtils.smoothstep(u, 0, 1);

// The catch in progress. t: seconds since it began. yaw0, pitch0, fov0: the guard's view when it began, given back at the end. The rest is worked out as it goes: the
// view where the drop begins (yawDrop, pitchDrop, px, py, pz), set by every frame before the drop, and where it ends
// (yawEnd, pitchEnd), set by every frame in it. They start as the view the catch began with.
interface Catch {
  t: number;
  mascot: Mascot;
  yaw0: number;
  pitch0: number;
  fov0: number;
  yawDrop: number;
  pitchDrop: number;
  px: number;
  py: number;
  pz: number;
  yawEnd: number;
  pitchEnd: number;
}

export function createScare(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement) {
  // The strobe and the torn frame are drawn on a 2D canvas laid over the 3D one.
  const over = document.createElement('canvas');
  over.width = 640;
  over.height = 360;
  over.hidden = true;
  over.style.cssText = 'position:absolute;inset:0;pointer-events:none;image-rendering:pixelated';
  canvas.after(over);
  const c = context2d(over);
  const pos = new THREE.Vector3(),
    hold = new THREE.Vector3(),
    look = new THREE.Vector3(),
    from = new THREE.Vector3(),
    d = new THREE.Vector3();
  let on: Catch | null = null;

  function stop(): void {
    if (!on) return;
    on.mascot.scareOn = false;
    on.mascot.scareBite = 0;
    camera.fov = on.fov0;
    camera.updateProjectionMatrix();
    over.hidden = true;
    on = null;
  }

  return {
    get active(): boolean {
      return !!on;
    },
    // me: player.ts's guard. Its x and z are where the guard is lying.
    start(mascot: Mascot, me: Me): void {
      stop();
      from.copy(camera.position);
      on = {
        t: 0,
        mascot,
        yaw0: me.yaw,
        pitch0: me.pitch,
        fov0: camera.fov,
        yawDrop: me.yaw,
        pitchDrop: me.pitch,
        px: from.x,
        py: from.y,
        pz: from.z,
        yawEnd: me.yaw,
        pitchEnd: me.pitch,
      };
      pos.copy(from);
      mascot.scareOn = mascot.seen = true;
      mascot.sitOn(me.x, me.z, true);
    },
    stop,
    // Call after player.ts and the actors have run. Takes the camera (and the torch), and at the end hands me.yaw and me.pitch back where the camera is.
    update(me: Me, dt: number, torch: THREE.SpotLight) {
      if (!on) return;
      const a = on,
        m = a.mascot,
        face = m.face;
      a.t += dt;
      const t = a.t;
      // app.ts caps dt at 0.1 s, shorter than the drop to the end, so a frame in the drop has set yawEnd and pitchEnd.
      if (t >= CUES.end) {
        me.yaw = a.yawEnd;
        me.pitch = a.pitchEnd;
        return stop();
      }
      m.scareBite = smooth((t - CUES.bite) / 0.1) * (1 - smooth((t - CUES.drop) / 0.2));
      if (t >= CUES.drop) m.scareOn = false; // it lets go and sits

      // Where the camera is held: straight out in front of the face, a little below it.
      const fill = FILL[m.i][m.cur.style.stage] * (1 - (1 - BITE) * m.scareBite);
      const facing = m.group.rotation.y;
      d.set(Math.sin(facing), 0, Math.cos(facing));
      hold.copy(face).addScaledVector(d, fill);
      hold.y -= 0.1;
      let yaw: number,
        pitch: number,
        roll = 0;
      if (t < CUES.drop) {
        // Seized: the view whips round, then the whole camera goes to the face and is shaken there.
        const pull = smooth((t - CUES.grab) / (CUES.face + 0.1));
        pos.lerpVectors(from, hold, pull);
        look.subVectors(face, pos);
        const wantYaw = Math.atan2(look.x, look.z),
          wantPitch = Math.atan2(look.y, Math.hypot(look.x, look.z)),
          turn = smooth(t / CUES.face);
        yaw = a.yaw0 + angDiff(wantYaw, a.yaw0) * turn;
        pitch = a.pitch0 + (wantPitch - a.pitch0) * turn;
        const rattle = 0.012 + m.scareBite * 0.03,
          step = Math.floor(t * 40);
        pos.x += Math.sin(step * 12.9) * rattle;
        pos.y += Math.sin(step * 78.2) * rattle;
        roll = Math.sin(step * 37.7) * (0.03 + m.scareBite * 0.07);
        camera.fov = a.fov0 + (FOV_IN - a.fov0) * pull;
        camera.updateProjectionMatrix();
        a.yawDrop = yaw;
        a.pitchDrop = pitch;
        a.px = pos.x;
        a.py = pos.y;
        a.pz = pos.z;
        const step8 = Math.floor(t * 24);
        torch.intensity = Math.max(torch.intensity, GLARE * (Math.sin(step8 * 91.7) > -0.6 ? 1 : 0.12));
      } else {
        // Dropped: down to the floor, faster as it goes, ending on its back looking up at what is sitting on it.
        const fall = Math.min(1, (t - CUES.drop) / (CUES.floor - CUES.drop)),
          g = fall * fall,
          settle = smooth((t - CUES.floor) / (CUES.end - CUES.floor));
        // With dt capped at 0.1 s (app.ts) the first frame of a catch, which sets px..pz, comes long before the drop.
        pos.set(a.px + (me.x - a.px) * g, a.py + (FLOOR_Y - a.py) * g, a.pz + (me.z - a.pz) * g);
        look.subVectors(face, pos);
        a.yawEnd = Math.atan2(look.x, look.z);
        a.pitchEnd = Math.max(0.3, Math.min(1.3, Math.atan2(look.y, Math.hypot(look.x, look.z))));
        yaw = a.yawDrop + angDiff(a.yawEnd, a.yawDrop) * smooth(fall);
        pitch = a.pitchDrop + (a.pitchEnd - a.pitchDrop) * smooth(fall);
        const thud = fall >= 1 ? 1 - settle : 0;
        roll = (1 - g) * 0.25 + thud * Math.sin(t * 60) * 0.05;
        pos.y += thud * Math.abs(Math.sin(t * 45)) * 0.03;
        camera.fov = FOV_IN + (a.fov0 - FOV_IN) * smooth(fall);
        camera.updateProjectionMatrix();
      }
      camera.position.copy(pos);
      camera.rotation.set(pitch, yaw + Math.PI, roll, 'YXZ');
    },
    // Call after the frame is rendered: strobe and tear what was just drawn.
    after(): void {
      if (!on) return;
      const t = on.t,
        w = over.width,
        h = over.height,
        hit = t >= CUES.floor && t < CUES.floor + 0.07;
      over.hidden = false;
      c.clearRect(0, 0, w, h);
      if (calm.matches) {
        if (hit) {
          c.fillStyle = '#08080e';
          c.fillRect(0, 0, w, h);
        }
        return;
      }
      if (t < CUES.drop) {
        for (let i = 0, n = 2 + (on.mascot.scareBite > 0.5 ? 4 : 1); i < n; i++) {
          const y = Math.random() * h,
            sh = 6 + Math.random() * 30;
          c.drawImage(canvas, 0, (y / h) * canvas.height, canvas.width, (sh / h) * canvas.height, (Math.random() - 0.5) * 90, y, w, sh);
        }
        if (Math.floor(t * 30) % 5 === 0 && t > CUES.face) {
          c.fillStyle = 'rgba(8,8,14,.88)';
          c.fillRect(0, 0, w, h);
        }
      } else if (hit) {
        c.fillStyle = '#08080e';
        c.fillRect(0, 0, w, h);
      }
    },
  };
}
