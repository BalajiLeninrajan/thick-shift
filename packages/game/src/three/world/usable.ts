// The things a guard uses: breaker boxes, door buttons, the generator,
// the charger, spare batteries, the booth's three doors and its wall map.
// Each starts as a plain stand-in and is swapped for its model from the prop
// kit when that arrives; if it never does, the stand-ins are the game.

import { lightsF } from '@thick-shift/sim';
import { isPlaced } from '@thick-shift/sim/check';
import { DOORS, MASC } from '@thick-shift/sim/config';
import { GEN_BACK } from '@thick-shift/sim/dressing';
import { BATTERY_SPOTS, BOOTH, BOXES, CHARGER, DOOR_H, DOORWAYS, GENERATOR, PANELS, ROOMS3, roomAt, WALL_MAP } from '@thick-shift/sim/map';
import type { DoorKey, Point, State } from '@thick-shift/sim/types';
import * as THREE from 'three';
import type { WorldParts } from '../../types';
import { prop } from './props';
import { floorY } from './shell';
import { roomData } from './sight';
import { canvas } from './tex';

const AMBER = 0xffb040,
  SPARK = 0xff7a20,
  DONE = 0x2c7a2c,
  OFF = 0x1a0d00,
  SHUT = 0xd20f39,
  OPEN = 0x40a02b,
  DEAD = 0x222222;
const FAULT_LIGHTS = 3; // real lights for open faults: the nearest three to the guard get one each, flickering like a short

// A mesh in a kit model as traverse() hands it over, once isMesh has said it is one.
type KitMesh<M extends THREE.Material = THREE.Material> = THREE.Mesh<THREE.BufferGeometry, M>;

function box(w: number, h: number, d: number, color: THREE.ColorRepresentation): THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
  m.castShadow = m.receiveShadow = true;
  return m;
}
const lampMat = (): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: OFF });
const placed: THREE.Group[] = []; // every usable's group
// A door button: its group, its lamp, and the model's button with where it rests, once the model is in.
interface Panel {
  g: THREE.Group;
  lamp: THREE.MeshBasicMaterial;
  button: THREE.Object3D | null;
  rest: number;
}
// A booth door's shutter: its group, the height it drops from, and how far down it is, 0 to 1.
interface Shutter {
  g: THREE.Group;
  h: number;
  at: number;
}

// A group standing at one of map.ts's wall things, turned to face out of the wall.
// room: which room it is in, so it can be skipped when that room is out of sight.
function mount(scene: THREE.Scene, name: string, at: Point & { face: number; room?: number }, y: number): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.userData.room = at.room ?? roomAt(at.x + Math.sin(at.face) * 0.3, at.z + Math.cos(at.face) * 0.3);
  g.position.set(at.x, y, at.z);
  g.rotation.y = at.face;
  scene.add(g);
  placed.push(g);
  return g;
}
// Swap a stand-in for a kit model. Meshes in `status_glow` get the given unlit material.
// big: it is large enough to cast a shadow. Returns the model, or null.
async function upgrade(group: THREE.Object3D, name: string, lamp?: THREE.Material | null, big?: boolean): Promise<THREE.Object3D | null> {
  const model = await prop(name);
  if (!model) return null;
  group.clear();
  group.add(model);
  if (!big)
    model.traverse(o => {
      o.castShadow = false;
    }); // a small thing's shadow is not worth a second draw
  if (lamp)
    model.traverse(o => {
      if ((o as KitMesh).isMesh && (o as KitMesh).material.name === 'status_glow') {
        (o as KitMesh).material = lamp;
        o.castShadow = false;
      }
    });
  return model;
}

// The floor plan on the booth wall: a dot for every guard and every mascot
// on the move, a red lamp for every open fault. It needs the power.
function wallMap(scene: THREE.Scene): (S: State, t: number) => void {
  const W = 820,
    H = 380,
    k = 8.2,
    ox = 14,
    oy = 9,
    c = canvas(W, H),
    tex = new THREE.CanvasTexture(c.canvas);
  // The model's UVs are glTF's, which run the other way up from a plane's: it gets an unflipped copy of the same canvas.
  const glbTex = new THREE.CanvasTexture(c.canvas);
  glbTex.flipY = false;
  tex.colorSpace = glbTex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.MeshBasicMaterial({ map: tex }),
    glbFace = new THREE.MeshBasicMaterial({ map: glbTex }),
    g = mount(scene, 'wall map', WALL_MAP, 1.6);
  const plain = new THREE.Mesh(new THREE.PlaneGeometry(1.64, 0.76), face);
  plain.position.z = 0.03;
  g.add(plain);
  upgrade(g, 'wall_map').then(model =>
    model?.traverse(o => {
      if ((o as KitMesh).isMesh && (o as KitMesh).material.name === 'map') (o as KitMesh).material = glbFace;
    })
  );
  let next = 0;
  return (S, t) => {
    if (t < next) return;
    next = t + 0.5;
    c.fillStyle = '#070b08';
    c.fillRect(0, 0, W, H);
    if (lightsF(S)) {
      c.save();
      c.translate(ox, oy);
      c.strokeStyle = '#3d7a4c';
      c.lineWidth = 2;
      for (const room of ROOMS3)
        for (const [x0, z0, x1, z1] of room.rects) {
          c.fillStyle = '#12261a';
          c.fillRect(x0 * k, z0 * k, (x1 - x0) * k, (z1 - z0) * k);
          c.strokeRect(x0 * k, z0 * k, (x1 - x0) * k, (z1 - z0) * k);
        }
      for (const d of DOORWAYS) {
        c.fillStyle = d.key && S.doors[d.key] ? '#c0392b' : '#12261a';
        c.fillRect(d.rect[0] * k - 1, d.rect[1] * k - 1, (d.rect[2] - d.rect[0]) * k + 2, (d.rect[3] - d.rect[1]) * k + 2);
      }
      BOXES.forEach((cl, i) => {
        c.fillStyle = S.faults?.[i] ? (t % 1 < 0.5 ? '#f38ba8' : '#f9e2af') : '#3d7a4c';
        c.beginPath();
        c.arc(cl.x * k, cl.z * k, S.faults?.[i] ? 7 : 4, 0, 7);
        c.fill();
      });
      for (const m of S.m)
        if (m.st !== 'rest') {
          c.fillStyle = MASC[m.i].col;
          c.beginPath();
          c.arc(m.x * k, m.z * k, 8, 0, 7);
          c.fill();
          c.strokeStyle = '#f38ba8';
          c.stroke();
        }
      for (const p of S.players)
        if (isPlaced(p)) {
          c.fillStyle = p.flat ? '#6c7086' : '#a6e3a1';
          c.fillRect(p.x * k - 4, p.z * k - 4, 8, 8);
        }
      c.restore();
      // the legend, in the space the plan leaves
      const out = S.m.filter(m => m.st !== 'rest').length,
        due = BOXES.filter((_, i) => S.faults?.[i]);
      c.fillStyle = '#3d7a4c';
      c.font = 'bold 30px monospace';
      c.fillText('MASCOT DEPOT', 400, 44);
      c.font = '20px monospace';
      c.fillStyle = '#7fbf8a';
      c.fillText(`POWER    ${Math.ceil(S.power)}%`, 400, 86);
      c.fillText(`OFF MARK ${out} of ${S.m.length}`, 400, 114);
      c.fillStyle = due.length ? '#f38ba8' : '#7fbf8a';
      c.fillText(due.length ? 'FAULTS' : 'NO FAULTS', 400, 160);
      due.forEach((cl, i) => {
        c.fillText(`  ${roomData(cl.room).name}`, 400 + (i > 6 ? 200 : 0), 188 + (i % 7) * 26);
      });
    }
    tex.needsUpdate = glbTex.needsUpdate = true;
  };
}

export function createUsables(scene: THREE.Scene): {
  parts: WorldParts;
  update(S: State, t: number, dt: number, camera: THREE.Camera, inView: Set<number>): void;
} {
  // Breaker boxes: a grey cabinet with a status lamp on top and its door hanging open while it has a fault, sparks
  // spitting out of it. Seen from down a corridor by the light it throws.
  const sparkMat = new THREE.SpriteMaterial({ color: SPARK, blending: THREE.AdditiveBlending, depthWrite: false, map: haloTexture() });
  const boxes = BOXES.map((cl, i) => {
    const g = mount(scene, 'breaker box', cl, 1.3),
      lamp = lampMat(),
      body = box(0.5, 0.7, 0.16, 0x5a5f66),
      bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), lamp);
    const door = new THREE.Group(),
      slab = box(0.48, 0.68, 0.03, 0x6b7078);
    slab.position.x = 0.24;
    door.add(slab);
    door.position.set(-0.25, 0, 0.17);
    body.position.z = 0.08;
    bulb.position.set(0, 0.42, 0.1);
    g.add(body, bulb, door);
    const sparks = Array.from({ length: 3 }, () => {
      const s = new THREE.Sprite(sparkMat);
      s.scale.setScalar(0.25);
      s.position.set(0, 0, 0.25);
      s.visible = false;
      g.add(s);
      return s;
    });
    return { i, g, lamp, door, sparks, at: new THREE.Vector3(cl.x + Math.sin(cl.face) * 0.5, 1.4, cl.z + Math.cos(cl.face) * 0.5) };
  });
  const faultLights = Array.from({ length: FAULT_LIGHTS }, () => {
    const l = new THREE.PointLight(SPARK, 0, 9, 1.6);
    scene.add(l);
    return l;
  });

  const panel = (k: DoorKey): Panel => {
    const g = mount(scene, 'door button', PANELS[k], 1.3),
      lamp = lampMat(),
      body = box(0.25, 0.4, 0.1, 0x3b3f4a),
      btn = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 16), lamp);
    body.position.z = 0.05;
    btn.rotation.x = Math.PI / 2;
    btn.position.z = 0.12;
    g.add(body, btn);
    const p: Panel = { g, lamp, button: null, rest: 0 };
    upgrade(g, 'door_panel', lamp).then(model => {
      p.button = model?.getObjectByName('button') || null;
      p.rest = p.button?.position.z || 0;
    });
    return p;
  };
  // made in the order of DOORS
  const panels: Record<DoorKey, Panel> = { L: panel('L'), V: panel('V'), R: panel('R') };

  const gen = mount(scene, 'generator', GENERATOR, floorY(GENERATOR.x, GENERATOR.z)),
    genBody = box(1.4, 1, 0.8, 0x7a5c2e);
  let crank: THREE.Object3D = box(0.08, 0.5, 0.08, 0xc8c8c8);
  // GENERATOR is where a guard stands to crank it; the machine is behind that point.
  genBody.position.set(0, 0.5, -GEN_BACK);
  crank.position.set(0, 0.7, 0.45 - GEN_BACK);
  gen.add(genBody, crank);
  upgrade(gen, 'generator', null, true).then(model => {
    if (model) {
      model.position.z = -GEN_BACK;
      crank = model.getObjectByName('crank') || crank;
    }
  });

  const dockLamp = lampMat(),
    dock = mount(scene, 'charger', CHARGER, 1.2),
    dockBody = box(0.6, 0.4, 0.15, 0x2f4f6f);
  dockBody.position.z = 0.08;
  dock.add(dockBody);
  upgrade(dock, 'charger_dock', dockLamp);

  // Batteries have to be found in the dark, so each sits in a faint pulse of its own label's yellow.
  const halo = new THREE.SpriteMaterial({ color: 0xf9e2af, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5, map: haloTexture() });
  const bats = BATTERY_SPOTS.map(s => {
    const g = new THREE.Group(),
      body = box(0.12, 0.16, 0.12, 0xf9e2af),
      glow = new THREE.Sprite(halo);
    body.material.emissive.setHex(0x7a6a20);
    body.position.y = 0.08;
    glow.scale.setScalar(0.7);
    glow.position.y = 0.1;
    const spin = new THREE.Group();
    spin.add(body);
    g.add(spin, glow);
    g.name = 'battery';
    g.position.set(s.x, 0, s.z);
    g.visible = false;
    scene.add(g);
    upgrade(spin, 'battery').then(model =>
      model?.traverse(o => {
        if ((o as KitMesh<THREE.MeshStandardMaterial>).isMesh) {
          (o as KitMesh<THREE.MeshStandardMaterial>).material = (o as KitMesh<THREE.MeshStandardMaterial>).material.clone();
          (o as KitMesh<THREE.MeshStandardMaterial>).material.emissive.setHex(0x3a3010);
          (o as KitMesh<THREE.MeshStandardMaterial>).material.emissiveMap = (o as KitMesh<THREE.MeshStandardMaterial>).material.map;
        }
      })
    );
    return { g, spin, room: roomAt(s.x, s.z), base: floorY(s.x, s.z) + 0.2 };
  });

  // The booth's doors: shutters that drop from above the doorway.
  const shutter = (k: DoorKey): Shutter => {
    const d = DOORWAYS.find(w => w.key === k);
    if (!d) throw new Error(`door ${k} has no doorway`);
    const [x0, z0, x1, z1] = d.rect,
      h = d.h || DOOR_H,
      wide = d.axis === 'x' ? z1 - z0 : x1 - x0;
    const g = new THREE.Group(),
      slab = box(wide, h, 0.16, 0x565a66);
    slab.position.y = h / 2;
    g.add(slab);
    g.name = 'booth door';
    g.position.set((x0 + x1) / 2, h, (z0 + z1) / 2);
    // the model's clawed face looks out of the booth
    const out = d.a === BOOTH ? 1 : -1;
    g.rotation.y = d.axis === 'x' ? (out * Math.PI) / 2 : out > 0 ? 0 : Math.PI;
    scene.add(g);
    upgrade(g, 'booth_door', null, true).then(model => model?.scale.set(wide / 2.6, h / 3, 1));
    return { g, h, at: 0 };
  };
  // made in the order DOORWAYS lists them
  const doors: Record<DoorKey, Shutter> = { V: shutter('V'), L: shutter('L'), R: shutter('R') };

  // the boxes, nearest the camera first as of the last frame
  const updateMap = wallMap(scene),
    order = boxes.slice();
  return {
    // The groups that can be outlined (outline.ts), by what a guard would use them for.
    parts: {
      boxes: boxes.map(b => b.g),
      bats: bats.map(b => b.g),
      gen,
      dock,
      panels: { L: panels.L.g, V: panels.V.g, R: panels.R.g },
    },
    // inView: the rooms that might be seen from the camera (sight.ts).
    update(S: State, t: number, dt: number, camera: THREE.Camera, inView: Set<number>): void {
      updateMap(S, t);
      for (const g of placed) g.visible = inView.has(g.userData.room);
      const pulse = 0.6 + 0.4 * Math.sin(t * 6);
      // A short: bursts of light at random, never steady.
      const crackle = (i: number): number => (Math.sin(t * 37 + i * 9.1) * Math.sin(t * 23.7 + i * 3.3) > 0.2 ? 1 : 0.15) * (0.7 + 0.3 * Math.sin(t * 90 + i));
      boxes.forEach((c, i) => {
        const f = S.faults?.[i];
        c.lamp.color.setHex(f ? (pulse > 0.6 ? 0xff2020 : AMBER) : S.power > 0 ? DONE : OFF);
        c.door.rotation.y += ((f ? -1.6 : 0) - c.door.rotation.y) * Math.min(1, dt * 8);
        c.sparks.forEach((s, k) => {
          s.visible = !!f && crackle(i * 3 + k) > 0.5;
          if (s.visible) s.position.set(Math.sin(t * 17 + k * 2) * 0.18, Math.cos(t * 13 + k * 5) * 0.25, 0.2 + k * 0.03);
        });
      });
      order.sort((a, b) => a.at.distanceToSquared(camera.position) - b.at.distanceToSquared(camera.position));
      const open = order.filter(b => S.faults?.[b.i]);
      faultLights.forEach((l, k) => {
        const b = open[k];
        l.intensity = b ? 2.2 * crackle(b.i) : 0;
        if (b) l.position.copy(b.at);
      });
      for (const k of DOORS) {
        const p = panels[k],
          shut = !!S.doors[k];
        p.lamp.color.setHex(S.power <= 0 ? DEAD : shut ? SHUT : OPEN);
        if (p.button) p.button.position.z = p.rest - (shut ? 0.012 : 0);
        const d = doors[k];
        d.at += ((shut ? 1 : 0) - d.at) * Math.min(1, dt * 12);
        d.g.position.y = d.h * (1 - d.at);
        d.g.visible = d.at > 0.01 && inView.has(BOOTH);
      }
      dockLamp.color.setHex(S.power > 0 ? OPEN : DEAD);
      halo.opacity = 0.35 + 0.25 * Math.sin(t * 3);
      bats.forEach((b, i) => {
        b.g.visible = inView.has(b.room) && !!S.bats?.includes(i);
        b.spin.rotation.y = t * 1.5;
        b.g.position.y = b.base + Math.sin(t * 2 + i) * 0.04;
      });
      if (S.crank) crank.rotation.z = t * 7;
    },
  };
}

function haloTexture(): THREE.CanvasTexture {
  const c = canvas(64),
    g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, '#fff');
  g.addColorStop(0.3, '#555');
  g.addColorStop(1, '#000');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c.canvas);
}
