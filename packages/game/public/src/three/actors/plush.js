// Mini Biggs (TOY in sim3d.js): every one in S.toys, lobbed from the
// thrower's hand, then singing where it fell, then lying there with the song
// gone out of it until somebody picks it up. A palm-sized plush of Big Biggs in his friendly days, purple,
// with a party hat and a keyring loop, and a red light in its tummy that
// blinks with the voice box. Built here from a few shapes; there is no model for it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MASC } from '../../config.js';
import { TOY } from '../sim3d.js';
import { floorY } from '../world/shell.js';
import { hostClock } from './track.js';

const SIZE = 1.4;          // a big keyring, so it shows across a room in a torch beam
const HAND = 1.3;          // metres off the floor it leaves the hand
const ARC = [.6, .06];     // how high the throw goes over its run: metres, and metres more per metre thrown
const SHOW = 30;           // metres past which one is not drawn
const BEAT = 2.6;          // times a second it rocks and the light blinks while singing, slowing as the cell runs down

const FUR = new THREE.Color(MASC[0].col), BELLY = 0xd9c8ec, SNOUT = 0xb7a0d8, EYE = 0x141018, HAT = 0xe8a030, RING = 0xc8c8c8;

// One part: a geometry with its colour painted into its vertices, so the whole plush is one mesh.
function paint(geo, col) {
  const c = new THREE.Color(col), n = geo.attributes.position.count, out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(out, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return geo;
}
// Every part is made from spheres, cones and a torus, all non-indexed, so mergeGeometries takes them together.
const ball = (r, x, y, z, col, sx = 1, sy = 1, sz = 1) => paint(new THREE.SphereGeometry(r, 12, 8).toNonIndexed().scale(sx, sy, sz).translate(x, y, z), col);

function shape() {
  // Sitting up, facing +z: a pear of a body, a big head with a broad snout, round ears, stubby arms and feet.
  const parts = [
    ball(.04, 0, .04, 0, FUR, 1, 1.05, .95), ball(.028, 0, .035, .02, BELLY, 1, 1.1, .6),
    ball(.034, 0, .1, .004, FUR), ball(.026, 0, .088, .03, SNOUT, 1.25, .8, .8),
    ball(.005, -.012, .085, .05, EYE), ball(.005, .012, .085, .05, EYE),           // nostrils
    ball(.006, -.014, .115, .03, EYE), ball(.006, .014, .115, .03, EYE),           // eyes
    ball(.01, -.026, .13, -.004, FUR, 1, 1, .6), ball(.01, .026, .13, -.004, FUR, 1, 1, .6),
    ball(.012, -.042, .055, .01, FUR, 1, 1.5, 1), ball(.012, .042, .055, .01, FUR, 1, 1.5, 1),
    ball(.015, -.02, .008, .03, FUR, 1, .6, 1.3), ball(.015, .02, .008, .03, FUR, 1, .6, 1.3),
    paint(new THREE.ConeGeometry(.016, .04, 10).toNonIndexed().rotateZ(-.2).translate(.008, .148, -.004), HAT),
    paint(new THREE.TorusGeometry(.012, .002, 6, 14).toNonIndexed().translate(0, .19, -.004), RING),
  ];
  for (const g of parts) g.deleteAttribute('uv');
  return mergeGeometries(parts).scale(SIZE, SIZE, SIZE);
}

export function createPlush(scene) {
  const geo = shape(), mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9 });
  // The voice box's light, through the fur: unlit, so it shows in the dark while it sings.
  const lampGeo = new THREE.SphereGeometry(.007 * SIZE, 8, 6), lampOn = new THREE.MeshBasicMaterial({ color: 0xff3020, fog: false }), lampOff = new THREE.MeshBasicMaterial({ color: 0x2a0a08 });
  const toys = new Map();   // by the toy's id in S.toys
  function make() {
    const g = new THREE.Group(), body = new THREE.Mesh(geo, mat), lamp = new THREE.Mesh(lampGeo, lampOff);
    lamp.position.set(0, .045 * SIZE, .042 * SIZE);
    g.add(body, lamp); g.name = 'mini biggs';
    g.traverse(o => { o.castShadow = false; });
    scene.add(g);
    return { g, lamp, wobble: Math.random() * 6 };
  }
  return {
    // The group drawn for a toy in S.toys, for the outline (outline.js).
    group: id => toys.get(id)?.g,
    // A night began: the floor is swept.
    reset() { for (const s of toys.values()) scene.remove(s.g); toys.clear(); },
    sync(S, view) {
      const now = hostClock.now, list = S.toys || [], here = new Set();
      for (const t of list) {
        here.add(t.id);
        let s = toys.get(t.id);
        if (!s) { s = make(); toys.set(t.id, s); }
        const { g, lamp } = s;
        g.visible = Math.hypot(t.x - view.x, t.z - view.z) < SHOW;
        if (!g.visible) continue;
        const run = Math.hypot(t.x - t.x0, t.z - t.z0), heading = Math.atan2(t.x - t.x0, t.z - t.z0), ground = floorY(t.x, t.z);
        if (now < t.land) {
          // In the air: a lob from the hand, tumbling.
          const u = Math.max(0, Math.min(1, (now - t.at) / Math.max(.01, t.land - t.at)));
          g.position.set(t.x0 + (t.x - t.x0) * u, HAND + (ground - HAND) * u + 4 * (ARC[0] + ARC[1] * run) * u * (1 - u), t.z0 + (t.z - t.z0) * u);
          g.rotation.set(u * 8, heading, u * 2);
          lamp.material = lampOff;
          continue;
        }
        // On the floor, sat up facing back the way it came: it rocks side to side with the tune while the light blinks,
        // slower as the cell gives out, then tips over on its back.
        const since = now - t.land, left = Math.max(0, 1 - since / TOY.sing);
        g.position.set(t.x, ground, t.z);
        if (left > 0) {
          const phase = since * BEAT * (.5 + .5 * left) * Math.PI * 2;
          g.rotation.set(0, heading + Math.PI + s.wobble * .1, Math.sin(phase) * .25 * left);
          lamp.material = Math.sin(phase * 2) > 0 ? lampOn : lampOff;
        } else {
          g.rotation.set(-1.25, heading + Math.PI + s.wobble * .1, .2);
          g.position.y = ground + .035 * SIZE;   // on its back, its belly is what sits on the floor
          lamp.material = lampOff;
        }
      }
      for (const [id, s] of toys) if (!here.has(id)) { scene.remove(s.g); toys.delete(id); }
    },
  };
}
