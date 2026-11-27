// The furniture in src/dressing.ts has not blocked anything the 3D mode needs: doorways, the mascots' waypoints, and
// the way to every breaker box, button, battery and resting mark. Run it (pnpm test) after moving a prop or anything
// in map.ts. Each test lists every problem it finds, so one failure shows them all.
//
// Two checks only warn: an obstacle poking through a wall, and a footprint in FOOT that differs
// from what the model kits measured. They print and do not fail.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defined } from '../src/check.ts';
import { DRESSING, FOOT } from '../src/dressing.ts';
import * as M from '../src/map.ts';
import type { Point } from '../src/types.ts';

const at = (p: Point) => `(${p.x}, ${p.z})`;
const roomName = (i: number) => defined(M.ROOMS3[i], `room ${i}`).name;
const spawn = M.spawnPoint(0);
// Can a guard get from the booth to p, through the ducts if need be?
const reach = (bad: string[], p: Point, why: string) => {
  if (!M.route(spawn.x, spawn.z, p.x, p.z, { ducts: true }).path.length) bad.push(`no way from the booth to ${why} at ${at(p)}`);
};

describe('the floor plan', () => {
  it('leaves every waypoint clear', () => {
    const bad: string[] = [];
    M.ROOMS3.forEach(room => {
      room.rects.forEach(([x0, z0, x1, z1]) => {
        if (!M.walkable((x0 + x1) / 2, (z0 + z1) / 2, M.MASCOT_R)) bad.push(`the middle of ${room.name} is blocked (a waypoint)`);
      });
    });
    for (const [room, x, z] of M.EXTRA_NODES) if (!M.walkable(x, z, M.MASCOT_R)) bad.push(`waypoint (${x}, ${z}) in ${roomName(room)} is blocked`);
    expect(bad).toEqual([]);
  });

  it('leaves every doorway clear for a mascot for 1.2 m either side', () => {
    const bad: string[] = [];
    for (const d of M.DOORWAYS) {
      const [x0, z0, x1, z1] = d.rect,
        cx = (x0 + x1) / 2,
        cz = (z0 + z1) / 2,
        out = 1.2;
      const [a, b]: [[number, number], [number, number]] =
        d.axis === 'x'
          ? [
              [x0 - out, cz],
              [x1 + out, cz],
            ]
          : [
              [cx, z0 - out],
              [cx, z1 + out],
            ];
      if (!M.clear(a[0], a[1], b[0], b[1], M.MASCOT_R)) bad.push(`the doorway between ${roomName(d.a)} and ${roomName(d.b)} is blocked within ${out} m`);
    }
    expect(bad).toEqual([]);
  });

  it('leaves room to stand in front of everything on a wall, and a way there from the booth', () => {
    const bad: string[] = [];
    const onWalls: [Point & { face: number }, string][] = [
      ...M.BOXES.map((c): [Point & { face: number }, string] => [c, `the breaker box in ${roomName(c.room)}`]),
      [M.GENERATOR, 'the generator'],
      [M.CHARGER, 'the charger'],
      [M.WALL_MAP, 'the wall map'],
      [M.DESK, 'the camera desk'],
      ...Object.entries(M.PANELS).map(([k, p]): [Point & { face: number }, string] => [p, `door button ${k}`]),
    ];
    for (const [c, name] of onWalls) {
      const p = { x: c.x + Math.sin(c.face) * 0.8, z: c.z + Math.cos(c.face) * 0.8 };
      if (!M.walkable(p.x, p.z, M.PLAYER_R)) bad.push(`nowhere to stand in front of ${name}`);
      else reach(bad, p, name);
    }
    expect(bad).toEqual([]);
  });

  it('leaves room to stand at every locker, battery spot and spawn point, and every mascot room to rest', () => {
    const bad: string[] = [];
    M.HIDES.forEach((h, i) => {
      if (!M.walkable(h.at.x, h.at.z, M.PLAYER_R)) bad.push(`nowhere to stand in front of locker ${i} in ${roomName(h.room)}`);
      else reach(bad, h.at, `locker ${i}`);
    });
    M.BATTERY_SPOTS.forEach((b, i) => {
      if (!M.walkable(b.x, b.z, M.PLAYER_R)) bad.push(`battery spot ${i} at ${at(b)} is inside something`);
      else reach(bad, b, `battery spot ${i}`);
    });
    M.REST.forEach((r, i) => {
      if (!M.walkable(r.x, r.z, M.MASCOT_R)) bad.push(`resting mark ${i} at ${at(r)} is blocked`);
      else reach(bad, r, `resting mark ${i}`);
    });
    for (let i = 0; i < 8; i++) {
      const p = M.spawnPoint(i);
      if (!M.walkable(p.x, p.z, M.PLAYER_R)) bad.push(`spawn point ${i} at ${at(p)} is blocked`);
    }
    expect(bad).toEqual([]);
  });

  it('cuts no waypoint off from the rest', () => {
    const { nodes, links } = M.nav(),
      seen = new Set([0]),
      queue = [0];
    for (let i = queue.pop(); i !== undefined; i = queue.pop())
      for (const l of defined(links[i], `waypoint ${i}'s links`))
        if (!seen.has(l.to)) {
          seen.add(l.to);
          queue.push(l.to);
        }
    const bad = nodes.flatMap((n, i) => (seen.has(i) ? [] : [`waypoint ${at(n)} in ${roomName(n.room)} is cut off`]));
    expect(bad).toEqual([]);
  });

  it('warns about obstacles through walls and footprints that differ from the kits', () => {
    const warn: string[] = [];
    for (const [x0, z0, x1, z1] of M.OBSTACLES) {
      const inside = M.ROOMS3.some(r => r.rects.some(([a0, b0, a1, b1]) => x0 >= a0 - 0.01 && x1 <= a1 + 0.01 && z0 >= b0 - 0.01 && z1 <= b1 + 0.01));
      if (!inside) warn.push(`obstacle [${[x0, z0, x1, z1].map(v => v.toFixed(2))}] pokes through a wall`);
    }
    // The footprints here are typed in by hand; compare them with what the kits measured.
    // These props measure bigger than FOOT on purpose: the extra is walk-through or overhead.
    const LOOSE: Record<string, string> = { skee_ball: 'tickets on the floor', soda_machine: 'the lead and the puddle', spare_heads: 'the top head, 2.3 m up' };
    const sizes: Record<string, { size: [w: number, h: number, d: number] }> = {};
    let built = 0;
    for (const kit of ['props_a', 'props_b']) {
      const f = new URL(`../../game/public/models/${kit}.json`, import.meta.url);
      if (existsSync(f)) {
        built++;
        Object.assign(sizes, (JSON.parse(readFileSync(f, 'utf8')) as { props: typeof sizes }).props);
      } else warn.push(`${kit}.json is not built yet, so its props are unchecked`);
    }
    for (const [name, foot] of Object.entries(FOOT)) {
      const kit = sizes[name];
      if (kit && !LOOSE[name]) {
        const [w, , d] = kit.size;
        if (Math.abs(w - foot[0]) > 0.2 || Math.abs(d - foot[1]) > 0.2) warn.push(`${name}: FOOT says ${foot}, the kit says ${[w, d]}`);
      }
    }
    if (built === 2) for (const name of new Set(DRESSING.flat().map(row => row[0]))) if (!sizes[name]) warn.push(`${name} is placed but is in neither kit`);
    for (const w of warn) console.warn('warning:', w);
  });
});
