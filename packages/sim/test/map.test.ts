// The building's geometry, checked against the plan at the top of src/map.ts: which room a point is in, where a body
// fits, what a line of sight or an arm crosses, and how routes go round shut doors and the ducts. The expected values
// are worked out by hand from ROOMS3 and DOORWAYS, so a change to the building that breaks one is worth a look.
import { describe, expect, it } from 'vitest';
import { defined } from '../src/check.ts';
import * as M from '../src/map.ts';
import type { Doors, Point } from '../src/types.ts';

const OPEN: Doors = { L: false, V: false, R: false };
const ALL_SHUT: Doors = { L: true, V: true, R: true };
const L_SHUT: Doors = { L: true, V: false, R: false };
const rooms = (path: Point[]) => path.map(p => M.roomAt(p.x, p.z));

describe('rooms', () => {
  it('has the ten rooms of the plan, with the booth and the ducts where the constants say', () => {
    expect(M.ROOMS3.map(r => r.name)).toEqual([
      'Storage Stage',
      'Backstage',
      'Arcade',
      'Main Hall',
      'Kitchen',
      'West Hall',
      'Snack Bar',
      'East Hall',
      'Ducts',
      'Security Booth',
    ]);
    expect(M.ROOMS3[M.BOOTH]?.name).toBe('Security Booth');
    expect(M.ROOMS3[M.DUCTS]?.name).toBe('Ducts');
  });

  it('finds the room a point is in', () => {
    expect(M.roomAt(21, 40.5)).toBe(M.BOOTH);
    expect(M.roomAt(5, 15)).toBe(2); // Arcade
    expect(M.roomAt(35, 5)).toBe(1); // Backstage
    expect(M.roomAt(20, 34.75)).toBe(M.DUCTS);
    // The halls are two rects each: down the side, and along the bottom to the booth.
    expect(M.roomAt(4, 30)).toBe(5);
    expect(M.roomAt(10, 40)).toBe(5);
    expect(M.roomAt(30, 40)).toBe(7);
    expect(M.roomAt(-5, -5)).toBe(-1);
  });

  it('counts a doorway as the room on its a side, and a rect edge as inside', () => {
    expect(M.roomAt(14.75, 40.5)).toBe(5); // door L: a is West Hall
    expect(M.roomAt(27.25, 40.5)).toBe(M.BOOTH); // door R: a is the booth
    expect(M.roomAt(27, 5)).toBe(0); // the Stage's east edge, and the Backstage doorway
  });

  it('puts a room centre in the middle of its first rect', () => {
    expect(M.roomCentre(M.BOOTH)).toEqual({ x: 21, z: 40.25 });
    expect(M.roomCentre(5)).toEqual({ x: 4, z: 34 });
  });
});

describe('walkable', () => {
  it('fits a body inside a room only as far as its radius from the walls', () => {
    // The Stage starts at x 10. over: true leaves the furniture out of it.
    expect(M.walkable(10.2, 5, 0.1, null, true)).toBe(true);
    expect(M.walkable(10.2, 5, M.PLAYER_R, null, true)).toBe(false);
    expect(M.walkable(-1, 5, 0.1, null, true)).toBe(false);
    expect(M.walkable(21, 45, 0.1, null, true)).toBe(false);
  });

  it('has no floor inside a wall, but does in a doorway', () => {
    // The wall between the Main Hall (to z 25) and the Snack Bar (from z 25.5), away from and in a doorway.
    expect(M.walkable(24, 25.25, 0.1, null, true)).toBe(false);
    expect(M.walkable(19.3, 25.25, M.PLAYER_R, null, true)).toBe(true);
  });

  it('closes a booth doorway when its door is shut', () => {
    expect(M.walkable(14.75, 40.5, M.PLAYER_R, OPEN, true)).toBe(true);
    expect(M.walkable(14.75, 40.5, M.PLAYER_R, L_SHUT, true)).toBe(false);
    expect(M.walkable(14.75, 40.5, M.PLAYER_R, { L: false, V: true, R: true }, true)).toBe(true);
  });

  it('keeps bodies out of furniture unless asked to ignore it', () => {
    const [x0, z0, x1, z1] = defined(
        M.OBSTACLES.find(([x0, z0, x1, z1]) => M.roomAt((x0 + x1) / 2, (z0 + z1) / 2) >= 0),
        'an obstacle standing in a room'
      ),
      x = (x0 + x1) / 2,
      z = (z0 + z1) / 2;
    expect(M.walkable(x, z, 0.1)).toBe(false);
    expect(M.walkable(x, z, 0.1, null, true)).toBe(true);
  });

  it('places the guards in the booth, four to a row', () => {
    expect(M.spawnPoint(0)).toEqual({ x: 18.5, z: 41.5, yaw: Math.PI });
    expect(M.spawnPoint(5)).toEqual({ x: 20.1, z: 40.1, yaw: Math.PI });
    for (let i = 0; i < 8; i++) expect(M.roomAt(M.spawnPoint(i).x, M.spawnPoint(i).z)).toBe(M.BOOTH);
  });
});

describe('sight lines', () => {
  it('crosses an open room, not a wall', () => {
    expect(M.reaches(12, 2, 25, 2)).toBe(true);
    expect(M.reaches(24, 20, 24, 30)).toBe(false); // Main Hall to Snack Bar, through the wall
    expect(M.reaches(19.3, 20, 19.3, 30)).toBe(true); // the same, through their doorway
  });

  it('is cut by a shut booth door', () => {
    expect(M.reaches(13, 40.5, 17, 40.5, OPEN)).toBe(true);
    expect(M.reaches(13, 40.5, 17, 40.5, L_SHUT)).toBe(false);
    expect(M.glimpses(13, 40.5, 17, 40.5, M.PLAYER_R, L_SHUT)).toBe(false);
  });

  it('is cut by furniture for the eye but not for an arm', () => {
    // A line through the middle of an obstacle, from clear floor on one side to clear floor on the other.
    const [ax, z, bx] = defined(
      M.OBSTACLES.map(([x0, z0, x1, z1]) => {
        const z = (z0 + z1) / 2;
        return [x0 - 0.3, z, x1 + 0.3, z] as const;
      }).find(([ax, z, bx]) => M.roomAt(ax, z) >= 0 && M.roomAt(ax, z) === M.roomAt(bx, z) && M.walkable(ax, z, 0.1) && M.walkable(bx, z, 0.1)),
      'an obstacle with clear floor either side'
    );
    expect(M.sees(ax, z, bx, z)).toBe(false);
    expect(M.reaches(ax, z, bx, z)).toBe(true);
    expect(M.glimpses(ax, z, bx, z, M.MASCOT_R)).toBe(true);
  });
});

describe('slide', () => {
  it('stops a body at the wall and says how far it got', () => {
    // East across West Hall's upper stretch (x 2 to 6): the wall stops the body within a step (r / 2) of 6 - r.
    const p = { x: 4, z: 34 };
    const got = M.slide(p, 4, 0, M.PLAYER_R, OPEN);
    expect(p.z).toBe(34);
    expect(p.x).toBeLessThanOrEqual(6 - M.PLAYER_R);
    expect(p.x).toBeGreaterThan(6 - M.PLAYER_R - M.PLAYER_R / 2);
    expect(got).toBeCloseTo((p.x - 4) / 4, 10);
    expect(M.slide(p, 0, 0, M.PLAYER_R)).toBe(1);
  });

  it('goes all the way through an open doorway', () => {
    // Main Hall to Snack Bar, through their doorway (x 18 to 20.6).
    const p = { x: 19.3, z: 20 };
    expect(M.slide(p, 0, 8, M.PLAYER_R, OPEN)).toBeCloseTo(1, 10);
    expect(p.z).toBeCloseTo(28, 10);
    expect(M.roomAt(p.x, p.z)).toBe(6);
  });
});

describe('walls', () => {
  it('puts one lintel over each doorway on each side, as wide as the doorway and from its height up', () => {
    // A lintel as room, the doorway's span along the wall, and its bottom.
    const lintels = M.walls()
      .filter(w => w.y0 > 0)
      .map(w => [w.room, ...(w.nz ? [w.x0, w.x1] : [w.z0, w.z1]), w.y0].join(' '));
    const doorways = M.DOORWAYS.flatMap(d =>
      [d.a, d.b].map(room => [room, ...(d.axis === 'z' ? [d.rect[0], d.rect[2]] : [d.rect[1], d.rect[3]]), d.h ?? M.DOOR_H].join(' '))
    );
    expect(lintels.sort()).toEqual(doorways.sort());
  });

  it('keeps each doorway with its own span when an earlier doorway in the same line misses the edge', () => {
    // Room 0's edge z = 10 from x = 0 to 10. The first doorway sits in that line but past the edge's end; the second
    // is in the edge. Pairing by index would give the first doorway the second one's span.
    const outside: M.Doorway = { a: 0, b: 1, rect: [20, 10, 22, 10.5], axis: 'z', h: 3 };
    const inside: M.Doorway = { a: 0, b: 2, rect: [4, 10, 6, 10.5], axis: 'z', h: 2 };
    expect(M.edgeDoors([outside, inside], 0, true, 10, 0, 10)).toEqual([{ d: inside, span: [4, 6] }]);
  });
});

describe('waypoints', () => {
  const { nodes, links } = M.nav();
  const node = (i: number) => defined(nodes[i], `waypoint ${i}`);

  it('joins every waypoint both ways, by the straight distance', () => {
    links.forEach((ls, i) => {
      for (const l of ls) {
        const a = node(i),
          b = node(l.to);
        expect(l.d).toBeCloseTo(Math.hypot(a.x - b.x, a.z - b.z), 10);
        expect(links[l.to]?.some(back => back.to === i && back.d === l.d && back.key === l.key && back.duct === l.duct)).toBe(true);
      }
    });
  });

  it('puts a waypoint on each side of every doorway, in the rooms it joins', () => {
    for (const d of M.DOORWAYS) {
      const pair = nodes.filter(n => n.door === d);
      expect(pair).toHaveLength(2);
      expect(pair.map(n => n.room).sort()).toEqual([d.a, d.b].sort());
    }
  });

  it('keys only the links through the booth doors, and marks the ducts', () => {
    for (const k of ['L', 'V', 'R'] as const) expect(links.flat().filter(l => l.key === k)).toHaveLength(2); // one each way
    links.forEach((ls, i) => {
      for (const l of ls) {
        const ducts = node(i).room === M.DUCTS || node(l.to).room === M.DUCTS;
        expect(l.duct).toBe(ducts);
      }
    });
  });
});

describe('routes', () => {
  it('goes straight when the line is clear', () => {
    expect(M.route(12, 2, 14, 2, { r: 0.1 }).path).toEqual([{ x: 14, z: 2 }]);
  });

  it('walks legs a body of its radius fits along, and ends at the goal', () => {
    const r = M.PLAYER_R,
      start = M.spawnPoint(0),
      goal = M.roomCentre(0);
    const { path, blocked } = M.route(start.x, start.z, goal.x, goal.z, { r });
    expect(blocked).toBeUndefined();
    expect(path.at(-1)).toEqual(goal);
    let from: Point = start;
    for (const p of path) {
      expect(M.clear(from.x, from.z, p.x, p.z, r)).toBe(true);
      from = p;
    }
  });

  it('stops at the near side of the first shut door when every way out is shut', () => {
    const { path, blocked } = M.route(21, 40.5, 5, 40.5, { doors: ALL_SHUT, r: M.PLAYER_R });
    expect(blocked).toBe('L');
    expect(path.length).toBeGreaterThan(0);
    expect(new Set(rooms(path))).toEqual(new Set([M.BOOTH]));
  });

  it('goes the long way round when the near door is shut', () => {
    // Booth to West Hall with L shut: out through R, round by the East Hall, the Kitchen, the Main Hall and the Arcade.
    const { path, blocked } = M.route(21, 40.5, 5, 40.5, { doors: L_SHUT, r: M.PLAYER_R });
    expect(blocked).toBeUndefined();
    expect([...new Set(rooms(path))]).toEqual([7, 4, 3, 2, 5]);
  });

  it('uses the ducts only when allowed to', () => {
    // From the Snack Bar to the booth: down the duct and through the vent, or round by the Kitchen and East Hall.
    expect([...new Set(rooms(M.route(20, 30, 21, 40.5, { ducts: true }).path))]).toEqual([6, M.DUCTS, M.BOOTH]);
    expect([...new Set(rooms(M.route(20, 30, 21, 40.5).path))]).toEqual([6, 4, 7, M.BOOTH]);
  });
});
