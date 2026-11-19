// Wind-up teeth (TEETH in sim3d.js): every set in S.teeth, flying from the
// thrower's hand, then chattering on the floor where it came down, then lying
// there with its mouth a little open. Biggs Bites from the prize counter: a
// hippo's grin in pink and white on orange plastic feet, with a brass key in
// the side. Built here from a few shapes; there is no model for it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TEETH } from '../sim3d.js';
import { floorY } from '../world/shell.js';
import { hostClock } from './track.js';

const SIZE = 2.4;          // they are hippo teeth: twice the size of the ones in a joke shop, so they show across a room
const HAND = 1.3;          // metres off the floor they leave the hand
const ARC = [.6, .06];     // how high the throw goes over its run: metres, and metres more per metre thrown
const SHOW = 30;           // metres past which a set is not drawn
// The jaw clacks fast once wound and slows as the spring runs down (per second, start and end), and opens this far.
const CLACK = [11, 3], GAPE = .55, REST_GAPE = .12;

const HINGE = .058, KEY_AT = .033;   // heights, before SIZE, of the top jaw's hinge and the key's axle
const GUM = 0xc8506a, TOOTH = 0xf2ecd8, FOOT = 0xe8782a, KEY = 0xc8a040;

// One part of a jaw: a geometry with its colour painted into its vertices, so a whole jaw is one mesh.
function paint(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(col, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
const at = (geo, x, y, z, ry = 0) => geo.rotateY(ry).translate(x, y, z);

// A row of teeth round the front of a jaw, pointing up (or down, for the top jaw).
function teeth(r, y, h, down) {
  const out = [];
  for (let k = 0; k < 7; k++) {
    const a = -Math.PI / 2 + (k + .5) * Math.PI / 7, big = k === 0 || k === 6 ? 1.5 : 1;   // the two at the ends are tusks
    out.push(paint(at(new THREE.BoxGeometry(.013, h * big, .01), Math.sin(a) * r, y + (down ? -h * big / 2 : h * big / 2), Math.cos(a) * r, a), TOOTH));
  }
  return out;
}
// A half disc of gum, round side forward (+z), flat side at the hinge.
const gum = (r, h, y) => paint(new THREE.CylinderGeometry(r, r, h, 14, 1, false, -Math.PI / 2, Math.PI).translate(0, y, 0), GUM);

function shapes() {
  const lower = mergeGeometries([
    paint(at(new THREE.BoxGeometry(.03, .022, .07), -.03, .011, .01), FOOT), paint(at(new THREE.BoxGeometry(.03, .022, .07), .03, .011, .01), FOOT),
    gum(.055, .022, .033), ...teeth(.046, .044, .014, false),
  ]);
  // The top jaw hinges at the back of the bottom one, level with the tips of its teeth (HINGE), so its parts hang
  // from its origin. Its teeth stand a little forward of the bottom row, so they close in front of them.
  const upper = mergeGeometries([gum(.055, .022, .011 + .001), ...teeth(.05, 0, .014, true)]);
  // The key turns on its own axis, so it is built round it and put in place by its mesh (KEY_AT).
  const key = mergeGeometries([
    paint(new THREE.CylinderGeometry(.004, .004, .03, 6).rotateZ(Math.PI / 2).translate(.07, 0, 0), KEY),
    paint(new THREE.BoxGeometry(.004, .03, .022).translate(.087, 0, 0), KEY),
  ]);
  for (const g of [lower, upper, key]) g.scale(SIZE, SIZE, SIZE);
  return { lower, upper, key };
}

export function createTeeth(scene) {
  const geo = shapes(), mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .45 });
  const sets = new Map();   // by the throw's key: who threw it and when
  function make() {
    const g = new THREE.Group(), lower = new THREE.Mesh(geo.lower, mat), hinge = new THREE.Group(), upper = new THREE.Mesh(geo.upper, mat), key = new THREE.Mesh(geo.key, mat);
    hinge.position.y = HINGE * SIZE; hinge.add(upper); key.position.y = KEY_AT * SIZE;
    g.add(lower, hinge, key); g.name = 'teeth';
    g.traverse(o => { o.castShadow = false; });
    scene.add(g);
    return { g, hinge, key, wobble: Math.random() * 6 };
  }
  return {
    // A night began: the floor is swept.
    reset() { for (const s of sets.values()) scene.remove(s.g); sets.clear(); },
    sync(S, view) {
      const now = hostClock.now, list = S.teeth || [], here = new Set();
      for (const t of list) {
        const id = t.by + '@' + t.at;
        here.add(id);
        let s = sets.get(id);
        if (!s) { s = make(); sets.set(id, s); }
        const { g, hinge, key } = s;
        g.visible = Math.hypot(t.x - view.x, t.z - view.z) < SHOW;
        if (!g.visible) continue;
        const run = Math.hypot(t.x - t.x0, t.z - t.z0), heading = Math.atan2(t.x - t.x0, t.z - t.z0), ground = floorY(t.x, t.z);
        if (now < t.land) {
          // In the air: a lob from the hand, tumbling.
          const u = Math.max(0, Math.min(1, (now - t.at) / Math.max(.01, t.land - t.at)));
          g.position.set(t.x0 + (t.x - t.x0) * u, HAND + (ground - HAND) * u + 4 * (ARC[0] + ARC[1] * run) * u * (1 - u), t.z0 + (t.z - t.z0) * u);
          g.rotation.set(u * 9, heading, u * 3);
          hinge.rotation.x = -GAPE * .5;
          continue;
        }
        // On the floor: wound up, it clacks and shuffles where it fell until the spring runs down.
        const since = now - t.land, left = Math.max(0, 1 - since / TEETH.chatter);
        g.rotation.set(0, heading + Math.PI + (left ? Math.sin(since * 7 + s.wobble) * .35 * left : 0), 0);
        if (left > 0) {
          const rate = CLACK[1] + (CLACK[0] - CLACK[1]) * left, phase = since * rate * Math.PI;
          hinge.rotation.x = -GAPE * Math.abs(Math.sin(phase));
          g.position.set(t.x + Math.sin(since * 13 + s.wobble) * .02, ground + Math.abs(Math.sin(phase)) * .02, t.z + Math.cos(since * 11 + s.wobble) * .02);
          key.rotation.x = -since * 9 * left;
        } else {
          hinge.rotation.x = -REST_GAPE;
          g.position.set(t.x, ground, t.z);
        }
      }
      for (const [id, s] of sets) if (!here.has(id)) { scene.remove(s.g); sets.delete(id); }
    },
  };
}
