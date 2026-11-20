// Checks that the furniture in packages/game/src/three/world/dressing.js has not
// blocked anything the 3D mode needs: doorways, the mascots' waypoints, and
// the way to every breaker box, button, battery and resting mark. Run it after
// moving a prop or anything in map.js:
//   node tools/check-floor.mjs
import { readFileSync, existsSync } from 'node:fs';
import * as M from '../packages/game/src/three/map.js';
import { FOOT, DRESSING } from '../packages/game/src/three/world/dressing.js';

const bad = [],
  warn = [];
const at = p => `(${p.x}, ${p.z})`;
const spawn = M.spawnPoint(0);
const reach = (p, why) => {
  if (!M.route(spawn.x, spawn.z, p.x, p.z, { ducts: true }).path.length) bad.push(`no way from the booth to ${why} at ${at(p)}`);
};

M.ROOMS3.forEach((room, i) =>
  room.rects.forEach(([x0, z0, x1, z1]) => {
    if (!M.walkable((x0 + x1) / 2, (z0 + z1) / 2, M.MASCOT_R)) bad.push(`the middle of ${room.name} is blocked (a waypoint)`);
  })
);
for (const [room, x, z] of M.EXTRA_NODES) if (!M.walkable(x, z, M.MASCOT_R)) bad.push(`waypoint (${x}, ${z}) in ${M.ROOMS3[room].name} is blocked`);
for (const d of M.DOORWAYS) {
  const [x0, z0, x1, z1] = d.rect,
    cx = (x0 + x1) / 2,
    cz = (z0 + z1) / 2,
    out = 1.2;
  const [a, b] =
    d.axis === 'x'
      ? [
          [x0 - out, cz],
          [x1 + out, cz],
        ]
      : [
          [cx, z0 - out],
          [cx, z1 + out],
        ];
  if (!M.clear(a[0], a[1], b[0], b[1], M.MASCOT_R)) bad.push(`the doorway between ${M.ROOMS3[d.a].name} and ${M.ROOMS3[d.b].name} is blocked within ${out} m`);
}
const onWalls = /** @type {[{ x: number, z: number, face: number }, string][]} */ ([
  ...M.BOXES.map((c, i) => [c, `the breaker box in ${M.ROOMS3[c.room].name}`]),
  [M.GENERATOR, 'the generator'],
  [M.CHARGER, 'the charger'],
  [M.WALL_MAP, 'the wall map'],
  ...Object.entries(M.PANELS).map(([k, p]) => [p, `door button ${k}`]),
]);
for (const [c, name] of onWalls) {
  const p = { x: c.x + Math.sin(c.face) * 0.8, z: c.z + Math.cos(c.face) * 0.8 };
  if (!M.walkable(p.x, p.z, M.PLAYER_R)) bad.push(`nowhere to stand in front of ${name}`);
  else reach(p, name);
}
M.HIDES.forEach((h, i) => {
  if (!M.walkable(h.at.x, h.at.z, M.PLAYER_R)) bad.push(`nowhere to stand in front of locker ${i} in ${M.ROOMS3[h.room].name}`);
  else reach(h.at, `locker ${i}`);
});
M.BATTERY_SPOTS.forEach((b, i) => {
  if (!M.walkable(b.x, b.z, M.PLAYER_R)) bad.push(`battery spot ${i} at ${at(b)} is inside something`);
  else reach(b, `battery spot ${i}`);
});
M.REST.forEach((r, i) => {
  if (!M.walkable(r.x, r.z, M.MASCOT_R)) bad.push(`resting mark ${i} at ${at(r)} is blocked`);
  else reach(r, `resting mark ${i}`);
});
for (let i = 0; i < 8; i++) {
  const p = M.spawnPoint(i);
  if (!M.walkable(p.x, p.z, M.PLAYER_R)) bad.push(`spawn point ${i} at ${at(p)} is blocked`);
}

const { nodes, links } = M.nav(),
  seen = new Set([0]),
  queue = [0];
while (queue.length)
  for (const l of links[queue.pop()])
    if (!seen.has(l.to)) {
      seen.add(l.to);
      queue.push(l.to);
    }
nodes.forEach((n, i) => {
  if (!seen.has(i)) bad.push(`waypoint ${at(n)} in ${M.ROOMS3[n.room].name} is cut off`);
});

for (const [x0, z0, x1, z1] of M.OBSTACLES) {
  const inside = M.ROOMS3.some(r => r.rects.some(([a0, b0, a1, b1]) => x0 >= a0 - 0.01 && x1 <= a1 + 0.01 && z0 >= b0 - 0.01 && z1 <= b1 + 0.01));
  if (!inside) warn.push(`obstacle [${[x0, z0, x1, z1].map(v => v.toFixed(2))}] pokes through a wall`);
}
// The footprints here are typed in by hand; compare them with what the kits measured.
// These props measure bigger than FOOT on purpose: the extra is walk-through or overhead.
const LOOSE = { skee_ball: 'tickets on the floor', soda_machine: 'the lead and the puddle', spare_heads: 'the top head, 2.3 m up' };
const sizes = {};
let built = 0;
for (const kit of ['props_a', 'props_b']) {
  const f = new URL(`../packages/game/public/models/${kit}.json`, import.meta.url);
  if (existsSync(f)) {
    built++;
    Object.assign(sizes, JSON.parse(readFileSync(f, 'utf8')).props);
  } else warn.push(`${kit}.json is not built yet, so its props are unchecked`);
}
for (const name in FOOT)
  if (sizes[name] && !LOOSE[name]) {
    const [w, , d] = sizes[name].size;
    if (Math.abs(w - FOOT[name][0]) > 0.2 || Math.abs(d - FOOT[name][1]) > 0.2) warn.push(`${name}: FOOT says ${FOOT[name]}, the kit says ${[w, d]}`);
  }
if (built === 2) for (const name of new Set(DRESSING.flat().map(row => row[0]))) if (!sizes[name]) warn.push(`${name} is placed but is in neither kit`);

for (const w of warn) console.log('warning:', w);
for (const b of bad) console.log('BLOCKED:', b);
console.log(`${M.OBSTACLES.length} obstacles, ${nodes.length} waypoints, ${bad.length} problems`);
process.exit(bad.length ? 1 : 0);
