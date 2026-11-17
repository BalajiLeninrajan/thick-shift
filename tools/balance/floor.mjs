#!/usr/bin/env node
// Plays the 3D mode ("the floor") thousands of times with scripted guards and
// prints what happened. The numbers in public/src/three/sim3d.js were tuned
// against this table.
//
//   node tools/balance/floor.mjs                 every scenario, 40 seeds each
//   node tools/balance/floor.mjs --seeds 200     more seeds
//   node tools/balance/floor.mjs --only turtle,solo   scenarios whose name contains one of these
//   node tools/balance/floor.mjs --deaths        also list how each guard was flattened
//   node tools/balance/floor.mjs --trace "solo competent n1" --seed 3   one night's events (--steps adds where everyone is each second)
//
// It exits non-zero if an assertion fails: a softlock (a mascot wedged on
// geometry, a clock nobody can reach, a night that does not end), or a
// strategy that should lose doing as well as playing properly.
//
// The guards only know what a person could: what is in front of them and lit,
// what is close enough to hear, the HUD, the wall map while they stand in the
// booth, and what a flat teammate shouts. They walk with the same route() and
// slide() the game uses, at the game's speeds, and react late.
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { cpus } from 'node:os';

let now = 0;
globalThis.performance = { now: () => now };
process.removeAllListeners('warning');   // the repo's package.json does not say its modules are ES modules; Node works it out
const src = new URL('../../public/src/', import.meta.url);
const { game } = await import(new URL('state.js', src));
const { newState } = await import(new URL('sim.js', src));
const { MASC } = await import(new URL('config.js', src));
const sim = await import(new URL('three/sim3d.js', src));
const M = await import(new URL('three/map.js', src));
const { F } = sim;

const DT = .1;
const STAMINA = { drain: 1 / 4.5, gain: 1 / 7, rest: 1 };   // the same as player.js, which cannot be imported without three.js
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const ang = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const pick = list => list[Math.random() * list.length | 0];
const MOVING = ['roam', 'search', 'hunt', 'charge'], COMING = ['hunt', 'windup', 'charge'];
const BOOTH_MID = { x: 21, z: 40.5 };
const inBooth = p => M.roomAt(p.x, p.z) === M.BOOTH;
const doorMid = k => { const [x0, z0, x1, z1] = M.DOORWAYS.find(d => d.key === k).rect; return { x: (x0 + x1) / 2, z: (z0 + z1) / 2 }; };
// Where to stand to work a door's button from outside the booth: the wall is thin enough to reach through.
const OUTSIDE = { L: { x: 13.9, z: 39.7 }, R: { x: 28.1, z: 39.7 }, V: { x: 23.3, z: 35.5 } };
const front = t => t.face == null ? t : { x: t.x + Math.sin(t.face) * .9, z: t.z + Math.cos(t.face) * .9 };

function seedRandom(seed) {
  let a = seed * 2654435761 >>> 0;
  Math.random = () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/* ---------- what a guard can know ---------- */

// 'see', 'hear' or null. Seeing needs it in front of you, in line of sight and lit: by the building, or by your torch.
function sense(S, bot, m) {
  const d = dist(bot, m), off = Math.abs(angDiff(ang(bot, m), bot.yaw));
  const range = sim.lightsF(S) ? 18 : bot.on && off < .5 ? 13 : 4;
  if (d < range && off < bot.skill.fov && M.sees(bot.x, bot.z, m.x, m.z, S.doors)) return 'see';
  if (MOVING.includes(m.st) && d < (COMING.includes(m.st) ? 9 : 6)) return 'hear';
  return null;
}
// Could a person in this guard's shoes have known it was there, whichever way they were facing?
const perceivable = (S, p, m) => { const d = dist(p, m); return (MOVING.includes(m.st) && d < 6) || (d < 14 && M.sees(p.x, p.z, m.x, m.z, S.doors)); };

function perceive(S, bot) {
  const map = bot.skill.map && sim.lightsF(S) && inBooth(bot);
  for (const m of S.m) {
    const how = sense(S, bot, m) || (map && m.st !== 'rest' ? 'map' : null);
    if (!how) continue;
    const old = bot.mem[m.i];
    bot.mem[m.i] = { i: m.i, x: m.x, z: m.z, st: m.st, rot: m.rot, lit: m.lit, t: S.t, since: old && S.t - old.t < 1.5 ? old.since : S.t, how };
  }
}
// The mascots this guard knows about and has had time to react to.
const known = (S, bot, age = 2.5) => bot.mem.filter(k => k && S.t - k.t < age && k.st !== 'rest' && (S.t - k.since >= bot.skill.react || k.how === 'map'));

/* ---------- a guard's body ---------- */

function makeBot(id, i, policy) {
  return { id, i, policy, skill: policy.skill, x: 0, z: 0, yaw: Math.PI, on: false, sp: false, act: '', stam: 1, rested: 9, hold: 0, holding: null, mem: [], want: {}, state: {}, still: 0 };
}

const segDist = (a, b, h) => { const len = dist(a, b) || 1e-6, t = Math.max(0, Math.min(1, ((h.x - a.x) * (b.x - a.x) + (h.z - a.z) * (b.z - a.z)) / (len * len))); return Math.hypot(a.x + (b.x - a.x) * t - h.x, a.z + (b.z - a.z) * t - h.z); };
// How wide a berth a guard who knows better gives each mascot they know about: more for one that is coming, less for one frozen in a beam.
const berths = (S, bot) => known(S, bot, 4).filter(h => MOVING.includes(h.st) || h.st === 'windup').map(h => ({ x: h.x, z: h.z, r: h.lit ? (h.rot ? 3.2 : 2.5) : COMING.includes(h.st) ? 5 : 4 }));

// The way a person who knows the building would go: the shortest way that keeps clear of the mascots they know about.
// Returns { path, risk }: risk is true when every way passes close to one. Null when a shut door is in every way.
function plan(S, bot, goal, ducts) {
  const { nodes, links } = M.nav(), avoid = berths(S, bot), RISK = 70, n = nodes.length;
  const cost = avoid.length ? (a, b, d) => d + (avoid.some(h => segDist(a, b, h) < h.r) ? RISK : 0) : (a, b, d) => d;
  if (M.clear(bot.x, bot.z, goal.x, goal.z, M.PLAYER_R, S.doors) && cost(bot, goal, 0) < RISK) return { path: [goal], risk: false, calm: !avoid.length };
  const best = new Float64Array(n).fill(1e9), end = new Float64Array(n).fill(1e9), prev = new Int16Array(n).fill(-1), done = new Uint8Array(n);
  const room = M.roomAt(bot.x, bot.z), goalRoom = M.roomAt(goal.x, goal.z);
  for (let i = 0; i < n; i++) {
    const nd = nodes[i];
    if (!ducts && nd.room === M.DUCTS) continue;
    const d = dist(nd, bot), g = dist(nd, goal);
    if ((nd.room === room || d < 5) && M.clear(bot.x, bot.z, nd.x, nd.z, M.PLAYER_R, S.doors)) best[i] = cost(bot, nd, d);
    if ((nd.room === goalRoom || g < 5) && M.clear(goal.x, goal.z, nd.x, nd.z, M.PLAYER_R, S.doors)) end[i] = cost(nd, goal, g);
  }
  let last = -1, total = 1e9;
  for (;;) {
    let u = -1, ud = total;
    for (let i = 0; i < n; i++) if (!done[i] && best[i] < ud) { ud = best[i]; u = i; }
    if (u < 0) break;
    done[u] = 1;
    if (ud + end[u] < total) { total = ud + end[u]; last = u; }
    for (const l of links[u]) {
      if (done[l.to] || (l.duct && !ducts) || (l.key && S.doors[l.key])) continue;
      const c = ud + cost(nodes[u], nodes[l.to], l.d);
      if (c < best[l.to]) { best[l.to] = c; prev[l.to] = u; }
    }
  }
  if (last < 0) return null;
  const path = [goal];
  for (let i = last; i >= 0; i = prev[i]) path.unshift(nodes[i]);
  while (path.length > 1 && cost(bot, path[1], 0) < RISK && M.clear(bot.x, bot.z, path[1].x, path[1].z, M.PLAYER_R, S.doors)) path.shift();
  return { path, risk: total >= RISK, calm: !avoid.length };
}
// The plan for getting to a point. Thought about again every second, or sooner with a mascot about.
function wayTo(S, bot, goal, ducts) {
  const st = bot.state, key = Math.round(goal.x * 2) + ',' + Math.round(goal.z * 2) + (ducts ? 'd' : '');
  st.ways ??= new Map();
  const had = st.ways.get(key);
  if (had && S.t - had.at < (had.calm ? 1.2 : .4)) return had;
  if (st.ways.size > 6) st.ways.clear();
  const p = bot.skill.plans && plan(S, bot, goal, ducts);
  let way;
  if (p) way = { path: p.path.slice(), risk: p.risk, calm: p.calm, blocked: null, at: S.t };
  else { const r = M.route(bot.x, bot.z, goal.x, goal.z, { doors: S.doors, ducts, r: M.PLAYER_R }); way = { path: r.path, risk: false, calm: true, blocked: r.blocked || null, at: S.t }; }
  st.ways.set(key, way);
  return way;
}

// Walk toward a point. Returns the key of a shut door in the way, if there is one.
function walk(S, bot, goal, dt, sprint, face, ducts) {
  const way = wayTo(S, bot, goal, ducts), path = way.path;
  while (path.length && dist(bot, path[0]) < (path.length > 1 ? .5 : .15)) path.shift();
  const next = path[0];
  if (!next) return way.blocked;
  const dir = ang(bot, next);
  bot.yaw = face ?? dir;
  bot.sp = !!sprint && bot.stam > 0 && Math.abs(angDiff(dir, bot.yaw)) < 1;
  const step = Math.min(dist(bot, next), (bot.sp ? F.SPRINT : F.WALK) * dt);
  // Nobody walks into one they can see: no step that ends nearer to it than two metres.
  const to = { x: bot.x + Math.sin(dir) * step, z: bot.z + Math.cos(dir) * step };
  if (known(S, bot, 1).some(h => h.how !== 'map' && dist(to, h) < 2 && dist(to, h) < dist(bot, h))) { bot.state.retreat = S.t + 2; return null; }
  M.slide(bot, Math.sin(dir) * step, Math.cos(dir) * step, M.PLAYER_R, S.doors);
  return null;
}

// Do what bot.want says for one tick, then tell the host, as player.js does.
function act(S, bot, dt) {
  const w = bot.want, before = { x: bot.x, z: bot.z };
  bot.sp = false; bot.act = '';
  let goal = w.goal, face = w.face;
  const u = w.use;
  if (u) {
    const d = dist(bot, u.at);
    if (d < (u.reach || F.REACH - .3)) {
      // In reach: face it and hold the key. Holding the crank roots you; the rest do not, but a hand on a clock is not walking.
      face = w.face ?? u.face ?? ang(bot, u.at);
      if (u.hold < 0) { bot.act = u.what; if (u.what === 'crank' || !w.goal) goal = null; }
      else {
        goal = null;
        if (bot.holding !== u.key) { bot.holding = u.key; bot.hold = 0; }
        bot.hold += dt;
        if (bot.hold >= u.hold + .05) {
          sim.actFloor(bot.id, { t: 'use', what: u.what, i: u.i, k: u.k, id: u.id }); bot.hold = 0; bot.holding = null;
          if (u.what === 'door' && !!S.doors[u.k] !== u.shut) bot.state['stuck' + u.k] = S.t + 2;
        }
      }
    } else { goal = u.stand || front(u.at); bot.holding = null; }
  } else bot.holding = null;
  if (goal && dist(bot, goal) > .15) {
    const shut = walk(S, bot, goal, dt, w.sprint, face, w.ducts);
    // A shut booth door in the way: go and press its button, from whichever side we are on.
    if (shut && sim.lightsF(S) && !(w.keep || '').includes(shut)) {
      const panel = M.PANELS[shut], at = inBooth(bot) ? front(panel) : OUTSIDE[shut];
      if (dist(bot, panel) < F.REACH - .3) { if (S.t - (bot.pressed || -9) > .6) { bot.pressed = S.t; sim.actFloor(bot.id, { t: 'use', what: 'door', k: shut }); } }
      else walk(S, bot, at, dt, w.sprint, face, w.ducts);
    }
  } else if (face != null) bot.yaw = face;
  if (bot.sp) { bot.stam = Math.max(0, bot.stam - STAMINA.drain * dt); bot.rested = 0; }
  else { bot.rested += dt; if (bot.rested > STAMINA.rest) bot.stam = Math.min(1, bot.stam + STAMINA.gain * dt); }
  bot.on = !!w.on && bot.bat > 0;
  bot.still = dist(bot, before) < .01 && goal && dist(bot, goal) > 3 ? bot.still + dt : 0;
  sim.actFloor(bot.id, { t: 'p', x: bot.x, z: bot.z, yaw: bot.yaw, pitch: 0, on: bot.on, sp: bot.sp, act: bot.act });
}

// Press a booth door's button if it is not already the way we want it.
function setDoor(S, bot, k, shut) {
  if (!!S.doors[k] === shut || !sim.lightsF(S)) return false;
  const panel = M.PANELS[k];
  const stand = inBooth(bot) ? front(panel) : OUTSIDE[k];
  bot.want.use = { what: 'door', k, at: stand, face: ang(stand, panel), stand, hold: .2, key: 'door' + k, reach: .6, shut };
  return true;
}

/* ---------- playing properly ---------- */

// react: seconds before something perceived is acted on. fov: half-angle of what counts as in front.
// torch: 'always' on outside the booth, 'thrifty' keeps the last of it for holding something off, 'needed' only for that or the dark.
const SKILL = {
  careless: { react: .9, fov: .9, torch: 'always', map: false, plans: false, doors: false, cranks: false, peelRange: 12, dodges: false, alert: 7, beam: 1.2, reserve: 0, waits: false },
  competent: { react: .5, fov: 1.5, torch: 'thrifty', map: true, plans: true, doors: true, cranks: true, peelRange: 99, dodges: true, alert: 15, beam: 2.5, reserve: .25, waits: false },
  expert: { react: .25, fov: 2.2, torch: 'needed', map: true, plans: true, doors: true, cranks: true, peelRange: 99, dodges: true, alert: 15, beam: 2.5, reserve: .35, waits: true },
};
// alert: how near something coming has to be before they do anything about it. beam: seconds away it is when the torch goes on it.

// Somewhere to back off to: a point further from the thing than we are, reached by a way that keeps clear of it,
// which in a big room can mean round it and out of the door behind it. Cornered, it is the far end of the room.
// Thought about twice a second, and kept to while it still makes sense.
function awayFrom(S, bot, h) {
  const st = bot.state;
  if (st.away && S.t - st.awayAt < 2.5 && dist(bot, st.away) > 1 && dist(st.away, h) > dist(bot, h) && !(S.t - st.awayAt > .5 && wayTo(S, bot, st.away).risk)) return st.away;
  const scored = [], room = M.roomAt(bot.x, bot.z);
  for (const n of M.nav().nodes) {
    const d = dist(n, bot);
    if (d < 3 || d > 18 || n.room === M.DUCTS || dist(n, h) < dist(bot, h) + 1) continue;
    // Out of the room is better than across it.
    scored.push([dist(n, h) - d * .3 + (n.room !== room ? 6 : 0) + Math.random(), n]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const safe = n => { const p = bot.skill.plans ? plan(S, bot, n) : { risk: false, path: M.route(bot.x, bot.z, n.x, n.z, { doors: S.doors, r: M.PLAYER_R }).path }; return p && p.path.length && !p.risk; };
  st.away = scored.slice(0, 6).map(s => s[1]).find(safe)
    || scored.map(s => s[1]).filter(n => n.room === room && M.clear(bot.x, bot.z, n.x, n.z, M.PLAYER_R, S.doors)).sort((a, b) => dist(b, h) - dist(a, h))[0] || bot;
  st.awayAt = S.t;
  return st.away;
}

// Share out the due clocks: each to whoever would get there soonest after what they already have.
function assignClocks(S, team) {
  const up = team.bots.filter(b => !b.flat && b.policy.clocks !== false);
  const due = S.clocks.map((c, i) => c === 1 ? i : -1).filter(i => i >= 0);
  const at = new Map(up.map(b => [b, { x: b.x, z: b.z, len: 0 }]));
  team.clock = new Map(up.map(b => [b.id, []]));
  while (due.length && up.length) {
    let best = null;
    for (const b of up) for (const i of due) { const a = at.get(b), cost = a.len + dist(a, M.CLOCKS[i]) * (b.policy.share ?? 1); if (!best || cost < best.cost) best = { b, i, cost }; }
    due.splice(due.indexOf(best.i), 1);
    team.clock.get(best.b.id).push(best.i);
    Object.assign(at.get(best.b), { x: M.CLOCKS[best.i].x, z: M.CLOCKS[best.i].z, len: best.cost });
  }
}

// In the booth: shut whichever door something is coming to, and open it again once it has gone.
// Returns true while the guard is busy with a button. Sets bot.want.keep to the doors that should stay shut.
function mindDoors(S, bot, team, leaving) {
  const w = bot.want, st = bot.state;
  // One guard to a button: whoever in the booth is nearest it.
  const mine = k => !team.bots.some(b => b !== bot && !b.flat && inBooth(b) && b.skill.doors && dist(b, M.PANELS[k]) < dist(bot, M.PANELS[k]));
  w.keep = '';
  for (const k of ['L', 'V', 'R']) {
    const mid = doorMid(k);
    const close = known(S, bot, 4).some(h => !inBooth(h) && dist(h, mid) < (COMING.includes(h.st) ? 12 : 7));
    if (close) { st['clear' + k] = null; w.keep += k; } else st['clear' + k] ??= S.t;
  }
  // The door something is coming to first. One that will not shut (something is in it) is left for a moment.
  const urgency = k => Math.min(...known(S, bot, 4).filter(h => !inBooth(h)).map(h => dist(h, doorMid(k)) - (COMING.includes(h.st) ? 20 : 0)), 99);
  for (const k of [...w.keep].sort((a, b) => urgency(a) - urgency(b))) if (!S.doors[k] && mine(k) && !(st['stuck' + k] > S.t) && setDoor(S, bot, k, true)) return true;
  for (const k of ['L', 'V', 'R']) if (S.doors[k] && mine(k) && !w.keep.includes(k) && S.t - st['clear' + k] > (leaving ? 2 : 5) && setDoor(S, bot, k, false)) return true;
  return false;
}

// Something is coming for this guard. Sets bot.want and returns true if that is all it can think about.
function defend(S, bot, objective) {
  const sk = bot.skill, w = bot.want, st = bot.state;
  const hs = known(S, bot).filter(h => (COMING.includes(h.st) && dist(bot, h) < sk.alert) || (MOVING.includes(h.st) && h.how !== 'map' && dist(bot, h) < 6)).sort((a, b) => dist(bot, a) - dist(bot, b));
  if (!hs.length) { st.chased = null; return false; }
  st.chased ??= S.t;
  const h = hs[0], d = dist(bot, h), sight = M.sees(bot.x, bot.z, h.x, h.z, S.doors);
  // Tank winding up or already coming: get out of its line.
  if (sk.dodges && h.i === 3 && (h.st === 'windup' || h.st === 'charge') && sight) {
    const line = ang(h, bot), side = [1, -1].map(s => ({ x: bot.x + Math.sin(line + s * 1.57) * 4, z: bot.z + Math.cos(line + s * 1.57) * 4 })).filter(p => M.clear(bot.x, bot.z, p.x, p.z, M.PLAYER_R, S.doors));
    if (!side.includes(st.dodge)) st.dodge = side[0];
    if (st.dodge) { w.goal = st.dodge; w.sprint = true; w.use = null; w.face = ang(bot, st.dodge); return true; }
  }
  // How long until it has us if we stand still, with the torch on it and without.
  const lit = [.1, 1, 2.2][h.rot], unlit = h.i === 0 ? 2.8 : h.i === 1 && sight ? 2.6 : 4;
  // Light on it once it is close enough to matter (every second of light rots it), eyes on it either way: Flan slows for that alone.
  const beam = bot.bat > 0 && sight && COMING.includes(h.st) && d < F.BEAM_RANGE - .5 && (d - F.CATCH) / unlit < sk.beam;
  if (beam) w.on = true;
  if (sight && d < 16) w.face = ang(bot, h);
  const eta = (d - F.CATCH) / (beam ? lit : unlit);
  const booth = inBooth(bot), canHole = sk.doors && sim.lightsF(S);
  // In the booth with it outside: the doors are the answer. With it inside: out by another door.
  if (booth && canHole && !hs.some(inBooth)) { st.holed = S.t + 3; return false; }
  // Too many, no light, or it has been on us long enough: run for the booth and shut it out.
  const pressed = hs.length > 1 || (bot.bat <= 0 && h.i !== 0) || S.t - st.chased > 10;
  const boothOpen = canHole && !booth && dist(bot, BOOTH_MID) < 34 && !wayTo(S, bot, BOOTH_MID).risk;
  // Carry on with the job if there is a way to it that is not past the thing, and time to do it. Once backing off, keep backing off a while.
  const u = objective?.use, target = u ? u.stand || front(u.at) : objective?.goal;
  const crowding = !COMING.includes(h.st) && d < 5;   // not after us, but about to walk into us
  if (target && S.t > (st.retreat || 0) && !(pressed && boothOpen) && !crowding) {
    const noTime = u && dist(bot, target) < F.REACH + 1 && eta < Math.max(0, u.hold) + .8;
    if (!noTime && !wayTo(S, bot, target).risk) { w.goal = objective.goal; w.use = objective.use; w.sprint = eta < 2.5 && !beam; return true; }
    st.retreat = S.t + 3;
  }
  if (boothOpen) { w.goal = BOOTH_MID; w.use = null; w.sprint = eta < 3 && !beam; return true; }
  w.goal = awayFrom(S, bot, h); w.use = null; w.sprint = eta < 2 && !beam;
  return true;
}

// What an honest guard wants to be doing when nothing is after them.
function objectiveOf(S, bot, team) {
  const sk = bot.skill, pol = bot.policy, st = bot.state;
  // 1. A teammate on the floor.
  const flat = team.bots.filter(b => b.flat && b !== bot && pol.peels !== false);
  for (const f of flat) {
    const helpers = team.bots.filter(b => !b.flat && b.policy.peels !== false && dist(b, f) < b.skill.peelRange).sort((a, b) => dist(a, f) - dist(b, f));
    if (helpers[0] === bot) return { use: { what: 'peel', id: f.id, at: { x: f.x, z: f.z }, stand: { x: f.x, z: f.z }, hold: F.PEEL_HOLD, key: 'peel' + f.id }, urgent: true };
  }
  // 2. The clocks that are ours this hour.
  const left = F.HOUR - S.t % F.HOUR;
  let mine = pol.clocks === false ? [] : sk.plans ? (team.clock.get(bot.id) || []).filter(i => S.clocks[i] === 1) : S.clocks.map((c, i) => c === 1 ? i : -1).filter(i => i >= 0);
  if (mine.length) {
    mine.sort((a, b) => dist(bot, M.CLOCKS[a]) - dist(bot, M.CLOCKS[b]));
    // An expert waits out a wave in the booth if the hour is long enough to do the round after it.
    const need = mine.reduce((s, i, k) => s + dist(k ? M.CLOCKS[mine[k - 1]] : bot, M.CLOCKS[i]) * 1.35 / F.WALK + F.PUNCH_HOLD + 1, 0);
    const wait = sk.waits && S.stir && inBooth(bot) && left > need + 22;
    // A careless guard drifts off between clocks.
    if (!sk.plans && st.drift > S.t) return { goal: st.driftTo };
    if (!wait) { const i = mine[0]; return { use: { what: 'clock', i, at: M.CLOCKS[i], hold: F.PUNCH_HOLD, key: 'clock' + i }, clock: true }; }
  } else if (!sk.plans && !(st.drift > S.t) && Math.random() < .02) { st.drift = S.t + 6 + Math.random() * 10; st.driftTo = pick(M.nav().nodes.filter(n => n.room !== M.DUCTS)); }
  // 3. Light.
  if (bot.bat < 1 && sk !== SKILL.careless || bot.bat < .3) {
    const b = S.bats.map(i => M.BATTERY_SPOTS[i]).filter(s => dist(bot, s) < (bot.bat < sk.reserve ? 14 : 5) && M.sees(bot.x, bot.z, s.x, s.z, S.doors)).sort((a, c) => dist(bot, a) - dist(bot, c))[0];
    if (b && bot.bat <= 1 - F.BAT_PICKUP * .6) return { use: { what: 'bat', i: M.BATTERY_SPOTS.indexOf(b), at: b, stand: b, hold: .2, key: 'bat' } };
  }
  // 4. The generator, if it is our job and the power needs it.
  const genJob = sk.cranks && pol.cranks !== false && (team.bots.length < 3 || team.bots.filter(b => !b.flat && b.skill.cranks && b.policy.cranks !== false).at(-1) === bot);
  if (genJob && (S.power < (st.cranking ? 75 : 45) || S.out)) { st.cranking = true; return { use: { what: 'crank', at: M.GENERATOR, hold: -1, key: 'crank' }, crank: true }; }
  st.cranking = false;
  // 5. Nothing to do: the booth, and the charger if the torch wants it. A careless guard wanders.
  if (!sk.plans && pol.stays !== true && !(bot.bat < .05 && sim.lightsF(S)) && !st.topUp) return st.drift > S.t ? { goal: st.driftTo } : {};
  st.topUp = !sk.plans && bot.bat < .6;   // a careless guard charges only once the torch has died, and not for long
  if (bot.bat < .95 && sim.lightsF(S)) return { use: { what: 'charge', at: M.CHARGER, hold: -1, key: 'charge' }, home: true };
  return { goal: BOOTH_MID, home: true };
}

const honest = (skill, opts = {}) => ({
  skill: SKILL[skill], ...opts,
  think(S, bot, team) {
    const sk = bot.skill, w = bot.want, st = bot.state, booth = inBooth(bot);
    const obj = objectiveOf(S, bot, team);
    const dark = !sim.lightsF(S);
    w.on = sk.torch === 'always' ? !booth || dark : sk.torch === 'thrifty' ? (!booth && bot.bat > sk.reserve) || (dark && bot.bat > sk.reserve / 2) : dark && bot.bat > sk.reserve / 2 && !booth;
    if (defend(S, bot, obj)) return;
    // In the booth: the doors come before anything else, and nobody walks out past something waiting at one.
    if (sk.doors && booth && !dark) {
      const leaving = !obj.home;
      if (mindDoors(S, bot, team, leaving)) return;
      if (st.holed > S.t || (leaving && w.keep.length === 3) || (leaving && w.keep && !obj.urgent && F.HOUR - S.t % F.HOUR > 30)) {
        w.goal = BOOTH_MID; if (bot.bat < .95) w.use = { what: 'charge', at: M.CHARGER, hold: -1, key: 'charge' };
        return;
      }
    }
    w.goal = obj.goal; w.use = obj.use;
    // Something known is on every way there: wait for it to move on, unless the hour is nearly up.
    const to = obj.use ? obj.use.stand || front(obj.use.at) : obj.goal;
    if (sk.plans && to && dist(bot, to) > 2 && wayTo(S, bot, to).risk && !obj.urgent && F.HOUR - S.t % F.HOUR > dist(bot, to) / F.WALK * 1.4 + 8) {
      const nearest = known(S, bot, 4).filter(h => MOVING.includes(h.st)).sort((a, b) => dist(bot, a) - dist(bot, b))[0];
      w.goal = booth ? BOOTH_MID : nearest && dist(bot, nearest) < 8 ? awayFrom(S, bot, nearest) : null; w.use = null;
      return;
    }
    // Running late for a clock or a friend.
    if (obj.use && (obj.urgent || obj.clock) && dist(bot, obj.use.at) / F.WALK > (obj.urgent ? 3 : F.HOUR - S.t % F.HOUR - 6)) w.sprint = true;
  },
});

/* ---------- playing to break it ---------- */

const boothSitter = { careless: SKILL.careless, competent: SKILL.competent }.competent;
const DEGENERATE = {
  // Everyone in the booth, every door shut, nobody goes anywhere.
  turtle: () => ({ skill: boothSitter, think(S, bot) {
    const w = bot.want;
    w.on = !sim.lightsF(S);
    for (const k of ['L', 'V', 'R']) if ((bot.i + 'LVR'.indexOf(k)) % 3 === 0 || S.t > 4) if (setDoor(S, bot, k, true)) return;
    const h = known(S, bot).sort((a, b) => dist(bot, a) - dist(bot, b))[0];
    if (h && dist(bot, h) < 12) { w.face = ang(bot, h); w.on = true; }
    if (bot.bat < .9) w.use = { what: 'charge', at: M.CHARGER, hold: -1, key: 'charge' }; else w.goal = BOOTH_MID;
  } }),
  // Stand at the dock with the torch on and the charge lead in, and shine at whatever comes in.
  dock: () => ({ skill: boothSitter, think(S, bot) {
    const w = bot.want, h = known(S, bot).sort((a, b) => dist(bot, a) - dist(bot, b))[0];
    w.on = true; w.use = { what: 'charge', at: M.CHARGER, hold: -1, key: 'charge' };
    w.face = h ? ang(bot, h) : Math.PI + (bot.i - 1) * .8;
  } }),
  // Everyone backs into one corner and pins whatever comes with their torches.
  corner: spot => ({ skill: boothSitter, think(S, bot) {
    const w = bot.want, at = { x: spot.x + (bot.i % 2) * .8, z: spot.z + (bot.i >> 1) * .8 };
    const hs = known(S, bot).sort((a, b) => dist(bot, a) - dist(bot, b));
    // Share the mascots out so two torches are not on the same one.
    const h = hs[bot.i % Math.max(1, hs.length)];
    if (dist(bot, at) > .4) w.goal = at;
    w.face = h ? ang(bot, h) : spot.look;
    w.on = !!h && dist(bot, h) < F.BEAM_RANGE;
  } }),
  // Walk a loop of rooms and never stop, so whatever follows never arrives.
  kite: () => ({ skill: SKILL.competent, think(S, bot) {
    const loop = [{ x: 19, z: 8 }, { x: 31, z: 5 }, { x: 35, z: 14 }, { x: 31, z: 18 }, { x: 22, z: 18 }], st = bot.state;
    st.leg ??= 0;
    if (dist(bot, loop[st.leg]) < 1.5) st.leg = (st.leg + 1) % loop.length;
    const h = known(S, bot).sort((a, b) => dist(bot, a) - dist(bot, b))[0];
    bot.want.goal = loop[st.leg]; bot.want.sprint = !!h && dist(bot, h) < 5; bot.want.on = false;
  } }),
  // Stand somewhere the mascots cannot walk to.
  hole: spot => ({ skill: SKILL.competent, think(S, bot) {
    const w = bot.want, at = { x: spot.x + (bot.i % 3 - 1) * spot.dx, z: spot.z + (bot.i % 3 - 1) * (spot.dz || 0) };
    const h = known(S, bot).sort((a, b) => dist(bot, a) - dist(bot, b))[0];
    w.ducts = true;
    if (dist(bot, at) > .3) w.goal = at;
    if (h && dist(bot, h) < F.BEAM_RANGE) { w.face = ang(bot, h); w.on = true; }
  } }),
  // Crank the generator and nothing else, torch on whatever turns up.
  cranker: () => ({ skill: SKILL.competent, think(S, bot) {
    const w = bot.want, h = known(S, bot).filter(k => k.how !== 'map').sort((a, b) => dist(bot, a) - dist(bot, b))[0];
    w.use = { what: 'crank', at: M.GENERATOR, hold: -1, key: 'crank' };
    if (h && dist(bot, h) < F.BEAM_RANGE) { w.face = ang(bot, h); w.on = true; }
  } }),
};

/* ---------- the things that must never happen ---------- */

const failures = [];
const fail = (name, what) => { if (failures.length < 60) failures.push(`${name}: ${what}`); };

// Flood the floor a mascot can stand on, from where the mascots start.
function flood(ducts) {
  const step = .25, W = Math.ceil(42 / step), H = Math.ceil(44 / step), seen = new Uint8Array(W * H), cell = (x, z) => Math.round(z / step) * W + Math.round(x / step);
  const ok = (x, z) => M.walkable(x, z, M.MASCOT_R) && (ducts || M.roomAt(x, z) !== M.DUCTS);
  const queue = (ducts ? [M.REST[2]] : [M.REST[0], M.REST[3]]).map(r => [Math.round(r.x / step) * step, Math.round(r.z / step) * step]);
  for (const [x, z] of queue) seen[cell(x, z)] = 1;
  while (queue.length) {
    const [x, z] = queue.pop();
    for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) { const nx = x + dx, nz = z + dz; if (nx >= 0 && nz >= 0 && nx < 42 && nz < 44 && !seen[cell(nx, nz)] && ok(nx, nz)) { seen[cell(nx, nz)] = 1; queue.push([nx, nz]); } }
  }
  return { has: (x, z) => x >= 0 && z >= 0 && x < 42 && z < 44 && !!seen[cell(x, z)] };
}

// Things about the building that hold before anyone plays.
function checkBuilding(name) {
  const start = M.spawnPoint(0), reach = F.REACH - .3;
  const reachable = (label, at, stand) => {
    if (!M.walkable(stand.x, stand.z, M.PLAYER_R)) return fail(name, `${label}: nowhere to stand at ${stand.x.toFixed(1)}, ${stand.z.toFixed(1)}`);
    if (dist(stand, at) > reach) return fail(name, `${label}: its standing spot is out of reach`);
    const r = M.route(start.x, start.z, stand.x, stand.z, { r: M.PLAYER_R });
    if (!r.path.length) fail(name, `${label}: no route from the booth`);
  };
  M.CLOCKS.forEach((c, i) => reachable('clock ' + i, c, front(c)));
  reachable('generator', M.GENERATOR, front(M.GENERATOR));
  reachable('charger', M.CHARGER, front(M.CHARGER));
  M.BATTERY_SPOTS.forEach((b, i) => reachable('battery ' + i, b, b));
  // Every door has a button a guard can press from inside and from outside, so nobody is shut out for good.
  for (const k in M.PANELS) { reachable(`door ${k} inside`, M.PANELS[k], front(M.PANELS[k])); if (!M.walkable(OUTSIDE[k].x, OUTSIDE[k].z, M.PLAYER_R) || dist(OUTSIDE[k], M.PANELS[k]) > reach) fail(name, `door ${k}: cannot be worked from outside`); }
  M.REST.forEach((r, i) => { if (!M.walkable(r.x, r.z, M.MASCOT_R)) fail(name, `${MASC[i].name} rests inside something`); });
  // Nowhere a guard can stand is out of every mascot's reach: the walkers everywhere but the ducts, Squish there.
  // A mascot that cannot get nearer reaches F.GRAB across furniture, so that is the distance that counts.
  const walkers = flood(false), squish = flood(true), R = F.GRAB - .25;
  let safe = 0, where = '';
  for (let x = .25; x < 42; x += .25) for (let z = .25; z < 44; z += .25) {
    if (!M.walkable(x, z, .2)) continue;
    const f = M.roomAt(x, z) === M.DUCTS ? squish : walkers;
    let caught = false;
    for (let dx = -R; dx <= R && !caught; dx += .25) for (let dz = -R; dz <= R && !caught; dz += .25) caught = Math.hypot(dx, dz) < R && f.has(x + dx, z + dz) && M.reaches(x + dx, z + dz, x, z);
    if (!caught) { safe++; where ||= `${x}, ${z}`; }
  }
  if (safe) fail(name, `${safe} standing spots no mascot can reach, first at ${where}`);
}

/* ---------- one night ---------- */

function play(sc, seed, trace) {
  seedRandom(seed);
  game.S = newState('TEST'); game.players = {};
  const team = { bots: [], clock: new Map() };
  for (let i = 0; i < sc.n; i++) { const id = 'g' + i; game.players[id] = { id, name: 'G' + i }; team.bots.push(makeBot(id, i, sc.guard(i, sc.n))); }
  sim.startFloorNight(sc.night);
  const S = game.S;
  if (sc.dev) S.dev = sc.dev;
  for (const b of team.bots) Object.assign(b, { x: game.players[b.id].x, z: game.players[b.id].z, bat: 1, flat: false });
  const out = { win: false, t: 0, flats: 0, peels: 0, by: [0, 0, 0, 0], warn: [], firstFlat: 1e9, notes: [], hunted: 0, quiet: 0, calms: 0, stood: 0, lit: 0, dead: 0, dry: 0, power: 0, missed: 0, punched: 0, outs: 0, cranked: 0 };
  const firstSeen = team.bots.map(() => [null, null, null, null]), lastSeen = team.bots.map(() => [-9, -9, -9, -9]);
  const parked = S.m.map(m => ({ x: m.x, z: m.z, t: 0 }));
  let seenEv = 0, round = -1, calm = 0, flatKey = '', tickNo = 0;
  while (S.phase === 'play') {
    now += DT * 1000; tickNo++;
    if (S.round !== round || team.bots.map(b => +b.flat).join('') !== flatKey) { round = S.round; flatKey = team.bots.map(b => +b.flat).join(''); assignClocks(S, team); }
    for (const bot of team.bots) {
      const me = game.players[bot.id];
      bot.bat = me.bat;
      if (me.flat) { if (!bot.flat) { bot.flat = true; bot.x = me.x; bot.z = me.z; } if (S.t - (bot.called || -9) > F.CALL_GAP) { bot.called = S.t; sim.actFloor(bot.id, { t: 'call' }); } continue; }
      bot.flat = false;
      bot.want = { on: false };
      if ((tickNo + bot.i) % 3 === 0) perceive(S, bot);
      bot.policy.think(S, bot, team);
      act(S, bot, DT);
      if (bot.still > 45) { fail(sc.name, `seed ${seed}: guard ${bot.i} could not move at ${bot.x.toFixed(1)}, ${bot.z.toFixed(1)} for 45 s`); bot.still = 0; }
    }
    sim.stepFloor();
    if (trace === 2 && tickNo % 10 === 0) console.log(`${S.t.toFixed(0).padStart(6)}  ` + team.bots.map(b => `${b.flat ? 'FLAT' : ''}(${b.x.toFixed(1)},${b.z.toFixed(1)}) bat ${b.bat.toFixed(2)}${b.on ? '*' : ''} ${b.want.use?.key || (b.want.goal ? `go ${b.want.goal.x.toFixed(1)},${b.want.goal.z.toFixed(1)}` : '-')}`).join(' ') + '  |  ' + S.m.map((m, i) => `${m.st}${m.lit ? '*' : ''}(${m.x.toFixed(0)},${m.z.toFixed(0)})${argv.includes('--brains') ? JSON.stringify({ ...sim.brainOf(i), path: sim.brainOf(i).path.length }) : ''}`).join(' ') + (S.stir ? '  STIR' : ''));

    // Measure.
    let anyHunted = false;
    S.players.forEach((p, gi) => {
      if (p.flat) return;
      out.stood += DT; if (p.on) out.lit += DT; if (p.bat <= 0) out.dead += DT;
      const bot = team.bots[gi];
      if (p.bat <= 0 && !bot.wasDry) out.dry++;
      bot.wasDry = p.bat <= 0;
      if (S.m.some((m, i) => COMING.includes(m.st) && sim.brainOf(i).tgt === p.id)) { out.hunted += DT; anyHunted = true; }
      if (tickNo % 5 === gi % 5) for (const m of S.m) if (perceivable(S, p, m)) { if (S.t - lastSeen[gi][m.i] > 1.5) firstSeen[gi][m.i] = S.t; lastSeen[gi][m.i] = S.t; }
    });
    if (S.crank) out.cranked += DT;
    if (anyHunted) { if (calm >= 20) out.calms++; calm = 0; } else { calm += DT; out.quiet += DT; }
    for (const e of S.evs) if (e.id > seenEv) {
      seenEv = e.id;
      if (trace && !['bang', 'hour'].includes(e.type)) console.log(`${S.t.toFixed(1).padStart(6)}  ${e.type} ${e.x == null ? '' : JSON.stringify(e.x)}  power ${S.power.toFixed(0)}`);
      if (e.type === 'flat') {
        const gi = S.players.findIndex(p => p.id === e.x.id);
        out.flats++; out.by[e.x.by]++; out.firstFlat = Math.min(out.firstFlat, S.t);
        out.warn.push(S.t - lastSeen[gi][e.x.by] < 1.5 ? S.t - firstSeen[gi][e.x.by] : 0);
        const bot = team.bots[gi], m = S.m[e.x.by];
        out.notes.push(`seed ${seed} ${S.t.toFixed(0)}s ${MASC[e.x.by].name.split(' ').pop()} got g${gi} in ${M.ROOMS3[M.roomAt(e.x.x, e.x.z)]?.name}; was ${bot.want.use?.key || (bot.want.goal ? 'walking' : 'standing')}, torch ${bot.bat.toFixed(2)}${bot.on ? ' on' : ''}, knew of ${known(S, bot).length}, ${S.m.filter(o => COMING.includes(o.st)).length} hunting, it was rot ${m.rot}${m.lit ? ' lit' : ''}, power ${S.power.toFixed(0)}${S.stir ? ', stir' : ''}`);
      } else if (e.type === 'peel') out.peels++;
      else if (e.type === 'out') out.outs++;
    }

    // Softlocks.
    if (S.players.every(p => p.flat) && S.phase === 'play') { fail(sc.name, `seed ${seed}: everyone is flat and the night goes on`); break; }
    if (S.t > 6 * F.HOUR + 1) { fail(sc.name, `seed ${seed}: past 6 AM and still playing`); break; }
    S.m.forEach((m, i) => {
      const p = parked[i];
      if (!Number.isFinite(m.x + m.z + m.yaw)) fail(sc.name, `seed ${seed}: ${MASC[i].name} is nowhere`);
      if (!['roam', 'search', 'hunt'].includes(m.st) || m.lit || dist(m, p) > .5) Object.assign(p, { x: m.x, z: m.z, t: S.t });
      else if (S.t - p.t > 30) { fail(sc.name, `seed ${seed}: ${MASC[i].name} stood ${m.st}ing at ${m.x.toFixed(1)}, ${m.z.toFixed(1)} for 30 s`); p.t = S.t; }
    });
  }
  if (calm >= 20) out.calms++;
  Object.assign(out, { win: S.phase === 'win' || S.phase === 'won', t: S.t, power: S.power, missed: S.tally.missed, punched: S.tally.punched });
  if (S.phase === 'play') fail(sc.name, `seed ${seed}: the night did not end`);
  return out;
}

/* ---------- the scenarios ---------- */

const all = policy => () => policy;
const scenarios = [];
const add = (name, n, night, guard, expect = {}) => scenarios.push({ name: `${name} n${night}`, n, night, guard, ...expect });

// The building with nothing moving in it: every clock can be reached in the hour it is given.
for (const n of [1, 2, 4, 6]) add(`empty building x${n}`, n, 1, all(honest('competent')), { dev: { freeze: true }, noMiss: true });
for (const night of [1, 3, 5]) add('solo careless', 1, night, all(honest('careless')));
for (const night of [1, 2, 3, 4, 5]) add('solo competent', 1, night, all(honest('competent')), { proper: true });
for (const night of [1, 3, 5]) add('solo expert', 1, night, all(honest('expert')));
for (const n of [2, 3, 4, 6]) for (const night of [1, 3, 5]) add(`crew of ${n} competent`, n, night, all(honest('competent')), { proper: true });
for (const night of [1, 5]) add('crew of 4 careless', 4, night, all(honest('careless')));
for (const night of [3, 5]) add('crew of 4 expert', 4, night, all(honest('expert')));
// A crew that splits up but leaves each other on the floor, and one that never cranks: what coordination is worth.
add('crew of 4, no peels', 4, 5, all(honest('competent', { peels: false })));
add('crew of 4, no crank', 4, 5, all(honest('competent', { cranks: false })));

// The ones that must not work. worse: the proper scenario each has to do clearly worse than.
const sitter = honest('competent', { clocks: false, stays: true, peels: false, cranks: false });
const bad = (name, n, guard) => { for (const night of [1, 3]) add(name, n, night, guard, { worse: `${n === 1 ? 'solo' : `crew of ${n}`} competent n${night}` }); };
bad('x4 turtle: doors shut, nobody moves', 4, all(DEGENERATE.turtle()));
bad('x1 turtle', 1, all(DEGENERATE.turtle()));
bad('x4 one cranks, three hide', 4, i => i ? DEGENERATE.turtle() : DEGENERATE.cranker());
bad('x4 corner with torches', 4, all(DEGENERATE.corner({ x: 1, z: 12.5, look: Math.PI / 4 })));
bad('x4 booth corner with torches', 4, all(DEGENERATE.corner({ x: 15.8, z: 42.6, look: Math.PI * .75 })));
bad('x4 ignore the clocks, mind the doors', 4, i => honest('competent', { clocks: false, stays: true, cranks: i === 3 }));
bad('x1 ignore the clocks, mind the doors', 1, all(honest('competent', { clocks: false, stays: true })));
bad('x4 one runner, three never leave', 4, i => i ? sitter : honest('competent', { share: .01 }));
bad('x4 camp the charger', 4, all(DEGENERATE.dock()));
bad('x1 kite round the loop', 1, all(DEGENERATE.kite()));
bad('x4 sit in the ducts', 4, all(DEGENERATE.hole({ x: 20, z: 34.75, dx: 1.2 })));
bad('x2 stand in the vent doorway', 2, all(DEGENERATE.hole({ x: 22.9, z: 36.25, dx: 0, dz: .2 })));
bad('x2 stand in the duct mouth', 2, all(DEGENERATE.hole({ x: 15.9, z: 33.25, dx: 0, dz: .2 })));

/* ---------- running them ---------- */

const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const SEEDS = +arg('seeds', 40), ONLY = arg('only', ''), TRACE = arg('trace', '');

const CHUNK = 4;   // seeds a worker plays before it reports back

if (!isMainThread) {
  // A worker plays the scenarios it is handed and posts back the nights and any failures.
  parentPort.on('message', ({ i, from, to }) => {
    failures.length = 0;
    const runs = [];
    for (let seed = from; seed <= to; seed++) runs.push(play(scenarios[i], seed));
    parentPort.postMessage({ i, runs, failures: [...failures] });
  });
} else if (TRACE) {
  const sc = scenarios.find(s => s.name.includes(TRACE));
  if (!sc) { console.error('No scenario matches', TRACE); process.exit(2); }
  console.log(sc.name, 'seed', +arg('seed', 1));
  console.log(play(sc, +arg('seed', 1), argv.includes('--steps') ? 2 : 1));
  console.log(failures.join('\n'));
} else {
  const todo = scenarios.map((s, i) => i).filter(i => ONLY.split(',').some(part => scenarios[i].name.includes(part)));
  const results = new Map(todo.map(i => [i, []])), jobs = [];
  for (const i of todo) for (let from = 1; from <= SEEDS; from += CHUNK) jobs.push({ i, from, to: Math.min(SEEDS, from + CHUNK - 1) });
  await new Promise(done => {
    let next = 0, live = 0;
    const count = Math.max(1, Math.min(jobs.length, cpus().length, 12));
    for (let k = 0; k < count; k++) {
      const w = new Worker(new URL(import.meta.url));
      const give = () => { if (next < jobs.length) { live++; w.postMessage(jobs[next++]); } else { w.terminate(); if (!live) done(); } };
      w.on('message', r => { live--; results.get(r.i).push(...r.runs); failures.push(...r.failures); give(); });
      w.on('error', e => { console.error(e); process.exit(2); });
      give();
    }
  });

  checkBuilding('the building');

  const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
  const sum = (runs, f) => runs.reduce((s, r) => s + f(r), 0);
  const median = list => list.length ? [...list].sort((a, b) => a - b)[list.length >> 1] : NaN;
  const rate = new Map();
  const head = ['scenario', 'win%', 'end', 'flat/g', 'peel', 'B F S T %', 'warn s', '<1.5s', 'hunted', 'calms', 'torch', 'dead', 'dry/g', 'miss', 'power', 'out%', 'crank s'];
  const rows = [];
  const row = (sc, runs) => {
    const n = runs.length, warn = runs.flatMap(r => r.warn), flats = sum(runs, r => r.flats), stood = sum(runs, r => r.stood);
    rate.set(sc.name, pct(sum(runs, r => +r.win), n));
    rows.push([sc.name, rate.get(sc.name), Math.round(sum(runs, r => r.t) / n), (flats / n / sc.n).toFixed(2), pct(sum(runs, r => r.peels), flats),
      [0, 1, 2, 3].map(i => pct(sum(runs, r => r.by[i]), flats)).join(' '), median(warn).toFixed(1), pct(warn.filter(x => x < 1.5).length, warn.length) + '%',
      pct(sum(runs, r => r.hunted), stood) + '%', (sum(runs, r => r.calms) / n).toFixed(1), pct(sum(runs, r => r.lit), stood) + '%', pct(sum(runs, r => r.dead), stood) + '%', (sum(runs, r => r.dry) / n / sc.n).toFixed(1),
      pct(sum(runs, r => r.missed), sum(runs, r => r.missed + r.punched)) + '%', Math.round(sum(runs, r => r.power) / n), pct(sum(runs, r => +(r.outs > 0)), n), Math.round(sum(runs, r => r.cranked) / n)]);
    return runs;
  };
  for (const i of todo) {
    const sc = scenarios[i], runs = row(sc, results.get(i));
    if (sc.noMiss && sum(runs, r => r.missed)) fail(sc.name, `${sum(runs, r => r.missed)} clocks missed with nothing in the way: the round does not fit in the hour`);
    if (sc.night === 1 && sc.proper) { const early = Math.min(...runs.map(r => r.firstFlat)); if (early < 30) fail(sc.name, `a guard was flattened ${early.toFixed(0)} s into night 1`); }
  }
  // A strategy that should not work has to win under one night in ten, or under half as often as playing properly.
  for (const i of todo) { const sc = scenarios[i]; if (sc.worse && rate.has(sc.worse) && rate.get(sc.name) > Math.max(10, rate.get(sc.worse) / 2)) fail(sc.name, `wins ${rate.get(sc.name)}% of nights; playing properly wins ${rate.get(sc.worse)}%`); }

  const width = head.map((h, c) => Math.max(h.length, ...rows.map(r => String(r[c]).length)));
  const line = cells => cells.map((v, c) => c ? String(v).padStart(width[c]) : String(v).padEnd(width[c])).join('  ');
  console.log(`${SEEDS} seeds per scenario. n1 to n5 is the night.\n`);
  console.log(line(head));
  for (const r of rows) console.log(line(r));
  console.log(`
win%    nights survived to 6 AM            end     mean second the night ended (420 is 6 AM)
flat/g  flattenings per guard per night    peel    share of flattened guards who were peeled up
B F S T share of flattenings by Biggs, Flan, Squish, Tank
warn s  median seconds between a mascot being there to see or hear and it catching the guard; <1.5s is the share with less
hunted  share of standing time with something after you    calms   stretches of 20 s or more with nothing after anyone, per night
torch   share of standing time with the torch on           dead    share with it flat; dry/g is how often it ran out per guard
miss    share of due clocks missed    power   mean power at the end    out%    nights the power went out    crank s  seconds cranked`);
  if (argv.includes('--deaths')) for (const i of todo) console.log(`\n${scenarios[i].name}\n` + results.get(i).flatMap(r => r.notes).slice(0, 30).join('\n'));
  if (failures.length) { console.log(`\n${failures.length} FAILED\n` + failures.join('\n')); process.exit(1); }
  console.log('\nNo softlocks, and nothing degenerate beats playing properly.');
}
