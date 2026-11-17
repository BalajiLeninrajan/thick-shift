// The things a guard uses: watchman's clocks, door buttons, the generator,
// the charger, spare batteries, the booth's three doors and its wall map.
// Each starts as a plain stand-in and is swapped for its model from the prop
// kit when that arrives; if it never does, the stand-ins are the game.
import * as THREE from 'three';
import { MASC, DOORS } from '../../config.js';
import { ROOMS3, DOORWAYS, CLOCKS, GENERATOR, CHARGER, WALL_MAP, PANELS, BATTERY_SPOTS, DOOR_H, BOOTH, roomAt } from '../map.js';
import { lightsF } from '../sim3d.js';
import { floorY } from './shell.js';
import { canvas } from './tex.js';
import { prop } from './props.js';
import { GEN_BACK } from './dressing.js';

const AMBER = 0xffb040, DONE = 0x2c7a2c, OFF = 0x1a0d00, SHUT = 0xd20f39, OPEN = 0x40a02b, DEAD = 0x222222;
const DUE_LIGHTS = 2;   // real lights for clocks that are due: the nearest two to the guard get one each

function box(w, h, d, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: .7 }));
  m.castShadow = m.receiveShadow = true;
  return m;
}
const lampMat = () => new THREE.MeshBasicMaterial({ color: OFF });
const placed = [];   // every usable's group
// A group standing at one of map.js's wall things, turned to face out of the wall.
// room: which room it is in, so it can be skipped when that room is out of sight.
function mount(scene, name, at, y) { const g = new THREE.Group(); g.name = name; g.userData.room = at.room ?? roomAt(at.x + Math.sin(at.face) * .3, at.z + Math.cos(at.face) * .3); g.position.set(at.x, y, at.z); g.rotation.y = at.face; scene.add(g); placed.push(g); return g; }
// Swap a stand-in for a kit model. Meshes in `status_glow` get the given unlit material.
// big: it is large enough to cast a shadow. Returns the model, or null.
async function upgrade(group, name, lamp, big) {
  const model = await prop(name);
  if (!model) return null;
  group.clear(); group.add(model);
  if (!big) model.traverse(o => { o.castShadow = false; });   // a clock's shadow is not worth a second draw
  if (lamp) model.traverse(o => { if (o.isMesh && o.material.name === 'status_glow') { o.material = lamp; o.castShadow = false; } });
  return model;
}

// The floor plan on the booth wall: a dot for every guard and every mascot
// on the move, a lamp for every clock that is due. It needs the power.
function wallMap(scene) {
  const W = 820, H = 380, k = 8.2, ox = 14, oy = 9, c = canvas(W, H), tex = new THREE.CanvasTexture(c.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.MeshBasicMaterial({ map: tex }), g = mount(scene, 'wall map', WALL_MAP, 1.6);
  const plain = new THREE.Mesh(new THREE.PlaneGeometry(1.64, .76), face); plain.position.z = .03; g.add(plain);
  upgrade(g, 'wall_map').then(model => model?.traverse(o => { if (o.isMesh && o.material.name === 'map') o.material = face; }));
  let next = 0;
  return (S, t) => {
    if (t < next) return;
    next = t + .5;
    c.fillStyle = '#070b08'; c.fillRect(0, 0, W, H);
    if (lightsF(S)) {
      c.save(); c.translate(ox, oy);
      c.strokeStyle = '#3d7a4c'; c.lineWidth = 2;
      for (const room of ROOMS3) for (const [x0, z0, x1, z1] of room.rects) { c.fillStyle = '#12261a'; c.fillRect(x0 * k, z0 * k, (x1 - x0) * k, (z1 - z0) * k); c.strokeRect(x0 * k, z0 * k, (x1 - x0) * k, (z1 - z0) * k); }
      for (const d of DOORWAYS) { c.fillStyle = d.key && S.doors[d.key] ? '#c0392b' : '#12261a'; c.fillRect(d.rect[0] * k - 1, d.rect[1] * k - 1, (d.rect[2] - d.rect[0]) * k + 2, (d.rect[3] - d.rect[1]) * k + 2); }
      CLOCKS.forEach((cl, i) => { if (S.clocks?.[i]) { c.fillStyle = S.clocks[i] === 1 ? '#f9e2af' : '#3d7a4c'; c.beginPath(); c.arc(cl.x * k, cl.z * k, 5, 0, 7); c.fill(); } });
      for (const m of S.m) if (m.st !== 'rest') { c.fillStyle = MASC[m.i].col; c.beginPath(); c.arc(m.x * k, m.z * k, 8, 0, 7); c.fill(); c.strokeStyle = '#f38ba8'; c.stroke(); }
      for (const p of S.players) if (p.x != null) { c.fillStyle = p.flat ? '#6c7086' : '#a6e3a1'; c.fillRect(p.x * k - 4, p.z * k - 4, 8, 8); }
      c.restore();
      // the legend, in the space the plan leaves
      const out = S.m.filter(m => m.st !== 'rest').length, due = CLOCKS.filter((_, i) => S.clocks?.[i] === 1);
      c.fillStyle = '#3d7a4c'; c.font = 'bold 30px monospace'; c.fillText('MASCOT DEPOT', 400, 44);
      c.font = '20px monospace'; c.fillStyle = '#7fbf8a';
      c.fillText(`POWER    ${Math.ceil(S.power)}%`, 400, 86); c.fillText(`OFF MARK ${out} of ${S.m.length}`, 400, 114);
      c.fillStyle = '#f9e2af'; c.fillText(due.length ? 'CLOCKS DUE' : 'NO CLOCKS DUE', 400, 160);
      due.forEach((cl, i) => c.fillText('  ' + ROOMS3[cl.room].name, 400 + (i > 6 ? 200 : 0), 188 + (i % 7) * 26));
    }
    tex.needsUpdate = true;
  };
}

export function createUsables(scene) {
  const clocks = CLOCKS.map(cl => {
    const g = mount(scene, 'clock', cl, 1.45), lamp = lampMat(), body = box(.4, .55, .15, 0x6b5a3a), bulb = new THREE.Mesh(new THREE.SphereGeometry(.05, 12, 8), lamp);
    body.position.z = .075; bulb.position.set(0, .34, .1); g.add(body, bulb);
    const c = { lamp, lever: null, at: new THREE.Vector3(cl.x + Math.sin(cl.face) * .35, 1.5, cl.z + Math.cos(cl.face) * .35) };
    upgrade(g, 'time_clock', lamp).then(model => { c.lever = model?.getObjectByName('lever') || null; });
    return c;
  });
  const dueLights = Array.from({ length: DUE_LIGHTS }, () => { const l = new THREE.PointLight(AMBER, 0, 5.5, 2); scene.add(l); return l; });

  const panels = Object.fromEntries(DOORS.map(k => {
    const g = mount(scene, 'door button', PANELS[k], 1.3), lamp = lampMat(), body = box(.25, .4, .1, 0x3b3f4a), btn = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, .05, 16), lamp);
    body.position.z = .05; btn.rotation.x = Math.PI / 2; btn.position.z = .12; g.add(body, btn);
    const p = { lamp, button: null, rest: 0 };
    upgrade(g, 'door_panel', lamp).then(model => { p.button = model?.getObjectByName('button') || null; p.rest = p.button?.position.z || 0; });
    return [k, p];
  }));

  const gen = mount(scene, 'generator', GENERATOR, floorY(GENERATOR.x, GENERATOR.z)), genBody = box(1.4, 1, .8, 0x7a5c2e);
  let crank = box(.08, .5, .08, 0xc8c8c8);
  // GENERATOR is where a guard stands to crank it; the machine is behind that point.
  genBody.position.set(0, .5, -GEN_BACK); crank.position.set(0, .7, .45 - GEN_BACK); gen.add(genBody, crank);
  upgrade(gen, 'generator', null, true).then(model => { if (model) { model.position.z = -GEN_BACK; crank = model.getObjectByName('crank') || crank; } });

  const dockLamp = lampMat(), dock = mount(scene, 'charger', CHARGER, 1.2), dockBody = box(.6, .4, .15, 0x2f4f6f);
  dockBody.position.z = .08; dock.add(dockBody);
  upgrade(dock, 'charger_dock', dockLamp);

  // Batteries have to be found in the dark, so each sits in a faint pulse of its own label's yellow.
  const halo = new THREE.SpriteMaterial({ color: 0xf9e2af, blending: THREE.AdditiveBlending, depthWrite: false, opacity: .5, map: haloTexture() });
  const bats = BATTERY_SPOTS.map(s => {
    const g = new THREE.Group(), body = box(.12, .16, .12, 0xf9e2af), glow = new THREE.Sprite(halo);
    body.material.emissive.setHex(0x7a6a20); body.position.y = .08; glow.scale.setScalar(.7); glow.position.y = .1;
    const spin = new THREE.Group(); spin.add(body); g.add(spin, glow); g.name = 'battery'; g.position.set(s.x, 0, s.z); g.visible = false; scene.add(g);
    upgrade(spin, 'battery').then(model => model?.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.emissive.setHex(0x3a3010); o.material.emissiveMap = o.material.map; } }));
    return { g, spin, room: roomAt(s.x, s.z), base: floorY(s.x, s.z) + .2 };
  });

  // The booth's doors: shutters that drop from above the doorway.
  const doors = Object.fromEntries(DOORWAYS.filter(d => d.key).map(d => {
    const [x0, z0, x1, z1] = d.rect, h = d.h || DOOR_H, wide = d.axis === 'x' ? z1 - z0 : x1 - x0;
    const g = new THREE.Group(), slab = box(wide, h, .16, 0x565a66);
    slab.position.y = h / 2; g.add(slab); g.name = 'booth door'; g.position.set((x0 + x1) / 2, h, (z0 + z1) / 2);
    // the model's clawed face looks out of the booth
    const out = d.a === BOOTH ? 1 : -1; g.rotation.y = d.axis === 'x' ? out * Math.PI / 2 : out > 0 ? 0 : Math.PI;
    scene.add(g);
    upgrade(g, 'booth_door', null, true).then(model => model?.scale.set(wide / 2.6, h / 3, 1));
    return [d.key, { g, h, at: 0 }];
  }));

  const updateMap = wallMap(scene), order = clocks.map((_, i) => i);
  return {
    // inView: the rooms that might be seen from the camera (sight.js).
    update(S, t, dt, camera, inView) {
      updateMap(S, t);
      for (const g of placed) g.visible = inView.has(g.userData.room);
      const pulse = .6 + .4 * Math.sin(t * 6);
      clocks.forEach((c, i) => {
        const state = S.clocks?.[i];
        c.lamp.color.setHex(state === 1 ? AMBER : state === 2 ? DONE : OFF).multiplyScalar(state === 1 ? pulse : 1);
        if (c.lever) c.lever.rotation.x += ((state === 2 ? .7 : 0) - c.lever.rotation.x) * Math.min(1, dt * 10);
      });
      order.sort((a, b) => clocks[a].at.distanceToSquared(camera.position) - clocks[b].at.distanceToSquared(camera.position));
      const due = order.filter(i => S.clocks?.[i] === 1);
      dueLights.forEach((l, k) => { l.intensity = k < due.length ? pulse * 1.6 : 0; if (k < due.length) l.position.copy(clocks[due[k]].at); });
      for (const k of DOORS) {
        const p = panels[k], shut = !!S.doors[k];
        p.lamp.color.setHex(S.power <= 0 ? DEAD : shut ? SHUT : OPEN);
        if (p.button) p.button.position.z = p.rest - (shut ? .012 : 0);
        const d = doors[k]; d.at += ((shut ? 1 : 0) - d.at) * Math.min(1, dt * 12);
        d.g.position.y = d.h * (1 - d.at); d.g.visible = d.at > .01 && inView.has(BOOTH);
      }
      dockLamp.color.setHex(S.power > 0 ? OPEN : DEAD);
      halo.opacity = .35 + .25 * Math.sin(t * 3);
      bats.forEach((b, i) => { b.g.visible = inView.has(b.room) && !!S.bats?.includes(i); b.spin.rotation.y = t * 1.5; b.g.position.y = b.base + Math.sin(t * 2 + i) * .04; });
      if (S.crank) crank.rotation.z = t * 7;
    },
  };
}

function haloTexture() {
  const c = canvas(64), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, '#fff'); g.addColorStop(.3, '#555'); g.addColorStop(1, '#000');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c.canvas);
}
