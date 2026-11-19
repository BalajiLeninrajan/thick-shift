// The local guard's own torch, held in view: the `flashlight` node of
// props_a.glb, parented to the camera. It sways with the walk, comes up when
// it is switched on, and its lens lights with the beam. If the model is
// missing there are simply no hands.
import { loadPart } from '../assets.js';

const HELD = { x: .2, y: -.2, z: -.42 }, LOWERED = .1;   // metres from the eye; how far it sinks when off

export function createHands(camera) {
  let torch = null, lens = null, up = 0, away = 0, drop = 0;
  loadPart('props_a', 'flashlight').then(o => {
    if (!o) return;
    torch = o; torch.position.set(HELD.x, HELD.y - LOWERED, HELD.z);
    // It sits a hand's width in front of the beam's own origin; a shadow from it would black out the beam.
    torch.traverse(m => { if (!m.isMesh) return; m.castShadow = false; if (m.material.name === 'lamp_glow') { m.material = m.material.clone(); lens = m.material; } });
    camera.add(torch);
  });
  return {
    // me: player.js's guard (on, ph, bob, moving, flat). busy: the catch has the camera.
    update(me, dt, busy) {
      if (!torch) return;
      up += ((me.on ? 1 : 0) - up) * Math.min(1, dt * 10);
      drop += ((me.ph ? 1 : 0) - drop) * Math.min(1, dt * 8);   // the phone is up: the torch hangs, pointing at the floor
      away += ((me.flat || busy ? 1 : 0) - away) * Math.min(1, dt * 8);
      torch.visible = away < .98;
      const sway = Math.sin(me.bob) * .012, dip = Math.abs(Math.cos(me.bob)) * .012;
      torch.position.set(HELD.x + sway, HELD.y - LOWERED * (1 - up) - .06 * drop - dip - away * .5, HELD.z);
      torch.rotation.set(-.35 * (1 - up) - .55 * drop + sway * 2, .06 - sway * 3, 0);
      if (lens) lens.emissiveIntensity = up * 3;
    },
  };
}
